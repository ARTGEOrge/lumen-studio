'use strict';
/* Lumen Cut — container demuxing + frame-accurate WebCodecs decoding used by the offline renderer.
   MP4/MOV go through mp4box.js (BSD-3, vendored); WebM/Matroska is parsed by the small EBML reader below.
   DecodedSource.frameAt(t) returns the VideoFrame that is on screen at source time t (seconds). */
(function () {
  let mp4boxP = null;
  LC.loadMp4box = () => mp4boxP || (mp4boxP = import(new URL('vendor/mp4box/mp4box.all.js', document.baseURI).href));

  const hex = n => n.toString(16).padStart(2, '0');

  /* ---------- WebM / Matroska (EBML) ---------- */
  function vint(u8, p, keepMarker) {
    const b = u8[p]; if (b === undefined) return null;
    let len = 1, mask = 0x80; while (len <= 8 && !(b & mask)) { len++; mask >>= 1; }
    if (len > 8) return null;
    let v = keepMarker ? b : b & (mask - 1), ones = (b & (mask - 1)) === mask - 1;
    for (let i = 1; i < len; i++) { const x = u8[p + i]; v = v * 256 + x; if (x !== 255) ones = false; }
    return { v, len, unknown: !keepMarker && ones };
  }
  const MASTER = new Set([0x18538067, 0x1654AE6B, 0xAE, 0xE0, 0xE1, 0x1F43B675, 0x1549A966]);
  function demuxWebM(buf) {
    const u8 = new Uint8Array(buf), dv = new DataView(buf), end = u8.length;
    const uint = (p, n) => { let v = 0; for (let i = 0; i < n; i++) v = v * 256 + u8[p + i]; return v; };
    const tracks = []; let cur = null, scale = 1e6, ctc = 0, duration = 0;
    const blocks = [];
    const addBlock = (p, size, keyOverride) => {
      const tn = vint(u8, p, false); if (!tn) return;
      const rel = dv.getInt16(p + tn.len), flags = u8[p + tn.len + 2];
      if ((flags >> 1) & 3) return;                       // laced blocks are audio-only in practice
      const hdr = tn.len + 3;
      blocks.push({ track: tn.v, ts: (ctc + rel) * scale / 1000, key: keyOverride == null ? !!(flags & 0x80) : keyOverride, offset: p + hdr, size: size - hdr });
    };
    let pos = 0;
    while (pos < end - 2) {
      const id = vint(u8, pos, true); if (!id) break; pos += id.len;
      const sz = vint(u8, pos, false); if (!sz) break; pos += sz.len;
      const size = sz.unknown ? -1 : sz.v;
      if (MASTER.has(id.v)) { if (id.v === 0xAE) { cur = {}; tracks.push(cur); } continue; }
      if (id.v === 0xA0) {                                 // BlockGroup
        const gEnd = size < 0 ? end : Math.min(end, pos + size); let blk = null, ref = false, q = pos;
        while (q < gEnd) { const c = vint(u8, q, true); if (!c) break; q += c.len; const cs = vint(u8, q, false); if (!cs) break; q += cs.len; if (c.v === 0xA1) blk = [q, cs.v]; else if (c.v === 0xFB) ref = true; q += cs.v; }
        if (blk) addBlock(blk[0], blk[1], !ref);
        pos = gEnd; continue;
      }
      if (size < 0) break;
      const d = pos; pos += size; if (pos > end) break;
      switch (id.v) {
        case 0x2AD7B1: scale = uint(d, size); break;
        case 0x4489: duration = size === 4 ? dv.getFloat32(d) : dv.getFloat64(d); break;
        case 0xD7: if (cur) cur.number = uint(d, size); break;
        case 0x83: if (cur) cur.type = uint(d, size); break;
        case 0x86: if (cur) cur.codec = new TextDecoder().decode(u8.subarray(d, d + size)).replace(/\0+$/, ''); break;
        case 0x63A2: if (cur) cur.priv = u8.slice(d, d + size); break;
        case 0xB0: if (cur) cur.w = uint(d, size); break;
        case 0xBA: if (cur) cur.h = uint(d, size); break;
        case 0xE7: ctc = uint(d, size); break;
        case 0xA3: addBlock(d, size, null); break;
      }
    }
    const vt = tracks.find(t => t.type === 1); if (!vt) throw new Error('No video track');
    let codec, description;
    if (vt.codec === 'V_VP8') codec = 'vp8';
    else if (vt.codec === 'V_VP9') codec = 'vp09.00.41.08';
    else if (vt.codec === 'V_AV1') codec = 'av01.0.08M.08';
    else if (vt.codec === 'V_MPEG4/ISO/AVC' && vt.priv) { codec = 'avc1.' + hex(vt.priv[1]) + hex(vt.priv[2]) + hex(vt.priv[3]); description = vt.priv; }
    else throw new Error('Unsupported WebM codec ' + vt.codec);
    const samples = blocks.filter(b => b.track === vt.number).sort((a, b) => a.ts - b.ts);
    finish(samples, duration * scale / 1000);
    return { codec, description, width: vt.w, height: vt.h, samples, buf };
  }
  function finish(samples, durUs) {
    const t0 = samples.length ? Math.min(...samples.slice(0, 64).map(s => s.ts)) : 0;
    samples.forEach(s => s.ts -= t0);
    const byPts = samples.slice().sort((a, b) => a.ts - b.ts);
    byPts.forEach((s, i) => { if (!(s.dur > 0)) s.dur = i < byPts.length - 1 ? byPts[i + 1].ts - s.ts : (durUs > s.ts ? durUs - s.ts : 33333); });
  }

  /* ---------- MP4 / MOV ---------- */
  async function demuxMP4(buf) {
    const M = await LC.loadMp4box();
    const f = M.createFile(); let info = null, err = null;
    f.onReady = i => { info = i; }; f.onError = e => { err = e; };
    f.appendBuffer(M.MP4BoxBuffer.fromArrayBuffer(buf, 0)); f.flush();
    if (!info) throw new Error('MP4 parse failed' + (err ? ': ' + err : ''));
    const vt = info.videoTracks[0]; if (!vt) throw new Error('No video track');
    const trak = f.getTrackById(vt.id);
    let description;
    for (const e of trak.mdia.minf.stbl.stsd.entries) {
      const box = e.avcC || e.hvcC || e.vpcC || e.av1C;
      if (box) { const s = new M.DataStream(undefined, 0, M.Endianness.BIG_ENDIAN); box.write(s); description = new Uint8Array(s.buffer, 8); break; }
    }
    const samples = trak.samples.map(s => ({ ts: s.cts * 1e6 / s.timescale, dur: s.duration * 1e6 / s.timescale, key: !!s.is_sync, offset: s.offset, size: s.size }));
    finish(samples, 0);
    return { codec: vt.codec, description, width: vt.video?.width || vt.track_width, height: vt.video?.height || vt.track_height, samples, buf };
  }

  LC.demux = async (blob, name = '') => {
    const buf = await blob.arrayBuffer(); const u8 = new Uint8Array(buf, 0, 12);
    const isEbml = u8[0] === 0x1A && u8[1] === 0x45 && u8[2] === 0xDF && u8[3] === 0xA3;
    return isEbml ? demuxWebM(buf) : demuxMP4(buf);
  };
  LC._demuxWebM = demuxWebM;

  /* ---------- frame-accurate decoder ---------- */
  class DecodedSource {
    constructor(d) { this.d = d; this.frames = []; this.next = 0; this.dec = null; this.ended = false; this.ahead = 6; this.err = null; this.fed = 0; this.out = 0; this.wake = null; }
    static async create(d) {
      const cfg = { codec: d.codec, codedWidth: d.width, codedHeight: d.height, optimizeForLatency: true };
      if (d.description) cfg.description = d.description;
      const sup = await VideoDecoder.isConfigSupported(cfg); if (!sup.supported) throw new Error('Decoder unsupported: ' + d.codec);
      const s = new DecodedSource(d); s.cfg = cfg; return s;
    }
    reset(idx) {
      this.frames.forEach(f => f.close()); this.frames = [];
      if (this.dec && this.dec.state !== 'closed') this.dec.close();
      this.err = null;
      this.dec = new VideoDecoder({ output: f => { this.frames.push(f); this.out++; this.wake?.(); }, error: e => { this.err = e; this.wake?.(); } });
      this.dec.configure(this.cfg);
      this.next = idx; this.ended = false; this.fed = 0; this.out = 0;
      this.lo = this.d.samples[idx]?.ts ?? 0;
    }
    keyIndex(T) {                                   // last keyframe (decode order) whose pts <= T
      const S = this.d.samples; let k = 0;
      for (let i = 0; i < S.length; i++) { if (S[i].key) { if (S[i].ts <= T) k = i; else break; } }
      return k;
    }
    feed() {
      const s = this.d.samples[this.next++];
      this.dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round(s.ts), duration: Math.round(s.dur), data: new Uint8Array(this.d.buf, s.offset, s.size) }));
      this.fed++;
    }
    wait(ms) { return new Promise(r => { const to = setTimeout(() => { this.wake = null; r(false); }, ms); this.wake = () => { clearTimeout(to); this.wake = null; r(true); }; }); }
    async frameAt(t) {
      const S = this.d.samples; if (!S.length) return null;
      const T = Math.round(t * 1e6) + 1;
      const k = this.keyIndex(T);
      if (!this.dec || this.dec.state === 'closed' || T < this.lo || k > this.next || (this.frames.length && T < this.frames[0].timestamp)) this.reset(k);
      for (let guard = 0; guard < 100000; guard++) {
        if (this.err) throw this.err;
        let i = -1; for (let j = 0; j < this.frames.length; j++) if (this.frames[j].timestamp <= T) i = j;
        if (i > 0) { this.frames.splice(0, i).forEach(f => f.close()); }
        const f0 = this.frames[0], have = f0 && f0.timestamp <= T, after = this.frames.some(f => f.timestamp > T);
        if (have && (after || this.ended)) return f0;
        if (!have && after) return f0;
        if (this.ended) return this.frames[this.frames.length - 1] || null;
        if (this.next < S.length) {
          if (this.fed - this.out >= this.ahead) { const ok = await this.wait(60); if (!ok) this.ahead = Math.min(64, this.ahead + 4); }
          else this.feed();
        } else { await this.dec.flush(); this.ended = true; }
      }
      return this.frames[0] || null;
    }
    close() { this.frames.forEach(f => f.close()); this.frames = []; if (this.dec && this.dec.state !== 'closed') this.dec.close(); }
  }
  LC.DecodedSource = DecodedSource;

  /* Fallback: seek an off-DOM <video> per frame (accurate but slower) */
  class SeekSource {
    constructor(url) { const v = this.v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = url; this.ready = new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('video load failed')); }); }
    async frameAt(t) {
      await this.ready; const v = this.v; t = Math.max(0, Math.min(t, (v.duration || 1e9) - 1e-3));
      if (Math.abs(v.currentTime - t) > 1e-4 || this.first !== true) {
        this.first = true;
        await new Promise(r => { const done = () => { v.removeEventListener('seeked', done); r(); }; v.addEventListener('seeked', done); v.currentTime = t + 1e-3; });
        if (v.requestVideoFrameCallback) await Promise.race([new Promise(r => v.requestVideoFrameCallback(r)), new Promise(r => setTimeout(r, 60))]);
      }
      return v;
    }
    close() { this.v.removeAttribute('src'); this.v.load(); }
  }
  LC.SeekSource = SeekSource;
})();
