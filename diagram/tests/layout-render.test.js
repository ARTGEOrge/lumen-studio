// node diagram/tests/layout-render.test.js — auto-layout, SVG rendering, PDF export, .ldia round trip.
const assert = require('assert');
const M = require('../js/model.js'), L = require('../js/layout.js'), Rn = require('../js/render.js'), Sm = require('../js/sample.js'), P = require('../js/pdfexport.js'), PL = require('../vendor/pdf-lib.min.js'), S = require('../js/shapes.js'), G = require('../js/geom.js');
let n = 0; const tests = []; const t = (name, fn) => tests.push([name, fn]);
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function orgGraph() {
  const p = M.newPage(), add = () => { const c = M.makeShape('orgCard', Math.random() * 500, Math.random() * 500); p.cells.push(c); return c; };
  const link = (a, b) => p.cells.push(M.makeEdge({ id: a.id }, { id: b.id }));
  const root = add(), kids = [add(), add(), add()];
  kids.forEach(k => link(root, k));
  const grand = []; kids.forEach((k, i) => { for (let j = 0; j < [3, 1, 4][i]; j++) { const g = add(); link(k, g); grand.push([k, g]); } });
  return { p, root, kids, grand };
}

t('tree layout: parents centred above children, levels ordered, no overlaps', () => {
  const { p, root, kids, grand } = orgGraph();
  assert.strictEqual(L.tree(p, { dir: 'TB', gapX: 20, gapY: 50 }), 1 + 3 + 8);
  const ctr = c => c.x + c.w / 2;
  const kc = kids.map(ctr); assert.ok(Math.abs(ctr(root) - (Math.min(...kc) + Math.max(...kc)) / 2) < 1, 'root centred');
  for (const k of kids) { assert.ok(k.y >= root.y + root.h + 49); const gs = grand.filter(([a]) => a === k).map(([, g]) => g); const gc = gs.map(ctr); assert.ok(Math.abs(ctr(k) - (Math.min(...gc) + Math.max(...gc)) / 2) < 1, 'child centred over its subtree'); gs.forEach(g => assert.ok(g.y >= k.y + k.h + 49)); }
  const shapes = p.cells.filter(c => c.kind === 'shape');
  for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) assert.ok(!overlap(shapes[i], shapes[j]), 'overlap');
});

t('tree layout left-to-right puts depth on the x axis', () => {
  const { p, root, kids } = orgGraph();
  L.tree(p, { dir: 'LR' });
  kids.forEach(k => assert.ok(k.x > root.x + root.w));
});

t('hierarchical layout: edges flow downward, cycles handled, crossings reduced, no overlaps', () => {
  const p = M.newPage(), N = [];
  for (let i = 0; i < 12; i++) { const c = M.makeShape(i % 3 ? 'process' : 'decision', (i * 137) % 600, (i * 91) % 500); p.cells.push(c); N.push(c); }
  const E = [[0, 1], [0, 2], [1, 3], [2, 4], [3, 5], [4, 5], [5, 6], [6, 7], [6, 8], [7, 9], [8, 9], [9, 10], [10, 11], [9, 3], [2, 7], [1, 8]];
  E.forEach(([a, b]) => p.cells.push(M.makeEdge({ id: N[a].id }, { id: N[b].id })));
  const before = L.crossingCount(p);
  L.layered(p, { dir: 'TB', gapX: 40, gapY: 60 });
  const after = L.crossingCount(p);
  let down = 0; for (const [a, b] of E) if (N[b].y > N[a].y) down++;
  assert.ok(down >= E.length - 1, `${down}/${E.length} edges point down (one back edge allowed)`);
  for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) assert.ok(!overlap(N[i], N[j]), 'overlap');
  assert.ok(after <= before, `crossings ${before} → ${after}`);
  console.log(`   crossings ${before} → ${after}, ${down}/${E.length} edges downward`);
});

