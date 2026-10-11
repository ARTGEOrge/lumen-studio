// Lumen PDF — app shell: menus, tabs, open/save, undo/redo, navigation, wiring between modules.
import { App, emit, on } from './state.js';
import { Doc, importDocument, releaseBytes } from './doc.js';
import { V, rebuild, layout, setZoom, zoomBy, setMode, rotateView, goTo, drawAllAnnots, drawAnnots, syncForms, zoomPct, PT, schedule, whenRendered, vp, clientToPdf } from './viewer.js';
import { initTools, setTool, select, deleteAnnot, addAnnot, markupFromSelection, finishEdit, TOOLS, replaceAnnot } from './tools.js';
import { renderCmdbar } from './cmdbar.js';
import { renderThumbs, renderOutline, renderComments, renderHistory, refreshThumbAnnots } from './panels.js';
import { openOrganizer, closeOrganizer, O, rotatePages, deletePages, duplicatePages, insertBlank, insertFromPdf, extractPages, splitDialog, cropDialog, orgSelectAll, renderOrganizer, splitDoc, applyNewBytes, movePages } from './organize.js';
import { applyRedactionsDialog, applyRedactions, watermarkDialog, addWatermark, headerFooterDialog, addHeaderFooter, propertiesDialog, optimizeDialog, optimize, flatten } from './ops.js';
import { buildOutput } from './writer.js';
import { signatureManager, typedSignature } from './sign.js';
import { buildSample } from './sample.js';
import { pdfFromImages, combineFiles, combineDialog, blankPdf, preparePrint, isPdf, isImageName, SIZES } from './create.js';
import { openFind, closeFind, search, step as findStep } from './find.js';
import { esc, fmtBytes, prefs, uid, imageFileToDataUrl, clamp } from './util.js';
import { loadPdf } from './pdfjs.js';
import { annotRect } from './annots.js';
import { ocrDialog, runOcr } from './ocr.js';

const $ = id => document.getElementById(id);
const ICON = '../kit/icons/pdf.png';
// restore saved tool options
const savedOpts = prefs.get('opts', null);
if (savedOpts) for (const k of Object.keys(App.opts)) if (savedOpts[k]) Object.assign(App.opts[k], savedOpts[k]);

/* ---------------- documents & tabs ---------------- */
export async function openBytes(bytes, name = 'Document.pdf', path = null, extraAnnots = null) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!isPdf(bytes)) { Aero.alert('Open', `“${name}” is not a PDF file.`); return null; }
  Aero.busy(`Opening ${name}…`);
  const d = new Doc(name); d.path = path;
  d.onPassword = (cb, reason, task) => { Aero.busy(); Aero.prompt(reason === 2 ? 'Incorrect password' : 'Password required', `“${name}” is password protected. Enter the password:`, '').then(p => { if (p == null) task.destroy(); else { Aero.busy('Opening…'); cb(p); } }); };
  try {
    const imp = await importDocument(bytes);
    d.readOnly = imp.readOnly || false;
    d.state = { bytes: imp.bytes, pageIds: imp.pageIds || [], annots: imp.annots, form: {}, props: imp.props || {} };
    await d.loadBytes(d.state.bytes);
    if (extraAnnots) for (const a of extraAnnots) { const { pageIndex, ...rest } = a; d.state.annots.push({ id: uid(), replies: [], contents: '', ...rest, page: d.state.pageIds[pageIndex] }); }
    if (d.readOnly && !imp.props?.title) { try { const md = await d.pdf.getMetadata(); d.state.props = { title: md.info?.Title || '', author: md.info?.Author || '', subject: md.info?.Subject || '', keywords: md.info?.Keywords || '' }; } catch (e) { /* ignore */ } }
    d.hist = new Aero.History({ max: 60, onChange: () => { if (d === App.doc) renderHistory(); } });
    d.hist.reset('Open', d.snapshot());
    App.docs.push(d); activate(d);
    if (d.readOnly) Aero.toast(d.readOnly === 'encrypted' ? 'Encrypted PDF opened read-only (view, search and print only)' : 'This PDF is damaged; opened read-only', 4500);
    return d;
  } catch (e) {
    console.warn(e);
    if (!/destroy|cancel/i.test(e?.message || '')) Aero.alert('Open', `Could not open “${name}”: ${e.message || e}`);
    return null;
  } finally { Aero.busy(); }
}
function activate(d) {
  finishEdit();
  if (App.doc && App.doc !== d) { App.doc.view.page = V.cur; App.doc.view.scroll = $('scroller').scrollTop; }
  App.doc = d; App.sel = null;
  if (App.organize && !d) closeOrganizer();
  App.find.matches = []; App.find.cur = -1;
  showWelcome(!d);
  if (d) { Aero.setDoc(d.name, d.dirty); }
  else Aero.setDoc('', false);
  docChanged();
  renderTabs();
}
function docChanged() {
  const d = App.doc;
  rebuild(); renderThumbs(); renderOutline(); $('comments').scrollTop = 0; renderComments(); renderHistory(); renderCmdbar(); updateStatus(); updateNav();
  if (App.organize) renderOrganizer();
  if (d) releaseBytes(App.docs.map(x => x.state.bytes));
}
on('docChanged', () => { docChanged(); renderTabs(); });
function renderTabs() {
  const el = $('doctabs');
  el.innerHTML = App.docs.map(d => `<div class="aero-tab${d === App.doc ? ' on' : ''}${d.dirty ? ' dirty' : ''}" data-id="${d.id}" title="${esc(d.path || d.name)}"><img src="${ICON}" alt=""><span class="nm">${esc(d.name)}</span><span class="x" title="Close (Ctrl+W)">×</span></div>`).join('');
}
$('doctabs').addEventListener('click', e => {
  const t = e.target.closest('.aero-tab'); if (!t) return; const d = App.docs.find(x => x.id === t.dataset.id);
  if (e.target.classList.contains('x')) closeDoc(d); else if (d !== App.doc) activate(d);
});
$('doctabs').addEventListener('auxclick', e => { if (e.button === 1) { const t = e.target.closest('.aero-tab'); const d = t && App.docs.find(x => x.id === t.dataset.id); if (d) closeDoc(d); } });
export async function closeDoc(d = App.doc) {
  if (!d) return;
  if (d.dirty && !(await Aero.confirm('Close document', `“${d.name}” has unsaved changes. Close it and discard them?`, 'Discard changes'))) return;
  const k = App.docs.indexOf(d); App.docs.splice(k, 1);
  if (App.doc === d) activate(App.docs[Math.min(k, App.docs.length - 1)] || null); else renderTabs();
}
function showWelcome(show) {
  $('welcome').hidden = !show; $('scroller').hidden = show || App.organize; $('navpill').hidden = show || App.organize;
  if (show) { $('findbar').hidden = true; if (App.organize) closeOrganizer(); }
}
function markDirty() { const d = App.doc; if (!d) return; Aero.setDoc(d.name, d.dirty); renderTabs(); }

