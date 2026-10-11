// OCR: recognize text on scanned pages with tesseract.js (vendored locally — worker, WASM core and
// English LSTM data are all loaded from ../vendor/tesseract/, never from the network) and add an
// invisible, searchable/selectable text layer (text render mode 3) positioned over each word.
import { App } from './state.js';
import { pageOp, rangesText } from './organize.js';
import { PdfWriter } from './writer.js';
import { addOps } from './ops.js';
import { AnnotationMode } from './pdfjs.js';
import { V } from './viewer.js';
import { parseRanges, f2 } from './util.js';
import { progressDialog, Cancelled } from './progress.js';

const BASE = new URL('../vendor/tesseract/', import.meta.url).href;
let libP = null;
function loadLib() {
  if (window.Tesseract) return Promise.resolve();
  libP ||= new Promise((res, rej) => { const s = document.createElement('script'); s.src = BASE + 'tesseract.min.js'; s.onload = res; s.onerror = () => { libP = null; rej(new Error('The OCR engine files are missing from vendor/tesseract.')); }; document.head.append(s); });
  return libP;
}
export const OCR_PATHS = { workerPath: BASE + 'worker.min.js', corePath: BASE + 'core', langPath: BASE + 'lang' };
export async function createOcrWorker(logger) {
  await loadLib();
  // OEM 1 = LSTM only (matches the bundled "best_int" English model)
  return window.Tesseract.createWorker('eng', 1, { ...OCR_PATHS, gzip: true, cacheMethod: 'none', workerBlobURL: false, logger: m => logger?.(m), errorHandler: e => console.warn('OCR', e) });
}

// Render page i of the current doc and recognize it. Returns [{text, conf, p0, p1, size}] in PDF user space.
export async function recognizePage(worker, d, i, dpi = 300) {
  const page = await d.getPage(i);
  let scale = dpi / 72; const v0 = page.getViewport({ scale: 1 });
  const maxPx = 5200; scale = Math.min(scale, maxPx / Math.max(v0.width, v0.height));
  const viewport = page.getViewport({ scale });
  const c = document.createElement('canvas'); c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
  const g = c.getContext('2d', { willReadFrequently: false }); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, viewport, annotationMode: AnnotationMode.DISABLE }).promise;
  const { data } = await worker.recognize(c, {}, { text: true, blocks: true });
  c.width = 0;
  const words = [];
  const k = 1 / scale; // px -> pt
  for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const ln of p.lines || []) {
    const bl = ln.baseline || { x0: ln.bbox.x0, y0: ln.bbox.y1, x1: ln.bbox.x1, y1: ln.bbox.y1 };
    const slope = (bl.y1 - bl.y0) / Math.max(1, bl.x1 - bl.x0);
    const lineH = Math.max(4, ln.bbox.y1 - ln.bbox.y0);
    for (const w of ln.words || []) {
      const t = (w.text || '').trim(); if (!t || w.confidence < 20) continue;
      const yb = x => bl.y0 + slope * (x - bl.x0);
      const P0 = viewport.convertToPdfPoint(w.bbox.x0, yb(w.bbox.x0)), P1 = viewport.convertToPdfPoint(w.bbox.x1, yb(w.bbox.x1));
      words.push({ text: t, conf: w.confidence, p0: P0, p1: P1, size: lineH / 0.93 * k });
    }
  }
  return { words, text: data.text || '' };
}

// Invisible text operators for recognized words (Helvetica, horizontally scaled to the word width).
export function invisibleWordOps(words, font, W) {
  let ops = 'BT 3 Tr ';
  for (const w of words) {
    const txt = W.clean(font, w.text); if (!txt.trim()) continue;
    const dx = w.p1[0] - w.p0[0], dy = w.p1[1] - w.p0[1], len = Math.hypot(dx, dy); if (len < 0.5) continue;
    const ux = dx / len, uy = dy / len, size = Math.max(1, w.size);
    const tz = Math.max(1, Math.min(1000, len / Math.max(0.01, font.widthOfTextAtSize(txt, size)) * 100));
    ops += `/@F ${f2(size)} Tf ${f2(tz)} Tz ${f2(ux)} ${f2(uy)} ${f2(-uy)} ${f2(ux)} ${f2(w.p0[0])} ${f2(w.p0[1])} Tm ${font.encodeText(txt + ' ')} Tj `;
  }
  return ops + 'ET';
}

