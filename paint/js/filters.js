'use strict';
/* Filters (Filter menu): Gaussian Blur, Motion Blur, Unsharp Mask, Add Noise. They work on the current
   pixel layer (inside the selection, feathered by its soft edge), with live preview and one undo step.
   Pixels are filtered premultiplied so transparent edges never bleed dark fringes; Lock Transparency
   keeps the layer's alpha. The kernels below are pure functions on Float32 premultiplied RGBA. */

/* ---------- kernels (pure) ---------- */
function boxSizes(sigma, n = 3) { // box widths whose 3-pass convolution approximates a gaussian
  const wIdeal = Math.sqrt(12 * sigma * sigma / n + 1); let wl = Math.floor(wIdeal); if (wl % 2 === 0) wl--;
  const wu = wl + 2, m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  const out = []; for (let i = 0; i < n; i++) out.push(i < m ? wl : wu); return out;
}
// horizontal box pass of radius r (edges clamped), all four channels at once
function boxPassH(src, dst, w, h, r) {
  const iarr = 1 / (r + r + 1), m = w - 1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4; let a0 = 0, a1 = 0, a2 = 0, a3 = 0;
    for (let i = -r - 1; i < r; i++) { const o = row + (i < 0 ? 0 : i > m ? m : i) * 4; a0 += src[o]; a1 += src[o + 1]; a2 += src[o + 2]; a3 += src[o + 3]; }
    for (let x = 0; x < w; x++) {
      const ia = x + r, ib = x - r - 1, oa = row + (ia > m ? m : ia) * 4, ob = row + (ib < 0 ? 0 : ib) * 4, o = row + x * 4;
      a0 += src[oa] - src[ob]; a1 += src[oa + 1] - src[ob + 1]; a2 += src[oa + 2] - src[ob + 2]; a3 += src[oa + 3] - src[ob + 3];
      dst[o] = a0 * iarr; dst[o + 1] = a1 * iarr; dst[o + 2] = a2 * iarr; dst[o + 3] = a3 * iarr;
    }
  }
}
// vertical box pass, walked row by row (cache friendly) with one accumulator per column channel
function boxPassV(src, dst, w, h, r) {
  const iarr = 1 / (r + r + 1), m = h - 1, W4 = w * 4, acc = new Float64Array(W4);
  for (let i = -r - 1; i < r; i++) { const row = (i < 0 ? 0 : i > m ? m : i) * W4; for (let k = 0; k < W4; k++) acc[k] += src[row + k]; }
  for (let y = 0; y < h; y++) {
    const ia = y + r, ib = y - r - 1, ra = (ia > m ? m : ia) * W4, rb = (ib < 0 ? 0 : ib) * W4, ro = y * W4;
    for (let k = 0; k < W4; k++) { acc[k] += src[ra + k] - src[rb + k]; dst[ro + k] = acc[k] * iarr; }
  }
}
function gaussianBlur(buf, w, h, sigma) { // in place, returns buf
  if (!(sigma > 0.2)) return buf;
  const tmp = new Float32Array(buf.length);
  for (const b of boxSizes(sigma)) { const r = (b - 1) >> 1; if (r <= 0) continue; boxPassH(buf, tmp, w, h, r); boxPassV(tmp, buf, w, h, r); }
  return buf;
}
// dst = average of src shifted by −(ox,oy) and +(ox,oy), bilinear, edges clamped
function twoTapPass(src, dst, w, h, ox, oy) {
  const taps = [[-ox, -oy], [ox, oy]].map(([dx, dy]) => { const ix = Math.floor(dx), iy = Math.floor(dy), ax = dx - ix, ay = dy - iy; return { ix, iy, w00: (1 - ax) * (1 - ay) * 0.5, w10: ax * (1 - ay) * 0.5, w01: (1 - ax) * ay * 0.5, w11: ax * ay * 0.5 }; });
  const W4 = w * 4;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4; let r0 = 0, r1 = 0, r2 = 0, r3 = 0;
    for (let t = 0; t < 2; t++) {
      const T = taps[t], xs = x + T.ix, ys = y + T.iy;
      let i00, i10, i01, i11;
      if (xs >= 0 && ys >= 0 && xs + 1 < w && ys + 1 < h) { i00 = (ys * w + xs) * 4; i10 = i00 + 4; i01 = i00 + W4; i11 = i01 + 4; }
      else { const x0 = xs < 0 ? 0 : xs > w - 1 ? w - 1 : xs, x1 = xs + 1 < 0 ? 0 : xs + 1 > w - 1 ? w - 1 : xs + 1, y0 = ys < 0 ? 0 : ys > h - 1 ? h - 1 : ys, y1 = ys + 1 < 0 ? 0 : ys + 1 > h - 1 ? h - 1 : ys + 1; i00 = (y0 * w + x0) * 4; i10 = (y0 * w + x1) * 4; i01 = (y1 * w + x0) * 4; i11 = (y1 * w + x1) * 4; }
      const a = T.w00, b = T.w10, c = T.w01, d = T.w11;
      r0 += src[i00] * a + src[i10] * b + src[i01] * c + src[i11] * d;
      r1 += src[i00 + 1] * a + src[i10 + 1] * b + src[i01 + 1] * c + src[i11 + 1] * d;
      r2 += src[i00 + 2] * a + src[i10 + 2] * b + src[i01 + 2] * c + src[i11 + 2] * d;
      r3 += src[i00 + 3] * a + src[i10 + 3] * b + src[i01 + 3] * c + src[i11 + 3] * d;
    }
    dst[o] = r0; dst[o + 1] = r1; dst[o + 2] = r2; dst[o + 3] = r3;
  }
}
/* motion blur = uniform average along a line of length `dist` at `angle` (radians). Built from k
   symmetric two-tap passes with doubling offsets → 2^k evenly spaced taps (spacing ≤ 1 px, bilinear). */
