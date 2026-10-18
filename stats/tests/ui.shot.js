// Headless UI test — run through tools/shot with SHOT_URL=http://localhost:5180/stats/ SHOT_JS=<this file>.
// Drives the real app: grid typing/paste/undo, picker dialogs, compute/recode/filter, variable view, exports, re-import.
const app = StatsApp, out = {}, wait = ms => new Promise(r => setTimeout(r, ms)), fail = m => { throw new Error(m); };
const okBtn = () => document.querySelector('.aero-modal:not(.aero-busy) .aero-btns [data-a=o]');
const clickOK = async () => { await wait(30); const b = okBtn(); if (!b) fail('no dialog'); b.click(); await wait(60); };
const key = (el, k, o = {}) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
const md = el => el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
const vi = n => app.doc.vars.findIndex(v => v.name === n);
const saved = []; Aero.saveFile = async o => { let d = o.data; if (d instanceof Blob) d = new Uint8Array(await d.arrayBuffer()); saved.push({ name: o.name, data: d }); return o.name; };
const lastSaved = () => saved[saved.length - 1];
// picker helper: move variables (by name) into target i, then press OK
async function pickRun(open, targets, opts = {}) {
  open(app); await wait(40);
  for (const [i, names] of targets) for (const nm of names) {
    const it = [...document.querySelectorAll('.vp .sl .aero-item')].find(e => +e.dataset.j === vi(nm)); if (!it) fail('no source item ' + nm);
    md(it); document.querySelectorAll('.vp .mv')[i].click(); await wait(10);
  }
  for (const [k, v] of Object.entries(opts)) { const el = document.querySelector(`.opts [data-o="${k}"]`); if (el.type === 'checkbox') el.checked = v; else el.value = v; }
  await clickOK();
  return app.doc.output[app.doc.output.length - 1];
}
const cellText = (sec, rowLabel, col) => { const tr = [...sec.querySelectorAll('tbody tr')].find(r => r.cells[0].textContent.trim() === rowLabel); return tr ? tr.cells[col].textContent.trim() : null; };

try {
// 1. empty state
out.welcome = !!document.querySelector('.welcome');
document.querySelector('[data-w=new]').click(); await wait(30);
const g = app.grid, gel = document.getElementById('grid');
// 2. type into the empty grid: a number creates a numeric variable, text a string variable
g.select(0, 0); key(gel, '5'); await wait(10);
let ed = gel.querySelector('input.ed'); if (!ed) fail('editor did not open'); ed.value = '5.5'; key(ed, 'Enter'); await wait(20);
g.select(0, 1); key(gel, 'O'); ed = gel.querySelector('input.ed'); ed.value = 'Oslo'; key(ed, 'Tab'); await wait(20);
out.typed = { vars: app.doc.vars.map(v => v.name + ':' + v.type), n: app.doc.n, a: app.doc.cols[0][0], b: app.doc.cols[1][0] };
if (out.typed.a !== 5.5 || out.typed.b !== 'Oslo' || app.doc.vars[1].type !== 'string') fail('typing');
// 3. paste a tab-separated block (Excel style) at row 2
g.select(1, 0); const dt = new DataTransfer(); dt.setData('text/plain', '1.25\tGraz\t7\n2\tLeeds\t8\r\n'); gel.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true })); await wait(20);
out.paste = { n: app.doc.n, vars: app.doc.vars.length, c: app.doc.cols[2] };
if (app.doc.n !== 3 || app.doc.vars.length !== 3 || app.doc.cols[2][2] !== 8) fail('paste');
// 4. undo / redo with the keyboard
key(document.body, 'z', { ctrlKey: true }); await wait(20); out.undoN = app.doc.n;
key(document.body, 'y', { ctrlKey: true }); await wait(20); out.redoN = app.doc.n;
if (out.undoN !== 1 || out.redoN !== 3) fail('undo/redo');
// invalid entry into a numeric cell is rejected
g.select(0, 0); key(gel, 'x'); ed = gel.querySelector('input.ed'); ed.value = 'abc'; key(ed, 'Enter'); await wait(20);
out.rejected = app.doc.cols[0][0] === 5.5; if (!out.rejected) fail('validation');
key(gel, 'Escape');