/* ---------------- open / save ---------------- */
async function openDialog() {
  const files = await Aero.openFile({ accept: '.pdf,application/pdf,image/*', filters: [{ name: 'PDF documents', extensions: ['pdf'] }, { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }], multiple: !Aero.isDesktop });
  await openFiles(files);
}
async function openFiles(files) {
  const imgs = files.filter(f => !isPdf(new Uint8Array(f.data)) && isImageName(f.name));
  for (const f of files) { if (isPdf(new Uint8Array(f.data))) await openBytes(f.data, f.name, f.path); else if (!imgs.includes(f)) Aero.alert('Open', `“${f.name}” is not a PDF or image file.`); }
  if (imgs.length) createFromImagesDialog(imgs);
}
export async function openSample() {
  Aero.busy('Building sample…');
  try { const { bytes, annots } = await buildSample(); Aero.busy(); const d = await openBytes(bytes, 'Northwind Services Agreement.pdf', null, annots); if (d) { d.hist.reset('Open sample', d.snapshot()); renderHistory(); renderComments(); drawAllAnnots(); refreshThumbAnnots(); } return d; }
  finally { Aero.busy(); }
}
async function newBlank() { const b = await blankPdf(prefs.get('pagesize', 'letter')); return openBytes(b, 'Untitled.pdf'); }
export async function save(as = false) {
  const d = App.doc; if (!d) return false;
  if (d.readOnly) { Aero.alert('Save', 'This document was opened read-only (encrypted or damaged) and cannot be re-saved with changes.'); return false; }
  finishEdit();
  let name = /\.pdf$/i.test(d.name) ? d.name : d.name + '.pdf';
  if (as && !Aero.isDesktop) { const n = await Aero.prompt('Save As', 'File name', name); if (!n) return false; name = /\.pdf$/i.test(n) ? n : n + '.pdf'; }
  Aero.busy('Saving…');
  try {
    const { bytes, warnings } = await buildOutput(d.state);
    Aero.busy();
    const p = await Aero.saveFile({ name, data: bytes, filters: [{ name: 'PDF document', extensions: ['pdf'] }], path: as ? null : d.path });
    if (!p) return false;
    if (Aero.isDesktop) { d.path = p; d.name = String(p).replace(/^.*[\\/]/, ''); } else d.name = name;
    d.dirty = false; window.__lumenLastSaved = bytes; markDirty();
    Aero.toast(`Saved ${d.name} (${fmtBytes(bytes.length)})` + (warnings.length ? ' — ' + warnings[0] : ''));
    return true;
  } catch (e) { console.warn(e); Aero.alert('Save', 'Could not save: ' + e.message); return false; }
  finally { Aero.busy(); }
}
async function saveFlattenedCopy() {
  const d = App.doc; if (!d || d.readOnly) return;
  Aero.busy('Flattening…');
  try { const { bytes } = await buildOutput(d.state, { flatten: true }); Aero.busy(); await Aero.saveFile({ name: Aero.baseName(d.name) + ' (flattened).pdf', data: bytes, filters: [{ name: 'PDF document', extensions: ['pdf'] }] }); }
  catch (e) { Aero.alert('Save flattened copy', e.message); } finally { Aero.busy(); }
}
async function exportPng() {
  const d = App.doc; if (!d) return;
  Aero.dialog({
    title: 'Export page as image', fields: [{ key: 'page', label: 'Page', type: 'number', value: V.cur + 1, min: 1, max: d.numPages }, { key: 'dpi', label: 'Resolution', type: 'select', value: '150', options: [['72', '72 dpi'], ['150', '150 dpi'], ['300', '300 dpi']] }, { key: 'ann', label: 'Include annotations', type: 'checkbox', value: true }],
    onOK: async v => {
      Aero.busy('Rendering…');
      try {
        const { bytes } = await buildOutput(d.state, v.ann ? {} : { annots: false });
        const pdf = await loadPdf(bytes); const page = await pdf.getPage(clamp(v.page | 0, 1, d.numPages));
        const vpp = page.getViewport({ scale: +v.dpi / 72 }); const c = document.createElement('canvas'); c.width = Math.ceil(vpp.width); c.height = Math.ceil(vpp.height);
        const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
        await page.render({ canvas: c, viewport: vpp }).promise; (pdf.destroy ? pdf.destroy() : pdf.loadingTask.destroy());
        const blob = await new Promise(r => c.toBlob(r, 'image/png'));
        Aero.busy(); await Aero.saveFile({ name: `${Aero.baseName(d.name)} - page ${v.page}.png`, data: blob, filters: [{ name: 'PNG image', extensions: ['png'] }] });
      } catch (e) { Aero.alert('Export', e.message); } finally { Aero.busy(); }
    }
  });
}
async function exportText() {
  const d = App.doc; if (!d) return;
  Aero.busy('Extracting text…');
  try {
    let out = '';
    for (let i = 0; i < d.numPages; i++) { const t = await d.getPage(i).then(p => p.getTextContent()); out += `--- Page ${i + 1} ---\n` + t.items.map(it => it.str + (it.hasEOL ? '\n' : '')).join('') + '\n\n'; }
    Aero.busy(); await Aero.saveFile({ name: Aero.baseName(d.name) + '.txt', data: out, filters: [{ name: 'Text', extensions: ['txt'] }] });
  } finally { Aero.busy(); }
}
async function print() {
  const d = App.doc; if (!d) return;
  Aero.busy('Preparing to print…');
  let job;
  try { const { bytes } = await buildOutput(d.state); job = await preparePrint(bytes, 150); }
  catch (e) { Aero.busy(); Aero.alert('Print', e.message); return; }
  Aero.busy();
  const done = () => { removeEventListener('afterprint', done); setTimeout(() => job.cleanup(), 500); };
  addEventListener('afterprint', done);
  window.print();
}

