// Organize pages: grid with drag-to-reorder, rotate, delete, duplicate, insert blank / from PDF,
// extract, split, crop. All page edits rewrite the PDF with pdf-lib and are undoable.
import { App, emit, on } from './state.js';
import { pushDownInherited, setPageOrder, importDocument } from './doc.js';
import { gc, buildOutput } from './writer.js';
import { thumb, thumbSvg } from './panels.js';
import { V, makeVp, layout } from './viewer.js';
import { uid, parseRanges, parseRangeGroups, clamp, esc, f2 } from './util.js';
const L = window.PDFLib;
const { PDFDocument, degrees, PDFName } = L;

const $ = id => document.getElementById(id);
const org = $('organizer'), bar = $('cmd');
export const O = { sel: new Set(), cw: 170, anchor: null };

/* ---------- core: rewrite bytes ---------- */
export async function applyNewBytes(d, bytes, pageIds, label, { annots = null, reimport = false } = {}) {
  const prev = d.state;
  let nextAnnots = annots || prev.annots.filter(a => pageIds.includes(a.page));
  if (reimport) {
    const imp = await importDocument(bytes);
    if (!imp.readOnly && imp.pageIds && imp.annots.length) {
      bytes = imp.bytes;
      const map = new Map(imp.pageIds.map((id, k) => [id, pageIds[k]]));
      nextAnnots = nextAnnots.concat(imp.annots.map(a => ({ ...a, page: map.get(a.page) })));
    }
  }
  d.state = { ...prev, bytes, pageIds, annots: nextAnnots };
  try { await d.loadBytes(bytes); }
  catch (e) { d.state = prev; await d.loadBytes(prev.bytes); throw e; }
  d.commit(label);
  emit('docChanged');
}
export async function pageOp(label, fn, opts = {}) {
  const d = App.doc; if (!d) return;
  if (d.readOnly) { Aero.alert(label, 'This document is read-only (encrypted or damaged), so its pages cannot be changed.'); return; }
  Aero.busy(label + '…');
  try {
    const pdf = await PDFDocument.load(d.state.bytes, { updateMetadata: false });
    pushDownInherited(pdf);
    const refs = pdf.getPages().map(p => p.ref);
    const res = await fn(pdf, refs.slice(), d.state.pageIds.slice());
    if (!res) return false;
    if (res.refs) setPageOrder(pdf, res.refs);
    await pdf.flush(); gc(pdf);
    const bytes = await pdf.save({ useObjectStreams: true, updateFieldAppearances: false });
    let annots = null;
    if (res.dupes) { // newId -> srcId : clone annotations onto duplicated pages
      annots = d.state.annots.filter(a => res.ids.includes(a.page));
      for (const [nid, sid] of res.dupes) annots.push(...d.state.annots.filter(a => a.page === sid).map(a => ({ ...structuredClone(a), id: uid(), page: nid })));
    }
    if (res.annots) annots = res.annots;
    await applyNewBytes(d, bytes, res.ids, label, { annots, reimport: !!res.reimport });
    if (opts.toast !== false) Aero.toast(label);
    return true;
  } catch (e) { console.warn(e); Aero.alert(label, 'Could not complete the operation: ' + e.message); return false; }
  finally { Aero.busy(); }
}

