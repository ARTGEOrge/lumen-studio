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

/* ---------- Levels / Curves presets & graphs, Gradient Map stops ---------- */
const LEVELS_PRESETS = {
  default: { lo: 0, g: 1, hi: 255, olo: 0, ohi: 255 }, darker: { lo: 15, g: 0.7, hi: 255, olo: 0, ohi: 255 }, lighter: { lo: 0, g: 1.4, hi: 235, olo: 0, ohi: 255 },
  contrast1: { lo: 10, g: 1, hi: 245, olo: 0, ohi: 255 }, contrast2: { lo: 20, g: 1, hi: 235, olo: 0, ohi: 255 }, contrast3: { lo: 30, g: 1, hi: 225, olo: 0, ohi: 255 },
  shadows: { lo: 0, g: 1.6, hi: 255, olo: 0, ohi: 255 }, midbright: { lo: 0, g: 1.25, hi: 255, olo: 0, ohi: 255 }, middark: { lo: 0, g: 0.8, hi: 255, olo: 0, ohi: 255 },
  matte: { lo: 0, g: 1, hi: 255, olo: 28, ohi: 240 }
};
const LEVELS_PRESET_OPTS = [['custom', 'Custom'], ['auto', 'Auto (clip 0.1%)'], ['default', 'Default'], ['darker', 'Darker'], ['lighter', 'Lighter'], ['contrast1', 'Increase Contrast 1'], ['contrast2', 'Increase Contrast 2'], ['contrast3', 'Increase Contrast 3'], ['shadows', 'Lighten Shadows'], ['midbright', 'Midtones Brighter'], ['middark', 'Midtones Darker'], ['matte', 'Matte (faded)']];
const CURVES_PRESETS = {
  linear: { b0: 0, p1: 64, p2: 128, p3: 192, w0: 255 }, medium: { b0: 0, p1: 56, p2: 128, p3: 200, w0: 255 }, strong: { b0: 0, p1: 44, p2: 128, p3: 212, w0: 255 },
  lighter: { b0: 0, p1: 88, p2: 160, p3: 220, w0: 255 }, darker: { b0: 0, p1: 40, p2: 96, p3: 164, w0: 255 }, matte: { b0: 34, p1: 76, p2: 130, p3: 190, w0: 238 },
  highkey: { b0: 18, p1: 100, p2: 172, p3: 226, w0: 255 }, lowkey: { b0: 0, p1: 34, p2: 88, p3: 160, w0: 236 }, sshadow: { b0: 0, p1: 84, p2: 140, p3: 196, w0: 255 }
};
const CURVES_PRESET_OPTS = [['custom', 'Custom'], ['auto', 'Auto (clip 0.1%)'], ['linear', 'Default (linear)'], ['medium', 'Medium Contrast'], ['strong', 'Strong Contrast'], ['lighter', 'Lighter'], ['darker', 'Darker'], ['sshadow', 'Lift Shadows'], ['matte', 'Matte Film'], ['highkey', 'High Key'], ['lowkey', 'Low Key']];
let adjSrc = null, adjGraph = null;   // source canvas of the open Levels/Curves dialog (for Auto and the histogram)
// Luminance (or one channel) histogram of a canvas, sampled on at most ~512×512 pixels; skips transparent pixels
function histogramOf(src, ch = 'rgb') {
  const h = new Uint32Array(256); if (!src) return h;
  const s = Math.min(1, 512 / Math.max(src.width, src.height)), w = Math.max(1, Math.round(src.width * s)), hh = Math.max(1, Math.round(src.height * s));
  const t = mk(w, hh), c = cx(t); c.drawImage(src, 0, 0, w, hh);
  const d = c.getImageData(0, 0, w, hh).data, k = { r: 0, g: 1, b: 2 }[ch];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 8) h[k == null ? Math.round(.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) : d[i + k]]++;
  return h;
}
function autoRange(hist, clip = 0.001) {
  const tot = hist.reduce((a, b) => a + b, 0); if (!tot) return [0, 255];
  let lo = 0, hi = 255, acc = 0;
  for (; lo < 255; lo++) { acc += hist[lo]; if (acc > tot * clip) break; }
  acc = 0; for (; hi > 0; hi--) { acc += hist[hi]; if (acc > tot * clip) break; }
  return hi - lo < 8 ? [0, 255] : [lo, hi];
}
function presetInput(key, v, set, presets, keys) {
  if (key === 'preset') {
    if (v.preset === 'auto') {
      const [lo, hi] = autoRange(histogramOf(adjSrc, v.ch || 'rgb'));
      if (keys[0] === 'lo') { set('lo', lo); set('hi', hi); set('g', 1); set('olo', 0); set('ohi', 255); }
      else setCurveStretch(set, lo, hi);
    } else if (presets[v.preset]) Object.entries(presets[v.preset]).forEach(([k, x]) => set(k, x));
  } else if (keys.includes(key) && v.preset !== 'custom') set('preset', 'custom');
}
// Curves points sit at fixed inputs 0/64/128/192/255: express a lo..hi linear stretch on them
function setCurveStretch(set, lo, hi) {
  const f = x => clamp(Math.round((x - lo) * 255 / Math.max(1, hi - lo)), 0, 255);
  set('b0', clamp(f(0), 0, 128)); set('p1', f(64)); set('p2', f(128)); set('p3', f(192)); set('w0', clamp(f(255), 128, 255));
}
function graphCanvas(box, cls, w, h) {
  const cv = mk(w * 2, h * 2); cv.className = 'adjgraph ' + cls; cv.style.width = w + 'px'; cv.style.height = h + 'px';
  box.insertBefore(cv, box.querySelector('.btns')); return cv;
}
function drawHist(c, hist, x0, W, H, color) {   // bars over [x0, x0 + W], baseline at y = H
  const mx = Math.max(1, Array.from(hist).sort((a, b) => b - a)[2] || 0);   // ignore the 2 tallest spikes when scaling
  c.fillStyle = color;
  for (let i = 0; i < 256; i++) { const v = Math.min(1, hist[i] / mx) * H * 0.92; c.fillRect(x0 + i / 256 * W, H - v, W / 256 + 0.6, v); }
}
function curvesGraph(box, set, v0, src) {
  const W = 512, H = 512, P = 12, cv = graphCanvas(box, 'curves', 256, 256), c = cx(cv), X = [0, 64, 128, 192, 255], K = ['b0', 'p1', 'p2', 'p3', 'w0'];
  const gx = x => P + x / 255 * (W - 2 * P), gy = y => H - P - y / 255 * (H - 2 * P);
  cv.title = 'Drag a point up or down';
  let cur = { ...v0 }, hist = null, histCh = null, drag = -1;
  const pts = () => K.map((k, i) => ({ x: X[i], y: cur[k] }));
  const redraw = v => {
    if (v) cur = { ...v };
    if (histCh !== cur.ch) { hist = histogramOf(src, cur.ch); histCh = cur.ch; }
    c.fillStyle = '#fbfdff'; c.fillRect(0, 0, W, H);
    drawHist(c, hist, P, W - 2 * P, H - P, '#d6dee8');
    c.strokeStyle = '#c3cfdc'; c.lineWidth = 1; c.beginPath(); for (let i = 0; i <= 4; i++) { const t = i * 255 / 4; c.moveTo(gx(t), gy(0)); c.lineTo(gx(t), gy(255)); c.moveTo(gx(0), gy(t)); c.lineTo(gx(255), gy(t)); } c.stroke();
    c.strokeStyle = '#aab7c6'; c.setLineDash([6, 6]); c.beginPath(); c.moveTo(gx(0), gy(0)); c.lineTo(gx(255), gy(255)); c.stroke(); c.setLineDash([]);
    const lut = monoLUT(X, K.map(k => cur[k])), col = { r: '#d0302a', g: '#2c9a3a', b: '#2a62d0' }[cur.ch] || '#1d2f45';
    c.strokeStyle = col; c.lineWidth = 3; c.beginPath(); for (let x = 0; x < 256; x++) x ? c.lineTo(gx(x), gy(lut[x])) : c.moveTo(gx(x), gy(lut[x])); c.stroke();
    pts().forEach((p, i) => { c.beginPath(); c.arc(gx(p.x), gy(p.y), i === drag ? 11 : 9, 0, 7); c.fillStyle = '#fff'; c.fill(); c.lineWidth = 3; c.strokeStyle = col; c.stroke(); });
  };
  const at = e => { const r = cv.getBoundingClientRect(); return { x: ((e.clientX - r.left) / r.width * W - P) / (W - 2 * P) * 255, y: (H - P - (e.clientY - r.top) / r.height * H) / (H - 2 * P) * 255 }; };
  const move = e => {
    if (drag < 0) return;
    const k = K[drag], lim = k === 'b0' ? [0, 128] : k === 'w0' ? [128, 255] : [0, 255], y = clamp(Math.round(at(e).y), lim[0], lim[1]);
    cur[k] = y; set(k, y); if (cur.preset !== 'custom') { cur.preset = 'custom'; set('preset', 'custom'); } redraw();
  };
  cv.onpointerdown = e => {
    const p = at(e); drag = X.reduce((b, x, i) => Math.abs(x - p.x) < Math.abs(X[b] - p.x) ? i : b, 0);
    try { cv.setPointerCapture(e.pointerId); } catch (err) { }
    move(e);
  };
  cv.onpointermove = e => { if (e.buttons & 1) move(e); };
  cv.onpointerup = () => { drag = -1; redraw(); };
  adjGraph = { redraw, cv }; redraw();
}
function levelsGraph(box, set, v0, src) {
  const W = 512, H = 200, P = 12, cv = graphCanvas(box, 'levels', 256, 100), c = cx(cv), hist = histogramOf(src), gx = x => P + x / 255 * (W - 2 * P);
  let cur = { ...v0 };
  const redraw = v => {
    if (v) cur = { ...v };
    c.fillStyle = '#fbfdff'; c.fillRect(0, 0, W, H); drawHist(c, hist, P, W - 2 * P, H - 18, '#7d8fa6');
    const tri = (x, fill) => { const px = gx(x); c.beginPath(); c.moveTo(px, H - 18); c.lineTo(px - 8, H - 2); c.lineTo(px + 8, H - 2); c.closePath(); c.fillStyle = fill; c.fill(); c.strokeStyle = '#333'; c.lineWidth = 1.5; c.stroke(); };
    const mid = cur.lo + (cur.hi - cur.lo) * Math.pow(0.5, cur.g);
    c.fillStyle = 'rgba(40,70,110,.12)'; c.fillRect(P, 0, gx(cur.lo) - P, H - 18); c.fillRect(gx(cur.hi), 0, W - P - gx(cur.hi), H - 18);
    tri(cur.lo, '#000'); tri(mid, '#888'); tri(cur.hi, '#fff');
  };
  adjGraph = { redraw, cv }; redraw();
}
const GM_DEFAULT = JSON.stringify([{ p: 0, c: '#1b1036', a: 1 }, { p: 1, c: '#ffd9a0', a: 1 }]);
const gmFromAB = p => JSON.stringify([{ p: 0, c: HEX6.test(p?.a) ? p.a : '#1b1036', a: 1 }, { p: 1, c: HEX6.test(p?.b) ? p.b : '#ffd9a0', a: 1 }]);
function gmStops(v) {
  let s = null; try { s = typeof v.g === 'string' ? JSON.parse(v.g) : null; } catch (e) { }
  return sanitizeStops(s, JSON.parse(gmFromAB(v)));
}
function gmLUT(stops, rev) {   // 256 × [r, g, b, mix 0..1]
  const lut = new Float32Array(1024);
  for (let i = 0; i < 256; i++) { const t = i / 255, o = sampleStops(stops, rev ? 1 - t : t), c = hexToRgb(o.c); lut.set([c[0], c[1], c[2], o.a], i * 4); }
  return lut;
}
function gradientMapWidget(box, set, v0) {
  const host = document.createElement('div'), btns = box.querySelector('.btns'); box.insertBefore(host, btns);
  const grad = { stops: gmStops(v0) };
  gradientWidget(host, grad, g => set('g', JSON.stringify(g.stops.map(s => ({ p: +s.p.toFixed(4), c: s.c, a: +s.a.toFixed(3) })))));
  box.insertBefore(Object.assign(document.createElement('p'), { className: 'dnote', textContent: 'Left of the bar = shadows, right = highlights. Stop opacity sets how strongly that tone is recolored.' }), btns);
}

