// Lumen Draft — 2-D geometry kernel: primitives, intersections, trim/extend/offset/fillet/chamfer,
// affine transforms, areas and hatch boundary detection. Works in the browser (window.LDGeom) and in Node.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(); else root.LDGeom = factory(); })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const TAU = Math.PI * 2, EPS = 1e-7;
  const hyp = Math.hypot;
  const normA = a => { a %= TAU; return a < 0 ? a + TAU : a; };
  const ccw = (from, to) => normA(to - from);                // CCW sweep from angle `from` to `to`, [0, 2π)
  const cross = (ax, ay, bx, by) => ax * by - ay * bx;
  const ang = (x, y) => Math.atan2(y, x);
  const dist = (a, b) => hyp(b[0] - a[0], b[1] - a[1]);

  /* ---------------- primitives ----------------
     L: {t:'L', x1,y1,x2,y2}           A: {t:'A', cx,cy,r,a1,sw}  (sw > 0, CCW; sw = 2π for a full circle) */
  const L = (x1, y1, x2, y2) => ({ t: 'L', x1, y1, x2, y2 });
  const A = (cx, cy, r, a1, sw) => ({ t: 'A', cx, cy, r, a1: normA(a1), sw });
  const arcSweep = (a1, a2) => { const s = ccw(a1, a2); return s < 1e-12 ? TAU : s; };

  // bulge segment p→q (b = tan(θ/4), θ signed sweep) → {cx,cy,r,a0,th}
  function bulgeArc(p, q, b) {
    const th = 4 * Math.atan(b), dx = q[0] - p[0], dy = q[1] - p[1], c = hyp(dx, dy);
    if (c < 1e-12 || Math.abs(b) < 1e-12) return null;
    const h = (c / 2) / Math.tan(th / 2), mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
    const cx = mx - dy / c * h, cy = my + dx / c * h, r = hyp(p[0] - cx, p[1] - cy);
    return { cx, cy, r, a0: ang(p[0] - cx, p[1] - cy), th };
  }
  const bulgeOf = th => Math.tan(th / 4);

  // pline segments: [{p, q, b, arc|null}]
  function plSegs(e) {
    const P = e.pts, n = P.length, out = [];
    const m = e.closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const p = P[i], q = P[(i + 1) % n], b = p[2] || 0;
      out.push({ p, q, b, arc: b ? bulgeArc(p, q, b) : null });
    }
    return out;
  }
  function segPrim(s) {
    if (!s.arc) return L(s.p[0], s.p[1], s.q[0], s.q[1]);
    const a = s.arc; return a.th > 0 ? A(a.cx, a.cy, a.r, a.a0, a.th) : A(a.cx, a.cy, a.r, a.a0 + a.th, -a.th);
  }
  // primitives of a geometric entity (line, arc, circle, pline, point→none)
  function primsOf(e) {
    switch (e.type) {
      case 'line': return [L(e.x1, e.y1, e.x2, e.y2)];
      case 'circle': return [A(e.cx, e.cy, e.r, 0, TAU)];
      case 'arc': return [A(e.cx, e.cy, e.r, e.a1, arcSweep(e.a1, e.a2))];
      case 'pline': return plSegs(e).filter(s => hyp(s.q[0] - s.p[0], s.q[1] - s.p[1]) > 1e-12).map(segPrim);
      default: return [];
    }
  }
  const onArc = (p, a, tol = 1e-9) => p.sw >= TAU - 1e-12 || ccw(p.a1, a) <= p.sw + tol / Math.max(p.r, 1e-9) + 1e-12;
  function primPoint(p, t) {
    if (p.t === 'L') return [p.x1 + (p.x2 - p.x1) * t, p.y1 + (p.y2 - p.y1) * t];
    const a = p.a1 + p.sw * t; return [p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a)];
  }
  const primStart = p => primPoint(p, 0), primEnd = p => primPoint(p, 1);
  const primLen = p => p.t === 'L' ? hyp(p.x2 - p.x1, p.y2 - p.y1) : p.r * p.sw;
  function primNearest(p, x, y) {
    if (p.t === 'L') {
      const dx = p.x2 - p.x1, dy = p.y2 - p.y1, l2 = dx * dx + dy * dy;
      let t = l2 ? ((x - p.x1) * dx + (y - p.y1) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
      const px = p.x1 + dx * t, py = p.y1 + dy * t; return { x: px, y: py, t, d: hyp(x - px, y - py) };
    }
    const a = ang(x - p.cx, y - p.cy);
    if (onArc(p, a)) { const px = p.cx + p.r * Math.cos(a), py = p.cy + p.r * Math.sin(a); return { x: px, y: py, t: p.sw >= TAU - 1e-12 ? normA(a - p.a1) / TAU : ccw(p.a1, a) / p.sw, d: hyp(x - px, y - py) }; }
    const s = primStart(p), e = primEnd(p), ds = hyp(x - s[0], y - s[1]), de = hyp(x - e[0], y - e[1]);
    return ds < de ? { x: s[0], y: s[1], t: 0, d: ds } : { x: e[0], y: e[1], t: 1, d: de };
  }
  function primBBox(p, bb = [Infinity, Infinity, -Infinity, -Infinity]) {
    const add = (x, y) => { if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y; };
    if (p.t === 'L') { add(p.x1, p.y1); add(p.x2, p.y2); return bb; }
    const s = primStart(p), e = primEnd(p); add(s[0], s[1]); add(e[0], e[1]);
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; if (onArc(p, a, 0)) add(p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a)); }
    return bb;
  }
  const bbOverlap = (a, b, m = 1e-6) => a[0] <= b[2] + m && b[0] <= a[2] + m && a[1] <= b[3] + m && b[1] <= a[3] + m;

  /* ---------------- intersections ----------------
     interPrims(p, q, extP, extQ) → [[x,y], ...]; ext = treat the carrier as infinite line / full circle */
  function lineCircle(x1, y1, x2, y2, cx, cy, r) {
    const dx = x2 - x1, dy = y2 - y1, fx = x1 - cx, fy = y1 - cy;
    const a = dx * dx + dy * dy, b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
    if (a < 1e-24) return [];
    let disc = b * b - 4 * a * c;
    const tolD = 1e-10 * Math.max(b * b, Math.abs(4 * a * c), 1e-30);
    if (disc < -tolD) return [];
    if (disc < tolD) return [-b / (2 * a)];
    disc = Math.sqrt(disc); return [(-b - disc) / (2 * a), (-b + disc) / (2 * a)];
  }
  function circleCircle(c1x, c1y, r1, c2x, c2y, r2) {
    const dx = c2x - c1x, dy = c2y - c1y, d = hyp(dx, dy);
    if (d < 1e-12) return [];
    const tol = 1e-9 * Math.max(r1, r2, 1);
    if (d > r1 + r2 + tol || d < Math.abs(r1 - r2) - tol) return [];
    const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h2 = r1 * r1 - a * a, h = h2 > 0 ? Math.sqrt(h2) : 0;
    const mx = c1x + dx * a / d, my = c1y + dy * a / d;
    if (h < tol) return [[mx, my]];
    return [[mx - dy * h / d, my + dx * h / d], [mx + dy * h / d, my - dx * h / d]];
  }
  function interPrims(p, q, extP = false, extQ = false) {
    if (p.t === 'A' && q.t === 'L') return interPrims(q, p, extQ, extP);
    const out = [];
    const tl = 1e-9;
    if (p.t === 'L' && q.t === 'L') {
      const d1x = p.x2 - p.x1, d1y = p.y2 - p.y1, d2x = q.x2 - q.x1, d2y = q.y2 - q.y1;
      const den = cross(d1x, d1y, d2x, d2y), l1 = hyp(d1x, d1y), l2 = hyp(d2x, d2y);
      if (Math.abs(den) < 1e-12 * l1 * l2 || !l1 || !l2) return out;
      const ex = q.x1 - p.x1, ey = q.y1 - p.y1, t = cross(ex, ey, d2x, d2y) / den, u = cross(ex, ey, d1x, d1y) / den;
      const tp = tl + EPS / l1, tq = tl + EPS / l2;
      if ((extP || (t >= -tp && t <= 1 + tp)) && (extQ || (u >= -tq && u <= 1 + tq))) out.push([p.x1 + d1x * t, p.y1 + d1y * t]);
      return out;
    }
    if (p.t === 'L') {
      const l = hyp(p.x2 - p.x1, p.y2 - p.y1), tp = tl + EPS / Math.max(l, 1e-12);
      for (const t of lineCircle(p.x1, p.y1, p.x2, p.y2, q.cx, q.cy, q.r)) {
        if (!extP && (t < -tp || t > 1 + tp)) continue;
        const x = p.x1 + (p.x2 - p.x1) * t, y = p.y1 + (p.y2 - p.y1) * t;
        if (extQ || onArc(q, ang(x - q.cx, y - q.cy), EPS)) out.push([x, y]);
      }
      return out;
    }
    for (const pt of circleCircle(p.cx, p.cy, p.r, q.cx, q.cy, q.r)) {
      if ((extP || onArc(p, ang(pt[0] - p.cx, pt[1] - p.cy), EPS)) && (extQ || onArc(q, ang(pt[0] - q.cx, pt[1] - q.cy), EPS))) out.push(pt);
    }
    return out;
  }
  function uniqPts(pts, tol = 1e-7) {
    const out = [];
    for (const p of pts) if (!out.some(o => Math.abs(o[0] - p[0]) < tol && Math.abs(o[1] - p[1]) < tol)) out.push(p);
    return out;
  }
  // all intersections between two entities (bounded)
  function interEnts(a, b) {
    const pa = primsOf(a), pb = primsOf(b), out = [];
    for (const p of pa) { const bp = primBBox(p); for (const q of pb) if (bbOverlap(bp, primBBox(q))) out.push(...interPrims(p, q)); }
    return uniqPts(out);
  }

  /* ---------------- parametrisation of curves (for trim / break) ----------------
     line: s∈[0,1]; arc: s∈[0,sweep] (angle offset from a1); circle: s∈[0,2π) periodic;
     pline: s∈[0,nseg], integer part = segment index. */
  function curveRange(e) {
    switch (e.type) {
      case 'line': return { end: 1, closed: false };
      case 'arc': return { end: arcSweep(e.a1, e.a2), closed: false };
      case 'circle': return { end: TAU, closed: true };
      case 'pline': return { end: e.closed ? e.pts.length : e.pts.length - 1, closed: !!e.closed };
    }
    return null;
  }
  function segLocalT(s, x, y) {
    if (!s.arc) { const dx = s.q[0] - s.p[0], dy = s.q[1] - s.p[1], l2 = dx * dx + dy * dy; return l2 ? Math.max(0, Math.min(1, ((x - s.p[0]) * dx + (y - s.p[1]) * dy) / l2)) : 0; }
    const a = s.arc, aa = ang(x - a.cx, y - a.cy);
    let d = a.th > 0 ? ccw(a.a0, aa) : ccw(aa, a.a0); const sw = Math.abs(a.th);
    if (d > sw) d = (d - sw < TAU - d) ? sw : 0;
    return d / sw;
  }
  function segPoint(s, t) {
    if (!s.arc) return [s.p[0] + (s.q[0] - s.p[0]) * t, s.p[1] + (s.q[1] - s.p[1]) * t];
    const a = s.arc, aa = a.a0 + a.th * t; return [a.cx + a.r * Math.cos(aa), a.cy + a.r * Math.sin(aa)];
  }
  function segDist(s, x, y) { const p = segPoint(s, segLocalT(s, x, y)); return hyp(p[0] - x, p[1] - y); }
  function paramOf(e, x, y) {
    switch (e.type) {
      case 'line': { const dx = e.x2 - e.x1, dy = e.y2 - e.y1, l2 = dx * dx + dy * dy; return l2 ? ((x - e.x1) * dx + (y - e.y1) * dy) / l2 : 0; }
      case 'arc': { const sw = arcSweep(e.a1, e.a2); let d = ccw(e.a1, ang(x - e.cx, y - e.cy)); if (d > sw + 1e-9) d = (d - sw < TAU - d) ? sw : 0; return Math.min(d, sw); }
      case 'circle': return normA(ang(x - e.cx, y - e.cy));
      case 'pline': {
        const segs = plSegs(e); let best = 0, bd = Infinity;
        segs.forEach((s, i) => { const d = segDist(s, x, y); if (d < bd - 1e-12) { bd = d; best = i + segLocalT(s, x, y); } });
        return best;
      }
    }
    return 0;
  }
  function pointAt(e, s) {
    switch (e.type) {
      case 'line': return [e.x1 + (e.x2 - e.x1) * s, e.y1 + (e.y2 - e.y1) * s];
      case 'arc': return [e.cx + e.r * Math.cos(e.a1 + s), e.cy + e.r * Math.sin(e.a1 + s)];
      case 'circle': return [e.cx + e.r * Math.cos(s), e.cy + e.r * Math.sin(s)];
      case 'pline': { const segs = plSegs(e), n = segs.length; let i = Math.floor(s); if (i >= n) i = n - 1; if (i < 0) i = 0; return segPoint(segs[i], s - i); }
    }
  }
  const strip = e => { const o = {}; for (const k of ['layer', 'color', 'lt', 'lw', 'lts']) if (e[k] !== undefined) o[k] = e[k]; return o; };
  // piece of a curve between params s0 < s1 (for closed curves s1 may exceed the period: wraps)
  function piece(e, s0, s1) {
    const base = strip(e);
    switch (e.type) {
      case 'line': { const a = pointAt(e, s0), b = pointAt(e, s1); return { ...base, type: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1] }; }
      case 'arc': return { ...base, type: 'arc', cx: e.cx, cy: e.cy, r: e.r, a1: normA(e.a1 + s0), a2: normA(e.a1 + s1) };
      case 'circle': return { ...base, type: 'arc', cx: e.cx, cy: e.cy, r: e.r, a1: normA(s0), a2: normA(s1) };
      case 'pline': {
        const segs = plSegs(e), n = segs.length, pts = [];
        for (let i = Math.floor(s0); i < s1 - 1e-12; i++) {
          const s = segs[((i % n) + n) % n], t0 = Math.max(s0 - i, 0), t1 = Math.min(s1 - i, 1);
          if (t1 - t0 < 1e-12) continue;
          const p = segPoint(s, t0);
          pts.push([p[0], p[1], s.arc ? bulgeOf(s.arc.th * (t1 - t0)) : 0]);
          if (s1 - i <= 1 + 1e-12) { const q = segPoint(s, t1); pts.push([q[0], q[1], 0]); }
        }
        if (pts.length < 2) return null;
        const o = { ...base, type: 'pline', pts, closed: false }; if (e.w) o.w = e.w; return o;
      }
    }
    return null;
  }

  /* ---------------- trim / break / extend ---------------- */
  // cut points (on the entity) and pick point → replacement entities ([] = delete). null if nothing to do.
  function trimAt(e, cuts, pick) {
    const R = curveRange(e); if (!R) return null;
    const E = R.end, tol = 1e-7 * Math.max(1, E);
    let ps = cuts.map(c => paramOf(e, c[0], c[1]));
    if (R.closed) ps = ps.map(s => ((s % E) + E) % E);
    ps = ps.filter(s => R.closed || (s > tol && s < E - tol)).sort((a, b) => a - b);
    ps = ps.filter((s, i) => i === 0 || s - ps[i - 1] > tol);
    if (R.closed && ps.length > 1 && ps[0] + E - ps[ps.length - 1] < tol) ps.pop();
    const pp = paramOf(e, pick[0], pick[1]);
    if (!ps.length) return [];
    if (!R.closed) {
      let lo = 0, hi = E;
      for (const s of ps) { if (s < pp) lo = s; else { hi = s; break; } }
      const out = [];
      if (lo > tol) out.push(piece(e, 0, lo));
      if (hi < E - tol) out.push(piece(e, hi, E));
      return out.filter(Boolean);
    }
    if (ps.length < 2) return null;
    let lo = ps[ps.length - 1] - E, hi = ps[0];
    const p = ((pp % E) + E) % E;
    for (let i = 0; i < ps.length; i++) {
      const a = ps[i], b = i + 1 < ps.length ? ps[i + 1] : ps[0] + E;
      if ((p >= a && p < b) || (p + E >= a && p + E < b)) { lo = a; hi = b; break; }
    }
    // keep from hi round to lo (+E)
    let s0 = hi, s1 = lo + E; if (s0 >= E) { s0 -= E; s1 -= E; }
    const pc = piece(e, s0, s1);
    if (e.type === 'pline' && pc) {
      // closed pline: the kept piece starts at a cut — fine as an open pline
    }
    return pc ? [pc] : [];
  }
  // quick-trim: every other entity is a cutting edge
  function trim(e, others, pick) {
    const cuts = [];
    for (const o of others) if (o !== e) cuts.push(...interEnts(e, o));
    if (e.type === 'pline') cuts.push(...selfInter(e));
    return trimAt(e, uniqPts(cuts), pick);
  }
  function selfInter(e) {
    const segs = plSegs(e).map(segPrim), out = [], n = segs.length;
    for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
      if (e.closed && i === 0 && j === n - 1) continue;
      out.push(...interPrims(segs[i], segs[j]));
    }
    return out;
  }
  // break e between two points (BREAK command)
  function breakAt(e, p1, p2) {
    const R = curveRange(e); if (!R) return null;
    let a = paramOf(e, p1[0], p1[1]), b = paramOf(e, p2[0], p2[1]);
    if (!R.closed) { if (a > b) [a, b] = [b, a]; return [a > 1e-9 ? piece(e, 0, a) : null, b < R.end - 1e-9 ? piece(e, b, R.end) : null].filter(Boolean); }
    // closed: remove from a to b (CCW / forward); keep b→a
    let s0 = b, s1 = a; if (s1 <= s0) s1 += R.end;
    return [piece(e, s0, s1)].filter(Boolean);
  }
  function boundaryPrims(bounds, self) {
    const out = []; for (const o of bounds) if (o !== self) out.push(...primsOf(o)); return out;
  }
  // extend the end of e nearest to pick until it meets a boundary entity. → new entity or null
  function extend(e, bounds, pick) {
    const bp = bounds.length && bounds[0].t ? bounds : boundaryPrims(bounds, e);   // entities or ready-made primitives
    const extLine = (x1, y1, x2, y2) => {         // extend from (x2,y2) beyond, direction x1→x2; returns new end or null
      const ray = L(x1, y1, x2, y2), len = hyp(x2 - x1, y2 - y1); let best = Infinity;
      for (const q of bp) for (const p of interPrims(ray, q, true, false)) {
        const t = ((p[0] - x1) * (x2 - x1) + (p[1] - y1) * (y2 - y1)) / (len * len);
        if (t > 1 + 1e-7 / Math.max(len, 1e-9) && t < best) best = t;
      }
      return best < Infinity ? [x1 + (x2 - x1) * best, y1 + (y2 - y1) * best] : null;
    };
    const extArc = (cx, cy, r, a1, a2, atEnd) => {  // returns delta angle or null
      const sw = arcSweep(a1, a2), full = A(cx, cy, r, 0, TAU); let best = Infinity;
      for (const q of bp) for (const p of interPrims(full, q, false, false)) {
        const a = ang(p[0] - cx, p[1] - cy), d = atEnd ? ccw(a2, a) : ccw(a, a1);
        if (d > 1e-9 && d < TAU - sw - 1e-9 && d < best) best = d;
      }
      return best < Infinity ? best : null;
    };
    if (e.type === 'line') {
      const atEnd = hyp(pick[0] - e.x2, pick[1] - e.y2) < hyp(pick[0] - e.x1, pick[1] - e.y1);
      const p = atEnd ? extLine(e.x1, e.y1, e.x2, e.y2) : extLine(e.x2, e.y2, e.x1, e.y1);
      if (!p) return null;
      return atEnd ? { ...e, x2: p[0], y2: p[1] } : { ...e, x1: p[0], y1: p[1] };
    }
    if (e.type === 'arc') {
      const s = pointAt(e, 0), en = [e.cx + e.r * Math.cos(e.a2), e.cy + e.r * Math.sin(e.a2)];
      const atEnd = dist(pick, en) < dist(pick, s), d = extArc(e.cx, e.cy, e.r, e.a1, e.a2, atEnd);
      if (d == null) return null;
      return atEnd ? { ...e, a2: normA(e.a2 + d) } : { ...e, a1: normA(e.a1 - d) };
    }
    if (e.type === 'pline' && !e.closed && e.pts.length >= 2) {
      const P = e.pts.map(p => p.slice()), n = P.length;
      const atEnd = dist(pick, P[n - 1]) < dist(pick, P[0]);
      if (atEnd) {
        const p = P[n - 2], q = P[n - 1], b = p[2] || 0;
        if (!b) { const np = extLine(p[0], p[1], q[0], q[1]); if (!np) return null; P[n - 1] = [np[0], np[1], 0]; }
        else {
          const a = bulgeArc(p, q, b), qa = ang(q[0] - a.cx, q[1] - a.cy), pa = ang(p[0] - a.cx, p[1] - a.cy);
          const d = a.th > 0 ? extArc(a.cx, a.cy, a.r, pa, qa, true) : extArc(a.cx, a.cy, a.r, qa, pa, false);
          if (d == null) return null;
          const na = a.th > 0 ? qa + d : qa - d; P[n - 1] = [a.cx + a.r * Math.cos(na), a.cy + a.r * Math.sin(na), 0]; P[n - 2][2] = bulgeOf(a.th > 0 ? a.th + d : a.th - d);
        }
      } else {
        const p = P[1], q = P[0], b = q[2] || 0;   // segment q→p, extend q backwards
        if (!b) { const np = extLine(p[0], p[1], q[0], q[1]); if (!np) return null; P[0] = [np[0], np[1], 0]; }
        else {
          const a = bulgeArc(q, p, b), qa = ang(q[0] - a.cx, q[1] - a.cy), pa = ang(p[0] - a.cx, p[1] - a.cy);
          const d = a.th > 0 ? extArc(a.cx, a.cy, a.r, qa, pa, false) : extArc(a.cx, a.cy, a.r, pa, qa, true);
          if (d == null) return null;
          const na = a.th > 0 ? qa - d : qa + d; P[0] = [a.cx + a.r * Math.cos(na), a.cy + a.r * Math.sin(na), bulgeOf(a.th > 0 ? a.th + d : a.th - d)];
        }
      }
      return { ...e, pts: P };
    }
    return null;
  }

  /* ---------------- offset ---------------- */
  function offsetPline(e, delta) {   // delta > 0 → left of travel direction
    const segs = plSegs(e).filter(s => hyp(s.q[0] - s.p[0], s.q[1] - s.p[1]) > 1e-12);
    const off = [];
    for (const s of segs) {
      if (!s.arc) {
        const dx = s.q[0] - s.p[0], dy = s.q[1] - s.p[1], l = hyp(dx, dy), nx = -dy / l * delta, ny = dx / l * delta;
        off.push({ line: true, p: [s.p[0] + nx, s.p[1] + ny], q: [s.q[0] + nx, s.q[1] + ny] });
      } else {
        const a = s.arc, r = a.th > 0 ? a.r - delta : a.r + delta;
        if (r <= 1e-9) continue;
        const pa = a.a0, qa = a.a0 + a.th;
        off.push({ line: false, cx: a.cx, cy: a.cy, r, dir: Math.sign(a.th), th: a.th, p: [a.cx + r * Math.cos(pa), a.cy + r * Math.sin(pa)], q: [a.cx + r * Math.cos(qa), a.cy + r * Math.sin(qa)] });
      }
    }
    if (!off.length) return null;
    const carrier = o => o.line ? L(o.p[0], o.p[1], o.q[0], o.q[1]) : A(o.cx, o.cy, o.r, 0, TAU);
    const join = (A1, B1) => {
      if (dist(A1.q, B1.p) < 1e-9) return null;
      const xs = interPrims(carrier(A1), carrier(B1), true, true);
      if (!xs.length) return 'gap';
      const m = [(A1.q[0] + B1.p[0]) / 2, (A1.q[1] + B1.p[1]) / 2];
      xs.sort((u, v) => dist(u, m) - dist(v, m)); return xs[0];
    };
    const n = off.length, out = [];
    const closed = !!e.closed;
    const joins = [];
    for (let i = 0; i < (closed ? n : n - 1); i++) joins.push(join(off[i], off[(i + 1) % n]));
    joins.forEach((j, i) => { if (j && j !== 'gap') { off[i].q = j; off[(i + 1) % n].p = j; } });
    const bul = o => {
      if (o.line) return 0;
      const pa = ang(o.p[0] - o.cx, o.p[1] - o.cy), qa = ang(o.q[0] - o.cx, o.q[1] - o.cy);
      let th = o.dir > 0 ? ccw(pa, qa) : -ccw(qa, pa);
      if (Math.abs(th) < 1e-9 && Math.abs(o.th) > Math.PI) th = o.dir * TAU;
      return bulgeOf(th);
    };
    off.forEach((o, i) => {
      out.push([o.p[0], o.p[1], bul(o)]);
      const j = joins[i];
      if (j === 'gap') out.push([o.q[0], o.q[1], 0]);
    });
    if (!closed) { const last = off[n - 1]; out.push([last.q[0], last.q[1], 0]); }
    const r = { ...strip(e), type: 'pline', pts: out, closed }; if (e.w) r.w = e.w; return r;
  }
  function sideOfPline(e, pt) {
    const segs = plSegs(e); let best = null, bd = Infinity;
    for (const s of segs) { const d = segDist(s, pt[0], pt[1]); if (d < bd) { bd = d; best = s; } }
    if (!best) return 1;
    const t = segLocalT(best, pt[0], pt[1]), p = segPoint(best, t);
    let tx, ty;
    if (!best.arc) { tx = best.q[0] - best.p[0]; ty = best.q[1] - best.p[1]; }
    else { const a = best.arc, aa = a.a0 + a.th * t; tx = -Math.sin(aa) * Math.sign(a.th); ty = Math.cos(aa) * Math.sign(a.th); }
    return cross(tx, ty, pt[0] - p[0], pt[1] - p[1]) >= 0 ? 1 : -1;
  }
  // offset entity by distance d towards the side of point pt
  function offset(e, d, pt) {
    switch (e.type) {
      case 'line': {
        const dx = e.x2 - e.x1, dy = e.y2 - e.y1, l = hyp(dx, dy); if (!l) return null;
        const s = cross(dx, dy, pt[0] - e.x1, pt[1] - e.y1) >= 0 ? 1 : -1, nx = -dy / l * d * s, ny = dx / l * d * s;
        return { ...e, x1: e.x1 + nx, y1: e.y1 + ny, x2: e.x2 + nx, y2: e.y2 + ny };
      }
      case 'circle': case 'arc': {
        const r = hyp(pt[0] - e.cx, pt[1] - e.cy) > e.r ? e.r + d : e.r - d; if (r <= 1e-9) return null; return { ...e, r };
      }
      case 'pline': return offsetPline(e, d * sideOfPline(e, pt));
    }
    return null;
  }
  // offset through a point: distance = nearest distance from the curve
  function offsetThrough(e, pt) {
    const ps = primsOf(e); let d = Infinity; for (const p of ps) d = Math.min(d, primNearest(p, pt[0], pt[1]).d);
    if (!(d > 1e-9)) return null; return offset(e, d, pt);
  }

  /* ---------------- fillet / chamfer of two lines ---------------- */
  function lineCorner(l1, pick1, l2, pick2) {
    const d1x = l1.x2 - l1.x1, d1y = l1.y2 - l1.y1, d2x = l2.x2 - l2.x1, d2y = l2.y2 - l2.y1;
    const den = cross(d1x, d1y, d2x, d2y); if (Math.abs(den) < 1e-12 * hyp(d1x, d1y) * hyp(d2x, d2y)) return null;
    const t = cross(l2.x1 - l1.x1, l2.y1 - l1.y1, d2x, d2y) / den, X = [l1.x1 + d1x * t, l1.y1 + d1y * t];
    const side = (l, pick, dx, dy) => {   // unit direction from X towards the kept part
      const len = hyp(dx, dy); let ux = dx / len, uy = dy / len;
      const s = (pick[0] - X[0]) * ux + (pick[1] - X[1]) * uy;
      if (Math.abs(s) < 1e-9) { const far = hyp(l.x1 - X[0], l.y1 - X[1]) > hyp(l.x2 - X[0], l.y2 - X[1]) ? [l.x1, l.y1] : [l.x2, l.y2]; if ((far[0] - X[0]) * ux + (far[1] - X[1]) * uy < 0) { ux = -ux; uy = -uy; } }
      else if (s < 0) { ux = -ux; uy = -uy; }
      // far endpoint along u
      const p1 = (l.x1 - X[0]) * ux + (l.y1 - X[1]) * uy, p2 = (l.x2 - X[0]) * ux + (l.y2 - X[1]) * uy;
      return { ux, uy, far: p1 > p2 ? [l.x1, l.y1] : [l.x2, l.y2], farD: Math.max(p1, p2) };
    };
    return { X, s1: side(l1, pick1, d1x, d1y), s2: side(l2, pick2, d2x, d2y) };
  }
  const mkLine = (base, a, b) => (hyp(b[0] - a[0], b[1] - a[1]) < 1e-9 ? null : { ...base, x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
  // → {a, b, arc} (a/b: replacement lines or null to delete) or {error}
  function filletLines(l1, pick1, l2, pick2, r) {
    const c = lineCorner(l1, pick1, l2, pick2); if (!c) return { error: 'Lines are parallel' };
    const { X, s1, s2 } = c;
    if (r <= 1e-12) return { a: mkLine(l1, s1.far, X), b: mkLine(l2, s2.far, X), arc: null };
    const cosT = s1.ux * s2.ux + s1.uy * s2.uy, th = Math.acos(Math.max(-1, Math.min(1, cosT)));
    if (th < 1e-9 || th > Math.PI - 1e-9) return { error: 'Lines are collinear' };
    const t = r / Math.tan(th / 2);
    if (t > s1.farD + 1e-9 || t > s2.farD + 1e-9) return { error: 'Radius is too large' };
    const T1 = [X[0] + s1.ux * t, X[1] + s1.uy * t], T2 = [X[0] + s2.ux * t, X[1] + s2.uy * t];
    let bx = s1.ux + s2.ux, by = s1.uy + s2.uy; const bl = hyp(bx, by); bx /= bl; by /= bl;
    const h = r / Math.sin(th / 2), C = [X[0] + bx * h, X[1] + by * h];
    let a1 = ang(T1[0] - C[0], T1[1] - C[1]), a2 = ang(T2[0] - C[0], T2[1] - C[1]);
    if (ccw(a1, a2) > Math.PI) [a1, a2] = [a2, a1];
    return { a: mkLine(l1, s1.far, T1), b: mkLine(l2, s2.far, T2), arc: { ...strip(l1), type: 'arc', cx: C[0], cy: C[1], r, a1: normA(a1), a2: normA(a2) }, T1, T2, C };
  }
  function chamferLines(l1, pick1, l2, pick2, d1, d2) {
    const c = lineCorner(l1, pick1, l2, pick2); if (!c) return { error: 'Lines are parallel' };
    const { X, s1, s2 } = c;
    if (d1 <= 1e-12 && d2 <= 1e-12) return { a: mkLine(l1, s1.far, X), b: mkLine(l2, s2.far, X), line: null };
    if (d1 > s1.farD + 1e-9 || d2 > s2.farD + 1e-9) return { error: 'Distance is too large' };
    const T1 = [X[0] + s1.ux * d1, X[1] + s1.uy * d1], T2 = [X[0] + s2.ux * d2, X[1] + s2.uy * d2];
    return { a: mkLine(l1, s1.far, T1), b: mkLine(l2, s2.far, T2), line: { ...strip(l1), type: 'line', x1: T1[0], y1: T1[1], x2: T2[0], y2: T2[1] } };
  }
  // fillet (r) or chamfer (d1,d2 when chamfer=true) every straight-straight vertex of a polyline
  function cornerPline(e, r, chamfer = false, d2 = r) {
    const P = e.pts, n = P.length, out = []; let count = 0;
    const closed = !!e.closed;
    for (let i = 0; i < n; i++) {
      const v = P[i];
      const hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
      const prev = P[(i - 1 + n) % n], next = P[(i + 1) % n];
      if (!hasPrev || !hasNext || (prev[2] || 0) || (v[2] || 0)) { out.push(v.slice()); continue; }
      const ux = prev[0] - v[0], uy = prev[1] - v[1], wx = next[0] - v[0], wy = next[1] - v[1];
      const lu = hyp(ux, uy), lw = hyp(wx, wy); if (lu < 1e-12 || lw < 1e-12) { out.push(v.slice()); continue; }
      const th = Math.acos(Math.max(-1, Math.min(1, (ux * wx + uy * wy) / (lu * lw))));
      if (th < 1e-6 || th > Math.PI - 1e-6) { out.push(v.slice()); continue; }
      const t1 = chamfer ? r : r / Math.tan(th / 2), t2 = chamfer ? d2 : t1;
      // each neighbouring segment may be consumed at most halfway when both of its ends are rounded
      const prevEnd = !closed && i - 1 === 0, nextEnd = !closed && i + 1 === n - 1;
      if (t1 > (prevEnd ? lu : lu / 2) + 1e-9 || t2 > (nextEnd ? lw : lw / 2) + 1e-9) { out.push(v.slice()); continue; }
      const T1 = [v[0] + ux / lu * t1, v[1] + uy / lu * t1], T2 = [v[0] + wx / lw * t2, v[1] + wy / lw * t2];
      const turn = cross(-ux, -uy, wx, wy);
      out.push([T1[0], T1[1], chamfer ? 0 : bulgeOf(Math.sign(turn) * (Math.PI - th))]);
      out.push([T2[0], T2[1], 0]); count++;
    }
    const o = { ...e, pts: out }; return { ent: o, count };
  }

  /* ---------------- affine transforms ----------------
     T = [a,b,c,d,e,f]:  x' = a·x + c·y + e,  y' = b·x + d·y + f */
  const Tmove = (dx, dy) => [1, 0, 0, 1, dx, dy];
  const Trot = (cx, cy, t) => { const c = Math.cos(t), s = Math.sin(t); return [c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy]; };
  const Tscale = (cx, cy, k) => [k, 0, 0, k, cx - k * cx, cy - k * cy];
  const Tmirror = (x1, y1, x2, y2) => { const p = ang(x2 - x1, y2 - y1), c = Math.cos(2 * p), s = Math.sin(2 * p); return [c, s, s, -c, x1 - c * x1 - s * y1, y1 - s * x1 + c * y1]; };
  const Tmul = (A2, B) => [A2[0] * B[0] + A2[2] * B[1], A2[1] * B[0] + A2[3] * B[1], A2[0] * B[2] + A2[2] * B[3], A2[1] * B[2] + A2[3] * B[3], A2[0] * B[4] + A2[2] * B[5] + A2[4], A2[1] * B[4] + A2[3] * B[5] + A2[5]]; // A∘B
  const Tpt = (T, x, y) => [T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]];
  const Tdir = (T, a) => ang(T[0] * Math.cos(a) + T[2] * Math.sin(a), T[1] * Math.cos(a) + T[3] * Math.sin(a));
  const Tdet = T => T[0] * T[3] - T[1] * T[2];
  // text metrics (Arial / Helvetica advance widths, 1/1000 em) — used for extents everywhere
  const HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
  const EM = 1 / 0.716;    // CAD text height = cap height; font size = h·EM
  function charW(ch) { const c = ch.charCodeAt(0); if (c >= 32 && c <= 126) return HW[c - 32]; if (ch === '°') return 400; if (ch === '±') return 584; if (ch === 'Ø' || ch === '⌀') return 778; return 556; }
  function textWidth(s, h) { let w = 0; for (const ch of String(s)) w += charW(ch); return w / 1000 * h * EM; }
  function transform(e, T) {
    const det = Tdet(T), k = Math.sqrt(Math.abs(det)), flip = det < 0, rot = Tdir(T, 0);
    const P = (x, y) => Tpt(T, x, y);
    switch (e.type) {
      case 'line': { const a = P(e.x1, e.y1), b = P(e.x2, e.y2); return { ...e, x1: a[0], y1: a[1], x2: b[0], y2: b[1] }; }
      case 'point': { const a = P(e.x, e.y); return { ...e, x: a[0], y: a[1] }; }
      case 'solid': return { ...e, pts: e.pts.map(p => P(p[0], p[1])) };
      case 'circle': { const c = P(e.cx, e.cy); return { ...e, cx: c[0], cy: c[1], r: e.r * k }; }
      case 'arc': { const c = P(e.cx, e.cy); let a1 = Tdir(T, e.a1), a2 = Tdir(T, e.a2); if (flip) [a1, a2] = [a2, a1]; return { ...e, cx: c[0], cy: c[1], r: e.r * k, a1: normA(a1), a2: normA(a2) }; }
      case 'pline': return { ...e, pts: e.pts.map(p => { const q = P(p[0], p[1]); return [q[0], q[1], flip ? -(p[2] || 0) : (p[2] || 0)]; }), w: e.w ? e.w * k : e.w };
      case 'hatch': return { ...e, loops: e.loops.map(l => ({ ...l, pts: l.pts.map(p => { const q = P(p[0], p[1]); return [q[0], q[1], flip ? -(p[2] || 0) : (p[2] || 0)]; }) })), ang: normA((e.ang || 0) + (flip ? -rot : rot)), sc: (e.sc || 1) * k };
      case 'text': case 'mtext': {
        let r = Tdir(T, e.rot || 0);
        if (!flip) { const q = P(e.x, e.y); return { ...e, x: q[0], y: q[1], rot: normA(r), h: e.h * k, w: e.w != null ? e.w * k : e.w }; }
        // mirrored: keep text readable (MIRRTEXT = 0) — mirror its centre and pick the readable direction
        const c = textCenter(e), cq = P(c[0], c[1]), r2 = r + Math.PI;
        r = Math.cos(r - (e.rot || 0)) >= Math.cos(r2 - (e.rot || 0)) ? r : r2;
        const ne = { ...e, rot: normA(r), h: e.h * k, w: e.w != null ? e.w * k : e.w }, nc = textCenter({ ...ne, x: 0, y: 0 });
        ne.x = cq[0] - nc[0]; ne.y = cq[1] - nc[1]; return ne;
      }
      case 'insert': {
        const q = P(e.x, e.y);
        if (!flip) return { ...e, x: q[0], y: q[1], rot: normA((e.rot || 0) + rot), sx: (e.sx ?? 1) * k, sy: (e.sy ?? 1) * k };
        // reflection = Rot(2φ)·FlipY → rot' = 2φ − rot, sy' = −sy
        const phi2 = ang(T[0], T[1]);
        return { ...e, x: q[0], y: q[1], rot: normA(phi2 - (e.rot || 0)), sx: (e.sx ?? 1) * k, sy: -(e.sy ?? 1) * k };
      }
      case 'dim': {
        const o = { ...e }; for (const key of ['p1', 'p2', 'p', 'c']) if (e[key]) o[key] = P(e[key][0], e[key][1]);
        if (e.ang != null) o.ang = normA(Tdir(T, e.ang));
        if (e.dt === 'ang' && flip) { const t = o.p1; o.p1 = o.p2; o.p2 = t; }
        if (e.tp) o.tp = P(e.tp[0], e.tp[1]);
        return o;
      }
    }
    return { ...e };
  }
  // text block extents in its own frame (x along baseline), origin = insertion point
  function textBox(e) {
    if (e.type === 'mtext') {
      const lines = String(e.s).split('\n'), h = e.h, lh = h * 1.667;
      const w = Math.max(e.w || 0, ...lines.map(l => textWidth(l, h))), H = h + lh * (lines.length - 1);
      const at = e.attach || 1, col = (at - 1) % 3, row = Math.floor((at - 1) / 3);
      const x0 = col === 0 ? 0 : col === 1 ? -w / 2 : -w, yTop = row === 0 ? 0 : row === 1 ? H / 2 : H;
      return [x0, yTop - H, x0 + w, yTop];
    }
    const w = textWidth(e.s, e.h), al = e.align || 0, va = e.valign || 0;
    const x0 = al === 1 || al === 4 ? -w / 2 : al === 2 ? -w : 0;
    const y0 = va === 0 ? -e.h * 0.21 : va === 1 ? 0 : va === 2 ? -e.h * 0.71 : -e.h * 1.21;
    return [x0, y0, x0 + w, y0 + e.h * 1.21];
  }
  const baseOff = (va, h) => [0, 0.21 * h, -0.5 * h, -h][va || 0] || 0;   // baseline offset from the alignment point
  function textCenter(e) {
    const b = textBox(e), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, r = e.rot || 0;
    return [e.x + cx * Math.cos(r) - cy * Math.sin(r), e.y + cx * Math.sin(r) + cy * Math.cos(r)];
  }
  function textCorners(e) {
    const b = textBox(e), r = e.rot || 0, c = Math.cos(r), s = Math.sin(r);
    return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(([x, y]) => [e.x + x * c - y * s, e.y + x * s + y * c]);
  }

  /* ---------------- areas ---------------- */
  function loopArea(pts) {   // signed (CCW +), with bulges
    let a = 0; const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n]; a += cross(p[0], p[1], q[0], q[1]) / 2;
      const b = p[2] || 0; if (b) { const ar = bulgeArc(p, q, b); if (ar) a += ar.r * ar.r / 2 * (ar.th - Math.sin(ar.th)); }
    }
    return a;
  }
  function loopLength(pts, closed = true) {
    let l = 0; const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) { const p = pts[i], q = pts[(i + 1) % n], b = p[2] || 0; if (b) { const ar = bulgeArc(p, q, b); l += ar ? ar.r * Math.abs(ar.th) : 0; } else l += dist(p, q); }
    return l;
  }
  function entLength(e) {
    switch (e.type) {
      case 'line': return hyp(e.x2 - e.x1, e.y2 - e.y1);
      case 'arc': return e.r * arcSweep(e.a1, e.a2);
      case 'circle': return TAU * e.r;
      case 'pline': return loopLength(e.pts, !!e.closed);
    }
    return 0;
  }
  // point at arc length s along a curve entity (line / arc / circle / pline)
  function pointAtLength(e, s) {
    if (e.type === 'line') { const l = entLength(e); return pointAt(e, l ? s / l : 0); }
    if (e.type === 'arc' || e.type === 'circle') return pointAt(e, s / e.r + (e.type === 'circle' ? 0 : 0));
    if (e.type === 'pline') {
      for (const sg of plSegs(e)) { const l = sg.arc ? sg.arc.r * Math.abs(sg.arc.th) : dist(sg.p, sg.q); if (s <= l + 1e-12) return segPoint(sg, l ? s / l : 0); s -= l; }
      const P = e.pts[e.closed ? 0 : e.pts.length - 1]; return [P[0], P[1]];
    }
    return null;
  }
  // polyline flattening (arcs → chords)
  function flatten(pts, closed = true, maxStep = Math.PI / 36) {
    const out = [], n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p = pts[i], q = pts[(i + 1) % n], b = p[2] || 0; out.push([p[0], p[1]]);
      if (b) { const a = bulgeArc(p, q, b); if (a) { const k = Math.max(2, Math.ceil(Math.abs(a.th) / maxStep)); for (let j = 1; j < k; j++) { const t = a.a0 + a.th * j / k; out.push([a.cx + a.r * Math.cos(t), a.cy + a.r * Math.sin(t)]); } } }
    }
    if (!closed && n) out.push([pts[n - 1][0], pts[n - 1][1]]);
    return out;
  }
  function pointInPoly(poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function pointInLoops(loops, x, y) { let c = 0; for (const l of loops) if (pointInPoly(flatten(l.pts), x, y)) c++; return c % 2 === 1; }

  /* ---------------- hatch boundary detection (pick an internal point) ----------------
     prims: array of L/A primitives (all candidate boundary geometry). Returns loops [{pts}] or null. */
  function findBoundary(prims, px, py) {
    prims = prims.filter(p => primLen(p) > 1e-9);
    const N = prims.length, bbs = prims.map(p => primBBox(p));
    let scale = 1; for (const b of bbs) scale = Math.max(scale, Math.abs(b[0]), Math.abs(b[1]), Math.abs(b[2]), Math.abs(b[3]));
    const tol = scale * 1e-8;
    const splits = prims.map(p => [0, 1]);
    const paramOn = (p, pt) => p.t === 'L' ? (Math.abs(p.x2 - p.x1) > Math.abs(p.y2 - p.y1) ? (pt[0] - p.x1) / (p.x2 - p.x1) : (pt[1] - p.y1) / (p.y2 - p.y1)) : (p.sw >= TAU - 1e-12 ? normA(ang(pt[0] - p.cx, pt[1] - p.cy) - p.a1) / TAU : ccw(p.a1, ang(pt[0] - p.cx, pt[1] - p.cy)) / p.sw);
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      if (!bbOverlap(bbs[i], bbs[j], tol * 10)) continue;
      for (const pt of interPrims(prims[i], prims[j])) { splits[i].push(Math.max(0, Math.min(1, paramOn(prims[i], pt)))); splits[j].push(Math.max(0, Math.min(1, paramOn(prims[j], pt)))); }
    }
    // nodes
    const nodes = [], grid = new Map(), cell = tol * 100;
    const nodeOf = (x, y) => {
      const gx = Math.round(x / cell), gy = Math.round(y / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const l = grid.get((gx + dx) + ',' + (gy + dy)); if (l) for (const k of l) if (Math.abs(nodes[k][0] - x) < cell && Math.abs(nodes[k][1] - y) < cell) return k; }
      const k = nodes.length; nodes.push([x, y]); const key = gx + ',' + gy; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(k); return k;
    };
    const edges = [];
    prims.forEach((p, i) => {
      let ts = [...new Set(splits[i].map(t => Math.round(t * 1e10) / 1e10))].sort((a, b) => a - b);
      if (p.t === 'A' && p.sw >= TAU - 1e-12 && ts.length <= 2) ts = [0, 0.5, 1];
      for (let k = 0; k + 1 < ts.length; k++) {
        const t0 = ts[k], t1 = ts[k + 1]; if (t1 - t0 < 1e-9) continue;
        const a = primPoint(p, t0), b = primPoint(p, t1), na = nodeOf(a[0], a[1]), nb = nodeOf(b[0], b[1]);
        if (na === nb && p.t === 'L') continue;
        const e = { a: na, b: nb, p, t0, t1 };
        if (p.t === 'L') { e.ang0 = ang(b[0] - a[0], b[1] - a[1]); e.ang1 = ang(a[0] - b[0], a[1] - b[1]); e.bul = 0; }
        else { const a0 = p.a1 + p.sw * t0, a1 = p.a1 + p.sw * t1; e.ang0 = a0 + Math.PI / 2; e.ang1 = a1 - Math.PI / 2; e.bul = bulgeOf(p.sw * (t1 - t0)); e.curv = 1 / p.r; }
        // dedupe coincident edges (same end nodes and same midpoint)
        e.mid = primPoint(p, (t0 + t1) / 2);
        if (edges.some(o => ((o.a === na && o.b === nb) || (o.a === nb && o.b === na)) && Math.abs(o.mid[0] - e.mid[0]) < cell && Math.abs(o.mid[1] - e.mid[1]) < cell)) continue;
        edges.push(e);
      }
    });
    // remove dangling edges
    let alive = edges.map(() => true);
    for (let changed = true; changed;) {
      changed = false; const deg = new Array(nodes.length).fill(0);
      edges.forEach((e, i) => { if (alive[i]) { deg[e.a]++; deg[e.b]++; } });
      edges.forEach((e, i) => { if (alive[i] && (deg[e.a] < 2 || deg[e.b] < 2) && e.a !== e.b) { alive[i] = false; changed = true; } });
    }
    const E = edges.filter((e, i) => alive[i]);
    if (!E.length) return null;
    // half-edges h = 2i (a→b), 2i+1 (b→a)
    const out = nodes.map(() => []);
    E.forEach((e, i) => { out[e.a].push({ h: 2 * i, ang: normA(e.ang0), k: e.curv ? e.curv * Math.sign(e.bul) : 0 }); out[e.b].push({ h: 2 * i + 1, ang: normA(e.ang1), k: e.curv ? -e.curv * Math.sign(e.bul) : 0 }); });
    out.forEach(l => l.sort((u, v) => Math.abs(u.ang - v.ang) > 1e-9 ? u.ang - v.ang : u.k - v.k));
    const pos = new Map(); out.forEach((l, n) => l.forEach((x, idx) => pos.set(x.h, [n, idx])));
    const endNode = h => h & 1 ? E[h >> 1].a : E[h >> 1].b;
    const next = h => { const v = endNode(h), [, idx] = pos.get(h ^ 1), l = out[v]; return l[(idx - 1 + l.length) % l.length].h; };
    const used = new Set(), faces = [];
    for (let h0 = 0; h0 < E.length * 2; h0++) {
      if (used.has(h0)) continue;
      const cyc = []; let h = h0, guard = 0;
      while (!used.has(h) && guard++ < 100000) { used.add(h); cyc.push(h); h = next(h); }
      if (h !== h0) continue;
      const pts = cyc.map(h2 => { const e = E[h2 >> 1], n = h2 & 1 ? e.b : e.a; return [nodes[n][0], nodes[n][1], h2 & 1 ? -e.bul : e.bul]; });
      faces.push({ pts, area: loopArea(pts), nodes: cyc.map(h2 => E[h2 >> 1].a) });
    }
    let best = null;
    for (const f of faces) if (f.area > 1e-12 && (!best || f.area < best.area) && pointInPoly(flatten(f.pts), px, py)) best = f;
    if (!best) return null;
    // islands: outer boundaries of other connected components inside the chosen face
    const par = nodes.map((_, i) => i), find = i => par[i] === i ? i : (par[i] = find(par[i]));
    E.forEach(e => { par[find(e.a)] = find(e.b); });
    const comp0 = find(best.nodes[0]), poly = flatten(best.pts), loops = [{ pts: best.pts }], seen = new Set([comp0]);
    const byComp = new Map();
    for (const f of faces) { const c = find(f.nodes[0]); if (c === comp0 || f.area >= 0) continue; if (!byComp.has(c) || f.area < byComp.get(c).area) byComp.set(c, f); }
    for (const [c, f] of byComp) { if (seen.has(c)) continue; const n0 = nodes[f.nodes[0]]; if (pointInPoly(poly, n0[0], n0[1])) loops.push({ pts: f.pts }); }
    return loops;
  }

  /* ---------------- hatch pattern lines ----------------
     families: [{a (deg), x, y, dx, dy, dash:[...]}] in AutoCAD .pat units; scale, angle (rad) */
  function hatchLines(loops, fams, scale = 1, angle = 0, limit = 60000) {
    const polys = loops.map(l => flatten(l.pts));
    let bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of polys) for (const [x, y] of p) { bb[0] = Math.min(bb[0], x); bb[1] = Math.min(bb[1], y); bb[2] = Math.max(bb[2], x); bb[3] = Math.max(bb[3], y); }
    if (!isFinite(bb[0])) return [];
    const edges = []; for (const p of polys) for (let i = 0; i < p.length; i++) edges.push([p[i], p[(i + 1) % p.length]]);
    const out = [];
    for (const f of fams) {
      const a = f.a * Math.PI / 180 + angle, ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
      const ox0 = f.x * scale, oy0 = f.y * scale, oc = Math.cos(angle), os = Math.sin(angle);
      const ox = ox0 * oc - oy0 * os, oy = ox0 * os + oy0 * oc;
      const sdx = f.dx * scale, sdy = f.dy * scale;
      if (Math.abs(sdy) < 1e-9) continue;
      const stepX = ux * sdx + vx * sdy, stepY = uy * sdx + vy * sdy;   // offset between successive lines (world)
      const corners = [[bb[0], bb[1]], [bb[2], bb[1]], [bb[2], bb[3]], [bb[0], bb[3]]];
      const vs = corners.map(([x, y]) => (x - ox) * vx + (y - oy) * vy), perp = sdy;
      const k0 = Math.floor(Math.min(...vs) / perp), k1 = Math.ceil(Math.max(...vs) / perp);
      const kmin = Math.min(k0, k1), kmax = Math.max(k0, k1);
      if ((kmax - kmin) > limit) return out;
      const dashL = (f.dash || []).reduce((s, d) => s + Math.abs(d), 0) * scale;
      for (let k = kmin; k <= kmax; k++) {
        const bx = ox + stepX * k, by = oy + stepY * k;   // a point on line k (dash origin)
        const ts = [];
        for (const [p, q] of edges) {
          const ex = q[0] - p[0], ey = q[1] - p[1], den = cross(ux, uy, ex, ey); if (Math.abs(den) < 1e-14) continue;
          const wx = p[0] - bx, wy = p[1] - by, s = cross(wx, wy, ex, ey) / den, t = cross(wx, wy, ux, uy) / den;
          if (t >= 0 && t < 1) ts.push(s);
        }
        if (ts.length < 2) continue;
        ts.sort((m, n) => m - n);
        for (let i = 0; i + 1 < ts.length; i += 2) {
          const s0 = ts[i], s1 = ts[i + 1]; if (s1 - s0 < 1e-9) continue;
          if (!dashL || !f.dash.length) { out.push([bx + ux * s0, by + uy * s0, bx + ux * s1, by + uy * s1]); }
          else {
            let s = Math.floor(s0 / dashL) * dashL;
            while (s < s1) {
              for (const d0 of f.dash) {
                const d = Math.abs(d0) * scale, a0 = s, a1 = s + (d0 === 0 ? 0 : d);
                if (d0 >= 0) { const c0 = Math.max(a0, s0), c1 = Math.min(d0 === 0 ? a0 + 1e-6 : a1, s1); if (c1 >= c0 && c0 <= s1 && (d0 === 0 ? a0 >= s0 : true)) out.push([bx + ux * c0, by + uy * c0, bx + ux * (d0 === 0 ? c0 : c1), by + uy * (d0 === 0 ? c0 : c1)]); }
                s += d; if (s >= s1) break;
              }
              if (out.length > limit) return out;
            }
          }
          if (out.length > limit) return out;
        }
      }
    }
    return out;
  }

  /* ---------------- snapping helpers ---------------- */
  function perpFoot(p, bx, by) {
    if (p.t === 'L') { const dx = p.x2 - p.x1, dy = p.y2 - p.y1, l2 = dx * dx + dy * dy; if (!l2) return null; const t = ((bx - p.x1) * dx + (by - p.y1) * dy) / l2; if (t < -1e-9 || t > 1 + 1e-9) return null; return [p.x1 + dx * t, p.y1 + dy * t]; }
    const a = ang(bx - p.cx, by - p.cy); const res = [];
    for (const aa of [a, a + Math.PI]) if (onArc(p, aa)) res.push([p.cx + p.r * Math.cos(aa), p.cy + p.r * Math.sin(aa)]);
    if (!res.length) return null; res.sort((u, v) => dist(u, [bx, by]) - dist(v, [bx, by])); return res[0];
  }
  function tangentPts(p, bx, by) {
    if (p.t !== 'A') return [];
    const d = hyp(bx - p.cx, by - p.cy); if (d <= p.r + 1e-12) return [];
    const base = ang(bx - p.cx, by - p.cy), da = Math.acos(p.r / d);
    return [base + da, base - da].filter(a => onArc(p, a)).map(a => [p.cx + p.r * Math.cos(a), p.cy + p.r * Math.sin(a)]);
  }

  return { TAU, EPS, normA, ccw, ang, dist, hyp, cross, L, A, arcSweep, bulgeArc, bulgeOf, plSegs, segPrim, primsOf, onArc, primPoint, primStart, primEnd, primLen, primNearest, primBBox, bbOverlap,
    interPrims, interEnts, uniqPts, lineCircle, circleCircle, curveRange, paramOf, pointAt, piece, trimAt, trim, breakAt, extend, offset, offsetThrough, offsetPline,
    filletLines, chamferLines, cornerPline, Tmove, Trot, Tscale, Tmirror, Tmul, Tpt, Tdir, Tdet, transform, textWidth, textBox, textCorners, baseOff, textCenter, charW, EM,
    loopArea, loopLength, entLength, pointAtLength, flatten, pointInPoly, pointInLoops, findBoundary, hatchLines, perpFoot, tangentPts, strip };
});
