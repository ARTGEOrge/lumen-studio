// Document-level edits: redaction, watermark, header/footer + Bates, properties, optimize, flatten.
import { App, emit } from './state.js';
import { pageOp, applyNewBytes, rangesText } from './organize.js';
import { buildOutput, PdfWriter, gc } from './writer.js';
import { annotRect } from './annots.js';
import { V } from './viewer.js';
import { parseRanges, rectsIntersect, normRect, localFrame, f2, rgbOp, fmtBytes, esc, imageFileToDataUrl, dataUrlToBytes, prefs } from './util.js';
import { AnnotationMode } from './pdfjs.js';
import { appendToPage } from './content.js';
import { redactPageContent, leakCheck, Unsupported } from './redact.js';
import { loadPdf } from './pdfjs.js';
import { removeHiddenDialog } from './sanitize.js';
const L = window.PDFLib;
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFRawStream, PDFNumber, StandardFonts } = L;

function addOps(pdf, page, ops, res, behind) {
  const ctx = pdf.context;
  const names = {};
  for (const [k, ref] of Object.entries(res.Font || {})) names[k] = page.node.newFontDictionary(k, ref).asString();
  for (const [k, obj] of Object.entries(res.ExtGState || {})) names[k] = page.node.newExtGState(k, ctx.register(ctx.obj(obj))).asString();
  for (const [k, ref] of Object.entries(res.XObject || {})) names[k] = page.node.newXObject(k, ref).asString();
  const text = ops.replace(/\/@(\w+)/g, (m, k) => names[k] || m);
  if (!behind) { try { appendToPage(page, `q ${text} Q`); return; } catch (e) { /* fall back to a separate stream */ } }
  const ref = ctx.register(ctx.flateStream(`q ${text} Q`));
  const contents = page.node.normalizedEntries().Contents;
  if (behind) contents.insert(0, ref); else contents.push(ref);
}
export { addOps };
const pageFrame = (d, i) => localFrame(d.info[i].view, d.info[i].rotate);

