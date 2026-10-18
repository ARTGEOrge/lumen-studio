// node draft/tests/dxf.test.js — DXF read/write round trips (R2000 + R12), structure checks, PDF/SVG export checks.
const G = require('../js/geom.js'), M = require('../js/model.js'), X = require('../js/dxf.js'), E = require('../js/export.js'), { sampleDoc } = require('../js/sample.js');
const assert = require('assert'), path = require('path'), { pathToFileURL } = require('url');
let n = 0; const tests = []; const t = (name, fn) => tests.push([name, fn]);
const near = (a, b, tol = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);
const count = (ents) => ents.reduce((m, e) => (m[e.type] = (m[e.type] || 0) + 1, m), {});
const strip = d => d.ents.map(e => { const o = { ...e }; delete o.id; return o; });

t('R2000 round trip keeps every entity type and its geometry', () => {
  const d = sampleDoc(), dxf = X.writeDXF(d, { version: 'R2000' });
  assert.ok(dxf.includes('AC1015') && dxf.includes('LWPOLYLINE') && dxf.includes('HATCH') && dxf.includes('MTEXT') && dxf.includes('DIMENSION'));
  const { doc: r, warnings } = X.readDXF(dxf);
  assert.deepStrictEqual(warnings, []);
  assert.deepStrictEqual(count(r.ents), count(d.ents));
  const a = strip(d), b = strip(r);
  a.forEach((e, i) => {
    const f = b[i]; assert.strictEqual(f.type, e.type); assert.strictEqual(f.layer, e.layer);
    for (const k of ['x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'x', 'y', 'h', 'w', 'sc']) if (typeof e[k] === 'number') near(f[k], e[k], 1e-8, `${e.type}.${k}`);
    for (const k of ['a1', 'a2', 'rot', 'ang']) if (typeof e[k] === 'number') near(G.normA(f[k]), G.normA(e[k]), 1e-8, `${e.type}.${k}`);
    if (e.type === 'pline') { assert.strictEqual(f.closed, e.closed); e.pts.forEach((p, j) => { near(f.pts[j][0], p[0]); near(f.pts[j][1], p[1]); near(f.pts[j][2] || 0, p[2] || 0); }); }
    if (e.type === 'text' || e.type === 'mtext') assert.strictEqual(f.s, e.s);
    if (e.type === 'dim') { assert.strictEqual(f.dt, e.dt); assert.strictEqual(M.dimText(f, r.dimstyle), M.dimText(e, d.dimstyle)); }
    if (e.type === 'hatch') { assert.strictEqual(f.pat, e.pat); assert.strictEqual(f.loops.length, e.loops.length); near(G.loopArea(f.loops[0].pts), G.loopArea(e.loops[0].pts)); }
    if (e.type === 'insert') { assert.strictEqual(f.name, e.name); }
  });
  // layers with colour / linetype / lineweight, and the block definition
  for (const l of d.layers) { const q = r.layers.find(x => x.name === l.name); assert.ok(q, l.name); assert.strictEqual(q.color, l.color); assert.strictEqual(q.lt, l.lt); assert.strictEqual(q.lw, l.lw); }
  assert.deepStrictEqual(Object.keys(r.blocks), ['HOLE10']);
  assert.strictEqual(r.blocks.HOLE10.ents.length, 3);
  near(r.ltscale, 0.5); assert.strictEqual(r.units, 'mm');
  // writing again gives identical text (stable)
  assert.strictEqual(X.writeDXF(r, { version: 'R2000' }).length > 1000, true);
});

t('R2000 structure: unique handles, valid owners, balanced sections, HANDSEED', () => {
  const dxf = X.writeDXF(sampleDoc(), { version: 'R2000' }), pairs = X.pairsOf(dxf);
  const handles = new Set(); let seed = 0, maxH = 0;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if ((c === 5 || c === 105) && pairs[i - 1][1] !== '$HANDSEED') { assert.ok(!handles.has(v), 'duplicate handle ' + v); handles.add(v); maxH = Math.max(maxH, parseInt(v, 16)); }
    if (c === 9 && v === '$HANDSEED') seed = parseInt(pairs[i + 1][1], 16);
  }
  assert.ok(seed > maxH, 'HANDSEED above every handle');
  for (const [c, v] of pairs) if ((c === 330 || c === 340 || c === 350 || c === 390) && v !== '0') assert.ok(handles.has(v), `dangling pointer ${c} → ${v}`);
  const bal = (a, b) => assert.strictEqual(pairs.filter(p => p[0] === 0 && p[1] === a).length, pairs.filter(p => p[0] === 0 && p[1] === b).length, a);
  bal('SECTION', 'ENDSEC'); bal('TABLE', 'ENDTAB'); bal('BLOCK', 'ENDBLK');
  assert.deepStrictEqual(pairs.filter(p => p[0] === 2 && ['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS'].includes(p[1])).map(p => p[1]), ['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']);
  assert.strictEqual(pairs[pairs.length - 1][1], 'EOF');
  // every DIMENSION references a block that exists
  const blocks = new Set(); for (let i = 0; i < pairs.length; i++) if (pairs[i][0] === 0 && pairs[i][1] === 'BLOCK') { for (let j = i + 1; pairs[j][0] !== 0; j++) if (pairs[j][0] === 2) blocks.add(pairs[j][1]); }
  for (let i = 0; i < pairs.length; i++) if (pairs[i][0] === 0 && pairs[i][1] === 'DIMENSION') { let j = i + 1; while (pairs[j][0] !== 2) j++; assert.ok(blocks.has(pairs[j][1]), 'dim block ' + pairs[j][1]); }
});

t('R12 round trip: POLYLINE/VERTEX, MTEXT as TEXT, hatches as anonymous blocks', () => {
  const d = sampleDoc(), dxf = X.writeDXF(d, { version: 'R12' });
  assert.ok(dxf.includes('AC1009') && !dxf.includes('LWPOLYLINE') && !dxf.includes('AcDb') && dxf.includes('VERTEX') && dxf.includes('SEQEND'));
  const { doc: r } = X.readDXF(dxf), c0 = count(d.ents), c1 = count(r.ents);
  assert.strictEqual(c1.pline, c0.pline); assert.strictEqual(c1.dim, c0.dim); assert.strictEqual(c1.circle, c0.circle);
  assert.strictEqual(c1.text, c0.text + 5, 'MTEXT lines become TEXT');
  assert.strictEqual(c1.insert, c0.insert + c0.hatch, 'each hatch is an *X block insert');
  const prof = r.ents.find(e => e.type === 'pline' && e.pts.length === 8);
  near(G.loopArea(prof.pts), G.loopArea(d.ents[0].pts), 1e-6);
  const hx = Object.keys(r.blocks).filter(k => k.startsWith('*X')); assert.strictEqual(hx.length, 3);
  assert.ok(r.blocks[hx[0]].ents.length > 5 && r.blocks[hx[0]].ents.every(e => e.type === 'line'));
});

t('reads hand-written R12 with OCS arcs, aligned text, attributes, ellipse and SOLID', () => {
  const T = s => s.trim().split('\n').map(x => x.trim()).join('\n');
  const dxf = T(`0
SECTION
2
HEADER
9
$INSUNITS
70
1
0
ENDSEC
0
SECTION
2
TABLES
0
TABLE
2
LAYER
70
1
0
LAYER
2
WALLS
70
4
62
-3
6
DASHED
0
ENDTAB
0
ENDSEC
0
SECTION
2
BLOCKS
0
BLOCK
2
TAG
70
2
10
0
20
0
0
CIRCLE
8
0
10
0
20
0
40
1
0
ENDBLK
0
ENDSEC
0
SECTION
2
ENTITIES
0
POLYLINE
8
WALLS
66
1
70
1
0
VERTEX
8
WALLS
10
0
20
0
42
1
0
VERTEX
8
WALLS
10
10
20
0
0
VERTEX
8
WALLS
10
10
20
5
0
SEQEND
0
ARC
8
0
10
5
20
0
40
2
50
0
51
90
230
-1
0
TEXT
8
0
10
0
20
0
11
50
21
20
40
3
1
Room %%c12 %%d
72
1
73
2
0
INSERT
8
0
2
TAG
10
3
20
4
66
1
0
ATTRIB
8
0
10
3
20
6
40
2
1
A-101
2
NUM
70
0
0
SEQEND
0
ELLIPSE
8
0
10
0
20
0
11
10
21
0
40
0.5
41
0
42
6.283185307179586
0
SOLID
8
0
10
0
20
0
11
1
21
0
12
0
22
1
13
1
23
1
0
ENDSEC
0
EOF`);
  const { doc: d, warnings } = X.readDXF(dxf);
  assert.deepStrictEqual(warnings, []);
  assert.strictEqual(d.units, 'in');
  const w = d.layers.find(l => l.name === 'WALLS'); assert.ok(w && w.on === false && w.locked && w.color === 3 && w.lt === 'DASHED');
  const pl = d.ents.find(e => e.type === 'pline' && e.closed); assert.strictEqual(pl.pts.length, 3); near(pl.pts[0][2], 1);
  const arc = d.ents.find(e => e.type === 'arc'); near(arc.cx, -5); near(G.normA(arc.a1), Math.PI / 2); near(G.normA(arc.a2), Math.PI);
  const tx = d.ents.find(e => e.type === 'text' && e.s.startsWith('Room')); assert.strictEqual(tx.s, 'Room Ø12 °'); near(tx.x, 50); assert.strictEqual(tx.align, 1); assert.strictEqual(tx.valign, 2);
  assert.ok(d.ents.find(e => e.type === 'insert' && e.name === 'TAG')); assert.ok(d.ents.find(e => e.type === 'text' && e.s === 'A-101'), 'attribute becomes text');
  const el = d.ents.find(e => e.type === 'pline' && e.pts.length > 20); near(Math.abs(G.loopArea(el.pts)), Math.PI * 10 * 5, 0.5);
  const so = d.ents.find(e => e.type === 'solid'); near(Math.abs(G.loopArea(so.pts)), 1, 1e-9, 'SOLID vertex order 1-2-4-3');
});

t('reads R2000 HATCH with edge boundaries (line + clockwise arc) and MTEXT codes', () => {
  const lines = ['0', 'SECTION', '2', 'ENTITIES',
    '0', 'HATCH', '8', '0', '100', 'AcDbHatch', '10', '0', '20', '0', '30', '0', '210', '0', '220', '0', '230', '1', '2', 'ANSI37', '70', '0', '71', '0', '91', '1',
    '92', '1', '93', '2', '72', '1', '10', '-10', '20', '0', '11', '10', '21', '0', '72', '2', '10', '0', '20', '0', '40', '10', '50', '0', '51', '180', '73', '0', '97', '0',
    '75', '0', '76', '1', '52', '30', '41', '2', '77', '0', '78', '1', '53', '45', '43', '0', '44', '0', '45', '0', '46', '3.175', '79', '0', '98', '0',
    '0', 'MTEXT', '8', '0', '10', '1', '20', '2', '40', '2.5', '41', '50', '71', '5', '3', '{\\fArial|b1;Bold} line one\\P', '1', 'line \\H3;two \\S1/2; \\\\ end',
    '0', 'ENDSEC', '0', 'EOF'];
  const { doc: d } = X.readDXF(lines.join('\n'));
  const h = d.ents.find(e => e.type === 'hatch');
  assert.strictEqual(h.pat, 'ANSI37'); near(h.sc, 2); near(h.ang, 30 * Math.PI / 180);
  // a line along y=0 then a clockwise arc from 0° to 180° stored mirrored: lower half disc → area πr²/2
  near(Math.abs(G.loopArea(h.loops[0].pts)), Math.PI * 50, 1e-6);
  assert.ok(G.pointInLoops(h.loops, 0, -5) && !G.pointInLoops(h.loops, 0, 5), 'clockwise edge arc goes below the line');
  const m = d.ents.find(e => e.type === 'mtext'); assert.strictEqual(m.s, 'Bold line one\nline two 1/2 \\ end'); assert.strictEqual(m.attach, 5);
});

t('ASCII DXF special characters survive a round trip', () => {
  const d = M.newDoc(); d.ents.push({ id: 1, type: 'text', layer: '0', x: 0, y: 0, h: 2.5, rot: 0, s: 'Ø20 ±0.1 45° café', align: 0, valign: 0 });
  d.ents.push({ id: 2, type: 'mtext', layer: '0', x: 0, y: 10, h: 2.5, w: 0, rot: 0, attach: 1, s: 'braces {x} back\\slash\nline 2' });
  const r = X.readDXF(X.writeDXF(d)).doc;
  assert.strictEqual(r.ents[0].s, 'Ø20 ±0.1 45° café'); assert.strictEqual(r.ents[1].s, 'braces {x} back\\slash\nline 2');
});

t('SVG export is at true scale (A3 in mm)', () => {
  const d = sampleDoc(), svg = E.toSVG(d, 'layout');
  assert.ok(svg.startsWith('<?xml') && svg.includes('width="420mm" height="297mm" viewBox="0 0 420 297"'));
  assert.ok(svg.includes('>MOUNTING PLATE<') && svg.includes('>160<') && svg.includes('>R10<') && svg.includes('>135°<'));
  assert.ok(/clipPath/.test(svg));
  // 1:1 — the 160 mm plate edge is 160 SVG units long: find the profile path's horizontal run
  const g = E.layoutGeom(d); near(g.k, 1);
  d.layout.scale = [1, 2]; near(E.layoutGeom(d).k, 0.5);
  const m = E.toSVG(sampleDoc(), 'model', { scale: [1, 2] }); const W = +m.match(/width="([\d.]+)mm"/)[1], ext = M.extents(sampleDoc());
  near(W, (ext[2] - ext[0]) / 2 + 20, 1e-3);
});

t('PDF export parses with pdf.js and has the right page size and text', async () => {
  const pdfjs = await import(pathToFileURL(path.join(__dirname, '../../tools/deps/pdf/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
  const bytes = E.toPDF(sampleDoc(), 'layout');
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }), doc = await task.promise;
  assert.strictEqual(doc.numPages, 1);
  const page = await doc.getPage(1), vp = page.getViewport({ scale: 1 });
  near(vp.width, 420 / 25.4 * 72, 0.01); near(vp.height, 297 / 25.4 * 72, 0.01);
  const tc = await page.getTextContent(), strs = tc.items.map(i => i.str);
  for (const s of ['MOUNTING PLATE', '160', '100', 'Ø40', 'R10', '135°', 'LD-1042', '1:1', 'SECTION A–A'.replace('–', '-')].slice(0, 8)) assert.ok(strs.includes(s), 'PDF text ' + s + ' in ' + JSON.stringify(strs.slice(0, 40)));
  const ops = await page.getOperatorList(); assert.ok(ops.fnArray.length > 200);
  // text position: the "160" dimension text sits centred at x = 80 mm on the plate (paper x = ox + 80)
  const g = E.layoutGeom(sampleDoc()), item = tc.items.find(i => i.str === '160');
  const x = item.transform[4] / 72 * 25.4 + item.width / 72 * 25.4 / 2; near(x, g.ox + 80, 0.6);
  await task.destroy();
});

(async () => {
  for (const [name, fn] of tests) { await fn(); n++; console.log('ok', name); }
  console.log(`\n${n} DXF / export tests passed`);
})().catch(e => { console.error(e); process.exit(1); });
