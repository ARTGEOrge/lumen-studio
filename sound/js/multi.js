'use strict';
/* Lumen Sound — multitrack session: tracks, clips on a timeline (move/trim/split/fades/gain), mixer, playback and mixdown. */
window.Multi = (() => {
  const { $, el, esc, clamp, uid } = Aero;
  const TRACK_H = 96, RULER_H = 26, COLORS = ['#3d8fe0', '#e0703d', '#3dbf73', '#b45ee0', '#e0c43d', '#e03d6a', '#3dc8d0', '#8d9e3d'];
  let root, cRuler, cMain, cOv, headers, lanesEl, bodyEl, scrollEl, thumb, dpr = 1, W = 0;
  const M = {
    session: null, sources: new Map(), hist: null, view: { start: 0, pps: 60 }, playhead: 0, sel: { a: 0, b: 0 }, selClip: null, selTrack: null, clipboard: null
  };
  let playStartAt = 0, playing = null, meterData = null;
  const bufCache = new Map();

  /* ---------- model ---------- */
  function newTrack(name, i) { return { id: uid(), name, color: COLORS[i % COLORS.length], vol: 0, pan: 0, mute: false, solo: false, clips: [] }; }
  function addSource(name, chs, sr) { const id = uid(); M.sources.set(id, { id, name, chs, sr }); return id; }
  const source = id => M.sources.get(id);
  function makeClip(srcId, start, name) { const s = source(srcId); return { id: uid(), src: srcId, name: name || s.name, start, offset: 0, dur: s.chs[0].length / s.sr, gain: 0, fadeIn: 0, fadeOut: 0, fadeShape: 'scurve' }; }
  function duration() { let e = 0; if (M.session) for (const t of M.session.tracks) for (const c of t.clips) e = Math.max(e, c.start + c.dur); return e; }
  const snap = () => JSON.parse(JSON.stringify({ tracks: M.session.tracks, master: M.session.master, markers: M.session.markers || [] }));
  function push(label) { M.hist.push(label, snap()); render(); props(); App.renderHist(); }
  function restore(s) { if (!s) return; M.session.tracks = JSON.parse(JSON.stringify(s.tracks)); M.session.master = { ...s.master }; M.session.markers = (s.markers || []).map(m => ({ ...m })); stop(); buildHeaders(); render(); props(); }
  function findClip(id) { for (const t of M.session?.tracks || []) { const c = t.clips.find(c => c.id === id); if (c) return { t, c }; } return null; }
  const selTrackObj = () => M.session?.tracks.find(t => t.id === M.selTrack) || M.session?.tracks[0];

  function newSession(confirmFirst) {
    const go = () => {
      stop(); M.session = { sr: 48000, tracks: [0, 1, 2, 3].map(i => newTrack('Track ' + (i + 1), i)), master: { vol: 0 }, markers: [] };
      M.sources.clear(); bufCache.clear(); M.view = { start: 0, pps: 60 }; M.playhead = 0; M.sel = { a: 0, b: 0 }; M.selClip = null; M.selTrack = M.session.tracks[0].id;
      M.hist.reset('New Session', snap()); buildHeaders(); resize(); props(); App.renderHist();
    };
    if (confirmFirst && M.session && M.session.tracks.some(t => t.clips.length)) Aero.confirm('New Session', 'Replace the current multitrack session?', 'Replace').then(ok => ok && go()); else go();
  }
  function clear() { M.session = null; M.sources.clear(); bufCache.clear(); }
  function openSample() {
    stop();
    Aero.busy('Synthesising session…');
    setTimeout(() => {
      try {
        const S = Samples.sessionSources(), sr = Samples.SR, bar = S.beat * 4;
        M.session = { sr, tracks: [], master: { vol: -3 }, markers: [{ id: uid(), time: 0, label: 'Intro' }, { id: uid(), time: bar * 4, label: 'Verse' }] };
        M.sources.clear(); bufCache.clear();
        const ids = S.srcs.map(s => addSource(s.name, s.chs, sr));
        const t = ['Drums', 'Bass', 'Keys', 'Voice'].map((n, i) => newTrack(n, i));
        const d1 = makeClip(ids[0], 0), d2 = makeClip(ids[0], d1.dur); d2.name = 'Drum Loop 2';
        t[0].clips.push(d1, d2); t[0].vol = -2;
        const b1 = makeClip(ids[1], bar * 2); b1.offset = 0; b1.dur = bar * 2; const b2 = makeClip(ids[1], bar * 4); b2.fadeOut = 1.2;
        t[1].clips.push(b1, b2); t[1].vol = -3; t[1].pan = -10;
        const k1 = makeClip(ids[2], 0); k1.fadeIn = 2.4; k1.gain = -2; const k2 = makeClip(ids[2], k1.dur); k2.fadeOut = 3; k2.fadeShape = 'log';
        t[2].clips.push(k1, k2); t[2].pan = 25; t[2].vol = -4;
        const v1 = makeClip(ids[3], bar * 1.5); v1.fadeIn = 0.05; v1.fadeOut = 0.4; const v2 = makeClip(ids[3], bar * 5); v2.gain = 1.5; v2.fadeOut = 0.6; v2.offset = 0.6; v2.dur -= 0.6; v2.name = 'Voice (answer)';
        t[3].clips.push(v1, v2); t[3].pan = -15;
        M.session.tracks = t; M.selTrack = t[3].id; M.selClip = v1.id; M.playhead = bar * 1.5; M.sel = { a: 0, b: 0 };
        M.hist.reset('Open Sample Session', snap());
        if (App.mode !== 'multi') App.setMode('multi');
        buildHeaders(); resize(); zoomFit(); props(); App.renderHist();
        App.projectName = App.doc ? App.projectName : 'Sample Session'; Aero.setDoc(App.projectName, false);
      } finally { Aero.busy(); }
    }, 20);
  }

  /* ---------- DOM ---------- */
  function init(rootEl) {
    root = rootEl;
    M.hist = new Aero.History({ max: 100, onChange: () => App.mode === 'multi' && App.renderHist() });
    root.innerHTML = `
      <div class="mt-top"><div class="mt-corner"><b>Tracks</b><button class="aero-btn small" data-add title="Add track">+ Track</button></div><canvas class="mt-ruler"></canvas></div>
      <div class="mt-body"><div class="mt-heads"></div><div class="mt-lanes"><canvas class="mt-c"></canvas><canvas class="mt-o"></canvas></div></div>
      <div class="mt-bottom"><div class="mt-corner mt-master"><b>Master</b><input type="range" min="-48" max="12" step="0.5" data-mvol><span data-mv>0.0 dB</span></div><div class="wv-scroll"><div class="wv-thumb"></div></div></div>`;
    cRuler = root.querySelector('.mt-ruler'); cMain = root.querySelector('.mt-c'); cOv = root.querySelector('.mt-o'); headers = root.querySelector('.mt-heads'); lanesEl = root.querySelector('.mt-lanes'); bodyEl = root.querySelector('.mt-body');
    scrollEl = root.querySelector('.wv-scroll'); thumb = root.querySelector('.wv-thumb');
    root.querySelector('[data-add]').onclick = () => addTrack();
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
  function buildHeaders() {
    headers.innerHTML = '';
    if (!M.session) return;
    M.session.tracks.forEach((t, i) => {
      const h = el('div', 'mt-th' + (t.id === M.selTrack ? ' sel' : ''));
      h.style.height = TRACK_H + 'px';
      h.innerHTML = `<div class="r1"><span class="mt-col" style="background:${t.color}"></span><input type="text" class="mt-name" spellcheck="false"><button class="mt-ms${t.mute ? ' on' : ''}" data-m title="Mute">M</button><button class="mt-ms s${t.solo ? ' on' : ''}" data-s title="Solo">S</button></div>
        <div class="r2"><span>Vol</span><input type="range" min="-48" max="12" step="0.5" data-v><span class="v" data-vv></span></div>
        <div class="r2"><span>Pan</span><input type="range" min="-100" max="100" step="1" data-p><span class="v" data-pv></span></div>
        <canvas class="mt-tmeter" data-meter></canvas>`;
      const q = s => h.querySelector(s);
      q('.mt-name').value = t.name;
      q('.mt-name').onchange = e => { t.name = e.target.value.slice(0, 60) || t.name; push('Rename Track'); };
      q('[data-v]').value = t.vol; q('[data-vv]').textContent = dbs(t.vol); q('[data-p]').value = t.pan; q('[data-pv]').textContent = pans(t.pan);
      q('[data-v]').oninput = e => { t.vol = +e.target.value; q('[data-vv]').textContent = dbs(t.vol); livePatch(); };
      q('[data-v]').onchange = () => push('Track Volume');
      q('[data-v]').ondblclick = () => { t.vol = 0; q('[data-v]').value = 0; q('[data-vv]').textContent = dbs(0); livePatch(); push('Track Volume'); };
      q('[data-p]').oninput = e => { t.pan = +e.target.value; q('[data-pv]').textContent = pans(t.pan); livePatch(); };
      q('[data-p]').onchange = () => push('Track Pan');
      q('[data-p]').ondblclick = () => { t.pan = 0; q('[data-p]').value = 0; q('[data-pv]').textContent = 'C'; livePatch(); push('Track Pan'); };
      q('[data-m]').onclick = () => { t.mute = !t.mute; q('[data-m]').classList.toggle('on', t.mute); livePatch(); push(t.mute ? 'Mute Track' : 'Unmute Track'); };
      q('[data-s]').onclick = () => { t.solo = !t.solo; q('[data-s]').classList.toggle('on', t.solo); livePatch(); push(t.solo ? 'Solo Track' : 'Unsolo Track'); };
      h.addEventListener('pointerdown', e => { if (M.selTrack !== t.id) { M.selTrack = t.id; headers.querySelectorAll('.mt-th').forEach((x, k) => x.classList.toggle('sel', k === i)); render(); } });
      headers.appendChild(h);
    });
    const mv = root.querySelector('[data-mvol]'); mv.value = M.session.master.vol; root.querySelector('[data-mv]').textContent = dbs(M.session.master.vol);
  }
  function sizeCanvas(c, w, h) { c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr)); c.style.width = w + 'px'; c.style.height = h + 'px'; const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return g; }
  let H = 0;
  function resize() {
    if (!root || !root.offsetParent) return;
    dpr = devicePixelRatio || 1;
    W = Math.floor(lanesEl.getBoundingClientRect().width);
    const n = M.session ? M.session.tracks.length : 0;
    H = Math.max(n * TRACK_H, bodyEl.clientHeight);
    sizeCanvas(cMain, W, H); sizeCanvas(cOv, W, H); sizeCanvas(cRuler, W, RULER_H);
    clampView(); render();
  }
  function clampView() { const v = M.view, total = Math.max(duration() + 5, 20); v.pps = clamp(v.pps, 2, 4000); v.start = clamp(v.start, 0, Math.max(0, total - W / v.pps * 0.5)); }
  const xOf = t => (t - M.view.start) * M.view.pps, tOf = x => M.view.start + x / M.view.pps;

  /* ---------- drawing ---------- */
  let raf = 0;
  function render() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
  function shapeGain(shape, t) { return DSP.fadeCurve(shape, t); }
  function clipGainAt(c, lt) { // lt: seconds inside clip (0..dur)
    let g = DSP.dbToLin(c.gain);
    if (c.fadeIn > 0 && lt < c.fadeIn) g *= shapeGain(c.fadeShape, lt / c.fadeIn);
    if (c.fadeOut > 0 && lt > c.dur - c.fadeOut) g *= shapeGain(c.fadeShape, (c.dur - lt) / c.fadeOut);
    return g;
  }
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
      for (const c of t.clips) drawClip(g, t, c, y);
    });
    // empty area below tracks
    const used = M.session.tracks.length * TRACK_H; if (H > used) { g.fillStyle = '#0a1828'; g.fillRect(0, used, W, H - used); g.fillStyle = '#4c6a8a'; g.font = '12px Segoe UI'; if (!M.session.tracks.some(t => t.clips.length)) g.fillText('Drop audio files here, use File › Import to Session, or record into a new track.', 20, used + 30); }
    drawRuler(); drawOverlay(); updateScroll();
  }
  function drawClip(g, t, c, y) {
    const x0 = xOf(c.start), x1 = xOf(c.start + c.dur); if (x1 < 0 || x0 > W) return;
    const top = y + 3, h = TRACK_H - 7, sel = c.id === M.selClip, muted = t.mute;
    g.save();
    roundRect(g, x0, top, Math.max(2, x1 - x0), h, 4); g.clip();
    const bg = g.createLinearGradient(0, top, 0, top + h); bg.addColorStop(0, hexA(t.color, sel ? 0.55 : 0.4)); bg.addColorStop(1, hexA(t.color, sel ? 0.3 : 0.2));
    g.fillStyle = bg; g.fillRect(x0, top, x1 - x0, h);
    g.fillStyle = hexA(t.color, 0.9); g.fillRect(x0, top, x1 - x0, 15);
    g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x0, top, x1 - x0, 7);
    // waveform
    const s = source(c.src);
    if (s) {
      const mid = top + 15 + (h - 15) / 2, amp = (h - 19) / 2, o = {};
      g.fillStyle = muted ? 'rgba(220,230,240,.35)' : 'rgba(235,250,255,.85)';
      const a = Math.max(0, x0), b = Math.min(W, x1);
      for (let px = Math.floor(a); px < b; px++) {
        const lt0 = tOf(px) - c.start, lt1 = tOf(px + 1) - c.start; if (lt1 < 0 || lt0 > c.dur) continue;
        let lo = 0, hi = 0; const s0 = (c.offset + lt0) * s.sr, s1 = (c.offset + lt1) * s.sr;
        for (const ch of s.chs.slice(0, 2)) { Wave.stats(ch, s0, Math.max(s0 + 1, s1), o); if (!o.empty) { lo = Math.min(lo, o.min); hi = Math.max(hi, o.max); } }
        const gg = clipGainAt(c, clamp((lt0 + lt1) / 2, 0, c.dur)) * DSP.dbToLin(t.vol);
        g.fillRect(px, mid - Math.min(1.2, hi * gg) * amp, 1, Math.max(1, (hi - lo) * gg * amp));
      }
    }
    // fades
    const fx = (lt) => xOf(c.start + lt);
    g.strokeStyle = '#ffe680'; g.lineWidth = 1.4; g.fillStyle = 'rgba(0,0,0,.28)';
    if (c.fadeIn > 0) { g.beginPath(); g.moveTo(x0, top + 15); for (let k = 0; k <= 24; k++) { const lt = c.fadeIn * k / 24; g.lineTo(fx(lt), top + h - shapeGain(c.fadeShape, k / 24) * (h - 15)); } g.lineTo(x0, top + h); g.closePath(); g.fill(); g.beginPath(); for (let k = 0; k <= 24; k++) { const lt = c.fadeIn * k / 24; const yy = top + h - shapeGain(c.fadeShape, k / 24) * (h - 15); k ? g.lineTo(fx(lt), yy) : g.moveTo(fx(lt), yy); } g.stroke(); }
    if (c.fadeOut > 0) { g.beginPath(); g.moveTo(x1, top + 15); for (let k = 0; k <= 24; k++) { const lt = c.dur - c.fadeOut * k / 24; g.lineTo(fx(lt), top + h - shapeGain(c.fadeShape, k / 24) * (h - 15)); } g.lineTo(x1, top + h); g.closePath(); g.fill(); g.beginPath(); for (let k = 0; k <= 24; k++) { const lt = c.dur - c.fadeOut * k / 24; const yy = top + h - shapeGain(c.fadeShape, k / 24) * (h - 15); k ? g.lineTo(fx(lt), yy) : g.moveTo(fx(lt), yy); } g.stroke(); }
    // title
    g.fillStyle = '#fff'; g.font = '600 10.5px Segoe UI, sans-serif'; g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 2;
    g.fillText(c.name + (c.gain ? `  (${dbs(c.gain)})` : ''), x0 + 6, top + 11.5); g.shadowBlur = 0;
    g.restore();
    // fade handles + border
    roundRect(g, x0 + 0.5, top + 0.5, Math.max(2, x1 - x0 - 1), h - 1, 4); g.strokeStyle = sel ? '#fff' : hexA(t.color, 1); g.lineWidth = sel ? 2 : 1; g.stroke();
    if (sel || x1 - x0 > 40) {
      g.fillStyle = '#ffe680'; g.strokeStyle = '#5a4500'; g.lineWidth = 1;
      const hi = fx(c.fadeIn), ho = fx(c.dur - c.fadeOut);
      g.fillRect(hi - 4, top + 15, 8, 8); g.strokeRect(hi - 3.5, top + 15.5, 7, 7); g.fillRect(ho - 4, top + 15, 8, 8); g.strokeRect(ho - 3.5, top + 15.5, 7, 7);
    }
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
  let drag = null, snapLine = null;
  const lx = e => e.clientX - lanesEl.getBoundingClientRect().left, ly = e => e.clientY - lanesEl.getBoundingClientRect().top;
  function hit(x, y) {
    const ti = Math.floor(y / TRACK_H), t = M.session?.tracks[ti]; if (!t) return { ti };
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
  function bindCanvas() {
    cOv.addEventListener('contextmenu', e => e.preventDefault());
    cOv.addEventListener('pointerdown', e => {
      if (!M.session) return;
      const x = lx(e), y = ly(e), tool = App.tool(), h = hit(x, y);
      try { cOv.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ };
      if (h.t && M.selTrack !== h.t.id) { M.selTrack = h.t.id; headers.querySelectorAll('.mt-th').forEach((d, k) => d.classList.toggle('sel', k === h.ti)); }
      if (tool === 'hand' || e.button === 1) { drag = { mode: 'pan', x0: x, s0: M.view.start }; return; }
      if (tool === 'razor') { if (h.c) { splitClip(h.t, h.c, snapTime(tOf(x), null) ?? tOf(x)); } return; }
      if (tool === 'move' && h.c) {
        M.selClip = h.c.id; props();
        drag = { mode: h.part, clip: h.c, track: h.t, x0: x, y0: y, orig: { ...h.c }, moved: false };
        render(); return;
      }
      // time selection / playhead
      M.selClip = h.c && tool === 'select' ? M.selClip : (tool === 'move' ? null : M.selClip); props();
      const t = Math.max(0, snapTime(tOf(x)) ?? tOf(x));
      drag = { mode: 'sel', anchor: t, x0: x, moved: false };
    });
    cOv.addEventListener('pointermove', e => {
      const x = lx(e), y = ly(e);
      if (!drag) { const h = hit(x, y), tool = App.tool(); cOv.style.cursor = tool === 'hand' ? 'grab' : tool === 'razor' ? (h.c ? 'crosshair' : 'default') : tool === 'move' && h.c ? ({ left: 'w-resize', right: 'e-resize', fadeIn: 'ew-resize', fadeOut: 'ew-resize', body: 'move' })[h.part] : 'text'; return; }
      if (drag.mode === 'pan') { M.view.start = drag.s0 - (x - drag.x0) / M.view.pps; clampView(); render(); return; }
      if (drag.mode === 'sel') { if (Math.abs(x - drag.x0) > 3) drag.moved = true; if (drag.moved) { const t = Math.max(0, snapTime(tOf(x)) ?? tOf(x)); M.sel = { a: Math.min(drag.anchor, t), b: Math.max(drag.anchor, t) }; render(); status(); } return; }
      const c = drag.clip, o = drag.orig, dt = (x - drag.x0) / M.view.pps, s = source(c.src), srcDur = s.chs[0].length / s.sr;
      if (Math.abs(x - drag.x0) > 2 || Math.abs(y - drag.y0) > 4) drag.moved = true; if (!drag.moved) return;
      snapLine = null;
      if (drag.mode === 'body') {
        let ns = Math.max(0, o.start + dt);
        const sA = snapTime(ns, c.id), sB = snapTime(ns + c.dur, c.id);
        if (sA != null && (sB == null || Math.abs(sA - ns) <= Math.abs(sB - ns - c.dur))) { ns = sA; snapLine = sA; } else if (sB != null) { ns = sB - c.dur; snapLine = sB; }
        c.start = Math.max(0, ns);
        const ti = clamp(Math.floor(y / TRACK_H), 0, M.session.tracks.length - 1), nt = M.session.tracks[ti];
        if (nt !== drag.track) { drag.track.clips = drag.track.clips.filter(k => k !== c); nt.clips.push(c); drag.track = nt; M.selTrack = nt.id; }
      } else if (drag.mode === 'left') {
        let ns = clamp(o.start + dt, o.start - o.offset, o.start + o.dur - 0.01); const sn = snapTime(ns, c.id); if (sn != null && sn >= o.start - o.offset && sn < o.start + o.dur - 0.01) { ns = sn; snapLine = sn; }
        ns = Math.max(0, ns); const d = ns - o.start; c.start = ns; c.offset = o.offset + d; c.dur = o.dur - d; c.fadeIn = Math.min(c.fadeIn, c.dur); c.fadeOut = Math.min(c.fadeOut, c.dur - c.fadeIn);
      } else if (drag.mode === 'right') {
        let ne = clamp(o.start + o.dur + dt, o.start + 0.01, o.start + srcDur - o.offset); const sn = snapTime(ne, c.id); if (sn != null && sn > o.start + 0.01 && sn <= o.start + srcDur - o.offset) { ne = sn; snapLine = sn; }
        c.dur = ne - o.start; c.fadeOut = Math.min(c.fadeOut, c.dur); c.fadeIn = Math.min(c.fadeIn, c.dur - c.fadeOut);
      } else if (drag.mode === 'fadeIn') c.fadeIn = clamp(o.fadeIn + dt, 0, c.dur - c.fadeOut);
      else if (drag.mode === 'fadeOut') c.fadeOut = clamp(o.fadeOut - dt, 0, c.dur - c.fadeIn);
      render(); props();
    });
    const end = () => {
      if (!drag) return;
      const d = drag; drag = null; snapLine = null;
      if (d.mode === 'sel') { if (!d.moved) { M.sel = { a: 0, b: 0 }; seek(d.anchor); } else status(); render(); return; }
      if (d.mode === 'pan') return;
      if (d.moved) { buildHeaders(); push({ body: 'Move Clip', left: 'Trim Clip', right: 'Trim Clip', fadeIn: 'Clip Fade In', fadeOut: 'Clip Fade Out' }[d.mode]); if (playing) restartPlayback(); }
      render();
    };
    cOv.addEventListener('pointerup', end); cOv.addEventListener('pointercancel', end);
    cOv.addEventListener('dblclick', e => { const h = hit(lx(e), ly(e)); if (h.c) { M.selClip = h.c.id; props(); clipDialog(); } });
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
  function splitClip(t, c, at) {
    if (at <= c.start + 0.005 || at >= c.start + c.dur - 0.005) return Aero.toast('Split point must be inside the clip');
    const d = at - c.start, c2 = { ...c, id: uid(), start: at, offset: c.offset + d, dur: c.dur - d, fadeIn: 0, fadeOut: Math.min(c.fadeOut, c.dur - d) };
    c.dur = d; c.fadeOut = 0; c.fadeIn = Math.min(c.fadeIn, d);
    t.clips.push(c2); M.selClip = c2.id; push('Split Clip');
  }
  function splitAtPlayhead() {
    if (!M.session) return; const p = curPos();
    const f = findClip(M.selClip);
    let targets = f && p > f.c.start && p < f.c.start + f.c.dur ? [f] : [];
    if (!targets.length) for (const t of M.session.tracks) for (const c of t.clips) if (p > c.start + 0.005 && p < c.start + c.dur - 0.005 && (t.id === M.selTrack)) targets.push({ t, c });
    if (!targets.length) for (const t of M.session.tracks) for (const c of t.clips) if (p > c.start + 0.005 && p < c.start + c.dur - 0.005) targets.push({ t, c });
    if (!targets.length) return Aero.toast('No clip under the playhead');
    for (const { t, c } of targets) { const d = p - c.start; const c2 = { ...c, id: uid(), start: p, offset: c.offset + d, dur: c.dur - d, fadeIn: 0, fadeOut: Math.min(c.fadeOut, c.dur - d) }; c.dur = d; c.fadeOut = 0; c.fadeIn = Math.min(c.fadeIn, d); t.clips.push(c2); }
    push(targets.length > 1 ? `Split ${targets.length} Clips` : 'Split Clip');
  }
  function deleteClip() { const f = findClip(M.selClip); if (!f) return Aero.toast('Select a clip first'); f.t.clips = f.t.clips.filter(c => c !== f.c); M.selClip = null; push('Delete Clip'); }
  function copyClip() { const f = findClip(M.selClip); if (!f) return Aero.toast('Select a clip first'); M.clipboard = { ...f.c }; Aero.toast('Clip copied'); }
  function cutClip() { if (!findClip(M.selClip)) return Aero.toast('Select a clip first'); copyClip(); deleteClip(); }
  function pasteClip() { if (!M.clipboard) return Aero.toast('Nothing to paste'); const t = selTrackObj(); if (!t) return; const c = { ...M.clipboard, id: uid(), start: curPos() }; t.clips.push(c); M.selClip = c.id; push('Paste Clip'); }
  function duplicateClip() { const f = findClip(M.selClip); if (!f) return Aero.toast('Select a clip first'); const c = { ...f.c, id: uid(), start: f.c.start + f.c.dur }; f.t.clips.push(c); M.selClip = c.id; push('Duplicate Clip'); }
  function addTrack(name) { if (!M.session) newSession(false); const t = newTrack(name || 'Track ' + (M.session.tracks.length + 1), M.session.tracks.length); M.session.tracks.push(t); M.selTrack = t.id; buildHeaders(); resize(); push('Add Track'); return t; }
  function deleteTrack() {
    const t = selTrackObj(); if (!t) return;
    const go = () => { M.session.tracks = M.session.tracks.filter(x => x !== t); M.selTrack = M.session.tracks[0]?.id; buildHeaders(); resize(); push('Delete Track'); };
    if (t.clips.length) Aero.confirm('Delete Track', `Delete “${t.name}” and its ${t.clips.length} clip(s)?`, 'Delete').then(ok => ok && go()); else go();
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
    const s = source(f.c.src), a = Math.round(f.c.offset * s.sr), b = Math.round((f.c.offset + f.c.dur) * s.sr);
    const go = () => { App.setDoc({ name: f.c.name, sr: s.sr, chs: s.chs.map(ch => ch.slice(a, b)), bits: '32-bit float' }, 'Clip from Session'); Aero.setDirty(true); Aero.toast('Clip copied to the waveform editor'); };
    if (App.doc && App.whist.items.length > 1) Aero.confirm('Copy Clip to Waveform Editor', 'Replace the file in the waveform editor with this clip? (Unsaved edits there will be lost.)', 'Replace').then(ok => ok && go()); else go();
  }
  function addMarker() { if (!M.session) return; M.session.markers = M.session.markers || []; M.session.markers.push({ id: uid(), time: curPos(), label: 'Marker ' + (M.session.markers.length + 1) }); push('Add Marker'); }

  /* ---------- properties panel ---------- */
  function buildProps() {
    const p = document.getElementById('clipprops');
    p.innerHTML = `<div class="aero-form cp">
      <span>Name</span><input type="text" data-k="name" spellcheck="false"><span></span>
      <span>Start</span><input type="text" data-k="start" class="mono"><span></span>
      <span>Duration</span><input type="text" data-k="dur" class="mono"><span></span>
      <span>Clip gain</span><input type="range" min="-24" max="12" step="0.5" data-k="gain"><span class="dim" data-v="gain"></span>
      <span>Fade in</span><input type="number" min="0" step="0.05" data-k="fadeIn"><span class="dim">s</span>
      <span>Fade out</span><input type="number" min="0" step="0.05" data-k="fadeOut"><span class="dim">s</span>
      <span>Fade curve</span><select data-k="fadeShape">${Object.entries(DSP.FADE_SHAPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><span></span>
    </div><div class="cp-btns"><button class="aero-btn small" data-a="split">Split at playhead</button><button class="aero-btn small" data-a="dup">Duplicate</button><button class="aero-btn small" data-a="del">Delete</button><button class="aero-btn small" data-a="edit">Edit in Waveform</button></div><div class="dim cp-none">Select a clip with the Move tool (V).</div>`;
    const q = k => p.querySelector(`[data-k="${k}"]`);
    const set = (k, fn, label) => { const i = q(k); i.addEventListener(i.type === 'range' ? 'input' : 'change', () => { const f = findClip(M.selClip); if (!f) return; fn(f.c, i.value); render(); props(); if (i.type !== 'range') { push(label); if (playing) restartPlayback(); } }); if (i.type === 'range') i.addEventListener('change', () => { if (findClip(M.selClip)) { push(label); if (playing) restartPlayback(); } }); };
    set('name', (c, v) => c.name = v.slice(0, 80) || c.name, 'Rename Clip');
    set('start', (c, v) => { const t = App.parseT(v); if (Number.isFinite(t)) c.start = Math.max(0, t); }, 'Move Clip');
    set('dur', (c, v) => { const t = App.parseT(v), s = source(c.src); if (Number.isFinite(t)) { c.dur = clamp(t, 0.01, s.chs[0].length / s.sr - c.offset); c.fadeIn = Math.min(c.fadeIn, c.dur); c.fadeOut = Math.min(c.fadeOut, c.dur - c.fadeIn); } }, 'Trim Clip');
    set('gain', (c, v) => c.gain = +v, 'Clip Gain');
    set('fadeIn', (c, v) => c.fadeIn = clamp(+v || 0, 0, c.dur - c.fadeOut), 'Clip Fade In');
    set('fadeOut', (c, v) => c.fadeOut = clamp(+v || 0, 0, c.dur - c.fadeIn), 'Clip Fade Out');
    set('fadeShape', (c, v) => c.fadeShape = v, 'Fade Curve');
    p.querySelector('.cp-btns').onclick = e => { const a = e.target.dataset.a; if (a === 'split') splitAtPlayhead(); if (a === 'dup') duplicateClip(); if (a === 'del') deleteClip(); if (a === 'edit') editClipSource(); };
  }
  function props() {
    const p = document.getElementById('clipprops'); if (!p) return;
    const f = findClip(M.selClip);
    p.querySelector('.cp').style.display = f ? '' : 'none'; p.querySelector('.cp-btns').style.display = f ? '' : 'none'; p.querySelector('.cp-none').style.display = f ? 'none' : '';
    if (f) {
      const c = f.c, q = k => p.querySelector(`[data-k="${k}"]`), setv = (k, v) => { const i = q(k); if (document.activeElement !== i) i.value = v; };
      setv('name', c.name); setv('start', App.fmtT(c.start)); setv('dur', App.fmtT(c.dur)); setv('gain', c.gain); setv('fadeIn', c.fadeIn.toFixed(2)); setv('fadeOut', c.fadeOut.toFixed(2)); setv('fadeShape', c.fadeShape);
      p.querySelector('[data-v="gain"]').textContent = dbs(c.gain);
    }
    const si = document.getElementById('sessinfo');
    if (si) si.innerHTML = M.session ? `<b>${M.session.tracks.length}</b> tracks · <b>${M.session.tracks.reduce((a, t) => a + t.clips.length, 0)}</b> clips · ${App.fmtT(duration())} · ${M.session.sr / 1000} kHz mix` : 'No session';
    status();
  }
  function clipDialog() {
    const f = findClip(M.selClip); if (!f) return; const c = f.c;
    Aero.dialog({ title: 'Clip Properties', fields: [{ key: 'name', label: 'Name', type: 'text', value: c.name }, { key: 'gain', label: 'Clip gain', type: 'range', min: -24, max: 12, step: 0.5, value: c.gain, fmt: dbs },
      { key: 'fi', label: 'Fade in (s)', type: 'number', value: +c.fadeIn.toFixed(3), min: 0, step: 0.05 }, { key: 'fo', label: 'Fade out (s)', type: 'number', value: +c.fadeOut.toFixed(3), min: 0, step: 0.05 },
      { key: 'shape', label: 'Fade curve', type: 'select', value: c.fadeShape, options: Object.entries(DSP.FADE_SHAPES) }],
      onOK: v => { c.name = String(v.name).slice(0, 80) || c.name; c.gain = v.gain; c.fadeIn = clamp(v.fi, 0, c.dur); c.fadeOut = clamp(v.fo, 0, c.dur - c.fadeIn); c.fadeShape = v.shape; push('Clip Properties'); } });
  }

  /* ---------- playback / mixdown ---------- */
  function bufferFor(id) { const s = source(id); let b = bufCache.get(id); if (!b || b.chs !== s.chs) { b = { chs: s.chs, ab: Engine.toBuffer(s.chs, s.sr) }; bufCache.set(id, b); } return b.ab; }
  let trackNodes = new Map();
  function buildGraph(ctx, dest, t0, from, opts = {}) {
    const nodes = [], ses = M.session; trackNodes = new Map();
    const master = ctx.createGain(); master.gain.value = DSP.dbToLin(ses.master.vol); master.connect(dest); nodes.push(master);
    const anySolo = ses.tracks.some(t => t.solo);
    for (const t of ses.tracks) {
      const tg = ctx.createGain(), pan = ctx.createStereoPanner(); tg.gain.value = (t.mute || (anySolo && !t.solo)) ? 0 : DSP.dbToLin(t.vol); pan.pan.value = t.pan / 100;
      tg.connect(pan); pan.connect(master); nodes.push(tg, pan);
      let an = null; if (!opts.offline) { an = ctx.createAnalyser(); an.fftSize = 1024; pan.connect(an); nodes.push(an); }
      trackNodes.set(t.id, { tg, pan, an });
      for (const c of t.clips) {
        const end = c.start + c.dur; if (end <= from || (opts.until != null && c.start >= opts.until)) continue;
        const into = Math.max(0, from - c.start), when = t0 + Math.max(0, c.start - from);
        const src = ctx.createBufferSource(); src.buffer = opts.offline ? opts.buffers.get(c.src) : bufferFor(c.src);
        const g = ctx.createGain(); src.connect(g); g.connect(tg); nodes.push(src, g);
        // gain envelope (clip gain × fades) as a value curve
        const steps = Math.max(2, Math.min(2000, Math.ceil((c.dur - into) * 50)));
        const curve = new Float32Array(steps + 1); for (let k = 0; k <= steps; k++) curve[k] = clipGainAt(c, into + (c.dur - into) * k / steps);
        g.gain.value = curve[0];
        if (c.fadeIn > 0 || c.fadeOut > 0) g.gain.setValueCurveAtTime(curve, when, Math.max(0.001, c.dur - into));
        src.start(when, c.offset + into, c.dur - into);
      }
    }
    return nodes;
  }
  function play() {
    if (!M.session) return; if (!M.session.tracks.some(t => t.clips.length)) return Aero.toast('The session is empty');
    stop(true);
    const range = M.sel.b > M.sel.a ? M.sel : null;
    let from = range ? (M.playhead >= range.a && M.playhead < range.b ? M.playhead : range.a) : M.playhead;
    const endT = range ? range.b : duration();
    if (from >= endT - 0.01) from = range ? range.a : 0;
    playStartAt = M.playhead;
    playing = Engine.playGraph((ctx, dest, t0, f) => buildGraph(ctx, dest, t0, f, { until: endT }), { from, duration: endT, kind: 'multi', channels: 2, onEnd: () => { playing = null; if (App.settings.loop && range) play(); else { M.playhead = range ? range.a : endT; render(); } } });
    render();
  }
  function restartPlayback() { if (!playing) return; const p = playing.position(); M.playhead = p; play(); }
  function livePatch() { if (!playing) return; const ses = M.session, anySolo = ses.tracks.some(t => t.solo); for (const t of ses.tracks) { const n = trackNodes.get(t.id); if (!n) continue; n.tg.gain.value = (t.mute || (anySolo && !t.solo)) ? 0 : DSP.dbToLin(t.vol); n.pan.pan.value = t.pan / 100; } }
  function stop(silent) { if (playing) { const p = playing; playing = null; if (Engine.current() === p) Engine.stop(); if (!silent) { M.playhead = playStartAt; render(); } } }
  function pause() { if (playing) { const p = playing.position(); stop(true); Engine.stop(); M.playhead = p; render(); } else play(); }
  function playStop() { if (playing && Engine.current() === playing) stop(); else play(); }
  function seek(t, scrub) { M.playhead = Math.max(0, t); if (playing && !scrub) restartPlayback(); render(); status(); }
  function nudge(dir) { seek(Math.max(0, M.playhead + dir * 10 / M.view.pps)); }
  const curPos = () => playing && Engine.current() === playing ? playing.position() : M.playhead;
  async function mixdown(range) {
    const ses = M.session, sr = ses.sr, a = range ? range.a : 0, b = range ? range.b : duration();
    if (b - a <= 0.01) throw new Error('The session is empty');
    const n = Math.ceil((b - a) * sr), ctx = new OfflineAudioContext(2, n, sr);
    const buffers = new Map(); for (const t of ses.tracks) for (const c of t.clips) if (!buffers.has(c.src)) { const s = source(c.src); const ab = ctx.createBuffer(s.chs.length, s.chs[0].length, s.sr); s.chs.forEach((ch, i) => ab.copyToChannel(ch, i)); buffers.set(c.src, ab); }
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
    try { const sel = M.sel.b > M.sel.a ? M.sel : null, r = await mixdown(sel); Aero.busy(); App.exportAudio({ chs: r.chs, sr: r.sr, name: (App.projectName || 'Session') + ' mixdown', markers: [] }); }
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
    // track meters
    headers.querySelectorAll('[data-meter]').forEach((c, i) => {
      const t = M.session.tracks[i], n = t && playing ? trackNodes.get(t.id) : null; let pk = 0;
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
    st('st-size', `${M.session.tracks.length} tracks · ${M.sources.size} sources`); st('st-hover', '');
  }

  /* ---------- (de)serialisation ---------- */
  function serialize() {
    if (!M.session || !M.session.tracks.length) return null;
    const used = new Set(); M.session.tracks.forEach(t => t.clips.forEach(c => used.add(c.src)));
    return { sr: M.session.sr, master: M.session.master, markers: M.session.markers || [], tracks: JSON.parse(JSON.stringify(M.session.tracks)), sources: [...used].map(id => { const s = source(id); return { id, name: s.name, sr: s.sr, channels: s.chs.length }; }), view: M.view, playhead: M.playhead };
  }
  async function deserialize(ses, loadAudio) {
    stop(true); M.sources.clear(); bufCache.clear();
    const num = (v, d = 0) => Number.isFinite(+v) ? +v : d, str = (v, d) => String(v ?? d).slice(0, 120);
    for (const s of ses.sources || []) { const chs = await loadAudio(s); M.sources.set(String(s.id), { id: String(s.id), name: str(s.name, 'Audio'), sr: s.sr, chs }); }
    M.session = { sr: [22050, 32000, 44100, 48000, 88200, 96000].includes(ses.sr) ? ses.sr : 48000, master: { vol: clamp(num(ses.master?.vol), -48, 12) }, markers: (ses.markers || []).filter(m => Number.isFinite(m.time)).map(m => ({ id: uid(), time: m.time, label: str(m.label, 'Marker') })),
      tracks: (ses.tracks || []).slice(0, 64).map((t, i) => ({ id: uid(), name: str(t.name, 'Track'), color: /^#[0-9a-f]{6}$/i.test(t.color) ? t.color : COLORS[i % COLORS.length], vol: clamp(num(t.vol), -48, 12), pan: clamp(num(t.pan), -100, 100), mute: !!t.mute, solo: !!t.solo,
        clips: (t.clips || []).filter(c => M.sources.has(String(c.src))).map(c => { const s = M.sources.get(String(c.src)), sd = s.chs[0].length / s.sr, off = clamp(num(c.offset), 0, sd); return { id: uid(), src: String(c.src), name: str(c.name, s.name), start: Math.max(0, num(c.start)), offset: off, dur: clamp(num(c.dur, sd), 0.001, sd - off), gain: clamp(num(c.gain), -48, 24), fadeIn: Math.max(0, num(c.fadeIn)), fadeOut: Math.max(0, num(c.fadeOut)), fadeShape: DSP.FADE_SHAPES[c.fadeShape] ? c.fadeShape : 'scurve' }; }) })) };
    M.view = { start: Math.max(0, num(ses.view?.start)), pps: clamp(num(ses.view?.pps, 60), 2, 4000) }; M.playhead = Math.max(0, num(ses.playhead)); M.sel = { a: 0, b: 0 }; M.selClip = null; M.selTrack = M.session.tracks[0]?.id;
    M.hist.reset('Open Session', snap()); buildHeaders(); resize(); props();
  }

  return {
    get session() { return M.session; }, get hist() { return M.hist; }, M, init, resize, render, newSession, openSample, clear, addTrack, deleteTrack, importFiles, importDialog, insertCurrentFile, addRecording,
    splitAtPlayhead, deleteClip, copyClip, cutClip, pasteClip, duplicateClip, editClipSource, addMarker, play, stop, pause, playStop, seek, nudge, zoom, zoomFit, zoomSel, mixdown, mixdownToEditor, exportMixdown,
    frame, status, serialize, deserialize, source, duration, findClip, buildGraph, clipGainAt, props,
    selectAll() { if (!M.session) return; M.sel = { a: 0, b: duration() }; render(); status(); }, deselect() { M.sel = { a: 0, b: 0 }; M.selClip = null; props(); render(); },
    undo() { const s = M.hist.undo(); if (s) { restore(s); Aero.toast('Undo'); } }, redo() { const s = M.hist.redo(); if (s) { restore(s); Aero.toast('Redo'); } }, go(i) { restore(M.hist.go(i)); },
    toolChanged() { if (cOv) cOv.style.cursor = ''; }
  };
})();
