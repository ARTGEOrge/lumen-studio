'use strict';
/* Lumen Beats — app shell: command bar, menus, transport, file I/O, sample song, keyboard piano, Web MIDI, recording. */
(function () {
  const C = Core, $ = s => document.querySelector(s), esc = Aero.esc;
  const ICON = '../kit/icons/beats.png';
  const AUDIO_EXT = /\.(wav|wave|mp3|ogg|oga|flac|m4a|aac|opus|webm)$/i;

  /* ================= toolbox / command bar ================= */
  const TOOLS = [
    { id: 'draw', title: 'Draw — click to add notes / clips, drag to move', key: 'P', icon: '<path d="M4 20l1.5-5L16 4.5l3.5 3.5L9 18.5z"/><path d="M14 6.5l3.5 3.5"/>' },
    { id: 'paint', title: 'Paint — drag to paint a run of notes / clips', key: 'B', icon: '<path d="M14 4l6 6-7 7-6-6z"/><path d="M7 11l-3 3c-1.5 1.5-1 4 1 5s3.5-.5 5-2l2-2"/>' },
    { id: 'select', title: 'Select — drag a marquee; drag selection to move', key: 'E', icon: '<path d="M4 7V4h3M10 4h4M17 4h3v3M20 10v4M20 17v3h-3M14 20h-4M7 20H4v-3M4 14v-4"/>' },
    { id: 'erase', title: 'Erase — click or drag to delete (right-click works with any tool)', key: 'D', icon: '<path d="M8 20h12M5 15l9-10 6 6-8 9H8z"/><path d="M9 11l6 6"/>' },
    { id: 'slice', title: 'Slice — click a note or clip to split it', key: 'C', icon: '<path d="M12 3v18"/><path d="M5 8h4v8H5zM15 8h4v8h-4z"/>' }
  ];
  const TOOL_NAMES = { draw: 'Draw', paint: 'Paint', select: 'Select', erase: 'Erase', slice: 'Slice' };
  let tools;
  const TI = {
    stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>', play: '<path d="M7 4.5v15L19.5 12z"/>', rec: '<circle cx="12" cy="12" r="6.5"/>',
    metro: '<path d="M9 3h6l3.5 18h-13z" fill="none" stroke="#fff" stroke-width="1.8"/><path d="M12 15 17 6" stroke="#fff" stroke-width="1.8"/>'
  };
  function cmdbar() {
    const cmd = $('#cmd'), prj = App.prj;
    cmd.innerHTML = `<div class="modes"><button class="aero-btn" data-m="pattern" title="Pattern mode: loop the selected pattern (L)">PAT</button><button class="aero-btn" data-m="song" title="Song mode: play the playlist (L)">SONG</button></div>
      <div class="transport"><button class="tbtn" id="t-stop" title="Stop (Space)"><svg viewBox="0 0 24 24">${TI.stop}</svg></button><button class="tbtn play" id="t-play" title="Play / stop (Space)"><svg viewBox="0 0 24 24">${TI.play}</svg></button>
      <button class="tbtn rec" id="t-rec" title="Record notes from the keyboard / MIDI while playing (R)"><svg viewBox="0 0 24 24">${TI.rec}</svg></button><button class="tbtn" id="t-metro" title="Metronome (Ctrl+M)"><svg viewBox="0 0 24 24">${TI.metro}</svg></button></div>
      <div class="lcd" id="lcd" title="Position bar:beat:tick">1:1:00</div>
      <label title="Tempo in beats per minute (wheel or type)">BPM <input type="number" id="bpm" min="20" max="400" step="0.5" style="width:62px"></label>
      <label title="Time signature"><select id="sig">${['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '12/8'].map(s => `<option>${s}</option>`).join('')}</select></label>
      <label title="Swing: delays every second 1/16 note">Swing <input type="range" id="swing" min="0" max="100" style="width:70px"><span class="v" id="swing-v"></span></label>
      <span class="sep"></span>
      <label>Pattern <select id="patsel"></select></label><button class="aero-btn small" id="pat-new" title="New pattern (F4)">+</button>
      <span class="sep"></span>
      <label title="Grid snap for the Piano Roll and Playlist">Snap <select id="snap"><option value="bar">Bar</option><option value="beat">Beat</option><option value="half">1/2 beat</option><option value="third">1/3 beat</option><option value="step">1/4 beat (step)</option><option value="sixth">1/6 beat</option><option value="eighth">1/8 beat</option><option value="none">None</option></select></label>
      <label title="Key and scale (highlighted in the Piano Roll)">Scale <select id="key">${C.NOTE_NAMES.map((n, i) => `<option value="${i}">${n}</option>`).join('')}</select><select id="scale">${Object.entries(C.SCALES).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('')}</select></label>`;
    cmd.querySelectorAll('.modes .aero-btn').forEach(b => b.onclick = () => setMode(b.dataset.m));
    $('#t-play').onclick = togglePlay; $('#t-stop').onclick = stop; $('#t-rec').onclick = toggleRec; $('#t-metro').onclick = toggleMetro;
    const bpm = $('#bpm');
    bpm.onchange = () => { const v = C.clamp(+bpm.value || 120, 20, 400); prj_().bpm = Math.round(v * 100) / 100; App.commit('Tempo', ['pl', 'side']); Engine.setTempo(); updateCmd(); };
    bpm.onwheel = e => { e.preventDefault(); prj_().bpm = C.clamp(Math.round((prj_().bpm + (e.deltaY < 0 ? 1 : -1)) * 2) / 2, 20, 400); bpm.value = prj_().bpm; Engine.setProject(prj_()); Engine.setTempo(); clearTimeout(bpm._t); bpm._t = setTimeout(() => App.commit('Tempo'), 500); };
    $('#sig').onchange = e => { const [n, d] = e.target.value.split('/').map(Number); prj_().sigNum = n; prj_().sigDen = d; App.commit('Time signature'); if (Engine.playing) Engine.updateLoop(); };
    $('#swing').oninput = e => { prj_().swing = +e.target.value / 100; $('#swing-v').textContent = e.target.value + '%'; Engine.setProject(prj_()); };
    $('#swing').onchange = () => App.commit('Swing', []);
    $('#patsel').onchange = e => App.selectPattern(e.target.value);
    $('#pat-new').onclick = newPattern;
    $('#snap').onchange = e => { App.snap = e.target.value; App.refresh(['roll', 'pl']); };
    $('#key').onchange = e => { prj_().key = +e.target.value; App.commit('Key', ['roll']); };
    $('#scale').onchange = e => { prj_().scale = e.target.value; App.commit('Scale', ['roll']); };
  }
  const prj_ = () => App.prj;
  function updateCmd() {
    const p = App.prj; if (!p) return;
    document.querySelectorAll('.modes .aero-btn').forEach(b => b.classList.toggle('on', b.dataset.m === App.mode));
    if (document.activeElement !== $('#bpm')) $('#bpm').value = p.bpm;
    $('#sig').value = `${p.sigNum}/${p.sigDen}`; if ($('#sig').value !== `${p.sigNum}/${p.sigDen}`) { $('#sig').add(new Option(`${p.sigNum}/${p.sigDen}`)); $('#sig').value = `${p.sigNum}/${p.sigDen}`; }
    $('#swing').value = Math.round(p.swing * 100); $('#swing-v').textContent = Math.round(p.swing * 100) + '%';
    $('#patsel').innerHTML = p.patterns.map(x => `<option value="${x.id}">${esc(x.name)}</option>`).join(''); $('#patsel').value = App.sel.pat;
    $('#snap').value = App.snap; $('#key').value = p.key; $('#scale').value = p.scale;
    $('#t-play').classList.toggle('on', Engine.playing); $('#t-rec').classList.toggle('on', App.recording); $('#t-metro').classList.toggle('on', Engine.metronome);
    App.setStatus('st-prj', `${p.bpm} BPM · ${p.sigNum}/${p.sigDen} · ${C.NOTE_NAMES[p.key]} ${C.SCALES[p.scale].name} · ${p.channels.length} channels · ${p.patterns.length} patterns`);
    App.setStatus('st-tool', TOOL_NAMES[App.tool] + (App.pianoKeys ? ' · typing keyboard = piano' : ''));
  }
  App.views.cmd = { render: updateCmd };

  /* ================= transport ================= */
  function setMode(m) { const was = Engine.playing; if (was) stop(); App.mode = Engine.mode = m; updateCmd(); App.refresh(['pl']); if (was) play(); }
  async function play() {
    Engine.mode = App.mode; Engine.patId = App.sel.pat;
    await Engine.play(App.mode === 'song' ? App.songPos : 0);
    updateCmd(); App.setStatus('st-audio', `${Engine.ctx.sampleRate} Hz · ${Math.round((Engine.ctx.baseLatency || 0) * 1000 + Engine.lookahead * 0)} ms base latency`);
  }
  function stop() { if (Engine.playing) Engine.stop(); finishRecording(); updateCmd(); App.updatePos(App.mode === 'song' ? App.songPos : 0); App.refresh(['pl', 'roll']); }
  function togglePlay() { Engine.playing ? stop() : play(); }
  function toggleRec() { App.recording = !App.recording; updateCmd(); Aero.toast(App.recording ? 'Recording armed — play notes on the typing keyboard (Ctrl+T) or a MIDI keyboard while the transport runs' : 'Recording off'); if (App.recording && !Engine.playing) play(); }
  function toggleMetro() { Engine.metronome = !Engine.metronome; updateCmd(); }
  App.updatePos = t => { $('#lcd').textContent = C.fmtPos(App.prj, t); App.setStatus('st-pos', 'Position ' + C.fmtPos(App.prj, t)); };
  Engine.onStop = () => updateCmd();

  /* ================= live input: typing keyboard, Web MIDI, recording ================= */
  const KEYMAP = { KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6, KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12, KeyL: 13, Period: 14, Semicolon: 15, Slash: 16,
    KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17, Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24, Digit9: 25, KeyO: 26, Digit0: 27, KeyP: 28, BracketLeft: 29, Equal: 30, BracketRight: 31 };
  const held = new Map();   // key → {voice, rec}
  function liveOn(key, p, v) {
    const ch = App.ch; if (!ch || held.has(key)) return;
    const voice = Engine.noteOn(ch.id, p, v);
    held.set(key, { voice, rec: recStart(ch, p, v) });
    App.hover(`${ch.name}: ${C.noteName(p)} vel ${v}`);
  }
  function liveOff(key) { const h = held.get(key); if (!h) return; held.delete(key); Engine.noteOff(h.voice); recEnd(h.rec); }
  addEventListener('keydown', e => {
    if (!App.pianoKeys || e.ctrlKey || e.altKey || e.metaKey || document.querySelector('.aero-modal')) return;
    if (e.target.matches?.('input[type=text],input[type=number],textarea,select')) return;
    if (e.code === 'PageUp' || e.code === 'PageDown') { App.kbOct = C.clamp(App.kbOct + (e.code === 'PageUp' ? 1 : -1), 0, 8); Aero.toast('Typing keyboard octave: C' + (App.kbOct - 1) + ' – C' + (App.kbOct + 1)); e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (!(e.code in KEYMAP)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (e.repeat) return;
    liveOn('k' + e.code, C.clamp(12 * App.kbOct + KEYMAP[e.code], 0, 127), e.shiftKey ? 127 : 100);
  }, true);
  addEventListener('keyup', e => { if (('k' + e.code) && held.has('k' + e.code)) liveOff('k' + e.code); }, true);
  addEventListener('blur', () => { for (const k of [...held.keys()]) liveOff(k); });
  let midiAccess = null;
  async function enableMidi() {
    if (midiAccess) { midiAccess.inputs.forEach(i => i.onmidimessage = null); midiAccess = null; App.setStatus('st-midi', 'MIDI off'); return; }
    if (!navigator.requestMIDIAccess) return Aero.alert('MIDI input', 'Web MIDI is not available in this browser.');
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      const bind = () => { const names = []; midiAccess.inputs.forEach(inp => { names.push(inp.name); inp.onmidimessage = onMidi; }); App.setStatus('st-midi', names.length ? 'MIDI: ' + names.join(', ') : 'MIDI: no devices'); };
      midiAccess.onstatechange = bind; bind(); Aero.toast('MIDI input enabled — notes play the selected channel');
    } catch (err) { midiAccess = null; Aero.alert('MIDI input', 'MIDI access was denied or failed: ' + err.message); }
  }
  function onMidi(m) {
    const [st, a, b] = m.data, hi = st & 0xf0;
    if (hi === 0x90 && b > 0) liveOn('m' + a, a, b); else if (hi === 0x80 || (hi === 0x90 && b === 0)) liveOff('m' + a);
  }
  // recording into the selected pattern
  function recPos() {
    const pos = Engine.position(); if (pos == null) return null;
    const pat = App.pat, L = C.patLen(App.prj, pat);
    if (Engine.mode === 'pattern') return pos % L;
    const c = App.prj.playlist.clips.find(c => c.pat === pat.id && pos >= c.start && pos < c.start + c.len);
    return c ? (pos - c.start + (c.off || 0)) % L : null;
  }
  function recStart(ch, p, v) {
    if (!App.recording || !Engine.playing) return null;
    const t = recPos(); if (t == null) return null;
    return { ch: ch.id, p, v, t, pat: App.pat };
  }
  let recCount = 0;
  function recEnd(r) {
    if (!r) return; const L = C.patLen(App.prj, r.pat); let e = recPos(); if (e == null) e = r.t + C.STEP;
    let d = e - r.t; if (d <= 0) d += L;
    let t = r.t; if (App.recQuant) { const g = App.snapTicks(); t = Math.round(t / g) * g % L; d = Math.max(g / 2, Math.round(d / g) * g || g); }
    const arr = r.pat.notes[r.ch] || (r.pat.notes[r.ch] = []);
    arr.push({ t: Math.round(t), d: Math.max(1, Math.round(d)), p: r.p, v: r.v }); C.sortNotes(arr); recCount++;
    Engine.setProject(App.prj); App.refresh(['rack', 'roll']);
  }
  function finishRecording() { if (recCount) { App.commit(`Record ${recCount} note${recCount > 1 ? 's' : ''}`, ['rack', 'roll', 'pl']); recCount = 0; } }
  App.recQuant = true;

  /* ================= document operations ================= */
  App.selectPattern = (id, quiet) => { App.sel.pat = id; App.sel.notes.clear(); Engine.patId = id; if (Engine.playing && Engine.mode === 'pattern') Engine.updateLoop(); App.refresh(quiet ? ['cmd', 'rack', 'roll', 'pl'] : undefined); };
  App.showView = v => {
    App.view = v; document.querySelectorAll('#ed-tabs .aero-tab').forEach(t => t.classList.toggle('on', t.dataset.v === v));
    ['rack', 'roll', 'mixer'].forEach(k => { $('#v-' + k).hidden = k !== v; });
    App.refresh([v === 'rack' ? 'rack' : v === 'roll' ? 'roll' : 'mixer']);
  };
  App.showSide = t => { document.querySelectorAll('#side-tabs .aero-tab').forEach(x => x.classList.toggle('on', x.dataset.tab === t)); $('#side-inst').hidden = t !== 'inst'; $('#side-fx').hidden = t !== 'fx'; };
  App.addChannel = (type, o = {}) => {
    const prj = App.prj, n = prj.channels.length, col = o.color || C.COLORS[n % 8];
    const ins = C.newInsert(o.name || C.INST[type].short, { color: col }); prj.mixer.inserts.push(ins);
    const ch = C.newChannel(type, { ...o, color: col, out: ins.id }); prj.channels.push(ch);
    App.sel.ch = ch.id; App.commit('Add ' + ch.name); App.showSide('inst'); return ch;
  };
  App.deleteChannel = ch => {
    const prj = App.prj; prj.channels = prj.channels.filter(c => c !== ch);
    for (const p of prj.patterns) delete p.notes[ch.id];
    prj.automation = prj.automation.filter(a => !a.target.startsWith('ch:' + ch.id + ':'));
    App.fixSel(); App.commit('Delete channel');
  };
  App.deleteInsert = s => {
    const prj = App.prj; prj.mixer.inserts = prj.mixer.inserts.filter(i => i !== s);
    prj.channels.forEach(c => { if (c.out === s.id) c.out = null; }); prj.mixer.inserts.forEach(i => { i.sends = i.sends.filter(x => x.to !== s.id); });
    prj.automation = prj.automation.filter(a => C.targetSpec(prj, a.target));
    App.fixSel(); App.commit('Delete insert');
  };
  App.clonePattern = p => { const q = JSON.parse(JSON.stringify(p)); q.id = C.uid(); q.name = p.name.replace(/( \d+)?$/, m => ' ' + ((parseInt(m) || 1) + 1)); App.prj.patterns.splice(App.prj.patterns.indexOf(p) + 1, 0, q); App.sel.pat = q.id; App.commit('Clone pattern'); };
  function newPattern() { const prj = App.prj, p = C.newPattern('Pattern ' + (prj.patterns.length + 1), { color: C.COLORS[prj.patterns.length % 8] }); prj.patterns.push(p); App.sel.pat = p.id; Engine.patId = p.id; App.commit('New pattern'); }
  App.addAutomation = target => {
    const prj = App.prj, sp = C.targetSpec(prj, target); if (!sp) return;
    if (prj.automation.some(a => a.target === target)) { Aero.toast('That parameter already has an automation lane in the Playlist'); return; }
    const v = C.norm(sp.spec, C.getTarget(prj, target)), end = C.songEnd(prj);
    prj.automation.push({ id: C.uid(), target, on: true, points: [{ t: 0, v }, { t: end, v }] });
    App.commit('Add automation lane', ['pl']);
    Aero.toast(`Automation lane “${sp.label}” added to the Playlist — it plays in Song mode` + (sp.live ? '' : ' (applied at each note start)'), 4200);
  };
  function automationDialog() {
    const prj = App.prj, list = C.automationTargets(prj).filter(t => !prj.automation.some(a => a.target === t.id));
    Aero.dialog({ title: 'Add Automation Lane', instruction: 'Choose a parameter to automate over the song.', width: 520,
      fields: [{ key: 't', label: 'Parameter', type: 'select', options: list.map(t => [t.id, t.label]), value: list[0]?.id }], onOK: v => v.t && App.addAutomation(v.t) });
  }

  /* ================= history ================= */
  App.hist = new Aero.History({ max: 150, onChange: () => { Aero.renderHistory($('#hist'), App.hist, i => { App.restore(App.hist.go(i)); }); $('#histinfo').textContent = App.hist.items.length + ' states'; } });
  function undo() { const s = App.hist.undo(); if (s) App.restore(s); }
  function redo() { const s = App.hist.redo(); if (s) App.restore(s); }

  /* ================= files ================= */
  function setProject(prj, label, name) {
    if (Engine.playing) Engine.stop();
    App.prj = prj; App.sel = { ch: prj.channels[0]?.id || null, pat: prj.patterns[0].id, ins: prj.mixer.inserts[0]?.id || 'master', fx: null, notes: new Set(), clips: new Set() };
    App.fixSel(); App.songPos = 0; Engine.patId = App.sel.pat;
    App.hist.reset(label, App.snapshot()); Aero.setDoc(name || prj.name, false);
    Engine.setProject(prj); App.views.pl.state.fitted = false; App.views.roll.state.scrollY = null;
    App.refresh(); App.updatePos(0);
  }
  async function confirmDiscard() { return !Aero.dirty || await Aero.confirm('Discard changes?', 'The current project has unsaved changes. Discard them?', 'Discard'); }
  async function newProject() { if (!await confirmDiscard()) return; App.samples = {}; App.file = null; setProject(C.newProject(), 'New project', 'Untitled'); hideWelcome(); }
  async function openDialog() {
    const f = await Aero.openFile({ accept: '.lbeat,.mid,.midi,.rmi,.wav,.mp3,.ogg,.flac,.m4a', filters: [{ name: 'Lumen Beats projects, MIDI and audio', extensions: ['lbeat', 'mid', 'midi', 'wav', 'mp3', 'ogg', 'flac', 'm4a'] }] });
    if (f.length) handleFiles(f);
  }
  async function handleFiles(files) {
    for (const f of files) {
      try {
        if (/\.lbeat$/i.test(f.name) || (!/\./.test(f.name) && new Uint8Array(f.data)[0] === 0x7b)) { if (!await confirmDiscard()) return; await loadProjectBytes(f.data, f); }
        else if (/\.(mid|midi|rmi|kar)$/i.test(f.name)) await importMidiBytes(f.data, f.name);
        else if (AUDIO_EXT.test(f.name)) await addSample(f.name, new Uint8Array(f.data));
        else Aero.toast('Unsupported file: ' + f.name);
      } catch (e) { console.error(e); Aero.alert('Could not open file', `${f.name}: ${e.message}`); }
    }
    hideWelcome();
  }
  async function loadProjectBytes(buf, f) {
    let json; try { json = JSON.parse(new TextDecoder().decode(buf)); } catch (e) { throw new Error('The file is not valid JSON'); }
    const prj = C.sanitize(json);
    const samples = prj.samples; prj.samples = {};
    App.samples = samples; Engine.buffers.clear();
    Aero.busy('Loading samples…');
    try { for (const [id, s] of Object.entries(samples)) { try { await Engine.loadSample(id, C.b64decode(s.b64)); } catch (e) { Aero.toast('Could not decode sample ' + s.name); } } }
    finally { Aero.busy(); }
    App.file = f ? { name: f.name, path: f.path } : null;
    setProject(prj, 'Open ' + (f?.name || 'project'), prj.name);
  }
  function projectBytes() {
    const prj = JSON.parse(App.snapshot()); prj.samples = {};
    for (const c of prj.channels) if (c.sample && App.samples[c.sample]) prj.samples[c.sample] = App.samples[c.sample];
    return JSON.stringify(prj);
  }
  async function save(as) {
    const name = (App.file?.name && !as) ? App.file.name : (App.prj.name || 'Untitled').replace(/[\\/:*?"<>|]+/g, '_') + '.lbeat';
    const p = await Aero.saveFile({ name, data: projectBytes(), filters: [{ name: 'Lumen Beats project', extensions: ['lbeat'] }], path: as ? null : App.file?.path });
    if (!p) return false;
    App.file = { name: Aero.baseName(p) + '.lbeat', path: Aero.isDesktop ? p : null }; App.prj.name = Aero.baseName(p);
    Aero.setDoc(App.prj.name, false); Aero.toast('Saved ' + App.file.name); return true;
  }
  async function importMidiBytes(buf, name) {
    const m = Midi.parse(buf), notes = m.tracks.reduce((a, t) => a + t.notes.length, 0);
    if (!notes) throw new Error('The MIDI file contains no notes');
    const choice = await new Promise(res => Aero.dialog({ title: 'Import MIDI', instruction: `${name}: ${m.tracks.length} tracks, ${notes} notes, ${m.tempos[0] ? Math.round(m.tempos[0].bpm) + ' BPM' : 'no tempo'}.`,
      fields: [{ key: 'how', label: 'Import as', type: 'select', options: [['new', 'New project (instruments + mixer)'], ['add', 'New pattern in this project']], value: 'new' }], onOK: v => res(v.how), onCancel: () => res(null) }));
    if (!choice) return;
    if (choice === 'new') { if (!await confirmDiscard()) return; App.samples = {}; App.file = null; const prj = Midi.toProject(m, Aero.baseName(name)); setProject(prj, 'Import ' + name, prj.name); App.mode = Engine.mode = 'song'; updateCmd(); return; }
    const x = Midi.toParts(m), prj = App.prj, pat = C.newPattern(Aero.baseName(name).slice(0, 40), { color: C.COLORS[prj.patterns.length % 8] });
    for (const part of x.parts.slice(0, 64)) {
      const col = C.COLORS[prj.channels.length % 8], ins = C.newInsert(part.name, { color: col }); prj.mixer.inserts.push(ins);
      const ch = C.newChannel(part.type, { name: part.name, color: col, out: ins.id, params: part.params }); prj.channels.push(ch); pat.notes[ch.id] = C.sortNotes(part.notes);
    }
    pat.bars = Math.max(1, Math.min(256, Math.ceil(x.len / C.barTicks(prj)))); prj.patterns.push(pat); App.sel.pat = pat.id;
    App.commit('Import MIDI ' + name); Aero.toast(`Imported ${x.parts.length} parts into pattern “${pat.name}”`);
  }
  async function addSample(name, bytes, ch) {
    Aero.busy('Decoding ' + name + '…');
    const id = C.uid();
    try { await Engine.loadSample(id, bytes); } finally { Aero.busy(); }
    App.samples[id] = { name: name.slice(0, 120), b64: C.b64encode(bytes) };
    if (ch) { ch.sample = id; App.commit('Load sample ' + name); }
    else App.addChannel('sampler', { name: Aero.baseName(name).slice(0, 40), sample: id });
    Aero.toast('Loaded sample ' + name);
  }
  App.importSample = async ch => {
    const f = await Aero.openFile({ accept: 'audio/*,.wav,.mp3', filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a'] }] });
    if (f[0]) try { await addSample(f[0].name, new Uint8Array(f[0].data), ch && ch.type === 'sampler' ? ch : null); } catch (e) { Aero.alert('Could not load sample', e.message); }
  };
  /* ---------- export ---------- */
  function exportDialog(kind) {
    const fields = [{ key: 'range', label: 'Render', type: 'select', options: [['song', 'Song (playlist)'], ['pattern', 'Current pattern']], value: App.mode },
      { key: 'loops', label: 'Pattern loops', type: 'number', min: 1, max: 64, value: 4 },
      { key: 'sr', label: 'Sample rate', type: 'select', options: [[44100, '44.1 kHz'], [48000, '48 kHz']], value: 44100 },
      kind === 'wav' ? { key: 'bits', label: 'Bit depth', type: 'select', options: [[16, '16-bit PCM (dithered)'], [24, '24-bit PCM'], [32, '32-bit float']], value: 16 } : { key: 'kbps', label: 'Bit rate', type: 'select', options: [[128, '128 kbps'], [192, '192 kbps'], [256, '256 kbps'], [320, '320 kbps']], value: 192 },
      { key: 'tail', label: 'Tail (reverb / delay)', type: 'range', min: 0, max: 8, step: 0.5, value: 2, fmt: v => v + ' s' },
      { key: 'norm', label: 'Normalize to −0.3 dBFS', type: 'checkbox', value: false }];
    Aero.dialog({ title: kind === 'wav' ? 'Export WAV' : 'Export MP3', instruction: 'Offline render — sample-accurate and faster than real time.', fields, ok: 'Export', onOK: v => doExport(kind, v) });
  }
  async function doExport(kind, v) {
    if (v.range === 'song' && !App.prj.playlist.clips.length) return Aero.alert('Export', 'The playlist is empty. Place pattern clips in the Playlist, or export the current pattern.');
    Aero.busy('Rendering…');
    try {
      const buf = await Render.render(App.prj, Engine.buffers, { mode: v.range, patId: App.sel.pat, loops: v.loops, tail: v.tail, sr: +v.sr });
      const chs = [buf.getChannelData(0), buf.getChannelData(1)];
      let peak = 0; for (const c of chs) for (let i = 0; i < c.length; i++) { const a = Math.abs(c[i]); if (a > peak) peak = a; }
      if (v.norm && peak > 0) { const k = Math.pow(10, -0.3 / 20) / peak; for (const c of chs) for (let i = 0; i < c.length; i++) c[i] *= k; }
      Aero.busy(kind === 'wav' ? 'Writing WAV…' : 'Encoding MP3…'); await new Promise(r => setTimeout(r, 30));
      const data = kind === 'wav' ? Wav.encode(chs, buf.sampleRate, +v.bits) : Wav.encodeMp3(chs, buf.sampleRate, +v.kbps);
      Aero.busy();
      const name = (App.prj.name || 'Untitled').replace(/[\\/:*?"<>|]+/g, '_') + (v.range === 'pattern' ? ' - ' + App.pat.name : '') + '.' + kind;
      const p = await Aero.saveFile({ name, data, filters: [{ name: kind.toUpperCase(), extensions: [kind] }] });
      const pdb = peak > 0 ? (20 * Math.log10(peak)).toFixed(1) : '−∞';
      if (p) Aero.toast(`Exported ${Aero.baseName(p)}.${kind} · ${buf.duration.toFixed(1)} s · peak ${pdb} dBFS${peak > 1 && !v.norm ? ' (clipped — lower the master or normalize)' : ''}`, 4500);
      return { peak, duration: buf.duration, bytes: data.length };
    } catch (e) { Aero.busy(); console.error(e); Aero.alert('Export failed', e.message); }
  }
  function exportMidi() {
    Aero.dialog({ title: 'Export MIDI', fields: [{ key: 'range', label: 'Export', type: 'select', options: [['song', 'Song (playlist)'], ['pattern', 'Current pattern']], value: App.mode }], ok: 'Export',
      onOK: async v => { const bytes = Midi.fromProject(App.prj, v.range, App.sel.pat); const name = (App.prj.name || 'Untitled').replace(/[\\/:*?"<>|]+/g, '_') + '.mid'; const p = await Aero.saveFile({ name, data: bytes, filters: [{ name: 'MIDI', extensions: ['mid'] }] }); if (p) Aero.toast('Exported ' + name); } });
  }
  App.doExport = doExport;

  /* ================= sample song ================= */
  function stabSample() {   // a chord stab rendered with plain math → WAV bytes (keeps the sampler demo download-free)
    const sr = 44100, n = Math.round(sr * 0.7), L = new Float32Array(n), R = new Float32Array(n), fs = [220, 261.63, 329.63, 440];
    let lpL = 0, lpR = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr; let sl = 0, sr2 = 0;
      fs.forEach((f, k) => { const d = 1 + (k - 1.5) * 0.004; sl += ((t * f * d) % 1) * 2 - 1; sr2 += ((t * f / d) % 1) * 2 - 1; });
      const cut = 300 + 6000 * Math.exp(-t * 9), a = 1 - Math.exp(-2 * Math.PI * cut / sr), env = Math.min(1, t / 0.003) * Math.exp(-t * 4.2);
      lpL += a * (sl - lpL); lpR += a * (sr2 - lpR); L[i] = lpL * env * 0.22; R[i] = lpR * env * 0.22;
    }
    return Wav.encode([L, R], sr, 16);
  }
  async function openSample() {
    if (!await confirmDiscard()) return;
    const prj = C.newProject(); prj.name = 'Midnight Drive'; prj.bpm = 122; prj.key = 9; prj.scale = 'minor'; prj.swing = 0.12;
    prj.channels = []; prj.mixer.inserts = []; prj.patterns = [];
    const I = {}; const ins = (k, name, color, o = {}) => (I[k] = C.newInsert(name, { color, ...o }), prj.mixer.inserts.push(I[k]), I[k]);
    const fx = (t, p) => C.newFx(t, p);
    ins('kick', 'Kick', '#e8693a', { fx: [fx('eq', { lg: 3, lf: 70, mg: -4, mf: 380, mq: 1.4 }), fx('comp', { th: -14, ra: 4, at: 0.004, re: 0.12, mk: 2 })] });
    ins('snare', 'Snare & Clap', '#e3a21a', { fx: [fx('eq', { hg: 3, hf: 8000, lg: -6, lf: 160 })] });
    ins('hats', 'Hats', '#5cb82c', { pan: 0.12, fx: [fx('eq', { lg: -12, lf: 400 })] });
    ins('bass', 'Bass', '#2aa38f', { fx: [fx('dist', { mode: 'soft', drive: 8, tone: 3500, out: -5, mix: 0.6 }), fx('comp', { th: -20, ra: 5, mk: 4 })] });
    ins('keys', 'Keys', '#3a8fe0', { vol: -3, fx: [fx('chorus', { rate: 0.6, depth: 0.45, mix: 0.4 })] });
    ins('pad', 'Pad', '#6a5ad0', { vol: -5, fx: [fx('filter', { type: 'lowpass', f: 900, q: 1.4 })] });
    ins('lead', 'Lead', '#c04ab0', { vol: -4, pan: -0.08, fx: [fx('eq', { mg: 2, mf: 2500 })] });
    ins('stab', 'Stab', '#d0405a', { vol: -6, pan: 0.2 });
    ins('rev', 'Reverb Bus', '#8a9aa8', { fx: [fx('reverb', { size: 2.4, damp: 5200, pre: 0.025, mix: 1 })] });
    ins('dly', 'Delay Bus', '#8a9aa8', { vol: -4, fx: [fx('delay', { time: 0.75, fb: 0.42, tone: 4200, pp: true, mix: 1 }), fx('eq', { lg: -10, lf: 300 })] });
    prj.mixer.master.fx = [fx('comp', { th: -10, ra: 2.5, kn: 10, at: 0.01, re: 0.2, mk: 1.5 })]; prj.mixer.master.vol = -2;
    const send = (k, to, amt) => I[k].sends.push({ to: I[to].id, amt });
    send('snare', 'rev', -8); send('keys', 'rev', -6); send('pad', 'rev', -4); send('lead', 'rev', -9); send('lead', 'dly', -7); send('stab', 'dly', -6); send('stab', 'rev', -10); send('hats', 'rev', -18);
    const ch = {}; const add = (k, type, name, out, o = {}) => { ch[k] = C.newChannel(type, { name, out: I[out].id, color: I[out].color, ...o }); prj.channels.push(ch[k]); return ch[k]; };
    add('kick', 'drum', 'Kick', 'kick', { params: { kind: 'kick', tone: 0.45, snap: 0.55, decay: 1.25, drive: 0.15 } });
    add('clap', 'drum', 'Clap', 'snare', { params: { kind: 'clap', tone: 0.5, snap: 0.6 }, vol: -2 });
    add('snare', 'drum', 'Snare', 'snare', { params: { kind: 'snare', tone: 0.55, snap: 0.6 }, vol: -4 });
    add('hat', 'drum', 'Closed hat', 'hats', { params: { kind: 'hat', choke: 1, tone: 0.6, decay: 0.9 }, vol: -6 });
    add('ohat', 'drum', 'Open hat', 'hats', { params: { kind: 'ohat', choke: 1, tone: 0.5, decay: 1.1 }, vol: -8 });
    add('bass', 'sub', 'Bass', 'bass', { params: { ...App.PRESETS.sub['Deep bass'] } });
    add('keys', 'fm', 'E-Piano', 'keys', { params: { ...App.PRESETS.fm['Electric piano'] } });
    add('pad', 'sub', 'Pad', 'pad', { params: { ...App.PRESETS.sub['Soft pad'] } });
    add('lead', 'sub', 'Lead', 'lead', { params: { ...App.PRESETS.sub['Supersaw lead'], glide: 0.04 } });
    const stab = stabSample(), sid = C.uid(); App.samples = { [sid]: { name: 'Chord stab.wav', b64: C.b64encode(stab) } }; Engine.buffers.clear();
    await Engine.loadSample(sid, stab);
    add('stab', 'sampler', 'Chord stab', 'stab', { sample: sid, params: { root: 57, aR: 0.15, cut: 9000 } });
    const S = C.STEP, B = 384, steps = (k, list, v = 100, d = S, p = 60) => list.map((s, i) => ({ t: s * S, d, p, v: Array.isArray(v) ? v[i % v.length] : v }));
    const pat = (name, color, bars, notes) => { const p = C.newPattern(name, { color, bars }); for (const [k, n] of Object.entries(notes)) p.notes[ch[k].id] = C.sortNotes(n); prj.patterns.push(p); return p; };
    const dA = pat('Drums A', '#e8693a', 1, { kick: steps('kick', [0, 4, 8, 12], 115), clap: steps('clap', [4, 12], 105), hat: steps('hat', [2, 6, 10, 14, 1, 5, 9, 13, 3, 7, 11], [100, 96, 104, 92, 50, 46, 54, 48, 62, 58, 60]), ohat: steps('ohat', [15], 80) });
    const dB = pat('Drums B (fill)', '#d0405a', 1, { kick: steps('kick', [0, 4, 8, 10], 115), clap: steps('clap', [4], 105), snare: steps('snare', [12, 13, 14, 15], [70, 84, 98, 118]), hat: steps('hat', [2, 6, 10], 96), ohat: steps('ohat', [14], 70) });
    const prog = [[45, [57, 60, 64]], [41, [57, 60, 65]], [48, [55, 60, 64]], [43, [55, 59, 62]]];   // Am F C G
    const bassN = [], keysN = [], padN = [], stabN = [];
    prog.forEach(([r, ch3], bar) => {
      const o = bar * B;
      [[0, 0, 92], [2, 0, 104], [6, 0, 100], [10, 12, 112], [14, 0, 100]].forEach(([st, oc, v]) => bassN.push({ t: o + st * S, d: 38, p: r + oc, v }));
      [[0, 36], [6, 20], [10, 20], [14, 10]].forEach(([st, d]) => ch3.forEach(p => keysN.push({ t: o + st * S, d: d * 4, p, v: st ? 76 : 88 })));
      ch3.forEach(p => padN.push({ t: o, d: B - 6, p: p - 12, v: 80 }));
      [3, 11].forEach(st => stabN.push({ t: o + st * S, d: S * 2, p: 57, v: 96 }));
    });
    const melody = [[0, 69, 6], [6, 72, 2], [8, 71, 4], [12, 69, 4], [16, 67, 6], [22, 69, 2], [24, 64, 8], [32, 69, 4], [36, 72, 4], [40, 76, 6], [46, 74, 2], [48, 72, 8], [56, 71, 4], [60, 67, 4]];
    const leadN = melody.map(([s, p, l], i) => ({ t: s * S, d: l * S - 4, p, v: 92 + (i % 3) * 10 }));
    const pB = pat('Bassline', '#2aa38f', 4, { bass: bassN });
    const pK = pat('Keys', '#3a8fe0', 4, { keys: keysN });
    const pP = pat('Pad', '#6a5ad0', 4, { pad: padN });
    const pL = pat('Lead', '#c04ab0', 4, { lead: leadN });
    const pS = pat('Stabs', '#d0405a', 4, { stab: stabN });
    prj.playlist.tracks = ['Drums', 'Bass', 'Keys', 'Pad', 'Lead', 'Stabs'].map(n => ({ id: C.uid(), name: n, mute: false }));
    const T = prj.playlist.tracks, clip = (p, ti, bar, bars) => prj.playlist.clips.push({ id: C.uid(), pat: p.id, track: T[ti].id, start: bar * B, len: bars * B, off: 0 });
    clip(dA, 0, 4, 7); clip(dB, 0, 11, 1); clip(dA, 0, 12, 3); clip(dB, 0, 15, 1);
    clip(pB, 1, 4, 4); clip(pB, 1, 8, 4); clip(pB, 1, 12, 4);
    clip(pK, 2, 0, 4); clip(pK, 2, 4, 4); clip(pK, 2, 8, 4); clip(pK, 2, 12, 4);
    clip(pP, 3, 0, 4); clip(pP, 3, 4, 4); clip(pP, 3, 8, 4); clip(pP, 3, 12, 4);
    clip(pL, 4, 8, 4); clip(pL, 4, 12, 4);
    clip(pS, 5, 12, 4);
    const pf = I.pad.fx[0];
    prj.automation.push({ id: C.uid(), target: `fx:${I.pad.id}:${pf.id}:f`, on: true, points: [{ t: 0, v: 0.3 }, { t: 4 * B, v: 0.78 }, { t: 12 * B, v: 0.72 }, { t: 16 * B, v: 0.42 }] });
    prj.automation.push({ id: C.uid(), target: `ins:${I.lead.id}:send:${I.dly.id}`, on: true, points: [{ t: 8 * B, v: 0.62 }, { t: 12 * B, v: 0.86 }, { t: 15 * B, v: 0.9 }, { t: 16 * B, v: 0.7 }] });
    App.file = null;
    setProject(prj, 'Open Sample Song', prj.name);
    App.sel.pat = dA.id; App.sel.ch = ch.bass.id; App.sel.ins = I.bass.id; App.sel.fx = I.bass.fx[0].id; Engine.patId = dA.id;
    App.mode = Engine.mode = 'song'; App.refresh(); hideWelcome();
  }
  App.openSample = openSample;

  /* ================= edit commands routed to the focused editor ================= */
  const ed = () => App.focus === 'pl' ? App.views.pl.cmd : App.view === 'roll' ? App.views.roll.cmd : null;
  const editCmd = k => () => { const e = ed(); if (e && e[k]) e[k](); };
  document.querySelector('#ed').addEventListener('pointerdown', () => { App.focus = App.view; }, true);

  /* ================= help ================= */
  function shortcutsDialog() {
    const rows = [['Space', 'Play / stop'], ['L', 'Toggle Pattern / Song mode'], ['R', 'Arm recording'], ['Ctrl+M', 'Metronome'], ['Home', 'Song position to start'],
      ['F4', 'New pattern'], ['F5 / F6 / F7 / F9', 'Playlist / Channel Rack / Piano Roll / Mixer'], ['P, B, E, D, C', 'Draw, paint, select, erase, slice tools'],
      ['Right-click / right-drag', 'Delete notes, clips, points'], ['Shift+drag', 'Duplicate notes or clips'], ['Alt+drag', 'Move without snapping'], ['Ctrl+click', 'Add / remove from selection'],
      ['Ctrl+A / Delete', 'Select all / delete selection'], ['Ctrl+C / X / V', 'Copy / cut / paste notes'], ['Ctrl+B', 'Duplicate selection'], ['Ctrl+Q', 'Quantize'], ['↑ / ↓ (Shift)', 'Transpose semitone (octave)'], ['← / →', 'Nudge by snap'],
      ['Ctrl+wheel', 'Zoom (wheel scrolls, Shift+wheel scrolls sideways, middle-drag pans)'], ['Shift+drag ruler', 'Set loop region (double-click clears)'],
      ['Ctrl+T', 'Typing keyboard to piano (Z…/ and Q…] rows; PgUp/PgDn octave; Shift = loud)'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+S / Ctrl+Shift+S', 'Save / save as'], ['Ctrl+E', 'Export WAV'], ['Ctrl+Shift+E', 'Export MP3']];
    Aero.dialog({ title: 'Keyboard Shortcuts', noCancel: true, width: 580, html: `<table class="keys">${rows.map(r => `<tr><td><kbd>${esc(r[0])}</kbd></td><td>${esc(r[1])}</td></tr>`).join('')}</table>` });
  }
  function about() {
    Aero.dialog({ title: 'About Lumen Beats', noCancel: true, width: 480, html: `<div class="about"><img src="${ICON}" alt=""><div><h2>Lumen Beats</h2><p>Pattern-based music maker — step sequencer, piano roll, playlist, mixer and synthesizers — part of Lumen Studio.</p>
      <p class="dim">All instruments and effects are synthesized live with Web Audio: subtractive and FM synths, a drum machine without samples, a sampler, EQ, compressor, filter, delay, reverb, distortion and chorus. Sample-accurate look-ahead scheduling; offline rendering for export.</p>
      <p class="dim">MP3 export uses <b>LAME</b> via lamejs (@breezystack/lamejs 1.2.7, LGPL-3.0, shipped unmodified as a separate file — lame.sourceforge.net).</p></div></div>` });
  }

  /* ================= welcome ================= */
  function showWelcome() {
    const w = Aero.el('div', 'welcome', `<div class="wl-card"><img src="${ICON}" alt=""><h1>Lumen Beats</h1><p>Make beats and songs: step sequencer, piano roll, playlist, mixer, synths and drums.</p>
      <div class="wl-actions"><button class="aero-btn pri" data-w="sample">Open Sample Song</button><button class="aero-btn" data-w="new">New Beat</button><button class="aero-btn" data-w="open">Open…</button></div>
      <p class="dim">Drop a .lbeat project, a MIDI file or WAV/MP3 samples anywhere.</p></div>`);
    w.onclick = e => { const a = e.target.dataset.w; if (a === 'sample') openSample(); else if (a === 'new') hideWelcome(); else if (a === 'open') openDialog(); };
    $('#stage').appendChild(w);
  }
  function hideWelcome() { document.querySelector('.welcome')?.remove(); }

  /* ================= menus ================= */
  function buildMenus() {
    const chItems = App.views.rack.addChannelItems().map(it => typeof it === 'object' ? { ...it, label: it.label } : it);
    Aero.menus({
      File: [['New', 'Ctrl+N', newProject], ['Open…', 'Ctrl+O', openDialog], ['Open Sample Song', '', openSample], '-', ['Save', 'Ctrl+S', () => save(false)], ['Save As…', 'Ctrl+Shift+S', () => save(true)], '-',
        ['Import MIDI…', '', async () => { const f = await Aero.openFile({ accept: '.mid,.midi', filters: [{ name: 'MIDI', extensions: ['mid', 'midi'] }] }); if (f[0]) handleFiles(f); }],
        ['Import Sample (WAV / MP3)…', '', () => App.importSample()], '-',
        ['Export WAV…', 'Ctrl+E', () => exportDialog('wav')], ['Export MP3…', 'Ctrl+Shift+E', () => exportDialog('mp3')], ['Export MIDI…', '', exportMidi]],
      Edit: [['Undo', 'Ctrl+Z', undo], ['Redo', 'Ctrl+Y/Ctrl+Shift+Z', redo], '-', ['Cut', 'Ctrl+X', editCmd('cut')], ['Copy', 'Ctrl+C', editCmd('copy')], ['Paste', 'Ctrl+V', editCmd('paste')], ['Delete', 'Delete', editCmd('del')],
        ['Select All', 'Ctrl+A', editCmd('selectAll')], ['Duplicate', 'Ctrl+B', editCmd('duplicate')], '-', ['Quantize…', 'Ctrl+Q', () => { App.showView('roll'); App.views.roll.cmd.quantize(); }],
        { label: 'Transpose Up', key: 'ArrowUp', fn: () => App.view === 'roll' && App.focus !== 'pl' && App.views.roll.cmd.transpose(1) }, { label: 'Transpose Down', key: 'ArrowDown', fn: () => App.view === 'roll' && App.focus !== 'pl' && App.views.roll.cmd.transpose(-1) },
        { label: 'Transpose Octave Up', key: 'Shift+ArrowUp', fn: () => App.view === 'roll' && App.views.roll.cmd.transpose(12) }, { label: 'Transpose Octave Down', key: 'Shift+ArrowDown', fn: () => App.view === 'roll' && App.views.roll.cmd.transpose(-12) },
        { label: 'Nudge Left', key: 'ArrowLeft', fn: () => App.view === 'roll' && App.focus !== 'pl' && App.views.roll.cmd.nudge(-1) }, { label: 'Nudge Right', key: 'ArrowRight', fn: () => App.view === 'roll' && App.focus !== 'pl' && App.views.roll.cmd.nudge(1) }],
      Add: [...chItems, '-', ['New Pattern', 'F4', newPattern], ['Clone Pattern', '', () => App.clonePattern(App.pat)], ['Mixer Insert', '', () => { const p = App.prj, i = C.newInsert('Insert ' + (p.mixer.inserts.length + 1), { color: C.COLORS[p.mixer.inserts.length % 8] }); p.mixer.inserts.push(i); App.sel.ins = i.id; App.commit('Add insert'); App.showView('mixer'); }],
        ['Playlist Track', '', () => { const p = App.prj; p.playlist.tracks.push({ id: C.uid(), name: 'Track ' + (p.playlist.tracks.length + 1), mute: false }); App.commit('Add track', ['pl']); }], ['Automation Lane…', '', automationDialog]],
      Transport: [['Play / Stop', 'Space', togglePlay], { label: 'Pattern Mode', key: 'L', fn: () => setMode(App.mode === 'song' ? 'pattern' : 'song'), checked: () => App.mode === 'pattern' }, { label: 'Song Mode', fn: () => setMode('song'), checked: () => App.mode === 'song' },
        '-', { label: 'Record', key: 'R', fn: toggleRec, checked: () => App.recording }, { label: 'Quantize Recorded Notes', fn: () => { App.recQuant = !App.recQuant; }, checked: () => App.recQuant },
        { label: 'Metronome', key: 'Ctrl+M', fn: toggleMetro, checked: () => Engine.metronome }, '-', ['Go to Start', 'Home', () => { App.songPos = 0; App.updatePos(0); App.views.pl.draw(); if (Engine.playing && Engine.mode === 'song') Engine.play(0); }],
        ['Clear Loop Region', '', () => { App.prj.playlist.loop = null; App.commit('Clear loop', ['pl']); }], ['Tempo…', '', () => Aero.prompt('Tempo', 'Beats per minute', App.prj.bpm).then(v => { if (v != null && +v) { App.prj.bpm = C.clamp(+v, 20, 400); App.commit('Tempo'); Engine.setTempo(); } })]],
      View: [['Playlist', 'F5', () => { App.focus = 'pl'; $('#pl-tl').focus(); }], ['Channel Rack', 'F6', () => App.showView('rack')], ['Piano Roll', 'F7', () => App.showView('roll')], ['Mixer', 'F9', () => App.showView('mixer')], '-',
        ['Zoom In', 'Ctrl+=', () => App.focus === 'pl' || App.view !== 'roll' ? App.views.pl.cmd.zoom(1.3) : App.views.roll.cmd.zoom(1.3)], ['Zoom Out', 'Ctrl+-', () => App.focus === 'pl' || App.view !== 'roll' ? App.views.pl.cmd.zoom(1 / 1.3) : App.views.roll.cmd.zoom(1 / 1.3)],
        ['Zoom to Fit', 'Ctrl+0', () => { App.views.pl.cmd.fit(); App.views.roll.cmd.fit(); }], '-',
        { label: 'Follow Playhead', fn: () => { App.follow = !App.follow; }, checked: () => App.follow }, { label: 'Ghost Notes', fn: () => { App.ghosts = !App.ghosts; App.refresh(['roll']); }, checked: () => App.ghosts },
        { label: 'Bigger Playlist', fn: () => setSplit(0.62), checked: () => split > 0.55 }, { label: 'Bigger Editor', fn: () => setSplit(0.3), checked: () => split < 0.35 }],
      Options: [{ label: 'Typing Keyboard to Piano', key: 'Ctrl+T', fn: () => { App.pianoKeys = !App.pianoKeys; updateCmd(); Aero.toast(App.pianoKeys ? 'Typing keyboard plays the selected channel (Z–/ and Q–] rows; PgUp/PgDn = octave). Tool keys are off.' : 'Typing keyboard to piano off', 3600); }, checked: () => App.pianoKeys },
        { label: 'MIDI Keyboard Input', fn: enableMidi, checked: () => !!midiAccess }, { label: 'Snap to Scale in Piano Roll', fn: () => { App.scaleSnap = !App.scaleSnap; App.refresh(['roll']); }, checked: () => App.scaleSnap }],
      Help: [['Keyboard Shortcuts', 'F1', shortcutsDialog], ['About Lumen Beats', '', about]]
    });
  }
  // tool shortcuts must yield to the typing keyboard piano
  function toolKey(id) { return () => { if (!App.pianoKeys) tools.set(id); }; }

  /* ================= layout: splitter, tabs ================= */
  let split = 0.44;
  function setSplit(f) { split = C.clamp(f, 0.15, 0.85); $('#stage').style.gridTemplateRows = `${(split * 100).toFixed(2)}% 5px 1fr`; App.views.pl.draw(); }
  $('#split').onpointerdown = e => { const r = $('#stage').getBoundingClientRect(); App.drag(e, ev => setSplit((ev.clientY - r.top) / r.height)); };
  document.querySelectorAll('#ed-tabs .aero-tab').forEach(t => t.onclick = () => App.showView(t.dataset.v));
  document.querySelectorAll('#side-tabs .aero-tab').forEach(t => t.onclick = () => App.showSide(t.dataset.tab));
  $('#pl-addtrack').onclick = () => { const p = App.prj; p.playlist.tracks.push({ id: C.uid(), name: 'Track ' + (p.playlist.tracks.length + 1), mute: false }); App.commit('Add track', ['pl']); };
  $('#pl-addauto').onclick = automationDialog;
  $('#pl-loop').onclick = () => { const p = App.prj; if (p.playlist.loop) p.playlist.loop = null; else { const bt = C.barTicks(p), a = Math.floor(App.songPos / bt) * bt; p.playlist.loop = { a, b: a + 4 * bt }; } App.commit(p.playlist.loop ? 'Set loop' : 'Clear loop', ['pl']); };
  $('#pk-add').onclick = newPattern;
  $('#pl').addEventListener('pointerdown', () => { App.focus = 'pl'; }, true);

  /* ================= animation loop ================= */
  let lastPos = null;
  function frame() {
    const pos = Engine.position();
    if (pos != null) {
      App.updatePos(pos);
      if (Engine.mode === 'song' && App.follow) { const S = App.views.pl.state, w = $('#pl-tl').clientWidth; const x = (pos - S.scrollX) * S.pxt; if (x > w - 20 || x < 0) S.scrollX = Math.max(0, pos - 20 / S.pxt); }
      App.views.pl.draw(); if (App.view === 'roll') App.views.roll.draw();
      App.views.rack.tick(pos); lastPos = pos;
    } else if (lastPos != null) { lastPos = null; App.views.rack.tick(null); App.views.pl.draw(); if (App.view === 'roll') App.views.roll.draw(); }
    if (App.view === 'mixer' && Engine.ctx) App.views.mixer.tick();
    requestAnimationFrame(frame);
  }

  /* ================= init ================= */
  Aero.init({ name: 'Lumen Beats', icon: ICON, doc: 'Untitled', dropTarget: $('.aero-app'), dropText: 'Drop a .lbeat project, MIDI file or WAV / MP3 samples',
    onDropFiles: handleFiles, onSave: () => save(false) });
  tools = Aero.toolbox($('#tools'), TOOLS.map(t => ({ ...t, title: `${t.title} (${t.key})`, key: null })), id => { App.tool = id; updateCmd(); });
  TOOLS.forEach(t => Aero.shortcut(t.key, toolKey(t.id)));
  cmdbar(); buildMenus();
  Aero.shortcut('Space', togglePlay);
  tools.set('draw');
  App.prj = C.newProject(); App.sel.pat = App.prj.patterns[0].id; App.sel.ch = App.prj.channels[0].id;
  setProject(App.prj, 'New project', 'Untitled');
  setSplit(split);
  App.showView('rack'); App.showSide('inst');
  showWelcome();
  App.setStatus('st-audio', 'Audio starts on first play'); App.setStatus('st-midi', 'MIDI off');
  requestAnimationFrame(frame);
  window.LumenBeats = { App, Engine, Render, Core, Midi, Wav, openSample, handleFiles, doExport, projectBytes, setMode, play, stop, undo, redo };
})();
