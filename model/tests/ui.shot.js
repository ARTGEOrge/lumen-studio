// Headless UI test for Lumen 3D, run with tools/shot (SHOT_JS). Exercises the real app: edit-mode tools,
// modal transforms, gizmo drags, modifiers, undo, keyframes, import/export round trip and a path-traced render.
const out = {}, errs = [];
addEventListener('error', e => errs.push(String(e.message))); addEventListener('unhandledrejection', e => errs.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
const A = L3D, X = A._test, M = X.M, S = X.S, IO = X.IO, wait = ms => new Promise(r => setTimeout(r, ms));
const check = (name, cond, info) => { out[name] = cond ? 'ok' : 'FAIL ' + (info !== undefined ? JSON.stringify(info) : ''); };
await wait(1500);
const cv = document.getElementById('cv'), rect = cv.getBoundingClientRect();
const ptr = (type, x, y, extra = {}) => cv.dispatchEvent(new PointerEvent(type, { clientX: rect.left + x, clientY: rect.top + y, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, bubbles: true, ...extra }));
const key = (k, extra = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));
const docKey = (k, extra = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...extra }));

// 1. new scene with a cube; edit mode; extrude top face by typed distance
Aero.setDirty(false); await X.newScene(); await wait(300);
const cubeId = A.doc.objects.find(o => o.name === 'Cube').id; let cube = A.doc.objects.find(o => o.id === cubeId);
const re = () => { cube = A.doc.objects.find(o => o.id === cubeId); };
check('new scene has cube, light, camera', A.doc.objects.length === 3 && cube);
X.setMode('edit'); X.setSelMode('face');
const top = cube.mesh.f.findIndex(f => M.faceNormal(cube.mesh, f)[2] > 0.99);
A.esel = M.flush(cube.mesh, 'face', { F: new Set([top]) }); A.refresh();
docKey('e'); await wait(50);
check('extrude starts a modal move', !!X.modal && X.modal.label === 'Extrude');
['1', '.', '5'].forEach(k => key(k)); key('Enter'); await wait(50);
let st = M.stats(cube.mesh), bb = M.bbox(cube.mesh);
check('extrude face +1.5 along normal', st.V === 12 && st.F === 10 && st.manifold && Math.abs(bb.max[2] - 2.5) < 1e-6, { st, bb });
// inset via dialog (OK)
docKey('i'); await wait(100);
let dlg = document.querySelector('.aero-modal .aero-box'); dlg.querySelector('input[type=number]').value = '0.25'; dlg.querySelector('input[type=number]').dispatchEvent(new Event('input')); await wait(100);
dlg.querySelector('.aero-btn.pri').click(); await wait(50);
st = M.stats(cube.mesh); check('inset adds ring faces', st.F === 14 && st.manifold, st);
// bevel all edges of the mesh
X.setSelMode('edge'); A.esel = M.flush(cube.mesh, 'edge', { E: new Set(M.edgeMap(cube.mesh).keys()) }); A.refresh();
docKey('b', { ctrlKey: true }); await wait(100); dlg = document.querySelector('.aero-modal .aero-box');
dlg.querySelector('input[type=number]').value = '0.05'; dlg.querySelector('input[type=number]').dispatchEvent(new Event('input')); await wait(100); dlg.querySelector('.aero-btn.pri').click(); await wait(50);
st = M.stats(cube.mesh); check('bevel all edges keeps manifold', st.manifold && st.euler === 2 && st.F > 40, st);
// undo back to before bevel and redo
A.undo(); await wait(50); re(); check('undo bevel', M.stats(cube.mesh).F === 14, M.stats(cube.mesh));
A.redo(); await wait(50); re(); check('redo bevel', M.stats(cube.mesh).F > 40);
A.undo(); await wait(50); re();
// loop cut on an edge of a side face
X.setSelMode('edge');
const side = cube.mesh.f.findIndex(f => f.length === 4 && Math.abs(M.faceNormal(cube.mesh, f)[0]) > 0.99), sf = cube.mesh.f[side];
const before = M.stats(cube.mesh); X.doLoopCut(sf[0], sf[1]); re(); const after = M.stats(cube.mesh);
check('loop cut adds a ring', after.F > before.F && after.manifold, { before, after });
// G with axis and typed value moves the selection
X.setSelMode('vert'); A.esel = M.selectAll(cube.mesh); A.refresh();
const z0 = M.bbox(cube.mesh).min[2]; docKey('g'); key('z'); ['2'].forEach(k => key(k)); key('Enter'); await wait(50); re();
check('G Z 2 moves all verts up by 2', Math.abs(M.bbox(cube.mesh).min[2] - z0 - 2) < 1e-6, M.bbox(cube.mesh));
// Esc cancels
docKey('s'); key('3'); key('Escape'); await wait(50); re(); check('Esc cancels scale', Math.abs(M.bbox(cube.mesh).min[2] - z0 - 2) < 1e-6);
X.setMode('object'); re();
// 2. object mode: gizmo drag along X
A.sel = new Set([cube.id]); A.active = cube.id; A.tool = 'move'; A.refresh(); await wait(200);
const gs = X.V.gizmoScale(), p0 = X.V.project([cube.loc[0], cube.loc[1], cube.loc[2]]), px = X.V.project([cube.loc[0] + 0.7 * gs, cube.loc[1], cube.loc[2]]);
const gx = px[0], gy = px[1]; // on the X arrow shaft
const loc0 = cube.loc.slice();
ptr('pointerdown', gx, gy); await wait(20); ptr('pointermove', gx + (px[0] - p0[0]), gy + (px[1] - p0[1])); await wait(20); ptr('pointerup', gx + (px[0] - p0[0]), gy + (px[1] - p0[1])); await wait(50); re();
check('gizmo X drag moves only along X', cube.loc[0] - loc0[0] > 0.1 && Math.abs(cube.loc[1] - loc0[1]) < 1e-6 && Math.abs(cube.loc[2] - loc0[2]) < 1e-6, { loc0, loc: cube.loc });
// snapping: rotate with typed value and snapping on increments
A.snap = true; docKey('r'); key('z'); key('3'); key('7'); key('Enter'); await wait(50); A.snap = false; re();
check('R Z 37 rotates 37 deg', Math.abs(cube.rot[2] * 180 / Math.PI - 37) < 1e-6, cube.rot);
// click selection on empty space deselects; click on cube selects
const cbb = M.bbox(cube.mesh), pc = X.V.project(S.xform(S.worldMatrix(cube, A.doc.anim.frame), [0, 1, 2].map(k => (cbb.min[k] + cbb.max[k]) / 2)));
A.sel = new Set(); A.tool = 'select'; A.refresh(); await wait(100);
ptr('pointerdown', pc[0], pc[1]); ptr('pointerup', pc[0], pc[1]); await wait(50);
check('click selects the cube', A.sel.has(cube.id) && A.active === cube.id, [...A.sel]);
// box select everything
ptr('pointerdown', 2, 2); ptr('pointermove', rect.width - 4, rect.height - 4); ptr('pointerup', rect.width - 4, rect.height - 4); await wait(50);
check('box select gets the cube', A.sel.has(cubeId), A.sel.size);
// 3. modifiers on the cube and stats
A.sel = new Set([cube.id]); A.active = cube.id;
X.addModifier(cube, 'mirror'); re(); X.addModifier(cube, 'subsurf'); re(); X.addModifier(cube, 'array'); re();
const ev = S.evalMesh(cube); check('modifier stack evaluates', ev.f.length > cube.mesh.f.length * 3, { base: cube.mesh.f.length, ev: ev.f.length });
check('modifier cards rendered', document.querySelectorAll('.modcard').length === 3);
// 4. keyframes: insert at 1 and 25, check interpolation and timeline
X.setFrame(1); X.insertKeys(); re(); cube.loc = [0, 0, 0]; X.setFrame(25); S.setKey(cube, 'loc', 25, [4, 0, 0]); X.commit('key'); re();
X.setFrame(13); const mid = S.trsAt(cube, 13).loc[0];
check('keyframe interpolation at frame 13', mid > 0.5 && mid < 3.5, mid);
// 5. export / import round trip through the app's own exporters
const items = X.exportItems(false, true);
const glb = IO.exportGLTF(A.doc, items, { binary: true, frames: { start: 1, end: 25, fps: 24 } });
const nBefore = A.doc.objects.length;
await X.importFiles([{ name: 'roundtrip.glb', data: glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) }]);
check('glb import adds objects back', A.doc.objects.length === nBefore * 2, { nBefore, now: A.doc.objects.length });
const imp = A.doc.objects.find(o => o.name.startsWith('Cube.') && o.type === 'mesh');
check('imported cube is animated', imp && S.isAnimated(imp), imp && imp.keys && Object.keys(imp.keys));
const nObj0 = A.doc.objects.length, obj = IO.exportOBJ(items.filter(i => i.kind === 'mesh')).obj;
await X.importFiles([{ name: 'rt.obj', data: new TextEncoder().encode(obj).buffer }]);
const stl = IO.exportSTL(items.filter(i => i.kind === 'mesh'));
await X.importFiles([{ name: 'rt.stl', data: stl.buffer.slice(0) }]);
check('obj + stl imports', A.doc.objects.length === nObj0 + 2 && A.doc.objects.some(o => o.name === 'rt'), A.doc.objects.map(o => o.name));
// .l3d round trip
const txt = S.serialize(A.doc), back = S.parse(txt);
check('l3d round trip keeps everything', back.objects.length === A.doc.objects.length && back.objects.every((o, i) => o.type !== 'mesh' || o.mesh.f.length === A.doc.objects[i].mesh.f.length), back.objects.length);
// 6. sample scene and a small path-traced render with pixel checks
Aero.setDirty(false); await X.openSample(); await wait(500);
X.R.noSaveDialog = true;
const ui = await X.R.renderStill(A, { width: 160, height: 90, samples: 12, camera: S.cameraFrom(A.doc.objects.find(o => o.type === 'camera'), A.doc.anim.frame) });
const g = ui.canvas.getContext('2d'), img = g.getImageData(0, 0, 160, 90).data;
let sum = 0, red = 0; for (let i = 0; i < img.length; i += 4) { sum += img[i] + img[i + 1] + img[i + 2]; if (img[i] > 110 && img[i] > img[i + 1] * 1.8 && img[i] > img[i + 2] * 1.8) red++; }
check('render produced an image', sum / (160 * 90 * 3) > 40, sum / (160 * 90 * 3));
check('render shows the red box', red > 40, red);
check('render finished all samples', X.R.lastResult && X.R.lastResult.passes === 12, X.R.lastResult);
out.renderMs = Math.round(X.R.lastResult.ms); out.threads = X.R.workers();
ui.btn('close').click();
// performance: a dense mesh in edit mode
const t0 = performance.now(); X.addPrimitive('uvsphere', { segments: 128, rings: 64 }); X.setMode('edit'); A.esel = M.selectAll(A.doc.objects[A.doc.objects.length - 1].mesh); A.refresh(); out.denseEditMs = Math.round(performance.now() - t0);
X.setMode('object'); A.undo(); A.undo(); A.undo();
out.errors = errs;
return JSON.stringify(out, null, 1);
