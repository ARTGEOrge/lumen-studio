// True redaction: removes the text glyphs, images (or just the covered pixels) and vector paths that lie
// under redaction marks from the page content itself — the rest of the page stays vector and searchable.
// Also: glyph-accurate text geometry for Find & Redact (search phrases / patterns and mark every hit).
import { interpret, pageContentString, pageResources, setPageContent, decodeStream, bytesToStr, strToBytes, mul, apply, invert, ID, Name } from './content.js';
import { App } from './state.js';
import { drawAllAnnots } from './viewer.js';
import { parseRanges, esc, uid, prefs } from './util.js';
const L = window.PDFLib;
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFNumber, PDFRawStream, PDFStream } = L;

export class Unsupported extends Error { }
const N = k => PDFName.of(k);
const deref = (ctx, o) => (o instanceof PDFRef ? ctx.lookup(o) : o);
const numOf = o => (o instanceof PDFNumber ? o.asNumber() : typeof o === 'number' ? o : null);
const area = r => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
const inter = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
const overlaps = (a, b) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
const inside = (p, m) => p[0] >= m[0] && p[0] <= m[2] && p[1] >= m[1] && p[1] <= m[3];
function boxM(M, x0, y0, x1, y1) {
  const p = [apply(M, x0, y0), apply(M, x1, y0), apply(M, x0, y1), apply(M, x1, y1)];
  return [Math.min(p[0][0], p[1][0], p[2][0], p[3][0]), Math.min(p[0][1], p[1][1], p[2][1], p[3][1]), Math.max(p[0][0], p[1][0], p[2][0], p[3][0]), Math.max(p[0][1], p[1][1], p[2][1], p[3][1])];
}
const fmt = v => { const s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, ''); return s === '-0' ? '0' : s; };

// A glyph is removed when a mark covers its centre or at least 15% of its box.
export function glyphHit(box, marks) {
  const A = area(box) || 1e-9; const c = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
  for (const m of marks) { if (!overlaps(box, m)) continue; if (inside(c, m) || area(inter(box, m)) >= 0.15 * A) return true; }
  return false;
}
// glyph box (text space) of glyph g in show record rec
function glyphBox(rec, g, M) {
  const lo = rec.Ts - 0.22 * rec.size, hi = rec.Ts + 0.8 * rec.size;
  const w = g.w > 0 ? g.w : Math.max(g.adv, 0.3 * Math.abs(rec.size * rec.Th));
  return boxM(M, g.x, lo, g.x + w, hi);
}
function checkFont(rec) {
  const fi = rec.fi;
  if (!fi) throw new Unsupported('a font used on the page is missing');
  if (fi.unsupported) throw new Unsupported(fi.unsupported);
  if (fi.subtype === 'Type3') throw new Unsupported('Type 3 (bitmap) font');
  if (!fi.twoByte && !fi.std && fi.widths.size === 0) throw new Unsupported(`font ${fi.base || ''} has no glyph widths`);
}

/* ---------- rewriting one text-showing operator without the removed glyphs ---------- */
function rewriteShow(rec, removed, args) {
  const sz = rec.size * rec.Th;
  if (!sz || !isFinite(sz)) throw new Unsupported('text with zero font size');
  const w = rec.fi.twoByte ? 4 : 2;
  let out = '[', pos = 0, str = '';
  const flush = () => { if (str) { out += '<' + str + '>'; str = ''; } };
  const kern = dx => { if (Math.abs(dx) > 1e-6) { flush(); out += ' ' + fmt(-dx * 1000 / sz) + ' '; } };
  rec.glyphs.forEach((g, k) => { if (removed.has(k)) return; kern(g.x - pos); str += g.code.toString(16).padStart(w, '0'); pos = g.x + g.adv; });
  kern(rec.adv - pos); flush(); out += '] TJ';
  if (rec.op === "'") return 'T* ' + out;
  if (rec.op === '"') return `${fmt(+args[0] || 0)} Tw ${fmt(+args[1] || 0)} Tc T* ` + out;
  return out;
}

