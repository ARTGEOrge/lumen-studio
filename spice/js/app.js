// Lumen Spice — schematic capture + SPICE simulation + waveform viewer, in the spirit of LTspice.
(function () {
  'use strict';
  const PL = window.SpiceParts, S = window.SpiceSchematic, NL = window.SpiceNetlist, Ex = window.SpiceExpr, Models = window.SpiceModels, Eng = window.SpiceEngine;
  const $ = id => document.getElementById(id), esc = s => Aero.esc(String(s ?? ''));
  const AUTOSAVE = 'lumen-spice-autosave';
  const COLORS = ['#1f5fbf', '#d0312d', '#2a9d3c', '#8e44ad', '#e67e22', '#0f9fb5', '#8c5a3c', '#d6409f', '#5d6d7e', '#a5a51d'];
  const A = window.SpiceApp = {
    doc: null, sel: null, tool: 'select', placing: null, result: null, traces: [], running: false, opVals: null, docName: 'Untitled', filePath: null, showGrid: true, messages: [],
  };
  const hist = new Aero.History({ max: 150 });
  let conCache = null, tb = null;
  const isNet = () => typeof A.doc.netlist === 'string';

  // ---------- document state ----------
  A.con = () => { if (isNet()) return null; if (!conCache) { try { conCache = S.connectivity(A.doc); } catch (e) { conCache = null; } } return conCache; };
  A.invalidate = () => { conCache = null; };
  function snapshot() { const d = { ...A.doc }; delete d.traces; return JSON.stringify(d); }
  function load(doc, name, path, keepTraces) {
    A.doc = S.normalize(doc); A.docName = name || doc.title || 'Untitled'; A.filePath = path || null;
    A.sel = SchEditor.emptySel(); A.result = null; A.plotTraces = []; A.opVals = null; A.messages = []; conCache = null;
    A.traces = keepTraces ? A.traces : (A.doc.traces || []).map(e => ({ expr: e }));
    hist.reset('Open', snapshot()); Aero.setDoc(A.docName, false);
    setMode(); A.setTool('select'); SchEditor.fit(); syncSimUi(); $('dirText').value = A.doc.directives || ''; $('netText').value = A.doc.netlist || '';
    PlotView.set(null, []); renderAll();
  }
  A.commit = (label, fn) => {
    const before = snapshot(); fn(A.doc); A.doc = S.normalize(A.doc); conCache = null;
    if (snapshot() === before) { render(); return; }
    A.opVals = null; hist.push(label, snapshot()); autosave(); render();
  };
  A.commitMoved = (label, before) => { conCache = null; A.doc = S.normalize(A.doc); const now = snapshot(); const b = JSON.parse(before); delete b.traces; if (JSON.stringify(b) !== now) { A.opVals = null; hist.push(label, now); autosave(); } render(); };
  function restore(s) { if (!s) return; const traces = A.traces; A.doc = S.normalize(JSON.parse(s)); A.traces = traces; A.sel = SchEditor.emptySel(); conCache = null; A.opVals = null; syncSimUi(); $('dirText').value = A.doc.directives || ''; if (isNet()) $('netText').value = A.doc.netlist; autosave(); render(); }
  let saveT; function autosave() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(AUTOSAVE, JSON.stringify({ name: A.docName, doc: { ...A.doc, traces: A.traces.map(t => t.expr) } })); } catch (e) { } }, 500); }
  A.nextRef = (type, doc = A.doc) => {
    const def = PL.PART[type]; if (def.power) return '';
    const pre = def.prefix; let n = 0;
    doc.parts.forEach(p => { const m = new RegExp('^' + pre + '(\\d+)$', 'i').exec(p.ref || ''); if (m) n = Math.max(n, +m[1]); });
    return pre + (n + 1);
  };

  // ---------- rendering ----------
  A.status = s => { $('st1').textContent = s; };
  A.render = render;
  function render() {
    // drop selection entries that no longer exist (after delete / undo)
    if (A.sel) [['parts', A.doc.parts], ['wires', A.doc.wires], ['labels', A.doc.labels]].forEach(([k, arr]) => A.sel[k].forEach(i => { if (i >= arr.length) A.sel[k].delete(i); }));
    if (!isNet()) SchEditor.draw(); renderProps(); renderStatus(); renderTraceList();
  }
  function renderAll() { render(); renderSignals(); renderOutput(); }
  function renderStatus() {
    if (isNet()) { const lines = A.doc.netlist.split('\n').filter(l => /^\s*[a-z]/i.test(l)).length; $('st2').textContent = `SPICE netlist · ${lines} element lines`; }
    else { const parts = A.doc.parts.filter(p => !PL.PART[p.type].power).length; $('st2').textContent = `${parts} parts · ${A.doc.wires.length} wires`; }
    const r = A.result; $('st3').textContent = r ? `${{ tran: 'Transient', ac: 'AC', dc: 'DC sweep', op: 'Operating point' }[r.analysis]}: ${r.analysis === 'op' ? r.converged : r.x.length + ' points'} · ${r.ms} ms` : '';
    A.updateZoom();
    $('hint').textContent = hintText();
    $('bRot').disabled = $('bMir').disabled = isNet();
    $('bC1').classList.toggle('on', PlotView.cursors[0] != null); $('bC2').classList.toggle('on', PlotView.cursors[1] != null);
  }
  A.updateZoom = () => { $('stZoom').textContent = isNet() ? '' : Math.round(SchEditor.scale * 100) + '%'; };
  function hintText() {
    if (isNet()) return 'Edit the netlist, then Run (F5) · Edit → Convert to schematic';
    return { wire: 'Click to start, click to bend, end on a pin or wire · / flips the corner · Esc stops', label: 'Click a wire or pin to name its net', probe: 'Click a net to plot its voltage, a part body to plot its current · remove traces with ✕ in the Traces tab', place: 'Click to place · Ctrl+R rotate · Ctrl+E mirror · Esc done' }[A.tool]
      || 'Drag to move (wires follow) · double-click to edit · right-drag pans · wheel zooms';
  }
  function setMode() {
    const net = isNet();
    $('cv').hidden = net; $('netText').hidden = !net;
    document.querySelectorAll('#tools .aero-tool').forEach(b => { b.disabled = net && b.dataset.tool !== 'select'; b.style.opacity = net && b.dataset.tool !== 'select' ? 0.4 : ''; });
    document.querySelector('.aero-tab[data-t=dir]').style.display = net ? 'none' : '';
    if (net && document.querySelector('.aero-tab.on').dataset.t === 'dir') showTab('traces');
  }

  // ---------- tools ----------
  const ic = {
    select: '<path d="M5 3l13 8.5-6 1.2-3.2 5.8z"/>',
    wire: '<path d="M3 18h7V6h11"/><circle cx="3" cy="18" r="1.6"/><circle cx="21" cy="6" r="1.6"/>',
    label: '<path d="M3 8h11l5 4-5 4H3z"/><path d="M6.5 12h5"/>',
    probe: '<path d="M14.5 3.5l6 6-3.2 3.2-6-6z"/><path d="M12.5 8.5L5 16l-1.5 4.5L8 19l7.5-7.5"/>',
    R: '<path d="M2 12h3.5l1.7-5 3.3 10 3.3-10 3.3 10 1.7-5H22"/>',
    C: '<path d="M2 12h8M10 5v14M14 5v14M14 12h8"/>',
    L: '<path d="M2 14h2.5a2.6 2.6 0 0 1 5 0 2.6 2.6 0 0 1 5 0 2.6 2.6 0 0 1 5 0H22"/>',
    D: '<path d="M2 12h6M8 6.5v11l9-5.5z M17 6.5v11M17 12h5"/>',
    V: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2v3.5M12 18.5V22M12 8.3v4M10 10.3h4M10 15h4"/>',
    I: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2v3.5M12 18.5V22M12 8v7.5M9.5 13l2.5 3 2.5-3"/>',
    NPN: '<circle cx="12.5" cy="12" r="8"/><path d="M3 12h6.5M9.5 7v10M9.5 10l6-4V2M9.5 14l6 4v4M13 17.5l2.5.5-.7-2.4"/>',
    NMOS: '<path d="M3 12h5.5M8.5 7v10M11 6v3M11 10.5v3M11 15v3M11 7.5h6V2M11 16.5h6V22M11 12h6v4.5"/>',
    OPAMP: '<path d="M6 4v16l14-8z"/><path d="M2 8.5h4M2 15.5h4M20 12h2.5M8 8.5h2.5M9.2 15.5h-2.4M8 14.3v2.4"/>',
    GND: '<path d="M12 3v9M5 12h14M8 15.5h8M10.5 19h3"/>',
    more: '<circle cx="5.5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18.5" cy="12" r="1.6"/>',
  };
  const TOOLS = [
    { id: 'select', title: 'Select / move', icon: ic.select },
    { id: 'wire', title: 'Wire', key: 'W', icon: ic.wire },
    { id: 'label', title: 'Net label', key: 'N', icon: ic.label },
    { id: 'probe', title: 'Probe: click a net or part to plot it', key: 'P', icon: ic.probe },
    null,
    { id: 'p:R', title: 'Resistor', key: 'R', icon: ic.R },
    { id: 'p:C', title: 'Capacitor', key: 'C', icon: ic.C },
    { id: 'p:L', title: 'Inductor', key: 'L', icon: ic.L },
    { id: 'p:D', title: 'Diode', key: 'D', icon: ic.D },
    { id: 'p:V', title: 'Voltage source', key: 'V', icon: ic.V },
    { id: 'p:I', title: 'Current source', key: 'I', icon: ic.I },
    { id: 'p:NPN', title: 'NPN transistor', key: 'Q', icon: ic.NPN },
    { id: 'p:NMOS', title: 'N-channel MOSFET', key: 'M', icon: ic.NMOS },
    { id: 'p:OPAMP', title: 'Op-amp', key: 'A', icon: ic.OPAMP },
    { id: 'p:GND', title: 'Ground', key: 'G', icon: ic.GND },
    { id: 'more', title: 'More parts (PNP, PMOS, LED, zener, switches, controlled sources, subcircuits, probe marker)…', icon: ic.more },
  ];
  A.setTool = id => {
    if (id === 'more') { partPicker(); return; }
    if (isNet() && id !== 'select') { Aero.toast('This document is a SPICE netlist — Edit → Convert to schematic to draw'); id = 'select'; }
    if (id.startsWith('p:')) { const type = id.slice(2), def = PL.PART[type]; A.tool = 'place'; A.placing = { type, rot: 0, mirror: false, value: def.value, extra: '', ...(type === 'SUBX' ? { pinCount: 2, pinNames: [] } : {}) }; }
    else { A.tool = id; A.placing = null; }
    document.querySelectorAll('#tools .aero-tool').forEach(b => b.classList.toggle('on', b.dataset.tool === (A.tool === 'place' ? 'p:' + A.placing.type : A.tool)));
    SchEditor.resetTool(); renderStatus();
  };
  A.startPlace = type => A.setTool('p:' + type);

  // ---------- properties ----------
  const modelTypes = { D: 'd', DZ: 'd', LED: 'd', NPN: 'npn', PNP: 'pnp', NMOS: 'nmos', PMOS: 'pmos', VSW: 'sw' };
  function userModels(type) { const out = []; String(A.doc.directives || '').split('\n').forEach(l => { const m = /^\s*\.model\s+(\S+)\s+(\w+)/i.exec(l); if (m) { const t = m[2].toLowerCase(); if ((t === 'vswitch' ? 'sw' : t) === type) out.push(m[1]); } }); return out; }
  function modelList(type) { return [...userModels(type), ...Models.byType(type).map(k => k.toUpperCase())]; }
  function renderProps() {
    const el = $('props'); el.innerHTML = '';
    if (isNet()) { $('propTitle').textContent = 'Netlist document'; el.innerHTML = `<div class="dim small">This document is a SPICE netlist (${esc(A.docName)}). Edit the text and press <b>Run</b> (F5). Click entries in the <b>Signals</b> tab to plot them, or use <b>Edit → Convert to schematic</b> to get an editable drawing.</div>`; return; }
    const sel = A.sel, n = SchEditor.selCount();
    if (n === 0) {
      $('propTitle').textContent = 'Schematic';
      el.innerHTML = `<div class="pform"><label>Title</label><input id="pTitle" value="${esc(A.doc.title)}"><div class="desc">Select a part to edit its value. Double-click a part for its full settings; double-click a switch to flip it.</div></div>`;
      $('pTitle').onchange = e => A.commit('Rename schematic', d => { d.title = e.target.value; });
      return;
    }
    if (n === 1 && sel.labels.size === 1) {
      const i = [...sel.labels][0], l = A.doc.labels[i]; $('propTitle').textContent = 'Net label';
      el.innerHTML = `<div class="pform"><label>Net</label><input id="pLab" value="${esc(l.name)}"><div class="row2"><button class="aero-btn small" id="pPlot">Plot V(${esc(l.name)})</button><button class="aero-btn small" id="pDel">Delete</button></div></div>`;
      $('pLab').onchange = e => { const v = S.cleanName(e.target.value); if (v) A.commit('Rename net label', d => { d.labels[i].name = v; }); };
      $('pPlot').onclick = () => A.onProbe('V(' + l.name + ')'); $('pDel').onclick = () => SchEditor.deleteSel();
      return;
    }
    if (n === 1 && sel.parts.size === 1) {
      const i = [...sel.parts][0], p = A.doc.parts[i], def = PL.PART[p.type];
      $('propTitle').textContent = def.name;
      const mt = modelTypes[p.type];
      let html = '<div class="pform">';
      if (!def.power) html += `<label>Name</label><input id="pRef" value="${esc(p.ref)}">`;
      if (p.type === 'SW') html += `<label>State</label><select id="pVal"><option value="open">open</option><option value="closed">closed</option></select>`;
      else if (p.type === 'SUBX') html += `<label>Subcircuit</label><input id="pVal" value="${esc(p.value)}" list="dlSub"><datalist id="dlSub">${[...S.definedSubckts(A.doc.directives).keys()].map(k => `<option value="${esc(k)}">`).join('')}</datalist><label>Pins</label><input id="pPins" type="number" min="1" max="40" value="${p.pinCount || 2}">`;
      else if (!def.power) html += `<label>${mt ? 'Model' : p.type === 'OPAMP' ? 'Params' : 'Value'}</label><input id="pVal" class="${p.type === 'V' || p.type === 'I' || p.type === 'OPAMP' ? 'mono' : ''}" value="${esc(p.value)}"${mt ? ' list="dlModels"' : ''}>`;
      if (mt) html += `<datalist id="dlModels">${modelList(mt).map(m => `<option value="${esc(m)}">`).join('')}</datalist>`;
      if (['R', 'C', 'L', 'V', 'NPN', 'PNP', 'NMOS', 'PMOS', 'SUBX'].includes(p.type)) html += `<label>Extra</label><input id="pExtra" value="${esc(p.extra)}" placeholder="${{ R: 'e.g. (none)', C: 'IC=0  Rser=10m', L: 'IC=0  Rser=0.1', V: 'Rser=0.5', NPN: 'area', PNP: 'area', NMOS: 'W=10u L=1u', PMOS: 'W=10u L=1u', SUBX: 'k=v params' }[p.type]}">`;
      const lib = mt && Models.LIB[String(p.value).toLowerCase()];
      html += `<div class="desc">${esc(lib ? lib.desc : def.hint || '')}</div><div class="row2">`;
      if (p.type === 'V' || p.type === 'I') html += `<button class="aero-btn small" id="pWave">Waveform…</button>`;
      if (p.type === 'OPAMP') html += `<button class="aero-btn small" id="pOp">Parameters…</button>`;
      if (A.result && A.result.analysis !== 'op' && S.currentProbe(p)) html += `<button class="aero-btn small" id="pPlot">Plot ${esc(S.currentProbe(p))}</button>`;
      html += `<button class="aero-btn small" id="pRot">Rotate</button><button class="aero-btn small" id="pDel">Delete</button></div></div>`;
      el.innerHTML = html;
      const on = (id, fn) => { const x = $(id); if (x) x.onchange = fn; };
      on('pRef', e => { const v = S.cleanName(e.target.value); if (v) A.commit('Rename ' + p.ref, d => { d.parts[i].ref = v; }); });
      if ($('pVal') && p.type === 'SW') $('pVal').value = /^(closed|on|1|true)$/i.test(p.value) ? 'closed' : 'open';
      on('pVal', e => A.commit('Edit ' + p.ref, d => { d.parts[i].value = e.target.value.trim(); if (p.type === 'SUBX') applySubPins(d.parts[i]); }));
      on('pExtra', e => A.commit('Edit ' + p.ref, d => { d.parts[i].extra = e.target.value.trim(); }));
      on('pPins', e => A.commit('Edit ' + p.ref, d => { d.parts[i].pinCount = Math.max(1, Math.min(40, Math.round(+e.target.value || 2))); }));
      const click = (id, fn) => { const x = $(id); if (x) x.onclick = fn; };
      click('pWave', () => sourceDialog(i)); click('pOp', () => opampDialog(i)); click('pPlot', () => A.onProbe(S.currentProbe(p)));
      click('pRot', () => SchEditor.rotateSel()); click('pDel', () => SchEditor.deleteSel());
      return;
    }
    $('propTitle').textContent = 'Selection';
    el.innerHTML = `<div class="pform"><div class="desc">${sel.parts.size} parts, ${sel.wires.size} wires, ${sel.labels.size} labels selected.</div><div class="row2"><button class="aero-btn small" id="pRot">Rotate</button><button class="aero-btn small" id="pDel">Delete</button></div></div>`;
    $('pRot').onclick = () => SchEditor.rotateSel(); $('pDel').onclick = () => SchEditor.deleteSel();
  }
  function applySubPins(p) { const sc = S.definedSubckts(A.doc.directives).get(String(p.value).toLowerCase()); if (sc) { p.pinCount = sc.length; p.pinNames = sc; } }

  // ---------- dialogs ----------
  const okNum = s => { s = String(s ?? '').trim(); return s !== '' && (!Number.isNaN(Ex.parseNum(s)) || /^\{.*\}$/.test(s)); };
  function sourceDialog(i) {
    const p = A.doc.parts[i]; let w; try { w = NL.parseSource(NL.tokens(p.value || '0'), () => undefined, () => { })[0]; } catch (e) { w = { dc: 0, fn: null, args: [] }; }
    // keep the user's text (with suffixes) where possible
    const raw = (() => { const m = /\(([^)]*)\)/.exec(p.value || ''); return m ? m[1].trim().split(/[\s,]+/) : []; })();
    const arg = (k, d) => raw[k] !== undefined && w.fn ? raw[k] : d;
    const fn = w.fn || 'dc';
    const F = [
      { key: 'fn', label: 'Function', type: 'select', value: fn, options: [['dc', 'DC (constant)'], ['pulse', 'PULSE'], ['sin', 'SINE'], ['pwl', 'PWL (piece-wise linear)'], ['exp', 'EXP']] },
      { key: 'dc', label: 'DC value', type: 'text', value: w.dcSet || !w.fn ? Ex.fmtSpice(w.dc) : '0' },
      { key: 'p_v1', label: 'Initial value', type: 'text', value: fn === 'pulse' ? arg(0, '0') : '0' }, { key: 'p_v2', label: 'Pulsed value', type: 'text', value: fn === 'pulse' ? arg(1, '5') : '5' },
      { key: 'p_td', label: 'Delay', type: 'text', value: fn === 'pulse' ? arg(2, '0') : '0' }, { key: 'p_tr', label: 'Rise time', type: 'text', value: fn === 'pulse' ? arg(3, '1n') : '1n' }, { key: 'p_tf', label: 'Fall time', type: 'text', value: fn === 'pulse' ? arg(4, '1n') : '1n' },
      { key: 'p_ton', label: 'On time', type: 'text', value: fn === 'pulse' ? arg(5, '0.5m') : '0.5m' }, { key: 'p_per', label: 'Period', type: 'text', value: fn === 'pulse' ? arg(6, '1m') : '1m' }, { key: 'p_n', label: 'Cycles (0 = ∞)', type: 'text', value: fn === 'pulse' ? arg(7, '0') : '0' },
      { key: 's_vo', label: 'DC offset', type: 'text', value: fn === 'sin' ? arg(0, '0') : '0' }, { key: 's_va', label: 'Amplitude', type: 'text', value: fn === 'sin' ? arg(1, '1') : '1' }, { key: 's_f', label: 'Frequency', type: 'text', value: fn === 'sin' ? arg(2, '1k') : '1k' },
      { key: 's_td', label: 'Delay', type: 'text', value: fn === 'sin' ? arg(3, '0') : '0' }, { key: 's_th', label: 'Damping (1/s)', type: 'text', value: fn === 'sin' ? arg(4, '0') : '0' }, { key: 's_ph', label: 'Phase (°)', type: 'text', value: fn === 'sin' ? arg(5, '0') : '0' }, { key: 's_n', label: 'Cycles (0 = ∞)', type: 'text', value: fn === 'sin' ? arg(6, '0') : '0' },
      { key: 'pwl', label: 'Points (time value per line)', type: 'textarea', mono: true, rows: 5, value: fn === 'pwl' ? pairs(raw) : '0 0\n1m 1\n2m 1\n3m 0' }, { key: 'pwl_r', label: 'Repeat', type: 'checkbox', value: !!w.repeat },
      { key: 'e_v1', label: 'Initial value', type: 'text', value: fn === 'exp' ? arg(0, '0') : '0' }, { key: 'e_v2', label: 'Pulsed value', type: 'text', value: fn === 'exp' ? arg(1, '1') : '1' }, { key: 'e_td1', label: 'Rise delay', type: 'text', value: fn === 'exp' ? arg(2, '0') : '0' },
      { key: 'e_tau1', label: 'Rise τ', type: 'text', value: fn === 'exp' ? arg(3, '100u') : '100u' }, { key: 'e_td2', label: 'Fall delay', type: 'text', value: fn === 'exp' ? arg(4, '1m') : '1m' }, { key: 'e_tau2', label: 'Fall τ', type: 'text', value: fn === 'exp' ? arg(5, '100u') : '100u' },
      { key: 'acm', label: 'AC amplitude (.ac)', type: 'text', value: w.acMag ? Ex.fmtSpice(w.acMag) : '' }, { key: 'acp', label: 'AC phase (°)', type: 'text', value: w.acPhase ? String(w.acPhase) : '' },
    ];
    function pairs(r) { const out = []; for (let k = 0; k + 1 < r.length; k += 2) out.push(r[k] + ' ' + r[k + 1]); return out.join('\n'); }
    const groups = { dc: ['dc'], pulse: ['p_'], sin: ['s_'], pwl: ['pwl'], exp: ['e_'] };
    const dlg = Aero.dialog({ title: `${p.ref} — ${p.type === 'V' ? 'voltage' : 'current'} source`, instruction: 'Choose the waveform. Values accept SPICE suffixes (5m, 1k, 10u, 2meg).', fields: F, width: 430,
      onInput: (k, v) => { if (k === 'fn') show(v.fn); },
      onOK: v => {
        const a = (keys) => keys.map(k => String(v[k]).trim());
        let txt;
        const bad = list => list.find(k => !okNum(v[k]));
        if (v.fn === 'dc') { if (bad(['dc'])) return Aero.alert('Source', 'DC value is not a number'); txt = String(v.dc).trim(); }
        if (v.fn === 'pulse') { const k = ['p_v1', 'p_v2', 'p_td', 'p_tr', 'p_tf', 'p_ton', 'p_per', 'p_n']; if (bad(k)) return Aero.alert('Source', 'Check the PULSE values: ' + bad(k).slice(2)); const vals = a(k); if (+Ex.parseNum(vals[7]) === 0) vals.pop(); txt = `PULSE(${vals.join(' ')})`; }
        if (v.fn === 'sin') { const k = ['s_vo', 's_va', 's_f', 's_td', 's_th', 's_ph', 's_n']; if (bad(k)) return Aero.alert('Source', 'Check the SINE values'); const vals = a(k); while (vals.length > 3 && Ex.parseNum(vals[vals.length - 1]) === 0) vals.pop(); txt = `SIN(${vals.join(' ')})`; }
        if (v.fn === 'pwl') { const nums = String(v.pwl).trim().split(/[\s,]+/).filter(Boolean); if (nums.length < 2 || nums.length % 2 || nums.some(x => !okNum(x))) return Aero.alert('Source', 'PWL needs pairs of numbers: time value'); txt = `PWL(${nums.join(' ')})${v.pwl_r ? ' r=0' : ''}`; }
        if (v.fn === 'exp') { const k = ['e_v1', 'e_v2', 'e_td1', 'e_tau1', 'e_td2', 'e_tau2']; if (bad(k)) return Aero.alert('Source', 'Check the EXP values'); txt = `EXP(${a(k).join(' ')})`; }
        const acm = String(v.acm).trim(); if (acm) { if (!okNum(acm)) return Aero.alert('Source', 'AC amplitude is not a number'); if (v.fn === 'dc' && txt === '0') txt = 'DC 0'; else if (v.fn === 'dc') txt = 'DC ' + txt; txt += ` AC ${acm}${String(v.acp).trim() && okNum(v.acp) ? ' ' + String(v.acp).trim() : ''}`; }
        A.commit('Edit ' + p.ref, d => { d.parts[i].value = txt; });
      } });
    const rows = [...dlg.el.querySelectorAll('.aero-row')];
    function show(f) { F.forEach((fd, k) => { const g = Object.entries(groups).find(([, pre]) => pre.some(x => fd.key.startsWith(x))); if (!g) return; rows[k].style.display = g[0] === f ? '' : 'none'; }); }
    show(fn);
  }
  function opampDialog(i) {
    const p = A.doc.parts[i], kv = NL.splitParams(NL.tokens(p.value || ''))[1];
    Aero.dialog({ title: `${p.ref} — op-amp model`, instruction: 'Single-pole macro model. Connect V+ and V− to supplies for rail clipping, or leave both open for an ideal amplifier.', width: 400, fields: [
      { key: 'avol', label: 'Open-loop gain', type: 'text', value: kv.avol || '1Meg' }, { key: 'gbw', label: 'Gain-bandwidth (Hz)', type: 'text', value: kv.gbw || '10Meg' },
      { key: 'slew', label: 'Slew rate (V/s)', type: 'text', value: kv.slew || '10Meg' }, { key: 'vdrop', label: 'Output headroom (V)', type: 'text', value: kv.vdrop || '0.1' }],
      onOK: v => { if (!['avol', 'gbw', 'slew', 'vdrop'].every(k => okNum(v[k]))) return Aero.alert('Op-amp', 'All parameters must be numbers'); A.commit('Edit ' + p.ref, d => { d.parts[i].value = `Avol=${v.avol} GBW=${v.gbw} Slew=${v.slew}` + (String(v.vdrop) !== '0.1' ? ` Vdrop=${v.vdrop}` : ''); }); } });
  }
  A.editPart = i => {
    const p = A.doc.parts[i];
    if (p.type === 'SW') { A.commit('Toggle ' + p.ref, d => { d.parts[i].value = /^(closed|on|1|true)$/i.test(p.value) ? 'open' : 'closed'; }); return; }
    if (p.type === 'V' || p.type === 'I') return sourceDialog(i);
    if (p.type === 'OPAMP') return opampDialog(i);
    if (PL.PART[p.type].power) return;
    const mt = modelTypes[p.type];
    const fields = [{ key: 'ref', label: 'Name', type: 'text', value: p.ref }];
    if (mt) fields.push({ key: 'value', label: 'Model', type: 'select', value: modelList(mt).find(m => m.toLowerCase() === String(p.value).toLowerCase()) || p.value, options: [...new Set([p.value, ...modelList(mt)])] });
    else fields.push({ key: 'value', label: p.type === 'SUBX' ? 'Subcircuit' : 'Value', type: 'text', value: p.value });
    if (['R', 'C', 'L', 'NPN', 'PNP', 'NMOS', 'PMOS', 'SUBX'].includes(p.type)) fields.push({ key: 'extra', label: 'Extra parameters', type: 'text', value: p.extra });
    const lib = mt && Models.LIB[String(p.value).toLowerCase()];
    Aero.dialog({ title: PL.PART[p.type].name, instruction: (lib ? lib.desc + '. ' : '') + (PL.PART[p.type].hint || (mt ? 'Pick a library model, or define your own with a .model directive.' : '')), fields, width: 400,
      onOK: v => A.commit('Edit ' + p.ref, d => { const q = d.parts[i]; if (S.cleanName(v.ref)) q.ref = S.cleanName(v.ref); q.value = String(v.value).trim(); if (v.extra !== undefined) q.extra = String(v.extra).trim(); if (q.type === 'SUBX') applySubPins(q); }) });
  };
  A.renameLabel = i => { const l = A.doc.labels[i]; Aero.prompt('Net label', 'Net name', l.name).then(v => { if (v && S.cleanName(v)) A.commit('Rename net label', d => { d.labels[i].name = S.cleanName(v); }); }); };

  function partPicker() {
    const list = PL.PARTS.map(p => p.id);
    const html = `<div class="partlist">${list.map(id => `<button class="aero-btn" data-p="${id}"><canvas width="44" height="34" data-c="${id}"></canvas>${esc(PL.PART[id].name)}</button>`).join('')}</div>`;
    const dlg = Aero.dialog({ title: 'Place a part', html, ok: 'Close', noCancel: true, width: 520 });
    dlg.el.querySelectorAll('canvas[data-c]').forEach(c => thumb(c, c.dataset.c));
    dlg.el.querySelectorAll('button[data-p]').forEach(b => b.onclick = () => { dlg.close(); A.setTool('p:' + b.dataset.p); });
  }
  function thumb(c, type) {
    const g = c.getContext('2d'), part = { type, x: 0, y: 0, rot: ['R', 'C', 'L', 'D', 'DZ', 'LED', 'SW', 'F', 'H'].includes(type) ? 1 : 0, mirror: false, value: PL.PART[type].value, pinCount: 4 };
    const b = PL.bbox(part), s = Math.min(38 / (b[2] - b[0] + 0.01), 28 / (b[3] - b[1] + 0.01), 6);
    g.translate(22 - (b[0] + b[2]) / 2 * s, 17 - (b[1] + b[3]) / 2 * s); g.scale(s, s); g.lineWidth = 1.4 / s; g.strokeStyle = g.fillStyle = '#8b1d1d'; g.lineCap = 'round';
    g.save(); g.rotate(part.rot * Math.PI / 2);
    PL.defOf(part).draw.forEach(d => { g.beginPath(); if (d[0] === 'line') { g.moveTo(d[1], d[2]); g.lineTo(d[3], d[4]); g.stroke(); } else if (d[0] === 'rect') { g.strokeRect(d[1], d[2], d[3] - d[1], d[4] - d[2]); } else if (d[0] === 'circle') { g.arc(d[1], d[2], d[3], 0, 7); d[4] === 'fill' ? g.fill() : g.stroke(); } else if (d[0] === 'arc') { g.arc(d[1], d[2], d[3], d[4] * Math.PI / 180, d[5] * Math.PI / 180); g.stroke(); } else if (d[0] === 'poly') { d[1].forEach(([x, y], k) => k ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); d[2] ? g.fill() : g.stroke(); } });
    g.restore();
  }

  // ---------- simulation command ----------
  function currentCard() { if (isNet()) { const m = /^\s*(\.(?:tran|ac|dc|op)\b[^\n]*)$/im.exec(A.doc.netlist); return m ? m[1].trim() : ''; } return A.doc.sim || ''; }
  function parseCard(card) { try { const d = NL.parse('x\n' + card + '\n'); return d.analyses[0] || null; } catch (e) { return null; } }
  function syncSimUi() { const card = currentCard(), a = parseCard(card); $('simCard').value = card; if (a) $('simType').value = a.type; }
  function setCard(card) {
    if (!parseCard(card)) { Aero.toast('Not a valid analysis command: ' + card); syncSimUi(); return; }
    if (isNet()) {
      A.commit('Simulation command', d => { if (/^\s*\.(tran|ac|dc|op)\b.*$/im.test(d.netlist)) d.netlist = d.netlist.replace(/^\s*\.(tran|ac|dc|op)\b.*$/im, card); else if (/^\s*\.end\s*$/im.test(d.netlist)) d.netlist = d.netlist.replace(/^\s*\.end\s*$/im, card + '\n.end'); else d.netlist += '\n' + card + '\n'; });
      $('netText').value = A.doc.netlist;
    } else A.commit('Simulation command', d => { d.sim = card; });
    syncSimUi();
  }
  function simDialog(type) {
    const cur = parseCard(currentCard()) || {}; type = type || cur.type || 'tran';
    const F = v => v == null ? '' : Ex.fmtSpice(v);
    const sources = isNet() ? [] : A.doc.parts.filter(p => p.type === 'V' || p.type === 'I').map(p => S.spiceName(p));
    let fields, instr;
    if (type === 'tran') { const c = cur.type === 'tran' ? cur : { tstop: 10e-3 }; instr = 'Transient analysis: time-domain simulation from 0 to the stop time. The time step adapts to the waveform; set a maximum step to force finer resolution.';
      fields = [{ key: 'tstop', label: 'Stop time', type: 'text', value: F(c.tstop) }, { key: 'tstart', label: 'Start saving at', type: 'text', value: F(c.tstart || 0) }, { key: 'tmax', label: 'Maximum time step', type: 'text', value: c.tmax ? F(c.tmax) : '', placeholder: 'automatic' }, { key: 'uic', label: 'Skip operating point (UIC)', type: 'checkbox', value: !!c.uic }]; }
    else if (type === 'ac') { const c = cur.type === 'ac' ? cur : { sweep: 'dec', n: 50, fstart: 10, fstop: 1e6 }; instr = 'Small-signal AC sweep around the operating point. Give at least one source an AC amplitude (e.g. "AC 1").';
      fields = [{ key: 'sweep', label: 'Sweep', type: 'select', value: c.sweep || 'dec', options: [['dec', 'Decade'], ['oct', 'Octave'], ['lin', 'Linear']] }, { key: 'n', label: 'Points (per decade/octave)', type: 'number', value: c.n || 50, min: 1, max: 10000 }, { key: 'fstart', label: 'Start frequency', type: 'text', value: F(c.fstart) }, { key: 'fstop', label: 'Stop frequency', type: 'text', value: F(c.fstop) }]; }
    else if (type === 'dc') { const c = cur.type === 'dc' ? cur : { src: sources[0] || 'V1', start: 0, stop: 5, step: 0.05 }; instr = 'DC sweep: steps one independent source and solves the operating point at each value.';
      fields = [sources.length ? { key: 'src', label: 'Source', type: 'select', value: sources.find(s => s.toLowerCase() === String(c.src).toLowerCase()) || sources[0], options: sources } : { key: 'src', label: 'Source', type: 'text', value: c.src }, { key: 'start', label: 'Start value', type: 'text', value: F(c.start) }, { key: 'stop', label: 'Stop value', type: 'text', value: F(c.stop) }, { key: 'step', label: 'Increment', type: 'text', value: F(c.step) }]; }
    else { setCard('.op'); return; }
    Aero.dialog({ title: { tran: 'Transient analysis', ac: 'AC analysis', dc: 'DC sweep' }[type], instruction: instr, fields, width: 420, onCancel: syncSimUi,
      onOK: v => {
        const num = k => Ex.parseNum(String(v[k]).trim());
        let card;
        if (type === 'tran') { const ts = num('tstop'), t0 = String(v.tstart).trim() ? num('tstart') : 0, tm = String(v.tmax).trim() ? num('tmax') : 0; if (!(ts > 0) || Number.isNaN(t0) || Number.isNaN(tm)) return Aero.alert('Transient', 'Enter a stop time such as 10m'); card = NL.analysisCard({ type: 'tran', tstep: 0, tstop: ts, tstart: t0, tmax: tm, uic: v.uic }); }
        if (type === 'ac') { const f0 = num('fstart'), f1 = num('fstop'); if (!(f0 > 0 && f1 > f0)) return Aero.alert('AC analysis', 'Start and stop frequencies must be positive, start < stop'); card = NL.analysisCard({ type: 'ac', sweep: v.sweep, n: Math.max(1, Math.round(v.n)), fstart: f0, fstop: f1 }); }
        if (type === 'dc') { const a = num('start'), b = num('stop'), s = num('step'); if ([a, b, s].some(Number.isNaN) || !s) return Aero.alert('DC sweep', 'Enter numeric start, stop and a non-zero increment'); card = NL.analysisCard({ type: 'dc', src: v.src, start: a, stop: b, step: s }); }
        setCard(card);
      } });
  }

  // ---------- simulation ----------
  let worker = null, jobId = 0;
  function buildNetlist() {
    if (isNet()) return { text: A.doc.netlist, warnings: [], probeNets: [] };
    if (!A.doc.parts.some(p => !PL.PART[p.type].power)) throw new Error('The schematic is empty — place some parts first (or open a sample from the File menu)');
    if (!A.doc.parts.some(p => p.type === 'GND') && !A.doc.labels.some(l => l.name === '0')) throw new Error('The schematic has no ground — place a ground symbol (G)');
    return S.toSpice(A.doc);
  }
  function setRunning(on) {
    A.running = on; $('bRun').disabled = on; $('bStop').disabled = !on; $('progress').hidden = !on; $('progress').firstChild.style.width = '0';
    if (on && !A.result) PlotView.draw();
  }
  async function run() {
    if (A.running) return;
    if (isNet()) A.doc.netlist = $('netText').value;
    let built;
    try { built = buildNetlist(); } catch (e) { A.messages = [{ kind: 'err', text: e.message }]; renderOutput(); showTab('output'); Aero.toast(e.message, 4000); return; }
    A.messages = built.warnings.map(w => ({ kind: 'warn', text: w }));
    const id = ++jobId; setRunning(true); A.status('Simulating…');
    const t0 = performance.now();
    const done = (r, err) => {
      if (id !== jobId) return; setRunning(false);
      if (err) { A.messages.unshift({ kind: 'err', text: err }); A.status('Simulation failed'); renderOutput(); showTab('output'); Aero.toast('Simulation failed — see the Output tab', 3500); return; }
      (r.warnings || []).forEach(w => A.messages.push({ kind: 'warn', text: w }));
      A.messages.unshift({ kind: 'ok', text: `${{ tran: 'Transient', ac: 'AC sweep', dc: 'DC sweep', op: 'Operating point' }[r.analysis]} finished in ${Math.round(performance.now() - t0)} ms${r.x.length > 1 ? ` · ${r.x.length} points` : ''}${r.rejected ? ` · ${r.rejected} rejected steps` : ''}` });
      onResult(r, built.probeNets);
    };
    try {
      if (!worker) { worker = new Worker('js/worker.js'); }
      worker.onmessage = e => { const m = e.data; if (m.id !== jobId) return; if (m.progress != null) { $('progress').firstChild.style.width = Math.round(m.progress * 100) + '%'; return; } done(m.result, m.error); };
      worker.onerror = e => { e.preventDefault(); worker = null; runInline(built.text, done); };
      worker.postMessage({ id, text: built.text });
    } catch (e) { worker = null; runInline(built.text, done); }
  }
  function runInline(text, done) {
    setTimeout(() => { try { const deck = NL.parse(text), an = NL.analysisOf(deck); if (!an) throw new Error('No analysis command — add .tran, .ac, .dc or .op'); const flat = NL.flatten(deck); const r = Eng.run(flat, an); r.warnings = flat.warnings; done(r); } catch (e) { done(null, e.message); } }, 10);
  }
  function stop() { if (!A.running) return; jobId++; if (worker) { worker.terminate(); worker = null; } setRunning(false); A.status('Stopped'); Aero.toast('Simulation stopped'); }
  A.onResult = onResult;
  function onResult(r, probeNets) {
    A.result = r; A.opVals = null;
    if (r.analysis === 'op') {
      A.opVals = new Map(); Object.entries(r.op).forEach(([k, v]) => { const m = /^V\((.*)\)$/.exec(k); if (m) A.opVals.set(m[1].toLowerCase(), v); });
      A.plotTraces = []; PlotView.set(null, []); renderAll(); showTab('output'); A.status('Operating point solved — node voltages are shown on the schematic'); return;
    }
    const have = new Set(A.traces.map(t => t.expr.toLowerCase()));
    (probeNets || []).forEach(n => { const e = 'V(' + n + ')'; if (!have.has(e.toLowerCase())) { A.traces.push({ expr: e }); have.add(e.toLowerCase()); } });
    A.traces = A.traces.filter(t => { try { evalTrace(t.expr, r); return true; } catch (e) { return false; } });
    updatePlot(false); renderAll();
    if (!A.traces.length) { if (!isNet()) A.setTool('probe'); A.status(isNet() ? 'Done — pick signals to plot in the Signals tab' : 'Done — click a net to plot its voltage'); Aero.toast(isNet() ? 'Done — pick signals to plot in the Signals tab' : 'Done — click nets or parts to plot them', 3000); if (isNet()) showTab('signals'); }
    else { A.status('Done'); showTab('traces'); }
  }

  // ---------- traces ----------
  function vectorIndex(r) { if (!r._idx) { r._idx = new Map(); Object.keys(r.vectors).forEach(k => r._idx.set(k.toLowerCase(), k)); } return r._idx; }
  function signalVec(r, fn, args) {
    const idx = vectorIndex(r), get = name => { const k = idx.get(name.toLowerCase()); if (!k) throw new Error('Unknown signal ' + name); return r.vectors[k]; };
    const zero = () => r.complex ? { re: new Float64Array(r.x.length), im: new Float64Array(r.x.length) } : new Float64Array(r.x.length);
    if (fn === 'V') {
      const one = n => /^(0|gnd)$/i.test(n) ? zero() : get('V(' + n + ')');
      if (args.length === 1) return one(args[0]);
      const a = one(args[0]), b = one(args[1]);
      if (r.complex) return { re: a.re.map((v, i) => v - b.re[i]), im: a.im.map((v, i) => v - b.im[i]) };
      return a.map((v, i) => v - b[i]);
    }
    return get(fn + '(' + args[0] + ')');
  }
  function evalTrace(expr, r) {
    const ast = Ex.parse(expr), sigs = Ex.signals(ast);
    if (!sigs.length) throw new Error('Trace needs at least one signal, e.g. V(out)');
    const vecs = sigs.map(([fn, args]) => signalVec(r, fn, args));
    const units = new Set(sigs.map(([fn]) => fn === 'V' ? 'V' : 'A')), unit = units.size === 1 ? [...units][0] : '';
    const n = r.x.length;
    if (!r.complex) {
      let y;
      if (ast[0] === 'sig') y = vecs[0];
      else { y = new Float64Array(n); for (let i = 0; i < n; i++) { let k = 0; y[i] = Ex.evalAst(ast, undefined, () => vecs[k++][i]); } }
      return { y, unit: ast[0] === 'sig' || /^[^*/]*$/.test(expr) ? unit : unit === 'V' && /\//.test(expr) ? '' : unit };
    }
    // complex evaluation for AC traces
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let i = 0; i < n; i++) { let k = 0; const z = evalC(ast, () => { const v = vecs[k++]; return [v.re[i], v.im[i]]; }); re[i] = z[0]; im[i] = z[1]; }
    const y = new Float64Array(n), ph = new Float64Array(n); let off = 0, prev = null;
    for (let i = 0; i < n; i++) { y[i] = 20 * Math.log10(Math.hypot(re[i], im[i]) || 1e-300); let p = Math.atan2(im[i], re[i]) * 180 / Math.PI; if (prev !== null) { while (p + off - prev > 180) off -= 360; while (p + off - prev < -180) off += 360; } p += off; ph[i] = p; prev = p; }
    return { y, ph, unit: 'dB', re, im };
  }
  function evalC(a, sig) {
    switch (a[0]) {
      case 'n': return [a[1], 0];
      case 'sig': return sig();
      case 'u': { const z = evalC(a[2], sig); return a[1] === '-' ? [-z[0], -z[1]] : z; }
      case 'b': { const x = evalC(a[2], sig), y = evalC(a[3], sig);
        if (a[1] === '+') return [x[0] + y[0], x[1] + y[1]]; if (a[1] === '-') return [x[0] - y[0], x[1] - y[1]];
        if (a[1] === '*') return [x[0] * y[0] - x[1] * y[1], x[0] * y[1] + x[1] * y[0]];
        if (a[1] === '/') { const d = y[0] * y[0] + y[1] * y[1]; return [(x[0] * y[0] + x[1] * y[1]) / d, (x[1] * y[0] - x[0] * y[1]) / d]; } }
      // fallthrough
      default: throw new Error('Only + − × ÷ are supported in AC trace expressions');
    }
  }
  function updatePlot(keepView = true) {
    const r = A.result; if (!r || r.analysis === 'op') { A.plotTraces = []; PlotView.set(null, []); return; }
    const traces = [];
    A.traces.forEach((t, k) => { try { const v = evalTrace(t.expr, r); traces.push({ name: t.expr, color: COLORS[k % COLORS.length], ...v }); t.color = COLORS[k % COLORS.length]; } catch (e) { t.error = e.message; } });
    PlotView.set(r, traces, keepView); A.plotTraces = traces;
  }
  A.probeColor = p => { const con = A.con(); if (!con || !A.result) return null; const pin = PL.pinsOf(p)[0]; const n = con.netAt(pin.x, pin.y); const t = A.traces.find(t => t.expr.toLowerCase() === ('v(' + n + ')').toLowerCase()); return t && t.color; };
  A.onProbe = expr => {
    if (!A.result || A.result.analysis === 'op') { Aero.toast('Run a transient, AC or DC simulation first (F5)'); return; }
    try { evalTrace(expr, A.result); } catch (e) { Aero.toast(e.message); return; }
    const exists = A.traces.findIndex(t => t.expr.toLowerCase() === expr.toLowerCase());
    if (exists >= 0) { PlotView.active = exists; renderTraceList(); return; }
    A.traces.push({ expr }); updatePlot(true); PlotView.active = A.traces.length - 1; renderTraceList(); SchEditor.draw(); autosave(); showTab('traces');
  };
  A.onTracesChanged = () => renderTraceList();
  A.onCursor = () => { renderTraceList(); renderStatus(); };
  function removeTrace(k) { A.traces.splice(k, 1); updatePlot(true); renderTraceList(); SchEditor.draw(); autosave(); }
  function measure(t) {
    const r = A.result; if (!r || !r.x) return ''; const x = r.x, cur = PlotView.cursors; let [a, b] = PlotView.xlim || [x[0], x[x.length - 1]];
    if (cur[0] != null && cur[1] != null) { a = Math.min(cur[0], cur[1]); b = Math.max(cur[0], cur[1]); }
    if (r.complex) {
      let mx = -Infinity, fm = 0; for (let i = 0; i < x.length; i++) if (x[i] >= a && x[i] <= b && t.y[i] > mx) { mx = t.y[i]; fm = x[i]; }
      let f3 = null; for (let i = 0; i < x.length; i++) if (x[i] > fm && t.y[i] < mx - 3) { const i0 = i - 1, fr = (mx - 3 - t.y[i0]) / (t.y[i] - t.y[i0]); f3 = Math.exp(Math.log(x[i0]) + fr * (Math.log(x[i]) - Math.log(x[i0]))); break; }
      return `peak ${mx.toFixed(2)} dB @ ${Ex.fmtEng(fm, 4, 'Hz')}\n−3 dB ${f3 ? '@ ' + Ex.fmtEng(f3, 4, 'Hz') : '—'}`;
    }
    let mn = Infinity, mx = -Infinity, s1 = 0, s2 = 0, T = 0, px = null, pv = null;
    const u = t.unit || '';
    for (let i = 0; i < x.length; i++) {
      if (x[i] < a || x[i] > b) continue; const v = t.y[i]; if (!Number.isFinite(v)) continue;
      mn = Math.min(mn, v); mx = Math.max(mx, v);
      if (px !== null) { const dt = x[i] - px; s1 += (v + pv) / 2 * dt; s2 += (v * v + v * pv + pv * pv) / 3 * dt; T += dt; }
      px = x[i]; pv = v;
    }
    if (mn === Infinity) return '';
    const avg = T > 0 ? s1 / T : mn, rms = T > 0 ? Math.sqrt(Math.max(0, s2 / T)) : Math.abs(mn);
    let freq = '';
    if (r.analysis === 'tran' && mx - mn > 1e-12) {
      const lvl = (mx + mn) / 2, h = (mx - mn) * 0.1, times = []; let armed = false;
      for (let i = 1; i < x.length; i++) { if (x[i] < a || x[i] > b) continue; const v = t.y[i], v0 = t.y[i - 1]; if (v < lvl - h) armed = true; if (armed && v0 < lvl && v >= lvl) { times.push(x[i - 1] + (lvl - v0) / (v - v0) * (x[i] - x[i - 1])); armed = false; } }
      if (times.length >= 2) freq = `  f ${Ex.fmtEng((times.length - 1) / (times[times.length - 1] - times[0]), 4, 'Hz')}`;
    }
    return `min ${Ex.fmtEng(mn, 4, u)}  max ${Ex.fmtEng(mx, 4, u)}\np-p ${Ex.fmtEng(mx - mn, 4, u)}  avg ${Ex.fmtEng(avg, 4, u)}\nrms ${Ex.fmtEng(rms, 4, u)}${freq}`;
  }
  function renderTraceList() {
    const el = $('traceList'); el.innerHTML = '';
    if (!A.traces.length) { el.innerHTML = `<div class="aero-pane dim small">No traces. ${A.result ? 'Click nets or parts with the probe (P), pick from Signals, or Plot → Add trace.' : 'Run a simulation (F5) first.'}</div>`; $('readout').textContent = ''; return; }
    const pts = A.plotTraces || [], cc = PlotView.cursors;
    if (pts.length) el.appendChild(Aero.el('div', 'mnote', cc[0] != null && cc[1] != null ? 'Measured between cursor 1 and cursor 2' : 'Measured over the visible range — zoom or set both cursors to narrow it'));
    A.traces.forEach((t, k) => {
      const pt = pts.find(p => p.name === t.expr), d = Aero.el('div', 'aero-item trace' + (k === PlotView.active ? ' sel' : ''));
      d.innerHTML = `<i style="background:${t.color || COLORS[k % COLORS.length]}"></i><span class="nm" title="${esc(t.expr)}">${esc(t.expr)}</span><span class="x" title="Remove trace">✕</span><div class="ms">${pt ? esc(measure(pt)) : esc(t.error || '')}</div>`;
      d.onclick = e => { if (e.target.classList.contains('x')) { removeTrace(k); return; } PlotView.active = k; renderTraceList(); };
      el.appendChild(d);
    });
    // cursor readout
    const c = PlotView.cursors, r = A.result; let out = '';
    if (r && (c[0] != null || c[1] != null)) {
      const unitX = r.complex ? 'Hz' : r.analysis === 'tran' ? 's' : (/^i/i.test(r.xname) ? 'A' : 'V'), f = (v, u) => Ex.fmtEng(v, 5, u);
      out += c.map((v, k) => v == null ? '' : `Cursor ${k + 1}: ${f(v, unitX)}`).filter(Boolean).join('   ') + '\n';
      if (c[0] != null && c[1] != null) out += `Δ ${f(c[1] - c[0], unitX)}${r.analysis === 'tran' && c[1] !== c[0] ? '  (1/Δ ' + f(1 / Math.abs(c[1] - c[0]), 'Hz') + ')' : ''}\n`;
      pts.forEach(t => {
        const vals = c.map(v => v == null ? null : PlotView.valueAt(t, v));
        const s = vals.map(v => v == null ? '' : r.complex ? `${v.toFixed(2)} dB` : f(v, t.unit)).filter(Boolean).join(' → ');
        out += `${t.name}: ${s}${vals[0] != null && vals[1] != null && !r.complex ? '  Δ ' + f(vals[1] - vals[0], t.unit) : ''}`;
        if (r.complex) out += '  ∠ ' + c.filter(v => v != null).map(v => PlotView.valueAt(t, v, 'ph').toFixed(1) + '°').join(' → ');
        out += '\n';
      });
    }
    $('readout').textContent = out.trim();
  }
  function renderSignals() {
    const el = $('sigList'); el.innerHTML = ''; const r = A.result;
    if (!r) { el.innerHTML = '<div class="aero-pane dim small">Run a simulation to list its signals.</div>'; return; }
    const q = $('sigSearch').value.trim().toLowerCase();
    Object.keys(r.vectors).filter(k => !q || k.toLowerCase().includes(q)).slice(0, 2000).forEach(k => {
      const v = r.vectors[k], d = Aero.el('div', 'aero-item sig');
      const val = r.analysis === 'op' ? Ex.fmtEng(v[0], 5, /^V/.test(k) ? 'V' : 'A') : '';
      d.innerHTML = `<span>${esc(k)}</span><span class="v">${esc(val)}</span>`;
      if (r.analysis !== 'op') d.onclick = () => A.onProbe(k);
      el.appendChild(d);
    });
  }
  function renderOutput() {
    const el = $('outList'); el.innerHTML = '';
    A.messages.forEach(m => { const d = Aero.el('div', 'aero-item msg ' + m.kind, `<b>${{ err: 'Error', warn: 'Warning', ok: 'Done' }[m.kind]}:</b> ${esc(m.text)}`); el.appendChild(d); });
    const r = A.result;
    if (r && r.analysis === 'op') {
      const rows = Object.entries(r.op).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num">${esc(Ex.fmtEng(v, 6, /^V/.test(k) ? 'V' : 'A'))}</td></tr>`).join('');
      el.appendChild(Aero.el('div', 'aero-pane', `<table class="optab">${rows}</table>`));
    }
    if (!el.children.length) el.innerHTML = '<div class="aero-pane dim small">Simulation messages and operating-point results appear here.</div>';
  }
  function showTab(t) { document.querySelectorAll('#tabs .aero-tab').forEach(x => x.classList.toggle('on', x.dataset.t === t)); ['traces', 'signals', 'output', 'dir'].forEach(k => { $('tab-' + k).hidden = k !== t; }); }

  // ---------- files ----------
  const NET_EXT = /\.(cir|net|sp|spi|spice|ckt|txt)$/i;
  async function openFiles(files) {
    const f = files && files[0]; if (!f) return;
    if (!await confirmDiscard()) return;
    const text = new TextDecoder().decode(f.data), base = f.name.replace(/\.[^.]+$/, '');
    try {
      if (/\.asc$/i.test(f.name)) { Aero.alert('LTspice schematic', 'LTspice .asc schematics are not supported. In LTspice use View → SPICE Netlist, save it as a .cir/.net file and open that here.'); return; }
      if (/\.lpcb$/i.test(f.name) || (/^\s*\{/.test(text) && /"lumen-pcb"/.test(text))) return importLpcbText(text, base);
      if (/\.(lspice|json)$/i.test(f.name) || /^\s*\{/.test(text)) {
        const j = JSON.parse(text);
        if (j.format && j.format !== 'lumen-spice') throw new Error('Not a Lumen Spice project');
        load(j.doc || j, base, f.path); Aero.toast('Opened ' + f.name); return;
      }
      if (NET_EXT.test(f.name) || /^\s*[*.a-z]/im.test(text)) { openNetlistText(text, base, f.path); return; }
      throw new Error('Unknown file type');
    } catch (e) { Aero.alert('Open', `Could not open ${f.name}: ${e.message}`); }
  }
  function openNetlistText(text, base, path) {
    load({ netlist: text.replace(/\r\n?/g, '\n'), title: base, sim: '' }, base, null);
    A.netPath = path; Aero.toast('Opened SPICE netlist — Run (F5) to simulate it');
  }
  function importLpcbText(text, base) {
    const { doc, skipped } = S.fromLpcb(text);
    load(doc, base + ' (from PCB)'); Aero.setDirty(true);
    Aero.alert('Imported from Lumen PCB', `${doc.parts.filter(p => p.type !== 'GND').length} parts mapped to simulation models, nets kept as labels. Each power rail got a voltage source.` + (skipped.length ? `\n\nNot simulated (no model):\n• ${skipped.join('\n• ')}` : '') + '\n\nSet the analysis (Simulate → Edit simulation command) and press F5.');
  }
  async function confirmDiscard() { if (!window.__lumenDirty) return true; return Aero.confirm('Discard changes?', `${A.docName} has unsaved changes. Continue anyway?`, 'Discard'); }
  async function save(as) {
    if (isNet()) A.doc.netlist = $('netText').value;
    const data = JSON.stringify({ format: 'lumen-spice', version: 1, doc: { ...A.doc, traces: A.traces.map(t => t.expr) } });
    const p = await Aero.saveFile({ name: A.docName.replace(/[\\/:*?"<>|]+/g, '_') + '.lspice', data, filters: [{ name: 'Lumen Spice project', extensions: ['lspice'] }], path: as ? null : A.filePath });
    if (p) { if (typeof p === 'string' && /[\\/]/.test(p)) A.filePath = p; A.docName = String(p).split(/[\\/]/).pop().replace(/\.lspice$/i, ''); Aero.setDoc(A.docName, false); return true; }
    return false;
  }
  async function exportNetlist() {
    let text; try { text = buildNetlist().text; } catch (e) { return Aero.alert('Export netlist', e.message); }
    await Aero.saveFile({ name: A.docName.replace(/[\\/:*?"<>|]+/g, '_') + '.cir', data: text, filters: [{ name: 'SPICE netlist', extensions: ['cir', 'net', 'sp'] }] });
  }
  async function exportCsv() {
    const r = A.result; if (!r || r.analysis === 'op') { if (r) { const rows = Object.entries(r.op).map(([k, v]) => `${k},${v}`); return Aero.saveFile({ name: A.docName + '-op.csv', data: 'signal,value\r\n' + rows.join('\r\n') + '\r\n', filters: [{ name: 'CSV', extensions: ['csv'] }] }); } return Aero.alert('Export waveforms', 'Run a simulation first.'); }
    const traces = A.plotTraces && A.plotTraces.length ? A.plotTraces : Object.keys(r.vectors).map(k => ({ name: k, ...evalTrace(k, r) }));
    const head = [r.complex ? 'frequency' : r.analysis === 'tran' ? 'time' : r.xname];
    traces.forEach(t => { if (r.complex) head.push(t.name + ' re', t.name + ' im', t.name + ' dB', t.name + ' phase'); else head.push(t.name); });
    const lines = [head.map(h => /[",]/.test(h) ? `"${h.replace(/"/g, '""')}"` : h).join(',')];
    for (let i = 0; i < r.x.length; i++) { const row = [r.x[i]]; traces.forEach(t => { if (r.complex) row.push(t.re[i], t.im[i], t.y[i], t.ph[i]); else row.push(t.y[i]); }); lines.push(row.map(v => +v.toPrecision(9)).join(',')); }
    await Aero.saveFile({ name: A.docName + '-' + r.analysis + '.csv', data: lines.join('\r\n') + '\r\n', filters: [{ name: 'CSV', extensions: ['csv'] }] });
  }
  async function exportPng(which) { const c = which === 'plot' ? PlotView.canvas() : (isNet() ? null : SchEditor.image()); if (!c) return; const blob = await new Promise(r => c.toBlob(r, 'image/png')); await Aero.saveFile({ name: A.docName + (which === 'plot' ? '-plot' : '-schematic') + '.png', data: blob, filters: [{ name: 'PNG image', extensions: ['png'] }] }); }
  async function newDoc(netlist) {
    if (!await confirmDiscard()) return;
    if (netlist) load({ netlist: '* My circuit\nV1 in 0 PULSE(0 5 0 1u 1u 0.5m 1m)\nR1 in out 1k\nC1 out 0 100n\n.tran 5m\n.end\n', title: 'Untitled netlist' }, 'Untitled netlist');
    else load({ title: 'Untitled', sim: '.tran 10m' }, 'Untitled');
  }
  function openSample(id) { const s = SpiceSamples.SAMPLES[id]; load(s.make(), s.name); setTimeout(run, 30); }
  async function importNetlistAsSchematic() {
    const f = (await Aero.openFile({ accept: '.cir,.net,.sp,.spi,.txt', filters: [{ name: 'SPICE netlist', extensions: ['cir', 'net', 'sp', 'spi', 'txt'] }] }))[0]; if (!f) return;
    convertText(new TextDecoder().decode(f.data), f.name.replace(/\.[^.]+$/, ''));
  }
  function convertText(text, base) {
    try {
      const { doc, skipped, warnings } = S.fromNetlist(text); load(doc, base); Aero.setDirty(true);
      const notes = [...skipped, ...warnings]; if (notes.length) Aero.alert('Converted to schematic', 'Parts are laid out on a grid and joined by net labels.\n\n' + notes.join('\n')); else Aero.toast('Converted — parts are joined by net labels');
    } catch (e) { Aero.alert('Convert netlist', e.message); }
  }
  function showNetlist() {
    let text; try { text = buildNetlist().text; } catch (e) { return Aero.alert('SPICE netlist', e.message); }
    Aero.dialog({ title: 'SPICE netlist', instruction: 'This is exactly what the simulator runs. File → Export → SPICE netlist saves it for LTspice or ngspice.', fields: [{ key: 't', label: '', type: 'textarea', mono: true, rows: 20, value: text }], noCancel: true, width: 640 });
  }

  // ---------- help ----------
  function shortcuts() {
    const rows = [['F5', 'Run simulation'], ['Esc', 'Stop the current tool / select'], ['W  /  F3', 'Wire'], ['N  /  F4', 'Net label'], ['P', 'Probe (click a net to plot it)'], ['R C L D V I', 'Resistor, capacitor, inductor, diode, voltage / current source'], ['Q  M  A  G', 'NPN, N-MOSFET, op-amp, ground'], ['Ctrl+R / Ctrl+E', 'Rotate / mirror (also while placing)'], ['/', 'Flip the wire corner'], ['Delete', 'Delete selection'], ['Ctrl+C / Ctrl+V', 'Copy / paste'], ['Ctrl+A', 'Select all'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+T', 'Edit simulation command'], ['Ctrl+L', 'Show SPICE netlist'], ['Home', 'Fit schematic'], ['Ctrl+= / Ctrl+−', 'Zoom in / out'], ['1 / 2', 'Toggle plot cursor 1 / 2'], ['Plot: drag', 'Zoom to box (double-click fits)'], ['Plot: wheel / Shift+wheel', 'Zoom time / value axis'], ['Plot: right-drag', 'Pan'], ['Right-drag / Space-drag', 'Pan the schematic']];
    Aero.dialog({ title: 'Keyboard shortcuts', html: `<table class="keys">${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`, noCancel: true, width: 470 });
  }
  function quickRef() {
    Aero.dialog({ title: 'SPICE quick reference', width: 560, noCancel: true, html: `<div class="ref small">
<b>Elements</b><pre>R1 a b 4.7k         C1 a b 10u IC=0     L1 a b 1m
V1 a 0 PULSE(V1 V2 Tdelay Trise Tfall Ton Tperiod [Ncycles])
V2 a 0 SIN(Voffset Vamp Freq [Tdelay Theta Phase])   V3 a 0 DC 0 AC 1
V4 a 0 PWL(0 0 1m 5 2m 0)   I1 a b 1m (flows a→b through the source)
D1 anode cathode 1N4148     Q1 c b e 2N3904     M1 d g s b NMOS W=10u L=1u
E1 o+ o- c+ c- gain   G1 o+ o- c+ c- gm   F1 o+ o- Vctl gain   H1 o+ o- Vctl r
S1 a b c+ c- SWMODEL       X1 n1 n2 … SUBNAME k=v
K1 L1 L2 0.99  (coupled inductors — put it in the Directives tab)</pre>
<b>Directives</b><pre>.tran 10m [Tstart [Tmaxstep]] [uic]   .ac dec 50 10 1Meg
.dc V1 0 5 10m   .op   .ic V(out)=0   .options reltol=1e-4 method=euler
.model DX D(IS=1e-14 N=1.8 RS=1 CJO=2p BV=50)
.model QX NPN(IS=1e-15 BF=200 VAF=80 CJE=5p CJC=3p TF=0.4n)
.model MX NMOS(VTO=0.7 KP=120u LAMBDA=0.02)   .model SX SW(RON=1 ROFF=1Meg VT=2.5 VH=0.2)
.param R=4.7k  (use as {R*2})   .subckt NAME pins… [params: k=v] … .ends</pre>
<b>Suffixes</b> f p n u m k meg g t · "4k7" = 4.7k · trailing units (F, H, V, Hz, Ω) are ignored. <b>Traces</b> accept expressions such as V(out)-V(in), V(out)/V(in) (AC), I(R1)*1k.</div>` });
  }
  function gettingStarted() {
    Aero.alert('Getting started with Lumen Spice', '1. Place parts from the toolbox (R, C, L, D, V…). Ctrl+R rotates while placing, Esc stops.\n2. Draw wires (W): click, click to bend, finish on a pin or wire. Name nets with labels (N) and add a ground (G) — every circuit needs one.\n3. Double-click a part to set its value, model or waveform (sources: DC, PULSE, SINE, PWL, EXP, AC amplitude).\n4. Choose the analysis in the command bar (transient, AC, DC sweep, operating point) and press Run (F5).\n5. Click nets and parts with the probe to plot voltages and currents. Turn on cursors (1, 2) for readouts; the Traces tab shows min/max/rms/frequency.\n\nOpen a ready-made circuit from File → Samples, or open a SPICE netlist (.cir/.net) or a Lumen PCB schematic (.lpcb).');
  }

  // ---------- menus ----------
  const samplesMenu = Object.entries(SpiceSamples.SAMPLES).map(([id, s]) => [s.name, '', () => openSample(id)]);
  const partsMenu = PL.PARTS.filter(p => !['GND'].includes(p.id)).map(p => [p.name, '', () => A.setTool('p:' + p.id)]);
  Aero.init({ name: 'Lumen Spice', icon: '../kit/icons/spice.png', doc: 'Untitled', onDropFiles: openFiles, dropText: 'Drop a .lspice project, SPICE netlist (.cir/.net) or Lumen PCB file', onSave: () => save(false),
    menus: {
      File: [['New schematic', 'Ctrl+N', () => newDoc(false)], ['New SPICE netlist (text)', '', () => newDoc(true)], ['Open…', 'Ctrl+O', async () => openFiles(await Aero.openFile({ accept: '.lspice,.json,.cir,.net,.sp,.spi,.txt,.lpcb', filters: [{ name: 'Lumen Spice / SPICE / Lumen PCB', extensions: ['lspice', 'cir', 'net', 'sp', 'spi', 'lpcb'] }] }))],
        '#Samples', ...samplesMenu, '-',
        ['Save', 'Ctrl+S', () => save(false)], ['Save as…', 'Ctrl+Shift+S', () => save(true)], '-', '#Import',
        ['SPICE netlist as schematic…', '', importNetlistAsSchematic], ['Lumen PCB schematic (.lpcb)…', '', async () => { const f = (await Aero.openFile({ accept: '.lpcb', filters: [{ name: 'Lumen PCB project', extensions: ['lpcb'] }] }))[0]; if (f) { try { importLpcbText(new TextDecoder().decode(f.data), f.name.replace(/\.[^.]+$/, '')); } catch (e) { Aero.alert('Import', e.message); } } }], '#Export',
        ['SPICE netlist (.cir)…', '', exportNetlist], ['Waveforms (.csv)…', '', exportCsv], ['Plot image (.png)…', '', () => exportPng('plot')], ['Schematic image (.png)…', '', () => exportPng('sch')]],
      Edit: [['Undo', 'Ctrl+Z', () => { restore(hist.undo()); }], ['Redo', 'Ctrl+Y', () => { restore(hist.redo()); }], '-',
        ['Copy', 'Ctrl+C', () => { if (!isNet()) SchEditor.copy(); }], ['Paste', 'Ctrl+V', () => { if (!isNet()) SchEditor.paste(); }], ['Delete', 'Delete', () => { if (!isNet()) SchEditor.deleteSel(); }], ['Select all', 'Ctrl+A', () => { if (!isNet()) SchEditor.selectAll(); }], '-',
        ['Rotate', 'Ctrl+R', () => SchEditor.rotateSel()], ['Mirror', 'Ctrl+E', () => SchEditor.mirrorSel()], ['Properties…', '', () => { const p = [...A.sel.parts]; if (p.length === 1) A.editPart(p[0]); }], '-',
        { label: 'Convert netlist to schematic', fn: () => { if (isNet()) convertText($('netText').value, A.docName); }, disabled: () => !isNet() }],
      View: [['Zoom in', 'Ctrl+=', () => SchEditor.zoom(1.25)], ['Zoom out', 'Ctrl+-', () => SchEditor.zoom(0.8)], ['Fit schematic', 'Home', () => SchEditor.fit()], ['100%', 'Ctrl+0', () => SchEditor.zoom100()], '-',
        { label: 'Grid', checked: () => A.showGrid, fn: () => { A.showGrid = !A.showGrid; SchEditor.draw(); } }, ['SPICE netlist…', 'Ctrl+L', showNetlist]],
      Place: [['Wire', 'F3', () => A.setTool('wire')], ['Net label', 'F4', () => A.setTool('label')], ['Ground', '', () => A.setTool('p:GND')], '-', ...partsMenu, '-', ['Part browser…', '', partPicker]],
      Simulate: [['Run', 'F5', run], { label: 'Stop', fn: stop, disabled: () => !A.running }, '-', ['Edit simulation command…', 'Ctrl+T', () => simDialog()], '#Analysis', ['Transient…', '', () => simDialog('tran')], ['AC sweep…', '', () => simDialog('ac')], ['DC sweep…', '', () => simDialog('dc')], ['Operating point', '', () => simDialog('op')], '-', ['Probe tool', '', () => A.setTool('probe')]],
      Plot: [['Fit', '', () => PlotView.fit()], ['Zoom in', '', () => PlotView.zoom(0.6)], ['Zoom out', '', () => PlotView.zoom(1.6)], '-', ['Cursor 1', '1', () => PlotView.toggleCursor(0)], ['Cursor 2', '2', () => PlotView.toggleCursor(1)], '-',
        ['Add trace…', '', async () => { if (!A.result) return Aero.toast('Run a simulation first'); const e = await Aero.prompt('Add trace', 'Expression, e.g. V(out), V(out)-V(in), I(R1)*1k', ''); if (e) A.onProbe(e.trim()); }],
        ['Remove selected trace', '', () => { if (A.traces.length) removeTrace(Math.min(PlotView.active, A.traces.length - 1)); }], ['Clear all traces', '', () => { A.traces = []; updatePlot(true); renderTraceList(); SchEditor.draw(); }]],
      Help: [['Getting started', '', gettingStarted], ['SPICE quick reference', '', quickRef], ['Keyboard shortcuts', '', shortcuts], ['About Lumen Spice', '', () => Aero.alert('Lumen Spice', 'Free circuit simulator in the spirit of LTspice: schematic capture and a modified-nodal-analysis SPICE engine — operating point, DC sweep, AC (Bode) and transient analysis with adaptive time steps, Newton–Raphson with junction limiting, diodes, BJTs (Gummel–Poon), level-1 MOSFETs, op-amp macro model, switches and controlled sources. Reads and writes SPICE netlists and imports Lumen PCB schematics.')]],
    } });
  tb = Aero.toolbox($('tools'), TOOLS, id => { if (id && !(A.tool === 'place' && 'p:' + A.placing.type === id) && A.tool !== id) A.setTool(id); });
  Aero.shortcut('F3', () => A.setTool('wire')); Aero.shortcut('F4', () => A.setTool('label'));
  Aero.shortcut('Escape', () => { if (A.running) return; if (!SchEditor.cancel()) A.sel = SchEditor.emptySel(); renderStatus(); });
  Aero.shortcut('/', () => SchEditor.toggleBend());
  Aero.shortcut('Backspace', () => { if (!isNet()) SchEditor.deleteSel(); });
  $('bRun').onclick = run; $('bStop').onclick = stop; $('bSim').onclick = () => simDialog();
  $('simType').onchange = () => simDialog($('simType').value);
  $('simCard').onchange = () => setCard($('simCard').value.trim());
  $('simCard').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); } };
  $('bRot').onclick = () => SchEditor.rotateSel(); $('bMir').onclick = () => SchEditor.mirrorSel();
  $('bC1').onclick = () => PlotView.toggleCursor(0); $('bC2').onclick = () => PlotView.toggleCursor(1); $('bFitPlot').onclick = () => PlotView.fit();
  document.querySelectorAll('#tabs .aero-tab').forEach(t => t.onclick = () => { showTab(t.dataset.t); if (t.dataset.t === 'signals') renderSignals(); });
  $('sigSearch').oninput = renderSignals;
  $('dirText').onchange = () => A.commit('Edit directives', d => { d.directives = $('dirText').value; });
  let netT; $('netText').oninput = () => { clearTimeout(netT); netT = setTimeout(() => { const v = $('netText').value; if (v !== A.doc.netlist) { A.commit('Edit netlist', d => { d.netlist = v; }); syncSimUi(); } }, 600); };
  // splitter between schematic and plot
  (() => {
    const sp = $('splitter'), st = $('stage'), pl = $('plotPane'); let drag = null;
    sp.onpointerdown = e => { drag = { y: e.clientY, h: st.getBoundingClientRect().height, tot: st.getBoundingClientRect().height + pl.getBoundingClientRect().height }; sp.setPointerCapture(e.pointerId); };
    sp.onpointermove = e => { if (!drag) return; const h = Math.max(100, Math.min(drag.tot - 80, drag.h + e.clientY - drag.y)); st.style.flex = `0 0 ${h}px`; pl.style.flex = '1 1 0'; };
    sp.onpointerup = () => { drag = null; };
  })();
  SchEditor.attach(A, $('cv')); PlotView.attach(A, $('pcv'));
  new ResizeObserver(() => { if (!isNet()) SchEditor.draw(); PlotView.draw(); }).observe($('split'));
  let start = null; try { const j = JSON.parse(localStorage.getItem(AUTOSAVE) || 'null'); if (j && j.doc && (Array.isArray(j.doc.parts) || typeof j.doc.netlist === 'string')) start = j; } catch (e) { }
  if (start && (start.doc.parts?.length || start.doc.netlist)) { load(start.doc, start.name); Aero.setDirty(true); }
  else { const s = SpiceSamples.SAMPLES.ce; load(s.make(), s.name); setTimeout(run, 50); }
})();
