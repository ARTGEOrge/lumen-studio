// Writes the document model into a real PDF with pdf-lib: form values, document properties,
// annotations as genuine PDF annotations with appearance streams, page-content items, optional flattening.
import { hex2rgb, rgbOp, f2, normRect, localFrame, dataUrlToBytes, quadBox } from './util.js';
import { annotRect, wrapText, inkSegments, lineGeo, squigglyPath, pressureWidth, ASCENT, LEADING, MARKUP } from './annots.js';
const L = window.PDFLib;
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFHexString, PDFString, PDFStream, StandardFonts, PDFBool } = L;

const SUBTYPE = { highlight: 'Highlight', underline: 'Underline', strike: 'StrikeOut', squiggly: 'Squiggly', note: 'Text', ink: 'Ink', rect: 'Square', ellipse: 'Circle', line: 'Line', arrow: 'Line', freetext: 'FreeText', stamp: 'Stamp', image: 'Stamp', redact: 'Redact' };
const FONT_STD = {
  Helvetica: [StandardFonts.Helvetica, StandardFonts.HelveticaBold], Times: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold], Courier: [StandardFonts.Courier, StandardFonts.CourierBold]
};

export class PdfWriter {
  constructor(pdf) { this.pdf = pdf; this.ctx = pdf.context; this.fonts = {}; this.imgs = new Map(); this.encCache = new Map(); this.n = 0; }
  async font(fam = 'Helvetica', bold = false) {
    const k = fam + (bold ? 'B' : '');
    if (!this.fonts[k]) this.fonts[k] = await this.pdf.embedFont((FONT_STD[fam] || FONT_STD.Helvetica)[bold ? 1 : 0]);
    return this.fonts[k];
  }
  // Replace characters the standard (WinAnsi) font can't encode
  clean(font, text) {
    let out = '';
    for (const ch of String(text ?? '')) {
      const key = font.name + ch;
      let ok = this.encCache.get(key);
      if (ok === undefined) { try { font.encodeText(ch); ok = true; } catch (e) { ok = false; } this.encCache.set(key, ok); }
      out += ok ? ch : (ch === '\t' ? '    ' : '?');
    }
    return out;
  }
  hex(font, text) { return font.encodeText(this.clean(font, text)).toString(); }
  async image(dataUrl) {
    if (this.imgs.has(dataUrl)) return this.imgs.get(dataUrl);
    const d = dataUrlToBytes(dataUrl); if (!d) throw new Error('Bad image data');
    const img = /jpe?g/i.test(d.mime) ? await this.pdf.embedJpg(d.bytes) : await this.pdf.embedPng(d.bytes);
    this.imgs.set(dataUrl, img); return img;
  }
  gs(op, multiply) { return this.ctx.obj({ Type: 'ExtGState', CA: op, ca: op, ...(multiply ? { BM: 'Multiply' } : {}) }); }

