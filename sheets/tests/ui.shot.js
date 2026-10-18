// Headless UI test (run through tools/shot with SHOT_JS=this file). Drives keyboard/mouse/clipboard events
// against the real app and checks document state, rendered pixels and exported file bytes.
const A = SheetApp, G = A.grid, M = SheetModel, F = Formula, IO = SheetIO, out = {}, errs = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const check = (name, cond, info) => { if (!cond) errs.push(name + (info !== undefined ? ' → ' + JSON.stringify(info) : '')); };
const key = (el, k, o = {}) => el.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o)));
const wrapR = () => G.wrap.getBoundingClientRect();
const cellPt = (r, c, dx = 0.5, dy = 0.5) => { const rc = G.cellRect(r, c), w = wrapR(); return { x: w.left + rc.x + rc.w * dx, y: w.top + rc.y + rc.h * dy }; };
const mouse = (type, p, o = {}) => (type === 'mousedown' || type === 'dblclick' ? G.scroller : window).dispatchEvent(new MouseEvent(type, Object.assign({ clientX: p.x, clientY: p.y, bubbles: true, cancelable: true, button: 0 }, o)));
const typeCell = async (r, c, text) => { G.select(r, c); G.kbd.focus(); key(G.kbd, text[0]); const ed = G.editor; ed.value = text; ed.setSelectionRange(text.length, text.length); ed.dispatchEvent(new Event('input')); key(ed, 'Enter'); await frame(); };
const val = a => A.wb.val(a, A.sheet());
const t0 = performance.now();

/* 1. typing values and formulas */
document.querySelector('#welcome').hidden = true;
A.setWorkbook(M.Workbook.blank(1), 'Test');
for (let i = 0; i < 5; i++) await typeCell(i, 0, String((i + 1) * 10));
await typeCell(0, 1, '=A1*2');
check('typed numbers', [0, 1, 2, 3, 4].map(r => A.sheet().value(r, 0)).join() === '10,20,30,40,50');
check('typed formula', val('B1') === 20, val('B1'));
check('enter moves down', G.sel.r === 1 && G.sel.c === 1, G.sel);

/* 2. fill handle drag B1 → B5 */
G.select(0, 1); await frame();
const rc = G.cellRect(0, 1), w = wrapR();
mouse('mousedown', { x: w.left + rc.x + rc.w - 1, y: w.top + rc.y + rc.h - 1 });
mouse('mousemove', cellPt(4, 1)); mouse('mouseup', cellPt(4, 1)); await frame();
check('fill handle copies relative formula', A.sheet().get(4, 1) && A.sheet().get(4, 1).f === 'A5*2' && val('B5') === 100, A.sheet().get(4, 1));

/* 3. autocomplete + point mode + auto-close paren */
G.select(0, 2); G.kbd.focus(); key(G.kbd, '=');
G.editor.value = '=SU'; G.editor.setSelectionRange(3, 3); G.editor.dispatchEvent(new Event('input'));
out.acItems = [...document.querySelectorAll('#acList .ac-item')].map(x => x.dataset.n);
check('autocomplete lists SUM', !document.querySelector('#acList').hidden && out.acItems.includes('SUM'), out.acItems);
key(G.editor, 'Tab'); check('autocomplete inserts SUM(', G.editor.value === '=SUM(', G.editor.value);
check('signature tip shown', !document.querySelector('#sigTip').hidden && /number1/.test(document.querySelector('#sigTip').textContent), document.querySelector('#sigTip').textContent);
mouse('mousedown', cellPt(0, 0)); mouse('mousemove', cellPt(4, 0)); mouse('mouseup', cellPt(4, 0));
check('point mode inserts range', G.editor.value === '=SUM(A1:A5', G.editor.value);
key(G.editor, 'Enter'); await frame();
check('auto-closed formula', A.sheet().get(0, 2).f === 'SUM(A1:A5)' && val('C1') === 150, A.sheet().get(0, 2));

/* 4. F4 toggles absolute refs */
G.select(1, 2); G.kbd.focus(); key(G.kbd, '=');
G.editor.value = '=A1'; G.editor.setSelectionRange(3, 3); G.editor.dispatchEvent(new Event('input'));
key(G.editor, 'F4'); check('F4 → $A$1', G.editor.value === '=$A$1', G.editor.value); key(G.editor, 'Escape');

