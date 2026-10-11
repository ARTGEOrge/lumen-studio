// Headless UI test: drives tools, timeline and graph editor with synthetic pointer/keyboard events; clicks every menu item.
const R = {}, ok = (k, c, info) => R[k] = c ? 'ok' : 'FAIL ' + JSON.stringify(info);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = []; const oe = console.error; console.error = (...a) => { errors.push(a.join(' ')); oe(...a); }; addEventListener('error', e => errors.push(e.message));
const view = document.querySelector('#view'), vr = () => view.getBoundingClientRect();
const P = (el, type, x, y, o = {}) => el.dispatchEvent(new PointerEvent(type, Object.assign({ clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerType: 'mouse' }, o)));
const scr = (cx, cy) => { const [x, y] = LM.viewer.toScreen(cx, cy), r = vr(); return [x + r.left, y + r.top]; };
const drag = async (el, a, b, o = {}, steps = 5) => { P(el, 'pointerdown', ...a, o); for (let i = 1; i <= steps; i++) { P(el, 'pointermove', a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps, o); await sleep(5); } P(el, 'pointerup', ...b, o); await sleep(20); };
try {
await LM.newProject(); await sleep(100);
const c = LM.comp();
// rectangle tool
LM.tools.set('rect'); await drag(view, scr(400, 300), scr(800, 600));
let L = LM.comp().layers[0]; ok('rect tool', L && L.type === 'shape' && Math.abs(L.shape.size.v[0] - 400) < 3 && Math.abs(L.tr.position.v[0] - 600) < 3, L && [L.shape.size.v, L.tr.position.v]);
// selection drag moves
LM.tools.set('select'); LM.select([]); await drag(view, scr(600, 450), scr(700, 500));
ok('select+move', LM.st.sel[0] === L.id && Math.abs(L.tr.position.v[0] - 700) < 3 && Math.abs(L.tr.position.v[1] - 500) < 3, L.tr.position.v);
LM.undo(); ok('undo move', Math.abs(LM.comp().layers[0].tr.position.v[0] - 600) < 3); L = LM.comp().layers[0];
// scale handle (bottom-right corner) with shift
LM.select([L.id]); await sleep(20); await drag(view, scr(800, 600), scr(1000, 750), { shiftKey: true });
ok('scale handle', L.tr.scale.v[0] > 140 && Math.abs(L.tr.scale.v[0] - L.tr.scale.v[1]) < .5, L.tr.scale.v);
// rotate tool
LM.tools.set('rotate'); await drag(view, scr(L.tr.position.v[0] + 200, L.tr.position.v[1]), scr(L.tr.position.v[0], L.tr.position.v[1] + 200));
ok('rotate tool', Math.abs(L.tr.rotation.v - 90) < 2, L.tr.rotation.v);
// mask mode ellipse on selected layer
LM.tools.set('ellipse'); LM.st.mode = 'mask'; await drag(view, scr(550, 400), scr(650, 500));
ok('mask tool', L.masks.length === 1 && L.masks[0].path.v.pts.length === 4, L.masks.length); LM.st.mode = 'shape';
// pen tool: triangle closed
LM.tools.set('pen'); for (const [x, y] of [[200, 200], [400, 200], [300, 380]]) { const [sx, sy] = scr(x, y); P(view, 'pointerdown', sx, sy); P(view, 'pointerup', sx, sy); await sleep(10); }
{ const [sx, sy] = scr(200, 200); P(view, 'pointerdown', sx, sy); P(view, 'pointerup', sx, sy); await sleep(20); }
const pl = LM.comp().layers[0]; ok('pen tool closed path', pl.type === 'shape' && pl.shape.kind === 'path' && pl.shape.path.v.c === true && pl.shape.path.v.pts.length === 3, pl.shape?.path?.v);
// pen with drag creates tangents, Enter finishes open path
for (const [x, y] of [[1200, 200], [1400, 300]]) { const [sx, sy] = scr(x, y); await drag(view, [sx, sy], [sx + 40, sy]); }
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(20);
ok('pen open path w/ tangents', LM.comp().layers[0].shape.path.v.c === false && LM.comp().layers[0].shape.path.v.pts[0][4] !== 0, LM.comp().layers[0].shape.path.v);
// text tool → dialog
LM.tools.set('text'); { const [sx, sy] = scr(960, 900); P(view, 'pointerdown', sx, sy); P(view, 'pointerup', sx, sy); } await sleep(50);
document.querySelector('.aero-modal textarea').value = 'Hello'; document.querySelector('.aero-modal textarea').dispatchEvent(new Event('input')); document.querySelector('.aero-modal .aero-btn.pri').click(); await sleep(30);
ok('text tool', LM.comp().layers[0].type === 'text' && LM.comp().layers[0].text.str === 'Hello');
// brush on a new drawing layer
LM.tools.set('brush'); await drag(view, scr(300, 800), scr(700, 850));
const dl = LM.comp().layers[0]; R.layersAfterBrush = LM.comp().layers.map(l => l.type).join(); if (dl.type !== 'draw') return JSON.stringify(R); ok('brush creates drawing', dl.type === 'draw' && dl.draw.cels.k[0].v.length === 1 && dl.draw.cels.k[0].v[0].pts.length > 6, dl.type);
LM.setTime(1); LM.celCommand('blank'); await drag(view, scr(300, 700), scr(500, 700));
ok('new cel', dl.draw.cels.k.length === 2 && dl.draw.cels.k[1].v.length === 1);
LM.setTime(.5); LM.requestRender(); await sleep(50);
// timeline: expand the rect layer, stopwatch position, add keys, drag a diamond
LM.tools.set('select'); LM.select([L.id]); LM.setTime(0); await sleep(30);
const row = [...document.querySelectorAll('.tl-row.layer')].find(r => r.dataset.id === L.id);
if (!L.expanded) row.querySelector('.twirl').click(); await sleep(30);
let trRow = [...document.querySelectorAll('.tl-row.group')].find(r => r.textContent.includes('Transform')); if (!LM.ui.open.has(L.id + '|transform')) trRow.querySelector('.twirl').click(); await sleep(30);
let posRow = [...document.querySelectorAll('.tl-row.prop')].find(r => r.querySelector('.pname')?.textContent === 'Position');
posRow.querySelector('.watch').click(); await sleep(30);
ok('stopwatch', L.tr.position.k && L.tr.position.k.length === 1);
LM.setTime(2); LM.setVal(L.tr.position, 2, [300, 300]); LM.commit('k'); await sleep(30);
posRow = [...document.querySelectorAll('.tl-row.prop')].find(r => r.querySelector('.pname')?.textContent === 'Position');
const dias = posRow.querySelectorAll('.kf'); ok('diamonds', dias.length === 2, dias.length);
const d2 = dias[1].getBoundingClientRect(), px1s = LM.tl.x(1) - LM.tl.x(0);
await drag(dias[1], [d2.left + 5, d2.top + 5], [d2.left + 5 + px1s, d2.top + 5]);
ok('drag keyframe', Math.abs(L.tr.position.k[1].t - 3) < .05, L.tr.position.k[1].t);
// scrub value widget (rotation)
const rotRow = [...document.querySelectorAll('.tl-row.prop')].find(r => r.querySelector('.pname')?.textContent === 'Rotation');
const sc = rotRow.querySelector('.scrub'), sr = sc.getBoundingClientRect(), r0 = L.tr.rotation.v;
await drag(sc, [sr.left + 3, sr.top + 3], [sr.left + 33, sr.top + 3]);
ok('scrub', Math.abs(L.tr.rotation.v - r0 - 30) < 2, [r0, L.tr.rotation.v]);
// keyboard: K/J keyframe nav, F9 easy ease, Space play
LM.setTime(0); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true })); await sleep(10); ok('K next keyframe', Math.abs(LM.st.time - 3) < .05, LM.st.time);
LM.st.selKeys.clear(); L.tr.position.k.forEach(k => LM.st.selKeys.add(k)); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'F9', bubbles: true })); ok('F9 easy ease', L.tr.position.k[0].o === 'ease');
// graph editor: drag the outgoing handle of key 0
LM.tl.toggleGraph(); LM.st.selProps.clear(); LM.st.selProps.add(L.id + '|tr.position'); LM.graph.draw(); await sleep(30);
const gc = document.querySelector('.tl-graph'), gr = gc.getBoundingClientRect();
ok('graph visible', !gc.hidden && gr.width > 100, [gr.width, gr.height]);
// find handle: scan hits by trying pointerdown near the computed handle x position
const k0 = L.tr.position.k[0], kk1 = L.tr.position.k[1], hx = LM.tl.x(k0.t + (kk1.t - k0.t) * k0.eo[0]);
let moved = false; const h = LM.graph.hitList().find(h => h.kind === 'handle' && h.h.side === 'o' && h.h.a === k0);
if (h) { P(gc, 'pointerdown', gr.left + h.x, gr.top + h.y); P(gc, 'pointermove', gr.left + h.x + 30, gr.top + h.y - 30); P(gc, 'pointerup', gr.left + h.x + 30, gr.top + h.y - 30); moved = k0.eo[0] > .4; }
ok('graph handle drag', moved && k0.o === 'bezier', k0);
LM.tl.toggleGraph();
// pick whip: parent text layer to the rect layer
const tL = LM.comp().layers.find(l => l.type === 'text'); LM.select([tL.id]); await sleep(20);
const rows = () => [...document.querySelectorAll('.tl-row.layer')];
const pw = rows().find(r => r.dataset.id === tL.id).querySelector('.pw'), target = rows().find(r => r.dataset.id === L.id).querySelector('.name');
const a = pw.getBoundingClientRect(), b = target.getBoundingClientRect();
pw.dispatchEvent(new PointerEvent('pointerdown', { clientX: a.left + 5, clientY: a.top + 5, bubbles: true, pointerId: 1 }));
dispatchEvent(new PointerEvent('pointermove', { clientX: b.left + 10, clientY: b.top + 8, pointerId: 1 })); dispatchEvent(new PointerEvent('pointerup', { clientX: b.left + 10, clientY: b.top + 8, pointerId: 1 })); await sleep(20);
ok('pick whip parent', tL.parent === L.id, tL.parent);
// expression via "=" button
LM.select([L.id]); await sleep(20);
const optRow = [...document.querySelectorAll('.tl-row.prop')].find(r => r.querySelector('.pname')?.textContent === 'Opacity');
if (optRow) { optRow.querySelector('.xbtn').click(); await sleep(20); }
const ta = document.querySelector('.tl-row.expr textarea'); ok('expression row', !!ta && L.tr.opacity.x != null);
if (ta) { ta.value = 'clamp(time * 50, 0, 100)'; ta.dispatchEvent(new Event('change')); await sleep(20); ok('typed expression evaluates', Math.abs(LM.val(L.tr.opacity, 1) - 50) < 1e-6, LM.val(L.tr.opacity, 1)); }
// every menu item (except file pickers / saves)
const skip = /^(Open Project…|Import File…|Save|Save As…|Save Current Frame as PNG…|New Project|Open Sample)$/;
let clicked = 0;
for (const m of document.querySelectorAll('.aero-menu')) {
  m.click(); await sleep(5);
  const n = m.querySelectorAll('.aero-mi').length; m.click();
  for (let i = 0; i < n; i++) {
    m.click(); await sleep(5);
    const mi = m.querySelectorAll('.aero-mi')[i]; const label = mi.querySelector('span').textContent;
    if (skip.test(label) || mi.classList.contains('disabled')) { document.body.click(); continue; }
    mi.click(); clicked++; await sleep(40);
    if (LM.st.playing) LM.stop(); if (LM.st.rendering) { LM.ramPreview(); await sleep(100); }
    for (let k = 0; k < 3; k++) { const md = document.querySelector('.aero-modal:not(.aero-busy)'); if (!md) break; const cancel = md.querySelector('.aero-btns .aero-btn:not(.pri)') || md.querySelector('.aero-btns .aero-btn'); cancel.click(); await sleep(20); }
  }
}
R.menuItemsClicked = clicked;
await sleep(300);
ok('no errors', errors.length === 0, errors.slice(0, 5));
} catch (e) { R.ERROR = e.message + ' | ' + (e.stack || '').split(String.fromCharCode(10)).slice(1, 3).join(' '); }
return JSON.stringify(R);
