'use strict';
/* Lumen Darkroom — Photo Merge worker.
   HDR: median-threshold-bitmap alignment (Ward) + Mertens exposure fusion (Laplacian pyramid blending).
   Panorama: Harris corners + BRIEF descriptors, ratio-test matching, RANSAC homographies, maximum spanning tree,
             focal estimate from the homographies, spherical / cylindrical / perspective projection,
             exposure compensation and two-band blending, optional auto crop.
   Messages in: {type:'hdr'|'pano', images:[{w,h,data:ArrayBuffer(RGBA)}], opts}
   Messages out: {type:'progress', msg} · {type:'done', w, h, data, info} · {type:'error', message} */
const post = (o, t) => self.postMessage(o, t || []);
const progress = msg => post({ type: 'progress', msg });
self.onmessage = e => {
  const m = e.data;
  try {
    const imgs = m.images.map(i => ({ w: i.w, h: i.h, d: new Uint8ClampedArray(i.data) }));
    const r = m.type === 'hdr' ? hdr(imgs, m.opts || {}) : pano(imgs, m.opts || {});
    post({ type: 'done', w: r.w, h: r.h, data: r.d.buffer, info: r.info }, [r.d.buffer]);
  } catch (err) { post({ type: 'error', message: err.message || String(err) }); }
};

/* ======================= shared helpers ======================= */
const lin = new Float32Array(256); for (let i = 0; i < 256; i++) { const v = i / 255; lin[i] = v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }
const enc = v => { v = v <= 0 ? 0 : v >= 1 ? 1 : v; return v <= .0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - .055; };
function gray8(img) { const n = img.w * img.h, g = new Uint8Array(n), d = img.d; for (let i = 0; i < n; i++) g[i] = (54 * d[i * 4] + 183 * d[i * 4 + 1] + 19 * d[i * 4 + 2]) >> 8; return g; }
function grayF(img) { const n = img.w * img.h, g = new Float32Array(n), d = img.d; for (let i = 0; i < n; i++) g[i] = (.2126 * d[i * 4] + .7152 * d[i * 4 + 1] + .0722 * d[i * 4 + 2]) / 255; return g; }
function resizeGray(g, w, h, W, H) {   // box-filter downscale (W ≤ w)
  const out = new Float32Array(W * H), sx = w / W, sy = h / H;
  for (let y = 0; y < H; y++) { const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy)); for (let x = 0; x < W; x++) { const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx)); let s = 0; for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) s += g[yy * w + xx]; out[y * W + x] = s / ((y1 - y0) * (x1 - x0)); } }
  return out;
}
// fast gaussian approximation: three box blurs (running sums), O(1) per pixel
function blurF(src, w, h, sigma) {
  if (sigma < 1.6) return blurExact(src, w, h, sigma);
  const n = 3, wIdeal = Math.sqrt(12 * sigma * sigma / n + 1); let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--; const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4)), sizes = [0, 1, 2].map(i => i < m ? wl : wu);
  let a = Float32Array.from(src), b = new Float32Array(w * h);
  for (const sz of sizes) { const r = (sz - 1) >> 1; if (r < 1) continue; boxH(a, b, w, h, r); boxV(b, a, w, h, r); }
  return a;
}
function boxH(s, d, w, h, r) { const k = 1 / (2 * r + 1); for (let y = 0; y < h; y++) { const o = y * w; let acc = 0; for (let i = -r; i <= r; i++) acc += s[o + Math.min(w - 1, Math.max(0, i))]; for (let x = 0; x < w; x++) { d[o + x] = acc * k; acc += s[o + Math.min(w - 1, x + r + 1)] - s[o + Math.max(0, x - r)]; } } }
function boxV(s, d, w, h, r) { const k = 1 / (2 * r + 1); for (let x = 0; x < w; x++) { let acc = 0; for (let i = -r; i <= r; i++) acc += s[Math.min(h - 1, Math.max(0, i)) * w + x]; for (let y = 0; y < h; y++) { d[y * w + x] = acc * k; acc += s[Math.min(h - 1, y + r + 1) * w + x] - s[Math.max(0, y - r) * w + x]; } } }
function blurExact(src, w, h, sigma) {   // separable gaussian (float, single channel)
  const r = Math.max(1, Math.ceil(sigma * 3)), k = new Float32Array(2 * r + 1); let ks = 0;
  for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-i * i / (2 * sigma * sigma)); ks += k[i + r]; } for (let i = 0; i < k.length; i++) k[i] /= ks;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let i = -r; i <= r; i++) { const xx = Math.min(w - 1, Math.max(0, x + i)); s += src[y * w + xx] * k[i + r]; } tmp[y * w + x] = s; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0; for (let i = -r; i <= r; i++) { const yy = Math.min(h - 1, Math.max(0, y + i)); s += tmp[yy * w + x] * k[i + r]; } out[y * w + x] = s; }
  return out;
}