/* ---------- images ---------- */
function unpredictPng(data, cols, colors, bpc) {
  const bpp = Math.max(1, Math.ceil(colors * bpc / 8)); const row = Math.ceil(cols * colors * bpc / 8);
  const rows = Math.floor(data.length / (row + 1)); const out = new Uint8Array(rows * row);
  for (let r = 0; r < rows; r++) {
    const ft = data[r * (row + 1)]; const src = r * (row + 1) + 1, dst = r * row, up = dst - row;
    for (let i = 0; i < row; i++) {
      const x = data[src + i], a = i >= bpp ? out[dst + i - bpp] : 0, b = r ? out[up + i] : 0, c = r && i >= bpp ? out[up + i - bpp] : 0;
      let v;
      switch (ft) {
        case 0: v = x; break; case 1: v = x + a; break; case 2: v = x + b; break; case 3: v = x + ((a + b) >> 1); break;
        case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Unsupported('bad PNG predictor');
      }
      out[dst + i] = v & 255;
    }
  }
  return out;
}
function imageComps(ctx, dict) {
  const cs = dict.lookup(N('ColorSpace'));
  if (cs instanceof PDFName) { const n = cs.decodeText(); return n === 'DeviceRGB' || n === 'CalRGB' ? 3 : n === 'DeviceGray' || n === 'CalGray' ? 1 : 0; }
  if (cs instanceof PDFArray) {
    const f = cs.get(0)?.decodeText?.();
    if (f === 'ICCBased') { const s = deref(ctx, cs.get(1)); const n = numOf(s?.dict?.lookup(N('N'))); return n === 1 || n === 3 ? n : 0; }
    if (f === 'CalRGB') return 3; if (f === 'CalGray') return 1;
  }
  return 0;
}
async function decodeImage(ctx, stream, isMask = false) {
  const dict = stream.dict;
  if (dict.lookup(N('ImageMask'))?.toString() === 'true') throw new Unsupported('stencil image mask');
  if (dict.get(N('Decode'))) throw new Unsupported('image with a Decode array');
  const w = numOf(dict.lookup(N('Width'))), h = numOf(dict.lookup(N('Height')));
  if (!w || !h || w * h > 40e6) throw new Unsupported('image size');
  const comps = isMask ? 1 : imageComps(ctx, dict);
  if (!comps) throw new Unsupported('image colour space');
  let filter = dict.lookup(N('Filter')); if (filter instanceof PDFArray) { if (filter.size() !== 1) throw new Unsupported('image with chained filters'); filter = filter.lookup(0); }
  const fname = filter instanceof PDFName ? filter.decodeText() : null;
  if (!(stream instanceof PDFRawStream)) throw new Unsupported('image stream');
  let data;
  if (fname === 'DCTDecode') {
    const bmp = await createImageBitmap(new Blob([stream.contents], { type: 'image/jpeg' }));
    const c = new OffscreenCanvas(w, h); const g = c.getContext('2d'); g.drawImage(bmp, 0, 0, w, h); bmp.close?.();
    const px = g.getImageData(0, 0, w, h).data; data = new Uint8Array(w * h * comps);
    for (let k = 0; k < w * h; k++) { if (comps === 3) { data[k * 3] = px[k * 4]; data[k * 3 + 1] = px[k * 4 + 1]; data[k * 3 + 2] = px[k * 4 + 2]; } else data[k] = px[k * 4]; }
  } else {
    const bpc = numOf(dict.lookup(N('BitsPerComponent'))) ?? 8;
    if (bpc !== 8) throw new Unsupported(`${bpc}-bit image`);
    if (fname === 'FlateDecode') {
      data = L.decodePDFRawStream(stream).decode();
      const parms = deref(ctx, dict.lookup(N('DecodeParms')));
      const pred = parms instanceof PDFDict ? (numOf(parms.lookup(N('Predictor'))) || 1) : 1;
      if (pred >= 10) data = unpredictPng(data, numOf(parms.lookup(N('Columns'))) || w, numOf(parms.lookup(N('Colors'))) || comps, 8);
      else if (pred !== 1) throw new Unsupported('TIFF image predictor');
    } else if (!fname) data = stream.contents;
    else throw new Unsupported(`${fname} image`);
  }
  if (data.length < w * h * comps) throw new Unsupported('truncated image');
  return { w, h, comps, data };
}
// pixel mask of the marks in image space (full: image unit square -> user space)
function maskFor(w, h, full, marks) {
  const inv = invert(full); const c = new OffscreenCanvas(w, h); const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.strokeStyle = '#fff'; g.lineWidth = 2;
  for (const m of marks) {
    const pts = [[m[0], m[1]], [m[2], m[1]], [m[2], m[3]], [m[0], m[3]]].map(([x, y]) => { const [u, v] = apply(inv, x, y); return [u * w, (1 - v) * h]; });
    g.beginPath(); pts.forEach((p, k) => (k ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.closePath(); g.fill(); g.stroke();
  }
  const px = g.getImageData(0, 0, w, h).data; const out = new Uint8Array(w * h); let n = 0;
  for (let k = 0; k < w * h; k++) if (px[k * 4 + 3] > 0) { out[k] = 1; n++; }
  return { mask: out, n };
}
function newImageStream(ctx, dict, data, extra = {}) {
  const s = ctx.flateStream(data);
  for (const [k, v] of dict.entries()) { const n = k.decodeText(); if (n !== 'Filter' && n !== 'Length' && n !== 'DecodeParms' && n !== 'DL') s.dict.set(k, v); }
  s.dict.set(N('BitsPerComponent'), PDFNumber.of(8));
  for (const [k, v] of Object.entries(extra)) s.dict.set(N(k), v);
  return ctx.register(s);
}
async function redactImage(ctx, stream, full, marks, S) {
  const img = await decodeImage(ctx, stream);
  const { mask, n } = maskFor(img.w, img.h, full, marks);
  if (!n) return null;
  const { w, h, comps, data } = img; const out = data.slice(0, w * h * comps);
  for (let k = 0; k < w * h; k++) if (mask[k]) for (let c = 0; c < comps; c++) out[k * comps + c] = 0;
  const extra = {};
  const smRef = stream.dict.get(N('SMask')); const sm = deref(ctx, smRef);
  if (sm instanceof PDFStream) { // make the soft mask opaque there too, so the shape doesn't survive either
    const m = await decodeImage(ctx, sm, true);
    if (m.w !== w || m.h !== h) throw new Unsupported('soft mask size differs from image');
    const md = m.data.slice(0, w * h); for (let k = 0; k < w * h; k++) if (mask[k]) md[k] = 255;
    extra.SMask = newImageStream(ctx, sm.dict, md);
  }
  S.pixels += n; S.imagesEdited++;
  return newImageStream(ctx, stream.dict, out, extra);
}

/* ---------- content streams (recursive into form XObjects) ---------- */
function holder(ctx, resources) {
  let res = null, xo = null;
  const own = () => {
    if (res) return;
    res = resources instanceof PDFDict ? resources.clone(ctx) : ctx.obj({});
    const x = deref(ctx, res.get(N('XObject'))); xo = x instanceof PDFDict ? x.clone(ctx) : ctx.obj({}); res.set(N('XObject'), xo);
  };
  return {
    remove(name) { own(); xo.delete(N(name)); },
    add(ref) {
      own();
      let k = 1; while (xo.get(N('Rdx' + k))) k++;
      xo.set(N('Rdx' + k), ref); return 'Rdx' + k;
    },
    get resources() { return res || resources; }, get changed() { return !!res; }
  };
}
async function redactStream(ctx, src, resources, base, marks, S, depth) {
  const res = interpret(ctx, src, resources instanceof PDFDict ? resources : null, { paths: true });
  const edits = []; const touched = new Set(); const H = holder(ctx, resources);
  const opAt = new Map(res.ops.map(o => [o.start, o]));
  // text
  for (const rec of res.shows) {
    if (!rec.glyphs.length) continue;
    checkFont(rec);
    const M = mul(rec.m, base);
    const bb = boxM(base, rec.bbox[0], rec.bbox[1], rec.bbox[2], rec.bbox[3]);
    const pad = Math.abs(rec.size) * 2;
    if (!marks.some(m => overlaps([bb[0] - pad, bb[1] - pad, bb[2] + pad, bb[3] + pad], m))) continue;
    const removed = new Set();
    rec.glyphs.forEach((g, k) => { if (glyphHit(glyphBox(rec, g, M), marks)) removed.add(k); });
    if (!removed.size) continue;
    const op = opAt.get(rec.start);
    edits.push({ start: rec.start, end: rec.end, text: rewriteShow(rec, removed, op ? op.args : []) });
    touched.add(rec.start);
    for (const k of removed) { const u = rec.glyphs[k].u; if (u && u.trim()) { S.glyphs++; S.removedText += u; } }
    S.removedText += ' ';
  }
  // vector paths that lie entirely under a mark
  for (const p of res.paths) {
    if (p.clip || p.inText || p.start < 0) continue;
    const pts = p.segs.flatMap(sg => (sg.t === 're' ? sg.pts : [sg.p, sg.a].filter(Boolean)));
    if (!pts.length) continue;
    const curvy = p.segs.some(sg => sg.t === 'c');
    let bb = [Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))];
    bb = boxM(base, bb[0], bb[1], bb[2], bb[3]);
    const g = p.lw / 2 + (curvy ? 0.25 * Math.max(bb[2] - bb[0], bb[3] - bb[1]) : 0);
    bb = [bb[0] - g, bb[1] - g, bb[2] + g, bb[3] + g];
    if (marks.some(m => bb[0] >= m[0] && bb[1] >= m[1] && bb[2] <= m[2] && bb[3] <= m[3])) { edits.push({ start: p.start, end: p.end, text: ' ' }); S.paths++; }
  }
  // images and forms
  const xres = resources instanceof PDFDict ? deref(ctx, resources.get(N('XObject'))) : null;
  const dropped = new Set(); // XObject names whose Do was removed or redirected
  for (const x of res.xobjs) {
    const full = mul(x.ctm, base);
    const corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => apply(full, u, v));
    const ubb = [Math.min(...corners.map(q => q[0])), Math.min(...corners.map(q => q[1])), Math.max(...corners.map(q => q[0])), Math.max(...corners.map(q => q[1]))];
    const covered = marks.some(m => corners.every(q => inside(q, m)));
    if (x.op === 'BI') {
      if (!marks.some(m => overlaps(ubb, m))) continue;
      if (covered) { edits.push({ start: x.start, end: x.end, text: ' ' }); S.images++; continue; }
      throw new Unsupported('inline image partly under a mark');
    }
    const ref = xres instanceof PDFDict && x.name ? xres.get(N(x.name)) : null; const xo = deref(ctx, ref);
    if (!(xo instanceof PDFStream)) continue;
    const st = xo.dict.lookup(N('Subtype'))?.decodeText?.();
    if (st === 'Image') {
      if (!marks.some(m => overlaps(ubb, m))) continue;
      if (covered) { edits.push({ start: x.start, end: x.end, text: ' ' }); S.images++; dropped.add(x.name); continue; }
      const nref = await redactImage(ctx, xo, full, marks, S);
      if (nref) { edits.push({ start: x.start, end: x.end, text: `/${H.add(nref)} Do` }); dropped.add(x.name); }
    } else if (st === 'Form') {
      const fm = xo.dict.lookup(N('Matrix')); const mx = fm instanceof PDFArray && fm.size() >= 6 ? fm.asArray().slice(0, 6).map(v => numOf(deref(ctx, v)) ?? 0) : ID;
      const fbase = mul(mx, full);
      const bbA = xo.dict.lookup(N('BBox')); const b = bbA instanceof PDFArray ? bbA.asArray().map(v => numOf(deref(ctx, v)) ?? 0) : null;
      if (b && b.length >= 4 && !marks.some(m => overlaps(boxM(fbase, Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])), m))) continue;
      if (depth >= 8) throw new Unsupported('deeply nested form XObjects');
      const fres = deref(ctx, xo.dict.get(N('Resources'))) || resources;
      const r = await redactStream(ctx, bytesToStr(decodeStream(xo)), fres, fbase, marks, S, depth + 1);
      if (!r.changed) continue;
      const s = ctx.flateStream(strToBytes(r.src));
      for (const [k, v] of xo.dict.entries()) { const n = k.decodeText(); if (n !== 'Filter' && n !== 'Length' && n !== 'DecodeParms' && n !== 'DL') s.dict.set(k, v); }
      if (r.resources && r.resources !== fres) s.dict.set(N('Resources'), r.resources);
      else if (fres && !xo.dict.get(N('Resources'))) s.dict.set(N('Resources'), fres);
      edits.push({ start: x.start, end: x.end, text: `/${H.add(ctx.register(s))} Do` });
      dropped.add(x.name); S.forms++;
    }
  }
  // marked-content ActualText/Alt around removed text would still reveal it: drop those properties
  if (touched.size) {
    const recs = []; const st2 = [];
    for (const o of res.ops) {
      if (o.op === 'BDC' || o.op === 'BMC') { const r = { o, hit: false }; recs.push(r); st2.push(r); }
      else if (o.op === 'EMC') st2.pop();
      else if (touched.has(o.start)) st2.forEach(s => { s.hit = true; });
    }
    for (const r of recs) {
      if (!r.hit || r.o.op !== 'BDC') continue;
      const [tag, props] = r.o.args;
      if (!props || typeof props !== 'object' || Array.isArray(props) || props instanceof Name) continue;
      if (!('ActualText' in props || 'Alt' in props || 'E' in props)) continue;
      const t = tag && tag.n ? tag.n : 'Span'; const mcid = typeof props.MCID === 'number' ? props.MCID : null;
      edits.push({ start: r.o.start, end: r.o.end, text: mcid != null ? `/${t} <</MCID ${mcid}>> BDC` : `/${t} BMC` });
      S.altText++;
    }
  }
  if (!edits.length && !H.changed) return { changed: false, src, resources };
  edits.sort((a, b) => a.start - b.start);
  let out = '', at = 0;
  for (const e of edits) { if (e.start < at) continue; out += src.slice(at, e.start) + ' ' + e.text + ' '; at = e.end; }
  out += src.slice(at);
  // the unredacted originals must not stay reachable through the resource dictionary
  if (dropped.size) {
    const used = new Set(); const re = /\/([^\s/[\]<>(){}%]+)\s+Do\b/g; let m;
    while ((m = re.exec(out))) used.add(m[1].replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
    for (const n of dropped) if (!used.has(n)) H.remove(n);
  }
  return { changed: true, src: out, resources: H.resources };
}

