'use strict';
/* Layer masks. A mask is an ordinary tile layer kept outside the layer tree (L.mask, L.mask.isMask):
   transparent pixels reveal, painted pixels hide by (1 − luminance) — so every painting tool, the
   transform tool and undo work on masks unchanged. Value m = 1 − a·(1 − luma), 0 = hidden, 1 = shown. */

// whole-document mask values (0..255) of a layer's mask
function maskValues(M) {
  const w = doc.w, h = doc.h, out = new Uint8Array(w * h).fill(255);
  for (let ty = 0; ty < doc.th; ty++) for (let tx = 0; tx < doc.tw; tx++) {
    const t = M.tiles[ty * doc.tw + tx]; if (!t) continue;
    const x0 = tx * TS, y0 = ty * TS, x1 = Math.min(w, x0 + TS), y1 = Math.min(h, y0 + TS);
    for (let y = y0; y < y1; y++) {
      let o = ((y - y0) * TS) * 4, i = y * w + x0;
      for (let x = x0; x < x1; x++, o += 4, i++) {
        const a = t[o + 3]; if (!a) continue;
        const l = (0.299 * t[o] + 0.587 * t[o + 1] + 0.114 * t[o + 2]) / 255;
        out[i] = Math.round(255 - a * (1 - l));
      }
    }
  }
  return out;
}
// write mask values (0..255, w*h) into a mask layer as black with alpha = 255 − m (sparse)
function setMaskValues(M, vals) {
  const w = doc.w, h = doc.h, rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < vals.length; i++) rgba[i * 4 + 3] = 255 - vals[i];
  M.tiles.fill(null); M.owned.clear(); for (let i = 0; i < M.tiles.length; i++) M.dirty.add(i);
  writeRegion(M, 0, 0, w, h, rgba, true);
}
function maskTargetName() { return doc.active && doc.active.mask && doc.editMask ? 'mask' : 'layer'; }

function cmdAddMask(mode = 'reveal') {
  if (!prepEdit()) return; const L = doc.active; if (!L) return;
  if (L.mask) { Aero.toast('This layer already has a mask'); return; }
  if (mode === 'selection' && !doc.sel) { Aero.toast('Make a selection first'); return; }
  const M = newMask(L);
  if (mode === 'hide') setMaskValues(M, new Uint8Array(doc.w * doc.h));
  else if (mode === 'selection') setMaskValues(M, doc.sel);
  else if (mode === 'hideSelection') { const v = new Uint8Array(doc.w * doc.h); for (let i = 0; i < v.length; i++) v[i] = 255 - doc.sel[i]; setMaskValues(M, v); }
  L.mask = M; L.maskOn = true; L.maskLinked = true; doc.editMask = true;
  if (mode === 'selection' || mode === 'hideSelection') { doc.sel = null; doc.selV++; selectionChanged(); }
  markDirty(M); doc.ver++;
  histPush(mode === 'hide' ? 'Add Mask (Hide All)' : mode === 'selection' ? 'Add Mask from Selection' : mode === 'hideSelection' ? 'Add Mask (Hide Selection)' : 'Add Mask');
  Aero.toast('Mask added — paint black to hide, white to reveal (\\ switches layer / mask)');
}
function requireMask() { const L = doc.active; if (!L || !L.mask) { Aero.toast('The current layer has no mask'); return null; } return L; }
function cmdDeleteMask() {
  if (!prepEdit()) return; const L = requireMask(); if (!L) return;
  L.mask = null; doc.editMask = false; doc.showMask = false; doc.ver++; histPush('Delete Mask'); R.gc();
}
function cmdApplyMask() {
  if (!prepEdit()) return; const L = requireMask(); if (!L) return;
  if (L.type === 'group') { Aero.toast('Group masks can’t be applied — merge the group first (Layer › Merge Group)'); return; }
  const m = maskValues(L.mask);
  if (L.type === 'fill') { // a fill layer becomes a pixel layer carrying the masked colour
    const P = new Layer('pixel', L.name, doc.w, doc.h), c = L.color.map(v => Math.round(v * 255)), rgba = new Uint8ClampedArray(doc.w * doc.h * 4);
    for (let i = 0; i < m.length; i++) { const j = i * 4; rgba[j] = c[0]; rgba[j + 1] = c[1]; rgba[j + 2] = c[2]; rgba[j + 3] = m[i]; }
    writeRegion(P, 0, 0, doc.w, doc.h, rgba, true);
    Object.assign(P, { visible: L.visible, opacity: L.opacity, blend: L.blend, clip: L.clip });
    const list = parentList(L); list.splice(list.indexOf(L), 1, P); doc.active = P;
  } else {
    const W = doc.w;
    forPixels(L, [0, 0, doc.w, doc.h], true, (t, o, x, y) => { const v = m[y * W + x]; if (v < 255) t[o + 3] = t[o + 3] * v / 255; });
    L.mask = null; markDirty(L); layerThumbDirty(L);
  }
  doc.editMask = false; doc.showMask = false; doc.ver++; histPush('Apply Mask'); R.gc();
}
function cmdToggleMaskOn() { const L = requireMask(); if (!L) return; L.maskOn = !L.maskOn; doc.ver++; requestRender(); histPush(L.maskOn ? 'Enable Mask' : 'Disable Mask'); }
function cmdToggleMaskLink() { const L = requireMask(); if (!L) return; L.maskLinked = !L.maskLinked; histPush(L.maskLinked ? 'Link Mask' : 'Unlink Mask'); Aero.toast(L.maskLinked ? 'Mask linked — it moves with the layer' : 'Mask unlinked — transform layer and mask separately'); }
function cmdInvertMask() {
  if (!prepEdit()) return; const L = requireMask(); if (!L) return;
  const m = maskValues(L.mask); for (let i = 0; i < m.length; i++) m[i] = 255 - m[i];
  setMaskValues(L.mask, m); layerThumbDirty(L.mask); doc.ver++; histPush('Invert Mask');
}
function cmdMaskToSelection() { const L = requireMask(); if (!L) return; setSelection(maskValues(L.mask), 'Load Mask as Selection'); }
function setEditMask(on) {
  const L = doc.active; on = !!(on && L && L.mask);
  if (floating) commitTransform();
  if (doc.editMask === on) return;
  doc.editMask = on; if (!on) doc.showMask = false;
  renderLayers(); renderCmd(); requestOverlay();
  $('#st-msg').textContent = on ? 'Painting on the layer mask (black hides, white reveals)' : 'Painting on the layer';
}
function toggleEditMask() { const L = doc.active; if (!L || !L.mask) { Aero.toast('The current layer has no mask — Layer › Add Mask'); return; } setEditMask(!doc.editMask); }
function toggleShowMask() { const L = doc.active; if (!L || !L.mask) return; doc.showMask = !doc.showMask; if (doc.showMask) doc.editMask = true; doc.ver++; requestRender(); renderLayers(); Aero.toast(doc.showMask ? 'Showing the mask (Alt-click the mask thumbnail again to return)' : 'Showing the image'); }

