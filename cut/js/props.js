'use strict';
/* Lumen Cut — Effect Controls panel: motion, opacity, crop, speed, colour, blur, volume/fades, titles,
   keyframes (stopwatch / add-remove / prev-next) and transition settings. */
(function () {
  const $ = Aero.$, esc = Aero.esc;
  const props = LC.props = {};
  const V = ['video', 'image', 'title'];
  const SECTIONS = [
    { id: 'motion', name: 'Motion', types: V, rows: [
      { key: 'pos', label: 'Position', kind: 'pos', kf: true },
      { key: 'scale', label: 'Scale', min: 0, max: 400, step: .1, unit: '%', kf: true },
      { key: 'rot', label: 'Rotation', min: -360, max: 360, step: .1, unit: '°', kf: true }] },
    { id: 'opacity', name: 'Opacity', types: V, rows: [{ key: 'opacity', label: 'Opacity', min: 0, max: 100, step: .1, unit: '%', kf: true }] },
    { id: 'crop', name: 'Crop', types: ['video', 'image'], rows: ['Left', 'Top', 'Right', 'Bottom'].map((l, i) => ({ key: 'crop', idx: i, label: l, min: 0, max: 100, step: .1, unit: '%' })) },
    { id: 'speed', name: 'Speed', types: ['video', 'audio'], rows: [{ key: 'speed', label: 'Speed', min: .25, max: 4, step: .05, unit: '×' }] },
    { id: 'color', name: 'Color', types: V, reset: true, rows: [
      { key: 'exposure', label: 'Exposure', min: -3, max: 3, step: .01, unit: 'EV' },
      { key: 'brightness', label: 'Brightness', min: -100, max: 100, step: 1 },
      { key: 'contrast', label: 'Contrast', min: -100, max: 100, step: 1 },
      { key: 'saturation', label: 'Saturation', min: 0, max: 200, step: 1, unit: '%' },
      { key: 'temperature', label: 'Temperature', min: -100, max: 100, step: 1 }] },
    { id: 'blur', name: 'Gaussian Blur', types: V, rows: [{ key: 'blur', label: 'Blurriness', min: 0, max: 100, step: .5, unit: 'px' }] },
    { id: 'audio', name: 'Volume', types: ['audio'], rows: [
      { key: 'volume', label: 'Level', min: -60, max: 12, step: .1, unit: 'dB', kf: true },
      { key: 'fadeIn', label: 'Fade in', min: 0, max: 10, step: .05, unit: 's' },
      { key: 'fadeOut', label: 'Fade out', min: 0, max: 10, step: .05, unit: 's' }] }
  ];
  const collapsed = new Set();
  let refs = [];       // live rows for in-place updates

  const ic = {
    watch: '<svg viewBox="0 0 16 16"><circle cx="8" cy="9" r="5.5" fill="#fff" stroke="currentColor" stroke-width="1.3"/><path d="M8 9V6M6.5 1.8h3M12 4.5l1-1" stroke="currentColor" stroke-width="1.3" fill="none" stroke-linecap="round"/></svg>',
    prev: '<svg viewBox="0 0 10 10"><path d="M7 1.5 2.5 5 7 8.5z" fill="currentColor"/></svg>',
    next: '<svg viewBox="0 0 10 10"><path d="M3 1.5 7.5 5 3 8.5z" fill="currentColor"/></svg>',
    dia: '<svg viewBox="0 0 10 10"><path d="M5 1 9 5 5 9 1 5z" fill="currentColor" stroke="#334" stroke-width=".8"/></svg>'
  };
  const localT = c => Math.min(Math.max(LC.playhead - c.start, 0), c.dur);
  const fmt = (v, r) => r.kind === 'pos' ? '' : (+v).toFixed(r.step < .1 ? 2 : r.step < 1 ? 1 : 0);

  /* Set a parameter honouring keyframes; commit=true records an undo step */
  LC.setParam = (c, key, v, commit = true, idx) => {
    if (key === 'crop') { c.props.crop[idx] = v; }
    else if (key === 'speed') return LC.setSpeed(c, v, commit);
    else if (LC.isAnimated(c, key)) LC.setKey(c, key, localT(c), v);
    else c.props[key] = v;
    LC.requestRender(); LC.tl.draw(); props.update();
    if (commit) LC.commit(`Change ${key}`);
  };
  LC.setSpeed = (c, s, commit = true) => {
    s = Math.max(.25, Math.min(4, s));
    const group = [c, ...LC.linked(c)].filter(x => LC.isTimeBased(x));
    for (const x of group) {
      const old = x.props.speed; if (Math.abs(old - s) < 1e-6) continue;
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
    const box = $('#props'); if (!box || !LC.project) return; refs = [];
    const keepScroll = box.scrollTop; box.innerHTML = '';
    const tr = LC.tl.selTr && LC.project.transitions.find(t => t.id === LC.tl.selTr);
    const c = LC.tl.primary();
    $('#propsTitle').textContent = tr ? 'Transition' : c ? 'Effect Controls' : 'Sequence';
    if (tr) return renderTransition(box, tr);
    if (!c) return renderSequence(box);
    // header
    const hd = Aero.el('div', 'phead');
    const kindName = { video: 'Video clip', audio: 'Audio clip', image: 'Still image', title: 'Title' }[c.type];
    hd.innerHTML = `<div class="pname"><span class="pchip ${c.type}"></span><span class="grow"></span></div><div class="ptimes"><label>Start <input type="text" class="mono" data-f="start"></label><label>Duration <input type="text" class="mono" data-f="dur"></label></div>` +
      (LC.tl.sel.size > 1 ? `<div class="dim" style="margin-top:4px">${LC.tl.sel.size} clips selected — editing ${esc(kindName.toLowerCase())}</div>` : `<div class="dim" style="margin-top:4px">${esc(kindName)}${LC.mediaOf(c) ? ' · ' + esc(LC.mediaOf(c).name) : ''}${c.link ? ' · linked' : ''}${c.disabled ? ' · disabled' : ''}</div>`);
    hd.querySelector('.grow').textContent = LC.clipName(c);
    const fs = hd.querySelector('[data-f=start]'), fd = hd.querySelector('[data-f=dur]');
    fs.value = LC.tc(c.start); fd.value = LC.tc(c.dur);
    fs.onchange = () => { const t = LC.parseTC(fs.value); if (t == null) return props.render(); const d = LC.fr(Math.max(0, t)) - c.start; const grp = [c, ...LC.linked(c)]; const ids = new Set(grp.map(x => x.id)); grp.forEach(x => { x.start = LC.fr(x.start + d); }); grp.forEach(x => LC.overwriteRange(x.track, x.start, x.start + x.dur, ids)); LC.cleanTransitions(); LC.commit('Move clip'); LC.refresh(); };
    fd.onchange = () => { const t = LC.parseTC(fd.value); if (t == null) return props.render(); const grp = [c, ...LC.linked(c)]; grp.forEach(x => { const next = LC.clipsOn(x.track).find(o => o.start >= x.start + x.dur - 1e-6 && o.id !== x.id); let d = Math.min(LC.fr(Math.max(1 / LC.fps(), t)), LC.maxDur(x)); if (next && d > next.start - x.start) d = next.start - x.start; x.dur = d; }); LC.cleanTransitions(); LC.commit('Change duration'); LC.refresh(); };
    box.appendChild(hd);
    if (c.type === 'title') renderTitle(box, c);
    for (const S of SECTIONS) {
      if (!S.types.includes(c.type)) continue;
      const sec = Aero.el('div', 'psec' + (collapsed.has(S.id) ? ' closed' : ''));
      sec.innerHTML = `<div class="psh"><span class="tw"></span><span class="grow">${esc(S.name)}</span>${S.reset ? '<button class="aero-btn small" data-reset>Reset</button>' : ''}</div><div class="psb"></div>`;
      sec.querySelector('.psh').onclick = e => { if (e.target.closest('button')) return; collapsed.has(S.id) ? collapsed.delete(S.id) : collapsed.add(S.id); sec.classList.toggle('closed'); };
      if (S.reset) sec.querySelector('[data-reset]').onclick = () => { const d = LC.defaultProps(); S.rows.forEach(r => c.props[r.key] = d[r.key]); LC.commit('Reset ' + S.name); LC.refresh(); };
      const body = sec.querySelector('.psb');
      S.rows.forEach(r => body.appendChild(paramRow(c, r)));
      box.appendChild(sec);
    }
    box.scrollTop = keepScroll;
    props.update();
  };
  function paramRow(c, r) {
    const row = Aero.el('div', 'prow');
    const kfHtml = r.kf ? `<button class="kfw" title="Toggle animation (keyframes)">${ic.watch}</button>` : '<span class="kfw ph"></span>';
    const nav = r.kf ? `<span class="kfnav"><button data-k="p" title="Previous keyframe">${ic.prev}</button><button data-k="a" class="dia" title="Add/remove keyframe">${ic.dia}</button><button data-k="n" title="Next keyframe">${ic.next}</button></span>` : '<span class="kfnav"></span>';
    if (r.kind === 'pos') {
      row.innerHTML = `${kfHtml}<label>${r.label}</label><span class="pxy"><input type="number" step="1" data-i="0"><input type="number" step="1" data-i="1"></span>${nav}`;
      const S = LC.project.settings, ins = row.querySelectorAll('input');
      ins.forEach(inp => {
        inp.addEventListener('input', () => { const v = LC.valueAt(c, 'pos', localT(c)).slice(); const i = +inp.dataset.i; v[i] = (+inp.value) / (i ? S.h : S.w); LC.setParam(c, 'pos', v, false); });
        inp.addEventListener('change', () => LC.commit('Change position'));
      });
      refs.push({ c, r, set: () => { const v = LC.valueAt(c, 'pos', localT(c)); ins.forEach((inp, i) => { if (document.activeElement !== inp) inp.value = Math.round(v[i] * (i ? S.h : S.w)); }); }, row });
    } else {
      row.innerHTML = `${kfHtml}<label>${r.label}</label><input type="range" min="${r.min}" max="${r.max}" step="${r.step}"><span class="pnum"><input type="number" min="${r.min}" max="${r.max}" step="${r.step}"><i>${r.unit || ''}</i></span>${nav}`;
      const rg = row.querySelector('input[type=range]'), nm = row.querySelector('input[type=number]');
      const get = () => r.key === 'crop' ? c.props.crop[r.idx] : LC.valueAt(c, r.key, localT(c));
      const apply = (v, commit) => { v = Math.max(r.min, Math.min(r.max, v)); if (isNaN(v)) return; LC.setParam(c, r.key, v, commit, r.idx); };
      rg.addEventListener('input', () => { nm.value = fmt(rg.value, r); apply(+rg.value, false); });
      rg.addEventListener('change', () => { if (r.key !== 'speed') LC.commit('Change ' + r.label.toLowerCase()); else LC.setSpeed(c, +rg.value, true); });
      nm.addEventListener('change', () => apply(+nm.value, true));
      rg.addEventListener('dblclick', () => { const d = LC.defaultProps(); apply(r.key === 'crop' ? 0 : d[r.key], true); });
      refs.push({ c, r, set: () => { const v = get(); if (document.activeElement !== rg) rg.value = v; if (document.activeElement !== nm) nm.value = fmt(v, r); }, row });
    }
    if (r.kf) {
      row.querySelector('.kfw').onclick = () => {
        if (LC.isAnimated(c, r.key)) { const v = LC.valueAt(c, r.key, localT(c)); delete c.kf[r.key]; c.props[r.key] = v; LC.commit('Remove keyframes'); }
        else { LC.setKey(c, r.key, localT(c), JSON.parse(JSON.stringify(c.props[r.key]))); LC.commit('Add keyframe'); }
        LC.refresh();
      };
      row.querySelector('[data-k=a]').onclick = () => {
        const tl = localT(c), k = c.kf?.[r.key]?.find(q => Math.abs(q.t - tl) < .5 / LC.fps());
        if (k) LC.removeKey(c, r.key, tl); else LC.setKey(c, r.key, tl, JSON.parse(JSON.stringify(LC.valueAt(c, r.key, tl))));
        LC.commit(k ? 'Remove keyframe' : 'Add keyframe'); LC.refresh();
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
  props.syncTime = () => props.update();

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
    const R = LC.trRegion(tr), a = tr.a && LC.clip(tr.a), b = tr.b && LC.clip(tr.b);
    const d = Aero.el('div', 'pane-pad');
    d.innerHTML = `<div class="phead"><div class="pname"><span class="pchip trans"></span><span class="grow">${esc(LC.TRANSITIONS.find(t => t.id === tr.type).name)}</span></div>
      <div class="dim" style="margin-top:4px">${a && b ? 'Between “' + esc(LC.clipName(a)) + '” and “' + esc(LC.clipName(b)) + '”' : b ? 'At the start of “' + esc(LC.clipName(b)) + '”' : 'At the end of “' + esc(LC.clipName(a)) + '”'}</div></div>
      <div class="psec"><div class="psh"><span class="grow">Settings</span></div><div class="psb tform">
      <div class="tr2"><label style="width:70px">Type</label><select id="trtype">${LC.TRANSITIONS.map(t => `<option value="${t.id}"${t.id === tr.type ? ' selected' : ''}>${t.name}</option>`).join('')}</select></div>
      <div class="tr2"><label style="width:70px">Duration</label><input type="text" class="mono" id="trdur" style="width:96px"><span class="dim" id="trfr"></span></div>
      <div class="tr2"><label style="width:70px">Alignment</label><span>${a && b ? 'Center at cut' : b ? 'Start at cut' : 'End at cut'}</span></div>
      <div class="tr2"><label style="width:70px">Region</label><span class="mono">${LC.tc(R.s)} → ${LC.tc(R.e)}</span></div>
      <div class="tr2" style="margin-top:8px"><button class="aero-btn" id="trdel">Delete Transition</button></div></div></div>`;
    box.appendChild(d);
    const dur = d.querySelector('#trdur'); dur.value = LC.tc(tr.dur); d.querySelector('#trfr').textContent = `${Math.round(tr.dur * LC.fps())} frames`;
    d.querySelector('#trtype').onchange = e => { tr.type = e.target.value; LC.commit('Transition type'); LC.refresh(); };
    dur.onchange = () => { const t = LC.parseTC(dur.value); if (t != null && t > 0) { tr.dur = LC.fr(t); LC.cleanTransitions(); LC.commit('Transition duration'); } LC.refresh(); };
    d.querySelector('#trdel').onclick = () => LC.deleteSelection();
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
