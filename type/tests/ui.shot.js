// SHOT_JS body (URL http://localhost:5180/type/?sample): drives the real UI with synthetic pointer events and checks
// the resulting document state — pen (cubic + quadratic), select/drag, advance drag, shapes + auto direction,
// remove overlap, components, composites from a Unicode block, kerning edits, rename, undo/redo, open/save round trips.
const wait = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
for (let i = 0; i < 60 && !(window.LT && LT.font); i++) await wait(100);
const R = {}, fails = [];
const ok = (c, m) => { R[m] = !!c; if (!c) fails.push(m); };
const cv = document.getElementById('edCv');
const P = (x, y) => { const r = cv.getBoundingClientRect(); return [r.left + LT.E.ox + x * LT.E.s, r.top + LT.E.oy - y * LT.E.s]; };
const ev = (type, x, y, o = {}) => cv.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, detail: o.detail || 1, shiftKey: !!o.shift, altKey: !!o.alt, ctrlKey: !!o.ctrl }));
const click = (fx, fy, o) => { const [x, y] = P(fx, fy); ev('pointerdown', x, y, o); ev('pointerup', x, y, o); };
const drag = (fx, fy, tx, ty, o) => { const [x, y] = P(fx, fy), [x2, y2] = P(tx, ty); ev('pointerdown', x, y, o); for (let i = 1; i <= 6; i++) ev('pointermove', x + (x2 - x) * i / 6, y + (y2 - y) * i / 6, o); ev('pointerup', x2, y2, o); };
const G = () => LT.glyph(LT.cur);

