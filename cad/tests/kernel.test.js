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
// (appended) drawings: a box with a through-hole shows the hole as hidden (dashed) lines in the front view only
{ const s = K.box(40, 20, 10).subtract(K.place(K.cylinder(4, 30, 32), { z: -10 }));
  const E = K.featureEdges(s, 28), front = K.edgeVisibility(s, E, [0, -1, 0], 0.5), top = K.edgeVisibility(s, E, [0, 0, 1], 0.5);
  const hidLen = segs => segs.filter(x => !x.vis).reduce((a, x) => a + K.V.len(K.V.sub(x.b, x.a)), 0);
  if (!(hidLen(front) > 5)) throw new Error('front view should show the hole as hidden lines: ' + hidLen(front));
  const visLen = segs => segs.filter(x => x.vis).reduce((a, x) => a + K.V.len(K.V.sub(x.b, x.a)), 0);   // from above: outline + hole rim visible (the bottom edges are rightly hidden)
  if (Math.abs(visLen(top) - (2 * (40 + 20) + 32 * 2 * 4 * Math.sin(Math.PI / 32))) > 0.5) throw new Error('top view visible length ' + visLen(top));
  const d = K.drawingSVG(s, { name: 'Test block' });
  if (!/FRONT VIEW/.test(d.svg) || !/>40</.test(d.svg) || !/>10</.test(d.svg) || !/>20</.test(d.svg) || !/stroke-dasharray/.test(d.svg)) throw new Error('drawing content');
  console.log('ok three-view drawing with hidden lines and overall dimensions (scale ' + d.scale + ')'); }

