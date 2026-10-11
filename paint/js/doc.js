'use strict';
/* Document model. Pixel layers are sparse grids of 128×128 RGBA8 (straight alpha) tiles.
   Tiles are copy-on-write: a tile referenced by any history snapshot is never mutated, so undo
   history only stores the tiles a step actually changed (snapshots share all other tiles). */
const TS = 128, TSZ = TS * TS * 4;
const BLENDS = [['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color Dodge'], ['color-burn', 'Color Burn'], ['hard-light', 'Hard Light'], ['soft-light', 'Soft Light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['add', 'Add (Linear Dodge)'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']];
const BLEND_IDX = Object.fromEntries(BLENDS.map((b, i) => [b[0], i]));

let doc = null;
let layerSeq = 1;
function nextLayerName() { // "Layer n" with n one above the highest existing number in the document
  let n = 0; if (doc && doc.root) walk(doc.root, L => { const m = /^Layer (\d+)$/.exec(L.name); if (m) n = Math.max(n, +m[1]); });
  return 'Layer ' + (n + 1);
}

class Layer {
  constructor(type, name, w, h) {
    this.id = uid(); this.type = type; this.name = name || (type === 'group' ? 'Group' : nextLayerName());
    this.visible = true; this.opacity = 1; this.blend = 'normal'; this.lockAlpha = false; this.clip = false; this.open = true;
    this.color = [1, 1, 1];
    this.mask = null; this.maskOn = true; this.maskLinked = true; // layer mask: a tile layer outside the tree (transparent = reveal)
    this.text = null;    // text layer props (pixel layer whose tiles are the rendered text) — replaced, never mutated
    this.children = type === 'group' ? [] : null;
    this.tiles = type === 'pixel' ? new Array(Math.ceil(w / TS) * Math.ceil(h / TS)).fill(null) : null;
    this.owned = new Set();   // tiles created since the last snapshot (safe to mutate)
    this.dirty = new Set();   // tiles changed since last GPU upload
    this.thumbV = 0; this.ver = 0;
  }
}

function newDoc(w, h, name = 'Untitled') {
  const d = { w, h, tw: Math.ceil(w / TS), th: Math.ceil(h / TS), root: [], active: null, sel: null, selV: 0, name, path: null, ver: 0, paper: 'cold', paperScale: 1, editMask: false, showMask: false, anim: null };
  return d;
}
const tileCount = () => doc.tw * doc.th;

/* ---------- tree helpers ---------- */
function walk(list, fn, parent = null, depth = 0) { for (const L of list) { fn(L, parent, depth); if (L.children) walk(L.children, fn, L, depth + 1); } }
function allLayers() { const out = []; walk(doc.root, L => out.push(L)); return out; }
function pixelLayers() { return allLayers().filter(L => L.type === 'pixel'); }
function maskLayers() { const out = []; walk(doc.root, L => { if (L.mask) out.push(L.mask); }); return out; }
function tileLayers() { return [...pixelLayers(), ...maskLayers()]; } // everything that owns pixel tiles
function newMask(owner) { const M = new Layer('pixel', 'Mask', doc.w, doc.h); M.isMask = true; M.owner = owner; return M; }
function findLayer(id) { let r = null; walk(doc.root, L => { if (L.id === id) r = L; }); return r; }
function parentList(L) { let r = doc.root; walk(doc.root, (x, p) => { if (x === L) r = p ? p.children : doc.root; }); return r; }
function parentOf(L) { let r = null; walk(doc.root, (x, p) => { if (x === L) r = p; }); return r; }
function isEffectivelyVisible(L) { for (let x = L; x; x = parentOf(x)) if (!x.visible) return false; return true; }
// layer that a clipped layer clips to (first non-clipped below in same list)
function clipBase(L) { const list = parentList(L), i = list.indexOf(L); for (let j = i - 1; j >= 0; j--) if (!list[j].clip) return list[j]; return null; }

