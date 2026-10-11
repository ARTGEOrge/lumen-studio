'use strict';
/* Lumen Paint — shared utilities: math, color, noise, PNG codec (lossless straight-alpha RGBA). */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const uid = () => Math.random().toString(36).slice(2, 10);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nextFrame = () => new Promise(r => requestAnimationFrame(() => r()));

/* deterministic PRNG */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* dither table for stochastic rounding (avoids banding and stuck 8-bit values) */
const DITHER = (() => { const r = mulberry32(7), a = new Float32Array(4096); for (let i = 0; i < 4096; i++) a[i] = r(); return a; })();

/* ---------- color ---------- */
function hsv2rgb(h, s, v) { // h 0..360, s,v 0..1 → [r,g,b] 0..1
  h = ((h % 360) + 360) % 360 / 60; const i = Math.floor(h), f = h - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
}
function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx];
}
const hex2 = v => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
const rgbHex = c => '#' + hex2(c[0]) + hex2(c[1]) + hex2(c[2]);
function hexRgb(h) {
  h = String(h).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) h = h.split('').map(c => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}
const luma = c => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

/* ---------- noise ---------- */
function makeValueNoise(seed, size = 256, sizeY = size) { // tileable value noise lattice (power-of-two sizes)
  const r = mulberry32(seed), g = new Float32Array(size * sizeY); for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, m = size - 1, my = sizeY - 1;
    const x0 = xi & m, y0 = yi & my, x1 = (xi + 1) & m, y1 = (yi + 1) & my;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = g[y0 * size + x0], b = g[y0 * size + x1], c = g[y1 * size + x0], d = g[y1 * size + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}
function fbm(noise, x, y, oct = 4, lac = 2, gain = 0.5) { let s = 0, a = 1, n = 0, f = 1; for (let i = 0; i < oct; i++) { s += noise(x * f, y * f) * a; n += a; a *= gain; f *= lac; } return s / n; }
// rank-equalize a float map to a uniform 0..1 distribution (makes grain thresholds predictable)
function equalize(a) { // histogram equalisation (4096 bins)
  let mn = Infinity, mx = -Infinity; for (let i = 0; i < a.length; i++) { const v = a[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  const B = 4096, hist = new Float64Array(B), k = (B - 1) / (mx - mn || 1);
  for (let i = 0; i < a.length; i++) hist[((a[i] - mn) * k) | 0]++;
  let acc = 0; for (let i = 0; i < B; i++) { const c = hist[i]; hist[i] = (acc + c / 2) / a.length; acc += c; }
  const out = new Float32Array(a.length); for (let i = 0; i < a.length; i++) out[i] = hist[((a[i] - mn) * k) | 0]; return out;
}

/* ---------- geometry ---------- */
// 2D affine as [a,b,c,d,e,f]: x' = a*x + c*y + e, y' = b*x + d*y + f (canvas convention)
const mat = {
  id: () => [1, 0, 0, 1, 0, 0],
  mul: (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]],
  inv: m => { const d = m[0] * m[3] - m[1] * m[2] || 1e-12; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; },
  ap: (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
  tr: (x, y) => [1, 0, 0, 1, x, y], sc: (x, y = x) => [x, 0, 0, y, 0, 0], rot: a => { const c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; }
};
// projective 3x3 (row-major) mapping unit square → quad p[0..3] (tl,tr,br,bl)
function squareToQuad(p) {
  const [x0, y0] = p[0], [x1, y1] = p[1], [x2, y2] = p[2], [x3, y3] = p[3];
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  if (Math.abs(sx) > 1e-9 || Math.abs(sy) > 1e-9) { const den = dx1 * dy2 - dx2 * dy1; g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den; }
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1];
}
function inv3(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C || 1e-12;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}
const ap3 = (m, x, y) => { const w = m[6] * x + m[7] * y + m[8]; return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w]; };
function pointInPoly(x, y, pts) { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) ins = !ins; } return ins; }

