'use strict';
/* Lumen Cut — WebAudio mixing. The same graph builder drives live preview (AudioContext) and export (OfflineAudioContext):
   clip source (rate = speed) → clip gain (volume keyframes × fades, as a value curve) → track gain (mute/solo) → master. */
(function () {
  const A = LC.audio = { ctx: null, master: null, an: [], live: null, peak: [-90, -90], hold: [-90, -90], holdT: [0, 0] };

  A.ensure = () => {
    if (A.ctx) return A.ctx;
    const ctx = A.ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    A.master = ctx.createGain();
    const sp = ctx.createChannelSplitter(2);
    A.an = [0, 1].map(i => { const a = ctx.createAnalyser(); a.fftSize = 2048; sp.connect(a, i); return a; });
    A.master.connect(sp); A.master.connect(ctx.destination);
    A.buf = new Float32Array(2048);
    return ctx;
  };
  A.masterGain = () => LC.dbToGain(LC.project.master || 0);
  A.setMaster = db => { LC.project.master = db; if (A.master) A.master.gain.value = LC.dbToGain(db); };

  /* Schedule every audible audio clip from timeline time t0. `when` = context time that corresponds to t0.
     rate = shuttle speed (1 = normal). tEnd = timeline end (exclusive). Returns a list of started sources. */
  A.schedule = (ctx, dest, t0, when, rate = 1, tEnd = Infinity) => {
    const P = LC.project, srcs = [];
    const solo = P.tracks.some(t => t.kind === 'audio' && t.solo);
    for (const tr of LC.audioTracks()) {
      if (tr.mute || (solo && !tr.solo)) continue;
      const tg = ctx.createGain(); tg.connect(dest);
      for (const c of LC.clipsOn(tr.id)) {
        if (c.disabled) continue;
        const rt = LC.rt.media.get(c.media); const buf = rt && rt.audio; if (!buf) continue;
        const cEnd = Math.min(c.start + c.dur, tEnd); if (cEnd <= t0 + 1e-6) continue;
        const off = Math.max(0, t0 - c.start), delay = Math.max(0, c.start - t0) / rate;
        const span = cEnd - (c.start + off); if (span <= 1e-4) continue;
        const bufOff = c.in + off * c.props.speed; if (bufOff >= buf.duration) continue;
        const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = c.props.speed * rate;
        const g = ctx.createGain();
        const n = Math.max(2, Math.ceil(span * 100) + 1), curve = new Float32Array(n);
        for (let i = 0; i < n; i++) curve[i] = LC.clipGain(c, off + span * i / (n - 1));
        g.gain.value = curve[0];
        try { g.gain.setValueCurveAtTime(curve, when + delay, span / rate); } catch (e) { }
        s.connect(g); g.connect(tg);
        s.start(when + delay, bufOff, Math.min(buf.duration - bufOff, span * c.props.speed));
        srcs.push(s);
      }
    }
    return srcs;
  };
  A.startLive = (t0, rate) => {
    A.stopLive();
    const ctx = A.ensure(); A.master.gain.value = A.masterGain();
    const when = ctx.currentTime + 0.03;
    A.live = { srcs: A.schedule(ctx, A.master, t0, when, rate), when };
    return when;
  };
  A.stopLive = () => { if (!A.live) return; A.live.srcs.forEach(s => { try { s.stop(); s.disconnect(); } catch (e) { } }); A.live = null; };

  /* Offline mixdown of [t0, t1) → AudioBuffer (stereo, 48 kHz) */
  A.mixdown = async (t0, t1, sampleRate = 48000) => {
    const len = Math.max(1, Math.ceil((t1 - t0) * sampleRate));
    const ctx = new OfflineAudioContext(2, len, sampleRate);
    const m = ctx.createGain(); m.gain.value = A.masterGain(); m.connect(ctx.destination);
    A.schedule(ctx, m, t0, 0, 1, t1);
    return ctx.startRendering();
  };

  /* ---------- level meter ---------- */
  A.levels = () => {
    if (!A.ctx || !A.live) return [-90, -90];
    return A.an.map(a => { a.getFloatTimeDomainData(A.buf); let p = 0; for (let i = 0; i < A.buf.length; i++) { const v = Math.abs(A.buf[i]); if (v > p) p = v; } return p > 0 ? 20 * Math.log10(p) : -90; });
  };
  A.drawMeter = (can) => {
    const dpr = devicePixelRatio || 1, W = can.clientWidth, H = can.clientHeight; if (!W || !H) return;
    if (can.width !== W * dpr || can.height !== H * dpr) { can.width = W * dpr; can.height = H * dpr; }
    const x = can.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    const lv = A.levels(), now = performance.now();
    const top = 8, bot = H - 16, hh = bot - top, y = db => top + hh * Math.min(1, Math.max(0, -db / 60));
    x.fillStyle = '#1b2733'; x.fillRect(0, top - 2, W, hh + 4);
    const bw = Math.floor((W - 22) / 2);
    for (let i = 0; i < 2; i++) {
      A.peak[i] = Math.max(lv[i], A.peak[i] - 1.2);
      if (lv[i] > A.hold[i]) { A.hold[i] = lv[i]; A.holdT[i] = now; } else if (now - A.holdT[i] > 1200) A.hold[i] = Math.max(-90, A.hold[i] - 2);
      const bx = 3 + i * (bw + 2);
      const g = x.createLinearGradient(0, bot, 0, top); g.addColorStop(0, '#2fbf4a'); g.addColorStop(.62, '#8ee03c'); g.addColorStop(.8, '#f2d22e'); g.addColorStop(.92, '#f08a24'); g.addColorStop(1, '#e8382a');
      x.fillStyle = '#0f171f'; x.fillRect(bx, top, bw, hh);
      const yy = y(A.peak[i]); x.fillStyle = g; x.fillRect(bx, yy, bw, bot - yy);
      x.fillStyle = 'rgba(0,0,0,.25)'; for (let k = top + 2; k < bot; k += 3) x.fillRect(bx, k, bw, 1);
      if (A.hold[i] > -60) { x.fillStyle = A.hold[i] > -1 ? '#ff4a3a' : '#e8f4ff'; x.fillRect(bx, y(A.hold[i]) - 1, bw, 2); }
    }
    x.fillStyle = '#c9d6e4'; x.font = '9px Segoe UI'; x.textAlign = 'right';
    [0, -6, -12, -18, -24, -36, -48].forEach(db => { x.fillText(String(db), W - 1, y(db) + 3); });
    x.textAlign = 'center'; x.fillStyle = '#c9d6e4'; x.fillText('L  R', 3 + bw, H - 4);
  };

  /* WAV encoder (16-bit PCM) used for the generated sample music */
  A.toWav = (buf) => {
    const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate, out = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); out.setUint32(4, 36 + n * ch * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
    out.setUint32(24, sr, true); out.setUint32(28, sr * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); ws(36, 'data'); out.setUint32(40, n * ch * 2, true);
    const data = [...Array(ch)].map((_, i) => buf.getChannelData(i)); let o = 44;
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const v = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2; }
    return new Blob([out.buffer], { type: 'audio/wav' });
  };
})();
