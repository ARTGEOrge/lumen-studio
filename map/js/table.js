// Lumen Map — attribute table of the active layer: virtual scrolling, sort, selection sync, expression filter,
// inline editing, and shortcuts to selection / field calculator / field management.
(function () {
  'use strict';
  const A = MapApp, X = MapExpr, C = MapClass, $ = id => document.getElementById(id), esc = s => Aero.esc(String(s ?? ''));
  const RH = 22, HH = 24;
  const T = window.MapTable = { visible: true, sort: null, desc: false, onlySel: false, filter: '', rows: [], cols: [], layerId: null, anchor: null };

  T.show = on => { T.visible = on == null ? !T.visible : on; $('main').classList.toggle('notable', !T.visible); setTimeout(() => { A.renderNow && A.renderNow(); T.refresh(); }, 0); };
  function computeRows(L) {
    let feats = L.features;
    if (T.onlySel) { const s = A.selected(L.id); feats = feats.filter(f => s.has(f.id)); }
    if (T.filter.trim()) { const ex = X.compile(T.filter, L.fields); if (ex.ok) feats = feats.filter(ex.test); }
    if (T.sort) {
      const k = T.sort, d = T.desc ? -1 : 1;
      feats = feats.slice().sort((a, b) => { const x = k === '#' ? a.id : a.properties[k], y = k === '#' ? b.id : b.properties[k]; if (x == null) return y == null ? 0 : 1; if (y == null) return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * d; });
    }
    return feats;
  }
  T.refresh = () => {
    const pane = $('tablePane'); if (!pane) return;
    const L = A.activeLayer();
    renderBar(L);
    const wrap = $('twrap');
    if (!L) { wrap.innerHTML = '<div class="tempty">No active layer.</div>'; return; }
    if (T.layerId !== L.id) { T.layerId = L.id; T.sort = null; T.filter = ''; const f = $('tFilter'); if (f) f.value = ''; wrap.scrollTop = 0; }
    T.rows = computeRows(L);
    T.cols = [{ k: '#', w: 54, num: true }, ...L.fields.map(f => ({ k: f.name, w: f.type === 'number' ? 96 : f.type === 'boolean' ? 64 : 150, num: f.type === 'number', type: f.type }))];
    let inner = wrap.querySelector('.tinner');
    if (!inner) { wrap.innerHTML = '<div class="tinner" style="position:relative"><div class="trow head"></div><div class="tbody" style="position:absolute;left:0;right:0"></div></div>'; inner = wrap.querySelector('.tinner'); wrap.onscroll = () => drawRows(); }
    inner.style.setProperty('--tcols', T.cols.map(c => c.w + 'px').join(' ') + ' 1fr');
    inner.style.height = (HH + T.rows.length * RH) + 'px'; inner.style.width = 'max-content'; inner.style.minWidth = '100%';
    inner.querySelector('.head').innerHTML = T.cols.map(c => `<div class="${c.num ? 'num' : ''}" data-k="${esc(c.k)}" title="${esc(c.k)}${c.type ? ' (' + c.type + ')' : ''} — click to sort">${esc(c.k)}${T.sort === c.k ? (T.desc ? ' ▼' : ' ▲') : ''}</div>`).join('') + '<div></div>';
    drawRows();
  };
  function drawRows() {
    const wrap = $('twrap'), body = wrap.querySelector('.tbody'), L = A.activeLayer(); if (!body || !L) return;
    const first = Math.max(0, Math.floor(wrap.scrollTop / RH) - 2), n = Math.ceil(wrap.clientHeight / RH) + 5, sel = A.selected(L.id);
    body.style.top = (HH + first * RH) + 'px';
    let h = '';
    for (let i = first; i < Math.min(T.rows.length, first + n); i++) {
      const f = T.rows[i];
      h += `<div class="trow${sel.has(f.id) ? ' sel' : ''}" data-i="${i}" data-id="${f.id}">` + T.cols.map(c => {
        if (c.k === '#') return `<div class="fid">${f.id}</div>`;
        const v = f.properties[c.k];
        return v == null ? '<div class="null">NULL</div>' : `<div class="${c.num ? 'num' : ''}" data-k="${esc(c.k)}">${esc(typeof v === 'number' ? (Number.isInteger(v) ? v : +v.toFixed(6)) : v)}</div>`;
      }).join('') + '<div></div></div>';
    }
    body.innerHTML = h;
    if (!T.rows.length) body.innerHTML = `<div class="tempty">${L.features.length ? 'No rows match the current filter.' : 'This layer has no features yet.'}</div>`;
  }
  function renderBar(L) {
    const bar = $('tbar');
    if (!bar.dataset.built) {
      bar.dataset.built = '1';
      bar.innerHTML = `<span class="ttl" id="tTitle"></span>
        <select id="tShow" title="Rows to show"><option value="all">All features</option><option value="sel">Selected features</option></select>
        <input type="search" id="tFilter" placeholder="Filter rows: expression, e.g. &quot;pop&quot; > 1000" title="Filter the table with an expression (does not change the layer)">
        <button class="aero-btn" id="tSelAttr" title="Select by expression">ƒ Select</button>
        <button class="aero-btn" id="tSelFiltered" title="Select the rows shown">Select shown</button>
        <button class="aero-btn" id="tInvert" title="Invert selection">⇄ Invert</button>
        <button class="aero-btn" id="tZoom" title="Zoom to selected">⌖ Zoom</button>
        <button class="aero-btn" id="tCalc" title="Field calculator">∑ Calc</button>
        <button class="aero-btn" id="tAddF" title="Add field">＋ Field</button>
        <button class="aero-btn" id="tDelF" title="Delete field">− Field</button>
        <button class="aero-btn" id="tStats" title="Statistics for a field">Stats</button>
        <button class="aero-btn" id="tDel" title="Delete selected features">✕ Delete</button>`;
      $('tShow').onchange = () => { T.onlySel = $('tShow').value === 'sel'; $('twrap').scrollTop = 0; T.refresh(); };
      let ft; $('tFilter').oninput = () => { clearTimeout(ft); ft = setTimeout(() => { const L2 = A.activeLayer(), v = $('tFilter').value; const ok = !v.trim() || (L2 && X.compile(v, L2.fields).ok); $('tFilter').classList.toggle('bad', !ok); $('tFilter').title = ok ? 'Filter the table with an expression (does not change the layer)' : X.compile(v, L2 ? L2.fields : []).error; if (ok) { T.filter = v; $('twrap').scrollTop = 0; T.refresh(); } }, 200); };
      $('tFilter').addEventListener('keydown', e => e.stopPropagation());
      $('tSelAttr').onclick = () => MapDialogs.selectByAttributes();
      $('tSelFiltered').onclick = () => { const L2 = A.activeLayer(); if (L2) A.setSelection(L2.id, T.rows.map(f => f.id)); };
      $('tInvert').onclick = () => A.invertSelection();
      $('tZoom').onclick = () => A.zoomToSelection();
      $('tCalc').onclick = () => MapDialogs.fieldCalculator();
      $('tAddF').onclick = () => MapDialogs.addField();
      $('tDelF').onclick = () => MapDialogs.deleteField();
      $('tStats').onclick = () => MapDialogs.statistics();
      $('tDel').onclick = () => A.deleteSelected();
      const wrap = $('twrap');
      wrap.addEventListener('click', e => {
        const hd = e.target.closest('.head [data-k]');
        if (hd) { const k = hd.dataset.k; if (T.sort === k) { if (T.desc) { T.sort = null; T.desc = false; } else T.desc = true; } else { T.sort = k; T.desc = false; } T.refresh(); return; }
        const row = e.target.closest('.trow[data-id]'); if (!row || e.target.closest('input')) return;
        const L2 = A.activeLayer(), id = +row.dataset.id, i = +row.dataset.i;
        if (e.shiftKey && T.anchor != null) { const a = Math.min(T.anchor, i), b = Math.max(T.anchor, i); A.setSelection(L2.id, T.rows.slice(a, b + 1).map(f => f.id), e.ctrlKey ? 'add' : 'new'); return; }
        T.anchor = i; A.setSelection(L2.id, [id], e.ctrlKey ? 'toggle' : 'new');
      });
      wrap.addEventListener('dblclick', e => {
        const row = e.target.closest('.trow[data-id]'), cell = e.target.closest('.trow[data-id] > div'); if (!row || !cell) return;
        const idx = [...row.children].indexOf(cell), col = T.cols[idx]; if (!col || col.k === '#') { const L2 = A.activeLayer(), f = L2.features.find(x => x.id === +row.dataset.id); if (f && f.geometry) { A.setSelection(L2.id, [f.id]); A.zoomToSelection(); } return; }
        editCell(row, cell, col);
      });
    }
    $('tTitle').textContent = L ? `${L.name} — ${L.features.length.toLocaleString('en-US')} features, ${A.selected(L.id).size} selected${T.filter ? `, ${T.rows.length} shown` : ''}` : 'Attribute table';
    bar.querySelectorAll('button,select,input').forEach(b => b.disabled = !L);
  }
  function editCell(row, cell, col) {
    const L = A.activeLayer(), id = +row.dataset.id, f = L.features.find(x => x.id === id); if (!f) return;
    const inp = document.createElement('input'); inp.className = 'cell'; const v = f.properties[col.k]; inp.value = v == null ? '' : v;
    if (col.type === 'number') inp.type = 'number';
    cell.innerHTML = ''; cell.appendChild(inp); inp.focus(); inp.select();
    let done = false;
    const finish = ok => {
      if (done) return; done = true; if (!ok) return T.refresh();
      let nv = inp.value;
      if (col.type === 'number') nv = nv.trim() === '' ? null : +nv; else if (col.type === 'boolean') nv = /^(true|1|yes|y|t)$/i.test(nv.trim()) ? true : /^(false|0|no|n|f)$/i.test(nv.trim()) ? false : null; else if (nv === '') nv = null;
      if (nv === v || (typeof nv === 'number' && !isFinite(nv))) return T.refresh();
      A.change('Edit attribute', () => { const nl = A.mutLayer(L.id); nl.features = nl.features.map(x => x.id === id ? { ...x, properties: { ...x.properties, [col.k]: nv } } : x); });
    };
    inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false); };
    inp.onblur = () => finish(true);
  }
  A.invertSelection = () => { const L = A.activeLayer(); if (!L) return; const s = A.selected(L.id); A.setSelection(L.id, L.features.filter(f => !s.has(f.id)).map(f => f.id)); };
  A.selectAll = () => { const L = A.activeLayer(); if (L) A.setSelection(L.id, L.features.map(f => f.id)); };
  void C;
})();
