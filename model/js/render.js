// Lumen 3D — final render: worker pool driving the path tracer progressively, render window, PNG and animation output.
(function () {
  'use strict';
  const S = window.LScene, PT = window.LPT;
  const R = window.LRender = {};
  let pool = null, jobId = 0;
  function getPool() {
    if (pool) return pool;
    const n = Math.max(1, Math.min(6, (navigator.hardwareConcurrency || 4) - 1));
    pool = Array.from({ length: n }, () => { const w = new Worker('js/pt-worker.js'); w._q = null; w.onmessage = e => { const q = w._q; w._q = null; if (q) { if (e.data.type === 'error') q.reject(new Error(e.data.message)); else q.resolve(e.data); } }; w.onerror = e => { const q = w._q; w._q = null; if (q) q.reject(new Error(e.message || 'Render worker failed')); }; return w; });
    return pool;
  }
  const call = (w, msg, transfer) => new Promise((resolve, reject) => { w._q = { resolve, reject }; w.postMessage(msg, transfer || []); });
  R.workers = () => getPool().length;

  // decode material textures into RGBA arrays for the tracer
  R.textures = async function (doc) {
    const map = new Map();
    await Promise.all(doc.materials.filter(m => m.tex).map(async m => {
      if (map.has(m.tex)) return; const im = doc.images.find(i => i.id === m.tex); if (!im) return;
      const img = new Image(); img.src = im.data; try { await img.decode(); } catch (e) { return; }
      const k = Math.min(1, 2048 / Math.max(img.naturalWidth, img.naturalHeight)), w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
      const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
      map.set(m.tex, { w, h, data: g.getImageData(0, 0, w, h).data });
    }));
    return map;
  };

  // progressive render of one scene; onPass(acc, passes) after every full-image sample
  R.run = async function (scene, { samples = 64, onPass, stopped }) {
    const ws = getPool(), job = ++jobId, W = scene.width, H = scene.height;
    await Promise.all(ws.map(w => call(w, { type: 'scene', scene, job })));
    const acc = new Float32Array(W * H * 3), aux = new Float32Array(W * H * PT.AUX); let pass = 0; acc.aux = aux;
    const band = Math.max(1, Math.min(32, Math.ceil(H / (ws.length * 4))));
    for (; pass < samples; pass++) {
      if (stopped && stopped()) break;
      const queue = []; for (let y = 0; y < H; y += band) queue.push([y, Math.min(H, y + band)]);
      await Promise.all(ws.map(async w => {
        while (queue.length) {
          const [y0, y1] = queue.shift(), r = await call(w, { type: 'rows', job, y0, y1, pass });
          const d = r.data, o = y0 * W * 3; for (let i = 0; i < d.length; i++) acc[o + i] += d[i];
          const a = r.aux, oa = y0 * W * PT.AUX; for (let i = 0; i < a.length; i++) aux[oa + i] += a[i];
        }
      }));
      onPass && onPass(acc, pass + 1);
      await new Promise(r => setTimeout(r, 0));
    }
    return { acc, aux, passes: pass };
  };
  R.toImageData = (acc, n, W, H, exposure, look, dn) => dn && acc.aux ? new ImageData(PT.tonemap(PT.denoise(acc, acc.aux, n, W, H), 1, W, H, exposure, look), W, H) : new ImageData(PT.tonemap(acc, n, W, H, exposure, look), W, H);

  // ---------- render window ----------
  function windowUI(title) {
    const ov = Aero.el('div', 'aero-modal render-modal'), box = Aero.el('div', 'aero-box render-box');
    box.innerHTML = `<h3><img src="../kit/icons/model.png" alt="">${Aero.esc(title)}</h3><div class="content"><div class="rw-wrap"><canvas class="rw-canvas"></canvas></div>
      <div class="rw-bar"><span class="rw-stat">Preparing…</span><span class="rw-grow"></span><label>Exposure <input type="range" class="rw-exp" min="-3" max="3" step="0.1" value="0"></label>
      <select class="rw-look"><option value="filmic">Filmic</option><option value="standard">Standard</option></select><label title="Edge-aware denoiser guided by albedo, normals and depth"><input type="checkbox" class="rw-dn" checked> Denoise</label></div></div>
      <div class="aero-btns"><button class="aero-btn" data-a="stop">Stop</button><button class="aero-btn" data-a="save" disabled>Save PNG…</button><button class="aero-btn pri" data-a="close">Close</button></div>`;
    ov.appendChild(box); document.body.appendChild(ov);
    return { ov, box, canvas: box.querySelector('.rw-canvas'), stat: box.querySelector('.rw-stat'), exp: box.querySelector('.rw-exp'), look: box.querySelector('.rw-look'), dn: box.querySelector('.rw-dn'), btn: a => box.querySelector(`[data-a=${a}]`) };
  }
  // render the current frame of the document; returns a promise resolving when the window closes
  R.renderStill = async function (app, opts = {}) {
    const doc = app.doc, W = opts.width || doc.render.width, H = opts.height || doc.render.height, samples = opts.samples || doc.render.samples;
    const ui = windowUI(`Render – frame ${doc.anim.frame}`); let stop = false, closed = false, last = null;
    ui.canvas.width = W; ui.canvas.height = H; ui.exp.value = doc.render.exposure; ui.look.value = doc.render.look;
    const g = ui.canvas.getContext('2d'); g.fillStyle = '#2b2f36'; g.fillRect(0, 0, W, H);
    // the denoiser runs on every pass for small images, otherwise every 8th pass and at the end
    const show = final => {
      if (!last) return; const dn = ui.dn.checked && (final === true || W * H < 300000 || last.n % 8 === 0 || last.n === 1);
      if (dn || !ui.dn.checked || last.n === 1) g.putImageData(R.toImageData(last.acc, last.n, W, H, +ui.exp.value, ui.look.value, dn), 0, 0);
    };
    ui.exp.oninput = () => show(true); ui.look.onchange = () => show(true); ui.dn.onchange = () => show(true);
    ui.btn('stop').onclick = () => { stop = true; ui.btn('stop').disabled = true; };
    ui.btn('close').onclick = () => { stop = true; closed = true; ui.ov.remove(); document.removeEventListener('keydown', kh, true); };
    const kh = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); ui.btn('close').click(); } };
    document.addEventListener('keydown', kh, true);
    ui.btn('save').onclick = async () => { const blob = await new Promise(r => ui.canvas.toBlob(r, 'image/png')); await Aero.saveFile({ name: (app.docName || 'render').replace(/\.[^.]+$/, '') + '.png', data: blob, filters: [{ name: 'PNG image', extensions: ['png'] }] }); };
    const t0 = performance.now();
    try {
      const tex = await R.textures(doc);
      const scene = S.renderScene(doc, { width: W, height: H, texLookup: id => tex.get(id) || null, camera: opts.camera, meshOf: app.meshForRender });
      if (!scene.mat.length) ui.stat.textContent = 'The scene has no visible meshes — rendering the world only';
      R.lastScene = scene;
      const res = await R.run(scene, {
        samples, stopped: () => stop,
        onPass: (acc, n) => { last = { acc, n }; show(); const s = (performance.now() - t0) / 1000; ui.stat.textContent = `Sample ${n} / ${samples} · ${s.toFixed(1)} s · ${W}×${H} · ${scene.mat.length.toLocaleString()} triangles · ${getPool().length} threads`; ui.btn('save').disabled = false; R.lastImage = { acc, n, W, H }; }
      });
      if (!closed) { show(true); ui.stat.textContent += res.passes < samples ? ' · stopped' : ' · done'; ui.btn('stop').disabled = true; }
      R.lastResult = { passes: res.passes, ms: performance.now() - t0 };
    } catch (e) { ui.stat.textContent = 'Render failed: ' + e.message; }
    return ui;
  };

  // ---------- animation ----------
  function avcCodec(w, h, fps) { const fs = Math.ceil(w / 16) * Math.ceil(h / 16), mbps = fs * fps; const L = [[31, 3600, 108000], [40, 8192, 245760], [42, 8704, 522240], [50, 22080, 589824], [51, 36864, 983040], [52, 36864, 2073600]].find(([, f, r]) => fs <= f && mbps <= r) || [52]; return 'avc1.6400' + L[0].toString(16).padStart(2, '0'); }
  R.renderAnimation = async function (app, { format = 'mp4', samples = 16, width, height } = {}) {
    const doc = app.doc, a = doc.anim, W = (width || doc.render.width) & ~1, H = (height || doc.render.height) & ~1, frames = a.end - a.start + 1, fps = a.fps;
    const ui = windowUI(`Render animation – ${frames} frames`); let stop = false;
    ui.canvas.width = W; ui.canvas.height = H; ui.btn('save').style.display = 'none'; ui.exp.value = doc.render.exposure; ui.look.value = doc.render.look;
    ui.btn('stop').onclick = () => { stop = true; ui.btn('stop').disabled = true; };
    ui.btn('close').onclick = () => { stop = true; ui.ov.remove(); };
    const g = ui.canvas.getContext('2d');
    let enc = null, muxer = null, target = null, zipFiles = null, encErr = null;
    if (format === 'mp4') {
      if (!window.VideoEncoder) { format = 'zip'; Aero.toast('No video encoder in this browser — saving a PNG sequence instead'); }
      else {
        let cfg = null;
        for (const codec of [avcCodec(W, H, fps), 'avc1.640033', 'avc1.4d0033', 'avc1.42003e']) { const c = { codec, width: W, height: H, bitrate: Math.round(W * H * fps * 0.15), framerate: fps, avc: { format: 'avc' } }; try { if ((await VideoEncoder.isConfigSupported(c)).supported) { cfg = c; break; } } catch (e) { /* try next */ } }
        if (!cfg) { format = 'zip'; Aero.toast('H.264 is not available — saving a PNG sequence instead'); }
        else {
          target = new Mp4Muxer.ArrayBufferTarget(); muxer = new Mp4Muxer.Muxer({ target, fastStart: 'in-memory', firstTimestampBehavior: 'offset', video: { codec: 'avc', width: W, height: H, frameRate: fps } });
          enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: e => encErr = e }); enc.configure(cfg);
        }
      }
    }
    if (format === 'zip') zipFiles = {};
    const t0 = performance.now(), keepFrame = a.frame; let done = 0;
    try {
      const tex = await R.textures(doc);
      for (let f = a.start; f <= a.end && !stop; f++) {
        doc.anim.frame = f;
        const scene = S.renderScene(doc, { width: W, height: H, frame: f, texLookup: id => tex.get(id) || null, meshOf: app.meshForRender });
        let last = null;
        await R.run(scene, { samples, stopped: () => stop, onPass: (acc, n) => { last = { acc, n }; } });
        if (!last || stop) break;
        g.putImageData(R.toImageData(last.acc, last.n, W, H, +ui.exp.value, ui.look.value, ui.dn.checked), 0, 0);
        if (enc) { if (encErr) throw encErr; const vf = new VideoFrame(ui.canvas, { timestamp: Math.round((f - a.start) / fps * 1e6), duration: Math.round(1e6 / fps) }); enc.encode(vf, { keyFrame: (f - a.start) % (fps * 2) === 0 }); vf.close(); }
        else { const blob = await new Promise(r => ui.canvas.toBlob(r, 'image/png')); zipFiles['frame_' + String(f).padStart(4, '0') + '.png'] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }]; }
        done++; const el = (performance.now() - t0) / 1000;
        ui.stat.textContent = `Frame ${f} (${done} / ${frames}) · ${samples} samples · ${el.toFixed(0)} s elapsed · ~${Math.round(el / done * (frames - done))} s left`;
      }
      doc.anim.frame = keepFrame; app.refresh && app.refresh();
      if (!done) { ui.stat.textContent = 'Stopped before the first frame finished'; return; }
      let bytes, name, filters;
      if (enc) { await enc.flush(); enc.close(); if (encErr) throw encErr; muxer.finalize(); bytes = new Uint8Array(target.buffer); name = 'animation.mp4'; filters = [{ name: 'MP4 video', extensions: ['mp4'] }]; }
      else { bytes = fflate.zipSync(zipFiles); name = 'animation-frames.zip'; filters = [{ name: 'ZIP archive', extensions: ['zip'] }]; }
      ui.stat.textContent = `Finished ${done} frames in ${((performance.now() - t0) / 1000).toFixed(0)} s`; ui.btn('stop').disabled = true;
      R.lastAnimation = { bytes: bytes.length, frames: done, format: enc ? 'mp4' : 'zip' };
      if (!R.noSaveDialog) await Aero.saveFile({ name: (app.docName || 'animation').replace(/\.[^.]+$/, '') + (enc ? '.mp4' : '-frames.zip'), data: bytes, filters });
      void name;
    } catch (e) { ui.stat.textContent = 'Animation render failed: ' + e.message; doc.anim.frame = keepFrame; }
    return ui;
  };
})();
