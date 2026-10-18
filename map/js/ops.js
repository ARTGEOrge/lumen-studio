// Lumen Map — polygon overlay (union / intersection / difference), line clipping and buffers.
// Boolean operations use paper.js's robust path booleans (straight segments only); everything else is our own.
// Geometries are GeoJSON objects in a planar frame; the geo* helpers wrap lon/lat data (scaled, origin-shifted).
(function (root) {
  'use strict';
  const paper = root.paper || globalThis.paper; // Node tests set globalThis.paper before requiring this file
  const G = root.MapGeo || (typeof require !== 'undefined' ? require('./geo.js') : null);
  let ready = false;
  function setup() { if (!ready) { paper.setup(new paper.Size(1, 1)); ready = true; } }

  // ---------- conversion ----------
  function ringPath(r) {
    const n = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.length - 1 : r.length;
    const segs = []; let px = NaN, py = NaN;
    for (let i = 0; i < n; i++) { const x = r[i][0], y = r[i][1]; if (x === px && y === py) continue; segs.push(new paper.Segment(new paper.Point(x, y))); px = x; py = y; }
    return new paper.Path({ segments: segs, closed: true, insert: false });
  }
  function toPath(g) {
    setup();
    const polys = G.polygonsOf(g), children = [];
    polys.forEach(rings => rings.forEach(r => { if (r.length >= 3) children.push(ringPath(r)); }));
    return new paper.CompoundPath({ children, insert: false, fillRule: 'evenodd' });
  }
  function lineItem(g) {
    setup();
    const children = G.linesOf(g).filter(l => l.length > 1).map(l => new paper.Path({ segments: l.map(c => new paper.Point(c[0], c[1])), insert: false }));
    return new paper.CompoundPath({ children, insert: false });
  }
  function pathsOf(item) { if (!item) return []; if (item.className === 'Path') return [item]; return (item.children || []).flatMap(pathsOf); }
  // flatten curves (should be none for straight inputs) and return rings as coordinate arrays
  function itemRings(item) {
    return pathsOf(item).map(p => {
      if (p.curves.some(c => c.hasHandles())) { p = p.clone({ insert: false }); p.flatten(0.01); }
      const pts = p.segments.map(s => [s.point.x, s.point.y]); if (pts.length) pts.push(pts[0].slice()); return pts;
    }).filter(r => r.length >= 4 && Math.abs(G.ringArea(r)) > 1e-12);
  }
  // Rings -> (Multi)Polygon with correct nesting (outer CCW, holes CW per RFC 7946)
  function ringsToGeom(rings) {
    const R = rings.map(r => ({ r, a: Math.abs(G.ringArea(r)), b: G.bbox({ type: 'LineString', coordinates: r }), depth: 0, parent: null })).sort((p, q) => q.a - p.a);
    const inside = (inner, outer) => {
      if (!(outer.b[0] <= inner.b[0] && outer.b[1] <= inner.b[1] && outer.b[2] >= inner.b[2] && outer.b[3] >= inner.b[3])) return false;
      let yes = 0, no = 0; const n = inner.r.length - 1;
      for (let k = 0; k < Math.min(n, 7); k++) { const i = Math.floor(k * n / Math.min(n, 7)), a = inner.r[i], b = inner.r[i + 1]; const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; G.pointInRing(m, outer.r) ? yes++ : no++; }
      return yes > no;
    };
    R.forEach((x, i) => { for (let j = i - 1; j >= 0; j--) if (R[j].a > x.a && inside(x, R[j])) { x.parent = R[j]; x.depth = R[j].depth + 1; break; } });
    const polys = [];
    R.forEach(x => { if (x.depth % 2 === 0) { x.poly = [orient(x.r, true)]; polys.push(x.poly); } });
    R.forEach(x => { if (x.depth % 2 === 1 && x.parent && x.parent.poly) x.parent.poly.push(orient(x.r, false)); });
    if (!polys.length) return null;
    return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
  }
  const orient = (r, ccw) => (G.ringArea(r) > 0) === ccw ? r : r.slice().reverse();
  const fromPath = item => ringsToGeom(itemRings(item));

  // ---------- booleans ----------
  function bool(op, a, b) {
    const pa = toPath(a), pb = toPath(b);
    if (!pa.children.length) return op === 'unite' ? fromPath(pb) : null;
    if (!pb.children.length) return op === 'intersect' ? null : fromPath(pa);
    return fromPath(pa[op](pb, { insert: false }));
  }
  const intersection = (a, b) => bool('intersect', a, b);
  const difference = (a, b) => bool('subtract', a, b);
  // union of many polygons: balanced pairwise tree keeps paper's work small
  function union(geoms) {
    let items = geoms.filter(Boolean).map(toPath).filter(p => p.children.length);
    if (!items.length) return null;
    while (items.length > 1) { const next = []; for (let i = 0; i < items.length; i += 2) next.push(i + 1 < items.length ? items[i].unite(items[i + 1], { insert: false }) : items[i]); items = next; }
    return fromPath(items[0]);
  }
  // lines inside / outside a polygon (own implementation: split at edge crossings, keep pieces by midpoint test)
  function clipLines(lineGeom, polyGeom, keepInside = true) {
    const rings = G.polygonsOf(polyGeom).flat(), out = [];
    G.linesOf(lineGeom).forEach(line => {
      let cur = [];
      const flush = () => { if (cur.length > 1) out.push(cur); cur = []; };
      for (let i = 1; i < line.length; i++) {
        const a = line[i - 1], b = line[i], ts = [0, 1];
        rings.forEach(r => { for (let k = 1; k < r.length; k++) { const t = segT(a, b, r[k - 1], r[k]); if (t != null) ts.push(t); } });
        ts.sort((p, q) => p - q);
        for (let k = 1; k < ts.length; k++) {
          const t0 = ts[k - 1], t1 = ts[k]; if (t1 - t0 < 1e-12) continue;
          const p0 = lerp(a, b, t0), p1 = lerp(a, b, t1), mid = lerp(a, b, (t0 + t1) / 2), inn = G.pointInGeom(mid, polyGeom);
          if (inn === keepInside) { if (!cur.length) cur.push(p0); else { const l = cur[cur.length - 1]; if (Math.abs(l[0] - p0[0]) > 1e-12 || Math.abs(l[1] - p0[1]) > 1e-12) { flush(); cur.push(p0); } } cur.push(p1); }
          else flush();
        }
      }
      flush();
    });
    if (!out.length) return null;
    return out.length === 1 ? { type: 'LineString', coordinates: out[0] } : { type: 'MultiLineString', coordinates: out };
  }
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  function segT(a, b, c, d) { // parameter t on ab where it crosses cd (null if none)
    const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1], den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-18) return null;
    const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / den;
    return t > 0 && t < 1 && u >= 0 && u <= 1 ? t : null;
  }

  // ---------- planar buffer ----------
  function circle(c, r, segs) { const n = Math.max(8, segs * 4), ring = []; for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; ring.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } ring.push(ring[0].slice()); return ring; }
  function capsule(a, b, r, segs) { // segment a→b swept by a disc of radius r
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), n = Math.max(4, segs * 2), ring = [];
    for (let i = 0; i <= n; i++) { const t = ang + Math.PI / 2 + Math.PI * i / n; ring.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)]); }
    for (let i = 0; i <= n; i++) { const t = ang - Math.PI / 2 + Math.PI * i / n; ring.push([b[0] + r * Math.cos(t), b[1] + r * Math.sin(t)]); }
    ring.push(ring[0].slice()); return ring;
  }
  // Douglas–Peucker (iterative); a tolerance of r/100 changes a buffer by at most 1 % of its width
  function simplify(l, tol) {
    if (l.length < 3) return l; const keep = new Uint8Array(l.length); keep[0] = keep[l.length - 1] = 1; const st = [[0, l.length - 1]], t2 = tol * tol;
    while (st.length) { const [a, b] = st.pop(); let md = -1, mi = -1; for (let i = a + 1; i < b; i++) { const d = G.segDist2(l[i], l[a], l[b]); if (d > md) { md = d; mi = i; } } if (md > t2) { keep[mi] = 1; st.push([a, mi], [mi, b]); } }
    return l.filter((_, i) => keep[i]);
  }
  function strokeBuffer(lines, r, segs) {
    const pieces = []; lines = lines.map(l => simplify(l, r / 100));
    lines.forEach(l => { for (let i = 1; i < l.length; i++) { if (l[i][0] === l[i - 1][0] && l[i][1] === l[i - 1][1]) continue; pieces.push({ type: 'Polygon', coordinates: [capsule(l[i - 1], l[i], r, segs)] }); } if (l.length === 1) pieces.push({ type: 'Polygon', coordinates: [circle(l[0], r, segs)] }); });
    return union(pieces);
  }
  function buffer(g, d, segs = 8) {
    if (!g || !d) return d ? null : g;
    const polys = G.polygonsOf(g), lines = G.linesOf(g), pts = G.pointsOf(g);
    const out = [];
    if (pts.length && d > 0) out.push(...pts.map(p => ({ type: 'Polygon', coordinates: [circle(p, d, segs)] })));
    if (lines.length && d > 0) out.push(strokeBuffer(lines, d, segs));
    if (polys.length) {
      const pg = polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
      const edge = strokeBuffer(polys.flat(), Math.abs(d), segs);
      out.push(d > 0 ? union([pg, edge]) : difference(pg, edge));
    }
    return out.length === 1 ? out[0] : union(out);
  }

  // ---------- lon/lat wrappers (scale degrees so paper's absolute epsilons are far below data precision) ----------
  const K = 1e4;
  function frame(geoms) { const bs = geoms.filter(Boolean).map(G.bbox); const x = Math.min(...bs.map(b => b[0])), y = Math.min(...bs.map(b => b[1])); return { fw: c => [(c[0] - x) * K, (c[1] - y) * K], bw: c => [c[0] / K + x, c[1] / K + y] }; }
  function inFrame(geoms, fn) {
    const f = frame(geoms); const r = fn(...geoms.map(g => g && G.mapCoords(g, f.fw)));
    return r && G.mapCoords(r, f.bw);
  }
  const geoIntersection = (a, b) => inFrame([a, b], intersection);
  const geoDifference = (a, b) => inFrame([a, b], difference);
  const geoUnion = geoms => { geoms = geoms.filter(Boolean); if (!geoms.length) return null; const f = frame(geoms); const r = union(geoms.map(g => G.mapCoords(g, f.fw))); return r && G.mapCoords(r, f.bw); };
  const geoClipLines = (l, p, keep) => inFrame([l, p], (a, b) => clipLines(a, b, keep));
  // geodesically sized buffer: work in a local transverse Mercator centred on the feature (metres)
  function geoBuffer(g, metres, segs = 8, Proj = root.MapProj || (typeof require !== 'undefined' ? require('./proj.js') : null)) {
    const b = G.bbox(g); if (!isFinite(b[0])) return null;
    const tm = Proj.localTM((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
    const r = buffer(G.mapCoords(g, c => tm.forward(c)), metres, segs);
    return r && G.mapCoords(r, c => tm.inverse(c));
  }

  // ---------- spatial predicates (planar, on raw coordinates) ----------
  function segsOf(g) { const out = []; [...G.linesOf(g), ...G.polygonsOf(g).flat()].forEach(l => { for (let i = 1; i < l.length; i++) out.push([l[i - 1], l[i]]); }); return out; }
  function vertsOf(g) { return G.parts(g).flat(); }
  function intersects(a, b) {
    if (!a || !b || !G.bboxHit(G.bbox(a), G.bbox(b))) return false;
    const va = vertsOf(a), vb = vertsOf(b);
    if (G.polygonsOf(b).length && va.some(p => G.pointInGeom(p, b))) return true;
    if (G.polygonsOf(a).length && vb.some(p => G.pointInGeom(p, a))) return true;
    const sa = segsOf(a), sb = segsOf(b), eps = 1e-18;
    for (const s of sa) for (const t of sb) if (G.segIntersect(s[0], s[1], t[0], t[1])) return true;
    const pa = G.pointsOf(a), pb = G.pointsOf(b);
    if (pa.length && (pb.some(q => pa.some(p => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 <= eps)) || pa.some(p => sb.some(t => G.segDist2(p, t[0], t[1]) <= eps)))) return true;
    if (pb.length && pb.some(p => sa.some(t => G.segDist2(p, t[0], t[1]) <= eps))) return true;
    return false;
  }
  // a within b: every vertex of a inside (or on) b's polygons and every edge midpoint too
  function within(a, b) {
    if (!a || !b || !G.polygonsOf(b).length) return false;
    const bb = G.bbox(b), ba = G.bbox(a); if (ba[0] < bb[0] || ba[1] < bb[1] || ba[2] > bb[2] || ba[3] > bb[3]) return false;
    const sb = segsOf(b), on = p => sb.some(t => G.segDist2(p, t[0], t[1]) < 1e-20);
    const ins = p => G.pointInGeom(p, b) || on(p);
    return vertsOf(a).every(ins) && segsOf(a).every(s => ins([(s[0][0] + s[1][0]) / 2, (s[0][1] + s[1][1]) / 2]));
  }
  function distance(a, b) {
    if (intersects(a, b)) return 0;
    let d = Infinity; const sa = segsOf(a), sb = segsOf(b), va = vertsOf(a), vb = vertsOf(b);
    va.forEach(p => { sb.forEach(t => d = Math.min(d, G.segDist2(p, t[0], t[1]))); vb.forEach(q => d = Math.min(d, (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2)); });
    vb.forEach(p => sa.forEach(t => d = Math.min(d, G.segDist2(p, t[0], t[1]))));
    return Math.sqrt(d);
  }
  // geodesic-ish distance in metres between two lon/lat geometries (local transverse Mercator around a)
  function geoDistance(a, b, Proj = root.MapProj || (typeof require !== 'undefined' ? require('./proj.js') : null)) {
    const bx = G.bbox(a), tm = Proj.localTM((bx[0] + bx[2]) / 2, (bx[1] + bx[3]) / 2), f = c => tm.forward(c);
    return distance(G.mapCoords(a, f), G.mapCoords(b, f));
  }

  const api = { setup, simplify, intersects, within, distance, geoDistance, toPath, fromPath, ringsToGeom, intersection, difference, union, clipLines, buffer, circle, geoIntersection, geoDifference, geoUnion, geoClipLines, geoBuffer };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MapOps = api;
})(typeof self !== 'undefined' ? self : this);
