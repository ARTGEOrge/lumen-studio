// node stress/tests/validate.test.js — Lumen Stress validation against textbook solutions, with mesh convergence.
// Every case goes through the same document → mesh → boundary conditions → solver path as the app.
const S = require('../js/study.js'), G = require('../js/geom.js'), VX = require('../js/voxel.js'), FEM = require('../js/fem.js');
const assert = require('assert');
const quick = process.argv.includes('--quick');
let n = 0; const results = [];
const t = (name, fn) => { const t0 = Date.now(); fn(); n++; console.log(`ok ${n} ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s)\n`); };
const pct = (v, ref) => (v - ref) / ref * 100;
const row = (cells, w = [10, 9, 9, 14, 14, 9]) => console.log('   ' + cells.map((c, i) => String(c).padStart(w[i] || 10)).join(' '));
const steel = { id: 'steel', name: 'Steel', E: 200000, nu: 0.3, rho: 7850, Sy: 250, Su: 400 };
function doc2d(model, shapes, bcs, extra = {}) { const d = S.newDoc('2d'); d.study.model = model; d.study.thickness = extra.t || 10; d.shapes = shapes; d.material = Object.assign({}, steel); d.bcs = bcs; Object.assign(d.mesh, extra.mesh || {}); if (extra.analysis) d.analysis = extra.analysis; return d; }
// value of a nodal field at the node closest to (x, y)
function nodeAt(mesh, x, y) { let b = 0, bd = Infinity; const P = mesh.nodes, dim = mesh.kind === 'H8' ? 3 : 2; for (let i = 0; i < P.length / dim; i++) { const d = Math.hypot(P[i * dim] - x, P[i * dim + 1] - y); if (d < bd) { bd = d; b = i; } } return b; }

t('Cantilever, plane stress (L/h = 10): tip deflection vs. Timoshenko beam theory', () => {
  const L = 200, h = 20, th = 10, P = 1000, E = 200000, nu = 0.3, I = th * h ** 3 / 12, Gm = E / (2 * (1 + nu));
  const exact = P * L ** 3 / (3 * E * I) + P * L / (5 / 6 * Gm * th * h), sigMid = P * (L / 2) * (h / 2) / I;
  console.log(`   exact: tip deflection ${exact.toFixed(5)} mm (bending ${(P * L ** 3 / (3 * E * I)).toFixed(4)} + shear ${(P * L / (5 / 6 * Gm * th * h)).toFixed(4)}), σx at mid-span top fibre ${sigMid.toFixed(1)} MPa`);
  row(['size mm', 'elements', 'nodes', 'tip δ mm', 'σx(L/2) MPa', 'err δ %']);
  let last;
  for (const size of quick ? [10, 5] : [20, 10, 5, 2.5, 1.25]) {
    const d = doc2d('stress', [{ id: 'b', kind: 'rect', x: 0, y: 0, w: L, h }], [{ id: 'f', kind: 'fixed', targets: ['b:3'] }, { id: 'p', kind: 'force', targets: ['b:1'], x: 0, y: -P }], { mesh: { size } });
    const r = S.run(d), tip = -r.res.u[nodeAt(r.mesh, L, h / 2) * 2 + 1], sx = S.probe2D(r.mesh, r.res.stress, L / 2, h - 1e-6, 4, 0).v;
    row([size, r.mesh.stats.elements, r.mesh.stats.nodes, tip.toFixed(5), sx.toFixed(2), pct(tip, exact).toFixed(2)]);
    // equilibrium: reactions balance the load
    assert.ok(Math.abs(r.sum.reactionTotal[1] - P) < 1e-6 * P, 'vertical reaction equals the load');
    last = { tip, sx };
  }
  assert.ok(Math.abs(pct(last.tip, exact)) < 1.0, 'tip deflection within 1 %'); assert.ok(Math.abs(pct(last.sx, sigMid)) < 1.0, 'bending stress within 1 %');
  results.push(['Cantilever tip deflection (plane stress)', pct(last.tip, exact)]);
});

