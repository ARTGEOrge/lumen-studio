'use strict';
/* Lumen Sound — multitrack session: tracks, clips on a timeline (move/trim/split/fades/gain/time-stretch),
   automatic crossfades, volume/pan/clip-gain automation, per-track effect racks, send buses, auto-ducking,
   mixer, playback and mixdown. */
window.Multi = (() => {
  const { $, el, esc, clamp, uid } = Aero;
  const TRACK_H = 120, BUS_H = 62, RULER_H = 26, COLORS = ['#3d8fe0', '#e0703d', '#3dbf73', '#b45ee0', '#e0c43d', '#e03d6a', '#3dc8d0', '#8d9e3d'];
  const AUTO_RATE = 100; // automation curve samples per second
  let root, cRuler, cMain, cOv, headers, lanesEl, bodyEl, scrollEl, thumb, dpr = 1, W = 0;
  const M = {
    session: null, sources: new Map(), hist: null, view: { start: 0, pps: 60 }, playhead: 0, sel: { a: 0, b: 0 }, selClip: null, selTrack: null, clipboard: null
  };
  let playStartAt = 0, playing = null;
  const bufCache = new Map(), stretchCache = new Map();

  /* ---------- model ---------- */
  function newTrack(name, i) { return { id: uid(), name, color: COLORS[i % COLORS.length], vol: 0, pan: 0, mute: false, solo: false, clips: [], fx: Rack.empty(), auto: { vol: [], pan: [] }, show: '', sends: {}, duck: null }; }
  function newBus(name, i) { return { id: uid(), name, color: COLORS[(i + 3) % COLORS.length], vol: 0, mute: false, fx: Rack.empty() }; }
  function addSource(name, chs, sr) { const id = uid(); M.sources.set(id, { id, name, chs, sr }); return id; }
  const source = id => M.sources.get(id);
  const srcDur = s => s.chs[0].length / s.sr;
  function makeClip(srcId, start, name) { const s = source(srcId); return { id: uid(), src: srcId, name: name || s.name, start, offset: 0, dur: srcDur(s), gain: 0, fadeIn: 0, fadeOut: 0, fadeShape: 'scurve', stretch: 1, env: [] }; }
  const rOf = c => c.stretch || 1;
  const srcTimeAt = (c, lt) => c.offset + lt / rOf(c);           // clip-local seconds → source seconds
  const maxDur = c => { const s = source(c.src); return s ? (srcDur(s) - c.offset) * rOf(c) : c.dur; };
  function duration() { let e = 0; if (M.session) for (const t of M.session.tracks) for (const c of t.clips) e = Math.max(e, c.start + c.dur); return e; }
  const snap = () => JSON.parse(JSON.stringify({ tracks: M.session.tracks, buses: M.session.buses || [], master: M.session.master, markers: M.session.markers || [], autoXfade: M.session.autoXfade !== false }));
  function push(label) { M.hist.push(label, snap()); render(); props(); App.renderHist(); if (window.Rack && App.mode === 'multi') Rack.refresh(); }
  function restore(s) {
    if (!s) return; M.session.tracks = JSON.parse(JSON.stringify(s.tracks)); M.session.buses = JSON.parse(JSON.stringify(s.buses || [])); M.session.master = { ...s.master };
    M.session.markers = (s.markers || []).map(m => ({ ...m })); M.session.autoXfade = s.autoXfade !== false;
    stop(); buildHeaders(); resize(); props(); Rack.refresh();
  }
  function findClip(id) { for (const t of M.session?.tracks || []) { const c = t.clips.find(c => c.id === id); if (c) return { t, c }; } return null; }
  const selTrackObj = () => M.session?.tracks.find(t => t.id === M.selTrack) || (selBusObj() ? null : M.session?.tracks[0]);
  const selBusObj = () => (M.session?.buses || []).find(b => b.id === M.selTrack) || null;
  const trackById = id => M.session?.tracks.find(t => t.id === id) || (M.session?.buses || []).find(b => b.id === id);
  function selectTrack(id) { if (M.selTrack === id) return; M.selTrack = id; headers?.querySelectorAll('.mt-th').forEach(x => x.classList.toggle('sel', x.dataset.id === id)); render(); Rack.refresh(); }

  /* ---------- envelopes ---------- */
  // pts: [{t, v}] sorted by t. Linear interpolation, held at the ends.
  function envAt(pts, t, def) {
    if (!pts || !pts.length) return def;
    if (t <= pts[0].t) return pts[0].v; const L = pts[pts.length - 1]; if (t >= L.t) return L.v;
    let lo = 0, hi = pts.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].t <= t) lo = m; else hi = m; }
    const a = pts[lo], b = pts[hi]; return a.v + (b.v - a.v) * (t - a.t) / Math.max(1e-9, b.t - a.t);
  }
  const sortPts = pts => pts.sort((a, b) => a.t - b.t);
  /* automatic crossfades between overlapping clips on the same track → Map clipId → {in, out} seconds */
  function xfades(t) {
    const m = new Map(); if (M.session?.autoXfade === false) return m;
    const cs = t.clips.slice().sort((a, b) => a.start - b.start);
    for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
      const A = cs[i], B = cs[j]; if (B.start >= A.start + A.dur) break;
      if (B.start + B.dur <= A.start + A.dur) continue; // fully inside: no crossfade
      const ov = A.start + A.dur - B.start; if (ov <= 0.001) continue;
      const a = m.get(A.id) || { in: 0, out: 0 }, b = m.get(B.id) || { in: 0, out: 0 };
      a.out = Math.max(a.out, ov); b.in = Math.max(b.in, ov); m.set(A.id, a); m.set(B.id, b);
    }
    return m;
  }
  function clipGainAt(c, lt, xf) { // lt: seconds inside clip (0..dur)
    let g = DSP.dbToLin(c.gain + (c.env && c.env.length ? envAt(c.env, srcTimeAt(c, lt), 0) : 0));
    if (c.fadeIn > 0 && lt < c.fadeIn) g *= DSP.fadeCurve(c.fadeShape, lt / c.fadeIn);
    if (c.fadeOut > 0 && lt > c.dur - c.fadeOut) g *= DSP.fadeCurve(c.fadeShape, (c.dur - lt) / c.fadeOut);
    if (xf) { if (xf.in > 0 && lt < xf.in) g *= Math.sin(Math.PI / 2 * clamp(lt / xf.in, 0, 1)); if (xf.out > 0 && lt > c.dur - xf.out) g *= Math.sin(Math.PI / 2 * clamp((c.dur - lt) / xf.out, 0, 1)); }
    return g;
  }

  /* ---------- auto-ducking (sidechain-style) ----------
     The key signal (sum of the chosen voice tracks) is analysed in 10 ms frames; while it is above the
     threshold the ducked track's gain moves to −amount dB with attack (and equal look-ahead) / release smoothing. */
  const duckCache = new Map();
  function duckCurve(t) {
    const d = t.duck; if (!d || !d.on || !d.keys?.length) return null;
    const keys = d.keys.map(id => M.session.tracks.find(x => x.id === id)).filter(Boolean); if (!keys.length) return null;
    const sig = JSON.stringify([d, Math.ceil(duration()), M.session.autoXfade, keys.map(k => [k.vol, k.mute, k.clips.map(c => [c.src, c.start, c.offset, c.dur, c.gain, c.fadeIn, c.fadeOut, c.stretch, c.env])])]);
    const hit = duckCache.get(t.id); if (hit && hit.sig === sig) return hit.curve;
    const F = Math.ceil((duration() + 1) * AUTO_RATE), en = new Float64Array(F), cnt = new Float64Array(F);
    for (const k of keys) {
      if (k.mute) continue; const tv = DSP.dbToLin(k.vol), xm = xfades(k);
      for (const c of k.clips) {
        const s = source(c.src); if (!s) continue;
        const f0 = Math.max(0, Math.floor(c.start * AUTO_RATE)), f1 = Math.min(F, Math.ceil((c.start + c.dur) * AUTO_RATE)), xf = xm.get(c.id);
        for (let f = f0; f < f1; f++) {
          const lt0 = f / AUTO_RATE - c.start, g = clipGainAt(c, clamp(lt0 + 0.005, 0, c.dur), xf) * tv;
          let e = 0, n = 0;
          for (let q = 0; q < 24; q++) { const lt = lt0 + q / (24 * AUTO_RATE); if (lt < 0 || lt > c.dur) continue; const si = Math.floor(srcTimeAt(c, lt) * s.sr); if (si < 0 || si >= s.chs[0].length) continue; let v = 0; for (const ch of s.chs) v += ch[si]; v /= s.chs.length; e += v * v; n++; }
          if (n) { en[f] += e / n * g * g; cnt[f] = 1; }
        }
      }
    }
    const thr = d.threshold ?? -36, amt = -Math.abs(d.amount ?? 12), look = Math.round((d.attack ?? 80) / 1000 * AUTO_RATE), hold = Math.round(0.25 * AUTO_RATE);
    const act = new Uint8Array(F); for (let f = 0; f < F; f++) if (cnt[f] && 10 * Math.log10(en[f] + 1e-20) > thr) act[f] = 1;
    // extend activity backwards (look-ahead) and forwards (hold)
    const tgt = new Float32Array(F); let last = -1e9;
    for (let f = 0; f < F; f++) { if (act[f]) last = f; if (f - last <= hold) tgt[f] = amt; }
    let next = 1e9; for (let f = F - 1; f >= 0; f--) { if (act[f]) next = f; if (next - f <= look) tgt[f] = amt; }
    const aA = 1 - Math.exp(-1 / Math.max(1, (d.attack ?? 80) / 1000 * AUTO_RATE / 3)), aR = 1 - Math.exp(-1 / Math.max(1, (d.release ?? 500) / 1000 * AUTO_RATE / 3));
    const curve = new Float32Array(F); let y = 0;
    for (let f = 0; f < F; f++) { const tg = tgt[f]; y += (tg - y) * (tg < y ? aA : aR); curve[f] = y; }
    duckCache.set(t.id, { sig, curve }); return curve;
  }
  const duckAt = (curve, time) => curve ? curve[clamp(Math.round(time * AUTO_RATE), 0, curve.length - 1)] : 0;

  /* ---------- sessions ---------- */
  function newSession(confirmFirst) {
    const go = () => {
      stop(); M.session = { sr: 48000, tracks: [0, 1, 2, 3].map(i => newTrack('Track ' + (i + 1), i)), buses: [], master: { vol: 0 }, markers: [], autoXfade: true };
      M.sources.clear(); bufCache.clear(); stretchCache.clear(); duckCache.clear(); M.view = { start: 0, pps: 60 }; M.playhead = 0; M.sel = { a: 0, b: 0 }; M.selClip = null; M.selTrack = M.session.tracks[0].id;
      M.hist.reset('New Session', snap()); buildHeaders(); resize(); props(); App.renderHist(); Rack.refresh();
    };
    if (confirmFirst && M.session && M.session.tracks.some(t => t.clips.length)) Aero.confirm('New Session', 'Replace the current multitrack session?', 'Replace').then(ok => ok && go()); else go();
  }
  function clear() { M.session = null; M.sources.clear(); bufCache.clear(); stretchCache.clear(); duckCache.clear(); }
  function finishOpen(label, name) {
    M.hist.reset(label, snap());
    if (App.mode !== 'multi') App.setMode('multi');
    buildHeaders(); resize(); zoomFit(); props(); App.renderHist(); Rack.refresh();
    App.projectName = App.doc ? App.projectName : name; Aero.setDoc(App.projectName, false);
  }
  function openSample() {
    stop();
    Aero.busy('Synthesising session…');
    setTimeout(() => {
      try {
        const S = Samples.sessionSources(), sr = Samples.SR, bar = S.beat * 4;
        M.session = { sr, tracks: [], buses: [], master: { vol: -3 }, markers: [{ id: uid(), time: 0, label: 'Intro' }, { id: uid(), time: bar * 4, label: 'Verse' }], autoXfade: true };
        M.sources.clear(); bufCache.clear(); stretchCache.clear(); duckCache.clear();
        const ids = S.srcs.map(s => addSource(s.name, s.chs, sr));
        const t = ['Drums', 'Bass', 'Keys', 'Voice'].map((n, i) => newTrack(n, i));
        const d1 = makeClip(ids[0], 0), d2 = makeClip(ids[0], d1.dur - bar / 2); d2.name = 'Drum Loop 2'; // overlap → automatic crossfade
        t[0].clips.push(d1, d2); t[0].vol = -2;
        const b1 = makeClip(ids[1], bar * 2); b1.offset = 0; b1.dur = bar * 2; const b2 = makeClip(ids[1], bar * 4); b2.fadeOut = 1.2;
        t[1].clips.push(b1, b2); t[1].vol = -3; t[1].pan = -10;
        t[1].fx = Rack.fromPreset([{ type: 'comp', p: { threshold: -22, ratio: 4, attack: 10, release: 90, makeup: 3 } }]);
        const k1 = makeClip(ids[2], 0); k1.fadeIn = 2.4; k1.gain = -2; const k2 = makeClip(ids[2], k1.dur); k2.fadeOut = 3; k2.fadeShape = 'log';
        t[2].clips.push(k1, k2); t[2].pan = 25; t[2].vol = -4;
        t[2].auto.vol = [{ t: 0, v: -6 }, { t: bar * 2, v: 0 }, { t: bar * 5, v: 0 }, { t: bar * 6, v: -9 }, { t: bar * 7, v: 0 }]; t[2].show = 'vol';
        const v1 = makeClip(ids[3], bar * 1.5); v1.fadeIn = 0.05; v1.fadeOut = 0.4; const v2 = makeClip(ids[3], bar * 5); v2.gain = 1.5; v2.fadeOut = 0.6; v2.offset = 0.6; v2.dur -= 0.6; v2.name = 'Voice (answer)';
        t[3].clips.push(v1, v2); t[3].pan = -15;
        t[3].fx = Rack.presetRack('Podcast Voice');
        const rb = newBus('Reverb Bus', 0); rb.fx = Rack.presetRack('Reverb Bus (100% wet)'); rb.vol = -4;
        M.session.buses.push(rb); t[2].sends[rb.id] = -10; t[3].sends[rb.id] = -12; t[0].sends[rb.id] = -20;
        M.session.tracks = t; M.selTrack = t[3].id; M.selClip = v1.id; M.playhead = bar * 1.5; M.sel = { a: 0, b: 0 };
        finishOpen('Open Sample Session', 'Sample Session');
      } finally { Aero.busy(); }
    }, 20);
  }
  /* podcast preset session: voice cleanup racks on the speakers, the music bed auto-ducks under them */
  function podcastSession(withDemo = true) {
    stop();
    const go = () => {
      M.session = { sr: 48000, tracks: [], buses: [], master: { vol: 0 }, markers: [], autoXfade: true };
      M.sources.clear(); bufCache.clear(); stretchCache.clear(); duckCache.clear();
      const host = newTrack('Host', 0), guest = newTrack('Guest', 1), music = newTrack('Music', 2);
      host.fx = Rack.presetRack('Podcast Voice'); guest.fx = Rack.presetRack('Podcast Voice'); guest.pan = 0;
      music.vol = -6; music.duck = { on: true, keys: [host.id, guest.id], amount: 15, threshold: -38, attack: 120, release: 700 }; music.show = 'vol';
      M.session.tracks = [host, guest, music];
      if (withDemo) {
        const P = Samples.podcastSources(), ids = P.map(s => addSource(s.name, s.chs, Samples.SR));
        host.clips.push(makeClip(ids[0], 0)); guest.clips.push(makeClip(ids[1], 0));
        const mc = makeClip(ids[2], 0); mc.fadeIn = 1.5; music.clips.push(mc);
        M.session.markers = [{ id: uid(), time: 0.6, label: 'Host intro' }, { id: uid(), time: 4.9, label: 'Guest' }, { id: uid(), time: 9.4, label: 'Host' }];
      }
      M.selTrack = host.id; M.selClip = null; M.playhead = 0; M.sel = { a: 0, b: 0 };
      finishOpen('Podcast Session', 'Podcast');
      Aero.toast('Podcast session: voice cleanup on Host/Guest, music ducks under the voices');
    };
    if (withDemo) { Aero.busy('Building podcast session…'); setTimeout(() => { try { go(); } finally { Aero.busy(); } }, 20); } else go();
  }

  /* ---------- DOM ---------- */
  function init(rootEl) {
    root = rootEl;
    M.hist = new Aero.History({ max: 100, onChange: () => App.mode === 'multi' && App.renderHist() });
    root.innerHTML = `
      <div class="mt-top"><div class="mt-corner"><b>Tracks</b><button class="aero-btn small" data-add title="Add track">+ Track</button><button class="aero-btn small" data-addbus title="Add a send bus (e.g. a shared reverb)">+ Bus</button></div><canvas class="mt-ruler"></canvas></div>
      <div class="mt-body"><div class="mt-heads"></div><div class="mt-lanes"><canvas class="mt-c"></canvas><canvas class="mt-o"></canvas></div></div>
      <div class="mt-bottom"><div class="mt-corner mt-master"><b>Master</b><input type="range" min="-48" max="12" step="0.5" data-mvol><span data-mv>0.0 dB</span></div><div class="wv-scroll"><div class="wv-thumb"></div></div></div>`;
    cRuler = root.querySelector('.mt-ruler'); cMain = root.querySelector('.mt-c'); cOv = root.querySelector('.mt-o'); headers = root.querySelector('.mt-heads'); lanesEl = root.querySelector('.mt-lanes'); bodyEl = root.querySelector('.mt-body');
    scrollEl = root.querySelector('.wv-scroll'); thumb = root.querySelector('.wv-thumb');
    root.querySelector('[data-add]').onclick = () => addTrack();
    root.querySelector('[data-addbus]').onclick = () => addBus();
    const mv = root.querySelector('[data-mvol]');
    mv.oninput = () => { if (!M.session) return; M.session.master.vol = +mv.value; root.querySelector('[data-mv]').textContent = dbs(+mv.value); livePatch(); };
    mv.onchange = () => push('Master Volume');
    new ResizeObserver(() => resize()).observe(lanesEl);
    bindCanvas(); bindRuler(); bindScroll();
    lanesEl.addEventListener('wheel', onWheel, { passive: false }); cRuler.addEventListener('wheel', onWheel, { passive: false });
    buildProps();
  }
  const dbs = v => (v > 0 ? '+' : '') + (+v).toFixed(1) + ' dB';
  const pans = v => v === 0 ? 'C' : v < 0 ? 'L' + (-v) : 'R' + v;
  const sendTxt = v => v == null || v <= -48 ? 'off' : dbs(v);
  function buildHeaders() {
    headers.innerHTML = '';
    if (!M.session) return;
    const bus0 = (M.session.buses || [])[0];
    M.session.tracks.forEach((t, i) => {
      const h = el('div', 'mt-th' + (t.id === M.selTrack ? ' sel' : '')); h.dataset.id = t.id;
      h.style.height = TRACK_H + 'px';
      h.innerHTML = `<div class="r1"><span class="mt-col" style="background:${t.color}"></span><input type="text" class="mt-name" spellcheck="false"><button class="mt-ms fx${Rack.active(t.fx) ? ' on' : ''}" data-fx title="Track effects rack">FX</button><button class="mt-ms${t.mute ? ' on' : ''}" data-m title="Mute">M</button><button class="mt-ms s${t.solo ? ' on' : ''}" data-s title="Solo">S</button></div>
        <div class="r2"><span>Vol</span><input type="range" min="-48" max="12" step="0.5" data-v><span class="v" data-vv></span></div>
        <div class="r2"><span>Pan</span><input type="range" min="-100" max="100" step="1" data-p><span class="v" data-pv></span></div>
        <div class="r2" title="${bus0 ? 'Post-fader send to ' + esc(bus0.name) : 'Add a bus (+ Bus) to use sends'}"><span>Send</span><input type="range" min="-48" max="6" step="0.5" data-send${bus0 ? '' : ' disabled'}><span class="v" data-sv></span></div>
        <div class="r3"><select data-lane title="Show an automation lane on this track"><option value="">Envelope: off</option><option value="vol">Volume envelope</option><option value="pan">Pan envelope</option><option value="clip">Clip gain envelope</option></select><button class="mt-duck${t.duck?.on ? ' on' : ''}" data-duck title="Auto-ducking (sidechain) under other tracks">Duck</button></div>
        <canvas class="mt-tmeter" data-meter></canvas>`;
      const q = s => h.querySelector(s);
      q('.mt-name').value = t.name;
      q('.mt-name').onchange = e => { t.name = e.target.value.slice(0, 60) || t.name; push('Rename Track'); };
      q('[data-v]').value = t.vol; q('[data-vv]').textContent = dbs(t.vol); q('[data-p]').value = t.pan; q('[data-pv]').textContent = t.auto?.pan?.length ? 'auto' : pans(t.pan);
      q('[data-v]').oninput = e => { t.vol = +e.target.value; q('[data-vv]').textContent = dbs(t.vol); livePatch(); };
      q('[data-v]').onchange = () => push('Track Volume');
      q('[data-v]').ondblclick = () => { t.vol = 0; q('[data-v]').value = 0; q('[data-vv]').textContent = dbs(0); livePatch(); push('Track Volume'); };
      q('[data-p]').oninput = e => { t.pan = +e.target.value; q('[data-pv]').textContent = pans(t.pan); livePatch(); };
      q('[data-p]').onchange = () => push('Track Pan');
      q('[data-p]').ondblclick = () => { t.pan = 0; q('[data-p]').value = 0; q('[data-pv]').textContent = 'C'; livePatch(); push('Track Pan'); };
      const sv = bus0 ? (t.sends?.[bus0.id] ?? -48) : -48; q('[data-send]').value = sv; q('[data-sv]').textContent = bus0 ? sendTxt(sv) : '—';
      q('[data-send]').oninput = e => { if (!bus0) return; const v = +e.target.value; t.sends = t.sends || {}; if (v <= -48) delete t.sends[bus0.id]; else t.sends[bus0.id] = v; q('[data-sv]').textContent = sendTxt(v); livePatch(); };
      q('[data-send]').onchange = () => { if (bus0) push('Send Level'); };
      q('[data-send]').ondblclick = () => { if (!bus0) return; t.sends = t.sends || {}; t.sends[bus0.id] = 0; q('[data-send]').value = 0; q('[data-sv]').textContent = sendTxt(0); livePatch(); push('Send Level'); };
      q('[data-m]').onclick = () => { t.mute = !t.mute; q('[data-m]').classList.toggle('on', t.mute); livePatch(); push(t.mute ? 'Mute Track' : 'Unmute Track'); };
      q('[data-s]').onclick = () => { t.solo = !t.solo; q('[data-s]').classList.toggle('on', t.solo); livePatch(); push(t.solo ? 'Solo Track' : 'Unsolo Track'); };
      q('[data-fx]').onclick = () => { selectTrack(t.id); App.setSideTab('rack'); };
      q('[data-lane]').value = t.show || '';
      q('[data-lane]').onchange = e => { t.show = e.target.value; if (t.show && App.tool() !== 'envelope') App.setTool('envelope'); push(t.show ? 'Show Envelope' : 'Hide Envelope'); };
      q('[data-duck]').onclick = () => { selectTrack(t.id); duckDialog(t); };
      h.addEventListener('pointerdown', () => selectTrack(t.id));
      headers.appendChild(h);
    });
    (M.session.buses || []).forEach(b => {
      const h = el('div', 'mt-th bus' + (b.id === M.selTrack ? ' sel' : '')); h.dataset.id = b.id; h.style.height = BUS_H + 'px';
      h.innerHTML = `<div class="r1"><span class="mt-col" style="background:${b.color}"></span><input type="text" class="mt-name" spellcheck="false"><button class="mt-ms fx${Rack.active(b.fx) ? ' on' : ''}" data-fx title="Bus effects rack">FX</button><button class="mt-ms${b.mute ? ' on' : ''}" data-m title="Mute bus">M</button><button class="mt-ms" data-x title="Delete bus">✕</button></div>
        <div class="r2"><span>Vol</span><input type="range" min="-48" max="12" step="0.5" data-v><span class="v" data-vv></span></div><canvas class="mt-tmeter" data-meter></canvas>`;
      const q = s => h.querySelector(s);
      q('.mt-name').value = b.name; q('.mt-name').onchange = e => { b.name = e.target.value.slice(0, 60) || b.name; buildHeaders(); push('Rename Bus'); };
      q('[data-v]').value = b.vol; q('[data-vv]').textContent = dbs(b.vol);
      q('[data-v]').oninput = e => { b.vol = +e.target.value; q('[data-vv]').textContent = dbs(b.vol); livePatch(); }; q('[data-v]').onchange = () => push('Bus Volume');
      q('[data-m]').onclick = () => { b.mute = !b.mute; q('[data-m]').classList.toggle('on', b.mute); livePatch(); push(b.mute ? 'Mute Bus' : 'Unmute Bus'); };
      q('[data-fx]').onclick = () => { selectTrack(b.id); App.setSideTab('rack'); };
      q('[data-x]').onclick = () => deleteBus(b);
      h.addEventListener('pointerdown', () => selectTrack(b.id));
      headers.appendChild(h);
    });
    const mv = root.querySelector('[data-mvol]'); mv.value = M.session.master.vol; root.querySelector('[data-mv]').textContent = dbs(M.session.master.vol);
  }
  function sizeCanvas(c, w, h) { c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr)); c.style.width = w + 'px'; c.style.height = h + 'px'; const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return g; }
  let H = 0;
  const rowsH = () => M.session ? M.session.tracks.length * TRACK_H + (M.session.buses || []).length * BUS_H : 0;
  function resize() {
    if (!root || !root.offsetParent) return;
    dpr = devicePixelRatio || 1;
    W = Math.floor(lanesEl.getBoundingClientRect().width);
    H = Math.max(rowsH(), bodyEl.clientHeight);
    sizeCanvas(cMain, W, H); sizeCanvas(cOv, W, H); sizeCanvas(cRuler, W, RULER_H);
    clampView(); render();
  }
  function clampView() { const v = M.view, total = Math.max(duration() + 5, 20); v.pps = clamp(v.pps, 2, 4000); v.start = clamp(v.start, 0, Math.max(0, total - W / v.pps * 0.5)); }
  const xOf = t => (t - M.view.start) * M.view.pps, tOf = x => M.view.start + x / M.view.pps;

  /* ---------- envelope geometry ---------- */
  const envTop = ti => ti * TRACK_H + 19, envBot = ti => ti * TRACK_H + TRACK_H - 8;
  const VMIN = -40, VMAX = 12;
  const volY = (ti, db) => envBot(ti) - (clamp(db, VMIN, VMAX) - VMIN) / (VMAX - VMIN) * (envBot(ti) - envTop(ti));
  const yVol = (ti, y) => clamp(VMIN + (envBot(ti) - y) / (envBot(ti) - envTop(ti)) * (VMAX - VMIN), VMIN, VMAX);
  const panY = (ti, p) => envTop(ti) + (clamp(p, -100, 100) + 100) / 200 * (envBot(ti) - envTop(ti));
  const yPan = (ti, y) => clamp(Math.round((y - envTop(ti)) / (envBot(ti) - envTop(ti)) * 200 - 100), -100, 100);
  // points of the lane shown on track t, in timeline coordinates: [{x, y, ref}] where ref = {pts, i, clip?}
  function lanePoints(t, ti) {
    const out = [];
    if (t.show === 'vol') (t.auto.vol || []).forEach((p, i) => out.push({ x: xOf(p.t), y: volY(ti, p.v), pts: t.auto.vol, i }));
    else if (t.show === 'pan') (t.auto.pan || []).forEach((p, i) => out.push({ x: xOf(p.t), y: panY(ti, p.v), pts: t.auto.pan, i }));
    else if (t.show === 'clip') for (const c of t.clips) (c.env || []).forEach((p, i) => out.push({ x: xOf(c.start + (p.t - c.offset) * rOf(c)), y: volY(ti, p.v), pts: c.env, i, clip: c }));
    return out;
  }

  /* ---------- drawing ---------- */
  let raf = 0;
  function render() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
  function timeStep() { const steps = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]; for (const s of steps) if (s * M.view.pps >= 80) return s; return 600; }
  function draw() {
    if (!root || !root.offsetParent || !M.session) return;
    const g = cMain.getContext('2d'); g.clearRect(0, 0, W, H);
    const step = timeStep(), t0 = M.view.start, t1 = tOf(W);
    M.session.tracks.forEach((t, i) => {
      const y = i * TRACK_H;
      const bg = g.createLinearGradient(0, y, 0, y + TRACK_H); bg.addColorStop(0, t.id === M.selTrack ? '#162f4a' : '#11263c'); bg.addColorStop(1, t.id === M.selTrack ? '#10263d' : '#0c1d2f');
      g.fillStyle = bg; g.fillRect(0, y, W, TRACK_H);
      g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, y + TRACK_H - 1, W, 1);
      g.strokeStyle = 'rgba(120,170,220,.08)'; g.beginPath(); for (let tt = Math.ceil(t0 / step) * step; tt < t1; tt += step) { const x = Math.round(xOf(tt)) + 0.5; g.moveTo(x, y); g.lineTo(x, y + TRACK_H - 1); } g.stroke();
      const xm = xfades(t);
      for (const c of t.clips) drawClip(g, t, c, y, xm.get(c.id));
      drawXfades(g, t, y, xm);
      drawDuck(g, t, i);
      drawEnvelope(g, t, i);
    });
    const tracksH = M.session.tracks.length * TRACK_H;
    (M.session.buses || []).forEach((b, k) => {
      const y = tracksH + k * BUS_H, bg = g.createLinearGradient(0, y, 0, y + BUS_H);
      bg.addColorStop(0, b.id === M.selTrack ? '#22283f' : '#1a1f33'); bg.addColorStop(1, '#141828'); g.fillStyle = bg; g.fillRect(0, y, W, BUS_H);
      g.fillStyle = hexA(b.color, 0.5); g.fillRect(0, y, W, 2); g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(0, y + BUS_H - 1, W, 1);
      const from = M.session.tracks.filter(t => t.sends && t.sends[b.id] != null).map(t => t.name);
      const fx = b.fx.slots.filter(s => s.on).map(s => Rack.TYPES[s.type].name);
      g.fillStyle = '#a9b8e8'; g.font = '600 11px Segoe UI, sans-serif'; g.fillText(`${b.name}`, 12, y + 22);
      g.fillStyle = '#7f8db8'; g.font = '11px Segoe UI, sans-serif';
      g.fillText(`Receives sends from ${from.length ? from.join(', ') : 'no tracks yet (use the Send sliders)'}  ·  Effects: ${fx.length ? fx.join(' → ') : 'none'}`, 12, y + 40);
    });
    const used = rowsH(); if (H > used) { g.fillStyle = '#0a1828'; g.fillRect(0, used, W, H - used); g.fillStyle = '#4c6a8a'; g.font = '12px Segoe UI'; if (!M.session.tracks.some(t => t.clips.length)) g.fillText('Drop audio files here, use File › Import to Session, or record into a new track.', 20, used + 30); }
    drawRuler(); drawOverlay(); updateScroll();
  }
  function drawClip(g, t, c, y, xf) {
    const x0 = xOf(c.start), x1 = xOf(c.start + c.dur); if (x1 < 0 || x0 > W) return;
    const top = y + 3, h = TRACK_H - 7, sel = c.id === M.selClip, muted = t.mute, r = rOf(c);
    g.save();
    roundRect(g, x0, top, Math.max(2, x1 - x0), h, 4); g.clip();
    const bg = g.createLinearGradient(0, top, 0, top + h); bg.addColorStop(0, hexA(t.color, sel ? 0.55 : 0.4)); bg.addColorStop(1, hexA(t.color, sel ? 0.3 : 0.2));
    g.fillStyle = bg; g.fillRect(x0, top, x1 - x0, h);
    g.fillStyle = hexA(t.color, 0.9); g.fillRect(x0, top, x1 - x0, 15);
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x0, top, x1 - x0, 7);
    // waveform (follows clip gain, envelope, fades and crossfades)
    const s = source(c.src);
    if (s) {
      const mid = top + 15 + (h - 15) / 2, amp = (h - 19) / 2, o = {};
      g.fillStyle = muted ? 'rgba(220,230,240,.35)' : 'rgba(235,250,255,.85)';
      const a = Math.max(0, x0), b = Math.min(W, x1);
      for (let px = Math.floor(a); px < b; px++) {
        const lt0 = tOf(px) - c.start, lt1 = tOf(px + 1) - c.start; if (lt1 < 0 || lt0 > c.dur) continue;
        let lo = 0, hi = 0; const s0 = srcTimeAt(c, lt0) * s.sr, s1 = srcTimeAt(c, lt1) * s.sr;
        for (const ch of s.chs.slice(0, 2)) { Wave.stats(ch, s0, Math.max(s0 + 1, s1), o); if (!o.empty) { lo = Math.min(lo, o.min); hi = Math.max(hi, o.max); } }
        const gg = clipGainAt(c, clamp((lt0 + lt1) / 2, 0, c.dur), xf) * DSP.dbToLin(t.vol);
        g.fillRect(px, mid - Math.min(1.2, hi * gg) * amp, 1, Math.max(1, (hi - lo) * gg * amp));
      }
    }
    // fades
    const fx = lt => xOf(c.start + lt);
    g.strokeStyle = '#ffe680'; g.lineWidth = 1.4; g.fillStyle = 'rgba(0,0,0,.28)';
    const shp = k => DSP.fadeCurve(c.fadeShape, k / 24);
    if (c.fadeIn > 0) { g.beginPath(); g.moveTo(x0, top + 15); for (let k = 0; k <= 24; k++) g.lineTo(fx(c.fadeIn * k / 24), top + h - shp(k) * (h - 15)); g.lineTo(x0, top + h); g.closePath(); g.fill(); g.beginPath(); for (let k = 0; k <= 24; k++) { const yy = top + h - shp(k) * (h - 15); k ? g.lineTo(fx(c.fadeIn * k / 24), yy) : g.moveTo(fx(0), yy); } g.stroke(); }
    if (c.fadeOut > 0) { g.beginPath(); g.moveTo(x1, top + 15); for (let k = 0; k <= 24; k++) g.lineTo(fx(c.dur - c.fadeOut * k / 24), top + h - shp(k) * (h - 15)); g.lineTo(x1, top + h); g.closePath(); g.fill(); g.beginPath(); for (let k = 0; k <= 24; k++) { const yy = top + h - shp(k) * (h - 15); k ? g.lineTo(fx(c.dur - c.fadeOut * k / 24), yy) : g.moveTo(fx(c.dur), yy); } g.stroke(); }
    // title
    g.fillStyle = '#fff'; g.font = '600 10.5px Segoe UI, sans-serif'; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 2;
    g.fillText(c.name + (c.gain ? `  (${dbs(c.gain)})` : '') + (Math.abs(r - 1) > 1e-4 ? `  ⟷ ${Math.round(r * 100)} %` : ''), x0 + 6, top + 11.5); g.shadowBlur = 0;
    g.restore();
    roundRect(g, x0 + 0.5, top + 0.5, Math.max(2, x1 - x0 - 1), h - 1, 4); g.strokeStyle = sel ? '#fff' : hexA(t.color, 1); g.lineWidth = sel ? 2 : 1; g.stroke();
    if (Math.abs(r - 1) > 1e-4) { g.fillStyle = 'rgba(255,200,90,.9)'; g.fillRect(x1 - 5, top + h - 12, 3, 10); g.fillRect(x0 + 2, top + h - 12, 3, 10); }
    if (sel || x1 - x0 > 40) {
      g.fillStyle = '#ffe680'; g.strokeStyle = '#5a4500'; g.lineWidth = 1;
      const hi = fx(c.fadeIn), ho = fx(c.dur - c.fadeOut);
      g.fillRect(hi - 4, top + 15, 8, 8); g.strokeRect(hi - 3.5, top + 15.5, 7, 7); g.fillRect(ho - 4, top + 15, 8, 8); g.strokeRect(ho - 3.5, top + 15.5, 7, 7);
    }
  }
  function drawXfades(g, t, y, xm) {
    for (const c of t.clips) {
      const xf = xm.get(c.id); if (!xf || !xf.out) continue;
      const a = xOf(c.start + c.dur - xf.out), b = xOf(c.start + c.dur); if (b < 0 || a > W) continue;
      const top = y + 18, bot = y + TRACK_H - 6;
      g.fillStyle = 'rgba(120,230,255,.10)'; g.fillRect(a, top, b - a, bot - top);
      g.strokeStyle = 'rgba(150,240,255,.85)'; g.lineWidth = 1.3; g.beginPath();
      for (let k = 0; k <= 20; k++) { const u = k / 20, x = a + (b - a) * u, yy = bot - Math.sin(Math.PI / 2 * (1 - u)) * (bot - top); k ? g.lineTo(x, yy) : g.moveTo(x, yy); }
      for (let k = 0; k <= 20; k++) { const u = k / 20, x = a + (b - a) * u, yy = bot - Math.sin(Math.PI / 2 * u) * (bot - top); k ? g.lineTo(x, yy) : g.moveTo(x, yy); }
      g.stroke();
      if (b - a > 40) { g.fillStyle = '#bff4ff'; g.font = '9.5px Segoe UI'; g.fillText('crossfade', a + 4, bot - 4); }
    }
  }
  function drawDuck(g, t, ti) {
    const cv = duckCurve(t); if (!cv) return;
    const top = envTop(ti), bot = envBot(ti), amt = Math.abs(t.duck.amount || 12);
    g.beginPath();
    for (let x = 0; x <= W; x += 2) { const v = duckAt(cv, tOf(x)); const yy = top + (-v / Math.max(1, amt)) * (bot - top) * 0.6; x ? g.lineTo(x, yy) : g.moveTo(x, yy); }
    g.lineTo(W, top); g.lineTo(0, top); g.closePath(); g.fillStyle = 'rgba(190,120,255,.20)'; g.fill();
    g.fillStyle = '#d7b5ff'; g.font = '600 9.5px Segoe UI'; g.fillText(`ducked −${amt} dB under ${t.duck.keys.map(id => trackById(id)?.name).filter(Boolean).join(' + ')}`, Math.max(6, xOf(0) + 6), bot - 4);
  }
  function drawEnvelope(g, t, ti) {
    if (!t.show) return;
    const col = t.show === 'pan' ? '#6fe0ff' : t.show === 'clip' ? '#ffb070' : '#ffe14a';
    g.save(); g.lineWidth = 1.6; g.strokeStyle = col;
    if (t.show === 'vol' || t.show === 'pan') {
      const pts = t.show === 'vol' ? t.auto.vol : t.auto.pan, def = t.show === 'vol' ? 0 : t.pan, Y = t.show === 'vol' ? v => volY(ti, v) : v => panY(ti, v);
      g.beginPath(); for (let x = 0; x <= W; x += 3) { const yy = Y(envAt(pts, tOf(x), def)); x ? g.lineTo(x, yy) : g.moveTo(x, yy); } g.stroke();
      if (t.show === 'vol') { g.setLineDash([2, 4]); g.strokeStyle = 'rgba(255,225,74,.35)'; g.beginPath(); g.moveTo(0, Math.round(volY(ti, 0)) + 0.5); g.lineTo(W, Math.round(volY(ti, 0)) + 0.5); g.stroke(); g.setLineDash([]); }
    } else {
      for (const c of t.clips) {
        const x0 = Math.max(0, xOf(c.start)), x1 = Math.min(W, xOf(c.start + c.dur)); if (x1 <= x0) continue;
        g.beginPath(); for (let x = x0; x <= x1; x += 3) { const lt = tOf(x) - c.start, yy = volY(ti, c.gain + envAt(c.env, srcTimeAt(c, lt), 0)); x === x0 ? g.moveTo(x, yy) : g.lineTo(x, yy); } g.stroke();
      }
    }
    for (const p of lanePoints(t, ti)) { if (p.x < -6 || p.x > W + 6) continue; g.fillStyle = (envDrag && envDrag.pts === p.pts && envDrag.i === p.i) ? '#fff' : col; g.strokeStyle = '#1a1200'; g.lineWidth = 1; g.beginPath(); g.rect(p.x - 3.5, p.y - 3.5, 7, 7); g.fill(); g.stroke(); }
    const lbl = { vol: 'Volume (relative to fader)', pan: 'Pan (top = left)', clip: 'Clip gain' }[t.show];
    g.fillStyle = col; g.font = '600 9.5px Segoe UI'; g.globalAlpha = 0.85; g.fillText(lbl, W - g.measureText(lbl).width - 8, envTop(ti) + 10);
    g.restore();
  }
  function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function drawRuler() {
    const g = cRuler.getContext('2d');
    const bg = g.createLinearGradient(0, 0, 0, RULER_H); bg.addColorStop(0, '#fbfdff'); bg.addColorStop(1, '#dbe6f2'); g.fillStyle = bg; g.fillRect(0, 0, W, RULER_H);
    g.fillStyle = '#a8bbd0'; g.fillRect(0, RULER_H - 1, W, 1);
    if (M.sel.b > M.sel.a) { g.fillStyle = 'rgba(60,140,220,.28)'; g.fillRect(xOf(M.sel.a), 0, xOf(M.sel.b) - xOf(M.sel.a), RULER_H - 1); }
    const step = timeStep(), sub = step / 5; g.strokeStyle = '#6f88a3'; g.fillStyle = '#1e395b'; g.font = '10px Segoe UI'; g.beginPath();
    for (let t = Math.ceil(M.view.start / sub) * sub; t < tOf(W); t += sub) { const x = Math.round(xOf(t)) + 0.5, major = Math.abs(t / step - Math.round(t / step)) < 1e-6; g.moveTo(x, major ? 12 : 19); g.lineTo(x, RULER_H - 1); if (major) g.fillText(fmtRuler(t, step), x + 3, 11); }
    g.stroke();
    for (const m of M.session.markers || []) { const x = Math.round(xOf(m.time)); if (x < -80 || x > W) continue; const tw = g.measureText(m.label).width + 10; g.fillStyle = '#f0a020'; g.strokeStyle = '#9a5a00'; g.beginPath(); g.moveTo(x + 0.5, 25); g.lineTo(x + 0.5, 13); g.lineTo(x + tw, 13); g.lineTo(x + tw, 24); g.lineTo(x + 5, 24); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#2a1600'; g.fillText(m.label, x + 4, 22); }
    const x = Math.round(xOf(curPos())) + 0.5; g.fillStyle = '#e8401c'; g.beginPath(); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 7); g.closePath(); g.fill();
  }
  function fmtRuler(t, step) { const m = Math.floor(t / 60), s = t - m * 60, dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2; return `${m}:${s.toFixed(dec).padStart(dec ? 3 + dec : 2, '0')}`; }
  function drawOverlay() {
    const g = cOv.getContext('2d'); g.clearRect(0, 0, W, H);
    for (const m of M.session.markers || []) { const x = Math.round(xOf(m.time)) + 0.5; g.strokeStyle = 'rgba(255,180,50,.6)'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.setLineDash([]); }
    if (M.sel.b > M.sel.a) { g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(xOf(M.sel.a), 0, xOf(M.sel.b) - xOf(M.sel.a), M.session.tracks.length * TRACK_H); }
    if (snapLine != null) { const x = Math.round(xOf(snapLine)) + 0.5; g.strokeStyle = '#7fe7ff'; g.setLineDash([2, 2]); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.setLineDash([]); }
    const x = Math.round(xOf(curPos())) + 0.5; g.strokeStyle = playing ? '#ff5a36' : '#ffe14a'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
  }
  function updateScroll() {
    const total = Math.max(duration() + 5, 20), vis = W / M.view.pps, tw = scrollEl.clientWidth;
    const w = Math.max(24, tw * Math.min(1, vis / total)), x = (tw - w) * (total - vis > 0 ? clamp(M.view.start / (total - vis), 0, 1) : 0);
    thumb.style.width = w + 'px'; thumb.style.left = x + 'px';
  }

  /* ---------- interaction ---------- */
  let drag = null, snapLine = null, envDrag = null;
  const lx = e => e.clientX - lanesEl.getBoundingClientRect().left, ly = e => e.clientY - lanesEl.getBoundingClientRect().top;
  function hit(x, y) {
    const ti = Math.floor(y / TRACK_H), t = y < M.session.tracks.length * TRACK_H ? M.session?.tracks[ti] : null;
    if (!t) { const bi = Math.floor((y - M.session.tracks.length * TRACK_H) / BUS_H), b = (M.session.buses || [])[bi]; return { ti: -1, bus: b }; }
    for (let k = t.clips.length - 1; k >= 0; k--) {
      const c = t.clips[k], x0 = xOf(c.start), x1 = xOf(c.start + c.dur); if (x < x0 - 3 || x > x1 + 3) continue;
      const top = ti * TRACK_H + 3; let part = 'body';
      const hi = xOf(c.start + c.fadeIn), ho = xOf(c.start + c.dur - c.fadeOut);
      if (y >= top + 13 && y <= top + 27 && Math.abs(x - hi) <= 6) part = 'fadeIn';
      else if (y >= top + 13 && y <= top + 27 && Math.abs(x - ho) <= 6) part = 'fadeOut';
      else if (x - x0 < 6) part = 'left'; else if (x1 - x < 6) part = 'right';
      return { ti, t, c, part };
    }
    return { ti, t };
  }
  function snapTime(t, excludeId) {
    const tol = 8 / M.view.pps; let best = null, bd = tol;
    const cands = [0, curPos(), ...(M.session.markers || []).map(m => m.time)];
    for (const tr of M.session.tracks) for (const c of tr.clips) if (c.id !== excludeId) cands.push(c.start, c.start + c.dur);
    for (const c of cands) { const d = Math.abs(c - t); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  /* envelope editing: returns true if the event was consumed */
  function envPointer(e, x, y, h, tool) {
    if (!h.t || !h.t.show) return false;
    const t = h.t, ti = h.ti, pts = lanePoints(t, ti);
    const near = pts.find(p => Math.abs(p.x - x) <= 6 && Math.abs(p.y - y) <= 6);
    if (near && (e.altKey || e.button === 2)) { near.pts.splice(near.i, 1); push('Delete Envelope Point'); if (playing) restartPlayback(); return true; }
    if (near) { envDrag = { pts: near.pts, i: near.i, t, ti, clip: near.clip, moved: false }; return true; }
    if (tool !== 'envelope' || e.button !== 0) return false;
    // add a point on the lane
    const time = Math.max(0, tOf(x));
    if (t.show === 'vol') { t.auto.vol.push({ t: time, v: Math.round(yVol(ti, y) * 10) / 10 }); sortPts(t.auto.vol); envDrag = { pts: t.auto.vol, i: t.auto.vol.findIndex(p => p.t === time), t, ti, moved: true }; }
    else if (t.show === 'pan') { t.auto.pan.push({ t: time, v: yPan(ti, y) }); sortPts(t.auto.pan); envDrag = { pts: t.auto.pan, i: t.auto.pan.findIndex(p => p.t === time), t, ti, moved: true }; }
    else if (t.show === 'clip') {
      if (!h.c) { Aero.toast('Click inside a clip to add a clip-gain point'); return true; }
      const c = h.c; c.env = c.env || []; const st = srcTimeAt(c, time - c.start);
      c.env.push({ t: st, v: Math.round((yVol(ti, y) - c.gain) * 10) / 10 }); sortPts(c.env); envDrag = { pts: c.env, i: c.env.findIndex(p => p.t === st), t, ti, clip: c, moved: true };
    }
    render(); return true;
  }
  function envMove(x, y) {
    const d = envDrag, p = d.pts[d.i]; if (!p) return; d.moved = true;
    const prev = d.pts[d.i - 1], next = d.pts[d.i + 1];
    if (d.clip) {
      const c = d.clip; let st = srcTimeAt(c, tOf(x) - c.start); st = clamp(st, c.offset, c.offset + c.dur / rOf(c));
      if (prev) st = Math.max(st, prev.t + 1e-4); if (next) st = Math.min(st, next.t - 1e-4);
      p.t = st; p.v = Math.round((yVol(d.ti, y) - c.gain) * 10) / 10;
    } else {
      let tt = Math.max(0, tOf(x)); if (prev) tt = Math.max(tt, prev.t + 1e-4); if (next) tt = Math.min(tt, next.t - 1e-4);
      p.t = tt; p.v = d.t.show === 'pan' ? yPan(d.ti, y) : Math.round(yVol(d.ti, y) * 10) / 10;
    }
    render();
    const st = document.getElementById('st-hover'); if (st) st.textContent = `${App.fmtT(d.clip ? d.clip.start + (p.t - d.clip.offset) * rOf(d.clip) : p.t)}  ·  ${d.t.show === 'pan' ? pans(p.v) : dbs(p.v)}`;
  }
  function bindCanvas() {
    cOv.addEventListener('contextmenu', e => e.preventDefault());
    cOv.addEventListener('pointerdown', e => {
      if (!M.session) return;
      const x = lx(e), y = ly(e), tool = App.tool(), h = hit(x, y);
      try { cOv.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ };
      if (h.bus) { selectTrack(h.bus.id); return; }
      if (h.t) selectTrack(h.t.id);
      if (tool === 'hand' || e.button === 1) { drag = { mode: 'pan', x0: x, s0: M.view.start }; return; }
      if (envPointer(e, x, y, h, tool)) return;
      if (tool === 'envelope') { if (h.t && !h.t.show) Aero.toast('Choose an envelope (Volume / Pan / Clip gain) in the track header first'); return; }
      if (tool === 'razor') { if (h.c) { splitClip(h.t, h.c, snapTime(tOf(x), null) ?? tOf(x)); } return; }
      if (tool === 'move' && h.c) {
        M.selClip = h.c.id; props();
        let mode = h.part;
        if (e.altKey && (mode === 'left' || mode === 'right' || mode === 'body')) mode = mode === 'left' ? 'stretchL' : 'stretchR';
        drag = { mode, clip: h.c, track: h.t, x0: x, y0: y, orig: { ...h.c }, moved: false };
        render(); return;
      }
      M.selClip = h.c && tool === 'select' ? M.selClip : (tool === 'move' ? null : M.selClip); props();
      const t = Math.max(0, snapTime(tOf(x)) ?? tOf(x));
      drag = { mode: 'sel', anchor: t, x0: x, moved: false };
    });
    cOv.addEventListener('pointermove', e => {
      const x = lx(e), y = ly(e);
      if (envDrag) { envMove(x, y); return; }
      if (!drag) {
        if (!M.session) return;
        const h = hit(x, y), tool = App.tool();
        const nearPt = h.t?.show && lanePoints(h.t, h.ti).some(p => Math.abs(p.x - x) <= 6 && Math.abs(p.y - y) <= 6);
        cOv.style.cursor = nearPt ? 'pointer' : tool === 'hand' ? 'grab' : tool === 'envelope' ? 'crosshair' : tool === 'razor' ? (h.c ? 'crosshair' : 'default') : tool === 'move' && h.c ? (e.altKey && h.part !== 'fadeIn' && h.part !== 'fadeOut' ? 'col-resize' : ({ left: 'w-resize', right: 'e-resize', fadeIn: 'ew-resize', fadeOut: 'ew-resize', body: 'move' })[h.part]) : 'text';
        return;
      }
      if (drag.mode === 'pan') { M.view.start = drag.s0 - (x - drag.x0) / M.view.pps; clampView(); render(); return; }
      if (drag.mode === 'sel') { if (Math.abs(x - drag.x0) > 3) drag.moved = true; if (drag.moved) { const t = Math.max(0, snapTime(tOf(x)) ?? tOf(x)); M.sel = { a: Math.min(drag.anchor, t), b: Math.max(drag.anchor, t) }; render(); status(); } return; }
      const c = drag.clip, o = drag.orig, dt = (x - drag.x0) / M.view.pps, s = source(c.src), sd = srcDur(s), r = rOf(o);
      if (Math.abs(x - drag.x0) > 2 || Math.abs(y - drag.y0) > 4) drag.moved = true; if (!drag.moved) return;
      snapLine = null;
      if (drag.mode === 'body') {
        let ns = Math.max(0, o.start + dt);
        const sA = snapTime(ns, c.id), sB = snapTime(ns + c.dur, c.id);
        if (sA != null && (sB == null || Math.abs(sA - ns) <= Math.abs(sB - ns - c.dur))) { ns = sA; snapLine = sA; } else if (sB != null) { ns = sB - c.dur; snapLine = sB; }
        c.start = Math.max(0, ns);
        const ti = clamp(Math.floor(y / TRACK_H), 0, M.session.tracks.length - 1), nt = M.session.tracks[ti];
        if (nt !== drag.track) { drag.track.clips = drag.track.clips.filter(k => k !== c); nt.clips.push(c); drag.track = nt; selectTrack(nt.id); }
      } else if (drag.mode === 'left') {
        let ns = clamp(o.start + dt, o.start - o.offset * r, o.start + o.dur - 0.01); const sn = snapTime(ns, c.id); if (sn != null && sn >= o.start - o.offset * r && sn < o.start + o.dur - 0.01) { ns = sn; snapLine = sn; }
        ns = Math.max(0, ns); const d = ns - o.start; c.start = ns; c.offset = o.offset + d / r; c.dur = o.dur - d; c.fadeIn = Math.min(c.fadeIn, c.dur); c.fadeOut = Math.min(c.fadeOut, c.dur - c.fadeIn);
      } else if (drag.mode === 'right') {
        const maxE = o.start + (sd - o.offset) * r;
        let ne = clamp(o.start + o.dur + dt, o.start + 0.01, maxE); const sn = snapTime(ne, c.id); if (sn != null && sn > o.start + 0.01 && sn <= maxE) { ne = sn; snapLine = sn; }
        c.dur = ne - o.start; c.fadeOut = Math.min(c.fadeOut, c.dur); c.fadeIn = Math.min(c.fadeIn, c.dur - c.fadeOut);
      } else if (drag.mode === 'stretchR' || drag.mode === 'stretchL') {
        // time-stretch (pitch preserved): the clip keeps its source range, its timeline length changes
        let nd = drag.mode === 'stretchR' ? o.dur + dt : o.dur - dt;
        const sn = drag.mode === 'stretchR' ? snapTime(o.start + nd, c.id) : snapTime(o.start + o.dur - nd, c.id);
        if (sn != null) { nd = drag.mode === 'stretchR' ? sn - o.start : o.start + o.dur - sn; snapLine = sn; }
        const nr = clamp(r * nd / o.dur, 0.25, 4); nd = o.dur * nr / r;
        c.stretch = Math.round(nr * 10000) / 10000; c.dur = nd;
        if (drag.mode === 'stretchL') c.start = Math.max(0, o.start + o.dur - nd);
        c.fadeIn = Math.min(o.fadeIn * nr / r, c.dur); c.fadeOut = Math.min(o.fadeOut * nr / r, c.dur - c.fadeIn);
        const st = document.getElementById('st-hover'); if (st) st.textContent = `Stretch ${Math.round(c.stretch * 100)} % · ${App.fmtT(c.dur)} (pitch preserved)`;
      } else if (drag.mode === 'fadeIn') c.fadeIn = clamp(o.fadeIn + dt, 0, c.dur - c.fadeOut);
      else if (drag.mode === 'fadeOut') c.fadeOut = clamp(o.fadeOut - dt, 0, c.dur - c.fadeIn);
      render(); props();
    });
    const end = () => {
      if (envDrag) { const d = envDrag; envDrag = null; if (d.moved) { push(d.clip ? 'Edit Clip Gain Envelope' : d.t.show === 'pan' ? 'Edit Pan Envelope' : 'Edit Volume Envelope'); if (playing) restartPlayback(); } render(); return; }
      if (!drag) return;
      const d = drag; drag = null; snapLine = null;
      if (d.mode === 'sel') { if (!d.moved) { M.sel = { a: 0, b: 0 }; seek(d.anchor); } else status(); render(); return; }
      if (d.mode === 'pan') return;
      if (d.moved) { buildHeaders(); push({ body: 'Move Clip', left: 'Trim Clip', right: 'Trim Clip', fadeIn: 'Clip Fade In', fadeOut: 'Clip Fade Out', stretchL: 'Time Stretch Clip', stretchR: 'Time Stretch Clip' }[d.mode]); if (playing) restartPlayback(); }
      render();
    };
    cOv.addEventListener('pointerup', end); cOv.addEventListener('pointercancel', end);
    cOv.addEventListener('dblclick', e => {
      const x = lx(e), y = ly(e), h = hit(x, y);
      if (h.t?.show) { const p = lanePoints(h.t, h.ti).find(p => Math.abs(p.x - x) <= 6 && Math.abs(p.y - y) <= 6); if (p) { p.pts.splice(p.i, 1); push('Delete Envelope Point'); return; } if (App.tool() === 'envelope') return; }
      if (h.c) { M.selClip = h.c.id; props(); clipDialog(); }
    });
  }
  function bindRuler() {
    let rd = false;
    cRuler.addEventListener('pointerdown', e => { if (!M.session) return; rd = true; try { cRuler.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }; seek(Math.max(0, tOf(e.offsetX))); });
    cRuler.addEventListener('pointermove', e => { if (rd) seek(Math.max(0, tOf(e.offsetX)), true); });
    cRuler.addEventListener('pointerup', () => { rd = false; if (playing) restartPlayback(); });
  }
  function bindScroll() {
    let sd = null;
    thumb.addEventListener('pointerdown', e => { e.stopPropagation(); sd = { x0: e.clientX, l0: thumb.offsetLeft }; try { thumb.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }; });
    thumb.addEventListener('pointermove', e => { if (!sd) return; const tw = scrollEl.clientWidth - thumb.offsetWidth, total = Math.max(duration() + 5, 20), vis = W / M.view.pps; const l = clamp(sd.l0 + e.clientX - sd.x0, 0, tw); M.view.start = tw > 0 ? l / tw * Math.max(0, total - vis) : 0; render(); });
    thumb.addEventListener('pointerup', () => sd = null);
  }
  function onWheel(e) {
    if (!M.session) return; e.preventDefault();
    const x = clamp(lx(e), 0, W);
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { M.view.start += ((e.shiftKey ? e.deltaY : e.deltaX) || e.deltaY) / M.view.pps * 1.2; clampView(); render(); return; }
    if (e.ctrlKey || !e.altKey) { const t = tOf(x); M.view.pps *= e.deltaY < 0 ? 1.25 : 0.8; clampView(); M.view.start = t - x / M.view.pps; clampView(); render(); }
  }
  function zoom(f) { const t = curPos(), inView = t >= M.view.start && t <= tOf(W), x = inView ? xOf(t) : W / 2, c = inView ? t : tOf(W / 2); M.view.pps /= f; clampView(); M.view.start = c - x / M.view.pps; clampView(); render(); }
  function zoomFit() { const d = Math.max(duration(), 5); M.view.pps = (W - 20) / d; M.view.start = 0; clampView(); render(); }
  function zoomSel() { if (M.sel.b > M.sel.a) { M.view.pps = W / (M.sel.b - M.sel.a) * 0.95; M.view.start = M.sel.a - (M.sel.b - M.sel.a) * 0.025; } else { const f = findClip(M.selClip); if (!f) return; M.view.pps = W / f.c.dur * 0.9; M.view.start = f.c.start - f.c.dur * 0.05; } clampView(); render(); }

  /* ---------- clip operations ---------- */
  function splitParts(c, at) {
    const d = at - c.start, c2 = { ...c, id: uid(), start: at, offset: c.offset + d / rOf(c), dur: c.dur - d, fadeIn: 0, fadeOut: Math.min(c.fadeOut, c.dur - d), env: (c.env || []).map(p => ({ ...p })) };
    c.dur = d; c.fadeOut = 0; c.fadeIn = Math.min(c.fadeIn, d); return c2;
  }
  function splitClip(t, c, at) {
    if (at <= c.start + 0.005 || at >= c.start + c.dur - 0.005) return Aero.toast('Split point must be inside the clip');
    const c2 = splitParts(c, at); t.clips.push(c2); M.selClip = c2.id; push('Split Clip');
  }
  function splitAtPlayhead() {
    if (!M.session) return; const p = curPos();
    const f = findClip(M.selClip);
    let targets = f && p > f.c.start && p < f.c.start + f.c.dur ? [f] : [];
    if (!targets.length) for (const t of M.session.tracks) for (const c of t.clips) if (p > c.start + 0.005 && p < c.start + c.dur - 0.005 && (t.id === M.selTrack)) targets.push({ t, c });
    if (!targets.length) for (const t of M.session.tracks) for (const c of t.clips) if (p > c.start + 0.005 && p < c.start + c.dur - 0.005) targets.push({ t, c });
    if (!targets.length) return Aero.toast('No clip under the playhead');
    for (const { t, c } of targets) t.clips.push(splitParts(c, p));
    push(targets.length > 1 ? `Split ${targets.length} Clips` : 'Split Clip');
  }
  function deleteClip() { const f = findClip(M.selClip); if (!f) return Aero.toast('Select a clip first'); f.t.clips = f.t.clips.filter(c => c !== f.c); M.selClip = null; push('Delete Clip'); }
  function copyClip() { const f = findClip(M.selClip); if (!f) return Aero.toast('Select a clip first'); M.clipboard = JSON.parse(JSON.stringify(f.c)); Aero.toast('Clip copied'); }
  function cutClip() { if (!findClip(M.selClip)) return Aero.toast('Select a clip first'); copyClip(); deleteClip(); }
  function pasteClip() { if (!M.clipboard) return Aero.toast('Nothing to paste'); if (!source(M.clipboard.src)) return Aero.toast('The copied clip’s audio is no longer in this session'); const t = selTrackObj(); if (!t) return; const c = { ...JSON.parse(JSON.stringify(M.clipboard)), id: uid(), start: curPos() }; t.clips.push(c); M.selClip = c.id; push('Paste Clip'); }
  function duplicateClip() { const f = findClip(M.selClip); if (!f) return Aero.toast('Select a clip first'); const c = { ...JSON.parse(JSON.stringify(f.c)), id: uid(), start: f.c.start + f.c.dur }; f.t.clips.push(c); M.selClip = c.id; push('Duplicate Clip'); }
  function addTrack(name) { if (!M.session) newSession(false); const t = newTrack(name || 'Track ' + (M.session.tracks.length + 1), M.session.tracks.length); M.session.tracks.push(t); M.selTrack = t.id; buildHeaders(); resize(); push('Add Track'); return t; }
  function deleteTrack() {
    const t = selTrackObj(); if (!t) { const b = selBusObj(); if (b) deleteBus(b); return; }
    const go = () => { M.session.tracks = M.session.tracks.filter(x => x !== t); M.session.tracks.forEach(x => { if (x.duck) x.duck.keys = x.duck.keys.filter(id => id !== t.id); }); M.selTrack = M.session.tracks[0]?.id; buildHeaders(); resize(); push('Delete Track'); };
    if (t.clips.length) Aero.confirm('Delete Track', `Delete “${t.name}” and its ${t.clips.length} clip(s)?`, 'Delete').then(ok => ok && go()); else go();
  }
  function addBus(preset = 'Reverb Bus (100% wet)') {
    if (!M.session) newSession(false);
    M.session.buses = M.session.buses || [];
    if (M.session.buses.length >= 8) return Aero.toast('Up to 8 buses');
    const b = newBus(M.session.buses.length ? 'Bus ' + (M.session.buses.length + 1) : 'Reverb Bus', M.session.buses.length);
    if (preset) b.fx = Rack.presetRack(preset) || Rack.empty();
    M.session.buses.push(b); M.selTrack = b.id; buildHeaders(); resize(); push('Add Bus');
    Aero.toast(`Added “${b.name}” — raise a track's Send slider to feed it`);
    return b;
  }
  function deleteBus(b) {
    const go = () => { M.session.buses = M.session.buses.filter(x => x !== b); M.session.tracks.forEach(t => { if (t.sends) delete t.sends[b.id]; }); if (M.selTrack === b.id) M.selTrack = M.session.tracks[0]?.id; buildHeaders(); resize(); push('Delete Bus'); Rack.refresh(); };
    Aero.confirm('Delete Bus', `Delete “${b.name}” and all sends to it?`, 'Delete').then(ok => ok && go());
  }
  function sendsDialog() {
    const t = selTrackObj(); if (!t) return Aero.toast('Select a track first');
    const bs = M.session.buses || []; if (!bs.length) return Aero.alert('Track Sends', 'This session has no buses yet. Add one with Multitrack › Add Send Bus (or the “+ Bus” button).');
    Aero.dialog({ title: 'Track Sends — ' + t.name, instruction: 'Post-fader send levels (−48 dB = off).', fields: bs.map(b => ({ key: b.id, label: b.name, type: 'range', min: -48, max: 6, step: 0.5, value: t.sends?.[b.id] ?? -48, fmt: sendTxt })),
      onOK: v => { t.sends = {}; for (const b of bs) if (v[b.id] > -48) t.sends[b.id] = v[b.id]; buildHeaders(); push('Track Sends'); if (playing) restartPlayback(); } });
  }
  function duckDialog(t) {
    t = t || selTrackObj(); if (!t) return Aero.toast('Select a track first');
    const others = M.session.tracks.filter(x => x !== t); if (!others.length) return Aero.toast('Add the voice tracks first');
    const d = t.duck || { on: false, keys: others.filter(x => /voice|host|guest|vox|mic|speech|narr/i.test(x.name)).map(x => x.id), amount: 12, threshold: -38, attack: 120, release: 600 };
    Aero.dialog({ title: 'Auto-Ducking — ' + t.name, width: 480, instruction: 'Lower this track automatically while the selected key tracks (e.g. voices) are active — like a sidechain compressor, computed from the clips so it plays and mixes down identically.',
      fields: [{ key: 'on', label: 'Enable ducking', type: 'checkbox', value: t.duck ? !!d.on : true },
        ...others.map(x => ({ key: 'k_' + x.id, label: 'Key: ' + x.name, type: 'checkbox', value: d.keys.includes(x.id) })),
        { key: 'amount', label: 'Duck amount', type: 'range', min: 3, max: 40, step: 0.5, value: d.amount, fmt: v => '−' + v + ' dB' },
        { key: 'threshold', label: 'Key threshold', type: 'range', min: -70, max: -10, step: 1, value: d.threshold, fmt: v => v + ' dBFS' },
        { key: 'attack', label: 'Attack / look-ahead', type: 'range', min: 10, max: 1000, step: 5, value: d.attack, fmt: v => v + ' ms' },
        { key: 'release', label: 'Release', type: 'range', min: 50, max: 3000, step: 10, value: d.release, fmt: v => v + ' ms' }],
      onOK: v => {
        const keys = others.filter(x => v['k_' + x.id]).map(x => x.id);
        if (v.on && !keys.length) { Aero.toast('Choose at least one key track'); return; }
        t.duck = { on: !!v.on, keys, amount: v.amount, threshold: v.threshold, attack: v.attack, release: v.release };
        buildHeaders(); push(v.on ? 'Auto-Ducking' : 'Disable Ducking'); if (playing) restartPlayback();
      } });
  }
  async function importFiles(files) {
    if (!M.session) newSession(false);
    Aero.busy('Importing…'); await App.tick();
    let at = curPos(), added = 0;
    try {
      for (const f of files) {
        try {
          const r = await Codecs.decode(f.data, f.name); const id = addSource(Aero.baseName(f.name), r.chs, r.sr);
          let t = selTrackObj(); if (!t || t.clips.some(c => at < c.start + c.dur && at + r.chs[0].length / r.sr > c.start) || added) t = addTrackSilent(Aero.baseName(f.name));
          const c = makeClip(id, at); t.clips.push(c); M.selClip = c.id; added++;
        } catch (e) { Aero.alert('Import', e.message); }
      }
    } finally { Aero.busy(); }
    if (added) { buildHeaders(); resize(); push(added > 1 ? `Import ${added} Files` : 'Import File'); }
  }
  function addTrackSilent(name) { const t = newTrack(name, M.session.tracks.length); M.session.tracks.push(t); M.selTrack = t.id; return t; }
  async function importDialog() { const fs = await Aero.openFile({ accept: 'audio/*,.wav,.mp3,.ogg,.flac,.m4a,.opus,.webm', multiple: true, filters: [{ name: 'Audio', extensions: ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'opus', 'webm', 'aac'] }] }); if (fs.length) importFiles(fs); }
  function insertCurrentFile() {
    if (!App.doc) return Aero.toast('The waveform editor has no file');
    const d = App.doc; if (App.mode !== 'multi') App.setMode('multi');
    const id = addSource(d.name, d.chs, d.sr), t = addTrackSilent(d.name), c = makeClip(id, curPos()); t.clips.push(c); M.selClip = c.id;
    buildHeaders(); resize(); push('Insert File into Session');
  }
  function addRecording(chs, sr) {
    if (!M.session) newSession(false);
    const n = M.session.tracks.filter(t => /^Recording/.test(t.name)).length + 1, id = addSource('Recording ' + n, chs, sr), t = addTrackSilent('Recording ' + n), c = makeClip(id, curPos());
    t.clips.push(c); M.selClip = c.id; buildHeaders(); resize(); push('Record to Track');
  }
  function editClipSource() {
    const f = findClip(M.selClip); if (!f) return Aero.toast('Select a clip first');
    const s = source(f.c.src), a = Math.round(f.c.offset * s.sr), b = Math.round((f.c.offset + f.c.dur / rOf(f.c)) * s.sr);
    const go = () => { App.setDoc({ name: f.c.name, sr: s.sr, chs: s.chs.map(ch => ch.slice(a, b)), bits: '32-bit float' }, 'Clip from Session'); Aero.setDirty(true); Aero.toast('Clip copied to the waveform editor'); };
    if (App.doc && App.whist.items.length > 1) Aero.confirm('Copy Clip to Waveform Editor', 'Replace the file in the waveform editor with this clip? (Unsaved edits there will be lost.)', 'Replace').then(ok => ok && go()); else go();
  }
  function addMarker() { if (!M.session) return; M.session.markers = M.session.markers || []; M.session.markers.push({ id: uid(), time: curPos(), label: 'Marker ' + (M.session.markers.length + 1) }); push('Add Marker'); }
  function clearEnvelope() {
    const t = selTrackObj(); if (!t || !t.show) return Aero.toast('Show an envelope on the selected track first');
    if (t.show === 'vol') t.auto.vol = []; else if (t.show === 'pan') t.auto.pan = []; else { const f = findClip(M.selClip); (f && f.t === t ? [f.c] : t.clips).forEach(c => c.env = []); }
    buildHeaders(); push('Clear Envelope');
  }

  /* ---------- properties panel ---------- */
  function buildProps() {
    const p = document.getElementById('clipprops');
    p.innerHTML = `<div class="aero-form cp">
      <span>Name</span><input type="text" data-k="name" spellcheck="false"><span></span>
      <span>Start</span><input type="text" data-k="start" class="mono"><span></span>
      <span>Duration</span><input type="text" data-k="dur" class="mono"><span></span>
      <span>Stretch</span><input type="number" min="25" max="400" step="1" data-k="stretch" title="Time stretch (pitch preserved). Alt-drag a clip edge to stretch."><span class="dim">%</span>
      <span>Clip gain</span><input type="range" min="-24" max="12" step="0.5" data-k="gain"><span class="dim" data-v="gain"></span>
      <span>Fade in</span><input type="number" min="0" step="0.05" data-k="fadeIn"><span class="dim">s</span>
      <span>Fade out</span><input type="number" min="0" step="0.05" data-k="fadeOut"><span class="dim">s</span>
      <span>Fade curve</span><select data-k="fadeShape">${Object.entries(DSP.FADE_SHAPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><span></span>
    </div><div class="cp-btns"><button class="aero-btn small" data-a="split">Split at playhead</button><button class="aero-btn small" data-a="dup">Duplicate</button><button class="aero-btn small" data-a="del">Delete</button><button class="aero-btn small" data-a="edit">Edit in Waveform</button></div><div class="dim cp-none">Select a clip with the Move tool (V). Alt-drag a clip edge to time-stretch it.</div>`;
    const q = k => p.querySelector(`[data-k="${k}"]`);
    const set = (k, fn, label) => { const i = q(k); i.addEventListener(i.type === 'range' ? 'input' : 'change', () => { const f = findClip(M.selClip); if (!f) return; fn(f.c, i.value); render(); props(); if (i.type !== 'range') { push(label); if (playing) restartPlayback(); } }); if (i.type === 'range') i.addEventListener('change', () => { if (findClip(M.selClip)) { push(label); if (playing) restartPlayback(); } }); };
    set('name', (c, v) => c.name = v.slice(0, 80) || c.name, 'Rename Clip');
    set('start', (c, v) => { const t = App.parseT(v); if (Number.isFinite(t)) c.start = Math.max(0, t); }, 'Move Clip');
    set('dur', (c, v) => { const t = App.parseT(v); if (Number.isFinite(t)) { c.dur = clamp(t, 0.01, maxDur(c)); c.fadeIn = Math.min(c.fadeIn, c.dur); c.fadeOut = Math.min(c.fadeOut, c.dur - c.fadeIn); } }, 'Trim Clip');
    set('stretch', (c, v) => setStretch(c, (+v || 100) / 100), 'Time Stretch Clip');
    set('gain', (c, v) => c.gain = +v, 'Clip Gain');
    set('fadeIn', (c, v) => c.fadeIn = clamp(+v || 0, 0, c.dur - c.fadeOut), 'Clip Fade In');
    set('fadeOut', (c, v) => c.fadeOut = clamp(+v || 0, 0, c.dur - c.fadeIn), 'Clip Fade Out');
    set('fadeShape', (c, v) => c.fadeShape = v, 'Fade Curve');
    p.querySelector('.cp-btns').onclick = e => { const a = e.target.dataset.a; if (a === 'split') splitAtPlayhead(); if (a === 'dup') duplicateClip(); if (a === 'del') deleteClip(); if (a === 'edit') editClipSource(); };
  }
  function setStretch(c, nr) { nr = clamp(nr, 0.25, 4); const r = rOf(c); c.dur = c.dur * nr / r; c.fadeIn *= nr / r; c.fadeOut *= nr / r; c.stretch = Math.round(nr * 10000) / 10000; }
  function props() {
    const p = document.getElementById('clipprops'); if (!p) return;
    const f = findClip(M.selClip);
    p.querySelector('.cp').style.display = f ? '' : 'none'; p.querySelector('.cp-btns').style.display = f ? '' : 'none'; p.querySelector('.cp-none').style.display = f ? 'none' : '';
    if (f) {
      const c = f.c, q = k => p.querySelector(`[data-k="${k}"]`), setv = (k, v) => { const i = q(k); if (document.activeElement !== i) i.value = v; };
      setv('name', c.name); setv('start', App.fmtT(c.start)); setv('dur', App.fmtT(c.dur)); setv('stretch', Math.round(rOf(c) * 1000) / 10); setv('gain', c.gain); setv('fadeIn', c.fadeIn.toFixed(2)); setv('fadeOut', c.fadeOut.toFixed(2)); setv('fadeShape', c.fadeShape);
      p.querySelector('[data-v="gain"]').textContent = dbs(c.gain);
    }
    const si = document.getElementById('sessinfo');
    if (si) si.innerHTML = M.session ? `<b>${M.session.tracks.length}</b> tracks · <b>${(M.session.buses || []).length}</b> bus${(M.session.buses || []).length === 1 ? '' : 'es'} · <b>${M.session.tracks.reduce((a, t) => a + t.clips.length, 0)}</b> clips · ${App.fmtT(duration())} · ${M.session.sr / 1000} kHz mix` : 'No session';
    status();
  }
  function clipDialog() {
    const f = findClip(M.selClip); if (!f) return; const c = f.c;
    Aero.dialog({ title: 'Clip Properties', fields: [{ key: 'name', label: 'Name', type: 'text', value: c.name }, { key: 'gain', label: 'Clip gain', type: 'range', min: -24, max: 12, step: 0.5, value: c.gain, fmt: dbs },
      { key: 'st', label: 'Time stretch (%)', type: 'number', value: Math.round(rOf(c) * 1000) / 10, min: 25, max: 400, step: 1 },
      { key: 'fi', label: 'Fade in (s)', type: 'number', value: +c.fadeIn.toFixed(3), min: 0, step: 0.05 }, { key: 'fo', label: 'Fade out (s)', type: 'number', value: +c.fadeOut.toFixed(3), min: 0, step: 0.05 },
      { key: 'shape', label: 'Fade curve', type: 'select', value: c.fadeShape, options: Object.entries(DSP.FADE_SHAPES) }],
      onOK: v => { c.name = String(v.name).slice(0, 80) || c.name; c.gain = v.gain; if (Math.abs(v.st / 100 - rOf(c)) > 1e-4) setStretch(c, v.st / 100); c.fadeIn = clamp(v.fi, 0, c.dur); c.fadeOut = clamp(v.fo, 0, c.dur - c.fadeIn); c.fadeShape = v.shape; push('Clip Properties'); } });
  }

  /* ---------- rack target (selected track or bus) ---------- */
  function rackTarget() {
    if (!M.session) return null;
    const b = selBusObj(), t = b || selTrackObj(); if (!t) return null;
    return { rack: t.fx, label: (b ? 'Bus: ' : 'Track: ') + t.name, sr: M.session.sr, hint: b ? 'Bus insert — processes everything sent to this bus.' : 'Track insert (pre-fader) — runs live and in the mixdown.',
      changed(label) { const n = trackNodes.get(t.id); n?.chain?.update(t.fx); if (label) { push(label); buildHeaders(); } } };
  }

  /* ---------- time-stretched sources ---------- */
  const skey = (id, r) => id + '|' + r.toFixed(4);
  function stretchedChs(c) {
    const r = rOf(c); if (Math.abs(r - 1) < 1e-4) return source(c.src).chs;
    return stretchCache.get(skey(c.src, r))?.chs || null;
  }
  async function prepare() {
    const need = [];
    for (const t of M.session.tracks) for (const c of t.clips) if (Math.abs(rOf(c) - 1) >= 1e-4 && !stretchCache.has(skey(c.src, rOf(c))) && !need.some(n => skey(n.src, rOf(n)) === skey(c.src, rOf(c)))) need.push(c);
    if (!need.length) return;
    Aero.busy('Time-stretching ' + need.length + ' clip' + (need.length > 1 ? 's' : '') + '…'); await App.tick();
    try { for (const c of need) { const s = source(c.src); stretchCache.set(skey(c.src, rOf(c)), { chs: DSP.stretchPitch(s.chs, s.sr, rOf(c), 0, 'wsola') }); } }
    finally { Aero.busy(); }
  }
  function bufferFor(c) {
    const s = source(c.src), k = skey(c.src, rOf(c)), chs = stretchedChs(c);
    let b = bufCache.get(k); if (!b || b.chs !== chs) { b = { chs, ab: Engine.toBuffer(chs, s.sr) }; bufCache.set(k, b); } return b.ab;
  }

  /* ---------- playback / mixdown graph ---------- */
  let trackNodes = new Map();
  function curveFor(fn, from, end) {
    const n = Math.max(2, Math.ceil((end - from) * AUTO_RATE) + 1), cv = new Float32Array(n);
    for (let k = 0; k < n; k++) cv[k] = fn(from + k / AUTO_RATE);
    return { cv, dur: (n - 1) / AUTO_RATE };
  }
  function buildGraph(ctx, dest, t0, from, opts = {}) {
    const nodes = [], ses = M.session; trackNodes = new Map();
    const end = opts.until ?? duration();
    const master = ctx.createGain(); master.gain.value = DSP.dbToLin(ses.master.vol); master.connect(dest); nodes.push(master);
    const anySolo = ses.tracks.some(t => t.solo);
    const busIn = new Map();
    for (const b of ses.buses || []) {
      const inp = ctx.createGain(), chain = Rack.createChain(ctx, b.fx, 2), bg = ctx.createGain();
      bg.gain.value = b.mute ? 0 : DSP.dbToLin(b.vol); inp.connect(chain.input); chain.output.connect(bg); bg.connect(master);
      let an = null; if (!opts.offline) { an = ctx.createAnalyser(); an.fftSize = 1024; bg.connect(an); nodes.push(an); }
      nodes.push(inp, bg, { stop() { chain.dispose(); }, disconnect() { } }); busIn.set(b.id, inp); trackNodes.set(b.id, { bus: true, bg, chain, an });
    }
    for (const t of ses.tracks) {
      const nch = Math.min(2, Math.max(1, ...t.clips.map(c => source(c.src)?.chs.length || 1))), tin = ctx.createGain(), chain = Rack.createChain(ctx, t.fx, nch), ag = ctx.createGain(), tg = ctx.createGain(), pan = ctx.createStereoPanner();
      tin.connect(chain.input); chain.output.connect(ag); ag.connect(tg); tg.connect(pan); pan.connect(master);
      nodes.push(tin, ag, tg, pan, { stop() { chain.dispose(); }, disconnect() { } });
      tg.gain.value = (t.mute || (anySolo && !t.solo)) ? 0 : DSP.dbToLin(t.vol);
      // volume automation × ducking
      const dk = duckCurve(t), va = t.auto?.vol || [];
      if (va.length || dk) { const { cv, dur } = curveFor(tt => DSP.dbToLin(envAt(va, tt, 0) + duckAt(dk, tt)), from, end); ag.gain.value = cv[0]; ag.gain.setValueCurveAtTime(cv, t0, Math.max(0.001, dur)); }
      const pa = t.auto?.pan || [];
      if (pa.length) { const { cv, dur } = curveFor(tt => envAt(pa, tt, t.pan) / 100, from, end); pan.pan.value = cv[0]; pan.pan.setValueCurveAtTime(cv, t0, Math.max(0.001, dur)); }
      else pan.pan.value = t.pan / 100;
      const sends = new Map();
      for (const [bid, lvl] of Object.entries(t.sends || {})) { const bi = busIn.get(bid); if (!bi) continue; const sg = ctx.createGain(); sg.gain.value = DSP.dbToLin(lvl); pan.connect(sg); sg.connect(bi); nodes.push(sg); sends.set(bid, sg); }
      let an = null; if (!opts.offline) { an = ctx.createAnalyser(); an.fftSize = 1024; pan.connect(an); nodes.push(an); }
      trackNodes.set(t.id, { tg, pan, an, chain, sends, panAuto: pa.length > 0 });
      const xm = xfades(t);
      for (const c of t.clips) {
        const cend = c.start + c.dur; if (cend <= from || c.start >= end) continue;
        const into = Math.max(0, from - c.start), when = t0 + Math.max(0, c.start - from);
        const src = ctx.createBufferSource(); src.buffer = opts.offline ? opts.buffers.get(skey(c.src, rOf(c))) : bufferFor(c);
        if (!src.buffer) continue;
        const g = ctx.createGain(); src.connect(g); g.connect(tin); nodes.push(src, g);
        // gain envelope (clip gain × envelope × fades × crossfades) as a value curve
        const xf = xm.get(c.id), steps = Math.max(2, Math.min(60000, Math.ceil((c.dur - into) * AUTO_RATE)));
        const curve = new Float32Array(steps + 1); for (let k = 0; k <= steps; k++) curve[k] = clipGainAt(c, into + (c.dur - into) * k / steps, xf);
        g.gain.value = curve[0];
        if (curve.some(v => Math.abs(v - curve[0]) > 1e-7)) g.gain.setValueCurveAtTime(curve, when, Math.max(0.001, c.dur - into));
        src.start(when, c.offset * rOf(c) + into, c.dur - into);
      }
    }
    return nodes;
  }
  async function play() {
    if (!M.session) return; if (!M.session.tracks.some(t => t.clips.length)) return Aero.toast('The session is empty');
    stop(true);
    const ctx = Engine.ensure(); await Promise.all([Rack.load(ctx).catch(() => {}), prepare()]);
    const range = M.sel.b > M.sel.a ? M.sel : null;
    let from = range ? (M.playhead >= range.a && M.playhead < range.b ? M.playhead : range.a) : M.playhead;
    const endT = range ? range.b : duration();
    if (from >= endT - 0.01) from = range ? range.a : 0;
    playStartAt = M.playhead;
    playing = Engine.playGraph((ctx, dest, t0, f) => buildGraph(ctx, dest, t0, f, { until: endT }), { from, duration: endT, kind: 'multi', channels: 2, onEnd: () => { playing = null; if (App.settings.loop && range) play(); else { M.playhead = range ? range.a : endT; render(); } } });
    render();
  }
  function restartPlayback() { if (!playing) return; const p = playing.position(); M.playhead = p; play(); }
  function livePatch() {
    if (!playing) return; const ses = M.session, anySolo = ses.tracks.some(t => t.solo);
    const mvol = DSP.dbToLin(ses.master.vol); void mvol;
    for (const t of ses.tracks) {
      const n = trackNodes.get(t.id); if (!n) continue;
      n.tg.gain.value = (t.mute || (anySolo && !t.solo)) ? 0 : DSP.dbToLin(t.vol); if (!n.panAuto) n.pan.pan.value = t.pan / 100;
      for (const [bid, sg] of n.sends) sg.gain.value = t.sends?.[bid] != null ? DSP.dbToLin(t.sends[bid]) : 0;
      if ([...Object.keys(t.sends || {})].some(bid => !n.sends.has(bid) && trackNodes.get(bid))) { restartPlayback(); return; }
    }
    for (const b of ses.buses || []) { const n = trackNodes.get(b.id); if (n) n.bg.gain.value = b.mute ? 0 : DSP.dbToLin(b.vol); }
  }
  function stop(silent) { if (playing) { const p = playing; playing = null; if (Engine.current() === p) Engine.stop(); if (!silent) { M.playhead = playStartAt; render(); } } }
  function pause() { if (playing) { const p = playing.position(); stop(true); Engine.stop(); M.playhead = p; render(); } else play(); }
  function playStop() { if (playing && Engine.current() === playing) stop(); else play(); }
  function seek(t, scrub) { M.playhead = Math.max(0, t); if (playing && !scrub) restartPlayback(); render(); status(); }
  function nudge(dir) { seek(Math.max(0, M.playhead + dir * 10 / M.view.pps)); }
  const curPos = () => playing && Engine.current() === playing ? playing.position() : M.playhead;
  async function mixdown(range) {
    const ses = M.session, sr = ses.sr, a = range ? range.a : 0, b = range ? range.b : duration();
    if (b - a <= 0.01) throw new Error('The session is empty');
    await prepare();
    const n = Math.ceil((b - a) * sr), ctx = new OfflineAudioContext(2, n, sr);
    await Rack.load(ctx);
    const buffers = new Map();
    for (const t of ses.tracks) for (const c of t.clips) { const k = skey(c.src, rOf(c)); if (!buffers.has(k)) { const s = source(c.src), chs = stretchedChs(c); const ab = ctx.createBuffer(chs.length, chs[0].length, s.sr); chs.forEach((ch, i) => ab.copyToChannel(ch, i)); buffers.set(k, ab); } }
    buildGraph(ctx, ctx.destination, 0, a, { offline: true, buffers, until: b });
    const r = await ctx.startRendering();
    return { sr, chs: [r.getChannelData(0).slice(), r.getChannelData(1).slice()] };
  }
  async function mixdownToEditor() {
    if (!M.session) return;
    Aero.busy('Mixing down…'); await App.tick();
    try {
      const sel = M.sel.b > M.sel.a ? M.sel : null, r = await mixdown(sel);
      const go = () => { App.setDoc({ name: 'Mixdown', sr: r.sr, chs: r.chs, bits: '32-bit float', markers: (M.session.markers || []).map(m => ({ time: m.time - (sel ? sel.a : 0), label: m.label })).filter(m => m.time >= 0) }, 'Mixdown'); Aero.setDirty(true); Aero.toast('Mixdown opened in the waveform editor'); };
      Aero.busy();
      if (App.doc && App.whist.items.length > 1) { if (await Aero.confirm('Mixdown', 'Replace the file in the waveform editor with the mixdown?', 'Replace')) go(); } else go();
      return r;
    } catch (e) { Aero.busy(); Aero.alert('Mixdown', e.message); }
  }
  async function exportMixdown() {
    if (!M.session) return;
    Aero.busy('Mixing down…'); await App.tick();
    try { const sel = M.sel.b > M.sel.a ? M.sel : null, r = await mixdown(sel); Aero.busy(); App.exportAudio({ chs: r.chs, sr: r.sr, name: (App.projectName || 'Session') + ' mixdown', markers: (M.session.markers || []).map(m => ({ time: m.time - (sel ? sel.a : 0), label: m.label })).filter(m => m.time >= 0) }); }
    catch (e) { Aero.busy(); Aero.alert('Export Mixdown', e.message); }
  }

  /* ---------- per-frame + status ---------- */
  const tmBuf = new Float32Array(1024);
  function frame() {
    if (!M.session) return;
    const p = curPos();
    document.getElementById('lcd').textContent = App.fmtT(p);
    if (playing && Engine.current() === playing) {
      if (App.settings.follow && (p > tOf(W) || p < M.view.start)) { M.view.start = p - 10 / M.view.pps; clampView(); render(); }
      drawOverlay(); drawRuler();
    } else if (playing && Engine.current() !== playing) { playing = null; render(); }
    headers.querySelectorAll('[data-meter]').forEach(c => {
      const id = c.closest('.mt-th')?.dataset.id, n = playing ? trackNodes.get(id) : null; let pk = 0;
      if (n?.an) { n.an.getFloatTimeDomainData(tmBuf); for (let k = 0; k < tmBuf.length; k++) pk = Math.max(pk, Math.abs(tmBuf[k])); }
      const w = c.clientWidth, h = c.clientHeight; if (c.width !== w) { c.width = w; c.height = h; }
      const g = c.getContext('2d'), v = Math.max(0, (DSP.linToDb(pk) + 60) / 60), prev = +(c.dataset.v || 0), vv = Math.max(v, prev - 0.025); c.dataset.v = vv;
      g.fillStyle = '#0b1a2a'; g.fillRect(0, 0, w, h); const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, '#1fae4a'); gr.addColorStop(0.75, '#9ade4a'); gr.addColorStop(0.92, '#e8d33a'); gr.addColorStop(1, '#ff3b2a'); g.fillStyle = gr; g.fillRect(0, 0, vv * w, h);
    });
  }
  function status() {
    if (App.mode !== 'multi') return;
    const st = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
    if (!M.session) { st('st-fmt', 'No session'); return; }
    st('st-fmt', `Session · ${M.session.sr.toLocaleString()} Hz · stereo mix`);
    st('st-len', `Duration ${App.fmtT(duration())}`);
    st('st-sel', M.sel.b > M.sel.a ? `Range ${App.fmtT(M.sel.a)} – ${App.fmtT(M.sel.b)} (${App.fmtT(M.sel.b - M.sel.a)})` : `Playhead ${App.fmtT(M.playhead)}`);
    st('st-size', `${M.session.tracks.length} tracks · ${(M.session.buses || []).length} bus${(M.session.buses || []).length === 1 ? "" : "es"} · ${M.sources.size} sources`); st('st-hover', '');
  }

  /* ---------- (de)serialisation ---------- */
  function serialize() {
    if (!M.session || !M.session.tracks.length) return null;
    const used = new Set(); M.session.tracks.forEach(t => t.clips.forEach(c => used.add(c.src)));
    return { sr: M.session.sr, master: M.session.master, markers: M.session.markers || [], autoXfade: M.session.autoXfade !== false, tracks: JSON.parse(JSON.stringify(M.session.tracks)), buses: JSON.parse(JSON.stringify(M.session.buses || [])),
      sources: [...used].map(id => { const s = source(id); return { id, name: s.name, sr: s.sr, channels: s.chs.length }; }), view: M.view, playhead: M.playhead };
  }
  async function deserialize(ses, loadAudio) {
    stop(true); M.sources.clear(); bufCache.clear(); stretchCache.clear(); duckCache.clear();
    const num = (v, d = 0) => Number.isFinite(+v) && v !== null && v !== '' ? +v : d, str = (v, d) => String(v ?? d).slice(0, 120);
    const pts = (a, lo, hi, n = 2000) => (Array.isArray(a) ? a : []).filter(p => p && Number.isFinite(+p.t) && Number.isFinite(+p.v)).slice(0, n).map(p => ({ t: Math.max(0, +p.t), v: clamp(+p.v, lo, hi) })).sort((x, y) => x.t - y.t);
    for (const s of (ses.sources || []).slice(0, 256)) { const chs = await loadAudio(s); M.sources.set(String(s.id), { id: String(s.id), name: str(s.name, 'Audio'), sr: s.sr, chs }); }
    const busMap = new Map(), trackMap = new Map();
    const buses = (Array.isArray(ses.buses) ? ses.buses : []).slice(0, 8).map((b, i) => { const id = uid(); busMap.set(String(b?.id), id); return { id, name: str(b?.name, 'Bus'), color: /^#[0-9a-f]{6}$/i.test(b?.color) ? b.color : COLORS[(i + 3) % COLORS.length], vol: clamp(num(b?.vol), -48, 12), mute: !!b?.mute, fx: Rack.sanitize(b?.fx) }; });
    const tracks = (ses.tracks || []).slice(0, 64).map((t, i) => {
      const id = uid(); trackMap.set(String(t.id), id);
      const sends = {}; if (t.sends && typeof t.sends === 'object') for (const [k, v] of Object.entries(t.sends)) if (busMap.has(k) && Number.isFinite(+v)) sends[busMap.get(k)] = clamp(+v, -48, 6);
      return { id, name: str(t.name, 'Track'), color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : COLORS[i % COLORS.length], vol: clamp(num(t.vol), -48, 12), pan: clamp(num(t.pan), -100, 100), mute: !!t.mute, solo: !!t.solo,
        fx: Rack.sanitize(t.fx), auto: { vol: pts(t.auto?.vol, VMIN, VMAX), pan: pts(t.auto?.pan, -100, 100) }, show: ['vol', 'pan', 'clip'].includes(t.show) ? t.show : '', sends, duck: t.duck && typeof t.duck === 'object' ? t.duck : null, _keys: t.duck?.keys,
        clips: (t.clips || []).filter(c => M.sources.has(String(c.src))).map(c => {
          const s = M.sources.get(String(c.src)), sd = srcDur(s), off = clamp(num(c.offset), 0, sd), r = clamp(num(c.stretch, 1), 0.25, 4);
          return { id: uid(), src: String(c.src), name: str(c.name, s.name), start: Math.max(0, num(c.start)), offset: off, stretch: r, dur: clamp(num(c.dur, (sd - off) * r), 0.001, Math.max(0.001, (sd - off) * r)), gain: clamp(num(c.gain), -48, 24),
            fadeIn: Math.max(0, num(c.fadeIn)), fadeOut: Math.max(0, num(c.fadeOut)), fadeShape: DSP.FADE_SHAPES[c.fadeShape] ? c.fadeShape : 'scurve', env: pts(c.env, VMIN, VMAX) };
        }) };
    });
    for (const t of tracks) {
      const d = t.duck; delete t._keys;
      t.duck = d ? { on: !!d.on, keys: (Array.isArray(d.keys) ? d.keys : []).map(k => trackMap.get(String(k))).filter(k => k && k !== t.id), amount: clamp(num(d.amount, 12), 3, 40), threshold: clamp(num(d.threshold, -38), -70, -10), attack: clamp(num(d.attack, 120), 10, 1000), release: clamp(num(d.release, 600), 50, 3000) } : null;
    }
    M.session = { sr: [22050, 32000, 44100, 48000, 88200, 96000].includes(ses.sr) ? ses.sr : 48000, master: { vol: clamp(num(ses.master?.vol), -48, 12) }, markers: (ses.markers || []).filter(m => Number.isFinite(m.time)).map(m => ({ id: uid(), time: m.time, label: str(m.label, 'Marker') })),
      autoXfade: ses.autoXfade !== false, buses, tracks };
    M.view = { start: Math.max(0, num(ses.view?.start)), pps: clamp(num(ses.view?.pps, 60), 2, 4000) }; M.playhead = Math.max(0, num(ses.playhead)); M.sel = { a: 0, b: 0 }; M.selClip = null; M.selTrack = M.session.tracks[0]?.id;
    M.hist.reset('Open Session', snap()); buildHeaders(); resize(); props(); Rack.refresh();
  }

  return {
    get session() { return M.session; }, get hist() { return M.hist; }, get playing() { return playing; }, M, init, resize, render, newSession, openSample, podcastSession, clear, addTrack, deleteTrack, addBus, deleteBus, sendsDialog, duckDialog, clearEnvelope, importFiles, importDialog, insertCurrentFile, addRecording,
    splitAtPlayhead, deleteClip, copyClip, cutClip, pasteClip, duplicateClip, editClipSource, addMarker, play, stop, pause, playStop, seek, nudge, zoom, zoomFit, zoomSel, mixdown, mixdownToEditor, exportMixdown,
    frame, status, serialize, deserialize, source, duration, findClip, buildGraph, clipGainAt, props, rackTarget, xfades, duckCurve, envAt, setStretch, selectTrack, buildHeaders, push, prepare,
    selectAll() { if (!M.session) return; M.sel = { a: 0, b: duration() }; render(); status(); }, deselect() { M.sel = { a: 0, b: 0 }; M.selClip = null; props(); render(); },
    undo() { const s = M.hist.undo(); if (s) { restore(s); Aero.toast('Undo'); } }, redo() { const s = M.hist.redo(); if (s) { restore(s); Aero.toast('Redo'); } }, go(i) { restore(M.hist.go(i)); },
    toolChanged() { if (cOv) cOv.style.cursor = ''; render(); },
    toggleAutoXfade() { if (!M.session) return; M.session.autoXfade = M.session.autoXfade === false; push(M.session.autoXfade ? 'Auto-Crossfade On' : 'Auto-Crossfade Off'); if (playing) restartPlayback(); }
  };
})();
