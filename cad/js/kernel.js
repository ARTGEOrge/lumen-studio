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
    union(o) { const a = new Node(this.clone().polys), b = new Node(o.clone().polys); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.all()); return new Solid(a.all()); }
    subtract(o) { const a = new Node(this.clone().polys), b = new Node(o.clone().polys); a.invert(); a.clipTo(b); b.clipTo(a); b.invert(); b.clipTo(a); b.invert(); a.build(b.all()); a.invert(); return new Solid(a.all()); }
    intersect(o) { const a = new Node(this.clone().polys), b = new Node(o.clone().polys); a.invert(); b.clipTo(a); b.invert(); a.clipTo(b); b.clipTo(a); a.build(b.all()); a.invert(); return new Solid(a.all()); }
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
  function toolOf(f, ev) {
    const P = f.p || {}, n = k => ev(P[k]);
    let s;
    switch (f.type) {
      case 'box': s = box(n('w'), n('d'), n('h')); break;
      case 'cylinder': s = cylinder(n('r'), n('h'), Math.round(n('seg') || 64)); break;
      case 'cone': s = cone(n('r1'), n('r2'), n('h'), 64); break;
      case 'sphere': s = sphere(n('r'), 40); break;
      case 'torus': s = torus(n('R'), n('r'), 64, 24); break;
      case 'extrude': case 'revolve': {
        const sk = { plane: P.plane || 'XY', offset: n('offset'), shapes: (P.shapes || []).map(sh => { const o = { type: sh.type, hole: !!sh.hole }; ['x', 'y', 'w', 'h', 'r', 'n', 'l'].forEach(k => { if (sh[k] != null) o[k] = ev(sh[k]); }); if (sh.type === 'points') o.pts = String(sh.pts || '').split(';').map(q => q.trim()).filter(Boolean).map(q => q.split(',').map(t => ev(t.trim()))); return o; }) };
        s = f.type === 'extrude' ? extrude(sk, n('dist'), !!P.symmetric) : revolve(sk, n('angle') || 360, 64); break;
      }
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
        const t = toolOf(f, ev); const op = f.op || 'add';
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
  function featureEdges(solid, angleDeg = 25) {
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
        for (let i = 0; i < ns.length && !crease; i++) for (let j = i + 1; j < ns.length; j++) if (V.dot(ns[i], ns[j]) < cosT && V.dot(ns[i], ns[j]) > -0.999) { crease = true; break; }
        if (ns.length && crease) { if (runStart == null) runStart = cuts[k]; }
        else if (runStart != null) { out.push([V.add(g.foot, V.mul(g.d, runStart)), V.add(g.foot, V.mul(g.d, cuts[k]))]); runStart = null; }
      }
      if (runStart != null) out.push([V.add(g.foot, V.mul(g.d, runStart)), V.add(g.foot, V.mul(g.d, cuts[cuts.length - 1]))]);
    });
    return out;
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

  const api = { featureEdges, V, Solid, Poly, Plane, fromFaces, box, cylinder, cone, sphere, torus, extrude, revolve, loopOf, triangulate, area2, evalExpr, evalParams, build, toolOf, volumeOf, massProps, toSTL, fromSTL, toOBJ, place, rotMat };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CadKernel = api;
})(typeof self !== 'undefined' ? self : this);