// 5. open the mtcars sample (confirm discarding the typed data)
app.openSample('mtcars'); await wait(40); await clickOK(); await wait(80);
out.mtcars = { n: app.doc.n, vars: app.doc.vars.length, title: document.title };
if (app.doc.n !== 32) fail('sample');
// value labels on/off in the grid
const amCol = vi('am'); g.select(0, amCol); g.render();
const cellOf = (r, c) => [...gel.querySelectorAll('.c')].find(e => e.style.left === (g._rw + g.X[c]) + 'px' && e.style.top === (26 + r * 22) + 'px');
out.labelOn = cellOf(0, amCol).textContent; app.labels = false; app.refresh(); out.labelOff = cellOf(0, amCol).textContent; app.labels = true; app.refresh();
if (out.labelOn !== 'Manual' || out.labelOff !== '1') fail('value labels');

// 6. linear regression through the dialog → coefficient table in the output viewer
let it = await pickRun(LDialogs.P.regress, [[0, ['mpg']], [1, ['wt']]]);
let sec = document.querySelector(`.oi[data-id="${it.id}"]`), coef = [...sec.querySelectorAll('.ot')].find(t => t.querySelector('.ot-title').textContent === 'Coefficients');
out.reg = { b0: cellText(coef, '(Constant)', 1), b1: cellText(coef, 'wt', 1), t: cellText(coef, 'wt', 4), view: app.view, charts: sec.querySelectorAll('svg').length };
if (out.reg.b0 !== '37.285' || out.reg.b1 !== '−5.344' || out.reg.t !== '−9.559') fail('regression output ' + JSON.stringify(out.reg));
// 7. independent t-test via dialog with automatic group levels (am: Automatic vs Manual)
it = await pickRun(LDialogs.P.tInd, [[0, ['mpg']], [1, ['am']]]);
sec = document.querySelector(`.oi[data-id="${it.id}"]`);
const tt = [...sec.querySelectorAll('.ot')].find(t => /Independent samples test/.test(t.textContent));
out.ttest = { t: tt.querySelectorAll('tbody tr')[1].cells[4].textContent, df: tt.querySelectorAll('tbody tr')[1].cells[5].textContent, p: tt.querySelectorAll('tbody tr')[1].cells[6].textContent };
// R: t.test(mpg ~ am) Welch: t = −3.7671, df = 18.332, p = 0.001374
if (out.ttest.t !== '−3.767' || out.ttest.df !== '18.332' || out.ttest.p !== '.001') fail('t-test ' + JSON.stringify(out.ttest));
// 8. one-way ANOVA + Tukey, chi-square crosstab, logistic, Kruskal, normality, charts
it = await pickRun(LDialogs.P.anova1, [[0, ['mpg']], [1, ['cyl']]]); out.anovaTables = it.blocks.filter(b => b.t === 'table').map(b => b.title);
it = await pickRun(LDialogs.P.crosstabs, [[0, ['am']], [1, ['vs']]]); out.xtabFisher = !!document.querySelector(`.oi[data-id="${it.id}"]`).textContent.match(/Fisher’s exact test/);
it = await pickRun(LDialogs.P.logistic, [[0, ['am']], [1, ['wt']]]); out.logit = it.blocks.find(b => b.title === 'Variables in the equation').rows.map(r => +r[1].toFixed(3));
if (out.logit.join() !== '12.04,-4.024') fail('logistic ' + out.logit);
it = await pickRun(LDialogs.P.kruskal, [[0, ['mpg']], [1, ['cyl']]]); out.kw = it.blocks[1].rows[0][1];
it = await pickRun(LDialogs.P.normality, [[0, ['mpg']]]); out.sw = it.blocks[0].rows[0].slice(1, 4);
it = await pickRun(LDialogs.P.scatter, [[0, ['wt']], [1, ['mpg']], [2, ['am']]]); out.scatterSvg = document.querySelector(`.oi[data-id="${it.id}"] svg circle`) != null;
it = await pickRun(LDialogs.P.control, [[0, ['mpg']]], { type: 'imr' }); out.controlTitle = it.title;
it = await pickRun(LDialogs.P.box, [[0, ['mpg']], [1, ['cyl']]]); out.box = it.blocks.length;
// invalid dialog input keeps the dialog open with a message
delete LDialogs.memo.xtab; LDialogs.P.crosstabs(app); await wait(30); okBtn().click(); await wait(30);
out.dialogGuard = document.querySelector('.aero-modal .dlg-err')?.textContent; document.querySelector('.aero-modal .aero-btns [data-a=c]').click(); await wait(30);
if (!/Choose a variable/.test(out.dialogGuard || '')) fail('guard');