t('Plate with a central hole in tension (d/W = 0.1): stress concentration factor Kt (gross) ≈ 3.03', () => {
  // quarter model with symmetry: 400 × 200 plate, hole Ø20; Peterson/Heywood: Kt,net = 2 + (1 − d/W)³ → Kt,gross = Kt,net / (1 − d/W)
  const W = 200, d = 20, s0 = 100, ref = (2 + (1 - d / W) ** 3) / (1 - d / W);
  const b = -Math.tan(Math.PI / 8), shape = { id: 'q', kind: 'poly', pts: [[10, 0, 0], [200, 0, 0], [200, 100, 0], [0, 100, 0], [0, 10, b]] };
  console.log(`   reference Kt (gross) = ${ref.toFixed(3)} (Heywood/Peterson; Howland's exact series gives 3.03 at d/W = 0.1)`);
  row(['hole size', 'elements', 'nodes', 'σmax MPa', 'Kt', 'err %']);
  let last;
  for (const hs of quick ? [2, 1] : [4, 2, 1, 0.5, 0.25]) {
    const doc = doc2d('stress', [shape], [{ id: 'sx', kind: 'roller', targets: ['q:3'] }, { id: 'sy', kind: 'roller', targets: ['q:0'] }, { id: 'p', kind: 'pressure', targets: ['q:1'], p: -s0 }], { mesh: { size: 12, refine: { 'q:4': hs } } });
    const r = S.run(doc), k = nodeAt(r.mesh, 0, 10), smax = r.res.stress[k * 4], Kt = smax / s0;
    row([hs, r.mesh.stats.elements, r.mesh.stats.nodes, smax.toFixed(2), Kt.toFixed(4), pct(Kt, ref).toFixed(2)]);
    assert.ok(Math.abs(r.sum.maxVM.v - smax) / smax < 0.02, 'peak von Mises is at the hole edge');
    last = Kt;
  }
  assert.ok(Math.abs(pct(last, ref)) < 1.5, 'Kt within 1.5 %');
  results.push(['Plate with hole Kt', pct(last, ref)]);
});

t('Thick-walled cylinder under internal pressure (Lamé), axisymmetric and plane-strain quarter ring', () => {
  const a = 50, b2 = 100, p = 100, E = 200000, nu = 0.3, A = p * a * a / (b2 * b2 - a * a), B = p * a * a * b2 * b2 / (b2 * b2 - a * a);
  const sth = r => A + B / (r * r), sr = r => A - B / (r * r), ur = r => (1 + nu) / E * ((1 - 2 * nu) * A * r + B / r);
  console.log(`   exact (plane strain): σθ(a) = ${sth(a).toFixed(3)} MPa, σr(a) = ${sr(a).toFixed(1)}, σθ(b) = ${sth(b2).toFixed(3)}, u(a) = ${ur(a).toFixed(6)} mm, σz = 2νA = ${(2 * nu * A).toFixed(3)}`);
  console.log('   axisymmetric strip a ≤ r ≤ b, axial rollers top and bottom:');
  row(['size mm', 'elements', 'nodes', 'σθ(a) MPa', 'u(a) mm', 'err σθ %']);
  let lastA;
  for (const size of quick ? [5, 2.5] : [10, 5, 2.5, 1.25]) {
    const doc = doc2d('axi', [{ id: 'c', kind: 'rect', x: a, y: 0, w: b2 - a, h: 20 }], [{ id: 'r1', kind: 'roller', targets: ['c:0', 'c:2'] }, { id: 'pi', kind: 'pressure', targets: ['c:3'], p }], { mesh: { size } });
    const r = S.run(doc), k = nodeAt(r.mesh, a, 10), st = r.res.stress[k * 4 + 3], u = r.res.u[k * 2];
    row([size, r.mesh.stats.elements, r.mesh.stats.nodes, st.toFixed(3), u.toFixed(6), pct(st, sth(a)).toFixed(3)]);
    lastA = { st, u, sz: r.res.stress[k * 4 + 1], so: r.res.stress[nodeAt(r.mesh, b2, 10) * 4 + 3] };
  }
  assert.ok(Math.abs(pct(lastA.st, sth(a))) < 0.5 && Math.abs(pct(lastA.u, ur(a))) < 0.2, 'axisymmetric Lamé');
  assert.ok(Math.abs(lastA.sz - 2 * nu * A) < 0.5 && Math.abs(pct(lastA.so, sth(b2))) < 0.5, 'axial and outer hoop stress');
  console.log('   plane-strain quarter ring with symmetry rollers (pressure on a curved edge):');
  row(['size mm', 'elements', 'nodes', 'σθ(a) MPa', 'u(a) mm', 'err σθ %']);
  const q = Math.tan(Math.PI / 8), ring = { id: 'r', kind: 'poly', pts: [[a, 0, 0], [b2, 0, q], [0, b2, 0], [0, a, -q]] };
  let lastP;
  for (const size of quick ? [8, 4] : [16, 8, 4, 2]) {
    const doc = doc2d('strain', [ring], [{ id: 'sx', kind: 'roller', targets: ['r:0', 'r:2'] }, { id: 'pi', kind: 'pressure', targets: ['r:3'], p }], { mesh: { size } });
    const r = S.run(doc), k = nodeAt(r.mesh, a, 0), st = r.res.stress[k * 4 + 1], u = r.res.u[k * 2];
    row([size, r.mesh.stats.elements, r.mesh.stats.nodes, st.toFixed(3), u.toFixed(6), pct(st, sth(a)).toFixed(3)]);
    lastP = { st, u };
  }
  assert.ok(Math.abs(pct(lastP.st, sth(a))) < 1 && Math.abs(pct(lastP.u, ur(a))) < 0.5, 'plane strain Lamé');
  results.push(['Lamé hoop stress σθ(a), axisymmetric', pct(lastA.st, sth(a))], ['Lamé bore displacement u(a), axisymmetric', pct(lastA.u, ur(a))], ['Lamé hoop stress σθ(a), plane-strain ring', pct(lastP.st, sth(a))]);
});

