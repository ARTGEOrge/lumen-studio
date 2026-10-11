'use strict';
/* Lumen Vector — live shapes: rectangles (per-corner radius), polygons (sides) and stars (points / inner radius)
   stay editable after creation until they are expanded or their anchors are edited by hand.
   Model: item.data.live = { type, ...params, m:[a,b,c,d,tx,ty] } — params describe the shape centred at the origin,
   m maps that shape space into the item's (parent) coordinates. Objects stored in data are never mutated in place
   (paper's clone() copies data shallowly), always replaced. */
(function () {
  const K = 0.5522847498;
  const Live = LV.live = {};
  const TYPES = { rect: 'Rectangle', polygon: 'Polygon', star: 'Star' };
  const mat = d => new P.Matrix(d.m[0], d.m[1], d.m[2], d.m[3], d.m[4], d.m[5]);
  const vals = m => [m.a, m.b, m.c, m.d, m.tx, m.ty];
  Live.label = d => TYPES[d.type] || 'Shape';

  /* ---------- geometry (shape space) ---------- */
  Live.geom = d => {
    const out = [];
    if (d.type === 'rect') {
      const hw = d.w / 2, hh = d.h / 2, lim = Math.min(d.w, d.h) / 2;
      const C = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], DIN = [[0, -1], [1, 0], [0, 1], [-1, 0]], DOUT = [[1, 0], [0, 1], [-1, 0], [0, -1]];
      for (let i = 0; i < 4; i++) {
        const r = Math.max(0, Math.min(+d.r[i] || 0, lim)), [cx, cy] = C[i];
        if (r < 1e-6) { out.push([cx, cy, 0, 0, 0, 0]); continue; }
        const [ix, iy] = DIN[i], [ox, oy] = DOUT[i];
        out.push([cx - ix * r, cy - iy * r, 0, 0, ix * r * K, iy * r * K]);
        out.push([cx + ox * r, cy + oy * r, -ox * r * K, -oy * r * K, 0, 0]);
      }
      // merge coincident neighbours (two corners whose radii meet in the middle of an edge)
      for (let i = out.length - 1; i >= 0 && out.length > 2; i--) {
        const a = out[i], b = out[(i + 1) % out.length];
        if (a !== b && Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-7) { b[2] = a[2]; b[3] = a[3]; out.splice(i, 1); }
      }
    } else if (d.type === 'polygon') {
      const n = Math.max(3, d.sides | 0), a0 = -90 + (n % 2 === 0 ? 180 / n : 0);
      for (let i = 0; i < n; i++) { const a = (a0 + i * 360 / n) * Math.PI / 180; out.push([Math.cos(a) * d.radius, Math.sin(a) * d.radius, 0, 0, 0, 0]); }
    } else if (d.type === 'star') {
      const n = Math.max(3, d.points | 0);
      for (let i = 0; i < n * 2; i++) { const a = (-90 + i * 180 / n) * Math.PI / 180, r = i % 2 ? d.r2 : d.r1; out.push([Math.cos(a) * r, Math.sin(a) * r, 0, 0, 0, 0]); }
    }
    return out;
  };
  const segsFor = d => {
    const m = mat(d);
    return Live.geom(d).map(g => {
      const p = m.transform(new P.Point(g[0], g[1])), hi = m.transform(new P.Point(g[0] + g[2], g[1] + g[3])).subtract(p), ho = m.transform(new P.Point(g[0] + g[4], g[1] + g[5])).subtract(p);
      return new P.Segment(p, hi, ho);
    });
  };
  // does the path still have exactly the geometry described by d?
  const matches = (path, d) => {
    if (!(path instanceof P.Path) || !path.closed) return false;
    const want = segsFor(d), have = path.segments; if (want.length !== have.length) return false;
    const tol = 1e-3 + 1e-5 * Math.max(path.bounds.width, path.bounds.height);
    for (let i = 0; i < want.length; i++) {
      const a = want[i], b = have[i];
      if (a.point.getDistance(b.point) > tol || a.handleIn.getDistance(b.handleIn) > tol || a.handleOut.getDistance(b.handleOut) > tol) return false;
    }
    return true;
  };
  const valid = d => d && TYPES[d.type] && Array.isArray(d.m) && d.m.length === 6 && d.m.every(isFinite);

  /* ---------- public API ---------- */
  Live.set = (path, d) => { path.data.live = d; path.segments = segsFor(d); path.closed = true; return path; };
  // live params if the shape is still intact; otherwise the item silently becomes a plain path
  Live.get = it => {
    const d = it && it.data && it.data.live; if (!d) return null;
    if (!valid(d) || !matches(it, d)) { delete it.data.live; return null; }
    return d;
  };
  Live.update = (it, part) => { const d = Live.get(it); if (!d) return false; const nd = { ...d, ...part }; if (part.r) nd.r = part.r.slice(); Live.set(it, nd); LV.afterTransform?.(it); return true; };
  Live.expand = items => { let n = 0; items.forEach(it => LV.leaves(it).forEach(l => { if (l.data && l.data.live) { delete l.data.live; n++; } })); return n; };
  Live.rect = (rect, radius = 0) => Live.set(new P.Path({ insert: false }), { type: 'rect', w: rect.width, h: rect.height, r: [radius, radius, radius, radius], m: [1, 0, 0, 1, rect.center.x, rect.center.y] });
  Live.polygon = (center, sides, radius, angle = 0) => Live.set(new P.Path({ insert: false }), { type: 'polygon', sides: Math.max(3, sides | 0), radius, m: vals(new P.Matrix().translate(center).rotate(angle)) });
  Live.star = (center, points, r1, r2, angle = 0) => Live.set(new P.Path({ insert: false }), { type: 'star', points: Math.max(3, points | 0), r1, r2, m: vals(new P.Matrix().translate(center).rotate(angle)) });
  // sanitize live params read from a file (untrusted)
  Live.sanitize = d => {
    if (!d || typeof d !== 'object' || !TYPES[d.type] || !Array.isArray(d.m) || d.m.length !== 6) return undefined;
    const n = (v, lo, hi, def) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; };
    const o = { type: d.type, m: d.m.map(v => n(v, -1e7, 1e7, 0)) };
    if (d.type === 'rect') { o.w = n(d.w, 0, 1e7, 1); o.h = n(d.h, 0, 1e7, 1); o.r = [0, 1, 2, 3].map(i => n(Array.isArray(d.r) ? d.r[i] : 0, 0, 1e7, 0)); }
    if (d.type === 'polygon') { o.sides = Math.round(n(d.sides, 3, 1000, 6)); o.radius = n(d.radius, 0, 1e7, 10); }
    if (d.type === 'star') { o.points = Math.round(n(d.points, 3, 1000, 5)); o.r1 = n(d.r1, 0, 1e7, 10); o.r2 = n(d.r2, 0, 1e7, 5); }
    return o;
  };

  /* ---------- keep params in sync with transforms ---------- */
  const origTransform = P.Item.prototype.transform;
  P.Item.prototype.transform = function (matrix, a, b) {
    const d = this._data && this._data.live;
    const res = origTransform.call(this, matrix, a, b);
    if (d && matrix && !matrix.isIdentity() && this instanceof P.Path && this._applyMatrix) onTransform(this, d, matrix);
    return res;
  };
  function onTransform(path, d, matrix) {
    if (!valid(d)) { delete path._data.live; return; }
    const m = matrix.clone().append(mat(d)), nd = { ...d, m: vals(m) };
    if (!matches(path, nd)) { delete path._data.live; return; } // anchors were edited by hand: no longer live
    // fold axis scaling into the parameters (keeps corner radii round, like Illustrator)
    const c1 = new P.Point(m.a, m.b), c2 = new P.Point(m.c, m.d), sx = c1.length, sy = c2.length;
    const ortho = sx > 1e-9 && sy > 1e-9 && Math.abs(c1.dot(c2)) < 1e-6 * sx * sy;
    let fold = false;
    if (ortho && d.type === 'rect') { nd.w = d.w * sx; nd.h = d.h * sy; fold = true; }
    else if (ortho && Math.abs(sx - sy) < 1e-6 * sx) { if (d.type === 'polygon') nd.radius = d.radius * sx; else { nd.r1 = d.r1 * sx; nd.r2 = d.r2 * sx; } fold = true; }
    if (fold) { nd.m = [m.a / sx, m.b / sx, m.c / sy, m.d / sy, m.tx, m.ty]; }
    path._data.live = nd;
    if (fold) path.setSegments(segsFor(nd));
  }

  /* ---------- on-canvas widgets ---------- */
  const DIN = [[0, -1], [1, 0], [0, 1], [-1, 0]], DOUT = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  Live.target = () => { if (LV.sel.length !== 1 || LV.textEditing) return null; const it = LV.sel[0], d = Live.get(it); return d ? { it, d } : null; };
  Live.widgets = () => {
    const t = Live.target(); if (!t) return [];
    const { it, d } = t, m = mat(d), z = P.view.zoom, b = it.bounds;
    if (b.width * z < 18 && b.height * z < 18) return [];
    const sc = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1, out = [];
    if (d.type === 'rect') {
      const hw = d.w / 2, hh = d.h / 2, C = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]], lim = Math.min(d.w, d.h) / 2;
      const inset = Math.min(14 / z / sc, lim * 0.9);
      for (let i = 0; i < 4; i++) {
        const r = Math.min(d.r[i] || 0, lim), u = new P.Point(DOUT[i][0] - DIN[i][0], DOUT[i][1] - DIN[i][1]), k = Math.max(r, inset);
        out.push({ kind: 'corner', i, pt: m.transform(new P.Point(C[i][0] + u.x * k, C[i][1] + u.y * k)) });
      }
    } else {
      const vr = LV.v(b.rightCenter);
      out.push({ kind: d.type === 'polygon' ? 'sides' : 'points', vp: vr.add([16, 0]) });
      if (d.type === 'star') { const n = d.points, a = (-90 + 180 / n) * Math.PI / 180; out.push({ kind: 'inner', pt: m.transform(new P.Point(Math.cos(a) * d.r2, Math.sin(a) * d.r2)) }); }
    }
    out.forEach(w => { if (!w.vp) w.vp = LV.v(w.pt); });
    return out;
  };
  Live.widgetHit = vp => { if (LV.toolId !== 'select') return null; return Live.widgets().find(w => w.vp.getDistance(vp) <= 6) || null; };
  Live.dragStart = (w, ev) => { const t = Live.target(); return t && { w, it: t.it, d0: t.d, vp0: ev.vp, alt: ev.alt }; };
  Live.dragMove = (s, ev) => {
    const { w, it, d0 } = s, m = mat(d0), inv = m.inverted(); if (!inv) return;
    const lp = inv.transform(ev.pt);
    if (w.kind === 'corner') {
      const hw = d0.w / 2, hh = d0.h / 2, C = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]][w.i], u = new P.Point(DOUT[w.i][0] - DIN[w.i][0], DOUT[w.i][1] - DIN[w.i][1]);
      let r = lp.subtract(new P.Point(C[0], C[1])).dot(u) / 2; r = Math.max(0, Math.min(Math.min(d0.w, d0.h) / 2, r));
      if (!ev.shift) r = Math.round(r);
      const rr = s.alt ? d0.r.map((v, j) => j === w.i ? r : v) : [r, r, r, r];
      Live.set(it, { ...d0, r: rr }); LV.status(`Corner radius ${LV.fmt(r)}`);
    } else if (w.kind === 'sides' || w.kind === 'points') {
      const key = w.kind, base = d0[key], n = Math.max(3, Math.min(60, Math.round(base + (s.vp0.y - ev.vp.y) / 8)));
      Live.set(it, { ...d0, [key]: n }); LV.status(`${key === 'sides' ? 'Sides' : 'Points'} ${n}`);
    } else if (w.kind === 'inner') {
      const r2 = Math.max(0.01, Math.min(d0.r1 * 2, lp.length));
      Live.set(it, { ...d0, r2: ev.shift ? r2 : Math.round(r2 * 10) / 10 }); LV.status(`Inner radius ${LV.fmt(r2)} (${Math.round(r2 / d0.r1 * 100)}%)`);
    }
    LV.redraw();
  };
  Live.drawWidgets = ctx => {
    if (!LV.prefs.bbox || LV.toolId !== 'select') return;
    Live.widgets().forEach(w => {
      const p = w.vp; ctx.lineWidth = 1; ctx.strokeStyle = LV.SEL_COLOR; ctx.fillStyle = '#fff';
      if (w.kind === 'corner') { ctx.beginPath(); ctx.arc(p.x, p.y, 3.6, 0, 7); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(p.x, p.y, 1.3, 0, 7); ctx.fillStyle = LV.SEL_COLOR; ctx.fill(); }
      else if (w.kind === 'inner') { ctx.beginPath(); ctx.arc(p.x, p.y, 3.6, 0, 7); ctx.fillStyle = LV.SEL_COLOR; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x + 5, p.y); ctx.lineTo(p.x, p.y + 5); ctx.lineTo(p.x - 5, p.y); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = LV.SEL_COLOR; ctx.font = '10px "Segoe UI",sans-serif'; const t = Live.target(); if (t) ctx.fillText(String(t.d.sides || t.d.points), p.x + 8, p.y + 3.5); }
    });
  };
})();