/* ---------------- create ---------------- */
async function createFromImagesDialog(files) {
  if (!files) { files = await Aero.openFile({ accept: 'image/*', multiple: true, filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }] }); if (!files.length) return; }
  Aero.dialog({
    title: 'PDF from images', instruction: `Create a PDF from ${files.length} image${files.length > 1 ? 's' : ''}`,
    fields: [{ key: 'size', label: 'Page size', type: 'select', value: 'fit', options: [['fit', 'Fit to image'], ['letter', 'Letter (8.5 × 11 in)'], ['a4', 'A4'], ['legal', 'Legal'], ['a5', 'A5']] }, { key: 'orient', label: 'Orientation', type: 'select', value: 'auto', options: [['auto', 'Automatic'], ['portrait', 'Portrait'], ['landscape', 'Landscape']] }, { key: 'margin', label: 'Margin (pt)', type: 'number', value: 0, min: 0, max: 144 }, { key: 'ocr', label: 'Recognize text (OCR)', type: 'checkbox', value: prefs.get('imgOcr', false) }],
    ok: 'Create',
    onOK: async v => {
      Aero.busy('Creating PDF…');
      try { const b = await pdfFromImages(files, { size: v.size, orient: v.orient, margin: v.margin }); Aero.busy(); const d = await openBytes(b, files.length === 1 ? Aero.baseName(files[0].name) + '.pdf' : 'Images.pdf'); if (d) { d.dirty = true; markDirty(); } prefs.set('imgOcr', !!v.ocr); if (d && v.ocr) await runOcr({ pages: 'all', dpi: 300, skipText: false }); }
      catch (e) { Aero.alert('PDF from images', e.message); } finally { Aero.busy(); }
    }
  });
}
async function combineFilesUI() {
  const files = await Aero.openFile({ accept: '.pdf,application/pdf,image/*', multiple: true });
  if (!files.length) return;
  combineDialog(files, async list => {
    if (!list.length) return;
    Aero.busy('Combining…');
    try { const { bytes, skipped } = await combineFiles(list); Aero.busy(); const d = await openBytes(bytes, 'Combined.pdf'); if (d) { d.dirty = true; markDirty(); } if (skipped.length) Aero.toast('Skipped: ' + skipped.join(', '), 5000); }
    catch (e) { Aero.alert('Combine files', e.message); } finally { Aero.busy(); }
  });
}

