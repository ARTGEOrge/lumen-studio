'use strict';
/* Lumen Diagram — geometry helpers. Paths in this app only use absolute M L C Q Z commands,
   which keeps flattening, transforming and PDF output simple. */
(function (root) {
  const K = 0.5522847498;
  const f = n => { const r = Math.round(n * 100) / 100; return Object.is(r, -0) ? '0' : String(r); };
  const P = (x, y) => f(x) + ' ' + f(y);

  // ---- path builders (local coordinates) ----
  const rect = (x, y, w, h) => `M${P(x, y)} L${P(x + w, y)} L${P(x + w, y + h)} L${P(x, y + h)} Z`;
  function rrect(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2)); if (!r) return rect(x, y, w, h); const c = r * (1 - K);
    return `M${P(x + r, y)} L${P(x + w - r, y)} C${P(x + w - c, y)} ${P(x + w, y + c)} ${P(x + w, y + r)} L${P(x + w, y + h - r)} C${P(x + w, y + h - c)} ${P(x + w - c, y + h)} ${P(x + w - r, y + h)} L${P(x + r, y + h)} C${P(x + c, y + h)} ${P(x, y + h - c)} ${P(x, y + h - r)} L${P(x, y + r)} C${P(x, y + c)} ${P(x + c, y)} ${P(x + r, y)} Z`;
  }
  function ellipse(cx, cy, rx, ry) {
    const kx = rx * K, ky = ry * K;
    return `M${P(cx + rx, cy)} C${P(cx + rx, cy + ky)} ${P(cx + kx, cy + ry)} ${P(cx, cy + ry)} C${P(cx - kx, cy + ry)} ${P(cx - rx, cy + ky)} ${P(cx - rx, cy)} C${P(cx - rx, cy - ky)} ${P(cx - kx, cy - ry)} ${P(cx, cy - ry)} C${P(cx + kx, cy - ry)} ${P(cx + rx, cy - ky)} ${P(cx + rx, cy)} Z`;
  }
  const poly = (pts, close = true) => pts.map((p, i) => (i ? 'L' : 'M') + P(p[0], p[1])).join(' ') + (close ? ' Z' : '');
  // elliptical arc from angle a0 to a1 (radians, y down) as C segments; first point is a line-to unless move
  function arc(cx, cy, rx, ry, a0, a1, move) {
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2) - 1e-9)), da = (a1 - a0) / n, k = 4 / 3 * Math.tan(da / 4);
    let s = (move ? 'M' : 'L') + P(cx + rx * Math.cos(a0), cy + ry * Math.sin(a0));
    for (let i = 0; i < n; i++) {
      const t0 = a0 + i * da, t1 = t0 + da, c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      s += ` C${P(cx + rx * (c0 - k * s0), cy + ry * (s0 + k * c0))} ${P(cx + rx * (c1 + k * s1), cy + ry * (s1 - k * c1))} ${P(cx + rx * c1, cy + ry * s1)}`;
    }
    return s;
  }

  // ---- path parsing ----
  function parse(d) {
    const out = [], re = /([MLCQZ])([^MLCQZ]*)/gi; let m;
    while ((m = re.exec(d))) {
      const nums = m[2].trim() ? m[2].trim().split(/[\s,]+/).map(Number) : [];
      out.push({ c: m[1].toUpperCase(), n: nums });
    }
    return out;
  }
  // apply fn([x,y]) → [x,y] to every coordinate
  function transform(d, fn) {
    return parse(d).map(s => {
      if (s.c === 'Z') return 'Z';
      const parts = []; for (let i = 0; i + 1 < s.n.length; i += 2) { const p = fn(s.n[i], s.n[i + 1]); parts.push(P(p[0], p[1])); }
      return s.c + parts.join(' ');
    }).join(' ');
  }
  // flatten to polylines: [[{x,y},...], ...] with closed flag
  function flatten(d, seg = 10) {
    const subs = []; let cur = null, x = 0, y = 0, sx = 0, sy = 0;
    for (const s of parse(d)) {
      const n = s.n;
      if (s.c === 'M') { cur = { pts: [{ x: n[0], y: n[1] }], closed: false }; subs.push(cur); x = sx = n[0]; y = sy = n[1]; }
      else if (s.c === 'L') { for (let i = 0; i + 1 < n.length; i += 2) { x = n[i]; y = n[i + 1]; cur.pts.push({ x, y }); } }
      else if (s.c === 'C') {
        for (let j = 0; j + 5 < n.length; j += 6) {
          const [x1, y1, x2, y2, x3, y3] = n.slice(j, j + 6);
          for (let i = 1; i <= seg; i++) { const t = i / seg, u = 1 - t; cur.pts.push({ x: u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, y: u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3 }); }
          x = x3; y = y3;
        }
      } else if (s.c === 'Q') {
        for (let j = 0; j + 3 < n.length; j += 4) {
          const [x1, y1, x2, y2] = n.slice(j, j + 4);
          for (let i = 1; i <= seg; i++) { const t = i / seg, u = 1 - t; cur.pts.push({ x: u * u * x + 2 * u * t * x1 + t * t * x2, y: u * u * y + 2 * u * t * y1 + t * t * y2 }); }
          x = x2; y = y2;
        }
      } else if (s.c === 'Z' && cur) { cur.closed = true; x = sx; y = sy; }
    }
    return subs;
  }

  // ---- basic vector ops ----
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function rotPt(x, y, cx, cy, deg) {
    if (!deg) return [x, y]; const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), dx = x - cx, dy = y - cy;
    return [cx + dx * c - dy * s, cy + dx * s + dy * c];
  }
  function bboxPts(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { if (p.x < x0) x0 = p.x; if (p.y < y0) y0 = p.y; if (p.x > x1) x1 = p.x; if (p.y > y1) y1 = p.y; }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  function unionBox(a, b) {
    if (!a) return b ? { ...b } : null; if (!b) return { ...a };
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
  }
  const boxHit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const inBox = (p, b, m = 0) => p.x >= b.x - m && p.x <= b.x + b.w + m && p.y >= b.y - m && p.y <= b.y + b.h + m;
  // segment p→q vs segment a→b intersection: returns t along p→q or null
  function segX(p, q, a, b) {
    const rx = q.x - p.x, ry = q.y - p.y, sx = b.x - a.x, sy = b.y - a.y, den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((a.x - p.x) * sy - (a.y - p.y) * sx) / den, u = ((a.x - p.x) * ry - (a.y - p.y) * rx) / den;
    return u >= -1e-9 && u <= 1 + 1e-9 ? t : null;
  }
  // ray from c through p; intersect polygon rings; returns farthest hit point along the ray (t>0)
  function rayHit(rings, c, p) {
    const q = { x: c.x + (p.x - c.x) * 1e4, y: c.y + (p.y - c.y) * 1e4 };
    let best = -1;
    for (const r of rings) {
      const pts = r.pts, n = pts.length;
      for (let i = 0; i < n - (r.closed ? 0 : 1); i++) {
        const a = pts[i], b = pts[(i + 1) % n], t = segX(c, q, a, b);
        if (t != null && t > 1e-9 && t > best) best = t;
      }
    }
    return best < 0 ? null : { x: c.x + (q.x - c.x) * best, y: c.y + (q.y - c.y) * best };
  }
  function pointInRings(rings, p) {
    let inside = false;
    for (const r of rings) {
      if (!r.closed) continue; const pts = r.pts;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[i], b = pts[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
      }
    }
    return inside;
  }
  function distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy;
    let t = l ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  }
  function polyLen(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]); return s; }
  // point at fraction t (0..1) along polyline, with segment direction
  function pointAt(pts, t) {
    const L = polyLen(pts); if (!L) return { x: pts[0].x, y: pts[0].y, dx: 1, dy: 0 };
    let want = Math.max(0, Math.min(1, t)) * L;
    for (let i = 1; i < pts.length; i++) {
      const d = dist(pts[i - 1], pts[i]);
      if (want <= d || i === pts.length - 1) { const u = d ? Math.min(1, want / d) : 0; return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * u, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * u, dx: (pts[i].x - pts[i - 1].x) / (d || 1), dy: (pts[i].y - pts[i - 1].y) / (d || 1) }; }
      want -= d;
    }
    return { ...pts[pts.length - 1], dx: 1, dy: 0 };
  }
  // nearest fraction along polyline for point p
  function nearestT(pts, p) {
    const L = polyLen(pts) || 1; let acc = 0, best = Infinity, bt = 0.5;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], d = dist(a, b), dx = b.x - a.x, dy = b.y - a.y, l = d * d;
      let u = l ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l : 0; u = Math.max(0, Math.min(1, u));
      const dd = Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy);
      if (dd < best) { best = dd; bt = (acc + u * d) / L; }
      acc += d;
    }
    return { t: bt, d: best };
  }
  function simplify(pts, eps = 0.5) {
    const out = [];
    for (const p of pts) {
      if (out.length && Math.abs(out[out.length - 1].x - p.x) < eps && Math.abs(out[out.length - 1].y - p.y) < eps) continue;
      out.push({ x: p.x, y: p.y });
      while (out.length >= 3) {
        const a = out[out.length - 3], b = out[out.length - 2], c = out[out.length - 1];
        const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
        const dot = (b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y);
        if (Math.abs(cross) < eps * Math.max(1, dist(a, c)) && dot >= 0) out.splice(out.length - 2, 1); else break;
      }
    }
    return out;
  }

  const api = { K, f, P, rect, rrect, ellipse, poly, arc, parse, transform, flatten, dist, rotPt, bboxPts, unionBox, boxHit, inBox, segX, rayHit, pointInRings, distToSeg, polyLen, pointAt, nearestT, simplify };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DiaGeom = api;
})(typeof self !== 'undefined' ? self : this);