/* ======================= HDR ======================= */
// Gaussian / Laplacian pyramids on Float32 single channel images
function reduce(a, w, h) {
  const W = Math.max(1, (w + 1) >> 1), H = Math.max(1, (h + 1) >> 1), t = new Float32Array(W * h), o = new Float32Array(W * H), K = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16];
  for (let y = 0; y < h; y++) for (let X = 0; X < W; X++) { let s = 0; for (let i = -2; i <= 2; i++) { let x = 2 * X + i; x = x < 0 ? -x : x >= w ? 2 * w - 2 - x : x; s += a[y * w + Math.max(0, Math.min(w - 1, x))] * K[i + 2]; } t[y * W + X] = s; }
  for (let Y = 0; Y < H; Y++) for (let X = 0; X < W; X++) { let s = 0; for (let i = -2; i <= 2; i++) { let y = 2 * Y + i; y = y < 0 ? -y : y >= h ? 2 * h - 2 - y : y; s += t[Math.max(0, Math.min(h - 1, y)) * W + X] * K[i + 2]; } o[Y * W + X] = s; }
  return { a: o, w: W, h: H };
}
function expand(a, W, H, w, h) {   // a: W×H → w×h
  const t = new Float32Array(W * h), o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { const fy = (y - .5) / 2, y0 = Math.floor(fy), f = fy - y0, ya = Math.max(0, Math.min(H - 1, y0)), yb = Math.max(0, Math.min(H - 1, y0 + 1)); for (let X = 0; X < W; X++) t[y * W + X] = a[ya * W + X] * (1 - f) + a[yb * W + X] * f; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const fx = (x - .5) / 2, x0 = Math.floor(fx), f = fx - x0, xa = Math.max(0, Math.min(W - 1, x0)), xb = Math.max(0, Math.min(W - 1, x0 + 1)); o[y * w + x] = t[y * W + xa] * (1 - f) + t[y * W + xb] * f; }
  return o;
}
function gaussPyr(a, w, h, n) { const p = [{ a, w, h }]; for (let i = 1; i < n; i++) p.push(reduce(p[i - 1].a, p[i - 1].w, p[i - 1].h)); return p; }
function lapPyr(a, w, h, n) { const g = gaussPyr(a, w, h, n); for (let i = 0; i < n - 1; i++) { const e = expand(g[i + 1].a, g[i + 1].w, g[i + 1].h, g[i].w, g[i].h), L = g[i].a; for (let k = 0; k < L.length; k++) L[k] -= e[k]; } return g; }
function collapse(p) { let cur = p[p.length - 1].a; for (let i = p.length - 2; i >= 0; i--) { const e = expand(cur, p[i + 1].w, p[i + 1].h, p[i].w, p[i].h), L = p[i].a; for (let k = 0; k < L.length; k++) e[k] += L[k]; cur = e; } return cur; }