/* ---------- redaction ---------- */
export function applyRedactionsDialog() {
  const d = App.doc; if (!d) return;
  const marks = d.state.annots.filter(a => a.type === 'redact');
  if (!marks.length) { Aero.alert('Apply redactions', 'Nothing is marked yet. Use the Redact tool to drag over areas, select text and choose “Redact”, or use Find & Redact to mark every match of a word or pattern.'); return; }
  const pages = [...new Set(marks.map(a => d.pageOf(a)))].sort((a, b) => a - b);
  const o = App.opts.redact;
  Aero.dialog({
    title: 'Apply redactions', width: 540,
    instruction: `Permanently remove ${marks.length} marked area${marks.length > 1 ? 's' : ''} on page${pages.length > 1 ? 's' : ''} ${rangesText(pages)}?`,
    html: `<div class="dnote"><b>Remove content</b> deletes the text characters, images (or just the covered pixels) and vector shapes under each mark from the page itself — the rest of the page stays sharp and searchable. Every page is then re-checked; a page that can't be redacted precisely (unusual fonts or images) is re-rendered as an image instead. <b>Rasterize pages</b> always re-renders affected pages as images. Annotations, links and form fields overlapping a mark are deleted. This cannot be undone after you save.</div>`,
    fields: [
      { key: 'method', label: 'Method', type: 'select', value: o.method || 'remove', options: [['remove', 'Remove content (keep page vector & searchable)'], ['raster', 'Rasterize affected pages']] },
      { key: 'fill', label: 'Box colour', type: 'color', value: o.fill || '#000000' },
      { key: 'overlay', label: 'Overlay text (optional)', type: 'text', value: o.overlay || '' },
      { key: 'dpi', label: 'Raster resolution', type: 'select', value: String(o.dpi), options: [['150', '150 dpi (smaller file)'], ['200', '200 dpi'], ['300', '300 dpi (sharper)']] },
      { key: 'keep', label: 'Keep other text searchable on rasterized pages', type: 'checkbox', value: true }
    ],
    ok: 'Apply Redactions',
    onOK: v => { Object.assign(o, { dpi: +v.dpi, method: v.method, fill: v.fill, overlay: v.overlay }); applyRedactions({ method: v.method, dpi: +v.dpi, keepText: v.keep, fill: v.fill, overlay: v.overlay }); }
  });
}
// Does any redacted phrase survive in strings outside the page content (document info, bookmarks, annotations…)?
async function redactedElsewhere(d, quotes) {
  if (!quotes.length) return [];
  const hay = [];
  try {
    const pdf = await PDFDocument.load(d.state.bytes, { updateMetadata: false });
    const add = v => { if (v instanceof L.PDFString || v instanceof L.PDFHexString) { try { hay.push(v.decodeText()); } catch (e) { /* ignore */ } } };
    for (const [, obj] of pdf.context.enumerateIndirectObjects()) {
      const dict = obj instanceof L.PDFStream ? obj.dict : obj;
      if (dict instanceof PDFDict) for (const [, v] of dict.entries()) { add(v); if (v instanceof PDFArray) v.asArray().forEach(add); if (v instanceof PDFDict) for (const [, w] of v.entries()) add(w); }
      if (obj instanceof L.PDFStream && /Metadata/.test(dict.lookup(PDFName.of('Type'))?.toString() || '')) { try { hay.push(new TextDecoder().decode(obj instanceof PDFRawStream ? L.decodePDFRawStream(obj).decode() : obj.getContents())); } catch (e) { /* ignore */ } }
    }
  } catch (e) { return []; }
  for (const v of Object.values(d.state.props || {})) hay.push(String(v ?? ''));
  for (const a of d.state.annots) hay.push(a.contents || '', a.text || '', ...(a.replies || []).map(r => r.text || ''));
  const H = hay.join(' ').replace(/\s+/g, ' ').toLowerCase();
  return quotes.filter(q => H.includes(q.toLowerCase()));
}
function hexRgb(h) { const n = parseInt(String(h || '#000000').slice(1), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
async function rasterizePage(d, pdf, pg, pi, rects, { dpi, keepText, fill }, W, helv) {
  const ctx = pdf.context;
  const page = await d.getPage(pi);
  const viewport = page.getViewport({ scale: dpi / 72, rotation: 0 });
  const c = document.createElement('canvas'); c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, viewport, annotationMode: AnnotationMode.DISABLE }).promise;
  g.fillStyle = fill || '#000';
  for (const r of rects) { const [x1, y1] = viewport.convertToViewportPoint(r[0], r[1]), [x2, y2] = viewport.convertToViewportPoint(r[2], r[3]); g.fillRect(Math.floor(Math.min(x1, x2)) - 1, Math.floor(Math.min(y1, y2)) - 1, Math.ceil(Math.abs(x2 - x1)) + 2, Math.ceil(Math.abs(y2 - y1)) + 2); }
  const png = new Uint8Array(await (await new Promise(res => c.toBlob(res, 'image/png'))).arrayBuffer()); c.width = 0;
  const img = await pdf.embedPng(png);
  const [vx1, vy1, vx2, vy2] = d.info[pi].view;
  let ops = `q ${f2(vx2 - vx1)} 0 0 ${f2(vy2 - vy1)} ${f2(vx1)} ${f2(vy1)} cm /RedactIm Do Q `;
  if (keepText) ops += await invisibleText(d, pi, rects, W, helv);
  pg.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(ops)));
  pg.node.set(PDFName.of('Resources'), ctx.obj({ XObject: { RedactIm: img.ref }, Font: { RF: helv.ref } }));
}
// fill boxes (+ optional overlay text) drawn on top of the page content
function boxOps(rects, fill, overlay, W, helv) {
  const [r, g, b] = hexRgb(fill).map(v => v / 255);
  let ops = `${f2(r)} ${f2(g)} ${f2(b)} rg `;
  for (const q of rects) ops += `${f2(q[0])} ${f2(q[1])} ${f2(q[2] - q[0])} ${f2(q[3] - q[1])} re f `;
  const text = overlay ? W.clean(helv, overlay) : '';
  if (text) {
    const lum = 0.299 * r + 0.587 * g + 0.114 * b; const tc = lum < 0.5 ? '1 1 1' : '0 0 0';
    for (const q of rects) {
      const w = q[2] - q[0], h = q[3] - q[1]; const tw = helv.widthOfTextAtSize(text, 1) || 1;
      const size = Math.min(h * 0.72, (w - 2) / tw); if (size < 3) continue;
      ops += `BT ${tc} rg /@RF ${f2(size)} Tf ${f2(q[0] + (w - tw * size) / 2)} ${f2(q[1] + (h - size * 0.7) / 2)} Td ${helv.encodeText(text)} Tj ET `;
    }
  }
  return ops;
}
function dropOverlapping(pdf, pg, rects, removeWidgets) {
  const ctx = pdf.context; const arr = pg.node.Annots(); if (!arr) return;
  const keep = [];
  for (const ref of arr.asArray()) {
    const ad = ref instanceof PDFRef ? ctx.lookup(ref) : ref;
    const rr = ad instanceof PDFDict && ad.lookup(PDFName.of('Rect'));
    const rect = rr instanceof PDFArray ? normRect(rr.asArray().map(x => x.asNumber?.() ?? 0)) : null;
    if (rect && rects.some(r => rectsIntersect(rect, r))) { if (ad.lookup(PDFName.of('Subtype'))?.toString() === '/Widget') removeWidgets.add(ref instanceof PDFRef ? ref.tag : ad); }
    else keep.push(ref);
  }
  pg.node.set(PDFName.of('Annots'), ctx.obj(keep));
}
// method: 'remove' (true content removal, verified, raster fallback per page) | 'raster'
export async function applyRedactions({ method = 'remove', dpi = 200, keepText = true, fill = '#000000', overlay = '' } = {}) {
  const d = App.doc;
  const byPage = new Map();
  for (const a of d.state.annots) if (a.type === 'redact') { const i = d.pageOf(a); if (i < 0) continue; if (!byPage.has(i)) byPage.set(i, []); byPage.get(i).push(...a.rects.map(normRect)); }
  if (!byPage.size) return false;
  const quotes = [...new Set(d.state.annots.filter(a => a.type === 'redact' && a.quote).map(a => String(a.quote).replace(/\s+/g, ' ').trim()).filter(q => q.length >= 3))];
  let removedFields = 0; const report = { removed: [], raster: [], reasons: {}, glyphs: 0, images: 0, imagesEdited: 0, paths: 0, removedText: '' };
  const ok = await pageOp('Apply redactions', async (pdf, refs, ids) => {
    const pages = pdf.getPages();
    const ctx = pdf.context; const removeWidgets = new Set();
    const raster = new Map();
    if (method === 'remove') {
      for (const [pi, rects] of byPage) {
        try {
          const s = await redactPageContent(pdf, pages[pi], rects);
          report.glyphs += s.glyphs; report.images += s.images; report.imagesEdited += s.imagesEdited; report.paths += s.paths; report.removedText += s.removedText;
        } catch (e) { if (e instanceof Unsupported) raster.set(pi, e.message); else throw e; }
      }
      // verify independently with pdf.js that no character is left under a mark
      const left = [...byPage.keys()].filter(pi => !raster.has(pi));
      if (left.length) {
        const pj = await loadPdf(await pdf.save({ useObjectStreams: false, updateFieldAppearances: false }));
        try { for (const pi of left) { const leaks = await leakCheck(await pj.getPage(pi + 1), byPage.get(pi)); if (leaks.length) raster.set(pi, `text still found under a mark (“${leaks.slice(0, 12).join('')}”)`); } }
        finally { pj.destroy?.(); }
      }
    } else for (const pi of byPage.keys()) raster.set(pi, 'rasterize chosen');
    const W = new PdfWriter(pdf); const helv = await W.font('Helvetica');
    for (const [pi, rects] of byPage) {
      const pg = pages[pi];
      if (raster.has(pi)) { await rasterizePage(d, pdf, pg, pi, rects, { dpi, keepText, fill }, W, helv); report.raster.push(pi); report.reasons[pi] = raster.get(pi); if (overlay) addOps(pdf, pg, boxOps(rects, fill, overlay, W, helv), { Font: { RF: helv.ref } }); }
      else { addOps(pdf, pg, boxOps(rects, fill, overlay, W, helv), { Font: { RF: helv.ref } }); report.removed.push(pi); }
      dropOverlapping(pdf, pg, rects, removeWidgets);
    }
    if (removeWidgets.size && pdf.catalog.get(PDFName.of('AcroForm'))) {
      const form = pdf.getForm();
      for (const f of form.getFields()) {
        const ws = f.acroField.getWidgets();
        if (ws.some(w => { const r = ctx.getObjectRef(w.dict); return r && removeWidgets.has(r.tag); })) { try { form.removeField(f); removedFields++; } catch (e) { /* ignore */ } }
      }
    }
    const annots = d.state.annots.filter(a => {
      if (a.type === 'redact') return false;
      const pi = ids.indexOf(a.page); if (!byPage.has(pi)) return true;
      return !byPage.get(pi).some(r => rectsIntersect(annotRect(a), r));
    });
    return { ids, annots };
  }, { toast: false });
  if (ok) {
    const parts = [];
    const nImg = report.images + report.imagesEdited;
    if (report.removed.length) parts.push(`content removed on ${report.removed.length} page${report.removed.length > 1 ? 's' : ''} (${report.glyphs} character${report.glyphs === 1 ? '' : 's'}${nImg ? `, ${nImg} image${nImg > 1 ? 's' : ''}` : ''}${report.paths ? `, ${report.paths} shape${report.paths > 1 ? 's' : ''}` : ''})`);
    if (report.raster.length) parts.push(`${report.raster.length} page${report.raster.length > 1 ? 's' : ''} rasterized` + (method === 'remove' ? ` (p${rangesText(report.raster)}: ${report.reasons[report.raster[0]]})` : ''));
    if (removedFields) parts.push(`${removedFields} form field${removedFields > 1 ? 's' : ''} removed`);
    Aero.toast('Redactions applied — ' + parts.join(' · '), 6000);
    report.elsewhere = await redactedElsewhere(d, quotes);
    if (report.elsewhere.length) {
      Aero.confirm('Redacted text found elsewhere', `The redacted text (“${report.elsewhere[0]}”${report.elsewhere.length > 1 ? ` and ${report.elsewhere.length - 1} more` : ''}) still appears in data stored in the file but not on the pages — for example the document properties, bookmarks or comments. Remove hidden information now?`, 'Remove Hidden Information…').then(yes => { if (yes) removeHiddenDialog(); });
    }
  }
  return ok ? report : false;
}
async function invisibleText(d, pi, rects, W, font) {
  const t = await d.getText(pi); let ops = 'BT 3 Tr ';
  const hit = (box) => rects.some(r => rectsIntersect(box, [r[0] - 0.5, r[1] - 0.5, r[2] + 0.5, r[3] + 0.5]));
  for (const it of t.items) {
    if (!it.str || !it.str.trim() || !it.width) continue;
    const T = it.transform; const sx = Math.hypot(T[0], T[1]) || 1; const ux = T[0] / sx, uy = T[1] / sx; const fh = Math.hypot(T[2], T[3]) || sx;
    const nx = -uy, ny = ux;
    const clean = W.clean(font, it.str); const chars = [...clean];
    const widths = chars.map(ch => font.widthOfTextAtSize(ch, 1)); const tot = widths.reduce((a, b) => a + b, 0) || 1;
    const tz = it.width / (tot * sx) * 100;
    let cum = 0, run = '', runStart = 0;
    const flush = () => { if (run.trim()) { const ox = T[4] + ux * runStart, oy = T[5] + uy * runStart; ops += `${f2(T[0])} ${f2(T[1])} ${f2(T[2])} ${f2(T[3])} ${f2(ox)} ${f2(oy)} Tm ${f2(tz)} Tz /RF 1 Tf ${font.encodeText(run)} Tj `; } run = ''; };
    chars.forEach((ch, k) => {
      const s = cum / tot * it.width, e = (cum + widths[k]) / tot * it.width; cum += widths[k];
      const pts = [[s, -0.25 * fh], [e, -0.25 * fh], [s, 0.95 * fh], [e, 0.95 * fh]].map(([a, b]) => [T[4] + ux * a + nx * b, T[5] + uy * a + ny * b]);
      const box = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
      if (hit(box)) { flush(); runStart = e; }
      else { if (!run) runStart = s; run += ch; }
    });
    flush();
  }
  return ops + 'ET ';
}