/* ---------- page operations (indices are 0-based, current order) ---------- */
export function rotatePages(idx, delta) {
  return pageOp(`Rotate ${idx.length > 1 ? idx.length + ' pages' : 'page'}`, async (pdf, refs, ids) => {
    const pages = pdf.getPages();
    for (const i of idx) { const p = pages[i]; p.setRotation(degrees((((p.getRotation().angle + delta) % 360) + 360) % 360)); }
    return { ids };
  });
}
export function deletePages(idx) {
  const d = App.doc; if (idx.length >= d.numPages) { Aero.alert('Delete pages', 'A document must keep at least one page.'); return; }
  return pageOp(`Delete ${idx.length > 1 ? idx.length + ' pages' : 'page'}`, async (pdf, refs, ids) => {
    const del = new Set(idx);
    O.sel.clear();
    return { refs: refs.filter((_, i) => !del.has(i)), ids: ids.filter((_, i) => !del.has(i)) };
  });
}
export function duplicatePages(idx) {
  return pageOp(`Duplicate ${idx.length > 1 ? idx.length + ' pages' : 'page'}`, async (pdf, refs, ids) => {
    const nr = [], ni = [], dupes = []; const set = new Set(idx);
    for (let i = 0; i < refs.length; i++) {
      nr.push(refs[i]); ni.push(ids[i]);
      if (set.has(i)) { const [cp] = await pdf.copyPages(pdf, [i]); const nid = uid(); nr.push(cp.ref); ni.push(nid); dupes.push([nid, ids[i]]); }
    }
    return { refs: nr, ids: ni, dupes };
  });
}
export function movePages(idx, to) {
  // move pages `idx` so they start at position `to` (index in the original order, before removal)
  return pageOp('Move pages', async (pdf, refs, ids) => {
    const set = new Set(idx);
    const moving = idx.map(i => [refs[i], ids[i]]);
    const before = [...Array(refs.length).keys()].filter(i => i < to && !set.has(i)).length;
    const rest = [...Array(refs.length).keys()].filter(i => !set.has(i)).map(i => [refs[i], ids[i]]);
    rest.splice(before, 0, ...moving);
    if (rest.every((x, k) => x[0] === refs[k])) return null;
    O.sel = new Set(moving.map((_, k) => before + k));
    return { refs: rest.map(x => x[0]), ids: rest.map(x => x[1]) };
  }, { toast: false });
}
export function insertBlank(at, size) {
  return pageOp('Insert blank page', async (pdf, refs, ids) => {
    const ref = pdf.getPages()[clamp(at - 1, 0, refs.length - 1)];
    const { width, height } = size || ref.getSize();
    const pg = pdf.addPage([width, height]);
    const nr = refs.slice(), ni = ids.slice(); nr.splice(at, 0, pg.ref); ni.splice(at, 0, uid());
    O.sel = new Set([at]);
    return { refs: nr, ids: ni };
  });
}
export async function insertFromPdf(at) {
  const f = await Aero.openFile({ accept: '.pdf,application/pdf', filters: [{ name: 'PDF documents', extensions: ['pdf'] }] });
  if (!f[0]) return;
  let other;
  try { other = await PDFDocument.load(new Uint8Array(f[0].data), { updateMetadata: false }); }
  catch (e) { Aero.alert('Insert pages', `“${f[0].name}” could not be read${/encrypt/i.test(e.message) ? ' because it is encrypted' : ''}.`); return; }
  const n = other.getPageCount();
  Aero.dialog({
    title: 'Insert pages', instruction: `Insert pages from “${f[0].name}” (${n} page${n > 1 ? 's' : ''})`,
    fields: [{ key: 'range', label: 'Pages to insert', type: 'text', value: `1-${n}` }, { key: 'pos', label: 'Insert', type: 'select', value: String(at), options: [['0', 'Before first page'], [String(at), `After page ${at}`], [String(App.doc.numPages), 'After last page']] }],
    onOK: v => {
      let idx; try { idx = parseRanges(v.range, n); } catch (e) { Aero.alert('Insert pages', e.message); return; }
      if (!idx.length) return;
      const pos = +v.pos;
      pageOp(`Insert ${idx.length} page${idx.length > 1 ? 's' : ''}`, async (pdf, refs, ids) => {
        const copied = await pdf.copyPages(other, idx);
        const nr = refs.slice(), ni = ids.slice();
        nr.splice(pos, 0, ...copied.map(p => p.ref)); ni.splice(pos, 0, ...copied.map(() => uid()));
        O.sel = new Set(copied.map((_, k) => pos + k));
        return { refs: nr, ids: ni, reimport: true };
      });
    }
  });
}
export async function extractPages(idx) {
  const d = App.doc; if (!idx.length) return;
  Aero.dialog({
    title: 'Extract pages', instruction: `Extract ${idx.length} page${idx.length > 1 ? 's' : ''} to a new PDF`,
    fields: [{ key: 'range', label: 'Pages', type: 'text', value: rangesText(idx) }, { key: 'open', label: 'Open in a new tab', type: 'checkbox', value: true }, { key: 'del', label: 'Delete pages after extracting', type: 'checkbox', value: false }],
    onOK: async v => {
      let sel; try { sel = parseRanges(v.range, d.numPages); } catch (e) { Aero.alert('Extract', e.message); return; }
      if (!sel.length) return;
      Aero.busy('Extracting pages…');
      try {
        const { bytes } = await buildOutput(d.state, { pages: sel });
        const name = Aero.baseName(d.name) + ` (pages ${rangesText(sel)}).pdf`;
        if (v.open) emit('openBytes', { bytes, name }); else await Aero.saveFile({ name, data: bytes, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
        if (v.del && sel.length < d.numPages) { Aero.busy(); await deletePages(sel); }
      } catch (e) { Aero.alert('Extract', e.message); } finally { Aero.busy(); }
    }
  });
}
export function splitDialog() {
  const d = App.doc; if (!d) return;
  const size = d.state.bytes.length;
  Aero.dialog({
    title: 'Split document', instruction: `Split “${d.name}” (${d.numPages} pages) into several PDFs`,
    fields: [
      { key: 'mode', label: 'Split', type: 'select', value: 'every', options: [['every', 'Every N pages'], ['ranges', 'By page ranges'], ['bookmarks', 'At each top-level bookmark'], ['size', 'By maximum file size']] },
      { key: 'n', label: 'Pages per file (N)', type: 'number', value: Math.max(1, Math.ceil(d.numPages / 2)), min: 1, max: d.numPages },
      { key: 'ranges', label: 'Ranges (e.g. 1-2, 3-5)', type: 'text', value: d.numPages > 1 ? `1-${Math.ceil(d.numPages / 2)}, ${Math.ceil(d.numPages / 2) + 1}-${d.numPages}` : '1' },
      { key: 'mb', label: 'Maximum size per file (MB)', type: 'number', value: Math.max(0.1, Math.round(size / 2 / 1048576 * 10) / 10 || 1), min: 0.05, max: 2000, step: 0.1 },
      { key: 'out', label: 'Output', type: 'select', value: 'tabs', options: [['tabs', 'Open each part in a new tab'], ['save', 'Save each part as a file']] }
    ],
    onOK: async v => {
      let parts;
      try {
        if (v.mode === 'bookmarks') {
          const sp = await bookmarkGroups(d);
          if (!sp.groups.length) { Aero.alert('Split', 'This document has no top-level bookmarks that point to its pages. Add bookmarks first (Pages › Create Bookmarks from Headings can make them for you).'); return; }
          parts = await splitDoc(d, sp.groups, sp.names);
        } else if (v.mode === 'size') {
          const mb = +v.mb; if (!(mb > 0)) throw new Error('Enter a size in MB.');
          parts = await splitBySize(d, mb * 1048576);
        } else {
          let groups;
          if (v.mode === 'every') { const n = Math.max(1, v.n | 0); groups = []; for (let i = 0; i < d.numPages; i += n) groups.push([...Array(Math.min(n, d.numPages - i)).keys()].map(k => i + k)); }
          else groups = parseRangeGroups(v.ranges, d.numPages);
          if (!groups.length) return;
          if (groups.length > 50 && !(await Aero.confirm('Split', `This creates ${groups.length} files. Continue?`))) return;
          parts = await splitDoc(d, groups);
        }
      } catch (e) { Aero.alert('Split', e.message); return; }
      if (!parts?.length) return;
      if (parts.length > 50 && v.mode !== 'every' && v.mode !== 'ranges' && !(await Aero.confirm('Split', `This creates ${parts.length} files. Continue?`))) return;
      for (const p of parts) {
        if (v.out === 'tabs') emit('openBytes', p);
        else await Aero.saveFile({ name: p.name, data: p.bytes, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
      }
      Aero.toast(`Split into ${parts.length} file${parts.length > 1 ? 's' : ''}`);
    }
  });
}
const safeName = s => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
// top-level bookmarks -> page groups (pages before the first bookmark join the first part)
export async function bookmarkGroups(d) {
  const items = (await d.getOutline()) || []; const starts = [];
  for (const it of items) { const r = it.dest ? await d.resolveDest(it.dest) : null; if (r && r.page >= 0 && r.page < d.numPages) starts.push({ page: r.page, title: it.title }); }
  starts.sort((a, b) => a.page - b.page);
  const uniq = []; for (const s of starts) if (!uniq.length || uniq[uniq.length - 1].page !== s.page) uniq.push(s);
  if (!uniq.length) return { groups: [], names: [] };
  uniq[0] = { ...uniq[0], page: 0 };
  const groups = uniq.map((s, k) => { const end = k + 1 < uniq.length ? uniq[k + 1].page : d.numPages; return [...Array(end - s.page).keys()].map(j => s.page + j); });
  const names = uniq.map((s, k) => `${Aero.baseName(d.name)} - ${String(k + 1).padStart(2, '0')} ${safeName(s.title) || 'part'}.pdf`);
  return { groups, names };
}
// greedy split: each part holds as many consecutive pages as fit under maxBytes (a single larger page gets its own part)
export async function splitBySize(d, maxBytes) {
  Aero.busy('Splitting…');
  try {
    const n = d.numPages, parts = []; const cache = new Map();
    const build = async (i, len) => { const k = i + ':' + len; if (!cache.has(k)) cache.set(k, (await buildOutput(d.state, { pages: [...Array(len).keys()].map(j => i + j) })).bytes); return cache.get(k); };
    let i = 0;
    while (i < n) {
      let good = 1, bad = null, tryLen = 2;
      if ((await build(i, 1)).length <= maxBytes) {
        while (i + good < n) { const len = Math.min(tryLen, n - i); if ((await build(i, len)).length <= maxBytes) { good = len; tryLen *= 2; } else { bad = len; break; } }
        if (bad) while (bad - good > 1) { const mid = (good + bad) >> 1; if ((await build(i, mid)).length <= maxBytes) good = mid; else bad = mid; }
      }
      const g = [...Array(good).keys()].map(j => i + j);
      parts.push({ bytes: await build(i, good), name: `${Aero.baseName(d.name)} - part ${parts.length + 1} (p${rangesText(g)}).pdf`, pages: g });
      for (const k of [...cache.keys()]) if (+k.split(':')[0] === i) cache.delete(k);
      i += good;
      if (parts.length > 500) throw new Error('The size limit is too small: more than 500 parts.');
    }
    return parts;
  } finally { Aero.busy(); }
}
export async function splitDoc(d, groups, names = null) {
  Aero.busy('Splitting…');
  try {
    const parts = [];
    for (const [k, g] of groups.entries()) {
      const { bytes } = await buildOutput(d.state, { pages: g });
      parts.push({ bytes, name: names?.[k] || `${Aero.baseName(d.name)} - part ${k + 1} (p${rangesText(g)}).pdf`, pages: g });
    }
    return parts;
  } finally { Aero.busy(); }
}
export function rangesText(idx) {
  const s = [...idx].sort((a, b) => a - b); const out = [];
  for (let k = 0; k < s.length; k++) { let j = k; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; out.push(j > k ? `${s[k] + 1}-${s[j] + 1}` : `${s[k] + 1}`); k = j; }
  return out.join(', ');
}
// Crop: rect in user space (from crop tool) or margins (display-relative, pt)
export function cropDialog(fromRect) {
  const d = App.doc; if (!d) return;
  const i = fromRect ? fromRect.page : V.cur;
  const sel = App.organize && O.sel.size ? [...O.sel] : [i];
  Aero.dialog({
    title: 'Crop pages', instruction: fromRect ? 'Crop to the rectangle you drew' : 'Trim margins from the visible page area (points, 72 pt = 1 inch)',
    fields: [
      ...(fromRect ? [] : [{ key: 'top', label: 'Top', type: 'number', value: 36, min: 0 }, { key: 'bottom', label: 'Bottom', type: 'number', value: 36, min: 0 }, { key: 'left', label: 'Left', type: 'number', value: 36, min: 0 }, { key: 'right', label: 'Right', type: 'number', value: 36, min: 0 }]),
      { key: 'scope', label: 'Apply to', type: 'select', value: 'sel', options: [['sel', sel.length > 1 ? `Selected pages (${rangesText(sel)})` : `Page ${i + 1}`], ['all', 'All pages'], ['reset', 'Remove crop (selected pages)']] }
    ],
    onOK: v => {
      const pages = v.scope === 'all' ? [...Array(d.numPages).keys()] : sel;
      pageOp(v.scope === 'reset' ? 'Remove crop' : 'Crop pages', async (pdf, refs, ids) => {
        const pp = pdf.getPages();
        for (const k of pages) {
          const p = pp[k]; const mb = p.getMediaBox();
          if (v.scope === 'reset') { p.setCropBox(mb.x, mb.y, mb.width, mb.height); continue; }
          let r;
          if (fromRect) r = fromRect.rect;
          else {
            const inf = d.info[k]; const vpp = makeVp(inf.view, inf.rotate, 1);
            const a = vpp.toPdf(v.left, v.top), b = vpp.toPdf(vpp.w - v.right, vpp.h - v.bottom);
            r = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
          }
          const x1 = Math.max(r[0], mb.x), y1 = Math.max(r[1], mb.y), x2 = Math.min(r[2], mb.x + mb.width), y2 = Math.min(r[3], mb.y + mb.height);
          if (x2 - x1 < 10 || y2 - y1 < 10) continue;
          p.setCropBox(x1, y1, x2 - x1, y2 - y1);
        }
        return { ids };
      });
    }
  });
}

/* ---------- organizer view ---------- */
export function openOrganizer() {
  if (!App.doc) return;
  App.organize = true; O.sel = new Set([V.cur]); O.anchor = V.cur;
  $('scroller').hidden = true; $('navpill').hidden = true; org.hidden = false;
  renderOrganizer(); orgBar(); emit('organize', true);
}
export function closeOrganizer() {
  App.organize = false; org.hidden = true; $('scroller').hidden = false; $('navpill').hidden = !App.doc;
  emit('organize', false); emit('tool', App.tool); layout(true);
  if (O.sel.size) emit('goto', Math.min(...O.sel));
}
function orgBar() {
  if (!App.organize) return;
  const n = O.sel.size;
  const b = (k, label, title, dis) => `<button class="aero-btn" data-org="${k}" title="${title || label}"${dis ? ' disabled style="opacity:.5"' : ''}>${label}</button>`;
  bar.innerHTML = `<span class="tname">Organize Pages</span>` + b('rotl', '⟲ Rotate', 'Rotate selected pages left', !n) + b('rotr', '⟳ Rotate', 'Rotate selected pages right', !n) + b('del', 'Delete', 'Delete selected pages', !n) + b('dup', 'Duplicate', '', !n) +
    '<span class="sep"></span>' + b('blank', 'Insert Blank') + b('insert', 'Insert from PDF…') + '<span class="sep"></span>' + b('extract', 'Extract…', '', !n) + b('split', 'Split…') + b('crop', 'Crop…', '', !n) +
    `<span class="sep"></span><label>Size <input type="range" data-org="size" min="110" max="300" value="${O.cw}"></label><span class="hint">${n} of ${App.doc?.numPages || 0} selected</span>` + b('done', 'Done', 'Back to document view');
}
bar.addEventListener('click', e => {
  const k = e.target.closest('[data-org]')?.dataset.org; if (!k || !App.organize) return;
  const sel = [...O.sel].sort((a, b) => a - b); const d = App.doc;
  const after = sel.length ? sel[sel.length - 1] + 1 : d.numPages;
  ({
    rotl: () => rotatePages(sel, -90), rotr: () => rotatePages(sel, 90), del: () => deletePages(sel), dup: () => duplicatePages(sel),
    blank: () => insertBlank(after), insert: () => insertFromPdf(after), extract: () => extractPages(sel), split: () => splitDialog(), crop: () => cropDialog(null), done: () => closeOrganizer()
  })[k]?.();
});
bar.addEventListener('input', e => { if (e.target.dataset.org === 'size') { O.cw = +e.target.value; org.style.setProperty('--cw', O.cw + 'px'); renderOrganizer(); } });
on('tool', () => { if (App.organize) orgBar(); });
on('sel', () => { if (App.organize) orgBar(); });

export function renderOrganizer() {
  const d = App.doc; if (!App.organize || !d) return;
  org.style.setProperty('--cw', O.cw + 'px');
  const grid = document.createElement('div'); grid.className = 'grid';
  for (let i = 0; i < d.numPages; i++) {
    const inf = d.info[i]; const v = makeVp(inf.view, inf.rotate, 1);
    const tw = O.cw - 20, th = Math.round(tw * v.h / v.w), sc = Math.min(1, (O.cw * 1.3) / th);
    const c = document.createElement('div'); c.className = 'ocard' + (O.sel.has(i) ? ' sel' : ''); c.dataset.i = i;
    c.innerHTML = `<div class="tw" style="width:${Math.round(tw * sc)}px;height:${Math.round(th * sc)}px"></div><div class="lbl">${i + 1}${inf.rotate ? ` · ${inf.rotate}°` : ''}</div>` +
      `<div class="ob"><button data-q="rotl" title="Rotate left"><svg viewBox="0 0 16 16"><path d="M3 7a5 5 0 1 1 1.5 4"/><path d="M3 3v4h4"/></svg></button><button data-q="rotr" title="Rotate right"><svg viewBox="0 0 16 16"><path d="M13 7a5 5 0 1 0-1.5 4"/><path d="M13 3v4H9"/></svg></button><button data-q="del" title="Delete page"><svg viewBox="0 0 16 16"><path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9.5h5.6l.7-9.5"/></svg></button></div>`;
    grid.appendChild(c);
    thumb(d, i).then(t => { const w = c.querySelector('.tw'); w.innerHTML = `<img src="${t.url}" draggable="false">` + thumbSvg(d, i); });
  }
  org.innerHTML = ''; org.appendChild(grid);
  orgBar();
}
org.addEventListener('click', e => {
  const q = e.target.closest('[data-q]'); const c = e.target.closest('.ocard');
  if (q && c) { const i = +c.dataset.i; ({ rotl: () => rotatePages([i], -90), rotr: () => rotatePages([i], 90), del: () => deletePages([i]) })[q.dataset.q](); e.stopPropagation(); }
});
org.addEventListener('dblclick', e => { const c = e.target.closest('.ocard'); if (c) { O.sel = new Set([+c.dataset.i]); closeOrganizer(); } });
// selection + drag reorder
org.addEventListener('pointerdown', e => {
  if (e.button !== 0 || e.target.closest('[data-q]')) return;
  const c = e.target.closest('.ocard');
  if (!c) { if (!e.ctrlKey && !e.shiftKey) { O.sel.clear(); refreshSel(); } return; }
  const i = +c.dataset.i;
  if (e.shiftKey && O.anchor != null) { O.sel = new Set(); for (let k = Math.min(O.anchor, i); k <= Math.max(O.anchor, i); k++) O.sel.add(k); }
  else if (e.ctrlKey || e.metaKey) { O.sel.has(i) ? O.sel.delete(i) : O.sel.add(i); O.anchor = i; }
  else if (!O.sel.has(i)) { O.sel = new Set([i]); O.anchor = i; }
  refreshSel();
  const sx = e.clientX, sy = e.clientY; let dragging = false, mark = null, target = null;
  const mv = ev => {
    if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
    if (!dragging) { dragging = true; org.querySelectorAll('.ocard.sel').forEach(x => x.classList.add('dragging')); mark = document.createElement('div'); mark.className = 'dropmark'; org.appendChild(mark); }
    // nearest gap
    const cards = [...org.querySelectorAll('.ocard')]; let best = null;
    for (const cc of cards) {
      const r = cc.getBoundingClientRect(); const mid = r.left + r.width / 2;
      if (ev.clientY >= r.top - 8 && ev.clientY <= r.bottom + 8) { const idx = +cc.dataset.i + (ev.clientX > mid ? 1 : 0); const x = ev.clientX > mid ? r.right + 6 : r.left - 6; const dd = Math.abs(ev.clientX - x); if (!best || dd < best.dd) best = { idx, x, r, dd }; }
    }
    if (best) { const or = org.getBoundingClientRect(); Object.assign(mark.style, { left: best.x - or.left + org.scrollLeft - 1 + 'px', top: best.r.top - or.top + org.scrollTop + 'px', height: best.r.height + 'px', display: 'block' }); target = best.idx; }
    else mark.style.display = 'none';
    const or = org.getBoundingClientRect(); if (ev.clientY > or.bottom - 30) org.scrollTop += 12; else if (ev.clientY < or.top + 30) org.scrollTop -= 12;
  };
  const up = () => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
    mark?.remove(); org.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging'));
    if (!dragging) { if (!e.ctrlKey && !e.shiftKey && O.sel.size > 1) { O.sel = new Set([i]); refreshSel(); } return; }
    if (target != null) movePages([...O.sel].sort((a, b) => a - b), target);
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
});
function refreshSel() { org.querySelectorAll('.ocard').forEach(c => c.classList.toggle('sel', O.sel.has(+c.dataset.i))); orgBar(); }
export function orgSelectAll() { O.sel = new Set([...Array(App.doc.numPages).keys()]); refreshSel(); }
on('docChanged', () => { if (App.organize) { O.sel = new Set([...O.sel].filter(i => i < App.doc.numPages)); renderOrganizer(); } });
export { esc, f2 };
