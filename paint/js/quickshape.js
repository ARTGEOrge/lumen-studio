'use strict';
/* QuickShape: draw a line / ellipse / polygon freehand and hold the pen still at the end of the stroke —
   the stroke is replaced by a clean shape painted with the same brush (symmetry still applies). While
   still holding, moving the pen adjusts it: a line's end follows the pen, other shapes scale and rotate
   about their center. Shape fitting below is pure math (no DOM) so it is unit-tested in Node. */

const QS = { on: true, delay: 550 };

/* ---------- fitting ---------- */
function qsResample(pts, step) { // evenly spaced points along the polyline
  const out = [{ x: pts[0].x, y: pts[0].y }]; let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = Math.hypot(b.x - a.x, b.y - a.y); if (d < 1e-9) continue;
    let t = step - carry;
    while (t <= d) { out.push({ x: a.x + (b.x - a.x) * t / d, y: a.y + (b.y - a.y) * t / d }); t += step; }
    carry = d - (t - step);
  }
  const l = pts[pts.length - 1], q = out[out.length - 1]; if (Math.hypot(l.x - q.x, l.y - q.y) > step * 0.25) out.push({ x: l.x, y: l.y });
  return out;
}
function qsPathLen(p) { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y); return s; }
function qsSegDist(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}
function qsRDP(p, eps) { // Ramer–Douglas–Peucker; returns indices of kept vertices
  const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1;
  const st = [[0, p.length - 1]];
  while (st.length) {
    const [i, j] = st.pop(); let md = 0, mi = -1;
    for (let k = i + 1; k < j; k++) { const d = qsSegDist(p[k], p[i], p[j]); if (d > md) { md = d; mi = k; } }
    if (md > eps && mi > 0) { keep[mi] = 1; st.push([i, mi], [mi, j]); }
  }
  const out = []; for (let i = 0; i < p.length; i++) if (keep[i]) out.push(i); return out;
}
function qsPolyErr(p, verts, closed) { // mean distance of samples to the polyline
  let s = 0; const n = verts.length, segs = closed ? n : n - 1;
  for (const q of p) { let m = 1e18; for (let i = 0; i < segs; i++) m = Math.min(m, qsSegDist(q, verts[i], verts[(i + 1) % n])); s += m; }
  return s / p.length;
}
function qsEllipseFit(p) { // principal-axis fit; p should be evenly resampled along a closed loop
  let mx = 0, my = 0; for (const q of p) { mx += q.x; my += q.y; } mx /= p.length; my /= p.length;
  let sxx = 0, syy = 0, sxy = 0; for (const q of p) { const dx = q.x - mx, dy = q.y - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  sxx /= p.length; syy /= p.length; sxy /= p.length;
  const rot = 0.5 * Math.atan2(2 * sxy, sxx - syy), c = Math.cos(rot), s = Math.sin(rot);
  // radii from the extent along each axis (robust for hand-drawn loops) blended with the variance estimate
  let u0 = 1e18, u1 = -1e18, v0 = 1e18, v1 = -1e18, su = 0, sv = 0;
  for (const q of p) { const dx = q.x - mx, dy = q.y - my, u = dx * c + dy * s, v = -dx * s + dy * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); su += u * u; sv += v * v; }
  const rx = 0.5 * ((u1 - u0) / 2) + 0.5 * Math.sqrt(2 * su / p.length), ry = 0.5 * ((v1 - v0) / 2) + 0.5 * Math.sqrt(2 * sv / p.length);
  const cx = mx + c * (u0 + u1) / 2 - s * (v0 + v1) / 2, cy = my + s * (u0 + u1) / 2 + c * (v0 + v1) / 2;
  // mean radial error
  let err = 0;
  for (const q of p) {
    const dx = q.x - cx, dy = q.y - cy, u = dx * c + dy * s, v = -dx * s + dy * c, r = Math.hypot(u, v);
    const f = Math.hypot(u / Math.max(rx, 1e-6), v / Math.max(ry, 1e-6)); err += f > 0 ? Math.abs(r - r / f) : Math.min(rx, ry);
  }
  return { kind: 'ellipse', cx, cy, rx, ry, rot, err: err / p.length };
}
/* pts: [{x,y}] in doc px; px = doc px per screen px (so tolerances follow what the user sees).
   Returns {kind:'line',a,b} | {kind:'ellipse',cx,cy,rx,ry,rot} | {kind:'poly',pts,closed} | null */
