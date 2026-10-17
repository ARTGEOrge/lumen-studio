// Lumen Lab — spectral analysis: periodogram, pwelch (Welch's averaged periodogram) and spectrogram
// (short-time Fourier transform), with MATLAB's default windows, overlaps, FFT lengths and PSD scaling.
// Called without outputs they plot (PSD in dB, or a spectrogram image with a colorbar).
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const M = node ? require('./mat.js') : root.LabMat;
  const Lib = node ? require('./lib.js') : root.LabLib;
  const Nu = node ? require('./numerics.js') : root.LabNumerics;
  const { Mat, fail, num, str } = M;
  const { L, N, S, Str, isStr } = Lib;

  const nextPow2 = n => { let p = 1; while (p < n) p <<= 1; return p; };
  const hammingSym = n => n === 1 ? [1] : Array.from({ length: n }, (_, k) => 0.54 - 0.46 * Math.cos(2 * Math.PI * k / (n - 1)));
  const isEmpty = v => !v || (v.type === 'num' && v.n === 0);
  function signal(v, fn) { const X = N(v, fn); if (X.r !== 1 && X.c !== 1) fail(`${fn}: the signal must be a vector.`); if (X.n < 2) fail(`${fn}: the signal needs at least two samples.`); return { re: Array.from(X.re), im: X.im ? Array.from(X.im) : null, col: X.c === 1 }; }
  function windowArg(v, defLen) {
    if (isEmpty(v)) return hammingSym(defLen);
    const W = N(v); if (W.n === 1) { const n = Math.round(W.re[0]); if (!(n >= 2)) fail('The window length must be at least 2.'); return hammingSym(n); }
    return Array.from(W.re);
  }
  // one windowed segment → FFT of length nfft (segments longer than nfft wrap around, like MATLAB)
  function segFFT(re, im, start, w, nfft) {
    const xr = new Float64Array(nfft), xi = new Float64Array(nfft);
    for (let k = 0; k < w.length; k++) { const j = k % nfft; xr[j] += re[start + k] * w[k]; if (im) xi[j] += im[start + k] * w[k]; }
    return Nu.fft1(xr, xi, false);
  }
  // frequency grid and one-sided folding of |X|²
  function grid(nfft, fs, twoSided) {
    const nf = twoSided ? nfft : (nfft % 2 ? (nfft + 1) / 2 : nfft / 2 + 1);
    return { nf, f: Array.from({ length: nf }, (_, k) => k * fs / nfft) };
  }
  function psdFrom(Xr, Xi, nf, nfft, scale, twoSided) {
    const p = new Array(nf);
    for (let k = 0; k < nf; k++) { let v = (Xr[k] * Xr[k] + Xi[k] * Xi[k]) / scale; if (!twoSided && k > 0 && !(nfft % 2 === 0 && k === nfft / 2)) v *= 2; p[k] = v; }
    return p;
  }
  // trailing numeric arguments after the signal: positions are fixed, strings are options
  function parse(a, fn) {
    const sig = signal(a[0], fn), pos = [], flags = [];
    for (let k = 1; k < a.length; k++) { if (isStr(a[k])) flags.push(Str(a[k]).toLowerCase()); else pos.push(a[k]); }
    return { sig, pos, flags };
  }
  const outCol = v => M.colVec(v);

  function plotPSD(In, f, p, hasFs, title) {
    const G = In.lib, scale = hasFs ? 1 : 1 / Math.PI;
    G.plot([M.rowVec(f.map(v => v * scale)), M.rowVec(p.map(v => 10 * Math.log10(v + 1e-300)))], 0);
    G.grid([str('on')]); G.xlabel([str(hasFs ? 'Frequency (Hz)' : 'Normalized frequency (×π rad/sample)')]);
    G.ylabel([str(hasFs ? 'Power/frequency (dB/Hz)' : 'Power/frequency (dB/(rad/sample))')]); G.title([str(title)]);
  }

  L.periodogram = (a, nout, In) => {
    const { sig, pos, flags } = parse(a, 'periodogram'), n = sig.re.length;
    const w = isEmpty(pos[0]) ? new Array(n).fill(1) : (pos[0].n === 1 ? fail('periodogram: give the window as a vector (e.g. hamming(n)) or [].') : Array.from(N(pos[0]).re));
    if (w.length !== n) fail('periodogram: the window must be as long as the signal.');
    const nfft = isEmpty(pos[1]) ? Math.max(256, nextPow2(n)) : Math.round(S(pos[1])), hasFs = !isEmpty(pos[2]), fs = hasFs ? S(pos[2]) : 2 * Math.PI;
    const two = !!sig.im || flags.includes('twosided'), { nf, f } = grid(nfft, fs, two);
    const U = w.reduce((s, v) => s + v * v, 0), [Xr, Xi] = segFFT(sig.re, sig.im, 0, w, nfft);
    const p = psdFrom(Xr, Xi, nf, nfft, fs * U, two);
    if (nout === 0) { plotPSD(In, f, p, hasFs, 'Periodogram Power Spectral Density Estimate'); return; }
    return [outCol(p), outCol(f)];
  };

  L.pwelch = (a, nout, In) => {
    const { sig, pos, flags } = parse(a, 'pwelch'), n = sig.re.length;
    const w = windowArg(pos[0], Math.max(2, Math.floor(n / 4.5))), wl = w.length;
    if (wl > n) fail('pwelch: the window is longer than the signal.');
    const nov = isEmpty(pos[1]) ? Math.floor(wl / 2) : Math.round(S(pos[1]));
    if (!(nov >= 0 && nov < wl)) fail('pwelch: noverlap must be smaller than the window length.');
    const nfft = isEmpty(pos[2]) ? Math.max(256, nextPow2(wl)) : Math.round(S(pos[2])), hasFs = !isEmpty(pos[3]), fs = hasFs ? S(pos[3]) : 2 * Math.PI;
    const two = !!sig.im || flags.includes('twosided'), { nf, f } = grid(nfft, fs, two);
    const K = Math.floor((n - nov) / (wl - nov)), U = w.reduce((s, v) => s + v * v, 0), acc = new Array(nf).fill(0);
    for (let k = 0; k < K; k++) { In.tick(); const [Xr, Xi] = segFFT(sig.re, sig.im, k * (wl - nov), w, nfft); psdFrom(Xr, Xi, nf, nfft, fs * U, two).forEach((v, i) => { acc[i] += v / K; }); }
    if (nout === 0) { plotPSD(In, f, acc, hasFs, 'Welch Power Spectral Density Estimate'); return; }
    return [outCol(acc), outCol(f)];
  };

  L.spectrogram = (a, nout, In) => {
    const { sig, pos, flags } = parse(a, 'spectrogram'), n = sig.re.length;
    const w = windowArg(pos[0], Math.max(2, Math.floor(n / 4.5))), wl = w.length;
    if (wl > n) fail('spectrogram: the window is longer than the signal.');
    const nov = isEmpty(pos[1]) ? Math.floor(wl / 2) : Math.round(S(pos[1]));
    if (!(nov >= 0 && nov < wl)) fail('spectrogram: noverlap must be smaller than the window length.');
    let fvec = null, nfft;
    if (!isEmpty(pos[2]) && pos[2].n > 1) fvec = Array.from(pos[2].re); else nfft = isEmpty(pos[2]) ? Math.max(256, nextPow2(wl)) : Math.round(S(pos[2]));
    const hasFs = !isEmpty(pos[3]), fs = hasFs ? S(pos[3]) : 2 * Math.PI;
    const K = Math.floor((n - nov) / (wl - nov)), U = w.reduce((s, v) => s + v * v, 0), hop = wl - nov;
    const two = !!sig.im || flags.includes('twosided');
    let f, nf;
    if (fvec) { f = fvec; nf = f.length; } else ({ nf, f } = grid(nfft, fs, two));
    const Sre = new Float64Array(nf * K), Sim = new Float64Array(nf * K), P = new Mat(nf, K);
    for (let k = 0; k < K; k++) {
      In.tick();
      let Xr, Xi;
      if (fvec) { // Goertzel-style direct DFT at the requested frequencies
        Xr = new Float64Array(nf); Xi = new Float64Array(nf);
        for (let i = 0; i < nf; i++) { const om = 2 * Math.PI * f[i] / fs; let r = 0, im = 0; for (let j = 0; j < wl; j++) { const x = sig.re[k * hop + j] * w[j], y = sig.im ? sig.im[k * hop + j] * w[j] : 0, c = Math.cos(om * j), s = Math.sin(om * j); r += x * c + y * s; im += y * c - x * s; } Xr[i] = r; Xi[i] = im; }
      } else[Xr, Xi] = segFFT(sig.re, sig.im, k * hop, w, nfft);
      for (let i = 0; i < nf; i++) { Sre[i + k * nf] = Xr[i]; Sim[i + k * nf] = Xi[i]; }
      const p = fvec ? Array.from({ length: nf }, (_, i) => 2 * (Xr[i] * Xr[i] + Xi[i] * Xi[i]) / (fs * U)) : psdFrom(Xr, Xi, nf, nfft, fs * U, two);
      for (let i = 0; i < nf; i++) P.re[i + k * nf] = p[i];
    }
    const t = Array.from({ length: K }, (_, k) => (k * hop + wl / 2) / fs);
    if (nout === 0) {
      const G = In.lib, fx = hasFs ? f : f.map(v => v / Math.PI), tx = hasFs ? t : t.map(v => v * fs), dB = M.map(P, v => 10 * Math.log10(v + 1e-300));
      const fLab = hasFs ? 'Frequency (Hz)' : 'Normalized frequency (×π rad/sample)', tLab = hasFs ? 'Time (s)' : 'Samples';
      if (flags.includes('xaxis')) { G.imagesc([M.rowVec(fx), M.rowVec(tx), M.transpose(dB)], 0); G.xlabel([str(fLab)]); G.ylabel([str(tLab)]); }
      else { G.imagesc([M.rowVec(tx), M.rowVec(fx), dB], 0); G.xlabel([str(tLab)]); G.ylabel([str(fLab)]); }
      G.axis([str('xy')]); const cb = G.colorbar([], 0); void cb; G.title([str('Spectrogram (power/frequency, dB)')]);
      return;
    }
    const Sm = new Mat(nf, K, Sre, Sim);
    return [M.narrow ? M.narrow(Sm) : Sm, outCol(f), M.rowVec(t), P].slice(0, Math.max(1, nout));
  };

  // swept-frequency cosine: chirp(t, f0, t1, f1, method, phi)
  L.chirp = a => {
    const T = N(a[0]), nums = a.slice(1).filter(x => !isStr(x)), method = (a.slice(1).find(isStr) ? Str(a.slice(1).find(isStr)) : 'linear').toLowerCase();
    const g = (k, d) => nums[k] && nums[k].n ? S(nums[k]) : d, f0 = g(0, 0), t1 = g(1, 1), f1 = g(2, 100), phi = g(3, 0) * Math.PI / 180;
    if (!(t1 > 0)) fail('chirp: t1 must be positive.');
    let ph;
    if (method.startsWith('lin')) { const b = (f1 - f0) / t1; ph = t => 2 * Math.PI * (f0 * t + b / 2 * t * t); }
    else if (method.startsWith('quad')) { const b = (f1 - f0) / (t1 * t1); ph = t => 2 * Math.PI * (f0 * t + b / 3 * t * t * t); }
    else if (method.startsWith('log')) { if (!(f0 > 0 && f1 > 0)) fail("chirp: 'logarithmic' needs f0 > 0 and f1 > 0."); const b = Math.pow(f1 / f0, 1 / t1); ph = t => Math.abs(b - 1) < 1e-15 ? 2 * Math.PI * f0 * t : 2 * Math.PI * f0 * (Math.pow(b, t) - 1) / Math.log(b); }
    else fail(`chirp: unknown method '${method}'. Use 'linear', 'quadratic' or 'logarithmic'.`);
    return M.map(T, t => Math.cos(ph(t) + phi));
  };

  void num;
  const api = { hammingSym };
  if (node) module.exports = api; else root.LabSpectral = api;
})(typeof self !== 'undefined' ? self : this);
