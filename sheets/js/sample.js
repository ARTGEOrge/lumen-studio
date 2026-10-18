'use strict';
/* Lumen Sheets — sample workbook (sales dashboard, loan calculator, order log + pivot). */
(function (root) {
  const M = root.SheetModel, F = root.Formula, Fmt = root.SheetFormat;
  function rng(seed) { let a = seed >>> 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function build() {
    const wb = new M.Workbook();
    const put = (sh, a1, v, s) => { const p = F.parseAddr(a1); if (typeof v === 'string' && v[0] === '=') wb.setCell(sh, p.r, p.c, { f: v.slice(1), s }); else wb.setCell(sh, p.r, p.c, { v, s }); };
    const style = (sh, rangeText, patch) => { const g = F.parseRange(rangeText); for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) wb.setStyle(sh, r, c, patch); };
    const thin = { style: 'thin', color: '#b4c6dc' };
    wb.begin('Sample');
    /* ---------- Sales ---------- */
    const S = wb.addSheetRaw('Sales 2026');
    S.tabColor = '#4472c4';
    put(S, 'A1', 'Lumen Coffee Co. — 2026 Sales');
    style(S, 'A1:G1', { b: 1, sz: 18, color: '#ffffff', fill: '#1f4e79', va: 'middle' });
    S.merges.push({ r1: 0, c1: 0, r2: 0, c2: 6 }); S.rowH.set(0, 38);
    put(S, 'A2', 'Monthly revenue by product line (USD)'); style(S, 'A2:G2', { i: 1, color: '#5b6b7c', fill: '#ddebf7' }); S.merges.push({ r1: 1, c1: 0, r2: 1, c2: 6 });
    const head = ['Month', 'Espresso', 'Latte', 'Cold Brew', 'Pastries', 'Total', 'vs Target'];
    head.forEach((h, i) => put(S, F.addr(2, i), h));
    style(S, 'A3:G3', { b: 1, color: '#1f4e79', fill: '#bdd7ee', ha: 'center', bb: { style: 'medium', color: '#1f4e79' } });
    const R = rng(7), months = Fmt.MONTHS;
    for (let i = 0; i < 12; i++) {
      const r = 3 + i, season = 1 + 0.18 * Math.sin((i - 1) / 12 * Math.PI * 2), cold = 1 + 0.55 * Math.sin((i - 3) / 12 * Math.PI * 2);
      put(S, F.addr(r, 0), Fmt.dateToSerial(2026, i + 1, 1), { nf: 'mmm yyyy', b: 1, color: '#1f4e79' });
      put(S, F.addr(r, 1), Math.round((14200 + i * 260) * season + R() * 900), { nf: '#,##0' });
      put(S, F.addr(r, 2), Math.round((18800 + i * 410) * season + R() * 1200), { nf: '#,##0' });
      put(S, F.addr(r, 3), Math.round(6400 * cold + i * 120 + R() * 700), { nf: '#,##0' });
      put(S, F.addr(r, 4), Math.round((9100 + i * 150) * (0.95 + R() * 0.1)), { nf: '#,##0' });
      put(S, F.addr(r, 5), `=SUM(B${r + 1}:E${r + 1})`, { nf: '$#,##0', b: 1 });
      put(S, F.addr(r, 6), `=F${r + 1}/$J$4-1`, { nf: '0.0%;[Red]-0.0%' });
      if (i % 2) style(S, `A${r + 1}:G${r + 1}`, { fill: '#f5f9fd' });
    }
    put(S, 'A16', 'Total', { b: 1 });
    ['B', 'C', 'D', 'E', 'F'].forEach(c => put(S, c + '16', `=SUM(${c}4:${c}15)`, { nf: c === 'F' ? '$#,##0' : '#,##0', b: 1 }));
    put(S, 'G16', '=AVERAGE(G4:G15)', { nf: '0.0%;[Red]-0.0%', b: 1 });
    style(S, 'A16:G16', { fill: '#ddebf7', bt: { style: 'thin', color: '#1f4e79' }, bb: { style: 'double', color: '#1f4e79' } });
    style(S, 'A4:G15', { bb: thin });
    // KPIs
    put(S, 'I3', 'Key figures'); style(S, 'I3:J3', { b: 1, color: '#ffffff', fill: '#2e75b6' }); S.merges.push({ r1: 2, c1: 8, r2: 2, c2: 9 });
    const kpi = [['Monthly target', 50000, '$#,##0'], ['Best month', '=INDEX(A4:A15,MATCH(MAX(F4:F15),F4:F15,0))', 'mmmm'], ['Best month revenue', '=MAX(F4:F15)', '$#,##0'],
      ['Average month', '=AVERAGE(F4:F15)', '$#,##0'], ['Months over target', '=COUNTIF(G4:G15,">0")', '0'], ['Dec vs Jan growth', '=F15/F4-1', '0.0%'],
      ['Cold brew share', '=D16/F16', '0.0%'], ['Top product', '=INDEX(B3:E3,MATCH(MAX(B16:E16),B16:E16,0))', '@'], ['Std. deviation', '=STDEV.S(F4:F15)', '$#,##0'], ['Trend next Jan', '=FORECAST.LINEAR(13,F4:F15,SEQUENCE(12))', '$#,##0']];
    kpi.forEach(([k, v, nf], i) => { put(S, F.addr(3 + i, 8), k, { color: '#3a4a5c' }); put(S, F.addr(3 + i, 9), v, { nf, b: 1, ha: 'right' }); });
    style(S, 'I4:J13', { bb: thin }); style(S, 'J4', { fill: '#fff2cc' });
    [[0, 92], [1, 78], [2, 78], [3, 82], [4, 78], [5, 92], [6, 80], [7, 22], [8, 140], [9, 104]].forEach(([c, w]) => S.colW.set(c, w));
    S.cf.push({ type: 'bar', range: { r1: 3, c1: 5, r2: 14, c2: 5 }, color: '#5b9bd5' });
    S.cf.push({ type: 'scale', range: { r1: 3, c1: 3, r2: 14, c2: 3 }, colors: ['#f8fbff', '#9dc3e6'] });
    S.cf.push({ type: 'icons', range: { r1: 3, c1: 6, r2: 14, c2: 6 }, set: 'arrows' });
    S.freeze = { r: 3, c: 1 };
    S.charts.push({ id: 'c1', type: 'column', range: 'A3:E15', title: 'Revenue by product', x: 0, y: 360, w: 590, h: 250, stacked: true, legend: true });
    S.charts.push({ id: 'c2', type: 'line', range: 'A3:A15,F3:F15', title: 'Total revenue', x: 606, y: 300, w: 420, h: 250, legend: false, smooth: true });
    S.charts.push({ id: 'c3', type: 'doughnut', range: 'B3:E3,B16:E16', title: 'Product mix', x: 1040, y: 0, w: 300, h: 250, byRow: true });
    /* ---------- Loan ---------- */
    const L = wb.addSheetRaw('Loan Calculator'); L.tabColor = '#70ad47';
    put(L, 'A1', 'Loan calculator'); style(L, 'A1:F1', { b: 1, sz: 16, color: '#375623' }); L.rowH.set(0, 30);
    const inputs = [['Loan amount', 250000, '$#,##0'], ['Annual interest rate', 0.0575, '0.00%'], ['Term (years)', 25, '0'], ['Start date', Fmt.dateToSerial(2026, 1, 1), 'mmm d, yyyy']];
    inputs.forEach(([k, v, nf], i) => { put(L, F.addr(2 + i, 0), k); put(L, F.addr(2 + i, 1), v, { nf, fill: '#fff2cc', b: 1, bb: thin, bt: thin, bl: thin, br: thin }); });
    put(L, 'A8', 'Monthly payment'); put(L, 'B8', '=-PMT(B4/12,B5*12,B3)', { nf: '$#,##0.00', b: 1, sz: 13, color: '#375623' });
    put(L, 'A9', 'Total interest'); put(L, 'B9', '=B8*B5*12-B3', { nf: '$#,##0' });
    put(L, 'A10', 'Payoff date'); put(L, 'B10', '=EDATE(B6,B5*12-1)', { nf: 'mmm yyyy' });
    put(L, 'A11', 'Effective annual rate'); put(L, 'B11', '=EFFECT(B4,12)', { nf: '0.000%' });
    style(L, 'A8:B11', { fill: '#e2efda' });
    ['#', 'Date', 'Payment', 'Interest', 'Principal', 'Balance'].forEach((h, i) => put(L, F.addr(12, i), h));
    style(L, 'A13:F13', { b: 1, fill: '#a9d08e', color: '#1e3a12', ha: 'center' });
    for (let k = 1; k <= 36; k++) {
      const r = 12 + k, rr = r + 1;
      put(L, F.addr(r, 0), k);
      put(L, F.addr(r, 1), `=EDATE($B$6,A${rr}-1)`, { nf: 'mmm yyyy' });
      put(L, F.addr(r, 2), '=$B$8', { nf: '#,##0.00' });
      put(L, F.addr(r, 3), `=-IPMT($B$4/12,A${rr},$B$5*12,$B$3)`, { nf: '#,##0.00' });
      put(L, F.addr(r, 4), `=-PPMT($B$4/12,A${rr},$B$5*12,$B$3)`, { nf: '#,##0.00' });
      put(L, F.addr(r, 5), k === 1 ? `=$B$3-E${rr}` : `=F${rr - 1}-E${rr}`, { nf: '$#,##0.00' });
    }
    [[0, 150], [1, 100], [2, 90], [3, 90], [4, 90], [5, 110]].forEach(([c, w]) => L.colW.set(c, w));
    L.freeze = { r: 13, c: 0 };
    L.charts.push({ id: 'l1', type: 'area', range: 'B13:B49,D13:E49', title: 'Interest vs principal (first 3 years)', x: 680, y: 40, w: 460, h: 260, stacked: true });
    /* ---------- Orders ---------- */
    const O = wb.addSheetRaw('Orders'); O.tabColor = '#ed7d31';
    const oh = ['Order date', 'Region', 'Store', 'Product', 'Qty', 'Unit price', 'Revenue'];
    oh.forEach((h, i) => put(O, F.addr(0, i), h));
    style(O, 'A1:G1', { b: 1, fill: '#f8cbad', color: '#5f2c0e', bb: { style: 'medium', color: '#c55a11' } });
    const regions = { North: ['Harbor', 'Old Town'], South: ['Riverside', 'Market St'], East: ['Station', 'Campus'], West: ['Hilltop', 'Airport'] };
    const products = [['Espresso', 3.2], ['Latte', 4.6], ['Cold Brew', 4.9], ['Croissant', 3.8], ['Muffin', 3.4], ['Beans 1kg', 24]];
    const R2 = rng(42);
    for (let i = 0; i < 240; i++) {
      const r = i + 1, reg = Object.keys(regions)[Math.floor(R2() * 4)], store = regions[reg][Math.floor(R2() * 2)], [p, price] = products[Math.floor(R2() * products.length)];
      put(O, F.addr(r, 0), Fmt.dateToSerial(2026, 1, 1) + Math.floor(R2() * 180), { nf: 'yyyy-mm-dd' });
      put(O, F.addr(r, 1), reg); put(O, F.addr(r, 2), store); put(O, F.addr(r, 3), p);
      put(O, F.addr(r, 4), 1 + Math.floor(R2() * (p === 'Beans 1kg' ? 6 : 40)));
      put(O, F.addr(r, 5), price, { nf: '$0.00' });
      put(O, F.addr(r, 6), `=E${r + 1}*F${r + 1}`, { nf: '$#,##0.00' });
    }
    [[0, 92], [1, 70], [2, 84], [3, 90], [4, 50], [5, 76], [6, 90]].forEach(([c, w]) => O.colW.set(c, w));
    O.freeze = { r: 1, c: 0 };
    O.filter = { range: { r1: 0, c1: 0, r2: 240, c2: 6 }, crit: {} };
    O.cf.push({ type: 'top', range: { r1: 1, c1: 6, r2: 240, c2: 6 }, v1: '10', style: { fill: '#c6efce', color: '#006100' } });
    put(O, 'I1', 'Lookup an order', { b: 1, color: '#c55a11' });
    put(O, 'I2', 'Row #'); put(O, 'J2', 12, { fill: '#fff2cc' });
    put(O, 'I3', 'Product'); put(O, 'J3', '=INDEX(D2:D241,J2)');
    put(O, 'I4', 'Revenue'); put(O, 'J4', '=XLOOKUP(J2,SEQUENCE(240),G2:G241,"n/a")', { nf: '$#,##0.00' });
    put(O, 'I6', 'Revenue by region', { b: 1, color: '#c55a11' });
    put(O, 'I7', '=SORT(UNIQUE(B2:B241))');
    for (let i = 0; i < 4; i++) put(O, F.addr(6 + i, 9), `=SUMIFS($G$2:$G$241,$B$2:$B$241,I${7 + i})`, { nf: '$#,##0' });
    O.colW.set(8, 110); O.colW.set(9, 92);
    wb.tx = null; // build without undo history
    // pivot from the orders
    const pv = wb.addSheetRaw('Pivot'); pv.tabColor = '#7030a0';
    pv.pivot = { src: "'Orders'!A1:G241", rows: 'Product', cols: 'Region', val: 'Revenue', agg: 'sum' };
    wb.rebuildGraph(); wb.recalc();
    root.SheetApp && root.SheetApp.writePivot ? root.SheetApp.writePivot(wb, pv, true) : null;
    wb.active = 0; wb.undoStack = []; wb.redoStack = [];
    return wb;
  }
  root.SheetSample = { build };
})(typeof self !== 'undefined' ? self : this);
