'use strict';
/* Lumen Layout — Step and Repeat: duplicate the selection a number of times at a fixed offset, or as a
   rows × columns grid (business cards, labels, tickets). Text frames get independent copies of their stories.
   One undoable step; the new copies are selected afterwards. */
const StepRepeat = (() => {
  const last = { count: 3, dx: 0, dy: 36, grid: false, rows: 2, cols: 2 };
  function topLevel() {
    return S.sel.map(id => S.eng.idx.get(id)).filter(i => i && !i.parent);
  }
  // pure operation (used by the dialog and by tests): returns the ids of the new items
  function run(o) {
    const infs = topLevel(); if (!infs.length) return [];
    const offs = [];
    if (o.grid) { const R = Math.max(1, Math.min(100, o.rows | 0)), C = Math.max(1, Math.min(100, o.cols | 0)); for (let r = 0; r < R; r++) for (let c = 0; c < C; c++) if (r || c) offs.push([c * o.dx, r * o.dy]); }
    else { const n = Math.max(0, Math.min(500, o.count | 0)); for (let k = 1; k <= n; k++) offs.push([k * o.dx, k * o.dy]); }
    if (!offs.length) return [];
    const byPage = new Map(); infs.forEach(i => { const a = byPage.get(i.page) || []; a.push(i.item); byPage.set(i.page, a); });
    const ids = [];
    for (const [p, items] of byPage) for (const [dx, dy] of offs) { const cl = Tools.cloneItems(items, dx, dy); p.items.push(...cl); ids.push(...cl.map(c => c.id)); }
    return ids;
  }
  function dialog() {
    if (S.edit) Tools.T.exit();
    if (!topLevel().length) { Aero.toast('Select one or more objects first'); return; }
    const u = S.doc.units, f = v => +M.fmtU(v, u);
    const b = Tools.selBox();
    if (b && !last.used) { last.dx = b.w + 12; last.dy = 0; }
    Aero.dialog({ title: 'Step and Repeat', instruction: 'Duplicate the selection at a fixed offset, or fill a grid', width: 440, fields: [
      { key: 'grid', label: 'Create as a grid', type: 'checkbox', value: last.grid },
      { key: 'count', label: 'Repeat count', type: 'number', value: last.count, min: 1, max: 500, step: 1 },
      { key: 'rows', label: 'Grid rows', type: 'number', value: last.rows, min: 1, max: 100, step: 1 },
      { key: 'cols', label: 'Grid columns', type: 'number', value: last.cols, min: 1, max: 100, step: 1 },
      { key: 'dx', label: `Horizontal offset (${u})`, type: 'number', value: f(last.dx), step: 0.1 },
      { key: 'dy', label: `Vertical offset (${u})`, type: 'number', value: f(last.dy), step: 0.1 }],
      onOK: v => {
        Object.assign(last, { grid: !!v.grid, count: v.count | 0, rows: v.rows | 0, cols: v.cols | 0, dx: M.fromU(+v.dx || 0, u), dy: M.fromU(+v.dy || 0, u), used: true });
        const ids = run(last);
        if (!ids.length) { Aero.toast('Nothing to repeat'); return; }
        S.sel = ids; commit('Step and Repeat');
        Aero.toast(`Created ${ids.length} cop${ids.length === 1 ? 'y' : 'ies'}`);
      } });
  }
  return { dialog, run };
})();
