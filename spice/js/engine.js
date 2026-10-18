// Lumen Spice — modified nodal analysis engine.
// Unknowns: node voltages followed by branch currents (voltage sources, inductors, E/H sources, op-amp outputs).
// Analyses: .op (Newton–Raphson with junction limiting, gmin and source stepping), .dc sweep, .ac (complex MNA
// linearised at the operating point) and .tran (trapezoidal or backward Euler, LTE-controlled adaptive step,
// breakpoints at source corners). No DOM — runs in Node for tests and in a Web Worker in the app.
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const Ex = isNode ? require('./expr.js') : root.SpiceExpr;

  const KB = 1.380649e-23, QE = 1.602176634e-19;
  const VT = KB * 300.15 / QE;          // thermal voltage at 27 °C
  const GMIN = 1e-12;

  // ---------- linear algebra ----------
  // in-place LU with partial pivoting on a dense row-major matrix; returns false if singular
  function luSolve(A, b, n, perm, x) {
    for (let i = 0; i < n; i++) perm[i] = i;
    for (let k = 0; k < n; k++) {
      let p = k, mx = Math.abs(A[k * n + k]);
      for (let i = k + 1; i < n; i++) { const v = Math.abs(A[i * n + k]); if (v > mx) { mx = v; p = i; } }
      if (!(mx > 1e-300)) return k;                       // singular at column k
      if (p !== k) {
        for (let j = 0; j < n; j++) { const t = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = t; }
        const t = b[k]; b[k] = b[p]; b[p] = t;
      }
      const piv = A[k * n + k];
      for (let i = k + 1; i < n; i++) {
        const f = A[i * n + k] / piv; if (f === 0) continue;
        A[i * n + k] = 0;
        const ri = i * n, rk = k * n;
        for (let j = k + 1; j < n; j++) { const a = A[rk + j]; if (a !== 0) A[ri + j] -= f * a; }
        b[i] -= f * b[k];
      }
    }
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i]; const ri = i * n;
      for (let j = i + 1; j < n; j++) s -= A[ri + j] * x[j];
      x[i] = s / A[ri + i];
    }
    return -1;
  }
  // LU factorisation kept for reuse (linear circuits with an unchanged step): perm[k] = row swapped into k
  function luFactor(A, n, perm) {
    for (let k = 0; k < n; k++) {
      let p = k, mx = Math.abs(A[k * n + k]);
      for (let i = k + 1; i < n; i++) { const v = Math.abs(A[i * n + k]); if (v > mx) { mx = v; p = i; } }
      if (!(mx > 1e-300)) return k;
      perm[k] = p;
      if (p !== k) for (let j = 0; j < n; j++) { const t = A[k * n + j]; A[k * n + j] = A[p * n + j]; A[p * n + j] = t; }
      const piv = A[k * n + k], rk = k * n;
      for (let i = k + 1; i < n; i++) {
        const ri = i * n; let f = A[ri + k]; if (f === 0) continue;
        f /= piv; A[ri + k] = f;
        for (let j = k + 1; j < n; j++) { const a = A[rk + j]; if (a !== 0) A[ri + j] -= f * a; }
      }
    }
    return -1;
  }
  function luSolveF(LU, n, perm, b, x) {
    for (let k = 0; k < n; k++) { const p = perm[k]; if (p !== k) { const t = b[k]; b[k] = b[p]; b[p] = t; } }
    for (let i = 0; i < n; i++) { let s = b[i]; const ri = i * n; for (let j = 0; j < i; j++) { const l = LU[ri + j]; if (l !== 0) s -= l * x[j]; } x[i] = s; }
    for (let i = n - 1; i >= 0; i--) { let s = x[i]; const ri = i * n; for (let j = i + 1; j < n; j++) { const u = LU[ri + j]; if (u !== 0) s -= u * x[j]; } x[i] = s / LU[ri + i]; }
  }
  // complex version: (Ar + jAi) x = (br + jbi)
  function luSolveC(Ar, Ai, br, bi, n, xr, xi) {
    for (let k = 0; k < n; k++) {
      let p = k, mx = Math.hypot(Ar[k * n + k], Ai[k * n + k]);
      for (let i = k + 1; i < n; i++) { const v = Math.hypot(Ar[i * n + k], Ai[i * n + k]); if (v > mx) { mx = v; p = i; } }
      if (!(mx > 1e-300)) return k;
      if (p !== k) {
        for (let j = 0; j < n; j++) { let t = Ar[k * n + j]; Ar[k * n + j] = Ar[p * n + j]; Ar[p * n + j] = t; t = Ai[k * n + j]; Ai[k * n + j] = Ai[p * n + j]; Ai[p * n + j] = t; }
        let t = br[k]; br[k] = br[p]; br[p] = t; t = bi[k]; bi[k] = bi[p]; bi[p] = t;
      }
      const pr = Ar[k * n + k], pi = Ai[k * n + k], pd = pr * pr + pi * pi;
      for (let i = k + 1; i < n; i++) {
        const ar = Ar[i * n + k], ai = Ai[i * n + k]; if (ar === 0 && ai === 0) continue;
        const fr = (ar * pr + ai * pi) / pd, fi = (ai * pr - ar * pi) / pd;
        Ar[i * n + k] = 0; Ai[i * n + k] = 0;
        for (let j = k + 1; j < n; j++) {
          const cr = Ar[k * n + j], ci = Ai[k * n + j]; if (cr === 0 && ci === 0) continue;
          Ar[i * n + j] -= fr * cr - fi * ci; Ai[i * n + j] -= fr * ci + fi * cr;
        }
        br[i] -= fr * br[k] - fi * bi[k]; bi[i] -= fr * bi[k] + fi * br[k];
      }
    }
    for (let i = n - 1; i >= 0; i--) {
      let sr = br[i], si = bi[i];
      for (let j = i + 1; j < n; j++) { const ar = Ar[i * n + j], ai = Ai[i * n + j]; if (ar === 0 && ai === 0) continue; sr -= ar * xr[j] - ai * xi[j]; si -= ar * xi[j] + ai * xr[j]; }
      const dr = Ar[i * n + i], di = Ai[i * n + i], dd = dr * dr + di * di;
      xr[i] = (sr * dr + si * di) / dd; xi[i] = (si * dr - sr * di) / dd;
    }
    return -1;
  }

  // ---------- device helpers ----------
  const safeExp = a => a > 80 ? Math.exp(80) * (1 + a - 80) : Math.exp(a);
  const dSafeExp = a => a > 80 ? Math.exp(80) : Math.exp(a);
  // SPICE3 pn-junction voltage limiting
  function pnjlim(vnew, vold, vt, vcrit, s) {
    if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
      if (vold > 0) { const arg = 1 + (vnew - vold) / vt; vnew = arg > 0 ? vold + vt * Math.log(arg) : vcrit; }
      else vnew = vt * Math.log(vnew / vt);
      s.limited = true;
    }
    return vnew;
  }
  function fetlim(vnew, vold, vto) {
    const vtsthi = Math.abs(2 * (vold - vto)) + 2, vtstlo = vtsthi / 2 + 2, vtox = vto + 3.5, delv = vnew - vold;
    if (vold >= vto) {
      if (vold >= vtox) {
        if (delv <= 0) { if (vnew >= vtox) { if (-delv > vtstlo) vnew = vold - vtstlo; } else vnew = Math.max(vnew, vto + 2); }
        else if (delv >= vtsthi) vnew = vold + vtsthi;
      } else {
        if (delv <= 0) vnew = Math.max(vnew, vto - 0.5); else vnew = Math.min(vnew, vto + 4);
      }
    } else {
      if (delv <= 0) { if (-delv > vtsthi) vnew = vold - vtsthi; }
      else { const vtemp = vto + 0.5; if (vnew <= vtemp) { if (delv > vtstlo) vnew = vold + vtstlo; } else vnew = vtemp; }
    }
    return vnew;
  }
  function limvds(vnew, vold) {
    if (vold >= 3.5) { if (vnew > vold) vnew = Math.min(vnew, 3 * vold + 2); else if (vnew < 3.5) vnew = Math.max(vnew, 2); }
    else { if (vnew > vold) vnew = Math.min(vnew, 4); else vnew = Math.max(vnew, -0.5); }
    return vnew;
  }
  // depletion charge and capacitance of a junction (SPICE formula with the FC linear extension)
  function depl(v, cj0, vj, m, fc) {
    if (!cj0) return [0, 0];
    if (v < fc * vj) {
      const a = 1 - v / vj, s = Math.pow(a, -m);
      return [vj * cj0 * (1 - a * s) / (1 - m), cj0 * s];
    }
    const f1 = vj * (1 - Math.pow(1 - fc, 1 - m)) / (1 - m), f2 = Math.pow(1 - fc, 1 + m), f3 = 1 - fc * (1 + m);
    return [cj0 * (f1 + (f3 * (v - fc * vj) + m / (2 * vj) * (v * v - fc * fc * vj * vj)) / f2), cj0 / f2 * (f3 + m * v / vj)];
  }
  // two-terminal charge element (capacitor, junction charge): stamps the companion model for the current mode
  function capLoad(s, n1, n2, slot, q, C, v) {
    if (s.mode === 'ac') { const w = s.omega * C; s.addAi(n1, n1, w); s.addAi(n2, n2, w); s.addAi(n1, n2, -w); s.addAi(n2, n1, -w); return; }
    const [i, g] = s.integ(slot, q, C);
    if (g === 0 && i === 0) return;
    s.addA(n1, n1, g); s.addA(n2, n2, g); s.addA(n1, n2, -g); s.addA(n2, n1, -g);
    const ieq = i - g * v; s.addB(n1, -ieq); s.addB(n2, ieq);
  }
  // nonlinear multi-terminal device: I[k] = current flowing from node k into the device, J[k][j] = dI[k]/dV[j].
  // `st` keeps the previous linearisation so Newton can check device currents (SPICE-style current convergence).
  function nlStamp(s, nodes, I, J, V, st) {
    if (st && s.checkCur && st.I) {
      for (let k = 0; k < nodes.length && !s.noncon; k++) {
        let pred = st.I[k]; for (let j = 0; j < nodes.length; j++) pred += st.J[k][j] * (V[j] - st.V[j]);
        if (Math.abs(pred - I[k]) > s.reltol * Math.max(Math.abs(pred), Math.abs(I[k])) + s.abstol * 1e3) s.noncon = true;
      }
    }
    if (st) { st.I = I; st.J = J; st.V = V; }
    for (let k = 0; k < nodes.length; k++) {
      const r = nodes[k]; if (r < 0) continue;
      let ieq = I[k];
      for (let j = 0; j < nodes.length; j++) { const g = J[k][j]; if (g === 0) continue; s.addA(r, nodes[j], g); ieq -= g * V[j]; }
      s.addB(r, -ieq);
    }
  }
  const P = (params, key, def) => { const v = params[key.toLowerCase()]; return v === undefined || v === null || Number.isNaN(v) ? def : v; };

  // ---------- source waveforms ----------
  // spec = { dc, acMag, acPhase, fn: 'pulse'|'sin'|'pwl'|'exp'|'sffm'|null, args:[numbers] }
  function waveAt(w, t, ctx) {
    const a = w.args || [];
    switch (w.fn) {
      case 'pulse': {
        const v1 = a[0] || 0, v2 = a[1] ?? 0, td = a[2] || 0, tr = a[3] || ctx.tstep || 1e-9, tf = a[4] || ctx.tstep || 1e-9;
        const pw = a[5] ?? Infinity, per = a[6] || Infinity, nc = a[7] || 0;
        if (t < td) return v1;
        let tt = t - td;
        if (Number.isFinite(per) && per > 0) { const k = Math.floor(tt / per); if (nc > 0 && k >= nc) return v1; tt -= k * per; }
        if (tt < tr) return v1 + (v2 - v1) * tt / tr;
        if (tt < tr + pw) return v2;
        if (tt < tr + pw + tf) return v2 + (v1 - v2) * (tt - tr - pw) / tf;
        return v1;
      }
      case 'sin': {
        const vo = a[0] || 0, va = a[1] || 0, f = a[2] ?? (ctx.tstop ? 1 / ctx.tstop : 0), td = a[3] || 0, th = a[4] || 0, ph = a[5] || 0, nc = a[6] || 0;
        if (t < td) return vo + va * Math.sin(Math.PI * ph / 180);
        if (nc > 0 && f > 0 && t - td > nc / f) return vo + va * Math.sin(Math.PI * ph / 180);
        return vo + va * Math.exp(-(t - td) * th) * Math.sin(2 * Math.PI * f * (t - td) + Math.PI * ph / 180);
      }
      case 'exp': {
        const v1 = a[0] || 0, v2 = a[1] || 0, td1 = a[2] || 0, tau1 = a[3] || ctx.tstep || 1e-9, td2 = a[4] ?? td1 + (ctx.tstep || 1e-9), tau2 = a[5] || ctx.tstep || 1e-9;
        if (t < td1) return v1;
        let v = v1 + (v2 - v1) * (1 - Math.exp(-(t - td1) / tau1));
        if (t >= td2) v += (v1 - v2) * (1 - Math.exp(-(t - td2) / tau2));
        return v;
      }
      case 'sffm': {
        const vo = a[0] || 0, va = a[1] || 0, fc = a[2] || 0, mdi = a[3] || 0, fs = a[4] || 0;
        return vo + va * Math.sin(2 * Math.PI * fc * t + mdi * Math.sin(2 * Math.PI * fs * t));
      }
      case 'pwl': {
        const n = a.length >> 1; if (!n) return 0;
        let tt = t;
        if (w.repeat && n > 1) { const T = a[(n - 1) * 2]; if (T > 0 && tt > T) tt = tt % T; }
        if (tt <= a[0]) return a[1];
        for (let i = 1; i < n; i++) if (tt <= a[i * 2]) { const t0 = a[i * 2 - 2], t1 = a[i * 2], v0 = a[i * 2 - 1], v1 = a[i * 2 + 1]; return t1 > t0 ? v0 + (v1 - v0) * (tt - t0) / (t1 - t0) : v1; }
        return a[n * 2 - 1];
      }
    }
    return w.dc || 0;
  }
  function waveBreaks(w, tstop, ctx) {
    const a = w.args || [], out = [];
    if (w.fn === 'pulse') {
      const td = a[2] || 0, tr = a[3] || ctx.tstep || 1e-9, tf = a[4] || ctx.tstep || 1e-9, pw = a[5] ?? Infinity, per = a[6] || Infinity, nc = a[7] || 0;
      for (let k = 0; k < 100000; k++) {
        const t0 = td + k * (Number.isFinite(per) ? per : 0);
        if (t0 > tstop || (nc > 0 && k >= nc)) break;
        [t0, t0 + tr, t0 + tr + pw, t0 + tr + pw + tf].forEach(t => Number.isFinite(t) && t <= tstop && out.push(t));
        if (!Number.isFinite(per)) break;
      }
    } else if (w.fn === 'pwl') {
      const n = a.length >> 1, T = a[(n - 1) * 2];
      if (w.repeat && T > 0) { for (let k = 0; k * T <= tstop && k < 10000; k++) for (let i = 0; i < n; i++) out.push(k * T + a[i * 2]); }
      else for (let i = 0; i < n; i++) out.push(a[i * 2]);
    } else if (w.fn === 'sin' || w.fn === 'exp') { if (a[w.fn === 'sin' ? 3 : 2]) out.push(a[w.fn === 'sin' ? 3 : 2]); if (w.fn === 'exp' && a[4]) out.push(a[4]); }
    return out.filter(t => t > 0 && t <= tstop);
  }

  // ---------- devices ----------
  class Resistor {
    constructor(e) { this.name = e.name; this.nn = e.nodes; this.r = e.value; if (!(Math.abs(this.r) > 1e-9)) this.r = 1e-9; }
    setup(c) { [this.a, this.b] = this.nn.map(n => c.node(n)); this.g = 1 / this.r; }
    load(s) { const { a, b, g } = this; s.addA(a, a, g); s.addA(b, b, g); s.addA(a, b, -g); s.addA(b, a, -g); }
    probes() { return [['I(' + this.name + ')', s => (s.v(this.a) - s.v(this.b)) * this.g, s => [(s.vr(this.a) - s.vr(this.b)) * this.g, (s.vi(this.a) - s.vi(this.b)) * this.g]]]; }
  }
  class Capacitor {
    constructor(e) { this.name = e.name; this.nn = e.nodes; this.c = e.value; this.ic = e.params.ic; }
    setup(c) { [this.a, this.b] = this.nn.map(n => c.node(n)); this.slot = c.state(); }
    load(s) { const v = s.v(this.a) - s.v(this.b); capLoad(s, this.a, this.b, this.slot, this.c * v, this.c, v); }
    uic(s) { if (this.ic !== undefined) s.q1[this.slot] = this.c * this.ic; }
    probes() { return [['I(' + this.name + ')', s => s.mode === 'tran' ? s.i0[this.slot] : 0, s => { const w = s.omega * this.c, dr = s.vr(this.a) - s.vr(this.b), di = s.vi(this.a) - s.vi(this.b); return [-w * di, w * dr]; }]]; }
  }
  class Inductor {
    constructor(e) { this.name = e.name; this.nn = e.nodes; this.l = e.value; this.ic = e.params.ic; }
    setup(c) { [this.a, this.b] = this.nn.map(n => c.node(n)); this.br = c.branch(this.name); this.slot = c.state(); }
    load(s) {
      const { a, b, br } = this, I = s.x[br];
      s.addA(a, br, 1); s.addA(b, br, -1); s.addA(br, a, 1); s.addA(br, b, -1);
      if (s.mode === 'ac') { s.addAi(br, br, -s.omega * this.l); if (this.couple) for (const c of this.couple) s.addAi(br, c.other.br, -s.omega * c.m); return; }
      // flux φ = L·I + Σ M·I_other (coupled inductors, K elements)
      let phi = this.l * I; if (this.couple) for (const c of this.couple) phi += c.m * s.x[c.other.br];
      const [v, g] = s.integ(this.slot, phi, this.l);   // v = dφ/dt
      let rhs = v - g * I;
      if (this.couple && s.mode === 'tran') for (const c of this.couple) { const gm = s.ag0 * c.m; s.addA(br, c.other.br, -gm); rhs -= gm * s.x[c.other.br]; }
      s.addA(br, br, -g); s.addB(br, rhs);
    }
    uic(s) { if (this.ic !== undefined) s.q1[this.slot] = this.l * this.ic; }
    probes() { return [['I(' + this.name + ')', s => s.x[this.br], s => [s.xr[this.br], s.xi[this.br]]]]; }
  }
  // K: mutual inductance between inductors (M = k·√(L1·L2) for every pair listed)
  class Coupling {
    constructor(e) { this.name = e.name; this.inds = e.inds; this.k = e.value; if (!(Math.abs(this.k) <= 1)) throw new Error(`${e.name}: coupling coefficient must be between -1 and 1`); }
    setup() { }
    link(c) {
      const L = this.inds.map(n => { const d = c.deviceOf(n); if (!d || d.kind !== 'L') throw new Error(`${this.name}: inductor ${n} not found`); return d; });
      for (let i = 0; i < L.length; i++) for (let j = 0; j < L.length; j++) if (i !== j) {
        const m = this.k * Math.sqrt(L[i].l * L[j].l); (L[i].couple || (L[i].couple = [])).push({ other: L[j], m });
      }
    }
    load() { }
  }
  class VSource {
    constructor(e) { this.name = e.name; this.nn = e.nodes; this.w = e.wave; }
    setup(c) { [this.a, this.b] = this.nn.map(n => c.node(n)); this.br = c.branch(this.name); }
    value(s) { if (this.sweep !== undefined) return this.sweep; return s.mode === 'tran' ? waveAt(this.w, s.time, s) : this.w.dcSet ? this.w.dc : waveAt(this.w, 0, s); }
    load(s) {
      const { a, b, br } = this;
      s.addA(a, br, 1); s.addA(b, br, -1); s.addA(br, a, 1); s.addA(br, b, -1);
      if (s.mode === 'ac') { const m = this.w.acMag || 0, ph = (this.w.acPhase || 0) * Math.PI / 180; s.addBac(br, m * Math.cos(ph), m * Math.sin(ph)); return; }
      s.addB(br, this.value(s) * s.srcScale);
    }
    breaks(tstop, ctx) { return waveBreaks(this.w, tstop, ctx); }
    probes() { return [['I(' + this.name + ')', s => s.x[this.br], s => [s.xr[this.br], s.xi[this.br]]]]; }
  }
  class ISource {
    constructor(e) { this.name = e.name; this.nn = e.nodes; this.w = e.wave; }
    setup(c) { [this.a, this.b] = this.nn.map(n => c.node(n)); }
    value(s) { if (this.sweep !== undefined) return this.sweep; return s.mode === 'tran' ? waveAt(this.w, s.time, s) : this.w.dcSet ? this.w.dc : waveAt(this.w, 0, s); }
    load(s) {
      if (s.mode === 'ac') { const m = this.w.acMag || 0, ph = (this.w.acPhase || 0) * Math.PI / 180, re = m * Math.cos(ph), im = m * Math.sin(ph); s.addBac(this.a, -re, -im); s.addBac(this.b, re, im); return; }
      const i = this.value(s) * s.srcScale; s.addB(this.a, -i); s.addB(this.b, i);
    }
    breaks(tstop, ctx) { return waveBreaks(this.w, tstop, ctx); }
    probes() { return [['I(' + this.name + ')', s => this.value(s), s => [this.w.acMag || 0, 0]]]; }
  }
  class VCVS {   // E: V(n+,n-) = gain·V(c+,c-)
    constructor(e) { this.name = e.name; this.nn = e.nodes; this.k = e.value; }
    setup(c) { [this.a, this.b, this.c, this.d] = this.nn.map(n => c.node(n)); this.br = c.branch(this.name); }
    load(s) { const { a, b, c, d, br, k } = this; s.addA(a, br, 1); s.addA(b, br, -1); s.addA(br, a, 1); s.addA(br, b, -1); s.addA(br, c, -k); s.addA(br, d, k); }
    probes() { return [['I(' + this.name + ')', s => s.x[this.br], s => [s.xr[this.br], s.xi[this.br]]]]; }
  }
  class VCCS {   // G: current gain·V(c+,c-) flows from n+ through the source to n-
    constructor(e) { this.name = e.name; this.nn = e.nodes; this.k = e.value; }
    setup(c) { [this.a, this.b, this.c, this.d] = this.nn.map(n => c.node(n)); }
    load(s) { const { a, b, c, d, k } = this; s.addA(a, c, k); s.addA(a, d, -k); s.addA(b, c, -k); s.addA(b, d, k); }
    probes() { return [['I(' + this.name + ')', s => this.k * (s.v(this.c) - s.v(this.d)), s => [this.k * (s.vr(this.c) - s.vr(this.d)), this.k * (s.vi(this.c) - s.vi(this.d))]]]; }
  }
  class CCCS {   // F: current gain·I(Vctl)
    constructor(e) { this.name = e.name; this.nn = e.nodes; this.k = e.value; this.ctl = e.ctl; }
    setup(c) { [this.a, this.b] = this.nn.map(n => c.node(n)); }
    link(c) { this.cb = c.branchOf(this.ctl, this.name); }
    load(s) { s.addA(this.a, this.cb, this.k); s.addA(this.b, this.cb, -this.k); }
    probes() { return [['I(' + this.name + ')', s => this.k * s.x[this.cb], s => [this.k * s.xr[this.cb], this.k * s.xi[this.cb]]]]; }
  }
  class CCVS {   // H: V(n+,n-) = r·I(Vctl)
    constructor(e) { this.name = e.name; this.nn = e.nodes; this.k = e.value; this.ctl = e.ctl; }
    setup(c) { [this.a, this.b] = this.nn.map(n => c.node(n)); this.br = c.branch(this.name); }
    link(c) { this.cb = c.branchOf(this.ctl, this.name); }
    load(s) { const { a, b, br } = this; s.addA(a, br, 1); s.addA(b, br, -1); s.addA(br, a, 1); s.addA(br, b, -1); s.addA(br, this.cb, -this.k); }
    probes() { return [['I(' + this.name + ')', s => s.x[this.br], s => [s.xr[this.br], s.xi[this.br]]]]; }
  }

  class Diode {
    constructor(e, model) {
      this.name = e.name; this.nn = e.nodes; const p = model.params, area = e.params.area || 1;
      this.IS = P(p, 'IS', 1e-14) * area; this.N = P(p, 'N', 1); this.RS = P(p, 'RS', 0) / area;
      this.CJO = P(p, 'CJO', P(p, 'CJ0', 0)) * area; this.VJ = P(p, 'VJ', 1); this.M = P(p, 'M', 0.5); this.FC = P(p, 'FC', 0.5); this.TT = P(p, 'TT', 0);
      this.BV = P(p, 'BV', Infinity); this.IBV = P(p, 'IBV', 1e-3);
      this.nvt = this.N * VT; this.vcrit = this.nvt * Math.log(this.nvt / (Math.SQRT2 * this.IS)); this.off = !!e.params.off;
    }
    setup(c) {
      [this.a, this.k] = this.nn.map(n => c.node(n));
      this.ai = this.RS > 0 ? c.internal(this.name + '#a') : this.a; this.slot = c.state(); this.vold = 0;
    }
    load(s) {
      const { a, ai, k, nvt } = this;
      if (this.RS > 0) { const g = 1 / this.RS; s.addA(a, a, g); s.addA(ai, ai, g); s.addA(a, ai, -g); s.addA(ai, a, -g); }
      let vd = s.v(ai) - s.v(k);
      if (s.initJct) vd = this.off ? 0 : this.vcrit;
      else if (s.mode !== 'ac') {
        if (Number.isFinite(this.BV) && vd < Math.min(0, -this.BV + 10 * nvt)) {
          let vt = -(vd + this.BV); vt = pnjlim(vt, -(this.vold + this.BV), nvt, this.vcrit, s); vd = -(vt + this.BV);
        } else vd = pnjlim(vd, this.vold, nvt, this.vcrit, s);
      }
      this.vold = vd;
      const e = safeExp(vd / nvt);
      let id = this.IS * (e - 1) + GMIN * vd, gd = this.IS * dSafeExp(vd / nvt) / nvt + GMIN;
      if (Number.isFinite(this.BV)) { const eb = safeExp(-(vd + this.BV) / nvt); id -= this.IBV * eb; gd += this.IBV * dSafeExp(-(vd + this.BV) / nvt) / nvt; }
      this.id = id; this.gd = gd;
      nlStamp(s, [ai, k], [id, -id], [[gd, -gd], [-gd, gd]], [vd, 0], this.st || (this.st = {}));
      if (this.CJO || this.TT) { const [qd, cd] = depl(vd, this.CJO, this.VJ, this.M, this.FC); capLoad(s, ai, k, this.slot, this.TT * id + qd, this.TT * gd + cd, vd); }
    }
    probes() { return [['I(' + this.name + ')', s => this.id + (s.mode === 'tran' && (this.CJO || this.TT) ? s.i0[this.slot] : 0), null]]; }
  }

  class BJT {
    constructor(e, model) {
      this.name = e.name; this.nn = e.nodes.slice(0, 3); const p = model.params, area = e.params.area || 1;
      this.pol = model.type === 'pnp' ? -1 : 1;
      this.IS = P(p, 'IS', 1e-16) * area; this.BF = P(p, 'BF', 100); this.BR = P(p, 'BR', 1); this.NF = P(p, 'NF', 1); this.NR = P(p, 'NR', 1);
      this.VAF = P(p, 'VAF', P(p, 'VA', Infinity)) || Infinity; this.VAR = P(p, 'VAR', P(p, 'VB', Infinity)) || Infinity;
      this.IKF = P(p, 'IKF', P(p, 'IK', Infinity)) || Infinity; this.IKR = P(p, 'IKR', Infinity) || Infinity;
      this.ISE = P(p, 'ISE', 0) * area; this.NE = P(p, 'NE', 1.5); this.ISC = P(p, 'ISC', 0) * area; this.NC = P(p, 'NC', 2);
      this.RB = P(p, 'RB', 0) / area; this.RC = P(p, 'RC', 0) / area; this.RE = P(p, 'RE', 0) / area;
      this.CJE = P(p, 'CJE', 0) * area; this.VJE = P(p, 'VJE', P(p, 'PE', 0.75)); this.MJE = P(p, 'MJE', P(p, 'ME', 0.33));
      this.CJC = P(p, 'CJC', 0) * area; this.VJC = P(p, 'VJC', P(p, 'PC', 0.75)); this.MJC = P(p, 'MJC', P(p, 'MC', 0.33));
      this.FC = P(p, 'FC', 0.5); this.TF = P(p, 'TF', 0); this.TR = P(p, 'TR', 0);
      this.vcritE = this.NF * VT * Math.log(this.NF * VT / (Math.SQRT2 * this.IS)); this.vcritC = this.NR * VT * Math.log(this.NR * VT / (Math.SQRT2 * this.IS));
      this.off = !!e.params.off;
    }
    setup(c) {
      [this.c, this.b, this.e] = this.nn.map(n => c.node(n));
      this.ci = this.RC > 0 ? c.internal(this.name + '#c') : this.c; this.bi = this.RB > 0 ? c.internal(this.name + '#b') : this.b; this.ei = this.RE > 0 ? c.internal(this.name + '#e') : this.e;
      this.sbe = c.state(); this.sbc = c.state(); this.vbeOld = 0; this.vbcOld = 0;
    }
    load(s) {
      const p = this.pol, { ci, bi, ei } = this;
      const res = (x, y, r) => { if (r > 0) { const g = 1 / r; s.addA(x, x, g); s.addA(y, y, g); s.addA(x, y, -g); s.addA(y, x, -g); } };
      res(this.c, ci, this.RC); res(this.b, bi, this.RB); res(this.e, ei, this.RE);
      let vbe = p * (s.v(bi) - s.v(ei)), vbc = p * (s.v(bi) - s.v(ci));
      if (s.initJct) { vbe = this.off ? 0 : this.vcritE; vbc = 0; }
      else if (s.mode !== 'ac') { vbe = pnjlim(vbe, this.vbeOld, this.NF * VT, this.vcritE, s); vbc = pnjlim(vbc, this.vbcOld, this.NR * VT, this.vcritC, s); }
      this.vbeOld = vbe; this.vbcOld = vbc;
      const nfv = this.NF * VT, nrv = this.NR * VT;
      const ef = safeExp(vbe / nfv), er = safeExp(vbc / nrv);
      const If = this.IS * (ef - 1), gif = this.IS * dSafeExp(vbe / nfv) / nfv, Ir = this.IS * (er - 1), gir = this.IS * dSafeExp(vbc / nrv) / nrv;
      // base charge (Early effect + high injection)
      const q1d = 1 - vbc / this.VAF - vbe / this.VAR, q1 = 1 / q1d, dq1be = q1 * q1 / this.VAR, dq1bc = q1 * q1 / this.VAF;
      const q2 = If / this.IKF + Ir / this.IKR, dq2be = gif / this.IKF, dq2bc = gir / this.IKR, sq = Math.sqrt(Math.max(1 + 4 * q2, 1e-12));
      const qb = q1 * (1 + sq) / 2, dqbbe = dq1be * (1 + sq) / 2 + q1 * dq2be / sq, dqbbc = dq1bc * (1 + sq) / 2 + q1 * dq2bc / sq;
      const Ict = (If - Ir) / qb, gctbe = (gif - Ict * dqbbe) / qb, gctbc = (-gir - Ict * dqbbc) / qb;
      let Ibe = If / this.BF + GMIN * vbe, gbe = gif / this.BF + GMIN;
      if (this.ISE) { const x = vbe / (this.NE * VT); Ibe += this.ISE * (safeExp(x) - 1); gbe += this.ISE * dSafeExp(x) / (this.NE * VT); }
      let Ibc = Ir / this.BR + GMIN * vbc, gbc = gir / this.BR + GMIN;
      if (this.ISC) { const x = vbc / (this.NC * VT); Ibc += this.ISC * (safeExp(x) - 1); gbc += this.ISC * dSafeExp(x) / (this.NC * VT); }
      // normalised terminal currents (into the device) and their derivatives wrt vbe, vbc
      const Ic = Ict - Ibc, Ib = Ibe + Ibc;
      const dIc = [gctbe, gctbc - gbc], dIb = [gbe, gbc], dIe = [-(gctbe + gbe), -(gctbc - gbc + gbc)];
      this.ic = p * Ic; this.ib = p * Ib;
      const rows = [dIc, dIb, dIe].map(([dbe, dbc]) => [-dbc, dbe + dbc, -dbe]);   // wrt [Vc, Vb, Ve]
      const Ve0 = s.v(ei), Vb0 = Ve0 + p * vbe, Vc0 = Vb0 - p * vbc;
      nlStamp(s, [ci, bi, ei], [p * Ic, p * Ib, -p * (Ic + Ib)], rows, [Vc0 - Ve0, Vb0 - Ve0, 0], this.st || (this.st = {}));
      if (this.CJE || this.TF) { const [q, c] = depl(vbe, this.CJE, this.VJE, this.MJE, this.FC); capLoad(s, bi, ei, this.sbe, p * (this.TF * If + q), this.TF * gif + c, p * vbe); }
      if (this.CJC || this.TR) { const [q, c] = depl(vbc, this.CJC, this.VJC, this.MJC, this.FC); capLoad(s, bi, ci, this.sbc, p * (this.TR * Ir + q), this.TR * gir + c, p * vbc); }
    }
    probes() {
      const capI = (s, slot) => s.mode === 'tran' ? s.i0[slot] : 0;
      return [['Ic(' + this.name + ')', s => this.ic - ((this.CJC || this.TR) ? capI(s, this.sbc) : 0), null],
        ['Ib(' + this.name + ')', s => this.ib + ((this.CJE || this.TF) ? capI(s, this.sbe) : 0) + ((this.CJC || this.TR) ? capI(s, this.sbc) : 0), null],
        ['Ie(' + this.name + ')', s => -this.ic - this.ib - ((this.CJE || this.TF) ? capI(s, this.sbe) : 0), null]];
    }
  }

  class MOSFET {
    constructor(e, model) {
      this.name = e.name; this.nn = e.nodes.length >= 4 ? e.nodes.slice(0, 4) : [e.nodes[0], e.nodes[1], e.nodes[2], e.nodes[2]];
      const p = model.params, ip = e.params; this.pol = model.type === 'pmos' ? -1 : 1;
      this.W = ip.w || P(p, 'W', 100e-6); this.L = ip.l || P(p, 'L', 100e-6); const m = ip.m || 1;
      this.VTO = P(p, 'VTO', P(p, 'VT0', 0)) * this.pol; this.KP = P(p, 'KP', 2e-5); this.GAMMA = P(p, 'GAMMA', 0); this.PHI = P(p, 'PHI', 0.6); this.LAMBDA = P(p, 'LAMBDA', 0);
      this.beta = this.KP * this.W / this.L * m;
      this.CGS = (P(p, 'CGS', 0) + P(p, 'CGSO', 0) * this.W) * m; this.CGD = (P(p, 'CGD', 0) + P(p, 'CGDO', 0) * this.W) * m;
      this.CBD = P(p, 'CBD', 0) * m; this.CBS = P(p, 'CBS', 0) * m;
      const tox = P(p, 'TOX', 0); if (tox > 0) this.CGS += 2 / 3 * 3.4531e-11 / tox * this.W * this.L * m;   // Meyer-style fixed share of the oxide cap
    }
    setup(c) { [this.d, this.g, this.s, this.b] = this.nn.map(n => c.node(n)); this.slots = [c.state(), c.state(), c.state(), c.state()]; this.vgsOld = 0; this.vdsOld = 0; this.vbsOld = 0; }
    load(s) {
      const p = this.pol, { d, g, b } = this, src = this.s;
      let vgs = p * (s.v(g) - s.v(src)), vds = p * (s.v(d) - s.v(src)), vbs = p * (s.v(b) - s.v(src));
      if (s.initJct) { vgs = this.VTO; vds = 0; vbs = 0; }
      else if (s.mode !== 'ac') {
        const von = this.VTO, vgs0 = vgs, vds0 = vds; let vgd = vgs - vds;
        if (this.vdsOld >= 0) { vgs = fetlim(vgs, this.vgsOld, von); vds = vgs - vgd; vds = limvds(vds, this.vdsOld); }
        else { const vgdOld = this.vgsOld - this.vdsOld; vgd = fetlim(vgd, vgdOld, von); vds = vgs - vgd; vds = -limvds(-vds, -this.vdsOld); vgs = vgd + vds; }
        if (Math.abs(vgs - vgs0) > 1e-9 * (1 + Math.abs(vgs0)) || Math.abs(vds - vds0) > 1e-9 * (1 + Math.abs(vds0))) s.limited = true; else { vgs = vgs0; vds = vds0; }
      }
      this.vgsOld = vgs; this.vdsOld = vds; this.vbsOld = vbs;
      const rev = vds < 0;
      const vg = rev ? vgs - vds : vgs, vd = rev ? -vds : vds, vb = rev ? vbs - vds : vbs;
      const sarg = Math.sqrt(Math.max(this.PHI - vb, 1e-3)), vth = this.VTO + this.GAMMA * (sarg - Math.sqrt(this.PHI));
      const vgst = vg - vth, lam = this.LAMBDA, bt = this.beta;
      let ids = 0, gm = 0, gds = 0;
      if (vgst > 0) {
        if (vd < vgst) { ids = bt * vd * (vgst - vd / 2) * (1 + lam * vd); gm = bt * vd * (1 + lam * vd); gds = bt * (vgst - vd) * (1 + lam * vd) + bt * lam * vd * (vgst - vd / 2); }
        else { ids = bt / 2 * vgst * vgst * (1 + lam * vd); gm = bt * vgst * (1 + lam * vd); gds = bt / 2 * vgst * vgst * lam; }
      }
      const gmbs = this.GAMMA ? gm * this.GAMMA / (2 * sarg) : 0;
      gds += GMIN;
      ids += GMIN * vd;
      // drain current (into the device) and its derivatives wrt [Vd, Vg, Vs, Vb]
      let Id, row;
      if (!rev) { Id = p * ids; row = [gds, gm, -(gm + gds + gmbs), gmbs]; }
      else { Id = -p * ids; row = [gm + gds + gmbs, -gm, -gds, -gmbs]; }
      this.id = Id;
      const Vs0 = s.v(src), V = [Vs0 + p * vds, Vs0 + p * vgs, Vs0, Vs0 + p * vbs];
      nlStamp(s, [d, g, src, b], [Id, 0, -Id, 0], [row, [0, 0, 0, 0], row.map(x => -x), [0, 0, 0, 0]], V.map(v => v - Vs0), this.st || (this.st = {}));
      const cap = (x, y, C, k) => { if (C) { const v = s.v(x) - s.v(y); capLoad(s, x, y, this.slots[k], C * v, C, v); } };
      cap(g, src, this.CGS, 0); cap(g, d, this.CGD, 1); cap(b, d, this.CBD, 2); cap(b, src, this.CBS, 3);
    }
    probes() { return [['Id(' + this.name + ')', s => this.id + (s.mode === 'tran' ? -(this.CGD ? s.i0[this.slots[1]] : 0) - (this.CBD ? s.i0[this.slots[2]] : 0) : 0), null]]; }
  }

  // voltage-controlled switch: conductance moves from 1/ROFF to 1/RON across VT±VH (smoothstep)
  class VSwitch {
    constructor(e, model) {
      this.name = e.name; this.nn = e.nodes; const p = model.params;
      this.ron = P(p, 'RON', 1); this.roff = P(p, 'ROFF', 1e12); this.vt = P(p, 'VT', 0); this.vh = Math.max(Math.abs(P(p, 'VH', 0)), 0.02);
      this.lon = Math.log(1 / this.ron); this.loff = Math.log(1 / this.roff);
    }
    setup(c) { [this.a, this.b, this.c, this.d] = this.nn.map(n => c.node(n)); }
    gOf(vc) {
      const x = (vc - (this.vt - this.vh)) / (2 * this.vh);
      if (x <= 0) return [Math.exp(this.loff), 0]; if (x >= 1) return [Math.exp(this.lon), 0];
      // conductance blends linearly (smoothstep) so the edge is spread over the whole VT±VH band
      const sm = x * x * (3 - 2 * x), dsm = 6 * x * (1 - x) / (2 * this.vh), gon = Math.exp(this.lon), goff = Math.exp(this.loff);
      return [goff + (gon - goff) * sm, (gon - goff) * dsm];
    }
    load(s) {
      const { a, b, c, d } = this, v = s.v(a) - s.v(b), vc = s.v(c) - s.v(d);
      const [g, dg] = this.gOf(vc); this.g = g;
      const I = g * v, dIdvc = dg * v, row = [g, -g, dIdvc, -dIdvc];
      nlStamp(s, [a, b, c, d], [I, -I, 0, 0], [row, row.map(x => -x), [0, 0, 0, 0], [0, 0, 0, 0]], [s.v(a), s.v(b), s.v(c), s.v(d)], this.st || (this.st = {}));
    }
    probes() { return [['I(' + this.name + ')', s => this.g * (s.v(this.a) - s.v(this.b)), s => [this.g * (s.vr(this.a) - s.vr(this.b)), this.g * (s.vi(this.a) - s.vi(this.b))]]]; }
  }

  // Op-amp macro model: input resistance, transconductance gain stage (single pole at GBW/Avol, optional slew
  // limit), gain node clamped smoothly at the supply rails minus Vdrop, ideal unity-gain output buffer.
  // Nodes: in+, in-, out, V+, V- (rails ignored when rails=0).
  class OpAmp {
    constructor(e) {
      this.name = e.name; this.nn = e.nodes; const p = e.params;
      this.A = P(p, 'AVOL', P(p, 'AOL', 1e6)); this.GBW = P(p, 'GBW', 10e6); this.slew = P(p, 'SLEW', 10e6); this.rin = P(p, 'RIN', 1e8);
      this.vdrop = P(p, 'VDROP', 0.1); this.rails = this.nn.length >= 5 && P(p, 'RAILS', 1) !== 0;
      this.gm = 1e-3; this.R = this.A / this.gm; this.C = this.gm / (2 * Math.PI * this.GBW);
      this.imax = this.slew > 0 && Number.isFinite(this.slew) ? this.slew * this.C : Infinity;
    }
    setup(c) {
      [this.p, this.n, this.o] = this.nn.slice(0, 3).map(n => c.node(n));
      this.vp = this.rails ? c.node(this.nn[3]) : -1; this.vn = this.rails ? c.node(this.nn[4]) : -1;
      this.x = c.internal(this.name + '#x'); this.br = c.branch(this.name); this.slot = c.state();
    }
    load(s) {
      const { p, n, o, x, br } = this, gin = 1 / this.rin;
      s.addA(p, p, gin); s.addA(n, n, gin); s.addA(p, n, -gin); s.addA(n, p, -gin);
      // gain stage: current Ig(vd) into node x, R and C to ground
      const vd = s.v(p) - s.v(n); let Ig = this.gm * vd, gg = this.gm;
      if (Number.isFinite(this.imax) && s.mode === 'tran') { const t = Math.tanh(this.gm * vd / this.imax); Ig = this.imax * t; gg = this.gm * (1 - t * t); }
      s.addA(x, x, 1 / this.R);
      nlStamp(s, [x, p, n], [-Ig, 0, 0], [[0, -gg, gg], [0, 0, 0], [0, 0, 0]], [s.v(x), s.v(p), s.v(n)], this.st1 || (this.st1 = {}));
      const vx = s.v(x); capLoad(s, x, -1, this.slot, this.C * vx, this.C, vx);
      // rail clamp on the gain node (quadratic onset, then 1 S)
      if (this.rails && s.mode !== 'ac') {
        const k = 0.05, Gc = 1, hi = s.v(this.vp) - this.vdrop, lo = s.v(this.vn) + this.vdrop;
        const clamp = (dv) => dv <= 0 ? [0, 0] : dv < k ? [Gc * dv * dv / (2 * k), Gc * dv / k] : [Gc * (dv - k / 2), Gc];
        const [ih, gh] = clamp(vx - hi), [il, gl] = clamp(lo - vx);
        // current into device at x: ih - il; d/dvx = gh + gl; d/dvp = -gh; d/dvn = -gl
        nlStamp(s, [x, this.vp, this.vn], [ih - il, 0, 0], [[gh + gl, -gh, -gl], [0, 0, 0], [0, 0, 0]], [vx, s.v(this.vp), s.v(this.vn)], this.st2 || (this.st2 = {}));
      } else if (this.rails && s.mode === 'ac') {
        const hi = s.v(this.vp) - this.vdrop, lo = s.v(this.vn) + this.vdrop, g = (vx > hi ? 1 : 0) + (vx < lo ? 1 : 0); if (g) s.addA(x, x, g);
      }
      // output buffer: V(out) = V(x)
      s.addA(o, br, 1); s.addA(br, o, 1); s.addA(br, x, -1);
    }
    probes() { return [['I(' + this.name + ')', s => -s.x[this.br], s => [-s.xr[this.br], -s.xi[this.br]]]]; }
  }

  const MODEL_DEFAULTS = { d: 'd', npn: 'npn', pnp: 'pnp', nmos: 'nmos', pmos: 'pmos', sw: 'sw', vswitch: 'sw' };

  // ---------- circuit ----------
  // flat = { elements:[{kind, name, nodes, value, params, wave, model, ctl}], models:{name:{type, params}}, options, ic:{node:v} }
  class Circuit {
    constructor(flat) {
      this.flat = flat; this.nodes = new Map(); this.nodeNames = []; this.branches = new Map(); this.branchNames = [];
      this.nStates = 0; this.devices = []; this.nonlinear = false; this.warnings = [];
      const models = flat.models || {};
      const getModel = (name, kinds) => {
        const m = models[String(name || '').toLowerCase()];
        if (!m) throw new Error(`Model "${name}" not found (used by ${this.cur})`);
        if (kinds && !kinds.includes(m.type)) throw new Error(`Model "${name}" is a ${m.type.toUpperCase()} model, ${this.cur} needs ${kinds.join('/').toUpperCase()}`);
        return m;
      };
      for (const e of flat.elements) {
        this.cur = e.name;
        let dev;
        switch (e.kind) {
          case 'R': dev = new Resistor(e); break;
          case 'C': dev = new Capacitor(e); break;
          case 'L': dev = new Inductor(e); break;
          case 'V': dev = new VSource(e); break;
          case 'I': dev = new ISource(e); break;
          case 'E': dev = new VCVS(e); break;
          case 'G': dev = new VCCS(e); break;
          case 'F': dev = new CCCS(e); break;
          case 'H': dev = new CCVS(e); break;
          case 'D': dev = new Diode(e, getModel(e.model, ['d'])); this.nonlinear = true; break;
          case 'Q': dev = new BJT(e, getModel(e.model, ['npn', 'pnp'])); this.nonlinear = true; break;
          case 'M': dev = new MOSFET(e, getModel(e.model, ['nmos', 'pmos'])); this.nonlinear = true; break;
          case 'S': dev = new VSwitch(e, getModel(e.model, ['sw'])); this.nonlinear = true; break;
          case 'O': dev = new OpAmp(e); this.nonlinear = true; break;
          case 'K': dev = new Coupling(e); break;
          default: throw new Error('Unsupported element ' + e.name);
        }
        dev.kind = e.kind; this.devices.push(dev);
      }
      // setup: nodes first, then internal nodes, then branches (so node indices are contiguous)
      const pendingBranch = [];
      const c = {
        node: n => { n = String(n).toLowerCase(); if (n === '0' || n === 'gnd') return -1; if (!this.nodes.has(n)) { this.nodes.set(n, this.nodeNames.length); this.nodeNames.push(n); } return this.nodes.get(n); },
        internal: n => { const k = n.toLowerCase(); this.nodes.set(k, this.nodeNames.length); this.nodeNames.push(k); return this.nodes.get(k); },
        branch: n => { const k = { name: n, idx: -2 }; pendingBranch.push(k); this.branches.set(n.toLowerCase(), k); return k; },
        state: () => this.nStates++,
        deviceOf: n => this.devices.find(d => d.name.toLowerCase() === String(n).toLowerCase()),
        branchOf: (vname, who) => { const k = this.branches.get(String(vname).toLowerCase()); if (!k) throw new Error(`${who}: controlling source ${vname} not found`); return k.idx; },
      };
      // pass 1: external nodes in element order (stable, readable numbering)
      flat.elements.forEach(e => e.nodes.forEach(n => c.node(n)));
      this.devices.forEach(d => { this.cur = d.name; d.setup(c); });
      this.nNodes = this.nodeNames.length;
      pendingBranch.forEach((k, i) => { k.idx = this.nNodes + i; this.branchNames.push(k.name); });
      // devices captured branch objects → swap in the index
      this.devices.forEach(d => { for (const key of ['br']) if (d[key] && typeof d[key] === 'object') d[key] = d[key].idx; });
      this.devices.forEach(d => d.link && d.link(c));
      this.n = this.nNodes + pendingBranch.length;
      if (!this.n) throw new Error('The circuit has no nodes');
    }
  }

  // ---------- simulator ----------
  class Sim {
    constructor(ckt, opts = {}) {
      this.ckt = ckt; const n = ckt.n; this.n = n;
      this.A = new Float64Array(n * n); this.b = new Float64Array(n); this.x = new Float64Array(n); this.xn = new Float64Array(n); this.perm = new Int32Array(n);
      this.q0 = new Float64Array(ckt.nStates); this.q1 = new Float64Array(ckt.nStates); this.i0 = new Float64Array(ckt.nStates); this.i1 = new Float64Array(ckt.nStates);
      const o = opts; this.reltol = o.reltol || 1e-3; this.vntol = o.vntol || 1e-6; this.abstol = o.abstol || 1e-12; this.trtol = o.trtol || 7;
      this.gshunt = o.gshunt ?? GMIN; this.maxIter = o.itl1 || 150; this.tranIter = o.itl4 || 25;
      this.mode = 'dc'; this.srcScale = 1; this.gminExtra = 0; this.time = 0; this.ag0 = 0; this.ag1 = 0; this.initJct = false; this.limited = false;
      this.iterations = 0; this.icForce = null; this.onProgress = o.onProgress || null; this.shouldStop = o.shouldStop || null;
    }
    v(i) { return i < 0 ? 0 : this.x[i]; }
    vr(i) { return i < 0 ? 0 : this.xr[i]; }
    vi(i) { return i < 0 ? 0 : this.xi[i]; }
    addA(i, j, v) { if (i >= 0 && j >= 0) this.A[i * this.n + j] += v; }
    addB(i, v) { if (i >= 0 && this.mode !== 'ac') this.b[i] += v; }
    addAi(i, j, v) { if (i >= 0 && j >= 0) this.Ai[i * this.n + j] += v; }
    addBac(i, re, im) { if (i >= 0) { this.b[i] += re; this.bi[i] += im; } }
    integ(slot, q, C) {
      this.q0[slot] = q;
      if (this.mode !== 'tran') { this.i0[slot] = 0; return [0, 0]; }
      const i = this.ag0 * (q - this.q1[slot]) - this.ag1 * this.i1[slot]; this.i0[slot] = i; return [i, this.ag0 * C];
    }
    loadAll() {
      this.A.fill(0); this.b.fill(0); this.limited = false; this.noncon = false;
      const devs = this.ckt.devices; for (let k = 0; k < devs.length; k++) devs[k].load(this);
      const g = this.gshunt + this.gminExtra, nn = this.ckt.nNodes, n = this.n;
      for (let i = 0; i < nn; i++) this.A[i * n + i] += g;
      if (this.icForce) this.icForce.forEach(([i, v]) => { this.A[i * n + i] += 1e4; this.b[i] += 1e4 * v; });
    }
    solveLinear() {
      // linear circuits: the matrix only depends on the integration coefficients — factor once, reuse
      if (!this.ckt.nonlinear && !this.icForce) {
        const key = this.mode + ':' + this.ag0 + ':' + this.ag1 + ':' + this.gminExtra;
        if (key !== this.luKey) {
          if (!this.LU) this.LU = new Float64Array(this.n * this.n);
          this.LU.set(this.A); const k = luFactor(this.LU, this.n, this.perm);
          if (k >= 0) { this.luKey = null; throw new Error('Singular matrix — ' + this.describe(k) + ' (check for a floating node, a loop of voltage sources/inductors, or a cut-set of current sources)'); }
          this.luKey = key;
        }
        luSolveF(this.LU, this.n, this.perm, this.b, this.xn); return;
      }
      const k = luSolve(this.A, this.b, this.n, this.perm, this.xn);
      if (k >= 0) throw new Error('Singular matrix — ' + this.describe(k) + ' (check for a floating node, a loop of voltage sources/inductors, or a cut-set of current sources)');
    }
    describe(k) {
      const c = this.ckt;
      if (k < c.nNodes) return 'node ' + c.nodeNames[k];
      return 'branch current of ' + c.branchNames[k - c.nNodes];
    }
    // Newton–Raphson; on success the devices have been evaluated at the returned solution
    newton(maxIter) {
      const n = this.n, nn = this.ckt.nNodes, x = this.x, xn = this.xn;
      let close = false;
      for (let it = 0; it <= maxIter; it++) {
        this.checkCur = it > 0 && close;
        this.loadAll();
        this.initJct = false;
        if (it > 0 && close && !this.limited && !this.noncon) {
          // operating points: one extra (quadratically converging) iteration for accurate small-signal quantities
          if (this.mode === 'dc' && this.ckt.nonlinear && !this.icForce) {
            for (let k = 0; k < 4; k++) {
              this.solveLinear(); let d = 0;
              for (let i = 0; i < n; i++) d = Math.max(d, Math.abs(xn[i] - x[i]) / (1e-9 + Math.abs(xn[i])));
              x.set(xn); this.loadAll(); if (d < 1e-10) break;
            }
          }
          return true;
        }
        if (it === maxIter) break;
        this.solveLinear(); this.iterations++;
        close = true;
        for (let i = 0; i < n; i++) {
          if (!Number.isFinite(xn[i])) throw new Error('Numerical overflow at ' + this.describe(i));
          if (close) { const tol = this.reltol * Math.max(Math.abs(xn[i]), Math.abs(x[i])) + (i < nn ? this.vntol : this.abstol); if (Math.abs(xn[i] - x[i]) > tol) close = false; }
        }
        if (this.limited) close = false;
        x.set(xn);
      }
      return false;
    }
    // DC operating point with gmin stepping and source stepping fallbacks
    op() {
      this.mode = 'dc'; this.srcScale = 1; this.gminExtra = 0;
      const x0 = this.x.slice();
      this.initJct = true;
      try { if (this.newton(this.maxIter)) return 'direct'; } catch (e) { if (!/overflow/.test(e.message)) throw e; }
      // gmin stepping
      this.x.set(x0); this.initJct = true; let ok = true;
      for (let g = 1e-2; g >= 1e-13; g /= 10) { this.gminExtra = g; try { if (!this.newton(this.maxIter)) { ok = false; break; } } catch (e) { ok = false; break; } }
      this.gminExtra = 0;
      if (ok) { try { if (this.newton(this.maxIter)) return 'gmin stepping'; } catch (e) { } }
      // source stepping
      this.x.fill(0); this.initJct = true; let sc = 0, step = 0.1; ok = true;
      while (sc < 1) {
        const prev = this.x.slice(), next = Math.min(1, sc + step); this.srcScale = next;
        let good = false; try { good = this.newton(this.maxIter); } catch (e) { good = false; }
        if (good) { sc = next; step = Math.min(step * 1.5, 0.25); }
        else { this.x.set(prev); step /= 4; if (step < 1e-5) { ok = false; break; } }
      }
      this.srcScale = 1;
      if (ok) return 'source stepping';
      throw new Error('DC operating point did not converge (tried Newton, gmin stepping and source stepping)');
    }

    // ---------- outputs ----------
    probeList(ac) {
      const c = this.ckt, out = [];
      c.nodeNames.forEach((name, i) => { if (!name.includes('#')) out.push(['V(' + name + ')', ac ? s => [s.xr[i], s.xi[i]] : s => s.x[i]]); });
      c.devices.forEach(d => (d.probes && !d.name.includes('#') ? d.probes() : []).forEach(([name, f, fac]) => { if (ac ? fac : f) out.push([name, ac ? fac : f]); }));
      return out;
    }
  }

  function makeRecorder(sim, ac) {
    const probes = sim.probeList(ac), cols = probes.map(() => []), colsI = ac ? probes.map(() => []) : null, xs = [];
    return {
      names: probes.map(p => p[0]),
      push(xv) {
        xs.push(xv);
        for (let k = 0; k < probes.length; k++) { const v = probes[k][1](sim); if (ac) { cols[k].push(v[0]); colsI[k].push(v[1]); } else cols[k].push(v); }
      },
      done(xname, analysis, extra) {
        const vectors = {}; probes.forEach((p, k) => { vectors[p[0]] = ac ? { re: Float64Array.from(cols[k]), im: Float64Array.from(colsI[k]) } : Float64Array.from(cols[k]); });
        return { analysis, xname, x: Float64Array.from(xs), vectors, complex: !!ac, ...extra };
      },
    };
  }

  function findSource(ckt, name) {
    const d = ckt.devices.find(x => x.name.toLowerCase() === String(name).toLowerCase() && (x.kind === 'V' || x.kind === 'I'));
    if (!d) throw new Error(`Sweep source ${name} not found`); return d;
  }
  function icList(ckt, ic) { if (!ic) return null; const out = []; Object.entries(ic).forEach(([n, v]) => { const i = ckt.nodes.get(n.toLowerCase()); if (i !== undefined) out.push([i, v]); }); return out.length ? out : null; }

  function runOp(ckt, opts = {}) {
    const sim = new Sim(ckt, opts); const t0 = Date.now(); const how = sim.op();
    const rec = makeRecorder(sim, false); rec.push(0);
    const r = rec.done('', 'op', { converged: how, iterations: sim.iterations, ms: Date.now() - t0 });
    r.op = {}; Object.entries(r.vectors).forEach(([k, v]) => { r.op[k] = v[0]; });
    return r;
  }

  function runDC(ckt, an, opts = {}) {
    const sim = new Sim(ckt, opts), t0 = Date.now();
    const src = findSource(ckt, an.src), vals = [];
    const { start, stop } = an; let step = an.step || (stop - start) / 100; if (!step) step = 1;
    if ((stop - start) / step < 0) step = -step;
    const n = Math.floor((stop - start) / step + 1e-9);
    if (n > 2e5) throw new Error('.dc sweep has too many points');
    for (let k = 0; k <= n; k++) vals.push(start + k * step);
    const rec = makeRecorder(sim, false);
    let first = true;
    for (const v of vals) {
      src.sweep = v;
      if (first) { sim.op(); first = false; }
      else { sim.mode = 'dc'; let ok = false; try { ok = sim.newton(sim.maxIter); } catch (e) { ok = false; } if (!ok) sim.op(); }
      rec.push(v);
      if (sim.shouldStop && sim.shouldStop()) break;
    }
    delete src.sweep;
    return rec.done(src.name, 'dc', { iterations: sim.iterations, ms: Date.now() - t0 });
  }

  function acFreqs(an) {
    const out = [], { fstart, fstop } = an, n = Math.max(1, Math.round(an.n || 10));
    if (!(fstart > 0) || !(fstop >= fstart)) throw new Error('.ac needs 0 < fstart ≤ fstop');
    if (an.sweep === 'lin') { if (n > 2e5) throw new Error('.ac sweep has too many points'); for (let k = 0; k < n; k++) out.push(n === 1 ? fstart : fstart + (fstop - fstart) * k / (n - 1)); return out; }
    const per = an.sweep === 'oct' ? Math.log(2) : Math.log(10), r = Math.exp(per / n);
    for (let f = fstart; f <= fstop * (1 + 1e-9); f *= r) { out.push(f); if (out.length > 2e5) throw new Error('.ac sweep has too many points'); }
    return out;
  }
  function runAC(ckt, an, opts = {}) {
    const sim = new Sim(ckt, opts), t0 = Date.now(); sim.op();
    const n = sim.n; sim.Ai = new Float64Array(n * n); sim.bi = new Float64Array(n); sim.xr = new Float64Array(n); sim.xi = new Float64Array(n);
    const rec = makeRecorder(sim, true);
    sim.mode = 'ac';
    for (const f of acFreqs(an)) {
      sim.omega = 2 * Math.PI * f;
      sim.A.fill(0); sim.Ai.fill(0); sim.b.fill(0); sim.bi.fill(0);
      ckt.devices.forEach(d => d.load(sim));
      for (let i = 0; i < ckt.nNodes; i++) sim.A[i * n + i] += sim.gshunt;
      const k = luSolveC(sim.A, sim.Ai, sim.b, sim.bi, n, sim.xr, sim.xi);
      if (k >= 0) throw new Error('Singular AC matrix at ' + sim.describe(k));
      rec.push(f);
    }
    return rec.done('frequency', 'ac', { ms: Date.now() - t0 });
  }

  function runTran(ckt, an, opts = {}) {
    const sim = new Sim(ckt, opts), t0 = Date.now();
    const tstop = an.tstop, tstart = an.tstart || 0; if (!(tstop > 0)) throw new Error('.tran needs a stop time > 0');
    const tstep = an.tstep > 0 ? an.tstep : tstop / 1000;
    sim.tstep = tstep; sim.tstop = tstop;
    const hmax = Math.min(an.tmax > 0 ? an.tmax : Infinity, tstop / 50, Math.max(tstep, tstop / 2000) * (an.tmax > 0 ? Infinity : 1));
    const hmin = tstop * 1e-14;
    const trap = (opts.method || an.method || 'trap') !== 'euler' && (opts.method || an.method) !== 'gear';
    const nProbes = sim.probeList(false).length, maxPoints = opts.maxPoints || Math.max(20000, Math.min(1e6, Math.floor(2e7 / Math.max(1, nProbes))));
    // initial state
    if (an.uic) {
      sim.mode = 'tran'; ckt.devices.forEach(d => d.uic && d.uic(sim));
      const q1 = sim.q1.slice(); sim.time = 0;
      // solve t=0 as a tiny backward-Euler step: capacitors/inductors are pinned to their initial charge
      sim.ag0 = 1 / (tstep * 1e-6); sim.ag1 = 0; sim.initJct = true;
      if (!sim.newton(sim.maxIter)) throw new Error('Could not solve the initial conditions (UIC)');
      sim.q1.set(q1); sim.i1.fill(0);
      for (let k = 0; k < sim.q0.length; k++) if (q1[k] === 0) { /* keep zero */ }
    } else {
      sim.icForce = icList(ckt, an.ic); sim.op(); sim.icForce = null;
      if (an.ic && Object.keys(an.ic).length) { sim.mode = 'dc'; /* release forced nodes but keep charges from the forced solution */ }
      sim.mode = 'tran'; sim.ag0 = 0; sim.ag1 = 0;
      ckt.devices.forEach(d => d.load(sim));          // refresh charges q0 at the operating point (integ in dc mode would zero i)
      sim.q1.set(sim.q0); sim.i1.fill(0);
    }
    sim.mode = 'tran'; sim.time = 0;
    // breakpoints
    let bps = [tstop]; ckt.devices.forEach(d => { if (d.breaks) bps.push(...d.breaks(tstop, sim)); });
    if (tstart > 0) bps.push(tstart);
    bps = [...new Set(bps.map(t => +t.toPrecision(12)))].filter(t => t > 0 && t <= tstop).sort((a, b) => a - b);
    let bi = 0;
    const rec = makeRecorder(sim, false);
    // record t=0 with the state currents zero
    sim.i0.fill(0); if (tstart <= 0) rec.push(0);
    const nn = ckt.nNodes;
    const hist = [{ t: 0, x: sim.x.slice() }];    // accepted points for the predictor
    let t = 0, h = Math.min(tstep, tstop / 50) / 10, firstAfterBreak = true, rejected = 0, accepted = 0, lastProg = 0;
    h = Math.min(h, hmax);
    const xPrev = new Float64Array(sim.n);
    while (t < tstop * (1 - 1e-12)) {
      while (bi < bps.length && bps[bi] <= t * (1 + 1e-12) + hmin) bi++;
      const nextBp = bi < bps.length ? bps[bi] : tstop;
      let hh = Math.min(h, hmax);
      let hitBp = false;
      if (t + hh >= nextBp - hmin) { hh = nextBp - t; hitBp = true; }
      else if (t + 1.8 * hh > nextBp) { hh = (nextBp - t) / 2; }
      const useBE = !trap || firstAfterBreak;
      sim.ag0 = useBE ? 1 / hh : 2 / hh; sim.ag1 = useBE ? 0 : 1;
      sim.time = t + hh;
      xPrev.set(sim.x);
      let ok = false, err = null;
      try { ok = sim.newton(sim.tranIter); } catch (e) { err = e; ok = false; }
      if (!ok) {
        sim.x.set(xPrev); rejected++; sim.nrFail = (sim.nrFail || 0) + 1;
        h = hh / 8; firstAfterBreak = true;
        if (h < hmin) throw new Error(`Time step too small at t=${Ex.fmtEng(t, 4)}s` + (err ? ': ' + err.message : ' (Newton did not converge)'));
        continue;
      }
      // local truncation error from the difference to a polynomial predictor
      let hNew = hh * 2;
      const order = useBE ? 1 : 2;
      if (hist.length >= order + 1 && !firstAfterBreak) {
        const pts = hist.slice(-(order + 1)), tn = t + hh;
        let r = 0;
        for (let i = 0; i < nn; i++) {
          let pred = 0;
          for (let a = 0; a < pts.length; a++) { let L = 1; for (let b = 0; b < pts.length; b++) if (b !== a) L *= (tn - pts[b].t) / (pts[a].t - pts[b].t); pred += L * pts[a].x[i]; }
          const xi = sim.x[i], e = Math.abs(xi - pred) / (order === 2 ? 13 : 3);
          const tol = this_tol(sim, xi, pts[pts.length - 1].x[i]);
          if (e / tol > r) { r = e / tol; sim.worst = i; }
        }
        if (r > 1 && hh > hmin * 10) {
          sim.x.set(xPrev); rejected++;
          h = hh * Math.max(0.2, 0.9 * Math.pow(r, -1 / (order + 1)));
          continue;
        }
        hNew = hh * Math.min(2, Math.max(0.3, 0.9 * Math.pow(Math.max(r, 1e-9), -1 / (order + 1))));
      }
      // accept
      t = t + hh; accepted++;
      sim.q1.set(sim.q0); sim.i1.set(sim.i0);
      if (t >= tstart - hmin) rec.push(t);
      hist.push({ t, x: sim.x.slice() }); if (hist.length > 4) hist.shift();
      firstAfterBreak = false;
      if (hitBp) {
        bi++; firstAfterBreak = true; hist.length = 0; hist.push({ t, x: sim.x.slice() });
        const nb = bi < bps.length ? bps[bi] : tstop;
        hNew = Math.min(hNew, Math.max((nb - t) / 10, hmin * 10), tstep);
      }
      h = Math.max(Math.min(hNew, hmax), hmin * 2);
      if (accepted > maxPoints) throw new Error('Too many time points — increase the time step or shorten the simulation');
      if (sim.onProgress && accepted - lastProg > 200) { lastProg = accepted; sim.onProgress(t / tstop); }
      if (sim.shouldStop && sim.shouldStop()) break;
    }
    return rec.done('time', 'tran', { iterations: sim.iterations, accepted, rejected, nrFail: sim.nrFail || 0, ms: Date.now() - t0 });
  }
  function this_tol(sim, x, xp) { return sim.trtol * (sim.reltol * Math.max(Math.abs(x), Math.abs(xp)) + sim.vntol * 10); }

  function run(flat, analysis, opts = {}) {
    const ckt = new Circuit(flat);
    const o = { ...(flat.options || {}), ...opts };
    switch (analysis.type) {
      case 'op': return runOp(ckt, o);
      case 'dc': return runDC(ckt, analysis, o);
      case 'ac': return runAC(ckt, analysis, o);
      case 'tran': return runTran(ckt, { ...analysis, ic: flat.ic }, o);
    }
    throw new Error('Unknown analysis ' + analysis.type);
  }

  const api = { VT, Circuit, Sim, run, runOp, runDC, runAC, runTran, waveAt, waveBreaks, luSolve, luSolveC, depl, pnjlim, acFreqs, MODEL_DEFAULTS };
  if (isNode) module.exports = api; else root.SpiceEngine = api;
})(typeof self !== 'undefined' ? self : this);
