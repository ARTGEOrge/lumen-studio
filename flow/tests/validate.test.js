// node flow/tests/validate.test.js — validation against a published benchmark and an exact solution.
const { Flow, GHIA_RE100, centrelineU, nacaInside } = require('../js/solver.js');
const assert = require('assert');
let n = 0; const t = (name, fn) => { const t0 = Date.now(); fn(); n++; console.log('ok', name, `(${((Date.now() - t0) / 1000).toFixed(1)} s)`); };
const interp = (pts, y) => { pts = pts.slice().sort((a, b) => a[0] - b[0]); if (y <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (y <= pts[i][0]) { const [y0, u0] = pts[i - 1], [y1, u1] = pts[i]; return u0 + (u1 - u0) * (y - y0) / (y1 - y0); } return pts[pts.length - 1][1]; };

t('lid-driven cavity, Re = 100, matches Ghia et al. (1982) centreline velocities', () => {
  const f = new Flow({ nx: 64, ny: 64, Lx: 1, Ly: 1, nu: 0.01, sides: { top: { type: 'moving', u: 1 } } });
  while (f.t < 25) f.step();
  const c = [[0, 0], ...centrelineU(f), [1, 1]];
  const errs = GHIA_RE100.filter(([y]) => y > 0 && y < 1).map(([y, u]) => Math.abs(interp(c, y) - u));
  const rms = Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length), worst = Math.max(...errs);
  console.log(`   RMS error ${rms.toFixed(4)}, worst ${worst.toFixed(4)} over ${errs.length} points; u_min ${Math.min(...c.map(p => p[1])).toFixed(4)} (Ghia −0.2109); max |div| ${f.divergence().toExponential(1)}`);
  assert.ok(rms < 0.012 && worst < 0.03, `rms ${rms} worst ${worst}`);
  assert.ok(f.divergence() < 1e-3);
});

t('channel flow develops the exact Poiseuille profile (u_max = 1.5 U) and conserves mass', () => {
  const U = 1, H = 1, f = new Flow({ nx: 120, ny: 20, Lx: 12, Ly: H, nu: 0.05, sides: { left: { type: 'inlet', u: U }, right: { type: 'outlet' } } });
  while (f.t < 30) f.step();
  const i = Math.round(f.nx * 0.85); let umax = 0, flux = 0, errMax = 0;
  for (let j = 1; j <= f.ny; j++) {
    const y = (j - 0.5) * f.dy, u = f.u[j * f.W + i], exact = 6 * U * y * (H - y) / (H * H);
    umax = Math.max(umax, u); flux += u * f.dy; errMax = Math.max(errMax, Math.abs(u - exact));
  }
  console.log(`   u_max ${umax.toFixed(4)} (exact 1.5 at the centreline; cell centres peak at ${(6 * (0.475) * 0.525).toFixed(4)}), flux ${flux.toFixed(4)} (inlet 1), worst point error ${errMax.toFixed(4)}`);
  assert.ok(Math.abs(flux - U * H) < 0.01, 'mass conserved');
  assert.ok(errMax < 0.02, 'matches the parabola');
});

t('cylinder in a channel: steady drag is positive and the flow stays divergence-free', () => {
  const D = 0.1, f = new Flow({ nx: 160, ny: 40, Lx: 2, Ly: 0.5, nu: 0.001, rho: 1, sides: { left: { type: 'inlet', u: 0.2 }, right: { type: 'outlet' }, top: { type: 'slip' }, bottom: { type: 'slip' } } });
  f.setObstacles((x, y) => (x - 0.5) ** 2 + (y - 0.25) ** 2 <= (D / 2) ** 2);   // Re = U D / ν = 20 → steady wake
  while (f.t < 12) f.step();
  const [fx, fy] = f.forces(), Cd = fx / (0.5 * 1 * 0.2 * 0.2 * D);
  console.log(`   Re 20: Cd ${Cd.toFixed(2)} (unconfined literature ≈ 2.0–2.1; 20% blockage raises it), Cl ${(fy / (0.5 * 0.04 * D)).toFixed(3)}`);
  assert.ok(Cd > 1.5 && Cd < 4, 'plausible drag'); assert.ok(Math.abs(fy / (0.5 * 0.04 * D)) < 0.1, 'symmetric → no lift');
  assert.ok(f.divergence() < 1e-2);
});

t('NACA 0012 shape is symmetric with 12% thickness', () => {
  const ins = nacaInside('0012', 1, 0, 0, 0);
  assert.ok(ins(0.3, 0.059) && !ins(0.3, 0.061) && ins(0.3, -0.059) && !ins(1.01, 0) && !ins(-0.01, 0));
});

