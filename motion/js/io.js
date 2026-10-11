'use strict';
/* Lumen Motion — project files (.lmot), media import, expression trust, export (MP4/WebM/GIF/PNG). */
(function () {
  const LM = window.LM, F = LM.factory, st = LM.st, esc = Aero.esc, el = Aero.el;
  const FILTER = [{ name: 'Lumen Motion Project', extensions: ['lmot'] }];

  /* ---------- media ---------- */
  const b64 = bytes => { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };
  const dataURLToBlob = d => { const [h, b] = d.split(','), mime = /data:([^;]+)/.exec(h)?.[1] || 'application/octet-stream'; const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: mime }); };
  async function loadMedia(a) {
    if (a.type === 'image') {
      const img = new Image(); img.src = a.data; await img.decode();
      a.w = a.w || img.naturalWidth; a.h = a.h || img.naturalHeight;
      LM.media.set(a.id, { img });
    } else {
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.crossOrigin = 'anonymous';
      const url = URL.createObjectURL(a.blob || dataURLToBlob(a.data)); v.src = url;
      await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error('This video format cannot be decoded')); });
      a.w = v.videoWidth; a.h = v.videoHeight; a.duration = v.duration; delete a.blob;
      LM.media.set(a.id, { video: v, url });
    }
  }
  LM.loadMedia = loadMedia;
  const IMG = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i, VID = /\.(mp4|m4v|webm|mov|ogv|mkv)$/i;
  LM.importFiles = async (files, addToComp = true) => {
    let n = 0;
    for (const f of files) {
      if (/\.lmot$/i.test(f.name)) { await LM.loadProject(f.data, f.name, f.path); return; }
      const isImg = IMG.test(f.name) || /^image\//.test(f.type || ''), isVid = VID.test(f.name) || /^video\//.test(f.type || '');
      if (!isImg && !isVid) { Aero.toast(`Can't import ${f.name}`); continue; }
      const bytes = new Uint8Array(f.data);
      if (isVid && bytes.length > 300e6) { Aero.alert('Import', `${f.name} is larger than 300 MB. Trim it first — videos are embedded in the project file.`); continue; }
      const mime = f.type || (isImg ? 'image/' + (f.name.split('.').pop().toLowerCase().replace('jpg', 'jpeg').replace('svg', 'svg+xml')) : 'video/' + (/\.webm$/i.test(f.name) ? 'webm' : 'mp4'));
      const a = { id: LM.uid(), name: f.name, type: isImg ? 'image' : 'video', mime, data: `data:${mime};base64,${b64(bytes)}` };
      if (isVid) a.blob = new Blob([bytes], { type: mime });
      try { Aero.busy('Importing ' + f.name + '…'); await loadMedia(a); } catch (e) { Aero.busy(); Aero.alert('Import failed', `${f.name}: ${e.message}`); continue; } finally { Aero.busy(); }
      LM.assets.set(a.id, a); n++;
      if (addToComp) LM.addAssetLayer(a); else LM.renderProject();
    }
    if (n) Aero.toast(`Imported ${n} file${n > 1 ? 's' : ''}`);
  };
  LM.importDialog = async () => { const files = await Aero.openFile({ accept: 'image/*,video/*,.lmot', multiple: true, filters: [{ name: 'Images & Video', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'mp4', 'webm', 'mov', 'm4v'] }] }); if (files.length) LM.importFiles(files); };

  /* ---------- project save / load ---------- */
  LM.serialize = () => JSON.stringify({ format: 'lumen-motion', version: 1, app: 'Lumen Motion', name: LM.doc.name, active: LM.doc.active, comps: LM.doc.comps, assets: [...LM.assets.values()].filter(a => LM.doc.comps.some(c => c.layers.some(l => l.asset === a.id))).map(a => ({ id: a.id, name: a.name, type: a.type, mime: a.mime, w: a.w, h: a.h, duration: a.duration, data: a.data })) });
  LM.saveProject = async (as) => {
    const name = (LM.doc.name || 'Untitled').replace(/\.lmot$/i, '') + '.lmot';
    const p = await Aero.saveFile({ name, data: LM.serialize(), filters: FILTER, path: as ? undefined : LM.doc.path || undefined });
    if (!p) return false;
    if (Aero.isDesktop) LM.doc.path = p;
    LM.doc.name = Aero.baseName(p); Aero.setDoc(LM.doc.name, false); Aero.toast('Saved ' + LM.doc.name + '.lmot'); return true;
  };
  LM.openProject = async () => {
    if (Aero.dirty && !(await Aero.confirm('Open Project', 'Discard unsaved changes to the current project?', 'Discard'))) return;
    const f = await Aero.openFile({ accept: '.lmot,application/json', filters: FILTER });
    if (f[0]) await LM.loadProject(f[0].data, f[0].name, f[0].path);
  };
  // validate & sanitize untrusted project JSON
  const HEX = /^#[0-9a-f]{6}$/i;
  function sanitize(o) {
    if (!o || o.format !== 'lumen-motion' || !Array.isArray(o.comps) || !o.comps.length) throw new Error('Not a Lumen Motion project');
    const num = (v, d, a = -1e7, b = 1e7) => typeof v === 'number' && isFinite(v) ? Math.min(b, Math.max(a, v)) : d;
    const str = (v, d = '') => typeof v === 'string' ? v.slice(0, 20000) : d;
    const col = v => typeof v === 'string' && HEX.test(v) ? v : '#808080';
    const TYPES = ['solid', 'shape', 'text', 'image', 'video', 'null', 'adjust', 'precomp', 'draw'];
    const ids = new Set(o.comps.map(c => c.id));
    o.comps.forEach(c => {
      c.id = str(c.id) || LM.uid(); c.name = str(c.name, 'Comp'); c.w = Math.round(num(c.w, 1920, 16, 8192)); c.h = Math.round(num(c.h, 1080, 16, 8192)); c.fps = num(c.fps, 30, 1, 120); c.duration = num(c.duration, 10, .05, 3600); c.bg = col(c.bg);
      c.workIn = num(c.workIn, 0, 0, c.duration); c.workOut = num(c.workOut, c.duration, 0, c.duration); c.mb = c.mb && typeof c.mb === 'object' ? { angle: num(c.mb.angle, 180, 0, 720), phase: num(c.mb.phase, -90, -360, 360), samples: Math.round(num(c.mb.samples, 8, 2, 64)) } : { angle: 180, phase: -90, samples: 8 }; c.mbOn = !!c.mbOn;
      c.layers = Array.isArray(c.layers) ? c.layers.filter(L => L && TYPES.includes(L.type)) : [];
      c.layers.forEach(L => {
        L.id = str(L.id) || LM.uid(); L.name = str(L.name, 'Layer').slice(0, 200); L.label = Math.round(num(L.label, 2, 0, 10)); L.blend = LM.BLENDS.some(b => b[0] === L.blend) ? L.blend : 'normal';
        L.matte = ['alpha', 'alphaInv', 'luma', 'lumaInv'].includes(L.matte) ? L.matte : null; L.parent = typeof L.parent === 'string' ? L.parent : null;
        L.masks = Array.isArray(L.masks) ? L.masks : []; L.effects = Array.isArray(L.effects) ? L.effects.filter(f => f && LM.FX[f.type] && f.p) : [];
        if (L.type === 'precomp' && !ids.has(L.comp)) L.type = 'null';
        // ensure every effect has all params
        L.effects.forEach(fx => LM.FX[fx.type].params.forEach(q => { if (!fx.p[q.k]) fx.p[q.k] = q.static ? { v: q.v, s: 1 } : { v: LM.clone(q.v) }; }));
      });
    });
    // fill missing structure from a fresh default layer of the same type, then validate every property value
    const fill = (dst, def) => {
      for (const k of Object.keys(def)) {
        const d = def[k], x = dst[k];
        if (k === 'parent' || k === 'matte') continue;
        if (x === undefined || x === null || typeof x !== typeof d || Array.isArray(x) !== Array.isArray(d)) { dst[k] = LM.clone(d); continue; }
        if (d && typeof d === 'object' && !Array.isArray(d)) fill(x, d);
      }
    };
    const fake = { w: 100, h: 100, id: '', name: '' };
    const defOf = (c, L) => ({ solid: () => F.solid(c), shape: () => F.shape(c, 'rect'), text: () => F.text(c), image: () => F.image(c, fake), video: () => F.video(c, fake), null: () => F.nul(c), adjust: () => F.adjust(c), precomp: () => F.precomp(c, c), draw: () => F.draw(c) })[L.type]();
    const isNum = x => typeof x === 'number' && isFinite(x);
    const okVal = (type, v) => {
      switch (type) {
        case 'num': case 'pct': case 'angle': return isNum(v);
        case 'vec2': case 'vec2pct': return Array.isArray(v) && v.length >= 2 && v.every(isNum);
        case 'color': return typeof v === 'string' && HEX.test(v);
        case 'path': return v && typeof v === 'object' && Array.isArray(v.pts) && v.pts.length < 5000 && v.pts.every(p => Array.isArray(p) && p.length === 6 && p.every(isNum));
        case 'drawing': return Array.isArray(v) && v.every(s => s && typeof s === 'object' && Array.isArray(s.pts) && s.pts.every(isNum) && isNum(s.w) && (s.c === undefined || HEX.test(s.c)));
      }
      return false;
    };
    o.comps.forEach(c => {
      c.layers = c.layers.filter(L => { try { const d = defOf(c, L); fill(L, d); if (L.text) L.text.animators.forEach(A => fill(A, F.animator())); L.masks = L.masks.filter(m => m && typeof m === 'object'); L.masks.forEach(m => fill(m, F.mask('rect', []))); if (L.type === 'draw') L.draw.cels.k = Array.isArray(L.draw.cels.k) ? L.draw.cels.k : [{ t: 0, v: [], i: 'hold', o: 'hold' }]; L.start = num(L.start, 0); L.in = num(L.in, 0); L.out = num(L.out, c.duration); L.visible = L.visible !== false; L.solo = !!L.solo; L.locked = !!L.locked; L.mb = !!L.mb; L.expanded = false; LM.propTree(L, c); return true; } catch (e) { console.warn('Dropped invalid layer', e); return false; } });
      LM.link(c);
      c.layers.forEach(L => {
        if (L.text) { L.text.str = str(L.text.str, 'Text'); if (!LM.FONTS.includes(L.text.font)) L.text.font = 'Segoe UI'; if (!['left', 'center', 'right'].includes(L.text.align)) L.text.align = 'center'; L.text.weight = ['300', '400', '600', '700', '900'].includes(String(L.text.weight)) ? String(L.text.weight) : '700'; }
        if (L.shape && !['rect', 'ellipse', 'polygon', 'star', 'path'].includes(L.shape.kind)) L.shape.kind = 'rect';
        if (L.shape && !['butt', 'round', 'square'].includes(L.shape.stroke.cap)) L.shape.stroke.cap = 'round';
        L.masks.forEach(m => { if (!['add', 'subtract', 'intersect', 'none'].includes(m.mode)) m.mode = 'add'; m.inv = !!m.inv; m.name = str(m.name, 'Mask').slice(0, 100); });
        L.effects.forEach(fx => { fx.on = fx.on !== false; LM.FX[fx.type].params.forEach(q => { if (q.static) { const ok = q.options === 'bool' ? typeof fx.p[q.k].v === 'boolean' : q.options.some(x => x[0] === fx.p[q.k].v); if (!ok) fx.p[q.k] = { v: q.v, s: 1 }; } }); });
        LM.leaves(L).forEach(n => {
          const p = n.p, def = LM.clone(LM.leaves(defOf(c, L)).find(d => d.id === n.id)?.p.v ?? (n.type === 'color' ? '#808080' : 0));
          if (!okVal(n.type, p.v)) p.v = def;
          if (p.k !== undefined) { p.k = Array.isArray(p.k) ? p.k.filter(k => k && isNum(k.t) && okVal(n.type, k.v)).slice(0, 5000) : []; p.k.forEach(k => { ['i', 'o'].forEach(s => { if (!['linear', 'ease', 'hold', 'bezier'].includes(k[s])) k[s] = 'linear'; }); ['ei', 'eo', 'si', 'so'].forEach(s => { if (k[s] !== undefined && !(Array.isArray(k[s]) && k[s].length === 2 && k[s].every(isNum))) delete k[s]; }); }); p.k.sort((a, b) => a.t - b.t); if (!p.k.length) delete p.k; }
          if (p.x !== undefined && typeof p.x !== 'string') delete p.x; if (typeof p.x === 'string') p.x = p.x.slice(0, 4000);
        });
      });
    });
    o.assets = Array.isArray(o.assets) ? o.assets.filter(a => a && typeof a.data === 'string' && /^data:(image\/(png|jpeg|gif|webp|bmp|svg\+xml|avif)|video\/(mp4|webm|quicktime|ogg|x-matroska));base64,/.test(a.data) && (a.type === 'image' || a.type === 'video')) : [];
    if (!ids.has(o.active)) o.active = o.comps[0].id;
    return o;
  }
  LM.loadProject = async (data, name, path) => {
    let o;
    try { o = sanitize(JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data))); }
    catch (e) { Aero.alert('Open Project', `Couldn't open ${name || 'file'}: ${e.message}`); return false; }
    LM.stop?.(); LM.media.forEach(m => m.url && URL.revokeObjectURL(m.url)); LM.media.clear(); LM.assets.clear();
    Aero.busy('Loading media…');
    for (const a of o.assets) { const as = { id: a.id, name: String(a.name || 'media'), type: a.type, mime: a.mime, w: a.w, h: a.h, duration: a.duration, data: a.data }; try { await loadMedia(as); LM.assets.set(as.id, as); } catch (e) { console.warn('media', e); } }
    Aero.busy();
    LM.doc.comps = o.comps; LM.doc.active = o.active; LM.doc.name = (name || o.name || 'Untitled').replace(/\.lmot$/i, ''); LM.doc.path = path || null;
    st.sel = []; st.selKeys.clear(); st.selProps.clear(); st.time = 0; LM.ui.open.clear(); LM.tl.openTabs.clear();
    LM.resetHistory('Open Project'); LM.setActiveComp(o.active); LM.cacheReset();
    LM.checkExpressionTrust();
    return true;
  };

  /* ---------- expression trust (code that arrives in a file must be approved before it runs) ---------- */
  function untrusted() { const s = new Set(); LM.doc.comps.forEach(c => c.layers.forEach(L => LM.leaves(L).forEach(n => { if (n.p.x && !LM.trusted.has(n.p.x)) s.add(n.p.x); }))); return [...s]; }
  LM.checkExpressionTrust = () => {
    const codes = untrusted(); if (!codes.length) return;
    LM.emit('change');
    Aero.dialog({
      title: 'This project contains expressions', ok: 'Allow expressions', cancel: 'Keep disabled', width: 560,
      instruction: `${codes.length} expression${codes.length > 1 ? 's' : ''} came with this file.`,
      html: `<p class="dnote">Expressions are small programs that drive property values. They run in a restricted sandbox, but only allow them if you trust where this file came from. Until then those properties use their keyframed values. You can decide later from Edit › Enable Expressions…</p><pre class="codeprev">${esc(codes.join('\n\n'))}</pre>`,
      onOK: () => { codes.forEach(c => LM.trusted.add(c)); LM.st.ver++; LM.emit('structure'); LM.emit('change'); LM.requestRender(); Aero.toast('Expressions enabled'); }
    });
  };
  LM.reviewExpressions = () => { if (!untrusted().length) return Aero.toast('All expressions in this project are enabled'); LM.checkExpressionTrust(); };

  /* ---------- progress modal ---------- */
  function progress(title) {
    const ov = el('div', 'aero-modal'), box = el('div', 'aero-box');
    box.innerHTML = `<h3><img src="../kit/icons/motion.png" alt="">${esc(title)}</h3><div class="content"><div class="aero-instr">Rendering…</div><div class="pbar"><i></i></div><div class="dim pinfo">&nbsp;</div></div><div class="aero-btns"><button class="aero-btn">Cancel</button></div>`;
    ov.appendChild(box); document.body.appendChild(ov);
    const P = { cancelled: false, set(f, msg, info) { box.querySelector('.pbar i').style.width = (f * 100).toFixed(1) + '%'; if (msg) box.querySelector('.aero-instr').textContent = msg; if (info != null) box.querySelector('.pinfo').textContent = info; }, close() { ov.remove(); } };
    box.querySelector('button').onclick = () => { P.cancelled = true; };
    return P;
  }
  const tick = () => new Promise(r => setTimeout(r, 0));

  /* ---------- export ---------- */
  const even = n => Math.max(2, Math.round(n / 2) * 2);
  LM.exportDialog = (fmt = 'mp4') => {
    const c = LM.comp(); if (!c) return;
    Aero.dialog({
      title: 'Render & Export', width: 520, ok: 'Render…',
      instruction: `Composition “${c.name}” — frame-accurate offline render`,
      fields: [
        { key: 'fmt', label: 'Format', type: 'select', value: fmt, options: [['mp4', 'MP4 video (H.264)'], ['webm', 'WebM video (VP9)'], ['gif', 'Animated GIF'], ['png', 'PNG sequence (.zip)'], ['frame', 'Current frame as PNG']] },
        { key: 'range', label: 'Range', type: 'select', value: c.workIn > 0 || c.workOut < c.duration ? 'work' : 'all', options: [['work', `Work area (${LM.fmtTC(c.workIn, c.fps)} – ${LM.fmtTC(c.workOut, c.fps)})`], ['all', `Entire composition (${c.duration}s)`]] },
        { key: 'scale', label: 'Resolution', type: 'select', value: fmt === 'gif' ? '0.5' : '1', options: [['1', `Full (${c.w}×${c.h})`], ['0.5', `Half (${Math.round(c.w / 2)}×${Math.round(c.h / 2)})`], ['0.25', `Quarter (${Math.round(c.w / 4)}×${Math.round(c.h / 4)})`]] },
        { key: 'quality', label: 'Video quality', type: 'select', value: 'high', options: [['low', 'Small file'], ['med', 'Medium'], ['high', 'High'], ['max', 'Maximum']] },
        { key: 'gifFps', label: 'GIF frame rate', type: 'select', value: String(Math.min(25, Math.round(c.fps / 2) || 15)), options: ['10', '12', '15', '20', '25', '30'].map(x => [x, x + ' fps']) },
        { key: 'alpha', label: 'Transparent background (PNG)', type: 'checkbox', value: false },
        { key: 'mb', label: 'Motion blur', type: 'checkbox', value: true },
      ],
      onOK: v => LM.render({ ...v, scale: +v.scale, gifFps: +v.gifFps })
    });
  };
  async function renderFrames(c, o, onFrame, P) {
    const s = o.scale || 1, W = even(c.w * s), H = even(c.h * s), sc = W / c.w;
    const f0 = o.range === 'work' ? Math.round(c.workIn * c.fps) : 0, f1 = o.range === 'work' ? Math.round(Math.min(c.workOut, c.duration) * c.fps) : Math.round(c.duration * c.fps);
    const step = o.step || 1, frames = []; for (let f = f0; f < f1; f += step) frames.push(f);
    const cv = new OffscreenCanvas(W, H); cv._ctx = cv.getContext('2d', { willReadFrequently: !!o.read });
    const t0 = performance.now();
    st.exporting = true;
    try {
    for (let i = 0; i < frames.length; i++) {
      if (P?.cancelled) return false;
      const t = frames[i] / c.fps;
      await LM.seekVideos(c, t);
      LM.renderInto(c, t, cv, { scale: sc, bg: o.alpha ? 'transparent' : undefined, mb: o.mb === false ? false : undefined });
      await onFrame(cv, i, frames.length, t);
      if (P && (i % 2 === 0 || i === frames.length - 1)) { const el2 = (performance.now() - t0) / 1000, eta = el2 / (i + 1) * (frames.length - i - 1); P.set((i + 1) / frames.length, `Rendering frame ${i + 1} of ${frames.length}`, `${W}×${H} · ${el2.toFixed(1)} s elapsed · ~${eta.toFixed(0)} s left`); await tick(); }
    }
    } finally { st.exporting = false; LM.requestRender(); }
    return { W, H, n: frames.length };
  }
  LM.renderFramesForTest = renderFrames;
  const QUAL = { low: .04, med: .08, high: .14, max: .25 };   // bits per pixel per frame
  async function pickCodec(kind, W, H, fps, bitrate) {
    if (!window.VideoEncoder) return null;
    const cands = kind === 'mp4' ? [['avc1.640034', 'avc'], ['avc1.640033', 'avc'], ['avc1.640028', 'avc'], ['avc1.4d0034', 'avc'], ['avc1.42003e', 'avc'], ['avc1.42001f', 'avc']] : [['vp09.00.41.08', 'vp9'], ['vp09.00.10.08', 'vp9'], ['vp8', 'vp8']];
    for (const [codec, short] of cands) {
      const cfg = { codec, width: W, height: H, bitrate, framerate: fps, latencyMode: 'quality' };
      if (short === 'avc') cfg.avc = { format: 'avc' };
      try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) return { cfg, short }; } catch (e) { }
    }
    return null;
  }
  LM.encodeVideo = async (c, o, P) => {
    const s = o.scale || 1, W = even(c.w * s), H = even(c.h * s), fps = c.fps, bitrate = Math.round(W * H * fps * (QUAL[o.quality] || .14));
    let kind = o.fmt, pick = await pickCodec(kind, W, H, fps, bitrate);
    if (!pick && kind === 'mp4') { pick = await pickCodec('webm', W, H, fps, bitrate); if (pick) { kind = 'webm'; Aero.toast('H.264 encoding is not available here — exporting WebM instead'); } }
    if (!pick) throw new Error('This browser cannot encode video (WebCodecs VideoEncoder unavailable)');
    let muxer;
    if (kind === 'mp4') muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: pick.short === 'avc' ? 'avc' : pick.short, width: W, height: H, frameRate: fps }, fastStart: 'in-memory' });
    else muxer = new WebMMuxer.Muxer({ target: new WebMMuxer.ArrayBufferTarget(), video: { codec: pick.short === 'vp8' ? 'V_VP8' : 'V_VP9', width: W, height: H, frameRate: fps } });
    let err = null;
    const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => err = e });
    enc.configure(pick.cfg);
    const gop = Math.max(1, Math.round(fps * 2));
    const r = await renderFrames(c, o, async (cv, i) => {
      if (err) throw err;
      const vf = new VideoFrame(cv, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      enc.encode(vf, { keyFrame: i % gop === 0 }); vf.close();
      while (enc.encodeQueueSize > 6) await new Promise(res => setTimeout(res, 2));
    }, P);
    if (!r) { enc.close(); return null; }
    await enc.flush(); enc.close(); if (err) throw err;
    muxer.finalize();
    return { bytes: new Uint8Array(muxer.target.buffer), ext: kind, mime: kind === 'mp4' ? 'video/mp4' : 'video/webm', W, H, n: r.n, codec: pick.cfg.codec };
  };
  let gifenc = null;
  LM.encodeGif = async (c, o, P) => {
    gifenc = gifenc || await import('../vendor/gifenc.esm.js');
    const step = Math.max(1, Math.round(c.fps / (o.gifFps || 15))), gfps = c.fps / step, enc = gifenc.GIFEncoder();
    const r = await renderFrames(c, { ...o, step, read: true }, async cv => {
      const { data, width, height } = cv._ctx.getImageData(0, 0, cv.width, cv.height);
      const pal = gifenc.quantize(data, 256), idx = gifenc.applyPalette(data, pal);
      enc.writeFrame(idx, width, height, { palette: pal, delay: Math.round(1000 / gfps) });
    }, P);
    if (!r) return null;
    enc.finish(); return { bytes: enc.bytes(), ext: 'gif', mime: 'image/gif', W: r.W, H: r.H, n: r.n };
  };
  LM.encodePngSeq = async (c, o, P) => {
    const files = {}, base = c.name.replace(/[^\w-]+/g, '_');
    const r = await renderFrames(c, o, async (cv, i) => { const b = await cv.convertToBlob({ type: 'image/png' }); files[`${base}_${String(i).padStart(5, '0')}.png`] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }]; }, P);
    if (!r) return null;
    return { bytes: fflate.zipSync(files), ext: 'zip', mime: 'application/zip', W: r.W, H: r.H, n: r.n };
  };
  LM.frameToPng = async (c, t, o = {}) => {
    const s = o.scale || 1, W = Math.round(c.w * s), H = Math.round(c.h * s), cv = new OffscreenCanvas(W, H);
    await LM.seekVideos(c, t); LM.renderInto(c, t, cv, { scale: s, bg: o.alpha ? 'transparent' : undefined });
    return new Uint8Array(await (await cv.convertToBlob({ type: 'image/png' })).arrayBuffer());
  };
  LM.render = async o => {
    const c = LM.comp(); LM.stop?.();
    const base = c.name.replace(/[\\/:*?"<>|]+/g, '_');
    if (o.fmt === 'frame') {
      const bytes = await LM.frameToPng(c, st.time, o);
      await Aero.saveFile({ name: `${base}_${String(Math.round(st.time * c.fps)).padStart(4, '0')}.png`, data: bytes, filters: [{ name: 'PNG image', extensions: ['png'] }] });
      LM.requestRender(); return;
    }
    const P = progress('Rendering ' + c.name);
    let res;
    try {
      res = o.fmt === 'gif' ? await LM.encodeGif(c, o, P) : o.fmt === 'png' ? await LM.encodePngSeq(c, o, P) : await LM.encodeVideo(c, o, P);
    } catch (e) { P.close(); console.warn(e); Aero.alert('Render failed', e.message || String(e)); return; }
    P.close(); LM.requestRender();
    if (!res) { Aero.toast('Render cancelled'); return; }
    const mb = (res.bytes.length / 1048576).toFixed(1);
    const saved = await Aero.saveFile({ name: `${base}.${res.ext}`, data: res.bytes, filters: [{ name: res.ext.toUpperCase(), extensions: [res.ext] }] });
    if (saved) Aero.toast(`Rendered ${res.n} frames · ${res.W}×${res.H} · ${mb} MB`);
  };
})();
