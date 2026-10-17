'use strict';
/* Lumen Cut — frame-accurate offline export: every output frame is composited from exactly-decoded source frames
   (WebCodecs VideoDecoder, or per-frame seeking as a fallback), encoded with VideoEncoder/AudioEncoder (WebAudio
   OfflineAudioContext mixdown) and muxed to MP4 (mp4-muxer) or WebM (webm-muxer). Also: still frame → PNG. */
(function () {
  const even = n => Math.max(2, Math.round(n / 2) * 2);

  function avcCodec(w, h, fps) {
    const fs = Math.ceil(w / 16) * Math.ceil(h / 16), mbps = fs * fps;
    const levels = [[31, 3600, 108000], [40, 8192, 245760], [42, 8704, 522240], [50, 22080, 589824], [51, 36864, 983040], [52, 36864, 2073600]];
    const L = levels.find(([, f, r]) => fs <= f && mbps <= r) || levels[levels.length - 1];
    return 'avc1.6400' + L[0].toString(16).padStart(2, '0');
  }
  const BITRATE = { high: 0.22, medium: 0.12, low: 0.06 };   // bits per pixel per frame

  async function pickCodecs(fmt, W, H, fps, q, wantAudio) {
    const bitrate = Math.round(Math.min(80e6, Math.max(1e6, W * H * fps * BITRATE[q])));
    const base = { width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality' };
    const aBase = { sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
    const sup = async (k, cfg) => { try { return (await (k === 'v' ? VideoEncoder : AudioEncoder).isConfigSupported(cfg)).supported; } catch (e) { return false; } };
    if (fmt === 'mp4') {
      for (const codec of [avcCodec(W, H, fps), 'avc1.640033', 'avc1.4d0033']) {
        const v = { ...base, codec, avc: { format: 'avc' } };
        if (await sup('v', v)) {
          let a = null;
          if (wantAudio) { if (await sup('a', { ...aBase, codec: 'mp4a.40.2' })) a = { cfg: { ...aBase, codec: 'mp4a.40.2' }, mux: 'aac' }; else if (await sup('a', { ...aBase, codec: 'opus' })) a = { cfg: { ...aBase, codec: 'opus' }, mux: 'opus' }; }
          return { fmt: 'mp4', v, vmux: 'avc', a };
        }
      }
    }
    for (const [codec, vmux] of [['vp09.00.41.08', 'V_VP9'], ['vp8', 'V_VP8']]) {
      const v = { ...base, codec };
      if (await sup('v', v)) { const a = wantAudio && await sup('a', { ...aBase, codec: 'opus' }) ? { cfg: { ...aBase, codec: 'opus' }, mux: 'A_OPUS' } : null; return { fmt: 'webm', v, vmux, a, fellBack: fmt === 'mp4' }; }
    }
    throw new Error('No supported video encoder (H.264 / VP9 / VP8) is available');
  }

  /* exact-frame source provider used by export and still-frame */
  class ExactFrames {
    constructor() { this.srcs = new Map(); this.demux = new Map(); this.cur = new Map(); this.lastUse = new Map(); this.slow = false; }
    async source(c, key = c.id) {
      let s = this.srcs.get(key); if (s) return s;
      const rt = LC.rt.media.get(c.media);
      s = (async () => {
        try {
          let d = this.demux.get(c.media); if (!d) { d = LC.demux(rt.blob); this.demux.set(c.media, d); }
          return await LC.DecodedSource.create(await d);
        } catch (e) { console.info('Lumen Cut: falling back to seek decoding for', LC.mediaOf(c)?.name, '-', e.message); this.slow = true; return new LC.SeekSource(rt.url); }
      })();
      this.srcs.set(key, s); return s;
    }
    async prepare(t) {
      this.cur.clear();
      // collect what is needed synchronously (descends into nested sequences), then decode
      const need = [];
      LC.walkVideo(t, (c, tt, path) => {
        if (c.type !== 'video') return;
        const rt = LC.rt.media.get(c.media); if (!rt || rt.status !== 'ok') return;
        const m = LC.mediaOf(c); need.push({ c, key: path + c.id, st: Math.min(Math.max(LC.srcTime(c, tt), 0), Math.max(0, m.duration - 1e-3)) });
      });
      for (const n of need) {
        const f = await this.frameOf(n.c, n.st, n.key); this.lastUse.set(n.key, t);
        if (f) this.cur.set(n.key, { src: f, w: f.displayWidth || f.videoWidth, h: f.displayHeight || f.videoHeight, key: 'x:' + n.key });
      }
      // release decoders not used for a while
      for (const [key, p] of this.srcs) { const lu = this.lastUse.get(key); if (lu == null || Math.abs(t - lu) > 2) { p.then(s => s.close()); this.srcs.delete(key); this.lastUse.delete(key); } }
    }
    /* frame at source time st; a stalled/failed decoder is recreated once, then replaced by seek decoding */
    async frameOf(c, st, key = c.id) {
      for (let attempt = 0; ; attempt++) {
        const src = await this.source(c, key);
        try { return await src.frameAt(st); }
        catch (e) {
          if (src instanceof LC.SeekSource) throw e;
          console.info('Lumen Cut: video decoder problem (' + e.message + '), ' + (attempt ? 'falling back to seek decoding' : 'retrying'));
          try { src.close(); } catch (_) { }
          const rt = LC.rt.media.get(c.media);
          if (attempt) { this.slow = true; this.srcs.set(key, Promise.resolve(new LC.SeekSource(rt.url))); }
          else { const d = this.demux.get(c.media); this.srcs.set(key, Promise.resolve(d).then(x => LC.DecodedSource.create(x)).catch(() => { this.slow = true; return new LC.SeekSource(rt.url); })); }
        }
      }
    }
    get(c, st) {
      const m = LC.mediaOf(c), rt = m && LC.rt.media.get(m.id);
      if (!rt || rt.status !== 'ok') return 'offline';
      if (c.type === 'image') return rt.img ? { src: rt.img, w: m.w, h: m.h, key: 'img:' + m.id, version: 1 } : null;
      return this.cur.get((LC._nestPath || '') + c.id) || null;
    }
    close() { for (const p of this.srcs.values()) p.then(s => s.close()); this.srcs.clear(); this.demux.clear(); }
  }
  LC.ExactFrames = ExactFrames;

  /* Render one exact frame at full project resolution → canvas */
  LC.renderStill = async (t, scale = 1) => {
    // one shared offscreen compositor (browsers cap the number of live WebGL contexts); callers copy the canvas right away
    if (!LC._stillComp || LC._stillComp.gl.isContextLost()) { const c = document.createElement('canvas'); LC._stillComp = new LC.Compositor(c); }
    const S = LC.project.settings, comp = LC._stillComp, can = comp.canvas;
    comp.resize(even(S.w * scale), even(S.h * scale));
    const ex = new ExactFrames();
    try { await ex.prepare(t); comp.render(t, (c, st) => ex.get(c, st)); } finally { ex.close(); }
    return can;
  };
  LC.exportFrame = async () => {
    LC.stop(); Aero.busy('Rendering frame…');
    try {
      const can = await LC.renderStill(LC.playhead);
      const blob = await new Promise(r => can.toBlob(r, 'image/png'));
      Aero.busy();
      const name = `${LC.project.name} ${LC.tc(LC.playhead).replace(/:/g, '-')}.png`;
      const p = await Aero.saveFile({ name, data: blob, filters: [{ name: 'PNG image', extensions: ['png'] }] });
      if (p) Aero.toast('Saved frame ' + Aero.baseName(p) + '.png');
      return blob;
    } catch (e) { Aero.busy(); Aero.alert('Export Frame', e.message); }
  };

  /* Core export. opts: {format, range:'all'|'inout', scale, quality, audio}. Returns {blob, ext, info} */
  LC.exportVideo = async (opts = {}, onProgress = () => { }, signal = { aborted: false }) => {
    const P = LC.project, S = P.settings, fps = S.fps;
    const seq = LC.seqDuration(); if (seq <= 0) throw new Error('The sequence is empty');
    let t0 = 0, t1 = seq;
    if (opts.range === 'inout') { t0 = P.inPoint ?? 0; t1 = P.outPoint ?? seq; }
    if (t1 - t0 < 1 / fps) throw new Error('Nothing to export in that range');
    const W = even(S.w * (opts.scale || 1)), H = even(S.h * (opts.scale || 1));
    const hasAudio = opts.audio !== false && P.clips.some(c => (c.type === 'audio' && LC.rt.media.get(c.media)?.audio) || LC.clipKind(c) === 'naudio');
    const codecs = await pickCodecs(opts.format || 'mp4', W, H, fps, opts.quality || 'high', hasAudio);
    const nFrames = Math.round((t1 - t0) * fps);
    const vChunks = [], aChunks = []; let vErr = null, aErr = null;
    // audio first (fast): offline mixdown → AudioEncoder
    if (codecs.a) {
      onProgress({ phase: 'Mixing audio', frame: 0, total: nFrames });
      const buf = await LC.audio.mixdown(t0, t0 + nFrames / fps, 48000);
      const enc = new AudioEncoder({ output: (ch, meta) => aChunks.push([ch, meta]), error: e => aErr = e });
      enc.configure(codecs.a.cfg);
      const L = buf.getChannelData(0), R = buf.getChannelData(1), step = 4800;
      for (let i = 0; i < buf.length; i += step) {
        const n = Math.min(step, buf.length - i), data = new Float32Array(n * 2); data.set(L.subarray(i, i + n), 0); data.set(R.subarray(i, i + n), n);
        const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / 48000 * 1e6), data });
        enc.encode(ad); ad.close();
      }
      await enc.flush(); enc.close(); if (aErr) throw aErr;
    }
    // video
    const can = document.createElement('canvas'), comp = new LC.Compositor(can); comp.resize(W, H);
    const venc = new VideoEncoder({ output: (ch, meta) => vChunks.push([ch, meta]), error: e => vErr = e });
    venc.configure(codecs.v);
    const ex = new ExactFrames(), started = performance.now(), gop = Math.max(1, Math.round(fps * 2));
    try {
      for (let i = 0; i < nFrames; i++) {
        if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
        if (vErr) throw vErr;
        const t = t0 + i / fps;
        await ex.prepare(t);
        comp.render(t, (c, st) => ex.get(c, st));
        const vf = new VideoFrame(can, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
        venc.encode(vf, { keyFrame: i % gop === 0 }); vf.close();
        while (venc.encodeQueueSize > 4) await new Promise(r => venc.addEventListener('dequeue', r, { once: true }));
        if (i % 3 === 0 || i === nFrames - 1) {
          const el = (performance.now() - started) / 1000;
          onProgress({ phase: 'Rendering', frame: i + 1, total: nFrames, elapsed: el, eta: el / (i + 1) * (nFrames - i - 1), slow: ex.slow, canvas: can });
          await new Promise(r => setTimeout(r, 0));
        }
      }
      onProgress({ phase: 'Finishing', frame: nFrames, total: nFrames });
      await venc.flush(); if (vErr) throw vErr;
    } finally { ex.close(); if (venc.state !== 'closed') venc.close(); }
    // mux (chunks merged by timestamp)
    let muxer, target;
    if (codecs.fmt === 'mp4') {
      target = new Mp4Muxer.ArrayBufferTarget();
      muxer = new Mp4Muxer.Muxer({ target, fastStart: 'in-memory', firstTimestampBehavior: 'offset', video: { codec: 'avc', width: W, height: H, frameRate: fps }, audio: codecs.a ? { codec: codecs.a.mux, numberOfChannels: 2, sampleRate: 48000 } : undefined });
    } else {
      target = new WebMMuxer.ArrayBufferTarget();
      muxer = new WebMMuxer.Muxer({ target, firstTimestampBehavior: 'offset', video: { codec: codecs.vmux, width: W, height: H, frameRate: fps }, audio: codecs.a ? { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: 48000 } : undefined });
    }
    let ai = 0;
    for (const [ch, meta] of vChunks) {
      while (ai < aChunks.length && aChunks[ai][0].timestamp <= ch.timestamp) { muxer.addAudioChunk(aChunks[ai][0], aChunks[ai][1]); ai++; }
      muxer.addVideoChunk(ch, meta);
    }
    while (ai < aChunks.length) { muxer.addAudioChunk(aChunks[ai][0], aChunks[ai][1]); ai++; }
    muxer.finalize();
    const type = codecs.fmt === 'mp4' ? 'video/mp4' : 'video/webm';
    return { blob: new Blob([target.buffer], { type }), ext: codecs.fmt, info: { width: W, height: H, fps, frames: nFrames, duration: nFrames / fps, video: codecs.v.codec, audio: codecs.a?.cfg.codec || null, fellBack: !!codecs.fellBack, slow: ex.slow, seconds: (performance.now() - started) / 1000 } };
  };

  /* ---------- UI ---------- */
  /* ---------- audio-only export: offline mixdown → 16-bit PCM WAV ---------- */
  LC.exportAudio = async (opts = {}) => {
    const P = LC.project, seq = LC.seqDuration(), fps = LC.fps(), started = performance.now();
    let t0 = 0, t1 = seq;
    if (opts.range === 'inout') { t0 = P.inPoint ?? 0; t1 = P.outPoint ?? seq; }
    if (t1 - t0 < 1 / fps) throw new Error('Nothing to export in that range');
    const buf = await LC.audio.mixdown(t0, t1, 48000);
    return { blob: LC.audio.toWav(buf), ext: 'wav', info: { duration: buf.duration, sampleRate: buf.sampleRate, channels: buf.numberOfChannels, audio: 'pcm-s16', seconds: (performance.now() - started) / 1000 } };
  };

  /* ---------- export presets. `short` = target short side in pixels (never upscales); null = sequence size ---------- */
  LC.EXPORT_PRESETS = [
    { id: 'match', name: 'Match Sequence · H.264 High', format: 'mp4', short: null, quality: 'high', audio: true },
    { id: 'yt4k', name: 'YouTube 2160p 4K · H.264', format: 'mp4', short: 2160, quality: 'high', audio: true },
    { id: 'yt1080', name: 'YouTube / Vimeo 1080p · H.264', format: 'mp4', short: 1080, quality: 'high', audio: true },
    { id: 'social', name: 'Social Media 720p · H.264 (small)', format: 'mp4', short: 720, quality: 'medium', audio: true },
    { id: 'webm', name: 'Web Video · WebM VP9', format: 'webm', short: null, quality: 'high', audio: true },
    { id: 'draft', name: 'Draft Preview · Quarter, Low', format: 'mp4', scale: .25, quality: 'low', audio: true },
    { id: 'wav', name: 'Audio Only · WAV 48 kHz', format: 'wav', short: null, quality: 'high', audio: true }
  ];
  const SHORTS = [2160, 1440, 1080, 720, 480];
  const sc = x => String(+x.toFixed(6));
  // resolution options for the current sequence: full, standard sizes below it, half and quarter
  LC.exportScales = (S = LC.project.settings) => {
    const sh = Math.min(S.w, S.h), out = [[sc(1), `Full (${S.w}×${S.h})`]], seen = new Set([sc(1)]);
    const add = (k, lab) => { const v = sc(k); if (seen.has(v)) return; seen.add(v); out.push([v, `${lab} (${even(S.w * k)}×${even(S.h * k)})`]); };
    SHORTS.forEach(s => { if (s < sh) add(s / sh, s + 'p'); });
    add(.5, 'Half'); add(.25, 'Quarter');
    return out;
  };
  LC.presetSettings = (id, S = LC.project.settings) => {
    const p = LC.EXPORT_PRESETS.find(x => x.id === id); if (!p) return null;
    const sh = Math.min(S.w, S.h), k = p.scale ?? (p.short && p.short < sh ? p.short / sh : 1);
    return { format: p.format, scale: sc(k), quality: p.quality, audio: p.audio };
  };
  const LAST_KEY = 'lumen-cut-export';
  const loadLast = () => { try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); } catch (e) { return null; } };
  const saveLast = v => { try { localStorage.setItem(LAST_KEY, JSON.stringify({ preset: v.preset, format: v.format, quality: v.quality, audio: v.audio })); } catch (e) { } };

  LC.exportDialog = () => {
    LC.stop();
    const P = LC.project, S = P.settings, seq = LC.seqDuration();
    if (seq <= 0) return Aero.alert('Export', 'The sequence is empty. Add some clips to the timeline first.');
    const hasIO = P.inPoint != null || P.outPoint != null;
    const scales = LC.exportScales(S), last = loadLast() || {};
    const init = last.preset && last.preset !== 'custom' ? LC.presetSettings(last.preset, S) : null;
    const v0 = init || { format: ['mp4', 'webm', 'wav'].includes(last.format) ? last.format : 'mp4', scale: sc(1), quality: BITRATE[last.quality] ? last.quality : 'high', audio: last.audio !== false };
    const summary = v => {
      const d = v.range === 'inout' ? (P.outPoint ?? seq) - (P.inPoint ?? 0) : seq;
      if (v.format === 'wav') { const mb = d * 48000 * 4 / 1e6; return `Audio only · 48 kHz stereo 16-bit PCM · ${LC.tc(d)} · ≈${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`; }
      const k = +v.scale, W = even(S.w * k), H = even(S.h * k), mb = W * H * S.fps * BITRATE[v.quality] * d / 8 / 1e6;
      return `${W}×${H} · ${S.fps} fps · ${LC.tc(d)} · ${v.format === 'mp4' ? 'H.264 + AAC' : 'VP9 + Opus'}${v.audio ? '' : ' (no audio)'} · ≈${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
    };
    const matches = v => LC.EXPORT_PRESETS.find(p => { const q = LC.presetSettings(p.id, S); return q.format === v.format && (v.format === 'wav' || (q.scale === v.scale && q.quality === v.quality && q.audio === v.audio)); })?.id || 'custom';
    let syncing = false, dlg = null;
    dlg = Aero.dialog({ title: 'Export Media', instruction: 'Render the sequence to a video or audio file', ok: 'Export', width: 540,
      fields: [
        { key: 'preset', label: 'Preset', type: 'select', value: matches(v0), options: [...LC.EXPORT_PRESETS.map(p => [p.id, p.name]), ['custom', 'Custom']] },
        { key: 'format', label: 'Format', type: 'select', value: v0.format, options: [['mp4', 'MP4 (H.264 / AAC)'], ['webm', 'WebM (VP9 / Opus)'], ['wav', 'WAV (audio only)']] },
        { key: 'range', label: 'Range', type: 'select', value: hasIO ? 'inout' : 'all', options: [['all', 'Entire sequence'], ['inout', 'In to Out']] },
        { key: 'scale', label: 'Resolution', type: 'select', value: scales.some(o => o[0] === v0.scale) ? v0.scale : sc(1), options: scales },
        { key: 'quality', label: 'Quality', type: 'select', value: v0.quality, options: [['high', 'High'], ['medium', 'Medium'], ['low', 'Low (small file)']] },
        { key: 'audio', label: 'Include audio', type: 'checkbox', value: v0.audio }],
      html: '<div class="dnote" id="exsum"></div>',
      onInput: (key, v, set) => {
        if (syncing) return; syncing = true;
        try {
          if (key === 'preset' && v.preset !== 'custom') { const q = LC.presetSettings(v.preset, S); ['format', 'scale', 'quality', 'audio'].forEach(k => set(k, q[k])); }
          else if (key !== 'preset' && key !== 'range') set('preset', matches(v));
        } finally { syncing = false; }
      },
      onChange: v => {
        const e = document.getElementById('exsum'); if (e) e.textContent = summary(v);
        const box = document.getElementById('exsum')?.closest('.aero-box');
        if (box) box.querySelectorAll('.aero-row').forEach(r => { const lab = r.querySelector('label')?.textContent, i = r.querySelector('select, input'); if (i && (lab === 'Resolution' || lab === 'Quality')) i.disabled = v.format === 'wav'; });
      },
      onOK: v => { saveLast(v); runExport({ ...v, scale: +v.scale }); } });
    return dlg;
  };
  LC.exportWav = () => {
    LC.stop(); const P = LC.project;
    if (LC.seqDuration() <= 0) return Aero.alert('Export', 'The sequence is empty. Add some clips to the timeline first.');
    return runExport({ format: 'wav', range: P.inPoint != null || P.outPoint != null ? 'inout' : 'all' });
  };
  async function runExport(opts) {
    if (opts.format === 'wav') {
      Aero.busy('Mixing audio…');
      try {
        const res = await LC.exportAudio(opts); Aero.busy();
        const fname = `${LC.project.name}.wav`;
        const p = await Aero.saveFile({ name: fname, data: res.blob, filters: [{ name: 'WAV audio', extensions: ['wav'] }] });
        if (p) Aero.toast(`Exported ${fname} · ${(res.blob.size / 1048576).toFixed(1)} MB`, 4000);
      } catch (e) { Aero.busy(); Aero.alert('Export failed', e.message || String(e)); }
      return;
    }
    const ext = opts.format; const name = `${LC.project.name}.${ext}`;
    const signal = { aborted: false };
    const ov = Aero.el('div', 'aero-modal'); ov.innerHTML = `<div class="aero-box exbox"><h3><img src="../kit/icons/cut.png" alt="">Exporting</h3><div class="content"><div class="aero-instr"></div>
      <div class="exrow"><canvas class="exprev" width="192" height="108"></canvas><div class="grow"><div class="pbar"><i></i></div><div class="exinfo dim">Preparing…</div></div></div></div><div class="aero-btns"><button class="aero-btn" data-a="c">Cancel</button></div></div>`;
    ov.querySelector('.aero-instr').textContent = `Rendering “${name}”`;
    document.body.appendChild(ov);
    const bar = ov.querySelector('.pbar i'), info = ov.querySelector('.exinfo'), prev = ov.querySelector('.exprev').getContext('2d');
    ov.querySelector('[data-a=c]').onclick = () => { signal.aborted = true; info.textContent = 'Cancelling…'; };
    try {
      const res = await LC.exportVideo(opts, p => {
        const f = p.total ? p.frame / p.total : 0; bar.style.width = (f * 100).toFixed(1) + '%';
        info.textContent = p.phase === 'Rendering' ? `Frame ${p.frame} of ${p.total} · ${Math.round(f * 100)}% · ${fmtS(p.elapsed)} elapsed · ${fmtS(p.eta)} left${p.slow ? ' · seek decoding' : ''}` : p.phase + '…';
        if (p.canvas) prev.drawImage(p.canvas, 0, 0, 192, 108);
      }, signal);
      ov.remove();
      if (res.info.fellBack) Aero.toast('H.264 is not available here — exported WebM (VP9) instead', 4000);
      const fname = `${LC.project.name}.${res.ext}`;
      const p = await Aero.saveFile({ name: fname, data: res.blob, filters: [{ name: res.ext.toUpperCase() + ' video', extensions: [res.ext] }] });
      if (p) Aero.toast(`Exported ${fname} · ${(res.blob.size / 1048576).toFixed(1)} MB in ${fmtS(res.info.seconds)}`, 4000);
    } catch (e) {
      ov.remove();
      if (e.name === 'AbortError') Aero.toast('Export cancelled'); else Aero.alert('Export failed', e.message || String(e));
    }
  }
  const fmtS = s => !isFinite(s) ? '–' : s < 60 ? `${Math.round(s)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
})();
