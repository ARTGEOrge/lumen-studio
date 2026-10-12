'use strict';
/* On-canvas Free Transform (Ctrl+T): bounding quad with handles. Drag a corner/side to scale (Shift proportional,
   Alt from the reference point), outside to rotate (Shift snaps 15°), Ctrl-drag a side to skew, Ctrl-drag a corner to
   distort, Ctrl+Alt+Shift-drag a corner for perspective. Enter commits, Esc cancels, Ctrl+Z steps back.
   Works on raster layers (with their mask), masks, selections (as a floating piece), text (scale/rotate stay
   editable) and on the selection outline itself (Select > Transform Selection). */
let ft = null;
const ftActive = () => !!ft;

/* ---------- projective math ---------- */
function sqToQuad(q) {   // homography mapping the unit square (u,v) to quad q = [TL, TR, BR, BL]
  const [p0, p1, p2, p3] = q;
  const sx = p0.x - p1.x + p2.x - p3.x, sy = p0.y - p1.y + p2.y - p3.y;
  let g = 0, h = 0;
  if (Math.abs(sx) > 1e-7 || Math.abs(sy) > 1e-7) {
    const dx1 = p1.x - p2.x, dx2 = p3.x - p2.x, dy1 = p1.y - p2.y, dy2 = p3.y - p2.y, den = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(den) > 1e-12) { g = (sx * dy2 - dx2 * sy) / den; h = (dx1 * sy - sx * dy1) / den; }
  }
  return [p1.x - p0.x + g * p1.x, p3.x - p0.x + h * p3.x, p0.x, p1.y - p0.y + g * p1.y, p3.y - p0.y + h * p3.y, p0.y, g, h, 1];
}
function hApply(m, x, y) { const w = m[6] * x + m[7] * y + m[8]; return { x: (m[0] * x + m[1] * y + m[2]) / w, y: (m[3] * x + m[4] * y + m[5]) / w }; }
function hMul(a, b) {
  const o = new Array(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
function hInv(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-14) return null;
  const k = 1 / det;
  return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
}
const isAffineH = m => Math.abs(m[6]) < 1e-9 && Math.abs(m[7]) < 1e-9;
// doc -> doc homography of the current transform: source rect B -> quad
function ftDocH(q = ft.q, B = ft.B) { return hMul(sqToQuad(q), [1 / B.w, 0, -B.x / B.w, 0, 1 / B.h, -B.y / B.h, 0, 0, 1]); }
function quadConvex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4], z = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(z) < 1e-6) return false;
    if (!sign) sign = Math.sign(z); else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

