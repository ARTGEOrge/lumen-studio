// Lumen Lab — toolbox-style functions: statistics (percentiles, z-scores, moving windows, normal
// distribution, 'omitnan'), signal processing (butter, filtfilt, freqz, findpeaks, xcorr, windows),
// optimization (fsolve, lsqcurvefit, lsqnonlin, fminunc), a stiff ODE solver (ode23s / ode15s)
// and file handles (fopen, fprintf to files, fgetl, fclose) on the Current Folder.
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const M = node ? require('./mat.js') : root.LabMat;
  const LA = node ? require('./linalg.js') : root.LabLinalg;
  const I = node ? require('./interp.js') : root.LabInterp;
  const Lib = node ? require('./lib.js') : root.LabLib;
  const Nu = node ? require('./numerics.js') : root.LabNumerics;
  const { Mat, fail, num, str } = M;
  const { Struct } = I;
  const { L, N, S, Str, isStr, vec, reduce, along } = Lib;
  const rowOut = a => M.rowVec(a), colOut = a => M.colVec(a);
  const shapeLike = (A, arr) => (A.r === 1 ? rowOut(arr) : colOut(arr));
  const defDim = A => A.r !== 1 ? 1 : 2;
  const strs = a => a.filter(isStr).map(x => Str(x).toLowerCase());
  const nums = a => a.filter(x => !isStr(x));
  // name/value options → { lowercased name: value }
  function opts(a, start) { const o = {}; for (let k = start; k + 1 < a.length; k += 2) if (isStr(a[k])) o[Str(a[k]).toLowerCase()] = a[k + 1]; return o; }
  const sorted = v => Array.from(v).filter(x => !Number.isNaN(x)).sort((x, y) => x - y);
  const mean = v => v.reduce((s, x) => s + x, 0) / v.length;

  // ---------- statistics ----------
  function pct(v, p) { // MATLAB's prctile: x(i) sits at percentile 100*(i-0.5)/n, linear in between
    const s = sorted(v), n = s.length; if (!n) return NaN;
    const pos = p / 100 * n + 0.5; if (pos <= 1) return s[0]; if (pos >= n) return s[n - 1];
    const i = Math.floor(pos); return s[i - 1] + (pos - i) * (s[i] - s[i - 1]);
  }
  function percentiles(a, scale) {
    const X = N(a[0]), P = vec(a[1]).map(p => p * scale), dim = a.length > 2 ? S(a[2]) : defDim(X);
    for (const p of P) if (p < 0 || p > 100) fail('Percentiles must be between 0 and 100.');
    if (X.r === 1 || X.c === 1) { const out = P.map(p => pct(X.re, p)); return a[1].c === 1 && a[1].r > 1 ? colOut(out) : rowOut(out); }
    // matrix: one row (dim 1) or column (dim 2) per percentile
    const cols = dim === 1 ? X.c : X.r, len = dim === 1 ? X.r : X.c, O = dim === 1 ? new Mat(P.length, cols) : new Mat(cols, P.length);
    for (let j = 0; j < cols; j++) { const v = []; for (let i = 0; i < len; i++) v.push(dim === 1 ? X.re[i + j * X.r] : X.re[j + i * X.r]); P.forEach((p, k) => { if (dim === 1) O.re[k + j * P.length] = pct(v, p); else O.re[j + k * cols] = pct(v, p); }); }
    return O;
  }
  L.prctile = a => percentiles(a, 1);
  L.quantile = a => percentiles(a, 100);
  L.iqr = a => { const X = N(a[0]); return reduce(X, defDim(X), v => pct(v, 75) - pct(v, 25)); };
  L.zscore = (a, nout) => {
    const X = N(a[0]), dim = a.length > 2 ? S(a[2]) : defDim(X), flag = a.length > 1 && a[1].n ? S(a[1]) : 0;
    const mu = reduce(X, dim, v => mean(Array.from(v))), sd = reduce(X, dim, v => { const m = mean(Array.from(v)); let s = 0; for (const x of v) s += (x - m) ** 2; return Math.sqrt(s / (flag ? v.length : v.length - 1)); });
    const Z = M.rdivide(M.minus(X, mu), M.map(sd, x => x === 0 ? 1 : x));
    return nout > 1 ? [Z, mu, sd] : Z;
  };
  L.normalize = a => {
    const X = N(a[0]), method = strs(a)[0] || 'zscore', dim = nums(a).length > 1 ? S(nums(a)[1]) : defDim(X);
    if (method === 'zscore') return L.zscore([X, num(0), num(dim)], 1);
    if (method === 'range') { const lo = reduce(X, dim, v => Math.min(...v)), hi = reduce(X, dim, v => Math.max(...v)); return M.rdivide(M.minus(X, lo), M.map(M.minus(hi, lo), x => x || 1)); }
    if (method === 'center') return M.minus(X, reduce(X, dim, v => mean(Array.from(v))));
    if (method === 'norm') return M.rdivide(X, reduce(X, dim, v => Math.sqrt(Array.from(v).reduce((s, x) => s + x * x, 0)) || 1));
    fail(`normalize: unknown method '${method}'. Use 'zscore', 'range', 'center' or 'norm'.`);
  };
  L.rescale = a => {
    const X = N(a[0]), lo = a.length > 2 ? S(a[1]) : 0, hi = a.length > 2 ? S(a[2]) : 1;
    let mn = Infinity, mx = -Infinity; for (const x of X.re) if (isFinite(x)) { mn = Math.min(mn, x); mx = Math.max(mx, x); }
    return M.map(X, x => mx === mn ? lo : lo + (x - mn) / (mx - mn) * (hi - lo));
  };
  const moment = (v, k) => { const m = mean(v); return v.reduce((s, x) => s + (x - m) ** k, 0) / v.length; };
  L.skewness = a => { const X = N(a[0]); return reduce(X, defDim(X), v => { v = Array.from(v); return moment(v, 3) / Math.pow(moment(v, 2), 1.5); }); };
  L.kurtosis = a => { const X = N(a[0]); return reduce(X, defDim(X), v => { v = Array.from(v); return moment(v, 4) / moment(v, 2) ** 2; }); };
  L.mad = a => { const X = N(a[0]), med = a.length > 1 && S(a[1]) === 1; return reduce(X, defDim(X), v => { v = Array.from(v); if (med) { const m = pct(v, 50); return pct(v.map(x => Math.abs(x - m)), 50); } const m = mean(v); return mean(v.map(x => Math.abs(x - m))); }); };
  L.corr = a => { const x = vec(a[0]), y = vec(a[1]), mx = mean(x), my = mean(y); let sxy = 0, sx = 0, sy = 0; x.forEach((v, i) => { sxy += (v - mx) * (y[i] - my); sx += (v - mx) ** 2; sy += (y[i] - my) ** 2; }); return num(sxy / Math.sqrt(sx * sy)); };
  // moving-window statistics, windows shrink at the ends (MATLAB's default 'shrink')
  function moving(a, f) {
    const X = N(a[0]), w = vec(a[1]); let before, after;
    if (w.length === 2) { before = w[0]; after = w[1]; } else { const k = w[0]; before = Math.floor(k / 2); after = k % 2 ? before : before - 1; }
    const dim = nums(a).length > 2 ? S(nums(a)[2]) : defDim(X);
    return along(X, dim, v => v.map((_, i) => f(v.slice(Math.max(0, i - before), Math.min(v.length, i + after + 1)))));
  }
  L.movmean = a => moving(a, mean);
  L.movsum = a => moving(a, v => v.reduce((s, x) => s + x, 0));
  L.movmedian = a => moving(a, v => pct(v, 50));
  L.movmax = a => moving(a, v => Math.max(...v));
  L.movmin = a => moving(a, v => Math.min(...v));
  L.movstd = a => moving(a, v => v.length < 2 ? 0 : Math.sqrt(v.reduce((s, x) => s + (x - mean(v)) ** 2, 0) / (v.length - 1)));
  L.smoothdata = a => { const X = N(a[0]), method = strs(a).find(s => ['movmean', 'movmedian', 'gaussian'].includes(s)) || 'movmean', w = nums(a)[1] ? S(nums(a)[1]) : Math.max(3, Math.round(X.n / 10) | 1);
    if (method === 'gaussian') { const sig = w / 5; return along(X, defDim(X), v => v.map((_, i) => { let s = 0, ws = 0; for (let j = Math.max(0, i - (w >> 1)); j <= Math.min(v.length - 1, i + (w >> 1)); j++) { const g = Math.exp(-0.5 * ((j - i) / sig) ** 2); s += g * v[j]; ws += g; } return s / ws; })); }
    return moving([X, num(w)], method === 'movmedian' ? v => pct(v, 50) : mean); };
  // normal distribution
  const erf = x => L.erf([num(x)]).re[0];
  L.normpdf = a => { const mu = a[1] ? N(a[1]) : num(0), s = a[2] ? N(a[2]) : num(1); return M.ew(M.ew(N(a[0]), mu, (x, m) => x - m), s, (d, sg) => Math.exp(-0.5 * (d / sg) ** 2) / (sg * Math.sqrt(2 * Math.PI))); };
  L.normcdf = a => { const mu = a[1] ? N(a[1]) : num(0), s = a[2] ? N(a[2]) : num(1); return M.ew(M.ew(N(a[0]), mu, (x, m) => x - m), s, (d, sg) => 0.5 * (1 + erf(d / (sg * Math.SQRT2)))); };
  function probit(p) { // Acklam's rational approximation, polished with two Newton steps
    if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239], b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572], c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783], d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    let x; const q = p < 0.02425 ? Math.sqrt(-2 * Math.log(p)) : p > 1 - 0.02425 ? Math.sqrt(-2 * Math.log(1 - p)) : null;
    if (q === null) { const r = (p - 0.5) ** 2, t = p - 0.5; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * t / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
    else { x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); if (p > 0.5) x = -x; }
    for (let k = 0; k < 2; k++) { const e = 0.5 * (1 + erf(x / Math.SQRT2)) - p; x -= e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2); }
    return x;
  }
  L.norminv = a => { const mu = a[1] ? N(a[1]) : num(0), s = a[2] ? N(a[2]) : num(1); return M.plus(M.times(M.map(N(a[0]), probit), s), mu); };
  // 'omitnan' for the reductions that otherwise return NaN
  const omit = (name, f) => { const orig = L[name]; L[name] = (a, nout, In) => {
    const flags = strs(a), rest = a.filter(x => !(isStr(x) && /^(omitnan|includenan)$/i.test(Str(x))));
    if (!flags.includes('omitnan')) return orig(rest, nout, In);
    const X = N(rest[0]); if (flags.includes('all')) return num(f(Array.from(X.re).filter(x => !Number.isNaN(x))));
    const dim = rest.length > 1 && !isStr(rest[1]) && rest[1].n ? S(rest[1]) : rest.length > 2 && !isStr(rest[2]) ? S(rest[2]) : defDim(X);
    return reduce(X, dim, v => f(Array.from(v).filter(x => !Number.isNaN(x))));
  }; };
  omit('sum', v => v.reduce((s, x) => s + x, 0)); omit('prod', v => v.reduce((s, x) => s * x, 1));
  omit('mean', v => v.length ? mean(v) : NaN); omit('median', v => pct(v, 50));
  omit('var', v => v.length < 2 ? 0 : v.reduce((s, x) => s + (x - mean(v)) ** 2, 0) / (v.length - 1));
  omit('std', v => v.length < 2 ? 0 : Math.sqrt(v.reduce((s, x) => s + (x - mean(v)) ** 2, 0) / (v.length - 1)));
  for (const n of ['sum', 'mean', 'median', 'std', 'var']) L['nan' + n] = (a, k, In) => L[n]([...a, str('omitnan')], k, In);
  L.nanmax = (a, k, In) => L.max(a, k, In); L.nanmin = (a, k, In) => L.min(a, k, In);

  // ---------- signal processing ----------
  const win = f => a => { const n = Math.round(S(a[0])); if (n === 1) return num(1); return colOut(Array.from({ length: n }, (_, k) => f(k, n - 1))); };
  L.hann = win((k, m) => 0.5 - 0.5 * Math.cos(2 * Math.PI * k / m)); L.hanning = a => { const n = S(a[0]); return colOut(Array.from({ length: n }, (_, k) => 0.5 - 0.5 * Math.cos(2 * Math.PI * (k + 1) / (n + 1)))); };
  L.hamming = win((k, m) => 0.54 - 0.46 * Math.cos(2 * Math.PI * k / m));
  L.blackman = win((k, m) => 0.42 - 0.5 * Math.cos(2 * Math.PI * k / m) + 0.08 * Math.cos(4 * Math.PI * k / m));
  L.rectwin = a => colOut(new Array(Math.round(S(a[0]))).fill(1));
  L.sinc = a => M.map(N(a[0]), x => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  L.detrend = a => { const X = N(a[0]), order = a.length > 1 ? (isStr(a[1]) ? (Str(a[1]) === 'constant' ? 0 : 1) : S(a[1])) : 1;
    return along(X, defDim(X), v => { const t = v.map((_, i) => i); const p = Array.from(L.polyfit([M.rowVec(t), M.rowVec(v), num(order)], 1).re); return v.map((y, i) => y - p.reduce((s, c) => s * i + c, 0)); }); };
  // complex helpers on [re, im] pairs
  const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]], cdiv = (a, b) => M.C.div(a[0], a[1], b[0], b[1]);
  const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]], csub = (a, b) => [a[0] - b[0], a[1] - b[1]], csqrt = a => M.C.sqrt(a[0], a[1]);
  const polyFromRoots = rs => { let c = [[1, 0]]; for (const r of rs) { const n = c.map(x => x.slice()); n.push([0, 0]); for (let j = 1; j < n.length; j++) n[j] = csub(n[j], cmul(r, c[j - 1])); c = n; } return c.map(x => x[0]); };
  L.butter = (a, nout) => {
    const n = Math.round(S(a[0])), Wn = vec(a[1]); let type = strs(a)[0] || (Wn.length === 2 ? 'bandpass' : 'low');
    if (type === 'stop') type = 'bandstop'; if (type === 'high') type = 'high'; if (type === 'low') type = 'low';
    if (!(n >= 1) || Wn.some(w => !(w > 0 && w < 1))) fail('butter: order must be positive and cutoff frequencies must be between 0 and 1 (1 = Nyquist).');
    let p = Array.from({ length: n }, (_, k) => { const th = Math.PI * (2 * k + n + 1) / (2 * n); return [Math.cos(th), Math.sin(th)]; }), z = [], k = 1;
    const fs2 = 4, warp = w => 4 * Math.tan(Math.PI * w / 2), prod = arr => arr.reduce((s, x) => cmul(s, x), [1, 0]);
    if (type === 'low') { const wo = warp(Wn[0]); p = p.map(x => [x[0] * wo, x[1] * wo]); k = Math.pow(wo, n); }
    else if (type === 'high') { const wo = warp(Wn[0]); k = prod(p.map(x => [-x[0], -x[1]])); k = cdiv([1, 0], k)[0]; p = p.map(x => cdiv([wo, 0], x)); z = Array.from({ length: n }, () => [0, 0]); }
    else {
      if (Wn.length !== 2) fail(`butter: '${type}' needs two cutoff frequencies [w1 w2].`);
      const w1 = warp(Wn[0]), w2 = warp(Wn[1]), bw = w2 - w1, wo = Math.sqrt(w1 * w2);
      if (type === 'bandpass') { const pl = p.map(x => [x[0] * bw / 2, x[1] * bw / 2]); p = []; for (const q of pl) { const s = csqrt(csub(cmul(q, q), [wo * wo, 0])); p.push(cadd(q, s), csub(q, s)); } z = Array.from({ length: n }, () => [0, 0]); k = Math.pow(bw, n); }
      else if (type === 'bandstop') { k = cdiv([1, 0], prod(p.map(x => [-x[0], -x[1]])))[0]; const ph = p.map(x => cdiv([bw / 2, 0], x)); p = []; for (const q of ph) { const s = csqrt(csub(cmul(q, q), [wo * wo, 0])); p.push(cadd(q, s), csub(q, s)); } z = []; for (let i = 0; i < n; i++) z.push([0, wo], [0, -wo]); }
      else fail(`butter: unknown filter type '${type}'. Use 'low', 'high', 'bandpass' or 'stop'.`);
    }
    // bilinear transform
    const num_ = prod(z.map(x => csub([fs2, 0], x))), den = prod(p.map(x => csub([fs2, 0], x)));
    const kz = k * cdiv(num_, den)[0];
    const zz = z.map(x => cdiv(cadd([fs2, 0], x), csub([fs2, 0], x))), pz = p.map(x => cdiv(cadd([fs2, 0], x), csub([fs2, 0], x)));
    while (zz.length < pz.length) zz.push([-1, 0]);
    const b = polyFromRoots(zz).map(c => c * kz), aa = polyFromRoots(pz);
    const clean = v => v.map(x => Math.abs(x) < 1e-14 ? 0 : x);
    return [rowOut(clean(b)), rowOut(clean(aa))];
  };
  function filterZi(b, a, x, zi) { const n = b.length, z = zi.slice(), y = new Array(x.length); for (let k = 0; k < x.length; k++) { const yk = b[0] * x[k] + (n > 1 ? z[0] : 0); for (let i = 1; i < n; i++) z[i - 1] = b[i] * x[k] + (i < n - 1 ? z[i] : 0) - a[i] * yk; y[k] = yk; } return y; }
  L.filtfilt = a => {
    let b = vec(a[0]), aa = vec(a[1]); const X = N(a[2]);
    b = b.map(v => v / aa[0]); aa = aa.map(v => v / aa[0]); const n = Math.max(b.length, aa.length); while (b.length < n) b.push(0); while (aa.length < n) aa.push(0);
    // steady-state initial conditions (as scipy's lfilter_zi) so the ends don't ring
    let zi = [];
    if (n > 1) { const m = n - 1, A = new Mat(m, m), B = new Mat(m, 1); for (let i = 0; i < m; i++) { A.re[i + i * m] += 1; A.re[i + 0 * m] += aa[i + 1]; if (i + 1 < m) A.re[i + (i + 1) * m] -= 1; B.re[i] = b[i + 1] - aa[i + 1] * b[0]; } zi = Array.from(LA.solve(A, B).X.re); }
    const nf = 3 * (n - 1);
    const run = v => {
      if (v.length <= nf) fail(`filtfilt: the signal must be longer than ${nf} samples for this filter.`);
      const ext = [...v.slice(1, nf + 1).reverse().map(x => 2 * v[0] - x), ...v, ...v.slice(v.length - nf - 1, v.length - 1).reverse().map(x => 2 * v[v.length - 1] - x)];
      let y = filterZi(b, aa, ext, zi.map(z => z * ext[0])); y.reverse(); y = filterZi(b, aa, y, zi.map(z => z * y[0])); y.reverse();
      return y.slice(nf, nf + v.length);
    };
    if (X.r === 1 || X.c === 1) return shapeLike(X, run(Array.from(X.re)));
    return along(X, 1, run);
  };
  L.freqz = (a, nout, In) => {
    const b = vec(a[0]), aa = a.length > 1 && a[1].n ? vec(a[1]) : [1], n = a.length > 2 ? S(a[2]) : 512, fs = a.length > 3 ? S(a[3]) : null;
    const H = new Mat(n, 1, null, new Float64Array(n)), w = new Array(n);
    for (let k = 0; k < n; k++) {
      const om = Math.PI * k / n; w[k] = fs ? om / (2 * Math.PI) * fs : om;
      const ev = c => { let re = 0, im = 0; c.forEach((v, j) => { re += v * Math.cos(-om * j); im += v * Math.sin(-om * j); }); return [re, im]; };
      const h = cdiv(ev(b), ev(aa)); H.re[k] = h[0]; H.im[k] = h[1];
    }
    if (nout > 0) return [M.narrow(H), colOut(w)];
    const mag = Array.from(H.re, (r, k) => 20 * Math.log10(Math.hypot(r, H.im[k]) || 1e-300)), ph = Array.from(H.re, (r, k) => Math.atan2(H.im[k], r) * 180 / Math.PI);
    const x = fs ? w : w.map(v => v / Math.PI), xl = M.str(fs ? 'Frequency (Hz)' : 'Normalized frequency (×π rad/sample)');
    const G = In.lib;
    G.subplot([num(2), num(1), num(1)]); G.plot([rowOut(x), rowOut(mag)], 0); G.grid([M.str('on')]); G.ylabel([M.str('Magnitude (dB)')]); G.xlabel([xl]);
    G.subplot([num(2), num(1), num(2)]); G.plot([rowOut(x), rowOut(unwrapDeg(ph))], 0); G.grid([M.str('on')]); G.ylabel([M.str('Phase (degrees)')]); G.xlabel([xl]);
    void In;
  };
  const unwrapDeg = ph => { const o = ph.slice(); for (let i = 1; i < o.length; i++) { let d = o[i] - o[i - 1]; while (d > 180) { o[i] -= 360; d -= 360; } while (d < -180) { o[i] += 360; d += 360; } } return o; };
  L.unwrap = a => { const X = N(a[0]); return along(X, defDim(X), v => { const o = v.slice(); for (let i = 1; i < o.length; i++) { let d = o[i] - o[i - 1]; while (d > Math.PI) { o[i] -= 2 * Math.PI; d -= 2 * Math.PI; } while (d < -Math.PI) { o[i] += 2 * Math.PI; d += 2 * Math.PI; } } return o; }); };
  L.findpeaks = (a, nout, In) => {
    const Y = N(a[0]); let xs = null, k0 = 1;
    if (a.length > 1 && !isStr(a[1])) { xs = vec(a[1]); k0 = 2; }
    const y = Array.from(Y.re), n = y.length, o = opts(a, k0), get = (k, d) => o[k] ? S(o[k]) : d;
    const minH = get('minpeakheight', -Infinity), minD = get('minpeakdistance', 0), minP = get('minpeakprominence', 0), thr = get('threshold', 0), np = get('npeaks', Infinity);
    const sortStr = o.sortstr ? Str(o.sortstr).toLowerCase() : 'none';
    // local maxima; a flat top counts once, at its left edge
    let peaks = [];
    for (let i = 1; i < n - 1; i++) {
      if (!(y[i] > y[i - 1])) continue;
      let j = i; while (j + 1 < n && y[j + 1] === y[i]) j++;
      if (j + 1 < n && y[j + 1] < y[i] && y[i] - y[i - 1] >= thr && y[i] - y[j + 1] >= thr) peaks.push(i);
      i = j;
    }
    const prom = i => { let lmin = y[i], rmin = y[i]; for (let k = i - 1; k >= 0 && y[k] <= y[i]; k--) lmin = Math.min(lmin, y[k]); for (let k = i + 1; k < n && y[k] <= y[i]; k++) rmin = Math.min(rmin, y[k]); return y[i] - Math.max(lmin, rmin); };
    peaks = peaks.filter(i => y[i] >= minH);
    let P = new Map(peaks.map(i => [i, prom(i)]));
    peaks = peaks.filter(i => P.get(i) >= minP);
    const xAt = i => xs ? xs[i] : i + 1;
    if (minD > 0) { // keep the tallest peaks, drop neighbours that are too close
      const byHeight = peaks.slice().sort((p, q) => y[q] - y[p]), keep = [];
      for (const i of byHeight) if (keep.every(j => Math.abs(xAt(i) - xAt(j)) >= minD)) keep.push(i);
      peaks = keep.sort((p, q) => p - q);
    }
    if (sortStr === 'descend') peaks.sort((p, q) => y[q] - y[p]); else if (sortStr === 'ascend') peaks.sort((p, q) => y[p] - y[q]);
    peaks = peaks.slice(0, np);
    const width = i => { const ref = y[i] - P.get(i) / 2, at = (k1, k2) => xAt(k1) + (ref - y[k1]) / (y[k2] - y[k1]) * (xAt(k2) - xAt(k1)); let l = i; while (l > 0 && y[l] > ref) l--; let r = i; while (r < n - 1 && y[r] > ref) r++; return (y[r] <= ref ? at(r - 1, r) : xAt(r)) - (y[l] <= ref ? at(l, l + 1) : xAt(l)); };
    const shape = arr => Y.r === 1 ? rowOut(arr) : colOut(arr);
    if (nout === 0) { const G = In.lib, xv = y.map((_, i) => xAt(i)); G.plot([rowOut(xv), rowOut(y)], 0); G.hold([M.str('on')]); G.plot([rowOut(peaks.map(xAt)), rowOut(peaks.map(i => y[i])), M.str('v'), M.str('MarkerFaceColor'), M.str('r'), M.str('Color'), M.str('r')], 0); G.hold([M.str('off')]); return; }
    return [shape(peaks.map(i => y[i])), shape(peaks.map(xAt)), shape(peaks.map(width)), shape(peaks.map(i => P.get(i)))];
  };
  L.xcorr = (a, nout) => {
    const x = vec(a[0]), y = a.length > 1 && !isStr(a[1]) && a[1].n > 1 ? vec(a[1]) : x, rest = a.slice(y === x && !(a.length > 1 && !isStr(a[1]) && a[1].n > 1) ? 1 : 2);
    const N_ = Math.max(x.length, y.length), maxlag = rest.find(v => !isStr(v)) ? S(rest.find(v => !isStr(v))) : N_ - 1, scale = strs(rest)[0] || 'none';
    while (x.length < N_) x.push(0); while (y.length < N_) y.push(0);
    let m = 1; while (m < 2 * N_ - 1) m <<= 1;
    const xr = new Float64Array(m), yr = new Float64Array(m); xr.set(x); yr.set(y);
    const [Xr, Xi] = Nu.fft1(xr, new Float64Array(m), false), [Yr, Yi] = Nu.fft1(yr, new Float64Array(m), false);
    const pr = new Float64Array(m), pi = new Float64Array(m); for (let k = 0; k < m; k++) { pr[k] = Xr[k] * Yr[k] + Xi[k] * Yi[k]; pi[k] = Xi[k] * Yr[k] - Xr[k] * Yi[k]; }
    const [cr] = Nu.fft1(pr, pi, true);
    const lags = [], r = [];
    for (let l = -maxlag; l <= maxlag; l++) { lags.push(l); let v = cr[(l + m) % m] / m; if (scale === 'biased') v /= N_; else if (scale === 'unbiased') v /= N_ - Math.abs(l); r.push(Math.abs(v) < 1e-12 * N_ ? Math.round(v) : v); }
    if (scale === 'normalized' || scale === 'coeff') { const ex = x.reduce((s, v) => s + v * v, 0), ey = y.reduce((s, v) => s + v * v, 0), d = Math.sqrt(ex * ey) || 1; for (let i = 0; i < r.length; i++) r[i] /= d; }
    const out = a[0].c === 1 && a[0].r > 1 ? colOut(r) : rowOut(r);
    return nout > 1 ? [out, rowOut(lags)] : out;
  };

  // ---------- optimization ----------
  const vecFn = (In, f, X0) => x => { const r = In.fcall(f, [new Mat(X0.r, X0.c, Float64Array.from(x))]); if (r.type !== 'num') fail('The function must return numbers.'); return Array.from(r.re); };
  function jacobian(F, x, fx) { const J = []; for (let j = 0; j < x.length; j++) { const h = 1.4901161193847656e-8 * Math.max(1, Math.abs(x[j])), xp = x.slice(); xp[j] += h; const fp = F(xp); J.push(fp.map((v, i) => (v - fx[i]) / h)); } return fx.map((_, i) => J.map(col => col[i])); } // rows = residuals
  const nrm2 = v => Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  function solveDense(A, b) { const m = A.length; const r = LA.solve(M.fromRows(A), M.colVec(b)); void m; return Array.from(r.X.re); }
  function optGet(a, k, name, d) { const o = a[k]; if (!o || o.type !== 'struct') return d; for (const [nm, v] of o.f) if (nm.toLowerCase() === name && v.type === 'num' && v.n) return v.re[0]; return d; }
  L.fsolve = (a, nout, In) => {
    const X0 = N(a[1]), F = vecFn(In, a[0], X0), tol = optGet(a, 2, 'tolfun', 1e-10), maxIt = optGet(a, 2, 'maxiter', 400);
    let x = Array.from(X0.re), fx = F(x), it = 0, flag = 1;
    for (; it < maxIt && nrm2(fx) > tol; it++) {
      In.tick();
      const J = jacobian(F, x, fx);
      let dx;
      try { dx = J.length === x.length ? solveDense(J, fx.map(v => -v)) : Array.from(LA.lstsq(M.fromRows(J), M.colVec(fx.map(v => -v))).X.re); } catch (e) { flag = -2; break; }
      if (dx.some(v => !isFinite(v))) { // singular Jacobian: take a small gradient step
        dx = x.map((_, j) => -J.reduce((s, row, i) => s + row[j] * fx[i], 0) * 1e-3);
      }
      let t = 1, f0 = nrm2(fx), xn, fn;
      for (let k = 0; k < 30; k++) { xn = x.map((v, j) => v + t * dx[j]); fn = F(xn); if (nrm2(fn) < f0 || k === 29) break; t /= 2; }
      if (nrm2(xn.map((v, j) => v - x[j])) < 1e-15 * (1 + nrm2(x))) { x = xn; fx = fn; break; }
      x = xn; fx = fn;
    }
    if (nrm2(fx) > Math.sqrt(tol) && flag === 1) { flag = 0; In.warn('fsolve stopped before the equations were solved to the requested accuracy.'); }
    const X = new Mat(X0.r, X0.c, Float64Array.from(x)), Fv = shapeLike(a[1].r === 1 && fx.length === x.length ? X0 : M.colVec(fx), fx);
    return nout > 1 ? [X, Fv, num(flag)] : X;
  };
  // Levenberg–Marquardt on a residual function r(p)
  function levmar(In, R, p0, maxIt = 400) {
    let p = p0.slice(), r = R(p), lam = 1e-3, cost = r.reduce((s, v) => s + v * v, 0);
    for (let it = 0; it < maxIt; it++) {
      In.tick();
      const J = jacobian(R, p, r), n = p.length, JtJ = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => J.reduce((s, row) => s + row[i] * row[j], 0))), g = Array.from({ length: n }, (_, i) => J.reduce((s, row, k) => s + row[i] * r[k], 0));
      let improved = false;
      for (let k = 0; k < 20; k++) {
        const A = JtJ.map((row, i) => row.map((v, j) => v + (i === j ? lam * (JtJ[i][i] || 1) : 0)));
        let dp; try { dp = solveDense(A, g.map(v => -v)); } catch (e) { lam *= 10; continue; }
        const pn = p.map((v, i) => v + dp[i]), rn = R(pn), cn = rn.reduce((s, v) => s + v * v, 0);
        if (cn < cost) { const rel = (cost - cn) / Math.max(cost, 1e-300); p = pn; r = rn; cost = cn; lam = Math.max(lam / 10, 1e-12); improved = true; if (rel < 1e-14 || nrm2(dp) < 1e-12 * (1 + nrm2(p))) return { p, r, cost }; break; }
        lam *= 10;
      }
      if (!improved) break;
    }
    return { p, r, cost };
  }
  L.lsqcurvefit = (a, nout, In) => {
    const f = a[0], P0 = N(a[1]), xdata = a[2], ydata = vec(a[3]);
    const R = p => { const v = In.fcall(f, [new Mat(P0.r, P0.c, Float64Array.from(p)), xdata]); if (v.type !== 'num' || v.n !== ydata.length) fail('lsqcurvefit: the model must return one value per data point.'); return Array.from(v.re, (y, i) => y - ydata[i]); };
    const { p, r, cost } = levmar(In, R, Array.from(P0.re));
    const P = new Mat(P0.r, P0.c, Float64Array.from(p));
    return nout > 1 ? [P, num(cost), shapeLike(a[3], r)] : P;
  };
  L.lsqnonlin = (a, nout, In) => { const X0 = N(a[1]), R = vecFn(In, a[0], X0), { p, r, cost } = levmar(In, R, Array.from(X0.re)); const X = new Mat(X0.r, X0.c, Float64Array.from(p)); return nout > 1 ? [X, num(cost), colOut(r)] : X; };
  L.fminunc = (a, nout, In) => { // BFGS with a numerical gradient and backtracking line search
    const X0 = N(a[1]), F = x => { const v = In.fcall(a[0], [new Mat(X0.r, X0.c, Float64Array.from(x))]); if (v.type !== 'num' || v.n < 1) fail('fminunc: the function must return a scalar.'); return v.re[0]; };
    const n = X0.n, grad = (x, fx) => x.map((v, j) => { const h = 1.4901161193847656e-8 * Math.max(1, Math.abs(v)), xp = x.slice(), xm = x.slice(); xp[j] += h; xm[j] -= h; return (F(xp) - F(xm)) / (2 * h); });
    let x = Array.from(X0.re), fx = F(x), g = grad(x, fx), H = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0));
    for (let it = 0; it < 400 * Math.max(1, n) && nrm2(g) > 1e-8; it++) {
      In.tick();
      let d = H.map(row => -row.reduce((s, v, j) => s + v * g[j], 0)), slope = d.reduce((s, v, i) => s + v * g[i], 0);
      if (slope >= 0) { d = g.map(v => -v); slope = -g.reduce((s, v) => s + v * v, 0); H = H.map((row, i) => row.map((_, j) => i === j ? 1 : 0)); }
      let t = 1, xn, fn; for (let k = 0; k < 40; k++) { xn = x.map((v, i) => v + t * d[i]); fn = F(xn); if (fn <= fx + 1e-4 * t * slope) break; t /= 2; }
      if (!(fn < fx) && Math.abs(fn - fx) < 1e-15 * (1 + Math.abs(fx))) break;
      const gn = grad(xn, fn), s = xn.map((v, i) => v - x[i]), y = gn.map((v, i) => v - g[i]), sy = s.reduce((acc, v, i) => acc + v * y[i], 0);
      if (sy > 1e-12) { const Hy = H.map(row => row.reduce((acc, v, j) => acc + v * y[j], 0)), yHy = y.reduce((acc, v, i) => acc + v * Hy[i], 0); H = H.map((row, i) => row.map((v, j) => v + ((sy + yHy) * s[i] * s[j]) / (sy * sy) - (Hy[i] * s[j] + s[i] * Hy[j]) / sy)); }
      if (Math.abs(fx - fn) < 1e-14 * (1 + Math.abs(fx)) && nrm2(s) < 1e-12) { x = xn; fx = fn; g = gn; break; }
      x = xn; fx = fn; g = gn;
    }
    const X = new Mat(X0.r, X0.c, Float64Array.from(x));
    return nout > 1 ? [X, num(fx), num(1)] : X;
  };

  // ---------- stiff ODEs: ode23s (modified Rosenbrock, Shampine & Reichelt) ----------
  L.ode23s = (a, nout, In) => {
    if (a.length < 3) fail('ode23s(f, [t0 tf], y0) needs a function, a time span and initial conditions.');
    const f = a[0], tspan = vec(a[1]), y0 = Array.from(N(a[2]).re), m = y0.length;
    let rtol = 1e-3, atol = 1e-6; if (a[3] && a[3].type === 'struct') for (const [k, v] of a[3].f) { if (/^reltol$/i.test(k)) rtol = v.re[0]; if (/^abstol$/i.test(k)) atol = v.re[0]; }
    const F = (t, y) => { const r = In.fcall(f, [num(t), M.colVec(y)]); if (r.type !== 'num' || r.n !== m) fail(`ode23s: the function must return ${m} value${m > 1 ? 's' : ''}.`); return Array.from(r.re); };
    const t0 = tspan[0], tf = tspan[tspan.length - 1], dir = Math.sign(tf - t0) || 1, span = Math.abs(tf - t0);
    const d = 1 / (2 + Math.SQRT2), e32 = 6 + Math.SQRT2;
    let t = t0, y = y0.slice(), F0 = F(t, y), h = Math.min(span / 10, 0.01 * span || 1e-3);
    { const sc = Math.max(...F0.map((v, i) => Math.abs(v) / Math.max(Math.abs(y[i]), atol / rtol))); if (sc > 0) h = Math.min(h, 0.8 * Math.pow(rtol, 1 / 3) / sc); }
    const tout = [t0], yout = [y0.slice()], fixed = tspan.length > 2; let next = 1, steps = 0;
    while (dir * (tf - t) > 0) {
      In.tick(); if (++steps > 100000) fail('ode23s: too many steps.');
      if (Math.abs(tf - t) < 1.1 * h) h = Math.abs(tf - t);
      const hs = dir * h;
      const J = jacobian(yy => F(t, yy), y, F0), dt = 1.4901161193847656e-8 * Math.max(1, Math.abs(t)), T = F(t + dt, y).map((v, i) => (v - F0[i]) / dt);
      const W = J.map((row, i) => row.map((v, j) => (i === j ? 1 : 0) - hs * d * v)), Wf = LA.lu(M.fromRows(W));
      const sol = b => { const n = b.length, A = Wf.a, x = Wf.piv.map(p => b[p]); for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) x[i] -= A[i][j] * x[j]; for (let i = n - 1; i >= 0; i--) { for (let j = i + 1; j < n; j++) x[i] -= A[i][j] * x[j]; x[i] /= A[i][i]; } return x; };
      const k1 = sol(F0.map((v, i) => v + hs * d * T[i]));
      const F1 = F(t + 0.5 * hs, y.map((v, i) => v + 0.5 * hs * k1[i]));
      const k2 = sol(F1.map((v, i) => v - k1[i])).map((v, i) => v + k1[i]);
      const yn = y.map((v, i) => v + hs * k2[i]), F2 = F(t + hs, yn);
      const k3 = sol(F2.map((v, i) => v - e32 * (k2[i] - F1[i]) - 2 * (k1[i] - F0[i]) + hs * d * T[i]));
      const err = Math.max(...k1.map((v, i) => Math.abs(hs / 6 * (v - 2 * k2[i] + k3[i])) / Math.max(atol, rtol * Math.max(Math.abs(y[i]), Math.abs(yn[i])))));
      if (!(err <= 1)) { h *= Math.max(0.1, 0.8 * Math.pow(err || 1e3, -1 / 3)); if (h < 16 * LA.EPS * Math.max(1, Math.abs(t))) fail('ode23s: unable to meet the tolerances (step size too small).'); continue; }
      const tn = t + hs;
      if (fixed) { while (next < tspan.length && dir * (tspan[next] - tn) <= 1e-12 * span) { const th = (tspan[next] - t) / hs, t2 = th * th, t3 = t2 * th; tout.push(tspan[next]); yout.push(y.map((v, i) => (2 * t3 - 3 * t2 + 1) * v + (t3 - 2 * t2 + th) * hs * F0[i] + (-2 * t3 + 3 * t2) * yn[i] + (t3 - t2) * hs * F2[i])); next++; } }
      else { tout.push(tn); yout.push(yn.slice()); }
      t = tn; y = yn; F0 = F2;
      h *= Math.min(5, 0.8 * Math.pow(Math.max(err, 1e-10), -1 / 3));
    }
    const Yo = new Mat(tout.length, m); yout.forEach((row, i) => row.forEach((v, j) => { Yo.re[i + j * tout.length] = v; }));
    if (nout <= 1) { const s = new Struct(); s.f.set('x', rowOut(tout)); s.f.set('y', M.transpose(Yo)); s.f.set('solver', str('ode23s')); return s; }
    return [colOut(tout), Yo];
  };
  L.ode15s = L.ode23s; L.ode23t = L.ode23s; L.ode23tb = L.ode23s;

  // ---------- file handles on the Current Folder ----------
  const handles = new Map(); let nextFid = 3;
  L.fopen = (a, nout, In) => {
    if (isStr(a[0]) && Str(a[0]) === 'all') return rowOut([...handles.keys()]);
    const name = Str(a[0]), mode = a.length > 1 ? Str(a[1]).replace(/[bt]/g, '') : 'r';
    if (mode[0] === 'r' && !In.files.has(name)) return nout > 1 ? [num(-1), str(`Unable to open '${name}': no such file in the Current Folder.`)] : num(-1);
    const text = mode[0] === 'w' ? '' : (In.files.get(name) || '');
    const fid = nextFid++; handles.set(fid, { name, mode, text, pos: 0, In });
    if (mode[0] === 'w') In.files.set(name, '');
    return nout > 1 ? [num(fid), str('')] : num(fid);
  };
  const handle = fid => { const h = handles.get(fid); if (!h) fail('Invalid file identifier. Use fopen to generate a valid file identifier.'); return h; };
  const flush = h => { h.In.files.set(h.name, h.text); if (h.In.host && h.In.host.filesChanged) h.In.host.filesChanged(); };
  L.fclose = a => { if (isStr(a[0]) && Str(a[0]) === 'all') { handles.forEach(h => { if (h.mode[0] !== 'r') flush(h); }); handles.clear(); return num(0); } const fid = S(a[0]), h = handle(fid); if (h.mode[0] !== 'r') flush(h); handles.delete(fid); return num(0); };
  const origPrintf = L.fprintf;
  L.fprintf = (a, nout, In) => {
    if (a.length && a[0].type === 'num' && a[0].cls !== 'char' && a[0].n === 1 && a[0].re[0] >= 3) {
      const h = handle(a[0].re[0]); if (h.mode[0] === 'r') fail('fprintf: the file was opened for reading.');
      const s = Lib.sprintf(Str(a[1]), a.slice(2)); h.text += s; flush(h); return nout > 0 ? num(s.length) : undefined;
    }
    return origPrintf(a, nout, In);
  };
  const readLine = (h, keep) => { if (h.pos >= h.text.length) return num(-1); let e = h.text.indexOf('\n', h.pos); if (e < 0) e = h.text.length - 1; const line = h.text.slice(h.pos, e + 1); h.pos = e + 1; return str(keep ? line : line.replace(/\r?\n$/, '')); };
  L.fgetl = a => readLine(handle(S(a[0])), false);
  L.fgets = a => readLine(handle(S(a[0])), true);
  L.feof = a => { const h = handle(S(a[0])); return M.bool(h.pos >= h.text.length); };
  L.frewind = a => { handle(S(a[0])).pos = 0; };
  L.fscanf = a => { // numbers only: fscanf(fid, '%f') or '%d'
    const h = handle(S(a[0])), rest = h.text.slice(h.pos); h.pos = h.text.length;
    const v = (rest.match(/[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?|[-+]?Inf|NaN/g) || []).map(Number);
    if (a.length > 2) { const sz = vec(a[2]); if (sz.length === 2 && isFinite(sz[0])) { const r = sz[0], c = isFinite(sz[1]) ? sz[1] : Math.ceil(v.length / r); const o = new Mat(r, c); o.re.set(v.slice(0, r * c)); return o; } }
    return colOut(v);
  };
  L.fwrite = (a, nout, In) => { const h = handle(S(a[0])); const v = a[1]; h.text += v.cls === 'char' ? Str(v) : Array.from(v.re, x => String.fromCharCode(x & 255)).join(''); flush(h); void In; };
  L.__closeAllFiles = () => { handles.clear(); };

  const api = { pct, probit };
  if (node) module.exports = api; else root.LabToolbox = api;
})(typeof self !== 'undefined' ? self : this);
