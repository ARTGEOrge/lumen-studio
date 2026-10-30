// Draws the Lumen app icons (256px PNG): glossy rounded tile in the app's color + white glyph.
const fs = require('fs'), zlib = require('zlib'), path = require('path');
const S = 256, SS = 4;
const lerp = (a, b, t) => a + (b - a) * t, mix = (c1, c2, t) => c1.map((v, i) => lerp(v, c2[i], t));
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
// shape tests (x,y in 0..256)
const inRound = (x, y, x0, y0, x1, y1, r) => { if (x < x0 || x > x1 || y < y0 || y > y1) return false; const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r); return Math.hypot(x - cx, y - cy) <= r; };
const circle = (cx, cy, r) => (x, y) => Math.hypot(x - cx, y - cy) <= r;
const ring = (cx, cy, r0, r1) => (x, y) => { const d = Math.hypot(x - cx, y - cy); return d >= r0 && d <= r1; };
const rect = (x0, y0, x1, y1, r = 0) => (x, y) => r ? inRound(x, y, x0, y0, x1, y1, r) : x >= x0 && x <= x1 && y >= y0 && y <= y1;
const poly = pts => (x, y) => { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; };
const seg = (ax, ay, bx, by, w) => (x, y) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= w / 2; };
const polyline = (pts, w) => (x, y) => pts.some((p, i) => i && seg(pts[i - 1][0], pts[i - 1][1], p[0], p[1], w)(x, y));
const not = f => (x, y) => !f(x, y), and = (...fs) => (x, y) => fs.every(f => f(x, y)), or = (...fs) => (x, y) => fs.some(f => f(x, y));
const ICONS = {
  vector: { c: ['#ffb347', '#e0560f'], g: or(poly([[128, 46], [178, 128], [150, 196], [106, 196], [78, 128]]), seg(100, 212, 156, 212, 10)), cut: or(circle(128, 132, 9), seg(128, 46, 128, 126, 6)) },
  cut: { c: ['#c58bff', '#5b1fb0'], g: or(rect(54, 70, 202, 186, 14)), cut: or(poly([[110, 98], [110, 158], [162, 128]]), rect(54, 70, 202, 80), ...[70, 98, 126, 154, 182].map(x => rect(x - 6, 64, x + 6, 86))) },
  darkroom: { c: ['#5fd4c4', '#0b5e63'], g: ring(128, 128, 50, 74), extra: and(circle(128, 128, 50), not(poly([...Array(6)].map((_, i) => [128 + 30 * Math.cos(i * Math.PI / 3 + 0.3), 128 + 30 * Math.sin(i * Math.PI / 3 + 0.3)])))) },
  layout: { c: ['#ff8ac8', '#b0175f'], g: rect(66, 48, 190, 208, 10), cut: or(rect(82, 66, 174, 96, 4), rect(82, 108, 124, 190, 4), rect(134, 108, 174, 120, 3), rect(134, 130, 174, 142, 3), rect(134, 152, 174, 164, 3), rect(134, 174, 162, 186, 3)) },
  sound: { c: ['#8cf08a', '#1f8a2a'], g: or(...[[66, 30], [86, 62], [106, 92], [128, 120], [150, 84], [170, 52], [190, 30]].map(([x, h]) => rect(x - 7, 128 - h / 2 - 8, x + 7, 128 + h / 2 + 8, 7))) },
  motion: { c: ['#9fa8ff', '#3a2cb8'], g: or(polyline([...Array(41)].map((_, i) => [54 + i * 3.7, 170 - 100 * (1 - Math.pow(1 - i / 40, 3))]), 12), poly([[60, 170], [74, 156], [88, 170], [74, 184]]), poly([[190, 70], [204, 56], [218, 70], [204, 84]])) },
  paint: { c: ['#ffb0d0', '#d6337a'], g: or(poly([[176, 48], [208, 80], [130, 158], [98, 126]]), and(circle(92, 170, 40), not(circle(70, 148, 22))), seg(60, 205, 116, 200, 14)) },
  proto: { c: ['#8fd0ff', '#1c5fb4'], g: rect(84, 44, 172, 212, 16), cut: or(rect(96, 64, 160, 176, 4), circle(128, 194, 7)), extra2: or(poly([[176, 120], [214, 120], [214, 106], [236, 132], [214, 158], [214, 144], [176, 144]])) },
  pdf: { c: ['#ff8a7a', '#b3150a'], g: poly([[70, 40], [158, 40], [194, 76], [194, 216], [70, 216]]), cut: or(poly([[158, 40], [158, 76], [194, 76]]), rect(90, 104, 174, 116, 4), rect(90, 130, 174, 142, 4), rect(90, 156, 150, 168, 4)) },
  convert: { c: ['#ffd36b', '#d9821a'], g: or(rect(56, 84, 172, 106, 10), poly([[160, 62], [204, 95], [160, 128]]), rect(84, 150, 200, 172, 10), poly([[96, 128], [52, 161], [96, 194]])) },
  studio: { c: ['#7fd0ff', '#1d4f9a'], g: or(rect(58, 58, 122, 122, 14), rect(134, 58, 198, 122, 14), rect(58, 134, 122, 198, 14)), extra: rect(134, 134, 198, 198, 14) },
  plan: { c: ['#a9c6ec', '#24497e'], g: or(rect(52, 62, 132, 86, 8), rect(92, 104, 176, 128, 8), rect(120, 146, 186, 170, 8), poly([[204, 180], [222, 198], [204, 216], [186, 198]]), polyline([[132, 74], [146, 74], [146, 100]], 6), polyline([[176, 116], [190, 116], [190, 142]], 6)) },
  pcb: { c: ['#7be0a0', '#11643a'], g: or(rect(78, 78, 178, 178, 12), ...[96, 128, 160].flatMap(v => [rect(v - 7, 46, v + 7, 78), rect(v - 7, 178, v + 7, 210), rect(46, v - 7, 78, v + 7), rect(178, v - 7, 210, v + 7)])), cut: circle(104, 104, 9) },
  cad: { c: ['#ffcf8a', '#c4561c'], g: or(poly([[128, 40], [208, 84], [128, 128], [48, 84]]), poly([[48, 96], [122, 138], [122, 222], [48, 180]])), extra: poly([[134, 138], [208, 96], [208, 180], [134, 222]]) },
  flow: { c: ['#8be9ff', '#0b5c8c'], g: or(polyline([[36, 92], [80, 92], [108, 74], [148, 74], [176, 92], [220, 92]], 10), polyline([[36, 164], [80, 164], [108, 182], [148, 182], [176, 164], [220, 164]], 10), polyline([[36, 128], [86, 128]], 10), polyline([[170, 128], [220, 128]], 10)), extra: circle(128, 128, 30) },
  lab: { c: ['#ff9a5c', '#a3221b'], g: or(polyline([[62, 50], [62, 198], [208, 198]], 11), polyline([...Array(49)].map((_, i) => { const t = i / 48; return [78 + t * 124, 128 - 58 * Math.exp(-1.1 * t) * Math.sin(2 * Math.PI * 1.75 * t)]; }), 11)) },
  sheets: { c: ['#8ee39a', '#13703a'], g: rect(52, 56, 204, 200, 12), cut: or(rect(52, 94, 204, 100), rect(52, 130, 204, 136), rect(52, 166, 204, 172), rect(100, 56, 106, 200), rect(152, 56, 158, 200)), extra: rect(106, 100, 152, 130) },
  slides: { c: ['#ffc07a', '#c8501a'], g: or(rect(44, 56, 212, 168, 10), seg(128, 168, 128, 204, 12), seg(92, 208, 164, 208, 12)), cut: rect(58, 70, 198, 154, 4), extra: poly([[112, 86], [112, 138], [154, 112]]) },
  write: { c: ['#8ab8ff', '#1f4fb8'], g: poly([[70, 40], [158, 40], [194, 76], [194, 216], [70, 216]]), cut: or(poly([[158, 40], [158, 76], [194, 76]]), rect(90, 98, 174, 108, 4), rect(90, 122, 174, 132, 4), rect(90, 146, 174, 156, 4), rect(90, 170, 140, 180, 4)) },
  diagram: { c: ['#b9a2ff', '#4d2ca8'], g: or(rect(36, 50, 108, 102, 10), rect(148, 50, 220, 102, 10), rect(92, 160, 164, 212, 10), polyline([[72, 102], [72, 132], [128, 132], [128, 160]], 8), polyline([[184, 102], [184, 132], [128, 132]], 8)) },
  draft: { c: ['#b8c4d4', '#3a4a60'], g: poly([[50, 208], [50, 52], [206, 208]]), cut: or(poly([[72, 186], [72, 106], [152, 186]]), ...[80, 104, 128, 152, 176].map(x => rect(x - 3, 196, x + 3, 208))) },
  spice: { c: ['#e6f07a', '#6f8a12'], g: or(polyline([[36, 128], [70, 128], [82, 100], [102, 156], [122, 100], [142, 156], [162, 100], [174, 128], [220, 128]], 11), circle(36, 128, 12), circle(220, 128, 12)) },
  stress: { c: ['#ffa98a', '#b3361a'], g: or(rect(40, 112, 216, 140, 6), poly([[40, 140], [64, 182], [16, 182]]), poly([[216, 140], [240, 182], [192, 182]]), seg(128, 40, 128, 84, 12), poly([[106, 76], [150, 76], [128, 106]])) },
  stats: { c: ['#d79bff', '#6a1fa0'], g: or(rect(52, 150, 76, 206, 4), rect(84, 110, 108, 206, 4), rect(116, 70, 140, 206, 4), rect(148, 100, 172, 206, 4), rect(180, 146, 204, 206, 4)), extra: polyline([...Array(41)].map((_, i) => { const x = 40 + i * 4.4; return [x, 196 - 150 * Math.exp(-Math.pow((x - 128) / 40, 2) / 2)]; }), 7) },
  map: { c: ['#7fe0d0', '#0d6b6f'], g: or(and(circle(128, 100, 58), not(circle(128, 100, 22))), poly([[78, 128], [178, 128], [128, 216]])), cut: circle(128, 100, 22) },
  beats: { c: ['#ff9ad8', '#a31470'], g: or(...[0, 1, 2, 3].flatMap(i => [0, 1, 2, 3].map(j => rect(46 + i * 42, 46 + j * 42, 80 + i * 42, 80 + j * 42, 7)))), cut: or(rect(92, 96, 118, 118, 4), rect(176, 54, 202, 76, 4)) },
  model: { c: ['#ffd08a', '#b5541a'], g: ring(128, 128, 34, 84), extra: circle(128, 128, 18) },
  type: { c: ['#c9c9d6', '#2b2b3d'], g: poly([[112, 46], [144, 46], [208, 210], [174, 210], [160, 170], [96, 170], [82, 210], [48, 210]]), cut: poly([[128, 90], [150, 146], [106, 146]]) },
  disc: { c: ['#a9c8ff', '#2a3f9e'], g: ring(128, 128, 22, 90), cut: or(ring(128, 128, 36, 40), poly([[128, 128], [214, 92], [214, 76]])) },
  lumen: null
};
function render(name, spec) {
  const [ct, cb] = spec.c.map(hex), px = new Float32Array(S * S * 4);
  const shade = (x, y) => {
    if (!inRound(x, y, 10, 10, S - 10, S - 10, 52)) return [0, 0, 0, 0];
    let c = mix(ct, cb, (y - 10) / (S - 20));
    if (y < 120 && inRound(x, y, 18, 16, S - 18, 130, 46)) c = mix(c, [255, 255, 255], 0.16 * (1 - (y - 16) / 114));   // gloss
    if (!inRound(x, y, 13, 13, S - 13, S - 13, 49)) c = mix(c, [0, 0, 0], 0.25);                                        // rim
    const inG = spec.g(x, y) || (spec.extra2 && spec.extra2(x, y)), inC = spec.cut && spec.cut(x, y), inE = spec.extra && spec.extra(x, y);
    if (inE) return [...mix([255, 255, 255], ct, 0.25), 255];
    if (inG && !inC) return [...mix([255, 255, 255], [225, 235, 245], (y - 40) / 180), 255];
    return [...c, 255];
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let a = [0, 0, 0, 0];
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) { const c = shade(x + (sx + .5) / SS, y + (sy + .5) / SS); a[0] += c[0] * c[3]; a[1] += c[1] * c[3]; a[2] += c[2] * c[3]; a[3] += c[3]; }
    const i = (y * S + x) * 4; px[i] = a[3] ? a[0] / a[3] : 0; px[i + 1] = a[3] ? a[1] / a[3] : 0; px[i + 2] = a[3] ? a[2] / a[3] : 0; px[i + 3] = a[3] / (SS * SS);
  }
  const raw = Buffer.alloc(S * (S * 4 + 1));
  for (let y = 0; y < S; y++) for (let x = 0; x < S * 4; x++) raw[y * (S * 4 + 1) + 1 + x] = Math.round(px[y * S * 4 + x]);
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const v of b) c = crcT[(c ^ v) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(S, 0); ih.writeUInt32BE(S, 4); ih[8] = 8; ih[9] = 6;
  fs.writeFileSync(path.join(__dirname, '..', 'kit', 'icons', name + '.png'), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
const only = process.argv.slice(2);
for (const [n, s] of Object.entries(ICONS)) if (s && (!only.length || only.includes(n))) render(n, s);
if (!only.length) fs.copyFileSync(path.join(__dirname, '..', 'kit', 'icons', 'photo.png'), path.join(__dirname, '..', 'kit', 'icons', 'lumen.png'));
console.log('icons done');
