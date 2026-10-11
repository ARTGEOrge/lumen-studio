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
function insertLayer(L) { doc.layers.splice(doc.active + 1, 0, L); doc.active++; updatePanels(); return L; }
function newLayerCmd() { insertLayer(newLayer(`Layer ${layerCount++}`)); doc.editMask = false; pushHistory('New Layer'); }
function dupLayer() {
  const s = layer(), L = newLayer(s.name + ' copy', s.canvas ? clone(s.canvas) : null, s.x, s.y, s.type);
  Object.assign(L, { opacity: s.opacity, blend: s.blend, visible: s.visible });
  if (s.mask) L.mask = { canvas: clone(s.mask.canvas), enabled: s.mask.enabled };
  if (s.text) L.text = { ...s.text };
  if (s.adjust) L.adjust = { kind: s.adjust.kind, params: { ...s.adjust.params } };
  insertLayer(L); pushHistory('Duplicate Layer');
}
function deleteLayer() {
  if (doc.layers.length < 2) return toast('Cannot delete the only layer');
  doc.layers.splice(doc.active, 1); doc.active = Math.max(0, doc.active - 1); doc.editMask = false; pushHistory('Delete Layer', 'none');
}
function moveLayer(d) {
  const i = doc.active, j = i + d; if (j < 0 || j >= doc.layers.length) return;
  [doc.layers[i], doc.layers[j]] = [doc.layers[j], doc.layers[i]]; doc.active = j; pushHistory('Reorder Layer', 'none');
}
function bakeMask(L) { // apply a layer's mask into its pixels
  if (!L.mask || !L.canvas) return;
  if (L.mask.enabled) { const c = cx(L.canvas); reset(c); c.globalCompositeOperation = 'destination-in'; drawLumAlpha(c, L.mask.canvas, 0, 0); reset(c); }
  L.mask = null;
}
function mergeDown() {
  if (doc.active === 0) return toast('No layer below');
  const top = layer(), below = doc.layers[doc.active - 1];
  if (below.type === 'adjust') return toast('Cannot merge into an adjustment layer');
  rasterize(below); bakeMask(below);
  if (top.visible) {
    if (top.type === 'adjust') {
      const adj = FILTERS[top.adjust.kind].fn(below.canvas, top.adjust.params);
      lerpInto(below.canvas, adj, clone(maskK(top, top.mask?.enabled ? top.mask.canvas : null, lrect(below))), top.opacity);
    } else {
      ensureCover(below, lrect(top));
      let img = top.canvas;
      if (top.mask && top.mask.enabled) { img = clone(top.canvas); const ic = cx(img); ic.globalCompositeOperation = 'destination-in'; drawLumAlpha(ic, top.mask.canvas, 0, 0); reset(ic); }
      const c = cx(below.canvas); reset(c); c.globalAlpha = top.opacity; c.globalCompositeOperation = top.blend; c.drawImage(img, top.x - below.x, top.y - below.y); reset(c);
    }
  }
  doc.layers.splice(doc.active, 1); doc.active--; doc.editMask = false; pushHistory('Merge Down');
}
function flatten() {
  composite(); const c = clone(comp); doc.layers = [newLayer('Background', c)]; doc.active = 0; doc.editMask = false; pushHistory('Flatten Image', 'all');
}
function mergeVisible() {
  composite(); const c = clone(comp);
  doc.layers = doc.layers.filter(L => !L.visible); doc.layers.push(newLayer('Merged', c)); doc.active = doc.layers.length - 1; doc.editMask = false;
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
      let w = v.w, h = v.h;
      if (v.p !== 100) { w = doc.w * v.p / 100; h = doc.h * v.p / 100; }
      else if (v.lock) { if (w !== doc.w) h = w / ar; else if (h !== doc.h) w = h * ar; }
      resizeImage(Math.round(clamp(w, 1, 20000)), Math.round(clamp(h, 1, 20000)));
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
    onOK: v => {
      const w = Math.round(clamp(v.w, 1, 20000)), h = Math.round(clamp(v.h, 1, 20000)), [ax, ay] = v.a.split(',').map(Number);
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
  });
}
function cropToSelection() { if (!selection) return toast('Make a selection first'); const b = maskBounds(selection.mask); if (b) { cropRect = b; applyCrop(); } }
function trimTransparent() { composite(); const b = maskBounds(comp); if (!b) return toast('Image is empty'); cropRect = b; applyCrop(); }
function revealAll() { // grow the canvas to show every layer's off-canvas pixels
  let r = docRect(); doc.layers.forEach(L => { if (L.canvas) r = unionRect(r, lrect(L)); });
  if (r.w === doc.w && r.h === doc.h) return toast('Nothing outside the canvas');
  doc.layers.forEach(L => shiftLayer(L, -r.x, -r.y)); setDocSize(r.w, r.h); pushHistory('Reveal All', 'all'); fit();
}