function motionBlur(buf, w, h, angle, dist) {
  if (!(dist >= 1)) return buf;
  const k = Math.max(1, Math.ceil(Math.log2(dist))), N = 2 ** k, gap = dist / N, ca = Math.cos(angle), sa = Math.sin(angle);
  let src = buf, dst = new Float32Array(buf.length);
  for (let i = 0; i < k; i++) {
    const off = gap * (2 ** i) / 2; twoTapPass(src, dst, w, h, ca * off, sa * off);
    const t = src; src = dst; dst = t;
  }
  if (src !== buf) buf.set(src);
  return buf;
}
// sharpen colors: out = orig + amount·(orig − blur) where the difference exceeds the threshold (0..1)
function unsharpMask(buf, w, h, radius, amount, threshold) {
  const bl = gaussianBlur(new Float32Array(buf), w, h, radius);
  for (let i = 0; i < buf.length; i += 4) {
    const a = buf[i + 3]; if (a <= 0) continue;
    for (let c = 0; c < 3; c++) {
      const d = buf[i + c] - bl[i + c] * (bl[i + 3] > 0 ? a / bl[i + 3] : 1); // compare at the same alpha
      if (Math.abs(d) / a < threshold) continue;
      buf[i + c] = Math.max(0, Math.min(a, buf[i + c] + amount * d));
    }
  }
  return buf;
}
// gaussian-ish noise on colors (premultiplied, alpha untouched); deterministic for a seed
function addNoise(buf, amount, mono, seed = 1) {
  let s = seed >>> 0 || 1; const rnd = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
  const g = () => (rnd() + rnd() + rnd() - 1.5) * 1.414; // ≈ unit variance, bounded
  for (let i = 0; i < buf.length; i += 4) {
    const a = buf[i + 3]; if (a <= 0) continue;
    if (mono) { const n = g() * amount * a; for (let c = 0; c < 3; c++) buf[i + c] = Math.max(0, Math.min(a, buf[i + c] + n)); }
    else for (let c = 0; c < 3; c++) buf[i + c] = Math.max(0, Math.min(a, buf[i + c] + g() * amount * a));
  }
  return buf;
}
const toPremul = (rgba) => { const f = new Float32Array(rgba.length); for (let i = 0; i < rgba.length; i += 4) { const a = rgba[i + 3] / 255; f[i] = rgba[i] / 255 * a; f[i + 1] = rgba[i + 1] / 255 * a; f[i + 2] = rgba[i + 2] / 255 * a; f[i + 3] = a; } return f; };

