// Lumen Stress — sparse linear algebra: node graphs, RCM ordering, CSR assembly, IC(0)-preconditioned CG,
// and LOBPCG for the lowest eigenpairs of K x = λ M x. Plain functions on typed arrays, usable in a worker and in Node.
(function (root, factory) { const m = factory(); if (typeof module === 'object' && module.exports) module.exports = m; else root.StressSparse = m; })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // node adjacency (incl. self) from element connectivity: elems = Int32Array(ne*npe)
  function nodeGraph(nn, elems, npe) {
    const ne = elems.length / npe, cnt = new Int32Array(nn + 1);
    // node → elements
    for (let i = 0; i < elems.length; i++) cnt[elems[i] + 1]++;
    for (let i = 0; i < nn; i++) cnt[i + 1] += cnt[i];
    const ne2 = new Int32Array(elems.length), fill = cnt.slice(0, nn);
    for (let e = 0; e < ne; e++) for (let k = 0; k < npe; k++) { const n = elems[e * npe + k]; ne2[fill[n]++] = e; }
    const mark = new Int32Array(nn).fill(-1), ptr = new Int32Array(nn + 1), tmp = [];
    let idx = new Int32Array(Math.max(16, nn * 12)), len = 0;
    for (let n = 0; n < nn; n++) {
      tmp.length = 0;
      for (let p = cnt[n]; p < cnt[n + 1]; p++) { const e = ne2[p]; for (let k = 0; k < npe; k++) { const m = elems[e * npe + k]; if (mark[m] !== n) { mark[m] = n; tmp.push(m); } } }
      if (!tmp.length) tmp.push(n);
      tmp.sort((a, b) => a - b);
      if (len + tmp.length > idx.length) { const g = new Int32Array(Math.max(idx.length * 2, len + tmp.length)); g.set(idx); idx = g; }
      for (const m of tmp) idx[len++] = m;
      ptr[n + 1] = len;
    }
    return { n: nn, ptr, idx: idx.slice(0, len) };
  }

  // reverse Cuthill–McKee ordering of a graph → order[k] = node placed at position k
  function rcm(g) {
    const n = g.n, deg = new Int32Array(n), done = new Uint8Array(n), order = new Int32Array(n); let head = 0, tail = 0;
    for (let i = 0; i < n; i++) deg[i] = g.ptr[i + 1] - g.ptr[i];
    const pseudoPeripheral = s => {   // a few BFS sweeps to find a far-away start node
      let start = s;
      for (let it = 0; it < 3; it++) {
        const lvl = new Int32Array(n).fill(-1), q = [start]; lvl[start] = 0; let last = start;
        for (let h = 0; h < q.length; h++) { const v = q[h]; for (let p = g.ptr[v]; p < g.ptr[v + 1]; p++) { const w = g.idx[p]; if (lvl[w] < 0) { lvl[w] = lvl[v] + 1; q.push(w); } } }
        const maxL = lvl[q[q.length - 1]]; let best = -1;
        for (const v of q) if (lvl[v] === maxL && (best < 0 || deg[v] < deg[best])) best = v;
        last = best; if (last === start) break; start = last;
      }
      return start;
    };
    for (let s0 = 0; s0 < n; s0++) {
      if (done[s0]) continue;
      // smallest-degree unvisited node in this component, then a peripheral node
      const s = pseudoPeripheral(s0);
      done[s] = 1; order[tail++] = s;
      while (head < tail) {
        const v = order[head++], nb = [];
        for (let p = g.ptr[v]; p < g.ptr[v + 1]; p++) { const w = g.idx[p]; if (!done[w]) { done[w] = 1; nb.push(w); } }
        nb.sort((a, b) => deg[a] - deg[b]);
        for (const w of nb) order[tail++] = w;
      }
    }
    order.reverse(); return order;
  }

  // CSR pattern for the reduced system: eq[node*dpn+c] = equation number or -1 (constrained)
  function buildCSR(g, dpn, eq, neq) {
    const rowCnt = new Int32Array(neq + 1);
    for (let n = 0; n < g.n; n++) for (let c = 0; c < dpn; c++) {
      const r = eq[n * dpn + c]; if (r < 0) continue; let k = 0;
      for (let p = g.ptr[n]; p < g.ptr[n + 1]; p++) { const m = g.idx[p]; for (let d = 0; d < dpn; d++) if (eq[m * dpn + d] >= 0) k++; }
      rowCnt[r + 1] = k;
    }
    for (let i = 0; i < neq; i++) rowCnt[i + 1] += rowCnt[i];
    const col = new Int32Array(rowCnt[neq]);
    for (let n = 0; n < g.n; n++) for (let c = 0; c < dpn; c++) {
      const r = eq[n * dpn + c]; if (r < 0) continue; let k = rowCnt[r];
      for (let p = g.ptr[n]; p < g.ptr[n + 1]; p++) { const m = g.idx[p]; for (let d = 0; d < dpn; d++) { const q = eq[m * dpn + d]; if (q >= 0) col[k++] = q; } }
      col.subarray(rowCnt[r], k).sort();
    }
    return { n: neq, ptr: rowCnt, col, val: new Float64Array(col.length) };
  }
  function find(A, r, c) {
    let lo = A.ptr[r], hi = A.ptr[r + 1] - 1; const col = A.col;
    while (lo <= hi) { const m = (lo + hi) >> 1, v = col[m]; if (v === c) return m; if (v < c) lo = m + 1; else hi = m - 1; }
    return -1;
  }
  // add a dense element matrix (size nd×nd, row-major) for local dofs mapped to equations eqs (−1 = skip)
  function addElement(A, eqs, Ke, nd, scale = 1) {
    for (let i = 0; i < nd; i++) {
      const r = eqs[i]; if (r < 0) continue;
      for (let j = 0; j < nd; j++) { const c = eqs[j]; if (c < 0) continue; const v = Ke[i * nd + j]; if (v !== 0) A.val[find(A, r, c)] += v * scale; }
    }
  }
  function matvec(A, x, y) {
    const { n, ptr, col, val } = A;
    for (let i = 0; i < n; i++) { let s = 0; for (let p = ptr[i]; p < ptr[i + 1]; p++) s += val[p] * x[col[p]]; y[i] = s; }
    return y;
  }
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  function diagOf(A) { const d = new Float64Array(A.n); for (let i = 0; i < A.n; i++) { const p = find(A, i, i); d[i] = p >= 0 ? A.val[p] : 0; } return d; }

  // incomplete Cholesky IC(0) of the symmetrically scaled matrix; retries with a diagonal shift on breakdown.
  function ic0(A) {
    const n = A.n, d = diagOf(A), s = new Float64Array(n);
    for (let i = 0; i < n; i++) s[i] = d[i] > 0 ? 1 / Math.sqrt(d[i]) : 1;
    // lower-triangle pattern (cols ≤ i), diagonal last in each row
    const lp = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) { let k = 0; for (let p = A.ptr[i]; p < A.ptr[i + 1]; p++) if (A.col[p] <= i) k++; lp[i + 1] = lp[i] + k; }
    const lc = new Int32Array(lp[n]), base = new Float64Array(lp[n]);
    for (let i = 0; i < n; i++) { let k = lp[i]; for (let p = A.ptr[i]; p < A.ptr[i + 1]; p++) { const c = A.col[p]; if (c <= i) { lc[k] = c; base[k++] = A.val[p] * s[i] * s[c]; } } }
    const L = new Float64Array(lp[n]), pos = new Int32Array(n).fill(-1);
    for (let shift = 0, attempt = 0; attempt < 8; attempt++, shift = shift ? shift * 10 : 1e-4) {
      L.set(base); let ok = true;
      for (let i = 0; i < n && ok; i++) {
        const a = lp[i], b = lp[i + 1] - 1;   // b = diagonal position
        for (let p = a; p < b; p++) pos[lc[p]] = p;
        for (let p = a; p < b; p++) {
          const k = lc[p]; let sum = L[p];
          // Σ_{j<k} L_ij L_kj over row k's pattern ∩ row i's pattern
          for (let q = lp[k]; q < lp[k + 1] - 1; q++) { const pj = pos[lc[q]]; if (pj >= 0 && pj < p) sum -= L[pj] * L[q]; }
          L[p] = sum / L[lp[k + 1] - 1];
        }
        let dd = L[b] * (1 + shift); for (let p = a; p < b; p++) dd -= L[p] * L[p];
        for (let p = a; p < b; p++) pos[lc[p]] = -1;
        if (!(dd > 1e-10)) { ok = false; break; }
        L[b] = Math.sqrt(dd);
      }
      if (ok) {
        const y = new Float64Array(n);
        const apply = (r, z) => {   // z = S (L Lᵀ)⁻¹ S r
          for (let i = 0; i < n; i++) { let t = r[i] * s[i]; for (let p = lp[i]; p < lp[i + 1] - 1; p++) t -= L[p] * y[lc[p]]; y[i] = t / L[lp[i + 1] - 1]; }
          for (let i = n - 1; i >= 0; i--) { const t = y[i] / L[lp[i + 1] - 1]; y[i] = t; for (let p = lp[i]; p < lp[i + 1] - 1; p++) y[lc[p]] -= L[p] * t; }
          for (let i = 0; i < n; i++) z[i] = y[i] * s[i];
          return z;
        };
        return { apply, shift, kind: 'IC(0)' };
      }
    }
    return jacobi(A);
  }
  function jacobi(A) { const d = diagOf(A); return { kind: 'Jacobi', shift: 0, apply: (r, z) => { for (let i = 0; i < r.length; i++) z[i] = d[i] > 0 ? r[i] / d[i] : r[i]; return z; } }; }

  // preconditioned conjugate gradients; returns {x, it, rel, ok}
  function pcg(A, b, { M, tol = 1e-9, maxIt = 20000, x0, onProgress } = {}) {
    const n = A.n, x = x0 ? Float64Array.from(x0) : new Float64Array(n), r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), q = new Float64Array(n);
    const bn = Math.sqrt(dot(b, b)); if (bn === 0) return { x, it: 0, rel: 0, ok: true };
    matvec(A, x, q); for (let i = 0; i < n; i++) r[i] = b[i] - q[i];
    M = M || jacobi(A); M.apply(r, z); p.set(z);
    let rz = dot(r, z), rel = Math.sqrt(dot(r, r)) / bn, it = 0;
    for (; it < maxIt && rel > tol; it++) {
      matvec(A, p, q); const pq = dot(p, q); if (!(pq > 0)) return { x, it, rel, ok: false, reason: 'matrix is not positive definite (the model can move freely — add supports)' };
      const al = rz / pq;
      for (let i = 0; i < n; i++) { x[i] += al * p[i]; r[i] -= al * q[i]; }
      rel = Math.sqrt(dot(r, r)) / bn;
      M.apply(r, z); const rz2 = dot(r, z), be = rz2 / rz; rz = rz2;
      for (let i = 0; i < n; i++) p[i] = z[i] + be * p[i];
      if (onProgress && it % 25 === 0) onProgress(it, rel);
    }
    return { x, it, rel, ok: rel <= tol * 10 };
  }

  // ---------- envelope (skyline) Cholesky: exact solver for narrow-band systems (RCM-ordered) ----------
  function envelopeStats(A) {
    let prof = 0, flops = 0;
    for (let i = 0; i < A.n; i++) { const w = i - A.col[A.ptr[i]] + 1; prof += w; flops += w * w / 2; }
    return { profile: prof, flops };
  }
  function skyline(A) {
    const n = A.n, first = new Int32Array(n), start = new Int32Array(n + 1);
    for (let i = 0; i < n; i++) { first[i] = Math.min(i, A.col[A.ptr[i]]); start[i + 1] = start[i] + (i - first[i] + 1); }
    const L = new Float64Array(start[n]);
    for (let i = 0; i < n; i++) for (let p = A.ptr[i]; p < A.ptr[i + 1]; p++) { const c = A.col[p]; if (c <= i) L[start[i] + c - first[i]] = A.val[p]; }
    for (let i = 0; i < n; i++) {
      const fi = first[i], oi = start[i] - fi;   // L[i][j] at oi + j
      for (let j = fi; j < i; j++) {
        const fj = first[j], oj = start[j] - fj, k0 = fi > fj ? fi : fj;
        let s0 = 0, s1 = 0, s2 = 0, s3 = 0, p = oi + k0, q = oj + k0; const pe = oi + j, pe4 = pe - 3;
        for (; p < pe4; p += 4, q += 4) { s0 += L[p] * L[q]; s1 += L[p + 1] * L[q + 1]; s2 += L[p + 2] * L[q + 2]; s3 += L[p + 3] * L[q + 3]; }
        for (; p < pe; p++, q++) s0 += L[p] * L[q];
        L[oi + j] = (L[oi + j] - (s0 + s1) - (s2 + s3)) / L[oj + j];
      }
      let d = L[oi + i]; for (let k = fi; k < i; k++) d -= L[oi + k] * L[oi + k];
      if (!(d > 0)) return null;   // not positive definite
      L[oi + i] = Math.sqrt(d);
    }
    const y = new Float64Array(n);
    const apply = (r, z) => {
      for (let i = 0; i < n; i++) { const fi = first[i], oi = start[i] - fi; let s = r[i]; for (let k = fi; k < i; k++) s -= L[oi + k] * y[k]; y[i] = s / L[oi + i]; }
      for (let i = n - 1; i >= 0; i--) { const fi = first[i], oi = start[i] - fi, v = y[i] / L[oi + i]; y[i] = v; for (let k = fi; k < i; k++) y[k] -= L[oi + k] * v; }
      z.set(y); return z;
    };
    return { apply, kind: 'Direct (skyline Cholesky)', shift: 0, exact: true };
  }

  // ---------- small dense helpers (row-major n×n) ----------
  // Jacobi eigenvalue algorithm for a symmetric matrix → {w (ascending), V (columns = vectors, row-major n×n)}
  function symEig(Ain, n) {
    const A = Float64Array.from(Ain), V = new Float64Array(n * n); for (let i = 0; i < n; i++) V[i * n + i] = 1;
    for (let sweep = 0; sweep < 100; sweep++) {
      let off = 0, tot = 0; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = A[i * n + j] * A[i * n + j]; tot += v; if (i !== j) off += v; }
      if (off <= 1e-26 * tot || off === 0) break;
      for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) {
        const apq = A[p * n + q]; if (Math.abs(apq) < 1e-300) continue;
        const app = A[p * n + p], aqq = A[q * n + q], th = (aqq - app) / (2 * apq), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) { const akp = A[k * n + p], akq = A[k * n + q]; A[k * n + p] = c * akp - s * akq; A[k * n + q] = s * akp + c * akq; }
        for (let k = 0; k < n; k++) { const apk = A[p * n + k], aqk = A[q * n + k]; A[p * n + k] = c * apk - s * aqk; A[q * n + k] = s * apk + c * aqk; }
        for (let k = 0; k < n; k++) { const vkp = V[k * n + p], vkq = V[k * n + q]; V[k * n + p] = c * vkp - s * vkq; V[k * n + q] = s * vkp + c * vkq; }
      }
    }
    const idx = [...Array(n).keys()].sort((a, b) => A[a * n + a] - A[b * n + b]), w = new Float64Array(n), W = new Float64Array(n * n);
    idx.forEach((k, j) => { w[j] = A[k * n + k]; for (let i = 0; i < n; i++) W[i * n + j] = V[i * n + k]; });
    return { w, V: W };
  }
  // inverse of a small dense matrix (Gauss–Jordan with pivoting)
  function inv(Ain, n) {
    const A = Float64Array.from(Ain), I = new Float64Array(n * n); for (let i = 0; i < n; i++) I[i * n + i] = 1;
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r * n + c]) > Math.abs(A[piv * n + c])) piv = r;
      if (piv !== c) for (let k = 0; k < n; k++) { [A[c * n + k], A[piv * n + k]] = [A[piv * n + k], A[c * n + k]]; [I[c * n + k], I[piv * n + k]] = [I[piv * n + k], I[c * n + k]]; }
      const d = A[c * n + c]; for (let k = 0; k < n; k++) { A[c * n + k] /= d; I[c * n + k] /= d; }
      for (let r = 0; r < n; r++) if (r !== c) { const f = A[r * n + c]; if (f) for (let k = 0; k < n; k++) { A[r * n + k] -= f * A[c * n + k]; I[r * n + k] -= f * I[c * n + k]; } }
    }
    return I;
  }

  // LOBPCG (Knyazev 2001) for the m lowest eigenpairs of K x = λ M x, with a preconditioner T ≈ K⁻¹.
  // Basis vectors are M-orthonormalised by two-pass Gram–Schmidt (vectors that collapse are dropped), then Rayleigh–Ritz.
  function lobpcg(K, M, m, T, { tol = 1e-6, maxIt = 400, onProgress, seed = 12345 } = {}) {
    const n = K.n, Kv = v => matvec(K, v, new Float64Array(n)), Mv = v => matvec(M, v, new Float64Array(n));
    let rnd = seed; const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff - 0.5; };
    const bs = Math.min(n, m + Math.min(4, Math.max(2, Math.ceil(m / 3))));
    let X = []; for (let j = 0; j < bs; j++) { const v = new Float64Array(n); for (let i = 0; i < n; i++) v[i] = rand(); X.push(v); }
    // M-orthonormalise list S (in place order), returns kept vectors with their M·v
    const orth = (S, against = [], againstM = []) => {
      const out = [], outM = [];
      for (const v0 of S) {
        const v = Float64Array.from(v0), nrm0 = Math.sqrt(dot(v, v)) || 1;
        for (let pass = 0; pass < 2; pass++) {
          for (let k = 0; k < against.length; k++) { const c = dot(againstM[k], v); for (let i = 0; i < n; i++) v[i] -= c * against[k][i]; }
          for (let k = 0; k < out.length; k++) { const c = dot(outM[k], v); for (let i = 0; i < n; i++) v[i] -= c * out[k][i]; }
        }
        if (!(Math.sqrt(dot(v, v)) > 1e-8 * nrm0)) continue;
        const mv = Mv(v), nrm = Math.sqrt(Math.max(0, dot(v, mv)));
        if (!(nrm > 0)) continue;
        for (let i = 0; i < n; i++) { v[i] /= nrm; mv[i] /= nrm; }
        out.push(v); outM.push(mv);
      }
      return { V: out, MV: outM };
    };
    let o = orth(X); X = o.V; let MX = o.MV, KX = X.map(Kv), P = [], lam = new Float64Array(X.length), it = 0, resid = [];
    // initial Rayleigh–Ritz
    const rr = (S, KS) => { const k = S.length, G = new Float64Array(k * k); for (let i = 0; i < k; i++) for (let j = i; j < k; j++) { const v = dot(S[i], KS[j]); G[i * k + j] = v; G[j * k + i] = v; } return symEig(G, k); };
    const combo = (S, C, k, col) => { const v = new Float64Array(n); for (let i = 0; i < k; i++) { const c = C[i * k + col]; if (c) for (let r = 0; r < n; r++) v[r] += c * S[i][r]; } return v; };
    { const e = rr(X, KX), k = X.length; const nX = [], nK = [], nM = []; for (let j = 0; j < k; j++) { nX.push(combo(X, e.V, k, j)); nK.push(combo(KX, e.V, k, j)); nM.push(combo(MX, e.V, k, j)); lam[j] = e.w[j]; } X = nX; KX = nK; MX = nM; }
    for (it = 0; it < maxIt; it++) {
      const R = [], active = []; resid = [];
      for (let j = 0; j < X.length; j++) {
        const r = new Float64Array(n); for (let i = 0; i < n; i++) r[i] = KX[j][i] - lam[j] * MX[j][i];
        const rn = Math.sqrt(dot(r, r)) / (Math.sqrt(dot(KX[j], KX[j])) || 1); resid.push(rn);
        if (rn > tol) { R.push(r); active.push(j); }
      }
      if (onProgress) onProgress(it, Math.max(...resid.slice(0, m)));
      if (!active.slice().some(j => j < m)) break;
      const W = R.map(r => T.apply(r, new Float64Array(n)));
      const ow = orth(W, X, MX), op = orth(P, X.concat(ow.V), MX.concat(ow.MV));
      const S = X.concat(ow.V, op.V), KS = KX.concat(ow.V.map(Kv), op.V.map(Kv)), MS = MX.concat(ow.MV, op.MV);
      const e = rr(S, KS), k = S.length, nx = X.length, nX = [], nK = [], nM = [], nP = [];
      for (let j = 0; j < nx; j++) {
        nX.push(combo(S, e.V, k, j)); nK.push(combo(KS, e.V, k, j)); nM.push(combo(MS, e.V, k, j)); lam[j] = e.w[j];
        // P = component outside the old X
        const Cp = Float64Array.from(e.V); for (let i = 0; i < nx; i++) Cp[i * k + j] = 0; nP.push(combo(S, Cp, k, j));
      }
      X = nX; KX = nK; MX = nM; P = nP;
    }
    return { lambda: Array.from(lam.slice(0, m)), X: X.slice(0, m), it, resid: resid.slice(0, m) };
  }

  return { nodeGraph, rcm, buildCSR, find, addElement, matvec, dot, diagOf, ic0, jacobi, pcg, envelopeStats, skyline, symEig, inv, lobpcg };
});