/* 5. copy/paste internal (formulas shift) */
const dt = () => new DataTransfer();
G.selectRange({ r1: 0, c1: 0, r2: 1, c2: 1 });
let d1 = dt(); G.kbd.dispatchEvent(new ClipboardEvent('copy', { clipboardData: d1, bubbles: true, cancelable: true }));
out.copiedText = d1.getData('text/plain'); out.copiedHtmlHasTable = /<table/.test(d1.getData('text/html'));
check('copy writes TSV', out.copiedText === '10\t20\r\n20\t40', out.copiedText);
G.select(0, 4);
let d2 = dt(); d2.setData('text/plain', out.copiedText); G.kbd.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d2, bubbles: true, cancelable: true }));
check('internal paste shifts formula', A.sheet().get(0, 5) && A.sheet().get(0, 5).f === 'E1*2' && val('F2') === 40, A.sheet().get(0, 5));

/* 6. paste from other apps: HTML table with styles, then TSV */
G.select(0, 7);
let d3 = dt(); d3.setData('text/html', '<html><body><table><tr><td style="font-weight:bold;background:#ffff00">Name</td><td>Qty</td></tr><tr><td>Widget</td><td>12</td></tr><tr><td colspan="2">merged note</td></tr></table><script>window.__pwned=1<\/script></body></html>'); d3.setData('text/plain', 'Name\tQty\nWidget\t12');
G.kbd.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d3, bubbles: true, cancelable: true }));
const h1 = A.sheet().get(0, 7);
check('html paste values', val('H1') === 'Name' && val('I2') === 12 && val('H3') === 'merged note', [val('H1'), val('I2'), val('H3')]);
check('html paste styles', h1 && h1.s && h1.s.b === 1 && h1.s.fill === '#ffff00', h1 && h1.s);
check('html paste merge', A.sheet().merges.some(m => m.r1 === 2 && m.c1 === 7 && m.c2 === 8));
check('pasted html script did not run', !window.__pwned);
G.select(6, 7);
let d4 = dt(); d4.setData('text/plain', '1\t2\r\n3\t=H7+I7'); G.kbd.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d4, bubbles: true, cancelable: true }));
check('tsv paste', val('H7') === 1 && val('I8') === 3, [val('H7'), val('I8')]);

/* 7. undo / redo */
const ub = A.wb.undoStack.length;
key(G.kbd, 'z', { ctrlKey: true }); await frame();
check('undo tsv paste', A.sheet().value(6, 7) == null);
key(G.kbd, 'y', { ctrlKey: true }); await frame();
check('redo tsv paste', val('H7') === 1);
check('undo stack grew', ub > 5, ub);

/* 8. formatting via shortcut + toolbar */
G.select(0, 0);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true, cancelable: true }));
check('Ctrl+B bolds', A.sheet().get(0, 0).s && A.sheet().get(0, 0).s.b === 1, A.sheet().get(0, 0).s);
check('toolbar shows bold', document.querySelector('#bBold').classList.contains('on'));
G.selectRange({ r1: 0, c1: 0, r2: 4, c2: 0 });
const nf = document.querySelector('#selNf'); nf.value = '$#,##0.00'; nf.dispatchEvent(new Event('change'));
check('number format applied', A.wb.display(A.sheet(), 4, 0).text === '$50.00', A.wb.display(A.sheet(), 4, 0).text);
document.querySelector('#bDecU').click();
check('increase decimals', A.wb.display(A.sheet(), 4, 0).text === '$50.000', A.wb.display(A.sheet(), 4, 0).text);
G.select(0, 0); document.querySelector('#bMerge').click(); // single cell → no merge
G.selectRange({ r1: 10, c1: 0, r2: 10, c2: 3 }); document.querySelector('#bMerge').click(); await wait(30);
check('merge & center', A.sheet().merges.some(m => m.r1 === 10 && m.c2 === 3));
await frame();
out.status = document.querySelector('#st3').textContent;