/* ---------- session over the current layer (browser) ---------- */
function filterSession(reach, spread) {
  if (!prepEdit()) return null; const L = adjustTarget(); if (!L) return null;
  freezeAll();
  const sel = doc.sel, m = Math.ceil(reach), sp = Math.ceil(spread);
  let box = sel ? doc.selBox : layerBounds(L);
  if (!box) { Aero.toast(sel ? 'The selection is empty' : 'Nothing to filter on this layer'); return null; }
  const grow = (b, d) => { const x0 = Math.max(0, b.x - d), y0 = Math.max(0, b.y - d), x1 = Math.min(doc.w, b.x + b.w + d), y1 = Math.min(doc.h, b.y + b.h + d); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
  const Rm = grow(sel || L.lockAlpha ? box : grow(box, sp), m); // the most any setting can read
  const src = readRegion(L, Rm.x, Rm.y, Rm.w, Rm.h);
  return { L, orig: L.tiles.slice(), src, pre: toPremul(src), Rm, box, grow, sel, lock: L.lockAlpha, touched: new Set() };
}
/* fn(premulCopy, w, h) → filtered premultiplied buffer; reach/spread for the current settings (≤ the session's)
   crop the work to what these settings can actually affect */
function filterRun(S, fn, reach, spread) {
  const { L, Rm, sel, lock, src } = S, W = doc.w, tw = doc.tw;
  const Wr = sel || lock ? S.box : S.grow(S.box, Math.ceil(spread)), Rd = S.grow(Wr, Math.ceil(reach));
  const sub = new Float32Array(Rd.w * Rd.h * 4);
  for (let y = 0; y < Rd.h; y++) { const a = ((y + Rd.y - Rm.y) * Rm.w + (Rd.x - Rm.x)) * 4; sub.set(S.pre.subarray(a, a + Rd.w * 4), y * Rd.w * 4); }
  const f = fn(sub, Rd.w, Rd.h);
  // restore what an earlier preview changed
  for (const idx of S.touched) { L.tiles[idx] = S.orig[idx]; L.dirty.add(idx); }
  S.touched.clear();
  const tx0 = (Wr.x / TS) | 0, ty0 = (Wr.y / TS) | 0, tx1 = ((Wr.x + Wr.w - 1) / TS) | 0, ty1 = ((Wr.y + Wr.h - 1) / TS) | 0;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const idx = ty * tw + tx, o0 = S.orig[idx]; if (lock && !o0) continue;
    const t = o0 ? o0.slice() : new Uint8ClampedArray(TSZ), ox = tx * TS, oy = ty * TS;
    const x0 = Math.max(Wr.x, ox), y0 = Math.max(Wr.y, oy), x1 = Math.min(Wr.x + Wr.w, ox + TS), y1 = Math.min(Wr.y + Wr.h, oy + TS);
    let any = !!o0;
    for (let y = y0; y < y1; y++) {
      let o = ((y - oy) * TS + (x0 - ox)) * 4, j = ((y - Rd.y) * Rd.w + (x0 - Rd.x)) * 4, q = ((y - Rm.y) * Rm.w + (x0 - Rm.x)) * 4;
      for (let x = x0; x < x1; x++, o += 4, j += 4, q += 4) {
        const k = sel ? sel[y * W + x] / 255 : 1; if (k <= 0) continue;
        const sa = src[q + 3] / 255; let na = lock ? sa : f[j + 3];
        if (na <= 0 && sa <= 0) continue;
        // filtered straight color
        const fa = f[j + 3] > 1e-6 ? f[j + 3] : 0, fr = fa ? f[j] / fa : 0, fg = fa ? f[j + 1] / fa : 0, fb = fa ? f[j + 2] / fa : 0;
        let r, g, b, a;
        const s0 = src[q] / 255, s1 = src[q + 1] / 255, s2 = src[q + 2] / 255;
        if (lock) { a = sa; const kk = fa ? k : 0; r = s0 + (fr - s0) * kk; g = s1 + (fg - s1) * kk; b = s2 + (fb - s2) * kk; }
        else { // blend premultiplied by the selection weight
          a = sa + (na - sa) * k; if (a <= 1e-6) { t[o] = t[o + 1] = t[o + 2] = t[o + 3] = 0; continue; }
          r = (s0 * sa + (f[j] - s0 * sa) * k) / a; g = (s1 * sa + (f[j + 1] - s1 * sa) * k) / a; b = (s2 * sa + (f[j + 2] - s2 * sa) * k) / a;
        }
        t[o] = r * 255 + 0.5; t[o + 1] = g * 255 + 0.5; t[o + 2] = b * 255 + 0.5; t[o + 3] = a * 255 + 0.5;
        if (t[o + 3]) any = true;
      }
    }
    if (!any && !o0) continue;
    L.tiles[idx] = any || o0 ? t : null; L.dirty.add(idx); S.touched.add(idx);
  }
  markDirty(L);
}
function filterCancel(S) { for (const idx of S.touched) { S.L.tiles[idx] = S.orig[idx]; S.L.dirty.add(idx); } S.touched.clear(); markDirty(S.L); }
function filterCommit(S, label) { for (const idx of S.touched) if (S.L.tiles[idx] && tileEmpty(S.L.tiles[idx])) S.L.tiles[idx] = null; S.L.owned.clear(); histPush(label); layerThumbDirty(S.L); }
/* dialog with debounced live preview. reach = max kernel radius (px read around the result), spread = how far
   the result can grow past the layer's pixels; build(v) → [fn(premulBuf, w, h), reach, spread] for those settings */
