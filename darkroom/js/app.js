'use strict';
/* Lumen Darkroom — app shell: state, Library module (grid, filters, collections, metadata), menus, shortcuts */
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const { el, esc } = Aero;

const S = {
  module: 'library', view: 'grid', sel: new Set(), active: null, anchor: null,
  source: { type: 'all' }, filter: { text: '', rating: 0, flag: 'all', labels: new Set(), keyword: '' },
  sort: { key: 'date', dir: 1 }, tsize: 170, list: [], lastImport: null, filmstrip: true
};
const LABEL_KEYS = ['red', 'yellow', 'green', 'blue', 'purple'];

/* ---------- visible list ---------- */
function computeList() {
  const f = S.filter, src = S.source, t = f.text.trim().toLowerCase();
  let coll = null, smart = null;
  if (src.type === 'coll') { const c = Cat.collections.find(c => c.id === src.id); if (c?.smart) smart = c.smart; else coll = new Set(c?.ids || []); }
  const arr = [...Cat.photos.values()].filter(p => {
    if (src.type === 'picks' && p.flag !== 1) return false;
    if (src.type === 'rejected' && p.flag !== -1) return false;
    if (src.type === 'edited' && !p.edited) return false;
    if (src.type === 'last' && p.importId !== S.lastImport) return false;
    if (src.type === 'copies' && !p.copyName) return false;
    if (coll && !coll.has(p.id)) return false;
    if (smart && !Smart.matches(p, smart)) return false;
    if (src.type === 'date') { const t = p.exif.date || p.added; if (t < src.from || t >= src.to) return false; }
    if (f.rating === -1 ? p.rating !== 0 : f.rating === 5 ? p.rating !== 5 : p.rating < f.rating) return false;
    if (f.flag === 'picked' && p.flag !== 1) return false; if (f.flag === 'unflagged' && p.flag !== 0) return false;
    if (f.flag === 'rejected' && p.flag !== -1) return false; if (f.flag === 'notrej' && p.flag === -1) return false;
    if (f.labels.size && !f.labels.has(p.label || 'none')) return false;
    if (f.keyword && !p.keywords.includes(f.keyword)) return false;
    if (t) { const hay = [p.name, p.copyName, ...p.keywords, p.exif.make, p.exif.model, p.exif.lens, p.label].join(' ').toLowerCase(); if (!t.split(/\s+/).every(w => hay.includes(w))) return false; }
    return true;
  });
  const k = S.sort.key, d = S.sort.dir;
  const key = p => k === 'date' ? (p.exif.date || p.added) : k === 'added' ? p.seq : k === 'rating' ? p.rating : k === 'edited' ? p.edited : k === 'label' ? (LABEL_KEYS.indexOf(p.label) + 1 || 9) : 0;
  arr.sort((a, b) => (k === 'name' ? Cat.displayName(a).localeCompare(Cat.displayName(b), undefined, { numeric: true }) : key(a) - key(b) || a.seq - b.seq) * d);
  S.list = arr.map(p => p.id);
  return S.list;
}
const activePhoto = () => Cat.photos.get(S.active) || null;
const selectedIds = () => { const s = S.list.filter(id => S.sel.has(id)); return s.length ? s : (S.active && Cat.photos.has(S.active) ? [S.active] : []); };

/* ---------- grid ---------- */
const FLAG_SVG = { 1: '<svg viewBox="0 0 16 16" class="flag"><path d="M3 15V2h9l-2 3 2 3H4" fill="#fff" stroke="#2a3a4a" stroke-width="1.2" stroke-linejoin="round"/></svg>', '-1': '<svg viewBox="0 0 16 16" class="flag"><path d="M3 15V2h9l-2 3 2 3H4" fill="#1a1a1a" stroke="#000" stroke-width="1.2"/><path d="M6 3.5l3 3M9 3.5l-3 3" stroke="#fff" stroke-width="1.2"/></svg>' };
const starsHTML = r => `<span class="stars">${[1, 2, 3, 4, 5].map(i => `<span data-r="${i}" class="${i <= r ? 'on' : ''}">${i <= r ? '★' : '☆'}</span>`).join('')}</span>`;
function cellHTML(p, i) {
  const u = Cat.thumb(p.id);
  return `<div class="ph">${u ? `<img src="${u}" alt="" draggable="false">` : '<div class="aero-spin"></div>'}</div>
    ${FLAG_SVG[p.flag] || ''}<span class="num">${i + 1}</span>
    <div class="badge">${p.edited ? '<i title="Edited">±</i>' : ''}${p.copyName ? '<i class="vc" title="Virtual copy">⧉</i>' : ''}</div>
    <div class="meta">${starsHTML(p.rating)}<span class="nm" title="${esc(Cat.displayName(p))}">${esc(Cat.displayName(p))}</span>${p.label ? `<span class="lab" style="background:${Model.LABELS[p.label]}"></span>` : ''}</div>`;
}
/* The grid is virtualised: only the rows in (and near) the viewport exist in the DOM, so 10,000+ photos stay fast. */
const GV = { cols: 1, cw: 170, rh: 208, pad: 10, gap: 8, rendered: new Map(), from: 0, to: -1 };
function gridLayout() {
  const g = $('#grid'), W = g.clientWidth - GV.pad * 2, ts = S.tsize;
  GV.cols = Math.max(1, Math.floor((W + GV.gap) / (ts + GV.gap)));
  GV.cw = (W - GV.gap * (GV.cols - 1)) / GV.cols; GV.rh = ts + 30 + GV.gap;
  const rows = Math.ceil(S.list.length / GV.cols);
  let sz = g.querySelector('.gsizer'); if (!sz) { sz = el('div', 'gsizer'); g.appendChild(sz); }
  sz.style.height = (rows * GV.rh - (rows ? GV.gap : 0) + GV.pad * 2) + 'px';
}
function makeCell(id, i) {
  const p = Cat.photos.get(id), c = el('div', 'cell');
  c.dataset.id = id; if (p.label) c.dataset.label = p.label;
  c.classList.toggle('sel', S.sel.has(id)); c.classList.toggle('active', id === S.active); c.classList.toggle('rej', p.flag === -1);
  c.draggable = true; c.innerHTML = cellHTML(p, i);
  const r = Math.floor(i / GV.cols), k = i % GV.cols;
  c.style.cssText = `left:${GV.pad + k * (GV.cw + GV.gap)}px;top:${GV.pad + r * GV.rh}px;width:${GV.cw}px;height:${GV.rh - GV.gap}px`;
  return c;
}
function renderVisible(force) {
  const g = $('#grid'); if (g.hidden) return;
  const top = g.scrollTop, h = g.clientHeight || 600, r0 = Math.max(0, Math.floor((top - GV.pad) / GV.rh) - 2), r1 = Math.ceil((top + h) / GV.rh) + 2;
  const from = Math.min(S.list.length, r0 * GV.cols), to = Math.min(S.list.length, r1 * GV.cols) - 1;
  if (!force && from === GV.from && to === GV.to) return;
  GV.from = from; GV.to = to;
  const want = new Set(S.list.slice(from, to + 1));
  GV.rendered.forEach((c, id) => { if (!want.has(id) || force) { c.remove(); GV.rendered.delete(id); } });
  const frag = document.createDocumentFragment();
  for (let i = from; i <= to; i++) { const id = S.list[i]; if (!GV.rendered.has(id)) { const c = makeCell(id, i); GV.rendered.set(id, c); frag.appendChild(c); } }
  g.appendChild(frag);
}
function renderGrid() {
  gridLayout(); renderVisible(true);
  $('#f-count').textContent = `${S.list.length} of ${Cat.photos.size} photo${Cat.photos.size === 1 ? '' : 's'}`;
}
function updateCell(id) {
  const c = GV.rendered.get(id), p = Cat.photos.get(id); if (!c || !p) return;
  if (p.label) c.dataset.label = p.label; else delete c.dataset.label;
  c.classList.toggle('rej', p.flag === -1); c.innerHTML = cellHTML(p, S.list.indexOf(id));
}
function updateSelClasses() {
  GV.rendered.forEach((c, id) => { c.classList.toggle('sel', S.sel.has(id)); c.classList.toggle('active', id === S.active); });
  FS.rendered.forEach((c, id) => { c.classList.toggle('sel', S.sel.has(id)); c.classList.toggle('active', id === S.active); });
}
function scrollToActive() {
  const i = S.list.indexOf(S.active); if (i < 0) return;
  const g = $('#grid');
  if (!g.hidden) { const top = GV.pad + Math.floor(i / GV.cols) * GV.rh; if (top < g.scrollTop) g.scrollTop = top - GV.pad; else if (top + GV.rh > g.scrollTop + g.clientHeight) g.scrollTop = top + GV.rh - g.clientHeight + GV.pad; renderVisible(); }
  const f = $('#filmstrip'); if (!f.hidden) { const left = FS.pad + i * FS.w; if (left < f.scrollLeft) f.scrollLeft = left - FS.pad; else if (left + FS.w > f.scrollLeft + f.clientWidth) f.scrollLeft = left + FS.w - f.clientWidth + FS.pad; renderFilmVisible(); }
}

