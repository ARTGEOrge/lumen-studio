// node diagram/tests/drawio.test.js — draw.io import (plain, compressed, drawio.svg, hand-written) and round trips.
const assert = require('assert'), fs = require('fs'), path = require('path');
const D = require('../js/drawio.js'), M = require('../js/model.js'), X = require('../js/xml.js'), Sm = require('../js/sample.js'), S = require('../js/shapes.js');
const FF = require('../vendor/fflate.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const r2 = v => Math.round(v * 100) / 100;

// a structural signature of a document that ignores ids
function sig(doc) {
  return doc.pages.map(p => {
    const idx = new Map(p.cells.map((c, i) => [c.id, i]));
    const ref = e => e && e.id ? ['#' + idx.get(e.id), e.port ? e.port.map(r2) : null] : [r2(e.x), r2(e.y)];
    return { name: p.name, bg: p.bg, layers: p.layers.map(l => [l.name, l.visible, l.locked]), cells: p.cells.map(c => {
      const par = c.parent ? '#' + idx.get(c.parent) : null, layer = p.layers.findIndex(l => l.id === c.layer);
      if (c.kind === 'group') return ['group', par, layer];
      if (c.kind === 'edge') { const st = S.styleOf(c); return ['edge', ref(c.src), ref(c.tgt), c.pts.map(q => [r2(q.x), r2(q.y)]), c.text, r2(c.labelT), st.route, st.startArrow, st.endArrow, st.stroke, st.sw, st.dash || '', !!st.rounded, layer]; }
      const st = S.styleOf(c);
      return ['shape', c.shape, r2(c.x), r2(c.y), r2(c.w), r2(c.h), c.rot || 0, !!c.flipH, !!c.flipV, c.text, st.fill, st.fill2 || '', st.stroke, st.sw, st.dash || '', st.fontSize, st.fontColor, !!st.bold, !!st.italic, st.align, par, layer, st.header || 0];
    }) };
  });
}

t('sample document → .drawio → import is lossless (all 7 pages)', () => {
  const doc = Sm.sampleDoc();
  doc.pages[0].layers.push({ id: 'Lx', name: 'Annotations', visible: false, locked: true });
  const xml = D.exportDrawio(doc);
  assert.ok(xml.startsWith('<mxfile') && xml.includes('<diagram') && xml.includes('<mxGraphModel'));
  const back = D.importDrawio(xml);
  assert.strictEqual(back.report.approximated, 0);
  const a = sig(doc), b = sig(back.doc);
  for (let i = 0; i < a.length; i++) {
    assert.strictEqual(b[i].cells.length, a[i].cells.length, `page ${a[i].name} cell count`);
    for (let k = 0; k < a[i].cells.length; k++) assert.deepStrictEqual(b[i].cells[k], a[i].cells[k], `page ${a[i].name} cell ${k}`);
    assert.deepStrictEqual(b[i].layers, a[i].layers); assert.strictEqual(b[i].name, a[i].name);
  }
  console.log(`   ${a.reduce((s, p) => s + p.cells.length, 0)} cells on ${a.length} pages survived, ${(xml.length / 1024).toFixed(0)} KB`);
});

t('compressed export round-trips and uses drawio\'s deflate+base64 encoding', () => {
  const doc = Sm.sampleDoc();
  const xml = D.exportDrawio(doc, { compressed: true });
  const dg = X.findAll(X.parse(xml), 'diagram');
  assert.strictEqual(dg.length, 7); assert.ok(!xml.includes('<mxGraphModel'));
  // decode exactly the way diagrams.net does: atob → inflateRaw → decodeURIComponent
  const raw = FF.inflateSync(new Uint8Array(Buffer.from(dg[0].text.trim(), 'base64')));
  assert.ok(decodeURIComponent(Buffer.from(raw).toString('latin1')).startsWith('<mxGraphModel'));
  const back = D.importDrawio(xml);
  assert.strictEqual(back.report.compressed, 7);
  assert.deepStrictEqual(sig(back.doc), sig(doc));
});

t('hand-written diagrams.net file imports with the right shapes, edges and geometry', () => {
  const src = fs.readFileSync(path.join(__dirname, 'fixtures/handmade.drawio'), 'utf8');
  const { doc, report } = D.importDrawio(src);
  assert.strictEqual(doc.pages.length, 2); assert.strictEqual(doc.pages[0].name, 'Flow');
  const p = doc.pages[0], by = new Map(p.cells.map(c => [c.id.replace(/^d(.*)_.{4}$/, '$1'), c]));
  assert.strictEqual(by.get('start').shape, 'ellipse'); assert.strictEqual(by.get('start').style.fill, '#d5e8d4');
  assert.strictEqual(by.get('dec').shape, 'diamond'); assert.strictEqual(by.get('dec').text, 'Valid\ninput?'); assert.strictEqual(by.get('dec').style.fontSize, 14);
  const proc = by.get('proc'); assert.strictEqual(proc.shape, 'roundRect'); assert.strictEqual(proc.text, 'Process & store'); assert.strictEqual(proc.style.dash, 'dash'); assert.strictEqual(proc.style.italic, true);
  assert.strictEqual(by.get('db').shape, 'cylinder');
  const e2 = by.get('e2'); assert.deepStrictEqual(e2.src, { id: by.get('dec').id, port: [1, 0.5] }); assert.deepStrictEqual(e2.tgt, { id: proc.id, port: [0, 0.5] });
  assert.strictEqual(e2.style.endArrow, 'blockOpen'); assert.strictEqual(e2.style.stroke, '#FF0000'); assert.strictEqual(e2.style.sw, 2); assert.strictEqual(e2.text, 'yes'); assert.strictEqual(e2.labelT, 0.3); assert.strictEqual(e2.labelDy, 10);
  const e3 = by.get('e3'); assert.strictEqual(e3.style.route, 'curved'); assert.strictEqual(e3.style.startArrow, 'ovalOpen'); assert.strictEqual(e3.style.endArrow, 'diamond'); assert.strictEqual(e3.style.dash, 'dot'); assert.deepStrictEqual(e3.pts, [{ x: 440, y: 120 }]);
  assert.strictEqual(e3.text, 'writes', 'child edge label attached'); assert.strictEqual(e3.labelT, 0.75);
  assert.strictEqual(by.get('e1').style.route, 'orthogonal');
  const e4 = by.get('e4'); assert.deepStrictEqual(e4.tgt, { x: 100, y: 340 }); assert.strictEqual(e4.style.route, 'straight');
  // group with relative children
  assert.strictEqual(by.get('grp').kind, 'group'); assert.strictEqual(by.get('g1').parent, by.get('grp').id);
  assert.deepStrictEqual([by.get('g2').x, by.get('g2').y], [720, 100]); assert.strictEqual(by.get('g2').shape, 'terminator');
  // swimlane container with child
  assert.strictEqual(by.get('lane').shape, 'swimlane'); assert.strictEqual(by.get('lane').style.header, 30);
  assert.deepStrictEqual([by.get('inlane').x, by.get('inlane').y, by.get('inlane').parent], [60, 460, by.get('lane').id]);
  // UML class stack collapsed into one class shape; edge to a row re-targets the class
  const cls = by.get('cls'); assert.strictEqual(cls.shape, 'umlClass'); assert.strictEqual(cls.text, 'Customer\n--\n+ name: String\n--\n+ order(): Order');
  assert.ok(!by.has('cls1') && !by.has('cls3')); assert.strictEqual(by.get('toRow').tgt.id, cls.id);
  assert.strictEqual(by.get('srv').shape, 'server'); assert.strictEqual(by.get('gw').shape, 'bpmnExclusive');
  // html never survives as markup
  assert.strictEqual(by.get('evil').text, 'Hi'); assert.ok(!/</.test(by.get('evil').text));
  assert.strictEqual(by.get('weird').shape, 'rect'); assert.ok(report.approximated >= 1);
  // page 2: background, hidden layer, triangle direction (drawio default points east → rotated 90°)
  const q = doc.pages[1]; assert.strictEqual(q.bg, '#FFF8E7'); assert.strictEqual(q.showGrid, false); assert.strictEqual(q.grid, 20);
  assert.deepStrictEqual(q.layers.map(l => [l.name, l.visible]), [['Base', true], ['Notes', false]]);
  assert.strictEqual(q.cells[0].shape, 'triangle'); assert.strictEqual(q.cells[0].rot, 90); assert.strictEqual(q.cells[1].layer, q.layers[1].id);
  console.log(`   ${report.cells} cells, ${report.approximated} approximated`);
});

t('hand-written file survives import → export → import', () => {
  const src = fs.readFileSync(path.join(__dirname, 'fixtures/handmade.drawio'), 'utf8');
  const a = D.importDrawio(src).doc, b = D.importDrawio(D.exportDrawio(a)).doc;
  assert.deepStrictEqual(sig(b), sig(a));
});

t('compressed pages written by diagrams.net (deflateRaw of URI-encoded XML) decode', () => {
  const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Zürich ✓" style="ellipse;" vertex="1" parent="1"><mxGeometry x="5" y="6" width="70" height="40" as="geometry"/></mxCell></root></mxGraphModel>';
  const b64 = Buffer.from(FF.deflateSync(Buffer.from(encodeURIComponent(model), 'latin1'))).toString('base64');
  const { doc } = D.importDrawio(`<mxfile host="Electron"><diagram id="x" name="C">${b64}</diagram></mxfile>`);
  assert.strictEqual(doc.pages[0].cells[0].text, 'Zürich ✓'); assert.strictEqual(doc.pages[0].cells[0].shape, 'ellipse');
});

t('.drawio.svg (diagram in the content attribute) and bare mxGraphModel import', () => {
  const inner = D.exportDrawio(Sm.sampleDoc());
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" content="${X.escA(inner)}"><rect/></svg>`;
  assert.strictEqual(D.importDrawio(svg).doc.pages.length, 7);
  const bare = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="v" value="x" vertex="1" parent="1"><mxGeometry x="1" y="2" width="3" height="4" as="geometry"/></mxCell></root></mxGraphModel>';
  assert.deepStrictEqual(D.importDrawio(bare).doc.pages[0].cells.map(c => [c.shape, c.x, c.y, c.w, c.h]), [['rect', 1, 2, 3, 4]]);
});

t('exact stencils for shapes without a native drawio equivalent', () => {
  const doc = M.newDoc(); const c = M.makeShape('router', 0, 0); doc.pages[0].cells.push(c);
  const xml = D.exportDrawio(doc), st = /style="([^"]*)"/.exec(xml.split('<mxCell id="' + c.id)[1])[1];
  const m = /shape=stencil\(([^)]+)\)/.exec(st); assert.ok(m, 'stencil used');
  const stencil = D.decompress(m[1]); const el = X.parse(stencil).children[0];
  assert.strictEqual(el.name, 'shape'); assert.ok(X.find(el, 'background').children.length && X.findAll(el, 'curve').length >= 3);
  assert.ok(st.includes('lumenShape=router'));
});

