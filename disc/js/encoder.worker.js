// Lumen Disc encoder worker: runs ffmpeg.wasm and streams its output back
// to the page in chunks, so a two-hour disc never has to fit in memory.
//   in : {type:'probe', id, files:[{name,data}]}           → {type:'probe', id, logs}
//        {type:'encode', files:[{name,data}], args:[...]}   → {type:'data', chunk}…, {type:'done', ret}
//   out: {type:'log', line} for every ffmpeg log line, {type:'ready'} once loaded
import createCore from '../vendor/core/ffmpeg-core.js';

const CHUNK = 4 << 20;
let core = null, logs = null;

async function load() {
  if (core) return core;
  const coreURL = new URL('../vendor/core/ffmpeg-core.js', import.meta.url).href;
  const wasmURL = new URL('../vendor/core/ffmpeg-core.wasm', import.meta.url).href;
  core = await createCore({ mainScriptUrlOrBlob: coreURL + '#' + btoa(JSON.stringify({ wasmURL, workerURL: '' })) });
  core.setLogger(({ message }) => {
    if (logs) logs.push(message);
    self.postMessage({ type: 'log', line: message });
  });
  core.FS.mkdir('/in');
  // /out/disc.vob is a device: every write goes straight back to the page.
  let buf = new Uint8Array(CHUNK), fill = 0, total = 0;
  const flush = () => {
    if (!fill) return;
    const chunk = buf.slice(0, fill);
    self.postMessage({ type: 'data', chunk }, [chunk.buffer]);
    fill = 0;
  };
  const dev = core.FS.makedev(64, 0);
  core.FS.registerDevice(dev, {
    open() { fill = 0; total = 0; },
    close() { flush(); },
    read() { return 0; },
    write(stream, src, off, len, pos) {
      if (typeof pos === 'number' && pos !== total) throw new Error('DVD stream must be written in order');
      for (let n = len; n > 0;) {
        const k = Math.min(n, CHUNK - fill);
        buf.set(src.subarray(off, off + k), fill); fill += k; off += k; n -= k;
        if (fill === CHUNK) flush();
      }
      total += len;
      return len;
    },
    llseek(stream, offset, whence) { return whence === 1 ? stream.position + offset : whence === 2 ? total + offset : offset; },
  });
  core.FS.mkdir('/out');
  core.FS.mkdev('/out/disc.vob', dev);
  self.postMessage({ type: 'ready' });
  return core;
}

// Inputs are [{name, data: Blob}], mounted read-only so big videos are read
// from disk as ffmpeg needs them.
function mount(files) {
  try { core.FS.unmount('/in'); } catch {}
  core.FS.mount(core.FS.filesystems.WORKERFS, { blobs: files }, '/in');
}

function run(args) {
  core.setTimeout(-1);
  core.exec(...args);
  const ret = core.ret;
  core.reset();
  return ret;
}

self.onmessage = async ({ data: m }) => {
  try {
    await load();
    if (m.type === 'probe') {
      mount(m.files);
      logs = [];
      for (const f of m.files) {
        logs.push('@@FILE ' + f.name);
        run(['-hide_banner', '-i', '/in/' + f.name]);
      }
      self.postMessage({ type: 'probe', id: m.id, logs });
      logs = null;
    } else if (m.type === 'encode') {
      mount(m.files);
      const ret = run(m.args);
      self.postMessage({ type: 'done', ret });
    }
  } catch (e) {
    self.postMessage({ type: 'error', message: String(e && e.message || e) });
  }
};
