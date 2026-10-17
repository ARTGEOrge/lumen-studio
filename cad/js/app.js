// Lumen CAD — parametric part modelling with a feature tree, in the spirit of CATIA Part Design (much simpler).
(function () {
  const K = window.CadKernel, $ = id => document.getElementById(id), esc = s => Aero.esc(String(s ?? ''));
  const AUTOSAVE = 'lumen-cad-autosave';
  const A = window.CadApp = { m: null, sel: 0, result: null, docName: 'Untitled', filePath: null, measure: null, edges: true };
  const hist = new Aero.History({ max: 100 });
  const ICON = { box: '▣', cylinder: '◉', sphere: '●', cone: '▲', torus: '◎', extrude: '⬆', revolve: '↻', mesh: '△', hole: '⌀', fillet: '◜' };
  const NAME = { box: 'Box', cylinder: 'Cylinder', sphere: 'Sphere', cone: 'Cone', torus: 'Torus', extrude: 'Extrude', revolve: 'Revolve', mesh: 'Imported mesh', hole: 'Hole', fillet: 'Fillet' };
  const FIELDS = {
    box: [['w', 'Width (X)'], ['d', 'Depth (Y)'], ['h', 'Height (Z)']], cylinder: [['r', 'Radius'], ['h', 'Height']], sphere: [['r', 'Radius']],
    cone: [['r1', 'Base radius'], ['r2', 'Top radius'], ['h', 'Height']], torus: [['R', 'Ring radius'], ['r', 'Tube radius']],
    extrude: [['dist', 'Distance']], revolve: [['angle', 'Angle (°)']], mesh: [], hole: [], fillet: [],
  };
  const DEFAULTS = { box: { w: 40, d: 30, h: 20 }, cylinder: { r: 10, h: 30 }, sphere: { r: 15 }, cone: { r1: 15, r2: 0, h: 30 }, torus: { R: 25, r: 6 },
    extrude: { plane: 'XY', offset: 0, dist: 10, shapes: [{ type: 'rect', x: -20, y: -10, w: 40, h: 20 }] }, revolve: { plane: 'XZ', offset: 0, angle: 360, shapes: [{ type: 'rect', x: 10, y: 0, w: 5, h: 20 }] },
    hole: { std: 'M6', kind: 'cbore', ...K.holeSpec('M6', 'cbore'), depth: '', plane: 'XY', offset: 0, flip: false, pts: '' }, fillet: { kind: 'fillet', r: 2, edges: [] } };
  const SHAPE_F = { rect: [['x', 'X'], ['y', 'Y'], ['w', 'W'], ['h', 'H']], circle: [['x', 'X'], ['y', 'Y'], ['r', 'R']], polygon: [['x', 'X'], ['y', 'Y'], ['r', 'R'], ['n', 'Sides']], slot: [['x', 'X'], ['y', 'Y'], ['l', 'Length'], ['r', 'R']], points: [] };
  const DENS = [['2.70', 'Aluminium 6061 (2.70 g/cm³)'], ['7.85', 'Steel (7.85 g/cm³)'], ['8.96', 'Copper (8.96 g/cm³)'], ['1.24', 'PLA (1.24 g/cm³)'], ['1.04', 'ABS (1.04 g/cm³)'], ['1.00', 'Water / generic (1.00 g/cm³)']];

  // ---------- model ----------
  // opened files are untrusted: keep only well-formed sketch, edge and hole data (expressions go through the safe evaluator)
  const isNum = x => typeof x === 'number' && isFinite(x), isExpr = x => isNum(x) || (typeof x === 'string' && x.length < 200);
  function cleanSketch(sh) {
    const pts = (Array.isArray(sh.pts) ? sh.pts : []).filter(p => Array.isArray(p) && p.length === 2 && p.every(isNum)).map(p => [p[0], p[1]]), n = pts.length;
    const okI = a => Array.isArray(a) && a.every(i => Number.isInteger(i) && i >= 0 && i < n);
    const cons = (Array.isArray(sh.cons) ? sh.cons : []).filter(c => c && K.CON[c.t] && (!c.s || okI(c.s)) && (!c.p || okI(c.p)) && (!K.CON[c.t][2] || isExpr(c.v)))
      .map(c => { const o = { t: c.t }; if (c.s) o.s = c.s.slice(); if (c.p) o.p = c.p.slice(); if (K.CON[c.t][2]) o.v = c.v; if (c.sg === -1) o.sg = -1; if (c.ra === true) o.ra = true; if (c.rb === true) o.rb = true; return o; });
    const out = { type: 'sketch', hole: !!sh.hole, pts, cons };
    if (Array.isArray(sh.fil)) out.fil = pts.map((_, i) => isExpr(sh.fil[i]) ? sh.fil[i] : null);
    return out;
  }
  function normalize(m) {
    m.params = Array.isArray(m.params) ? m.params : []; m.features = Array.isArray(m.features) ? m.features.filter(f => f && typeof f === 'object' && NAME[f.type]) : []; m.density = +m.density || 2.7;
    m.features.forEach(f => {
      f.p = f.p && typeof f.p === 'object' ? f.p : {}; f.op = ['add', 'cut', 'intersect'].includes(f.op) ? f.op : 'add'; f.name = typeof f.name === 'string' ? f.name : NAME[f.type];
      if (Array.isArray(f.p.shapes)) f.p.shapes = f.p.shapes.filter(sh => sh && typeof sh === 'object').map(sh => sh.type === 'sketch' ? cleanSketch(sh) : sh);
      if (f.type === 'fillet') { f.op = 'add'; f.p.kind = f.p.kind === 'chamfer' ? 'chamfer' : 'fillet'; f.p.edges = (Array.isArray(f.p.edges) ? f.p.edges : []).filter(e => e && [e.a, e.b].every(q => Array.isArray(q) && q.length === 3 && q.every(isNum))).map(e => ({ a: e.a.slice(), b: e.b.slice() })); }
      if (f.type === 'hole') { if (!['simple', 'cbore', 'csink', 'tapped'].includes(f.p.kind)) f.p.kind = 'simple'; if (!['XY', 'XZ', 'YZ'].includes(f.p.plane)) f.p.plane = 'XY'; f.p.flip = !!f.p.flip; if (typeof f.p.pts !== 'string') f.p.pts = ''; }
    });
    return m;
  }
  function vars() { try { return K.evalParams(A.m.params); } catch (e) { return null; } }
  let rebuildT = null;
  function rebuild(resetView) {
    const t0 = performance.now();
    A.result = K.build(A.m);
    const bb = CadView.setBody(A.result.solid, A.edges);
    if (resetView) CadView.view($('viewSel').value, bb);
    showGhost(); applySection(); if (A.pick) refreshPick();
    $('st2').textContent = `Rebuilt in ${Math.round(performance.now() - t0)} ms · ${A.result.solid.triangles().length.toLocaleString()} triangles`;
    renderTree(); renderMass();
  }
  function showGhost() {
    const f = A.m.features[A.sel]; if (!f || f.suppressed) { CadView.setGhost(null); return; }
    const v = vars(); if (!v) { CadView.setGhost(null); return; }
    if (f.type === 'fillet' || f.type === 'mesh' || (A.pick && A.pick.kind === 'edges')) { CadView.setGhost(null); return; }
    try { CadView.setGhost(f.op === 'add' && A.sel === 0 ? null : K.toolOf(f, e => K.evalExpr(e == null ? 0 : e, v), { body: A.result && A.result.solid })); } catch (e) { CadView.setGhost(null); }
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
      const d = Aero.el('div', `aero-item fitem${i === A.sel ? ' sel' : ''}${f.suppressed ? ' sup' : ''}${bad ? ' err' : ''}`, `<span class="ic">${ICON[f.type] || '•'}</span><span class="grow"></span><span class="op">${f.type === 'fillet' ? (f.p.kind === 'chamfer' ? 'chamfer ' : 'R') + esc(f.p.r) + ' · ' + f.p.edges.length + ' edge' + (f.p.edges.length === 1 ? '' : 's') : f.type === 'hole' ? esc(f.p.std || '') + ' ' + ({ cbore: '⌴', csink: '⌵', tapped: 'tap', simple: '' }[f.p.kind] || '') : f.op === 'cut' ? 'cut' : f.op === 'intersect' ? '∩' : ''}${f.pattern && f.pattern.count > 1 ? ' ×' + f.pattern.count : ''}${f.mirror ? ' ⇋' + f.mirror : ''}</span>`);
      d.querySelector('.grow').textContent = f.name + (bad ? ' — ' + lg.msg : ''); d.title = bad ? lg.msg : f.name;
      d.onclick = () => { if (A.pick && A.pick.i !== i) stopPick(); A.sel = i; renderTree(); renderProps(); showGhost(); };
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
    m.features.forEach(f => { Object.keys(f.p).forEach(k => { if (k === 'shapes') f.p.shapes.forEach(s => Object.keys(s).forEach(q => { if (q === 'cons') s.cons.forEach(c => { if (c.v != null) c.v = fix(c.v); }); else if (q === 'fil') s.fil = s.fil.map(fix); else s[q] = fix(s[q]); })); else if (k !== 'edges') f.p[k] = fix(f.p[k]); }); if (f.pattern) Object.keys(f.pattern).forEach(k => f.pattern[k] = fix(f.pattern[k])); });
  }

  // ---------- properties ----------
  function check(expr) { const v = vars(); if (!v) return 'A parameter has an error'; try { K.evalExpr(expr == null ? 0 : expr, v); return null; } catch (e) { return e.message; } }
  const inp = (path, val, ph = '') => `<input data-path="${path}" value="${esc(val ?? '')}" placeholder="${ph}" class="${check(val) ? 'bad' : ''}" title="${esc(check(val) || '')}">`;
  function renderProps() {
    const el = $('props'), f = A.m.features[A.sel];
    if (!f) { el.innerHTML = '<span class="dim">Add a feature from the toolbar — or open the sample from the File menu.</span>'; $('propTitle').textContent = 'Properties'; return; }
    $('propTitle').textContent = (ICON[f.type] || '') + ' ' + NAME[f.type];
    const P = f.p, lg = A.result && A.result.log[A.sel];
    let h = `<div class="pform"><label>Name</label><input data-path="name" value="${esc(f.name)}">`;
    if (f.type === 'fillet') {
      h += `<label>Type</label><select data-path="p.kind"><option value="fillet" ${P.kind !== 'chamfer' ? 'selected' : ''}>Fillet (round)</option><option value="chamfer" ${P.kind === 'chamfer' ? 'selected' : ''}>Chamfer (45°)</option></select>
        <label>${P.kind === 'chamfer' ? 'Distance' : 'Radius'}</label>${inp('p.r', P.r)}`;
      if (lg && !lg.ok && !f.suppressed) h += `<span class="errline">⚠ ${esc(lg.msg)}</span>`;
      const picking = A.pick && A.pick.kind === 'edges' && A.pick.i === A.sel;
      h += `<h4>Edges (${P.edges.length})</h4><div class="elist">${P.edges.map((e, i) => `<div class="erow"><span>Edge ${i + 1}</span><span class="dim mono">${e.a.map(x => +x.toFixed(1)).join(', ')} → ${e.b.map(x => +x.toFixed(1)).join(', ')}</span><button class="aero-btn small" data-edel="${i}" title="Remove">✕</button></div>`).join('') || '<span class="dim">No edges yet.</span>'}</div>
        <span style="grid-column:span 2"><button class="aero-btn small ${picking ? 'pri' : ''}" id="ePick">${picking ? '✔ Done picking' : '⊹ Pick edges in the view'}</button></span>
        <span class="dim" style="grid-column:span 2;font-size:11px">Straight edges between two flat faces. Convex edges are rounded off, inside corners are filled. While picking, the part is shown as it was before this feature.</span></div>`;
      el.innerHTML = h; wireProps(el);
      el.querySelectorAll('[data-edel]').forEach(b => b.onclick = () => A.commit('Remove edge', m => m.features[A.sel].p.edges.splice(+b.dataset.edel, 1)));
      $('ePick').onclick = () => picking ? stopPick() : startPick('edges', A.sel);
      return;
    }
    h += `<label>Operation</label><select data-path="op"><option value="add" ${f.op === 'add' ? 'selected' : ''}>Add (union)</option><option value="cut" ${f.op === 'cut' ? 'selected' : ''}>Cut (subtract)</option><option value="intersect" ${f.op === 'intersect' ? 'selected' : ''}>Intersect</option></select>`;
    if (lg && !lg.ok && !f.suppressed) h += `<span class="errline">⚠ ${esc(lg.msg)}</span>`;
    FIELDS[f.type].forEach(([k, l]) => h += `<label>${l}</label>${inp('p.' + k, P[k])}`);
    if (f.type === 'hole') {
      const picking = A.pick && A.pick.kind === 'face' && A.pick.i === A.sel, std = P.std in K.HOLE_STD ? P.std : 'custom';
      h += `<h4>Hole</h4><label>Standard</label><select data-path="p.std">${Object.keys(K.HOLE_STD).map(k => `<option ${k === std ? 'selected' : ''}>${k}</option>`).join('')}<option value="custom" ${std === 'custom' ? 'selected' : ''}>Custom</option></select>
        <label>Type</label><select data-path="p.kind">${[['simple', 'Clearance hole'], ['cbore', 'Counterbore'], ['csink', 'Countersink'], ['tapped', 'Tapped (tap drill)']].map(([v, l]) => `<option value="${v}" ${P.kind === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label>Diameter</label>${inp('p.d', P.d)}`;
      if (P.kind === 'cbore') h += `<label>Counterbore Ø</label>${inp('p.cd', P.cd)}<label>Counterbore depth</label>${inp('p.cdep', P.cdep)}`;
      if (P.kind === 'csink') h += `<label>Countersink Ø</label>${inp('p.sd', P.sd)}<label>Countersink angle</label>${inp('p.ang', P.ang)}`;
      h += `<label>Depth</label><input data-path="p.depth" value="${esc(P.depth ?? '')}" placeholder="through all" class="${P.depth !== '' && P.depth != null && check(P.depth) ? 'bad' : ''}">
        <h4>Position</h4><label>Face plane</label><select data-path="p.plane">${['XY', 'XZ', 'YZ'].map(p => `<option ${P.plane === p ? 'selected' : ''}>${p}</option>`).join('')}</select><label>Offset</label>${inp('p.offset', P.offset)}
        <label>Reverse</label><label style="justify-self:start"><input type="checkbox" data-path="p.flip" ${P.flip ? 'checked' : ''} style="width:auto"> drill toward +normal</label>
        <label>Centres</label><input data-path="p.pts" value="${esc(P.pts)}" placeholder="x,y; x,y" class="${P.pts && parseBad(P.pts) ? 'bad' : ''}">
        <span style="grid-column:span 2"><button class="aero-btn small ${picking ? 'pri' : ''}" id="hPick">${picking ? '✔ Done placing' : '⊹ Pick on a face'}</button> <span class="dim" style="font-size:11px">click a flat face to add a hole there</span></span>`;
    }
    if (f.type === 'extrude') h += `<label>Symmetric</label><input type="checkbox" data-path="p.symmetric" ${P.symmetric ? 'checked' : ''} style="width:auto">`;
    if (f.type === 'extrude' || f.type === 'revolve') {
      h += `<h4>Sketch</h4><label>Plane</label><select data-path="p.plane">${['XY', 'XZ', 'YZ'].map(p => `<option ${P.plane === p ? 'selected' : ''}>${p}</option>`).join('')}</select><label>Offset</label>${inp('p.offset', P.offset)}`;
      if (f.type === 'revolve') h += `<span class="dim" style="grid-column:span 2;font-size:11px">Revolves around the sketch's vertical axis (u = 0). Keep the profile at u ≥ 0.</span>`;
      (P.shapes || []).forEach((s, i) => {
        if (s.type === 'sketch') {
          const nc = (s.cons || []).length; let st = ''; try { const r = K.solveSketch(s.pts, s.cons || [], e => K.evalExpr(e == null ? 0 : e, vars() || {})); st = !r.ok ? '<span class="bad">conflicting</span>' : r.dof ? r.dof + ' DOF free' : '<span class="good">fully constrained</span>'; } catch (e) { st = '<span class="bad">' + esc(e.message) + '</span>'; }
          h += `<div class="shape"><div class="hd"><span class="sktag">✎ Sketch · ${s.pts.length} points · ${nc} constraint${nc === 1 ? '' : 's'} · ${st}</span><label><input type="checkbox" data-path="p.shapes.${i}.hole" ${s.hole ? 'checked' : ''}> hole</label><button class="aero-btn small" data-sedit="${i}">Edit…</button><button class="aero-btn small" data-sdel="${i}">✕</button></div></div>`;
          return;
        }
        h += `<div class="shape"><div class="hd"><select data-path="p.shapes.${i}.type">${Object.keys(SHAPE_F).map(t => `<option ${t === s.type ? 'selected' : ''}>${t}</option>`).join('')}</select><label><input type="checkbox" data-path="p.shapes.${i}.hole" ${s.hole ? 'checked' : ''}> hole</label><button class="aero-btn small" data-sdel="${i}">✕</button></div>`;
        if (s.type === 'points') h += `<label>Points</label><input class="wide" data-path="p.shapes.${i}.pts" value="${esc(s.pts || '')}" placeholder="x,y; x,y; x,y">`;
        else SHAPE_F[s.type].forEach(([k, l]) => h += `<label>${l}</label>${inp(`p.shapes.${i}.${k}`, s[k])}`);
        h += '</div>';
      });
      h += `<span style="grid-column:span 2"><button class="aero-btn small" id="sAdd">+ Shape</button> <button class="aero-btn small" id="skAdd" title="Draw a profile and constrain it">✎ + Sketch…</button></span><canvas class="skprev" id="skprev"></canvas>`;
    }
    h += `<h4>Placement</h4>${['px', 'py', 'pz'].map((k, i) => `<label>${'XYZ'[i]} offset</label>${inp('p.' + k, P[k], '0')}`).join('')}${['rx', 'ry', 'rz'].map((k, i) => `<label>Rotate ${'XYZ'[i]} (°)</label>${inp('p.' + k, P[k], '0')}`).join('')}`;
    const pat = f.pattern || {};
    h += `<h4>Pattern &amp; mirror</h4><label>Pattern</label><select data-path="pattern.type"><option value="">None</option><option value="linear" ${pat.type === 'linear' ? 'selected' : ''}>Linear</option><option value="circular" ${pat.type === 'circular' ? 'selected' : ''}>Circular (about Z)</option></select>`;
    if (pat.type) { h += `<label>Count</label>${inp('pattern.count', pat.count)}`; if (pat.type === 'linear') h += ['dx', 'dy', 'dz'].map(k => `<label>Step ${k[1].toUpperCase()}</label>${inp('pattern.' + k, pat[k])}`).join(''); else h += `<label>Total angle</label>${inp('pattern.angle', pat.angle)}`; }
    h += `<label>Mirror across</label><select data-path="mirror"><option value="">None</option>${['X', 'Y', 'Z', 'XY', 'XZ', 'YZ', 'XYZ'].map(m => `<option ${f.mirror === m ? 'selected' : ''} value="${m}">${m.split('').join(' + ')}</option>`).join('')}</select></div>`;
    el.innerHTML = h; wireProps(el);
    el.querySelectorAll('[data-sdel]').forEach(b => b.onclick = () => A.commit('Remove shape', m => m.features[A.sel].p.shapes.splice(+b.dataset.sdel, 1)));
    el.querySelectorAll('[data-sedit]').forEach(b => b.onclick = () => editSketch(A.sel, +b.dataset.sedit));
    const sa = $('sAdd'); if (sa) sa.onclick = () => A.commit('Add shape', m => m.features[A.sel].p.shapes.push({ type: 'circle', x: 0, y: 0, r: 5, hole: true }));
    const sk = $('skAdd'); if (sk) sk.onclick = () => editSketch(A.sel, -1);
    const hp = $('hPick'); if (hp) hp.onclick = () => (A.pick ? stopPick() : startPick('face', A.sel));
    drawSketch();
  }
  const parseBad = src => { const v = vars(); if (!v) return true; try { K.parsePts(src, e => K.evalExpr(e, v)).forEach(p => { if (p.length !== 2 || !p.every(isFinite)) throw 0; }); return false; } catch (e) { return true; } };
  function wireProps(el) {
    el.querySelectorAll('[data-path]').forEach(e => e.addEventListener('change', () => {
      const path = e.dataset.path, val = e.type === 'checkbox' ? e.checked : e.value;
      A.commit('Edit ' + path.split('.').pop(), m => {
        const f2 = m.features[A.sel], ks = path.split('.'); let o = f2;
        if (ks[0] === 'pattern') { if (!f2.pattern) f2.pattern = { type: '', count: 2, dx: 20, dy: 0, dz: 0, angle: 360 }; }
        for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]];
        const k = ks[ks.length - 1];
        o[k] = (typeof val === 'string' && /^-?\d+(\.\d+)?$/.test(val.trim())) ? +val : val;
        if (path === 'pattern.type' && !val) delete f2.pattern;
        if (f2.type === 'hole' && (path === 'p.std' || path === 'p.kind') && f2.p.std in K.HOLE_STD) Object.assign(f2.p, K.holeSpec(f2.p.std, f2.p.kind));
        if (f2.type === 'hole' && ['p.d', 'p.cd', 'p.cdep', 'p.sd'].includes(path)) f2.p.std = 'custom';
        if (path.endsWith('.type') && ks[1] === 'shapes') { const s = o; Object.keys(s).forEach(q => { if (!['type', 'hole'].includes(q)) delete s[q]; }); Object.assign(s, { rect: { x: -10, y: -10, w: 20, h: 20 }, circle: { x: 0, y: 0, r: 10 }, polygon: { x: 0, y: 0, r: 10, n: 6 }, slot: { x: 0, y: 0, l: 20, r: 4 }, points: { pts: '0,0; 20,0; 0,20' } }[val]); }
      });
    }));
  }
  function drawSketch() {
    const c = $('skprev'), f = A.m.features[A.sel]; if (!c || !f) return;
    const w = c.clientWidth, h = c.clientHeight, dpr = devicePixelRatio || 1; c.width = w * dpr; c.height = h * dpr; const g = c.getContext('2d'); g.scale(dpr, dpr);
    const v = vars() || {}, ev = e => { try { return K.evalExpr(e == null ? 0 : e, v); } catch (x) { return NaN; } };
    const loops = (f.p.shapes || []).map(s => { let o; try { o = K.shapeOf(s, ev); } catch (e) { o = s.type === 'sketch' ? { type: 'points', pts: s.pts } : { type: 'points', pts: [] }; } return { L: K.loopOf(o, 48), hole: s.hole }; }).filter(x => x.L.length && x.L.every(p => p.every(isFinite)));
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
  function addFeature(type, over = {}) {
    if (A.pick) stopPick();
    const label = over.name || NAME[type], f = { name: label + ' ' + (A.m.features.filter(x => x.type === type).length + 1), type, op: type === 'hole' ? 'cut' : 'add', p: Object.assign(JSON.parse(JSON.stringify(DEFAULTS[type])), over.p || {}) };
    A.commit('Add ' + label, m => { m.features.splice(A.sel + 1, 0, f); }, { now: true }); A.sel = Math.min(A.sel + 1, A.m.features.length - 1); renderTree(); renderProps();
  }
  const evf = () => { const v = vars() || {}; return e => K.evalExpr(e == null ? 0 : e, v); };
  // ---------- sketches ----------
  function editSketch(fi, si) {
    const f = A.m.features[fi]; if (!f) return;
    const shape = si >= 0 ? f.p.shapes[si] : { type: 'sketch', pts: [], cons: [] };
    CadSketcher.open({ shape, ev: evf(), plane: f.p.plane || 'XY', title: `Sketch on ${f.p.plane || 'XY'} — ${f.name}`,
      onOK: sh => A.commit(si >= 0 ? 'Edit sketch' : 'Add sketch', m => { const F = m.features[fi]; if (si >= 0) F.p.shapes[si] = sh; else F.p.shapes.push(sh); }, { now: true }) });
  }
  function newSketchFeature(type) {
    if (A.pick) stopPick();
    Aero.dialog({ title: type === 'extrude' ? 'New sketch extrude' : 'New sketch revolve', instruction: type === 'extrude' ? 'Pick the plane to sketch on. Distance, offset and plane can be changed later in Properties.' : 'Pick the plane to sketch on. The profile revolves around the sketch\'s vertical axis (u = 0).',
      fields: [{ key: 'plane', label: 'Sketch plane', type: 'select', options: [['XY', 'XY — top (extrudes up +Z)'], ['XZ', 'XZ — front (extrudes toward −Y)'], ['YZ', 'YZ — right (extrudes along +X)']], value: type === 'revolve' ? 'XZ' : 'XY' },
        { key: 'offset', label: 'Plane offset', type: 'text', value: '0' }, { key: 'op', label: 'Operation', type: 'select', options: [['add', 'Add material'], ['cut', 'Cut material']], value: 'add' }],
      onOK: v => {
        const off = check(v.offset) ? 0 : (/^-?\d+(\.\d+)?$/.test(String(v.offset).trim()) ? +v.offset : v.offset);
        CadSketcher.open({ shape: { type: 'sketch', pts: [], cons: [] }, ev: evf(), plane: v.plane, title: `Sketch on ${v.plane} — new ${NAME[type].toLowerCase()}`,
          onOK: sh => {
            const f = { name: 'Sketch ' + NAME[type].toLowerCase() + ' ' + (A.m.features.filter(x => x.type === type).length + 1), type, op: v.op === 'cut' ? 'cut' : 'add', p: type === 'extrude' ? { plane: v.plane, offset: off, dist: 10, shapes: [sh] } : { plane: v.plane, offset: off, angle: 360, shapes: [sh] } };
            A.commit('New sketch ' + type, m => m.features.splice(A.sel + 1, 0, f), { now: true }); A.sel = Math.min(A.sel + 1, A.m.features.length - 1); renderTree(); renderProps();
          } });
      } });
  }
  // ---------- picking edges (fillet/chamfer) and faces (holes) in the view ----------
  const VV = K.V;
  const segMatch = (ref, e) => { const L = VV.len(VV.sub(e[1], e[0])), d = VV.mul(VV.sub(e[1], e[0]), 1 / L), dr = VV.unit(VV.sub(ref.b, ref.a)); if (Math.abs(VV.dot(d, dr)) < 0.9995) return false; const w = VV.sub(VV.lerp(ref.a, ref.b, 0.5), e[0]), t = VV.dot(w, d); return VV.len(VV.sub(w, VV.mul(d, t))) < 1e-3 && t > -1e-6 && t < L + 1e-6; };
  function startPick(kind, i, fresh) {
    if (A.measure) toggleMeasure(false);
    A.pick = { kind, i, hover: -1, fresh: !!fresh }; A.sel = i;
    $('hint').textContent = kind === 'edges' ? 'Click edges to add / remove them · Esc when done' : 'Click flat faces to place holes · Esc when done';
    const tip = $('mtip'); tip.style.display = 'block'; tip.innerHTML = kind === 'edges' ? '<b>Pick edges</b> — click straight edges to add or remove them · Esc when done' : '<b>Place holes</b> — click a flat face for each hole centre · Esc when done';
    refreshPick(); renderTree(); renderProps();
  }
  function stopPick() {
    const P = A.pick; if (!P) return; A.pick = null; CadView.setOverlay(null); toggleMeasure(false);
    const f = A.m.features[P.i], empty = f && (P.kind === 'edges' ? !f.p.edges.length : !String(f.p.pts || '').trim());
    if (P.fresh && empty) { A.commit('Cancel ' + f.name, m => m.features.splice(P.i, 1), { now: true }); A.sel = Math.max(0, P.i - 1); Aero.toast('Nothing picked — ' + f.name + ' removed'); renderTree(); }
    rebuild(false); renderProps();
  }
  function refreshPick() {   // called after every rebuild while picking
    const P = A.pick, f = P && A.m.features[P.i]; if (!P) return; if (!f || (P.kind === 'edges' && f.type !== 'fillet') || (P.kind === 'face' && f.type !== 'hole')) { A.pick = null; CadView.setOverlay(null); toggleMeasure(false); return; }
    if (P.kind === 'edges') {   // roll back: show the part as it was before this feature
      const r = K.build({ ...A.m, features: A.m.features.slice(0, P.i) }); P.body = r.solid; P.edges = K.featureEdges(r.solid, 28);
      CadView.setBody(r.solid, A.edges); CadView.setGhost(null); applySection(); pickOverlay();
    }
  }
  function pickOverlay() {
    const P = A.pick; if (!P || P.kind !== 'edges') { CadView.setOverlay(null); return; }
    const f = A.m.features[P.i], list = [];
    f.p.edges.forEach(ref => { const e = P.edges.find(e => segMatch(ref, e)); if (e) list.push({ a: e[0], b: e[1], color: 0xd0202a }); });
    if (P.hover >= 0 && P.edges[P.hover]) list.push({ a: P.edges[P.hover][0], b: P.edges[P.hover][1], color: 0xff8a1f });
    CadView.setOverlay(list);
  }
  function pickClick(e) {
    const P = A.pick, f = A.m.features[P.i];
    if (P.kind === 'edges') {
      const k = CadView.nearestEdge(e, P.edges); if (k < 0) return; const ed = P.edges[k], at = f.p.edges.findIndex(ref => segMatch(ref, ed));
      const r4 = q => q.map(x => Math.round(x * 1e4) / 1e4);
      A.commit(at >= 0 ? 'Remove edge' : 'Pick edge', m => { const E = m.features[P.i].p.edges; if (at >= 0) E.splice(at, 1); else E.push({ a: r4(ed[0]), b: r4(ed[1]) }); }, { now: true });
      return;
    }
    const hit = CadView.pickHit(e); if (!hit) return;
    const n = hit.n, k = n.findIndex(c => Math.abs(c) > 0.999);
    if (k < 0) { Aero.toast('Holes go on flat faces facing X, Y or Z'); return; }
    const p = hit.p, r2 = x => Math.round(x * 100) / 100, r4 = x => Math.round(x * 1e4) / 1e4;
    const face = k === 2 ? { plane: 'XY', offset: r4(p[2]), flip: n[2] < 0, uv: [p[0], p[1]] } : k === 1 ? { plane: 'XZ', offset: r4(-p[1]), flip: n[1] > 0, uv: [p[0], p[2]] } : { plane: 'YZ', offset: r4(p[0]), flip: n[0] < 0, uv: [p[1], p[2]] };
    const has = String(f.p.pts || '').trim(), v = vars() || {};
    let off = NaN; try { off = K.evalExpr(f.p.offset == null ? 0 : f.p.offset, v); } catch (x) { }
    if (has && (f.p.plane !== face.plane || Math.abs(off - face.offset) > 1e-3 || !!f.p.flip !== face.flip)) { Aero.toast('This hole feature is on another face — add a new Hole feature for this face'); return; }
    const pt = `${r2(face.uv[0])},${r2(face.uv[1])}`;
    A.commit('Place hole', m => { const F = m.features[P.i]; if (!has) Object.assign(F.p, { plane: face.plane, offset: face.offset, flip: face.flip }); F.p.pts = has ? F.p.pts + '; ' + pt : pt; }, { now: true });
  }
  let hovT = 0;
  function pickHover(e) { const P = A.pick; if (!P || P.kind !== 'edges' || hovT) return; hovT = requestAnimationFrame(() => { hovT = 0; if (!A.pick) return; const k = CadView.nearestEdge(e, P.edges || []); if (k !== P.hover) { P.hover = k; pickOverlay(); } }); }
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
    const p = await Aero.saveFile({ name: A.docName + '.lcad', data: JSON.stringify({ format: 'lumen-cad', version: 2, model: A.m }), filters: [{ name: 'Lumen CAD part', extensions: ['lcad'] }], path: as ? null : A.filePath });
    if (p) { if (typeof p === 'string' && /[\\/]/.test(p)) A.filePath = p; A.docName = String(p).split(/[\\/]/).pop().replace(/\.lcad$/i, ''); Aero.setDoc(A.docName, false); return true; } return false;
  }
  const exportSTL = () => Aero.saveFile({ name: A.docName + '.stl', data: K.toSTL(A.result.solid, A.docName), filters: [{ name: 'STL (3D printing)', extensions: ['stl'] }] });
  const exportOBJ = () => Aero.saveFile({ name: A.docName + '.obj', data: K.toOBJ(A.result.solid), filters: [{ name: 'Wavefront OBJ', extensions: ['obj'] }] });
  function exportDrawing() {
    const m = K.massProps(A.result.solid), dens = +A.m.density || 1, mat = (DENS.find(([v]) => (+v).toFixed(2) === dens.toFixed(2)) || [0, dens + ' g/cm³'])[1].replace(/ \(.*$/, '');
    Aero.busy('Drawing three views…');
    setTimeout(() => { try { const d = K.drawingSVG(A.result.solid, { name: A.docName, material: mat, mass: (m.volume / 1000 * dens).toFixed(1) + ' g' }); Aero.busy(); Aero.saveFile({ name: A.docName + ' - drawing.svg', data: d.svg, filters: [{ name: 'SVG drawing', extensions: ['svg'] }] }); } catch (e) { Aero.busy(); Aero.alert('Drawing', e.message); } }, 30);
  }
  const exportSTEP = () => { try { return Aero.saveFile({ name: A.docName + '.step', data: K.toSTEP(A.result.solid, { name: A.docName }), filters: [{ name: 'STEP (faceted solid)', extensions: ['step', 'stp'] }] }); } catch (e) { Aero.alert('STEP export', e.message); } };
  const export3MF = () => { try { return Aero.saveFile({ name: A.docName + '.3mf', data: K.to3MF(A.result.solid, { name: A.docName }), filters: [{ name: '3MF (3D printing)', extensions: ['3mf'] }] }); } catch (e) { Aero.alert('3MF export', e.message); } };
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
  function toggleMeasure(on) { if (on && A.pick) stopPick(); A.measure = on ? { pts: [] } : null; $('bMeasure').classList.toggle('on', !!on); if (!on) { CadView.mark([]); $('mtip').style.display = 'none'; } $('hint').textContent = on ? 'Click two points on the part · Esc to stop' : 'Drag to orbit · right-drag to pan · wheel to zoom'; }

  // ---------- wiring ----------
  Aero.init({ name: 'Lumen CAD', icon: '../kit/icons/cad.png', doc: 'Untitled', onDropFiles: openFiles, dropText: 'Drop a .lcad part or an .stl mesh', onSave: () => save(false),
    menus: {
      File: [['New part', 'Ctrl+N', newDoc], ['Open sample (angle bracket)', '', () => load(CadSample.sampleCad(), 'Angle bracket')], ['Open…', 'Ctrl+O', async () => openFiles(await Aero.openFile({ accept: '.lcad,.json,.stl', filters: [{ name: 'Parts and meshes', extensions: ['lcad', 'stl'] }] }))], '-',
        ['Save', 'Ctrl+S', () => save(false)], ['Save as…', 'Ctrl+Shift+S', () => save(true)], '-', '#Export', ['STL for 3D printing…', '', exportSTL], ['3MF for 3D printing (watertight)…', '', export3MF], ['STEP for other CAD (faceted)…', 'Ctrl+Shift+E', exportSTEP], ['Engineering drawing (.svg)…', 'Ctrl+Shift+D', exportDrawing], ['OBJ mesh…', '', exportOBJ], ['Image of the view (.png)…', '', exportPNG], '-', ['Import STL as a feature…', '', async () => openFiles(await Aero.openFile({ accept: '.stl', filters: [{ name: 'STL', extensions: ['stl'] }] }))]],
      Edit: [['Undo', 'Ctrl+Z', () => restore(hist.undo())], ['Redo', 'Ctrl+Y', () => restore(hist.redo())], '-', ['Duplicate feature', 'Ctrl+D', dupSel], ['Suppress / unsuppress', '', supSel], ['Move up', 'Ctrl+Up', () => moveSel(-1)], ['Move down', 'Ctrl+Down', () => moveSel(1)], ['Delete feature', 'Delete', delSel]],
      Insert: ['#Primitives', ...['box', 'cylinder', 'sphere', 'cone', 'torus'].map(k => [NAME[k], '', () => addFeature(k)]), '-', '#Sketch features',
        ['Sketch → Extrude…', 'K', () => newSketchFeature('extrude')], ['Sketch → Revolve…', '', () => newSketchFeature('revolve')], ['Extrude (rectangle)', '', () => addFeature('extrude')], ['Revolve (rectangle)', '', () => addFeature('revolve')], '-', '#Detail features',
        ['Hole wizard…', 'H', () => { addFeature('hole'); startPick('face', A.sel, true); }], ['Fillet edges…', 'F', () => { addFeature('fillet', { p: { kind: 'fillet', r: 3 } }); startPick('edges', A.sel, true); }], ['Chamfer edges…', 'C', () => { addFeature('fillet', { name: 'Chamfer', p: { kind: 'chamfer', r: 1 } }); startPick('edges', A.sel, true); }], '-', ['Parameter', '', () => $('pAdd').click()]],
      View: [['Isometric', '0', () => { $('viewSel').value = 'iso'; CadView.view('iso'); }], ['Front', '1', () => { $('viewSel').value = 'front'; CadView.view('front'); }], ['Top', '7', () => { $('viewSel').value = 'top'; CadView.view('top'); }], ['Right', '3', () => { $('viewSel').value = 'right'; CadView.view('right'); }], '-',
        { label: 'Edges', checked: () => A.edges, fn: () => { A.edges = !A.edges; $('edges').checked = A.edges; CadView.setEdges(A.edges); } }, { label: 'Section view', checked: () => $('section').checked, fn: () => { $('section').checked = !$('section').checked; applySection(); } }, ['Measure', 'M', () => toggleMeasure(!A.measure)]],
      Help: [['Keyboard shortcuts', 'F1', showKeys], ['How Lumen CAD works', '', () => Aero.alert('How Lumen CAD works',
        'A part is a list of features, rebuilt from the top every time something changes.\n\n• Each feature makes a solid (box, cylinder, sketch extrude/revolve…) and adds it to, cuts it from, or intersects it with the part so far.\n• Any number field accepts an expression using your Parameters, e.g. w/2-edge. Change a parameter and the whole part follows.\n• Sketches are made of shapes (rectangles, circles, polygons, slots, point lists) or drawn profiles: Insert → Sketch → Extrude opens the sketcher, where you click a closed outline and pin it down with constraints (horizontal, vertical, parallel, perpendicular, equal, lengths, angles, distances, fixed points) and rounded corners. Dimensions accept parameters, so the profile follows them. Tick "hole" to cut a shape out of the profile.\n• Hole wizard: ISO metric clearance, counterbored, countersunk or tapped holes — click flat faces to place them.\n• Fillet / Chamfer: click straight edges in the view; outside edges are rounded off, inside corners are filled.\n• Patterns repeat a feature in a line or around Z; Mirror copies it across planes.\n• The orange ghost shows the selected feature\'s tool.\n\nFile → Engineering drawing makes an A4 three-view sheet (third-angle) with hidden lines, overall dimensions and a title block.\n\nExport: STL, 3MF (watertight, for slicers), STEP (faceted solid for other CAD), OBJ, PNG.\n\nNot included yet: arcs in sketches, variable/blended fillets where several rounded edges meet, shell, sweep/loft, assemblies.')], '-', ['About Lumen CAD', '', () => Aero.alert('About Lumen CAD', 'Lumen CAD 1.2 — parametric part modelling with a feature tree, constrained sketches, hole wizard, fillets and chamfers.\n\nGeometry kernel: BSP solids after Evan Wallace’s csg.js (MIT). 3-D view: three.js (MIT).\n\nPart of Lumen Studio — free and offline.')]],
    } });
  A.openFiles = openFiles; A.stopPick = () => stopPick(); A.startPick = (k, i) => startPick(k, i); A.newSketchFeature = newSketchFeature; A.editSketch = editSketch;
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
  $('cv').addEventListener('pointerup', e => { if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 4) { if (A.pick) pickClick(e); else measureClick(e); } down = null; });
  $('cv').addEventListener('pointermove', e => { if (A.pick && !down) pickHover(e); });
  Aero.shortcut('Escape', () => { if (A.pick) stopPick(); else toggleMeasure(false); });
  document.querySelectorAll('[data-cmd]').forEach(b => b.onclick = () => ({ sketch: () => newSketchFeature('extrude'), hole: () => { addFeature('hole'); startPick('face', A.sel, true); }, fillet: () => { addFeature('fillet', { p: { kind: 'fillet', r: 3 } }); startPick('edges', A.sel, true); }, chamfer: () => { addFeature('fillet', { name: 'Chamfer', p: { kind: 'chamfer', r: 1 } }); startPick('edges', A.sel, true); } })[b.dataset.cmd]());
  function showKeys() {
    const rows = [['Ctrl+N / Ctrl+O / Ctrl+S', 'New, open, save'], ['Ctrl+Shift+S', 'Save as'], ['Ctrl+Shift+D', 'Export engineering drawing'], ['Ctrl+Shift+E', 'Export STEP'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+D', 'Duplicate feature'], ['Ctrl+↑ / Ctrl+↓', 'Move feature up / down'], ['Delete', 'Delete feature'],
      ['K', 'New sketch → extrude'], ['H', 'Hole wizard'], ['F / C', 'Fillet / chamfer edges'], ['M', 'Measure'], ['Esc', 'Stop measuring / picking'], ['0 1 7 3', 'Isometric, front, top, right view'],
      ['— in the sketcher —', ''], ['Click', 'Place points (Draw) or select (Select); Shift adds'], ['Enter / click first point', 'Close the profile'], ['Alt', 'Place without grid snap'], ['H / V', 'Horizontal / vertical'], ['D', 'Length (one line) or distance (two points)'], ['Delete', 'Delete selected points'], ['Double-click a line', 'Insert a point'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo in the sketch'], ['Wheel / right-drag', 'Zoom / pan']];
    Aero.dialog({ title: 'Keyboard shortcuts', noCancel: true, width: 520, html: `<table class="keys">${rows.map(([k, d]) => d ? `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>` : `<tr><th colspan="2">${esc(k)}</th></tr>`).join('')}</table>` });
  }
  toggleMeasure(false);
  let start = null; try { const j = JSON.parse(localStorage.getItem(AUTOSAVE) || 'null'); if (j && j.m && j.m.features) start = j; } catch (e) { }
  if (start) { load(start.m, start.name); Aero.setDirty(true); } else load(CadSample.sampleCad(), 'Angle bracket');
})();