// MTB alignment of g (moving) to ref; returns integer shift [dx,dy] such that moving(x - dx, y - dy) ≈ ref(x, y)
function mtbShift(ref, mov, w, h, levels = 6) {
  const pyr = (g) => { const out = [{ g, w, h }]; for (let l = 1; l < levels; l++) { const p = out[l - 1], W = p.w >> 1, H = p.h >> 1, a = new Uint8Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = 2 * y * p.w + 2 * x; a[y * W + x] = (p.g[i] + p.g[i + 1] + p.g[i + p.w] + p.g[i + p.w + 1] + 2) >> 2; } out.push({ g: a, w: W, h: H }); } return out; };
  const bitmaps = p => { const hist = new Uint32Array(256); for (let i = 0; i < p.g.length; i++) hist[p.g[i]]++; let acc = 0, med = 0; for (; med < 256; med++) { acc += hist[med]; if (acc >= p.g.length / 2) break; } const t = new Uint8Array(p.g.length), e = new Uint8Array(p.g.length); for (let i = 0; i < p.g.length; i++) { t[i] = p.g[i] > med ? 1 : 0; e[i] = Math.abs(p.g[i] - med) > 4 ? 1 : 0; } return { t, e, w: p.w, h: p.h }; };
  const A = pyr(ref).map(bitmaps), B = pyr(mov).map(bitmaps);
  let sx = 0, sy = 0;
  for (let l = levels - 1; l >= 0; l--) {
    sx *= 2; sy *= 2; const a = A[l], b = B[l]; let best = Infinity, bx = 0, by = 0;
    // (0,0) first so ties keep the current estimate instead of drifting
    for (const [dx, dy] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const tx = sx + dx, ty = sy + dy; let err = 0;
      for (let y = Math.max(0, ty); y < Math.min(a.h, a.h + ty); y++) { const yb = y - ty; for (let x = Math.max(0, tx); x < Math.min(a.w, a.w + tx); x++) { const i = y * a.w + x, j = yb * b.w + (x - tx); if (a.e[i] & b.e[j] && a.t[i] !== b.t[j]) err++; } }
      if (err < best) { best = err; bx = tx; by = ty; }
    }
    sx = bx; sy = by;
  }
  return [sx, sy];
}
function hdr(imgs, opts) {
  if (imgs.length < 2) throw new Error('select at least two bracketed photos');
  const w = imgs[0].w, h = imgs[0].h, n = w * h;
  if (imgs.some(i => i.w !== w || i.h !== h)) throw new Error('the photos must have the same dimensions');
  // reference = the exposure closest to mid grey
  const means = imgs.map(i => { let s = 0; const g = gray8(i); for (let k = 0; k < n; k += 7) s += g[k]; return s / (n / 7); });
  const order = means.map((m, i) => [m, i]).sort((a, b) => a[0] - b[0]).map(x => x[1]);
  const refI = order[order.length >> 1];
  let shifts = imgs.map(() => [0, 0]);
  if (opts.align !== false) {
    progress('Aligning exposures…');
    const gref = gray8(imgs[refI]);
    shifts = imgs.map((im, i) => i === refI ? [0, 0] : mtbShift(gref, gray8(im), w, h));
  }
  // apply shifts (edge pixels replicated) and crop to the common area
  const mx0 = Math.max(0, ...shifts.map(s => s[0])), mx1 = Math.max(0, ...shifts.map(s => -s[0])), my0 = Math.max(0, ...shifts.map(s => s[1])), my1 = Math.max(0, ...shifts.map(s => -s[1]));
  const W = w - mx0 - mx1, H = h - my0 - my1, N = W * H;
  if (W < 16 || H < 16) throw new Error('the photos could not be aligned');
  // aligned copies stay 8-bit (RGB planes); float planes are made one channel at a time to bound memory
  const planes = imgs.map((im, i) => { const [dx, dy] = shifts[i], c = [new Uint8Array(N), new Uint8Array(N), new Uint8Array(N)]; for (let y = 0; y < H; y++) { const sy = Math.min(h - 1, Math.max(0, y + my0 - dy)); for (let x = 0; x < W; x++) { const sx = Math.min(w - 1, Math.max(0, x + mx0 - dx)), k = (sy * w + sx) * 4, o = y * W + x; c[0][o] = im.d[k]; c[1][o] = im.d[k + 1]; c[2][o] = im.d[k + 2]; } } im.d = null; return c; });
  const fplane = a => { const f = new Float32Array(a.length); for (let k = 0; k < a.length; k++) f[k] = a[k] / 255; return f; };
  // deghosting (reference-guided): where a frame disagrees with the reference exposure scaled by its exposure ratio,
  // its pixels are replaced by that prediction, so the moving subject comes from the reference only and no ghost
  // can leak through any pyramid level; static areas keep every frame.
  let ghostFrac = 0;
  const thr = { low: .16, medium: .11, high: .07 }[opts.deghost];
  if (thr && planes.length > 1) {
    progress('Detecting moving objects…');
    const linOf = e => e <= .04045 ? e / 12.92 : Math.pow((e + .055) / 1.055, 2.4);
    const lumE = P8 => { const l = new Float32Array(N); for (let k = 0; k < N; k++) l[k] = (.2126 * P8[0][k] + .7152 * P8[1][k] + .0722 * P8[2][k]) / 255; return l; };
    const RP = planes[refI], ref = lumE(RP), G = new Float32Array(N);
    planes.forEach((P8, i) => {
      if (i === refI) return;
      const li = lumE(P8), r = [];
      for (let k = 0; k < N; k += 7) if (ref[k] > .05 && ref[k] < .95 && li[k] > .05 && li[k] < .95) r.push(Math.log(linOf(li[k]) / Math.max(1e-6, linOf(ref[k]))));
      r.sort((a, b) => a - b); const kk = r.length ? Math.exp(r[r.length >> 1]) : 1;
      const g = new Float32Array(N);
      for (let k = 0; k < N; k++) {
        if (ref[k] < .02 || ref[k] > .985) continue;          // the reference can't predict clipped / black areas
        const pred = Math.min(1, enc(linOf(ref[k]) * kk)), d = Math.abs(pred - li[k]);
        if (pred > .985 && li[k] > .985) continue;
        const t = Math.max(0, Math.min(1, (d - thr) / (thr * .8))); g[k] = t * t * (3 - 2 * t);
      }
      const gb = blurF(g, W, H, Math.max(2, Math.min(W, H) * .008));
      const lut = new Uint8Array(256); for (let v = 0; v < 256; v++) lut[v] = Math.round(Math.min(1, enc(linOf(v / 255) * kk)) * 255);
      for (let k = 0; k < N; k++) {
        const gk = Math.min(1, gb[k] * 2.5); if (gk <= 0) continue; G[k] = Math.max(G[k], gk);
        for (let c = 0; c < 3; c++) P8[c][k] = Math.round(P8[c][k] * (1 - gk) + lut[RP[c][k]] * gk);
      }
    });
    for (let k = 0; k < N; k++) ghostFrac += G[k]; ghostFrac /= N;
  }
  // Mertens weights: contrast × saturation × well-exposedness
  progress('Computing exposure weights…');
  const sig2 = 2 * .2 * .2, weights = planes.map(P8 => {
    const wt = new Float32Array(N), g = new Float32Array(N);
    const R = P8[0], G = P8[1], B = P8[2];
    for (let k = 0; k < N; k++) g[k] = (.2126 * R[k] + .7152 * G[k] + .0722 * B[k]) / 255;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = y * W + x, l = Math.abs(4 * g[k] - g[y * W + Math.max(0, x - 1)] - g[y * W + Math.min(W - 1, x + 1)] - g[Math.max(0, y - 1) * W + x] - g[Math.min(H - 1, y + 1) * W + x]);
      const r = R[k] / 255, gg = G[k] / 255, b = B[k] / 255, mu = (r + gg + b) / 3, sat = Math.sqrt(((r - mu) ** 2 + (gg - mu) ** 2 + (b - mu) ** 2) / 3);
      const ex = Math.exp(-((r - .5) ** 2) / sig2) * Math.exp(-((gg - .5) ** 2) / sig2) * Math.exp(-((b - .5) ** 2) / sig2);
      wt[k] = (l + .02) * (sat + .02) * ex + 1e-12;
    }
    return wt;
  });
  for (let k = 0; k < N; k++) { let s = 0; for (const wt of weights) s += wt[k]; for (const wt of weights) wt[k] /= s; }
  const levels = Math.max(1, Math.floor(Math.log2(Math.min(W, H))) - 3);
  const wp = weights.map((wt, i) => { progress(`Blending pyramids… ${i + 1} / ${weights.length}`); return gaussPyr(wt, W, H, levels); });
  const out = new Uint8ClampedArray(N * 4);
  for (let ch = 0; ch < 3; ch++) {
    progress(`Fusing exposures… ${['red', 'green', 'blue'][ch]}`);
    let acc = null;
    planes.forEach((c, i) => {
      const L = lapPyr(fplane(c[ch]), W, H, levels);
      if (!acc) acc = L.map(l => ({ a: new Float32Array(l.a.length), w: l.w, h: l.h }));
      L.forEach((l, j) => { const A = acc[j].a, G = wp[i][j].a; for (let k = 0; k < A.length; k++) A[k] += l.a[k] * G[k]; });
      c[ch] = null;
    });
    const res = collapse(acc);
    for (let k = 0; k < N; k++) out[k * 4 + ch] = Math.round(Math.max(0, Math.min(1, res[k])) * 255);
  }
  for (let k = 0; k < N; k++) out[k * 4 + 3] = 255;
  return { w: W, h: H, d: out, info: { shifts, ref: refI, crop: [mx0, my0, W, H], deghost: opts.deghost || 'off', ghostFrac } };
}

