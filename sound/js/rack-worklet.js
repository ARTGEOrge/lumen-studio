'use strict';
/* Lumen Sound — AudioWorklet effect processors for the real-time effects rack.
   One processor ('lumen-fx') runs one effect kind. The algorithms are streaming ports of the
   destructive effects in dsp.js, so what you hear live is what "Apply" renders (the same graph is
   rendered in an OfflineAudioContext). Parameters arrive via processorOptions and port messages. */
const TAU = Math.PI * 2;
const dbToLin = d => Math.pow(10, d / 20);
const linToDb = v => 20 * Math.log10(Math.max(Math.abs(v), 1e-12));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
function lowpass(f, sr) {
  const w0 = TAU * clamp(f, 1, sr * 0.499) / sr, cw = Math.cos(w0), al = Math.sin(w0) / (2 * 0.707), a0 = 1 + al;
  return { b0: (1 - cw) / 2 / a0, b1: (1 - cw) / a0, b2: (1 - cw) / 2 / a0, a1: -2 * cw / a0, a2: (1 - al) / a0 };
}
function hermite(buf, pos) {
  const n = buf.length; pos = ((pos % n) + n) % n; const i = Math.floor(pos), f = pos - i;
  const xm1 = buf[(i - 1 + n) % n], x0 = buf[i % n], x1 = buf[(i + 1) % n], x2 = buf[(i + 2) % n];
  const c1 = 0.5 * (x1 - xm1), c2 = xm1 - 2.5 * x0 + 2 * x1 - 0.5 * x2, c3 = 0.5 * (x2 - xm1) + 1.5 * (x0 - x1);
  return ((c3 * f + c2) * f + c1) * f + x0;
}
const SHAPES = {
  soft: v => Math.tanh(v),
  hard: v => clamp(v, -1, 1) * 0.9,
  tube: v => v >= 0 ? 1 - Math.exp(-v) : -(1 - Math.exp(v * 1.4)) / 1.2,
  fold: v => { let y = v; for (let k = 0; k < 8 && Math.abs(y) > 1; k++) y = y > 1 ? 2 - y : -2 - y; return y; }
};

