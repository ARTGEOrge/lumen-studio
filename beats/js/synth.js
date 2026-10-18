'use strict';
/* Lumen Beats — built-in instruments, all generated with Web Audio nodes (work in AudioContext and OfflineAudioContext):
   subtractive synth, 2-operator FM synth, synthesized drum voices (no samples), sampler for user WAV/MP3.
   Every voice: play(ctx, out, P, pitch, vel, t0, dur, st) → {release(t), kill(t), end, t0}. dur = null → held (live) note. */
(function (root) {
  const C = root.Core;
  const res = new WeakMap();
  function R(ctx) {
    let r = res.get(ctx); if (r) return r;
    const sr = ctx.sampleRate, n = Math.round(sr * 2), noise = ctx.createBuffer(1, n, sr), d = noise.getChannelData(0), g = C.rng(1234);
    for (let i = 0; i < n; i++) d[i] = g() * 2 - 1;
    const soft = new Float32Array(2049); for (let i = 0; i < soft.length; i++) { const x = i / 1024 - 1; soft[i] = Math.tanh(x * 3) / Math.tanh(3); }
    r = { noise, soft, rev: new WeakMap(), metal: null }; res.set(ctx, r); return r;
  }
  const hz = p => 440 * Math.pow(2, (p - 69) / 12);
  // biquad coefficients are recomputed per sample when a-rate params are automated — control rate (128 frames) is plenty
  const kr = f => { for (const k of ['frequency', 'detune', 'Q', 'gain']) try { f[k].automationRate = 'k-rate'; } catch (e) { } return f; };
  const velAmp = (P, v) => P.gain * (1 - P.vs + P.vs * v / 127);

  /* ---- envelopes. Scheduled notes know their release time up front → exact analytic values, no cancel. ---- */
  function envValue(t, A, D, S, peak) { if (t <= 0) return 0; if (t < A) return peak * t / A; return S * peak + (peak - S * peak) * Math.exp(-(t - A) / (D / 4)); }
  function envAttack(param, t0, A, D, S, peak, tr) {
    param.setValueAtTime(0, t0);
    if (tr != null && tr < t0 + A) { param.linearRampToValueAtTime(envValue(tr - t0, A, D, S, peak), tr); return; }
    param.linearRampToValueAtTime(peak, t0 + A);
    param.setTargetAtTime(S * peak, t0 + A, D / 4);
    if (tr != null) param.setValueAtTime(envValue(tr - t0, A, D, S, peak), tr);
  }
  function envRelease(param, t0, tr, A, D, S, R, peak, live) {
    if (live) {   // release of a held note: hold whatever value the envelope has now
      if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(tr); else { param.cancelScheduledValues(tr); param.setValueAtTime(envValue(tr - t0, A, D, S, peak), tr); }
    }
    param.setTargetAtTime(0, tr, R / 5);
    return tr + R * 1.15;
  }
  function makeVoice(t0, tr, P, nodes, envs, live) {
    // envs: [{param, A, D, S, R, peak}] ; nodes: sources to stop
    const v = { t0, end: Infinity, nodes, envs, released: false };
    v.release = t => {
      if (v.released) return v.end; v.released = true; t = Math.max(t, t0 + 0.001); let end = t;
      for (const e of envs) end = Math.max(end, envRelease(e.param, t0, t, e.A, e.D, e.S, e.R, e.peak, live));
      v.end = end; for (const s of nodes) try { s.stop(end + 0.01); } catch (x) { }
      return end;
    };
    v.kill = t => { // fast fade (stop / choke)
      if (v.out) { v.out.gain.cancelScheduledValues(t); v.out.gain.setTargetAtTime(0, t, 0.004); }
      for (const s of nodes) try { s.stop(Math.max(t, t0) + 0.04); } catch (x) { }
      v.end = Math.min(v.end, t + 0.04);
    };
    if (tr != null) v.release(tr);
    return v;
  }
  function osc(ctx, type, f, t0) { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t0); return o; }
  function noiseSrc(ctx, t0) { const s = ctx.createBufferSource(); s.buffer = R(ctx).noise; s.loop = true; s.loopEnd = s.buffer.duration; const off = (t0 * 7919.123) % 1.9; s.start(t0, off); return s; }

  /* ---------------- subtractive ---------------- */
  function sub(ctx, out, P, p, vel, t0, dur, st) {
    const live = dur == null, tr = live ? null : t0 + dur;
    const f = hz(p), outG = ctx.createGain(); outG.gain.value = 1;
    const amp = ctx.createGain(); amp.gain.value = 0;
    const filt = kr(ctx.createBiquadFilter()); filt.type = P.ft; filt.Q.value = P.res;
    const base = C.clamp(P.cut * Math.pow(2, P.fkey * (p - 60) / 12), 20, ctx.sampleRate * 0.45); filt.frequency.value = base;
    const mix = ctx.createGain(); mix.gain.value = 0.42;
    const srcs = [], pitchParams = [];
    const from = st && P.glide > 0 && st.lastPitch != null ? hz(st.lastPitch) : f;
    if (st) st.lastPitch = p;
    [[P.o1w, P.o1o, P.o1s, P.o1d, P.o1l], [P.o2w, P.o2o, P.o2s, P.o2d, P.o2l]].forEach(([w, o, s, d, l]) => {
      if (l <= 0) return;
      const m = Math.pow(2, o + s / 12), o1 = osc(ctx, w, from * m, t0); o1.detune.value = d;
      if (from !== f) o1.frequency.exponentialRampToValueAtTime(f * m, t0 + P.glide);
      const g = ctx.createGain(); g.gain.value = l; o1.connect(g); g.connect(mix); o1.start(t0); srcs.push(o1); pitchParams.push(o1.detune);
    });
    if (P.noise > 0) { const n = noiseSrc(ctx, t0), g = ctx.createGain(); g.gain.value = P.noise * 0.6; n.connect(g); g.connect(mix); srcs.push(n); }
    mix.connect(filt); filt.connect(amp);
    let last = amp;
    const peak = velAmp(P, vel);
    const envs = [{ param: amp.gain, A: P.aA, D: P.aD, S: P.aS, R: P.aR, peak }];
    if (Math.abs(P.fenv) > 0.001) { filt.detune.value = 0; envs.push({ param: filt.detune, A: P.fA, D: P.fD, S: P.fS, R: P.fR, peak: P.fenv * 7200 }); }
    for (const e of envs) envAttack(e.param, t0, e.A, e.D, e.S, e.peak, tr);
    if (P.la > 0) {
      const l = osc(ctx, P.lw, P.lr, t0), lg = ctx.createGain(); l.connect(lg); l.start(t0); srcs.push(l);
      if (P.ld === 'pitch') { lg.gain.value = P.la * 100; pitchParams.forEach(pp => lg.connect(pp)); }
      else if (P.ld === 'cutoff') { lg.gain.value = P.la * 3600; lg.connect(filt.detune); }
      else if (P.ld === 'amp') { const tg = ctx.createGain(); tg.gain.value = 1 - P.la / 2; lg.gain.value = P.la / 2; lg.connect(tg.gain); last.connect(tg); last = tg; }
      else if (P.ld === 'pan' && ctx.createStereoPanner) { const pn = ctx.createStereoPanner(); pn.pan.value = 0; lg.gain.value = P.la; lg.connect(pn.pan); last.connect(pn); last = pn; }
    }
    last.connect(outG); outG.connect(out);
    const v = makeVoice(t0, null, P, srcs, envs, live); v.out = outG;
    if (!live) v.release(tr);
    return v;
  }

  /* ---------------- FM ---------------- */
  function fm(ctx, out, P, p, vel, t0, dur) {
    const live = dur == null, tr = live ? null : t0 + dur, f = hz(p);
    const outG = ctx.createGain(), amp = ctx.createGain(); amp.gain.value = 0;
    const car = osc(ctx, 'sine', f * P.cr, t0), m1 = osc(ctx, 'sine', f * P.m1r, t0), m2 = osc(ctx, 'sine', f * P.m2r, t0);
    const vk = 1 - P.vi + P.vi * vel / 127;
    const g1 = ctx.createGain(), g2 = ctx.createGain(); g1.gain.value = 0; g2.gain.value = 0;
    m1.connect(g1); g1.connect(car.frequency); m2.connect(g2); g2.connect(P.alg === 'stack' ? m1.frequency : car.frequency);
    car.connect(amp); amp.connect(outG); outG.connect(out);
    const srcs = [car, m1, m2]; srcs.forEach(s => s.start(t0));
    const peak = velAmp(P, vel) * 0.7;
    const i1 = P.m1i * f * P.m1r * vk, i2 = P.m2i * f * P.m2r * vk;
    const envs = [{ param: amp.gain, A: P.aA, D: P.aD, S: P.aS, R: P.aR, peak }, { param: g1.gain, A: 0.001, D: P.m1d, S: P.m1s, R: P.aR, peak: i1 }, { param: g2.gain, A: 0.001, D: P.m2d, S: 0, R: P.aR, peak: i2 }];
    for (const e of envs) envAttack(e.param, t0, e.A, e.D, e.S, e.peak, tr);
    const v = makeVoice(t0, null, P, srcs, envs, live); v.out = outG; if (!live) v.release(tr);
    return v;
  }

  /* ---------------- drums (one-shot) ---------------- */
  const METAL = [205.3, 304.4, 369.6, 522.7, 540, 800];   // the classic six detuned square waves of an analog hi-hat
  function metalBuf(ctx) {   // pre-mixed once per context: one buffer source per hit instead of six oscillators
    const r = R(ctx); if (r.metal) return r.metal;
    const sr = ctx.sampleRate, n = Math.round(sr * 6), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    const ph = METAL.map((f, i) => i * 0.137);
    for (let i = 0; i < n; i++) { let x = 0; for (let k = 0; k < 6; k++) x += ((ph[k] + i * METAL[k] / sr) % 1) < 0.5 ? 1 : -1; d[i] = x / 6; }
    return (r.metal = b);
  }
  function drum(ctx, out, P, p, vel, t0, dur, st) {
    const r = R(ctx), tf = Math.pow(2, (P.tune + (p - 60)) / 12), dm = P.decay, k = P.kind;
    const outG = ctx.createGain(); outG.gain.value = velAmp(P, vel);
    let dest = outG;
    if (P.drive > 0) { const pre = ctx.createGain(); pre.gain.value = 1 + P.drive * 6; const ws = ctx.createWaveShaper(); ws.curve = r.soft; const post = ctx.createGain(); post.gain.value = 1 / (1 + P.drive * 1.5); pre.connect(ws); ws.connect(post); post.connect(outG); dest = pre; }
    outG.connect(out);
    const srcs = []; let end = t0;
    const decayEnv = (g, peak, tau, at = t0, attack = 0.0015) => { g.gain.value = 0; g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(peak, at + attack); g.gain.setTargetAtTime(0, at + attack, tau); end = Math.max(end, at + attack + tau * 7); };
    const nz = (filters, peak, tau, at) => { const n = noiseSrc(ctx, at || t0), g = ctx.createGain(); let x = n; for (const [type, fq, q] of filters) { const b = kr(ctx.createBiquadFilter()); b.type = type; b.frequency.value = fq; if (q) b.Q.value = q; x.connect(b); x = b; } x.connect(g); g.connect(dest); decayEnv(g, peak, tau, at); srcs.push(n); return g; };
    const tone = (type, f0, f1, sweep, peak, tau) => { const o = osc(ctx, type, f0, t0), g = ctx.createGain(); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + sweep); o.connect(g); g.connect(dest); o.start(t0); decayEnv(g, peak, tau); srcs.push(o); };
    const metal = (bpf, hpf, peak, tau, scale) => {
      const mix = ctx.createGain(); mix.gain.value = 1;
      const m = ctx.createBufferSource(); m.buffer = metalBuf(ctx); m.playbackRate.value = scale; m.connect(mix); m.start(t0); srcs.push(m);
      end = Math.min(end, t0 + m.buffer.duration / scale);
      const b = kr(ctx.createBiquadFilter()); b.type = 'bandpass'; b.frequency.value = bpf; b.Q.value = 0.9;
      const h = kr(ctx.createBiquadFilter()); h.type = 'highpass'; h.frequency.value = hpf;
      const g = ctx.createGain(); mix.connect(b); b.connect(h); h.connect(g); g.connect(dest); decayEnv(g, peak, tau, t0, 0.0008);
      end = Math.min(end, t0 + m.buffer.duration / scale);
    };
    if (k === 'kick') {
      const f1 = 48 * tf, f0 = f1 * (2.6 + P.tone * 4);
      tone('sine', f0, f1, 0.03 + 0.06 * (1 - P.snap), 1, 0.11 * dm);
      if (P.snap > 0) nz([['highpass', 1800]], 0.35 * P.snap, 0.004);
    } else if (k === 'snare') {
      tone('triangle', 200 * tf, 165 * tf, 0.05, 0.75 - P.tone * 0.4, 0.05 * dm);
      nz([['highpass', 900 + P.tone * 2200], ['peaking', 5000, 1]], 0.35 + P.snap * 0.5, (0.04 + 0.08 * P.snap) * dm);
    } else if (k === 'clap') {
      const bp = [['bandpass', 1100 * tf * (0.8 + P.tone * 0.6), 1.6]];
      for (let i = 0; i < 3; i++) nz(bp, 0.9, 0.0045, t0 + i * 0.0105);
      nz(bp, 0.8, (0.05 + P.snap * 0.08) * dm, t0 + 0.0315);
    } else if (k === 'hat' || k === 'ohat') {
      const tau = (k === 'hat' ? 0.022 : 0.17) * dm;
      metal(9000 + P.tone * 3000, 7000, 1.1, tau, tf * (1 + P.tone * 0.3));
      if (P.snap > 0) nz([['highpass', 8000]], 0.25 * P.snap, tau * 0.8);
    } else if (k === 'tom') {
      const f0 = 110 * tf * (1 + P.tone);
      tone('sine', f0 * 1.5, f0, 0.08, 0.9, 0.14 * dm);
      if (P.snap > 0) nz([['bandpass', 2500, 1]], 0.2 * P.snap, 0.01);
    } else if (k === 'rim') {
      tone('triangle', 1700 * tf, 1600 * tf, 0.01, 0.6, 0.008 * dm);
      nz([['bandpass', 3200 * tf, 2]], 0.6 + 0.4 * P.snap, 0.012 * dm);
    } else if (k === 'cow') {
      const mix = ctx.createGain(), b = kr(ctx.createBiquadFilter()); b.type = 'bandpass'; b.frequency.value = 800 * tf; b.Q.value = 1.5 + P.tone * 3; mix.gain.value = 0.5;
      [540, 800].forEach(fq => { const o = osc(ctx, 'square', fq * tf, t0); o.connect(mix); o.start(t0); srcs.push(o); });
      const g = ctx.createGain(); mix.connect(b); b.connect(g); g.connect(dest); decayEnv(g, 1.6, 0.075 * dm);
    } else if (k === 'crash') {
      metal(7000 + P.tone * 4000, 4500, 0.9, 0.55 * dm, tf * 1.4);
      nz([['highpass', 5000]], 0.45 + 0.3 * P.snap, 0.6 * dm);
    }
    for (const s of srcs) try { s.stop(end + 0.02); } catch (x) { }
    const v = { t0, end, nodes: srcs, out: outG, released: true, release: () => v.end };
    v.kill = t => { outG.gain.cancelScheduledValues(t); outG.gain.setValueAtTime(outG.gain.value, t); outG.gain.setTargetAtTime(0, t, 0.005); for (const s of srcs) try { s.stop(Math.max(t, t0) + 0.05); } catch (x) { } v.end = Math.min(v.end, t + 0.05); };
    // choke groups: a new hit silences ringing voices of the same group
    if (P.choke && st && st.choke) {
      const g = st.choke[P.choke] || (st.choke[P.choke] = []);
      for (const o of g) if (o.t0 < t0 && o.end > t0) o.kill(t0);
      g.push(v); while (g.length > 16) g.shift();
    }
    return v;
  }

  /* ---------------- sampler ---------------- */
  function reversed(ctx, buf) {
    const r = R(ctx); let x = r.rev.get(buf); if (x) return x;
    x = ctx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) { const s = buf.getChannelData(c), d = x.getChannelData(c); for (let i = 0, n = s.length; i < n; i++) d[i] = s[n - 1 - i]; }
    r.rev.set(buf, x); return x;
  }
  function sampler(ctx, out, P, p, vel, t0, dur, st, buf) {
    if (!buf) return null;
    const live = dur == null;
    const src = ctx.createBufferSource(); src.buffer = P.rev ? reversed(ctx, buf) : buf;
    const rate = Math.pow(2, (P.track ? (p - P.root) / 12 : 0) + P.tune / 1200); src.playbackRate.value = rate;
    const off = P.start * buf.duration;
    if (P.loop) { src.loop = true; src.loopStart = off; src.loopEnd = buf.duration; }
    const filt = kr(ctx.createBiquadFilter()); filt.type = 'lowpass'; filt.frequency.value = Math.min(P.cut, ctx.sampleRate * 0.45); filt.Q.value = 0.7;
    const amp = ctx.createGain(), outG = ctx.createGain(); amp.gain.value = 0;
    src.connect(filt); filt.connect(amp); amp.connect(outG); outG.connect(out); src.start(t0, off);
    const natural = (buf.duration - off) / rate;
    let tr = live ? null : t0 + dur;
    if (P.oneshot && !P.loop) tr = t0 + natural;
    else if (!P.loop && tr != null) tr = Math.min(tr, t0 + natural);
    const peak = velAmp(P, vel);
    const envs = [{ param: amp.gain, A: P.aA, D: P.aD, S: P.aS, R: P.aR, peak }];
    envAttack(amp.gain, t0, P.aA, P.aD, P.aS, peak, tr);
    const v = makeVoice(t0, null, P, [src], envs, live && !P.oneshot); v.out = outG;
    if (tr != null) v.release(tr);
    if (!P.loop) { try { src.stop(Math.min(v.end, t0 + natural) + 0.01); } catch (x) { } }
    return v;
  }

  const Synth = { R, hz, envValue, play: { sub, fm, drum, sampler } };
  root.Synth = Synth;
})(typeof window !== 'undefined' ? window : globalThis);