// 9. Compute variable through its dialog
LDialogs.compute(app); await wait(40);
document.querySelector('.tname').value = 'kpl'; const xe = document.querySelector('.xe'); xe.value = 'ROUND(mpg * 0.425144, 2)'; xe.dispatchEvent(new Event('input')); await wait(20);
out.preview = document.querySelector('.xbox .prev').textContent; await clickOK();
out.kpl = app.doc.cols[vi('kpl')].slice(0, 3); if (out.kpl.join() !== '8.93,8.93,9.69') fail('compute ' + out.kpl);
// 10. Recode into a different variable (API used by the dialog) + automatic recode of text
app.recode('different', [vi('mpg')], [{ from: { k: 'lowest', hi: 19.99 }, to: { k: 'value', v: 1 } }, { from: { k: 'highest', lo: 20 }, to: { k: 'value', v: 2 } }], { oname: 'mpg_band', otype: 'numeric', olabel: 'MPG band', vlabs: '1=Thirsty; 2=Frugal' });
const mb = app.doc.vars[vi('mpg_band')]; out.recode = { type: mb.type, labels: mb.values, first: app.doc.cols[vi('mpg_band')].slice(0, 5) };
if (out.recode.first.join() !== '2,2,2,2,1' || mb.type !== 'categorical') fail('recode');
// 11. Select cases → analyses use only selected cases; grid marks the others
app.setFilter('am = 1'); app.setView('data'); await wait(20);
out.filterStatus = document.getElementById('st2').textContent; out.struck = gel.querySelectorAll('.rn.off').length;
it = app.run(d => LAnalyses.descriptives(d, { vars: [vi('mpg')], stats: ['n', 'mean'] })); out.filteredN = it.blocks[0].rows[0][1];
if (out.filteredN !== 13 || out.struck < 10) fail('filter');
app.setFilter(null);
// 12. Variable View: change model (string) → categorical, rename a variable
app.setView('vars'); await wait(20);
const typeSel = document.querySelector(`.vv tr[data-j="${vi('model')}"] select[data-k=type]`); typeSel.value = 'categorical'; typeSel.dispatchEvent(new Event('change')); await wait(20);
out.modelType = app.doc.vars[vi('model')].type + ' / ' + Object.keys(app.doc.vars[vi('model')].values).length + ' labels';
const nameIn = document.querySelector(`.vv tr[data-j="${vi('qsec')}"] input.nm`); nameIn.value = 'quarter_mile'; nameIn.dispatchEvent(new Event('change')); await wait(20);
out.renamed = vi('quarter_mile') >= 0;
const badName = document.querySelector(`.vv tr[data-j="${vi('hp')}"] input.nm`); badName.value = 'mpg'; badName.dispatchEvent(new Event('change')); await wait(20);
out.dupRejected = vi('hp') >= 0 && badName.classList.contains('bad');
app.setView('data');