// ---------- new glyph + pen (corner points) ----------
LT.change('New Glyph', d => d.addGlyph(TM.newGlyph('test', [], 600)));
LT.openGlyph('test'); await frame(); await frame();
LT.toolbox.set('pen');
click(100, 0); click(500, 0); click(300, 600);
ok(G().contours.length === 1 && G().contours[0].open && G().contours[0].points.length === 3, 'pen: 3 points, open');
click(100, 0);   // close on first point
let c0 = G().contours[0];
ok(!c0.open && c0.points.length === 3 && c0.points.every(p => p.t === 'l') && TM.contourArea(c0) > 0, 'pen: closed triangle, counter-clockwise');
// ---------- pen (cubic curves by dragging) ----------
LT.prefs.penMode = 'cubic';
drag(700, 300, 700, 500); drag(900, 600, 1000, 600); drag(1100, 300, 1100, 100); click(700, 300);
let c1 = G().contours[1];
ok(c1 && !c1.open && c1.points.filter(p => p.t === 'c').length >= 2 && c1.points.filter(p => p.t === 'o').length >= 4, 'pen: cubic contour with handles');
ok(c1 && c1.points.filter(p => p.t !== 'o' && p.s).length >= 2, 'pen: dragged points are smooth');
// ---------- pen (quadratic) ----------
LT.prefs.penMode = 'quadratic';
drag(100, -400, 100, -300); drag(400, -100, 500, -100); click(100, -400);
let c2 = G().contours[2];
ok(c2 && c2.points.some(p => p.t === 'q') && !c2.points.some(p => p.t === 'c'), 'pen: quadratic contour');
LT.prefs.penMode = 'cubic';
// ---------- select + drag a point, undo / redo ----------
LT.toolbox.set('select'); await frame();
const before = JSON.stringify(G().contours[0]);
drag(500, 0, 560, 40);
const moved = G().contours[0].points.find(p => p.x === 560 && p.y === 40);
ok(!!moved, 'select: point dragged by (60, 40)');
LT.undo(); ok(JSON.stringify(G().contours[0]) === before, 'undo restores the point');
LT.redo(); ok(!!G().contours[0].points.find(p => p.x === 560 && p.y === 40), 'redo re-applies');
// double-click toggles smooth
const [sx, sy] = P(300, 600); ev('pointerdown', sx, sy, { detail: 2 }); ev('pointerup', sx, sy);
ok(G().contours[0].points.find(p => p.x === 300 && p.y === 600).s === true, 'double-click makes a point smooth');
// alt+click on a segment inserts a point
const n0 = G().contours[0].points.length; click(200, 300, { alt: true });
ok(G().contours[0].points.length === n0 + 1, 'alt+click inserts a point on the segment');
// ---------- advance width drag ----------
const adv0 = G().advance; const [ax, ay] = P(adv0, 300);
ev('pointerdown', ax, ay); ev('pointermove', ax + 40, ay); ev('pointermove', ax + 50 * LT.E.s, ay); ev('pointerup', ax + 50 * LT.E.s, ay);
ok(Math.abs(G().advance - (adv0 + 50)) <= 1, `advance dragged ${adv0} → ${G().advance}`);
// ---------- delete a point ----------
LT.E.sel.clear(); LT.E.sel.add('2:0'); const nq = G().contours[2].points.length; LT.ed.deleteSel();
ok(!G().contours[2] || G().contours[2].points.length < nq, 'Delete removes the selected point');
// ---------- shapes + automatic counter direction ----------
LT.change('New Glyph', d => d.addGlyph(TM.newGlyph('box', [], 700)));
LT.openGlyph('box'); await frame(); await frame();
LT.toolbox.set('rect'); drag(50, 0, 650, 700);
LT.toolbox.set('ellipse'); drag(200, 200, 500, 500);
ok(G().contours.length === 2 && TM.contourArea(G().contours[0]) > 0 && TM.contourArea(G().contours[1]) < 0, 'rect + ellipse inside: ellipse became a counter');
LT.toolbox.set('rect'); drag(500, 300, 900, 400);   // overlaps the outer rectangle
LT.toolbox.set('select');
LT.ed.removeOverlap();
ok(G().contours.length === 2 && G().contours.filter(c => TM.contourArea(c) > 0).length === 1, 'remove overlap merged the bar into the box');
const nc = G().contours.length; LT.ed.reverse(); LT.ed.correctDirection(); ok(G().contours.filter(c => TM.contourArea(c) > 0).length === 1 && G().contours.length === nc, 'reverse + correct direction');
// ---------- components ----------
LT.change('Add Component', d => d.glyph('box').components.push({ base: 'o', m: [1, 0, 0, 1, 800, 0] }));
await frame();
const ob = TM.glyphBounds(LT.font, LT.glyph('o'));
LT.E.sel.clear(); LT.E.csel.clear();
const cx = 800 + ob.xMin + 8, cy = (ob.yMin + ob.yMax) / 2;   // on the left stroke of the "o"
drag(cx, cy, cx + 100, cy + 20);
ok(G().components[0].m[4] === 900 && G().components[0].m[5] === 20, `component dragged to ${G().components[0].m[4]},${G().components[0].m[5]}`);
LT.E.csel.clear(); LT.ed.decompose();
ok(G().components.length === 0 && G().contours.length >= 4, 'decompose component');
// ---------- composites from a Unicode block ----------
LT.setView('font'); LT.filter = { kind: 'block', block: 'Latin Extended-A', q: '' }; LT.emit('filter');
const miss = LT.visibleItems().find(i => i.missing && i.name === 'Amacron');
ok(!!miss, 'Latin Extended-A shows missing Amacron');
LT.createMissing(miss);
const am = LT.glyph('Amacron');
ok(am && am.components.length === 2 && am.components[0].base === 'A' && /^(macron|uni0304|macroncomb)/.test(am.components[1].base) && am.unicodes[0] === 0x100, 'Amacron built as A + macron');
ok(TM.glyphBounds(LT.font, am).yMax > LT.font.info.capHeight, 'macron sits above the capital');
const before2 = LT.font.order.length; LT.createBlockMissing(); ok(LT.font.order.length > before2 + 50, `add all missing in block: ${LT.font.order.length - before2} glyphs`);
LT.undo(); ok(LT.font.order.length === before2, 'undo bulk add');
// ---------- kerning ----------
LT.setView('kern'); LT.selectKernPair('A', 'V'); await frame();
const k0 = TM.kernValue(LT.font, 'A', 'V'), kA = TM.kernValue(LT.font, 'Aacute', 'V');
LT.kernNudge(-10);
ok(TM.kernValue(LT.font, 'A', 'V') === k0 - 10 && TM.kernValue(LT.font, 'Aacute', 'V') === kA - 10, 'kerning group pair nudged (applies to Aacute too)');
document.getElementById('kMode').value = 'ee'; document.getElementById('kMode').dispatchEvent(new Event('change'));
const kv = document.getElementById('kVal'); kv.value = '-123'; kv.dispatchEvent(new Event('change'));
ok(TM.kernValue(LT.font, 'A', 'V') === -123 && TM.kernValue(LT.font, 'Aacute', 'V') === kA - 10, 'glyph exception overrides the group pair');
document.getElementById('kernCv').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));
ok(TM.kernValue(LT.font, 'A', 'V') === -122, 'Shift+→ kerns by +1');
// ---------- rename keeps kerning, groups and components ----------
LT.setView('glyph'); LT.openGlyph('A'); await frame();
const users = TM.componentUsers(LT.font).get('A').length;
LT.rightTab('props'); await frame(); await frame();
const nm = document.getElementById('pName'); nm.value = 'A.ss01'; nm.dispatchEvent(new Event('change'));
ok(LT.glyph('A.ss01') && !LT.glyph('A') && TM.kernValue(LT.font, 'A.ss01', 'V') === -122 && TM.componentUsers(LT.font).get('A.ss01').length === users && LT.font.groups[TM.groupIndex(LT.font).k1.get('A.ss01')], 'rename updates kerning, groups and components');
LT.undo();
// ---------- metrics fields ----------
LT.openGlyph('H'); await frame(); await frame();
const lsb = document.getElementById('pLSB'); const sb0 = TM.sidebearings(LT.font, G()); lsb.value = String(sb0.lsb + 30); lsb.dispatchEvent(new Event('change'));
const sb1 = TM.sidebearings(LT.font, G()); ok(sb1.lsb === sb0.lsb + 30 && sb1.rsb === sb0.rsb && G().advance === LT.hist.items[LT.hist.index - 1].state.glyphs.H.advance + 30, 'LSB field shifts the outline and grows the width');
// ---------- project / font round trips through the real open path ----------
const proj = JSON.stringify(TM.toProject(LT.font));
const snapOrder = LT.font.order.join(), snapKern = JSON.stringify(LT.font.kerning);
Aero.setDirty(false);
await LT.openFiles([{ name: 'rt.ltype', data: new TextEncoder().encode(proj).buffer }]);
ok(LT.font.order.join() === snapOrder && JSON.stringify(LT.font.kerning) === snapKern && LT.docName === 'rt.ltype', '.ltype save → open round trip');
const ttf = await LT.compile('ttf', {}); Aero.setDirty(false);
await LT.openFiles([{ name: 'x.ttf', data: ttf.bytes.buffer.slice(0) }]);
ok(LT.font.order.join() === snapOrder && TM.kernValue(LT.font, 'A', 'V') === -122 && TM.kernValue(LT.font, 'Aacute', 'V') === kA - 10, 'TTF export → open keeps glyph order and kerning');
const w2 = await LT.compile('woff2-otf', {}); Aero.setDirty(false);
await LT.openFiles([{ name: 'x.woff2', data: w2.bytes.buffer.slice(0) }]);
ok(LT.font.order.length === snapOrder.split(',').length && LT.font.glyphs.o.contours.length === 2 && TM.glyphIsCubic(LT.font.glyphs.o), 'WOFF2(CFF) opens via the decompressor worker');
const zip = fflate.zipSync(FIO.exportUFO(JSON.parse(proj))); Aero.setDirty(false);
await LT.openFiles([{ name: 'x.ufo.zip', data: zip.buffer.slice(0) }]);
ok(LT.font.order.join() === snapOrder && JSON.stringify(LT.font.kerning) === snapKern, 'UFO zip export → open round trip');
// ---------- font info ----------
LT.setView('info'); await frame();
const fam = document.getElementById('fi_familyName'); fam.value = 'Lumen Proof'; fam.dispatchEvent(new Event('change', { bubbles: true }));
const sty = document.getElementById('fi_styleName'); sty.value = 'Light Italic'; sty.dispatchEvent(new Event('change', { bubbles: true }));
const otf = await LT.compile('otf', {}); const fk = opentype.parse(otf.bytes.buffer.slice(0));
ok(fk.names.fontFamily.en === 'Lumen Proof Light' && fk.names.fontSubfamily.en === 'Italic' && fk.names.preferredFamily.en === 'Lumen Proof' && fk.names.postScriptName.en === 'LumenProof-LightItalic', 'font info names reach the exported font');
// ---------- New Font dialog ----------
Aero.setDirty(false); LT.newDialog(); await frame();
document.querySelector('.aero-box input[type=text]').value = 'Brand New'; document.querySelector('.aero-box input[type=text]').dispatchEvent(new Event('input'));
document.querySelector('.aero-box [data-a=o]').click(); await wait(100);
ok(LT.font.info.familyName === 'Brand New' && LT.font.order.length === 2 + 81 && LT.glyph('A') && LT.glyph('A').unicodes[0] === 65, 'New Font with basic Latin placeholders');
LT.setView('font'); await frame();
return JSON.stringify({ passed: Object.values(R).filter(Boolean).length, failed: fails, total: Object.keys(R).length });
