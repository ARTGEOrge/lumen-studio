'use strict';
/* Lumen Sound — real-time effects rack.
   A rack is {on, slots:[{id, type, on, p}]}. The same WebAudio graph (AudioWorklet DSP from rack-worklet.js,
   plus a ConvolverNode reverb) runs live during playback and offline (OfflineAudioContext) for Apply,
   batch processing and multitrack mixdown, so the rendered result matches what was heard. */
window.Rack = (() => {
  const { clamp, uid, el, esc } = Aero;
  const dbf = v => (v > 0 ? '+' : '') + (+v).toFixed(1) + ' dB';
  const msf = v => (+v >= 100 ? Math.round(v) : (+v).toFixed(1)) + ' ms';
  const pct = v => Math.round(v) + ' %';
  const hz = v => v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + ' kHz' : Math.round(v) + ' Hz';
  const R = (key, label, min, max, step, value, fmt, log) => ({ key, label, type: 'range', min, max, step, value, fmt, log });
  const C = (key, label, value) => ({ key, label, type: 'checkbox', value });
  const S = (key, label, value, options) => ({ key, label, type: 'select', value, options });

  /* ---------- effect types ---------- */
  const TYPES = {
    eq: { name: 'Parametric EQ', color: '#4dabf7', fields: [
      C('hp', 'Low cut', true), R('hpF', 'Low cut freq', 20, 1000, 1, 80, hz, true),
      R('lsG', 'Low shelf', -18, 18, 0.5, 0, dbf), R('lsF', 'Low shelf freq', 40, 600, 1, 150, hz, true),
      R('midG', 'Bell gain', -18, 18, 0.5, 0, dbf), R('midF', 'Bell freq', 100, 12000, 1, 1000, hz, true), R('midQ', 'Bell Q', 0.2, 10, 0.05, 1, v => (+v).toFixed(2), true),
      R('hsG', 'High shelf', -18, 18, 0.5, 0, dbf), R('hsF', 'High shelf freq', 1500, 16000, 10, 8000, hz, true),
      C('lp', 'High cut', false), R('lpF', 'High cut freq', 2000, 20000, 10, 18000, hz, true), R('out', 'Output', -18, 18, 0.5, 0, dbf)] },
    comp: { name: 'Compressor', color: '#ffd43b', fields: [
      R('threshold', 'Threshold', -60, 0, 0.5, -20, dbf), R('ratio', 'Ratio', 1, 20, 0.1, 3, v => (+v).toFixed(1) + ':1'), R('knee', 'Knee', 0, 24, 0.5, 6, dbf),
      R('attack', 'Attack', 0.1, 200, 0.1, 5, msf, true), R('release', 'Release', 5, 2000, 1, 120, msf, true), R('makeup', 'Make-up gain', 0, 24, 0.5, 4, dbf),
      S('detector', 'Detector', 'peak', [['peak', 'Peak'], ['rms', 'RMS 10 ms']])] },
    limit: { name: 'Hard Limiter', color: '#ff6b6b', fields: [
      R('gain', 'Input boost', 0, 24, 0.5, 0, dbf), R('ceiling', 'Ceiling', -12, 0, 0.1, -1, v => (+v).toFixed(1) + ' dBFS'), R('release', 'Release', 10, 1000, 1, 80, msf, true), R('lookahead', 'Look-ahead', 1, 10, 0.5, 5, msf)] },
    gate: { name: 'Noise Gate', color: '#69db7c', fields: [
      R('threshold', 'Open threshold', -80, 0, 0.5, -40, dbf), R('hysteresis', 'Hysteresis', 0, 20, 0.5, 4, dbf), R('attack', 'Attack', 0.1, 50, 0.1, 1, msf, true),
      R('hold', 'Hold', 0, 500, 1, 40, msf), R('release', 'Release', 5, 2000, 1, 150, msf, true), R('range', 'Range', 3, 90, 1, 60, v => '−' + v + ' dB')] },
    reverb: { name: 'Reverb', color: '#9775fa', fields: [
      S('type', 'Space', 'hall', [['room', 'Room'], ['hall', 'Concert hall'], ['plate', 'Plate']]), R('decay', 'Decay (RT60)', 0.2, 8, 0.05, 2.6, v => (+v).toFixed(2) + ' s'),
      R('predelay', 'Pre-delay', 0, 200, 1, 22, msf), R('damping', 'HF damping', 1000, 16000, 100, 4500, hz, true), R('wet', 'Wet', 0, 100, 1, 30, pct), R('dry', 'Dry', 0, 100, 1, 100, pct)] },
    delay: { name: 'Delay / Echo', color: '#3bc9db', fields: [
      R('time', 'Delay time', 20, 2000, 1, 320, msf, true), R('feedback', 'Feedback', 0, 95, 1, 40, pct), R('mix', 'Echo level', 0, 100, 1, 40, pct),
      R('dry', 'Dry level', 0, 100, 1, 100, pct), R('damp', 'Echo tone', 500, 20000, 100, 6000, hz, true), C('pingpong', 'Ping-pong', false)] },
    chorus: { name: 'Chorus / Flanger', color: '#f783ac', fields: [
      R('delay', 'Delay', 0.5, 40, 0.1, 18, msf), R('depth', 'Depth', 0, 20, 0.1, 6, msf), R('rate', 'Rate', 0.05, 10, 0.05, 0.8, v => (+v).toFixed(2) + ' Hz', true),
      R('feedback', 'Feedback', -90, 90, 1, 0, pct), R('voices', 'Voices', 1, 6, 1, 3, v => String(v)), R('spread', 'Stereo spread', 0, 180, 1, 90, v => v + '°'), R('mix', 'Mix', 0, 100, 1, 50, pct)] },
    dist: { name: 'Distortion', color: '#ffa94d', fields: [
      S('type', 'Type', 'tube', [['soft', 'Soft clip'], ['tube', 'Tube'], ['hard', 'Hard clip'], ['fold', 'Wave folder'], ['crush', 'Bit crusher']]),
      R('drive', 'Drive', 0, 40, 0.5, 14, dbf), R('tone', 'Tone', 500, 20000, 100, 7000, hz, true), R('bits', 'Bits (crusher)', 2, 16, 1, 6, v => String(v)),
      R('downsample', 'Sample hold', 1, 32, 1, 4, v => '÷' + v), R('mix', 'Mix', 0, 100, 1, 100, pct), R('output', 'Output', -24, 6, 0.5, -6, dbf)] }
  };
  const ORDER = ['eq', 'comp', 'limit', 'gate', 'reverb', 'delay', 'chorus', 'dist'];
  const defaults = type => Object.fromEntries(TYPES[type].fields.map(f => [f.key, f.value]));
  function sanitizeParams(type, p) {
    const o = {}; p = p && typeof p === 'object' ? p : {};
    for (const f of TYPES[type].fields) {
      const v = p[f.key];
      if (f.type === 'range') o[f.key] = Number.isFinite(+v) && v !== null && v !== '' ? clamp(+v, f.min, f.max) : f.value;
      else if (f.type === 'checkbox') o[f.key] = v == null ? f.value : !!v;
      else o[f.key] = f.options.some(x => x[0] === v) ? v : f.value;
    }
    return o;
  }
  const newSlot = (type, p) => ({ id: uid(), type, on: true, p: sanitizeParams(type, { ...defaults(type), ...(p || {}) }) });
  const empty = () => ({ on: true, slots: [] });
  function sanitize(r) {
    if (!r || typeof r !== 'object') return empty();
    const slots = (Array.isArray(r.slots) ? r.slots : []).filter(s => s && TYPES[s.type]).slice(0, 16).map(s => ({ id: uid(), type: s.type, on: s.on !== false, p: sanitizeParams(s.type, s.p) }));
    return { on: r.on !== false, slots };
  }
  const clone = r => JSON.parse(JSON.stringify(r || empty()));
  const active = r => !!r && r.on !== false && r.slots.some(s => s.on);
  function eqBands(p) {
    return [{ type: 'highpass', f: p.hpF, q: 0.7071, slope: 24, on: !!p.hp }, { type: 'lowshelf', f: p.lsF, q: 0.7, gain: p.lsG, on: Math.abs(p.lsG) > 0.01 },
      { type: 'peaking', f: p.midF, q: p.midQ, gain: p.midG, on: Math.abs(p.midG) > 0.01 }, { type: 'highshelf', f: p.hsF, q: 0.7, gain: p.hsG, on: Math.abs(p.hsG) > 0.01 },
      { type: 'lowpass', f: p.lpF, q: 0.7071, slope: 24, on: !!p.lp }];
  }
  function workletParams(type, p, sr) {
    if (type === 'eq') return { coefs: DSP.eqCoefs(eqBands(p), sr), gain: DSP.dbToLin(p.out || 0) };
    return { ...p };
  }
  // latency (samples) introduced by a rack (look-ahead limiters)
  const latency = (r, sr) => active(r) ? r.slots.filter(s => s.on && s.type === 'limit').reduce((a, s) => a + Math.max(1, Math.round(sr * s.p.lookahead / 1000)) - 1, 0) : 0;

  /* ---------- worklet module per context ---------- */
  const loaded = new WeakMap(), ready = new WeakSet();
  function load(ctx) {
    let p = loaded.get(ctx);
    if (!p) { p = ctx.audioWorklet.addModule(new URL('js/rack-worklet.js', document.baseURI).href).then(() => { ready.add(ctx); }); loaded.set(ctx, p); }
    return p;
  }

  /* ---------- node graph ---------- */
  const grMeter = new Map(); // slot id → gain reduction dB (live)
  function reverbNode(ctx) {
    const inp = ctx.createGain(), out = ctx.createGain(), conv = ctx.createConvolver(), wet = ctx.createGain(), dry = ctx.createGain();
    conv.normalize = false; inp.connect(conv); conv.connect(wet); wet.connect(out); inp.connect(dry); dry.connect(out);
    let key = '';
    return { in: inp, out, set(p) {
      const k = [p.type, p.decay, p.predelay, p.damping].join('|');
      if (k !== key) { key = k; const ir = DSP.impulseResponse(p.type, ctx.sampleRate, { decay: p.decay, predelay: p.predelay, damping: p.damping }); const b = ctx.createBuffer(2, ir[0].length, ctx.sampleRate); b.copyToChannel(ir[0], 0); b.copyToChannel(ir[1], 1); conv.buffer = b; }
      wet.gain.value = p.wet / 100 * 1.6; dry.gain.value = p.dry / 100;
    }, dispose() { [inp, out, conv, wet, dry].forEach(n => { try { n.disconnect(); } catch (e) { /* */ } }); } };
  }
  function makeNode(ctx, slot, nch) {
    if (slot.type === 'reverb') return reverbNode(ctx);
    const node = new AudioWorkletNode(ctx, 'lumen-fx', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [nch], channelCount: nch, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      processorOptions: { kind: slot.type, params: workletParams(slot.type, slot.p, ctx.sampleRate) } });
    const id = slot.id;
    if (!(ctx instanceof OfflineAudioContext)) node.port.onmessage = e => { if (e.data && e.data.gr != null) grMeter.set(id, e.data.gr); };
    let last = JSON.stringify(slot.p);
    return { in: node, out: node, set(p) { const k = JSON.stringify(p); if (k === last) return; last = k; node.port.postMessage({ params: workletParams(slot.type, p, ctx.sampleRate) }); },
      dispose() { try { node.disconnect(); } catch (e) { /* */ } node.port.onmessage = null; } };
  }
  /* A chain of effect nodes between `input` and `output` gain nodes. update(rack) can be called any time (live edits). */
  function createChain(ctx, rack, nch = 2) {
    const input = ctx.createGain(), output = ctx.createGain(), nodes = new Map();
    let sig = null, cur = rack, disposed = false;
    const chain = {
      input, output,
      update(r) {
        if (disposed) return; cur = r || empty();
        const ok = ready.has(ctx);
        for (const [id, nd] of nodes) if (!cur.slots.some(s => s.id === id && s.type === nd.type)) { nd.dispose(); nodes.delete(id); }
        for (const s of cur.slots) {
          let nd = nodes.get(s.id);
          if (!nd && (ok || s.type === 'reverb')) { try { nd = makeNode(ctx, s, nch); nd.type = s.type; nodes.set(s.id, nd); } catch (e) { console.warn('rack node', e); } }
          if (nd) nd.set(s.p);
        }
        const want = cur.on !== false ? cur.slots.filter(s => s.on && nodes.has(s.id)).map(s => s.id) : [];
        const k = want.join(',');
        if (k === sig) return; sig = k;
        try { input.disconnect(); } catch (e) { /* */ }
        nodes.forEach(nd => { try { nd.out.disconnect(); } catch (e) { /* */ } });
        let prev = input; for (const id of want) { const nd = nodes.get(id); prev.connect(nd.in); prev = nd.out; }
        prev.connect(output);
      },
      dispose() { disposed = true; nodes.forEach(nd => nd.dispose()); nodes.clear(); try { input.disconnect(); output.disconnect(); } catch (e) { /* */ } }
    };
    chain.update(rack);
    if (!ready.has(ctx)) load(ctx).then(() => { sig = null; chain.update(cur); }).catch(e => console.warn('Effects rack worklet failed to load', e));
    return chain;
  }
  /* Offline render of chs (Float32Array[]) through a rack. Output has the same length (latency compensated). */
  async function render(rack, chs, sr) {
    const n = chs[0].length, nch = chs.length;
    if (!active(rack) || !n) return chs.map(c => c.slice());
    const lat = latency(rack, sr), ctx = new OfflineAudioContext(nch, n + lat, sr);
    await load(ctx);
    const buf = ctx.createBuffer(nch, n, sr); chs.forEach((c, i) => buf.copyToChannel(c, i));
    const src = ctx.createBufferSource(); src.buffer = buf;
    const ch = createChain(ctx, rack, nch); src.connect(ch.input); ch.output.connect(ctx.destination); src.start();
    const r = await ctx.startRendering();
    return chs.map((_, i) => r.getChannelData(i).slice(lat, lat + n));
  }

  /* ---------- presets ---------- */
  const P = (type, p) => ({ type, on: true, p });
  const BUILTIN = {
    'Podcast Voice': [P('eq', { hp: true, hpF: 80, lsG: -2, lsF: 160, midG: -3, midF: 320, midQ: 1.2, hsG: 3, hsF: 7500 }), P('gate', { threshold: -48, range: 14, release: 220, hold: 80 }), P('comp', { threshold: -24, ratio: 3, knee: 6, attack: 6, release: 140, makeup: 6 }), P('limit', { gain: 0, ceiling: -1 })],
    'Radio Announcer': [P('eq', { hp: true, hpF: 100, lsG: 3, lsF: 140, midG: 4, midF: 2800, midQ: 1, hsG: 2, hsF: 9000 }), P('comp', { threshold: -30, ratio: 6, knee: 3, attack: 2, release: 90, makeup: 10 }), P('limit', { gain: 2, ceiling: -1 })],
    'Telephone': [P('eq', { hp: true, hpF: 400, midG: 5, midF: 1800, midQ: 1.4, lp: true, lpF: 3200 }), P('dist', { type: 'soft', drive: 8, tone: 3500, mix: 35, output: -3 })],
    'Concert Hall': [P('reverb', { type: 'hall', decay: 2.8, wet: 35, dry: 100 })],
    'Slapback Echo': [P('delay', { time: 110, feedback: 12, mix: 35 })],
    'Lo-fi Crush': [P('dist', { type: 'crush', bits: 8, downsample: 4, mix: 70, output: -3 }), P('eq', { hp: true, hpF: 150, lp: true, lpF: 6000 })],
    'Mastering Glue': [P('comp', { threshold: -14, ratio: 2, knee: 10, attack: 20, release: 250, makeup: 2 }), P('limit', { gain: 3, ceiling: -1 })],
    'Reverb Bus (100% wet)': [P('reverb', { type: 'hall', decay: 2.4, predelay: 25, wet: 100, dry: 0 })]
  };
  const fromPreset = slots => ({ on: true, slots: slots.map(s => newSlot(s.type, s.p)).map((s, i) => ({ ...s, on: slots[i].on !== false })) });
  const LS = 'lumen-sound-rack-presets';
  function userPresets() { try { const o = JSON.parse(localStorage.getItem(LS) || '{}'); return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; } }
  function saveUserPresets(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { /* */ } }
  function allPresets() { const u = userPresets(); return { ...BUILTIN, ...Object.fromEntries(Object.entries(u).map(([k, v]) => [k, (Array.isArray(v) ? v : []).filter(s => s && TYPES[s.type])])) }; }
  const presetRack = name => { const p = allPresets()[name]; return p ? fromPreset(p) : null; };
  const toPreset = r => r.slots.map(s => ({ type: s.type, on: s.on, p: { ...s.p } }));

  /* ---------- side panel UI ---------- */
  let root, selSlot = null, getTarget = () => null;
  function popMenu(anchor, items) {
    document.querySelectorAll('.rk-pop').forEach(p => p.remove());
    const m = el('div', 'aero-dropdown rk-pop'), r = anchor.getBoundingClientRect();
    items.forEach(it => {
      if (it === '-') return m.appendChild(el('div', 'aero-msep'));
      if (typeof it === 'string') return m.appendChild(el('div', 'aero-mhead', esc(it)));
      const mi = el('div', 'aero-mi' + (it.disabled ? ' disabled' : ''), `<span></span><span class="k"></span>`); mi.firstChild.textContent = it.label; mi.lastChild.textContent = it.key || '';
      mi.onclick = e => { e.stopPropagation(); m.remove(); it.fn(); }; m.appendChild(mi);
    });
    document.body.appendChild(m);
    const h = m.offsetHeight, w = m.offsetWidth;
    m.style.left = Math.max(4, Math.min(innerWidth - w - 4, r.left)) + 'px'; m.style.top = (r.bottom + h > innerHeight - 4 ? Math.max(4, r.top - h) : r.bottom) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', function off(e) { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } }, true), 0);
    return m;
  }
  const ICON = {
    add: '<circle cx="8" cy="8" r="6.3" fill="url(#gGreen)" stroke="#2a6a14"/><path d="M8 4.8v6.4M4.8 8h6.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>',
    up: '<path d="M8 3 3 9h3.2v4h3.6V9H13z" fill="url(#gBlue)" stroke="#174a85" stroke-linejoin="round"/>',
    down: '<path d="M8 13 3 7h3.2V3h3.6v4H13z" fill="url(#gBlue)" stroke="#174a85" stroke-linejoin="round"/>',
    del: '<circle cx="8" cy="8" r="6.3" fill="url(#gRed)" stroke="#8a1a10"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>',
    preset: '<rect x="2" y="2.5" width="12" height="11" rx="1.5" fill="url(#gPaper)" stroke="#5a7ea6"/><path d="M4.5 5.5h7M4.5 8h7M4.5 10.5h4.5" stroke="#3a6ea8" stroke-width="1.1"/>'
  };
  function init(container, targetFn) {
    root = container; getTarget = targetFn;
    root.innerHTML = `<div class="aero-ph"><span class="phi" style="background:linear-gradient(#e0c8ff,#8a5ae0)"></span><span class="rk-title">Effects Rack</span><span class="right"><label class="rk-power" title="Rack power (bypass all)"><input type="checkbox" data-power> On</label></span></div>
      <div class="aero-list rk-list" data-list></div>
      <div class="aero-iconbar">
        <button class="aero-iconbtn" data-add title="Add effect"><svg viewBox="0 0 16 16">${ICON.add}</svg></button>
        <button class="aero-iconbtn" data-up title="Move up"><svg viewBox="0 0 16 16">${ICON.up}</svg></button>
        <button class="aero-iconbtn" data-down title="Move down"><svg viewBox="0 0 16 16">${ICON.down}</svg></button>
        <button class="aero-iconbtn" data-presets title="Presets"><svg viewBox="0 0 16 16">${ICON.preset}</svg></button>
        <span style="flex:1"></span>
        <button class="aero-iconbtn" data-del title="Remove effect"><svg viewBox="0 0 16 16">${ICON.del}</svg></button>
      </div>
      <div class="rk-edit" data-edit></div>
      <div class="rk-foot" data-foot></div>`;
    const q = s => root.querySelector(s);
    q('[data-power]').onchange = e => { const t = getTarget(); if (!t) return; t.rack.on = e.target.checked; t.changed(e.target.checked ? 'Rack On' : 'Rack Bypass', true); refresh(); };
    q('[data-add]').onclick = e => { const t = getTarget(); if (!t) return Aero.toast('Nothing to add effects to'); popMenu(e.currentTarget, ['Add effect', ...ORDER.map(k => ({ label: TYPES[k].name, fn: () => add(k) }))]); };
    q('[data-up]').onclick = () => move(-1); q('[data-down]').onclick = () => move(1);
    q('[data-del]').onclick = () => remove();
    q('[data-presets]').onclick = e => presetMenu(e.currentTarget);
    refresh();
  }
  function add(type) {
    const t = getTarget(); if (!t) return;
    if (t.rack.slots.length >= 16) return Aero.toast('A rack holds up to 16 effects');
    const s = newSlot(type); t.rack.slots.push(s); selSlot = s.id; t.changed('Add ' + TYPES[type].name, true); refresh();
  }
  function move(d) {
    const t = getTarget(); if (!t) return; const i = t.rack.slots.findIndex(s => s.id === selSlot), j = i + d;
    if (i < 0 || j < 0 || j >= t.rack.slots.length) return;
    const a = t.rack.slots; [a[i], a[j]] = [a[j], a[i]]; t.changed('Reorder Effects', true); refresh();
  }
  function remove() {
    const t = getTarget(); if (!t) return; const i = t.rack.slots.findIndex(s => s.id === selSlot); if (i < 0) return Aero.toast('Select an effect first');
    const s = t.rack.slots.splice(i, 1)[0]; selSlot = t.rack.slots[Math.min(i, t.rack.slots.length - 1)]?.id || null; t.changed('Remove ' + TYPES[s.type].name, true); refresh();
  }
  function loadPreset(name) {
    const t = getTarget(); if (!t) return; const r = presetRack(name); if (!r) return;
    t.rack.on = true; t.rack.slots = r.slots; selSlot = r.slots[0]?.id || null; t.changed('Rack Preset: ' + name, true); refresh(); Aero.toast('Loaded preset “' + name + '”');
  }
  function presetMenu(anchor) {
    const t = getTarget(), u = userPresets();
    const items = ['Built-in presets', ...Object.keys(BUILTIN).map(n => ({ label: n, fn: () => loadPreset(n) }))];
    if (Object.keys(u).length) items.push('-', 'My presets', ...Object.keys(u).map(n => ({ label: n, fn: () => loadPreset(n) })));
    items.push('-', { label: 'Save Rack as Preset…', disabled: !t || !t.rack.slots.length, fn: savePresetDialog }, { label: 'Delete My Preset…', disabled: !Object.keys(u).length, fn: deletePresetDialog },
      { label: 'Export Rack Preset (.lsfx)…', disabled: !t || !t.rack.slots.length, fn: exportPreset }, { label: 'Import Rack Preset (.lsfx)…', fn: importPreset }, '-',
      { label: 'Clear Rack', disabled: !t || !t.rack.slots.length, fn: () => { t.rack.slots = []; selSlot = null; t.changed('Clear Rack', true); refresh(); } });
    popMenu(anchor, items);
  }
  async function savePresetDialog() {
    const t = getTarget(); if (!t) return;
    const name = await Aero.prompt('Save Rack Preset', 'Preset name', 'My Rack'); if (name == null) return;
    const n = String(name).trim().slice(0, 60); if (!n) return;
    if (BUILTIN[n]) return Aero.alert('Save Rack Preset', 'That name is used by a built-in preset. Choose another name.');
    const u = userPresets(); u[n] = toPreset(t.rack); saveUserPresets(u); Aero.toast('Saved preset “' + n + '”');
  }
  function deletePresetDialog() {
    const u = userPresets(), names = Object.keys(u); if (!names.length) return;
    Aero.dialog({ title: 'Delete Rack Preset', fields: [{ key: 'n', label: 'Preset', type: 'select', value: names[0], options: names }], ok: 'Delete', onOK: v => { delete u[v.n]; saveUserPresets(u); Aero.toast('Deleted preset “' + v.n + '”'); } });
  }
  async function exportPreset() {
    const t = getTarget(); if (!t) return;
    const data = JSON.stringify({ format: 'lumen-sound-rack', version: 1, slots: toPreset(t.rack) }, null, 1);
    await Aero.saveFile({ name: (t.label || 'rack') + '.lsfx', data, filters: [{ name: 'Lumen Sound rack preset', extensions: ['lsfx'] }] });
  }
  async function importPreset() {
    const fs = await Aero.openFile({ accept: '.lsfx,.json', filters: [{ name: 'Rack preset', extensions: ['lsfx', 'json'] }] }); if (!fs.length) return;
    try {
      const o = JSON.parse(new TextDecoder().decode(fs[0].data));
      if (o.format !== 'lumen-sound-rack' || !Array.isArray(o.slots)) throw new Error('Not a Lumen Sound rack preset');
      const r = sanitize({ on: true, slots: o.slots }); const name = Aero.baseName(fs[0].name).slice(0, 60) || 'Imported';
      const u = userPresets(); u[name] = toPreset(r); saveUserPresets(u);
      const t = getTarget(); if (t) { t.rack.on = true; t.rack.slots = r.slots; selSlot = r.slots[0]?.id || null; t.changed('Import Rack Preset', true); refresh(); }
      Aero.toast('Imported preset “' + name + '”');
    } catch (e) { Aero.alert('Import Rack Preset', 'This file could not be imported: ' + e.message); }
  }
  /* slider ↔ value with optional log mapping */
  const toPos = (f, v) => f.log ? Math.log(v / f.min) / Math.log(f.max / f.min) * 1000 : v;
  const fromPos = (f, x) => { if (!f.log) return +x; const v = f.min * Math.pow(f.max / f.min, x / 1000); const st = f.step || 1; return clamp(Math.round(v / st) * st, f.min, f.max); };
  function refresh() {
    if (!root) return;
    const t = getTarget(), q = s => root.querySelector(s), list = q('[data-list]');
    q('.rk-title').textContent = t ? 'Effects Rack · ' + t.label : 'Effects Rack';
    q('[data-power]').checked = !!t && t.rack.on !== false; q('[data-power]').disabled = !t;
    list.innerHTML = '';
    if (!t) { list.appendChild(el('div', 'dim rk-empty', 'Open a file (or select a track in Multitrack) to build an effects rack.')); q('[data-edit]').innerHTML = ''; q('[data-foot]').innerHTML = ''; return; }
    if (t.unsupported) { list.appendChild(el('div', 'dim rk-empty', t.unsupported)); q('[data-edit]').innerHTML = ''; q('[data-foot]').innerHTML = ''; return; }
    if (!t.rack.slots.some(s => s.id === selSlot)) selSlot = t.rack.slots[0]?.id || null;
    if (!t.rack.slots.length) list.appendChild(el('div', 'dim rk-empty', 'No effects. Click + to add EQ, dynamics, reverb, delay… They run live during playback; Presets ▸ loads a ready-made chain.'));
    t.rack.slots.forEach((s, i) => {
      const it = el('div', 'aero-item rk-slot' + (s.id === selSlot ? ' sel' : '') + (s.on && t.rack.on !== false ? '' : ' off'), `<input type="checkbox" title="Effect on/off"><span class="rk-n">${i + 1}</span><span class="rk-sw"></span><span class="grow"></span><span class="rk-gr mono dim"></span>`);
      it.querySelector('.rk-sw').style.background = TYPES[s.type].color; it.querySelector('.grow').textContent = TYPES[s.type].name; it.dataset.id = s.id;
      const cb = it.querySelector('input'); cb.checked = s.on;
      cb.onclick = e => e.stopPropagation();
      cb.onchange = () => { s.on = cb.checked; t.changed((s.on ? 'Enable ' : 'Bypass ') + TYPES[s.type].name, true); refresh(); };
      it.onclick = () => { selSlot = s.id; refresh(); };
      list.appendChild(it);
    });
    renderEditor(t);
    const foot = q('[data-foot]'); foot.innerHTML = '';
    if (t.apply) {
      const b = el('button', 'aero-btn pri small', esc(t.applyLabel || 'Apply')); b.dataset.apply = '1'; b.disabled = !active(t.rack); b.onclick = () => t.apply();
      const pl = el('button', 'aero-btn small', '▶ Play / Stop'); pl.onclick = () => App.transport.playStop();
      foot.append(pl, b, el('span', 'dim rk-hint', 'Live during playback'));
    } else foot.appendChild(el('span', 'dim rk-hint', t.hint || 'Runs live during playback and in the mixdown.'));
  }
  function renderEditor(t) {
    const box = root.querySelector('[data-edit]'); box.innerHTML = '';
    const s = t.rack.slots.find(x => x.id === selSlot); if (!s) return;
    const T = TYPES[s.type];
    box.appendChild(el('div', 'rk-eh', `<span class="rk-sw" style="background:${T.color}"></span><b>${esc(T.name)}</b><button class="aero-btn small" data-reset title="Reset to defaults">Reset</button>`));
    if (s.type === 'eq') { const c = el('canvas', 'rk-eqc'); box.appendChild(c); requestAnimationFrame(() => drawEq(c, s.p, t.sr || 48000)); }
    const form = el('div', 'rk-form'); box.appendChild(form);
    for (const f of T.fields) {
      const lab = el('label'); lab.textContent = f.label; let inp, val = el('span', 'rk-v');
      if (f.type === 'range') {
        inp = el('input'); inp.type = 'range'; inp.min = f.log ? 0 : f.min; inp.max = f.log ? 1000 : f.max; inp.step = f.log ? 1 : f.step; inp.value = toPos(f, s.p[f.key]);
        val.textContent = f.fmt ? f.fmt(s.p[f.key]) : s.p[f.key];
        inp.oninput = () => { s.p[f.key] = fromPos(f, inp.value); val.textContent = f.fmt ? f.fmt(s.p[f.key]) : s.p[f.key]; t.changed(null, false); if (s.type === 'eq') drawEq(box.querySelector('canvas'), s.p, t.sr || 48000); };
        inp.onchange = () => t.changed(`${T.name}: ${f.label}`, false, true);
        inp.ondblclick = () => { s.p[f.key] = f.value; inp.value = toPos(f, f.value); val.textContent = f.fmt ? f.fmt(f.value) : f.value; t.changed(`${T.name}: ${f.label}`, false, true); if (s.type === 'eq') drawEq(box.querySelector('canvas'), s.p, t.sr || 48000); };
      } else if (f.type === 'checkbox') {
        inp = el('input'); inp.type = 'checkbox'; inp.checked = !!s.p[f.key];
        inp.onchange = () => { s.p[f.key] = inp.checked; t.changed(`${T.name}: ${f.label}`, false, true); if (s.type === 'eq') drawEq(box.querySelector('canvas'), s.p, t.sr || 48000); };
      } else {
        inp = el('select'); f.options.forEach(([v, txt]) => inp.add(new Option(txt, v))); inp.value = s.p[f.key];
        inp.onchange = () => { s.p[f.key] = inp.value; t.changed(`${T.name}: ${f.label}`, false, true); };
      }
      inp.dataset.k = f.key;
      form.append(lab, inp, val);
    }
    box.querySelector('[data-reset]').onclick = () => { s.p = sanitizeParams(s.type, defaults(s.type)); t.changed('Reset ' + T.name, false, true); refresh(); };
  }
  function drawEq(c, p, sr) {
    if (!c || !c.isConnected) return;
    const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight; if (!w) return; c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#12304d'); bg.addColorStop(1, '#0a1b2c'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const fmax = Math.min(20000, sr / 2), X = f => 2 + (w - 4) * Math.log(f / 20) / Math.log(fmax / 20), Y = db => h / 2 - db / 20 * (h / 2 - 4);
    g.strokeStyle = 'rgba(140,190,240,.15)'; g.beginPath(); for (const f of [100, 1000, 10000]) { const x = Math.round(X(f)) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); } for (const db of [-12, 0, 12]) { const y = Math.round(Y(db)) + 0.5; g.moveTo(0, y); g.lineTo(w, y); } g.stroke();
    const cs = DSP.eqCoefs(eqBands(p), sr); g.beginPath();
    for (let x = 2; x < w - 2; x++) { const f = 20 * Math.pow(fmax / 20, (x - 2) / (w - 4)), y = Y(clamp(DSP.eqResponseDb(cs, f, sr) + (p.out || 0), -24, 24)); x === 2 ? g.moveTo(x, y) : g.lineTo(x, y); }
    g.strokeStyle = '#7ff0c4'; g.lineWidth = 1.8; g.stroke();
  }
  // live gain-reduction readouts
  function tick() {
    if (!root || !root.offsetParent) return;
    root.querySelectorAll('.rk-slot').forEach(it => { const gr = grMeter.get(it.dataset.id), sp = it.querySelector('.rk-gr'); const txt = Engine.playing() && gr > 0.05 ? '−' + gr.toFixed(1) : ''; if (sp.textContent !== txt) sp.textContent = txt; });
  }

  return { TYPES, ORDER, BUILTIN, defaults, sanitize, sanitizeParams, newSlot, empty, clone, active, latency, load, createChain, render, presetRack, allPresets, userPresets, saveUserPresets, toPreset, fromPreset, eqBands, workletParams,
    init, refresh, tick, popMenu, get selSlot() { return selSlot; }, set selSlot(v) { selSlot = v; } };
})();