function select(id, { ctrl = false, shift = false } = {}) {
  if (!id) return;
  if (shift && S.anchor && S.list.includes(S.anchor)) {
    const a = S.list.indexOf(S.anchor), b = S.list.indexOf(id);
    if (!ctrl) S.sel.clear();
    S.list.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => S.sel.add(x));
  } else if (ctrl) { if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id); S.anchor = id; }
  else { S.sel = new Set([id]); S.anchor = id; }
  setActive(S.sel.has(id) ? id : ([...S.sel].pop() || id));
}
function setActive(id) {
  const changed = id !== S.active; S.active = id;
  updateSelClasses(); renderRight(); updateStatus();
  if (changed || S.module === 'develop' || S.view === 'loupe') Dev.photoChanged();
  scrollToActive();
}
function moveActive(d, extend) {
  if (!S.list.length) return;
  let i = S.list.indexOf(S.active); i = i < 0 ? 0 : Math.max(0, Math.min(S.list.length - 1, i + d));
  select(S.list[i], { shift: extend });
}
function gridCols() { return GV.cols; }

/* ---------- filmstrip (virtualised, fixed-width cells) ---------- */
const FS = { w: 104, pad: 8, rendered: new Map(), from: 0, to: -1 };
function makeFilmCell(id, i) {
  const p = Cat.photos.get(id), d = el('div', 'fs'); d.dataset.id = id; d.title = Cat.displayName(p);
  const u = Cat.thumb(id); d.innerHTML = (u ? `<img src="${u}" alt="" draggable="false">` : '') + (p.rating ? `<span class="s">${'★'.repeat(p.rating)}</span>` : '');
  d.classList.toggle('sel', S.sel.has(id)); d.classList.toggle('active', id === S.active); d.style.left = (FS.pad + i * FS.w) + 'px';
  return d;
}
function renderFilmVisible(force) {
  const fs = $('#filmstrip'); if (fs.hidden) return;
  const l = fs.scrollLeft, w = fs.clientWidth || 1000, from = Math.max(0, Math.floor((l - FS.pad) / FS.w) - 4), to = Math.min(S.list.length - 1, Math.ceil((l + w) / FS.w) + 4);
  if (!force && from === FS.from && to === FS.to) return;
  FS.from = from; FS.to = to;
  const want = new Set(S.list.slice(from, to + 1));
  FS.rendered.forEach((c, id) => { if (!want.has(id) || force) { c.remove(); FS.rendered.delete(id); } });
  const frag = document.createDocumentFragment();
  for (let i = from; i <= to; i++) { const id = S.list[i]; if (!FS.rendered.has(id)) { const c = makeFilmCell(id, i); FS.rendered.set(id, c); frag.appendChild(c); } }
  fs.appendChild(frag);
}
function renderFilmstrip() {
  const fs = $('#filmstrip'); let sz = fs.querySelector('.fsizer'); if (!sz) { sz = el('div', 'fsizer'); fs.appendChild(sz); }
  sz.style.width = (FS.pad * 2 + S.list.length * FS.w) + 'px';
  renderFilmVisible(true);
}

/* ---------- left panel ---------- */
function renderLeft() {
  const cnt = fn => [...Cat.photos.values()].filter(fn).length;
  const items = [['all', 'All Photographs', Cat.photos.size, '#gBlue'], ['picks', 'Picks', cnt(p => p.flag === 1), '#gGreen'], ['edited', 'Edited', cnt(p => p.edited), '#gGold'],
    ['last', 'Previous Import', S.lastImport ? cnt(p => p.importId === S.lastImport) : 0, '#gBlue'], ['copies', 'Virtual Copies', cnt(p => p.copyName), '#gGold'], ['rejected', 'Rejected', cnt(p => p.flag === -1), '#gRed']];
  $('#catlist').innerHTML = items.map(([t, n, c, g]) => `<div class="aero-item${S.source.type === t ? ' sel' : ''}" data-src="${t}"><svg class="ic" viewBox="0 0 16 16"><rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="url(${g})" stroke="#24476e" stroke-width=".8"/><circle cx="6" cy="7" r="1.6" fill="#fff" opacity=".85"/><path d="M2.5 12l4-3.5 2.5 2 2-1.5 2.5 3z" fill="#fff" opacity=".7"/></svg><span class="grow">${n}</span><span class="cnt">${c}</span></div>`).join('');
  const colls = Cat.collections;
  $('#collcount').textContent = colls.length || '';
  $('#colllist').innerHTML = colls.length ? colls.map(c => `<div class="aero-item${S.source.type === 'coll' && S.source.id === c.id ? ' sel' : ''}${c.smart ? ' smart' : ''}" data-coll="${esc(c.id)}" title="${c.smart ? 'Smart collection — double-click to edit its rules' : 'Collection — double-click to rename'}">${c.smart ? '<svg class="ic" viewBox="0 0 16 16"><path d="M1.5 4.5h5l1.5 1.5h6.5v7.5h-13z" fill="url(#gBlue)" stroke="#174a85" stroke-width=".8"/><path d="M9 7.2l-2.4 3.3h2l-.6 2.6 2.6-3.6h-2z" fill="#ffe27a" stroke="#8a5a0a" stroke-width=".5"/></svg>' : '<svg class="ic" viewBox="0 0 16 16"><path d="M1.5 4.5h5l1.5 1.5h6.5v7.5h-13z" fill="url(#gGold)" stroke="#8a5a0a" stroke-width=".8"/></svg>'}<span class="grow">${esc(c.name)}</span><span class="cnt">${c.smart ? Smart.count(c) : c.ids.filter(id => Cat.photos.has(id)).length}</span></div>`).join('') : '<div class="dim" style="padding:6px 8px">No collections yet. Select photos and click the + button below, or drag photos onto a collection.</div>';
  const kws = Cat.keywords();
  $('#kwcount').textContent = kws.length || '';
  $('#kwlist').innerHTML = kws.length ? kws.map(([k, n]) => `<div class="aero-item${S.filter.keyword === k ? ' sel' : ''}" data-kw="${esc(k)}"><svg class="ic" viewBox="0 0 16 16"><path d="M2 8.5V3h5.5l7 7-5.5 5.5z" fill="url(#gBlue)" stroke="#174a85" stroke-width=".8"/><circle cx="5" cy="6" r="1.2" fill="#fff"/></svg><span class="grow">${esc(k)}</span><span class="cnt">${n}</span></div>`).join('') : '<div class="dim" style="padding:6px 8px">Keywords you add appear here.</div>';
}

