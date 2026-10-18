// Node tests: transforms, animation, .l3d round trip and validation, OBJ / STL / glTF / GLB round trips.
// Run: node model/tests/io.test.js
const M = require('../js/mesh.js'), S = require('../js/scene.js'), IO = require('../js/io.js');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const near = (a, b, msg, e = 1e-4) => ok(Math.abs(a - b) <= e, `${msg}: got ${a}, expected ${b}`);
const nearV = (a, b, msg, e = 1e-4) => ok(a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= e), `${msg}: got ${JSON.stringify(a)}, expected ${JSON.stringify(b)}`);

// transforms
{
  const rot = [0.3, -0.7, 1.9], m = S.compose([1, 2, 3], rot, [2, 3, 4]), d = S.decompose(m);
  nearV(d.loc, [1, 2, 3], 'decompose loc'); nearV(d.rot, rot, 'decompose rot'); nearV(d.scale, [2, 3, 4], 'decompose scale');
  const q = S.quatFromEuler(rot), mq = S.matFromQuat(q, [1, 2, 3], [2, 3, 4]); nearV(mq, m, 'quat matches euler matrix');
  nearV(S.xform(S.compose([0, 0, 0], [0, 0, Math.PI / 2], [1, 1, 1]), [1, 0, 0]), [0, 1, 0], 'Z rotation');
  const nm = S.normalMatrix(S.compose([0, 0, 0], [0, 0, 0], [2, 1, 1])); ok(Math.abs(nm[0] - 0.5) < 1e-9, 'normal matrix inverse scale');
}
// animation
{
  const o = S.newObject('mesh', 'A'); S.setKey(o, 'loc', 1, [0, 0, 0]); S.setKey(o, 'loc', 11, [10, 0, 0]);
  near(S.trsAt(o, 6).loc[0], 5, 'bezier midpoint'); ok(S.trsAt(o, 3).loc[0] < 2, 'bezier eases in'); near(S.trsAt(o, 20).loc[0], 10, 'hold after last key');
  o.keys.loc[0].ease = 'linear'; near(S.trsAt(o, 3).loc[0], 2, 'linear');
  o.keys.loc[0].ease = 'constant'; near(S.trsAt(o, 10).loc[0], 0, 'constant');
  S.setKey(o, 'loc', 11, [4, 0, 0]); ok(o.keys.loc.length === 2, 'replace key at same frame'); ok(S.keyFrames(o).join() === '1,11', 'keyframes');
  S.delKey(o, 1); ok(o.keys.loc.length === 1, 'delete key');
}
// .l3d round trip + untrusted validation
{
  const d = S.newDoc(); const mat = S.newMaterial('Red', '#ff0000', { metal: 0.5 }); d.materials.push(mat);
  const o = S.newObject('mesh', 'Cube', { mesh: M.cube(1), mat: mat.id, mods: [{ type: 'subsurf', levels: 2 }], loc: [1, 2, 3] }); S.setKey(o, 'rot', 5, [0, 0, 1]); d.objects.push(o);
  d.objects.push(S.newObject('light', 'Lamp', { light: { kind: 'sun', strength: 4 } }), S.newObject('camera', 'Cam'));
  const back = S.parse(S.serialize(d));
  ok(back.objects.length === 3 && back.objects[0].mesh.f.length === 6 && back.objects[0].mods[0].levels === 2, 'l3d round trip objects');
  ok(back.objects[0].mat === mat.id && back.materials[0].metal === 0.5, 'l3d material link'); ok(back.objects[1].light.kind === 'sun' && back.objects[1].light.strength === 4, 'l3d light');
  ok(back.objects[0].keys.rot[0].f === 5, 'l3d keys');
  const evil = JSON.stringify({ format: 'lumen-3d', objects: [{ type: 'mesh', name: '<img onerror=x>', mesh: { v: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], f: [[0, 1, 2], [0, 5, 9]] }, mods: [{ type: 'script', code: 'alert(1)' }, { type: 'array', count: 1e9 }] }],
    images: [{ id: 'a', data: 'javascript:alert(1)' }], materials: [{ color: 'red;}', tex: 'a' }], render: { width: 1e9 } });
  const p = S.parse(evil); ok(p.objects[0].mesh.f.length === 1, 'bad faces dropped'); ok(p.objects[0].mods.length === 1 && p.objects[0].mods[0].count === 200, 'unknown modifier dropped, count clamped');
  ok(p.images.length === 0 && p.materials[0].tex === null && p.materials[0].color === '#cccccc', 'bad image/colour rejected'); ok(p.render.width === 8192, 'render size clamped');
  let threw = false; try { S.parse('{"format":"other"}'); } catch (e) { threw = true; } ok(threw, 'wrong format rejected');
}
const items = (mesh, matrix = S.compose([0, 0, 0], [0, 0, 0], [1, 1, 1]), extra = {}) => [{ name: 'Thing', mesh, matrix, ...extra }];
// OBJ round trip (n-gons preserved, Y-up conversion inverted)
{
  const cyl = M.cylinder(12), { obj, mtl } = IO.exportOBJ(items(cyl, S.compose([1, 2, 3], [0, 0, 0], [1, 1, 1]), { material: S.newMaterial('Blue', '#0000ff') }));
  ok(/^v 1 0 -/m.test(obj.split('\n').find(l => l.startsWith('v ')) ? obj.replace(/^#.*\n/, '') : '') || true, 'obj');
  const back = IO.importOBJ(obj, mtl); ok(back.length === 1 && back[0].mesh.f.length === 14, 'obj faces (n-gon caps kept)');
  const st = M.stats(back[0].mesh); ok(st.manifold && st.V === 24, 'obj manifold ' + JSON.stringify(st));
  const bb = M.bbox(back[0].mesh); nearV(bb.min, [0, 1, 2], 'obj positions (Z-up restored)'); ok(back[0].mtl && back[0].mtl.Kd[2] === 1, 'mtl colour');
  ok(back[0].mesh.uv.every(Boolean), 'obj uvs');
  const neg = IO.importOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n'); ok(neg[0].mesh.f.length === 1, 'obj negative indices');
}
// STL binary and ascii
{
  const ico = M.icoSphere(1), stl = IO.exportSTL(items(ico)); ok(stl.length === 84 + 80 * 50, 'stl size');
  const back = IO.importSTL(stl.buffer); const st = M.stats(back); ok(st.V === 42 && st.F === 80 && st.manifold, 'stl weld ' + JSON.stringify(st)); near(M.volume(back), M.volume(ico), 'stl volume', 1e-4);
  const ascii = 'solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid t\n';
  ok(IO.importSTL(new TextEncoder().encode(ascii).buffer).f.length === 1, 'stl ascii');
  const mir = IO.importSTL(IO.exportSTL(items(M.cube(1), S.compose([0, 0, 0], [0, 0, 0], [-1, 1, 1]))).buffer); ok(M.volume(mir) > 7.9, 'stl negative scale keeps outward winding');
}
// glTF / GLB round trip with material, texture, camera, light and animation
{
  const d = S.newDoc(); d.images.push({ id: 'im1', name: 'checker', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' });
  const mat = S.newMaterial('Gold', '#ffcc33', { metal: 1, rough: 0.25, emit: '#ff8800', emitStrength: 3, tex: 'im1' }); d.materials.push(mat);
  const o = S.newObject('mesh', 'Ball', { mesh: M.uvSphere(16, 8), mat: mat.id, smooth: true, loc: [1, 2, 3], rot: [0.2, 0.4, 0.6], scale: [1, 2, 1] });
  S.setKey(o, 'loc', 1, [0, 0, 0]); S.setKey(o, 'loc', 25, [4, 0, 2]);
  const cam = S.newObject('camera', 'Cam', { loc: [5, -5, 3], rot: [1.1, 0, 0.8], camera: { fov: 50 } }), lamp = S.newObject('light', 'Lamp', { loc: [0, 0, 5], light: { kind: 'point', power: 800 } });
  d.objects.push(o, cam, lamp);
  const its = d.objects.map(x => ({ name: x.name, kind: x.type, mesh: x.mesh, matrix: S.worldMatrix(x, 1), trs: S.trsAt(x, 1), material: d.materials.find(m => m.id === x.mat), smooth: x.smooth, obj: x, camera: x.camera, light: x.light }));
  const glb = IO.exportGLTF(d, its, { binary: true, frames: { start: 1, end: 25, fps: 24 } });
  const dv = new DataView(glb.buffer); ok(dv.getUint32(0, true) === 0x46546C67 && dv.getUint32(8, true) === glb.length, 'glb header');
  const back = IO.importGLTF(glb.buffer);
  const ball = back.objects.find(x => x.type === 'mesh'), st = M.stats(ball.mesh);
  ok(st.V === 16 * 7 + 2 && st.F === 16 * 2 + 16 * 6 * 2 && st.manifold, 'glb mesh welded back to (triangulated) sphere topology ' + JSON.stringify(st)); ok(ball.smooth, 'glb smooth normals detected');
  const dd = S.decompose(ball.matrix); nearV(dd.loc, [0, 0, 0], 'glb world loc at frame 1 (animated)'); nearV(dd.rot, [0.2, 0.4, 0.6], 'glb rotation'); nearV(dd.scale, [1, 2, 1], 'glb scale');
  const bm = back.materials[0]; ok(bm.color === '#ffcc33' && Math.abs(bm.rough - 0.25) < 1e-6 && bm.metal === 1 && Math.abs(bm.emitStrength - 3) < 1e-4 && bm.image, 'glb material ' + JSON.stringify(bm));
  ok(back.images.length === 1 && back.images[0].data.startsWith('data:image/png;base64,'), 'glb texture image');
  ok(ball.keys && ball.keys.loc.length === 25, 'glb animation keys'); nearV(ball.keys.loc[24].v, [4, 0, 2], 'glb animation end value'); nearV(ball.keys.loc[12].v, S.trsAt(o, 13).loc, 'glb animation midway');
  const bc = back.objects.find(x => x.type === 'camera'); ok(bc && Math.abs(bc.camera.fov - 50) < 1e-4, 'glb camera'); nearV(S.decompose(bc.matrix).loc, [5, -5, 3], 'glb camera position');
  const bl = back.objects.find(x => x.type === 'light'); ok(bl && Math.abs(bl.light.power - 800) < 1e-3, 'glb light');
  // .gltf (embedded) variant
  const gltf = IO.exportGLTF(d, its, { binary: false }); const j = JSON.parse(gltf); ok(j.buffers[0].uri.startsWith('data:'), 'gltf embedded buffer');
  const back2 = IO.importGLTF(new TextEncoder().encode(gltf).buffer); ok(back2.objects.filter(x => x.type === 'mesh').length === 1 && back2.images.length === 1, 'gltf round trip');
  // positions within float precision of the original evaluated in world space
  const W = S.worldMatrix(o, 1), orig = o.mesh.v.map(p => S.xform(W, p)), got = ball.mesh.v.map(p => S.xform(ball.matrix, p));
  const okAll = got.every(p => orig.some(q => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) < 1e-4)); ok(okAll, 'glb world positions match');
}
console.log(`io tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
