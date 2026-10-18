// node stats/tests/data.test.js — data model, CSV/XLSX import, expressions, recode, filters, project format, report export.
const D = require('../js/data.js'), A = require('../js/analyses.js'), R = require('../js/report.js'), X = require('../js/samples.js'), C = require('../js/charts.js');
const XLSX = require('../vendor/xlsx.full.min.js'), assert = require('assert');
let n = 0; const tests = [];
const t = (name, fn) => tests.push([name, fn]);

t('CSV parsing: quotes, embedded newlines, CRLF, BOM, delimiter detection', () => {
  const rows = D.parseCSV('﻿name,score,note\r\n"Smith, J",12.5,"said ""hi""\nthen left"\r\nLee,7,\r\n');
  assert.deepStrictEqual(rows, Object.assign([['name', 'score', 'note'], ['Smith, J', '12.5', 'said "hi"\nthen left'], ['Lee', '7', '']], { delim: ',' }));
  assert.strictEqual(D.detectDelim('a;b;c\n1;2;3\n4;5;6'), ';'); assert.strictEqual(D.detectDelim('a\tb\n1\t2'), '\t');
});
t('type inference: numeric, date, string, categorical; decimal comma; empty → missing', () => {
  const rows = D.parseCSV('id;when;city;w\n1;2026-01-05;Oslo;1,5\n2;2026-02-10;Graz;2,25\n3;;Oslo;\n4;2026-03-01;Oslo;4\n5;2026-03-02;Graz;5', ';');
  const d = D.fromRows(rows, { header: true, decimalComma: true });
  assert.deepStrictEqual(d.vars.map(v => v.type), ['numeric', 'date', 'categorical', 'numeric']);
  assert.deepStrictEqual(d.cols[3], [1.5, 2.25, null, 4, 5]); assert.strictEqual(d.cols[1][2], null);
  assert.strictEqual(D.dateStr(d.cols[1][0]), '2026-01-05');
  assert.deepStrictEqual(d.vars[2].values, { 1: 'Graz', 2: 'Oslo' }); assert.deepStrictEqual(d.cols[2], [2, 1, 2, 2, 1]);
  const h = D.fromRows([['First name', '2x', 'a-b'], ['x', 'y', 'z']]); assert.deepStrictEqual(h.vars.map(v => v.name), ['First_name', 'v2x', 'a_b']); assert.strictEqual(h.vars[0].label, 'First name');
});
t('CSV export round trip (values and value labels)', () => {
  const d = X.plantDoc(), s = D.toCSV(d), back = D.fromRows(D.parseCSV(s), { autoCategorical: false });
  assert.deepStrictEqual(back.cols[0], d.cols[0]); assert.deepStrictEqual(back.cols[1], d.cols[1]);
  assert(D.toCSV(d, { labels: true }).includes('4.17,Control'));
});
t('XLSX import and export through SheetJS (dates become date variables)', () => {
  const ws = XLSX.utils.aoa_to_sheet([['Name', 'Born', 'Score', 'Grade'], ['Ann', new Date(1990, 4, 17), 88.5, 'A'], ['Bo', new Date(1985, 0, 2), 71, 'B'], ['Cy', null, 93, 'A'], ['Di', new Date(2001, 11, 31), 64.25, 'C'], ['Ed', new Date(1999, 6, 1), 80, 'B']], { cellDates: true });
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'S'); const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  const wb2 = XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true }), rows = XLSX.utils.sheet_to_json(wb2.Sheets.S, { header: 1, raw: true, defval: null });
  const d = D.fromRows(rows);
  assert.deepStrictEqual(d.vars.map(v => v.type), ['string', 'date', 'numeric', 'string']);   // 3 distinct grades in 5 rows stay text (auto-categorical needs repeats)
  assert.strictEqual(D.dateStr(d.cols[1][0]), '1990-05-17'); assert.strictEqual(d.cols[1][2], null); assert.deepStrictEqual(d.cols[2], [88.5, 71, 93, 64.25, 80]);
});
t('expressions: arithmetic, precedence, functions, strings, dates, missing propagation', () => {
  const d = { vars: [D.newVar('a'), D.newVar('b'), D.newVar('s', 'string'), D.newVar('d', 'date'), D.newVar('g', 'categorical', { missing: [9] })], n: 4,
    cols: [[1, 2, null, 4], [10, 20, 30, 40], ['x', 'Oslo', '', 'Graz'], [D.ymd(2026, 1, 5), D.ymd(2025, 12, 31), null, D.ymd(2024, 2, 29)], [1, 9, 2, 1]] };
  const ev = s => D.evaluate(s, d);
  assert.deepStrictEqual(ev('a + b * 2'), [21, 42, null, 84]);
  assert.deepStrictEqual(ev('(a + b) * 2 ** 2'), [44, 88, null, 176]);
  assert.deepStrictEqual(ev('-a ** 2'), [-1, -4, null, -16]);
  assert.deepStrictEqual(ev('MEAN(a, b)'), [5.5, 11, 30, 22]);
  assert.deepStrictEqual(ev('SUM(a, b) > 20 AND NOT MISSING(a)'), [0, 1, 0, 1]);
  assert.deepStrictEqual(ev('a > 1 OR b > 25'), [0, 1, 1, 1]);   // missing OR true = true
  assert.deepStrictEqual(ev('a > 1 AND b > 25'), [0, 0, null, 1]);
  assert.deepStrictEqual(ev('IF(a >= 2, "hi", "lo")'), ['lo', 'hi', null, 'hi']);
  assert.deepStrictEqual(ev('s = "Oslo"'), [0, 1, 0, 0]);
  assert.deepStrictEqual(ev('CONCAT(UPCASE(s), "-", a)'), ['X-1', 'OSLO-2', '-', 'GRAZ-4']);
  assert.deepStrictEqual(ev('YEAR(d)'), [2026, 2025, null, 2024]);
  assert.deepStrictEqual(ev('DATEDIFF(d, DATE(2025, 12, 31))'), [5, 0, null, -671]);
  assert.deepStrictEqual(ev('g'), [1, null, 2, 1], 'user-missing 9 is missing');
  assert.deepStrictEqual(ev('VALUE(g)'), [1, 9, 2, 1]);
  assert.deepStrictEqual(ev('LAG(b)'), [null, 10, 20, 30]);
  assert.deepStrictEqual(ev('$CASENUM'), [1, 2, 3, 4]);
  assert.deepStrictEqual(ev('ROUND(b / 3, 2)'), [3.33, 6.67, 10, 13.33]);
  assert.deepStrictEqual(ev('ANY(a, 2, 4)'), [0, 1, null, 1]);
  assert.deepStrictEqual(ev('a / 0'), [null, null, null, null]);
  assert.strictEqual(+ev('CDF.NORMAL(1.96, 0, 1)')[0].toFixed(6), 0.975002);
  assert.deepStrictEqual(ev('a ~= 2 & b <> 30'), [1, 0, 0, 1]);   // missing AND false = false
});
t('expression errors are reported with a position and never execute code', () => {
  const d = { vars: [D.newVar('a')], cols: [[1]], n: 1 };
  assert.throws(() => D.compile('a +', d), /ends too early/);
  assert.throws(() => D.compile('nosuch * 2', d), /Unknown variable “nosuch”/);
  assert.throws(() => D.compile('alert(1)', d), /Unknown function “alert”/);
  assert.throws(() => D.compile('constructor.constructor("return 1")()', d), /Unknown|Unexpected/);
  assert.throws(() => D.compile('a ; 1', d), /Unexpected character/);
  assert.throws(() => D.compile('__proto__', d), /Unknown variable/);
});
t('recode: values, ranges, lowest/highest, missing, else-copy; into same vs different', () => {
  const meta = D.newVar('x', 'numeric', { missing: [99] }), col = [1, 5, 10, 15, 99, null, 3];
  const rules = [{ from: { k: 'lowest', hi: 4 }, to: { k: 'value', v: 1 } }, { from: { k: 'range', lo: 5, hi: 10 }, to: { k: 'value', v: 2 } }, { from: { k: 'highest', lo: 11 }, to: { k: 'value', v: 3 } }, { from: { k: 'missing' }, to: { k: 'sysmis' } }];
  assert.deepStrictEqual(D.recodeColumn(col, meta, rules), [1, 2, 2, 3, null, null, 1]);
  assert.deepStrictEqual(D.recodeColumn(col, meta, [{ from: { k: 'value', v: 5 }, to: { k: 'value', v: 50 } }], { same: true }), [1, 50, 10, 15, 99, null, 3]);
  assert.deepStrictEqual(D.recodeColumn(col, meta, [{ from: { k: 'value', v: 5 }, to: { k: 'value', v: 50 } }, { from: { k: 'else' }, to: { k: 'copy' } }]), [1, 50, 10, 15, 99, null, 3]);
  assert.deepStrictEqual(D.recodeColumn(['a', 'b', ''], D.newVar('s', 'string'), [{ from: { k: 'value', v: 'b' }, to: { k: 'value', v: 'B' } }, { from: { k: 'sysmis' }, to: { k: 'value', v: '?' } }], { same: true }), ['a', 'B', '?']);
});
t('filters select cases for analyses (Select cases)', () => {
  const d = X.mtcarsDoc(); d.filter = { expr: 'am = 1 & hp > 100', active: true };
  const m = D.filterMask(d); assert.strictEqual(m.reduce((a, b) => a + b, 0), 7);
  const it = A.descriptives(d, { vars: [1], stats: ['n', 'mean'] });
  assert.strictEqual(it.blocks[0].rows[0][1], 7); assert.match(it.sub, /Filter: am = 1 & hp > 100 \(7 of 32 cases\)/);
});
t('type conversion: string → categorical builds labelled codes; numeric → string → numeric', () => {
  const v = D.newVar('c', 'string'), r = D.convertColumn(['b', 'a', '', 'b'], v, 'categorical');
  assert.deepStrictEqual(r.col, [2, 1, null, 2]); assert.deepStrictEqual(r.meta.values, { 1: 'a', 2: 'b' });
  const s = D.convertColumn([1.5, null, 3], D.newVar('n', 'numeric', { decimals: 1 }), 'string'); assert.deepStrictEqual(s.col, ['1.5', '', '3.0']);
  assert.deepStrictEqual(D.convertColumn(s.col, D.newVar('t', 'string'), 'numeric').col, [1.5, null, 3]);
});
t('.lstat project round trip and validation of untrusted files', () => {
  const d = X.demoDoc(); d.filter = { expr: 'age > 30', active: true };
  d.output = [A.descriptives(d, { vars: [3] })]; delete d.output[0].newCols;
  const back = D.deserialize(D.serialize(d));
  assert.strictEqual(back.n, 150); assert.deepStrictEqual(back.vars.map(v => v.name), d.vars.map(v => v.name)); assert.deepStrictEqual(back.cols[7], d.cols[7]);
  assert.deepStrictEqual(back.vars[9].missing, [9]); assert.strictEqual(back.vars[1].values[2], 'Low dose'); assert.strictEqual(back.filter.expr, 'age > 30'); assert.strictEqual(back.output.length, 1);
  assert.throws(() => D.deserialize('{"format":"other"}'), /not a Lumen Stats project/);
  assert.throws(() => D.deserialize('not json'), /invalid JSON/);
  const evil = D.deserialize(JSON.stringify({ format: 'lumen-stats', vars: [{ name: '<img src=x onerror=alert(1)>', type: 'weird', decimals: 1e9, width: -5 }, { name: 'x', type: 'numeric' }], data: [[1, { a: 1 }], ['s', 2]] }));
  assert.match(evil.vars[0].name, /^[A-Za-z_][A-Za-z0-9_.]*$/); assert.strictEqual(evil.vars[0].type, 'numeric'); assert.strictEqual(evil.vars[0].decimals, 10); assert.strictEqual(evil.vars[0].width, 40);
  assert.deepStrictEqual(evil.cols, [[1, null], [null, 2]]);
});
t('report HTML escapes everything from (possibly untrusted) output items', () => {
  const evil = { id: 'x', title: '<script>alert(1)</script>', sub: '"><b>', blocks: [{ t: 'table', title: '<i>t</i>', cols: [{ h: '<th>', f: 's' }], rows: [['<img src=x onerror=alert(1)>']] }, { t: 'note', text: '<svg onload=alert(1)>' },
    { t: 'chart', chart: { w: 100, h: 100, ops: [['t', 1, 2, '</text><script>alert(1)</script>', 10, '" onload="alert(1)', 's'], ['r', 0, 0, 10, 10, 'red;x:url(javascript:1)']] } }] };
  const html = R.exportHTML([evil]);
  assert(!/<script>alert|<img src=x|<svg onload|onload="alert|javascript:/.test(html), 'no live markup'); assert(html.includes('&lt;script&gt;'));
});
t('number formatting in output tables (p-values, decimals, minus sign)', () => {
  assert.strictEqual(R.fmt(0.0002, 'p'), '<.001'); assert.strictEqual(R.fmt(0.04567, 'p'), '.046'); assert.strictEqual(R.fmt(1, 'p'), '1.000');
  assert.strictEqual(R.fmt(-7.9312, 'a'), '−7.931'); assert.strictEqual(R.fmt(42, 'a'), '42'); assert.strictEqual(R.fmt(1.2e-7, 'a'), '1.20e-7'); assert.strictEqual(R.fmt(55.55, 'pct'), '55.5');
});
t('charts render to well-formed SVG with the validated palette', () => {
  const svg = C.toSVG(C.scatter({ x: [1, 2, 3, 4], y: [2, 4, 5, 8], fit: 'linear', title: 'S' }));
  assert(svg.startsWith('<svg') && svg.endsWith('</svg>')); assert(svg.includes('R² = 0.9'));
  assert(C.toSVG(C.histogram({ values: [1, 2, 2, 3, 3, 3, 4, 4, 5] })).includes(C.PAL[0]));
});
t('PDF export produces a valid multi-page PDF with vector text', async () => {
  const d = X.demoDoc(), ix = nm => d.vars.findIndex(v => v.name === nm);
  const items = [A.descriptives(d, { vars: [ix('age'), ix('bmi')] }), A.anova1(d, { vars: [ix('change')], factor: ix('group') }), A.regress(d, { dep: ix('sbp12'), preds: [ix('sbp0'), ix('group')] }), A.control(d, { type: 'imr', x: ix('sbp0') })];
  const bytes = await R.exportPDF(items, { title: 'Test report' });
  const head = Buffer.from(bytes.slice(0, 8)).toString('latin1'); assert(head.startsWith('%PDF-1.'), head);
  const PDFLib = require('../vendor/pdf-lib.min.js'), pdf = await PDFLib.PDFDocument.load(bytes);
  assert(pdf.getPageCount() >= 3, 'pages: ' + pdf.getPageCount()); assert.strictEqual(pdf.getTitle(), 'Test report');
  assert.strictEqual(R.winAnsi('χ² ≤ η'), 'chi² <= eta');
});
(async () => {
  for (const [name, fn] of tests) { await fn(); n++; console.log('ok', name); }
  console.log(`\n${n} data/IO tests passed`);
})().catch(e => { console.error(e); process.exit(1); });
