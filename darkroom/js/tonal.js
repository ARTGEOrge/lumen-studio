'use strict';
/* Lumen Darkroom — pure tonal maths (no DOM / WebGL; also loaded by the Node tests):
   - parametric (region) tone curve → 256-entry LUT
   - camera calibration (primary hue / saturation) → 3×3 linear-RGB matrix
   - total exposure (shutter × ISO / aperture²) for Match Total Exposures */
const Tonal = (() => {
  const PC_DEFAULT = { hl: 0, lt: 0, dk: 0, sh: 0, s1: 25, s2: 50, s3: 75 };
  const CAL_DEFAULT = { shTint: 0, rH: 0, rS: 0, gH: 0, gS: 0, bH: 0, bS: 0 };
  const num = (v, lo, hi, d) => { if (v == null || v === '') return d; v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };

  function sanitizePCurve(p) {
    p = p && typeof p === 'object' ? p : {};
    const o = { hl: num(p.hl, -100, 100, 0), lt: num(p.lt, -100, 100, 0), dk: num(p.dk, -100, 100, 0), sh: num(p.sh, -100, 100, 0),
      s1: num(p.s1, 5, 85, 25), s2: num(p.s2, 10, 90, 50), s3: num(p.s3, 15, 95, 75) };
    // keep the split points ordered with at least 5 % between them
    o.s2 = Math.max(o.s1 + 5, o.s2); o.s3 = Math.max(o.s2 + 5, o.s3);
    return o;
  }
  function sanitizeCalib(c) {
    c = c && typeof c === 'object' ? c : {};
    const o = {}; Object.keys(CAL_DEFAULT).forEach(k => o[k] = num(c[k], -100, 100, 0)); return o;
  }
  const isPCDefault = p => !p || (!p.hl && !p.lt && !p.dk && !p.sh);
  const isCalDefault = c => !c || Object.keys(CAL_DEFAULT).every(k => !c[k]);

  /* Parametric curve. Each region slider adds a smooth bump centred on its region; neighbouring bumps
     are sin² / cos² halves, so they sum to exactly 1 between two centres (equal sliders = an even lift).
     The end points (0 and 1) never move, and the result is forced monotonic. */
  const AMP = .22;
  function bump(x, a, m, b) {
    if (x <= a || x >= b) return x === m ? 1 : 0;
    const s = x < m ? Math.sin(Math.PI / 2 * (x - a) / (m - a)) : Math.sin(Math.PI / 2 * (b - x) / (b - m));
    return s * s;
  }
  function paramValue(p, x) {
    const s1 = p.s1 / 100, s2 = p.s2 / 100, s3 = p.s3 / 100;
    const c = [s1 / 2, (s1 + s2) / 2, (s2 + s3) / 2, (s3 + 1) / 2], A = [p.sh, p.dk, p.lt, p.hl];
    let y = x;
    for (let i = 0; i < 4; i++) if (A[i]) y += A[i] / 100 * AMP * bump(x, i ? c[i - 1] : 0, c[i], i < 3 ? c[i + 1] : 1);
    return y;
  }
  function paramLUT(p, n = 256) {
    const out = new Float32Array(n);
    if (isPCDefault(p)) { for (let i = 0; i < n; i++) out[i] = i / (n - 1); return out; }
    p = sanitizePCurve(p); let mx = 0;
    for (let i = 0; i < n; i++) { mx = Math.max(mx, Math.min(1, Math.max(0, paramValue(p, i / (n - 1))))); out[i] = mx; }
    return out;
  }
  // which region (0 shadows … 3 highlights) a tone value belongs to
  function regionOf(p, x) { p = sanitizePCurve(p); return x < p.s1 / 100 ? 0 : x < p.s2 / 100 ? 1 : x < p.s3 / 100 ? 2 : 3; }

  /* Calibration: rotate each camera primary around the grey axis (hue, ±30°) and scale its chroma
     (saturation, ±60 %); the matrix columns are the new primaries, rows normalised so white stays white. */
  function calibMatrix(c) {
    const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    if (isCalDefault(c)) return I;
    c = sanitizeCalib(c);
    const k = 1 / Math.sqrt(3);
    const rot = (v, deg) => {   // Rodrigues around (1,1,1)/√3 — positive = towards the next hue (R→Y→G→C→B→M)
      const t = deg * Math.PI / 180, ct = Math.cos(t), st = Math.sin(t);
      const ax = [k, k, k], d = v[0] * k + v[1] * k + v[2] * k;
      const cr = [ax[1] * v[2] - ax[2] * v[1], ax[2] * v[0] - ax[0] * v[2], ax[0] * v[1] - ax[1] * v[0]];
      return v.map((x, i) => x * ct + cr[i] * st + ax[i] * d * (1 - ct));
    };
    const prim = (e, h, s) => { const v = rot(e, h / 100 * 30), m = (v[0] + v[1] + v[2]) / 3; return v.map(x => m + (x - m) * (1 + s / 100 * .6)); };
    const cols = [prim([1, 0, 0], c.rH, c.rS), prim([0, 1, 0], c.gH, c.gS), prim([0, 0, 1], c.bH, c.bS)];
    // white = Σ columns; the residual (white − 1) is pure chroma (each column keeps mean 1/3) — share it out
    // equally so neutrals stay neutral without dimming the other primaries
    const D = [0, 1, 2].map(i => (cols[0][i] + cols[1][i] + cols[2][i] - 1) / 3);
    // row-major M: out_i = Σ_j M[i][j] in_j, column j = new primary j
    const M = [];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M.push(cols[j][i] - D[i]);
    return M;
  }
  const apply3 = (M, v) => [0, 1, 2].map(i => M[i * 3] * v[0] + M[i * 3 + 1] * v[1] + M[i * 3 + 2] * v[2]);

  /* Exposure matching: image brightness ∝ shutter · ISO / aperture² */
  function totalExposure(e) {
    if (!e || !(e.shutter > 0) || !(e.aperture > 0)) return null;
    return e.shutter * (e.iso > 0 ? e.iso : 100) / (e.aperture * e.aperture);
  }
  // exposure slider value for `target` so it matches `ref` (whose exposure slider is refExp)
  function matchExposure(refExif, refExp, targetExif) {
    const a = totalExposure(refExif), b = totalExposure(targetExif);
    if (a == null || b == null) return null;
    return Math.max(-5, Math.min(5, Math.round((refExp + Math.log2(a / b)) * 100) / 100));
  }

  return { PC_DEFAULT, CAL_DEFAULT, sanitizePCurve, sanitizeCalib, isPCDefault, isCalDefault, paramLUT, paramValue, regionOf, calibMatrix, apply3, totalExposure, matchExposure };
})();
if (typeof module !== 'undefined') module.exports = Tonal;
