'use strict';
/* Stage: render loop, view transform (zoom / pan / rotate / flip), overlay, pointer & touch input. */
let R = null;                       // Renderer
const view = { zoom: 1, angle: 0, flip: false, tx: 0, ty: 0 };
let V = mat.id(), Vi = mat.id();
let dpr = 1, stageW = 1, stageH = 1;
let rafPending = false, composedVer = -1, viewDirty = true, ovlDirty = true;
let floating = null;                // transform tool floating pixels {L, data,w,h, quad, ver}
const keys = { space: false, r: false, alt: false, shift: false, ctrl: false };
let pointerPos = null;              // last pointer in stage css px
let lastPenTime = 0;
const frameStats = { n: 0, ms: 0, worst: 0 };

function updateV() {
  const s = view.zoom;
  V = mat.mul(mat.tr(view.tx, view.ty), mat.mul(mat.rot(view.angle), mat.sc(view.flip ? -s : s, s)));
  Vi = mat.inv(V); viewDirty = true; ovlDirty = true; requestRender();
  const z = $('#st-zoom'); if (z) z.textContent = Math.round(view.zoom * 100) + '%' + (view.angle ? ` · ${Math.round(view.angle * 180 / Math.PI)}°` : '') + (view.flip ? ' · flipped' : '');
}
const toDoc = (sx, sy) => mat.ap(Vi, sx, sy);
const toScreen = (x, y) => mat.ap(V, x, y);
function setViewKeep(docPt, scrPt) { // adjust translation so docPt maps to scrPt
  view.tx = 0; view.ty = 0; const s = view.zoom;
  const A = mat.mul(mat.rot(view.angle), mat.sc(view.flip ? -s : s, s)), p = mat.ap(A, docPt[0], docPt[1]);
  view.tx = scrPt[0] - p[0]; view.ty = scrPt[1] - p[1]; updateV();
}
function zoomAt(f, sx = stageW / 2, sy = stageH / 2) {
  const d = toDoc(sx, sy); view.zoom = clamp(view.zoom * f, 0.02, 64); setViewKeep(d, [sx, sy]);
}
function setZoom(z) { zoomAt(z / view.zoom); }
function fitView(resetAngle) {
  if (resetAngle) view.angle = 0;
  const c = Math.abs(Math.cos(view.angle)), s = Math.abs(Math.sin(view.angle));
  const bw = doc.w * c + doc.h * s, bh = doc.w * s + doc.h * c;
  view.zoom = Math.min((stageW - 40) / bw, (stageH - 40) / bh, 8);
  setViewKeep([doc.w / 2, doc.h / 2], [stageW / 2, stageH / 2]);
}
function rotateView(a, about = [stageW / 2, stageH / 2]) { const d = toDoc(about[0], about[1]); view.angle = a; setViewKeep(d, about); }
function flipView() { const d = toDoc(stageW / 2, stageH / 2); view.flip = !view.flip; setViewKeep(d, [stageW / 2, stageH / 2]); Aero.toast(view.flip ? 'View flipped horizontally' : 'View flip off'); }

function requestRender() { if (!rafPending) { rafPending = true; requestAnimationFrame(frame); } }
function requestOverlay() { ovlDirty = true; requestRender(); }
function frame(now) {
  rafPending = false;
  if (!doc || !R) return;
  const t0 = performance.now();
  if (activeStroke) flushBuild(activeStroke);
  tickWet(now);
  if (doc.ver !== composedVer) { R.compose(); composedVer = doc.ver; viewDirty = true; }
  if (viewDirty) { R.display(V, dpr); viewDirty = false; }
  const antsOn = doc.sel && Date.now() - antsT > 140;
  if (ovlDirty || antsOn) { if (antsOn) antsT = Date.now(); drawOverlay(); ovlDirty = false; }
  const ms = performance.now() - t0; frameStats.n++; frameStats.ms += ms; if (ms > frameStats.worst) frameStats.worst = ms;
  if (wetBusy() || doc.sel || (activeTool && activeTool.animating)) requestRender();
  if (!wetBusy() && pendingDryUI) { pendingDryUI = false; refreshLayersSoon(); }
}
let antsT = 0, pendingDryUI = false;