/* ---------- warping ---------- */
// Render source canvas S (pixel (0,0) at doc R.x,R.y) through doc->doc homography Hd. Returns {canvas, x, y} or null.
function warpCanvas(S, R, Hd) {
  const pts = isAffineH(Hd) ? [[R.x, R.y], [R.x + S.width, R.y], [R.x + S.width, R.y + S.height], [R.x, R.y + S.height]].map(([x, y]) => hApply(Hd, x, y)) : ft ? ft.q : null;
  if (!pts) return null;
  const lim = { x: -doc.w * 2, y: -doc.h * 2, w: doc.w * 5, h: doc.h * 5 };
  let bb = { x: Math.floor(Math.min(...pts.map(p => p.x))) - 1, y: Math.floor(Math.min(...pts.map(p => p.y))) - 1 };
  bb.w = Math.ceil(Math.max(...pts.map(p => p.x))) + 1 - bb.x; bb.h = Math.ceil(Math.max(...pts.map(p => p.y))) + 1 - bb.y;
  bb = interRect(bb, lim); if (!bb) return null;
  const o = mk(bb.w, bb.h), c = cx(o);
  if (isAffineH(Hd)) {
    c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.setTransform(Hd[0], Hd[3], Hd[1], Hd[4], Hd[2] - bb.x, Hd[5] - bb.y); c.drawImage(S, R.x, R.y); reset(c);
    return { canvas: o, x: bb.x, y: bb.y };
  }
  // perspective: inverse mapping with premultiplied bilinear sampling
  const inv = hInv(Hd); if (!inv) return null;
  const sw = S.width, sh = S.height, sd = cx(S).getImageData(0, 0, sw, sh).data, out = c.createImageData(bb.w, bb.h), od = out.data;
  for (let y = 0; y < bb.h; y++) {
    const Y = bb.y + y + 0.5;
    for (let x = 0; x < bb.w; x++) {
      const X = bb.x + x + 0.5, w = inv[6] * X + inv[7] * Y + inv[8]; if (w <= 0) continue;
      const u = (inv[0] * X + inv[1] * Y + inv[2]) / w - R.x - 0.5, v = (inv[3] * X + inv[4] * Y + inv[5]) / w - R.y - 0.5;
      if (u < -1 || v < -1 || u > sw || v > sh) continue;
      const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0;
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < 4; k++) {
        const xx = x0 + (k & 1), yy = y0 + (k >> 1); if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue;
        const wt = ((k & 1) ? fx : 1 - fx) * ((k >> 1) ? fy : 1 - fy), i = (yy * sw + xx) * 4, al = sd[i + 3] * wt;
        r += sd[i] * al; g += sd[i + 1] * al; b += sd[i + 2] * al; a += al;
      }
      if (a <= 0.01) continue;
      const j = (y * bb.w + x) * 4; od[j] = r / a; od[j + 1] = g / a; od[j + 2] = b / a; od[j + 3] = a;
    }
  }
  c.putImageData(out, 0, 0);
  return { canvas: o, x: bb.x, y: bb.y };
}
// layer mask <-> "hide alpha" (black with alpha = how much the mask hides), so masks transform like pixels
function hideAlpha(m) {
  const o = clone(m), c = cx(o), img = c.getImageData(0, 0, o.width, o.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) { d[i + 3] = 255 - ((d[i] * 54 + d[i + 1] * 183 + d[i + 2] * 19) >> 8); d[i] = d[i + 1] = d[i + 2] = 0; }
  c.putImageData(img, 0, 0); return o;
}
function maskFromHide(rect, parts) {   // white mask over rect with hide-alpha parts [{canvas,x,y}] drawn black
  const m = mk(rect.w, rect.h), c = cx(m); c.fillStyle = '#fff'; c.fillRect(0, 0, rect.w, rect.h);
  parts.forEach(p => p && c.drawImage(p.canvas, p.x - rect.x, p.y - rect.y)); return m;
}
const boundsIn = (canvas, ox, oy) => { const b = maskBounds(canvas); return b ? { x: b.x + ox, y: b.y + oy, w: b.w, h: b.h } : null; };
const crop = (src, r, ox, oy) => { const o = mk(r.w, r.h); cx(o).drawImage(src, ox - r.x, oy - r.y); return o; };

