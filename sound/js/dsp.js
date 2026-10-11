'use strict';
/* Lumen Sound — DSP library. Pure functions working on Float32Array channels.
   FFT/STFT, biquads (RBJ), sinc resampler, WSOLA + phase-vocoder time stretch, pitch shift,
   dynamics (compressor / limiter / gate), modulation, distortion, delay, reverb IR generation,
   spectral noise reduction, LPC de-click, ITU-R BS.1770-4 loudness. */
window.DSP = (() => {
  const TAU = Math.PI * 2;
  const dbToLin = d => Math.pow(10, d / 20);
  const linToDb = v => 20 * Math.log10(Math.max(Math.abs(v), 1e-12));
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  /* ---------------- FFT (radix-2, in place, Float64Array) ---------------- */
  const tables = new Map();
  function tab(n) {
    let t = tables.get(n); if (t) return t;
    const rev = new Uint32Array(n), bits = Math.round(Math.log2(n));
    for (let i = 0; i < n; i++) { let r = 0, x = i; for (let b = 0; b < bits; b++) { r = (r << 1) | (x & 1); x >>= 1; } rev[i] = r; }
    const cos = new Float64Array(n >> 1), sin = new Float64Array(n >> 1);
    for (let i = 0; i < n >> 1; i++) { cos[i] = Math.cos(TAU * i / n); sin[i] = Math.sin(TAU * i / n); }
    t = { rev, cos, sin }; tables.set(n, t); return t;
  }
  function fft(re, im, inv = false) {
    const n = re.length, { rev, cos, sin } = tab(n);
    for (let i = 0; i < n; i++) { const j = rev[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    // size-2 stage without multiplications
    for (let i = 0; i < n; i += 2) { const ar = re[i], ai = im[i], br = re[i + 1], bi = im[i + 1]; re[i] = ar + br; im[i] = ai + bi; re[i + 1] = ar - br; im[i + 1] = ai - bi; }
    const sg = inv ? 1 : -1;
    for (let size = 4; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let j = 0; j < half; j++) {
        const k = j * step, wr = cos[k], wi = sg * sin[k];
        for (let a = j; a < n; a += size) {
          const b = a + half, xr = re[b], xi = im[b];
          const tr = xr * wr - xi * wi, ti = xr * wi + xi * wr;
          const ar = re[a], ai = im[a];
          re[b] = ar - tr; im[b] = ai - ti; re[a] = ar + tr; im[a] = ai + ti;
        }
      }
    }
    if (inv) { const s = 1 / n; for (let i = 0; i < n; i++) { re[i] *= s; im[i] *= s; } }
  }
  /* Real FFT of length N via an N/2 complex FFT. x: real input (length N). Writes bins 0..N/2 into Xr/Xi. */
  const rbufs = new Map();
  function rbuf(N) { let b = rbufs.get(N); if (!b) { const M = N >> 1, c = new Float64Array(M + 1), s = new Float64Array(M + 1); for (let k = 0; k <= M; k++) { c[k] = Math.cos(TAU * k / N); s[k] = Math.sin(TAU * k / N); } b = { zr: new Float64Array(M), zi: new Float64Array(M), c, s }; rbufs.set(N, b); } return b; }
  function rfft(x, Xr, Xi) {
    const N = x.length, M = N >> 1, { zr, zi, c, s } = rbuf(N);
    for (let n = 0; n < M; n++) { zr[n] = x[2 * n]; zi[n] = x[2 * n + 1]; }
    fft(zr, zi);
    for (let k = 0; k <= M; k++) {
      const a = k % M, b = (M - k) % M, ar = zr[a], ai = zi[a], br = zr[b], bi = zi[b];
      const er = (ar + br) * 0.5, ei = (ai - bi) * 0.5, or = (ai + bi) * 0.5, oi = -(ar - br) * 0.5;
      Xr[k] = er + c[k] * or + s[k] * oi; Xi[k] = ei + c[k] * oi - s[k] * or;
    }
  }
  /* Inverse of rfft: bins 0..N/2 → real output (length N), scaled 1/N. */
  function irfft(Xr, Xi, out) {
    const N = out.length, M = N >> 1, { zr, zi, c, s } = rbuf(N);
    for (let k = 0; k < M; k++) {
      const ar = Xr[k], ai = Xi[k], br = Xr[M - k], bi = -Xi[M - k];
      const er = (ar + br) * 0.5, ei = (ai + bi) * 0.5, dr = (ar - br) * 0.5, di = (ai - bi) * 0.5;
      // O = D * W^-k, W^-k = (c, +s)
      const or = dr * c[k] - di * s[k], oi = dr * s[k] + di * c[k];
      zr[k] = er - oi; zi[k] = ei + or;
    }
    fft(zr, zi, true);
    for (let n = 0; n < M; n++) { out[2 * n] = zr[n]; out[2 * n + 1] = zi[n]; }
  }
  const winCache = new Map();
  function hann(n) { let w = winCache.get(n); if (!w) { w = new Float64Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(TAU * i / n); winCache.set(n, w); } return w; }
  const pow2 = n => 1 << Math.ceil(Math.log2(Math.max(2, n)));

  /* STFT analysis/modify/resynthesis with weighted overlap-add (Hann analysis+synthesis, exact normalisation).
     fn(re, im, frameIndex) may modify bins 0..N/2; the mirror half is rebuilt automatically. */
  function stftMap(x, N, hop, fn) {
    const len = x.length, w = hann(N), out = new Float32Array(len), norm = new Float32Array(len);
    const fr = new Float64Array(N), re = new Float64Array(N / 2 + 1), im = new Float64Array(N / 2 + 1), H = N >> 1;
    let f = 0;
    for (let pos = -N + hop; pos < len; pos += hop, f++) {
      for (let i = 0; i < N; i++) { const k = pos + i; fr[i] = k >= 0 && k < len ? x[k] * w[i] : 0; }
      rfft(fr, re, im);
      fn(re, im, f);
      im[0] = 0; im[H] = 0;
      irfft(re, im, fr);
      const i0 = Math.max(0, -pos), i1 = Math.min(N, len - pos);
      for (let i = i0; i < i1; i++) { const k = pos + i; out[k] += fr[i] * w[i]; norm[k] += w[i] * w[i]; }
    }
    for (let i = 0; i < len; i++) out[i] = norm[i] > 1e-6 ? out[i] / norm[i] : 0;
    return out;
  }

  /* Averaged magnitude spectrum (Welch) of a mono signal → Float32Array of dBFS per bin (sine amplitude-calibrated). */
  function spectrum(x, N = 4096) {
    const w = hann(N), fr = new Float64Array(N), re = new Float64Array(N / 2 + 1), im = new Float64Array(N / 2 + 1), acc = new Float64Array(N / 2 + 1);
    let wsum = 0; for (let i = 0; i < N; i++) wsum += w[i];
    const hop = N >> 1; let frames = 0;
    const len = x.length;
    const last = Math.max(0, len - N);
    // limit to ~400 frames for speed
    const stride = Math.max(hop, Math.floor(last / 400) || hop);
    for (let pos = 0; pos <= last; pos += stride) {
      for (let i = 0; i < N; i++) { const k = pos + i; fr[i] = k < len ? x[k] * w[i] : 0; }
      rfft(fr, re, im);
      for (let k = 0; k <= N / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
      frames++;
    }
    const out = new Float32Array(N / 2 + 1);
    for (let k = 0; k <= N / 2; k++) out[k] = 10 * Math.log10(acc[k] / Math.max(1, frames) + 1e-24) + 20 * Math.log10(2 / wsum);
    return out;
  }

  /* ---------------- Biquads (RBJ Audio EQ Cookbook) ---------------- */
  function biquad(type, f, Q, gainDb, sr) {
    const A = Math.pow(10, (gainDb || 0) / 40), w0 = TAU * clamp(f, 1, sr * 0.499) / sr;
    const cw = Math.cos(w0), sw = Math.sin(w0), al = sw / (2 * Math.max(0.025, Q || 0.707));
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lowshelf': { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * cw + s); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s); a0 = (A + 1) + (A - 1) * cw + s; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s; break; }
      case 'highshelf': { const s = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * cw + s); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s); a0 = (A + 1) - (A - 1) * cw + s; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s; break; }
      case 'lowpass': b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'highpass': b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'bandpass': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      case 'notch': b0 = 1; b1 = -2 * cw; b2 = 1; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; break;
      default: /* peaking */ b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A;
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }
  // Run a cascade of biquads over x (transposed direct form II, float64 state).
  function biquadRun(x, coefs, out) {
    out = out || new Float32Array(x.length);
    if (out !== x) out.set(x);
    for (const c of coefs) {
      let z1 = 0, z2 = 0; const { b0, b1, b2, a1, a2 } = c;
      for (let i = 0; i < out.length; i++) { const v = out[i], y = b0 * v + z1; z1 = b1 * v - a1 * y + z2; z2 = b2 * v - a2 * y; out[i] = y; }
    }
    return out;
  }
  function biquadMag(c, f, sr) {
    const w = TAU * f / sr, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = c.b0 + c.b1 * c1 + c.b2 * c2, ni = -(c.b1 * s1 + c.b2 * s2);
    const dr = 1 + c.a1 * c1 + c.a2 * c2, di = -(c.a1 * s1 + c.a2 * s2);
    return Math.sqrt((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  // Parametric EQ band list → biquad cascade. band: {on,type,f,gain,q,slope(12/24/48 for pass filters)}
  function eqCoefs(bands, sr) {
    const out = [];
    for (const b of bands) {
      if (b.on === false) continue;
      if (b.type === 'lowpass' || b.type === 'highpass') { const n = Math.max(1, Math.round((b.slope || 12) / 12)); for (let i = 0; i < n; i++) out.push(biquad(b.type, b.f, n === 1 ? b.q : 0.7071, 0, sr)); }
      else out.push(biquad(b.type, b.f, b.q, b.gain, sr));
    }
    return out;
  }
  const eqResponseDb = (coefs, f, sr) => { let m = 1; for (const c of coefs) m *= biquadMag(c, f, sr); return linToDb(m); };
  const GEQ_FREQS = [31.25, 62.5, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const geqCoefs = (gains, sr) => GEQ_FREQS.map((f, i) => ({ f, g: gains[i] })).filter(b => Math.abs(b.g) > 0.01 && b.f < sr * 0.47).map(b => biquad('peaking', b.f, 1.41, b.g, sr));

  /* ---------------- Resampler (Kaiser-windowed sinc, table driven) ---------------- */
  const RS_W = 20, RS_OS = 512; let rsTable = null;
  function besselI0(x) { let s = 1, t = 1; for (let k = 1; k < 40; k++) { t *= (x / (2 * k)) ** 2; s += t; if (t < 1e-12 * s) break; } return s; }
  function rsInit() {
    const n = RS_W * RS_OS, beta = 9, i0b = besselI0(beta); rsTable = new Float32Array(n + 2);
    for (let i = 0; i <= n; i++) { const x = i / RS_OS, r = x / RS_W; const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x); rsTable[i] = sinc * besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b; }
  }
  // ratio = outRate / inRate. Optional outLen.
  function resample(x, ratio, outLen) {
    if (!rsTable) rsInit();
    const len = x.length; outLen = outLen || Math.max(1, Math.round(len * ratio));
    const out = new Float32Array(outLen);
    if (Math.abs(ratio - 1) < 1e-12 && outLen === len) { out.set(x); return out; }
    const fc = ratio < 1 ? ratio * 0.97 : 1, half = RS_W / fc, T = rsTable, sc = fc * RS_OS;
    for (let i = 0; i < outLen; i++) {
      const t = i / ratio, k0 = Math.max(0, Math.ceil(t - half)), k1 = Math.min(len - 1, Math.floor(t + half));
      let s = 0;
      for (let k = k0; k <= k1; k++) { const d = Math.abs(t - k) * sc, di = d | 0; const kv = T[di] + (T[di + 1] - T[di]) * (d - di); s += x[k] * kv; }
      out[i] = s * fc;
    }
    return out;
  }

  /* ---------------- Time stretch: WSOLA (all channels share offsets) ---------------- */
  function wsola(chs, sr, factor) {
    const len = chs[0].length, outLen = Math.max(1, Math.round(len * factor));
    let N = Math.round(sr * 0.046); N += N & 1; const Hs = N >> 1, Ha = Hs / factor, tol = Math.round(sr * 0.012);
    const w = hann(N);
    const m = new Float32Array(len); for (const c of chs) for (let i = 0; i < len; i++) m[i] += c[i] / chs.length;
    const outs = chs.map(() => new Float32Array(outLen + N + 1));
    const at = i => (i >= 0 && i < len ? m[i] : 0);
    let prev = 0;
    const score = (cand, tgt, step) => { let s = 0, e = 1e-9; for (let i = 0; i < Hs; i += step) { const a = at(cand + i); s += a * at(tgt + i); e += a * a; } return s / Math.sqrt(e); };
    for (let k = 0; k * Hs < outLen; k++) {
      const nominal = Math.round(k * Ha);
      let pos = nominal;
      if (k > 0) {
        const tgt = prev + Hs; let best = -Infinity, bd = 0;
        for (let d = -tol; d <= tol; d += 4) { const s = score(nominal + d, tgt, 4); if (s > best) { best = s; bd = d; } }
        let best2 = -Infinity, bd2 = bd;
        for (let d = bd - 4; d <= bd + 4; d++) { const s = score(nominal + d, tgt, 1); if (s > best2) { best2 = s; bd2 = d; } }
        pos = nominal + bd2;
      }
      const o = k * Hs;
      for (let c = 0; c < chs.length; c++) {
        const x = chs[c], y = outs[c];
        for (let i = 0; i < N; i++) { const idx = pos + i; if (idx >= 0 && idx < len) y[o + i] += x[idx] * w[i]; }
      }
      prev = pos;
    }
    // first half-frame only got one window half → compensate fade-in region
    return outs.map(y => { const r = y.subarray(0, outLen).slice(); for (let i = 0; i < Math.min(Hs, outLen); i++) r[i] /= Math.max(w[i], 0.05); return r; });
  }

  /* ---------------- Time stretch: phase vocoder with identity phase locking ---------------- */
  function pvoc(x, factor, sr) {
    const len = x.length, outLen = Math.max(1, Math.round(len * factor));
    const N = sr > 64000 ? 8192 : 4096, H = N >> 1, Hs = N >> 2, Ha = Hs / factor, w = hann(N);
    const out = new Float32Array(outLen + N), norm = new Float32Array(outLen + N);
    const fr = new Float64Array(N), re = new Float64Array(H + 1), im = new Float64Array(H + 1);
    const prevPh = new Float64Array(H + 1), synPh = new Float64Array(H + 1), mag = new Float64Array(H + 1), ph = new Float64Array(H + 1);
    const peakOf = new Int32Array(H + 1);
    let prevA = 0;
    for (let f = 0; ; f++) {
      const sPos = f * Hs - (N >> 1); if (sPos >= outLen) break;
      const aPos = Math.round(f * Ha) - (N >> 1);
      for (let i = 0; i < N; i++) { const k = aPos + i; fr[i] = k >= 0 && k < len ? x[k] * w[i] : 0; }
      rfft(fr, re, im);
      for (let k = 0; k <= H; k++) { mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]); ph[k] = Math.atan2(im[k], re[k]); }
      if (f === 0) { for (let k = 0; k <= H; k++) synPh[k] = ph[k]; }
      else {
        const ha = Math.max(1, aPos - prevA);
        // peaks
        const peaks = [];
        for (let k = 2; k < H - 1; k++) if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1] && mag[k] > mag[k - 2] && mag[k] >= mag[k + 2]) peaks.push(k);
        if (!peaks.length) peaks.push(1);
        // region of influence: nearest peak (boundary at the midpoint)
        let pi = 0;
        for (let k = 0; k <= H; k++) { while (pi < peaks.length - 1 && Math.abs(peaks[pi + 1] - k) < Math.abs(peaks[pi] - k)) pi++; peakOf[k] = peaks[pi]; }
        const newPh = synPh; // reuse
        const advance = new Float64Array(peaks.length);
        for (let j = 0; j < peaks.length; j++) {
          const k = peaks[j], omega = TAU * k / N;
          let d = ph[k] - prevPh[k] - omega * ha; d -= TAU * Math.round(d / TAU);
          advance[j] = synPh[k] + (omega + d / ha) * Hs;
        }
        const pk = new Map(); peaks.forEach((k, j) => pk.set(k, advance[j]));
        for (let k = 0; k <= H; k++) { const p = peakOf[k]; newPh[k] = pk.get(p) + ph[k] - ph[p]; }
      }
      for (let k = 0; k <= H; k++) { prevPh[k] = ph[k]; re[k] = mag[k] * Math.cos(synPh[k]); im[k] = mag[k] * Math.sin(synPh[k]); }
      im[0] = 0; im[H] = 0;
      irfft(re, im, fr);
      for (let i = 0; i < N; i++) { const k = sPos + i; if (k >= 0 && k < outLen) { out[k] += fr[i] * w[i]; norm[k] += w[i] * w[i]; } }
      prevA = aPos;
    }
    const r = new Float32Array(outLen); for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-3 ? out[i] / norm[i] : 0;
    return r;
  }
  // Stretch duration by `tempo factor` (output length = len*factor) and shift pitch by `semis`, independently.
  function stretchPitch(chs, sr, factor, semis, algo = 'wsola') {
    const r = Math.pow(2, (semis || 0) / 12), len = chs[0].length, outLen = Math.max(1, Math.round(len * factor));
    const sf = factor * r;
    let st = Math.abs(sf - 1) < 1e-6 ? chs.map(c => c.slice()) : algo === 'pvoc' ? chs.map(c => pvoc(c, sf, sr)) : wsola(chs, sr, sf);
    if (Math.abs(r - 1) > 1e-6) st = st.map(c => resample(c, 1 / r, outLen));
    return st.map(c => { if (c.length === outLen) return c; const o = new Float32Array(outLen); o.set(c.subarray(0, outLen)); return o; });
  }

  /* ---------------- Dynamics ---------------- */
  // linked peak level of all channels at i
  function linkedAbs(chs, i) { let m = 0; for (let c = 0; c < chs.length; c++) { const v = Math.abs(chs[c][i]); if (v > m) m = v; } return m; }
  function compress(chs, sr, p) {
    const T = p.threshold, R = Math.max(1, p.ratio), W = Math.max(0, p.knee || 0);
    const at = Math.exp(-1 / (sr * Math.max(0.01, p.attack) / 1000)), rt = Math.exp(-1 / (sr * Math.max(1, p.release) / 1000));
    const rmsC = Math.exp(-1 / (sr * 0.01));
    const gc = x => { const d = x - T; if (2 * d < -W) return x; if (W > 0 && 2 * Math.abs(d) <= W) return x + (1 / R - 1) * (d + W / 2) ** 2 / (2 * W); return T + d / R; };
    const makeup = p.autoMakeup ? -(gc(0) - 0) * 0.5 : (p.makeup || 0);
    const len = chs[0].length, outs = chs.map(() => new Float32Array(len)); let yL = 0, ms = 0, maxGR = 0;
    for (let i = 0; i < len; i++) {
      let lvl = linkedAbs(chs, i);
      if (p.detector === 'rms') { ms = rmsC * ms + (1 - rmsC) * lvl * lvl; lvl = Math.sqrt(ms); }
      const xd = linToDb(lvl), xl = xd - gc(xd);
      yL = xl > yL ? at * yL + (1 - at) * xl : rt * yL + (1 - rt) * xl;
      if (yL > maxGR) maxGR = yL;
      const g = dbToLin(makeup - yL);
      for (let c = 0; c < chs.length; c++) outs[c][i] = chs[c][i] * g;
    }
    outs.maxGR = maxGR; return outs;
  }
  // Look-ahead brick-wall limiter. Output never exceeds the ceiling (sample peak).
  function limit(chs, sr, p) {
    const ceil = dbToLin(p.ceiling ?? -1), inG = dbToLin(p.gain || 0), L = Math.max(1, Math.round(sr * (p.lookahead ?? 5) / 1000));
    const rel = Math.exp(-1 / (sr * Math.max(1, p.release ?? 80) / 1000));
    const len = chs[0].length, req = new Float32Array(len + L);
    for (let i = 0; i < len; i++) { const a = linkedAbs(chs, i) * inG; req[i] = a > ceil ? ceil / a : 1; }
    for (let i = len; i < len + L; i++) req[i] = 1;
    // sliding minimum over window [j-L, j]
    const m = new Float32Array(len + L), dq = new Int32Array(len + L + 1); let h = 0, t = 0;
    for (let j = 0; j < len + L; j++) {
      while (t > h && req[dq[t - 1]] >= req[j]) t--; dq[t++] = j;
      while (dq[h] < j - L) h++;
      m[j] = req[dq[h]];
    }
    // release smoothing (never above m)
    let r = 1; for (let j = 0; j < len + L; j++) { r = m[j] < r ? m[j] : m[j] + (r - m[j]) * rel; m[j] = r; }
    // moving average over L samples → G[n] applies to sample n-L
    const outs = chs.map(() => new Float32Array(len)); let acc = 0; const q = new Float64Array(len + L);
    let minG = 1;
    for (let n = 0; n < len + L; n++) {
      acc += m[n]; if (n >= L) acc -= m[n - L];
      const G = n >= L - 1 ? acc / L : 1; const src = n - L + 1; // window m[n-L+1..n] covers src
      if (src >= 0 && src < len) { const g = Math.min(G, req[src]) * inG; if (g / inG < minG) minG = g / inG; for (let c = 0; c < chs.length; c++) outs[c][src] = chs[c][src] * g; }
      q[n] = G;
    }
    outs.maxGR = -linToDb(minG); return outs;
  }
  function gate(chs, sr, p) {
    const open = dbToLin(p.threshold), close = dbToLin(p.threshold - (p.hysteresis ?? 4)), floor = dbToLin(-Math.abs(p.range ?? 80));
    const atk = 1 - Math.exp(-1 / (sr * Math.max(0.05, p.attack ?? 1) / 1000)), relc = 1 - Math.exp(-1 / (sr * Math.max(1, p.release ?? 120) / 1000));
    const hold = Math.round(sr * (p.hold ?? 30) / 1000), envC = Math.exp(-1 / (sr * 0.002));
    const len = chs[0].length, outs = chs.map(() => new Float32Array(len)); let env = 0, g = floor, isOpen = false, hc = 0;
    for (let i = 0; i < len; i++) {
      const a = linkedAbs(chs, i); env = a > env ? a : envC * env + (1 - envC) * a;
      if (env >= open) { isOpen = true; hc = hold; } else if (env < close) { if (hc > 0) hc--; else isOpen = false; }
      const tg = isOpen ? 1 : floor; g += (tg - g) * (tg > g ? atk : relc);
      for (let c = 0; c < chs.length; c++) outs[c][i] = chs[c][i] * g;
    }
    return outs;
  }

  /* ---------------- Delay / modulation / distortion ---------------- */
  function delay(chs, sr, p) {
    const D = Math.max(1, Math.round(sr * p.time / 1000)), fb = clamp(p.feedback / 100, 0, 0.97), wet = p.mix / 100, dry = p.dry == null ? 1 : p.dry / 100;
    const lpA = Math.exp(-TAU * clamp(p.damp || 8000, 200, sr * 0.45) / sr);
    const len = chs[0].length, n = chs.length, outs = chs.map(() => new Float32Array(len));
    const bufs = chs.map(() => new Float32Array(D)), lp = new Float64Array(n);
    const pp = p.pingpong && n >= 2;
    for (let i = 0; i < len; i++) {
      const r = i % D;
      const d = bufs.map((b, c) => { lp[c] = (1 - lpA) * b[r] + lpA * lp[c]; return lp[c]; });
      for (let c = 0; c < n; c++) {
        const x = chs[c][i];
        if (pp) { if (c === 0) bufs[0][r] = (chs[0][i] + chs[1][i]) * 0.5 + d[1] * fb; else if (c === 1) bufs[1][r] = d[0] * fb; else bufs[c][r] = x + d[c] * fb; }
        else bufs[c][r] = x + d[c] * fb;
        outs[c][i] = x * dry + d[c] * wet;
      }
    }
    return outs;
  }
  function hermite(buf, pos) {
    const n = buf.length; pos = ((pos % n) + n) % n; let i = Math.floor(pos); const f = pos - i;
    const xm1 = buf[(i - 1 + n) % n], x0 = buf[(i + n) % n], x1 = buf[(i + 1) % n], x2 = buf[(i + 2) % n];
    const c1 = 0.5 * (x1 - xm1), c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
    return ((c3 * f + c2) * f + c1) * f + x0;
  }
  function modulate(chs, sr, p) {
    const len = chs[0].length, voices = Math.max(1, p.voices | 0), base = p.delay / 1000 * sr, depth = p.depth / 1000 * sr;
    const size = Math.ceil(base + depth + 8), fb = clamp(p.feedback / 100, -0.95, 0.95), mix = p.mix / 100, rate = TAU * p.rate / sr;
    return chs.map((x, c) => {
      const buf = new Float32Array(size), y = new Float32Array(len); let last = 0;
      const chPh = (c % 2) * (p.spread ?? 90) / 180 * Math.PI;
      for (let i = 0; i < len; i++) {
        const wpos = i % size; buf[wpos] = x[i] + last * fb;
        let s = 0;
        for (let v = 0; v < voices; v++) { const d = base + depth * 0.5 * (1 + Math.sin(rate * i + chPh + TAU * v / voices)); s += hermite(buf, wpos - d); }
        s /= voices; last = s;
        y[i] = x[i] * (1 - mix) + s * mix;
      }
      return y;
    });
  }
  function distort(chs, sr, p) {
    const drive = dbToLin(p.drive), outG = dbToLin(p.output || 0), mix = p.mix / 100, bits = p.bits || 8;
    const tone = biquad('lowpass', p.tone || 12000, 0.707, 0, sr);
    const q = Math.pow(2, bits - 1), hold = Math.max(1, p.downsample | 0);
    const shape = {
      soft: v => Math.tanh(v),
      hard: v => clamp(v, -1, 1) * 0.9,
      tube: v => v >= 0 ? 1 - Math.exp(-v) : -(1 - Math.exp(v * 1.4)) / 1.2,
      fold: v => { let y = v; for (let k = 0; k < 8 && Math.abs(y) > 1; k++) y = y > 1 ? 2 - y : -2 - y; return y; },
      crush: v => Math.round(clamp(v, -1, 1) * q) / q
    }[p.type] || Math.tanh;
    return chs.map(x => {
      const y = new Float32Array(x.length); let held = 0;
      for (let i = 0; i < x.length; i++) { if (p.type !== 'crush' || i % hold === 0) held = shape(x[i] * (p.type === 'crush' ? 1 : drive)); y[i] = held; }
      biquadRun(y, [tone], y);
      for (let i = 0; i < x.length; i++) y[i] = (x[i] * (1 - mix) + y[i] * mix) * outG;
      return y;
    });
  }

  /* ---------------- Reverb impulse responses ---------------- */
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 * 2 - 1; }; }
  const REVERB_PRESETS = {
    room: { decay: 0.7, predelay: 4, damping: 6000, early: 1, diffusion: 0.8, size: 0.35 },
    hall: { decay: 2.6, predelay: 22, damping: 4500, early: 0.6, diffusion: 1, size: 1 },
    plate: { decay: 1.7, predelay: 0, damping: 9000, early: 0, diffusion: 1, size: 0.5 }
  };
  function impulseResponse(type, sr, opt = {}) {
    const P = { ...REVERB_PRESETS[type] || REVERB_PRESETS.room, ...opt };
    const pre = Math.round(sr * P.predelay / 1000), len = pre + Math.round(sr * P.decay * 1.25);
    const chs = [0, 1].map(c => {
      const r = rng(1234 + c * 977 + type.length * 31), h = new Float32Array(len);
      let lp = 0;
      for (let i = 0; i < len - pre; i++) {
        const t = i / sr, env = Math.exp(-6.91 * t / P.decay);
        // damping: cutoff falls over the tail (high frequencies decay faster)
        const fc = P.damping * Math.exp(-t / P.decay * 1.6) + 400, a = Math.exp(-TAU * fc / sr);
        lp = (1 - a) * r() + a * lp;
        const bright = type === 'plate' ? 0.35 : 0.12;
        let v = (lp * (1 - bright) + r() * bright * Math.exp(-t * 8)) * env;
        if (type === 'hall') v *= Math.min(1, t / 0.03); // slower build-up
        h[pre + i] = v;
      }
      // early reflections
      if (P.early > 0) {
        const er = rng(77 + c), n = Math.round(10 + 14 * P.size);
        for (let k = 0; k < n; k++) { const tt = (2 + Math.abs(er()) * 60 * P.size) / 1000, idx = pre + Math.round(tt * sr); if (idx < len) h[idx] += er() * 0.8 * P.early * Math.exp(-tt * 20); }
      }
      return h;
    });
    // normalise energy
    let e = 0; for (const h of chs) for (let i = 0; i < h.length; i++) e += h[i] * h[i];
    const g = 1 / Math.sqrt(e / 2 + 1e-12) * 0.5; for (const h of chs) for (let i = 0; i < h.length; i++) h[i] *= g;
    return chs;
  }

  /* ---------------- Noise reduction (spectral subtraction / gating) ---------------- */
  const NR_N = 2048;
  function noiseProfile(chs, sr) {
    const N = NR_N, hop = N / 4, w = hann(N), H = N / 2;
    const fr = new Float64Array(N), re = new Float64Array(H + 1), im = new Float64Array(H + 1);
    const mags = chs.map(x => {
      const acc = new Float64Array(H + 1); let frames = 0;
      for (let pos = 0; pos + N <= Math.max(N, x.length); pos += hop) {
        for (let i = 0; i < N; i++) { const k = pos + i; fr[i] = k < x.length ? x[k] * w[i] : 0; }
        rfft(fr, re, im); for (let k = 0; k <= H; k++) acc[k] += Math.sqrt(re[k] * re[k] + im[k] * im[k]); frames++;
      }
      const m = new Float32Array(H + 1); for (let k = 0; k <= H; k++) m[k] = acc[k] / Math.max(1, frames); return m;
    });
    return { N, sr, mags, seconds: chs[0].length / sr };
  }
  function noiseReduce(chs, sr, prof, p) {
    const N = prof.N, H = N / 2, hop = N / 4, floor = dbToLin(-Math.abs(p.reduction)), over = dbToLin(p.sensitivity ?? 6);
    const sm = Math.max(0, p.smoothing | 0), ac = 1 - Math.exp(-hop / (sr * Math.max(1, p.attack ?? 5) / 1000)), rc = Math.exp(-hop / (sr * Math.max(1, p.release ?? 80) / 1000));
    return chs.map((x, c) => {
      const prm = prof.mags[c % prof.mags.length], thr = new Float64Array(H + 1);
      for (let k = 0; k <= H; k++) thr[k] = prm[k] * over;
      const g = new Float64Array(H + 1), gs = new Float64Array(H + 1), gp = new Float64Array(H + 1).fill(1);
      return stftMap(x, N, hop, (re, im) => {
        for (let k = 0; k <= H; k++) { const m2 = re[k] * re[k] + im[k] * im[k], t2 = thr[k] * thr[k]; g[k] = m2 <= t2 ? floor : Math.max(floor, 1 - t2 / m2); }
        if (sm === 0) gs.set(g);
        else { let acc = 0; for (let j = 0; j <= Math.min(H, sm); j++) acc += g[j]; for (let k = 0; k <= H; k++) { const lo = k - sm, hi = k + sm; gs[k] = acc / (Math.min(H, hi) - Math.max(0, lo) + 1); if (hi + 1 <= H) acc += g[hi + 1]; if (lo >= 0) acc -= g[lo]; } }
        for (let k = 0; k <= H; k++) {
          gp[k] = gs[k] > gp[k] ? gp[k] + (gs[k] - gp[k]) * ac : gs[k] + (gp[k] - gs[k]) * rc;
          const gg = p.residual ? 1 - gp[k] : gp[k]; re[k] *= gg; im[k] *= gg;
        }
      });
    });
  }

  /* ---------------- De-click (LPC residual detection + bidirectional AR interpolation) ---------------- */
  function lpc(x, s, n, order) {
    const r = new Float64Array(order + 1);
    for (let l = 0; l <= order; l++) { let a = 0; for (let i = s + l; i < s + n; i++) a += x[i] * x[i - l] * (0.54 - 0.46 * Math.cos(TAU * (i - s) / n)); r[l] = a; }
    r[0] *= 1.0001; r[0] += 1e-9;
    const a = new Float64Array(order + 1), tmp = new Float64Array(order + 1); a[0] = 1; let e = r[0];
    for (let i = 1; i <= order; i++) {
      let k = -r[i]; for (let j = 1; j < i; j++) k -= a[j] * r[i - j]; k /= e;
      tmp.set(a); for (let j = 1; j < i; j++) a[j] = tmp[j] + k * tmp[i - j]; a[i] = k; e *= 1 - k * k; if (e <= 0) break;
    }
    return a; // prediction: x[n] ≈ -Σ a[k] x[n-k]
  }
  function declick(chs, sr, p) {
    const order = 20, B = 2048, maxW = Math.max(4, Math.round(sr * (p.maxWidth ?? 2) / 1000)), sens = p.threshold ?? 8;
    let count = 0;
    const outs = chs.map(x0 => {
      const x = x0.slice(), len = x.length, e = new Float32Array(len);
      for (let b = order; b < len; b += B) {
        const n = Math.min(B, len - b); if (n < order * 4) break;
        const a = lpc(x0, b, n, order);
        for (let i = b; i < b + n; i++) { let s = x0[i]; for (let k = 1; k <= order; k++) s += a[k] * x0[i - k]; e[i] = s; }
      }
      // robust threshold per block: median absolute residual
      const flags = new Uint8Array(len);
      for (let b = 0; b < len; b += B) {
        const n = Math.min(B, len - b), tmp = Array.from(e.subarray(b, b + n), Math.abs).sort((u, v) => u - v);
        const med = tmp[n >> 1] || 0, thr = sens * med * 1.4826 + 1e-5;
        for (let i = b; i < b + n; i++) if (Math.abs(e[i]) > thr) flags[i] = 1;
      }
      // group flagged samples into candidate clicks
      const cands = [];
      for (let i = order * 2; i < len - order * 2; i++) {
        if (!flags[i]) continue;
        let j = i; while (j < len && (flags[j] || flags[j + 1] || flags[j + 2])) j++;
        cands.push([Math.max(order * 2, i - 2), Math.min(len - order * 2 - 1, j + 2)]);
        i = j + order;
      }
      // clicks are isolated events: dense detections (voiced speech pulses, drum hits) are not repaired
      const dense = new Uint8Array(Math.ceil(len / B) + 1);
      for (let k = 0, j = 0; k < cands.length; k++) {
        while (cands[k][0] - cands[j][0] > B) j++;
        if (k - j + 1 > 3) for (let q = j; q <= k; q++) dense[(cands[q][0] / B) | 0] = 1;
      }
      for (const [s, en] of cands) {
        const wdt = en - s;
        if (wdt <= 0 || wdt > maxW || dense[(s / B) | 0]) continue;
        // isolation test: the residual spike must stand out from the residual just before and just after it
        const W1 = order + 4, W2 = W1 + Math.round(sr * 0.006);
        let pe = 0; for (let k = s; k < en; k++) pe = Math.max(pe, Math.abs(e[k]));
        const lrms = (a0, a1) => { a0 = Math.max(0, a0); a1 = Math.min(len, a1); let q = 0; for (let k = a0; k < a1; k++) q += e[k] * e[k]; return Math.sqrt(q / Math.max(1, a1 - a0)); };
        if (pe < sens * 0.6 * Math.max(lrms(s - W2, s - W1), lrms(en + W1, en + W2), 1e-6)) continue;
        // fit AR model on preceding context, extrapolate forward and backward, cross-fade
        const ctx = Math.min(1024, s - 1), a = lpc(x0, s - ctx, ctx, Math.min(order, ctx >> 2));
        const ord = a.length - 1, fw = new Float64Array(wdt), bw = new Float64Array(wdt);
        for (let k = 0; k < wdt; k++) { let v = 0; for (let m = 1; m <= ord; m++) v -= a[m] * (k - m >= 0 ? fw[k - m] : x[s + k - m]); fw[k] = v; }
        for (let k = wdt - 1; k >= 0; k--) { let v = 0; for (let m = 1; m <= ord; m++) { const idx = k + m; v -= a[m] * (idx < wdt ? bw[idx] : x[s + idx]); } bw[k] = v; }
        // sanity: the patch must stay within the local signal range, else fall back to cubic interpolation
        let lim = 0; for (let k = Math.max(0, s - 64); k < s; k++) lim = Math.max(lim, Math.abs(x[k])); for (let k = en; k < Math.min(len, en + 64); k++) lim = Math.max(lim, Math.abs(x[k]));
        let okPatch = true; const patch = new Float64Array(wdt);
        for (let k = 0; k < wdt; k++) { const t = (k + 1) / (wdt + 1); patch[k] = fw[k] * (1 - t) + bw[k] * t; if (!Number.isFinite(patch[k]) || Math.abs(patch[k]) > lim * 1.25 + 1e-4) okPatch = false; }
        if (!okPatch) { const p0 = x[s - 1], p1 = x[en], m0 = x[s - 1] - x[s - 2], m1 = x[en + 1] - x[en]; for (let k = 0; k < wdt; k++) { const t = (k + 1) / (wdt + 1), t2 = t * t, t3 = t2 * t; patch[k] = (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 * (wdt + 1) + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1 * (wdt + 1); } }
        for (let k = 0; k < wdt; k++) x[s + k] = patch[k];
        count++;
      }
      return x;
    });
    outs.count = count; return outs;
  }

  /* ---------------- ITU-R BS.1770-4 / EBU R128 loudness ---------------- */
  function kWeight(sr) {
    let f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196;
    let K = Math.tan(Math.PI * f0 / sr); const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416);
    let a0 = 1 + K / Q + K * K;
    const s1 = { b0: (Vh + Vb * K / Q + K * K) / a0, b1: 2 * (K * K - Vh) / a0, b2: (Vh - Vb * K / Q + K * K) / a0, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
    f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / sr);
    a0 = 1 + K / Q + K * K;
    const s2 = { b0: 1, b1: -2, b2: 1, a1: 2 * (K * K - 1) / a0, a2: (1 - K / Q + K * K) / a0 };
    return [s1, s2];
  }
  function chWeights(n) { if (n === 6) return [1, 1, 1, 0, 1.41, 1.41]; if (n === 5) return [1, 1, 1, 1.41, 1.41]; return new Array(n).fill(1); }
  // Returns {integrated, momentaryMax, shortTermMax, lra, samplePeak (dBFS), truePeak (dBTP)}
  function loudness(chs, sr, opts = {}) {
    const kw = kWeight(sr), G = chWeights(chs.length), len = chs[0].length;
    const filt = chs.map(x => { const y = biquadRun(x, kw); for (let i = 0; i < y.length; i++) y[i] *= y[i]; return y; });
    // prefix sums per channel (float64) for fast window means
    const pre = filt.map(y => { const p = new Float64Array(len + 1); for (let i = 0; i < len; i++) p[i + 1] = p[i] + y[i]; return p; });
    const blockMS = (start, n) => { let s = 0; for (let c = 0; c < chs.length; c++) if (G[c]) s += G[c] * (pre[c][Math.min(len, start + n)] - pre[c][start]) / n; return s; };
    const L = ms => -0.691 + 10 * Math.log10(ms + 1e-30);
    const step = Math.round(sr * 0.1), n400 = Math.round(sr * 0.4), n3 = Math.round(sr * 3);
    const blocks = []; for (let s = 0; s + n400 <= len; s += step) blocks.push(blockMS(s, n400));
    let integrated = -Infinity, momentaryMax = -Infinity;
    if (blocks.length) {
      momentaryMax = L(Math.max(...blocks));
      const abs = blocks.filter(z => L(z) > -70);
      if (abs.length) {
        const rel = L(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
        const g = abs.filter(z => L(z) > rel);
        if (g.length) integrated = L(g.reduce((a, b) => a + b, 0) / g.length);
      }
    }
    const st = []; for (let s = 0; s + n3 <= len; s += step) st.push(L(blockMS(s, n3)));
    const shortTermMax = st.length ? Math.max(...st) : -Infinity;
    let lra = 0;
    if (st.length > 2) {
      const a = st.filter(v => v > -70); if (a.length) {
        const rel = L(a.reduce((s, v) => s + Math.pow(10, (v + 0.691) / 10), 0) / a.length) - 20;
        const g = a.filter(v => v > rel).sort((x, y) => x - y);
        if (g.length > 1) lra = g[Math.min(g.length - 1, Math.round(0.95 * (g.length - 1)))] - g[Math.round(0.1 * (g.length - 1))];
      }
    }
    let sp = 0; for (const x of chs) for (let i = 0; i < x.length; i++) { const v = Math.abs(x[i]); if (v > sp) sp = v; }
    let tp = sp;
    if (opts.truePeak !== false && len * chs.length < 40e6) tp = Math.max(sp, truePeak(chs));
    return { integrated, momentaryMax, shortTermMax, lra, samplePeak: linToDb(sp), truePeak: linToDb(tp) };
  }
  // 4x oversampled peak (polyphase windowed-sinc, 12 taps per phase)
  let tpK = null;
  function truePeak(chs) {
    if (!tpK) { tpK = []; for (let ph = 1; ph < 4; ph++) { const k = []; let s = 0; for (let j = -6; j < 6; j++) { const x = j + 1 - ph / 4; const v = (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * (0.5 + 0.5 * Math.cos(Math.PI * x / 6.5)); k.push(v); s += v; } tpK.push(k.map(v => v / s)); } }
    let m = 0;
    for (const x of chs) for (let i = 6; i < x.length - 6; i++) {
      const a = Math.abs(x[i]); if (a > m) m = a;
      if (Math.abs(x[i]) < m * 0.6 && Math.abs(x[i + 1]) < m * 0.6) continue; // cannot exceed current max between small samples
      for (const k of tpK) { let s = 0; for (let j = 0; j < 12; j++) s += k[j] * x[i - 5 + j]; s = Math.abs(s); if (s > m) m = s; }
    }
    return m;
  }

  /* ---------------- misc helpers ---------------- */
  const FADE_SHAPES = { linear: 'Linear', log: 'Logarithmic (fast start)', exp: 'Exponential (slow start)', scurve: 'S-Curve (cosine)', equal: 'Equal power' };
  function fadeCurve(shape, t) {
    t = clamp(t, 0, 1);
    switch (shape) {
      case 'log': return Math.log10(1 + 9 * t);
      case 'exp': return (Math.pow(10, t * 2) - 1) / 99;
      case 'scurve': return 0.5 - 0.5 * Math.cos(Math.PI * t);
      case 'equal': return Math.sin(Math.PI / 2 * t);
      default: return t;
    }
  }
  function peak(chs, a = 0, b) { let m = 0; for (const x of chs) { const e = b ?? x.length; for (let i = a; i < e; i++) { const v = Math.abs(x[i]); if (v > m) m = v; } } return m; }
  function rms(x, a = 0, b = x.length) { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); }

  return { TAU, dbToLin, linToDb, clamp, fft, rfft, irfft, hann, pow2, stftMap, spectrum, biquad, biquadRun, biquadMag, eqCoefs, eqResponseDb, GEQ_FREQS, geqCoefs,
    resample, wsola, pvoc, stretchPitch, compress, limit, gate, delay, modulate, distort, impulseResponse, REVERB_PRESETS, rng,
    noiseProfile, noiseReduce, declick, lpc, kWeight, loudness, truePeak, FADE_SHAPES, fadeCurve, peak, rms };
})();
