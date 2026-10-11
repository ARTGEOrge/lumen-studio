'use strict';
/* Core: state, layer model, compositing, history, rendering, selection.
   Layers are positioned (x, y) and can be any size, so pixels outside the canvas are never lost.
   Masks are opaque grayscale canvases (white = reveal) sharing their layer's bounds. */
const $ = s => document.querySelector(s);
const vp = $('#viewport'), view = $('#view'), overlay = $('#overlay');
const vctx = view.getContext('2d'), octx = overlay.getContext('2d');

let doc = null, comp = null, zoom = 1, panX = 0, panY = 0, dpr = 1;
let fg = '#000000', bg = '#ffffff', tool = 'brush';
let selection = null, selVer = 1, edgeCache = null, antPhase = 0;
let live = null;            // { isMask, get() } live replacement for the active layer's pixels/mask while dragging
let preview = null, stroke = null, cropRect = null;
let uid = 1, layerCount = 1, clip = null, pasteHandled = false;
let dirty = true, frameReq = false, dragging = false, panning = null, spaceDown = false;
let cloneSrc = null, cloneOffset = null, lastPaint = null;
let docVer = 0, prefixCache = null, L2A_OK = false;
window.__lumenDirty = false;
const mouse = { sx: 0, sy: 0, x: 0, y: 0, inside: false };

const opts = {
  size: 24, hardness: 0.8, opacity: 1, tolerance: 32, contiguous: true, sampleAll: false,
  aligned: true, shape: 'rect', shapeFill: true, strokeW: 4, radius: 16,
  grad: 'linear', gradMode: 'fgbg', marquee: 'rect', strength: 0.6, exposure: 0.5,
  dodgeMode: 'dodge', range: 'mid', cropDelete: false
};

