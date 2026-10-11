'use strict';
/* Lumen Sound — synthesised demo material (no external files).
   Sample file: hiss-only intro (for noise profile), plucked arpeggio + bass + drums, a formant "voice", a click.
   Sample session: drums / bass / keys / voice clips on four tracks. */
window.Samples = (() => {
  const SR = 48000, TAU = Math.PI * 2;
  const rnd = DSP.rng(20240611);
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  function pinkNoise(n, amp, seed = 7) {
    const r = DSP.rng(seed), o = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) { const w = r(); b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; o[i] = (b0 + b1 + b2 + w * 0.1848) * amp * 0.25; }
    return o;
  }
  // Karplus-Strong pluck
  function pluck(out, start, midi, dur, amp, bright = 0.5, pan = 0) {
    const f = mtof(midi), P = Math.max(2, Math.round(SR / f)), buf = new Float32Array(P), r = DSP.rng(midi * 31 + start);
    for (let i = 0; i < P; i++) buf[i] = r() * (0.5 + bright * 0.5);
    const n = Math.round(dur * SR), gl = Math.cos((pan + 1) * Math.PI / 4), gr = Math.sin((pan + 1) * Math.PI / 4);
    let idx = 0, prev = 0;
    for (let i = 0; i < n && start + i < out[0].length; i++) {
      const cur = buf[idx], nx = buf[(idx + 1) % P], v = 0.5 * (cur + nx) * 0.996;
      buf[idx] = v; idx = (idx + 1) % P;
      const env = Math.min(1, i / 40) * (i > n - 2000 ? (n - i) / 2000 : 1);
      const s = (cur * 0.8 + prev * 0.2) * amp * env; prev = cur;
      out[0][start + i] += s * gl * 1.41; out[1][start + i] += s * gr * 1.41;
    }
  }
  function bass(out, start, midi, dur, amp) {
    const f = mtof(midi), n = Math.round(dur * SR); let ph = 0, lp = 0;
    for (let i = 0; i < n && start + i < out[0].length; i++) {
      ph += f / SR; const saw = 2 * (ph % 1) - 1, sq = Math.sin(TAU * ph);
      const env = Math.min(1, i / 200) * Math.exp(-i / SR * 2.2) * (i > n - 600 ? (n - i) / 600 : 1);
      const fc = 300 + 1600 * Math.exp(-i / SR * 8), a = Math.exp(-TAU * fc / SR);
      lp = (1 - a) * (saw * 0.6 + sq * 0.6) + a * lp;
      const s = lp * amp * env; out[0][start + i] += s; out[1][start + i] += s;
    }
  }
  function kick(out, start, amp) {
    let ph = 0; const n = Math.round(0.45 * SR);
    for (let i = 0; i < n && start + i < out[0].length; i++) { const t = i / SR, f = 45 + 110 * Math.exp(-t * 28); ph += f / SR; const s = Math.sin(TAU * ph) * Math.exp(-t * 7) * amp * Math.min(1, i / 30); out[0][start + i] += s; out[1][start + i] += s; }
  }
  function snare(out, start, amp) {
    const r = DSP.rng(start + 3), n = Math.round(0.25 * SR); let hp = 0, prev = 0, ph = 0;
    for (let i = 0; i < n && start + i < out[0].length; i++) { const t = i / SR, w = r(); hp = 0.85 * (hp + w - prev); prev = w; ph += 190 / SR; const s = (hp * 0.7 * Math.exp(-t * 18) + Math.sin(TAU * ph) * 0.5 * Math.exp(-t * 30)) * amp; out[0][start + i] += s * 0.95; out[1][start + i] += s; }
  }
  function hat(out, start, amp, open = false) {
    const r = DSP.rng(start + 11), n = Math.round((open ? 0.22 : 0.05) * SR); let hp = 0, prev = 0;
    for (let i = 0; i < n && start + i < out[0].length; i++) { const w = r(); hp = 0.6 * (hp + w - prev); prev = w; const s = hp * amp * Math.exp(-i / SR * (open ? 14 : 70)); out[0][start + i] += s * 0.8; out[1][start + i] += s * 1.1; }
  }
  // formant "voice": glottal pulses through three time-varying resonators, with syllable envelope and fricatives
  const VOW = { a: [730, 1090, 2440], e: [530, 1840, 2480], i: [270, 2290, 3010], o: [570, 840, 2410], u: [300, 870, 2240], ae: [660, 1720, 2410] };
  function voice(out, start, sylls, amp, pan = 0, f0base = 132) {
    let t = 0; const plan = [];
    for (const s of sylls) { plan.push({ t, ...s }); t += s.d + (s.gap || 0.05); }
    const n = Math.round(t * SR), src = new Float32Array(n), env = new Float32Array(n), F = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], fric = new Float32Array(n);
    let ph = 0; const r = DSP.rng(99);
    plan.forEach((s, k) => {
      const a = Math.round(s.t * SR), b = Math.round((s.t + s.d) * SR), v0 = VOW[s.v], v1 = VOW[s.to || s.v];
      for (let i = a; i < b && i < n; i++) {
        const u = (i - a) / (b - a);
        env[i] = Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 0.6 * (s.amp || 1);
        for (let j = 0; j < 3; j++) F[j][i] = v0[j] + (v1[j] - v0[j]) * (0.5 - 0.5 * Math.cos(Math.PI * u));
      }
      if (s.fric) { const fa = Math.max(0, a - Math.round(0.09 * SR)); for (let i = fa; i < a; i++) fric[i] = Math.sin(Math.PI * (i - fa) / (a - fa)) * 0.5; }
      void k;
    });
    for (let i = 0; i < n; i++) {
      const tt = i / SR, f0 = f0base * (1 + 0.12 * Math.sin(TAU * 0.6 * tt) - 0.08 * tt / t) * (1 + 0.006 * Math.sin(TAU * 5.5 * tt)) * (1 + 0.004 * r());
      ph += f0 / SR; const p = ph % 1;
      src[i] = (p < 0.6 ? Math.sin(Math.PI * p / 0.6) ** 2 : 0) - 0.3;   // Rosenberg-like pulse
    }
    // resonators (block-updated bandpass biquads)
    const y = new Float32Array(n), Bk = 64, gains = [1, 0.55, 0.3], qs = [7, 10, 12];
    for (let j = 0; j < 3; j++) {
      let z1 = 0, z2 = 0, c = null;
      for (let i = 0; i < n; i++) {
        if (i % Bk === 0) c = DSP.biquad('bandpass', F[j][i] || 500, qs[j], 0, SR);
        const v = src[i], o = c.b0 * v + z1; z1 = c.b1 * v - c.a1 * o + z2; z2 = c.b2 * v - c.a2 * o; y[i] += o * gains[j];
      }
    }
    // fricative noise (high-passed)
    let hp = 0, pv = 0;
    for (let i = 0; i < n; i++) { const w = r(); hp = 0.92 * (hp + w - pv); pv = w; y[i] = y[i] * env[i] * 2.2 + hp * fric[i] * 0.35; }
    const gl = Math.cos((pan + 1) * Math.PI / 4) * 1.41, gr = Math.sin((pan + 1) * Math.PI / 4) * 1.41;
    for (let i = 0; i < n && start + i < out[0].length; i++) { out[0][start + i] += y[i] * amp * gl; out[1][start + i] += y[i] * amp * gr; }
    return n;
  }
  const SENTENCE = [
    { v: 'ae', d: 0.2 }, { v: 'e', to: 'i', d: 0.22, fric: true }, { v: 'o', d: 0.26, gap: 0.12 },
    { v: 'u', to: 'a', d: 0.24 }, { v: 'a', d: 0.18 }, { v: 'i', d: 0.16, fric: true }, { v: 'e', to: 'o', d: 0.3, gap: 0.2 },
    { v: 'a', to: 'i', d: 0.24 }, { v: 'o', d: 0.2, fric: true }, { v: 'u', d: 0.34, amp: 0.8 }
  ];

  function demoFile() {
    const dur = 12, n = dur * SR, out = [new Float32Array(n), new Float32Array(n)];
    const mus = [new Float32Array(n), new Float32Array(n)], voc = [new Float32Array(n), new Float32Array(n)];
    const addNorm = (src, peakDb) => { const g = DSP.dbToLin(peakDb) / Math.max(1e-9, DSP.peak(src)); for (let c = 0; c < 2; c++) for (let i = 0; i < n; i++) out[c][i] += src[c][i] * g; };
    const bpm = 112, beat = 60 / bpm, t0 = 1.1;
    // music: 2 bars arpeggio + bass + drums
    const chords = [[57, 60, 64, 69], [53, 57, 60, 65], [55, 59, 62, 67], [52, 55, 59, 64]];
    for (let bar = 0; bar < 2; bar++) for (let q = 0; q < 8; q++) {
      const ch = chords[(bar * 2 + (q >> 2)) % 4], t = t0 + (bar * 8 + q) * beat / 2;
      pluck(mus, Math.round(t * SR), ch[q % 4] + 12, beat * 1.6, 0.42, 0.7, (q % 2 ? 0.45 : -0.45));
    }
    for (let k = 0; k < 4; k++) bass(mus, Math.round((t0 + k * beat * 2) * SR), chords[k][0] - 12, beat * 1.9, 0.38);
    for (let b = 0; b < 8; b++) { const t = t0 + b * beat; kick(mus, Math.round(t * SR), 0.5); if (b % 2) snare(mus, Math.round(t * SR), 0.34); hat(mus, Math.round((t + beat / 2) * SR), 0.16); hat(mus, Math.round(t * SR), 0.1); }
    addNorm(mus, -3);
    // voice
    voice(voc, Math.round(6.1 * SR), SENTENCE, 0.27, 0.05);
    addNorm(voc, -5);
    // hiss throughout
    const hissL = pinkNoise(n, 0.011, 5), hissR = pinkNoise(n, 0.011, 9);
    for (let i = 0; i < n; i++) { out[0][i] += hissL[i]; out[1][i] += hissR[i]; }
    // hum-free click (vinyl-style) at 10.42 s
    const c = Math.round(10.42 * SR); [0.85, -0.6, 0.35, -0.12].forEach((v, k) => { out[0][c + k] += v; out[1][c + k] += v * 0.92; });
    // tail fade
    for (let i = n - SR / 2; i < n; i++) { const g = (n - i) / (SR / 2); out[0][i] *= g; out[1][i] *= g; }
    const markers = [{ time: 0.05, label: 'Noise only' }, { time: t0, label: 'Music' }, { time: 6.1, label: 'Voice' }, { time: 10.42, label: 'Click' }];
    return { name: 'Lumen Sample', sr: SR, chs: out, markers };
  }

  function sessionSources() {
    const bpm = 100, beat = 60 / bpm, bars = 4, len = Math.round(bars * 4 * beat * SR);
    const mk = () => [new Float32Array(len), new Float32Array(len)];
    const drums = mk();
    for (let b = 0; b < bars * 4; b++) {
      const t = Math.round(b * beat * SR); kick(drums, t, 0.7); if (b % 2) snare(drums, t, 0.4);
      for (let h = 0; h < 2; h++) hat(drums, t + Math.round(h * beat / 2 * SR), h ? 0.14 : 0.1, b % 4 === 3 && h);
      if (b % 4 === 2) kick(drums, t + Math.round(beat * 0.75 * SR), 0.45);
    }
    const prog = [[45, 57, 60, 64], [41, 53, 57, 60], [48, 55, 60, 64], [43, 55, 59, 62]];
    const bassT = mk();
    for (let bar = 0; bar < bars; bar++) for (let e = 0; e < 8; e++) { const m = prog[bar][0] + (e === 6 ? 7 : e === 7 ? 12 : 0); bass(bassT, Math.round((bar * 4 + e / 2) * beat * SR), m, beat * 0.45, 0.42); }
    const keys = mk();
    for (let bar = 0; bar < bars; bar++) for (let k = 1; k < 4; k++) for (let rep = 0; rep < 4; rep++) pluck(keys, Math.round((bar * 4 + rep + (k - 1) * 0.12) * beat * SR), prog[bar][k] + 12, beat * 1.2, 0.26, 0.4, (k - 2) * 0.5);
    const vlen = Math.round(4.6 * SR), vo = [new Float32Array(vlen), new Float32Array(vlen)];
    voice(vo, Math.round(0.1 * SR), SENTENCE, 0.3, 0, 120);
    const norm = (chs, db) => { const g = DSP.dbToLin(db) / Math.max(1e-9, DSP.peak(chs)); chs.forEach(c => { for (let i = 0; i < c.length; i++) c[i] *= g; }); return chs; };
    norm(drums, -4); norm(bassT, -7); norm(keys, -8); norm(vo, -5);
    return { bpm, beat, srcs: [
      { name: 'Drum Loop', chs: drums }, { name: 'Bass Line', chs: bassT }, { name: 'Keys', chs: keys }, { name: 'Voice', chs: vo }
    ] };
  }

  /* podcast demo: two speakers (with room hiss + hum, so the cleanup chain has work to do) and a music bed */
  function podcastSources() {
    const dur = 18, n = dur * SR, mk = () => [new Float32Array(n), new Float32Array(n)];
    const host = mk(), guest = mk(), music = mk();
    voice(host, Math.round(0.6 * SR), SENTENCE, 0.3, 0, 116); voice(host, Math.round(9.4 * SR), SENTENCE.slice(2), 0.28, 0, 112);
    const SENT2 = SENTENCE.slice().reverse().map(s => ({ ...s, gap: (s.gap || 0.05) + 0.02 }));
    voice(guest, Math.round(4.9 * SR), SENT2, 0.3, 0, 190); voice(guest, Math.round(14.0 * SR), SENTENCE.slice(0, 6), 0.3, 0, 182);
    const norm = (chs, db) => { const g = DSP.dbToLin(db) / Math.max(1e-9, DSP.peak(chs)); chs.forEach(c => { for (let i = 0; i < c.length; i++) c[i] *= g; }); return chs; };
    norm(host, -6); norm(guest, -6);
    [host, guest].forEach((t, k) => { const h = pinkNoise(n, 0.006, 21 + k); for (let i = 0; i < n; i++) { const hum = 0.004 * Math.sin(TAU * 50 * i / SR); t[0][i] += h[i] + hum; t[1][i] += h[i] + hum; } });
    const bpm = 92, beat = 60 / bpm, prog = [[45, 57, 60, 64], [41, 53, 57, 60], [48, 55, 60, 64], [43, 55, 59, 62]];
    for (let bar = 0; bar * 4 * beat < dur; bar++) {
      const ch = prog[bar % 4];
      for (let q = 0; q < 8; q++) pluck(music, Math.round((bar * 4 + q / 2) * beat * SR), ch[1 + q % 3] + 12, beat * 1.4, 0.22, 0.45, q % 2 ? 0.4 : -0.4);
      bass(music, Math.round(bar * 4 * beat * SR), ch[0] - 12, beat * 3.8, 0.3);
    }
    norm(music, -8);
    for (let i = n - SR * 2; i < n; i++) { const g = (n - i) / (SR * 2); music[0][i] *= g; music[1][i] *= g; }
    return [{ name: 'Host Mic', chs: host }, { name: 'Guest Mic', chs: guest }, { name: 'Music Bed', chs: music }];
  }

  return { SR, demoFile, sessionSources, podcastSources, pinkNoise };
})();
