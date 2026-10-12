'use strict';
/* Lumen Sound — spectral editing: time × frequency selections (rectangle or lasso) on the spectrogram,
   and STFT-domain operations on them: attenuate / amplify, delete, and heal (spectral repair that
   interpolates the magnitudes from the surrounding time frames or neighbouring frequencies). */
window.Spectral = (() => {
  const N = 2048, HOP = N / 4, HB = N / 2;
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* selection helpers. sel: {kind:'rect', a, b, f0, f1} | {kind:'lasso', pts:[[sample, freq]...], log} (a, b, f0, f1 = bounding box) */
  function bounds(sel) {
    if (sel.kind === 'rect') return { a: sel.a, b: sel.b, f0: sel.f0, f1: sel.f1 };
    let a = Infinity, b = -Infinity, f0 = Infinity, f1 = -Infinity;
    for (const [s, f] of sel.pts) { a = Math.min(a, s); b = Math.max(b, s); f0 = Math.min(f0, f); f1 = Math.max(f1, f); }
    return { a, b, f0, f1 };
  }
  // frequency → normalised vertical coordinate (0 = top), same mapping as the spectrogram display
  const fNorm = (f, sr, log) => { const ny = sr / 2; return log ? 1 - Math.log(Math.max(20, f) / 20) / Math.log(ny / 20) : 1 - f / ny; };
  function inPoly(pts, x, y) { let ins = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi + 1e-30) + xi) ins = !ins; } return ins; }

  /* Hard mask (F × (HB+1)) for frames whose centre lies inside the selection. a0: absolute sample of segment start. */
  function hardMask(sel, F, a0, sr) {
    const m = new Uint8Array(F * (HB + 1)), bb = bounds(sel), binHz = sr / N;
    const poly = sel.kind === 'lasso' ? sel.pts.map(([s, f]) => [s, fNorm(f, sr, sel.log)]) : null;
    for (let f = 0; f < F; f++) {
      const c = a0 - N + HOP + f * HOP + N / 2; if (c < bb.a || c > bb.b) continue;
      const k0 = Math.max(0, Math.floor(bb.f0 / binHz)), k1 = Math.min(HB, Math.ceil(bb.f1 / binHz));
      for (let k = k0; k <= k1; k++) {
        if (poly) { if (!inPoly(poly, c, fNorm(k * binHz, sr, sel.log))) continue; }
        else if (k * binHz < bb.f0 - binHz / 2 || k * binHz > bb.f1 + binHz / 2) continue;
        m[f * (HB + 1) + k] = 1;
      }
    }
    return m;
  }
  function dilate(m, F, rt, rf) {
    const o = new Uint8Array(m.length), W = HB + 1;
    for (let f = 0; f < F; f++) for (let k = 0; k < W; k++) {
      if (!m[f * W + k]) continue;
      for (let df = -rt; df <= rt; df++) { const g = f + df; if (g < 0 || g >= F) continue; for (let dk = -rf; dk <= rf; dk++) { const q = k + dk; if (q >= 0 && q < W) o[g * W + q] = 1; } }
    }
    return o;
  }
  function soften(m, F) { // separable box blur (±1 frame, ±2 bins), keeps full strength inside
    const W = HB + 1, a = new Float32Array(m.length), b = new Float32Array(m.length);
    for (let f = 0; f < F; f++) for (let k = 0; k < W; k++) { let s = 0, n = 0; for (let d = -2; d <= 2; d++) { const q = k + d; if (q >= 0 && q < W) { s += m[f * W + q]; n++; } } a[f * W + k] = s / n; }
    for (let f = 0; f < F; f++) for (let k = 0; k < W; k++) { let s = 0, n = 0; for (let d = -1; d <= 1; d++) { const g = f + d; if (g >= 0 && g < F) { s += a[g * W + k]; n++; } } b[f * W + k] = Math.max(m[f * W + k], s / n); }
    return b;
  }

  /* Process one channel segment x (absolute start a0). op: 'attenuate' | 'delete' | 'heal'. Returns new Float32Array. */
  function processChannel(x, a0, sr, sel, op, p = {}) {
    const n = x.length, w = DSP.hann(N), W = HB + 1;
    const F = Math.ceil((n + N - HOP) / HOP);
    const RE = new Float32Array(F * W), IM = new Float32Array(F * W);
    const fr = new Float64Array(N), re = new Float64Array(W), im = new Float64Array(W);
    for (let f = 0; f < F; f++) {
      const pos = -N + HOP + f * HOP;
      for (let i = 0; i < N; i++) { const k = pos + i; fr[i] = k >= 0 && k < n ? x[k] * w[i] : 0; }
      DSP.rfft(fr, re, im);
      for (let k = 0; k < W; k++) { RE[f * W + k] = re[k]; IM[f * W + k] = im[k]; }
    }
    const hard = hardMask(sel, F, a0, sr);
    const region = op === 'heal' ? dilate(hard, F, 2, 2) : hard;
    const soft = soften(region, F);
    const mag = (f, k) => Math.hypot(RE[f * W + k], IM[f * W + k]);
    const gainArr = new Float32Array(F * W).fill(1);
    if (op === 'attenuate' || op === 'delete') {
      const g = op === 'delete' ? 0 : DSP.dbToLin(p.db ?? -12);
      for (let i = 0; i < gainArr.length; i++) gainArr[i] = 1 - soft[i] + soft[i] * g;
    } else if (op === 'heal') {
      const bb = bounds(sel), dur = (bb.b - bb.a) / sr;
      let mode = p.mode || 'auto';
      if (mode === 'auto') mode = dur > 0.6 && bb.f1 / Math.max(1, bb.f0) < 3 ? 'freq' : 'time';
      const T = new Float32Array(F * W); // target magnitude (log interpolation)
      const L = v => Math.log(v + 1e-9);
      if (mode === 'time') {
        for (let k = 0; k < W; k++) {
          for (let f = 0; f < F; f++) {
            if (!region[f * W + k]) continue;
            let e = f; while (e + 1 < F && region[(e + 1) * W + k]) e++;
            let ls = 0, ln = 0, rs = 0, rn = 0;
            for (let q = f - 1; q >= Math.max(0, f - 4); q--) { ls += L(mag(q, k)); ln++; }
            for (let q = e + 1; q <= Math.min(F - 1, e + 4); q++) { rs += L(mag(q, k)); rn++; }
            const lv = ln ? ls / ln : rs / Math.max(1, rn), rv = rn ? rs / rn : lv;
            for (let q = f; q <= e; q++) { const u = (q - f + 1) / (e - f + 2); T[q * W + k] = Math.exp(lv + (rv - lv) * u); }
            f = e;
          }
        }
      } else {
        for (let f = 0; f < F; f++) {
          for (let k = 0; k < W; k++) {
            if (!region[f * W + k]) continue;
            let e = k; while (e + 1 < W && region[f * W + e + 1]) e++;
            let ls = 0, ln = 0, rs = 0, rn = 0;
            for (let q = k - 1; q >= Math.max(0, k - 4); q--) { ls += L(mag(f, q)); ln++; }
            for (let q = e + 1; q <= Math.min(W - 1, e + 4); q++) { rs += L(mag(f, q)); rn++; }
            const lv = ln ? ls / ln : rs / Math.max(1, rn), rv = rn ? rs / rn : lv;
            for (let q = k; q <= e; q++) { const u = (q - k + 1) / (e - k + 2); T[f * W + q] = Math.exp(lv + (rv - lv) * u); }
            k = e;
          }
        }
      }
      const str = clamp((p.strength ?? 100) / 100, 0, 1);
      for (let i = 0; i < gainArr.length; i++) {
        if (!region[i]) continue;
        const m0 = Math.hypot(RE[i], IM[i]); if (m0 < 1e-12) continue;
        let g = T[i] / m0; if (p.reduceOnly !== false) g = Math.min(1, g);
        g = 1 + (g - 1) * str * soft[i]; gainArr[i] = g;
      }
    }
    // resynthesis (weighted overlap-add, exact normalisation)
    const out = new Float32Array(n), norm = new Float32Array(n);
    for (let f = 0; f < F; f++) {
      const pos = -N + HOP + f * HOP;
      for (let k = 0; k < W; k++) { const g = gainArr[f * W + k]; re[k] = RE[f * W + k] * g; im[k] = IM[f * W + k] * g; }
      im[0] = 0; im[HB] = 0;
      DSP.irfft(re, im, fr);
      const i0 = Math.max(0, -pos), i1 = Math.min(N, n - pos);
      for (let i = i0; i < i1; i++) { const k = pos + i; out[k] += fr[i] * w[i]; norm[k] += w[i] * w[i]; }
    }
    for (let i = 0; i < n; i++) out[i] = norm[i] > 1e-6 ? out[i] / norm[i] : x[i];
    // samples whose analysis frames never touched the region are restored bit-exactly
    const bb = bounds(sel), safe = N + (op === 'heal' ? 3 * HOP : HOP);
    for (let i = 0; i < n; i++) { const s = a0 + i; if (s < bb.a - safe || s > bb.b + safe) out[i] = x[i]; }
    return out;
  }
  /* range (absolute samples) that an operation reads and writes */
  function workRange(sel, len, op) {
    const bb = bounds(sel), pad = N * 2 + (op === 'heal' ? 6 * HOP : 0);
    return [Math.max(0, Math.floor(bb.a - pad)), Math.min(len, Math.ceil(bb.b + pad))];
  }
  return { N, HOP, bounds, fNorm, inPoly, processChannel, workRange };
})();