// Remove everything under `marks` (user-space rects) from one pdf-lib page. Throws Unsupported when
// the page can't be redacted precisely (the caller then rasterizes it).
export async function redactPageContent(pdf, page, marks) {
  const ctx = pdf.context;
  const S = { glyphs: 0, removedText: '', paths: 0, images: 0, imagesEdited: 0, pixels: 0, forms: 0, altText: 0 };
  const res = pageResources(page);
  const r = await redactStream(ctx, pageContentString(page), res, ID, marks, S, 0);
  if (r.changed) { setPageContent(page, r.src); if (r.resources && r.resources !== res) page.node.set(N('Resources'), r.resources); }
  return S;
}

// Independent check with pdf.js: is any character still positioned under a mark?
export async function leakCheck(pjPage, marks) {
  const tc = await pjPage.getTextContent(); const leaks = [];
  const helv = L.StandardFontEmbedder.for(L.StandardFonts.Helvetica);
  const wOf = ch => { try { return helv.widthOfTextAtSize(ch, 1) || 0.5; } catch (e) { return 0.5; } };
  for (const it of tc.items) {
    if (!it.str || !it.str.trim() || !it.transform) continue;
    const T = it.transform; const sx = Math.hypot(T[0], T[1]) || 1, fh = Math.hypot(T[2], T[3]) || sx;
    const ux = T[0] / sx, uy = T[1] / sx;
    const chars = [...it.str]; const ws = chars.map(wOf); const tot = ws.reduce((a, b) => a + b, 0) || 1;
    const width = it.width || tot * sx;
    let cum = 0;
    chars.forEach((ch, k) => {
      const mid = (cum + ws[k] / 2) / tot * width; cum += ws[k];
      if (!ch.trim()) return;
      const c = [T[4] + ux * mid - uy * 0.3 * fh, T[5] + uy * mid + ux * 0.3 * fh];
      for (const m of marks) {
        const dx = Math.min(0.35 * fh, (m[2] - m[0]) / 2 - 0.05), dy = Math.min(0.25 * fh, (m[3] - m[1]) / 2 - 0.05);
        if (dx <= 0 || dy <= 0) continue;
        if (c[0] > m[0] + dx && c[0] < m[2] - dx && c[1] > m[1] + dy && c[1] < m[3] - dy) { leaks.push(ch); break; }
      }
    });
  }
  return leaks;
}

