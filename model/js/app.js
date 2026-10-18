// Lumen 3D — application: document state, undo, outliner, properties, edit-mode tools, modal transforms,
// gizmo dragging, timeline/playback, files, menus.
(function () {
  'use strict';
  const T = window.THREE, M = window.LMesh, S = window.LScene, IO = window.LIO, V = window.LView, R = window.LRender;
  const $ = id => document.getElementById(id), esc = s => Aero.esc(String(s ?? ''));
  const DEG = 180 / Math.PI, AUTOSAVE = 'lumen-3d-autosave';
  const A = window.L3D = {
    doc: S.newDoc(), sel: new Set(), active: null, mode: 'object', editing: null, selMode: 'vert', esel: M.emptySel(),
    tool: 'move', shading: 'solid', xray: false, showWire: false, snap: false, snapMove: 0.25, snapRot: 15, snapScale: 0.1, orient: 'global',
    docName: 'Untitled', filePath: null, tab: 'object', playing: false, liveMesh: null, rendering: false, loopCuts: 1,
  };
  const hist = new Aero.History({ max: 80, onChange: () => { renderHistory(); } });
  const obj = id => A.doc.objects.find(o => o.id === id);
  const act = () => obj(A.active);
  const editObj = () => A.mode === 'edit' ? obj(A.editing) : null;
  A.meshForRender = o => S.evalMesh(o);

  // ---------- undo ----------
  function cloneObj(o) {
    const c = { ...o, loc: o.loc.slice(), rot: o.rot.slice(), scale: o.scale.slice() };
    if (o.mods) c.mods = o.mods.map(m => ({ ...m })); if (o.keys) c.keys = JSON.parse(JSON.stringify(o.keys));
    if (o.light) c.light = { ...o.light }; if (o.camera) c.camera = { ...o.camera };
    return c; // meshes are immutable values shared between snapshots
  }
  function snap() {
    const d = A.doc;
    return { objects: d.objects.map(cloneObj), materials: d.materials.map(m => ({ ...m })), images: d.images.slice(), world: { ...d.world }, render: { ...d.render }, anim: { ...d.anim },
      sel: [...A.sel], active: A.active, mode: A.mode, editing: A.editing, selMode: A.selMode, esel: { V: [...A.esel.V], E: [...A.esel.E], F: [...A.esel.F] } };
  }
  function restore(s) {
    if (!s) return; const d = A.doc;
    d.objects = s.objects.map(cloneObj); d.materials = s.materials.map(m => ({ ...m })); d.images = s.images.slice(); d.world = { ...s.world }; d.render = { ...s.render }; d.anim = { ...s.anim, frame: d.anim.frame };
    A.sel = new Set(s.sel.filter(id => obj(id))); A.active = obj(s.active) ? s.active : null; A.mode = s.mode === 'edit' && obj(s.editing) ? 'edit' : 'object'; A.editing = A.mode === 'edit' ? s.editing : null;
    A.selMode = s.selMode; A.esel = { V: new Set(s.esel.V), E: new Set(s.esel.E), F: new Set(s.esel.F) };
    const eo = editObj(); if (eo) A.esel = M.flush(eo.mesh, A.selMode, A.esel);
    V.clearMaterialCache(); refresh();
  }
  function commit(label) { hist.push(label, snap()); refresh(); autosave(); }
  A.undo = () => { if (modal) return; restore(hist.undo()); };
  A.redo = () => { if (modal) return; restore(hist.redo()); };
  let asTimer = 0;
  function autosave() { clearTimeout(asTimer); asTimer = setTimeout(() => { try { const s = S.serialize(A.doc); if (s.length < 4e6) localStorage.setItem(AUTOSAVE, s); } catch (e) { /* storage full or unavailable */ } }, 1500); }

  // ---------- refresh ----------
  function refresh() {
    V.sync();
    const eo = editObj(); if (eo) V.setEdit(eo, A.liveMesh || eo.mesh, A.esel, A.selMode); else V.setEdit(null);
    updateGizmo(); renderOutliner(); renderProps(); renderTimeline(); renderCmd(); status();
  }
  A.refresh = refresh;
  const quick = () => { V.sync(); const eo = editObj(); if (eo) V.updateEditMatrix(); updateGizmo(); renderTimeline(); status(); };

  // ---------- status ----------
  function status(msg) {
    const eo = editObj();
    if (eo) { const m = eo.mesh, s = A.esel; $('st1').textContent = `Edit Mode · ${eo.name}`; $('st2').textContent = `Verts ${s.V.size}/${m.v.length} · Edges ${s.E.size}/${M.edgeMap(m).size} · Faces ${s.F.size}/${m.f.length}`; }
    else {
      const o = act(); $('st1').textContent = o ? `${o.name}` : 'Object Mode';
      let v = 0, f = 0, tri = 0; A.doc.objects.forEach(x => { if (x.type === 'mesh' && x.visible) { const em = S.evalMesh(x); v += em.v.length; f += em.f.length; tri += em.f.reduce((a, q) => a + q.length - 2, 0); } });
      $('st2').textContent = `Objects ${A.sel.size}/${A.doc.objects.length} · Verts ${v.toLocaleString()} · Faces ${f.toLocaleString()} · Tris ${tri.toLocaleString()}`;
    }
    $('st3').textContent = msg != null ? msg : `Frame ${A.doc.anim.frame}`;
  }

  // ---------- outliner ----------
  const ICONS = { mesh: '<svg viewBox="0 0 16 16"><path d="M8 1.5 14 5v6l-6 3.5L2 11V5z" fill="#f3a74a" stroke="#8a4f12" stroke-width="1"/><path d="M2 5l6 3.5L14 5M8 8.5V14.5" fill="none" stroke="#8a4f12" stroke-width="1"/></svg>',
    light: '<svg viewBox="0 0 16 16"><circle cx="8" cy="7" r="4.2" fill="#ffe27a" stroke="#9a7a10"/><path d="M6 12.5h4M6.5 14.5h3" stroke="#7a6a30" stroke-width="1.3"/></svg>',
    camera: '<svg viewBox="0 0 16 16"><rect x="1.5" y="4.5" width="9" height="7" rx="1" fill="#8fb4de" stroke="#2c4f7a"/><path d="M10.5 7 14.5 5v6l-4-2z" fill="#8fb4de" stroke="#2c4f7a"/></svg>' };
  const EYE = on => on ? '<svg viewBox="0 0 16 16"><path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8z" fill="none" stroke="#2c4f7a" stroke-width="1.2"/><circle cx="8" cy="8" r="2" fill="#2c4f7a"/></svg>' : '<svg viewBox="0 0 16 16"><path d="M2 8s2.4-3 6-3 6 3 6 3M3 11l10-6" fill="none" stroke="#9aa5b1" stroke-width="1.2"/></svg>';
  function renderOutliner() {
    const el = $('outliner'); el.innerHTML = '';
    A.doc.objects.forEach(o => {
      const anim = S.isAnimated(o), mods = o.mods && o.mods.length;
      const it = Aero.el('div', 'aero-item oitem' + (A.sel.has(o.id) ? ' sel' : '') + (o.id === A.active ? ' act' : '') + (o.visible ? '' : ' hid'),
        `<span class="oi">${ICONS[o.type]}</span><span class="grow">${esc(o.name)}</span>${mods ? `<span class="tag" title="${mods} modifier${mods > 1 ? 's' : ''}"><svg viewBox="0 0 16 16" width="11" height="11"><path d="M10.5 1.5a4 4 0 0 0-3.8 5.2L1.8 11.6a1.4 1.4 0 0 0 2 2l4.9-4.9a4 4 0 0 0 5.2-3.8l-2.3 2.3-2.2-.6-.6-2.2z" fill="#5b7fa8"/></svg>${mods}</span>` : ''}${anim ? '<span class="tag key" title="Animated">◆</span>' : ''}${A.doc.render.camera === o.id ? '<span class="tag" title="Active camera">🎥</span>' : ''}<button class="eye" title="Show / hide (H)">${EYE(o.visible)}</button>`);
      it.onclick = e => {
        if (e.target.closest('.eye')) { o.visible = !o.visible; commit(o.visible ? 'Show ' + o.name : 'Hide ' + o.name); return; }
        if (A.mode === 'edit') setMode('object');
        if (e.ctrlKey || e.shiftKey) { if (A.sel.has(o.id) && A.active === o.id) A.sel.delete(o.id); else A.sel.add(o.id); A.active = A.sel.has(o.id) ? o.id : [...A.sel][0] || null; }
        else { A.sel = new Set([o.id]); A.active = o.id; }
        refresh();
      };
      it.ondblclick = async e => { if (e.target.closest('.eye')) return; const n = await Aero.prompt('Rename', 'Name', o.name); if (n && n.trim()) { o.name = n.trim().slice(0, 80); commit('Rename'); } };
      el.appendChild(it);
    });
    if (!A.doc.objects.length) el.innerHTML = '<div class="empty">The scene is empty.<br>Use <b>Add</b> to create a mesh, light or camera — or <b>File › Open Sample</b>.</div>';
    $('oCount').textContent = A.doc.objects.length;
  }
  function renderHistory() { Aero.renderHistory($('hist'), hist, i => { if (!modal) restore(hist.go(i)); }); }

  // ---------- command bar state ----------
  function renderCmd() {
    $('modeSel').value = A.mode;
    document.querySelectorAll('[data-sm]').forEach(b => { b.classList.toggle('on', b.dataset.sm === A.selMode); b.style.display = A.mode === 'edit' ? '' : 'none'; });
    document.querySelectorAll('.editonly').forEach(b => b.style.display = A.mode === 'edit' ? '' : 'none');
    document.querySelectorAll('[data-shade]').forEach(b => b.classList.toggle('on', b.dataset.shade === A.shading));
    $('snapChk').checked = A.snap; $('xrayChk').checked = A.xray; $('orientSel').value = A.orient;
    if (toolbox) toolbox.set(A.tool);
  }

  // ---------- properties ----------
  const num = (k, v, step = 0.1, extra = '') => `<input type="number" data-k="${k}" value="${+(+v).toFixed(step >= 1 ? 2 : 4)}" step="${step}" ${extra}>`;
  const keyBtn = (o, ch) => { const has = o.keys && o.keys[ch] && o.keys[ch].some(k => k.f === A.doc.anim.frame), any = o.keys && o.keys[ch]; return `<button class="kbtn${has ? ' on' : any ? ' any' : ''}" data-key="${ch}" title="${has ? 'Delete' : 'Insert'} keyframe for ${ch} at frame ${A.doc.anim.frame}">◆</button>`; };
  function renderProps() {
    document.querySelectorAll('#tabs .aero-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === A.tab));
    const el = $('props'), o = act(), tab = A.tab;
    if (el.contains(document.activeElement) && document.activeElement.matches('input[type=number],input[type=text]') && !el.dataset.force) return;
    delete el.dataset.force;
    let h = '';
    if (tab === 'object') h = objectTab(o);
    else if (tab === 'mods') h = modsTab(o);
    else if (tab === 'mat') h = matTab(o);
    else if (tab === 'world') h = worldTab();
    else h = renderTab();
    el.innerHTML = h;
  }
  function objectTab(o) {
    const eo = editObj();
    if (eo) {
      const ids = [...A.esel.V], c = ids.length ? M.vec.avg(ids.map(i => eo.mesh.v[i])) : [0, 0, 0], st = M.stats(eo.mesh);
      return `<div class="pform"><h4>${esc(eo.name)} · Edit Mode</h4>
        ${ids.length ? `<label>Median X</label>${num('med0', c[0])}<label>Median Y</label>${num('med1', c[1])}<label>Median Z</label>${num('med2', c[2])}` : '<p class="dim span2">Nothing selected. Click vertices, edges or faces (Shift adds, drag for a box).</p>'}
        <h4>Mesh</h4><div class="kv span2"><b>Vertices</b><span>${st.V}</span><b>Edges</b><span>${st.E}</span><b>Faces</b><span>${st.F}</span><b>Triangles</b><span>${st.tris}</span>
        <b>Boundary edges</b><span>${st.boundary}</span><b>Non-manifold</b><span>${st.nonManifold}</span><b>Closed</b><span>${st.manifold ? 'yes, manifold' : st.closed ? 'closed (check normals)' : 'no'}</span></div>
        <h4>Tips</h4><p class="dim span2">G / R / S move, rotate, scale (then X, Y or Z to lock an axis, type a number, Enter). E extrude, I inset, Ctrl+B bevel, Ctrl+R loop cut, M merge, X delete, Tab leaves Edit Mode.</p></div>`;
    }
    if (!o) return '<div class="pform"><p class="dim span2">No active object. Click an object in the viewport or the outliner.</p></div>';
    const t = S.trsAt(o, A.doc.anim.frame);
    let h = `<div class="pform"><label>Name</label><input type="text" data-k="name" value="${esc(o.name)}">
      <h4>Transform</h4>
      <div class="trs span2"><span class="lab">Location</span>${keyBtn(o, 'loc')}${num('loc0', t.loc[0])}${num('loc1', t.loc[1])}${num('loc2', t.loc[2])}
      <span class="lab">Rotation°</span>${keyBtn(o, 'rot')}${num('rot0', t.rot[0] * DEG, 5)}${num('rot1', t.rot[1] * DEG, 5)}${num('rot2', t.rot[2] * DEG, 5)}
      <span class="lab">Scale</span>${keyBtn(o, 'scale')}${num('scale0', t.scale[0])}${num('scale1', t.scale[1])}${num('scale2', t.scale[2])}</div>
      <label>Visible</label><input type="checkbox" data-k="visible" ${o.visible ? 'checked' : ''}><label>In render</label><input type="checkbox" data-k="render" ${o.render !== false ? 'checked' : ''}>`;
    if (o.type === 'mesh') {
      const st = M.stats(o.mesh);
      h += `<h4>Shading</h4><label>Smooth</label><input type="checkbox" data-k="smooth" ${o.smooth ? 'checked' : ''}>
        <label>Auto smooth °</label>${num('autoSmooth', o.autoSmooth ?? 180, 5, 'min="0" max="180"')}
        <h4>Mesh data</h4><div class="kv span2"><b>Vertices</b><span>${st.V}</span><b>Faces</b><span>${st.F}</span><b>Manifold</b><span>${st.manifold ? 'yes' : 'no'}</span></div>`;
    } else if (o.type === 'light') {
      const L = o.light;
      h += `<h4>Light</h4><label>Type</label><select data-k="light.kind"><option value="point" ${L.kind === 'point' ? 'selected' : ''}>Point</option><option value="sun" ${L.kind === 'sun' ? 'selected' : ''}>Sun</option></select>
        <label>Colour</label><input type="color" data-k="light.color" value="${L.color}">
        ${L.kind === 'sun' ? `<label>Strength</label>${num('light.strength', L.strength, 0.1, 'min="0"')}<label>Angle °</label>${num('light.angle', L.angle * DEG, 0.5, 'min="0" max="90"')}` : `<label>Power (W)</label>${num('light.power', L.power, 50, 'min="0"')}<label>Radius</label>${num('light.radius', L.radius, 0.05, 'min="0"')}`}`;
    } else if (o.type === 'camera') {
      const C = o.camera;
      h += `<h4>Camera</h4><label>Field of view °</label>${num('camera.fov', C.fov, 1, 'min="1" max="170"')}
        <label>Aperture</label>${num('camera.aperture', C.aperture, 0.01, 'min="0"')}<label>Focus distance</label>${num('camera.focus', C.focus, 0.1, 'min="0.01"')}
        <label></label><div class="row"><button class="aero-btn small" data-act="setcam">${A.doc.render.camera === o.id ? '✓ Active camera' : 'Set as active camera'}</button><button class="aero-btn small" data-act="viewcam">Look through</button></div>
        <label></label><button class="aero-btn small" data-act="camtoview">Align camera to view</button>`;
    }
    return h + '</div>';
  }
  const MOD_NAMES = { subsurf: 'Subdivision Surface', mirror: 'Mirror', array: 'Array', solidify: 'Solidify' };
  function modsTab(o) {
    if (!o || o.type !== 'mesh') return '<div class="pform"><p class="dim span2">Select a mesh object to add modifiers.</p></div>';
    let h = `<div class="pform"><label>Add</label><select data-act="addmod"><option value="">Add modifier…</option>${Object.entries(MOD_NAMES).map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></div>`;
    (o.mods || []).forEach((m, i) => {
      h += `<div class="modcard${m.enabled === false ? ' off' : ''}" data-mi="${i}"><div class="mh"><input type="checkbox" data-mk="enabled" ${m.enabled !== false ? 'checked' : ''} title="Show in viewport and render"><b>${MOD_NAMES[m.type]}</b><span class="grow"></span>
        <button class="aero-iconbtn" data-mact="up" title="Move up">▲</button><button class="aero-iconbtn" data-mact="down" title="Move down">▼</button><button class="aero-iconbtn" data-mact="apply" title="Apply (bake into the mesh)">✓</button><button class="aero-iconbtn" data-mact="del" title="Remove">✕</button></div><div class="pform">`;
      const n = (k, label, step, ex = '') => `<label>${label}</label><input type="number" data-mk="${k}" value="${m[k]}" step="${step}" ${ex}>`, c = (k, label) => `<label>${label}</label><input type="checkbox" data-mk="${k}" ${m[k] ? 'checked' : ''}>`;
      if (m.type === 'subsurf') h += n('levels', 'Levels', 1, 'min="0" max="4"');
      if (m.type === 'mirror') h += `<label>Axis</label><div class="row">${['x', 'y', 'z'].map(a => `<label class="chk"><input type="checkbox" data-mk="${a}" ${m[a] ? 'checked' : ''}>${a.toUpperCase()}</label>`).join('')}</div>` + c('merge', 'Merge seam') + n('threshold', 'Merge distance', 0.001, 'min="0"');
      if (m.type === 'array') h += n('count', 'Count', 1, 'min="1" max="200"') + `<label>Relative offset</label><div class="row3"><input type="number" data-mk="rx" value="${m.rx}" step="0.1"><input type="number" data-mk="ry" value="${m.ry}" step="0.1"><input type="number" data-mk="rz" value="${m.rz}" step="0.1"></div><label>Constant offset</label><div class="row3"><input type="number" data-mk="cx" value="${m.cx}" step="0.1"><input type="number" data-mk="cy" value="${m.cy}" step="0.1"><input type="number" data-mk="cz" value="${m.cz}" step="0.1"></div>` + c('merge', 'Merge');
      if (m.type === 'solidify') h += n('thickness', 'Thickness', 0.01) + n('offset', 'Offset (-1…1)', 0.1, 'min="-1" max="1"') + c('rim', 'Fill rim');
      h += '</div></div>';
    });
    if (!(o.mods || []).length) h += '<p class="dim pad">No modifiers. Modifiers change the mesh non-destructively and are evaluated top to bottom.</p>';
    return h;
  }
  function matTab(o) {
    if (!o || o.type !== 'mesh') return '<div class="pform"><p class="dim span2">Select a mesh object to edit its material.</p></div>';
    const m = A.doc.materials.find(x => x.id === o.mat);
    let h = `<div class="pform"><label>Material</label><div class="row"><select data-act="pickmat"><option value="">— none —</option>${A.doc.materials.map(x => `<option value="${x.id}" ${x.id === o.mat ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select><button class="aero-btn small" data-act="newmat" title="New material">New</button>${m ? '<button class="aero-btn small" data-act="dupmat" title="Duplicate material">Copy</button>' : ''}</div>`;
    if (!m) return h + '<p class="dim span2">This object uses the default grey material. Click <b>New</b> to create one.</p></div>';
    const users = A.doc.objects.filter(x => x.mat === m.id).length, img = m.tex && A.doc.images.find(i => i.id === m.tex);
    h += `<label>Name</label><input type="text" data-m="name" value="${esc(m.name)}"><div class="swatch span2" style="background:radial-gradient(circle at 35% 30%, #fff 0, ${m.color} 28%, #000 140%)"></div>
      <h4>Surface${users > 1 ? ` <span class="dim">· shared by ${users} objects</span>` : ''}</h4>
      <label>Base colour</label><input type="color" data-m="color" value="${m.color}">
      <label>Metallic</label><div class="rng"><input type="range" data-m="metal" min="0" max="1" step="0.01" value="${m.metal}"><span>${(+m.metal).toFixed(2)}</span></div>
      <label>Roughness</label><div class="rng"><input type="range" data-m="rough" min="0" max="1" step="0.01" value="${m.rough}"><span>${(+m.rough).toFixed(2)}</span></div>
      <label>Transmission</label><div class="rng"><input type="range" data-m="transmission" min="0" max="1" step="0.01" value="${m.transmission}"><span>${(+m.transmission).toFixed(2)}</span></div>
      <label>IOR</label><input type="number" data-m="ior" value="${m.ior}" step="0.01" min="1" max="3">
      <h4>Emission</h4><label>Colour</label><input type="color" data-m="emit" value="${m.emit}"><label>Strength</label><input type="number" data-m="emitStrength" value="${m.emitStrength}" step="0.5" min="0">
      <h4>Base colour texture</h4>
      ${img ? `<div class="texrow span2"><img src="${img.data}" alt=""><span class="grow">${esc(img.name)}</span><button class="aero-btn small" data-act="rmtex">Remove</button></div>` : ''}
      <label></label><div class="row"><button class="aero-btn small" data-act="loadtex">${img ? 'Replace image…' : 'Load image…'}</button>${A.doc.images.length ? `<select data-act="picktex"><option value="">Use existing…</option>${A.doc.images.map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select>` : ''}</div>
      <p class="dim span2">Faces without UVs (new geometry from edits) use box projection.</p></div>`;
    return h;
  }
  function worldTab() {
    const w = A.doc.world;
    return `<div class="pform"><h4>World</h4><label>Background</label><select data-w="mode"><option value="sky" ${w.mode === 'sky' ? 'selected' : ''}>Sky gradient</option><option value="color" ${w.mode === 'color' ? 'selected' : ''}>Solid colour</option></select>
      ${w.mode === 'sky' ? `<label>Zenith</label><input type="color" data-w="zenith" value="${w.zenith}"><label>Horizon</label><input type="color" data-w="horizon" value="${w.horizon}"><label>Ground</label><input type="color" data-w="ground" value="${w.ground}">` : `<label>Colour</label><input type="color" data-w="color" value="${w.color}">`}
      <label>Strength</label><input type="number" data-w="strength" value="${w.strength}" step="0.1" min="0"><p class="dim span2">The world lights the scene in Material view and in the final render.</p></div>`;
  }
  function renderTab() {
    const r = A.doc.render, cams = A.doc.objects.filter(o => o.type === 'camera');
    return `<div class="pform"><h4>Output</h4><label>Width</label><input type="number" data-r="width" value="${r.width}" step="16" min="16" max="8192"><label>Height</label><input type="number" data-r="height" value="${r.height}" step="16" min="16" max="8192">
      <label>Preset</label><select data-act="rpreset"><option value="">Choose…</option><option value="640x360">640 × 360</option><option value="960x540">960 × 540</option><option value="1280x720">1280 × 720 (HD)</option><option value="1920x1080">1920 × 1080 (Full HD)</option><option value="1080x1080">1080 × 1080 (square)</option></select>
      <h4>Path tracing</h4><label>Samples</label><input type="number" data-r="samples" value="${r.samples}" step="16" min="1"><label>Max bounces</label><input type="number" data-r="bounces" value="${r.bounces}" step="1" min="1" max="32">
      <label>Exposure</label><input type="number" data-r="exposure" value="${r.exposure}" step="0.1"><label>View transform</label><select data-r="look"><option value="filmic" ${r.look === 'filmic' ? 'selected' : ''}>Filmic</option><option value="standard" ${r.look === 'standard' ? 'selected' : ''}>Standard</option></select>
      <label>Camera</label><select data-r="camera"><option value="">${cams.length ? 'First camera' : 'Viewport (no camera)'}</option>${cams.map(c => `<option value="${c.id}" ${r.camera === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <label></label><button class="aero-btn pri" data-act="render">Render Image (F12)</button>
      <h4>Animation</h4><label>Frames</label><span>${A.doc.anim.start} – ${A.doc.anim.end} at ${A.doc.anim.fps} fps</span>
      <label></label><button class="aero-btn" data-act="renderanim">Render Animation…</button>
      <p class="dim span2">Progressive CPU path tracer using ${R.workers()} worker threads: GGX metal/roughness, glass, emission with light sampling, soft shadows, sky lighting, depth of field.</p></div>`;
  }
  // property events
  function propInput(e, final) {
    const t = e.target, o = act();
    if (t.dataset.k && o) {
      const k = t.dataset.k, val = t.type === 'checkbox' ? t.checked : t.type === 'number' ? parseFloat(t.value) : t.value;
      if (t.type === 'number' && !isFinite(val)) return;
      const eo = editObj();
      if (/^med\d$/.test(k) && eo) {
        if (!final) return; const ax = +k[3], ids = [...A.esel.V], c = M.vec.avg(ids.map(i => eo.mesh.v[i])), d = val - c[ax];
        eo.mesh = M.transformVerts(eo.mesh, ids, p => { const q = p.slice(); q[ax] += d; return q; }); V.invalidate(eo.id); commit('Move vertices'); return;
      }
      const m = /^(loc|rot|scale)(\d)$/.exec(k);
      if (m) { const ch = m[1], i = +m[2], cur = S.trsAt(o, A.doc.anim.frame)[ch]; cur[i] = ch === 'rot' ? val / DEG : val; setChannel(o, ch, cur); quick(); if (final) commit('Transform'); return; }
      if (k.includes('.')) { const [a, b] = k.split('.'); o[a][b] = b === 'angle' ? val / DEG : val; if (final || t.tagName === 'SELECT' || t.type === 'color') { V.invalidate(o.id); if (b === 'kind') $('props').dataset.force = 1; commit('Edit ' + o.type); } else { V.invalidate(o.id); quick(); } return; }
      if (k === 'name') { if (final) { o.name = String(val).slice(0, 80) || o.name; commit('Rename'); } return; }
      o[k] = val; V.invalidate(o.id); if (final || t.type === 'checkbox') commit('Edit object'); else quick(); return;
    }
    if (t.dataset.m && o) {
      const mt = A.doc.materials.find(x => x.id === o.mat); if (!mt) return; const k = t.dataset.m;
      let val = t.type === 'number' || t.type === 'range' ? parseFloat(t.value) : t.value; if ((t.type === 'number' || t.type === 'range') && !isFinite(val)) return;
      if (k === 'name') { if (final) { mt.name = String(val).slice(0, 80); commit('Rename material'); } return; }
      mt[k] = val; if (t.type === 'range') t.nextElementSibling.textContent = val.toFixed(2);
      V.clearMaterialCache(); V.sync(); if (final) commit('Edit material'); return;
    }
    if (t.dataset.mk && o) {
      const card = t.closest('.modcard'), md = o.mods[+card.dataset.mi], k = t.dataset.mk;
      let val = t.type === 'checkbox' ? t.checked : parseFloat(t.value); if (t.type !== 'checkbox' && !isFinite(val)) return;
      if (k === 'levels') val = Math.max(0, Math.min(4, Math.round(val))); if (k === 'count') val = Math.max(1, Math.min(200, Math.round(val)));
      md[k] = val; V.invalidate(o.id); quick(); if (final || t.type === 'checkbox') { $('props').dataset.force = 1; commit('Edit modifier'); } return;
    }
    if (t.dataset.w) { const k = t.dataset.w, val = t.type === 'number' ? parseFloat(t.value) : t.value; if (t.type === 'number' && !isFinite(val)) return; A.doc.world[k] = val; V.sync(); if (final || t.tagName === 'SELECT') { $('props').dataset.force = 1; commit('Edit world'); } return; }
    if (t.dataset.r) {
      const k = t.dataset.r; let val = t.type === 'number' ? parseFloat(t.value) : t.value; if (t.type === 'number' && !isFinite(val)) return;
      if (k === 'width' || k === 'height') val = Math.max(16, Math.min(8192, Math.round(val))); if (k === 'samples') val = Math.max(1, Math.round(val)); if (k === 'bounces') val = Math.max(1, Math.min(32, Math.round(val)));
      if (k === 'camera') val = val || null;
      A.doc.render[k] = val; if (final || t.tagName === 'SELECT') { A.doc.objects.forEach(x => x.type === 'camera' && V.invalidate(x.id)); commit('Render settings'); }
    }
  }
  function setChannel(o, ch, value) {
    if (o.keys && o.keys[ch] && o.keys[ch].length) S.setKey(o, ch, A.doc.anim.frame, value, (o.keys[ch].find(k => k.f === A.doc.anim.frame) || o.keys[ch][0]).ease); // animated channels auto-key
    o[ch] = value.slice();
  }
  async function propAction(e) {
    const b = e.target.closest('[data-act],[data-mact],[data-key]'); if (!b) return; const o = act();
    if (b.dataset.key && o) { toggleKey(o, b.dataset.key); return; }
    if (b.dataset.mact && o) {
      const i = +b.closest('.modcard').dataset.mi, mods = o.mods, a = b.dataset.mact;
      if (a === 'up' && i > 0) [mods[i - 1], mods[i]] = [mods[i], mods[i - 1]];
      else if (a === 'down' && i < mods.length - 1) [mods[i + 1], mods[i]] = [mods[i], mods[i + 1]];
      else if (a === 'del') mods.splice(i, 1);
      else if (a === 'apply') { o.mesh = M.evaluate(o.mesh, mods.slice(0, i + 1)); mods.splice(0, i + 1); }
      V.invalidate(o.id); $('props').dataset.force = 1; commit(a === 'apply' ? 'Apply modifier' : 'Modifier stack'); return;
    }
    const a = b.dataset.act;
    if (a === 'setcam' && o) { A.doc.render.camera = o.id; commit('Set active camera'); }
    else if (a === 'viewcam' && o) V.lookThrough(S.cameraFrom(o, A.doc.anim.frame));
    else if (a === 'camtoview' && o) cameraToView(o);
    else if (a === 'newmat' && o) { const m = S.newMaterial('Material ' + (A.doc.materials.length + 1), '#' + ['c8c8c8', 'd94a3d', '3d7ad9', '45b06a', 'e0b03a'][A.doc.materials.length % 5]); A.doc.materials.push(m); o.mat = m.id; V.clearMaterialCache(); commit('New material'); }
    else if (a === 'dupmat' && o) { const s = A.doc.materials.find(x => x.id === o.mat); const m = { ...s, id: S.uid(), name: s.name + ' copy' }; A.doc.materials.push(m); o.mat = m.id; commit('Duplicate material'); }
    else if (a === 'rmtex' && o) { const m = A.doc.materials.find(x => x.id === o.mat); m.tex = null; V.clearMaterialCache(); pruneImages(); commit('Remove texture'); }
    else if (a === 'loadtex' && o) { const f = await Aero.openFile({ accept: 'image/png,image/jpeg,image/webp', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }); if (f[0]) await loadTexture(f[0], o); }
    else if (a === 'render') renderStill();
    else if (a === 'renderanim') renderAnim();
  }
  function propSelect(e) {
    const t = e.target, o = act(), a = t.dataset.act; if (!a) return;
    if (a === 'addmod' && o && t.value) { addModifier(o, t.value); }
    else if (a === 'pickmat' && o) { o.mat = t.value || null; V.clearMaterialCache(); commit('Assign material'); }
    else if (a === 'picktex' && o && t.value) { const m = A.doc.materials.find(x => x.id === o.mat); m.tex = t.value; V.clearMaterialCache(); commit('Assign texture'); }
    else if (a === 'rpreset' && t.value) { const [w, h] = t.value.split('x').map(Number); A.doc.render.width = w; A.doc.render.height = h; A.doc.objects.forEach(x => x.type === 'camera' && V.invalidate(x.id)); commit('Render size'); }
  }
  function addModifier(o, type) {
    const base = { id: S.uid(), type, enabled: true };
    const def = { subsurf: { levels: 1 }, mirror: { x: true, y: false, z: false, merge: true, threshold: 0.001 }, array: { count: 3, rx: 1.1, ry: 0, rz: 0, cx: 0, cy: 0, cz: 0, merge: false }, solidify: { thickness: 0.1, offset: -1, rim: true } }[type];
    o.mods = o.mods || []; o.mods.push({ ...base, ...def }); V.invalidate(o.id); A.tab = 'mods'; $('props').dataset.force = 1; commit('Add ' + MOD_NAMES[type]);
  }
  function pruneImages() { const used = new Set(A.doc.materials.map(m => m.tex).filter(Boolean)); A.doc.images = A.doc.images.filter(i => used.has(i.id)); }
  async function loadTexture(f, o) {
    const ext = (f.name.split('.').pop() || '').toLowerCase(), mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    const data = IO.bytesToDataUrl(new Uint8Array(f.data), mime), img = new Image(); img.src = data;
    try { await img.decode(); } catch (e) { Aero.alert('Image', 'This file could not be read as an image.'); return; }
    let m = A.doc.materials.find(x => x.id === o.mat); if (!m) { m = S.newMaterial('Material ' + (A.doc.materials.length + 1), '#ffffff'); A.doc.materials.push(m); o.mat = m.id; }
    const im = { id: S.uid(), name: f.name.slice(0, 80), data }; A.doc.images.push(im); m.tex = im.id; if (m.color === '#cccccc') m.color = '#ffffff';
    V.clearMaterialCache(); pruneImages(); if (A.shading === 'solid') A.shading = 'material'; commit('Load texture');
  }

  // ---------- keyframes ----------
  function toggleKey(o, ch) {
    const f = A.doc.anim.frame, has = o.keys && o.keys[ch] && o.keys[ch].some(k => k.f === f);
    if (has) { S.delKey(o, f, ch); commit('Delete keyframe'); }
    else { S.setKey(o, ch, f, S.trsAt(o, f)[ch]); commit('Insert keyframe'); }
  }
  function insertKeys(chs = S.CHANNELS) {
    const objs = [...A.sel].map(obj).filter(Boolean); if (!objs.length) return Aero.toast('Select objects to keyframe');
    const f = A.doc.anim.frame; objs.forEach(o => { const t = S.trsAt(o, f); chs.forEach(ch => S.setKey(o, ch, f, t[ch])); });
    commit('Insert keyframe'); Aero.toast(`Keyframe inserted at frame ${f}`);
  }
  function deleteKeys() { const f = A.doc.anim.frame; let n = 0; [...A.sel].map(obj).filter(Boolean).forEach(o => { if (S.keyFrames(o).includes(f)) { S.delKey(o, f); n++; } }); if (n) commit('Delete keyframe'); else Aero.toast('No keyframe on this frame'); }
  function clearKeys() { [...A.sel].map(obj).filter(Boolean).forEach(o => { const t = S.trsAt(o, A.doc.anim.frame); o.loc = t.loc; o.rot = t.rot; o.scale = t.scale; delete o.keys; }); commit('Clear animation'); }
  function setInterp(ease) { [...A.sel].map(obj).filter(Boolean).forEach(o => { if (o.keys) S.CHANNELS.forEach(c => (o.keys[c] || []).forEach(k => k.ease = ease)); }); commit('Interpolation: ' + ease); }

  // ---------- timeline ----------
  const tl = { drag: null };
  function renderTimeline() {
    const a = A.doc.anim; $('tlFrame').value = a.frame; $('tlStart').value = a.start; $('tlEnd').value = a.end; $('tlFps').value = a.fps;
    $('tlPlay').innerHTML = A.playing ? '⏸' : '▶';
    const cv = $('tlCanvas'), r = cv.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); }
    const g = cv.getContext('2d'), W = r.width, H = r.height; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const x = f => 12 + (f - a.start) / Math.max(1, a.end - a.start) * (W - 24);
    g.fillStyle = '#f7fafd'; g.fillRect(0, 0, W, H); g.fillStyle = '#e4ebf4'; g.fillRect(0, 0, W, 16);
    const span = a.end - a.start, step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500].find(s => span / s <= W / 40) || 1000;
    g.font = '10px Segoe UI'; g.textAlign = 'center';
    for (let f = Math.ceil(a.start / step) * step; f <= a.end; f += step) { g.strokeStyle = '#c9d6e5'; g.beginPath(); g.moveTo(x(f) + .5, 16); g.lineTo(x(f) + .5, H); g.stroke(); g.fillStyle = '#4a6585'; g.fillText(f, x(f), 12); }
    // key diamonds: selected objects (dim rows for the others)
    const objs = A.doc.objects.filter(o => S.isAnimated(o));
    const frames = new Map(); objs.forEach(o => S.keyFrames(o).forEach(f => { const s = A.sel.has(o.id); frames.set(f, (frames.get(f) || 0) | (s ? 2 : 1)); }));
    frames.forEach((v, f) => { const cx = x(f), cy = 16 + (H - 16) / 2, s = v & 2 ? 6 : 4; g.fillStyle = v & 2 ? (tl.drag && tl.drag.from === f ? '#ffb02e' : '#f5c242') : '#c3ccd8'; g.strokeStyle = v & 2 ? '#7a5a10' : '#8a96a6'; g.beginPath(); g.moveTo(cx, cy - s); g.lineTo(cx + s, cy); g.lineTo(cx, cy + s); g.lineTo(cx - s, cy); g.closePath(); g.fill(); g.stroke(); });
    if (tl.drag && tl.drag.to != null && tl.drag.to !== tl.drag.from) { const cx = x(tl.drag.to), cy = 16 + (H - 16) / 2; g.strokeStyle = '#d96b00'; g.setLineDash([3, 2]); g.beginPath(); g.moveTo(cx, cy - 7); g.lineTo(cx + 7, cy); g.lineTo(cx, cy + 7); g.lineTo(cx - 7, cy); g.closePath(); g.stroke(); g.setLineDash([]); }
    // playhead
    const px = x(a.frame); g.strokeStyle = '#2d7fd8'; g.lineWidth = 2; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke(); g.lineWidth = 1;
    g.fillStyle = '#2d7fd8'; g.fillRect(px - 14, 1, 28, 14); g.fillStyle = '#fff'; g.fillText(a.frame, px, 12);
  }
  function tlFrameAt(ev) { const r = $('tlCanvas').getBoundingClientRect(), a = A.doc.anim; return Math.round(a.start + Math.max(0, Math.min(1, (ev.clientX - r.left - 12) / (r.width - 24))) * (a.end - a.start)); }
  function setFrame(f, skipPanels) {
    const a = A.doc.anim; a.frame = Math.max(-1e5, Math.min(1e5, Math.round(f)));
    quick(); if (!skipPanels) renderProps(); else { /* playback: keep panels light */ }
  }
  A.setFrame = setFrame;
  let playT = 0, playAcc = 0;
  function play(on = !A.playing) {
    A.playing = on; renderTimeline();
    if (on) { playT = performance.now(); playAcc = 0; requestAnimationFrame(tick); } else renderProps();
  }
  function tick(now) {
    if (!A.playing) return; const a = A.doc.anim; playAcc += (now - playT) / 1000 * a.fps; playT = now;
    if (playAcc >= 1) { const n = Math.floor(playAcc); playAcc -= n; let f = a.frame + n; if (f > a.end) f = a.start + ((f - a.start) % (a.end - a.start + 1)); setFrame(f, true); }
    requestAnimationFrame(tick);
  }

  // ---------- selection & modes ----------
  function setMode(m) {
    if (m === A.mode) return;
    if (m === 'edit') {
      const o = act(); if (!o || o.type !== 'mesh') { Aero.toast('Select a mesh object to edit'); return; }
      A.mode = 'edit'; A.editing = o.id; A.sel = new Set([o.id]); A.esel = M.emptySel();
    } else { A.mode = 'object'; A.editing = null; A.esel = M.emptySel(); }
    if (A.tool === 'loopcut' && m !== 'edit') A.tool = 'move';
    V.setPreview(null); commit(m === 'edit' ? 'Edit Mode' : 'Object Mode');
  }
  A.setMode = setMode;
  function setSelMode(sm) {
    const eo = editObj(); if (!eo) return; A.selMode = sm;
    const s = A.esel; A.esel = sm === 'vert' ? M.flush(eo.mesh, 'vert', s) : sm === 'edge' ? M.flush(eo.mesh, 'edge', { E: new Set(s.E) }) : M.flush(eo.mesh, 'face', { F: new Set(s.F) });
    refresh();
  }
  function selectAll() {
    const eo = editObj();
    if (eo) { const all = A.esel.V.size === eo.mesh.v.length; A.esel = all ? M.emptySel() : M.selectAll(eo.mesh); refresh(); return; }
    const all = A.sel.size === A.doc.objects.length; A.sel = all ? new Set() : new Set(A.doc.objects.map(o => o.id)); if (!A.sel.has(A.active)) A.active = [...A.sel][0] || null; refresh();
  }
  function deselectAll() { const eo = editObj(); if (eo) A.esel = M.emptySel(); else A.sel = new Set(); refresh(); }
  function invertSelection() {
    const eo = editObj(); if (eo) { A.esel = M.invertSel(eo.mesh, A.selMode, A.esel); refresh(); return; }
    A.sel = new Set(A.doc.objects.filter(o => !A.sel.has(o.id)).map(o => o.id)); A.active = [...A.sel][0] || null; refresh();
  }
  function selectLinked() { const eo = editObj(); if (!eo) return; A.esel = M.selectLinked(eo.mesh, A.selMode, A.esel); if (A.selMode !== 'vert') A.esel = M.flush(eo.mesh, A.selMode, A.selMode === 'edge' ? { E: A.esel.E } : { F: A.esel.F }); refresh(); }
  function applyEditPick(hit, mode, ev) {
    const eo = editObj(), m = eo.mesh, add = ev.shiftKey, sub = ev.ctrlKey;
    if (ev.altKey && hit && (hit.e != null)) { // edge loop select
      const lp = M.edgeLoop(m, hit.a, hit.b); const base = add ? A.esel : M.emptySel();
      A.esel = M.flush(m, A.selMode === 'face' ? 'edge' : A.selMode === 'vert' ? 'vert' : 'edge', A.selMode === 'vert' ? { V: new Set([...base.V, ...lp.V]) } : { E: new Set([...base.E, ...lp.E]) });
      if (A.selMode === 'face') A.esel = M.flush(m, 'face', { F: new Set([...base.F, ...A.esel.F]) });
      refresh(); return;
    }
    if (!hit) { if (!add && !sub) { A.esel = M.emptySel(); refresh(); } return; }
    const s = { V: new Set(A.esel.V), E: new Set(A.esel.E), F: new Set(A.esel.F) };
    const toggle = (set, k) => { if (sub) set.delete(k); else if (add) { if (set.has(k)) set.delete(k); else set.add(k); } else { set.clear(); set.add(k); } };
    if (mode === 'vert') toggle(s.V, hit.v); else if (mode === 'edge') toggle(s.E, hit.e); else toggle(s.F, hit.f);
    A.esel = M.flush(m, mode, s); refresh();
  }

  // ---------- gizmo ----------
  function pivotWorld() {
    const eo = editObj();
    if (eo) { const ids = [...A.esel.V].filter(i => i < eo.mesh.v.length); if (!ids.length) return null; const c = M.vec.avg(ids.map(i => eo.mesh.v[i])); return S.xform(S.worldMatrix(eo, A.doc.anim.frame), c); }
    const objs = [...A.sel].map(obj).filter(o => o && o.visible); if (!objs.length) return null;
    return M.vec.avg(objs.map(o => { const m = S.worldMatrix(o, A.doc.anim.frame); return [m[12], m[13], m[14]]; }));
  }
  function orientQuat() {
    if (A.orient !== 'local') return [0, 0, 0, 1];
    const o = editObj() || act(); if (!o) return [0, 0, 0, 1];
    return S.quatFromEuler(S.trsAt(o, A.doc.anim.frame).rot);
  }
  function updateGizmo() {
    const mode = { move: 'move', rotate: 'rotate', scale: 'scale' }[A.tool], p = pivotWorld();
    V.setGizmo(modal && modal.source !== 'gizmo' ? null : mode, p, orientQuat());
  }

  // ---------- modal transform (G/R/S keys and gizmo drags) ----------
  let modal = null;
  function beginTransform(kind, ev, opts = {}) {
    const pivot = pivotWorld(); if (!pivot) { Aero.toast('Nothing selected'); return; }
    const eo = editObj();
    modal = { kind, source: opts.source || 'key', axis: opts.axis ?? -1, plane: !!opts.plane, typed: '', pivot, quat: orientQuat(), start: lastMouse.slice(), startEv: ev ? V.mouse(ev) : lastMouse.slice(), label: opts.label || { move: 'Move', rotate: 'Rotate', scale: 'Scale' }[kind], dir: opts.dir || null, onCancel: opts.onCancel, uniformScreen: opts.uniformScreen };
    if (eo) { modal.mesh0 = eo.mesh; modal.ids = [...A.esel.V]; eo.mesh = M.clone(eo.mesh); modal.obj = eo; }
    else modal.objs = [...A.sel].map(obj).filter(o => o && o.visible).map(o => ({ o, t: S.trsAt(o, A.doc.anim.frame) }));
    if (ev) modal.start = V.mouse(ev);
    updateGizmo(); modalUpdate();
  }
  A.beginTransform = beginTransform;
  function axisVec(a) { const q = new T.Quaternion(...modal.quat); return new T.Vector3(...[[1, 0, 0], [0, 1, 0], [0, 0, 1]][a]).applyQuaternion(q); }
  function rayAt(mx, my) { const r = V.canvas().getBoundingClientRect(); return V.ray({ clientX: r.left + mx, clientY: r.top + my }); }
  function closestOnAxis(ray, origin, dir) { // parameter along axis line closest to ray
    const w0 = origin.clone().sub(ray.origin), a = dir.dot(dir), b = dir.dot(ray.direction), c = ray.direction.dot(ray.direction), d = dir.dot(w0), e = ray.direction.dot(w0), den = a * c - b * b;
    if (Math.abs(den) < 1e-9) return 0; return (b * e - c * d) / den;
  }
  function planeHit(ray, origin, n) { const den = n.dot(ray.direction); if (Math.abs(den) < 1e-9) return null; const t = origin.clone().sub(ray.origin).dot(n) / den; return ray.origin.clone().add(ray.direction.clone().multiplyScalar(t)); }
  const snapOn = () => A.snap !== !!(lastEv && lastEv.ctrlKey);
  function modalMatrix() {
    const md = modal, P = new T.Vector3(...md.pivot), [mx, my] = lastMouse, [sx, sy] = md.start, typed = md.typed !== '' && md.typed !== '-' ? parseFloat(md.typed) : null;
    const toP = new T.Matrix4().makeTranslation(P.x, P.y, P.z), fromP = new T.Matrix4().makeTranslation(-P.x, -P.y, -P.z);
    const sp = V.project(md.pivot);
    if (md.kind === 'move') {
      let delta = new T.Vector3();
      if (md.dir) { // constrained to a direction (extrude)
        const d = new T.Vector3(...md.dir).normalize();
        const t = typed != null ? typed : closestOnAxis(rayAt(mx, my), P, d) - closestOnAxis(rayAt(sx, sy), P, d);
        delta = d.multiplyScalar(snapOn() && typed == null ? Math.round(t / A.snapMove) * A.snapMove : t);
      } else if (md.axis >= 0 && !md.plane) {
        const d = axisVec(md.axis); const t = typed != null ? typed : closestOnAxis(rayAt(mx, my), P, d) - closestOnAxis(rayAt(sx, sy), P, d);
        delta = d.multiplyScalar(snapOn() && typed == null ? Math.round(t / A.snapMove) * A.snapMove : t);
      } else {
        const n = md.axis >= 0 ? axisVec(md.axis) : V.viewDir().negate(), a = planeHit(rayAt(sx, sy), P, n), b = planeHit(rayAt(mx, my), P, n);
        if (a && b) delta = b.sub(a);
        if (typed != null) delta = (md.axis >= 0 ? axisVec((md.axis + 1) % 3) : axisVec(0)).multiplyScalar(typed);
        if (snapOn() && typed == null) { delta.x = Math.round(delta.x / A.snapMove) * A.snapMove; delta.y = Math.round(delta.y / A.snapMove) * A.snapMove; delta.z = Math.round(delta.z / A.snapMove) * A.snapMove; }
      }
      md.info = `D: ${delta.x.toFixed(3)}, ${delta.y.toFixed(3)}, ${delta.z.toFixed(3)} (${delta.length().toFixed(3)})`;
      md.delta = delta; return new T.Matrix4().makeTranslation(delta.x, delta.y, delta.z);
    }
    if (md.kind === 'rotate') {
      const a0 = Math.atan2(sy - sp[1], sx - sp[0]), a1 = Math.atan2(my - sp[1], mx - sp[0]);
      let ang = a1 - a0; ang = Math.atan2(Math.sin(ang), Math.cos(ang)); md.accum = md.accum ?? 0; md.lastA = md.lastA ?? 0;
      let dA = ang - md.lastA; dA = Math.atan2(Math.sin(dA), Math.cos(dA)); md.accum += dA; md.lastA = ang;
      const axis = md.axis >= 0 ? axisVec(md.axis) : V.viewDir().negate();
      const facing = axis.dot(V.viewDir()) < 0 ? 1 : -1; // screen angles grow clockwise
      let deg = typed != null ? typed : -md.accum * DEG * facing;
      if (snapOn() && typed == null) deg = Math.round(deg / A.snapRot) * A.snapRot;
      md.info = `Rotation ${deg.toFixed(2)}°`; md.angle = deg / DEG; md.axisV = axis.clone();
      const rot = new T.Matrix4().makeRotationAxis(axis.normalize(), deg / DEG);
      return toP.multiply(rot).multiply(fromP);
    }
    // scale
    const d0 = Math.hypot(sx - sp[0], sy - sp[1]) || 1, d1 = Math.hypot(mx - sp[0], my - sp[1]);
    let f = typed != null ? typed : d1 / d0;
    if (md.source === 'gizmo' && md.axis >= 0 && !md.plane && typed == null) { // along a gizmo axis: ratio of axis projections
      const d = axisVec(md.axis), t0 = closestOnAxis(rayAt(sx, sy), P, d), t1 = closestOnAxis(rayAt(mx, my), P, d); f = Math.abs(t0) > 1e-6 ? t1 / t0 : 1;
    }
    if (snapOn() && typed == null) f = Math.round(f / A.snapScale) * A.snapScale;
    const s = [1, 1, 1];
    if (md.axis < 0) s.fill(f); else if (md.plane) { s.fill(f); s[md.axis] = 1; } else s[md.axis] = f;
    md.scaleV = s; md.info = `Scale ${s.map(x => x.toFixed(3)).join(', ')}`;
    const q = new T.Quaternion(...md.quat), R4 = new T.Matrix4().makeRotationFromQuaternion(q), Ri = R4.clone().invert();
    return toP.multiply(R4).multiply(new T.Matrix4().makeScale(...s)).multiply(Ri).multiply(fromP);
  }
  function modalUpdate() {
    if (!modal) return; const md = modal, Tm = modalMatrix();
    if (md.obj) {
      const o = md.obj, Mw = new T.Matrix4().fromArray(S.worldMatrix(o, A.doc.anim.frame)), L = Mw.clone().invert().multiply(Tm).multiply(Mw), e = L.elements;
      const v0 = md.mesh0.v, v = o.mesh.v; md.ids.forEach(i => { const p = v0[i]; v[i] = [e[0] * p[0] + e[4] * p[1] + e[8] * p[2] + e[12], e[1] * p[0] + e[5] * p[1] + e[9] * p[2] + e[13], e[2] * p[0] + e[6] * p[1] + e[10] * p[2] + e[14]]; });
      V.invalidate(o.id); V.sync(); V.setEdit(o, o.mesh, A.esel, A.selMode);
    } else {
      md.objs.forEach(({ o, t }) => {
        let nt;
        if (md.kind === 'move') nt = { loc: [t.loc[0] + md.delta.x, t.loc[1] + md.delta.y, t.loc[2] + md.delta.z], rot: t.rot, scale: t.scale };
        else if (md.kind === 'rotate') {
          const M0 = new T.Matrix4().fromArray(S.compose(t.loc, t.rot, t.scale)), d = S.decompose(Tm.clone().multiply(M0).toArray());
          nt = { loc: d.loc, rot: d.rot.map((x, i) => { let y = x; while (y - t.rot[i] > Math.PI) y -= 2 * Math.PI; while (y - t.rot[i] < -Math.PI) y += 2 * Math.PI; return y; }), scale: t.scale };
        } else { const p = new T.Vector3(...t.loc).applyMatrix4(Tm); nt = { loc: p.toArray(), rot: t.rot, scale: t.scale.map((x, i) => x * md.scaleV[i]) }; }
        S.CHANNELS.forEach(ch => setChannel(o, ch, nt[ch]));
      });
      V.sync();
    }
    $('mhint').style.display = 'block';
    $('mhint').textContent = `${md.label}  ${md.typed ? '[' + md.typed + ']  ' : ''}${md.info || ''}${md.axis >= 0 ? `  · ${md.plane ? 'plane ⟂ ' : 'axis '}${'XYZ'[md.axis]}${A.orient === 'local' ? ' (local)' : ''}` : ''}   — X/Y/Z axis · type a value · Enter/click confirm · Esc/right-click cancel${md.source === 'gizmo' ? '' : ''}`;
    updateGizmo();
  }
  function endTransform(ok) {
    if (!modal) return; const md = modal; modal = null; $('mhint').style.display = 'none';
    if (!ok) {
      if (md.obj) { md.obj.mesh = md.mesh0; V.invalidate(md.obj.id); }
      else md.objs.forEach(({ o, t }) => { S.CHANNELS.forEach(ch => { o[ch] = t[ch].slice(); }); });
      if (md.onCancel) { md.onCancel(); return; }
      // restore keys for animated objects from the last snapshot
      restore(hist.current); return;
    }
    if (md.obj) V.invalidate(md.obj.id);
    commit(md.label);
  }
  function modalKey(e) {
    const k = e.key;
    if (k === 'Escape') { endTransform(false); return true; }
    if (k === 'Enter') { endTransform(true); return true; }
    if (/^[xyz]$/i.test(k)) { const a = 'xyz'.indexOf(k.toLowerCase()); if (modal.dir) modal.dir = null; if (modal.axis === a && modal.plane === e.shiftKey) { modal.axis = -1; modal.plane = false; } else { modal.axis = a; modal.plane = e.shiftKey && modal.kind !== 'rotate'; } modalUpdate(); return true; }
    if (/^[0-9.]$/.test(k) || (k === '-' && !modal.typed)) { modal.typed += k; modalUpdate(); return true; }
    if (k === '-') { modal.typed = modal.typed.startsWith('-') ? modal.typed.slice(1) : '-' + modal.typed; modalUpdate(); return true; }
    if (k === 'Backspace') { modal.typed = modal.typed.slice(0, -1); modalUpdate(); return true; }
    if (k === 'g' || k === 'G') { switchModal('move'); return true; } if (k === 'r' || k === 'R') { switchModal('rotate'); return true; } if (k === 's' || k === 'S') { switchModal('scale'); return true; }
    return true; // swallow everything else while transforming
  }
  function switchModal(kind) { if (!modal || modal.kind === kind || modal.dir) return; const src = modal.source; endTransform(false); beginTransform(kind, null, { source: src }); }

  // ---------- viewport pointer handling ----------
  let lastMouse = [0, 0], lastEv = null, press = null;
  function onPointerDown(e) {
    const cv = V.canvas(); lastMouse = V.mouse(e); lastEv = e;
    if (modal) { e.preventDefault(); if (e.button === 0) endTransform(true); else if (e.button === 2) endTransform(false); return; }
    if (e.button !== 0 || e.altKey) return;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or finished pointer */ }
    // loop cut tool
    if (A.tool === 'loopcut' && editObj()) { const h = V.pickEdit(e, 'edge'); if (h) doLoopCut(h.a, h.b); return; }
    // gizmo
    const gh = ['move', 'rotate', 'scale'].includes(A.tool) ? V.hitGizmo(e) : null;
    if (gh) {
      const kind = gh[0] === 'm' ? 'move' : gh[0] === 'r' ? 'rotate' : 'scale', plane = /^(mp|sp)/.test(gh), uni = gh === 'mv' || gh === 'rv' || gh === 'su';
      const axis = uni ? -1 : +gh[gh.length - 1];
      beginTransform(kind, e, { source: 'gizmo', axis, plane }); modal.dragging = true; return;
    }
    press = { x: lastMouse[0], y: lastMouse[1], ev: e, box: false };
  }
  function onPointerMove(e) {
    lastMouse = V.mouse(e); lastEv = e;
    if (modal) { modalUpdate(); return; }
    if (press) {
      if (!press.box && Math.hypot(lastMouse[0] - press.x, lastMouse[1] - press.y) > 4) press.box = true;
      if (press.box) { const b = $('boxsel'), x0 = Math.min(press.x, lastMouse[0]), y0 = Math.min(press.y, lastMouse[1]); b.style.display = 'block'; b.style.left = x0 + 'px'; b.style.top = y0 + 'px'; b.style.width = Math.abs(lastMouse[0] - press.x) + 'px'; b.style.height = Math.abs(lastMouse[1] - press.y) + 'px'; }
      return;
    }
    // hover: gizmo highlight / loop-cut preview
    if (A.tool === 'loopcut' && editObj()) { hoverLoopCut(e); return; }
    if (['move', 'rotate', 'scale'].includes(A.tool)) { const h = V.hitGizmo(e); if (h !== hoverG) { hoverG = h; V.gizmoHighlight(h); } }
  }
  let hoverG = null;
  function onPointerUp(e) {
    lastMouse = V.mouse(e); lastEv = e;
    if (modal && modal.dragging) { endTransform(true); return; }
    if (!press) return; const p = press; press = null; $('boxsel').style.display = 'none';
    const add = e.shiftKey, sub = e.ctrlKey, eo = editObj();
    if (p.box) {
      if (eo) {
        const ids = V.box(p.x, p.y, lastMouse[0], lastMouse[1], A.selMode), s = add || sub ? { V: new Set(A.esel.V), E: new Set(A.esel.E), F: new Set(A.esel.F) } : M.emptySel();
        const set = A.selMode === 'vert' ? s.V : A.selMode === 'edge' ? s.E : s.F; ids.forEach(i => sub ? set.delete(i) : set.add(i));
        A.esel = M.flush(eo.mesh, A.selMode, s);
      } else {
        const ids = V.boxObjects(p.x, p.y, lastMouse[0], lastMouse[1]); if (!add && !sub) A.sel = new Set();
        ids.forEach(id => sub ? A.sel.delete(id) : A.sel.add(id)); if (!A.sel.has(A.active)) A.active = ids.find(id => A.sel.has(id)) || [...A.sel][0] || null;
      }
      refresh(); return;
    }
    if (eo) { applyEditPick(V.pickEdit(p.ev, e.altKey ? 'edge' : A.selMode), A.selMode, e); return; }
    const id = V.pickObject(p.ev);
    if (!id) { if (!add && !sub) { A.sel = new Set(); refresh(); } return; }
    if (sub) A.sel.delete(id); else if (add) { if (A.sel.has(id) && A.active === id) A.sel.delete(id); else { A.sel.add(id); A.active = id; } }
    else { A.sel = new Set([id]); A.active = id; }
    if (!A.sel.has(A.active)) A.active = [...A.sel][0] || null;
    refresh();
  }
  function onDblClick(e) { if (modal) return; const id = V.pickObject(e); if (!id) return; if (A.mode === 'object' && obj(id).type === 'mesh') { A.sel = new Set([id]); A.active = id; setMode('edit'); } }

  // ---------- loop cut tool ----------
  function ringPreview(a, b) {
    const eo = editObj(), m = eo.mesh, ring = M.edgeRing(m, a, b); if (!ring) return null;
    const mw = S.worldMatrix(eo, A.doc.anim.frame), segs = [], n = A.loopCuts;
    ring.quads.forEach(q => { for (let k = 1; k <= n; k++) { const t = k / (n + 1); segs.push(S.xform(mw, M.vec.lerp(m.v[q.x], m.v[q.y], t)), S.xform(mw, M.vec.lerp(m.v[q.nx], m.v[q.ny], t))); } });
    return segs;
  }
  let lcHover = null;
  function hoverLoopCut(e) {
    const h = V.pickEdit(e, 'edge'), key = h ? h.e : null; if (key === lcHover) return; lcHover = key;
    V.setPreview(h ? ringPreview(h.a, h.b) : null);
    status(h ? 'Click to cut the highlighted loop' : 'Loop cut: hover an edge of a quad strip');
  }
  function doLoopCut(a, b) {
    const eo = editObj(); const r = M.loopCut(eo.mesh, a, b, A.loopCuts); if (!r) { Aero.toast('No quad ring through this edge'); return; }
    eo.mesh = r.mesh; A.esel = A.selMode === 'edge' ? r.sel : M.flush(r.mesh, A.selMode === 'vert' ? 'vert' : 'edge', r.sel); if (A.selMode === 'face') A.selMode = 'edge';
    V.setPreview(null); lcHover = null; V.invalidate(eo.id); commit('Loop cut');
  }
  function loopCutSelected() {
    const eo = needEdit(); if (!eo) return; const e = [...A.esel.E][0];
    if (A.esel.E.size !== 1 && !(A.esel.E.size && A.selMode === 'edge')) { A.tool = 'loopcut'; renderCmd(); Aero.toast('Loop cut: hover an edge and click (Esc to leave the tool)'); return; }
    doLoopCut(M.ekeyA(e), M.ekeyB(e));
  }

  // ---------- mesh operations ----------
  function needEdit(needSel = false) {
    const eo = editObj(); if (!eo) { Aero.toast('This works in Edit Mode (Tab)'); return null; }
    if (needSel && !A.esel.V.size) { Aero.toast('Select some geometry first'); return null; }
    return eo;
  }
  function applyOp(label, res) { const eo = editObj(); if (!res) return; eo.mesh = res.mesh; A.esel = res.sel; if (A.selMode === 'face' && !res.sel.F.size && res.sel.E.size) A.esel = M.flush(res.mesh, 'edge', res.sel); V.invalidate(eo.id); commit(label); }
  function extrude() {
    const eo = needEdit(true); if (!eo) return;
    if (!A.esel.F.size && !A.esel.E.size) { Aero.toast('Select faces or boundary edges to extrude'); return; }
    const before = hist.current, r = M.extrude(eo.mesh, A.esel);
    eo.mesh = r.mesh; A.esel = r.sel; V.invalidate(eo.id); refresh();
    const mw = S.worldMatrix(eo, A.doc.anim.frame), nw = S.xdir(mw, r.normal);
    beginTransform('move', null, { label: 'Extrude', dir: nw, onCancel: () => restore(before) });
  }
  function opDialog(title, fields, run, label) {
    const eo = needEdit(true); if (!eo) return; const base = eo.mesh, sel0 = A.esel;
    let last = null;
    Aero.dialog({ title, fields, onChange: v => { last = run(base, sel0, v); if (last) { eo.mesh = last.mesh; A.esel = last.sel; V.invalidate(eo.id); V.sync(); V.setEdit(eo, eo.mesh, A.esel, A.selMode); status(); } },
      onOK: () => { if (last) { V.invalidate(eo.id); commit(label); } }, onCancel: () => { eo.mesh = base; A.esel = sel0; V.invalidate(eo.id); refresh(); } });
  }
  function inset() { if (!A.esel.F.size && editObj()) return Aero.toast('Select faces to inset'); opDialog('Inset Faces', [{ key: 't', label: 'Thickness', type: 'number', value: 0.1, step: 0.01, min: 0 }, { key: 'd', label: 'Depth', type: 'number', value: 0, step: 0.01 }, { key: 'ind', label: 'Individual', type: 'checkbox', value: false }], (m, s, v) => M.inset(m, s, Math.max(0, v.t), v.d, v.ind), 'Inset'); }
  function bevel() { if (!A.esel.E.size && editObj()) return Aero.toast('Select edges to bevel'); opDialog('Bevel Edges', [{ key: 'w', label: 'Width', type: 'number', value: 0.1, step: 0.01, min: 0 }], (m, s, v) => M.bevel(m, s, Math.max(1e-5, v.w)), 'Bevel'); }
  function subdivide() { const eo = needEdit(true); if (!eo) return; if (!A.esel.F.size) return Aero.toast('Select faces to subdivide'); applyOp('Subdivide', M.subdivide(eo.mesh, A.esel)); }
  function mergeOp() {
    const eo = needEdit(true); if (!eo) return;
    Aero.dialog({ title: 'Merge', fields: [{ key: 'how', label: 'Merge', type: 'select', value: 'center', options: [['center', 'At center'], ['collapse', 'Collapse (each island)'], ['distance', 'By distance']] }, { key: 'd', label: 'Distance', type: 'number', value: 0.001, step: 0.001, min: 0 }],
      onOK: v => { if (v.how === 'distance') { const r = M.mergeByDistance(eo.mesh, A.esel, Math.max(0, v.d)); applyOp('Merge by distance', r); Aero.toast(`Removed ${r.merged} vertices`); } else applyOp('Merge', M.merge(eo.mesh, A.esel, v.how)); } });
  }
  function deleteOp(what) {
    const eo = editObj();
    if (!eo) { deleteObjects(); return; }
    if (!A.esel.V.size) return;
    if (!what) { Aero.dialog({ title: 'Delete', fields: [{ key: 'w', label: 'Delete', type: 'select', value: A.selMode === 'vert' ? 'verts' : A.selMode === 'edge' ? 'edges' : 'faces', options: [['verts', 'Vertices'], ['edges', 'Edges'], ['faces', 'Faces'], ['dissolve', 'Dissolve faces (merge into one)']] }], onOK: v => deleteOp(v.w) }); return; }
    if (what === 'dissolve') { const r = M.dissolveFaces(eo.mesh, A.esel); if (!r) return Aero.toast('Select a connected patch of faces with one boundary'); applyOp('Dissolve faces', r); return; }
    applyOp('Delete ' + what, M.del(eo.mesh, A.esel, what));
  }
  function fillOp() { const eo = needEdit(true); if (!eo) return; const r = M.fill(eo.mesh, A.esel); if (!r) return Aero.toast('Select 3 or more vertices'); applyOp('Fill', r); }
  function mirrorOp(axis) {
    const eo = needEdit(true); if (!eo) return; const ids = [...A.esel.V], c = M.vec.avg(ids.map(i => eo.mesh.v[i]));
    applyOp('Mirror ' + 'XYZ'[axis], M.mirror(eo.mesh, A.esel, axis, c));
  }
  function symmetrize(axis) { // mirror the +side of the whole mesh onto the -side
    const eo = needEdit(); if (!eo) return; const m = eo.mesh, keep = new Set(m.v.map((p, i) => i).filter(i => m.v[i][axis] < -1e-6));
    const half = keep.size ? M.del(m, M.flush(m, 'vert', { V: keep }), 'verts').mesh : m;
    applyOp('Symmetrize', { mesh: M.mirrorMod(half, [axis === 0, axis === 1, axis === 2], true, 1e-4), sel: M.emptySel() });
  }
  function flipOp() { const eo = needEdit(true); if (!eo) return; applyOp('Flip normals', { mesh: M.flipFaces(eo.mesh, A.esel.F), sel: A.esel }); }
  function recalcOp() { const eo = editObj() || act(); if (!eo || eo.type !== 'mesh') return; eo.mesh = M.recalcNormals(eo.mesh); V.invalidate(eo.id); commit('Recalculate normals'); }
  function duplicateGeom() { const eo = needEdit(true); if (!eo) return; if (!A.esel.F.size) return Aero.toast('Select faces to duplicate'); const before = hist.current; const r = M.duplicate(eo.mesh, A.esel); eo.mesh = r.mesh; A.esel = r.sel; V.invalidate(eo.id); refresh(); beginTransform('move', null, { label: 'Duplicate', onCancel: () => restore(before) }); }
  function triangulateOp() { const eo = needEdit(true); if (!eo) return; applyOp('Triangulate', M.triangulate(eo.mesh, A.esel.F.size ? A.esel.F : null)); }

  // ---------- object operations ----------
  const PRIM_NAMES = { cube: 'Cube', plane: 'Plane', grid: 'Grid', uvsphere: 'UV Sphere', icosphere: 'Ico Sphere', cylinder: 'Cylinder', cone: 'Cone', torus: 'Torus' };
  function uniqueName(base) { const names = new Set(A.doc.objects.map(o => o.name)); if (!names.has(base)) return base; for (let i = 1; ; i++) { const n = `${base}.${String(i).padStart(3, '0')}`; if (!names.has(n)) return n; } }
  function addPrimitive(kind, params = {}) {
    if (A.mode === 'edit') setMode('object');
    const o = S.newObject('mesh', uniqueName(PRIM_NAMES[kind]), { mesh: M.PRIMS[kind](params), loc: cursor.slice(), smooth: ['uvsphere', 'icosphere', 'torus'].includes(kind) });
    A.doc.objects.push(o); A.sel = new Set([o.id]); A.active = o.id; commit('Add ' + PRIM_NAMES[kind]);
  }
  function addPrimitiveDialog(kind) {
    const F = { cube: [['size', 'Size (half)', 1]], plane: [['size', 'Size (half)', 1]], grid: [['x', 'X subdivisions', 10], ['y', 'Y subdivisions', 10], ['size', 'Size (half)', 1]], uvsphere: [['segments', 'Segments', 32], ['rings', 'Rings', 16], ['radius', 'Radius', 1]], icosphere: [['subdiv', 'Subdivisions', 2], ['radius', 'Radius', 1]], cylinder: [['vertices', 'Vertices', 32], ['radius', 'Radius', 1], ['depth', 'Depth', 2]], cone: [['vertices', 'Vertices', 32], ['radius1', 'Radius 1', 1], ['radius2', 'Radius 2', 0], ['depth', 'Depth', 2]], torus: [['major', 'Major radius', 1], ['minor', 'Minor radius', 0.25], ['majorSeg', 'Major segments', 48], ['minorSeg', 'Minor segments', 12]] }[kind];
    Aero.dialog({ title: 'Add ' + PRIM_NAMES[kind], fields: F.map(([key, label, value]) => ({ key, label, type: 'number', value, step: Number.isInteger(value) && value > 2 ? 1 : 0.1, min: 0 })), onOK: v => {
      const p = {}; F.forEach(([k, , d]) => { let x = v[k]; if (Number.isInteger(d) && d > 2) x = Math.max(3, Math.min(512, Math.round(x))); if (k === 'subdiv') x = Math.max(0, Math.min(6, Math.round(x))); if (k === 'x' || k === 'y') x = Math.max(1, Math.min(512, Math.round(x))); p[k] = x; });
      addPrimitive(kind, p);
    } });
  }
  const cursor = [0, 0, 0];
  function addLight(kind) {
    if (A.mode === 'edit') setMode('object');
    const o = S.newObject('light', uniqueName(kind === 'sun' ? 'Sun' : 'Point light'), { loc: [cursor[0] + 2, cursor[1] - 2, cursor[2] + 4], rot: kind === 'sun' ? window.L3DSample.lookRot([2, -2, 4], [0, 0, 0]) : [0, 0, 0], light: { kind } });
    A.doc.objects.push(o); A.sel = new Set([o.id]); A.active = o.id; commit('Add light');
  }
  function addCamera() {
    if (A.mode === 'edit') setMode('object');
    const vc = V.viewCamera(), o = S.newObject('camera', uniqueName('Camera'), { loc: vc.pos, rot: window.L3DSample.lookRot(vc.pos, M.vec.add(vc.pos, vc.dir)) });
    A.doc.objects.push(o); if (!A.doc.render.camera) A.doc.render.camera = o.id; A.sel = new Set([o.id]); A.active = o.id; commit('Add camera');
  }
  function cameraToView(o) { const vc = V.viewCamera(); setChannel(o, 'loc', vc.pos); setChannel(o, 'rot', window.L3DSample.lookRot(vc.pos, M.vec.add(vc.pos, vc.dir))); o.camera.fov = Math.round(vc.fov * 10) / 10; V.invalidate(o.id); commit('Align camera to view'); }
  function deleteObjects() {
    if (!A.sel.size) return; const n = A.sel.size;
    A.doc.objects = A.doc.objects.filter(o => !A.sel.has(o.id)); if (!obj(A.doc.render.camera)) A.doc.render.camera = null;
    A.sel = new Set(); A.active = null; commit(n > 1 ? `Delete ${n} objects` : 'Delete object');
  }
  function duplicateObjects() {
    if (A.mode === 'edit') { duplicateGeom(); return; }
    const objs = [...A.sel].map(obj).filter(Boolean); if (!objs.length) return; const before = hist.current, ids = [];
    objs.forEach(o => { const c = cloneObj(o); c.id = S.uid(); c.name = uniqueName(o.name.replace(/\.\d{3}$/, '')); if (c.mods) c.mods.forEach(m => m.id = S.uid()); A.doc.objects.push(c); ids.push(c.id); });
    A.sel = new Set(ids); A.active = ids[ids.length - 1]; refresh();
    beginTransform('move', null, { label: 'Duplicate', onCancel: () => restore(before) });
  }
  function joinObjects() {
    const target = act(); const others = [...A.sel].map(obj).filter(o => o && o !== target && o.type === 'mesh');
    if (!target || target.type !== 'mesh' || !others.length) return Aero.toast('Select two or more meshes (the active one receives the others)');
    const inv = new T.Matrix4().fromArray(S.worldMatrix(target, A.doc.anim.frame)).invert();
    let m = M.clone(target.mesh);
    others.forEach(o => { const Mo = new T.Matrix4().fromArray(S.worldMatrix(o, A.doc.anim.frame)), L = inv.clone().multiply(Mo).toArray(); const base = m.v.length, om = S.evalMesh(o); om.v.forEach(p => m.v.push(S.xform(L, p))); om.f.forEach((f, fi) => { m.f.push(f.map(i => i + base)); m.uv.push(om.uv[fi]); }); });
    target.mesh = m; A.doc.objects = A.doc.objects.filter(o => !others.includes(o)); A.sel = new Set([target.id]); V.invalidate(target.id); commit('Join');
  }
  function applyTransform() {
    const objs = [...A.sel].map(obj).filter(o => o && o.type === 'mesh'); if (!objs.length) return;
    objs.forEach(o => { const t = S.trsAt(o, A.doc.anim.frame), m = S.compose([0, 0, 0], t.rot, t.scale); o.mesh = { ...M.clone(o.mesh), v: o.mesh.v.map(p => S.xform(m, p)) }; if (m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]) < 0) o.mesh = M.flipFaces(o.mesh, new Set(o.mesh.f.map((_, i) => i))); o.rot = [0, 0, 0]; o.scale = [1, 1, 1]; if (o.keys) { delete o.keys.rot; delete o.keys.scale; } V.invalidate(o.id); });
    commit('Apply rotation & scale');
  }
  function originToGeometry() {
    const objs = [...A.sel].map(obj).filter(o => o && o.type === 'mesh' && o.mesh.v.length); if (!objs.length) return;
    objs.forEach(o => { const bb = M.bbox(o.mesh), c = [0, 1, 2].map(k => (bb.min[k] + bb.max[k]) / 2), mw = S.worldMatrix(o, A.doc.anim.frame), wc = S.xform(mw, c), w0 = S.xform(mw, [0, 0, 0]);
      o.mesh = { ...M.clone(o.mesh), v: o.mesh.v.map(p => [p[0] - c[0], p[1] - c[1], p[2] - c[2]]) }; setChannel(o, 'loc', M.vec.add(S.trsAt(o, A.doc.anim.frame).loc, M.vec.sub(wc, w0))); V.invalidate(o.id); });
    commit('Origin to geometry');
  }
  function applyAllModifiers() { const objs = [...A.sel].map(obj).filter(o => o && o.type === 'mesh' && o.mods && o.mods.length); if (!objs.length) return Aero.toast('No modifiers to apply'); objs.forEach(o => { o.mesh = S.evalMesh(o); o.mods = []; V.invalidate(o.id); }); commit('Apply modifiers'); }
  function shade(smooth) { const objs = [...A.sel].map(obj).filter(o => o && o.type === 'mesh'); objs.forEach(o => { o.smooth = smooth; V.invalidate(o.id); }); if (objs.length) commit(smooth ? 'Shade smooth' : 'Shade flat'); }
  function hideSel() { if (A.mode === 'edit') return; [...A.sel].map(obj).forEach(o => o && (o.visible = false)); A.sel = new Set(); commit('Hide'); }
  function unhideAll() { A.doc.objects.forEach(o => { if (!o.visible) { o.visible = true; A.sel.add(o.id); } }); commit('Unhide all'); }
  function resetTransform(ch) { [...A.sel].map(obj).filter(Boolean).forEach(o => setChannel(o, ch, ch === 'scale' ? [1, 1, 1] : [0, 0, 0])); commit('Clear ' + ch); }

  // ---------- view ----------
  function frameSelected() {
    const eo = editObj();
    if (eo && A.esel.V.size) { const mw = S.worldMatrix(eo, A.doc.anim.frame), pts = [...A.esel.V].map(i => new T.Vector3(...S.xform(mw, eo.mesh.v[i]))); V.frame(new T.Box3().setFromPoints(pts).expandByScalar(0.3)); return; }
    const bb = new T.Box3(); [...A.sel].forEach(id => { const b = V.objectBox(id); if (b) bb.union(b); }); if (bb.isEmpty()) V.frame(V.sceneBox()); else V.frame(bb);
  }
  function viewCameraObj() { const c = obj(A.doc.render.camera) || A.doc.objects.find(o => o.type === 'camera'); if (!c) return Aero.toast('The scene has no camera (Add › Camera)'); V.lookThrough(S.cameraFrom(c, A.doc.anim.frame)); }
  function setShading(s) { A.shading = s; V.clearMaterialCache(); refresh(); }

  // ---------- render ----------
  function renderCamera() { const c = obj(A.doc.render.camera) || A.doc.objects.find(o => o.type === 'camera'); return c ? S.cameraFrom(c, A.doc.anim.frame) : { ...V.viewCamera(), aperture: 0 }; }
  function renderStill() { if (modal) return; A.rendering = true; V.sync(); R.renderStill(A, { camera: renderCamera() }).finally(() => { A.rendering = false; V.sync(); }); }
  function renderAnim() {
    const a = A.doc.anim;
    Aero.dialog({ title: 'Render Animation', instruction: `Frames ${a.start}–${a.end} (${a.end - a.start + 1}) at ${a.fps} fps. Each frame is path traced with the sample count below.`, fields: [
      { key: 'fmt', label: 'Output', type: 'select', value: 'mp4', options: [['mp4', 'MP4 video (H.264)'], ['zip', 'PNG frames in a ZIP']] },
      { key: 'samples', label: 'Samples per frame', type: 'number', value: 16, min: 1, step: 4 },
      { key: 'scale', label: 'Resolution', type: 'select', value: '0.5', options: [['1', `100% (${A.doc.render.width}×${A.doc.render.height})`], ['0.5', '50%'], ['0.25', '25%']] }],
    onOK: v => { const k = +v.scale; R.renderAnimation(A, { format: v.fmt, samples: Math.max(1, Math.round(v.samples)), width: Math.max(16, Math.round(A.doc.render.width * k)), height: Math.max(16, Math.round(A.doc.render.height * k)) }); } });
  }

  // ---------- files ----------
  function setDoc(doc, name, path) {
    if (A.playing) play(false);
    A.doc = doc; A.sel = new Set(); A.active = null; A.mode = 'object'; A.editing = null; A.esel = M.emptySel(); A.docName = name; A.filePath = path || null;
    V.clearMaterialCache(); V.clearTextures(); hist.reset('Open', snap()); Aero.setDoc(name, false); refresh(); V.setView('persp');
  }
  A.setDoc = setDoc;
  async function confirmDiscard() { if (!Aero.dirty) return true; return Aero.confirm('Unsaved changes', 'Discard the changes to the current scene?', 'Discard'); }
  async function newScene() {
    if (!(await confirmDiscard())) return;
    const d = S.newDoc(), mat = S.newMaterial('Material', '#cccccc'); d.materials.push(mat);
    const cube = S.newObject('mesh', 'Cube', { mesh: M.cube(1), loc: [0, 0, 1], mat: mat.id }); d.objects.push(cube);
    d.objects.push(S.newObject('light', 'Light', { loc: [4, -1, 6], light: { kind: 'point', power: 1000 } }));
    const camPos = [7.4, -6.5, 5.3]; const cam = S.newObject('camera', 'Camera', { loc: camPos, rot: window.L3DSample.lookRot(camPos, [0, 0, 0.6]) }); d.objects.push(cam); d.render.camera = cam.id;
    setDoc(d, 'Untitled'); A.sel = new Set([cube.id]); A.active = cube.id; refresh();
  }
  async function openSample() { if (!(await confirmDiscard())) return; setDoc(window.L3DSample.build(), 'Studio still life'); A.shading = 'material'; refresh(); viewCameraObj(); }
  async function openDialog() {
    if (!(await confirmDiscard())) return;
    const f = await Aero.openFile({ accept: '.l3d,.obj,.stl,.glb,.gltf,.mtl', multiple: true, filters: [{ name: '3D files', extensions: ['l3d', 'obj', 'stl', 'glb', 'gltf'] }] });
    if (f.length) openFiles(f, true);
  }
  async function openFiles(files, replace) {
    const proj = files.find(f => /\.l3d$/i.test(f.name));
    if (proj) {
      try { const d = S.parse(new TextDecoder().decode(proj.data)); setDoc(d, Aero.baseName(proj.name), proj.path); const c = d.objects.find(o => o.type === 'camera'); if (c) viewCameraObj(); Aero.toast(`Opened ${proj.name}`); }
      catch (e) { Aero.alert('Open', e.message); }
      return;
    }
    const imgs = files.filter(f => /\.(png|jpe?g|webp)$/i.test(f.name));
    const models = files.filter(f => /\.(obj|stl|glb|gltf)$/i.test(f.name));
    if (!models.length && imgs.length && act() && act().type === 'mesh') { await loadTexture(imgs[0], act()); return; }
    if (!models.length) { Aero.toast('Drop .l3d, .obj, .stl, .glb or .gltf files'); return; }
    if (replace && !A.doc.objects.length) { /* fine */ }
    await importFiles(files);
  }
  async function importDialog() { const f = await Aero.openFile({ accept: '.obj,.mtl,.stl,.glb,.gltf,.bin,.png,.jpg,.jpeg', multiple: true, filters: [{ name: '3D models', extensions: ['obj', 'stl', 'glb', 'gltf'] }] }); if (f.length) importFiles(f); }
  async function importFiles(files) {
    if (A.mode === 'edit') setMode('object');
    const byName = new Map(files.map(f => [f.name.toLowerCase(), f])), added = [];
    const resolve = uri => { const k = decodeURIComponent(uri).replace(/^.*[\\/]/, '').toLowerCase(); return byName.get(k)?.data || null; };
    Aero.busy('Importing…'); await new Promise(r => setTimeout(r, 30));
    try {
      for (const f of files) {
        const ext = f.name.split('.').pop().toLowerCase(), base = Aero.baseName(f.name);
        if (ext === 'obj') {
          const mtlF = files.find(x => /\.mtl$/i.test(x.name)), parts = IO.importOBJ(new TextDecoder().decode(f.data), mtlF ? new TextDecoder().decode(mtlF.data) : null);
          const mats = new Map();
          parts.forEach(p => {
            let matId = null;
            if (p.mtl) { if (!mats.has(p.mtl.name)) { const kd = p.mtl.Kd || [0.8, 0.8, 0.8], m = S.newMaterial(p.mtl.name || 'Material', S.rgbToHex(kd), { rough: p.mtl.Pr ?? (p.mtl.Ns != null ? Math.max(0.05, 1 - Math.sqrt(p.mtl.Ns / 1000)) : 0.5), metal: p.mtl.Pm || 0 }); if (p.mtl.Ke && p.mtl.Ke.some(x => x > 0)) { m.emit = S.rgbToHex(p.mtl.Ke); m.emitStrength = 1; } A.doc.materials.push(m); mats.set(p.mtl.name, m.id);
              const tf = p.mtl.map_Kd && byName.get(p.mtl.map_Kd.replace(/^.*[\\/]/, '').toLowerCase()); if (tf) { const mime = /\.jpe?g$/i.test(tf.name) ? 'image/jpeg' : 'image/png', im = { id: S.uid(), name: tf.name, data: IO.bytesToDataUrl(new Uint8Array(tf.data), mime) }; A.doc.images.push(im); m.tex = im.id; } }
              matId = mats.get(p.mtl.name); }
            const o = S.newObject('mesh', uniqueName(p.name || base), { mesh: p.mesh, mat: matId }); A.doc.objects.push(o); added.push(o);
          });
        } else if (ext === 'stl') { const o = S.newObject('mesh', uniqueName(base), { mesh: IO.importSTL(f.data) }); A.doc.objects.push(o); added.push(o); }
        else if (ext === 'glb' || ext === 'gltf') {
          const r = IO.importGLTF(f.data, { resolve, fps: A.doc.anim.fps, start: A.doc.anim.start }), imgMap = new Map(), matMap = new Map();
          r.images.forEach(im => { const id = S.uid(); A.doc.images.push({ id, name: im.name, data: im.data }); imgMap.set(im.key, id); });
          r.materials.forEach(m => { const nm = S.newMaterial(m.name, m.color, { metal: m.metal, rough: m.rough, emit: m.emit, emitStrength: m.emitStrength, transmission: m.transmission, ior: m.ior, tex: m.image ? imgMap.get(m.image) || null : null }); A.doc.materials.push(nm); matMap.set(m.key, nm.id); });
          r.objects.forEach(x => {
            const d = S.decompose(x.matrix), o = S.newObject(x.type, uniqueName(x.name), { loc: d.loc, rot: d.rot, scale: d.scale, mesh: x.mesh, mat: x.material ? matMap.get(x.material) : null, smooth: !!x.smooth, light: x.light, camera: x.camera });
            if (x.keys) o.keys = x.keys; A.doc.objects.push(o); added.push(o);
          });
          let maxF = 0; added.forEach(o => S.keyFrames(o).forEach(fr => maxF = Math.max(maxF, fr))); if (maxF > A.doc.anim.end) A.doc.anim.end = maxF;
        }
      }
    } catch (e) { Aero.busy(); Aero.alert('Import', 'Could not import: ' + e.message); return; }
    Aero.busy();
    if (!added.length) { Aero.toast('Nothing to import'); return; }
    A.sel = new Set(added.map(o => o.id)); A.active = added[added.length - 1].id; commit('Import ' + files.map(f => f.name).join(', ').slice(0, 60));
    frameSelected(); Aero.toast(`Imported ${added.length} object${added.length > 1 ? 's' : ''}`);
  }
  async function save(as) {
    const data = S.serialize(A.doc), name = (A.docName || 'Untitled') + '.l3d';
    const p = await Aero.saveFile({ name, data, filters: [{ name: 'Lumen 3D scene', extensions: ['l3d'] }], path: as ? null : A.filePath });
    if (!p) return false; if (Aero.isDesktop) A.filePath = p; A.docName = Aero.baseName(p); Aero.setDoc(A.docName, false); try { localStorage.removeItem(AUTOSAVE); } catch (e) { /* ignore */ } return true;
  }
  function exportItems(selectedOnly, applyMods) {
    const objs = A.doc.objects.filter(o => (!selectedOnly || A.sel.has(o.id)) && o.visible);
    return objs.map(o => ({ name: o.name, kind: o.type, mesh: o.type === 'mesh' ? (applyMods ? S.evalMesh(o) : o.mesh) : null, matrix: S.worldMatrix(o, A.doc.anim.frame), trs: S.trsAt(o, A.doc.anim.frame), material: A.doc.materials.find(m => m.id === o.mat), smooth: o.smooth, autoSmooth: o.autoSmooth, obj: o, light: o.light, camera: o.camera }));
  }
  function exportDialog(fmt) {
    const fields = [{ key: 'sel', label: 'Selected objects only', type: 'checkbox', value: A.sel.size > 0 }, { key: 'mods', label: 'Apply modifiers', type: 'checkbox', value: true }];
    if (fmt === 'glb' || fmt === 'gltf') fields.push({ key: 'anim', label: 'Include animation', type: 'checkbox', value: A.doc.objects.some(S.isAnimated) }, { key: 'lc', label: 'Include lights and cameras', type: 'checkbox', value: true });
    if (fmt === 'obj') fields.push({ key: 'mtl', label: 'Also save .mtl materials', type: 'checkbox', value: true });
    Aero.dialog({ title: 'Export ' + fmt.toUpperCase(), fields, onOK: v => doExport(fmt, v) });
  }
  async function doExport(fmt, v) {
    let items = exportItems(v.sel, v.mods);
    if (fmt !== 'glb' && fmt !== 'gltf' || !v.lc) items = items.filter(i => i.kind === 'mesh');
    if (!items.length) return Aero.toast('Nothing to export');
    const base = A.docName || 'scene';
    if (fmt === 'obj') { const r = IO.exportOBJ(items.filter(i => i.kind === 'mesh'), { mtlName: base + '.mtl' }); await Aero.saveFile({ name: base + '.obj', data: r.obj, filters: [{ name: 'Wavefront OBJ', extensions: ['obj'] }] }); if (v.mtl) await Aero.saveFile({ name: base + '.mtl', data: r.mtl, filters: [{ name: 'OBJ materials', extensions: ['mtl'] }] }); }
    else if (fmt === 'stl') await Aero.saveFile({ name: base + '.stl', data: IO.exportSTL(items), filters: [{ name: 'STL', extensions: ['stl'] }] });
    else { const a = A.doc.anim, data = IO.exportGLTF(A.doc, items, { binary: fmt === 'glb', frames: v.anim ? { start: a.start, end: a.end, fps: a.fps } : null }); await Aero.saveFile({ name: base + '.' + fmt, data, filters: [{ name: fmt === 'glb' ? 'glTF binary' : 'glTF', extensions: [fmt] }] }); }
    Aero.toast(`Exported ${items.length} object${items.length > 1 ? 's' : ''} as ${fmt.toUpperCase()}`);
  }
  async function saveViewport() { const c = V.snapshot(); const blob = await new Promise(r => c.toBlob(r, 'image/png')); Aero.saveFile({ name: (A.docName || 'viewport') + '-viewport.png', data: blob, filters: [{ name: 'PNG', extensions: ['png'] }] }); }

  // ---------- help ----------
  function shortcutsHelp() {
    const rows = [['Viewport', [['Middle drag / Alt+left drag', 'Orbit'], ['Shift+middle / right drag', 'Pan'], ['Wheel', 'Zoom'], ['Numpad 1 / 3 / 7', 'Front / right / top view'], ['Numpad 5', 'Perspective / orthographic'], ['Numpad 0', 'Camera view'], ['Numpad . / Home', 'Frame selected / all']]],
      ['Objects', [['Click / Shift+click / drag', 'Select / add / box select'], ['G / R / S', 'Move / rotate / scale (X Y Z lock, type a value)'], ['Shift+D', 'Duplicate'], ['X / Delete', 'Delete'], ['Ctrl+J', 'Join meshes'], ['Ctrl+A', 'Apply rotation & scale'], ['H / Alt+H', 'Hide / unhide'], ['Tab', 'Edit Mode']]],
      ['Edit Mode', [['1 / 2 / 3', 'Vertex / edge / face select'], ['Alt+click', 'Select edge loop'], ['A / Alt+A / Ctrl+I', 'Select all / none / invert'], ['L', 'Select linked'], ['E', 'Extrude'], ['I', 'Inset'], ['Ctrl+B', 'Bevel'], ['Ctrl+R', 'Loop cut'], ['M', 'Merge'], ['F', 'Fill'], ['Shift+N', 'Recalculate normals']]],
      ['Animation & render', [['Space', 'Play / pause'], ['← / →', 'Previous / next frame'], ['I (object mode)', 'Insert keyframe'], ['Alt+I', 'Delete keyframe'], ['F12', 'Render image'], ['Ctrl+F12', 'Render animation']]]];
    Aero.dialog({ title: 'Keyboard Shortcuts', noCancel: true, width: 560, html: `<table class="keys">${rows.map(([h, r]) => `<tr><th colspan="2">${h}</th></tr>` + r.map(([k, d]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join('')).join('')}</table>` });
  }
  function about() { Aero.dialog({ title: 'About Lumen 3D', noCancel: true, html: '<p><b>Lumen 3D</b> — free 3D modelling, animation and rendering.</p><p class="dim">Polygon modelling with Blender-style tools, non-destructive modifiers, PBR materials, keyframe animation and a progressive path tracer. Built on three.js (MIT) for the viewport. Everything runs locally.</p>' }); }

  // ---------- menus ----------
  const inEdit = () => A.mode === 'edit', notEdit = () => A.mode !== 'edit';
  function buildMenus() {
    Aero.init({
      name: 'Lumen 3D', icon: '../kit/icons/model.png', dropTarget: $('stage'), dropText: 'Drop .l3d, .obj, .stl, .glb or .gltf files (or an image to use as texture)',
      onDropFiles: f => openFiles(f, false), onOpenFiles: f => openFiles(f, true), onSave: () => save(false),
      menus: {
        File: [['New', 'Ctrl+N', newScene], ['Open…', 'Ctrl+O', openDialog], ['Open Sample', '', openSample], '-', ['Save', 'Ctrl+S', () => save(false)], ['Save As…', 'Ctrl+Shift+S', () => save(true)], '-',
          ['Import OBJ / STL / glTF…', 'Ctrl+I', importDialog], '#Export', ['Export OBJ…', '', () => exportDialog('obj')], ['Export STL…', '', () => exportDialog('stl')], ['Export glTF Binary (.glb)…', '', () => exportDialog('glb')], ['Export glTF (.gltf)…', '', () => exportDialog('gltf')], '-', ['Save Viewport as PNG…', '', saveViewport]],
        Edit: [['Undo', 'Ctrl+Z', A.undo], ['Redo', 'Ctrl+Shift+Z/Ctrl+Y', A.redo], '-', ['Select All / None', 'A', selectAll], ['Deselect All', 'Alt+A', deselectAll], ['Invert Selection', 'Ctrl+Shift+I', invertSelection], '-',
          { label: 'Snap while transforming', key: 'Shift+Tab', fn: () => { A.snap = !A.snap; renderCmd(); }, checked: () => A.snap }, ['Snapping Settings…', '', snapSettings]],
        Add: ['#Mesh', ['Cube', '', () => addPrimitive('cube')], ['Plane', '', () => addPrimitive('plane')], ['Grid…', '', () => addPrimitiveDialog('grid')], ['UV Sphere', '', () => addPrimitive('uvsphere')], ['Ico Sphere', '', () => addPrimitive('icosphere')], ['Cylinder', '', () => addPrimitive('cylinder')], ['Cone', '', () => addPrimitive('cone')], ['Torus', '', () => addPrimitive('torus')], ['Primitive with options…', 'Shift+A', addPrimitiveOptions],
          '#Other', ['Point Light', '', () => addLight('point')], ['Sun Light', '', () => addLight('sun')], ['Camera', '', addCamera]],
        Object: [{ label: 'Edit Mode', key: 'Tab', fn: () => setMode(A.mode === 'edit' ? 'object' : 'edit'), checked: inEdit }, '-', ['Move', 'G', () => key('g')], ['Rotate', 'R', () => key('r')], ['Scale', 'S', () => key('s')], '-',
          { label: 'Duplicate', key: 'Shift+D', fn: duplicateObjects }, { label: 'Delete', key: 'X/Delete', fn: () => deleteOp(A.mode === 'edit' && lastKeyDelete ? (A.selMode === 'vert' ? 'verts' : A.selMode === 'edge' ? 'edges' : 'faces') : null) },
          { label: 'Join', key: 'Ctrl+J', fn: joinObjects, disabled: inEdit }, '-', { label: 'Apply Rotation & Scale', key: 'Ctrl+A', fn: applyTransform, disabled: inEdit }, { label: 'Origin to Geometry', fn: originToGeometry, disabled: inEdit }, { label: 'Apply All Modifiers', fn: applyAllModifiers, disabled: inEdit },
          { label: 'Clear Location', key: 'Alt+G', fn: () => resetTransform('loc'), disabled: inEdit }, { label: 'Clear Rotation', key: 'Alt+R', fn: () => resetTransform('rot'), disabled: inEdit }, { label: 'Clear Scale', key: 'Alt+S', fn: () => resetTransform('scale'), disabled: inEdit }, '-',
          { label: 'Shade Smooth', fn: () => shade(true) }, { label: 'Shade Flat', fn: () => shade(false) }, '-', { label: 'Hide Selected', key: 'H', fn: hideSel }, { label: 'Unhide All', key: 'Alt+H', fn: unhideAll }],
        Mesh: [{ label: 'Extrude', key: 'E', fn: extrude, disabled: notEdit }, { label: 'Inset Faces…', key: 'I', fn: () => A.mode === 'edit' ? inset() : insertKeys() , disabled: () => false }, { label: 'Bevel Edges…', key: 'Ctrl+B', fn: bevel, disabled: notEdit }, { label: 'Loop Cut', key: 'Ctrl+R', fn: loopCutSelected, disabled: notEdit },
          { label: 'Subdivide', fn: subdivide, disabled: notEdit }, { label: 'Merge…', key: 'M', fn: mergeOp, disabled: notEdit }, { label: 'Fill (make face)', key: 'F', fn: fillOp, disabled: notEdit }, { label: 'Duplicate', fn: duplicateGeom, disabled: notEdit }, { label: 'Triangulate', key: 'Ctrl+T', fn: triangulateOp, disabled: notEdit }, '-',
          { label: 'Mirror Selection X', fn: () => mirrorOp(0), disabled: notEdit }, { label: 'Mirror Selection Y', fn: () => mirrorOp(1), disabled: notEdit }, { label: 'Mirror Selection Z', fn: () => mirrorOp(2), disabled: notEdit }, { label: 'Symmetrize +X → −X', fn: () => symmetrize(0), disabled: notEdit }, '-',
          { label: 'Flip Normals', fn: flipOp, disabled: notEdit }, { label: 'Recalculate Normals', key: 'Shift+N', fn: recalcOp }, '-', { label: 'Delete…', fn: () => deleteOp(null), disabled: notEdit }],
        Select: [['All / None', '', selectAll], ['Invert', '', invertSelection], { label: 'Linked', key: 'L', fn: selectLinked, disabled: notEdit }, '-', { label: 'Vertex mode', key: '1', fn: () => smKey('vert'), checked: () => inEdit() && A.selMode === 'vert' }, { label: 'Edge mode', key: '2', fn: () => smKey('edge'), checked: () => inEdit() && A.selMode === 'edge' }, { label: 'Face mode', key: '3', fn: () => smKey('face'), checked: () => inEdit() && A.selMode === 'face' }],
        View: [{ label: 'Solid', key: 'Shift+Z', fn: () => setShading('solid'), checked: () => A.shading === 'solid' }, { label: 'Material Preview', key: 'Z', fn: () => setShading(A.shading === 'material' ? 'solid' : 'material'), checked: () => A.shading === 'material' }, { label: 'Wireframe', key: 'Alt+Z', fn: () => setShading('wire'), checked: () => A.shading === 'wire' },
          { label: 'Wireframe Overlay', fn: () => { A.showWire = !A.showWire; V.sync(); }, checked: () => A.showWire }, { label: 'X-Ray (select through)', key: 'Alt+X', fn: () => { A.xray = !A.xray; refresh(); }, checked: () => A.xray }, '-',
          ['Front', 'Numpad 1', () => V.setView('front')], ['Right', 'Numpad 3', () => V.setView('right')], ['Top', 'Numpad 7', () => V.setView('top')], ['Perspective', '', () => V.setView('persp')], { label: 'Orthographic', key: 'Numpad 5', fn: () => V.toggleOrtho(), checked: () => V.isOrtho() }, ['Camera View', 'Numpad 0', viewCameraObj], '-',
          ['Frame Selected', 'Numpad .', frameSelected], ['Frame All', 'Home', () => V.frame(V.sceneBox())], { label: 'Zoom In', key: 'Ctrl+=', fn: () => zoom(0.8) }, { label: 'Zoom Out', key: 'Ctrl+-', fn: () => zoom(1.25) }, { label: 'Show Grid', fn: () => { gridOn = !gridOn; V.setGrid(gridOn); }, checked: () => gridOn }],
        Animation: [{ label: 'Play / Pause', key: 'Space', fn: () => play() }, ['Previous Frame', 'ArrowLeft', () => setFrame(A.doc.anim.frame - 1)], ['Next Frame', 'ArrowRight', () => setFrame(A.doc.anim.frame + 1)], ['Jump to Start', 'Shift+ArrowLeft', () => setFrame(A.doc.anim.start)], ['Jump to End', 'Shift+ArrowRight', () => setFrame(A.doc.anim.end)], '-',
          { label: 'Insert Keyframe (Loc Rot Scale)', fn: () => insertKeys() }, ['Insert Location Key', '', () => insertKeys(['loc'])], ['Insert Rotation Key', '', () => insertKeys(['rot'])], ['Insert Scale Key', '', () => insertKeys(['scale'])], ['Delete Keyframe', 'Alt+I', deleteKeys], ['Clear Animation', '', clearKeys], '-',
          '#Interpolation (selected objects)', ['Bezier (ease)', '', () => setInterp('bezier')], ['Linear', '', () => setInterp('linear')], ['Constant', '', () => setInterp('constant')]],
        Render: [['Render Image', 'F12', renderStill], ['Render Animation…', 'Ctrl+F12', renderAnim], '-', ['Render Settings', '', () => { A.tab = 'render'; renderProps(); }], ['World Settings', '', () => { A.tab = 'world'; renderProps(); }]],
        Help: [['Keyboard Shortcuts', 'F1', shortcutsHelp], ['About Lumen 3D', '', about]],
      },
    });
  }
  let gridOn = true, lastKeyDelete = false;
  function smKey(m) { if (A.mode === 'edit') setSelMode(m); }
  function zoom(f) { const c = V.camera(), t = V.target(); if (c.isOrthographicCamera) { c.zoom /= f; c.updateProjectionMatrix(); } else c.position.copy(t.clone().add(c.position.clone().sub(t).multiplyScalar(f))); V.redraw(); }
  function key(k) { const kind = { g: 'move', r: 'rotate', s: 'scale' }[k]; if (!modal) beginTransform(kind, null); }
  function snapSettings() { Aero.dialog({ title: 'Snapping', fields: [{ key: 'on', label: 'Snap by default (Ctrl inverts)', type: 'checkbox', value: A.snap }, { key: 'm', label: 'Move increment', type: 'number', value: A.snapMove, step: 0.05, min: 0.001 }, { key: 'r', label: 'Rotate increment °', type: 'number', value: A.snapRot, step: 1, min: 0.1 }, { key: 's', label: 'Scale increment', type: 'number', value: A.snapScale, step: 0.05, min: 0.001 }], onOK: v => { A.snap = v.on; A.snapMove = Math.max(0.001, v.m); A.snapRot = Math.max(0.1, v.r); A.snapScale = Math.max(0.001, v.s); renderCmd(); } }); }
  function addPrimitiveOptions() { Aero.dialog({ title: 'Add Mesh', fields: [{ key: 'k', label: 'Primitive', type: 'select', value: 'cube', options: Object.entries(PRIM_NAMES) }], onOK: v => addPrimitiveDialog(v.k) }); }

  // ---------- toolbox & command bar ----------
  let toolbox = null;
  function buildToolbox() {
    const I = {
      select: '<path d="M5 3l12 8-5.5 1.2L15 19l-2.6 1.3-3.4-6.7L5 17z"/>',
      move: '<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>',
      rotate: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 3v5h-5"/>',
      scale: '<rect x="3" y="11" width="10" height="10"/><path d="M13 11l8-8M15 3h6v6"/>',
      loopcut: '<rect x="3" y="5" width="18" height="14" rx="1"/><path d="M12 3v18" stroke-dasharray="2.5 2"/>',
    };
    toolbox = Aero.toolbox($('tools'), [{ id: 'select', title: 'Select box (W)', key: 'W', icon: I.select }, { id: 'move', title: 'Move tool', icon: I.move }, { id: 'rotate', title: 'Rotate tool', icon: I.rotate }, { id: 'scale', title: 'Scale tool', icon: I.scale }, null, { id: 'loopcut', title: 'Loop cut tool (Edit Mode)', icon: I.loopcut }], id => {
      if (id === 'loopcut' && A.mode !== 'edit') { Aero.toast('Loop cut works in Edit Mode (Tab)'); toolbox.set(A.tool); return; }
      A.tool = id; V.setPreview(null); lcHover = null; updateGizmo(); status(id === 'loopcut' ? 'Loop cut: hover an edge of a quad strip' : null);
    });
    toolbox.set(A.tool);
  }
  function bindCmd() {
    $('modeSel').onchange = e => setMode(e.target.value);
    document.querySelectorAll('[data-sm]').forEach(b => b.onclick = () => setSelMode(b.dataset.sm));
    document.querySelectorAll('[data-shade]').forEach(b => b.onclick = () => setShading(b.dataset.shade));
    document.querySelectorAll('[data-op]').forEach(b => b.onclick = () => ({ extrude, inset, bevel, loopcut: loopCutSelected, subdivide, merge: mergeOp, delete: () => deleteOp(null) })[b.dataset.op]());
    $('addBtn').onclick = e => { e.stopPropagation(); const m = $('addMenu'); m.style.display = m.style.display === 'block' ? 'none' : 'block'; const r = $('addBtn').getBoundingClientRect(); m.style.left = r.left + 'px'; m.style.top = r.bottom + 'px'; };
    $('addMenu').onclick = e => { const it = e.target.closest('[data-add]'); if (!it) return; $('addMenu').style.display = 'none'; const k = it.dataset.add; if (k === 'point' || k === 'sun') addLight(k); else if (k === 'camera') addCamera(); else addPrimitive(k); };
    document.addEventListener('click', () => { $('addMenu').style.display = 'none'; });
    $('snapChk').onchange = e => { A.snap = e.target.checked; };
    $('xrayChk').onchange = e => { A.xray = e.target.checked; refresh(); };
    $('orientSel').onchange = e => { A.orient = e.target.value; updateGizmo(); };
    $('renderBtn').onclick = renderStill;
    document.querySelectorAll('.navbtns [data-view]').forEach(b => b.onclick = () => { const v = b.dataset.view; if (v === 'camera') viewCameraObj(); else if (v === 'ortho') { V.toggleOrtho(); b.classList.toggle('on', V.isOrtho()); } else if (v === 'frame') frameSelected(); else V.setView(v); });
    // tabs
    document.querySelectorAll('#tabs .aero-tab').forEach(t => t.onclick = () => { A.tab = t.dataset.tab; $('props').dataset.force = 1; renderProps(); });
    const p = $('props');
    p.addEventListener('input', e => propInput(e, false)); p.addEventListener('change', e => { if (e.target.dataset.act) propSelect(e); else propInput(e, true); }); p.addEventListener('click', propAction);
    // outliner icon bar
    $('oAdd').onclick = e => { e.stopPropagation(); $('addBtn').click(); }; $('oDup').onclick = duplicateObjects; $('oDel').onclick = () => { if (A.mode === 'edit') setMode('object'); deleteObjects(); };
    $('oCam').onclick = viewCameraObj; $('oFocus').onclick = frameSelected;
    // timeline
    $('tlPlay').onclick = () => play(); $('tlStartBtn').onclick = () => setFrame(A.doc.anim.start); $('tlEndBtn').onclick = () => setFrame(A.doc.anim.end);
    $('tlPrev').onclick = () => { const ks = new Set(); [...A.sel].map(obj).filter(Boolean).forEach(o => S.keyFrames(o).forEach(f => ks.add(f))); const p = [...ks].filter(f => f < A.doc.anim.frame).sort((a, b) => b - a)[0]; if (p != null) setFrame(p); };
    $('tlNext').onclick = () => { const ks = new Set(); [...A.sel].map(obj).filter(Boolean).forEach(o => S.keyFrames(o).forEach(f => ks.add(f))); const n = [...ks].filter(f => f > A.doc.anim.frame).sort((a, b) => a - b)[0]; if (n != null) setFrame(n); };
    $('tlKey').onclick = () => insertKeys(); $('tlUnkey').onclick = deleteKeys;
    $('tlFrame').onchange = e => setFrame(+e.target.value || 0);
    const rng = () => { const s = Math.round(+$('tlStart').value || 0), en = Math.max(s, Math.round(+$('tlEnd').value || 0)), fps = Math.max(1, Math.min(240, Math.round(+$('tlFps').value || 24))); Object.assign(A.doc.anim, { start: s, end: en, fps }); commit('Frame range'); };
    $('tlStart').onchange = rng; $('tlEnd').onchange = rng; $('tlFps').onchange = rng;
    const tc = $('tlCanvas');
    tc.addEventListener('pointerdown', e => {
      try { tc.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } const f = tlFrameAt(e), r = tc.getBoundingClientRect();
      // grab a key diamond of a selected object?
      const near = [...A.sel].map(obj).filter(Boolean).some(o => S.keyFrames(o).includes(f)) && e.clientY - r.top > 16;
      tl.drag = near ? { from: f, to: f } : { scrub: true }; if (!near) setFrame(f, true); renderTimeline();
    });
    tc.addEventListener('pointermove', e => { if (!tl.drag) return; const f = tlFrameAt(e); if (tl.drag.scrub) { if (f !== A.doc.anim.frame) setFrame(f, true); } else { tl.drag.to = f; renderTimeline(); } });
    tc.addEventListener('pointerup', () => {
      const d = tl.drag; tl.drag = null; if (!d) return;
      if (d.scrub) { renderProps(); return; }
      if (d.to !== d.from) { // move keys of selected objects
        [...A.sel].map(obj).filter(Boolean).forEach(o => S.CHANNELS.forEach(ch => { const ks = o.keys && o.keys[ch]; if (!ks) return; const k = ks.find(x => x.f === d.from); if (!k) return; o.keys[ch] = ks.filter(x => x !== k && x.f !== d.to); k.f = d.to; o.keys[ch].push(k); o.keys[ch].sort((a, b) => a.f - b.f); }));
        commit('Move keyframes');
      } else setFrame(d.from);
    });
    new ResizeObserver(() => renderTimeline()).observe(tc);
  }

  // ---------- keyboard (viewport keys that aren't menu shortcuts) ----------
  function bindKeys() {
    window.addEventListener('keydown', e => {
      if (document.querySelector('.aero-modal')) return;
      if (modal) { if (modalKey(e)) { e.preventDefault(); e.stopPropagation(); } return; }
      const typing = e.target.matches && e.target.matches('input:not([type=range]):not([type=checkbox]),textarea,select');
      if (typing) return;
      lastKeyDelete = e.key === 'Delete';
      if (e.code && e.code.startsWith('Numpad') && !e.ctrlKey) {
        const c = e.code.slice(6), map = { 1: 'front', 3: 'right', 7: 'top' };
        if (map[c]) { V.setView(e.ctrlKey ? { front: 'back', right: 'left', top: 'bottom' }[map[c]] : map[c]); e.preventDefault(); e.stopPropagation(); return; }
        if (c === '5') { V.toggleOrtho(); e.preventDefault(); e.stopPropagation(); return; }
        if (c === '0') { viewCameraObj(); e.preventDefault(); e.stopPropagation(); return; }
        if (c === 'Decimal') { frameSelected(); e.preventDefault(); e.stopPropagation(); return; }
      }
      if (e.key === 'Escape' && A.tool === 'loopcut') { A.tool = 'move'; V.setPreview(null); renderCmd(); updateGizmo(); status(); }
    }, true);
  }

  // ---------- init ----------
  function init() {
    buildMenus(); buildToolbox(); bindCmd(); bindKeys();
    V.init($('cv'), A);
    const cv = $('cv');
    cv.addEventListener('pointerdown', onPointerDown); cv.addEventListener('pointermove', onPointerMove); cv.addEventListener('pointerup', onPointerUp); cv.addEventListener('dblclick', onDblClick);
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerleave', () => { if (hoverG) { hoverG = null; V.gizmoHighlight(null); } });
    A.onViewChange = () => { if (modal && modal.source !== 'gizmo') { /* keep */ } };
    // restore autosave or start with the sample
    let restored = false;
    try { const s = localStorage.getItem(AUTOSAVE); if (s && !/[?&]fresh/.test(location.search)) { const d = S.parse(s); if (d.objects.length) { setDoc(d, 'Recovered scene'); Aero.setDirty(true); restored = true; Aero.toast('Recovered your last unsaved scene'); } } } catch (e) { /* ignore */ }
    if (!restored) { setDoc(window.L3DSample.build(), 'Studio still life'); A.shading = 'material'; refresh(); viewCameraObj(); }
    window.addEventListener('resize', renderTimeline);
  }
  A._test = { M, S, IO, V, R, hist, commit, snap, restore, setMode, setSelMode, extrude, endTransform, beginTransform, modalUpdate, get modal() { return modal; }, set lastMouse(v) { lastMouse = v; }, addPrimitive, importFiles, exportItems, doExport, applyOp, deleteObjects, duplicateObjects, joinObjects, insertKeys, setFrame, play, addModifier, renderStill, openSample, newScene, loopCutSelected, doLoopCut, onPointerDown, onPointerMove, onPointerUp, setShading, toggleKey, frameSelected, viewCameraObj };
  init();
})();
