'use strict';
/* Lumen Motion — Project panel, Effects & Presets, Properties inspector, History, command bar, viewer bar. */
(function () {
  const LM = window.LM, el = Aero.el, esc = Aero.esc, W = LM.w, st = LM.st, $ = LM.$, F = LM.factory;

  /* ================= Project panel ================= */
  const proj = $('#project'), projBtns = $('#projbtns');
  let projSel = null;
  function renderProject() {
    proj.innerHTML = '';
    LM.doc.comps.forEach(c => {
      const d = el('div', 'aero-item proj' + (c.id === LM.doc.active ? ' sel' : ''), `<span class="pi">${W.typeIcon('comp')}</span><span class="grow">${esc(c.name)}</span><span class="dim small">${c.w}×${c.h} · ${c.fps}fps · ${Math.round(c.duration * 100) / 100}s</span>`);
      d.title = 'Double-click to open · drag into the viewer or timeline to add as a layer (precomp)';
      d.onclick = () => { projSel = { comp: c.id }; [...proj.children].forEach(x => x.classList.remove('sel')); d.classList.add('sel'); };
      d.ondblclick = () => LM.setActiveComp(c.id);
      d.draggable = true; d.ondragstart = e => { e.dataTransfer.setData('text/lumen-comp', c.id); };
      d.oncontextmenu = e => { e.preventDefault(); projSel = { comp: c.id }; W.menu(e.clientX, e.clientY, [['Open', () => LM.setActiveComp(c.id)], ['Add to Active Composition', () => { const sub = LM.compById(c.id); if (sub.id === LM.doc.active) return Aero.toast('A composition cannot contain itself'); LM.addPrecompLayer(sub); }], ['Composition Settings…', () => LM.compSettings(c)], ['Rename…', async () => { const v = await Aero.prompt('Rename Composition', 'Name', c.name); if (v) { c.name = v; LM.commit('Rename Composition'); } }], ['Duplicate', () => LM.duplicateComp(c)], '-', ['Delete', () => LM.deleteComp(c), { disabled: LM.doc.comps.length < 2 }]]); };
      proj.appendChild(d);
    });
    LM.assets.forEach(a => {
      const d = el('div', 'aero-item proj', `<span class="pi">${W.typeIcon(a.type)}</span><span class="grow">${esc(a.name)}</span><span class="dim small">${a.type === 'audio' ? 'Audio' : a.w + '×' + a.h}${a.duration ? ' · ' + a.duration.toFixed(1) + 's' : ''}${a.type === 'video' && LM.media.get(a.id)?.audio ? ' · ♪' : ''}</span>`);
      d.title = 'Double-click to add to the active composition';
      d.onclick = () => { projSel = { asset: a.id }; [...proj.children].forEach(x => x.classList.remove('sel')); d.classList.add('sel'); };
      d.ondblclick = () => LM.addAssetLayer(a);
      d.draggable = true; d.ondragstart = e => e.dataTransfer.setData('text/lumen-asset', a.id);
      d.oncontextmenu = e => { e.preventDefault(); W.menu(e.clientX, e.clientY, [['Add to Active Composition', () => LM.addAssetLayer(a)], ['New Composition from Footage', () => LM.compFromAsset(a)], '-', ['Remove from Project', () => LM.removeAsset(a)]]); };
      proj.appendChild(d);
    });
    const nItems = LM.doc.comps.length + LM.assets.size; $('#projcount').textContent = `${nItems} item${nItems === 1 ? '' : 's'}`;
  }
  projBtns.innerHTML = '';
  [['New Composition (Ctrl+N)', W.typeIcon('comp'), () => LM.newCompDialog()], ['Composition Settings (Ctrl+K)', '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6" fill="#e8eef6" stroke="#3a5a7a" stroke-width="1.6" stroke-dasharray="2.2 1.6"/><circle cx="8" cy="8" r="2.2" fill="url(#gBlue)" stroke="#174a85" stroke-width=".7"/></svg>', () => LM.compSettings()], ['Import File… (Ctrl+I)', '<svg viewBox="0 0 16 16"><path d="M3 1.5h6l3.5 3.5v9.5H3z" fill="url(#gPaper)" stroke="#5a7a9a"/><path d="M7.75 6v5.5M5.5 9.3l2.25 2.4 2.25-2.4" stroke="#2a7f14" stroke-width="1.5" fill="none"/></svg>', () => LM.importDialog()],
   ['Add selected item to the active composition', W.icon.plus, () => { if (!projSel) return Aero.toast('Select a composition or footage item first'); if (projSel.comp) { const s = LM.compById(projSel.comp); if (s.id === LM.doc.active) return Aero.toast('A composition cannot contain itself'); LM.addPrecompLayer(s); } else LM.addAssetLayer(LM.assets.get(projSel.asset)); }],
   ['Delete selected item', W.icon.trash, () => { if (!projSel) return; if (projSel.comp) LM.deleteComp(LM.compById(projSel.comp)); else LM.removeAsset(LM.assets.get(projSel.asset)); }]]
    .forEach(([t, ic, fn]) => { const b = el('button', 'aero-iconbtn', ic); b.title = t; b.onclick = fn; projBtns.appendChild(b); });
  LM.on('structure', renderProject); LM.on('compchange', renderProject);
  LM.renderProject = renderProject;

  LM.addAssetLayer = a => { const c = LM.comp(); const L = a.type === 'audio' ? F.audio(c, a) : a.type === 'video' ? F.video(c, a) : F.image(c, a); L.name = LM.uniqueName(c, a.name); LM.addLayer(L, 'Add ' + a.name); };
  LM.compFromAsset = a => { const c = F.comp({ name: LM.uniqueCompName(a.name.replace(/\.[^.]+$/, '')), w: a.w || 1920, h: a.h || 1080, fps: 30, duration: a.duration ? Math.min(600, Math.max(1, a.duration)) : 5 }); LM.doc.comps.push(c); LM.doc.active = c.id; const L = a.type === 'audio' ? F.audio(c, a) : a.type === 'video' ? F.video(c, a) : F.image(c, a); L.tr.scale.v = [100, 100]; c.layers.push(L); LM.commit('New Composition from Footage'); LM.setActiveComp(c.id); };
  LM.removeAsset = a => { const used = LM.doc.comps.some(c => c.layers.some(l => l.asset === a.id)); if (used) return Aero.alert('Remove Footage', `“${a.name}” is used by layers. Delete those layers first.`); LM.assets.delete(a.id); LM.media.delete(a.id); renderProject(); Aero.setDirty(true); };
  LM.duplicateComp = c => { const d = LM.clone(c); d.id = LM.uid(); d.name = LM.uniqueCompName(c.name + ' copy'); d.layers.forEach(l => l.id = LM.uid()); /* re-map parents */ const map = new Map(c.layers.map((l, i) => [l.id, d.layers[i].id])); d.layers.forEach(l => { if (l.parent) l.parent = map.get(l.parent) || null; }); LM.doc.comps.push(d); LM.commit('Duplicate Composition'); };
  LM.deleteComp = async c => {
    if (LM.doc.comps.length < 2) return Aero.toast('A project needs at least one composition');
    const users = LM.doc.comps.filter(o => o.layers.some(l => l.type === 'precomp' && l.comp === c.id));
    if (users.length && !(await Aero.confirm('Delete Composition', `“${c.name}” is used as a precomp in ${users.map(u => '“' + u.name + '”').join(', ')}. Delete it and those layers?`, 'Delete'))) return;
    users.forEach(o => o.layers = o.layers.filter(l => !(l.type === 'precomp' && l.comp === c.id)));
    LM.doc.comps = LM.doc.comps.filter(o => o !== c); if (LM.doc.active === c.id) LM.doc.active = LM.doc.comps[0].id;
    LM.commit('Delete Composition'); LM.setActiveComp(LM.doc.active);
  };

  /* ================= composition dialogs ================= */
  const PRESETS = [['1080p', 'HD 1080p · 1920×1080', 1920, 1080], ['4k', 'UHD 4K · 3840×2160', 3840, 2160], ['720p', 'HD 720p · 1280×720', 1280, 720], ['square', 'Square · 1080×1080', 1080, 1080], ['vertical', 'Vertical (Stories/Reels) · 1080×1920', 1080, 1920], ['portrait', 'Portrait 4:5 · 1080×1350', 1080, 1350], ['custom', 'Custom', 0, 0]];
  function compDialog(title, c, onOK) {
    const pre = PRESETS.find(p => p[2] === c.w && p[3] === c.h)?.[0] || 'custom';
    Aero.dialog({
      title, fields: [
        { key: 'name', label: 'Composition name', type: 'text', value: c.name },
        { key: 'preset', label: 'Preset', type: 'select', value: pre, options: PRESETS.map(p => [p[0], p[1]]) },
        { key: 'w', label: 'Width (px)', type: 'number', value: c.w, min: 16, max: 8192 }, { key: 'h', label: 'Height (px)', type: 'number', value: c.h, min: 16, max: 8192 },
        { key: 'fps', label: 'Frame rate', type: 'select', value: String(c.fps), options: ['12', '15', '23.976', '24', '25', '29.97', '30', '48', '50', '60'].map(x => [x, x + ' fps']) },
        { key: 'duration', label: 'Duration (seconds)', type: 'number', value: c.duration, min: .1, max: 3600, step: .1 },
        { key: 'bg', label: 'Background color', type: 'color', value: c.bg },
      ],
      onInput: (k, v, set) => { if (k === 'preset') { const p = PRESETS.find(p => p[0] === v.preset); if (p && p[2]) { set('w', p[2]); set('h', p[3]); } } if (k === 'w' || k === 'h') { const p = PRESETS.find(p => p[2] === v.w && p[3] === v.h); set('preset', p ? p[0] : 'custom'); } },
      onOK: v => onOK({ name: v.name || 'Comp', w: Math.round(Aero.clamp(v.w, 16, 8192)), h: Math.round(Aero.clamp(v.h, 16, 8192)), fps: parseFloat(v.fps), duration: Math.max(.1, v.duration), bg: v.bg })
    });
  }
  LM.newCompDialog = () => compDialog('New Composition', { name: LM.uniqueCompName('Comp 1'), w: 1920, h: 1080, fps: 30, duration: 10, bg: '#000000' }, v => {
    const c = F.comp(v); c.bg = v.bg; LM.doc.comps.push(c); LM.doc.active = c.id; LM.commit('New Composition'); LM.setActiveComp(c.id);
  });
  LM.compSettings = (c = LM.comp()) => compDialog('Composition Settings', c, v => {
    const old = c.duration; Object.assign(c, { name: v.name, w: v.w, h: v.h, fps: v.fps, duration: v.duration, bg: v.bg });
    if (c.workOut >= old - 1e-6 || c.workOut > c.duration) c.workOut = c.duration; c.workIn = Math.min(c.workIn, c.workOut - 1 / c.fps);
    c.layers.forEach(l => { if (Math.abs(l.out - old) < 1e-6) l.out = c.duration; });
    LM.commit('Composition Settings'); LM.emit('compchange');
  });

  /* ================= Effects & Presets ================= */
  const fxList = $('#fxlist'), fxq = $('#fxq'); let fxTab = 'fx';
  $('#fxtabs').onclick = e => { const t = e.target.closest('.aero-tab'); if (!t) return; fxTab = t.dataset.t; $('#fxtabs').querySelectorAll('.aero-tab').forEach(x => x.classList.toggle('on', x === t)); fxq.placeholder = fxTab === 'fx' ? 'Search effects…' : 'Search presets…'; renderFx(); };
  fxq.oninput = () => renderFx(); fxq.onkeydown = e => e.stopPropagation();
  function renderFx() {
    fxList.innerHTML = ''; const q = fxq.value.trim().toLowerCase();
    if (fxTab === 'fx') {
      const cats = {}; Object.entries(LM.FX).forEach(([k, d]) => { if (q && !d.name.toLowerCase().includes(q) && !d.cat.toLowerCase().includes(q)) return; (cats[d.cat] = cats[d.cat] || []).push([k, d]); });
      Object.keys(cats).sort().forEach(cat => {
        fxList.appendChild(el('div', 'fxcat', esc(cat)));
        cats[cat].forEach(([k, d]) => { const it = el('div', 'aero-item fxitem', `<span class="pi">${W.icon.fx}</span><span class="grow">${esc(d.name)}</span>`); it.title = 'Double-click (or drag onto a layer in the viewer) to apply to the selected layer'; it.ondblclick = () => LM.addEffect(k); it.onclick = () => { fxList.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); it.classList.add('sel'); }; it.draggable = true; it.ondragstart = e => e.dataTransfer.setData('text/lumen-fx', k); fxList.appendChild(it); });
      });
    } else {
      Object.entries(LM.PRESETS).forEach(([k, p]) => {
        if (q && !p.name.toLowerCase().includes(q) && !p.cat.toLowerCase().includes(q)) return;
        const it = el('div', 'aero-item fxitem', `<span class="pi">${p.icon}</span><span class="grow">${esc(p.name)}</span><span class="dim small">${esc(p.cat)}</span>`);
        it.title = p.desc + ' — double-click (or drag onto a layer) to apply at the current time';
        it.ondblclick = () => LM.applyPreset(k); it.onclick = () => { fxList.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); it.classList.add('sel'); };
        it.draggable = true; it.ondragstart = e => e.dataTransfer.setData('text/lumen-preset', k);
        fxList.appendChild(it);
      });
    }
  }
  // drop effects/presets/comps onto the viewer
  const stage = $('#stage');
  stage.addEventListener('dragover', e => { if ([...e.dataTransfer.types].some(t => t.startsWith('text/lumen'))) { e.preventDefault(); e.stopPropagation(); } });
  stage.addEventListener('drop', e => {
    const fx = e.dataTransfer.getData('text/lumen-fx'), pr = e.dataTransfer.getData('text/lumen-preset'), cid = e.dataTransfer.getData('text/lumen-comp'), aid = e.dataTransfer.getData('text/lumen-asset');
    if (!fx && !pr && !cid && !aid) return;
    e.preventDefault(); e.stopPropagation(); stage.classList.remove('drag-over');
    const r = $('#view').getBoundingClientRect(), [cx, cy] = LM.viewer.toComp(e.clientX - r.left, e.clientY - r.top), hit = LM.viewer.hitLayer(cx, cy, LM.comp());
    if (fx || pr) { if (hit) LM.select([hit.id]); if (fx) LM.addEffect(fx); else LM.applyPreset(pr); }
    if (cid) { const s = LM.compById(cid); if (s.id === LM.doc.active) return Aero.toast('A composition cannot contain itself'); LM.addPrecompLayer(s); }
    if (aid) LM.addAssetLayer(LM.assets.get(aid));
  });
  $('#timeline').addEventListener('dragover', e => { if ([...e.dataTransfer.types].some(t => t === 'text/lumen-comp' || t === 'text/lumen-asset')) { e.preventDefault(); e.stopPropagation(); } });
  $('#timeline').addEventListener('drop', e => { const cid = e.dataTransfer.getData('text/lumen-comp'), aid = e.dataTransfer.getData('text/lumen-asset'); if (!cid && !aid) return; e.preventDefault(); e.stopPropagation(); if (cid) { const s = LM.compById(cid); if (s.id === LM.doc.active) return Aero.toast('A composition cannot contain itself'); LM.addPrecompLayer(s); } else LM.addAssetLayer(LM.assets.get(aid)); });

  /* ================= Animation presets ================= */
  const ic = c => `<svg viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="${c}" stroke="rgba(0,0,0,.35)"/><path d="M4 11.5c2-5 5-7 8-7" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`;
  const key = (p, t, v, o = {}) => { p.k = p.k || []; p.k = p.k.filter(k => Math.abs(k.t - t) > 1e-6); const k = Object.assign({ t, v: LM.clone(v), i: 'linear', o: 'linear' }, o); p.k.push(k); p.k.sort((a, b) => a.t - b.t); return k; };
  const EASE = { i: 'ease', o: 'ease', ei: [.333333, 0], eo: [.333333, 0] };
  const OUTQ = { i: 'bezier', o: 'bezier', ei: [.7, 0], eo: [.15, .15] };   // decelerate
  LM.PRESETS = {
    fadeIn: { name: 'Fade In', cat: 'Transitions', desc: 'Opacity 0 → 100% over 0.5 s', icon: ic('#4aa3ff'), apply(L, t, c) { const p = L.tr.opacity, v = LM.animated(p) ? 100 : p.v; key(p, t, 0, EASE); key(p, t + .5, v || 100, EASE); } },
    fadeOut: { name: 'Fade Out', cat: 'Transitions', desc: 'Opacity 100 → 0% over 0.5 s', icon: ic('#6a7a8c'), apply(L, t) { const p = L.tr.opacity, v = LM.val(p, t + L.start); key(p, t, v || 100, EASE); key(p, t + .5, 0, EASE); } },
    slideL: { name: 'Slide In from Left', cat: 'Transitions', desc: 'Moves in from beyond the left edge and settles', icon: ic('#3aa845'), apply(L, t, c) { slide(L, t, c, -1, 0); } },
    slideR: { name: 'Slide In from Right', cat: 'Transitions', desc: 'Moves in from beyond the right edge and settles', icon: ic('#3aa845'), apply(L, t, c) { slide(L, t, c, 1, 0); } },
    slideT: { name: 'Slide In from Top', cat: 'Transitions', desc: 'Drops in from above the frame', icon: ic('#3aa845'), apply(L, t, c) { slide(L, t, c, 0, -1); } },
    slideB: { name: 'Slide In from Bottom', cat: 'Transitions', desc: 'Rises in from below the frame', icon: ic('#3aa845'), apply(L, t, c) { slide(L, t, c, 0, 1); } },
    pop: { name: 'Pop (Scale Bounce)', cat: 'Behaviors', desc: 'Scale 0 → 115 → 95 → 100% with an elastic settle', icon: ic('#e0a020'), apply(L, t) { const p = L.tr.scale, v = LM.val(p, t + L.start); const f = m => [v[0] * m, v[1] * m]; key(p, t, f(0), { o: 'bezier', eo: [.2, .4] }); key(p, t + .3, f(1.15), EASE); key(p, t + .45, f(.95), EASE); key(p, t + .6, f(1), EASE); } },
    spin: { name: 'Spin', cat: 'Behaviors', desc: 'One full eased rotation over 1 s', icon: ic('#7b3fd0'), apply(L, t) { const p = L.tr.rotation, v = LM.val(p, t + L.start); key(p, t, v, EASE); key(p, t + 1, v + 360, EASE); } },
    pulse: { name: 'Pulse', cat: 'Behaviors', desc: 'Endless gentle scale pulse (expression)', icon: ic('#e04a6a'), apply(L) { const x = 'value * (1 + 0.06 * Math.sin(time * Math.PI * 2 * 1.5))'; LM.trusted.add(x); L.tr.scale.x = x; } },
    wiggle: { name: 'Wiggle Position', cat: 'Behaviors', desc: 'Random organic drift: wiggle(2, 25)', icon: ic('#e07a20'), apply(L) { const x = 'wiggle(2, 25)'; LM.trusted.add(x); L.tr.position.x = x; } },
    spinLoop: { name: 'Continuous Rotation', cat: 'Behaviors', desc: 'Rotates forever: value + time * 60', icon: ic('#7b3fd0'), apply(L) { const x = 'value + time * 60'; LM.trusted.add(x); L.tr.rotation.x = x; } },
    drawOn: { name: 'Draw-On Stroke', cat: 'Shapes', desc: 'Trim Paths end 0 → 100% (shape layers)', icon: ic('#20a0a0'), only: 'shape', apply(L, t) { L.shape.stroke.on = true; key(L.shape.trim.end, t, 0, EASE); key(L.shape.trim.end, t + 1.5, 100, EASE); } },
    drawOff: { name: 'Draw-Off Stroke', cat: 'Shapes', desc: 'Trim Paths start 0 → 100% (shape layers)', icon: ic('#20a0a0'), only: 'shape', apply(L, t) { L.shape.stroke.on = true; key(L.shape.trim.start, t, 0, EASE); key(L.shape.trim.start, t + 1.2, 100, EASE); } },
    typewriter: { name: 'Typewriter', cat: 'Text', desc: 'Characters appear one at a time', icon: ic('#1c4f8a'), only: 'text', apply(L, t) { const A = F.animator('Typewriter'); A.opacity.v = 0; A.sel.smooth = false; const n = [...L.text.str.replace(/\n/g, '')].length; key(A.sel.start, t, 0); key(A.sel.start, t + Math.max(.4, n * .06), 100); L.text.animators.push(A); } },
    riseChars: { name: 'Rise In by Character', cat: 'Text', desc: 'Characters fade and rise into place left to right', icon: ic('#1c4f8a'), only: 'text', apply(L, t) { const A = F.animator('Rise In'); A.opacity.v = 0; A.position.v = [0, 0.6 * LM.val(L.text.size, t + L.start)]; A.sel.shape = 'rampUp'; A.sel.end.v = 30; key(A.sel.offset, t, -30, EASE); key(A.sel.offset, t + 1.2, 100, EASE); L.text.animators.push(A); } },
    blurChars: { name: 'Blur In by Character', cat: 'Text', desc: 'Characters sharpen from a blur', icon: ic('#1c4f8a'), only: 'text', apply(L, t) { const A = F.animator('Blur In'); A.opacity.v = 0; A.blur.v = 24; A.scale.v = 160; A.sel.shape = 'rampUp'; A.sel.end.v = 40; key(A.sel.offset, t, -40, EASE); key(A.sel.offset, t + 1.4, 100, EASE); L.text.animators.push(A); } },
    tracking: { name: 'Tracking Squeeze', cat: 'Text', desc: 'Letter spacing eases from wide to normal', icon: ic('#1c4f8a'), only: 'text', apply(L, t) { const p = L.text.tracking, v = LM.val(p, t + L.start); key(p, t, v + 400, OUTQ); key(p, t + 1.5, v, OUTQ); } },
  };
  function slide(L, t, c, dx, dy) {
    const p = L.tr.position, v = LM.val(p, t + L.start).slice(), b = LM.layerBounds(L, t + L.start), s = LM.val(L.tr.scale, t + L.start);
    const w = (b[2] - b[0]) * Math.abs(s[0]) / 100, h = (b[3] - b[1]) * Math.abs(s[1]) / 100;
    const from = [dx ? (dx < 0 ? -w / 2 - 40 : c.w + w / 2 + 40) : v[0], dy ? (dy < 0 ? -h / 2 - 40 : c.h + h / 2 + 40) : v[1]];
    if (L.parent) { from[0] = v[0] + dx * c.w; from[1] = v[1] + dy * c.h; }
    key(p, t, from, { o: 'bezier', eo: [.15, .15] }); key(p, t + .8, v, { i: 'bezier', ei: [.75, 0] });
  }
  LM.applyPreset = (k, layers = LM.selLayers()) => {
    const P = LM.PRESETS[k]; if (!layers.length) return Aero.toast('Select a layer first');
    const c = LM.comp(); let n = 0;
    layers.forEach(L => { if (P.only && L.type !== P.only) return; const lt = LM.snap(st.time - L.start); P.apply(L, lt, c); L.expanded = true; n++; });
    if (!n) return Aero.toast(`“${P.name}” works on ${P.only} layers`);
    st.reveal = true; LM.commit('Preset: ' + P.name);
  };

  /* ================= Properties inspector ================= */
  const insp = $('#inspector');
  let iUpdaters = [];
  function renderInspector() {
    iUpdaters = []; insp.innerHTML = '';
    const c = LM.comp(), L = LM.selLayer();
    if (!c) return;
    if (!L) {
      $('#propname').textContent = 'Composition';
      const box = el('div', 'insp-sec');
      box.innerHTML = `<div class="insp-title">${W.typeIcon('comp')}<b>${esc(c.name)}</b></div>
        <div class="insp-grid"><span>Size</span><span>${c.w} × ${c.h} px</span><span>Frame rate</span><span>${c.fps} fps</span><span>Duration</span><span>${LM.fmtTC(c.duration, c.fps)} (${c.duration}s)</span><span>Layers</span><span>${c.layers.length}</span><span>Background</span><span><span class="swatch" style="background:${esc(c.bg)}"></span>${esc(c.bg)}</span></div>`;
      const b = el('button', 'aero-btn small', 'Composition Settings…'); b.onclick = () => LM.compSettings(); box.appendChild(b);
      const tip = el('div', 'insp-tip', 'Select a layer to edit its properties here. Keyboard: <b>P</b> position, <b>S</b> scale, <b>R</b> rotation, <b>T</b> opacity, <b>U</b> animated properties.');
      insp.append(box, tip); return;
    }
    $('#propname').textContent = ({ solid: 'Solid', shape: 'Shape Layer', text: 'Text Layer', image: 'Image', video: 'Video', null: 'Null Object', adjust: 'Adjustment Layer', precomp: 'Precomp', draw: 'Drawing Layer', audio: 'Audio Layer', camera: 'Camera' })[L.type] + (L.threeD ? ' · 3D' : '');
    const head = el('div', 'insp-sec');
    head.innerHTML = `<div class="insp-title">${W.typeIcon(L.type)}<input type="text" class="lname" value="${esc(L.name)}"></div>`;
    const nm = head.querySelector('.lname'); nm.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') nm.blur(); }; nm.onchange = () => { if (nm.value.trim()) { L.name = nm.value.trim(); LM.commit('Rename Layer'); } };
    // timing
    const tim = el('div', 'insp-grid timing');
    const tf = (label, get, set) => { tim.appendChild(el('span', '', label)); const s = W.scrub({ get, set: (v, f) => { set(v); if (f) LM.commit('Layer Timing'); else LM.touch(); }, step: 1 / c.fps, fmt: v => LM.fmtTC(v, c.fps) }); tim.appendChild(s); iUpdaters.push(s._update); };
    tf('In point', () => L.in, v => L.in = Math.min(LM.snap(v), L.out - 1 / c.fps)); tf('Out point', () => L.out, v => L.out = Math.max(LM.snap(v), L.in + 1 / c.fps)); tf('Start (time 0)', () => L.start, v => { const d = LM.snap(v) - L.start; L.start += d; });
    head.appendChild(tim);
    // quick add buttons
    const qb = el('div', 'insp-btns');
    const addB = (t, fn, title) => { const b = el('button', 'aero-btn small', t); b.title = title || ''; b.onclick = fn; qb.appendChild(b); };
    addB('+ Effect ▾', e => { const r = e.target.getBoundingClientRect(); W.menu(r.left, r.bottom, Object.entries(LM.FX).map(([k, d]) => [d.name, () => LM.addEffect(k)])); }, 'Add an effect');
    addB('+ Preset ▾', e => { const r = e.target.getBoundingClientRect(); W.menu(r.left, r.bottom, Object.entries(LM.PRESETS).filter(([, p]) => !p.only || p.only === L.type).map(([k, p]) => [p.name, () => LM.applyPreset(k)])); }, 'Apply an animation preset at the current time');
    if (L.type === 'text') addB('+ Animator', () => LM.addAnimator(L), 'Per-character animator with range selector');
    if (L.type === 'shape') addB('+ Shape ▾', e => { const r = e.target.getBoundingClientRect(); LM.shapeAddMenu(L, r.left, r.bottom); }, 'Add shape groups, a repeater, merge paths or gradients');
    if (LM.canTimeRemap(L)) addB(L.tm.on ? 'Time Remap ✓' : 'Time Remap', () => LM.toggleTimeRemap([L]), 'Enable/disable time remapping (Ctrl+Alt+T)');
    if (L.type !== 'audio' && L.type !== 'camera') addB(L.threeD ? '3D ✓' : '3D', () => LM.set3D([L]), 'Toggle 3D layer');
    if (L.type !== 'null' && L.type !== 'audio' && L.type !== 'camera') addB('+ Mask', () => LM.addMask(L, 'rect'), 'Add a rectangular mask (edit its vertices on the canvas)');
    if (L.type === 'text') addB('Edit Text…', () => LM.editText(L));
    if (L.type === 'precomp') addB('Open Precomp', () => LM.setActiveComp(L.comp));
    head.appendChild(qb);
    insp.appendChild(head);
    // property tree
    const tree = L._tree || LM.propTree(L, c);
    const addNodes = (items, parent, depth) => items.forEach(n => {
      if (n.items) {
        const g = el('div', 'insp-group'), key = 'insp|' + L.id + '|' + n.id, open = !LM.ui.open.has(key + '|closed');
        const h = el('div', 'insp-gh' + (depth ? ' sub' : '') + (open ? ' open' : ''), `<span class="twirl${open ? ' open' : ''}">${W.icon.twirl}</span>${esc(n.label)}`);
        if (n.kind === 'effect') { const fx = n.ref, on = el('input'); on.type = 'checkbox'; on.checked = fx.on; on.title = 'Effect on/off'; on.onclick = e => e.stopPropagation(); on.onchange = () => { fx.on = on.checked; LM.commit(fx.on ? 'Effect On' : 'Effect Off'); }; h.insertBefore(on, h.childNodes[1]); const del = el('button', 'mini', '✕'); del.title = 'Delete effect'; del.onclick = e => { e.stopPropagation(); L.effects = L.effects.filter(f => f !== fx); LM.commit('Delete Effect'); }; h.appendChild(del); }
        if (n.kind === 'mask') { const del = el('button', 'mini', '✕'); del.title = 'Delete mask'; del.onclick = e => { e.stopPropagation(); L.masks = L.masks.filter(m => m !== n.ref); LM.commit('Delete Mask'); }; h.appendChild(del); }
        if (n.kind === 'sgroup') { const g = n.ref, del = el('button', 'mini', '✕'); del.title = 'Delete group'; del.onclick = e => { e.stopPropagation(); L.shape.groups = L.shape.groups.filter(x => x !== g); LM.commit('Delete Group'); }; h.appendChild(del); }
        if (n.kind === 'repeater') { const del = el('button', 'mini', '✕'); del.title = 'Remove repeater'; del.onclick = e => { e.stopPropagation(); LM.toggleRepeater(L, n.ref === L.shape ? null : n.ref); }; h.appendChild(del); }
        if (n.kind === 'animator') { const del = el('button', 'mini', '✕'); del.title = 'Delete animator'; del.onclick = e => { e.stopPropagation(); L.text.animators = L.text.animators.filter(a => a !== n.ref); LM.commit('Delete Animator'); }; h.appendChild(del); }
        const body = el('div', 'insp-gb'); body.hidden = !open;
        h.onclick = () => { body.hidden = !body.hidden; h.classList.toggle('open', !body.hidden); h.querySelector('.twirl').classList.toggle('open', !body.hidden); if (body.hidden) LM.ui.open.add(key + '|closed'); else LM.ui.open.delete(key + '|closed'); };
        g.append(h, body); parent.appendChild(g); addNodes(n.items, body, depth + 1);
      } else {
        const row = el('div', 'insp-row');
        if (n.setting) { row.append(el('span', 'watch na'), el('span', 'pname', esc(n.label))); const ed = W.settingEditor(n, L); row.appendChild(ed); iUpdaters.push(ed._update); }
        else { const sw = W.stopwatch(n); iUpdaters.push(sw._update); row.append(sw, el('span', 'pname', esc(n.label))); const ed = W.propEditor(n, L); row.appendChild(ed); iUpdaters.push(ed._update); if (n.p.x != null) { const xb = el('span', 'xflag' + (LM.exprBlocked(n.p) ? ' blocked' : LM.exprError(n.p) ? ' bad' : ''), '='); xb.title = 'Expression: ' + n.p.x; row.appendChild(xb); } }
        parent.appendChild(row);
      }
    });
    addNodes([...tree.filter(n => n.id === 'transform'), ...tree.filter(n => n.id !== 'transform')], insp, 0);
  }
  LM.addMask = (L, kind) => { const b = LM.layerBounds(L, st.time), w = b[2] - b[0], h = b[3] - b[1], x0 = b[0] + w * .1, y0 = b[1] + h * .1, x1 = b[2] - w * .1, y1 = b[3] - h * .1; L.masks.push(F.mask(kind, [[x0, y0, 0, 0, 0, 0], [x1, y0, 0, 0, 0, 0], [x1, y1, 0, 0, 0, 0], [x0, y1, 0, 0, 0, 0]], 'Mask ' + (L.masks.length + 1))); L.expanded = true; LM.ui.open.add(L.id + '|masks'); LM.commit('New Mask'); };
  LM.on('structure', renderInspector); LM.on('select', renderInspector); LM.on('selectQuiet', renderInspector);
  LM.on('time', () => iUpdaters.forEach(f => f())); LM.on('values', () => iUpdaters.forEach(f => f()));

  /* ================= History ================= */
  LM.on('history', () => { Aero.renderHistory($('#history'), LM.hist, i => LM.historyGo(i)); $('#histinfo').textContent = LM.hist.items.length + ' states'; });

  /* ================= Command bar (tool options) ================= */
  const cmd = $('#cmd');
  const TOOLNAMES = { select: 'Selection', hand: 'Hand', zoom: 'Zoom', rotate: 'Rotation', anchor: 'Pan Behind (Anchor)', pen: 'Pen', rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', text: 'Horizontal Type', brush: 'Brush', eraser: 'Eraser' };
  function renderCmd() {
    const t = st.tool, O = st.shapeOpts, B = st.brush;
    let h = `<span class="tname">${TOOLNAMES[t]}</span>`;
    const hint = s => h += `<span class="hint">${s}</span>`;
    if (t === 'select') hint('Drag to move · Alt-drag a motion-path key to pull bezier handles · handles scale (Shift = proportional) · drag just outside a corner to rotate · drag path vertices, Alt-drag to pull tangents, double-click a vertex to toggle smooth');
    if (t === 'hand') hint('Drag to pan the view · hold Space with any tool');
    if (t === 'zoom') hint('Click to zoom in · Alt-click to zoom out · mouse wheel zooms everywhere');
    if (t === 'rotate') hint('Drag a layer to rotate it around its anchor point · Shift snaps to 45°');
    if (t === 'anchor') hint('Drag a layer to move its anchor point without moving the layer');
    if (['rect', 'ellipse', 'polygon', 'star', 'pen'].includes(t)) {
      h += `<span class="seg"><button class="aero-btn${st.mode === 'shape' ? ' on' : ''}" data-mode="shape">Shape Layer</button><button class="aero-btn${st.mode === 'mask' ? ' on' : ''}" data-mode="mask" title="Draw a mask on the selected layer">Mask</button></span>`;
      h += `<label><input type="checkbox" data-k="fillOn"${O.fillOn ? ' checked' : ''}>Fill</label><input type="color" data-k="fill" value="${O.fill}">`;
      h += `<label><input type="checkbox" data-k="strokeOn"${O.strokeOn ? ' checked' : ''}>Stroke</label><input type="color" data-k="stroke" value="${O.stroke}"><label><input type="number" data-k="strokeWidth" value="${O.strokeWidth}" min="0" max="200" style="width:52px">px</label>`;
      if (t === 'polygon' || t === 'star') h += `<label>Points <input type="number" data-k="points" value="${O.points}" min="3" max="64" style="width:48px"></label>`;
      if (t === 'pen') hint('Click to add points · drag to curve · click the first point to close · Enter to finish · Esc to cancel');
      else hint('Drag to draw · Shift = square/circle');
    }
    if (t === 'text') { h += `<label>Font <select data-t="font">${LM.FONTS.map(f => `<option${f === st.textOpts.font ? ' selected' : ''}>${f}</option>`).join('')}</select></label><label>Size <input type="number" data-t="size" value="${st.textOpts.size}" min="4" max="1000" style="width:56px"></label><input type="color" data-t="color" value="${st.textOpts.color}">`; hint('Click to type a new text layer · click a text layer to edit it in place · Esc finishes'); }
    if (t === 'brush' || t === 'eraser') {
      h += `<label>Size <input type="range" data-b="size" min="1" max="120" value="${B.size}"><span class="v">${B.size}px</span></label>`;
      if (t === 'brush') h += `<input type="color" data-b="color" value="${B.color}">`;
      h += `<label><input type="checkbox" data-b="pressure"${B.pressure ? ' checked' : ''}>Pen pressure</label><span class="sep"></span><label><input type="checkbox" data-b="onion"${(LM.selLayer()?.type === 'draw' ? LM.selLayer().draw.onion : B.onion) ? ' checked' : ''}>Onion skin</label><label><input type="number" data-b="before" value="${B.before}" min="0" max="5" style="width:38px" title="Frames before">◀ ▶<input type="number" data-b="after" value="${B.after}" min="0" max="5" style="width:38px" title="Frames after"></label>`;
      h += `<span class="sep"></span><button class="aero-btn" data-cel="blank" title="Insert blank cel at current frame (F7)">New Cel</button><button class="aero-btn" data-cel="dup" title="Duplicate the current cel onto this frame (F6)">Duplicate Cel</button><button class="aero-btn" data-cel="next" title="Next frame (Page Down)">Next Frame ▸</button>`;
    }
    cmd.innerHTML = h;
    cmd.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { st.mode = b.dataset.mode; if (st.mode === 'mask' && !LM.selLayer()) Aero.toast('Select the layer to mask first'); renderCmd(); });
    cmd.querySelectorAll('[data-k]').forEach(i => i.oninput = () => { const k = i.dataset.k; O[k] = i.type === 'checkbox' ? i.checked : i.type === 'number' ? +i.value : i.value; });
    cmd.querySelectorAll('[data-t]').forEach(i => i.oninput = () => { st.textOpts[i.dataset.t] = i.type === 'number' ? +i.value : i.value; });
    cmd.querySelectorAll('[data-b]').forEach(i => i.oninput = () => { const k = i.dataset.b; const v = i.type === 'checkbox' ? i.checked : i.type === 'color' ? i.value : +i.value; B[k] = v; if (k === 'size') i.nextElementSibling.textContent = v + 'px'; if (k === 'onion') { const L = LM.selLayer(); if (L?.type === 'draw') L.draw.onion = v; } LM.requestRender(); });
    cmd.querySelectorAll('[data-cel]').forEach(b => b.onclick = () => LM.celCommand(b.dataset.cel));
    cmd.querySelectorAll('input[type=number],select').forEach(i => i.addEventListener('keydown', e => e.stopPropagation()));
  }
  LM.renderCmd = renderCmd;
  LM.on('select', () => { if (st.tool === 'brush' || st.tool === 'eraser') renderCmd(); });

  /* ================= Viewer bar ================= */
  const vb = $('#viewbar');
  vb.innerHTML = `<select id="vzoom" title="Magnification"><option value="fit">Fit</option><option value="0.25">25%</option><option value="0.5">50%</option><option value="1">100%</option><option value="2">200%</option><option value="4">400%</option></select>
    <select id="vres" title="Preview resolution"><option value="1">Full</option><option value="0.5">Half</option><option value="0.333333">Third</option><option value="0.25">Quarter</option></select>
    <button class="aero-btn small" id="vgrid" title="Toggle transparency grid">▦</button><button class="aero-btn small on" id="vpath" title="Show motion paths">⤳</button><span class="vtime mono"></span>`;
  const vz = vb.querySelector('#vzoom'), vr = vb.querySelector('#vres');
  vz.onchange = () => { if (vz.value === 'fit') LM.viewer.fitView(); else LM.viewer.setZoom(+vz.value); };
  vr.onchange = () => { st.res = +vr.value; LM.cacheReset(); LM.requestRender(); };
  vb.querySelector('#vgrid').onclick = e => { LM.viewer.grid = !LM.viewer.grid; e.currentTarget.classList.toggle('on', LM.viewer.grid); LM.requestRender(); };
  vb.querySelector('#vpath').onclick = e => { LM.viewer.showPaths = !LM.viewer.showPaths; e.currentTarget.classList.toggle('on', LM.viewer.showPaths); LM.requestRender(); };
  LM.on('zoom', () => { const z = LM.viewer.z; if (LM.viewer.fit) { vz.value = 'fit'; vz.options[0].text = `Fit (${Math.round(z * 100)}%)`; } else { let o = [...vz.options].find(o => Math.abs(+o.value - z) < 1e-3); if (!o) { o = vz.querySelector('option.custom') || new Option('', '', false, false); o.className = 'custom'; o.value = z; o.text = Math.round(z * 100) + '%'; vz.add(o); } vz.value = o.value; vz.options[0].text = 'Fit'; } });
  LM.on('time', () => { const c = LM.comp(); if (c) vb.querySelector('.vtime').textContent = LM.fmtTC(st.time, c.fps); });
  vr.onkeydown = vz.onkeydown = e => e.stopPropagation();

  /* ================= Status bar ================= */
  const sComp = $('#st-comp'), sFps = $('#st-fps'), sCache = $('#st-cache'), sExpr = $('#st-expr');
  const statusComp = () => { const c = LM.comp(); if (c) sComp.textContent = `${c.name} · ${c.w}×${c.h} · ${c.fps} fps · ${c.layers.length} layer${c.layers.length === 1 ? '' : 's'}`; };
  LM.on('structure', statusComp); LM.on('compchange', statusComp);
  LM.on('fps', f => { sFps.textContent = f ? `Playback ${f.toFixed(1)} fps` : ''; });
  LM.on('cache', () => { const n = LM.cachedFrames().size; sCache.textContent = n ? `RAM cache: ${n} frames` : ''; });
  const exprStatus = () => {
    let total = 0, blocked = 0; LM.doc.comps.forEach(c => c.layers.forEach(L => LM.leaves(L).forEach(n => { if (n.p.x && n.p.xe !== false) { total++; if (!LM.trusted.has(n.p.x)) blocked++; } })));
    sExpr.textContent = blocked ? `⚠ ${blocked} expression${blocked > 1 ? 's' : ''} disabled (Edit › Enable Expressions…)` : total ? `${total} expression${total > 1 ? 's' : ''} active` : '';
    sExpr.classList.toggle('warn', !!blocked); sExpr.onclick = blocked ? () => LM.reviewExpressions() : null;
  };
  LM.on('structure', exprStatus); LM.on('change', exprStatus);

  /* ================= Welcome card ================= */
  const welcome = $('#welcome');
  welcome.innerHTML = `<div class="wcard"><img src="../kit/icons/motion.png" alt=""><h2>Lumen Motion</h2><p>Motion graphics &amp; animation — compositions, keyframes, graph editor, shape &amp; text animators, effects, expressions and video export.</p>
    <div class="wbtns"><button class="aero-btn pri" data-w="sample">Open Sample</button><button class="aero-btn" data-w="new">New Composition…</button><button class="aero-btn" data-w="open">Open Project…</button></div>
    <p class="dim">Or start drawing: pick the Rectangle, Pen, Type or Brush tool and work directly in this composition. Drop images or video anywhere.</p></div>`;
  welcome.onclick = e => { const b = e.target.closest('[data-w]'); if (!b) return; ({ sample: () => LM.openSample(), new: () => LM.newCompDialog(), open: () => LM.openProject() })[b.dataset.w](); };
  const updWelcome = () => { const c = LM.comp(); welcome.hidden = !(c && !c.layers.length && LM.doc.comps.length === 1 && !LM.hist.items.slice(1).length); };
  LM.on('structure', updWelcome); LM.on('history', updWelcome);

  renderFx();
})();
