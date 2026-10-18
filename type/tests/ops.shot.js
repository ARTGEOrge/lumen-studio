// SHOT_JS body (URL http://localhost:5180/type/?sample): path operations from the Path menu on real glyphs.
const wait = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
for (let i = 0; i < 60 && !(window.LT && LT.font); i++) await wait(100);
const R = {}, fails = []; const ok = (c, m) => { R[m] = !!c; if (!c) fails.push(m); };
const G = () => LT.glyph(LT.cur), sel = keys => { LT.E.sel.clear(); keys.forEach(k => LT.E.sel.add(k)); };
LT.change('sq', d => { const g = TM.newGlyph('sq', [], 600); g.contours.push(TM.rectContour(100, 0, 500, 400)); d.addGlyph(g); });
LT.openGlyph('sq'); await frame();
sel(['0:0', '0:1']); LT.ed.convertSegments('curve');
ok(G().contours[0].points.length === 6 && G().contours[0].points.filter(p => p.t === 'c').length === 1, 'segment → curve adds two handles');
sel(G().contours[0].points.map((p, i) => '0:' + i)); LT.ed.convertSegments('line');
ok(G().contours[0].points.length === 4 && G().contours[0].points.every(p => p.t === 'l'), 'curve → line');
// closing segment (last → first)
sel(['0:3', '0:0']); LT.ed.convertSegments('curve');
ok(G().contours[0].points.length === 6 && G().contours[0].points[0].t === 'c' && G().contours[0].points[0].x === 100, 'closing segment → curve keeps start point');
LT.ed.toQuadratic(); ok(TM.glyphIsQuadratic(G()) && !TM.glyphIsCubic(G()), 'convert to quadratic');
LT.ed.toCubic(); ok(TM.glyphIsCubic(G()) && !TM.glyphIsQuadratic(G()), 'convert to cubic');
// add extremes on a diagonal-handle curve
LT.change('ex', d => { const g = d.glyph('sq'); g.contours = [{ points: [{ x: 0, y: 0, t: 'c' }, { x: 300, y: 0, t: 'l' }, { x: 400, y: 300, t: 'o' }, { x: 100, y: 500, t: 'o' }, { x: 0, y: 300, t: 'c' }].slice(0) }]; g.contours[0].points = [{ x: 0, y: 0, t: 'l' }, { x: 300, y: 0, t: 'l' }, { x: 450, y: 250, t: 'o' }, { x: 250, y: 550, t: 'o' }, { x: 0, y: 300, t: 'c' }]; });
const n0 = G().contours[0].points.length; LT.E.sel.clear(); LT.ed.addExtremes();
const b = TM.glyphBounds(LT.font, G()), pts = G().contours[0].points.filter(p => p.t !== 'o');
ok(G().contours[0].points.length > n0 && pts.some(p => Math.abs(p.x - b.xMax) <= 1) && pts.some(p => Math.abs(p.y - b.yMax) <= 1), 'add extremes puts nodes at the x / y extremes');
// set start point
sel(['0:1']); const p1 = { ...G().contours[0].points[1] }; LT.ed.setStart(); ok(G().contours[0].points[0].x === p1.x && G().contours[0].points[0].y === p1.y, 'set start point');
// flip / transform keep direction correct
LT.E.sel.clear(); LT.ed.flip('h'); ok(TM.contourArea(G().contours[0]) > 0, 'flip whole glyph keeps counter-clockwise outer');
const bb = TM.glyphBounds(LT.font, G()); LT.ed.transform([2, 0, 0, 2, 0, 0], 'Scale'); const bb2 = TM.glyphBounds(LT.font, G());
ok(Math.abs((bb2.xMax - bb2.xMin) - 2 * (bb.xMax - bb.xMin)) <= 2, 'transform scales');
// copy / paste contours
LT.ed.copy(); const nc = G().contours.length; LT.ed.paste(); ok(G().contours.length === 2 * nc && LT.E.sel.size > 0, 'copy / paste contours');
LT.ed.deleteSel(); ok(G().contours.length === nc, 'delete pasted contours');
// round, center
LT.change('frac', d => { d.glyph('sq').contours[0].points[0].x += 0.4; }); LT.ed.round(); ok(G().contours[0].points.every(p => Number.isInteger(p.x) && Number.isInteger(p.y)), 'round coordinates');
LT.ed.centerGlyph(); const sb = TM.sidebearings(LT.font, G()); ok(Math.abs(sb.lsb - sb.rsb) <= 1, 'center glyph');
// open path close
LT.change('open', d => { d.glyph('sq').contours.push({ points: [{ x: 0, y: 0, t: 'l' }, { x: 50, y: 0, t: 'l' }, { x: 50, y: 50, t: 'l' }], open: true }); });
LT.ed.closePaths(); ok(!G().contours.some(c => c.open), 'close open paths');
// font view copy / paste glyph
LT.setView('font'); LT.cur = 'O'; LT.sel = ['O']; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
LT.sel = ['sq']; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
ok(JSON.stringify(LT.glyph('sq').contours) === JSON.stringify(LT.glyph('O').contours) && LT.glyph('sq').advance === LT.glyph('O').advance, 'font view Ctrl+C / Ctrl+V copies a glyph outline');
// mark / delete / duplicate
LT.setMark(['sq'], 3); ok(LT.glyph('sq').mark === 3, 'mark color');
LT.duplicateGlyphs(['sq']); ok(LT.glyph('sq.001') && LT.font.order.indexOf('sq.001') === LT.font.order.indexOf('sq') + 1, 'duplicate glyph');
await LT.deleteGlyphs(['sq.001']); ok(!LT.glyph('sq.001'), 'delete glyph');
// deleting a component base asks, then decomposes users
const users = TM.componentUsers(LT.font).get('acutecomb') || [];
const p = LT.deleteGlyphs(['acutecomb']); await frame(); document.querySelector('.aero-box [data-a=o]').click(); await p;
ok(!LT.glyph('acutecomb') && users.length > 0 && users.every(n => LT.glyph(n).components.every(c => c.base !== 'acutecomb') && LT.glyph(n).contours.length > 0), `deleting a base glyph decomposes its ${users.length} users`);
LT.undo(); ok(LT.glyph('acutecomb') && LT.glyph(users[0]).components.some(c => c.base === 'acutecomb'), 'undo restores base and components');
// History panel jump
LT.rightTab('hist'); await frame(); const items = document.querySelectorAll('#histList .aero-item'); ok(items.length > 10, 'history list'); items[0].click(); ok(!LT.glyph('sq'), 'history: jump to the first state'); LT.rightTab('props');
return JSON.stringify({ passed: Object.values(R).filter(Boolean).length, failed: fails, total: Object.keys(R).length });