  // Appearance stream for an annotation, in page user space. Returns {bbox, ops, res}
  async appearance(a) {
    const c = rgbOp(a.color || '#000000'), op = a.opacity ?? 1;
    const res = { ExtGState: {}, Font: {}, XObject: {} };
    let ops = 'q ';
    const bbox = annotRect(a);
    const useGS = (multiply) => { res.ExtGState.GS0 = this.gs(op, multiply); ops += '/GS0 gs '; };
    switch (a.type) {
      case 'highlight':
        useGS(true); ops += `${c} rg `;
        for (const q of a.quads) ops += `${f2(q[0])} ${f2(q[1])} m ${f2(q[2])} ${f2(q[3])} l ${f2(q[6])} ${f2(q[7])} l ${f2(q[4])} ${f2(q[5])} l h f `;
        break;
      case 'underline': case 'strike': case 'squiggly': {
        if (op < 1) useGS(false);
        ops += `${c} RG 1 J `;
        for (const q of a.quads) {
          const ul = [q[0], q[1]], ur = [q[2], q[3]], ll = [q[4], q[5]], lr = [q[6], q[7]];
          const h = Math.hypot(ul[0] - ll[0], ul[1] - ll[1]); const nx = (ul[0] - ll[0]) / (h || 1), ny = (ul[1] - ll[1]) / (h || 1);
          ops += `${f2(Math.max(0.6, h / 14))} w `;
          if (a.type === 'strike') ops += `${f2((ul[0] + ll[0]) / 2)} ${f2((ul[1] + ll[1]) / 2)} m ${f2((ur[0] + lr[0]) / 2)} ${f2((ur[1] + lr[1]) / 2)} l S `;
          else if (a.type === 'underline') { const o = h * 0.08; ops += `${f2(ll[0] + nx * o)} ${f2(ll[1] + ny * o)} m ${f2(lr[0] + nx * o)} ${f2(lr[1] + ny * o)} l S `; }
          else ops += squigglyPath(ll, lr, h).map((p, i) => `${f2(p[0])} ${f2(p[1])} ${i ? 'l' : 'm'}`).join(' ') + ' S ';
        }
        break;
      }
      case 'note': {
        if (op < 1) useGS(false);
        const x = a.x, y = a.y;
        ops += `1 w 1 j 0.23 0.23 0.23 RG ${c} rg ${x + 2} ${y - 2} m ${x + 18} ${y - 2} l ${x + 18} ${y - 14} l ${x + 9} ${y - 14} l ${x + 5} ${y - 18.5} l ${x + 6} ${y - 14} l ${x + 2} ${y - 14} l h B `;
        ops += `0.33 0.33 0.33 RG ${x + 5} ${y - 5.5} m ${x + 15} ${y - 5.5} l S ${x + 5} ${y - 8.5} m ${x + 15} ${y - 8.5} l S ${x + 5} ${y - 11.5} m ${x + 12} ${y - 11.5} l S `;
        break;
      }
      case 'ink': {
        if (op < 1) useGS(false);
        ops += `1 J 1 j ${c} RG ${c} rg `;
        for (const st of a.strokes) {
          if (st.length === 1) { const r = pressureWidth(a.width, st[0][2]) / 2; ops += ellipsePath(st[0][0] - r, st[0][1] - r, st[0][0] + r, st[0][1] + r) + 'f '; continue; }
          for (const seg of inkSegments(st, a.width)) ops += `${f2(seg.w)} w ` + seg.pts.map((p, i) => `${f2(p[0])} ${f2(p[1])} ${i ? 'l' : 'm'}`).join(' ') + ' S ';
        }
        break;
      }
      case 'rect': case 'ellipse': {
        if (op < 1) useGS(false);
        const [x1, y1, x2, y2] = normRect(a.rect), w = a.width ?? 2, i = w / 2;
        const paint = a.fill && w > 0 ? 'B' : a.fill ? 'f' : w > 0 ? 'S' : 'n';
        ops += `${f2(w)} w ${c} RG ${a.fill ? rgbOp(a.fill) + ' rg ' : ''}`;
        ops += a.type === 'rect' ? `${f2(x1 + i)} ${f2(y1 + i)} ${f2(Math.max(0, x2 - x1 - w))} ${f2(Math.max(0, y2 - y1 - w))} re ${paint} ` : ellipsePath(x1 + i, y1 + i, x2 - i, y2 - i) + paint + ' ';
        break;
      }
      case 'line': case 'arrow': {
        if (op < 1) useGS(false);
        const w = a.width ?? 2, g = lineGeo(a);
        ops += `${f2(w)} w ${a.type === 'arrow' ? 0 : 1} J ${c} RG ${c} rg ${f2(a.p1[0])} ${f2(a.p1[1])} m ${f2(g.end[0])} ${f2(g.end[1])} l S `;
        if (g.head) ops += `${f2(w * 0.5)} w 0 j ` + g.head.map((p, k) => `${f2(p[0])} ${f2(p[1])} ${k ? 'l' : 'm'}`).join(' ') + ' h B ';
        break;
      }
      case 'freetext': {
        if (op < 1) useGS(false);
        const font = await this.font(a.font, a.bold); res.Font.F1 = font.ref;
        const size = a.size || 12, bw = a.bw || 0, pad = 2 + bw;
        const lf = localFrame(a.rect, a.rot || 0);
        ops += `${lf.m.map(f2).join(' ')} cm `;
        if (a.fill) ops += `${rgbOp(a.fill)} rg 0 0 ${f2(lf.w)} ${f2(lf.h)} re f `;
        if (bw) ops += `${f2(bw)} w ${rgbOp(a.bcolor || a.color)} RG ${f2(bw / 2)} ${f2(bw / 2)} ${f2(lf.w - bw)} ${f2(lf.h - bw)} re S `;
        const measure = t => font.widthOfTextAtSize(this.clean(font, t), size);
        const lines = wrapText(a.text || '', Math.max(4, lf.w - pad * 2), measure);
        ops += `${f2(pad)} ${f2(pad)} ${f2(Math.max(0, lf.w - pad * 2))} ${f2(Math.max(0, lf.h - pad * 2 + size * 0.3))} re W n BT /F1 ${f2(size)} Tf ${c} rg `;
        lines.forEach((ln, k) => {
          const lw = measure(ln), avail = lf.w - pad * 2;
          const x = pad + (a.align === 'center' ? (avail - lw) / 2 : a.align === 'right' ? avail - lw : 0);
          const y = lf.h - pad - ASCENT * size - k * size * LEADING;
          ops += `1 0 0 1 ${f2(x)} ${f2(y)} Tm ${this.hex(font, ln)} Tj `;
        });
        ops += 'ET ';
        break;
      }
      case 'stamp': {
        if (op < 1) useGS(false);
        const fb = await this.font('Helvetica', true), fr = await this.font('Helvetica', false); res.Font.F1 = fb.ref; res.Font.F2 = fr.ref;
        const lf = localFrame(a.rect, a.rot || 0); const bw = Math.max(1.5, lf.h * 0.06), rad = lf.h * 0.16;
        const label = this.clean(fb, a.label || ''), sub = this.clean(fr, a.sub || '');
        const size = Math.min(lf.h * (sub ? 0.48 : 0.6), (lf.w - 14) / Math.max(0.01, fb.widthOfTextAtSize(label, 1)));
        const subSize = Math.min(lf.h * 0.17, (lf.w - 14) / Math.max(0.01, fr.widthOfTextAtSize(sub, 1)));
        res.ExtGState.GS1 = this.gs(0.07 * op, false);
        ops += `${lf.m.map(f2).join(' ')} cm q /GS1 gs ${c} rg ${rrect(bw / 2, bw / 2, lf.w - bw, lf.h - bw, rad)} f Q ${f2(bw)} w ${c} RG ${rrect(bw / 2, bw / 2, lf.w - bw, lf.h - bw, rad)} S `;
        const ty = sub ? lf.h - lf.h * 0.52 : lf.h / 2 - size * 0.36;
        ops += `BT ${c} rg /F1 ${f2(size)} Tf 1 0 0 1 ${f2((lf.w - fb.widthOfTextAtSize(label, size)) / 2)} ${f2(ty)} Tm ${fb.encodeText(label)} Tj `;
        if (sub) ops += `/F2 ${f2(subSize)} Tf 1 0 0 1 ${f2((lf.w - fr.widthOfTextAtSize(sub, subSize)) / 2)} ${f2(lf.h - lf.h * 0.8)} Tm ${fr.encodeText(sub)} Tj `;
        ops += 'ET ';
        break;
      }
      case 'image': {
        if (op < 1) useGS(false);
        const img = await this.image(a.dataUrl); res.XObject.Im0 = img.ref;
        const lf = localFrame(a.rect, a.rot || 0);
        ops += `${lf.m.map(f2).join(' ')} cm ${f2(lf.w)} 0 0 ${f2(lf.h)} 0 0 cm /Im0 Do `;
        break;
      }
      case 'redact':
        ops += '1 w 0.82 0.06 0.06 RG ' + a.rects.map(r => { const [x1, y1, x2, y2] = normRect(r); return `${f2(x1)} ${f2(y1)} ${f2(x2 - x1)} ${f2(y2 - y1)} re S`; }).join(' ') + ' ';
        break;
    }
    ops += 'Q';
    for (const k of Object.keys(res)) if (!Object.keys(res[k]).length) delete res[k];
    return { bbox, ops, res };
  }
  async xobject(a) {
    const ap = await this.appearance(a);
    const stream = this.ctx.flateStream(ap.ops, { Type: 'XObject', Subtype: 'Form', BBox: ap.bbox.map(v => +f2(v)), Resources: ap.res });
    return { ref: this.ctx.register(stream), bbox: ap.bbox };
  }
  // Draw annotation appearance into the page content (flatten / page-content items)
  async burn(page, a) {
    const { ref } = await this.xobject(a);
    const name = page.node.newXObject('LumenAp', ref);
    page.pushOperators(L.pushGraphicsState(), L.drawObject(name), L.popGraphicsState());
  }
  // Add as a real PDF annotation
  async annotate(page, a) {
    const { ref: apRef, bbox } = await this.xobject(a);
    const rgb = hex2rgb(a.color || '#000000');
    const date = a.date ? new Date(a.date) : new Date();
    const d = {
      Type: 'Annot', Subtype: SUBTYPE[a.type], Rect: bbox.map(v => +f2(v)), F: a.type === 'note' ? 28 : 4, P: page.ref,
      NM: PDFHexString.fromText(a.id), M: PDFString.fromDate(isNaN(date) ? new Date() : date), CreationDate: PDFString.fromDate(isNaN(date) ? new Date() : date),
      T: PDFHexString.fromText(a.author || ''), C: rgb, CA: a.opacity ?? 1, AP: { N: apRef }
    };
    if (a.contents) d.Contents = PDFHexString.fromText(a.contents);
    const extra = { rot: a.rot || 0 };
    switch (a.type) {
      case 'highlight': case 'underline': case 'strike': case 'squiggly': d.QuadPoints = a.quads.flat().map(v => +f2(v)); d.Subj = PDFHexString.fromText(SUBTYPE[a.type]); break;
      case 'note': d.Name = 'Comment'; d.Open = false; break;
      case 'ink': d.InkList = a.strokes.map(s => s.flatMap(p => [+f2(p[0]), +f2(p[1])])); d.BS = { W: a.width, S: 'S' }; extra.p = a.strokes.map(s => s.map(p => Math.round((p[2] ?? 0.5) * 100) / 100)); extra.w = a.width; break;
      case 'rect': case 'ellipse': d.BS = { W: a.width ?? 2, S: 'S' }; if (a.fill) d.IC = hex2rgb(a.fill); break;
      case 'line': case 'arrow': d.L = [...a.p1, ...a.p2].map(v => +f2(v)); d.BS = { W: a.width ?? 2, S: 'S' }; d.LE = ['None', a.type === 'arrow' ? 'ClosedArrow' : 'None']; if (a.type === 'arrow') d.IC = rgb; break;
      case 'freetext': {
        d.Contents = PDFHexString.fromText(a.text || '');
        d.DA = PDFString.of(`/Helv ${f2(a.size || 12)} Tf ${rgbOp(a.color || '#000000')} rg`);
        d.Q = a.align === 'center' ? 1 : a.align === 'right' ? 2 : 0;
        d.BS = { W: a.bw || 0, S: 'S' };
        if (a.fill) d.IC = hex2rgb(a.fill);
        if (a.bw) d.C = hex2rgb(a.bcolor || a.color); else delete d.C;
        if (a.rot) d.Rotate = a.rot;
        Object.assign(extra, { size: a.size, font: a.font, bold: !!a.bold, fill: a.fill || null, bw: a.bw || 0, bcolor: a.bcolor || null, color: a.color, align: a.align || 'left' });
        break;
      }
      case 'stamp': d.Name = stampName(a.label); Object.assign(extra, { label: a.label, sub: a.sub || '', color: a.color }); if (a.rot) d.Rotate = a.rot; break;
      case 'image': d.Name = a.sig ? 'SignHere' : 'Image'; Object.assign(extra, { image: a.dataUrl, sig: !!a.sig }); if (a.rot) d.Rotate = a.rot; break;
      case 'redact': d.QuadPoints = a.rects.flatMap(r => { const [x1, y1, x2, y2] = normRect(r); return [x1, y2, x2, y2, x1, y1, x2, y1]; }).map(v => +f2(v)); d.IC = [0, 0, 0]; break;
    }
    d.LumenData = PDFHexString.fromText(JSON.stringify(extra));
    const ref = this.ctx.register(this.ctx.obj(d));
    page.node.addAnnot(ref);
    // replies -> Text annotations in reply to this one
    for (const r of a.replies || []) {
      const rd = new Date(r.date || Date.now());
      const rref = this.ctx.register(this.ctx.obj({
        Type: 'Annot', Subtype: 'Text', Rect: bbox.map(v => +f2(v)).slice(0, 2).concat(bbox.slice(0, 2).map(v => +f2(v + 20))), F: 28, P: page.ref,
        IRT: ref, RT: 'R', Name: 'Comment', Open: false, C: rgb, NM: PDFHexString.fromText(r.id), T: PDFHexString.fromText(r.author || ''),
        Contents: PDFHexString.fromText(r.text || ''), M: PDFString.fromDate(isNaN(rd) ? new Date() : rd), CreationDate: PDFString.fromDate(isNaN(rd) ? new Date() : rd)
      }));
      page.node.addAnnot(rref);
    }
    return ref;
  }
}
const stampName = l => ({ APPROVED: 'Approved', DRAFT: 'Draft', CONFIDENTIAL: 'Confidential', FINAL: 'Final', 'NOT APPROVED': 'NotApproved', VOID: 'Void', 'FOR COMMENT': 'ForComment', 'SIGN HERE': 'SignHere' })[String(l).toUpperCase()] || 'Draft';

