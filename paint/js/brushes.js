'use strict';
/* Brush tips (procedural alpha maps), paper grain textures and the default brush library. */
const TIPN = 128;
const tipMaps = {};
function tipMap(name) {
  if (name === 'round') return null;
  if (tipMaps[name]) return tipMaps[name];
  const N = TIPN, m = new Float32Array(N * N), rnd = mulberry32(name.length * 977 + name.charCodeAt(0));
  const nz = makeValueNoise(name.charCodeAt(1) * 31 + 5, 64);
  const at = (fn) => { for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1; m[y * N + x] = clamp(fn(u, v, x, y), 0, 1); } };
  if (name === 'chalk') at((u, v, x, y) => {
    const r = Math.hypot(u, v) + (fbm(nz, x / 9, y / 9, 3) - 0.5) * 0.45; const edge = smooth((0.92 - r) / 0.18);
    const speck = fbm(nz, x / 2.2 + 40, y / 2.2, 2); return edge * smooth((speck - 0.28) / 0.35);
  });
  else if (name === 'charcoal') at((u, v, x, y) => {
    const env = smooth((0.95 - Math.abs(u)) / 0.25) * smooth((0.95 - Math.abs(v)) / 0.4) * smooth((1.05 - Math.hypot(u * 0.9, v)) / 0.3);
    const streak = fbm(nz, x / 18, y / 1.6, 3), speck = fbm(nz, x / 2 + 99, y / 2, 2);
    return env * smooth((streak * 0.6 + speck * 0.6 - 0.42) / 0.3);
  });
  else if (name === 'crayon') at((u, v, x, y) => {
    const r = Math.hypot(u, v) + (nz(x / 7, y / 7) - 0.5) * 0.25; const edge = smooth((0.9 - r) / 0.12);
    const wax = fbm(nz, x / 1.7, y / 3.5, 3); return edge * smooth((wax - 0.3) / 0.3);
  });
  else if (name === 'pencil') at((u, v, x, y) => { const r = Math.hypot(u, v); return smooth((1 - r) / 0.35) * (0.75 + 0.25 * nz(x / 2, y / 2)); });
  else if (name === 'bristle' || name === 'flat') {
    // streak profile across the brush (v axis); stamping along u produces bristle streaks
    const prof = new Float32Array(N); const count = name === 'flat' ? 46 : 34;
    for (let i = 0; i < count; i++) { const c = rnd() * N, w = 0.8 + rnd() * 2.2, a = 0.45 + rnd() * 0.55; for (let y = 0; y < N; y++) { const d = (y - c) / w; prof[y] = Math.max(prof[y], a * Math.exp(-d * d)); } }
    for (let y = 0; y < N; y++) prof[y] = 0.35 + 0.65 * prof[y];
    at((u, v, x, y) => {
      const env = name === 'flat' ? smooth((0.42 - Math.abs(u)) / 0.18) * smooth((0.97 - Math.abs(v)) / 0.12) : smooth((1 - Math.hypot(u * 1.1, v)) / 0.3);
      return env * prof[y] * (0.85 + 0.15 * nz(x / 3, y / 8));
    });
  }
  else if (name === 'knife') at((u, v, x, y) => smooth((0.3 - Math.abs(u)) / 0.06) * smooth((0.96 - Math.abs(v) - (nz(x / 3, y / 3) - 0.5) * 0.06) / 0.05));
  else if (name === 'sponge') at((u, v, x, y) => { const r = Math.hypot(u, v); return smooth((0.95 - r) / 0.3) * smooth((fbm(nz, x / 5, y / 5, 3) - 0.4) / 0.2); });
  else at((u, v) => 1 - Math.hypot(u, v));
  return tipMaps[name] = m;
}