/* ---------- overlay ---------- */
let ovl, octx;
function drawOverlay() {
  const c = octx; c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, ovl.width, ovl.height);
  if (!doc) return;
  const D = mat.mul(mat.sc(dpr), V);
  const docSpace = () => c.setTransform(D[0], D[1], D[2], D[3], D[4], D[5]);
  const px = 1 / view.zoom;
  // guides
  docSpace(); drawGuides(c, px);
  // selection marching ants
  if (doc.sel && selPath) {
    docSpace(); c.lineWidth = px; c.setLineDash([4 * px, 4 * px]);
    c.strokeStyle = '#fff'; c.lineDashOffset = 0; c.stroke(selPath);
    c.strokeStyle = '#000'; c.lineDashOffset = ((Date.now() / 120) % 8) * px; c.stroke(selPath); c.setLineDash([]);
  }
  docSpace(); activeTool?.overlay?.(c, px);
  // brush cursor (screen space)
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (pointerPos && activeTool?.cursor) activeTool.cursor(c, pointerPos);
}
let selPath = null;
function selectionChanged() {
  doc.selBox = selBounds(doc.sel);
  selPath = doc.sel ? buildSelPath(doc.sel) : null; requestOverlay();
}
function buildSelPath(sel) { // boundary segments of the (downsampled) mask
  const w = doc.w, h = doc.h, f = Math.max(1, Math.ceil(Math.max(w, h) / 1100)), gw = Math.ceil(w / f), gh = Math.ceil(h / f);
  const g = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) g[y * gw + x] = sel[Math.min(h - 1, y * f + (f >> 1)) * w + Math.min(w - 1, x * f + (f >> 1))] > 127 ? 1 : 0;
  const p = new Path2D(), at = (x, y) => x < 0 || y < 0 || x >= gw || y >= gh ? 0 : g[y * gw + x];
  for (let y = 0; y <= gh; y++) { let run = -1; for (let x = 0; x <= gw; x++) { const e = x < gw && at(x, y) !== at(x, y - 1); if (e && run < 0) run = x; if (!e && run >= 0) { p.moveTo(run * f, y * f); p.lineTo(x * f, y * f); run = -1; } } }
  for (let x = 0; x <= gw; x++) { let run = -1; for (let y = 0; y <= gh; y++) { const e = y < gh && at(x, y) !== at(x - 1, y); if (e && run < 0) run = y; if (!e && run >= 0) { p.moveTo(x * f, run * f); p.lineTo(x * f, y * f); run = -1; } } }
  return p;
}

/* ---------- stage setup / resize ---------- */
function initStage() {
  const glc = $('#glc'); ovl = $('#ovl'); octx = ovl.getContext('2d');
  R = new Renderer(glc);
  const st = $('#stage');
  new ResizeObserver(() => resizeStage()).observe(st);
  resizeStage();
  glc.addEventListener('webglcontextlost', e => { e.preventDefault(); Aero.toast('Graphics context lost — restoring…'); });
  glc.addEventListener('webglcontextrestored', () => {
    for (const [L, s] of [...wetSims]) if (s.gpu) { s.W = null; wetSims.delete(L); } // GPU wet paint can't survive a lost context
    Object.assign(wglRes, { ready: null, tips: {}, grain: {}, sel: null, selV: -1 });
    R = new Renderer(glc); composedVer = -1; requestRender(); refreshLayersSoon();
  });
  bindInput(st);
}
function resizeStage() {
  const st = $('#stage'), r = st.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
  const ow = stageW, oh = stageH;
  stageW = Math.max(1, r.width); stageH = Math.max(1, r.height);
  for (const c of [$('#glc'), ovl]) { c.width = Math.round(stageW * dpr); c.height = Math.round(stageH * dpr); c.style.width = stageW + 'px'; c.style.height = stageH + 'px'; }
  if (doc) { view.tx += (stageW - ow) / 2; view.ty += (stageH - oh) / 2; updateV(); }
}