t('broken / hostile input is rejected or sanitised', () => {
  assert.throws(() => D.importDrawio('<html><body>nope</body></html>'), /No draw.io diagram/);
  assert.throws(() => D.importDrawio('<mxfile><diagram>!!!notbase64!!!</diagram></mxfile>'));
  // entity tricks are not expanded
  const { doc } = D.importDrawio('<!DOCTYPE x [<!ENTITY a "AAAA">]><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="&a;&a;" vertex="1" parent="1"><mxGeometry width="10" height="10" as="geometry"/></mxCell><mxCell id="3" edge="1" parent="1" source="2" target="404"><mxGeometry relative="1" as="geometry"/></mxCell></root></mxGraphModel>');
  assert.strictEqual(doc.pages[0].cells[0].text, '&a;&a;');
  assert.deepStrictEqual(doc.pages[0].cells[1].tgt, { x: 0, y: 0 }, 'dangling target becomes a free end');
  // .ldia normalisation
  const bad = M.normalize({ pages: [{ cells: [{ id: 'a', kind: 'shape', shape: '<script>', x: 'NaN', w: -5, style: { fill: 'url(javascript:alert(1))', fontSize: 12, 'on load': 1 } }, { id: 'a', kind: 'edge', src: { id: 'zzz' }, tgt: 5 }, { kind: 'shape', image: 'javascript:alert(1)' }] }] });
  const [c0, c1, c2] = bad.pages[0].cells;
  assert.strictEqual(c0.shape, 'rect'); assert.strictEqual(c0.x, 0); assert.strictEqual(c0.w, 1); assert.deepStrictEqual(c0.style, { fontSize: 12 });
  assert.notStrictEqual(c1.id, 'a'); assert.deepStrictEqual(c1.src, { x: 0, y: 0 }); assert.strictEqual(c2.image, undefined);
});

console.log(`\n${n} draw.io tests passed`);