/* ---------- tile access ---------- */
function writeTile(L, idx) {
  let t = L.tiles[idx];
  if (!L.owned.has(idx)) { t = t ? t.slice() : new Uint8ClampedArray(TSZ); L.tiles[idx] = t; L.owned.add(idx); }
  L.dirty.add(idx); return t;
}
function markDirty(L) { L.ver++; doc.ver++; requestRender(); }
// read straight RGBA of a rect from a pixel layer
function readRegion(L, x, y, w, h, out) {
  out = out || new Uint8ClampedArray(w * h * 4);
  const tx0 = Math.max(0, Math.floor(x / TS)), ty0 = Math.max(0, Math.floor(y / TS)), tx1 = Math.min(doc.tw - 1, Math.floor((x + w - 1) / TS)), ty1 = Math.min(doc.th - 1, Math.floor((y + h - 1) / TS));
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const t = L.tiles[ty * doc.tw + tx]; if (!t) continue;
    const ox = tx * TS, oy = ty * TS, ax = Math.max(x, ox), ay = Math.max(y, oy), bx = Math.min(x + w, ox + TS), by = Math.min(y + h, oy + TS);
    for (let yy = ay; yy < by; yy++) { const s = ((yy - oy) * TS + (ax - ox)) * 4; out.set(t.subarray(s, s + (bx - ax) * 4), ((yy - y) * w + (ax - x)) * 4); }
  }
  return out;
}
// write straight RGBA rect into a layer (replaces pixels)
function writeRegion(L, x, y, w, h, data, skipEmpty = true) {
  const tx0 = Math.max(0, Math.floor(x / TS)), ty0 = Math.max(0, Math.floor(y / TS)), tx1 = Math.min(doc.tw - 1, Math.floor((x + w - 1) / TS)), ty1 = Math.min(doc.th - 1, Math.floor((y + h - 1) / TS));
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const ox = tx * TS, oy = ty * TS, ax = Math.max(x, ox, 0), ay = Math.max(y, oy, 0), bx = Math.min(x + w, ox + TS, doc.w), by = Math.min(y + h, oy + TS, doc.h);
    if (ax >= bx || ay >= by) continue;
    const idx = ty * doc.tw + tx;
    if (skipEmpty && !L.tiles[idx]) { let any = false; for (let yy = ay; yy < by && !any; yy++) { const r = ((yy - y) * w + (ax - x)) * 4; for (let i = r + 3, e = r + (bx - ax) * 4; i < e; i += 4) if (data[i]) { any = true; break; } } if (!any) continue; }
    const t = writeTile(L, idx);
    for (let yy = ay; yy < by; yy++) { const s = ((yy - y) * w + (ax - x)) * 4; t.set(data.subarray(s, s + (bx - ax) * 4), ((yy - oy) * TS + (ax - ox)) * 4); }
  }
  markDirty(L);
}
const layerRGBA = L => readRegion(L, 0, 0, doc.w, doc.h);
function layerBounds(L) { // tight bbox of non-transparent pixels or null
  let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (let ty = 0; ty < doc.th; ty++) for (let tx = 0; tx < doc.tw; tx++) {
    const t = L.tiles[ty * doc.tw + tx]; if (!t) continue;
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) if (t[(y * TS + x) * 4 + 3]) {
      const X = tx * TS + x, Y = ty * TS + y; if (X >= doc.w || Y >= doc.h) continue;
      if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function tileEmpty(t) { for (let i = 3; i < TSZ; i += 4) if (t[i]) return false; return true; }

/* ---------- history (snapshot of structure + tile reference arrays) ---------- */
function snapTree(list) { return list.map(L => ({ L, p: { name: L.name, visible: L.visible, opacity: L.opacity, blend: L.blend, lockAlpha: L.lockAlpha, clip: L.clip, color: L.color.slice(), open: L.open, mask: L.mask, maskOn: L.maskOn, maskLinked: L.maskLinked, text: L.text }, tiles: L.tiles ? L.tiles.slice() : null, mtiles: L.mask ? L.mask.tiles.slice() : null, children: L.children ? snapTree(L.children) : null })); }
function snapshot() { return { w: doc.w, h: doc.h, tree: snapTree(doc.root), active: doc.active?.id, sel: doc.sel }; }
function restoreTree(s) { return s.map(n => { const L = n.L; Object.assign(L, n.p); L.color = n.p.color.slice(); if (n.tiles) L.tiles = n.tiles.slice(); if (n.children) L.children = restoreTree(n.children); L.owned.clear(); L.ver++; if (L.mask && n.mtiles) { L.mask.tiles = n.mtiles.slice(); L.mask.owned.clear(); L.mask.ver++; } return L; }); }
function restoreSnapshot(s) {
  const dimsChanged = s.w !== doc.w || s.h !== doc.h;
  doc.w = s.w; doc.h = s.h; doc.tw = Math.ceil(s.w / TS); doc.th = Math.ceil(s.h / TS);
  doc.root = restoreTree(s.tree); doc.active = findLayer(s.active) || allLayers().find(L => L.type === 'pixel') || allLayers()[0] || null;
  if (doc.sel !== s.sel) { doc.sel = s.sel; doc.selV++; selectionChanged(); }
  if (!doc.active || !doc.active.mask) { doc.editMask = false; doc.showMask = false; }
  doc.ver++;
  if (dimsChanged) onDocResized(); else requestRender();
}
function freezeAll() { walk(doc.root, L => { L.owned.clear(); if (L.mask) L.mask.owned.clear(); }); }
let hist = null, histBusy = false;
function histPush(label) {
  freezeAll();
  hist.push(label, snapshot());
  doc.ver++; trimHistory(); afterChange(label);
}
/* keep undo memory bounded: unique tiles referenced by all snapshots (64 KB each) */
const HIST_BUDGET = 1024 * 1024 * 1024;
let histCheck = 0;
function histBytes() {
  const seen = new Set();
  const visit = list => { for (const n of list) { if (n.tiles) for (const t of n.tiles) if (t) seen.add(t); if (n.mtiles) for (const t of n.mtiles) if (t) seen.add(t); if (n.children) visit(n.children); } };
  for (const it of hist.items) if (it.state) visit(it.state.tree);
  return seen.size * TSZ;
}
function trimHistory() {
  if (++histCheck % 4 && hist.items.length < 30) return;
  let bytes = histBytes();
  while (bytes > HIST_BUDGET && hist.index > 1) { hist.items.shift(); hist.index--; bytes = histBytes(); }
  doc.histBytes = bytes;
}
function histReplaceTop() { freezeAll(); if (hist.items.length) hist.items[hist.index].state = snapshot(); }
function histGo(i) {
  if (activeStroke || histBusy) return;
  dryAllWet(); cancelTransientTools();
  const st = hist.go(i); if (st) { restoreSnapshot(st); afterChange(); }
}
function undo() { if (hist.index > 0) histGo(hist.index - 1); }
function redo() { if (hist.index < hist.items.length - 1) histGo(hist.index + 1); }
// patch layer tiles in all snapshots from state index `from` on (used when wet paint finishes drying)
function patchHistoryTiles(from, L, idxs) {
  for (let i = Math.max(0, from); i < hist.items.length; i++) {
    const st = hist.items[i].state; if (!st || st.w !== doc.w || st.h !== doc.h) continue;
    const visit = list => { for (const n of list) { if (n.L === L && n.tiles) { for (const k of idxs) n.tiles[k] = L.tiles[k]; } if (n.children) visit(n.children); } };
    visit(st.tree);
  }
}

/* ---------- layer structure ops ---------- */
function insertLayer(L, above = doc.active) {
  if (above) { const list = parentList(above); list.splice(list.indexOf(above) + 1, 0, L); }
  else doc.root.push(L);
  doc.active = L; return L;
}
function removeLayer(L) { const list = parentList(L), i = list.indexOf(L); if (i >= 0) list.splice(i, 1); }
function addPixelLayer(name, above) { const L = new Layer('pixel', name, doc.w, doc.h); insertLayer(L, above); return L; }

/* ---------- selection ---------- */
// doc.sel: Uint8Array(w*h) 0..255 or null; treated as immutable (replaced on change)
function selValueAt(x, y) { return doc.sel ? doc.sel[(y | 0) * doc.w + (x | 0)] : 255; }
function selBounds(sel = doc.sel) {
  if (!sel) return null; const w = doc.w, h = doc.h; let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) { const r = y * w; for (let x = 0; x < w; x++) if (sel[r + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; y1 = y; } }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
function maskFromPath(drawFn, feather = 0) {
  const c = new OffscreenCanvas(doc.w, doc.h), x = c.getContext('2d', { willReadFrequently: true });
  if (feather > 0) x.filter = `blur(${feather}px)`;
  x.fillStyle = '#fff'; drawFn(x);
  const d = x.getImageData(0, 0, doc.w, doc.h).data, m = new Uint8Array(doc.w * doc.h);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3];
  return m;
}
function combineSel(m, mode) {
  const cur = doc.sel;
  if (mode === 'replace' || !cur) { if (mode === 'subtract') return cur; if (mode === 'intersect' && !cur) return m; return m; }
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) {
    const a = cur[i], b = m[i];
    out[i] = mode === 'add' ? Math.max(a, b) : mode === 'subtract' ? (a * (255 - b) / 255) | 0 : Math.min(a, b);
  }
  return out;
}
function setSelection(m, label = 'Selection') {
  if (m) { let any = false; for (let i = 0; i < m.length; i += 7) if (m[i]) { any = true; break; } if (!any) for (let i = 0; i < m.length; i++) if (m[i]) { any = true; break; } if (!any) m = null; }
  doc.sel = m; doc.selV++; selectionChanged(); histPush(label);
}