/* ---------- input ---------- */
const touches = new Map(); let gesture = null, pendingTouch = null, toolPointer = null, navDrag = null;
function evPoint(e, st) { const r = st.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
function bindInput(st) {
  st.addEventListener('contextmenu', e => e.preventDefault());
  st.addEventListener('pointerdown', e => {
    if (e.target.closest('.refpanel,.aero-pill')) return;
    const sp = evPoint(e, st);
    if (e.pointerType === 'pen') lastPenTime = Date.now();
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { sp, start: sp, t: Date.now() }); try { st.setPointerCapture(e.pointerId); } catch (_) { }
      if (touches.size >= 2) { cancelToolPointer(); startGesture(); return; }
      if (Date.now() - lastPenTime < 5000 || !prefs.touchPaint) { startGestureSingle(e.pointerId); return; }
      pendingTouch = { e, sp, t: Date.now(), id: e.pointerId };
      return;
    }
    if (toolPointer || navDrag) return;
    try { st.setPointerCapture(e.pointerId); } catch (_) { }
    if (e.button === 1 || (e.button === 0 && keys.space) || activeToolId === 'hand') { navDrag = { mode: keys.ctrl && keys.space ? 'zoom' : 'pan', sp, v: { ...view }, d: toDoc(...sp) }; st.style.cursor = 'grabbing'; return; }
    if (e.button === 0 && keys.r) { navDrag = { mode: 'rotate', sp, a0: Math.atan2(sp[1] - stageH / 2, sp[0] - stageW / 2), ang: view.angle }; return; }
    if (e.button === 2) { // right-click = eyedropper for painting tools
      if (isPaintTool()) { pickColorAt(toDoc(...sp)); toolPointer = { id: e.pointerId, pick: true }; } return;
    }
    if (e.button !== 0) return;
    if (e.altKey && isPaintTool()) { pickColorAt(toDoc(...sp)); toolPointer = { id: e.pointerId, pick: true }; return; }
    toolDown(e, sp);
  });
  st.addEventListener('pointermove', e => {
    const sp = evPoint(e, st); pointerPos = sp;
    const dp = toDoc(...sp); $('#st-pos').textContent = `${Math.round(dp[0])}, ${Math.round(dp[1])}`;
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) {
      touches.get(e.pointerId).sp = sp;
      if (gesture) { moveGesture(); return; }
      if (pendingTouch && pendingTouch.id === e.pointerId) {
        const d = Math.hypot(sp[0] - pendingTouch.sp[0], sp[1] - pendingTouch.sp[1]);
        if (d > 6 || Date.now() - pendingTouch.t > 120) { const pe = pendingTouch.e; pendingTouch = null; toolDown(pe, evPoint(pe, st)); }
        else return;
      }
    }
    if (navDrag) {
      if (navDrag.mode === 'pan') { view.tx = navDrag.v.tx + sp[0] - navDrag.sp[0]; view.ty = navDrag.v.ty + sp[1] - navDrag.sp[1]; updateV(); }
      else if (navDrag.mode === 'zoom') { view.zoom = navDrag.v.zoom; zoomAt(Math.exp((sp[0] - navDrag.sp[0]) / 150), navDrag.sp[0], navDrag.sp[1]); }
      else { let a = navDrag.ang + Math.atan2(sp[1] - stageH / 2, sp[0] - stageW / 2) - navDrag.a0; if (keys.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12); rotateView(a); }
      return;
    }
    if (toolPointer && toolPointer.id === e.pointerId) {
      if (toolPointer.pick) { pickColorAt(dp); return; }
      const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ce of (evs.length ? evs : [e])) toolPointer.tool.move?.(mkPt(ce, st), ce);
      requestOverlay();
      return;
    }
    activeTool?.hover?.(dp, e); requestOverlay();
  });
  const up = e => {
    if (e.pointerType === 'touch') {
      const t = touches.get(e.pointerId); touches.delete(e.pointerId);
      if (gesture) { if (!touches.size) endGesture(); return; }
      if (pendingTouch && pendingTouch.id === e.pointerId) { const pe = pendingTouch.e; pendingTouch = null; toolDown(pe, evPoint(pe, st)); }
    }
    if (navDrag) { navDrag = null; $('#stage').style.cursor = ''; return; }
    if (toolPointer && toolPointer.id === e.pointerId) {
      const tp = toolPointer; toolPointer = null;
      if (!tp.pick) tp.tool.up?.(mkPt(e, st), e);
      requestOverlay();
    }
  };
  st.addEventListener('pointerup', up); st.addEventListener('pointercancel', e => { if (toolPointer && toolPointer.id === e.pointerId) cancelToolPointer(); else up(e); });
  st.addEventListener('pointerleave', () => { pointerPos = null; requestOverlay(); });
  st.addEventListener('wheel', e => {
    e.preventDefault();
    const sp = evPoint(e, st);
    const dy = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 400 : 1), dx = e.deltaX * (e.deltaMode === 1 ? 40 : 1);
    if (e.altKey) rotateView(view.angle + dy * 0.003, sp);
    else if (e.shiftKey) { view.tx -= dy || dx; updateV(); }
    else if (!e.ctrlKey && Math.abs(dx) > Math.abs(dy)) { view.tx -= dx; updateV(); }
    else zoomAt(Math.exp(-clamp(dy, -200, 200) * (e.ctrlKey ? 0.01 : 0.0018)), sp[0], sp[1]);
  }, { passive: false });
  addEventListener('keydown', e => {
    if (e.target.matches?.('input:not([type=range]):not([type=checkbox]),textarea,select')) return;
    keys.alt = e.altKey; keys.shift = e.shiftKey; keys.ctrl = e.ctrlKey || e.metaKey;
    if (e.code === 'Space' && !e.repeat) { keys.space = true; $('#stage').style.cursor = 'grab'; e.preventDefault(); }
    if (e.code === 'KeyR' && !e.ctrlKey && !e.altKey && !e.shiftKey) keys.r = true;
    if (e.key === 'Alt') e.preventDefault();
    requestOverlay();
  });
  addEventListener('keyup', e => {
    keys.alt = e.altKey; keys.shift = e.shiftKey; keys.ctrl = e.ctrlKey || e.metaKey;
    if (e.code === 'Space') { keys.space = false; $('#stage').style.cursor = ''; }
    if (e.code === 'KeyR') keys.r = false;
    requestOverlay();
  });
  addEventListener('blur', () => { keys.space = keys.r = keys.alt = keys.shift = keys.ctrl = false; });
}
function mkPt(e, st) {
  const sp = evPoint(e, st), d = toDoc(...sp);
  let p = e.pressure; if (e.pointerType === 'mouse' || (!p && e.pointerType !== 'pen')) p = null; if (e.pointerType === 'pen' && !p && e.buttons) p = 0.02;
  return { x: d[0], y: d[1], sx: sp[0], sy: sp[1], p, tx: e.tiltX || 0, ty: e.tiltY || 0, t: e.timeStamp || performance.now(), mouse: e.pointerType !== 'pen' && !(e.pointerType === 'touch' && e.pressure > 0 && e.pressure !== 0.5) };
}
function toolDown(e, sp) {
  if (!activeTool) return;
  // flipped stylus (eraser end) erases with the eraser tool's brush, whatever tool is active
  const tool = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32)) ? TOOLS.eraser : activeTool;
  toolPointer = { id: e.pointerId, tool };
  try { $('#stage').setPointerCapture(e.pointerId); } catch (_) { }
  const ok = tool.down?.(mkPt(e, $('#stage')), e);
  if (ok === false) toolPointer = null;
  requestOverlay();
}
function cancelToolPointer() {
  if (!toolPointer) return; const tp = toolPointer; toolPointer = null;
  (tp.tool || activeTool)?.cancel?.();
}
function startGesture() {
  pendingTouch = null;
  const pts = [...touches.values()].slice(0, 2);
  const c = [(pts[0].sp[0] + pts[1].sp[0]) / 2, (pts[0].sp[1] + pts[1].sp[1]) / 2];
  gesture = { n: touches.size, maxN: touches.size, t: Date.now(), c0: c, d0: Math.hypot(pts[1].sp[0] - pts[0].sp[0], pts[1].sp[1] - pts[0].sp[1]) || 1, a0: Math.atan2(pts[1].sp[1] - pts[0].sp[1], pts[1].sp[0] - pts[0].sp[0]), z0: view.zoom, ang0: view.angle, doc0: toDoc(...c), moved: 0 };
}
function startGestureSingle(id) { gesture = { single: id, t: Date.now(), start: touches.get(id).sp, v: { ...view }, maxN: 1, moved: 0 }; }
function moveGesture() {
  const g = gesture;
  if (g.single != null) { const t = touches.get(g.single); if (!t) return; view.tx = g.v.tx + t.sp[0] - g.start[0]; view.ty = g.v.ty + t.sp[1] - g.start[1]; g.moved = Math.max(g.moved, Math.hypot(t.sp[0] - g.start[0], t.sp[1] - g.start[1])); updateV(); return; }
  g.maxN = Math.max(g.maxN, touches.size);
  const pts = [...touches.values()]; if (pts.length < 2) return;
  const c = [(pts[0].sp[0] + pts[1].sp[0]) / 2, (pts[0].sp[1] + pts[1].sp[1]) / 2];
  const d = Math.hypot(pts[1].sp[0] - pts[0].sp[0], pts[1].sp[1] - pts[0].sp[1]) || 1, a = Math.atan2(pts[1].sp[1] - pts[0].sp[1], pts[1].sp[0] - pts[0].sp[0]);
  g.moved = Math.max(g.moved, Math.abs(d - g.d0), Math.hypot(c[0] - g.c0[0], c[1] - g.c0[1]));
  if (g.moved < 8) return;
  view.zoom = clamp(g.z0 * d / g.d0, 0.02, 64);
  let ang = g.ang0 + (a - g.a0); if (Math.abs(((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2)) < 0.05) ang = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
  view.angle = ang; setViewKeep(g.doc0, c);
}
function endGesture() {
  const g = gesture; gesture = null; if (!g) return;
  if (g.single == null && Date.now() - g.t < 300 && g.moved < 10) { if (g.maxN >= 3) redo(); else undo(); }
}
function isPaintTool() { return ['brush', 'eraser', 'smudge', 'fill', 'gradient', 'shape'].includes(activeToolId); }
function pickColorAt(d) {
  if (!doc) return;
  if (d[0] < 0 || d[1] < 0 || d[0] >= doc.w || d[1] >= doc.h) return;
  if (activeStroke) flushBuild(activeStroke);
  if (doc.ver !== composedVer) { R.compose(); composedVer = doc.ver; }
  const p = R.pick(d[0], d[1]);
  if (p[3] < 8) return;
  setFG([p[0] / 255, p[1] / 255, p[2] / 255]);
}
