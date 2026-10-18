'use strict';
/* Lumen Sheets — application shell: menus, command bar, sheet tabs, dialogs, clipboard, files, charts layer. */
(function () {
  const F = Formula, M = SheetModel, Fmt = SheetFormat, IO = SheetIO, CH = SheetCharts, PV = SheetPivot, P = SheetPaint;
  const { MAXR, MAXC } = F;
  const $ = s => document.querySelector(s);
  const esc = Aero.esc;
  let wb = null, grid = null, docName = 'Book1', docPath = null, docFormat = 'lsheet', clip = null, painter = null;
  const chartEls = new Map();
  const sheet = () => wb.sheets[wb.active];
  const App = window.SheetApp = { get wb() { return wb; }, get grid() { return grid; }, writePivot, open: openBuffer, setWorkbook, sheet };

  /* ================= icons ================= */
  const I = {
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    paste: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 10h6M9 14h6M9 18h3"/>', cut: '<circle cx="6" cy="18" r="3"/><circle cx="18" cy="18" r="3"/><path d="M8 16 19 3M16 16 5 3"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/>', painter: '<rect x="4" y="3" width="14" height="6" rx="1"/><path d="M18 6h2v5h-8v3M11 14h2v7h-2z"/>',
    alL: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>', alC: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>', alR: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
    vT: '<path d="M4 4h16M12 20V9M8 13l4-4 4 4"/>', vM: '<path d="M4 12h16M12 3v5M12 21v-5M9 5l3 3 3-3M9 19l3-3 3 3"/>', vB: '<path d="M4 20h16M12 4v11M8 11l4 4 4-4"/>',
    wrap: '<path d="M4 6h16M4 12h13a3 3 0 0 1 0 6h-4M15 16l-2 2 2 2M4 18h6"/>', merge: '<rect x="3" y="6" width="18" height="12" rx="1"/><path d="M7 12h10M9 10l-2 2 2 2M15 10l2 2-2 2"/>',
    border: '<rect x="4" y="4" width="16" height="16"/><path d="M4 12h16M12 4v16" stroke-dasharray="2 2"/>', fill: '<path d="M5 12 12 5l6 6-7 7z"/><path d="M19 13s2 2.4 2 3.5a2 2 0 0 1-4 0c0-1.1 2-3.5 2-3.5"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>', chart: '<path d="M4 20V11M10 20V5M16 20v-7M21 20H3"/>', cf: '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9.5h18M3 14.5h18M9 4v16"/>',
    freeze: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M9 3v18"/>', pivot: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M3 9h18M9 3v18M13 14h5M15.5 11.5v5"/>'
  };
  const svg = k => `<svg viewBox="0 0 24 24">${I[k]}</svg>`;
  const FONTS = ['Calibri', 'Arial', 'Segoe UI', 'Cambria', 'Georgia', 'Times New Roman', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Consolas', 'Courier New'];
  const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
  const NF_PRESETS = [['General', 'General'], ['0.00', 'Number'], ['$#,##0.00', 'Currency'], ['_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)', 'Accounting'], ['m/d/yyyy', 'Short date'], ['dddd, mmmm d, yyyy', 'Long date'], ['h:mm:ss AM/PM', 'Time'], ['0.00%', 'Percentage'], ['# ?/?', 'Fraction'], ['0.00E+00', 'Scientific'], ['@', 'Text']];

  /* ================= command bar ================= */
  function buildCmdBar() {
    const B = (id, title, inner, cls = '') => `<button class="aero-btn ${cls}" id="${id}" title="${title}">${inner}</button>`;
    $('#cmd').innerHTML = [
      B('bUndo', 'Undo (Ctrl+Z)', svg('undo')), B('bRedo', 'Redo (Ctrl+Y)', svg('redo')), '<span class="sep"></span>',
      B('bPaste', 'Paste (Ctrl+V) — click the arrow side for paste options', svg('paste'), 'split'), B('bCut', 'Cut (Ctrl+X)', svg('cut')), B('bCopy', 'Copy (Ctrl+C)', svg('copy')), B('bPainter', 'Format Painter — copy formatting to the next selection', svg('painter')), '<span class="sep"></span>',
      `<select id="selFont" title="Font">${FONTS.map(f => `<option>${f}</option>`).join('')}</select>`, `<select id="selSize" title="Font size">${SIZES.map(s => `<option>${s}</option>`).join('')}</select>`,
      B('bBold', 'Bold (Ctrl+B)', '<b>B</b>'), B('bItal', 'Italic (Ctrl+I)', '<i>I</i>'), B('bUnder', 'Underline (Ctrl+U)', '<u>U</u>'),
      B('bColor', 'Font color', '<span style="font:700 13px Georgia,serif">A</span><span class="cbar" id="cbarText" style="background:#c00000"></span>', 'split'), B('bFillC', 'Fill color', svg('fill') + '<span class="cbar" id="cbarFill" style="background:#ffff00"></span>', 'split'), B('bBorder', 'Borders', svg('border'), 'split'), '<span class="sep"></span>',
      B('bAlL', 'Align left', svg('alL')), B('bAlC', 'Center', svg('alC')), B('bAlR', 'Align right', svg('alR')), B('bVA', 'Vertical alignment', svg('vB'), 'split'), B('bWrap', 'Wrap text', svg('wrap')), B('bMerge', 'Merge & Center', svg('merge')), '<span class="sep"></span>',
      `<select id="selNf" title="Number format">${NF_PRESETS.map(([c, n]) => `<option value="${esc(c)}">${n}</option>`).join('')}<option value="__custom">Custom…</option></select>`,
      B('bCur', 'Currency format', '$'), B('bPct', 'Percent style', '%'), B('bDecU', 'Increase decimals', '.0<sub>+</sub>', 'txt'), B('bDecD', 'Decrease decimals', '.0<sub>−</sub>', 'txt'), '<span class="sep"></span>',
      B('bSum', 'AutoSum (Alt+=) — arrow side for Average, Count, Max, Min', '<span style="font:600 15px Georgia,serif">Σ</span>', 'split'), B('bSortA', 'Sort A to Z', 'A↓Z', 'txt'), B('bSortZ', 'Sort Z to A', 'Z↓A', 'txt'), B('bFilter', 'Filter (Ctrl+Shift+L)', svg('filter')), '<span class="sep"></span>',
      B('bCF', 'Conditional formatting', svg('cf'), 'split'), B('bChart', 'Insert chart', svg('chart'), 'split'), B('bPivot', 'PivotTable', svg('pivot')), B('bFreeze', 'Freeze panes', svg('freeze'), 'split')
    ].join('');
    const on = (id, fn) => $('#' + id).addEventListener('click', fn);
    const splitSide = (e, el) => e.offsetX > el.offsetWidth - 14;
    on('bUndo', undo); on('bRedo', redo);
    $('#bPaste').addEventListener('click', e => splitSide(e, e.currentTarget) ? popupMenu(e.currentTarget, [['Paste', menuPaste], ['Paste values', () => pasteSpecial({ values: true })], ['Paste formatting', () => pasteSpecial({ formats: true })], ['Paste transposed', () => pasteSpecial({ transpose: true })], ['Paste Special…', pasteSpecialDialog]]) : menuPaste());
    on('bCut', () => execClip('cut')); on('bCopy', () => execClip('copy'));
    on('bPainter', () => { painter = cellStyle() || {}; $('#bPainter').classList.add('on'); Aero.toast('Select the cells to receive the formatting'); });
    $('#selFont').addEventListener('change', e => { applyStyle({ font: e.target.value === 'Calibri' ? null : e.target.value }); grid.kbd.focus(); });
    $('#selSize').addEventListener('change', e => { applyStyle({ sz: +e.target.value === 11 ? null : +e.target.value }); autoRowHeights(); grid.kbd.focus(); });
    on('bBold', () => toggle('b')); on('bItal', () => toggle('i')); on('bUnder', () => toggle('u'));
    let lastText = '#c00000', lastFill = '#ffff00';
    $('#bColor').addEventListener('click', e => splitSide(e, e.currentTarget) ? palette(e.currentTarget, c => { if (c) { lastText = c; $('#cbarText').style.background = c; } applyStyle({ color: c }); }, 'Automatic') : applyStyle({ color: lastText }));
    $('#bFillC').addEventListener('click', e => splitSide(e, e.currentTarget) ? palette(e.currentTarget, c => { if (c) { lastFill = c; $('#cbarFill').style.background = c; } applyStyle({ fill: c }); }, 'No fill') : applyStyle({ fill: lastFill }));
    on('bBorder', e => borderMenu(e.currentTarget));
    on('bAlL', () => applyStyle({ ha: cellStyle().ha === 'left' ? null : 'left' })); on('bAlC', () => applyStyle({ ha: cellStyle().ha === 'center' ? null : 'center' })); on('bAlR', () => applyStyle({ ha: cellStyle().ha === 'right' ? null : 'right' }));
    on('bVA', e => popupMenu(e.currentTarget, [['Top', () => applyStyle({ va: 'top' })], ['Middle', () => applyStyle({ va: 'middle' })], ['Bottom', () => applyStyle({ va: null })]]));
    on('bWrap', () => { toggle('wrap'); autoRowHeights(); }); on('bMerge', mergeCenter);
    $('#selNf').addEventListener('change', e => { const v = e.target.value; if (v === '__custom') formatCellsDialog(); else applyStyle({ nf: v === 'General' ? null : v }); grid.kbd.focus(); });
    on('bCur', () => applyStyle({ nf: '$#,##0.00' })); on('bPct', () => applyStyle({ nf: '0%' }));
    on('bDecU', () => changeDecimals(1)); on('bDecD', () => changeDecimals(-1));
    $('#bSum').addEventListener('click', e => splitSide(e, e.currentTarget) ? popupMenu(e.currentTarget, [['Sum', () => autoSum('SUM')], ['Average', () => autoSum('AVERAGE')], ['Count numbers', () => autoSum('COUNT')], ['Max', () => autoSum('MAX')], ['Min', () => autoSum('MIN')], '-', ['More functions…', insertFunctionDialog]]) : autoSum('SUM'));
    on('bSortA', () => sortSel(true)); on('bSortZ', () => sortSel(false)); on('bFilter', toggleFilter);
    on('bCF', e => popupMenu(e.currentTarget, cfMenuItems()));
    on('bChart', e => popupMenu(e.currentTarget, CH.TYPES.map(([t, n]) => [n, () => insertChart(t)])));
    on('bPivot', pivotDialog);
    on('bFreeze', e => popupMenu(e.currentTarget, [['Freeze panes at selection', freezeAtSel], ['Freeze top row', () => setFreeze(1, 0)], ['Freeze first column', () => setFreeze(0, 1)], ['Unfreeze panes', () => setFreeze(0, 0)]]));
  }
  function syncToolbar() {
    if (!grid) return;
    const s = cellStyle();
    const set = (id, v) => $('#' + id).classList.toggle('on', !!v);
    set('bBold', s.b); set('bItal', s.i); set('bUnder', s.u); set('bWrap', s.wrap);
    set('bAlL', s.ha === 'left'); set('bAlC', s.ha === 'center'); set('bAlR', s.ha === 'right');
    $('#bVA').innerHTML = svg(s.va === 'top' ? 'vT' : s.va === 'middle' ? 'vM' : 'vB');
    set('bMerge', !!sheet().mergeAt(grid.sel.r, grid.sel.c)); set('bFilter', !!sheet().filter);
    const fs = $('#selFont'); if (fs.value !== (s.font || 'Calibri')) { if (![...fs.options].some(o => o.value === (s.font || 'Calibri'))) fs.add(new Option(s.font)); fs.value = s.font || 'Calibri'; }
    const ss = $('#selSize'); const sz = String(s.sz || 11); if (![...ss.options].some(o => o.value === sz)) ss.add(new Option(sz)); ss.value = sz;
    const nf = $('#selNf'), code = s.nf || 'General'; nf.value = [...nf.options].some(o => o.value === code) ? code : '__custom';
    $('#bUndo').disabled = !wb.undoStack.length; $('#bRedo').disabled = !wb.redoStack.length;
  }
  function cellStyle() { const c = sheet().get(grid.sel.r, grid.sel.c); return c && c.s || {}; }

  /* ================= popups ================= */
  const popup = $('#popup');
  function closePopup() { popup.hidden = true; popup.innerHTML = ''; popup.className = 'sh-popup'; }
  document.addEventListener('mousedown', e => { if (!popup.hidden && !popup.contains(e.target)) closePopup(); }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !popup.hidden) { closePopup(); e.stopPropagation(); } }, true);
  function showPopupAt(x, y) {
    popup.hidden = false; popup.style.left = '0px'; popup.style.top = '0px';
    const r = popup.getBoundingClientRect();
    popup.style.left = Math.max(2, Math.min(x, innerWidth - r.width - 4)) + 'px';
    popup.style.top = Math.max(2, Math.min(y, innerHeight - r.height - 4)) + 'px';
  }
  function popupMenu(anchor, items, at) {
    closePopup();
    popup.innerHTML = items.map((it, i) => it === '-' ? '<div class="ms"></div>' : typeof it === 'string' ? `<div class="mh">${esc(it.slice(1))}</div>` : `<div class="mi${it[3] ? ' dis' : ''}" data-i="${i}"><span>${esc(it[0])}</span><span class="k">${esc(it[2] || '')}</span></div>`).join('');
    popup.onclick = e => { const mi = e.target.closest('.mi'); if (!mi) return; const it = items[+mi.dataset.i]; closePopup(); it[1](); };
    if (at) showPopupAt(at.x, at.y); else { const r = anchor.getBoundingClientRect(); showPopupAt(r.left, r.bottom + 2); }
  }
  const THEME = ['#ffffff', '#000000', '#e7e6e6', '#44546a', '#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'];
  const STD = ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'];
  function palette(anchor, cb, noneLabel) {
    closePopup();
    const rows = [THEME, ...[0.8, 0.6, 0.4, -0.25, -0.5].map(t => THEME.map(c => t > 0 ? M.mixHex(c, '#ffffff', t) : M.mixHex(c, '#000000', -t)))];
    popup.innerHTML = `<div class="pal-row"><button class="aero-btn" data-c="">${esc(noneLabel)}</button></div><div class="pal">${rows.flat().map(c => `<i style="background:${c}" data-c="${c}" title="${c}"></i>`).join('')}</div><div class="mh">Standard colors</div><div class="pal">${STD.map(c => `<i style="background:${c}" data-c="${c}"></i>`).join('')}</div><div class="pal-row"><button class="aero-btn" data-more="1">More colors…</button><input type="color" id="palMore" style="display:none"></div>`;
    popup.onclick = e => {
      const t = e.target;
      if (t.dataset.more) { const inp = $('#palMore'); inp.oninput = () => { closePopup(); cb(inp.value); }; inp.click(); return; }
      if (t.dataset.c != null) { closePopup(); cb(t.dataset.c || null); }
    };
    const r = anchor.getBoundingClientRect(); showPopupAt(r.left, r.bottom + 2);
  }
  function borderMenu(anchor) {
    const thin = { style: 'thin', color: '#000000' };
    popupMenu(anchor, [['Bottom border', () => borders('bottom', thin)], ['Top border', () => borders('top', thin)], ['Left border', () => borders('left', thin)], ['Right border', () => borders('right', thin)], '-',
      ['All borders', () => borders('all', thin)], ['Outside borders', () => borders('outside', thin)], ['Thick outside borders', () => borders('outside', { style: 'medium', color: '#000000' })], ['Bottom double border', () => borders('bottom', { style: 'double', color: '#000000' })], ['Thick bottom border', () => borders('bottom', { style: 'medium', color: '#000000' })], '-',
      ['No border', () => borders('none')], ['Dashed outline', () => borders('outside', { style: 'dashed', color: '#7f7f7f' })]]);
  }

  /* ================= selection helpers ================= */
  function effRange(g) {
    const b = sheet().bounds();
    return { r1: g.r1, c1: g.c1, r2: g.r2 >= MAXR - 1 ? Math.max(g.r1, b.r) : g.r2, c2: g.c2 >= MAXC - 1 ? Math.max(g.c1, b.c) : g.c2 };
  }
  const eachCell = (fn) => { for (const g0 of grid.sel.ranges) { const g = effRange(g0); for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) fn(r, c); } };
  function applyStyle(patch, label = 'Format') {
    const sh = sheet();
    wb.transact(label, () => eachCell((r, c) => { const mg = sh.mergeAt(r, c); if (mg && (mg.r1 !== r || mg.c1 !== c)) return; wb.setStyle(sh, r, c, patch); }));
    grid.kbd.focus();
  }
  function toggle(k) { applyStyle({ [k]: cellStyle()[k] ? null : 1 }); }
  function borders(kind, b) {
    const sh = sheet();
    wb.transact('Borders', () => {
      for (const g0 of grid.sel.ranges) {
        const g = effRange(g0);
        for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) {
          const p = {};
          if (kind === 'none') Object.assign(p, { bt: null, bb: null, bl: null, br: null });
          if (kind === 'all') Object.assign(p, { bt: b, bb: b, bl: b, br: b });
          if (kind === 'outside') { if (r === g.r1) p.bt = b; if (r === g.r2) p.bb = b; if (c === g.c1) p.bl = b; if (c === g.c2) p.br = b; }
          if (kind === 'bottom' && r === g.r2) p.bb = b; if (kind === 'top' && r === g.r1) p.bt = b; if (kind === 'left' && c === g.c1) p.bl = b; if (kind === 'right' && c === g.c2) p.br = b;
          if (Object.keys(p).length) wb.setStyle(sh, r, c, p);
        }
      }
    });
  }
  function changeDecimals(d) {
    const sh = sheet(), s = cellStyle(), v = sh.value(grid.sel.r, grid.sel.c);
    let nf = s.nf;
    if (!nf || nf === 'General') {
      const dec = typeof v === 'number' ? (Fmt.general(v).split('.')[1] || '').length : 0;
      const n = Math.max(0, dec + d); nf = n ? '0.' + '0'.repeat(n) : '0';
    } else {
      nf = nf.split(';').map(sec => {
        if (/[dmyhs]/i.test(sec.replace(/"[^"]*"|\[[^\]]*\]/g, ''))) return sec;
        if (d > 0) return /\.0*/.test(sec) && /0\./.test(sec) ? sec.replace(/(0\.)(0*)/, (m, a, z) => a + z + '0') : sec.replace(/([0#])(?![0#,.])/, '$1.0');
        return sec.replace(/0\.(0*)0/, (m, z) => z ? '0.' + z : '0');
      }).join(';');
    }
    applyStyle({ nf });
  }
  function mergeCenter() {
    const sh = sheet(), g = effRange(grid.range);
    const existing = sh.merges.filter(m => m.r2 >= g.r1 && m.r1 <= g.r2 && m.c2 >= g.c1 && m.c1 <= g.c2);
    if (existing.length && existing.some(m => m.r1 === g.r1 && m.c1 === g.c1 && m.r2 === g.r2 && m.c2 === g.c2) || (g.r1 === g.r2 && g.c1 === g.c2)) {
      if (!existing.length) return;
      wb.transact('Unmerge', () => wb.setMeta(sh, 'merges', sh.merges.filter(m => !existing.includes(m)))); grid.render(); return;
    }
    let others = 0; for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) if ((r !== g.r1 || c !== g.c1) && sh.value(r, c) != null) others++;
    const go = () => {
      wb.transact('Merge & Center', () => {
        for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) if (r !== g.r1 || c !== g.c1) { const cell = sh.get(r, c); if (cell && (cell.v != null || cell.f != null)) wb.setCell(sh, r, c, cell.s ? { v: null, s: cell.s } : null); }
        wb.setMeta(sh, 'merges', sh.merges.filter(m => !existing.includes(m)).concat([{ r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 }]));
        wb.setStyle(sh, g.r1, g.c1, { ha: 'center' });
      });
      grid.select(g.r1, g.c1);
    };
    if (others) Aero.confirm('Merge cells', 'Merging keeps only the upper-left value and discards the other values.').then(ok => ok && go()); else go();
  }
  function unmerge() { const sh = sheet(), g = effRange(grid.range); const ex = sh.merges.filter(m => m.r2 >= g.r1 && m.r1 <= g.r2 && m.c2 >= g.c1 && m.c1 <= g.c2); if (ex.length) wb.transact('Unmerge', () => wb.setMeta(sh, 'merges', sh.merges.filter(m => !ex.includes(m)))); }

  /* ================= editing commands ================= */
  function undo() { if (grid.edit) grid.cancelEdit(); const l = wb.undo(); if (l) Aero.toast('Undo: ' + l, 1200); afterHistory(); }
  function redo() { if (grid.edit) grid.cancelEdit(); const l = wb.redo(); if (l) Aero.toast('Redo: ' + l, 1200); afterHistory(); }
  function afterHistory() { wb.active = Math.min(wb.active, wb.sheets.length - 1); grid.invalidate(); grid.sel.ranges = grid.sel.ranges.map(g => ({ ...g })); refreshAll(); }
  function clear(kind) {
    const sh = sheet();
    wb.transact(kind === 'contents' ? 'Clear contents' : kind === 'formats' ? 'Clear formats' : 'Clear', () => {
      eachCell((r, c) => {
        const cell = sh.get(r, c); if (!cell) return;
        if (kind === 'contents') { if (cell.v != null || cell.f != null) wb.setCell(sh, r, c, cell.s ? { v: null, s: cell.s } : null); }
        else if (kind === 'formats') { if (cell.s) wb.setCell(sh, r, c, { v: cell.v, f: cell.f }); }
        else wb.setCell(sh, r, c, null);
      });
      if (kind !== 'contents') {
        const gs = grid.sel.ranges.map(effRange);
        const keep = sh.merges.filter(m => !gs.some(g => m.r1 >= g.r1 && m.r2 <= g.r2 && m.c1 >= g.c1 && m.c2 <= g.c2));
        if (keep.length !== sh.merges.length) wb.setMeta(sh, 'merges', keep);
        const cf = sh.cf.filter(rule => !gs.some(g => rule.range.r1 >= g.r1 && rule.range.r2 <= g.r2 && rule.range.c1 >= g.c1 && rule.range.c2 <= g.c2));
        if (cf.length !== sh.cf.length) wb.setMeta(sh, 'cf', cf);
      }
    });
  }
  function fillDir(dir) {
    const sh = sheet(), g = effRange(grid.range);
    if (dir === 'down') { if (g.r1 === g.r2) { if (g.r1 === 0) return; wb.fill(sh, { ...g, r1: g.r1 - 1, r2: g.r1 - 1 }, { ...g, r1: g.r1 - 1 }, 'down'); } else wb.fill(sh, { ...g, r2: g.r1 }, g, 'down'); }
    else { if (g.c1 === g.c2) { if (g.c1 === 0) return; wb.fill(sh, { ...g, c1: g.c1 - 1, c2: g.c1 - 1 }, { ...g, c1: g.c1 - 1 }, 'right'); } else wb.fill(sh, { ...g, c2: g.c1 }, g, 'right'); }
  }
  function fillDownToData() {
    const sh = sheet(), g = grid.range;
    const col = g.c1 > 0 && sh.value(g.r2 + 1, g.c1 - 1) != null ? g.c1 - 1 : sh.value(g.r2 + 1, g.c2 + 1) != null ? g.c2 + 1 : -1;
    if (col < 0) return;
    let r = g.r2; while (r + 1 < MAXR && sh.value(r + 1, col) != null) r++;
    if (r === g.r2) return;
    wb.fill(sh, g, { ...g, r2: r }, 'down'); grid.selectRange({ ...g, r2: r }, { r: grid.sel.r, c: grid.sel.c });
  }
  function autoSum(fn = 'SUM') {
    const sh = sheet(), g = grid.range;
    if (g.r1 === g.r2 && g.c1 === g.c2) {
      const r = g.r1, c = g.c1; let a = r - 1;
      const isNum = (rr, cc) => typeof sh.value(rr, cc) === 'number';
      if (a >= 0 && isNum(a, c)) { while (a - 1 >= 0 && isNum(a - 1, c)) a--; grid.startEdit(`=${fn}(${F.rangeText({ r1: a, c1: c, r2: r - 1, c2: c })})`); return; }
      let b = c - 1; if (b >= 0 && isNum(r, b)) { while (b - 1 >= 0 && isNum(r, b - 1)) b--; grid.startEdit(`=${fn}(${F.rangeText({ r1: r, c1: b, r2: r, c2: c - 1 })})`); return; }
      grid.startEdit(`=${fn}()`); const ed = grid.editor; ed.setSelectionRange(ed.value.length - 1, ed.value.length - 1); return;
    }
    const e = effRange(g);
    wb.transact('AutoSum', () => { for (let c = e.c1; c <= e.c2; c++) wb.input(sh, e.r2 + 1, c, `=${fn}(${F.rangeText({ r1: e.r1, c1: c, r2: e.r2, c2: c })})`); });
  }

  /* ================= clipboard ================= */
  const norm = t => String(t || '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
  function copyRangeOf() { if (grid.sel.ranges.length > 1) { Aero.toast('That command cannot be used on multiple selections'); return null; } return effRange(grid.range); }
  function onCopy(e, cut) {
    const g = copyRangeOf(); if (!g) { e.preventDefault(); return; }
    const sh = sheet(), text = IO.rangeTSV(wb, sh, g), html = IO.rangeHTML(wb, sh, g);
    e.clipboardData.setData('text/plain', text); e.clipboardData.setData('text/html', html); e.preventDefault();
    clip = { text, data: wb.copyRange(sh, g), cut, range: g, sheet: sh };
    grid.copyMark = { sheet: sh, range: g }; grid.render();
    if (cut) Aero.toast('Select the destination and press Enter or Ctrl+V', 1600);
  }
  function onPaste(e) { e.preventDefault(); pasteData(e.clipboardData.getData('text/plain'), e.clipboardData.getData('text/html'), {}); }
  function pasteTarget() {
    const g = grid.range, rows = g.r2 - g.r1 + 1, cols = g.c2 - g.c1 + 1;
    return { r: g.r1, c: g.c1, tile: rows > 1 || cols > 1 ? { rows: g.r2 >= MAXR - 1 ? 1 : rows, cols: g.c2 >= MAXC - 1 ? 1 : cols } : null };
  }
  function pasteData(text, html, opts) {
    const sh = sheet(), t = pasteTarget();
    if (clip && (text == null || norm(text) === norm(clip.text))) {
      if (clip.cut && clip.sheet !== sh) clip.data.sheet = clip.sheet;
      wb.pasteClip(sh, t.r, t.c, clip.data, Object.assign({ cut: clip.cut, tile: t.tile }, opts));
      const R = opts.transpose ? clip.data.cols : clip.data.rows, C = opts.transpose ? clip.data.rows : clip.data.cols;
      grid.selectRange({ r1: t.r, c1: t.c, r2: t.r + (t.tile && t.tile.rows % R === 0 ? t.tile.rows : R) - 1, c2: t.c + (t.tile && t.tile.cols % C === 0 ? t.tile.cols : C) - 1 }, { r: t.r, c: t.c });
      if (clip.cut) { clip = null; grid.copyMark = null; }
      return;
    }
    let table = null, merges = [];
    if (html && /<table/i.test(html)) { const p = IO.parseHTMLTable(html); if (p) { table = p.rows; merges = p.merges; } }
    if (!table && text) { const rows = IO.parseDelimited(text.replace(/\r?\n$/, ''), '\t').rows; table = rows.map(r => r.map(v => ({ text: v, style: null }))); }
    if (!table || !table.length) return;
    if (opts.transpose) table = table[0].map((_, j) => table.map(r => r[j]));
    wb.transact('Paste', () => {
      table.forEach((row, i) => row.forEach((x, j) => {
        const r = t.r + i, c = t.c + j; if (r >= MAXR || c >= MAXC || x === undefined) return;
        if (x === null) { if (!opts.formats) wb.setCell(sh, r, c, null); return; }
        if (!opts.formats) wb.input(sh, r, c, x.text);
        if (x.style && !opts.values) wb.setStyle(sh, r, c, x.style);
      }));
      if (merges.length && !opts.values && !opts.transpose) wb.setMeta(sh, 'merges', sh.merges.concat(merges.map(m => ({ r1: m.r1 + t.r, c1: m.c1 + t.c, r2: m.r2 + t.r, c2: m.c2 + t.c }))));
    });
    grid.selectRange({ r1: t.r, c1: t.c, r2: t.r + table.length - 1, c2: t.c + Math.max(...table.map(r => r.length)) - 1 }, { r: t.r, c: t.c });
  }
  function execClip(kind) { grid.kbd.focus(); grid.kbd.select(); try { if (!document.execCommand(kind)) throw 0; } catch (e) { Aero.toast(`Press Ctrl+${kind === 'copy' ? 'C' : 'X'} to ${kind}`); } }
  async function menuPaste(opts = {}) {
    let text = null, html = null;
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const items = await navigator.clipboard.read();
        for (const it of items) { if (it.types.includes('text/html')) html = await (await it.getType('text/html')).text(); if (it.types.includes('text/plain')) text = await (await it.getType('text/plain')).text(); }
      } else text = await navigator.clipboard.readText();
    } catch (e) { if (!clip) { Aero.toast('Press Ctrl+V to paste from other apps'); return; } }
    pasteData(text, html, opts);
  }
  function pasteSpecial(opts) { menuPaste(opts); }
  function pasteSpecialDialog() {
    Aero.dialog({ title: 'Paste Special', fields: [{ key: 'what', label: 'Paste', type: 'select', value: 'all', options: [['all', 'All'], ['values', 'Values'], ['formats', 'Formats']] }, { key: 'tr', label: 'Transpose', type: 'checkbox', value: false }],
      onOK: v => menuPaste({ values: v.what === 'values', formats: v.what === 'formats', transpose: v.tr }) });
  }

  /* ================= rows / columns ================= */
  function selRowsCols(axis) { const g = grid.range; return axis === 'row' ? [g.r1, g.r2] : [g.c1, g.c2]; }
  function insertRC(axis, after) { const [a, b] = selRowsCols(axis), n = b - a + 1; if (n > 5000) { Aero.toast('Select fewer rows/columns'); return; } axis === 'row' ? wb.insertRows(sheet(), after ? b + 1 : a, n) : wb.insertCols(sheet(), after ? b + 1 : a, n); grid.invalidate(); }
  function deleteRC(axis) { let [a, b] = selRowsCols(axis); const sh = sheet(); if (axis === 'row') b = Math.min(b, Math.max(a, sh.bounds().r)); else b = Math.min(b, Math.max(a, sh.bounds().c)); axis === 'row' ? wb.insertRows(sh, a, -(b - a + 1)) : wb.insertCols(sh, a, -(b - a + 1)); grid.invalidate(); grid.select(Math.min(grid.sel.r, MAXR - 1), grid.sel.c); }
  function hideRC(axis, hide) {
    const sh = sheet(), [a, b0] = selRowsCols(axis), b = Math.min(b0, a + 100000);
    const prop = axis === 'row' ? 'hiddenRows' : 'hiddenCols', set = new Set(sh[prop]);
    if (hide) for (let i = a; i <= b; i++) set.add(i); else for (const i of [...set]) if (i >= a - (hide ? 0 : 1) && i <= b + 1) set.delete(i);
    if (!hide && a === b) { for (let i = a - 1; i >= 0 && set.has(i); i--) set.delete(i); }
    wb.transact(hide ? 'Hide' : 'Unhide', () => wb.setMeta(sh, prop, set)); grid.invalidate(); grid.render();
  }
  function sizeDialog(axis) {
    const sh = sheet(), [a, b] = selRowsCols(axis), map = axis === 'row' ? sh.rowH : sh.colW, cur = map.get(a) ?? (axis === 'row' ? 20 : 72);
    Aero.dialog({ title: axis === 'row' ? 'Row Height' : 'Column Width', fields: [{ key: 'v', label: (axis === 'row' ? 'Row height' : 'Column width') + ' (px)', type: 'number', value: cur, min: 0, max: 1000 }],
      onOK: v => { const m = new Map(map); for (let i = a; i <= Math.min(b, a + 16384); i++) m.set(i, Math.max(0, Math.min(1000, v.v))); wb.transact(axis === 'row' ? 'Row height' : 'Column width', () => wb.setMeta(sh, axis === 'row' ? 'rowH' : 'colW', m)); grid.invalidate(); grid.render(); } });
  }
  function autofit(axis, i) {
    const sh = sheet(), ctx = grid.ctx, b = sh.bounds();
    if (axis === 'col') {
      const g = grid.range, cols = g.r1 === 0 && g.r2 === MAXR - 1 && i >= g.c1 && i <= g.c2 ? [g.c1, Math.min(g.c2, b.c)] : [i, i];
      const m = new Map(sh.colW);
      for (let c = cols[0]; c <= cols[1]; c++) {
        let w = 0; const n = Math.min(b.r, 20000);
        for (let r = 0; r <= n; r++) { const v = sh.value(r, c); if (v == null || sh.mergeAt(r, c)) continue; const cell = sh.get(r, c); if (cell && cell.s && cell.s.wrap) continue; w = Math.max(w, P.textW(ctx, P.fontOf(cell && cell.s, 1), wb.display(sh, r, c).text) + (sh.filter && r === sh.filter.range.r1 ? 18 : 0)); }
        m.set(c, w ? Math.min(600, Math.ceil(w + 12)) : 72);
      }
      wb.transact('AutoFit column', () => wb.setMeta(sh, 'colW', m));
    } else {
      const m = new Map(sh.rowH); rowAutoHeight(sh, i, m); wb.transact('AutoFit row', () => wb.setMeta(sh, 'rowH', m));
    }
    grid.invalidate(); grid.render();
  }
  function rowAutoHeight(sh, r, m) {
    const b = sh.bounds(); let h = 20;
    for (let c = 0; c <= Math.min(b.c, 300); c++) {
      const cell = sh.get(r, c); if (!cell || sh.mergeAt(r, c)) continue;
      const s = cell.s || {}, fsz = (s.sz || 11) * 96 / 72, lh = fsz * 1.22;
      let lines = 1;
      if (s.wrap && sh.value(r, c) != null) { const w = (sh.colW.get(c) ?? 72) - 6; lines = P.wrapLines(grid.ctx, P.fontOf(s, 1), wb.display(sh, r, c).text, w).length; }
      h = Math.max(h, Math.ceil(lines * lh + 7));
    }
    if (h === 20) m.delete(r); else m.set(r, Math.min(400, h));
  }
  function autoRowHeights() {
    const sh = sheet(), g = effRange(grid.range); if (g.r2 - g.r1 > 2000) return;
    const m = new Map(sh.rowH); for (let r = g.r1; r <= g.r2; r++) rowAutoHeight(sh, r, m);
    if (JSON.stringify([...m]) !== JSON.stringify([...sh.rowH])) { wb.transact('Row height', () => wb.setMeta(sh, 'rowH', m)); grid.invalidate(); grid.render(); }
  }

  /* ================= freeze / view ================= */
  function setFreeze(r, c) { const sh = sheet(); wb.transact(r || c ? 'Freeze panes' : 'Unfreeze panes', () => wb.setMeta(sh, 'freeze', { r, c })); grid.scroller.scrollTop = 0; grid.scroller.scrollLeft = 0; grid.invalidate(); grid.render(); }
  function freezeAtSel() { const s = grid.sel; if (!s.r && !s.c) { Aero.toast('Select the cell below and right of the panes to freeze'); return; } setFreeze(s.r, s.c); }
  function zoomBy(d) { setZoom((sheet().zoom || 1) + d); }
  function setZoom(z) { const sh = sheet(); sh.zoom = Math.round(Math.max(0.25, Math.min(4, z)) * 100) / 100; grid.invalidate(); grid.render(); status(); }

  /* ================= sort & filter ================= */
  function looksLikeHeader(sh, g) {
    if (g.r2 <= g.r1) return false;
    let txt = 0, nums = 0;
    for (let c = g.c1; c <= g.c2; c++) { const v = sh.value(g.r1, c), w = sh.value(g.r1 + 1, c); if (typeof v === 'string') txt++; if (typeof w === 'number' && typeof v !== 'number') nums++; }
    const bold = (sh.get(g.r1, g.c1) || {}).s && sh.get(g.r1, g.c1).s.b && !((sh.get(g.r1 + 1, g.c1) || {}).s || {}).b;
    return txt === g.c2 - g.c1 + 1 && (nums > 0 || bold);
  }
  function sortSel(asc) {
    const sh = sheet(), s = grid.sel;
    let g = grid.range, header;
    if (sh.filter && s.r >= sh.filter.range.r1 && s.r <= sh.filter.range.r2 && s.c >= sh.filter.range.c1 && s.c <= sh.filter.range.c2) { g = sh.filter.range; header = true; }
    else if (g.r1 === g.r2 && g.c1 === g.c2) { g = wb.region(sh, s.r, s.c); header = looksLikeHeader(sh, g); }
    else { g = effRange(g); header = looksLikeHeader(sh, g); }
    if (g.r1 === g.r2) return;
    wb.sortRange(sh, g, [{ col: Math.max(g.c1, Math.min(g.c2, s.c)), asc }], header);
    if (sh.filter) wb.transact('Filter', () => wb.applyFilter(sh));
  }
  function sortDialog() {
    const sh = sheet(), s = grid.sel; let g = grid.range;
    if (g.r1 === g.r2 && g.c1 === g.c2) g = sh.filter && s.r >= sh.filter.range.r1 && s.r <= sh.filter.range.r2 ? sh.filter.range : wb.region(sh, s.r, s.c); else g = effRange(g);
    const hdr = looksLikeHeader(sh, g) || !!sh.filter;
    const colOpts = h => { const o = [['', '(none)']]; for (let c = g.c1; c <= g.c2; c++) o.push([String(c), h ? String(sh.value(g.r1, c) ?? 'Column ' + F.colName(c)) : 'Column ' + F.colName(c)]); return o; };
    const ord = [['asc', 'A to Z / smallest first'], ['desc', 'Z to A / largest first']];
    Aero.dialog({ title: 'Sort', instruction: 'Sort ' + F.rangeText(g), fields: [{ key: 'h', label: 'My data has headers', type: 'checkbox', value: hdr },
      { key: 'k1', label: 'Sort by', type: 'select', value: String(Math.max(g.c1, Math.min(g.c2, s.c))), options: colOpts(hdr) }, { key: 'o1', label: 'Order', type: 'select', value: 'asc', options: ord },
      { key: 'k2', label: 'Then by', type: 'select', value: '', options: colOpts(hdr) }, { key: 'o2', label: 'Order', type: 'select', value: 'asc', options: ord },
      { key: 'k3', label: 'Then by', type: 'select', value: '', options: colOpts(hdr) }, { key: 'o3', label: 'Order', type: 'select', value: 'asc', options: ord }],
      onOK: v => { const keys = [[v.k1, v.o1], [v.k2, v.o2], [v.k3, v.o3]].filter(k => k[0] !== '').map(([c, o]) => ({ col: +c, asc: o === 'asc' })); if (keys.length) { wb.sortRange(sh, g, keys, v.h); if (sh.filter) wb.transact('Filter', () => wb.applyFilter(sh)); } } });
  }
  function toggleFilter() {
    const sh = sheet();
    if (sh.filter) { wb.transact('Remove filter', () => { wb.setMeta(sh, 'filter', null); wb.setMeta(sh, 'filtered', new Set()); }); grid.invalidate(); return; }
    let g = grid.range; if (g.r1 === g.r2 && g.c1 === g.c2) g = wb.region(sh, grid.sel.r, grid.sel.c); else g = effRange(g);
    if (sh.value(g.r1, g.c1) == null && g.r1 === g.r2) { Aero.toast('Select a cell in your data first'); return; }
    wb.transact('Filter', () => wb.setMeta(sh, 'filter', { range: g, crit: {} }));
  }
  function clearFilter() { const sh = sheet(); if (!sh.filter) return; wb.transact('Clear filter', () => { wb.setMeta(sh, 'filter', Object.assign({}, sh.filter, { crit: {} })); wb.applyFilter(sh); }); grid.invalidate(); }
  function openFilter(col, x, y) {
    const sh = sheet(), f = sh.filter; if (!f) return;
    closePopup(); popup.className = 'sh-popup filter-pop';
    const g = f.range, crit = (f.crit || {})[col] || {};
    const counts = new Map(); const b = sh.bounds();
    for (let r = g.r1 + 1; r <= Math.min(g.r2, b.r); r++) { const v = sh.value(r, col); const t = v == null || v === '' ? '' : wb.display(sh, r, col).text; if (!counts.has(t)) counts.set(t, typeof v === 'number' ? v : t.toLowerCase()); }
    const vals = [...counts.keys()].sort((a, c) => { if (a === '') return 1; if (c === '') return -1; const x1 = counts.get(a), y1 = counts.get(c); return typeof x1 === typeof y1 ? (x1 < y1 ? -1 : x1 > y1 ? 1 : 0) : typeof x1 === 'number' ? -1 : 1; }).slice(0, 5000);
    const sel = crit.values ? new Set(crit.values) : null;
    const ops = [['', 'Condition: none'], ['=', 'Equals'], ['<>', 'Does not equal'], ['>', 'Greater than'], ['>=', 'Greater or equal'], ['<', 'Less than'], ['<=', 'Less or equal'], ['between', 'Between'], ['contains', 'Contains'], ['notContains', 'Does not contain'], ['begins', 'Begins with'], ['top', 'Top N'], ['aboveAvg', 'Above average'], ['belowAvg', 'Below average']];
    popup.innerHTML = `<div class="lnk" data-a="asc">↑ Sort A to Z</div><div class="lnk" data-a="desc">↓ Sort Z to A</div><div class="ms"></div>
      <div class="row"><select id="fOp" style="width:100%">${ops.map(([v, n]) => `<option value="${v}"${crit.op === v ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="row"><input type="text" id="fV1" placeholder="value" value="${esc(crit.v1 ?? '')}"><input type="text" id="fV2" placeholder="and" value="${esc(crit.v2 ?? '')}" ${crit.op === 'between' ? '' : 'hidden'}></div>
      <input type="search" id="fSearch" placeholder="Search values">
      <div class="fp-list" id="fList"><label><input type="checkbox" id="fAll" ${!sel ? 'checked' : ''}> <b>(Select All)</b></label>${vals.map((v, i) => `<label data-t="${esc(v.toLowerCase())}"><input type="checkbox" data-i="${i}" ${!sel || sel.has(v) ? 'checked' : ''}> ${v === '' ? '<i>(Blanks)</i>' : esc(v)}</label>`).join('')}</div>
      <div class="btns"><button class="aero-btn" data-a="clear">Clear</button><button class="aero-btn pri" data-a="ok">OK</button><button class="aero-btn" data-a="cancel">Cancel</button></div>`;
    showPopupAt(x, y + 1);
    const boxes = () => [...popup.querySelectorAll('#fList input[data-i]')];
    $('#fOp').onchange = () => { $('#fV2').hidden = $('#fOp').value !== 'between'; };
    $('#fAll').onchange = e => boxes().forEach(b2 => { if (!b2.parentElement.hidden) b2.checked = e.target.checked; });
    $('#fSearch').oninput = e => { const q = e.target.value.toLowerCase(); popup.querySelectorAll('#fList label[data-t]').forEach(l => { l.hidden = q && !l.dataset.t.includes(q); }); };
    popup.onclick = e => {
      const a = e.target.dataset.a; if (!a) return;
      if (a === 'cancel') return closePopup();
      if (a === 'asc' || a === 'desc') { closePopup(); wb.sortRange(sh, g, [{ col, asc: a === 'asc' }], true); wb.transact('Filter', () => wb.applyFilter(sh)); return; }
      const nc = Object.assign({}, f.crit || {});
      if (a === 'clear') delete nc[col];
      else {
        const op = $('#fOp').value, all = boxes().every(b2 => b2.checked);
        if (op) nc[col] = { op, v1: $('#fV1').value, v2: $('#fV2').value };
        else if (all) delete nc[col];
        else nc[col] = { values: boxes().filter(b2 => b2.checked).map(b2 => vals[+b2.dataset.i]) };
      }
      closePopup();
      wb.transact('Filter', () => { wb.setMeta(sh, 'filter', Object.assign({}, f, { crit: nc })); wb.applyFilter(sh); });
      grid.invalidate(); grid.render();
    };
  }
  function removeDuplicates() {
    const sh = sheet(); let g = grid.range; if (g.r1 === g.r2 && g.c1 === g.c2) g = wb.region(sh, grid.sel.r, grid.sel.c); else g = effRange(g);
    const hdr = looksLikeHeader(sh, g);
    Aero.confirm('Remove Duplicates', `Remove rows in ${F.rangeText(g)} whose values repeat an earlier row${hdr ? ' (first row treated as headers)' : ''}?`, 'Remove').then(ok => {
      if (!ok) return;
      const seen = new Set(), keep = [], r0 = g.r1 + (hdr ? 1 : 0);
      for (let r = r0; r <= g.r2; r++) { const key = []; for (let c = g.c1; c <= g.c2; c++) { const v = sh.value(r, c); key.push(typeof v === 'string' ? 's' + v.toLowerCase() : typeof v + String(v)); } const k = key.join('\u0001'); if (!seen.has(k)) { seen.add(k); keep.push(r); } }
      const removed = g.r2 - r0 + 1 - keep.length;
      if (!removed) { Aero.alert('Remove Duplicates', 'No duplicate values found.'); return; }
      const rows = keep.map(r => { const out = []; for (let c = g.c1; c <= g.c2; c++) out.push(M.cloneCell(sh.get(r, c))); return [r, out]; });
      wb.transact('Remove duplicates', () => {
        rows.forEach(([src, cells], i) => cells.forEach((cell, j) => { if (cell && cell.f != null) cell.f = F.shiftFormula(cell.f, r0 + i - src, 0); wb.setCell(sh, r0 + i, g.c1 + j, cell); }));
        for (let r = r0 + rows.length; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) wb.setCell(sh, r, c, null);
      });
      Aero.alert('Remove Duplicates', `${removed} duplicate row${removed > 1 ? 's' : ''} removed; ${keep.length} unique row${keep.length === 1 ? '' : 's'} remain.`);
    });
  }

  /* ================= find & replace ================= */
  const fp = $('#findPanel');
  function showFind(replace) {
    fp.hidden = false; $('#fpRepl').parentElement.hidden = !replace; $('#fpRepl1').hidden = $('#fpReplAll').hidden = !replace;
    fp.querySelector('.fp-head span').textContent = replace ? 'Find and Replace' : 'Find';
    const f = $('#fpFind'); f.focus(); f.select();
  }
  function findOpts() { return { matchCase: $('#fpCase').checked, whole: $('#fpWhole').checked, inFormulas: $('#fpFormulas').checked }; }
  function findSheets() { return $('#fpAll').checked ? wb.sheets : [sheet()]; }
  function findNext() {
    const hits = wb.find(findSheets(), $('#fpFind').value, findOpts());
    if (!hits.length) { Aero.toast('No matches found'); return; }
    const cur = { s: wb.sheets.indexOf(sheet()), r: grid.sel.r, c: grid.sel.c };
    const order = h => [wb.sheets.indexOf(h.sheet), h.r, h.c];
    const after = hits.find(h => { const [s, r, c] = order(h); return s > cur.s || (s === cur.s && (r > cur.r || (r === cur.r && c > cur.c))); }) || hits[0];
    gotoCell(after.sheet, after.r, after.c);
    $('#fpResults').textContent = `${hits.length} match${hits.length > 1 ? 'es' : ''}`;
  }
  function gotoCell(sh, r, c) { if (sh !== sheet()) activateSheet(wb.sheets.indexOf(sh)); grid.select(r, c); }
  function bindFind() {
    $('#fpClose').onclick = () => { fp.hidden = true; grid.kbd.focus(); };
    $('#fpNext').onclick = findNext;
    $('#fpFind').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findNext(); } if (e.key === 'Escape') $('#fpClose').click(); });
    $('#fpFindAll').onclick = () => {
      const hits = wb.find(findSheets(), $('#fpFind').value, findOpts()).slice(0, 2000);
      $('#fpResults').innerHTML = hits.length ? hits.map((h, i) => `<div data-i="${i}"><b>${esc(h.sheet.name)}!${F.addr(h.r, h.c)}</b>${esc(wb.display(h.sheet, h.r, h.c).text)}</div>`).join('') : 'No matches';
      $('#fpResults').onclick = e => { const d = e.target.closest('[data-i]'); if (d) { const h = hits[+d.dataset.i]; gotoCell(h.sheet, h.r, h.c); } };
    };
    $('#fpRepl1').onclick = () => {
      const sh = sheet(), cell = sh.get(grid.sel.r, grid.sel.c), q = $('#fpFind').value; const o = findOpts();
      const hit = cell && wb.find([sh], q, Object.assign({}, o, { inFormulas: true })).some(h => h.r === grid.sel.r && h.c === grid.sel.c);
      if (hit) { const n = wb.replaceAll([sh], q, $('#fpRepl').value, Object.assign({}, o, { only: [grid.sel.r, grid.sel.c] })); void n; }
      findNext();
    };
    $('#fpReplAll').onclick = () => { const n = wb.replaceAll(findSheets(), $('#fpFind').value, $('#fpRepl').value, findOpts()); Aero.toast(`Made ${n} replacement${n === 1 ? '' : 's'}`); };
    // drag the panel by its header
    const head = fp.querySelector('.fp-head');
    head.addEventListener('mousedown', e => { if (e.target.closest('button')) return; const r = fp.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top; const mv = ev => { fp.style.left = (ev.clientX - ox) + 'px'; fp.style.top = (ev.clientY - oy) + 'px'; fp.style.right = 'auto'; }; const up = () => { removeEventListener('mousemove', mv); removeEventListener('mouseup', up); }; addEventListener('mousemove', mv); addEventListener('mouseup', up); });
  }

  /* ================= go to / names ================= */
  function goto(text) {
    const t = String(text || '').trim(); if (!t) return;
    let pr = F.parseRange(t);
    if (!pr) { const d = wb.names.get(t.toUpperCase()); if (d) pr = F.parseRange(d.ref); }
    if (pr) {
      if (pr.sheet) { const sh = wb.sheetByName(pr.sheet); if (!sh) { Aero.toast('No sheet named ' + pr.sheet); return; } activateSheet(wb.sheets.indexOf(sh)); }
      grid.selectRange({ r1: pr.r1, c1: pr.c1, r2: pr.r2, c2: pr.c2 }, { r: pr.r1, c: pr.c1 }); return;
    }
    if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(t) && !F.parseAddr(t)) { defineName(t, F.rangeText(grid.range, sheet().name)); return; }
    Aero.toast('Not a valid reference or name: ' + t);
  }
  function defineName(name, ref) {
    if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) || F.parseAddr(name) || /^(TRUE|FALSE)$/i.test(name)) { Aero.alert('Define Name', 'Names must start with a letter or underscore, contain no spaces, and must not look like a cell reference.'); return; }
    try { F.parse(ref); } catch (e) { Aero.alert('Define Name', 'The reference is not valid.'); return; }
    wb.structural('Define name', () => wb.names.set(name.toUpperCase(), { name, ref: ref.replace(/^=/, '') }));
    Aero.toast(`Defined name ${name} = ${ref}`); refreshAll();
  }
  function defineNameDialog() {
    Aero.dialog({ title: 'Define Name', fields: [{ key: 'n', label: 'Name', type: 'text', value: '' }, { key: 'r', label: 'Refers to', type: 'text', value: '=' + F.rangeText(grid.range, sheet().name) }], onOK: v => defineName(v.n.trim(), v.r.trim()) });
  }
  function nameManager() {
    const list = [...wb.names.values()];
    const d = Aero.dialog({ title: 'Name Manager', noCancel: true, ok: 'Close', html: list.length ? `<table class="rules"><tr><th>Name</th><th>Refers to</th><th>Value</th><th></th></tr>${list.map((n, i) => { let v; try { v = wb.calc('=' + n.name); } catch (e) { v = '#NAME?'; } const vt = Array.isArray(v) ? '{…}' : v instanceof F.FErr ? v.code : String(v ?? ''); return `<tr><td>${esc(n.name)}</td><td>=${esc(n.ref)}</td><td>${esc(vt)}</td><td><button class="aero-btn small" data-del="${i}">Delete</button></td></tr>`; }).join('')}</table>` : '<p class="dnote">No names defined yet. Select a range and type a name into the Name Box, or use Insert ▸ Define Name.</p>' });
    d.el.addEventListener('click', e => { const i = e.target.dataset.del; if (i == null) return; d.close(); wb.structural('Delete name', () => wb.names.delete(list[+i].name.toUpperCase())); refreshAll(); nameManager(); });
  }

  /* ================= format cells dialog ================= */
  function nfCategory(nf) {
    if (!nf || nf === 'General') return 'General';
    if (nf === '@') return 'Text';
    if (/^_\(/.test(nf)) return 'Accounting';
    if (Fmt.isDateFormat(nf)) return /[dy]/i.test(nf.replace(/"[^"]*"/g, '')) ? 'Date' : 'Time';
    if (/%/.test(nf)) return 'Percentage';
    if (/E[+-]/i.test(nf)) return 'Scientific';
    if (/\?\/\?|#\s*\?/.test(nf)) return 'Fraction';
    if (/[$€£¥]/.test(nf)) return 'Currency';
    if (/^[#0,.]+(;.*)?$/.test(nf)) return 'Number';
    return 'Custom';
  }
  function buildNf(v) {
    const d = Math.max(0, Math.min(15, v.dec | 0)), dp = d ? '.' + '0'.repeat(d) : '', sym = v.sym || '';
    switch (v.cat) {
      case 'General': return 'General';
      case 'Number': { const base = (v.sep ? '#,##0' : '0') + dp; return v.neg === 'red' ? base + ';[Red]-' + base : v.neg === 'paren' ? base + ';(' + base + ')' : base; }
      case 'Currency': { const base = sym + '#,##0' + dp; return v.neg === 'red' ? base + ';[Red]-' + base : v.neg === 'paren' ? base + ';(' + base + ')' : base; }
      case 'Accounting': return `_(${sym ? '"' + sym + '"' : ''}* #,##0${dp}_);_(${sym ? '"' + sym + '"' : ''}* (#,##0${dp});_(${sym ? '"' + sym + '"' : ''}* "-"??_);_(@_)`;
      case 'Percentage': return '0' + dp + '%';
      case 'Scientific': return '0' + dp + 'E+00';
      case 'Fraction': return v.frac || '# ?/?';
      case 'Date': case 'Time': return v.dt;
      case 'Text': return '@';
      default: return v.code;
    }
  }
  function formatCellsDialog() {
    const s = cellStyle(), nf = s.nf || 'General', cat = nfCategory(nf), sample = sheet().value(grid.sel.r, grid.sel.c);
    const decs = (/\.(0+)/.exec(nf) || [, ''])[1].length;
    const dates = ['m/d/yyyy', 'yyyy-mm-dd', 'd-mmm-yy', 'mmm d, yyyy', 'dddd, mmmm d, yyyy', 'mmmm yyyy', 'mmm-yy', 'd/m/yyyy', 'm/d/yyyy h:mm'], times = ['h:mm AM/PM', 'h:mm:ss AM/PM', 'h:mm', 'h:mm:ss', '[h]:mm:ss', 'mm:ss.0'];
    const preview = v => { const code = buildNf(v); const x = sample == null ? 1234.5678 : sample; let t; try { t = Fmt.format(x, code === 'General' ? null : code); } catch (e) { t = { text: '(invalid format)' }; } const p = document.getElementById('nfPrev'); if (p) { p.textContent = t.text; p.style.color = t.color || ''; } };
    const d = Aero.dialog({
      title: 'Format Cells', width: 560,
      fields: [
        { key: 'cat', label: 'Category', type: 'select', value: cat, options: ['General', 'Number', 'Currency', 'Accounting', 'Date', 'Time', 'Percentage', 'Fraction', 'Scientific', 'Text', 'Custom'] },
        { key: 'dec', label: 'Decimal places', type: 'number', value: cat === 'General' ? 2 : decs, min: 0, max: 15 },
        { key: 'sep', label: 'Use 1000 separator (,)', type: 'checkbox', value: /,/.test(nf) },
        { key: 'sym', label: 'Symbol', type: 'select', value: (/[$€£¥]/.exec(nf) || ['$'])[0], options: [['$', '$'], ['€', '€'], ['£', '£'], ['¥', '¥'], ['', 'None']] },
        { key: 'neg', label: 'Negative numbers', type: 'select', value: /\[Red\]/i.test(nf) ? 'red' : /;\(/.test(nf) ? 'paren' : 'minus', options: [['minus', '-1234.10'], ['red', '-1234.10 in red'], ['paren', '(1234.10)']] },
        { key: 'dt', label: 'Date / time type', type: 'select', value: cat === 'Date' || cat === 'Time' ? nf : 'm/d/yyyy', options: [...new Set([...(cat === 'Date' || cat === 'Time' ? [nf] : []), ...dates, ...times])] },
        { key: 'frac', label: 'Fraction type', type: 'select', value: cat === 'Fraction' ? nf : '# ?/?', options: [['# ?/?', 'Up to one digit (1/4)'], ['# ??/??', 'Up to two digits (21/25)'], ['# ?/2', 'As halves'], ['# ?/4', 'As quarters'], ['# ?/8', 'As eighths'], ['# ??/16', 'As sixteenths']] },
        { key: 'code', label: 'Format code', type: 'text', value: nf, mono: true },
        { key: 'ha', label: 'Horizontal align', type: 'select', value: s.ha || '', options: [['', 'General'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right']] },
        { key: 'va', label: 'Vertical align', type: 'select', value: s.va || '', options: [['', 'Bottom'], ['middle', 'Middle'], ['top', 'Top']] },
        { key: 'indent', label: 'Indent', type: 'number', value: s.indent || 0, min: 0, max: 15 },
        { key: 'wrap', label: 'Wrap text', type: 'checkbox', value: !!s.wrap },
        { key: 'font', label: 'Font', type: 'select', value: s.font || 'Calibri', options: [...new Set([s.font || 'Calibri', ...FONTS])] },
        { key: 'sz', label: 'Size', type: 'number', value: s.sz || 11, min: 4, max: 96 },
        { key: 'bi', label: 'Style', type: 'select', value: (s.b ? 'b' : '') + (s.i ? 'i' : ''), options: [['', 'Regular'], ['b', 'Bold'], ['i', 'Italic'], ['bi', 'Bold italic']] },
        { key: 'u', label: 'Underline', type: 'checkbox', value: !!s.u }, { key: 'st', label: 'Strikethrough', type: 'checkbox', value: !!s.st },
        { key: 'color', label: 'Font color', type: 'color', value: s.color || '#000000' },
        { key: 'nofill', label: 'No fill', type: 'checkbox', value: !s.fill }, { key: 'fill', label: 'Fill color', type: 'color', value: s.fill || '#ffffff' }
      ],
      html: '<div class="nf-preview" id="nfPrev"></div>',
      onInput: (k, v, set) => { if (k !== 'code') set('code', buildNf(Object.assign({}, v, { code: v.code }))); if (k === 'cat' && v.cat === 'Custom') set('code', nf); if (k === 'fill') set('nofill', false); preview(Object.assign({}, v, { cat: k === 'code' ? 'Custom' : v.cat })); if (k === 'code') set('cat', 'Custom'); vis(v.cat); },
      onOK: v => {
        const code = v.cat === 'Custom' ? v.code : buildNf(v);
        try { Fmt.format(1, code); } catch (e) { Aero.alert('Format Cells', 'That number format is not valid.'); return; }
        applyStyle({ nf: code === 'General' ? null : code, ha: v.ha || null, va: v.va || null, indent: v.indent ? Math.round(v.indent) : null, wrap: v.wrap ? 1 : null, font: v.font === 'Calibri' ? null : v.font, sz: v.sz === 11 ? null : Math.max(4, Math.min(96, v.sz)), b: /b/.test(v.bi) ? 1 : null, i: /i/.test(v.bi) ? 1 : null, u: v.u ? 1 : null, st: v.st ? 1 : null, color: v.color === '#000000' ? null : v.color, fill: v.nofill ? null : v.fill }, 'Format cells');
        if (v.wrap || v.sz !== (s.sz || 11)) autoRowHeights();
      }
    });
    // show only the options that apply to the chosen category
    const rows = [...d.el.querySelectorAll('.aero-row')], keys = ['cat', 'dec', 'sep', 'sym', 'neg', 'dt', 'frac', 'code'];
    const show = { dec: ['Number', 'Currency', 'Accounting', 'Percentage', 'Scientific'], sep: ['Number'], sym: ['Currency', 'Accounting'], neg: ['Number', 'Currency'], dt: ['Date', 'Time'], frac: ['Fraction'] };
    function vis(c) { keys.forEach((k, i) => { if (show[k]) rows[i].hidden = !show[k].includes(c); }); }
    vis(cat);
    preview(Object.assign({}, d.values));
  }

  /* ================= conditional formatting ================= */
  const CF_STYLES = [['red', 'Light red fill with dark red text', { fill: '#ffc7ce', color: '#9c0006' }], ['yellow', 'Yellow fill with dark yellow text', { fill: '#ffeb9c', color: '#9c5700' }], ['green', 'Green fill with dark green text', { fill: '#c6efce', color: '#006100' }], ['lred', 'Light red fill', { fill: '#ffc7ce' }], ['rtext', 'Red text', { color: '#c00000' }], ['bold', 'Bold blue text', { b: 1, color: '#1f4e79' }]];
  const cfStyle = k => Object.assign({}, (CF_STYLES.find(s => s[0] === k) || CF_STYLES[0])[2]);
  function cfRange() { return effRange(grid.range); }
  function addCF(rule) { const sh = sheet(); wb.transact('Conditional format', () => wb.setMeta(sh, 'cf', sh.cf.concat([Object.assign({ range: cfRange() }, rule)]))); }
  function cfValueDialog(title, op, two, type = 'cell') {
    const fields = [{ key: 'v1', label: two ? 'Between' : 'Value', type: 'text', value: '' }];
    if (two) fields.push({ key: 'v2', label: 'and', type: 'text', value: '' });
    fields.push({ key: 'st', label: 'Format with', type: 'select', value: 'red', options: CF_STYLES.map(s => [s[0], s[1]]) });
    Aero.dialog({ title, instruction: 'Format cells in ' + F.rangeText(cfRange()), fields, onOK: v => addCF({ type, op, v1: v.v1, v2: v.v2, style: cfStyle(v.st) }) });
  }
  function cfMenuItems() {
    return [
      '#Highlight cell rules',
      ['Greater than…', () => cfValueDialog('Greater Than', '>')], ['Less than…', () => cfValueDialog('Less Than', '<')], ['Between…', () => cfValueDialog('Between', 'between', true)], ['Equal to…', () => cfValueDialog('Equal To', '=')],
      ['Text that contains…', () => cfValueDialog('Text That Contains', 'contains', false, 'text')], ['Duplicate values', () => addCF({ type: 'dup', op: 'dup', style: cfStyle('red') })], ['Unique values', () => addCF({ type: 'dup', op: 'unique', style: cfStyle('green') })], ['Blank cells', () => addCF({ type: 'blank', op: 'blank', style: cfStyle('yellow') })],
      '#Top / bottom rules',
      ['Top 10 items…', () => Aero.dialog({ title: 'Top 10 Items', fields: [{ key: 'n', label: 'Top', type: 'number', value: 10, min: 1 }, { key: 'pct', label: 'Percent', type: 'checkbox', value: false }, { key: 'st', label: 'Format with', type: 'select', value: 'green', options: CF_STYLES.map(s => [s[0], s[1]]) }], onOK: v => addCF({ type: 'top', v1: String(v.n), pct: v.pct, style: cfStyle(v.st) }) })],
      ['Bottom 10 items…', () => Aero.dialog({ title: 'Bottom 10 Items', fields: [{ key: 'n', label: 'Bottom', type: 'number', value: 10, min: 1 }, { key: 'pct', label: 'Percent', type: 'checkbox', value: false }, { key: 'st', label: 'Format with', type: 'select', value: 'red', options: CF_STYLES.map(s => [s[0], s[1]]) }], onOK: v => addCF({ type: 'top', bottom: true, v1: String(v.n), pct: v.pct, style: cfStyle(v.st) }) })],
      ['Above average', () => addCF({ type: 'avg', op: 'above', style: cfStyle('green') })], ['Below average', () => addCF({ type: 'avg', op: 'below', style: cfStyle('red') })],
      '#Visual',
      ['Data bars (blue)', () => addCF({ type: 'bar', color: '#638ec6' })], ['Data bars (green)', () => addCF({ type: 'bar', color: '#63be7b' })], ['Color scale: green – yellow – red', () => addCF({ type: 'scale', colors: ['#f8696b', '#ffeb84', '#63be7b'] })], ['Color scale: white – blue', () => addCF({ type: 'scale', colors: ['#ffffff', '#5a8ac6'] })],
      ['Icon set: arrows', () => addCF({ type: 'icons', set: 'arrows' })], ['Icon set: traffic lights', () => addCF({ type: 'icons', set: 'traffic' })],
      '-',
      ['New rule with a formula…', () => Aero.dialog({ title: 'New Formatting Rule', instruction: 'Format cells where this formula is TRUE (written for the top-left cell ' + F.addr(cfRange().r1, cfRange().c1) + ')', fields: [{ key: 'f', label: 'Formula', type: 'text', value: '=' + F.addr(cfRange().r1, cfRange().c1) + '>0', mono: true }, { key: 'st', label: 'Format with', type: 'select', value: 'yellow', options: CF_STYLES.map(s => [s[0], s[1]]) }], onOK: v => { try { F.parse(v.f); } catch (e) { Aero.alert('Formula rule', 'The formula has an error: ' + e.message); return; } addCF({ type: 'formula', v1: v.f.replace(/^=/, ''), style: cfStyle(v.st) }); } })],
      ['Manage rules…', cfManager], ['Clear rules from selection', () => { const sh = sheet(), g = cfRange(); wb.transact('Clear rules', () => wb.setMeta(sh, 'cf', sh.cf.filter(r => !(r.range.r1 <= g.r2 && r.range.r2 >= g.r1 && r.range.c1 <= g.c2 && r.range.c2 >= g.c1)))); }], ['Clear rules from sheet', () => { const sh = sheet(); wb.transact('Clear rules', () => wb.setMeta(sh, 'cf', [])); }]
    ];
  }
  function cfDescribe(r) {
    const st = r.style || {};
    const sw = r.type === 'scale' ? `<span class="sw" style="background:linear-gradient(90deg,${r.colors.join(',')})"></span>` : r.type === 'bar' ? `<span class="sw" style="background:linear-gradient(90deg,${r.color},#fff)"></span>` : r.type === 'icons' ? '<span class="sw">▲▶▼</span>' : `<span class="sw" style="background:${st.fill || '#fff'};color:${st.color || '#000'};font-weight:${st.b ? 700 : 400}">AaBb</span>`;
    const d = { cell: () => `Cell value ${r.op} ${r.v1}${r.v2 ? ' and ' + r.v2 : ''}`, text: () => `Text ${r.op} "${r.v1}"`, blank: () => r.op === 'notBlank' ? 'No blanks' : 'Blanks', error: () => 'Errors', top: () => `${r.bottom ? 'Bottom' : 'Top'} ${r.v1}${r.pct ? '%' : ''}`, avg: () => `${r.op === 'below' ? 'Below' : 'Above'} average`, dup: () => r.op === 'unique' ? 'Unique values' : 'Duplicate values', formula: () => 'Formula: =' + r.v1, scale: () => 'Color scale', bar: () => 'Data bar', icons: () => 'Icon set' }[r.type];
    return [d ? d() : r.type, sw];
  }
  function cfManager() {
    const sh = sheet();
    const d = Aero.dialog({ title: 'Conditional Formatting Rules', noCancel: true, ok: 'Close', width: 600, html: sh.cf.length ? `<table class="rules"><tr><th>Rule (top has priority)</th><th>Format</th><th>Applies to</th><th></th></tr>${sh.cf.map((r, i) => { const [t, sw] = cfDescribe(r); return `<tr><td>${esc(t)}</td><td>${sw}</td><td>${F.rangeText(r.range)}</td><td><button class="aero-btn small" data-up="${i}" title="Move up">▲</button> <button class="aero-btn small" data-del="${i}">Delete</button></td></tr>`; }).join('')}</table>` : '<p class="dnote">This sheet has no conditional formatting rules.</p>' });
    d.el.addEventListener('click', e => {
      const del = e.target.dataset.del, up = e.target.dataset.up;
      if (del == null && up == null) return;
      const list = sh.cf.slice();
      if (del != null) list.splice(+del, 1); else if (+up > 0) [list[+up - 1], list[+up]] = [list[+up], list[+up - 1]];
      d.close(); wb.transact('Edit rules', () => wb.setMeta(sh, 'cf', list)); cfManager();
    });
  }

  /* ================= charts ================= */
  function insertChart(type) {
    const sh = sheet(); let g = grid.range;
    if (g.r1 === g.r2 && g.c1 === g.c2) g = wb.region(sh, grid.sel.r, grid.sel.c); else g = effRange(g);
    if (sh.value(g.r1, g.c1) == null && g.r1 === g.r2 && g.c1 === g.c2) { Aero.toast('Select the data for the chart first'); return; }
    const L = IO.layout(sh, { r1: 0, c1: 0, r2: g.r1, c2: g.c2 + 1 });
    const x = (L.cols.find(c => c.i === g.c2 + 1) || { x: 400 }).x + 20, y = (L.rows.find(r => r.i === g.r1) || { y: 0 }).y;
    const ch = { id: Aero.uid(), type, range: F.rangeText(g), title: '', x, y, w: 480, h: 290, legend: true };
    const hdr = sh.value(g.r1, g.c1 + 1); if (typeof hdr === 'string' && g.c2 === g.c1 + 1) ch.title = hdr;
    wb.transact('Insert chart', () => wb.setMeta(sh, 'charts', sh.charts.concat([ch])));
    selectChart(ch.id);
  }
  function chartDialog(ch) {
    const sh = sheet();
    Aero.dialog({ title: 'Chart', fields: [{ key: 'type', label: 'Chart type', type: 'select', value: ch.type, options: CH.TYPES }, { key: 'title', label: 'Title', type: 'text', value: ch.title || '' }, { key: 'range', label: 'Data range', type: 'text', value: ch.range, mono: true },
      { key: 'byRow', label: 'Series in rows', type: 'checkbox', value: !!ch.byRow }, { key: 'stacked', label: 'Stacked (column/bar/area)', type: 'checkbox', value: !!ch.stacked }, { key: 'legend', label: 'Show legend', type: 'checkbox', value: ch.legend !== false }, { key: 'labels', label: 'Data labels', type: 'checkbox', value: !!ch.labels }, { key: 'smooth', label: 'Smooth lines', type: 'checkbox', value: !!ch.smooth }],
      onOK: v => {
        if (!String(v.range).split(',').every(t => F.parseRange(t.trim()))) { Aero.alert('Chart', 'The data range is not valid.'); return; }
        const list = sh.charts.map(c => c.id === ch.id ? Object.assign({}, c, v) : c);
        wb.transact('Edit chart', () => wb.setMeta(sh, 'charts', list));
      } });
  }
  function selectChart(id) {
    grid.chartSel = id;
    for (const [cid, el] of chartEls) el.classList.toggle('sel', cid === id);
    if (id) grid.kbd.focus();
    grid.render();
  }
  function deleteChart() { const sh = sheet(), id = grid.chartSel; if (!id) return; grid.chartSel = null; wb.transact('Delete chart', () => wb.setMeta(sh, 'charts', sh.charts.filter(c => c.id !== id))); }
  function placeCharts(m, toScreen, hw, hh) {
    const sh = sheet(), layer = grid.objLayer, z = m.z, dpr = devicePixelRatio || 1, seen = new Set();
    for (const ch of sh.charts) {
      seen.add(ch.id);
      let el = chartEls.get(ch.id);
      if (!el) { el = document.createElement('div'); el.className = 'chart-box'; el.innerHTML = '<canvas></canvas><div class="rz"></div>'; layer.appendChild(el); chartEls.set(ch.id, el); bindChart(el, ch.id); }
      el._sheet = sh;
      const p = toScreen(ch.x, ch.y);
      el.style.left = (p.x - hw) + 'px'; el.style.top = (p.y - hh) + 'px'; el.style.width = ch.w * z + 'px'; el.style.height = ch.h * z + 'px';
      el.classList.toggle('sel', grid.chartSel === ch.id);
      const key = [wb.calcGen, ch.type, ch.range, ch.title, ch.w, ch.h, z, ch.stacked, ch.legend, ch.labels, ch.byRow, ch.smooth, dpr].join('|');
      if (el._key !== key) {
        el._key = key; const cv = el.firstChild; cv.width = Math.round(ch.w * z * dpr); cv.height = Math.round(ch.h * z * dpr);
        const ctx = cv.getContext('2d'); ctx.setTransform(dpr * z, 0, 0, dpr * z, 0, 0);
        CH.draw(ctx, ch.w, ch.h, ch, CH.chartData(wb, sh, ch));
      }
    }
    for (const [id, el] of chartEls) if (!seen.has(id)) { el.remove(); chartEls.delete(id); }
  }
  function bindChart(el, id) {
    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      if (grid.edit && !grid.commitEdit()) return;
      selectChart(id);
      const sh = sheet(), ch = sh.charts.find(c => c.id === id); if (!ch) return;
      const before = JSON.parse(JSON.stringify(sh.charts)), z = sh.zoom || 1, x0 = e.clientX, y0 = e.clientY, o = { x: ch.x, y: ch.y, w: ch.w, h: ch.h };
      const resize = e.target.classList.contains('rz');
      let moved = false;
      const mv = ev => {
        const dx = (ev.clientX - x0) / z, dy = (ev.clientY - y0) / z; if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        if (resize) { ch.w = Math.max(160, Math.round(o.w + dx)); ch.h = Math.max(110, Math.round(o.h + dy)); } else { ch.x = Math.max(0, Math.round(o.x + dx)); ch.y = Math.max(0, Math.round(o.y + dy)); }
        grid.render();
      };
      const up = () => {
        removeEventListener('mousemove', mv); removeEventListener('mouseup', up);
        if (!moved) return;
        const after = JSON.parse(JSON.stringify(sh.charts)); sh.charts = before;
        wb.transact(resize ? 'Resize chart' : 'Move chart', () => wb.setMeta(sh, 'charts', after));
      };
      addEventListener('mousemove', mv); addEventListener('mouseup', up);
    });
    el.addEventListener('dblclick', e => { e.stopPropagation(); const ch = sheet().charts.find(c => c.id === id); if (ch) chartDialog(ch); });
    el.addEventListener('wheel', e => { grid.scroller.scrollTop += e.deltaY; grid.scroller.scrollLeft += e.deltaX; }, { passive: true });
    el.addEventListener('contextmenu', e => { e.preventDefault(); selectChart(id); const ch = sheet().charts.find(c => c.id === id); popupMenu(null, [['Edit chart…', () => chartDialog(ch)], ...CH.TYPES.map(([t, n]) => ['Change to ' + n, () => { const sh = sheet(); wb.transact('Chart type', () => wb.setMeta(sh, 'charts', sh.charts.map(c => c.id === id ? Object.assign({}, c, { type: t }) : c))); }]), '-', ['Delete chart', deleteChart]], { x: e.clientX, y: e.clientY }); });
  }

  /* ================= pivot tables ================= */
  function writePivot(w, target, quiet) {
    const spec = target.pivot; const pr = F.parseRange(spec.src); if (!pr) throw new Error('Bad source range');
    const src = pr.sheet ? w.sheetByName(pr.sheet) : w.sheets[0]; if (!src) throw new Error('Source sheet not found');
    const g = { r1: pr.r1, c1: pr.c1, r2: pr.r2, c2: pr.c2 };
    const res = PV.build(src, g, spec);
    const valCell = src.get(g.r1 + 1, g.c1 + res.valCol), vnf = spec.agg === 'count' ? '#,##0' : valCell && valCell.s && valCell.s.nf || '#,##0.00';
    for (const k of [...target.cells.keys()]) w.setCell(target, Math.floor(k / MAXC), k % MAXC, null);
    target.merges = []; target.colW = new Map();
    const title = `PivotTable — ${res.rows[res.headerRows - 1 + (res.headerRows === 2 ? 0 : 0)][0]} ${spec.cols ? '× ' + spec.cols : ''}`;
    w.setCell(target, 0, 0, { v: title.replace(/\s+$/, ''), s: { b: 1, sz: 14, color: '#3f1f66' } });
    w.setCell(target, 1, 0, { v: `Source: ${spec.src} · ${PV.AGG[spec.agg].label} of ${spec.val} · refresh with Data ▸ Refresh PivotTable`, s: { i: 1, color: '#7f7f7f' } });
    const top = 3, nC = res.nCols;
    res.rows.forEach((row, i) => row.forEach((v, j) => {
      const isHead = i < res.headerRows, isTot = i === res.rows.length - 1, isTotCol = spec.cols && j === nC - 1;
      const s = {};
      if (isHead) Object.assign(s, { b: 1, fill: '#e4dfec', color: '#3f1f66', bb: { style: 'thin', color: '#7030a0' } });
      if (isTot) Object.assign(s, { b: 1, fill: '#e4dfec', bt: { style: 'thin', color: '#7030a0' } });
      if (isTotCol && !isHead) s.b = 1;
      if (!isHead && j > 0 && typeof v === 'number') s.nf = vnf;
      if (j === 0 && !isHead && !isTot) s.color = '#3f1f66';
      w.setCell(target, top + i, j, { v: v == null ? null : v, s: Object.keys(s).length ? s : null });
    }));
    target.colW.set(0, 130); for (let j = 1; j < nC; j++) target.colW.set(j, 96);
    target.freeze = { r: top + res.headerRows, c: 0 };
    if (!quiet) Aero.toast('PivotTable updated');
  }
  function pivotDialog() {
    const sh = sheet(); let g = grid.range;
    if (g.r1 === g.r2 && g.c1 === g.c2) g = sh.filter && grid.sel.r >= sh.filter.range.r1 && grid.sel.r <= sh.filter.range.r2 ? sh.filter.range : wb.region(sh, grid.sel.r, grid.sel.c); else g = effRange(g);
    if (g.r2 <= g.r1) { Aero.toast('Select a table with a header row and data first'); return; }
    const heads = []; for (let c = g.c1; c <= g.c2; c++) heads.push(String(sh.value(g.r1, c) ?? 'Column ' + F.colName(c)));
    const numCol = heads.findIndex((h, j) => typeof sh.value(g.r1 + 1, g.c1 + j) === 'number' && !Fmt.isDateFormat((sh.get(g.r1 + 1, g.c1 + j) || {}).s?.nf));
    const textCols = heads.filter((h, j) => typeof sh.value(g.r1 + 1, g.c1 + j) === 'string');
    Aero.dialog({ title: 'Create PivotTable', instruction: `From ${sh.name}!${F.rangeText(g)} (${g.r2 - g.r1} rows)`, fields: [
      { key: 'rows', label: 'Rows', type: 'select', value: textCols[0] || heads[0], options: heads }, { key: 'cols', label: 'Columns (optional)', type: 'select', value: textCols[1] || '', options: [['', '(none)'], ...heads.map(h => [h, h])] },
      { key: 'val', label: 'Values', type: 'select', value: heads[numCol >= 0 ? heads.length - 1 - [...heads].reverse().findIndex((h, j) => typeof sh.value(g.r1 + 1, g.c2 - j) === 'number') : 0] || heads[0], options: heads }, { key: 'agg', label: 'Summarize by', type: 'select', value: 'sum', options: [['sum', 'Sum'], ['count', 'Count'], ['average', 'Average'], ['min', 'Min'], ['max', 'Max']] }],
      onOK: v => {
        const spec = { src: F.rangeText(g, sh.name), rows: v.rows, cols: v.cols || null, val: v.val, agg: v.agg };
        try {
          const idx = wb.structural('Insert PivotTable', () => { const t = wb.addSheetRaw(wb.uniqueName('Pivot'), wb.sheets.indexOf(sh) + 1); t.tabColor = '#7030a0'; t.pivot = spec; writePivot(wb, t, true); return wb.sheets.indexOf(t); });
          activateSheet(idx);
        } catch (e) { Aero.alert('PivotTable', e.message); }
      } });
  }
  function refreshPivot() {
    const sh = sheet(); if (!sh.pivot) { Aero.toast('The active sheet is not a PivotTable'); return; }
    try { wb.structural('Refresh PivotTable', () => writePivot(wb, sh, true)); Aero.toast('PivotTable refreshed'); } catch (e) { Aero.alert('PivotTable', e.message); }
  }

  /* ================= insert function ================= */
  function insertFunctionDialog() {
    const cats = ['All', ...new Set(Object.values(F.FN).map(f => f.cat).filter(Boolean))];
    const names = Object.keys(F.FN).sort();
    const d = Aero.dialog({ title: 'Insert Function', width: 520, ok: 'Insert', fields: [{ key: 'q', label: 'Search', type: 'text', value: '' }, { key: 'cat', label: 'Category', type: 'select', value: 'All', options: cats }],
      html: '<select size="12" class="dlg-list" id="fnList"></select><div class="dlg-desc" id="fnDesc"></div>',
      onInput: () => fill(), onOK: () => { const n = $('#fnList').value; if (!n) return; if (!grid.edit) grid.startEdit('=' + n + '(', 'enter'); else { const inp = grid.activeInput(), p = inp.selectionStart, t = grid.edit.text; grid.edit.text = t.slice(0, p) + n + '(' + t.slice(inp.selectionEnd); inp.value = grid.edit.text; inp.setSelectionRange(p + n.length + 1, p + n.length + 1); grid.syncFromEditor(inp); } } });
    function fill() {
      const q = d.values.q.toUpperCase(), cat = d.values.cat, list = $('#fnList');
      const items = names.filter(n => (cat === 'All' || F.FN[n].cat === cat) && (!q || n.includes(q)));
      list.innerHTML = items.map(n => `<option>${n}</option>`).join(''); list.selectedIndex = 0; desc();
    }
    function desc() { const n = $('#fnList').value; $('#fnDesc').innerHTML = n ? `<code>${n}(${esc(F.FN[n].sig || '…')})</code><br>${esc(F.FN[n].cat || '')}` : 'No functions match.'; }
    $('#fnList').addEventListener('change', desc); $('#fnList').addEventListener('dblclick', () => d.el.querySelector('[data-a=o]').click());
    fill();
  }

  /* ================= sheets & tabs ================= */
  function renderTabs() {
    const box = $('#sheetTabs'); box.innerHTML = '';
    wb.sheets.forEach((sh, i) => {
      const t = document.createElement('div'); t.className = 'sheet-tab' + (i === wb.active ? ' on' : ''); t.textContent = sh.name; t.title = sh.name;
      if (sh.tabColor) { const c = document.createElement('span'); c.className = 'tc'; c.style.background = sh.tabColor; t.appendChild(c); }
      t.addEventListener('mousedown', e => { if (grid.edit && grid.pointable()) e.preventDefault(); });
      t.addEventListener('click', () => activateSheet(i));
      t.addEventListener('dblclick', () => renameInline(t, sh));
      t.addEventListener('contextmenu', e => { e.preventDefault(); activateSheet(i); popupMenu(null, sheetMenuItems(), { x: e.clientX, y: e.clientY - 200 }); });
      box.appendChild(t);
    });
    box.querySelector('.on')?.scrollIntoView({ inline: 'nearest' });
  }
  function renameInline(tab, sh) {
    const inp = document.createElement('input'); inp.value = sh.name; tab.textContent = ''; tab.appendChild(inp); inp.focus(); inp.select();
    const done = ok => { if (ok && inp.value.trim() && inp.value !== sh.name && !wb.renameSheet(sh, inp.value)) Aero.toast('That sheet name is already used or invalid'); renderTabs(); grid.kbd.focus(); };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
    inp.addEventListener('blur', () => done(true));
  }
  function activateSheet(i) {
    if (i < 0 || i >= wb.sheets.length) return;
    const pointing = grid.edit && grid.pointable();
    if (grid.edit && !pointing && !grid.commitEdit()) return;
    if (i === wb.active) return;
    sheet()._sel = JSON.parse(JSON.stringify(grid.sel)); sheet()._scroll = [grid.scroller.scrollLeft, grid.scroller.scrollTop];
    wb.active = i; const sh = sheet();
    grid.chartSel = null; grid.extR = 1000; grid.extC = 52; grid.invalidate();
    if (!pointing) { grid.sel = sh._sel || { r: 0, c: 0, ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }], anchor: { r: 0, c: 0 } }; }
    const sc = sh._scroll || [0, 0];
    grid.paint(); grid.scroller.scrollLeft = sc[0]; grid.scroller.scrollTop = sc[1];
    renderTabs(); if (!pointing) host.onSelect(); grid.render(); status();
    if (pointing) grid.activeInput().focus(); else grid.kbd.focus();
  }
  function cycleSheet(d) { activateSheet((wb.active + d + wb.sheets.length) % wb.sheets.length); }
  function sheetMenuItems() {
    const sh = sheet();
    return [['Insert sheet', () => { const s = wb.addSheet(null, wb.active + 1); activateSheet(wb.sheets.indexOf(s)); }, 'Shift+F11'], ['Duplicate sheet', () => { const s = wb.duplicateSheet(sh); activateSheet(wb.sheets.indexOf(s)); }], ['Rename sheet…', () => Aero.prompt('Rename Sheet', 'Sheet name', sh.name).then(n => { if (n != null && !wb.renameSheet(sh, n)) Aero.toast('That sheet name is already used or invalid'); refreshAll(); })],
      ['Delete sheet', () => { if (wb.sheets.length < 2) { Aero.toast('A workbook needs at least one sheet'); return; } Aero.confirm('Delete Sheet', `Delete "${sh.name}"? Formulas that refer to it will show #REF!.`, 'Delete').then(ok => { if (ok) { wb.deleteSheet(sh); grid.invalidate(); refreshAll(); host.onSelect(); } }); }],
      '-', ['Move left', () => { if (wb.active > 0) wb.moveSheet(sh, wb.active - 1); }], ['Move right', () => { if (wb.active < wb.sheets.length - 1) wb.moveSheet(sh, wb.active + 1); }],
      ['Tab color…', () => palette($('#sheetTabs .on') || $('#tabAdd'), c => wb.structural('Tab color', () => { sh.tabColor = c; }), 'No color')]];
  }

  /* ================= status / name box / formula bar ================= */
  let statT = 0;
  function status() {
    if (!grid) return;
    const e = grid.edit;
    $('#st1').textContent = e ? (grid.pointable() ? 'Point' : e.mode === 'edit' ? 'Edit' : 'Enter') : 'Ready';
    const sh = sheet();
    let msg = '';
    if (wb.circular.length) msg = `Circular reference: ${wb.circular[0].sheet}!${wb.circular[0].addr}`;
    else if (sh.filter && sh.filtered.size) { const tot = Math.min(sh.filter.range.r2, sh.bounds().r) - sh.filter.range.r1; msg = `Filter: ${tot - sh.filtered.size} of ${tot} records shown`; }
    $('#st2').textContent = msg; $('#st2').style.color = wb.circular.length ? '#b00000' : '';
    clearTimeout(statT); statT = setTimeout(() => {
      let sum = 0, n = 0, cnt = 0, cells = 0;
      for (const g0 of grid.sel.ranges) { const g = effRange(g0); for (let r = g.r1; r <= g.r2 && cells < 2e6; r++) { if (sh.rowHidden(r)) continue; for (let c = g.c1; c <= g.c2; c++) { cells++; const v = sh.value(r, c); if (v == null) continue; cnt++; if (typeof v === 'number') { sum += v; n++; } } } }
      $('#st3').textContent = cnt > 1 || n > 1 ? (n ? `Average: ${Fmt.general(sum / n)}    Count: ${cnt}    Sum: ${Fmt.general(sum)}` : `Count: ${cnt}`) : '';
    }, 60);
    $('#st4').textContent = `${Math.round((sh.zoom || 1) * 100)}%`;
  }
  function updateNameBox() {
    const g = grid.range, s = grid.sel;
    let t = F.addr(s.r, s.c);
    for (const d of wb.names.values()) { const pr = F.parseRange(d.ref); if (pr && (!pr.sheet || pr.sheet.toLowerCase() === sheet().name.toLowerCase()) && pr.r1 === g.r1 && pr.c1 === g.c1 && pr.r2 === g.r2 && pr.c2 === g.c2) { t = d.name; break; } }
    if (document.activeElement !== $('#nameBox')) $('#nameBox').value = t;
  }
  function updateFbar() { if (!grid.edit) $('#fbar').value = wb.editText(sheet(), grid.sel.r, grid.sel.c); }

  /* ================= context menu ================= */
  function contextMenu(x, y, where) {
    const items = [['Cut', () => execClip('cut'), 'Ctrl+X'], ['Copy', () => execClip('copy'), 'Ctrl+C'], ['Paste', menuPaste, 'Ctrl+V'], ['Paste Special…', pasteSpecialDialog], '-'];
    if (where !== 'col') items.push(['Insert rows above', () => insertRC('row', false)], ['Delete rows', () => deleteRC('row')]);
    if (where !== 'row') items.push(['Insert columns left', () => insertRC('col', false)], ['Delete columns', () => deleteRC('col')]);
    if (where === 'row') items.push(['Row height…', () => sizeDialog('row')], ['Hide rows', () => hideRC('row', true)], ['Unhide rows', () => hideRC('row', false)]);
    if (where === 'col') items.push(['Column width…', () => sizeDialog('col')], ['AutoFit width', () => autofit('col', grid.range.c1)], ['Hide columns', () => hideRC('col', true)], ['Unhide columns', () => hideRC('col', false)]);
    items.push(['Clear contents', () => clear('contents'), 'Delete'], '-', ['Sort A to Z', () => sortSel(true)], ['Sort Z to A', () => sortSel(false)], ['Filter', toggleFilter], '-', ['Format Cells…', formatCellsDialog, 'Ctrl+1'], ['Insert chart', () => insertChart('column')], ['Define name…', defineNameDialog]);
    popupMenu(null, items, { x, y });
  }

  /* ================= files ================= */
  const FILTERS = { lsheet: [{ name: 'Lumen Sheets', extensions: ['lsheet'] }], xlsx: [{ name: 'Excel Workbook', extensions: ['xlsx'] }], ods: [{ name: 'OpenDocument Spreadsheet', extensions: ['ods'] }], csv: [{ name: 'CSV', extensions: ['csv'] }], pdf: [{ name: 'PDF', extensions: ['pdf'] }], png: [{ name: 'PNG image', extensions: ['png'] }] };
  async function confirmDiscard() { if (!Aero.dirty) return true; return Aero.confirm('Unsaved changes', `Discard the changes to ${docName}?`, 'Discard'); }
  function setWorkbook(w, name, path, fmt) {
    wb = w; wb.onChange = () => { Aero.setDirty(true); grid.invalidate(); refreshAll(); };
    docName = name; docPath = path || null; docFormat = fmt || 'lsheet'; clip = null;
    if (grid) {
      grid.edit = null; grid.editor.hidden = true; grid.copyMark = null; grid.chartSel = null; grid.extR = 1000; grid.extC = 52; grid.invalidate();
      grid.sel = { r: 0, c: 0, ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }], anchor: { r: 0, c: 0 } };
      grid.scroller.scrollTop = 0; grid.scroller.scrollLeft = 0;
      for (const el of chartEls.values()) el.remove(); chartEls.clear();
    }
    Aero.setDoc(name, false);
    $('#welcome').hidden = true;
    if (grid) { refreshAll(); host.onSelect(); }
  }
  function refreshAll() { if (!grid) return; renderTabs(); grid.render(); syncToolbar(); status(); updateFbar(); }
  async function newBook() { if (!(await confirmDiscard())) return; setWorkbook(M.Workbook.blank(1), 'Book1'); }
  async function openSample() { if (!(await confirmDiscard())) return; Aero.busy('Building sample…'); await new Promise(r => setTimeout(r, 20)); try { setWorkbook(SheetSample.build(), 'Lumen Coffee Sales.lsheet'); } finally { Aero.busy(); } }
  async function openDialog() {
    if (!(await confirmDiscard())) return;
    const files = await Aero.openFile({ accept: '.lsheet,.xlsx,.xlsm,.xls,.ods,.csv,.tsv,.txt,.json', filters: [{ name: 'Spreadsheets', extensions: ['lsheet', 'xlsx', 'xlsm', 'xls', 'ods', 'csv', 'tsv', 'txt'] }] });
    if (files[0]) openBuffer(files[0].data, files[0].name, files[0].path);
  }
  async function openBuffer(data, name, path) {
    const ext = (/\.([^.]+)$/.exec(name || '') || [, ''])[1].toLowerCase();
    Aero.busy('Opening ' + name + '…'); await new Promise(r => setTimeout(r, 20));
    try {
      let w, fmt = 'lsheet';
      if (ext === 'lsheet' || ext === 'json') w = M.Workbook.fromJSON(JSON.parse(IO.decodeText(data)));
      else if (['xlsx', 'xlsm', 'xls', 'ods'].includes(ext)) { w = IO.readSpreadsheet(data, name); fmt = ext === 'xlsx' || ext === 'xlsm' ? 'xlsx' : 'lsheet'; }
      else if (['csv', 'tsv', 'txt'].includes(ext)) w = IO.readCSV(data, name);
      else throw new Error('Unsupported file type: .' + ext);
      setWorkbook(w, name, fmt === 'xlsx' ? path : (ext === 'lsheet' ? path : null), fmt);
      if (ext === 'xls' || ext === 'ods' || ext === 'csv' || ext === 'tsv') Aero.toast(`Opened ${name}. Save keeps it as .lsheet; use Export for .${ext === 'tsv' ? 'csv' : ext === 'xls' ? 'xlsx' : ext}.`, 3500);
    } catch (e) { console.error(e); Aero.alert('Open', 'Could not open ' + name + ': ' + e.message); }
    finally { Aero.busy(); }
  }
  function baseName() { return Aero.baseName(docName || 'Book1') || 'Book1'; }
  async function save(asNew) {
    if (grid.edit && !grid.commitEdit()) return false;
    const fmt = asNew ? 'lsheet' : docFormat;
    let data, name;
    if (fmt === 'xlsx') { data = IO.writeXlsx(wb); name = baseName() + '.xlsx'; }
    else { data = JSON.stringify(wb.toJSON()); name = baseName() + '.lsheet'; }
    const p = await Aero.saveFile({ name, data, filters: FILTERS[fmt], path: asNew ? null : docPath });
    if (!p) return false;
    docPath = Aero.isDesktop ? p : null; docName = String(p).replace(/^.*[\\/]/, ''); docFormat = /\.xlsx$/i.test(docName) ? 'xlsx' : 'lsheet';
    Aero.setDoc(docName, false); Aero.toast('Saved ' + docName); return true;
  }
  async function exportAs(kind) {
    if (grid.edit && !grid.commitEdit()) return;
    try {
      if (kind === 'xlsx') { const d = IO.writeXlsx(wb); await Aero.saveFile({ name: baseName() + '.xlsx', data: d, filters: FILTERS.xlsx }); }
      else if (kind === 'ods') { const d = IO.writeODS(wb); await Aero.saveFile({ name: baseName() + '.ods', data: d, filters: FILTERS.ods }); }
      else if (kind === 'csv') { const t = IO.writeCSV(wb, sheet()); await Aero.saveFile({ name: baseName() + (wb.sheets.length > 1 ? ' - ' + sheet().name : '') + '.csv', data: '﻿' + t, filters: FILTERS.csv }); }
      else if (kind === 'png') {
        let g = grid.range; if (g.r1 === g.r2 && g.c1 === g.c2) g = IO.printRange(wb, sheet()); else g = effRange(g);
        if (!g) { Aero.toast('Nothing to export'); return; }
        const cv = IO.renderPNG(wb, sheet(), g, 2); if (!cv) return;
        const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
        await Aero.saveFile({ name: baseName() + '.png', data: blob, filters: FILTERS.png });
      }
    } catch (e) { console.error(e); Aero.alert('Export', 'Export failed: ' + e.message); }
  }
  function pdfDialog() {
    Aero.dialog({ title: 'Export PDF', fields: [{ key: 'scope', label: 'Print', type: 'select', value: 'sheet', options: [['sheet', 'Active sheet'], ['all', 'Entire workbook'], ['sel', 'Selection']] }, { key: 'paper', label: 'Paper', type: 'select', value: 'letter', options: [['letter', 'Letter (8.5 × 11 in)'], ['a4', 'A4']] }, { key: 'land', label: 'Landscape', type: 'checkbox', value: true }, { key: 'fit', label: 'Fit all columns on one page', type: 'checkbox', value: true }, { key: 'grid', label: 'Print gridlines', type: 'checkbox', value: false }],
      onOK: async v => {
        const sheets = v.scope === 'all' ? wb.sheets.map(s => ({ sheet: s })) : v.scope === 'sel' ? [{ sheet: sheet(), range: effRange(grid.range) }] : [{ sheet: sheet() }];
        Aero.busy('Creating PDF…');
        try { const r = await IO.exportPDF(wb, sheets, { paper: v.paper, landscape: v.land, fitWidth: v.fit, grid: v.grid, title: baseName() }); Aero.busy(); await Aero.saveFile({ name: baseName() + '.pdf', data: r.bytes, filters: FILTERS.pdf }); Aero.toast(`PDF with ${r.pages} page${r.pages === 1 ? '' : 's'} saved`); }
        catch (e) { Aero.busy(); console.error(e); Aero.alert('Export PDF', 'Failed: ' + e.message); }
      } });
  }
  async function importCSVSheet() {
    const files = await Aero.openFile({ accept: '.csv,.tsv,.txt', filters: [{ name: 'Text data', extensions: ['csv', 'tsv', 'txt'] }] }); const f = files[0]; if (!f) return;
    const src = IO.readCSV(f.data, f.name).sheets[0];
    const idx = wb.structural('Import CSV', () => { const t = wb.addSheetRaw(wb.uniqueName(src.name), wb.active + 1); for (const [k, c] of src.cells) t.cells.set(k, { v: c.v, s: c.s }); t.colW = new Map(src.colW); return wb.sheets.indexOf(t); });
    activateSheet(idx);
  }
  function onDrop(files) {
    const f = files.find(x => /\.(lsheet|xlsx|xlsm|xls|ods|csv|tsv|txt|json)$/i.test(x.name)); if (!f) { Aero.toast('Drop a .lsheet, .xlsx, .ods or .csv file'); return; }
    confirmDiscard().then(ok => ok && openBuffer(f.data, f.name, f.path));
  }

  /* ================= help ================= */
  function shortcutsDialog() {
    const rows = [['Arrows / Ctrl+Arrows', 'Move / jump to the edge of data'], ['Shift+Arrows, Ctrl+Shift+Arrows', 'Extend the selection'], ['Enter / Tab', 'Commit and move down / right'], ['F2', 'Edit the active cell'], ['F4 (while editing)', 'Cycle $ in the reference at the caret'], ['Alt+Enter', 'New line in a cell'], ['Ctrl+Enter', 'Fill the selection with the entry'], ['Esc', 'Cancel editing'], ['Delete', 'Clear contents'],
      ['Ctrl+C / X / V', 'Copy / cut / paste (also from other apps)'], ['Ctrl+Alt+V', 'Paste Special'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+D / Ctrl+R', 'Fill down / right'], ['Ctrl+B / I / U / 5', 'Bold / italic / underline / strikethrough'], ['Ctrl+1', 'Format Cells'], ['Alt+=', 'AutoSum'], ['Ctrl+; / Ctrl+Shift+:', 'Insert date / time'],
      ['Ctrl+A', 'Select region / all'], ['Ctrl+Space / Shift+Space', 'Select column / row'], ['Ctrl+F / Ctrl+H', 'Find / replace'], ['Ctrl+G', 'Go to'], ['Ctrl+Shift+L', 'Toggle filter'], ['Ctrl+PageUp / PageDown', 'Previous / next sheet'], ['Shift+F11', 'New sheet'], ['Shift+F3', 'Insert function'], ['F9', 'Recalculate'], ['Ctrl+`', 'Show formulas'], ['Ctrl+= / Ctrl+- / Ctrl+wheel', 'Zoom'], ['Ctrl+S / Ctrl+O / Ctrl+N', 'Save / open / new'], ['Ctrl+P', 'Export PDF']];
    Aero.dialog({ title: 'Keyboard Shortcuts', noCancel: true, width: 560, html: `<table class="kb">${rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('')}</table>` });
  }
  function functionsDialog() {
    const by = {}; for (const [n, f] of Object.entries(F.FN)) (by[f.cat || 'Other'] = by[f.cat || 'Other'] || []).push(n);
    Aero.dialog({ title: `Functions (${Object.keys(F.FN).length})`, noCancel: true, width: 620, html: Object.entries(by).map(([c, l]) => `<p class="dnote"><b>${esc(c)}</b> (${l.length}): <span style="color:#333">${l.sort().join(', ')}</span></p>`).join('') });
  }
  function about() {
    Aero.dialog({ title: 'About Lumen Sheets', noCancel: true, html: `<div class="about"><p><b>Lumen Sheets</b> — a free spreadsheet for everyday number work: ${Object.keys(F.FN).length} functions, dynamic arrays, charts, pivot tables, conditional formatting and Excel-compatible files.</p><p>Formulas run in Lumen's own formula interpreter. Formulas inside opened files are treated as data; they are never turned into JavaScript.</p><p class="dim">Uses SheetJS Community Edition (Apache-2.0), fflate (MIT) and pdf-lib (MIT).</p></div>` });
  }

  /* ================= menus ================= */
  function menus() {
    const it = (label, key, fn, extra = {}) => Object.assign({ label, key, fn }, extra);
    const local = (label, key, fn) => ({ label, key, fn, noShortcut: true });
    Aero.menus({
      File: [it('New', 'Ctrl+N', newBook), it('Open…', 'Ctrl+O', openDialog), it('Open Sample', '', openSample), '-', it('Save', 'Ctrl+S', () => save(false)), it('Save As…', 'Ctrl+Shift+S', () => save(true)), '-', '#Export',
        it('Excel Workbook (.xlsx)…', '', () => exportAs('xlsx')), it('OpenDocument (.ods)…', '', () => exportAs('ods')), it('CSV — current sheet…', '', () => exportAs('csv')), it('PDF…', 'Ctrl+P', pdfDialog), it('PNG image of selection…', '', () => exportAs('png')), '-', it('Import CSV as new sheet…', '', importCSVSheet)],
      Edit: [local('Undo', 'Ctrl+Z', undo), local('Redo', 'Ctrl+Y', redo), '-', local('Cut', 'Ctrl+X', () => execClip('cut')), local('Copy', 'Ctrl+C', () => execClip('copy')), local('Paste', 'Ctrl+V', menuPaste), it('Paste Special…', 'Ctrl+Alt+V', pasteSpecialDialog), '-',
        it('Fill Down', 'Ctrl+D', () => fillDir('down')), it('Fill Right', 'Ctrl+R', () => fillDir('right')), local('Clear Contents', 'Delete', () => clear('contents')), it('Clear Formats', '', () => clear('formats')), it('Clear All', '', () => clear('all')), '-',
        it('Find…', 'Ctrl+F', () => showFind(false)), it('Replace…', 'Ctrl+H', () => showFind(true)), it('Go To…', 'Ctrl+G', () => Aero.prompt('Go To', 'Reference or name', F.addr(grid.sel.r, grid.sel.c)).then(t => t && goto(t)))],
      View: [it('Zoom In', 'Ctrl+=', () => zoomBy(0.1)), it('Zoom Out', 'Ctrl+-', () => zoomBy(-0.1)), it('Zoom 100%', 'Ctrl+0', () => setZoom(1)), '-', it('Freeze Panes', '', freezeAtSel), it('Freeze Top Row', '', () => setFreeze(1, 0)), it('Freeze First Column', '', () => setFreeze(0, 1)), it('Unfreeze Panes', '', () => setFreeze(0, 0)), '-',
        it('Gridlines', '', () => { const sh = sheet(); wb.transact('Gridlines', () => wb.setMeta(sh, 'showGrid', !sh.showGrid)); }, { checked: () => sheet().showGrid }), it('Show Formulas', 'Ctrl+`', () => { grid.showFormulas = !grid.showFormulas; grid.render(); }, { checked: () => grid.showFormulas }), it('Tall Formula Bar', '', () => $('#fbar').classList.toggle('tall'), { checked: () => $('#fbar').classList.contains('tall') })],
      Insert: [it('Rows Above', '', () => insertRC('row', false)), it('Rows Below', '', () => insertRC('row', true)), it('Columns Left', '', () => insertRC('col', false)), it('Columns Right', '', () => insertRC('col', true)), '-', it('New Sheet', 'Shift+F11', () => { const s = wb.addSheet(null, wb.active + 1); activateSheet(wb.sheets.indexOf(s)); }), '-',
        '#Chart', ...CH.TYPES.map(([t, n]) => it(n + ' chart', '', () => insertChart(t))), '-', it('PivotTable…', '', pivotDialog), it('Function…', 'Shift+F3', insertFunctionDialog), it('Define Name…', '', defineNameDialog), it('Name Manager…', '', nameManager)],
      Format: [it('Format Cells…', 'Ctrl+1', formatCellsDialog), it('Bold', 'Ctrl+B', () => toggle('b')), it('Italic', 'Ctrl+I', () => toggle('i')), it('Underline', 'Ctrl+U', () => toggle('u')), it('Strikethrough', 'Ctrl+5', () => toggle('st')), '-',
        it('Merge & Center', '', mergeCenter), it('Unmerge Cells', '', unmerge), it('Wrap Text', '', () => { toggle('wrap'); autoRowHeights(); }), '-', it('Row Height…', '', () => sizeDialog('row')), it('Column Width…', '', () => sizeDialog('col')), it('AutoFit Column Width', '', () => autofit('col', grid.sel.c)), it('AutoFit Row Height', '', () => autoRowHeights()),
        it('Hide Rows', '', () => hideRC('row', true)), it('Unhide Rows', '', () => hideRC('row', false)), it('Hide Columns', '', () => hideRC('col', true)), it('Unhide Columns', '', () => hideRC('col', false)), '-', ...cfMenuItems().map(x => Array.isArray(x) ? it('CF: ' + x[0], '', x[1]) : x === '-' ? '-' : x)],
      Data: [it('Sort A to Z', '', () => sortSel(true)), it('Sort Z to A', '', () => sortSel(false)), it('Custom Sort…', '', sortDialog), '-', it('Filter', 'Ctrl+Shift+L', toggleFilter, { checked: () => !!sheet().filter }), it('Clear Filter', '', clearFilter), it('Reapply Filter', '', () => { const sh = sheet(); if (sh.filter) wb.transact('Reapply filter', () => wb.applyFilter(sh)); grid.invalidate(); }), '-',
        it('Remove Duplicates…', '', removeDuplicates), it('Refresh PivotTable', '', refreshPivot), '-', it('Recalculate Now', 'F9', () => { wb.recalc(true); grid.render(); status(); Aero.toast('Recalculated'); })],
      Sheet: sheetMenuItems().filter(x => x !== '-').map(x => it(x[0], x[2] || '', () => sheetMenuItems().find(y => y[0] === x[0])[1]())),
      Help: [it('Keyboard Shortcuts', 'F1', shortcutsDialog), it('Function List', '', functionsDialog), it('About Lumen Sheets', '', about)]
    });
  }

  /* ================= startup ================= */
  const host = {
    get wb() { return wb; }, sheet,
    onSelect: () => {
      if (painter) { const p = painter; painter = null; $('#bPainter').classList.remove('on'); const keys = ['b', 'i', 'u', 'st', 'font', 'sz', 'color', 'fill', 'ha', 'va', 'wrap', 'nf', 'indent', 'bt', 'bb', 'bl', 'br']; const patch = {}; keys.forEach(k => patch[k] = p[k] ?? null); setTimeout(() => applyStyle(patch, 'Format painter'), 0); }
      syncToolbar(); updateNameBox(); updateFbar(); status();
    },
    status, undo, redo, copy: onCopy, paste: onPaste, clear, contextMenu, openFilter, autofit, fillDownToData, cycleSheet, zoom: zoomBy, goto, autoSum: () => autoSum('SUM'), placeCharts, selectChart, deleteChart
  };
  function boot() {
    Aero.init({ name: 'Lumen Sheets', icon: '../kit/icons/sheets.png', onDropFiles: onDrop, dropText: 'Drop a spreadsheet to open it', onSave: () => save(false) });
    buildCmdBar();
    wb = M.Workbook.blank(1);
    grid = new GridView(host);
    menus(); bindFind();
    setWorkbook(wb, 'Book1');
    $('#tabAdd').onclick = () => { const s = wb.addSheet(null, wb.sheets.length); activateSheet(wb.sheets.indexOf(s)); };
    $('#tabPrev').onclick = () => cycleSheet(-1); $('#tabNext').onclick = () => cycleSheet(1);
    $('#bFx').onclick = insertFunctionDialog;
    $('#bOkEdit').onmousedown = e => { e.preventDefault(); grid.commitEdit(); };
    $('#bCancelEdit').onmousedown = e => { e.preventDefault(); grid.cancelEdit(); };
    grid.host.afterCommit = e => { if (e.sheet !== sheet()) activateSheet(wb.sheets.indexOf(e.sheet)); };
    document.addEventListener('keydown', e => {
      if (document.querySelector('.aero-modal')) return;
      const k = e.key;
      if (k === 'F9') { e.preventDefault(); wb.recalc(true); grid.render(); status(); }
      else if (k === 'F1') { e.preventDefault(); shortcutsDialog(); }
      else if (k === 'F3' && e.shiftKey) { e.preventDefault(); insertFunctionDialog(); }
      else if (k === 'F11' && e.shiftKey) { e.preventDefault(); const s = wb.addSheet(null, wb.active + 1); activateSheet(wb.sheets.indexOf(s)); }
    }, true);
    grid.kbd.focus();
    // welcome card for the empty start
    const w = $('#welcome');
    w.innerHTML = `<div class="aero-box" style="position:relative;max-width:440px"><h3><img src="../kit/icons/sheets.png" alt="">Lumen Sheets</h3><div class="content"><div class="aero-instr">Start a spreadsheet</div><p class="dnote">Formulas with ${Object.keys(F.FN).length} functions, charts, pivot tables and Excel files — all offline.</p></div><div class="aero-btns"><button class="aero-btn" data-w="open">Open file…</button><button class="aero-btn" data-w="sample">Open sample</button><button class="aero-btn pri" data-w="blank">Blank workbook</button></div></div>`;
    w.hidden = false;
    w.onclick = e => { const a = e.target.dataset.w; if (!a) return; w.hidden = true; if (a === 'sample') openSample(); if (a === 'open') openDialog(); grid.kbd.focus(); };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