const K = 0.5523;
export function ellipsePath(x1, y1, x2, y2) {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2, ox = rx * K, oy = ry * K;
  const n = f2;
  return `${n(cx - rx)} ${n(cy)} m ${n(cx - rx)} ${n(cy + oy)} ${n(cx - ox)} ${n(cy + ry)} ${n(cx)} ${n(cy + ry)} c ${n(cx + ox)} ${n(cy + ry)} ${n(cx + rx)} ${n(cy + oy)} ${n(cx + rx)} ${n(cy)} c ` +
    `${n(cx + rx)} ${n(cy - oy)} ${n(cx + ox)} ${n(cy - ry)} ${n(cx)} ${n(cy - ry)} c ${n(cx - ox)} ${n(cy - ry)} ${n(cx - rx)} ${n(cy - oy)} ${n(cx - rx)} ${n(cy)} c h `;
}
function rrect(x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2); const k = r * (1 - K), n = f2;
  return `${n(x + r)} ${n(y)} m ${n(x + w - r)} ${n(y)} l ${n(x + w - k)} ${n(y)} ${n(x + w)} ${n(y + k)} ${n(x + w)} ${n(y + r)} c ${n(x + w)} ${n(y + h - r)} l ${n(x + w)} ${n(y + h - k)} ${n(x + w - k)} ${n(y + h)} ${n(x + w - r)} ${n(y + h)} c ` +
    `${n(x + r)} ${n(y + h)} l ${n(x + k)} ${n(y + h)} ${n(x)} ${n(y + h - k)} ${n(x)} ${n(y + h - r)} c ${n(x)} ${n(y + r)} l ${n(x)} ${n(y + k)} ${n(x + k)} ${n(y)} ${n(x + r)} ${n(y)} c h `;
}

