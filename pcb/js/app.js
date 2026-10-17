// Lumen PCB — schematic capture and two-layer board layout, in the spirit of Altium Designer.
(function () {
  const Core = window.PcbCore, LIB = window.PcbLib, $ = id => document.getElementById(id), esc = s => Aero.esc(String(s ?? ''));
  const AUTOSAVE = 'lumen-pcb-autosave';
  const A = window.PcbApp = {
    doc: null, mode: 'sch', tool: 'select', sel: null, placing: null, messages: [], msgKind: '', pinNet: new Map(), rats: { lines: [], unroutedNets: 0, totalNets: 0 },
    layers: { top: true, bottom: true, silk: true, rats: true }, layer: 'top', trackW: 0.25, grid: 0.635, docName: 'Untitled', filePath: null,
  };
  const hist = new Aero.History({ max: 100 });

  // ---------- state ----------
  function normalize(d) {
    d.sch = d.sch || {}; d.sch.parts = d.sch.parts || []; d.sch.wires = d.sch.wires || []; d.sch.labels = d.sch.labels || [];
    d.board = d.board || {}; const b = d.board; b.w = b.w || 60; b.h = b.h || 40; b.parts = b.parts || []; b.tracks = b.tracks || []; b.vias = b.vias || [];
    b.rules = { clearance: 0.2, track: 0.2, drill: 0.3, edge: 0.3, viaDia: 0.8, viaDrill: 0.4, ...(b.rules || {}) };
    return d;
  }
  function recompute() { const nl = Core.netlist(A.doc.sch); A.netlist = nl; A.pinNet = nl.pinNet; A.refreshRats(); }
  A.refreshRats = () => { A.rats = Core.ratsnest(A.doc.board, A.pinNet); };
  function load(d, name, path) {
    A.doc = normalize(d); A.docName = name || d.name || 'Untitled'; A.filePath = path || null; A.sel = null; A.messages = []; A.msgKind = '';
    recompute(); hist.reset('Open', JSON.stringify(A.doc)); Aero.setDoc(A.docName, false);
    SchEditor.fit(); BoardEditor.fit(); render();
  }
  A.commit = (label, fn) => {
    const before = JSON.stringify(A.doc); fn(A.doc); normalize(A.doc);
    if (JSON.stringify(A.doc) === before) { render(); return; }
    recompute(); if (A.msgKind) runCheck(A.msgKind, true);
    hist.push(label, JSON.stringify(A.doc)); autosave(); render();
  };
  A.commitMoved = (label, before) => { recompute(); if (A.msgKind) runCheck(A.msgKind, true); if (JSON.stringify(A.doc) !== before) { hist.push(label, JSON.stringify(A.doc)); autosave(); } render(); };
  function restore(s) { if (!s) return; A.doc = JSON.parse(s); A.sel = null; recompute(); if (A.msgKind) runCheck(A.msgKind, true); autosave(); render(); }
  let saveT; function autosave() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(AUTOSAVE, JSON.stringify({ name: A.docName, doc: A.doc })); } catch (e) { } }, 400); }

  // ---------- rendering ----------
  A.status = s => { $('st1').textContent = s; };
  function render() {
    (A.mode === 'sch' ? SchEditor : BoardEditor).draw();
    renderProps(); renderMsgs();
    const sch = A.doc.sch, parts = sch.parts.filter(p => !LIB.PART[p.lib].power);
    $('st2').textContent = `${parts.length} parts · ${A.netlist.nets.length} nets`;
    $('st3').textContent = A.mode === 'pcb' ? `${A.doc.board.w} × ${A.doc.board.h} mm · ${A.rats.totalNets - A.rats.unroutedNets}/${A.rats.totalNets} nets routed · ${A.doc.board.tracks.length} tracks · ${A.doc.board.vias.length} vias` : `${sch.wires.length} wires · ${sch.labels.length} labels`;
    $('hint').textContent = hintText();
  }
  A.render = render;
  function hintText() {
    if (A.mode === 'sch') return { wire: 'Click to start, click to bend, end on a pin or wire. / flips the bend · Esc finishes', label: 'Click a wire end or pin to name its net', place: 'Click to place · R rotate · M mirror · Esc done' }[A.tool] || 'Drag parts to move (wires follow) · double-click to edit · Space-drag or right-drag pans';
    return { route: 'Click a pad to start · click to add corners · end on a pad · V = via + switch layer · / = 45° mode · Esc ends', via: 'Click to drop a via', measure: 'Click two points to measure' }[A.tool] || 'Drag footprints · R rotate · F flip to bottom · white lines = unrouted connections';
  }

  // ---------- library ----------
  function symThumb(def) {
    const c = document.createElement('canvas'); c.width = 46; c.height = 30; const g = c.getContext('2d');
    const p = { lib: def.id, x: 0, y: 0, rot: 0, value: def.value };
    const b = SchEditor.partBox(p); const s = Math.min(40 / (b[2] - b[0]), 24 / (b[3] - b[1]), 6);
    g.translate(23 - (b[0] + b[2]) / 2 * s, 15 - (b[1] + b[3]) / 2 * s); g.scale(s, s); g.lineWidth = 1.5 / s; g.strokeStyle = '#8b1d1d'; g.fillStyle = '#fff9e0'; g.lineCap = 'round';
    def.sym.draw.forEach(d => { g.beginPath(); if (d[0] === 'line') { g.moveTo(d[1], d[2]); g.lineTo(d[3], d[4]); g.stroke(); } else if (d[0] === 'rect') { g.rect(d[1], d[2], d[3] - d[1], d[4] - d[2]); g.fill(); g.stroke(); } else if (d[0] === 'circle') { g.arc(d[1], d[2], d[3], 0, 7); g.stroke(); } else if (d[0] === 'poly') { d[1].forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); g.fillStyle = '#8b1d1d'; g.fill(); g.fillStyle = '#fff9e0'; } });
    if (def.sym.pinLen) def.sym.pins.forEach(q => { g.beginPath(); g.moveTo(q.x, q.y); g.lineTo(q.x - Math.sign(q.x) * (Math.abs(q.x) > Math.abs(q.y) ? def.sym.pinLen : 0), q.y - (Math.abs(q.x) > Math.abs(q.y) ? 0 : Math.sign(q.y) * def.sym.pinLen)); g.stroke(); });
    return c;
  }
  function renderLib() {
    const q = $('libSearch').value.trim().toLowerCase(), list = $('lib'); list.innerHTML = '';
    const items = LIB.PARTS.filter(p => !q || (p.name + ' ' + p.id + ' ' + p.value + ' ' + (p.fps || []).join(' ')).toLowerCase().includes(q));
    items.forEach(def => {
      const d = Aero.el('div', 'aero-item libitem' + (A.placing && A.placing.lib === def.id ? ' sel' : ''));
      d.appendChild(symThumb(def)); const nm = Aero.el('div', 'nm', `${esc(def.name)}<small>${esc(def.power ? 'power port' : (def.fps || []).join(', '))}</small>`); d.appendChild(nm);
      d.onclick = () => startPlace(def.id); list.appendChild(d);
    });
    $('libCount').textContent = items.length;
  }
  async function startPlace(lib) {
    const def = LIB.PART[lib]; if (A.mode !== 'sch') setMode('sch');
    let value = def.value;
    if (lib === 'VCC') { value = await Aero.prompt('Power rail', 'Net name', A.lastRail || '+5V'); if (!value) return; A.lastRail = value; }
    A.placing = { lib, value, fp: def.fps ? def.fps[0] : null, rot: 0, mirror: false }; A.setTool('place'); renderLib();
  }

  // ---------- properties ----------
  function renderProps() {
    const el = $('props'), s = A.sel;
    if (A.mode === 'sch' && s && s.kind === 'part') {
      const p = A.doc.sch.parts[s.i], def = LIB.PART[p.lib]; if (!p) { el.innerHTML = ''; return; }
      el.innerHTML = `<div class="pform"><label>Part</label><span class="ro">${esc(def.name)}</span>
        ${def.power ? '' : `<label>Reference</label><input data-f="ref" value="${esc(p.ref)}">`}
        <label>${def.power ? 'Net' : 'Value'}</label><input data-f="value" value="${esc(p.value)}">
        ${def.fps ? `<label>Footprint</label><select data-f="fp">${def.fps.map(f => `<option ${f === p.fp ? 'selected' : ''}>${f}</option>`).join('')}</select>` : ''}
        <label>Rotation</label><span class="ro">${(p.rot || 0) * 90}°${p.mirror ? ' · mirrored' : ''} <button class="aero-btn small" id="pRot">Rotate</button></span>
        ${def.power ? '' : `<label>Net of pins</label><span class="ro">${Core.pinsOf(p).map(q => `${q.n}${q.name ? ' ' + q.name : ''}: ${esc(A.pinNet.get(p.ref + '.' + q.n) || '—')}`).join('<br>')}</span>`}</div>`;
      el.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => A.commit('Edit ' + inp.dataset.f, d => {
        const q = d.sch.parts[s.i], v = inp.value.trim(); if (!v) return;
        if (inp.dataset.f === 'ref') { const old = q.ref; if (d.sch.parts.some(o => o !== q && o.ref === v)) { Aero.toast('That reference is already used.'); return; } q.ref = v; const bp = d.board.parts.find(b => b.ref === old); if (bp) bp.ref = v; }
        else q[inp.dataset.f] = v;
      }));
      const r = $('pRot'); if (r) r.onclick = () => SchEditor.rotateSel();
      return;
    }
    if (A.mode === 'sch' && s && s.kind === 'label') { const l = A.doc.sch.labels[s.i]; el.innerHTML = `<div class="pform"><label>Net label</label><input id="lblName" value="${esc(l.name)}"></div>`; $('lblName').onchange = () => A.commit('Rename label', d => { d.sch.labels[s.i].name = $('lblName').value.trim() || l.name; }); return; }
    if (A.mode === 'pcb' && s && s.kind === 'fp') {
      const fp = A.doc.board.parts[s.i], sp = A.doc.sch.parts.find(p => p.ref === fp.ref);
      el.innerHTML = `<div class="pform"><label>Reference</label><span>${esc(fp.ref)} ${sp ? '· ' + esc(sp.value) : ''}</span><label>Footprint</label><span class="ro">${esc(fp.fp)}</span>
        <label>X (mm)</label><input data-f="x" type="number" step="0.01" value="${fp.x}"><label>Y (mm)</label><input data-f="y" type="number" step="0.01" value="${fp.y}">
        <label>Rotation</label><select data-f="rot">${[0, 90, 180, 270].map(r => `<option ${r === (fp.rot || 0) ? 'selected' : ''}>${r}</option>`).join('')}</select>
        <label>Side</label><select data-f="side"><option ${fp.side !== 'bottom' ? 'selected' : ''}>top</option><option ${fp.side === 'bottom' ? 'selected' : ''}>bottom</option></select></div>`;
      el.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => A.commit('Edit footprint', d => { const q = d.board.parts[s.i]; const f = inp.dataset.f; q[f] = f === 'side' ? inp.value : +inp.value; }));
      return;
    }
    if (A.mode === 'pcb' && s && s.kind === 'track') {
      const t = A.doc.board.tracks[s.i]; let len = 0; for (let k = 1; k < t.pts.length; k++) len += Math.hypot(t.pts[k][0] - t.pts[k - 1][0], t.pts[k][1] - t.pts[k - 1][1]);
      el.innerHTML = `<div class="pform"><label>Track</label><span>${esc(t.net || 'no net')}</span><label>Layer</label><select data-f="layer"><option ${t.layer === 'top' ? 'selected' : ''}>top</option><option ${t.layer === 'bottom' ? 'selected' : ''}>bottom</option></select>
        <label>Width (mm)</label><input data-f="w" type="number" min="0.1" step="0.05" value="${t.w}"><label>Length</label><span class="ro">${len.toFixed(2)} mm</span></div>`;
      el.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => A.commit('Edit track', d => { const q = d.board.tracks[s.i]; q[inp.dataset.f] = inp.dataset.f === 'w' ? Math.max(0.05, +inp.value) : inp.value; }));
      return;
    }
    if (A.mode === 'pcb') {
      const b = A.doc.board;
      const zones = (b.zones || []).map((z, i) => { const f = Core.fillZone(b, z, A.pinNet); return `<label>Pour ${i + 1}</label><span>${esc(z.net)} · ${z.layer} · ${z.clearance} mm gap · ${f.area.toFixed(0)} mm² <button class="aero-btn small" data-zdel="${i}">✕</button></span>`; }).join('');
      el.innerHTML = `<div class="pform">${zones}<label>Board</label><span>${b.w} × ${b.h} mm</span><label>Clearance</label><span class="ro">${b.rules.clearance} mm</span><label>Min track</label><span class="ro">${b.rules.track} mm</span><label>Via</label><span class="ro">${b.rules.viaDia} / ${b.rules.viaDrill} mm drill</span></div><button class="aero-btn small" id="bSetup" style="margin-top:6px">Board setup…</button>`;
      $('bSetup').onclick = boardSetup; el.querySelectorAll('[data-zdel]').forEach(x => x.onclick = () => A.commit('Remove pour', d => d.board.zones.splice(+x.dataset.zdel, 1))); return;
    }
    el.innerHTML = `<span class="dim">Pick a part from the library, or select something to edit it.</span>`;
  }

  // ---------- messages (ERC / DRC) ----------
  function runCheck(kind, quiet) {
    A.msgKind = kind;
    A.messages = kind === 'erc' ? Core.erc(A.doc.sch, A.netlist) : Core.drc(A.doc.board, A.pinNet);
    if (!quiet) { render(); Aero.toast(A.messages.length ? `${A.messages.length} issue${A.messages.length > 1 ? 's' : ''} found` : (kind === 'erc' ? 'Schematic check passed' : 'Design rule check passed')); }
  }
  function renderMsgs() {
    const list = $('msgs'); list.innerHTML = '';
    $('msgTitle').textContent = A.msgKind === 'erc' ? 'Schematic check (ERC)' : A.msgKind === 'drc' ? 'Design rule check (DRC)' : 'Messages';
    $('msgCount').textContent = A.msgKind ? A.messages.length : '';
    if (!A.msgKind) { list.appendChild(Aero.el('div', 'aero-item msg', `<span class="dim">Run <b style="color:inherit">Check</b> to list problems here.</span>`)); return; }
    if (!A.messages.length) { list.appendChild(Aero.el('div', 'aero-item msg ok', `<b>✓ No problems</b>`)); return; }
    A.messages.forEach(m => { const d = Aero.el('div', 'aero-item msg', `<b>${esc(m.type)}</b> ${esc(m.msg)}`); d.onclick = () => { if (m.x == null) return; const ed = A.mode === 'sch' ? SchEditor : BoardEditor; const v = ed.view; const s = A.mode === 'sch' ? 30 : 30; v.scale = Math.max(v.scale, s); v.ox = m.x - v.w / 2 / v.scale; v.oy = m.y - v.h / 2 / v.scale; ed.draw(); }; list.appendChild(d); });
  }

  // ---------- modes & tools ----------
  const TOOLS = [
    { id: 'select', title: 'Select / move (V)', icon: '<path d="M5 3l12 8-6 1-3 6z"/>', m: 'both' },
    null,
    { id: 'wire', title: 'Wire (W)', icon: '<path d="M3 17h7V7h11"/><circle cx="10" cy="17" r="1.5"/>', m: 'sch' },
    { id: 'label', title: 'Net label (L)', icon: '<path d="M4 7h11l5 5-5 5H4z"/>', m: 'sch' },
    { id: 'gnd', title: 'Ground (G)', icon: '<path d="M12 3v9M5 12h14M8 16h8M11 20h2"/>', m: 'sch' },
    { id: 'vcc', title: 'Power rail (P)', icon: '<path d="M12 21v-12M6 9h12M12 3v3"/>', m: 'sch' },
    { id: 'route', title: 'Route track (X)', icon: '<path d="M4 18h6l8-8h3"/><circle cx="4" cy="18" r="2"/><circle cx="21" cy="10" r="1.5"/>', m: 'pcb' },
    { id: 'via', title: 'Via (V while routing)', icon: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2.2"/>', m: 'pcb' },
    { id: 'measure', title: 'Measure (M)', icon: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>', m: 'pcb' },
  ];
  let tb;
  A.setTool = id => {
    if (id === 'gnd') { startPlace('GND'); return; }
    if (id === 'vcc') { startPlace('VCC'); return; }
    if (id !== 'place') { A.placing = null; renderLib(); }
    A.tool = id; tb.set(id === 'place' ? '' : id); render();
  };
  function setMode(m) {
    if (A.mode === m) return; SchEditor.cancel(); BoardEditor.cancel();
    A.mode = m; A.sel = null; A.tool = 'select'; A.placing = null;
    if (m === 'pcb' && A.msgKind === 'erc') { A.msgKind = ''; A.messages = []; } if (m === 'sch' && A.msgKind === 'drc') { A.msgKind = ''; A.messages = []; }
    document.querySelectorAll('.mode').forEach(b => b.classList.toggle('on', b.dataset.m === m));
    $('schBar').hidden = m !== 'sch'; $('pcbBar').hidden = m !== 'pcb'; $('libBox').hidden = m !== 'sch'; $('layerBar').hidden = m !== 'pcb';
    $('stage').style.background = m === 'pcb' ? '#0d1117' : '#fbfbf6';
    document.querySelectorAll('#tools .aero-tool').forEach(b => { const t = TOOLS.find(x => x && x.id === b.dataset.tool); b.hidden = t.m !== 'both' && t.m !== m; });
    tb.set('select'); render();
  }
  A.select = s => { A.sel = s; render(); };
  A.syncLayerUI = () => { $('layer').value = A.layer; renderLayerBar(); };
  function renderLayerBar() {
    const bar = $('layerBar'); bar.innerHTML = '';
    [['top', 'Top', '#d9342b'], ['bottom', 'Bottom', '#2f6fdb'], ['silk', 'Silk', '#f2f2f2'], ['rats', 'Ratsnest', '#bbb']].forEach(([k, n, c]) => {
      const d = Aero.el('span', 'lyr' + (A.layers[k] ? '' : ' off'), `<i style="background:${c}"></i>${n}`); d.title = 'Show/hide ' + n; d.onclick = () => { A.layers[k] = !A.layers[k]; renderLayerBar(); BoardEditor.draw(); }; bar.appendChild(d);
    });
  }

  // ---------- commands ----------
  function del() {
    const s = A.sel; if (!s || s.kind == null) return;
    A.commit('Delete', d => {
      if (A.mode === 'sch') { if (s.kind === 'part') { const ref = d.sch.parts[s.i].ref; d.sch.parts.splice(s.i, 1); } else if (s.kind === 'wire') d.sch.wires.splice(s.i, 1); else if (s.kind === 'label') d.sch.labels.splice(s.i, 1); }
      else { if (s.kind === 'track') d.board.tracks.splice(s.i, 1); else if (s.kind === 'via') d.board.vias.splice(s.i, 1); else if (s.kind === 'fp') Aero.toast('Delete the part in the schematic, then Update PCB.'); }
    });
    A.sel = null; render();
  }
  function syncPcb() {
    const before = A.doc.board.parts.length;
    let added = [];
    A.commit('Update PCB from schematic', d => { Core.annotate(d.sch); added = Core.syncBoard(d.sch, d.board); });
    const removed = before + added.length - A.doc.board.parts.length;
    setMode('pcb'); BoardEditor.fit(); render();
    Aero.toast(`PCB updated: ${added.length} footprint${added.length === 1 ? '' : 's'} added${removed > 0 ? `, ${removed} removed` : ''} · ${A.rats.totalNets} nets`);
  }
  function boardSetup() {
    const b = A.doc.board;
    Aero.dialog({ title: 'Board setup', instruction: 'Board outline and design rules used by routing, DRC and Gerber export.', fields: [
      { key: 'w', label: 'Width (mm)', type: 'number', value: b.w, min: 5, max: 500, step: 1 }, { key: 'h', label: 'Height (mm)', type: 'number', value: b.h, min: 5, max: 500, step: 1 },
      { key: 'clearance', label: 'Clearance (mm)', type: 'number', value: b.rules.clearance, min: 0.05, step: 0.05 }, { key: 'track', label: 'Minimum track (mm)', type: 'number', value: b.rules.track, min: 0.05, step: 0.05 },
      { key: 'viaDia', label: 'Via diameter (mm)', type: 'number', value: b.rules.viaDia, min: 0.3, step: 0.05 }, { key: 'viaDrill', label: 'Via drill (mm)', type: 'number', value: b.rules.viaDrill, min: 0.15, step: 0.05 },
      { key: 'drill', label: 'Minimum drill (mm)', type: 'number', value: b.rules.drill, min: 0.1, step: 0.05 }, { key: 'edge', label: 'Copper to edge (mm)', type: 'number', value: b.rules.edge, min: 0, step: 0.05 },
    ], onOK: v => A.commit('Board setup', d => { d.board.w = +v.w; d.board.h = +v.h; ['clearance', 'track', 'viaDia', 'viaDrill', 'drill', 'edge'].forEach(k => d.board.rules[k] = +v[k]); }) });
  }
  function addPour() {
    const nets = A.netlist.nets.map(n => n.name).sort((a, b) => (b === 'GND') - (a === 'GND') || a.localeCompare(b));
    if (!nets.length) return Aero.alert('Copper pour', 'Add nets in the schematic first.');
    Aero.dialog({ title: 'Copper pour', instruction: 'Fills the board on one layer with copper on a net (usually GND), keeping clear of every other net. Pads of that net join it directly, and islands that touch none of them are removed.', fields: [
      { key: 'net', label: 'Net', type: 'select', options: nets, value: nets[0] }, { key: 'layer', label: 'Layer', type: 'select', options: [['bottom', 'Bottom copper'], ['top', 'Top copper']], value: 'bottom' },
      { key: 'clearance', label: 'Clearance (mm)', type: 'number', value: 0.4, min: 0.1, step: 0.05 },
    ], onOK: v => { setMode('pcb'); A.commit('Copper pour', d => { (d.board.zones = d.board.zones || []).push({ net: v.net, layer: v.layer, clearance: Math.max(0.1, +v.clearance) }); }); Aero.toast(`Poured ${v.net} on ${v.layer} copper`); } });
  }
  A.editPart = () => { const i = $('props').querySelector('input'); if (i) { i.focus(); i.select(); } };
  A.editLabel = A.editPart;

  // ---------- files ----------
  async function openFiles(files) {
    const f = files[0]; if (!f) return;
    try { const text = typeof f.data === 'string' ? f.data : new TextDecoder().decode(f.data); const j = JSON.parse(text); if (!j.sch && !(j.doc && j.doc.sch)) throw new Error('Not a Lumen PCB project.'); load(j.doc || j, f.name.replace(/\.[^.]+$/, ''), f.path); }
    catch (e) { Aero.alert('Couldn’t open ' + f.name, e.message || String(e)); }
  }
  async function save(as) {
    const p = await Aero.saveFile({ name: A.docName + '.lpcb', data: JSON.stringify({ format: 'lumen-pcb', version: 1, doc: A.doc }), filters: [{ name: 'Lumen PCB project', extensions: ['lpcb'] }], path: as ? null : A.filePath });
    if (p) { if (typeof p === 'string' && /[\\/]/.test(p)) A.filePath = p; A.docName = String(p).split(/[\\/]/).pop().replace(/\.lpcb$/i, ''); Aero.setDoc(A.docName, false); return true; } return false;
  }
  async function exportFab() {
    const drcErr = Core.drc(A.doc.board, A.pinNet).filter(m => m.type !== 'Unrouted');
    const unrouted = A.rats.unroutedNets;
    if ((drcErr.length || unrouted) && !await Aero.confirm('Export Gerbers', `${drcErr.length ? drcErr.length + ' DRC problem(s)' : ''}${drcErr.length && unrouted ? ' and ' : ''}${unrouted ? unrouted + ' unrouted net(s)' : ''}. Export anyway?`)) return;
    const base = A.docName.replace(/[^\w.-]+/g, '_');
    const files = Core.fabFiles(A.doc.board, base, A.pinNet); files.push({ name: base + '-BOM.csv', data: Core.bom(A.doc.sch) });
    await Aero.saveFile({ name: base + '-gerbers.zip', data: Core.zip(files), filters: [{ name: 'ZIP archive', extensions: ['zip'] }] });
  }
  async function exportBom() { await Aero.saveFile({ name: A.docName + '-BOM.csv', data: Core.bom(A.doc.sch), filters: [{ name: 'CSV', extensions: ['csv'] }] }); }
  async function exportNetlist() {
    const rows = [['Net', 'Pins']]; A.netlist.nets.forEach(n => rows.push([n.name, n.nodes.map(x => x.ref + '.' + x.pin).join(' ')]));
    await Aero.saveFile({ name: A.docName + '-netlist.csv', data: rows.map(r => r.map(c => /[",]/.test(c) ? `"${c}"` : c).join(',')).join('\r\n'), filters: [{ name: 'CSV', extensions: ['csv'] }] });
  }
  async function exportPng() { const c = $('cv'); const blob = await new Promise(r => c.toBlob(r, 'image/png')); await Aero.saveFile({ name: A.docName + (A.mode === 'sch' ? '-schematic' : '-board') + '.png', data: blob, filters: [{ name: 'PNG', extensions: ['png'] }] }); }
  async function newDoc() { if (hist.items.length > 1 && !await Aero.confirm('New project', 'Start a new, empty project?')) return; load({ sch: {}, board: { w: 50, h: 40 } }, 'Untitled'); }

  // ---------- wiring ----------
  Aero.init({ name: 'Lumen PCB', icon: '../kit/icons/pcb.png', doc: 'Untitled', onDropFiles: openFiles, dropText: 'Drop a .lpcb project', onSave: () => save(false),
    menus: {
      File: [['New project', 'Ctrl+N', newDoc], ['Open sample (555 blinker)', '', () => load(PcbSample.samplePcb(), '555 LED blinker')], ['Open…', 'Ctrl+O', async () => openFiles(await Aero.openFile({ accept: '.lpcb,.json', filters: [{ name: 'Lumen PCB project', extensions: ['lpcb'] }] }))], '-',
        ['Save', 'Ctrl+S', () => save(false)], ['Save as…', 'Ctrl+Shift+S', () => save(true)], '-', '#Fabrication',
        ['Gerbers + drill + BOM (.zip)…', '', exportFab], ['Bill of materials (.csv)…', '', exportBom], ['Netlist (.csv)…', '', exportNetlist], ['Image of this view (.png)…', '', exportPng]],
      Edit: [['Undo', 'Ctrl+Z', () => restore(hist.undo())], ['Redo', 'Ctrl+Y', () => restore(hist.redo())], '-', ['Delete', 'Delete', del], ['Rotate', 'R', () => A.mode === 'sch' ? SchEditor.rotateSel() : BoardEditor.rotateSel()], ['Mirror / flip side', 'F', () => A.mode === 'sch' ? SchEditor.mirrorSel() : BoardEditor.flipSel()]],
      Place: [['Part…', '', () => { setMode('sch'); $('libSearch').focus(); }], ['Wire', 'W', () => { setMode('sch'); A.setTool('wire'); }], ['Net label', 'L', () => { setMode('sch'); A.setTool('label'); }], ['Ground', 'G', () => { setMode('sch'); startPlace('GND'); }], ['Power rail…', 'P', () => { setMode('sch'); startPlace('VCC'); }], '-',
        ['Route track', 'X', () => { setMode('pcb'); A.setTool('route'); }], ['Via', '', () => { setMode('pcb'); A.setTool('via'); }], ['Copper pour…', '', addPour]],
      Design: [['Annotate references', '', () => A.commit('Annotate', d => Core.annotate(d.sch))], ['Check schematic (ERC)', 'F7', () => { setMode('sch'); runCheck('erc'); }], ['Update PCB from schematic', 'F8', syncPcb], '-', ['Check design rules (DRC)', 'F9', () => { setMode('pcb'); runCheck('drc'); }], ['Board setup…', '', () => { setMode('pcb'); boardSetup(); }]],
      View: [['Schematic', 'F2', () => setMode('sch')], ['PCB', 'F3', () => setMode('pcb')], '-', ['Fit to window', 'Home', () => { (A.mode === 'sch' ? SchEditor : BoardEditor).fit(); render(); }],
        { label: 'Top copper', checked: () => A.layers.top, fn: () => { A.layers.top = !A.layers.top; renderLayerBar(); render(); } }, { label: 'Bottom copper', checked: () => A.layers.bottom, fn: () => { A.layers.bottom = !A.layers.bottom; renderLayerBar(); render(); } },
        { label: 'Silkscreen', checked: () => A.layers.silk, fn: () => { A.layers.silk = !A.layers.silk; renderLayerBar(); render(); } }, { label: 'Ratsnest', checked: () => A.layers.rats, fn: () => { A.layers.rats = !A.layers.rats; renderLayerBar(); render(); } }],
      Help: [['How to make a board', '', () => Aero.alert('Making a board in Lumen PCB',
        '1. Schematic: pick parts from the Library and click to place them (R rotates). Draw wires with W; end a wire on a pin or another wire. Name nets with labels (L) — pins with the same label name are connected. Add Ground (G) and power rails (P).\n2. Check the schematic (F7) for unconnected pins.\n3. Update PCB (F8): footprints appear on the board with white ratsnest lines showing what still needs connecting.\n4. Arrange footprints, then route (X): click a pad, click to add corners, finish on the other pad. Press V while routing to drop a via and continue on the other layer.\n5. Run DRC (F9) until it is clean, then File → Gerbers to get a zip any PCB fab accepts (copper, mask, silk, outline, Excellon drill, BOM).\n\nGround planes: Place → Copper pour fills a layer with a net and is exported as Gerber regions.\n\nNot included yet: autorouter, thermal relief spokes, more than two layers, signal-integrity analysis.')]],
    } });
  tb = Aero.toolbox($('tools'), TOOLS, id => { if (id && id !== A.tool) A.setTool(id); });
  // mode-aware single-key shortcuts
  const key = (k, fn) => Aero.shortcut(k, fn);
  key('V', () => { if (A.mode === 'pcb' && BoardEditor.routing) BoardEditor.placeVia(); else A.setTool('select'); });
  key('M', () => { if (A.mode === 'sch') SchEditor.mirrorSel(); else A.setTool('measure'); });
  key('/', () => (A.mode === 'sch' ? SchEditor : BoardEditor).toggleBend());
  key('Escape', () => { if (!(A.mode === 'sch' ? SchEditor : BoardEditor).cancel()) A.select(null); });
  document.querySelectorAll('.mode').forEach(b => b.onclick = () => setMode(b.dataset.m));
  $('bAnno').onclick = () => A.commit('Annotate', d => Core.annotate(d.sch)); $('bErc').onclick = () => runCheck('erc'); $('bSync').onclick = syncPcb; $('bDrc').onclick = () => runCheck('drc'); $('bFab').onclick = exportFab;
  $('layer').onchange = () => { A.layer = $('layer').value; BoardEditor.draw(); };
  $('trackW').onchange = () => { A.trackW = +$('trackW').value; };
  $('grid').onchange = () => { A.grid = +$('grid').value; BoardEditor.draw(); };
  $('libSearch').oninput = renderLib;
  const cv = $('cv'); SchEditor.attach(A, cv); BoardEditor.attach(A, cv);
  new ResizeObserver(() => (A.mode === 'sch' ? SchEditor : BoardEditor).draw()).observe($('stage'));
  renderLib(); renderLayerBar();
  document.querySelectorAll('#tools .aero-tool').forEach(b => { const t = TOOLS.find(x => x && x.id === b.dataset.tool); b.hidden = t.m === 'pcb'; });
  let start = null; try { const j = JSON.parse(localStorage.getItem(AUTOSAVE) || 'null'); if (j && j.doc && j.doc.sch) start = j; } catch (e) { }
  if (start) { load(start.doc, start.name); Aero.setDirty(true); } else load(PcbSample.samplePcb(), '555 LED blinker');
  tb.set('select');
})();
