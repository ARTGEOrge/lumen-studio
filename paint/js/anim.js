'use strict';
/* Frame-by-frame animation (Animation › Animation Mode). Every top-level layer or group is one frame
   (bottom = frame 1); optionally the bottom layer is a background and the top layer a foreground shown on
   every frame. The canvas shows the current frame (= the frame containing the selected layer) with onion
   skins of neighbouring frames (red = before, green = after). Playback, GIF / MP4 / WebM / PNG-sequence
   export. Settings are saved in the .lpaint document. */
const ANIM_DEF = { on: false, fps: 8, before: 1, after: 1, onionOp: 0.35, tint: true, bg: false, fg: false, loop: 'loop' };
const animRT = { playing: false, playIdx: 0, timer: 0, dir: 1, force: null, last: 0, thumbs: new Map(), thumbT: 0 };
const animCfg = () => doc.anim || (doc.anim = { ...ANIM_DEF });
const animOn = () => !!(doc && doc.anim && doc.anim.on);
function animFrames() { const a = animCfg(); let l = doc.root.slice(); if (a.bg && l.length > 1) l = l.slice(1); if (a.fg && l.length > 1) l = l.slice(0, -1); return l; }
function rootOf(L) { let x = L; for (let p = parentOf(x); p; p = parentOf(x)) x = p; return x; }
function animCurIndex() {
  const fr = animFrames(); if (!fr.length) return 0;
  if (animRT.playing) return clamp(animRT.playIdx, 0, fr.length - 1);
  const i = doc.active ? fr.indexOf(rootOf(doc.active)) : -1;
  if (i >= 0) animRT.last = i;
  return clamp(animRT.last, 0, fr.length - 1);
}
/* compositor hook: reordered root list (onion skins under the current frame) + per-layer overrides */
function animOverrides() {
  if (!animOn()) return null;
  const a = doc.anim, fr = animFrames(), cur = animRT.force != null ? animRT.force : animCurIndex(), map = new Map();
  const onion = !animRT.playing && animRT.force == null;
  const below = [], hidden = [];
  fr.forEach((L, i) => {
    if (i === cur) return; const d = i - cur;
    if (onion && d < 0 && -d <= a.before) { map.set(L, { op: a.onionOp * (1 - (-d - 1) / (a.before + 1)), tint: a.tint ? [0.85, 0.16, 0.18, 0.62] : null }); below.push(L); }
    else if (onion && d > 0 && d <= a.after) { map.set(L, { op: a.onionOp * (1 - (d - 1) / (a.after + 1)), tint: a.tint ? [0.12, 0.6, 0.28, 0.62] : null }); below.push(L); }
    else { map.set(L, { hide: true }); hidden.push(L); }
  });
  const bg = a.bg && doc.root.length > 1 ? [doc.root[0]] : [], fg = a.fg && doc.root.length > 1 ? [doc.root[doc.root.length - 1]] : [];
  const list = [...bg, ...below, ...(fr[cur] ? [fr[cur]] : []), ...fg, ...hidden];
  return { list, map };
}