/* ---------- start / update / commit ---------- */
function freeTransform(mode = 'free', what) {
  if (!doc) return;
  if (ft) { ftCommit(); return; }
  if (stroke || dragging) return;
  const L = layer();
  let s;
  if (what === 'selection') {
    if (!selection) return toast('Make a selection first');
    const B = maskBounds(selection.mask); if (!B) return;
    s = { kind: 'selection', B, src: crop(selection.mask, B, 0, 0) };
  } else if (L.type === 'group') return toast('Pick a layer inside the group to transform');
  else if (doc.editMask && L.mask) {
    ensureCover(L);
    const hide = hideAlpha(L.mask.canvas), sel = selection ? clone(maskedAt(hide, L.x, L.y)) : hide, B = boundsIn(sel, L.x, L.y);
    if (!B) return toast(selection ? 'The selected part of the mask is empty' : 'The mask hides nothing to transform');
    s = { kind: selection ? 'maskfloat' : 'mask', B, src: crop(sel, B, L.x, L.y) };
    if (selection) { const rest = clone(L.mask.canvas), rc = cx(rest); rc.globalCompositeOperation = 'source-over'; rc.save(); rc.translate(-L.x, -L.y); const w = clone(selection.mask), wc = cx(w); wc.globalCompositeOperation = 'source-in'; wc.fillStyle = '#fff'; wc.fillRect(0, 0, w.width, w.height); rc.drawImage(w, 0, 0); rc.restore(); s.rest = rest; }
  } else if (L.type === 'adjust') return toast('Adjustment layers have no pixels — select its mask to transform it');
  else if (L.type === 'text' && !selection) {
    s = { kind: 'text', B: lrect(L) };
  } else {
    if (L.type === 'text') { rasterize(L); toast('Text layer rasterized'); }
    if (!L.canvas) return;
    if (selection) {
      const fl = clone(maskedAt(L.canvas, L.x, L.y)), B = boundsIn(fl, L.x, L.y); if (!B) return toast('The selected area is empty on this layer');
      const rest = clone(L.canvas), rc = cx(rest); rc.globalCompositeOperation = 'destination-out'; rc.drawImage(selection.mask, -L.x, -L.y); reset(rc);
      s = { kind: 'float', B, src: crop(fl, B, L.x, L.y), rest };
    } else {
      const B = boundsIn(L.canvas, L.x, L.y); if (!B) return toast('This layer is empty');
      s = { kind: 'layer', B, src: crop(L.canvas, B, L.x, L.y) };
      if (L.mask) { s.hide = hideAlpha(L.mask.canvas); }
    }
  }
  const B = s.B;
  ft = {
    ...s, L, mode, pivotUV: { u: 0.5, v: 0.5 }, stack: [], drag: null,
    q: [{ x: B.x, y: B.y }, { x: B.x + B.w, y: B.y }, { x: B.x + B.w, y: B.y + B.h }, { x: B.x, y: B.y + B.h }],
    orig: { x: L.x, y: L.y, canvas: L.canvas, mask: L.mask ? L.mask.canvas : null, text: L.text ? { ...L.text } : null, type: L.type, sel: selection ? selection.mask : null },
    selMask0: selection ? clone(selection.mask) : null
  };
  if (ft.kind === 'text') { ft.text0 = { ...L.text }; ft.c0 = { x: B.x + B.w / 2, y: B.y + B.h / 2 }; }
  live = ft.kind === 'selection' ? null : { isMask: false, get: () => ft.L.canvas };
  ftApply(); buildOptions(); updateCursor();
  setStatusMsg('Free Transform — Enter to apply, Esc to cancel');
}
let ftPending = false;
function ftSchedule() { if (ftPending) return; ftPending = true; requestAnimationFrame(() => { ftPending = false; if (ft) ftApply(); }); }
function ftApply() {
  const f = ft, L = f.L, o = f.orig;
  if (!quadConvex(f.q)) { requestOverlay(); return; }
  const Hd = ftDocH();
  if (f.kind === 'text') {
    const t0 = f.text0, p0 = f.q[0], p1 = f.q[1], p3 = f.q[3], sx = Math.hypot(p1.x - p0.x, p1.y - p0.y) / f.B.w, sy = Math.hypot(p3.x - p0.x, p3.y - p0.y) / f.B.h;
    const s = Math.sqrt(sx * sy), ang = Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI;
    L.text = { ...t0, size: Math.max(1, t0.size * s), outline: (t0.outline || 0) * s, angle: ((t0.angle + ang + 540) % 360) - 180 };
    renderText(L);
    const c = hApply(Hd, f.c0.x, f.c0.y), r = lrect(L);
    shiftLayer(L, Math.round(c.x - (r.x + r.w / 2)), Math.round(c.y - (r.y + r.h / 2)));
  } else if (f.kind === 'selection') {
    f.result = warpCanvas(f.src, f.B, Hd);
  } else if (f.kind === 'layer') {
    const t = warpCanvas(f.src, f.B, Hd); if (!t) return;
    let rect = { x: t.x, y: t.y, w: t.canvas.width, h: t.canvas.height }, mh = null;
    if (f.hide) { const hb = isAffineH(Hd) ? { x: o.x, y: o.y } : f.B; mh = isAffineH(Hd) ? warpCanvas(f.hide, hb, Hd) : warpCanvas(crop(f.hide, f.B, o.x, o.y), f.B, Hd); if (mh) rect = unionRect(rect, { x: mh.x, y: mh.y, w: mh.canvas.width, h: mh.canvas.height }); }
    const pc = mk(rect.w, rect.h); cx(pc).drawImage(t.canvas, t.x - rect.x, t.y - rect.y);
    setCanvas(L, pc); L.x = rect.x; L.y = rect.y;
    if (L.mask) L.mask.canvas = maskFromHide(rect, [mh]);
  } else if (f.kind === 'float') {
    const t = warpCanvas(f.src, f.B, Hd); if (!t) return;
    const r0 = { x: o.x, y: o.y, w: f.rest.width, h: f.rest.height }, rect = unionRect(r0, { x: t.x, y: t.y, w: t.canvas.width, h: t.canvas.height });
    const pc = mk(rect.w, rect.h), c = cx(pc); c.drawImage(f.rest, r0.x - rect.x, r0.y - rect.y); c.drawImage(t.canvas, t.x - rect.x, t.y - rect.y);
    if (o.mask) { const m = mk(rect.w, rect.h), mc = cx(m); mc.fillStyle = '#fff'; mc.fillRect(0, 0, rect.w, rect.h); mc.drawImage(o.mask, r0.x - rect.x, r0.y - rect.y); L.mask.canvas = m; }
    setCanvas(L, pc); L.x = rect.x; L.y = rect.y;
    f.result = warpCanvas(crop(f.selMask0, f.B, 0, 0), f.B, Hd);
  } else if (f.kind === 'mask' || f.kind === 'maskfloat') {
    const t = warpCanvas(f.src, f.B, Hd); if (!t) return;
    const r0 = { x: o.x, y: o.y, w: o.mask.width, h: o.mask.height }, rect = unionRect(r0, { x: t.x, y: t.y, w: t.canvas.width, h: t.canvas.height });
    if (o.canvas) { const pc = mk(rect.w, rect.h); cx(pc).drawImage(o.canvas, r0.x - rect.x, r0.y - rect.y); setCanvas(L, pc); }
    const base = f.kind === 'maskfloat' ? f.rest : null;
    const m = maskFromHide(rect, [t]);
    if (base) { const mc = cx(m); mc.globalCompositeOperation = 'multiply'; mc.fillStyle = '#fff'; const b2 = mk(rect.w, rect.h), bc = cx(b2); bc.fillStyle = '#fff'; bc.fillRect(0, 0, rect.w, rect.h); bc.drawImage(base, r0.x - rect.x, r0.y - rect.y); mc.drawImage(b2, 0, 0); reset(mc); }
    else if (f.kind === 'mask') { /* whole mask transformed: outside is revealed */ }
    L.mask.canvas = m; L.x = rect.x; L.y = rect.y;
    if (f.kind === 'maskfloat') f.result = warpCanvas(crop(f.selMask0, f.B, 0, 0), f.B, Hd);
  }
  requestRender(true); updateFtOptions();
}
function ftRestore() {
  const f = ft, L = f.L, o = f.orig;
  L.type = o.type; L.text = o.text ? { ...o.text } : null; setCanvas(L, o.canvas); if (L.mask) L.mask.canvas = o.mask; L.x = o.x; L.y = o.y;
}
function ftEnd() { ft = null; live = null; setStatusMsg(''); buildOptions(); updateCursor(); requestRender(); }
function ftCancel(silent) { if (!ft) return; ftRestore(); ftEnd(); if (!silent) updatePanels(); }
function ftCommit() {
  if (!ft) return;
  const f = ft;
  if (!quadConvex(f.q)) { toast('Invalid transform — the box folds over itself'); return ftCancel(); }
  ftApply();
  const changed = f.q.some((p, i) => Math.abs(p.x - [f.B.x, f.B.x + f.B.w, f.B.x + f.B.w, f.B.x][i]) > 0.01 || Math.abs(p.y - [f.B.y, f.B.y, f.B.y + f.B.h, f.B.y + f.B.h][i]) > 0.01);
  if (f.kind === 'selection' || f.kind === 'float' || f.kind === 'maskfloat') {
    if (f.result) { const m = mk(doc.w, doc.h); cx(m).drawImage(f.result.canvas, f.result.x, f.result.y); setSel(maskEmpty(m) ? null : m); }
  }
  ftEnd();
  if (!changed) { if (f.kind !== 'selection') { ftRestoreFrom(f); } requestRender(); return; }
  if (f.kind === 'selection') { requestOverlay(); toast('Selection transformed'); return; }
  pushHistory('Free Transform');
}
function ftRestoreFrom(f) { const L = f.L, o = f.orig; L.type = o.type; L.text = o.text ? { ...o.text } : null; setCanvas(L, o.canvas); if (L.mask) L.mask.canvas = o.mask; L.x = o.x; L.y = o.y; if (o.sel) setSel(o.sel); }
function ftPush() { ft.stack.push(ft.q.map(p => ({ ...p }))); if (ft.stack.length > 60) ft.stack.shift(); }
function ftUndo() { if (!ft) return; if (!ft.stack.length) return ftCancel(); ft.q = ft.stack.pop(); ftApply(); }