/* ---------- right panel (library) ---------- */
function renderRight() {
  const p = activePhoto(), ids = selectedIds();
  $('#metasel').textContent = ids.length > 1 ? `${ids.length} selected` : '';
  if (!p) { $('#metapane').innerHTML = '<span class="dim" style="grid-column:1/-1">No photo selected</span>'; $('#exifpane').innerHTML = ''; drawLibHist(null); return; }
  $('#metapane').innerHTML = `
    <span class="dim">Rating</span><span class="stars" id="m-stars">${[1, 2, 3, 4, 5].map(i => `<span data-r="${i}" class="${i <= p.rating ? 'on' : ''}">${i <= p.rating ? '★' : '☆'}</span>`).join('')}</span>
    <span class="dim">Flag</span><span class="flagbtns"><button class="aero-btn${p.flag === 1 ? ' on' : ''}" data-f="1" title="Pick (P)">⚑ Pick</button><button class="aero-btn${p.flag === 0 ? ' on' : ''}" data-f="0" title="Unflag (U)">None</button><button class="aero-btn${p.flag === -1 ? ' on' : ''}" data-f="-1" title="Reject (X)">✕ Reject</button></span>
    <span class="dim">Label</span><span class="labbtns">${LABEL_KEYS.map((k, i) => `<span class="lsw${p.label === k ? ' on' : ''}" data-l="${k}" title="${k[0].toUpperCase() + k.slice(1)}${i < 4 ? ' (' + (i + 6) + ')' : ''}" style="background:${Model.LABELS[k]}"></span>`).join('')}<span class="lsw none${!p.label ? ' on' : ''}" data-l="" title="No label"></span></span>
    <span class="dim">Keywords</span><span class="kwbox">${p.keywords.map(k => `<span class="kwchip">${esc(k)}<button data-k="${esc(k)}" title="Remove keyword">×</button></span>`).join('') || '<span class="dim">none</span>'}</span>
    <span></span><input type="text" id="kwin" placeholder="Add keywords, comma separated ↵" spellcheck="false">`;
  const e = p.exif, row = (k, v) => v ? `<tr><td>${k}</td><td>${esc(v)}</td></tr>` : '';
  const dt = t => t ? new Date(t).toLocaleString() : '';
  $('#exifpane').innerHTML = `<table>
    ${row('File name', p.name)}${row('Copy', p.copyName)}${row('Dimensions', `${p.w} × ${p.h}`)}${row('File size', Decode.fmtSize(p.size))}${row('File type', p.raw ? 'Camera RAW (' + p.ext.toUpperCase() + ')' : p.ext.toUpperCase())}
    ${row('Captured', dt(e.date))}${row('Camera', [e.make, e.model].filter(Boolean).join(' ').replace(/^(\w+) \1/i, '$1'))}${row('Lens', e.lens)}
    ${row('ISO', e.iso ? 'ISO ' + e.iso : '')}${row('Shutter', Decode.fmtShutter(e.shutter))}${row('Aperture', e.aperture ? 'ƒ/' + (+e.aperture.toFixed(1)) : '')}${row('Focal length', e.focal ? (+e.focal.toFixed(1)) + ' mm' : '')}
    ${row('Imported', dt(p.added))}${row('Edited', p.edited ? dt(p.edited) : 'Not edited')}</table>`;
  drawLibHist(p);
}
let histImg = new Image();
function drawLibHist(p) {
  const c = $('#lhist'); const u = p && Cat.thumb(p.id);
  if (!u) { drawHistogram(c, null); return; }
  histImg.onload = () => {
    const t = Decode.mkCanvas(histImg.naturalWidth, histImg.naturalHeight), x = t.getContext('2d'); x.drawImage(histImg, 0, 0);
    const d = x.getImageData(0, 0, t.width, t.height).data, H = [0, 1, 2, 3].map(() => new Uint32Array(256));
    for (let i = 0; i < d.length; i += 4) { H[0][d[i]]++; H[1][d[i + 1]]++; H[2][d[i + 2]]++; H[3][Math.round(.2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2])]++; }
    drawHistogram(c, H);
  };
  histImg.src = u;
}
function drawHistogram(c, H) {
  const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1; const W = Math.max(50, Math.round(r.width * dpr)), Hh = Math.max(40, Math.round(r.height * dpr));
  if (c.width !== W || c.height !== Hh) { c.width = W; c.height = Hh; }
  const x = c.getContext('2d'); x.clearRect(0, 0, W, Hh);
  const bg = x.createLinearGradient(0, 0, 0, Hh); bg.addColorStop(0, '#2c343e'); bg.addColorStop(1, '#1a1f26'); x.fillStyle = bg; x.fillRect(0, 0, W, Hh);
  x.strokeStyle = 'rgba(255,255,255,.08)'; for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(W * i / 4 + .5, 0); x.lineTo(W * i / 4 + .5, Hh); x.stroke(); }
  if (!H) return;
  let mx = 1; for (let ch = 0; ch < 3; ch++) for (let i = 2; i < 254; i++) mx = Math.max(mx, H[ch][i]);
  mx = Math.sqrt(mx);
  x.globalCompositeOperation = 'lighter';
  ['rgba(230,60,50,.75)', 'rgba(60,200,70,.7)', 'rgba(60,110,240,.8)'].forEach((col, ch) => {
    x.beginPath(); x.moveTo(0, Hh);
    for (let i = 0; i < 256; i++) x.lineTo(i / 255 * W, Hh - Math.min(1, Math.sqrt(H[ch][i]) / mx) * (Hh - 4));
    x.lineTo(W, Hh); x.closePath(); x.fillStyle = col; x.fill();
  });
  x.globalCompositeOperation = 'source-over';
  // clipping indicators
  const n = H[3].reduce((a, b) => a + b, 0) || 1, lo = (H[0][0] + H[1][0] + H[2][0]) / 3 / n, hi = (H[0][255] + H[1][255] + H[2][255]) / 3 / n;
  const tri = (px, on) => { x.fillStyle = on ? '#fff' : 'rgba(255,255,255,.2)'; x.beginPath(); if (px === 0) { x.moveTo(4, 4); x.lineTo(14, 4); x.lineTo(4, 14); } else { x.moveTo(W - 4, 4); x.lineTo(W - 14, 4); x.lineTo(W - 4, 14); } x.fill(); };
  tri(0, lo > .002); tri(1, hi > .002);
}

