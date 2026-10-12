'use strict';
/* Lumen Cut — Effect Controls panel: motion, opacity + blend mode, crop, speed (ramps / holds), Ultra Key,
   Lumetri Color (basic, creative LUT, curves, colour wheels, vignette), blur, volume/fades, audio effects
   (EQ, compressor, noise gate, reverb), titles, keyframes (stopwatch / add-remove / prev-next / easing) and transitions. */
(function () {
  const $ = Aero.$, esc = Aero.esc;
  const props = LC.props = {};
  const V = ['video', 'image', 'title', 'nvideo'], VA = ['video', 'image', 'title', 'adjust', 'nvideo'], AU = ['audio', 'naudio'];
  const pct = (key, label, min, max, extra = {}) => ({ key, label, min, max, step: 1, kf: true, ...extra });
  const SECTIONS = [
    { id: 'motion', name: 'Motion', types: V, pip: true, rows: [
      { key: 'pos', label: 'Position', kind: 'pos', kf: true },
      { key: 'scale', label: 'Scale', min: 0, max: 400, step: .1, unit: '%', kf: true },
      { key: 'rot', label: 'Rotation', min: -360, max: 360, step: .1, unit: '°', kf: true }] },
    { id: 'opacity', name: 'Opacity', types: VA, blend: true, rows: [{ key: 'opacity', label: 'Opacity', min: 0, max: 100, step: .1, unit: '%', kf: true }] },
    { id: 'crop', name: 'Crop', types: ['video', 'image', 'nvideo'], rows: ['Left', 'Top', 'Right', 'Bottom'].map((l, i) => ({ key: 'crop', idx: i, label: l, min: 0, max: 100, step: .1, unit: '%', kf: true })) },
    { id: 'speed', name: 'Speed / Time Remapping', types: ['video', 'audio'], hold: true, rows: [{ key: 'speed', label: 'Speed', min: .1, max: 4, step: .05, unit: '×', kf: true }] },
    { id: 'key', name: 'Ultra Key (Chroma)', types: ['video', 'image', 'nvideo'], obj: 'key', toggle: true, custom: renderKey, rows: [
      { key: 'tol', label: 'Tolerance', min: 0, max: 100, step: 1 }, { key: 'soft', label: 'Softness', min: 0, max: 100, step: 1 },
      { key: 'spill', label: 'Spill supp.', min: 0, max: 100, step: 1 }, { key: 'feather', label: 'Edge feather', min: 0, max: 50, step: .5, unit: 'px' },
      { key: 'choke', label: 'Choke', min: 0, max: 100, step: 1 }] },
    { id: 'lumetri', name: 'Lumetri Color', types: VA, reset: 'lumetri', custom: renderLumetri, rows: [
      '#White Balance', pct('temperature', 'Temperature', -100, 100), pct('tint', 'Tint', -100, 100),
      '#Tone', { key: 'exposure', label: 'Exposure', min: -3, max: 3, step: .01, unit: 'EV', kf: true }, pct('contrast', 'Contrast', -100, 100),
      pct('highlights', 'Highlights', -100, 100), pct('shadows', 'Shadows', -100, 100), pct('whites', 'Whites', -100, 100), pct('blacks', 'Blacks', -100, 100), pct('brightness', 'Brightness', -100, 100),
      '#Color', pct('saturation', 'Saturation', 0, 200, { unit: '%' }), pct('vibrance', 'Vibrance', -100, 100),
      '#Vignette', pct('vignette', 'Amount', -100, 100)] },
    { id: 'blur', name: 'Gaussian Blur', types: VA, rows: [{ key: 'blur', label: 'Blurriness', min: 0, max: 100, step: .5, unit: 'px', kf: true }] },
    { id: 'audio', name: 'Volume', types: AU, rows: [
      { key: 'volume', label: 'Level', min: -60, max: 12, step: .1, unit: 'dB', kf: true },
      { key: 'fadeIn', label: 'Fade in', min: 0, max: 10, step: .05, unit: 's' },
      { key: 'fadeOut', label: 'Fade out', min: 0, max: 10, step: .05, unit: 's' }] },
    { id: 'eq', name: 'EQ (3-band)', types: AU, obj: 'afx.eq', toggle: true, audio: true, rows: [
      { key: 'low', label: 'Low (200 Hz)', min: -24, max: 24, step: .5, unit: 'dB' }, { key: 'mid', label: 'Mid gain', min: -24, max: 24, step: .5, unit: 'dB' },
      { key: 'midF', label: 'Mid freq', min: 80, max: 12000, step: 10, unit: 'Hz' }, { key: 'high', label: 'High (4 kHz)', min: -24, max: 24, step: .5, unit: 'dB' }] },
    { id: 'comp', name: 'Compressor', types: AU, obj: 'afx.comp', toggle: true, audio: true, rows: [
      { key: 'thr', label: 'Threshold', min: -60, max: 0, step: .5, unit: 'dB' }, { key: 'ratio', label: 'Ratio', min: 1, max: 20, step: .1, unit: ':1' },
      { key: 'att', label: 'Attack', min: 0, max: 1000, step: 1, unit: 'ms' }, { key: 'rel', label: 'Release', min: 10, max: 1000, step: 1, unit: 'ms' }, { key: 'gain', label: 'Makeup', min: 0, max: 24, step: .5, unit: 'dB' }] },
    { id: 'gate', name: 'Noise Gate', types: AU, obj: 'afx.gate', toggle: true, audio: true, rows: [
      { key: 'thr', label: 'Threshold', min: -90, max: 0, step: .5, unit: 'dB' }, { key: 'att', label: 'Attack', min: .1, max: 200, step: .1, unit: 'ms' }, { key: 'rel', label: 'Release', min: 5, max: 2000, step: 1, unit: 'ms' }] },
    { id: 'verb', name: 'Reverb', types: AU, obj: 'afx.verb', toggle: true, audio: true, rows: [
      { key: 'mix', label: 'Mix', min: 0, max: 100, step: 1, unit: '%' }, { key: 'size', label: 'Room size', min: .2, max: 6, step: .1, unit: 's' }] }
  ];
  const collapsed = new Set(['curves', 'wheels']);
  let refs = [];       // live rows for in-place updates

  const ic = {
    watch: '<svg viewBox="0 0 16 16"><circle cx="8" cy="9" r="5.5" fill="#fff" stroke="currentColor" stroke-width="1.3"/><path d="M8 9V6M6.5 1.8h3M12 4.5l1-1" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>',
    prev: '<svg viewBox="0 0 10 10"><path d="M7 1.5 2.5 5 7 8.5z" fill="currentColor"/></svg>',
    next: '<svg viewBox="0 0 10 10"><path d="M3 1.5 7.5 5 3 8.5z" fill="currentColor"/></svg>',
    dia: '<svg viewBox="0 0 10 10"><path d="M5 1 9 5 5 9 1 5z" fill="currentColor" stroke="#334" stroke-width=".8"/></svg>',
    drop: '<svg viewBox="0 0 16 16"><path d="M10.5 2.5l3 3-1.5 1.5-3-3z" fill="#5b6b7c"/><path d="M9.5 5.5 3 12v1.5h1.5L11 7" fill="none" stroke="#1d4f8a" stroke-width="1.4"/></svg>'
  };
  const localT = c => Math.min(Math.max(LC.playhead - c.start, 0), c.dur);
  const fmt = (v, r) => r.kind === 'pos' ? '' : (+v).toFixed(r.step < .1 ? 2 : r.step < 1 ? 1 : 0);
  const objOf = (c, path, create) => { let o = c; for (const k of path.split('.')) { if (!o[k]) { if (!create) return null; o[k] = k === 'key' ? LC.defaultKey() : k === 'afx' ? LC.defaultAfx() : {}; } o = o[k]; } return o; };

  /* keep linked clips' time remapping identical so picture and sound stay in sync */
  function syncSpeedKeys(c) {
    for (const x of LC.linked(c)) {
      if (!LC.isTimeBased(x) || Math.abs(x.start - c.start) > 1e-4 || Math.abs(x.dur - c.dur) > 1e-4) continue;
      x.kf = x.kf || {}; if (c.kf?.speed) x.kf.speed = JSON.parse(JSON.stringify(c.kf.speed)); else { delete x.kf.speed; x.props.speed = c.props.speed; }
    }
  }
  /* Set a parameter honouring keyframes; commit=true records an undo step */
  LC.setParam = (c, key, v, commit = true, idx) => {
    const tl = localT(c);
    if (key === 'crop') { if (LC.isAnimated(c, 'crop')) { const cur = LC.valueAt(c, 'crop', tl).slice(); cur[idx] = v; LC.setKey(c, 'crop', tl, cur); } else c.props.crop[idx] = v; }
    else if (key === 'speed' && !LC.isAnimated(c, 'speed')) return LC.setSpeed(c, v, commit);
    else if (LC.isAnimated(c, key)) { LC.setKey(c, key, tl, v); if (key === 'speed') syncSpeedKeys(c); }
    else c.props[key] = v;
    LC.requestRender(); LC.tl.draw(); props.update();
    if (commit) { LC.commit(`Change ${key}`); if (LC.playing && (key === 'speed' || key === 'volume')) LC.restartPlayback(); }
  };
  LC.setSpeed = (c, s, commit = true) => {
    s = Math.max(.1, Math.min(10, s));
    const group = [c, ...LC.linked(c)].filter(x => LC.isTimeBased(x));
    for (const x of group) {
      const animated = LC.isAnimated(x, 'speed'), old = animated ? LC.avgSpeed(x) : x.props.speed; if (!animated && Math.abs(old - s) < 1e-6) continue;
      if (animated) delete x.kf.speed;
      const m = LC.mediaOf(x); let dur = LC.fr(x.dur * old / s);
      if (m) dur = Math.min(dur, (m.duration - x.in) / s);
      const next = LC.clipsOn(x.track).find(o => o.start >= x.start + x.dur - 1e-6 && o.id !== x.id);
      if (next) dur = Math.min(dur, next.start - x.start);
      for (const k of Object.keys(x.kf || {})) x.kf[k].forEach(q => q.t = q.t * old / s);
      x.props.speed = s; x.dur = Math.max(1 / LC.fps(), LC.fr(dur));
    }
    LC.cleanTransitions(); LC.requestRender(); LC.tl.draw(); props.update();
    if (commit) LC.commit('Change speed');
  };

  props.focus = () => { $('#props').scrollTop = 0; props.render(); };
  props.render = () => {
    const box = $('#props'); if (!box || !LC.project) return; refs = []; wheelDraws.length = 0;
    const keepScroll = box.scrollTop; box.innerHTML = '';
    const tr = LC.tl.selTr && LC.project.transitions.find(t => t.id === LC.tl.selTr);
    const c = LC.tl.primary();
    if (LC.mon.matteId?.() && (!c || c.id !== LC.mon.matteId())) LC.mon.setMatte(null);
    if (tr) return renderTransition(box, tr);
    if (!c) return renderSequence(box);
    // header
    const hd = Aero.el('div', 'phead');
    const kind = LC.clipKind(c), kindName = { video: 'Video clip', audio: 'Audio clip', image: 'Still image', title: 'Title', adjust: 'Adjustment layer', nvideo: 'Nested sequence (video)', naudio: 'Nested sequence (audio)' }[kind];
    hd.innerHTML = `<div class="pname"><span class="pchip ${c.type}"></span><span class="grow"></span></div><div class="ptimes"><label>Start <input type="text" class="mono" data-f="start"></label><label>Duration <input type="text" class="mono" data-f="dur"></label></div>` +
      (LC.tl.sel.size > 1 ? `<div class="dim" style="margin-top:4px">${LC.tl.sel.size} clips selected — editing ${esc(kindName.toLowerCase())}</div>` : `<div class="dim" style="margin-top:4px">${esc(kindName)}${LC.mediaOf(c) ? ' · ' + esc(LC.mediaOf(c).name) : ''}${c.link ? ' · linked' : ''}${c.disabled ? ' · disabled' : ''}${c.hold != null ? ' · frame hold' : ''}</div>`);
    hd.querySelector('.grow').textContent = LC.clipName(c);
    const fs = hd.querySelector('[data-f=start]'), fd = hd.querySelector('[data-f=dur]');
    fs.value = LC.tc(c.start); fd.value = LC.tc(c.dur);
    fs.onchange = () => { const t = LC.parseTC(fs.value); if (t == null) return props.render(); const d = LC.fr(Math.max(0, t)) - c.start; const grp = [c, ...LC.linked(c)]; const ids = new Set(grp.map(x => x.id)); grp.forEach(x => { x.start = LC.fr(x.start + d); }); grp.forEach(x => LC.overwriteRange(x.track, x.start, x.start + x.dur, ids)); LC.cleanTransitions(); LC.commit('Move clip'); LC.refresh(); };
    fd.onchange = () => { const t = LC.parseTC(fd.value); if (t == null) return props.render(); const grp = [c, ...LC.linked(c)]; grp.forEach(x => { const next = LC.clipsOn(x.track).find(o => o.start >= x.start + x.dur - 1e-6 && o.id !== x.id); let d = Math.min(LC.fr(Math.max(1 / LC.fps(), t)), LC.maxDur(x)); if (next && d > next.start - x.start) d = next.start - x.start; x.dur = d; }); LC.cleanTransitions(); LC.commit('Change duration'); LC.refresh(); };
    if (c.type === 'nest') { const b = Aero.el('button', 'aero-btn small', 'Open Nested Sequence'); b.style.marginTop = '6px'; b.onclick = () => LC.openNest(c); hd.appendChild(b); }
    box.appendChild(hd);
    if (c.type === 'title') renderTitle(box, c);
    for (const S of SECTIONS) {
      if (!S.types.includes(kind)) continue;
      const o = S.obj ? objOf(c, S.obj, false) : null, on = S.toggle ? !!o?.on : true;
      const closed = collapsed.has(S.id) || (S.toggle && !on && !opened.has(S.id));
      const sec = Aero.el('div', 'psec' + (closed ? ' closed' : '') + (S.toggle && !on ? ' off' : ''));
      sec.innerHTML = `<div class="psh"><span class="tw"></span>${S.toggle ? `<input type="checkbox" class="fxon" title="Enable ${esc(S.name)}"${on ? ' checked' : ''}>` : ''}<span class="grow">${esc(S.name)}</span>${S.pip ? '<select class="pipsel" title="Picture-in-picture presets"><option value="">Preset…</option><option value="tl">PiP top left</option><option value="tr">PiP top right</option><option value="bl">PiP bottom left</option><option value="br">PiP bottom right</option><option value="center">PiP center</option><option value="full">Full frame</option><option value="fill">Fill frame (crop)</option></select>' : ''}${S.reset ? '<button class="aero-btn small" data-reset>Reset</button>' : ''}</div><div class="psb"></div>`;
      sec.querySelector('.psh').onclick = e => {
        if (e.target.closest('button,select,input')) return;
        const isClosed = sec.classList.toggle('closed');
        if (isClosed) { collapsed.add(S.id); opened.delete(S.id); } else { collapsed.delete(S.id); opened.add(S.id); }
      };
      if (S.toggle) sec.querySelector('.fxon').onchange = e => { const ob = objOf(c, S.obj, true); ob.on = e.target.checked; if (ob.on) { opened.add(S.id); collapsed.delete(S.id); } LC.commit((ob.on ? 'Enable ' : 'Disable ') + S.name); LC.refresh(); if (S.audio && LC.playing) LC.restartPlayback(); };
      if (S.pip) sec.querySelector('.pipsel').onchange = e => { if (e.target.value) LC.pip(e.target.value, c); };
      if (S.reset) sec.querySelector('[data-reset]').onclick = () => { LC.resetLumetri(c); LC.commit('Reset ' + S.name); LC.refresh(); };
      const body = sec.querySelector('.psb');
      if (S.custom && S.id === 'key') S.custom(body, c);
      for (const r of S.rows) {
        if (typeof r === 'string') { body.appendChild(Aero.el('div', 'psub', esc(r.slice(1)))); continue; }
        body.appendChild(paramRow(c, r, S));
      }
      if (S.blend) body.appendChild(blendRow(c));
      if (S.hold && c.hold != null) { const d = Aero.el('div', 'prow2', `<span class="dim">Frame hold at source ${LC.tc(c.hold)}</span><button class="aero-btn small">Remove Hold</button>`); d.querySelector('button').onclick = () => { delete c.hold; LC.commit('Remove frame hold'); LC.refresh(); }; body.appendChild(d); }
      if (S.custom && S.id !== 'key') S.custom(body, c);
      box.appendChild(sec);
    }
    box.scrollTop = keepScroll;
    props.update();
  };
  const opened = new Set();
  LC.resetLumetri = c => {
    const d = LC.defaultProps(); LC.COLOR_KEYS.forEach(k => { c.props[k] = d[k]; if (c.kf) delete c.kf[k]; });
    c.props.wS = [0, 0, 0]; c.props.wM = [0, 0, 0]; c.props.wH = [0, 0, 0]; c.props.curveAmt = 100; ['wS', 'wM', 'wH', 'curveAmt'].forEach(k => { if (c.kf) delete c.kf[k]; }); delete c.curves; delete c.lut;
  };
  function blendRow(c) {
    const row = Aero.el('div', 'prow');
    row.innerHTML = `<span class="kfw ph"></span><label>Blend mode</label><select class="blendsel">${LC.BLEND_MODES.map(([v, n]) => `<option value="${v}"${(c.props.blend || 'normal') === v ? ' selected' : ''}>${n}</option>`).join('')}</select>`;
    row.querySelector('select').onchange = e => { c.props.blend = e.target.value; LC.commit('Blend mode'); LC.requestRender(); LC.tl.draw(); };
    return row;
  }
  function paramRow(c, r, S = {}) {
    const row = Aero.el('div', 'prow');
    const kfHtml = r.kf ? `<button class="kfw" title="Toggle animation (keyframes)">${ic.watch}</button>` : '<span class="kfw ph"></span>';
    const nav = r.kf ? `<span class="kfnav"><button data-k="p" title="Previous keyframe">${ic.prev}</button><button data-k="a" class="dia" title="Add/remove keyframe · right-click: interpolation">${ic.dia}</button><button data-k="n" title="Next keyframe">${ic.next}</button></span>` : '<span class="kfnav"></span>';
    if (r.kind === 'pos') {
      row.innerHTML = `${kfHtml}<label>${r.label}</label><span class="pxy"><input type="number" step="1" data-i="0"><input type="number" step="1" data-i="1"></span>${nav}`;
      const PS = LC.project.settings, ins = row.querySelectorAll('input');
      ins.forEach(inp => {
        inp.addEventListener('input', () => { const v = LC.valueAt(c, 'pos', localT(c)).slice(); const i = +inp.dataset.i; v[i] = (+inp.value) / (i ? PS.h : PS.w); LC.setParam(c, 'pos', v, false); });
        inp.addEventListener('change', () => LC.commit('Change position'));
      });
      refs.push({ c, r, set: () => { const v = LC.valueAt(c, 'pos', localT(c)); ins.forEach((inp, i) => { if (document.activeElement !== inp) inp.value = Math.round(v[i] * (i ? PS.h : PS.w)); }); }, row });
    } else {
      row.innerHTML = `${kfHtml}<label title="${esc(r.label)}">${r.label}</label><input type="range" min="${r.min}" max="${r.max}" step="${r.step}"><span class="pnum"><input type="number" min="${r.min}" max="${r.max}" step="${r.step}"><i>${r.unit || ''}</i></span>${nav}`;
      const rg = row.querySelector('input[type=range]'), nm = row.querySelector('input[type=number]');
      const ob = () => S.obj ? objOf(c, S.obj, true) : null;
      const defs = () => objOf({ key: LC.defaultKey(), afx: LC.defaultAfx() }, S.obj, false);
      const get = () => S.obj ? (objOf(c, S.obj, false) || defs())[r.key]
        : r.key === 'crop' ? LC.valueAt(c, 'crop', localT(c))[r.idx] : LC.valueAt(c, r.key, localT(c));
      const apply = (v, commit) => {
        v = Math.max(r.min, Math.min(r.max, v)); if (isNaN(v)) return;
        if (S.obj) { ob()[r.key] = v; LC.requestRender(); LC.tl.draw(); if (commit) { LC.commit('Change ' + r.label.toLowerCase()); if (S.audio && LC.playing) LC.restartPlayback(); } return; }
        LC.setParam(c, r.key, v, commit, r.idx);
      };
      rg.addEventListener('input', () => { nm.value = fmt(rg.value, r); apply(+rg.value, false); });
      rg.addEventListener('change', () => { if (r.key === 'speed' && !LC.isAnimated(c, 'speed')) LC.setSpeed(c, +rg.value, true); else { LC.commit('Change ' + r.label.toLowerCase()); if (S.audio && LC.playing) LC.restartPlayback(); } });
      nm.addEventListener('change', () => apply(+nm.value, true));
      rg.addEventListener('dblclick', () => { const d = S.obj ? defs() : LC.defaultProps(); apply(r.key === 'crop' ? 0 : d[r.key], true); });
      refs.push({ c, r, set: () => { const v = get(); if (document.activeElement !== rg) rg.value = v; if (document.activeElement !== nm) nm.value = fmt(v, r); }, row });
    }
    if (r.kf) {
      row.querySelector('.kfw').onclick = () => {
        if (LC.isAnimated(c, r.key)) { const v = LC.valueAt(c, r.key, localT(c)); delete c.kf[r.key]; c.props[r.key] = JSON.parse(JSON.stringify(v)); if (r.key === 'speed') syncSpeedKeys(c); LC.commit('Remove keyframes'); }
        else { LC.setKey(c, r.key, localT(c), JSON.parse(JSON.stringify(c.props[r.key]))); if (r.key === 'speed') syncSpeedKeys(c); LC.commit('Add keyframe'); }
        LC.refresh();
      };
      const dia = row.querySelector('[data-k=a]');
      dia.onclick = () => {
        const tl = localT(c), k = c.kf?.[r.key]?.find(q => Math.abs(q.t - tl) < .5 / LC.fps());
        if (k) LC.removeKey(c, r.key, tl); else LC.setKey(c, r.key, tl, JSON.parse(JSON.stringify(LC.valueAt(c, r.key, tl))));
        if (r.key === 'speed') syncSpeedKeys(c);
        LC.commit(k ? 'Remove keyframe' : 'Add keyframe'); LC.refresh();
      };
      dia.oncontextmenu = e => {
        e.preventDefault(); const tl = localT(c), k = c.kf?.[r.key]?.find(q => Math.abs(q.t - tl) < .5 / LC.fps());
        if (!k) return Aero.toast('Move the playhead onto a keyframe to change its interpolation');
        LC.tl.easeMenu(e, [k], 'Keyframe', () => { LC.removeKey(c, r.key, tl); LC.commit('Remove keyframe'); LC.refresh(); });
      };
      const go = dir => { const ks = (c.kf?.[r.key] || []).map(q => q.t), tl = LC.playhead - c.start; const t = dir > 0 ? ks.find(x => x > tl + 1e-4) : ks.slice().reverse().find(x => x < tl - 1e-4); if (t != null) LC.setPlayhead(LC.fr(c.start + t)); };
      row.querySelector('[data-k=p]').onclick = () => go(-1); row.querySelector('[data-k=n]').onclick = () => go(1);
    }
    return row;
  }
  props.update = () => {
    for (const ref of refs) {
      ref.set();
      if (ref.r.kf) {
        const anim = LC.isAnimated(ref.c, ref.r.key), tl = LC.playhead - ref.c.start;
        ref.row.querySelector('.kfw').classList.toggle('on', anim);
        ref.row.querySelector('.kfnav').classList.toggle('show', anim);
        const onKey = anim && ref.c.kf[ref.r.key].some(q => Math.abs(q.t - tl) < .5 / LC.fps());
        ref.row.querySelector('.dia').classList.toggle('on', onKey);
      }
    }
  };
  props.syncTime = () => { props.update(); wheelDraws.forEach(d => d()); };

  /* ---------- Ultra Key: colour + eyedropper + matte view ---------- */
  function renderKey(body, c) {
    const k = c.key || LC.defaultKey();
    const d = Aero.el('div', 'prow keyrow', `<span class="kfw ph"></span><label>Key color</label><span class="keyc"><input type="color" class="kcol"><button class="aero-btn small kpick" title="Eyedropper: click the background in the Program monitor">${ic.drop} Pick</button></span>`);
    const col = d.querySelector('.kcol'); col.value = k.color;
    col.onchange = () => { objOf(c, 'key', true).color = col.value; c.key.on = true; LC.commit('Key color'); LC.refresh(); };
    d.querySelector('.kpick').onclick = async () => {
      if (LC.playhead < c.start || LC.playhead >= c.start + c.dur) return Aero.toast('Move the playhead over this clip first');
      const hex = await LC.mon.pickKey(c); if (!hex) return;
      const kk = objOf(c, 'key', true); kk.color = hex; kk.on = true; opened.add('key'); LC.commit('Pick key color'); LC.refresh(); Aero.toast('Key color ' + hex);
    };
    body.appendChild(d);
    const m = Aero.el('div', 'prow2', `<label><input type="checkbox" class="kmatte"> Show matte (Program monitor only)</label>`);
    const cb = m.querySelector('input'); cb.checked = LC.mon.matteId?.() === c.id; cb.onchange = () => LC.mon.setMatte(cb.checked ? c.id : null);
    body.appendChild(m);
  }

  /* ---------- Lumetri: creative (LUT), curves, colour wheels ---------- */
  function renderLumetri(body, c) {
    // creative LUT
    const P = LC.project, cr = Aero.el('div', 'lumcreative');
    cr.innerHTML = `<div class="psub">Creative LUT</div><div class="prow"><span class="kfw ph"></span><label>Look</label><select class="lutsel"><option value="">None</option>${P.luts.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}<option value="__import">Import .cube…</option></select></div>
      <div class="prow"><span class="kfw ph"></span><label>Intensity</label><input type="range" min="0" max="100" step="1" class="lutamt"><span class="pnum"><input type="number" min="0" max="100" class="lutamtn"><i>%</i></span></div>`;
    const sel = cr.querySelector('.lutsel'), amt = cr.querySelector('.lutamt'), amtn = cr.querySelector('.lutamtn');
    sel.value = c.lut?.id || ''; amt.value = amtn.value = c.lut?.amt ?? 100; amt.disabled = amtn.disabled = !c.lut;
    sel.onchange = async () => {
      if (sel.value === '__import') { const l = await LC.importLut(); if (l) c.lut = { id: l.id, amt: 100 }; else { sel.value = c.lut?.id || ''; return; } }
      else if (sel.value) c.lut = { id: sel.value, amt: c.lut?.amt ?? 100 }; else delete c.lut;
      LC.commit('Creative LUT'); LC.refresh();
    };
    const setAmt = (v, commit) => { if (!c.lut) return; c.lut.amt = Math.max(0, Math.min(100, +v)); amt.value = amtn.value = c.lut.amt; LC.requestRender(); if (commit) LC.commit('LUT intensity'); };
    amt.oninput = () => setAmt(amt.value, false); amt.onchange = () => setAmt(amt.value, true); amtn.onchange = () => setAmt(amtn.value, true);
    body.appendChild(cr);
    // curves
    body.appendChild(subPanel('curves', 'RGB Curves', el => { LC.curvesEditor(el, c); el.appendChild(paramRow(c, { key: 'curveAmt', label: 'Intensity', min: 0, max: 100, step: 1, unit: '%', kf: true })); }));
    body.appendChild(subPanel('wheels', 'Color Wheels (shadows · midtones · highlights)', el => LC.wheelsEditor(el, c)));
  }
  function subPanel(id, title, build) {
    const d = Aero.el('div', 'subp' + (collapsed.has(id) ? ' closed' : ''), `<div class="subh"><span class="tw"></span>${esc(title)}</div><div class="subb"></div>`);
    d.querySelector('.subh').onclick = () => { d.classList.toggle('closed') ? collapsed.add(id) : collapsed.delete(id); };
    build(d.querySelector('.subb')); return d;
  }
  LC.importLut = async () => {
    const [f] = await Aero.openFile({ accept: '.cube', filters: [{ name: 'Cube LUT', extensions: ['cube'] }] });
    if (!f) return null;
    let parsed;
    try { if (f.data.byteLength > 60e6) throw new Error('File is too large'); parsed = LC.parseCube(new TextDecoder().decode(f.data)); }
    catch (e) { Aero.alert('Import LUT', `“${f.name}” is not a valid .cube LUT: ${e.message}`); return null; }
    const lut = LC.lutToProject(parsed, Aero.baseName(f.name));
    LC.project.luts.push(lut); Aero.toast(`Imported LUT ${lut.name} (${parsed.source}, ${parsed.size}³)`);
    return lut;
  };
  LC.addLutText = (text, name) => { const parsed = LC.parseCube(text); const lut = LC.lutToProject(parsed, name); LC.project.luts.push(lut); return lut; };

  /* curves editor: channel tabs, click to add, drag to move, double-click/right-click to remove */
  LC.curvesEditor = (el, c) => {
    const CH = [['rgb', 'Master', '#333'], ['r', 'Red', '#d03a2a'], ['g', 'Green', '#2a9a3a'], ['b', 'Blue', '#2a6ad0']];
    let ch = 'rgb';
    el.innerHTML = `<div class="cvtabs">${CH.map(([k, n, col]) => `<span class="cvtab" data-c="${k}" style="--c:${col}">${n}</span>`).join('')}<button class="aero-btn small cvreset">Reset</button></div><canvas class="cvcan" width="252" height="180"></canvas><div class="dim cvhint">Click to add a point · drag · double-click removes</div>`;
    const can = el.querySelector('canvas'), x = can.getContext('2d');
    const cur = () => (c.curves || LC.defaultCurves())[ch];
    const draw = () => {
      const W = can.width, H = can.height; x.clearRect(0, 0, W, H); x.fillStyle = '#1e2730'; x.fillRect(0, 0, W, H);
      x.strokeStyle = 'rgba(255,255,255,.12)'; x.lineWidth = 1; for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(W * i / 4 + .5, 0); x.lineTo(W * i / 4 + .5, H); x.moveTo(0, H * i / 4 + .5); x.lineTo(W, H * i / 4 + .5); x.stroke(); }
      x.strokeStyle = 'rgba(255,255,255,.25)'; x.beginPath(); x.moveTo(0, H); x.lineTo(W, 0); x.stroke();
      const order = CH.filter(q => q[0] !== ch).concat(CH.filter(q => q[0] === ch));
      for (const [k, , col] of order) {
        const pts = (c.curves || LC.defaultCurves())[k], T = LC.curveTable(pts, W);
        x.strokeStyle = k === ch ? (k === 'rgb' ? '#ffffff' : col) : 'rgba(255,255,255,.18)'; x.lineWidth = k === ch ? 2 : 1;
        x.beginPath(); for (let i = 0; i < W; i++) { const yy = H - T[i] * H; i ? x.lineTo(i, yy) : x.moveTo(i, yy); } x.stroke();
      }
      for (const [px, py] of cur()) { x.fillStyle = '#fff'; x.strokeStyle = '#000'; x.beginPath(); x.arc(px * W, H - py * H, 4, 0, 7); x.fill(); x.stroke(); }
      el.querySelectorAll('.cvtab').forEach(t => t.classList.toggle('on', t.dataset.c === ch));
    };
    el.querySelector('.cvtabs').onclick = e => { const k = e.target.dataset.c; if (k) { ch = k; draw(); } };
    el.querySelector('.cvreset').onclick = () => { if (!c.curves) return; c.curves[ch] = [[0, 0], [1, 1]]; if (!LC.curvesActive(c.curves)) delete c.curves; LC.commit('Reset curve'); draw(); LC.requestRender(); LC.tl.draw(); };
    const at = e => { const r = can.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height))]; };
    can.onpointerdown = e => {
      if (e.button !== 0) return;
      if (!c.curves) c.curves = LC.defaultCurves();
      const pts = c.curves[ch], [px, py] = at(e), r = can.getBoundingClientRect();
      let i = pts.findIndex(q => Math.hypot((q[0] - px) * r.width, (q[1] - py) * r.height) < 8);
      if (i < 0) { if (pts.length >= 16) return Aero.toast('A curve can have at most 16 points'); pts.push([px, LC.curveTable(pts, 256)[Math.round(px * 255)]]); pts.sort((a, b) => a[0] - b[0]); i = pts.findIndex(q => q[0] === px); }
      const p = pts[i]; can.setPointerCapture(e.pointerId);
      const mv = ev => { const [nx, ny] = at(ev); const lo = i > 0 ? pts[i - 1][0] + .01 : 0, hi = i < pts.length - 1 ? pts[i + 1][0] - .01 : 1; p[0] = i === 0 ? 0 : i === pts.length - 1 ? 1 : Math.min(hi, Math.max(lo, nx)); p[1] = ny; draw(); LC.requestRender(); };
      mv(e);
      can.onpointermove = mv; can.onpointerup = () => { can.onpointermove = null; can.onpointerup = null; LC.commit('Edit curve'); LC.tl.draw(); };
    };
    can.ondblclick = e => {
      if (!c.curves) return; const pts = c.curves[ch], [px, py] = at(e), r = can.getBoundingClientRect();
      const i = pts.findIndex(q => Math.hypot((q[0] - px) * r.width, (q[1] - py) * r.height) < 8);
      if (i > 0 && i < pts.length - 1) { pts.splice(i, 1); if (!LC.curvesActive(c.curves)) delete c.curves; LC.commit('Remove curve point'); draw(); LC.requestRender(); }
    };
    draw();
  };
  /* three colour wheels with a luma slider each */
  const wheelDraws = [];
  LC.wheelsEditor = (el, c) => {
    wheelDraws.length = 0;
    const W = [['wS', 'Shadows'], ['wM', 'Midtones'], ['wH', 'Highlights']];
    el.innerHTML = `<div class="wheels">${W.map(([k, n]) => `<div class="wheel" data-k="${k}"><canvas width="78" height="78"></canvas><input type="range" min="-1" max="1" step=".01" title="${n} brightness"><span><button class="kfw wkf" title="Animate ${n} wheel (keyframes at the playhead)">${ic.watch}</button>${n}</span></div>`).join('')}</div><div class="dim cvhint">Drag the puck to tint · double-click resets · stopwatch animates</div>`;
    const lt = () => Math.min(Math.max(LC.playhead - c.start, 0), c.dur), cur = k => LC.valueAt(c, k, lt()), put = (k, v) => LC.setParam(c, k, v, false);
    el.querySelectorAll('.wheel').forEach(w => {
      const k = w.dataset.k, can = w.querySelector('canvas'), x = can.getContext('2d'), rg = w.querySelector('input');
      const draw = () => {
        const S = can.width, R = S / 2 - 3, v = cur(k); x.clearRect(0, 0, S, S); w.querySelector('.wkf').classList.toggle('on', LC.isAnimated(c, k));
        const g = x.createConicGradient(0, S / 2, S / 2); for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, `hsl(${-i * 60},80%,55%)`);
        x.fillStyle = g; x.beginPath(); x.arc(S / 2, S / 2, R, 0, 7); x.fill();
        const rad = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, R); rad.addColorStop(0, 'rgba(128,128,128,1)'); rad.addColorStop(1, 'rgba(128,128,128,0)'); x.fillStyle = rad; x.fill();
        x.strokeStyle = '#2a3a4a'; x.lineWidth = 1; x.stroke();
        const px = S / 2 + v[0] * R, py = S / 2 - v[1] * R; x.strokeStyle = '#fff'; x.lineWidth = 2; x.beginPath(); x.arc(px, py, 5, 0, 7); x.stroke(); x.strokeStyle = '#000'; x.lineWidth = 1; x.beginPath(); x.arc(px, py, 6.5, 0, 7); x.stroke();
        if (document.activeElement !== rg) rg.value = v[2];
      };
      const at = e => { const r = can.getBoundingClientRect(), R = r.width / 2 - 3; let dx = (e.clientX - r.left - r.width / 2) / R, dy = -(e.clientY - r.top - r.height / 2) / R; const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; } return [+dx.toFixed(3), +dy.toFixed(3)]; };
      can.onpointerdown = e => { can.setPointerCapture(e.pointerId); const mv = ev => { const [dx, dy] = at(ev); put(k, [dx, dy, cur(k)[2]]); draw(); }; mv(e); can.onpointermove = mv; can.onpointerup = () => { can.onpointermove = null; LC.commit('Color wheel'); LC.tl.draw(); }; };
      can.ondblclick = () => { put(k, [0, 0, cur(k)[2]]); draw(); LC.commit('Reset color wheel'); };
      rg.oninput = () => { const v = cur(k); put(k, [v[0], v[1], +rg.value]); };
      rg.onchange = () => LC.commit('Wheel brightness'); rg.ondblclick = () => { const v = cur(k); put(k, [v[0], v[1], 0]); rg.value = 0; LC.commit('Wheel brightness'); };
      w.querySelector('.wkf').onclick = () => { if (LC.isAnimated(c, k)) { const v = cur(k); delete c.kf[k]; c.props[k] = v.slice(); LC.commit('Remove wheel keyframes'); } else { LC.setKey(c, k, lt(), cur(k).slice()); LC.commit('Wheel keyframe'); } draw(); LC.refresh(); };
      wheelDraws.push(draw);
      draw();
    });
  };

  /* ---------- titles ---------- */
  function renderTitle(box, c) {
    const T = c.title, sec = Aero.el('div', 'psec' + (collapsed.has('text') ? ' closed' : ''));
    const fonts = LC.FONTS.map(f => `<option${f === T.font ? ' selected' : ''}>${esc(f)}</option>`).join('');
    const anims = LC.TITLE_ANIMS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
    sec.innerHTML = `<div class="psh"><span class="tw"></span><span class="grow">Text</span></div><div class="psb tform">
      <textarea data-t="text" rows="2" spellcheck="false"></textarea>
      <div class="tr2"><select data-t="font">${fonts}</select><input type="number" data-t="size" min="8" max="600" step="1" title="Font size (px at project resolution)" style="width:60px"></div>
      <div class="tr2"><button class="tog" data-b="bold" title="Bold"><b>B</b></button><button class="tog" data-b="italic" title="Italic"><i>I</i></button><span class="sep2"></span>
        <button class="tog" data-al="left" title="Align left">${alIcon(0)}</button><button class="tog" data-al="center" title="Center">${alIcon(1)}</button><button class="tog" data-al="right" title="Align right">${alIcon(2)}</button><span class="sep2"></span><input type="color" data-t="color" title="Fill color"></div>
      <div class="tr2"><label>Position</label><select data-t="preset"><option value="center">Center</option><option value="lower">Lower third</option><option value="top">Top</option><option value="bottom">Bottom</option><option value="upperleft">Upper left</option><option value="upperright">Upper right</option><option value="custom">Custom (drag in monitor)</option></select></div>
      <div class="tr2"><label><input type="checkbox" data-c="stroke"> Stroke</label><input type="color" data-t="strokeColor"><input type="number" data-t="strokeWidth" min="0" max="60" style="width:52px"></div>
      <div class="tr2"><label><input type="checkbox" data-c="shadow"> Shadow</label><input type="color" data-t="shadowColor"><span class="dim">blur</span><input type="number" data-t="shadowBlur" min="0" max="100" style="width:46px"><span class="dim">dist</span><input type="number" data-t="shadowDist" min="0" max="100" style="width:46px"></div>
      <div class="tr2"><label><input type="checkbox" data-c="box"> Background</label><input type="color" data-t="boxColor"><span class="dim">%</span><input type="number" data-t="boxOpacity" min="0" max="100" style="width:46px"><span class="dim">pad</span><input type="number" data-t="boxPad" min="0" max="200" style="width:46px"></div>
      <div class="tr2"><label>Animate in</label><select data-t="animIn">${anims}</select><label>out</label><select data-t="animOut">${anims}</select></div>
      <div class="tr2"><label>Anim. duration</label><input type="number" data-t="animDur" min="0.05" max="10" step="0.05" style="width:60px"><span class="dim">s</span></div>
    </div>`;
    sec.querySelector('.psh').onclick = () => { collapsed.has('text') ? collapsed.delete('text') : collapsed.add('text'); sec.classList.toggle('closed'); };
    const upd = (commit, label = 'Edit title') => { LC.requestRender(); LC.tl.draw(); if (commit) LC.commit(label); };
    sec.querySelectorAll('[data-t]').forEach(inp => {
      const k = inp.dataset.t; inp.value = T[k];
      const read = () => typeof T[k] === 'number' ? (isNaN(+inp.value) ? T[k] : +inp.value) : inp.value;
      inp.addEventListener('input', () => { T[k] = read(); if (k === 'preset') applyPreset(T); upd(false); });
      inp.addEventListener('change', () => { T[k] = read(); if (k === 'preset') { applyPreset(T); props.render(); } upd(true); });
    });
    sec.querySelectorAll('[data-c]').forEach(cb => { cb.checked = T[cb.dataset.c]; cb.onchange = () => { T[cb.dataset.c] = cb.checked; upd(true); }; });
    sec.querySelectorAll('[data-b]').forEach(b => { b.classList.toggle('on', T[b.dataset.b]); b.onclick = () => { T[b.dataset.b] = !T[b.dataset.b]; b.classList.toggle('on'); upd(true); }; });
    sec.querySelectorAll('[data-al]').forEach(b => { b.classList.toggle('on', T.align === b.dataset.al); b.onclick = () => { T.align = b.dataset.al; T.preset = 'custom'; props.render(); upd(true); }; });
    box.appendChild(sec);
  }
  function applyPreset(T) { const p = LC.TITLE_PRESETS[T.preset]; if (p) Object.assign(T, p); }
  LC.applyTitlePreset = applyPreset;
  function alIcon(i) { const x = [[2, 2, 2], [2, 3.5, 4], [2, 5, 6]][i]; return `<svg viewBox="0 0 14 13" width="14" height="13"><path d="M2 2h10M${x[1]} 5h7M2 8h10M${x[2]} 11h6" stroke="#234" stroke-width="1.4"/></svg>`; }

  /* ---------- transition ---------- */
  function renderTransition(box, tr) {
    const R = LC.trRegion(tr), a = tr.a && LC.clip(tr.a), b = tr.b && LC.clip(tr.b), audio = LC.isAudioTrType(tr.type), list = audio ? LC.ATRANSITIONS : LC.TRANSITIONS;
    const d = Aero.el('div', 'pane-pad');
    d.innerHTML = `<div class="phead"><div class="pname"><span class="pchip ${audio ? 'audio' : 'trans'}"></span><span class="grow">${esc(LC.trName(tr.type))}</span></div>
      <div class="dim" style="margin-top:4px">${a && b ? 'Between “' + esc(LC.clipName(a)) + '” and “' + esc(LC.clipName(b)) + '”' : b ? 'At the start of “' + esc(LC.clipName(b)) + '”' : 'At the end of “' + esc(LC.clipName(a)) + '”'}</div></div>
      <div class="psec"><div class="psh"><span class="grow">${audio ? 'Audio crossfade' : 'Settings'}</span></div><div class="psb tform">
      <div class="tr2"><label style="width:70px">Type</label><select id="trtype">${list.map(t => `<option value="${t.id}"${t.id === tr.type ? ' selected' : ''}>${t.name}</option>`).join('')}</select></div>
      <div class="tr2"><label style="width:70px">Duration</label><input type="text" class="mono" id="trdur" style="width:96px"><span class="dim" id="trfr"></span></div>
      <div class="tr2"><label style="width:70px">Alignment</label><span>${a && b ? 'Center at cut' : b ? 'Start at cut' : 'End at cut'}</span></div>
      <div class="tr2"><label style="width:70px">Region</label><span class="mono">${LC.tc(R.s)} → ${LC.tc(R.e)}</span></div>
      ${audio ? '<canvas id="trcurve" width="250" height="70" class="trcurve"></canvas><div class="dim">Constant Power keeps loudness steady through the fade (sin/cos); Constant Gain is a linear ramp.</div>' : ''}
      <div class="tr2" style="margin-top:8px"><button class="aero-btn" id="trdel">Delete Transition</button></div></div></div>`;
    box.appendChild(d);
    const dur = d.querySelector('#trdur'); dur.value = LC.tc(tr.dur); d.querySelector('#trfr').textContent = `${Math.round(tr.dur * LC.fps())} frames`;
    d.querySelector('#trtype').onchange = e => { tr.type = e.target.value; LC.commit('Transition type'); LC.refresh(); };
    dur.onchange = () => { const t = LC.parseTC(dur.value); if (t != null && t > 0) { tr.dur = LC.fr(t); LC.cleanTransitions(); LC.commit('Transition duration'); } LC.refresh(); };
    d.querySelector('#trdel').onclick = () => LC.deleteSelection();
    const cv = d.querySelector('#trcurve');
    if (cv) {
      const x = cv.getContext('2d'), W = cv.width, H = cv.height; x.fillStyle = '#1e2730'; x.fillRect(0, 0, W, H);
      const f = p => tr.type === 'cpower' ? [Math.cos(p * Math.PI / 2), Math.sin(p * Math.PI / 2)] : [1 - p, p];
      [[0, '#f0a040'], [1, '#6ad06a']].forEach(([i, col]) => { x.strokeStyle = col; x.lineWidth = 2; x.beginPath(); for (let px = 0; px <= W; px++) { const y = H - 6 - f(px / W)[i] * (H - 12); px ? x.lineTo(px, y) : x.moveTo(px, y); } x.stroke(); });
      x.fillStyle = '#c9d6e4'; x.font = '10px Segoe UI'; x.fillText('out', 4, 14); x.fillText('in', W - 16, 14);
    }
  }

  /* ---------- nothing selected: sequence summary ---------- */
  function renderSequence(box) {
    const P = LC.project, S = P.settings, pr = LC.PRESETS.find(p => p.id === S.preset);
    const d = Aero.el('div', 'pane-pad');
    d.innerHTML = `<div class="phead"><div class="pname"><span class="pchip seq"></span><span class="grow"></span></div><div class="dim" style="margin-top:4px">Select a clip to edit its effects</div></div>
      <div class="psec"><div class="psh"><span class="grow">Sequence</span></div><div class="psb">
      <table class="kv"><tr><td>Frame size</td><td>${S.w} × ${S.h}${pr ? ' · ' + esc(pr.name.split('  ')[0]) : ''}</td></tr><tr><td>Frame rate</td><td>${S.fps} fps</td></tr>
      <tr><td>Duration</td><td class="mono">${LC.tc(LC.seqDuration())}</td></tr><tr><td>Clips</td><td>${P.clips.length} on ${P.tracks.length} tracks</td></tr><tr><td>Media</td><td>${P.media.length} item${P.media.length === 1 ? '' : 's'}</td></tr>
      <tr><td>In / Out</td><td class="mono">${P.inPoint != null ? LC.tc(P.inPoint) : '—'} / ${P.outPoint != null ? LC.tc(P.outPoint) : '—'}</td></tr></table>
      <button class="aero-btn" id="seqset" style="margin-top:8px">Sequence Settings…</button></div></div>
      <div class="psec"><div class="psh"><span class="grow">Master</span></div><div class="psb"><div class="prow"><span class="kfw ph"></span><label>Volume</label><input type="range" min="-30" max="12" step=".1" id="mvol"><span class="pnum"><input type="number" id="mvoln" min="-60" max="12" step=".1"><i>dB</i></span><span class="kfnav"></span></div></div></div>
      <div class="psec"><div class="psh"><span class="grow">Tips</span></div><div class="psb dim tips">Drag media from the Project panel onto a track · <b>C</b> razor · <b>Ctrl+K</b> split · <b>Shift+Del</b> ripple delete · <b>J K L</b> shuttle · <b>I / O</b> in & out · <b>M</b> marker · drag effects onto a cut.</div></div>`;
    d.querySelector('.grow').textContent = P.name;
    box.appendChild(d);
    d.querySelector('#seqset').onclick = () => LC.settingsDialog();
    const mv = d.querySelector('#mvol'), mn = d.querySelector('#mvoln'); mv.value = mn.value = P.master || 0;
    mv.oninput = () => { mn.value = mv.value; LC.audio.setMaster(+mv.value); }; mv.onchange = () => LC.commit('Master volume');
    mn.onchange = () => { mv.value = mn.value; LC.audio.setMaster(Math.max(-60, Math.min(12, +mn.value))); LC.commit('Master volume'); };
  }
})();
