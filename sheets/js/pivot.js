'use strict';
/* Lumen Sheets — pivot tables: group a header+rows range by a row field (and optional column field)
   and aggregate a value field. Output is a plain 2-D array plus layout hints; the app writes it to a sheet. */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const F = isNode ? require('./functions.js') : root.Formula;
  const AGG = {
    sum: { label: 'Sum', init: () => 0, add: (a, v) => typeof v === 'number' ? a + v : a, done: a => a },
    count: { label: 'Count', init: () => 0, add: (a, v) => v != null && v !== '' ? a + 1 : a, done: a => a },
    average: { label: 'Average', init: () => [0, 0], add: (a, v) => typeof v === 'number' ? [a[0] + v, a[1] + 1] : a, done: a => a[1] ? a[0] / a[1] : null },
    min: { label: 'Min', init: () => Infinity, add: (a, v) => typeof v === 'number' && v < a ? v : a, done: a => a === Infinity ? null : a },
    max: { label: 'Max', init: () => -Infinity, add: (a, v) => typeof v === 'number' && v > a ? v : a, done: a => a === -Infinity ? null : a }
  };
  const keyOf = v => v == null || v === '' ? '(blank)' : v;
  const sortKeys = keys => keys.sort((a, b) => { if (a === '(blank)') return 1; if (b === '(blank)') return -1; return F.compare(a, b); });
  // sheet: source; g: range incl. header row; spec: {rows, cols, val, agg} (header names)
  function build(sheet, g, spec) {
    const headers = []; for (let c = g.c1; c <= g.c2; c++) headers.push(String(sheet.value(g.r1, c) ?? F.colName(c)));
    const idx = name => name ? headers.findIndex(h => h.toLowerCase() === String(name).toLowerCase()) : -1;
    const ri = idx(spec.rows), ci = idx(spec.cols), vi = idx(spec.val);
    if (ri < 0) throw new Error('Choose a row field');
    if (vi < 0) throw new Error('Choose a value field');
    const agg = AGG[spec.agg] || AGG.sum;
    const rowKeys = new Map(), colKeys = new Map(), cells = new Map(), rowTot = new Map(), colTot = new Map(); let grand = agg.init();
    const b = sheet.bounds(), r2 = Math.min(g.r2, b.r);
    for (let r = g.r1 + 1; r <= r2; r++) {
      if (sheet.rowHidden && sheet.filtered && sheet.filtered.has(r)) continue;
      const rk = keyOf(sheet.value(r, g.c1 + ri)), ck = ci >= 0 ? keyOf(sheet.value(r, g.c1 + ci)) : '';
      const v = sheet.value(r, g.c1 + vi);
      const blankRow = headers.every((_, j) => sheet.value(r, g.c1 + j) == null); if (blankRow) continue;
      rowKeys.set(rk, 1); colKeys.set(ck, 1);
      const k = JSON.stringify([rk, ck]);
      cells.set(k, agg.add(cells.has(k) ? cells.get(k) : agg.init(), v));
      rowTot.set(rk, agg.add(rowTot.has(rk) ? rowTot.get(rk) : agg.init(), v));
      colTot.set(ck, agg.add(colTot.has(ck) ? colTot.get(ck) : agg.init(), v));
      grand = agg.add(grand, v);
    }
    const rks = sortKeys([...rowKeys.keys()]), cks = ci >= 0 ? sortKeys([...colKeys.keys()]) : [''];
    const valName = `${agg.label} of ${headers[vi]}`;
    const out = [];
    if (ci >= 0) { out.push([valName, headers[ci]].concat(new Array(cks.length).fill(null))); out.push([headers[ri], ...cks, 'Grand Total']); }
    else out.push([headers[ri], valName]);
    for (const rk of rks) {
      const row = [rk];
      for (const ck of cks) { const k = JSON.stringify([rk, ck]); row.push(cells.has(k) ? agg.done(cells.get(k)) : null); }
      if (ci >= 0) row.push(agg.done(rowTot.get(rk)));
      out.push(row);
    }
    const tot = ['Grand Total', ...cks.map(ck => agg.done(colTot.get(ck)))]; if (ci >= 0) tot.push(agg.done(grand));
    out.push(tot);
    return { rows: out, headerRows: ci >= 0 ? 2 : 1, valCol: vi, nCols: out[out.length - 1].length };
  }
  const API = { build, AGG };
  if (isNode) module.exports = API; else root.SheetPivot = API;
})(typeof self !== 'undefined' ? self : this);