/* ---------- metadata actions ---------- */
function setRating(r, ids = selectedIds()) { if (!ids.length) return; Cat.changeMeta(ids, `Rating ${'★'.repeat(r) || 'none'}`, p => p.rating = r); }
function setFlag(f, ids = selectedIds()) { if (!ids.length) return; Cat.changeMeta(ids, f === 1 ? 'Flag as pick' : f === -1 ? 'Flag as rejected' : 'Unflag', p => p.flag = f); }
function setLabel(l, ids = selectedIds()) { if (!ids.length) return; const all = ids.every(id => Cat.photos.get(id).label === l); Cat.changeMeta(ids, l ? 'Label ' + l : 'Remove label', p => p.label = all ? '' : l); }
function addKeywords(text, ids = selectedIds()) {
  const kws = String(text).split(/[,;]/).map(s => s.trim().slice(0, 60)).filter(Boolean); if (!kws.length || !ids.length) return;
  Cat.changeMeta(ids, 'Add keywords', p => p.keywords = [...new Set([...p.keywords, ...kws])]);
}
function removeKeyword(k, ids = selectedIds()) { Cat.changeMeta(ids, 'Remove keyword', p => p.keywords = p.keywords.filter(x => x !== k)); }
async function promptKeywords() { const ids = selectedIds(); if (!ids.length) return; const v = await Aero.prompt('Add Keywords', `Keywords for ${ids.length} photo${ids.length > 1 ? 's' : ''} (comma separated)`, ''); if (v) addKeywords(v, ids); }

/* ---------- collections ---------- */
async function newCollectionFromSel() {
  const ids = selectedIds(); const name = await Aero.prompt('New Collection', 'Collection name', ids.length ? `Collection (${ids.length} photos)` : 'New collection');
  if (!name) return; const c = Cat.newCollection(name.trim().slice(0, 80) || 'Collection', ids); Aero.toast(`Created “${c.name}”` + (ids.length ? ` with ${ids.length} photos` : ''));
}
const isSmart = id => !!Cat.collections.find(c => c.id === id)?.smart;
async function addSelToCollection(cid) {
  const ids = selectedIds(); if (!ids.length) return Aero.toast('Select photos first');
  if (cid && isSmart(cid)) return Aero.toast('Smart collections fill themselves from their rules — double-click it to edit them');
  if (!cid) {
    if (!Cat.collections.length) return newCollectionFromSel();
    const cur = S.source.type === 'coll' ? S.source.id : Cat.collections[0].id;
    const plain = Cat.collections.filter(c => !c.smart); if (!plain.length) return newCollectionFromSel();
    const v = await new Promise(res => Aero.dialog({ title: 'Add to Collection', fields: [{ key: 'c', label: 'Collection', type: 'select', value: plain.some(c => c.id === cur) ? cur : plain[0].id, options: plain.map(c => [c.id, c.name]) }], onOK: v => res(v.c), onCancel: () => res(null) }));
    if (!v) return; cid = v;
  }
  Cat.addToCollection(cid, ids); Aero.toast(`Added ${ids.length} photo${ids.length > 1 ? 's' : ''} to “${Cat.collections.find(c => c.id === cid)?.name}”`);
}
function removeSelFromCollection() {
  if (S.source.type !== 'coll') return Aero.toast('Open a collection first');
  if (isSmart(S.source.id)) return Aero.toast('Smart collections fill themselves from their rules — edit the rules instead');
  const ids = selectedIds(); if (!ids.length) return; Cat.removeFromCollection(S.source.id, ids);
}
function editSmartCollection() {
  const c = S.source.type === 'coll' && Cat.collections.find(x => x.id === S.source.id);
  if (!c || !c.smart) return Aero.toast('Select a smart collection to edit');
  Smart.dialog(c);
}
async function renameCollection() {
  const c = S.source.type === 'coll' && Cat.collections.find(x => x.id === S.source.id); if (!c) return Aero.toast('Select a collection to rename');
  const n = await Aero.prompt('Rename Collection', 'Name', c.name); if (n && n.trim()) Cat.renameCollection(c.id, n.trim().slice(0, 80));
}
async function deleteCollection() {
  const c = S.source.type === 'coll' && Cat.collections.find(x => x.id === S.source.id); if (!c) return Aero.toast('Select a collection to delete');
  if (!await Aero.confirm('Delete Collection', `Delete the collection “${c.name}”? The photos stay in the catalog.`, 'Delete')) return;
  Cat.deleteCollection(c.id); setSource({ type: 'all' });
}

/* ---------- module / view ---------- */
function setSource(src) { S.source = src; refreshList(); renderLeft(); syncFilterUI(); }
function refreshList(keepScroll = true) {
  const g = $('#grid'), st = g.scrollTop;
  computeList();
  [...S.sel].forEach(id => { if (!Cat.photos.has(id)) S.sel.delete(id); });
  if (!Cat.photos.has(S.active) || !S.list.includes(S.active)) { S.active = S.list.find(id => S.sel.has(id)) || S.list[0] || null; if (S.active && !S.sel.size) S.sel.add(S.active); }
  renderGrid(); renderFilmstrip(); renderRight(); updateStatus(); updateEmpty();
  if (keepScroll) g.scrollTop = st;
  if (S.module === 'develop' || S.view === 'loupe') Dev.photoChanged();
}
function updateEmpty() {
  const empty = Cat.photos.size === 0;
  $('#empty').hidden = !empty;
  $('#filterbar').hidden = empty || !(S.module === 'library' && S.view === 'grid');
  if (empty) $('#dates').hidden = true;
}
function setModule(m) {
  if (m === 'develop' && !activePhoto()) { if (S.list[0]) select(S.list[0]); else return Aero.toast('Import or open photos first'); }
  if (S.module === 'develop' && m !== 'develop') Dev.leave();
  S.module = m;
  $('#m-lib').classList.toggle('on', m === 'library'); $('#m-dev').classList.toggle('on', m === 'develop');
  $('#cmd-lib').hidden = m !== 'library'; $('#cmd-dev').hidden = m !== 'develop';
  $('#lib-left').hidden = $('#lib-right').hidden = m !== 'library'; $('#dev-left').hidden = $('#dev-right').hidden = m !== 'develop';
  applyView();
  if (m === 'develop') Dev.enter();
}
function setView(v) { S.view = v; if (S.module !== 'library') setModule('library'); else applyView(); }
function applyView() {
  const lib = S.module === 'library', grid = lib && S.view === 'grid', dates = lib && S.view === 'dates';
  $('#grid').hidden = !grid; $('#viewer').hidden = grid || dates; $('#dates').hidden = !dates;
  $('#filmstrip').hidden = grid || dates || !S.filmstrip;
  $('#v-grid').classList.toggle('on', S.view === 'grid'); $('#v-loupe').classList.toggle('on', S.view === 'loupe'); $('#v-dates').classList.toggle('on', S.view === 'dates');
  updateEmpty();
  if (dates) Dates.render();
  else if (!grid) { Dev.photoChanged(); renderFilmstrip(); } else { renderGrid(); scrollToActive(); $('#grid').focus({ preventScroll: true }); }
  updateStatus();
}

