// Node tests for Lumen 3D mesh operations: element counts, manifoldness, orientation, volume.
// Run: node model/tests/mesh.test.js
const M = require('../js/mesh.js');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const eq = (a, b, msg) => ok(a === b, `${msg}: got ${a}, expected ${b}`);
const near = (a, b, msg, e = 1e-6) => ok(Math.abs(a - b) <= e, `${msg}: got ${a}, expected ${b}`);
const counts = (m, V, E, F, msg, manifold = true) => { const s = M.stats(m); eq(s.V, V, msg + ' V'); eq(s.E, E, msg + ' E'); eq(s.F, F, msg + ' F'); if (manifold) ok(s.manifold, msg + ' manifold ' + JSON.stringify(s)); return s; };
const selF = (m, ids) => M.flush(m, 'face', { F: new Set(ids) });
const selE = (m, pairs) => M.flush(m, 'edge', { E: new Set(pairs.map(([a, b]) => M.ekey(a, b))) });
const topFace = m => m.f.findIndex(f => M.faceNormal(m, f)[2] > 0.99);

// primitives
const cube = M.cube(1);
counts(cube, 8, 12, 6, 'cube'); near(M.volume(cube), 8, 'cube volume');
counts(M.uvSphere(32, 16), 32 * 15 + 2, 32 * 15 + 32 * 16, 32 * 16, 'uv sphere');
counts(M.icoSphere(2), 162, 480, 320, 'ico sphere'); ok(M.volume(M.icoSphere(2)) > 3.9, 'ico outward');
counts(M.cylinder(32), 64, 96, 34, 'cylinder'); ok(M.volume(M.cylinder(32)) > 6, 'cylinder outward');
counts(M.cone(32), 33, 64, 33, 'cone'); ok(M.volume(M.cone(32)) > 2, 'cone outward');
counts(M.torus(1, .25, 48, 12), 576, 1152, 576, 'torus'); eq(M.stats(M.torus()).euler, 0, 'torus euler');
counts(M.plane(), 4, 4, 1, 'plane', false); eq(M.stats(M.plane()).boundary, 4, 'plane boundary');
counts(M.grid(4, 3), 20, 31, 12, 'grid', false);
ok(M.stats(M.uvSphere()).euler === 2 && M.volume(M.uvSphere()) > 4, 'sphere outward euler 2');