/* ---------------- undo / redo ---------------- */
async function restore(s) {
  const d = App.doc; if (!s || !d) return;
  finishEdit();
  const changed = await d.restore(s); App.sel = null;
  if (changed) docChanged(); else { drawAllAnnots(); syncForms(); renderComments(); refreshThumbAnnots(); renderCmdbar(); }
  markDirty();
}
const undo = () => { const d = App.doc; if (!d) return; finishEdit(); const s = d.hist.undo(); if (s) restore(s); };
const redo = () => { const d = App.doc; if (!d) return; finishEdit(); const s = d.hist.redo(); if (s) restore(s); };
on('histGo', i => { const d = App.doc; if (d) { const s = d.hist.go(i); if (s) restore(s); } });

/* ---------------- events from modules ---------------- */
on('annots', () => { renderComments(); refreshThumbAnnots(); markDirty(); updateStatus(); });
on('sel', () => renderComments());
on('page', () => { updateStatus(); updateNav(); });
on('zoom', () => { updateStatus(); updateNav(); });
on('props', () => markDirty());
on('openBytes', ({ bytes, name }) => openBytes(bytes, name).then(d => { if (d) { d.dirty = true; markDirty(); } }));
on('goto', i => goTo(i));
on('openUrl', url => openUrl(url));
on('needSignature', () => { signatureManager(); });
on('signatureReady', () => { if (App.tool !== 'sign') setTool('sign'); renderCmdbar(); Aero.toast('Click on the page to place your signature'); });
on('needImage', () => pickImage());
on('cropRect', r => cropDialog(r));
on('action', act => ({ signatures: () => signatureManager(), pickimage: () => pickImage(), applyredact: () => applyRedactionsDialog(), cropdialog: () => cropDialog(null) })[act]?.());
async function pickImage() {
  const f = await Aero.openFile({ accept: 'image/*', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }] });
  if (!f[0]) { if (App.tool === 'image') setTool('select'); return; }
  try { App.pendingImage = await imageFileToDataUrl(new Uint8Array(f[0].data), f[0].name); if (App.tool !== 'image') setTool('image'); Aero.toast('Click on the page to place the image'); }
  catch (e) { Aero.alert('Image', e.message); }
}
function openUrl(url) {
  if (!/^(https?:|mailto:)/i.test(url)) { Aero.alert('Link', 'This link uses an unsupported scheme and was not opened:\n' + url); return; }
  Aero.confirm('Open link', `Open this link in your browser?\n${url}`, 'Open').then(ok => { if (ok) window.open(url, '_blank', 'noopener'); });
}
// links
$('pages').addEventListener('click', async e => {
  const a = e.target.closest('.links a'); if (!a) return; e.preventDefault();
  const d = App.doc;
  if (a.dataset.url) return openUrl(a.dataset.url);
  if (a.dataset.dest) { const r = await d.resolveDest(JSON.parse(a.dataset.dest)); if (r) goTo(r.page, r.top); return; }
  const act = a.dataset.action;
  if (act === 'NextPage') goTo(V.cur + 1); else if (act === 'PrevPage') goTo(V.cur - 1); else if (act === 'FirstPage') goTo(0); else if (act === 'LastPage') goTo(d.numPages - 1);
});
// form fields
$('pages').addEventListener('change', e => {
  const el = e.target.closest('.forms [data-name]'); if (!el) return;
  const d = App.doc; if (d.readOnly) { syncForms(); Aero.toast('This document is read-only'); return; }
  const name = el.dataset.name;
  const v = el.dataset.kind === 'check' ? el.checked : el.dataset.kind === 'radio' ? el.value : el.value;
  d.state.form[name] = v; d.commit(`Fill “${name}”`); syncForms(); markDirty();
});

/* ---------------- status / nav ---------------- */
function updateStatus() {
  const d = App.doc;
  if (!d) { $('st-page').textContent = 'No document'; $('st-zoom').textContent = ''; $('st-size').textContent = ''; $('st-msg').textContent = 'Open a PDF or try the sample'; return; }
  const inf = d.info[V.cur] || d.info[0];
  $('st-page').textContent = `Page ${V.cur + 1} of ${d.numPages}`;
  $('st-zoom').textContent = zoomPct() + '%';
  $('st-size').textContent = inf ? `${(inf.w / 72).toFixed(2)} × ${(inf.h / 72).toFixed(2)} in` : '';
  $('st-msg').textContent = d.readOnly ? 'Read-only' : `${fmtBytes(d.state.bytes.length)} · ${d.state.annots.length} annotation${d.state.annots.length === 1 ? '' : 's'}`;
}
const zoomSel = $('nv-zoom');
function updateNav() {
  const d = App.doc; if (!d) return;
  $('nv-page').value = V.cur + 1; $('nv-count').textContent = '/ ' + d.numPages;
  const z = d.view.zoom; const presets = [50, 75, 100, 125, 150, 200, 300, 400];
  zoomSel.innerHTML = `<option value="fitw">Fit Width</option><option value="fitp">Fit Page</option>` + presets.map(p => `<option value="${p / 100}">${p}%</option>`).join('') + (typeof z === 'number' && !presets.includes(Math.round(z * 100)) ? `<option value="${z}">${Math.round(z * 100)}%</option>` : '');
  zoomSel.value = typeof z === 'number' ? String(z) : z;
  if (typeof z !== 'number') zoomSel.options[z === 'fitw' ? 0 : 1].textContent = `${z === 'fitw' ? 'Fit Width' : 'Fit Page'}`;
  $('nv-mode').title = `Page layout: ${({ cont: 'continuous', single: 'single page', spread: 'two-page spread' })[d.view.mode]} (click to change)`;
}
zoomSel.onchange = () => { const v = zoomSel.value; setZoom(v === 'fitw' || v === 'fitp' ? v : +v); };
$('nv-prev').onclick = () => goTo(V.cur - (App.doc?.view.mode === 'spread' ? 2 : 1));
$('nv-next').onclick = () => goTo(V.cur + (App.doc?.view.mode === 'spread' ? 2 : 1));
$('nv-zin').onclick = () => zoomBy(1.25); $('nv-zout').onclick = () => zoomBy(0.8);
$('nv-fitw').onclick = () => setZoom('fitw'); $('nv-fitp').onclick = () => setZoom('fitp');
$('nv-mode').onclick = () => { const d = App.doc; if (!d) return; setMode({ cont: 'single', single: 'spread', spread: 'cont' }[d.view.mode]); Aero.toast(({ cont: 'Continuous scrolling', single: 'Single page', spread: 'Two-page spread' })[d.view.mode]); };
$('nv-read').onclick = () => toggleRead();
$('nv-page').addEventListener('keydown', e => { if (e.key === 'Enter') { goTo((+$('nv-page').value || 1) - 1); $('scroller').focus(); } });
function goToDialog() { const d = App.doc; if (!d) return; Aero.prompt('Go to page', `Page number (1–${d.numPages})`, String(V.cur + 1)).then(v => { if (v) goTo((+v || 1) - 1); }); }