/* ---------- paper grain (512×512 tileable, equalized to uniform 0..1) ---------- */
const GRAINN = 512;
const PAPERS = [['cold', 'Cold-press watercolor'], ['rough', 'Rough watercolor'], ['hot', 'Hot-press (smooth)'], ['sketch', 'Sketch paper'], ['canvas', 'Canvas weave'], ['none', 'None (no grain)']];
const grainMaps = {};
function grainMap(type, tooth = false) {
  if (tooth && type !== 'none' && type !== 'canvas') { // fine paper tooth for dry media (pencil, chalk, charcoal…)
    const k = type + ':tooth'; if (grainMaps[k]) return grainMaps[k];
    const N = GRAINN, g = new Float32Array(N * N), S = (seed, q, qy = q) => { const n = makeValueNoise(seed, N / q, N / qy); return (x, y) => n(x / q, y / qy); };
    const a4 = S(71, 4), a2 = S(73, 2), a1 = S(79, 1), f1 = S(83, 1, 8), f2 = S(89, 8, 1);
    const wt = { cold: [0.16, 0.48, 0.36, 0], rough: [0.3, 0.42, 0.28, 0], hot: [0.06, 0.4, 0.54, 0], sketch: [0.08, 0.38, 0.34, 0.2] }[type] || [0.15, 0.45, 0.4, 0];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) g[y * N + x] = a4(x, y) * wt[0] + a2(x, y) * wt[1] + a1(x, y) * wt[2] + (wt[3] ? (f1(x, y) + f2(x, y)) * 0.5 * wt[3] : 0);
    return grainMaps[k] = equalize(g);
  }
  if (type === 'none') return null;
  if (grainMaps[type]) return grainMaps[type];
  const N = GRAINN, g = new Float32Array(N * N);
  // tileable terms: lattice period = 512/k so the map wraps seamlessly every 512 px
  const S = (seed, k, ky = k) => { const n = makeValueNoise(seed, N / k, N / ky); return (x, y) => n(x / k, y / ky); };
  const n8 = S(11, 8), n4 = S(23, 4), n2 = S(37, 2), n16 = S(41, 16), n1 = S(53, 1), sA = S(61, 2, 16), sB = S(67, 16, 2);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v;
    if (type === 'cold') v = n8(x, y) * 0.22 + n4(x, y) * 0.33 + n2(x, y) * 0.3 + n1(x, y) * 0.15;
    else if (type === 'rough') v = n16(x, y) * 0.32 + n8(x, y) * 0.28 + n4(x, y) * 0.22 + n2(x, y) * 0.18;
    else if (type === 'hot') v = n4(x, y) * 0.2 + n2(x, y) * 0.5 + n1(x, y) * 0.3;
    else if (type === 'sketch') v = sA(x, y) * 0.35 + sB(x, y) * 0.35 + n1(x, y) * 0.3;
    else { // canvas weave (period 8)
      const wx = Math.sin(x / 8 * Math.PI * 2) * 0.5 + 0.5, wy = Math.sin(y / 8 * Math.PI * 2) * 0.5 + 0.5, chk = ((x >> 2) + (y >> 2)) & 1;
      v = (chk ? wx * 0.7 + wy * 0.3 : wy * 0.7 + wx * 0.3) * 0.75 + n3(x, y) * 0.25;
    }
    g[y * N + x] = v;
  }
  return grainMaps[type] = equalize(g);
}