const BLENDS = [['source-over', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'],
  ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color Dodge'], ['color-burn', 'Color Burn'],
  ['hard-light', 'Hard Light'], ['soft-light', 'Soft Light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'],
  ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity'], ['lighter', 'Linear Dodge (Add)']];

/* ---------- helpers ---------- */
function mk(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
function cx(c) { return c.getContext('2d'); }
function clone(src) { const c = mk(src.width, src.height); cx(c).drawImage(src, 0, 0); return c; }
function reset(c) { c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.globalCompositeOperation = 'source-over'; c.filter = 'none'; c.shadowColor = 'transparent'; }
function hexToRgb(h) { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
function rgbToHex(r, g, b) { return '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); }
function grayHex(h) { const [r, g, b] = hexToRgb(h), y = .299 * r + .587 * g + .114 * b; return rgbToHex(y, y, y); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function normRect(a, b) { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) }; }
function unionRect(a, b) { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; }
function interRect(a, b) { const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), w = Math.min(a.x + a.w, b.x + b.w) - x, h = Math.min(a.y + a.h, b.y + b.h) - y; return w > 0 && h > 0 ? { x, y, w, h } : null; }
function roundRect(r) { const x = Math.floor(r.x), y = Math.floor(r.y); return { x, y, w: Math.ceil(r.x + r.w) - x, h: Math.ceil(r.y + r.h) - y }; }
function docRect() { return { x: 0, y: 0, w: doc.w, h: doc.h }; }
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2000); }
function loadImg(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
const scratches = {};
function scratchSized(n, w, h) {
  let s = scratches[n];
  if (!s || s.width !== w || s.height !== h) s = scratches[n] = mk(w, h);
  const c = cx(s); reset(c); c.clearRect(0, 0, s.width, s.height); return s;
}
function maskBounds(m) {
  const d = cx(m).getImageData(0, 0, m.width, m.height).data, w = m.width, h = m.height;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/* ---------- luminance -> alpha (for masks) ---------- */
function testL2A() {
  try {
    const s = mk(2, 1), c = cx(s); c.fillStyle = '#fff'; c.fillRect(0, 0, 1, 1); c.fillStyle = '#000'; c.fillRect(1, 0, 1, 1);
    const o = mk(2, 1), oc = cx(o); oc.filter = 'url(#l2a)'; oc.drawImage(s, 0, 0);
    const d = oc.getImageData(0, 0, 2, 1).data; L2A_OK = d[3] > 250 && d[7] < 5;
  } catch (e) { L2A_OK = false; }
}
function lumToAlpha(src) {
  const o = clone(src), c = cx(o), img = c.getImageData(0, 0, o.width, o.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i + 3] = (d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8; d[i] = d[i + 1] = d[i + 2] = 0; }
  c.putImageData(img, 0, 0); return o;
}
function drawLumAlpha(c, src, x, y) {
  if (L2A_OK) { c.filter = 'url(#l2a)'; c.drawImage(src, x, y); c.filter = 'none'; } else c.drawImage(lumToAlpha(src), x, y);
}
// Canvas over `rect` (doc coords) whose alpha = mask value; areas outside the mask count as revealed.
function maskK(L, maskCanvas, rect) {
  const k = scratchSized('k', rect.w, rect.h), c = cx(k);
  c.fillStyle = '#000'; c.fillRect(0, 0, rect.w, rect.h);
  if (maskCanvas) { const ox = L.x - rect.x, oy = L.y - rect.y; c.clearRect(ox, oy, maskCanvas.width, maskCanvas.height); drawLumAlpha(c, maskCanvas, ox, oy); }
  return k;
}
// dst = dst*(1-k*op) + adj*k*op  (premultiplied lerp)
function lerpInto(dst, adj, k, opacity) {
  const ac = cx(adj); reset(ac); ac.globalCompositeOperation = 'destination-in'; ac.drawImage(k, 0, 0); reset(ac);
  const c = cx(dst); reset(c); c.globalAlpha = opacity; c.globalCompositeOperation = 'destination-out'; c.drawImage(k, 0, 0);
  c.globalCompositeOperation = 'lighter'; c.drawImage(adj, 0, 0); reset(c);
}

/* ---------- layers ---------- */
function newLayer(name, canvas, x = 0, y = 0, type = 'raster') {
  if (canvas === undefined) canvas = mk(doc.w, doc.h);
  return { id: uid++, name, type, canvas, ctx: canvas ? cx(canvas) : null, x, y, visible: true, opacity: 1, blend: type === 'group' ? 'pass-through' : 'source-over', mask: null, text: null, adjust: null, parent: 0, collapsed: false, style: null };
}
function setCanvas(L, c) { L.canvas = c; L.ctx = c ? cx(c) : null; }
function layer() { return doc.layers[doc.active]; }
function lrect(L) { const c = L.canvas || L.mask?.canvas; return c ? { x: L.x, y: L.y, w: c.width, h: c.height } : docRect(); }
function resizeLayerTo(L, r) {
  r = roundRect(r);
  if (L.canvas) { const c = mk(r.w, r.h); cx(c).drawImage(L.canvas, L.x - r.x, L.y - r.y); setCanvas(L, c); }
  if (L.mask) { const m = mk(r.w, r.h), mc = cx(m); mc.fillStyle = '#fff'; mc.fillRect(0, 0, r.w, r.h); mc.drawImage(L.mask.canvas, L.x - r.x, L.y - r.y); L.mask.canvas = m; }
  L.x = r.x; L.y = r.y;
}
function ensureCover(L, r = docRect()) {
  if (!L.canvas && !L.mask) return;
  const b = lrect(L);
  if (b.x <= r.x && b.y <= r.y && b.x + b.w >= r.x + r.w && b.y + b.h >= r.y + r.h) return;
  resizeLayerTo(L, unionRect(b, r));
}
function shiftLayer(L, dx, dy) { L.x += dx; L.y += dy; if (L.text) { L.text.ax += dx; L.text.ay += dy; } }
function newMaskCanvas(L, fill) {
  const r = lrect(L);
  if (!L.canvas) { L.x = r.x; L.y = r.y; }
  const m = mk(r.w, r.h), c = cx(m); c.fillStyle = fill; c.fillRect(0, 0, r.w, r.h); return m;
}
// Prepare the active layer (or its mask) for pixel editing. Rasterizes text layers when painting pixels.
function editTarget(quiet) {
  const L = layer();
  if (doc.editMask && L.mask) { ensureCover(L); return { L, canvas: L.mask.canvas, isMask: true }; }
  if (L.type === 'adjust') { if (!quiet) toast('Adjustment layers have no pixels — paint on its mask or pick another layer'); return null; }
  if (L.type === 'group') { if (!quiet) toast('Groups have no pixels — pick a layer inside the group'); return null; }
  if (L.type === 'text') { rasterize(L); toast('Text layer rasterized'); }
  ensureCover(L);
  return { L, canvas: L.canvas, isMask: false };
}
function tctx(t) { const c = cx(t.canvas); reset(c); c.setTransform(1, 0, 0, 1, -t.L.x, -t.L.y); return c; }
function rasterize(L) { if (L.type !== 'text') return; L.type = 'raster'; L.text = null; updatePanels(); }
// Render the target into a doc-sized canvas (doc coordinates)
function docRender(t) { const s = scratchSized('dr', doc.w, doc.h); cx(s).drawImage(t.canvas, t.L.x, t.L.y); return s; }
// `src` masked by the current selection, where src's pixel (0,0) sits at doc (ox, oy)
function maskedAt(src, ox = 0, oy = 0, name = 'm') {
  if (!selection) return src;
  const s = scratchSized(name, src.width, src.height), c = cx(s);
  c.drawImage(src, 0, 0); c.globalCompositeOperation = 'destination-in'; c.drawImage(selection.mask, -ox, -oy); reset(c);
  return s;
}
const masked = src => maskedAt(src, 0, 0);
// Replace the target's pixels with `out` (same size/space as target), limited to the selection
function putResult(t, orig, out) {
  const c = cx(t.canvas); reset(c); c.clearRect(0, 0, t.canvas.width, t.canvas.height);
  if (selection) {
    c.drawImage(orig, 0, 0);
    c.globalCompositeOperation = 'destination-out'; c.drawImage(selection.mask, -t.L.x, -t.L.y);
    c.globalCompositeOperation = 'source-over'; c.drawImage(maskedAt(out, t.L.x, t.L.y), 0, 0);
  } else c.drawImage(out, 0, 0);
  reset(c);
}

/* ---------- text layers ---------- */
const FONTS = ['Segoe UI', 'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Garamond', 'Courier New', 'Consolas',
  'Verdana', 'Trebuchet MS', 'Impact', 'Comic Sans MS', 'Segoe Script', 'Palatino Linotype', 'Tahoma'];
const TEXT_DEFAULT = { text: 'Your text', font: 'Segoe UI', size: 64, color: '#000000', bold: true, italic: false, align: 'left', lh: 1.2, tracking: 0, outline: 0, outlineColor: '#000000', shadow: false, angle: 0, ax: 0, ay: 0 };
const textFont = t => `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${t.size}px "${t.font}"`;
function renderText(L) {
  const t = L.text, m = cx(mk(1, 1));
  m.font = textFont(t); m.letterSpacing = (t.tracking || 0) + 'px';
  const lines = String(t.text).split('\n'), bw = Math.max(1, ...lines.map(l => m.measureText(l).width)), bh = Math.max(1, lines.length * t.size * t.lh);
  const pad = Math.ceil(t.size * 0.3 + (t.outline || 0) + (t.shadow ? t.size / 5 : 0)) + 2;
  const W = bw + pad * 2, H = bh + pad * 2, a = (t.angle || 0) * Math.PI / 180, cs = Math.abs(Math.cos(a)), sn = Math.abs(Math.sin(a));
  const cw = Math.ceil(W * cs + H * sn), ch = Math.ceil(W * sn + H * cs), c = mk(cw, ch), x = cx(c);
  x.translate(cw / 2, ch / 2); x.rotate(a); x.translate(-W / 2 + pad, -H / 2 + pad);
  x.font = textFont(t); x.letterSpacing = (t.tracking || 0) + 'px'; x.textBaseline = 'top'; x.textAlign = t.align; x.lineJoin = 'round';
  lines.forEach((l, i) => {
    const lx = t.align === 'center' ? bw / 2 : t.align === 'right' ? bw : 0, ly = i * t.size * t.lh;
    if (t.shadow) { x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = t.size / 8; x.shadowOffsetX = x.shadowOffsetY = t.size / 16; }
    if (t.outline > 0) { x.strokeStyle = t.outlineColor; x.lineWidth = t.outline * 2; x.strokeText(l, lx, ly); x.shadowColor = 'transparent'; }
    x.fillStyle = t.color; x.fillText(l, lx, ly); x.shadowColor = 'transparent';
  });
  const nx = Math.round(t.ax + bw / 2 - cw / 2), ny = Math.round(t.ay + bh / 2 - ch / 2);
  if (L.mask) { const old = L.mask.canvas, mm = mk(cw, ch), mc = cx(mm); mc.fillStyle = '#fff'; mc.fillRect(0, 0, cw, ch); mc.drawImage(old, L.x - nx, L.y - ny); L.mask.canvas = mm; }
  setCanvas(L, c); L.x = nx; L.y = ny;
  L.name = 'T  ' + (lines[0].slice(0, 28) || 'Text');
}

/* ---------- document ---------- */
function layerFromSpec(o) {
  const L = newLayer(o.name || 'Layer', o.canvas === undefined ? null : o.canvas, o.x || 0, o.y || 0, o.type || 'raster');
  L.visible = o.visible ?? true; L.opacity = o.opacity ?? 1; L.blend = o.blend || 'source-over';
  if (o.mask) L.mask = { canvas: o.mask, enabled: o.maskEnabled ?? true };
  if (o.text) { L.text = { ...TEXT_DEFAULT, ...o.text }; renderText(L); if (o.name) L.name = o.name; }
  if (o.adjust) L.adjust = { kind: o.adjust.kind, params: { ...o.adjust.params } };
  if (L.type === 'group') { setCanvas(L, null); L.collapsed = !!o.collapsed; if (!o.blend) L.blend = 'pass-through'; }
  L.style = sanitizeStyle(o.style);
  L._specId = o.id; L._specParent = o.parent;
  return L;
}
// Build layers from specs: spec ids/parents (e.g. from files) are remapped to fresh ids and the group tree is repaired
function layersFromSpecs(specs) {
  const out = specs.map(layerFromSpec), map = new Map();
  out.forEach(L => { if (L._specId != null) map.set(L._specId, L); });
  out.forEach(L => { const p = L._specParent != null ? map.get(L._specParent) : null; L.parent = p && p.type === 'group' && p !== L ? p.id : 0; delete L._specId; delete L._specParent; });
  return repairTree(out);
}
function startDoc(w, h, specs, label, name, filePath) {
  if (typeof ftActive === 'function' && ftActive()) ftCancel(true);
  doc = { w, h, layers: [], active: 0, editMask: false, path: null, name: name || 'Untitled', filePath: filePath || null, guides: [] };
  doc.layers = layersFromSpecs(specs);
  doc.active = clamp(specs.activeIndex ?? doc.layers.length - 1, 0, doc.layers.length - 1);
  comp = mk(w, h); selection = null; cropRect = null; preview = null; cloneSrc = null; layerCount = doc.layers.length;
  if (typeof compare !== 'undefined' && compare) stopCompare();
  resetHistory(); pushHistory(label || 'New', 'all');
  window.__lumenDirty = false; updateTitle(); fit();
}
function newDocument(w, h, fill) {
  const c = mk(w, h); if (fill) { const x = cx(c); x.fillStyle = fill; x.fillRect(0, 0, w, h); }
  startDoc(w, h, [{ name: 'Background', canvas: c }], 'New Document');
}
function startFromImage(img, name) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, c = mk(w, h);
  cx(c).drawImage(img, 0, 0);
  startDoc(w, h, [{ name: 'Background', canvas: c }], 'Open', name);
}
function placeCanvas(c, name, fitToDoc = true) {
  let w = c.width, h = c.height; const s = fitToDoc ? Math.min(1, doc.w / w, doc.h / h) : 1;
  const o = mk(w * s, h * s), oc = cx(o); oc.imageSmoothingQuality = 'high'; oc.drawImage(c, 0, 0, o.width, o.height);
  const L = newLayer(name || 'Placed', o, Math.round((doc.w - o.width) / 2), Math.round((doc.h - o.height) / 2));
  insertLayer(L); pushHistory('Place');
}
function setDocSize(w, h) { doc.w = w; doc.h = h; comp = mk(w, h); setSel(null); cropRect = null; prefixCache = null; }
function updateTitle() { if (doc) document.title = `${doc.name}${window.__lumenDirty ? ' •' : ''} – Lumen Photo`; }

/* ---------- history (branching tree) ----------
   Every state is a node. Undoing and then editing starts a new branch instead of discarding the old one. */
let hist = { nodes: new Map(), roots: [], cur: null, seq: 0 };
const MAX_HISTORY_NODES = 150;
function resetHistory() { hist = { nodes: new Map(), roots: [], cur: null, seq: 0 }; }
function snapshot(scope) {
  const prev = hist.cur?.state, act = layer();
  return {
    w: doc.w, h: doc.h, active: doc.active, editMask: doc.editMask,
    layers: doc.layers.map(L => {
      const p = prev && prev.layers.find(o => o.id === L.id);
      const reuse = p && (scope === 'none' || (scope === 'active' && L !== act));
      return {
        id: L.id, name: L.name, type: L.type, x: L.x, y: L.y, visible: L.visible, opacity: L.opacity, blend: L.blend,
        canvas: L.canvas ? (reuse && p.canvas ? p.canvas : clone(L.canvas)) : null,
        mask: L.mask ? { enabled: L.mask.enabled, canvas: reuse && p.mask ? p.mask.canvas : clone(L.mask.canvas) } : null,
        text: L.text ? { ...L.text } : null,
        adjust: L.adjust ? { kind: L.adjust.kind, params: { ...L.adjust.params } } : null,
        parent: L.parent || 0, collapsed: !!L.collapsed, style: L.style ? JSON.parse(JSON.stringify(L.style)) : null
      };
    })
  };
}
function addNode(label, state, parent, id, time) {
  const n = { id: id ?? ++hist.seq, label, state, parent: parent || null, children: [], next: null, time: time || Date.now() };
  hist.seq = Math.max(hist.seq, n.id); hist.nodes.set(n.id, n);
  if (parent) { parent.children.push(n); parent.next = n; } else hist.roots.push(n);
  return n;
}
function pathToRoot(n) { const p = []; for (; n; n = n.parent) p.push(n); return p; }
function removeNode(n) {
  n.children.slice().forEach(removeNode);
  hist.nodes.delete(n.id);
  if (n.parent) { const sib = n.parent.children; sib.splice(sib.indexOf(n), 1); if (n.parent.next === n) n.parent.next = sib[sib.length - 1] || null; }
  else hist.roots.splice(hist.roots.indexOf(n), 1);
}
function pruneHistory() {
  while (hist.nodes.size > MAX_HISTORY_NODES) {
    const keep = new Set(pathToRoot(hist.cur).map(n => n.id));
    const leaf = [...hist.nodes.values()].filter(n => !n.children.length && !keep.has(n.id)).sort((a, b) => a.id - b.id)[0];
    if (leaf) { removeNode(leaf); continue; }
    // only the current path is left: drop its oldest node and re-root
    const root = hist.roots[0], child = root.children.find(c => keep.has(c.id));
    root.children.filter(c => c !== child).forEach(removeNode);
    hist.nodes.delete(root.id); hist.roots = hist.roots.filter(r => r !== root);
    if (child) { child.parent = null; hist.roots.unshift(child); }
  }
}
let suppressHistory = false;   // batch processing runs without history
function pushHistory(label, scope = 'active') {
  if (suppressHistory) { docVer++; return; }
  const st = snapshot(scope);
  hist.cur = addNode(label, st, hist.cur);
  pruneHistory();
  window.__lumenDirty = true; updateTitle();
  requestRender(); updatePanels();
}
function stateToLayers(s) {
  return s.layers.map(o => {
    const L = { id: o.id, name: o.name, type: o.type, x: o.x, y: o.y, visible: o.visible, opacity: o.opacity, blend: o.blend, canvas: null, ctx: null, mask: null, text: o.text ? { ...o.text } : null, adjust: o.adjust ? { kind: o.adjust.kind, params: { ...o.adjust.params } } : null,
      parent: o.parent || 0, collapsed: !!o.collapsed, style: o.style ? JSON.parse(JSON.stringify(o.style)) : null };
    setCanvas(L, o.canvas ? clone(o.canvas) : null);
    if (o.mask) L.mask = { enabled: o.mask.enabled, canvas: clone(o.mask.canvas) };
    return L;
  });
}
function restoreNode(n) {
  if (!n || !doc) return;
  if (typeof ftActive === 'function' && ftActive()) ftCancel(true);
  const s = n.state, sizeChanged = s.w !== doc.w || s.h !== doc.h;
  doc.w = s.w; doc.h = s.h; doc.active = s.active; doc.editMask = s.editMask;
  doc.layers = stateToLayers(s);
  uid = Math.max(uid, ...doc.layers.map(L => L.id + 1));
  for (let a = n; a.parent; a = a.parent) a.parent.next = a;  // redo follows this branch
  if (sizeChanged) { comp = mk(doc.w, doc.h); setSel(null); fit(); }
  hist.cur = n; window.__lumenDirty = true; updateTitle(); requestRender(); updatePanels();
}
const undo = () => { if (hist.cur?.parent) restoreNode(hist.cur.parent); };
const redo = () => { if (hist.cur?.next) restoreNode(hist.cur.next); };

/* ---------- compositing ---------- */
function drawLayerOnto(target, L, i) {
  if (!L.visible) return;
  const c = cx(target), act = i === doc.active && live;
  const maskSrc = L.mask && L.mask.enabled ? (act && live.isMask ? live.get() : L.mask.canvas) : null;
  if (L.type === 'adjust') {
    const A = FILTERS[L.adjust.kind]; if (!A) return;
    const adj = A.fn(target, L.adjust.params);
    lerpInto(target, adj, maskK(L, maskSrc, { x: 0, y: 0, w: target.width, h: target.height }), L.opacity);
    return;
  }
  const src = act && !live.isMask ? live.get() : L.canvas; if (!src) return;
  let img = src;
  if (maskSrc) {
    const t = scratchSized('lm', src.width, src.height), tc = cx(t);
    tc.drawImage(src, 0, 0); tc.globalCompositeOperation = 'destination-in'; drawLumAlpha(tc, maskSrc, 0, 0); reset(tc); img = t;
  }
  if (L.style && styleHasEffects(L.style)) { drawStyled(target, L, img, i >= 0 && !act); return; }
  reset(c); c.globalAlpha = L.opacity; c.globalCompositeOperation = L.blend; c.drawImage(img, L.x, L.y); reset(c);
}
/* Groups: layers form a tree through `parent` (a group's id). In the flat array a group's descendants sit
   contiguously directly below the group entry. Pass-through groups composite their children straight into the
   backdrop (group opacity/mask then fade the result); other blend modes render the group in isolation first. */
function buildTree(layers) {  // [{L, i, kids}] bottom-to-top (works for live layers and history states)
  const root = [], byId = new Map(), nodes = layers.map((L, i) => ({ L, i, kids: [] }));
  nodes.forEach(n => byId.set(n.L.id, n));
  nodes.forEach(n => { const p = n.L.parent ? byId.get(n.L.parent) : null; (p && p.L.type === 'group' && p !== n ? p.kids : root).push(n); });
  return root;
}
function renderNodes(target, nodes, isDoc, depth = 0) {
  for (const n of nodes) {
    if (!n.L.visible) continue;
    if (n.L.type === 'group') renderGroup(target, n, isDoc, depth);
    else drawLayerOnto(target, n.L, isDoc ? n.i : -1);
  }
}
function renderGroup(target, n, isDoc, depth) {
  const L = n.L, full = { x: 0, y: 0, w: target.width, h: target.height };
  const maskSrc = L.mask && L.mask.enabled ? (isDoc && n.i === doc.active && live && live.isMask ? live.get() : L.mask.canvas) : null;
  if (L.blend === 'pass-through') {
    if (L.opacity >= 1 && !maskSrc) { renderNodes(target, n.kids, isDoc, depth + 1); return; }
    const buf = scratchSized('grp' + depth, target.width, target.height); cx(buf).drawImage(target, 0, 0);
    renderNodes(buf, n.kids, isDoc, depth + 1);
    lerpInto(target, buf, maskK(L, maskSrc, full), L.opacity);
    return;
  }
  const buf = scratchSized('grp' + depth, target.width, target.height), bc = cx(buf);
  renderNodes(buf, n.kids, isDoc, depth + 1);
  if (maskSrc) { bc.globalCompositeOperation = 'destination-in'; bc.drawImage(maskK(L, maskSrc, full), 0, 0); reset(bc); }
  const c = cx(target); reset(c); c.globalAlpha = L.opacity; c.globalCompositeOperation = L.blend; c.drawImage(buf, 0, 0); reset(c);
}
// Flatten any history state (used by Compare and Time-lapse)
function compositeState(state) {
  const t = mk(state.w, state.h);
  renderNodes(t, buildTree(state.layers), false);
  return t;
}
function composite(target = comp) {
  const c = cx(target); reset(c); c.clearRect(0, 0, target.width, target.height);
  let roots = buildTree(doc.layers);
  if (target === comp && live && !layer().parent) { // during a drag, root items below the active one don't change: reuse them
    const key = docVer + ':' + doc.active + ':' + doc.w + 'x' + doc.h;
    if (!prefixCache || prefixCache.key !== key) { const p = mk(doc.w, doc.h); renderNodes(p, roots.filter(n => n.i < doc.active), true); prefixCache = { key, canvas: p }; }
    c.drawImage(prefixCache.canvas, 0, 0); roots = roots.filter(n => n.i >= doc.active);
  }
  renderNodes(target, roots, true);
}

/* ---------- group tree helpers ---------- */
const layerById = (id, layers = doc.layers) => layers.find(L => L.id === id) || null;
function isDescendant(L, gid, layers = doc.layers) {
  const map = new Map(layers.map(x => [x.id, x]));
  for (let p = L.parent, g = 0; p && g < 100; p = map.get(p)?.parent, g++) if (p === gid) return true;
  return false;
}
function depthOf(L, layers = doc.layers) { let d = 0; const map = new Map(layers.map(x => [x.id, x])); for (let p = L.parent; p && d < 100; p = map.get(p)?.parent) d++; return d; }
function effVisible(L, layers = doc.layers) {
  if (!L.visible) return false;
  const map = new Map(layers.map(x => [x.id, x]));
  for (let p = map.get(L.parent), g = 0; p && g < 100; p = map.get(p.parent), g++) if (!p.visible) return false;
  return true;
}
// [start, end] index range of the layer at i plus (for a group) all its descendants
function blockOf(i, layers = doc.layers) {
  const L = layers[i]; if (!L || L.type !== 'group') return [i, i];
  let s = i; while (s > 0 && isDescendant(layers[s - 1], L.id, layers)) s--;
  return [s, i];
}
// Re-flatten so every group's descendants sit contiguously directly below it (also drops invalid parents / cycles)
function repairTree(layers) {
  const map = new Map(layers.map(L => [L.id, L]));
  layers.forEach(L => {
    const p = map.get(L.parent);
    if (!p || p.type !== 'group' || p === L) L.parent = 0;
  });
  layers.forEach(L => { for (let q = map.get(L.parent), g = 0; q; q = map.get(q.parent), g++) if (q === L || g > 60) { L.parent = 0; break; } });
  const out = [], walk = list => list.forEach(n => { if (n.L.type === 'group') walk(n.kids); out.push(n.L); });
  walk(buildTree(layers));
  return out;
}

/* ---------- rendering ---------- */
const checker = (() => { const c = mk(16, 16), x = cx(c); x.fillStyle = '#fff'; x.fillRect(0, 0, 16, 16); x.fillStyle = '#cbcbcb'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8); return c; })();
let checkerPat = null, compVer = -1;
// stroking=true keeps the cached composite of the layers below the active one
function requestRender(stroking) { if (!stroking) docVer++; dirty = true; schedule(); }
function requestView() { dirty = true; schedule(); }   // pan / zoom only: the cached composite is reused
function requestOverlay() { schedule(); }
function schedule() { if (!frameReq) { frameReq = true; requestAnimationFrame(frame); } }
function frame() {
  frameReq = false;
  const W = vp.clientWidth, H = vp.clientHeight; dpr = window.devicePixelRatio || 1;
  const pw = Math.round(W * dpr), ph = Math.round(H * dpr);
  if (view.width !== pw || view.height !== ph) { view.width = overlay.width = pw; view.height = overlay.height = ph; dirty = true; }
  if (dirty) { dirty = false; renderMain(); }
  renderOverlay(); updateStatus();
}
function renderMain() {
  const c = vctx; c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, view.width, view.height);  // the viewport's CSS backdrop shows through
  if (!doc) return;
  if (comp.width !== doc.w || comp.height !== doc.h) comp = mk(doc.w, doc.h);
  if (live || compVer !== docVer) { composite(); compVer = docVer; }
  c.save(); c.translate(Math.round(panX), Math.round(panY));
  c.shadowColor = 'rgba(20,40,70,.55)'; c.shadowBlur = 16; c.shadowOffsetY = 3;
  c.fillStyle = checkerPat || (checkerPat = c.createPattern(checker, 'repeat'));
  c.fillRect(0, 0, doc.w * zoom, doc.h * zoom); c.shadowBlur = 0; c.shadowOffsetY = 0;
  c.scale(zoom, zoom);
  c.imageSmoothingEnabled = zoom < 1; c.imageSmoothingQuality = 'high';
  c.drawImage(comp, 0, 0);
  if (compare) drawCompare(c);
  c.restore();
}
function edges() {
  const s = Math.min(1, zoom), key = selection.ver + '|' + s.toFixed(4);
  if (edgeCache && edgeCache.key === key) return edgeCache;
  const w = Math.max(1, Math.round(doc.w * s)), h = Math.max(1, Math.round(doc.h * s));
  const m = mk(w, h), mc = cx(m); mc.drawImage(selection.mask, 0, 0, w, h);
  const d = mc.getImageData(0, 0, w, h).data;
  const A = new ImageData(w, h), B = new ImageData(w, h), a = A.data, b = B.data;
  const on = i => d[i * 4 + 3] >= 128;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!on(i)) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !on(i - 1) || !on(i + 1) || !on(i - w) || !on(i + w)) {
      const p = ((x >> 2) + (y >> 2)) & 1, j = i * 4, va = p ? 255 : 0, vb = 255 - va;
      a[j] = a[j + 1] = a[j + 2] = va; a[j + 3] = 255; b[j] = b[j + 1] = b[j + 2] = vb; b[j + 3] = 255;
    }
  }
  const ca = mk(w, h), cb = mk(w, h); cx(ca).putImageData(A, 0, 0); cx(cb).putImageData(B, 0, 0);
  return (edgeCache = { key, a: ca, b: cb });
}
function ants(c, px) {
  c.lineWidth = px; c.setLineDash([4 * px, 4 * px]); c.strokeStyle = '#000'; c.stroke();
  c.lineDashOffset = 4 * px; c.strokeStyle = '#fff'; c.stroke(); c.setLineDash([]); c.lineDashOffset = 0;
}
function cross(c, x, y) {
  c.beginPath(); c.moveTo(x - 8, y); c.lineTo(x + 8, y); c.moveTo(x, y - 8); c.lineTo(x, y + 8);
  c.strokeStyle = '#000'; c.lineWidth = 3; c.stroke(); c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke();
}
const BRUSH_TOOLS = ['brush', 'eraser', 'clone', 'heal', 'spotheal', 'smudge', 'dodge'];
function renderOverlay() {
  const c = octx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, overlay.width, overlay.height);
  if (!doc) return;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (tool === 'move' && !dragging) { const r = lrect(layer()); c.strokeStyle = '#3a8ee6aa'; c.lineWidth = 1; c.setLineDash([5, 4]); c.strokeRect(panX + r.x * zoom + .5, panY + r.y * zoom + .5, r.w * zoom, r.h * zoom); c.setLineDash([]); }
  if (selection) { const e = edges(); c.imageSmoothingEnabled = false; c.drawImage(antPhase ? e.b : e.a, panX, panY, doc.w * zoom, doc.h * zoom); }
  if (doc.path && doc.path.pts.length) drawPath(c);
  if (preview) { c.save(); c.translate(panX, panY); c.scale(zoom, zoom); preview(c, 1 / zoom); c.restore(); }
  if (compare) { drawCompareOverlay(c); return; }
  if (mouse.inside && !spaceDown && !panning && BRUSH_TOOLS.includes(tool)) {
    const r = Math.max(1, opts.size * zoom / 2);
    c.beginPath(); c.arc(mouse.sx, mouse.sy, r, 0, Math.PI * 2);
    c.strokeStyle = '#000b'; c.lineWidth = 3; c.stroke(); c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke();
    if ((tool === 'clone' || tool === 'heal') && cloneSrc) {
      const p = cloneOffset ? { x: mouse.x + cloneOffset.x, y: mouse.y + cloneOffset.y } : cloneSrc;
      cross(c, panX + p.x * zoom, panY + p.y * zoom);
    }
  }
}
setInterval(() => { if (selection) { antPhase ^= 1; requestOverlay(); } }, 320);