/* 9. sort + filter */
const S = A.wb.addSheet('Data'); A.wb.active = A.wb.sheets.indexOf(S); A.setWorkbook(A.wb, 'Test');
A.wb.active = A.wb.sheets.indexOf(S);
A.wb.load(S, { A1: 'Name', B1: 'Score', A2: 'Cara', B2: 71, A3: 'Ann', B3: 93, A4: 'Bo', B4: 58, A5: 'Dee', B5: 93 });
A.grid.invalidate(); A.grid.render();
G.select(1, 1); document.querySelector('#bSortZ').click();
check('sort descending w/ header', [1, 2, 3, 4].map(r => S.value(r, 1)).join() === '93,93,71,58' && S.value(0, 0) === 'Name', [1, 2, 3, 4].map(r => S.value(r, 1)));
document.querySelector('#bFilter').click();
check('filter on', !!S.filter && S.filter.range.r2 === 4);
await frame();
const hb = cellPt(0, 1, 0.97, 0.8); mouse('mousedown', hb); await frame();
const pop = document.querySelector('#popup');
check('filter popup opens', !pop.hidden && pop.querySelectorAll('#fList input[data-i]').length === 3, pop.querySelectorAll('#fList input[data-i]').length);
[...pop.querySelectorAll('#fList label')].forEach(l => { if (/58/.test(l.textContent)) l.querySelector('input').checked = false; });
pop.querySelector('[data-a=ok]').click(); await frame();
check('filter hides row', S.filtered.size === 1 && S.filtered.has(4), [...S.filtered]);
check('filtered row has zero height on screen', G.cellRect(4, 0).h === 0, G.cellRect(4, 0));
mouse('mousedown', cellPt(0, 1, 0.97, 0.8)); await frame();
document.querySelector('#fOp').value = '>'; document.querySelector('#fV1').value = '80'; document.querySelector('#popup [data-a=ok]').click(); await frame();
check('number filter > 80', S.filtered.size === 2, [...S.filtered]);

/* 10. conditional formatting + chart + freeze + zoom */
G.selectRange({ r1: 1, c1: 1, r2: 4, c2: 1 });
A.wb.transact('cf', () => A.wb.setMeta(S, 'cf', [{ type: 'cell', op: '>', v1: '90', range: { r1: 1, c1: 1, r2: 4, c2: 1 }, style: { fill: '#ffc7ce', color: '#9c0006' } }]));
check('cf rule format', A.wb.cfFormat(S, 1, 1).fill === '#ffc7ce' && !A.wb.cfFormat(S, 3, 1));
A.wb.transact('unfilter', () => { A.wb.setMeta(S, 'filter', null); A.wb.setMeta(S, 'filtered', new Set()); });
G.selectRange({ r1: 0, c1: 0, r2: 4, c2: 1 });
document.querySelector('#bChart').click(); [...document.querySelectorAll('#popup .mi')].find(m => /Bar/.test(m.textContent)).click();
await frame(); await frame();
const chartEl = document.querySelector('.chart-box canvas');
check('chart inserted', S.charts.length === 1 && !!chartEl, S.charts);
if (chartEl) { const cx = chartEl.getContext('2d'), d = cx.getImageData(0, 0, chartEl.width, chartEl.height).data; let colored = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 0x44) < 8 && Math.abs(d[i + 1] - 0x72) < 8 && Math.abs(d[i + 2] - 0xc4) < 8) colored++; out.chartBluePx = colored; check('chart draws bars', colored > 200, colored); }
G.select(1, 1); [...document.querySelectorAll('.aero-menu')].find(m => m.textContent.startsWith('View'));
document.querySelector('#bFreeze').click(); [...document.querySelectorAll('#popup .mi')][0].click(); await frame();
check('freeze panes', S.freeze.r === 1 && S.freeze.c === 1, S.freeze);
document.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true, bubbles: true, cancelable: true })); await frame();
check('zoom in', Math.abs(S.zoom - 1.1) < 1e-9, S.zoom);
S.zoom = 1;

/* 11. find & replace */
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true, cancelable: true }));
check('find panel open', !document.querySelector('#findPanel').hidden);
document.querySelector('#fpFind').value = 'Ann'; document.querySelector('#fpRepl').value = 'Anne'; document.querySelector('#fpReplAll').click();
check('replace all', [1, 2, 3, 4].some(r => S.value(r, 0) === 'Anne'));
document.querySelector('#fpFind').value = 'dee'; document.querySelector('#fpNext').click();
check('find next selects', S.value(G.sel.r, G.sel.c) === 'Dee', [G.sel.r, G.sel.c]);
document.querySelector('#fpClose').click();

/* 12. insert/delete rows through the context menu */
G.select(2, 0); G.scroller.dispatchEvent(new MouseEvent('contextmenu', { clientX: cellPt(2, 0).x, clientY: cellPt(2, 0).y, bubbles: true, cancelable: true }));
[...document.querySelectorAll('#popup .mi')].find(m => /Insert rows above/.test(m.textContent)).click();
check('insert row', S.value(2, 0) == null && S.value(3, 0) != null);
A.wb.undo();