/* linked masks follow their layer through transforms: resample the whole mask with the same mapping
   (doc → doc homography from the floating quad back to the source rectangle) */
function transformLinkedMask(L, src, quad) {
  const M = L.mask; if (!M || !L.maskLinked) return;
  const H = inv3(squareToQuad(quad)), w = doc.w, h = doc.h;
  const m = maskValues(M), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const X = x + 0.5, Y = y + 0.5, d = H[6] * X + H[7] * Y + H[8];
    if (d <= 1e-9) { out[y * w + x] = 255; continue; }
    const u = (H[0] * X + H[1] * Y + H[2]) / d, v = (H[3] * X + H[4] * Y + H[5]) / d;
    const sx = src.x + u * src.w - 0.5, sy = src.y + v * src.h - 0.5;
    if (sx < -1 || sy < -1 || sx > w || sy > h) { out[y * w + x] = 255; continue; }
    const xi = Math.floor(sx), yi = Math.floor(sy), ax = sx - xi, ay = sy - yi;
    let acc = 0;
    for (let k = 0; k < 4; k++) {
      const xx = xi + (k & 1), yy = yi + (k >> 1), wg = (k & 1 ? ax : 1 - ax) * (k >> 1 ? ay : 1 - ay);
      acc += wg * (xx < 0 || yy < 0 || xx >= w || yy >= h ? 255 : m[yy * w + xx]);
    }
    out[y * w + x] = acc + 0.5;
  }
  setMaskValues(M, out); layerThumbDirty(M);
}
function flipLinkedMask(L, horiz) {
  const M = L.mask; if (!M || !L.maskLinked) return;
  const w = doc.w, h = doc.h, m = maskValues(M), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out[y * w + x] = horiz ? m[y * w + (w - 1 - x)] : m[(h - 1 - y) * w + x];
  setMaskValues(M, out); layerThumbDirty(M);
}
// thumbnail of a mask: grayscale m
function drawMaskThumb(M, cv) {
  const tw = 44, th = 33; cv.width = tw; cv.height = th; const c = cv.getContext('2d');
  const s = Math.min(tw / doc.w, th / doc.h), w = Math.max(1, Math.round(doc.w * s)), h = Math.max(1, Math.round(doc.h * s));
  const img = c.createImageData(w, h), d = img.data, step = 1 / s;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(doc.h - 1, Math.floor((y + 0.5) * step)), ty = (sy / TS) | 0, oy = sy % TS;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(doc.w - 1, Math.floor((x + 0.5) * step)), t = M.tiles[ty * doc.tw + ((sx / TS) | 0)], i = (y * w + x) * 4;
      let v = 255;
      if (t) { const o = (oy * TS + sx % TS) * 4, a = t[o + 3]; if (a) v = 255 - a * (1 - (0.299 * t[o] + 0.587 * t[o + 1] + 0.114 * t[o + 2]) / 255); }
      d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
    }
  }
  c.fillStyle = '#808080'; c.fillRect(0, 0, tw, th); c.putImageData(img, Math.round((tw - w) / 2), Math.round((th - h) / 2));
}
