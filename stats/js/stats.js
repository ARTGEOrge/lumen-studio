// Lumen Stats — statistical procedures on plain arrays (no dataset knowledge). Browser: window.LStat, Node: module.exports.
(function (root) {
  'use strict';
  const D = typeof module !== 'undefined' && module.exports ? require('./dist.js') : root.LDist;

  // ---------- basics ----------
  const sum = a => { let s = 0, c = 0; for (const v of a) { const y = v - c, t = s + y; c = (t - s) - y; s = t; } return s; };   // Kahan
  const mean = a => sum(a) / a.length;
  function variance(a, m) { const n = a.length; if (n < 2) return NaN; m = m ?? mean(a); let s = 0, c = 0; for (const v of a) { const d = v - m; s += d * d; c += d; } return (s - c * c / n) / (n - 1); }
  const sd = a => Math.sqrt(variance(a));
  const sorted = a => Float64Array.from(a).sort();
  // SPSS "HAVERAGE" percentile (position p·(n+1)); also Minitab's quartile definition
  function quantile(s, p) {
    const n = s.length; if (!n) return NaN; if (n === 1) return s[0];
    const w = p * (n + 1), k = Math.floor(w), f = w - k;
    if (k < 1) return s[0]; if (k >= n) return s[n - 1];
    return s[k - 1] + f * (s[k] - s[k - 1]);
  }
  const median = s => { const n = s.length; if (!n) return NaN; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
  function modes(a) { const m = new Map(); a.forEach(v => m.set(v, (m.get(v) || 0) + 1)); let best = 0; m.forEach(c => best = Math.max(best, c)); const out = []; m.forEach((c, v) => c === best && out.push(v)); return { values: out.sort((x, y) => x - y), count: best }; }
  // average ranks (1-based) + tie groups
  function rank(a) {
    const n = a.length, idx = Array.from({ length: n }, (_, i) => i).sort((i, j) => a[i] - a[j]);
    const r = new Float64Array(n), ties = [];
    for (let i = 0; i < n;) {
      let j = i; while (j + 1 < n && a[idx[j + 1]] === a[idx[i]]) j++;
      const rv = (i + j + 2) / 2; for (let k = i; k <= j; k++) r[idx[k]] = rv;
      if (j > i) ties.push(j - i + 1); i = j + 1;
    }
    return { r, ties };
  }
  const tieSum = ties => ties.reduce((s, t) => s + t * t * t - t, 0);

  function describe(x) {
    const n = x.length, s = sorted(x);
    const o = { n, sum: sum(x), mean: NaN, sd: NaN, variance: NaN, se: NaN, min: s[0], max: s[n - 1], range: s[n - 1] - s[0], median: median(s), q1: quantile(s, 0.25), q3: quantile(s, 0.75), skew: NaN, seSkew: NaN, kurt: NaN, seKurt: NaN };
    if (!n) return o;
    o.mean = o.sum / n; o.iqr = o.q3 - o.q1;
    if (n > 1) { o.variance = variance(x, o.mean); o.sd = Math.sqrt(o.variance); o.se = o.sd / Math.sqrt(n); }
    if (n > 2 && o.sd > 0) {
      let m3 = 0, m4 = 0; for (const v of x) { const z = (v - o.mean) / o.sd; m3 += z * z * z; m4 += z * z * z * z; }
      o.skew = n / ((n - 1) * (n - 2)) * m3;
      o.seSkew = Math.sqrt(6 * n * (n - 1) / ((n - 2) * (n + 1) * (n + 3)));
      if (n > 3) {
        o.kurt = n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * m4 - 3 * (n - 1) * (n - 1) / ((n - 2) * (n - 3));
        o.seKurt = 2 * o.seSkew * Math.sqrt((n * n - 1) / ((n - 3) * (n + 5)));
      }
    }
    const md = modes(x); o.mode = md.values[0]; o.multiMode = md.values.length > 1;
    return o;
  }

  // ---------- t-tests ----------
  function tOne(x, mu = 0, conf = 0.95) {
    const d = describe(x), df = d.n - 1, t = (d.mean - mu) / d.se, tc = D.qt(1 - (1 - conf) / 2, df);
    return { ...d, mu, df, t, p: D.pt2(t, df), md: d.mean - mu, lo: d.mean - mu - tc * d.se, hi: d.mean - mu + tc * d.se, cohenD: (d.mean - mu) / d.sd };
  }
  // Levene's test for equal variances: center 'mean' (SPSS) or 'median' (Brown–Forsythe)
  function levene(groups, center = 'mean') {
    const z = groups.map(g => { const c = center === 'median' ? median(sorted(g)) : mean(g); return g.map(v => Math.abs(v - c)); });
    const a = anovaCore(z); return { F: a.F, df1: a.dfB, df2: a.dfW, p: a.p };
  }
  function tInd(x, y, conf = 0.95) {
    const a = describe(x), b = describe(y), n1 = a.n, n2 = b.n, md = a.mean - b.mean, q = 1 - (1 - conf) / 2;
    const sp2 = ((n1 - 1) * a.variance + (n2 - 1) * b.variance) / (n1 + n2 - 2), se = Math.sqrt(sp2 * (1 / n1 + 1 / n2)), df = n1 + n2 - 2;
    const t = md / se, tc = D.qt(q, df);
    const v1 = a.variance / n1, v2 = b.variance / n2, seW = Math.sqrt(v1 + v2), dfW = (v1 + v2) ** 2 / (v1 * v1 / (n1 - 1) + v2 * v2 / (n2 - 1)), tW = md / seW, tcW = D.qt(q, dfW);
    const lev = levene([x, y]);
    const sp = Math.sqrt(sp2), d = md / sp, J = 1 - 3 / (4 * df - 1);
    return { a, b, md, levene: lev,
      pooled: { t, df, p: D.pt2(t, df), se, lo: md - tc * se, hi: md + tc * se },
      welch: { t: tW, df: dfW, p: D.pt2(tW, dfW), se: seW, lo: md - tcW * seW, hi: md + tcW * seW },
      cohenD: d, hedgesG: d * J, sp };
  }
  function tPaired(x, y, conf = 0.95) {
    const d = x.map((v, i) => v - y[i]), r = pearson(x, y), o = tOne(d, 0, conf);
    return { ...o, a: describe(x), b: describe(y), r: r.r, pr: r.p };
  }

  // ---------- ANOVA ----------
  function anovaCore(groups) {
    const k = groups.length, all = groups.flat(), N = all.length, gm = mean(all);
    let ssb = 0, ssw = 0;
    groups.forEach(g => { const m = mean(g); ssb += g.length * (m - gm) ** 2; g.forEach(v => ssw += (v - m) ** 2); });
    const dfB = k - 1, dfW = N - k, msb = ssb / dfB, msw = ssw / dfW, F = msb / msw;
    return { k, N, ssb, ssw, sst: ssb + ssw, dfB, dfW, msb, msw, F, p: D.pfUpper(F, dfB, dfW), grand: gm };
  }
  function welchAnova(groups) {
    const k = groups.length, st = groups.map(describe);
    const w = st.map(s => s.n / s.variance), W = sum(w), mw = sum(st.map((s, i) => w[i] * s.mean)) / W;
    const A = sum(st.map((s, i) => w[i] * (s.mean - mw) ** 2)) / (k - 1);
    const L = sum(st.map((s, i) => (1 - w[i] / W) ** 2 / (s.n - 1)));
    const F = A / (1 + 2 * (k - 2) / (k * k - 1) * L), df2 = (k * k - 1) / (3 * L);
    return { F, df1: k - 1, df2, p: D.pfUpper(F, k - 1, df2) };
  }
  function anova1(groups, conf = 0.95) {
    const a = anovaCore(groups), q = 1 - (1 - conf) / 2;
    const stats = groups.map(g => { const d = describe(g), tc = d.n > 1 ? D.qt(q, d.n - 1) : NaN; return { ...d, lo: d.mean - tc * d.se, hi: d.mean + tc * d.se }; });
    const ok = stats.every(s => s.n > 1 && s.variance > 0);
    return { ...a, stats, eta2: a.ssb / a.sst, omega2: (a.ssb - a.dfB * a.msw) / (a.sst + a.msw),
      levene: groups.every(g => g.length > 1) ? levene(groups) : null, welch: ok ? welchAnova(groups) : null };
  }
  // pairwise comparisons from group summaries {n, mean}; method 'tukey' (Tukey–Kramer) or 'bonferroni'
  function posthoc(stats, mse, dfE, method = 'tukey', conf = 0.95) {
    const k = stats.length, out = [], m = k * (k - 1) / 2;
    const qc = method === 'tukey' ? D.qtukey(conf, k, dfE) / Math.SQRT2 : D.qt(1 - (1 - conf) / (2 * m), dfE);
    for (let i = 0; i < k; i++) for (let j = i + 1; j < k; j++) {
      const a = stats[i], b = stats[j], diff = a.mean - b.mean, se = Math.sqrt(mse * (1 / a.n + 1 / b.n));
      const p = method === 'tukey' ? D.ptukeyUpper(Math.abs(diff) / se * Math.SQRT2, k, dfE) : Math.min(1, m * D.pt2(diff / se, dfE));
      out.push({ i, j, diff, se, p, lo: diff - qc * se, hi: diff + qc * se });
    }
    return out;
  }

  // ---------- non-parametric ----------
  function kruskal(groups) {
    const all = groups.flat(), N = all.length, { r, ties } = rank(all);
    let off = 0; const R = groups.map(g => { let s = 0; for (let i = 0; i < g.length; i++) s += r[off + i]; off += g.length; return s; });
    let H = 12 / (N * (N + 1)) * sum(R.map((s, i) => s * s / groups[i].length)) - 3 * (N + 1);
    const C = 1 - tieSum(ties) / (N * N * N - N); H /= C;
    const df = groups.length - 1;
    return { H, df, p: D.pchisqUpper(H, df), N, meanRanks: R.map((s, i) => s / groups[i].length), n: groups.map(g => g.length), epsilon2: H / ((N * N - 1) / (N + 1)) };
  }
  const EXACT_MAX = 60;
  function mannWhitney(x, y) {
    const n1 = x.length, n2 = y.length, N = n1 + n2, { r, ties } = rank([...x, ...y]);
    let R1 = 0; for (let i = 0; i < n1; i++) R1 += r[i];
    const R2 = N * (N + 1) / 2 - R1, U1 = R1 - n1 * (n1 + 1) / 2, U2 = n1 * n2 - U1, U = Math.min(U1, U2);
    const W = U === U1 ? R1 : R2;
    const varU = n1 * n2 / 12 * ((N + 1) - tieSum(ties) / (N * (N - 1)));
    const z = (U - n1 * n2 / 2) / Math.sqrt(varU);
    const o = { n1, n2, R1, R2, mr1: R1 / n1, mr2: R2 / n2, U, U1, W, z, p: 2 * D.pnormUpper(Math.abs(z)), r: Math.abs(z) / Math.sqrt(N), ties: ties.length > 0 };
    if (N <= EXACT_MAX) {
      const scores = Array.from(r, v => Math.round(2 * v)), dist = D.rankSumDist(scores, n1), E = n1 * (N + 1), s = Math.round(2 * R1), dev = Math.abs(s - E);
      let p = 0; for (let k = 0; k < dist.length; k++) if (dist[k] && Math.abs(k - E) >= dev - 1e-9) p += dist[k];
      o.pExact = Math.min(1, p);
    }
    return o;
  }
  // Wilcoxon signed-rank on differences x − y (zeros dropped, as SPSS)
  function wilcoxon(x, y) {
    const d = x.map((v, i) => v - (Array.isArray(y) || ArrayBuffer.isView(y) ? y[i] : y)).filter(v => v !== 0);
    const n = d.length, zeros = x.length - n;
    if (!n) return { n, zeros, Tpos: 0, Tneg: 0, z: NaN, p: 1 };
    const { r, ties } = rank(d.map(Math.abs));
    let Tp = 0, Tn = 0, np = 0; d.forEach((v, i) => { if (v > 0) { Tp += r[i]; np++; } else Tn += r[i]; });
    const mu = n * (n + 1) / 4, v = n * (n + 1) * (2 * n + 1) / 24 - tieSum(ties) / 48, T = Math.min(Tp, Tn);
    const z = (T - mu) / Math.sqrt(v);
    const o = { n, zeros, npos: np, nneg: n - np, Tpos: Tp, Tneg: Tn, mrPos: np ? Tp / np : 0, mrNeg: n - np ? Tn / (n - np) : 0, T, z, p: 2 * D.pnormUpper(Math.abs(z)), r: Math.abs(z) / Math.sqrt(x.length), ties: ties.length > 0 };
    if (n <= EXACT_MAX) {
      const scores = Array.from(r, v => Math.round(2 * v)), dist = D.signedRankDist(scores), E = n * (n + 1) / 2, s = Math.round(2 * Tp), dev = Math.abs(s - E);
      let p = 0; for (let k = 0; k < dist.length; k++) if (dist[k] && Math.abs(k - E) >= dev - 1e-9) p += dist[k];
      o.pExact = Math.min(1, p);
    }
    return o;
  }

  // ---------- contingency tables ----------
  function fisher2x2(a, b, c, d) {
    const r1 = a + b, c1 = a + c, N = a + b + c + d, lo = Math.max(0, r1 + c1 - N), hi = Math.min(r1, c1);
    const p0 = D.dhyper(a, c1, N, r1); let two = 0, less = 0, greater = 0;
    for (let x = lo; x <= hi; x++) { const p = D.dhyper(x, c1, N, r1); if (p <= p0 * (1 + 1e-7)) two += p; if (x <= a) less += p; if (x >= a) greater += p; }
    return { p: Math.min(1, two), pLess: Math.min(1, less), pGreater: Math.min(1, greater) };
  }
  // table: rows × cols counts; rowScores/colScores optional numeric scores for linear-by-linear
  function chiSquare(table, rowScores, colScores) {
    const R = table.length, C = table[0].length, rt = table.map(r => sum(r)), ct = table[0].map((_, j) => sum(table.map(r => r[j]))), N = sum(rt);
    const E = table.map((r, i) => r.map((_, j) => rt[i] * ct[j] / N));
    let X2 = 0, G2 = 0, small = 0, minE = Infinity;
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
      const o = table[i][j], e = E[i][j]; minE = Math.min(minE, e); if (e < 5) small++;
      if (e > 0) X2 += (o - e) ** 2 / e; if (o > 0) G2 += 2 * o * Math.log(o / e);
    }
    const df = (R - 1) * (C - 1);
    const out = { R, C, N, rt, ct, E, X2, df, p: D.pchisqUpper(X2, df), G2, pG2: D.pchisqUpper(G2, df), small, minE, cells: R * C,
      phi: Math.sqrt(X2 / N), V: Math.sqrt(X2 / (N * Math.max(1, Math.min(R, C) - 1))), CC: Math.sqrt(X2 / (X2 + N)) };
    out.stdRes = table.map((r, i) => r.map((o, j) => (o - E[i][j]) / Math.sqrt(E[i][j])));
    out.adjRes = table.map((r, i) => r.map((o, j) => (o - E[i][j]) / Math.sqrt(E[i][j] * (1 - rt[i] / N) * (1 - ct[j] / N))));
    if (R === 2 && C === 2) {
      const [[a, b], [c, d]] = table, den = rt[0] * rt[1] * ct[0] * ct[1];
      const adbc = Math.abs(a * d - b * c), yates = adbc > N / 2 ? N * (adbc - N / 2) ** 2 / den : 0;
      out.yates = yates; out.pYates = D.pchisqUpper(yates, 1); out.fisher = fisher2x2(a, b, c, d);
      out.phi = (a * d - b * c) / Math.sqrt(den);
    }
    if (R > 1 && C > 1) {   // linear-by-linear association = (N − 1) r²
      const rs = rowScores || table.map((_, i) => i + 1), cs = colScores || table[0].map((_, j) => j + 1);
      let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
      for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) { const w = table[i][j]; sx += w * rs[i]; sy += w * cs[j]; sxx += w * rs[i] ** 2; syy += w * cs[j] ** 2; sxy += w * rs[i] * cs[j]; }
      const r = (sxy - sx * sy / N) / Math.sqrt((sxx - sx * sx / N) * (syy - sy * sy / N));
      out.LL = (N - 1) * r * r; out.pLL = D.pchisqUpper(out.LL, 1);
    }
    return out;
  }
  // chi-square goodness of fit (observed counts, expected proportions)
  function chiGof(obs, props) {
    const N = sum(obs), ps = props || obs.map(() => 1 / obs.length), tot = sum(ps), E = ps.map(p => p / tot * N);
    const X2 = sum(obs.map((o, i) => (o - E[i]) ** 2 / E[i])), df = obs.length - 1;
    return { N, E, X2, df, p: D.pchisqUpper(X2, df) };
  }

  // ---------- correlation ----------
  function pearson(x, y, conf = 0.95) {
    const n = x.length, mx = mean(x), my = mean(y);
    let sxx = 0, syy = 0, sxy = 0; for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxx += a * a; syy += b * b; sxy += a * b; }
    const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy))), df = n - 2;
    const t = r * Math.sqrt(df / Math.max(1e-300, 1 - r * r)), p = n > 2 ? (Math.abs(r) === 1 ? 0 : D.pt2(t, df)) : NaN;
    const z = Math.atanh(r), zc = D.qnorm(1 - (1 - conf) / 2) / Math.sqrt(n - 3);
    return { r, n, t, df, p, lo: Math.tanh(z - zc), hi: Math.tanh(z + zc), cov: sxy / (n - 1) };
  }
  function spearman(x, y) { const o = pearson(rank(x).r, rank(y).r); return { rho: o.r, r: o.r, n: o.n, t: o.t, df: o.df, p: o.p }; }
  function kendall(x, y) {   // tau-b with the normal approximation (ties-corrected variance)
    const n = x.length; let C = 0, Dn = 0, tx = 0, ty = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = Math.sign(x[i] - x[j]), b = Math.sign(y[i] - y[j]);
      if (a && b) { if (a === b) C++; else Dn++; } else if (!a && b) tx++; else if (a && !b) ty++;
    }
    const n0 = n * (n - 1) / 2, tauB = (C - Dn) / Math.sqrt((C + Dn + tx) * (C + Dn + ty));
    const tg = arr => { const m = new Map(); arr.forEach(v => m.set(v, (m.get(v) || 0) + 1)); return [...m.values()].filter(c => c > 1); };
    const T = tg(x), U = tg(y), v0 = n * (n - 1) * (2 * n + 5), vt = sum(T.map(t => t * (t - 1) * (2 * t + 5))), vu = sum(U.map(u => u * (u - 1) * (2 * u + 5)));
    const v1 = sum(T.map(t => t * (t - 1))) * sum(U.map(u => u * (u - 1))) / (2 * n * (n - 1));
    const v2 = sum(T.map(t => t * (t - 1) * (t - 2))) * sum(U.map(u => u * (u - 1) * (u - 2))) / (9 * n * (n - 1) * (n - 2));
    const v = (v0 - vt - vu) / 18 + v1 + v2, z = (C - Dn) / Math.sqrt(v);
    return { tau: tauB, n, z, p: 2 * D.pnormUpper(Math.abs(z)), n0 };
  }

  // ---------- linear algebra ----------
  // Householder QR least squares. X: array of columns (Float64Array), y: Float64Array. Returns {b, R, rank, ok}
  function qrSolve(cols, y) {
    const n = y.length, p = cols.length, A = cols.map(c => Float64Array.from(c)), qy = Float64Array.from(y), Rd = new Float64Array(p);
    const scale = cols.map(c => Math.sqrt(c.reduce((s, v) => s + v * v, 0)) || 1);
    let rankDef = -1;
    for (let k = 0; k < p; k++) {
      const a = A[k]; let nrm = 0; for (let i = k; i < n; i++) nrm += a[i] * a[i]; nrm = Math.sqrt(nrm);
      if (nrm <= 1e-11 * scale[k]) { rankDef = k; break; }
      const alpha = a[k] > 0 ? -nrm : nrm;
      a[k] -= alpha; let vnorm = 0; for (let i = k; i < n; i++) vnorm += a[i] * a[i];
      Rd[k] = alpha;
      const apply = c => { let s = 0; for (let i = k; i < n; i++) s += a[i] * c[i]; s = 2 * s / vnorm; for (let i = k; i < n; i++) c[i] -= s * a[i]; };
      for (let j = k + 1; j < p; j++) apply(A[j]);
      apply(qy);
      // check remaining columns' residual norms relative to their scale
    }
    if (rankDef >= 0) return { ok: false, bad: rankDef };
    const R = Array.from({ length: p }, (_, i) => Float64Array.from({ length: p }, (_, j) => j < i ? 0 : j === i ? Rd[i] : A[j][i]));
    const b = new Float64Array(p);
    for (let i = p - 1; i >= 0; i--) { let s = qy[i]; for (let j = i + 1; j < p; j++) s -= R[i][j] * b[j]; b[i] = s / R[i][i]; }
    let sse = 0; for (let i = p; i < n; i++) sse += qy[i] * qy[i];
    return { ok: true, b, R, sse };
  }
  function invUpper(R) {   // inverse of an upper-triangular matrix
    const p = R.length, X = Array.from({ length: p }, () => new Float64Array(p));
    for (let j = 0; j < p; j++) { X[j][j] = 1 / R[j][j]; for (let i = j - 1; i >= 0; i--) { let s = 0; for (let k = i + 1; k <= j; k++) s += R[i][k] * X[k][j]; X[i][j] = -s / R[i][i]; } }
    return X;
  }
  // inverse of a symmetric positive-definite matrix (Gauss–Jordan with partial pivoting; fine for p ≤ ~200)
  function invert(M) {
    const n = M.length, A = M.map((r, i) => { const a = new Float64Array(2 * n); a.set(r); a[n + i] = 1; return a; });
    for (let c = 0; c < n; c++) {
      let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      if (Math.abs(A[piv][c]) < 1e-300) return null;
      [A[c], A[piv]] = [A[piv], A[c]];
      const d = A[c][c]; for (let j = 0; j < 2 * n; j++) A[c][j] /= d;
      for (let r = 0; r < n; r++) if (r !== c && A[r][c]) { const f = A[r][c]; for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[c][j]; }
    }
    return A.map(r => Float64Array.from(r.subarray(n)));
  }

  // ---------- linear regression ----------
  // y: numbers, X: array of predictor columns, names: predictor names
  function linreg(y, X, names, conf = 0.95) {
    const n = y.length, k = X.length, p = k + 1;
    const cols = [new Float64Array(n).fill(1), ...X.map(c => Float64Array.from(c))];
    const qr = qrSolve(cols, Float64Array.from(y));
    if (!qr.ok) return { error: qr.bad === 0 ? 'The model has no usable intercept.' : `Predictor “${names[qr.bad - 1]}” is constant or a linear combination of the others (perfect collinearity).` };
    const { b, R } = qr, Ri = invUpper(R);
    const XtXi = Array.from({ length: p }, (_, i) => Float64Array.from({ length: p }, (_, j) => { let s = 0; for (let m = Math.max(i, j); m < p; m++) s += Ri[i][m] * Ri[j][m]; return s; }));
    const my = mean(y), fit = new Float64Array(n), res = new Float64Array(n), lev = new Float64Array(n);
    let sse = 0, sst = 0;
    for (let i = 0; i < n; i++) {
      let f = 0; for (let j = 0; j < p; j++) f += cols[j][i] * b[j];
      fit[i] = f; res[i] = y[i] - f; sse += res[i] ** 2; sst += (y[i] - my) ** 2;
      let h = 0; for (let j = 0; j < p; j++) { let s = 0; for (let m = 0; m <= j; m++) s += cols[m][i] * Ri[m][j]; h += s * s; } lev[i] = h;
    }
    const dfR = k, dfE = n - p, ssr = sst - sse, mse = sse / dfE, F = (ssr / dfR) / mse;
    const r2 = 1 - sse / sst, adj = 1 - (1 - r2) * (n - 1) / dfE, see = Math.sqrt(mse), tc = D.qt(1 - (1 - conf) / 2, dfE);
    const sy = Math.sqrt(sst / (n - 1)), sx = X.map(c => sd(c));
    let vif = X.map(() => 1);
    if (k > 1) {   // VIF = diagonal of the inverse predictor correlation matrix
      const Rm = X.map((a, i) => X.map((c, j) => i === j ? 1 : pearson(a, c).r)), Ri2 = invert(Rm);
      if (Ri2) vif = Ri2.map((r, i) => r[i]);
    }
    const coef = Array.from(b, (bj, j) => {
      const se = Math.sqrt(mse * XtXi[j][j]), t = bj / se;
      return { name: j ? names[j - 1] : '(Constant)', b: bj, se, beta: j ? bj * sx[j - 1] / sy : null, t, p: D.pt2(t, dfE), lo: bj - tc * se, hi: bj + tc * se, vif: j ? vif[j - 1] : null, tol: j ? 1 / vif[j - 1] : null };
    });
    let dw = 0; for (let i = 1; i < n; i++) dw += (res[i] - res[i - 1]) ** 2; dw /= sse;
    const zres = res.map(e => e / see), sres = res.map((e, i) => e / (see * Math.sqrt(Math.max(1e-300, 1 - lev[i]))));
    const cook = res.map((e, i) => e * e / (p * mse) * lev[i] / (1 - lev[i]) ** 2);
    return { n, k, p, coef, r: Math.sqrt(Math.max(0, r2)), r2, adj, see, sse, ssr, sst, dfR, dfE, msr: ssr / dfR, mse, F, pF: k ? D.pfUpper(F, dfR, dfE) : NaN, dw, fit, res, zres, sres, lev, cook, cov: XtXi.map(r => r.map(v => v * mse)) };
  }

  // ---------- binary logistic regression (Newton–Raphson) ----------
  function logreg(y, X, names, conf = 0.95) {
    const n = y.length, k = X.length, p = k + 1, cols = [new Float64Array(n).fill(1), ...X.map(c => Float64Array.from(c))];
    const ybar = mean(y);
    if (ybar === 0 || ybar === 1) return { error: 'The dependent variable has only one value among the cases used.' };
    let b = new Float64Array(p); b[0] = Math.log(ybar / (1 - ybar));
    const ll = bb => { let s = 0; for (let i = 0; i < n; i++) { let eta = 0; for (let j = 0; j < p; j++) eta += cols[j][i] * bb[j]; s += y[i] ? -Math.log1p(Math.exp(-eta)) : -Math.log1p(Math.exp(eta)); } return s; };
    let L = ll(b), it = 0, info = null, converged = false, warn = '';
    const ll0 = n * (ybar * Math.log(ybar) + (1 - ybar) * Math.log(1 - ybar));
    for (it = 1; it <= 50; it++) {
      const g = new Float64Array(p), H = Array.from({ length: p }, () => new Float64Array(p));
      for (let i = 0; i < n; i++) {
        let eta = 0; for (let j = 0; j < p; j++) eta += cols[j][i] * b[j];
        const pi = 1 / (1 + Math.exp(-eta)), w = pi * (1 - pi), r = y[i] - pi;
        for (let j = 0; j < p; j++) { const xj = cols[j][i]; g[j] += xj * r; const wx = w * xj; for (let m = 0; m <= j; m++) H[j][m] += wx * cols[m][i]; }
      }
      for (let j = 0; j < p; j++) for (let m = j + 1; m < p; m++) H[j][m] = H[m][j];
      info = invert(H); if (!info) return { error: 'The information matrix is singular — check predictors for collinearity or constant values.' };
      const step = new Float64Array(p); for (let j = 0; j < p; j++) { let s = 0; for (let m = 0; m < p; m++) s += info[j][m] * g[m]; step[j] = s; }
      let nb, nL, half = 1;
      for (let h = 0; h < 30; h++) { nb = b.map((v, j) => v + half * step[j]); nL = ll(nb); if (nL >= L - 1e-12) break; half /= 2; }
      const dL = nL - L; b = nb; L = nL;
      if (Math.abs(dL) < 1e-10 * (Math.abs(L) + 1e-10) && Math.max(...step.map(Math.abs)) * half < 1e-6) { converged = true; break; }
    }
    if (!converged) warn = 'Estimation stopped at the iteration limit; the estimates may not be reliable (possible complete separation).';
    if (b.some(v => Math.abs(v) > 30)) warn = warn || 'Very large coefficients — the outcome may be (quasi-)completely separated by a predictor.';
    // final information matrix at the solution
    const H = Array.from({ length: p }, () => new Float64Array(p)), prob = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let eta = 0; for (let j = 0; j < p; j++) eta += cols[j][i] * b[j];
      const pi = 1 / (1 + Math.exp(-eta)); prob[i] = pi; const w = pi * (1 - pi);
      for (let j = 0; j < p; j++) for (let m = 0; m < p; m++) H[j][m] += w * cols[j][i] * cols[m][i];
    }
    info = invert(H) || info;
    const z = D.qnorm(1 - (1 - conf) / 2);
    const coef = Array.from(b, (bj, j) => { const se = Math.sqrt(info[j][j]), wald = (bj / se) ** 2; return { name: j ? names[j - 1] : 'Constant', b: bj, se, wald, df: 1, p: D.pchisqUpper(wald, 1), or: Math.exp(bj), lo: Math.exp(bj - z * se), hi: Math.exp(bj + z * se) }; });
    const m2ll = -2 * L, m2ll0 = -2 * ll0, chi = m2ll0 - m2ll;
    const cs = 1 - Math.exp(-chi / n), nag = cs / (1 - Math.exp(-m2ll0 / n));
    // classification at 0.5
    const cls = [[0, 0], [0, 0]]; for (let i = 0; i < n; i++) cls[y[i] ? 1 : 0][prob[i] >= 0.5 ? 1 : 0]++;
    return { n, k, coef, m2ll, m2ll0, chi, df: k, pChi: D.pchisqUpper(chi, k), cs, nag, iterations: it, converged, warn, cls, prob, hl: hosmerLemeshow(y, prob), aic: m2ll + 2 * p };
  }
  function hosmerLemeshow(y, prob, G = 10) {
    const n = y.length, idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => prob[a] - prob[b]);
    const groups = []; let cur = null, start = 0;
    for (let i = 0; i < n;) {
      let j = i; while (j + 1 < n && prob[idx[j + 1]] === prob[idx[i]]) j++;
      const g = Math.min(G - 1, Math.floor(start * G / n));
      if (!cur || cur.g !== g) { cur = { g, n: 0, o1: 0, e1: 0 }; groups.push(cur); }
      for (let m = i; m <= j; m++) { cur.n++; cur.o1 += y[idx[m]]; cur.e1 += prob[idx[m]]; }
      start = j + 1; i = j + 1;
    }
    let chi = 0; groups.forEach(g => { const e0 = g.n - g.e1, o0 = g.n - g.o1; if (g.e1 > 0) chi += (g.o1 - g.e1) ** 2 / g.e1; if (e0 > 0) chi += (o0 - e0) ** 2 / e0; });
    const df = groups.length - 2;
    return { chi, df, p: df > 0 ? D.pchisqUpper(chi, df) : NaN, groups };
  }

  // ---------- factorial ANOVA (general linear model, Type III sums of squares) ----------
  // y: numbers; factors: [{name, codes: Int32Array (0..L-1), levels: [labels]}]; covariates: [{name, x}]
  function glm(y, factors, covariates = [], conf = 0.95) {
    const n = y.length;
    // effect (sum-to-zero) coding
    const fcols = factors.map(f => { const L = f.levels.length, cs = []; for (let j = 0; j < L - 1; j++) cs.push(Float64Array.from(f.codes, c => c === j ? 1 : c === L - 1 ? -1 : 0)); return cs; });
    const terms = [];
    const F = factors.length;
    for (let mask = 1; mask < 1 << F; mask++) {
      const ids = []; for (let i = 0; i < F; i++) if (mask & 1 << i) ids.push(i);
      let cols = [new Float64Array(n).fill(1)];
      ids.forEach(i => { const nc = []; cols.forEach(c => fcols[i].forEach(f => nc.push(c.map((v, r) => v * f[r])))); cols = nc; });
      terms.push({ name: ids.map(i => factors[i].name).join(' * '), ids, cols, order: ids.length });
    }
    terms.sort((a, b) => a.order - b.order);
    covariates.forEach(c => terms.unshift({ name: c.name, ids: [], cols: [Float64Array.from(c.x)], order: 0, cov: true }));
    // every cell must be present for Type III (no empty cells)
    const cellKey = r => factors.map(f => f.codes[r]).join(','), cells = new Map();
    for (let r = 0; r < n; r++) { const k = cellKey(r); if (!cells.has(k)) cells.set(k, []); cells.get(k).push(y[r]); }
    const nCells = factors.reduce((p, f) => p * f.levels.length, 1);
    if (cells.size < nCells) return { error: `Only ${cells.size} of the ${nCells} factor-level combinations have data. Type III sums of squares need at least one case in every cell — drop the interaction-heavy factor or merge levels.` };
    const one = new Float64Array(n).fill(1);
    const fit = (dropTerm, dropInt) => { const cols = [...(dropInt ? [] : [one]), ...terms.filter(t => t !== dropTerm).flatMap(t => t.cols)]; return qrSolve(cols, Float64Array.from(y)); };
    const full = fit(null, false);
    if (!full.ok) return { error: 'The design matrix is singular (a covariate may be collinear with the factors).' };
    const p = 1 + terms.reduce((s, t) => s + t.cols.length, 0), dfE = n - p;
    if (dfE < 1) return { error: 'Not enough cases: the error term has no degrees of freedom (need more than one case per cell).' };
    const sse = full.sse, mse = sse / dfE, my = mean(y), sst = y.reduce((s, v) => s + (v - my) ** 2, 0), ssTot = y.reduce((s, v) => s + v * v, 0);
    const row = (name, ss, df) => { const ms = ss / df, F = ms / mse; return { name, ss, df, ms, F, p: D.pfUpper(F, df, dfE), pEta2: ss / (ss + sse) }; };
    const rows = [];
    rows.push({ ...row('Corrected Model', sst - sse, p - 1), corrected: true });
    const ri = fit(null, true); rows.push(row('Intercept', ri.ok ? ri.sse - sse : NaN, 1));
    terms.forEach(t => { const r = fit(t, false); rows.push(row(t.name, r.sse - sse, t.cols.length)); });
    const cellStats = [...cells.entries()].map(([k, v]) => ({ key: k.split(',').map(Number), ...describe(v) }));
    const lev = levene([...cells.values()].filter(v => v.length > 1));
    return { n, rows, sse, dfE, mse, sst, ssTot, r2: 1 - sse / sst, adjR2: 1 - (sse / dfE) / (sst / (n - 1)), cellStats, levene: lev, factors };
  }

  // ---------- normality ----------
  function shapiroWilk(x) {
    const s = sorted(x), n = s.length;
    if (n < 3) return { error: 'Shapiro–Wilk needs at least 3 values.' };
    if (n > 5000) return { error: 'Shapiro–Wilk is limited to 5000 values.' };
    const range = s[n - 1] - s[0]; if (range < 1e-19 * (Math.abs(s[0]) + 1)) return { error: 'All values are identical.' };
    const nn2 = Math.floor(n / 2), a = new Float64Array(n);
    if (n === 3) { a[0] = -Math.SQRT1_2; a[2] = Math.SQRT1_2; }
    else {
      const m = Array.from({ length: n }, (_, i) => D.qnorm((i + 1 - 0.375) / (n + 0.25)));
      const mm = m.reduce((s2, v) => s2 + v * v, 0), u = 1 / Math.sqrt(n), sq = Math.sqrt(mm);
      const poly = (c, x) => c.reduceRight((acc, ci) => acc * x + ci, 0);
      const an = m[n - 1] / sq + poly([0, 0.221157, -0.147981, -2.071190, 4.434685, -2.706056], u);
      let phi, i1;
      if (n > 5) {
        const an1 = m[n - 2] / sq + poly([0, 0.042981, -0.293762, -1.752461, 5.682633, -3.582633], u);
        phi = (mm - 2 * m[n - 1] ** 2 - 2 * m[n - 2] ** 2) / (1 - 2 * an * an - 2 * an1 * an1);
        a[n - 2] = an1; a[1] = -an1; i1 = 2;
      } else { phi = (mm - 2 * m[n - 1] ** 2) / (1 - 2 * an * an); i1 = 1; }
      a[n - 1] = an; a[0] = -an;
      for (let i = i1; i < n - i1; i++) a[i] = m[i] / Math.sqrt(phi);
    }
    const mx = mean(s); let num = 0, den = 0; for (let i = 0; i < n; i++) { num += a[i] * s[i]; den += (s[i] - mx) ** 2; }
    let W = Math.min(1, num * num / den);
    let p;
    if (n === 3) p = Math.max(0, 6 / Math.PI * (Math.asin(Math.sqrt(W)) - Math.PI / 3));
    else {
      const w1 = Math.log(1 - W);
      if (n <= 11) {
        const g = -2.273 + 0.459 * n;
        if (w1 >= g) p = 1e-99;
        else { const yy = -Math.log(g - w1), m = 0.5440 - 0.39978 * n + 0.025054 * n * n - 0.0006714 * n ** 3, sdv = Math.exp(1.3822 - 0.77857 * n + 0.062767 * n * n - 0.0020322 * n ** 3); p = D.pnormUpper((yy - m) / sdv); }
      } else {
        const ln = Math.log(n), m = -1.5861 - 0.31082 * ln - 0.083751 * ln * ln + 0.0038915 * ln ** 3, sdv = Math.exp(-0.4803 - 0.082676 * ln + 0.0030302 * ln * ln);
        p = D.pnormUpper((w1 - m) / sdv);
      }
    }
    return { W, p, n };
  }
  // Kolmogorov–Smirnov with Lilliefors correction (Dallal–Wilkinson approximation, as R nortest::lillie.test)
  function lilliefors(x) {
    const s = sorted(x), n = s.length; if (n < 5) return { error: 'Lilliefors test needs at least 5 values.' };
    const m = mean(s), sdv = Math.sqrt(variance(s, m)); let Dp = 0, Dm = 0;
    for (let i = 0; i < n; i++) { const F = D.pnorm((s[i] - m) / sdv); Dp = Math.max(Dp, (i + 1) / n - F); Dm = Math.max(Dm, F - i / n); }
    const K = Math.max(Dp, Dm);
    let Kd = K, nd = n; if (n > 100) { Kd = K * Math.pow(n / 100, 0.49); nd = 100; }
    let p = Math.exp(-7.01256 * Kd * Kd * (nd + 2.78019) + 2.99587 * Kd * Math.sqrt(nd + 2.78019) - 0.122119 + 0.974598 / Math.sqrt(nd) + 1.67997 / nd);
    if (p > 0.1) {
      const KK = (Math.sqrt(n) - 0.01 + 0.85 / Math.sqrt(n)) * K;
      if (KK <= 0.302) p = 1;
      else if (KK <= 0.5) p = 2.76773 - 19.828315 * KK + 80.709644 * KK ** 2 - 138.55152 * KK ** 3 + 81.218052 * KK ** 4;
      else if (KK <= 0.9) p = -4.901232 + 40.662806 * KK - 97.490286 * KK ** 2 + 94.029866 * KK ** 3 - 32.355711 * KK ** 4;
      else if (KK <= 1.31) p = 6.198765 - 19.558097 * KK + 23.186922 * KK ** 2 - 12.234627 * KK ** 3 + 2.423045 * KK ** 4;
      else p = 0;
    }
    return { D: K, p: Math.max(0, Math.min(1, p)), n };
  }
  // Anderson–Darling normality test (Minitab's default; p-value per D'Agostino & Stephens 1986)
  function andersonDarling(x) {
    const s = sorted(x), n = s.length; if (n < 8) return { error: 'Anderson–Darling needs at least 8 values.' };
    const m = mean(s), sdv = Math.sqrt(variance(s, m)); let S = 0;
    for (let i = 0; i < n; i++) {
      const z = (s[i] - m) / sdv, zr = (s[n - 1 - i] - m) / sdv;
      S += (2 * i + 1) * (Math.log(D.pnorm(z)) + Math.log(D.pnormUpper(zr)));
    }
    const A = -n - S / n, AA = A * (1 + 0.75 / n + 2.25 / (n * n));
    let p;
    if (AA < 0.2) p = 1 - Math.exp(-13.436 + 101.14 * AA - 223.73 * AA * AA);
    else if (AA < 0.34) p = 1 - Math.exp(-8.318 + 42.796 * AA - 59.938 * AA * AA);
    else if (AA < 0.6) p = Math.exp(0.9177 - 4.279 * AA - 1.38 * AA * AA);
    else if (AA < 10) p = Math.exp(1.2937 - 5.709 * AA + 0.0186 * AA * AA);
    else p = 3.7e-24;
    return { A, AA, p: Math.max(0, Math.min(1, p)), n };
  }

  // ---------- control charts ----------
  // d2 = E[range], d3 = SD[range] of n standard normals, n = 2..25 (numerically integrated; agree with the ASTM tables)
  const CC = {
    d2: [0, 0, 1.12838, 1.69257, 2.05875, 2.32593, 2.53441, 2.70436, 2.84720, 2.97003, 3.07751, 3.17287, 3.25846, 3.33598, 3.40676, 3.47183, 3.53198, 3.58788, 3.64006, 3.68896, 3.73495, 3.77834, 3.81938, 3.85832, 3.89535, 3.93063],
    d3: [0, 0, 0.85250, 0.88837, 0.87981, 0.86408, 0.84804, 0.83321, 0.81983, 0.80783, 0.79705, 0.78731, 0.77848, 0.77042, 0.76302, 0.75621, 0.74991, 0.74405, 0.73859, 0.73348, 0.72869, 0.72417, 0.71991, 0.71589, 0.71207, 0.70844],
    c4: n => Math.exp(D.lgamma(n / 2) - D.lgamma((n - 1) / 2)) * Math.sqrt(2 / (n - 1)),
  };
  function runRules(values, center, ucl, lcl) {
    const flags = values.map(() => []);
    values.forEach((v, i) => { const u = Array.isArray(ucl) ? ucl[i] : ucl, l = Array.isArray(lcl) ? lcl[i] : lcl; if (v > u || v < l) flags[i].push(1); });
    let run = 0, side = 0;
    values.forEach((v, i) => { const s = Math.sign(v - center); if (s && s === side) run++; else { run = s ? 1 : 0; side = s; } if (run >= 9) flags[i].push(2); });
    return flags;
  }
  function chartIMR(x) {
    const n = x.length, m = mean(x), mr = []; for (let i = 1; i < n; i++) mr.push(Math.abs(x[i] - x[i - 1]));
    const mrb = mean(mr), sigma = mrb / CC.d2[2];
    const I = { center: m, ucl: m + 3 * sigma, lcl: m - 3 * sigma, values: x }; I.flags = runRules(x, m, I.ucl, I.lcl);
    const MR = { center: mrb, ucl: mrb * (1 + 3 * CC.d3[2] / CC.d2[2]), lcl: 0, values: [null, ...mr] }; MR.flags = runRules(MR.values.map(v => v ?? mrb), mrb, MR.ucl, MR.lcl).map(f => f.filter(r => r === 1));
    return { I, MR, sigma };
  }
  function chartXbarR(groups) {
    const ns = groups.map(g => g.length);
    if (ns.some(n => n < 2 || n > 25)) return { error: 'Each subgroup needs between 2 and 25 observations.' };
    const xb = groups.map(mean), R = groups.map(g => Math.max(...g) - Math.min(...g));
    const xbb = sum(groups.map(g => sum(g))) / sum(ns);
    // pooled sigma estimate: mean of R_i / d2(n_i)
    const sigma = mean(R.map((r, i) => r / CC.d2[ns[i]]));
    const X = { center: xbb, ucl: ns.map(n => xbb + 3 * sigma / Math.sqrt(n)), lcl: ns.map(n => xbb - 3 * sigma / Math.sqrt(n)), values: xb };
    X.flags = runRules(xb, xbb, X.ucl, X.lcl);
    const Rc = { center: mean(R.map((_, i) => CC.d2[ns[i]] * sigma)), ucl: ns.map(n => sigma * (CC.d2[n] + 3 * CC.d3[n])), lcl: ns.map(n => Math.max(0, sigma * (CC.d2[n] - 3 * CC.d3[n]))), values: R };
    Rc.flags = runRules(R, Rc.center, Rc.ucl, Rc.lcl).map(f => f.filter(r => r === 1));
    return { X, R: Rc, sigma, ns };
  }
  function chartP(defects, sizes) {
    const pbar = sum(defects) / sum(sizes), p = defects.map((d, i) => d / sizes[i]);
    const ucl = sizes.map(n => Math.min(1, pbar + 3 * Math.sqrt(pbar * (1 - pbar) / n))), lcl = sizes.map(n => Math.max(0, pbar - 3 * Math.sqrt(pbar * (1 - pbar) / n)));
    return { P: { center: pbar, ucl, lcl, values: p, flags: runRules(p, pbar, ucl, lcl) } };
  }

  // histogram bins: "nice" width close to Sturges / Freedman–Diaconis
  function niceStep(span, count) {
    const raw = span / Math.max(1, count), mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    return (f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * mag;
  }
  function histBins(x, nbins) {
    const s = sorted(x), n = s.length, lo = s[0], hi = s[n - 1];
    if (!(hi > lo)) return { edges: [lo - 0.5, lo + 0.5], counts: [n], width: 1 };
    if (!nbins) { const iqr = quantile(s, 0.75) - quantile(s, 0.25), fd = iqr > 0 ? (hi - lo) / (2 * iqr / Math.cbrt(n)) : 0; nbins = Math.max(5, Math.min(40, Math.round(Math.max(Math.ceil(Math.log2(n) + 1), Math.min(fd, 30))))); }
    const w = niceStep(hi - lo, nbins), start = Math.floor(lo / w) * w;
    const k = Math.max(1, Math.ceil((hi - start) / w + 1e-9)), edges = Array.from({ length: k + 1 }, (_, i) => start + i * w);
    if (edges[k] <= hi) edges.push(edges[k] + w);
    const counts = new Array(edges.length - 1).fill(0);
    s.forEach(v => { let b = Math.floor((v - start) / w + 1e-9); if (b >= counts.length) b = counts.length - 1; counts[b]++; });
    return { edges, counts, width: w };
  }

  const api = { sum, mean, variance, sd, sorted, quantile, median, modes, rank, describe, tOne, tInd, tPaired, levene, anovaCore, anova1, welchAnova, posthoc,
    kruskal, mannWhitney, wilcoxon, fisher2x2, chiSquare, chiGof, pearson, spearman, kendall, qrSolve, invert, linreg, logreg, hosmerLemeshow, glm,
    shapiroWilk, lilliefors, andersonDarling, chartIMR, chartXbarR, chartP, CC, histBins, niceStep };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LStat = api;
})(typeof self !== 'undefined' ? self : this);