/* 13. pivot table from the sample */
A.setWorkbook(SheetSample.build(), 'Sample');
const piv = A.wb.sheets[3];
let gtRow = 0; while (gtRow < 40 && piv.value(gtRow, 0) !== 'Grand Total') gtRow++;
const pivTot = piv.value(gtRow, 5); // Grand Total row / Grand Total col
const orders = A.wb.sheets[2]; let sum = 0; for (let r = 1; r <= 240; r++) sum += orders.value(r, 6);
check('pivot grand total equals data', Math.abs(pivTot - sum) < 1e-6, [pivTot, sum]);
check('sample has no errors', (() => { for (const sh of A.wb.sheets) for (const [k, c] of sh.cells) if (c.f != null && c.val instanceof F.FErr) return false; return true; })());
check('sample spill', A.wb.sheets[2].value(7, 8) != null);

/* 14. exports and round trips */
const bytes = IO.writeXlsx(A.wb);
out.xlsxBytes = bytes.length;
const files = fflate.unzipSync(bytes); let badXml = [];
for (const [n, b] of Object.entries(files)) { const d = new DOMParser().parseFromString(new TextDecoder().decode(b), 'application/xml'); if (d.getElementsByTagName('parsererror').length) badXml.push(n); }
check('xlsx parts are well-formed XML', !badXml.length, badXml);
const xs = XLSX.read(bytes, { type: 'array', cellFormula: true });
check('SheetJS reads our xlsx', xs.SheetNames.length === 4 && xs.Sheets['Sales 2026'].F4.f === 'SUM(B4:E4)', xs.SheetNames);
const back = IO.readSpreadsheet(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), 'x.xlsx');
const s0 = back.sheets[0], o0 = A.wb.sheets[0];
check('xlsx round trip values', back.val('F16', s0) === A.wb.val('F16', o0) && back.display(s0, 4, 9).text === A.wb.display(o0, 4, 9).text, [back.val('F16', s0), A.wb.val('F16', o0)]);
check('xlsx round trip styles', JSON.stringify(s0.get(0, 0).s) === JSON.stringify(o0.get(0, 0).s), [s0.get(0, 0).s, o0.get(0, 0).s]);
check('xlsx round trip merges/freeze/widths', s0.merges.length === o0.merges.length && s0.freeze.r === 3 && s0.freeze.c === 1 && Math.abs(s0.colW.get(8) - 140) <= 1, [s0.merges.length, s0.freeze, s0.colW.get(8)]);
check('xlsx round trip CF', s0.cf.length === o0.cf.length && s0.cf.map(r => r.type).join() === o0.cf.map(r => r.type).join(), s0.cf.map(r => r.type));
check('xlsx round trip spill', back.sheets[2].value(7, 8) === A.wb.sheets[2].value(7, 8), [back.sheets[2].value(7, 8), A.wb.sheets[2].value(7, 8)]);
check('xlsx dynamic array functions prefixed', /_xlfn\._xlws\.SORT/.test(new TextDecoder().decode(files['xl/worksheets/sheet3.xml'])));
const ods = IO.writeODS(A.wb); const xo = XLSX.read(ods, { type: 'array', cellFormula: true });
check('ods readable', xo.SheetNames.length === 4 && xo.Sheets['Sales 2026'].B4.v === A.wb.val('B4', o0), xo.SheetNames);
const odsBack = IO.readSpreadsheet(ods.buffer.slice(ods.byteOffset, ods.byteOffset + ods.byteLength), 'x.ods');
check('ods round trip formulas', Math.abs(odsBack.val('F16', odsBack.sheets[0]) - A.wb.val('F16', o0)) < 1e-6, odsBack.val('F16', odsBack.sheets[0]));
const csv = IO.writeCSV(A.wb, A.wb.sheets[2]); const cback = IO.readCSV(csv, 'orders.csv');
check('csv round trip', cback.sheets[0].value(5, 3) === A.wb.sheets[2].value(5, 3) && cback.sheets[0].value(240, 4) === A.wb.sheets[2].value(240, 4), [cback.sheets[0].value(5, 3)]);
const ls = JSON.parse(JSON.stringify(A.wb.toJSON())); const lb = M.Workbook.fromJSON(ls);
check('lsheet round trip', lb.val('J13', lb.sheets[0]) === A.wb.val('J13', o0) && lb.sheets[0].charts.length === 3);
const pdf = await IO.exportPDF(A.wb, [{ sheet: o0 }, { sheet: A.wb.sheets[2] }], { paper: 'letter', landscape: true, fitWidth: true });
out.pdfPages = pdf.pages; out.pdfBytes = pdf.bytes.length;
check('pdf export', new TextDecoder().decode(pdf.bytes.slice(0, 5)) === '%PDF-' && pdf.pages >= 3, pdf.pages);
const doc2 = await PDFLib.PDFDocument.load(pdf.bytes); check('pdf page count', doc2.getPageCount() === pdf.pages);
const png = IO.renderPNG(A.wb, o0, IO.printRange(A.wb, o0), 1);
const pctx = png.getContext('2d'), title = pctx.getImageData(20, 10, 1, 1).data;
check('png export draws the title fill', title[0] === 0x1f && title[1] === 0x4e && title[2] === 0x79, [...title]);

