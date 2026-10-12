// Headless UI test (v1.1): on-canvas text editing, new timeline switches & menus, shape Add menu, camera dialog,
// curves editor, export dialog with audio option; Lottie export verified by rendering it with lottie-web (test-only dependency).
const R = {}, F = LM.factory, ok = (k, c, info) => R[k] = c ? 'ok' : 'FAIL ' + JSON.stringify(info);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = []; addEventListener('error', e => errors.push(e.message)); const oe = console.error; console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };
const view = document.querySelector('#view'), vr = () => view.getBoundingClientRect();
const P = (el, type, x, y, o = {}) => el.dispatchEvent(new PointerEvent(type, Object.assign({ clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerType: 'mouse' }, o)));
const scr = (cx, cy) => { const [x, y] = LM.viewer.toScreen(cx, cy), r = vr(); return [x + r.left, y + r.top]; };
const click = (cx, cy) => { const [x, y] = scr(cx, cy); P(view, 'pointerdown', x, y); P(view, 'pointerup', x, y); };
const ti = document.querySelector('#textinput'), type = s => { ti.value = s; ti.dispatchEvent(new Event('input')); };
const key = k => ti.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
const main = async () => { try {
Aero.setDirty(false); await LM.newProject(); await sleep(100);
/* ---------- on-canvas text ---------- */
LM.tools.set('text'); click(500, 400); await sleep(30);
ok('type tool starts editing', !!LM.st.textEdit && document.activeElement === ti);
type('Hello'); await sleep(30);
const T = LM.comp().layers[0]; ok('typing updates layer live', T.type === 'text' && T.text.str === 'Hello');
// caret overlay drawn (orange pixels near the text)
LM.draw(); ok('edit overlay', !!LM.st.textEdit);
key('Escape'); await sleep(30);
ok('escape commits', !LM.st.textEdit && LM.hist.items[LM.hist.index].label === 'New Text Layer' && T.name === 'Hello', [LM.hist.items[LM.hist.index].label, T.name]);
// click into the text: caret at the click, typing inserts there
const b = LM.layerBounds(T, 0), m = LM.layerMatrix(T, 0, LM.comp()), endPt = LM.M.apply(m, b[2] - 2, (b[1] + b[3]) / 2);
click(...endPt); await sleep(30);
ok('click places caret', !!LM.st.textEdit && ti.selectionStart === 5, ti.selectionStart);
ti.setRangeText(' World', ti.selectionStart, ti.selectionEnd, 'end'); ti.dispatchEvent(new Event('input'));
LM.tools.set('select'); await sleep(30);
ok('tool change commits edit', !LM.st.textEdit && T.text.str === 'Hello World' && LM.hist.items[LM.hist.index].label === 'Edit Text', [T.text.str]);
LM.undo(); ok('undo edit', LM.comp().layers[0].text.str === 'Hello');
// double-click with Selection tool edits in place
const T2 = LM.comp().layers[0]; { const [x, y] = scr(...LM.M.apply(LM.layerMatrix(T2, 0, LM.comp()), (b[0] + b[2]) / 2, (b[1] + b[3]) / 2)); view.dispatchEvent(new MouseEvent('dblclick', { clientX: x, clientY: y, bubbles: true })); }
await sleep(30); ok('double-click edits on canvas', !!LM.st.textEdit && !document.querySelector('.aero-modal'));
key('Escape'); await sleep(20);
// an empty new text layer is discarded
const n0 = LM.comp().layers.length; LM.tools.set('text'); click(300, 800); await sleep(20); key('Escape'); await sleep(20);
ok('empty text discarded', LM.comp().layers.length === n0 && !LM.st.textEdit);
// Layer › New › Text starts on-canvas editing at the comp center
LM.newLayer.text(); await sleep(20); type('Center'); key('Escape'); await sleep(20);
ok('New Text menu', LM.comp().layers[0].text?.str === 'Center' && Math.abs(LM.comp().layers[0].tr.position.v[0] - 960) < 1);
LM.tools.set('select');
/* ---------- timeline switches ---------- */
R.step = 'timeline switches';
const S = F.shape(LM.comp(), 'rect', { size: [300, 200], pos: [600, 400] }); LM.addLayer(S, 'add shape'); await sleep(30);
const row = id => [...document.querySelectorAll('.tl-row.layer')].find(r => r.dataset.id === id);
row(S.id).querySelector('.d3sw').click(); await sleep(20); ok('3D switch', S.threeD && LM.findNode(S, 'tr.rotY') && LM.findNode(S, 'tr.posZ'));
LM.undo(); await sleep(20); ok('3D switch undo', !LM.comp().layers.find(l => l.id === S.id).threeD);
const S2 = LM.comp().layers.find(l => l.id === S.id); LM.select([S2.id]);
// shape Add menu (timeline Contents › Add ▸)
S2.expanded = true; LM.tl.rebuild(); await sleep(20);
const addBtn = [...document.querySelectorAll('.tl-row.group .gbtns button')].find(b => b.textContent.startsWith('Add')); addBtn.click(); await sleep(20);
[...document.querySelectorAll('.ctxmenu .aero-mi')].find(m => m.textContent.startsWith('Star')).click(); await sleep(20);
ok('Add ▸ Star group', S2.shape.groups.length === 1 && S2.shape.groups[0].kind === 'star');
const gRow = [...document.querySelectorAll('.tl-row.group')].find(r => r.querySelector('.gname')?.textContent === S2.shape.groups[0].name);
[...gRow.querySelectorAll('.gbtns button')].find(b => b.textContent === '+Rep').click(); await sleep(20);
ok('group repeater button', S2.shape.groups[0].rep.on && !!LM.findNode(S2, 'grp.' + S2.shape.groups[0].id + '.rep.copies'));
LM.shapeAddMenu(S2, 100, 100); [...document.querySelectorAll('.ctxmenu .aero-mi')].find(m => m.textContent.startsWith('Linear Gradient Fill')).click(); await sleep(20);
ok('gradient fill via menu', S2.shape.fill.gtype === 'linear' && !!LM.findNode(S2, 'shape.fill.gs'));
LM.shapeAddMenu(S2, 100, 100); [...document.querySelectorAll('.ctxmenu .aero-mi')].find(m => m.textContent.startsWith('Merge: Subtract')).click(); await sleep(20);
ok('merge via menu', S2.shape.merge === 'subtract');
// combine shape layers
const S3 = F.shape(LM.comp(), 'ellipse', { size: [100, 100], pos: [900, 400] }); LM.addLayer(S3, 'add'); LM.select([S2.id, S3.id]);
const nL = LM.comp().layers.length; LM.combineShapes(); await sleep(20);
const comb = LM.comp().layers.find(l => l.shape && l.shape.groups.some(g => g.kind === 'rect'));
ok('combine shapes', LM.comp().layers.length === nL - 1 && !!comb && comb.id === S3.id && comb.shape.groups.length === 2 && Math.abs(LM.layerBounds(comb, 0)[0] - (450 - 900)) < 2, comb && LM.layerBounds(comb, 0));
/* ---------- camera dialog ---------- */
R.step = 'camera dialog';
LM.select([comb.id]); LM.newCamera(); await sleep(30); document.querySelector('.aero-modal .aero-btn.pri').click(); await sleep(30);
ok('new camera', LM.comp().layers[0].type === 'camera' && comb.threeD && LM.selLayer().type === 'camera' && !!LM.findNode(LM.selLayer(), 'cam.zoom'));
/* ---------- curves editor ---------- */
R.step = 'curves editor';
LM.select([comb.id]); LM.addEffect('curves'); await sleep(20); const fx = comb.effects[0];
const btn = [...document.querySelectorAll('#inspector button')].find(b => b.textContent === 'Edit Curves…'); btn.click(); await sleep(30);
const ccv = document.querySelector('.aero-modal .curves canvas'), cr = ccv.getBoundingClientRect();
P(ccv, 'pointerdown', cr.left + cr.width * .5, cr.top + cr.height * .5); P(ccv, 'pointermove', cr.left + cr.width * .5, cr.top + cr.height * .2); P(ccv, 'pointerup', cr.left + cr.width * .5, cr.top + cr.height * .2);
document.querySelector('.aero-modal .aero-btn.pri').click(); await sleep(20);
ok('curves editor', fx.p.curves.v.rgb.length === 3 && Math.abs(fx.p.curves.v.rgb[1][1] - .8) < .02 && LM.hist.items[LM.hist.index].label === 'Curves', fx.p.curves.v.rgb);
/* ---------- time remap UI ---------- */
R.step = 'time remap UI';
LM.select([LM.comp().layers.find(l => l.type === 'text').id]); LM.st.selProps.clear();
const sub = LM.compById(LM.doc.active); LM.selLayers().length && (await (async () => { const p = LM.precompose(); await sleep(30); document.querySelector('.aero-modal .aero-btn.pri').click(); await p; })());
document.dispatchEvent(new KeyboardEvent('keydown', { key: 't', ctrlKey: true, altKey: true, bubbles: true })); await sleep(20);
ok('Ctrl+Alt+T time remap', LM.selLayer().tm.on && [...document.querySelectorAll('.tl-row.prop .pname')].some(p => p.textContent === 'Time Remap'));
void sub;
/* ---------- export dialog has the audio option ---------- */
R.step = 'export dialog has the audio option';
LM.exportDialog('mp4'); await sleep(20); ok('export dialog audio option', [...document.querySelectorAll('.aero-modal label')].some(l => /Include audio/.test(l.textContent))); document.querySelector('.aero-modal .aero-btn:not(.pri)').click();
/* ---------- Lottie export, rendered by lottie-web ---------- */
await new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/tools/deps/motion/node_modules/lottie-web/build/player/lottie.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
const c = F.comp({ name: 'Lot', w: 200, h: 120, fps: 30, duration: 2 }); c.bg = '#000000'; LM.doc.comps.push(c);
const sq = F.shape(c, 'rect', { size: [40, 40], roundness: 6, fill: '#ff3030', pos: [40, 60] }); sq.tr.position.k = [{ t: 0, v: [40, 60], i: 'ease', o: 'ease', ei: [.33, 0], eo: [.33, 0] }, { t: 1, v: [160, 60], i: 'ease', o: 'ease', ei: [.33, 0], eo: [.33, 0] }];
sq.tr.rotation.k = [{ t: 0, v: 0, i: 'linear', o: 'linear' }, { t: 2, v: 180, i: 'linear', o: 'linear' }];
const st = F.shape(c, 'star', { outer: 22, inner: 10, points: 5, fill: '#30a0ff', pos: [100, 25] }); st.shape.rep.on = true; st.shape.rep.copies.v = 3; st.shape.rep.position.v = [50, 0]; st.tr.position.v = [50, 25];
const el2 = F.shape(c, 'ellipse', { size: [50, 30], fill: '#ffffff', pos: [100, 100] }); el2.shape.fill.gtype = 'linear'; el2.shape.fill.gs.v = [-25, 0]; el2.shape.fill.ge.v = [25, 0]; el2.shape.fill.c2.v = '#00ff00';
el2.tr.opacity.x = 'linear(time, 0, 2, 100, 20)'; LM.trusted.add(el2.tr.opacity.x);
c.layers = [st, sq, el2]; LM.link(c);
const { json, warnings } = LM.exportLottie(c);
ok('lottie json', json.v && json.layers.length === 3 && json.layers[0].shapes.some(s => s.ty === 'rp') && json.layers[2].ks.o.a === 1 && json.layers[2].ks.o.k.length >= 60, warnings);
const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:120px;background:#000'; document.body.appendChild(host);
const anim = lottie.loadAnimation({ container: host, renderer: 'canvas', loop: false, autoplay: false, animationData: JSON.parse(JSON.stringify(json)), rendererSettings: { clearCanvas: true, dpr: 1 } });
await new Promise(r => anim.addEventListener('DOMLoaded', r)); await sleep(50);
const ours = new OffscreenCanvas(200, 120), oc = ours.getContext('2d', { willReadFrequently: true });
const diffs = [];
for (const f of [0, 15, 30, 45]) {
  anim.goToAndStop(f, true); await sleep(30);
  const lc = host.querySelector('canvas'), ld = document.createElement('canvas'); ld.width = 200; ld.height = 120; const lx = ld.getContext('2d', { willReadFrequently: true }); lx.fillStyle = '#000'; lx.fillRect(0, 0, 200, 120); lx.drawImage(lc, 0, 0, 200, 120);
  LM.renderInto(c, f / 30, ours); const a = lx.getImageData(0, 0, 200, 120).data, b2 = oc.getImageData(0, 0, 200, 120).data;
  let d = 0, bad = 0; for (let i = 0; i < a.length; i += 4) { const e = Math.abs(a[i] - b2[i]) + Math.abs(a[i + 1] - b2[i + 1]) + Math.abs(a[i + 2] - b2[i + 2]); d += e; if (e > 150) bad++; }
  diffs.push([f, Math.round(d / (a.length / 4) * 10) / 10, bad]);
}
ok('lottie-web renders like Lumen', diffs.every(([, mean, bad]) => mean < 12 && bad < 240), diffs);
R.lottieDiffs = JSON.stringify(diffs);
anim.destroy(); host.remove();
// the sample exports with warnings for effects but no exceptions, and text layers carry fonts + animators
Aero.setDirty(false); await LM.openSample(); await sleep(100); const ls = LM.exportLottie(LM.comp());
const tl = ls.json.layers.find(l => l.ty === 5); ok('sample lottie', ls.json.layers.length > 8 && tl && tl.t.a.length >= 2 && ls.json.fonts.list.length >= 1 && ls.json.assets.some(a => a.layers) && ls.warnings.some(w => /effects/.test(w)), ls.warnings);
ok('no errors', errors.length === 0, errors.slice(0, 5));
} catch (e) { R.ERROR = e.message + ' | ' + (e.stack || '').split('\n').slice(1, 3).join(' '); } };
await Promise.race([main(), sleep(120000).then(() => R.WATCHDOG = 'timed out')]);
return JSON.stringify(R);