const KINDS = {
  /* biquad cascade; p.coefs computed on the main thread with DSP.eqCoefs, p.gain linear output gain */
  eq: {
    prep(s, p, nch) { const nst = (p.coefs || []).length; if (!s.z || s.nst !== nst || s.z.length !== nch) { s.z = Array.from({ length: nch }, () => new Float64Array(nst * 2)); s.nst = nst; } },
    run(s, p, x, y, n) {
      const cs = p.coefs || [], g = p.gain ?? 1;
      for (let c = 0; c < y.length; c++) {
        const xi = x[c], yo = y[c], z = s.z[c];
        for (let i = 0; i < n; i++) yo[i] = xi[i];
        for (let k = 0; k < cs.length; k++) {
          const { b0, b1, b2, a1, a2 } = cs[k]; let z1 = z[k * 2], z2 = z[k * 2 + 1];
          for (let i = 0; i < n; i++) { const v = yo[i], o = b0 * v + z1; z1 = b1 * v - a1 * o + z2; z2 = b2 * v - a2 * o; yo[i] = o; }
          z[k * 2] = z1; z[k * 2 + 1] = z2;
        }
        if (g !== 1) for (let i = 0; i < n; i++) yo[i] *= g;
      }
    }
  },
  comp: {
    prep(s, p) {
      s.at = Math.exp(-1 / (sampleRate * Math.max(0.01, p.attack) / 1000)); s.rt = Math.exp(-1 / (sampleRate * Math.max(1, p.release) / 1000));
      s.rmsC = Math.exp(-1 / (sampleRate * 0.01)); s.yL = s.yL || 0; s.ms = s.ms || 0;
    },
    run(s, p, x, y, n) {
      const T = p.threshold, R = Math.max(1, p.ratio), W = Math.max(0, p.knee || 0), mk = p.makeup || 0, rms = p.detector === 'rms';
      const gc = v => { const d = v - T; if (2 * d < -W) return v; if (W > 0 && 2 * Math.abs(d) <= W) return v + (1 / R - 1) * (d + W / 2) ** 2 / (2 * W); return T + d / R; };
      let yL = s.yL, ms = s.ms, gr = 0;
      for (let i = 0; i < n; i++) {
        let lvl = 0; for (let c = 0; c < x.length; c++) { const v = Math.abs(x[c][i]); if (v > lvl) lvl = v; }
        if (rms) { ms = s.rmsC * ms + (1 - s.rmsC) * lvl * lvl; lvl = Math.sqrt(ms); }
        const xd = linToDb(lvl), xl = xd - gc(xd);
        yL = xl > yL ? s.at * yL + (1 - s.at) * xl : s.rt * yL + (1 - s.rt) * xl;
        if (yL > gr) gr = yL;
        const g = dbToLin(mk - yL);
        for (let c = 0; c < y.length; c++) y[c][i] = x[c][i] * g;
      }
      s.yL = yL; s.ms = ms; s.gr = gr;
    }
  },
  /* look-ahead brick-wall limiter (streaming form of DSP.limit); latency = L-1 samples */
  limit: {
    prep(s, p, nch) {
      const L = Math.max(1, Math.round(sampleRate * (p.lookahead ?? 5) / 1000));
      if (s.L !== L || !s.xr || s.xr.length !== nch) {
        const S = L + 4; s.L = L; s.S = S; s.J = 0; s.r = 1; s.acc = 0;
        s.req = new Float32Array(S).fill(1); s.ms = new Float64Array(S).fill(1); s.xr = Array.from({ length: nch }, () => new Float32Array(S));
        s.dqI = new Float64Array(L + 3); s.dqH = 0; s.dqT = 0;
      }
      s.ceil = dbToLin(p.ceiling ?? -1); s.inG = dbToLin(p.gain || 0); s.rel = Math.exp(-1 / (sampleRate * Math.max(1, p.release ?? 80) / 1000));
    },
    run(s, p, x, y, n) {
      const { L, S, req, ms, xr, dqI } = s, Q = dqI.length, nch = y.length;
      let { J, r, acc, dqH, dqT } = s; let minG = 1;
      for (let i = 0; i < n; i++, J++) {
        let a = 0; for (let c = 0; c < x.length; c++) { const v = Math.abs(x[c][i]); if (v > a) a = v; }
        a *= s.inG; const q = a > s.ceil ? s.ceil / a : 1, slot = J % S;
        req[slot] = q; for (let c = 0; c < nch; c++) xr[c][slot] = (x[c] || x[0])[i];
        // sliding minimum of req over [J-L, J] (monotonic deque of absolute indices)
        while (dqT > dqH && req[dqI[(dqT - 1) % Q] % S] >= q) dqT--;
        dqI[dqT % Q] = J; dqT++;
        while (dqI[dqH % Q] < J - L) dqH++;
        const m = req[dqI[dqH % Q] % S];
        r = m < r ? m : m + (r - m) * s.rel;
        ms[slot] = r; acc += r; if (J >= L) acc -= ms[(J - L) % S];
        const G = J >= L - 1 ? acc / L : 1, src = J - L + 1;
        if (src >= 0) { const ss = src % S, g = Math.min(G, req[ss]) * s.inG; if (g / s.inG < minG) minG = g / s.inG; for (let c = 0; c < nch; c++) y[c][i] = xr[c][ss] * g; }
        else for (let c = 0; c < nch; c++) y[c][i] = 0;
      }
      // keep the deque indices small
      if (dqH > 1e6) { dqT -= dqH - (dqH % Q); dqH = dqH % Q; }
      Object.assign(s, { J, r, acc, dqH, dqT }); s.gr = -linToDb(minG);
    }
  },
  gate: {
    prep(s, p) {
      s.open = dbToLin(p.threshold); s.close = dbToLin(p.threshold - (p.hysteresis ?? 4)); s.floor = dbToLin(-Math.abs(p.range ?? 80));
      s.atk = 1 - Math.exp(-1 / (sampleRate * Math.max(0.05, p.attack ?? 1) / 1000)); s.relc = 1 - Math.exp(-1 / (sampleRate * Math.max(1, p.release ?? 120) / 1000));
      s.hold = Math.round(sampleRate * (p.hold ?? 30) / 1000); s.envC = Math.exp(-1 / (sampleRate * 0.002));
      if (s.g == null) { s.env = 0; s.g = s.floor; s.isOpen = false; s.hc = 0; }
    },
    run(s, p, x, y, n) {
      let { env, g, isOpen, hc } = s;
      for (let i = 0; i < n; i++) {
        let a = 0; for (let c = 0; c < x.length; c++) { const v = Math.abs(x[c][i]); if (v > a) a = v; }
        env = a > env ? a : s.envC * env + (1 - s.envC) * a;
        if (env >= s.open) { isOpen = true; hc = s.hold; } else if (env < s.close) { if (hc > 0) hc--; else isOpen = false; }
        const tg = isOpen ? 1 : s.floor; g += (tg - g) * (tg > g ? s.atk : s.relc);
        for (let c = 0; c < y.length; c++) y[c][i] = x[c][i] * g;
      }
      Object.assign(s, { env, g, isOpen, hc }); s.gr = -linToDb(g);
    }
  },
  chorus: {
    prep(s, p, nch) {
      const base = p.delay / 1000 * sampleRate, depth = p.depth / 1000 * sampleRate, size = Math.ceil(base + depth + 8);
      if (s.size !== size || !s.buf || s.buf.length !== nch) { s.size = size; s.buf = Array.from({ length: nch }, () => new Float32Array(size)); s.last = new Float64Array(nch); s.i = s.i || 0; }
    },
    run(s, p, x, y, n) {
      const voices = Math.max(1, p.voices | 0), base = p.delay / 1000 * sampleRate, depth = p.depth / 1000 * sampleRate;
      const fb = clamp(p.feedback / 100, -0.95, 0.95), mix = p.mix / 100, rate = TAU * p.rate / sampleRate, size = s.size;
      for (let c = 0; c < y.length; c++) {
        const buf = s.buf[c], xi = x[c] || x[0], yo = y[c], chPh = (c % 2) * (p.spread ?? 90) / 180 * Math.PI; let last = s.last[c];
        for (let k = 0; k < n; k++) {
          const i = s.i + k, wpos = i % size; buf[wpos] = xi[k] + last * fb;
          let v = 0; for (let q = 0; q < voices; q++) { const d = base + depth * 0.5 * (1 + Math.sin(rate * i + chPh + TAU * q / voices)); v += hermite(buf, wpos - d); }
          v /= voices; last = v; yo[k] = xi[k] * (1 - mix) + v * mix;
        }
        s.last[c] = last;
      }
      s.i += n;
    }
  },
  delay: {
    prep(s, p, nch) {
      const D = Math.max(1, Math.round(sampleRate * p.time / 1000));
      if (s.D !== D || !s.bufs || s.bufs.length !== nch) { s.D = D; s.bufs = Array.from({ length: nch }, () => new Float32Array(D)); s.lp = new Float64Array(nch); s.i = 0; s.d = new Float64Array(nch); }
      s.lpA = Math.exp(-TAU * clamp(p.damp || 8000, 200, sampleRate * 0.45) / sampleRate);
    },
    run(s, p, x, y, n) {
      const fb = clamp(p.feedback / 100, 0, 0.97), wet = p.mix / 100, dry = p.dry == null ? 1 : p.dry / 100, nch = y.length, pp = p.pingpong && nch >= 2, { bufs, lp, d, lpA, D } = s;
      for (let k = 0; k < n; k++) {
        const r = (s.i + k) % D;
        for (let c = 0; c < nch; c++) { lp[c] = (1 - lpA) * bufs[c][r] + lpA * lp[c]; d[c] = lp[c]; }
        for (let c = 0; c < nch; c++) {
          const xv = (x[c] || x[0])[k];
          if (pp) { if (c === 0) bufs[0][r] = ((x[0][k]) + (x[1] || x[0])[k]) * 0.5 + d[1] * fb; else if (c === 1) bufs[1][r] = d[0] * fb; else bufs[c][r] = xv + d[c] * fb; }
          else bufs[c][r] = xv + d[c] * fb;
          y[c][k] = xv * dry + d[c] * wet;
        }
      }
      s.i = (s.i + n) % D;
    }
  },
  dist: {
    prep(s, p, nch) {
      s.tone = lowpass(p.tone || 12000, sampleRate);
      if (!s.z || s.z.length !== nch) { s.z = Array.from({ length: nch }, () => new Float64Array(2)); s.held = new Float64Array(nch); s.i = 0; }
    },
    run(s, p, x, y, n) {
      const drive = dbToLin(p.drive), outG = dbToLin(p.output || 0), mix = p.mix / 100, crush = p.type === 'crush';
      const q = Math.pow(2, (p.bits || 8) - 1), hold = Math.max(1, p.downsample | 0), shape = crush ? (v => Math.round(clamp(v, -1, 1) * q) / q) : (SHAPES[p.type] || Math.tanh);
      const { b0, b1, b2, a1, a2 } = s.tone;
      for (let c = 0; c < y.length; c++) {
        const xi = x[c] || x[0], yo = y[c], z = s.z[c]; let held = s.held[c], z1 = z[0], z2 = z[1];
        for (let k = 0; k < n; k++) {
          if (!crush || (s.i + k) % hold === 0) held = shape(xi[k] * (crush ? 1 : drive));
          const v = held, o = b0 * v + z1; z1 = b1 * v - a1 * o + z2; z2 = b2 * v - a2 * o;
          yo[k] = (xi[k] * (1 - mix) + o * mix) * outG;
        }
        s.held[c] = held; z[0] = z1; z[1] = z2;
      }
      s.i += n;
    }
  }
};