// ---------- v1.2: constrained sketches, edge fillets/chamfers, hole wizard, watertight 3MF / STEP ----------
const ok12 = name => console.log('ok', name);
const sector = (r, ang, k) => { let a = 0; for (let j = 0; j < k; j++) a += 0.5 * r * r * Math.sin(ang / k); return a; };   // polygonal arc area
{ // a rough quadrilateral snaps to an exact, fully constrained 40 × 20 rectangle; the width follows a parameter
  const pts = [[0, 0], [38, 1], [41, 19], [1, 22]], cons = [{ t: 'h', s: [0] }, { t: 'h', s: [2] }, { t: 'v', s: [1] }, { t: 'v', s: [3] }, { t: 'len', s: [0], v: 'w' }, { t: 'len', s: [1], v: 20 }, { t: 'x', p: [0], v: 0 }, { t: 'y', p: [0], v: 0 }];
  const r = K.solveSketch(pts, cons, { w: 40 }); assert.ok(r.ok); assert.strictEqual(r.dof, 0);
  [[0, 0], [40, 0], [40, 20], [0, 20]].forEach((q, i) => { near(r.pts[i][0], q[0], 1e-7); near(r.pts[i][1], q[1], 1e-7); });
  const u = K.solveSketch(pts, cons.slice(0, 4), {}); assert.ok(u.ok); assert.strictEqual(u.dof, 4, 'H/V rectangle keeps 4 DOF');
  const c = K.solveSketch([[0, 0], [10, 0], [5, 8]], [{ t: 'len', s: [0], v: 10 }, { t: 'len', s: [1], v: 10 }, { t: 'len', s: [2], v: 30 }], {}); assert.ok(!c.ok, 'triangle inequality violated → conflict');
  // parallelogram: parallel sides + length + angle, fully constrained
  const q = K.solveSketch([[0, 0], [28, 2], [33, 11], [3, 12]], [{ t: 'x', p: [0], v: 0 }, { t: 'y', p: [0], v: 0 }, { t: 'h', s: [0] }, { t: 'par', s: [0, 2] }, { t: 'par', s: [1, 3] }, { t: 'len', s: [0], v: 30 }, { t: 'len', s: [1], v: 12 }, { t: 'ang', s: [0, 1], v: 60, sg: 1 }], {});
  assert.ok(q.ok, 'parallelogram solve'); assert.strictEqual(q.dof, 0); near(q.pts[2][0], 36, 1e-7); near(q.pts[2][1], 12 * Math.sin(Math.PI / 3), 1e-7);
  // perpendicular + equal + point distances make a square
  const sq = K.solveSketch([[0, 0], [9, 1], [10, 9], [1, 11]], [{ t: 'x', p: [0], v: 0 }, { t: 'y', p: [0], v: 0 }, { t: 'dy', p: [0, 1], v: 0, sg: 1 }, { t: 'dx', p: [0, 1], v: 10, sg: 1 }, { t: 'perp', s: [0, 1] }, { t: 'perp', s: [1, 2] }, { t: 'eq', s: [0, 1] }, { t: 'eq', s: [1, 2] }, { t: 'dist', p: [0, 2], v: Math.SQRT2 * 10 }], {});
  assert.ok(sq.ok, 'square solve'); near(sq.pts[2][0], 10, 1e-7); near(sq.pts[2][1], 10, 1e-7); near(sq.pts[3][0], 0, 1e-7);
  assert.throws(() => K.solveSketch(pts, [{ t: 'h', s: [9] }], {}), /missing point or line/); assert.throws(() => K.solveSketch(pts, [{ t: 'evil' }], {}), /Unknown sketch constraint/);
  ok12('constraint solver: rectangle, parallelogram, square, DOF count, conflicts');
}
{ // sketch feature: parametric constrained profile with a rounded corner, extruded
  const sk = { type: 'sketch', pts: [[0, 0], [38, 1], [41, 19], [1, 22]], cons: [{ t: 'h', s: [0] }, { t: 'h', s: [2] }, { t: 'v', s: [1] }, { t: 'v', s: [3] }, { t: 'len', s: [0], v: 'w' }, { t: 'len', s: [1], v: 20 }, { t: 'x', p: [0], v: 0 }, { t: 'y', p: [0], v: 0 }], fil: [null, null, 'rr', 0] };
  const model = { params: [{ name: 'w', expr: '40' }, { name: 'rr', expr: '5' }], features: [{ type: 'extrude', p: { plane: 'XY', dist: 10, shapes: [sk] } }] };
  const r = K.build(model); assert.ok(r.log[0].ok, JSON.stringify(r.log)); const k = Math.ceil((Math.PI / 2) / (Math.PI / 18));
  near(K.volumeOf(r.solid), (800 - (25 - sector(5, Math.PI / 2, k))) * 10, 1e-9, 'rounded rectangle');
  model.params[0].expr = '60'; near(K.volumeOf(K.build(model).solid), (1200 - (25 - sector(5, Math.PI / 2, k))) * 10, 1e-9, 'width follows parameter');
  model.params[1].expr = '25'; const bad = K.build(model); assert.ok(!bad.log[0].ok && /radius too large/.test(bad.log[0].msg));
  ok12('sketch feature: parametric constraints + corner fillet → extrude');
}
{ // edge fillet & chamfer: convex box edge (material removed) and concave L inside edge (material added)
  const k = Math.ceil((Math.PI / 2) / (Math.PI / 24)), b = K.box(40, 30, 20), top = { a: [-20, 15, 20], b: [20, 15, 20] };
  near(K.volumeOf(K.blendEdges(b, [top], 5, 'fillet')), 24000 - (25 - sector(5, Math.PI / 2, k)) * 40, 1e-9, 'convex fillet');
  near(K.volumeOf(K.blendEdges(b, [top], 5, 'chamfer')), 24000 - 12.5 * 40, 1e-9, 'chamfer');
  const L = K.box(40, 30, 10).union(K.place(K.box(40, 10, 30), { y: 10 }));
  near(K.volumeOf(K.blendEdges(L, [{ a: [-20, 5, 10], b: [20, 5, 10] }], 4)) - K.volumeOf(L), (16 - sector(4, Math.PI / 2, k)) * 40, 1e-9, 'concave fillet');
  // two edges, feature tree, slightly moved reference still matches the nearest parallel edge
  const r = K.build({ params: [{ name: 'w', expr: '40' }], features: [{ type: 'box', p: { w: 'w', d: 30, h: 20 } }, { type: 'fillet', p: { kind: 'fillet', r: 3, edges: [top, { a: [-20, -15, 20], b: [20, -15, 20] }] } }] });
  assert.ok(r.log.every(l => l.ok), JSON.stringify(r.log)); near(K.volumeOf(r.solid), 24000 - 2 * (9 - sector(3, Math.PI / 2, k)) * 40, 1e-9, 'two edges');
  const r2 = K.build({ params: [{ name: 'w', expr: '50' }], features: [{ type: 'box', p: { w: 'w', d: 30, h: 20 } }, { type: 'fillet', p: { kind: 'chamfer', r: 2, edges: [top] } }] });
  near(K.volumeOf(r2.solid), 30000 - 2 * 50, 1e-9, 'edge found after a parameter change');
  const e1 = K.build({ features: [{ type: 'box', p: { w: 40, d: 30, h: 20 } }, { type: 'fillet', p: { r: 3, edges: [{ a: [0, 0, 500], b: [1, 1, 501] }] } }] });
  assert.ok(!e1.log[1].ok && /no longer exists/.test(e1.log[1].msg), e1.log[1].msg);
  const e2 = K.build({ features: [{ type: 'box', p: { w: 40, d: 30, h: 20 } }, { type: 'fillet', p: { r: 0, edges: [top] } }] }); assert.ok(!e2.log[1].ok);
  const cyl = K.cylinder(10, 10, 32); assert.throws(() => K.blendEdges(cyl, [{ a: [10, 0, 0], b: [10, 0, 10] }], 1), /flat faces|no longer/);
  ok12('edge fillet / chamfer: convex, concave, multiple edges, parametric re-match, errors');
}
{ // hole wizard: counterbored, countersunk, blind with drill point; on each sketch plane
  const ng = (r, k) => k / 2 * r * r * Math.sin(2 * Math.PI / k), s = K.holeSpec('M6', 'cbore');
  assert.deepStrictEqual([s.d, s.cd, s.cdep], [6.6, 11, 6.4]); assert.strictEqual(K.holeSpec('M6', 'tapped').d, 5);
  const box = { type: 'box', p: { w: 40, d: 40, h: 10 } };
  const cb = K.build({ features: [box, { type: 'hole', op: 'cut', p: { kind: 'cbore', d: s.d, cd: s.cd, cdep: s.cdep, plane: 'XY', offset: 10, pts: '0,0; 10,10' } }] });
  assert.ok(cb.log.every(l => l.ok)); near(K.volumeOf(cb.solid), 16000 - 2 * (ng(3.3, 48) * 3.6 + ng(5.5, 48) * 6.4), 1e-9, 'counterbore');
  const cs = K.build({ features: [box, { type: 'hole', op: 'cut', p: { kind: 'csink', d: 6.6, sd: 13.7, ang: 90, plane: 'XY', offset: 10, pts: '0,0' } }] });
  const hs = (13.7 / 2 - 3.3), frust = 48 / 2 * Math.sin(2 * Math.PI / 48) * hs / 3 * (6.85 ** 2 + 6.85 * 3.3 + 3.3 ** 2);
  near(K.volumeOf(cs.solid), 16000 - ng(3.3, 48) * (10 - hs) - frust, 1e-9, 'countersink');
  const bl = K.build({ features: [box, { type: 'hole', op: 'cut', p: { kind: 'simple', d: 5, depth: 6, plane: 'XY', offset: 10, pts: '0,0' } }] });
  near(K.volumeOf(bl.solid), 16000 - ng(2.5, 48) * 6 - ng(2.5, 48) * (2.5 / Math.tan(59 * Math.PI / 180)) / 3, 1e-9, 'blind hole with 118° drill point');
  // side face: XZ plane through the front face y = -20 drilling 8 deep toward +Y (flip, because +w is −Y on XZ)
  const side = K.build({ features: [box, { type: 'hole', op: 'cut', p: { kind: 'simple', d: 4, depth: 8, plane: 'XZ', offset: 20, flip: false, pts: '0,5' } }] });
  near(K.volumeOf(side.solid), 16000 - ng(2, 48) * 8 - ng(2, 48) * (2 / Math.tan(59 * Math.PI / 180)) / 3, 1e-9, 'side hole');
  const nf = K.build({ features: [box, { type: 'hole', op: 'cut', p: { d: 4, pts: '' } }] }); assert.ok(!nf.log[1].ok && /No hole positions/.test(nf.log[1].msg));
  ok12('hole wizard: counterbore, countersink, blind drill point, side face, validation');
}
{ // watertight export: welding removes every T-junction; 3MF zip and STEP faceted B-rep
  const s = K.build({ features: [{ type: 'box', p: { w: 40, d: 40, h: 10 } }, { type: 'hole', op: 'cut', p: { kind: 'cbore', d: 6.6, cd: 11, cdep: 6.4, offset: 10, pts: '0,0; 10,10' } }, { type: 'fillet', p: { r: 2, edges: [{ a: [-20, 20, 10], b: [20, 20, 10] }] } }] }).solid;
  const open = sol => { const c = new Map(), key = v => v.join(','); sol.polys.forEach(p => p.v.forEach((v, i) => { const k = key(v) + '>' + key(p.v[(i + 1) % p.v.length]); c.set(k, (c.get(k) || 0) + 1); })); let bad = 0; c.forEach((n, k) => { const [a, b] = k.split('>'); if ((c.get(b + '>' + a) || 0) !== n) bad++; }); return bad; };
  assert.ok(open(s) > 0, 'raw BSP output has T-junctions'); assert.strictEqual(open(K.weld(s)), 0, 'welded mesh is closed');
  const m = K.indexedMesh(s); let vol = 0; m.tris.forEach(([a, b, c]) => vol += K.V.dot(m.verts[a], K.V.cross(m.verts[b], m.verts[c])) / 6); near(vol, K.volumeOf(s), 1e-9, 'indexed mesh volume');
  const em = new Map(); m.tris.forEach(t => t.forEach((a, i) => { const k = a + '>' + t[(i + 1) % 3]; em.set(k, (em.get(k) || 0) + 1); })); let unp = 0; em.forEach((n, k) => { const [a, b] = k.split('>'); if (em.get(b + '>' + a) !== n) unp++; }); assert.strictEqual(unp, 0, 'every triangle edge has a twin');
  const z = K.to3MF(s, { name: 'A & B' }), dv = new DataView(z.buffer);
  assert.strictEqual(dv.getUint32(0, true), 0x04034b50); const eocd = z.length - 22; assert.strictEqual(dv.getUint32(eocd, true), 0x06054b50); assert.strictEqual(dv.getUint16(eocd + 10, true), 3);
  const txt = new TextDecoder().decode(z); assert.ok(/<model unit="millimeter"/.test(txt) && /A &amp; B/.test(txt)); assert.strictEqual((txt.match(/<triangle /g) || []).length, m.tris.length);
  let p = 0, files = 0; while (dv.getUint32(p, true) === 0x04034b50) { const crc = dv.getUint32(p + 14, true), size = dv.getUint32(p + 18, true), nl = dv.getUint16(p + 26, true); assert.strictEqual(K.crc32(z.subarray(p + 30 + nl, p + 30 + nl + size)), crc); p += 30 + nl + size; files++; } assert.strictEqual(files, 3);
  assert.strictEqual(K.crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const st = K.toSTEP(s, { name: "Bob's part" }), ids = new Set(), refs = [];
  assert.ok(st.startsWith('ISO-10303-21;') && /END-ISO-10303-21;\s*$/.test(st) && /'Bob''s part'/.test(st));
  st.split('\n').forEach(l => { const mm = /^#(\d+)=/.exec(l); if (mm) { ids.add(+mm[1]); (l.slice(mm[0].length).match(/#\d+/g) || []).forEach(r => refs.push(+r.slice(1))); } });
  assert.ok(refs.every(r => ids.has(r)), 'every STEP reference resolves');
  const faces = (st.match(/FACE_SURFACE\(/g) || []).length; assert.strictEqual(faces, K.weld(s).polys.length); assert.ok(/CLOSED_SHELL/.test(st) && /SI_UNIT\(\.MILLI\.,\.METRE\.\)/.test(st));
  assert.ok(!/\d\.\d*e/i.test(st.replace(/1\.E-05/, '')), 'no exponent-format reals');
  ok12('watertight 3MF (zip CRCs, triangle twins) and STEP faceted B-rep (refs resolve, ' + faces + ' faces)');
}
console.log('v1.2 checks passed');
{ // boolean fast paths, the v1.2 sample, and interior angles
  const a = K.box(10, 10, 10), b = K.place(K.box(10, 10, 10), { x: 30 }), c = K.place(K.box(10, 10, 10), { x: 10 });
  near(K.volumeOf(a.union(b)), 2000); near(K.volumeOf(a.subtract(b)), 1000); near(K.volumeOf(a.intersect(b)), 0);
  near(K.volumeOf(a.union(c)), 2000, 1e-9, 'touching boxes still fuse'); assert.strictEqual(K.featureEdges(a.union(c)).length, 12, 'fused seam disappears');
  const S = require('../js/sample.js').sampleCad(), r = K.build(S); assert.ok(r.log.every(l => l.ok), JSON.stringify(r.log));
  const m = K.massProps(r.solid); near(m.size[0], 80); near(m.size[2], 55);
  // triangle with a 60° interior angle at P2 between L1 (P1→P2) and L2 (P2→P3)
  const t = K.solveSketch([[0, 0], [20, 1], [12, 15]], [{ t: 'x', p: [0], v: 0 }, { t: 'y', p: [0], v: 0 }, { t: 'h', s: [0] }, { t: 'len', s: [0], v: 20 }, { t: 'len', s: [1], v: 20 }, { t: 'ang', s: [0, 1], v: 60, sg: -1, ra: true }], {});
  assert.ok(t.ok); assert.strictEqual(t.dof, 0); near(t.pts[2][0], 10, 1e-7); near(t.pts[2][1], 20 * Math.sin(Math.PI / 3), 1e-7);
  console.log('ok bbox fast paths, sample v1.2 builds, interior angle constraint');
}
{ // a v1 part file (no sketches, fillets or holes) still builds identically
  const v1 = { params: [{ name: 'w', expr: '80' }], features: [{ name: 'Base', type: 'box', op: 'add', p: { w: 'w', d: 50, h: 8 } }, { name: 'Holes', type: 'cylinder', op: 'cut', mirror: 'X', p: { r: 3, h: 24, px: 31, pz: -8 } }] };
  near(K.volumeOf(K.build(v1).solid), 80 * 50 * 8 - 2 * 32 * 9 * Math.sin(2 * Math.PI / 64) * 8);
  console.log('ok v1 files still build');
}