/* ---------- status ---------- */
function updateStatus() {
  const p = activePhoto();
  $('#st-count').textContent = `${S.list.length} / ${Cat.photos.size} photos`;
  $('#st-sel').textContent = S.sel.size > 1 ? `${S.sel.size} selected` : '';
  $('#st-name').textContent = p ? Cat.displayName(p) : '';
  $('#st-info').textContent = p ? `${p.w} × ${p.h}${p.exif.model ? ' · ' + p.exif.model : ''}` : '';
}
DB.setStateListener(pending => { $('#st-save').textContent = pending ? 'Saving…' : 'Catalog saved'; Aero.setDirty(pending); });

/* ---------- events ---------- */
function wire() {
  // grid
  const grid = $('#grid');
  grid.addEventListener('click', e => {
    const c = e.target.closest('.cell'); if (!c) { if (e.target === grid) { S.sel.clear(); updateSelClasses(); updateStatus(); renderRight(); } return; }
    const st = e.target.closest('.stars span'); if (st) { select(c.dataset.id, { ctrl: S.sel.has(c.dataset.id) && S.sel.size > 1 ? false : false }); const r = +st.dataset.r; const p = Cat.photos.get(c.dataset.id); setRating(p.rating === r ? 0 : r, [c.dataset.id]); return; }
    select(c.dataset.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey });
  });
  grid.addEventListener('dblclick', e => { const c = e.target.closest('.cell'); if (c && !e.target.closest('.stars')) { select(c.dataset.id); setView('loupe'); } });
  grid.addEventListener('dragstart', e => {
    const c = e.target.closest('.cell'); if (!c) return;
    if (!S.sel.has(c.dataset.id)) select(c.dataset.id);
    e.dataTransfer.setData('text/x-darkroom-ids', JSON.stringify(selectedIds())); e.dataTransfer.effectAllowed = 'copy';
  });
  // filmstrip
  $('#filmstrip').addEventListener('click', e => { const c = e.target.closest('.fs'); if (c) select(c.dataset.id, { ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey }); });
  let gq = false; grid.addEventListener('scroll', () => { if (gq) return; gq = true; requestAnimationFrame(() => { gq = false; renderVisible(); }); }, { passive: true });
  let fq = false; $('#filmstrip').addEventListener('scroll', () => { if (fq) return; fq = true; requestAnimationFrame(() => { fq = false; renderFilmVisible(); }); }, { passive: true });
  new ResizeObserver(() => { const old = GV.cols; if (!grid.hidden) { gridLayout(); renderVisible(old !== GV.cols); } renderFilmVisible(); }).observe(grid);
  $('#filmstrip').addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { e.preventDefault(); $('#filmstrip').scrollLeft += e.deltaY; } }, { passive: false });
  // left
  $('#catlist').addEventListener('click', e => { const it = e.target.closest('[data-src]'); if (it) setSource({ type: it.dataset.src }); });
  const cl = $('#colllist');
  cl.addEventListener('click', e => { const it = e.target.closest('[data-coll]'); if (it) setSource({ type: 'coll', id: it.dataset.coll }); });
  cl.addEventListener('dblclick', e => { const it = e.target.closest('[data-coll]'); if (it) isSmart(it.dataset.coll) ? editSmartCollection() : renameCollection(); });
  cl.addEventListener('dragover', e => { const it = e.target.closest('[data-coll]'); if (it && e.dataTransfer.types.includes('text/x-darkroom-ids')) { e.preventDefault(); e.stopPropagation(); $$('#colllist .drop').forEach(x => x.classList.remove('drop')); it.classList.add('drop'); } });
  cl.addEventListener('dragleave', e => { e.target.closest?.('[data-coll]')?.classList.remove('drop'); });
  cl.addEventListener('drop', e => {
    const it = e.target.closest('[data-coll]'); const raw = e.dataTransfer.getData('text/x-darkroom-ids'); if (!it || !raw) return;
    e.preventDefault(); e.stopPropagation(); it.classList.remove('drop');
    if (isSmart(it.dataset.coll)) return Aero.toast('Smart collections fill themselves from their rules');
    try { const ids = JSON.parse(raw).filter(id => Cat.photos.has(id)); Cat.addToCollection(it.dataset.coll, ids); Aero.toast(`Added ${ids.length} photo${ids.length > 1 ? 's' : ''} to collection`); } catch (err) { }
  });
  $('#kwlist').addEventListener('click', e => { const it = e.target.closest('[data-kw]'); if (it) { S.filter.keyword = S.filter.keyword === it.dataset.kw ? '' : it.dataset.kw; syncFilterUI(); refreshList(false); renderLeft(); } });
  $('#c-new').onclick = newCollectionFromSel; $('#c-add').onclick = () => addSelToCollection(S.source.type === 'coll' ? S.source.id : null);
  $('#c-smart').onclick = () => Smart.dialog(); $('#c-rem').onclick = removeSelFromCollection; $('#c-ren').onclick = renameCollection; $('#c-del').onclick = deleteCollection;
  // right (metadata)
  const mp = $('#metapane');
  mp.addEventListener('click', e => {
    const p = activePhoto(); if (!p) return;
    const st = e.target.closest('#m-stars span'); if (st) { const r = +st.dataset.r; setRating(p.rating === r && selectedIds().length === 1 ? 0 : r); }
    const f = e.target.closest('[data-f]'); if (f) setFlag(+f.dataset.f);
    const l = e.target.closest('[data-l]'); if (l) setLabel(l.dataset.l);
    const k = e.target.closest('[data-k]'); if (k) removeKeyword(k.dataset.k);
  });
  mp.addEventListener('keydown', e => { if (e.target.id === 'kwin' && e.key === 'Enter') { e.preventDefault(); addKeywords(e.target.value); setTimeout(() => $('#kwin')?.focus(), 0); } });
  // filter bar
  $('#f-labels').innerHTML = LABEL_KEYS.map(k => `<span class="lsw" data-l="${k}" title="${k}" style="background:${Model.LABELS[k]}"></span>`).join('') + '<span class="lsw none" data-l="none" title="No label"></span>';
  $('#f-labels').onclick = e => { const l = e.target.closest('[data-l]'); if (!l) return; const k = l.dataset.l; S.filter.labels.has(k) ? S.filter.labels.delete(k) : S.filter.labels.add(k); syncFilterUI(); refreshList(false); };
  let ft; $('#f-text').addEventListener('input', e => { clearTimeout(ft); ft = setTimeout(() => { S.filter.text = e.target.value; refreshList(false); }, 150); });
  $('#f-rating').onchange = e => { S.filter.rating = +e.target.value; refreshList(false); };
  $('#f-flag').onchange = e => { S.filter.flag = e.target.value; refreshList(false); };
  $('#f-clear').onclick = () => { S.filter = { text: '', rating: 0, flag: 'all', labels: new Set(), keyword: '' }; syncFilterUI(); refreshList(false); renderLeft(); };
  $('#f-kw').onclick = e => { if (e.target.tagName === 'BUTTON') { S.filter.keyword = ''; syncFilterUI(); refreshList(false); renderLeft(); } };
  // cmdbar
  $('#m-lib').onclick = () => setModule('library'); $('#m-dev').onclick = () => setModule('develop');
  $('#v-grid').onclick = () => setView('grid'); $('#v-loupe').onclick = () => setView('loupe'); $('#v-dates').onclick = () => setView('dates');
  Dates.wire();
  $('#f-date').onclick = e => { if (e.target.tagName === 'BUTTON') setSource({ type: 'all' }); else setView('dates'); };
  Cat.thumbPriority = id => GV.rendered.has(id) || FS.rendered.has(id);
  $('#b-import').onclick = importDialog; $('#b-export').onclick = () => IO.exportDialog();
  $('#sort').onchange = e => { S.sort.key = e.target.value; refreshList(false); };
  $('#sortdir').onclick = () => { S.sort.dir *= -1; $('#sortdir').textContent = S.sort.dir > 0 ? '↑' : '↓'; refreshList(false); };
  $('#tsize').oninput = e => { S.tsize = +e.target.value; grid.style.setProperty('--ts', S.tsize + 'px'); const i = S.list.indexOf(S.active); renderGrid(); if (i >= 0) scrollToActive(); };
  $('#e-import').onclick = importDialog; $('#e-sample').onclick = () => Sample.open(); $('#e-open').onclick = () => IO.openBackup();
  // arrows (own handler so focused sliders keep their arrow keys)
  document.addEventListener('keydown', e => {
    if (document.querySelector('.aero-modal') || e.target.matches?.('input,select,textarea')) return;
    const k = e.key; if (!/^Arrow(Left|Right|Up|Down)$/.test(k) || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    const grid = S.module === 'library' && S.view === 'grid';
    const d = k === 'ArrowLeft' ? -1 : k === 'ArrowRight' ? 1 : (grid ? (k === 'ArrowUp' ? -gridCols() : gridCols()) : (k === 'ArrowUp' ? -1 : 1));
    moveActive(d, e.shiftKey);
  });
  addEventListener('resize', () => { if (!$('#viewer').hidden) Dev.requestRender(); });
  $('#work').addEventListener('drop', e => {
    const entries = [...(e.dataTransfer?.items || [])].map(it => it.webkitGetAsEntry?.()).filter(Boolean);
    if (!entries.some(en => en.isDirectory)) return;   // plain files: the kit handles them
    e.preventDefault(); e.stopImmediatePropagation(); $('#work').classList.remove('drag-over');
    Aero.busy('Reading dropped folders…');
    readDropEntries(entries).then(files => { Aero.busy(); if (files.length) handleFiles(files); else Aero.toast('No supported photos in the dropped folder'); }).catch(err => { Aero.busy(); Aero.toast('Could not read the dropped folder: ' + err.message); });
  }, true);
}
function syncFilterUI() {
  const f = S.filter; $('#f-text').value = f.text; $('#f-rating').value = f.rating; $('#f-flag').value = f.flag;
  $$('#f-labels .lsw').forEach(x => x.classList.toggle('on', f.labels.has(x.dataset.l)));
  const dc = $('#f-date'), ds = S.source.type === 'date' ? S.source : null; dc.hidden = !ds; dc.innerHTML = ds ? `Date: ${esc(ds.label)}<button title="Show all dates">×</button>` : '';
  const kc = $('#f-kw'); kc.hidden = !f.keyword; kc.innerHTML = f.keyword ? `Keyword: ${esc(f.keyword)}<button title="Clear keyword filter">×</button>` : '';
}

