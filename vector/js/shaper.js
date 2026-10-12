'use strict';
/* Lumen Vector — Shaper tool: rough gestures become clean live shapes (rectangle/square, ellipse/circle, triangle,
   regular polygon, line); a scribble over shapes punches out overlaps, deletes a region, or merges the regions it
   crosses (applied directly with full undo, like the Shape Builder — no separate Shaper Group object). */
(function () {
  const SH = LV.shaper = {};
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const resample = (pts, step) => { const out = [pts[0]]; let acc = 0; for (let i = 1; i < pts.length; i++) { let a = pts[i - 1], b = pts[i], d = dist(a, b); while (acc + d >= step && d > 0) { const t = (step - acc) / d, p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; out.push(p); a = p; d = dist(a, b); acc = 0; } acc += d; } if (dist(out[out.length - 1], pts[pts.length - 1]) > step * 0.3) out.push(pts[pts.length - 1]); return out; };
  const rdp = (pts, eps) => { if (pts.length < 3) return pts.slice(); let idx = 0, md = 0; const a = pts[0], b = pts[pts.length - 1], L = dist(a, b) || 1e-9; for (let i = 1; i < pts.length - 1; i++) { const p = pts[i], d = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L; if (d > md) { md = d; idx = i; } } if (md <= eps) return [a, b]; const l = rdp(pts.slice(0, idx + 1), eps), r = rdp(pts.slice(idx), eps); return l.slice(0, -1).concat(r); };
  // corners of a closed stroke: RDP on the loop split at the point farthest from the start
  function closedCorners(pts, eps) {
    let far = 0, fd = 0; pts.forEach((p, i) => { const d = dist(p, pts[0]); if (d > fd) { fd = d; far = i; } });
    const a = rdp(pts.slice(0, far + 1), eps), b = rdp(pts.slice(far).concat([pts[0]]), eps);
    let poly = a.slice(0, -1).concat(b.slice(0, -1));
    // merge near-duplicate corners and drop nearly straight ones
    for (let pass = 0; pass < 3; pass++) poly = poly.filter((p, i) => { const q = poly[(i - 1 + poly.length) % poly.length], r = poly[(i + 1) % poly.length]; const v1 = { x: p.x - q.x, y: p.y - q.y }, v2 = { x: r.x - p.x, y: r.y - p.y }, l = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y); if (dist(p, q) < eps * 0.8) return false; return !l || Math.acos(Math.max(-1, Math.min(1, (v1.x * v2.x + v1.y * v2.y) / l))) > 0.35; });
    return poly;
  }
  SH.recognize = raw => {
    if (raw.length < 4) return null;
    let len = 0; for (let i = 1; i < raw.length; i++) len += dist(raw[i - 1], raw[i]);
    const xs = raw.map(p => p.x), ys = raw.map(p => p.y), bb = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, diag = Math.hypot(bb.w, bb.h);
    if (diag < 4) return null;
    const pts = resample(raw, Math.max(1, diag / 60));
    // scribble: many sharp reversals, much longer than the area it covers
    let rev = 0; const coarse = resample(raw, Math.max(2, diag / 25));
    for (let i = 1; i < coarse.length - 1; i++) { const a = coarse[i - 1], b = coarse[i], c = coarse[i + 1], v1 = { x: b.x - a.x, y: b.y - a.y }, v2 = { x: c.x - b.x, y: c.y - b.y }, l = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y); if (l && (v1.x * v2.x + v1.y * v2.y) / l < -0.5) rev++; }
    if (rev >= 3 && len > 2.2 * diag) return { type: 'scribble' };
    const first = raw[0], last = raw[raw.length - 1], gap = dist(first, last), closed = gap < 0.22 * Math.max(bb.w, bb.h);
    if (!closed) {
      let md = 0; pts.forEach(p => { const d = Math.abs((last.x - first.x) * (first.y - p.y) - (first.x - p.x) * (last.y - first.y)) / (gap || 1e-9); md = Math.max(md, d); });
      if (md < 0.07 * len) { let b = { x: last.x, y: last.y }; const ang = Math.atan2(b.y - first.y, b.x - first.x) * 180 / Math.PI, sn = Math.round(ang / 45) * 45; if (Math.abs(ang - sn) < 7) { const r = sn * Math.PI / 180; b = { x: first.x + Math.cos(r) * gap, y: first.y + Math.sin(r) * gap }; } return { type: 'line', a: first, b }; }
      return null;
    }
    const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2, rx = Math.max(bb.w / 2, 1e-6), ry = Math.max(bb.h / 2, 1e-6);
    const eErr = pts.reduce((s, p) => s + Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1), 0) / pts.length;
    const corners = closedCorners(pts, 0.07 * diag), k = corners.length;
    const round = (aspectTol) => Math.abs(bb.w - bb.h) / Math.max(bb.w, bb.h) < aspectTol;
    // polygon vs ellipse: whichever fits the stroke better (mean distance in px)
    const segDist = (p, a, b) => { const vx = b.x - a.x, vy = b.y - a.y, l2 = vx * vx + vy * vy || 1e-9, t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2)); return Math.hypot(p.x - a.x - vx * t, p.y - a.y - vy * t); };
    const polyErr = k >= 3 ? pts.reduce((s, p) => s + Math.min(...corners.map((c, i) => segDist(p, c, corners[(i + 1) % k]))), 0) / pts.length : Infinity;
    const ellErr = eErr * (rx + ry) / 2;
    if (k < 3 || k > 8 || ellErr <= polyErr) { if (eErr > 0.2) return null; const s = round(0.15) ? (bb.w + bb.h) / 2 : 0; return { type: 'ellipse', cx, cy, w: s || bb.w, h: s || bb.h }; }
    if (k === 3) return { type: 'triangle', corners };
    if (k === 4) return { type: 'rect', corners };
    if (k >= 5 && k <= 8) return { type: 'polygon', corners };
    return null;
  };
  // build the clean shape (live shapes where possible)
  SH.build = g => {
    const P_ = (x, y) => new P.Point(x, y);
    if (g.type === 'line') { const l = new P.Path.Line({ from: P_(g.a.x, g.a.y), to: P_(g.b.x, g.b.y), insert: false }); l.strokeColor = LV.specToColor(LV.paint.stroke || '#1d2733'); l.strokeWidth = LV.paint.strokeWidth || 1; l.name = 'Line'; return l; }
    let it;
    if (g.type === 'ellipse') { it = LV.live.ellipse(new P.Rectangle(g.cx - g.w / 2, g.cy - g.h / 2, g.w, g.h)); it.name = Math.abs(g.w - g.h) < 1e-6 ? 'Circle' : 'Ellipse'; }
    else if (g.type === 'rect') {
      const c = g.corners, edges = c.map((p, i) => ({ a: p, b: c[(i + 1) % 4] })), lon = edges.reduce((m, e) => dist(e.a, e.b) > dist(m.a, m.b) ? e : m);
      let ang = Math.atan2(lon.b.y - lon.a.y, lon.b.x - lon.a.x) * 180 / Math.PI; ang = ((ang % 90) + 90) % 90; if (ang > 45) ang -= 90; if (Math.abs(ang) < 9) ang = 0;
      const r = ang * Math.PI / 180, cosA = Math.cos(-r), sinA = Math.sin(-r), cen = c.reduce((s, p) => ({ x: s.x + p.x / 4, y: s.y + p.y / 4 }), { x: 0, y: 0 });
      const loc = c.map(p => ({ x: (p.x - cen.x) * cosA - (p.y - cen.y) * sinA, y: (p.x - cen.x) * sinA + (p.y - cen.y) * cosA }));
      let w = Math.max(...loc.map(p => p.x)) - Math.min(...loc.map(p => p.x)), h = Math.max(...loc.map(p => p.y)) - Math.min(...loc.map(p => p.y));
      if (Math.abs(w - h) / Math.max(w, h) < 0.12) w = h = (w + h) / 2;
      const lx = (Math.max(...loc.map(p => p.x)) + Math.min(...loc.map(p => p.x))) / 2, ly = (Math.max(...loc.map(p => p.y)) + Math.min(...loc.map(p => p.y))) / 2;
      const ctr = P_(cen.x + lx * Math.cos(r) - ly * Math.sin(r), cen.y + lx * Math.sin(r) + ly * Math.cos(r));
      it = LV.live.rect(new P.Rectangle(ctr.x - w / 2, ctr.y - h / 2, w, h)); if (ang) it.rotate(ang, ctr); it.name = w === h ? 'Square' : 'Rectangle';
    } else {
      const c = g.corners, n = c.length, cen = c.reduce((s, p) => ({ x: s.x + p.x / n, y: s.y + p.y / n }), { x: 0, y: 0 }), rad = c.reduce((s, p) => s + dist(p, cen) / n, 0);
      const sides = c.map((p, i) => dist(p, c[(i + 1) % n])), regular = Math.max(...sides) / Math.min(...sides) < 1.35;
      if (n === 3 && !regular) { it = new P.Path({ segments: c.map(p => P_(p.x, p.y)), closed: true, insert: false }); it.name = 'Triangle'; }
      else {
        const top = c.reduce((m, p) => p.y < m.y ? p : m), a0 = -90 + (n % 2 === 0 ? 180 / n : 0), aTop = Math.atan2(top.y - cen.y, top.x - cen.x) * 180 / Math.PI;
        let rot = aTop - a0; rot = ((rot % (360 / n)) + 360 / n) % (360 / n); if (rot > 180 / n) rot -= 360 / n; if (Math.abs(rot) < 6) rot = 0;
        it = LV.live.polygon(P_(cen.x, cen.y), n, rad, rot); it.name = n === 3 ? 'Triangle' : 'Polygon';
      }
    }
    LV.applyDefaultPaint(it); return it;
  };
  // scribble: punch out overlaps / delete a region / merge the regions crossed
  SH.scribble = raw => {
    const pts = resample(raw, Math.max(0.5, 2 / P.view.zoom)).map(p => new P.Point(p.x, p.y)), r = pts.reduce((acc, p) => acc.include(p), new P.Rectangle(pts[0], pts[0]));
    const pool = (LV.sel.length ? LV.sel : LV.allObjects()).filter(o => o.visible && !o.locked && LV.ancestorsOk(o) && LV.isPathItem(o) && (o instanceof P.CompoundPath || o.closed) && o.bounds.intersects(r));
    const items = LV.sortZ(pool); if (!items.length) return null;
    const pieces = LV.dividePieces(items), touched = pieces.filter(pc => pts.some(p => pc.path.contains(p)));
    if (!touched.length) return null;
    // coverage measured at a scribble point inside the region (interiorPoint can sit on an L-shape's edge)
    const inside = pc => pts.find(p => pc.path.contains(p) && pc.path.getNearestPoint(p).getDistance(p) > 0.5) || pts.find(p => pc.path.contains(p));
    const cover = pc => { const ip = inside(pc); return items.filter(it => it.contains(ip)).length; };
    const srcs = new Set(touched.map(pc => pc.src)), overlapOnly = touched.every(pc => cover(pc) >= 2), singles = touched.filter(pc => cover(pc) === 1);
    const erase = overlapOnly || (srcs.size === 1 && singles.length === touched.length);
    const picks = touched.map(inside).sort((a, b) => pts.indexOf(a) - pts.indexOf(b)); // merged shape takes the colour where the scribble started
    const res = LV.shapeBuild(items, picks, erase);
    return res && { action: erase ? (overlapOnly ? 'punch' : 'delete') : 'merge', res };
  };

  /* ---------- the tool ---------- */
  LV.tools.shaper = {
    name: 'Shaper', cursor: 'crosshair',
    down(ev) { this.pts = [{ x: ev.pt.x, y: ev.pt.y }]; },
    drag(ev) { const l = this.pts && this.pts[this.pts.length - 1]; if (l && Math.hypot(ev.pt.x - l.x, ev.pt.y - l.y) * P.view.zoom > 1.5) this.pts.push({ x: ev.pt.x, y: ev.pt.y }); LV.redraw(); },
    up() {
      const pts = this.pts; this.pts = null; LV.redraw(); if (!pts || pts.length < 4) return;
      const g = SH.recognize(pts);
      if (!g) return LV.toast('Shape not recognised — draw a rectangle, ellipse, triangle, polygon or line, or scribble over shapes');
      if (g.type === 'scribble') { const r = SH.scribble(pts); if (!r) return LV.toast('Scribble over shapes to punch out or merge them'); LV.setSel(r.res.made); LV.commit(r.action === 'merge' ? 'Shaper Merge' : r.action === 'punch' ? 'Shaper Punch' : 'Shaper Delete'); LV.status(r.action === 'merge' ? 'Merged' : 'Removed'); return; }
      const it = SH.build(g); LV.insert(it); LV.setSel([it]); LV.commit('Shaper ' + it.name); LV.status(it.name);
    },
    overlay(ctx) { if (!this.pts || this.pts.length < 2) return; ctx.strokeStyle = '#555'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath(); this.pts.forEach((p, i) => { const v = LV.v(new P.Point(p.x, p.y)); i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y); }); ctx.stroke(); }
  };
})();