// Remove objects not reachable from the trailer (deleted pages, replaced content, redacted data...)
export function gc(pdf) {
  const ctx = pdf.context, seen = new Set(), stack = [];
  const t = ctx.trailerInfo; [t.Root, t.Info, t.Encrypt].forEach(o => o && stack.push(o));
  while (stack.length) {
    let o = stack.pop();
    if (o instanceof PDFRef) { if (seen.has(o.tag)) continue; seen.add(o.tag); o = ctx.lookup(o); if (!o) continue; }
    if (o instanceof PDFDict) { for (const [, v] of o.entries()) stack.push(v); }
    else if (o instanceof PDFArray) { for (const v of o.asArray()) stack.push(v); }
    else if (o instanceof PDFStream) { for (const [, v] of o.dict.entries()) stack.push(v); }
  }
  let removed = 0;
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) { ctx.delete(ref); removed++; }
  return removed;
}

export function applyForm(pdf, values, warnings) {
  const names = Object.keys(values || {});
  if (!names.length) return null;
  const form = pdf.getForm();
  for (const name of names) {
    const v = values[name];
    let f; try { f = form.getField(name); } catch (e) { warnings.push(`Field "${name}" not found`); continue; }
    try {
      if (f instanceof L.PDFTextField) f.setText(v ? String(v) : '');
      else if (f instanceof L.PDFCheckBox) v ? f.check() : f.uncheck();
      else if (f instanceof L.PDFRadioGroup) { if (!v || v === 'Off') f.clear(); else { const opts = f.getOptions(); f.select(opts.includes(v) ? v : opts.find(o => o.toLowerCase() === String(v).toLowerCase()) ?? v); } }
      else if (f instanceof L.PDFDropdown) { if (!v) f.clear(); else f.select(String(v)); }
      else if (f instanceof L.PDFOptionList) { if (!v) f.clear(); else f.select(String(v)); }
    } catch (e) { warnings.push(`Field "${name}": ${e.message}`); }
  }
  return form;
}