t('every shape in every library renders to valid primitives', () => {
  let count = 0;
  for (const id of S.order) {
    const c = M.makeShape(id, 10, 20, { text: 'Label text that wraps', rot: 15 });
    const prims = Rn.shapePrims(c);
    assert.ok(prims.length, id);
    for (const pr of prims) if (pr.k === 'path') { assert.ok(/^M/.test(pr.d) && !/NaN|undefined|Infinity/.test(pr.d), id + ' path ' + pr.d.slice(0, 60)); G.flatten(pr.d); }
    count++;
  }
  console.log(`   ${count} shapes`);
});

t('sample pages render to SVG with text, arrows and gradients', () => {
  const doc = Sm.sampleDoc();
  for (const p of doc.pages) {
    const r = Rn.pageSVG(p);
    assert.ok(r.svg.startsWith('<?xml') && r.svg.endsWith('</svg>'));
    assert.ok(!/NaN|undefined/.test(r.svg), p.name + ' has NaN');
    assert.strictEqual((r.svg.match(/<g data-cell=/g) || []).length, p.cells.filter(c => c.kind !== 'group').length);
  }
  const svg0 = Rn.pageSVG(doc.pages[0]).svg;
  assert.ok(svg0.includes('>Customer places order<') || svg0.includes('>Customer places<'), 'wrapped text present');
  assert.ok(svg0.includes('linearGradient'), 'gradients');
  assert.ok(/text-anchor="middle"/.test(svg0));
});

t('text wrapping uses font metrics (Helvetica widths)', () => {
  const lines = Rn.wrap('The quick brown fox jumps over the lazy dog', 100, 12, 'sans');
  assert.ok(lines.length >= 3 && lines.every(l => l.w <= 100.01), JSON.stringify(lines));
  assert.ok(Math.abs(Rn.wrap('MMMM', 0, 10, 'sans')[0].w - 33.32) < 0.01);
});

t('.ldia save → open is lossless', () => {
  const doc = Sm.sampleDoc(), json = M.serialize(doc), back = M.normalize(JSON.parse(json));
  assert.deepStrictEqual(JSON.parse(M.serialize(back)).pages, JSON.parse(json).pages);
});

t('vector PDF export: one page per diagram page, text is real text', async () => {
  const doc = Sm.sampleDoc();
  const { bytes, drawn } = await P.exportPDF(doc.pages, { title: 'Sample', stats: true });
  assert.strictEqual(String.fromCharCode(...bytes.slice(0, 5)), '%PDF-');
  const pdf = await PL.PDFDocument.load(bytes);
  assert.strictEqual(pdf.getPageCount(), 7);
  const [w, h] = [pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()];
  const vb = Rn.pageSVG(doc.pages[0]).box; assert.ok(Math.abs(w - vb.w * 0.75) < 1 && Math.abs(h - vb.h * 0.75) < 1, 'page sized to the diagram');
  assert.ok(drawn > 300, 'drawing operations: ' + drawn);
  const fonts = new Set(); for (const [, obj] of pdf.context.enumerateIndirectObjects()) { const m = /\/BaseFont \/([\w-]+)/.exec(obj.toString()); if (m) fonts.add(m[1]); }
  assert.ok(fonts.has('Helvetica') && fonts.has('Helvetica-Bold'), 'standard fonts used for text: ' + [...fonts]);
  const a4 = await P.exportPDF([doc.pages[1]], { size: 'a4' }), p4 = await PL.PDFDocument.load(a4);
  assert.deepStrictEqual([Math.round(p4.getPage(0).getWidth()), Math.round(p4.getPage(0).getHeight())], [842, 595], 'A4 landscape for a wide page');
  console.log(`   ${(bytes.length / 1024).toFixed(0)} KB, ${drawn} paths/text runs`);
});

(async () => { for (const [name, fn] of tests) { await fn(); n++; console.log('ok', name); } console.log(`\n${n} layout/render/pdf tests passed`); })().catch(e => { console.error(e); process.exit(1); });
