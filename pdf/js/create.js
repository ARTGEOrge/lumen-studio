// Create: PDF from images, combine files (PDFs + images), print, exports.
import { imageFileToDataUrl, dataUrlToBytes, esc } from './util.js';
import { loadPdf } from './pdfjs.js';
const L = window.PDFLib;
const { PDFDocument } = L;

export const SIZES = { letter: [612, 792], a4: [595.28, 841.89], legal: [612, 1008], a5: [419.53, 595.28] };
export const isPdf = b => b && b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 || (b && new TextDecoder().decode(b.subarray(0, 1024)).includes('%PDF-'));
export const isImageName = n => /\.(png|jpe?g|gif|webp|bmp)$/i.test(n);

async function embedImage(pdf, bytes, name) {
  const isJpg = bytes[0] === 0xFF && bytes[1] === 0xD8, isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  if (isJpg) return pdf.embedJpg(bytes);
  if (isPng) return pdf.embedPng(bytes);
  const conv = await imageFileToDataUrl(bytes, name); return pdf.embedPng(dataUrlToBytes(conv.dataUrl).bytes);
}
function addImagePage(pdf, img, { size = 'fit', margin = 0, orient = 'auto' } = {}) {
  let pw, ph;
  if (size === 'fit') { let s = 0.75; if (Math.max(img.width, img.height) * s > 1440) s = 1440 / Math.max(img.width, img.height); pw = img.width * s + margin * 2; ph = img.height * s + margin * 2; }
  else { [pw, ph] = SIZES[size] || SIZES.letter; const land = orient === 'landscape' || (orient === 'auto' && img.width > img.height); if (land) [pw, ph] = [ph, pw]; }
  const page = pdf.addPage([pw, ph]);
  const aw = pw - margin * 2, ah = ph - margin * 2; const s = Math.min(aw / img.width, ah / img.height);
  const w = img.width * s, h = img.height * s;
  page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
  return page;
}
// files: [{name, data}] images
export async function pdfFromImages(files, opts = {}) {
  const pdf = await PDFDocument.create();
  for (const f of files) { const img = await embedImage(pdf, new Uint8Array(f.data), f.name); addImagePage(pdf, img, opts); }
  pdf.setCreator('Lumen PDF'); pdf.setProducer('Lumen PDF'); pdf.setTitle(files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : 'Images');
  return pdf.save();
}
// files: PDFs and images in order
export async function combineFiles(files, opts = {}) {
  const out = await PDFDocument.create(); const skipped = [];
  for (const f of files) {
    const b = new Uint8Array(f.data);
    if (isPdf(b)) {
      try { const src = await PDFDocument.load(b, { updateMetadata: false }); const pages = await out.copyPages(src, src.getPageIndices()); pages.forEach(p => out.addPage(p)); }
      catch (e) { skipped.push(f.name + (/encrypt/i.test(e.message) ? ' (encrypted)' : ' (unreadable)')); }
    } else if (isImageName(f.name) || b[0] === 0xFF || b[0] === 0x89) {
      try { addImagePage(out, await embedImage(out, b, f.name), { size: opts.size || 'letter', margin: opts.margin ?? 36 }); } catch (e) { skipped.push(f.name); }
    } else skipped.push(f.name);
  }
  if (!out.getPageCount()) throw new Error('None of the files could be combined.' + (skipped.length ? ' Skipped: ' + skipped.join(', ') : ''));
  out.setCreator('Lumen PDF'); out.setProducer('Lumen PDF'); out.setTitle('Combined document');
  return { bytes: await out.save(), skipped };
}
export async function blankPdf(size = 'letter') {
  const pdf = await PDFDocument.create(); pdf.addPage(SIZES[size] || SIZES.letter); pdf.setCreator('Lumen PDF'); pdf.setProducer('Lumen PDF');
  return pdf.save();
}

// Combine dialog with re-orderable list
export function combineDialog(files, onDone) {
  const list = files.slice();
  const html = `<div class="aero-list" id="cmb-list" style="height:200px;border:1px solid #c5d5e8;margin-top:4px"></div><div style="display:flex;gap:6px;margin-top:6px"><button class="aero-btn small" data-m="-1">Move up</button><button class="aero-btn small" data-m="1">Move down</button><button class="aero-btn small" data-m="x">Remove</button><button class="aero-btn small" data-m="add">Add files…</button></div>`;
  let sel = 0;
  const dlg = Aero.dialog({ title: 'Combine files', instruction: 'Combine PDFs and images into one PDF, in this order', html, width: 520, ok: 'Combine', onOK: () => onDone(list) });
  const el = dlg.el.querySelector('#cmb-list');
  const render = () => { el.innerHTML = list.map((f, k) => `<div class="aero-item${k === sel ? ' sel' : ''}" data-k="${k}"><span class="grow">${k + 1}. ${esc(f.name)}</span><span class="dim">${isPdf(new Uint8Array(f.data)) ? 'PDF' : 'Image'}</span></div>`).join('') || '<div class="empty-note">No files</div>'; };
  el.onclick = e => { const it = e.target.closest('.aero-item'); if (it) { sel = +it.dataset.k; render(); } };
  dlg.el.querySelectorAll('[data-m]').forEach(b => b.onclick = async () => {
    const m = b.dataset.m;
    if (m === 'x') { list.splice(sel, 1); sel = Math.min(sel, list.length - 1); }
    else if (m === 'add') { const more = await Aero.openFile({ accept: '.pdf,application/pdf,image/*', multiple: true }); list.push(...more); }
    else { const j = sel + +m; if (j >= 0 && j < list.length) { [list[sel], list[j]] = [list[j], list[sel]]; sel = j; } }
    render();
  });
  render();
}

// Render pages of a PDF to images for printing
export async function preparePrint(bytes, dpi = 150) {
  const root = document.getElementById('printroot'); root.innerHTML = '';
  const pdf = await loadPdf(bytes); const urls = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i); const vp = page.getViewport({ scale: dpi / 72 });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, viewport: vp, annotationMode: 1 }).promise;
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92)); c.width = 0;
    const url = URL.createObjectURL(blob); urls.push(url);
    const img = document.createElement('img'); img.src = url; root.appendChild(img);
  }
  await Promise.all([...root.querySelectorAll('img')].map(im => im.decode().catch(() => { })));
  (pdf.destroy ? pdf.destroy() : pdf.loadingTask.destroy());
  return { count: urls.length, cleanup: () => { urls.forEach(u => URL.revokeObjectURL(u)); root.innerHTML = ''; } };
}