function qsFit(pts, px = 1) {
  if (!pts || pts.length < 3) return null;
  const len = qsPathLen(pts); if (len < 24 * px) return null;
  const p = qsResample(pts, Math.max(len / 200, 0.5 * px));
  const a = p[0], b = p[p.length - 1], chord = Math.hypot(b.x - a.x, b.y - a.y);
  let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18; for (const q of p) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  const diag = Math.hypot(x1 - x0, y1 - y0);
  // straight line: everything close to the chord
  let dev = 0; for (const q of p) dev = Math.max(dev, qsSegDist(q, a, b));
  if (chord > 0.75 * len && dev <= Math.max(4 * px, 0.06 * chord)) return { kind: 'line', a: { x: a.x, y: a.y }, b: { x: b.x, y: b.y } };
  const closed = chord < Math.max(0.22 * diag, 10 * px);
  const eps = Math.max(2.5 * px, 0.05 * diag);
  if (closed) {
    const loop = p.slice(); loop.push({ x: a.x, y: a.y });
    const E = qsEllipseFit(p), eRel = E.err / Math.max(1, (E.rx + E.ry) / 2);
    let idx = qsRDP(loop, eps); idx.pop(); // drop the duplicated start
    let verts = idx.map(i => loop[i]);
    verts = qsMergeCorners(verts, eps * 1.6, true);
    const pErr = verts.length >= 3 ? qsPolyErr(p, verts, true) / Math.max(1, diag) : 1e9;
    const polyOK = verts.length >= 3 && verts.length <= 6 && pErr < 0.035;
    if (polyOK && (eRel > 0.07 || pErr < eRel * 0.55)) return { kind: 'poly', pts: verts.map(v => ({ x: v.x, y: v.y })), closed: true };
    if (eRel < 0.14 && E.rx > 2 * px && E.ry > 2 * px) {
      if (Math.min(E.rx, E.ry) / Math.max(E.rx, E.ry) > 0.9) { const r = (E.rx + E.ry) / 2; E.rx = E.ry = r; }
      return { kind: 'ellipse', cx: E.cx, cy: E.cy, rx: E.rx, ry: E.ry, rot: E.rot };
    }
    return null;
  }
  // open polyline (2–6 segments)
  let verts = qsRDP(p, eps).map(i => p[i]);
  verts = qsMergeCorners(verts, eps * 1.6, false);
  if (verts.length >= 3 && verts.length <= 7 && qsPolyErr(p, verts, false) / Math.max(1, diag) < 0.03) return { kind: 'poly', pts: verts.map(v => ({ x: v.x, y: v.y })), closed: false };
  return null;
}
// remove vertices that are nearly collinear with their neighbours (keeps real corners only)
function qsMergeCorners(v, eps, closed) {
  let out = v.slice(), changed = true;
  while (changed && out.length > (closed ? 3 : 2)) {
    changed = false;
    const n = out.length;
    for (let i = closed ? 0 : 1; i < (closed ? n : n - 1); i++) {
      const A = out[(i - 1 + n) % n], B = out[i], C = out[(i + 1) % n];
      const ang = Math.abs(Math.atan2((B.x - A.x) * (C.y - B.y) - (B.y - A.y) * (C.x - B.x), (B.x - A.x) * (C.x - B.x) + (B.y - A.y) * (C.y - B.y)));
      if (qsSegDist(B, A, C) < eps * 0.5 || ang < 0.33) { out.splice(i, 1); changed = true; break; }
    }
  }
  return out;
}
// points along a shape (doc px), spaced `step` apart
function qsPoints(S, step = 2) {
  const out = [], seg = (a, b) => { const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step)); for (let i = out.length ? 1 : 0; i <= n; i++) out.push({ x: a.x + (b.x - a.x) * i / n, y: a.y + (b.y - a.y) * i / n }); };
  if (S.kind === 'line') seg(S.a, S.b);
  else if (S.kind === 'poly') { const v = S.pts; for (let i = 0; i < v.length - 1; i++) seg(v[i], v[i + 1]); if (S.closed) seg(v[v.length - 1], v[0]); }
  else if (S.kind === 'ellipse') {
    const n = Math.max(24, Math.ceil(Math.PI * (S.rx + S.ry) / step)), c = Math.cos(S.rot), s = Math.sin(S.rot);
    for (let i = 0; i <= n + 2; i++) { const t = i / n * Math.PI * 2, u = Math.cos(t) * S.rx, v = Math.sin(t) * S.ry; out.push({ x: S.cx + u * c - v * s, y: S.cy + u * s + v * c }); }
  }
  return out;
}
function qsCenter(S) {
  if (S.kind === 'ellipse') return { x: S.cx, y: S.cy };
  const v = S.kind === 'line' ? [S.a, S.b] : S.pts; let x = 0, y = 0; for (const q of v) { x += q.x; y += q.y; } return { x: x / v.length, y: y / v.length };
}
// adjusted copy of a shape: line end follows the pen; others scale/rotate about their center
function qsAdjust(S, anchor, pen, snapAngle) {
  if (S.kind === 'line') {
    let b = { x: pen.x, y: pen.y };
    if (snapAngle) { const dx = b.x - S.a.x, dy = b.y - S.a.y, an = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * Math.PI / 12, l = Math.hypot(dx, dy); b = { x: S.a.x + Math.cos(an) * l, y: S.a.y + Math.sin(an) * l }; }
    return { ...S, b };
  }
  const c = qsCenter(S), v0 = [anchor.x - c.x, anchor.y - c.y], v1 = [pen.x - c.x, pen.y - c.y], l0 = Math.hypot(v0[0], v0[1]);
  if (l0 < 1e-3) return S;
  const k = Math.max(0.05, Math.hypot(v1[0], v1[1]) / l0), da = Math.atan2(v1[1], v1[0]) - Math.atan2(v0[1], v0[0]);
  const cs = Math.cos(da) * k, sn = Math.sin(da) * k, tf = q => ({ x: c.x + (q.x - c.x) * cs - (q.y - c.y) * sn, y: c.y + (q.x - c.x) * sn + (q.y - c.y) * cs });
  if (S.kind === 'ellipse') return { ...S, rx: S.rx * k, ry: S.ry * k, rot: S.rot + da };
  return { ...S, pts: S.pts.map(tf) };
}
const QS_NAMES = { line: 'Line', ellipse: 'Ellipse', poly: 'Polygon' };
function qsName(S) { return S.kind === 'ellipse' && Math.abs(S.rx - S.ry) < 1e-6 ? 'Circle' : S.kind === 'poly' && !S.closed ? 'Polyline' : S.kind === 'poly' && S.pts.length === 3 ? 'Triangle' : S.kind === 'poly' && S.pts.length === 4 ? 'Quadrilateral' : QS_NAMES[S.kind]; }

