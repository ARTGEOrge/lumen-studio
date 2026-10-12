// Edit existing page text. Clicking a line of text finds the exact text-showing operators in the
// page content stream; on commit their glyphs are removed (each operator is replaced by an
// equivalent-advance "[n] TJ" so following text keeps its position) and the new text is drawn at
// the same text matrix with the original embedded font when it contains every needed glyph, or
// with the closest standard font otherwise. Text that can't be removed safely (inside form
// XObjects, unsupported CMaps, clipping text) is handled by "cover & replace", clearly labelled.
import { App, emit, on } from './state.js';
import { pageOp } from './organize.js';
import { V, rectPct, clientToPdf } from './viewer.js';
import { registerTool, setTool } from './tools.js';
import { interpret, pageContentString, pageResources, setPageContent, mul, apply, ID, colorHex, bytesToStr, invert, glyphWidth, lex, Str } from './content.js';
import { PdfWriter } from './writer.js';
import { f2, esc, rectsIntersect } from './util.js';
import { annotRect, translateAnnot } from './annots.js';
const L = window.PDFLib;
const { PDFDocument, PDFName } = L;

/* ---------- analysis (cached per document bytes) ---------- */
let cache = { bytes: null, pdf: null, pages: new Map() };
async function libDoc(bytes) {
  if (cache.bytes !== bytes) cache = { bytes, pdf: PDFDocument.load(bytes, { updateMetadata: false }), pages: new Map() };
  return cache.pdf;
}
export async function analyzePage(d, i) {
  const bytes = d.state.bytes; const pdf = await libDoc(bytes);
  if (cache.bytes !== bytes) return analyzePage(d, i);
  if (cache.pages.has(i)) return cache.pages.get(i);
  const page = pdf.getPages()[i];
  const src = pageContentString(page);
  const res = interpret(pdf.context, src, pageResources(page));
  const lines = groupLines(res.shows);
  const out = { src, ...res, lines, paras: groupParagraphs(lines) };
  cache.pages.set(i, out); return out;
}
const fmt = v => { const r = Math.round(v * 10000) / 10000; return Object.is(r, -0) ? '0' : String(r); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

// Group text-showing operators into editable lines (same font, size, direction and baseline, close together)
export function groupLines(shows) {
  const lines = [];
  for (const s of shows) {
    if (!s.fi || !s.glyphs.length || !(s.hUser > 0.5)) continue;
    const blank = !s.text.trim();
    const h = s.hUser;
    let best = null;
    for (const ln of lines) {
      const r = ln.recs[0];
      if (r.fontKey !== s.fontKey || Math.abs(r.size - s.size) > 0.01 || Math.abs(r.Th - s.Th) > 0.001 || dot(r.u, s.u) < 0.999) continue;
      const perp = Math.abs((s.p0[0] - ln.o[0]) * -ln.u[1] + (s.p0[1] - ln.o[1]) * ln.u[0]);
      if (perp > h * 0.2) continue;
      const a0 = dot([s.p0[0] - ln.o[0], s.p0[1] - ln.o[1]], ln.u), a1 = dot([s.p1[0] - ln.o[0], s.p1[1] - ln.o[1]], ln.u);
      if (Math.min(a0, a1) > ln.aMax + 1.2 * h || Math.max(a0, a1) < ln.aMin - 1.2 * h) continue;
      best = { ln, a0, a1 }; break;
    }
    if (best) { best.ln.recs.push(s); best.ln.aMin = Math.min(best.ln.aMin, best.a0, best.a1); best.ln.aMax = Math.max(best.ln.aMax, best.a0, best.a1); }
    else if (!blank) lines.push({ recs: [s], o: s.p0, u: s.u, aMin: 0, aMax: dot([s.p1[0] - s.p0[0], s.p1[1] - s.p0[1]], s.u) });
  }
  for (const ln of lines) {
    ln.recs.sort((a, b) => dot([a.p0[0] - ln.o[0], a.p0[1] - ln.o[1]], ln.u) - dot([b.p0[0] - ln.o[0], b.p0[1] - ln.o[1]], ln.u));
    // drop leading/trailing whitespace-only operators
    while (ln.recs.length > 1 && !ln.recs[0].text.trim()) ln.recs.shift();
    while (ln.recs.length > 1 && !ln.recs[ln.recs.length - 1].text.trim()) ln.recs.pop();
    let text = '', prevEnd = null;
    for (const r of ln.recs) {
      const a0 = dot([r.p0[0] - ln.o[0], r.p0[1] - ln.o[1]], ln.u);
      if (prevEnd != null && a0 - prevEnd > r.hUser * 0.12 && !/\s$/.test(text) && !/^\s/.test(r.text)) text += ' ';
      text += r.text; prevEnd = dot([r.p1[0] - ln.o[0], r.p1[1] - ln.o[1]], ln.u);
    }
    ln.text = text.replace(/\s+$/, '').replace(/^\s+/, '');
    ln.bbox = ln.recs.reduce((b, r) => b ? [Math.min(b[0], r.bbox[0]), Math.min(b[1], r.bbox[1]), Math.max(b[2], r.bbox[2]), Math.max(b[3], r.bbox[3])] : r.bbox.slice(), null);
    ln.first = ln.recs[0]; ln.fi = ln.first.fi;
    ln.unknown = ln.recs.reduce((n, r) => n + r.unknown, 0);
    ln.unsafe = ln.fi.unsupported || (ln.recs.some(r => r.Tr >= 4) ? 'text used as a clipping path' : null);
  }
  return lines;
}

// Unicode -> code reverse map for a font; null if the text can't be encoded with it
function encodeWith(fi, text, usedCodes) {
  const rev = new Map();
  if (fi.toUni) for (const [code, u] of fi.toUni) { if ([...u].length === 1 && !rev.has(u)) rev.set(u, code); }
  if (!fi.twoByte) for (const [code, u] of fi.encMap) if (!rev.has(u)) rev.set(u, code);
  const codes = [];
  for (const ch of text) {
    const code = rev.get(ch); if (code == null) return null;
    if (fi.embedded && fi.subset && !usedCodes.has(code)) return null; // glyph may not be in the subset
    if (fi.embedded && !fi.std && !fi.widths.has(code) && !fi.twoByte) return null;
    codes.push(code);
  }
  return codes;
}
function substituteFamily(fi) {
  const n = fi.base || '';
  const mono = /Courier|Mono|Consol|Menlo|Typewriter/i.test(n) || (fi.flags & 1);
  const serif = !mono && (/Times|Serif|Georgia|Garamond|Cambria|Book|Minion|Palatino|Baskerville|Caslon|Century|Roman/i.test(n) || ((fi.flags & 2) && !/Sans|Arial|Helvetica|Calibri|Verdana|Segoe|Tahoma/i.test(n)));
  const bold = /Bold|Black|Heavy|Semibold|Demi/i.test(n) || (fi.flags & 262144) || fi.weight >= 600;
  const italic = /Italic|Oblique/i.test(n) || (fi.flags & 64) || Math.abs(fi.italicAngle) > 1;
  const S = L.StandardFonts;
  const fam = mono ? 'Courier' : serif ? 'Times' : 'Helvetica';
  const name = fam === 'Courier' ? (bold && italic ? S.CourierBoldOblique : bold ? S.CourierBold : italic ? S.CourierOblique : S.Courier)
    : fam === 'Times' ? (bold && italic ? S.TimesRomanBoldItalic : bold ? S.TimesRomanBold : italic ? S.TimesRomanItalic : S.TimesRoman)
      : (bold && italic ? S.HelveticaBoldOblique : bold ? S.HelveticaBold : italic ? S.HelveticaOblique : S.Helvetica);
  return { fam, bold: !!bold, italic: !!italic, name };
}
export function cssFont(fi) {
  const s = substituteFamily(fi);
  const fam = s.fam === 'Courier' ? '"Courier New",monospace' : s.fam === 'Times' ? (/Georgia/i.test(fi.base) ? 'Georgia,serif' : '"Times New Roman",serif') : (/Calibri/i.test(fi.base) ? 'Calibri,Arial,sans-serif' : 'Helvetica,Arial,sans-serif');
  return { family: fam, weight: s.bold ? 'bold' : 'normal', style: s.italic ? 'italic' : 'normal' };
}
const nameTok = n => '/' + [...n].map(ch => { const c = ch.charCodeAt(0); return c < 0x21 || c > 0x7e || '()<>[]{}/%#'.includes(ch) ? '#' + c.toString(16).padStart(2, '0') : ch; }).join('');
const colorOps = (c, stroke) => { const o = c?.op || 'g'; const v = (c?.v || [0]).map(fmt).join(' '); return `${v} ${stroke ? o.toUpperCase() : o}`; };
function blankOp(r) {
  const n = r.size && r.Th ? -r.adv / (r.size * r.Th) * 1000 : 0;
  const tj = `[${fmt(n)}] TJ`;
  if (r.op === "'") return `T* ${tj}`;
  if (r.op === '"') return `${fmt(r.Tw)} Tw ${fmt(r.Tc)} Tc T* ${tj}`;
  return tj;
}

/* ---------- applying an edit ---------- */
// line: from groupLines (matched by operator offsets). Returns {font: 'original'|'substitute', fontLabel}
export async function applyTextEdit(i, line, newText, { preferOriginal = true } = {}) {
  const d = App.doc; let info = null;
  const keys = line.recs.map(r => r.start + ':' + r.end);
  const ok = await pageOp(newText ? 'Edit text' : 'Delete text', async (pdf, refs, ids) => {
    const page = pdf.getPages()[i];
    const src = pageContentString(page);
    const res = interpret(pdf.context, src, pageResources(page));
    const recs = keys.map(k => res.shows.find(r => r.start + ':' + r.end === k));
    if (recs.some(r => !r)) throw new Error('The page content changed; please try again.');
    const first = recs[0], fi = first.fi;
    // 1) remove the original glyphs
    const reps = recs.map(r => [r.start, r.end, blankOp(r)]).sort((a, b) => b[0] - a[0]);
    let out = src; for (const [s, e, t] of reps) out = out.slice(0, s) + t + out.slice(e);
    // 2) draw the replacement text
    let draw = '';
    if (newText) {
      const used = new Set(); for (const r of res.shows) if (r.fontKey === first.fontKey) for (const g of r.glyphs) used.add(g.code);
      const codes = preferOriginal && !fi.unsupported ? encodeWith(fi, newText, used) : null;
      let fontTok, hex, Tw = first.Tw;
      if (codes) {
        fontTok = nameTok(first.fontName);
        hex = '<' + codes.map(c => c.toString(16).padStart(fi.twoByte ? 4 : 2, '0')).join('') + '>';
        info = { font: 'original', fontLabel: fi.base || first.fontName };
      } else {
        const sub = substituteFamily(fi); const W = new PdfWriter(pdf); const font = await pdf.embedFont(sub.name);
        const nm = page.node.newFontDictionary('LumEd', font.ref).asString();
        fontTok = nm; hex = font.encodeText(W.clean(font, newText)).toString(); Tw = 0;
        info = { font: 'substitute', fontLabel: sub.name, orig: fi.base || first.fontName };
      }
      draw = `q ${first.ctm.map(fmt).join(' ')} cm BT ${first.Tr} Tr ${fmt(first.Tc)} Tc ${fmt(Tw)} Tw ${fmt(first.Th * 100)} Tz ${fmt(first.Ts)} Ts ${colorOps(first.fill)} ${colorOps(first.stroke || first.fill, true)} ${fontTok} ${fmt(first.size)} Tf ${first.tm.map(fmt).join(' ')} Tm ${hex} Tj ET Q\n`;
    }
    const clean = res.endDepth === 0 && !res.endClip && res.endCtm.every((v, k) => Math.abs(v - ID[k]) < 1e-9);
    const body = !draw || clean ? out + '\n' : 'q\n' + out + '\n' + 'Q\n'.repeat(res.endDepth + 1);
    setPageContent(page, body + draw);
    return { ids };
  }, { toast: false });
  return ok ? (info || { font: 'none' }) : null;
}

// Cover & replace (fallback): white box over the old text + new text on top. The old text stays in the file.
export async function coverReplace(i, box, newText, { size, family = 'Helvetica', bold = false, color = '#000000', dir = [1, 0] } = {}) {
  return pageOp('Cover & replace text', async (pdf, refs, ids) => {
    const page = pdf.getPages()[i]; const W = new PdfWriter(pdf);
    const font = await W.font(family, bold);
    const nm = page.node.newFontDictionary('LumEd', font.ref).asString();
    const [x1, y1, x2, y2] = box; const pad = 0.6;
    let ops = `q 1 1 1 rg ${fmt(x1 - pad)} ${fmt(y1 - pad)} ${fmt(x2 - x1 + pad * 2)} ${fmt(y2 - y1 + pad * 2)} re f Q\n`;
    if (newText) {
      const [r, g, b] = [1, 3, 5].map(k => parseInt(color.substr(k, 2), 16) / 255);
      const s = size || (y2 - y1) * 0.82;
      const ox = x1, oy = y1 + (y2 - y1) * 0.22;
      ops += `q BT ${fmt(r)} ${fmt(g)} ${fmt(b)} rg ${nm} ${fmt(s)} Tf ${fmt(dir[0])} ${fmt(dir[1])} ${fmt(-dir[1])} ${fmt(dir[0])} ${fmt(ox)} ${fmt(oy)} Tm ${font.encodeText(W.clean(font, newText))} Tj ET Q\n`;
    }
    const src = pageContentString(page);
    const res = interpret(pdf.context, src, pageResources(page));
    const clean = res.endDepth === 0 && !res.endClip && res.endCtm.every((v, k) => Math.abs(v - ID[k]) < 1e-9);
    setPageContent(page, (clean ? src + '\n' : 'q\n' + src + '\n' + 'Q\n'.repeat(res.endDepth + 1)) + ops);
    return { ids };
  }, { toast: false });
}

/* ---------- hit testing ---------- */
export async function lineAt(d, i, pt) {
  const a = await analyzePage(d, i);
  let best = null, bestArea = Infinity;
  for (const ln of a.lines) {
    const b = ln.bbox; const m = 1.5;
    if (pt[0] >= b[0] - m && pt[0] <= b[2] + m && pt[1] >= b[1] - m && pt[1] <= b[3] + m) { const ar = (b[2] - b[0]) * (b[3] - b[1]); if (ar < bestArea) { best = ln; bestArea = ar; } }
  }
  return best;
}
// pdf.js text items under a point (for text inside form XObjects etc.)
async function textItemAt(d, i, pt) {
  const t = await d.getText(i);
  for (const it of t.items) {
    if (!it.str || !it.str.trim()) continue;
    const T = it.transform; const sx = Math.hypot(T[0], T[1]) || 1; const ux = T[0] / sx, uy = T[1] / sx; const h = it.height || Math.hypot(T[2], T[3]);
    const pts = [[0, -0.22 * h], [it.width, -0.22 * h], [0, 0.85 * h], [it.width, 0.85 * h]].map(([a, b]) => [T[4] + ux * a - uy * b, T[5] + uy * a + ux * b]);
    const box = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
    if (pt[0] >= box[0] && pt[0] <= box[2] && pt[1] >= box[1] && pt[1] <= box[3]) return { box, text: it.str, size: h, dir: [ux, uy] };
  }
  return null;
}

/* ---------- paragraphs: group lines, re-wrap edited text in the original block ---------- */
const sub2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
// Lines -> paragraph blocks: same font, size and direction, consistent line spacing, aligned left edge
// (first-line indent allowed), overlapping horizontally. Mixed-font blocks are flagged (no reflow).
export function groupParagraphs(lines) {
  const geo = ln => { const u = ln.first.u, nv = [-u[1], u[0]]; const o = ln.first.p0; return { u, nv, o }; };
  const paras = [];
  const sorted = lines.filter(l => !l.unsafe).slice().sort((A, B) => { const g = geo(A); return (B.first.p0[0] - A.first.p0[0]) * g.nv[0] + (B.first.p0[1] - A.first.p0[1]) * g.nv[1]; });
  for (const ln of sorted) {
    const h = ln.first.hUser; let best = null;
    for (const p of paras) {
      const r0 = p.lines[0].first, last = p.lines[p.lines.length - 1];
      if (r0.fontKey !== ln.first.fontKey || Math.abs(r0.size - ln.first.size) > 0.01 || dot(r0.u, ln.first.u) < 0.999) continue;
      const d = sub2(ln.first.p0, p.o); const along = dot(d, p.u), down = -dot(d, p.nv);
      const gap = down - p.downs[p.downs.length - 1];
      if (gap < h * 0.9 || gap > h * 2.2) continue;
      if (p.L && Math.abs(gap - p.L) > h * 0.2) continue;
      const left = p.lines.length > 1 ? p.bodyA : 0;
      const tol = p.lines.length > 1 ? h * 0.8 : h * 4;
      if (Math.abs(along - left) > tol) continue;
      const lastEnd = dot(sub2(last.recs[last.recs.length - 1].p1, p.o), p.u);
      if (lastEnd < along) continue;
      best = { p, along, down, gap }; break;
    }
    if (best) { const p = best.p; p.lines.push(ln); p.downs.push(best.down); p.L = p.L || best.gap; if (p.lines.length === 2) p.bodyA = best.along; }
    else { const g = geo(ln); paras.push({ lines: [ln], downs: [0], o: g.o, u: g.u, nv: g.nv, L: 0, bodyA: 0 }); }
  }
  for (const p of paras) {
    p.first = p.lines[0].first; p.fi = p.first.fi;
    p.text = p.lines.map(l => l.text).reduce((acc, t) => !acc ? t : /-$/.test(acc) && /^[a-z]/.test(t) ? acc + t : acc + ' ' + t, '');
    p.bbox = p.lines.reduce((b, l) => [Math.min(b[0], l.bbox[0]), Math.min(b[1], l.bbox[1]), Math.max(b[2], l.bbox[2]), Math.max(b[3], l.bbox[3])], p.lines[0].bbox.slice());
    p.ends = p.lines.map(l => dot(sub2(l.recs[l.recs.length - 1].p1, p.o), p.u));
    p.starts = p.lines.map(l => dot(sub2(l.first.p0, p.o), p.u));
    p.right = Math.max(...p.ends);
    p.justified = p.lines.length >= 3 && p.ends.slice(0, -1).every(e => Math.abs(e - p.right) < Math.max(1.5, p.first.hUser * 0.15));
    // other text drawn inside the block (bold words, links in another font…) prevents re-wrapping
    const mine = new Set(p.lines.flatMap(l => l.recs));
    p.mixed = lines.some(l => !p.lines.includes(l) && l.recs.some(r => !mine.has(r) && r.text.trim() && rectsIntersect(r.bbox, [p.bbox[0] + 0.5, p.bbox[1] + 0.5, p.bbox[2] - 0.5, p.bbox[3] - 0.5])));
  }
  return paras;
}
export async function paragraphAt(d, i, pt) {
  const a = await analyzePage(d, i); const ln = await lineAt(d, i, pt); if (!ln) return null;
  return (a.paras || []).find(p => p.lines.includes(ln)) || null;
}
// width of a string in text-space units with the original font (codes) or a standard font
function textWidth(f, s) {
  if (f.std) return f.std.widthOfTextAtSize(s, f.size) * f.Th + [...s].length * f.Tc * f.Th;
  let w = 0; for (const ch of s) { const code = f.rev.get(ch); w += (glyphWidth(f.fi, code) * f.size + f.Tc + (!f.fi.twoByte && code === 32 ? f.Tw : 0)) * f.Th; } return w;
}
function wrapWords(text, f, firstW, restW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/ +/).filter(Boolean); let line = '';
    if (!words.length) { out.push(''); continue; }
    for (const w of words) {
      const cand = line ? line + ' ' + w : w; const max = out.length ? restW : firstW;
      if (!line || textWidth(f, cand) <= max + 0.01) line = cand; else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}
// Replace a whole paragraph: remove all of its glyphs, re-wrap the new text in the block width with the
// original line spacing (and justification), first-line indent and font (or the closest standard font).
export async function applyParagraphEdit(i, para, newText, { preferOriginal = true, moveFollowing = true } = {}) {
  let info = null;
  const keys = para.lines.flatMap(l => l.recs).map(r => r.start + ':' + r.end);
  let movedAnnots = null;
  const ok = await pageOp('Edit paragraph', async (pdf, refs, ids) => {
    const page = pdf.getPages()[i];
    const src = pageContentString(page);
    const res = interpret(pdf.context, src, pageResources(page), { paths: true });
    const recs = keys.map(k => res.shows.find(r => r.start + ':' + r.end === k));
    if (recs.some(r => !r)) throw new Error('The page content changed; please try again.');
    const first = res.shows.find(r => r.start + ':' + r.end === para.first.start + ':' + para.first.end); const fi = first.fi;
    const reps = recs.map(r => [r.start, r.end, blankOp(r)]).sort((a, b) => b[0] - a[0]);
    let out = src; for (const [s, e, t] of reps) out = out.slice(0, s) + t + out.slice(e);
    const flat = newText.replace(/\r/g, '');
    let draw = '', lines = [];
    if (flat.trim()) {
      const used = new Set(); for (const r of res.shows) if (r.fontKey === first.fontKey) for (const g of r.glyphs) used.add(g.code);
      const codes = preferOriginal && !fi.unsupported ? encodeWith(fi, flat.replace(/\n/g, ' '), used) : null;
      let f, fontTok, enc;
      if (codes) {
        const rev = new Map(); [...flat.replace(/\n/g, ' ')].forEach((ch, k) => rev.set(ch, codes[k]));
        f = { fi, rev, size: first.size, Tc: first.Tc, Tw: first.Tw, Th: first.Th }; fontTok = nameTok(first.fontName);
        enc = s => '<' + [...s].map(ch => rev.get(ch).toString(16).padStart(fi.twoByte ? 4 : 2, '0')).join('') + '>';
        info = { font: 'original', fontLabel: fi.base || first.fontName };
      } else {
        const sb = substituteFamily(fi); const W = new PdfWriter(pdf); const font = await pdf.embedFont(sb.name);
        fontTok = page.node.newFontDictionary('LumEd', font.ref).asString();
        f = { std: font, size: first.size, Tc: first.Tc, Tw: 0, Th: first.Th, clean: t => W.clean(font, t) };
        enc = s => font.encodeText(s).toString();
        info = { font: 'substitute', fontLabel: sb.name, orig: fi.base || first.fontName };
      }
      const text = f.clean ? f.clean(flat) : flat;
      // geometry: user-space units per text-space unit along the line
      const M = mul(first.tm, first.ctm); const o0 = apply(M, 0, 0), ux = apply(M, 1, 0); const uScale = Math.hypot(ux[0] - o0[0], ux[1] - o0[1]) || 1;
      const firstA = para.starts[0], bodyA = para.lines.length > 1 ? para.starts[1] : para.starts[0];
      const firstW = (para.right - firstA) / uScale, restW = (para.right - bodyA) / uScale;
      lines = wrapWords(text, f, firstW, restW);
      const L = para.L || first.hUser * 1.2; const inv = invert(first.ctm); const t = first.tm; const Ts = first.Ts;
      draw = `q ${first.ctm.map(fmt).join(' ')} cm BT ${first.Tr} Tr ${fmt(f.Tc)} Tc ${fmt(f.Tw || 0)} Tw ${fmt(first.Th * 100)} Tz ${fmt(Ts)} Ts ${colorOps(first.fill)} ${colorOps(first.stroke || first.fill, true)} ${fontTok} ${fmt(first.size)} Tf `;
      const lastOfPara = new Set(); { let k = 0; for (const part of text.split('\n')) { const n = wrapWords(part, f, k === 0 ? firstW : restW, restW).length; k += n; lastOfPara.add(k - 1); } }
      lines.forEach((s, k) => {
        const a = k === 0 ? firstA : bodyA;
        const P = [para.o[0] + para.u[0] * a - para.nv[0] * k * L, para.o[1] + para.u[1] * a - para.nv[1] * k * L];
        const q = apply(inv, P[0], P[1]); const e = q[0] - t[2] * Ts, fy = q[1] - t[3] * Ts;
        let body;
        const spaces = (s.match(/ /g) || []).length;
        if (para.justified && !lastOfPara.has(k) && spaces) {
          const extra = (k === 0 ? firstW : restW) - textWidth(f, s);
          const n = -extra / spaces / (first.size * first.Th) * 1000;
          body = '[' + s.split(' ').map((w, wi, arr) => enc(wi < arr.length - 1 ? w + ' ' : w) + (wi < arr.length - 1 ? ' ' + fmt(n) + ' ' : '')).join('') + '] TJ';
        } else body = enc(s) + ' Tj';
        if (s) draw += `${fmt(t[0])} ${fmt(t[1])} ${fmt(t[2])} ${fmt(t[3])} ${fmt(e)} ${fmt(fy)} Tm ${body} `;
      });
      draw += 'ET Q\n';
      // Content below the paragraph in the same column (text, vector graphics, images, links and comments)
      // moves up/down by the change in height. The page footer stays put; anything that straddles the column
      // edge or clips stops the move there. If a longer paragraph can't make room, it's reported as overlapping.
      const grow = lines.length - para.lines.length;
      if (grow) {
        const mine = new Set(recs); const lastDown = (para.lines.length - 1) * L;
        const frame = pt => { const d = sub2(pt, para.o); return { a: dot(d, para.u), dn: -dot(d, para.nv) }; };
        const colL = Math.min(firstA, bodyA) - 3, colR = para.right + 3;
        const boxF = b => { const c = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].map(frame); return { a0: Math.min(...c.map(x => x.a)), a1: Math.max(...c.map(x => x.a)), d0: Math.min(...c.map(x => x.dn)), d1: Math.max(...c.map(x => x.dn)) }; };
        const mb = page.getMediaBox(); const pageBottom = Math.max(...[[mb.x, mb.y], [mb.x + mb.width, mb.y], [mb.x, mb.y + mb.height]].map(pt => frame(pt).dn));
        const footerTop = pageBottom - 60;
        const pathBox = pp => { const pts = pp.segs.flatMap(sg => sg.t === 're' ? sg.pts : [sg.p, ...(sg.a ? [sg.a] : [])]).filter(Boolean); return [Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))]; };
        const items = [
          ...res.shows.filter(r => !mine.has(r) && r.text.trim()).map(r => ({ kind: 'text', r, f: boxF(r.bbox), movable: dot(r.u, para.u) > 0.999 })),
          ...res.paths.filter(pp => pp.segs.length).map(pp => ({ kind: 'path', r: pp, f: boxF(pathBox(pp)), movable: !pp.clip && !pp.inText && pp.start >= 0 })),
          ...res.xobjs.map(x => ({ kind: 'xobj', r: x, f: boxF(x.bbox), movable: !x.inText }))
        ].filter(x => x.f.a1 > colL && x.f.a0 < colR && x.f.d1 > lastDown + L * 0.3 && x.f.d0 < footerTop);
        items.sort((x, y) => x.f.d0 - y.f.d0);
        const shiftV = [-para.nv[0] * grow * L, -para.nv[1] * grow * L];
        let limit = footerTop; const move = [];
        for (const x of items) {
          if (x.f.d0 >= limit) break;
          const inside = x.f.a0 >= colL && x.f.a1 <= colR;
          // drawn inside a clip region that doesn't move with it? then it must stay inside after the shift
          const cb = x.r.clipBox, bb = x.kind === 'text' ? x.r.bbox : x.kind === 'path' ? pathBox(x.r) : x.r.bbox;
          const clipOk = !cb || (bb[0] + shiftV[0] >= cb[0] - 0.5 && bb[1] + shiftV[1] >= cb[1] - 0.5 && bb[2] + shiftV[0] <= cb[2] + 0.5 && bb[3] + shiftV[1] <= cb[3] + 0.5);
          if (!x.movable || !inside || !clipOk || x.f.d1 > footerTop) { limit = Math.min(limit, x.f.d0); continue; }
          move.push(x);
        }
        // anything already accepted that reaches past the limit can't move either
        while (move.length && Math.max(...move.map(x => x.f.d1)) > limit) { const bad = move.filter(x => x.f.d1 > limit); limit = Math.min(limit, ...bad.map(x => x.f.d0)); for (const b of bad) move.splice(move.indexOf(b), 1); for (let k = move.length - 1; k >= 0; k--) if (move[k].f.d0 >= limit) move.splice(k, 1); }
        const dy = grow * L;
        const bottomAfter = (move.length ? Math.max(...move.map(x => x.f.d1)) : lastDown) + dy;
        const fits = grow < 0 || bottomAfter < limit - 2;
        if (moveFollowing && move.length && fits) {
          const shift = [-para.nv[0] * dy, -para.nv[1] * dy];
          const reps2 = recs.map(r => [r.start, r.end, blankOp(r)]); const redraw = [];
          const local = ctm => { const iv = invert(ctm); return [shift[0] * iv[0] + shift[1] * iv[2], shift[0] * iv[1] + shift[1] * iv[3]]; };
          const hexOf = st => '<' + [...st.s].map(ch => ch.charCodeAt(0).toString(16).padStart(2, '0')).join('') + '>';
          for (const x of move) {
            const r = x.r;
            if (x.kind === 'text') {
              const args = lex(src.slice(r.start, r.end)).at(-1)?.args || []; let operand;
              if (r.op === 'TJ') operand = '[' + (Array.isArray(args[0]) ? args[0] : []).map(v => typeof v === 'number' ? fmt(v) : v instanceof Str ? hexOf(v) : '').join(' ') + '] TJ';
              else { const st = args.filter(v => v instanceof Str).at(-1); if (!st) continue; operand = hexOf(st) + ' Tj'; }
              const tm2 = mul(mul(mul(r.tm, r.ctm), [1, 0, 0, 1, shift[0], shift[1]]), invert(r.ctm));
              reps2.push([r.start, r.end, blankOp(r)]);
              redraw.push(`q ${r.ctm.map(fmt).join(' ')} cm BT ${r.Tr} Tr ${fmt(r.Tc)} Tc ${fmt(r.Tw)} Tw ${fmt(r.Th * 100)} Tz ${fmt(r.Ts)} Ts ${colorOps(r.fill)} ${colorOps(r.stroke || r.fill, true)} ${nameTok(r.fontName)} ${fmt(r.size)} Tf ${tm2.map(fmt).join(' ')} Tm ${operand} ET Q\n`);
            } else {
              const [lx, ly] = local(r.ctm);
              reps2.push([r.start, r.end, `q 1 0 0 1 ${fmt(lx)} ${fmt(ly)} cm\n${src.slice(r.start, r.end)}\nQ`]);
            }
          }
          reps2.sort((x, y) => y[0] - x[0]);
          // ranges must not overlap (paths nested in other ranges stay where they are)
          let lastStart = Infinity; out = src;
          for (const [s0, e0, t0] of reps2) { if (e0 > lastStart) continue; out = out.slice(0, s0) + t0 + out.slice(e0); lastStart = s0; }
          draw += redraw.join('');
          info.moved = move.length;
          // links / form widgets in the moved region move too
          const zoneTop = lastDown + L * 0.3;
          const inZone = rc => { const f = boxF(rc); return f.a0 >= colL && f.a1 <= colR && f.d0 >= zoneTop && f.d1 <= limit; };
          const annots = page.node.Annots();
          if (annots) for (const ref of annots.asArray()) {
            const ad = pdf.context.lookup(ref); const rr = ad?.lookup?.(PDFName.of('Rect')); if (!rr) continue;
            const rc = rr.asArray().map(v => v.asNumber()); const nr = [Math.min(rc[0], rc[2]), Math.min(rc[1], rc[3]), Math.max(rc[0], rc[2]), Math.max(rc[1], rc[3])];
            if (!inZone(nr)) continue;
            ad.set(PDFName.of('Rect'), pdf.context.obj([nr[0] + shift[0], nr[1] + shift[1], nr[2] + shift[0], nr[3] + shift[1]]));
            const qp = ad.lookup(PDFName.of('QuadPoints')); if (qp) ad.set(PDFName.of('QuadPoints'), pdf.context.obj(qp.asArray().map((v, k) => v.asNumber() + shift[k % 2])));
          }
          // Lumen comments and markups on this page
          const pid = ids[i];
          movedAnnots = App.doc.state.annots.map(an => an.page === pid && inZone(annotRect(an)) ? translateAnnot(an, shift[0], shift[1]) : an);
        } else if (grow > 0) {
          const z0 = lastDown + L * 0.3, z1 = lastDown + L * (grow + 0.3);
          info.overlap = items.some(x => x.f.d1 > z0 && x.f.d0 < z1);
        }
        info.grew = grow;
      }
    }
    const clean = res.endDepth === 0 && !res.endClip && res.endCtm.every((v, k) => Math.abs(v - ID[k]) < 1e-9);
    const body = !draw || clean ? out + '\n' : 'q\n' + out + '\n' + 'Q\n'.repeat(res.endDepth + 1);
    setPageContent(page, body + draw);
    if (info) info.lines = lines.length;
    return movedAnnots ? { ids, annots: movedAnnots } : { ids };
  }, { toast: false });
  return ok ? (info || { font: 'none', lines: 0 }) : null;
}
/* ---------- UI ---------- */
const opts = { preferOriginal: true, paragraph: true };
let editor = null, hoverBox = null, outlinesFor = new Set();
function boxEl(i, b, cls) {
  const p = rectPct(i, b); const el = document.createElement('div'); el.className = cls;
  Object.assign(el.style, { left: p.left + '%', top: p.top + '%', width: p.width + '%', height: p.height + '%' });
  return el;
}
async function drawOutlines(i) {
  const d = App.doc, pv = V.views[i]; if (!d || !pv || App.tool !== 'retext') return;
  let a; try { a = await analyzePage(d, i); } catch (e) { return; }
  if (App.tool !== 'retext' || V.views[i] !== pv) return;
  pv.el.querySelector('.rt-lines')?.remove();
  const wrap = document.createElement('div'); wrap.className = 'rt-lines';
  for (const ln of a.lines) wrap.appendChild(boxEl(i, ln.bbox, 'rt-line' + (ln.unsafe ? ' unsafe' : '')));
  pv.el.appendChild(wrap); outlinesFor.add(i);
}
function clearOutlines() { document.querySelectorAll('.rt-lines,.rt-hover').forEach(e => e.remove()); outlinesFor.clear(); }
function refreshOutlines() { clearOutlines(); if (App.tool === 'retext' && App.doc) for (const i of V.rendered) drawOutlines(i); }
on('tool', t => { closeEditor(false); if (t === 'retext') refreshOutlines(); else clearOutlines(); });
on('rendered', i => { if (App.tool === 'retext') drawOutlines(i); });
on('docChanged', () => { if (App.tool === 'retext') setTimeout(refreshOutlines, 50); });

