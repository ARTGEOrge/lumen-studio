'use strict';
/* Lumen Motion — composition viewer: frame display, RAM cache, playback, on-canvas tools & overlays. */
(function () {
  const LM = window.LM, { M, val } = LM, $ = LM.$;
  const stage = $('#stage'), view = $('#view'), vctx = view.getContext('2d');
  $('#overlay').remove();
  const V = LM.viewer = { z: 1, ox: 0, oy: 0, fit: true, grid: false, showPaths: true };
  const st = LM.st;
  st.shapeOpts = { fillOn: true, fill: '#4aa3ff', strokeOn: false, stroke: '#ffffff', strokeWidth: 6, points: 5 };
  st.brush = { size: 8, color: '#1b2a3a', pressure: true, onion: true, before: 2, after: 1 };
  st.textOpts = { font: 'Segoe UI', size: 120, color: '#ffffff' };

  /* ---------- frame cache (RAM preview) ---------- */
  const cache = new Map(); let cacheKey = '', cacheBytes = 0;
  LM.cacheBudget = 6e8;
  function cacheReset() { cache.forEach(b => b.close?.()); cache.clear(); cacheBytes = 0; LM.emit('cache'); }
  LM.cacheReset = cacheReset;
  LM.cachedFrames = () => cache;
  function checkCache(c) { const key = `${c.id}|${st.ver}|${st.res}|${LM.exprState.enabled}|${LM.trusted.size}`; if (key !== cacheKey) { cacheKey = key; cacheReset(); } }

  /* ---------- view transform ---------- */
  let dpr = 1, SW = 0, SH = 0;
  function resize() {
    const r = stage.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; SW = r.width; SH = r.height;
    view.width = Math.max(1, Math.round(SW * dpr)); view.height = Math.max(1, Math.round(SH * dpr));
    view.style.width = SW + 'px'; view.style.height = SH + 'px';
    if (V.fit) fitView(); LM.requestRender();
  }
  function fitView() {
    const c = LM.comp(); if (!c) return;
    V.z = Math.max(0.02, Math.min((SW - 40) / c.w, (SH - 70) / c.h)); V.ox = (SW - c.w * V.z) / 2; V.oy = (SH - 44 - c.h * V.z) / 2 + 4; V.fit = true;
    LM.emit('zoom');
  }
  V.fitView = () => { fitView(); LM.requestRender(); };
  V.setZoom = (z, cx = SW / 2, cy = (SH - 40) / 2) => {
    z = Math.max(0.02, Math.min(32, z)); const px = (cx - V.ox) / V.z, py = (cy - V.oy) / V.z;
    V.z = z; V.ox = cx - px * z; V.oy = cy - py * z; V.fit = false; LM.emit('zoom'); LM.requestRender();
  };
  const toComp = (x, y) => [(x - V.ox) / V.z, (y - V.oy) / V.z];
  const toScreen = (x, y) => [x * V.z + V.ox, y * V.z + V.oy];
  V.toComp = toComp; V.toScreen = toScreen;
  new ResizeObserver(resize).observe(stage);

  /* ---------- video sync for preview ---------- */
  let videoPending = false;
  function syncVideos(c, t) {
    videoPending = false;
    const want = new Set();
    LM.videosAt(c, t).forEach(({ L, lt }) => {
      const m = LM.media.get(L.asset); if (!m?.video) return; const v = m.video; want.add(v);
      const target = Math.max(0, Math.min(lt, (v.duration || 1e9) - .001));
      if (st.playing && !st.ramPlaying) {
        if (v.paused) { v.currentTime = target; v.play().catch(() => { }); }
        else if (Math.abs(v.currentTime - target) > .3) v.currentTime = target;
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - target) > .5 / c.fps || v.readyState < 2) {
          videoPending = true;
          if (!v._lmSeek) { v._lmSeek = true; v.addEventListener('seeked', () => { v._lmSeek = false; LM.requestRender(); }, { once: true }); }
          if (!v.seeking || Math.abs(v.currentTime - target) > .5 / c.fps) v.currentTime = target;
        }
      }
    });
    LM.media.forEach(m => { if (m.video && !want.has(m.video) && !m.video.paused) m.video.pause(); });
  }
  LM.pauseVideos = () => LM.media.forEach(m => m.video && !m.video.paused && m.video.pause());

  /* ---------- draw ---------- */
  let frameC = null, lastFrameImg = null, fpsCount = 0, fpsT = performance.now();
  function getFrame(c, t) {
    checkCache(c);
    const f = Math.round(t * c.fps);
    if (cache.has(f)) return cache.get(f);
    syncVideos(c, t);
    const W = Math.max(1, Math.round(c.w * st.res)), H = Math.max(1, Math.round(c.h * st.res));
    if (!frameC || frameC.width !== W || frameC.height !== H) { frameC = new OffscreenCanvas(W, H); frameC._ctx = frameC.getContext('2d'); }
    const draft = st.playing && !st.ramPlaying && (c.mbOn || c.layers.some(l => l.effects.some(f => f.type === 'mblur' && f.on)));
    LM.renderInto(c, t, frameC, { scale: st.res, preview: true, draft });
    const bmp = frameC.transferToImageBitmap();
    if (!videoPending && !draft) {
      const bytes = W * H * 4;
      if (cacheBytes + bytes <= LM.cacheBudget) { cache.set(f, bmp); cacheBytes += bytes; LM.emit('cache'); }
      else { lastFrameImg?.close?.(); lastFrameImg = bmp; }
    } else { lastFrameImg?.close?.(); lastFrameImg = bmp; }
    return bmp;
  }
  V.getFrame = getFrame;
  const checker = (() => { const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 16, 16); x.fillStyle = '#d4dbe4'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8); return vctx.createPattern(c, 'repeat'); })();
  LM.draw = function () {
    const c = LM.comp(); if (!c || !SW || st.exporting) return;
    const x = vctx; x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, SW, SH);
    // drop shadow frame
    x.save(); x.shadowColor = 'rgba(20,40,70,.45)'; x.shadowBlur = 18; x.shadowOffsetY = 4; x.fillStyle = V.grid ? checker : c.bg; x.fillRect(V.ox, V.oy, c.w * V.z, c.h * V.z); x.restore();
    const img = getFrame(c, st.time);
    if (V.grid) { // render without background over checkerboard
      const W = Math.round(c.w * st.res), H = Math.round(c.h * st.res), tc = LM.acquire(W, H); LM.renderInto(c, st.time, tc, { scale: st.res, bg: 'transparent', preview: true });
      x.imageSmoothingQuality = 'high'; x.drawImage(tc, V.ox, V.oy, c.w * V.z, c.h * V.z); LM.release(tc);
    } else { x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(img, V.ox, V.oy, c.w * V.z, c.h * V.z); }
    x.strokeStyle = 'rgba(30,57,91,.55)'; x.lineWidth = 1; x.strokeRect(Math.round(V.ox) - .5, Math.round(V.oy) - .5, Math.round(c.w * V.z) + 1, Math.round(c.h * V.z) + 1);
    drawOverlays(x, c);
    fpsCount++; const now = performance.now(); if (now - fpsT > 500) { LM.emit('fps', st.playing ? fpsCount * 1000 / (now - fpsT) : 0); fpsCount = 0; fpsT = now; }
  };

  /* ---------- overlays ---------- */
  const SEL = '#3a9cff';
  function layerQuad(L, t, c) { const b = LM.layerBounds(L, t), m = LM.layerMatrix(L, t, c); return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(([u, v]) => toScreen(...M.apply(m, u, v))); }
  function parentMatrix(L, t, c) { const par = L.parent && c.layers.find(l => l.id === L.parent); return par ? LM.layerMatrix(par, t, c) : M.id(); }
  V.parentMatrix = parentMatrix;
  function drawOverlays(x, c) {
    const t = st.time;
    // null objects
    c.layers.forEach(L => { if (L.type !== 'null' || !st.sel.includes(L.id) || !L.visible || t < L.in || t >= L.out) return; const q = layerQuad(L, t, c); x.strokeStyle = '#d04040'; x.lineWidth = 1.2; x.beginPath(); q.forEach((p, i) => i ? x.lineTo(...p) : x.moveTo(...p)); x.closePath(); x.stroke(); });
    // onion skin
    const sl = LM.selLayer();
    if (sl && sl.type === 'draw' && sl.draw.onion && !st.playing) drawOnion(x, c, sl, t);
    LM.selLayers().forEach(L => {
      if (!L.visible) return;
      const inTime = t >= L.in && t < L.out;
      // motion path
      if (V.showPaths && LM.animated(L.tr.position) && L.tr.position.k.length > 1) drawMotionPath(x, c, L);
      if (!inTime) return;
      if (L.type !== 'null' && L.type !== 'adjust') {
        const q = layerQuad(L, t, c);
        x.strokeStyle = SEL; x.lineWidth = 1; x.beginPath(); q.forEach((p, i) => i ? x.lineTo(...p) : x.moveTo(...p)); x.closePath(); x.stroke();
        if (st.tool === 'select' && LM.selLayers().length === 1 && !L.locked) handlesOf(q).forEach(h => { x.fillStyle = '#fff'; x.strokeStyle = SEL; x.fillRect(h.x - 3.5, h.y - 3.5, 7, 7); x.strokeRect(h.x - 3.5, h.y - 3.5, 7, 7); });
      }
      // anchor point
      const m = LM.layerMatrix(L, t, c), a = val(L.tr.anchor, t), [ax, ay] = toScreen(...M.apply(m, a[0], a[1]));
      x.strokeStyle = '#fff'; x.lineWidth = 3; x.beginPath(); x.arc(ax, ay, 5, 0, 7); x.moveTo(ax - 9, ay); x.lineTo(ax + 9, ay); x.moveTo(ax, ay - 9); x.lineTo(ax, ay + 9); x.stroke();
      x.strokeStyle = '#1a3a6a'; x.lineWidth = 1.2; x.stroke();
      // masks
      L.masks.forEach(mk => drawEditPath(x, val(mk.path, t), m, '#f0c020', mk));
      if (L.type === 'shape' && L.shape.kind === 'path') drawEditPath(x, val(L.shape.path, t), m, '#3a9cff', L.shape);
    });
    // pen tool preview
    if (pen.pts.length) {
      x.strokeStyle = '#ff7a00'; x.lineWidth = 1.5; x.beginPath();
      const P = pen.pts.map(p => ({ v: toScreen(p[0], p[1]), i: toScreen(p[0] + p[2], p[1] + p[3]), o: toScreen(p[0] + p[4], p[1] + p[5]) }));
      P.forEach((p, i) => { if (!i) x.moveTo(...p.v); else x.bezierCurveTo(...P[i - 1].o, ...p.i, ...p.v); });
      if (pen.hover && !pen.dragging) { const h = toScreen(...pen.hover), last = P[P.length - 1]; x.bezierCurveTo(...last.o, ...h, ...h); }
      x.stroke();
      P.forEach((p, i) => { x.fillStyle = i === 0 ? '#ff7a00' : '#fff'; x.strokeStyle = '#ff7a00'; x.fillRect(p.v[0] - 3.5, p.v[1] - 3.5, 7, 7); x.strokeRect(p.v[0] - 3.5, p.v[1] - 3.5, 7, 7); if (p.o[0] !== p.v[0] || p.o[1] !== p.v[1]) { x.beginPath(); x.moveTo(...p.i); x.lineTo(...p.o); x.stroke(); [p.i, p.o].forEach(h => { x.beginPath(); x.arc(h[0], h[1], 3, 0, 7); x.fill(); x.stroke(); }); } });
    }
    // drag rectangle for shape tools
    if (drag && drag.kind === 'create') {
      const [a, b] = [toScreen(...drag.p0), toScreen(...drag.p1)];
      x.strokeStyle = '#ff7a00'; x.setLineDash([4, 3]); x.lineWidth = 1.2;
      if (st.tool === 'ellipse') { x.beginPath(); x.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, 7); x.stroke(); }
      else x.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      x.setLineDash([]);
    }
    // in-progress brush stroke
    if (drag && drag.kind === 'brush' && drag.pts.length) {
      const m = drag.m; x.save(); x.lineCap = x.lineJoin = 'round'; x.strokeStyle = drag.erase ? 'rgba(255,255,255,.85)' : st.brush.color;
      const pts = drag.pts, sc = M.scaleOf(m) * V.z;
      for (let i = 0; i + 3 < pts.length || i === 0; i += 3) { const a = toScreen(...M.apply(m, pts[i], pts[i + 1])), b = pts.length > i + 3 ? toScreen(...M.apply(m, pts[i + 3], pts[i + 4])) : a; x.lineWidth = Math.max(1, st.brush.size * Math.max(.15, pts[i + 2]) * sc); x.beginPath(); x.moveTo(...a); x.lineTo(...b); x.stroke(); if (pts.length <= 3) break; }
      x.restore();
    }
    if (st.tool === 'brush' || st.tool === 'eraser') if (V.hover) { const sl2 = LM.selLayer(), sc = sl2 ? M.scaleOf(LM.layerMatrix(sl2, t, c)) : 1; x.strokeStyle = 'rgba(0,0,0,.6)'; x.lineWidth = 1; x.beginPath(); x.arc(V.hover[0], V.hover[1], Math.max(1.5, st.brush.size * sc * V.z / 2), 0, 7); x.stroke(); }
  }
  function handlesOf(q) {
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    return [{ k: 'tl', p: q[0], o: q[2] }, { k: 'tr', p: q[1], o: q[3] }, { k: 'br', p: q[2], o: q[0] }, { k: 'bl', p: q[3], o: q[1] }, { k: 't', p: mid(q[0], q[1]), o: mid(q[3], q[2]), ax: 'y' }, { k: 'r', p: mid(q[1], q[2]), o: mid(q[0], q[3]), ax: 'x' }, { k: 'b', p: mid(q[2], q[3]), o: mid(q[0], q[1]), ax: 'y' }, { k: 'l', p: mid(q[3], q[0]), o: mid(q[1], q[2]), ax: 'x' }].map(h => ({ ...h, x: h.p[0], y: h.p[1] }));
  }
  function drawEditPath(x, path, m, color, owner) {
    if (!path?.pts?.length) return;
    const P = path.pts.map(p => ({ v: toScreen(...M.apply(m, p[0], p[1])), i: toScreen(...M.apply(m, p[0] + p[2], p[1] + p[3])), o: toScreen(...M.apply(m, p[0] + p[4], p[1] + p[5])) }));
    x.strokeStyle = color; x.lineWidth = 1.3; x.beginPath();
    P.forEach((p, i) => { if (!i) x.moveTo(...p.v); else x.bezierCurveTo(...P[i - 1].o, ...p.i, ...p.v); });
    if (path.c) { const l = P[P.length - 1]; x.bezierCurveTo(...l.o, ...P[0].i, ...P[0].v); }
    x.stroke();
    if (st.tool !== 'select' && st.tool !== 'pen') return;
    P.forEach((p, i) => {
      const hasT = Math.hypot(p.i[0] - p.v[0], p.i[1] - p.v[1]) > .5 || Math.hypot(p.o[0] - p.v[0], p.o[1] - p.v[1]) > .5;
      if (hasT) { x.strokeStyle = color; x.beginPath(); x.moveTo(...p.i); x.lineTo(...p.v); x.lineTo(...p.o); x.stroke(); [p.i, p.o].forEach(h => { x.fillStyle = '#fff'; x.beginPath(); x.arc(h[0], h[1], 2.8, 0, 7); x.fill(); x.stroke(); }); }
      x.fillStyle = (V.selVertex && V.selVertex.owner === owner && V.selVertex.i === i) ? color : '#fff'; x.strokeStyle = color; x.fillRect(p.v[0] - 3, p.v[1] - 3, 6, 6); x.strokeRect(p.v[0] - 3, p.v[1] - 3, 6, 6);
    });
  }
  function motionPathPoints(c, L) {
    const k = L.tr.position.k, t0 = k[0].t + L.start, t1 = k[k.length - 1].t + L.start, n = Math.min(400, Math.max(20, Math.round((t1 - t0) * c.fps * 2)));
    const pts = []; for (let i = 0; i <= n; i++) { const tt = t0 + (t1 - t0) * i / n; const pm = parentMatrix(L, tt, c); pts.push(toScreen(...M.apply(pm, ...val(L.tr.position, tt)))); }
    return pts;
  }
  function drawMotionPath(x, c, L) {
    const pts = motionPathPoints(c, L), pm = parentMatrix(L, st.time, c);
    x.save(); x.strokeStyle = 'rgba(58,156,255,.9)'; x.lineWidth = 1.2; x.setLineDash([2, 3]); x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(...p) : x.moveTo(...p)); x.stroke(); x.setLineDash([]);
    // dots per frame
    x.fillStyle = 'rgba(58,156,255,.8)'; pts.forEach((p, i) => { if (i % 2 === 0) x.fillRect(p[0] - 1, p[1] - 1, 2, 2); });
    L.tr.position.k.forEach((k, i) => {
      const v = toScreen(...M.apply(pm, k.v[0], k.v[1]));
      const sel = st.selKeys.has(k);
      [['si', k.si], ['so', k.so]].forEach(([nm, d]) => { if (!d || (!d[0] && !d[1])) return; const h = toScreen(...M.apply(pm, k.v[0] + d[0], k.v[1] + d[1])); x.strokeStyle = '#3a9cff'; x.beginPath(); x.moveTo(...v); x.lineTo(...h); x.stroke(); x.fillStyle = '#fff'; x.beginPath(); x.arc(h[0], h[1], 3.2, 0, 7); x.fill(); x.stroke(); });
      x.fillStyle = sel ? '#3a9cff' : '#fff'; x.strokeStyle = '#1a5aa0'; x.fillRect(v[0] - 4, v[1] - 4, 8, 8); x.strokeRect(v[0] - 4, v[1] - 4, 8, 8);
    });
    x.restore();
  }
  function drawOnion(x, c, L, t) {
    const p = L.draw.cels, k = p.k || [], lt = t - L.start;
    const cur = k.filter(q => q.t <= lt + 1e-6).length - 1;
    const m = LM.layerMatrix(L, t, c);
    const show = (kf, col, alpha) => {
      const W = Math.max(1, Math.round(SW)), H = Math.max(1, Math.round(SH)), tc = LM.acquire(W, H), y = tc._ctx;
      y.setTransform(m[0] * V.z, m[1] * V.z, m[2] * V.z, m[3] * V.z, m[4] * V.z + V.ox, m[5] * V.z + V.oy);
      LM.drawStrokes(y, kf.v); y.setTransform(1, 0, 0, 1, 0, 0); y.globalCompositeOperation = 'source-in'; y.fillStyle = col; y.fillRect(0, 0, W, H);
      x.save(); x.globalAlpha = alpha; x.drawImage(tc, 0, 0, SW, SH); x.restore(); LM.release(tc);
    };
    for (let i = 1; i <= st.brush.before; i++) if (k[cur - i]) show(k[cur - i], '#e03030', .35 / i);
    for (let i = 1; i <= st.brush.after; i++) if (k[cur + i]) show(k[cur + i], '#20a040', .35 / i);
  }

  /* ---------- hit testing ---------- */
  const hitCtx = new OffscreenCanvas(2, 2).getContext('2d');
  function hitLayer(cx, cy, c) {
    const t = st.time, solo = c.layers.some(l => l.solo);
    for (const L of c.layers) {
      if (!L.visible || L.locked || t < L.in || t >= L.out || (solo && !L.solo) || L.type === 'adjust') continue;
      const m = LM.layerMatrix(L, t, c), [u, v] = M.apply(M.inv(m), cx, cy);
      if (L.type === 'shape') {
        const p2 = LM.toPath2D(LM.shapePath(L, t)); hitCtx.lineWidth = Math.max(L.shape.stroke.on ? val(L.shape.stroke.width, t) : 0, 8 / (V.z * M.scaleOf(m)));
        if ((L.shape.fill.on && hitCtx.isPointInPath(p2, u, v)) || hitCtx.isPointInStroke(p2, u, v)) return L;
        continue;
      }
      if (L.type === 'draw') { const ss = val(L.draw.cels, t) || []; if (ss.some(s => { for (let i = 0; i < s.pts.length; i += 3) if (Math.hypot(s.pts[i] - u, s.pts[i + 1] - v) < s.w + 6 / V.z) return true; return false; })) return L; continue; }
      const b = LM.layerBounds(L, t);
      if (u >= b[0] && u <= b[2] && v >= b[1] && v <= b[3]) return L;
    }
    return null;
  }
  V.hitLayer = hitLayer;

  /* ---------- pointer interaction ---------- */
  let drag = null; const pen = { pts: [], hover: null, dragging: false };
  V.pen = pen;
  const evPos = e => { const r = view.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  let spaceDown = false;
  addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && !e.target.matches('input,textarea,select')) spaceDown = true; });
  addEventListener('keyup', e => { if (e.code === 'Space') spaceDown = false; });
  function moveDelta(L, dx, dy, t, c) { // comp-space delta → parent-space delta
    const pm = parentMatrix(L, t, c), inv = M.inv([pm[0], pm[1], pm[2], pm[3], 0, 0]); return M.apply(inv, dx, dy);
  }
  view.addEventListener('pointerdown', e => {
    const c = LM.comp(); if (!c) return;
    try { view.setPointerCapture(e.pointerId); } catch (_) { } view.focus?.();
    const [sx, sy] = evPos(e), [cx, cy] = toComp(sx, sy), t = st.time;
    if (e.button === 1 || spaceDown || st.tool === 'hand') { drag = { kind: 'pan', sx, sy, ox: V.ox, oy: V.oy }; return; }
    if (e.button === 2) return;
    if (st.tool === 'zoom') { V.setZoom(V.z * (e.altKey ? 1 / 1.5 : 1.5), sx, sy); return; }
    if (st.playing) LM.stop();
    if (st.tool === 'select' || st.tool === 'rotate' || st.tool === 'anchor') {
      // 1) path vertices / motion path handles on selected layers
      const hp = hitPathHandles(sx, sy, c); if (hp) { drag = hp; drag.sx = sx; drag.sy = sy; drag.alt = e.altKey && hp.kind === 'mkey'; return; }
      // 2) transform handles
      const sl = LM.selLayers();
      if (st.tool === 'select' && sl.length === 1 && !sl[0].locked && t >= sl[0].in && t < sl[0].out && sl[0].type !== 'null' && sl[0].type !== 'adjust') {
        const L = sl[0], q = layerQuad(L, t, c), hs = handlesOf(q);
        const h = hs.find(h => Math.hypot(h.x - sx, h.y - sy) < 7);
        if (h) { drag = { kind: 'scale', L, h, s0: val(L.tr.scale, t).slice(), m: LM.layerMatrix(L, t, c), a: val(L.tr.anchor, t) }; return; }
        // near-corner rotation
        const nearCorner = q.some(p => { const d = Math.hypot(p[0] - sx, p[1] - sy); return d > 7 && d < 22; }) && !pointInQuad(sx, sy, q);
        if (nearCorner) { startRotate(L, cx, cy, t, c); return; }
      }
      const L = hitLayer(cx, cy, c);
      if (L) {
        if (e.shiftKey || e.ctrlKey) { if (st.sel.includes(L.id)) LM.select(st.sel.filter(i => i !== L.id)); else LM.select([L.id], true); }
        else if (!st.sel.includes(L.id)) LM.select([L.id]);
        if (st.tool === 'rotate') { startRotate(L, cx, cy, t, c); return; }
        if (st.tool === 'anchor') { drag = { kind: 'anchor', L, c0: [cx, cy], a0: val(L.tr.anchor, t).slice(), p0: val(L.tr.position, t).slice(), m: LM.layerMatrix(L, t, c) }; return; }
        drag = { kind: 'move', c0: [cx, cy], items: LM.selLayers().filter(l => !l.locked).map(l => ({ L: l, p0: val(l.tr.position, t).slice() })) };
        if (e.altKey) drag.dup = true;
        return;
      }
      if (!e.shiftKey) { LM.select([]); V.selVertex = null; }
      return;
    }
    if (['rect', 'ellipse', 'polygon', 'star'].includes(st.tool)) { drag = { kind: 'create', p0: [cx, cy], p1: [cx, cy] }; return; }
    if (st.tool === 'pen') { penDown(cx, cy, sx, sy, e); return; }
    if (st.tool === 'text') { LM.createTextAt(cx, cy); return; }
    if (st.tool === 'brush' || st.tool === 'eraser') { brushDown(cx, cy, e); return; }
  });
  function pointInQuad(x, y, q) { let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4], cr = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (cr !== 0) { if (s === 0) s = Math.sign(cr); else if (Math.sign(cr) !== s) return false; } } return true; }
  function startRotate(L, cx, cy, t, c) {
    const m = LM.layerMatrix(L, t, c), a = val(L.tr.anchor, t), p = M.apply(m, a[0], a[1]);
    drag = { kind: 'rotate', L, center: p, a0: Math.atan2(cy - p[1], cx - p[0]), r0: val(L.tr.rotation, t) };
  }
  function hitPathHandles(sx, sy, c) {
    const t = st.time, near = (p, r = 6) => Math.hypot(p[0] - sx, p[1] - sy) < r;
    for (const L of LM.selLayers()) {
      if (L.locked) continue;
      // motion path keyframes & tangents
      if (V.showPaths && LM.animated(L.tr.position)) {
        const pm = parentMatrix(L, t, c);
        for (const k of L.tr.position.k) {
          for (const nm of ['si', 'so']) { const d = k[nm]; if (d && (d[0] || d[1]) && near(toScreen(...M.apply(pm, k.v[0] + d[0], k.v[1] + d[1])))) return { kind: 'mtan', L, k, nm, pm }; }
          if (near(toScreen(...M.apply(pm, k.v[0], k.v[1])))) return { kind: 'mkey', L, k, pm, v0: k.v.slice() };
        }
      }
      if (t < L.in || t >= L.out) continue;
      const m = LM.layerMatrix(L, t, c);
      const owners = L.masks.map(mk => ({ prop: mk.path, owner: mk })); if (L.type === 'shape' && L.shape.kind === 'path') owners.push({ prop: L.shape.path, owner: L.shape });
      for (const { prop, owner } of owners) {
        const path = val(prop, t); if (!path?.pts) continue;
        for (let i = 0; i < path.pts.length; i++) {
          const p = path.pts[i];
          if (near(toScreen(...M.apply(m, p[0] + p[4], p[1] + p[5]))) && (p[4] || p[5])) return { kind: 'ptan', L, prop, owner, i, which: 'o', m };
          if (near(toScreen(...M.apply(m, p[0] + p[2], p[1] + p[3]))) && (p[2] || p[3])) return { kind: 'ptan', L, prop, owner, i, which: 'i', m };
          if (near(toScreen(...M.apply(m, p[0], p[1])))) { V.selVertex = { owner, i }; return { kind: 'pvert', L, prop, owner, i, m, alt: false }; }
        }
      }
    }
    return null;
  }
  view.addEventListener('pointermove', e => {
    const c = LM.comp(); if (!c) return;
    const [sx, sy] = evPos(e), [cx, cy] = toComp(sx, sy), t = st.time;
    V.hover = [sx, sy];
    LM.emit('pointer', [cx, cy]);
    if (!drag) { updateCursor(sx, sy, cx, cy, c); if (st.tool === 'pen' && pen.pts.length) { pen.hover = [cx, cy]; LM.draw(); } else if (st.tool === 'brush' || st.tool === 'eraser') LM.draw(); return; }
    switch (drag.kind) {
      case 'pan': V.ox = drag.ox + sx - drag.sx; V.oy = drag.oy + sy - drag.sy; V.fit = false; LM.draw(); return;
      case 'move': {
        let dx = cx - drag.c0[0], dy = cy - drag.c0[1];
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        drag.items.forEach(({ L, p0 }) => { const d = moveDelta(L, dx, dy, t, c); const v = p0.slice(); v[0] += d[0]; v[1] += d[1]; LM.setVal(L.tr.position, t, v); });
        drag.moved = true; LM.touch(); return;
      }
      case 'scale': {
        const { L, h, s0, m, a } = drag, inv = M.inv(m), [u, v] = M.apply(inv, cx, cy), [ou, ov] = M.apply(inv, ...toComp(...h.o));
        // local coords relative to anchor; scale factor = new distance / old distance along axis
        const [hu, hv] = M.apply(inv, ...toComp(h.x, h.y));
        let fx = Math.abs(hu - a[0]) > 1e-3 ? (u - a[0]) / (hu - a[0]) : 1, fy = Math.abs(hv - a[1]) > 1e-3 ? (v - a[1]) / (hv - a[1]) : 1;
        if (h.ax === 'x') fy = e.shiftKey ? fx : 1; if (h.ax === 'y') fx = e.shiftKey ? fy : 1;
        if (!h.ax && e.shiftKey) { const f = Math.abs(fx) > Math.abs(fy) ? fx : fy; fx = fy = f; }
        void ou; void ov;
        LM.setVal(L.tr.scale, t, [s0[0] * fx, s0[1] * fy]); drag.moved = true; LM.touch(); return;
      }
      case 'rotate': {
        const a = Math.atan2(cy - drag.center[1], cx - drag.center[0]); let r = drag.r0 + (a - drag.a0) * 180 / Math.PI;
        if (e.shiftKey) r = Math.round(r / 45) * 45;
        LM.setVal(drag.L.tr.rotation, t, r); drag.moved = true; LM.touch(); return;
      }
      case 'anchor': {
        const { L, m } = drag, inv = M.inv(m), p0 = M.apply(inv, ...drag.c0), p1 = M.apply(inv, cx, cy);
        const na = [drag.a0[0] + p1[0] - p0[0], drag.a0[1] + p1[1] - p0[1]];
        const d = moveDelta(L, cx - drag.c0[0], cy - drag.c0[1], t, c);
        LM.setVal(L.tr.anchor, t, na); LM.setVal(L.tr.position, t, [drag.p0[0] + d[0], drag.p0[1] + d[1]]); drag.moved = true; LM.touch(); return;
      }
      case 'mkey': { const inv = M.inv(drag.pm), p = M.apply(inv, cx, cy); if (drag.alt) { const d = [p[0] - drag.k.v[0], p[1] - drag.k.v[1]]; drag.k.so = d; drag.k.si = [-d[0], -d[1]]; } else drag.k.v = [p[0], p[1]].concat(drag.k.v.slice(2)); drag.moved = true; LM.touch(); return; }
      case 'mtan': {
        const { k, nm, pm } = drag, p = M.apply(M.inv(pm), cx, cy), d = [p[0] - k.v[0], p[1] - k.v[1]];
        k[nm] = d; if (!e.altKey) k[nm === 'si' ? 'so' : 'si'] = [-d[0], -d[1]];
        drag.moved = true; LM.touch(); return;
      }
      case 'pvert': case 'ptan': {
        const { prop, i, m } = drag, [u, v] = M.apply(M.inv(m), cx, cy);
        const path = LM.clone(val(prop, t)), p = path.pts[i];
        if (drag.kind === 'pvert') {
          if (e.altKey || drag.alt) { // Alt-drag a vertex: pull out symmetric tangents
            drag.alt = true; p[4] = u - p[0]; p[5] = v - p[1]; p[2] = -p[4]; p[3] = -p[5];
          } else { p[0] = u; p[1] = v; }
        } else {
          const dx = u - p[0], dy = v - p[1];
          if (drag.which === 'o') { p[4] = dx; p[5] = dy; if (!e.altKey) { p[2] = -dx; p[3] = -dy; } } else { p[2] = dx; p[3] = dy; if (!e.altKey) { p[4] = -dx; p[5] = -dy; } }
        }
        LM.setVal(prop, t, path); drag.moved = true; LM.touch(); return;
      }
      case 'create': { let p1 = [cx, cy]; if (e.shiftKey) { const d = Math.max(Math.abs(cx - drag.p0[0]), Math.abs(cy - drag.p0[1])); p1 = [drag.p0[0] + Math.sign(cx - drag.p0[0] || 1) * d, drag.p0[1] + Math.sign(cy - drag.p0[1] || 1) * d]; } drag.p1 = p1; LM.draw(); return; }
      case 'pen': { const p = pen.pts[pen.pts.length - 1]; p[4] = cx - p[0]; p[5] = cy - p[1]; p[2] = -p[4]; p[3] = -p[5]; pen.dragging = true; LM.draw(); return; }
      case 'brush': brushMove(cx, cy, e); return;
    }
  });
  view.addEventListener('pointerup', e => {
    const d = drag; drag = null; if (!d) return;
    const c = LM.comp(), t = st.time;
    switch (d.kind) {
      case 'move': if (d.moved) LM.commit('Move', LM.animated(d.items[0]?.L.tr.position)); break;
      case 'scale': if (d.moved) LM.commit('Scale', LM.animated(d.L.tr.scale)); break;
      case 'rotate': if (d.moved) LM.commit('Rotate', LM.animated(d.L.tr.rotation)); break;
      case 'anchor': if (d.moved) LM.commit('Move Anchor Point'); break;
      case 'mkey': case 'mtan': if (d.moved) LM.commit('Edit Motion Path', false); break;
      case 'pvert': case 'ptan': if (d.moved) LM.commit('Edit Path', LM.animated(d.prop)); else LM.draw(); break;
      case 'create': finishCreate(d, c, e); break;
      case 'pen': pen.dragging = false; LM.draw(); break;
      case 'brush': brushUp(d); break;
    }
    void t;
  });
  view.addEventListener('dblclick', e => {
    const c = LM.comp(), [sx, sy] = evPos(e), [cx, cy] = toComp(sx, sy);
    if (st.tool === 'pen' && pen.pts.length) return penFinish(false);
    if (st.tool !== 'select') return;
    // double-click a path vertex: toggle smooth/corner
    const hp = hitPathHandles(sx, sy, c);
    if (hp && hp.kind === 'pvert') { const path = LM.clone(val(hp.prop, st.time)), p = path.pts[hp.i]; if (p[2] || p[3] || p[4] || p[5]) { p[2] = p[3] = p[4] = p[5] = 0; } else { const n = path.pts.length, a = path.pts[(hp.i - 1 + n) % n], b = path.pts[(hp.i + 1) % n]; const tx = (b[0] - a[0]) / 6, ty = (b[1] - a[1]) / 6; p[2] = -tx; p[3] = -ty; p[4] = tx; p[5] = ty; } LM.setVal(hp.prop, st.time, path); LM.commit('Convert Vertex', LM.animated(hp.prop)); return; }
    const L = hitLayer(cx, cy, c); if (!L) return;
    if (L.type === 'text') LM.editText(L);
    else if (L.type === 'precomp') LM.setActiveComp(L.comp);
  });
  view.addEventListener('wheel', e => {
    e.preventDefault(); const [sx, sy] = evPos(e);
    if (e.shiftKey) { V.ox -= e.deltaY; V.fit = false; LM.draw(); return; }
    V.setZoom(V.z * Math.pow(1.0015, -e.deltaY * (e.ctrlKey ? 2.5 : 1.2)), sx, sy);
  }, { passive: false });
  view.addEventListener('pointerleave', () => { V.hover = null; if (st.tool === 'brush' || st.tool === 'eraser') LM.draw(); });
  view.addEventListener('contextmenu', e => {
    e.preventDefault(); const c = LM.comp(), [sx, sy] = evPos(e), [cx, cy] = toComp(sx, sy);
    const L = hitLayer(cx, cy, c); if (L && !st.sel.includes(L.id)) LM.select([L.id]);
    LM.layerContextMenu(e.clientX, e.clientY);
  });
  function updateCursor(sx, sy, cx, cy, c) {
    let cur = 'default';
    if (spaceDown || st.tool === 'hand') cur = 'grab';
    else if (st.tool === 'zoom') cur = 'zoom-in';
    else if (['rect', 'ellipse', 'polygon', 'star', 'pen'].includes(st.tool)) cur = 'crosshair';
    else if (st.tool === 'text') cur = 'text';
    else if (st.tool === 'brush' || st.tool === 'eraser') cur = 'none';
    else if (st.tool === 'rotate') cur = 'alias';
    else if (st.tool === 'select') {
      const sl = LM.selLayers();
      if (sl.length === 1 && st.time >= sl[0].in && st.time < sl[0].out && sl[0].type !== 'null') {
        const q = layerQuad(sl[0], st.time, c), h = handlesOf(q).find(h => Math.hypot(h.x - sx, h.y - sy) < 7);
        if (h) cur = { tl: 'nwse-resize', br: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize', t: 'ns-resize', b: 'ns-resize', l: 'ew-resize', r: 'ew-resize' }[h.k];
        else if (q.some(p => { const d = Math.hypot(p[0] - sx, p[1] - sy); return d > 7 && d < 22; }) && !pointInQuad(sx, sy, q)) cur = 'alias';
      }
      if (cur === 'default' && hitPathHandles(sx, sy, c)) cur = 'pointer';
      else if (cur === 'default' && hitLayer(cx, cy, c)) cur = 'move';
    }
    view.style.cursor = cur;
  }

  /* ---------- shape creation ---------- */
  function finishCreate(d, c, e) {
    const [x0, y0] = d.p0, [x1, y1] = d.p1, w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
    LM.draw();
    if (w < 3 && h < 3) return;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, O = st.shapeOpts, kind = st.tool;
    const target = LM.selLayer();
    if (st.mode === 'mask' && target && (kind === 'rect' || kind === 'ellipse')) {
      const m = M.inv(LM.layerMatrix(target, st.time, c)), tmp = { shape: { kind, size: LM.P([w, h]), roundness: LM.P(0) } };
      const path = LM.shapePath(tmp, 0);
      const pts = path.pts.map(p => { const v = M.apply(m, p[0] + cx, p[1] + cy), i = M.apply([m[0], m[1], m[2], m[3], 0, 0], p[2], p[3]), o = M.apply([m[0], m[1], m[2], m[3], 0, 0], p[4], p[5]); return [v[0], v[1], i[0], i[1], o[0], o[1]]; });
      target.masks.push(LM.factory.mask(kind, pts, 'Mask ' + (target.masks.length + 1)));
      target.expanded = true; LM.ui.open.add(target.id + '|masks');
      LM.commit('New Mask'); return;
    }
    const o = { pos: [cx, cy], fill: O.fill, fillOn: O.fillOn, stroke: O.stroke, strokeOn: O.strokeOn, strokeWidth: O.strokeWidth };
    if (kind === 'rect' || kind === 'ellipse') o.size = [w, h];
    else { o.outer = Math.min(w, h) / 2; o.inner = o.outer * .45; o.points = O.points; }
    const L = LM.factory.shape(c, kind, o); L.name = LM.uniqueName(c, L.name + ' 1');
    L.in = 0; L.out = c.duration;
    LM.addLayer(L, 'New Shape Layer');
  }
  /* ---------- pen tool ---------- */
  function penDown(cx, cy, sx, sy, e) {
    if (pen.pts.length > 2) { const f = toScreen(pen.pts[0][0], pen.pts[0][1]); if (Math.hypot(f[0] - sx, f[1] - sy) < 8) { penFinish(true); return; } }
    pen.pts.push([cx, cy, 0, 0, 0, 0]); drag = { kind: 'pen' }; LM.draw();
  }
  function penFinish(closed) {
    const c = LM.comp(); const pts = pen.pts.splice(0); pen.hover = null;
    if (pts.length < 2) { LM.draw(); return; }
    const target = LM.selLayer();
    if (st.mode === 'mask' && target) {
      const m = M.inv(LM.layerMatrix(target, st.time, c)), lin = [m[0], m[1], m[2], m[3], 0, 0];
      const lp = pts.map(p => { const v = M.apply(m, p[0], p[1]), i = M.apply(lin, p[2], p[3]), o = M.apply(lin, p[4], p[5]); return [v[0], v[1], i[0], i[1], o[0], o[1]]; });
      const mk = LM.factory.mask('path', lp, 'Mask ' + (target.masks.length + 1));
      target.masks.push(mk); target.expanded = true; LM.ui.open.add(target.id + '|masks'); LM.commit('New Mask'); return;
    }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]), ccx = (Math.min(...xs) + Math.max(...xs)) / 2, ccy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const O = st.shapeOpts;
    const L = LM.factory.shape(c, 'path', { pos: [ccx, ccy], path: { c: closed, pts: pts.map(p => [p[0] - ccx, p[1] - ccy, p[2], p[3], p[4], p[5]]) }, fill: O.fill, fillOn: closed && O.fillOn, stroke: O.stroke, strokeOn: O.strokeOn || !closed, strokeWidth: O.strokeWidth });
    L.name = LM.uniqueName(c, 'Shape 1');
    LM.addLayer(L, 'Pen Path');
  }
  V.penFinish = penFinish;
  V.penCancel = () => { pen.pts = []; pen.hover = null; LM.draw(); };

  /* ---------- brush / eraser (cel animation) ---------- */
  function brushDown(cx, cy, e) {
    const c = LM.comp(); let L = LM.selLayer();
    if (!L || L.type !== 'draw') {
      if (st.tool === 'eraser') { Aero.toast('Select a drawing layer to erase'); return; }
      L = LM.factory.draw(c); L.name = LM.uniqueName(c, 'Drawing 1'); LM.addLayer(L, 'New Drawing Layer');
    }
    if (L.locked) { Aero.toast('Layer is locked'); return; }
    const m = LM.layerMatrix(L, st.time, c), [u, v] = M.apply(M.inv(m), cx, cy);
    drag = { kind: 'brush', L, m, erase: st.tool === 'eraser', pts: [u, v, st.brush.pressure && e.pointerType === 'pen' ? e.pressure || .5 : 1] };
    LM.draw();
  }
  function brushMove(cx, cy, e) {
    const d = drag, [u, v] = M.apply(M.inv(d.m), cx, cy), n = d.pts.length;
    if (Math.hypot(u - d.pts[n - 3], v - d.pts[n - 2]) < .8 / V.z) return;
    const pr = st.brush.pressure && e.pointerType === 'pen' ? e.pressure || .5 : 1;
    (e.getCoalescedEvents?.() || [e]).length; d.pts.push(u, v, pr); LM.draw();
  }
  function brushUp(d) {
    const L = d.L, p = L.draw.cels, lt = LM.snap(st.time - L.start);
    if (!p.k || !p.k.length) p.k = [{ t: lt, v: [], i: 'hold', o: 'hold' }];
    let k = p.k.filter(q => q.t <= lt + 1e-6).pop();
    if (!k) { k = { t: lt, v: [], i: 'hold', o: 'hold' }; p.k.push(k); p.k.sort((a, b) => a.t - b.t); }
    k.v.push({ c: st.brush.color, w: st.brush.size, e: d.erase || undefined, pts: d.pts.map(x => Math.round(x * 100) / 100) });
    LM.commit(d.erase ? 'Erase' : 'Brush Stroke');
  }
  // cel commands
  LM.celCommand = cmd => {
    const L = LM.selLayer(); if (!L || L.type !== 'draw') return Aero.toast('Select a drawing layer first');
    const p = L.draw.cels, lt = LM.snap(st.time - L.start); p.k = p.k || [];
    const at = p.k.find(k => Math.abs(k.t - lt) < 1e-6), cur = p.k.filter(k => k.t <= lt + 1e-6).pop();
    if (cmd === 'blank') { if (at) at.v = []; else { p.k.push({ t: lt, v: [], i: 'hold', o: 'hold' }); p.k.sort((a, b) => a.t - b.t); } LM.commit('Insert Blank Cel'); }
    if (cmd === 'dup') { const v = LM.clone(cur ? cur.v : []); if (at) return Aero.toast('There is already a cel on this frame'); p.k.push({ t: lt, v, i: 'hold', o: 'hold' }); p.k.sort((a, b) => a.t - b.t); LM.commit('Duplicate Cel'); }
    if (cmd === 'clear') { if (cur) { cur.v = []; LM.commit('Clear Cel'); } }
    if (cmd === 'next') { LM.setTime(st.time + 1 / LM.fps()); }
  };

  /* ---------- playback ---------- */
  let playRAF = 0, playStart = 0, playT0 = 0, lastShown = -1;
  LM.play = () => {
    const c = LM.comp(); if (!c || st.playing) return;
    st.playing = true; const wi = c.workIn, wo = Math.min(c.workOut, c.duration);
    if (st.time >= wo - 1 / c.fps || st.time < wi) st.time = wi;
    playStart = performance.now(); playT0 = st.time; lastShown = -1;
    LM.emit('play');
    const tick = () => {
      if (!st.playing) return;
      const c2 = LM.comp(), wi2 = c2.workIn, wo2 = Math.min(c2.workOut, c2.duration);
      let t = playT0 + (performance.now() - playStart) / 1000;
      if (st.ramPlaying) { // play every cached frame in order at real-time pace, never skipping uncached frames
        t = playT0 + (performance.now() - playStart) / 1000;
      }
      if (t >= wo2) {
        if (st.loop) { t = wi2 + ((t - wi2) % Math.max(1 / c2.fps, wo2 - wi2)); playStart = performance.now() - (t - wi2) * 1000; playT0 = wi2; LM.pauseVideos(); }
        else { LM.stop(); LM.setTime(wo2 - 1 / c2.fps); return; }
      }
      const f = Math.floor(t * c2.fps + 1e-6);
      if (f !== lastShown) { lastShown = f; st.time = f / c2.fps; LM.emit('time'); LM.draw(); }
      playRAF = requestAnimationFrame(tick);
    };
    playRAF = requestAnimationFrame(tick);
  };
  LM.stop = () => { if (!st.playing) return; st.playing = false; st.ramPlaying = false; cancelAnimationFrame(playRAF); LM.pauseVideos(); LM.emit('play'); LM.emit('time'); LM.requestRender(); };
  LM.togglePlay = () => st.playing ? LM.stop() : LM.play();
  // RAM preview: render every frame of the work area into the cache first, then play in real time
  let ramAbort = false;
  LM.ramPreview = async () => {
    const c = LM.comp(); if (!c) return; if (st.playing) LM.stop();
    if (st.rendering) { ramAbort = true; return; }
    st.rendering = true; ramAbort = false; LM.emit('play');
    const f0 = Math.round(c.workIn * c.fps), f1 = Math.ceil(Math.min(c.workOut, c.duration) * c.fps);
    checkCache(c);
    let t0 = performance.now();
    for (let f = f0; f < f1 && !ramAbort; f++) {
      if (cache.has(f)) continue;
      await LM.seekVideos(c, f / c.fps);
      st.time = f / c.fps; getFrame(c, st.time);
      if (performance.now() - t0 > 60) { LM.emit('time'); LM.draw(); LM.status(`Rendering RAM preview… ${f - f0 + 1}/${f1 - f0}`); await new Promise(r => setTimeout(r, 0)); t0 = performance.now(); }
    }
    st.rendering = false; LM.status('');
    if (ramAbort) { LM.emit('play'); return; }
    st.time = c.workIn; st.ramPlaying = true; LM.play();
  };
  LM.on('time', () => { const c = LM.comp(); if (c) $('#st-time').textContent = `${LM.fmtTC(st.time, c.fps)}  ·  frame ${Math.round(st.time * c.fps)}`; });
  LM.fmtTC = (t, fps) => { const f = Math.round(t * fps), fr = f % Math.round(fps), s = Math.floor(f / Math.round(fps)), m = Math.floor(s / 60); return `${String(Math.floor(m / 60)).padStart(1, '0')}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}:${String(fr).padStart(2, '0')}`; };
  LM.on('compchange', () => { V.fit = true; resize(); });
  LM.on('select', () => { V.selVertex = null; });
  V.resize = resize;
})();
