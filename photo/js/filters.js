'use strict';
/* Filters & adjustments. Entries with adj:true can also be added as non-destructive adjustment layers. */
function cssFilter(src, f) { const o = mk(src.width, src.height), c = cx(o); c.filter = f; c.drawImage(src, 0, 0); return o; }
function pixels(src, fn) { const o = clone(src), c = cx(o), img = c.getImageData(0, 0, o.width, o.height); fn(img.data, o.width, o.height); c.putImageData(img, 0, 0); return o; }
function blur(src, r) {
  if (r <= 0) return clone(src);
  const p = Math.ceil(r * 3), w = src.width, h = src.height, pad = mk(w + 2 * p, h + 2 * p), c = cx(pad);
  c.drawImage(src, p, p);  // extend edges so borders don't fade to transparent
  c.drawImage(src, 0, 0, w, 1, p, 0, w, p); c.drawImage(src, 0, h - 1, w, 1, p, h + p, w, p);
  c.drawImage(src, 0, 0, 1, h, 0, p, p, h); c.drawImage(src, w - 1, 0, 1, h, w + p, p, p, h);
  const b = cssFilter(pad, `blur(${r}px)`), o = mk(w, h);
  cx(o).drawImage(b, -p, -p); return o;
}
function convolve(src, k, mode) {
  const w = src.width, h = src.height, s = cx(src).getImageData(0, 0, w, h).data, o = new ImageData(w, h), d = o.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) {
      const i = (clamp(y + ky, 0, h - 1) * w + clamp(x + kx, 0, w - 1)) * 4, kv = k[(ky + 1) * 3 + kx + 1];
      r += s[i] * kv; g += s[i + 1] * kv; b += s[i + 2] * kv;
    }
    const j = (y * w + x) * 4;
    if (mode === 'edge') { d[j] = 255 - Math.abs(r); d[j + 1] = 255 - Math.abs(g); d[j + 2] = 255 - Math.abs(b); }
    else if (mode === 'emboss') { const v = (r + g + b) / 3 + 128; d[j] = d[j + 1] = d[j + 2] = v; }
    else { d[j] = r; d[j + 1] = g; d[j + 2] = b; }
    d[j + 3] = s[j + 3];
  }
  const c = mk(w, h); cx(c).putImageData(o, 0, 0); return c;
}
// Monotone cubic (Fritsch–Carlson) curve through control points -> 256 LUT
function monoLUT(xs, ys) {
  const n = xs.length, d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  const lut = new Uint8ClampedArray(256);
  for (let x = 0, i = 0; x < 256; x++) {
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = clamp((x - xs[i]) / h, 0, 1), t2 = t * t, t3 = t2 * t;
    lut[x] = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  }
  return lut;
}
const lutRGB = (s, lr, lg, lb) => pixels(s, d => { for (let i = 0; i < d.length; i += 4) { d[i] = lr[d[i]]; d[i + 1] = lg[d[i + 1]]; d[i + 2] = lb[d[i + 2]]; } });
const pct = v => Math.round(v) + '%';
const IDENT = Uint8ClampedArray.from({ length: 256 }, (_, i) => i);