/* ================= Find & Redact ================= */
// Glyphs of a page in content order, with user-space boxes and baseline geometry.
async function walkGlyphs(ctx, src, resources, base, out, depth) {
  const res = interpret(ctx, src, resources instanceof PDFDict ? resources : null);
  const xres = resources instanceof PDFDict ? deref(ctx, resources.get(N('XObject'))) : null;
  let si = 0;
  const emitShows = upto => {
    while (si < res.shows.length && res.shows[si].start < upto) {
      const rec = res.shows[si++]; if (!rec.fi || !rec.glyphs.length) continue;
      const M = mul(rec.m, base);
      const o = apply(M, 0, 0), e1 = apply(M, 1, 0), e2 = apply(M, 0, 1);
      const ul = Math.hypot(e1[0] - o[0], e1[1] - o[1]) || 1; const dir = [(e1[0] - o[0]) / ul, (e1[1] - o[1]) / ul];
      const h = Math.hypot(e2[0] - o[0], e2[1] - o[1]) * Math.abs(rec.size) || 1;
      for (const g of rec.glyphs) out.push({ u: g.u, box: glyphBox(rec, g, M), p0: apply(M, g.x, rec.Ts), p1: apply(M, g.x + g.adv, rec.Ts), dir, h });
    }
  };
  for (const x of res.xobjs) {
    emitShows(x.start);
    if (x.op !== 'Do' || depth >= 8 || !(xres instanceof PDFDict) || !x.name) continue;
    const xo = deref(ctx, xres.get(N(x.name)));
    if (!(xo instanceof PDFStream) || xo.dict.lookup(N('Subtype'))?.decodeText?.() !== 'Form') continue;
    const fm = xo.dict.lookup(N('Matrix')); const mx = fm instanceof PDFArray && fm.size() >= 6 ? fm.asArray().slice(0, 6).map(v => numOf(deref(ctx, v)) ?? 0) : ID;
    try { await walkGlyphs(ctx, bytesToStr(decodeStream(xo)), deref(ctx, xo.dict.get(N('Resources'))) || resources, mul(mx, mul(x.ctm, base)), out, depth + 1); } catch (e) { /* skip broken forms */ }
  }
  emitShows(Infinity);
}
// -> {str, map: char index -> glyph index (-1 synthetic), glyphs}
export async function pageText(pdf, i) {
  const page = pdf.getPage(i); const glyphs = [];
  await walkGlyphs(pdf.context, pageContentString(page), pageResources(page), ID, glyphs, 0);
  let str = ''; const map = []; let prev = null;
  for (let k = 0; k < glyphs.length; k++) {
    const g = glyphs[k];
    if (prev) {
      const dx = g.p0[0] - prev.p1[0], dy = g.p0[1] - prev.p1[1];
      const along = dx * prev.dir[0] + dy * prev.dir[1], perp = -dx * prev.dir[1] + dy * prev.dir[0];
      const ws = /\s$/.test(str);
      if (Math.abs(perp) > 0.5 * Math.min(prev.h, g.h) || along < -prev.h * 1.5) { if (!ws) { str += '\n'; map.push(-1); } }
      else if (along > 0.22 * Math.min(prev.h, g.h) && !ws && !/^\s/.test(g.u)) { str += ' '; map.push(-1); }
    }
    for (const ch of g.u) { str += ch; map.push(k); }
    prev = g;
  }
  return { str, map, glyphs };
}
// Boxes (one per text line) covering chars [s, e)
export function matchRects(pt, s, e) {
  const lines = []; let cur = null, last = null;
  for (let c = s; c < e; c++) {
    const k = pt.map[c]; if (k < 0 || k === last) continue; last = k;
    const g = pt.glyphs[k]; if (!g.u.trim()) continue;
    const b = g.box;
    if (cur && Math.abs((b[1] + b[3]) / 2 - (cur[1] + cur[3]) / 2) < 0.5 * g.h && b[0] <= cur[2] + g.h * 1.5) { cur[0] = Math.min(cur[0], b[0]); cur[1] = Math.min(cur[1], b[1]); cur[2] = Math.max(cur[2], b[2]); cur[3] = Math.max(cur[3], b[3]); }
    else { cur = b.slice(); lines.push(cur); }
  }
  return lines.map(r => [r[0] - 0.4, r[1] - 0.4, r[2] + 0.4, r[3] + 0.4]);
}
const luhn = digits => { let s = 0, alt = false; for (let i = digits.length - 1; i >= 0; i--) { let n = +digits[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } s += n; alt = !alt; } return s % 10 === 0; };
const MON = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
export const PATTERNS = {
  email: { label: 'Email addresses', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  phone: { label: 'Phone numbers', re: /(?<![\w+])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\d{2,4}[\s.-])\d{3,4}[\s.-]?\d{3,4}(?![\w-])/g, test: m => { const d = m.replace(/\D/g, ''); return d.length >= 10 && d.length <= 15; } },
  ssn: { label: 'US Social Security numbers', re: /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g },
  card: { label: 'Credit card numbers', re: /(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g, test: m => { const d = m.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d); } },
  date: { label: 'Dates', re: new RegExp(`(?<![\\w/.-])(?:\\d{1,2}[/.-]\\d{1,2}[/.-](?:\\d{4}|\\d{2})|\\d{4}-\\d{2}-\\d{2}|${MON}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\d{1,2}(?:st|nd|rd|th)?\\s+${MON}\\.?,?\\s+\\d{4})(?![\\w/-])`, 'gi') },
  money: { label: 'Currency amounts', re: /(?:[$€£¥]\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{2})?\s?(?:USD|EUR|GBP|CAD|AUD)\b)/g },
  url: { label: 'Web addresses (URLs)', re: /\b(?:https?:\/\/|www\.)[^\s<>"')]+[^\s<>"').,;:]/gi }
};
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// opts: {terms:[..], patterns:[keys], matchCase, word, regex, pages:[indices]}
export async function findForRedaction(bytes, opts) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  const res = []; const n = pdf.getPageCount();
  const pages = opts.pages || [...Array(n).keys()];
  const res2 = [];
  for (const t of opts.terms || []) {
    if (!t.trim()) continue;
    let src = opts.regex ? t : t.trim().split(/\s+/).map(escRe).join('\\s*');
    if (opts.word && !opts.regex) src = `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
    try { res2.push({ kind: 'term', label: t, re: new RegExp(src, 'gu' + (opts.matchCase ? '' : 'i')) }); } catch (e) { throw new Error(`“${t}” is not a valid regular expression: ${e.message}`); }
  }
  for (const k of opts.patterns || []) if (PATTERNS[k]) res2.push({ kind: k, label: PATTERNS[k].label, re: new RegExp(PATTERNS[k].re.source, PATTERNS[k].re.flags), test: PATTERNS[k].test });
  for (const i of pages) {
    if (i < 0 || i >= n) continue;
    let pt; try { pt = await pageText(pdf, i); } catch (e) { continue; }
    const taken = [];
    for (const r of res2) {
      r.re.lastIndex = 0; let m;
      while ((m = r.re.exec(pt.str))) {
        if (!m[0].length) { r.re.lastIndex++; continue; }
        let s = m.index, e = s + m[0].length;
        while (s < e && /\s/.test(pt.str[s])) s++; while (e > s && /\s/.test(pt.str[e - 1])) e--;
        const text = pt.str.slice(s, e);
        if (r.test && !r.test(text)) continue;
        if (taken.some(([a, b]) => s < b && e > a)) continue;
        const rects = matchRects(pt, s, e); if (!rects.length) continue;
        taken.push([s, e]);
        res.push({ page: i, start: s, end: e, text, kind: r.label, rects, before: pt.str.slice(Math.max(0, s - 28), s).replace(/\s+/g, ' '), after: pt.str.slice(e, e + 28).replace(/\s+/g, ' ') });
      }
    }
  }
  res.sort((a, b) => a.page - b.page || a.start - b.start);
  return res;
}
// Turn search hits into redaction marks (one undo step).
export function markMatches(matches) {
  const d = App.doc; if (!d || !matches.length) return 0;
  for (const m of matches) d.state.annots.push({ id: uid(), type: 'redact', page: d.state.pageIds[m.page], rects: m.rects, color: '#000000', opacity: 1, quote: m.text, author: App.author, date: new Date().toISOString(), replies: [], contents: m.kind });
  d.commit(`Mark ${matches.length} search result${matches.length > 1 ? 's' : ''} for redaction`);
  drawAllAnnots();
  return matches.length;
}
export function findRedactDialog(after) {
  const d = App.doc; if (!d) return;
  const last = prefs.get('findRedact', { terms: '', patterns: ['email', 'phone', 'ssn', 'card'], matchCase: false, word: true, regex: false });
  Aero.dialog({
    title: 'Find & redact', width: 520,
    instruction: 'Search for words, phrases or kinds of sensitive information and mark every match for redaction',
    fields: [
      { key: 'terms', label: 'Words or phrases (one per line)', type: 'textarea', value: last.terms },
      ...Object.entries(PATTERNS).map(([k, p]) => ({ key: 'p_' + k, label: p.label, type: 'checkbox', value: last.patterns.includes(k) })),
      { key: 'matchCase', label: 'Match case', type: 'checkbox', value: last.matchCase },
      { key: 'word', label: 'Whole words only', type: 'checkbox', value: last.word },
      { key: 'regex', label: 'Treat lines as regular expressions', type: 'checkbox', value: last.regex },
      { key: 'pages', label: 'Pages', type: 'text', value: 'all' }
    ],
    ok: 'Search',
    onOK: async v => {
      const terms = String(v.terms || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      const patterns = Object.keys(PATTERNS).filter(k => v['p_' + k]);
      prefs.set('findRedact', { terms: v.terms, patterns, matchCase: !!v.matchCase, word: !!v.word, regex: !!v.regex });
      if (!terms.length && !patterns.length) { Aero.alert('Find & redact', 'Enter a word or phrase, or tick at least one kind of information.'); return; }
      Aero.busy('Searching…');
      let found;
      try { found = await findForRedaction(d.state.bytes, { terms, patterns, matchCase: !!v.matchCase, word: !!v.word, regex: !!v.regex, pages: parseRanges(v.pages, d.numPages) }); }
      catch (e) { Aero.busy(); Aero.alert('Find & redact', e.message); return; }
      Aero.busy();
      if (!found.length) { Aero.alert('Find & redact', 'No matches were found.'); return; }
      resultsDialog(found, after);
    }
  });
}
function resultsDialog(found, after) {
  const MAX = 500; const shown = found.slice(0, MAX);
  const html = `<div class="fr-head"><span>${found.length} match${found.length > 1 ? 'es' : ''} — untick any you want to keep</span><span><a href="#" data-a="all">All</a> · <a href="#" data-a="none">None</a></span></div>
    <div class="fr-list">${shown.map((m, k) => `<label class="fr-row"><input type="checkbox" data-k="${k}" checked><span class="fr-pg">p.${m.page + 1}</span><span class="fr-ctx">${esc(m.before)}<b>${esc(m.text)}</b>${esc(m.after)}</span><span class="fr-kind">${esc(m.kind)}</span></label>`).join('')}</div>
    ${found.length > MAX ? `<div class="dnote">Only the first ${MAX} matches are listed; all ${found.length} will be marked.</div>` : ''}`;
  let root = null;
  const dlg = Aero.dialog({
    title: 'Find & redact — results', width: 640, html, ok: 'Mark for Redaction',
    onOK: () => {
      const off = new Set([...(root?.querySelectorAll('input:not(:checked)') || [])].map(i => +i.dataset.k));
      const pick = found.filter((_, k) => !off.has(k));
      const n = markMatches(pick);
      if (n) Aero.toast(`${n} match${n > 1 ? 'es' : ''} marked for redaction — review them, then choose Apply Redactions`, 5000);
      after?.(n);
    }
  });
  root = dlg.el.querySelector('.fr-list');
  setTimeout(() => {
    const head = dlg.el.querySelector('.fr-head');
    head?.addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (!a) return; e.preventDefault(); root?.querySelectorAll('input').forEach(i => { i.checked = a.dataset.a === 'all'; }); });
  }, 0);
  return dlg;
}
