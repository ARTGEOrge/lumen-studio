'use strict';
/* Lumen Convert — audio & video tools: audio converter, extract audio, video → GIF, video converter,
   GIF → MP4/WebM, audio speed/pitch, video trim & compress.
   WAV/FLAC/MP3 encoders, sinc resampler and WSOLA time-stretch adapted from Lumen Sound (sound/js/codecs.js, dsp.js). */
(() => {
  const { register, alias, util: U } = LC;
  const { el, fmtSize, baseName, extOf, sleep } = U;
  const AUDIO_EXT = /^(wav|wave|mp3|ogg|oga|opus|flac|m4a|aac|weba|webm|mp4|caf|aif|aiff)$/;
  const VIDEO_EXT = /^(mp4|m4v|webm|mov|mkv|ogv|avi|3gp)$/;
  const isAudio = f => /^audio\//.test(f.type) || AUDIO_EXT.test(extOf(f.name));
  const isVideo = f => /^video\//.test(f.type) || VIDEO_EXT.test(extOf(f.name));
  const u8 = b => b instanceof Uint8Array ? b : new Uint8Array(b);
  const str4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  const fmtT = s => { s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(1).padStart(4, '0')}`; };

  /* ---------------- WAV ---------------- */
  function parseWav(b) {
    if (b.length < 12 || str4(b, 0) !== 'RIFF' || str4(b, 8) !== 'WAVE') return null;
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let fmt = null, data = null, o = 12;
    while (o + 8 <= b.length) {
      const id = str4(b, o); let size = dv.getUint32(o + 4, true); const s = o + 8;
      if (s + size > b.length) size = b.length - s;
      if (id === 'fmt ' && size >= 16) { fmt = { tag: dv.getUint16(s, true), ch: dv.getUint16(s + 2, true), sr: dv.getUint32(s + 4, true), bits: dv.getUint16(s + 14, true) }; if (fmt.tag === 0xFFFE && size >= 26) fmt.tag = dv.getUint16(s + 24, true); }
      else if (id === 'data') data = { s, size };
      o = s + size + (size & 1);
    }
    if (!fmt || !data) return null;
    const { tag, ch, sr, bits } = fmt;
    if (!ch || ch > 32 || !sr || sr > 768000) throw new Error('Unsupported WAV header');
    const bps = bits >> 3, n = Math.floor(data.size / (ch * bps));
    if (!(tag === 1 && [1, 2, 3, 4].includes(bps)) && !(tag === 3 && (bps === 4 || bps === 8))) return null;
    if (n * ch > 400e6) throw new Error('The WAV file is too long to convert in the browser');
    const chs = Array.from({ length: ch }, () => new Float32Array(n)); let p = data.s;
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++, p += bps) {
      let v;
      if (tag === 3) v = bps === 4 ? dv.getFloat32(p, true) : dv.getFloat64(p, true);
      else if (bps === 1) v = (b[p] - 128) / 128;
      else if (bps === 2) v = dv.getInt16(p, true) / 32768;
      else if (bps === 3) { let x = b[p] | b[p + 1] << 8 | b[p + 2] << 16; if (x & 0x800000) x |= ~0xFFFFFF; v = x / 8388608; }
      else v = dv.getInt32(p, true) / 2147483648;
      chs[c][i] = v;
    }
    return { sr, chs, desc: `WAV ${tag === 3 ? '32-bit float' : bits + '-bit'}` };
  }
  function encodeWav(chs, sr, fmt = 'pcm16') {
    const ch = chs.length, n = chs[0].length, bps = fmt === 'pcm16' ? 2 : fmt === 'pcm24' ? 3 : 4, isF = fmt === 'float32';
    const dataSize = n * ch * bps, fmtSize = isF ? 18 : 16, total = 12 + 8 + fmtSize + 8 + dataSize + (dataSize & 1);
    const out = new Uint8Array(total), dv = new DataView(out.buffer); let o = 0;
    const w4 = s => { for (let i = 0; i < 4; i++) out[o++] = s.charCodeAt(i); }, u32 = v => { dv.setUint32(o, v, true); o += 4; }, u16 = v => { dv.setUint16(o, v, true); o += 2; };
    w4('RIFF'); u32(total - 8); w4('WAVE'); w4('fmt '); u32(fmtSize); u16(isF ? 3 : 1); u16(ch); u32(sr); u32(sr * ch * bps); u16(ch * bps); u16(bps * 8); if (isF) u16(0);
    w4('data'); u32(dataSize);
    for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
      const v = chs[c][i];
      if (isF) { dv.setFloat32(o, v, true); o += 4; }
      else if (bps === 2) { dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(v * 32768))), true); o += 2; }
      else { const x = Math.max(-8388608, Math.min(8388607, Math.round(v * 8388608))); out[o++] = x & 255; out[o++] = (x >> 8) & 255; out[o++] = (x >> 16) & 255; }
    }
    return out;
  }

  /* ---------------- FLAC encoder (fixed predictors + Rice; from Lumen Sound) ---------------- */
  class BitWriter {
    constructor(cap = 1 << 16) { this.buf = new Uint8Array(cap); this.pos = 0; this.acc = 0; this.cnt = 0; }
    grow(n) { if (this.pos + n > this.buf.length) { const nb = new Uint8Array(Math.max(this.buf.length * 2, this.pos + n + 1024)); nb.set(this.buf); this.buf = nb; } }
    w(v, n) { if (n > 16) { this.w(Math.floor(v / 65536), n - 16); this.w(v % 65536, 16); return; } if (!n) return; this.acc = (this.acc << n) | v; this.cnt += n; this.grow(4); while (this.cnt >= 8) { this.cnt -= 8; this.buf[this.pos++] = (this.acc >>> this.cnt) & 255; } this.acc &= (1 << this.cnt) - 1; }
    s(v, n) { this.w(v < 0 ? v + (n < 31 ? (1 << n) : Math.pow(2, n)) : v, n); }
    zeros(q) { while (q >= 16) { this.w(0, 16); q -= 16; } if (q) this.w(0, q); }
    align() { if (this.cnt) this.w(0, 8 - this.cnt); }
    bytes() { return this.buf.subarray(0, this.pos); }
  }
  const CRC8 = new Uint8Array(256), CRC16 = new Uint16Array(256);
  for (let i = 0; i < 256; i++) { let c = i; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255; CRC8[i] = c; let d = i << 8; for (let k = 0; k < 8; k++) d = d & 0x8000 ? ((d << 1) ^ 0x8005) & 0xFFFF : (d << 1) & 0xFFFF; CRC16[i] = d; }
  function residualFixed(x, order, out) { const n = x.length; for (let i = order; i < n; i++) out[i - order] = order === 0 ? x[i] : order === 1 ? x[i] - x[i - 1] : order === 2 ? x[i] - 2 * x[i - 1] + x[i - 2] : order === 3 ? x[i] - 3 * x[i - 1] + 3 * x[i - 2] - x[i - 3] : x[i] - 4 * x[i - 1] + 6 * x[i - 2] - 4 * x[i - 3] + x[i - 4]; return n - order; }
  const MAXP = 6, psum = new Float64Array(1 << MAXP);
  function riceBits(sum, cnt) { if (!cnt) return [0, 0]; let k = Math.max(0, Math.min(14, Math.floor(Math.log2(sum / cnt + 1)))), kb = Infinity, bk = k; for (let kk = Math.max(0, k - 1); kk <= Math.min(14, k + 1); kk++) { const est = cnt * (kk + 1) + Math.floor(sum / (1 << kk)); if (est < kb) { kb = est; bk = kk; } } return [bk, kb]; }
  function quickOrder(x) { const n = x.length; let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, p1 = 0, p2 = 0, p3 = 0, xm1 = x[0]; for (let i = 1; i < n; i++) { const v = x[i], d1 = v - xm1, d2 = d1 - p1, d3 = d2 - p2, d4 = d3 - p3; if (i >= 4) { s0 += Math.abs(v); s1 += Math.abs(d1); s2 += Math.abs(d2); s3 += Math.abs(d3); s4 += Math.abs(d4); } xm1 = v; p1 = d1; p2 = d2; p3 = d3; } const sums = [s0, s1, s2, s3, s4]; let o = 0; for (let k = 1; k < 5; k++) if (sums[k] < sums[o]) o = k; const m = Math.max(1, n - 4); return { order: Math.min(o, n - 1), est: n * (1 + Math.log2(1 + sums[o] / m)) }; }
  function planSubframe(x, bps, tmp, onlyOrder) {
    const n = x.length; let best = { bits: n * bps + 8, verbatim: true };
    let same = true; for (let i = 1; i < n; i++) if (x[i] !== x[0]) { same = false; break; } if (same) return { bits: bps + 8, constant: true };
    const o0 = onlyOrder ?? 0, o1 = onlyOrder ?? Math.min(4, n - 1);
    for (let order = o0; order <= o1; order++) {
      const m = residualFixed(x, order, tmp); let maxP = 0; while (maxP < MAXP && (n % (1 << (maxP + 1))) === 0 && (n >> (maxP + 1)) > order) maxP++;
      const parts = 1 << maxP, plen = n >> maxP; psum.fill(0, 0, parts);
      for (let i = 0; i < m; i++) { const r = tmp[i], u = r >= 0 ? 2 * r : -2 * r - 1; psum[((i + order) / plen) | 0] += u; }
      for (let p = maxP; p >= 0; p--) { const np = 1 << p, step = 1 << (maxP - p), len = n >> p; let bits = 8 + order * bps + 6; const params = []; for (let q = 0; q < np; q++) { let sum = 0; for (let j = q * step; j < (q + 1) * step; j++) sum += psum[j]; const [k, kb] = riceBits(sum, q === 0 ? len - order : len); params.push(k); bits += 4 + kb; } if (bits < best.bits) best = { bits, order, p, params }; }
    }
    return best;
  }
  function writeSubframe(bw, x, bps, plan, tmp) {
    bw.w(0, 1);
    if (plan.constant) { bw.w(0, 6); bw.w(0, 1); bw.s(x[0], bps); return; }
    if (plan.verbatim) { bw.w(1, 6); bw.w(0, 1); for (let i = 0; i < x.length; i++) bw.s(x[i], bps); return; }
    const { order, p, params } = plan; bw.w(8 | order, 6); bw.w(0, 1); for (let i = 0; i < order; i++) bw.s(x[i], bps);
    residualFixed(x, order, tmp); bw.w(0, 2); bw.w(p, 4);
    const plen = x.length >> p; let idx = 0;
    for (let q = 0; q < (1 << p); q++) { const cnt = q === 0 ? plen - order : plen, k = params[q], pk = 1 << k; bw.w(k, 4); for (let i = 0; i < cnt; i++) { const r = tmp[idx + i], u = r >= 0 ? 2 * r : -2 * r - 1, hi = Math.floor(u / pk), lo = u - hi * pk; if (hi + 1 + k <= 24) bw.w(pk + lo, hi + 1 + k); else { bw.zeros(hi); bw.w(1, 1); if (k) bw.w(lo, k); } } idx += cnt; }
  }
  async function encodeFlac(chs, sr, bits = 16, onProgress) {
    const ch = chs.length, n = chs[0].length, B = 4096, scale = Math.pow(2, bits - 1), mx = scale - 1;
    if (ch > 8) throw new Error('FLAC supports up to 8 channels');
    const ints = chs.map(x => { const a = new Int32Array(n); for (let i = 0; i < n; i++) { const v = Math.round(x[i] * scale); a[i] = v > mx ? mx : v < -scale ? -scale : v; } return a; });
    const bw = new BitWriter(Math.max(1 << 16, n * ch * bits / 16 | 0));
    for (const c of 'fLaC') bw.w(c.charCodeAt(0), 8);
    bw.w(1, 1); bw.w(0, 7); bw.w(34, 24); bw.w(B, 16); bw.w(B, 16); bw.w(0, 24); bw.w(0, 24); bw.w(sr, 20); bw.w(ch - 1, 3); bw.w(bits - 1, 5); bw.w(n, 36);
    for (let i = 0; i < 16; i++) bw.w(0, 8);
    const tmp = new Float64Array(B), side = new Int32Array(B), mid = new Int32Array(B);
    for (let f = 0, s = 0; s < n; f++, s += B) {
      const bs = Math.min(B, n - s), start = bw.pos, blk = ints.map(a => a.subarray(s, s + bs));
      let assign = ch - 1, subs = blk.map(x => ({ x, bps: bits }));
      if (ch === 2) {
        const L = blk[0], R = blk[1], S = side.subarray(0, bs), M = mid.subarray(0, bs);
        for (let i = 0; i < bs; i++) { S[i] = L[i] - R[i]; M[i] = (L[i] + R[i]) >> 1; }
        const ql = quickOrder(L), qr = quickOrder(R), qs = quickOrder(S), qm = quickOrder(M);
        assign = [[ql.est + qr.est, 1], [ql.est + qs.est, 8], [qr.est + qs.est, 9], [qm.est + qs.est, 10]].sort((a, b) => a[0] - b[0])[0][1];
        subs = assign === 8 ? [{ x: L, bps: bits, q: ql }, { x: S, bps: bits + 1, q: qs }] : assign === 9 ? [{ x: S, bps: bits + 1, q: qs }, { x: R, bps: bits, q: qr }] : assign === 10 ? [{ x: M, bps: bits, q: qm }, { x: S, bps: bits + 1, q: qs }] : [{ x: L, bps: bits, q: ql }, { x: R, bps: bits, q: qr }];
      }
      bw.w(0x3FFE, 14); bw.w(0, 1); bw.w(0, 1); bw.w(7, 4); bw.w(0, 4); bw.w(assign, 4); bw.w(0, 3); bw.w(0, 1);
      if (f < 0x80) bw.w(f, 8); else { const nb = f < 0x800 ? 2 : f < 0x10000 ? 3 : f < 0x200000 ? 4 : f < 0x4000000 ? 5 : 6; bw.w((0xFF00 >> nb) & 0xFF | (Math.floor(f / Math.pow(2, 6 * (nb - 1))) & (0x7F >> nb)), 8); for (let k = nb - 2; k >= 0; k--) bw.w(0x80 | (Math.floor(f / Math.pow(2, 6 * k)) & 0x3F), 8); }
      bw.w(bs - 1, 16);
      let crc = 0; for (let i = start; i < bw.pos; i++) crc = CRC8[crc ^ bw.buf[i]]; bw.w(crc, 8);
      for (const sf of subs) writeSubframe(bw, sf.x, sf.bps, planSubframe(sf.x, sf.bps, tmp, (sf.q || quickOrder(sf.x)).order), tmp);
      bw.align();
      let c16 = 0; for (let i = start; i < bw.pos; i++) c16 = ((c16 << 8) & 0xFFFF) ^ CRC16[(c16 >> 8) ^ bw.buf[i]]; bw.w(c16, 16);
      if (f % 64 === 0) { onProgress?.(s / n); await U.tick(); }
    }
    return bw.bytes().slice();
  }

  /* ---------------- MP3 (lamejs, LGPL, unmodified separate file) ---------------- */
  const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
  async function encodeMp3(chs, sr, kbps = 192, onProgress) {
    const lamejs = await U.lib.lame();
    let rate = sr, data = chs;
    if (!MP3_RATES.includes(sr)) { rate = MP3_RATES.reduce((a, r) => Math.abs(r - sr) < Math.abs(a - sr) ? r : a, 48000); data = chs.map(c => resample(c, rate / sr)); }
    if (data.length > 2) data = mixTo(data, 2);
    const nc = data.length, enc = new lamejs.Mp3Encoder(nc, rate, kbps), n = data[0].length, out = [];
    const i16 = x => { const a = new Int16Array(x.length); for (let i = 0; i < x.length; i++) a[i] = Math.max(-32768, Math.min(32767, Math.round(x[i] * 32767))); return a; };
    const L = i16(data[0]), R = nc > 1 ? i16(data[1]) : null, B = 1152 * 16;
    for (let i = 0; i < n; i += B) {
      const r = nc > 1 ? enc.encodeBuffer(L.subarray(i, i + B), R.subarray(i, i + B)) : enc.encodeBuffer(L.subarray(i, i + B));
      if (r.length) out.push(new Uint8Array(r.buffer, r.byteOffset, r.length).slice());
      if ((i / B) % 20 === 0) { onProgress?.(i / n); await U.tick(); }
    }
    const f = enc.flush(); if (f.length) out.push(new Uint8Array(f.buffer, f.byteOffset, f.length).slice());
    return { bytes: concat(out), rate };
  }
  function concat(parts) { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let k = 0; for (const p of parts) { o.set(p, k); k += p.length; } return o; }

  /* ---------------- DSP: sinc resampler + WSOLA (from Lumen Sound) ---------------- */
  const RS_W = 16, RS_OS = 512; let rsTable = null;
  function besselI0(x) { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / (2 * k)) ** 2; s += t; if (t < 1e-12 * s) break; } return s; }
  function rsInit() { const n = RS_W * RS_OS, beta = 9, i0b = besselI0(beta); rsTable = new Float32Array(n + 2); for (let i = 0; i <= n; i++) { const x = i / RS_OS, r = x / RS_W; const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x); rsTable[i] = sinc * besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b; } }
  function resample(x, ratio, outLen) {
    if (!rsTable) rsInit();
    const len = x.length; outLen = outLen || Math.max(1, Math.round(len * ratio));
    const out = new Float32Array(outLen); if (Math.abs(ratio - 1) < 1e-12 && outLen === len) { out.set(x); return out; }
    const fc = ratio < 1 ? ratio * 0.97 : 1, half = RS_W / fc, T = rsTable, sc = fc * RS_OS;
    for (let i = 0; i < outLen; i++) { const t = i / ratio, k0 = Math.max(0, Math.ceil(t - half)), k1 = Math.min(len - 1, Math.floor(t + half)); let s = 0; for (let k = k0; k <= k1; k++) { const d = Math.abs(t - k) * sc, di = d | 0; s += x[k] * (T[di] + (T[di + 1] - T[di]) * (d - di)); } out[i] = s * fc; }
    return out;
  }
  const hann = n => { const w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); return w; };
  function wsola(chs, sr, factor) {
    const len = chs[0].length, outLen = Math.max(1, Math.round(len * factor));
    let N = Math.round(sr * 0.046); N += N & 1; const Hs = N >> 1, Ha = Hs / factor, tol = Math.round(sr * 0.012), w = hann(N);
    const m = new Float32Array(len); for (const c of chs) for (let i = 0; i < len; i++) m[i] += c[i] / chs.length;
    const outs = chs.map(() => new Float32Array(outLen + N + 1)), at = i => (i >= 0 && i < len ? m[i] : 0);
    let prev = 0;
    const score = (cand, tgt, step) => { let s = 0, e = 1e-9; for (let i = 0; i < Hs; i += step) { const a = at(cand + i); s += a * at(tgt + i); e += a * a; } return s / Math.sqrt(e); };
    for (let k = 0; k * Hs < outLen; k++) {
      const nominal = Math.round(k * Ha); let pos = nominal;
      if (k > 0) { const tgt = prev + Hs; let best = -Infinity, bd = 0; for (let d = -tol; d <= tol; d += 4) { const s = score(nominal + d, tgt, 4); if (s > best) { best = s; bd = d; } } let best2 = -Infinity, bd2 = bd; for (let d = bd - 4; d <= bd + 4; d++) { const s = score(nominal + d, tgt, 1); if (s > best2) { best2 = s; bd2 = d; } } pos = nominal + bd2; }
      const o = k * Hs;
      for (let c = 0; c < chs.length; c++) { const x = chs[c], y = outs[c]; for (let i = 0; i < N; i++) { const idx = pos + i; if (idx >= 0 && idx < len) y[o + i] += x[idx] * w[i]; } }
      prev = pos;
    }
    return outs.map(y => { const r = y.subarray(0, outLen).slice(); for (let i = 0; i < Math.min(Hs, outLen); i++) r[i] /= Math.max(w[i], 0.05); return r; });
  }
  function mixTo(chs, n) {
    if (chs.length === n) return chs;
    const len = chs[0].length;
    if (n === 1) { const m = new Float32Array(len); for (const c of chs) for (let i = 0; i < len; i++) m[i] += c[i] / chs.length; return [m]; }
    if (chs.length === 1) return [chs[0], chs[0].slice()];
    const l = new Float32Array(len), r = new Float32Array(len); chs.forEach((c, i) => { const t = i % 2 ? r : l; const k = 2 / chs.length; for (let j = 0; j < len; j++) t[j] += c[j] * k; }); return [l, r];
  }

  /* ---------------- decoding ---------------- */
  function probeRate(b) {
    try {
      if (str4(b, 0) === 'fLaC' && b.length > 22) return (b[18] << 12) | (b[19] << 4) | (b[20] >> 4);
      if (str4(b, 0) === 'OggS') { for (let i = 0; i < Math.min(b.length - 16, 400); i++) { if (b[i] === 1 && str4(b, i + 1) === 'vorb') return new DataView(b.buffer, b.byteOffset).getUint32(i + 12, true); if (str4(b, i) === 'Opus' && str4(b, i + 4) === 'Head') return 48000; } }
      if (str4(b, 4) === 'ftyp') { const lim = Math.min(b.length - 40, 64 * 1048576); for (let i = 0; i < lim; i++) if (b[i] === 0x6D && str4(b, i) === 'mp4a') { const r = (b[i + 28] << 8) | b[i + 29]; if (r >= 8000) return r; } }
      if (b[0] === 0x1A && b[1] === 0x45) return 48000;
      let o = 0; if (str4(b, 0).startsWith('ID3')) o = 10 + ((b[6] & 127) << 21 | (b[7] & 127) << 14 | (b[8] & 127) << 7 | (b[9] & 127));
      for (let i = o; i < Math.min(b.length - 4, o + 65536); i++) if (b[i] === 0xFF && (b[i + 1] & 0xE0) === 0xE0) { const ver = (b[i + 1] >> 3) & 3, layer = (b[i + 1] >> 1) & 3, sri = (b[i + 2] >> 2) & 3; if (ver === 1 || layer === 0 || sri === 3) continue; const base = [44100, 48000, 32000][sri]; return ver === 3 ? base : ver === 2 ? base / 2 : base / 4; }
    } catch (e) { /* ignore */ }
    return null;
  }
  async function decodeAudio(file, what = 'audio') {
    if (file.size > 1024 * 1048576) throw new Error('The file is larger than 1 GB');
    const b = new Uint8Array(await file.arrayBuffer());
    const w = parseWav(b); if (w) return w;
    const sr = probeRate(b) || 48000;
    const ctx = new OfflineAudioContext(1, 1, Math.min(384000, Math.max(8000, sr)));
    let ab;
    try { ab = await ctx.decodeAudioData(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)); }
    catch (e) { throw new Error(what === 'video' ? 'No audio track found, or its codec isn’t supported' : 'Could not decode this audio (damaged file or unsupported codec)'); }
    const chs = []; for (let c = 0; c < ab.numberOfChannels; c++) chs.push(ab.getChannelData(c));
    return { sr: ab.sampleRate, chs, desc: (extOf(file.name) || 'audio').toUpperCase() };
  }
  async function encodeAudio(chs, sr, o, onProgress) {
    if (o.to === 'mp3') { const r = await encodeMp3(chs, sr, +o.kbps, onProgress); return { bytes: r.bytes, ext: 'mp3', mime: 'audio/mpeg', desc: `MP3 ${o.kbps} kbps · ${r.rate / 1000} kHz` }; }
    if (o.to === 'flac') { const bits = o.bits === 'pcm24' || o.bits === 'float32' ? 24 : 16; return { bytes: await encodeFlac(chs, sr, bits, onProgress), ext: 'flac', mime: 'audio/flac', desc: `FLAC ${bits}-bit · ${sr / 1000} kHz` }; }
    const bits = o.bits || 'pcm16'; return { bytes: encodeWav(chs, sr, bits), ext: 'wav', mime: 'audio/wav', desc: `WAV ${bits === 'float32' ? '32-bit float' : bits.slice(3) + '-bit'} · ${sr / 1000} kHz` };
  }
  function prepare(a, o) {
    let { chs, sr } = a;
    if (o.ch && o.ch !== 'keep') chs = mixTo(chs, +o.ch);
    if (o.rate && o.rate !== 'keep' && +o.rate !== sr) { chs = chs.map(c => resample(c, +o.rate / sr)); sr = +o.rate; }
    return { chs, sr };
  }
  const audioOutOpts = [
    { key: 'to', label: 'Convert to', type: 'select', value: 'mp3', options: [['mp3', 'MP3'], ['wav', 'WAV'], ['flac', 'FLAC (lossless)']] },
    { key: 'kbps', label: 'Bitrate', type: 'select', value: '192', options: [['96', '96 kbps'], ['128', '128 kbps'], ['160', '160 kbps'], ['192', '192 kbps'], ['256', '256 kbps'], ['320', '320 kbps']], show: o => o.to === 'mp3' },
    { key: 'bits', label: 'Bit depth', type: 'select', value: 'pcm16', options: [['pcm16', '16-bit'], ['pcm24', '24-bit'], ['float32', '32-bit float (WAV only)']], show: o => o.to !== 'mp3' }];

  /* 12 ─ Audio converter */
  register({
    id: 'audio-converter', cat: 'av', glyph: 'audio', name: 'Audio converter', keywords: 'audio mp3 wav flac ogg m4a aac opus convert sound music',
    desc: 'WAV, MP3, OGG, FLAC or M4A to MP3, WAV or FLAC.',
    accept: 'audio/*,.flac,.m4a,.opus,.ogg', acceptText: 'WAV, MP3, OGG, Opus, FLAC, M4A/AAC', acceptTest: isAudio, multiple: true, zipName: 'converted-audio',
    options: [...audioOutOpts,
      { key: 'rate', label: 'Sample rate', type: 'select', value: 'keep', options: [['keep', 'Keep original'], ['22050', '22.05 kHz'], ['32000', '32 kHz'], ['44100', '44.1 kHz'], ['48000', '48 kHz'], ['96000', '96 kHz']] },
      { key: 'ch', label: 'Channels', type: 'select', value: 'keep', options: [['keep', 'Keep original'], ['1', 'Mono'], ['2', 'Stereo']] }],
    note: 'MP3 encoding uses lamejs (LGPL); tags and cover art are not copied.',
    async each(f, o, ctx) {
      ctx.progress(0.05, 'Decoding ' + f.name);
      const a = await decodeAudio(f); ctx.check();
      ctx.progress(0.25, 'Processing'); const p = prepare(a, o);
      const r = await encodeAudio(p.chs, p.sr, o, x => { ctx.check(); ctx.progress(0.3 + 0.7 * x, 'Encoding ' + r_name()); });
      function r_name() { return o.to.toUpperCase(); }
      return { name: `${baseName(f.name)}.${r.ext}`, blob: new Blob([r.bytes], { type: r.mime }), audio: true, info: `${fmtT(a.chs[0].length / a.sr)} · ${a.desc} → ${r.desc}${p.chs.length === 1 ? ' mono' : ''}` };
    }
  });
  for (const [a, b] of [['wav', 'mp3'], ['mp3', 'wav'], ['flac', 'mp3'], ['ogg', 'mp3'], ['m4a', 'mp3'], ['wav', 'flac'], ['flac', 'wav']]) alias(`${a}-to-${b}`, 'audio-converter', { to: b });

  /* 13 ─ Extract audio from video */
  register({
    id: 'extract-audio', cat: 'av', glyph: 'extract', name: 'Extract audio from video', keywords: 'video to mp3 wav extract audio sound track rip mp4 webm mov',
    desc: 'Pull the soundtrack out of MP4, WebM or MOV as MP3 or WAV.',
    accept: 'video/*,.mkv,.mov', acceptText: 'MP4, WebM, MOV, MKV (AAC, Opus, Vorbis or MP3 audio)', acceptTest: f => isVideo(f) || isAudio(f), multiple: true, zipName: 'extracted-audio',
    options: [
      { key: 'to', label: 'Save as', type: 'select', value: 'mp3', options: [['mp3', 'MP3'], ['wav', 'WAV'], ['flac', 'FLAC']] },
      { key: 'kbps', label: 'Bitrate', type: 'select', value: '192', options: [['128', '128 kbps'], ['192', '192 kbps'], ['256', '256 kbps'], ['320', '320 kbps']], show: o => o.to === 'mp3' }],
    async each(f, o, ctx) {
      ctx.progress(0.05, 'Reading audio from ' + f.name);
      const a = await decodeAudio(f, 'video'); ctx.check();
      const r = await encodeAudio(a.chs, a.sr, { ...o, bits: 'pcm16' }, x => { ctx.check(); ctx.progress(0.3 + 0.7 * x, 'Encoding'); });
      return { name: `${baseName(f.name)}.${r.ext}`, blob: new Blob([r.bytes], { type: r.mime }), audio: true, info: `${fmtT(a.chs[0].length / a.sr)} · ${a.chs.length} ch · ${r.desc}` };
    }
  });
  alias('mp4-to-mp3', 'extract-audio', { to: 'mp3' }); alias('video-to-mp3', 'extract-audio', { to: 'mp3' });

  /* ---------------- video helpers (frame-exact seeking through <video>) ---------------- */
  async function openVideo(f) {
    const url = URL.createObjectURL(f), v = document.createElement('video');
    v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = url;
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('This video can’t be decoded here (unsupported codec or damaged file)')); setTimeout(() => rej(new Error('Timed out opening the video')), 30000); });
    if (!v.videoWidth) { URL.revokeObjectURL(url); throw new Error('No video track found'); }
    if (!isFinite(v.duration)) { await seek(v, 1e7); }
    const dur = isFinite(v.duration) ? v.duration : v.currentTime;
    return { v, dur, w: v.videoWidth, h: v.videoHeight, close() { v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); } };
  }
  function seek(v, t) {
    return new Promise(res => {
      let done = false; const fin = () => { if (!done) { done = true; res(); } };
      v.addEventListener('seeked', () => { if (v.requestVideoFrameCallback) { v.requestVideoFrameCallback(fin); setTimeout(fin, 120); } else fin(); }, { once: true });
      v.currentTime = t; setTimeout(fin, 4000);
    });
  }
  const even = n => Math.max(2, Math.round(n / 2) * 2);
  function avcCodec(w, h, fps) { const fs = Math.ceil(w / 16) * Math.ceil(h / 16), mbps = fs * fps; const L = [[31, 3600, 108000], [40, 8192, 245760], [42, 8704, 522240], [50, 22080, 589824], [51, 36864, 983040], [52, 36864, 2073600]].find(([, f, r]) => fs <= f && mbps <= r) || [52]; return 'avc1.6400' + L[0].toString(16).padStart(2, '0'); }
  const supV = async c => { try { return (await VideoEncoder.isConfigSupported(c)).supported; } catch (e) { return false; } };
  const supA = async c => { try { return (await AudioEncoder.isConfigSupported(c)).supported; } catch (e) { return false; } };
  async function pickCodecs(fmt, W, H, fps, bitrate, wantAudio, abr) {
    if (!window.VideoEncoder) throw new Error('This browser has no WebCodecs video encoder (use a recent Chrome, Edge or Lumen Studio)');
    const base = { width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality' }, aBase = { sampleRate: 48000, numberOfChannels: 2, bitrate: abr };
    if (fmt === 'mp4') for (const codec of [avcCodec(W, H, fps), 'avc1.640033', 'avc1.4d0033', 'avc1.42003e']) {
      const v = { ...base, codec, avc: { format: 'avc' } };
      if (await supV(v)) { let a = null; if (wantAudio) { if (await supA({ ...aBase, codec: 'mp4a.40.2' })) a = { cfg: { ...aBase, codec: 'mp4a.40.2' }, mux: 'aac' }; else if (await supA({ ...aBase, codec: 'opus' })) a = { cfg: { ...aBase, codec: 'opus' }, mux: 'opus' }; } return { fmt: 'mp4', v, vmux: 'avc', a, label: 'H.264' + (a ? (a.mux === 'aac' ? ' + AAC' : ' + Opus') : '') }; }
    }
    for (const [codec, vmux, label] of [['vp09.00.41.08', 'V_VP9', 'VP9'], ['vp8', 'V_VP8', 'VP8']]) {
      const v = { ...base, codec };
      if (await supV(v)) { const a = wantAudio && await supA({ ...aBase, codec: 'opus' }) ? { cfg: { ...aBase, codec: 'opus' }, mux: 'A_OPUS' } : null; return { fmt: 'webm', v, vmux, a, fellBack: fmt === 'mp4', label: label + (a ? ' + Opus' : '') }; }
    }
    throw new Error('No supported video encoder (H.264 / VP9 / VP8) is available');
  }
  async function encodeAudioTrack(chs, sr, cfg, ctx) {
    let data = mixTo(chs, 2); if (sr !== 48000) data = data.map(c => resample(c, 48000 / sr));
    const chunks = []; let err = null;
    const enc = new AudioEncoder({ output: (c, m) => chunks.push([c, m]), error: e => err = e }); enc.configure(cfg);
    const n = data[0].length, step = 4800;
    for (let i = 0; i < n; i += step) {
      const m = Math.min(step, n - i), buf = new Float32Array(m * 2); buf.set(data[0].subarray(i, i + m), 0); buf.set(data[1].subarray(i, i + m), m);
      const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: m, numberOfChannels: 2, timestamp: Math.round(i / 48000 * 1e6), data: buf }); enc.encode(ad); ad.close();
      if (i % (step * 100) === 0) { ctx.check(); await U.tick(); }
    }
    await enc.flush(); enc.close(); if (err) throw err;
    return chunks;
  }
  // frames: async generator of {draw(g), t(seconds), dur(seconds)}; returns muxed bytes
  async function encodeVideo({ fmt, W, H, fps, bitrate, audio, abr = 128000, frames, count, ctx, label = 'Encoding' }) {
    const codecs = await pickCodecs(fmt, W, H, fps, bitrate, !!audio, abr);
    let aChunks = [];
    if (codecs.a && audio) { ctx.progress(0.02, 'Encoding audio'); aChunks = await encodeAudioTrack(audio.chs, audio.sr, codecs.a.cfg, ctx); }
    const can = U.canvas(W, H), g = can.getContext('2d', { alpha: false }); g.imageSmoothingQuality = 'high';
    const vChunks = []; let vErr = null;
    const venc = new VideoEncoder({ output: (c, m) => vChunks.push([c, m]), error: e => vErr = e }); venc.configure(codecs.v);
    const gop = Math.max(1, Math.round(fps * 2)); let i = 0;
    try {
      for await (const fr of frames) {
        ctx.check(); if (vErr) throw vErr;
        await fr.draw(g, W, H);
        const vf = new VideoFrame(can, { timestamp: Math.round(fr.t * 1e6), duration: Math.round(fr.dur * 1e6) });
        venc.encode(vf, { keyFrame: i % gop === 0 }); vf.close(); i++;
        while (venc.encodeQueueSize > 4) await new Promise(r => venc.addEventListener('dequeue', r, { once: true }));
        if (i % 3 === 0) { ctx.progress(0.05 + 0.9 * Math.min(1, i / count), `${label}: frame ${i} of ${count}`); await U.tick(); }
      }
      ctx.progress(0.96, 'Finishing'); await venc.flush(); if (vErr) throw vErr;
    } finally { if (venc.state !== 'closed') venc.close(); }
    if (!vChunks.length) throw new Error('No frames were encoded');
    let muxer, target;
    if (codecs.fmt === 'mp4') { const M = await U.lib.mp4(); target = new M.ArrayBufferTarget(); muxer = new M.Muxer({ target, fastStart: 'in-memory', firstTimestampBehavior: 'offset', video: { codec: 'avc', width: W, height: H, frameRate: fps }, audio: codecs.a && aChunks.length ? { codec: codecs.a.mux, numberOfChannels: 2, sampleRate: 48000 } : undefined }); }
    else { const M = await U.lib.webm(); target = new M.ArrayBufferTarget(); muxer = new M.Muxer({ target, firstTimestampBehavior: 'offset', video: { codec: codecs.vmux, width: W, height: H, frameRate: fps }, audio: codecs.a && aChunks.length ? { codec: 'A_OPUS', numberOfChannels: 2, sampleRate: 48000 } : undefined }); }
    let ai = 0;
    for (const [ch, meta] of vChunks) { while (ai < aChunks.length && aChunks[ai][0].timestamp <= ch.timestamp) { muxer.addAudioChunk(aChunks[ai][0], aChunks[ai][1]); ai++; } muxer.addVideoChunk(ch, meta); }
    while (ai < aChunks.length) { muxer.addAudioChunk(aChunks[ai][0], aChunks[ai][1]); ai++; }
    muxer.finalize();
    return { bytes: new Uint8Array(target.buffer), codecs, frames: i, hasAudio: !!(codecs.a && aChunks.length) };
  }
  const QBPP = { high: 0.2, medium: 0.11, low: 0.06 };
  function outSize(w, h, o) {
    let W = w, H = h; const m = +o.res || 0;
    if (m && H > m) { W = w * m / h; H = m; }
    if (W * H > 3840 * 2160) { const s = Math.sqrt(3840 * 2160 / (W * H)); W *= s; H *= s; }
    return [even(W), even(H)];
  }
  // Re-encode a <video>-decodable file: shared by Video converter and Trim & compress.
  async function transcode(f, o, ctx) {
    ctx.progress(0, 'Opening ' + f.name);
    const vid = await openVideo(f);
    try {
      const t0 = Math.max(0, +o.start || 0), t1 = Math.min(vid.dur, +o.end > 0 ? +o.end : vid.dur);
      if (!(t1 - t0 > 0.05)) throw new Error(`Nothing to export: the video is ${fmtT(vid.dur)} long`);
      const fps = +o.fps || 30, [W, H] = outSize(vid.w, vid.h, o), count = Math.max(1, Math.round((t1 - t0) * fps)), dur = count / fps;
      let audio = null, note = '';
      if (o.audio !== false && o.audio !== 'none') {
        try { const a = await decodeAudio(f, 'video'); const s0 = Math.round(t0 * a.sr), s1 = Math.min(a.chs[0].length, Math.round(t1 * a.sr)); audio = { sr: a.sr, chs: a.chs.map(c => c.subarray(s0, s1)) }; }
        catch (e) { note = ' · no audio track'; }
      }
      const abr = (+o.abr || 128) * 1000;
      let bitrate;
      if (o.size > 0) { bitrate = (o.size * 8 * 1048576 * 0.97) / dur - (audio ? abr : 0); if (bitrate < 100000) throw new Error(`${o.size} MB is too small for ${fmtT(dur)} of video. Try a bigger size or a shorter clip.`); }
      else bitrate = W * H * fps * (QBPP[o.quality] || QBPP.medium);
      bitrate = Math.round(Math.min(60e6, Math.max(150000, bitrate)));
      const frames = (async function* () {
        for (let i = 0; i < count; i++) {
          const t = Math.min(t1 - 0.001, t0 + i / fps);
          await seek(vid.v, t);
          yield { t: i / fps, dur: 1 / fps, draw: g => g.drawImage(vid.v, 0, 0, W, H) };
        }
      })();
      const r = await encodeVideo({ fmt: o.fmt, W, H, fps, bitrate, audio, abr, frames, count, ctx, label: 'Encoding video' });
      const ext = r.codecs.fmt;
      return { name: `${baseName(f.name)}${o.suffix || ''}.${ext}`, blob: new Blob([r.bytes], { type: 'video/' + ext }), video: true,
        info: `${vid.w}×${vid.h} → ${W}×${H} · ${fps} fps · ${fmtT(dur)} · ${r.codecs.label}${r.codecs.fellBack ? ' (H.264 unavailable, saved as WebM)' : ''}${note}` };
    } finally { vid.close(); }
  }

  /* 14 ─ Video → GIF */
  register({
    id: 'video-to-gif', cat: 'av', glyph: 'gif', name: 'Video → GIF', keywords: 'video mp4 webm mov to gif animated animation clip',
    desc: 'Turn a clip into an animated GIF. Pick start, end, frame rate and width.',
    accept: 'video/*,.mkv,.mov', acceptText: 'MP4, WebM, MOV', acceptTest: isVideo, multiple: false,
    options: [
      { key: 'start', label: 'Start', type: 'number', min: 0, step: 0.1, value: 0, unit: 'seconds' },
      { key: 'end', label: 'End', type: 'number', min: 0, step: 0.1, value: 0, unit: 's (0 = up to 15 s)' },
      { key: 'fps', label: 'Frame rate', type: 'select', value: '12', options: [['5', '5 fps'], ['8', '8 fps'], ['10', '10 fps'], ['12', '12 fps'], ['15', '15 fps'], ['20', '20 fps'], ['25', '25 fps']] },
      { key: 'width', label: 'Width', type: 'number', min: 32, max: 1280, step: 1, value: 480, unit: 'px' },
      { key: 'colors', label: 'Colours', type: 'select', value: '256', options: [['256', '256 (best)'], ['128', '128'], ['64', '64 (smaller)'], ['32', '32']] },
      { key: 'loop', label: 'Loop', type: 'checkbox', text: 'Loop forever', value: true }],
    note: 'Long or wide GIFs get big fast: 5–10 seconds at 480 px is a good size.',
    async each(f, o, ctx) {
      const { GIFEncoder, quantize, applyPalette } = await U.lib.gifenc();
      ctx.progress(0, 'Opening ' + f.name);
      const vid = await openVideo(f);
      try {
        const t0 = Math.max(0, +o.start || 0), t1 = Math.min(vid.dur, +o.end > 0 ? +o.end : t0 + 15);
        if (!(t1 - t0 > 0.05)) throw new Error(`Start is past the end of the video (${fmtT(vid.dur)})`);
        const fps = +o.fps, W = Math.max(2, Math.min(Math.round(o.width), vid.w * 2)), H = Math.max(2, Math.round(vid.h * W / vid.w));
        const count = Math.max(1, Math.round((t1 - t0) * fps)); if (count > 900) throw new Error('That’s more than 900 frames. Use a shorter range or a lower frame rate.');
        const c = U.canvas(W, H), g = c.getContext('2d', { willReadFrequently: true }); g.imageSmoothingQuality = 'high';
        const gif = GIFEncoder(), delay = Math.round(1000 / fps);
        for (let i = 0; i < count; i++) {
          ctx.check(); ctx.progress(i / count, `Frame ${i + 1} of ${count}`);
          await seek(vid.v, Math.min(t1 - 0.001, t0 + i / fps));
          g.drawImage(vid.v, 0, 0, W, H);
          const rgba = g.getImageData(0, 0, W, H).data;
          const pal = quantize(rgba, +o.colors, { format: 'rgb565' });
          gif.writeFrame(applyPalette(rgba, pal, 'rgb565'), W, H, { palette: pal, delay, repeat: o.loop ? 0 : -1 });
          if (i % 4 === 0) await U.tick();
        }
        gif.finish();
        const bytes = gif.bytes();
        return { name: baseName(f.name) + '.gif', blob: new Blob([bytes], { type: 'image/gif' }), thumb: true, preview: true, info: `${W}×${H} · ${count} frames · ${fps} fps · ${fmtT(t1 - t0)}` };
      } finally { vid.close(); }
    }
  });
  alias('mp4-to-gif', 'video-to-gif');

  /* 15 ─ Video format converter */
  register({
    id: 'video-converter', cat: 'av', glyph: 'video', name: 'Video converter', keywords: 'video convert mp4 webm mov mkv h264 vp9 format',
    desc: 'MOV, WebM, MKV or MP4 to MP4 (H.264) or WebM (VP9), with sound.',
    accept: 'video/*,.mkv,.mov', acceptText: 'MP4, WebM, MOV, MKV, OGV (anything this browser can play)', acceptTest: isVideo, multiple: true, zipName: 'converted-video',
    options: [
      { key: 'fmt', label: 'Convert to', type: 'select', value: 'mp4', options: [['mp4', 'MP4 (H.264 + AAC)'], ['webm', 'WebM (VP9 + Opus)']] },
      { key: 'res', label: 'Resolution', type: 'select', value: '0', options: [['0', 'Keep original'], ['2160', 'Max 2160p (4K)'], ['1080', 'Max 1080p'], ['720', 'Max 720p'], ['480', 'Max 480p'], ['360', 'Max 360p']] },
      { key: 'fps', label: 'Frame rate', type: 'select', value: '30', options: [['24', '24 fps'], ['25', '25 fps'], ['30', '30 fps'], ['50', '50 fps'], ['60', '60 fps']] },
      { key: 'quality', label: 'Quality', type: 'select', value: 'high', options: [['high', 'High'], ['medium', 'Medium'], ['low', 'Low (small file)']] },
      { key: 'audio', label: 'Audio', type: 'checkbox', text: 'Keep the sound', value: true }],
    note: 'Frames are decoded one by one for exact results, so conversion runs at roughly real-time speed or slower.',
    each: (f, o, ctx) => transcode(f, o, ctx)
  });
  alias('mov-to-mp4', 'video-converter', { fmt: 'mp4' }); alias('webm-to-mp4', 'video-converter', { fmt: 'mp4' }); alias('mp4-to-webm', 'video-converter', { fmt: 'webm' });

  /* Video trim & compress */
  register({
    id: 'video-compress', cat: 'av', glyph: 'cut', name: 'Trim & compress video', keywords: 'video trim cut shorten compress reduce size smaller mb email discord',
    desc: 'Cut a clip out and shrink it to a target size, resolution or quality.',
    accept: 'video/*,.mkv,.mov', acceptText: 'MP4, WebM, MOV, MKV', acceptTest: isVideo, multiple: false,
    options: [
      { key: 'start', label: 'Start', type: 'number', min: 0, step: 0.1, value: 0, unit: 'seconds' },
      { key: 'end', label: 'End', type: 'number', min: 0, step: 0.1, value: 0, unit: 's (0 = end)' },
      { key: 'by', label: 'Compress by', type: 'select', value: 'size', options: [['size', 'Target file size'], ['quality', 'Quality']] },
      { key: 'size', label: 'Target size', type: 'number', min: 1, max: 4000, step: 1, value: 8, unit: 'MB', show: o => o.by === 'size' },
      { key: 'quality', label: 'Quality', type: 'select', value: 'medium', options: [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']], show: o => o.by === 'quality' },
      { key: 'res', label: 'Resolution', type: 'select', value: '720', options: [['0', 'Keep original'], ['1080', 'Max 1080p'], ['720', 'Max 720p'], ['480', 'Max 480p'], ['360', 'Max 360p']] },
      { key: 'fps', label: 'Frame rate', type: 'select', value: '30', options: [['15', '15 fps'], ['24', '24 fps'], ['30', '30 fps'], ['60', '60 fps']] },
      { key: 'fmt', label: 'Format', type: 'select', value: 'mp4', options: [['mp4', 'MP4 (H.264)'], ['webm', 'WebM (VP9)']] },
      { key: 'abr', label: 'Audio', type: 'select', value: '96', options: [['none', 'Remove audio'], ['64', '64 kbps'], ['96', '96 kbps'], ['128', '128 kbps']] }],
    showSaving: true,
    async each(f, o, ctx) {
      const r = await transcode(f, { ...o, size: o.by === 'size' ? o.size : 0, audio: o.abr !== 'none', abr: o.abr === 'none' ? 0 : +o.abr, suffix: '-small' }, ctx);
      r.info = `${fmtSize(f.size)} → ${fmtSize(r.blob.size)} · ` + r.info; return r;
    }
  });

  /* GIF → MP4 / WebM (WebCodecs ImageDecoder gives fully composited frames) */
  register({
    id: 'gif-to-video', cat: 'av', glyph: 'video', name: 'GIF → MP4 / WebM', keywords: 'gif to mp4 webm video animated convert smaller',
    desc: 'Animated GIFs to much smaller MP4 or WebM videos.',
    accept: '.gif,image/gif', acceptText: 'Animated GIF files', acceptTest: f => f.type === 'image/gif' || extOf(f.name) === 'gif', multiple: true, zipName: 'gif-videos', showSaving: true,
    options: [
      { key: 'fmt', label: 'Convert to', type: 'select', value: 'mp4', options: [['mp4', 'MP4 (H.264)'], ['webm', 'WebM (VP9)']] },
      { key: 'loops', label: 'Repeat', type: 'select', value: '1', options: [['1', 'Play once'], ['2', '2 times'], ['3', '3 times'], ['5', '5 times'], ['10', '10 times']] },
      { key: 'bg', label: 'Background', type: 'color', value: '#ffffff', hint: 'Videos have no transparency; transparent pixels get this colour.' },
      { key: 'quality', label: 'Quality', type: 'select', value: 'high', options: [['high', 'High'], ['medium', 'Medium'], ['low', 'Low']] }],
    async each(f, o, ctx) {
      if (!window.ImageDecoder) throw new Error('This browser can’t decode GIF frames (needs WebCodecs ImageDecoder)');
      const dec = new ImageDecoder({ data: new Uint8Array(await f.arrayBuffer()), type: 'image/gif' });
      try {
        await dec.tracks.ready; await dec.completed;
        const n = dec.tracks.selectedTrack.frameCount; if (!n) throw new Error('No frames in this GIF');
        const first = (await dec.decode({ frameIndex: 0 })).image, w0 = first.displayWidth, h0 = first.displayHeight; first.close();
        U.checkDims(w0, h0);
        let W = even(w0), H = even(h0); if (W * H > 1920 * 1080) { const s = Math.sqrt(1920 * 1080 / (W * H)); W = even(W * s); H = even(H * s); }
        // frame timing (browsers treat delays under 20 ms as 100 ms)
        const durs = []; let total = 0;
        for (let i = 0; i < n; i++) { const { image } = await dec.decode({ frameIndex: i }); let d = (image.duration || 100000) / 1e6; if (d < 0.02) d = 0.1; durs.push(d); total += d; image.close(); }
        const loops = +o.loops, avg = total / n, fps = Math.max(1, Math.min(60, Math.round(1 / avg)));
        const frames = (async function* () {
          let t = 0;
          for (let L = 0; L < loops; L++) for (let i = 0; i < n; i++) {
            const { image } = await dec.decode({ frameIndex: i });
            yield { t, dur: durs[i], draw: g => { g.fillStyle = o.bg; g.fillRect(0, 0, W, H); g.drawImage(image, 0, 0, W, H); image.close(); } };
            t += durs[i];
          }
        })();
        const r = await encodeVideo({ fmt: o.fmt, W, H, fps, bitrate: Math.round(Math.max(300000, W * H * fps * QBPP[o.quality])), frames, count: n * loops, ctx, label: 'Encoding' });
        return { name: baseName(f.name) + '.' + r.codecs.fmt, blob: new Blob([r.bytes], { type: 'video/' + r.codecs.fmt }), video: true, info: `${fmtSize(f.size)} → ${fmtSize(r.bytes.length)} · ${W}×${H} · ${n} frames${loops > 1 ? ' × ' + loops : ''} · ${fmtT(total * loops)} · ${r.codecs.label}` };
      } finally { dec.close(); }
    }
  });
  alias('gif-to-mp4', 'gif-to-video', { fmt: 'mp4' });

  /* Audio speed & pitch */
  register({
    id: 'audio-speed', cat: 'av', glyph: 'speed', name: 'Change audio speed & pitch', keywords: 'audio speed tempo pitch slow down speed up nightcore transpose semitones mp3 wav flac',
    desc: 'Speed up or slow down without changing pitch, or shift pitch by semitones.',
    accept: 'audio/*,.flac,.m4a,.opus,.ogg', acceptText: 'WAV, MP3, OGG, FLAC, M4A', acceptTest: isAudio, multiple: true, zipName: 'speed-audio',
    options: [
      { key: 'speed', label: 'Speed', type: 'range', min: 0.25, max: 3, step: 0.05, value: 1.25, fmt: v => v.toFixed(2) + '×' },
      { key: 'semis', label: 'Pitch', type: 'range', min: -12, max: 12, step: 0.5, value: 0, fmt: v => (v > 0 ? '+' : '') + v + ' st' },
      { key: 'mode', label: 'Method', type: 'select', value: 'keep', options: [['keep', 'Keep pitch when changing speed'], ['tape', 'Tape style (speed changes pitch)']] },
      ...audioOutOpts],
    async each(f, o, ctx) {
      ctx.progress(0.05, 'Decoding ' + f.name);
      const a = await decodeAudio(f); const len = a.chs[0].length;
      if (len / a.sr > 3600) throw new Error('Audio longer than one hour isn’t supported here');
      ctx.progress(0.2, 'Stretching'); await U.tick();
      let chs;
      const r = Math.pow(2, o.semis / 12);
      if (o.mode === 'tape') { const total = o.speed * r; chs = a.chs.map(c => resample(c, 1 / total)); }
      else {
        const factor = 1 / o.speed, sf = factor * r, outLen = Math.max(1, Math.round(len * factor));
        let st = Math.abs(sf - 1) < 1e-6 ? a.chs.map(c => c.slice()) : wsola(a.chs, a.sr, sf);
        if (Math.abs(r - 1) > 1e-6) st = st.map(c => resample(c, 1 / r, outLen));
        chs = st.map(c => { if (c.length === outLen) return c; const x = new Float32Array(outLen); x.set(c.subarray(0, outLen)); return x; });
      }
      ctx.check();
      const out = await encodeAudio(chs, a.sr, o, x => ctx.progress(0.6 + 0.4 * x, 'Encoding'));
      return { name: `${baseName(f.name)}-${o.speed}x${o.semis ? (o.semis > 0 ? '+' : '') + o.semis + 'st' : ''}.${out.ext}`, blob: new Blob([out.bytes], { type: out.mime }), audio: true, info: `${fmtT(len / a.sr)} → ${fmtT(chs[0].length / a.sr)} · ${out.desc}` };
    }
  });

  LC.mediaInternals = { parseWav, encodeWav, encodeFlac, encodeMp3, decodeAudio, resample, wsola, openVideo };
})();