t('Cantilever natural frequencies (plane stress modal) vs. Euler–Bernoulli', () => {
  const L = 200, h = 10, th = 10, E = 200000, rho = 7.85e-9, I = th * h ** 3 / 12, Ar = th * h, base = Math.sqrt(E * I / (rho * Ar)) / (2 * Math.PI * L * L);
  const f1 = 1.875104 ** 2 * base, f2 = 4.694091 ** 2 * base, fa = Math.sqrt(E / rho) / (4 * L);
  console.log(`   Euler–Bernoulli f1 = ${f1.toFixed(2)} Hz, f2 = ${f2.toFixed(2)} Hz; first axial mode ${fa.toFixed(1)} Hz (shear & rotary inertia lower the FE values slightly)`);
  row(['size mm', 'elements', 'nodes', 'f1 Hz', 'f2 Hz', 'err f1 %']);
  let last;
  for (const size of quick ? [5, 2.5] : [10, 5, 2.5]) {
    const doc = doc2d('stress', [{ id: 'b', kind: 'rect', x: 0, y: 0, w: L, h }], [{ id: 'f', kind: 'fixed', targets: ['b:3'] }], { mesh: { size }, analysis: { type: 'modal', modes: 4 } });
    const r = S.run(doc), fs = r.res.modes.map(m => m.f);
    row([size, r.mesh.stats.elements, r.mesh.stats.nodes, fs[0].toFixed(2), fs[1].toFixed(2), pct(fs[0], f1).toFixed(2)]);
    last = fs;
  }
  console.log(`   modes found: ${last.map(f => f.toFixed(1)).join(', ')} Hz`);
  assert.ok(Math.abs(pct(last[0], f1)) < 1 && Math.abs(pct(last[1], f2)) < 3, 'bending frequencies');
  assert.ok(last.some(f => Math.abs(pct(f, fa)) < 1), 'axial mode present');
  results.push(['Cantilever f1 (2-D modal)', pct(last[0], f1)], ['Cantilever f2 (2-D modal)', pct(last[1], f2)]);
});

