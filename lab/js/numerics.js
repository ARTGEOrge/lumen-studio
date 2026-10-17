// Lumen Lab — numerical methods: FFT (radix-2 + Bluestein), filter/conv, polynomials, interpolation
// (linear/nearest/spline/pchip), ODE solvers (Dormand–Prince ode45, Bogacki–Shampine ode23),
// fzero (Brent), fminsearch (Nelder–Mead), fminbnd, integral (adaptive Gauss–Kronrod).
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const M = node ? require('./mat.js') : root.LabMat;
  const LA = node ? require('./linalg.js') : root.LabLinalg;
  const I = node ? require('./interp.js') : root.LabInterp;
  const Lib = node ? require('./lib.js') : root.LabLib;
  const { Mat, fail, num } = M;
  const { Struct } = I;
  const { L, N, S, Str, isStr, vec } = Lib;
  const rowOut = a => M.rowVec(a), colOut = a => M.colVec(a);

  // ---------- FFT ----------
  function fftPow2(re, im, inv) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (inv ? 2 : -2) * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }
  function fft1(re, im, inv) { // returns new arrays
    const n = re.length; if (n <= 1) return [Float64Array.from(re), Float64Array.from(im)];
    if ((n & (n - 1)) === 0) { const r = Float64Array.from(re), i = Float64Array.from(im); fftPow2(r, i, inv); return [r, i]; }
    // Bluestein's chirp-z for any length
    let m = 1; while (m < 2 * n - 1) m <<= 1;
    const s = inv ? 1 : -1, wr = new Float64Array(n), wi = new Float64Array(n);
    for (let k = 0; k < n; k++) { const a = s * Math.PI * ((k * k) % (2 * n)) / n; wr[k] = Math.cos(a); wi[k] = Math.sin(a); }
    const ar = new Float64Array(m), ai = new Float64Array(m), br = new Float64Array(m), bi = new Float64Array(m);
    for (let k = 0; k < n; k++) { ar[k] = re[k] * wr[k] - im[k] * wi[k]; ai[k] = re[k] * wi[k] + im[k] * wr[k]; }
    br[0] = wr[0]; bi[0] = -wi[0];
    for (let k = 1; k < n; k++) { br[k] = br[m - k] = wr[k]; bi[k] = bi[m - k] = -wi[k]; }
    fftPow2(ar, ai, false); fftPow2(br, bi, false);
    for (let k = 0; k < m; k++) { const r = ar[k] * br[k] - ai[k] * bi[k]; ai[k] = ar[k] * bi[k] + ai[k] * br[k]; ar[k] = r; }
    fftPow2(ar, ai, true);
    const or = new Float64Array(n), oi = new Float64Array(n);
    for (let k = 0; k < n; k++) { const xr = ar[k] / m, xi = ai[k] / m; or[k] = xr * wr[k] - xi * wi[k]; oi[k] = xr * wi[k] + xi * wr[k]; }
    return [or, oi];
  }
  function fftMat(a, inv) {
    const X = N(a[0], inv ? 'ifft' : 'fft');
    const isRow = X.r === 1;
    let n = a.length > 1 && a[1].n ? S(a[1]) : (isRow ? X.c : X.r);
    const dim = a.length > 2 ? S(a[2]) : (isRow ? 2 : 1);
    const len = dim === 2 ? X.c : X.r, count = dim === 2 ? X.r : X.c;
    const outR = dim === 2 ? X.r : n, outC = dim === 2 ? n : X.c, O = new Mat(outR, outC, null, new Float64Array(outR * outC));
    let allSym = inv;
    for (let t = 0; t < count; t++) {
      const re = new Float64Array(n), im = new Float64Array(n);
      for (let k = 0; k < Math.min(n, len); k++) { const s = dim === 2 ? t + k * X.r : k + t * X.r; re[k] = X.re[s]; im[k] = X.im ? X.im[s] : 0; }
      if (inv && allSym) { let scale = 0; for (let k = 0; k < n; k++) scale = Math.max(scale, Math.abs(re[k]), Math.abs(im[k])); const tol = 1e-12 * scale; for (let k = 1; k < n && allSym; k++) if (Math.abs(re[k] - re[n - k]) > tol || Math.abs(im[k] + im[n - k]) > tol) allSym = false; if (Math.abs(im[0]) > tol || (n % 2 === 0 && Math.abs(im[n / 2]) > tol)) allSym = false; }
      const [r, i] = fft1(re, im, inv);
      if (!inv && !X.im) { // a real signal has a conjugate-symmetric spectrum: make it exact
        i[0] = 0; if (n % 2 === 0) i[n / 2] = 0;
        for (let k = 1; k < (n + 1) / 2; k++) { const ar = (r[k] + r[n - k]) / 2, ai = (i[k] - i[n - k]) / 2; r[k] = r[n - k] = ar; i[k] = ai; i[n - k] = -ai; }
      }
      for (let k = 0; k < n; k++) { const d = dim === 2 ? t + k * outR : k + t * outR; O.re[d] = inv ? r[k] / n : r[k]; O.im[d] = inv ? i[k] / n : i[k]; }
    }
    if (inv && allSym) O.im = null;
    return inv ? M.narrow(O) : O;
  }
  L.fft = a => fftMat(a, false);
  L.ifft = a => fftMat(a.filter(x => !isStr(x)), true);
  const shift = (a, inv) => { const X = N(a[0]), isRow = X.r === 1, n = isRow ? X.c : X.r, k = inv ? -Math.floor(n / 2) : Math.floor(n / 2); return L.circshift([X, num(k), num(isRow ? 2 : 1)]); };
  L.fftshift = a => shift(a, false); L.ifftshift = a => shift(a, true);
  L.fft2 = a => { const X = N(a[0]); const A = fftMat([X, num(X.r), num(1)], false); return fftMat([A, num(X.c), num(2)], false); };
  L.ifft2 = a => { const X = N(a[0]); const A = fftMat([X, num(X.r), num(1)], true); return fftMat([A, num(X.c), num(2)], true); };

  // ---------- filtering & convolution ----------
  L.filter = a => {
    let b = vec(a[0]), aa = vec(a[1]); const X = N(a[2]);
    if (!aa[0]) fail('First denominator filter coefficient must be non-zero.');
    b = b.map(x => x / aa[0]); aa = aa.map(x => x / aa[0]);
    const n = Math.max(b.length, aa.length); while (b.length < n) b.push(0); while (aa.length < n) aa.push(0);
    const run = x => { const z = new Array(n).fill(0), y = new Array(x.length); for (let k = 0; k < x.length; k++) { const yk = b[0] * x[k] + z[0]; for (let i = 1; i < n; i++) z[i - 1] = b[i] * x[k] + z[i] - aa[i] * yk; y[k] = yk; } return y; };
    if (X.r === 1 || X.c === 1) { const y = run(Array.from(X.re)); return X.r === 1 ? rowOut(y) : colOut(y); }
    const O = new Mat(X.r, X.c); for (let j = 0; j < X.c; j++) { const y = run(Array.from(X.re.subarray(j * X.r, (j + 1) * X.r))); O.re.set(y, j * X.r); } return O;
  };
  function convArr(u, v) { const o = new Array(u.length + v.length - 1).fill(0); for (let i = 0; i < u.length; i++) for (let j = 0; j < v.length; j++) o[i + j] += u[i] * v[j]; return o; }
  L.conv = a => {
    const U = N(a[0]), V = N(a[1]), u = vec(U), v = vec(V); if (!u.length || !v.length) return M.empty();
    let o = convArr(u, v); const shape = a.length > 2 ? Str(a[2]) : 'full';
    if (shape === 'same') { const s = Math.floor(v.length / 2); o = o.slice(s, s + u.length); }
    else if (shape === 'valid') o = u.length >= v.length ? o.slice(v.length - 1, u.length) : [];
    return (U.c === 1 && U.r > 1) || (V.c === 1 && V.r > 1 && U.n === 1) ? colOut(o) : rowOut(o);
  };
  L.deconv = a => {
    const b = vec(a[0]), d = vec(a[1]); if (!d.length || d[0] === 0) fail('First coefficient of the divisor must be non-zero.');
    if (b.length < d.length) return [num(0), a[0]];
    const q = new Array(b.length - d.length + 1).fill(0), r = b.slice();
    for (let i = 0; i < q.length; i++) { q[i] = r[i] / d[0]; for (let j = 0; j < d.length; j++) r[i + j] -= q[i] * d[j]; }
    return [rowOut(q), rowOut(r)];
  };

  // ---------- polynomials ----------
  L.polyval = a => {
    const p = vec(a[0]), X = N(a[1]);
    if (X.im) { const o = new Mat(X.r, X.c, null, new Float64Array(X.n)); for (let k = 0; k < X.n; k++) { let yr = 0, yi = 0; for (const c of p) { const r = yr * X.re[k] - yi * X.im[k] + c; yi = yr * X.im[k] + yi * X.re[k]; yr = r; } o.re[k] = yr; o.im[k] = yi; } return M.narrow(o); }
    return M.map(X, x => { let y = 0; for (const c of p) y = y * x + c; return y; });
  };
  L.polyfit = (a, nout) => {
    const x = vec(a[0]), y = vec(a[1]), n = S(a[2]);
    if (x.length !== y.length) fail('The first two inputs must have the same number of elements.');
    const V = new Mat(x.length, n + 1); for (let i = 0; i < x.length; i++) for (let j = 0; j <= n; j++) V.re[i + j * x.length] = Math.pow(x[i], n - j);
    const { X } = LA.lstsq(V, colOut(y));
    const p = rowOut(Array.from(X.re));
    if (nout > 1) { const S2 = new Struct(); const res = M.minus(M.mtimes(V, X), colOut(y)); S2.f.set('normr', L.norm([res])); S2.f.set('df', num(Math.max(0, x.length - n - 1))); return [p, S2]; }
    return p;
  };
  L.roots = a => {
    let c = vec(a[0]); while (c.length && c[0] === 0) c.shift();
    let zeros = 0; while (c.length && c[c.length - 1] === 0) { c.pop(); zeros++; }
    const n = c.length - 1;
    if (n < 1) return zeros ? colOut(new Array(zeros).fill(0)) : new Mat(0, 1);
    const A = new Mat(n, n); for (let j = 0; j < n; j++) A.re[0 + j * n] = -c[j + 1] / c[0]; for (let i = 1; i < n; i++) A.re[i + (i - 1) * n] = 1;
    const e = L.eig([A], 1);
    if (!zeros) return e;
    const o = new Mat(n + zeros, 1, null, e.im ? new Float64Array(n + zeros) : null); o.re.set(e.re); if (e.im) o.im.set(e.im); return o;
  };
  L.poly = a => {
    const A = N(a[0]); let rr, ri;
    if (A.r === A.c && A.r > 1) { const e = L.eig([A], 1); rr = Array.from(e.re); ri = e.im ? Array.from(e.im) : rr.map(() => 0); }
    else { rr = Array.from(A.re); ri = A.im ? Array.from(A.im) : rr.map(() => 0); }
    let cr = [1], ci = [0];
    for (let k = 0; k < rr.length; k++) { const nr = cr.concat(0), ni = ci.concat(0); for (let j = 1; j < nr.length; j++) { nr[j] -= rr[k] * cr[j - 1] - ri[k] * ci[j - 1]; ni[j] -= rr[k] * ci[j - 1] + ri[k] * cr[j - 1]; } cr = nr; ci = ni; }
    const scale = Math.max(1, ...cr.map(Math.abs));
    if (ci.every(v => Math.abs(v) < 1e-10 * scale)) return rowOut(cr);
    return M.narrow(new Mat(1, cr.length, Float64Array.from(cr), Float64Array.from(ci)));
  };
  L.polyder = a => { if (a.length > 1) return L.polyder([L.conv([a[0], a[1]])]); const p = vec(a[0]), n = p.length - 1; if (n < 1) return num(0); return rowOut(p.slice(0, n).map((c, i) => c * (n - i))); };
  L.polyint = a => { const p = vec(a[0]), k = a.length > 1 ? S(a[1]) : 0, n = p.length; return rowOut(p.map((c, i) => c / (n - i)).concat(k)); };

  // ---------- interpolation ----------
  function hermite(x, y, d, xq) { // piecewise cubic Hermite evaluation (sorted x)
    const n = x.length;
    let k = 0, lo = 0, hi = n - 2;
    if (xq <= x[0]) k = 0; else if (xq >= x[n - 1]) k = n - 2; else { while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (x[mid] <= xq) lo = mid; else hi = mid - 1; } k = lo; }
    const h = x[k + 1] - x[k], t = (xq - x[k]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * y[k] + (t3 - 2 * t2 + t) * h * d[k] + (-2 * t3 + 3 * t2) * y[k + 1] + (t3 - t2) * h * d[k + 1];
  }
  function splineSlopes(x, y) { // not-a-knot end conditions (as MATLAB's spline)
    const n = x.length, dx = [], dd = [];
    for (let i = 0; i < n - 1; i++) { dx.push(x[i + 1] - x[i]); dd.push((y[i + 1] - y[i]) / dx[i]); }
    if (n === 2) return [dd[0], dd[0]];
    if (n === 3) { // the not-a-knot spline through 3 points is the parabola
      const c2 = (dd[1] - dd[0]) / (x[2] - x[0]); return [dd[0] - c2 * dx[0], dd[0] + c2 * dx[0], dd[1] + c2 * dx[1]];
    }
    const sub = new Array(n).fill(0), dia = new Array(n).fill(0), sup = new Array(n).fill(0), b = new Array(n).fill(0);
    const x31 = x[2] - x[0], xn = x[n - 1] - x[n - 3];
    dia[0] = dx[1]; sup[0] = x31; b[0] = ((dx[0] + 2 * x31) * dx[1] * dd[0] + dx[0] * dx[0] * dd[1]) / x31;
    for (let i = 1; i < n - 1; i++) { sub[i] = dx[i]; dia[i] = 2 * (dx[i] + dx[i - 1]); sup[i] = dx[i - 1]; b[i] = 3 * (dx[i] * dd[i - 1] + dx[i - 1] * dd[i]); }
    sub[n - 1] = xn; dia[n - 1] = dx[n - 3]; b[n - 1] = (dx[n - 2] * dx[n - 2] * dd[n - 3] + (2 * xn + dx[n - 2]) * dx[n - 3] * dd[n - 2]) / xn;
    for (let i = 1; i < n; i++) { const m = sub[i] / dia[i - 1]; dia[i] -= m * sup[i - 1]; b[i] -= m * b[i - 1]; }
    const s = new Array(n); s[n - 1] = b[n - 1] / dia[n - 1]; for (let i = n - 2; i >= 0; i--) s[i] = (b[i] - sup[i] * s[i + 1]) / dia[i];
    return s;
  }
  function pchipSlopes(x, y) {
    const n = x.length, h = [], del = [];
    for (let i = 0; i < n - 1; i++) { h.push(x[i + 1] - x[i]); del.push((y[i + 1] - y[i]) / h[i]); }
    const d = new Array(n).fill(0);
    if (n === 2) return [del[0], del[0]];
    for (let k = 1; k < n - 1; k++) if (del[k - 1] * del[k] > 0) { const w1 = 2 * h[k] + h[k - 1], w2 = h[k] + 2 * h[k - 1]; d[k] = (w1 + w2) / (w1 / del[k - 1] + w2 / del[k]); }
    const endSlope = (h1, h2, d1, d2) => { let s = ((2 * h1 + h2) * d1 - h1 * d2) / (h1 + h2); if (Math.sign(s) !== Math.sign(d1)) s = 0; else if (Math.sign(d1) !== Math.sign(d2) && Math.abs(s) > Math.abs(3 * d1)) s = 3 * d1; return s; };
    d[0] = endSlope(h[0], h[1], del[0], del[1]); d[n - 1] = endSlope(h[n - 2], h[n - 3], del[n - 2], del[n - 3]);
    return d;
  }
  function interp1(x, y, Xq, method, extrap) {
    const n = x.length; if (n !== y.length) fail('The grid vectors and the values must have the same length.');
    if (n < 2) fail('Interpolation requires at least two sample points.');
    // sort by x
    const order = [...x.keys()].sort((p, q) => x[p] - x[q]); x = order.map(i => x[i]); y = order.map(i => y[i]);
    for (let i = 1; i < n; i++) if (x[i] === x[i - 1]) fail('The grid vectors must contain unique points.');
    let d = null;
    if (method === 'spline') d = splineSlopes(x, y); else if (method === 'pchip' || method === 'cubic') d = pchipSlopes(x, y);
    const ex = extrap !== undefined ? extrap : (method === 'spline' || method === 'pchip' || method === 'cubic' ? 'extrap' : NaN);
    return M.map(Xq, q => {
      if (Number.isNaN(q)) return NaN;
      if (q < x[0] || q > x[n - 1]) { if (ex !== 'extrap') return ex; }
      if (method === 'nearest') { let best = 0; for (let i = 1; i < n; i++) if (Math.abs(x[i] - q) < Math.abs(x[best] - q) || (Math.abs(x[i] - q) === Math.abs(x[best] - q) && x[i] > x[best])) best = i; return y[best]; }
      if (method === 'previous') { let k = -1; for (let i = 0; i < n; i++) if (x[i] <= q) k = i; return k < 0 ? NaN : y[k]; }
      if (method === 'next') { for (let i = 0; i < n; i++) if (x[i] >= q) return y[i]; return NaN; }
      if (d) return hermite(x, y, d, q);
      let k = 0; if (q >= x[n - 1]) k = n - 2; else { let lo = 0, hi = n - 2; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (x[mid] <= q) lo = mid; else hi = mid - 1; } k = lo; }
      const t = (q - x[k]) / (x[k + 1] - x[k]); return y[k] + t * (y[k + 1] - y[k]);
    });
  }
  L.interp1 = a => {
    let x, Y, Xq, rest;
    if (a.length === 2 || (a.length >= 3 && isStr(a[2]))) { Y = N(a[0]); Xq = N(a[1]); x = Y.r === 1 || Y.c === 1 ? Array.from({ length: Y.n }, (_, i) => i + 1) : null; rest = a.slice(2); }
    else { x = vec(a[0]); Y = N(a[1]); Xq = N(a[2]); rest = a.slice(3); }
    let method = 'linear', extrap;
    for (const r of rest) { if (isStr(r)) { const s = Str(r).toLowerCase().replace(/^\*/, ''); if (s === 'extrap') extrap = 'extrap'; else method = s === 'v5cubic' ? 'pchip' : s; } else extrap = S(r); }
    if (!['linear', 'nearest', 'spline', 'pchip', 'cubic', 'previous', 'next', 'makima'].includes(method)) fail(`Invalid interpolation method '${method}'.`);
    if (method === 'makima') method = 'pchip';
    if (Y.r === 1 || Y.c === 1) return interp1(x, Array.from(Y.re), Xq, method, extrap);
    // matrix Y: interpolate each column
    const q = Array.from(Xq.re), O = new Mat(q.length, Y.c);
    for (let j = 0; j < Y.c; j++) { const col = interp1(x, Array.from(Y.re.subarray(j * Y.r, (j + 1) * Y.r)), M.colVec(q), method, extrap); O.re.set(col.re, j * q.length); }
    return O;
  };
  L.spline = a => { if (a.length < 3) fail('spline(x, y, xq) needs three inputs.'); return interp1(vec(a[0]), vec(a[1]), N(a[2]), 'spline'); };
  L.pchip = a => interp1(vec(a[0]), vec(a[1]), N(a[2]), 'pchip');
  L.interp2 = a => { // interp2(X, Y, Z, Xq, Yq) bilinear on a meshgrid
    const X = N(a[0]), Y = N(a[1]), Z = N(a[2]), Xq = N(a[3]), Yq = N(a[4]);
    const xs = Array.from({ length: X.c }, (_, j) => X.re[j * X.r]), ys = Array.from({ length: Y.r }, (_, i) => Y.re[i]);
    const find = (arr, v) => { if (v < arr[0] || v > arr[arr.length - 1]) return -1; let k = 0; while (k < arr.length - 2 && arr[k + 1] <= v) k++; return k; };
    const o = new Mat(Xq.r, Xq.c);
    for (let k = 0; k < Xq.n; k++) {
      const xv = Xq.re[k], yv = Yq.re[Yq.n === 1 ? 0 : k], i = find(ys, yv), j = find(xs, xv);
      if (i < 0 || j < 0) { o.re[k] = NaN; continue; }
      const tx = (xv - xs[j]) / (xs[j + 1] - xs[j]), ty = (yv - ys[i]) / (ys[i + 1] - ys[i]), z = (p, q) => Z.re[p + q * Z.r];
      o.re[k] = (1 - tx) * (1 - ty) * z(i, j) + tx * (1 - ty) * z(i, j + 1) + (1 - tx) * ty * z(i + 1, j) + tx * ty * z(i + 1, j + 1);
    }
    return o;
  };

  // ---------- ODE solvers ----------
  const DP = {
    c: [0, 1 / 5, 3 / 10, 4 / 5, 8 / 9, 1, 1],
    a: [[], [1 / 5], [3 / 40, 9 / 40], [44 / 45, -56 / 15, 32 / 9], [19372 / 6561, -25360 / 2187, 64448 / 6561, -212 / 729], [9017 / 3168, -355 / 33, 46732 / 5247, 49 / 176, -5103 / 18656], [35 / 384, 0, 500 / 1113, 125 / 192, -2187 / 6784, 11 / 84]],
    e: [71 / 57600, 0, -71 / 16695, 71 / 1920, -17253 / 339200, 22 / 525, -1 / 40],
    order: 5,
    d: [-12715105075 / 11282082432, 0, 87487479700 / 32700410799, -10690763975 / 1880347072, 701980252875 / 199316789632, -1453857185 / 822651844, 69997945 / 29380423],
  };
  const BS = { c: [0, 1 / 2, 3 / 4, 1], a: [[], [1 / 2], [0, 3 / 4], [2 / 9, 1 / 3, 4 / 9]], e: [-5 / 72, 1 / 12, 1 / 9, -1 / 8], order: 3 };
  function odeOpts(v) {
    const o = { rtol: 1e-3, atol: 1e-6, maxStep: Infinity, initialStep: 0, refine: null };
    if (v && v.type === 'struct') {
      const g = k => { for (const [name, x] of v.f) if (name.toLowerCase() === k && isNumV(x) && x.n) return x; return null; };
      const r = g('reltol'), at = g('abstol'), ms = g('maxstep'), is = g('initialstep'), rf = g('refine');
      if (r) o.rtol = r.re[0]; if (at) o.atol = at.re[0]; if (ms) o.maxStep = ms.re[0]; if (is) o.initialStep = is.re[0]; if (rf) o.refine = rf.re[0];
    }
    return o;
  }
  const isNumV = x => x && x.type === 'num';
  function solveOde(a, nout, In, T, name) {
    if (a.length < 3) fail(`${name} needs a function, a time span and initial conditions: ${name}(f, [t0 tf], y0).`);
    const f = a[0]; if (f.type !== 'func') fail(`${name}: the first input must be a function handle like @(t,y) -y.`);
    const tspan = vec(a[1]), Y0 = N(a[2]), y0 = Array.from(Y0.re), m = y0.length, opt = odeOpts(a[3]);
    if (tspan.length < 2) fail(`${name}: the time span must have at least two entries [t0 tf].`);
    const t0 = tspan[0], tf = tspan[tspan.length - 1], dir = Math.sign(tf - t0) || 1;
    const rhs = (t, y) => { const r = In.fcall(f, [num(t), M.colVec(y)]); if (r.type !== 'num' || r.n !== m) fail(`${name}: the function must return a vector with ${m} element${m > 1 ? 's' : ''} (got ${r.r}×${r.c}).`); return Array.from(r.re); };
    const norm = (v, y, yn) => { let mx = 0; for (let i = 0; i < m; i++) mx = Math.max(mx, Math.abs(v[i]) / Math.max(opt.atol, opt.rtol * Math.max(Math.abs(y[i]), Math.abs(yn[i])))); return mx; };
    const span = Math.abs(tf - t0), hmax = Math.min(opt.maxStep, 0.1 * span);
    let t = t0, y = y0.slice(), k1 = rhs(t, y);
    // initial step (Hairer & Wanner)
    let h = opt.initialStep;
    if (!h) {
      let d1 = 0; for (let i = 0; i < m; i++) d1 = Math.max(d1, Math.abs(k1[i]) / Math.max(Math.abs(y[i]), opt.atol / opt.rtol));
      h = Math.min(hmax, span); const rh = d1 / (0.8 * Math.pow(opt.rtol, 1 / T.order)); if (h * rh > 1) h = 1 / rh;
      h = Math.max(h, 16 * LA.EPS * Math.abs(t));
    }
    const refine = opt.refine || (T === DP ? 4 : 1);
    const fixedOut = tspan.length > 2;
    const tout = [t0], yout = [y0.slice()]; let next = 1;
    const stages = T.c.length;
    let steps = 0, fails = 0;
    while (dir * (tf - t) > 0) {
      In.tick();
      if (++steps > 200000) fail(`${name}: too many steps (the problem may be stiff or the solution may blow up).`);
      if (Math.abs(h) < 16 * LA.EPS * Math.max(1, Math.abs(t))) { In.warn(`Failure at t=${M.expStr(t, 6)}. Unable to meet integration tolerances without reducing the step size below the smallest value allowed (${M.expStr(16 * LA.EPS * Math.abs(t), 6)}) at time t.`); break; }
      h = Math.min(Math.abs(h), hmax); if (Math.abs(tf - t) < h * 1.1 || Math.abs(tf - t) - h < 1e-12 * span) h = Math.abs(tf - t);
      const hs = dir * h, K = [k1];
      for (let s = 1; s < stages; s++) {
        const ys = y.slice(); for (let j = 0; j < s; j++) { const c = T.a[s][j]; if (c) for (let i = 0; i < m; i++) ys[i] += hs * c * K[j][i]; }
        K.push(rhs(t + T.c[s] * hs, ys));
      }
      // the last stage of both tableaus is evaluated at the new solution (FSAL)
      const yn = y.slice(); const bl = T.a[stages - 1]; for (let j = 0; j < bl.length; j++) if (bl[j]) for (let i = 0; i < m; i++) yn[i] += hs * bl[j] * K[j][i];
      const errv = new Array(m).fill(0); for (let j = 0; j < stages; j++) if (T.e[j]) for (let i = 0; i < m; i++) errv[i] += hs * T.e[j] * K[j][i];
      const err = norm(errv, y, yn);
      if (!(err <= 1)) { fails++; h *= Math.max(0.1, 0.8 * Math.pow(err || 10, -1 / T.order)); if (!isFinite(err)) h *= 0.1; continue; }
      // accepted: emit output
      const tn = t + hs, kLast = K[stages - 1];
      const interp = th => { // dense output at fraction th of the step
        if (T === DP) {
          const r = new Array(m); for (let i = 0; i < m; i++) {
            const r1 = y[i], r2 = yn[i] - y[i], r3 = hs * k1[i] - r2, r4 = r2 - hs * kLast[i] - r3;
            let r5 = 0; for (let j = 0; j < 7; j++) if (T.d[j]) r5 += T.d[j] * K[j][i]; r5 *= hs;
            r[i] = r1 + th * (r2 + (1 - th) * (r3 + th * (r4 + (1 - th) * r5)));
          } return r;
        }
        const r = new Array(m), h1 = hs; for (let i = 0; i < m; i++) { const t2 = th * th, t3 = t2 * th; r[i] = (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + th) * h1 * k1[i] + (-2 * t3 + 3 * t2) * yn[i] + (t3 - t2) * h1 * kLast[i]; } return r;
      };
      if (fixedOut) { while (next < tspan.length && dir * (tspan[next] - tn) <= 1e-12 * span) { const th = (tspan[next] - t) / hs; tout.push(tspan[next]); yout.push(th >= 1 ? yn.slice() : interp(th)); next++; } }
      else { for (let r = 1; r < refine; r++) { const th = r / refine; tout.push(t + th * hs); yout.push(interp(th)); } tout.push(tn); yout.push(yn.slice()); }
      t = tn; y = yn; k1 = kLast;
      const fac = err === 0 ? 5 : Math.min(5, Math.max(0.2, 0.9 * Math.pow(err, -1 / T.order)));
      h = h * (fails ? Math.min(1, fac) : fac); fails = 0;
    }
    const T_ = colOut(tout), Yo = new Mat(tout.length, m); yout.forEach((row, i) => row.forEach((v, j) => { Yo.re[i + j * tout.length] = v; }));
    if (nout <= 1) { const s = new Struct(); s.f.set('x', M.rowVec(tout)); s.f.set('y', M.transpose(Yo)); s.f.set('solver', M.str(name)); return s; }
    return [T_, Yo];
  }
  L.ode45 = (a, n, In) => solveOde(a, n, In, DP, 'ode45');
  L.ode23 = (a, n, In) => solveOde(a, n, In, BS, 'ode23');
  L.odeset = a => { const s = new Struct(); for (let k = 0; k + 1 < a.length; k += 2) s.f.set(Str(a[k]), a[k + 1]); return s; };
  L.optimset = L.odeset;
  L.deval = a => { const sol = a[0], xq = N(a[1]), x = vec(sol.f.get('x')), Y = sol.f.get('y'), rows = []; for (let i = 0; i < Y.r; i++) { const yi = []; for (let j = 0; j < Y.c; j++) yi.push(Y.re[i + j * Y.r]); rows.push(Array.from(interp1(x, yi, xq, 'spline').re)); } return M.fromRows(rows); };

  // ---------- roots & minimization ----------
  const scalarFn = (In, f) => x => { const r = In.fcall(f, [num(x)]); if (r.type !== 'num' || r.n < 1) fail('The function must return a numeric scalar.'); return r.re[0]; };
  function brentZero(F, a, b, fa, fb, tol) {
    let c = a, fc = fa, d = b - a, e = d;
    for (let it = 0; it < 500; it++) {
      if (Math.sign(fb) === Math.sign(fc)) { c = a; fc = fa; d = e = b - a; }
      if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
      const m = 0.5 * (c - b), tl = 2 * LA.EPS * Math.abs(b) + tol;
      if (Math.abs(m) <= tl || fb === 0) return b;
      if (Math.abs(e) >= tl && Math.abs(fa) > Math.abs(fb)) {
        let p, q, r; const s = fb / fa;
        if (a === c) { p = 2 * m * s; q = 1 - s; } else { q = fa / fc; r = fb / fc; p = s * (2 * m * q * (q - r) - (b - a) * (r - 1)); q = (q - 1) * (r - 1) * (s - 1); }
        if (p > 0) q = -q; else p = -p;
        if (2 * p < Math.min(3 * m * q - Math.abs(tl * q), Math.abs(e * q))) { e = d; d = p / q; } else { d = m; e = m; }
      } else { d = m; e = m; }
      a = b; fa = fb; b += Math.abs(d) > tl ? d : (m > 0 ? tl : -tl); fb = F(b);
    }
    return b;
  }
  L.fzero = (a, nout, In) => {
    const F = scalarFn(In, a[0]), X0 = N(a[1]); let lo, hi, flo, fhi;
    if (X0.n >= 2) { lo = X0.re[0]; hi = X0.re[1]; flo = F(lo); fhi = F(hi); if (Math.sign(flo) === Math.sign(fhi) && flo !== 0 && fhi !== 0) fail('The function values at the interval endpoints must differ in sign.'); }
    else {
      const x0 = X0.re[0], f0 = F(x0); if (f0 === 0) return nout > 1 ? [num(x0), num(0)] : num(x0);
      let dx = x0 === 0 ? 1 / 50 : x0 / 50, found = false;
      for (let k = 0; k < 200 && !found; k++) {
        dx *= Math.SQRT2; const a1 = x0 - dx, b1 = x0 + dx, fa = F(a1), fb = F(b1);
        if (!isFinite(fa) || !isFinite(fb)) continue;
        if (Math.sign(fa) !== Math.sign(f0)) { lo = a1; hi = x0; flo = fa; fhi = f0; found = true; }
        else if (Math.sign(fb) !== Math.sign(f0)) { lo = x0; hi = b1; flo = f0; fhi = fb; found = true; }
      }
      if (!found) fail(`fzero: couldn't find an interval with a sign change near ${x0}. Try a bracketing interval [a b].`);
    }
    const x = flo === 0 ? lo : fhi === 0 ? hi : brentZero(F, lo, hi, flo, fhi, LA.EPS);
    return nout > 1 ? [num(x), num(F(x)), num(1)] : num(x);
  };
  L.fminsearch = (a, nout, In) => {
    const f = a[0], X0 = N(a[1]), n = X0.n, opts = a[2] && a[2].type === 'struct' ? a[2] : null;
    const get = (k, d) => { if (!opts) return d; for (const [nm, v] of opts.f) if (nm.toLowerCase() === k && v.type === 'num' && v.n) return v.re[0]; return d; };
    const tolx = get('tolx', 1e-4), tolf = get('tolfun', 1e-4), maxIt = get('maxiter', 200 * n), maxFev = get('maxfunevals', 200 * n);
    let fev = 0;
    const F = x => { fev++; const r = In.fcall(f, [new Mat(X0.r, X0.c, Float64Array.from(x))]); if (r.type !== 'num' || r.n < 1) fail('fminsearch: the function must return a scalar.'); return r.re[0]; };
    let P = [Array.from(X0.re)];
    for (let i = 0; i < n; i++) { const p = P[0].slice(); p[i] = p[i] !== 0 ? 1.05 * p[i] : 0.00025; P.push(p); }
    let fv = P.map(F);
    const order = () => { const idx = fv.map((_, i) => i).sort((p, q) => fv[p] - fv[q]); P = idx.map(i => P[i]); fv = idx.map(i => fv[i]); };
    order(); let it = 0;
    while (it < maxIt && fev < maxFev) {
      In.tick();
      let dx = 0; for (let i = 1; i <= n; i++) for (let j = 0; j < n; j++) dx = Math.max(dx, Math.abs(P[i][j] - P[0][j]));
      let df = 0; for (let i = 1; i <= n; i++) df = Math.max(df, Math.abs(fv[i] - fv[0]));
      if (dx <= tolx && df <= tolf) break;
      it++;
      const xb = new Array(n).fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) xb[j] += P[i][j] / n;
      const xr = xb.map((v, j) => 2 * v - P[n][j]), fr = F(xr);
      if (fr < fv[0]) { const xe = xb.map((v, j) => 3 * v - 2 * P[n][j]), fe = F(xe); if (fe < fr) { P[n] = xe; fv[n] = fe; } else { P[n] = xr; fv[n] = fr; } }
      else if (fr < fv[n - 1]) { P[n] = xr; fv[n] = fr; }
      else {
        let shrink = false;
        if (fr < fv[n]) { const xc = xb.map((v, j) => 1.5 * v - 0.5 * P[n][j]), fc = F(xc); if (fc <= fr) { P[n] = xc; fv[n] = fc; } else shrink = true; }
        else { const xcc = xb.map((v, j) => 0.5 * v + 0.5 * P[n][j]), fcc = F(xcc); if (fcc < fv[n]) { P[n] = xcc; fv[n] = fcc; } else shrink = true; }
        if (shrink) for (let i = 1; i <= n; i++) { P[i] = P[i].map((v, j) => P[0][j] + 0.5 * (v - P[0][j])); fv[i] = F(P[i]); }
      }
      order();
    }
    const x = new Mat(X0.r, X0.c, Float64Array.from(P[0]));
    return nout > 1 ? [x, num(fv[0]), num(it < maxIt && fev < maxFev ? 1 : 0)] : x;
  };
  L.fminbnd = (a, nout, In) => {
    const F = scalarFn(In, a[0]); let lo = S(a[1]), hi = S(a[2]); const tol = 1e-4;
    // Brent's localmin
    const c = (3 - Math.sqrt(5)) / 2; let v = lo + c * (hi - lo), w = v, x = v, e = 0, d = 0, fx = F(x), fv = fx, fw = fx;
    for (let it = 0; it < 500; it++) {
      const m = 0.5 * (lo + hi), t1 = Math.sqrt(LA.EPS) * Math.abs(x) + tol / 3, t2 = 2 * t1;
      if (Math.abs(x - m) <= t2 - 0.5 * (hi - lo)) break;
      let gold = true;
      if (Math.abs(e) > t1) {
        let r = (x - w) * (fx - fv), q = (x - v) * (fx - fw), p = (x - v) * q - (x - w) * r; q = 2 * (q - r); if (q > 0) p = -p; else q = -q; r = e; e = d;
        if (Math.abs(p) < Math.abs(0.5 * q * r) && p > q * (lo - x) && p < q * (hi - x)) { d = p / q; const u = x + d; if (u - lo < t2 || hi - u < t2) d = x < m ? t1 : -t1; gold = false; }
      }
      if (gold) { e = (x < m ? hi : lo) - x; d = c * e; }
      const u = x + (Math.abs(d) >= t1 ? d : d > 0 ? t1 : -t1), fu = F(u);
      if (fu <= fx) { if (u < x) hi = x; else lo = x; v = w; fv = fw; w = x; fw = fx; x = u; fx = fu; }
      else { if (u < x) lo = u; else hi = u; if (fu <= fw || w === x) { v = w; fv = fw; w = u; fw = fu; } else if (fu <= fv || v === x || v === w) { v = u; fv = fu; } }
    }
    return nout > 1 ? [num(x), num(fx)] : num(x);
  };

  // ---------- integration ----------
  const GK = { // Gauss–Kronrod 7/15 nodes and weights on [-1, 1]
    x: [0.991455371120812639, 0.949107912342758525, 0.864864423359769073, 0.741531185599394440, 0.586087235467691130, 0.405845151377397167, 0.207784955007898468, 0],
    wk: [0.022935322010529225, 0.063092092629978553, 0.104790010322250184, 0.140653259715525919, 0.169004726639267903, 0.190350578064785410, 0.204432940075298892, 0.209482141084727828],
    wg: [0, 0.129484966168869693, 0, 0.279705391489276668, 0, 0.381830050505118945, 0, 0.417959183673469388],
  };
  L.integral = (a, nout, In) => {
    const f = a[0], A = S(a[1]), B = S(a[2]);
    let absTol = 1e-10, relTol = 1e-6;
    for (let k = 3; k + 1 < a.length; k += 2) { const nm = Str(a[k]).toLowerCase(); if (nm === 'abstol') absTol = S(a[k + 1]); else if (nm === 'reltol') relTol = S(a[k + 1]); }
    if (A === B) return num(0);
    let vectorized = true;
    const evalF = xs => {
      if (vectorized) {
        const r = In.fcall(f, [M.rowVec(xs)]);
        if (r.type === 'num' && r.n === xs.length) return Array.from(r.re);
        if (r.type === 'num' && r.n === 1 && xs.length > 1) vectorized = false; else fail('integral: the function must return a numeric value for each input.');
      }
      return xs.map(x => { const r = In.fcall(f, [num(x)]); if (r.type !== 'num' || r.n !== 1) fail('integral: the function must return a scalar.'); return r.re[0]; });
    };
    // map infinite limits onto finite ones
    let g = null, lo = A, hi = B, sgn = 1;
    if (lo > hi) { [lo, hi] = [hi, lo]; sgn = -1; }
    let tr = t => [t, 1];
    if (!isFinite(lo) && !isFinite(hi)) { tr = t => [t / (1 - t * t), (1 + t * t) / ((1 - t * t) ** 2)]; lo = -1; hi = 1; }
    else if (!isFinite(hi)) { const a0 = lo; tr = t => [a0 + t / (1 - t), 1 / ((1 - t) ** 2)]; lo = 0; hi = 1; }
    else if (!isFinite(lo)) { const b0 = hi; tr = t => [b0 - (1 - t) / t, 1 / (t * t)]; lo = 0; hi = 1; }
    g = ts => { const xs = ts.map(t => tr(t)[0]), ws = ts.map(t => tr(t)[1]), ys = evalF(xs); return ys.map((y, i) => y * ws[i]); };
    const seg = (x0, x1) => {
      const c = (x0 + x1) / 2, h = (x1 - x0) / 2, ts = [];
      for (let i = 0; i < 7; i++) ts.push(c - h * GK.x[i]); ts.push(c); for (let i = 6; i >= 0; i--) ts.push(c + h * GK.x[i]);
      const ys = g(ts); let K = 0, G = 0;
      for (let i = 0; i < 7; i++) { K += GK.wk[i] * (ys[i] + ys[14 - i]); G += GK.wg[i] * (ys[i] + ys[14 - i]); }
      K += GK.wk[7] * ys[7]; G += GK.wg[7] * ys[7];
      return { K: K * h, err: Math.abs((K - G) * h), x0, x1 };
    };
    let segs = []; const n0 = 10; for (let k = 0; k < n0; k++) segs.push(seg(lo + (hi - lo) * k / n0, lo + (hi - lo) * (k + 1) / n0));
    for (let it = 0; it < 650; it++) {
      In.tick();
      const total = segs.reduce((s, x) => s + x.K, 0), err = segs.reduce((s, x) => s + x.err, 0);
      if (err <= Math.max(absTol, relTol * Math.abs(total))) return num(sgn * total);
      segs.sort((p, q) => q.err - p.err); const w = segs.shift(), m = (w.x0 + w.x1) / 2; segs.push(seg(w.x0, m), seg(m, w.x1));
    }
    const total = segs.reduce((s, x) => s + x.K, 0);
    In.warn('integral: reached the limit on the number of intervals. The result may be inaccurate.');
    return num(sgn * total);
  };
  L.quad = L.integral; L.quadgk = L.integral; L.quadl = L.integral;
  L.integral2 = (a, nout, In) => { // iterated integral over a rectangle (or ymin/ymax functions)
    const f = a[0], x0 = S(a[1]), x1 = S(a[2]);
    const yl = a[3], yh = a[4];
    const inner = x => {
      const lo = yl.type === 'func' ? In.fcall(yl, [num(x)]).re[0] : S(yl), hi = yh.type === 'func' ? In.fcall(yh, [num(x)]).re[0] : S(yh);
      return L.integral([jsFn(y => In.fcall(f, [M.map(N(y), () => x), y])), num(lo), num(hi)], 1, In).re[0];
    };
    return L.integral([jsFn(X => M.map(N(X), inner)), num(x0), num(x1)], 1, In);
  };
  const jsFn = js => new I.Func({ js });

  const api = { fft1, interp1, splineSlopes, pchipSlopes };
  if (node) module.exports = api; else root.LabNumerics = api;
})(typeof self !== 'undefined' ? self : this);
