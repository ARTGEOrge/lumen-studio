// Lumen Stress — 2-D geometry: parametric shapes → edges (lines and arcs), discretisation, even-odd region test,
// overlap checks, DXF outline import, and extrusion of an outline into a closed STL-style triangle soup.
(function (root, factory) { const m = factory(); if (typeof module === 'object' && module.exports) module.exports = m; else root.StressGeom = m; })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TAU = Math.PI * 2;

  // ---------- edges ----------
  // line: {type:'line', a:[x,y], b:[x,y]}; arc: {type:'arc', c:[x,y], r, a0, da} (da signed, CCW positive)
  function edgePoint(e, t) {
    if (e.type === 'line') return [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t];
    const a = e.a0 + e.da * t; return [e.c[0] + e.r * Math.cos(a), e.c[1] + e.r * Math.sin(a)];
  }
  const edgeLength = e => e.type === 'line' ? Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]) : e.r * Math.abs(e.da);
  // arc from bulge (DXF): p → q with bulge b = tan(sweep/4)
  function bulgeArc(p, q, b) {
    const da = 4 * Math.atan(b), dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
    if (Math.abs(b) < 1e-9 || L < 1e-12) return { type: 'line', a: p, b: q };
    const r = L / (2 * Math.abs(Math.sin(da / 2))), h = r * Math.cos(da / 2) * Math.sign(b);   // signed centre offset from the chord midpoint
    const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, nx = -dy / L, ny = dx / L;
    const c = [mx + nx * h, my + ny * h];
    return { type: 'arc', c, r, a0: Math.atan2(p[1] - c[1], p[0] - c[0]), da };
  }

  // ---------- shapes ----------
  // rect {x,y,w,h,r}: edges 0..3 = bottom, right, top, left (then 4..7 = corner arcs when r > 0)
  // circle {cx,cy,r}: edge 0 = the full circle; poly {pts:[[x,y,bulge],…]}: edge i runs from point i to i+1
  function shapeEdges(s) {
    if (s.kind === 'rect') {
      const { x, y, w, h } = s, r = Math.max(0, Math.min(+s.r || 0, w / 2 - 1e-9, h / 2 - 1e-9));
      if (!(r > 0)) return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map((p, i, a) => ({ type: 'line', a: p, b: a[(i + 1) % 4] }));
      return [
        { type: 'line', a: [x + r, y], b: [x + w - r, y] }, { type: 'line', a: [x + w, y + r], b: [x + w, y + h - r] },
        { type: 'line', a: [x + w - r, y + h], b: [x + r, y + h] }, { type: 'line', a: [x, y + h - r], b: [x, y + r] },
        { type: 'arc', c: [x + w - r, y + r], r, a0: -Math.PI / 2, da: Math.PI / 2 }, { type: 'arc', c: [x + w - r, y + h - r], r, a0: 0, da: Math.PI / 2 },
        { type: 'arc', c: [x + r, y + h - r], r, a0: Math.PI / 2, da: Math.PI / 2 }, { type: 'arc', c: [x + r, y + r], r, a0: Math.PI, da: Math.PI / 2 }];
    }
    if (s.kind === 'circle') return [{ type: 'arc', c: [s.cx, s.cy], r: s.r, a0: 0, da: TAU }];
    if (s.kind === 'poly') { const P = s.pts, n = P.length; return P.map((p, i) => bulgeArc([p[0], p[1]], [P[(i + 1) % n][0], P[(i + 1) % n][1]], p[2] || 0)); }
    return [];
  }
  // edges in loop order (for rects with fillets: bottom, arc, right, arc, …)
  function loopOrder(s) {
    const E = shapeEdges(s);
    if (s.kind === 'rect' && E.length === 8) return [0, 4, 1, 5, 2, 6, 3, 7];
    return E.map((_, i) => i);
  }
  function allEdges(shapes) {
    const out = [];
    shapes.forEach(s => { const E = shapeEdges(s); loopOrder(s).forEach(i => out.push({ id: s.id + ':' + i, shape: s.id, index: i, e: E[i] })); });
    return out;
  }
  // polyline approximation of a shape (closed, no repeated end point)
  function shapePolyline(s, maxSeg = Infinity, maxAng = Math.PI / 36) {
    const E = shapeEdges(s), pts = [];
    loopOrder(s).forEach(i => { const e = E[i], L = edgeLength(e), n = Math.max(1, Math.ceil(L / maxSeg), e.type === 'arc' ? Math.ceil(Math.abs(e.da) / maxAng) : 1); for (let k = 0; k < n; k++) pts.push(edgePoint(e, k / n)); });
    return pts;
  }
  function pointInPoly(p, P) {
    let c = false;
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; }
    return c;
  }
  // even-odd: a point is material if it is inside an odd number of outlines (so a circle inside a plate is a hole)
  function regionTester(shapes) {
    const polys = shapes.map(s => shapePolyline(s, Infinity, Math.PI / 90));
    return (x, y) => { let k = 0; for (const P of polys) if (pointInPoly([x, y], P)) k++; return (k & 1) === 1; };
  }
  function bounds(shapes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    shapes.forEach(s => shapePolyline(s, Infinity, Math.PI / 18).forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
    return isFinite(x0) ? { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 } : { x0: 0, y0: 0, x1: 100, y1: 100, w: 100, h: 100 };
  }
  function polyArea(P) { let a = 0; for (let i = 0, j = P.length - 1; i < P.length; j = i++) a += (P[j][0] - P[i][0]) * (P[j][1] + P[i][1]); return a / 2; }
  // material area by even-odd rule (Σ ± |area| by nesting depth)
  function regionArea(shapes) {
    const polys = shapes.map(s => shapePolyline(s, Infinity, Math.PI / 180)); let A = 0;
    polys.forEach((P, i) => { let d = 0; polys.forEach((Q, j) => { if (i !== j && pointInPoly(P[0], Q)) d++; }); A += (d % 2 ? -1 : 1) * Math.abs(polyArea(P)); });
    return A;
  }
  // proper crossings between outlines (and self-crossings) → list of points; the mesher needs non-crossing outlines
  function crossings(shapes) {
    const segs = [];
    shapes.forEach((s, si) => { const P = shapePolyline(s, Infinity, Math.PI / 36); P.forEach((p, i) => segs.push({ a: p, b: P[(i + 1) % P.length], s: si, i, n: P.length })); });
    const out = [], sz = bounds(shapes), eps = 1e-9 * Math.max(sz.w, sz.h);
    const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) {
      const A = segs[i], B = segs[j];
      if (A.s === B.s && (Math.abs(A.i - B.i) <= 1 || Math.abs(A.i - B.i) === A.n - 1)) continue;
      if (Math.max(A.a[0], A.b[0]) < Math.min(B.a[0], B.b[0]) || Math.max(B.a[0], B.b[0]) < Math.min(A.a[0], A.b[0]) || Math.max(A.a[1], A.b[1]) < Math.min(B.a[1], B.b[1]) || Math.max(B.a[1], B.b[1]) < Math.min(A.a[1], A.b[1])) continue;
      const d1 = orient(A.a, A.b, B.a), d2 = orient(A.a, A.b, B.b), d3 = orient(B.a, B.b, A.a), d4 = orient(B.a, B.b, A.b), L = Math.hypot(A.b[0] - A.a[0], A.b[1] - A.a[1]) * Math.hypot(B.b[0] - B.a[0], B.b[1] - B.a[1]);
      if (((d1 > eps * L && d2 < -eps * L) || (d1 < -eps * L && d2 > eps * L)) && ((d3 > eps * L && d4 < -eps * L) || (d3 < -eps * L && d4 > eps * L))) { const t = d1 / (d1 - d2); out.push([B.a[0] + (B.b[0] - B.a[0]) * t, B.a[1] + (B.b[1] - B.a[1]) * t]); if (out.length > 20) return out; }
    }
    return out;
  }
  // distance from a point to an edge (for picking)
  function edgeDistance(e, p) {
    if (e.type === 'line') { const dx = e.b[0] - e.a[0], dy = e.b[1] - e.a[1], L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) / L2)) : 0; return Math.hypot(p[0] - e.a[0] - t * dx, p[1] - e.a[1] - t * dy); }
    let a = Math.atan2(p[1] - e.c[1], p[0] - e.c[0]), t = (a - e.a0) / e.da; t = ((t % (TAU / Math.abs(e.da))) + TAU / Math.abs(e.da)) % (TAU / Math.abs(e.da));
    if (Math.abs(e.da) >= TAU - 1e-9 || t <= 1) return Math.abs(Math.hypot(p[0] - e.c[0], p[1] - e.c[1]) - e.r);
    const q0 = edgePoint(e, 0), q1 = edgePoint(e, 1); return Math.min(Math.hypot(p[0] - q0[0], p[1] - q0[1]), Math.hypot(p[0] - q1[0], p[1] - q1[1]));
  }
  // translate / sanitise
  function moveShape(s, dx, dy) {
    if (s.kind === 'rect') { s.x += dx; s.y += dy; } else if (s.kind === 'circle') { s.cx += dx; s.cy += dy; } else if (s.kind === 'poly') s.pts.forEach(p => { p[0] += dx; p[1] += dy; });
  }
  const fin = (v, d = 0) => (typeof v === 'number' || typeof v === 'string') && isFinite(+v) ? +v : d;
  function sanitizeShape(s, i) {
    if (!s || typeof s !== 'object') return null;
    const id = /^[\w-]{1,24}$/.test(s.id) ? s.id : 's' + (i + 1), name = String(s.name || '').slice(0, 60);
    if (s.kind === 'rect') { const w = Math.abs(fin(s.w)), h = Math.abs(fin(s.h)); return w > 0 && h > 0 ? { id, name, kind: 'rect', x: fin(s.x), y: fin(s.y), w, h, r: Math.max(0, fin(s.r)) } : null; }
    if (s.kind === 'circle') { const r = Math.abs(fin(s.r)); return r > 0 ? { id, name, kind: 'circle', cx: fin(s.cx), cy: fin(s.cy), r } : null; }
    if (s.kind === 'poly' && Array.isArray(s.pts)) { const pts = s.pts.slice(0, 20000).filter(p => Array.isArray(p)).map(p => [fin(p[0]), fin(p[1]), Math.max(-1e3, Math.min(1e3, fin(p[2])))]); return pts.length >= 2 ? { id, name, kind: 'poly', pts } : null; }
    return null;
  }

  // ---------- DXF ----------
  // Reads LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE/VERTEX, ELLIPSE and SPLINE (as polylines) from ENTITIES and chains them into closed outlines.
  function parseDXF(text) {
    const L = text.split(/\r\n|\r|\n/), pairs = [];
    for (let i = 0; i + 1 < L.length; i += 2) pairs.push([parseInt(L[i].trim(), 10), L[i + 1].trim()]);
    let i = 0; const ents = [];
    // find ENTITIES section
    while (i < pairs.length && !(pairs[i][0] === 2 && pairs[i][1] === 'ENTITIES')) i++;
    if (i >= pairs.length) i = 0;
    let cur = null;
    for (; i < pairs.length; i++) {
      const [c, v] = pairs[i];
      if (c === 0) { if (cur) ents.push(cur); if (v === 'ENDSEC' || v === 'EOF') { cur = null; break; } cur = { type: v, g: [] }; continue; }
      if (cur) cur.g.push([c, v]);
    }
    if (cur) ents.push(cur);
    const pieces = [], closed = [], warn = new Set(); let poly = null;
    const num = (g, code, d = 0) => { const p = g.find(q => q[0] === code); return p ? parseFloat(p[1]) : d; };
    for (const e of ents) {
      const g = e.g;
      if (e.type === 'LINE') pieces.push([[num(g, 10), num(g, 20), 0], [num(g, 11), num(g, 21), 0]]);
      else if (e.type === 'ARC') {
        const cx = num(g, 10), cy = num(g, 20), r = num(g, 40), a0 = num(g, 50) * Math.PI / 180; let a1 = num(g, 51) * Math.PI / 180; while (a1 <= a0) a1 += TAU;
        const da = a1 - a0; pieces.push([[cx + r * Math.cos(a0), cy + r * Math.sin(a0), Math.tan(da / 4)], [cx + r * Math.cos(a1), cy + r * Math.sin(a1), 0]]);
      } else if (e.type === 'CIRCLE') closed.push({ kind: 'circle', cx: num(g, 10), cy: num(g, 20), r: num(g, 40) });
      else if (e.type === 'LWPOLYLINE') {
        const pts = []; let flags = 0;
        for (const [c, v] of g) { if (c === 70) flags = +v; else if (c === 10) pts.push([+v, 0, 0]); else if (c === 20 && pts.length) pts[pts.length - 1][1] = +v; else if (c === 42 && pts.length) pts[pts.length - 1][2] = +v; }
        if (flags & 1) closed.push({ kind: 'poly', pts }); else pieces.push(pts);
      } else if (e.type === 'POLYLINE') poly = { pts: [], closed: (num(g, 70) & 1) === 1 };
      else if (e.type === 'VERTEX' && poly) poly.pts.push([num(g, 10), num(g, 20), num(g, 42)]);
      else if (e.type === 'SEQEND' && poly) { if (poly.closed) closed.push({ kind: 'poly', pts: poly.pts }); else pieces.push(poly.pts); poly = null; }
      else if (e.type === 'ELLIPSE') {
        const cx = num(g, 10), cy = num(g, 20), mx = num(g, 11), my = num(g, 21), ratio = num(g, 40, 1), t0 = num(g, 41, 0), t1 = num(g, 42, TAU), ang = Math.atan2(my, mx), A = Math.hypot(mx, my), B = A * ratio;
        let sweep = t1 - t0; while (sweep <= 0) sweep += TAU; const n = Math.max(16, Math.ceil(sweep / (TAU / 96))), pts = [];
        for (let k = 0; k <= n; k++) { const t = t0 + sweep * k / n, x = A * Math.cos(t), y = B * Math.sin(t); pts.push([cx + x * Math.cos(ang) - y * Math.sin(ang), cy + x * Math.sin(ang) + y * Math.cos(ang), 0]); }
        if (Math.abs(sweep - TAU) < 1e-6) { pts.pop(); closed.push({ kind: 'poly', pts }); } else pieces.push(pts);
        warn.add('Ellipses were converted to polylines.');
      } else if (e.type === 'SPLINE') {
        const fit = [], ctl = []; for (const [c, v] of g) { if (c === 11) fit.push([+v, 0, 0]); else if (c === 21 && fit.length) fit[fit.length - 1][1] = +v; else if (c === 10) ctl.push([+v, 0, 0]); else if (c === 20 && ctl.length) ctl[ctl.length - 1][1] = +v; }
        const pts = fit.length >= 2 ? fit : ctl; if (pts.length >= 2) { if ((num(g, 70) & 1) === 1) closed.push({ kind: 'poly', pts }); else pieces.push(pts); }
        warn.add('Splines were approximated by straight segments through their ' + (fit.length ? 'fit' : 'control') + ' points.');
      } else if (!['POINT', 'TEXT', 'MTEXT', 'DIMENSION', 'INSERT', 'HATCH', 'ATTRIB', 'ATTDEF', 'SOLID', 'VIEWPORT'].includes(e.type)) warn.add('Ignored ' + e.type + ' entities.');
    }
    // chain open pieces end-to-end
    let size = 0; pieces.forEach(p => p.forEach(q => size = Math.max(size, Math.abs(q[0]), Math.abs(q[1])))); closed.forEach(s => size = Math.max(size, Math.abs(s.cx || 0), Math.abs(s.cy || 0)));
    const tol = Math.max(1e-6, size * 1e-6), close = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
    const rev = pts => { const n = pts.length, out = []; for (let k = n - 1; k >= 0; k--) out.push([pts[k][0], pts[k][1], k > 0 ? -pts[k - 1][2] : 0]); return out; };
    const left = pieces.filter(p => p.length >= 2); let open = 0;
    while (left.length) {
      let chain = left.shift().map(p => p.slice());
      for (let grew = true; grew && !close(chain[0], chain[chain.length - 1]);) {
        grew = false;
        for (let k = 0; k < left.length; k++) {
          const p = left[k], end = chain[chain.length - 1];
          if (close(end, p[0])) { end[2] = p[0][2]; chain = chain.concat(p.slice(1).map(q => q.slice())); }
          else if (close(end, p[p.length - 1])) { const r = rev(p); end[2] = r[0][2]; chain = chain.concat(r.slice(1)); }
          else continue;
          left.splice(k, 1); grew = true; break;
        }
      }
      if (chain.length >= 3 && close(chain[0], chain[chain.length - 1])) { chain.pop(); closed.push({ kind: 'poly', pts: chain }); }
      else open++;
    }
    if (open) warn.add(open + ' open outline' + (open > 1 ? 's were' : ' was') + ' skipped (only closed outlines can be meshed).');
    const shapes = closed.map((s, k) => sanitizeShape(Object.assign({ id: 'd' + (k + 1), name: s.kind === 'circle' ? 'Circle' : 'Outline' }, s), k)).filter(Boolean);
    return { shapes, warnings: [...warn] };
  }

  // ---------- extrusion: 2-D region (triangulated by the mesher) → closed triangle soup ----------
  // tri2d: {pts:[[x,y]], tris:[[a,b,c]] CCW}, boundary loops: [[i,j,…]] — walls are built from boundary edges of tri2d
  function extrude(tri2d, depth) {
    const out = [], P = tri2d.pts, z1 = depth;
    const edgeCount = new Map(), key = (a, b) => a < b ? a + ',' + b : b + ',' + a;
    for (const [a, b, c] of tri2d.tris) {
      out.push([[...P[a], 0], [...P[c], 0], [...P[b], 0]]);      // bottom faces down
      out.push([[...P[a], z1], [...P[b], z1], [...P[c], z1]]);   // top faces up
      [[a, b], [b, c], [c, a]].forEach(([u, v]) => { const k = key(u, v); edgeCount.set(k, (edgeCount.get(k) || 0) + 1); });
    }
    for (const [a, b, c] of tri2d.tris) [[a, b], [b, c], [c, a]].forEach(([u, v]) => {
      if (edgeCount.get(key(u, v)) !== 1) return;   // boundary edge, oriented CCW around the material → wall faces outward
      out.push([[...P[u], 0], [...P[v], 0], [...P[v], z1]]); out.push([[...P[u], 0], [...P[v], z1], [...P[u], z1]]);
    });
    // stand the part up: 2-D (x, y) → 3-D (x, z), depth along −y (a proper rotation, so faces keep pointing outward)
    return out.map(t => t.map(([x, y, z]) => [x, -z, y]));
  }

  return { edgePoint, edgeLength, bulgeArc, shapeEdges, loopOrder, allEdges, shapePolyline, pointInPoly, regionTester, bounds, polyArea, regionArea, crossings, edgeDistance, moveShape, sanitizeShape, parseDXF, extrude };
});