document.getElementById('pages').addEventListener('pointermove', async e => {
  if (App.tool !== 'retext' || editor || !App.doc) return;
  const pvEl = e.target.closest('.pv'); if (!pvEl) return; const i = +pvEl.dataset.i;
  const pt = clientToPdf(i, e.clientX, e.clientY);
  let ln = null, pa = null; try { ln = await lineAt(App.doc, i, pt); if (ln && opts.paragraph) pa = await paragraphAt(App.doc, i, pt); } catch (err) { return; }
  hoverBox?.remove(); hoverBox = null;
  if (ln && !editor) { hoverBox = boxEl(i, pa && pa.lines.length > 1 && !pa.mixed ? pa.bbox : ln.bbox, 'rt-hover'); pvEl.appendChild(hoverBox); }
});

registerTool('retext', {
  title: 'Edit: edit existing text', key: 'M',
  icon: '<path d="M4 6V4h12v2M10 4v13M7.5 17h5"/><path d="M14.5 20l1-3.5 5.5-5.5 2.5 2.5-5.5 5.5z"/>',
  hint: 'Click text to edit it · Enter applies (Shift+Enter: new line), Esc cancels · red outline: cover & replace',
  down(e, i) {
    const up = ev => { e.target.removeEventListener('pointerup', up); if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 6) beginEdit(i, clientToPdf(i, ev.clientX, ev.clientY)); };
    e.target.addEventListener('pointerup', up);
  },
  controls: () => `<label title="Edit a whole paragraph and re-wrap it within its original width and line spacing"><input type="checkbox" data-rt="para"${opts.paragraph ? ' checked' : ''}> Edit whole paragraphs</label><label title="Reuse the document's own embedded font when it has every character you type"><input type="checkbox" data-rt="orig"${opts.preferOriginal ? ' checked' : ''}> Keep original font when possible</label>`
});
document.getElementById('cmd').addEventListener('change', e => { if (e.target.dataset.rt === 'orig') opts.preferOriginal = e.target.checked; if (e.target.dataset.rt === 'para') opts.paragraph = e.target.checked; });