/* ---------------- read mode ---------------- */
let preRead = null;
function toggleRead(force) {
  const on = force ?? !document.documentElement.classList.contains('readmode');
  const d = App.doc; if (!d && on) return;
  document.documentElement.classList.toggle('readmode', on);
  if (on) { preRead = { zoom: d.view.zoom, mode: d.view.mode }; d.view.mode = 'single'; d.view.zoom = 'fitp'; setMode('single'); document.documentElement.requestFullscreen?.().catch(() => { }); Aero.toast('Read mode — Esc to exit, ←/→ to turn pages'); }
  else { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => { }); if (preRead && d) { d.view.zoom = preRead.zoom; setMode(preRead.mode); } preRead = null; }
  setTimeout(() => layout(true), 60);
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.documentElement.classList.contains('readmode')) toggleRead(false); });

/* ---------------- preferences / help ---------------- */
function preferences() {
  Aero.dialog({
    title: 'Preferences', fields: [{ key: 'author', label: 'Author name (comments)', type: 'text', value: App.author }, { key: 'pagesize', label: 'New document size', type: 'select', value: prefs.get('pagesize', 'letter'), options: [['letter', 'Letter'], ['a4', 'A4'], ['legal', 'Legal'], ['a5', 'A5']] }],
    onOK: v => { App.author = v.author.trim() || 'Lumen User'; prefs.set('author', App.author); prefs.set('pagesize', v.pagesize); }
  });
}
function shortcutsDialog() {
  const rows = [['#', 'File'], ['Ctrl+O', 'Open'], ['Ctrl+S / Ctrl+Shift+S', 'Save / Save As'], ['Ctrl+P', 'Print'], ['Ctrl+W', 'Close tab'], ['Ctrl+D', 'Document properties'],
    ['#', 'View'], ['Ctrl+= / Ctrl+-', 'Zoom in / out (or Ctrl+wheel)'], ['Ctrl+0 / 1 / 2', 'Fit page / actual size / fit width'], ['Ctrl+L', 'Read mode (full screen)'], ['Ctrl+Shift+R / L', 'Rotate view'], ['PgUp / PgDn, Home / End', 'Previous / next, first / last page'], ['Ctrl+G', 'Go to page'], ['Ctrl+F, F3, Shift+F3', 'Find, next, previous'], ['Ctrl+Shift+O', 'Organize pages'],
    ['#', 'Tools'], ...TOOLS.filter(t => t && t.key).map(t => [t.key, t.title]),
    ['#', 'Editing'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Delete', 'Delete selected annotation (or pages in Organize)'], ['Arrows (+Shift)', 'Nudge selected annotation'], ['Double-click', 'Edit text box / stamp / comment'], ['Esc', 'Deselect, close find, leave read mode']];
  const html = `<div class="kbd">${rows.map(([k, v]) => k === '#' ? `<h4>${v}</h4>` : `<b>${esc(k)}</b><span>${esc(v)}</span>`).join('')}</div>`;
  Aero.dialog({ title: 'Keyboard shortcuts', html, noCancel: true, width: 560 });
}
function about() {
  Aero.dialog({
    title: 'About Lumen PDF', noCancel: true, width: 480,
    html: `<div style="display:flex;gap:14px;align-items:flex-start"><img src="${ICON}" style="width:64px;height:64px"><div><div style="font-size:20px;color:#1e395b;font-weight:300">Lumen PDF</div><div class="dim">View, annotate, fill, sign and organize PDF documents. Part of Lumen Studio.</div>
      <div class="dnote" style="color:#333">Built with pdf.js ${'6.4.299'} (Apache-2.0) for rendering and pdf-lib 1.17.1 (MIT) for writing. Signature fonts: Great Vibes, Dancing Script, Sacramento, Allura, Caveat (SIL OFL 1.1). Everything runs locally — no network access.</div></div></div>`
  });
}

/* ---------------- menus ---------------- */
const need = () => !App.doc;
const ro = () => !App.doc || App.doc.readOnly;
const tool = id => () => { if (App.doc) { if (App.organize) closeOrganizer(); setTool(id); } };
const cur = () => [V.cur];
const M = {
  File: [
    ['New Blank Document', 'Ctrl+N', newBlank], ['Open…', 'Ctrl+O', openDialog], ['Open Sample', '', openSample], { label: 'Close Tab', key: 'Ctrl+W', fn: () => closeDoc(), disabled: need }, '-',
    { label: 'Save', key: 'Ctrl+S', fn: () => save(false), disabled: ro }, { label: 'Save As…', key: 'Ctrl+Shift+S', fn: () => save(true), disabled: ro }, { label: 'Save Flattened Copy…', fn: saveFlattenedCopy, disabled: ro }, '-',
    '#Create', ['PDF from Images…', '', () => createFromImagesDialog()], ['Combine Files…', '', combineFilesUI], '-',
    '#Export', { label: 'Page as PNG Image…', fn: exportPng, disabled: need }, { label: 'Text (.txt)…', fn: exportText, disabled: need }, '-',
    { label: 'Document Properties…', key: 'Ctrl+D', fn: propertiesDialog, disabled: need }, { label: 'Print…', key: 'Ctrl+P', fn: print, disabled: need }
  ],
  Edit: [
    { label: 'Undo', key: 'Ctrl+Z', fn: undo, disabled: () => !App.doc || App.doc.hist.index <= 0 }, { label: 'Redo', key: 'Ctrl+Y/Ctrl+Shift+Z', fn: redo, disabled: () => !App.doc || App.doc.hist.index >= App.doc.hist.items.length - 1 }, '-',
    { label: 'Delete', key: 'Delete', fn: () => { if (App.organize && O.sel.size) deletePages([...O.sel].sort((a, b) => a - b)); else if (App.sel) deleteAnnot(); }, disabled: () => !App.sel && !(App.organize && O.sel.size) },
    { label: 'Select All Pages', key: 'Ctrl+Shift+A', fn: () => { if (!App.organize) openOrganizer(); orgSelectAll(); }, disabled: need }, '-',
    { label: 'Find…', key: 'Ctrl+F', fn: openFind, disabled: need }, { label: 'Find Next', key: 'F3', fn: () => findStep(1), disabled: need }, { label: 'Find Previous', key: 'Shift+F3', fn: () => findStep(-1), disabled: need }, '-',
    ['Preferences…', '', preferences]
  ],
  View: [
    { label: 'Zoom In', key: 'Ctrl+=', fn: () => zoomBy(1.25), disabled: need }, { label: 'Zoom Out', key: 'Ctrl+-', fn: () => zoomBy(0.8), disabled: need },
    { label: 'Actual Size', key: 'Ctrl+1', fn: () => setZoom(1), disabled: need }, { label: 'Fit Width', key: 'Ctrl+2', fn: () => setZoom('fitw'), disabled: need }, { label: 'Fit Page', key: 'Ctrl+0', fn: () => setZoom('fitp'), disabled: need }, '-',
    '#Page layout', { label: 'Continuous', fn: () => setMode('cont'), checked: () => App.doc?.view.mode === 'cont', disabled: need }, { label: 'Single Page', fn: () => setMode('single'), checked: () => App.doc?.view.mode === 'single', disabled: need },
    { label: 'Two-Page Spread', fn: () => setMode('spread'), checked: () => App.doc?.view.mode === 'spread', disabled: need }, { label: 'Show Cover Page in Spread', fn: () => { App.doc.view.cover = !App.doc.view.cover; setMode(App.doc.view.mode); }, checked: () => !!App.doc?.view.cover, disabled: need }, '-',
    { label: 'Rotate Clockwise', key: 'Ctrl+Shift+R', fn: () => rotateView(90), disabled: need }, { label: 'Rotate Counterclockwise', key: 'Ctrl+Shift+L', fn: () => rotateView(-90), disabled: need }, '-',
    { label: 'Read Mode', key: 'Ctrl+L', fn: () => toggleRead(), disabled: need }, '-',
    { label: 'Go to Page…', key: 'Ctrl+G', fn: goToDialog, disabled: need }, { label: 'First Page', key: 'Home', fn: () => goTo(0), disabled: need }, { label: 'Last Page', key: 'End', fn: () => goTo(App.doc.numPages - 1), disabled: need },
    { label: 'Previous Page', key: 'PageUp', fn: () => goTo(V.cur - 1), disabled: need }, { label: 'Next Page', key: 'PageDown', fn: () => goTo(V.cur + 1), disabled: need }, '-',
    { label: 'Pages & Bookmarks Panel', key: 'F4', fn: () => { $('work').classList.toggle('noleft'); layout(true); }, checked: () => !$('work').classList.contains('noleft') },
    { label: 'Comments Panel', key: 'F6', fn: () => { $('work').classList.toggle('noright'); layout(true); }, checked: () => !$('work').classList.contains('noright') }
  ],
  Comment: [
    { label: 'Highlight Selected Text', fn: () => App.doc && markupFromSelection('highlight'), disabled: ro }, { label: 'Underline Selected Text', fn: () => App.doc && markupFromSelection('underline'), disabled: ro }, { label: 'Strike Through Selected Text', fn: () => App.doc && markupFromSelection('strike'), disabled: ro }, '-',
    '#Tools', ...['highlight', 'underline', 'strike', 'note', 'freetext', 'ink', 'rect', 'ellipse', 'line', 'arrow', 'stamp'].map(id => { const t = TOOLS.find(x => x && x.id === id); return { label: t.title, key: t.key, fn: tool(id), noShortcut: true, checked: () => App.tool === id, disabled: ro }; }), '-',
    ['Author Name…', '', preferences]
  ],
  'Fill & Sign': [
    { label: 'Fill Form Fields', fn: tool('select'), disabled: need }, { label: 'Reset Form', fn: () => { const d = App.doc; if (!d || !Object.keys(d.state.form).length) return; d.state.form = {}; d.commit('Reset form'); syncForms(); markDirty(); }, disabled: () => !App.doc || !Object.keys(App.doc.state.form).length }, '-',
    { label: 'Add Text', key: 'X', fn: tool('filltext'), noShortcut: true, disabled: ro }, { label: 'Add Date', key: 'Y', fn: tool('date'), noShortcut: true, disabled: ro }, { label: 'Add Check Mark', key: 'C', fn: tool('check'), noShortcut: true, disabled: ro }, '-',
    { label: 'Sign…', key: 'G', fn: () => { if (!App.doc) return; if (App.signature) setTool('sign'); else signatureManager(); }, noShortcut: true, disabled: ro }, { label: 'Manage Signatures…', fn: () => signatureManager() }, '-',
    { label: 'Flatten Form & Annotations…', fn: flatten, disabled: ro }
  ],
  Pages: [
    { label: 'Organize Pages…', key: 'Ctrl+Shift+O', fn: () => App.organize ? closeOrganizer() : openOrganizer(), checked: () => !!App.organize, disabled: need }, '-',
    { label: 'Rotate Page Left', fn: () => rotatePages(App.organize ? [...O.sel] : cur(), -90), disabled: ro }, { label: 'Rotate Page Right', fn: () => rotatePages(App.organize ? [...O.sel] : cur(), 90), disabled: ro },
    { label: 'Duplicate Page', fn: () => duplicatePages(App.organize ? [...O.sel] : cur()), disabled: ro }, { label: 'Delete Page', fn: () => deletePages(App.organize ? [...O.sel] : cur()), disabled: ro }, '-',
    { label: 'Insert Blank Page', fn: () => insertBlank((App.organize && O.sel.size ? Math.max(...O.sel) : V.cur) + 1), disabled: ro }, { label: 'Insert Pages from PDF…', fn: () => insertFromPdf((App.organize && O.sel.size ? Math.max(...O.sel) : V.cur) + 1), disabled: ro }, '-',
    { label: 'Extract Pages…', fn: () => extractPages(App.organize && O.sel.size ? [...O.sel].sort((a, b) => a - b) : cur()), disabled: ro }, { label: 'Split Document…', fn: splitDialog, disabled: ro }, ['Merge / Combine Files…', '', combineFilesUI], '-',
    { label: 'Crop Pages…', fn: () => cropDialog(null), disabled: ro }, { label: 'Crop Tool', key: 'O', fn: tool('crop'), noShortcut: true, disabled: ro }
  ],
  Tools: [
    '#Edit page content', { label: 'Add Text to Page', fn: tool('edittext'), disabled: ro }, { label: 'Add Image to Page…', fn: () => { if (App.doc) pickImage(); }, disabled: ro },
    { label: 'Draw Shapes as Page Content', fn: () => { App.contentMode = !App.contentMode; renderCmdbar(); }, checked: () => App.contentMode }, '-',
    '#Redact', { label: 'Mark Area for Redaction', key: 'D', fn: tool('redact'), noShortcut: true, disabled: ro }, { label: 'Mark Selected Text for Redaction', fn: () => App.doc && markupFromSelection('redact'), disabled: ro }, { label: 'Apply Redactions…', fn: applyRedactionsDialog, disabled: ro }, '-',
    '#Scan & OCR', { label: 'Recognize Text (OCR)…', key: 'Ctrl+Shift+T', fn: ocrDialog, disabled: ro }, '-',
    '#Document', { label: 'Watermark…', fn: watermarkDialog, disabled: ro }, { label: 'Header & Footer / Bates…', fn: headerFooterDialog, disabled: ro }, { label: 'Reduce File Size…', fn: optimizeDialog, disabled: ro }
  ],
  Help: [['Keyboard Shortcuts', 'F1', shortcutsDialog], '-', ['About Lumen PDF', '', about]]
};

Aero.init({
  name: 'Lumen PDF', icon: ICON, menus: M,
  dropTarget: $('stage'), dropText: 'Drop PDFs to open (or images to make a PDF)',
  onDropFiles: files => openFiles(files),
  onSave: async () => { for (const d of App.docs.filter(x => x.dirty)) { activate(d); if (!(await save(false))) return false; } return true; }
});
initTools($('tools'));
Aero.shortcut('Escape', () => {
  if (document.documentElement.classList.contains('readmode')) return toggleRead(false);
  if (!$('findbar').hidden) return closeFind();
  if (App.organize) return closeOrganizer();
  if (App.sel) return select(null);
  if (App.tool !== 'select') setTool('select');
});
document.addEventListener('keydown', e => {
  if (!App.doc || App.sel || App.doc.view.mode !== 'single' || e.ctrlKey || e.altKey || e.target.matches?.('input,textarea,select') || document.querySelector('.aero-modal')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); goTo(V.cur + 1); } else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(V.cur - 1); }
});
// keep dirty markers in sync after every history change
on('tool', () => { if (App.tool === 'select' || App.tool === 'hand') document.getElementById('scroller').focus({ preventScroll: true }); });