// Optional long run (≈2 min): FLOW_LONG=1 node flow/tests/validate.test.js
if (process.env.FLOW_LONG) t('cylinder at Re = 100 sheds vortices with a Strouhal number near 0.17', () => {
  global.self = global; require('../js/cases.js'); const FC = global.FlowCases, c = FC.CASES.cylinder, o = c.obstacle;
  const f = new Flow({ nx: 220, ny: 60, Lx: c.Lx, Ly: c.Ly, nu: 1e-6, rho: 998, sides: { left: { type: 'inlet', u: c.U }, right: { type: 'outlet' }, top: { type: 'slip' }, bottom: { type: 'slip' } } });
  f.setObstacles(FC.obstacleFn(o, require('../js/solver.js')));
  for (let j = 1; j < f.ny; j++) for (let i = 1; i <= f.nx; i++) { const x = (i - 0.5) * f.dx, y = j * f.dy, k = j * f.W + i; if (f.solid[k] || f.solid[k + f.W]) continue; const a = (x - o.x) / o.size, b = (y - o.y) / o.size; if (a > 0.5 && a < 4) f.v[k] = 0.15 * c.U * Math.exp(-b * b) * Math.exp(-((a - 1.5) ** 2)); }
  const q = 0.5 * 998 * c.U * c.U * o.size, cross = []; let prev = 0;
  while (f.t < 600) { f.step(); const cl = f.forces()[1] / q; if (prev < 0 && cl >= 0 && f.t > 150) cross.push(f.t); prev = cl; }
  const St = o.size / ((cross[cross.length - 1] - cross[0]) / (cross.length - 1) * c.U);
  console.log(`   St ${St.toFixed(3)} (unconfined literature 0.164–0.166; 17% blockage raises it)`);
  assert.ok(St > 0.15 && St < 0.2);
});
// (appended) heat transfer
t('heat: steady conduction between a hot and a cold wall is linear', () => {
  const f = new Flow({ nx: 40, ny: 10, Lx: 1, Ly: 0.25, nu: 1e-3, sides: { left: { type: 'wall', T: 100 }, right: { type: 'wall', T: 0 } }, heat: { Pr: 1, Tin: 50, Tbody: 0, cp: 1 } });
  while (f.t < 800) f.step();
  let worst = 0; for (let i = 1; i <= f.nx; i++) { const x = (i - 0.5) * f.dx, exact = 100 * (1 - x); worst = Math.max(worst, Math.abs(f.T[5 * f.W + i] - exact)); }
  console.log(`   worst error ${worst.toFixed(3)} °C of 100 °C span`); assert.ok(worst < 0.5);
});
t('heat: a heated cylinder at Re = 40, Pr = 0.71 matches the Churchill–Bernstein correlation (within 25%)', () => {
  const D = 0.02, U = 0.03, nu = 1.5e-5, f = new Flow({ nx: 200, ny: 60, Lx: 0.4, Ly: 0.12, nu, rho: 1.2, sides: { left: { type: 'inlet', u: U }, right: { type: 'outlet' }, top: { type: 'slip' }, bottom: { type: 'slip' } }, heat: { Pr: 0.71, Tin: 20, Tbody: 60, cp: 1005 } });
  f.setObstacles((x, y) => (x - 0.08) ** 2 + (y - 0.06) ** 2 <= (D / 2) ** 2);
  for (let j = 1; j <= f.ny; j++) for (let i = 0; i <= f.nx; i++) { const k = j * f.W + i; if (!f.solid[k] && !f.solid[k + 1]) f.u[k] = U; }
  while (f.t < 30) f.step();
  const { Q, k } = f.heatFromBodies(), Nu = Q / (Math.PI * k * 40), Re = U * D / nu, Pr = 0.71;
  const cb = 0.3 + 0.62 * Math.sqrt(Re) * Math.cbrt(Pr) / Math.pow(1 + Math.pow(0.4 / Pr, 2 / 3), 0.25) * Math.pow(1 + Math.pow(Re / 282000, 5 / 8), 4 / 5);
  console.log(`   Nu ${Nu.toFixed(2)} vs correlation ${cb.toFixed(2)} (Re ${Re})`); assert.ok(Math.abs(Nu - cb) / cb < 0.25);
});

t('inflow from outside the domain is handled with and without heat (large time step)', () => {
  for (const heat of [null, { Pr: 1, Tin: 50, Tbody: 0, cp: 1 }]) { const f = new Flow({ nx: 40, ny: 10, Lx: 1, Ly: 0.25, nu: 1e-3, tau: 3, sides: { left: { type: 'inlet', u: 5 }, right: { type: 'outlet' } }, heat }); for (let k = 0; k < 20; k++) f.step(); if (heat) assert.ok(Math.abs(f.T[5 * f.W + 1] - 50) < 1e-6); }
});

process.on('exit', () => console.log(`\n${n} tests passed`));