/* ---------- mode / frames ---------- */
function toggleAnimMode(force) {
  const a = animCfg(), on = force ?? !a.on;
  if (on === a.on) return;
  a.on = on; animStop();
  if (on && doc.root.length > 1 && doc.root[0].type === 'fill' && !a.bg) a.bg = true; // paper stays under every frame
  $('#animbar').hidden = !on; resizeStage();
  doc.ver++; requestRender(); renderAnimBar(); Aero.setDirty(true);
  Aero.toast(on ? 'Animation mode — each top-level layer is a frame' : 'Animation mode off');
}
function animSelect(i) {
  const fr = animFrames(); if (!fr.length) return; i = clamp(i, 0, fr.length - 1); animRT.last = i;
  const F = fr[i]; if (floating) commitTransform(); textEndEdit?.();
  let T = F; if (F.type === 'group') { const px = []; walk(F.children, x => { if (x.type === 'pixel') px.push(x); }); T = px.pop() || F; }
  doc.active = T; doc.editMask = false; doc.ver++; requestRender(); renderLayers(); renderAnimBar();
}
function animLayerSelected() { if (animOn()) { doc.ver++; requestRender(); renderAnimBar(); } }
function animStep(d) { if (!animOn()) return; animStop(); const n = animFrames().length; animSelect((animCurIndex() + d + n) % n); }
function animNewFrame(dup) {
  if (!animOn()) toggleAnimMode(true);
  if (!prepEdit()) return;
  const fr = animFrames(), cur = fr[animCurIndex()];
  let F;
  if (dup && cur) { freezeAll(); F = cloneLayer(cur); F.name = 'Frame ' + (fr.length + 1); }
  else F = new Layer('pixel', 'Frame ' + (fr.length + 1), doc.w, doc.h);
  if (cur) doc.root.splice(doc.root.indexOf(cur) + 1, 0, F); else doc.root.splice(animCfg().fg && doc.root.length ? doc.root.length - 1 : doc.root.length, 0, F);
  doc.active = F; if (F.type === 'group') animSelect(animFrames().indexOf(F));
  doc.ver++; histPush(dup ? 'Duplicate Frame' : 'New Frame'); renderAnimBar();
}
async function animDeleteFrame() {
  if (!prepEdit()) return; const fr = animFrames(); if (fr.length <= 1) { Aero.toast('An animation needs at least one frame'); return; }
  const i = animCurIndex(), F = fr[i]; removeLayer(F);
  doc.active = null; animSelect(Math.min(i, fr.length - 2)); histPush('Delete Frame'); R.gc();
}
function animMoveFrame(d) {
  if (!prepEdit()) return; const fr = animFrames(), i = animCurIndex(), j = i + d; if (j < 0 || j >= fr.length) return;
  const a = doc.root.indexOf(fr[i]), b = doc.root.indexOf(fr[j]); [doc.root[a], doc.root[b]] = [doc.root[b], doc.root[a]];
  doc.ver++; histPush('Move Frame'); animSelect(j);
}

/* ---------- playback ---------- */
function animPlay() {
  if (!animOn()) toggleAnimMode(true);
  if (animRT.playing) { animStop(); return; }
  const n = animFrames().length; if (n < 2) { Aero.toast('Add frames first (Animation › New Frame)'); return; }
  dryAllWet(); if (floating) commitTransform();
  animRT.playing = true; animRT.playIdx = animCurIndex(); animRT.dir = 1;
  const tick = () => {
    if (!animRT.playing) return;
    const a = animCfg(), n = animFrames().length; let i = animRT.playIdx + animRT.dir;
    if (a.loop === 'pingpong') { if (i >= n || i < 0) { animRT.dir = -animRT.dir; i = animRT.playIdx + animRT.dir; } }
    else if (i >= n) { if (a.loop === 'once') { animStop(); return; } i = 0; }
    animRT.playIdx = clamp(i, 0, n - 1); doc.ver++; requestRender(); renderAnimBar(true);
    animRT.timer = setTimeout(tick, 1000 / a.fps);
  };
  doc.ver++; requestRender(); renderAnimBar(); animRT.timer = setTimeout(tick, 1000 / animCfg().fps);
}
function animStop() { if (!animRT.playing) return; animRT.playing = false; clearTimeout(animRT.timer); doc.ver++; requestRender(); renderAnimBar(); }

/* ---------- frame rendering ---------- */
// RGBA8 of frame i at w×h (flattened on white, or straight with transparency)
function animRenderFrame(i, w, h, white = true) {
  animRT.force = i;
  try {
    R.compose();
    if (w === doc.w && h === doc.h && !white) return R.readComposite();
    const px = R.readScaled(w, h, white);
    if (!white) for (let k = 0; k < px.length; k += 4) { const a = px[k + 3]; if (a && a < 255) { px[k] = px[k] * 255 / a; px[k + 1] = px[k + 1] * 255 / a; px[k + 2] = px[k + 2] * 255 / a; } }
    return px;
  } finally { animRT.force = null; composedVer = -1; requestRender(); }
}

