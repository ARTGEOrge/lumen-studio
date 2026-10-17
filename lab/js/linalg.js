// Lumen Lab — dense linear algebra on real matrices: LU, QR (Householder), Cholesky, symmetric (Jacobi)
// and general (Hessenberg + shifted QR) eigenvalues, one-sided Jacobi SVD, least squares, expm.
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./mat.js') : root.LabMat;
  const { Mat, fail, fromRows, toRows } = M;
  const EPS = 2.220446049250313e-16;
  const eye = n => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0));
  const realOnly = (A, what) => { if (A.im) fail(`${what} of complex matrices is not supported in Lumen Lab.`); };
  const square = (A, what) => { if (A.r !== A.c) fail(`Matrix must be square${what ? ' (' + what + ')' : ''}.`, 'MATLAB:square'); };

  // ---------- LU with partial pivoting ----------
  function lu(A) {
    const n = A.r, a = toRows(A), piv = [...Array(n).keys()]; let sign = 1, singular = false;
    for (let k = 0; k < Math.min(n, A.c); k++) {
      let p = k, mx = Math.abs(a[k][k]);
      for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > mx) { mx = Math.abs(a[i][k]); p = i; }
      if (p !== k) { [a[p], a[k]] = [a[k], a[p]]; [piv[p], piv[k]] = [piv[k], piv[p]]; sign = -sign; }
      if (a[k][k] === 0) { singular = true; continue; }
      for (let i = k + 1; i < n; i++) { const f = a[i][k] / a[k][k]; a[i][k] = f; if (f) for (let j = k + 1; j < A.c; j++) a[i][j] -= f * a[k][j]; }
    }
    return { a, piv, sign, singular };
  }
  function det(A) {
    realOnly(A, 'det'); square(A, 'det'); if (!A.r) return 1;
    const { a, sign } = lu(A); let d = sign; for (let i = 0; i < A.r; i++) d *= a[i][i]; return d;
  }
  // reciprocal condition number in the 1-norm from an LU factorization (Hager/Higham estimator, O(n^2) per step)
  function rcondLU(f, A) {
    const n = f.a.length; if (!n) return Infinity;
    let anorm = 0; for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < n; i++) s += Math.abs(A.re[i + j * n]); anorm = Math.max(anorm, s); }
    for (let i = 0; i < n; i++) if (f.a[i][i] === 0) return 0;
    if (anorm === 0) return 0;
    const a = f.a;
    const solve = b => { const x = f.piv.map(p => b[p]); for (let i = 0; i < n; i++) for (let j = 0; j < i; j++) x[i] -= a[i][j] * x[j]; for (let i = n - 1; i >= 0; i--) { for (let j = i + 1; j < n; j++) x[i] -= a[i][j] * x[j]; x[i] /= a[i][i]; } return x; };
    const solveT = b => { const w = b.slice(); for (let i = 0; i < n; i++) { for (let j = 0; j < i; j++) w[i] -= a[j][i] * w[j]; w[i] /= a[i][i]; } for (let i = n - 1; i >= 0; i--) for (let j = i + 1; j < n; j++) w[i] -= a[j][i] * w[j]; const z = new Array(n); f.piv.forEach((p, i) => { z[p] = w[i]; }); return z; };
    let x = new Array(n).fill(1 / n), est = 0;
    for (let it = 0; it < 5; it++) {
      const y = solve(x); est = y.reduce((s, v) => s + Math.abs(v), 0);
      if (!isFinite(est)) return 0;
      const z = solveT(y.map(v => v >= 0 ? 1 : -1));
      let j = 0, zx = 0; for (let i = 0; i < n; i++) { zx += z[i] * x[i]; if (Math.abs(z[i]) > Math.abs(z[j])) j = i; }
      if (Math.abs(z[j]) <= zx) break;
      x = new Array(n).fill(0); x[j] = 1;
    }
    return est ? 1 / (anorm * est) : Infinity;
  }
  function luSolve(f, B) { // B rows arrays (n × k)
    const n = f.a.length, k = B[0] ? B[0].length : 0, a = f.a, X = f.piv.map(p => B[p].slice());
    for (let c = 0; c < k; c++) {
      for (let i = 0; i < n; i++) { let s = X[i][c]; for (let j = 0; j < i; j++) s -= a[i][j] * X[j][c]; X[i][c] = s; }
      for (let i = n - 1; i >= 0; i--) { let s = X[i][c]; for (let j = i + 1; j < n; j++) s -= a[i][j] * X[j][c]; X[i][c] = s / a[i][i]; }
    }
    return X;
  }
  // [L,U,P] = lu(A)
  function luFactors(A) {
    realOnly(A, 'lu'); const m = A.r, n = A.c, f = lu(A), k = Math.min(m, n);
    const L = Array.from({ length: m }, (_, i) => Array.from({ length: k }, (_, j) => i === j ? 1 : j < i ? f.a[i][j] : 0));
    const U = Array.from({ length: k }, (_, i) => Array.from({ length: n }, (_, j) => j >= i ? f.a[i][j] : 0));
    const P = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => f.piv[i] === j ? 1 : 0));
    return { L: fromRows(L), U: fromRows(U), P: fromRows(P), piv: f.piv };
  }

  // ---------- QR (Householder) ----------
  function qr(A, econ) {
    realOnly(A, 'qr'); const m = A.r, n = A.c, R = toRows(A), Q = eye(m);
    for (let k = 0; k < Math.min(m - 1, n); k++) {
      let nrm = 0; for (let i = k; i < m; i++) nrm += R[i][k] * R[i][k]; nrm = Math.sqrt(nrm); if (nrm === 0) continue;
      const alpha = R[k][k] > 0 ? -nrm : nrm, v = []; for (let i = k; i < m; i++) v.push(R[i][k]); v[0] -= alpha;
      let vn = 0; for (const x of v) vn += x * x; if (vn === 0) continue;
      for (let j = k; j < n; j++) { let s = 0; for (let i = k; i < m; i++) s += v[i - k] * R[i][j]; s = 2 * s / vn; for (let i = k; i < m; i++) R[i][j] -= s * v[i - k]; }
      for (let i = 0; i < m; i++) { let s = 0; for (let l = k; l < m; l++) s += Q[i][l] * v[l - k]; s = 2 * s / vn; for (let l = k; l < m; l++) Q[i][l] -= s * v[l - k]; }
      for (let i = k + 1; i < m; i++) R[i][k] = 0;
    }
    if (econ && m > n) return { Q: fromRows(Q.map(r => r.slice(0, n))), R: fromRows(R.slice(0, n)) };
    return { Q: fromRows(Q), R: fromRows(R) };
  }

  // ---------- A \ B ----------
  // returns { X, warn }
  function solve(A, B) {
    realOnly(A, 'mldivide'); realOnly(B, 'mldivide');
    if (A.r !== B.r) fail(`Matrix dimensions must agree (${A.r}×${A.c} \\ ${B.r}×${B.c}).`, 'MATLAB:dimagree');
    if (A.r === A.c) {
      if (!A.r) return { X: new Mat(0, B.c) };
      const f = lu(A), rc = rcondLU(f, A); let warn = null;
      if (f.singular || rc === 0) warn = 'Matrix is singular to working precision.';
      else if (rc < EPS) warn = `Matrix is close to singular or badly scaled. Results may be inaccurate. RCOND = ${M.expStr(rc, 6)}.`;
      return { X: fromRows(luSolve(f, toRows(B))), warn };
    }
    return lstsq(A, B);
  }
  function lstsq(A, B) {
    const m = A.r, n = A.c;
    if (m < n) { // minimum-norm solution of an underdetermined system: x = A' (A A')^-1 b
      const At = M.transpose(A), { X, warn } = solve(M.mtimes(A, At), B); return { X: M.mtimes(At, X), warn };
    }
    const { Q, R } = qr(A), q = toRows(Q), r = toRows(R), b = toRows(B), k = B.c;
    const qtb = Array.from({ length: n }, (_, i) => Array.from({ length: k }, (_, c) => { let s = 0; for (let l = 0; l < m; l++) s += q[l][i] * b[l][c]; return s; }));
    let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(r[i][i])); const tol = Math.max(m, n) * EPS * mx;
    let warn = null, rank = 0;
    const X = Array.from({ length: n }, () => new Array(k).fill(0));
    for (let c = 0; c < k; c++) for (let i = n - 1; i >= 0; i--) {
      if (Math.abs(r[i][i]) <= tol) { X[i][c] = 0; continue; }
      let s = qtb[i][c]; for (let j = i + 1; j < n; j++) s -= r[i][j] * X[j][c]; X[i][c] = s / r[i][i];
    }
    for (let i = 0; i < n; i++) if (Math.abs(r[i][i]) > tol) rank++;
    if (rank < n) warn = `Rank deficient, rank = ${rank}, tol = ${M.expStr(tol, 6)}.`;
    return { X: fromRows(X), warn };
  }
  function inv(A) {
    realOnly(A, 'inv'); square(A, 'inv'); const n = A.r;
    const f = lu(A), rc = rcondLU(f, A);
    if (f.singular || rc === 0) { const o = new Mat(n, n); o.re.fill(Infinity); return { X: o, warn: 'Matrix is singular to working precision.' }; }
    return { X: fromRows(luSolve(f, eye(n))), warn: rc < EPS ? `Matrix is close to singular or badly scaled. Results may be inaccurate. RCOND = ${M.expStr(rc, 6)}.` : null };
  }
  function chol(A) {
    realOnly(A, 'chol'); square(A, 'chol'); const n = A.r, a = toRows(A), R = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      let s = a[j][j]; for (let k = 0; k < j; k++) s -= R[k][j] * R[k][j];
      if (!(s > 0)) fail('Matrix must be positive definite.', 'MATLAB:posdef');
      R[j][j] = Math.sqrt(s);
      for (let i = j + 1; i < n; i++) { let t = a[j][i]; for (let k = 0; k < j; k++) t -= R[k][j] * R[k][i]; R[j][i] = t / R[j][j]; }
    }
    return fromRows(R);
  }

  // ---------- eigenvalues ----------
  const isSym = A => { for (let i = 0; i < A.r; i++) for (let j = i + 1; j < A.c; j++) if (A.re[i + j * A.r] !== A.re[j + i * A.r]) return false; return true; };
  // symmetric: Householder tridiagonalization + implicit QL (tred2/tql2, as in EISPACK/JAMA)
  function symEig(A) {
    const n = A.r, V = toRows(A), d = new Array(n).fill(0), e = new Array(n).fill(0);
    for (let j = 0; j < n; j++) d[j] = V[n - 1][j];
    for (let i = n - 1; i > 0; i--) {
      let scale = 0, h = 0;
      for (let k = 0; k < i; k++) scale += Math.abs(d[k]);
      if (scale === 0) {
        e[i] = d[i - 1];
        for (let j = 0; j < i; j++) { d[j] = V[i - 1][j]; V[i][j] = 0; V[j][i] = 0; }
      } else {
        for (let k = 0; k < i; k++) { d[k] /= scale; h += d[k] * d[k]; }
        let f = d[i - 1], g = Math.sqrt(h); if (f > 0) g = -g;
        e[i] = scale * g; h -= f * g; d[i - 1] = f - g;
        for (let j = 0; j < i; j++) e[j] = 0;
        for (let j = 0; j < i; j++) {
          f = d[j]; V[j][i] = f; g = e[j] + V[j][j] * f;
          for (let k = j + 1; k <= i - 1; k++) { g += V[k][j] * d[k]; e[k] += V[k][j] * f; }
          e[j] = g;
        }
        f = 0; for (let j = 0; j < i; j++) { e[j] /= h; f += e[j] * d[j]; }
        const hh = f / (h + h);
        for (let j = 0; j < i; j++) e[j] -= hh * d[j];
        for (let j = 0; j < i; j++) { f = d[j]; g = e[j]; for (let k = j; k <= i - 1; k++) V[k][j] -= (f * e[k] + g * d[k]); d[j] = V[i - 1][j]; V[i][j] = 0; }
      }
      d[i] = h;
    }
    for (let i = 0; i < n - 1; i++) {
      V[n - 1][i] = V[i][i]; V[i][i] = 1; const h = d[i + 1];
      if (h !== 0) {
        for (let k = 0; k <= i; k++) d[k] = V[k][i + 1] / h;
        for (let j = 0; j <= i; j++) { let g = 0; for (let k = 0; k <= i; k++) g += V[k][i + 1] * V[k][j]; for (let k = 0; k <= i; k++) V[k][j] -= g * d[k]; }
      }
      for (let k = 0; k <= i; k++) V[k][i + 1] = 0;
    }
    for (let j = 0; j < n; j++) { d[j] = V[n - 1][j]; V[n - 1][j] = 0; }
    V[n - 1][n - 1] = 1; e[0] = 0;
    // tql2
    for (let i = 1; i < n; i++) e[i - 1] = e[i];
    e[n - 1] = 0;
    let f = 0, tst1 = 0;
    for (let l = 0; l < n; l++) {
      tst1 = Math.max(tst1, Math.abs(d[l]) + Math.abs(e[l]));
      let m = l; while (m < n) { if (Math.abs(e[m]) <= EPS * tst1) break; m++; }
      if (m > l) {
        let iter = 0;
        do {
          if (++iter > 200) fail('eig did not converge.');
          let g = d[l], p = (d[l + 1] - g) / (2 * e[l]), r = Math.hypot(p, 1); if (p < 0) r = -r;
          d[l] = e[l] / (p + r); d[l + 1] = e[l] * (p + r);
          const dl1 = d[l + 1]; let h = g - d[l];
          for (let i = l + 2; i < n; i++) d[i] -= h;
          f += h;
          p = d[m]; let c = 1, c2 = c, c3 = c; const el1 = e[l + 1]; let s = 0, s2 = 0;
          for (let i = m - 1; i >= l; i--) {
            c3 = c2; c2 = c; s2 = s;
            g = c * e[i]; h = c * p; r = Math.hypot(p, e[i]);
            e[i + 1] = s * r; s = e[i] / r; c = p / r;
            p = c * d[i] - s * g;
            d[i + 1] = h + s * (c * g + s * d[i]);
            for (let k = 0; k < n; k++) { h = V[k][i + 1]; V[k][i + 1] = s * V[k][i] + c * h; V[k][i] = c * V[k][i] - s * h; }
          }
          p = -s * s2 * c3 * el1 * e[l] / dl1; e[l] = s * p; d[l] = c * p;
        } while (Math.abs(e[l]) > EPS * tst1);
      }
      d[l] += f; e[l] = 0;
    }
    const order = [...Array(n).keys()].sort((i, j) => d[i] - d[j]);
    const vals = order.map(i => d[i]), vecs = V.map(row => order.map(i => row[i]));
    // sign convention: the largest-magnitude entry of each eigenvector is positive
    for (let j = 0; j < n; j++) { let big = 0; for (let i = 0; i < n; i++) if (Math.abs(vecs[i][j]) > Math.abs(vecs[big][j]) + 1e-12) big = i; if (vecs[big][j] < 0) for (let i = 0; i < n; i++) vecs[i][j] = -vecs[i][j]; }
    return { vals, vecs };
  }
  // orthogonal reduction to upper Hessenberg form H = Q' A Q (orthes); returns Q
  function hessenberg(H) {
    const n = H.length, ort = new Array(n).fill(0), high = n - 1;
    for (let m = 1; m <= high - 1; m++) {
      let scale = 0; for (let i = m; i <= high; i++) scale += Math.abs(H[i][m - 1]);
      if (scale === 0) continue;
      let h = 0; for (let i = high; i >= m; i--) { ort[i] = H[i][m - 1] / scale; h += ort[i] * ort[i]; }
      let g = Math.sqrt(h); if (ort[m] > 0) g = -g;
      h -= ort[m] * g; ort[m] -= g;
      for (let j = m; j < n; j++) { let f = 0; for (let i = high; i >= m; i--) f += ort[i] * H[i][j]; f /= h; for (let i = m; i <= high; i++) H[i][j] -= f * ort[i]; }
      for (let i = 0; i <= high; i++) { let f = 0; for (let j = high; j >= m; j--) f += ort[j] * H[i][j]; f /= h; for (let j = m; j <= high; j++) H[i][j] -= f * ort[j]; }
      ort[m] *= scale; H[m][m - 1] = scale * g;
    }
    const Q = eye(n);
    for (let m = high - 1; m >= 1; m--) {
      if (H[m][m - 1] === 0) continue;
      for (let i = m + 1; i <= high; i++) ort[i] = H[i][m - 1];
      for (let j = m; j <= high; j++) { let g = 0; for (let i = m; i <= high; i++) g += ort[i] * Q[i][j]; g = (g / ort[m]) / H[m][m - 1]; for (let i = m; i <= high; i++) Q[i][j] += g * ort[i]; }
    }
    for (let i = 0; i < n; i++) for (let j = 0; j < i - 1; j++) H[i][j] = 0;
    return Q;
  }
  const sgn = (a, b) => b >= 0 ? Math.abs(a) : -Math.abs(a);
  function hqr(a) { // eigenvalues of an upper Hessenberg matrix (Francis double shift)
    const n = a.length, wr = new Array(n).fill(0), wi = new Array(n).fill(0);
    let anorm = 0; for (let i = 0; i < n; i++) for (let j = Math.max(i - 1, 0); j < n; j++) anorm += Math.abs(a[i][j]);
    let nn = n - 1, t = 0, p = 0, q = 0, r = 0, s, w, x, y, z, l, m;
    while (nn >= 0) {
      let its = 0;
      do {
        for (l = nn; l >= 1; l--) { s = Math.abs(a[l - 1][l - 1]) + Math.abs(a[l][l]); if (s === 0) s = anorm; if (Math.abs(a[l][l - 1]) + s === s) { a[l][l - 1] = 0; break; } }
        x = a[nn][nn];
        if (l === nn) { wr[nn] = x + t; wi[nn] = 0; nn--; }
        else {
          y = a[nn - 1][nn - 1]; w = a[nn][nn - 1] * a[nn - 1][nn];
          if (l === nn - 1) {
            p = 0.5 * (y - x); q = p * p + w; z = Math.sqrt(Math.abs(q)); x += t;
            if (q >= 0) { z = p + sgn(z, p); wr[nn - 1] = wr[nn] = x + z; if (z) wr[nn] = x - w / z; wi[nn - 1] = wi[nn] = 0; }
            else { wr[nn - 1] = wr[nn] = x + p; wi[nn - 1] = z; wi[nn] = -z; }
            nn -= 2;
          } else {
            if (its === 60) fail('eig did not converge.');
            if (its === 10 || its === 20) { t += x; for (let i = 0; i <= nn; i++) a[i][i] -= x; s = Math.abs(a[nn][nn - 1]) + Math.abs(a[nn - 1][nn - 2]); y = x = 0.75 * s; w = -0.4375 * s * s; }
            ++its;
            for (m = nn - 2; m >= l; m--) {
              z = a[m][m]; r = x - z; s = y - z;
              p = (r * s - w) / a[m + 1][m] + a[m][m + 1]; q = a[m + 1][m + 1] - z - r - s; r = a[m + 2][m + 1];
              s = Math.abs(p) + Math.abs(q) + Math.abs(r); p /= s; q /= s; r /= s;
              if (m === l) break;
              const u = Math.abs(a[m][m - 1]) * (Math.abs(q) + Math.abs(r)), v = Math.abs(p) * (Math.abs(a[m - 1][m - 1]) + Math.abs(z) + Math.abs(a[m + 1][m + 1]));
              if (u + v === v) break;
            }
            for (let i = m + 2; i <= nn; i++) { a[i][i - 2] = 0; if (i !== m + 2) a[i][i - 3] = 0; }
            for (let k = m; k <= nn - 1; k++) {
              if (k !== m) { p = a[k][k - 1]; q = a[k + 1][k - 1]; r = 0; if (k !== nn - 1) r = a[k + 2][k - 1]; if ((x = Math.abs(p) + Math.abs(q) + Math.abs(r)) !== 0) { p /= x; q /= x; r /= x; } }
              if ((s = sgn(Math.sqrt(p * p + q * q + r * r), p)) !== 0) {
                if (k === m) { if (l !== m) a[k][k - 1] = -a[k][k - 1]; } else a[k][k - 1] = -s * x;
                p += s; x = p / s; y = q / s; z = r / s; q /= p; r /= p;
                for (let j = k; j <= nn; j++) { p = a[k][j] + q * a[k + 1][j]; if (k !== nn - 1) { p += r * a[k + 2][j]; a[k + 2][j] -= p * z; } a[k + 1][j] -= p * y; a[k][j] -= p * x; }
                const mmin = nn < k + 3 ? nn : k + 3;
                for (let i = l; i <= mmin; i++) { p = x * a[i][k] + y * a[i][k + 1]; if (k !== nn - 1) { p += z * a[i][k + 2]; a[i][k + 2] -= p * r; } a[i][k + 1] -= p * q; a[i][k] -= p; }
              }
            }
          }
        }
      } while (nn >= 0 && l < nn - 1);
    }
    return { wr, wi };
  }
  // eigenvector of an upper Hessenberg H for eigenvalue (lr + i*li): inverse iteration, O(n^2) per vector
  function inverseIteration(H, lr, li, scale) {
    const n = H.length, pert = (Math.hypot(lr, li) + scale) * 1e-10 + 1e-300;
    const mr = H.map((row, i) => row.map((v, j) => v - (i === j ? lr + pert : 0))), mi = H.map((row, i) => row.map((v, j) => i === j ? -li : 0));
    const swap = new Uint8Array(n), fr = new Float64Array(n), fi = new Float64Array(n), tiny = (EPS * scale) || EPS;
    for (let k = 0; k < n; k++) {
      if (k < n - 1 && Math.hypot(mr[k + 1][k], mi[k + 1][k]) > Math.hypot(mr[k][k], mi[k][k])) {
        swap[k] = 1; for (let j = k; j < n; j++) { let t = mr[k][j]; mr[k][j] = mr[k + 1][j]; mr[k + 1][j] = t; t = mi[k][j]; mi[k][j] = mi[k + 1][j]; mi[k + 1][j] = t; }
      }
      if (mr[k][k] === 0 && mi[k][k] === 0) mr[k][k] = tiny;
      if (k < n - 1) {
        const [a, b] = M.C.div(mr[k + 1][k], mi[k + 1][k], mr[k][k], mi[k][k]); fr[k] = a; fi[k] = b;
        for (let j = k + 1; j < n; j++) { mr[k + 1][j] -= a * mr[k][j] - b * mi[k][j]; mi[k + 1][j] -= a * mi[k][j] + b * mr[k][j]; }
      }
    }
    let xr = new Array(n).fill(1), xi = new Array(n).fill(0);
    for (let it = 0; it < 3; it++) {
      const br = xr.slice(), bi = xi.slice();
      for (let k = 0; k < n - 1; k++) {
        if (swap[k]) { let t = br[k]; br[k] = br[k + 1]; br[k + 1] = t; t = bi[k]; bi[k] = bi[k + 1]; bi[k + 1] = t; }
        br[k + 1] -= fr[k] * br[k] - fi[k] * bi[k]; bi[k + 1] -= fr[k] * bi[k] + fi[k] * br[k];
      }
      for (let i = n - 1; i >= 0; i--) { let sr = br[i], si = bi[i]; for (let j = i + 1; j < n; j++) { sr -= mr[i][j] * br[j] - mi[i][j] * bi[j]; si -= mr[i][j] * bi[j] + mi[i][j] * br[j]; } const [a, b] = M.C.div(sr, si, mr[i][i], mi[i][i]); br[i] = a; bi[i] = b; }
      let mx = 0; for (let i = 0; i < n; i++) mx = Math.max(mx, Math.abs(br[i]), Math.abs(bi[i]));
      if (!isFinite(mx) || mx === 0) { for (let i = 0; i < n; i++) { br[i] = isFinite(br[i]) ? 0 : Math.sign(br[i]) || 1; bi[i] = 0; } mx = 1; }
      xr = br.map(v => v / mx); xi = bi.map(v => v / mx);
    }
    return { xr, xi };
  }
  // map a Hessenberg eigenvector back (v = Q x), normalize, make the largest entry real and positive
  function finishVector(Q, xr, xi, real) {
    const n = Q.length, vr = new Array(n).fill(0), vi = new Array(n).fill(0);
    for (let i = 0; i < n; i++) { let a = 0, b = 0; for (let k = 0; k < n; k++) { a += Q[i][k] * xr[k]; b += Q[i][k] * xi[k]; } vr[i] = a; vi[i] = b; }
    let nr = 0; for (let i = 0; i < n; i++) nr += vr[i] * vr[i] + vi[i] * vi[i]; nr = Math.sqrt(nr) || 1;
    let big = 0; for (let i = 1; i < n; i++) if (Math.hypot(vr[i], vi[i]) > Math.hypot(vr[big], vi[big]) + 1e-12) big = i;
    const m = Math.hypot(vr[big], vi[big]) || 1, cr = vr[big] / m, ci = -vi[big] / m;
    const or = vr.map((v, i) => (v * cr - vi[i] * ci) / nr), oi = vr.map((v, i) => (v * ci + vi[i] * cr) / nr);
    if (real) oi.fill(0);
    return { xr: or, xi: oi };
  }
  // returns { vals: {re:[], im:[]}, V: Mat|null }
  function eig(A, wantVecs) {
    realOnly(A, 'eig'); square(A, 'eig'); const n = A.r;
    for (let k = 0; k < A.n; k++) if (!isFinite(A.re[k])) fail('Input to EIG must not contain NaN or Inf.');
    if (isSym(A)) { const { vals, vecs } = symEig(A); return { vals: { re: vals, im: null }, V: wantVecs ? fromRows(vecs) : null }; }
    const H = toRows(A), Q = hessenberg(H), { wr, wi } = hqr(H.map(r => r.slice()));
    const anyIm = wi.some(v => v !== 0);
    if (!wantVecs) return { vals: { re: wr, im: anyIm ? wi : null } };
    let scale = 0; for (let k = 0; k < A.n; k++) scale = Math.max(scale, Math.abs(A.re[k]));
    const V = new Mat(n, n, null, anyIm ? new Float64Array(n * n) : null);
    for (let j = 0; j < n; j++) {
      if (wi[j] < 0 && j > 0 && wi[j - 1] === -wi[j] && wr[j - 1] === wr[j]) { for (let i = 0; i < n; i++) { V.re[i + j * n] = V.re[i + (j - 1) * n]; V.im[i + j * n] = -V.im[i + (j - 1) * n]; } continue; }
      const h = inverseIteration(H, wr[j], wi[j], scale), { xr, xi } = finishVector(Q, h.xr, h.xi, wi[j] === 0);
      for (let i = 0; i < n; i++) { V.re[i + j * n] = xr[i]; if (V.im) V.im[i + j * n] = xi[i]; }
    }
    return { vals: { re: wr, im: anyIm ? wi : null }, V: M.narrow(V) };
  }

  // ---------- SVD (one-sided Jacobi) ----------
  function svd(A, full) {
    realOnly(A, 'svd');
    if (A.r < A.c) { const t = svd(M.transpose(A), full); return { U: t.V, s: t.s, V: t.U }; }
    const m = A.r, n = A.c, U = toRows(A), V = eye(n);
    for (let sweep = 0; sweep < 80; sweep++) {
      let rot = 0;
      for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
        let al = 0, be = 0, ga = 0; for (let i = 0; i < m; i++) { al += U[i][p] * U[i][p]; be += U[i][q] * U[i][q]; ga += U[i][p] * U[i][q]; }
        if (Math.abs(ga) <= 1e-15 * Math.sqrt(al * be) || ga === 0) continue;
        rot++;
        const zeta = (be - al) / (2 * ga), t = (zeta >= 0 ? 1 : -1) / (Math.abs(zeta) + Math.sqrt(1 + zeta * zeta)), c = 1 / Math.sqrt(1 + t * t), s = c * t;
        for (let i = 0; i < m; i++) { const up = U[i][p], uq = U[i][q]; U[i][p] = c * up - s * uq; U[i][q] = s * up + c * uq; }
        for (let i = 0; i < n; i++) { const vp = V[i][p], vq = V[i][q]; V[i][p] = c * vp - s * vq; V[i][q] = s * vp + c * vq; }
      }
      if (!rot) break;
    }
    const sv = []; for (let j = 0; j < n; j++) { let s = 0; for (let i = 0; i < m; i++) s += U[i][j] * U[i][j]; sv.push(Math.sqrt(s)); }
    const order = [...Array(n).keys()].sort((i, j) => sv[j] - sv[i]);
    const s = order.map(j => sv[j]), smax = s[0] || 0;
    const cols = order.map(j => { const c = U.map(r => r[j]); return sv[j] > smax * 1e-14 && sv[j] > 0 ? c.map(x => x / sv[j]) : null; });
    const Vo = V.map(r => order.map(j => r[j]));
    // complete U to an orthonormal basis (needed for zero singular values and the full m×m U)
    const basis = cols.filter(Boolean), want = full ? m : n;
    const filled = cols.slice();
    for (let e = 0; e < m && basis.length < want; e++) {
      const v = new Array(m).fill(0); v[e] = 1;
      for (const b of basis) { let d = 0; for (let i = 0; i < m; i++) d += b[i] * v[i]; for (let i = 0; i < m; i++) v[i] -= d * b[i]; }
      for (const b of basis) { let d = 0; for (let i = 0; i < m; i++) d += b[i] * v[i]; for (let i = 0; i < m; i++) v[i] -= d * b[i]; }
      let nv = 0; for (const x of v) nv += x * x; nv = Math.sqrt(nv); if (nv < 1e-8) continue;
      const u = v.map(x => x / nv); basis.push(u);
      const hole = filled.indexOf(null); if (hole >= 0) filled[hole] = u; else filled.push(u);
    }
    const Ucols = filled.slice(0, want);
    // sign convention: make the largest component of each V column... keep U·S·V' exact; flip pairs so the first nonzero of U is negative-free
    for (let j = 0; j < Math.min(n, Ucols.length); j++) {
      const u = Ucols[j]; let big = 0; for (let i = 0; i < m; i++) if (Math.abs(u[i]) > Math.abs(u[big]) + 1e-12) big = i;
      if (u[big] < 0) { Ucols[j] = u.map(x => -x); for (let i = 0; i < n; i++) Vo[i][j] = -Vo[i][j]; }
    }
    const Um = new Mat(m, want); Ucols.forEach((c, j) => c.forEach((v, i) => { Um.re[i + j * m] = v; }));
    return { U: Um, s, V: fromRows(Vo) };
  }

  // ---------- matrix exponential (Padé 6, scaling and squaring) ----------
  function expm(A) {
    realOnly(A, 'expm'); square(A, 'expm'); const n = A.r;
    let nrm = 0; for (let i = 0; i < n; i++) { let s = 0; for (let j = 0; j < n; j++) s += Math.abs(A.re[i + j * n]); nrm = Math.max(nrm, s); }
    const sc = Math.max(0, Math.ceil(Math.log2(nrm || 1)) + 1);
    const X = M.times(A, M.num(Math.pow(2, -sc)));
    const c = [1, 1 / 2, 5 / 44, 1 / 66, 1 / 792, 1 / 15840, 1 / 665280];
    const I = fromRows(eye(n)); let Xk = I, N = I, D = I;
    for (let k = 1; k <= 6; k++) { Xk = M.mtimes(Xk, X); const t = M.times(Xk, M.num(c[k])); N = M.plus(N, t); D = (k % 2) ? M.minus(D, t) : M.plus(D, t); }
    let E = solve(D, N).X; for (let k = 0; k < sc; k++) E = M.mtimes(E, E); return E;
  }

  const rcond = A => { realOnly(A, 'rcond'); square(A, 'rcond'); return A.r ? rcondLU(lu(A), A) : Infinity; };
  const api = { EPS, rcond, lu, luFactors, det, inv, solve, lstsq, qr, chol, eig, svd, expm, isSym };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LabLinalg = api;
})(typeof self !== 'undefined' ? self : this);
