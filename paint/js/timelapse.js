'use strict';
/* Time-lapse: after each committed edit a downscaled frame of the canvas is encoded live with WebCodecs
   (VP9/VP8 — compact, always available) and kept as encoded chunks (also saved inside .lpaint).
   Export decodes the recording and re-encodes it to MP4/H.264 via mp4-muxer (fallback: WebM/VP9 via
   webm-muxer) at the chosen frame rate, with an optional hold on the finished painting. */
const TL = { on: true, supported: typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined', segs: [], enc: null, seg: null, n: 0, pending: false, lastT: 0, w: 0, h: 0, err: null };
const TL_MAX = 1280;
function tlFrameCount() { return TL.segs.reduce((s, g) => s + g.chunks.length, 0); }
function tlSize() { const s = Math.min(1, TL_MAX / Math.max(doc.w, doc.h)); return [Math.max(2, Math.round(doc.w * s / 2) * 2), Math.max(2, Math.round(doc.h * s / 2) * 2)]; }
const tlCodecCache = new Map();
async function tlPickCodec(w, h) {
  const key = w + 'x' + h; if (tlCodecCache.has(key)) return tlCodecCache.get(key);
  let found = null;
  for (const codec of ['vp8', 'vp09.00.10.08']) { // VP8 realtime is by far the cheapest to run while painting
    const cfg = { codec, width: w, height: h, bitrate: 5e6, framerate: 30, latencyMode: 'realtime' };
    try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) { found = cfg; break; } } catch (e) { }
  }
  tlCodecCache.set(key, found); return found;
}
function tlPrewarm() { if (TL.supported && doc) tlPickCodec(...tlSize()).catch(() => { }); }
let tlChain = Promise.resolve(); // all encoder work is serialized through this chain
async function tlStartSegment(w, h, gen = TL.gen) {
  const cfg = await tlPickCodec(w, h);
  if (gen !== TL.gen) return null;
  if (!cfg) { TL.supported = false; tlStatus(); return null; }
  const seg = { codec: cfg.codec, w, h, config: null, chunks: [] };
  const enc = new VideoEncoder({
    output: (chunk, md) => { const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data); seg.chunks.push({ data, key: chunk.type === 'key' }); if (md?.decoderConfig && !seg.config) { const dc = md.decoderConfig; seg.config = { codec: dc.codec, codedWidth: dc.codedWidth || w, codedHeight: dc.codedHeight || h, description: dc.description ? new Uint8Array(ArrayBuffer.isView(dc.description) ? dc.description.buffer.slice(dc.description.byteOffset, dc.description.byteOffset + dc.description.byteLength) : dc.description.slice(0)) : undefined }; } tlStatus(); },
    error: e => { TL.err = e; console.warn('time-lapse encoder: ' + e.message); }
  });
  enc.configure(cfg);
  const old = TL.enc; if (old && old.state !== 'closed') { try { await old.flush(); old.close(); } catch (e) { } }
  TL.enc = enc; TL.seg = seg; TL.segs.push(seg); TL.n = 0; TL.w = w; TL.h = h;
  return seg;
}
function tlReset() { TL.gen = (TL.gen || 0) + 1; const old = TL.enc; TL.enc = null; TL.seg = null; TL.segs = []; TL.n = 0; TL.queue = []; if (old && old.state !== 'closed') tlChain = tlChain.then(() => old.flush()).then(() => old.close()).catch(() => { }); tlStatus(); }
/* capture one frame (throttled; called after every committed edit) */
function tlCapture(force) {
  if (!TL.on || !TL.supported || !doc || !R) return;
  if (TL.pending) return;
  const wait = force ? 0 : Math.max(0, 150 - (performance.now() - TL.lastT));
  TL.pending = true;
  setTimeout(() => { TL.pending = false; tlGrab(); }, wait);
}
/* synchronous capture of the current canvas; encoding happens asynchronously */
function tlGrab() {
  if (!TL.on || !TL.supported || !doc || !R) return;
  const [w, h] = tlSize();
  if (doc.ver !== composedVer) { R.compose(); composedVer = doc.ver; }
  const px = R.readScaled(w, h, true);
  TL.queue = TL.queue || []; TL.queue.push({ px, w, h }); if (TL.queue.length > 12) TL.queue.splice(1, 1);
  TL.lastT = performance.now();
  tlPump();
}
function tlPump() { tlChain = tlChain.then(tlPumpNow).catch(e => console.warn('time-lapse: ' + e.message)); return tlChain; }
async function tlPumpNow() {
  const gen = TL.gen;
  while (TL.queue && TL.queue.length) {
    const f = TL.queue[0];
    if (!TL.enc || TL.enc.state === 'closed' || TL.w !== f.w || TL.h !== f.h) {
      const seg = await tlStartSegment(f.w, f.h, gen);
      if (gen !== TL.gen) return; // document changed meanwhile
      if (!seg) { TL.queue = []; return; }
    }
    TL.queue.shift();
    const fr = new VideoFrame(f.px, { format: 'RGBA', codedWidth: f.w, codedHeight: f.h, timestamp: TL.n * 33333, duration: 33333 });
    try { TL.enc.encode(fr, { keyFrame: TL.n % 60 === 0 }); } catch (e) { console.warn(e); } finally { fr.close(); }
    TL.n++;
  }
  tlStatus();
}
function tlStatus() { const s = $('#st-rec'); if (!s) return; s.textContent = !TL.supported ? '' : TL.on ? `● REC ${tlFrameCount() + (TL.enc?.encodeQueueSize || 0)} frames` : `Time-lapse paused (${tlFrameCount()})`; s.classList.toggle('rec', TL.on); }
async function tlFlush() { await tlPump(); if (TL.enc && TL.enc.state === 'configured') await TL.enc.flush(); }

