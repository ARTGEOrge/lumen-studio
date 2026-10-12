'use strict';
/* Lumen Cut — WebAudio mixing. The same graph builder drives live preview (AudioContext) and export (OfflineAudioContext):
   clip source (rate = speed or speed-ramp curve) → [noise gate, pre-rendered] → EQ → compressor → reverb → clip gain
   (volume keyframes × fades × crossfades, as a value curve) → track gain (volume / automation, mute/solo) → pan → master. */
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

  /* ---------- effect helpers ---------- */
  const gateCache = new Map();
  // noise gate rendered on the source buffer: envelope follower + smoothed open/close gain
  A.gateBuffer = (buf, g, key) => {
    const k = key + '|' + g.thr + '|' + g.att + '|' + g.rel;
    if (gateCache.has(k)) return gateCache.get(k);
    const sr = buf.sampleRate, n = buf.length, ch = buf.numberOfChannels, src = [...Array(ch)].map((_, i) => buf.getChannelData(i));
    const out = new AudioBuffer({ length: n, sampleRate: sr, numberOfChannels: ch }), dst = [...Array(ch)].map((_, i) => out.getChannelData(i));
    const thr = Math.pow(10, g.thr / 20), envRel = Math.exp(-1 / (sr * .02)), ga = 1 - Math.exp(-1 / (sr * g.att / 1000)), gr = 1 - Math.exp(-1 / (sr * g.rel / 1000));
    let env = 0, gain = 0;
    for (let i = 0; i < n; i++) {
      let p = 0; for (let c = 0; c < ch; c++) { const v = Math.abs(src[c][i]); if (v > p) p = v; }
      env = p > env ? p : env * envRel;
      const target = env >= thr ? 1 : 0; gain += (target - gain) * (target > gain ? ga : gr);
      for (let c = 0; c < ch; c++) dst[c][i] = src[c][i] * gain;
    }
    if (gateCache.size > 8) gateCache.delete(gateCache.keys().next().value);
    gateCache.set(k, out); return out;
  };
  const irCache = new Map();
  A.impulse = (size, sr) => {
    const k = size.toFixed(2) + '|' + sr; if (irCache.has(k)) return irCache.get(k);
    const len = Math.max(1, Math.round(sr * size)), ir = new AudioBuffer({ length: len, sampleRate: sr, numberOfChannels: 2 });
    let seed = 12345; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) { const t = i / len; d[i] = rnd() * Math.pow(1 - t, 3.2) * (i < sr * .004 ? i / (sr * .004) : 1); } }
    irCache.set(k, ir); return ir;
  };
  /* build the per-clip effect chain; returns {input, output} */
  function fxChain(ctx, c) {
    const fx = c.afx; let input = null, last = null;
    const add = node => { if (!input) input = node; else last.connect(node); last = node; return node; };
    if (fx?.eq?.on) {
      const lo = ctx.createBiquadFilter(); lo.type = 'lowshelf'; lo.frequency.value = 200; lo.gain.value = fx.eq.low;
      const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = fx.eq.midF; mid.Q.value = .9; mid.gain.value = fx.eq.mid;
      const hi = ctx.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 4000; hi.gain.value = fx.eq.high;
      add(lo); add(mid); add(hi);
    }
    if (fx?.comp?.on) {
      const k = ctx.createDynamicsCompressor(); k.threshold.value = fx.comp.thr; k.ratio.value = fx.comp.ratio; k.knee.value = 6;
      k.attack.value = fx.comp.att / 1000; k.release.value = fx.comp.rel / 1000; add(k);
      const mk = ctx.createGain(); mk.gain.value = LC.dbToGain(fx.comp.gain); add(mk);
    }
    if (fx?.verb?.on && fx.verb.mix > 0) {
      const inG = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain(), sum = ctx.createGain(), cv = ctx.createConvolver();
      cv.normalize = true; cv.buffer = A.impulse(fx.verb.size, ctx.sampleRate);
      const m = fx.verb.mix / 100; dry.gain.value = Math.cos(m * Math.PI / 2); wet.gain.value = Math.sin(m * Math.PI / 2) * 1.2;
      inG.connect(dry).connect(sum); inG.connect(cv).connect(wet).connect(sum);
      if (!input) input = inG; else last.connect(inG); last = sum;
    }
    if (!input) { const g = ctx.createGain(); input = last = g; }
    return { input, output: last };
  }
  A.fxChain = fxChain;

  /* Schedule every audible audio clip from timeline time t0. `when` = context time that corresponds to t0.
     rate = shuttle speed (1 = normal). tEnd = timeline end (exclusive). Returns {srcs, tracks, meters}. */
  A.schedule = (ctx, dest, t0, when, rate = 1, tEnd = Infinity, opts = {}) => {
    const P = LC.project, srcs = [], tracks = new Map(), meters = new Map();
    const solo = P.tracks.some(t => t.kind === 'audio' && t.solo);
    const seqEnd = Math.min(tEnd, LC.seqDuration());
    for (const tr of LC.audioTracks()) {
      const silent = tr.mute || (solo && !tr.solo);
      const tg = ctx.createGain(), pan = ctx.createStereoPanner();
      pan.pan.value = (tr.pan || 0) / 100; tg.connect(pan); pan.connect(dest);
      if (opts.meters) { const sp = ctx.createChannelSplitter(2); pan.connect(sp); meters.set(tr.id, [0, 1].map(i => { const a = ctx.createAnalyser(); a.fftSize = 1024; sp.connect(a, i); return a; })); }
      tracks.set(tr.id, { g: tg, pan });
      if (silent) { tg.gain.value = 0; continue; }
      if (tr.kf?.vol?.length && seqEnd > t0) {          // track volume automation as a value curve
        const span = seqEnd - t0, n = Math.max(2, Math.min(200000, Math.ceil(span * 50) + 1)), curve = new Float32Array(n);
        for (let i = 0; i < n; i++) curve[i] = LC.dbToGain(LC.trackVol(tr, t0 + span * i / (n - 1)));
        tg.gain.value = curve[0];
        try { tg.gain.setValueCurveAtTime(curve, when, span / rate); } catch (e) { }
      } else tg.gain.value = LC.dbToGain(tr.vol || 0);
      for (const c of LC.clipsOn(tr.id)) {
        if (c.disabled || c.hold != null) continue;
        if (c.type === 'nest') {           // nested sequence: mix its audio tracks recursively into this clip's chain
          if (!c.seq || (opts.depth || 0) + 1 >= LC.MAX_NEST) continue;
          let [ps, pe] = LC.playSpan(c); pe = Math.min(pe, tEnd);
          let st = Math.max(t0, ps, c.start - c.in); if (pe <= st + 1e-4) continue;
          const span = pe - st, delay = (st - t0) / rate, ti0 = LC.srcTime(c, st);
          const n = Math.max(2, Math.ceil(span * 100) + 1), g = ctx.createGain(), curve = new Float32Array(n);
          for (let i = 0; i < n; i++) { const t = st + span * i / (n - 1); curve[i] = LC.clipGain(c, Math.min(c.dur, Math.max(0, t - c.start))) * LC.xfadeGain(c, t); }
          g.gain.value = curve[0]; try { g.gain.setValueCurveAtTime(curve, when + delay, span / rate); } catch (e) { }
          const ch = fxChain(ctx, c); ch.output.connect(g); g.connect(tg);
          const inner = LC.withSeq(c.seq, () => A.schedule(ctx, ch.input, ti0, when + delay, rate, ti0 + span, { depth: (opts.depth || 0) + 1 }));
          if (inner) srcs.push(...inner.srcs);
          continue;
        }
        const rt = LC.rt.media.get(c.media); let buf = rt && rt.audio; if (!buf) continue;
        let [ps, pe] = LC.playSpan(c); pe = Math.min(pe, tEnd);
        let st = Math.max(t0, ps); if (pe <= st + 1e-4) continue;
        let bufOff = LC.srcTime(c, st);
        if (bufOff < 0) { st += -bufOff / Math.max(.05, LC.speedAt(c, 0)); bufOff = LC.srcTime(c, st); if (pe <= st + 1e-4) continue; }
        if (bufOff >= buf.duration) continue;
        const span = pe - st, delay = (st - t0) / rate;
        if (c.afx?.gate?.on) buf = A.gateBuffer(buf, c.afx.gate, c.media);
        const s = ctx.createBufferSource(); s.buffer = buf;
        const n = Math.max(2, Math.ceil(span * 100) + 1);
        if (LC.ramped(c)) {
          const rc = new Float32Array(n); for (let i = 0; i < n; i++) rc[i] = Math.max(.01, LC.speedAt(c, Math.min(c.dur, Math.max(0, st + span * i / (n - 1) - c.start))) * rate);
          s.playbackRate.value = rc[0]; try { s.playbackRate.setValueCurveAtTime(rc, when + delay, span / rate); } catch (e) { }
        } else s.playbackRate.value = c.props.speed * rate;
        const g = ctx.createGain(), curve = new Float32Array(n);
        for (let i = 0; i < n; i++) { const t = st + span * i / (n - 1); curve[i] = LC.clipGain(c, Math.min(c.dur, Math.max(0, t - c.start))) * LC.xfadeGain(c, t); }
        g.gain.value = curve[0];
        try { g.gain.setValueCurveAtTime(curve, when + delay, span / rate); } catch (e) { }
        const ch = fxChain(ctx, c);
        s.connect(ch.input); ch.output.connect(g); g.connect(tg);
        const srcSpan = LC.srcTime(c, st + span) - bufOff;
        s.start(when + delay, bufOff, Math.max(.001, Math.min(buf.duration - bufOff, srcSpan)));
        srcs.push(s);
      }
    }
    return { srcs, tracks, meters };
  };
  A.startLive = (t0, rate) => {
    A.stopLive();
    const ctx = A.ensure(); A.master.gain.value = A.masterGain();
    const when = ctx.currentTime + 0.03;
    const r = A.schedule(ctx, A.master, t0, when, rate, Infinity, { meters: true });
    A.live = { ...r, when };
    return when;
  };
  A.stopLive = () => { if (!A.live) return; A.live.srcs.forEach(s => { try { s.stop(); s.disconnect(); } catch (e) { } }); A.live.tracks.forEach(t => { try { t.pan.disconnect(); } catch (e) { } }); A.live = null; };
  /* live update of a track's fader / pan while playing (no automation) */
  A.liveTrack = tr => {
    const n = A.live?.tracks.get(tr.id); if (!n) return;
    const solo = LC.project.tracks.some(t => t.kind === 'audio' && t.solo), silent = tr.mute || (solo && !tr.solo);
    n.pan.pan.value = (tr.pan || 0) / 100;
    if (!tr.kf?.vol?.length) { n.g.gain.cancelScheduledValues(0); n.g.gain.value = silent ? 0 : LC.dbToGain(tr.vol || 0); }
  };

  /* Offline mixdown of [t0, t1) → AudioBuffer (stereo, 48 kHz) */
  A.mixdown = async (t0, t1, sampleRate = 48000) => {
    const len = Math.max(1, Math.ceil((t1 - t0) * sampleRate));
    const ctx = new OfflineAudioContext(2, len, sampleRate);
    const m = ctx.createGain(); m.gain.value = A.masterGain(); m.connect(ctx.destination);
    A.schedule(ctx, m, t0, 0, 1, t1);
    return ctx.startRendering();
  };

  /* ---------- level meters ---------- */
  const peakOf = a => { if (!A.buf || A.buf.length < a.fftSize) A.buf = new Float32Array(Math.max(2048, a.fftSize)); const b = A.buf.subarray(0, a.fftSize); a.getFloatTimeDomainData(b); let p = 0; for (let i = 0; i < b.length; i++) { const v = Math.abs(b[i]); if (v > p) p = v; } return p > 0 ? 20 * Math.log10(p) : -90; };
  A.levels = () => (!A.ctx || !A.live) ? [-90, -90] : A.an.map(peakOf);
  A.trackLevels = tid => { const m = A.live?.meters?.get(tid); return m ? m.map(peakOf) : [-90, -90]; };
  /* generic stereo meter painter; st = {peak:[..], hold:[..], holdT:[..]} keeps the ballistics */
  A.paintMeter = (can, lv, st, scale = true) => {
    const dpr = devicePixelRatio || 1, W = can.clientWidth, H = can.clientHeight; if (!W || !H) return;
    if (can.width !== W * dpr || can.height !== H * dpr) { can.width = W * dpr; can.height = H * dpr; }
    const x = can.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    const now = performance.now();
    const top = scale ? 8 : 2, bot = H - (scale ? 16 : 2), hh = bot - top, y = db => top + hh * Math.min(1, Math.max(0, -db / 60));
    x.fillStyle = '#1b2733'; x.fillRect(0, top - 2, W, hh + 4);
    const bw = Math.floor((W - (scale ? 22 : 4)) / 2);
    for (let i = 0; i < 2; i++) {
      st.peak[i] = Math.max(lv[i], st.peak[i] - 1.2);
      if (lv[i] > st.hold[i]) { st.hold[i] = lv[i]; st.holdT[i] = now; } else if (now - st.holdT[i] > 1200) st.hold[i] = Math.max(-90, st.hold[i] - 2);
      const bx = (scale ? 3 : 1) + i * (bw + 2);
      const g = x.createLinearGradient(0, bot, 0, top); g.addColorStop(0, '#2fbf4a'); g.addColorStop(.62, '#8ee03c'); g.addColorStop(.8, '#f2d22e'); g.addColorStop(.92, '#f08a24'); g.addColorStop(1, '#e8382a');
      x.fillStyle = '#0f171f'; x.fillRect(bx, top, bw, hh);
      const yy = y(st.peak[i]); x.fillStyle = g; x.fillRect(bx, yy, bw, bot - yy);
      x.fillStyle = 'rgba(0,0,0,.25)'; for (let k = top + 2; k < bot; k += 3) x.fillRect(bx, k, bw, 1);
      if (st.hold[i] > -60) { x.fillStyle = st.hold[i] > -1 ? '#ff4a3a' : '#e8f4ff'; x.fillRect(bx, y(st.hold[i]) - 1, bw, 2); }
    }
    if (scale) {
      x.fillStyle = '#c9d6e4'; x.font = '9px Segoe UI'; x.textAlign = 'right';
      [0, -6, -12, -18, -24, -36, -48].forEach(db => { x.fillText(String(db), W - 1, y(db) + 3); });
      x.textAlign = 'center'; x.fillText('L  R', 3 + bw, H - 4);
    }
  };
  A.drawMeter = can => A.paintMeter(can, A.levels(), A);

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
