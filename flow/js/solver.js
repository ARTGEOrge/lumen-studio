// Lumen Flow solver: 2D incompressible Navier–Stokes on a staggered (MAC) grid, projection method after
// Griebel, Dornseifer & Neunhoeffer, "Numerical Simulation in Fluid Dynamics" (NaSt2D): donor-cell/central blended
// advection, explicit diffusion, pressure Poisson solved by conjugate gradients, obstacle cells, passive dye.
// No DOM — runs in Node for the validation tests.
(function (root) {
  'use strict';
  // sides: {left,right,bottom,top} each {type:'wall'|'slip'|'inlet'|'outlet'|'moving', u, v}
  class Flow {
    constructor({ nx, ny, Lx, Ly, nu, rho = 1, sides, tau = 0.5, maxCG = 400, tolCG = 1e-5, heat = null }) {
      Object.assign(this, { nx, ny, Lx, Ly, nu, rho, tau, maxCG, tolCG });
      // heat = { Pr, Tin, Tbody, cp } — temperature is carried by the flow and diffuses with α = ν / Pr; sides may set { T }
      this.heat = heat; this.alpha = heat ? nu / heat.Pr : 0;
      this.dx = Lx / nx; this.dy = Ly / ny; this.W = nx + 2; this.H = ny + 2; const N = this.W * this.H;
      this.u = new Float64Array(N); this.v = new Float64Array(N); this.p = new Float64Array(N); this.F = new Float64Array(N); this.G = new Float64Array(N);
      this.solid = new Uint8Array(N); this.dye = new Float32Array(N); this.dye2 = new Float32Array(N);
      this.T = new Float64Array(N).fill(heat ? heat.Tin : 0); this.T2 = new Float64Array(N);
      this.sides = { left: { type: 'wall' }, right: { type: 'wall' }, bottom: { type: 'wall' }, top: { type: 'wall' }, ...sides };
      this.t = 0; this.steps = 0; this.dt = 0; this.cgIters = 0; this.divMax = 0;
      // CG work arrays over fluid cells
      this.r = new Float64Array(N); this.z = new Float64Array(N); this.q = new Float64Array(N); this.d = new Float64Array(N); this.diag = new Float64Array(N);
      this.setObstacles(null);
    }
    I(i, j) { return j * this.W + i; }
    isFluid(i, j) { return i >= 1 && i <= this.nx && j >= 1 && j <= this.ny && !this.solid[j * this.W + i]; }
    // obstacle mask: function (x, y) → true where solid (cell centres), or null for none
    setObstacles(fn) {
      const { nx, ny, dx, dy } = this; this.solid.fill(0);
      for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) if (fn && fn((i - 0.5) * dx, (j - 0.5) * dy)) this.solid[this.I(i, j)] = 1;
      // a fluid region needs at least 2 fluid cells between obstacles: drop single-cell slivers (NaSt2D rule)
      for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) { const k = this.I(i, j); if (!this.solid[k]) continue; const f = (a, b) => this.isFluid(a, b); if ((f(i - 1, j) && f(i + 1, j)) || (f(i, j - 1) && f(i, j + 1))) this.solid[k] = 0; }
      this.buildPoisson();
      for (let k = 0; k < this.u.length; k++) if (this.solid[k]) { this.u[k] = 0; this.v[k] = 0; }
    }
    paint(x, y, r, solid) { const { nx, ny, dx, dy } = this; for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) { const cx = (i - 0.5) * dx, cy = (j - 0.5) * dy; if ((cx - x) ** 2 + (cy - y) ** 2 <= r * r) this.solid[this.I(i, j)] = solid ? 1 : 0; } const s = new Uint8Array(this.solid); this.setObstacles((X, Y) => s[this.I(Math.min(nx, Math.max(1, Math.round(X / dx + 0.5))), Math.min(ny, Math.max(1, Math.round(Y / dy + 0.5))))]); }
    buildPoisson() {
      // diagonal of −∇² for each fluid cell: walls/obstacles are Neumann (no term), outlet boundaries are Dirichlet p = 0
      const { nx, ny, dx, dy, sides } = this, ax = 1 / (dx * dx), ay = 1 / (dy * dy);
      this.dirichlet = { left: sides.left.type === 'outlet', right: sides.right.type === 'outlet', bottom: sides.bottom.type === 'outlet', top: sides.top.type === 'outlet' };
      this.pinned = !Object.values(this.dirichlet).some(Boolean);
      for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
        const k = this.I(i, j); if (this.solid[k]) { this.diag[k] = 0; continue; }
        let d = 0;
        d += i > 1 ? (this.solid[k - 1] ? 0 : ax) : (this.dirichlet.left ? ax : 0);
        d += i < nx ? (this.solid[k + 1] ? 0 : ax) : (this.dirichlet.right ? ax : 0);
        d += j > 1 ? (this.solid[k - this.W] ? 0 : ay) : (this.dirichlet.bottom ? ay : 0);
        d += j < ny ? (this.solid[k + this.W] ? 0 : ay) : (this.dirichlet.top ? ay : 0);
        this.diag[k] = d;
      }
      // modified incomplete Cholesky MIC(0) (Bridson, "Fluid Simulation for Computer Graphics"): precon = 1/sqrt(e)
      const pc = this.precon || (this.precon = new Float64Array(this.diag.length)), tauM = 0.97, sigma = 0.25, s = this.solid, W = this.W;
      const Ai = k => (!s[k] && !s[k + 1] && (k % W) < nx) ? -ax : 0, Aj = k => (!s[k] && !s[k + W] && Math.floor(k / W) < ny) ? -ay : 0;
      this.Ai = new Float64Array(this.diag.length); this.Aj = new Float64Array(this.diag.length);
      for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) { const k = j * W + i; this.Ai[k] = Ai(k); this.Aj[k] = Aj(k); }
      pc.fill(0);
      const fl = []; for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) { const k = j * W + i; if (!s[k]) fl.push(k); } this.fl = Int32Array.from(fl);
      for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
        const k = j * W + i; if (s[k]) continue;
        const kw = k - 1, ks = k - W, Aw = i > 1 ? this.Ai[kw] : 0, As = j > 1 ? this.Aj[ks] : 0, pw = i > 1 ? pc[kw] : 0, ps = j > 1 ? pc[ks] : 0;
        let e = this.diag[k] - (Aw * pw) ** 2 - (As * ps) ** 2 - tauM * (Aw * (i > 1 ? this.Aj[kw] : 0) * pw * pw + As * (j > 1 ? this.Ai[ks] : 0) * ps * ps);
        if (e < sigma * this.diag[k]) e = this.diag[k];
        pc[k] = e > 0 ? 1 / Math.sqrt(e) : 0;
      }
    }
    // z = M⁻¹ r with the MIC(0) factors (forward then backward substitution)
    precondition(r, z) {
      const { W, precon: pc, Ai, Aj, fl } = this, q = this.qtmp || (this.qtmp = new Float64Array(r.length)), n = fl.length;
      for (let m = 0; m < n; m++) { const k = fl[m]; q[k] = (r[k] - Ai[k - 1] * pc[k - 1] * q[k - 1] - Aj[k - W] * pc[k - W] * q[k - W]) * pc[k]; }
      let rz = 0;
      for (let m = n - 1; m >= 0; m--) { const k = fl[m]; const zk = (q[k] - Ai[k] * pc[k] * z[k + 1] - Aj[k] * pc[k] * z[k + W]) * pc[k]; z[k] = zk; rz += r[k] * zk; }
      return rz;
    }
    // ---------- boundary conditions ----------
    applyBC() {
      const { nx, ny, u, v, W, sides } = this, I = (i, j) => j * W + i;
      for (let j = 1; j <= ny; j++) {
        const L = sides.left, R = sides.right;
        if (L.type === 'inlet') { u[I(0, j)] = this.solid[I(1, j)] ? 0 : L.u || 0; v[I(0, j)] = 2 * (L.v || 0) - v[I(1, j)]; }
        else if (L.type === 'outlet') { v[I(0, j)] = v[I(1, j)]; }   // normal velocity comes from the projection (p = 0 outside)
        else { u[I(0, j)] = 0; v[I(0, j)] = L.type === 'slip' ? v[I(1, j)] : 2 * (L.type === 'moving' ? L.v || 0 : 0) - v[I(1, j)]; }
        if (R.type === 'inlet') { u[I(nx, j)] = this.solid[I(nx, j)] ? 0 : R.u || 0; v[I(nx + 1, j)] = 2 * (R.v || 0) - v[I(nx, j)]; }
        else if (R.type === 'outlet') { v[I(nx + 1, j)] = v[I(nx, j)]; }
        else { u[I(nx, j)] = 0; v[I(nx + 1, j)] = R.type === 'slip' ? v[I(nx, j)] : 2 * (R.type === 'moving' ? R.v || 0 : 0) - v[I(nx, j)]; }
      }
      for (let i = 1; i <= nx; i++) {
        const B = sides.bottom, T = sides.top;
        if (B.type === 'inlet') { v[I(i, 0)] = B.v || 0; u[I(i, 0)] = 2 * (B.u || 0) - u[I(i, 1)]; }
        else if (B.type === 'outlet') { u[I(i, 0)] = u[I(i, 1)]; }
        else { v[I(i, 0)] = 0; u[I(i, 0)] = B.type === 'slip' ? u[I(i, 1)] : 2 * (B.type === 'moving' ? B.u || 0 : 0) - u[I(i, 1)]; }
        if (T.type === 'inlet') { v[I(i, ny)] = T.v || 0; u[I(i, ny + 1)] = 2 * (T.u || 0) - u[I(i, ny)]; }
        else if (T.type === 'outlet') { u[I(i, ny + 1)] = u[I(i, ny)]; }
        else { v[I(i, ny)] = 0; u[I(i, ny + 1)] = T.type === 'slip' ? u[I(i, ny)] : 2 * (T.type === 'moving' ? T.u || 0 : 0) - u[I(i, ny)]; }
      }
      // obstacles, face by face: a face touching a solid cell carries no flow; a face buried in solid mirrors the
      // tangential velocity of the fluid next to it so the wall is no-slip
      const S = this.solid;
      for (let j = 1; j <= ny; j++) for (let i = 1; i < nx; i++) {
        const k = I(i, j), a = S[k], b = S[k + 1]; if (!a && !b) continue;
        if (!(a && b)) { u[k] = 0; continue; }
        if (j < ny && !S[k + W] && !S[k + W + 1]) u[k] = -u[k + W]; else if (j > 1 && !S[k - W] && !S[k - W + 1]) u[k] = -u[k - W]; else u[k] = 0;
      }
      for (let j = 1; j < ny; j++) for (let i = 1; i <= nx; i++) {
        const k = I(i, j), a = S[k], b = S[k + W]; if (!a && !b) continue;
        if (!(a && b)) { v[k] = 0; continue; }
        if (i < nx && !S[k + 1] && !S[k + W + 1]) v[k] = -v[k + 1]; else if (i > 1 && !S[k - 1] && !S[k + W - 1]) v[k] = -v[k - 1]; else v[k] = 0;
      }
    }
    computeDt() {
      let um = 1e-12, vm = 1e-12; for (let k = 0; k < this.u.length; k++) { const a = Math.abs(this.u[k]), b = Math.abs(this.v[k]); if (a > um) um = a; if (b > vm) vm = b; }
      const { dx, dy, tau } = this, nu = Math.max(this.nu, this.alpha); const diff = 0.5 / (nu * (1 / (dx * dx) + 1 / (dy * dy)));
      this.dt = tau * Math.min(diff, dx / um, dy / vm); this.umax = Math.max(um, vm); return this.dt;
    }
    computeFG() {
      const { nx, ny, u, v, F, G, W, dx, dy, nu, dt } = this, I = (i, j) => j * W + i;
      const gam = Math.min(1, Math.max(this.umax * dt / Math.min(dx, dy) * 1.2, 0.05));
      for (let j = 1; j <= ny; j++) for (let i = 0; i <= nx; i++) {
        const k = I(i, j);
        if (i === 0 || i === nx || this.solid[k] || this.solid[k + 1]) { F[k] = u[k]; continue; }
        const uc = u[k], ue = u[k + 1], uw = u[k - 1], un = u[k + W], us = u[k - W];
        const lap = (ue - 2 * uc + uw) / (dx * dx) + (un - 2 * uc + us) / (dy * dy);
        const du2 = ((uc + ue) ** 2 - (uw + uc) ** 2) / (4 * dx) + gam * (Math.abs(uc + ue) * (uc - ue) - Math.abs(uw + uc) * (uw - uc)) / (4 * dx);
        const vn = v[k] + v[k + 1], vs = v[k - W] + v[k + 1 - W];
        const duv = (vn * (uc + un) - vs * (us + uc)) / (4 * dy) + gam * (Math.abs(vn) * (uc - un) - Math.abs(vs) * (us - uc)) / (4 * dy);
        F[k] = uc + dt * (nu * lap - du2 - duv);
      }
      for (let j = 0; j <= ny; j++) for (let i = 1; i <= nx; i++) {
        const k = I(i, j);
        if (j === 0 || j === ny || this.solid[k] || this.solid[k + W]) { G[k] = v[k]; continue; }
        const vc = v[k], vn = v[k + W], vs = v[k - W], ve = v[k + 1], vw = v[k - 1];
        const lap = (ve - 2 * vc + vw) / (dx * dx) + (vn - 2 * vc + vs) / (dy * dy);
        const ue = u[k] + u[k + W], uw = u[k - 1] + u[k - 1 + W];
        const duv = (ue * (vc + ve) - uw * (vw + vc)) / (4 * dx) + gam * (Math.abs(ue) * (vc - ve) - Math.abs(uw) * (vw - vc)) / (4 * dx);
        const dv2 = ((vc + vn) ** 2 - (vs + vc) ** 2) / (4 * dy) + gam * (Math.abs(vc + vn) * (vc - vn) - Math.abs(vs + vc) * (vs - vc)) / (4 * dy);
        G[k] = vc + dt * (nu * lap - duv - dv2);
      }
    }
    // A·x for −∇² over fluid cells (Neumann at walls/obstacles, Dirichlet 0 at outlets)
    applyA(x, out) {
      const { W, dx, dy, fl, diag } = this, ax = 1 / (dx * dx), ay = 1 / (dy * dy), Ai = this.Ai, Aj = this.Aj; let dot = 0;
      // off-diagonals are −ax / −ay exactly where Ai/Aj are non-zero (both cells fluid, inside the domain)
      for (let m = 0; m < fl.length; m++) { const k = fl[m]; const a = diag[k] * x[k] + Ai[k] * x[k + 1] + Ai[k - 1] * x[k - 1] + Aj[k] * x[k + W] + Aj[k - W] * x[k - W]; out[k] = a; dot += a * x[k]; }
      return dot;   // x·Ax, used by CG
    }
    solveP() {
      const { nx, ny, W, F, G, dx, dy, dt, p, r, z, q, d, diag } = this, s = this.solid;
      // rhs b = −div(F,G)/dt  (we solve −∇²p = b)
      let sum = 0, cnt = 0;
      for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) { const k = j * W + i; if (s[k]) { r[k] = 0; continue; } r[k] = -((F[k] - F[k - 1]) / dx + (G[k] - G[k - W]) / dy) / dt; sum += r[k]; cnt++; }
      if (this.pinned) { const m = sum / cnt; for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) { const k = j * W + i; if (!s[k]) r[k] -= m; } }
      const fl = this.fl, n = fl.length;
      let bmax = 0; for (let m = 0; m < n; m++) { const a = Math.abs(r[fl[m]]); if (a > bmax) bmax = a; }
      this.applyA(p, q);
      let rm = 0; for (let m = 0; m < n; m++) { const k = fl[m]; r[k] -= q[k]; const a = Math.abs(r[k]); if (a > rm) rm = a; }
      const tol = this.tolCG * Math.max(bmax, 1e-30);
      let it = 0;
      if (rm > tol) {
        let rz = this.precondition(r, z); for (let m = 0; m < n; m++) d[fl[m]] = z[fl[m]];
        for (; it < this.maxCG; it++) {
          const dq = this.applyA(d, q); if (!dq) break;
          const a = rz / dq; rm = 0;
          for (let m = 0; m < n; m++) { const k = fl[m]; p[k] += a * d[k]; const rk = r[k] - a * q[k]; r[k] = rk; const ab = rk < 0 ? -rk : rk; if (ab > rm) rm = ab; }
          if (rm <= tol) { it++; break; }
          const rz2 = this.precondition(r, z), b = rz2 / rz; rz = rz2;
          for (let m = 0; m < n; m++) { const k = fl[m]; d[k] = z[k] + b * d[k]; }
        }
      }
      this.cgIters = it;
      // ghost pressures (for display / forces): Neumann copies, Dirichlet zero
      for (let j = 1; j <= ny; j++) { p[j * W] = this.dirichlet.left ? 0 : p[j * W + 1]; p[j * W + nx + 1] = this.dirichlet.right ? 0 : p[j * W + nx]; }
      for (let i = 1; i <= nx; i++) { p[i] = this.dirichlet.bottom ? 0 : p[W + i]; p[(ny + 1) * W + i] = this.dirichlet.top ? 0 : p[ny * W + i]; }
    }
    correct() {
      const { nx, ny, u, v, F, G, p, W, dx, dy, dt } = this, s = this.solid;
      for (let j = 1; j <= ny; j++) for (let i = 1; i < nx; i++) { const k = j * W + i; if (!s[k] && !s[k + 1]) u[k] = F[k] - dt * (p[k + 1] - p[k]) / dx; }
      for (let j = 1; j < ny; j++) for (let i = 1; i <= nx; i++) { const k = j * W + i; if (!s[k] && !s[k + W]) v[k] = G[k] - dt * (p[k + W] - p[k]) / dy; }
      // outlet faces: the Poisson matrix puts p = 0 in the ghost cell centre, so the face gradient is (0 − p)/h
      if (this.dirichlet.right) for (let j = 1; j <= ny; j++) { const k = j * W + nx; if (!s[k]) u[k] = F[k] + dt * p[k] / dx; }
      if (this.dirichlet.left) for (let j = 1; j <= ny; j++) { const k = j * W; if (!s[k + 1]) u[k] = F[k] - dt * p[k + 1] / dx; }
      if (this.dirichlet.top) for (let i = 1; i <= nx; i++) { const k = ny * W + i; if (!s[k]) v[k] = G[k] + dt * p[k] / dy; }
      if (this.dirichlet.bottom) for (let i = 1; i <= nx; i++) { const k = i; if (!s[k + W]) v[k] = G[k] - dt * p[k + W] / dy; }
    }
    advectDye() {
      // semi-Lagrangian, bilinear on cell centres; inlet cells inject stripes
      const { nx, ny, W, dx, dy, dt, dye, dye2 } = this, s = this.solid;
      const sample = (x, y) => { const fi = Math.min(nx - 1e-6, Math.max(0, x / dx - 0.5)) + 1, fj = Math.min(ny - 1e-6, Math.max(0, y / dy - 0.5)) + 1; const i = Math.min(nx - 1, Math.floor(fi)), j = Math.min(ny - 1, Math.floor(fj)), a = fi - i, b = fj - j; const k = j * W + i; return (1 - a) * (1 - b) * dye[k] + a * (1 - b) * dye[k + 1] + (1 - a) * b * dye[k + W] + a * b * dye[k + W + 1]; };
      for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
        const k = j * W + i; if (s[k]) { dye2[k] = 0; continue; }
        const uc = (this.u[k] + this.u[k - 1]) / 2, vc = (this.v[k] + this.v[k - W]) / 2;
        dye2[k] = sample((i - 0.5) * dx - uc * dt, (j - 0.5) * dy - vc * dt) * 0.9995;
      }
      if (this.sides.left.type === 'inlet') for (let j = 1; j <= ny; j++) dye2[j * W + 1] = Math.floor(j / Math.max(2, ny / 12)) % 2;
      this.dye.set(dye2);
    }
    step() {
      this.computeDt(); this.applyBC(); this.computeFG(); this.solveP(); this.correct(); this.applyBC(); this.advectDye(); if (this.heat) this.stepT();
      this.t += this.dt; this.steps++;
    }

    // ---------- heat ----------
    // temperature a neighbour presents across a face: body/side wall at fixed T, inflow at Tin, otherwise insulated
    ghostT(k, side) {
      const sd = this.sides[side], h = this.heat;
      if (sd.type === 'inlet') return 2 * h.Tin - this.T[k];
      if (sd.T != null && sd.type !== 'outlet') return 2 * sd.T - this.T[k];
      return this.T[k];
    }
    stepT() {
      const { nx, ny, W, dx, dy, dt, T, T2, alpha } = this, s = this.solid, h = this.heat, Tb = h.Tbody;
      // semi-Lagrangian advection (bilinear), then explicit diffusion with the boundary rules above
      const inL = this.sides.left.type === 'inlet', inR = this.sides.right.type === 'inlet';
      const sample = (x, y) => { if ((x < 0 && inL) || (x > this.Lx && inR)) return h.Tin; const fi = Math.min(nx - 1e-6, Math.max(0, x / dx - 0.5)) + 1, fj = Math.min(ny - 1e-6, Math.max(0, y / dy - 0.5)) + 1; const i = Math.min(nx - 1, Math.floor(fi)), j = Math.min(ny - 1, Math.floor(fj)), a = fi - i, b = fj - j, k = j * W + i;
        const v = (kk, other) => s[kk] ? T[other] : T[kk]; return (1 - a) * (1 - b) * v(k, k) + a * (1 - b) * v(k + 1, k) + (1 - a) * b * v(k + W, k) + a * b * v(k + W + 1, k); };
      for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) { const k = j * W + i; if (s[k]) { T2[k] = Tb; continue; } const uc = (this.u[k] + this.u[k - 1]) / 2, vc = (this.v[k] + this.v[k - W]) / 2; T2[k] = sample((i - 0.5) * dx - uc * dt, (j - 0.5) * dy - vc * dt); }
      T.set(T2);
      const ax = alpha * dt / (dx * dx), ay = alpha * dt / (dy * dy);
      for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
        const k = j * W + i; if (s[k]) continue; const c = T[k];
        const nb = (kk, inside, side) => !inside ? this.ghostT(k, side) : s[kk] ? 2 * Tb - c : T[kk];
        T2[k] = c + ax * (nb(k - 1, i > 1, 'left') - 2 * c + nb(k + 1, i < nx, 'right')) + ay * (nb(k - W, j > 1, 'bottom') - 2 * c + nb(k + W, j < ny, 'top'));
      }
      for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) { const k = j * W + i; if (!s[k]) T[k] = T2[k]; }
    }
    // heat leaving the bodies per metre of depth (W/m) and the wetted (stair-step) perimeter
    heatFromBodies() {
      if (!this.heat) return { Q: 0, per: 0 };
      const { nx, ny, W, dx, dy, T } = this, s = this.solid, k = this.alpha * this.rho * (this.heat.cp || 1000), Tb = this.heat.Tbody; let Q = 0, per = 0;
      for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
        const c = j * W + i; if (!s[c]) continue;
        if (this.isFluid(i + 1, j)) { Q += k * (Tb - T[c + 1]) / (dx / 2) * dy; per += dy; }
        if (this.isFluid(i - 1, j)) { Q += k * (Tb - T[c - 1]) / (dx / 2) * dy; per += dy; }
        if (this.isFluid(i, j + 1)) { Q += k * (Tb - T[c + W]) / (dy / 2) * dx; per += dx; }
        if (this.isFluid(i, j - 1)) { Q += k * (Tb - T[c - W]) / (dy / 2) * dx; per += dx; }
      }
      return { Q, per, k };
    }
    // ---------- outputs ----------
    cellVel(i, j) { const k = j * this.W + i; return [(this.u[k] + this.u[k - 1]) / 2, (this.v[k] + this.v[k - this.W]) / 2]; }
    divergence() { let m = 0; const { nx, ny, W, dx, dy, u, v } = this; for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) { const k = j * W + i; if (this.solid[k]) continue; m = Math.max(m, Math.abs((u[k] - u[k - 1]) / dx + (v[k] - v[k - W]) / dy)); } return m; }
    // vorticity at cell centres (∂v/∂x − ∂u/∂y), centred differences of cell velocities
    vorticity(i, j) { const [, vE] = this.cellVel(Math.min(this.nx, i + 1), j), [, vW] = this.cellVel(Math.max(1, i - 1), j), [uN] = this.cellVel(i, Math.min(this.ny, j + 1)), [uS] = this.cellVel(i, Math.max(1, j - 1)); return (vE - vW) / (2 * this.dx) - (uN - uS) / (2 * this.dy); }
    // velocity anywhere (bilinear from the staggered grid) for streamlines
    velAt(x, y) {
      const { dx, dy, W, nx, ny } = this;
      const bil = (arr, ox, oy, imax, jmax) => { const fx = Math.min(imax, Math.max(0, x / dx - ox)), fy = Math.min(jmax, Math.max(0, y / dy - oy)); const i = Math.min(imax - 1, Math.floor(fx)), j = Math.min(jmax - 1, Math.floor(fy)), a = fx - i, b = fy - j; const k = j * W + i; return (1 - a) * (1 - b) * arr[k] + a * (1 - b) * arr[k + 1] + (1 - a) * b * arr[k + W] + a * b * arr[k + W + 1]; };
      return [bil(this.u, 0, -0.5, nx, ny + 1), bil(this.v, -0.5, 0, nx + 1, ny)];
    }
    // force on obstacles per unit depth: −p·n plus wall shear μ ∂u_t/∂n on every obstacle face touching fluid (N/m)
    forces() {
      const { nx, ny, W, dx, dy, p, rho, nu } = this, s = this.solid; let fx = 0, fy = 0;
      for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) {
        const k = j * W + i; if (!s[k]) continue;
        if (this.isFluid(i + 1, j)) { fx -= p[k + 1] * dy; fy += nu * this.cellVel(i + 1, j)[1] / (dx / 2) * dy; }
        if (this.isFluid(i - 1, j)) { fx += p[k - 1] * dy; fy += nu * this.cellVel(i - 1, j)[1] / (dx / 2) * dy; }
        if (this.isFluid(i, j + 1)) { fy -= p[k + W] * dx; fx += nu * this.cellVel(i, j + 1)[0] / (dy / 2) * dx; }
        if (this.isFluid(i, j - 1)) { fy += p[k - W] * dx; fx += nu * this.cellVel(i, j - 1)[0] / (dy / 2) * dx; }
      }
      return [fx * rho, fy * rho];
    }
  }
  // NACA 4-digit airfoil test: is (x, y) inside, chord c, leading edge at (x0, y0), angle of attack a (deg, nose up)
  function nacaInside(code, c, x0, y0, aDeg) {
    const m = +code[0] / 100, pp = +code[1] / 10, t = +code.slice(2) / 100, a = aDeg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    return (x, y) => {
      const X = ((x - x0) * ca - (y - y0) * sa) / c, Y = ((x - x0) * sa + (y - y0) * ca) / c;
      if (X < 0 || X > 1) return false;
      const yt = 5 * t * (0.2969 * Math.sqrt(X) - 0.126 * X - 0.3516 * X * X + 0.2843 * X ** 3 - 0.1036 * X ** 4);
      const yc = !m ? 0 : X < pp ? m / (pp * pp) * (2 * pp * X - X * X) : m / ((1 - pp) ** 2) * ((1 - 2 * pp) + 2 * pp * X - X * X);
      return Math.abs(Y - yc) <= yt;
    };
  }
  // Ghia, Ghia & Shin (1982), Re = 100: u along the vertical centreline of the lid-driven cavity
  const GHIA_RE100 = [[1, 1], [0.9766, 0.84123], [0.9688, 0.78871], [0.9609, 0.73722], [0.9531, 0.68717], [0.8516, 0.23151], [0.7344, 0.00332], [0.6172, -0.13641], [0.5, -0.20581], [0.4531, -0.2109], [0.2813, -0.15662], [0.1719, -0.1015], [0.1016, -0.06434], [0.0703, -0.04775], [0.0625, -0.04192], [0.0547, -0.03717], [0, 0]];
  function centrelineU(f) { // u(y) at x = Lx/2 (vertical face column through the middle)
    const i = Math.round(f.nx / 2), out = []; for (let j = 1; j <= f.ny; j++) out.push([(j - 0.5) * f.dy, f.u[j * f.W + i]]); return out;
  }
  const api = { Flow, nacaInside, GHIA_RE100, centrelineU };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FlowSolver = api;
})(typeof self !== 'undefined' ? self : this);