/* ---------- watermark ---------- */
export function watermarkDialog() {
  const d = App.doc; if (!d) return;
  const last = prefs.get('wm', { text: 'CONFIDENTIAL', size: 72, color: '#c62828', opacity: 0.18, rot: 45, pos: 'center', layer: 'over' });
  let imgData = null;
  const dlg = Aero.dialog({
    title: 'Add watermark', width: 480,
    fields: [
      { key: 'kind', label: 'Type', type: 'select', value: 'text', options: [['text', 'Text'], ['image', 'Image']] },
      { key: 'text', label: 'Text', type: 'text', value: last.text },
      { key: 'size', label: 'Font size / image width %', type: 'number', value: last.size, min: 6, max: 400 },
      { key: 'color', label: 'Color', type: 'color', value: last.color },
      { key: 'opacity', label: 'Opacity', type: 'range', value: last.opacity, min: 0.03, max: 1, step: 0.01, fmt: v => Math.round(v * 100) + '%' },
      { key: 'rot', label: 'Rotation', type: 'range', value: last.rot, min: -90, max: 90, step: 1, fmt: v => v + '°' },
      { key: 'pos', label: 'Position', type: 'select', value: last.pos, options: [['center', 'Center'], ['top', 'Top'], ['bottom', 'Bottom'], ['tile', 'Tiled']] },
      { key: 'layer', label: 'Layer', type: 'select', value: last.layer, options: [['over', 'In front of page content'], ['under', 'Behind page content']] },
      { key: 'pages', label: 'Pages', type: 'text', value: 'all' }
    ],
    html: `<div class="aero-row"><label>Image</label><button class="aero-btn small" id="wm-img">Choose image…</button><span class="val" id="wm-imgname"></span></div>`,
    ok: 'Add Watermark',
    onOK: v => {
      prefs.set('wm', { text: v.text, size: v.size, color: v.color, opacity: v.opacity, rot: v.rot, pos: v.pos, layer: v.layer });
      if (v.kind === 'image' && !imgData) { Aero.alert('Watermark', 'Choose an image first.'); return; }
      addWatermark({ ...v, image: v.kind === 'image' ? imgData : null });
    }
  });
  dlg.el.querySelector('#wm-img').onclick = async () => {
    const f = await Aero.openFile({ accept: 'image/*', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] }); if (!f[0]) return;
    try { imgData = await imageFileToDataUrl(new Uint8Array(f[0].data), f[0].name); dlg.el.querySelector('#wm-imgname').textContent = f[0].name; dlg.set('kind', 'image'); } catch (e) { Aero.alert('Watermark', e.message); }
  };
}
export function addWatermark(o) {
  const d = App.doc; let idx; try { idx = parseRanges(o.pages, d.numPages); } catch (e) { Aero.alert('Watermark', e.message); return; }
  return pageOp('Add watermark', async (pdf, refs, ids) => {
    const W = new PdfWriter(pdf); const font = await W.font('Helvetica', true);
    const img = o.image ? await W.image(o.image.dataUrl) : null;
    const pages = pdf.getPages();
    for (const i of idx) {
      const lf = pageFrame(d, i); const th = (o.rot || 0) * Math.PI / 180, cs = Math.cos(th), sn = Math.sin(th);
      let ops = `/@GS gs ${lf.m.map(f2).join(' ')} cm `;
      let iw, ih, tw, cap;
      if (img) { iw = lf.w * clampN(o.size, 5, 100) / 100; ih = iw * img.height / img.width; }
      else { tw = font.widthOfTextAtSize(W.clean(font, o.text), o.size); cap = o.size * 0.72; }
      const bw = img ? iw : tw, bh = img ? ih : cap;
      const at = (cx, cy) => {
        const ox = cx - (cs * bw / 2 - sn * bh / 2), oy = cy - (sn * bw / 2 + cs * bh / 2);
        if (img) return `q ${f2(cs)} ${f2(sn)} ${f2(-sn)} ${f2(cs)} ${f2(ox)} ${f2(oy)} cm ${f2(iw)} 0 0 ${f2(ih)} 0 0 cm /@Im Do Q `;
        return `BT ${rgbOp(o.color)} rg /@F ${f2(o.size)} Tf ${f2(cs)} ${f2(sn)} ${f2(-sn)} ${f2(cs)} ${f2(ox)} ${f2(oy)} Tm ${font.encodeText(W.clean(font, o.text))} Tj ET `;
      };
      if (o.pos === 'tile') { const sx = bw * Math.abs(cs) + bh * Math.abs(sn) + 60, sy = bw * Math.abs(sn) + bh * Math.abs(cs) + 60; for (let y = sy / 2; y < lf.h + sy; y += sy) for (let x = sx / 2 - ((Math.round(y / sy) % 2) * sx / 2); x < lf.w + sx; x += sx) ops += at(x, y); }
      else ops += at(lf.w / 2, o.pos === 'top' ? lf.h - bh / 2 - 36 : o.pos === 'bottom' ? bh / 2 + 36 : lf.h / 2);
      addOps(pdf, pages[i], ops, { Font: { F: font.ref }, ExtGState: { GS: { Type: 'ExtGState', ca: o.opacity, CA: o.opacity } }, XObject: img ? { Im: img.ref } : {} }, o.layer === 'under');
    }
    return { ids };
  });
}
const clampN = (v, a, b) => Math.max(a, Math.min(b, +v || a));