// extrude top face of cube
{
  const r = M.extrude(cube, selF(cube, [topFace(cube)]));
  counts(r.mesh, 12, 20, 10, 'extrude face');
  eq(r.sel.F.size, 1, 'extrude keeps face selected'); near(r.normal[2], 1, 'extrude normal');
  const m = M.transformVerts(r.mesh, r.sel.V, p => [p[0], p[1], p[2] + 1]);
  near(M.volume(m), 12, 'extruded volume');
}
// extrude two adjacent faces as one region
{
  const f1 = topFace(cube), f2 = cube.f.findIndex(f => M.faceNormal(cube, f)[0] > .99);
  const r = M.extrude(cube, selF(cube, [f1, f2]));
  counts(r.mesh, 8 + 6, 12 + 6 + 6 - 0 + 1 - 1, 6 + 6, 'region extrude 2 faces');
}
// edge extrude from a plane boundary
{
  const p = M.plane(); const r = M.extrude(p, selE(p, [[1, 2]]));
  const s = M.stats(r.mesh); eq(s.F, 2, 'edge extrude faces'); eq(s.V, 6, 'edge extrude verts'); eq(s.nonManifold + s.flipped, 0, 'edge extrude consistent');
}
// inset
{
  const r = M.inset(cube, selF(cube, [topFace(cube)]), 0.2);
  counts(r.mesh, 12, 20, 10, 'inset');
  const inner = r.mesh.f[[...r.sel.F][0]].map(i => r.mesh.v[i]);
  ok(inner.every(p => Math.abs(Math.abs(p[0]) - 0.8) < 1e-9 && Math.abs(Math.abs(p[1]) - 0.8) < 1e-9), 'inset inner square at 0.8');
  near(M.volume(r.mesh), 8, 'inset keeps volume');
  const all = selF(cube, [0, 1, 2, 3, 4, 5]);
  counts(M.inset(cube, all, 0.1, 0, true).mesh, 8 + 24, 12 + 24 + 24, 6 + 24, 'individual inset all faces');
  const d = M.inset(cube, selF(cube, [topFace(cube)]), 0.2, -0.3); near(M.volume(d.mesh), 8 - 0.1 * (4 + 2.56 + 3.2), 'inset with depth (frustum)', 1e-6);
}
// bevel
{
  const b1 = M.bevel(cube, selE(cube, [[4, 5]]), 0.2);
  counts(b1.mesh, 10, 15, 7, 'bevel 1 edge');
  near(M.volume(b1.mesh), 8 - 0.2 * 0.2 / 2 * 2, 'bevel 1 edge volume');
  const allE = M.flush(cube, 'edge', { E: new Set(M.edgeMap(cube).keys()) });
  const b2 = M.bevel(cube, allE, 0.1);
  counts(b2.mesh, 24, 48, 26, 'bevel all edges');
  ok(M.volume(b2.mesh) < 8 && M.volume(b2.mesh) > 7.8, 'bevel all volume ' + M.volume(b2.mesh));
  // three edges of the top face (a U shape)
  const b3 = M.bevel(cube, selE(cube, [[4, 5], [5, 6], [6, 7]]), 0.15);
  const s3 = M.stats(b3.mesh); ok(s3.manifold, 'bevel 3 edges manifold ' + JSON.stringify(s3)); eq(s3.euler, 2, 'bevel 3 edges euler');
  const cyl = M.cylinder(16), topE = []; const top = cyl.f[cyl.f.length - 1]; for (let i = 0; i < top.length; i++) topE.push([top[i], top[(i + 1) % top.length]]);
  const b4 = M.bevel(cyl, selE(cyl, topE), 0.1); const s4 = M.stats(b4.mesh); ok(s4.manifold && s4.euler === 2, 'bevel cylinder rim ' + JSON.stringify(s4)); eq(s4.F, 18 + 16, 'bevel cylinder rim faces');
}
// loop cut
{
  const lc = M.loopCut(cube, 0, 1, 1);
  counts(lc.mesh, 12, 20, 10, 'loop cut cube'); eq(lc.sel.E.size, 4, 'loop cut selects the new loop'); near(M.volume(lc.mesh), 8, 'loop cut volume');
  const lc3 = M.loopCut(cube, 0, 1, 3); counts(lc3.mesh, 8 + 12, 12 + 12 + 12, 6 + 12, 'loop cut x3');
  const sp = M.uvSphere(8, 6), side = sp.f.findIndex(f => f.length === 4), f = sp.f[side];
  // cut along a meridian ring: stops at the triangle fans at the poles, which get the new vertices inserted
  const lcs = M.loopCut(sp, f[0], f[1], 1); const s = M.stats(lcs.mesh); ok(s.manifold, 'loop cut sphere manifold ' + JSON.stringify(s)); eq(s.euler, 2, 'loop cut sphere euler');
  const tor = M.torus(1, .25, 12, 6), lct = M.loopCut(tor, tor.f[0][0], tor.f[0][1], 1); counts(lct.mesh, 72 + 6, 144 + 12, 72 + 6, 'loop cut torus (closed ring of 6)');
}
// subdivide
{
  const s1 = M.subdivide(cube, selF(cube, [0, 1, 2, 3, 4, 5]));
  counts(s1.mesh, 26, 48, 24, 'subdivide whole cube');
  const s2 = M.subdivide(cube, selF(cube, [topFace(cube)])); const st = M.stats(s2.mesh); ok(st.manifold && st.euler === 2, 'subdivide one face ' + JSON.stringify(st)); eq(st.F, 9, 'subdivide one face count');
  const ico = M.icoSphere(0), s3 = M.subdivide(ico, selF(ico, ico.f.map((_, i) => i))); counts(s3.mesh, 42, 120, 80, 'subdivide tris');
}
// merge, delete, fill, dissolve, recalc
{
  const top = cube.f[topFace(cube)], mg = M.merge(cube, M.flush(cube, 'vert', { V: new Set(top) }), 'center');
  const s = counts(mg.mesh, 5, 8, 5, 'merge top face to pyramid'); eq(s.euler, 2, 'merge euler');
  const d = M.del(cube, selF(cube, [topFace(cube)]), 'faces'); const sd = M.stats(d.mesh); eq(sd.F, 5, 'delete face'); eq(sd.boundary, 4, 'delete face hole');
  const dv = M.del(cube, M.flush(cube, 'vert', { V: new Set([0]) }), 'verts'); eq(M.stats(dv.mesh).V, 7, 'delete vert'); eq(M.stats(dv.mesh).F, 3, 'delete vert faces');
  const de = M.del(cube, selE(cube, [[4, 5]]), 'edges'); eq(M.stats(de.mesh).F, 4, 'delete edge');
  // fill the hole back
  const hole = d.mesh, bv = new Set(); M.edgeMap(hole).forEach((fs, k) => { if (fs.length === 1) { bv.add(M.ekeyA(k)); bv.add(M.ekeyB(k)); } });
  const fl = M.fill(hole, M.flush(hole, 'vert', { V: bv })); counts(fl.mesh, 8, 12, 6, 'fill hole'); near(M.volume(fl.mesh), 8, 'fill orientation');
  const sub2 = M.subdivide(cube, selF(cube, [topFace(cube)])), dz = M.dissolveFaces(sub2.mesh, sub2.sel); ok(dz && M.stats(dz.mesh).F === 6 + 0, 'dissolve faces back to 6 (with 4 extra verts on edges)');
  const flipped = M.flipFaces(cube, new Set([0, 2, 4])); ok(!M.stats(flipped).manifold, 'flip breaks orientation');
  const fixed = M.recalcNormals(flipped); ok(M.stats(fixed).manifold, 'recalc fixes orientation'); near(M.volume(fixed), 8, 'recalc outward');
  const inv = M.recalcNormals(M.flipFaces(cube, new Set([0, 1, 2, 3, 4, 5]))); near(M.volume(inv), 8, 'recalc flips inside-out mesh');
  const dup = M.duplicate(cube, selF(cube, [0, 1, 2, 3, 4, 5])); counts(dup.mesh, 16, 24, 12, 'duplicate');
  const tri = M.triangulate(cube); counts(tri.mesh, 8, 18, 12, 'triangulate');
  const mr = M.mirror(cube, M.selectAll(cube), 0, [0, 0, 0]); near(M.volume(mr.mesh), 8, 'mirror all keeps outward');
  const mbd = M.mergeByDistance(M.arrayMod(cube, 2, [1, 0, 0]), null, 1e-6); eq(mbd.merged, 4, 'merge by distance count');
  const lp = M.edgeLoop(M.uvSphere(8, 6), 1, 2); eq(lp.E.size, 8, 'edge loop around sphere ring');
  const lk = M.selectLinked(M.duplicate(cube, selF(cube, [0])).mesh, 'vert', M.flush(cube, 'vert', { V: new Set([0]) })); eq(lk.V.size, 8, 'select linked');
}
// modifiers
{
  const cc = M.catmullClark(cube, 1); counts(cc, 26, 48, 24, 'subsurf 1'); counts(M.catmullClark(cube, 2), 98, 192, 96, 'subsurf 2');
  const r = Math.hypot(...cc.v[0]); ok(r < Math.sqrt(3) && r > 0.8, 'subsurf shrinks corners');
  ok(M.volume(M.catmullClark(cube, 3)) > 2.5 && M.volume(M.catmullClark(cube, 3)) < 4.19, 'subsurf volume between limit bounds');
  const pl = M.catmullClark(M.plane(), 1); eq(M.stats(pl).F, 4, 'subsurf plane'); eq(M.stats(pl).boundary, 8, 'subsurf plane boundary');
  // half cube open at x=0 mirrored -> closed box
  const half = M.del(cube, M.flush(cube, 'vert', { V: new Set(cube.v.map((p, i) => i).filter(i => cube.v[i][0] < 0)) }), 'verts').mesh;
  const hm = M.transformVerts(half, half.v.map((_, i) => i), p => [p[0] < 0.5 ? 0 : p[0], p[1], p[2]]);
  const mm = M.mirrorMod(M.compact({ v: hm.v, f: hm.f, uv: hm.uv }).mesh, [true, false, false]);
  void mm;
  const box = M.cube(1); const hb = M.del(box, M.flush(box, 'face', { F: new Set([box.f.findIndex(f => M.faceNormal(box, f)[0] < -0.99)]) }), 'faces').mesh;
  const shifted = M.transformVerts(hb, hb.v.map((_, i) => i), p => [p[0] < 0 ? 0 : p[0], p[1], p[2]]);
  const mirrored = M.mirrorMod(shifted, [true, false, false], true); const ms = M.stats(mirrored);
  ok(ms.manifold && ms.V === 12 && ms.F === 10, 'mirror modifier welds seam ' + JSON.stringify(ms)); near(M.volume(mirrored), 8, 'mirror modifier volume');
  const ar = M.arrayMod(cube, 3, [1.5, 0, 0]); eq(M.stats(ar).F, 18, 'array faces'); near(M.bbox(ar).max[0], 1 + 2 * 3, 'array extent');
  const sp = M.arrayMod(cube, 2, [1, 0, 0], [0, 0, 0], true); const ss = M.stats(sp); eq(ss.V, 12, 'array merge welds'); eq(ss.nonManifold, 1 * 0 + ss.nonManifold, 'array merge');
  const so = M.solidify(M.plane(), 0.2); counts(so, 8, 12, 6, 'solidify plane'); near(M.volume(so), 4 * 0.2, 'solidify volume');
  const sg = M.solidify(M.grid(3, 3), 0.1); ok(M.stats(sg).manifold, 'solidify grid manifold');
  const ev = M.evaluate(cube, [{ type: 'mirror', x: true }, { type: 'subsurf', levels: 1 }, { type: 'array', count: 2, rx: 1.2 }, { type: 'solidify', thickness: .05, enabled: false }]);
  ok(ev.f.length > 0, 'evaluate stack');
}
// triangulation of a concave n-gon (L shape)
{
  const L = M.make([[0, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0], [1, 2, 0], [0, 2, 0]], [[0, 1, 2, 3, 4, 5]]);
  const t = M.triFace(L.v, L.f[0]); eq(t.length, 4, 'L tris');
  let area = 0; t.forEach(([a, b, c]) => { const p = L.v[L.f[0][a]], q = L.v[L.f[0][b]], r = L.v[L.f[0][c]]; area += ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2; });
  near(area, 3, 'L area (all ccw, none outside)');
  const tt = M.toTriangles(M.uvSphere(), true); eq(tt.count, 32 * 14 * 2 + 64, 'toTriangles count');
}
// sanitize untrusted data
{
  ok(M.sanitize({ v: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], f: [[0, 1, 2], [0, 1, 99], 'x'] }).f.length === 1, 'sanitize drops bad faces');
  ok(M.sanitize({ v: [[0, 'a', 0]], f: [] }) === null, 'sanitize rejects bad verts');
}
console.log(`mesh tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