/* ---------- brush library ---------- */
const BRUSH_DEF = {
  mode: 'paint', blend: 'normal', size: 20, minSize: 0.15, opacity: 1, flow: 1, hardness: 0.8, spacing: 0.08, tip: 'round', roundness: 1, angle: 0, rotMode: 'fixed',
  pSize: 0.6, pOpacity: 0, pFlow: 0, tiltSize: 0, tiltOpacity: 0, velSize: 0,
  jSize: 0, jAngle: 0, scatter: 0, jOpacity: 0, jHue: 0, jSat: 0, jVal: 0, colorPerStroke: false,
  grain: 0, grainScale: 1, grainPressure: 0.5,
  smoothing: 0.25, stabMode: 'smooth',
  strength: 0.6,                                   // smudge
  mix: 0.3, load: 1, dry: 0.0012, smear: 0.5, impasto: 0.12, // oil
  water: 0.8, pigment: 0.5, bleed: 0.5, edge: 0.6, gran: 0.4, dryTime: 1.6 // watercolor
};
const BRUSH_CATS = ['Sketching', 'Inking', 'Painting', 'Watercolor', 'Oils & Acrylic', 'Blend', 'Erase', 'Custom'];
const BRUSHES = [
  { id: 'pencil-hb', name: 'Pencil HB', cat: 'Sketching', size: 4, hardness: 0.6, opacity: 0.8, flow: 0.65, spacing: 0.1, pSize: 0.3, pOpacity: 0.8, grain: 0.85, grainPressure: 0.7, tiltSize: 2.5, tiltOpacity: 0.5, smoothing: 0.12, tip: 'pencil' },
  { id: 'pencil-6b', name: 'Pencil 6B', cat: 'Sketching', size: 9, hardness: 0.45, opacity: 0.95, flow: 0.75, spacing: 0.08, pSize: 0.35, pOpacity: 0.7, grain: 0.9, grainPressure: 0.6, grainScale: 1.3, tiltSize: 3, tiltOpacity: 0.4, smoothing: 0.12, tip: 'pencil' },
  { id: 'charcoal', name: 'Charcoal', cat: 'Sketching', size: 30, tip: 'charcoal', rotMode: 'direction', opacity: 0.95, flow: 0.55, spacing: 0.08, pSize: 0.35, pFlow: 0.6, grain: 0.85, grainScale: 1.6, jAngle: 0.08, smoothing: 0.1 },
  { id: 'chalk', name: 'Chalk', cat: 'Sketching', size: 32, tip: 'chalk', opacity: 0.95, flow: 0.8, spacing: 0.1, pSize: 0.3, pFlow: 0.4, grain: 0.75, grainScale: 2, jAngle: 1, smoothing: 0.1 },
  { id: 'crayon', name: 'Wax Crayon', cat: 'Sketching', size: 16, tip: 'crayon', opacity: 1, flow: 0.9, spacing: 0.06, pSize: 0.25, grain: 0.95, grainScale: 1.2, grainPressure: 0.6, jAngle: 0.5, smoothing: 0.12 },
  { id: 'ink-pen', name: 'Ink Pen', cat: 'Inking', size: 8, hardness: 0.92, pSize: 1, minSize: 0.04, velSize: 0.35, smoothing: 0.5, spacing: 0.05 },
  { id: 'tech-pen', name: 'Technical Pen', cat: 'Inking', size: 4, hardness: 0.92, pSize: 0, smoothing: 0.6, spacing: 0.05 },
  { id: 'brush-pen', name: 'Brush Pen', cat: 'Inking', size: 18, roundness: 0.55, rotMode: 'direction', hardness: 0.88, pSize: 1, minSize: 0.02, velSize: 0.2, smoothing: 0.45, spacing: 0.04 },
  { id: 'marker', name: 'Marker', cat: 'Inking', size: 26, roundness: 0.32, angle: 45, hardness: 0.85, opacity: 0.55, blend: 'multiply', pSize: 0.12, spacing: 0.04, smoothing: 0.3 },
  { id: 'hard-round', name: 'Hard Round', cat: 'Painting', size: 26, hardness: 0.95, pSize: 0.6, pOpacity: 0.3, spacing: 0.06 },
  { id: 'soft-round', name: 'Soft Round', cat: 'Painting', size: 70, hardness: 0, flow: 0.22, pFlow: 0.8, pSize: 0.3, spacing: 0.05 },
  { id: 'airbrush', name: 'Airbrush', cat: 'Painting', size: 140, hardness: 0, flow: 0.05, pFlow: 1, pSize: 0.15, spacing: 0.04, smoothing: 0.35 },
  { id: 'gouache', name: 'Gouache', cat: 'Painting', size: 34, tip: 'sponge', hardness: 0.6, opacity: 0.95, flow: 0.7, pFlow: 0.5, pSize: 0.5, rotMode: 'direction', jAngle: 0.2, grain: 0.35, grainScale: 1.5, spacing: 0.05 },
  { id: 'wc-wash', name: 'Watercolor Wash', cat: 'Watercolor', mode: 'water', size: 170, hardness: 0.3, water: 1, pigment: 0.32, bleed: 0.7, edge: 0.55, gran: 0.45, spacing: 0.07, pSize: 0.35, dryTime: 2 },
  { id: 'wc-round', name: 'Watercolor Round', cat: 'Watercolor', mode: 'water', size: 40, hardness: 0.5, water: 0.7, pigment: 0.6, bleed: 0.4, edge: 0.75, gran: 0.35, spacing: 0.06, pSize: 0.7, smoothing: 0.3, dryTime: 1.4 },
  { id: 'wc-bloom', name: 'Wet Bloom', cat: 'Watercolor', mode: 'water', size: 90, hardness: 0.2, water: 1.4, pigment: 0.4, bleed: 1, edge: 0.85, gran: 0.25, spacing: 0.08, pSize: 0.4, dryTime: 2.6 },
  { id: 'wc-dry', name: 'Dry Brush Watercolor', cat: 'Watercolor', mode: 'water', size: 50, tip: 'bristle', rotMode: 'direction', water: 0.3, pigment: 0.7, bleed: 0.1, edge: 0.4, gran: 0.85, grain: 0.6, grainScale: 1.4, spacing: 0.05, dryTime: 0.8 },
  { id: 'oil-round', name: 'Oil Round Bristle', cat: 'Oils & Acrylic', mode: 'oil', size: 38, tip: 'bristle', rotMode: 'direction', mix: 0.28, smear: 0.38, dry: 0.0007, impasto: 0.14, spacing: 0.035, pSize: 0.5, smoothing: 0.2 },
  { id: 'oil-flat', name: 'Oil Flat', cat: 'Oils & Acrylic', mode: 'oil', size: 46, tip: 'flat', rotMode: 'direction', mix: 0.25, smear: 0.34, dry: 0.0006, impasto: 0.16, spacing: 0.03, pSize: 0.35, smoothing: 0.2 },
  { id: 'knife', name: 'Palette Knife', cat: 'Oils & Acrylic', mode: 'oil', size: 54, tip: 'knife', rotMode: 'direction', mix: 0.55, smear: 0.85, load: 0.8, dry: 0.0018, impasto: 0.1, spacing: 0.025, pSize: 0.2, smoothing: 0.25 },
  { id: 'acrylic', name: 'Acrylic', cat: 'Oils & Acrylic', mode: 'oil', size: 32, tip: 'bristle', rotMode: 'direction', mix: 0.12, smear: 0.25, dry: 0.0012, impasto: 0.08, spacing: 0.035, pSize: 0.45 },
  { id: 'blender', name: 'Blender', cat: 'Blend', mode: 'smudge', size: 50, hardness: 0.25, strength: 0.6, spacing: 0.05, pSize: 0.3 },
  { id: 'smudge', name: 'Smudge', cat: 'Blend', mode: 'smudge', size: 36, tip: 'chalk', strength: 0.85, spacing: 0.05, pSize: 0.3, grain: 0.3 },
  { id: 'eraser-hard', name: 'Hard Eraser', cat: 'Erase', mode: 'erase', size: 30, hardness: 0.95, pSize: 0.4 },
  { id: 'eraser-soft', name: 'Soft Eraser', cat: 'Erase', mode: 'erase', size: 110, hardness: 0, flow: 0.3, pFlow: 0.8, pSize: 0.2, spacing: 0.05 },
  { id: 'eraser-chalk', name: 'Chalk Eraser', cat: 'Erase', mode: 'erase', size: 40, tip: 'chalk', grain: 0.6, grainScale: 2, jAngle: 1, pSize: 0.3 }
];
const brushById = id => BRUSHES.find(b => b.id === id);
const fullBrush = b => ({ ...BRUSH_DEF, ...b });
function loadCustomBrushes() {
  try {
    const arr = JSON.parse(localStorage.getItem('lumenpaint.brushes') || '[]');
    for (const b of arr) if (b && b.id && !brushById(b.id)) BRUSHES.push(sanitizeBrush({ ...b, cat: 'Custom', custom: true }));
  } catch (e) { }
}
function saveCustomBrushes() { try { localStorage.setItem('lumenpaint.brushes', JSON.stringify(BRUSHES.filter(b => b.custom))); } catch (e) { } }
// untrusted brush JSON → only known keys with sane types/ranges
function sanitizeBrush(b) {
  const out = { id: String(b.id || uid()).slice(0, 40), name: String(b.name || 'Custom brush').slice(0, 60), cat: 'Custom', custom: true };
  for (const [k, def] of Object.entries(BRUSH_DEF)) {
    if (!(k in b)) continue; const v = b[k];
    if (typeof def === 'number' && Number.isFinite(+v)) out[k] = clamp(+v, -1000, 5000);
    else if (typeof def === 'boolean') out[k] = !!v;
    else if (typeof def === 'string' && typeof v === 'string') out[k] = v.slice(0, 20);
  }
  if (!['paint', 'erase', 'smudge', 'oil', 'water'].includes(out.mode)) delete out.mode;
  if (!['round', 'chalk', 'charcoal', 'crayon', 'pencil', 'bristle', 'flat', 'knife', 'sponge'].includes(out.tip)) delete out.tip;
  return out;
}
