'use strict';
/* Lumen Convert — more audio & video: speech noise removal (RNNoise WASM), vocal remover (centre-channel
   cancellation), screen recorder (getDisplayMedia + MediaRecorder), subtitle converter (SRT ⇄ VTT ⇄ ASS, time shift)
   and burn subtitles into video (WebCodecs). */
(() => {
  const { register, alias, util: U } = LC;
  const { el, esc, baseName, extOf, fmtSize } = U;
  const M = () => LC.mediaInternals;

  /* ---------------- Noise removal (RNNoise: 48 kHz, 480-sample frames, int16-scaled floats) ---------------- */
  let rnP = null;
  const rnnoise = () => rnP || (rnP = import(new URL('vendor/rnnoise/rnnoise.js', document.baseURI).href).then(m => m.default({ locateFile: f => new URL('vendor/rnnoise/' + f, document.baseURI).href })).catch(e => { rnP = null; throw new Error('Could not load the noise-removal engine (' + e.message + ')'); }));
  const FRAME = 480;
  // gate: RNNoise also returns a voice-activity probability per frame; frames without speech get an extra,
  // smoothly ramped attenuation (down to -20 dB) so the gaps between words become quiet
  async function denoise(x, ctx, p0, p1, gate = true) {
    const R = await rnnoise(), st = R._rnnoise_create(), inP = R._malloc(FRAME * 4), outP = R._malloc(FRAME * 4);
    const out = new Float32Array(x.length), frames = Math.ceil(x.length / FRAME) + 1, vad = new Float32Array(frames);
    try {
      // RNNoise's output lags its input by one frame; feed one extra frame and shift back
      for (let f = 0; f < frames; f++) {
        const heap = new Float32Array(R.HEAPF32.buffer, inP, FRAME);
        for (let i = 0; i < FRAME; i++) { const k = f * FRAME + i; heap[i] = k < x.length ? x[k] * 32768 : 0; }
        vad[f] = R._rnnoise_process_frame(st, outP, inP);
        const o = new Float32Array(R.HEAPF32.buffer, outP, FRAME);
        for (let i = 0; i < FRAME; i++) { const k = (f - 1) * FRAME + i; if (k >= 0 && k < x.length) out[k] = o[i] / 32768; }
        if (f % 200 === 0) { ctx.check(); ctx.progress(p0 + (p1 - p0) * f / frames, 'Removing noise'); await U.tick(); }
      }
    } finally { R._rnnoise_destroy(st); R._free(inP); R._free(outP); }
    if (gate) {
      // per-frame target gain from VAD (frame f's VAD belongs to output frame f-1), hold for 200 ms, then smooth
      const g = new Float32Array(frames - 1), hold = 20; let last = -1e9;
      for (let f = 1; f < frames; f++) { if (vad[f] > 0.75) last = f; g[f - 1] = f - last <= hold ? 1 : 0.1; }
      const g0 = g.slice(); for (let f = 0; f < g.length; f++) if (g0[f] < 1 && (g0[f + 1] === 1 || g0[f + 2] === 1 || g0[f + 3] === 1)) g[f] = 1; // open 30 ms before speech starts
      let cur = g[0];
      for (let f = 0; f < g.length; f++) {
        const tgt = g[f], start = cur, rate = tgt > cur ? 1 : 0.25; // fast open, slow close
        const end = start + (tgt - start) * rate;
        for (let i = 0; i < FRAME; i++) { const k = f * FRAME + i; if (k >= out.length) break; out[k] *= start + (end - start) * (i / FRAME); }
        cur = end;
      }
    }
    return out;
  }
  register({
    id: 'denoise', cat: 'av', glyph: 'noise', name: 'Remove background noise', keywords: 'noise removal reduction denoise speech enhance voice podcast hum hiss fan rnnoise adobe podcast clean audio',
    desc: 'Clean up voice recordings: fans, hiss, traffic and room noise removed by a neural network.',
    accept: 'audio/*,video/*,.flac,.m4a,.opus,.ogg,.mkv,.mov', acceptText: 'Speech recordings: WAV, MP3, M4A, OGG, FLAC, or a video’s soundtrack', acceptTest: f => M().isAudio(f) || M().isVideo(f), multiple: true, zipName: 'denoised',
    options: [
      { key: 'amount', label: 'Strength', type: 'range', min: 0.3, max: 1, step: 0.05, value: 1, fmt: v => Math.round(v * 100) + '%', hint: 'Lower keeps a little of the original room sound.' },
      { key: 'gate', label: 'Pauses', type: 'checkbox', text: 'Also quieten the gaps between words', value: true },
      { key: 'to', label: 'Save as', type: 'select', value: 'wav', options: [['wav', 'WAV'], ['mp3', 'MP3'], ['flac', 'FLAC']] },
      { key: 'kbps', label: 'Bitrate', type: 'select', value: '160', options: [['128', '128 kbps'], ['160', '160 kbps'], ['192', '192 kbps']], show: o => o.to === 'mp3' }],
    note: 'Uses RNNoise (Xiph, BSD-3), a small neural network made for speech. It’s great on voice; music isn’t its job and may sound thin.',
    async each(f, o, ctx) {
      ctx.progress(0.03, 'Decoding ' + f.name);
      const a = await M().decodeAudio(f, M().isVideo(f) && !M().isAudio(f) ? 'video' : 'audio');
      if (a.chs[0].length / a.sr > 3 * 3600) throw new Error('Recordings longer than 3 hours aren’t supported');
      const chs48 = a.sr === 48000 ? a.chs : a.chs.map(c => M().resample(c, 48000 / a.sr));
      const out = [];
      for (let c = 0; c < chs48.length; c++) {
        const d = await denoise(chs48[c], ctx, 0.1 + 0.7 * c / chs48.length, 0.1 + 0.7 * (c + 1) / chs48.length, o.gate);
        if (o.amount < 1) for (let i = 0; i < d.length; i++) d[i] = d[i] * o.amount + chs48[c][i] * (1 - o.amount);
        out.push(d);
      }
      const back = a.sr === 48000 || o.to === 'mp3' ? out : out.map(c => M().resample(c, a.sr / 48000, a.chs[0].length));
      const sr = a.sr === 48000 || o.to === 'mp3' ? 48000 : a.sr;
      const r = await M().encodeAudio(back, sr, { to: o.to, kbps: o.kbps, bits: 'pcm16' }, x => ctx.progress(0.85 + 0.15 * x, 'Encoding'));
      return { name: `${baseName(f.name)}-clean.${r.ext}`, blob: new Blob([r.bytes], { type: r.mime }), audio: true, info: `${M().fmtT(a.chs[0].length / a.sr)} · ${r.desc}` };
    }
  });
  alias('noise-removal', 'denoise'); alias('enhance-speech', 'denoise');

  /* ---------------- Vocal remover ---------------- */
  // RBJ biquad (Butterworth Q) run twice = 4th-order Linkwitz-Riley-style slope (24 dB/octave)
  function biquad(x, sr, fc, high) {
    const w = 2 * Math.PI * fc / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * Math.SQRT1_2), a0 = 1 + al;
    const b0 = (high ? (1 + cs) / 2 : (1 - cs) / 2) / a0, b1 = (high ? -(1 + cs) : (1 - cs)) / a0, b2 = b0, a1 = -2 * cs / a0, a2 = (1 - al) / a0;
    const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < x.length; i++) { const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v; }
    return y;
  }
  const lr4 = (x, sr, fc, high) => biquad(biquad(x, sr, fc, high), sr, fc, high);
  register({
    id: 'vocal-remover', cat: 'av', glyph: 'karaoke', name: 'Vocal remover (karaoke)', keywords: 'vocal remover karaoke instrumental remove voice acapella center channel cancel minus one',
    desc: 'Make a karaoke track by cancelling what’s panned dead-centre (usually the lead vocal).',
    accept: 'audio/*,.flac,.m4a,.opus,.ogg', acceptText: 'Stereo songs: WAV, MP3, FLAC, M4A, OGG', acceptTest: f => M().isAudio(f), multiple: true, zipName: 'karaoke',
    options: [
      { key: 'mode', label: 'Output', type: 'select', value: 'karaoke', options: [['karaoke', 'Instrumental (vocals removed)'], ['center', 'Centre only (rough vocal isolation)']] },
      { key: 'bass', label: 'Keep bass below', type: 'select', value: '150', options: [['0', 'Off'], ['100', '100 Hz'], ['150', '150 Hz'], ['250', '250 Hz']], show: o => o.mode === 'karaoke', hint: 'Kick drum and bass are usually centred too; this keeps them.' },
      { key: 'to', label: 'Save as', type: 'select', value: 'mp3', options: [['mp3', 'MP3'], ['wav', 'WAV'], ['flac', 'FLAC']] }],
    note: 'Honest label: this classic technique works best on stereo studio mixes with a centred lead vocal. Reverb on the voice and centred instruments (snare, bass) are affected too, and mono recordings can’t be processed.',
    async each(f, o, ctx) {
      ctx.progress(0.05, 'Decoding ' + f.name);
      const a = await M().decodeAudio(f); if (a.chs.length < 2) throw new Error('This file is mono, so there is no stereo difference to work with.');
      const [L, R] = a.chs, n = L.length, sr = a.sr;
      let diff = 0, sum = 0; for (let i = 0; i < n; i += 7) { diff += Math.abs(L[i] - R[i]); sum += Math.abs(L[i] + R[i]); }
      if (diff < sum * 0.002) throw new Error('Both channels are identical (a “fake stereo” mono mix), so nothing can be separated.');
      ctx.progress(0.3, 'Separating'); await U.tick();
      const mid = new Float32Array(n), side = new Float32Array(n);
      for (let i = 0; i < n; i++) { mid[i] = (L[i] + R[i]) / 2; side[i] = (L[i] - R[i]) / 2; }
      let outL, outR;
      if (o.mode === 'karaoke') {
        const bass = +o.bass ? lr4(mid, sr, +o.bass, false) : null; outL = new Float32Array(n); outR = new Float32Array(n);
        // classic karaoke: L-R / R-L cancels everything identical in both channels; the centred bass is added back below the crossover
        for (let i = 0; i < n; i++) { const b = bass ? bass[i] : 0; outL[i] = 2 * side[i] + b; outR[i] = -2 * side[i] + b; }
      } else { // centre: mid minus what the side signal predicts, band-limited to the voice range
        const v = lr4(lr4(mid, sr, 120, true), sr, 7000, false); outL = v; outR = v.slice();
      }
      let pk = 0; for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(outL[i]), Math.abs(outR[i]));
      if (pk > 0.99) { const g = 0.99 / pk; for (let i = 0; i < n; i++) { outL[i] *= g; outR[i] *= g; } }
      const r = await M().encodeAudio([outL, outR], sr, { to: o.to, kbps: '192', bits: 'pcm16' }, x => ctx.progress(0.5 + 0.5 * x, 'Encoding'));
      return { name: `${baseName(f.name)}-${o.mode === 'karaoke' ? 'instrumental' : 'centre'}.${r.ext}`, blob: new Blob([r.bytes], { type: r.mime }), audio: true, info: `${M().fmtT(n / sr)} · ${r.desc}` };
    }
  });
  alias('karaoke', 'vocal-remover'); alias('remove-vocals', 'vocal-remover');

  /* ---------------- Screen recorder ---------------- */
  const pickMime = fmt => { const c = fmt === 'mp4' ? ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4'] : ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']; return c.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || null; };
  register({
    id: 'screen-recorder', cat: 'av', glyph: 'record', name: 'Screen recorder', keywords: 'screen recorder record screen capture tab window desktop video webm mp4 microphone loom',
    desc: 'Record your screen, a window or a tab, with optional microphone, to WebM or MP4.',
    render(root) {
      const st = { rec: null, chunks: [], streams: [], t0: 0, timer: null, url: null, actx: null, mime: '' };
      const cols = el('div', 'cols'), L = el('div'), R = el('div'); cols.append(L, R); root.append(cols);
      L.append(el('div', 'ph', '<span class="phi"></span>Preview<span class="right" id="sr-time"></span>'));
      const lb = el('div', 'box'); L.append(lb);
      const video = el('video'); video.muted = true; video.playsInline = true; video.style.cssText = 'width:100%;background:#0b1624;border-radius:4px;min-height:200px';
      const msg = el('p', 'dim', 'Nothing is recorded until you press Start. Your browser will ask which screen, window or tab to share.'); msg.style.fontSize = '13px';
      lb.append(video, msg);
      R.append(el('div', 'ph', '<span class="phi"></span>Options'));
      const rb = el('div', 'box'), form = el('div', 'form'); rb.append(form); R.append(rb);
      const o = { fmt: pickMime('mp4') ? 'mp4' : 'webm', sys: true, mic: false, quality: '5' };
      const fields = [{ key: 'fmt', label: 'Format', type: 'select', options: [['webm', 'WebM (VP9 + Opus)'], ...(pickMime('mp4') ? [['mp4', 'MP4 (H.264 + AAC)']] : [])] },
        { key: 'quality', label: 'Quality', type: 'select', options: [['2.5', 'Standard (2.5 Mbps)'], ['5', 'High (5 Mbps)'], ['10', 'Very high (10 Mbps)']] },
        { key: 'sys', label: 'Sound', type: 'checkbox', text: 'Record tab / system audio (if shared)' }, { key: 'mic', label: 'Microphone', type: 'checkbox', text: 'Record my microphone too' }];
      for (const f of fields) for (const n of LC.optionField(f, o[f.key], v => o[f.key] = v)) form.append(n);
      const acts = el('div', 'actions'), start = el('button', 'go big', '● Start recording'), stop = el('button', 'big', '■ Stop'); start.type = stop.type = 'button'; stop.disabled = true; acts.append(start, stop); rb.append(acts);
      const status = el('p', 'dim'); status.style.fontSize = '13px'; rb.append(status);
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) { start.disabled = true; status.textContent = 'Screen recording isn’t available in this browser (it needs desktop Chrome, Edge or Firefox).'; }
      const resHead = el('div', 'ph', '<span class="phi"></span>Recording'); resHead.hidden = true; const res = el('ul', 'res'); res.hidden = true; root.append(resHead, res);
      const tm = root.querySelector('#sr-time');
      function cleanup() { clearInterval(st.timer); st.streams.forEach(s => s.getTracks().forEach(t => t.stop())); st.streams = []; if (st.actx) { st.actx.close().catch(() => { }); st.actx = null; } video.srcObject = null; start.disabled = false; stop.disabled = true; }
      async function begin() {
        status.textContent = ''; start.disabled = true;
        try {
          const disp = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: o.sys });
          st.streams = [disp];
          let mic = null; if (o.mic) { try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); st.streams.push(mic); } catch (e) { status.textContent = 'Microphone not available; recording without it.'; } }
          const tracks = [...disp.getVideoTracks()], aud = [disp, mic].filter(s => s && s.getAudioTracks().length);
          if (aud.length === 1) tracks.push(...aud[0].getAudioTracks());
          else if (aud.length > 1) { st.actx = new AudioContext(); const dst = st.actx.createMediaStreamDestination(); aud.forEach(s => st.actx.createMediaStreamSource(s).connect(dst)); tracks.push(...dst.stream.getAudioTracks()); }
          const stream = new MediaStream(tracks); video.srcObject = disp; video.play().catch(() => { });
          st.mime = pickMime(o.fmt) || pickMime('webm'); if (!st.mime) throw new Error('This browser can’t record video');
          st.chunks = []; st.rec = new MediaRecorder(stream, { mimeType: st.mime, videoBitsPerSecond: +o.quality * 1e6, audioBitsPerSecond: 160000 });
          st.rec.ondataavailable = e => { if (e.data.size) st.chunks.push(e.data); };
          st.done = new Promise(r => st.rec.onstop = r).then(finish);
          disp.getVideoTracks()[0].addEventListener('ended', () => { if (st.rec && st.rec.state !== 'inactive') st.rec.stop(); });
          st.rec.start(1000); st.t0 = performance.now(); stop.disabled = false;
          st.timer = setInterval(() => { const s = (performance.now() - st.t0) / 1000; tm.textContent = '● ' + M().fmtT(s); }, 250);
          status.textContent = 'Recording… press Stop (or stop sharing) when you’re done.';
        } catch (e) { cleanup(); status.textContent = e.name === 'NotAllowedError' ? 'Screen sharing was cancelled or blocked.' : 'Couldn’t start recording: ' + e.message; }
      }
      async function finish() {
        const dur = (performance.now() - st.t0) / 1000; cleanup(); tm.textContent = '';
        const blob = new Blob(st.chunks, { type: st.mime.split(';')[0] }); st.rec = null;
        if (!blob.size) { status.textContent = 'Nothing was recorded.'; return null; }
        if (st.url) URL.revokeObjectURL(st.url); st.url = URL.createObjectURL(blob);
        const ext = /mp4/.test(st.mime) ? 'mp4' : 'webm', name = `screen-recording-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.${ext}`;
        res.innerHTML = ''; const li = el('li'), info = el('div', 'info'); info.append(el('span', 'nm', esc(name)), el('small', null, `${fmtSize(blob.size)} · ${M().fmtT(dur)} · ${esc(st.mime)}`));
        const a = el('a', 'btn go', 'Download'); a.href = st.url; a.download = name; const pv = el('div', 'pv'), v = el('video'); v.controls = true; v.src = st.url; v.style.cssText = 'height:auto;max-height:260px'; pv.append(v);
        li.append(info, a, pv); res.append(li); res.hidden = resHead.hidden = false; status.textContent = 'Done. Nothing left this device.';
        st.last = blob; return blob;
      }
      start.onclick = begin; stop.onclick = () => { if (st.rec && st.rec.state !== 'inactive') st.rec.stop(); };
      return { start: begin, stop: () => { if (st.rec && st.rec.state !== 'inactive') st.rec.stop(); return st.done; }, set(k, v) { o[k] = v; }, get last() { return st.last; }, destroy() { if (st.rec && st.rec.state !== 'inactive') st.rec.stop(); cleanup(); if (st.url) URL.revokeObjectURL(st.url); } };
    }
  });
  alias('record-screen', 'screen-recorder');

  /* ---------------- Subtitles ---------------- */
  const tc = (h, m, s, ms) => ((+h || 0) * 3600 + (+m) * 60 + (+s)) * 1000 + (+ms || 0);
  function parseTime(t) {
    let m = t.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})$/); if (m) return tc(m[1], m[2], m[3], m[4].padEnd(3, '0'));
    m = t.trim().match(/^(\d+):(\d{2}):(\d{2})\.(\d{2})$/); if (m) return tc(m[1], m[2], m[3], m[4] * 10);
    return NaN;
  }
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const fmtTime = (ms, kind) => { ms = Math.max(0, Math.round(ms)); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60, f = ms % 1000; return kind === 'ass' ? `${h}:${pad(m)}:${pad(s)}.${pad(Math.floor(f / 10))}` : `${pad(h)}:${pad(m)}:${pad(s)}${kind === 'srt' ? ',' : '.'}${pad(f, 3)}`; };
  function detect(text) { const t = text.replace(/^\uFEFF/, '').trimStart(); if (/^WEBVTT/.test(t)) return 'vtt'; if (/^\[Script Info\]/i.test(t) || /^Dialogue:/m.test(t)) return 'ass'; if (/-->/.test(t)) return 'srt'; return null; }
  function parseSubs(text) {
    text = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'); const kind = detect(text); const cues = [];
    if (!kind) throw new Error('This doesn’t look like SRT, WebVTT or ASS/SSA subtitles');
    if (kind === 'ass') {
      let fmt = ['Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text'], inEvents = false;
      for (const line of text.split('\n')) {
        if (/^\[Events\]/i.test(line)) { inEvents = true; continue; } if (/^\[/.test(line)) { inEvents = false; continue; }
        if (!inEvents) continue;
        if (/^Format:/i.test(line)) { fmt = line.slice(7).split(',').map(s => s.trim()); continue; }
        if (!/^Dialogue:/i.test(line)) continue;
        const parts = line.slice(9).split(','), n = fmt.length, vals = [...parts.slice(0, n - 1), parts.slice(n - 1).join(',')], get = k => (vals[fmt.indexOf(k)] || '').trim();
        const start = parseTime(get('Start')), end = parseTime(get('End')); if (isNaN(start) || isNaN(end)) continue;
        const raw = vals[fmt.indexOf('Text')] || '';
        cues.push({ start, end, text: raw.replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' ').trim() });
      }
    } else {
      for (const block of text.split(/\n{2,}/)) {
        const lines = block.split('\n'); const ti = lines.findIndex(l => l.includes('-->')); if (ti < 0) continue;
        const [a, b] = lines[ti].split('-->'); const start = parseTime(a), end = parseTime(b.trim().split(/\s+/)[0]);
        if (isNaN(start) || isNaN(end)) continue;
        cues.push({ start, end, text: lines.slice(ti + 1).join('\n').trim() });
      }
    }
    if (!cues.length) throw new Error('No subtitle cues found');
    return { kind, cues: cues.sort((x, y) => x.start - y.start) };
  }
  const plain = t => t.replace(/<[^>]+>/g, '');
  function writeSubs(cues, kind) {
    if (kind === 'srt') return cues.map((c, i) => `${i + 1}\n${fmtTime(c.start, 'srt')} --> ${fmtTime(c.end, 'srt')}\n${c.text}`).join('\n\n') + '\n';
    if (kind === 'vtt') return 'WEBVTT\n\n' + cues.map(c => `${fmtTime(c.start, 'vtt')} --> ${fmtTime(c.end, 'vtt')}\n${c.text.replace(/-->/g, '->')}`).join('\n\n') + '\n';
    return `[Script Info]\nTitle: Converted by Lumen Convert\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,64,&H00FFFFFF,&H000000FF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,3,1,2,60,60,50,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n` +
      cues.map(c => `Dialogue: 0,${fmtTime(c.start, 'ass')},${fmtTime(c.end, 'ass')},Default,,0,0,0,,${plain(c.text).replace(/\n/g, '\\N').replace(/[{}]/g, '')}`).join('\n') + '\n';
  }
  LC.subs = { parseSubs, writeSubs, fmtTime, parseTime };
  // live text converter (registered through the data tools' textTool helper when available)
  const SAMPLE_SRT = '1\n00:00:01,000 --> 00:00:03,500\nHello, and welcome.\n\n2\n00:00:04,000 --> 00:00:06,250\nThis line has\ntwo rows.\n';
  register({
    id: 'subtitles', cat: 'text', glyph: 'subtitle', name: 'Subtitle converter', keywords: 'subtitles captions srt vtt webvtt ass ssa convert shift timing delay sync',
    desc: 'SRT ⇄ WebVTT ⇄ ASS/SSA, with a time shift to fix out-of-sync captions.',
    render(root, preset) {
      const st = { to: (preset && preset.to) || 'vtt', shift: 0, speed: 1, name: 'subtitles' };
      const top = el('div', 'intro'), seg = el('div', 'seg');
      for (const [k, l] of [['srt', '→ SRT'], ['vtt', '→ WebVTT'], ['ass', '→ ASS']]) { const b = el('button', null, l); b.type = 'button'; b.dataset.k = k; b.onclick = () => { st.to = k; run(); }; seg.append(b); }
      const shift = el('input'); shift.type = 'number'; shift.step = '0.1'; shift.value = '0'; shift.style.width = '90px'; shift.title = 'Positive delays the subtitles; negative shows them earlier';
      const shL = el('label'); shL.style.cssText = 'display:inline-flex;gap:6px;align-items:center;margin-left:auto'; shL.append(document.createTextNode('Shift'), shift, document.createTextNode('s'));
      top.append(seg, shL); root.append(top);
      const io = el('div', 'io'), Lc = el('div'), Rc = el('div'); io.append(Lc, Rc); root.append(io);
      const tbL = el('div', 'tb'), open = el('button', 'mini', 'Open file…'), sample = el('button', 'mini', 'Sample'), pick = el('input'); pick.type = 'file'; pick.accept = '.srt,.vtt,.ass,.ssa,.txt'; pick.className = 'vh'; open.type = sample.type = 'button';
      const inLab = el('b', null, 'Subtitles'); tbL.append(inLab, el('span', 'sp'), open, sample, pick);
      const inp = el('textarea'); inp.spellcheck = false; inp.placeholder = 'Paste SRT, WebVTT or ASS subtitles, or drop a file'; Lc.append(tbL, inp);
      const tbR = el('div', 'tb'), outLab = el('b'), copy = el('button', 'go mini', 'Copy'), dl = el('button', 'mini', 'Download'); copy.type = dl.type = 'button'; tbR.append(outLab, el('span', 'sp'), copy, dl);
      const out = el('textarea'); out.readOnly = true; out.spellcheck = false; Rc.append(tbR, out);
      const status = el('div', 'status'); root.append(status);
      function run() {
        [...seg.children].forEach(b => b.classList.toggle('on', b.dataset.k === st.to)); outLab.textContent = { srt: 'SRT', vtt: 'WebVTT', ass: 'ASS' }[st.to];
        if (!inp.value.trim()) { out.value = ''; status.className = 'status'; status.textContent = 'Paste or open subtitles. The input format is detected automatically.'; return ''; }
        try {
          const { kind, cues } = parseSubs(inp.value), ms = Math.round((+shift.value || 0) * 1000);
          const shifted = cues.map(c => ({ ...c, start: c.start + ms, end: c.end + ms })).filter(c => c.end > 0);
          out.value = writeSubs(shifted, st.to); status.className = 'status';
          status.textContent = `${kind.toUpperCase()} → ${st.to.toUpperCase()} · ${shifted.length} cues${ms ? ` · shifted ${ms > 0 ? '+' : ''}${ms / 1000} s` : ''}${shifted.length < cues.length ? ` · ${cues.length - shifted.length} cue(s) before 0:00 dropped` : ''}`;
          return out.value;
        } catch (e) { out.value = ''; status.className = 'status err'; status.textContent = e.message; return null; }
      }
      inp.oninput = run; shift.oninput = run;
      const load = async f => { inp.value = await LC.pdfInternals.readText(f); st.name = baseName(f.name); run(); };
      open.onclick = () => pick.click(); pick.onchange = () => { if (pick.files[0]) load(pick.files[0]); pick.value = ''; };
      inp.ondragover = e => e.preventDefault(); inp.ondrop = e => { e.preventDefault(); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); };
      sample.onclick = () => { inp.value = SAMPLE_SRT; run(); };
      copy.onclick = () => out.value && U.copyText(out.value);
      dl.onclick = () => out.value && U.download(new Blob([out.value], { type: 'text/plain;charset=utf-8' }), `${st.name}.${st.to}`);
      run();
      return { input(s) { inp.value = s; return run(); }, set(k, v) { if (k === 'shift') shift.value = v; else st[k] = v; return run(); }, get output() { return out.value; } };
    }
  });
  alias('srt-to-vtt', 'subtitles', { to: 'vtt' }); alias('vtt-to-srt', 'subtitles', { to: 'srt' }); alias('srt-to-ass', 'subtitles', { to: 'ass' });

  /* ---------------- Burn subtitles into video ---------------- */
  function drawCaption(g, W, H, text, o) {
    if (!text) return;
    const size = Math.round(H * o.size / 100), lines = []; g.font = `600 ${size}px "Segoe UI", Arial, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    for (const para of plain(text).split('\n')) { let cur = ''; for (const w of para.split(/\s+/)) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > W * 0.9 && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); }
    const lh = size * 1.22, baseY = o.pos === 'top' ? H * 0.06 + size : H - H * 0.06 - (lines.length - 1) * lh;
    lines.forEach((l, i) => {
      const y = baseY + i * lh;
      if (o.style === 'box') { const w = g.measureText(l).width; g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(W / 2 - w / 2 - size * 0.3, y - size * 0.95, w + size * 0.6, size * 1.22); }
      else { g.lineJoin = 'round'; g.lineWidth = Math.max(2, size / 7); g.strokeStyle = '#000'; g.strokeText(l, W / 2, y); }
      g.fillStyle = o.color; g.fillText(l, W / 2, y);
    });
  }
  register({
    id: 'burn-subtitles', cat: 'av', glyph: 'subtitle', name: 'Burn subtitles into video', keywords: 'burn subtitles hardsub captions into video embed srt vtt ass open captions social media',
    desc: 'Permanently draw SRT, VTT or ASS captions onto a video (for social media and players without subtitle support).',
    accept: 'video/*,.mkv,.mov,.srt,.vtt,.ass,.ssa', acceptText: 'One video plus one subtitle file (.srt, .vtt or .ass)', acceptTest: f => M().isVideo(f) || /^(srt|vtt|ass|ssa)$/.test(extOf(f.name)), multiple: true, button: 'Burn in', minFiles: 2,
    options: [
      { key: 'size', label: 'Text size', type: 'range', min: 3, max: 10, step: 0.5, value: 5.5, fmt: v => v + '% of height' },
      { key: 'style', label: 'Style', type: 'select', value: 'outline', options: [['outline', 'White with black outline'], ['box', 'On a dark box']] },
      { key: 'color', label: 'Colour', type: 'color', value: '#ffffff' },
      { key: 'pos', label: 'Position', type: 'select', value: 'bottom', options: [['bottom', 'Bottom'], ['top', 'Top']] },
      { key: 'shift', label: 'Shift', type: 'number', min: -600, max: 600, step: 0.1, value: 0, unit: 's' },
      { key: 'fmt', label: 'Save as', type: 'select', value: 'mp4', options: [['mp4', 'MP4 (H.264 + AAC)'], ['webm', 'WebM (VP9 + Opus)']] },
      { key: 'fps', label: 'Frame rate', type: 'select', value: '30', options: [['24', '24 fps'], ['25', '25 fps'], ['30', '30 fps'], ['60', '60 fps']] },
      { key: 'res', label: 'Resolution', type: 'select', value: '0', options: [['0', 'Keep original'], ['1080', 'Max 1080p'], ['720', 'Max 720p']] }],
    async run(files, o, ctx) {
      const vf = files.find(f => M().isVideo(f)), sf = files.find(f => /^(srt|vtt|ass|ssa)$/.test(extOf(f.name)));
      if (!vf || !sf) throw new Error('Add one video and one subtitle file');
      const { cues } = parseSubs(await LC.pdfInternals.readText(sf)), sh = (+o.shift || 0) * 1000;
      const at = t => { const ms = t * 1000 - sh; return cues.filter(c => ms >= c.start && ms < c.end).map(c => c.text).join('\n'); };
      ctx.progress(0, 'Opening ' + vf.name);
      const vid = await M().openVideo(vf);
      try {
        const fps = +o.fps, [W, H] = M().outSize(vid.w, vid.h, o), count = Math.max(1, Math.round(vid.dur * fps));
        let audio = null; try { const a = await M().decodeAudio(vf, 'video'); audio = a; } catch (e) { /* silent video */ }
        const frames = (async function* () { for (let i = 0; i < count; i++) { const t = Math.min(vid.dur - 0.001, i / fps); await M().seek(vid.v, t); yield { t: i / fps, dur: 1 / fps, draw: g => { g.drawImage(vid.v, 0, 0, W, H); drawCaption(g, W, H, at(t), o); } }; } })();
        const r = await M().encodeVideo({ fmt: o.fmt, W, H, fps, bitrate: Math.round(W * H * fps * M().QBPP.high), audio, abr: 160000, frames, count, ctx, label: 'Burning subtitles' });
        return { name: `${baseName(vf.name)}-subtitled.${r.codecs.fmt}`, blob: new Blob([r.bytes], { type: 'video/' + r.codecs.fmt }), video: true, info: `${W}×${H} · ${cues.length} captions · ${M().fmtT(vid.dur)} · ${r.codecs.label}` };
      } finally { vid.close(); }
    }
  });
  alias('hardsub', 'burn-subtitles');
  LC.media2Internals = { denoise, drawCaption, lr4 };
})();