/* ---------- PNG codec (needs window.fflate) ---------- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf, start, end) { let c = 0xffffffff; for (let i = start; i < end; i++) c = CRC_T[(c ^ buf[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngFilter(w, h, rgba) { // "Sub" filtered scanlines (cheap, compresses paintings well)
  const stride = w * 4, raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1) + 1, r = y * stride; raw[o - 1] = 1;
    raw[o] = rgba[r]; raw[o + 1] = rgba[r + 1]; raw[o + 2] = rgba[r + 2]; raw[o + 3] = rgba[r + 3];
    for (let x = 4; x < stride; x++) raw[o + x] = rgba[r + x] - rgba[r + x - 4];
  }
  return raw;
}
function pngWrap(w, h, z) {
  const chunks = [], chunk = (type, data) => {
    const b = new Uint8Array(12 + data.length), dv = new DataView(b.buffer);
    dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) b[4 + i] = type.charCodeAt(i);
    b.set(data, 8); dv.setUint32(8 + data.length, crc32(b, 4, 8 + data.length)); chunks.push(b);
  };
  const ih = new Uint8Array(13), dv = new DataView(ih.buffer); dv.setUint32(0, w); dv.setUint32(4, h); ih[8] = 8; ih[9] = 6;
  chunk('IHDR', ih); chunk('IDAT', z); chunk('IEND', new Uint8Array(0));
  const sig = [137, 80, 78, 71, 13, 10, 26, 10], len = 8 + chunks.reduce((s, c) => s + c.length, 0), out = new Uint8Array(len);
  out.set(sig, 0); let o = 8; for (const c of chunks) { out.set(c, o); o += c.length; } return out;
}
function pngEncode(w, h, rgba, level = 6) { return pngWrap(w, h, fflate.zlibSync(pngFilter(w, h, rgba), { level })); }
// decoding uses native zlib streams when available (fast); encoding uses fflate's parallel workers
const nativeZ = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
const zStream = (data, S) => new Response(new Blob([data]).stream().pipeThrough(new S('deflate'))).arrayBuffer().then(b => new Uint8Array(b));
async function pngEncodeAsync(w, h, rgba, level = 6) {
  const raw = pngFilter(w, h, rgba);
  return new Promise((res, rej) => fflate.zlib(raw, { level }, (err, z) => err ? rej(err) : res(pngWrap(w, h, z))));
}
// Decode 8-bit RGBA/RGB/GA/G non-interlaced PNGs exactly. Returns {w,h,data} or null (caller falls back to the browser decoder).
function pngDecode(bytes, rawInflated) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u.length < 33 || u[0] !== 137 || u[1] !== 80) return null;
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength); let o = 8, w = 0, h = 0, depth = 0, ct = 0, il = 0; const idat = [];
  while (o + 8 <= u.length) {
    const len = dv.getUint32(o), type = String.fromCharCode(u[o + 4], u[o + 5], u[o + 6], u[o + 7]);
    if (o + 12 + len > u.length) return null;
    if (type === 'IHDR') { w = dv.getUint32(o + 8); h = dv.getUint32(o + 12); depth = u[o + 16]; ct = u[o + 17]; il = u[o + 20]; }
    else if (type === 'IDAT') idat.push(u.subarray(o + 8, o + 8 + len));
    else if (type === 'IEND') break;
    o += 12 + len;
  }
  const ch = { 6: 4, 2: 3, 4: 2, 0: 1 }[ct];
  if (!w || !h || depth !== 8 || !ch || il || w > 30000 || h > 30000 || w * h > 2.2e8) return null;
  const total = idat.reduce((s, c) => s + c.length, 0), z = new Uint8Array(total); let p = 0; for (const c of idat) { z.set(c, p); p += c.length; }
  let raw; try { raw = rawInflated || fflate.unzlibSync(z); } catch (e) { return null; }
  const stride = w * ch; if (raw.length < (stride + 1) * h) return null;
  const px = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], s = y * (stride + 1) + 1, r = y * stride, pr = r - stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[r + x - ch] : 0, b = y ? px[pr + x] : 0, c = x >= ch && y ? px[pr + x - ch] : 0; let v = raw[s + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[r + x] = v;
    }
  }
  if (ch === 4) return { w, h, data: new Uint8ClampedArray(px.buffer) };
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += ch) {
    if (ch === 3) { out[i * 4] = px[j]; out[i * 4 + 1] = px[j + 1]; out[i * 4 + 2] = px[j + 2]; out[i * 4 + 3] = 255; }
    else if (ch === 2) { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = px[j]; out[i * 4 + 3] = px[j + 1]; }
    else { out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = px[j]; out[i * 4 + 3] = 255; }
  }
  return { w, h, data: out };
}
// same, but the zlib inflate runs in a worker (parallel decode of many layers)
function pngDecodeAsync(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u.length < 33 || u[0] !== 137 || u[1] !== 80) return Promise.resolve(null);
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength), idat = []; let o = 8;
  while (o + 8 <= u.length) { const len = dv.getUint32(o), ty = String.fromCharCode(u[o + 4], u[o + 5], u[o + 6], u[o + 7]); if (o + 12 + len > u.length) break; if (ty === 'IDAT') idat.push(u.subarray(o + 8, o + 8 + len)); else if (ty === 'IEND') break; o += 12 + len; }
  const total = idat.reduce((s, c) => s + c.length, 0), z = new Uint8Array(total); let p = 0; for (const c of idat) { z.set(c, p); p += c.length; }
  if (nativeZ) return zStream(z, DecompressionStream).then(raw => pngDecode(u, raw), () => pngDecode(u));
  return new Promise(res => fflate.unzlib(z, (err, raw) => res(err ? pngDecode(u) : pngDecode(u, raw))));
}
// decode any browser-supported image to straight RGBA
async function decodeImage(buf, mime) {
  const p = pngDecode(new Uint8Array(buf)); if (p) return p;
  const bmp = await createImageBitmap(new Blob([buf], mime ? { type: mime } : {}), { premultiplyAlpha: 'none', colorSpaceConversion: 'default' });
  const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
  const d = x.getImageData(0, 0, bmp.width, bmp.height); bmp.close?.();
  return { w: d.width, h: d.height, data: d.data };
}
function rgbaToCanvas(w, h, data) { const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, w * h * 4), w, h), 0, 0); return c; }