t('Rotating solid disc (axisymmetric, centrifugal load): centre stress (3 + ν)/8 ρω²b²', () => {
  const b = 100, rpm = 10000, w = rpm * 2 * Math.PI / 60, rho = 7.85e-9, nu = 0.3, exact = (3 + nu) / 8 * rho * w * w * b * b, edge = (1 - nu) / 4 * rho * w * w * b * b;
  const doc = doc2d('axi', [{ id: 'd', kind: 'rect', x: 0, y: 0, w: b, h: 5 }], [{ id: 'r', kind: 'roller', targets: ['d:0'] }, { id: 'w', kind: 'rotation', rpm }], { mesh: { size: 2.5 } });
  // thin disc: plane stress in theory; a free top face approximates it
  const r = S.run(doc), k0 = nodeAt(r.mesh, 0, 2.5), kb = nodeAt(r.mesh, b, 2.5), s0 = r.res.stress[k0 * 4], sb = r.res.stress[kb * 4 + 3];
  console.log(`   σr(0) = ${s0.toFixed(3)} MPa vs ${exact.toFixed(3)} (${pct(s0, exact).toFixed(2)} %), σθ(b) = ${sb.toFixed(3)} vs ${edge.toFixed(3)} (${pct(sb, edge).toFixed(2)} %)`);
  assert.ok(Math.abs(pct(s0, exact)) < 1.5 && Math.abs(pct(sb, edge)) < 1.5);
  results.push(['Rotating disc centre stress', pct(s0, exact)]);
});

t('Self-weight: support reactions equal ρ·g·V (gravity body load)', () => {
  const doc = doc2d('stress', [{ id: 'p', kind: 'rect', x: 0, y: 0, w: 100, h: 50, r: 10 }, { id: 'h', kind: 'circle', cx: 50, cy: 25, r: 12 }], [{ id: 'f', kind: 'fixed', targets: ['p:0'] }, { id: 'g', kind: 'gravity', x: 0, y: -9.80665, z: 0 }], { mesh: { size: 4 } });
  const r = S.run(doc), Aex = G.regionArea(doc.shapes), W = 7850e-12 * 9806.65 * Aex * 10;
  console.log(`   reaction ${r.sum.reactionTotal[1].toExponential(5)} N vs weight ${W.toExponential(5)} N (${pct(r.sum.reactionTotal[1], W).toFixed(3)} %)`);
  assert.ok(Math.abs(pct(r.sum.reactionTotal[1], W)) < 0.2);
});

t('3-D voxel cantilever from a closed STL box: tip deflection and first frequency', () => {
  const L = 200, b = 10, h = 10, P = 100, E = 200000, nu = 0.3, I = b * h ** 3 / 12, Gm = E / (2 * (1 + nu)), rho = 7.85e-9;
  const exact = P * L ** 3 / (3 * E * I) + P * L / (5 / 6 * Gm * b * h), f1 = 1.875104 ** 2 / (2 * Math.PI * L * L) * Math.sqrt(E * I / (rho * b * h));
  const tris = VX.boxTris(0, 0, 0, L, b, h), seg = VX.segmentFaces(tris);
  const face = (nx, ny, nz) => 'f' + seg.faces.find(f => f.normal[0] * nx + f.normal[1] * ny + f.normal[2] * nz > 0.99).id;
  console.log(`   ${seg.faces.length} faces found on the STL (watertight: ${seg.watertight}); exact δ = ${exact.toFixed(5)} mm, f1 = ${f1.toFixed(2)} Hz`);
  row(['voxels', 'h mm', 'nodes', 'tip δ mm', 'f1 Hz', 'err δ %']);
  let last;
  for (const target of quick ? [800, 6400] : [800, 6400, 21600]) {
    const doc = S.newDoc('3d'); doc.solid = { name: 'bar', tris }; doc.material = Object.assign({}, steel); doc.mesh.target = target;
    doc.bcs = [{ id: 'f', kind: 'fixed', targets: [face(-1, 0, 0)] }, { id: 'p', kind: 'force', targets: [face(1, 0, 0)], x: 0, y: 0, z: -P }];
    const r = S.run(doc); let tip = 0, c = 0; const Pn = r.mesh.nodes;
    for (let i = 0; i < Pn.length / 3; i++) if (Math.abs(Pn[i * 3] - L) < 1e-6) { tip -= r.res.u[i * 3 + 2]; c++; }
    tip /= c;
    assert.ok(Math.abs(r.sum.reactionTotal[2] - P) < 1e-6 * P, 'reaction balances the load');
    doc.analysis = { type: 'modal', modes: 3 }; const m = S.run(doc).res.modes;
    row([r.mesh.stats.elements, r.mesh.h.toFixed(3), r.mesh.stats.nodes, tip.toFixed(5), m[0].f.toFixed(2), pct(tip, exact).toFixed(2)]);
    last = { tip, f: m[0].f };
  }
  assert.ok(Math.abs(pct(last.tip, exact)) < 2 && Math.abs(pct(last.f, f1)) < 1.5);
  results.push(['3-D voxel cantilever tip deflection', pct(last.tip, exact)], ['3-D voxel cantilever f1', pct(last.f, f1)]);
});

