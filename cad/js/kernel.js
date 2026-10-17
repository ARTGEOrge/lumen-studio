// Lumen CAD geometry kernel: polygon-mesh solids, BSP booleans (after Evan Wallace's csg.js, MIT),
// primitives, sketch profiles, extrude/revolve, patterns, a safe expression evaluator, mass properties and STL/OBJ I/O.
// No DOM — runs in Node for tests.
(function (root) {
  'use strict';
  const EPS = 1e-5;
  // ---------- vectors ----------
  const V = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    len: a => Math.hypot(a[0], a[1], a[2]), unit: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
    lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  };

  // ---------- BSP CSG ----------
  class Plane {
    constructor(n, w) { this.n = n; this.w = w; }
    static from(a, b, c) { const n = V.unit(V.cross(V.sub(b, a), V.sub(c, a))); return new Plane(n, V.dot(n, a)); }
    flip() { this.n = V.mul(this.n, -1); this.w = -this.w; }
    clone() { return new Plane(this.n.slice(), this.w); }
    split(poly, cp, cb, front, back) {
      const COP = 0, FRONT = 1, BACK = 2, SPAN = 3; let type = 0; const types = [];
      for (const v of poly.v) { const t = V.dot(this.n, v) - this.w; const ty = t < -EPS ? BACK : t > EPS ? FRONT : COP; type |= ty; types.push(ty); }
      if (type === COP) (V.dot(this.n, poly.plane.n) > 0 ? cp : cb).push(poly);
      else if (type === FRONT) front.push(poly); else if (type === BACK) back.push(poly);
      else {
        const f = [], b = [];
        for (let i = 0; i < poly.v.length; i++) {
          const j = (i + 1) % poly.v.length, ti = types[i], tj = types[j], vi = poly.v[i], vj = poly.v[j];
          if (ti !== BACK) f.push(vi); if (ti !== FRONT) b.push(ti !== BACK ? vi.slice() : vi);
          if ((ti | tj) === SPAN) { const t = (this.w - V.dot(this.n, vi)) / V.dot(this.n, V.sub(vj, vi)); const v = V.lerp(vi, vj, t); f.push(v); b.push(v.slice()); }
        }
        if (f.length >= 3) front.push(new Poly(f, poly.plane.clone())); if (b.length >= 3) back.push(new Poly(b, poly.plane.clone()));
      }
    }
  }
  class Poly {
    constructor(v, plane) { this.v = v; this.plane = plane || Plane.from(v[0], v[1], v[2]); }
    clone() { return new Poly(this.v.map(p => p.slice()), this.plane.clone()); }
    flip() { this.v.reverse(); this.plane.flip(); }
  }
  class Node {
    constructor(polys) { this.plane = null; this.front = null; this.back = null; this.polys = []; if (polys) this.build(polys); }
    invert() { this.polys.forEach(p => p.flip()); this.plane.flip(); if (this.front) this.front.invert(); if (this.back) this.back.invert(); [this.front, this.back] = [this.back, this.front]; }
    clipPolys(polys) {
      if (!this.plane) return polys.slice(); let f = [], b = [];
      polys.forEach(p => this.plane.split(p, f, b, f, b));
      if (this.front) f = this.front.clipPolys(f); b = this.back ? this.back.clipPolys(b) : [];
      return f.concat(b);
    }
    clipTo(bsp) { this.polys = bsp.clipPolys(this.polys); if (this.front) this.front.clipTo(bsp); if (this.back) this.back.clipTo(bsp); }
    all() { let p = this.polys.slice(); if (this.front) p = p.concat(this.front.all()); if (this.back) p = p.concat(this.back.all()); return p; }
    build(polys) {
      // iterative to avoid deep recursion on big meshes
      const stack = [[this, polys]];
      while (stack.length) {
        const [node, ps] = stack.pop(); if (!ps.length) continue;
        if (!node.plane) node.plane = ps[0].plane.clone();
        const f = [], b = []; ps.forEach(p => node.plane.split(p, node.polys, node.polys, f, b));
        if (f.length) { if (!node.front) node.front = new Node(); stack.push([node.front, f]); }
        if (b.length) { if (!node.back) node.back = new Node(); stack.push([node.back, b]); }
      }
    }
  }
  class Solid {
    constructor(polys = []) { this.polys = polys; }
    clone() { return new Solid(this.polys.map(p => p.clone())); }
    // bounding-box fast paths: disjoint solids need no BSP work (their union is just both polygon sets)
    box3() { if (this._bb) return this._bb; const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity]; this.polys.forEach(p => p.v.forEach(v => { for (let k = 0; k < 3; k++) { if (v[k] < mn[k]) mn[k] = v[k]; if (v[k] > mx[k]) mx[k] = v[k]; } })); return (this._bb = [mn, mx]); }
    apart(o) { const [a0, a1] = this.box3(), [b0, b1] = o.box3(); for (let k = 0; k < 3; k++) if (a1[k] < b0[k] - 1e-4 || b1[k] < a0[k] - 1e-4) return true; return !this.polys.length || !o.polys.length; }
    union(o) { if (this.apart(o)) return new Solid(this.clone().polys.concat(o.clone().polys)); return this.unionBSP(o); }
    subtract(o) { if (this.apart(o)) return this.clone(); return this.subtractBSP(o); }
    intersect(o) { if (this.apart(o)) return new Solid(); return this.intersectBSP(o); }
    unionBSP(o) { const a = new Node(this.clone().polys), b = new Node(o.clone().polys); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.all()); return new Solid(a.all()); }
    subtractBSP(o) { const a = new Node(this.clone().polys), b = new Node(o.clone().polys); a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.all()); a.invert(); return new Solid(a.all()); }
    intersectBSP(o) { const a = new Node(this.clone().polys), b = new Node(o.clone().polys); a.invert(); b.clipTo(a); b.invert(); a.clipTo(b); b.clipTo(a); a.build(b.all()); a.invert(); return new Solid(a.all()); }
    transform(fn, flipsOrientation) { const s = new Solid(this.polys.map(p => { const v = p.v.map(fn); if (flipsOrientation) v.reverse(); return new Poly(v); })); return s; }
    triangles() { const t = []; this.polys.forEach(p => { for (let i = 1; i < p.v.length - 1; i++) t.push([p.v[0], p.v[i], p.v[i + 1]]); }); return t; }
  }
  const fromFaces = faces => new Solid(faces.filter(f => f.length >= 3 && V.len(V.cross(V.sub(f[1], f[0]), V.sub(f[2], f[0]))) > 1e-12).map(f => new Poly(f)));

  // ---------- transforms ----------
  function rotMat(rx, ry, rz) { // degrees, applied X then Y then Z
    const [a, b, c] = [rx, ry, rz].map(d => (d || 0) * Math.PI / 180);
    const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cc = Math.cos(c), sc = Math.sin(c);
    const X = [[1, 0, 0], [0, ca, -sa], [0, sa, ca]], Y = [[cb, 0, sb], [0, 1, 0], [-sb, 0, cb]], Z = [[cc, -sc, 0], [sc, cc, 0], [0, 0, 1]];
    const m = (P, Q) => P.map((r, i) => Q[0].map((_, j) => r.reduce((s, _, k) => s + P[i][k] * Q[k][j], 0)));
    return m(Z, m(Y, X));
  }
  const apply = (M, p) => [M[0][0] * p[0] + M[0][1] * p[1] + M[0][2] * p[2], M[1][0] * p[0] + M[1][1] * p[1] + M[1][2] * p[2], M[2][0] * p[0] + M[2][1] * p[1] + M[2][2] * p[2]];
  function place(solid, pl = {}) {
    const M = rotMat(pl.rx, pl.ry, pl.rz), t = [pl.x || 0, pl.y || 0, pl.z || 0];
    return solid.transform(p => V.add(apply(M, p), t));
  }

  // ---------- primitives (Z up, base on z=0 where it makes sense) ----------
  function box(w, d, h) {
    const x = w / 2, y = d / 2, P = [[-x, -y, 0], [x, -y, 0], [x, y, 0], [-x, y, 0], [-x, -y, h], [x, -y, h], [x, y, h], [-x, y, h]];
    return fromFaces([[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]].map(f => f.map(i => P[i].slice())));
  }
  function cone(r1, r2, h, n = 48) {
    const faces = [], ring = (r, z) => Array.from({ length: n }, (_, i) => [r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n), z]);
    const A = ring(r1, 0), B = ring(r2, h);
    if (r1 > 0) faces.push(A.slice().reverse()); if (r2 > 0) faces.push(B.slice());
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (r1 > 0 && r2 > 0) faces.push([A[i], A[j], B[j], B[i]].map(p => p.slice())); else if (r1 > 0) faces.push([A[i], A[j], B[0].map((v, k) => k < 2 ? 0 : v)]); else faces.push([A[0].map((v, k) => k < 2 ? 0 : v), B[j], B[i]]); }
    return fromFaces(faces);
  }
  const cylinder = (r, h, n = 48) => cone(r, r, h, n);
  function sphere(r, n = 32) {
    const rows = Math.max(6, Math.round(n / 2)), faces = [], P = (i, j) => { const th = Math.PI * i / rows, ph = 2 * Math.PI * j / n; return [r * Math.sin(th) * Math.cos(ph), r * Math.sin(th) * Math.sin(ph), r * Math.cos(th)]; };
    for (let i = 0; i < rows; i++) for (let j = 0; j < n; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      if (i === 0) faces.push([a, b, c]); else if (i === rows - 1) faces.push([a, b, d]); else faces.push([a, b, c, d]);
    }
    return fromFaces(faces);
  }
  function torus(R, r, n = 48, m = 24) {
    const faces = [], P = (i, j) => { const u = 2 * Math.PI * i / n, v = 2 * Math.PI * j / m; return [(R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v)]; };
    for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) faces.push([P(i, j), P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)]);
    return fromFaces(faces);
  }

  // ---------- sketches ----------
  // shape: {type:'rect',x,y,w,h} | {type:'circle',x,y,r} | {type:'polygon',x,y,r,n} | {type:'slot',x,y,l,r} | {type:'points',pts:[[x,y],…]} ; hole:true cuts it
  function loopOf(s, seg = 64) {
    const c = (x, y, r, n, a0 = 0) => Array.from({ length: n }, (_, i) => [x + r * Math.cos(a0 + 2 * Math.PI * i / n), y + r * Math.sin(a0 + 2 * Math.PI * i / n)]);
    switch (s.type) {
      case 'rect': return [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]];
      case 'circle': return c(s.x, s.y, s.r, seg);
      case 'polygon': return c(s.x, s.y, s.r, Math.max(3, Math.round(s.n)), Math.PI / 2);
      case 'slot': { const h = seg / 2, out = []; for (let i = 0; i <= h; i++) { const a = -Math.PI / 2 + Math.PI * i / h; out.push([s.x + s.l / 2 + s.r * Math.cos(a), s.y + s.r * Math.sin(a)]); } for (let i = 0; i <= h; i++) { const a = Math.PI / 2 + Math.PI * i / h; out.push([s.x - s.l / 2 + s.r * Math.cos(a), s.y + s.r * Math.sin(a)]); } return out; }
      case 'points': return s.pts.map(p => p.slice());
    }
    return [];
  }
  const area2 = L => { let a = 0; for (let i = 0; i < L.length; i++) { const p = L[i], q = L[(i + 1) % L.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const ccw = L => area2(L) < 0 ? L.slice().reverse() : L;
  // ear clipping for a simple polygon (CCW)
  function triangulate(L) {
    const idx = L.map((_, i) => i), tris = []; let guard = 0;
    const isEar = (a, b, c) => { const A = L[a], B = L[b], C = L[c]; if ((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0]) <= 1e-12) return false;
      for (const k of idx) { if (k === a || k === b || k === c) continue; const P = L[k]; const d1 = (B[0] - A[0]) * (P[1] - A[1]) - (B[1] - A[1]) * (P[0] - A[0]), d2 = (C[0] - B[0]) * (P[1] - B[1]) - (C[1] - B[1]) * (P[0] - B[0]), d3 = (A[0] - C[0]) * (P[1] - C[1]) - (A[1] - C[1]) * (P[0] - C[0]); if (d1 >= -1e-12 && d2 >= -1e-12 && d3 >= -1e-12) return false; } return true; };
    while (idx.length > 3 && guard++ < 100000) {
      let cut = false;
      for (let i = 0; i < idx.length; i++) { const a = idx[(i + idx.length - 1) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length]; if (isEar(a, b, c)) { tris.push([a, b, c]); idx.splice(i, 1); cut = true; break; } }
      if (!cut) { tris.push([idx[0], idx[1], idx[2]]); idx.splice(1, 1); } // degenerate input: keep going
    }
    if (idx.length === 3) tris.push(idx.slice());
    return tris;
  }
  // map sketch (u,v) to 3D on a plane: XY (z = offset), XZ (y = -offset… u→x, v→z), YZ (u→y, v→z)
  function planeMap(plane, off = 0) {
    if (plane === 'XZ') return (u, v, w = 0) => [u, -(off + w), v];   // x × z = −y, so extrusion runs toward −Y
    if (plane === 'YZ') return (u, v, w = 0) => [off + w, u, v];
    return (u, v, w = 0) => [u, v, off + w];
  }
  function prism(loop, map, d0, d1) {
    const L = ccw(loop), faces = [], tris = triangulate(L);
    tris.forEach(t => { faces.push(t.slice().reverse().map(i => map(L[i][0], L[i][1], d0))); faces.push(t.map(i => map(L[i][0], L[i][1], d1))); });
    for (let i = 0; i < L.length; i++) { const j = (i + 1) % L.length; faces.push([map(L[i][0], L[i][1], d0), map(L[j][0], L[j][1], d0), map(L[j][0], L[j][1], d1), map(L[i][0], L[i][1], d1)]); }
    const s = fromFaces(faces);
    return d1 < d0 ? new Solid(s.polys.map(p => { p.flip(); return p; })) : s;
  }
  function extrude(sk, dist, symmetric) {
    const map = planeMap(sk.plane, sk.offset || 0), d0 = symmetric ? -dist / 2 : 0, d1 = symmetric ? dist / 2 : dist;
    let out = null;   // every plane's (u, v, w) basis is right-handed, so prisms come out with outward normals
    const solids = (sk.shapes || []).map(s => ({ s: prism(loopOf(s), map, Math.min(d0, d1), Math.max(d0, d1)), hole: !!s.hole }));
    solids.filter(x => !x.hole).forEach(x => out = out ? out.union(x.s) : x.s);
    if (out) solids.filter(x => x.hole).forEach(x => out = out.subtract(x.s));
    return out || new Solid();
  }
  // revolve a sketch loop around the sketch's v axis (u = radius ≥ 0)
  function revolveLoop(loop, map, angle, n) {
    const L = ccw(loop), full = Math.abs(angle) >= 359.999, steps = Math.max(3, Math.round(n * Math.abs(angle) / 360)), faces = [];
    const P = (u, v, k) => { const a = (angle * Math.PI / 180) * k / steps; return map(u * Math.cos(a), v, u * Math.sin(a)); };
    for (let k = 0; k < steps; k++) for (let i = 0; i < L.length; i++) {
      const j = (i + 1) % L.length, [u0, v0] = L[i], [u1, v1] = L[j];
      faces.push([P(u0, v0, k), P(u1, v1, k), P(u1, v1, k + 1), P(u0, v0, k + 1)].filter((p, q, arr) => q === 0 || V.len(V.sub(p, arr[q - 1])) > 1e-9));
    }
    if (!full) { const tris = triangulate(L); tris.forEach(t => { faces.push(t.slice().reverse().map(i => P(L[i][0], L[i][1], 0))); faces.push(t.map(i => P(L[i][0], L[i][1], steps))); }); }
    let s = fromFaces(faces.map(f => f.filter((p, q) => V.len(V.sub(p, f[(q + 1) % f.length])) > 1e-9 || q === f.length - 1)).filter(f => f.length >= 3));
    // make sure normals point outward (positive volume)
    if (volumeOf(s) < 0) s = new Solid(s.polys.map(p => { p.flip(); return p; }));
    return s;
  }
  function revolve(sk, angle = 360, n = 64) {
    const map = planeMap(sk.plane, sk.offset || 0); let out = null;
    const solids = (sk.shapes || []).map(s => ({ s: revolveLoop(loopOf(s, 48), map, angle, n), hole: !!s.hole }));
    solids.filter(x => !x.hole).forEach(x => out = out ? out.union(x.s) : x.s);
    if (out) solids.filter(x => x.hole).forEach(x => out = out.subtract(x.s));
    return out || new Solid();
  }

  // ---------- expressions ----------
  const FN = { sin: d => Math.sin(d * Math.PI / 180), cos: d => Math.cos(d * Math.PI / 180), tan: d => Math.tan(d * Math.PI / 180), sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil };
  function evalExpr(src, vars = {}) {
    if (typeof src === 'number') return src;
    const s = String(src).trim(); if (s === '') return 0; let i = 0;
    const ws = () => { while (s[i] === ' ') i++; };
    const num = () => { ws(); const m = /^(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+)/i.exec(s.slice(i)); if (m) { i += m[0].length; return +m[0]; } const id = /^[A-Za-z_]\w*/.exec(s.slice(i)); if (id) { i += id[0].length; const name = id[0]; ws();
        if (s[i] === '(') { i++; const args = [expr()]; ws(); while (s[i] === ',') { i++; args.push(expr()); ws(); } if (s[i] !== ')') throw new Error('Missing ) after ' + name); i++; if (!FN[name]) throw new Error('Unknown function ' + name); return FN[name](...args); }
        if (name === 'pi' || name === 'PI') return Math.PI; if (!(name in vars)) throw new Error('Unknown parameter "' + name + '"'); return vars[name]; }
      if (s[i] === '(') { i++; const v = expr(); ws(); if (s[i] !== ')') throw new Error('Missing )'); i++; return v; }
      throw new Error('Unexpected "' + (s[i] || 'end') + '" in ' + s); };
    const unary = () => { ws(); if (s[i] === '-') { i++; return -unary(); } if (s[i] === '+') { i++; return unary(); } return num(); };
    const pow = () => { const b = unary(); ws(); if (s[i] === '^') { i++; return Math.pow(b, pow()); } return b; };
    const term = () => { let v = pow(); for (;;) { ws(); if (s[i] === '*') { i++; v *= pow(); } else if (s[i] === '/') { i++; v /= pow(); } else return v; } };
    const expr = () => { let v = term(); for (;;) { ws(); if (s[i] === '+') { i++; v += term(); } else if (s[i] === '-') { i++; v -= term(); } else return v; } };
    const v = expr(); ws(); if (i < s.length) throw new Error('Unexpected "' + s.slice(i) + '"'); if (!isFinite(v)) throw new Error('Result is not a number: ' + s); return v;
  }
  // parameters may refer to earlier parameters
  function evalParams(params) { const vars = {}; (params || []).forEach(p => { vars[p.name] = evalExpr(p.expr, vars); }); return vars; }

  // ---------- features → solid ----------
  // evaluate one sketch shape's expressions; constrained sketches are solved and their corner fillets applied
  function shapeOf(sh, ev) {
    if (sh.type === 'sketch') {
      const r = solveSketch(sh.pts || [], sh.cons || [], ev);
      if (!r.ok) throw new Error('Sketch constraints conflict (residual ' + r.residual.toExponential(1) + ')');
      return { type: 'points', hole: !!sh.hole, pts: roundCorners(r.pts, (sh.fil || []).map(e => e == null || e === '' ? 0 : ev(e))) };
    }
    const o = { type: sh.type, hole: !!sh.hole }; ['x', 'y', 'w', 'h', 'r', 'n', 'l'].forEach(k => { if (sh[k] != null) o[k] = ev(sh[k]); });
    if (sh.type === 'points') o.pts = parsePts(sh.pts, ev);
    return o;
  }
  const parsePts = (src, ev) => String(src || '').split(';').map(q => q.trim()).filter(Boolean).map(q => q.split(',').map(t => ev(t.trim())));
  function toolOf(f, ev, ctx) {
    const P = f.p || {}, n = k => ev(P[k]);
    let s;
    switch (f.type) {
      case 'box': s = box(n('w'), n('d'), n('h')); break;
      case 'cylinder': s = cylinder(n('r'), n('h'), Math.round(n('seg') || 64)); break;
      case 'cone': s = cone(n('r1'), n('r2'), n('h'), 64); break;
      case 'sphere': s = sphere(n('r'), 40); break;
      case 'torus': s = torus(n('R'), n('r'), 64, 24); break;
      case 'extrude': case 'revolve': {
        const sk = { plane: P.plane || 'XY', offset: n('offset'), shapes: (P.shapes || []).map(sh => shapeOf(sh, ev)) };
        s = f.type === 'extrude' ? extrude(sk, n('dist'), !!P.symmetric) : revolve(sk, n('angle') || 360, 64); break;
      }
      case 'hole': s = holeTool(P, ev, ctx && ctx.body); break;
      case 'mesh': s = fromFaces((f.tris || []).map(t => t.map(p => p.slice()))); break;
      default: throw new Error('Unknown feature ' + f.type);
    }
    s = place(s, { x: n('px'), y: n('py'), z: n('pz'), rx: n('rx'), ry: n('ry'), rz: n('rz') });
    // patterns repeat the tool before it is combined with the body
    const pat = f.pattern;
    if (pat && pat.type === 'linear' && ev(pat.count) > 1) { let u = s; for (let k = 1; k < Math.round(ev(pat.count)); k++) u = u.union(place(s, { x: ev(pat.dx) * k, y: ev(pat.dy) * k, z: ev(pat.dz) * k })); s = u; }
    if (pat && pat.type === 'circular' && ev(pat.count) > 1) { const c = Math.round(ev(pat.count)), tot = ev(pat.angle) || 360, step = tot >= 360 ? 360 / c : tot / (c - 1); let u = s; for (let k = 1; k < c; k++) u = u.union(place(s, { rz: step * k })); s = u; }
    // mirror across the YZ / XZ / XY planes; "XY" mirrors in X then in Y (four copies)
    if (f.mirror) for (const ch of String(f.mirror).toUpperCase()) { const ax = { X: 0, Y: 1, Z: 2 }[ch]; if (ax != null) s = s.union(s.transform(p => { const q = p.slice(); q[ax] = -q[ax]; return q; }, true)); }
    return s;
  }
  function build(model) {
    const vars = evalParams(model.params), ev = e => evalExpr(e == null ? 0 : e, vars);
    let body = null; const log = [];
    (model.features || []).forEach((f, i) => {
      if (f.suppressed) { log.push({ i, ok: true, msg: 'suppressed' }); return; }
      try {
        if (f.type === 'fillet') {   // modifies edges of the body built so far
          if (!body) throw new Error('Nothing to fillet yet');
          const P = f.p || {}; body = blendEdges(body, P.edges || [], ev(P.r), P.kind === 'chamfer' ? 'chamfer' : 'fillet');
          log.push({ i, ok: true, tris: body.polys.length }); return;
        }
        const t = toolOf(f, ev, { body }); const op = f.op || 'add';
        if (op === 'cut') { if (body) body = body.subtract(t); }
        else if (op === 'intersect') { if (body) body = body.intersect(t); }
        else body = body ? body.union(t) : t;
        log.push({ i, ok: true, tris: t.polys.length });
      } catch (e) { log.push({ i, ok: false, msg: e.message }); }
    });
    return { solid: body || new Solid(), log, vars };
  }

  // ---------- measurements ----------
  function volumeOf(s) { let v = 0; s.triangles().forEach(([a, b, c]) => v += V.dot(a, V.cross(b, c)) / 6); return v; }
  function massProps(s, density = 1) {
    let vol = 0, area = 0; const c = [0, 0, 0]; let min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    s.triangles().forEach(([a, b, d]) => {
      const v = V.dot(a, V.cross(b, d)) / 6; vol += v; c[0] += v * (a[0] + b[0] + d[0]) / 4; c[1] += v * (a[1] + b[1] + d[1]) / 4; c[2] += v * (a[2] + b[2] + d[2]) / 4;
      area += V.len(V.cross(V.sub(b, a), V.sub(d, a))) / 2;
      [a, b, d].forEach(p => { for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p[k]); max[k] = Math.max(max[k], p[k]); } });
    });
    return { volume: vol, area, mass: vol * density, centroid: vol ? c.map(x => x / vol) : [0, 0, 0], min, max, size: max.map((x, k) => x - min[k]), triangles: s.triangles().length };
  }


  // Crease edges that survive the T-junctions booleans leave behind: group polygon edges by the line they lie on,
  // split each line into elementary intervals, and keep an interval when the faces touching it disagree in normal.
  function featureEdges(solid, angleDeg = 25, viewDir = null) {   // viewDir adds silhouettes: edges where the surface turns away
    const cosT = Math.cos(angleDeg * Math.PI / 180), groups = new Map(), q = x => Math.round(x * 1e3);
    solid.polys.forEach((p, pi) => {
      for (let i = 0; i < p.v.length; i++) {
        const a = p.v[i], b = p.v[(i + 1) % p.v.length]; let d = V.sub(b, a); const L = V.len(d); if (L < 1e-7) continue; d = V.mul(d, 1 / L);
        // canonical direction so both orientations of an edge land in the same group
        if (d[0] < -1e-9 || (Math.abs(d[0]) <= 1e-9 && (d[1] < -1e-9 || (Math.abs(d[1]) <= 1e-9 && d[2] < 0)))) d = V.mul(d, -1);
        const t0 = V.dot(a, d), t1 = V.dot(b, d), foot = V.sub(a, V.mul(d, t0));
        const key = [q(d[0] * 1e2), q(d[1] * 1e2), q(d[2] * 1e2), q(foot[0]), q(foot[1]), q(foot[2])].join(',');
        if (!groups.has(key)) groups.set(key, { d, foot, segs: [] });
        groups.get(key).segs.push([Math.min(t0, t1), Math.max(t0, t1), p.plane.n]);
      }
    });
    const out = [];
    groups.forEach(g => {
      const cuts = [...new Set(g.segs.flatMap(s => [s[0], s[1]]).map(t => Math.round(t * 1e5) / 1e5))].sort((x, y) => x - y);
      let runStart = null;
      for (let k = 0; k + 1 < cuts.length; k++) {
        const m = (cuts[k] + cuts[k + 1]) / 2, ns = g.segs.filter(s => s[0] <= m && s[1] >= m).map(s => s[2]);
        let crease = ns.length === 1;
        for (let i = 0; i < ns.length && !crease; i++) for (let j = i + 1; j < ns.length; j++) if ((V.dot(ns[i], ns[j]) < cosT && V.dot(ns[i], ns[j]) > -0.999) || (viewDir && (V.dot(ns[i], viewDir) > 1e-9) !== (V.dot(ns[j], viewDir) > 1e-9) && V.dot(ns[i], ns[j]) > -0.999)) { crease = true; break; }
        if (ns.length && crease) { if (runStart == null) runStart = cuts[k]; }
        else if (runStart != null) { out.push([V.add(g.foot, V.mul(g.d, runStart)), V.add(g.foot, V.mul(g.d, cuts[k]))]); runStart = null; }
      }
      if (runStart != null) out.push([V.add(g.foot, V.mul(g.d, runStart)), V.add(g.foot, V.mul(g.d, cuts[cuts.length - 1]))]);
    });
    return out;
  }


  // ---------- 2D drawing: third-angle three-view sheet with hidden lines ----------
  // For each view, crease edges are cut into short pieces; a piece is hidden when a ray from it toward the viewer hits the part.
  function edgeVisibility(solid, edges, dir, step) {
    const tris = solid.triangles(), out = [];
    const bb = tris.map(t => [Math.min(t[0][0], t[1][0], t[2][0]), Math.min(t[0][1], t[1][1], t[2][1]), Math.min(t[0][2], t[1][2], t[2][2]), Math.max(t[0][0], t[1][0], t[2][0]), Math.max(t[0][1], t[1][1], t[2][1]), Math.max(t[0][2], t[1][2], t[2][2])]);
    const ax = dir.findIndex(v => v !== 0), sg = dir[ax], o1 = (ax + 1) % 3, o2 = (ax + 2) % 3, EPS = 1e-6;
    const blocked = p => {
      for (let i = 0; i < tris.length; i++) {
        const b = bb[i]; if (p[o1] < b[o1] - EPS || p[o1] > b[o1 + 3] + EPS || p[o2] < b[o2] - EPS || p[o2] > b[o2 + 3] + EPS) continue;
        if (sg > 0 ? b[ax + 3] <= p[ax] : b[ax] >= p[ax]) continue;
        const [a, c, d] = tris[i], e1 = V.sub(c, a), e2 = V.sub(d, a), h = V.cross(dir, e2), det = V.dot(e1, h); if (Math.abs(det) < 1e-12) continue;
        const f = 1 / det, s0 = V.sub(p, a), u = f * V.dot(s0, h); if (u < -1e-9 || u > 1 + 1e-9) continue;
        const q = V.cross(s0, e1), v = f * V.dot(dir, q); if (v < -1e-9 || u + v > 1 + 1e-9) continue;
        if (f * V.dot(e2, q) > step * 0.02) return true;
      }
      return false;
    };
    edges.forEach(([a, b]) => {
      const L = V.len(V.sub(b, a)), n = Math.max(1, Math.ceil(L / step)); let cur = null;
      for (let k = 0; k < n; k++) {
        const m = V.lerp(a, b, (k + 0.5) / n), vis = !blocked(m), p0 = V.lerp(a, b, k / n), p1 = V.lerp(a, b, (k + 1) / n);
        if (cur && cur.vis === vis) cur.b = p1; else { if (cur) out.push(cur); cur = { a: p0, b: p1, vis }; }
      }
      if (cur) out.push(cur);
    });
    return out;
  }
  function drawingSVG(solid, opts = {}) {
    const m = massProps(solid), size = m.size, mn = m.min, step = Math.max(...size) / 160;
    const views = [
      { name: 'FRONT', dir: [0, -1, 0], u: p => p[0] - mn[0], v: p => p[2] - mn[2] },
      { name: 'TOP', dir: [0, 0, 1], u: p => p[0] - mn[0], v: p => p[1] - mn[1] },
      { name: 'RIGHT', dir: [1, 0, 0], u: p => p[1] - mn[1], v: p => p[2] - mn[2] },
    ];
    // A4 landscape in millimetres, room kept for the title block
    const W = 297, H = 210, gap = 22, areaW = W - 20 - 2 * gap, areaH = H - 50 - 2 * gap;
    const scales = [1, 2, 5, 10, 20, 50, 100].flatMap(k => [k, 1 / k]).sort((a, b) => b - a);
    const sc = scales.find(s => (size[0] + size[1]) * s <= areaW && (size[2] + size[1]) * s <= areaH) || 1 / 200;
    const fx = 20 + gap, fy = H - 45 - gap;   // bottom-left corner of the front view on paper
    const place = { FRONT: [fx, fy], TOP: [fx, fy - size[2] * sc - gap], RIGHT: [fx + size[0] * sc + gap, fy] };
    const f2 = x => +x.toFixed(2), out = [];
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif">`,
      `<rect x="0" y="0" width="${W}" height="${H}" fill="#fff"/><rect x="8" y="8" width="${W - 16}" height="${H - 16}" fill="none" stroke="#000" stroke-width="0.5"/>`);
    views.forEach(vw => {
      const [ox, oy] = place[vw.name], P = p => [f2(ox + vw.u(p) * sc), f2(oy - vw.v(p) * sc)];
      const segs = edgeVisibility(solid, featureEdges(solid, 28, vw.dir), vw.dir, step);
      out.push(`<g id="${vw.name.toLowerCase()}">`);
      const line = (s, style) => { const [x1, y1] = P(s.a), [x2, y2] = P(s.b); if (x1 !== x2 || y1 !== y2) out.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${style}/>`); };
      segs.filter(s => !s.vis).forEach(s => line(s, 'stroke="#555" stroke-width="0.18" stroke-dasharray="1.2 0.8"'));
      segs.filter(s => s.vis).forEach(s => line(s, 'stroke="#000" stroke-width="0.35" stroke-linecap="round"'));
      out.push(`<text x="${f2(ox)}" y="${f2(oy + 12)}" font-size="3" fill="#333">${vw.name} VIEW</text></g>`);
    });
    // overall dimensions
    const dim = (x1, y1, x2, y2, txt, vertical) => {
      const a = 1.6, t = vertical ? `<text x="${f2(x1 - 2)}" y="${f2((y1 + y2) / 2)}" font-size="3" text-anchor="middle" transform="rotate(-90 ${f2(x1 - 2)} ${f2((y1 + y2) / 2)})">${txt}</text>` : `<text x="${f2((x1 + x2) / 2)}" y="${f2(y1 - 1.2)}" font-size="3" text-anchor="middle">${txt}</text>`;
      const ar = vertical ? `<path d="M${x1} ${y1} l-0.6 ${-a} h1.2z M${x2} ${y2} l-0.6 ${a} h1.2z"/>` : `<path d="M${x1} ${y1} l${a} -0.6 v1.2z M${x2} ${y2} l${-a} -0.6 v1.2z"/>`;
      return `<g fill="#000" stroke="#000" stroke-width="0.18"><line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>${ar}</g>${t}`;
    };
    const num = x => String(+x.toFixed(2));
    out.push(dim(f2(fx), f2(fy + 6), f2(fx + size[0] * sc), f2(fy + 6), num(size[0]), false));
    out.push(dim(f2(fx - 6), f2(fy), f2(fx - 6), f2(fy - size[2] * sc), num(size[2]), true));
    const [rx, ry] = place.RIGHT; out.push(dim(f2(rx), f2(ry + 6), f2(rx + size[1] * sc), f2(ry + 6), num(size[1]), false));
    // title block
    const tb = [W - 8 - 120, H - 8 - 30], scaleTxt = sc >= 1 ? `${sc}:1` : `1:${Math.round(1 / sc)}`;
    const rows = [['PART', opts.name || 'Part'], ['MATERIAL', opts.material || '—'], ['MASS', opts.mass || '—'], ['SCALE', scaleTxt + '   UNITS mm   THIRD-ANGLE'], ['DRAWN', (opts.date || new Date().toISOString().slice(0, 10)) + '   Lumen CAD']];
    out.push(`<g font-size="3"><rect x="${tb[0]}" y="${tb[1]}" width="120" height="30" fill="none" stroke="#000" stroke-width="0.4"/>`);
    rows.forEach(([k, v], i) => { const y = tb[1] + 6 * i; if (i) out.push(`<line x1="${tb[0]}" y1="${y}" x2="${tb[0] + 120}" y2="${y}" stroke="#000" stroke-width="0.2"/>`); out.push(`<text x="${tb[0] + 2}" y="${y + 4.3}" fill="#555">${k}</text><text x="${tb[0] + 26}" y="${y + 4.3}" font-weight="${i ? 400 : 600}">${String(v).replace(/[<&]/g, c => c === '<' ? '&lt;' : '&amp;')}</text>`); });
    out.push(`<line x1="${tb[0] + 24}" y1="${tb[1]}" x2="${tb[0] + 24}" y2="${tb[1] + 30}" stroke="#000" stroke-width="0.2"/></g></svg>`);
    return { svg: out.join('\n'), scale: sc };
  }

  // ---------- STL / OBJ ----------
  function toSTL(s, name = 'lumen') {
    const tris = s.triangles(), buf = new ArrayBuffer(84 + tris.length * 50), dv = new DataView(buf);
    const head = ('Lumen CAD ' + name).slice(0, 79); for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 127);
    dv.setUint32(80, tris.length, true);
    tris.forEach((t, k) => { const o = 84 + k * 50, n = V.unit(V.cross(V.sub(t[1], t[0]), V.sub(t[2], t[0]))); [n, ...t].forEach((p, j) => p.forEach((x, q) => dv.setFloat32(o + j * 12 + q * 4, x, true))); });
    return new Uint8Array(buf);
  }
  function fromSTL(data) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), tris = [];
    const n = u8.length >= 84 ? dv.getUint32(80, true) : 0;
    if (u8.length === 84 + n * 50 && n > 0) { for (let k = 0; k < n; k++) { const o = 84 + k * 50 + 12, t = []; for (let j = 0; j < 3; j++) t.push([0, 1, 2].map(q => +dv.getFloat32(o + j * 12 + q * 4, true).toFixed(5))); tris.push(t); } return tris; }
    const txt = new TextDecoder().decode(u8), re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g; let m, cur = [];
    while ((m = re.exec(txt))) { cur.push([+m[1], +m[2], +m[3]]); if (cur.length === 3) { tris.push(cur); cur = []; } }
    if (!tris.length) throw new Error('No triangles found — is this an STL file?'); return tris;
  }
  function toOBJ(s) {
    const L = ['# Lumen CAD'], idx = new Map(); let n = 0; const fs = [];
    s.polys.forEach(p => { const ids = p.v.map(v => { const k = v.map(x => x.toFixed(5)).join(' '); if (!idx.has(k)) { idx.set(k, ++n); L.push('v ' + k); } return idx.get(k); }); fs.push('f ' + ids.join(' ')); });
    return L.concat(fs).join('\n') + '\n';
  }

  // ---------- constrained 2-D sketches ----------
  // A sketch is one closed polyline: pts [[x,y],…], segment i runs from pts[i] to pts[i+1 (mod n)].
  // Constraints: {t, s:[segment…], p:[point…], v:'expression', sg:±1, ra/rb: measure an angle against the reversed line}. Values may use the part's parameters.
  const CON = { h: [1, 0, 0], v: [1, 0, 0], len: [1, 0, 1], par: [2, 0, 0], perp: [2, 0, 0], eq: [2, 0, 0], ang: [2, 0, 1], x: [0, 1, 1], y: [0, 1, 1], dist: [0, 2, 1], dx: [0, 2, 1], dy: [0, 2, 1] };
  function sketchResiduals(N, cons, vals) {
    return X => {
      const out = [], P = i => [X[2 * i], X[2 * i + 1]], S = s => { const a = P(s), b = P((s + 1) % N); return [b[0] - a[0], b[1] - a[1]]; };
      cons.forEach((c, k) => {
        const v = vals[k], sg = c.sg < 0 ? -1 : 1;
        switch (c.t) {
          case 'h': out.push(S(c.s[0])[1]); break;
          case 'v': out.push(S(c.s[0])[0]); break;
          case 'len': out.push(Math.hypot(...S(c.s[0])) - v); break;
          case 'eq': out.push(Math.hypot(...S(c.s[0])) - Math.hypot(...S(c.s[1]))); break;
          case 'par': case 'perp': case 'ang': {
            const a = S(c.s[0]).map(x => c.ra ? -x : x), b = S(c.s[1]).map(x => c.rb ? -x : x), la = Math.hypot(...a) || 1e-12, lb = Math.hypot(...b) || 1e-12, L = (la + lb) / 2;
            const cr = (a[0] * b[1] - a[1] * b[0]) / (la * lb), dt = (a[0] * b[0] + a[1] * b[1]) / (la * lb);
            if (c.t === 'par') out.push(cr * L); else if (c.t === 'perp') out.push(dt * L);
            else { let e = Math.atan2(cr, dt) - sg * v * Math.PI / 180; e = Math.atan2(Math.sin(e), Math.cos(e)); out.push(e * L); }
            break;
          }
          case 'x': out.push(P(c.p[0])[0] - v); break;
          case 'y': out.push(P(c.p[0])[1] - v); break;
          case 'dist': { const a = P(c.p[0]), b = P(c.p[1]); out.push(Math.hypot(b[0] - a[0], b[1] - a[1]) - v); break; }
          case 'dx': out.push(P(c.p[1])[0] - P(c.p[0])[0] - sg * v); break;
          case 'dy': out.push(P(c.p[1])[1] - P(c.p[0])[1] - sg * v); break;
        }
      });
      return out;
    };
  }
  function gaussSolve(A, b) {   // in place, partial pivoting
    const n = b.length;
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
      const d = A[c][c] || 1e-300;
      for (let r = c + 1; r < n; r++) { const f = A[r][c] / d; if (!f) continue; for (let k = c; k < n; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) { let s = b[r]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / (A[r][r] || 1e-300); }
    return x;
  }
  function matRank(M, tol) {
    const A = M.map(r => r.slice()), m = A.length, n = m ? A[0].length : 0; let rank = 0;
    for (let c = 0; c < n && rank < m; c++) {
      let p = rank; for (let r = rank + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
      if (Math.abs(A[p][c]) <= tol) continue;
      [A[rank], A[p]] = [A[p], A[rank]];
      for (let r = rank + 1; r < m; r++) { const f = A[r][c] / A[rank][c]; for (let k = c; k < n; k++) A[r][k] -= f * A[rank][k]; }
      rank++;
    }
    return rank;
  }
  // Damped Gauss–Newton with minimum-norm steps: an under-constrained sketch moves as little as possible.
  function solveSketch(pts, cons, ev, opts = {}) {
    const N = pts.length; ev = typeof ev === 'function' ? ev : (vars => e => evalExpr(e == null ? 0 : e, vars))(ev || {});
    if (N < 3) throw new Error('A sketch needs at least 3 points');
    cons.forEach(c => {
      const k = CON[c && c.t]; if (!k) throw new Error('Unknown sketch constraint ' + (c && c.t));
      const okIdx = (arr, len, max) => Array.isArray(arr) && arr.length === len && arr.every(i => Number.isInteger(i) && i >= 0 && i < max);
      if ((k[0] && !okIdx(c.s, k[0], N)) || (k[1] && !okIdx(c.p, k[1], N))) throw new Error('Sketch constraint ' + c.t + ' refers to a missing point or line');
    });
    const vals = cons.map(c => CON[c.t][2] ? ev(c.v) : 0);
    const F = sketchResiduals(N, cons, vals), norm = f => Math.sqrt(f.reduce((s, x) => s + x * x, 0));
    let X = pts.flat().map(Number); if (!X.every(isFinite)) throw new Error('Sketch has an invalid point');
    let f = F(X), nf = norm(f); const n = X.length, m = f.length;
    const scale = Math.max(1, ...X.map(Math.abs)), tol = 1e-9 * scale;
    const jac = () => { const J = Array.from({ length: m }, () => new Array(n)); for (let j = 0; j < n; j++) { const h = 1e-6 * Math.max(1, Math.abs(X[j])), a = X.slice(), b = X.slice(); a[j] += h; b[j] -= h; const fa = F(a), fb = F(b); for (let i = 0; i < m; i++) J[i][j] = (fa[i] - fb[i]) / (2 * h); } return J; };
    for (let it = 0; it < (opts.maxIter || 150) && nf > tol && m; it++) {
      const J = jac(), A = J.map(r => J.map(q => r.reduce((s, x, k) => s + x * q[k], 0)));
      const lam = 1e-10 * (1 + Math.max(...A.map((r, i) => r[i]))); A.forEach((r, i) => r[i] += lam);
      const y = gaussSolve(A, f.slice()), dx = new Array(n).fill(0); for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) dx[j] -= J[i][j] * y[i];
      let a = 1, moved = false;
      for (let ls = 0; ls < 40; ls++, a /= 2) { const Xn = X.map((x, j) => x + a * dx[j]), fn = F(Xn), nn = norm(fn); if (nn < nf) { X = Xn; f = fn; nf = nn; moved = true; break; } }
      if (!moved) break;
    }
    const J = m ? jac() : [], maxJ = Math.max(1e-12, ...J.flat().map(Math.abs)), rank = m ? matRank(J, 1e-7 * maxJ) : 0;
    const out = []; for (let i = 0; i < N; i++) out.push([X[2 * i], X[2 * i + 1]]);
    return { pts: out, ok: nf <= 1e-6 * scale, residual: nf, dof: 2 * N - rank, rank };
  }
  // round the corners of a 2-D loop; radii[i] (0 = sharp) applies at loop vertex i
  function roundCorners(L, radii, step = Math.PI / 18) {
    if (!radii || !radii.some(r => r > 0)) return L.map(p => p.slice());
    const n = L.length, out = [], sub = (a, b) => [a[0] - b[0], a[1] - b[1]], ln = a => Math.hypot(a[0], a[1]);
    const tan = [];
    for (let i = 0; i < n; i++) {
      const r = radii[i] || 0, P = L[i], A = L[(i + n - 1) % n], B = L[(i + 1) % n], la = ln(sub(A, P)), lb = ln(sub(B, P));
      if (!(r > 0) || la < 1e-9 || lb < 1e-9) { tan.push(0); continue; }
      const u1 = sub(A, P).map(x => x / la), u2 = sub(B, P).map(x => x / lb), th = Math.acos(Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])));
      tan.push(th < 1e-4 || th > Math.PI - 1e-4 ? 0 : r / Math.tan(th / 2));
    }
    for (let i = 0; i < n; i++) {   // the two set-backs on a line must fit on it
      const j = (i + 1) % n, len = ln(sub(L[j], L[i]));
      if (tan[i] + tan[j] > len + 1e-9) throw new Error(`Corner radius too large for the line from point ${i + 1} to point ${j + 1}`);
    }
    for (let i = 0; i < n; i++) {
      const P = L[i]; if (!tan[i]) { out.push(P.slice()); continue; }
      const r = radii[i], A = L[(i + n - 1) % n], B = L[(i + 1) % n], la = ln(sub(A, P)), lb = ln(sub(B, P));
      const u1 = sub(A, P).map(x => x / la), u2 = sub(B, P).map(x => x / lb), t = tan[i];
      const T1 = [P[0] + u1[0] * t, P[1] + u1[1] * t], T2 = [P[0] + u2[0] * t, P[1] + u2[1] * t];
      const bis = [u1[0] + u2[0], u1[1] + u2[1]], bl = ln(bis), dc = Math.hypot(t, r), C = [P[0] + bis[0] / bl * dc, P[1] + bis[1] / bl * dc];
      const a1 = Math.atan2(T1[1] - C[1], T1[0] - C[0]); let da = Math.atan2(T2[1] - C[1], T2[0] - C[0]) - a1; da = Math.atan2(Math.sin(da), Math.cos(da));
      const k = Math.max(2, Math.ceil(Math.abs(da) / step));
      for (let q = 0; q <= k; q++) out.push([C[0] + r * Math.cos(a1 + da * q / k), C[1] + r * Math.sin(a1 + da * q / k)]);
    }
    return out;
  }

  // ---------- solid queries ----------
  function bounds(s) { const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]; s.polys.forEach(p => p.v.forEach(v => { for (let k = 0; k < 3; k++) { if (v[k] < min[k]) min[k] = v[k]; if (v[k] > max[k]) max[k] = v[k]; } })); return { min, max, diag: s.polys.length ? V.len(V.sub(max, min)) : 0 }; }
  function insideSolid(s, p) {   // ray parity along an oblique direction
    const d = V.unit([0.5372, 0.6123, 0.5803]); let c = 0;
    s.triangles().forEach(([a, b, q]) => {
      const e1 = V.sub(b, a), e2 = V.sub(q, a), h = V.cross(d, e2), det = V.dot(e1, h); if (Math.abs(det) < 1e-14) return;
      const f = 1 / det, s0 = V.sub(p, a), u = f * V.dot(s0, h); if (u < 0 || u > 1) return;
      const qq = V.cross(s0, e1), v = f * V.dot(d, qq); if (v < 0 || u + v > 1) return;
      if (f * V.dot(e2, qq) > 1e-9) c++;
    });
    return c % 2 === 1;
  }

  // ---------- edge fillet / chamfer (straight edges between two flat faces) ----------
  function matchEdge(s, ref) {
    const dr = V.unit(V.sub(ref.b, ref.a)), mr = V.lerp(ref.a, ref.b, 0.5); let best = null, bs = Infinity;
    featureEdges(s, 28).forEach(([p, q]) => {
      const L = V.len(V.sub(q, p)); if (L < 1e-7) return; const d = V.mul(V.sub(q, p), 1 / L); if (Math.abs(V.dot(d, dr)) < 0.9995) return;
      const w = V.sub(mr, p), t = V.dot(w, d), sc = V.len(V.sub(w, V.mul(d, t))) + Math.max(0, -t, t - L);
      if (sc < bs) { bs = sc; best = [p, q]; }
    });
    return { edge: best, score: bs };
  }
  function edgeNormals(s, a, b) {
    const L = V.len(V.sub(b, a)), d = V.mul(V.sub(b, a), 1 / L), tol = 1e-5 * Math.max(1, L);
    const off = p => { const w = V.sub(p, a); return V.len(V.sub(w, V.mul(d, V.dot(w, d)))); };
    let sets = null;
    for (const fr of [0.2113, 0.5137, 0.7871]) {
      const tm = L * fr, ns = [];
      s.polys.forEach(p => { for (let i = 0; i < p.v.length; i++) { const P = p.v[i], Q = p.v[(i + 1) % p.v.length]; if (off(P) > tol || off(Q) > tol) continue; const tp = V.dot(V.sub(P, a), d), tq = V.dot(V.sub(Q, a), d); if (Math.min(tp, tq) < tm - 1e-9 && Math.max(tp, tq) > tm + 1e-9 && !ns.some(n => V.dot(n, p.plane.n) > 0.99999)) ns.push(p.plane.n); } });
      if (ns.length !== 2) throw new Error('not a straight edge between two flat faces');
      if (sets && !(ns.every(n => sets.some(m => V.dot(m, n) > 0.99999)))) throw new Error('the faces along this edge are not flat');
      sets = ns;
    }
    if (V.dot(sets[0], sets[1]) < -0.9999) throw new Error('edge between opposite faces (zero thickness)');
    return sets;
  }
  function prism3(loop3, m, d, w0, w1, ref) {
    const e1 = V.unit(V.sub(ref, V.mul(d, V.dot(ref, d)))), e2 = V.cross(d, e1);
    const L2 = loop3.map(p => { const w = V.sub(p, m); return [V.dot(w, e1), V.dot(w, e2)]; });
    return prism(L2, (u, v, w) => V.add(m, V.add(V.mul(e1, u), V.add(V.mul(e2, v), V.mul(d, w)))), w0, w1);
  }
  function blendEdge(body, a, b, r, kind, info) {
    const [n1, n2] = edgeNormals(body, a, b), L = V.len(V.sub(b, a)), d = V.mul(V.sub(b, a), 1 / L), m = V.lerp(a, b, 0.5), k = V.dot(n1, n2);
    const bb = bounds(body), convex = !insideSolid(body, V.add(m, V.mul(V.sub(n1, n2), 1e-4 * Math.max(1, bb.diag))));
    const sg = convex ? -1 : 1, c = V.add(m, V.mul(V.add(n1, n2), sg * r / (1 + k)));
    const T1 = V.sub(c, V.mul(n1, sg * r)), T2 = V.sub(c, V.mul(n2, sg * r));
    let loop;
    if (kind === 'chamfer') loop = [m, V.add(m, V.mul(V.unit(V.sub(T1, m)), r)), V.add(m, V.mul(V.unit(V.sub(T2, m)), r))];
    else {
      const w1 = V.mul(V.sub(T1, c), 1 / r), w2 = V.mul(V.sub(T2, c), 1 / r), ang = Math.acos(Math.max(-1, Math.min(1, V.dot(w1, w2)))), st = Math.max(2, Math.ceil(ang / (Math.PI / 24)));
      loop = [m, T1]; for (let j = 1; j < st; j++) { const t = j / st, w = V.mul(V.add(V.mul(w1, Math.sin((1 - t) * ang)), V.mul(w2, Math.sin(t * ang))), 1 / Math.sin(ang)); loop.push(V.add(c, V.mul(w, r))); } loop.push(T2);
    }
    const ext = convex ? 1e-3 * Math.max(1, r) : 0, tool = prism3(loop, m, d, -L / 2 - ext, L / 2 + ext, n1);
    if (info) Object.assign(info, { convex, normals: [n1, n2] });
    return convex ? body.subtract(tool) : body.union(tool);
  }
  // refs: [{a:[x,y,z], b:[x,y,z]}] — each is matched to the closest parallel crease edge of the current body
  function blendEdges(body, refs, r, kind = 'fillet') {
    if (!(r > 0)) throw new Error((kind === 'chamfer' ? 'Chamfer distance' : 'Fillet radius') + ' must be greater than 0');
    if (!refs.length) throw new Error('No edges picked yet');
    refs.forEach((e, i) => {
      if (!e || ![e.a, e.b].every(p => Array.isArray(p) && p.length === 3 && p.every(x => typeof x === 'number' && isFinite(x)))) throw new Error(`Edge ${i + 1} is invalid`);
      const { edge, score } = matchEdge(body, e), diag = bounds(body).diag;
      if (!edge || score > 0.25 * diag + 1e-6) throw new Error(`Edge ${i + 1} no longer exists — pick it again`);
      try { body = blendEdge(body, edge[0], edge[1], r, kind); } catch (x) { throw new Error(`Edge ${i + 1}: ${x.message}`); }
    });
    return body;
  }

  // ---------- hole wizard ----------
  // [clearance Ø (ISO 273 medium), tap drill Ø, counterbore Ø (DIN 974-1, ISO 4762 screws), counterbore depth, 90° countersink Ø (ISO 10642 head + clearance)]
  const HOLE_STD = { M2: [2.4, 1.6, 4.3, 2.4, 4.4], 'M2.5': [2.9, 2.05, 5, 2.9, 5.5], M3: [3.4, 2.5, 6.5, 3.4, 6.9], M4: [4.5, 3.3, 8, 4.4, 9.2], M5: [5.5, 4.2, 10, 5.4, 11.4], M6: [6.6, 5, 11, 6.4, 13.7], M8: [9, 6.8, 15, 8.6, 18.2], M10: [11, 8.5, 18, 10.6, 22.7], M12: [13.5, 10.2, 20, 12.6, 27.2], M16: [17.5, 14, 26, 16.6, 33.9], M20: [22, 17.5, 33, 20.6, 40.6] };
  function holeSpec(std, kind) { const h = HOLE_STD[std] || HOLE_STD.M6; return { d: kind === 'tapped' ? h[1] : h[0], cd: h[2], cdep: h[3], sd: h[4], ang: 90 }; }
  function holeProfile(kind, r, D, through, o) {
    const e = Math.max(0.5, r * 0.5), tip = through ? 0 : r / Math.tan(59 * Math.PI / 180), bot = [[0, -D - tip], [r, -D]];
    if (kind === 'cbore') {
      if (!(o.cd / 2 > r)) throw new Error('Counterbore Ø must be larger than the hole Ø'); if (!(o.cdep > 0 && o.cdep < D)) throw new Error('Counterbore depth must be between 0 and the hole depth');
      return [[0, e], ...bot, [r, -o.cdep], [o.cd / 2, -o.cdep], [o.cd / 2, e]];
    }
    if (kind === 'csink') {
      if (!(o.sd / 2 > r)) throw new Error('Countersink Ø must be larger than the hole Ø'); if (!(o.ang > 0 && o.ang < 180)) throw new Error('Countersink angle must be between 0 and 180°');
      const hs = (o.sd / 2 - r) / Math.tan(o.ang / 2 * Math.PI / 180); if (hs >= D) throw new Error('Countersink is deeper than the hole');
      return [[0, e], ...bot, [r, -hs], [o.sd / 2, 0], [o.sd / 2, e]];
    }
    return [[0, e], ...bot, [r, e]];
  }
  function holeTool(P, ev, body) {
    const kind = ['simple', 'cbore', 'csink', 'tapped'].includes(P.kind) ? P.kind : 'simple', d = ev(P.d), r = d / 2;
    if (!(r > 0)) throw new Error('Hole diameter must be greater than 0');
    const pts = parsePts(P.pts, ev); if (!pts.length) throw new Error('No hole positions yet — click "Pick on a face" or type x,y');
    const off = ev(P.offset), through = P.depth == null || /^\s*(thr\w*)?\s*$/i.test(String(P.depth));
    let D;
    if (through) { const bb = body && body.polys.length ? bounds(body) : null, R = Math.max(10, Math.abs(off), ...pts.flat().map(Math.abs), ...(bb ? bb.min.concat(bb.max).map(Math.abs) : [])); D = 4 * R + 1; }
    else { D = ev(P.depth); if (!(D > 0)) throw new Error('Hole depth must be greater than 0'); }
    const prof = holeProfile(kind === 'tapped' ? 'simple' : kind, r, D, through, { cd: ev(P.cd), cdep: ev(P.cdep), sd: ev(P.sd), ang: P.ang == null || P.ang === '' ? 90 : ev(P.ang) });
    const map = planeMap(P.plane || 'XY', off), sg = P.flip ? -1 : 1; let out = null;
    pts.forEach(([x, y]) => { if (!isFinite(x) || !isFinite(y)) throw new Error('Bad hole position'); const t = revolveLoop(prof, (a, v, b) => map(x + a, y + b, sg * v), 360, 48); out = out ? out.union(t) : t; });
    return out;
  }

  // ---------- watertight export (T-junction repair), 3MF and STEP ----------
  function weld(s, q = 1e4) {
    const key = v => Math.round(v[0] * q) + ',' + Math.round(v[1] * q) + ',' + Math.round(v[2] * q), canon = new Map();
    s.polys.forEach(p => p.v.forEach(v => { const k = key(v); if (!canon.has(k)) canon.set(k, v); }));
    const all = [...canon.values()], bb = bounds(s), G = 32, cs = Math.max(1e-6, bb.diag / G), grid = new Map(), ci = (v, k) => Math.floor((v[k] - bb.min[k]) / cs);
    all.forEach(v => { const g = ci(v, 0) + ',' + ci(v, 1) + ',' + ci(v, 2); if (!grid.has(g)) grid.set(g, []); grid.get(g).push(v); });
    const tol = 2 / q;
    const polys = s.polys.map(p => {
      const vs = p.v.map(v => canon.get(key(v))), out = [];
      for (let i = 0; i < vs.length; i++) {
        const a = vs[i], b = vs[(i + 1) % vs.length]; out.push(a);
        const ab = V.sub(b, a), L = V.len(ab); if (L < tol) continue; const d = V.mul(ab, 1 / L), hits = [];
        const lo = [0, 1, 2].map(k => ci([Math.min(a[k], b[k]) - tol, Math.min(a[k], b[k]) - tol, Math.min(a[k], b[k]) - tol], k)), hi = [0, 1, 2].map(k => ci([Math.max(a[k], b[k]) + tol, Math.max(a[k], b[k]) + tol, Math.max(a[k], b[k]) + tol], k));
        for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
          const cell = grid.get(x + ',' + y + ',' + z); if (!cell) continue;
          cell.forEach(v => { if (v === a || v === b) return; const w = V.sub(v, a), t = V.dot(w, d); if (t <= tol || t >= L - tol) return; if (V.len(V.sub(w, V.mul(d, t))) <= tol) hits.push([t, v]); });
        }
        hits.sort((x, y) => x[0] - y[0]).forEach(h => { if (out[out.length - 1] !== h[1]) out.push(h[1]); });
      }
      const clean = out.filter((v, i) => v !== out[(i + 1) % out.length]);
      return clean.length >= 3 ? new Poly(clean, p.plane.clone()) : null;
    }).filter(Boolean);
    return new Solid(polys);
  }
  // triangles over shared vertex indices, ear-clipping each (welded) polygon in its own plane
  function indexedMesh(s) {
    const w = weld(s), verts = [], idx = new Map(), tris = [];
    const id = v => { if (!idx.has(v)) { idx.set(v, verts.length); verts.push(v); } return idx.get(v); };
    w.polys.forEach(p => {
      const n = p.plane.n, ax = Math.abs(n[0]) > Math.abs(n[1]) ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2) : (Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2);
      const u = (ax + 1) % 3, v = (ax + 2) % 3, L = p.v.map(q => [q[u], q[v]]), flip = area2(L) < 0;
      const tr = triangulate(flip ? L.slice().reverse() : L).map(t => flip ? t.map(i => L.length - 1 - i).reverse() : t);
      tr.forEach(t => tris.push(t.map(i => id(p.v[i]))));
    });
    return { verts, tris };
  }
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipStore(files) {   // [{name, data:Uint8Array|string}] → uncompressed .zip
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    files.forEach(f => {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30)); [[0, 0x04034b50, 4], [4, 20, 2], [6, 0, 2], [8, 0, 2], [10, 0, 2], [12, 0x21, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, name.length, 2], [28, 0, 2]].forEach(([o, v, n]) => n === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
      const c = new DataView(new ArrayBuffer(46)); [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0, 2], [10, 0, 2], [12, 0, 2], [14, 0x21, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, name.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]].forEach(([o, v, n]) => n === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true));
      parts.push(new Uint8Array(h.buffer), name, data); central.push(new Uint8Array(c.buffer), name); off += 30 + name.length + data.length;
    });
    const cdSize = central.reduce((s, x) => s + x.length, 0), e = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, cdSize, 4], [16, off, 4], [20, 0, 2]].forEach(([o, v, n]) => n === 4 ? e.setUint32(o, v, true) : e.setUint16(o, v, true));
    const all = parts.concat(central, [new Uint8Array(e.buffer)]), out = new Uint8Array(all.reduce((s, x) => s + x.length, 0)); let p = 0; all.forEach(x => { out.set(x, p); p += x.length; });
    return out;
  }
  const xmlEsc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
  function to3MF(s, opts = {}) {
    const { verts, tris } = indexedMesh(s), f = x => String(+x.toFixed(5)), name = xmlEsc(opts.name || 'Part');
    const model = ['<?xml version="1.0" encoding="UTF-8"?>', '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
      `<metadata name="Title">${name}</metadata><metadata name="Application">Lumen CAD</metadata>`, '<resources>', `<basematerials id="1"><base name="${name}" displaycolor="${opts.color || '#B9C6D4'}"/></basematerials>`,
      `<object id="2" type="model" name="${name}" pid="1" pindex="0"><mesh><vertices>`, ...verts.map(v => `<vertex x="${f(v[0])}" y="${f(v[1])}" z="${f(v[2])}"/>`), '</vertices><triangles>',
      ...tris.map(t => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`), '</triangles></mesh></object>', '</resources>', '<build><item objectid="2"/></build>', '</model>'].join('\n');
    return zipStore([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>' },
      { name: '3D/3dmodel.model', data: model },
    ]);
  }
  // STEP AP214 faceted B-rep: every planar polygon becomes a FACE_SURFACE on a PLANE bounded by a POLY_LOOP
  function toSTEP(s, opts = {}) {
    const w = weld(s), L = [], pid = new Map(); let n = 0;
    const R = x => { let t = String(+(Math.abs(x) < 5e-7 ? 0 : x).toFixed(6)); if (!/[.e]/i.test(t)) t += '.'; return t.toUpperCase(); };
    const str = x => "'" + String(x).replace(/[^ -~]/g, '_').replace(/\\/g, '\\\\').replace(/'/g, "''") + "'";
    const add = e => { L.push(`#${++n}=${e};`); return '#' + n; };
    const name = str(opts.name || 'Part'), date = (opts.date || new Date().toISOString()).slice(0, 19);
    const ctx = add("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
    add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ctx})`);
    const pc = add(`PRODUCT_CONTEXT('',${ctx},'mechanical')`), prod = add(`PRODUCT(${name},${name},'',(${pc}))`);
    const pdf = add(`PRODUCT_DEFINITION_FORMATION('','',${prod})`), pdc = add(`PRODUCT_DEFINITION_CONTEXT('part definition',${ctx},'design')`);
    const pd = add(`PRODUCT_DEFINITION('design','',${pdf},${pdc})`), pds = add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
    add(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${prod}))`);
    const lu = add('(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.))'), au = add('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))'), su = add('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
    const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-05),${lu},'distance_accuracy_value','confusion accuracy')`);
    const gc = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${lu},${au},${su}))REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY'))`);
    const o = add("CARTESIAN_POINT('',(0.,0.,0.))"), z = add("DIRECTION('',(0.,0.,1.))"), x = add("DIRECTION('',(1.,0.,0.))"), ax = add(`AXIS2_PLACEMENT_3D('',${o},${z},${x})`);
    const pt = v => { if (!pid.has(v)) pid.set(v, add(`CARTESIAN_POINT('',(${v.map(R).join(',')}))`)); return pid.get(v); };
    const faces = [];
    w.polys.forEach(p => {
      const loop = add(`POLY_LOOP('',(${p.v.map(pt).join(',')}))`), nn = p.plane.n;
      let rd = null; for (let i = 1; i < p.v.length && !rd; i++) { const d = V.sub(p.v[i], p.v[0]); if (V.len(d) > 1e-7) rd = V.unit(V.sub(d, V.mul(nn, V.dot(d, nn)))); }
      const pl = add(`PLANE('',${add(`AXIS2_PLACEMENT_3D('',${pt(p.v[0])},${add(`DIRECTION('',(${nn.map(R).join(',')}))`)},${add(`DIRECTION('',(${rd.map(R).join(',')}))`)})`)})`);
      faces.push(add(`FACE_SURFACE('',(${add(`FACE_OUTER_BOUND('',${loop},.T.)`)}),${pl},.T.)`));
    });
    const shell = add(`CLOSED_SHELL('',(${faces.join(',')}))`), brep = add(`FACETED_BREP(${name},${shell})`);
    const rep = add(`FACETED_BREP_SHAPE_REPRESENTATION(${name},(${brep},${ax}),${gc})`);
    add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
    return ['ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('Lumen CAD faceted solid'),'2;1');", `FILE_NAME(${name},'${date}',('Lumen CAD'),(''),'Lumen CAD','Lumen CAD','');`,
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));", 'ENDSEC;', 'DATA;', ...L, 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');
  }

  const api = { shapeOf, parsePts, solveSketch, roundCorners, CON, bounds, insideSolid, matchEdge, edgeNormals, blendEdge, blendEdges, HOLE_STD, holeSpec, holeTool, weld, indexedMesh, crc32, zipStore, to3MF, toSTEP, drawingSVG, edgeVisibility, featureEdges, V, Solid, Poly, Plane, fromFaces, box, cylinder, cone, sphere, torus, extrude, revolve, loopOf, triangulate, area2, evalExpr, evalParams, build, toolOf, volumeOf, massProps, toSTL, fromSTL, toOBJ, place, rotMat };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CadKernel = api;
})(typeof self !== 'undefined' ? self : this);
