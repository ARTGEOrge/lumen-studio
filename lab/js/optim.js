// Lumen Lab — constrained optimization: linprog (two-phase simplex), intlinprog (branch and bound),
// quadprog (primal active-set for convex QPs) and fmincon (SQP with damped BFGS, an L1 merit line
// search and an elastic fallback when the linearized constraints are inconsistent). optimoptions.
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const M = node ? require('./mat.js') : root.LabMat;
  const I = node ? require('./interp.js') : root.LabInterp;
  const Lib = node ? require('./lib.js') : root.LabLib;
  const { Mat, fail, num, str } = M;
  const { Struct } = I;
  const { L, N, Str, isStr } = Lib;
  const TOL = 1e-9;

  // ---------- dense helpers ----------
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
  const nrm = v => Math.sqrt(dot(v, v));
  const mv = (A, x) => A.map(r => dot(r, x));
  // Gaussian elimination with partial pivoting; null when (numerically) singular
  function gauss(A, b) {
    const n = b.length, a = A.map((r, i) => [...r, b[i]]);
    let scale = 0; for (const r of A) for (const v of r) scale = Math.max(scale, Math.abs(v));
    for (let k = 0; k < n; k++) {
      let p = k; for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[p][k])) p = i;
      if (Math.abs(a[p][k]) <= 1e-13 * (scale || 1)) return null;
      if (p !== k) [a[p], a[k]] = [a[k], a[p]];
      for (let i = k + 1; i < n; i++) { const f = a[i][k] / a[k][k]; if (f) for (let j = k; j <= n; j++) a[i][j] -= f * a[k][j]; }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) { let s = a[i][n]; for (let j = i + 1; j < n; j++) s -= a[i][j] * x[j]; x[i] = s / a[i][i]; }
    return x;
  }

  // ---------- simplex: min c'z  s.t.  E z = d, z >= 0 (Bland's rule, two phases) ----------
  function simplex(c, E, d, tick) {
    const m = E.length, n = c.length;
    const T = E.map((row, i) => { const s = d[i] < 0 ? -1 : 1, r = new Float64Array(n + m + 1); for (let j = 0; j < n; j++) r[j] = s * row[j]; r[n + i] = 1; r[n + m] = s * d[i]; return r; });
    const basis = Array.from({ length: m }, (_, i) => n + i), W = n + m;
    let iters = 0;
    const pivot = (r, col) => {
      const pr = T[r], pv = pr[col]; for (let j = 0; j <= W; j++) pr[j] /= pv;
      for (let i = 0; i < T.length; i++) if (i !== r) { const f = T[i][col]; if (f) { const ri = T[i]; for (let j = 0; j <= W; j++) ri[j] -= f * pr[j]; } }
      basis[r] = col;
    };
    const run = (cost, allowed) => {
      for (;;) {
        if (++iters > 50000) return 'maxiter';
        if (tick && (iters & 63) === 0) tick();
        let enter = -1;
        for (let j = 0; j < W && enter < 0; j++) { if (!allowed(j) || basis.includes(j)) continue; let r = cost[j]; for (let i = 0; i < T.length; i++) r -= cost[basis[i]] * T[i][j]; if (r < -TOL) enter = j; }
        if (enter < 0) return 'optimal';
        let row = -1, best = Infinity;
        for (let i = 0; i < T.length; i++) { const a = T[i][enter]; if (a > TOL) { const q = T[i][W] / a; if (q < best - 1e-12 || (Math.abs(q - best) <= 1e-12 && basis[i] < basis[row])) { best = q; row = i; } } }
        if (row < 0) return 'unbounded';
        pivot(row, enter);
      }
    };
    // phase 1: minimise the sum of the artificial variables
    const c1 = new Float64Array(W); for (let j = n; j < W; j++) c1[j] = 1;
    const s1 = run(c1, () => true);
    if (s1 === 'maxiter') return { status: 'maxiter', iters };
    let infeas = 0, dmax = 1; for (let i = 0; i < m; i++) { if (basis[i] >= n) infeas += T[i][W]; dmax = Math.max(dmax, Math.abs(d[i])); }
    if (infeas > 1e-8 * dmax) return { status: 'infeasible', iters };
    // drive the remaining (zero) artificial variables out of the basis; drop redundant rows
    for (let i = T.length - 1; i >= 0; i--) {
      if (basis[i] < n) continue;
      let col = -1; for (let j = 0; j < n; j++) if (Math.abs(T[i][j]) > 1e-9 && !basis.includes(j)) { col = j; break; }
      if (col >= 0) pivot(i, col); else { T.splice(i, 1); basis.splice(i, 1); }
    }
    const c2 = new Float64Array(W); for (let j = 0; j < n; j++) c2[j] = c[j];
    const s2 = run(c2, j => j < n);
    const z = new Array(n).fill(0); basis.forEach((b, i) => { if (b < n) z[b] = T[i][W]; });
    return { status: s2, z, iters };
  }

  // min f'x  s.t.  A x <= b, Aeq x = beq, lb <= x <= ub (free variables allowed)
  function lp(f, A, b, Aeq, beq, lb, ub, tick) {
    const n = f.length, cols = []; // each x_j = shift_j + Σ sign * z_k
    let nz = 0; const map = [];
    for (let j = 0; j < n; j++) {
      const lo = lb[j], hi = ub[j];
      if (lo > hi + 1e-12) return { status: 'infeasible' };
      if (isFinite(lo)) map.push({ shift: lo, parts: [[nz++, 1]], cap: isFinite(hi) ? hi - lo : null });
      else if (isFinite(hi)) map.push({ shift: hi, parts: [[nz++, -1]], cap: null });
      else { map.push({ shift: 0, parts: [[nz++, 1], [nz++, -1]], cap: null }); }
    }
    void cols;
    const rows = [], rhs = [];
    const expand = (a, r) => { const row = new Array(nz).fill(0); let off = 0; for (let j = 0; j < n; j++) { off += a[j] * map[j].shift; for (const [k, s] of map[j].parts) row[k] += a[j] * s; } return [row, r - off]; };
    const ineq = [];
    A.forEach((a, i) => ineq.push(expand(a, b[i])));
    map.forEach((m, j) => { if (m.cap !== null) { const row = new Array(nz).fill(0); row[m.parts[0][0]] = 1; ineq.push([row, m.cap]); } });
    const ns = ineq.length, W = nz + ns;
    ineq.forEach(([row, r], i) => { const full = row.concat(new Array(ns).fill(0)); full[nz + i] = 1; rows.push(full); rhs.push(r); });
    Aeq.forEach((a, i) => { const [row, r] = expand(a, beq[i]); rows.push(row.concat(new Array(ns).fill(0))); rhs.push(r); });
    const c = new Array(W).fill(0); let c0 = 0;
    for (let j = 0; j < n; j++) { c0 += f[j] * map[j].shift; for (const [k, s] of map[j].parts) c[k] += f[j] * s; }
    if (!rows.length) { // only sign constraints: optimum at z = 0 unless some cost is negative
      if (c.some(v => v < -TOL)) return { status: 'unbounded' };
      const x = map.map(m => m.shift); return { status: 'optimal', x, fval: dot(f, x), iters: 0 };
    }
    const r = simplex(c, rows, rhs, tick);
    if (r.status !== 'optimal') return { status: r.status, iters: r.iters };
    const x = map.map(m => m.shift + m.parts.reduce((s, [k, sg]) => s + sg * r.z[k], 0));
    return { status: 'optimal', x, fval: dot(f, x), iters: r.iters, c0 };
  }

  // ---------- convex QP: min ½x'Hx + g'x  s.t.  Ain x <= bin, Aeq x = beq (primal active set) ----------
  function qp(H, g, Ain, bin, Aeq, beq, x0, tick) {
    const n = g.length, mi = Ain.length, me = Aeq.length;
    const viol = x => Math.max(0, ...Ain.map((a, i) => dot(a, x) - bin[i]), ...Aeq.map((a, i) => Math.abs(dot(a, x) - beq[i])));
    let x = x0 && x0.length === n ? x0.slice() : new Array(n).fill(0);
    if (viol(x) > 1e-9 * (1 + nrm(x))) {
      const r = lp(new Array(n).fill(0), Ain, bin, Aeq, beq, new Array(n).fill(-Infinity), new Array(n).fill(Infinity), tick);
      if (r.status !== 'optimal') return { status: 'infeasible' };
      x = r.x;
    }
    const W = new Set(); // active inequalities
    Ain.forEach((a, i) => { if (Math.abs(dot(a, x) - bin[i]) <= 1e-10 * (1 + Math.abs(bin[i]))) W.add(i); });
    // keep the initial working set linearly independent (greedy)
    const indep = list => { const keep = []; for (const i of list) { const rows = [...Aeq, ...keep.map(k => Ain[k]), Ain[i]]; const G = rows.map(r => rows.map(s => dot(r, s))); if (gauss(G, new Array(rows.length).fill(1)) || rows.length === 0) keep.push(i); } return keep; };
    let act = indep([...W]);
    let hreg = 0, hmax = 0; for (const r of H) for (const v of r) hmax = Math.max(hmax, Math.abs(v));
    const solveKKT = (grad, act) => {
      const rows = [...Aeq, ...act.map(i => Ain[i])], k = rows.length, K = [];
      for (let reg = hreg, tries = 0; tries < 4; tries++, reg = reg ? reg * 100 : 1e-10 * (1 + hmax)) {
        K.length = 0;
        for (let i = 0; i < n; i++) K.push([...H[i].map((v, j) => v + (i === j ? reg : 0)), ...rows.map(r => r[i])]);
        for (let i = 0; i < k; i++) K.push([...rows[i], ...new Array(k).fill(0).map((_, j) => i === j ? -reg * 1e-3 : 0)]);
        const sol = gauss(K, [...grad.map(v => -v), ...new Array(k).fill(0)]);
        if (sol) { hreg = reg; return { p: sol.slice(0, n), mult: sol.slice(n) }; }
      }
      return null;
    };
    let it = 0;
    for (; it < 20 * (n + mi + me) + 200; it++) {
      if (tick) tick();
      const grad = H.map((r, i) => dot(r, x) + g[i]);
      const s = solveKKT(grad, act); if (!s) return { status: 'singular', x };
      const { p, mult } = s;
      if (nrm(p) <= 1e-10 * (1 + nrm(x))) {
        // multipliers for g + Aeq'λ + A_W'μ = 0; optimal when every μ >= 0
        let worst = -1, wv = -1e-10 * (1 + nrm(grad));
        act.forEach((i, k) => { const mu = mult[me + k]; if (mu < wv) { wv = mu; worst = k; } });
        if (worst < 0) {
          const mu = new Array(mi).fill(0); act.forEach((i, k) => { mu[i] = Math.max(0, mult[me + k]); });
          return { status: 'optimal', x, mu, lam: mult.slice(0, me), iters: it };
        }
        act.splice(worst, 1); continue;
      }
      let alpha = 1, block = -1;
      for (let i = 0; i < mi; i++) { if (act.includes(i)) continue; const ap = dot(Ain[i], p); if (ap > 1e-14 * (1 + nrm(p))) { const t = (bin[i] - dot(Ain[i], x)) / ap; if (t < alpha) { alpha = Math.max(0, t); block = i; } } }
      x = x.map((v, j) => v + alpha * p[j]);
      if (block >= 0) act.push(block);
    }
    return { status: 'maxiter', x, mu: new Array(mi).fill(0), lam: new Array(me).fill(0), iters: it };
  }

  // ---------- argument handling ----------
  const isEmptyArg = v => !v || (v.type === 'num' && v.n === 0);
  const vecOf = v => Array.from(N(v).re);
  function rowsOf(v, n, what) {
    if (isEmptyArg(v)) return [];
    const A = N(v); if (A.c !== n) fail(`${what} must have ${n} column${n === 1 ? '' : 's'} (one per variable).`);
    return Array.from({ length: A.r }, (_, i) => Array.from({ length: n }, (_, j) => A.re[i + j * A.r]));
  }
  function rhsOf(v, m, what) { const r = isEmptyArg(v) ? [] : vecOf(v); if (r.length !== m) fail(`${what} must have ${m} element${m === 1 ? '' : 's'} (one per constraint row).`); return r; }
  function bounds(lbv, ubv, n, defLo) {
    const lb = isEmptyArg(lbv) ? new Array(n).fill(defLo) : vecOf(lbv), ub = isEmptyArg(ubv) ? new Array(n).fill(Infinity) : vecOf(ubv);
    if (lb.length !== n || ub.length !== n) fail(`Bounds must have ${n} elements (one per variable).`);
    return [lb, ub];
  }
  const outVec = (x, likeCol = true) => likeCol ? M.colVec(x) : M.rowVec(x);
  function outStruct(o) { const s = new Struct(); for (const k in o) s.f.set(k, typeof o[k] === 'string' ? str(o[k]) : num(o[k])); return s; }
  function optOf(v, name, d) { if (!v || v.type !== 'struct') return d; for (const [k, x] of v.f) if (k.toLowerCase() === name) { if (x.type === 'num' && x.cls === 'char') return Str(x); if (x.type === 'num' && x.n) return x.re[0]; } return d; }
  const lastStruct = a => { for (let i = a.length - 1; i >= 0; i--) if (a[i] && a[i].type === 'struct') return a[i]; return null; };

  L.optimoptions = a => { const s = new Struct(); let k = 0; if (a.length % 2 === 1) { s.f.set('Solver', a[0].type === 'func' ? str(a[0].src.replace(/^@/, '')) : a[0]); k = 1; } for (; k + 1 < a.length; k += 2) s.f.set(Str(a[k]), a[k + 1]); return s; };

  L.linprog = (a, nout, In) => {
    if (a.length < 3 && !(a.length >= 1 && a[0].type === 'struct')) fail('linprog(f, A, b) needs a cost vector and inequality constraints (use [] for none).');
    const f = vecOf(a[0]), n = f.length, A = rowsOf(a[1], n, 'A'), b = rhsOf(a[2], A.length, 'b'), Aeq = rowsOf(a[3], n, 'Aeq'), beq = rhsOf(a[4], Aeq.length, 'beq');
    const [lb, ub] = bounds(a[5], a[6], n, -Infinity);
    const r = lp(f, A, b, Aeq, beq, lb, ub, () => In.tick());
    const flag = r.status === 'optimal' ? 1 : r.status === 'infeasible' ? -2 : r.status === 'unbounded' ? -3 : 0;
    const msg = { 1: 'Optimal solution found.', '-2': 'No feasible point found.', '-3': 'Problem is unbounded.', 0: 'Iteration limit reached.' }[flag];
    if (flag !== 1 && nout < 3) In.warn(`linprog: ${msg}`);
    const x = flag === 1 ? outVec(r.x, a[0].r !== 1 || n === 1) : M.empty();
    return [x, flag === 1 ? num(r.fval) : M.empty(), num(flag), outStruct({ iterations: r.iters || 0, message: msg, algorithm: 'dual-free two-phase simplex' })].slice(0, Math.max(1, nout));
  };

  L.intlinprog = (a, nout, In) => {
    const f = vecOf(a[0]), n = f.length, ints = isEmptyArg(a[1]) ? [] : vecOf(a[1]).map(k => k - 1);
    if (ints.some(k => !(k >= 0 && k < n && Number.isInteger(k)))) fail('intlinprog: intcon must list variable indices between 1 and ' + n + '.');
    const A = rowsOf(a[2], n, 'A'), b = rhsOf(a[3], A.length, 'b'), Aeq = rowsOf(a[4], n, 'Aeq'), beq = rhsOf(a[5], Aeq.length, 'beq');
    const [lb0, ub0] = bounds(a[6], a[7], n, -Infinity);
    let best = null, nodes = 0, unbounded = false;
    const stack = [[lb0, ub0]];
    while (stack.length) {
      if (++nodes > 20000) break;
      In.tick();
      const [lb, ub] = stack.pop(), r = lp(f, A, b, Aeq, beq, lb, ub);
      if (r.status === 'unbounded') { unbounded = true; break; }
      if (r.status !== 'optimal' || (best && r.fval >= best.fval - 1e-9 * (1 + Math.abs(best.fval)))) continue;
      let k = -1, frac = 0; for (const j of ints) { const d = Math.abs(r.x[j] - Math.round(r.x[j])); if (d > 1e-7 && d > frac) { frac = d; k = j; } }
      if (k < 0) { best = { x: r.x.map((v, j) => ints.includes(j) ? Math.round(v) : v), fval: r.fval }; best.fval = dot(f, best.x); continue; }
      const lo = Math.floor(r.x[k]), ubA = ub.slice(), lbB = lb.slice(); ubA[k] = lo; lbB[k] = lo + 1;
      // explore the branch nearest the relaxed value first
      if (r.x[k] - lo > 0.5) stack.push([lb, ubA], [lbB, ub]); else stack.push([lbB, ub], [lb, ubA]);
    }
    const flag = best ? (nodes > 20000 ? 2 : 1) : unbounded ? -3 : nodes > 20000 ? 0 : -2;
    if (!best && nout < 3) In.warn(`intlinprog: ${flag === -3 ? 'the problem is unbounded' : flag === 0 ? 'node limit reached without a feasible point' : 'no integer feasible point found'}.`);
    return [best ? outVec(best.x, a[0].r !== 1 || n === 1) : M.empty(), best ? num(best.fval) : M.empty(), num(flag), outStruct({ numnodes: nodes, message: best ? 'Optimal solution found.' : 'No solution.' })].slice(0, Math.max(1, nout));
  };

  L.quadprog = (a, nout, In) => {
    if (a.length < 2) fail('quadprog(H, f, A, b, Aeq, beq, lb, ub) needs at least H and f.');
    const f = vecOf(a[1]), n = f.length, Hm = N(a[0]);
    if (Hm.r !== n || Hm.c !== n) fail(`quadprog: H must be ${n}×${n}.`);
    const H = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => 0.5 * (Hm.re[i + j * n] + Hm.re[j + i * n])));
    const A = rowsOf(a[2], n, 'A'), b = rhsOf(a[3], A.length, 'b'), Aeq = rowsOf(a[4], n, 'Aeq'), beq = rhsOf(a[5], Aeq.length, 'beq');
    const [lb, ub] = bounds(a[6], a[7], n, -Infinity), x0 = isEmptyArg(a[8]) || (a[8] && a[8].type === 'struct') ? null : vecOf(a[8]);
    const Ain = A.slice(), bin = b.slice();
    for (let j = 0; j < n; j++) { if (isFinite(ub[j])) { const r = new Array(n).fill(0); r[j] = 1; Ain.push(r); bin.push(ub[j]); } if (isFinite(lb[j])) { const r = new Array(n).fill(0); r[j] = -1; Ain.push(r); bin.push(-lb[j]); } }
    const r = qp(H, f, Ain, bin, Aeq, beq, x0, () => In.tick());
    const flag = r.status === 'optimal' ? 1 : r.status === 'infeasible' ? -2 : r.status === 'singular' ? -6 : 0;
    if (flag !== 1 && nout < 3) In.warn(flag === -2 ? 'quadprog: no feasible point found.' : flag === -6 ? 'quadprog: the problem looks nonconvex or unbounded (H is not positive definite on the feasible directions).' : 'quadprog: iteration limit reached.');
    const x = r.x ? r.x : null, fval = x ? 0.5 * dot(x, mv(H, x)) + dot(f, x) : NaN;
    return [x ? outVec(x, a[1].r !== 1 || n === 1) : M.empty(), x ? num(fval) : M.empty(), num(flag), outStruct({ iterations: r.iters || 0, algorithm: 'active-set' })].slice(0, Math.max(1, nout));
  };

  // ---------- fmincon (SQP) ----------
  L.fmincon = (a, nout, In) => {
    if (a.length < 2) fail('fmincon(fun, x0, A, b, Aeq, beq, lb, ub, nonlcon, options) needs at least a function and a start point.');
    const fun = a[0], X0 = N(a[1]), n = X0.n, shape = x => new Mat(X0.r, X0.c, Float64Array.from(x));
    const A = rowsOf(a[2], n, 'A'), b = rhsOf(a[3], A.length, 'b'), Aeq = rowsOf(a[4], n, 'Aeq'), beq = rhsOf(a[5], Aeq.length, 'beq');
    const [lb, ub] = bounds(a[6], a[7], n, -Infinity);
    const nonl = a[8] && a[8].type === 'func' ? a[8] : null, opts = lastStruct(a.slice(9)) || (a[8] && a[8].type === 'struct' ? a[8] : null);
    const maxIt = optOf(opts, 'maxiterations', optOf(opts, 'maxiter', 400)), tolX = optOf(opts, 'steptolerance', optOf(opts, 'tolx', 1e-10)), tolC = optOf(opts, 'constrainttolerance', optOf(opts, 'tolcon', 1e-6)), tolF = optOf(opts, 'optimalitytolerance', optOf(opts, 'tolfun', 1e-6));
    const F = x => { const v = In.fcall(fun, [shape(x)]); if (v.type !== 'num' || v.n < 1) fail('fmincon: the objective must return a real scalar.'); return v.re[0]; };
    const C = x => { if (!nonl) return [[], []]; const r = In.callFunc(nonl, [shape(x)], 2); const c = r[0] && r[0].type === 'num' ? Array.from(r[0].re) : [], ce = r[1] && r[1].type === 'num' ? Array.from(r[1].re) : []; return [c, ce]; };
    const grad = (fn, x) => { const f0 = fn(x); return x.map((v, j) => { const h = 6.0554544523933395e-6 * Math.max(1, Math.abs(v)); const xp = x.slice(), xm = x.slice(); xp[j] = v + h; xm[j] = v - h; const sp = !(xp[j] > ub[j]), sm = !(xm[j] < lb[j]); if (sp && sm) return (fn(xp) - fn(xm)) / (2 * h); if (sp) return (fn(xp) - f0) / h; return (f0 - fn(xm)) / h; }); };
    const jac = (x, c0) => { // rows = constraints (forward differences, staying inside the bounds)
      const [c, ce] = c0, m = c.length + ce.length, J = Array.from({ length: m }, () => new Array(n).fill(0));
      for (let j = 0; j < n; j++) { let h = 1.4901161193847656e-8 * Math.max(1, Math.abs(x[j])); if (x[j] + h > ub[j]) h = -h; const xp = x.slice(); xp[j] += h; const [cp, cep] = C(xp); [...cp, ...cep].forEach((v, i) => { J[i][j] = (v - [...c, ...ce][i]) / h; }); }
      return [J.slice(0, c.length), J.slice(c.length)];
    };
    // start inside the bounds
    let x = Array.from(X0.re, (v, j) => Math.min(ub[j], Math.max(lb[j], v)));
    const linViol = x => Math.max(0, ...A.map((r, i) => dot(r, x) - b[i]), ...Aeq.map((r, i) => Math.abs(dot(r, x) - beq[i])), ...x.map((v, j) => Math.max(lb[j] - v, v - ub[j])));
    const viol = (x, cc) => Math.max(linViol(x), ...cc[0], ...cc[1].map(Math.abs), 0);
    const penalty = (x, cc) => cc[0].reduce((s, v) => s + Math.max(0, v), 0) + cc[1].reduce((s, v) => s + Math.abs(v), 0) + A.reduce((s, r, i) => s + Math.max(0, dot(r, x) - b[i]), 0) + Aeq.reduce((s, r, i) => s + Math.abs(dot(r, x) - beq[i]), 0);
    let fx = F(x), cc = C(x), g = grad(F, x), [Jc, Je] = jac(x, cc);
    let B = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => i === j ? 1 : 0));
    let rho = 1, it = 0, flag = 0, mu = [], lam = [], funcCount = 0, lastStep = Infinity, msg = '';
    const gradL = (g, Jc, Je, mu, lam) => g.map((v, j) => v + Jc.reduce((s, r, i) => s + (mu[i] || 0) * r[j], 0) + Je.reduce((s, r, i) => s + (lam[i] || 0) * r[j], 0));
    for (; it < maxIt; it++) {
      In.tick();
      // QP subproblem in the step p
      const Ain = [...A, ...Jc], bin = [...A.map((r, i) => b[i] - dot(r, x)), ...cc[0].map(v => -v)];
      for (let j = 0; j < n; j++) { if (isFinite(ub[j])) { const r = new Array(n).fill(0); r[j] = 1; Ain.push(r); bin.push(ub[j] - x[j]); } if (isFinite(lb[j])) { const r = new Array(n).fill(0); r[j] = -1; Ain.push(r); bin.push(x[j] - lb[j]); } }
      const Aq = [...Aeq, ...Je], bq = [...Aeq.map((r, i) => beq[i] - dot(r, x)), ...cc[1].map(v => -v)];
      let r = qp(B, g, Ain, bin, Aq, bq, new Array(n).fill(0), () => In.tick()), p;
      const nlin = A.length, nci = cc[0].length;
      if (r.status === 'optimal') { p = r.x; mu = r.mu.slice(nlin, nlin + nci); lam = r.lam.slice(Aeq.length); }
      else { // elastic mode: relax the linearized nonlinear constraints with penalised slacks
        const ne = Je.length, ns = nci + 2 * ne, NN = n + ns, big = 1e3 * (1 + Math.abs(fx));
        const pad = (row, extra) => [...row, ...extra];
        const He = Array.from({ length: NN }, (_, i) => Array.from({ length: NN }, (_, j) => i < n && j < n ? B[i][j] : i === j ? 1e-8 : 0));
        const ge = [...g, ...new Array(ns).fill(big)];
        const Ai = [], bi = [];
        Ain.forEach((row, i) => { const e = new Array(ns).fill(0); if (i >= nlin && i < nlin + nci) e[i - nlin] = -1; Ai.push(pad(row, e)); bi.push(bin[i]); });
        for (let k = 0; k < ns; k++) { const e = new Array(NN).fill(0); e[n + k] = -1; Ai.push(e); bi.push(0); }
        const Ae = [], be = [];
        Aq.forEach((row, i) => { const e = new Array(ns).fill(0); if (i >= Aeq.length) { const k = i - Aeq.length; e[nci + 2 * k] = 1; e[nci + 2 * k + 1] = -1; } Ae.push(pad(row, e)); be.push(bq[i]); });
        r = qp(He, ge, Ai, bi, Ae, be, null, () => In.tick());
        if (r.status !== 'optimal') { flag = -2; msg = 'No feasible point found (the linear constraints and bounds are inconsistent).'; break; }
        p = r.x.slice(0, n); mu = r.mu.slice(nlin, nlin + nci); lam = r.lam.slice(Aeq.length);
      }
      // stop: tiny step and feasible
      const v0 = viol(x, cc);
      const kkt = nrm(gradL(g, Jc, Je, mu, lam).map((v, j) => (x[j] <= lb[j] + 1e-12 && v > 0) || (x[j] >= ub[j] - 1e-12 && v < 0) ? 0 : v));
      if (nrm(p) <= tolX * (1 + nrm(x)) && v0 <= tolC) { flag = 1; msg = 'Local minimum found that satisfies the constraints.'; break; }
      if (kkt <= tolF * (1 + Math.abs(fx)) && v0 <= tolC && nrm(p) <= Math.sqrt(tolX) * (1 + nrm(x))) { flag = 1; msg = 'Local minimum found that satisfies the constraints.'; break; }
      // L1 merit line search
      const mmax = Math.max(0, ...mu.map(Math.abs), ...lam.map(Math.abs), ...(r.mu || []).slice(0, nlin).map(Math.abs), ...(r.lam || []).slice(0, Aeq.length).map(Math.abs));
      rho = Math.max(rho, 1.5 * mmax + 1e-3);
      const phi0 = fx + rho * penalty(x, cc), D = dot(g, p) - rho * penalty(x, cc);
      let t = 1, xn, fn, cn, ok = false;
      for (let k = 0; k < 40; k++) {
        xn = x.map((v, j) => Math.min(ub[j], Math.max(lb[j], v + t * p[j])));
        fn = F(xn); cn = C(xn); funcCount++;
        if (isFinite(fn) && fn + rho * penalty(xn, cn) <= phi0 + 1e-4 * t * Math.min(D, 0)) { ok = true; break; }
        t /= 2;
      }
      if (!ok) { // no merit decrease: accept if it at least does not hurt, otherwise stop
        if (!(isFinite(fn)) || fn + rho * penalty(xn, cn) > phi0 + 1e-12 * (1 + Math.abs(phi0))) { flag = v0 <= tolC ? 2 : -2; msg = v0 <= tolC ? 'Local minimum possible: the step size became too small.' : 'Converged to an infeasible point.'; break; }
      }
      const s = xn.map((v, j) => v - x[j]);
      const gn = grad(F, xn), [Jcn, Jen] = jac(xn, cn);
      const y0 = gradL(gn, Jcn, Jen, mu, lam).map((v, j) => v - gradL(g, Jc, Je, mu, lam)[j]);
      const Bs = mv(B, s), sBs = dot(s, Bs), sy = dot(s, y0);
      if (sBs > 1e-300 && nrm(s) > 0) { // Powell-damped BFGS keeps B positive definite
        const th = sy >= 0.2 * sBs ? 1 : 0.8 * sBs / (sBs - sy), y = y0.map((v, j) => th * v + (1 - th) * Bs[j]), syd = dot(s, y);
        if (syd > 1e-300) B = B.map((row, i) => row.map((v, j) => v - Bs[i] * Bs[j] / sBs + y[i] * y[j] / syd));
      }
      lastStep = nrm(s);
      x = xn; fx = fn; cc = cn; g = gn; Jc = Jcn; Je = Jen;
      if (lastStep <= tolX * (1 + nrm(x)) && viol(x, cc) <= tolC) { flag = 2; msg = 'Local minimum possible: the step size became very small.'; break; }
    }
    if (it >= maxIt) { flag = 0; msg = 'Iteration limit reached.'; }
    const cv = viol(x, cc);
    if (flag <= 0 && nout < 3) In.warn(`fmincon: ${msg}`);
    const out = outStruct({ iterations: it, funcCount, constrviolation: cv, stepsize: isFinite(lastStep) ? lastStep : 0, algorithm: 'sqp', message: msg });
    const lambda = new Struct(); lambda.f.set('ineqnonlin', M.colVec(mu)); lambda.f.set('eqnonlin', M.colVec(lam));
    return [shape(x), num(fx), num(flag), out, lambda].slice(0, Math.max(1, nout));
  };

  const api = { simplex, lp, qp, gauss };
  if (node) module.exports = api; else root.LabOptim = api;
})(typeof self !== 'undefined' ? self : this);
