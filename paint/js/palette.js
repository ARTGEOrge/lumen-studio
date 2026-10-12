'use strict';
/* Color harmonies on the color wheel (complementary, analogous, triadic, split-complementary, tetradic,
   square) and palette extraction (k-means in CIE Lab) from the reference image or the canvas. */
const HARMONIES = { none: [], complementary: [180], analogous: [-30, 30], triadic: [120, 240], split: [150, 210], tetradic: [60, 180, 240], square: [90, 180, 270] };
const HARMONY_NAMES = [['none', 'Harmony: off'], ['complementary', 'Complementary'], ['analogous', 'Analogous'], ['triadic', 'Triadic'], ['split', 'Split complementary'], ['tetradic', 'Tetradic (rectangle)'], ['square', 'Square']];
let harmony = 'none';
function harmonyColors() { const [h, s, v] = fgHSV; return [0, ...HARMONIES[harmony]].map(o => hsv2rgb(h + o, s, v)); }
// drawn on top of the wheel by drawWheel()
function drawHarmonyMarks(c, cx, cy, rm) {
  if (harmony === 'none') return;
  const offs = HARMONIES[harmony], h = fgHSV[0];
  c.save(); c.setLineDash([3, 3]); c.lineWidth = 1; c.strokeStyle = 'rgba(0,0,0,.45)';
  const pts = [h, ...offs.map(o => h + o)].map(a => { const r = (a - 90) * Math.PI / 180; return [cx + Math.cos(r) * rm, cy + Math.sin(r) * rm]; });
  c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); if (pts.length > 2) c.closePath(); c.stroke(); c.restore();
  for (const p of pts.slice(1)) { c.lineWidth = 2; c.strokeStyle = '#fff'; c.beginPath(); c.arc(p[0], p[1], 4, 0, 7); c.stroke(); c.lineWidth = 1; c.strokeStyle = '#000'; c.beginPath(); c.arc(p[0], p[1], 5.5, 0, 7); c.stroke(); }
}
function initHarmony() {
  const row = el('div', 'cp-harm', '<select id="cp-harm" title="Color harmony shown on the wheel"></select><div class="cp-harmsw" id="cp-harmsw"></div>');
  $('#colorpane').insertBefore(row, $('#cp-sliders'));
  const s = $('#cp-harm'); HARMONY_NAMES.forEach(([v, t]) => s.add(new Option(t, v)));
  try { const h = localStorage.getItem('lumenpaint.harmony'); if (HARMONIES[h]) harmony = h; } catch (e) { }
  s.value = harmony;
  s.onchange = () => { harmony = s.value; try { localStorage.setItem('lumenpaint.harmony', harmony); } catch (e) { } s.blur(); updateColorUI(); };
  colorListeners.push(renderHarmony); renderHarmony(); updateColorUI();
}
function renderHarmony() {
  const g = $('#cp-harmsw'); if (!g) return; g.innerHTML = '';
  if (harmony === 'none') return;
  harmonyColors().forEach((c, i) => { const d = swatchEl(rgbHex(c)); if (!i) d.classList.add('base'); d.title = (i ? 'Harmony color ' : 'Base color ') + rgbHex(c) + ' — click to use'; g.appendChild(d); });
}

