'use strict';
/* Lumen Convert — AI image tools running on this device: remove background (U²-Netp), AI upscaler
   (Real-ESRGAN realesr-general-x4v3, tiled), blur faces (UltraFace RFB-320 detector + manual boxes). */
(() => {
  const { register, alias, util: U } = LC;
  const { el, esc, baseName, extOf } = U;
  const isRaster = f => (/^image\//.test(f.type) && f.type !== 'image/svg+xml') || /^(png|jpe?g|webp|avif|bmp|gif)$/.test(extOf(f.name));
  const qFmt = v => Math.round(v * 100) + '%';

  /* ---------------- Remove background ---------------- */
  const S = 320, MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
  async function bgMask(bmp, ctx) {
    const sess = await LC.ml.session('u2netp', ctx);
    ctx.progress(0.3, 'Finding the subject');
    const c = U.drawTo(bmp, S, S), px = c.getContext('2d').getImageData(0, 0, S, S).data, n = S * S;
    const inp = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) inp[k * n + i] = (px[i * 4 + k] / 255 - MEAN[k]) / STD[k];
    const out = await LC.ml.run(sess, { [sess.inputNames[0]]: await LC.ml.tensor(inp, [1, 3, S, S]) });
    const m = out[sess.outputNames[0]].data; let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < n; i++) { if (m[i] < lo) lo = m[i]; if (m[i] > hi) hi = m[i]; }
    const mask = new Float32Array(n), r = hi - lo || 1; for (let i = 0; i < n; i++) mask[i] = (m[i] - lo) / r;
    return mask;
  }
  // upscale the 320×320 mask to the full image with smooth interpolation, then shape the edge
  function fullAlpha(mask, W, H, edge) {
    const mc = U.canvas(S, S), mg = mc.getContext('2d'), id = mg.createImageData(S, S);
    for (let i = 0; i < S * S; i++) { const v = Math.round(mask[i] * 255); id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255; }
    mg.putImageData(id, 0, 0);
    const big = U.drawTo(mc, W, H), a = big.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
    const [lo, hi] = edge === 'sharp' ? [0.35, 0.65] : edge === 'soft' ? [0.02, 0.98] : [0.15, 0.85];
    const out = new Uint8ClampedArray(W * H);
    for (let i = 0; i < W * H; i++) { const v = (a[i * 4] / 255 - lo) / (hi - lo); out[i] = v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * v * (3 - 2 * v) * 255); }
    return out;
  }
  register({
    id: 'remove-bg', cat: 'img', glyph: 'cutout', name: 'Remove image background', keywords: 'remove background bg cutout transparent png erase backdrop product photo portrait ai remove.bg',
    desc: 'Cut out people, products and animals automatically. Transparent PNG at full resolution, or a new background.',
    accept: 'image/*,.avif,.bmp', acceptText: 'Photos with a clear subject: PNG, JPEG, WebP, AVIF, BMP', acceptTest: isRaster, multiple: true, zipName: 'cutouts',
    options: [
      { key: 'bg', label: 'Background', type: 'select', value: 'none', options: [['none', 'Transparent'], ['color', 'Solid colour'], ['blur', 'Blurred original']] },
      { key: 'color', label: 'Colour', type: 'color', value: '#ffffff', show: o => o.bg === 'color' },
      { key: 'edge', label: 'Edges', type: 'select', value: 'normal', options: [['soft', 'Soft (hair, fur)'], ['normal', 'Normal'], ['sharp', 'Sharp (products)']] },
      { key: 'to', label: 'Save as', type: 'select', value: 'png', options: [['png', 'PNG'], ['webp', 'WebP'], ['jpeg', 'JPEG (needs a background)']] },
      { key: 'q', label: 'Quality', type: 'range', min: 0.5, max: 1, step: 0.01, value: 0.92, fmt: qFmt, show: o => o.to !== 'png' }],
    note: 'Runs on this device with the U²-Netp model (Apache-2.0). Works best when the subject is clearly in front of the background; fine hair may look soft.',
    async each(f, o, ctx) {
      ctx.progress(0.02, 'Decoding ' + f.name);
      const bmp = await U.decodeImage(f), W = bmp.width, H = bmp.height;
      try {
        const mask = await bgMask(bmp, ctx); ctx.check();
        ctx.progress(0.7, 'Cutting out at full resolution');
        const alpha = fullAlpha(mask, W, H, o.edge);
        const cut = U.drawTo(bmp, W, H), g = cut.getContext('2d', { willReadFrequently: true }), id = g.getImageData(0, 0, W, H);
        for (let i = 0; i < W * H; i++) id.data[i * 4 + 3] = Math.round(id.data[i * 4 + 3] * alpha[i] / 255);
        g.putImageData(id, 0, 0);
        const bg = o.to === 'jpeg' && o.bg === 'none' ? 'color' : o.bg;
        let out = cut;
        if (bg !== 'none') {
          out = U.canvas(W, H); const og = out.getContext('2d');
          if (bg === 'color') { og.fillStyle = o.color; og.fillRect(0, 0, W, H); }
          else { const r = Math.max(4, Math.round(Math.max(W, H) / 60)); og.filter = `blur(${r}px)`; og.drawImage(bmp, -r * 2, -r * 2, W + r * 4, H + r * 4); og.filter = 'none'; }
          og.drawImage(cut, 0, 0);
        }
        let kept = 0; for (let i = 0; i < W * H; i++) if (alpha[i] > 127) kept++;
        const blob = await U.encodeCanvas(out, U.MIME[o.to], o.to === 'png' ? undefined : o.q);
        return { name: `${baseName(f.name)}-cutout.${o.to === 'jpeg' ? 'jpg' : o.to}`, blob, thumb: true, preview: true, info: `${W}×${H} · subject covers ${Math.round(kept / (W * H) * 100)}% of the image` };
      } finally { bmp.close(); }
    }
  });
  alias('background-remover', 'remove-bg'); alias('transparent-background', 'remove-bg');

  /* ---------------- AI upscaler (Real-ESRGAN, tiled) ---------------- */
  const TILE = 128, PAD = 10;
  async function esrgan4x(src, ctx, p0, p1) {
    const sess = await LC.ml.session('esrgan', ctx);
    const W = src.width, H = src.height, sg = src.getContext('2d', { willReadFrequently: true }), all = sg.getImageData(0, 0, W, H).data;
    const OW = W * 4, OH = H * 4, out = new ImageData(OW, OH), od = out.data;
    const tiles = []; for (let y = 0; y < H; y += TILE) for (let x = 0; x < W; x += TILE) tiles.push([x, y]);
    const t0 = performance.now();
    for (let t = 0; t < tiles.length; t++) {
      ctx.check();
      const [x, y] = tiles[t], tw = Math.min(TILE, W - x), th = Math.min(TILE, H - y);
      const x0 = Math.max(0, x - PAD), y0 = Math.max(0, y - PAD), x1 = Math.min(W, x + tw + PAD), y1 = Math.min(H, y + th + PAD), iw = x1 - x0, ih = y1 - y0, n = iw * ih;
      const inp = new Float32Array(3 * n);
      for (let yy = 0; yy < ih; yy++) for (let xx = 0; xx < iw; xx++) { const s = ((y0 + yy) * W + x0 + xx) * 4, d = yy * iw + xx; inp[d] = all[s] / 255; inp[n + d] = all[s + 1] / 255; inp[2 * n + d] = all[s + 2] / 255; }
      const res = await LC.ml.run(sess, { [sess.inputNames[0]]: await LC.ml.tensor(inp, [1, 3, ih, iw]) });
      const o = res[sess.outputNames[0]].data, ow = iw * 4, on = ow * ih * 4, ox = (x - x0) * 4, oy = (y - y0) * 4;
      for (let yy = 0; yy < th * 4; yy++) for (let xx = 0; xx < tw * 4; xx++) {
        const s = (oy + yy) * ow + ox + xx, d = ((y * 4 + yy) * OW + x * 4 + xx) * 4;
        od[d] = o[s] * 255; od[d + 1] = o[on + s] * 255; od[d + 2] = o[2 * on + s] * 255; od[d + 3] = 255;
      }
      const el2 = (performance.now() - t0) / 1000, eta = el2 / (t + 1) * (tiles.length - t - 1);
      ctx.progress(p0 + (p1 - p0) * (t + 1) / tiles.length, `Tile ${t + 1} of ${tiles.length} · about ${eta < 60 ? Math.ceil(eta) + ' s' : Math.ceil(eta / 60) + ' min'} left`);
      await U.tick();
    }
    const c = U.canvas(OW, OH); c.getContext('2d').putImageData(out, 0, 0); return c;
  }
  register({
    id: 'upscale', cat: 'img', glyph: 'sparkle', name: 'AI image upscaler', keywords: 'upscale enlarge super resolution ai enhance increase resolution 2x 4x real-esrgan sharpen topaz',
    desc: 'Enlarge photos 2× or 4× with a neural network that rebuilds detail instead of blurring.',
    accept: 'image/*,.avif,.bmp', acceptText: 'PNG, JPEG, WebP, AVIF, BMP (up to 2 MP for 4×, 4 MP for 2×)', acceptTest: isRaster, multiple: true, zipName: 'upscaled',
    options: [
      { key: 'scale', label: 'Scale', type: 'select', value: '2', options: [['2', '2×'], ['4', '4×']] },
      { key: 'to', label: 'Save as', type: 'select', value: 'png', options: [['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP']] },
      { key: 'q', label: 'Quality', type: 'range', min: 0.5, max: 1, step: 0.01, value: 0.92, fmt: qFmt, show: o => o.to !== 'png' }],
    note: 'Runs on this device with Real-ESRGAN (realesr-general-x4v3, BSD-3). It’s compute-heavy: a 1-megapixel photo takes about a minute or more. Cancel any time.',
    async each(f, o, ctx) {
      ctx.progress(0.02, 'Decoding ' + f.name);
      const bmp = await U.decodeImage(f), W = bmp.width, H = bmp.height, k = +o.scale;
      try {
        const limit = k === 4 ? 2.1e6 : 4.2e6;
        if (W * H > limit) throw new Error(`This image is ${(W * H / 1e6).toFixed(1)} MP; the limit for ${k}× is ${(limit / 1e6).toFixed(0)} MP. Resize it first (Resize images) or use 2×.`);
        const src = U.drawTo(bmp, W, H, '#ffffff');
        let hasAlpha = false; if (f.type !== 'image/jpeg') { const a = U.drawTo(bmp, W, H).getContext('2d').getImageData(0, 0, W, H).data; for (let i = 3; i < a.length; i += 4) if (a[i] < 255) { hasAlpha = true; break; } }
        const up4 = await esrgan4x(src, ctx, 0.12, 0.95);
        let out = k === 4 ? up4 : await U.resizeBitmap(up4, W * 2, H * 2);
        if (hasAlpha) { // carry transparency over (alpha upscaled smoothly)
          const c = out instanceof HTMLCanvasElement ? out : U.drawTo(out, W * k, H * k), g = c.getContext('2d');
          const am = U.drawTo(bmp, W * k, H * k); g.globalCompositeOperation = 'destination-in'; g.drawImage(am, 0, 0); g.globalCompositeOperation = 'source-over'; out = c;
        }
        if (!(out instanceof HTMLCanvasElement)) out = U.drawTo(out, W * k, H * k);
        ctx.progress(0.97, 'Encoding');
        const blob = await U.encodeCanvas(out, U.MIME[o.to], o.to === 'png' ? undefined : o.q);
        return { name: `${baseName(f.name)}-${k}x.${o.to === 'jpeg' ? 'jpg' : o.to}`, blob, thumb: true, info: `${W}×${H} → ${W * k}×${H * k}` };
      } finally { bmp.close(); }
    }
  });
  alias('ai-upscale', 'upscale'); alias('upscale-image', 'upscale');

  /* ---------------- Blur faces ---------------- */
  // UltraFace RFB-320: 320×240 input, (x-127)/128, outputs scores [1,N,2] and boxes [1,N,4] (normalised corners)
  async function detectFaces(bmp, ctx, thr = 0.7) {
    const sess = await LC.ml.session('ultraface', ctx);
    const W = bmp.width, H = bmp.height, found = [];
    const regions = [[0, 0, W, H]];
    if (Math.max(W, H) > 900) { // overlapping 2×2 tiles find faces that are small in the full frame
      const tw = W * 0.6, th = H * 0.6;
      for (const fx of [0, W - tw]) for (const fy of [0, H - th]) regions.push([fx, fy, tw, th]);
    }
    for (let r = 0; r < regions.length; r++) {
      ctx && ctx.check(); const [rx, ry, rw, rh] = regions[r];
      const c = U.canvas(320, 240), g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, rx, ry, rw, rh, 0, 0, 320, 240);
      const px = g.getImageData(0, 0, 320, 240).data, n = 320 * 240, inp = new Float32Array(3 * n);
      for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) inp[k * n + i] = (px[i * 4 + k] - 127) / 128;
      const out = await LC.ml.run(sess, { [sess.inputNames[0]]: await LC.ml.tensor(inp, [1, 3, 240, 320]) });
      const names = sess.outputNames, sc = out[names.find(x => /score/i.test(x)) || names[0]].data, bx = out[names.find(x => /box/i.test(x)) || names[1]].data;
      for (let i = 0; i < sc.length / 2; i++) {
        const s = sc[i * 2 + 1]; if (s < thr) continue;
        const x1 = rx + bx[i * 4] * rw, y1 = ry + bx[i * 4 + 1] * rh, x2 = rx + bx[i * 4 + 2] * rw, y2 = ry + bx[i * 4 + 3] * rh;
        if (x2 - x1 < 6 || y2 - y1 < 6) continue;
        found.push({ x: Math.max(0, x1), y: Math.max(0, y1), w: Math.min(W, x2) - Math.max(0, x1), h: Math.min(H, y2) - Math.max(0, y1), s });
      }
    }
    // non-maximum suppression
    found.sort((a, b) => b.s - a.s); const keep = [];
    const iou = (a, b) => { const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)), I = ix * iy; return I / (a.w * a.h + b.w * b.h - I); };
    const inside = (a, b) => { const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)), iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)); return ix * iy / Math.min(a.w * a.h, b.w * b.h); };
    for (const f of found) if (!keep.some(k => iou(k, f) > 0.3 || inside(k, f) > 0.7)) keep.push(f);
    return keep.map(({ x, y, w, h }) => ({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) }));
  }
  function applyBlur(bmp, boxes, o) {
    const W = bmp.width, H = bmp.height, c = U.drawTo(bmp, W, H), g = c.getContext('2d');
    for (const b of boxes) {
      // grow the box a little so hair line / chin are covered, then blur/pixelate inside an ellipse or rectangle
      const gx = b.w * 0.12, gy = b.h * 0.15, x = Math.max(0, b.x - gx), y = Math.max(0, b.y - gy), w = Math.min(W - x, b.w + 2 * gx), h = Math.min(H - y, b.h + 2 * gy);
      g.save(); g.beginPath();
      if (o.shape === 'ellipse') g.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); else g.rect(x, y, w, h);
      g.clip();
      if (o.style === 'black') { g.fillStyle = '#000'; g.fillRect(x, y, w, h); }
      else if (o.style === 'pixelate') {
        const cells = Math.max(4, Math.round(10 - o.strength / 2)), sw = Math.max(1, Math.round(w / Math.max(w, h) * cells)), sh = Math.max(1, Math.round(h / Math.max(w, h) * cells));
        const t = U.canvas(sw, sh), tg = t.getContext('2d'); tg.drawImage(bmp, x, y, w, h, 0, 0, sw, sh);
        g.imageSmoothingEnabled = false; g.drawImage(t, 0, 0, sw, sh, x, y, w, h);
      } else {
        const r = Math.max(3, Math.round(Math.max(w, h) * o.strength / 60));
        g.filter = `blur(${r}px)`;
        // draw a larger area than the clip so the blur has real pixels to sample at the edges (two passes = stronger)
        const sx = Math.max(0, x - 3 * r), sy = Math.max(0, y - 3 * r), sw = Math.min(W, x + w + 3 * r) - sx, sh = Math.min(H, y + h + 3 * r) - sy;
        const t = U.canvas(sw, sh), tg = t.getContext('2d'); tg.filter = `blur(${r}px)`; tg.drawImage(bmp, sx, sy, sw, sh, 0, 0, sw, sh);
        const t2 = U.canvas(sw, sh), tg2 = t2.getContext('2d'); tg2.drawImage(t, 0, 0); tg2.filter = `blur(${r}px)`; tg2.drawImage(t, 0, 0);
        g.drawImage(t2, sx, sy);
      }
      g.restore();
    }
    return c;
  }
  register({
    id: 'blur-faces', cat: 'img', glyph: 'face', name: 'Blur faces', keywords: 'blur faces anonymize privacy pixelate censor hide face redact photo gdpr',
    desc: 'Find faces automatically and blur, pixelate or black them out. Add or remove boxes by hand.',
    render(root) {
      const st = { file: null, bmp: null, boxes: [], style: 'blur', strength: 30, shape: 'ellipse', busy: false, url: null };
      const cols = el('div', 'cols'), L = el('div'), R = el('div'); cols.append(L, R); root.append(cols);
      L.append(el('div', 'ph', '<span class="phi"></span>Photo<span class="right" id="bf-n"></span>'));
      const lb = el('div', 'box'); L.append(lb);
      const drop = el('div', 'drop', `<svg viewBox="0 0 24 24"><path d="M12 15V3m0 0-4 4m4-4 4 4"/><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg><div><b>Drop a photo here</b> or click to choose</div><div class="acc">Faces are found on this device; nothing is uploaded</div>`);
      drop.tabIndex = 0; const pick = el('input'); pick.type = 'file'; pick.accept = 'image/*'; pick.className = 'vh';
      const stage = el('div'); stage.style.cssText = 'position:relative;display:none;user-select:none;touch-action:none';
      const cv = el('canvas'); cv.style.cssText = 'max-width:100%;display:block;border:1px solid #c9d6e4;cursor:crosshair';
      stage.append(cv); lb.append(drop, pick, stage);
      const hint = el('p', 'dim', 'Drag on the photo to add a box. Click a box to remove it.'); hint.style.fontSize = '12.5px'; hint.hidden = true; lb.append(hint);
      R.append(el('div', 'ph', '<span class="phi"></span>Options'));
      const rb = el('div', 'box'), form = el('div', 'form'); rb.append(form); R.append(rb);
      for (const f of [{ key: 'style', label: 'Effect', type: 'select', options: [['blur', 'Blur'], ['pixelate', 'Pixelate'], ['black', 'Black box']] },
        { key: 'strength', label: 'Strength', type: 'range', min: 5, max: 60, step: 1, fmt: v => v },
        { key: 'shape', label: 'Shape', type: 'select', options: [['ellipse', 'Oval'], ['rect', 'Rectangle']] }])
        for (const n of LC.optionField(f, st[f.key], v => { st[f.key] = v; draw(); })) form.append(n);
      const acts = el('div', 'actions'), det = el('button', null, 'Detect faces again'), clr = el('button', null, 'Clear boxes'), save = el('button', 'go big', 'Save photo');
      [det, clr, save].forEach(b => { b.type = 'button'; b.disabled = true; }); acts.append(save, det, clr); rb.append(acts);
      const status = el('p', 'dim'); status.style.fontSize = '13px'; rb.append(status);
      const prog = el('div', 'prog'); prog.hidden = true; const bar = el('div', 'bar-o'), barI = el('div', 'bar-i'), lbl = el('span', 'lbl'); bar.append(barI); prog.append(lbl, bar); root.append(prog);
      const resHead = el('div', 'ph', '<span class="phi"></span>Result'); resHead.hidden = true; const res = el('ul', 'res'); res.hidden = true; root.append(resHead, res);
      const ctx = { progress(f, l) { barI.style.width = Math.round(f * 100) + '%'; if (l) lbl.textContent = l; }, check() { }, cancelled: false, tick: U.tick };
      let scale = 1;
      function draw() {
        if (!st.bmp) return;
        const out = applyBlur(st.bmp, st.boxes, st), g = cv.getContext('2d');
        g.drawImage(out, 0, 0, cv.width, cv.height);
        g.lineWidth = 2; g.setLineDash([6, 4]); g.strokeStyle = '#2a7fd4';
        for (const b of st.boxes) g.strokeRect(b.x * scale, b.y * scale, b.w * scale, b.h * scale);
        g.setLineDash([]);
        root.querySelector('#bf-n').textContent = `${st.boxes.length} face${st.boxes.length === 1 ? '' : 's'}`;
        save.disabled = clr.disabled = !st.boxes.length; det.disabled = st.busy;
      }
      async function detect() {
        st.busy = true; prog.hidden = false; det.disabled = true; status.textContent = '';
        try { st.boxes = await detectFaces(st.bmp, ctx); status.textContent = st.boxes.length ? `Found ${st.boxes.length} face${st.boxes.length > 1 ? 's' : ''}. Check the photo and add any that were missed.` : 'No faces found. Drag on the photo to mark them by hand.'; }
        catch (e) { status.textContent = e.message; status.style.color = '#a3361c'; }
        st.busy = false; prog.hidden = true; draw(); return st.boxes;
      }
      async function load(f) {
        if (!f || !isRaster(f)) { status.textContent = 'Choose a PNG, JPEG, WebP or similar photo.'; return; }
        st.file = f; if (st.bmp) st.bmp.close(); st.bmp = await U.decodeImage(f); st.boxes = [];
        scale = Math.min(1, 900 / st.bmp.width); cv.width = Math.round(st.bmp.width * scale); cv.height = Math.round(st.bmp.height * scale);
        drop.style.display = 'none'; stage.style.display = 'block'; hint.hidden = false; res.hidden = resHead.hidden = true;
        draw(); return detect();
      }
      // manual boxes: drag to add, click to remove
      let dragStart = null;
      const pt = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * cv.width / r.width / scale, (e.clientY - r.top) * cv.height / r.height / scale]; };
      cv.onpointerdown = e => { cv.setPointerCapture(e.pointerId); dragStart = pt(e); };
      cv.onpointerup = e => {
        if (!dragStart) return; const [x0, y0] = dragStart, [x1, y1] = pt(e); dragStart = null;
        if (Math.abs(x1 - x0) < 6 && Math.abs(y1 - y0) < 6) { const i = st.boxes.findIndex(b => x0 >= b.x && x0 <= b.x + b.w && y0 >= b.y && y0 <= b.y + b.h); if (i >= 0) st.boxes.splice(i, 1); }
        else st.boxes.push({ x: Math.round(Math.min(x0, x1)), y: Math.round(Math.min(y0, y1)), w: Math.round(Math.abs(x1 - x0)), h: Math.round(Math.abs(y1 - y0)) });
        draw();
      };
      drop.onclick = () => pick.click(); drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick.click(); } };
      pick.onchange = () => { load(pick.files[0]); pick.value = ''; };
      drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); load(e.dataTransfer.files[0]); };
      det.onclick = detect; clr.onclick = () => { st.boxes = []; draw(); };
      async function exportBlob() {
        const out = applyBlur(st.bmp, st.boxes, st), jpg = /jpe?g/.test(st.file.type) || /^jpe?g$/.test(extOf(st.file.name));
        const blob = await U.encodeCanvas(out, jpg ? 'image/jpeg' : 'image/png', 0.92);
        if (st.url) URL.revokeObjectURL(st.url); st.url = URL.createObjectURL(blob);
        res.innerHTML = ''; const li = el('li'), im = el('img', 'th'); im.src = st.url; const info = el('div', 'info'); const nm = `${baseName(st.file.name)}-blurred.${jpg ? 'jpg' : 'png'}`;
        info.append(el('span', 'nm', esc(nm)), el('small', null, `${U.fmtSize(blob.size)} · ${st.boxes.length} area${st.boxes.length > 1 ? 's' : ''} hidden`));
        const a = el('a', 'btn go', 'Download'); a.href = st.url; a.download = nm; li.append(im, info, a); res.append(li); res.hidden = resHead.hidden = false;
        return blob;
      }
      save.onclick = exportBlob;
      return { addFiles: fl => load(fl[0]), load, detect, get boxes() { return st.boxes; }, set boxes(b) { st.boxes = b; draw(); }, set(k, v) { st[k] = v; draw(); }, exportBlob, destroy() { if (st.url) URL.revokeObjectURL(st.url); if (st.bmp) st.bmp.close(); } };
    }
  });
  alias('anonymize-faces', 'blur-faces');

  LC.aiInternals = { detectFaces, applyBlur, bgMask };
})();
