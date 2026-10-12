'use strict';
/* Lumen Motion — audio: decoding, waveform peaks, the mixer (audio layers, audio of video layers, nested
   precomps, Audio Levels keyframes, time remapping), preview playback and AAC/Opus encoding for export. */
(function () {
  const LM = window.LM, st = LM.st;
  const SR = 48000;
  const A = LM.audio = { SR, enabled: true };

  /* ---------- decoding & peaks ---------- */
  // decode any container the browser understands (MP3, WAV, M4A/AAC, OGG, FLAC, MP4/WebM audio tracks) at 48 kHz
  A.decode = async bytes => {
    const ab = bytes instanceof ArrayBuffer ? bytes.slice(0) : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const ctx = new OfflineAudioContext(2, 1, SR);
    const buf = await ctx.decodeAudioData(ab);
    if (!buf || !buf.length) throw new Error('No audio');
    return buf;
  };
  // min/max per 1/200 s for waveform drawing
  A.peaks = buf => {
    const rate = 200, n = Math.max(1, Math.ceil(buf.duration * rate)), mn = new Float32Array(n), mx = new Float32Array(n);
    const ch = []; for (let i = 0; i < buf.numberOfChannels; i++) ch.push(buf.getChannelData(i));
    const spb = buf.sampleRate / rate;
    for (let b = 0; b < n; b++) {
      let lo = 0, hi = 0; const s0 = Math.floor(b * spb), s1 = Math.min(buf.length, Math.floor((b + 1) * spb));
      for (const c of ch) for (let s = s0; s < s1; s++) { const v = c[s]; if (v < lo) lo = v; else if (v > hi) hi = v; }
      mn[b] = lo; mx[b] = hi;
    }
    return { rate, mn, mx };
  };
  LM.layerHasAudio = (L, comp, depth = 0) => {
    if (L.type === 'audio' || L.type === 'video') return !!LM.media.get(L.asset)?.audio;
    if (L.type === 'precomp' && depth < 12) { const sub = LM.compById?.(L.comp); return !!sub && sub.layers.some(l => LM.layerHasAudio(l, sub, depth + 1)); }
    return false;
  };
  A.compHasAudio = comp => !!comp && comp.layers.some(l => l.au?.on !== false && LM.layerHasAudio(l, comp));
  A.dbGain = db => db <= -96 ? 0 : Math.pow(10, db / 20);

  /* ---------- mixer ---------- */
  // Mix comp audio for comp time [t0, t1) → [left, right] Float32Arrays at 48 kHz.
  A.mix = (comp, t0, t1, depth = 0) => {
    const n = Math.max(0, Math.round((t1 - t0) * SR)), out = [new Float32Array(n), new Float32Array(n)];
    if (depth > 12 || !n || !comp) return out;
    const soloAny = comp.layers.some(l => l.solo && l.visible);
    const B = 256;
    for (const L of comp.layers) {
      if (!L.au || L.au.on === false || (soloAny && !L.solo)) continue;
      if (!LM.layerHasAudio(L, comp, depth)) continue;
      const a0 = Math.max(t0, L.in), a1 = Math.min(t1, L.out); if (a1 <= a0) continue;
      const i0 = Math.max(0, Math.round((a0 - t0) * SR)), i1 = Math.min(n, Math.round((a1 - t0) * SR)); if (i1 <= i0) continue;
      // source time & gain at block boundaries (linear in between): handles time remap and level keyframes
      const nb = Math.ceil((i1 - i0) / B) + 1, stimes = new Float64Array(nb), gains = new Float32Array(nb);
      let smin = Infinity, smax = -Infinity;
      for (let b = 0; b < nb; b++) { const i = Math.min(i1, i0 + b * B), t = t0 + i / SR; const s = LM.srcTime(L, t); stimes[b] = s; gains[b] = A.dbGain(LM.val(L.au.level, t)); if (s < smin) smin = s; if (s > smax) smax = s; }
      let ch, start;
      if (L.type === 'precomp') { const sub = LM.compById(L.comp), pad = 4 / SR; start = smin - pad; ch = A.mix(sub, start, smax + pad, depth + 1); }
      else { const buf = LM.media.get(L.asset).audio; start = 0; ch = []; for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) ch.push(buf.getChannelData(c)); }
      const c0 = ch[0], c1 = ch[1] || ch[0], len = c0.length, o0 = out[0], o1 = out[1];
      for (let b = 0; b < nb - 1; b++) {
        const ia = i0 + b * B, ib = Math.min(i1, ia + B), span = ib - ia; if (span <= 0) continue;
        const sa = (stimes[b] - start) * SR, sb = (stimes[b + 1] - start) * SR, ga = gains[b], gb = gains[b + 1];
        if (ga === 0 && gb === 0) continue;
        for (let i = ia; i < ib; i++) {
          const f = (i - ia) / span, s = sa + (sb - sa) * f; if (s < 0 || s >= len - 1) continue;
          const k = s | 0, fr = s - k, g = ga + (gb - ga) * f;
          o0[i] += (c0[k] + (c0[k + 1] - c0[k]) * fr) * g; o1[i] += (c1[k] + (c1[k + 1] - c1[k]) * fr) * g;
        }
      }
    }
    return out;
  };

  /* ---------- preview playback ---------- */
  let actx = null, node = null, startAt = 0, startFrom = 0; const cache = new Map();
  A.scrubOn = true; A.scrubCount = 0; A.resyncs = 0;
  const ctx = () => { if (!actx) actx = new AudioContext({ sampleRate: SR, latencyHint: 'interactive' }); return actx; };
  function mixBuffer(c, from, to) {
    const key = `${c.id}|${st.ver}|${LM.exprState.enabled}|${LM.trusted.size}|${from.toFixed(4)}|${to.toFixed(4)}`;
    let b = cache.get(key);
    if (!b) {
      const ch = A.mix(c, from, to), ac = ctx(); b = ac.createBuffer(2, Math.max(1, ch[0].length), SR); b.copyToChannel(ch[0], 0); b.copyToChannel(ch[1], 1);
      cache.set(key, b); while (cache.size > 3) cache.delete(cache.keys().next().value);
    }
    return b;
  }
  A.stopPreview = () => { if (node) { try { node.stop(); } catch (e) { } node.disconnect(); node = null; } };
  A.startPreview = (from) => {
    A.stopPreview();
    const c = LM.comp(); if (!A.enabled || !c || !A.compHasAudio(c)) return false;
    const to = Math.min(c.workOut, c.duration); if (to - from < 1 / SR) return false;
    const ac = ctx(); ac.resume?.().catch(() => { });
    const n = ac.createBufferSource(); n.buffer = mixBuffer(c, from, to); n.connect(ac.destination);
    startAt = ac.currentTime; startFrom = from; n.start(startAt); node = n;
    n.onended = () => { if (node === n) node = null; };
    return true;
  };
  // playback position of the audio (seconds of comp time) — the viewer uses it as the master clock so picture and
  // sound cannot drift apart; null when no audio is playing or the output is not running
  A.clock = () => {
    if (!node || !actx || actx.state !== 'running') return null;
    // getOutputTimestamp pairs the audio clock with performance.now(), giving a smooth position between audio callbacks
    const ts = actx.getOutputTimestamp ? actx.getOutputTimestamp() : null;
    const ct = ts && ts.contextTime > 0 ? ts.contextTime + (performance.now() - ts.performanceTime) / 1000 : actx.currentTime;
    return startFrom + (ct - startAt);
  };
  A.driftLog = [];
  // scrub audio: a short slice of the mix at the current time while the playhead is dragged
  let lastScrub = 0, scrubNode = null;
  A.scrub = t => {
    const c = LM.comp(), now = performance.now();
    if (!A.enabled || !A.scrubOn || st.playing || !c || now - lastScrub < 35 || !A.compHasAudio(c)) return false;
    lastScrub = now;
    const len = Math.round(.09 * SR), ch = A.mix(c, t, t + len / SR), ac = ctx(), fade = Math.round(.006 * SR);
    for (let i = 0; i < fade; i++) { const g = i / fade; ch[0][i] *= g; ch[1][i] *= g; ch[0][len - 1 - i] *= g; ch[1][len - 1 - i] *= g; }
    const b = ac.createBuffer(2, len, SR); b.copyToChannel(ch[0], 0); b.copyToChannel(ch[1], 1);
    ac.resume?.().catch(() => { });
    if (scrubNode) { try { scrubNode.stop(); } catch (e) { } }
    scrubNode = ac.createBufferSource(); scrubNode.buffer = b; scrubNode.connect(ac.destination); scrubNode.start();
    A.scrubCount++; return true;
  };
  A.playing = () => !!node;
  LM.on('play', () => { if (st.playing) A.startPreview(st.time); else A.stopPreview(); });
  LM.on('loop', () => { const c = LM.comp(); if (st.playing && c) A.startPreview(c.workIn); });
  A.toggle = () => { A.enabled = !A.enabled; if (!A.enabled) A.stopPreview(); else if (st.playing) A.startPreview(st.time); LM.emit('audiotoggle'); };

  /* ---------- export ---------- */
  // Encode the comp's mix for [t0, t1) → {codec ('aac'|'opus'), chunks: [[EncodedAudioChunk, meta]]} or null
  A.encode = async (kind, c, t0, t1) => {
    if (!window.AudioEncoder || !A.compHasAudio(c)) return null;
    const base = { sampleRate: SR, numberOfChannels: 2, bitrate: 192000 };
    let codec = null;
    for (const cand of kind === 'mp4' ? ['mp4a.40.2', 'opus'] : ['opus']) { try { if ((await AudioEncoder.isConfigSupported({ ...base, codec: cand })).supported) { codec = cand; break; } } catch (e) { } }
    if (!codec) return null;
    const ch = A.mix(c, t0, t1), n = ch[0].length, chunks = []; let err = null;
    const enc = new AudioEncoder({ output: (chunk, meta) => chunks.push([chunk, meta]), error: e => err = e });
    enc.configure({ ...base, codec });
    const F = 4800;
    for (let i = 0; i < n; i += F) {
      const len = Math.min(F, n - i), data = new Float32Array(len * 2);
      for (let k = 0; k < len; k++) { data[k] = Math.max(-1, Math.min(1, ch[0][i + k])); data[len + k] = Math.max(-1, Math.min(1, ch[1][i + k])); }
      const ad = new AudioData({ format: 'f32-planar', sampleRate: SR, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round(i * 1e6 / SR), data });
      enc.encode(ad); ad.close();
      if (enc.encodeQueueSize > 20) await new Promise(r => setTimeout(r, 1));
    }
    await enc.flush(); enc.close(); if (err) throw err;
    return { codec: codec === 'opus' ? 'opus' : 'aac', chunks };
  };
  // 16-bit PCM WAV of the comp's mix
  A.wav = (c, t0, t1) => {
    const ch = A.mix(c, t0, t1), n = ch[0].length, buf = new ArrayBuffer(44 + n * 4), dv = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * 4, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
    dv.setUint32(24, SR, true); dv.setUint32(28, SR * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 4, true);
    for (let i = 0, o = 44; i < n; i++, o += 4) { dv.setInt16(o, Math.round(Math.max(-1, Math.min(1, ch[0][i])) * 32767), true); dv.setInt16(o + 2, Math.round(Math.max(-1, Math.min(1, ch[1][i])) * 32767), true); }
    return new Uint8Array(buf);
  };

  /* ---------- waveform drawing (timeline) ---------- */
  // draw a layer's waveform over the visible part of its bar; x(t) maps comp time → px in the track
  A.drawWave = (cv, L, comp, x0, x1, tAt, h) => {
    const m = LM.media.get(L.asset), pk = m?.peaks; if (!pk) { cv.width = 1; return; }
    const dpr = devicePixelRatio || 1, w = Math.max(1, Math.round(x1 - x0));
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; cv.style.left = x0 + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    // normalised to the clip's peak so quiet material is still readable
    if (pk.norm == null) { let p = 0; for (let i = 0; i < pk.mx.length; i++) p = Math.max(p, pk.mx[i], -pk.mn[i]); pk.norm = p > 1e-4 ? Math.min(8, .95 / p) : 1; }
    g.fillStyle = 'rgba(8,24,70,.85)'; const mid = h / 2;
    for (let x = 0; x < w; x++) {
      const ta = tAt(x0 + x), tb = tAt(x0 + x + 1); if (tb <= L.in || ta >= L.out) continue;
      const sa = LM.srcTime(L, ta), sb = LM.srcTime(L, tb), gain = Math.min(2, A.dbGain(LM.val(L.au.level, ta))) * pk.norm;
      let b0 = Math.floor(Math.min(sa, sb) * pk.rate), b1 = Math.ceil(Math.max(sa, sb) * pk.rate); if (b1 <= b0) b1 = b0 + 1;
      b0 = Math.max(0, b0); b1 = Math.min(pk.mn.length, b1); if (b1 <= b0) continue;
      let lo = 0, hi = 0; for (let b = b0; b < b1; b++) { if (pk.mn[b] < lo) lo = pk.mn[b]; if (pk.mx[b] > hi) hi = pk.mx[b]; }
      const y0 = mid - Math.min(1, hi * gain) * (mid - 1), y1 = mid - Math.max(-1, lo * gain) * (mid - 1);
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  };
})();
