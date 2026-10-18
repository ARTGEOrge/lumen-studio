'use strict';
/* Lumen Beats — audio engine.
   Graph: channel strips → mixer inserts (FX chain → fader → pan → mute → master, post-fader sends) → master FX → output.
   The same Graph + scheduleWindow() code drives realtime playback (look-ahead scheduler pumped by a worker timer,
   every event placed on the audio clock = sample-accurate) and offline WAV/MP3 rendering (OfflineAudioContext). */
(function (root) {
  const C = root.Core;
  const AUTO_STEP = 12; // automation is sampled every 1/32 note between points (and at every point)

  class Graph {
    constructor(ctx, buffers, realtime) {
      this.ctx = ctx; this.buffers = buffers; this.realtime = realtime;
      this.ins = new Map(); this.chs = new Map(); this.choke = {}; this.voices = []; this.prj = null; this.skip = new Set();
      const m = this.master = { id: 'master', in: ctx.createGain(), post: ctx.createGain(), fx: [], fxSig: '' };
      m.in.connect(m.post);
      if (realtime) { m.meter = this.meter(m.post); }
      m.post.connect(ctx.destination);
    }
    meter(node) { const sp = this.ctx.createChannelSplitter(2), a = [this.ctx.createAnalyser(), this.ctx.createAnalyser()]; a.forEach((x, i) => { x.fftSize = 1024; sp.connect(x, i); }); node.connect(sp); return a; }
    rebuildChain(strip, list, bpm) {
      const sig = list.map(Fx.sig).join('|'); if (sig === strip.fxSig) return false;
      try { strip.in.disconnect(); } catch (e) { }
      for (const f of strip.fx) { try { f.api.output.disconnect(); } catch (e) { } f.api.stop?.(); }
      strip.fx = []; let node = strip.in;
      for (const fx of list) { if (!fx.on) continue; const api = Fx.create(this.ctx, fx, bpm); node.connect(api.input); node = api.output; strip.fx.push({ id: fx.id, api }); }
      node.connect(strip.post); strip.fxSig = sig; return true;
    }
    newStrip(id) {
      const ctx = this.ctx, s = { id, in: ctx.createGain(), post: ctx.createGain(), pan: ctx.createStereoPanner(), mute: ctx.createGain(), fx: [], fxSig: null, sends: new Map() };
      s.post.connect(s.pan); s.pan.connect(s.mute); s.mute.connect(this.master.in);
      if (this.realtime) s.meter = this.meter(s.mute);
      return s;
    }
    // bring the node graph in line with the document (incremental: sounding notes survive ordinary edits)
    sync(prj) {
      this.prj = prj; const ctx = this.ctx, bpm = prj.bpm, imm = !this.realtime, skip = this.skip;
      const set = (param, v, key) => { if (skip.has(key)) return; if (imm) param.value = v; else if (Math.abs(param.value - v) > 1e-7) param.setTargetAtTime(v, ctx.currentTime, 0.01); };
      const m = this.master; this.rebuildChain(m, prj.mixer.master.fx, bpm);
      for (const f of m.fx) { const fx = prj.mixer.master.fx.find(x => x.id === f.id); f.api.setAll(fx.p, imm, bpm, keysFor(skip, 'fx:master:' + fx.id + ':')); }
      set(m.post.gain, C.dbToGain(prj.mixer.master.vol), 'master:vol');
      // inserts
      const ids = new Set(prj.mixer.inserts.map(i => i.id));
      for (const [id, s] of this.ins) if (!ids.has(id)) { try { s.mute.disconnect(); s.in.disconnect(); } catch (e) { } this.ins.delete(id); }
      const soloed = prj.mixer.inserts.filter(i => i.solo);
      const audible = new Set(soloed.map(i => i.id)); soloed.forEach(i => i.sends.forEach(x => audible.add(x.to)));
      for (const ins of prj.mixer.inserts) { if (!this.ins.has(ins.id)) this.ins.set(ins.id, this.newStrip(ins.id)); }
      const accepted = acceptSends(prj);
      for (const ins of prj.mixer.inserts) {
        const s = this.ins.get(ins.id);
        this.rebuildChain(s, ins.fx, bpm);
        for (const f of s.fx) { const fx = ins.fx.find(x => x.id === f.id); f.api.setAll(fx.p, imm, bpm, keysFor(skip, `fx:${ins.id}:${fx.id}:`)); }
        set(s.post.gain, C.dbToGain(ins.vol), `ins:${ins.id}:vol`); set(s.pan.pan, ins.pan, `ins:${ins.id}:pan`);
        const on = !ins.mute && (!soloed.length || audible.has(ins.id)) ? 1 : 0; if (imm) s.mute.gain.value = on; else s.mute.gain.setTargetAtTime(on, ctx.currentTime, 0.005);
        // sends (skip any that would create a feedback loop)
        const want = new Map(ins.sends.filter(x => this.ins.has(x.to) && accepted.has(ins.id + '>' + x.to)).map(x => [x.to, x]));
        for (const [to, g] of s.sends) if (!want.has(to)) { try { g.disconnect(); s.mute.disconnect(g); } catch (e) { } s.sends.delete(to); }
        for (const [to, x] of want) {
          let g = s.sends.get(to); if (!g) { g = ctx.createGain(); g.gain.value = 0; s.mute.connect(g); g.connect(this.ins.get(to).in); s.sends.set(to, g); }
          set(g.gain, C.dbToGain(x.amt), `ins:${ins.id}:send:${to}`);
        }
      }
      // channels
      const cids = new Set(prj.channels.map(c => c.id));
      for (const [id, c] of this.chs) if (!cids.has(id)) { try { c.pan.disconnect(); } catch (e) { } this.chs.delete(id); }
      for (const c of prj.channels) {
        let s = this.chs.get(c.id);
        if (!s) { s = { in: ctx.createGain(), pan: ctx.createStereoPanner(), to: null, st: { lastPitch: null, choke: this.choke } }; s.in.connect(s.pan); this.chs.set(c.id, s); }
        const to = c.out && this.ins.has(c.out) ? c.out : 'master';
        if (s.to !== to) { try { s.pan.disconnect(); } catch (e) { } s.pan.connect(to === 'master' ? this.master.in : this.ins.get(to).in); s.to = to; }
        set(s.in.gain, C.dbToGain(c.vol), `ch:${c.id}:vol`); set(s.pan.pan, c.pan, `ch:${c.id}:pan`);
      }
    }
    // [[AudioParam, value → param value]] for an automation target
    targetParams(tgt) {
      const a = tgt.split(':');
      if (a[0] === 'master') return [[this.master.post.gain, C.dbToGain]];
      if (a[0] === 'ins') { const s = this.ins.get(a[1]); if (!s) return []; if (a[2] === 'vol') return [[s.post.gain, C.dbToGain]]; if (a[2] === 'pan') return [[s.pan.pan, v => v]]; if (a[2] === 'send') { const g = s.sends.get(a[3]); return g ? [[g.gain, C.dbToGain]] : []; } }
      if (a[0] === 'fx') { const s = a[1] === 'master' ? this.master : this.ins.get(a[1]); const f = s?.fx.find(x => x.id === a[2]); return f ? f.api.params(a[3]) : []; }
      if (a[0] === 'ch') { const s = this.chs.get(a[1]); if (!s) return []; if (a[2] === 'vol') return [[s.in.gain, C.dbToGain]]; if (a[2] === 'pan') return [[s.pan.pan, v => v]]; }
      return [];
    }
    note(chId, t, p, v, dur, ov) {
      const c = this.prj.channels.find(x => x.id === chId), s = this.chs.get(chId); if (!c || !s) return null;
      const P = ov ? { ...c.params, ...ov } : c.params;
      const voice = Synth.play[c.type](this.ctx, s.in, P, p, v, t, dur, s.st, c.type === 'sampler' ? this.buffers.get(c.sample) : null);
      if (voice && this.realtime) { this.voices.push(voice); if (this.voices.length > 400) this.prune(); }
      return voice;
    }
    prune() { const now = this.ctx.currentTime; this.voices = this.voices.filter(v => v.end > now); }
    stopAll(t) { for (const v of this.voices) if (v.end > t) v.kill(t); this.voices = []; for (const k in this.choke) this.choke[k] = []; for (const s of this.chs.values()) s.st.lastPitch = null; }
    clearAutomation(prj) {
      for (const tgt of this.skip) for (const [p] of this.targetParams(tgt)) { p.cancelScheduledValues(0); }
      this.skip = new Set(); this.sync(prj);
    }
  }
  const keysFor = (skip, prefix) => { if (!skip.size) return null; const s = new Set(); for (const k of skip) if (k.startsWith(prefix)) s.add(k.slice(prefix.length)); return s; };
  // accept sends in document order, refusing any that would close a feedback loop
  function acceptSends(prj) {
    const ok = new Set(), adj = new Map();
    const reach = (a, b, seen = new Set()) => { if (a === b) return true; if (seen.has(a)) return false; seen.add(a); return (adj.get(a) || []).some(n => reach(n, b, seen)); };
    for (const i of prj.mixer.inserts) for (const s of i.sends) {
      if (s.to === i.id || reach(s.to, i.id)) continue;
      ok.add(i.id + '>' + s.to); if (!adj.has(i.id)) adj.set(i.id, []); adj.get(i.id).push(s.to);
    }
    return ok;
  }
  // live automation lanes for song playback → set of target ids the static sync must leave alone
  const liveLanes = prj => prj.automation.filter(l => l.on !== false && l.points.length && C.targetSpec(prj, l.target)?.live);

  /* Schedule everything in song ticks [a, b) whose first tick plays at audio time t0. Shared by realtime + offline. */
  function scheduleWindow(g, prj, mode, patId, a, b, t0, tps, st, metro) {
    const T = tick => t0 + (tick - a) / tps;
    const lanes = mode === 'song' ? prj.automation.filter(l => l.on !== false && l.points.length) : [];
    const perNote = new Map();   // chId → [[k, spec, lane]]
    for (const l of lanes) { const x = l.target.split(':'); if (x[0] === 'ch' && x[2] === 'p') { const sp = C.targetSpec(prj, l.target); if (sp) { if (!perNote.has(x[1])) perNote.set(x[1], []); perNote.get(x[1]).push([x[3], sp.spec, l]); } } }
    for (const e of C.collectEvents(prj, mode, a, b, patId)) {
      let ov = null; const pn = perNote.get(e.ch);
      if (pn) { ov = {}; for (const [k, spec, l] of pn) ov[k] = C.denorm(spec, C.laneAt(l, e.t)); }
      g.note(e.ch, T(e.t), e.p, e.v, e.d / tps, ov);
    }
    for (const l of lanes) {
      const sp = C.targetSpec(prj, l.target); if (!sp || !sp.live) continue;
      const params = g.targetParams(l.target); if (!params.length) continue;
      const val = tick => C.denorm(sp.spec, C.laneAt(l, tick));
      const ticks = new Set(); for (let k = Math.ceil(a / AUTO_STEP) * AUTO_STEP; k < b; k += AUTO_STEP) ticks.add(k);
      for (const p of l.points) if (p.t > a && p.t < b) ticks.add(p.t);
      const list = [...ticks].filter(k => k > a).sort((x, y) => x - y);
      for (const [param, fn] of params) {
        if (st.lastB !== a) { param.cancelScheduledValues(T(a)); param.setValueAtTime(fn(val(a)), T(a)); }
        for (const k of list) param.linearRampToValueAtTime(fn(val(k)), T(k));
      }
    }
    if (metro) { const bt = C.beatTicks(prj), bar = C.barTicks(prj); for (let k = Math.ceil(a / bt) * bt; k < b; k += bt) metro(T(k), k % bar === 0); }
    st.lastB = b;
  }

  /* ---------------- sample decoding ---------------- */
  async function decodeSample(bytes) {
    try { const w = Wav.parse(bytes); const b = new AudioBuffer({ length: Math.max(1, w.channels[0].length), sampleRate: w.sr, numberOfChannels: Math.min(2, w.channels.length) }); for (let c = 0; c < b.numberOfChannels; c++) b.copyToChannel(w.channels[c], c); return b; }
    catch (e) { }
    const ctx = new OfflineAudioContext(2, 1, 48000);
    return await ctx.decodeAudioData(bytes.slice().buffer);
  }

  /* ---------------- offline render ---------------- */
  // opts: {mode:'song'|'pattern', patId, loops, tail (s), sr}
  async function render(prj, buffers, opts = {}) {
    const sr = opts.sr || 44100, tps = C.ticksPerSec(prj), mode = opts.mode || 'song';
    const L = mode === 'pattern' ? C.patLen(prj, C.findPat(prj, opts.patId)) : 0;
    const len = mode === 'pattern' ? L * (opts.loops || 1) : (opts.to ?? C.songEnd(prj));
    const n = Math.max(1, Math.ceil((len / tps + (opts.tail ?? 2)) * sr));
    const ctx = new OfflineAudioContext(2, n, sr);
    const g = new Graph(ctx, buffers, false);
    if (mode === 'song') g.skip = new Set(liveLanes(prj).map(l => l.target));
    g.sync(prj);
    // Schedule in ~1 s windows, each just before the renderer reaches it (suspend/resume). Creating every voice up front
    // would make the renderer pull thousands of idle nodes for the whole song.
    const st = {}, W = Math.max(C.STEP, Math.round(tps)), jobs = [];
    if (mode === 'pattern') { for (let k = 0; k < (opts.loops || 1); k++) for (let a = 0; a < L; a += W) jobs.push([a, Math.min(L, a + W), (k * L + a) / tps]); }
    else for (let a = 0; a < len; a += W) jobs.push([a, Math.min(len, a + W), a / tps]);
    const run = j => scheduleWindow(g, prj, mode, opts.patId, j[0], j[1], j[2], tps, st);
    const quantum = 128 / sr; let lastQ = -1;
    for (const j of jobs) {
      const at = j[2] - 0.35;
      if (at <= quantum * 2) { run(j); continue; }
      let q = Math.floor(at / quantum); if (q <= lastQ) q = lastQ + 1; lastQ = q;
      ctx.suspend(q * quantum).then(() => { run(j); ctx.resume(); });
    }
    return await ctx.startRendering();
  }

  /* ---------------- realtime engine ---------------- */
  const Engine = {
    ctx: null, graph: null, transport: new C.Transport(), buffers: new Map(), prj: null, mode: 'pattern', patId: null, metronome: false, lookahead: 0.15,
    onStop: null,
    ensure() {
      if (this.ctx) return this.ctx;
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.graph = new Graph(this.ctx, this.buffers, true);
      if (this.prj) this.graph.sync(this.prj);
      try { const w = new Worker(URL.createObjectURL(new Blob(['setInterval(()=>postMessage(0),20)'], { type: 'text/javascript' }))); w.onmessage = () => this.pump(); this.timer = w; }
      catch (e) { this.timer = setInterval(() => this.pump(), 20); }
      return this.ctx;
    },
    setProject(prj) { this.prj = prj; if (this.graph) this.graph.sync(prj); if (this.transport.playing) this.updateLoop(); },
    get playing() { return this.transport.playing; },
    loopRange() {
      const p = this.prj;
      if (this.mode === 'pattern') return [0, C.patLen(p, C.findPat(p, this.patId) || p.patterns[0])];
      const lp = p.playlist.loop; if (lp && lp.b > lp.a) return [lp.a, lp.b];
      return [0, C.songEnd(p)];
    },
    updateLoop() { const [a, b] = this.loopRange(); this.transport.setLoop(a, b); },
    async play(fromTick = 0) {
      const ctx = this.ensure(); if (ctx.state !== 'running') await ctx.resume().catch(() => { });
      if (this.transport.playing) this.stop();
      const [a, b] = this.loopRange(); if (fromTick >= b || fromTick < a) fromTick = a;
      this.graph.skip = this.mode === 'song' ? new Set(liveLanes(this.prj).map(l => l.target)) : new Set();
      this.graph.sync(this.prj); this.st = {};
      this.transport.start(ctx.currentTime + 0.06, fromTick, C.ticksPerSec(this.prj), a, b);
      this.pump();
    },
    stop() {
      if (!this.ctx) return;
      this.transport.stop(); this.graph.stopAll(this.ctx.currentTime); this.graph.clearAutomation(this.prj);
      this.onStop?.();
    },
    setTempo() { if (this.ctx && this.transport.playing) this.transport.setTempo(this.ctx.currentTime, C.ticksPerSec(this.prj)); },
    pump() {
      if (!this.transport.playing || !this.ctx) return;
      const g = this.graph, prj = this.prj;
      try { this.transport.pump(this.ctx.currentTime, this.lookahead, (a, b, t0, tps) => scheduleWindow(g, prj, this.mode, this.patId, a, b, t0, tps, this.st, this.metronome ? (t, down) => this.click(t, down) : null)); }
      catch (e) { console.error(e); this.stop(); }
      if (g.voices.length > 200) g.prune();
    },
    click(t, down) {
      const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = down ? 1760 : 1175; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(down ? 0.32 : 0.2, t + 0.001); g.gain.setTargetAtTime(0, t + 0.001, 0.012);
      o.connect(g); g.connect(ctx.destination); o.start(t); o.stop(t + 0.08);
    },
    position() { if (!this.ctx || !this.transport.playing) return null; return this.transport.tickAt(this.ctx.currentTime - (this.ctx.outputLatency || 0)); },
    noteOn(chId, p, v, dur) {
      const ctx = this.ensure(); if (ctx.state !== 'running') ctx.resume().catch(() => { });
      return this.graph.note(chId, ctx.currentTime + 0.003, p, v, dur ?? null);
    },
    noteOff(voice) { if (voice && this.ctx) voice.release(this.ctx.currentTime); },
    // peak levels (linear) for every strip: {master:[l,r], <insId>:[l,r]}
    levels() {
      if (!this.graph) return {}; const out = {}, buf = this.lvBuf || (this.lvBuf = new Float32Array(1024));
      const pk = an => { an.getFloatTimeDomainData(buf); let m = 0; for (let i = 0; i < buf.length; i++) { const x = Math.abs(buf[i]); if (x > m) m = x; } return m; };
      if (this.graph.master.meter) out.master = this.graph.master.meter.map(pk);
      for (const [id, s] of this.graph.ins) if (s.meter) out[id] = s.meter.map(pk);
      return out;
    },
    async loadSample(id, bytes) { const b = await decodeSample(bytes); this.buffers.set(id, b); return b; }
  };

  root.Engine = Engine; root.Render = { render, scheduleWindow, Graph, decodeSample };
})(typeof window !== 'undefined' ? window : globalThis);
