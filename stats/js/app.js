// Lumen Stats — application shell: document state + undo, Data/Variable/Output views, files, menus.
(function () {
  'use strict';
  const D = window.LData, A = window.LAnalyses, R = window.LReport, C = window.LCharts, S = window.LStat, X = window.LSamples, DL = window.LDialogs;
  const $ = id => document.getElementById(id), esc = s => Aero.esc(String(s ?? ''));
  const AUTOSAVE = 'lumen-stats-autosave';
  let VER = 1;   // globally unique document version (keys the filter-mask cache)
  const LSTAT = [{ name: 'Lumen Stats project', extensions: ['lstat'] }];
  const TY = { numeric: '#', string: 'A', date: 'D', categorical: 'C' };

  const app = window.StatsApp = {
    doc: emptyDoc(), docName: 'Untitled', filePath: null, view: 'data', labels: true, selVar: 0, outSel: null, zoom: 1,
    get mask() { if (this._maskFor !== this.doc.version) { this._maskFor = this.doc.version; try { this._mask = D.filterMask(this.doc); } catch (e) { this._mask = null; } } return this._mask; },
  };
  function emptyDoc() { return { name: 'Untitled', vars: [], cols: [], n: 0, filter: null, output: [], version: 0 }; }
  document.head.appendChild(Object.assign(document.createElement('style'), { textContent: R.REPORT_CSS }));
  const hist = new Aero.History({ max: 100, onChange: () => updateStatus() });

  // ---------- state / undo ----------
  const cloneVar = v => ({ ...v, values: { ...(v.values || {}) }, missing: (v.missing || []).slice(), missRange: v.missRange ? v.missRange.slice() : null });
  const snap = () => ({ vars: app.doc.vars.map(cloneVar), cols: app.doc.cols.slice(), n: app.doc.n, filter: app.doc.filter ? { ...app.doc.filter } : null, output: app.doc.output.slice(), name: app.doc.name });
  function restore(s) {
    if (!s) return;
    app.doc = { name: s.name, vars: s.vars.map(cloneVar), cols: s.cols.slice(), n: s.n, filter: s.filter ? { ...s.filter } : null, output: s.output.slice(), version: ++VER };
    if (app.outSel && !app.doc.output.some(o => o.id === app.outSel)) app.outSel = null;
    refresh(); autosave();
  }
  // run a document change: fn(doc, w) — w(j) returns a private copy of column j that may be written in place
  function commit(label, fn) {
    const d = app.doc, copied = new Set();
    const w = j => { if (!copied.has(j)) { d.cols[j] = d.cols[j].slice(); copied.add(j); } return d.cols[j]; };
    const r = fn(d, w);
    if (r === false) return false;
    d.version = ++VER;
    hist.push(label, snap()); autosave(); refresh();
    return r;
  }
  let saveT; function autosave() { clearTimeout(saveT); saveT = setTimeout(() => { try { const s = D.serialize(app.doc, { docName: app.docName }); if (s.length < 4.5e6) localStorage.setItem(AUTOSAVE, s); else localStorage.removeItem(AUTOSAVE); } catch (e) { } }, 700); }
  function load(doc, name, path = null) {
    app.doc = { name: doc.name || name, vars: doc.vars, cols: doc.cols, n: doc.n, filter: doc.filter || null, output: doc.output || [], version: ++VER };
    app.docName = name; app.filePath = path; app.selVar = 0; app.outSel = null;
    hist.reset('Open', snap()); Aero.setDoc(name, false);
    grid.sel = { r: 0, c: 0, r2: 0, c2: 0 }; $('grid').scrollTop = 0; $('grid').scrollLeft = 0;
    hideWelcome(); refresh(); autosave();
  }

  // ---------- views ----------
  function setView(v) {
    app.view = v;
    document.querySelectorAll('#tabs .aero-tab').forEach(t => t.classList.toggle('on', t.dataset.v === v));
    $('vData').hidden = v !== 'data'; $('vVars').hidden = v !== 'vars'; $('vOut').hidden = v !== 'output';
    $('sideData').hidden = v === 'output'; $('sideOut').hidden = v !== 'output';
    if (v === 'data') { grid.render(); $('grid').focus({ preventScroll: true }); }
    if (v === 'vars') renderVarView();
    if (v === 'output') renderOutput();
  }
  function refresh() {
    if (app.selVar >= app.doc.vars.length) app.selVar = Math.max(0, app.doc.vars.length - 1);
    if (app.view === 'data') grid.render();
    if (app.view === 'vars') renderVarView();
    if (app.view === 'output') renderOutput();
    renderVarList(); renderSummary(); updateStatus();
    $('outCount').textContent = app.doc.output.length ? `(${app.doc.output.length})` : '';
    renderTabRight();
  }
  function renderTabRight() {
    const f = app.doc.filter;
    $('tabRight').innerHTML = (f && f.active ? `<span class="chip" title="${esc(f.expr)}">Filter: ${esc(f.expr.length > 34 ? f.expr.slice(0, 33) + '…' : f.expr)} <a href="#" id="fOff" title="Use all cases">✕</a></span>` : '') +
      `<label title="Show value labels instead of codes (Ctrl+L)"><input type="checkbox" id="labTog"${app.labels ? ' checked' : ''}> Value labels</label>`;
    $('labTog').onchange = e => { app.labels = e.target.checked; refresh(); };
    const off = $('fOff'); if (off) off.onclick = e => { e.preventDefault(); setFilter(null); };
  }
  function updateStatus() {
    const d = app.doc, m = app.mask;
    $('st1').textContent = `${d.n.toLocaleString()} cases · ${d.vars.length} variables`;
    $('st2').textContent = m ? `Filter on: ${m.reduce((a, b) => a + b, 0).toLocaleString()} selected` : '';
    $('st4').textContent = hist.index > 0 ? `Undo: ${hist.items[hist.index].label}` : '';
  }

  // ---------- grid host ----------
  const grid = new DataGrid($('grid'), {
    get doc() { return app.doc; }, get labels() { return app.labels; }, get mask() { return app.mask; },
    commitCells, pasteBlock, clearRange,
    onSelect(s, sel) { if (sel.c < app.doc.vars.length && app.selVar !== sel.c) { app.selVar = sel.c; renderVarList(); renderSummary(); } selStatus(s); },
    onHeaderDbl(c) { app.selVar = c; setView('vars'); },
    onContext(e, h) { gridMenu(e, h); },
  });
  function selStatus(s) {
    const d = app.doc;
    if (s.r0 === s.r1 && s.c0 === s.c1) {
      const v = d.vars[s.c0]; if (!v || s.r0 >= d.n) { $('st3').textContent = ''; return; }
      const x = d.cols[s.c0][s.r0], lab = D.labelOf(x, v);
      $('st3').textContent = `${v.name}[${s.r0 + 1}] = ${x == null || x === '' ? 'missing' : D.fmtValue(x, v, false)}${lab != null && app.labels ? '' : lab != null ? ' (' + lab + ')' : ''}${D.isUserMissing(x, v) ? ' · user-missing' : ''}`;
      return;
    }
    let n = 0, sum = 0;
    for (let c = s.c0; c <= Math.min(s.c1, d.vars.length - 1); c++) { const v = d.vars[c]; if (v.type === 'string') continue; for (let r = s.r0; r <= Math.min(s.r1, d.n - 1); r++) { const x = d.cols[c][r]; if (!D.isMissing(x, v)) { n++; sum += x; } } }
    $('st3').textContent = `${s.r1 - s.r0 + 1} × ${s.c1 - s.c0 + 1} selected${n ? ` · N ${n} · Sum ${+sum.toPrecision(10)} · Mean ${+(sum / n).toPrecision(6)}` : ''}`;
  }
  function makeVarsUpTo(d, c, types) {
    while (d.vars.length <= c) { const k = d.vars.length; d.vars.push(D.newVar(D.uniqueName(d.vars, 'VAR' + String(k + 1).padStart(5, '0')), types?.[k] || 'numeric', { decimals: 2 })); d.cols.push(new Array(d.n).fill(types?.[k] === 'string' ? '' : null)); }
  }
  function extendCases(d, w, n) { if (n <= d.n) return; d.vars.forEach((v, j) => { const c = w(j); while (c.length < n) c.push(v.type === 'string' ? '' : null); }); d.n = n; }
  function commitCells(list) {
    const d = app.doc;
    // validate first
    for (const { r, c, text } of list) {
      const v = d.vars[c];
      if (v) { const p = D.parseInput(text, v); if (p.error) { Aero.toast(p.error); return false; } }
    }
    return commit(list.length > 1 ? 'Edit cells' : 'Edit cell', (d, w) => {
      list.forEach(({ r, c, text }) => {
        if (c >= d.vars.length) { const t = text.trim() === '' || D.toNumber(text) != null ? 'numeric' : D.parseDate(text) != null ? 'date' : 'string'; const types = []; types[c] = t; makeVarsUpTo(d, c, types); }
        extendCases(d, w, r + 1);
        const v = d.vars[c], p = D.parseInput(text, v); w(c)[r] = p.error ? null : v.type === 'string' ? p.v : p.v;
      });
    });
  }
  function pasteBlock(r0, c0, rows) {
    const d = app.doc, h = rows.length, wd = Math.max(...rows.map(r => r.length));
    if (h * wd > 5e6) return Aero.toast('That is too much to paste at once.');
    let bad = 0;
    commit('Paste', (d, w) => {
      const types = [];
      for (let k = 0; k < wd; k++) { const c = c0 + k; if (c < d.vars.length) continue; const colv = rows.map(r => r[k] ?? '').filter(s => s.trim() !== ''); types[c] = colv.every(s => D.toNumber(s) != null) ? 'numeric' : colv.every(s => D.parseDate(s) != null) ? 'date' : 'string'; }
      makeVarsUpTo(d, c0 + wd - 1, types); extendCases(d, w, r0 + h);
      for (let k = 0; k < wd; k++) { const c = c0 + k, v = d.vars[c], col = w(c); rows.forEach((row, i) => { const p = D.parseInput(row[k] ?? '', v); if (p.error) bad++; col[r0 + i] = p.error ? (v.type === 'string' ? '' : null) : p.v; }); }
    });
    if (bad) Aero.toast(`${bad} pasted value${bad > 1 ? 's' : ''} did not fit the variable type and became missing.`);
  }
  function clearRange(s) {
    const d = app.doc;
    if (grid.dragKind === 'col' || (s.r0 === 0 && s.r1 >= d.n - 1 && d.n > 1 && s.c1 < d.vars.length && grid.lastHeader)) return deleteVars(range(s.c0, Math.min(s.c1, d.vars.length - 1)));
    if (grid.lastRowHeader && s.c0 === 0 && s.c1 >= d.vars.length - 1) return deleteCases(s.r0, Math.min(s.r1, d.n - 1));
    commit('Clear', (d, w) => { for (let c = s.c0; c <= Math.min(s.c1, d.vars.length - 1); c++) { const col = w(c), v = d.vars[c]; for (let r = s.r0; r <= Math.min(s.r1, d.n - 1); r++) col[r] = v.type === 'string' ? '' : null; } });
  }
  const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
  // remember whether the last selection came from a header click (SPSS: Delete removes whole variables/cases)
  $('grid').addEventListener('mousedown', e => { const h = grid.hit(e); grid.lastHeader = !!(h && h.head && !h.rowh); grid.lastRowHeader = !!(h && h.rowh && !h.head); }, true);
  $('grid').addEventListener('keydown', e => { if (e.key.startsWith('Arrow') || e.key === 'Tab' || e.key === 'Enter') { grid.lastHeader = grid.lastRowHeader = false; } }, true);

  // ---------- structural edits ----------
  function insertVar(at = app.doc.vars.length) {
    commit('Insert variable', d => { const v = D.newVar(D.uniqueName(d.vars, 'VAR' + String(d.vars.length + 1).padStart(5, '0'))); d.vars.splice(at, 0, v); d.cols.splice(at, 0, new Array(d.n).fill(null)); });
    app.selVar = at; grid.select(grid.sel.r, at);
  }
  function insertCase(at = app.doc.n) {
    commit('Insert case', d => { d.cols = d.cols.map((c, j) => { const x = c.slice(); x.splice(at, 0, d.vars[j].type === 'string' ? '' : null); return x; }); d.n++; });
  }
  function deleteVars(js) {
    if (!js.length) return; const set = new Set(js);
    commit(js.length > 1 ? `Delete ${js.length} variables` : `Delete ${app.doc.vars[js[0]].name}`, d => { d.vars = d.vars.filter((_, j) => !set.has(j)); d.cols = d.cols.filter((_, j) => !set.has(j)); });
    grid.sel = { r: grid.sel.r, c: Math.min(js[0], Math.max(0, app.doc.vars.length - 1)), r2: grid.sel.r, c2: Math.min(js[0], Math.max(0, app.doc.vars.length - 1)) }; grid.render();
  }
  function deleteCases(a, b) {
    if (b < a || a >= app.doc.n) return;
    commit(b > a ? `Delete ${b - a + 1} cases` : `Delete case ${a + 1}`, d => { d.cols = d.cols.map(c => c.slice(0, a).concat(c.slice(b + 1))); d.n -= b - a + 1; });
    grid.select(Math.min(a, Math.max(0, app.doc.n - 1)), grid.sel.c);
  }
  function setVarProps(j, patch, label = 'Variable properties') {
    const v = app.doc.vars[j]; if (!v) return;
    if (patch.name != null && patch.name !== v.name) { const bad = D.validName(patch.name, app.doc.vars, v); if (bad) { Aero.toast(bad); return false; } }
    if (patch.type && patch.type !== v.type) {
      const r = D.convertColumn(app.doc.cols[j], v, patch.type, v);
      return commit(`Change type of ${v.name}`, d => { d.cols[j] = r.col; Object.assign(d.vars[j], r.meta, { type: patch.type }); if (patch.type === 'date') d.vars[j].width = Math.max(d.vars[j].width, 96); });
    }
    return commit(label, d => Object.assign(d.vars[j], patch));
  }
  function computeVar(name, type, label, expr, cond) {
    let vals, mask = null;
    try { vals = D.evaluate(expr, app.doc); if (cond) { const g = D.compile(cond, app.doc); mask = Array.from({ length: app.doc.n }, (_, i) => D.truth(g(i)) === true); } }
    catch (e) { Aero.alert('Compute variable', e.message); return; }
    const ex = app.doc.vars.findIndex(v => v.name.toLowerCase() === name.toLowerCase());
    commit(`Compute ${name}`, (d, w) => {
      let j = ex;
      if (j < 0) { d.vars.push(D.newVar(name, type, { label, decimals: type === 'numeric' ? 2 : 0 })); d.cols.push(new Array(d.n).fill(type === 'string' ? '' : null)); j = d.vars.length - 1; }
      else if (label) d.vars[j].label = label;
      const t = d.vars[j].type, col = w(j);
      for (let i = 0; i < d.n; i++) if (!mask || mask[i]) col[i] = D.coerce(vals[i], t);
    });
    const j = app.doc.vars.findIndex(v => v.name.toLowerCase() === name.toLowerCase());
    let nmiss = 0; app.doc.cols[j].forEach((v, i) => { if ((!mask || mask[i]) && (v == null || v === '')) nmiss++; });
    Aero.toast(`${ex < 0 ? 'Created' : 'Updated'} ${name}${nmiss ? ` — ${nmiss} case${nmiss > 1 ? 's' : ''} got a missing result` : ''}.`);
    app.selVar = j; if (app.view === 'data') grid.select(0, j);
  }
  function parseLabels(s) { const out = {}; String(s || '').split(/[;\n]/).forEach(p => { const m = /^\s*([^=]+?)\s*=\s*(.+?)\s*$/.exec(p); if (m && m[1] !== '__proto__') out[m[1]] = m[2]; }); return out; }
  function recode(into, src, rules, o) {
    const d0 = app.doc;
    if (into === 'same') {
      for (const j of src) { const v = d0.vars[j]; if (v.type !== 'string' && rules.some(r => r.to.k === 'value' && typeof r.to.v !== 'number')) return Aero.alert('Recode', `${v.name} is ${v.type}: new values must be numbers.`); }
      commit(`Recode ${src.map(j => d0.vars[j].name).join(', ')}`, d => { src.forEach(j => { const v = d.vars[j]; d.cols[j] = D.recodeColumn(d.cols[j], v, rules, { same: true }).map(x => D.coerce(x, v.type)); }); const lab = parseLabels(o.vlabs); if (Object.keys(lab).length) src.forEach(j => Object.assign(d.vars[j].values, lab)); });
    } else {
      const j = src[0], v = d0.vars[j], type = o.otype || 'numeric';
      if (type !== 'string' && rules.some(r => r.to.k === 'value' && typeof r.to.v !== 'number')) return Aero.alert('Recode', 'New values must be numbers for a numeric output variable (or choose String).');
      if (type !== 'string' && v.type === 'string' && rules.some(r => r.to.k === 'copy')) return Aero.alert('Recode', '“Copy old value” would copy text into a numeric variable — choose String output or give explicit values.');
      const col = D.recodeColumn(d0.cols[j], v, rules, { same: false }).map(x => D.coerce(x, type));
      const labels = parseLabels(o.vlabs);
      commit(`Recode into ${o.oname}`, d => { d.vars.push(D.newVar(o.oname, Object.keys(labels).length && type === 'numeric' ? 'categorical' : type, { label: o.olabel || '', values: labels, decimals: type === 'numeric' ? (col.every(x => x == null || Number.isInteger(x)) ? 0 : 2) : 0 })); d.cols.push(col); });
      app.selVar = app.doc.vars.length - 1;
      Aero.toast(`Created ${o.oname}.`);
    }
  }
  function autoRecode() {
    const j = app.selVar, v = app.doc.vars[j];
    if (!v || v.type !== 'string') return Aero.toast('Select a string variable first (Automatic recode turns text into labelled codes).');
    setVarProps(j, { type: 'categorical' }); Aero.toast(`${v.name} is now categorical with ${Object.keys(app.doc.vars[j].values).length} labelled codes.`);
  }
  function setFilter(expr) {
    if (expr) { try { D.compile(expr, app.doc); } catch (e) { return Aero.alert('Select cases', e.message); } }
    commit(expr ? 'Select cases' : 'Use all cases', d => { d.filter = expr ? { expr, active: true } : null; });
    if (expr) { const m = app.mask, k = m ? m.reduce((a, b) => a + b, 0) : app.doc.n; Aero.toast(`${k} of ${app.doc.n} cases selected.`); }
  }
  function deleteUnselected(expr) {
    let m; try { m = D.filterMask({ ...app.doc, filter: { expr, active: true } }); } catch (e) { return Aero.alert('Select cases', e.message); }
    const keep = []; m.forEach((v, i) => v && keep.push(i));
    const del = app.doc.n - keep.length;
    commit(`Delete ${del} unselected cases`, d => { d.cols = d.cols.map(c => keep.map(i => c[i])); d.n = keep.length; d.filter = null; });
    Aero.toast(`Deleted ${del} cases; ${keep.length} remain.`);
  }
  function sortCases(by, desc) {
    const d0 = app.doc, idx = Array.from({ length: d0.n }, (_, i) => i);
    const keys = by.map(j => ({ col: d0.cols[j], v: d0.vars[j] }));
    idx.sort((a, b) => {
      for (const k of keys) {
        const x = k.col[a], y = k.col[b], mx = D.isMissing(x, k.v), my = D.isMissing(y, k.v);
        if (mx || my) { if (mx && my) continue; return mx ? 1 : -1; }
        const c = typeof x === 'string' ? x.localeCompare(y, undefined, { numeric: true }) : x - y;
        if (c) return desc ? -c : c;
      }
      return a - b;
    });
    commit(`Sort cases by ${by.map(j => d0.vars[j].name).join(', ')}`, d => { d.cols = d.cols.map(c => idx.map(i => c[i])); });
  }
  app.computeVar = computeVar; app.recode = recode; app.setFilter = setFilter; app.deleteUnselected = deleteUnselected; app.sortCases = sortCases; app.setVarProps = setVarProps;
  app.levels = j => { const ctx = new A.Ctx(app.doc); return ctx.levels(j, ctx.cases([j])); };

  // ---------- running procedures ----------
  app.run = fn => {
    let it;
    Aero.busy('Running…');
    try { it = fn(app.doc); } catch (e) { Aero.busy(); console.warn(e); Aero.alert('Cannot run this analysis', e.message || String(e)); return null; }
    Aero.busy();
    const add = it.newCols || []; delete it.newCols; ['res', 'table', 'chi', 'R'].forEach(k => delete it[k]);
    commit(it.title, d => {
      add.forEach(c => { const name = D.uniqueName(d.vars, c.name); d.vars.push(D.newVar(name, 'numeric', { label: c.label, decimals: c.decimals ?? 3 })); d.cols.push(c.col); });
      d.output = d.output.concat([it]);
    });
    app.outSel = it.id; setView('output');
    requestAnimationFrame(() => { const el = document.querySelector(`.oi[data-id="${CSS.escape(it.id)}"]`); if (el) el.scrollIntoView({ block: 'start' }); });
    return it;
  };

  // ---------- variable view ----------
  const MEAS = { scale: 'Scale', ordinal: 'Ordinal', nominal: 'Nominal' };
  function renderVarView() {
    const vars = app.doc.vars, el = $('varView');
    const sc = el.scrollTop;
    const labs = v => { const e = Object.entries(v.values || {}); return e.length ? e.slice(0, 4).map(([k, l]) => `${k} = ${l}`).join(', ') + (e.length > 4 ? ` … (${e.length})` : '') : ''; };
    const miss = v => [(v.missing || []).join(', '), v.missRange ? `${v.missRange[0]} thru ${v.missRange[1]}` : ''].filter(Boolean).join('; ');
    el.innerHTML = `<table class="vv"><thead><tr><th></th><th>Name</th><th>Type</th><th>Decimals</th><th>Width</th><th>Label</th><th>Values</th><th>Missing</th><th>Measure</th><th>N valid</th></tr></thead><tbody>${vars.map((v, j) => {
      const col = app.doc.cols[j]; let nv = 0; for (let i = 0; i < app.doc.n; i++) if (!D.isMissing(col[i], v)) nv++;
      return `<tr data-j="${j}" class="${j === app.selVar ? 'on' : ''}"><td class="rn">${j + 1}</td>
      <td><input type="text" class="nm" data-k="name" value="${esc(v.name)}" spellcheck="false"></td>
      <td><select data-k="type">${D.TYPES.map(t => `<option value="${t}"${t === v.type ? ' selected' : ''}>${t[0].toUpperCase() + t.slice(1)}</option>`).join('')}</select></td>
      <td><input type="number" data-k="decimals" min="0" max="10" value="${v.decimals}" style="width:58px"${v.type === 'string' ? ' disabled' : ''}></td>
      <td><input type="number" data-k="width" min="40" max="600" step="4" value="${v.width}" style="width:64px"></td>
      <td><input type="text" data-k="label" value="${esc(v.label)}" style="min-width:220px"></td>
      <td><div class="cellbtn"><span class="${labs(v) ? '' : 'none'}">${esc(labs(v) || 'None')}</span><button data-b="values" title="Edit value labels">…</button></div></td>
      <td><div class="cellbtn" style="min-width:110px"><span class="${miss(v) ? '' : 'none'}">${esc(miss(v) || 'None')}</span><button data-b="missing" title="Define missing values">…</button></div></td>
      <td><select data-k="measure">${D.MEASURES.map(m => `<option value="${m}"${m === v.measure ? ' selected' : ''}>${MEAS[m]}</option>`).join('')}</select></td>
      <td style="text-align:right;padding-right:8px;color:var(--dim)">${nv}</td></tr>`;
    }).join('')}<tr class="add"><td class="rn">+</td><td colspan="9" id="vvAdd">Click to add a variable</td></tr></tbody></table>
    <div class="vv-foot">Types: Numeric · String (text) · Date (YYYY-MM-DD) · Categorical (codes with value labels). Changing String → Categorical builds codes and labels automatically.</div>`;
    el.scrollTop = sc;
    el.querySelectorAll('tr[data-j]').forEach(tr => {
      const j = +tr.dataset.j;
      tr.addEventListener('focusin', () => { if (app.selVar !== j) { app.selVar = j; el.querySelectorAll('tr.on').forEach(t => t.classList.remove('on')); tr.classList.add('on'); renderVarList(); renderSummary(); } });
      tr.querySelectorAll('[data-k]').forEach(inp => {
        const k = inp.dataset.k;
        inp.addEventListener('change', () => {
          let val = inp.value;
          if (k === 'decimals') val = Math.max(0, Math.min(10, Math.round(+val || 0)));
          if (k === 'width') val = Math.max(40, Math.min(600, Math.round(+val || 84)));
          if (k === 'name') { val = val.trim(); const bad = D.validName(val, app.doc.vars, app.doc.vars[j]); if (bad) { inp.classList.add('bad'); Aero.toast(bad); return; } }
          if (setVarProps(j, { [k]: val }, k === 'name' ? 'Rename variable' : 'Variable properties') === false) inp.classList.add('bad');
        });
        if (k === 'name') inp.addEventListener('input', () => inp.classList.toggle('bad', !!D.validName(inp.value.trim(), app.doc.vars, app.doc.vars[j])));
      });
      tr.querySelector('[data-b=values]').onclick = () => DL.valueLabels(app, j);
      tr.querySelector('[data-b=missing]').onclick = () => DL.missingValues(app, j);
    });
    $('vvAdd').onclick = () => { insertVar(); setTimeout(() => { const ins = el.querySelectorAll('input.nm'); ins[ins.length - 1]?.focus(); ins[ins.length - 1]?.select(); }, 0); };
    if (app._focusVar != null) { const t = el.querySelector(`tr[data-j="${app._focusVar}"] input.nm`); t?.scrollIntoView({ block: 'nearest' }); app._focusVar = null; }
  }

  // ---------- side panel: variable list + summary ----------
  function renderVarList() {
    const q = $('vSearch').value.trim().toLowerCase(), vars = app.doc.vars;
    $('nVars').textContent = vars.length || '';
    $('vList').innerHTML = vars.map((v, j) => (!q || v.name.toLowerCase().includes(q) || (v.label || '').toLowerCase().includes(q)) ?
      `<div class="aero-item${j === app.selVar ? ' sel' : ''}" data-j="${j}" title="${esc(v.label ? v.name + ' — ' + v.label : v.name)}"><span class="ty ${v.type}">${TY[v.type]}</span><span class="grow">${esc(v.name)}</span><span class="lab">${esc(v.label)}</span></div>` : '').join('') || '<div class="dim" style="padding:8px">No variables</div>';
    $('vList').querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
  $('vSearch').oninput = renderVarList;
  $('vList').addEventListener('click', e => { const it = e.target.closest('.aero-item'); if (!it) return; const j = +it.dataset.j; app.selVar = j; renderVarList(); renderSummary(); if (app.view === 'data') { grid.selectRect(0, j, Math.max(0, app.doc.n - 1), j); grid.scrollTo(grid.sel.r, j); grid.render(); } if (app.view === 'vars') { app._focusVar = j; renderVarView(); } });
  $('vList').addEventListener('dblclick', e => { const it = e.target.closest('.aero-item'); if (!it) return; app.selVar = +it.dataset.j; app._focusVar = app.selVar; setView('vars'); });
  function renderSummary() {
    const el = $('vSum'), j = app.selVar, v = app.doc.vars[j];
    if (!v) { el.innerHTML = '<div class="empty">No variable selected</div>'; $('sumName').textContent = ''; return; }
    $('sumName').textContent = v.name;
    const m = app.mask, col = app.doc.cols[j]; const valid = [];
    let sys = 0, um = 0, tot = 0;
    for (let i = 0; i < app.doc.n; i++) { if (m && !m[i]) continue; tot++; const x = col[i]; if (x == null || x === '') sys++; else if (D.isMissing(x, v)) um++; else valid.push(x); }
    const kv = pairs => `<div class="k">${pairs.map(([a, b]) => `<span>${esc(a)}</span><span>${esc(b)}</span>`).join('')}</div>`;
    let html = `<div class="vt">${esc(v.label || v.name)}</div>`;
    const base = [['Type', `${v.type} · ${v.measure}`], ['Valid', valid.length.toLocaleString()], ['Missing', `${sys + um}${um ? ` (${um} user)` : ''}`]];
    const distinct = new Set(valid).size, showCats = v.type === 'string' || v.type === 'categorical' || ((v.measure === 'nominal' || Object.keys(v.values || {}).length) && distinct <= 24);
    if (!valid.length) html += kv(base);
    else if (showCats) {
      const cnt = new Map(); valid.forEach(x => cnt.set(x, (cnt.get(x) || 0) + 1));
      const top = [...cnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
      html += kv([...base, ['Distinct', cnt.size]]);
      const max = top[0][1];
      html += `<svg viewBox="0 0 240 ${top.length * 19 + 4}">${top.map(([x, c], k) => { const lab = D.fmtValue(x, v, true); return `<text x="0" y="${k * 19 + 13}" font-size="10.5" fill="#52514e">${esc(lab.length > 16 ? lab.slice(0, 15) + '…' : lab)}</text><rect x="92" y="${k * 19 + 3}" width="${Math.max(2, 120 * c / max)}" height="13" rx="2" fill="${C.PAL[0]}"><title>${esc(lab)}: ${c}</title></rect><text x="${96 + 120 * c / max}" y="${k * 19 + 13}" font-size="10" fill="#52514e">${c}</text>`; }).join('')}</svg>`;
      if (cnt.size > 8) html += `<div class="dim">… and ${cnt.size - 8} more values</div>`;
    } else {
      const d = S.describe(valid), f = x => v.type === 'date' ? D.dateStr(x) : D.fmtNum(+x.toPrecision(6), null);
      html += kv([...base, ['Mean', f(d.mean)], ['Std. dev.', v.type === 'date' ? (+d.sd.toFixed(1)) + ' days' : f(d.sd)], ['Minimum', f(d.min)], ['Median', f(d.median)], ['Maximum', f(d.max)]]);
      if (d.max > d.min) {
        const hb = S.histBins(valid, Math.min(24, Math.max(6, Math.round(Math.sqrt(valid.length))))), mx = Math.max(...hb.counts), bw = 240 / hb.counts.length;
        html += `<svg viewBox="0 0 240 92">${hb.counts.map((c, k) => `<rect x="${k * bw + 0.5}" y="${84 - 78 * c / mx}" width="${Math.max(1, bw - 1.5)}" height="${78 * c / mx}" rx="1.5" fill="${C.PAL[0]}"><title>${esc(f(hb.edges[k]))} – ${esc(f(hb.edges[k + 1]))}: ${c}</title></rect>`).join('')}<line x1="0" y1="84.5" x2="240" y2="84.5" stroke="#9aa3ad"/></svg>`;
      }
    }
    if (m) html += `<div class="dim" style="margin-top:4px">Filtered: ${tot} of ${app.doc.n} cases</div>`;
    el.innerHTML = html;
  }

  // ---------- output view ----------
  const procIcon = p => p === 'chart' || p === 'control' ? 'chart' : ['regress', 'logistic', 'glm'].includes(p) ? 'model' : '';
  function renderOutput() {
    const out = app.doc.output, rep = $('report');
    $('nOut').textContent = out.length || '';
    $('oList').innerHTML = out.map(o => `<div class="aero-item${o.id === app.outSel ? ' sel' : ''}" data-id="${esc(o.id)}" title="${esc(o.sub || o.title)}"><span class="ic ${procIcon(o.proc)}"></span><span class="grow">${esc(o.title)}</span></div>`).join('') || '<div class="dim" style="padding:8px">No output yet</div>';
    const key = out.map(o => o.id).join(',') + '|' + app.outSel;
    if (rep._key === key) return; rep._key = key;
    if (!out.length) { rep.innerHTML = '<div class="out-empty"><b>No output yet</b>Run an analysis from the Analyze or Graphs menu — tables and charts are collected here as a report<br>you can export to HTML or PDF.</div>'; return; }
    rep.innerHTML = out.map(o => R.itemHTML(o).replace('<h2>', `<div class="otools"><button data-a="copy" title="Copy this output">Copy</button><button data-a="del" title="Delete this output">Delete</button></div><h2>`)).join('');
    rep.querySelectorAll('.oi').forEach(s => s.classList.toggle('sel', s.dataset.id === app.outSel));
  }
  $('oList').addEventListener('click', e => { const it = e.target.closest('.aero-item'); if (!it) return; app.outSel = it.dataset.id; renderOutput(); document.querySelector(`.oi[data-id="${CSS.escape(app.outSel)}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }); });
  $('report').addEventListener('click', e => {
    const sec = e.target.closest('.oi'); if (!sec) return;
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (a === 'del') return deleteOutput(sec.dataset.id);
    if (a === 'copy') return copyOutput(sec.dataset.id);
    if (app.outSel !== sec.dataset.id) { app.outSel = sec.dataset.id; renderOutput(); }
  });
  function deleteOutput(id = app.outSel) { const o = app.doc.output.find(x => x.id === id); if (!o) return; const i = app.doc.output.indexOf(o); commit(`Delete output: ${o.title}`, d => { d.output = d.output.filter(x => x.id !== id); }); app.outSel = app.doc.output[Math.min(i, app.doc.output.length - 1)]?.id || null; renderOutput(); }
  function moveOutput(dir) { const out = app.doc.output, i = out.findIndex(o => o.id === app.outSel), k = i + dir; if (i < 0 || k < 0 || k >= out.length) return; commit('Move output', d => { const o = d.output.slice(); [o[i], o[k]] = [o[k], o[i]]; d.output = o; }); }
  async function copyOutput(id) {
    const o = app.doc.output.find(x => x.id === id); if (!o) return;
    const html = `<style>${R.REPORT_CSS}</style><div class="report">${R.itemHTML(o)}</div>`, text = document.querySelector(`.oi[data-id="${CSS.escape(id)}"]`)?.innerText || o.title;
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]); Aero.toast('Copied — paste into Word, Excel or an e-mail.'); }
    catch (e) { try { await navigator.clipboard.writeText(text); Aero.toast('Copied as text.'); } catch (e2) { Aero.toast('Clipboard is not available.'); } }
  }
  function setZoom(z) { app.zoom = Math.max(0.5, Math.min(2, z)); $('report').style.zoom = app.zoom; Aero.toast(`Output zoom ${Math.round(app.zoom * 100)}%`); }
  $('oUp').onclick = () => moveOutput(-1); $('oDown').onclick = () => moveOutput(1); $('oDel').onclick = () => deleteOutput();
  $('oHtml').onclick = () => exportOutput('html'); $('oPdf').onclick = () => exportOutput('pdf');

  // ---------- files ----------
  const loaded = {};
  function loadScript(src) { return loaded[src] || (loaded[src] = new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { delete loaded[src]; rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); })); }
  function decodeText(buf) {
    let t = new TextDecoder('utf-8').decode(buf);
    if (t.includes('�')) t = new TextDecoder('windows-1252').decode(buf);
    return t;
  }
  async function confirmDiscard() { if (!Aero.dirty) return true; return Aero.confirm('Unsaved changes', 'The current data has unsaved changes. Discard them?', 'Discard'); }
  async function openFiles(files) {
    if (!files || !files.length) return;
    const f = files[0], ext = (f.name.split('.').pop() || '').toLowerCase();
    if (!(await confirmDiscard())) return;
    Aero.busy('Opening ' + f.name + '…');
    try {
      const base = Aero.baseName(f.name);
      if (ext === 'lstat' || ext === 'json') { const doc = D.deserialize(decodeText(f.data)); load(doc, base, f.path || null); Aero.toast(`Opened ${f.name}: ${doc.n} cases, ${doc.vars.length} variables.`); }
      else if (['csv', 'tsv', 'txt', 'dat', 'tab'].includes(ext)) {
        const text = decodeText(f.data), rows = D.parseCSV(text, ext === 'tsv' || ext === 'tab' ? '\t' : null);
        if (!rows.length) throw new Error('The file is empty.');
        const header = guessHeader(rows), doc = D.fromRows(rows, { header, name: base, decimalComma: rows.delim === ';' && looksDecimalComma(rows) });
        load(doc, base, null); Aero.setDirty(true);
        Aero.toast(`Imported ${doc.n} cases × ${doc.vars.length} variables (${rows.delim === '\t' ? 'tab' : rows.delim === ';' ? 'semicolon' : rows.delim === '|' ? 'pipe' : 'comma'}-separated). Check types in Variable View.`);
      } else if (['xlsx', 'xls', 'xlsm', 'ods'].includes(ext)) {
        await loadScript('vendor/xlsx.full.min.js');
        const wb = XLSX.read(new Uint8Array(f.data), { type: 'array', cellDates: true, dense: true });
        let sheet = wb.SheetNames[0];
        if (wb.SheetNames.length > 1) { Aero.busy(); sheet = await new Promise(res => Aero.dialog({ title: 'Import spreadsheet', instruction: 'Which worksheet holds the data?', fields: [{ key: 's', label: 'Worksheet', type: 'select', value: sheet, options: wb.SheetNames }], onOK: v => res(v.s), onCancel: () => res(null) })); if (!sheet) return; Aero.busy('Importing…'); }
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, raw: true, defval: null, blankrows: false });
        if (!rows.length) throw new Error('That worksheet is empty.');
        const doc = D.fromRows(rows, { header: guessHeader(rows), name: base });
        load(doc, base + (wb.SheetNames.length > 1 ? ' – ' + sheet : ''), null); Aero.setDirty(true);
        Aero.toast(`Imported ${doc.n} cases × ${doc.vars.length} variables from “${sheet}”.`);
      } else if (ext === 'sav' || ext === 'mtw' || ext === 'dta') throw new Error(`.${ext} files can’t be read directly yet. Export the data from that program as CSV or Excel and open that.`);
      else throw new Error('Unsupported file type .' + ext + ' — open a .lstat project, CSV/TSV/TXT, or Excel/ODS spreadsheet.');
    } catch (e) { console.warn(e); Aero.busy(); Aero.alert('Cannot open file', e.message || String(e)); }
    finally { Aero.busy(); }
  }
  function guessHeader(rows) {
    if (rows.length < 2) return true;
    const a = rows[0], b = rows[1];
    const numA = a.filter(x => typeof x === 'number' || (typeof x === 'string' && D.toNumber(x) != null)).length;
    const numB = b.filter(x => typeof x === 'number' || (typeof x === 'string' && D.toNumber(x) != null)).length;
    return !(numA > 0 && numA >= numB && a.every(x => x != null && x !== ''));
  }
  const looksDecimalComma = rows => rows.slice(1, 50).some(r => r.some(x => /^-?\d+,\d+$/.test(String(x).trim())));
  async function openDialog() { openFiles(await Aero.openFile({ accept: '.lstat,.csv,.tsv,.txt,.dat,.xlsx,.xls,.xlsm,.ods', filters: [{ name: 'Data files', extensions: ['lstat', 'csv', 'tsv', 'txt', 'dat', 'xlsx', 'xls', 'xlsm', 'ods'] }] })); }
  async function save(as = false) {
    const data = D.serialize(app.doc, { docName: app.docName });
    const p = await Aero.saveFile({ name: app.docName.replace(/[\\/:*?"<>|]/g, '_') + '.lstat', data, filters: LSTAT, path: as ? null : app.filePath });
    if (!p) return false;
    if (typeof p === 'string' && /[\\/]/.test(p)) app.filePath = p;
    app.docName = Aero.baseName(String(p)); Aero.setDoc(app.docName, false); Aero.toast('Saved ' + Aero.baseName(String(p)) + '.lstat'); return true;
  }
  async function exportData(kind) {
    if (!app.doc.vars.length) return Aero.toast('There is no data to export.');
    const base = app.docName.replace(/[\\/:*?"<>|]/g, '_');
    if (kind === 'csv' || kind === 'csvlab' || kind === 'tsv') {
      const s = D.toCSV(app.doc, { delim: kind === 'tsv' ? '\t' : ',', labels: kind === 'csvlab' });
      return Aero.saveFile({ name: base + (kind === 'tsv' ? '.tsv' : '.csv'), data: '﻿' + s, filters: [{ name: kind === 'tsv' ? 'Tab-separated text' : 'CSV', extensions: [kind === 'tsv' ? 'tsv' : 'csv'] }] });
    }
    if (kind === 'xlsx') {
      Aero.busy('Writing workbook…');
      try {
        await loadScript('vendor/xlsx.full.min.js');
        const d = app.doc, aoa = [d.vars.map(v => v.name)];
        for (let i = 0; i < d.n; i++) aoa.push(d.vars.map((v, j) => { const x = d.cols[j][i]; if (x == null || x === '') return null; if (v.type === 'date') { const u = new Date(Math.round(x * 864e5)); return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes()); } return x; /* SheetJS reads JS dates as local time */ }));
        const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true }), wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Data');
        const vv = [['Name', 'Type', 'Label', 'Value labels', 'Missing', 'Measure'], ...d.vars.map(v => [v.name, v.type, v.label, Object.entries(v.values || {}).map(([k, l]) => `${k}=${l}`).join('; '), (v.missing || []).join(', '), v.measure])];
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(vv), 'Variables');
        const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
        Aero.busy(); return Aero.saveFile({ name: base + '.xlsx', data: new Uint8Array(out), filters: [{ name: 'Excel workbook', extensions: ['xlsx'] }] });
      } catch (e) { Aero.busy(); Aero.alert('Export failed', e.message); }
    }
  }
  async function exportOutput(kind) {
    const items = app.doc.output; if (!items.length) return Aero.toast('There is no output to export yet.');
    const base = app.docName.replace(/[\\/:*?"<>|]/g, '_') + ' – output', opts = { title: `${app.docName} – statistical report`, dataset: app.doc.name };
    if (kind === 'html') return Aero.saveFile({ name: base + '.html', data: R.exportHTML(items, opts), filters: [{ name: 'HTML report', extensions: ['html'] }] });
    Aero.busy('Building PDF…');
    try { await loadScript('vendor/pdf-lib.min.js'); const bytes = await R.exportPDF(items, { ...opts, PDFLib: window.PDFLib }); Aero.busy(); return Aero.saveFile({ name: base + '.pdf', data: bytes, filters: [{ name: 'PDF document', extensions: ['pdf'] }] }); }
    catch (e) { Aero.busy(); Aero.alert('PDF export failed', e.message); }
  }
  async function newDoc() { if (!(await confirmDiscard())) return; load({ name: 'Untitled', vars: [], cols: [], n: 0 }, 'Untitled'); showWelcome(); }
  async function openSample(kind) {
    if (!(await confirmDiscard())) return;
    const doc = { demo: X.demoDoc, mtcars: X.mtcarsDoc, plant: X.plantDoc, sleep: X.sleepDoc, tooth: X.toothDoc }[kind]();
    load(doc, doc.name); setView('data');
    if (kind === 'demo') { buildDemoOutput(); hist.reset('Open sample', snap()); Aero.setDoc(app.docName, false); setView('output'); const first = document.querySelector('.oi'); first && first.scrollIntoView({ block: 'start' }); app.outSel = app.doc.output[0]?.id; renderOutput(); }
  }
  function buildDemoOutput() {
    const d = app.doc, ix = n => d.vars.findIndex(v => v.name === n), items = [];
    const push = it => { ['res', 'table', 'chi', 'R', 'newCols'].forEach(k => delete it[k]); items.push(it); };
    push(A.descriptives(d, { vars: [ix('age'), ix('bmi'), ix('sbp0'), ix('sbp12'), ix('change')], stats: ['n', 'missing', 'mean', 'sd', 'min', 'median', 'max'] }));
    push(A.chartProc(d, { kind: 'scatter', kindName: 'Scatter plot', x: ix('sbp0'), y: ix('sbp12'), by: ix('group'), fit: true }));
    push(A.anova1(d, { vars: [ix('change')], factor: ix('group'), posthoc: ['tukey'] }));
    push(A.crosstabs(d, { row: ix('group'), col: ix('responder'), cells: ['count', 'row'] }));
    push(A.regress(d, { dep: ix('sbp12'), preds: [ix('sbp0'), ix('group'), ix('adherence')], plots: false }));
    d.output = items;
  }

  // ---------- welcome ----------
  function showWelcome() {
    if (document.querySelector('.welcome')) return;
    const w = Aero.el('div', 'welcome', `<div class="card"><h2>Welcome to Lumen Stats</h2><p>Statistics in the spirit of SPSS and Minitab: enter or import data, then run tests, models and charts from the Analyze and Graphs menus. Results collect in the Output report.</p>
      <div class="btns"><button class="aero-btn" data-w="demo">Open sample<small>Blood-pressure trial with a finished report</small></button><button class="aero-btn" data-w="open">Open or import…<small>.lstat, CSV, TSV, Excel, ODS</small></button>
      <button class="aero-btn" data-w="new">Start typing data<small>An empty sheet — just type into the grid</small></button><button class="aero-btn" data-w="mtcars">Classic dataset<small>mtcars (Motor Trend 1974)</small></button></div></div>`);
    $('vData').appendChild(w);
    w.addEventListener('click', e => { const b = e.target.closest('[data-w]'); if (!b) return; const k = b.dataset.w; if (k === 'open') openDialog(); else if (k === 'new') { hideWelcome(); grid.select(0, 0); $('grid').focus(); } else openSample(k); });
  }
  function hideWelcome() { document.querySelector('.welcome')?.remove(); }

  // ---------- popup menus ----------
  function popMenu(x, y, items) {
    document.querySelectorAll('.pop').forEach(p => p.remove());
    const dd = Aero.el('div', 'aero-dropdown pop');
    items.forEach(it => {
      if (it === '-') return dd.appendChild(Aero.el('div', 'aero-msep'));
      if (typeof it === 'string' && it[0] === '#') return dd.appendChild(Aero.el('div', 'aero-mhead', esc(it.slice(1))));
      const [label, key, fn, dis] = Array.isArray(it) ? it : [it.label, it.key, it.fn, it.disabled];
      const mi = Aero.el('div', 'aero-mi' + (dis ? ' disabled' : ''), `<span>${esc(label)}</span><span class="k">${esc(key || '')}</span>`);
      mi.onclick = e => { e.stopPropagation(); dd.remove(); fn && fn(); }; dd.appendChild(mi);
    });
    document.body.appendChild(dd);
    const r = dd.getBoundingClientRect(); dd.style.left = Math.min(x, innerWidth - r.width - 6) + 'px'; dd.style.top = Math.min(y, innerHeight - r.height - 6) + 'px';
    const close = e => { if (!dd.contains(e.target)) { dd.remove(); removeEventListener('mousedown', close, true); removeEventListener('keydown', esc2, true); } };
    const esc2 = e => { if (e.key === 'Escape') { dd.remove(); removeEventListener('mousedown', close, true); removeEventListener('keydown', esc2, true); } };
    setTimeout(() => { addEventListener('mousedown', close, true); addEventListener('keydown', esc2, true); }, 0);
  }
  const under = (id, items) => { const r = $(id).getBoundingClientRect(); popMenu(r.left, r.bottom + 2, items); };
  function gridMenu(e, h) {
    const d = app.doc, s = grid.norm(), onVar = h.c < d.vars.length;
    if (h.head && onVar) return popMenu(e.clientX, e.clientY, [
      ['Variable properties…', '', () => { app.selVar = h.c; app._focusVar = h.c; setView('vars'); }], ['Value labels…', '', () => DL.valueLabels(app, h.c)], ['Missing values…', '', () => DL.missingValues(app, h.c)], '-',
      ['Sort ascending', '', () => sortCases([h.c], false)], ['Sort descending', '', () => sortCases([h.c], true)], '-',
      ['Descriptives', '', () => app.run(dd => A.descriptives(dd, { vars: [h.c] })), d.vars[h.c].type === 'string'], ['Frequencies', '', () => app.run(dd => A.frequencies(dd, { vars: [h.c] }))], ['Histogram', '', () => app.run(dd => A.chartProc(dd, { kind: 'histogram', kindName: 'Histogram', x: h.c })), d.vars[h.c].type === 'string'], '-',
      ['Insert variable', '', () => insertVar(h.c)], [s.c1 > s.c0 ? `Delete ${s.c1 - s.c0 + 1} variables` : 'Delete variable', '', () => deleteVars(range(s.c0, Math.min(s.c1, d.vars.length - 1)))]]);
    if (h.rowh) return popMenu(e.clientX, e.clientY, [['Insert case', '', () => insertCase(h.r)], [s.r1 > s.r0 ? `Delete ${s.r1 - s.r0 + 1} cases` : 'Delete case', '', () => deleteCases(s.r0, Math.min(s.r1, d.n - 1)), h.r >= d.n]]);
    popMenu(e.clientX, e.clientY, [['Cut', 'Ctrl+X', () => clip('cut')], ['Copy', 'Ctrl+C', () => clip('copy')], ['Paste', 'Ctrl+V', () => clip('paste')], ['Clear', 'Delete', () => clearRange(s)], '-',
      ['Insert case', '', () => insertCase(h.r)], ['Insert variable', '', () => insertVar(h.c)], '-', ['Select cases where = this value', '', () => { const v = d.vars[h.c], x = d.cols[h.c]?.[h.r]; if (!v || h.r >= d.n || x == null || x === '') return; setFilter(`${v.name} = ${typeof x === 'string' ? JSON.stringify(x) : x}`); }, !onVar || h.r >= d.n]]);
  }
  async function clip(kind) {
    $('grid').focus();
    if (kind === 'paste') { try { const t = await navigator.clipboard.readText(); const rows = t.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(l => l.split('\t')); pasteBlock(grid.norm().r0, grid.norm().c0, rows); } catch (e) { Aero.toast('Press Ctrl+V to paste.'); } return; }
    const ok = document.execCommand(kind); if (!ok) { try { await navigator.clipboard.writeText(grid.rangeTSV(grid.norm())); if (kind === 'cut') clearRange(grid.norm()); } catch (e) { Aero.toast('Clipboard is not available.'); } }
  }

  // ---------- menus ----------
  const P = DL.P, go = k => () => { if (!app.doc.vars.length) return Aero.toast('Open or enter some data first.'); P[k](app); };
  const MEANS = [['One-sample t-test…', '', go('tOne')], ['Independent-samples t-test…', '', go('tInd')], ['Paired-samples t-test…', '', go('tPaired')], '-', ['One-way ANOVA…', '', go('anova1')], ['Univariate (two-way ANOVA)…', '', go('glm')], '-', '#Non-parametric', ['Mann–Whitney U…', '', go('mannWhitney')], ['Wilcoxon signed-rank…', '', go('wilcoxon')], ['Kruskal–Wallis H…', '', go('kruskal')]];
  const REG = [['Bivariate correlation…', '', go('correlate')], '-', ['Linear regression…', '', go('regress')], ['Binary logistic regression…', '', go('logistic')]];
  const GRAPHS = [['Histogram…', '', go('histogram')], ['Box plot…', '', go('box')], ['Scatter plot…', '', go('scatter')], ['Bar chart…', '', go('bar')], ['Line chart of means…', '', go('line')], ['Normal Q-Q plot…', '', go('qq')], '-', ['Control chart (I-MR, Xbar-R, P)…', '', go('control')]];
  const needData = fn => () => app.doc.vars.length ? fn() : Aero.toast('Open or enter some data first.');
  const del = () => {
    if (app.view === 'output') return deleteOutput();
    if (app.view === 'data') return clearRange(grid.norm());
  };
  function helpShortcuts() {
    Aero.alert('Keyboard shortcuts', 'Ctrl+N new · Ctrl+O open · Ctrl+S save · Ctrl+Shift+S save as\nCtrl+Z undo · Ctrl+Y redo\nCtrl+1 / 2 / 3 — Data View, Variable View, Output\nCtrl+L — value labels on/off\n\nData View: arrows move · Shift+arrows extend · Ctrl+arrows jump to the edge · Enter / Tab commit and move · F2 or just type to edit · Esc cancels\nCtrl+C / Ctrl+X / Ctrl+V copy, cut and paste blocks (Excel-compatible tab-separated)\nDelete clears cells — or deletes whole variables / cases when they were selected by their header\nDouble-click a column header for its properties · right-click for more\n\nOutput: Delete removes the selected item · Ctrl+= / Ctrl+- / Ctrl+0 zoom the report');
  }
  function helpFunctions() {
    Aero.alert('Expression reference', 'Used by Compute variable and Select cases.\n\nArithmetic: + − * / ** (power) % (remainder)\nComparison: = ~= (not equal, also <> !=) < <= > >=\nLogic: AND & · OR | · NOT ~   — missing values propagate (missing AND false = false)\nText in quotes: site = "Oslo"\n\nMath: ABS SQRT EXP LN LG10 LOG(x,base) ROUND(x,d) RND(x,mult) TRUNC CEIL FLOOR MOD SIGN SIN COS TAN ASIN ACOS ATAN\nAcross variables: SUM MEAN SD VARIANCE MEDIAN MIN MAX NVALID NMISS (ignore missing arguments)\nMissing: MISSING(x) (system or user) · SYSMIS(x) · VALUE(x) (raw value, ignores user-missing)\nLogic: IF(cond, a, b) · ANY(x, v1, v2…) · RANGE(x, lo, hi…)\nPrevious case: LAG(x) · LAG(x, k) · $CASENUM\nText: CONCAT UPCASE LOWER LENGTH SUBSTR(s,start,len) INDEX TRIM REPLACE NUMBER(s) STRING(x,d)\nDates (day numbers): YEAR MONTH DAY WEEKDAY DATE(y,m,d) DATEVALUE("2026-01-31") DATEDIFF(a,b)\nDistributions: CDF.NORMAL(x,m,s) IDF.NORMAL(p,m,s) PDF.NORMAL CDF.T(x,df) IDF.T(p,df) CDF.CHISQ CDF.F\nRandom: RV.NORMAL(m,s) RV.UNIFORM(a,b) NORMAL(sd) UNIFORM(max)\n\nExpressions are interpreted by Lumen Stats — they can only read this dataset, never run code.');
  }
  function helpMethods() {
    Aero.alert('Methods and accuracy', 'Distributions: normal via the regularized incomplete gamma function; t and F via the incomplete beta function (continued fractions); chi-square via the incomplete gamma; quantiles by Brent root-finding on the exact tails (≈ 1e-12 relative accuracy). Studentized range (Tukey) per Copenhaver & Holland (1988) as in R.\n\nt-tests: Student and Welch–Satterthwaite; Levene uses absolute deviations from the group mean (as SPSS).\nANOVA: one-way with Welch’s robust F; post hoc Tukey HSD (Tukey–Kramer for unequal n) and Bonferroni. Factorial ANOVA uses Type III sums of squares with effect coding; empty cells are not allowed.\nRegression: Householder QR; VIF from the inverse correlation matrix; Durbin–Watson; Cook’s distance. Logistic: Newton–Raphson with step halving; Wald tests; Cox & Snell / Nagelkerke R²; Hosmer–Lemeshow on deciles of risk.\nNon-parametric: average ranks with tie corrections; exact permutation p-values (ties included) for Mann–Whitney and Wilcoxon when n ≤ 60.\nNormality: Shapiro–Wilk (Royston 1995), Lilliefors (Dallal–Wilkinson), Anderson–Darling (D’Agostino & Stephens).\nPercentiles and quartiles: weighted average at p(n + 1) (SPSS HAVERAGE / Minitab).\n\nThe test suite checks these against published results (R, SciPy) for classic datasets: Student’s sleep, PlantGrowth, ToothGrowth, mtcars and Agresti’s party-identification table.');
  }
  Aero.init({ name: 'Lumen Stats', icon: '../kit/icons/stats.png', doc: 'Untitled', onDropFiles: openFiles, dropTarget: document.querySelector('.st-work'), dropText: 'Drop a .lstat project, CSV/TSV or Excel file to open it', onSave: () => save(false),
    menus: {
      File: [['New', 'Ctrl+N', newDoc], ['Open…', 'Ctrl+O', openDialog], '#Open sample', ['Blood-pressure trial (demo with report)', '', () => openSample('demo')], ['mtcars — Motor Trend 1974', '', () => openSample('mtcars')], ['PlantGrowth — one-way ANOVA', '', () => openSample('plant')], ['ToothGrowth — two-way ANOVA', '', () => openSample('tooth')], ['Student’s sleep data — paired t', '', () => openSample('sleep')], '-',
        ['Save', 'Ctrl+S', () => save(false)], ['Save as…', 'Ctrl+Shift+S', () => save(true)], '-', '#Export data',
        ['CSV (values)…', '', () => exportData('csv')], ['CSV (value labels)…', '', () => exportData('csvlab')], ['Tab-separated text…', '', () => exportData('tsv')], ['Excel workbook (.xlsx)…', '', () => exportData('xlsx')], '#Export output',
        ['Report as HTML…', '', () => exportOutput('html')], ['Report as PDF…', '', () => exportOutput('pdf')], ['Print report…', 'Ctrl+P', () => { setView('output'); setTimeout(() => print(), 50); }]],
      Edit: [['Undo', 'Ctrl+Z', () => restore(hist.undo())], ['Redo', 'Ctrl+Y', () => restore(hist.redo())], '-',
        { label: 'Cut', key: 'Ctrl+X', fn: () => clip('cut'), noShortcut: true }, { label: 'Copy', key: 'Ctrl+C', fn: () => clip('copy'), noShortcut: true }, { label: 'Paste', key: 'Ctrl+V', fn: () => clip('paste'), noShortcut: true }, { label: 'Clear / delete', key: 'Delete', fn: del, noShortcut: true }, '-',
        ['Insert variable', '', needData(() => insertVar(Math.min(grid.sel.c, app.doc.vars.length)))], ['Insert case', '', needData(() => insertCase(Math.min(grid.sel.r, app.doc.n)))],
        ['Delete selected variables', '', needData(() => { const s = grid.norm(); deleteVars(range(s.c0, Math.min(s.c1, app.doc.vars.length - 1))); })], ['Delete selected cases', '', needData(() => { const s = grid.norm(); deleteCases(s.r0, Math.min(s.r1, app.doc.n - 1)); })], '-',
        ['Go to case…', 'Ctrl+G', needData(async () => { const v = await Aero.prompt('Go to case', 'Case number', String(grid.sel.r + 1)); const r = parseInt(v, 10); if (r >= 1) { setView('data'); grid.select(Math.min(r, app.doc.n) - 1, grid.sel.c); } })],
        ['Go to variable…', '', needData(async () => { const v = await Aero.prompt('Go to variable', 'Variable name', ''); if (v == null) return; const j = app.doc.vars.findIndex(x => x.name.toLowerCase() === v.trim().toLowerCase() || (x.label || '').toLowerCase().includes(v.trim().toLowerCase())); if (j < 0) return Aero.toast('No such variable.'); setView('data'); grid.select(grid.sel.r, j); })]],
      View: [{ label: 'Data View', key: 'Ctrl+1', fn: () => setView('data'), checked: () => app.view === 'data' }, { label: 'Variable View', key: 'Ctrl+2', fn: () => setView('vars'), checked: () => app.view === 'vars' }, { label: 'Output', key: 'Ctrl+3', fn: () => setView('output'), checked: () => app.view === 'output' }, '-',
        { label: 'Value labels', key: 'Ctrl+L', fn: () => { app.labels = !app.labels; refresh(); }, checked: () => app.labels }, '-',
        ['Zoom output in', 'Ctrl+=', () => setZoom(app.zoom * 1.15)], ['Zoom output out', 'Ctrl+-', () => setZoom(app.zoom / 1.15)], ['Actual size', 'Ctrl+0', () => setZoom(1)], ['Fit width', '', () => { const w = $('reportScroll').clientWidth - 40; setZoom(Math.min(2, w / 1060)); }]],
      Data: [['Define variable properties', '', () => setView('vars')], ['Value labels…', '', needData(() => DL.valueLabels(app, app.selVar))], ['Missing values…', '', needData(() => DL.missingValues(app, app.selVar))], '-',
        ['Sort cases…', '', needData(() => DL.sortCases(app))], ['Select cases…', '', needData(() => DL.selectCases(app))], { label: 'Use all cases (filter off)', fn: () => setFilter(null), disabled: () => !app.doc.filter }],
      Transform: [['Compute variable…', '', needData(() => DL.compute(app))], ['Recode into same variables…', '', needData(() => DL.recode(app, 'same'))], ['Recode into different variable…', '', needData(() => DL.recode(app, 'different'))], ['Automatic recode (text → categorical)', '', needData(autoRecode)], '-',
        ['Standardize (save z-scores)…', '', needData(() => DL.P.descriptives(app))]],
      Analyze: ['#Descriptive statistics', ['Descriptives…', '', go('descriptives')], ['Frequencies…', '', go('frequencies')], ['Crosstabs…', '', go('crosstabs')], ['Normality tests…', '', go('normality')], '#Compare means', ...MEANS.filter(x => x !== '-' && x !== '#Non-parametric').slice(0, 5), '#Correlate & regression', ...REG.filter(x => x !== '-'), '#Non-parametric tests', ...MEANS.slice(-3)],
      Graphs: GRAPHS,
      Output: [['Show output', 'Ctrl+3', () => setView('output')], '-', ['Export report as HTML…', '', () => exportOutput('html')], ['Export report as PDF…', '', () => exportOutput('pdf')], ['Print…', '', () => { setView('output'); setTimeout(() => print(), 50); }], '-',
        { label: 'Delete selected output', fn: () => deleteOutput(), disabled: () => !app.outSel }, { label: 'Clear all output', fn: () => commit('Clear output', d => { d.output = []; }), disabled: () => !app.doc.output.length }],
      Help: [['Keyboard shortcuts', 'F1', helpShortcuts], ['Expression reference', '', helpFunctions], ['Methods and accuracy', '', helpMethods], '-', ['About Lumen Stats', '', () => Aero.alert('About Lumen Stats', 'Lumen Stats 1.2 — free statistics for everyone, in the spirit of SPSS and Minitab.\n\nData and Variable views, compute/recode/filter, descriptive statistics, crosstabs, t-tests, ANOVA with Tukey, correlation, linear and logistic regression, non-parametric and normality tests, charts and control charts — collected in an exportable report.\n\nEverything runs locally; your data never leaves this computer.\nSpreadsheet import/export: SheetJS CE (Apache-2.0). PDF: pdf-lib (MIT).')]],
    } });
  Aero.shortcut('Delete', () => { if (app.view === 'output') deleteOutput(); });

  // ---------- wiring ----------
  document.querySelectorAll('#tabs .aero-tab').forEach(t => t.onclick = () => setView(t.dataset.v));
  $('bOpen').onclick = openDialog; $('bSave').onclick = () => save(false);
  $('bCompute').onclick = needData(() => DL.compute(app)); $('bRecode').onclick = needData(() => under('bRecode', [['Into same variables…', '', () => DL.recode(app, 'same')], ['Into different variable…', '', () => DL.recode(app, 'different')], ['Automatic recode (text → categorical)', '', autoRecode]]));
  $('bSelect').onclick = needData(() => DL.selectCases(app));
  $('bDesc').onclick = go('descriptives'); $('bFreq').onclick = go('frequencies'); $('bXtab').onclick = go('crosstabs');
  $('bMeans').onclick = () => under('bMeans', MEANS); $('bReg').onclick = () => under('bReg', REG); $('bChart').onclick = () => under('bChart', GRAPHS);
  addEventListener('keydown', e => { if (e.key === 'F1') { e.preventDefault(); helpShortcuts(); } });

  // test hooks
  Object.assign(app, { grid, hist, commit, restore, load, setView, refresh, openFiles, save, exportData, exportOutput, openSample, insertVar, insertCase, deleteVars, deleteCases, clearRange, commitCells, pasteBlock, renderOutput, autoRecode, snap });

  // ---------- start ----------
  let start = null;
  try { const s = localStorage.getItem(AUTOSAVE); if (s) { const j = JSON.parse(s); start = { doc: D.deserialize(j), name: j.docName || j.name || 'Untitled' }; } } catch (e) { start = null; }
  if (start && (start.doc.vars.length || start.doc.output.length)) { load(start.doc, start.name); Aero.setDirty(true); setView(start.doc.output.length && !start.doc.n ? 'output' : 'data'); Aero.toast('Restored your last session.'); }
  else { load(emptyDoc(), 'Untitled'); showWelcome(); setView('data'); }
})();