const FILTERS = {
  'Brightness/Contrast…': { adj: 1, fields: [{ key: 'b', label: 'Brightness', type: 'range', min: -100, max: 100, value: 0 }, { key: 'c', label: 'Contrast', type: 'range', min: -100, max: 100, value: 0 }], fn: (s, v) => cssFilter(s, `brightness(${1 + v.b / 100}) contrast(${1 + v.c / 100})`) },
  'Levels…': {
    adj: 1, fields: [{ key: 'lo', label: 'Input black', type: 'range', min: 0, max: 254, value: 0 }, { key: 'g', label: 'Gamma', type: 'range', min: 0.1, max: 3, step: 0.01, value: 1 }, { key: 'hi', label: 'Input white', type: 'range', min: 1, max: 255, value: 255 }, { key: 'olo', label: 'Output black', type: 'range', min: 0, max: 255, value: 0 }, { key: 'ohi', label: 'Output white', type: 'range', min: 0, max: 255, value: 255 }],
    fn: (s, v) => { const lut = new Uint8ClampedArray(256), hi = Math.max(v.hi, v.lo + 1); for (let i = 0; i < 256; i++) lut[i] = v.olo + (v.ohi - v.olo) * Math.pow(clamp((i - v.lo) / (hi - v.lo), 0, 1), 1 / v.g); return lutRGB(s, lut, lut, lut); }
  },
  'Curves…': {
    adj: 1, fields: [{ key: 'ch', label: 'Channel', type: 'select', value: 'rgb', options: [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']] },
      { key: 'b0', label: 'Black point', type: 'range', min: 0, max: 128, value: 0 }, { key: 'p1', label: 'Shadows (64)', type: 'range', min: 0, max: 255, value: 64 }, { key: 'p2', label: 'Midtones (128)', type: 'range', min: 0, max: 255, value: 128 }, { key: 'p3', label: 'Highlights (192)', type: 'range', min: 0, max: 255, value: 192 }, { key: 'w0', label: 'White point', type: 'range', min: 128, max: 255, value: 255 }],
    fn: (s, v) => { const lut = monoLUT([0, 64, 128, 192, 255], [v.b0, v.p1, v.p2, v.p3, v.w0]); return lutRGB(s, v.ch === 'rgb' || v.ch === 'r' ? lut : IDENT, v.ch === 'rgb' || v.ch === 'g' ? lut : IDENT, v.ch === 'rgb' || v.ch === 'b' ? lut : IDENT); }
  },
  'Hue/Saturation…': { adj: 1, fields: [{ key: 'h', label: 'Hue', type: 'range', min: -180, max: 180, value: 0, fmt: v => v + '°' }, { key: 's', label: 'Saturation', type: 'range', min: -100, max: 100, value: 0 }, { key: 'l', label: 'Lightness', type: 'range', min: -100, max: 100, value: 0 }], fn: (s, v) => cssFilter(s, `hue-rotate(${v.h}deg) saturate(${1 + v.s / 100}) brightness(${1 + v.l / 100})`) },
  'Color Balance…': { adj: 1, fields: [{ key: 'r', label: 'Cyan ↔ Red', type: 'range', min: -100, max: 100, value: 0 }, { key: 'g', label: 'Magenta ↔ Green', type: 'range', min: -100, max: 100, value: 0 }, { key: 'b', label: 'Yellow ↔ Blue', type: 'range', min: -100, max: 100, value: 0 }], fn: (s, v) => pixels(s, d => { for (let i = 0; i < d.length; i += 4) { d[i] += v.r * 1.28; d[i + 1] += v.g * 1.28; d[i + 2] += v.b * 1.28; } }) },
  'Vibrance…': { adj: 1, fields: [{ key: 'v', label: 'Vibrance', type: 'range', min: -100, max: 100, value: 30 }], fn: (s, v) => pixels(s, d => { const a = v.v / 100; for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2], mx = Math.max(r, g, b), avg = (r + g + b) / 3, amt = (1 - (mx - avg) / 128) * a * 1.5; d[i] = r + (r - avg) * amt; d[i + 1] = g + (g - avg) * amt; d[i + 2] = b + (b - avg) * amt; } }) },
  'Photo Filter…': {
    adj: 1, fields: [{ key: 'c', label: 'Filter color', type: 'color', value: '#ec8a00' }, { key: 'd', label: 'Density', type: 'range', min: 0, max: 100, value: 25, fmt: pct }],
    fn: (s, v) => { const o = clone(s), c = cx(o); c.globalCompositeOperation = 'multiply'; c.globalAlpha = v.d / 100; c.fillStyle = v.c; c.fillRect(0, 0, o.width, o.height); c.globalAlpha = 1; c.globalCompositeOperation = 'destination-in'; c.drawImage(s, 0, 0); return o; }
  },
  'Gradient Map…': {
    adj: 1, fields: [{ key: 'a', label: 'Shadows', type: 'color', value: '#1b1036' }, { key: 'b', label: 'Highlights', type: 'color', value: '#ffd9a0' }],
    fn: (s, v) => { const A = hexToRgb(v.a), B = hexToRgb(v.b); return pixels(s, d => { for (let i = 0; i < d.length; i += 4) { const t = (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) / 255; d[i] = A[0] + (B[0] - A[0]) * t; d[i + 1] = A[1] + (B[1] - A[1]) * t; d[i + 2] = A[2] + (B[2] - A[2]) * t; } }); }
  },
  'Black & White': { adj: 1, fn: s => pixels(s, d => { for (let i = 0; i < d.length; i += 4) { const y = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]; d[i] = d[i + 1] = d[i + 2] = y; } }) },
  'Invert': { adj: 1, fn: s => pixels(s, d => { for (let i = 0; i < d.length; i += 4) { d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2]; } }) },
  'Threshold…': { adj: 1, fields: [{ key: 't', label: 'Level', type: 'range', min: 1, max: 255, value: 128 }], fn: (s, v) => pixels(s, d => { for (let i = 0; i < d.length; i += 4) { const y = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2], o = y >= v.t ? 255 : 0; d[i] = d[i + 1] = d[i + 2] = o; } }) },
  'Posterize…': { adj: 1, fields: [{ key: 'n', label: 'Levels', type: 'range', min: 2, max: 32, value: 4 }], fn: (s, v) => pixels(s, d => { const st = 255 / (v.n - 1); for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = Math.round(d[i + k] / st) * st; }) },
  'Sepia': { fn: s => cssFilter(s, 'sepia(1)') },
  'Auto Contrast': {
    fn: s => pixels(s, d => {
      const lo = [255, 255, 255], hi = [0, 0, 0];
      for (let i = 0; i < d.length; i += 4) if (d[i + 3]) for (let k = 0; k < 3; k++) { if (d[i + k] < lo[k]) lo[k] = d[i + k]; if (d[i + k] > hi[k]) hi[k] = d[i + k]; }
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = (d[i + k] - lo[k]) * 255 / Math.max(1, hi[k] - lo[k]);
    })
  },
  // Filter menu
  'Gaussian Blur…': { fields: [{ key: 'r', label: 'Radius (px)', type: 'range', min: 0, max: 100, step: 0.5, value: 4 }], fn: (s, v) => blur(s, v.r) },
  'Motion Blur…': {
    fields: [{ key: 'a', label: 'Angle °', type: 'range', min: -90, max: 90, value: 0 }, { key: 'd', label: 'Distance (px)', type: 'range', min: 1, max: 100, value: 15 }],
    fn: (s, v) => { const o = mk(s.width, s.height), c = cx(o), n = Math.max(2, Math.round(v.d)), rad = v.a * Math.PI / 180; c.drawImage(s, 0, 0); for (let i = 1; i < n; i++) { const t = i / (n - 1) - 0.5; c.globalAlpha = 1 / (i + 1); c.drawImage(s, Math.cos(rad) * t * v.d, -Math.sin(rad) * t * v.d); } return o; }
  },
  'Unsharp Mask…': {
    fields: [{ key: 'a', label: 'Amount', type: 'range', min: 0, max: 500, value: 100, fmt: pct }, { key: 'r', label: 'Radius (px)', type: 'range', min: 0.5, max: 20, step: 0.5, value: 2 }],
    fn: (s, v) => { const b = cx(blur(s, v.r)).getImageData(0, 0, s.width, s.height).data, a = v.a / 100; return pixels(s, d => { for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = d[i + k] + a * (d[i + k] - b[i + k]); }); }
  },
  'Sharpen': { fn: s => convolve(s, [0, -1, 0, -1, 5, -1, 0, -1, 0]) },
  'Add Noise…': { fields: [{ key: 'a', label: 'Amount', type: 'range', min: 0, max: 100, value: 15, fmt: pct }, { key: 'm', label: 'Monochromatic', type: 'checkbox', value: true }], fn: (s, v) => pixels(s, d => { const a = v.a * 2.55; for (let i = 0; i < d.length; i += 4) { if (v.m) { const n = (Math.random() * 2 - 1) * a; d[i] += n; d[i + 1] += n; d[i + 2] += n; } else for (let k = 0; k < 3; k++) d[i + k] += (Math.random() * 2 - 1) * a; } }) },
  'Pixelate…': { fields: [{ key: 'n', label: 'Cell size (px)', type: 'range', min: 2, max: 100, value: 10 }], fn: (s, v) => { const sm = mk(Math.ceil(s.width / v.n), Math.ceil(s.height / v.n)); cx(sm).drawImage(s, 0, 0, sm.width, sm.height); const o = mk(s.width, s.height), c = cx(o); c.imageSmoothingEnabled = false; c.drawImage(sm, 0, 0, sm.width * v.n, sm.height * v.n); return o; } },
  'Emboss': { fn: s => convolve(s, [-2, -1, 0, -1, 1, 1, 0, 1, 2], 'emboss') },
  'Find Edges': { fn: s => convolve(s, [-1, -1, -1, -1, 8, -1, -1, -1, -1], 'edge') },
  'Vignette…': {
    fields: [{ key: 'a', label: 'Amount', type: 'range', min: 0, max: 100, value: 60, fmt: pct }, { key: 'r', label: 'Size', type: 'range', min: 0, max: 100, value: 40, fmt: pct }],
    fn: (s, v) => { const o = clone(s), c = cx(o), w = s.width, h = s.height, R = Math.hypot(w, h) / 2, g = c.createRadialGradient(w / 2, h / 2, R * v.r / 100, w / 2, h / 2, R); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${v.a / 100})`); c.globalCompositeOperation = 'source-atop'; c.fillStyle = g; c.fillRect(0, 0, w, h); return o; }
  },
};
const ADJ_KINDS = Object.keys(FILTERS).filter(k => FILTERS[k].adj);
const plainName = n => n.replace('…', '');
const defaultsOf = F => Object.fromEntries((F.fields || []).map(f => [f.key, f.value]));

const fieldsOf = (F, params, src) => (F.fieldsFor ? F.fieldsFor(params, src) : (F.fields || []).map(f => ({ ...f, value: params?.[f.key] ?? f.value })));
const noteHtml = F => F.note ? `<p class="dnote">${F.note}</p>` : '';
// Destructive filter on the active layer (or its mask)
function runFilter(name) {
  const F = FILTERS[name], t = editTarget(); if (!t) return;
  const orig = clone(t.canvas);
  if (!F.fields && !F.fieldsFor) { putResult(t, orig, F.fn(orig, {})); pushHistory(plainName(name)); return; }
  const fields = fieldsOf(F, null, orig), init = defaultsOf({ fields });
  showDialog({
    title: plainName(name), fields, html: noteHtml(F), onInput: F.onInput,
    onChange: v => { F.onDialog?.(v, false, init); putResult(t, orig, F.fn(orig, v)); requestRender(); },
    onOK: v => { F.onDialog?.(v, true, init); putResult(t, orig, F.fn(orig, v)); pushHistory(plainName(name)); },
    onCancel: () => { putResult(t, orig, orig); requestRender(); }
  });
}
// Non-destructive adjustment layer
function addAdjustmentLayer(kind) {
  const F = FILTERS[kind];
  const L = newLayer(plainName(kind), null, 0, 0, 'adjust');
  composite();
  L.adjust = { kind, params: defaultsOf({ fields: fieldsOf(F, null, comp) }) };
  L.mask = { canvas: newMaskCanvas(L, '#fff'), enabled: true };
  if (selection) { const c = cx(L.mask.canvas); c.fillStyle = '#000'; c.fillRect(0, 0, doc.w, doc.h); c.drawImage(selection.mask, 0, 0); }
  insertLayer(L); doc.editMask = false;
  if (!F.fields && !F.fieldsFor) { pushHistory('New ' + plainName(kind)); return; }
  editAdjustment(L, true);
}
function editAdjustment(L, isNew) {
  const F = FILTERS[L.adjust.kind], old = { ...L.adjust.params };
  if (!F.fields && !F.fieldsFor) return toast('This adjustment has no settings');
  showDialog({
    title: plainName(L.adjust.kind) + ' (adjustment layer)', fields: fieldsOf(F, L.adjust.params), html: noteHtml(F), onInput: F.onInput,
    onChange: v => { F.onDialog?.(v, false, old); L.adjust.params = { ...v }; requestRender(); },
    onOK: v => { F.onDialog?.(v, true, old); L.adjust.params = { ...v }; pushHistory(isNew ? 'New ' + plainName(L.adjust.kind) : 'Edit Adjustment'); },
    onCancel: () => {
      if (isNew) { const i = doc.layers.indexOf(L); doc.layers.splice(i, 1); doc.active = clamp(i - 1, 0, doc.layers.length - 1); updatePanels(); }
      else L.adjust.params = old;
      requestRender();
    }
  });
}