const FILTERS = {
  'Brightness/Contrast…': { adj: 1, fields: [{ key: 'b', label: 'Brightness', type: 'range', min: -100, max: 100, value: 0 }, { key: 'c', label: 'Contrast', type: 'range', min: -100, max: 100, value: 0 }], fn: (s, v) => cssFilter(s, `brightness(${1 + v.b / 100}) contrast(${1 + v.c / 100})`) },
  'Levels…': {
    adj: 1, fields: [{ key: 'preset', label: 'Preset', type: 'select', value: 'custom', options: LEVELS_PRESET_OPTS }, { key: 'lo', label: 'Input black', type: 'range', min: 0, max: 254, value: 0 }, { key: 'g', label: 'Gamma', type: 'range', min: 0.1, max: 3, step: 0.01, value: 1 }, { key: 'hi', label: 'Input white', type: 'range', min: 1, max: 255, value: 255 }, { key: 'olo', label: 'Output black', type: 'range', min: 0, max: 255, value: 0 }, { key: 'ohi', label: 'Output white', type: 'range', min: 0, max: 255, value: 255 }],
    onInput: (k, v, set) => presetInput(k, v, set, LEVELS_PRESETS, ['lo', 'g', 'hi', 'olo', 'ohi']), mount: (box, set, v, src) => levelsGraph(box, set, v, src), onDialog: v => adjGraph?.redraw(v),
    fn: (s, v) => { const lut = new Uint8ClampedArray(256), hi = Math.max(v.hi, v.lo + 1); for (let i = 0; i < 256; i++) lut[i] = v.olo + (v.ohi - v.olo) * Math.pow(clamp((i - v.lo) / (hi - v.lo), 0, 1), 1 / v.g); return lutRGB(s, lut, lut, lut); }
  },
  'Curves…': {
    adj: 1, onInput: (k, v, set) => presetInput(k, v, set, CURVES_PRESETS, ['b0', 'p1', 'p2', 'p3', 'w0']), mount: (box, set, v, src) => curvesGraph(box, set, v, src), onDialog: v => adjGraph?.redraw(v),
    fields: [{ key: 'preset', label: 'Preset', type: 'select', value: 'custom', options: CURVES_PRESET_OPTS }, { key: 'ch', label: 'Channel', type: 'select', value: 'rgb', options: [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']] },
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
    // g = JSON stops [{p,c,a}] (stop opacity = how strongly that tone is remapped); old files only have colors a -> b
    adj: 1, fields: [{ key: 'g', type: 'hidden', value: GM_DEFAULT }, { key: 'rev', label: 'Reverse', type: 'checkbox', value: false }, { key: 'dither', label: 'Dither (smoother)', type: 'checkbox', value: false }],
    fieldsFor: p => [{ key: 'g', type: 'hidden', value: typeof p?.g === 'string' ? p.g : gmFromAB(p) }, { key: 'rev', label: 'Reverse', type: 'checkbox', value: !!p?.rev }, { key: 'dither', label: 'Dither (smoother)', type: 'checkbox', value: !!p?.dither }],
    mount: (box, set, v) => gradientMapWidget(box, set, v),
    fn: (s, v) => {
      const lut = gmLUT(gmStops(v), !!v.rev);
      return pixels(s, d => {
        for (let i = 0, n = 0; i < d.length; i += 4, n++) {
          let t = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2];
          if (v.dither) t += ((n * 0.618034 + (n / s.width | 0) * 0.381966) % 1) - 0.5;
          const j = clamp(Math.round(t), 0, 255) * 4, a = lut[j + 3];
          for (let k = 0; k < 3; k++) d[i + k] += (lut[j + k] - d[i + k]) * a;
        }
      });
    }
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
  if (!F.fields && !F.fieldsFor) { putResult(t, orig, F.fn(orig, {})); pushHistory(plainName(name)); recordStep({ type: 'filter', name, params: {} }); return; }
  const fields = fieldsOf(F, null, orig), init = defaultsOf({ fields });
  adjSrc = orig; adjGraph = null;
  showDialog({
    title: plainName(name), fields, html: noteHtml(F), onInput: F.onInput, onMount: F.mount ? (box, set) => F.mount(box, set, init, orig) : null,
    onChange: v => { F.onDialog?.(v, false, init); putResult(t, orig, F.fn(orig, v)); requestRender(); },
    onOK: v => { F.onDialog?.(v, true, init); putResult(t, orig, F.fn(orig, v)); pushHistory(plainName(name)); recordStep({ type: 'filter', name, params: v }); },
    onCancel: () => { putResult(t, orig, orig); requestRender(); }
  });
}
// What an adjustment layer receives: the composite of everything below it (used for histograms / Auto)
function inputBelow(L) {
  const i = doc.layers.indexOf(L), t = mk(doc.w, doc.h);
  renderNodes(t, buildTree(doc.layers.slice(0, Math.max(0, i))), false); return t;
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
  if (!F.fields && !F.fieldsFor) { pushHistory('New ' + plainName(kind)); recordStep({ type: 'adjLayer', kind, params: {} }); return; }
  editAdjustment(L, true);
}
function editAdjustment(L, isNew) {
  const F = FILTERS[L.adjust.kind], old = { ...L.adjust.params };
  if (!F.fields && !F.fieldsFor) return toast('This adjustment has no settings');
  const fields = fieldsOf(F, L.adjust.params), below = F.mount ? inputBelow(L) : null;
  adjSrc = below; adjGraph = null;
  showDialog({
    title: plainName(L.adjust.kind) + ' (adjustment layer)', fields, html: noteHtml(F), onInput: F.onInput, onMount: F.mount ? (box, set) => F.mount(box, set, defaultsOf({ fields }), below) : null,
    onChange: v => { F.onDialog?.(v, false, old); L.adjust.params = { ...v }; requestRender(); },
    onOK: v => { F.onDialog?.(v, true, old); L.adjust.params = { ...v }; pushHistory(isNew ? 'New ' + plainName(L.adjust.kind) : 'Edit Adjustment'); if (isNew) recordStep({ type: 'adjLayer', kind: L.adjust.kind, params: v }); },

    onCancel: () => {
      if (isNew) { const i = doc.layers.indexOf(L); doc.layers.splice(i, 1); doc.active = clamp(i - 1, 0, doc.layers.length - 1); updatePanels(); }
      else L.adjust.params = old;
      requestRender();
    }
  });
}
