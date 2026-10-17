'use strict';
/* Lumen Cut — application controller: menus, shortcuts, file I/O, undo, edit commands, dialogs. */
(function () {
  const $ = Aero.$, esc = Aero.esc, tl = LC.tl;
  let docPath = null;

  /* ---------- history ---------- */
  const hist = LC.hist = new Aero.History({ max: 120, onChange: () => { const el = $('#histlist'); if (el && !$('#tab-history').hidden) Aero.renderHistory(el, hist, i => restore(hist.go(i))); } });
  LC.commit = label => { hist.push(label, LC.serialize()); LC.status(); };
  function restore(state) {
    if (!state) return;
    LC.project = JSON.parse(state);
    for (const id of [...tl.sel]) if (!LC.clip(id)) tl.sel.delete(id);
    if (tl.selTr && !LC.project.transitions.some(t => t.id === tl.selTr)) tl.selTr = null;
    LC.audio.setMaster(LC.project.master || 0);
    LC.mon.layout(); LC.refresh();
  }
  LC.undo = () => { LC.stop(); restore(hist.undo()); };
  LC.redo = () => { LC.stop(); restore(hist.redo()); };

  /* ---------- refresh ---------- */
  LC.refresh = () => { tl.renderHeads(); tl.draw(); LC.bin.render(); LC.props.render(); LC.mixer.render(); LC.src.unloadIfGone(); LC.renderSeqTabs(); renderMarkers(); LC.requestRender(); LC.status(); updateTitles(); };
  LC.onSelection = () => { LC.props.render(); tl.draw(); LC.requestRender(); LC.status(); };
  function updateTitles() {
    const S = LC.project.settings;
    const sn = LC.activeSeq()?.name || LC.project.name;
    $('#montitle').textContent = 'Program: ' + sn; $('#tltitle').textContent = 'Timeline:';
    $('#moninfo').textContent = `${S.w}×${S.h} · ${S.fps} fps`;
  }
  let msgT = null;
  LC.statusMsg = m => { $('#st4').textContent = m; clearTimeout(msgT); msgT = setTimeout(() => { $('#st4').textContent = ''; }, 2500); };
  LC.status = () => {
    const P = LC.project; if (!P) return;
    $('#st1').textContent = `Playhead ${LC.tc(LC.playhead)}`;
    $('#st2').textContent = `Duration ${LC.tc(LC.seqDuration())}`;
    $('#st3').textContent = tl.sel.size ? `${tl.sel.size} clip${tl.sel.size > 1 ? 's' : ''} selected` : tl.selTr ? 'Transition selected' : `${P.clips.length} clips · ${P.media.length} media`;
    $('#tlinfo').textContent = `${tl.snap ? 'Snap on' : 'Snap off'}${tl.ripple ? ' · Ripple trim' : ''}${LC.mon.loop ? ' · Loop' : ''}`;
  };

  /* ---------- document lifecycle ---------- */
  function loadProject(p, name, path) {
    LC.stop(); LC.project = p; docPath = path || null;
    tl.sel.clear(); tl.selTr = null; LC.playhead = 0;
    hist.reset('Open', LC.serialize()); Aero.setDoc(name || p.name, false);
    LC.audio.setMaster(p.master || 0);
    LC.mon.layout(); LC.refresh(); setTimeout(() => tl.zoomFit(), 0);
  }
  LC.newProject_ = async (skipAsk) => {
    if (!skipAsk && Aero.dirty && !(await Aero.confirm('New Project', 'Discard unsaved changes to the current project?', 'Discard'))) return;
    const p = LC.newProject('1080p', 30); p.name = 'Untitled';
    LC.rt.media.clear(); loadProject(p, 'Untitled');
  };
  LC.openSample = async () => {
    if (Aero.dirty && !(await Aero.confirm('Open Sample', 'Discard unsaved changes to the current project?', 'Discard'))) return;
    LC.stop(); Aero.busy('Preparing sample…');
    try {
      const p = await LC.buildSampleProject(msg => Aero.busy(msg));
      loadProject(p, p.name); LC.setPlayhead(1.8); Aero.toast('Sample project ready — press Space to play');
    } catch (e) { console.error(e); Aero.alert('Open Sample', 'Could not build the sample: ' + e.message); }
    finally { Aero.busy(); }
  };
  async function openProjectData(name, text, path) {
    let p;
    try { p = LC.sanitizeProject(JSON.parse(text)); } catch (e) { return Aero.alert('Open Project', `“${name}” is not a valid Lumen Cut project (${e.message}).`); }
    // carry over media blobs already loaded in this session (same name & size) before asking the user to relink
    const old = new Map(); for (const [id, rt] of LC.rt.media) { const m = LC.project?.media.find(x => x.id === id); if (m && rt.status === 'ok') old.set(m.name + '|' + m.size, rt); }
    LC.stop(); LC.project = p; LC.rt.media.clear();
    for (const m of p.media) {
      const keep = old.get(m.name + '|' + m.size);
      if (keep) LC.rt.media.set(m.id, { ...keep, status: 'ok' }); else LC.rt.media.set(m.id, { status: 'offline' });
    }
    loadProject(p, Aero.baseName(name), path);
    // desktop: re-read media by stored path
    if (Aero.native?.readFile) {
      for (const m of p.media) {
        if (LC.rt.media.get(m.id).status === 'ok' || !m.path) continue;
        try { const f = await Aero.native.readFile(m.path); const data = f.data || f; LC.rt.media.set(m.id, { status: 'loading' }); await LC.attachBlob(m, new Blob([data], { type: m.type || '' }), m.path); } catch (e) { LC.rt.media.set(m.id, { status: 'offline' }); }
      }
    }
    await LC.relinkSamples();
    const miss = LC.missingMedia();
    LC.refresh();
    if (miss.length) await LC.relinkDialog(miss);
    LC.mon.layout();
    hist.reset('Open', LC.serialize()); Aero.setDoc(Aero.baseName(name), false);
  }
  LC.openProject = async () => {
    if (Aero.dirty && !(await Aero.confirm('Open Project', 'Discard unsaved changes to the current project?', 'Discard'))) return;
    const [f] = await Aero.openFile({ accept: '.lcut,application/json', filters: [{ name: 'Lumen Cut project', extensions: ['lcut'] }] });
    if (!f) return;
    await openProjectData(f.name, new TextDecoder().decode(f.data), f.path);
  };
  LC.openProjectText = openProjectData;
  LC.save = async (as) => {
    LC.stop();
    const name = (LC.project.name || 'Untitled').replace(/[\\/:*?"<>|]/g, '_') + '.lcut';
    const p = await Aero.saveFile({ name, data: LC.serialize(), filters: [{ name: 'Lumen Cut project', extensions: ['lcut'] }], path: as ? null : docPath });
    if (!p) return false;
    if (Aero.native) docPath = p;
    const nm = Aero.baseName(p); if (!LC.project.name || LC.project.name === 'Untitled') LC.project.name = nm;
    Aero.setDoc(nm, false); updateTitles(); Aero.toast('Saved ' + nm + '.lcut'); return true;
  };

  /* ---------- edit commands ---------- */
  const unlocked = c => !LC.track(c.track).lock;
  LC.splitAt = (t, ids) => {
    t = LC.fr(t); let n = 0;
    const list = (ids ? ids.map(LC.clip) : LC.project.clips.filter(c => t > c.start && t < c.start + c.dur)).filter(c => c && unlocked(c));
    for (const c of list) { const r = LC.splitClip(c, t); if (r) { n++; if (tl.sel.has(c.id)) tl.sel.add(r.id); } }
    // keep links: right halves of linked pairs get a fresh shared link
    const fresh = new Map(); for (const c of LC.project.clips) if (c.start === t && c.link && list.some(o => o.link === c.link && o.id !== c.id)) { if (!fresh.has(c.link)) fresh.set(c.link, 'l' + Aero.uid()); c.link = fresh.get(c.link); }
    if (n) { LC.commit('Razor'); LC.refresh(); } else Aero.toast('Nothing to split at the playhead');
    return n;
  };
  LC.splitSelected = () => {
    const t = LC.playhead, sel = tl.selected().filter(c => t > c.start && t < c.start + c.dur);
    LC.splitAt(t, sel.length ? sel.map(c => c.id) : null);
  };
  LC.deleteSelection = () => {
    if (tl.selTr) { LC.project.transitions = LC.project.transitions.filter(t => t.id !== tl.selTr); tl.selTr = null; LC.commit('Delete transition'); LC.refresh(); return; }
    const ids = tl.selected().filter(unlocked).map(c => c.id); if (!ids.length) return;
    LC.removeClips(ids); tl.sel.clear(); LC.cleanTransitions(); LC.commit('Delete'); LC.refresh();
  };
  LC.rippleDelete = () => {
    const sel = tl.selected().filter(unlocked); if (!sel.length) return Aero.toast('Select clips to ripple delete');
    const byTrack = new Map(); sel.forEach(c => { const a = byTrack.get(c.track) || []; a.push([c.start, c.start + c.dur]); byTrack.set(c.track, a); });
    LC.removeClips(sel.map(c => c.id));
    for (const [tid, ivs] of byTrack) {
      ivs.sort((a, b) => b[0] - a[0]);   // latest first
      for (const [a, b] of ivs) LC.rippleShift(tid, b - 1e-6, -(b - a));
    }
    tl.sel.clear(); LC.cleanTransitions(); LC.commit('Ripple delete'); LC.refresh();
  };
  let clipboard = null;
  LC.copy = () => {
    const sel = tl.selected(); if (!sel.length) return Aero.toast('Nothing selected');
    const t0 = Math.min(...sel.map(c => c.start)), ids = new Set(sel.map(c => c.id));
    clipboard = { t0, clips: JSON.parse(JSON.stringify(sel)), transitions: JSON.parse(JSON.stringify(LC.project.transitions.filter(t => (!t.a || ids.has(t.a)) && (!t.b || ids.has(t.b))))) };
    LC.statusMsg(`Copied ${sel.length} clip${sel.length > 1 ? 's' : ''}`);
  };
  LC.cut = () => { LC.copy(); LC.deleteSelection(); };
  LC.paste = (insert) => {
    if (!clipboard) return Aero.toast('Clipboard is empty');
    const P = LC.project, t = LC.fr(LC.playhead), idMap = new Map(), linkMap = new Map(), made = [];
    const span = Math.max(...clipboard.clips.map(c => c.start + c.dur)) - clipboard.t0;
    const trackFor = c => { const tr = LC.track(c.track); if (tr && !tr.lock) return tr.id; const k = clipboard.clips.find(x => x.id === c.id) && c.type === 'audio' ? 'audio' : 'video'; return (k === 'audio' ? LC.audioTracks() : LC.videoTracks()).find(x => !x.lock)?.id; };
    if (insert) { const tids = new Set(clipboard.clips.map(trackFor)); for (const tid of tids) { LC.clipsOn(tid).filter(c => c.start < t && c.start + c.dur > t).forEach(c => LC.splitClip(c, t)); LC.rippleShift(tid, t, span); } }
    const before = clipboard.clips.length; clipboard.clips = clipboard.clips.filter(c => c.type !== 'nest' || LC.canNest(c.seq));
    if (clipboard.clips.length < before) Aero.toast('Skipped nested clips that would make a sequence contain itself');
    if (!clipboard.clips.length) return;
    for (const src of clipboard.clips) {
      const c = JSON.parse(JSON.stringify(src)); c.id = 'c' + Aero.uid(); idMap.set(src.id, c.id);
      c.track = trackFor(src); if (!c.track) continue;
      c.start = LC.fr(t + (src.start - clipboard.t0));
      if (c.link) { if (!linkMap.has(c.link)) linkMap.set(c.link, 'l' + Aero.uid()); c.link = linkMap.get(c.link); }
      if (!insert) LC.overwriteRange(c.track, c.start, c.start + c.dur);
      P.clips.push(c); made.push(c);
    }
    for (const tr of clipboard.transitions) P.transitions.push({ ...tr, id: 'x' + Aero.uid(), a: tr.a ? idMap.get(tr.a) : null, b: tr.b ? idMap.get(tr.b) : null });
    LC.cleanTransitions();
    tl.sel = new Set(made.map(c => c.id)); tl.selTr = null;
    LC.commit(insert ? 'Paste insert' : 'Paste'); LC.setPlayhead(t + span); LC.refresh();
  };
  LC.selectAll = () => { tl.sel = new Set(LC.project.clips.map(c => c.id)); tl.selTr = null; LC.onSelection(); };
  LC.toggleEnable = () => { const s = tl.selected(); if (!s.length) return; const v = !s[0].disabled; s.forEach(c => c.disabled = v); LC.commit(v ? 'Disable clip' : 'Enable clip'); LC.refresh(); };
  LC.toggleLink = () => {
    const s = tl.selected(); if (!s.length) return;
    if (s.some(c => c.link)) { s.forEach(c => c.link = null); LC.commit('Unlink'); Aero.toast('Clips unlinked'); }
    else if (s.length > 1) { const id = 'l' + Aero.uid(); s.forEach(c => c.link = id); LC.commit('Link'); Aero.toast('Clips linked'); }
    LC.refresh();
  };
  LC.resetEffects = () => {
    const s = tl.selected(); if (!s.length) return; const d = LC.defaultProps();
    s.forEach(c => { const keep = { speed: c.props.speed, volume: c.props.volume, fadeIn: c.props.fadeIn, fadeOut: c.props.fadeOut }; c.props = Object.assign(LC.defaultProps(), keep); const kf = {}; ['speed', 'volume'].forEach(k => { if (c.kf?.[k]) kf[k] = c.kf[k]; }); c.kf = kf; delete c.key; delete c.curves; delete c.lut; delete c.afx; });
    LC.commit('Reset effects'); LC.refresh();
  };
  LC.speedDialog = () => {
    const c = tl.primary(); if (!c || !LC.isTimeBased(c)) return Aero.toast('Select a video or audio clip');
    Aero.dialog({ title: 'Clip Speed / Duration', instruction: LC.clipName(c), fields: [{ key: 'speed', label: 'Speed (%)', type: 'number', value: Math.round(c.props.speed * 100), min: 25, max: 400, step: 5 }],
      html: '<p class="dnote">25% – 400%. Changing speed changes the clip duration (it stops at the next clip). Linked audio follows.</p>',
      onOK: v => LC.setSpeed(c, Math.max(25, Math.min(400, v.speed)) / 100, true) });
  };
  const TITLE_KINDS = {
    center: { text: 'Your Title', size: 120 },
    lower: { text: 'Name Surname\nTitle or location', size: 60, preset: 'lower', x: .07, y: .8, align: 'left', box: true, boxOpacity: 65, shadow: false, animIn: 'typewriter', animOut: 'fade', animDur: .5 },
    top: { text: 'Caption text', size: 56, bold: false, preset: 'top', x: .5, y: .12, box: true, boxOpacity: 45, animIn: 'fade', animOut: 'fade' },
    big: { text: 'BIG TITLE', size: 210, font: 'Impact', bold: false, stroke: true, strokeColor: '#000000', strokeWidth: 4, animIn: 'zoom', animOut: 'fade' },
    credits: { text: 'Directed by\nYOUR NAME', size: 72, bold: false, y: .5, animIn: 'slide', animOut: 'slide', animDur: 1 }
  };
  LC.TITLE_KINDS = TITLE_KINDS;
  LC.addTitle = ({ track, start, preset = 'center', dur = 5 } = {}) => {
    const V = LC.videoTracks();
    const tr = (track && LC.track(track)) || V.slice(1).find(t => !t.lock && !LC.clipsOn(t.id).some(c => c.start < LC.playhead + dur && c.start + c.dur > LC.playhead)) || V.find(t => !t.lock) || V[0];
    start = LC.fr(start ?? LC.playhead);
    LC.overwriteRange(tr.id, start, start + dur);
    const c = LC.makeClip({ track: tr.id, type: 'title', start, dur, title: LC.defaultTitle(TITLE_KINDS[preset] || {}) });
    LC.project.clips.push(c); LC.cleanTransitions();
    tl.select([c.id]); LC.commit('New title'); LC.refresh(); LC.setPlayhead(Math.max(LC.playhead, start + Math.min(1.2, dur / 2)));
    setTimeout(() => { const ta = document.querySelector('#props textarea'); if (ta) { ta.focus(); ta.select(); } }, 30);
    return c;
  };
  LC.applyDefaultTransition = (type = 'dissolve') => {
    const t = LC.playhead, eps = .5 / LC.fps();
    let best = null, bd = 1;
    for (const tr of LC.videoTracks().slice().reverse()) {
      if (tr.lock) continue;
      for (const c of LC.clipsOn(tr.id)) {
        if (c.type === 'audio') continue;
        const ds = Math.abs(c.start - t), de = Math.abs(c.start + c.dur - t);
        if (ds < bd - eps) { bd = ds; best = [c, 'in']; } if (de < bd - eps) { bd = de; best = [c, 'out']; }
      }
    }
    if (!best) { const c = tl.primary(); if (c && c.type !== 'audio') best = [c, 'out']; }
    if (!best) return Aero.toast('Move the playhead near a cut (or select a clip) to add a transition');
    const x = LC.addTransition(best[0], best[1], type, 1);
    if (x) { tl.sel.clear(); tl.selTr = x.id; LC.commit('Add ' + LC.TRANSITIONS.find(q => q.id === type).name); LC.refresh(); }
  };
  LC.applyAudioCrossfade = (type = 'cpower') => {
    const t = LC.playhead, eps = .5 / LC.fps(); let best = null, bd = 1;
    for (const tr of LC.audioTracks()) { if (tr.lock) continue; for (const c of LC.clipsOn(tr.id)) { const ds = Math.abs(c.start - t), de = Math.abs(c.start + c.dur - t); if (ds < bd - eps) { bd = ds; best = [c, 'in']; } if (de < bd - eps) { bd = de; best = [c, 'out']; } } }
    if (!best) { const c = tl.selected().find(c => c.type === 'audio'); if (c) best = [c, 'out']; }
    if (!best) return Aero.toast('Move the playhead near an audio cut (or select an audio clip) to add a crossfade');
    const x = LC.addTransition(best[0], best[1], type, 1);
    if (x) { tl.sel.clear(); tl.selTr = x.id; LC.commit('Add ' + LC.trName(type)); LC.refresh(); }
    return x;
  };
  LC.editToTimeline = (mode) => {
    let ids = [...LC.bin.sel].filter(id => LC.rt.media.get(id)?.status === 'ok');
    if (!ids.length && LC.src.media) ids = [LC.src.media];
    if (!ids.length) return Aero.toast('Select media in the Project panel first');
    if (ids.length === 1) return LC.threePointEdit(ids[0], mode);
    const made = LC.placeMedia(ids, LC.playhead, null, mode);
    if (made.length) LC.setPlayhead(Math.max(...made.map(c => c.start + c.dur)));
  };

  /* ---------- tracks ---------- */
  LC.addTrack = kind => {
    const list = kind === 'video' ? LC.videoTracks() : LC.audioTracks();
    if (list.length >= 12) return Aero.toast('Maximum 12 tracks of each kind');
    const t = LC.makeTrack(kind, list.length + 1); const P = LC.project;
    if (kind === 'video') P.tracks.splice(P.tracks.indexOf(list[list.length - 1]) + 1, 0, t); else P.tracks.push(t);
    LC.commit('Add ' + t.name); LC.refresh();
  };
  LC.removeEmptyTracks = () => {
    const P = LC.project; let n = 0;
    for (const kind of ['video', 'audio']) {
      let list = P.tracks.filter(t => t.kind === kind);
      for (const t of list.slice().reverse()) { if (P.tracks.filter(x => x.kind === kind).length <= 1) break; if (!P.clips.some(c => c.track === t.id)) { P.tracks = P.tracks.filter(x => x !== t); n++; } }
      P.tracks.filter(t => t.kind === kind).forEach((t, i) => { if (/^[VA]\d+$/.test(t.name)) t.name = (kind === 'video' ? 'V' : 'A') + (i + 1); });
    }
    if (n) { LC.commit('Remove empty tracks'); LC.refresh(); } else Aero.toast('No empty tracks to remove');
  };
  LC.trackHeight = h => { LC.project.tracks.forEach(t => t.h = t.kind === 'video' ? h : Math.round(h * .86)); LC.commit('Track height'); LC.refresh(); };

  /* ---------- markers / in-out ---------- */
  const MCOLORS = [['#3fae4a', 'Green'], ['#e8382a', 'Red'], ['#f08a24', 'Orange'], ['#f2c82e', 'Yellow'], ['#2a8fe8', 'Blue'], ['#d43ad0', 'Magenta']];
  LC.addMarker = () => {
    const t = LC.fr(LC.playhead), P = LC.project, ex = P.markers.find(m => Math.abs(m.t - t) < .5 / LC.fps());
    if (ex) return LC.editMarker(ex);
    P.markers.push({ id: 'k' + Aero.uid(), t, name: 'Marker ' + (P.markers.length + 1), color: '#3fae4a' }); P.markers.sort((a, b) => a.t - b.t);
    LC.commit('Add marker'); LC.refresh();
  };
  LC.editMarker = mk => Aero.dialog({ title: 'Marker', instruction: 'Marker at ' + LC.tc(mk.t), fields: [{ key: 'name', label: 'Name', type: 'text', value: mk.name }, { key: 'color', label: 'Color', type: 'select', value: mk.color, options: MCOLORS }, { key: 'del', label: 'Delete this marker', type: 'checkbox', value: false }],
    onOK: v => { if (v.del) LC.project.markers = LC.project.markers.filter(m => m !== mk); else { mk.name = String(v.name).slice(0, 200); mk.color = v.color; } LC.commit(v.del ? 'Delete marker' : 'Edit marker'); LC.refresh(); } });
  LC.gotoMarker = dir => { const t = LC.playhead, ms = LC.project.markers.map(m => m.t).sort((a, b) => a - b); const n = dir > 0 ? ms.find(x => x > t + 1e-6) : ms.reverse().find(x => x < t - 1e-6); if (n != null) LC.setPlayhead(n); };
  const srcFocus = () => LC.focusMon === 'source' && LC.src.media;
  LC.srcFocus = srcFocus;
  LC.markIn = () => { if (srcFocus()) return LC.src.markIn(); const P = LC.project; P.inPoint = LC.fr(LC.playhead); if (P.outPoint != null && P.outPoint <= P.inPoint) P.outPoint = null; LC.commit('Mark in'); LC.refresh(); };
  LC.markOut = () => { if (srcFocus()) return LC.src.markOut(); const P = LC.project; P.outPoint = LC.fr(LC.playhead); if (P.inPoint != null && P.inPoint >= P.outPoint) P.inPoint = null; LC.commit('Mark out'); LC.refresh(); };
  LC.clearIO = () => { LC.project.inPoint = LC.project.outPoint = null; LC.commit('Clear in/out'); LC.refresh(); };
  let mkSel = null;
  function renderMarkers() {
    const box = $('#mklist'); if (!box) return; box.innerHTML = '';
    if (!LC.project.markers.length) { box.innerHTML = '<div class="dim" style="padding:12px">No markers. Press <b>M</b> to add one at the playhead.</div>'; return; }
    LC.project.markers.slice().sort((a, b) => a.t - b.t).forEach(m => {
      const d = Aero.el('div', 'aero-item' + (mkSel === m.id ? ' sel' : ''), `<span class="mkc"></span><span class="mono">${LC.tc(m.t)}</span><span class="grow"></span>`);
      d.querySelector('.mkc').style.background = m.color; d.querySelector('.grow').textContent = m.name;
      d.onclick = () => { mkSel = m.id; LC.setPlayhead(m.t); renderMarkers(); }; d.ondblclick = () => LC.editMarker(m);
      box.appendChild(d);
    });
  }

  /* ---------- settings ---------- */
  LC.settingsDialog = () => {
    const S = LC.project.settings;
    Aero.dialog({ title: 'Sequence Settings', instruction: 'Frame size and frame rate', width: 480,
      fields: [{ key: 'name', label: 'Name', type: 'text', value: LC.project.name },
        { key: 'preset', label: 'Preset', type: 'select', value: LC.PRESETS.some(p => p.id === S.preset) ? S.preset : 'custom', options: [...LC.PRESETS.map(p => [p.id, `${p.name}`]), ['custom', 'Custom']] },
        { key: 'w', label: 'Width', type: 'number', value: S.w, min: 16, max: 7680, step: 2 }, { key: 'h', label: 'Height', type: 'number', value: S.h, min: 16, max: 4320, step: 2 },
        { key: 'fps', label: 'Frame rate', type: 'select', value: String(S.fps), options: LC.FPS.map(f => [String(f), f + ' fps']) },
        { key: 'bg', label: 'Background', type: 'color', value: S.bg }],
      html: '<p class="dnote">Clip positions are stored relative to the frame, so changing the size keeps your layout. Changing the frame rate snaps edits to the new frame grid.</p>',
      onInput: (k, v, set) => { if (k === 'preset') { const p = LC.PRESETS.find(x => x.id === v.preset); if (p) { set('w', p.w); set('h', p.h); } } else if (k === 'w' || k === 'h') { const p = LC.PRESETS.find(x => x.w === v.w && x.h === v.h); set('preset', p ? p.id : 'custom'); } },
      onOK: v => {
        const fps = +v.fps, P = LC.project;
        P.name = String(v.name || 'Untitled').slice(0, 120);
        P.settings = { w: Math.max(16, Math.round(v.w / 2) * 2), h: Math.max(16, Math.round(v.h / 2) * 2), fps, preset: v.preset, bg: v.bg };
        const fr = t => Math.round(t * fps) / fps;
        LC.syncSeq(); for (const s of P.sequences) LC.withSeq(s.id, () => { P.clips.forEach(c => { c.start = fr(c.start); c.dur = Math.max(1 / fps, fr(c.dur)); }); P.markers.forEach(m => m.t = fr(m.t)); LC.cleanTransitions(); });
        LC.playhead = fr(LC.playhead); LC.cleanTransitions();
        LC.commit('Sequence settings'); LC.mon.layout(); LC.refresh(); Aero.setDoc(P.name, true);
      } });
  };

  /* ---------- misc dialogs ---------- */
  const SHORTCUTS = [
    ['File', [['Ctrl+N', 'New project'], ['Ctrl+O', 'Open project'], ['Ctrl+S / Ctrl+Shift+S', 'Save / Save As'], ['Ctrl+I', 'Import media'], ['Ctrl+M', 'Export video'], ['Ctrl+Shift+E', 'Export frame (PNG)']]],
    ['Playback', [['Space', 'Play / pause'], ['J / K / L', 'Shuttle reverse / stop / forward (press again for 2×, 4×, 8×)'], ['← / →', 'Step one frame'], ['Shift+← / →', 'Step five frames'], ['↑ / ↓', 'Previous / next edit point'], ['Home / End', 'Start / end of sequence']]],
    ['Marking', [['I / O', 'Mark in / out'], ['Shift+I / Shift+O', 'Go to in / out'], ['Ctrl+Shift+X', 'Clear in and out'], ['M', 'Add marker'], ['Shift+M / Ctrl+Shift+M', 'Next / previous marker']]],
    ['Source monitor', [['Double-click media', 'Open in the Source monitor'], ['I / O', 'Mark source In / Out (when the Source monitor is active)'], ['Space, ← / →', 'Play / step the source (when active)'], [', / .', 'Insert / overwrite the marked range at the playhead (or sequence In)']]],
    ['Effects & keyframes', [['Right-click a keyframe', 'Interpolation: linear, hold, ease in/out, bezier'], ['Drag a keyframe', 'Move it in time (timeline, selected clip)'], ['Ctrl+click volume line', 'Add a track volume keyframe'], ['Ctrl+Alt+D', 'Apply audio crossfade (constant power)'], ['Ctrl+Shift+H', 'Add frame hold'], ['Ctrl+Alt+A', 'New adjustment layer']]],
    ['Sequences', [['Ctrl+Alt+N', 'Nest selected clips'], ['Double-click nested clip', 'Open its sequence'], ['Click a tab', 'Switch sequence (double-click renames)'], ['Drag tab / bin sequence', 'Add it as a nested clip']]],
    ['Editing', [['Ctrl+K', 'Split at playhead'], ['Ctrl+Shift+K', 'Split all tracks'], ['Delete', 'Delete (lift)'], ['Shift+Delete', 'Ripple delete'], ['Ctrl+C / X / V', 'Copy / cut / paste (overwrite)'], ['Ctrl+Shift+V', 'Paste insert'], ['Ctrl+A', 'Select all'], ['Ctrl+D', 'Apply cross dissolve at playhead'], ['Ctrl+T', 'New title'], ['Ctrl+R', 'Speed / duration'], ['Ctrl+L', 'Link / unlink'], ['Shift+E', 'Enable / disable clip'], [', / .', 'Insert / overwrite bin selection at playhead'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo']]],
    ['Tools', [['V', 'Selection'], ['A', 'Track select forward'], ['B', 'Ripple edit'], ['N', 'Rolling edit'], ['R', 'Rate stretch'], ['C', 'Razor'], ['Y', 'Slip'], ['U', 'Slide'], ['H', 'Hand'], ['Z', 'Zoom'], ['T', 'Type']]],
    ['Timeline', [['S', 'Toggle snapping'], ['= / -', 'Zoom in / out'], ['\\', 'Zoom to sequence'], ['Ctrl+wheel', 'Zoom at pointer'], ['Shift+wheel', 'Scroll horizontally'], ['Alt+drag', 'Move/trim one side of a linked clip'], ['Ctrl+drag', 'Insert (ripple) instead of overwrite'], ['Esc', 'Cancel drag']]]
  ];
  LC.shortcutsDialog = () => Aero.dialog({ title: 'Keyboard Shortcuts', noCancel: true, width: 640, html: '<div class="kbwrap">' + SHORTCUTS.map(([h, rows]) => `<table class="kbtable"><tr><th colspan="2">${h}</th></tr>${rows.map(([k, d]) => `<tr><td>${esc(k)}</td><td>${esc(d)}</td></tr>`).join('')}</table>`).join('') + '</div>' });
  LC.aboutDialog = () => Aero.dialog({ title: 'About Lumen Cut', noCancel: true, html: `<div class="about"><img src="../kit/icons/cut.png" alt=""><div><div class="aero-instr" style="margin:0">Lumen Cut</div><div>Multitrack video editor · part of Lumen Studio</div><p class="dnote">WebGL2 compositor, WebAudio mixing, frame-accurate WebCodecs export.<br>Chroma key, Lumetri-style grading with .cube LUTs, blend modes, audio mixer &amp; effects, 3-point editing, speed ramps.<br>Bundled: mp4-muxer 5.2.2 (MIT), webm-muxer 5.1.4 (MIT), mp4box.js 2.4.1 (BSD-3-Clause).</p></div></div>` });

  /* ---------- context menu ---------- */
  LC.ctxMenu = (x, y, items) => {
    document.querySelectorAll('.ctxmenu').forEach(m => m.remove());
    const m = Aero.el('div', 'aero-dropdown ctxmenu');
    items.forEach(it => { if (it === '-') return m.appendChild(Aero.el('div', 'aero-msep')); const mi = Aero.el('div', 'aero-mi', `<span>${esc(it[0])}</span><span class="k"></span>`); mi.onclick = e => { e.stopPropagation(); m.remove(); it[1](); }; m.appendChild(mi); });
    document.body.appendChild(m);
    const r = m.getBoundingClientRect(); m.style.left = Math.min(x, innerWidth - r.width - 4) + 'px'; m.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
    setTimeout(() => { const close = () => { m.remove(); document.removeEventListener('pointerdown', h, true); }; const h = e => { if (!m.contains(e.target)) close(); }; document.addEventListener('pointerdown', h, true); }, 0);
  };

  /* ---------- tools ---------- */
  const TOOLS = [
    { id: 'select', title: 'Selection', key: 'V', hint: 'Click to select · drag to move (Ctrl = insert, Alt = ignore link) · drag edges to trim', icon: '<path d="M6 3l12 9-6 1-3 6z"/>' },
    { id: 'trackfwd', title: 'Track Select Forward', key: 'A', hint: 'Click a clip to select it and everything after it (Shift: this track only)', icon: '<path d="M4 5l8 7-8 7z"/><path d="M13 5l8 7-8 7z"/>' },
    { id: 'ripple', title: 'Ripple Edit', key: 'B', hint: 'Drag a clip edge: later clips move to close or open the gap', icon: '<path d="M8 4v16M8 12h10M15 9l3 3-3 3"/><path d="M3 7v10"/>' },
    { id: 'roll', title: 'Rolling Edit', key: 'N', hint: 'Drag an edit point: the cut moves, the outgoing clip’s out and the incoming clip’s in change together (Alt: ignore link)', icon: '<path d="M12 3v18"/><path d="M3 6h7v12H3M21 6h-7v12h7"/><path d="M8 12h8M9.5 10l-2 2 2 2M14.5 10l2 2-2 2"/>' },
    { id: 'stretch', title: 'Rate Stretch', key: 'R', hint: 'Drag a clip edge to change its speed so the same footage fills the new length', icon: '<path d="M3 5v14M21 5v14"/><path d="M6 12h12M9 9l-3 3 3 3M15 9l3 3-3 3"/><circle cx="12" cy="6" r="1.5"/>' },
    { id: 'razor', title: 'Razor', key: 'C', hint: 'Click to cut a clip (and its linked clip) · Shift: cut all tracks · Alt: ignore link', icon: '<path d="M5 19l9-9"/><path d="M14 10l5-5c1 3 0 6-3 7z"/><circle cx="6" cy="18" r="2"/>' },
    { id: 'slip', title: 'Slip', key: 'Y', hint: 'Drag inside a clip to change its in/out points without moving it', icon: '<path d="M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4"/><path d="M9 6v12M15 6v12"/>' },
    { id: 'slide', title: 'Slide', key: 'U', hint: 'Drag a clip left/right between its neighbours: they trim to make room, total length stays the same', icon: '<rect x="8" y="7" width="8" height="10" rx="1"/><path d="M2 12h4M18 12h4M4 10l-2 2 2 2M20 10l2 2-2 2"/>' },
    null,
    { id: 'hand', title: 'Hand', key: 'H', hint: 'Drag to scroll the timeline', icon: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v6M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-3-4a1.5 1.5 0 0 1 2.3-2L8 14"/>' },
    { id: 'zoom', title: 'Zoom', key: 'Z', hint: 'Click to zoom in · Alt+click to zoom out', icon: '<circle cx="10" cy="10" r="6"/><path d="M15 15l5 5M7 10h6M10 7v6"/>' },
    { id: 'text', title: 'Type', key: 'T', hint: 'Click on a video track to add a title there', icon: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>' }
  ];
  let toolbox;
  function setTool(id) { tl.tool = id; const t = TOOLS.find(x => x && x.id === id); $('#toolname').textContent = t.title; $('#toolhint').textContent = t.hint; tl.razorX = null; tl.draw(); }

  /* ---------- menus ---------- */
  const chk = (label, key, fn, on) => ({ label, key, fn, checked: on });
  const menus = {
    File: [['New Project', 'Ctrl+N', () => LC.newProject_()], ['Open Project…', 'Ctrl+O', () => LC.openProject()], ['Open Sample', '', () => LC.openSample()], '-',
      ['Save', 'Ctrl+S', () => LC.save(false)], ['Save As…', 'Ctrl+Shift+S', () => LC.save(true)], '-',
      ['Import Media…', 'Ctrl+I', () => LC.importDialog()], ['Import LUT (.cube)…', '', () => importLutCmd()], ['Relink Media…', '', () => LC.relinkDialog()],
      chk('Detect Scene Cuts on Import', '', () => { LC.prefs.sceneOnImport = !LC.prefs.sceneOnImport; Aero.toast('Scene detection on import ' + (LC.prefs.sceneOnImport ? 'on' : 'off')); }, () => LC.prefs.sceneOnImport), '-',
      ['Export Video…', 'Ctrl+M', () => LC.exportDialog()], ['Export Frame as PNG…', 'Ctrl+Shift+E', () => LC.exportFrame()], ['Export Audio as WAV…', '', () => LC.exportWav()], '-',
      ['Sequence Settings…', '', () => LC.settingsDialog()]],
    Edit: [['Undo', 'Ctrl+Z', () => LC.undo()], ['Redo', 'Ctrl+Y/Ctrl+Shift+Z', () => LC.redo()], '-',
      ['Cut', 'Ctrl+X', () => LC.cut()], ['Copy', 'Ctrl+C', () => LC.copy()], ['Paste', 'Ctrl+V', () => LC.paste(false)], ['Paste Insert', 'Ctrl+Shift+V', () => LC.paste(true)], '-',
      ['Clear', 'Delete/Backspace', () => LC.deleteSelection()], ['Ripple Delete', 'Shift+Delete/Shift+Backspace', () => LC.rippleDelete()], '-',
      ['Select All', 'Ctrl+A', () => LC.selectAll()], ['Deselect All', 'Ctrl+Shift+A', () => tl.clearSel()]],
    Clip: [['Split at Playhead', 'Ctrl+K', () => LC.splitSelected()], ['Split All Tracks', 'Ctrl+Shift+K', () => LC.splitAt(LC.playhead, null)], '-',
      ['Speed / Duration…', 'Ctrl+R', () => LC.speedDialog()], { label: 'Enable', key: 'Shift+E', fn: () => LC.toggleEnable(), checked: () => tl.selected().length > 0 && !tl.selected()[0].disabled },
      ['Link / Unlink', 'Ctrl+L', () => LC.toggleLink()], ['Reset Effects', '', () => LC.resetEffects()], '-',
      '#Time', ['Add Frame Hold', 'Ctrl+Shift+H', () => LC.frameHold(false)], ['Insert Frame Hold Segment', '', () => LC.frameHold(true)], '-',
      '#Scenes', ['Detect Scene Cuts', '', () => LC.detectScenesCmd()], ['Split at Scene Cuts', '', () => LC.splitAtScenes()], '-',
      '#Picture in picture', ['PiP Top Left', '', () => LC.pip('tl')], ['PiP Top Right', '', () => LC.pip('tr')], ['PiP Bottom Left', '', () => LC.pip('bl')], ['PiP Bottom Right', '', () => LC.pip('br')], ['Fill Frame', '', () => LC.pip('fill')], ['Reset to Full Frame', '', () => LC.pip('full')], '-',
      '#Transitions', ['Apply Cross Dissolve', 'Ctrl+D', () => LC.applyDefaultTransition('dissolve')], ['Apply Dip to Black', 'Ctrl+Shift+D', () => LC.applyDefaultTransition('dipblack')], ['Apply Audio Crossfade', 'Ctrl+Alt+D', () => LC.applyAudioCrossfade('cpower')], '-',
      '#Layers', ['New Adjustment Layer', 'Ctrl+Alt+A', () => LC.addAdjustment({})], '-',
      '#Titles', ['New Title', 'Ctrl+T', () => LC.addTitle({})], ['New Lower Third', '', () => LC.addTitle({ preset: 'lower' })], '-',
      ['Insert Selected Media', ',', () => LC.editToTimeline('insert')], ['Overwrite Selected Media', '.', () => LC.editToTimeline('overwrite')]],
    Sequence: [['New Sequence…', '', () => LC.newSequence()], ['Nest Selected Clips…', 'Ctrl+Alt+N', () => LC.nestSelection()], ['Open Nested Sequence', '', () => { const c = tl.selected().find(x => x.type === 'nest'); c ? LC.openNest(c) : Aero.toast('Select a nested clip'); }], ['Rename Sequence…', '', () => LC.renameSeq()], ['Delete Sequence…', '', () => LC.deleteSeq()], '-',
      ['Add Video Track', '', () => LC.addTrack('video')], ['Add Audio Track', '', () => LC.addTrack('audio')], ['Remove Empty Tracks', '', () => LC.removeEmptyTracks()], '-',
      ['Add Marker', 'M', () => LC.addMarker()], ['Go to Next Marker', 'Shift+M', () => LC.gotoMarker(1)], ['Go to Previous Marker', 'Ctrl+Shift+M', () => LC.gotoMarker(-1)], '-',
      ['Mark In', 'I', () => LC.markIn()], ['Mark Out', 'O', () => LC.markOut()], ['Go to In', 'Shift+I', () => LC.setPlayhead(LC.project.inPoint ?? 0)], ['Go to Out', 'Shift+O', () => LC.setPlayhead(LC.project.outPoint ?? LC.seqDuration())], ['Clear In and Out', 'Ctrl+Shift+X', () => LC.clearIO()], '-',
      chk('Snapping', 'S', () => toggleSnap(), () => tl.snap), chk('Ripple Trim Mode', '', () => toggleRipple(), () => tl.ripple), chk('Linked Selection', '', () => toggleLinked(), () => tl.linkedSel), '-',
      ['Auto Reframe Sequence…', '', () => LC.autoReframeDialog()], ['Sequence Settings…', '', () => LC.settingsDialog()]],
    Playback: [['Play / Pause', 'Space', () => srcFocus() ? LC.src.toggle() : LC.togglePlay()], ['Shuttle Reverse', 'J', () => LC.shuttle(-1)], ['Stop', 'K', () => LC.shuttle(0)], ['Shuttle Forward', 'L', () => LC.shuttle(1)], '-',
      { label: 'Step Back', key: '←', fn: () => LC.step(-1), noShortcut: true }, { label: 'Step Forward', key: '→', fn: () => LC.step(1), noShortcut: true },
      { label: 'Previous Edit', key: '↑', fn: () => LC.nextEdit(-1), noShortcut: true }, { label: 'Next Edit', key: '↓', fn: () => LC.nextEdit(1), noShortcut: true },
      ['Go to Start', 'Home', () => LC.setPlayhead(0)], ['Go to End', 'End', () => LC.setPlayhead(LC.seqDuration())], '-',
      chk('Loop In/Out', '', () => toggleLoop(), () => LC.mon.loop)],
    View: [['Zoom In Timeline', '=', () => tl.zoomAt(tl.pps * 1.5, can().clientWidth / 2)], ['Zoom Out Timeline', '-', () => tl.zoomAt(tl.pps / 1.5, can().clientWidth / 2)], ['Zoom to Sequence', '\\', () => tl.zoomFit()], '-',
      '#Program monitor', chk('Fit', 'Shift+Z', () => LC.mon.setZoom('fit'), () => LC.mon.zoom === 'fit'), chk('50%', '', () => LC.mon.setZoom(.5), () => LC.mon.zoom === .5), chk('100%', '', () => LC.mon.setZoom(1), () => LC.mon.zoom === 1),
      chk('Full Resolution', '', () => setRes(1), () => LC.mon.res === 1), chk('1/2 Resolution', '', () => setRes(2), () => LC.mon.res === 2), chk('1/4 Resolution', '', () => setRes(4), () => LC.mon.res === 4),
      chk('Safe Margins', '', () => toggleSafe(), () => LC.mon.safe), '-',
      '#Panels', chk('Source Monitor', '', () => LC.toggleSource(), () => LC.layoutSource()), ['Audio Track Mixer', '', () => showRightTab('mixer')], ['Effect Controls', '', () => showRightTab('props')], '-',
      '#Tracks', ['Small Tracks', '', () => LC.trackHeight(42)], ['Medium Tracks', '', () => LC.trackHeight(58)], ['Large Tracks', '', () => LC.trackHeight(90)]],
    Help: [['Keyboard Shortcuts', 'F1', () => LC.shortcutsDialog()], ['About Lumen Cut', '', () => LC.aboutDialog()]]
  };
  const can = () => $('#tracks');
  function toggleSnap() { tl.snap = !tl.snap; $('#csnap').classList.toggle('on', tl.snap); LC.status(); LC.statusMsg('Snapping ' + (tl.snap ? 'on' : 'off')); }
  function toggleRipple() { tl.ripple = !tl.ripple; $('#cripple').classList.toggle('on', tl.ripple); LC.status(); }
  function toggleLinked() { tl.linkedSel = !tl.linkedSel; $('#clink').classList.toggle('on', tl.linkedSel); }
  function toggleLoop() { LC.mon.loop = !LC.mon.loop; $('#bloop').classList.toggle('on', LC.mon.loop); LC.status(); }
  function toggleSafe() { LC.mon.safe = !LC.mon.safe; $('#bsafe').classList.toggle('on', LC.mon.safe); LC.requestRender(); }
  function setRes(r) { LC.mon.res = r; $('#mres').value = String(r); LC.mon.layout(); }

  /* ---------- init ---------- */
  function init() {
    Aero.init({ name: 'Lumen Cut', icon: '../kit/icons/cut.png', doc: 'Untitled', menus, onSave: () => LC.save(false) });
    toolbox = Aero.toolbox($('#tools'), TOOLS, setTool); toolbox.set('select');
    // extra shortcuts not shown in menus
    const stepR = n => srcFocus() ? LC.src.step(n) : LC.step(n);
    Aero.shortcut('ArrowLeft', () => stepR(-1)); Aero.shortcut('ArrowRight', () => stepR(1));
    Aero.shortcut('Shift+ArrowLeft', () => stepR(-5)); Aero.shortcut('Shift+ArrowRight', () => stepR(5));
    Aero.shortcut('ArrowUp', () => LC.nextEdit(-1)); Aero.shortcut('ArrowDown', () => LC.nextEdit(1));
    Aero.shortcut('Escape', () => { if (!tl.op) tl.clearSel(); });
    // command bar
    $('#csnap').onclick = toggleSnap; $('#cripple').onclick = toggleRipple; $('#clink').onclick = toggleLinked;
    $('#cmark').onclick = () => LC.addMarker(); $('#csplit').onclick = () => LC.splitSelected(); $('#ctitle').onclick = () => LC.addTitle({}); $('#cexport').onclick = () => LC.exportDialog();
    $('#tlzoom').oninput = e => tl.zoomAt(Math.exp(+e.target.value), can().clientWidth / 2);
    // monitor transport
    $('#bplay').innerHTML = LC.ICON.play; $('#bplay').onclick = () => LC.togglePlay();
    $('#bback').onclick = () => LC.step(-1); $('#bfwd').onclick = () => LC.step(1);
    $('#bin_').onclick = () => LC.markIn(); $('#bout').onclick = () => LC.markOut();
    $('#bgoin').onclick = () => LC.setPlayhead(LC.project.inPoint ?? 0); $('#bgoout').onclick = () => LC.setPlayhead(LC.project.outPoint ?? LC.seqDuration());
    $('#bloop').onclick = toggleLoop; $('#bsafe').onclick = toggleSafe; $('#bframe').onclick = () => LC.exportFrame();
    $('#mzoom').onchange = e => LC.mon.setZoom(e.target.value === 'fit' ? 'fit' : +e.target.value);
    $('#mres').onchange = e => setRes(+e.target.value);
    // timeline corner
    $('#addv').onclick = () => LC.addTrack('video'); $('#adda').onclick = () => LC.addTrack('audio');
    $('#tltc').onclick = async () => { const v = await Aero.prompt('Go to timecode', 'Timecode (HH:MM:SS:FF or seconds)', LC.tc(LC.playhead)); if (v != null) { const t = LC.parseTC(v); if (t != null) LC.setPlayhead(LC.fr(t)); } };
    // bin
    $('#bimport').onclick = () => LC.importDialog(); $('#btitle').onclick = () => LC.addTitle({});
    $('#binov').onclick = () => LC.editToTimeline('overwrite'); $('#bins').onclick = () => LC.editToTimeline('insert');
    $('#bview').onclick = () => { LC.bin.view = LC.bin.view === 'grid' ? 'list' : 'grid'; LC.bin.render(); };
    $('#bdel').onclick = () => LC.bin.removeSelected();
    $('#binsearch').oninput = e => { LC.bin.filter = e.target.value; LC.bin.render(); };
    // left tabs
    $('#ltabs').onclick = e => { const t = e.target.dataset.tab; if (!t) return; document.querySelectorAll('#ltabs .aero-tab').forEach(x => x.classList.toggle('on', x.dataset.tab === t)); document.querySelectorAll('.ltab').forEach(x => x.hidden = x.id !== 'tab-' + t); if (t === 'history') Aero.renderHistory($('#histlist'), hist, i => restore(hist.go(i))); if (t === 'markers') renderMarkers(); };
    $('#mkadd').onclick = () => LC.addMarker(); $('#mkdel').onclick = () => { if (!mkSel) return Aero.toast('Select a marker first'); LC.project.markers = LC.project.markers.filter(m => m.id !== mkSel); mkSel = null; LC.commit('Delete marker'); LC.refresh(); };
    buildEffects();
    // timeline / monitor splitter
    $('#hsplit').onpointerdown = e => { const el = e.target, y0 = e.clientY, h0 = $('#tlpanel').offsetHeight; try { el.setPointerCapture(e.pointerId); } catch (_) { } el.onpointermove = ev => { const h = Math.max(150, Math.min(innerHeight - 260, h0 - (ev.clientY - y0))); $('#work').style.setProperty('--tlh', h + 'px'); }; el.onpointerup = () => { el.onpointermove = null; tl.draw(); LC.mon.layout(); }; };
    // whole-window drop: media → bin, .lcut → open
    const app = $('.aero-app');
    app.addEventListener('dragover', e => { if (LC.drag) return; if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); app.classList.add('drag-over'); } });
    app.addEventListener('dragleave', e => { if (!app.contains(e.relatedTarget)) app.classList.remove('drag-over'); });
    app.addEventListener('drop', async e => {
      app.classList.remove('drag-over'); if (LC.drag) return; e.preventDefault();
      const files = [...e.dataTransfer.files]; if (!files.length) return;
      const proj = files.find(f => /\.lcut$/i.test(f.name));
      if (proj) { if (Aero.dirty && !(await Aero.confirm('Open Project', 'Discard unsaved changes to the current project?', 'Discard'))) return; return openProjectData(proj.name, await proj.text(), Aero.native?.pathForFile?.(proj) || null); }
      LC.importBlobs(files.map(f => ({ name: f.name, blob: f, path: Aero.native?.pathForFile?.(f) || null })));
    });
    $('#rtabs').onclick = e => { const t = e.target.dataset.tab; if (t) showRightTab(t); };
    const sync0 = LC.props.syncTime; LC.props.syncTime = () => { sync0(); LC.mixer.update(); };
    LC.tl.init(); LC.mon.init(); LC.src.init(); LC.mon.startMeter();
    LC.project = LC.newProject('1080p', 30);
    loadProject(LC.project, 'Untitled');
    // desktop: project passed on launch
    if (Aero.native?.launchFile) Aero.native.launchFile().then(f => { if (f && /\.lcut$/i.test(f.name)) openProjectData(f.name, new TextDecoder().decode(f.data), f.path); }).catch(() => { });
    Aero.native?.onOpenFile?.(async p => { try { const f = await Aero.native.readFile(p); if (/\.lcut$/i.test(f.name)) openProjectData(f.name, new TextDecoder().decode(f.data), f.path); } catch (e) { } });
  }
  function showRightTab(t) { document.querySelectorAll('#rtabs .aero-tab').forEach(x => x.classList.toggle('on', x.dataset.tab === t)); document.querySelectorAll('.rtab').forEach(x => x.hidden = x.id !== 'rtab-' + t); if (t === 'mixer') LC.mixer.render(); }
  LC.showRightTab = showRightTab;
  LC.layoutSource = () => !$('#work').classList.contains('nosrc');
  LC.toggleSource = (on = !LC.layoutSource()) => { $('#work').classList.toggle('nosrc', !on); if (!on) { LC.src.pause(); LC.src.focus('program'); } setTimeout(() => { LC.mon.layout(); LC.src.draw(); tl.draw(); }, 0); };
  async function importLutCmd() { const l = await LC.importLut(); if (!l) return; const s = tl.selected().filter(c => LC.isVisual(c)); s.forEach(c => c.lut = { id: l.id, amt: 100 }); LC.commit('Import LUT'); LC.refresh(); if (s.length) Aero.toast(`Applied ${l.name} to ${s.length} clip${s.length > 1 ? 's' : ''}`); }
  function buildEffects() {
    const box = $('#fxlist'); box.innerHTML = '';
    const ico = {
      dissolve: '<svg viewBox="0 0 22 16"><rect x="1" y="2" width="12" height="12" fill="#4a7fc4" stroke="#1d4f8a"/><rect x="9" y="2" width="12" height="12" fill="#d39b3f" fill-opacity=".7" stroke="#8a5a0a"/></svg>',
      dipblack: '<svg viewBox="0 0 22 16"><rect x="1" y="2" width="20" height="12" fill="url(#dipb)" stroke="#222"/><defs><linearGradient id="dipb"><stop offset="0" stop-color="#4a7fc4"/><stop offset=".5" stop-color="#000"/><stop offset="1" stop-color="#d39b3f"/></linearGradient></defs></svg>',
      dipwhite: '<svg viewBox="0 0 22 16"><rect x="1" y="2" width="20" height="12" fill="url(#dipw)" stroke="#888"/><defs><linearGradient id="dipw"><stop offset="0" stop-color="#4a7fc4"/><stop offset=".5" stop-color="#fff"/><stop offset="1" stop-color="#d39b3f"/></linearGradient></defs></svg>',
      wipe: '<svg viewBox="0 0 22 16"><rect x="1" y="2" width="20" height="12" fill="#4a7fc4" stroke="#1d4f8a"/><rect x="1" y="2" width="10" height="12" fill="#d39b3f"/><path d="M11 2v12" stroke="#fff" stroke-width="1.5"/></svg>',
      slide: '<svg viewBox="0 0 22 16"><rect x="1" y="2" width="20" height="12" fill="#4a7fc4" stroke="#1d4f8a"/><rect x="9" y="2" width="12" height="12" fill="#d39b3f" stroke="#8a5a0a"/><path d="M5 8h3M6.5 6.5 8 8 6.5 9.5" stroke="#fff" fill="none"/></svg>',
      iris: '<svg viewBox="0 0 22 16"><rect x="1" y="2" width="20" height="12" fill="#4a7fc4" stroke="#1d4f8a"/><circle cx="11" cy="8" r="4.5" fill="#d39b3f" stroke="#fff"/></svg>',
      clock: '<svg viewBox="0 0 22 16"><rect x="1" y="2" width="20" height="12" fill="#4a7fc4" stroke="#1d4f8a"/><path d="M11 8V2h10v12H11z" fill="#d39b3f"/><path d="M11 8V2M11 8l7 6" stroke="#fff" stroke-width="1.3"/></svg>',
      barndoor: '<svg viewBox="0 0 22 16"><rect x="1" y="2" width="20" height="12" fill="#4a7fc4" stroke="#1d4f8a"/><rect x="7" y="2" width="8" height="12" fill="#d39b3f"/><path d="M7 2v12M15 2v12" stroke="#fff" stroke-width="1.3"/></svg>',
      wipedown: '<svg viewBox="0 0 22 16"><rect x="1" y="2" width="20" height="12" fill="#4a7fc4" stroke="#1d4f8a"/><rect x="1" y="2" width="20" height="6" fill="#d39b3f"/><path d="M1 8h20" stroke="#fff" stroke-width="1.5"/></svg>',
      zoom: '<svg viewBox="0 0 22 16"><rect x="1" y="2" width="20" height="12" fill="#4a7fc4" stroke="#1d4f8a"/><rect x="6" y="5" width="10" height="6" fill="#d39b3f" stroke="#fff"/><path d="M3 4l3 1.5M19 4l-3 1.5M3 12l3-1.5M19 12l-3-1.5" stroke="#fff"/></svg>',
      push: '<svg viewBox="0 0 22 16"><rect x="1" y="2" width="9" height="12" fill="#4a7fc4" stroke="#1d4f8a"/><rect x="11" y="2" width="10" height="12" fill="#d39b3f" stroke="#8a5a0a"/></svg>',
      afade: '<svg viewBox="0 0 22 16"><rect x="1" y="2" width="20" height="12" rx="1.5" fill="#45a656" stroke="#2a7238"/><path d="M2 4q8 0 18 9M2 13q8-1 18-9" stroke="#fff" stroke-width="1.3" fill="none"/></svg>',
      adjust: '<svg viewBox="0 0 22 16"><rect x="1" y="1.5" width="20" height="13" rx="1.5" fill="#8fa1b3" stroke="#5c6e80"/><path d="M5 5h12M5 8h12M5 11h12" stroke="#fff" stroke-width="1.2"/><circle cx="9" cy="5" r="1.6" fill="#ffcf33"/><circle cx="14" cy="8" r="1.6" fill="#ffcf33"/><circle cx="7" cy="11" r="1.6" fill="#ffcf33"/></svg>',
      title: '<svg viewBox="0 0 22 16"><rect x="1" y="1.5" width="20" height="13" rx="1.5" fill="#a965c9" stroke="#5a2a7a"/><path d="M6 5h10M11 5v7" stroke="#fff" stroke-width="1.6"/></svg>'
    };
    const head = t => box.appendChild(Aero.el('div', 'aero-mhead', esc(t)));
    const item = (fx, name, icon, dbl) => {
      const d = Aero.el('div', 'aero-item', icon + `<span class="grow">${esc(name)}</span>`); d.draggable = true;
      d.ondragstart = e => { LC.drag = { kind: 'fx', fx }; e.dataTransfer.setData('text/x-lcut', fx); e.dataTransfer.effectAllowed = 'copy'; };
      d.ondragend = () => { LC.drag = null; tl.dropGhost = null; tl.draw(); };
      d.onclick = () => { box.querySelectorAll('.aero-item').forEach(x => x.classList.toggle('sel', x === d)); };
      d.ondblclick = dbl; box.appendChild(d);
    };
    head('Video Transitions');
    LC.TRANSITIONS.forEach(t => item('transition:' + t.id, t.name, ico[t.id], () => LC.applyDefaultTransition(t.id)));
    head('Audio Transitions');
    LC.ATRANSITIONS.forEach(t => item('atransition:' + t.id, t.name, ico.afade, () => LC.applyAudioCrossfade(t.id)));
    head('Layers');
    item('adjust:layer', 'Adjustment Layer', ico.adjust, () => LC.addAdjustment({}));
    head('Titles');
    [['center', 'Basic Title'], ['lower', 'Lower Third'], ['top', 'Caption (top)'], ['big', 'Big Impact Title'], ['credits', 'Credits']].forEach(([k, n]) => item('title:' + k, n, ico.title, () => LC.addTitle({ preset: k })));
  }
  init();
})();