/* ---------- export ---------- */
async function tlExport({ fps = 30, hold = 2, fmt = 'auto' } = {}) {
  await tlFlush();
  const segs = TL.segs.filter(s => s.chunks.length && s.config);
  const total = segs.reduce((s, g) => s + g.chunks.length, 0);
  if (!total) { Aero.toast('Nothing recorded yet — paint something first'); return null; }
  const W = Math.max(...segs.map(s => s.w)), H = Math.max(...segs.map(s => s.h));
  // choose output
  let useMp4 = fmt !== 'webm', outCfg = null;
  if (useMp4) for (const codec of ['avc1.640034', 'avc1.4d0034', 'avc1.42003e', 'avc1.640028']) {
    const c = { codec, width: W, height: H, bitrate: 8e6, framerate: fps, avc: { format: 'avc' } };
    try { if ((await VideoEncoder.isConfigSupported(c)).supported) { outCfg = c; break; } } catch (e) { }
  }
  if (!outCfg) { useMp4 = false; for (const codec of ['vp09.00.40.08', 'vp09.00.10.08', 'vp8']) { const c = { codec, width: W, height: H, bitrate: 8e6, framerate: fps }; try { if ((await VideoEncoder.isConfigSupported(c)).supported) { outCfg = c; break; } } catch (e) { } } }
  if (!outCfg) throw new Error('No video encoder available');
  const muxer = useMp4
    ? new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: fps }, fastStart: 'in-memory' })
    : new WebMMuxer.Muxer({ target: new WebMMuxer.ArrayBufferTarget(), video: { codec: outCfg.codec.startsWith('vp8') ? 'V_VP8' : 'V_VP9', width: W, height: H, frameRate: fps } });
  let encErr = null;
  const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => encErr = e });
  enc.configure(outCfg);
  const cv = new OffscreenCanvas(W, H), cx = cv.getContext('2d');
  let n = 0; const dur = 1e6 / fps;
  const emit = async src => {
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H);
    const sw = src.displayWidth, sh = src.displayHeight, s = Math.min(W / sw, H / sh);
    cx.drawImage(src, (W - sw * s) / 2, (H - sh * s) / 2, sw * s, sh * s);
    const f = new VideoFrame(cv, { timestamp: Math.round(n * dur), duration: Math.round(dur) });
    enc.encode(f, { keyFrame: n % (fps * 2) === 0 }); f.close(); n++;
    while (enc.encodeQueueSize > 8) await sleep(4);
  };
  let last = null, done = 0;
  for (const seg of segs) {
    const frames = [];
    const dec = new VideoDecoder({ output: f => frames.push(f), error: e => encErr = e });
    dec.configure({ codec: seg.config.codec, codedWidth: seg.config.codedWidth, codedHeight: seg.config.codedHeight, description: seg.config.description });
    let first = true;
    for (let i = 0; i < seg.chunks.length; i++) {
      const c = seg.chunks[i]; if (first && !c.key) continue; first = false;
      dec.decode(new EncodedVideoChunk({ type: c.key ? 'key' : 'delta', timestamp: i * 33333, data: c.data }));
      if (dec.decodeQueueSize > 6 || frames.length > 4) await sleep(0);
      while (frames.length) { const f = frames.shift(); await emit(f); if (last) last.close(); last = f; done++; }
      if (encErr) throw encErr;
      if (i % 30 === 0) Aero.busy(`Encoding time-lapse… ${Math.round(done / total * 100)}%`);
    }
    await dec.flush();
    while (frames.length) { const f = frames.shift(); await emit(f); if (last) last.close(); last = f; done++; }
    dec.close();
  }
  // hold on the finished painting (current canvas)
  if (hold > 0) {
    if (doc.ver !== composedVer) { R.compose(); composedVer = doc.ver; }
    const [w, h] = tlSize(); const px = R.readScaled(w, h, true);
    const fr = new VideoFrame(px, { format: 'RGBA', codedWidth: w, codedHeight: h, timestamp: 0 });
    for (let i = 0; i < Math.round(hold * fps); i++) await emit(fr);
    fr.close();
  }
  if (last) last.close();
  await enc.flush(); enc.close();
  if (encErr) throw encErr;
  muxer.finalize();
  return { data: new Uint8Array(muxer.target.buffer), mp4: useMp4, frames: n, seconds: n / fps };
}