/* ---------- header & footer / Bates ---------- */
export function headerFooterDialog() {
  const d = App.doc; if (!d) return;
  const last = prefs.get('hf', { hl: '', hc: '', hr: '{date}', fl: '{title}', fc: '', fr: 'Page {page} of {pages}', size: 9, color: '#333333', margin: 30, start: 1, bprefix: 'LUM', bstart: 1, bdigits: 6 });
  Aero.dialog({
    title: 'Header & footer', width: 560,
    instruction: 'Add text to the top and bottom of each page',
    fields: [
      { key: 'hl', label: 'Header left', type: 'text', value: last.hl }, { key: 'hc', label: 'Header center', type: 'text', value: last.hc }, { key: 'hr', label: 'Header right', type: 'text', value: last.hr },
      { key: 'fl', label: 'Footer left', type: 'text', value: last.fl }, { key: 'fc', label: 'Footer center', type: 'text', value: last.fc }, { key: 'fr', label: 'Footer right', type: 'text', value: last.fr },
      { key: 'size', label: 'Font size', type: 'number', value: last.size, min: 5, max: 36 }, { key: 'color', label: 'Color', type: 'color', value: last.color },
      { key: 'margin', label: 'Margin (pt)', type: 'number', value: last.margin, min: 4, max: 200 }, { key: 'start', label: 'First page number', type: 'number', value: last.start, min: 0 },
      { key: 'bprefix', label: 'Bates prefix', type: 'text', value: last.bprefix }, { key: 'bstart', label: 'Bates start', type: 'number', value: last.bstart, min: 0 }, { key: 'bdigits', label: 'Bates digits', type: 'number', value: last.bdigits, min: 1, max: 12 },
      { key: 'pages', label: 'Pages', type: 'text', value: 'all' }
    ],
    html: `<div class="dnote">Tokens: <b>{page}</b> <b>{pages}</b> <b>{date}</b> <b>{title}</b> <b>{file}</b> <b>{bates}</b> (Bates number, e.g. LUM000001)</div>`,
    ok: 'Add',
    onOK: v => { prefs.set('hf', v); addHeaderFooter(v); }
  });
}
export function addHeaderFooter(o) {
  const d = App.doc; let idx; try { idx = parseRanges(o.pages || 'all', d.numPages); } catch (e) { Aero.alert('Header & footer', e.message); return; }
  return pageOp('Add header & footer', async (pdf, refs, ids) => {
    const W = new PdfWriter(pdf); const font = await W.font('Helvetica'); const pages = pdf.getPages();
    const date = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    idx.forEach((i, k) => {
      const lf = pageFrame(d, i); const size = +o.size || 9, m = +o.margin || 30;
      const bates = (o.bprefix || '') + String((+o.bstart || 0) + k).padStart(+o.bdigits || 6, '0');
      const sub = s => String(s || '').replace(/\{page\}/g, (+o.start || 0) + k).replace(/\{pages\}/g, (+o.start || 0) + idx.length - 1).replace(/\{date\}/g, date)
        .replace(/\{title\}/g, d.state.props.title || Aero.baseName(d.name)).replace(/\{file\}/g, d.name).replace(/\{bates\}/g, bates);
      let ops = `${lf.m.map(f2).join(' ')} cm BT ${rgbOp(o.color)} rg /@F ${f2(size)} Tf `;
      const put = (txt, where, top) => {
        txt = W.clean(font, sub(txt)); if (!txt) return; const tw = font.widthOfTextAtSize(txt, size);
        const x = where === 'l' ? m : where === 'c' ? (lf.w - tw) / 2 : lf.w - m - tw; const y = top ? lf.h - m + size * 0.2 - size : m - size * 0.2;
        ops += `1 0 0 1 ${f2(x)} ${f2(y)} Tm ${font.encodeText(txt)} Tj `;
      };
      put(o.hl, 'l', 1); put(o.hc, 'c', 1); put(o.hr, 'r', 1); put(o.fl, 'l', 0); put(o.fc, 'c', 0); put(o.fr, 'r', 0);
      addOps(pdf, pages[i], ops + 'ET', { Font: { F: font.ref } }, false);
    });
    return { ids };
  });
}