function setProps(pdf, p) {
  if (!p) return;
  if (p.title != null) pdf.setTitle(p.title, { showInWindowTitleBar: !!p.title });
  if (p.author != null) pdf.setAuthor(p.author);
  if (p.subject != null) pdf.setSubject(p.subject);
  if (p.keywords != null) pdf.setKeywords(String(p.keywords).split(/[,;]\s*/).filter(Boolean));
}

// Build the output PDF for a document state. opts: {flatten, annots:true, pages:[indices] (subset, in order)}
export async function buildOutput(state, opts = {}) {
  const warnings = [];
  const pdf = await PDFDocument.load(state.bytes, { updateMetadata: false });
  const W = new PdfWriter(pdf);
  let form = applyForm(pdf, state.form, warnings);
  const hasAcro = !!pdf.catalog.get(PDFName.of('AcroForm'));
  if (!form && opts.flatten && hasAcro) form = pdf.getForm();
  if (form) {
    try { form.updateFieldAppearances(await W.font('Helvetica')); }
    catch (e) { warnings.push('Some field appearances could not be generated; viewers will regenerate them.'); try { form.acroForm.dict.set(PDFName.of('NeedAppearances'), PDFBool.True); } catch (e2) { /* ignore */ } }
  }
  setProps(pdf, state.props);
  const pages = pdf.getPages();
  for (const a of state.annots) {
    const pi = state.pageIds.indexOf(a.page); if (pi < 0 || !pages[pi]) continue;
    if (opts.annots === false && !a.content) continue;
    if (a.content || opts.flatten) { if (a.type !== 'redact') await W.burn(pages[pi], a); }
    else await W.annotate(pages[pi], a);
  }
  if (opts.flatten && form) { try { form.flatten({ updateFieldAppearances: false }); } catch (e) { warnings.push('Form flatten: ' + e.message); } }
  if (opts.flatten) {
    // flatten existing (non-Lumen) annotations with appearance streams too, except links
    for (const page of pages) {
      const annots = page.node.Annots(); if (!annots) continue;
      const keep = [];
      for (let i = 0; i < annots.size(); i++) {
        const ref = annots.get(i), d = pdf.context.lookup(ref);
        if (!(d instanceof PDFDict)) continue;
        const st = d.get(PDFName.of('Subtype'))?.toString();
        if (st === '/Link' || st === '/Popup' || st === '/Widget') { if (st !== '/Popup') keep.push(ref); continue; }
        const ap = d.lookup(PDFName.of('AP')); let n = ap instanceof PDFDict ? ap.get(PDFName.of('N')) : null;
        const nObj = n ? pdf.context.lookup(n) : null;
        if (nObj instanceof PDFDict && !(nObj instanceof PDFStream)) { const as = d.get(PDFName.of('AS')); n = as ? nObj.get(as) : null; }
        const F = d.lookup(PDFName.of('F'))?.asNumber?.() || 0;
        if (n && !(F & 2) && pdf.context.lookup(n) instanceof PDFStream) {
          const rect = d.lookup(PDFName.of('Rect')).asArray().map(x => x.asNumber());
          const xs = pdf.context.lookup(n); const bb = xs.dict.lookup(PDFName.of('BBox'))?.asArray().map(x => x.asNumber()) || rect;
          const mx = xs.dict.lookup(PDFName.of('Matrix'))?.asArray().map(x => x.asNumber()) || [1, 0, 0, 1, 0, 0];
          const tb = transformBox(bb, mx); const [x1, y1, x2, y2] = normRect(rect);
          const sx = (x2 - x1) / Math.max(1e-6, tb[2] - tb[0]), sy = (y2 - y1) / Math.max(1e-6, tb[3] - tb[1]);
          const name = page.node.newXObject('FlatAp', n);
          page.pushOperators(L.pushGraphicsState(), L.concatTransformationMatrix(sx, 0, 0, sy, x1 - tb[0] * sx, y1 - tb[1] * sy), L.drawObject(name), L.popGraphicsState());
        }
      }
      page.node.set(PDFName.of('Annots'), pdf.context.obj(keep));
    }
  }
  if (opts.pages) {
    const out = await PDFDocument.create();
    const copied = await out.copyPages(pdf, opts.pages);
    copied.forEach(p => out.addPage(p));
    setProps(out, state.props);
    out.setProducer('Lumen PDF'); out.setCreator('Lumen PDF');
    await out.flush(); gc(out);
    return { bytes: await out.save(), warnings };
  }
  pdf.setProducer('Lumen PDF'); pdf.setModificationDate(new Date());
  await pdf.flush();
  gc(pdf);
  return { bytes: await pdf.save({ useObjectStreams: true, updateFieldAppearances: false }), warnings };
}
function transformBox(b, m) {
  const pts = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
  return [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
}
export { MARKUP };