/* ---------- interaction ---------- */
const sp = p => ({ x: panX + p.x * zoom, y: panY + p.y * zoom });
function ftPivot() { return hApply(sqToQuad(ft.q), ft.pivotUV.u, ft.pivotUV.v); }
function ftHandles() {
  const q = ft.q, mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  return [q[0], q[1], q[2], q[3], mid(q[0], q[1]), mid(q[1], q[2]), mid(q[2], q[3]), mid(q[3], q[0])];
}
function pointInQuad(p, q) { let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4], z = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); if (z !== 0) { if (s && Math.sign(z) !== s) return false; s = Math.sign(z); } } return true; }
function ftHit(p) {   // p in doc coords
  const s = sp(p), pv = sp(ftPivot());
  if (Math.hypot(s.x - pv.x, s.y - pv.y) <= 7) return { kind: 'pivot' };
  const hs = ftHandles();
  for (let i = 0; i < 8; i++) { const h = sp(hs[i]); if (Math.abs(h.x - s.x) <= 6 && Math.abs(h.y - s.y) <= 6) return { kind: i < 4 ? 'corner' : 'side', i }; }
  if (pointInQuad(p, ft.q)) return { kind: 'move' };
  return { kind: 'rotate' };
}
const CORNER_UV = [{ u: 0, v: 0 }, { u: 1, v: 0 }, { u: 1, v: 1 }, { u: 0, v: 1 }], SIDE_UV = [{ u: 0.5, v: 0 }, { u: 1, v: 0.5 }, { u: 0.5, v: 1 }, { u: 0, v: 0.5 }];
function ftDown(p, e) {
  const hit = ftHit(p); ftPush();
  ft.drag = { hit, start: p, q0: ft.q.map(o => ({ ...o })), H0: sqToQuad(ft.q), pivot0: ftPivot() };
  ft.drag.Hi0 = hInv(ft.drag.H0);
}
function ftMove(p, e) {
  const d = ft.drag; if (!d) return;
  const { hit, q0, start } = d, ctrl = e.ctrlKey || e.metaKey, isText = ft.kind === 'text';
  let mode = ft.mode;
  if (hit.kind === 'corner' && ctrl) mode = e.altKey && e.shiftKey ? 'perspective' : 'distort';
  if (hit.kind === 'side' && ctrl) mode = 'skew';
  if (isText && (mode === 'distort' || mode === 'perspective' || mode === 'skew')) { if (!ftMove.warned) { toast('Rasterize the text layer to skew or distort it'); ftMove.warned = true; } mode = 'free'; }
  let dx = p.x - start.x, dy = p.y - start.y;
  if (hit.kind === 'move') {
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    const moved = q0.map(o => ({ x: o.x + dx, y: o.y + dy })), adj = snapRectDelta(quadBox(moved));
    ft.q = moved.map(o => ({ x: o.x + adj.x, y: o.y + adj.y }));
  } else if (hit.kind === 'pivot') {
    const uv = hApply(hInv(sqToQuad(q0)), p.x, p.y); ft.pivotUV = { u: uv.x, v: uv.y }; requestOverlay(); return;
  } else if (hit.kind === 'rotate' || mode === 'rotate' && hit.kind !== 'move') {
    const c = d.pivot0; let a = Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(start.y - c.y, start.x - c.x);
    if (e.shiftKey) { const base = Math.atan2(q0[1].y - q0[0].y, q0[1].x - q0[0].x), tot = base + a; a = Math.round(tot / (Math.PI / 12)) * (Math.PI / 12) - base; }
    const cs = Math.cos(a), sn = Math.sin(a);
    ft.q = q0.map(o => ({ x: c.x + (o.x - c.x) * cs - (o.y - c.y) * sn, y: c.y + (o.x - c.x) * sn + (o.y - c.y) * cs }));
  } else if (mode === 'distort' && hit.kind === 'corner') {
    const sp2 = snapPt(p); dx = sp2.x - start.x; dy = sp2.y - start.y;
    ft.q = q0.map((o, i) => i === hit.i ? { x: o.x + dx, y: o.y + dy } : { ...o });
  } else if (mode === 'perspective' && hit.kind === 'corner') {
    const i = hit.i, hz = [[0, 1], [1, 0], [2, 3], [3, 2]][i][1], vt = [[0, 3], [1, 2], [2, 1], [3, 0]][i][1];
    const eh = { x: q0[hz].x - q0[i].x, y: q0[hz].y - q0[i].y }, ev = { x: q0[vt].x - q0[i].x, y: q0[vt].y - q0[i].y };
    const lh = Math.hypot(eh.x, eh.y) || 1, lv = Math.hypot(ev.x, ev.y) || 1, ph = (dx * eh.x + dy * eh.y) / lh, pv = (dx * ev.x + dy * ev.y) / lv;
    ft.q = q0.map(o => ({ ...o }));
    if (Math.abs(ph) >= Math.abs(pv)) { const ux = eh.x / lh, uy = eh.y / lh; ft.q[i] = { x: q0[i].x + ux * ph, y: q0[i].y + uy * ph }; ft.q[hz] = { x: q0[hz].x - ux * ph, y: q0[hz].y - uy * ph }; }
    else { const ux = ev.x / lv, uy = ev.y / lv; ft.q[i] = { x: q0[i].x + ux * pv, y: q0[i].y + uy * pv }; ft.q[vt] = { x: q0[vt].x - ux * pv, y: q0[vt].y - uy * pv }; }
  } else if (mode === 'skew' && (hit.kind === 'side' || hit.kind === 'corner')) {
    const side = hit.kind === 'side' ? hit.i - 4 : [0, 1, 2, 3][hit.i], a = side, b = (side + 1) % 4;
    let mx = dx, my = dy;
    if (ft.mode === 'skew' || e.shiftKey) { const ex = q0[b].x - q0[a].x, ey = q0[b].y - q0[a].y, l = Math.hypot(ex, ey) || 1, pr = (dx * ex + dy * ey) / l; mx = ex / l * pr; my = ey / l * pr; }
    ft.q = q0.map((o, i) => i === a || i === b ? { x: o.x + mx, y: o.y + my } : { ...o });
  } else {
    // scale in the local frame of the box at drag start
    const sp2 = isText ? p : snapPt(p), m = hApply(d.Hi0, sp2.x, sp2.y), h = hit.kind === 'corner' ? CORNER_UV[hit.i] : SIDE_UV[hit.i - 4];
    const anchor = e.altKey ? ft.pivotUV : { u: 1 - h.u, v: 1 - h.v };
    let su = 1, sv = 1;
    if (h.u !== 0.5) su = (m.x - anchor.u) / ((h.u - anchor.u) || 1e-9);
    if (h.v !== 0.5) sv = (m.y - anchor.v) / ((h.v - anchor.v) || 1e-9);
    if (e.shiftKey || isText) {
      if (hit.kind === 'side') { const s = h.u === 0.5 ? sv : su; su = sv = s; }
      else { const s = Math.max(Math.abs(su), Math.abs(sv)); su = Math.sign(su || 1) * s; sv = Math.sign(sv || 1) * s; }
    }
    if (isText) { su = sv = Math.max(0.01, Math.abs(su)); }
    ft.q = CORNER_UV.map(c => hApply(d.H0, anchor.u + (c.u - anchor.u) * su, anchor.v + (c.v - anchor.v) * sv));
  }
  ftSchedule(); requestOverlay();
}
function ftUp() { if (ft) { const d = ft.drag; ft.drag = null; if (d && ft.q.every((p, i) => p.x === d.q0[i].x && p.y === d.q0[i].y)) ft.stack.pop(); ftMove.warned = false; } }
function ftCursor(p) {
  const hit = ftHit(p);
  if (hit.kind === 'move') return 'move';
  if (hit.kind === 'pivot') return 'crosshair';
  if (hit.kind === 'rotate') return 'alias';
  const h = ftHandles()[hit.i], c = hApply(sqToQuad(ft.q), 0.5, 0.5), a = ((Math.atan2(h.y - c.y, h.x - c.x) * 180 / Math.PI) + 360) % 180;
  return a < 22.5 || a >= 157.5 ? 'ew-resize' : a < 67.5 ? 'nwse-resize' : a < 112.5 ? 'ns-resize' : 'nesw-resize';
}
const quadBox = q => { const xs = q.map(p => p.x), ys = q.map(p => p.y), x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; };
function drawFt(c) {
  const q = ft.q.map(sp), ok = quadConvex(ft.q);
  c.save();
  c.beginPath(); q.forEach((p, i) => i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)); c.closePath();
  c.strokeStyle = '#0008'; c.lineWidth = 3; c.stroke(); c.strokeStyle = ok ? '#fff' : '#ff5a4a'; c.lineWidth = 1; c.setLineDash(ok ? [] : [4, 3]); c.stroke(); c.setLineDash([]);
  ftHandles().forEach(h => { const s = sp(h); c.fillStyle = '#fff'; c.strokeStyle = '#1c5fb4'; c.lineWidth = 1; c.fillRect(Math.round(s.x) - 3.5, Math.round(s.y) - 3.5, 7, 7); c.strokeRect(Math.round(s.x) - 3.5, Math.round(s.y) - 3.5, 7, 7); });
  const pv = sp(ftPivot()); c.beginPath(); c.arc(pv.x, pv.y, 5, 0, Math.PI * 2); c.strokeStyle = '#000a'; c.lineWidth = 3; c.stroke(); c.strokeStyle = '#fff'; c.lineWidth = 1.2; c.stroke();
  c.beginPath(); c.moveTo(pv.x - 8, pv.y); c.lineTo(pv.x + 8, pv.y); c.moveTo(pv.x, pv.y - 8); c.lineTo(pv.x, pv.y + 8); c.strokeStyle = '#fff'; c.lineWidth = 1; c.stroke();
  if (ft.kind === 'selection' && ft.result) { c.translate(panX, panY); c.scale(zoom, zoom); c.globalAlpha = 0.35; c.drawImage(tint(ft.result.canvas, '#3a8ee6'), ft.result.x, ft.result.y); }
  c.restore();
}