/* ---------- properties ---------- */
export function propertiesDialog() {
  const d = App.doc; if (!d) return;
  const p = d.state.props; const b = d.state.bytes;
  const ver = new TextDecoder().decode(b.subarray(0, 12)).match(/%PDF-(\d\.\d)/)?.[1] || '?';
  const inf = d.info[V.cur]; const w = inf.w / 72, h = inf.h / 72;
  d.pdf.getMetadata().catch(() => ({})).then(md => {
    const i = md?.info || {};
    Aero.dialog({
      title: 'Document properties', width: 520,
      fields: [{ key: 'title', label: 'Title', type: 'text', value: p.title || '' }, { key: 'author', label: 'Author', type: 'text', value: p.author || '' }, { key: 'subject', label: 'Subject', type: 'text', value: p.subject || '' }, { key: 'keywords', label: 'Keywords', type: 'text', value: p.keywords || '' }],
      html: `<div class="dnote" style="color:#333;line-height:1.7"><b>File:</b> ${esc(d.name)}<br><b>Size:</b> ${fmtBytes(b.length)} · <b>Pages:</b> ${d.numPages} · <b>PDF version:</b> ${ver}<br><b>Page size:</b> ${w.toFixed(2)} × ${h.toFixed(2)} in (${Math.round(inf.w)} × ${Math.round(inf.h)} pt)<br><b>Creator:</b> ${esc(i.Creator || '—')} · <b>Producer:</b> ${esc(i.Producer || '—')}<br><b>Annotations:</b> ${d.state.annots.length} · <b>Form fields changed:</b> ${Object.keys(d.state.form).length}</div>`,
      onOK: v => {
        if (['title', 'author', 'subject', 'keywords'].every(k => (p[k] || '') === v[k])) return;
        d.state.props = { title: v.title, author: v.author, subject: v.subject, keywords: v.keywords }; d.commit('Document properties'); emit('props');
      }
    });
  });
}

