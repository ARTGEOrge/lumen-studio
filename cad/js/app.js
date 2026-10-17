// Lumen CAD — parametric part modelling with a feature tree, in the spirit of CATIA Part Design (much simpler).
(function () {
  const K = window.CadKernel, $ = id => document.getElementById(id), esc = s => Aero.esc(String(s ?? ''));
  const AUTOSAVE = 'lumen-cad-autosave';
  const A = window.CadApp = { m: null, sel: 0, result: null, docName: 'Untitled', filePath: null, measure: null, edges: true };
  const hist = new Aero.History({ max: 100 });
  const ICON = { box: '▣', cylinder: '◉', sphere: '●', cone: '▲', torus: '◎', extrude: '⬆', revolve: '↻', mesh: '△' };
  const NAME = { box: 'Box', cylinder: 'Cylinder', sphere: 'Sphere', cone: 'Cone', torus: 'Torus', extrude: 'Extrude', revolve: 'Revolve', mesh: 'Imported mesh' };
  const FIELDS = {
    box: [['w', 'Width (X)'], ['d', 'Depth (Y)'], ['h', 'Height (Z)']], cylinder: [['r', 'Radius'], ['h', 'Height']], sphere: [['r', 'Radius']],
    cone: [['r1', 'Base radius'], ['r2', 'Top radius'], ['h', 'Height']], torus: [['R', 'Ring radius'], ['r', 'Tube radius']],
    extrude: [['dist', 'Distance']], revolve: [['angle', 'Angle (°)']], mesh: [],
  };
  const DEFAULTS = { box: { w: 40, d: 30, h: 20 }, cylinder: { r: 10, h: 30 }, sphere: { r: 15 }, cone: { r1: 15, r2: 0, h: 30 }, torus: { R: 25, r: 6 },
    extrude: { plane: 'XY', offset: 0, dist: 10, shapes: [{ type: 'rect', x: -20, y: -10, w: 40, h: 20 }] }, revolve: { plane: 'XZ', offset: 0, angle: 360, shapes: [{ type: 'rect', x: 10, y: 0, w: 5, h: 20 }] } };
  const SHAPE_F = { rect: [['x', 'X'], ['y', 'Y'], ['w', 'W'], ['h', 'H']], circle: [['x', 'X'], ['y', 'Y'], ['r', 'R']], polygon: [['x', 'X'], ['y', 'Y'], ['r', 'R'], ['n', 'Sides']], slot: [['x', 'X'], ['y', 'Y'], ['l', 'Length'], ['r', 'R']], points: [] };
  const DENS = [['2.70', 'Aluminium 6061 (2.70 g/cm³)'], ['7.85', 'Steel (7.85 g/cm³)'], ['8.96', 'Copper (8.96 g/cm³)'], ['1.24', 'PLA (1.24 g/cm³)'], ['1.04', 'ABS (1.04 g/cm³)'], ['1.00', 'Water / generic (1.00 g/cm³)']];

  // ---------- model ----------
  function normalize(m) { m.params = m.params || []; m.features = m.features || []; m.density = m.density || 2.7; m.features.forEach(f => { f.p = f.p || {}; f.op = f.op || 'add'; f.name = f.name || NAME[f.type]; }); return m; }
  function vars() { try { return K.evalParams(A.m.params); } catch (e) { return null; } }
  let rebuildT = null;
  function rebuild(resetView) {
    const t0 = performance.now();
    A.result = K.build(A.m);
    const bb = CadView.setBody(A.result.solid, A.edges);
    if (resetView) CadView.view($('viewSel').value, bb);
    showGhost(); applySection();
    $('st2').textContent = `Rebuilt in ${Math.round(performance.now() - t0)} ms · ${A.result.solid.triangles().length.toLocaleString()} triangles`;
    renderTree(); renderMass();
  }
  function showGhost() {
    const f = A.m.features[A.sel]; if (!f || f.suppressed) { CadView.setGhost(null); return; }
    const v = vars(); if (!v) { CadView.setGhost(null); return; }
    try { CadView.setGhost(f.op === 'add' && A.sel === 0 ? null : K.toolOf(f, e => K.evalExpr(e == null ? 0 : e, v))); } catch (e) { CadView.setGhost(null); }
  }
  A.commit = (label, fn, opts = {}) => {
    const before = JSON.stringify(A.m); fn(A.m); normalize(A.m);
    if (JSON.stringify(A.m) === before) return;
    hist.push(label, JSON.stringify(A.m)); autosave();
    clearTimeout(rebuildT); rebuildT = setTimeout(() => { rebuild(false); if (!opts.keepProps) renderProps(); }, opts.now ? 0 : 60);
    if (!opts.keepProps) renderProps();
  };
  function restore(s) { if (!s) return; A.m = JSON.parse(s); A.sel = Math.min(A.sel, A.m.features.length - 1); autosave(); rebuild(false); renderAll(); }
  let saveT; function autosave() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(AUTOSAVE, JSON.stringify({ name: A.docName, m: A.m })); } catch (e) { } }, 400); }
  function load(m, name, path) { A.m = normalize(m); A.docName = name || m.name || 'Untitled'; A.filePath = path || null; A.sel = Math.max(0, A.m.features.length - 1); hist.reset('Open', JSON.stringify(A.m)); Aero.setDoc(A.docName, false); rebuild(true); renderAll(); }

  // ---------- feature tree ----------
  function renderTree() {
    const el = $('tree'); el.innerHTML = '';
    A.m.features.forEach((f, i) => {
      const lg = A.result && A.result.log[i], bad = lg && !lg.ok && !f.suppressed;
      const d = Aero.el('div', `aero-item fitem${i === A.sel ? ' sel' : ''}${f.suppressed ? ' sup' : ''}${bad ? ' err' : ''}`, `<span class="ic">${ICON[f.type] || '•'}</span><span class="grow"></span><span class="op">${f.op === 'cut' ? 'cut' : f.op === 'intersect' ? '∩' : ''}${f.pattern && f.pattern.count > 1 ? ' ×' + f.pattern.count : ''}${f.mirror ? ' ⇋' + f.mirror : ''}</span>`);
      d.querySelector('.grow').textContent = f.name + (bad ? ' — ' + lg.msg : ''); d.title = bad ? lg.msg : f.name;
      d.onclick = () => { A.sel = i; renderTree(); renderProps(); showGhost(); };
      el.appendChild(d);
    });
    $('fCount').textContent = A.m.features.length;
  }
  function renderParams() {
    const el = $('params'), v = {}; let err = null;
    const rows = A.m.params.map((p, i) => { let val = ''; try { v[p.name] = K.evalExpr(p.expr, v); val = +v[p.name].toFixed(4); } catch (e) { err = e.message; val = '!'; }
      return `<tr><td><input data-pi="${i}" data-f="name" value="${esc(p.name)}" title="${esc(p.note || '')}"></td><td><input data-pi="${i}" data-f="expr" value="${esc(p.expr)}" class="${val === '!' ? 'bad' : ''}"></td><td class="val">${val}</td><td><button class="aero-btn small" data-pdel="${i}" title="Delete">✕</button></td></tr>`; }).join('');
    el.innerHTML = `<table>${rows}</table><button class="aero-btn small" id="pAdd" style="margin-top:4px">+ Parameter</button> <span class="dim" style="font-size:11px">Use names in any field, e.g. <span class="mono">w/2+3</span></span>`;
    el.querySelectorAll('[data-pi]').forEach(inp => inp.onchange = () => {
      const i = +inp.dataset.pi, f = inp.dataset.f, val = inp.value.trim();
      if (f === 'name' && !/^[A-Za-z_]\w*$/.test(val)) { Aero.toast('Parameter names are letters, digits and _ (not starting with a digit).'); renderParams(); return; }
      A.commit('Edit parameter', m => { const old = m.params[i].name; m.params[i][f] = val; if (f === 'name' && old !== val) renameParam(m, old, val); });
      renderParams();
    });
    el.querySelectorAll('[data-pdel]').forEach(b => b.onclick = () => { A.commit('Delete parameter', m => m.params.splice(+b.dataset.pdel, 1)); renderParams(); });
    $('pAdd').onclick = () => { let k = 1; while (A.m.params.some(p => p.name === 'p' + k)) k++; A.commit('Add parameter', m => m.params.push({ name: 'p' + k, expr: '10' })); renderParams(); };
  }
  function renameParam(m, old, nw) {
    const re = new RegExp('\\b' + old + '\\b', 'g'), fix = x => typeof x === 'string' ? x.replace(re, nw) : x;
    m.params.forEach(p => p.expr = fix(p.expr));
    m.features.forEach(f => { Object.keys(f.p).forEach(k => { if (k === 'shapes') f.p.shapes.forEach(s => Object.keys(s).forEach(q => s[q] = fix(s[q]))); else f.p[k] = fix(f.p[k]); }); if (f.pattern) Object.keys(f.pattern).forEach(k => f.pattern[k] = fix(f.pattern[k])); });
  }

  // ---------- properties ----------
  function check(expr) { const v = vars(); if (!v) return 'A parameter has an error'; try { K.evalExpr(expr == null ? 0 : expr, v); return null; } catch (e) { return e.message; } }
  const inp = (path, val, ph = '') => `<input data-path="${path}" value="${esc(val ?? '')}" placeholder="${ph}" class="${check(val) ? 'bad' : ''}" title="${esc(check(val) || '')}">`;
  function renderProps() {
    const el = $('props'), f = A.m.features[A.sel];
    if (!f) { el.innerHTML = '<span class="dim">Add a feature from the toolbar — or open the sample from the File menu.</span>'; $('propTitle').textContent = 'Properties'; return; }
    $('propTitle').textContent = (ICON[f.type] || '') + ' ' + NAME[f.type];
    const P = f.p, lg = A.result && A.result.log[A.sel];
    let h = `<div class="pform"><label>Name</label><input data-path="name" value="${esc(f.name)}">
      <label>Operation</label><select data-path="op"><option value="add" ${f.op === 'add' ? 'selected' : ''}>Add (union)</option><option value="cut" ${f.op === 'cut' ? 'selected' : ''}>Cut (subtract)</option><option value="intersect" ${f.op === 'intersect' ? 'selected' : ''}>Intersect</option></select>`;
    if (lg && !lg.ok && !f.suppressed) h += `<span class="errline">⚠ ${esc(lg.msg)}</span>`;
    FIELDS[f.type].forEach(([k, l]) => h += `<label>${l}</label>${inp('p.' + k, P[k])}`);
    if (f.type === 'extrude') h += `<label>Symmetric</label><input type="checkbox" data-path="p.symmetric" ${P.symmetric ? 'checked' : ''} style="width:auto">`;
    if (f.type === 'extrude' || f.type === 'revolve') {
      h += `<h4>Sketch</h4><label>Plane</label><select data-path="p.plane">${['XY', 'XZ', 'YZ'].map(p => `<option ${P.plane === p ? 'selected' : ''}>${p}</option>`).join('')}</select><label>Offset</label>${inp('p.offset', P.offset)}`;
      if (f.type === 'revolve') h += `<span class="dim" style="grid-column:span 2;font-size:11px">Revolves around the sketch's vertical axis (u = 0). Keep the profile at u ≥ 0.</span>`;
      (P.shapes || []).forEach((s, i) => {
        h += `<div class="shape"><div class="hd"><select data-path="p.shapes.${i}.type">${Object.keys(SHAPE_F).map(t => `<option ${t === s.type ? 'selected' : ''}>${t}</option>`).join('')}</select><label><input type="checkbox" data-path="p.shapes.${i}.hole" ${s.hole ? 'checked' : ''}> hole</label><button class="aero-btn small" data-sdel="${i}">✕</button></div>`;
        if (s.type === 'points') h += `<label>Points</label><input class="wide" data-path="p.shapes.${i}.pts" value="${esc(s.pts || '')}" placeholder="x,y; x,y; x,y">`;
        else SHAPE_F[s.type].forEach(([k, l]) => h += `<label>${l}</label>${inp(`p.shapes.${i}.${k}`, s[k])}`);
        h += '</div>';
      });
      h += `<span style="grid-column:span 2"><button class="aero-btn small" id="sAdd">+ Shape</button></span><canvas class="skprev" id="skprev"></canvas>`;
    }
    h += `<h4>Placement</h4>${['px', 'py', 'pz'].map((k, i) => `<label>${'XYZ'[i]} offset</label>${inp('p.' + k, P[k], '0')}`).join('')}${['rx', 'ry', 'rz'].map((k, i) => `<label>Rotate ${'XYZ'[i]} (°)</label>${inp('p.' + k, P[k], '0')}`).join('')}`;
    const pat = f.pattern || {};
    h += `<h4>Pattern &amp; mirror</h4><label>Pattern</label><select data-path="pattern.type"><option value="">None</option><option value="linear" ${pat.type === 'linear' ? 'selected' : ''}>Linear</option><option value="circular" ${pat.type === 'circular' ? 'selected' : ''}>Circular (about Z)</option></select>`;
    if (pat.type) { h += `<label>Count</label>${inp('pattern.count', pat.count)}`; if (pat.type === 'linear') h += ['dx', 'dy', 'dz'].map(k => `<label>Step ${k[1].toUpperCase()}</label>${inp('pattern.' + k, pat[k])}`).join(''); else h += `<label>Total angle</label>${inp('pattern.angle', pat.angle)}`; }
    h += `<label>Mirror across</label><select data-path="mirror"><option value="">None</option>${['X', 'Y', 'Z', 'XY', 'XZ', 'YZ', 'XYZ'].map(m => `<option ${f.mirror === m ? 'selected' : ''} value="${m}">${m.split('').join(' + ')}</option>`).join('')}</select></div>`;
    el.innerHTML = h;
    el.querySelectorAll('[data-path]').forEach(e => e.addEventListener('change', () => {
      const path = e.dataset.path, val = e.type === 'checkbox' ? e.checked : e.value;
      A.commit('Edit ' + path.split('.').pop(), m => {
        const f2 = m.features[A.sel], ks = path.split('.'); let o = f2;
        if (ks[0] === 'pattern') { if (!f2.pattern) f2.pattern = { type: '', count: 2, dx: 20, dy: 0, dz: 0, angle: 360 }; }
        for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
        const k = ks[ks.length - 1];
        o[k] = (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val.trim())) ? +val : val;
        if (path === 'pattern.type' && !val) delete f2.pattern;
        if (path.endsWith('.type') && ks[1] === 'shapes') { const s = o; Object.keys(s).forEach(q => { if (!['type', 'hole'].includes(q)) delete s[q]; }); Object.assign(s, { rect: { x: -10, y: -10, w: 20, h: 20 }, circle: { x: 0, y: 0, r: 10 }, polygon: { x: 0, y: 0, r: 10, n: 6 }, slot: { x: 0, y: 0, l: 20, r: 4 }, points: { pts: '0,0; 20,0; 0,20' } }[val]); }
      });
    }));
    el.querySelectorAll('[data-sdel]').forEach(b => b.onclick = () => A.commit('Remove shape', m => m.features[A.sel].p.shapes.splice(+b.dataset.sdel, 1)));
    const sa = $('sAdd'); if (sa) sa.onclick = () => A.commit('Add shape', m => m.features[A.sel].p.shapes.push({ type: 'circle', x: 0, y: 0, r: 5, hole: true }));
    drawSketch();
  }
  function drawSketch() {
    const c = $('skprev'), f = A.m.features[A.sel]; if (!c || !f) return;
    const w = c.clientWidth, h = c.clientHeight, dpr = devicePixelRatio || 1; c.width = w * dpr; c.height = h * dpr; const g = c.getContext('2d'); g.scale(dpr, dpr);
    const v = vars() || {}, ev = e => { try { return K.evalExpr(e == null ? 0 : e, v); } catch (x) { return NaN; } };
    const loops = (f.p.shapes || []).map(s => { const o = { type: s.type }; ['x', 'y', 'w', 'h', 'r', 'n', 'l'].forEach(k => { if (s[k] != null) o[k] = ev(s[k]); }); if (s.type === 'points') o.pts = String(s.pts || '').split(';').filter(q => q.trim()).map(q => q.split(',').map(t => ev(t.trim()))); return { L: K.loopOf(o, 48), hole: s.hole }; }).filter(x => x.L.length && x.L.every(p => p.every(isFinite)));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; loops.forEach(({ L }) => L.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
    if (f.type === 'revolve') { x0 = Math.min(x0, 0); x1 = Math.max(x1, 0); }
    if (x0 === Infinity) return; const s = Math.min((w - 20) / Math.max(1e-6, x1 - x0), (h - 20) / Math.max(1e-6, y1 - y0)), X = x => 10 + (x - x0) * s + ((w - 20) - (x1 - x0) * s) / 2, Y = y => h - 10 - (y - y0) * s - ((h - 20) - (y1 - y0) * s) / 2;
    g.strokeStyle = '#c9d6e4'; g.beginPath(); if (0 >= x0 && 0 <= x1) { g.moveTo(X(0), 0); g.lineTo(X(0), h); } if (0 >= y0 && 0 <= y1) { g.moveTo(0, Y(0)); g.lineTo(w, Y(0)); } g.stroke();
    if (f.type === 'revolve') { g.setLineDash([6, 3, 2, 3]); g.strokeStyle = '#d0202a'; g.beginPath(); g.moveTo(X(0), 0); g.lineTo(X(0), h); g.stroke(); g.setLineDash([]); }
    loops.forEach(({ L, hole }) => { g.beginPath(); L.forEach(([x, y], i) => i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))); g.closePath(); g.fillStyle = hole ? 'rgba(255,255,255,1)' : 'rgba(60,127,177,.25)'; g.fill(); g.strokeStyle = hole ? '#b4141e' : '#1e5aa8'; g.lineWidth = 1.5; g.stroke(); });
    g.fillStyle = '#5b6b7c'; g.font = '10px Segoe UI'; g.fillText(`${f.p.plane || 'XY'} sketch · ${(x1 - x0).toFixed(1)} × ${(y1 - y0).toFixed(1)}`, 6, 12);
  }
  function renderMass() {
    const el = $('mass'), m = K.massProps(A.result.solid), dens = +A.m.density || 1;
    const f = x => x.toLocaleString(undefined, { maximumFractionDigits: 2 });
    el.innerHTML = `<div class="kv"><b>Volume</b><span>${f(m.volume)} mm³ (${f(m.volume / 1000)} cm³)</span><b>Surface</b><span>${f(m.area)} mm²</span>
      <b>Material</b><span><select id="dens" style="width:100%">${DENS.map(([v, l]) => `<option value="${v}" ${(+v).toFixed(2) === dens.toFixed(2) ? 'selected' : ''}>${l}</option>`).join('')}</select></span>
      <b>Mass</b><span>${f(m.volume / 1000 * dens)} g</span><b>Size</b><span>${m.size.map(x => x.toFixed(2)).join(' × ')} mm</span>
      <b>Centroid</b><span>${m.centroid.map(x => x.toFixed(2)).join(', ')}</span></div>`;
    $('dens').onchange = () => A.commit('Material', mm => { mm.density = +$('dens').value; }, { keepProps: true });
    $('st3').textContent = `${A.m.features.length} features · ${A.m.params.length} parameters`;
  }
  function renderAll() { renderTree(); renderParams(); renderProps(); renderMass(); }

  // ---------- commands ----------
  function addFeature(type) {
    const f = { name: NAME[type] + ' ' + (A.m.features.filter(x => x.type === type).length + 1), type, op: A.m.features.length ? (['extrude', 'revolve', 'box'].includes(type) ? 'add' : 'add') : 'add', p: JSON.parse(JSON.stringify(DEFAULTS[type])) };
    A.commit('Add ' + NAME[type], m => { m.features.splice(A.sel + 1, 0, f); }, { now: true }); A.sel = Math.min(A.sel + 1, A.m.features.length - 1); renderTree(); renderProps();
  }
  function moveSel(d) { const i = A.sel, j = i + d; if (j < 0 || j >= A.m.features.length) return; A.commit('Reorder', m => { const [f] = m.features.splice(i, 1); m.features.splice(j, 0, f); }); A.sel = j; renderTree(); }
  function delSel() { if (!A.m.features[A.sel]) return; A.commit('Delete feature', m => m.features.splice(A.sel, 1)); A.sel = Math.max(0, A.sel - 1); renderTree(); renderProps(); }
  function dupSel() { const f = A.m.features[A.sel]; if (!f) return; A.commit('Duplicate', m => m.features.splice(A.sel + 1, 0, { ...JSON.parse(JSON.stringify(f)), name: f.name + ' copy' })); A.sel++; renderTree(); renderProps(); }
  function supSel() { if (!A.m.features[A.sel]) return; A.commit('Suppress', m => { m.features[A.sel].suppressed = !m.features[A.sel].suppressed; }); }
  function applySection() { const on = $('section').checked; $('secAxis').disabled = $('secPos').disabled = !on; CadView.setSection(on, $('secAxis').value, +$('secPos').value / 1000); }

  // ---------- files ----------
  async function openFiles(files) {
    const f = files[0]; if (!f) return; const ext = f.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'stl') { const tris = K.fromSTL(new Uint8Array(f.data)); A.commit('Import STL', m => m.features.push({ name: f.name, type: 'mesh', op: m.features.length ? 'add' : 'add', p: {}, tris })); A.sel = A.m.features.length - 1; rebuild(true); renderAll(); Aero.toast(`Imported ${tris.length.toLocaleString()} triangles as a mesh feature`); return; }
      const j = JSON.parse(typeof f.data === 'string' ? f.data : new TextDecoder().decode(f.data)); load(j.model || j, f.name.replace(/\.[^.]+$/, ''), f.path);
    } catch (e) { Aero.alert('Couldn’t open ' + f.name, e.message || String(e)); }
  }
  async function save(as) {
    const p = await Aero.saveFile({ name: A.docName + '.lcad', data: JSON.stringify({ format: 'lumen-cad', version: 1, model: A.m }), filters: [{ name: 'Lumen CAD part', extensions: ['lcad'] }], path: as ? null : A.filePath });
    if (p) { if (typeof p === 'string' && /[\\/]/.test(p)) A.filePath = p; A.docName = String(p).split(/[\\/]/).pop().replace(/\.lcad$/i, ''); Aero.setDoc(A.docName, false); return true; } return false;
  }
  const exportSTL = () => Aero.saveFile({ name: A.docName + '.stl', data: K.toSTL(A.result.solid, A.docName), filters: [{ name: 'STL (3D printing)', extensions: ['stl'] }] });
  const exportOBJ = () => Aero.saveFile({ name: A.docName + '.obj', data: K.toOBJ(A.result.solid), filters: [{ name: 'Wavefront OBJ', extensions: ['obj'] }] });
  function exportDrawing() {
    const m = K.massProps(A.result.solid), dens = +A.m.density || 1, mat = (DENS.find(([v]) => (+v).toFixed(2) === dens.toFixed(2)) || [0, dens + ' g/cm³'])[1].replace(/ \(.*$/, '');
    Aero.busy('Drawing three views…');
    setTimeout(() => { try { const d = K.drawingSVG(A.result.solid, { name: A.docName, material: mat, mass: (m.volume / 1000 * dens).toFixed(1) + ' g' }); Aero.busy(); Aero.saveFile({ name: A.docName + ' - drawing.svg', data: d.svg, filters: [{ name: 'SVG drawing', extensions: ['svg'] }] }); } catch (e) { Aero.busy(); Aero.alert('Drawing', e.message); } }, 30);
  }
  async function exportPNG() { const c = CadView.snapshot(); const b = await new Promise(r => c.toBlob(r, 'image/png')); Aero.saveFile({ name: A.docName + '.png', data: b, filters: [{ name: 'PNG', extensions: ['png'] }] }); }
  async function newDoc() { if (hist.items.length > 1 && !await Aero.confirm('New part', 'Start a new, empty part?')) return; load({ params: [{ name: 'size', expr: '40' }], features: [{ name: 'Box 1', type: 'box', op: 'add', p: { w: 'size', d: 'size', h: 'size/2' } }] }, 'Untitled'); }

  // ---------- measure ----------
  function measureClick(e) {
    if (!A.measure) return; const p = CadView.pick(e); if (!p) return;
    A.measure.pts.push(p); if (A.measure.pts.length > 2) A.measure.pts = [p];
    CadView.mark(A.measure.pts);
    const tip = $('mtip'); tip.style.display = 'block';
    if (A.measure.pts.length === 2) { const [a, b] = A.measure.pts; const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; tip.innerHTML = `<b>${Math.hypot(...d).toFixed(3)} mm</b> · dx ${d[0].toFixed(2)} · dy ${d[1].toFixed(2)} · dz ${d[2].toFixed(2)}`; }
    else tip.textContent = `Point 1: ${p.map(x => x.toFixed(2)).join(', ')} — click a second point`;
  }
  function toggleMeasure(on) { A.measure = on ? { pts: [] } : null; $('bMeasure').classList.toggle('on', !!on); if (!on) { CadView.mark([]); $('mtip').style.display = 'none'; } $('hint').textContent = on ? 'Click two points on the part · Esc to stop' : 'Drag to orbit · right-drag to pan · wheel to zoom'; }

  // ---------- wiring ----------
  Aero.init({ name: 'Lumen CAD', icon: '../kit/icons/cad.png', doc: 'Untitled', onDropFiles: openFiles, dropText: 'Drop a .lcad part or an .stl mesh', onSave: () => save(false),
    menus: {
      File: [['New part', 'Ctrl+N', newDoc], ['Open sample (angle bracket)', '', () => load(CadSample.sampleCad(), 'Angle bracket')], ['Open…', 'Ctrl+O', async () => openFiles(await Aero.openFile({ accept: '.lcad,.json,.stl', filters: [{ name: 'Parts and meshes', extensions: ['lcad', 'stl'] }] }))], '-',
        ['Save', 'Ctrl+S', () => save(false)], ['Save as…', 'Ctrl+Shift+S', () => save(true)], '-', '#Export', ['STL for 3D printing…', '', exportSTL], ['Engineering drawing (.svg)…', 'Ctrl+Shift+D', exportDrawing], ['OBJ mesh…', '', exportOBJ], ['Image of the view (.png)…', '', exportPNG], '-', ['Import STL as a feature…', '', async () => openFiles(await Aero.openFile({ accept: '.stl', filters: [{ name: 'STL', extensions: ['stl'] }] }))]],
      Edit: [['Undo', 'Ctrl+Z', () => restore(hist.undo())], ['Redo', 'Ctrl+Y', () => restore(hist.redo())], '-', ['Duplicate feature', 'Ctrl+D', dupSel], ['Suppress / unsuppress', '', supSel], ['Move up', 'Ctrl+Up', () => moveSel(-1)], ['Move down', 'Ctrl+Down', () => moveSel(1)], ['Delete feature', 'Delete', delSel]],
      Insert: Object.keys(NAME).filter(k => k !== 'mesh').map(k => [NAME[k], '', () => addFeature(k)]).concat(['-', ['Parameter', '', () => $('pAdd').click()]]),
      View: [['Isometric', '0', () => { $('viewSel').value = 'iso'; CadView.view('iso'); }], ['Front', '1', () => { $('viewSel').value = 'front'; CadView.view('front'); }], ['Top', '7', () => { $('viewSel').value = 'top'; CadView.view('top'); }], ['Right', '3', () => { $('viewSel').value = 'right'; CadView.view('right'); }], '-',
        { label: 'Edges', checked: () => A.edges, fn: () => { A.edges = !A.edges; $('edges').checked = A.edges; CadView.setEdges(A.edges); } }, { label: 'Section view', checked: () => $('section').checked, fn: () => { $('section').checked = !$('section').checked; applySection(); } }, ['Measure', 'M', () => toggleMeasure(!A.measure)]],
      Help: [['How Lumen CAD works', '', () => Aero.alert('How Lumen CAD works',
        'A part is a list of features, rebuilt from the top every time something changes.\n\n• Each feature makes a solid (box, cylinder, sketch extrude/revolve…) and adds it to, cuts it from, or intersects it with the part so far.\n• Any number field accepts an expression using your Parameters, e.g. w/2-edge. Change a parameter and the whole part follows.\n• Sketches are made of shapes (rectangles, circles, polygons, slots, point lists); tick "hole" to cut a shape out of the profile.\n• Patterns repeat a feature in a line or around Z; Mirror copies it across planes.\n• The orange ghost shows the selected feature\'s tool.\n\nFile → Engineering drawing makes an A4 three-view sheet (third-angle) with hidden lines, overall dimensions and a title block.\n\nNot included yet: interactive sketching with constraints, fillets and chamfers, assemblies, STEP files.')]],
    } });
  CadView.init($('cv'));
  document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => addFeature(b.dataset.add));
  $('fUp').onclick = () => moveSel(-1); $('fDown').onclick = () => moveSel(1); $('fDel').onclick = delSel; $('fDup').onclick = dupSel; $('fSup').onclick = supSel;
  $('viewSel').onchange = () => CadView.view($('viewSel').value);
  $('edges').onchange = () => { A.edges = $('edges').checked; CadView.setEdges(A.edges); };
  $('section').onchange = applySection; $('secAxis').onchange = applySection; $('secPos').oninput = applySection;
  $('bMeasure').onclick = () => toggleMeasure(!A.measure);
  $('vc').innerHTML = ['iso', 'front', 'top', 'right'].map(v => `<button data-v="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('');
  $('vc').querySelectorAll('button').forEach(b => b.onclick = () => { $('viewSel').value = b.dataset.v; CadView.view(b.dataset.v); });
  let down = null; $('cv').addEventListener('pointerdown', e => down = [e.clientX, e.clientY]);
  $('cv').addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4) measureClick(e); down = null; });
  Aero.shortcut('Escape', () => toggleMeasure(false));
  toggleMeasure(false);
  let start = null; try { const j = JSON.parse(localStorage.getItem(AUTOSAVE) || 'null'); if (j && j.m && j.m.features) start = j; } catch (e) { }
  if (start) { load(start.m, start.name); Aero.setDirty(true); } else load(CadSample.sampleCad(), 'Angle bracket');
})();