/* ---------- view ---------- */
function fit() {
  if (!doc) return;
  const W = vp.clientWidth, H = vp.clientHeight;
  zoom = Math.min((W - 60) / doc.w, (H - 60) / doc.h, 1);
  if (!(zoom > 0)) zoom = 1;
  panX = (W - doc.w * zoom) / 2; panY = (H - doc.h * zoom) / 2; requestView();
}
function zoomAt(z, sx, sy) {
  z = clamp(z, 0.02, 64);
  const dx = (sx - panX) / zoom, dy = (sy - panY) / zoom;
  zoom = z; panX = sx - dx * zoom; panY = sy - dy * zoom; requestView();
}
const zoomCenter = f => zoomAt(zoom * f, vp.clientWidth / 2, vp.clientHeight / 2);
function actualPixels() { zoomAt(1, vp.clientWidth / 2, vp.clientHeight / 2); }
function toDoc(e) { const r = overlay.getBoundingClientRect(); return { x: (e.clientX - r.left - panX) / zoom, y: (e.clientY - r.top - panY) / zoom }; }

/* ---------- selection ---------- */
function setSel(m) { selection = m ? { mask: m, ver: selVer++ } : null; edgeCache = null; requestOverlay(); }
function maskEmpty(m) { const d = cx(m).getImageData(0, 0, m.width, m.height).data; for (let i = 3; i < d.length; i += 4) if (d[i]) return false; return true; }
function selMode(e) { return e.shiftKey && e.altKey ? 'int' : e.shiftKey ? 'add' : e.altKey ? 'sub' : 'new'; }
function applySelection(m, mode) {
  if (!selection || mode === 'new') { if (mode === 'sub' || mode === 'int') return; setSel(maskEmpty(m) ? null : m); return; }
  const c = cx(selection.mask);
  c.globalCompositeOperation = mode === 'add' ? 'source-over' : mode === 'sub' ? 'destination-out' : 'destination-in';
  c.drawImage(m, 0, 0); reset(c);
  setSel(maskEmpty(selection.mask) ? null : selection.mask);
}
function shapeMask(fn) { const m = mk(doc.w, doc.h), c = cx(m); c.fillStyle = '#fff'; c.beginPath(); fn(c); c.fill(); return m; }
function selectAll() { setSel(shapeMask(c => c.rect(0, 0, doc.w, doc.h))); }
function deselect() { setSel(null); }
function invertSel() {
  const m = shapeMask(c => c.rect(0, 0, doc.w, doc.h));
  if (selection) { const c = cx(m); c.globalCompositeOperation = 'destination-out'; c.drawImage(selection.mask, 0, 0); reset(c); }
  setSel(maskEmpty(m) ? null : m);
}
function thresholdBlur(src, r, t) {
  const m = mk(src.width, src.height), c = cx(m); c.filter = `blur(${r}px)`; c.drawImage(src, 0, 0); reset(c);
  const img = c.getImageData(0, 0, m.width, m.height), d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] > t ? 255 : 0;
  c.putImageData(img, 0, 0); return m;
}
function modifySel(kind) {
  if (!selection) return toast('Make a selection first');
  showDialog({
    title: { feather: 'Feather Selection', expand: 'Expand Selection', contract: 'Contract Selection' }[kind],
    fields: [{ key: 'r', label: 'Radius (px)', type: 'range', min: 1, max: 100, step: 1, value: 6 }],
    onOK: v => {
      let m;
      if (kind === 'feather') { m = mk(doc.w, doc.h); const c = cx(m); c.filter = `blur(${v.r}px)`; c.drawImage(selection.mask, 0, 0); reset(c); }
      else m = thresholdBlur(selection.mask, v.r / 2, kind === 'expand' ? 8 : 245);
      setSel(maskEmpty(m) ? null : m);
    }
  });
}
function selectLayerPixels() {
  const L = layer(); if (!L.canvas) return;
  const m = mk(doc.w, doc.h), c = cx(m); c.drawImage(L.canvas, L.x, L.y);
  c.globalCompositeOperation = 'source-in'; c.fillStyle = '#fff'; c.fillRect(0, 0, doc.w, doc.h); reset(c);
  setSel(maskEmpty(m) ? null : m);
}
// Flood region of `src` (pixel (0,0) at doc (ox,oy)), returned as a doc-sized Uint8Array
function floodMask(px, py, src, ox, oy, tol, contig) {
  const w = src.width, h = src.height, x0 = Math.floor(px - ox), y0 = Math.floor(py - oy);
  if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return null;
  const d = cx(src).getImageData(0, 0, w, h).data, i0 = (y0 * w + x0) * 4;
  const r = d[i0], g = d[i0 + 1], b = d[i0 + 2], a = d[i0 + 3];
  const match = i => { i *= 4; return Math.abs(d[i] - r) <= tol && Math.abs(d[i + 1] - g) <= tol && Math.abs(d[i + 2] - b) <= tol && Math.abs(d[i + 3] - a) <= tol; };
  const out = new Uint8Array(w * h);
  if (!contig) { for (let i = 0; i < w * h; i++) if (match(i)) out[i] = 1; }
  else {
    const stack = [x0, y0];
    while (stack.length) {
      const y = stack.pop(); let x = stack.pop(), idx = y * w + x;
      while (x >= 0 && !out[idx] && match(idx)) { x--; idx--; }
      x++; idx++;
      let up = false, dn = false;
      while (x < w && !out[idx] && match(idx)) {
        out[idx] = 1;
        if (y > 0) { const u = idx - w; if (!out[u] && match(u)) { if (!up) { stack.push(x, y - 1); up = true; } } else up = false; }
        if (y < h - 1) { const v = idx + w; if (!out[v] && match(v)) { if (!dn) { stack.push(x, y + 1); dn = true; } } else dn = false; }
        x++; idx++;
      }
    }
  }
  return { arr: out, w, h, ox, oy };
}
// Flood result -> doc-sized canvas filled with `rgb`
function floodToCanvas(f, rgb = [255, 255, 255]) {
  const img = new ImageData(f.w, f.h), d = img.data;
  for (let i = 0; i < f.arr.length; i++) if (f.arr[i]) { const j = i * 4; d[j] = rgb[0]; d[j + 1] = rgb[1]; d[j + 2] = rgb[2]; d[j + 3] = 255; }
  const s = mk(f.w, f.h); cx(s).putImageData(img, 0, 0);
  const c = mk(doc.w, doc.h); cx(c).drawImage(s, f.ox, f.oy); return c;
}
function sampleSource() {
  if (opts.sampleAll) { composite(); return { canvas: comp, x: 0, y: 0 }; }
  const L = layer(), src = doc.editMask && L.mask ? L.mask.canvas : L.canvas;
  if (!src) { composite(); return { canvas: comp, x: 0, y: 0 }; }
  return { canvas: src, x: L.x, y: L.y };
}