/* ---------- persistence inside .lpaint ---------- */
async function tlSerialize() {
  await tlFlush();
  const segs = TL.segs.filter(s => s.chunks.length && s.config); if (!segs.length) return null;
  let size = 0; for (const s of segs) for (const c of s.chunks) size += c.data.length;
  const bin = new Uint8Array(size); let o = 0;
  const meta = { version: 1, segments: segs.map(s => ({ codec: s.config.codec, w: s.w, h: s.h, cw: s.config.codedWidth, ch: s.config.codedHeight, description: s.config.description ? Array.from(s.config.description) : null, chunks: s.chunks.map(c => { const r = [o, c.data.length, c.key ? 1 : 0]; bin.set(c.data, o); o += c.data.length; return r; }) })) };
  return { meta, bin };
}
async function tlLoad(meta, bin) {
  tlReset();
  if (!meta || !bin || !Array.isArray(meta.segments)) return;
  for (const s of meta.segments.slice(0, 64)) {
    if (typeof s.codec !== 'string' || !/^(vp8|vp09[\d.]*|avc1\.[0-9a-f]{6})$/i.test(s.codec) || !Array.isArray(s.chunks)) continue;
    const chunks = [];
    for (const c of s.chunks) { const [off, len, key] = c.map(Number); if (!(off >= 0 && len > 0 && off + len <= bin.length)) continue; chunks.push({ data: bin.slice(off, off + len), key: !!key }); }
    const w = clamp(s.w | 0, 2, 8192), h = clamp(s.h | 0, 2, 8192);
    TL.segs.push({ codec: s.codec, w, h, config: { codec: s.codec, codedWidth: clamp(s.cw | 0 || w, 2, 8192), codedHeight: clamp(s.ch | 0 || h, 2, 8192), description: Array.isArray(s.description) ? new Uint8Array(s.description.slice(0, 4096)) : undefined }, chunks });
  }
  tlStatus();
}
