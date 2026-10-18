'use strict';
/* Lumen Beats — mixer effects built from Web Audio nodes. create(ctx, fx, bpm) → {input, output, set(p, bpm), param(k) → [AudioParam, map]}.
   EQ (3-band), compressor, filter, tempo delay (ping-pong), reverb (generated impulse), distortion, chorus. */
(function (root) {
  const C = root.Core;
  const irCache = new Map();
  // stereo impulse: decorrelated noise, 60 dB decay over `size` seconds, damping that darkens the tail over time
  function impulse(ctx, size, damp) {
    const sr = ctx.sampleRate, key = `${sr}|${size.toFixed(3)}|${Math.round(damp)}`;
    if (irCache.has(key)) return irCache.get(key);
    const n = Math.max(1, Math.round(sr * size)), buf = ctx.createBuffer(2, n, sr);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c), g = C.rng(9001 + c * 77); let lp = 0, e = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr, fc = 18000 * Math.pow(damp / 18000, Math.min(1, t / size * 1.5));
        const a = 1 - Math.exp(-2 * Math.PI * fc / sr);
        lp += a * ((g() * 2 - 1) - lp);
        const early = i < sr * 0.08 && g() < 0.002 ? (g() * 2 - 1) * 3 : 0;
        d[i] = (lp + early) * Math.exp(-6.91 * t / size) * Math.min(1, i / (sr * 0.002));
        e += d[i] * d[i];
      }
      const k = 1 / Math.sqrt(e || 1); for (let i = 0; i < n; i++) d[i] *= k;
    }
    if (irCache.size > 24) irCache.delete(irCache.keys().next().value);
    irCache.set(key, buf); return buf;
  }
  const curves = {};
  function curve(mode) {
    if (curves[mode]) return curves[mode];
    const n = 4096, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1) * 2 - 1;
      c[i] = mode === 'hard' ? Math.max(-0.8, Math.min(0.8, x)) / 0.8 : mode === 'fold' ? Math.sin(x * Math.PI * 1.5) : mode === 'bit' ? Math.round(x * 12) / 12 : Math.tanh(x * 2.2) / Math.tanh(2.2);
    }
    return (curves[mode] = c);
  }
  const kr = f => { for (const k of ['frequency', 'detune', 'Q', 'gain']) try { f[k].automationRate = 'k-rate'; } catch (e) { } return f; };
  const wetDry = (ctx, input, output, wetNode) => { const dry = ctx.createGain(), wet = ctx.createGain(); input.connect(dry); dry.connect(output); wetNode.connect(wet); wet.connect(output); return { dry, wet }; };
  const setMix = (wd, m) => { wd.dry.gain.value = Math.min(1, 2 * (1 - m)); wd.wet.gain.value = Math.min(1, 2 * m); };
  const smooth = (param, v, ctx) => { if (Math.abs(param.value - v) < 1e-9) return; param.setTargetAtTime(v, ctx.currentTime, 0.012); };

  function create(ctx, fx, bpm) {
    const input = ctx.createGain(), output = ctx.createGain(), P = fx.p;
    const api = { input, output, maps: {}, cur: P };
    const map = (k, param, fn = v => v) => { api.maps[k] = [param, fn]; };
    switch (fx.type) {
      case 'eq': {
        const lo = kr(ctx.createBiquadFilter()), mid = kr(ctx.createBiquadFilter()), hi = kr(ctx.createBiquadFilter());
        lo.type = 'lowshelf'; mid.type = 'peaking'; hi.type = 'highshelf';
        input.connect(lo); lo.connect(mid); mid.connect(hi); hi.connect(output);
        map('lg', lo.gain); map('lf', lo.frequency); map('mg', mid.gain); map('mf', mid.frequency); map('mq', mid.Q); map('hg', hi.gain); map('hf', hi.frequency);
        break;
      }
      case 'comp': {
        const c = ctx.createDynamicsCompressor(), mk = ctx.createGain(); input.connect(c); c.connect(mk); mk.connect(output);
        // Web Audio's compressor adds automatic make-up gain (spec: (1/fullRangeGain)^0.6); cancel it so Make-up is explicit
        const auto = () => { const T = api.cur.th, Rr = api.cur.ra, full = T * (1 - 1 / Rr); return -0.6 * full; };
        map('th', c.threshold); map('ra', c.ratio); map('kn', c.knee); map('at', c.attack); map('re', c.release); map('mk', mk.gain, v => C.dbToGain(v - auto()));
        api.after = k => { if (k === 'th' || k === 'ra') api.set('mk', api.cur.mk); };
        api.reduction = () => c.reduction;
        break;
      }
      case 'filter': {
        const f = kr(ctx.createBiquadFilter()); f.type = P.type; input.connect(f); f.connect(output);
        map('f', f.frequency, v => Math.min(v, ctx.sampleRate * 0.45)); map('q', f.Q);
        break;
      }
      case 'delay': {
        // Web Audio adds one render quantum (128 frames) to every trip around a feedback cycle, so the loop delays are
        // set 128 frames short and the signal enters the loop through an exact 128-frame pre-delay → echoes land on n·T exactly.
        const q = 128 / ctx.sampleRate, merge = ctx.createChannelMerger(2), wetBus = ctx.createGain();
        const lp = () => { const f = kr(ctx.createBiquadFilter()); f.type = 'lowpass'; f.Q.value = 0.5; return f; };
        const taps = [], loops = [], full = [], tones = [], fbs = [];
        const stage = (src, outCh) => { const d = ctx.createDelay(4), f = lp(); src.connect(d); d.connect(f); f.connect(merge, 0, outCh); taps.push(d); tones.push(f); return f; };
        const gain = () => { const g = ctx.createGain(); fbs.push(g); return g; };
        if (P.pp) {   // mono sum → L (T) → R (2T) → L (3T) …
          const sum = ctx.createGain(); sum.channelCount = 1; sum.channelCountMode = 'explicit'; input.connect(sum);
          const f1 = stage(sum, 0), g1 = gain(), pre = ctx.createDelay(1); pre.delayTime.value = q; f1.connect(g1); g1.connect(pre);
          const dR = ctx.createDelay(4), fR = lp(), gR = gain(), dL = ctx.createDelay(4), fL = lp(), gL = gain();
          pre.connect(dR); dR.connect(fR); fR.connect(merge, 0, 1); fR.connect(gR); gR.connect(dL); dL.connect(fL); fL.connect(merge, 0, 0); fL.connect(gL); gL.connect(dR);
          loops.push(dR); full.push(dL); tones.push(fR, fL);   // one 128-frame quantum per round trip: compensate one leg
        } else {
          const split = ctx.createChannelSplitter(2); input.connect(split);
          for (const c of [0, 1]) {
            const one = ctx.createGain(); one.channelCount = 1; one.channelCountMode = 'explicit'; split.connect(one, c);
            const f1 = stage(one, c), g1 = gain(), pre = ctx.createDelay(1); pre.delayTime.value = q; f1.connect(g1); g1.connect(pre);
            const dl = ctx.createDelay(4), fl = lp(), gl = gain(); pre.connect(dl); dl.connect(fl); fl.connect(merge, 0, c); fl.connect(gl); gl.connect(dl);
            loops.push(dl); tones.push(fl);
          }
        }
        merge.connect(wetBus);
        const wd = wetDry(ctx, input, output, wetBus);
        api.setTime = b => { const s = Math.min(3.9, api.cur.time * 60 / b); taps.forEach(d => d.delayTime.value = s); full.forEach(d => d.delayTime.value = s); loops.forEach(d => d.delayTime.value = Math.max(q, s - q)); };
        api.setTime(bpm);
        api.maps.fb = [{ multi: fbs.map(g => g.gain) }, v => v];
        api.maps.tone = [{ multi: tones.map(f => f.frequency) }, v => Math.min(v, ctx.sampleRate * 0.45)];
        api.maps.mix = [{ multi: [wd.dry.gain, wd.wet.gain] }, null, m => [Math.min(1, 2 * (1 - m)), Math.min(1, 2 * m)]];
        break;
      }
      case 'reverb': {
        const pre = ctx.createDelay(1), conv = ctx.createConvolver(); conv.normalize = false; conv.buffer = impulse(ctx, P.size, P.damp);
        input.connect(pre); pre.connect(conv);
        const wd = wetDry(ctx, input, output, conv);
        map('pre', pre.delayTime);
        api.maps.mix = [{ multi: [wd.dry.gain, wd.wet.gain] }, null, m => [Math.min(1, 2 * (1 - m)), Math.min(1, 2 * m)]];
        break;
      }
      case 'dist': {
        const pre = ctx.createGain(), ws = ctx.createWaveShaper(), tone = kr(ctx.createBiquadFilter()), post = ctx.createGain();
        ws.curve = curve(P.mode); ws.oversample = P.mode === 'bit' ? 'none' : '4x'; tone.type = 'lowpass'; tone.Q.value = 0.5;
        input.connect(pre); pre.connect(ws); ws.connect(tone); tone.connect(post);
        const wd = wetDry(ctx, input, output, post);
        map('drive', pre.gain, C.dbToGain); map('tone', tone.frequency, v => Math.min(v, ctx.sampleRate * 0.45)); map('out', post.gain, C.dbToGain);
        api.maps.mix = [{ multi: [wd.dry.gain, wd.wet.gain] }, null, m => [Math.min(1, 2 * (1 - m)), Math.min(1, 2 * m)]];
        break;
      }
      case 'chorus': {
        const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2), d1 = ctx.createDelay(0.1), d2 = ctx.createDelay(0.1);
        const lfo = ctx.createOscillator(), g1 = ctx.createGain(), g2 = ctx.createGain(), base = ctx.createConstantSource();
        input.connect(split); split.connect(d1, 0); split.connect(d2, 1); d1.connect(merge, 0, 0); d2.connect(merge, 0, 1);
        d1.delayTime.value = 0; d2.delayTime.value = 0;
        base.connect(d1.delayTime); base.connect(d2.delayTime); lfo.connect(g1); lfo.connect(g2); g1.connect(d1.delayTime); g2.connect(d2.delayTime);
        lfo.start(0); base.start(0);
        const wd = wetDry(ctx, input, output, merge);
        map('rate', lfo.frequency); map('dly', base.offset);
        api.maps.depth = [{ multi: [g1.gain, g2.gain] }, null, d => [d * api.cur.dly * 0.9, -d * api.cur.dly * 0.9]];
        api.maps.mix = [{ multi: [wd.dry.gain, wd.wet.gain] }, null, m => [Math.min(1, 2 * (1 - m)), Math.min(1, 2 * m)]];
        api.stop = () => { try { lfo.stop(); base.stop(); } catch (e) { } };
        break;
      }
      default: input.connect(output);
    }
    // apply a document value to the nodes (immediate = no smoothing, for offline / build time)
    api.set = (k, v, immediate) => {
      const m = api.maps[k]; if (!m) return;
      const [p, fn, multiFn] = m;
      if (p.multi) {
        const vals = multiFn ? multiFn(v) : p.multi.map(() => fn(v));
        p.multi.forEach((pp, i) => immediate ? (pp.value = vals[i]) : smooth(pp, vals[i], ctx));
      } else { const x = fn(v); immediate ? (p.value = x) : smooth(p, x, ctx); }
      api.after?.(k);
    };
    // automation: list of [AudioParam, value → param value]
    api.params = k => {
      const m = api.maps[k]; if (!m) return [];
      const [p, fn, multiFn] = m;
      if (p.multi) return p.multi.map((pp, i) => [pp, v => multiFn ? multiFn(v)[i] : fn(v)]);
      return [[p, fn]];
    };
    // apply all document values (p = current params object; skip = set of automated keys left alone)
    api.setAll = (p, immediate, b, skip) => { api.cur = p; for (const s of C.FX[fx.type].params) if (!skip || !skip.has(s.k)) api.set(s.k, p[s.k], immediate); if (api.setTime) api.setTime(b || bpm); };
    api.setAll(P, true, bpm);
    return api;
  }
  // structural signature: changes here need new nodes (type, bypass, non-automatable choices)
  const sig = fx => fx.type + (fx.on ? '+' : '-') + C.FX[fx.type].params.filter(s => s.auto === false).map(s => s.k + '=' + fx.p[s.k]).join(',');
  root.Fx = { create, impulse, sig };
})(typeof window !== 'undefined' ? window : globalThis);
