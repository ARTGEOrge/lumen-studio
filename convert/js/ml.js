'use strict';
/* Lumen Convert — on-device neural networks: lazy onnxruntime-web (WASM, SIMD + threads) and model loading with
   download progress, cancel and friendly out-of-memory errors. Models live in vendor/models and are fetched from
   this site only when a tool that needs them runs. */
(() => {
  const U = LC.util;
  const base = p => new URL('vendor/' + p, document.baseURI).href;
  let ortP = null; const sessions = new Map();
  const MODELS = {
    u2netp: { file: 'models/u2netp.onnx', label: 'background model (4.4 MB)' },
    esrgan: { file: 'models/realesr-general-x4v3.onnx', label: 'upscaling model (4.7 MB)' },
    ultraface: { file: 'models/ultraface-rfb-320.onnx', label: 'face detector (1.2 MB)' }
  };
  function friendly(e) {
    const m = String(e && (e.message || e) || e);
    if (/memory|OOM|allocation|RangeError|Aborted\(\)|out of bounds/i.test(m)) return new Error('Not enough memory for this image on this device. Try a smaller image, close other tabs, or use a smaller scale.');
    return e instanceof Error ? e : new Error(m);
  }
  async function ort(ctx) {
    if (!self.crossOriginIsolated) throw new Error('This tool needs the page to be cross-origin isolated (it always is on the Lumen Studio site).');
    if (!ortP) ortP = (async () => {
      ctx && ctx.progress(0.01, 'Loading the neural-network runtime (10.6 MB, first time only)');
      const o = await U.loadScript(base('ort/ort.wasm.min.js'), 'ort');
      o.env.wasm.wasmPaths = base('ort/');
      o.env.wasm.numThreads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
      o.env.wasm.simd = true; o.env.logLevel = 'error';
      return o;
    })().catch(e => { ortP = null; throw e; });
    return ortP;
  }
  // fetch with progress so the first download of a model shows how far along it is
  async function fetchBytes(url, ctx, label) {
    const r = await fetch(url); if (!r.ok) throw new Error(`Couldn’t load the ${label} (${r.status})`);
    const total = +r.headers.get('content-length') || 0;
    if (!r.body || !total) return new Uint8Array(await r.arrayBuffer());
    const reader = r.body.getReader(), out = new Uint8Array(total); let got = 0;
    for (;;) {
      if (ctx && ctx.cancelled) { reader.cancel().catch(() => { }); throw new Error('Cancelled'); }
      const { done, value } = await reader.read(); if (done) break;
      if (got + value.length > out.length) throw new Error('Unexpected model size');
      out.set(value, got); got += value.length; ctx && ctx.progress(0.02 + 0.08 * got / total, `Loading the ${label}: ${Math.round(got / total * 100)}%`);
    }
    return out.subarray(0, got);
  }
  async function session(name, ctx) {
    const m = MODELS[name];
    if (!sessions.has(name)) sessions.set(name, (async () => {
      const o = await ort(ctx);
      const bytes = await fetchBytes(base(m.file), ctx, m.label);
      ctx && ctx.progress(0.1, 'Preparing the ' + m.label.replace(/ \(.*/, ''));
      try { return await o.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all', logSeverityLevel: 3 }); }
      catch (e) { throw friendly(e); }
    })().catch(e => { sessions.delete(name); throw e; }));
    return sessions.get(name);
  }
  async function run(sess, feeds) { try { return await sess.run(feeds); } catch (e) { throw friendly(e); } }
  const tensor = async (data, dims) => new (await ort()).Tensor('float32', data, dims);
  LC.ml = { ort, session, run, tensor, friendly };
})();