function filterDialog(title, fields, reach, spread, build) {
  const S = filterSession(reach, spread); if (!S) return;
  let timer = 0, lastV = null;
  const run = v => { try { const [fn, r, sp] = build(v); filterRun(S, fn, Math.min(r, reach), Math.min(sp, spread)); } catch (e) { console.warn(e); } };
  const big = S.Rm.w * S.Rm.h > 3e6;
  Aero.dialog({ title, fields, ok: 'Apply', instruction: doc.sel ? 'Applies inside the selection' : 'Applies to the current layer',
    onChange: v => { lastV = { ...v }; clearTimeout(timer); timer = setTimeout(() => run(lastV), big ? 260 : 60); },
    onOK: async v => { clearTimeout(timer); if (big) { Aero.busy(title + '…'); await sleep(20); } try { run(v); filterCommit(S, title); } finally { if (big) Aero.busy(); } },
    onCancel: () => { clearTimeout(timer); filterCancel(S); } });
  run(Object.fromEntries(fields.map(f => [f.key, f.value])));
}
const FILTER_LAST = { gauss: 6, mAngle: 0, mDist: 30, usR: 2, usA: 80, usT: 2, nAmt: 8, nMono: true };
function fltGaussian() {
  filterDialog('Gaussian Blur', [{ key: 'r', label: 'Radius', type: 'range', min: 0.5, max: 100, step: 0.5, value: FILTER_LAST.gauss, fmt: v => (+v).toFixed(1) + ' px' }],
    300, 300, v => { FILTER_LAST.gauss = +v.r; return [(b, w, h) => gaussianBlur(b, w, h, +v.r), 3 * v.r, 3 * v.r]; });
}
function fltMotion() {
  filterDialog('Motion Blur', [{ key: 'a', label: 'Angle', type: 'range', min: -90, max: 90, value: FILTER_LAST.mAngle, fmt: v => v + '°' }, { key: 'd', label: 'Distance', type: 'range', min: 1, max: 300, value: FILTER_LAST.mDist, fmt: v => v + ' px' }],
    152, 152, v => { FILTER_LAST.mAngle = +v.a; FILTER_LAST.mDist = +v.d; return [(b, w, h) => motionBlur(b, w, h, -v.a * Math.PI / 180, +v.d), v.d / 2 + 2, v.d / 2 + 2]; });
}
function fltUnsharp() {
  filterDialog('Unsharp Mask', [{ key: 'a', label: 'Amount', type: 'range', min: 1, max: 500, value: FILTER_LAST.usA, fmt: v => v + '%' }, { key: 'r', label: 'Radius', type: 'range', min: 0.3, max: 30, step: 0.1, value: FILTER_LAST.usR, fmt: v => (+v).toFixed(1) + ' px' }, { key: 't', label: 'Threshold', type: 'range', min: 0, max: 64, value: FILTER_LAST.usT, fmt: v => v + ' levels' }],
    90, 0, v => { Object.assign(FILTER_LAST, { usA: +v.a, usR: +v.r, usT: +v.t }); return [(b, w, h) => unsharpMask(b, w, h, +v.r, v.a / 100, v.t / 255), 3 * v.r, 0]; });
}
function fltNoise() {
  const seed = (Math.random() * 1e9) | 0;
  filterDialog('Add Noise', [{ key: 'n', label: 'Amount', type: 'range', min: 1, max: 60, value: FILTER_LAST.nAmt, fmt: v => v + '%' }, { key: 'm', label: 'Monochromatic', type: 'checkbox', value: FILTER_LAST.nMono }],
    0, 0, v => { FILTER_LAST.nAmt = +v.n; FILTER_LAST.nMono = !!v.m; return [b => addNoise(b, v.n / 100 * 0.5, !!v.m, seed), 0, 0]; });
}
if (typeof module !== 'undefined') module.exports = { gaussianBlur, motionBlur, unsharpMask, addNoise, boxSizes, toPremul };
