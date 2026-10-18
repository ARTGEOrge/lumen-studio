// Lumen Map — dialogs: layer properties (symbology, labels, filter), selection by attributes / location,
// field calculator & field management, statistics, new layer, CRS, and the geoprocessing tools.
(function () {
  'use strict';
  const A = MapApp, P = MapProj, G = MapGeo, O = MapOps, C = MapClass, X = MapExpr, IO = MapIO;
  const esc = s => Aero.esc(String(s ?? '')), $ = id => document.getElementById(id);
  const opt = (v, t, cur) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(t)}</option>`;
  const layerOpts = (cur, filter) => A.doc.layers.filter(filter || (() => true)).map(L => opt(L.id, `${L.name} (${L.geomType === 'LineString' ? 'lines' : L.geomType === 'Point' ? 'points' : L.geomType === 'Polygon' ? 'polygons' : 'mixed'})`, cur)).join('');
  const D = window.MapDialogs = {};
  const needLayer = () => { const L = A.activeLayer(); if (!L) Aero.toast('Add or select a layer first'); return L; };

  // ---------- expression builder (shared) ----------
  function exprBuilder(box, L, initial, onChange) {
    box.innerHTML = `<textarea class="expr" spellcheck="false">${esc(initial || '')}</textarea>
      <div class="exprBox"><div><div class="dim" style="font-size:11px">Fields — double-click to insert</div><div class="aero-list eb-fields"></div></div>
      <div><div class="dim" style="font-size:11px">Values of the field — double-click to insert</div><div class="aero-list eb-vals"></div></div></div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">${['=', '!=', '<', '>', '<=', '>=', 'AND', 'OR', 'NOT', 'LIKE', 'IN ()', 'IS NULL', '+', '-', '*', '/', '||', '( )'].map(o => `<button class="aero-btn small eb-op">${esc(o)}</button>`).join('')}</div>
      <div class="exprMsg eb-msg"></div>`;
    const ta = box.querySelector('textarea'), fl = box.querySelector('.eb-fields'), vl = box.querySelector('.eb-vals'), msg = box.querySelector('.eb-msg');
    const insert = t => { const s = ta.selectionStart, e = ta.selectionEnd; ta.value = ta.value.slice(0, s) + t + ta.value.slice(e); ta.focus(); ta.selectionStart = ta.selectionEnd = s + t.length; check(); };
    const extra = ['$area', '$length', '$perimeter', '$x', '$y', '$id'];
    fl.innerHTML = L.fields.map(f => `<div class="aero-item" data-f="${esc(f.name)}"><span class="grow">${esc(f.name)}</span><span class="dim">${f.type}</span></div>`).join('') + extra.map(v => `<div class="aero-item" data-v="${v}"><span class="grow">${v}</span><span class="dim">geom</span></div>`).join('');
    fl.addEventListener('click', e => {
      const it = e.target.closest('[data-f]'); fl.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); if (!it) return; it.classList.add('sel');
      const k = it.dataset.f, vals = [...new Set(L.features.map(f => f.properties[k]).filter(v => v != null))].sort((a, b) => typeof a === 'number' ? a - b : String(a).localeCompare(String(b))).slice(0, 300);
      vl.innerHTML = vals.map(v => `<div class="aero-item" data-val="${esc(X.quoteValue(v))}">${esc(v)}</div>`).join('') || '<div class="dim" style="padding:4px">(no values)</div>';
    });
    fl.addEventListener('dblclick', e => { const it = e.target.closest('[data-f],[data-v]'); if (it) insert(it.dataset.f != null ? X.quoteField(it.dataset.f) + ' ' : it.dataset.v + ' '); });
    vl.addEventListener('dblclick', e => { const it = e.target.closest('[data-val]'); if (it) insert(it.dataset.val + ' '); });
    box.querySelectorAll('.eb-op').forEach(b => b.onclick = () => insert(b.textContent === '( )' ? '()' : b.textContent === 'IN ()' ? 'IN ()' : ` ${b.textContent} `));
    ta.addEventListener('keydown', e => e.stopPropagation());
    function check() {
      const v = ta.value.trim(); if (!v) { msg.textContent = ''; msg.className = 'exprMsg eb-msg'; onChange && onChange(null); return; }
      const ex = X.compile(v, L.fields);
      if (!ex.ok) { msg.textContent = '✕ ' + ex.error; msg.className = 'exprMsg eb-msg bad'; onChange && onChange(null); return; }
      onChange && onChange(ex, msg);
    }
    ta.addEventListener('input', check); setTimeout(check);
    return { get: () => ta.value.trim(), ta };
  }
  D.exprBuilder = exprBuilder;

  // ---------- layer properties ----------
  D.layerProperties = (id, tab = 'sym') => {
    const L0 = A.layer(id); if (!L0) return;
    let st = JSON.parse(JSON.stringify(L0.style)), lb = { ...L0.labels }, name = L0.name, filter = L0.filter || '';
    const numFields = L0.fields.filter(f => f.type === 'number'), gt = L0.geomType;
    const d = Aero.dialog({ title: `Layer properties — ${L0.name}`, width: 720, ok: 'OK', html: `<div class="dlg-tabs"><span class="aero-tab" data-t="sym">Symbology</span><span class="aero-tab" data-t="lab">Labels</span><span class="aero-tab" data-t="src">Source &amp; filter</span></div><div id="lpBody" style="min-height:360px"></div>`,
      onOK: () => { A.putLayer(L0); if (!applyFilterOk()) return; A.change('Layer properties', () => A.putLayer({ ...A.layer(id), style: st, labels: lb, name: name.trim() || L0.name, filter })); },
      onCancel: () => { A.putLayer(L0); A.renderAll(); } });
    const body = d.el.querySelector('#lpBody'), tabs = d.el.querySelectorAll('.dlg-tabs .aero-tab');
    const preview = () => { A.putLayer({ ...L0, style: st, labels: lb, filter: X.compile(filter, L0.fields).ok || !filter.trim() ? filter : L0.filter }); A.render(); A.refreshPanels(); };
    const applyFilterOk = () => { if (filter.trim() && !X.compile(filter, L0.fields).ok) { Aero.toast('The filter expression has an error — it was not applied'); filter = L0.filter; } return true; };
    tabs.forEach(t => t.onclick = () => show(t.dataset.t));
    function show(t) { tabs.forEach(x => x.classList.toggle('on', x.dataset.t === t)); ({ sym: symTab, lab: labTab, src: srcTab })[t](); }
    function common() {
      const showFill = (st.mode || 'single') === 'single' || st.gradBy === 'size';
      return `<label>${showFill ? 'Fill colour' : 'Outline colour'}</label><div class="inl">${showFill ? `<input type="color" id="pFill" value="${esc(st.fill)}">` : ''}${gt !== 'LineString' ? `${showFill ? '<span>Outline</span>' : ''}<input type="color" id="pStroke" value="${esc(st.stroke)}">` : showFill ? '' : '<span class="dim">colours come from the classes below</span>'}</div>
        <label>${gt === 'LineString' ? 'Line width' : 'Outline width'}</label><div class="inl"><input type="number" id="pWidth" min="0" max="30" step="0.1" value="${st.width}"><span>Dash</span><select id="pDash">${['solid', 'dash', 'dot', 'dashdot'].map(x => opt(x, x, st.dash || 'solid')).join('')}</select></div>
        ${gt === 'Polygon' || gt === 'Mixed' ? `<label>Fill opacity</label><div class="inl"><input type="range" id="pFillOp" min="0" max="100" value="${Math.round((st.fillOpacity ?? 0.6) * 100)}" style="width:180px"><span id="pFillOpV">${Math.round((st.fillOpacity ?? 0.6) * 100)}%</span></div>` : ''}
        ${gt === 'Point' || gt === 'Mixed' ? `<label>Marker</label><div class="inl"><select id="pShape">${['circle', 'square', 'triangle', 'diamond', 'star', 'cross'].map(x => opt(x, x, st.shape)).join('')}</select><span>Size</span><input type="number" id="pSize" min="1" max="80" step="0.5" value="${st.size}"></div>` : ''}`;
    }
    function wireCommon() {
      const on = (i, f) => { const e = body.querySelector('#' + i); if (e) e.oninput = () => { f(e); preview(); }; };
      on('pFill', e => st.fill = e.value); on('pStroke', e => st.stroke = e.value); on('pWidth', e => st.width = Math.max(0, +e.value || 0)); on('pDash', e => st.dash = e.value);
      on('pFillOp', e => { st.fillOpacity = +e.value / 100; body.querySelector('#pFillOpV').textContent = e.value + '%'; }); on('pShape', e => st.shape = e.value); on('pSize', e => st.size = Math.max(1, +e.value || 1));
    }
    function symTab() {
      const mode = st.mode || 'single';
      body.innerHTML = `<div class="dlg-grid"><label>Symbology</label><select id="pMode">${opt('single', 'Single symbol', mode)}${opt('categorized', 'Categorized (unique values)', mode)}${opt('graduated', 'Graduated (classes of a number)', mode)}</select>${common()}</div><div id="pModeBody"></div>`;
      wireCommon();
      body.querySelector('#pMode').onchange = e => { st.mode = e.target.value; if (st.mode !== 'single') st.gradBy = st.gradBy || 'color'; if (st.mode === 'categorized' && !st.categories?.length) { st.field = st.field && L0.fields.some(f => f.name === st.field) ? st.field : (L0.fields.find(f => f.type === 'string') || L0.fields[0] || {}).name; classifyCat(); } if (st.mode === 'graduated' && !st.classes?.length) { st.field = numFields.some(f => f.name === st.field) ? st.field : (numFields[0] || {}).name; classifyGrad(); } preview(); symTab(); };
      const mb = body.querySelector('#pModeBody');
      if (mode === 'categorized') {
        mb.innerHTML = `<div class="dlg-grid"><label>Value field</label><div class="inl"><select id="pField">${L0.fields.map(f => opt(f.name, f.name, st.field)).join('')}</select><span>Palette</span><select id="pPal">${Object.keys(C.QUAL).map(k => opt(k, k, st.palette || 'Vivid')).join('')}</select><button class="aero-btn small" id="pClassify">Classify</button><button class="aero-btn small" id="pDelAll">Delete all</button></div>
          <label>Other values</label><div class="inl"><input type="checkbox" id="pOther" ${st.otherColor ? 'checked' : ''}><input type="color" id="pOtherC" value="${esc(st.otherColor || '#bbbbbb')}"><span class="dim">draw values without a category</span></div></div>
          <div class="clsWrap"><table class="clsTable"><tr><th style="width:24px"></th><th style="width:40px">Colour</th><th>Value</th><th>Legend label</th><th style="width:60px">Count</th></tr>${(st.categories || []).map((c, i) => `<tr><td><input type="checkbox" data-i="${i}" data-k="vis" ${c.visible === false ? '' : 'checked'}></td><td><input type="color" data-i="${i}" data-k="color" value="${esc(c.color)}"></td><td>${esc(c.value === '' ? '(empty)' : c.value)}</td><td><input type="text" data-i="${i}" data-k="label" value="${esc(c.label)}"></td><td class="dim">${L0.features.filter(f => String(f.properties[st.field] ?? '') === c.value).length}</td></tr>`).join('')}</table></div>`;
        mb.querySelector('#pField').onchange = e => { st.field = e.target.value; classifyCat(); preview(); symTab(); };
        mb.querySelector('#pPal').onchange = e => { st.palette = e.target.value; classifyCat(); preview(); symTab(); };
        mb.querySelector('#pClassify').onclick = () => { classifyCat(); preview(); symTab(); };
        mb.querySelector('#pDelAll').onclick = () => { st.categories = []; preview(); symTab(); };
        mb.querySelector('#pOther').onchange = e => { st.otherColor = e.target.checked ? mb.querySelector('#pOtherC').value : null; preview(); };
        mb.querySelector('#pOtherC').oninput = e => { if (mb.querySelector('#pOther').checked) { st.otherColor = e.target.value; preview(); } };
        wireClassTable(mb, 'categories');
      } else if (mode === 'graduated') {
        if (!numFields.length) { mb.innerHTML = '<div class="dnote">This layer has no numeric fields. Add one with the field calculator first.</div>'; return; }
        mb.innerHTML = `<div class="dlg-grid"><label>Value field</label><div class="inl"><select id="pField">${numFields.map(f => opt(f.name, f.name, st.field)).join('')}</select><span>Method</span><select id="pMethod">${Object.entries(C.METHODS).map(([k, v]) => opt(k, v, st.method || 'jenks')).join('')}</select></div>
          <label>Classes</label><div class="inl"><input type="number" id="pN" min="2" max="12" value="${st.nClasses || 5}"><span>Ramp</span><select id="pRamp">${Object.keys(C.RAMPS).map(k => opt(k, k, st.ramp || 'Blues')).join('')}</select><label style="color:inherit;white-space:nowrap"><input type="checkbox" id="pInv" ${st.invert ? 'checked' : ''}> invert</label><button class="aero-btn small" id="pClassify">Classify</button></div>
          ${gt !== 'Polygon' ? `<label>Vary</label><div class="inl"><select id="pBy">${opt('color', 'Colour', st.gradBy || 'color')}${opt('size', gt === 'Point' ? 'Symbol size (proportional)' : 'Line width', st.gradBy || 'color')}</select><span>Size</span><input type="number" id="pSmin" value="${st.sizeMin ?? 4}" min="1" max="80"><span>to</span><input type="number" id="pSmax" value="${st.sizeMax ?? 22}" min="1" max="120"></div>` : ''}</div>
          <div class="clsWrap"><table class="clsTable"><tr><th style="width:24px"></th><th style="width:40px">Colour</th><th style="width:90px">From</th><th style="width:90px">To</th><th>Legend label</th><th style="width:50px">Count</th></tr>${(st.classes || []).map((c, i) => `<tr><td><input type="checkbox" data-i="${i}" data-k="vis" ${c.visible === false ? '' : 'checked'}></td><td><input type="color" data-i="${i}" data-k="color" value="${esc(c.color)}"></td><td><input type="text" data-i="${i}" data-k="min" value="${+c.min.toPrecision(8)}"></td><td><input type="text" data-i="${i}" data-k="max" value="${+c.max.toPrecision(8)}"></td><td><input type="text" data-i="${i}" data-k="label" value="${esc(c.label)}"></td><td class="dim">${countIn(c, i)}</td></tr>`).join('')}</table></div>
          <div class="dnote">Edit From/To for manual breaks. ${histogram()}</div>`;
        const re = () => { classifyGrad(); preview(); symTab(); };
        mb.querySelector('#pField').onchange = e => { st.field = e.target.value; re(); };
        mb.querySelector('#pMethod').onchange = e => { st.method = e.target.value; re(); };
        mb.querySelector('#pN').onchange = e => { st.nClasses = Aero.clamp(+e.target.value || 5, 2, 12); re(); };
        mb.querySelector('#pRamp').onchange = e => { st.ramp = e.target.value; re(); };
        mb.querySelector('#pInv').onchange = e => { st.invert = e.target.checked; re(); };
        mb.querySelector('#pClassify').onclick = re;
        const by = mb.querySelector('#pBy'); if (by) { by.onchange = e => { st.gradBy = e.target.value; preview(); symTab(); }; mb.querySelector('#pSmin').oninput = e => { st.sizeMin = +e.target.value; preview(); }; mb.querySelector('#pSmax').oninput = e => { st.sizeMax = +e.target.value; preview(); }; }
        wireClassTable(mb, 'classes');
      }
    }
    function countIn(c, i) { const cls = st.classes; return L0.features.filter(f => C.classOf(cls, f.properties[st.field]) === i).length; }
    function histogram() {
      const v = L0.features.map(f => f.properties[st.field]).filter(x => typeof x === 'number' && isFinite(x)); if (!v.length) return '';
      const mean = v.reduce((s, x) => s + x, 0) / v.length; return `Field “${esc(st.field)}”: ${v.length} values, min ${C.fmt(Math.min(...v))}, mean ${C.fmt(mean)}, max ${C.fmt(Math.max(...v))}.`;
    }
    function wireClassTable(mb, key) {
      mb.querySelectorAll('.clsTable [data-k]').forEach(inp => {
        const ev = inp.type === 'checkbox' ? 'change' : 'input';
        inp.addEventListener(ev, () => {
          const c = st[key][+inp.dataset.i], k = inp.dataset.k;
          if (k === 'vis') c.visible = inp.checked; else if (k === 'color') c.color = inp.value; else if (k === 'label') c.label = inp.value;
          else if (k === 'min' || k === 'max') { const v = parseFloat(inp.value); if (isFinite(v)) c[k] = v; }
          preview();
        });
        inp.addEventListener('keydown', e => e.stopPropagation());
      });
    }
    function classifyCat() {
      const vals = [...new Set(L0.features.map(f => String(f.properties[st.field] ?? '')))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, 500);
      const cols = C.qualColors(st.palette || 'Vivid', vals.length);
      st.categories = vals.map((v, i) => ({ value: v, color: cols[i], label: v === '' ? '(empty)' : v, visible: true }));
    }
    function classifyGrad() {
      const v = L0.features.map(f => f.properties[st.field]);
      st.classes = C.makeClasses(C.breaks(v, st.nClasses || 5, st.method || 'jenks'), st.ramp || 'Blues', st.invert);
    }
    function labTab() {
      body.innerHTML = `<div class="dlg-grid"><label>Show labels</label><div class="inl"><input type="checkbox" id="lOn" ${lb.on ? 'checked' : ''}><span class="dim">Labels avoid each other; points label to the right, lines along the line, polygons inside.</span></div>
        <label>Text</label><div class="inl"><input type="number" id="lSize" min="5" max="48" step="0.5" value="${lb.size}"><span>pt</span><input type="color" id="lColor" value="${esc(lb.color)}"><label style="color:inherit"><input type="checkbox" id="lBold" ${lb.bold ? 'checked' : ''}> bold</label><label style="color:inherit"><input type="checkbox" id="lItal" ${lb.italic ? 'checked' : ''}> italic</label><label style="color:inherit"><input type="checkbox" id="lHalo" ${lb.halo !== false ? 'checked' : ''}> halo</label></div>
        <label class="wide">Label expression — a field like <span class="mono">"name"</span>, or e.g. <span class="mono">"name" || ' (' || round("pop"/1000) || 'k)'</span></label></div><div id="lExpr"></div>`;
      const g = i => body.querySelector('#' + i);
      g('lOn').onchange = () => { lb.on = g('lOn').checked; preview(); }; g('lSize').oninput = () => { lb.size = +g('lSize').value || 11; preview(); };
      g('lColor').oninput = () => { lb.color = g('lColor').value; preview(); }; g('lBold').onchange = () => { lb.bold = g('lBold').checked; preview(); };
      g('lItal').onchange = () => { lb.italic = g('lItal').checked; preview(); }; g('lHalo').onchange = () => { lb.halo = g('lHalo').checked; preview(); };
      exprBuilder(g('lExpr'), L0, lb.expr, (ex, msg) => { if (ex) { lb.expr = body.querySelector('#lExpr textarea').value.trim(); const f = L0.features[0]; msg.textContent = f ? '✓ Example: ' + String(ex.eval(f) ?? 'NULL').slice(0, 80) : '✓ Valid'; preview(); } });
    }
    function srcTab() {
      const b = L0.features.reduce((acc, f) => { if (!f.geometry) return acc; const x = G.bbox(f.geometry); return [Math.min(acc[0], x[0]), Math.min(acc[1], x[1]), Math.max(acc[2], x[2]), Math.max(acc[3], x[3])]; }, [Infinity, Infinity, -Infinity, -Infinity]);
      body.innerHTML = `<div class="dlg-grid"><label>Layer name</label><input type="text" id="sName" value="${esc(name)}">
        <label>Geometry</label><div>${esc(gt)} · ${L0.features.length.toLocaleString('en-US')} features · ${L0.fields.length} fields</div>
        <label>Source CRS</label><div>${esc(typeof L0.sourceCrs === 'string' ? P.label(L0.sourceCrs) : 'custom')} <span class="dim">(stored internally as WGS 84 longitude/latitude, drawn in the map CRS)</span></div>
        <label>Extent (lon/lat)</label><div class="mono" style="font-size:11px">${isFinite(b[0]) ? `${b[0].toFixed(5)}, ${b[1].toFixed(5)} → ${b[2].toFixed(5)}, ${b[3].toFixed(5)}` : '—'}</div>
        <label class="wide">Feature filter (definition query) — only matching features are drawn, selectable and exported. Leave empty to show all.</label></div><div id="sExpr"></div>`;
      body.querySelector('#sName').oninput = e => name = e.target.value; body.querySelector('#sName').addEventListener('keydown', e => e.stopPropagation());
      exprBuilder(body.querySelector('#sExpr'), L0, filter, (ex, msg) => { filter = body.querySelector('#sExpr textarea').value.trim(); if (ex) { msg.textContent = `✓ ${L0.features.filter(ex.test).length} of ${L0.features.length} features match`; preview(); } else if (!filter) preview(); });
    }
    show(tab);
  };

  // ---------- selection ----------
  D.selectByAttributes = () => {
    const L = needLayer(); if (!L) return;
    let ex = null;
    const d = Aero.dialog({ title: 'Select by attributes', width: 640, html: `<div class="dlg-grid"><label>Layer</label><select id="saL">${layerOpts(L.id)}</select><label>Method</label><select id="saM">${opt('new', 'Create a new selection')}${opt('add', 'Add to current selection')}${opt('remove', 'Remove from current selection')}${opt('subset', 'Select from current selection')}</select></div><div id="saE"></div>`, ok: 'Select',
      onOK: () => { const L2 = A.layer(d.el.querySelector('#saL').value); const e = X.compile(builder.get(), L2.fields); if (!e.ok) { Aero.toast(e.error); return; } const ids = L2.features.filter(e.test).map(f => f.id); A.active = L2.id; A.setSelection(L2.id, ids, d.el.querySelector('#saM').value); Aero.toast(`${A.selected(L2.id).size} features selected`); } });
    let builder; const mk = L2 => { builder = exprBuilder(d.el.querySelector('#saE'), L2, builder ? builder.get() : '', (e, msg) => { ex = e; if (e) msg.textContent = `✓ ${L2.features.filter(e.test).length} features match`; }); };
    mk(L); d.el.querySelector('#saL').onchange = e => mk(A.layer(e.target.value));
    void ex;
  };
  D.selectByLocation = () => {
    const L = needLayer(); if (!L) return;
    Aero.dialog({ title: 'Select by location', width: 560, instruction: 'Select features of one layer by their spatial relationship to another layer.',
      fields: [{ key: 't', label: 'Select features from', type: 'select', value: L.id, options: A.doc.layers.map(l => [l.id, l.name]) },
        { key: 'r', label: 'that', type: 'select', value: 'intersects', options: [['intersects', 'intersect'], ['within', 'are completely within'], ['contains', 'completely contain'], ['distance', 'are within a distance of'], ['disjoint', 'do not intersect']] },
        { key: 's', label: 'features of', type: 'select', value: (A.doc.layers.find(l => l.id !== L.id) || L).id, options: A.doc.layers.map(l => [l.id, l.name]) },
        { key: 'so', label: 'Use selected source features only', type: 'checkbox', value: false },
        { key: 'd', label: 'Distance (metres)', type: 'number', value: 1000, min: 0 },
        { key: 'm', label: 'Method', type: 'select', value: 'new', options: [['new', 'Create a new selection'], ['add', 'Add to current selection'], ['remove', 'Remove from current selection'], ['subset', 'Select from current selection']] }],
      onOK: v => run(() => {
        const T = A.layer(v.t), S = A.layer(v.s); if (!T || !S) return;
        const ss = A.selected(S.id), src = S.features.filter(f => f.geometry && (!v.so || ss.has(f.id)));
        if (v.so && !src.length) { Aero.toast('The source layer has no selected features'); return; }
        const pad = v.r === 'distance' ? (v.d || 0) / 111000 * 1.6 + 1e-9 : 0;
        const sb = src.map(f => { const b = G.bbox(f.geometry); return [b[0] - pad / Math.max(0.05, Math.cos(b[1] * Math.PI / 180)), b[1] - pad, b[2] + pad / Math.max(0.05, Math.cos(b[3] * Math.PI / 180)), b[3] + pad]; });
        const ids = T.features.filter(f => {
          if (!f.geometry) return false; const fb = G.bbox(f.geometry);
          const test = (s, i) => {
            if (v.r !== 'disjoint' && !G.bboxHit(fb, sb[i])) return false;
            switch (v.r) { case 'intersects': case 'disjoint': return O.intersects(f.geometry, s.geometry); case 'within': return O.within(f.geometry, s.geometry); case 'contains': return O.within(s.geometry, f.geometry); case 'distance': return O.geoDistance(f.geometry, s.geometry) <= v.d; }
          };
          const hit = src.some(test); return v.r === 'disjoint' ? !hit : hit;
        }).map(f => f.id);
        A.active = T.id; A.setSelection(T.id, ids, v.m); Aero.toast(`${A.selected(T.id).size} features selected in ${T.name}`);
      }, 'Selecting…') });
  };

  // ---------- fields ----------
  const validName = (n, L, allowExisting) => { n = String(n || '').trim(); if (!n) return 'Enter a field name'; if (n.length > 60) return 'Name is too long'; if (!allowExisting && L.fields.some(f => f.name === n)) return 'A field with that name exists'; return null; };
  D.addField = () => {
    const L = needLayer(); if (!L) return;
    Aero.dialog({ title: 'Add field', fields: [{ key: 'n', label: 'Name', type: 'text', value: 'new_field' }, { key: 't', label: 'Type', type: 'select', value: 'string', options: [['string', 'Text'], ['number', 'Number'], ['boolean', 'True/false'], ['date', 'Date (text)']] }],
      onOK: v => { const e = validName(v.n, L); if (e) { Aero.toast(e); return; } A.change('Add field', () => { const nl = A.mutLayer(L.id); nl.fields.push({ name: v.n.trim(), type: v.t }); nl.features = nl.features.map(f => ({ ...f, properties: { ...f.properties, [v.n.trim()]: null } })); }); } });
  };
  D.deleteField = () => {
    const L = needLayer(); if (!L || !L.fields.length) return Aero.toast('This layer has no fields');
    Aero.dialog({ title: 'Delete field', fields: [{ key: 'n', label: 'Field', type: 'select', value: L.fields[0].name, options: L.fields.map(f => f.name) }], ok: 'Delete',
      onOK: v => A.change('Delete field', () => { const nl = A.mutLayer(L.id); nl.fields = nl.fields.filter(f => f.name !== v.n); nl.features = nl.features.map(f => { const p = { ...f.properties }; delete p[v.n]; return { ...f, properties: p }; }); }) });
  };
  D.fieldCalculator = () => {
    const L = needLayer(); if (!L) return;
    const s = A.selected(L.id);
    const d = Aero.dialog({ title: 'Field calculator — ' + L.name, width: 640, ok: 'Calculate', html: `<div class="dlg-grid"><label>Target</label><div class="inl"><select id="fcMode">${opt('new', 'Create a new field')}${L.fields.length ? opt('upd', 'Update existing field') : ''}</select><input type="text" id="fcName" value="calc" style="width:140px"><select id="fcType">${opt('number', 'Number')}${opt('string', 'Text')}${opt('boolean', 'True/false')}</select><select id="fcField" style="display:none">${L.fields.map(f => opt(f.name, f.name)).join('')}</select></div>
        <label>Rows</label><label style="color:inherit"><input type="checkbox" id="fcSel" ${s.size ? 'checked' : 'disabled'}> only the ${s.size} selected feature${s.size === 1 ? '' : 's'}</label></div><div id="fcE"></div>
        <div class="dnote">Functions: ${X.FUNCTIONS.join(', ')}. Geometry: $area (m²), $length, $perimeter (m), $x, $y (centroid lon/lat), $id.</div>`,
      onOK: () => {
        const g = i => d.el.querySelector('#' + i), mode = g('fcMode').value, ex = X.compile(builder.get(), L.fields);
        if (!ex.ok) { Aero.toast(ex.error); return; }
        const name = mode === 'new' ? g('fcName').value.trim() : g('fcField').value; if (mode === 'new') { const e = validName(name, L); if (e) { Aero.toast(e); return; } }
        const type = mode === 'new' ? g('fcType').value : L.fields.find(f => f.name === name).type, only = g('fcSel').checked;
        const conv = v => v == null ? null : type === 'number' ? (isFinite(+v) && v !== '' ? +v : null) : type === 'boolean' ? X.truthy(v) : String(v);
        let n = 0;
        A.change('Field calculator', () => { const nl = A.mutLayer(L.id); if (mode === 'new') nl.fields.push({ name, type }); nl.features = nl.features.map(f => { if (only && !s.has(f.id)) return mode === 'new' ? { ...f, properties: { ...f.properties, [name]: null } } : f; n++; let v; try { v = conv(ex.eval(f)); } catch (e) { v = null; } return { ...f, properties: { ...f.properties, [name]: v } }; }); });
        Aero.toast(`Calculated “${name}” for ${n} feature${n === 1 ? '' : 's'}`);
      } });
    const g = i => d.el.querySelector('#' + i);
    g('fcMode').onchange = () => { const u = g('fcMode').value === 'upd'; g('fcName').style.display = g('fcType').style.display = u ? 'none' : ''; g('fcField').style.display = u ? '' : 'none'; };
    g('fcName').addEventListener('keydown', e => e.stopPropagation());
    const builder = exprBuilder(g('fcE'), L, '', (ex, msg) => { if (ex) { const f = L.features[0]; let v; try { v = f ? ex.eval(f) : null; } catch (e) { v = 'error: ' + e.message; } msg.textContent = '✓ First feature → ' + String(v ?? 'NULL').slice(0, 80); } });
  };
  D.statistics = () => {
    const L = needLayer(); if (!L) return;
    const show = (field, onlySel) => {
      const s = A.selected(L.id), vals = L.features.filter(f => !onlySel || s.has(f.id)).map(f => f.properties[field]);
      const nums = vals.filter(v => typeof v === 'number' && isFinite(v)).sort((a, b) => a - b), n = nums.length, sum = nums.reduce((a, b) => a + b, 0), mean = n ? sum / n : NaN;
      const sd = n ? Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / n) : NaN, med = n ? (n % 2 ? nums[(n - 1) / 2] : (nums[n / 2 - 1] + nums[n / 2]) / 2) : NaN;
      const uniq = new Set(vals.map(v => String(v ?? ''))).size, nulls = vals.filter(v => v == null || v === '').length;
      const row = (k, v) => `<tr><td>${k}</td><td style="text-align:right">${v}</td></tr>`, f = x => isFinite(x) ? (+x.toPrecision(10)).toLocaleString('en-US', { maximumFractionDigits: 6 }) : '—';
      return `<table class="clsTable">${row('Features', vals.length)}${row('Numeric values', n)}${row('Null / empty', nulls)}${row('Unique values', uniq)}${n ? row('Sum', f(sum)) + row('Mean', f(mean)) + row('Median', f(med)) + row('Std deviation', f(sd)) + row('Minimum', f(nums[0])) + row('Maximum', f(nums[n - 1])) + row('Range', f(nums[n - 1] - nums[0])) : ''}</table>`;
    };
    const f0 = (L.fields.find(f => f.type === 'number') || L.fields[0] || {}).name; if (!f0) return Aero.toast('This layer has no fields');
    const d = Aero.dialog({ title: 'Statistics — ' + L.name, noCancel: true, ok: 'Close', html: `<div class="dlg-grid"><label>Field</label><select id="stF">${L.fields.map(f => opt(f.name, f.name, f0)).join('')}</select><label></label><label style="color:inherit"><input type="checkbox" id="stS" ${A.selected(L.id).size ? '' : 'disabled'}> selected features only</label></div><div id="stOut"></div>` });
    const up = () => d.el.querySelector('#stOut').innerHTML = show(d.el.querySelector('#stF').value, d.el.querySelector('#stS').checked);
    d.el.querySelector('#stF').onchange = up; d.el.querySelector('#stS').onchange = up; up();
  };

  // ---------- new layer / CRS ----------
  D.newLayer = () => Aero.dialog({ title: 'New layer', instruction: 'Create an empty layer to digitize into.',
    fields: [{ key: 'n', label: 'Name', type: 'text', value: 'New layer' }, { key: 't', label: 'Geometry', type: 'select', value: 'Polygon', options: [['Point', 'Points'], ['LineString', 'Lines'], ['Polygon', 'Polygons']] }, { key: 'f', label: 'Fields', type: 'text', value: 'name:text, value:number' }],
    onOK: v => {
      const fields = String(v.f || '').split(',').map(s => s.trim()).filter(Boolean).map(s => { const [n, t] = s.split(':').map(x => x.trim()); return { name: n, type: /^(num|number|int|integer|real|double|float)/i.test(t || '') ? 'number' : /^bool/i.test(t || '') ? 'boolean' : 'string' }; }).filter((f, i, a) => f.name && a.findIndex(x => x.name === f.name) === i);
      const [L] = A.addLayers([{ name: v.n || 'New layer', geomType: v.t, features: [], fields }], { zoom: false, label: 'New layer' });
      A.setTool({ Point: 'addpt', LineString: 'addline', Polygon: 'addpoly' }[v.t]); void L;
    } });
  D.mapCRS = () => {
    const cur = typeof A.doc.crs === 'string' ? A.doc.crs : '';
    const d = Aero.dialog({ title: 'Map coordinate reference system', width: 600, instruction: 'Layers are reprojected on the fly into the map CRS. Measurements are always geodesic.', ok: 'Apply',
      html: `<div class="dlg-grid"><label>Search</label><input type="text" id="crsQ" placeholder="EPSG code, name, ‘UTM 33N’, ‘equal area’…"><label>CRS</label><select id="crsL" size="10" style="height:180px">${P.list().map(([k, n]) => opt(k, `${k} — ${n}`, cur)).join('')}</select>
        <label></label><button class="aero-btn small" id="crsUtm" style="justify-self:start">Use the UTM zone of the map centre</button>
        <label class="wide">…or paste a WKT definition (e.g. from a .prj file):</label></div><textarea class="expr" id="crsW" placeholder='PROJCS["…", …]'></textarea>`,
      onOK: () => {
        const w = d.el.querySelector('#crsW').value.trim();
        if (w) { try { const def = P.fromWkt(w); A.change('Change map CRS', () => A.setCRS(def)); if (def.datumWarning) Aero.toast('Datum shift unknown for ' + def.datumWarning + ' — treated as WGS 84'); } catch (e) { Aero.alert('Could not use this WKT', e.message); } return; }
        const v = d.el.querySelector('#crsL').value; if (v) A.change('Change map CRS', () => A.setCRS(v));
      } });
    const q = d.el.querySelector('#crsQ'), l = d.el.querySelector('#crsL');
    q.addEventListener('keydown', e => e.stopPropagation()); d.el.querySelector('#crsW').addEventListener('keydown', e => e.stopPropagation());
    q.oninput = () => { const t = q.value.toLowerCase().replace(/utm\s*(\d+)\s*([ns])/, 'utm zone $1$2'); [...l.options].forEach(o => o.hidden = t && !o.text.toLowerCase().includes(t)); };
    d.el.querySelector('#crsUtm').onclick = () => { const c = A.toLonLat([A.view.cx, A.view.cy]); l.value = P.utmZoneFor(c[0], c[1]); };
  };
  // ask for the CRS of data whose coordinates are not lon/lat (no .prj / CRS info)
  D.askCrs = (name, cb) => {
    const c = A.doc.layers.length ? (typeof A.doc.crs === 'string' ? A.doc.crs : 'EPSG:3857') : 'EPSG:3857';
    Aero.dialog({ title: 'Unknown coordinate system', width: 560, instruction: `“${name}” has coordinates that are not longitude/latitude and no CRS information. Which CRS are they in?`,
      fields: [{ key: 'c', label: 'CRS', type: 'select', value: c, options: P.list().map(([k, n]) => [k, `${k} — ${n}`]) }, { key: 'w', label: 'or WKT', type: 'textarea', value: '' }], ok: 'Use this CRS',
      onOK: v => { let def; try { def = v.w.trim() ? P.fromWkt(v.w) : P.get(v.c); } catch (e) { Aero.alert('Bad WKT', e.message); return; } cb(def); }, onCancel: () => cb(null) });
  };
  D.csvColumns = (name, header, cb) => Aero.dialog({ title: 'CSV coordinates', instruction: `Choose the coordinate columns of “${name}”.`,
    fields: [{ key: 'x', label: 'X / longitude', type: 'select', value: header.findIndex(h => /lon|lng|x|east/i.test(h)), options: header.map((h, i) => [i, h]) }, { key: 'y', label: 'Y / latitude', type: 'select', value: header.findIndex(h => /lat|y|north/i.test(h)), options: header.map((h, i) => [i, h]) },
      { key: 'c', label: 'CRS of the values', type: 'select', value: 'EPSG:4326', options: P.list().map(([k, n]) => [k, `${k} — ${n}`]) }],
    onOK: v => cb({ lon: +v.x, lat: +v.y, crs: v.c === 'EPSG:4326' ? null : v.c }), onCancel: () => cb(null) });

  // ---------- geoprocessing ----------
  function run(fn, msg = 'Processing…') { Aero.busy(msg); setTimeout(() => { try { fn(); } catch (e) { console.error(e); Aero.alert('Processing failed', e.message || String(e)); } finally { Aero.busy(); } }, 30); }
  D.run = run;
  const inputFeatures = (L, onlySel) => { const s = A.selected(L.id), ex = L.filter ? X.compile(L.filter) : null; return L.features.filter(f => f.geometry && (!onlySel || s.has(f.id)) && (!ex || ex.test(f))); };
  const selOpt = L => ({ key: 'so', label: `Selected features only${L && A.selected(L.id).size ? ` (${A.selected(L.id).size})` : ''}`, type: 'checkbox', value: !!(L && A.selected(L.id).size) });
  const polyLayers = () => A.doc.layers.filter(l => l.geomType === 'Polygon' || l.geomType === 'Mixed');
  function result(name, geomType, feats, fields, style) {
    if (!feats.length) { Aero.alert('No result', 'The operation produced no features.'); return null; }
    const [L] = A.addLayers([{ name, geomType, features: feats.map((f, i) => ({ id: i + 1, geometry: f.geometry, properties: f.properties })), fields, style }], { zoom: false, label: name });
    Aero.toast(`${name}: ${feats.length} feature${feats.length === 1 ? '' : 's'}`); return L;
  }
  const geomKind = g => G.baseType(g.type);
  D.buffer = () => {
    const L = needLayer(); if (!L) return;
    Aero.dialog({ title: 'Buffer', instruction: 'Polygons around features at a geodesic distance (computed in a local transverse Mercator per feature).',
      fields: [{ key: 'l', label: 'Input layer', type: 'select', value: L.id, options: A.doc.layers.map(l => [l.id, l.name]) }, { key: 'd', label: 'Distance (metres)', type: 'number', value: 1000, min: -1e7, max: 1e7 }, { key: 's', label: 'Segments per quarter circle', type: 'number', value: 8, min: 2, max: 32 }, { key: 'dis', label: 'Dissolve result', type: 'checkbox', value: false }, selOpt(L)],
      onOK: v => run(() => {
        const S = A.layer(v.l), feats = inputFeatures(S, v.so); if (!feats.length) { Aero.toast('No input features'); return; }
        if (!(v.d > 0) && S.geomType !== 'Polygon') { Aero.toast('Negative or zero buffers only apply to polygons'); return; }
        let out = feats.map(f => ({ geometry: O.geoBuffer(f.geometry, v.d, Math.round(v.s) || 8), properties: { ...f.properties } })).filter(f => f.geometry);
        let fields = S.fields;
        if (v.dis) { out = [{ geometry: O.geoUnion(out.map(f => f.geometry)), properties: { features: out.length } }]; fields = [{ name: 'features', type: 'number' }]; }
        result(`${S.name} buffer ${G.fmtDist(Math.abs(v.d))}`, 'Polygon', out.filter(f => f.geometry), fields);
      }, 'Buffering…') });
  };
  D.clip = (erase) => {
    const L = needLayer(); if (!L) return; const pl = polyLayers(); if (!pl.length) return Aero.toast('A polygon layer is needed to clip with');
    Aero.dialog({ title: erase ? 'Difference (erase)' : 'Clip', instruction: erase ? 'Keep the parts of the input that are outside the erase polygons.' : 'Keep the parts of the input that are inside the clip polygons.',
      fields: [{ key: 'l', label: 'Input layer', type: 'select', value: L.id, options: A.doc.layers.map(l => [l.id, l.name]) }, { key: 'c', label: erase ? 'Erase layer' : 'Clip layer', type: 'select', value: (pl.find(l => l.id !== L.id) || pl[0]).id, options: pl.map(l => [l.id, l.name]) }, { key: 'cs', label: 'Selected clip features only', type: 'checkbox', value: false }, selOpt(L)],
      onOK: v => run(() => {
        const S = A.layer(v.l), Cl = A.layer(v.c), feats = inputFeatures(S, v.so), clipF = inputFeatures(Cl, v.cs);
        if (!clipF.length) { Aero.toast('No clip features'); return; }
        const mask = O.geoUnion(clipF.map(f => f.geometry)); if (!mask) { Aero.toast('The clip layer has no polygons'); return; }
        const mb = G.bbox(mask), out = [];
        feats.forEach(f => {
          const k = geomKind(f.geometry), fb = G.bbox(f.geometry), hit = G.bboxHit(fb, mb);
          if (!hit) { if (erase) out.push({ geometry: f.geometry, properties: { ...f.properties } }); return; }
          let g = null;
          if (k === 'Polygon') g = erase ? O.geoDifference(f.geometry, mask) : O.geoIntersection(f.geometry, mask);
          else if (k === 'LineString') g = O.geoClipLines(f.geometry, mask, !erase);
          else if (k === 'Point') { const pts = G.pointsOf(f.geometry).filter(p => G.pointInGeom(p, mask) !== !!erase); g = pts.length ? (pts.length === 1 ? { type: 'Point', coordinates: pts[0] } : { type: 'MultiPoint', coordinates: pts }) : null; }
          if (g) out.push({ geometry: g, properties: { ...f.properties } });
        });
        result(`${S.name} ${erase ? 'minus' : 'clipped by'} ${Cl.name}`, S.geomType, out, S.fields, S.style);
      }, erase ? 'Erasing…' : 'Clipping…') });
  };
  D.intersect = () => {
    const L = needLayer(); if (!L) return; const pl = polyLayers(); if (!pl.length) return Aero.toast('A polygon overlay layer is needed');
    Aero.dialog({ title: 'Intersect', instruction: 'Overlay two layers: each output feature is the shared part of an input feature and an overlay polygon, with the attributes of both.',
      fields: [{ key: 'a', label: 'Input layer', type: 'select', value: L.id, options: A.doc.layers.map(l => [l.id, l.name]) }, { key: 'b', label: 'Overlay layer (polygons)', type: 'select', value: (pl.find(l => l.id !== L.id) || pl[0]).id, options: pl.map(l => [l.id, l.name]) }, selOpt(L)],
      onOK: v => run(() => {
        const LA = A.layer(v.a), LB = A.layer(v.b); if (LA.id === LB.id) { Aero.toast('Choose two different layers'); return; }
        const fa = inputFeatures(LA, v.so), fb = inputFeatures(LB, false), bb = fb.map(f => G.bbox(f.geometry));
        const rename = new Map(); LB.fields.forEach(f => rename.set(f.name, LA.fields.some(x => x.name === f.name) ? f.name + '_2' : f.name));
        const fields = [...LA.fields, ...LB.fields.map(f => ({ name: rename.get(f.name), type: f.type }))], out = [];
        fa.forEach(f => {
          const k = geomKind(f.geometry), ab = G.bbox(f.geometry);
          fb.forEach((g, i) => {
            if (!G.bboxHit(ab, bb[i])) return; let r = null;
            if (k === 'Polygon') r = O.geoIntersection(f.geometry, g.geometry);
            else if (k === 'LineString') r = O.geoClipLines(f.geometry, g.geometry, true);
            else if (k === 'Point') { const pts = G.pointsOf(f.geometry).filter(p => G.pointInGeom(p, g.geometry)); r = pts.length ? (pts.length === 1 ? { type: 'Point', coordinates: pts[0] } : { type: 'MultiPoint', coordinates: pts }) : null; }
            if (r) { const p = { ...f.properties }; LB.fields.forEach(x => p[rename.get(x.name)] = g.properties[x.name] ?? null); out.push({ geometry: r, properties: p }); }
          });
        });
        result(`${LA.name} ∩ ${LB.name}`, LA.geomType, out, fields);
      }, 'Intersecting…') });
  };
  D.dissolve = () => {
    const L = needLayer(); if (!L) return;
    Aero.dialog({ title: 'Dissolve', instruction: 'Merge features that share a field value (or all features) into one feature each. Shared polygon boundaries disappear.',
      fields: [{ key: 'l', label: 'Input layer', type: 'select', value: L.id, options: A.doc.layers.map(l => [l.id, l.name]) }, { key: 'f', label: 'Dissolve field', type: 'select', value: '', options: [['', '(none — dissolve everything)'], ...L.fields.map(f => [f.name, f.name])] }, { key: 'sum', label: 'Sum numeric fields', type: 'checkbox', value: true }, selOpt(L)],
      onOK: v => run(() => {
        const S = A.layer(v.l), feats = inputFeatures(S, v.so), groups = new Map();
        feats.forEach(f => { const k = v.f ? String(f.properties[v.f] ?? '') : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(f); });
        const nums = v.sum ? S.fields.filter(f => f.type === 'number' && f.name !== v.f) : [];
        const fields = [...(v.f ? [S.fields.find(f => f.name === v.f)] : []), { name: 'count', type: 'number' }, ...nums.map(f => ({ name: 'sum_' + f.name, type: 'number' }))];
        const out = [...groups].map(([k, fs]) => {
          const kinds = new Set(fs.map(f => geomKind(f.geometry))); let g;
          if (kinds.size === 1 && kinds.has('Polygon')) g = O.geoUnion(fs.map(f => f.geometry));
          else if (kinds.size === 1 && kinds.has('LineString')) { const ls = fs.flatMap(f => G.linesOf(f.geometry)); g = ls.length === 1 ? { type: 'LineString', coordinates: ls[0] } : { type: 'MultiLineString', coordinates: ls }; }
          else if (kinds.size === 1 && kinds.has('Point')) { const ps = fs.flatMap(f => G.pointsOf(f.geometry)); g = ps.length === 1 ? { type: 'Point', coordinates: ps[0] } : { type: 'MultiPoint', coordinates: ps }; }
          else g = { type: 'GeometryCollection', geometries: fs.map(f => f.geometry) };
          const p = { count: fs.length }; if (v.f) p[v.f] = fs[0].properties[v.f] ?? null;
          nums.forEach(n => p['sum_' + n.name] = fs.reduce((s, f) => s + (typeof f.properties[n.name] === 'number' ? f.properties[n.name] : 0), 0));
          return { geometry: g, properties: p };
        }).filter(f => f.geometry);
        result(`${S.name} dissolved${v.f ? ' by ' + v.f : ''}`, S.geomType, out, fields);
      }, 'Dissolving…') });
  };
  D.centroids = () => {
    const L = needLayer(); if (!L) return;
    Aero.dialog({ title: 'Centroids', instruction: 'A point for each feature. “Point on surface” is guaranteed to fall inside its polygon.',
      fields: [{ key: 'l', label: 'Input layer', type: 'select', value: L.id, options: A.doc.layers.map(l => [l.id, l.name]) }, { key: 'm', label: 'Method', type: 'select', value: 'centroid', options: [['centroid', 'Centroid (centre of mass)'], ['surface', 'Point on surface']] }, selOpt(L)],
      onOK: v => run(() => {
        const S = A.layer(v.l), out = inputFeatures(S, v.so).map(f => {
          const b = G.bbox(f.geometry), tm = P.localTM((b[0] + b[2]) / 2, (b[1] + b[3]) / 2), g = G.mapCoords(f.geometry, c => tm.forward(c));
          const c = v.m === 'surface' ? G.pointOnSurface(g) : G.centroid(g); return c && { geometry: { type: 'Point', coordinates: tm.inverse(c) }, properties: { ...f.properties } };
        }).filter(Boolean);
        result(`${S.name} ${v.m === 'surface' ? 'points on surface' : 'centroids'}`, 'Point', out, S.fields);
      }, 'Computing centroids…') });
  };
  D.selectionToLayer = () => {
    const L = needLayer(); if (!L) return; const fs = A.selectedFeatures(L.id); if (!fs.length) return Aero.toast('Select features first');
    result(`${L.name} selection`, L.geomType, fs.map(f => ({ geometry: f.geometry, properties: { ...f.properties } })), L.fields, L.style);
  };
  D.duplicateLayer = () => { const L = needLayer(); if (!L) return; A.addLayers([{ ...L, id: null, name: L.name + ' copy' }], { zoom: false, label: 'Duplicate layer' }); };
  D.renameLayer = async () => { const L = needLayer(); if (!L) return; const n = await Aero.prompt('Rename layer', 'Name', L.name); if (n && n.trim()) A.setLayerProps(L.id, { name: n.trim() }, 'Rename layer'); };
})();