/* ======================= Panorama ======================= */
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const BRIEF = (() => { const r = rng(1234), p = []; const g = () => { let x; do { x = Math.round((r() + r() + r() + r() - 2) * 9); } while (Math.abs(x) > 14); return x; }; for (let i = 0; i < 256; i++) p.push([g(), g(), g(), g()]); return p; })();
function features(g, w, h, maxN = 1200) {
  // Harris response on a lightly smoothed image
  const s = blurF(g, w, h, 1.0), Ixx = new Float32Array(w * h), Iyy = new Float32Array(w * h), Ixy = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x, gx = (s[i + 1] - s[i - 1]) * .5, gy = (s[i + w] - s[i - w]) * .5; Ixx[i] = gx * gx; Iyy[i] = gy * gy; Ixy[i] = gx * gy; }
  const a = blurF(Ixx, w, h, 1.5), b = blurF(Iyy, w, h, 1.5), c = blurF(Ixy, w, h, 1.5), R = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) R[i] = a[i] * b[i] - c[i] * c[i] - .05 * (a[i] + b[i]) ** 2;
  const B = 18, cand = [];
  for (let y = B; y < h - B; y++) for (let x = B; x < w - B; x++) {
    const i = y * w + x, v = R[i]; if (v <= 1e-6) continue;
    let mx = true; for (let dy = -3; dy <= 3 && mx; dy++) for (let dx = -3; dx <= 3; dx++) if ((dx || dy) && R[i + dy * w + dx] > v) { mx = false; break; }
    if (mx) cand.push([v, x, y]);
  }
  // spread features: keep the best per grid cell first
  cand.sort((p, q) => q[0] - p[0]);
  const cell = Math.max(16, Math.round(Math.sqrt(w * h / maxN) * 1.6)), used = new Map(), pick = [], rest = [];
  for (const f of cand) { const k = Math.floor(f[1] / cell) + ',' + Math.floor(f[2] / cell), n = used.get(k) || 0; if (n < 3) { used.set(k, n + 1); pick.push(f); } else rest.push(f); if (pick.length >= maxN) break; }
  const pts = pick.concat(rest).slice(0, maxN);
  // BRIEF descriptors on a smoother image
  const sm = blurF(g, w, h, 2.0);
  return pts.map(([, x, y]) => { const d = new Uint32Array(8); BRIEF.forEach(([x1, y1, x2, y2], k) => { if (sm[(y + y1) * w + x + x1] < sm[(y + y2) * w + x + x2]) d[k >> 5] |= 1 << (k & 31); }); return { x, y, d }; });
}
const popc = v => { v = v - ((v >>> 1) & 0x55555555); v = (v & 0x33333333) + ((v >>> 2) & 0x33333333); return (((v + (v >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; };
function hamming(a, b) { let s = 0; for (let i = 0; i < 8; i++) s += popc(a[i] ^ b[i]); return s; }
function match(A, B) {
  const best = (f, list) => { let b1 = 999, b2 = 999, bi = -1; for (let j = 0; j < list.length; j++) { const d = hamming(f.d, list[j].d); if (d < b1) { b2 = b1; b1 = d; bi = j; } else if (d < b2) b2 = d; } return [bi, b1, b2]; };
  const ab = A.map(f => best(f, B)), out = [];
  ab.forEach(([j, d1, d2], i) => { if (j < 0 || d1 > 64 || d1 > .8 * d2) return; const [ii] = best(B[j], A); if (ii === i) out.push([i, j]); });
  return out;
}
// homography from ≥4 correspondences (normalised DLT, least squares via normal equations of the 8-param form)
function homography(P, Q) {
  const norm = pts => { let mx = 0, my = 0; pts.forEach(p => { mx += p[0]; my += p[1]; }); mx /= pts.length; my /= pts.length; let d = 0; pts.forEach(p => d += Math.hypot(p[0] - mx, p[1] - my)); const s = Math.SQRT2 / Math.max(1e-9, d / pts.length); return { T: [s, 0, -s * mx, 0, s, -s * my, 0, 0, 1], pts: pts.map(p => [(p[0] - mx) * s, (p[1] - my) * s]) }; };
  const a = norm(P), b = norm(Q), n = P.length, M = new Float64Array(64), v = new Float64Array(8);
  for (let i = 0; i < n; i++) {
    const [x, y] = a.pts[i], [u, w] = b.pts[i];
    const r1 = [x, y, 1, 0, 0, 0, -u * x, -u * y], r2 = [0, 0, 0, x, y, 1, -w * x, -w * y];
    for (let r = 0; r < 8; r++) { for (let c = 0; c < 8; c++) M[r * 8 + c] += r1[r] * r1[c] + r2[r] * r2[c]; v[r] += r1[r] * u + r2[r] * w; }
  }
  const h = solve8(M, v); if (!h) return null;
  const Hn = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
  return mul3(inv3(b.T), mul3(Hn, a.T));
}
function solve8(M, v) {
  const n = 8, A = Array.from({ length: n }, (_, r) => [...M.slice(r * n, r * n + n), v[r]]);
  for (let c = 0; c < n; c++) { let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r; if (Math.abs(A[p][c]) < 1e-12) return null; [A[c], A[p]] = [A[p], A[c]]; for (let r = 0; r < n; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; } }
  return A.map((row, r) => row[n] / row[r]);
}
const mul3 = (A, B) => { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return C; };
function inv3(m) { const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C, k = 1 / det; return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k]; }
const ap = (H, x, y) => { const w = H[6] * x + H[7] * y + H[8]; return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w, w]; };
function ransac(P, Q, thr, iters = 1500) {
  const n = P.length; if (n < 8) return null; const r = rng(99); let best = null, bestIn = [];
  for (let it = 0; it < iters; it++) {
    const idx = new Set(); while (idx.size < 4) idx.add(Math.floor(r() * n)); const s = [...idx];
    const H = homography(s.map(i => P[i]), s.map(i => Q[i])); if (!H) continue;
    const inl = []; for (let i = 0; i < n; i++) { const q = ap(H, P[i][0], P[i][1]); if (q[2] > 0 && Math.hypot(q[0] - Q[i][0], q[1] - Q[i][1]) < thr) inl.push(i); }
    if (inl.length > bestIn.length) { bestIn = inl; best = H; if (inl.length > n * .9) break; }
  }
  if (!best || bestIn.length < 8) return null;
  for (let k = 0; k < 2; k++) { const H = homography(bestIn.map(i => P[i]), bestIn.map(i => Q[i])); if (!H) break; best = H; bestIn = []; for (let i = 0; i < n; i++) { const q = ap(H, P[i][0], P[i][1]); if (q[2] > 0 && Math.hypot(q[0] - Q[i][0], q[1] - Q[i][1]) < thr) bestIn.push(i); } }
  return { H: best, inliers: bestIn };
}
// OpenCV's focalsFromHomography (centred coordinates)
function focalsFromH(h) {
  let f0 = null, f1 = null, d1, d2, v1, v2;
  d1 = h[6] * h[7]; d2 = (h[7] - h[6]) * (h[7] + h[6]); v1 = -(h[0] * h[1] + h[3] * h[4]) / d1; v2 = (h[0] * h[0] + h[3] * h[3] - h[1] * h[1] - h[4] * h[4]) / d2;
  if (v1 < v2) [v1, v2] = [v2, v1]; if (v1 > 0 && v2 > 0) f1 = Math.sqrt(Math.abs(d1) > Math.abs(d2) ? v1 : v2); else if (v1 > 0) f1 = Math.sqrt(v1);
  d1 = h[0] * h[3] + h[1] * h[4]; d2 = h[0] * h[0] + h[1] * h[1] - h[3] * h[3] - h[4] * h[4]; v1 = -h[2] * h[5] / d1; v2 = (h[5] * h[5] - h[2] * h[2]) / d2;
  if (v1 < v2) [v1, v2] = [v2, v1]; if (v1 > 0 && v2 > 0) f0 = Math.sqrt(Math.abs(d1) > Math.abs(d2) ? v1 : v2); else if (v1 > 0) f0 = Math.sqrt(v1);
  return f0 && f1 && isFinite(f0) && isFinite(f1) ? Math.sqrt(f0 * f1) : null;
}
// largest axis-aligned rectangle inside a binary mask (histogram method)
function maxRect(mask, w, h) {
  const hgt = new Int32Array(w); let best = { a: 0, x: 0, y: 0, w: w, h: h };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) hgt[x] = mask[y * w + x] ? hgt[x] + 1 : 0;
    const st = [];
    for (let x = 0; x <= w; x++) { const cur = x < w ? hgt[x] : 0; let start = x; while (st.length && st[st.length - 1][1] >= cur) { const [sx, sh] = st.pop(); const a = sh * (x - sx); if (a > best.a) best = { a, x: sx, y: y - sh + 1, w: x - sx, h: sh }; start = sx; } st.push([start, cur]); }
  }
  return best;
}
function pano(imgs, opts) {
  const n = imgs.length; if (n < 2) throw new Error('select at least two overlapping photos');
  const T = {}, t0 = performance.now(); let tl = t0; const tick = k => { const t = performance.now(); T[k] = Math.round(t - tl); tl = t; };
  // 1. features at ≤ 1000 px
  const F = imgs.map((im, i) => {
    progress(`Finding features… ${i + 1} / ${n}`);
    const s = Math.min(1, 1000 / Math.max(im.w, im.h)), W = Math.max(32, Math.round(im.w * s)), H = Math.max(32, Math.round(im.h * s));
    const g = s < 1 ? resizeGray(grayF(im), im.w, im.h, W, H) : grayF(im);
    return { s: W / im.w, W, H, f: features(g, W, H) };
  });
  tick('features');
  // 2. pairwise matching + RANSAC (coordinates centred on each image, in feature-res pixels)
  const edges = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    progress(`Matching photos ${i + 1} ↔ ${j + 1}…`);
    const m = match(F[i].f, F[j].f); if (m.length < 12) continue;
    const P = m.map(([a]) => [F[i].f[a].x - F[i].W / 2, F[i].f[a].y - F[i].H / 2]), Q = m.map(([, b]) => [F[j].f[b].x - F[j].W / 2, F[j].f[b].y - F[j].H / 2]);
    const r = ransac(P, Q, Math.max(2.5, Math.max(F[i].W, F[i].H) * .004)); if (!r) continue;
    if (r.inliers.length < 20 || r.inliers.length < m.length * .12) continue;
    edges.push({ i, j, H: r.H, n: r.inliers.length, P: r.inliers.map(k => P[k]), Q: r.inliers.map(k => Q[k]) });   // Q ≈ H P  (i → j)
  }
  tick('match');
  // 3. maximum spanning tree from the best connected image
  const deg = new Array(n).fill(0); edges.forEach(e => { deg[e.i] += e.n; deg[e.j] += e.n; });
  const ref = deg.indexOf(Math.max(...deg));
  const toRef = new Array(n).fill(null), parent = new Array(n).fill(-1); toRef[ref] = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const inTree = new Set([ref]);
  while (inTree.size < n) {
    let be = null; edges.forEach(e => { const a = inTree.has(e.i), b = inTree.has(e.j); if (a !== b && (!be || e.n > be.n)) be = e; });
    if (!be) break;
    if (inTree.has(be.i)) { toRef[be.j] = mul3(toRef[be.i], inv3(be.H)); parent[be.j] = be.i; inTree.add(be.j); } else { toRef[be.i] = mul3(toRef[be.j], be.H); parent[be.i] = be.j; inTree.add(be.i); }
  }
  const missing = [...Array(n).keys()].filter(i => !inTree.has(i));
  if (missing.length) throw new Error(`could not find enough overlap for photo${missing.length > 1 ? 's' : ''} ${missing.map(i => i + 1).join(', ')} — panoramas need about 20–50 % overlap between neighbours`);
  // 4. focal length estimate (feature-res pixels of the reference)
  const fs = edges.filter(e => inTree.has(e.i) && inTree.has(e.j)).map(e => focalsFromH(e.H)).filter(Boolean).sort((a, b) => a - b);
  const Fr = F[ref];
  let focal = fs.length ? fs[fs.length >> 1] : Math.max(Fr.W, Fr.H) * .9;
  if (!(focal > Math.max(Fr.W, Fr.H) * .2 && focal < Math.max(Fr.W, Fr.H) * 20)) focal = Math.max(Fr.W, Fr.H) * .9;
  // 5. exposure compensation from the matched points (median luminance ratio along the tree), in linear light
  progress('Matching exposure…');
  const lums = imgs.map((im, i) => { const g = grayF(im), s = F[i].s; return (x, y) => { const X = Math.round((x + F[i].W / 2) / s), Y = Math.round((y + F[i].H / 2) / s); let v = 0, c = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const xx = Math.min(im.w - 1, Math.max(0, X + dx)), yy = Math.min(im.h - 1, Math.max(0, Y + dy)); v += g[yy * im.w + xx]; c++; } return Math.pow(v / c, 2.2); }; });
  const gain = new Array(n).fill(1);
  const ratio = (i, j) => { const e = edges.find(x => (x.i === i && x.j === j) || (x.i === j && x.j === i)); const r = []; e.P.forEach((p, k) => { const a = lums[e.i](p[0], p[1]), b = lums[e.j](e.Q[k][0], e.Q[k][1]); if (a > .01 && b > .01 && a < .9 && b < .9) r.push(a / b); }); r.sort((x, y) => x - y); const m = r.length ? r[r.length >> 1] : 1; return e.i === i ? m : 1 / m; };   // = lum(parent) / lum(child) at the same scene points
  const order = [ref]; for (let k = 0; k < order.length; k++) for (let c = 0; c < n; c++) if (parent[c] === order[k]) { gain[c] = gain[order[k]] * ratio(order[k], c); order.push(c); }
  // gain[c] multiplies photo c so it matches its parent
  const gm = Math.exp(gain.reduce((a, g) => a + Math.log(g), 0) / n); for (let i = 0; i < n; i++) gain[i] /= gm;
  if (opts.exposure === false) gain.fill(1);
  tick('gain');
  // 6. scale everything to render resolution: render res = reference image res (capped)
  const rs = 1 / Fr.s;   // feature px → reference full px
  const S = s => [s, 0, 0, 0, s, 0, 0, 0, 1];
  const Hfull = toRef.map((H, i) => mul3(S(rs), mul3(H, S(F[i].s))));   // centred full-res image i → centred full-res reference
  let f = focal * rs;
  const proj = opts.projection || 'spherical';
  // forward: image pixel (centred) → output param (θ,φ) or plane coords
  const toParam = (i, x, y) => {
    const p = ap(Hfull[i], x, y); if (proj === 'perspective') return p[2] > 0 ? [p[0], p[1]] : null;
    const q = Hfull[i], X = q[0] * x + q[1] * y + q[2], Y = q[3] * x + q[4] * y + q[5], Z = (q[6] * x + q[7] * y + q[8]) * f;   // ray (X, Y, Z) up to positive scale
    const sgn = (ap(Hfull[i], 0, 0)[2] > 0) ? 1 : -1, dx = X * sgn, dy = Y * sgn, dz = Z * sgn;
    const th = Math.atan2(dx, dz);
    return proj === 'cylindrical' ? [th * f, dy / Math.hypot(dx, dz) * f] : [th * f, Math.atan2(dy, Math.hypot(dx, dz)) * f];
  };
  // bounds
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  imgs.forEach((im, i) => { for (let k = 0; k <= 40; k++) { const t = k / 40; for (const [x, y] of [[t * im.w, 0], [t * im.w, im.h], [0, t * im.h], [im.w, t * im.h]]) { const q = toParam(i, x - im.w / 2, y - im.h / 2); if (!q) continue; x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); } } });
  if (!isFinite(x0) || x1 - x0 < 4) throw new Error('the alignment failed');
  if (proj === 'spherical' && (x1 - x0) > 2 * Math.PI * f) { x0 = -Math.PI * f; x1 = Math.PI * f; }
  let OW = Math.ceil(x1 - x0), OH = Math.ceil(y1 - y0);
  if (proj === 'perspective' && OW * OH > 4 * imgs.reduce((a, im) => a + im.w * im.h, 0)) throw new Error('the perspective projection is too wide — try Spherical or Cylindrical');
  const maxPx = opts.maxPixels || 40e6, maxEdge = opts.maxEdge || 12000, sc = Math.min(1, Math.sqrt(maxPx / (OW * OH)), maxEdge / Math.max(OW, OH));
  OW = Math.max(1, Math.round(OW * sc)); OH = Math.max(1, Math.round(OH * sc));
  // 7. per-image LUTs (gain in linear light) and low-pass copies for two-band blending
  const lut = gain.map(g => { const t = new Float32Array(256); for (let v = 0; v < 256; v++) t[v] = enc(lin[v] * g) * 255; return t; });
  const lows = imgs.map((im, i) => {
    progress(`Preparing photo ${i + 1} / ${n}…`);
    const sig = Math.max(2, Math.max(im.w, im.h) / 400), out = new Uint8ClampedArray(im.w * im.h * 4);
    for (let ch = 0; ch < 3; ch++) { const c = new Float32Array(im.w * im.h); for (let k = 0; k < c.length; k++) c[k] = im.d[k * 4 + ch]; const b = blurF(c, im.w, im.h, sig); for (let k = 0; k < c.length; k++) out[k * 4 + ch] = b[k]; }
    return out;
  });
  tick('lowpass');
  const Hinv = Hfull.map(H => inv3(H));
  const out = new Uint8ClampedArray(OW * OH * 4), mask = new Uint8Array(OW * OH);
  const samp = (d, w, h, x, y, ch) => { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, xa = Math.min(w - 1, Math.max(0, xi)), xb = Math.min(w - 1, xi + 1), ya = Math.min(h - 1, Math.max(0, yi)), yb = Math.min(h - 1, yi + 1); return (d[(ya * w + xa) * 4 + ch] * (1 - fx) + d[(ya * w + xb) * 4 + ch] * fx) * (1 - fy) + (d[(yb * w + xa) * 4 + ch] * (1 - fx) + d[(yb * w + xb) * 4 + ch] * fx) * fy; };
  const W_ = new Float32Array(n), PX = new Float32Array(n), PY = new Float32Array(n);
  for (let oy = 0; oy < OH; oy++) {
    if (oy % 64 === 0) progress(`Blending panorama… ${Math.round(oy / OH * 100)} %`);
    const v = y0 + (oy + .5) / sc;
    for (let ox = 0; ox < OW; ox++) {
      const u = x0 + (ox + .5) / sc;
      // output param → ray / plane point in the reference frame (centred pixels)
      let rx, ry, rz;
      if (proj === 'perspective') { rx = u; ry = v; rz = 1; }
      else { const th = u / f; if (proj === 'cylindrical') { rx = Math.sin(th); ry = v / f; rz = Math.cos(th); } else { const ph = v / f; rx = Math.sin(th) * Math.cos(ph); ry = Math.sin(ph); rz = Math.cos(th) * Math.cos(ph); } rx *= f; ry *= f; }
      let wsum = 0, bi = -1, bw = 0;
      for (let i = 0; i < n; i++) {
        const H = Hinv[i], X = H[0] * rx + H[1] * ry + H[2] * rz, Y = H[3] * rx + H[4] * ry + H[5] * rz, Z = H[6] * rx + H[7] * ry + H[8] * rz;
        W_[i] = 0; if (Z <= 0) continue;
        const im = imgs[i], px = X / Z + im.w / 2, py = Y / Z + im.h / 2;
        if (px < 0 || py < 0 || px > im.w - 1 || py > im.h - 1) continue;
        const e = Math.min(px, im.w - 1 - px, py, im.h - 1 - py) / (Math.min(im.w, im.h) * .5), wt = Math.max(1e-4, Math.min(1, e));
        W_[i] = wt; PX[i] = px; PY[i] = py; wsum += wt; if (wt > bw) { bw = wt; bi = i; }
      }
      const o = (oy * OW + ox) * 4;
      if (bi < 0) continue;
      mask[oy * OW + ox] = 1;
      for (let ch = 0; ch < 3; ch++) {
        let low = 0;
        for (let i = 0; i < n; i++) if (W_[i] > 0) { const im = imgs[i]; low += W_[i] * lut[i][Math.round(samp(lows[i], im.w, im.h, PX[i], PY[i], ch))]; }
        low /= wsum;
        const im = imgs[bi], hi = lut[bi][Math.round(samp(im.d, im.w, im.h, PX[bi], PY[bi], ch))] - lut[bi][Math.round(samp(lows[bi], im.w, im.h, PX[bi], PY[bi], ch))];
        out[o + ch] = low + hi;
      }
      out[o + 3] = 255;
    }
  }
  tick('blend');
  let result = { w: OW, h: OH, d: out }, crop = [0, 0];
  if (opts.autoCrop !== false) {
    progress('Cropping…');
    const k = Math.max(1, Math.ceil(Math.max(OW, OH) / 1200)), mw = Math.ceil(OW / k), mh = Math.ceil(OH / k), m = new Uint8Array(mw * mh);
    for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) { let all = 1; for (let yy = y * k; yy < Math.min(OH, y * k + k) && all; yy++) for (let xx = x * k; xx < Math.min(OW, x * k + k); xx++) if (!mask[yy * OW + xx]) { all = 0; break; } m[y * mw + x] = all; }
    const r = maxRect(m, mw, mh);
    if (r.a > 0) {
      const cx = r.x * k, cy = r.y * k, cw = Math.min(OW - cx, r.w * k), ch = Math.min(OH - cy, r.h * k), d = new Uint8ClampedArray(cw * ch * 4);
      for (let y = 0; y < ch; y++) d.set(out.subarray(((cy + y) * OW + cx) * 4, ((cy + y) * OW + cx + cw) * 4), y * cw * 4);
      result = { w: cw, h: ch, d }; crop = [cx, cy];
    }
  }
  result.info = { ref, focal: f, projection: proj, gains: gain, edges: edges.map(e => [e.i, e.j, e.n]), size: [OW, OH], x0, y0, sc, crop, timing: (tick('crop'), T) };
  return result;
}
