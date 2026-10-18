'use strict';
/* Lumen Beats — WAV reader/writer (pure JS) and MP3 export through lamejs (separate unmodified LGPL file). */
(function (root) {
  // channels: Float32Array[]; bits: 16 | 24 | 32 (float). Applies TPDF dither for 16-bit.
  function encode(chs, sr, bits = 16, dither = true) {
    const nc = chs.length, n = chs[0].length, bps = bits / 8, float = bits === 32;
    const dataLen = n * nc * bps, buf = new ArrayBuffer(44 + dataLen), v = new DataView(buf);
    const w4 = (o, s) => { for (let i = 0; i < 4; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w4(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); w4(8, 'WAVE'); w4(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, float ? 3 : 1, true); v.setUint16(22, nc, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * nc * bps, true); v.setUint16(32, nc * bps, true); v.setUint16(34, bits, true); w4(36, 'data'); v.setUint32(40, dataLen, true);
    let o = 44, seed = 22222;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
      let x = chs[c][i]; if (!(x === x)) x = 0;
      if (float) { v.setFloat32(o, x, true); o += 4; continue; }
      x = x < -1 ? -1 : x > 1 ? 1 : x;
      if (bits === 16) { let s = x * 32767 + (dither ? rnd() - rnd() : 0); s = Math.round(s); v.setInt16(o, s < -32768 ? -32768 : s > 32767 ? 32767 : s, true); o += 2; }
      else { const s = Math.round(x * 8388607); v.setUint8(o, s & 255); v.setUint8(o + 1, (s >> 8) & 255); v.setUint8(o + 2, (s >> 16) & 255); o += 3; }
    }
    return new Uint8Array(buf);
  }
  // → {sr, channels: Float32Array[]} ; throws on unsupported data
  function parse(buf) {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf), v = new DataView(u.buffer, u.byteOffset, u.byteLength);
    const s4 = o => String.fromCharCode(u[o], u[o + 1], u[o + 2], u[o + 3]);
    if (u.length < 12 || (s4(0) !== 'RIFF' && s4(0) !== 'RF64') || s4(8) !== 'WAVE') throw new Error('Not a WAV file');
    let o = 12, fmt = null, data = null;
    while (o + 8 <= u.length) {
      const id = s4(o); let len = v.getUint32(o + 4, true); const body = o + 8;
      if (id === 'fmt ') fmt = { tag: v.getUint16(body, true), nc: v.getUint16(body + 2, true), sr: v.getUint32(body + 4, true), bits: v.getUint16(body + 14, true), sub: len >= 40 ? v.getUint16(body + 24, true) : 0 };
      else if (id === 'data') { if (len === 0xffffffff || body + len > u.length) len = u.length - body; data = { o: body, len }; break; }
      o = body + len + (len & 1);
    }
    if (!fmt || !data) throw new Error('WAV file without fmt/data chunk');
    let tag = fmt.tag === 0xfffe ? fmt.sub : fmt.tag; const { nc, bits } = fmt, bps = bits >> 3;
    if (!nc || nc > 32 || !fmt.sr || ![8, 16, 24, 32, 64].includes(bits) || (tag !== 1 && tag !== 3)) throw new Error('Unsupported WAV encoding');
    const n = Math.floor(data.len / (nc * bps)), chs = Array.from({ length: nc }, () => new Float32Array(n));
    let p = data.o;
    for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
      let x;
      if (tag === 3) x = bits === 64 ? v.getFloat64(p, true) : v.getFloat32(p, true);
      else if (bits === 8) x = (u[p] - 128) / 128;
      else if (bits === 16) x = v.getInt16(p, true) / 32768;
      else if (bits === 24) { let s = u[p] | (u[p + 1] << 8) | (u[p + 2] << 16); if (s & 0x800000) s |= ~0xffffff; x = s / 8388608; }
      else x = v.getInt32(p, true) / 2147483648;
      chs[c][i] = x; p += bps;
    }
    return { sr: fmt.sr, channels: chs };
  }
  // MP3 through lamejs (global, loaded from vendor/lamejs.js)
  function encodeMp3(chs, sr, kbps = 192) {
    const L = root.lamejs; if (!L) throw new Error('MP3 encoder (lamejs) not loaded');
    if (![32000, 44100, 48000].includes(sr)) throw new Error('MP3 needs 32, 44.1 or 48 kHz');
    const nc = Math.min(2, chs.length), enc = new L.Mp3Encoder(nc, sr, kbps), n = chs[0].length, out = [], block = 1152 * 8;
    const toI16 = (x, a, b) => { const r = new Int16Array(b - a); for (let i = a; i < b; i++) { const s = x[i] < -1 ? -1 : x[i] > 1 ? 1 : x[i]; r[i - a] = s < 0 ? s * 32768 : s * 32767; } return r; };
    for (let i = 0; i < n; i += block) {
      const e = Math.min(n, i + block);
      const m = nc === 2 ? enc.encodeBuffer(toI16(chs[0], i, e), toI16(chs[1], i, e)) : enc.encodeBuffer(toI16(chs[0], i, e));
      if (m.length) out.push(new Uint8Array(m.buffer ? m.buffer.slice(m.byteOffset, m.byteOffset + m.byteLength) : m));
    }
    const f = enc.flush(); if (f.length) out.push(new Uint8Array(f.buffer ? f.buffer.slice(f.byteOffset, f.byteOffset + f.byteLength) : f));
    const tot = out.reduce((a, b) => a + b.length, 0), r = new Uint8Array(tot); let k = 0; for (const b of out) { r.set(b, k); k += b.length; }
    return r;
  }
  const Wav = { encode, parse, encodeMp3 };
  root.Wav = Wav;
  if (typeof module !== 'undefined' && module.exports) module.exports = Wav;
})(typeof window !== 'undefined' ? window : globalThis);
