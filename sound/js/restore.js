'use strict';
/* Lumen Sound — v1.2 restoration & stereo DSP (pure functions on Float32Array channels, extends window.DSP):
   hum detection + DeHummer (zero-phase harmonic notch comb), DeClipper (clip-run detection + least-squares
   polynomial reconstruction), De-esser (split-band sibilance compressor), Center Channel Extractor (STFT
   inter-channel coherence mask: karaoke / isolate center). */
(function (DSP) {
  const { dbToLin, linToDb, clamp, biquad, biquadRun, rfft, irfft, hann } = DSP;

  /* ---------------- Hum detection ---------------- */
  // Finds a mains-hum fundamental (48.5–51.5 or 58.5–61.5 Hz) from the harmonic comb in a long-window spectrum.
  // Returns {freq, strength (dB of harmonics above the local floor), harmonics (count clearly above floor), spec, bin}.
  function detectHum(chs, sr, maxSec = 20) {
    const len = Math.min(chs[0].length, Math.round(sr * maxSec)), x = new Float32Array(len);
    for (const c of chs) for (let i = 0; i < len; i++) x[i] += c[i] / chs.length;
    let N = 32768; while (N > 4096 && N > len) N >>= 1;
    if (len < 4096) return { freq: 0, strength: 0, harmonics: 0 };
    // per-bin 25th percentile of the frame magnitudes: hum is there in every frame, notes and words come and go
    const bin = sr / N, K = Math.min(N / 2, Math.ceil(600 / bin)), w = hann(N), fr = new Float64Array(N), re = new Float64Array(N / 2 + 1), im = new Float64Array(N / 2 + 1), frames = [];
    const hop = Math.max(N / 4, Math.floor((len - N) / 48) || N / 4);
    for (let pos = 0; pos + N <= len; pos += hop) { for (let i = 0; i < N; i++) fr[i] = x[pos + i] * w[i]; rfft(fr, re, im); const m = new Float32Array(K + 1); for (let k = 0; k <= K; k++) m[k] = Math.hypot(re[k], im[k]); frames.push(m); }
    const lin = new Float64Array(K + 2), col = new Float32Array(frames.length), q = Math.floor((frames.length - 1) * 0.25);
    for (let k = 0; k <= K; k++) { for (let f = 0; f < frames.length; f++) col[f] = frames[f][k]; col.sort(); lin[k] = col[q] + 1e-12; }
    const spec = Array.from(lin, v => 20 * Math.log10(v));
    const at = f => { const p = f / bin, k = Math.floor(p), t = p - k; return k + 1 < lin.length ? lin[k] * (1 - t) + lin[k + 1] * t : 0; };
    const floorAt = f => { // median of the neighbourhood, excluding the peak's main lobe
      const k0 = Math.round(f / bin), o = []; for (let d = 4; d <= 14; d++) { if (k0 - d > 0) o.push(lin[k0 - d]); if (k0 + d < lin.length) o.push(lin[k0 + d]); }
      o.sort((a, b) => a - b); return o[o.length >> 1] || 1e-12;
    };
    const H = 8, fTop = Math.min(sr * 0.45, K * bin - 20); let best = 0, bestF = 0;
    // mains hum sits within ~±1.5 Hz of 50 or 60 Hz; searching only there keeps bass notes from being mistaken for hum
    for (const f of [...Array(61)].flatMap((_, i) => [48.5 + i * 0.05, 58.5 + i * 0.05])) {
      let s = 0; for (let k = 1; k <= H && k * f < fTop; k++) s += Math.log(Math.max(1, at(k * f) / floorAt(k * f)));
      if (s > best) { best = s; bestF = f; }
    }
    if (!bestF) return { freq: 0, strength: 0, harmonics: 0, spec, bin };
    // refine: parabolic interpolation on the strongest harmonic, divided by its order
    let kb = 1, rb = 0; for (let k = 1; k <= H && k * bestF < fTop; k++) { const r = at(k * bestF) / floorAt(k * bestF); if (r > rb) { rb = r; kb = k; } }
    const c = Math.round(kb * bestF / bin); let freq = bestF;
    if (c > 0 && c + 1 < spec.length) { const a = spec[c - 1], b = spec[c], d = spec[c + 1], den = a - 2 * b + d; if (b >= a && b >= d && Math.abs(den) > 1e-9) { const fr = (c + 0.5 * (a - d) / den) * bin / kb; if (Math.abs(fr - bestF) < 0.3) freq = fr; } }
    let harmonics = 0, sDb = 0;
    for (let k = 1; k <= H && k * freq < fTop; k++) { const r = linToDb(at(k * freq) / floorAt(k * freq)); if (r > 6) harmonics++; sDb = Math.max(sDb, r); }
    return { freq: Math.round(freq * 100) / 100, strength: sDb, harmonics, spec, bin }; // spec: steady-state magnitude (dB, uncalibrated) per bin up to 600 Hz
  }

  /* ---------------- DeHummer ---------------- */
  // p: {freq, harmonics, width (Hz, same for every harmonic), depth (dB), residual}.
  // Peaking cuts at k·freq, run forward + backward (zero phase, depth split between the passes).
  function dehumCoefs(sr, p) {
    const out = [], n = clamp(Math.round(p.harmonics ?? 8), 1, 40), half = -Math.abs(p.depth ?? 40) / 2, bw = clamp(p.width ?? 1, 0.2, 20);
    for (let k = 1; k <= n; k++) { const f = p.freq * k; if (f >= sr * 0.45) break; out.push(biquad('peaking', f, f / bw, half, sr)); }
    return out;
  }
  function dehum(chs, sr, p) {
    if (!(p.freq > 0)) return chs.map(c => c.slice());
    const co = dehumCoefs(sr, p);
    return chs.map(x => {
      // reflect-pad so the notches settle before the audio starts (avoids an edge transient)
      const pad = Math.min(x.length, Math.round(sr * 0.5)), L = x.length, y = new Float32Array(L + 2 * pad);
      for (let i = 0; i < pad; i++) { y[pad - 1 - i] = 2 * x[0] - x[Math.min(L - 1, i + 1)]; y[pad + L + i] = 2 * x[L - 1] - x[Math.max(0, L - 2 - i)]; }
      y.set(x, pad);
      biquadRun(y, co, y); y.reverse(); biquadRun(y, co, y); y.reverse();
      const o = y.slice(pad, pad + L);
      if (p.residual) for (let i = 0; i < L; i++) o[i] = x[i] - o[i];
      return o;
    });
  }

  /* ---------------- DeClipper ---------------- */
  // Finds runs of samples stuck near the positive/negative peak level and rebuilds them with a least-squares
  // quartic through the unclipped neighbours. p: {tolerance %, minRun samples, gain dB, autoGain}.
  function clipRuns(x, p, levels) {
    const tol = clamp((p.tolerance ?? 1) / 100, 0, 0.5), minRun = Math.max(1, Math.round(p.minRun ?? 3));
    let mx = 0, mn = 0; for (let i = 0; i < x.length; i++) { const v = x[i]; if (v > mx) mx = v; else if (v < mn) mn = v; }
    const hi = levels?.hi ?? mx * (1 - tol), lo = levels?.lo ?? mn * (1 - tol), runs = [];
    for (let i = 0; i < x.length; i++) {
      const s = hi > 1e-6 && x[i] >= hi ? 1 : lo < -1e-6 && x[i] <= lo ? -1 : 0; if (!s) continue;
      let j = i; while (j + 1 < x.length && (s > 0 ? x[j + 1] >= hi : x[j + 1] <= lo)) j++;
      if (j - i + 1 >= minRun) runs.push([i, j + 1, s]);
      i = j;
    }
    return { runs, hi, lo };
  }
  function solveN(A, b) { // Gaussian elimination with partial pivoting
    const n = b.length, M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-14) return null; [M[c], M[p]] = [M[p], M[c]];
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
    }
    return M.map((r, i) => r[n] / r[i]);
  }
  function declip(chs, sr, p = {}) {
    let count = 0, samples = 0;
    const outs = chs.map(x0 => {
      const x = x0.slice(), { runs, hi, lo } = clipRuns(x0, p), flag = new Uint8Array(x.length);
      for (const [a, b] of runs) flag.fill(1, a, b);
      for (const [a, b, s] of runs) {
        // quartic least-squares fit through a short unclipped context on each side (≈0.4·run + 2 samples):
        // tight enough to follow the waveform's curvature, wide enough to average out noise
        const R = b - a, K = clamp(Math.round(R * 0.4) + 2, 6, 32), ts = [], ys = [], D = 5;
        for (let i = a - 1, k = 0; i >= 0 && k < K && !flag[i]; i--, k++) { ts.push(i - a); ys.push(x0[i]); }
        for (let i = b, k = 0; i < x.length && k < K && !flag[i]; i++, k++) { ts.push(i - a); ys.push(x0[i]); }
        const level = s > 0 ? hi : lo, cap = level * 4;
        let fit = null;
        if (ts.length >= D + 2 && ts.some(t => t < 0) && ts.some(t => t >= R)) {
          const sc = 1 / (R + K), A = Array.from({ length: D }, () => new Array(D).fill(0)), v = new Array(D).fill(0), pw = new Array(D);
          for (let q = 0; q < ts.length; q++) { const t = (ts[q] - R / 2) * sc; pw[0] = 1; for (let d = 1; d < D; d++) pw[d] = pw[d - 1] * t; for (let r = 0; r < D; r++) { v[r] += pw[r] * ys[q]; for (let c = 0; c < D; c++) A[r][c] += pw[r] * pw[c]; } }
          const co = solveN(A, v); if (co) fit = i => { const t = (i - R / 2) * sc; let f = 0; for (let d = D - 1; d >= 0; d--) f = f * t + co[d]; return f; };
        }
        for (let i = 0; i < R; i++) {
          let v = fit ? fit(i) : level;
          if (!Number.isFinite(v)) v = level;
          x[a + i] = s > 0 ? clamp(v, level, cap) : clamp(v, cap, level);
        }
        count++; samples += R;
      }
      return x;
    });
    let g = dbToLin(p.gain || 0);
    if (p.autoGain !== false) { const pk = DSP.peak(outs) * g; if (pk > 0.999) g *= 0.999 / pk; }
    if (g !== 1) for (const o of outs) for (let i = 0; i < o.length; i++) o[i] *= g;
    outs.count = count; outs.samples = samples; outs.gainDb = linToDb(g); return outs;
  }
  function clipStats(chs, p = {}) { let count = 0, samples = 0; for (const x of chs) { const { runs } = clipRuns(x, p); count += runs.length; for (const [a, b] of runs) samples += b - a; } return { count, samples }; }

  /* ---------------- De-esser ---------------- */
  // Sidechain: high-passed (12 dB/oct ×2) linked peak envelope. Reduction = level above threshold (∞:1), capped.
  // split mode: Linkwitz–Riley crossover, only the band above `freq` is attenuated (low + high = input exactly).
  function deessDetector(chs, sr, p) {
    const len = chs[0].length, f = clamp(p.freq ?? 5500, 1000, sr * 0.45), hp = [biquad('highpass', f, 0.7071, 0, sr), biquad('highpass', f, 0.7071, 0, sr)];
    const sc = chs.map(x => biquadRun(x, hp)), env = new Float32Array(len);
    const at = Math.exp(-1 / (sr * 0.0004)), rt = Math.exp(-1 / (sr * Math.max(1, p.release ?? 40) / 1000)); let e = 0;
    for (let i = 0; i < len; i++) { let m = 0; for (const s of sc) { const v = Math.abs(s[i]); if (v > m) m = v; } e = m > e ? at * e + (1 - at) * m : rt * e + (1 - rt) * m; env[i] = e; }
    return env;
  }
  function deess(chs, sr, p = {}) {
    const len = chs[0].length, env = deessDetector(chs, sr, p), thr = p.threshold ?? -30, maxR = Math.abs(p.reduction ?? 12);
    const gr = new Float32Array(len); let maxGR = 0, active = 0;
    for (let i = 0; i < len; i++) { const r = clamp(linToDb(env[i]) - thr, 0, maxR); gr[i] = dbToLin(-r); if (r > maxGR) maxGR = r; if (r > 1) active++; }
    const f = clamp(p.freq ?? 5500, 1000, sr * 0.45), lp = [biquad('lowpass', f, 0.7071, 0, sr), biquad('lowpass', f, 0.7071, 0, sr)];
    const outs = chs.map(x => {
      const o = new Float32Array(len);
      if (p.mode === 'wide') { for (let i = 0; i < len; i++) o[i] = p.listen ? x[i] * (1 - gr[i]) : x[i] * gr[i]; return o; }
      const low = biquadRun(x, lp);
      for (let i = 0; i < len; i++) { const h = x[i] - low[i]; o[i] = p.listen ? h * (1 - gr[i]) : low[i] + h * gr[i]; }
      return o;
    });
    outs.maxGR = maxGR; outs.activePct = 100 * active / Math.max(1, len); return outs;
  }

  /* ---------------- Center Channel Extractor ---------------- */
  // STFT both channels; per bin the inter-channel similarity s = 2·Re(L·R*)/(|L|²+|R|²) (1 = identical, center-panned).
  // Center estimate C = m·(L+R)/2 with m rising from 0 at `width` to 1 at s = 1. Out = sides·(X−C) + center·C,
  // only inside [fLo, fHi]; bins outside the band pass unchanged.
  function centerExtract(chs, sr, p = {}) {
    if (chs.length !== 2) throw new Error('Center channel extraction needs a stereo file');
    const [L, R] = chs, len = L.length, N = sr > 64000 ? 8192 : 4096, hop = N / 4, H = N / 2, w = hann(N);
    const cg = dbToLin(p.center ?? -48), sg = dbToLin(p.sides ?? 0), thr = clamp((p.width ?? 60) / 100, 0, 0.98);
    const k0 = Math.max(0, Math.floor((p.fLo ?? 0) / sr * N)), k1 = Math.min(H, Math.ceil((p.fHi ?? sr / 2) / sr * N));
    const fl = new Float64Array(N), fr = new Float64Array(N), lr = new Float64Array(H + 1), li = new Float64Array(H + 1), rr = new Float64Array(H + 1), ri = new Float64Array(H + 1);
    const s = new Float64Array(H + 1), oL = new Float32Array(len), oR = new Float32Array(len), norm = new Float32Array(len);
    for (let pos = -N + hop; pos < len; pos += hop) {
      for (let i = 0; i < N; i++) { const k = pos + i, ok = k >= 0 && k < len; fl[i] = ok ? L[k] * w[i] : 0; fr[i] = ok ? R[k] * w[i] : 0; }
      rfft(fl, lr, li); rfft(fr, rr, ri);
      for (let k = 0; k <= H; k++) { const e = lr[k] * lr[k] + li[k] * li[k] + rr[k] * rr[k] + ri[k] * ri[k]; s[k] = e > 1e-20 ? 2 * (lr[k] * rr[k] + li[k] * ri[k]) / e : 0; }
      for (let k = k0; k <= k1; k++) {
        const sm = (s[Math.max(0, k - 1)] + 2 * s[k] + s[Math.min(H, k + 1)]) / 4, m = clamp((sm - thr) / (1 - thr), 0, 1), mm = m * m * (3 - 2 * m);
        const cr = mm * (lr[k] + rr[k]) / 2, ci = mm * (li[k] + ri[k]) / 2;
        lr[k] = sg * (lr[k] - cr) + cg * cr; li[k] = sg * (li[k] - ci) + cg * ci;
        rr[k] = sg * (rr[k] - cr) + cg * cr; ri[k] = sg * (ri[k] - ci) + cg * ci;
      }
      li[0] = li[H] = ri[0] = ri[H] = 0;
      irfft(lr, li, fl); irfft(rr, ri, fr);
      const i0 = Math.max(0, -pos), i1 = Math.min(N, len - pos);
      for (let i = i0; i < i1; i++) { const k = pos + i; oL[k] += fl[i] * w[i]; oR[k] += fr[i] * w[i]; norm[k] += w[i] * w[i]; }
    }
    for (let i = 0; i < len; i++) { const n = norm[i] > 1e-6 ? 1 / norm[i] : 0; oL[i] *= n; oR[i] *= n; }
    return [oL, oR];
  }
  // Phase correlation (−1…+1) and mid/side balance of a stereo pair — shown in the dialog.
  function stereoStats(L, R) {
    let lr = 0, ll = 0, rrs = 0, m = 0, sd = 0;
    for (let i = 0; i < L.length; i++) { const a = L[i], b = R[i]; lr += a * b; ll += a * a; rrs += b * b; m += (a + b) * (a + b); sd += (a - b) * (a - b); }
    return { correlation: ll && rrs ? lr / Math.sqrt(ll * rrs) : 0, sideDb: linToDb(Math.sqrt(sd / Math.max(1e-30, m))) };
  }

  Object.assign(DSP, { detectHum, dehumCoefs, dehum, clipRuns, clipStats, declip, deessDetector, deess, centerExtract, stereoStats });
})(window.DSP);