// 13. exports: HTML report, PDF report, CSV, XLSX, project — and re-open them
await app.exportOutput('html'); const html = lastSaved(); out.html = { name: html.name, tables: (html.data.match(/<table>/g) || []).length, svgs: (html.data.match(/<svg/g) || []).length };
await app.exportOutput('pdf'); const pdf = lastSaved(); out.pdf = { name: pdf.name, bytes: pdf.data.length, head: String.fromCharCode(...pdf.data.slice(0, 5)) };
if (out.pdf.head !== '%PDF-') fail('pdf');
{ const doc = await PDFLib.PDFDocument.load(pdf.data); out.pdf.pages = doc.getPageCount(); }
await app.exportData('csv'); out.csvHead = lastSaved().data.split('\r\n')[0].slice(0, 60);
await app.exportData('xlsx'); { const wb = XLSX.read(lastSaved().data, { type: 'array' }); out.xlsx = { sheets: wb.SheetNames, rows: XLSX.utils.sheet_to_json(wb.Sheets.Data).length }; }
const nOut = app.doc.output.length, nVars = app.doc.vars.length;
await app.save(true); const proj = lastSaved(); out.saved = { name: proj.name, title: document.title };
await app.openFiles([{ name: 'reopened.lstat', data: new TextEncoder().encode(proj.data).buffer }]); await wait(60);
out.reopened = { n: app.doc.n, vars: app.doc.vars.length, output: app.doc.output.length, kpl: app.doc.cols[vi('kpl')][2] };
if (out.reopened.vars !== nVars || out.reopened.output !== nOut || out.reopened.kpl !== 9.69) fail('round trip');
// CSV import (semicolon + decimal comma) and XLSX import in the browser
Aero.dirty && Aero.setDirty(false);
await app.openFiles([{ name: 'shop.csv', data: new TextEncoder().encode('Store;Day;Sales;Region\nA;2026-03-01;12,5;North\nB;2026-03-02;7,25;South\nC;2026-03-03;9;North\nD;;11;North\n').buffer }]); await wait(40);
out.csv = app.doc.vars.map(v => v.name + ':' + v.type).join(' '); out.csvSales = app.doc.cols[2];
Aero.setDirty(false);
const xp = app.openFiles([{ name: 'cars.xlsx', data: saved.find(s => s.name.endsWith('.xlsx')).data.buffer }]);
for (let k = 0; k < 40 && !okBtn(); k++) await wait(50);
out.sheetPrompt = !!okBtn(); if (okBtn()) await clickOK();   // two sheets → choose the first
await xp; await wait(50); out.xlsxImport = { n: app.doc.n, vars: app.doc.vars.length, dates: app.doc.vars.filter(v => v.type === 'date').length };

// 14. output viewer: delete an item from its toolbar, outline follows
app.openSample('demo'); await wait(50); if (okBtn()) await clickOK(); await wait(80);
const before = app.doc.output.length; document.querySelector('.oi .otools [data-a=del]').click(); await wait(30);
out.outDelete = [before, app.doc.output.length, document.querySelectorAll('#oList .aero-item').length];
key(document.body, 'z', { ctrlKey: true }); await wait(30); out.outUndo = app.doc.output.length;

// 15. big data: 100 000 cases × 12 variables stays responsive (virtual grid)
const N = 100000, rnd = LSamples.rng(7), big = { name: 'Big', n: N, vars: [], cols: [] };
for (let j = 0; j < 12; j++) { big.vars.push(LData.newVar('x' + j)); big.cols.push(Array.from({ length: N }, () => Math.round(rnd() * 1e4) / 100)); }
let t0 = performance.now(); app.load(big, 'Big'); app.setView('data'); await wait(10); out.bigLoadMs = Math.round(performance.now() - t0);
t0 = performance.now(); for (let k = 0; k < 40; k++) { gel.scrollTop = k * 50000; g.render(); } out.bigScroll40Ms = Math.round(performance.now() - t0);
out.bigDomCells = gel.querySelectorAll('.c').length;
t0 = performance.now(); app.run(d => LAnalyses.descriptives(d, { vars: [0, 1, 2, 3], stats: ['n', 'mean', 'sd', 'median'] })); out.bigDescMs = Math.round(performance.now() - t0);
t0 = performance.now(); app.run(d => LAnalyses.regress(d, { dep: 0, preds: [1, 2, 3], plots: false })); out.bigRegMs = Math.round(performance.now() - t0);
app.setView('data'); app.openSample('demo'); await wait(30); if (okBtn()) await clickOK(); await wait(60);
} catch (e) { out.error = e.message; out.at = (e.stack.split(String.fromCharCode(10)).find(l => /<anonymous>|eval/.test(l)) || '').trim(); }
return JSON.stringify(out);