/* ---------- palette extraction ---------- */
function srgbToLab(r, g, b) {
  const f = v => v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  const R = f(r), G = f(g), B = f(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const k = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116; x = k(x); y = k(y); z = k(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
// RGBA pixels → up to k dominant colours ([r,g,b] 0..1), most common first
function extractPalette(rgba, k = 8, seed = 7) {
  const n = rgba.length >> 2, step = Math.max(1, Math.floor(n / 24000)), pts = [], cols = [];
  for (let i = 0; i < n; i += step) { const j = i * 4; if (rgba[j + 3] < 128) continue; const c = [rgba[j] / 255, rgba[j + 1] / 255, rgba[j + 2] / 255]; cols.push(c); pts.push(srgbToLab(c[0], c[1], c[2])); }
  if (!pts.length) return [];
  k = Math.min(k, pts.length);
  const rnd = mulberry32(seed), d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  // k-means++ seeding
  const C = [pts[(rnd() * pts.length) | 0].slice()], dist = new Float64Array(pts.length).fill(Infinity);
  while (C.length < k) {
    let sum = 0; for (let i = 0; i < pts.length; i++) { dist[i] = Math.min(dist[i], d2(pts[i], C[C.length - 1])); sum += dist[i]; }
    if (!sum) break; let r = rnd() * sum, i = 0; for (; i < pts.length - 1; i++) { r -= dist[i]; if (r <= 0) break; } C.push(pts[i].slice());
  }
  const asg = new Int32Array(pts.length);
  for (let it = 0; it < 14; it++) {
    const acc = C.map(() => [0, 0, 0, 0]); let moved = 0;
    for (let i = 0; i < pts.length; i++) { let b = 0, bd = Infinity; for (let c = 0; c < C.length; c++) { const d = d2(pts[i], C[c]); if (d < bd) { bd = d; b = c; } } if (asg[i] !== b) moved++; asg[i] = b; const a = acc[b]; a[0] += pts[i][0]; a[1] += pts[i][1]; a[2] += pts[i][2]; a[3]++; }
    C.forEach((c, i) => { const a = acc[i]; if (a[3]) { c[0] = a[0] / a[3]; c[1] = a[1] / a[3]; c[2] = a[2] / a[3]; } });
    if (!moved) break;
  }
  // representative colour per cluster: mean sRGB of its members
  const out = C.map(() => [0, 0, 0, 0]);
  for (let i = 0; i < pts.length; i++) { const o = out[asg[i]]; o[0] += cols[i][0]; o[1] += cols[i][1]; o[2] += cols[i][2]; o[3]++; }
  const res = out.map((o, i) => ({ c: o[3] ? [o[0] / o[3], o[1] / o[3], o[2] / o[3]] : null, n: o[3], lab: C[i] })).filter(x => x.c).sort((a, b) => b.n - a.n);
  const keep = []; for (const r of res) if (!keep.some(q => d2(q.lab, r.lab) < 36)) keep.push(r); // merge near-duplicates (ΔE < 6)
  return keep.map(r => r.c);
}
function setPaletteSet(name, cols) {
  SWATCH_SETS[name] = cols.map(rgbHex);
  const s = $('#cp-set'); if (![...s.options].some(o => o.value === name)) s.add(new Option(name, name), s.options[s.options.length - 1]);
  swatchSet = name; s.value = name; renderSwatches();
  try { localStorage.setItem('lumenpaint.pal.' + name, JSON.stringify(SWATCH_SETS[name])); } catch (e) { }
}
function restorePaletteSets() {
  for (const name of ['Reference palette', 'Canvas palette']) { try { const a = JSON.parse(localStorage.getItem('lumenpaint.pal.' + name) || 'null'); if (Array.isArray(a) && a.length) { const v = a.filter(x => hexRgb(x)).slice(0, 32); if (v.length) { SWATCH_SETS[name] = v; const s = $('#cp-set'); if (![...s.options].some(o => o.value === name)) s.add(new Option(name, name), s.options[s.options.length - 1]); } } } catch (e) { } }
}
function showRefPalette(cols) {
  let p = $('#rp-pal'); if (!p) { p = el('div', 'rp-pal'); p.id = 'rp-pal'; $('#refpanel .rp-foot').before(p); }
  p.innerHTML = ''; cols.forEach(c => p.appendChild(swatchEl(rgbHex(c))));
}
function cmdRefPalette(k = 8) {
  if (!refImg) { Aero.toast('Place a reference image first (File › Place Reference Image…)'); return; }
  const s = Math.min(1, 320 / Math.max(refImg.width, refImg.height)), w = Math.max(1, Math.round(refImg.width * s)), h = Math.max(1, Math.round(refImg.height * s));
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(refImg, 0, 0, w, h);
  const cols = extractPalette(x.getImageData(0, 0, w, h).data, k);
  if (!cols.length) { Aero.toast('No colors found'); return; }
  showRefPalette(cols); setPaletteSet('Reference palette', cols);
  Aero.toast(`Extracted ${cols.length} colors → swatch set “Reference palette”`);
  return cols;
}
function cmdCanvasPalette() {
  dryAllWet(); if (doc.ver !== composedVer) { R.compose(); composedVer = doc.ver; }
  const s = Math.min(1, 320 / Math.max(doc.w, doc.h)), w = Math.max(1, Math.round(doc.w * s)), h = Math.max(1, Math.round(doc.h * s));
  const cols = extractPalette(R.readScaled(w, h, true), 10);
  setPaletteSet('Canvas palette', cols); Aero.toast(`Extracted ${cols.length} colors → swatch set “Canvas palette”`);
  return cols;
}