/* ---------- timeline bar ---------- */
function initAnimBar() {
  const b = $('#animbar');
  b.innerHTML = `<div class="ab-ctl">
      <button class="aero-btn small" id="ab-play" title="Play / pause (Ctrl+Shift+Space)">▶ Play</button>
      <label>FPS <select id="ab-fps">${[1, 2, 4, 6, 8, 10, 12, 15, 24, 30].map(v => `<option value="${v}">${v}</option>`).join('')}</select></label>
      <label><select id="ab-loop"><option value="loop">Loop</option><option value="pingpong">Ping-pong</option><option value="once">One shot</option></select></label>
      <span class="sep"></span>
      <label title="Onion skin frames before / after">Onion <select id="ab-before">${[0, 1, 2, 3, 4, 5].map(v => `<option>${v}</option>`).join('')}</select> / <select id="ab-after">${[0, 1, 2, 3, 4, 5].map(v => `<option>${v}</option>`).join('')}</select></label>
      <label>Opacity <input type="range" id="ab-op" min="5" max="90" style="width:70px"></label>
      <label><input type="checkbox" id="ab-bg">Background</label><label><input type="checkbox" id="ab-fg">Foreground</label>
      <span class="sep"></span>
      <button class="aero-btn small" id="ab-new" title="New frame (Ctrl+Alt+N)">+ Frame</button><button class="aero-btn small" id="ab-dup" title="Duplicate frame">Duplicate</button>
      <button class="aero-btn small" id="ab-left" title="Move frame earlier">◀</button><button class="aero-btn small" id="ab-right" title="Move frame later">▶</button>
      <button class="aero-btn small" id="ab-del" title="Delete frame">Delete</button>
      <span style="flex:1"></span><button class="aero-btn small" id="ab-export">Export…</button></div>
    <div class="ab-strip" id="ab-strip"></div>`;
  const a = () => animCfg(), ch = fn => e => { fn(e.target); doc.ver++; requestRender(); Aero.setDirty(true); renderAnimBar(); e.target.blur?.(); };
  $('#ab-play').onclick = animPlay; $('#ab-new').onclick = () => animNewFrame(false); $('#ab-dup').onclick = () => animNewFrame(true);
  $('#ab-del').onclick = animDeleteFrame; $('#ab-left').onclick = () => animMoveFrame(-1); $('#ab-right').onclick = () => animMoveFrame(1); $('#ab-export').onclick = dlgAnimExport;
  $('#ab-fps').onchange = ch(t => a().fps = +t.value); $('#ab-loop').onchange = ch(t => a().loop = t.value);
  $('#ab-before').onchange = ch(t => a().before = +t.value); $('#ab-after').onchange = ch(t => a().after = +t.value);
  $('#ab-op').oninput = ch(t => a().onionOp = t.value / 100);
  $('#ab-bg').onchange = ch(t => a().bg = t.checked); $('#ab-fg').onchange = ch(t => a().fg = t.checked);
}
function renderAnimBar(light) {
  const b = $('#animbar'); if (!b || !doc) return;
  const on = animOn(); b.hidden = !on; if (!on) return;
  const a = doc.anim, fr = animFrames(), cur = animCurIndex();
  $('#ab-play').textContent = animRT.playing ? '❚❚ Pause' : '▶ Play';
  if (!light) {
    $('#ab-fps').value = String(a.fps); $('#ab-loop').value = a.loop; $('#ab-before').value = String(a.before); $('#ab-after').value = String(a.after);
    $('#ab-op').value = Math.round(a.onionOp * 100); $('#ab-bg').checked = a.bg; $('#ab-fg').checked = a.fg;
  }
  const strip = $('#ab-strip');
  if (strip.children.length !== fr.length || !light) {
    strip.innerHTML = '';
    fr.forEach((F, i) => {
      const c = el('div', 'ab-cell'); c.dataset.i = i;
      const cv = el('canvas'); cv.width = 64; cv.height = 40; c.append(cv, el('span', 'ab-n', String(i + 1)));
      c.title = F.name; c.onclick = () => { animStop(); animSelect(i); };
      strip.appendChild(c);
      const t = animRT.thumbs.get(F); if (t) cv.getContext('2d').drawImage(t.cv, 0, 0);
    });
    animThumbsSoon();
  }
  [...strip.children].forEach((c, i) => c.classList.toggle('on', i === cur));
  strip.children[cur]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function animThumbsSoon() { clearTimeout(animRT.thumbT); animRT.thumbT = setTimeout(animThumbs, 350); }
function animThumbs() {
  if (!animOn() || animRT.playing || activeStroke || !R) return;
  const fr = animFrames(), strip = $('#ab-strip'), bgk = doc.anim.bg ? R.layerKey([doc.root[0]]) : '', fgk = doc.anim.fg ? R.layerKey([doc.root[doc.root.length - 1]]) : '';
  const s = Math.min(64 / doc.w, 40 / doc.h), w = Math.max(2, Math.round(doc.w * s)), h = Math.max(2, Math.round(doc.h * s));
  let did = 0;
  fr.forEach((F, i) => {
    const key = R.layerKey([F]) + bgk + fgk + w + 'x' + h, t = animRT.thumbs.get(F);
    if (t && t.key === key || /live/.test(key)) return;
    const px = animRenderFrame(i, w, h, true), cv = el('canvas'); cv.width = 64; cv.height = 40; const c = cv.getContext('2d');
    c.fillStyle = '#e8eef5'; c.fillRect(0, 0, 64, 40); c.putImageData(new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, w * h * 4), w, h), (64 - w) >> 1, (40 - h) >> 1);
    animRT.thumbs.set(F, { key, cv }); did++;
    const dst = strip?.children[i]?.querySelector('canvas'); if (dst) dst.getContext('2d').drawImage(cv, 0, 0);
  });
  if (did) { composedVer = -1; requestRender(); }
}