/* ---------- numeric fields in the options bar ---------- */
function ftParams() {
  const q = ft.q, B = ft.B, p0 = q[0], p1 = q[1], p3 = q[3];
  const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x), w = Math.hypot(p1.x - p0.x, p1.y - p0.y), hgt = Math.hypot(p3.x - p0.x, p3.y - p0.y), pv = ftPivot();
  return { x: pv.x, y: pv.y, w: w / B.w * 100, h: hgt / B.h * 100, a: ang * 180 / Math.PI };
}
function ftSetParams(v) {   // rebuild an affine (unskewed) box from numeric values
  ftPush();
  const B = ft.B, pv0 = ftPivot(), w = B.w * v.w / 100, h = B.h * v.h / 100, a = v.a * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a);
  const pu = ft.pivotUV, loc = CORNER_UV.map(c => ({ x: (c.u - pu.u) * w, y: (c.v - pu.v) * h }));
  ft.q = loc.map(o => ({ x: v.x + o.x * cs - o.y * sn, y: v.y + o.x * sn + o.y * cs }));
  ftApply();
}
function ftFlip(h) {
  ftPush(); const c = ftPivot(), q = ft.q;
  const ax = h ? { x: q[1].x - q[0].x, y: q[1].y - q[0].y } : { x: q[3].x - q[0].x, y: q[3].y - q[0].y }, l = Math.hypot(ax.x, ax.y) || 1, ux = ax.x / l, uy = ax.y / l;
  // mirror every corner across the axis through the reference point; corner roles stay, so the image flips
  ft.q = q.map(p => { const d = (p.x - c.x) * ux + (p.y - c.y) * uy; return { x: p.x - 2 * d * ux, y: p.y - 2 * d * uy }; });
  ftApply(); requestOverlay();
}
function ftRotate(deg) { ftPush(); const c = ftPivot(), a = deg * Math.PI / 180, cs = Math.cos(a), sn = Math.sin(a); ft.q = ft.q.map(o => ({ x: c.x + (o.x - c.x) * cs - (o.y - c.y) * sn, y: c.y + (o.x - c.x) * sn + (o.y - c.y) * cs })); ftApply(); requestOverlay(); }
function ftOptions(o) {
  const nm = document.createElement('span'); nm.className = 'tname'; nm.textContent = ft.kind === 'selection' ? 'Transform Selection' : 'Free Transform'; o.appendChild(nm);
  const num = (key, label, step = 1, unit = '') => {
    const l = document.createElement('label'), i = document.createElement('input'); i.type = 'number'; i.step = step; i.className = 'ftnum'; i.dataset.k = key;
    i.onchange = () => { const v = ftParams(); v[key] = +i.value; if (Number.isFinite(v[key]) && v.w && v.h) ftSetParams(v); };
    l.append(label, i, unit); return l;
  };
  o.append(num('x', 'X'), num('y', 'Y'), num('w', 'W', 0.1, '%'), num('h', 'H', 0.1, '%'), num('a', '∠', 0.1, '°'));
  if (ft.kind !== 'text') {
    const l = document.createElement('label'), s = document.createElement('select');
    [['free', 'Free'], ['rotate', 'Rotate'], ['skew', 'Skew'], ['distort', 'Distort'], ['perspective', 'Perspective']].forEach(([v, t]) => s.add(new Option(t, v)));
    s.value = ft.mode; s.onchange = () => ft.mode = s.value; l.append('Mode', s); o.appendChild(l);
  }
  const b = (t, fn, title) => { const x = document.createElement('button'); x.className = 'b'; x.textContent = t; x.title = title || ''; x.onclick = fn; return x; };
  if (ft.kind !== 'text') o.append(b('⇋', () => ftFlip(true), 'Flip horizontal'), b('⇵', () => ftFlip(false), 'Flip vertical'));
  o.append(b('⟳ 90°', () => ftRotate(90), 'Rotate 90° clockwise'), b('✕ Cancel', () => ftCancel(), 'Esc'), b('✓ Apply', () => ftCommit(), 'Enter'));
  updateFtOptions();
}
function updateFtOptions() {
  if (!ft) return; const v = ftParams();
  document.querySelectorAll('#options .ftnum').forEach(i => { if (document.activeElement !== i) i.value = (Math.round(v[i.dataset.k] * 10) / 10); });
}
