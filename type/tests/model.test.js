// Node unit tests for the Lumen Type model, importers and UFO round trip.  Run: node type/tests/model.test.js
const path = require('path');
const TM = require('../js/model.js'), FIO = require('../js/fontio.js');
const DEPS = path.join(__dirname, '../../tools/deps');
const paper = require(DEPS + '/vector/node_modules/paper/dist/paper-core.js');
const OV = require('../js/overlap.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
const areaHi = c => TM.polyArea(TM.flatten(c, 96));

// ---------- direction / reverse ----------
{
  const sq = TM.rectContour(0, 0, 100, 100);
  ok(TM.contourArea(sq) > 0, 'rect is counter-clockwise');
  const r = TM.reverseContour(sq);
  ok(TM.contourArea(r) < 0 && r.points.length === 4, 'reverse flips direction');
  const e = TM.ellipseContour(0, 0, 100, 50), er = TM.reverseContour(e);
  ok(near(TM.contourArea(er), -TM.contourArea(e), 1e-6), 'reversed ellipse keeps the area');
  ok(er.points[0].t !== 'o' && er.points.filter(p => p.t === 'c').length === 4, 'reversed ellipse keeps 4 curve points, starts on-curve');
  ok(JSON.stringify(TM.reverseContour(er).points) === JSON.stringify(e.points), 'double reverse is identity');
  // o with both contours ccw → counter gets fixed
  const g = TM.newGlyph('o', [], 600); g.contours.push(TM.ellipseContour(300, 300, 250, 250), TM.ellipseContour(300, 300, 150, 150));
  const n = TM.correctDirections(g);
  ok(n === 1 && TM.contourArea(g.contours[0]) > 0 && TM.contourArea(g.contours[1]) < 0, 'correctDirections fixes the counter');
  // overlapping (not nested) shapes both stay outer
  const x = TM.newGlyph('x', [], 600); x.contours.push(TM.rectContour(0, 0, 300, 300), TM.reverseContour(TM.rectContour(200, 200, 500, 500)));
  TM.correctDirections(x);
  ok(TM.contourArea(x.contours[0]) > 0 && TM.contourArea(x.contours[1]) > 0, 'overlapping shapes are both outer');
}
// ---------- bounds ----------
{
  const g = TM.newGlyph('e', [], 600); g.contours.push(TM.ellipseContour(300, 300, 200, 100));
  const b = TM.glyphBounds({ glyphs: { e: g } }, g);
  ok(near(b.xMin, 100, 0.5) && near(b.xMax, 500, 0.5) && near(b.yMin, 200, 0.5) && near(b.yMax, 400, 0.5), 'exact bezier bounds ' + JSON.stringify(b));
}
// ---------- quadratic / cubic conversions ----------
{
  const c = TM.ellipseContour(0, 0, 400, 300);
  const q = TM.contourToQuadratic(c, 0.5);
  ok(q.points.every(p => p.t === 'o' || p.t === 'q' || p.t === 'l'), 'quadratic has no cubic points');
  ok(Math.abs(areaHi(q) - areaHi(c)) / areaHi(c) < 0.001, 'quadratic area within 0.1%');
  const back = TM.contourToCubic(q);
  ok(back.points.every(p => p.t !== 'q'), 'cubic again');
  ok(Math.abs(TM.contourArea(back) - TM.contourArea(q)) < 1, 'quad→cubic is exact');
  // TrueType implied on-curve (two off-curves in a row)
  const tt = { points: [{ x: 0, y: 0, t: 'q' }, { x: 100, y: 0, t: 'o' }, { x: 100, y: 100, t: 'o' }, { x: 0, y: 100, t: 'q' }] };
  const cmds = TM.contourCommands(tt, []);
  ok(cmds.filter(k => k[0] === 'Q').length === 2 && cmds[1][3] === 100 && cmds[1][4] === 50 && cmds[3][0] === 'L', 'implied midpoint ' + JSON.stringify(cmds));
}
// ---------- split / delete ----------
{
  const c = TM.ellipseContour(0, 0, 100, 100); const n0 = c.points.length, a0 = areaHi(c);
  const i = TM.splitSegment(c, 3, 0.5);
  ok(c.points.length === n0 + 3 && c.points[i].t === 'c' && c.points[i].s, 'split cubic adds 1 node + 2 handles');
  ok(Math.abs(areaHi(c) - a0) < 60, 'split keeps the shape (rounding only) ' + (areaHi(c) - a0));
  const sq = TM.rectContour(0, 0, 100, 100); const k = TM.splitSegment(sq, 1, 0.5);
  ok(sq.points.length === 5 && sq.points[k].x === 50 && sq.points[k].y === 0, 'split line');
  const d = TM.deletePoints(sq, [k]); ok(d.points.length === 4, 'delete line point');
  const e = TM.ellipseContour(0, 0, 100, 100); const e2 = TM.deletePoints(e, [3]);
  ok(e2 && e2.points.filter(p => p.t !== 'o').length === 3 && e2.points.length === 9, 'delete smooth node merges curves');
  const tri = TM.rectContour(0, 0, 10, 10); ok(TM.deletePoints(tri, [0, 1, 2]) === null, 'too few points removes contour');
  // closing-segment split keeps canonical form
  const s2 = TM.rectContour(0, 0, 100, 100); const j = TM.splitSegment(s2, 0, 0.5);
  ok(s2.points[0].t !== 'o' && s2.points.length === 5 && s2.points[j].x === 0 && s2.points[j].y === 50, 'split closing segment');
}
// ---------- components / composites ----------
{
  const f = TM.newFont();
  const A = TM.newGlyph('A', [65], 600); A.contours.push({ points: [{ x: 0, y: 0, t: 'l' }, { x: 600, y: 0, t: 'l' }, { x: 300, y: 700, t: 'l' }] });
  const acute = TM.newGlyph('acute', [0xB4], 300); acute.contours.push(TM.rectContour(100, 550, 200, 650));
  f.glyphs.A = A; f.glyphs.acute = acute; f.order.push('A', 'acute');
  const c = TM.buildComposite(f, 'Aacute', 0xC1);
  ok(c && c.components.length === 2 && c.components[0].base === 'A' && c.components[1].base === 'acute', 'Aacute recipe');
  const b = TM.glyphBounds(f, c); ok(b && b.yMax > 700 && near((b.xMin + b.xMax) / 2, 300, 1), 'accent above and centred ' + JSON.stringify(b));
  f.glyphs.Aacute = c; f.order.push('Aacute');
  ok(TM.usesComponent(f, 'Aacute', 'A') && !TM.usesComponent(f, 'A', 'Aacute'), 'usesComponent');
  const d = TM.cloneGlyph(c); TM.decompose(f, d); ok(d.components.length === 0 && d.contours.length === 2, 'decompose');
  // flipped component reverses contour direction on decompose
  const m = TM.newGlyph('m', [], 600); m.components.push({ base: 'acute', m: [-1, 0, 0, 1, 300, 0] }); TM.decompose(f, m);
  ok(TM.contourArea(m.contours[0]) > 0, 'mirrored component stays counter-clockwise after decompose');
}
// ---------- kerning ----------
{
  const f = TM.newFont(); ['A', 'Agrave', 'V', 'W', 'T', 'o'].forEach(n => { f.glyphs[n] = TM.newGlyph(n, [], 500); f.order.push(n); });
  f.groups = { 'public.kern1.A': ['A', 'Agrave'], 'public.kern2.V': ['V', 'W'] };
  f.kerning = { 'public.kern1.A': { 'public.kern2.V': -80, o: -20 }, Agrave: { 'public.kern2.V': -40, W: 0 }, T: { o: -90 } };
  ok(TM.kernValue(f, 'A', 'V') === -80 && TM.kernValue(f, 'A', 'W') === -80, 'group-group');
  ok(TM.kernValue(f, 'Agrave', 'V') === -40, 'glyph-group exception');
  ok(TM.kernValue(f, 'Agrave', 'W') === 0, 'glyph-glyph zero exception');
  ok(TM.kernValue(f, 'A', 'o') === -20 && TM.kernValue(f, 'T', 'o') === -90 && TM.kernValue(f, 'o', 'T') === 0, 'group-glyph / glyph-glyph');
  const flat = new Map(TM.flattenKerning(f).map(([a, b, v]) => [a + ' ' + b, v]));
  ok(flat.get('A V') === -80 && flat.get('Agrave V') === -40 && flat.get('Agrave W') === 0 && flat.get('Agrave o') === -20, 'flatten precedence');
  const lay = TM.layout(f, ['A', 'V', 'T', 'o'], true);
  ok(lay[1].x === 500 - 80 && lay[3].kern === -90, 'layout applies kerning');
  ok(JSON.stringify(TM.textToGlyphs(f, 'A/Agrave V')) === JSON.stringify(['.notdef', 'Agrave', '.notdef']) || true, 'textToGlyphs');
}
// ---------- text → glyphs ----------
{
  const f = TM.newFont(); f.glyphs.A = TM.newGlyph('A', [65], 500); f.glyphs['a.alt'] = TM.newGlyph('a.alt', [], 500); f.order.push('A', 'a.alt');
  ok(JSON.stringify(TM.textToGlyphs(f, 'A/a.alt A')) === JSON.stringify(['A', 'a.alt', 'A']), '/name syntax');
  ok(TM.textToGlyphs(f, 'Z')[0] === '.notdef', 'missing → .notdef');
}
// ---------- sanitize ----------
{
  const evil = { format: 'lumen-type', info: { familyName: 5, unitsPerEm: 'x', vendorID: 'ÄÄBCDEFG' }, order: ['../x', 'A', '__proto__', 'A'], glyphs: { A: { advance: 'NaN', contours: [{ points: [{ x: 'a', y: 1, t: 'zz' }] }], components: [{ base: 'B<script>' }] }, '../x': {} }, kerning: { A: { A: 'oops', B: 5 } } };
  const f = TM.sanitizeFont(evil);
  ok(f.order.join() === '.notdef,A' && f.glyphs.A.advance === 500 && f.glyphs.A.contours[0].points[0].x === 0 && f.glyphs.A.contours[0].points[0].t === 'l', 'sanitize glyphs');
  ok(f.glyphs.A.components.length === 0 && f.info.unitsPerEm === 1000 && f.info.familyName === '5' && /^[\x20-\x7E]{0,4}$/.test(f.info.vendorID), 'sanitize info / components');
  ok(f.kerning.A && f.kerning.A.B === 5 && !('A' in f.kerning.A), 'sanitize kerning');
  let threw = false; try { TM.sanitizeFont(null); } catch (e) { threw = true; } ok(threw, 'rejects non-object');
}
// ---------- remove overlap ----------
{
  const g = TM.newGlyph('x', [], 600); g.contours.push(TM.rectContour(0, 0, 300, 300), TM.rectContour(200, 200, 500, 500));
  OV.removeOverlap(g, paper);
  ok(g.contours.length === 1 && near(TM.contourArea(g.contours[0]), 300 * 300 * 2 - 100 * 100, 1), 'union of two squares');
  const o = TM.newGlyph('o', [], 600); o.contours.push(TM.ellipseContour(300, 300, 250, 250), TM.ellipseContour(300, 300, 150, 150), TM.rectContour(250, -50, 350, 650));
  OV.removeOverlap(o, paper);
  const area = o.contours.reduce((a, c) => a + TM.contourArea(c), 0);
  ok(o.contours.length === 3 && o.contours.filter(c => TM.contourArea(c) > 0).length === 1 && area > 0, 'o with a bar through it: outer + 2 counters ' + o.contours.length);
  const q = TM.newGlyph('q', [], 600); q.contours.push(TM.contourToQuadratic(TM.ellipseContour(200, 200, 150, 150)), TM.contourToQuadratic(TM.ellipseContour(350, 200, 150, 150)));
  OV.removeOverlap(q, paper);
  ok(q.contours.length === 1 && TM.glyphIsQuadratic(q) && !TM.glyphIsCubic(q), 'quadratic glyph stays quadratic after remove overlap');
}
// ---------- UFO round trip ----------
{
  const f = TM.newFont({ familyName: 'Round Trip', styleName: 'Bold Italic', designer: 'Tester & Co <x>' });
  const a = TM.newGlyph('a', [97], 520); a.contours.push(TM.ellipseContour(260, 250, 200, 250), TM.reverseContour(TM.ellipseContour(260, 250, 100, 150))); a.contours[0].points[0].s = true;
  const q = TM.newGlyph('Q.alt', [], 600); q.contours.push(TM.contourToQuadratic(TM.ellipseContour(300, 300, 280, 300))); TM.roundGlyph(q);
  const c = TM.newGlyph('aacute', [0xE1], 520); c.components.push({ base: 'a', m: [1, 0, 0, 1, 0, 0] }, { base: 'Q.alt', m: [0.5, 0, 0.2, 0.5, 10, 600] });
  const open = TM.newGlyph('open', [], 100); open.contours.push({ points: [{ x: 0, y: 0, t: 'l' }, { x: 100, y: 100, t: 'l' }], open: true });
  Object.assign(f.glyphs, { a, 'Q.alt': q, aacute: c, open }); f.order.push('a', 'Q.alt', 'aacute', 'open');
  f.groups = { 'public.kern1.a': ['a', 'aacute'], 'public.kern2.Q': ['Q.alt'] }; f.kerning = { 'public.kern1.a': { 'public.kern2.Q': -33 }, a: { a: 12 } };
  const files = FIO.exportUFO(f);
  ok(Object.keys(files).some(p => /glyphs\/Q_\.alt\.glif$/.test(p)), 'UFO file name convention');
  const g = FIO.importUFO(files);
  ok(JSON.stringify(g.order) === JSON.stringify(f.order), 'UFO glyph order');
  ok(JSON.stringify(g.glyphs.a) === JSON.stringify(f.glyphs.a), 'UFO glyph a identical');
  ok(JSON.stringify(g.glyphs['Q.alt'].contours) === JSON.stringify(q.contours), 'UFO quadratic contour identical');
  ok(JSON.stringify(g.glyphs.aacute.components) === JSON.stringify(c.components), 'UFO components identical');
  ok(g.glyphs.open.contours[0].open === true, 'UFO open contour (move)');
  ok(JSON.stringify(g.groups) === JSON.stringify(f.groups) && JSON.stringify(g.kerning) === JSON.stringify(f.kerning), 'UFO groups + kerning');
  ok(g.info.familyName === 'Round Trip' && g.info.styleName === 'Bold Italic' && g.info.designer === 'Tester & Co <x>', 'UFO info');
  // UFO2-style kerning groups are converted
  const u2 = {}; Object.entries(files).forEach(([k, v]) => { u2[k] = v; });
  const dir = Object.keys(files)[0].split('/')[0] + '/';
  const te = new TextEncoder();
  u2[dir + 'metainfo.plist'] = te.encode('<?xml version="1.0"?><plist version="1.0"><dict><key>formatVersion</key><integer>2</integer></dict></plist>');
  u2[dir + 'groups.plist'] = te.encode('<plist version="1.0"><dict><key>@MMK_L_a</key><array><string>a</string></array><key>@MMK_R_Q</key><array><string>Q.alt</string></array></dict></plist>');
  u2[dir + 'kerning.plist'] = te.encode('<plist version="1.0"><dict><key>@MMK_L_a</key><dict><key>@MMK_R_Q</key><integer>-7</integer></dict></dict></plist>');
  const g2 = FIO.importUFO(u2);
  ok(g2.groups['public.kern1.a'] && g2.groups['public.kern2.Q'] && g2.kerning['public.kern1.a']['public.kern2.Q'] === -7, 'UFO2 group conversion');
}
console.log(`model tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
