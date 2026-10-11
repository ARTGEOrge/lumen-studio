'use strict';
/* Lumen Sound — file formats.
   WAV read/write (PCM 8/16/24/32, float 32/64, extensible, cue/labl markers), FLAC encoder (fixed predictors + Rice, stereo decorrelation),
   MP3 via lamejs, Opus via WebCodecs (WebM muxer) with MediaRecorder fallback, sample-rate probing, .lsnd project (zip via fflate). */
window.Codecs = (() => {
  const u8 = b => b instanceof Uint8Array ? b : new Uint8Array(b.buffer ? b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) : b);
  const str4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

  /* ---------------- WAV ---------------- */
  function parseWav(buf) {
    const b = u8(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (b.length < 12 || str4(b, 0) !== 'RIFF' || str4(b, 8) !== 'WAVE') return null;
    let fmt = null, data = null, cues = [], labels = {};
    let o = 12;
    while (o + 8 <= b.length) {
      const id = str4(b, o); let size = dv.getUint32(o + 4, true); const s = o + 8;
      if (s + size > b.length) size = b.length - s; // tolerate truncated files
      if (id === 'fmt ' && size >= 16) {
        fmt = { tag: dv.getUint16(s, true), ch: dv.getUint16(s + 2, true), sr: dv.getUint32(s + 4, true), align: dv.getUint16(s + 12, true), bits: dv.getUint16(s + 14, true) };
        if (fmt.tag === 0xFFFE && size >= 26) fmt.tag = dv.getUint16(s + 24, true);
      } else if (id === 'data') data = { s, size };
      else if (id === 'cue ' && size >= 4) {
        const n = Math.min(dv.getUint32(s, true), Math.floor((size - 4) / 24));
        for (let i = 0; i < n; i++) { const p = s + 4 + i * 24; cues.push({ id: dv.getUint32(p, true), pos: dv.getUint32(p + 20, true) }); }
      } else if (id === 'LIST' && size >= 4 && str4(b, s) === 'adtl') {
        let q = s + 4;
        while (q + 8 <= s + size) {
          const sid = str4(b, q), ss = dv.getUint32(q + 4, true);
          if ((sid === 'labl' || sid === 'note') && ss >= 4 && q + 8 + ss <= b.length) {
            const cid = dv.getUint32(q + 8, true); let k = q + 12; while (k < q + 8 + ss && b[k]) k++; const t = new TextDecoder('utf-8').decode(b.subarray(q + 12, k));
            if (sid === 'labl') labels[cid] = t.slice(0, 200);
          }
          q += 8 + ss + (ss & 1);
        }
      }
      o = s + size + (size & 1);
    }
    if (!fmt || !data) return null;
    const { tag, ch, sr, bits } = fmt;
    if (!ch || ch > 64 || !sr || sr > 1536000) throw new Error('Unsupported WAV header');
    const bps = bits >> 3, frame = ch * bps, n = Math.floor(data.size / frame);
    if (!(tag === 1 && [1, 2, 3, 4].includes(bps)) && !(tag === 3 && (bps === 4 || bps === 8))) return null; // let the browser try
    const chs = Array.from({ length: ch }, () => new Float32Array(n));
    let p = data.s;
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++, p += bps) {
      let v;
      if (tag === 3) v = bps === 4 ? dv.getFloat32(p, true) : dv.getFloat64(p, true);
      else if (bps === 1) v = (b[p] - 128) / 128;
      else if (bps === 2) v = dv.getInt16(p, true) / 32768;
      else if (bps === 3) { let x = b[p] | b[p + 1] << 8 | b[p + 2] << 16; if (x & 0x800000) x |= ~0xFFFFFF; v = x / 8388608; }
      else v = dv.getInt32(p, true) / 2147483648;
      chs[c][i] = v;
    }
    const markers = cues.filter(c => c.pos <= n).map(c => ({ time: c.pos / sr, label: labels[c.id] || `Marker ${c.id}` }));
    return { sr, chs, markers, bits: tag === 3 ? '32-bit float' : bits + '-bit' };
  }
  // fmt: 'pcm16' | 'pcm24' | 'float32'
  function encodeWav(chs, sr, fmt = 'pcm16', markers = []) {
    const ch = chs.length, n = chs[0].length, bps = fmt === 'pcm16' ? 2 : fmt === 'pcm24' ? 3 : 4, isF = fmt === 'float32';
    const dataSize = n * ch * bps;
    const mk = markers.filter(m => m.time * sr <= n);
    const enc = new TextEncoder();
    const labs = mk.map((m, i) => { const t = enc.encode(m.label || ''); const sz = 4 + t.length + 1; return { id: i + 1, t, sz }; });
    const cueSize = mk.length ? 4 + 24 * mk.length : 0;
    const listSize = mk.length ? 4 + labs.reduce((a, l) => a + 8 + l.sz + (l.sz & 1), 0) : 0;
    const fmtSize = isF ? 18 : 16;
    const total = 12 + 8 + fmtSize + 8 + dataSize + (dataSize & 1) + (cueSize ? 8 + cueSize : 0) + (listSize ? 8 + listSize : 0);
    const out = new Uint8Array(total), dv = new DataView(out.buffer);
    let o = 0; const w4 = s => { for (let i = 0; i < 4; i++) out[o++] = s.charCodeAt(i); }; const u32 = v => { dv.setUint32(o, v, true); o += 4; }; const u16 = v => { dv.setUint16(o, v, true); o += 2; };
    w4('RIFF'); u32(total - 8); w4('WAVE');
    w4('fmt '); u32(fmtSize); u16(isF ? 3 : 1); u16(ch); u32(sr); u32(sr * ch * bps); u16(ch * bps); u16(bps * 8); if (isF) u16(0);
    w4('data'); u32(dataSize);
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
      const v = chs[c][i];
      if (isF) { dv.setFloat32(o, v, true); o += 4; }
      else if (bps === 2) { dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(v * 32768))), true); o += 2; }
      else { const x = Math.max(-8388608, Math.min(8388607, Math.round(v * 8388608))); out[o++] = x & 255; out[o++] = (x >> 8) & 255; out[o++] = (x >> 16) & 255; }
    }
    if (dataSize & 1) out[o++] = 0;
    if (cueSize) {
      w4('cue '); u32(cueSize); u32(mk.length);
      mk.forEach((m, i) => { const pos = Math.round(m.time * sr); u32(i + 1); u32(pos); w4('data'); u32(0); u32(0); u32(pos); });
      w4('LIST'); u32(listSize); w4('adtl');
      labs.forEach(l => { w4('labl'); u32(l.sz); u32(l.id); out.set(l.t, o); o += l.t.length; out[o++] = 0; if (l.sz & 1) out[o++] = 0; });
    }
    return out;
  }

  /* ---------------- FLAC encoder ---------------- */
  class BitWriter {
    constructor(cap = 1 << 16) { this.buf = new Uint8Array(cap); this.pos = 0; this.acc = 0; this.cnt = 0; }
    grow(n) { if (this.pos + n > this.buf.length) { const nb = new Uint8Array(Math.max(this.buf.length * 2, this.pos + n + 1024)); nb.set(this.buf); this.buf = nb; } }
    w(v, n) { // v: non-negative integer < 2^n
      if (n > 16) { this.w(Math.floor(v / 65536), n - 16); this.w(v % 65536, 16); return; }
      if (!n) return;
      this.acc = (this.acc << n) | v; this.cnt += n; this.grow(4);
      while (this.cnt >= 8) { this.cnt -= 8; this.buf[this.pos++] = (this.acc >>> this.cnt) & 255; }
      this.acc &= (1 << this.cnt) - 1;
    }
    s(v, n) { this.w(v < 0 ? v + (n < 31 ? (1 << n) : Math.pow(2, n)) : v, n); }
    zeros(q) { while (q >= 16) { this.w(0, 16); q -= 16; } if (q) this.w(0, q); }
    align() { if (this.cnt) this.w(0, 8 - this.cnt); }
    bytes() { return this.buf.subarray(0, this.pos); }
  }
  const CRC8 = new Uint8Array(256), CRC16 = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255; CRC8[i] = c;
    let d = i << 8; for (let k = 0; k < 8; k++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xFFFF : (d << 1) & 0xFFFF; CRC16[i] = d;
  }
  function residualFixed(x, order, out) {
    const n = x.length;
    for (let i = order; i < n; i++) {
      out[i - order] = order === 0 ? x[i] : order === 1 ? x[i] - x[i - 1] : order === 2 ? x[i] - 2 * x[i - 1] + x[i - 2]
        : order === 3 ? x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3] : x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4];
    }
    return n - order;
  }
  // Choose best fixed order + rice partitioning; returns {bits, order, p, params} (or constant / verbatim)
  const MAXP = 6;
  const psum = new Float64Array(1 << MAXP);
  function riceBits(sum, cnt) { // best parameter for a partition (estimate)
    if (!cnt) return [0, 0];
    let k = Math.max(0, Math.min(14, Math.floor(Math.log2(sum / cnt + 1)))), kb = Infinity, bk = k;
    for (let kk = Math.max(0, k - 1); kk <= Math.min(14, k + 1); kk++) { const est = cnt * (kk + 1) + Math.floor(sum / (1 << kk)); if (est < kb) { kb = est; bk = kk; } }
    return [bk, kb];
  }
  // One pass: |residual| sums for fixed predictor orders 0..4 → best order and a rough bit estimate
  function quickOrder(x) {
    const n = x.length; let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
    let p1 = 0, p2 = 0, p3 = 0, xm1 = x[0];
    for (let i = 1; i < n; i++) {
      const v = x[i], d1 = v - xm1, d2 = d1 - p1, d3 = d2 - p2, d4 = d3 - p3;
      if (i >= 4) { s0 += Math.abs(v); s1 += Math.abs(d1); s2 += Math.abs(d2); s3 += Math.abs(d3); s4 += Math.abs(d4); }
      xm1 = v; p1 = d1; p2 = d2; p3 = d3;
    }
    const sums = [s0, s1, s2, s3, s4]; let o = 0; for (let k = 1; k < 5; k++) if (sums[k] < sums[o]) o = k;
    const m = Math.max(1, n - 4);
    return { order: Math.min(o, n - 1), est: n * (1 + Math.log2(1 + sums[o] / m)) };
  }
  function planSubframe(x, bps, tmp, onlyOrder) {
    const n = x.length; let best = { bits: n * bps + 8, verbatim: true };
    let allSame = true; for (let i = 1; i < n; i++) if (x[i] !== x[0]) { allSame = false; break; }
    if (allSame) return { bits: bps + 8, constant: true };
    const o0 = onlyOrder ?? 0, o1 = onlyOrder ?? Math.min(4, n - 1);
    for (let order = o0; order <= o1; order++) {
      const m = residualFixed(x, order, tmp);
      let maxP = 0; while (maxP < MAXP && (n % (1 << (maxP + 1))) === 0 && (n >> (maxP + 1)) > order) maxP++;
      // sums of zig-zag residuals for the finest partitioning, aggregated upwards
      const parts = 1 << maxP, plen = n >> maxP; psum.fill(0, 0, parts);
      for (let i = 0; i < m; i++) { const r = tmp[i], u = r >= 0 ? 2 * r : -2 * r - 1; psum[((i + order) / plen) | 0] += u; }
      for (let p = maxP; p >= 0; p--) {
        const np = 1 << p, step = 1 << (maxP - p), len = n >> p; let bits = 8 + order * bps + 6; const params = [];
        for (let q = 0; q < np; q++) {
          let sum = 0; for (let j = q * step; j < (q + 1) * step; j++) sum += psum[j];
          const [k, kb] = riceBits(sum, q === 0 ? len - order : len); params.push(k); bits += 4 + kb;
        }
        if (bits < best.bits) best = { bits, order, p, params };
      }
    }
    return best;
  }
  function writeSubframe(bw, x, bps, plan, tmp) {
    bw.w(0, 1);
    if (plan.constant) { bw.w(0, 6); bw.w(0, 1); bw.s(x[0], bps); return; }
    if (plan.verbatim) { bw.w(1, 6); bw.w(0, 1); for (let i = 0; i < x.length; i++) bw.s(x[i], bps); return; }
    const { order, p, params } = plan;
    bw.w(8 | order, 6); bw.w(0, 1);
    for (let i = 0; i < order; i++) bw.s(x[i], bps);
    residualFixed(x, order, tmp);
    bw.w(0, 2); bw.w(p, 4);
    const plen = x.length >> p; let idx = 0;
    for (let q = 0; q < (1 << p); q++) {
      const cnt = q === 0 ? plen - order : plen, k = params[q], pk = 1 << k; bw.w(k, 4);
      for (let i = 0; i < cnt; i++) {
        const r = tmp[idx + i], u = r >= 0 ? 2 * r : -2 * r - 1, hi = Math.floor(u / pk), lo = u - hi * pk;
        if (hi + 1 + k <= 24) bw.w(pk + lo, hi + 1 + k);          // unary zeros + stop bit + k low bits in one write
        else { bw.zeros(hi); bw.w(1, 1); if (k) bw.w(lo, k); }
      }
      idx += cnt;
    }
  }
  // chs: Float32Array[] (values within ±1), bits: 16 or 24
  function encodeFlac(chs, sr, bits = 24) {
    const ch = chs.length, n = chs[0].length, B = 4096, scale = Math.pow(2, bits - 1), mx = scale - 1;
    if (ch > 8) throw new Error('FLAC supports up to 8 channels');
    const ints = chs.map(x => { const a = new Int32Array(n); for (let i = 0; i < n; i++) { const v = Math.round(x[i] * scale); a[i] = v > mx ? mx : v < -scale ? -scale : v; } return a; });
    const bw = new BitWriter(Math.max(1 << 16, n * ch * bits / 16 | 0));
    for (const c of 'fLaC') bw.w(c.charCodeAt(0), 8);
    bw.w(1, 1); bw.w(0, 7); bw.w(34, 24);
    bw.w(B, 16); bw.w(B, 16); bw.w(0, 24); bw.w(0, 24); bw.w(sr, 20); bw.w(ch - 1, 3); bw.w(bits - 1, 5); bw.w(n, 36);
    for (let i = 0; i < 16; i++) bw.w(0, 8);
    const tmp = new Float64Array(B), side = new Int32Array(B), mid = new Int32Array(B);
    for (let f = 0, s = 0; s < n; f++, s += B) {
      const bs = Math.min(B, n - s), start = bw.pos;
      const blk = ints.map(a => a.subarray(s, s + bs));
      let assign = ch - 1, subs = blk.map(x => ({ x, bps: bits }));
      if (ch === 2) {
        const L = blk[0], R = blk[1], S = side.subarray(0, bs), M = mid.subarray(0, bs);
        for (let i = 0; i < bs; i++) { S[i] = L[i] - R[i]; M[i] = (L[i] + R[i]) >> 1; }
        const ql = quickOrder(L), qr = quickOrder(R), qs = quickOrder(S), qm = quickOrder(M);
        const opts = [[ql.est + qr.est, 1], [ql.est + qs.est, 8], [qr.est + qs.est, 9], [qm.est + qs.est, 10]].sort((a, b) => a[0] - b[0]);
        assign = opts[0][1];
        subs = assign === 8 ? [{ x: L, bps: bits, q: ql }, { x: S, bps: bits + 1, q: qs }] : assign === 9 ? [{ x: S, bps: bits + 1, q: qs }, { x: R, bps: bits, q: qr }]
          : assign === 10 ? [{ x: M, bps: bits, q: qm }, { x: S, bps: bits + 1, q: qs }] : [{ x: L, bps: bits, q: ql }, { x: R, bps: bits, q: qr }];
      }
      // frame header
      bw.w(0x3FFE, 14); bw.w(0, 1); bw.w(0, 1); bw.w(7, 4); bw.w(0, 4); bw.w(assign, 4); bw.w(0, 3); bw.w(0, 1);
      // UTF-8 style frame number
      if (f < 0x80) bw.w(f, 8);
      else { const nb = f < 0x800 ? 2 : f < 0x10000 ? 3 : f < 0x200000 ? 4 : f < 0x4000000 ? 5 : 6; bw.w((0xFF00 >> nb) & 0xFF | (Math.floor(f / Math.pow(2, 6 * (nb - 1))) & (0x7F >> nb)), 8); for (let k = nb - 2; k >= 0; k--) bw.w(0x80 | (Math.floor(f / Math.pow(2, 6 * k)) & 0x3F), 8); }
      bw.w(bs - 1, 16);
      let crc = 0; for (let i = start; i < bw.pos; i++) crc = CRC8[crc ^ bw.buf[i]]; bw.w(crc, 8);
      for (const sf of subs) writeSubframe(bw, sf.x, sf.bps, planSubframe(sf.x, sf.bps, tmp, (sf.q || quickOrder(sf.x)).order), tmp);
      bw.align();
      let c16 = 0; for (let i = start; i < bw.pos; i++) c16 = ((c16 << 8) & 0xFFFF) ^ CRC16[(c16 >> 8) ^ bw.buf[i]]; bw.w(c16, 16);
    }
    return bw.bytes().slice();
  }

  /* ---------------- sample-rate probing + decoding ---------------- */
  function probeRate(buf) {
    const b = u8(buf);
    try {
      if (b.length > 12 && str4(b, 0) === 'RIFF') return null;
      if (str4(b, 0) === 'fLaC' && b.length > 22) return (b[18] << 12) | (b[19] << 4) | (b[20] >> 4);
      if (str4(b, 0) === 'OggS') {
        const lim = Math.min(b.length - 16, 400);
        for (let i = 0; i < lim; i++) {
          if (b[i] === 1 && str4(b, i + 1) === 'vorb') return new DataView(b.buffer, b.byteOffset).getUint32(i + 12, true);
          if (str4(b, i) === 'Opus' && str4(b, i + 4) === 'Head') return 48000;
        }
      }
      // MP4 / M4A: mp4a sample entry
      if (str4(b, 4) === 'ftyp') {
        for (let i = 0; i < b.length - 40; i++) if (b[i] === 0x6D && str4(b, i) === 'mp4a') { const r = (b[i + 28] << 8) | b[i + 29]; if (r >= 8000) return r; }
      }
      // MP3: skip ID3v2, find frame sync
      let o = 0;
      if (str4(b, 0).startsWith('ID3')) o = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127));
      for (let i = o; i < Math.min(b.length - 4, o + 65536); i++) {
        if (b[i] === 0xFF && (b[i + 1] & 0xE0) === 0xE0) {
          const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, sri = (b[i + 2] >> 2) & 3;
          if (ver === 1 || layer === 0 || sri === 3) continue;
          const base = [44100, 48000, 32000][sri]; return ver === 3 ? base : ver === 2 ? base / 2 : base / 4;
        }
      }
    } catch (e) { /* ignore */ }
    return null;
  }
  // Returns {sr, chs, markers, bits, codec}
  async function decode(buf, name = '') {
    const b = u8(buf);
    const w = parseWav(b);
    if (w) return { ...w, codec: 'WAV' };
    const sr = probeRate(b) || 48000;
    const ctx = new OfflineAudioContext(1, 1, Math.min(384000, Math.max(8000, sr)));
    let ab;
    try { ab = await ctx.decodeAudioData(b.slice().buffer); }
    catch (e) { throw new Error(`Could not decode “${name}”. The file is damaged or uses an unsupported codec.`); }
    const chs = []; for (let c = 0; c < ab.numberOfChannels; c++) chs.push(ab.getChannelData(c).slice());
    const ext = (name.match(/\.([^.]+)$/) || [, ''])[1].toUpperCase();
    return { sr: ab.sampleRate, chs, markers: [], bits: (ext || 'audio') + ' source', codec: ext || 'audio' };
  }

  /* ---------------- MP3 (lamejs, LGPL) ---------------- */
  const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
  function encodeMp3(chs, sr, kbps = 192, onProgress) {
    if (!window.lamejs) throw new Error('MP3 encoder not loaded');
    let rate = sr, data = chs;
    if (!MP3_RATES.includes(sr)) { rate = MP3_RATES.reduce((a, r) => Math.abs(r - sr) < Math.abs(a - sr) ? r : a, 48000); data = chs.map(c => DSP.resample(c, rate / sr)); }
    if (data.length > 2) { const n = data[0].length, l = new Float32Array(n), r = new Float32Array(n); data.forEach((c, i) => { const t = i % 2 ? r : l; for (let k = 0; k < n; k++) t[k] += c[k] * 2 / data.length; }); data = [l, r]; }
    const nc = data.length, enc = new lamejs.Mp3Encoder(nc, rate, kbps), n = data[0].length, out = [];
    const i16 = x => { const a = new Int16Array(x.length); for (let i = 0; i < x.length; i++) a[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))); return a; };
    const L = i16(data[0]), R = nc > 1 ? i16(data[1]) : null, B = 1152 * 8;
    for (let i = 0; i < n; i += B) {
      const r = nc > 1 ? enc.encodeBuffer(L.subarray(i, i + B), R.subarray(i, i + B)) : enc.encodeBuffer(L.subarray(i, i + B));
      if (r.length) out.push(new Uint8Array(r.buffer, r.byteOffset, r.length).slice());
      onProgress?.(i / n);
    }
    const f = enc.flush(); if (f.length) out.push(new Uint8Array(f.buffer, f.byteOffset, f.length).slice());
    return concat(out);
  }
  function concat(parts) { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; }

  /* ---------------- Opus in WebM (WebCodecs) ---------------- */
  const vint = n => { // EBML size
    for (let len = 1; len <= 8; len++) if (n < Math.pow(2, 7 * len) - 1) { const o = new Uint8Array(len); let v = n; for (let i = len - 1; i >= 0; i--) { o[i] = v % 256; v = Math.floor(v / 256); } o[0] |= 0x80 >> (len - 1); return o; }
    throw new Error('EBML size');
  };
  const idb = id => { const a = []; while (id > 0) { a.unshift(id & 255); id = Math.floor(id / 256); } return new Uint8Array(a); };
  const uintb = v => { const a = []; do { a.unshift(v % 256); v = Math.floor(v / 256); } while (v > 0); return new Uint8Array(a); };
  const f64b = v => { const a = new Uint8Array(8); new DataView(a.buffer).setFloat64(0, v); return a; };
  const ebml = (id, data) => { const d = Array.isArray(data) ? concat(data) : data; return concat([idb(id), vint(d.length), d]); };
  const strb = s => new TextEncoder().encode(s);
  function muxWebm(chunks, channels, opusHead, durationMs, codecDelayNs) {
    const head = ebml(0x1A45DFA3, [ebml(0x4286, uintb(1)), ebml(0x42F7, uintb(1)), ebml(0x42F2, uintb(4)), ebml(0x42F3, uintb(8)), ebml(0x4282, strb('webm')), ebml(0x4287, uintb(4)), ebml(0x4285, uintb(2))]);
    const info = ebml(0x1549A966, [ebml(0x2AD7B1, uintb(1000000)), ebml(0x4D80, strb('Lumen Sound')), ebml(0x5741, strb('Lumen Sound')), ebml(0x4489, f64b(durationMs))]);
    const tracks = ebml(0x1654AE6B, ebml(0xAE, [ebml(0xD7, uintb(1)), ebml(0x73C5, uintb(1)), ebml(0x83, uintb(2)), ebml(0x86, strb('A_OPUS')), ebml(0x63A2, opusHead),
      ebml(0x56AA, uintb(codecDelayNs)), ebml(0x56BB, uintb(80000000)), ebml(0xE1, [ebml(0xB5, f64b(48000)), ebml(0x9F, uintb(channels))])]));
    const clusters = []; let cur = null, base = 0;
    for (const c of chunks) {
      const t = Math.round(c.ts / 1000);
      if (!cur || t - base > 30000) { if (cur) clusters.push(ebml(0x1F43B675, cur)); base = t; cur = [ebml(0xE7, uintb(base))]; }
      const rel = t - base, hdr = new Uint8Array([0x81, (rel >> 8) & 255, rel & 255, 0x80]);
      cur.push(ebml(0xA3, concat([hdr, c.data])));
    }
    if (cur) clusters.push(ebml(0x1F43B675, cur));
    const seg = ebml(0x18538067, [info, tracks, ...clusters]);
    return concat([head, seg]);
  }
  function opusHeadBytes(channels, preSkip = 312) {
    const a = new Uint8Array(19), dv = new DataView(a.buffer); strb('OpusHead').forEach((c, i) => a[i] = c);
    a[8] = 1; a[9] = channels; dv.setUint16(10, preSkip, true); dv.setUint32(12, 48000, true); dv.setInt16(16, 0, true); a[18] = 0; return a;
  }
  const hasWebCodecsOpus = async () => { try { return !!window.AudioEncoder && (await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 })).supported; } catch (e) { return false; } };
  async function encodeOpusWebm(chs, sr, kbps = 128, onProgress) {
    let data = chs.length > 2 ? [chs[0], chs[1]] : chs;
    if (sr !== 48000) data = data.map(c => DSP.resample(c, 48000 / sr));
    const nc = data.length, n = data[0].length;
    if (await hasWebCodecsOpus()) {
      const chunks = []; let desc = null, err = null;
      const enc = new AudioEncoder({ output: (ch, meta) => { const d = new Uint8Array(ch.byteLength); ch.copyTo(d); chunks.push({ ts: ch.timestamp, data: d }); if (meta?.decoderConfig?.description) desc = new Uint8Array(meta.decoderConfig.description); }, error: e => err = e });
      enc.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: nc, bitrate: kbps * 1000 });
      const F = 960 * 10;
      for (let i = 0; i < n; i += F) {
        const m = Math.min(F, n - i), buf = new Float32Array(m * nc);
        for (let c = 0; c < nc; c++) buf.set(data[c].subarray(i, i + m), c * m);
        enc.encode(new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: m, numberOfChannels: nc, timestamp: Math.round(i / 48 * 1000), data: buf }));
        if (i % (F * 50) === 0) { onProgress?.(i / n); await new Promise(r => setTimeout(r, 0)); }
      }
      await enc.flush(); enc.close();
      if (err) throw err;
      const head = desc && desc.length >= 19 && strb('OpusHead').every((c, i) => desc[i] === c) ? desc : opusHeadBytes(nc);
      const preSkip = new DataView(head.buffer, head.byteOffset).getUint16(10, true);
      return { bytes: muxWebm(chunks, nc, head, n / 48, Math.round(preSkip / 48000 * 1e9)), mime: 'audio/webm', via: 'WebCodecs' };
    }
    return { bytes: await recordRealtime(data, 48000, kbps), mime: 'audio/webm', via: 'MediaRecorder' };
  }
  // Fallback: play the audio through a MediaStream and record it (real time).
  async function recordRealtime(chs, sr, kbps) {
    const ctx = new AudioContext({ sampleRate: sr }), ab = ctx.createBuffer(chs.length, chs[0].length, sr);
    chs.forEach((c, i) => ab.copyToChannel(c, i));
    const src = ctx.createBufferSource(); src.buffer = ab; const dst = ctx.createMediaStreamDestination(); src.connect(dst);
    const rec = new MediaRecorder(dst.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: kbps * 1000 }); const parts = [];
    rec.ondataavailable = e => parts.push(e.data);
    const done = new Promise(r => rec.onstop = r);
    rec.start(); src.start(); await new Promise(r => src.onended = r); rec.stop(); await done; ctx.close();
    return new Uint8Array(await new Blob(parts).arrayBuffer());
  }

  /* ---------------- Project (.lsnd = zip: project.json + audio/*.flac) ---------------- */
  // Audio is stored as 24-bit FLAC; content louder than 0 dBFS is scaled down and the scale kept in JSON.
  function packAudio(chs, sr) {
    let pk = 0; for (const c of chs) for (let i = 0; i < c.length; i++) { const v = Math.abs(c[i]); if (v > pk) pk = v; }
    const scale = pk > 0.99999 ? pk / 0.99999 : 1;
    const data = scale === 1 ? chs : chs.map(c => c.map(v => v / scale));
    return { bytes: encodeFlac(data, sr, 24), scale };
  }
  async function unpackAudio(bytes, sr, scale, channels) {
    const ctx = new OfflineAudioContext(1, 1, sr);
    const ab = await ctx.decodeAudioData(bytes.slice().buffer);
    if (ab.sampleRate !== sr) throw new Error('Sample-rate mismatch in project audio');
    const chs = []; for (let c = 0; c < ab.numberOfChannels; c++) { const d = ab.getChannelData(c).slice(); if (scale !== 1) for (let i = 0; i < d.length; i++) d[i] *= scale; chs.push(d); }
    if (channels && chs.length !== channels) throw new Error('Channel count mismatch in project audio');
    return chs;
  }
  function zip(files) { return fflate.zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [typeof v === 'string' ? fflate.strToU8(v) : v, { level: typeof v === 'string' ? 6 : 0 }]]))); }
  function unzip(bytes) { return fflate.unzipSync(u8(bytes)); }

  return { parseWav, encodeWav, encodeFlac, probeRate, decode, encodeMp3, MP3_RATES, encodeOpusWebm, hasWebCodecsOpus, muxWebm, packAudio, unpackAudio, zip, unzip, concat };
})();
