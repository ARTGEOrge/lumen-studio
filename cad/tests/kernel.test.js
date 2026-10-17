// node cad/tests/kernel.test.js — volumes checked against exact formulas (circles are n-gons, so we use the n-gon area).
const K = require('../js/kernel.js');
const assert = require('assert');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const ngon = (r, k) => k / 2 * r * r * Math.sin(2 * Math.PI / k);
const near = (a, b, tol = 1e-6, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg || ''} ${a} vs ${b}`);

t('primitives have the right volume and closed surfaces', () => {
  near(K.volumeOf(K.box(10, 20, 30)), 6000);
  near(K.massProps(K.box(10, 20, 30)).area, 2 * (200 + 300 + 600));
  near(K.volumeOf(K.cylinder(3, 10, 48)), ngon(3, 48) * 10);
  near(K.volumeOf(K.cone(4, 0, 9, 48)), ngon(4, 48) * 9 / 3);
  near(K.volumeOf(K.sphere(5, 64)), 4 / 3 * Math.PI * 125, 0.01);
  near(K.volumeOf(K.torus(10, 2, 96, 48)), 2 * Math.PI * Math.PI * 10 * 4, 0.01);
});

t('booleans: subtract, union, intersect', () => {
  const b = K.box(10, 10, 10), c = K.place(K.cylinder(2, 20, 48), { z: -5 });
  near(K.volumeOf(b.subtract(c)), 1000 - ngon(2, 48) * 10, 1e-6, 'hole');
  const b2 = K.place(K.box(10, 10, 10), { x: 5 });
  near(K.volumeOf(b.union(b2)), 1500, 1e-6, 'union');
  near(K.volumeOf(b.intersect(b2)), 500, 1e-6, 'intersect');
  const m = K.massProps(b.union(b2)); near(m.centroid[0], 2.5); near(m.size[0], 15);
});

t('sketch extrude with a hole, symmetric extrude, and each sketch plane', () => {
  const sk = { plane: 'XY', shapes: [{ type: 'rect', x: 0, y: 0, w: 40, h: 20 }, { type: 'circle', x: 20, y: 10, r: 5, hole: true }] };
  near(K.volumeOf(K.extrude(sk, 8)), (800 - ngon(5, 64)) * 8);
  const m = K.massProps(K.extrude(sk, 8, true)); near(m.min[2], -4); near(m.max[2], 4);
  ['XZ', 'YZ'].forEach(pl => { const s = K.extrude({ plane: pl, shapes: [{ type: 'rect', x: 0, y: 0, w: 4, h: 3 }] }, 5); near(K.volumeOf(s), 60, 1e-6, pl); });
  const L = K.extrude({ plane: 'XY', shapes: [{ type: 'points', pts: [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]] }] }, 2);
  near(K.volumeOf(L), (300 + 200) * 2, 1e-6, 'L-shape (concave)');
  near(K.volumeOf(K.extrude({ plane: 'XY', shapes: [{ type: 'slot', x: 0, y: 0, l: 10, r: 2 }] }, 1)), 40 + ngon(2, 64), 1e-3, 'slot');
});

t('revolve: tube and partial revolve', () => {
  const tube = K.revolve({ plane: 'XZ', shapes: [{ type: 'rect', x: 8, y: 0, w: 2, h: 10 }] }, 360, 96);
  near(K.volumeOf(tube), (ngon(10, 96) - ngon(8, 96)) * 10, 1e-6, 'tube');
  const half = K.revolve({ plane: 'XZ', shapes: [{ type: 'rect', x: 8, y: 0, w: 2, h: 10 }] }, 180, 96);
  near(K.volumeOf(half), (ngon(10, 96) - ngon(8, 96)) * 10 / 2, 1e-6, 'half');
});

t('expressions and parameters', () => {
  assert.strictEqual(K.evalExpr('2+3*4'), 14); assert.strictEqual(K.evalExpr('(2+3)*4'), 20); assert.strictEqual(K.evalExpr('2^3^2'), 512);
  assert.strictEqual(K.evalExpr('-w/2', { w: 10 }), -5); near(K.evalExpr('sin(30)*2'), 1); near(K.evalExpr('pi*r^2', { r: 2 }), 4 * Math.PI);
  assert.deepStrictEqual(K.evalParams([{ name: 'w', expr: '40' }, { name: 'half', expr: 'w/2' }]), { w: 40, half: 20 });
  assert.throws(() => K.evalExpr('w+1'), /Unknown parameter "w"/); assert.throws(() => K.evalExpr('2+'), /Unexpected/);
  assert.throws(() => K.evalExpr('alert(1)'), /Unknown function/);
});

t('parametric feature tree rebuilds when a parameter changes', () => {
  const model = { params: [{ name: 'w', expr: '40' }, { name: 'hole', expr: '6' }], features: [
    { type: 'box', p: { w: 'w', d: 20, h: 10 }, op: 'add' },
    { type: 'cylinder', p: { r: 'hole/2', h: 30, pz: -10, px: '-w/4' }, op: 'cut', pattern: { type: 'linear', count: 3, dx: 'w/4', dy: 0, dz: 0 } },
  ] };
  const r = K.build(model); assert.ok(r.log.every(l => l.ok), JSON.stringify(r.log));
  near(K.volumeOf(r.solid), 40 * 20 * 10 - 3 * ngon(3, 64) * 10);
  model.params[0].expr = '60'; near(K.volumeOf(K.build(model).solid), 60 * 20 * 10 - 3 * ngon(3, 64) * 10);
  model.features[1].suppressed = true; near(K.volumeOf(K.build(model).solid), 60 * 20 * 10);
  const circ = K.build({ features: [{ type: 'cylinder', p: { r: 20, h: 5 } }, { type: 'cylinder', p: { r: 2, h: 20, px: 14, pz: -5 }, op: 'cut', pattern: { type: 'circular', count: 6, angle: 360 } }] });
  near(K.volumeOf(circ.solid), ngon(20, 64) * 5 - 6 * ngon(2, 64) * 5, 1e-5);
  const bad = K.build({ features: [{ type: 'box', p: { w: 'nope', d: 1, h: 1 } }] }); assert.ok(!bad.log[0].ok && /nope/.test(bad.log[0].msg));
});

t('STL round trip and OBJ', () => {
  const s = K.box(10, 10, 10).subtract(K.place(K.cylinder(2, 20, 32), { z: -5 }));
  const stl = K.toSTL(s); const tris = s.triangles().length;
  assert.strictEqual(stl.length, 84 + 50 * tris);
  const back = K.fromSTL(stl); assert.strictEqual(back.length, tris);
  near(K.volumeOf(K.fromFaces(back)), K.volumeOf(s), 1e-4);
  const ascii = 'solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid x';
  assert.strictEqual(K.fromSTL(new TextEncoder().encode(ascii)).length, 1);
  const obj = K.toOBJ(K.box(1, 1, 1)); assert.strictEqual((obj.match(/^v /gm) || []).length, 8); assert.strictEqual((obj.match(/^f /gm) || []).length, 6);
});

console.log(`\n${n} tests passed`);
// (appended) mirror in two axes makes four copies
{ const r = K.build({ features: [{ type: 'box', p: { w: 40, d: 40, h: 5 } }, { type: 'cylinder', p: { r: 2, h: 20, px: 12, py: 12, pz: -5 }, op: 'cut', mirror: 'XY' }] });
  if (Math.abs(K.volumeOf(r.solid) - (40 * 40 * 5 - 4 * 64 / 2 * 4 * Math.sin(2 * Math.PI / 64) * 5)) > 1e-6) throw new Error('mirror XY volume'); console.log('ok mirror XY (4 holes)'); }
// (appended) crease edges: a cube has 12, and a box with a through-hole adds the two hole rims (as polygons)
{ const e = K.featureEdges(K.box(10, 10, 10)); if (e.length !== 12) throw new Error('cube edges ' + e.length);
  const b = K.box(10, 10, 10).union(K.place(K.box(10, 10, 10), { x: 10 }));   // coplanar fused faces: the seam must disappear
  const e2 = K.featureEdges(b); const len = e2.reduce((s, [p, q]) => s + K.V.len(K.V.sub(q, p)), 0);
  if (Math.abs(len - (4 * 20 + 4 * 10 + 4 * 10)) > 1e-6) throw new Error('fused box edge length ' + len); console.log('ok crease edges ignore T-junctions and seams'); }