/* ---------- brush tool integration (browser only) ---------- */
// called by brushTool: T = tool state ({S, sOpts}), pt = mkPt point
function qsDown(T, pt) {
  T.qs = null; clearTimeout(T.qsTimer);
  if (!QS.on || !T.S || !['paint', 'erase', 'oil'].includes(T.S.mode)) return;
  T.qs = { pts: [{ x: pt.x, y: pt.y }], p: [], anchorS: [pt.sx ?? 0, pt.sy ?? 0], snapped: null };
  if (pt.p != null) T.qs.p.push(pt.p);
}
function qsMove(T, pt) { // → true when the stroke has been snapped (the caller must not feed the point)
  const q = T.qs; if (!q) return false;
  if (q.snapped) { q.pen = { x: pt.x, y: pt.y }; if (!q.raf) q.raf = requestAnimationFrame(() => { q.raf = 0; if (T.qs === q && q.snapped) qsRepaint(T); }); return true; }
  q.pts.push({ x: pt.x, y: pt.y }); if (pt.p != null) q.p.push(pt.p); q.last = pt;
  const sx = pt.sx ?? 0, sy = pt.sy ?? 0;
  if (Math.hypot(sx - q.anchorS[0], sy - q.anchorS[1]) > 4 || !T.qsTimer) {
    q.anchorS = [sx, sy]; clearTimeout(T.qsTimer);
    T.qsTimer = setTimeout(() => { T.qsTimer = 0; qsTrigger(T, q.last || pt); }, QS.delay);
  }
  return false;
}
function qsTrigger(T, pt) {
  const q = T.qs; if (!q || q.snapped || !T.S || T.S !== activeStroke) return false;
  const shape = qsFit(q.pts, 1 / view.zoom); if (!shape) return false;
  const ps = q.p.slice().sort((a, b) => a - b), pr = ps.length ? ps[ps.length >> 1] : null;
  q.snapped = shape; q.pr = pr; q.anchor = { x: pt.x, y: pt.y }; q.pen = q.anchor;
  qsRepaint(T);
  $('#st-msg').textContent = `QuickShape: ${qsName(shape)} — keep holding and move to adjust`;
  return true;
}
function qsCurrent(T) { const q = T.qs; return qsAdjust(q.snapped, q.anchor, q.pen, keys.shift); }
function qsRepaint(T) {
  const q = T.qs, old = T.S; if (!old) return;
  cancelStroke(old);
  const o = T.sOpts, S = new Stroke({ ...o, constrain: null, mouse: false, mats: symmetryMats() });
  let t = 0; for (const p of qsPoints(qsCurrent(T), Math.max(1, S.b.size * S.b.spacing * 0.5))) { t += 4; S.add({ x: p.x, y: p.y, p: q.pr, t }); }
  T.S = S; requestRender(); requestOverlay();
}
function qsUp(T) { // → label when the stroke ended as a QuickShape
  clearTimeout(T.qsTimer); T.qsTimer = 0;
  const q = T.qs; T.qs = null; if (!q || !q.snapped) return null;
  if (q.raf) { cancelAnimationFrame(q.raf); qsRepaint(T); }
  return 'QuickShape: ' + qsName(qsCurrent({ qs: q }));
}
function qsCancel(T) { clearTimeout(T.qsTimer); T.qsTimer = 0; if (T.qs?.raf) cancelAnimationFrame(T.qs.raf); T.qs = null; }
if (typeof module !== 'undefined') module.exports = { qsFit, qsPoints, qsAdjust, qsResample, qsName, qsEllipseFit };
