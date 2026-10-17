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

// ---------- v1.2: natural convection, residuals, monitor points & spectra, surface Cp, polygon / SVG bodies, GIF ----------
const AN = require('../js/analysis.js'), GIF = require('../js/gif.js'), { GifReader } = require('../vendor/omggif.js');
// de Vahl Davis (1983) benchmark: differentially heated square cavity, Pr = 0.71, adiabatic top & bottom.
// Velocities scaled by α/L; u_max on the vertical mid-line, v_max on the horizontal mid-line, Nu = mean hot-wall Nusselt.
const DVD = { 1e3: { Nu: 1.118, umax: 3.649, vmax: 3.697 }, 1e4: { Nu: 2.243, umax: 16.178, vmax: 19.617 } };
function cavity(Ra, N, tEnd) {
  const Pr = 0.71, alpha = 0.01, nu = Pr * alpha, f = new Flow({ nx: N, ny: N, Lx: 1, Ly: 1, nu, sides: { left: { type: 'wall', T: 1 }, right: { type: 'wall', T: 0 } }, heat: { Pr, Tin: 0.5, Tbody: 0, cp: 1, beta: 1, g: Ra * nu * alpha } });
  let ru = 0, rT = 0; while (f.t < tEnd) { f.step(); if (f.steps > 5) { ru = Math.max(ru, f.res.u); rT = Math.max(rT, f.res.T); } }
  f.resDrop = [f.res.u / ru, f.res.T / rT];
  let umax = 0, vmax = 0; const m = N / 2;
  for (let j = 1; j <= N; j++) umax = Math.max(umax, f.u[j * f.W + m] / alpha);
  for (let i = 1; i <= N; i++) vmax = Math.max(vmax, f.v[m * f.W + i] / alpha);
  return { f, Nu: f.wallGradient('left'), NuCold: -f.wallGradient('right'), umax, vmax };
}
for (const [Ra, N] of [[1e3, 32], [1e4, 40]]) t(`natural convection (Boussinesq), Ra = ${Ra}: matches de Vahl Davis (1983) Nu, u_max, v_max`, () => {
  const r = cavity(Ra, N, 30), ref = DVD[Ra], e = k => Math.abs(r[k] - ref[k]) / ref[k];
  console.log(`   Nu ${r.Nu.toFixed(3)} (ref ${ref.Nu}, ${(100 * e('Nu')).toFixed(1)}%), cold wall ${r.NuCold.toFixed(3)}, u_max ${r.umax.toFixed(2)} (ref ${ref.umax}, ${(100 * e('umax')).toFixed(1)}%), v_max ${r.vmax.toFixed(2)} (ref ${ref.vmax}, ${(100 * e('vmax')).toFixed(1)}%)`);
  assert.ok(e('Nu') < 0.02, 'Nusselt'); assert.ok(e('umax') < 0.05 && e('vmax') < 0.05, 'velocity maxima');
  assert.ok(Math.abs(r.Nu - r.NuCold) / r.Nu < 0.01, 'energy balance: heat in = heat out');
  assert.ok(r.f.resDrop[0] < 1e-2 && r.f.resDrop[1] < 1e-2, `converged (residual drop ${r.f.resDrop})`);
});
t('buoyancy off (β = 0) leaves a conducting cavity motionless', () => {
  const f = new Flow({ nx: 20, ny: 20, Lx: 1, Ly: 1, nu: 0.01, sides: { left: { type: 'wall', T: 1 }, right: { type: 'wall', T: 0 } }, heat: { Pr: 1, Tin: 0.5, Tbody: 0, cp: 1, beta: 0, g: 9.81 } });
  for (let k = 0; k < 200; k++) f.step(); let m = 0; for (let k = 0; k < f.u.length; k++) m = Math.max(m, Math.abs(f.u[k]), Math.abs(f.v[k]));
  assert.ok(m < 1e-12, 'no flow without buoyancy');
});
t('residual monitors fall by orders of magnitude as the cavity converges', () => {
  const f = new Flow({ nx: 32, ny: 32, Lx: 1, Ly: 1, nu: 0.01, sides: { top: { type: 'moving', u: 1 } } }); const r = [];
  while (f.t < 20) { f.step(); if (f.steps === 5 || f.steps % 500 === 0) r.push(f.res.u); }
  console.log(`   x-velocity residual ${r[0].toExponential(1)} → ${r[r.length - 1].toExponential(1)}; continuity ${f.res.cont.toExponential(1)}`);
  assert.ok(r[r.length - 1] < r[0] * 1e-4);
});
t('spectrum finds the frequency of an unevenly sampled sine to within 0.5%', () => {
  const ts = [], vs = []; let tt = 0; for (let k = 0; k < 3000; k++) { tt += 0.01 + 0.008 * Math.sin(k * 0.37) ** 2; ts.push(tt); vs.push(2 + 0.7 * Math.sin(2 * Math.PI * 1.37 * tt) + 0.05 * Math.sin(2 * Math.PI * 5.1 * tt)); }
  const S = AN.spectrum(ts, vs); console.log(`   peak ${S.peak.toFixed(4)} Hz (true 1.37), amplitude ${S.peakAmp.toFixed(3)} (true 0.7), mean ${S.mean.toFixed(3)}`);
  assert.ok(Math.abs(S.peak - 1.37) / 1.37 < 0.005); assert.ok(Math.abs(S.peakAmp - 0.7) < 0.07); assert.ok(Math.abs(S.mean - 2) < 0.02);
});
t('monitor point reads the exact Poiseuille profile; surface Cp: front stagnation ≈ 1, symmetric, integrates to the pressure drag', () => {
  const f = new Flow({ nx: 120, ny: 20, Lx: 12, Ly: 1, nu: 0.05, sides: { left: { type: 'inlet', u: 1 }, right: { type: 'outlet' } } });
  while (f.t < 30) f.step(); const pr = AN.probe(f, 10, 0.3); assert.ok(Math.abs(pr.u - 6 * 0.3 * 0.7) < 0.02 && Math.abs(pr.v) < 1e-3, 'probe u ' + pr.u);
  const D = 0.1, c = new Flow({ nx: 160, ny: 40, Lx: 2, Ly: 0.5, nu: 0.001, sides: { left: { type: 'inlet', u: 0.2 }, right: { type: 'outlet' }, top: { type: 'slip' }, bottom: { type: 'slip' } } });
  c.setObstacles((x, y) => (x - 0.5) ** 2 + (y - 0.25) ** 2 <= (D / 2) ** 2); while (c.t < 12) c.step();
  const S = AN.surfaceCp(c, 0.2, { circle: { x: 0.5, y: 0.25 } }), front = S.faces.filter(q => q.theta < 15), back = S.faces.filter(q => q.theta > 165);
  const cpF = Math.max(...front.map(q => q.Cp)), cpB = back.reduce((s, q) => s + q.Cp, 0) / back.length;
  const up = S.faces.filter(q => q.upper), lo = S.faces.filter(q => !q.upper), avg = a => a.reduce((s, q) => s + q.Cp, 0) / a.length;
  const [px] = AN.cpForce(S.faces, 1, 0.2); let pxF = 0; { const { nx, ny, W, dy, p, solid: s } = c; for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) { const k = j * W + i; if (!s[k]) continue; if (c.isFluid(i + 1, j)) pxF -= p[k + 1] * dy; if (c.isFluid(i - 1, j)) pxF += p[k - 1] * dy; } }
  console.log(`   Cp front ${cpF.toFixed(3)}, base ${cpB.toFixed(3)}, upper/lower mean ${avg(up).toFixed(3)}/${avg(lo).toFixed(3)}, pressure drag from Cp ${px.toExponential(4)} vs solver ${pxF.toExponential(4)} N/m (${S.faces.length} faces)`);
  assert.ok(cpF > 0.95 && cpF < 1.6, 'stagnation'); assert.ok(cpB < 0, 'suction at the base'); assert.ok(Math.abs(avg(up) - avg(lo)) < 0.02, 'symmetric');
  // Cp is relative to the inlet pressure, so subtract the p∞ contribution (∮ n ds = 0 on a closed body, up to round-off)
  assert.ok(Math.abs(px - pxF) / Math.abs(pxF) < 1e-6, 'Cp integrates to the pressure force');
});
t('polygon & SVG obstacles: parsing, transforms, arcs, even–odd holes, placement', () => {
  const svg = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50"><!-- <rect width="999" height="9"/> --><defs><rect width="500" height="500"/></defs>
    <g transform="translate(10,5)"><path d="M0 0 H80 V40 H0 Z M20 10 v20 h40 v-20 z"/></g><script>alert(1)</script></svg>`;
  const P = AN.parseSVG(svg); assert.strictEqual(P.length, 2, 'two rings (defs and comments ignored)');
  assert.ok(AN.pointInPolys(P, 15, -10) && !AN.pointInPolys(P, 50, -25) && !AN.pointInPolys(P, 5, -10), 'hole by even–odd, y flipped, translate applied');
  const C = AN.parseSVG('<svg><circle cx="0" cy="0" r="1" transform="scale(2)"/><path d="M 3 0 A 1 1 0 1 0 5 0 A 1 1 0 1 0 3 0 Z"/></svg>');
  assert.ok(AN.pointInPolys(C, 1.9, 0) && !AN.pointInPolys(C, 2.1, 0) && AN.pointInPolys(C, 4, 0.95) && !AN.pointInPolys(C, 4, 1.05), 'scaled circle and two-arc circle');
  const Q = AN.parseSVG('<svg><path d="M0,0 C0,10 10,10 10,0 Q5,-5 0,0z"/><polygon points="20,0 30,0 25,8"/></svg>'); assert.strictEqual(Q.length, 2);
  assert.ok(AN.pointInPolys(Q, 5, -5) && AN.pointInPolys(Q, 25, -3), 'bezier lobe and triangle');
  const T = AN.parsePolygonText('# triangle\n0, 0\n1, 0\n0.5 1\n\n2 2\n3 2\n3 3\nnot a number'); assert.strictEqual(T.length, 2);
  assert.strictEqual(AN.sanitizePolys([[[0, 0], [1, 'x'], [1, 1], [NaN, 2], [0, 1]], 'bad', [[1, 1]]]).length, 1);
  assert.strictEqual(AN.sanitizePolys('nope'), null);
  // a square drawn as a polygon gives the same solid region as the analytic square
  const n = AN.normalizePolys([[[0, 0], [2, 0], [2, 2], [0, 2]]]), o = { type: 'polygon', polys: n.polys, x: 0.5, y: 0.25, size: 0.1, angle: 0 };
  const ins = AN.polygonInside(o); let same = 0, tot = 0; for (let k = 0; k < 4000; k++) { const x = 0.4 + Math.random() * 0.2, y = 0.15 + Math.random() * 0.2, a = Math.abs(x - 0.5) <= 0.05 && Math.abs(y - 0.25) <= 0.05; tot++; if (a === ins(x, y)) same++; }
  assert.ok(same / tot > 0.998, 'polygon square ≡ analytic square');
  const rot = AN.polygonInside({ ...o, angle: 45 }); assert.ok(rot(0.5, 0.25 + 0.068) && !rot(0.5 + 0.05, 0.25 + 0.05), 'rotation');
});
t('GIF export: frames round-trip through the encoder with an accurate shared palette', () => {
  const w = 64, h = 40, frames = []; for (let fi = 0; fi < 3; fi++) { const d = new Uint8ClampedArray(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4; d[o] = (x * 4 + fi * 40) & 255; d[o + 1] = y * 6; d[o + 2] = 128; d[o + 3] = 255; } frames.push({ width: w, height: h, data: d }); }
  const bytes = GIF.encodeGIF(frames, { delay: 5 }); assert.strictEqual(String.fromCharCode(...bytes.slice(0, 6)), 'GIF89a');
  const R = new GifReader(bytes); assert.strictEqual(R.numFrames(), 3); assert.strictEqual(R.width, w); assert.strictEqual(R.frameInfo(1).delay, 5); assert.strictEqual(R.loopCount(), 0);
  const px = new Uint8Array(w * h * 4); R.decodeAndBlitFrameRGBA(2, px); let err = 0; for (let k = 0; k < w * h * 4; k += 4) err = Math.max(err, Math.abs(px[k] - frames[2].data[k]), Math.abs(px[k + 1] - frames[2].data[k + 1]));
  console.log(`   ${bytes.length} bytes, worst channel error ${err} / 255`); assert.ok(err <= 24);
});

process.on('exit', () => console.log(`\n${n} tests passed`));