/* ---------- optimize (downsample images) ---------- */
export function optimizeDialog() {
  const d = App.doc; if (!d) return;
  Aero.dialog({
    title: 'Reduce file size', instruction: 'Downsample large images and remove unused objects',
    fields: [{ key: 'max', label: 'Max image size (px)', type: 'select', value: '1600', options: [['1000', '1000 px (smallest)'], ['1600', '1600 px'], ['2400', '2400 px (best quality)']] }, { key: 'q', label: 'JPEG quality', type: 'range', value: 0.75, min: 0.4, max: 0.95, step: 0.05, fmt: v => Math.round(v * 100) + '%' }],
    ok: 'Optimize', onOK: v => optimize({ maxPx: +v.max, quality: v.q })
  });
}
export async function optimize({ maxPx = 1600, quality = 0.75 } = {}) {
  const d = App.doc; const before = d.state.bytes.length; let n = 0, scanned = 0;
  const ok = await pageOp('Reduce file size', async (pdf, refs, ids) => {
    const ctx = pdf.context;
    for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream)) continue;
      const dict = obj.dict; if (dict.lookup(PDFName.of('Subtype'))?.toString() !== '/Image') continue;
      scanned++;
      const w = dict.lookup(PDFName.of('Width'))?.asNumber?.(), h = dict.lookup(PDFName.of('Height'))?.asNumber?.();
      if (!w || !h || dict.lookup(PDFName.of('ImageMask'))?.toString() === 'true' || dict.get(PDFName.of('Decode'))) continue;
      const filter = dict.lookup(PDFName.of('Filter')); const fname = filter instanceof PDFArray ? (filter.size() === 1 ? filter.get(0).toString() : 'multi') : filter?.toString();
      const cs = dict.lookup(PDFName.of('ColorSpace')); let comps = 0;
      const csName = cs?.toString?.();
      if (csName === '/DeviceRGB') comps = 3; else if (csName === '/DeviceGray') comps = 1;
      else if (cs instanceof PDFArray && cs.get(0)?.toString() === '/ICCBased') { const icc = ctx.lookup(cs.get(1)); const N = icc?.dict?.lookup(PDFName.of('N'))?.asNumber?.(); if (N === 3 || N === 1) comps = N; }
      if (!comps) continue;
      const bpc = dict.lookup(PDFName.of('BitsPerComponent'))?.asNumber?.() ?? 8;
      let bmp = null;
      try {
        if (fname === '/DCTDecode') {
          if (Math.max(w, h) <= maxPx && obj.contents.length < w * h * 0.25) continue;
          bmp = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' }));
        } else if (fname === '/FlateDecode' && bpc === 8) {
          const parms = dict.lookup(PDFName.of('DecodeParms')); if (parms instanceof PDFDict && (parms.lookup(PDFName.of('Predictor'))?.asNumber?.() || 1) > 1) continue;
          if (w * h < 250000) continue;
          const raw = L.decodePDFRawStream(obj).decode(); if (raw.length < w * h * comps) continue;
          const id = new ImageData(w, h); const px = id.data;
          for (let k = 0, j = 0; k < w * h; k++) { if (comps === 3) { px[j++] = raw[k * 3]; px[j++] = raw[k * 3 + 1]; px[j++] = raw[k * 3 + 2]; } else { const g = raw[k]; px[j++] = g; px[j++] = g; px[j++] = g; } px[j++] = 255; }
          bmp = await createImageBitmap(id);
        } else continue;
      } catch (e) { continue; }
      const sc = Math.min(1, maxPx / Math.max(w, h)); const nw = Math.max(1, Math.round(w * sc)), nh = Math.max(1, Math.round(h * sc));
      const c = document.createElement('canvas'); c.width = nw; c.height = nh; const g = c.getContext('2d');
      g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, nw, nh); bmp.close?.();
      const jpg = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', quality))).arrayBuffer()); c.width = 0;
      if (jpg.length >= obj.contents.length * 0.9) continue;
      const nd = dict.clone(ctx);
      nd.set(PDFName.of('Width'), PDFNumber.of(nw)); nd.set(PDFName.of('Height'), PDFNumber.of(nh));
      nd.set(PDFName.of('Filter'), PDFName.of('DCTDecode')); nd.delete(PDFName.of('DecodeParms'));
      nd.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB')); nd.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8)); nd.set(PDFName.of('Length'), PDFNumber.of(jpg.length));
      ctx.assign(ref, PDFRawStream.of(nd, jpg)); n++;
    }
    return { ids };
  }, { toast: false });
  if (ok) { const after = d.state.bytes.length; Aero.alert('Reduce file size', `${n} of ${scanned} image${scanned === 1 ? '' : 's'} downsampled — file size ${fmtBytes(before)} → ${fmtBytes(after)} (${after < before ? '−' + Math.round((1 - after / before) * 100) : '+' + Math.round((after / before - 1) * 100)}%).`); }
  return { n, scanned, before, after: d.state.bytes.length };
}

/* ---------- flatten ---------- */
export async function flatten() {
  const d = App.doc; if (!d || d.readOnly) return;
  if (!(await Aero.confirm('Flatten', 'Merge all annotations, signatures and form fields into the page content? They will no longer be editable.', 'Flatten'))) return;
  Aero.busy('Flattening…');
  try {
    const { bytes, warnings } = await buildOutput(d.state, { flatten: true });
    d.state.form = {};
    await applyNewBytes(d, bytes, d.state.pageIds.slice(), 'Flatten', { annots: [] });
    Aero.toast(warnings.length ? 'Flattened with warnings: ' + warnings[0] : 'Annotations and form fields flattened');
  } catch (e) { Aero.alert('Flatten', e.message); } finally { Aero.busy(); }
}
export { dataUrlToBytes, gc };
