'use strict';
/* Lumen Sound — playback engine, level meters and microphone recording. */
window.Engine = (() => {
  let ctx = null, master = null, splitter = null, analysers = [], meterCh = 2;
  let cur = null; // {stop(), position(), kind}
  const listeners = new Set();
  function ensure() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    ctx = new AudioContext({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.connect(ctx.destination);
    setMeterChannels(2);
    return ctx;
  }
  function setMeterChannels(n) {
    n = Math.max(1, Math.min(8, n)); meterCh = n;
    if (!ctx) return;
    try { splitter?.disconnect(); } catch (e) { /* */ }
    splitter = ctx.createChannelSplitter(n); master.connect(splitter);
    analysers = []; for (let i = 0; i < n; i++) { const a = ctx.createAnalyser(); a.fftSize = 2048; splitter.connect(a, i); analysers.push(a); }
  }
  const buf = new Float32Array(2048);
  // returns [{peak, rms}] per channel (linear)
  function levels() {
    if (!ctx || !cur) return null;
    return analysers.map(a => { a.getFloatTimeDomainData(buf); let p = 0, s = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > p) p = v; s += v * v; } return { peak: p, rms: Math.sqrt(s / buf.length) }; });
  }
  function toBuffer(chs, sr) {
    ensure();
    const n = Math.max(1, chs[0].length), ab = ctx.createBuffer(chs.length, n, sr);
    chs.forEach((c, i) => { if (c.length) ab.copyToChannel(c, i); });
    return ab;
  }
  /* Play an AudioBuffer from `from` seconds; optional `to`, loop {a,b}. onEnd fires when it stops by itself. */
  function playBuffer(ab, { from = 0, to = null, loop = null, onEnd, kind = 'wave', rate = 1, insert = null } = {}) {
    stop(true); ensure();
    setMeterChannels(ab.numberOfChannels);
    const src = ctx.createBufferSource(); src.buffer = ab; src.playbackRate.value = rate;
    if (insert) { src.connect(insert.input); insert.output.connect(master); } else src.connect(master);
    const t0 = ctx.currentTime + 0.02; let stopped = false;
    if (loop && loop.b - loop.a > 0.005) {
      src.loop = true; src.loopStart = loop.a; src.loopEnd = loop.b;
      if (from < loop.a || from >= loop.b) from = loop.a;
      src.start(t0, from);
    } else src.start(t0, from, to != null ? Math.max(0.001, to - from) : undefined);
    const me = {
      kind, from, loop,
      position() {
        let p = from + Math.max(0, ctx.currentTime - t0) * rate;
        if (loop && loop.b - loop.a > 0.005 && p >= loop.b) p = loop.a + (p - loop.a) % (loop.b - loop.a);
        return p;
      },
      stop() { if (stopped) return; stopped = true; try { src.stop(); } catch (e) { /* */ } src.disconnect(); insert?.dispose(); }
    };
    src.onended = () => { if (!stopped) { stopped = true; insert?.dispose(); if (cur === me) { cur = null; emit(); } onEnd?.(); } };
    cur = me; emit(); return me;
  }
  /* Play a node graph built by `build(ctx, dest, when, offset)` (used by multitrack). Returns handle. */
  function playGraph(build, { from = 0, duration, kind = 'multi', onEnd, channels = 2 } = {}) {
    stop(true); ensure(); setMeterChannels(channels);
    const bus = ctx.createGain(); bus.connect(master);
    const t0 = ctx.currentTime + 0.05; let stopped = false;
    const nodes = build(ctx, bus, t0, from) || [];
    let endTimer = null;
    const me = {
      kind, from,
      position() { return from + Math.max(0, ctx.currentTime - t0); },
      stop() { if (stopped) return; stopped = true; clearTimeout(endTimer); nodes.forEach(n => { try { n.stop?.(); } catch (e) { /* */ } try { n.disconnect(); } catch (e) { /* */ } }); bus.disconnect(); }
    };
    if (duration != null) endTimer = setTimeout(() => { if (cur === me) { me.stop(); cur = null; emit(); onEnd?.(); } }, Math.max(0, (duration - from) * 1000 + 80));
    cur = me; emit(); return me;
  }
  function stop(silent) { if (cur) { const c = cur; cur = null; c.stop(); if (!silent) emit(); } }
  const playing = () => !!cur;
  const current = () => cur;
  function emit() { listeners.forEach(f => f(cur)); }
  const onChange = f => listeners.add(f);

  /* ---------------- recording ---------------- */
  const workletSrc = `class Rec extends AudioWorkletProcessor{constructor(){super();this.on=true;this.port.onmessage=e=>{if(e.data==='stop')this.on=false}}
process(inputs){const i=inputs[0];if(i&&i.length){this.port.postMessage(i.map(c=>c.slice()))}return this.on}}registerProcessor('lumen-rec',Rec);`;
  let workletReady = null;
  /* Start capturing from the microphone. Returns a controller {stop() → {chs, sr}, level() → [peaks], recording(bool)} */
  async function openInput({ deviceId, channels = 2 } = {}) {
    if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('This browser does not allow microphone access here (insecure context or no media support).'), { code: 'unsupported' });
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: { ideal: channels }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      const denied = /NotAllowed|Permission|Security/i.test(e.name + e.message);
      const none = /NotFound|DevicesNotFound|Overconstrained/i.test(e.name);
      throw Object.assign(new Error(denied ? 'Microphone access was denied. Allow microphone access for this app (browser site settings or Windows privacy settings) and try again.' : none ? 'No microphone (audio input device) was found.' : 'The microphone could not be opened: ' + (e.message || e.name)), { code: denied ? 'denied' : none ? 'nodevice' : 'error' });
    }
    ensure();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser(); an.fftSize = 2048; src.connect(an);
    const chunks = []; let recording = false, t0 = 0, t1 = null, node = null, nch = Math.min(channels, src.channelCount || channels);
    const take = arr => { if (recording) chunks.push(arr.slice(0, nch).map(c => c)); };
    try {
      if (!workletReady) workletReady = ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([workletSrc], { type: 'text/javascript' })));
      await workletReady;
      node = new AudioWorkletNode(ctx, 'lumen-rec', { channelCount: nch, channelCountMode: 'explicit', numberOfInputs: 1, numberOfOutputs: 0 });
      node.port.onmessage = e => take(e.data);
    } catch (e) {
      node = ctx.createScriptProcessor(4096, nch, nch);
      node.onaudioprocess = e => { const a = []; for (let c = 0; c < nch; c++) a.push(e.inputBuffer.getChannelData(c).slice()); take(a); };
      const mute = ctx.createGain(); mute.gain.value = 0; node.connect(mute); mute.connect(ctx.destination);
    }
    src.connect(node);
    const lv = new Float32Array(2048);
    const track = stream.getAudioTracks()[0];
    return {
      label: track?.label || 'Default input', channels: nch, sr: ctx.sampleRate,
      start() { chunks.length = 0; recording = true; t0 = ctx.currentTime; t1 = null; },
      markStop() { t1 = ctx.currentTime; },
      pause() { recording = false; },
      get recording() { return recording; },
      get seconds() { return chunks.reduce((a, c) => a + (c[0]?.length || 0), 0) / ctx.sampleRate; },
      level() { an.getFloatTimeDomainData(lv); let p = 0; for (let i = 0; i < lv.length; i++) { const v = Math.abs(lv[i]); if (v > p) p = v; } return p; },
      take() {
        recording = false;
        let n = chunks.reduce((a, c) => a + (c[0]?.length || 0), 0); const chs = [];
        if (t1 != null) n = Math.min(n, Math.max(0, Math.round((t1 - t0) * ctx.sampleRate)));
        for (let c = 0; c < nch; c++) { const o = new Float32Array(n); let k = 0; for (const ch of chunks) { if (k >= n) break; const d = (ch[c] || ch[0]).subarray(0, n - k); o.set(d, k); k += d.length; } chs.push(o); }
        return { chs, sr: ctx.sampleRate };
      },
      close() { recording = false; try { node.port?.postMessage('stop'); } catch (e) { /* */ } try { src.disconnect(); node.disconnect(); } catch (e) { /* */ } stream.getTracks().forEach(t => t.stop()); }
    };
  }
  async function inputDevices() { try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch (e) { return []; } }

  return { ensure, get ctx() { return ctx; }, get master() { return master; }, toBuffer, playBuffer, playGraph, stop, playing, current, levels, onChange, openInput, inputDevices, setMeterChannels };
})();