/* ---------- import ---------- */
const IMPORT_ACCEPT = 'image/*,.heic,.heif,.cr2,.cr3,.crw,.nef,.nrw,.arw,.srf,.sr2,.dng,.raf,.orf,.rw2,.rwl,.pef,.srw,.3fr,.erf,.kdc,.dcr,.mrw,.x3f,.iiq,.mos,.raw,.ldarkroom';
async function importDialog() {
  const files = await Aero.openFile({ accept: IMPORT_ACCEPT, multiple: true });
  if (files.length) handleFiles(files);
}
function importFolderDialog() {
  const i = el('input'); i.type = 'file'; i.webkitdirectory = true; i.multiple = true; i.style.display = 'none';
  i.onchange = async () => {
    const list = [...i.files].filter(f => Decode.isImage(f.name)); i.remove();
    if (!list.length) return Aero.toast('No supported photos in that folder');
    handleFiles(await Promise.all(list.map(async f => ({ name: f.name, data: await f.arrayBuffer() }))));
  };
  document.body.appendChild(i); i.click();
}
// folders dropped onto the window: walk them (the kit's drop handler only sees plain files)
async function readDropEntries(items) {
  const out = [], walk = async entry => {
    if (!entry) return;
    if (entry.isFile) { if (Decode.isImage(entry.name) || /\.ldarkroom$/i.test(entry.name)) { const f = await new Promise((res, rej) => entry.file(res, rej)); out.push({ name: f.name, data: await f.arrayBuffer() }); } }
    else if (entry.isDirectory) {
      const rd = entry.createReader(); let batch;
      do { batch = await new Promise((res, rej) => rd.readEntries(res, rej)); for (const e of batch) await walk(e); } while (batch.length);
    }
  };
  for (const e of items) await walk(e);
  return out;
}
async function handleFiles(files) {
  const backup = files.find(f => /\.ldarkroom$/i.test(f.name));
  if (backup) return IO.loadBackup(backup.data, backup.name);
  const added = await Cat.importFiles(files);
  if (added.length) {
    S.lastImport = added[0].importId;
    S.source = { type: 'last' }; S.sel = new Set(added.map(p => p.id)); S.active = added[0].id;
    if (S.module !== 'library') setModule('library');
    refreshList(false); renderLeft();
  }
}

/* ---------- edit commands ---------- */
async function doUndo() { if (S.module === 'develop' && Dev.undo()) return; if (!await Cat.undo()) Aero.toast('Nothing to undo'); }
async function doRedo() { if (S.module === 'develop' && Dev.redo()) return; if (!await Cat.redo()) Aero.toast('Nothing to redo'); }
async function removeSelected() {
  if (S.module === 'develop' && Local.deleteSelected()) return;
  const ids = selectedIds(); if (!ids.length) return;
  if (S.source.type === 'coll') { Cat.removeFromCollection(S.source.id, ids); Aero.toast('Removed from collection (photos stay in the catalog)'); return; }
  if (!await Aero.confirm('Remove from Catalog', `Remove ${ids.length} photo${ids.length > 1 ? 's' : ''} from the catalog? Edits, ratings and the stored original${ids.length > 1 ? 's' : ''} are deleted from Darkroom (files on your disk are not touched). You can undo this until you close the app.`, 'Remove')) return;
  const idx = S.list.indexOf(S.active);
  await Cat.remove(ids);
  S.sel.clear(); computeList(); S.active = S.list[Math.min(idx, S.list.length - 1)] || null; if (S.active) S.sel.add(S.active);
  refreshList(); renderLeft();
}
async function rotate(d) {
  const ids = selectedIds(); if (!ids.length) return;
  Cat.applyToMany(ids, p => Dev.rotatedSettings(p.settings, d), d > 0 ? 'Rotate right' : 'Rotate left');
}