/* 15. hostile xlsx content stays data */
const evil = XLSX.utils.book_new(); const ews = XLSX.utils.aoa_to_sheet([['<img src=x onerror="window.__x=1">', 1]]); ews.B1 = { t: 'n', v: 1, f: 'constructor.constructor("window.__x=2")()' }; XLSX.utils.book_append_sheet(evil, ews, '<b>S');
const eb = XLSX.write(evil, { type: 'array', bookType: 'xlsx' }); const ew = IO.readSpreadsheet(eb, 'evil.xlsx');
A.setWorkbook(ew, 'evil.xlsx'); await frame(); await wait(50);
check('formula from file is not JS', !window.__x && ew.sheets[0].value(0, 1) instanceof F.FErr, ew.sheets[0].value(0, 1));
check('sheet name is text', document.querySelector('.sheet-tab').textContent === '<b>S');

/* 16. big sheet: 100,000 rows */
const big = M.Workbook.blank(1), bs = big.sheets[0];
let tb = performance.now();
big.begin('big');
for (let r = 0; r < 100000; r++) { bs.cells.set(M.K(r, 0), { v: r + 1, s: null }); bs.cells.set(M.K(r, 1), { v: 'Item ' + (r % 977), s: null }); bs.cells.set(M.K(r, 2), { v: (r * 7919) % 1000 / 10, s: null }); bs.cells.set(M.K(r, 3), { f: `A${r + 1}*C${r + 1}`, v: null, s: null }); }
bs.maxR = 99999; bs.maxC = 3; big.tx = null;
big.setCell(bs, 0, 5, { f: 'SUM(D:D)' }); big.setCell(bs, 1, 5, { f: 'COUNTIF(B:B,"Item 5")' }); big.setCell(bs, 2, 5, { f: 'XLOOKUP(99999,A:A,C:C)' });
big.rebuildGraph(); big.recalc();
out.bigBuildMs = Math.round(performance.now() - tb);
A.setWorkbook(big, 'big'); await frame();
tb = performance.now(); G.select(0, 0); key(G.kbd, 'ArrowDown', { ctrlKey: true }); await frame(); out.ctrlDownMs = Math.round(performance.now() - tb);
check('ctrl+down reaches row 100000', G.sel.r === 99999, G.sel.r);
tb = performance.now(); for (let i = 0; i < 20; i++) { G.scroller.scrollTop = i * 99000; G.paint(); } out.paint20Ms = Math.round(performance.now() - tb);
check('big formulas', bs.value(99999, 3) === 100000 * ((99999 * 7919) % 1000 / 10) && bs.value(1, 5) > 100 && bs.value(2, 5) === (99998 * 7919) % 1000 / 10, [bs.value(99999, 3), bs.value(1, 5), bs.value(2, 5)]);
tb = performance.now(); await typeCell(0, 2, '1000'); out.bigEditRecalcMs = Math.round(performance.now() - tb);
check('big edit recalcs SUM', bs.value(0, 3) === 1000, bs.value(0, 3));
tb = performance.now(); big.sortRange(bs, { r1: 0, c1: 0, r2: 99999, c2: 3 }, [{ col: 2, asc: true }], false); out.bigSortMs = Math.round(performance.now() - tb);
check('big sort', bs.value(0, 2) <= bs.value(1, 2) && bs.value(99998, 2) <= bs.value(99999, 2));
out.totalMs = Math.round(performance.now() - t0);
return JSON.stringify({ ok: !errs.length, errs, out }, null, 1);