export async function beginEdit(i, pt) {
  const d = App.doc; if (!d) return;
  if (d.readOnly) { Aero.toast('This document is read-only'); return; }
  closeEditor(false);
  let ln = null; try { ln = await lineAt(d, i, pt); } catch (e) { console.warn(e); }
  if (ln && !ln.unsafe && opts.paragraph) {
    const pa = await paragraphAt(d, i, pt);
    if (pa && pa.lines.length > 1 && !pa.mixed) return openEditor(i, { kind: 'para', para: pa, box: pa.bbox, text: pa.text, fi: pa.fi, hUser: pa.first.hUser, color: colorHex(pa.first.fill), leading: pa.L });
  }
  if (ln && !ln.unsafe) return openEditor(i, { kind: 'line', line: ln, box: ln.bbox, text: ln.text, fi: ln.fi, hUser: ln.first.hUser, color: colorHex(ln.first.fill) });
  const item = await textItemAt(d, i, pt);
  if (!item && !ln) { Aero.toast('No text here — click directly on a line of text'); return; }
  const why = ln ? ln.unsafe : 'it is drawn inside a nested form object';
  const box = ln ? ln.bbox : item.box;
  openEditor(i, { kind: 'cover', why, box, text: ln ? ln.text : item.text, hUser: ln ? ln.first.hUser : item.size, dir: ln ? ln.first.u : item.dir, color: ln ? colorHex(ln.first.fill) : '#000000', fi: ln?.fi });
}
function openEditor(i, ed) {
  const pv = V.views[i]; if (!pv) return;
  hoverBox?.remove(); hoverBox = null;
  const p = rectPct(i, ed.box);
  const multi = ed.kind === 'para';
  const inp = document.createElement(multi ? 'textarea' : 'input'); if (!multi) inp.type = 'text'; inp.className = 'rt-edit' + (ed.kind === 'cover' ? ' cover' : '') + (multi ? ' para' : '');
  const f = ed.fi ? cssFont(ed.fi) : { family: 'Helvetica,Arial,sans-serif', weight: 'normal', style: 'normal' };
  Object.assign(inp.style, { left: p.left + '%', top: p.top + '%', minWidth: p.width + '%', width: multi ? p.width + '%' : `calc(${p.width}% + 24px)`, height: p.height + '%', fontSize: `calc(var(--sc) * ${f2(ed.hUser * 0.98)}px)`, fontFamily: f.family, fontWeight: f.weight, fontStyle: f.style, color: ed.color });
  if (multi) { inp.style.lineHeight = `calc(var(--sc) * ${f2(ed.leading || ed.hUser * 1.2)}px)`; inp.style.minHeight = p.height + '%'; }
  inp.value = ed.text; inp.spellcheck = false;
  pv.el.appendChild(inp);
  const tag = document.createElement('div'); tag.className = 'rt-tag';
  tag.textContent = multi ? `Paragraph — re-wrapped to the original width${ed.fi?.base ? ' · font: ' + ed.fi.base : ''} · Enter applies, Shift+Enter new line` : ed.kind === 'cover' ? `Cover & replace — ${ed.why}; the original text stays in the file under a white box` : ed.fi?.base ? `Font: ${ed.fi.base}` : 'Edit text';
  Object.assign(tag.style, { left: p.left + '%', top: `calc(${p.top + p.height}% + 3px)` });
  pv.el.appendChild(tag);
  editor = { i, ed, inp, tag };
  if (multi) { const fit = () => { inp.style.height = 'auto'; inp.style.height = inp.scrollHeight + 'px'; }; inp.addEventListener('input', fit); setTimeout(fit, 0); }
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && !(multi && e.shiftKey)) { e.preventDefault(); closeEditor(true); } else if (e.key === 'Escape') { e.preventDefault(); closeEditor(false); } });
  inp.addEventListener('blur', () => setTimeout(() => { if (editor && editor.inp === inp) closeEditor(true); }, 0));
  setTimeout(() => { inp.focus(); inp.select(); }, 0);
}
async function closeEditor(commit) {
  if (!editor) return; const { i, ed, inp, tag } = editor; editor = null;
  const text = inp.value; inp.remove(); tag.remove();
  if (!commit || text === ed.text) return;
  await commitEdit(i, ed, text);
}
export async function commitEdit(i, ed, text) {
  if (ed.kind === 'para') {
    const r = await applyParagraphEdit(i, ed.para, text, { preferOriginal: opts.preferOriginal });
    if (r) Aero.toast((!text.trim() ? 'Paragraph deleted' : `Paragraph re-wrapped into ${r.lines} line${r.lines === 1 ? '' : 's'} using ${r.font === 'original' ? 'the original font (' + r.fontLabel + ')' : r.fontLabel}`) + (r.moved ? ` — the ${r.moved} text item${r.moved > 1 ? 's' : ''} below moved ${r.grew > 0 ? 'down' : 'up'} to make room` : '') + (r.overlap ? ` — it is now ${r.grew} line${r.grew > 1 ? 's' : ''} longer and overlaps content below (Ctrl+Z to undo)` : r.grew > 0 && !r.moved ? ` — it grew by ${r.grew} line${r.grew > 1 ? 's' : ''} into empty space` : ''), r.overlap ? 7000 : 4500);
    return r;
  }
  if (ed.kind === 'line') {
    const r = await applyTextEdit(i, ed.line, text, { preferOriginal: opts.preferOriginal });
    if (r) Aero.toast(!text ? 'Text deleted' : r.font === 'original' ? `Text replaced using the original font (${r.fontLabel})` : `Text replaced using ${r.fontLabel}` + (r.orig ? ` — “${r.orig}” is embedded as a subset without all the characters you typed` : ''), 4500);
    return r;
  }
  const f = ed.fi ? substituteFamily(ed.fi) : { fam: 'Helvetica', bold: false };
  const r = await coverReplace(i, ed.box, text, { size: ed.hUser, family: f.fam, bold: f.bold, color: ed.color, dir: ed.dir || [1, 0] });
  if (r) Aero.toast('Covered the old text with a white box and placed the new text on top (the original text is still in the file)', 5000);
  return r ? { font: 'cover' } : null;
}
export { opts as textEditOpts };
