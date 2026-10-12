'use strict';
/* Lumen Vector — live shapes: rectangles (per-corner radius), polygons (sides) and stars (points / inner radius)
   stay editable after creation until they are expanded or their anchors are edited by hand.
   Model: item.data.live = { type, ...params, m:[a,b,c,d,tx,ty] } — params describe the shape centred at the origin,
   m maps that shape space into the item's (parent) coordinates. Objects stored in data are never mutated in place
   (paper's clone() copies data shallowly), always replaced. */
(function () {
  const K = 0.5522847498;
  const Live = LV.live = {};
  const TYPES = { rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star' };
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
    } else if (d.type === 'ellipse') {
      const rx = d.w / 2, ry = d.h / 2, s0 = +d.start || 0, sweep = pieSweep(d);
      if (sweep >= 360 - 1e-9) {
        const k = K; out.push([rx, 0, 0, -ry * k, 0, ry * k], [0, ry, rx * k, 0, -rx * k, 0], [-rx, 0, 0, ry * k, 0, -ry * k], [0, -ry, -rx * k, 0, rx * k, 0]);
      } else { // pie: centre + elliptical arc from start to end (clockwise in screen space)
        const n = Math.max(1, Math.ceil(sweep / 90 - 1e-9)), step = sweep / n * Math.PI / 180, h = 4 / 3 * Math.tan(step / 4);
        out.push([0, 0, 0, 0, 0, 0]);
        for (let i = 0; i <= n; i++) {
          const a = s0 * Math.PI / 180 + i * step, c = Math.cos(a), s = Math.sin(a), tx = -s * rx * h, ty = c * ry * h;
          out.push([c * rx, s * ry, i ? -tx : 0, i ? -ty : 0, i < n ? tx : 0, i < n ? ty : 0]);
        }
      }
    } else if (d.type === 'polygon' || d.type === 'star') {
      const V = [];
      if (d.type === 'polygon') { const n = Math.max(3, d.sides | 0), a0 = -90 + (n % 2 === 0 ? 180 / n : 0); for (let i = 0; i < n; i++) { const a = (a0 + i * 360 / n) * Math.PI / 180; V.push([Math.cos(a) * d.radius, Math.sin(a) * d.radius]); } }
      else { const n = Math.max(3, d.points | 0); for (let i = 0; i < n * 2; i++) { const a = (-90 + i * 180 / n) * Math.PI / 180, r = i % 2 ? d.r2 : d.r1; V.push([Math.cos(a) * r, Math.sin(a) * r]); } }
      const cr = Math.max(0, +d.cr || 0);
      if (cr < 1e-6) V.forEach(v => out.push([v[0], v[1], 0, 0, 0, 0]));
      else roundCorners(V, cr).forEach(s => out.push(s));
    }
    return out;
  };
  const pieSweep = d => { let s = ((+d.end || 0) - (+d.start || 0)) % 360; if (s <= 1e-9) s += 360; return d.end == null && d.start == null ? 360 : s; };
  // round every vertex of polygon V with radius cr (circular arcs, tangent lengths clamped to half the adjacent edges)
  function roundCorners(V, cr) {
    const n = V.length, out = [];
    for (let i = 0; i < n; i++) {
      const P0 = V[(i - 1 + n) % n], v = V[i], P1 = V[(i + 1) % n];
      let u1 = [P0[0] - v[0], P0[1] - v[1]], u2 = [P1[0] - v[0], P1[1] - v[1]]; const l1 = Math.hypot(...u1), l2 = Math.hypot(...u2);
      u1 = [u1[0] / l1, u1[1] / l1]; u2 = [u2[0] / l2, u2[1] / l2];
      const th = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
      if (th < 1e-4 || Math.PI - th < 1e-4) { out.push([v[0], v[1], 0, 0, 0, 0]); continue; }
      let t = cr / Math.tan(th / 2); t = Math.min(t, l1 / 2, l2 / 2);
      const r = t * Math.tan(th / 2), phi = Math.PI - th, h = 4 / 3 * Math.tan(phi / 4) * r;
      const A = [v[0] + u1[0] * t, v[1] + u1[1] * t], B = [v[0] + u2[0] * t, v[1] + u2[1] * t];
      out.push([A[0], A[1], 0, 0, -u1[0] * h, -u1[1] * h]);
      out.push([B[0], B[1], -u2[0] * h, -u2[1] * h, 0, 0]);
    }
    return out;
  }
  Live.cornerGeom = (d) => { // first vertex and the bisector data used by the corner-radius widget (shape space)
    const V = d.type === 'polygon' ? (() => { const n = Math.max(3, d.sides | 0), a0 = -90 + (n % 2 === 0 ? 180 / n : 0), f = a => [Math.cos(a * Math.PI / 180) * d.radius, Math.sin(a * Math.PI / 180) * d.radius]; return [f(a0 - 360 / n), f(a0), f(a0 + 360 / n)]; })()
      : (() => { const n = Math.max(3, d.points | 0), f = (a, r) => [Math.cos(a * Math.PI / 180) * r, Math.sin(a * Math.PI / 180) * r]; return [f(-90 - 180 / n, d.r2), f(-90, d.r1), f(-90 + 180 / n, d.r2)]; })();
    const [P0, v, P1] = V, a = Math.atan2(P0[1] - v[1], P0[0] - v[0]), b = Math.atan2(P1[1] - v[1], P1[0] - v[0]);
    const u1 = [Math.cos(a), Math.sin(a)], u2 = [Math.cos(b), Math.sin(b)], th = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
    const bis = [u1[0] + u2[0], u1[1] + u2[1]], bl = Math.hypot(...bis) || 1;
    return { v, bis: [bis[0] / bl, bis[1] / bl], th };
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
  Live.ellipse = rect => Live.set(new P.Path({ insert: false }), { type: 'ellipse', w: rect.width, h: rect.height, m: [1, 0, 0, 1, rect.center.x, rect.center.y] });
  Live.polygon = (center, sides, radius, angle = 0) => Live.set(new P.Path({ insert: false }), { type: 'polygon', sides: Math.max(3, sides | 0), radius, m: vals(new P.Matrix().translate(center).rotate(angle)) });
  Live.star = (center, points, r1, r2, angle = 0) => Live.set(new P.Path({ insert: false }), { type: 'star', points: Math.max(3, points | 0), r1, r2, m: vals(new P.Matrix().translate(center).rotate(angle)) });
  // sanitize live params read from a file (untrusted)
  Live.sanitize = d => {
    if (!d || typeof d !== 'object' || !TYPES[d.type] || !Array.isArray(d.m) || d.m.length !== 6) return undefined;
    const n = (v, lo, hi, def) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; };
    const o = { type: d.type, m: d.m.map(v => n(v, -1e7, 1e7, 0)) };
    if (d.type === 'rect') { o.w = n(d.w, 0, 1e7, 1); o.h = n(d.h, 0, 1e7, 1); o.r = [0, 1, 2, 3].map(i => n(Array.isArray(d.r) ? d.r[i] : 0, 0, 1e7, 0)); }
    if (d.type === 'ellipse') { o.w = n(d.w, 0, 1e7, 1); o.h = n(d.h, 0, 1e7, 1); if (d.start != null || d.end != null) { o.start = n(d.start, -3600, 3600, 0); o.end = n(d.end, -3600, 3600, 360); } }
    if (d.type === 'polygon') { o.sides = Math.round(n(d.sides, 3, 1000, 6)); o.radius = n(d.radius, 0, 1e7, 10); }
    if (d.type === 'star') { o.points = Math.round(n(d.points, 3, 1000, 5)); o.r1 = n(d.r1, 0, 1e7, 10); o.r2 = n(d.r2, 0, 1e7, 5); }
    if ((d.type === 'polygon' || d.type === 'star') && d.cr != null) o.cr = n(d.cr, 0, 1e7, 0);
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
    if (ortho && (d.type === 'rect' || d.type === 'ellipse')) { nd.w = d.w * sx; nd.h = d.h * sy; fold = true; }
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
    } else if (d.type === 'ellipse') {
      const full = pieSweep(d) >= 360 - 1e-9, at = deg => m.transform(new P.Point(Math.cos(deg * Math.PI / 180) * d.w / 2, Math.sin(deg * Math.PI / 180) * d.h / 2));
      out.push({ kind: 'pieEnd', pt: at(full ? (+d.start || 0) : d.end) });
      if (!full) out.push({ kind: 'pieStart', pt: at(+d.start || 0) });
    } else {
      const vr = LV.v(b.rightCenter);
      const cg = Live.cornerGeom(d), sinh = Math.sin(cg.th / 2) || 1, dist = Math.max((+d.cr || 0) / sinh, 14 / z / sc);
      out.push({ kind: 'cr', pt: m.transform(new P.Point(cg.v[0] + cg.bis[0] * dist, cg.v[1] + cg.bis[1] * dist)) });
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
    } else if (w.kind === 'pieEnd' || w.kind === 'pieStart') {
      let a = Math.atan2(lp.y / (d0.h / 2 || 1), lp.x / (d0.w / 2 || 1)) * 180 / Math.PI; if (!ev.shift) a = Math.round(a); else a = Math.round(a / 15) * 15;
      const s = d0.start ?? 0, e = d0.end ?? 360, full = pieSweep(d0) >= 360 - 1e-9;
      const nd = w.kind === 'pieEnd' ? { ...d0, start: full ? s : s, end: a } : { ...d0, start: a, end: e };
      if (Math.abs(((nd.end - nd.start) % 360 + 360) % 360) < 0.5) { delete nd.start; delete nd.end; }
      Live.set(it, nd); LV.status(nd.start == null ? 'Full ellipse' : `Pie ${LV.fmt(nd.start)}° → ${LV.fmt(nd.end)}°`);
    } else if (w.kind === 'cr') {
      const cg = Live.cornerGeom(d0), proj = (lp.x - cg.v[0]) * cg.bis[0] + (lp.y - cg.v[1]) * cg.bis[1];
      let cr = Math.max(0, proj * Math.sin(cg.th / 2)); if (!ev.shift) cr = Math.round(cr);
      Live.set(it, { ...d0, cr }); LV.status(`Corner radius ${LV.fmt(cr)}`);
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
      if (w.kind === 'corner' || w.kind === 'cr' || w.kind === 'pieStart' || w.kind === 'pieEnd') { ctx.beginPath(); ctx.arc(p.x, p.y, 3.6, 0, 7); ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(p.x, p.y, 1.3, 0, 7); ctx.fillStyle = LV.SEL_COLOR; ctx.fill(); }
      else if (w.kind === 'inner') { ctx.beginPath(); ctx.arc(p.x, p.y, 3.6, 0, 7); ctx.fillStyle = LV.SEL_COLOR; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.stroke(); }
      else { ctx.beginPath(); ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x + 5, p.y); ctx.lineTo(p.x, p.y + 5); ctx.lineTo(p.x - 5, p.y); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.fillStyle = LV.SEL_COLOR; ctx.font = '10px "Segoe UI",sans-serif'; const t = Live.target(); if (t) ctx.fillText(String(t.d.sides || t.d.points), p.x + 8, p.y + 3.5); }
    });
  };
})();
