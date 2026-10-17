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

console.log(`\n${n} tests passed`);
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
