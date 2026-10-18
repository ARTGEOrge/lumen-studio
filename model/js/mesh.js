// Lumen 3D — polygon mesh core: primitives, topology, edit operations and modifiers.
// A mesh is { v: [[x,y,z]...], f: [[i,j,k,...]...], uv: [ [[u,v]...] | null ] (parallel to f) }.
// Faces are counter-clockwise seen from outside. Operations never mutate their input; they return
// { mesh, sel } where sel = { V:Set, E:Set(edge keys), F:Set } is the new selection.
// Works in the browser (window.LMesh) and in Node (module.exports).
(function (root) {
  'use strict';
  const EK = 4194304; // edge key multiplier (supports up to 4M vertices)
  const ekey = (a, b) => a < b ? a * EK + b : b * EK + a;
  const ekeyA = k => Math.floor(k / EK), ekeyB = k => k % EK;

  // ---------- vector helpers ----------
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a); return l > 1e-20 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0]; };
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const avg = pts => { const s = [0, 0, 0]; pts.forEach(p => { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }); return mul(s, 1 / Math.max(1, pts.length)); };
  const avg2 = pts => { let u = 0, v = 0; pts.forEach(p => { u += p[0]; v += p[1]; }); return [u / pts.length, v / pts.length]; };

  // ---------- basics ----------
  function make(v, f, uv) { return { v, f, uv: uv || f.map(() => null) }; }
  function clone(m) { return { v: m.v.map(p => p.slice()), f: m.f.map(f => f.slice()), uv: (m.uv || m.f.map(() => null)).map(u => u ? u.map(x => x.slice()) : null) }; }
  function emptySel() { return { V: new Set(), E: new Set(), F: new Set() }; }
  function faceNormal(m, f) { // Newell's method (robust for n-gons)
    let nx = 0, ny = 0, nz = 0; const n = f.length;
    for (let i = 0; i < n; i++) { const a = m.v[f[i]], b = m.v[f[(i + 1) % n]]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
    return norm([nx, ny, nz]);
  }
  function faceArea(m, f) {
    let nx = 0, ny = 0, nz = 0; const n = f.length;
    for (let i = 0; i < n; i++) { const a = m.v[f[i]], b = m.v[f[(i + 1) % n]]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
    return Math.hypot(nx, ny, nz) / 2;
  }
  const faceCenter = (m, f) => avg(f.map(i => m.v[i]));
  function edgeMap(m) { // edge key -> [face indices]
    const map = new Map();
    m.f.forEach((f, fi) => { for (let i = 0; i < f.length; i++) { const k = ekey(f[i], f[(i + 1) % f.length]); let a = map.get(k); if (!a) map.set(k, a = []); a.push(fi); } });
    return map;
  }
  function edges(m) { return [...edgeMap(m).keys()].map(k => [ekeyA(k), ekeyB(k)]); }
  function vertFaces(m) { const vf = m.v.map(() => []); m.f.forEach((f, fi) => f.forEach(i => vf[i].push(fi))); return vf; }
  function bbox(m) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    m.v.forEach(p => { for (let k = 0; k < 3; k++) { if (p[k] < mn[k]) mn[k] = p[k]; if (p[k] > mx[k]) mx[k] = p[k]; } });
    if (!m.v.length) return { min: [0, 0, 0], max: [0, 0, 0] };
    return { min: mn, max: mx };
  }

  // topology report used by the tests and the status bar
  function stats(m) {
    const em = edgeMap(m); let boundary = 0, nonManifold = 0;
    em.forEach(fs => { if (fs.length === 1) boundary++; else if (fs.length > 2) nonManifold++; });
    const half = new Set(); let flipped = 0;
    m.f.forEach(f => { for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length], k = a * EK + b; if (half.has(k)) flipped++; half.add(k); } });
    const used = new Set(); m.f.forEach(f => f.forEach(i => used.add(i)));
    let degenerate = 0; m.f.forEach(f => { if (f.length < 3 || new Set(f).size !== f.length) degenerate++; });
    const V = m.v.length, E = em.size, F = m.f.length;
    return { V, E, F, tris: m.f.reduce((s, f) => s + f.length - 2, 0), boundary, nonManifold, flipped, loose: V - used.size, degenerate,
      euler: V - E + F, manifold: boundary === 0 && nonManifold === 0 && flipped === 0 && degenerate === 0, closed: boundary === 0 };
  }
  function volume(m) { // signed volume (positive for closed outward meshes)
    let vol = 0; m.f.forEach(f => { const a = m.v[f[0]]; for (let i = 1; i + 1 < f.length; i++) vol += dot(a, cross(m.v[f[i]], m.v[f[i + 1]])) / 6; }); return vol;
  }

  // remove unused vertices, degenerate faces; keeps uv arrays in sync. Returns {mesh, map(old->new or -1)}
  function compact(m) {
    const faces = [], uvs = [];
    m.f.forEach((f, fi) => {
      const u = m.uv && m.uv[fi]; const nf = [], nu = [];
      for (let i = 0; i < f.length; i++) { if (f[i] !== f[(i + 1) % f.length]) { nf.push(f[i]); if (u) nu.push(u[i]); } }
      if (nf.length >= 3 && new Set(nf).size === nf.length) { faces.push(nf); uvs.push(u && nu.length === nf.length ? nu : null); }
    });
    const used = new Int32Array(m.v.length).fill(-1), v = [];
    faces.forEach(f => f.forEach(i => { if (used[i] < 0) { used[i] = v.length; v.push(m.v[i]); } }));
    return { mesh: { v, f: faces.map(f => f.map(i => used[i])), uv: uvs }, map: used };
  }
  const remapSet = (s, map) => { const o = new Set(); s.forEach(i => { if (map[i] >= 0) o.add(map[i]); }); return o; };

  // ---------- selection helpers ----------
  // complete a selection from its primary component; mode = 'vert' | 'edge' | 'face'
  function flush(m, mode, sel) {
    const V = new Set(), E = new Set(), F = new Set();
    if (mode === 'vert') {
      sel.V.forEach(i => i < m.v.length && V.add(i));
      m.f.forEach((f, fi) => { let all = true; for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length]; if (V.has(a) && V.has(b)) E.add(ekey(a, b)); if (!V.has(a)) all = false; } if (all) F.add(fi); });
    } else if (mode === 'edge') {
      sel.E.forEach(k => { const a = ekeyA(k), b = ekeyB(k); if (a < m.v.length && b < m.v.length) { E.add(k); V.add(a); V.add(b); } });
      m.f.forEach((f, fi) => { let all = true; for (let i = 0; i < f.length; i++) if (!E.has(ekey(f[i], f[(i + 1) % f.length]))) { all = false; break; } if (all) F.add(fi); });
    } else {
      sel.F.forEach(fi => { const f = m.f[fi]; if (!f) return; F.add(fi); for (let i = 0; i < f.length; i++) { V.add(f[i]); E.add(ekey(f[i], f[(i + 1) % f.length])); } });
    }
    return { V, E, F };
  }
  function selectAll(m) { const s = { V: new Set(m.v.map((_, i) => i)), E: new Set(), F: new Set() }; return flush(m, 'vert', s); }
  function invertSel(m, mode, sel) {
    if (mode === 'vert') return flush(m, 'vert', { V: new Set(m.v.map((_, i) => i).filter(i => !sel.V.has(i))) });
    if (mode === 'edge') return flush(m, 'edge', { E: new Set([...edgeMap(m).keys()].filter(k => !sel.E.has(k))) });
    return flush(m, 'face', { F: new Set(m.f.map((_, i) => i).filter(i => !sel.F.has(i))) });
  }
  function selectLinked(m, mode, sel) {
    const adj = m.v.map(() => []); m.f.forEach(f => { for (let i = 0; i < f.length; i++) { adj[f[i]].push(f[(i + 1) % f.length]); adj[f[(i + 1) % f.length]].push(f[i]); } });
    const V = new Set(sel.V), st = [...V];
    while (st.length) { const v = st.pop(); adj[v].forEach(w => { if (!V.has(w)) { V.add(w); st.push(w); } }); }
    const full = flush(m, 'vert', { V });
    return full;
  }
  // edge loop through quads, starting from edge (a,b)
  function edgeLoop(m, a, b) {
    const em = edgeMap(m), vf = vertFaces(m), loop = new Set([ekey(a, b)]);
    const valence = v => { const s = new Set(); vf[v].forEach(fi => { const f = m.f[fi], i = f.indexOf(v); s.add(f[(i + 1) % f.length]); s.add(f[(i - 1 + f.length) % f.length]); }); return s; };
    const walk = (from, to) => {
      for (let guard = 0; guard < 100000; guard++) {
        const nb = valence(to); if (nb.size !== 4 || vf[to].length !== 4) return;
        // faces around the edge from->to; the next edge shares no face with it
        const fs = em.get(ekey(from, to)) || [], shared = new Set(); fs.forEach(fi => m.f[fi].forEach(x => shared.add(x)));
        let next = -1; nb.forEach(w => { if (w !== from && !shared.has(w)) next = w; });
        if (next < 0) return; const k = ekey(to, next); if (loop.has(k)) return; loop.add(k); from = to; to = next;
      }
    };
    walk(a, b); walk(b, a);
    return flush(m, 'edge', { E: loop });
  }
  // ring of edges across quads (used by loop cut). Returns [{a,b}] oriented edges and quads between, plus closed flag
  function edgeRing(m, a, b) {
    const em = edgeMap(m);
    const step = (x, y, fromFace) => { // returns list of {fi, x, y, nx, ny}
      const out = []; let fi = fromFace, guard = 0;
      while (fi != null && guard++ < 100000) {
        const f = m.f[fi]; if (f.length !== 4) break;
        const i = f.indexOf(x), j = f.indexOf(y);
        // opposite verts: x' is neighbour of x that isn't y, y' likewise
        const xn = f[(i + 1) % 4] === y ? f[(i + 3) % 4] : f[(i + 1) % 4];
        const yn = f[(j + 1) % 4] === x ? f[(j + 3) % 4] : f[(j + 1) % 4];
        out.push({ fi, x, y, nx: xn, ny: yn });
        const fs = em.get(ekey(xn, yn)) || []; const nf = fs.find(g => g !== fi);
        x = xn; y = yn; fi = nf;
        if (fi === fromFace) { out.closed = true; break; }
        if (out.some(o => o.fi === fi)) break;
      }
      return out;
    };
    const fs = em.get(ekey(a, b)) || []; if (!fs.length) return null;
    let fwd = step(a, b, fs[0]);
    if (fwd.closed) return { quads: fwd, closed: true };
    let back = fs[1] != null && m.f[fs[1]].length === 4 ? step(a, b, fs[1]) : [];
    // stitch: back goes the other way; reverse it so the ring runs continuously
    const quads = [...back.reverse().map(q => ({ fi: q.fi, x: q.nx, y: q.ny, nx: q.x, ny: q.y })), ...fwd];
    return { quads, closed: false };
  }

  // ---------- primitives (Blender-like default sizes) ----------
  function cube(s = 1) {
    const v = [[-s, -s, -s], [s, -s, -s], [s, s, -s], [-s, s, -s], [-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]];
    const f = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
    const q = [[0, 0], [1, 0], [1, 1], [0, 1]];
    return make(v, f, f.map(() => q.map(x => x.slice())));
  }
  function plane(s = 1) { return make([[-s, -s, 0], [s, -s, 0], [s, s, 0], [-s, s, 0]], [[0, 1, 2, 3]], [[[0, 0], [1, 0], [1, 1], [0, 1]]]); }
  function grid(nx = 10, ny = 10, s = 1) {
    const v = [], f = [], uv = [];
    for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) v.push([-s + 2 * s * i / nx, -s + 2 * s * j / ny, 0]);
    const id = (i, j) => j * (nx + 1) + i;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { f.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]); uv.push([[i / nx, j / ny], [(i + 1) / nx, j / ny], [(i + 1) / nx, (j + 1) / ny], [i / nx, (j + 1) / ny]]); }
    return make(v, f, uv);
  }
  function uvSphere(seg = 32, rings = 16, r = 1) {
    const v = [[0, 0, -r]], f = [], uv = [];
    for (let j = 1; j < rings; j++) { const th = Math.PI * j / rings - Math.PI / 2; for (let i = 0; i < seg; i++) { const ph = 2 * Math.PI * i / seg; v.push([r * Math.cos(th) * Math.cos(ph), r * Math.cos(th) * Math.sin(ph), r * Math.sin(th)]); } }
    v.push([0, 0, r]); const top = v.length - 1, id = (j, i) => 1 + (j - 1) * seg + (i % seg);
    for (let i = 0; i < seg; i++) { f.push([0, id(1, i + 1), id(1, i)]); uv.push([[(i + .5) / seg, 0], [(i + 1) / seg, 1 / rings], [i / seg, 1 / rings]]); }
    for (let j = 1; j < rings - 1; j++) for (let i = 0; i < seg; i++) { f.push([id(j, i), id(j, i + 1), id(j + 1, i + 1), id(j + 1, i)]); uv.push([[i / seg, j / rings], [(i + 1) / seg, j / rings], [(i + 1) / seg, (j + 1) / rings], [i / seg, (j + 1) / rings]]); }
    for (let i = 0; i < seg; i++) { f.push([id(rings - 1, i), id(rings - 1, i + 1), top]); uv.push([[i / seg, (rings - 1) / rings], [(i + 1) / seg, (rings - 1) / rings], [(i + .5) / seg, 1]]); }
    return make(v, f, uv);
  }
  function icoSphere(sub = 2, r = 1) {
    const t = (1 + Math.sqrt(5)) / 2;
    let v = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map(p => mul(norm(p), r));
    let f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let s = 0; s < sub; s++) {
      const mid = new Map(), nf = [];
      const m = (a, b) => { const k = ekey(a, b); if (!mid.has(k)) { mid.set(k, v.length); v.push(mul(norm(add(v[a], v[b])), r)); } return mid.get(k); };
      f.forEach(([a, b, c]) => { const ab = m(a, b), bc = m(b, c), ca = m(c, a); nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); });
      f = nf;
    }
    return make(v, f);
  }
  function cylinder(n = 32, r = 1, h = 2, caps = true) { return cone(n, r, r, h, caps); }
  function cone(n = 32, r1 = 1, r2 = 0, h = 2, caps = true) {
    const v = [], f = [], uv = [], z0 = -h / 2, z1 = h / 2;
    for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; v.push([r1 * Math.cos(a), r1 * Math.sin(a), z0]); }
    const tip = r2 <= 1e-9;
    if (tip) v.push([0, 0, z1]); else for (let i = 0; i < n; i++) { const a = 2 * Math.PI * i / n; v.push([r2 * Math.cos(a), r2 * Math.sin(a), z1]); }
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (tip) { f.push([i, j, n]); uv.push([[i / n, 0], [(i + 1) / n, 0], [(i + .5) / n, 1]]); }
      else { f.push([i, j, n + j, n + i]); uv.push([[i / n, 0], [(i + 1) / n, 0], [(i + 1) / n, 1], [i / n, 1]]); }
    }
    const cu = i => { const a = 2 * Math.PI * i / n; return [.5 + .5 * Math.cos(a), .5 + .5 * Math.sin(a)]; };
    if (caps) {
      const bot = []; for (let i = n - 1; i >= 0; i--) bot.push(i); f.push(bot); uv.push(bot.map(cu));
      if (!tip) { const topf = []; for (let i = 0; i < n; i++) topf.push(n + i); f.push(topf); uv.push(topf.map((_, i) => cu(i))); }
    }
    return make(v, f, uv);
  }
  function torus(R = 1, r = 0.25, nu = 48, nv = 12) {
    const v = [], f = [], uv = [];
    for (let i = 0; i < nu; i++) { const a = 2 * Math.PI * i / nu; for (let j = 0; j < nv; j++) { const b = 2 * Math.PI * j / nv; v.push([(R + r * Math.cos(b)) * Math.cos(a), (R + r * Math.cos(b)) * Math.sin(a), r * Math.sin(b)]); } }
    const id = (i, j) => (i % nu) * nv + (j % nv);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { f.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]); uv.push([[i / nu, j / nv], [(i + 1) / nu, j / nv], [(i + 1) / nu, (j + 1) / nv], [i / nu, (j + 1) / nv]]); }
    return make(v, f, uv);
  }
  const PRIMS = {
    cube: p => cube(p.size ?? 1), plane: p => plane(p.size ?? 1), grid: p => grid(p.x ?? 10, p.y ?? 10, p.size ?? 1),
    uvsphere: p => uvSphere(p.segments ?? 32, p.rings ?? 16, p.radius ?? 1), icosphere: p => icoSphere(p.subdiv ?? 2, p.radius ?? 1),
    cylinder: p => cylinder(p.vertices ?? 32, p.radius ?? 1, p.depth ?? 2), cone: p => cone(p.vertices ?? 32, p.radius1 ?? 1, p.radius2 ?? 0, p.depth ?? 2),
    torus: p => torus(p.major ?? 1, p.minor ?? 0.25, p.majorSeg ?? 48, p.minorSeg ?? 12),
  };

  // ---------- edit operations ----------
  // region extrude of selected faces; or of selected edges if no faces are selected. New geometry is not moved
  // (the caller moves sel.V along `normal`).
  function extrude(m0, sel) {
    const m = clone(m0);
    if (sel.F.size) {
      const em = new Map(); // edge -> count of selected faces using it
      sel.F.forEach(fi => { const f = m.f[fi]; for (let i = 0; i < f.length; i++) { const k = ekey(f[i], f[(i + 1) % f.length]); em.set(k, (em.get(k) || 0) + 1); } });
      const all = edgeMap(m0), dup = new Map(), nd = v => { if (!dup.has(v)) { dup.set(v, m.v.length); m.v.push(m.v[v].slice()); } return dup.get(v); };
      const sides = [];
      let nrm = [0, 0, 0];
      sel.F.forEach(fi => {
        const f = m0.f[fi]; nrm = add(nrm, mul(faceNormal(m0, f), faceArea(m0, f)));
        for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length]; if (em.get(ekey(a, b)) === 1) sides.push([a, b]); }
      });
      // a closed fully-selected shell has no sides: extrude duplicates it, keep the original shell
      const keepOld = !sides.length && sel.F.size === m0.f.length;
      sel.F.forEach(fi => { m.f[fi] = m.f[fi].map(nd); });
      sides.forEach(([a, b]) => { m.f.push([a, b, nd(b), nd(a)]); m.uv.push(null); });
      if (keepOld) sel.F.forEach(fi => { m.f.push(m0.f[fi].slice().reverse()); m.uv.push(null); });
      const c = compact(m), F = remapFaces(sel.F, m, c);
      void all;
      return { mesh: c.mesh, sel: flush(c.mesh, 'face', { F }), normal: norm(nrm) };
    }
    if (sel.E.size) {
      const em = edgeMap(m0), dup = new Map(), nd = v => { if (!dup.has(v)) { dup.set(v, m.v.length); m.v.push(m.v[v].slice()); } return dup.get(v); };
      const E = new Set(); let nrm = [0, 0, 0];
      sel.E.forEach(k => {
        const fs = em.get(k) || []; let a = ekeyA(k), b = ekeyB(k);
        if (fs.length > 1) return; // only boundary edges can be extruded without making non-manifold geometry
        if (fs.length === 1) { const f = m0.f[fs[0]], i = f.indexOf(a); if (f[(i + 1) % f.length] !== b) { const t = a; a = b; b = t; } nrm = add(nrm, faceNormal(m0, f)); }
        m.f.push([b, a, nd(a), nd(b)]); m.uv.push(null); E.add(ekey(nd(a), nd(b)));
      });
      // direction: away from the faces along the boundary (in-plane)
      let dir = [0, 0, 0];
      sel.E.forEach(k => { const fs = em.get(k) || []; if (fs.length !== 1) return; const a = m0.v[ekeyA(k)], b = m0.v[ekeyB(k)], c = faceCenter(m0, m0.f[fs[0]]), mid = lerp(a, b, .5); dir = add(dir, norm(sub(mid, c))); });
      return { mesh: m, sel: flush(m, 'edge', { E }), normal: len(dir) > 1e-9 ? norm(dir) : norm(nrm) };
    }
    return { mesh: m, sel, normal: [0, 0, 1] };
  }
  function remapFaces(F, m, c) { // faces keep index through compact unless dropped; compute new index by counting kept faces
    const keep = new Int32Array(m.f.length).fill(-1); let n = 0;
    m.f.forEach((f, fi) => { const nf = f.filter((x, i) => x !== f[(i + 1) % f.length]); if (nf.length >= 3 && new Set(nf).size === nf.length) keep[fi] = n++; });
    const o = new Set(); F.forEach(fi => { if (keep[fi] >= 0) o.add(keep[fi]); }); void c; return o;
  }

  // inset faces (region or individual); depth moves the inner faces along their normal
  function inset(m0, sel, thickness = 0.1, depth = 0, individual = false) {
    let m = clone(m0);
    const groups = individual ? [...sel.F].map(fi => [fi]) : [[...sel.F]];
    groups.forEach(group => {
      const gset = new Set(group), em = new Map();
      group.forEach(fi => { const f = m.f[fi]; for (let i = 0; i < f.length; i++) { const k = ekey(f[i], f[(i + 1) % f.length]); em.set(k, (em.get(k) || 0) + 1); } });
      const bnd = []; // boundary half-edges [a,b,fi]
      group.forEach(fi => { const f = m.f[fi]; for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length]; if (em.get(ekey(a, b)) === 1) bnd.push([a, b, fi]); } });
      const inward = new Map(); // vertex -> list of inward edge directions
      bnd.forEach(([a, b, fi]) => {
        const n = faceNormal(m, m.f[fi]), d = norm(sub(m.v[b], m.v[a])), inn = norm(cross(n, d));
        [a, b].forEach(v => { if (!inward.has(v)) inward.set(v, []); inward.get(v).push(inn); });
      });
      const nv = new Map();
      inward.forEach((dirs, v) => {
        let mdir = norm(dirs.reduce(add, [0, 0, 0]));
        if (len(mdir) < 1e-9) mdir = dirs[0];
        let c = Math.max(0.25, Math.min(...dirs.map(d => dot(mdir, d))));
        nv.set(v, m.v.length); m.v.push(add(m.v[v], mul(mdir, thickness / c)));
      });
      group.forEach(fi => { m.f[fi] = m.f[fi].map(v => nv.has(v) ? nv.get(v) : v); });
      bnd.forEach(([a, b]) => { m.f.push([a, b, nv.get(b), nv.get(a)]); m.uv.push(null); });
      if (depth) {
        let n = [0, 0, 0]; group.forEach(fi => { n = add(n, mul(faceNormal(m, m.f[fi]), faceArea(m, m.f[fi]))); }); n = norm(n);
        const moved = new Set(); group.forEach(fi => m.f[fi].forEach(v => moved.add(v)));
        moved.forEach(v => { m.v[v] = add(m.v[v], mul(n, depth)); });
      }
      void gset;
    });
    const c = compact(m);
    return { mesh: c.mesh, sel: flush(c.mesh, 'face', { F: remapFaces(sel.F, m, c) }) };
  }

  // bevel selected (manifold) edges with one segment of the given width
  function bevel(m0, sel, width = 0.1) {
    const em = edgeMap(m0), S = new Set([...sel.E].filter(k => (em.get(k) || []).length === 2));
    if (!S.size) return { mesh: clone(m0), sel: emptySel() };
    // clamp width to keep it below half the shortest affected edge
    let minL = Infinity; const touched = new Set(); S.forEach(k => { touched.add(ekeyA(k)); touched.add(ekeyB(k)); });
    em.forEach((_, k) => { const a = ekeyA(k), b = ekeyB(k); if (touched.has(a) || touched.has(b)) minL = Math.min(minL, len(sub(m0.v[a], m0.v[b]))); });
    const w = Math.min(width, minL * 0.49);
    const v = m0.v.map(p => p.slice()), faces = [], uvs = [];
    const slide = new Map(), inner = new Map();
    const slideV = (p, q) => { const k = p * EK + q; if (!slide.has(k)) { slide.set(k, v.length); v.push(add(m0.v[p], mul(norm(sub(m0.v[q], m0.v[p])), w))); } return slide.get(k); };
    const rep = new Map(); // fi*EK+v -> replacement list
    m0.f.forEach((f, fi) => {
      const n = f.length, out = [], fnrm = faceNormal(m0, f);
      for (let i = 0; i < n; i++) {
        const c = f[i], p = f[(i - 1 + n) % n], q = f[(i + 1) % n];
        if (!touched.has(c)) { out.push(c); continue; }
        const sa = S.has(ekey(p, c)), sb = S.has(ekey(c, q)); let r;
        if (!sa && !sb) r = [slideV(c, p), slideV(c, q)];
        else if (sa && !sb) r = [slideV(c, q)];
        else if (!sa && sb) r = [slideV(c, p)];
        else { // corner between two bevelled edges: point at distance w from both edges inside the face
          const d1 = norm(sub(m0.v[p], m0.v[c])), d2 = norm(sub(m0.v[q], m0.v[c])), s = Math.max(0.2, len(cross(d1, d2)));
          const k = fi * EK + c; inner.set(k, v.length); v.push(add(m0.v[c], mul(add(d1, d2), w / s))); r = [inner.get(k)]; void fnrm;
        }
        rep.set(fi * EK + c, r); out.push(...r);
      }
      faces.push(out); uvs.push(out.length === n && m0.uv && m0.uv[fi] ? m0.uv[fi] : null);
    });
    const newFaces = [];
    S.forEach(k => {
      const [F1, F2] = em.get(k); let a = ekeyA(k), b = ekeyB(k);
      const f1 = m0.f[F1], i1 = f1.indexOf(a); let F = F1, G = F2;
      if (f1[(i1 + 1) % f1.length] !== b) { F = F2; G = F1; } // F has a->b
      const rFa = rep.get(F * EK + a), rFb = rep.get(F * EK + b), rGb = rep.get(G * EK + b), rGa = rep.get(G * EK + a);
      const A1 = rFa[rFa.length - 1], B1 = rFb[0], B2 = rGb[rGb.length - 1], A2 = rGa[0];
      const strip = [B1, A1, A2, B2].filter((x, i, arr) => x !== arr[(i + 1) % 4]);
      if (strip.length >= 3) { faces.push(strip); uvs.push(null); newFaces.push(faces.length - 1); }
    });
    // caps: unmatched half-edges whose endpoints are new vertices of the same original vertex
    const owner = new Map(); slide.forEach((nvI, k) => owner.set(nvI, Math.floor(k / EK))); inner.forEach((nvI, k) => owner.set(nvI, k % EK));
    const half = new Set(); faces.forEach(f => { for (let i = 0; i < f.length; i++) half.add(f[i] * EK + f[(i + 1) % f.length]); });
    const open = new Map(); // from -> to (reverse direction for the cap)
    faces.forEach(f => { for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length]; if (!half.has(b * EK + a) && owner.has(a) && owner.has(b) && owner.get(a) === owner.get(b)) open.set(b, a); } });
    const done = new Set();
    open.forEach((_, start) => {
      if (done.has(start)) return; const loop = [start]; let cur = open.get(start), guard = 0;
      while (cur != null && cur !== start && guard++ < 1000) { loop.push(cur); cur = open.get(cur); }
      loop.forEach(x => done.add(x));
      if (cur === start && loop.length >= 3) { faces.push(loop); uvs.push(null); newFaces.push(faces.length - 1); }
    });
    const res = compact({ v, f: faces, uv: uvs });
    const kept = new Set(); let n = 0; const keepIdx = []; faces.forEach(f => { const nf = f.filter((x, i) => x !== f[(i + 1) % f.length]); keepIdx.push(nf.length >= 3 && new Set(nf).size === nf.length ? n++ : -1); });
    newFaces.forEach(fi => keepIdx[fi] >= 0 && kept.add(keepIdx[fi]));
    return { mesh: res.mesh, sel: flush(res.mesh, 'face', { F: kept }) };
  }

  // loop cut across the edge ring that contains edge (a,b); cuts >= 1; t = position of a single cut (0..1)
  function loopCut(m0, a, b, cuts = 1, t = 0.5) {
    const ring = edgeRing(m0, a, b); if (!ring || !ring.quads.length) return null;
    const m = clone(m0), Q = ring.quads;
    const edgeNew = new Map(); // directed key s0*EK+s1 -> [new verts from s0 to s1]
    const getNew = (s0, s1) => {
      if (edgeNew.has(s0 * EK + s1)) return edgeNew.get(s0 * EK + s1);
      if (edgeNew.has(s1 * EK + s0)) return edgeNew.get(s1 * EK + s0).slice().reverse();
      const arr = []; for (let k = 1; k <= cuts; k++) { const tt = cuts === 1 ? t : k / (cuts + 1); arr.push(m.v.length); m.v.push(lerp(m0.v[s0], m0.v[s1], tt)); }
      edgeNew.set(s0 * EK + s1, arr); return arr;
    };
    const ringEdges = new Set(), newLoop = new Set(), replaced = new Set();
    Q.forEach(q => {
      const P = [q.x, ...getNew(q.x, q.y), q.y], R = [q.nx, ...getNew(q.nx, q.ny), q.ny];
      ringEdges.add(ekey(q.x, q.y)); ringEdges.add(ekey(q.nx, q.ny));
      const f = m0.f[q.fi], i = f.indexOf(q.x), fwd = f[(i + 1) % 4] === q.y, uv = m0.uv && m0.uv[q.fi];
      // uv for corners by bilinear interpolation along the cut
      const cuv = uv ? (() => { const at = vv => uv[f.indexOf(vv)]; const ux = at(q.x), uy = at(q.y), unx = at(q.nx), uny = at(q.ny); return { P: P.map((_, k) => lerp2(ux, uy, k / (P.length - 1))), R: R.map((_, k) => lerp2(unx, uny, k / (R.length - 1))) }; })() : null;
      if (cuts === 1 && cuv) { cuv.P[1] = lerp2(cuv.P[0], cuv.P[2], t); cuv.R[1] = lerp2(cuv.R[0], cuv.R[2], t); }
      const pieces = [], puv = [];
      for (let k = 0; k < P.length - 1; k++) {
        if (fwd) { pieces.push([P[k], P[k + 1], R[k + 1], R[k]]); puv.push(cuv ? [cuv.P[k], cuv.P[k + 1], cuv.R[k + 1], cuv.R[k]] : null); }
        else { pieces.push([P[k + 1], P[k], R[k], R[k + 1]]); puv.push(cuv ? [cuv.P[k + 1], cuv.P[k], cuv.R[k], cuv.R[k + 1]] : null); }
        if (k < P.length - 2) newLoop.add(ekey(P[k + 1], R[k + 1]));
      }
      m.f[q.fi] = pieces[0]; m.uv[q.fi] = puv[0];
      for (let k = 1; k < pieces.length; k++) { m.f.push(pieces[k]); m.uv.push(puv[k]); }
      replaced.add(q.fi);
    });
    // other faces touching ring edges get the new vertices inserted into those edges
    for (let fi = 0; fi < m0.f.length; fi++) {
      if (replaced.has(fi)) continue; const f = m0.f[fi]; let changed = false; const out = [];
      for (let i = 0; i < f.length; i++) {
        const x = f[i], y = f[(i + 1) % f.length]; out.push(x);
        if (ringEdges.has(ekey(x, y))) { out.push(...getNew(x, y)); changed = true; }
      }
      if (changed) { m.f[fi] = out; m.uv[fi] = null; }
    }
    return { mesh: m, sel: flush(m, 'edge', { E: newLoop }) };
  }

  // subdivide selected faces once (midpoints; quads/n-gons -> quads around a centre, tris -> 4 tris)
  function subdivide(m0, sel) {
    const m = clone(m0), mid = new Map();
    const mp = (a, b) => { const k = ekey(a, b); if (!mid.has(k)) { mid.set(k, m.v.length); m.v.push(lerp(m0.v[a], m0.v[b], .5)); } return mid.get(k); };
    const F = new Set(), add_ = (f, u) => { m.f.push(f); m.uv.push(u); F.add(m.f.length - 1); };
    const repl = new Set();
    sel.F.forEach(fi => {
      const f = m0.f[fi], n = f.length, uv = m0.uv && m0.uv[fi], M = f.map((x, i) => mp(x, f[(i + 1) % n]));
      const mu = uv ? uv.map((u, i) => lerp2(u, uv[(i + 1) % n], .5)) : null;
      repl.add(fi);
      if (n === 3) {
        add_([f[0], M[0], M[2]], uv ? [uv[0], mu[0], mu[2]] : null); add_([f[1], M[1], M[0]], uv ? [uv[1], mu[1], mu[0]] : null);
        add_([f[2], M[2], M[1]], uv ? [uv[2], mu[2], mu[1]] : null); add_([M[0], M[1], M[2]], uv ? [mu[0], mu[1], mu[2]] : null);
      } else {
        const c = m.v.length; m.v.push(faceCenter(m0, f)); const cu = uv ? avg2(uv) : null;
        for (let i = 0; i < n; i++) add_([f[i], M[i], c, M[(i - 1 + n) % n]], uv ? [uv[i], mu[i], cu, mu[(i - 1 + n) % n]] : null);
      }
    });
    for (let fi = 0; fi < m0.f.length; fi++) {
      if (repl.has(fi)) continue; const f = m0.f[fi]; let ch = false; const out = [];
      for (let i = 0; i < f.length; i++) { out.push(f[i]); const k = ekey(f[i], f[(i + 1) % f.length]); if (mid.has(k)) { out.push(mid.get(k)); ch = true; } }
      if (ch) { m.f[fi] = out; m.uv[fi] = null; }
    }
    // drop the replaced faces
    const keep = m.f.map((_, i) => !repl.has(i));
    const nf = [], nu = [], fmap = new Int32Array(m.f.length).fill(-1);
    m.f.forEach((f, i) => { if (keep[i]) { fmap[i] = nf.length; nf.push(f); nu.push(m.uv[i]); } });
    const out = { v: m.v, f: nf, uv: nu }, S = new Set(); F.forEach(i => fmap[i] >= 0 && S.add(fmap[i]));
    return { mesh: out, sel: flush(out, 'face', { F: S }) };
  }

  // weld vertices through a map (old -> target old index), then compact
  function weld(m0, target) {
    const m = { v: m0.v.map(p => p.slice()), f: m0.f.map(f => f.map(i => target[i] ?? i)), uv: m0.uv.slice() };
    return compact(m);
  }
  function merge(m0, sel, where = 'center') {
    if (sel.V.size < 2) return { mesh: clone(m0), sel };
    const ids = [...sel.V], target = {};
    if (where === 'collapse') { // each connected selected island to its own centre
      const adj = new Map(); ids.forEach(i => adj.set(i, []));
      m0.f.forEach(f => { for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length]; if (sel.V.has(a) && sel.V.has(b)) { adj.get(a).push(b); adj.get(b).push(a); } } });
      const seen = new Set(), m = clone(m0);
      ids.forEach(s => { if (seen.has(s)) return; const comp = [], st = [s]; seen.add(s); while (st.length) { const x = st.pop(); comp.push(x); adj.get(x).forEach(y => { if (!seen.has(y)) { seen.add(y); st.push(y); } }); } m.v[comp[0]] = avg(comp.map(i => m0.v[i])); comp.forEach(i => target[i] = comp[0]); });
      const c = weld(m, target); const V = new Set(); ids.forEach(i => { const t = c.map[target[i]]; if (t >= 0) V.add(t); });
      return { mesh: c.mesh, sel: flush(c.mesh, 'vert', { V }) };
    }
    const m = clone(m0), keepI = where === 'first' ? ids[0] : where === 'last' ? ids[ids.length - 1] : ids[0];
    if (where === 'center') m.v[keepI] = avg(ids.map(i => m0.v[i]));
    ids.forEach(i => target[i] = keepI);
    const c = weld(m, target), t = c.map[keepI];
    return { mesh: c.mesh, sel: flush(c.mesh, 'vert', { V: new Set(t >= 0 ? [t] : []) }) };
  }
  function mergeByDistance(m0, sel, dist = 1e-4) {
    const ids = sel && sel.V.size ? [...sel.V] : m0.v.map((_, i) => i), cell = Math.max(dist, 1e-9) * 2, hash = new Map(), target = {};
    const keyOf = p => p.map(x => Math.floor(x / cell)).join(',');
    let merged = 0;
    ids.forEach(i => {
      const p = m0.v[i], c = p.map(x => Math.floor(x / cell)); let found = -1;
      for (let dx = -1; dx <= 1 && found < 0; dx++) for (let dy = -1; dy <= 1 && found < 0; dy++) for (let dz = -1; dz <= 1 && found < 0; dz++) {
        const arr = hash.get((c[0] + dx) + ',' + (c[1] + dy) + ',' + (c[2] + dz)); if (arr) for (const j of arr) if (len(sub(m0.v[j], p)) <= dist) { found = j; break; }
      }
      if (found >= 0) { target[i] = found; merged++; } else { const k = keyOf(p); if (!hash.has(k)) hash.set(k, []); hash.get(k).push(i); }
    });
    const c = weld(m0, target), V = new Set(); ids.forEach(i => { const t = c.map[target[i] ?? i]; if (t >= 0) V.add(t); });
    return { mesh: c.mesh, sel: flush(c.mesh, 'vert', { V }), merged };
  }
  function del(m0, sel, what = 'verts') {
    let drop;
    if (what === 'verts') drop = f => f.some(i => sel.V.has(i));
    else if (what === 'edges') drop = f => f.some((x, i) => sel.E.has(ekey(x, f[(i + 1) % f.length])));
    else drop = (f, fi) => sel.F.has(fi);
    const m = { v: m0.v, f: [], uv: [] };
    m0.f.forEach((f, fi) => { if (!drop(f, fi)) { m.f.push(f.slice()); m.uv.push(m0.uv ? m0.uv[fi] : null); } });
    const c = compact(m); return { mesh: c.mesh, sel: emptySel() };
  }
  function dissolveFaces(m0, sel) { // merge each connected selected face region into one n-gon (simple regions only)
    const del_ = del(m0, sel, 'faces'); void del_;
    const em = new Map(); sel.F.forEach(fi => { const f = m0.f[fi]; for (let i = 0; i < f.length; i++) { const k = ekey(f[i], f[(i + 1) % f.length]); em.set(k, (em.get(k) || 0) + 1); } });
    const next = new Map(); let bad = false;
    sel.F.forEach(fi => { const f = m0.f[fi]; for (let i = 0; i < f.length; i++) { const a = f[i], b = f[(i + 1) % f.length]; if (em.get(ekey(a, b)) === 1) { if (next.has(a)) bad = true; next.set(a, b); } } });
    if (bad || !next.size) return null;
    const m = { v: m0.v.map(p => p.slice()), f: [], uv: [] }; m0.f.forEach((f, fi) => { if (!sel.F.has(fi)) { m.f.push(f.slice()); m.uv.push(m0.uv[fi]); } });
    const used = new Set(), F = new Set();
    next.forEach((_, s) => { if (used.has(s)) return; const loop = []; let c = s, g = 0; while (!used.has(c) && g++ < 100000) { used.add(c); loop.push(c); c = next.get(c); } if (loop.length >= 3) { m.f.push(loop); m.uv.push(null); F.add(m.f.length - 1); } });
    const c = compact(m), FF = new Set(); F.forEach(fi => FF.add(fi)); // compact keeps face order (no faces dropped here)
    return { mesh: c.mesh, sel: flush(c.mesh, 'face', { F: FF }) };
  }
  // make a face from selected vertices: follow boundary order if possible, else sort by angle around the centroid
  function fill(m0, sel) {
    const ids = [...sel.V]; if (ids.length < 3) return null;
    const em = edgeMap(m0), nxt = new Map();
    em.forEach((fs, k) => { if (fs.length !== 1) return; const a = ekeyA(k), b = ekeyB(k); if (!sel.V.has(a) || !sel.V.has(b)) return; const f = m0.f[fs[0]], i = f.indexOf(a); if (f[(i + 1) % f.length] === b) nxt.set(b, a); else nxt.set(a, b); });
    let order = null;
    if (nxt.size === ids.length) { order = []; let c = ids[0], g = 0; do { order.push(c); c = nxt.get(c); } while (c != null && c !== ids[0] && g++ < ids.length + 1); if (order.length !== ids.length || c !== ids[0]) order = null; }
    if (!order) {
      const pts = ids.map(i => m0.v[i]), c = avg(pts); let n = [0, 0, 0];
      for (let i = 0; i < pts.length; i++) n = add(n, cross(sub(pts[i], c), sub(pts[(i + 1) % pts.length], c)));
      if (len(n) < 1e-12) { const bb = bbox({ v: pts }); const ext = [0, 1, 2].map(k => bb.max[k] - bb.min[k]); const k = ext.indexOf(Math.min(...ext)); n = [0, 0, 0]; n[k] = 1; }
      n = norm(n); let u = norm(cross(n, Math.abs(n[0]) < .9 ? [1, 0, 0] : [0, 1, 0])); const w = cross(n, u);
      order = ids.slice().sort((p, q) => { const a = sub(m0.v[p], c), b = sub(m0.v[q], c); return Math.atan2(dot(a, w), dot(a, u)) - Math.atan2(dot(b, w), dot(b, u)); });
      // orient with the surrounding faces if there are any: shared edges must run opposite
      const half = new Set(); m0.f.forEach(f => { for (let i = 0; i < f.length; i++) half.add(f[i] * EK + f[(i + 1) % f.length]); });
      if (order.some((x, i) => half.has(x * EK + order[(i + 1) % order.length]))) order.reverse();
    }
    const m = clone(m0); m.f.push(order); m.uv.push(null);
    return { mesh: m, sel: flush(m, 'face', { F: new Set([m.f.length - 1]) }) };
  }
  function flipFaces(m0, F) { const m = clone(m0); F.forEach(fi => { m.f[fi].reverse(); if (m.uv[fi]) m.uv[fi].reverse(); }); return m; }
  // make winding consistent per connected component and outward (by signed volume)
  function recalcNormals(m0) {
    const m = clone(m0), em = edgeMap(m), seen = new Uint8Array(m.f.length);
    for (let s = 0; s < m.f.length; s++) {
      if (seen[s]) continue; const comp = [s], st = [s]; seen[s] = 1;
      while (st.length) {
        const fi = st.pop(), f = m.f[fi];
        for (let i = 0; i < f.length; i++) {
          const a = f[i], b = f[(i + 1) % f.length];
          (em.get(ekey(a, b)) || []).forEach(g => {
            if (seen[g]) return; const h = m.f[g], j = h.indexOf(a);
            if (h[(j + 1) % h.length] === b) { h.reverse(); if (m.uv[g]) m.uv[g].reverse(); } // same direction -> flip neighbour
            seen[g] = 1; comp.push(g); st.push(g);
          });
        }
      }
      let vol = 0; comp.forEach(fi => { const f = m.f[fi], a = m.v[f[0]]; for (let i = 1; i + 1 < f.length; i++) vol += dot(a, cross(m.v[f[i]], m.v[f[i + 1]])); });
      // for open surfaces use the direction relative to the component centre
      if (vol < 0) comp.forEach(fi => { m.f[fi].reverse(); if (m.uv[fi]) m.uv[fi].reverse(); });
    }
    return m;
  }
  function duplicate(m0, sel) {
    const m = clone(m0), map = new Map(), F = new Set();
    sel.F.forEach(fi => { const f = m0.f[fi]; m.f.push(f.map(v => { if (!map.has(v)) { map.set(v, m.v.length); m.v.push(m0.v[v].slice()); } return map.get(v); })); m.uv.push(m0.uv[fi] ? m0.uv[fi].map(x => x.slice()) : null); F.add(m.f.length - 1); });
    return { mesh: m, sel: flush(m, 'face', { F }) };
  }
  function triangulate(m0, F) {
    const m = { v: m0.v.map(p => p.slice()), f: [], uv: [] }, S = new Set();
    m0.f.forEach((f, fi) => {
      if ((F && !F.has(fi)) || f.length === 3) { m.f.push(f.slice()); m.uv.push(m0.uv[fi]); if (F && F.has(fi)) S.add(m.f.length - 1); return; }
      const tris = triFace(m0.v, f), u = m0.uv[fi];
      tris.forEach(t => { m.f.push(t.map(i => f[i])); m.uv.push(u ? t.map(i => u[i]) : null); S.add(m.f.length - 1); });
    });
    return { mesh: m, sel: flush(m, 'face', { F: S }) };
  }
  // reflect selected vertices across a plane through `center` on axis 0/1/2 and flip fully selected faces
  function mirror(m0, sel, axis, center) {
    const m = clone(m0);
    sel.V.forEach(i => { m.v[i][axis] = 2 * center[axis] - m.v[i][axis]; });
    sel.F.forEach(fi => { m.f[fi].reverse(); if (m.uv[fi]) m.uv[fi].reverse(); });
    return { mesh: m, sel };
  }
  function transformVerts(m0, ids, fn) { const m = clone(m0); ids.forEach(i => { m.v[i] = fn(m0.v[i]); }); return m; }

  // ---------- triangulation of one polygon (ear clipping in its plane) ----------
  function triFace(V, f) {
    const n = f.length; if (n === 3) return [[0, 1, 2]];
    const P = f.map(i => V[i]);
    let nx = 0, ny = 0, nz = 0; for (let i = 0; i < n; i++) { const a = P[i], b = P[(i + 1) % n]; nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]); }
    const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
    const pr = az >= ax && az >= ay ? (p => [p[0], p[1]]) : ax >= ay ? (p => [p[1], p[2]]) : (p => [p[2], p[0]]);
    const sgn = (az >= ax && az >= ay ? nz : ax >= ay ? nx : ny) >= 0 ? 1 : -1;
    const Q = P.map(pr);
    if (n === 4) { // pick the diagonal that keeps both triangles valid and is shorter
      const ar = (a, b, c) => sgn * ((Q[b][0] - Q[a][0]) * (Q[c][1] - Q[a][1]) - (Q[b][1] - Q[a][1]) * (Q[c][0] - Q[a][0]));
      const ok02 = ar(0, 1, 2) > 0 && ar(0, 2, 3) > 0, ok13 = ar(1, 2, 3) > 0 && ar(1, 3, 0) > 0;
      const d02 = len(sub(P[0], P[2])), d13 = len(sub(P[1], P[3]));
      if (ok13 && (!ok02 || d13 < d02 - 1e-9)) return [[0, 1, 3], [1, 2, 3]];
      return [[0, 1, 2], [0, 2, 3]];
    }
    const idx = [...Array(n).keys()], out = [];
    const area = (a, b, c) => sgn * ((Q[b][0] - Q[a][0]) * (Q[c][1] - Q[a][1]) - (Q[b][1] - Q[a][1]) * (Q[c][0] - Q[a][0]));
    const inside = (p, a, b, c) => area(a, b, p) >= -1e-12 && area(b, c, p) >= -1e-12 && area(c, a, p) >= -1e-12;
    let guard = 0;
    while (idx.length > 3 && guard++ < n * n) {
      let cut = false;
      for (let i = 0; i < idx.length; i++) {
        const a = idx[(i - 1 + idx.length) % idx.length], b = idx[i], c = idx[(i + 1) % idx.length];
        if (area(a, b, c) <= 1e-14) continue;
        let ear = true; for (const p of idx) { if (p === a || p === b || p === c) continue; if (inside(p, a, b, c)) { ear = false; break; } }
        if (!ear) continue; out.push([a, b, c]); idx.splice(i, 1); cut = true; break;
      }
      if (!cut) break;
    }
    if (idx.length > 3) { for (let i = 1; i + 1 < idx.length; i++) out.push([idx[0], idx[i], idx[i + 1]]); }
    else out.push([idx[0], idx[1], idx[2]]);
    return out;
  }

  // flat triangle buffers for display/render/export. smooth: share normals across faces within `angle` degrees.
  function toTriangles(m, smooth = false, angle = 180) {
    const fn = m.f.map(f => faceNormal(m, f)), fa = m.f.map(f => faceArea(m, f));
    let vf = null; if (smooth) vf = vertFaces(m);
    const cosT = Math.cos(angle * Math.PI / 180 + 1e-6);
    let nt = 0; m.f.forEach(f => nt += f.length - 2);
    const pos = new Float32Array(nt * 9), nor = new Float32Array(nt * 9), uv = new Float32Array(nt * 6), tface = new Int32Array(nt);
    const hasUV = new Uint8Array(nt);
    let t = 0;
    m.f.forEach((f, fi) => {
      const tris = triFace(m.v, f), u = m.uv && m.uv[fi], n0 = fn[fi];
      const cn = f.map(vi => {
        if (!smooth) return n0;
        let s = [0, 0, 0]; vf[vi].forEach(g => { if (g === fi || dot(fn[g], n0) >= cosT) s = add(s, mul(fn[g], fa[g] + 1e-12)); });
        const r = norm(s); return len(r) > 0 ? r : n0;
      });
      // box projection fallback for faces without uv
      const ax = Math.abs(n0[0]), ay = Math.abs(n0[1]), az = Math.abs(n0[2]);
      const proj = p => az >= ax && az >= ay ? [p[0] * .5 + .5, p[1] * .5 + .5] : ax >= ay ? [p[1] * .5 + .5, p[2] * .5 + .5] : [p[0] * .5 + .5, p[2] * .5 + .5];
      tris.forEach(tr => {
        for (let k = 0; k < 3; k++) {
          const ci = tr[k], p = m.v[f[ci]], n = cn[ci], q = u ? u[ci] : proj(p);
          pos[t * 9 + k * 3] = p[0]; pos[t * 9 + k * 3 + 1] = p[1]; pos[t * 9 + k * 3 + 2] = p[2];
          nor[t * 9 + k * 3] = n[0]; nor[t * 9 + k * 3 + 1] = n[1]; nor[t * 9 + k * 3 + 2] = n[2];
          uv[t * 6 + k * 2] = q[0]; uv[t * 6 + k * 2 + 1] = q[1];
        }
        tface[t] = fi; hasUV[t] = u ? 1 : 0; t++;
      });
    });
    return { pos, nor, uv, tface, count: nt };
  }

  // ---------- modifiers ----------
  // Catmull–Clark subdivision; boundary edges/corners follow the crease rules; uvs are interpolated linearly
  function catmullClark(m, levels = 1) {
    for (let l = 0; l < levels; l++) m = ccOnce(m);
    return m;
  }
  function ccOnce(m) {
    const em = edgeMap(m), vf = vertFaces(m), nV = m.v.length;
    const fp = m.f.map(f => faceCenter(m, f));
    const eIndex = new Map(), ev = [];
    em.forEach((fs, k) => {
      const a = m.v[ekeyA(k)], b = m.v[ekeyB(k)];
      const p = fs.length === 2 ? mul(add(add(a, b), add(fp[fs[0]], fp[fs[1]])), 0.25) : lerp(a, b, .5);
      eIndex.set(k, nV + ev.length); ev.push(p);
    });
    // vertex adjacency and boundary info
    const vEdges = m.v.map(() => []); em.forEach((fs, k) => { vEdges[ekeyA(k)].push(k); vEdges[ekeyB(k)].push(k); });
    const nvp = m.v.map((p, i) => {
      const es = vEdges[i]; if (!es.length) return p.slice();
      const bnd = es.filter(k => em.get(k).length !== 2);
      if (bnd.length) {
        if (bnd.length !== 2) return p.slice(); // corner / non-manifold: keep
        const o = bnd.map(k => m.v[ekeyA(k) === i ? ekeyB(k) : ekeyA(k)]);
        return add(mul(p, 0.75), mul(add(o[0], o[1]), 0.125));
      }
      const n = vf[i].length, F = avg(vf[i].map(fi => fp[fi])), R = avg(es.map(k => lerp(m.v[ekeyA(k)], m.v[ekeyB(k)], .5)));
      return add(add(mul(F, 1 / n), mul(R, 2 / n)), mul(p, (n - 3) / n));
    });
    const v = nvp.concat(ev), faceStart = v.length; fp.forEach(p => v.push(p));
    const f = [], uv = [];
    m.f.forEach((face, fi) => {
      const n = face.length, u = m.uv && m.uv[fi], c = faceStart + fi;
      const cu = u ? avg2(u) : null;
      for (let i = 0; i < n; i++) {
        const a = face[i], ePrev = eIndex.get(ekey(face[(i - 1 + n) % n], a)), eNext = eIndex.get(ekey(a, face[(i + 1) % n]));
        f.push([a, eNext, c, ePrev]);
        uv.push(u ? [u[i], lerp2(u[i], u[(i + 1) % n], .5), cu, lerp2(u[(i - 1 + n) % n], u[i], .5)] : null);
      }
    });
    return { v, f, uv };
  }
  function mirrorMod(m, axes = [true, false, false], mergeOn = true, thr = 0.001) {
    for (let ax = 0; ax < 3; ax++) {
      if (!axes[ax]) continue;
      const n = m.v.length, v = m.v.map(p => p.slice()), map = new Int32Array(n);
      for (let i = 0; i < n; i++) { const p = m.v[i]; if (mergeOn && Math.abs(p[ax]) * 2 <= thr) { map[i] = i; v[i][ax] = 0; } else { map[i] = v.length; const q = p.slice(); q[ax] = -q[ax]; v.push(q); } }
      const f = m.f.map(x => x.slice()), uv = m.uv.map(x => x ? x.slice() : null);
      m.f.forEach((face, fi) => { f.push(face.map(i => map[i]).reverse()); const u = m.uv[fi]; uv.push(u ? u.slice().reverse() : null); });
      m = compact({ v, f, uv }).mesh;
    }
    return m;
  }
  function arrayMod(m, count = 3, rel = [1, 0, 0], cst = [0, 0, 0], mergeOn = false) {
    const bb = bbox(m), size = [0, 1, 2].map(k => bb.max[k] - bb.min[k]);
    const off = [0, 1, 2].map(k => rel[k] * size[k] + cst[k]);
    const v = [], f = [], uv = [];
    for (let c = 0; c < Math.max(1, count); c++) {
      const base = v.length; m.v.forEach(p => v.push([p[0] + off[0] * c, p[1] + off[1] * c, p[2] + off[2] * c]));
      m.f.forEach((face, fi) => { f.push(face.map(i => i + base)); uv.push(m.uv[fi] ? m.uv[fi].map(x => x.slice()) : null); });
    }
    let out = { v, f, uv };
    if (mergeOn) out = mergeByDistance(out, null, 1e-4).mesh;
    return out;
  }
  function vertexNormals(m) {
    const n = m.v.map(() => [0, 0, 0]);
    m.f.forEach(f => { const fnr = faceNormal(m, f), a = faceArea(m, f); f.forEach(i => { n[i] = add(n[i], mul(fnr, a)); }); });
    return n.map(norm);
  }
  function solidify(m, thickness = 0.1, offset = -1, rim = true) {
    const vn = vertexNormals(m), n = m.v.length;
    const outer = (offset + 1) / 2 * thickness, inner = (offset - 1) / 2 * thickness;
    const v = m.v.map((p, i) => add(p, mul(vn[i], outer))).concat(m.v.map((p, i) => add(p, mul(vn[i], inner))));
    const f = m.f.map(x => x.slice()), uv = m.uv.map(x => x ? x.slice() : null);
    m.f.forEach((face, fi) => { f.push(face.map(i => i + n).reverse()); uv.push(m.uv[fi] ? m.uv[fi].slice().reverse() : null); });
    if (rim) {
      const em = edgeMap(m);
      m.f.forEach(face => { for (let i = 0; i < face.length; i++) { const a = face[i], b = face[(i + 1) % face.length]; if (em.get(ekey(a, b)).length === 1) { f.push([b, a, a + n, b + n]); uv.push(null); } } });
    }
    return { v, f, uv };
  }
  // apply a modifier stack [{type, enabled, ...}] to a base mesh
  function evaluate(m, mods) {
    (mods || []).forEach(md => {
      if (md.enabled === false) return;
      try {
        if (md.type === 'subsurf') m = catmullClark(m, Math.max(0, Math.min(4, md.levels | 0)));
        else if (md.type === 'mirror') m = mirrorMod(m, [!!md.x, !!md.y, !!md.z], md.merge !== false, md.threshold ?? 0.001);
        else if (md.type === 'array') m = arrayMod(m, Math.max(1, Math.min(200, md.count | 0)), [md.rx ?? 1, md.ry ?? 0, md.rz ?? 0], [md.cx ?? 0, md.cy ?? 0, md.cz ?? 0], !!md.merge);
        else if (md.type === 'solidify') m = solidify(m, md.thickness ?? 0.1, md.offset ?? -1, md.rim !== false);
      } catch (e) { /* a failing modifier leaves the mesh unchanged */ }
    });
    return m;
  }

  // ---------- validation of untrusted mesh data ----------
  function sanitize(x, maxV = 4e6) {
    if (!x || !Array.isArray(x.v) || !Array.isArray(x.f) || x.v.length > maxV) return null;
    const v = []; for (const p of x.v) { if (!Array.isArray(p) || p.length < 3) return null; const q = [+p[0], +p[1], +p[2]]; if (!q.every(isFinite)) return null; v.push(q); }
    const f = [], uv = [];
    x.f.forEach((face, fi) => {
      if (!Array.isArray(face) || face.length < 3 || face.length > 10000) return;
      if (!face.every(i => Number.isInteger(i) && i >= 0 && i < v.length)) return;
      const u = Array.isArray(x.uv) ? x.uv[fi] : null;
      f.push(face.slice()); uv.push(Array.isArray(u) && u.length === face.length && u.every(q => Array.isArray(q) && isFinite(q[0]) && isFinite(q[1])) ? u.map(q => [+q[0], +q[1]]) : null);
    });
    return compact({ v, f, uv }).mesh;
  }

  const api = { ekey, ekeyA, ekeyB, make, clone, emptySel, faceNormal, faceArea, faceCenter, edgeMap, edges, vertFaces, bbox, stats, volume, compact,
    flush, selectAll, invertSel, selectLinked, edgeLoop, edgeRing, PRIMS, cube, plane, grid, uvSphere, icoSphere, cylinder, cone, torus,
    extrude, inset, bevel, loopCut, subdivide, merge, mergeByDistance, del, dissolveFaces, fill, flipFaces, recalcNormals, duplicate, triangulate, mirror, transformVerts,
    triFace, toTriangles, catmullClark, mirrorMod, arrayMod, solidify, vertexNormals, evaluate, sanitize, remapSet,
    vec: { add, sub, mul, dot, cross, len, norm, lerp, avg } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LMesh = api;
})(typeof self !== 'undefined' ? self : this);