/* ---------- settings persistence (untrusted on load) ---------- */
function animSerialize() { return doc.anim ? { ...doc.anim } : undefined; }
function animLoad(o) {
  animStop(); animRT.thumbs.clear(); animRT.last = 0;
  if (!o || typeof o !== 'object') { doc.anim = null; renderAnimBar(); return; }
  const n = (v, a, b, d) => Number.isFinite(+v) ? clamp(+v, a, b) : d;
  doc.anim = { on: !!o.on, fps: n(o.fps, 1, 60, 8), before: n(o.before, 0, 5, 1) | 0, after: n(o.after, 0, 5, 1) | 0, onionOp: n(o.onionOp, 0.05, 0.9, 0.35), tint: o.tint !== false, bg: !!o.bg, fg: !!o.fg, loop: ['loop', 'pingpong', 'once'].includes(o.loop) ? o.loop : 'loop' };
}

/* ---------- export ---------- */
function dlgAnimExport() {
  if (!animOn()) { Aero.toast('Turn on Animation › Animation Mode first'); return; }
  const n = animFrames().length;
  Aero.dialog({ title: 'Export Animation', instruction: `${n} frame${n === 1 ? '' : 's'} at ${animCfg().fps} fps`, ok: 'Export', fields: [
    { key: 'fmt', label: 'Format', type: 'select', options: [['gif', 'Animated GIF'], ['mp4', 'MP4 video (H.264)'], ['webm', 'WebM video (VP9)'], ['png', 'PNG frames (.zip)']], value: 'gif' },
    { key: 's', label: 'Size', type: 'select', options: [['0.25', '25%'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%']], value: Math.max(doc.w, doc.h) > 1600 ? '0.5' : '1' },
    { key: 'rep', label: 'Repeat (GIF / video)', type: 'select', options: [['0', 'Loop forever'], ['1', 'Play once'], ['3', '3 times']], value: '0' }],
    onOK: async v => {
      Aero.busy('Rendering animation…'); await sleep(20);
      try { const r = await animExport(v.fmt, +v.s, +v.rep); Aero.busy(); if (r) { await Aero.saveFile({ name: `${doc.name}.${r.ext}`, data: r.data, filters: [{ name: r.label, extensions: [r.ext] }] }); Aero.toast(`Exported ${r.frames} frames (${(r.data.length / 1024).toFixed(0)} KB)`); } }
      catch (e) { Aero.busy(); console.warn(e); Aero.alert('Animation export failed', String(e.message || e)); }
    } });
}
async function animExport(fmt, scale = 1, repeat = 0) {
  dryAllWet(); if (floating) commitTransform(); animStop();
  const a = animCfg(), fr = animFrames(), nF = fr.length; if (!nF) throw new Error('No frames');
  let w = Math.max(2, Math.round(doc.w * scale)), h = Math.max(2, Math.round(doc.h * scale));
  if (fmt === 'mp4' || fmt === 'webm') { w -= w & 1; h -= h & 1; }
  const loops = repeat === 0 ? 1 : repeat;
  if (fmt === 'png') {
    const files = {};
    for (let i = 0; i < nF; i++) files[`frame_${String(i + 1).padStart(3, '0')}.png`] = [pngEncode(w, h, animRenderFrame(i, w, h, false), 6), { level: 0 }];
    return { data: fflate.zipSync(files), ext: 'zip', label: 'ZIP archive', frames: nF };
  }
  if (fmt === 'gif') {
    const G = await import('../vendor/gifenc.esm.js'), enc = G.GIFEncoder(), delay = Math.round(1000 / a.fps);
    for (let i = 0; i < nF; i++) {
      const px = animRenderFrame(i, w, h, true), rgb = new Uint8Array(px.buffer, px.byteOffset, px.length);
      const pal = G.quantize(rgb, 256), idx = G.applyPalette(rgb, pal);
      enc.writeFrame(idx, w, h, { palette: pal, delay, repeat: repeat === 0 ? 0 : repeat === 1 ? -1 : repeat - 1 });
      if (i % 4 === 3) { Aero.busy(`Encoding GIF… ${i + 1}/${nF}`); await sleep(0); }
    }
    enc.finish(); return { data: enc.bytes(), ext: 'gif', label: 'GIF image', frames: nF };
  }
  if (typeof VideoEncoder === 'undefined') throw new Error('Video encoding (WebCodecs) is not available here — export a GIF instead');
  const fps = a.fps, cands = fmt === 'mp4' ? ['avc1.640034', 'avc1.4d0034', 'avc1.42003e', 'avc1.640028'] : ['vp09.00.40.08', 'vp09.00.10.08', 'vp8'];
  let cfg = null; for (const codec of cands) { const c = { codec, width: w, height: h, bitrate: 6e6, framerate: fps, ...(fmt === 'mp4' ? { avc: { format: 'avc' } } : {}) }; try { if ((await VideoEncoder.isConfigSupported(c)).supported) { cfg = c; break; } } catch (e) { } }
  if (!cfg) throw new Error(fmt === 'mp4' ? 'No H.264 encoder available — try WebM or GIF' : 'No VP9/VP8 encoder available');
  const muxer = fmt === 'mp4' ? new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: 'avc', width: w, height: h, frameRate: fps }, fastStart: 'in-memory' })
    : new WebMMuxer.Muxer({ target: new WebMMuxer.ArrayBufferTarget(), video: { codec: cfg.codec.startsWith('vp8') ? 'V_VP8' : 'V_VP9', width: w, height: h, frameRate: fps } });
  let err = null; const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => err = e }); enc.configure(cfg);
  const frames = []; for (let i = 0; i < nF; i++) frames.push(animRenderFrame(i, w, h, true));
  let n = 0; const dur = 1e6 / fps;
  for (let l = 0; l < loops; l++) for (const px of frames) {
    const f = new VideoFrame(px, { format: 'RGBA', codedWidth: w, codedHeight: h, timestamp: Math.round(n * dur), duration: Math.round(dur) });
    enc.encode(f, { keyFrame: n % (fps * 2) === 0 }); f.close(); n++;
    while (enc.encodeQueueSize > 6) await sleep(2);
    if (err) throw err;
  }
  await enc.flush(); enc.close(); if (err) throw err; muxer.finalize();
  return { data: new Uint8Array(muxer.target.buffer), ext: fmt, label: fmt === 'mp4' ? 'MP4 video' : 'WebM video', frames: n };
}
function dlgOnion() {
  const a = animCfg();
  Aero.dialog({ title: 'Onion Skin', fields: [
    { key: 'b', label: 'Frames before', type: 'range', min: 0, max: 5, value: a.before }, { key: 'f', label: 'Frames after', type: 'range', min: 0, max: 5, value: a.after },
    { key: 'o', label: 'Opacity', type: 'range', min: 5, max: 90, value: Math.round(a.onionOp * 100), fmt: v => v + '%' }, { key: 't', label: 'Color tint (red before, green after)', type: 'checkbox', value: a.tint }],
    onChange: v => { a.before = v.b; a.after = v.f; a.onionOp = v.o / 100; a.tint = v.t; doc.ver++; requestRender(); },
    onOK: () => { renderAnimBar(); Aero.setDirty(true); } });
}
