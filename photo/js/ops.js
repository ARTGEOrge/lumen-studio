'use strict';
/* Edit, layer, mask and image operations */

/* ---------- edit ---------- */
function clearSel() {
  const t = editTarget(); if (!t) return;
  if (t.isMask) { if (!selection) return toast('Select an area of the mask to hide'); fillSel('#000000', true); return; }
  const c = tctx(t);
  if (selection) { c.globalCompositeOperation = 'destination-out'; c.drawImage(selection.mask, 0, 0); }
  else { reset(c); c.clearRect(0, 0, t.canvas.width, t.canvas.height); }
  reset(c); pushHistory('Clear');
}
function fillSel(color, raw) {
  const t = editTarget(); if (!t) return;
  const s = scratchSized('f', doc.w, doc.h), c = cx(s); c.fillStyle = raw ? color : paintColor(color); c.fillRect(0, 0, doc.w, doc.h);
  const tc = tctx(t); tc.drawImage(masked(s), 0, 0); reset(tc); pushHistory('Fill');
}
function strokeSel() {
  if (!selection) return toast('Make a selection first');
  showDialog({
    title: 'Stroke Selection', fields: [{ key: 'w', label: 'Width (px)', type: 'range', min: 1, max: 50, step: 1, value: 4 }],
    onOK: v => {
      const t = editTarget(); if (!t) return;
      const outer = thresholdBlur(selection.mask, v.w / 2, 10), inner = thresholdBlur(selection.mask, v.w / 2, 245), c = cx(outer);
      c.globalCompositeOperation = 'destination-out'; c.drawImage(inner, 0, 0);
      c.globalCompositeOperation = 'source-in'; c.fillStyle = paintColor(fg); c.fillRect(0, 0, doc.w, doc.h); reset(c);
      const tc = tctx(t); tc.drawImage(outer, 0, 0); reset(tc); pushHistory('Stroke');
    }
  });
}
function copySel(merged) {
  let src, ox = 0, oy = 0, b;
  if (merged) { composite(); src = comp; b = docRect(); }
  else {
    const L = layer(), s = doc.editMask && L.mask ? L.mask.canvas : L.canvas;
    if (!s) return toast('Nothing to copy on this layer');
    src = s; ox = L.x; oy = L.y; b = lrect(L);
  }
  if (selection) { b = maskBounds(selection.mask); if (!b) return; }
  const c = mk(b.w, b.h); cx(c).drawImage(maskedAt(src, ox, oy), ox - b.x, oy - b.y);
  clip = { canvas: c, x: b.x, y: b.y, external: false };
  try { c.toBlob(bl => navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': bl })]).catch(() => { })); } catch (e) { }
  toast(merged ? 'Copied merged' : 'Copied');
}
function cutSel() { copySel(false); clearSel(); if (hist.cur) hist.cur.label = 'Cut'; updatePanels(); }
function pasteCanvas(c, x, y, name) {
  if (!doc) { startDoc(c.width, c.height, [{ name: 'Background', canvas: clone(c) }], 'Paste'); return; }
  if (x == null || x > doc.w || y > doc.h || x + c.width < 0 || y + c.height < 0) { x = (doc.w - c.width) / 2; y = (doc.h - c.height) / 2; }
  insertLayer(newLayer(name || 'Pasted', clone(c), Math.round(x), Math.round(y)));
  doc.editMask = false; setSel(null); pushHistory('Paste');
}
function pasteClip() { if (clip) pasteCanvas(clip.canvas, clip.x, clip.y); else toast('Nothing to paste'); }
async function readSystemClipboard() {
  try {
    const items = await navigator.clipboard.read();
    for (const it of items) { const t = it.types.find(t => t.startsWith('image/')); if (t) { const img = await loadImg(URL.createObjectURL(await it.getType(t))); const c = mk(img.width, img.height); cx(c).drawImage(img, 0, 0); pasteCanvas(c); return; } }
  } catch (e) { }
  pasteClip();
}
function layerViaCopy() {
  if (!selection) return dupLayer();
  const L0 = layer(); if (!L0.canvas) return toast('Nothing to copy on this layer');
  const b = maskBounds(selection.mask); if (!b) return;
  const c = mk(b.w, b.h); cx(c).drawImage(maskedAt(L0.canvas, L0.x, L0.y), L0.x - b.x, L0.y - b.y);
  insertLayer(newLayer(L0.name + ' (copy)', c, b.x, b.y)); doc.editMask = false; setSel(null); pushHistory('Layer via Copy');
}

/* ---------- transform ---------- */
function xformCanvas(src, sx, sy, rot, whiteFill) {
  const w = src.width, h = src.height, a = rot * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [x * sx * cs - y * sy * sn, x * sx * sn + y * sy * cs]);
  const minx = Math.min(...pts.map(p => p[0])), maxx = Math.max(...pts.map(p => p[0])), miny = Math.min(...pts.map(p => p[1])), maxy = Math.max(...pts.map(p => p[1]));
  const o = mk(Math.ceil(maxx - minx), Math.ceil(maxy - miny)), c = cx(o);
  if (whiteFill) { c.fillStyle = '#fff'; c.fillRect(0, 0, o.width, o.height); }
  c.translate(-minx, -miny); c.rotate(a); c.scale(sx, sy); c.imageSmoothingQuality = 'high'; c.drawImage(src, -w / 2, -h / 2);
  return { canvas: o, ox: minx, oy: miny };
}
function transformDialog() {
  const L = layer();
  if (L.type === 'group') return toast('Pick a layer inside the group to transform');
  const orig = { x: L.x, y: L.y, canvas: L.canvas, mask: L.mask?.canvas, text: L.text ? { ...L.text } : null, type: L.type };
  const r0 = lrect(L), c0 = { x: r0.x + r0.w / 2, y: r0.y + r0.h / 2 };
  const draw = v => {
    const sx = v.sx / 100, sy = (v.lock ? v.sx : v.sy) / 100;
    if (L.type === 'text' && !v.fh && !v.fv) {
      L.text = { ...orig.text, size: Math.max(1, orig.text.size * sx), angle: orig.text.angle + v.rot }; renderText(L);
      const r = lrect(L); shiftLayer(L, Math.round(c0.x + v.dx - (r.x + r.w / 2)), Math.round(c0.y + v.dy - (r.y + r.h / 2)));
    } else {
      if (L.type === 'text') rasterize(L);
      const fx = v.fh ? -1 : 1, fy = v.fv ? -1 : 1;
      let o = null;
      if (orig.canvas) { o = xformCanvas(orig.canvas, sx * fx, sy * fy, v.rot, false); setCanvas(L, o.canvas); }
      if (orig.mask) { const m = xformCanvas(orig.mask, sx * fx, sy * fy, v.rot, true); L.mask.canvas = m.canvas; o = o || m; }
      if (o) { L.x = Math.round(c0.x + v.dx + o.ox); L.y = Math.round(c0.y + v.dy + o.oy); }
    }
    requestRender();
  };
  const back = () => { L.type = orig.type; L.text = orig.text ? { ...orig.text } : null; setCanvas(L, orig.canvas); if (L.mask) L.mask.canvas = orig.mask; L.x = orig.x; L.y = orig.y; requestRender(); updatePanels(); };
  showDialog({
    title: 'Transform Layer', fields: [
      { key: 'sx', label: 'Scale X %', type: 'range', min: 1, max: 400, step: 1, value: 100 },
      { key: 'sy', label: 'Scale Y %', type: 'range', min: 1, max: 400, step: 1, value: 100 },
      { key: 'lock', label: 'Keep proportions', type: 'checkbox', value: true },
      { key: 'rot', label: 'Rotate °', type: 'range', min: -180, max: 180, step: 1, value: 0 },
      { key: 'dx', label: 'Offset X', type: 'number', value: 0 },
      { key: 'dy', label: 'Offset Y', type: 'number', value: 0 },
      { key: 'fh', label: 'Flip horizontal', type: 'checkbox', value: false },
      { key: 'fv', label: 'Flip vertical', type: 'checkbox', value: false }],
    onChange: draw, onOK: v => { draw(v); pushHistory('Transform'); }, onCancel: back
  });
}

/* ---------- layers ---------- */
// New layers go above the active one, in the same group (or at the top of an open group that is active)
function insertLayer(L) {
  const A = doc.layers[doc.active];
  if (A && A.type === 'group' && !A.collapsed) { L.parent = A.id; doc.layers.splice(doc.active, 0, L); }
  else { L.parent = A ? A.parent : 0; doc.layers.splice(doc.active + 1, 0, L); doc.active++; }
  updatePanels(); return L;
}
// Insert an already-linked list of layers (bottom-to-top, may contain groups) above the active layer
function insertBlock(arr) {
  if (!arr.length) return;
  const A = doc.layers[doc.active], ids = new Set(arr.map(L => L.id)), base = A ? A.parent : 0;
  arr.forEach(L => { if (!L.parent || !ids.has(L.parent)) L.parent = base; });
  doc.layers.splice(doc.active + 1, 0, ...arr); doc.active += arr.length; updatePanels();
}
function newLayerCmd() { insertLayer(newLayer(`Layer ${layerCount++}`)); doc.editMask = false; pushHistory('New Layer'); }
function copyLayerObj(s, idMap) {
  const L = newLayer(s.name, s.canvas ? clone(s.canvas) : null, s.x, s.y, s.type);
  Object.assign(L, { opacity: s.opacity, blend: s.blend, visible: s.visible, collapsed: !!s.collapsed });
  if (s.mask) L.mask = { canvas: clone(s.mask.canvas), enabled: s.mask.enabled };
  if (s.text) L.text = { ...s.text };
  if (s.adjust) L.adjust = { kind: s.adjust.kind, params: { ...s.adjust.params } };
  if (s.style) L.style = JSON.parse(JSON.stringify(s.style));
  idMap?.set(s.id, L.id); L.parent = s.parent;
  return L;
}
function dupLayer() {
  const [a, b] = blockOf(doc.active), idMap = new Map();
  const copies = doc.layers.slice(a, b + 1).map(s => copyLayerObj(s, idMap));
  copies.forEach(L => { if (idMap.has(L.parent)) L.parent = idMap.get(L.parent); });
  copies[copies.length - 1].name += ' copy';
  doc.layers.splice(b + 1, 0, ...copies); doc.active = b + copies.length;
  pushHistory(copies.length > 1 ? 'Duplicate Group' : 'Duplicate Layer');
}
function deleteLayer() {
  const [a, b] = blockOf(doc.active);
  if (doc.layers.length - (b - a + 1) < 1) return toast('Cannot delete the only layer');
  const wasGroup = layer().type === 'group';
  doc.layers.splice(a, b - a + 1); doc.active = clamp(a - 1, 0, doc.layers.length - 1); doc.editMask = false;
  pushHistory(wasGroup ? 'Delete Group' : 'Delete Layer', 'none');
}
// Move the block (layer or group + contents) at index i relative to anchor layer A: 'above' | 'below' | 'intoTop' | 'intoBottom'
function moveBlock(i, anchorId, where) {
  const [a, b] = blockOf(i), block = doc.layers.slice(a, b + 1), root = block[block.length - 1];
  if (block.some(L => L.id === anchorId)) return false;
  doc.layers.splice(a, block.length);
  const k = doc.layers.findIndex(L => L.id === anchorId); if (k < 0) { doc.layers.splice(a, 0, ...block); return false; }
  const A = doc.layers[k]; let at;
  if (where === 'above') { at = k + 1; root.parent = A.parent; }
  else if (where === 'below') { at = blockOf(k)[0]; root.parent = A.parent; }
  else if (where === 'intoTop') { at = k; root.parent = A.id; }
  else { at = blockOf(k)[0]; root.parent = A.id; }
  doc.layers.splice(at, 0, ...block);
  doc.active = at + block.length - 1;
  return true;
}
function moveLayer(d) {
  const i = doc.active, [s] = blockOf(i), L = doc.layers[i], P = L.parent;
  let ok = false;
  if (d > 0) {
    const X = doc.layers[i + 1]; if (!X) return;
    if (X.parent === P) ok = moveBlock(i, X.id, X.type === 'group' && !X.collapsed ? 'intoBottom' : 'above');
    else if (P) ok = moveBlock(i, P, 'above');   // top of its group: step out above the group
  } else {
    const Y = doc.layers[s - 1]; if (!Y) { if (P) ok = moveBlock(i, P, 'below'); else return; }
    else if (Y.parent === P) ok = moveBlock(i, Y.id, Y.type === 'group' && !Y.collapsed ? 'intoTop' : 'below');
    else if (P) ok = moveBlock(i, P, 'below');   // bottom of its group: step out below the group
  }
  if (ok) pushHistory('Reorder Layer', 'none');
}
/* ---------- groups ---------- */
function newGroup() { const G = newLayer('Group ' + (doc.layers.filter(L => L.type === 'group').length + 1), null, 0, 0, 'group'); insertLayer(G); doc.active = doc.layers.indexOf(G); doc.editMask = false; pushHistory('New Group', 'none'); }
function groupLayers() {   // put the active layer (or group) into a new group
  const [a, b] = blockOf(doc.active), R = doc.layers[b];
  const G = newLayer('Group ' + (doc.layers.filter(L => L.type === 'group').length + 1), null, 0, 0, 'group');
  G.parent = R.parent; R.parent = G.id;
  doc.layers.splice(b + 1, 0, G); doc.active = b + 1; doc.editMask = false; pushHistory('Group Layers', 'none');
}
function ungroup() {
  const G = layer(); if (G.type !== 'group') return toast('Select a group to ungroup');
  const i = doc.active;
  doc.layers.forEach(L => { if (L.parent === G.id) L.parent = G.parent; });
  doc.layers.splice(i, 1); doc.active = clamp(i - 1, 0, doc.layers.length - 1); pushHistory('Ungroup Layers', 'none');
}
function toggleCollapse(G) { G.collapsed = !G.collapsed; if (G.collapsed && isDescendant(layer(), G.id)) doc.active = doc.layers.indexOf(G); updatePanels(); }
// Merge Group: flatten a group's contents into one pixel layer (keeps group opacity / blend / mask)
function mergeGroup() {
  const G = layer(); if (G.type !== 'group') return;
  const [a, b] = blockOf(doc.active), tree = buildTree(doc.layers.slice(a, b + 1));
  const node = tree.find(n => n.L === G), buf = mk(doc.w, doc.h);
  if (node) renderNodes(buf, node.kids, false);
  const L = newLayer(G.name, buf, 0, 0); L.opacity = G.opacity; L.blend = G.blend === 'pass-through' ? 'source-over' : G.blend; L.visible = G.visible; L.parent = G.parent;
  if (G.mask) { const m = mk(doc.w, doc.h), mc = cx(m); mc.fillStyle = '#fff'; mc.fillRect(0, 0, doc.w, doc.h); mc.drawImage(G.mask.canvas, G.x, G.y); L.mask = { canvas: m, enabled: G.mask.enabled }; }
  doc.layers.splice(a, b - a + 1, L); doc.active = a; doc.editMask = false; pushHistory('Merge Group');
}
function bakeMask(L) { // apply a layer's mask into its pixels
  if (!L.mask || !L.canvas) return;
  if (L.mask.enabled) { const c = cx(L.canvas); reset(c); c.globalCompositeOperation = 'destination-in'; drawLumAlpha(c, L.mask.canvas, 0, 0); reset(c); }
  L.mask = null;
}
function mergeDown() {
  if (layer().type === 'group') return mergeGroup();
  if (doc.active === 0) return toast('No layer below');
  const top = layer(), below = doc.layers[doc.active - 1];
  if (below.parent !== top.parent) return toast('No layer below in this group');
  if (below.type === 'group') return toast('Cannot merge into a group — use Merge Group on it first');
  if (below.type === 'adjust') return toast('Cannot merge into an adjustment layer');
  rasterize(below); if (below.style) rasterizeStyle(below, true); bakeMask(below);
  if (top.visible && top.style && styleHasEffects(top.style) && top.type !== 'adjust') {
    const b = bakeStyled(top); ensureCover(below, { x: b.x, y: b.y, w: b.canvas.width, h: b.canvas.height });
    const c = cx(below.canvas); reset(c); blendDraw(c, b.canvas, b.x - below.x, b.y - below.y, top.opacity, top.blend);
  } else if (top.visible) {
    if (top.type === 'adjust') {
      const adj = FILTERS[top.adjust.kind].fn(below.canvas, top.adjust.params);
      lerpInto(below.canvas, adj, clone(maskK(top, top.mask?.enabled ? top.mask.canvas : null, lrect(below))), top.opacity);
    } else {
      ensureCover(below, lrect(top));
      let img = top.canvas;
      if (top.mask && top.mask.enabled) { img = clone(top.canvas); const ic = cx(img); ic.globalCompositeOperation = 'destination-in'; drawLumAlpha(ic, top.mask.canvas, 0, 0); reset(ic); }
      const c = cx(below.canvas); reset(c); blendDraw(c, img, top.x - below.x, top.y - below.y, top.opacity, top.blend);
    }
  }
  doc.layers.splice(doc.active, 1); doc.active--; doc.editMask = false; pushHistory('Merge Down');
}
function flatten() {
  composite(); const c = clone(comp); doc.layers = [newLayer('Background', c)]; doc.active = 0; doc.editMask = false; pushHistory('Flatten Image', 'all');
  recordStep({ type: 'flatten' });
}
function mergeVisible() {
  composite(); const c = clone(comp);
  doc.layers = doc.layers.filter(L => L.type !== 'group' && !effVisible(L)); doc.layers.forEach(L => L.parent = 0);
  doc.layers.push(newLayer('Merged', c)); doc.active = doc.layers.length - 1; doc.editMask = false;
  pushHistory('Merge Visible', 'all');
}
function renameLayer() {
  const L = layer();
  showDialog({ title: 'Rename Layer', fields: [{ key: 'n', label: 'Name', type: 'text', value: L.name }], onOK: v => { L.name = v.n || L.name; pushHistory('Rename Layer', 'none'); } });
}
function flipCanvasData(src, h) { const o = mk(src.width, src.height), c = cx(o); if (h) { c.translate(o.width, 0); c.scale(-1, 1); } else { c.translate(0, o.height); c.scale(1, -1); } c.drawImage(src, 0, 0); return o; }
function flipLayer(h) {
  const L = layer(); if (L.type === 'text') { rasterize(L); toast('Text layer rasterized'); }
  if (L.canvas) setCanvas(L, flipCanvasData(L.canvas, h));
  if (L.mask) L.mask.canvas = flipCanvasData(L.mask.canvas, h);
  pushHistory(h ? 'Flip Layer Horizontal' : 'Flip Layer Vertical');
}
function editLayerContent(L = layer()) {
  if (L.type === 'text') return textDialog(L, false);
  if (L.type === 'adjust') return editAdjustment(L, false);
  renameLayer();
}
function rasterizeCmd() { const L = layer(); if (L.type !== 'text') return toast('Only text layers need rasterizing'); rasterize(L); pushHistory('Rasterize'); }

/* ---------- masks ---------- */
function addMask(kind) {
  const L = layer(); if (L.mask) return toast('This layer already has a mask');
  const m = newMaskCanvas(L, kind === 'hide' || kind === 'sel' ? '#000' : '#fff');
  if ((kind === 'sel' || kind === 'hidesel') && selection) {
    let s = selection.mask;
    if (kind === 'hidesel') { s = clone(s); const sc = cx(s); sc.globalCompositeOperation = 'source-in'; sc.fillStyle = '#000'; sc.fillRect(0, 0, s.width, s.height); }
    cx(m).drawImage(s, -L.x, -L.y); setSel(null);
  }
  L.mask = { canvas: m, enabled: true }; doc.editMask = true; pushHistory('Add Layer Mask');
}
function deleteMask() { const L = layer(); if (!L.mask) return; L.mask = null; doc.editMask = false; pushHistory('Delete Layer Mask'); }
function applyMaskCmd() {
  const L = layer(); if (!L.mask) return; if (L.type === 'adjust') return toast('Adjustment layer masks cannot be applied');
  rasterize(L); bakeMask(L); doc.editMask = false; pushHistory('Apply Layer Mask');
}
function toggleMask() { const L = layer(); if (!L.mask) return; L.mask.enabled = !L.mask.enabled; pushHistory(L.mask.enabled ? 'Enable Mask' : 'Disable Mask'); }
function invertMask() { const L = layer(); if (!L.mask) return; doc.editMask = true; runFilter('Invert'); }
function maskFromAlpha() { // like Photoshop "Layer Mask > From Transparency"
  const L = layer(); if (!L.canvas || L.mask) return toast(L.mask ? 'This layer already has a mask' : 'No pixels');
  const m = newMaskCanvas(L, '#000'), c = cx(m), a = clone(L.canvas), ac = cx(a);
  ac.globalCompositeOperation = 'source-in'; ac.fillStyle = '#fff'; ac.fillRect(0, 0, a.width, a.height); c.drawImage(a, 0, 0);
  const lc = cx(L.canvas); lc.globalCompositeOperation = 'destination-over'; lc.fillStyle = '#000'; lc.fillRect(0, 0, L.canvas.width, L.canvas.height); reset(lc);
  L.mask = { canvas: m, enabled: true }; pushHistory('Mask From Transparency');
}

/* ---------- image ---------- */
function rotCanvas90(src, deg) {
  const w = src.width, h = src.height, o = deg === 180 ? mk(w, h) : mk(h, w), c = cx(o);
  if (deg === 90) { c.translate(h, 0); c.rotate(Math.PI / 2); } else if (deg === -90) { c.translate(0, w); c.rotate(-Math.PI / 2); } else { c.translate(w, h); c.rotate(Math.PI); }
  c.drawImage(src, 0, 0); return o;
}
function rotateCanvas(deg) {
  const W = doc.w, H = doc.h;
  const rp = p => deg === 90 ? { x: H - p.y, y: p.x } : deg === -90 ? { x: p.y, y: W - p.x } : { x: W - p.x, y: H - p.y };
  doc.layers.forEach(L => {
    const r = lrect(L);
    if (L.type === 'text') {
      const c1 = rp({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
      if (L.mask) L.mask.canvas = rotCanvas90(L.mask.canvas, deg);
      L.text.angle = ((L.text.angle + deg + 540) % 360) - 180; renderText(L);
      const r2 = lrect(L); shiftLayer(L, Math.round(c1.x - (r2.x + r2.w / 2)), Math.round(c1.y - (r2.y + r2.h / 2))); return;
    }
    if (L.canvas) setCanvas(L, rotCanvas90(L.canvas, deg));
    if (L.mask) L.mask.canvas = rotCanvas90(L.mask.canvas, deg);
    if (L.canvas || L.mask) {
      if (deg === 90) { L.x = H - (r.y + r.h); L.y = r.x; } else if (deg === -90) { L.x = r.y; L.y = W - (r.x + r.w); } else { L.x = W - (r.x + r.w); L.y = H - (r.y + r.h); }
    }
  });
  if (deg === 180) setDocSize(W, H); else setDocSize(H, W);
  pushHistory({ 90: 'Rotate 90° CW', '-90': 'Rotate 90° CCW', 180: 'Rotate 180°' }[deg], 'all'); fit();
  recordStep({ type: 'rotate', deg });
}
function flipCanvas(hz) {
  const W = doc.w, H = doc.h; let rast = 0;
  doc.layers.forEach(L => {
    if (L.type === 'text') { rasterize(L); rast++; }
    const r = lrect(L);
    if (L.canvas) setCanvas(L, flipCanvasData(L.canvas, hz));
    if (L.mask) L.mask.canvas = flipCanvasData(L.mask.canvas, hz);
    if (L.canvas || L.mask) { if (hz) L.x = W - (r.x + r.w); else L.y = H - (r.y + r.h); }
  });
  if (rast) toast(`${rast} text layer${rast > 1 ? 's' : ''} rasterized`);
  pushHistory(hz ? 'Flip Canvas Horizontal' : 'Flip Canvas Vertical', 'all');
  recordStep({ type: 'flip', h: hz });
}
function scaleCanvasData(src, sx, sy, white) {
  const o = mk(Math.max(1, Math.round(src.width * sx)), Math.max(1, Math.round(src.height * sy))), c = cx(o);
  if (white) { c.fillStyle = '#fff'; c.fillRect(0, 0, o.width, o.height); }
  c.imageSmoothingQuality = 'high'; c.drawImage(src, 0, 0, o.width, o.height); return o;
}
function resizeImage(nw, nh) {
  const sx = nw / doc.w, sy = nh / doc.h;
  doc.layers.forEach(L => {
    if (L.type === 'text') {
      if (L.mask) L.mask.canvas = scaleCanvasData(L.mask.canvas, sx, sy, true);
      L.x = Math.round(L.x * sx); L.y = Math.round(L.y * sy);
      Object.assign(L.text, { size: L.text.size * (sx + sy) / 2, ax: L.text.ax * sx, ay: L.text.ay * sy, outline: L.text.outline * (sx + sy) / 2 }); renderText(L); return;
    }
    if (L.canvas) setCanvas(L, scaleCanvasData(L.canvas, sx, sy));
    if (L.mask) L.mask.canvas = scaleCanvasData(L.mask.canvas, sx, sy, true);
    L.x = Math.round(L.x * sx); L.y = Math.round(L.y * sy);
  });
  setDocSize(nw, nh); pushHistory('Image Size', 'all'); fit();
}
function imageSizeDialog() {
  const ar = doc.w / doc.h;
  showDialog({
    title: 'Image Size', fields: [
      { key: 'w', label: 'Width (px)', type: 'number', min: 1, value: doc.w },
      { key: 'h', label: 'Height (px)', type: 'number', min: 1, value: doc.h },
      { key: 'p', label: 'Or scale %', type: 'number', min: 1, value: 100 },
      { key: 'lock', label: 'Keep proportions', type: 'checkbox', value: true }],
    onOK: v => {
      let w = v.w, h = v.h, step;
      if (v.p !== 100) { w = doc.w * v.p / 100; h = doc.h * v.p / 100; step = { p: v.p }; }
      else if (v.lock) { if (w !== doc.w) { h = w / ar; step = { w: v.w }; } else if (h !== doc.h) { w = h * ar; step = { h: v.h }; } else step = { w: v.w }; }
      else step = { w: v.w, h: v.h, lock: false };
      resizeImage(Math.round(clamp(w, 1, 20000)), Math.round(clamp(h, 1, 20000)));
      recordStep({ type: 'imageSize', w: 0, h: 0, p: 100, lock: true, ...step });
    }
  });
}
function canvasSizeDialog() {
  showDialog({
    title: 'Canvas Size', fields: [
      { key: 'w', label: 'Width (px)', type: 'number', min: 1, value: doc.w },
      { key: 'h', label: 'Height (px)', type: 'number', min: 1, value: doc.h },
      { key: 'a', label: 'Anchor', type: 'select', value: '1,1', options: [['0,0', 'Top left'], ['1,0', 'Top'], ['2,0', 'Top right'], ['0,1', 'Left'], ['1,1', 'Center'], ['2,1', 'Right'], ['0,2', 'Bottom left'], ['1,2', 'Bottom'], ['2,2', 'Bottom right']] },
      { key: 'fill', label: 'Fill new area', type: 'select', value: 'none', options: [['none', 'Transparent'], ['bg', 'Background color'], ['white', 'White']] }],
    onOK: v => { applyCanvasSize(v); recordStep({ type: 'canvasSize', ...v }); }
  });
}
function applyCanvasSize(v) {
  {
      const w = Math.round(clamp(v.w, 1, 20000)), h = Math.round(clamp(v.h, 1, 20000)), [ax, ay] = String(v.a).split(',').map(Number);
      const ox = Math.round((w - doc.w) * ax / 2), oy = Math.round((h - doc.h) * ay / 2), oldW = doc.w, oldH = doc.h;
      doc.layers.forEach(L => shiftLayer(L, ox, oy));
      setDocSize(w, h);
      const bottom = doc.layers[0];
      if (v.fill !== 'none' && bottom.type === 'raster') {
        ensureCover(bottom);
        const f = mk(w, h), fc = cx(f); fc.fillStyle = v.fill === 'bg' ? bg : '#fff'; fc.fillRect(0, 0, w, h); fc.clearRect(ox, oy, oldW, oldH);
        const c = tctx({ L: bottom, canvas: bottom.canvas }); c.globalCompositeOperation = 'destination-over'; c.drawImage(f, 0, 0); reset(c);
      }
      pushHistory('Canvas Size', 'all'); fit();
  }
}
function cropToSelection() { if (!selection) return toast('Make a selection first'); const b = maskBounds(selection.mask); if (b) { cropRect = b; applyCrop(); } }
function trimTransparent() { composite(); const b = maskBounds(comp); if (!b) return toast('Image is empty'); cropRect = b; applyCrop(); recordStep({ type: 'trim' }); }

function revealAll() { // grow the canvas to show every layer's off-canvas pixels
  let r = docRect(); doc.layers.forEach(L => { if (L.canvas) r = unionRect(r, lrect(L)); });
  if (r.w === doc.w && r.h === doc.h) return toast('Nothing outside the canvas');
  doc.layers.forEach(L => shiftLayer(L, -r.x, -r.y)); setDocSize(r.w, r.h); pushHistory('Reveal All', 'all'); fit();
}

/* ---------- Frequency Separation ----------
   Splits a pixel layer into Low Frequency (blurred color & tone) and High Frequency (texture, Linear Light, 128 = neutral)
   inside a group. low' + 2·(high − 128) reproduces every opaque pixel exactly: the odd remainder of (src − blur) is kept in
   the low layer, so the split itself changes nothing until you retouch. The original layer is kept below, hidden. */
function splitFrequencies(src, r) {
  const w = src.width, h = src.height, low = blur(src, r);
  const S = cx(src).getImageData(0, 0, w, h), Ld = cx(low).getImageData(0, 0, w, h), s = S.data, l = Ld.data, H = new ImageData(w, h), hd = H.data;
  for (let i = 0; i < s.length; i += 4) {
    for (let k = 0; k < 3; k++) { const d = s[i + k] - l[i + k], q = Math.trunc(d / 2); hd[i + k] = 128 + q; l[i + k] = s[i + k] - 2 * q; }
    hd[i + 3] = l[i + 3] = s[i + 3];
  }
  const lo = mk(w, h), hi = mk(w, h); cx(lo).putImageData(Ld, 0, 0); cx(hi).putImageData(H, 0, 0);
  return { lo, hi };
}
function frequencySeparation() {
  const L = layer();
  if (L.type !== 'raster' || !L.canvas) return toast('Select a pixel layer to split');
  let src = L.canvas;
  if (L.mask && L.mask.enabled) { src = clone(L.canvas); const c = cx(src); c.globalCompositeOperation = 'destination-in'; drawLumAlpha(c, L.mask.canvas, 0, 0); reset(c); }
  const orig = clone(L.canvas);
  showDialog({
    title: 'Frequency Separation', ok: 'Split',
    fields: [{ key: 'r', label: 'Radius (px)', type: 'range', min: 1, max: 60, step: 0.5, value: Math.max(2, Math.round(Math.min(doc.w, doc.h) / 250)) }],
    html: '<p class="dnote">Preview shows the Low Frequency layer: raise the radius until skin blemishes and pores disappear but shapes and shading remain. Then retouch tone on Low and texture on High (Spot Healing, Clone).</p>',
    onChange: v => { const c = cx(L.canvas); reset(c); c.clearRect(0, 0, orig.width, orig.height); c.drawImage(blur(orig, v.r), 0, 0); requestRender(); },
    onCancel: () => { const c = cx(L.canvas); reset(c); c.clearRect(0, 0, orig.width, orig.height); c.drawImage(orig, 0, 0); requestRender(); },
    onOK: v => {
      const c = cx(L.canvas); reset(c); c.clearRect(0, 0, orig.width, orig.height); c.drawImage(orig, 0, 0);
      const { lo, hi } = splitFrequencies(src, v.r), i = doc.active;
      const G = newLayer('Frequency Separation', null, 0, 0, 'group'), Lo = newLayer('Low Frequency (tone)', lo, L.x, L.y), Hi = newLayer('High Frequency (texture)', hi, L.x, L.y);
      G.parent = L.parent; Lo.parent = Hi.parent = G.id; Hi.blend = 'linear-light';
      doc.layers.splice(i + 1, 0, Lo, Hi, G); L.visible = false;
      doc.active = i + 2; doc.editMask = false;
      pushHistory('Frequency Separation', 'all');
      toast('Split into Low / High frequency — original kept below (hidden)');
    }
  });
}
