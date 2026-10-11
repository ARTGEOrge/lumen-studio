'use strict';
/* Lumen Motion — timeline: layer bars, property tree, keyframes, ruler, work area, CTI. */
(function () {
  const LM = window.LM, el = Aero.el, esc = Aero.esc, W = LM.w, st = LM.st, $ = LM.$;
  const root = $('#timeline');
  const LW = 548;
  const TL = LM.tl = { v0: 0, v1: 10, graph: false, graphMode: 'value', LW };
  root.style.setProperty('--lw', LW + 'px');
  root.innerHTML = `
    <div class="tl-head">
      <span class="tl-time" title="Current time — click to type a time or frame"></span>
      <span class="tl-comptabs"></span>
      <span class="tl-sep"></span>
      <span class="tl-transport">
        <button data-a="home" title="First frame (Home)">⏮</button><button data-a="prev" title="Previous frame (Page Up)">◀|</button><button data-a="play" class="play" title="Play / Stop (Space)">▶</button><button data-a="next" title="Next frame (Page Down)">|▶</button><button data-a="end" title="Last frame (End)">⏭</button>
        <button data-a="loop" title="Loop playback">⟲</button><button data-a="ram" title="RAM Preview: render the work area to memory, then play in real time (Numpad 0)">RAM ▶</button>
      </span>
      <span class="tl-sep"></span>
      <button class="tl-tog" data-a="reveal" title="Reveal only animated properties (U)">U</button>
      <button class="tl-tog" data-a="mb" title="Enable motion blur for layers with the Motion Blur switch">◎ MB</button>
      <button class="tl-tog" data-a="graph" title="Graph Editor (Shift+F3)">∿ Graph Editor</button>
      <span class="tl-graphopts">
        <select data-a="gmode"><option value="value">Value Graph</option><option value="speed">Speed Graph</option></select>
        <button data-a="ease" title="Easy Ease (F9)">Easy Ease</button><button data-a="easeIn" title="Easy Ease In (Shift+F9)">Ease In</button><button data-a="easeOut" title="Easy Ease Out (Ctrl+Shift+F9)">Ease Out</button><button data-a="linear" title="Linear">Linear</button><button data-a="hold" title="Toggle Hold Keyframe (Ctrl+Alt+H)">Hold</button>
      </span>
      <span class="tl-grow"></span>
      <label class="tl-zoom" title="Timeline zoom">−<input type="range" min="0" max="100" value="0">+</label>
    </div>
    <div class="tl-main">
      <div class="tl-scroll">
        <div class="tl-colhead"><div class="tl-left"><span class="ch-sw">◉ 👁 🔒</span><span class="ch-num">#</span><span class="ch-name">Layer Name</span><span class="ch-sws">MB fx</span><span class="ch-mode">Mode</span><span class="ch-matte">Track Matte</span><span class="ch-par">Parent</span></div><div class="tl-ruler"><canvas></canvas></div></div>
        <div class="tl-rows"></div>
        <div class="tl-empty">This composition has no layers yet. Use <b>Layer › New</b>, draw with the shape or pen tools, or drop images/video here.</div>
      </div>
      <div class="tl-cti"><div class="tl-ctihead"></div></div>
      <canvas class="tl-graph" hidden></canvas>
      <svg class="tl-whip" hidden><line stroke="#2a6fd0" stroke-width="2" stroke-dasharray="4 3"/></svg>
      <div class="tl-marquee" hidden></div>
    </div>`;
  const head = root.querySelector('.tl-head'), scroll = root.querySelector('.tl-scroll'), rowsEl = root.querySelector('.tl-rows'), main = root.querySelector('.tl-main');
  const ruler = root.querySelector('.tl-ruler canvas'), cti = root.querySelector('.tl-cti'), timeEl = root.querySelector('.tl-time');
  const zoomIn = root.querySelector('.tl-zoom input'), whip = root.querySelector('.tl-whip'), marq = root.querySelector('.tl-marquee');
  TL.graphCanvas = root.querySelector('.tl-graph');

  /* ---------- time ↔ x ---------- */
  const rulerBox = root.querySelector('.tl-ruler');
  const trackW = () => Math.max(50, rulerBox.clientWidth || (main.clientWidth - LW - 17));
  TL.x = t => (t - TL.v0) / (TL.v1 - TL.v0) * trackW();
  TL.t = x => TL.v0 + x / trackW() * (TL.v1 - TL.v0);
  TL.trackW = trackW;
  function fitRange() { const c = LM.comp(); if (!c) return; TL.v0 = 0; TL.v1 = c.duration; zoomIn.value = 0; }
  function applyZoom() {
    const c = LM.comp(); if (!c) return;
    const z = +zoomIn.value / 100, minSpan = Math.max(10 / c.fps, .25), span = c.duration * Math.pow(minSpan / c.duration, z);
    let v0 = st.time - span * ((st.time - TL.v0) / (TL.v1 - TL.v0 || 1));
    v0 = Math.max(0, Math.min(c.duration - span, v0)); TL.v0 = v0; TL.v1 = v0 + span;
    layoutTracks(); drawRuler(); updateCTI(); LM.graph?.draw();
  }
  zoomIn.oninput = applyZoom;
  // ensure CTI visible during playback
  function follow() { const span = TL.v1 - TL.v0, c = LM.comp(); if (!c) return; if (st.time < TL.v0 || st.time > TL.v1) { TL.v0 = Math.max(0, Math.min(c.duration - span, st.time - span * .1)); TL.v1 = TL.v0 + span; layoutTracks(); drawRuler(); LM.graph?.draw(); } }

  /* ---------- header / transport ---------- */
  head.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return; const a = b.dataset.a, c = LM.comp(); if (!c) return;
    if (a === 'home') LM.setTime(0); if (a === 'end') LM.setTime(c.duration);
    if (a === 'prev') LM.setTime(st.time - 1 / c.fps); if (a === 'next') LM.setTime(st.time + 1 / c.fps);
    if (a === 'play') LM.togglePlay(); if (a === 'ram') LM.ramPreview();
    if (a === 'loop') { st.loop = !st.loop; syncHead(); }
    if (a === 'reveal') { st.reveal = !st.reveal; rebuild(); }
    if (a === 'mb') { c.mbOn = !c.mbOn; LM.commit(c.mbOn ? 'Enable Motion Blur' : 'Disable Motion Blur', false); syncHead(); }
    if (a === 'graph') TL.toggleGraph();
    if (['ease', 'easeIn', 'easeOut', 'linear'].includes(a)) LM.setKeysInterp(a);
    if (a === 'hold') LM.toggleHold();
  });
  head.querySelector('[data-a=gmode]').onchange = e => { TL.graphMode = e.target.value; LM.graph?.draw(); };
  TL.toggleGraph = () => { TL.graph = !TL.graph; TL.graphCanvas.hidden = !TL.graph; root.classList.toggle('graphmode', TL.graph); syncHead(); LM.graph?.resize(); };
  LM.toggleHold = () => { const refs = LM.selectedKeyRefs(); if (!refs.length) return Aero.toast('Select keyframes first'); const on = !refs.every(r => r.k.o === 'hold'); refs.forEach(({ k }) => { if (on) { k._prevO = k.o; k.o = 'hold'; } else k.o = 'linear'; }); LM.commit('Toggle Hold Keyframe'); };
  function syncHead() {
    const c = LM.comp();
    head.querySelector('[data-a=play]').textContent = st.playing ? '■' : '▶';
    head.querySelector('[data-a=play]').classList.toggle('on', st.playing);
    head.querySelector('[data-a=loop]').classList.toggle('on', st.loop);
    head.querySelector('[data-a=ram]').classList.toggle('on', !!(st.rendering || st.ramPlaying));
    head.querySelector('[data-a=reveal]').classList.toggle('on', st.reveal);
    head.querySelector('[data-a=mb]').classList.toggle('on', !!c?.mbOn);
    head.querySelector('[data-a=graph]').classList.toggle('on', TL.graph);
    const tabs = head.querySelector('.tl-comptabs'); tabs.innerHTML = '';
    LM.doc.comps.forEach(cc => { if (cc.id !== LM.doc.active && !TL.openTabs.has(cc.id)) return; const t = el('span', 'tl-ctab' + (cc.id === LM.doc.active ? ' on' : ''), esc(cc.name)); t.onclick = () => LM.setActiveComp(cc.id); tabs.appendChild(t); });
  }
  TL.openTabs = new Set();
  LM.on('compchange', () => { TL.openTabs.add(LM.doc.active); fitRange(); });
  LM.on('play', syncHead);
  timeEl.onclick = async () => {
    const c = LM.comp(); if (!c) return;
    const v = await Aero.prompt('Go To Time', 'Time (h:mm:ss:ff), seconds (e.g. 2.5s) or frame number', LM.fmtTC(st.time, c.fps)); if (v == null) return;
    LM.setTime(LM.parseTime(v, c.fps));
  };
  LM.parseTime = (v, fps) => { v = String(v).trim(); if (/s$/.test(v)) return parseFloat(v); if (v.includes(':')) { const p = v.split(':').map(Number); while (p.length < 4) p.unshift(0); return p[0] * 3600 + p[1] * 60 + p[2] + p[3] / fps; } return (parseFloat(v) || 0) / fps; };

  /* ---------- ruler ---------- */
  function drawRuler() {
    const c = LM.comp(); if (!c) return;
    const w = trackW(), h = 34, dpr = devicePixelRatio || 1;
    ruler.width = Math.round(w * dpr); ruler.height = h * dpr; ruler.style.width = w + 'px'; ruler.style.height = h + 'px';
    const x = ruler.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, w, h);
    const g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#fbfdff'); g.addColorStop(1, '#dde8f4'); x.fillStyle = g; x.fillRect(0, 0, w, h);
    // work area
    const wa0 = TL.x(c.workIn), wa1 = TL.x(Math.min(c.workOut, c.duration));
    x.fillStyle = '#c9d8ea'; x.fillRect(0, 2, w, 9);
    const wg = x.createLinearGradient(0, 2, 0, 11); wg.addColorStop(0, '#9cc4ec'); wg.addColorStop(1, '#4f8fd0'); x.fillStyle = wg; x.fillRect(wa0, 2, wa1 - wa0, 9);
    x.fillStyle = '#1d4f86'; x.fillRect(wa0, 1, 3, 11); x.fillRect(wa1 - 3, 1, 3, 11);
    // cache bar
    const cache = LM.cachedFrames(); x.fillStyle = '#3cc04a';
    cache.forEach((_, f) => { const a = TL.x(f / c.fps), b = TL.x((f + 1) / c.fps); if (b >= 0 && a <= w) x.fillRect(a, 12, Math.max(1, b - a + .5), 3); });
    // ticks
    const span = TL.v1 - TL.v0, pxPerSec = w / span;
    const steps = [1 / c.fps, 2 / c.fps, 5 / c.fps, 10 / c.fps, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
    const major = steps.find(s => s * pxPerSec >= 70) || 300, minor = steps.slice().reverse().find(s => s * pxPerSec >= 8 && s < major) || major / 5;
    x.strokeStyle = '#7b8da3'; x.fillStyle = '#2c3e55'; x.font = '10px "Segoe UI"'; x.lineWidth = 1;
    x.beginPath();
    for (let t = Math.floor(TL.v0 / minor) * minor; t <= TL.v1 + 1e-9; t += minor) { const px = Math.round(TL.x(t)) + .5; const isMaj = Math.abs(t / major - Math.round(t / major)) < 1e-6; x.moveTo(px, h); x.lineTo(px, h - (isMaj ? 10 : 4)); if (isMaj) x.fillText(major < 1 ? `${Math.floor(t)}:${String(Math.round((t % 1) * c.fps)).padStart(2, '0')}f` : LM.fmtTC(t, c.fps).replace(/^0:/, ''), px + 3, h - 12); }
    x.stroke();
    x.strokeStyle = '#a7bcd6'; x.beginPath(); x.moveTo(0, h - .5); x.lineTo(w, h - .5); x.stroke();
  }
  TL.drawRuler = drawRuler;
  let rulerQueued = false;
  LM.on('cache', () => { if (rulerQueued) return; rulerQueued = true; setTimeout(() => { rulerQueued = false; drawRuler(); }, 120); });
  ruler.addEventListener('pointerdown', e => {
    const c = LM.comp(); if (!c) return;
    try { ruler.setPointerCapture(e.pointerId); } catch (_) { }
    const r = ruler.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const wa0 = TL.x(c.workIn), wa1 = TL.x(c.workOut);
    let mode = 'scrub';
    if (py < 13) { if (Math.abs(px - wa0) < 6) mode = 'wa0'; else if (Math.abs(px - wa1) < 6) mode = 'wa1'; else if (px > wa0 && px < wa1) mode = 'wam'; }
    const t0 = TL.t(px), w0 = [c.workIn, c.workOut];
    if (st.playing) LM.stop();
    const mv = ev => {
      const t = TL.t(ev.clientX - r.left);
      if (mode === 'scrub') LM.setTime(t);
      else if (mode === 'wa0') c.workIn = Math.max(0, Math.min(LM.snap(t), c.workOut - 1 / c.fps));
      else if (mode === 'wa1') c.workOut = Math.min(c.duration, Math.max(LM.snap(t), c.workIn + 1 / c.fps));
      else { let d = LM.snap(t - t0); d = Math.max(-w0[0], Math.min(c.duration - w0[1], d)); c.workIn = w0[0] + d; c.workOut = w0[1] + d; }
      if (mode !== 'scrub') drawRuler();
    };
    mv(e);
    const up = () => { ruler.removeEventListener('pointermove', mv); ruler.removeEventListener('pointerup', up); if (mode !== 'scrub') LM.commit('Work Area', false); };
    ruler.addEventListener('pointermove', mv); ruler.addEventListener('pointerup', up);
  });

  /* ---------- CTI ---------- */
  function updateCTI() {
    const c = LM.comp(); if (!c) return;
    const x = TL.x(st.time); const vis = x >= -1 && x <= trackW() + 1;
    cti.style.display = vis ? '' : 'none'; cti.style.left = (LW + x) + 'px';
    timeEl.innerHTML = `${LM.fmtTC(st.time, c.fps)}<small>${Math.round(st.time * c.fps)} (${c.fps} fps)</small>`;
  }
  TL.updateCTI = updateCTI;

  /* ---------- rows ---------- */
  let updaters = [], kfEls = [];   // kfEls: {el, L, k}
  const isOpen = (L, g) => st.reveal || !!st.revealOnly || LM.ui.open.has(L.id + '|' + g.id);
  function visibleTree(L, items) {
    if (st.revealOnly) { const ro = st.revealOnly; const keep = n => n.items ? (n.id === ro || n.items.some(keep)) : n.id === ro; const filt = list => list.filter(keep).map(n => n.items && n.id !== ro ? { ...n, items: filt(n.items) } : n); return filt(items); }
    if (!st.reveal) return items;
    const keep = n => n.items ? n.items.some(keep) : n.p && (LM.animated(n.p) || n.p.x);
    const filt = list => list.filter(keep).map(n => n.items ? { ...n, items: filt(n.items) } : n);
    return filt(items);
  }
  function rebuild() {
    const c = LM.comp(); updaters = []; kfEls = []; rowsEl.innerHTML = '';
    syncHead();
    if (!c) return;
    root.querySelector('.tl-empty').style.display = c.layers.length ? 'none' : '';
    c.layers.forEach((L, i) => {
      if (st.reveal && !LM.layerHasAnim(L)) return;
      rowsEl.appendChild(layerRow(L, i, c));
      if (L.expanded || st.reveal) addItems(L, visibleTree(L, L._tree || []), 1);
      void 0;
    });
    layoutTracks(); drawRuler(); updateCTI(); LM.graph?.draw();
  }
  TL.rebuild = rebuild;
  function addItems(L, items, depth) {
    items.forEach(n => {
      if (n.items) {
        rowsEl.appendChild(groupRow(L, n, depth));
        if (isOpen(L, n)) addItems(L, n.items, depth + 1);
      } else if (n.setting) rowsEl.appendChild(settingRow(L, n, depth));
      else if (n.p) { rowsEl.appendChild(propRow(L, n, depth)); if (n.p.x != null) rowsEl.appendChild(exprRow(L, n, depth)); }
    });
  }
  const indent = d => `<span class="ind" style="width:${d * 14 + 4}px"></span>`;
  function layerRow(L, i, c) {
    const r = el('div', 'tl-row layer' + (st.sel.includes(L.id) ? ' sel' : '') + (L.visible ? '' : ' hidden-layer'));
    r.dataset.id = L.id;
    const left = el('div', 'tl-left'), track = el('div', 'tl-track');
    left.innerHTML = `<span class="sw eye${L.visible ? ' on' : ''}" title="Video (show/hide)">${L.visible ? W.icon.eye : ''}</span><span class="sw solo${L.solo ? ' on' : ''}" title="Solo">${L.solo ? W.icon.solo : ''}</span><span class="sw lock${L.locked ? ' on' : ''}" title="Lock">${L.locked ? W.icon.lock : ''}</span>` +
      `<span class="twirl${L.expanded ? ' open' : ''}">${W.icon.twirl}</span><span class="lbl" style="background:${LM.LABELS[L.label] || '#888'}"></span><span class="num">${i + 1}</span><span class="ticon">${W.typeIcon(L.type)}</span><span class="name" title="${esc(L.name)} — double-click to rename">${esc(L.name)}</span>` +
      `<span class="sw mbsw${L.mb ? ' on' : ''}" title="Motion Blur switch">${L.mb ? W.icon.mb : ''}</span><span class="sw fxsw${L.effects.length ? (L.effects.some(f => f.on) ? ' on' : '') : ' na'}" title="Effects on/off">${L.effects.length ? W.icon.fx : ''}</span>`;
    const mode = el('select', 'mode'); LM.BLENDS.forEach(([v, t]) => mode.add(new Option(t, v))); mode.value = L.blend; mode.title = 'Blending mode';
    mode.onchange = () => { L.blend = mode.value; LM.commit('Blending Mode'); };
    const matte = el('select', 'matte'); [['', 'None'], ['alpha', 'Alpha Matte'], ['alphaInv', 'Alpha Inverted'], ['luma', 'Luma Matte'], ['lumaInv', 'Luma Inverted']].forEach(([v, t]) => matte.add(new Option(t, v)));
    matte.value = L.matte || ''; matte.disabled = i === 0; matte.title = i === 0 ? 'Track matte uses the layer above — move a layer above this one first' : `Use “${c.layers[i - 1].name}” (the layer above) as a matte`;
    matte.onchange = () => { L.matte = matte.value || null; LM.commit('Track Matte'); };
    const pw = el('span', 'pw', W.icon.pick); pw.title = 'Pick whip: drag onto another layer to parent';
    const par = el('select', 'parent'); par.add(new Option('None', '')); c.layers.forEach((o, j) => { if (o !== L) par.add(new Option(`${j + 1}. ${o.name}`, o.id)); }); par.value = L.parent || ''; par.title = 'Parent layer';
    par.onchange = () => LM.setParent(L, par.value || null);
    [mode, matte, par].forEach(s => { s.onpointerdown = e => e.stopPropagation(); s.onclick = e => e.stopPropagation(); });
    left.append(mode, matte, pw, par);
    left.querySelector('.eye').onclick = e => { e.stopPropagation(); L.visible = !L.visible; LM.commit(L.visible ? 'Show Layer' : 'Hide Layer'); };
    left.querySelector('.solo').onclick = e => { e.stopPropagation(); L.solo = !L.solo; LM.commit('Solo'); };
    left.querySelector('.lock').onclick = e => { e.stopPropagation(); L.locked = !L.locked; LM.commit(L.locked ? 'Lock Layer' : 'Unlock Layer'); };
    left.querySelector('.mbsw').onclick = e => { e.stopPropagation(); L.mb = !L.mb; LM.commit('Motion Blur Switch'); if (L.mb && !c.mbOn) Aero.toast('Turn on “◎ MB” in the timeline header to see motion blur'); };
    left.querySelector('.fxsw').onclick = e => { e.stopPropagation(); if (!L.effects.length) return; const on = !L.effects.some(f => f.on); L.effects.forEach(f => f.on = on); LM.commit(on ? 'Effects On' : 'Effects Off'); };
    left.querySelector('.twirl').onclick = e => { e.stopPropagation(); if (st.revealOnly || st.reveal) { st.revealOnly = null; st.reveal = false; L.expanded = true; } else L.expanded = !L.expanded; rebuild(); };
    left.querySelector('.name').ondblclick = e => { e.stopPropagation(); renameInline(e.target, L.name, v => { L.name = v; LM.commit('Rename Layer'); }); };
    pw.onpointerdown = e => startWhip(e, L);
    left.onpointerdown = e => layerLeftDown(e, L, r);
    left.oncontextmenu = e => { e.preventDefault(); if (!st.sel.includes(L.id)) LM.select([L.id]); LM.layerContextMenu(e.clientX, e.clientY); };
    const bar = el('div', 'bar'); bar.style.setProperty('--lc', LM.LABELS[L.label] || '#888');
    bar.innerHTML = '<span class="h l"></span><span class="h r"></span>';
    bar.dataset.id = L.id; track.appendChild(bar);
    r._layout = () => { bar.style.left = TL.x(L.in) + 'px'; bar.style.width = Math.max(2, TL.x(L.out) - TL.x(L.in)) + 'px'; };
    bar.onpointerdown = e => barDown(e, L, bar);
    r.append(left, track);
    return r;
  }
  function renameInline(span, value, done) {
    const inp = el('input', 'rename'); inp.type = 'text'; inp.value = value; span.replaceWith(inp); inp.focus(); inp.select();
    let fin = false; const end = ok => { if (fin) return; fin = true; if (ok && inp.value.trim() && inp.value !== value) done(inp.value.trim()); else rebuild(); };
    inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') end(true); if (e.key === 'Escape') end(false); };
    inp.onblur = () => end(true); inp.onpointerdown = e => e.stopPropagation();
  }
  function groupRow(L, n, depth) {
    const r = el('div', 'tl-row group'), left = el('div', 'tl-left'), track = el('div', 'tl-track');
    const open = isOpen(L, n);
    left.innerHTML = `<span class="kfspace"></span>${indent(depth)}<span class="twirl${open ? ' open' : ''}">${W.icon.twirl}</span><span class="gname">${esc(n.label)}</span>`;
    const tw = () => { const k = L.id + '|' + n.id; LM.ui.open.has(k) ? LM.ui.open.delete(k) : LM.ui.open.add(k); rebuild(); };
    left.querySelector('.twirl').onclick = e => { e.stopPropagation(); tw(); };
    left.querySelector('.gname').onclick = e => { e.stopPropagation(); tw(); };
    if (n.kind === 'effect') {
      const fx = n.ref, on = el('span', 'fxon' + (fx.on ? ' on' : ''), 'fx'); on.title = 'Effect on/off';
      on.onclick = e => { e.stopPropagation(); fx.on = !fx.on; LM.commit(fx.on ? 'Effect On' : 'Effect Off'); };
      left.querySelector('.twirl').after(on);
      left.appendChild(miniBtns(L, [['↑', 'Move effect up', () => moveIn(L.effects, fx, -1, 'Reorder Effects')], ['↓', 'Move effect down', () => moveIn(L.effects, fx, 1, 'Reorder Effects')], ['✕', 'Delete effect', () => { L.effects = L.effects.filter(f => f !== fx); LM.commit('Delete Effect'); }]]));
    }
    if (n.kind === 'mask') {
      const mk = n.ref; left.querySelector('.gname').ondblclick = e => { e.stopPropagation(); renameInline(e.target, mk.name, v => { mk.name = v; LM.commit('Rename Mask'); }); };
      left.appendChild(miniBtns(L, [['✕', 'Delete mask', () => { L.masks = L.masks.filter(m => m !== mk); LM.commit('Delete Mask'); }]]));
    }
    if (n.kind === 'animator') { const A = n.ref; left.appendChild(miniBtns(L, [['✕', 'Delete animator', () => { L.text.animators = L.text.animators.filter(a => a !== A); LM.commit('Delete Animator'); }]])); }
    if (n.id === 'text') left.appendChild(miniBtns(L, [['Animate ▸', 'Add a text animator (per-character offset/opacity/position with a range selector)', () => LM.addAnimator(L)]]));
    if (n.id === 'contents' && L.type === 'shape') void 0;
    r.append(left, track); return r;
  }
  function miniBtns(L, defs) { const s = el('span', 'gbtns'); defs.forEach(([t, title, fn]) => { const b = el('button', 'mini', esc(t)); b.title = title; b.onclick = e => { e.stopPropagation(); fn(); }; b.onpointerdown = e => e.stopPropagation(); s.appendChild(b); }); return s; }
  function moveIn(arr, item, d, label) { const i = arr.indexOf(item), j = i + d; if (j < 0 || j >= arr.length) return; arr.splice(i, 1); arr.splice(j, 0, item); LM.commit(label); }
  function settingRow(L, n, depth) {
    const r = el('div', 'tl-row prop setting'), left = el('div', 'tl-left'), track = el('div', 'tl-track');
    left.innerHTML = `<span class="kfspace"></span>${indent(depth)}<span class="watch na"></span><span class="pname">${esc(n.label)}</span>`;
    const ed = W.settingEditor(n, L); left.appendChild(ed); updaters.push(ed._update);
    r.append(left, track); return r;
  }
  const selKeyId = (L, n) => L.id + '|' + n.id;
  function propRow(L, n, depth) {
    const r = el('div', 'tl-row prop' + (st.selProps.has(selKeyId(L, n)) ? ' selprop' : '')), left = el('div', 'tl-left'), track = el('div', 'tl-track');
    const nav = W.kfNav(n, L); left.appendChild(nav); updaters.push(nav._update);
    left.insertAdjacentHTML('beforeend', indent(depth));
    const sw = W.stopwatch(n); left.appendChild(sw);
    const name = el('span', 'pname', esc(n.label)); left.appendChild(name);
    const canExpr = n.type !== 'path' && n.type !== 'drawing';
    if (canExpr) { const xb = el('span', 'xbtn' + (n.p.x != null ? ' on' : ''), '='); xb.title = n.p.x != null ? 'Remove expression' : 'Add expression (Alt+click the stopwatch)'; xb.onclick = e => { e.stopPropagation(); if (n.p.x != null) { delete n.p.x; delete n.p.xe; LM.commit('Remove Expression'); } else LM.addExpression(L, n); }; left.appendChild(xb); }
    sw.addEventListener('click', e => { if (e.altKey && canExpr) { e.stopImmediatePropagation(); if (n.p.x == null) LM.addExpression(L, n); } }, true);
    const ed = W.propEditor(n, L); left.appendChild(ed); updaters.push(ed._update);
    name.onclick = e => { e.stopPropagation(); const id = selKeyId(L, n); if (!e.ctrlKey && !e.shiftKey) st.selProps.clear(); st.selProps.add(id); if (!st.sel.includes(L.id)) st.sel = [L.id]; if (!e.shiftKey) st.selKeys.clear(); (n.p.k || []).forEach(k => st.selKeys.add(k)); rebuild(); LM.requestRender(); LM.emit('selkeys'); };
    name.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); propMenu(e, L, n); };
    (n.p.k || []).forEach(k => {
      const d = el('span', 'kf ' + kfClass(k) + (st.selKeys.has(k) ? ' sel' : '')); d.title = `${LM.fmtTC(k.t + L.start, LM.fps())} — drag to move, double-click to jump, right-click for interpolation`;
      track.appendChild(d); kfEls.push({ el: d, L, k, n });
      d.onpointerdown = e => keyDown(e, L, k, n);
      d.ondblclick = e => { e.stopPropagation(); LM.setTime(k.t + L.start); };
      d.oncontextmenu = e => { e.preventDefault(); e.stopPropagation(); if (!st.selKeys.has(k)) { st.selKeys.clear(); st.selKeys.add(k); markKeys(); } keyMenu(e); };
    });
    r.append(left, track); return r;
  }
  function kfClass(k) { if (k.o === 'hold') return 'hold'; const e = x => x === 'ease' || x === 'bezier'; return e(k.i) || e(k.o) ? 'ease' : 'lin'; }
  function exprRow(L, n, depth) {
    const r = el('div', 'tl-row expr'), left = el('div', 'tl-left'), track = el('div', 'tl-track');
    const blocked = LM.exprBlocked(n.p);
    left.innerHTML = `<span class="kfspace"></span>${indent(depth + 1)}<label class="xen" title="Enable expression"><input type="checkbox"${n.p.xe !== false ? ' checked' : ''}> Expression: ${esc(n.label)}</label><span class="xerr"></span>`;
    left.querySelector('input').onchange = e => { n.p.xe = e.target.checked; LM.commit('Toggle Expression', false); };
    const ta = el('textarea', 'exprin'); ta.value = n.p.x; ta.spellcheck = false; ta.rows = Math.min(4, (n.p.x.match(/\n/g) || []).length + 1);
    ta.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); } if (e.key === 'Escape') { ta.value = n.p.x; ta.blur(); } };
    ta.onchange = () => { const v = ta.value.trim(); if (v === n.p.x) return; n.p.x = v; LM.trusted.add(v); LM.commit('Edit Expression'); };
    ta.onpointerdown = e => e.stopPropagation();
    const err = left.querySelector('.xerr');
    const up = () => { const e = LM.exprBlocked(n.p) ? 'Disabled until you allow expressions from this file (Edit › Enable Expressions…)' : LM.exprError(n.p); err.textContent = e ? '⚠' : ''; err.title = e || ''; r.classList.toggle('bad', !!e); };
    updaters.push(up); up();
    if (blocked) ta.title = 'This expression came from an opened file and is not running yet.';
    track.appendChild(ta);
    r.append(left, track); return r;
  }
  function layoutTracks() {
    rowsEl.querySelectorAll('.tl-row.layer').forEach(r => r._layout && r._layout());
    kfEls.forEach(({ el: d, L, k }) => { d.style.left = (TL.x(k.t + L.start) - 6) + 'px'; });
  }
  TL.layoutTracks = layoutTracks;
  function markKeys() { kfEls.forEach(({ el: d, k }) => { d.classList.toggle('sel', st.selKeys.has(k)); d.className = d.className.replace(/\b(hold|ease|lin)\b/, kfClass(k)); }); LM.requestRender(); LM.graph?.draw(); }
  TL.markKeys = markKeys;

  /* ---------- interactions ---------- */
  function layerLeftDown(e, L, row) {
    if (e.button !== 0) return;
    if (e.ctrlKey) LM.select(st.sel.includes(L.id) ? st.sel.filter(i => i !== L.id) : [...st.sel, L.id]);
    else if (e.shiftKey && st.sel.length) { const c = LM.comp(), a = c.layers.findIndex(l => l.id === st.sel[0]), b = c.layers.indexOf(L); LM.select(c.layers.slice(Math.min(a, b), Math.max(a, b) + 1).map(l => l.id)); }
    else if (!st.sel.includes(L.id)) LM.select([L.id]);
    // drag to reorder
    const y0 = e.clientY; let moving = false, line = null, target = -1;
    const mv = ev => {
      if (!moving && Math.abs(ev.clientY - y0) < 6) return; moving = true;
      if (!line) { line = el('div', 'tl-dropline'); rowsEl.appendChild(line); }
      const rows = [...rowsEl.querySelectorAll('.tl-row.layer')]; let idx = rows.length, yy = 0;
      for (let i = 0; i < rows.length; i++) { const rr = rows[i].getBoundingClientRect(); if (ev.clientY < rr.top + rr.height / 2) { idx = i; yy = rows[i].offsetTop; break; } }
      if (idx === rows.length) { const last = rows[rows.length - 1]; let n = last; while (n.nextElementSibling && !n.nextElementSibling.classList.contains('layer') && !n.nextElementSibling.classList.contains('tl-dropline')) n = n.nextElementSibling; yy = n.offsetTop + n.offsetHeight; }
      line.style.top = yy + 'px'; target = idx;
    };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); line?.remove();
      if (moving && target >= 0) { const c = LM.comp(), from = c.layers.indexOf(L); LM.reorderLayer(L, target > from ? target - 1 : target); }
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  function barDown(e, L, bar) {
    if (e.button !== 0) return; e.stopPropagation();
    if (!st.sel.includes(L.id)) LM.select([L.id], e.shiftKey || e.ctrlKey);
    if (L.locked) return;
    const c = LM.comp(), r = bar.getBoundingClientRect(), x0 = e.clientX;
    const mode = e.clientX - r.left < 6 ? 'in' : r.right - e.clientX < 6 ? 'out' : 'move';
    const ls = mode === 'move' ? LM.selLayers().filter(l => !l.locked) : [L], orig = ls.map(l => [l.start, l.in, l.out]);
    let moved = false;
    const mv = ev => {
      const dt = LM.snap((ev.clientX - x0) / trackW() * (TL.v1 - TL.v0)); if (!moved && Math.abs(ev.clientX - x0) < 2) return; moved = true;
      ls.forEach((l, i) => { const [s0, i0, o0] = orig[i];
        if (mode === 'move') { l.start = s0 + dt; l.in = i0 + dt; l.out = o0 + dt; }
        else if (mode === 'in') l.in = Math.max(l.type === 'video' || l.type === 'precomp' ? l.start : -1e9, Math.min(o0 - 1 / c.fps, i0 + dt));
        else l.out = Math.max(i0 + 1 / c.fps, o0 + dt);
      });
      layoutTracks(); LM.touch(); LM.status(mode === 'move' ? `In ${LM.fmtTC(ls[0].in, c.fps)}` : mode === 'in' ? `In point ${LM.fmtTC(L.in, c.fps)}` : `Out point ${LM.fmtTC(L.out, c.fps)}`);
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); LM.status(''); if (moved) LM.commit(mode === 'move' ? 'Move Layer in Time' : 'Trim Layer'); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  function keyDown(e, L, k, n) {
    if (e.button !== 0) return; e.stopPropagation();
    if (e.shiftKey || e.ctrlKey) { st.selKeys.has(k) ? st.selKeys.delete(k) : st.selKeys.add(k); }
    else if (!st.selKeys.has(k)) { st.selKeys.clear(); st.selKeys.add(k); }
    if (!st.sel.includes(L.id)) { st.sel = [L.id]; LM.emit('selectQuiet'); }
    st.selProps.clear(); st.selProps.add(selKeyId(L, n));
    markKeys(); LM.emit('selkeys');
    const x0 = e.clientX, refs = LM.selectedKeyRefs().map(r => ({ ...r, t0: r.k.t })); let moved = false;
    const c = LM.comp();
    const mv = ev => {
      if (!moved && Math.abs(ev.clientX - x0) < 3) return; moved = true;
      let dt = LM.snap((ev.clientX - x0) / trackW() * (TL.v1 - TL.v0));
      refs.forEach(r => { r.k.t = Math.round((r.t0 + dt) * c.fps) / c.fps; });
      new Set(refs.map(r => r.n.p)).forEach(p => p.k.sort((a, b) => a.t - b.t));
      layoutTracks(); LM.touch(); LM.status(`Keyframe at ${LM.fmtTC(k.t + L.start, c.fps)}`);
    };
    const up = () => {
      removeEventListener('pointermove', mv); removeEventListener('pointerup', up); LM.status('');
      if (moved) { // drop keyframes that landed on another keyframe of the same property
        new Set(refs.map(r => r.n.p)).forEach(p => { const seen = new Map(); p.k.forEach(q => { const key = Math.round(q.t * c.fps); if (!seen.has(key) || st.selKeys.has(q)) seen.set(key, q); }); p.k = [...seen.values()].sort((a, b) => a.t - b.t); });
        LM.commit('Move Keyframes');
      }
    };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  // marquee selection of keyframes in empty track space
  rowsEl.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.target.classList.contains('tl-track')) return;
    const mr = main.getBoundingClientRect(), x0 = e.clientX, y0 = e.clientY; let moved = false;
    const base = e.shiftKey ? new Set(st.selKeys) : new Set();
    const mv = ev => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 4) return; moved = true;
      const x1 = Math.min(x0, ev.clientX), x2 = Math.max(x0, ev.clientX), y1 = Math.min(y0, ev.clientY), y2 = Math.max(y0, ev.clientY);
      Object.assign(marq.style, { left: x1 - mr.left + 'px', top: y1 - mr.top + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' }); marq.hidden = false;
      st.selKeys = new Set(base);
      kfEls.forEach(({ el: d, k }) => { const r = d.getBoundingClientRect(); if (r.right > x1 && r.left < x2 && r.bottom > y1 && r.top < y2) st.selKeys.add(k); });
      markKeys();
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); marq.hidden = true; if (!moved) { st.selKeys.clear(); markKeys(); } LM.emit('selkeys'); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
  function startWhip(e, L) {
    e.preventDefault(); e.stopPropagation();
    const mr = main.getBoundingClientRect(), r0 = e.target.closest('.pw').getBoundingClientRect(), line = whip.querySelector('line');
    whip.hidden = false; line.setAttribute('x1', r0.left + r0.width / 2 - mr.left); line.setAttribute('y1', r0.top + r0.height / 2 - mr.top);
    const mv = ev => { line.setAttribute('x2', ev.clientX - mr.left); line.setAttribute('y2', ev.clientY - mr.top); rowsEl.querySelectorAll('.whiptarget').forEach(x => x.classList.remove('whiptarget')); const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tl-row.layer'); if (row && row.dataset.id !== L.id) row.classList.add('whiptarget'); };
    mv(e);
    const up = ev => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); whip.hidden = true; rowsEl.querySelectorAll('.whiptarget').forEach(x => x.classList.remove('whiptarget')); const row = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.tl-row.layer'); if (row && row.dataset.id !== L.id) LM.setParent(L, row.dataset.id); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }
  function keyMenu(e) {
    W.menu(e.clientX, e.clientY, ['#Keyframe Interpolation', ['Linear', () => LM.setKeysInterp('linear')], ['Easy Ease', () => LM.setKeysInterp('ease'), { key: 'F9' }], ['Easy Ease In', () => LM.setKeysInterp('easeIn'), { key: 'Shift+F9' }], ['Easy Ease Out', () => LM.setKeysInterp('easeOut'), { key: 'Ctrl+Shift+F9' }], ['Bezier (edit in Graph Editor)', () => LM.setKeysInterp('bezier')], ['Toggle Hold Keyframe', () => LM.toggleHold(), { key: 'Ctrl+Alt+H' }], '-',
      ['Copy', () => LM.copyKeys(), { key: 'Ctrl+C' }], ['Delete', () => LM.deleteSelectedKeys(), { key: 'Delete' }], ['Keyframe Velocity…', () => LM.keyVelocityDialog()], '-', ['Auto-Bezier Motion Path', () => LM.autoBezierPath(), { disabled: !LM.selectedKeyRefs().some(r => r.n.id === 'tr.position') }]]);
  }
  function propMenu(e, L, n) {
    W.menu(e.clientX, e.clientY, [`#${n.label}`, [LM.animated(n.p) ? 'Remove All Keyframes' : 'Add Keyframe', () => { LM.toggleStopwatch(n.p, st.time); LM.commit('Stopwatch'); }], [n.p.x != null ? 'Remove Expression' : 'Add Expression', () => { if (n.p.x != null) { delete n.p.x; LM.commit('Remove Expression'); } else LM.addExpression(L, n); }, { disabled: n.type === 'path' || n.type === 'drawing' }],
      ['Select All Keyframes', () => { st.selKeys.clear(); (n.p.k || []).forEach(k => st.selKeys.add(k)); markKeys(); }, { disabled: !LM.animated(n.p) }], ['Paste Keyframes Here', () => { st.selProps.clear(); st.selProps.add(selKeyId(L, n)); LM.pasteKeys(); }, { disabled: !LM.hasKeyClip() }]]);
  }
  LM.addExpression = (L, n) => {
    const def = n.type === 'vec2' || n.type === 'vec2pct' ? 'wiggle(2, 30)' : n.type === 'angle' ? 'time * 90' : n.type === 'color' ? '' : 'wiggle(2, 10)';
    if (n.type === 'color') return Aero.toast('Expressions work on numeric properties');
    n.p.x = def; LM.trusted.add(def); L.expanded = true; LM.commit('Add Expression');
  };
  LM.addAnimator = L => { const A = LM.factory.animator('Animator ' + (L.text.animators.length + 1)); A.opacity.v = 0; L.text.animators.push(A); L.expanded = true; LM.ui.open.add(L.id + '|text'); LM.ui.open.add(L.id + '|anim.' + A.id); LM.ui.open.add(L.id + '|anim.' + A.id + '.sel'); LM.commit('Add Text Animator'); };

  /* ---------- wheel: zoom/scroll time ---------- */
  main.addEventListener('wheel', e => {
    const r = ruler.getBoundingClientRect(); if (e.clientX < r.left) return;
    if (e.ctrlKey || e.altKey) { e.preventDefault(); zoomIn.value = Math.max(0, Math.min(100, +zoomIn.value - Math.sign(e.deltaY) * 6)); applyZoom(); return; }
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { e.preventDefault(); const c = LM.comp(), span = TL.v1 - TL.v0, d = (e.shiftKey ? e.deltaY : e.deltaX) / trackW() * span; TL.v0 = Math.max(0, Math.min(c.duration - span, TL.v0 + d)); TL.v1 = TL.v0 + span; layoutTracks(); drawRuler(); updateCTI(); LM.graph?.draw(); }
  }, { passive: false });

  /* ---------- splitter ---------- */
  const work = $('#work'), split = $('#splitter');
  let tlH = 300, userSized = false; work.style.setProperty('--tlh', tlH + 'px');
  new ResizeObserver(() => { if (userSized) return; tlH = Math.max(220, Math.round(work.clientHeight * .47)); work.style.setProperty('--tlh', tlH + 'px'); }).observe(work);
  split.onpointerdown = e => {
    try { split.setPointerCapture(e.pointerId); } catch (_) { } const y0 = e.clientY, h0 = tlH;
    split.onpointermove = ev => { userSized = true; tlH = Math.max(120, Math.min(work.clientHeight - 160, h0 - (ev.clientY - y0))); work.style.setProperty('--tlh', tlH + 'px'); };
    split.onpointerup = () => { split.onpointermove = null; };
  };
  new ResizeObserver(() => { layoutTracks(); drawRuler(); updateCTI(); LM.graph?.resize(); }).observe(main);

  /* ---------- events ---------- */
  LM.on('structure', rebuild);
  LM.on('select', rebuild);
  LM.on('time', () => { updateCTI(); if (st.playing) follow(); updaters.forEach(f => f()); if (TL.graph) LM.graph?.drawCTI?.(); });
  LM.on('values', () => updaters.forEach(f => f()));
  LM.on('change', () => { syncHead(); });
})();