export function ocrDialog() {
  const d = App.doc; if (!d) return;
  if (d.readOnly) { Aero.alert('Recognize text', 'This document is read-only, so a text layer cannot be added.'); return; }
  Aero.dialog({
    title: 'Recognize text (OCR)', width: 500,
    instruction: 'Make scanned pages searchable and selectable',
    fields: [
      { key: 'pages', label: 'Pages', type: 'text', value: 'all' },
      { key: 'lang', label: 'Language', type: 'select', value: 'eng', options: [['eng', 'English']] },
      { key: 'dpi', label: 'Resolution', type: 'select', value: '300', options: [['200', '200 dpi (faster)'], ['300', '300 dpi (recommended)'], ['400', '400 dpi (small print)']] },
      { key: 'skip', label: 'Skip pages that already have text', type: 'checkbox', value: true }
    ],
    html: `<div class="dnote">Recognition runs entirely on this computer. An invisible text layer is added on top of each page image, so the page looks the same but can be searched, selected and copied. Pages: “all”, “1-3, 5”, “odd”…</div>`,
    ok: 'Recognize',
    onOK: v => runOcr({ pages: v.pages, dpi: +v.dpi, skipText: v.skip })
  });
}

// Run OCR on the current document. Returns {pages:[indices done], words, skipped} or null if cancelled.
export async function runOcr({ pages = 'all', dpi = 300, skipText = true, quiet = false } = {}) {
  const d = App.doc; if (!d) return null;
  let idx; try { idx = parseRanges(pages, d.numPages); } catch (e) { Aero.alert('Recognize text', e.message); return null; }
  const prog = progressDialog('Recognize text (OCR)', `Recognizing ${idx.length} page${idx.length > 1 ? 's' : ''} of “${d.name}”`);
  let worker = null; const results = new Map(); const skipped = [];
  const cancelP = new Promise((_, rej) => prog.onCancel(() => { rej(new Cancelled()); try { worker?.terminate(); } catch (e) { /* ignore */ } }));
  cancelP.catch(() => { });
  let curPage = 0, curIdx = 0;
  const logger = m => {
    if (prog.cancelled) return;
    if (m.status === 'recognizing text') prog.set((curIdx + (m.progress || 0)) / idx.length, `Page ${curPage + 1}: recognizing text… ${Math.round((m.progress || 0) * 100)}%`);
    else if (/load|initializ/i.test(m.status)) prog.set(null, m.status.replace(/^./, c => c.toUpperCase()) + '…');
  };
  try {
    prog.set(null, 'Loading the OCR engine…');
    worker = await Promise.race([createOcrWorker(logger), cancelP]);
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k]; curPage = i; curIdx = k;
      if (skipText) {
        const t = await d.getText(i);
        if (t.str.replace(/\s+/g, '').length > 20) { skipped.push(i); continue; }
      }
      prog.set(k / idx.length, `Page ${i + 1}: rendering…`);
      const r = await Promise.race([recognizePage(worker, d, i, dpi), cancelP]);
      results.set(i, r);
    }
  } catch (e) {
    prog.close(); try { await worker?.terminate(); } catch (err) { /* ignore */ }
    if (e instanceof Cancelled || prog.cancelled) { if (!quiet) Aero.toast('Text recognition cancelled — the document was not changed'); return null; }
    console.warn(e); Aero.alert('Recognize text', 'Text recognition failed: ' + (e.message || e)); return null;
  }
  prog.close(); try { await worker.terminate(); } catch (e) { /* ignore */ }
  const total = [...results.values()].reduce((s, r) => s + r.words.length, 0);
  if (!results.size || !total) {
    if (!quiet) Aero.alert('Recognize text', skipped.length === idx.length ? `All selected pages already contain text (${rangesText(skipped)}). Uncheck “Skip pages that already have text” to recognize them anyway.` : 'No text was found on the selected pages.');
    return { pages: [], words: 0, skipped };
  }
  const ok = await pageOp('Recognize text (OCR)', async (pdf, refs, ids) => {
    const W = new PdfWriter(pdf); const font = await W.font('Helvetica'); const pgs = pdf.getPages();
    for (const [i, r] of results) if (r.words.length) addOps(pdf, pgs[i], invisibleWordOps(r.words, font, W), { Font: { F: font.ref } }, false);
    return { ids };
  }, { toast: false });
  if (!ok) return null;
  V.views.forEach(pv => { pv.tl = null; });
  if (!quiet) Aero.toast(`Recognized ${total} word${total === 1 ? '' : 's'} on ${results.size} page${results.size === 1 ? '' : 's'}` + (skipped.length ? ` · skipped ${skipped.length} page${skipped.length === 1 ? '' : 's'} with text` : '') + ' — the text is now searchable', 5000);
  return { pages: [...results.keys()], words: total, skipped };
}