class LumenFx extends AudioWorkletProcessor {
  constructor(opts) {
    super();
    const po = opts.processorOptions || {};
    this.kind = KINDS[po.kind] ? po.kind : 'eq'; this.s = {}; this.nch = 0; this.blocks = 0;
    this.setParams(po.params || {});
    this.port.onmessage = e => { if (e.data && e.data.params) this.setParams(e.data.params); if (e.data && e.data.reset) { this.s = {}; this.nch = 0; } };
  }
  setParams(p) { this.p = p; this.dirty = true; }
  process(inputs, outputs) {
    const out = outputs[0]; if (!out || !out.length) return true;
    const n = out[0].length, nch = out.length;
    let x = inputs[0];
    if (!x || !x.length) { if (!this.zero || this.zero[0].length !== n || this.zero.length !== nch) this.zero = Array.from({ length: nch }, () => new Float32Array(n)); x = this.zero; }
    else if (x.length < nch) x = Array.from({ length: nch }, (_, c) => x[Math.min(c, x.length - 1)]);
    const K = KINDS[this.kind];
    if (this.dirty || this.nch !== nch) { K.prep(this.s, this.p, nch); this.dirty = false; this.nch = nch; }
    K.run(this.s, this.p, x, out, n);
    if (++this.blocks % 12 === 0 && this.s.gr != null) this.port.postMessage({ gr: this.s.gr });
    return true;
  }
}
registerProcessor('lumen-fx', LumenFx);