/* ---------- dialogs ---------- */
function shortcutsDialog() {
  const rows = [['Library', ''], ['G / E / D', 'Grid · Loupe · Develop'], ['Shift+D', 'Dates (calendar) view'], ['Ctrl+Alt+N', 'New smart collection'], ['← → ↑ ↓', 'Previous / next photo (Shift extends selection)'], ['0 – 5', 'Star rating'], ['P / X / U', 'Pick · Reject · Unflag'],
    ['6 7 8 9', 'Red · Yellow · Green · Blue label'], ['Ctrl+K', 'Add keywords'], ['Ctrl+H / Ctrl+M', 'Photo Merge: HDR / Panorama (select 2+ photos)'], ["Ctrl+'", 'Create virtual copy'], ['Ctrl+[ / Ctrl+]', 'Rotate left / right'], ['Delete', 'Remove from catalog (or from the open collection)'],
    ['Ctrl+A / Ctrl+D', 'Select all / none'], ['Develop', ''], ['R', 'Crop & straighten (Ctrl-drag a line to level)'], ['W', 'White balance selector'], ['V', 'Convert to black & white'], ['\\', 'Before / after split'], ['Y', 'Before / after side by side'],
    ['Q', 'Spot removal (click a spot or paint a stroke over a scratch; drag the shapes; Delete removes)'], ['Ctrl+Shift+U', 'Upright: Auto'], ['M', 'Masking tool'], ['Shift+M / Shift+R / K', 'New linear / radial / brush mask'], ['O', 'Show mask overlay'],
    ['[ / ]', 'Brush or spot size'], ['Alt + paint', 'Erase from a brush mask'], ['Ctrl+G', 'Transform grid overlay'], ['Ctrl+U', 'Auto tone'], ['Ctrl+Shift+C / V', 'Copy / paste settings'], ['Ctrl+Alt+S', 'Sync settings to selected'], ['Ctrl+Shift+R', 'Reset all settings'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo (photo edit history in Develop)'],
    ['Ctrl+0 / Ctrl+1', 'Fit / 100%'], ['Ctrl+= / Ctrl+-', 'Zoom in / out'], ['Double-click a slider label', 'Reset that slider'], ['File', ''], ['Ctrl+Shift+I', 'Import photos'], ['Ctrl+Shift+E', 'Export'], ['Ctrl+S / Ctrl+O', 'Save / open catalog backup (.ldarkroom)']];
  Aero.dialog({ title: 'Keyboard Shortcuts', noCancel: true, width: 520, html: `<table style="width:100%;border-collapse:collapse">${rows.map(([k, v]) => v ? `<tr><td style="padding:2px 12px 2px 0;white-space:nowrap" class="mono">${esc(k)}</td><td>${esc(v)}</td></tr>` : `<tr><td colspan="2" style="padding:8px 0 2px;color:var(--navy);font-weight:600">${esc(k)}</td></tr>`).join('')}</table>` });
}
function aboutDialog() {
  Aero.dialog({ title: 'About Lumen Darkroom', noCancel: true, html: `<div style="display:flex;gap:16px;align-items:center"><img src="../kit/icons/darkroom.png" width="72" height="72" alt=""><div><div style="font-size:18px;color:var(--navy)">Lumen Darkroom</div><div class="dim">Photo library &amp; RAW developer · part of Lumen Studio</div><p class="dnote">Non-destructive WebGL2 develop pipeline, IndexedDB catalog, camera RAW via LibRaw (WASM).<br>Libraries: LibRaw-wasm, exifr (MIT), fflate (MIT).</p><p class="dnote" id="ab-store"></p></div></div>` });
  navigator.storage?.estimate?.().then(e => { const n = $('#ab-store'); if (n) n.textContent = `Catalog storage used: ${Decode.fmtSize(e.usage || 0)} of ${Decode.fmtSize(e.quota || 0)} available.`; });
}

/* ---------- menus ---------- */
function buildMenus() {
  const dev = () => S.module === 'develop', has = () => !!activePhoto();
  return {
    File: [
      ['Import Photos…', 'Ctrl+Shift+I', importDialog], ['Import Folder…', '', importFolderDialog], ['Open Sample Catalog', '', () => Sample.open()], '-',
      ['New Catalog…', 'Ctrl+N', () => IO.newCatalog()], ['Open Catalog Backup…', 'Ctrl+O', () => IO.openBackup()],
      ['Save Catalog Backup', 'Ctrl+S', () => IO.saveBackup(false)], ['Save Catalog Backup As…', 'Ctrl+Shift+S', () => IO.saveBackup(true)], '-',
      { label: 'Export…', key: 'Ctrl+Shift+E', fn: () => IO.exportDialog(), disabled: () => !has() },
      { label: 'Export with Previous Settings', key: 'Ctrl+Shift+Alt+E', fn: () => IO.exportPrevious(), disabled: () => !has() }
    ],
    Edit: [
      { label: 'Undo', key: 'Ctrl+Z', fn: doUndo }, { label: 'Redo', key: 'Ctrl+Y/Ctrl+Shift+Z', fn: doRedo }, '-',
      ['Select All', 'Ctrl+A', () => { S.sel = new Set(S.list); updateSelClasses(); updateStatus(); renderRight(); }],
      ['Select None', 'Ctrl+D', () => { S.sel.clear(); updateSelClasses(); updateStatus(); renderRight(); }],
      ['Invert Selection', '', () => { S.sel = new Set(S.list.filter(id => !S.sel.has(id))); updateSelClasses(); updateStatus(); }],
      ['Select Picks', '', () => { S.sel = new Set(S.list.filter(id => Cat.photos.get(id).flag === 1)); updateSelClasses(); updateStatus(); }], '-',
      { label: 'Remove from Catalog…', key: 'Delete', fn: removeSelected, disabled: () => !has() }
    ],
    Photo: [
      '#Rating', ...[0, 1, 2, 3, 4, 5].map(r => ({ label: r ? '★'.repeat(r) : 'No rating', key: String(r), fn: () => setRating(r) })),
      '#Flag', ['Pick', 'P', () => setFlag(1)], ['Reject', 'X', () => setFlag(-1)], ['Unflag', 'U', () => setFlag(0)],
      '#Color label', ...LABEL_KEYS.map((l, i) => [l[0].toUpperCase() + l.slice(1), i < 4 ? String(i + 6) : '', () => setLabel(l)]), ['None', '', () => setLabel('')], '-',
      ['Add Keywords…', 'Ctrl+K', promptKeywords], ["Create Virtual Copy", "Ctrl+'", async () => { const m = await Cat.virtualCopy(selectedIds()); if (m.length) { S.sel = new Set(m); S.active = m[0]; refreshList(); } }],
      ['Add to Collection…', 'Ctrl+B', () => addSelToCollection()], ['New Collection from Selection…', '', newCollectionFromSel],
      ['New Smart Collection…', 'Ctrl+Alt+N', () => Smart.dialog()], { label: 'Edit Smart Collection…', fn: editSmartCollection, disabled: () => !(S.source.type === 'coll' && isSmart(S.source.id)) }, '-',
      ['Rotate Left', 'Ctrl+[', () => rotate(-1)], ['Rotate Right', 'Ctrl+]', () => rotate(1)], '-',
      '#Photo Merge', { label: 'HDR…', key: 'Ctrl+H', fn: () => Merge.hdrDialog(), disabled: () => selectedIds().length < 2 }, { label: 'Panorama…', key: 'Ctrl+M', fn: () => Merge.panoDialog(), disabled: () => selectedIds().length < 2 }
    ],
    Develop: [
      ['Open in Develop', 'D', () => setModule('develop')], '-',
      ['Auto Tone', 'Ctrl+U', () => Dev.autoTone()], ['Convert to Black & White', 'V', () => Dev.toggleBW()],
      ['Crop & Straighten', 'R', () => Dev.toggleCrop()], ['White Balance Selector', 'W', () => Dev.toggleWBPick()], '-',
      { label: 'Spot Removal', key: 'Q', fn: () => Local.setTool('spot'), checked: () => Local.tool === 'spot' },
      { label: 'Visualize Spots', fn: () => Local.toggleVis(), checked: () => Local.vis },
      { label: 'Masking', key: 'M', fn: () => Local.setTool('mask'), checked: () => Local.tool === 'mask' },
      ['New Linear Gradient Mask', 'Shift+M', () => Local.addMask('linear')], ['New Radial Gradient Mask', 'Shift+R', () => Local.addMask('radial')], ['New Brush Mask', 'K', () => Local.addMask('brush')],
      { label: 'Show Mask Overlay', key: 'O', fn: () => Local.toggleOverlay(), checked: () => Local.overlay }, '-',
      '#Upright (Transform)', ['Upright: Level', '', () => Dev.autoLevel()], ['Upright: Vertical', '', () => Dev.autoUpright('vertical')], ['Upright: Auto', 'Ctrl+Shift+U', () => Dev.autoUpright('auto')], ['Upright: Full', '', () => Dev.autoUpright('full')], '-',
      ['Copy Settings…', 'Ctrl+Shift+C', () => Dev.copySettings()], ['Paste Settings', 'Ctrl+Shift+V', () => Dev.pasteSettings()], ['Sync Settings to Selected…', 'Ctrl+Alt+S', () => Dev.syncSettings()],
      ['Reset All Settings', 'Ctrl+Shift+R', () => Dev.resetAll()], '-', ['New Preset from Settings…', 'Ctrl+Shift+N', () => Dev.newPreset()], '-',
      { label: 'Before / After: Off', fn: () => Dev.setBA('off'), checked: () => Dev.ba === 'off' },
      { label: 'Before / After: Split', key: '\\', fn: () => Dev.setBA(Dev.ba === 'split' ? 'off' : 'split'), checked: () => Dev.ba === 'split' },
      { label: 'Before / After: Side by Side', key: 'Y', fn: () => Dev.setBA(Dev.ba === 'side' ? 'off' : 'side'), checked: () => Dev.ba === 'side' }
    ],
    View: [
      { label: 'Library Grid', key: 'G', fn: () => setView('grid'), checked: () => S.module === 'library' && S.view === 'grid' },
      { label: 'Library Loupe', key: 'E', fn: () => setView('loupe'), checked: () => S.module === 'library' && S.view === 'loupe' },
      { label: 'Library Dates (Calendar)', key: 'Shift+D', fn: () => setView('dates'), checked: () => S.module === 'library' && S.view === 'dates' },
      { label: 'Develop', fn: () => setModule('develop'), checked: dev }, '-',
      ['Zoom In', 'Ctrl+=', () => Dev.zoomStep(1)], ['Zoom Out', 'Ctrl+-', () => Dev.zoomStep(-1)], ['Fit in Window', 'Ctrl+0', () => Dev.setZoom('fit')], ['Actual Pixels (100%)', 'Ctrl+1', () => Dev.setZoom(1)], '-',
      ['Larger Thumbnails', '=', () => { const t = $('#tsize'); t.value = +t.value + 30; t.oninput({ target: t }); }], ['Smaller Thumbnails', '-', () => { const t = $('#tsize'); t.value = +t.value - 30; t.oninput({ target: t }); }],
      { label: 'Show Filmstrip', key: 'F6', fn: () => { S.filmstrip = !S.filmstrip; applyView(); }, checked: () => S.filmstrip },
      { label: 'Show Info Overlay', key: 'I', fn: () => { Dev.showInfo = !Dev.showInfo; Dev.requestRender(); }, checked: () => Dev.showInfo },
      { label: 'Show Transform Grid', key: 'Ctrl+G', fn: () => { if (S.module !== 'develop') setModule('develop'); Dev.gridOn = !Dev.gridOn; }, checked: () => Dev.gridOn }
    ],
    Help: [['Keyboard Shortcuts', 'F1', shortcutsDialog], ['About Lumen Darkroom', '', aboutDialog]]
  };
}

/* ---------- boot ---------- */
async function boot() {
  Aero.init({
    name: 'Lumen Darkroom', icon: '../kit/icons/darkroom.png', doc: 'Catalog', menus: buildMenus(),
    onDropFiles: handleFiles, dropTarget: $('#work'), dropText: 'Drop photos (JPEG, PNG, WebP, RAW…) or a .ldarkroom backup to import',
    onSave: async () => { await DB.flush(); return true; }
  });
  wire(); syncFilterUI();
  if (!Engine.init()) Aero.alert('WebGL2 unavailable', 'Lumen Darkroom needs WebGL2 for its develop engine. Previews and editing will not work in this browser.');
  Dev.init(); Local.init();
  Cat.on((what, data) => {
    if (what === 'thumb') {
      const u = Cat.thumbURL.get(data), c = GV.rendered.get(data), f = FS.rendered.get(data);
      if (c) { const im = c.querySelector('.ph img'); if (im) im.src = u; else updateCell(data); }
      if (f) { const im = f.querySelector('img'); if (im) im.src = u; else f.insertAdjacentHTML('afterbegin', `<img src="${u}" alt="" draggable="false">`); }
      if (data === S.active) { drawLibHist(activePhoto()); Dev.thumbChanged(); }
    }
    else if (what === 'meta') { const needList = S.source.type === 'coll' && isSmart(S.source.id) || S.filter.rating || S.filter.flag !== 'all' || S.filter.labels.size || S.filter.keyword || S.source.type === 'picks' || S.source.type === 'rejected' || S.sort.key === 'rating' || S.sort.key === 'label';
      if (needList) refreshList(); else { data.forEach(updateCell); renderFilmstrip(); renderRight(); } renderLeft(); }
    else if (what === 'settings') { if (data === S.active) Dev.settingsChanged(); const c = $(`#grid .cell[data-id="${data}"] .badge`); if (c) updateCell(data); }
    else if (what === 'history') { if (data === S.active) Dev.renderHistory(); }
    else if (what === 'import' || what === 'remove' || what === 'load') { refreshList(); renderLeft(); if (S.view === 'dates') Dates.render(); }
    else if (what === 'collections') { renderLeft(); if (S.source.type === 'coll') { if (!Cat.collections.some(c => c.id === S.source.id)) S.source = { type: 'all' }; refreshList(); } }
    else if (what === 'presets') Dev.renderPresets();
  });
  try { navigator.storage?.persist?.(); } catch (e) { }
  Aero.busy('Opening catalog…');
  try { await Cat.load(); } catch (e) { console.error(e); Aero.toast('Could not open the catalog database: ' + e.message); }
  await IO.loadExportPresets();
  Aero.busy();
  const last = [...Cat.photos.values()].sort((a, b) => b.seq - a.seq)[0]; if (last) S.lastImport = last.importId;
  refreshList(false); renderLeft(); setModule('library');
  $('#st-save').textContent = 'Catalog saved';
}
boot();