/* ---------------- welcome ---------------- */
$('welcome').innerHTML = `<div class="wel"><h1><img src="${ICON}" alt="">Lumen PDF</h1><p>View, annotate, fill &amp; sign, and organize PDF documents — everything stays on your computer.</p>
  <div class="acts">
    <div class="act" data-w="open"><svg viewBox="0 0 32 32"><path d="M3 8h9l3 3h14v15H3z" fill="url(#gGold)" stroke="#8a5a0a"/><path d="M3 13h26" stroke="#c48b1a"/></svg><div><b>Open PDF…</b><span>Or drop files anywhere</span></div></div>
    <div class="act" data-w="sample"><svg viewBox="0 0 32 32"><path d="M7 3h13l6 6v20H7z" fill="url(#gPaper)" stroke="#5a7a9a"/><path d="M11 13h11M11 17h11M11 21h7" stroke="#3a8fe0"/><path d="M19 3v7h7" fill="none" stroke="#5a7a9a"/></svg><div><b>Open Sample</b><span>A 3-page contract with a form</span></div></div>
    <div class="act" data-w="new"><svg viewBox="0 0 32 32"><path d="M7 3h13l6 6v20H7z" fill="#fff" stroke="#5a7a9a"/><circle cx="22" cy="23" r="6" fill="url(#gGreen)" stroke="#2a6a14"/><path d="M22 20v6M19 23h6" stroke="#fff" stroke-width="1.6"/></svg><div><b>New Blank PDF</b><span>Start from an empty page</span></div></div>
    <div class="act" data-w="images"><svg viewBox="0 0 32 32"><rect x="4" y="6" width="24" height="20" rx="2" fill="url(#gPaper)" stroke="#5a7a9a"/><circle cx="11" cy="13" r="3" fill="url(#gGold)"/><path d="M5 25l8-8 5 5 4-4 6 6" fill="url(#gGreen)" stroke="#2a6a14"/></svg><div><b>PDF from Images</b><span>JPEG / PNG to PDF</span></div></div>
    <div class="act" data-w="combine"><svg viewBox="0 0 32 32"><path d="M4 5h11l3 3v13H4z" fill="url(#gPaper)" stroke="#5a7a9a"/><path d="M14 11h11l3 3v13H14z" fill="#fff" stroke="#5a7a9a"/><path d="M8 26h4l-2 3z" fill="#3a8fe0"/></svg><div><b>Combine Files</b><span>Merge PDFs and images</span></div></div>
    <div class="act" data-w="keys"><svg viewBox="0 0 32 32"><rect x="3" y="9" width="26" height="15" rx="2" fill="url(#gPaper)" stroke="#5a7a9a"/><path d="M7 13h2M11 13h2M15 13h2M19 13h2M23 13h2M7 17h2M23 17h2M11 20h10" stroke="#1c5fb4" stroke-width="1.6"/></svg><div><b>Keyboard Shortcuts</b><span>Work faster</span></div></div>
  </div><div class="tip">Annotations, stamps and signatures are saved as standard PDF annotations, so they appear in Acrobat, browsers and other viewers.</div></div>`;
$('welcome').addEventListener('click', e => { const a = e.target.closest('[data-w]')?.dataset.w; ({ open: openDialog, sample: openSample, new: newBlank, images: () => createFromImagesDialog(), combine: combineFilesUI, keys: shortcutsDialog })[a]?.(); });

activate(null);
renderCmdbar();

// Test / automation hooks
window.LumenPDF = {
  App, V, openBytes, openSample, save, buildOutput, undo, redo, setTool, addAnnot, select, deleteAnnot, markupFromSelection, search, findStep, goTo, setZoom, setMode, rotateView,
  runOcr, rotatePages, deletePages, duplicatePages, insertBlank, movePages, extractPages, splitDoc, applyRedactions, addWatermark, addHeaderFooter, optimize, flatten, combineFiles, pdfFromImages,
  preparePrint, typedSignature, whenRendered, vp, clientToPdf, openOrganizer, closeOrganizer, applyNewBytes, loadPdf, closeDoc, toggleRead, replaceAnnot, annotRect, drawAllAnnots, syncForms
};
const q = new URLSearchParams(location.search);
if (q.has('sample')) openSample();
