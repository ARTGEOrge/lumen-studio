// Lumen Type: WOFF2 compress / decompress in a worker (wawoff2, Google woff2 compiled to WebAssembly, MIT).
// Each worker instance loads only one of the two Emscripten builds (they both use a global `Module`).
let ready = null, mode = null;
self.onmessage = async e => {
  const { id, op, data } = e.data;
  try {
    if (!ready) {
      mode = op;
      ready = new Promise(res => { self.Module = { onRuntimeInitialized: res }; importScripts(op === 'compress' ? '../vendor/woff2-compress.js' : '../vendor/woff2-decompress.js'); });
    }
    if (op !== mode) throw new Error('worker mode mismatch');
    await ready;
    const out = op === 'compress' ? self.Module.compress(new Uint8Array(data)) : self.Module.decompress(new Uint8Array(data));
    if (!out) throw new Error(op === 'compress' ? 'WOFF2 compression failed' : 'WOFF2 decompression failed');
    const copy = new Uint8Array(out);
    self.postMessage({ id, ok: true, data: copy }, [copy.buffer]);
  } catch (err) { self.postMessage({ id, ok: false, error: String(err && err.message || err) }); }
};