t('3-D pressure on a stair-stepped (inclined) face keeps the correct resultant', () => {
  // a wedge-like prism: extruded right triangle; pressure on the inclined face → total force p·A along −n
  const shape = { id: 'w', kind: 'poly', pts: [[0, 0], [60, 0], [0, 40]] }, M2 = require('../js/mesh2d.js');
  const tri2d = M2.mesh([shape], { size: 10 }).tri2d, tris = new Float32Array(G.extrude(tri2d, 20).flat(2)), seg = VX.segmentFaces(tris);
  const incl = seg.faces.find(f => f.normal[0] > 0.3 && f.normal[2] > 0.3), p = 2;
  const doc = S.newDoc('3d'); doc.solid = { name: 'wedge', tris }; doc.material = Object.assign({}, steel); doc.mesh.target = 4000;
  doc.bcs = [{ id: 'f', kind: 'fixed', targets: ['f' + seg.faces.find(f => f.normal[2] < -0.99).id] }, { id: 'p', kind: 'pressure', targets: ['f' + incl.id], p }];
  const r = S.run(doc), A = Math.hypot(60, 40) * 20, R = r.sum.reactionTotal;
  console.log(`   STL volume ${Math.abs(VX.volume(tris)).toFixed(0)} mm³ vs voxel volume ${r.mesh.stats.volume.toFixed(0)}; reaction (${R.map(v => v.toFixed(1)).join(', ')}) N vs p·A·n = (${(p * A * incl.normal[0]).toFixed(1)}, 0, ${(p * A * incl.normal[2]).toFixed(1)})`);
  assert.ok(Math.abs(R[0] - p * A * incl.normal[0]) < 0.01 * p * A && Math.abs(R[2] - p * A * incl.normal[2]) < 0.01 * p * A && Math.abs(R[1]) < 1e-6 * p * A);
});

t('DXF import: LWPOLYLINE with bulges and a CIRCLE become a plate with a hole', () => {
  const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LWPOLYLINE', '90', '4', '70', '1', '10', '0', '20', '0', '10', '100', '20', '0', '42', '0', '10', '100', '20', '50', '42', '1', '10', '0', '20', '50',
    '0', 'CIRCLE', '10', '40', '20', '25', '40', '10', '0', 'LINE', '10', '200', '20', '0', '11', '220', '21', '0', '0', 'ENDSEC', '0', 'EOF'].join('\n');
  const r = G.parseDXF(dxf); assert.strictEqual(r.shapes.length, 2);
  // 100×50 rectangle with the top edge replaced by a half-circle bulge (radius 50) minus a Ø20 hole
  const A = G.regionArea(r.shapes), exact = 100 * 50 + Math.PI * 50 * 50 / 2 - Math.PI * 100;
  console.log(`   ${r.shapes.length} outlines, area ${A.toFixed(1)} vs ${exact.toFixed(1)}; warnings: ${r.warnings.join(' ') || 'none'}`);
  assert.ok(Math.abs(A - exact) / exact < 1e-3 && r.warnings.length === 1);
});

t('Project files round-trip and reject hostile content', () => {
  const d = doc2d('stress', [{ id: 's1', kind: 'rect', x: 0, y: 0, w: 10, h: 10 }], [{ id: 'b1', kind: 'force', targets: ['s1:1', '<script>'], x: 'NaN', y: 5 }]);
  d.solid = { name: 'x', tris: VX.boxTris(0, 0, 0, 1, 1, 1) };
  const back = S.sanitize(JSON.parse(S.serialize(d)));
  assert.deepStrictEqual(back.bcs[0].targets, ['s1:1']); assert.strictEqual(back.bcs[0].x, 0); assert.strictEqual(back.solid.tris.length, 108);
  assert.throws(() => S.sanitize({ format: 'other' }));
});

console.log('Summary (final mesh of each study):');
results.forEach(([k, v]) => console.log(`   ${k.padEnd(46)} ${(v >= 0 ? '+' : '') + v.toFixed(3)} %`));
console.log(`\n${n} validation tests passed`);
