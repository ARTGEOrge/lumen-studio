// Lumen Map — geodesy (WGS84 ellipsoid) and planar geometry helpers. No dependencies; runs in Node tests.
(function (root) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const A = 6378137, F = 1 / 298.257223563, B = A * (1 - F), E2 = F * (2 - F), E = Math.sqrt(E2);

  // ---------- Vincenty inverse (falls back to a spherical great circle for near-antipodal points) ----------
  function inverse(p1, p2) {
    const L = (p2[0] - p1[0]) * D2R, U1 = Math.atan((1 - F) * Math.tan(p1[1] * D2R)), U2 = Math.atan((1 - F) * Math.tan(p2[1] * D2R));
    const sU1 = Math.sin(U1), cU1 = Math.cos(U1), sU2 = Math.sin(U2), cU2 = Math.cos(U2);
    let lam = L, it = 0, sinS, cosS, sig, sinA, cos2A, cos2Sm, lamP;
    do {
      const sl = Math.sin(lam), cl = Math.cos(lam);
      sinS = Math.sqrt(Math.pow(cU2 * sl, 2) + Math.pow(cU1 * sU2 - sU1 * cU2 * cl, 2));
      if (sinS === 0) return { s: 0, az1: 0, az2: 0 };
      cosS = sU1 * sU2 + cU1 * cU2 * cl; sig = Math.atan2(sinS, cosS);
      sinA = cU1 * cU2 * sl / sinS; cos2A = 1 - sinA * sinA;
      cos2Sm = cos2A !== 0 ? cosS - 2 * sU1 * sU2 / cos2A : 0;
      const C = F / 16 * cos2A * (4 + F * (4 - 3 * cos2A));
      lamP = lam; lam = L + (1 - C) * F * sinA * (sig + C * sinS * (cos2Sm + C * cosS * (-1 + 2 * cos2Sm * cos2Sm)));
    } while (Math.abs(lam - lamP) > 1e-12 && ++it < 200);
    if (it >= 200) return sphereInverse(p1, p2);
    const u2 = cos2A * (A * A - B * B) / (B * B), Ak = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), Bk = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
    const dS = Bk * sinS * (cos2Sm + Bk / 4 * (cosS * (-1 + 2 * cos2Sm * cos2Sm) - Bk / 6 * cos2Sm * (-3 + 4 * sinS * sinS) * (-3 + 4 * cos2Sm * cos2Sm)));
    const s = B * Ak * (sig - dS), sl = Math.sin(lam), cl = Math.cos(lam);
    const az1 = Math.atan2(cU2 * sl, cU1 * sU2 - sU1 * cU2 * cl), az2 = Math.atan2(cU1 * sl, -sU1 * cU2 + cU1 * sU2 * cl);
    return { s, az1: (az1 * R2D + 360) % 360, az2: (az2 * R2D + 360) % 360 };
  }
  function sphereInverse(p1, p2) {
    const R = 6371008.8, f1 = p1[1] * D2R, f2 = p2[1] * D2R, dl = (p2[0] - p1[0]) * D2R;
    const h = Math.sin((f2 - f1) / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
    const az = Math.atan2(Math.sin(dl) * Math.cos(f2), Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl));
    return { s: 2 * R * Math.asin(Math.min(1, Math.sqrt(h))), az1: (az * R2D + 360) % 360, az2: NaN };
  }
  const distance = (p1, p2) => inverse(p1, p2).s;
  // Vincenty direct: point at distance s (m) and azimuth az (deg) from p
  function direct(p, az, s) {
    const a1 = az * D2R, sa1 = Math.sin(a1), ca1 = Math.cos(a1), tU1 = (1 - F) * Math.tan(p[1] * D2R), cU1 = 1 / Math.sqrt(1 + tU1 * tU1), sU1 = tU1 * cU1;
    const s1 = Math.atan2(tU1, ca1), sinA = cU1 * sa1, cos2A = 1 - sinA * sinA, u2 = cos2A * (A * A - B * B) / (B * B);
    const Ak = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2))), Bk = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
    let sig = s / (B * Ak), sigP, c2, sS, cS, it = 0;
    do { c2 = Math.cos(2 * s1 + sig); sS = Math.sin(sig); cS = Math.cos(sig); const dS = Bk * sS * (c2 + Bk / 4 * (cS * (-1 + 2 * c2 * c2) - Bk / 6 * c2 * (-3 + 4 * sS * sS) * (-3 + 4 * c2 * c2))); sigP = sig; sig = s / (B * Ak) + dS; } while (Math.abs(sig - sigP) > 1e-12 && ++it < 100);
    const x = sU1 * sS - cU1 * cS * ca1, lat = Math.atan2(sU1 * cS + cU1 * sS * ca1, (1 - F) * Math.sqrt(sinA * sinA + x * x));
    const lam = Math.atan2(sS * sa1, cU1 * cS - sU1 * sS * ca1), C = F / 16 * cos2A * (4 + F * (4 - 3 * cos2A));
    const L = lam - (1 - C) * F * sinA * (sig + C * sS * (c2 + C * cS * (-1 + 2 * c2 * c2)));
    let lon = p[0] + L * R2D; lon = ((lon + 540) % 360) - 180; return [lon, lat * R2D];
  }
  // geodesic length of a lon/lat polyline
  function length(coords) { let s = 0; for (let i = 1; i < coords.length; i++) s += distance(coords[i - 1], coords[i]); return s; }

  // ---------- geodesic area on the authalic sphere (equal area => exact for the ellipsoid up to edge shape) ----------
  const QP = (1 - E2) * (1 / (1 - E2) - (1 / (2 * E)) * Math.log((1 - E) / (1 + E))), RQ = A * Math.sqrt(QP / 2);
  const authLat = phi => { const s = Math.sin(phi), es = E * s; const q = (1 - E2) * (s / (1 - es * es) - (1 / (2 * E)) * Math.log((1 - es) / (1 + es))); return Math.asin(Math.max(-1, Math.min(1, q / QP))); };
  // signed area (m², positive = counter-clockwise) of a lon/lat ring, edges as great circles on the authalic sphere
  function ringAreaGeo(ring) {
    let sum = 0; const n = ring.length; if (n < 3) return 0;
    for (let i = 0; i < n; i++) {
      const p = ring[i], q = ring[(i + 1) % n]; if (p[0] === q[0] && p[1] === q[1]) continue;
      const b1 = authLat(p[1] * D2R), b2 = authLat(q[1] * D2R); let dl = (q[0] - p[0]) * D2R;
      if (dl > Math.PI) dl -= 2 * Math.PI; if (dl < -Math.PI) dl += 2 * Math.PI;
      sum += 2 * Math.atan2(Math.tan(dl / 2) * (Math.tan(b1 / 2) + Math.tan(b2 / 2)), 1 + Math.tan(b1 / 2) * Math.tan(b2 / 2));
    }
    return sum * RQ * RQ;
  }
  function geomArea(g) { // geodesic area of (Multi)Polygon in m²
    if (!g) return 0;
    const poly = rings => rings.reduce((s, r, i) => s + (i ? -1 : 1) * Math.abs(ringAreaGeo(r)), 0);
    if (g.type === 'Polygon') return poly(g.coordinates);
    if (g.type === 'MultiPolygon') return g.coordinates.reduce((s, p) => s + poly(p), 0);
    return 0;
  }
  function geomLength(g) { // geodesic length (lines) or perimeter (polygons) in m
    if (!g) return 0;
    switch (g.type) {
      case 'LineString': return length(g.coordinates);
      case 'MultiLineString': return g.coordinates.reduce((s, l) => s + length(l), 0);
      case 'Polygon': return g.coordinates.reduce((s, r) => s + length(r), 0);
      case 'MultiPolygon': return g.coordinates.reduce((s, p) => s + p.reduce((t, r) => t + length(r), 0), 0);
    }
    return 0;
  }

  // ---------- planar helpers (work in any x/y space) ----------
  function ringArea(r) { let s = 0; for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return s / 2; } // >0 = CCW
  function pointInRing(pt, r) {
    let inside = false; const x = pt[0], y = pt[1];
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; }
    return inside;
  }
  const pointInPolygon = (pt, rings) => { if (!rings.length || !pointInRing(pt, rings[0])) return false; for (let i = 1; i < rings.length; i++) if (pointInRing(pt, rings[i])) return false; return true; };
  function pointInGeom(pt, g) { if (!g) return false; if (g.type === 'Polygon') return pointInPolygon(pt, g.coordinates); if (g.type === 'MultiPolygon') return g.coordinates.some(p => pointInPolygon(pt, p)); return false; }
  function segDist2(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1]; return x * x + y * y; }
  function segIntersect(a, b, c, d) { // proper or touching intersection of segments ab, cd
    const o = (p, q, r) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
    const on = (p, q, r) => Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0]) && Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1]);
    const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
    if (o1 !== o2 && o3 !== o4) return true;
    return (o1 === 0 && on(a, c, b)) || (o2 === 0 && on(a, d, b)) || (o3 === 0 && on(c, a, d)) || (o4 === 0 && on(c, b, d));
  }
  // parts: every vertex list (ring or line) of a geometry, and points
  function parts(g) {
    if (!g) return [];
    switch (g.type) {
      case 'Point': return [[g.coordinates]];
      case 'MultiPoint': return g.coordinates.map(c => [c]);
      case 'LineString': return [g.coordinates];
      case 'MultiLineString': case 'Polygon': return g.coordinates;
      case 'MultiPolygon': return g.coordinates.flat();
      case 'GeometryCollection': return g.geometries.flatMap(parts);
    }
    return [];
  }
  function bbox(g) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; parts(g).forEach(p => p.forEach(c => { if (c[0] < x0) x0 = c[0]; if (c[0] > x1) x1 = c[0]; if (c[1] < y0) y0 = c[1]; if (c[1] > y1) y1 = c[1]; })); return [x0, y0, x1, y1]; }
  const bboxHit = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
  const baseType = t => t ? t.replace(/^Multi/, '') : null;
  function polygonsOf(g) { if (!g) return []; if (g.type === 'Polygon') return [g.coordinates]; if (g.type === 'MultiPolygon') return g.coordinates; if (g.type === 'GeometryCollection') return g.geometries.flatMap(polygonsOf); return []; }
  function linesOf(g) { if (!g) return []; if (g.type === 'LineString') return [g.coordinates]; if (g.type === 'MultiLineString') return g.coordinates; if (g.type === 'GeometryCollection') return g.geometries.flatMap(linesOf); return []; }
  function pointsOf(g) { if (!g) return []; if (g.type === 'Point') return [g.coordinates]; if (g.type === 'MultiPoint') return g.coordinates; if (g.type === 'GeometryCollection') return g.geometries.flatMap(pointsOf); return []; }
  // planar centroid (area-weighted for polygons, length-weighted for lines, mean for points)
  function centroid(g) {
    const polys = polygonsOf(g);
    if (polys.length) {
      let ax = 0, ay = 0, aa = 0;
      polys.forEach(rings => rings.forEach((r, ri) => {
        let a = 0, cx = 0, cy = 0; const x0 = r[0][0], y0 = r[0][1];
        for (let i = 0, n = r.length, j = n - 1; i < n; j = i++) { const xi = r[i][0] - x0, yi = r[i][1] - y0, xj = r[j][0] - x0, yj = r[j][1] - y0, f = xj * yi - xi * yj; a += f; cx += (xj + xi) * f; cy += (yj + yi) * f; }
        a /= 2; const s = (ri ? -1 : 1) * Math.sign(a) || 0; if (!a) return;
        ax += s * (cx / 6 + x0 * a); ay += s * (cy / 6 + y0 * a); aa += s * a;
      }));
      if (aa) return [ax / aa, ay / aa];
    }
    const lines = linesOf(g);
    if (lines.length) {
      let sx = 0, sy = 0, sl = 0;
      lines.forEach(l => { for (let i = 1; i < l.length; i++) { const d = Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]); sx += d * (l[i][0] + l[i - 1][0]) / 2; sy += d * (l[i][1] + l[i - 1][1]) / 2; sl += d; } });
      if (sl) return [sx / sl, sy / sl];
    }
    const pts = parts(g).flat(); if (!pts.length) return null;
    return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
  }
  // a point guaranteed inside a polygon (for labels / "point on surface"): scanline through the centroid's y
  function pointOnSurface(g) {
    const polys = polygonsOf(g); if (!polys.length) return centroid(g);
    const c = centroid(g); if (c && pointInGeom(c, g)) return c;
    let best = null, bw = -1;
    polys.forEach(rings => {
      const b = bbox({ type: 'Polygon', coordinates: rings });
      for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        const y = b[1] + (b[3] - b[1]) * fy, xs = [];
        rings.forEach(r => { for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[j], q = r[i]; if ((a[1] > y) !== (q[1] > y)) xs.push(a[0] + (y - a[1]) * (q[0] - a[0]) / (q[1] - a[1])); } });
        xs.sort((p, q) => p - q);
        for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > bw) { bw = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, y]; }
      }
    });
    return best || c;
  }
  // apply fn([x,y]) -> [x,y] to every coordinate, returning a new geometry
  function mapCoords(g, fn) {
    if (!g) return g;
    const m1 = c => { const r = fn(c); return c.length > 2 ? [r[0], r[1], ...c.slice(2)] : r; };
    switch (g.type) {
      case 'Point': return { type: g.type, coordinates: m1(g.coordinates) };
      case 'MultiPoint': case 'LineString': return { type: g.type, coordinates: g.coordinates.map(m1) };
      case 'MultiLineString': case 'Polygon': return { type: g.type, coordinates: g.coordinates.map(r => r.map(m1)) };
      case 'MultiPolygon': return { type: g.type, coordinates: g.coordinates.map(p => p.map(r => r.map(m1))) };
      case 'GeometryCollection': return { type: g.type, geometries: g.geometries.map(x => mapCoords(x, fn)) };
    }
    return g;
  }
  // densify a lon/lat polyline so that projected edges follow the geodesic shape more closely (max step deg)
  function densify(coords, step) {
    const out = [coords[0]];
    for (let i = 1; i < coords.length; i++) { const a = coords[i - 1], b = coords[i], n = Math.ceil(Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])) / step); for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
    return out;
  }
  // human-readable distance / area
  function fmtDist(m, units = 'metric') {
    if (units === 'imperial') { const ft = m / 0.3048; return ft < 5280 ? ft.toFixed(ft < 100 ? 1 : 0) + ' ft' : (ft / 5280).toFixed(ft < 52800 ? 3 : 2) + ' mi'; }
    if (units === 'nautical') return (m / 1852).toFixed(3) + ' nmi';
    return m < 1000 ? m.toFixed(m < 10 ? 2 : 1) + ' m' : (m / 1000).toFixed(m < 1e5 ? 3 : 2) + ' km';
  }
  function fmtArea(m2, units = 'metric') {
    if (units === 'imperial') { const ac = m2 / 4046.8564224; return ac < 640 ? ac.toFixed(2) + ' ac' : (ac / 640).toFixed(3) + ' mi²'; }
    if (units === 'nautical') return (m2 / 1852 / 1852).toFixed(3) + ' nmi²';
    return m2 < 1e5 ? m2.toFixed(1) + ' m²' : m2 < 1e7 ? (m2 / 1e4).toFixed(2) + ' ha' : (m2 / 1e6).toFixed(m2 < 1e9 ? 3 : 1) + ' km²';
  }
  function fmtDMS(v, pos, neg) { const s = v < 0 ? neg : pos; v = Math.abs(v); let d = Math.floor(v), m = Math.floor((v - d) * 60), sec = ((v - d) * 60 - m) * 60; if (sec >= 59.995) { sec = 0; m++; } if (m >= 60) { m = 0; d++; } return `${d}°${String(m).padStart(2, '0')}′${sec.toFixed(2).padStart(5, '0')}″${s}`; }

  const api = { inverse, distance, direct, length, ringAreaGeo, geomArea, geomLength, authLat, RQ, ringArea, pointInRing, pointInPolygon, pointInGeom, segDist2, segIntersect, parts, bbox, bboxHit, baseType, polygonsOf, linesOf, pointsOf, centroid, pointOnSurface, mapCoords, densify, fmtDist, fmtArea, fmtDMS, A, F };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MapGeo = api;
})(typeof self !== 'undefined' ? self : this);
