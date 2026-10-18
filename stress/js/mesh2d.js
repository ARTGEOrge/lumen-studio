// Lumen Stress — 2-D automatic triangular mesher. Bowyer–Watson constrained Delaunay triangulation with Ruppert-style
// refinement (encroached boundary segments are split, then circumcentres of poor or oversized triangles are inserted),
// a graded size field, Laplacian smoothing, then conversion to 6-node quadratic triangles (midside nodes of curved
// boundary edges are placed on the true arc).
(function (root, factory) {
  const G = typeof module === 'object' && module.exports ? require('./geom.js') : root.StressGeom, m = factory(G);
  if (typeof module === 'object' && module.exports) module.exports = m; else root.StressMesh2D = m;
})(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';

  function orient(ax, ay, bx, by, cx, cy) { return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax); }
  function inCircle(ax, ay, bx, by, cx, cy, dx, dy) {
    const adx = ax - dx, ady = ay - dy, bdx = bx - dx, bdy = by - dy, cdx = cx - dx, cdy = cy - dy;
    const ad = adx * adx + ady * ady, bd = bdx * bdx + bdy * bdy, cd = cdx * cdx + cdy * cdy;
    return adx * (bdy * cd - bd * cdy) - ady * (bdx * cd - bd * cdx) + ad * (bdx * cdy - bdy * cdx);
  }

  // ---------- size field ----------
  // seeds: [{x,y,h}] where the local size is smaller than the global size; grows by `grade` per unit distance
  function sizeField(bb, hg, seeds, grade) {
    if (!seeds.length) return () => hg;
    const N = 96, w = bb.w || 1, hh = bb.h || 1, sx = w / N, sy = hh / N, gx = N + 1, grid = new Float64Array(gx * gx);
    const exact = (x, y) => { let h = hg; for (const s of seeds) { const v = s.h + grade * Math.hypot(x - s.x, y - s.y); if (v < h) h = v; } return h; };
    // thin seed list for the grid pass
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) grid[j * gx + i] = exact(bb.x0 + i * sx, bb.y0 + j * sy);
    return (x, y) => {
      let fi = (x - bb.x0) / sx, fj = (y - bb.y0) / sy; fi = Math.max(0, Math.min(N - 1e-9, fi)); fj = Math.max(0, Math.min(N - 1e-9, fj));
      const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j;
      // the minimum of the 4 corners keeps the field conservative near small features
      const a = grid[j * gx + i], b = grid[j * gx + i + 1], c = grid[(j + 1) * gx + i], d = grid[(j + 1) * gx + i + 1];
      return Math.min((a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v, Math.min(a, b, c, d) * 1.15);
    };
  }

  // ---------- mesher ----------
  // opts: {size, grade, minAngle (deg), refine: {edgeId: size}, maxNodes, quadratic (default true), smooth}
  function mesh(shapes, opts = {}) {
    const t0 = Date.now(), bb = G.bounds(shapes), diag = Math.hypot(bb.w, bb.h);
    const hg = Math.max(diag / 2000, +opts.size || diag / 20), grade = opts.grade ?? 0.3, minAng = (opts.minAngle ?? 28) * Math.PI / 180, maxNodes = opts.maxNodes || 200000;
    const edges = G.allEdges(shapes), refine = opts.refine || {};
    if (!edges.length) throw new Error('There is no geometry to mesh.');
    const cr = G.crossings(shapes); if (cr.length) { const e = new Error('Outlines cross each other near (' + cr[0].map(v => +v.toFixed(2)).join(', ') + '). Outlines must not overlap: holes go fully inside a plate.'); e.points = cr; throw e; }
    // local edge sizes: user refinement and curvature (≤ 15° per segment on arcs)
    const edgeSize = edges.map(E => { let h = Math.min(hg, +refine[E.id] || Infinity); if (E.e.type === 'arc') h = Math.min(h, Math.max(E.e.r * Math.PI / 12, diag / 4000)); return h; });
    const seeds = []; edges.forEach((E, k) => { const h = edgeSize[k]; if (h >= hg * 0.999) return; const n = Math.max(2, Math.ceil(G.edgeLength(E.e) / h)); for (let i = 0; i <= n; i++) { const p = G.edgePoint(E.e, i / n); seeds.push({ x: p[0], y: p[1], h }); } });
    const H = sizeField({ x0: bb.x0 - diag * 0.01, y0: bb.y0 - diag * 0.01, w: bb.w + diag * 0.02, h: bb.h + diag * 0.02 }, hg, seeds, grade);

    // --- triangulation storage ---
    let X = [], Y = [];
    let tv = new Int32Array(3 * 1024), tn = new Int32Array(3 * 1024), alive = new Uint8Array(1024), inside = new Int8Array(1024), nt = 0;
    const freeT = [], vtri = [];
    const newTri = (a, b, c, flag) => {
      let t; if (freeT.length) t = freeT.pop(); else {
        t = nt++; if (nt > alive.length) { const g = (A, k) => { const B = new A.constructor(A.length * 2); B.set(A); return B; }; tv = g(tv); tn = g(tn); alive = g(alive); inside = g(inside); }
      }
      tv[3 * t] = a; tv[3 * t + 1] = b; tv[3 * t + 2] = c; tn[3 * t] = tn[3 * t + 1] = tn[3 * t + 2] = -1; alive[t] = 1; inside[t] = flag; vtri[a] = vtri[b] = vtri[c] = t; return t;
    };
    const seg = new Map(), K = 1 << 22, skey = (a, b) => a < b ? a * K + b : b * K + a;
    // super triangle
    const cx = bb.x0 + bb.w / 2, cy = bb.y0 + bb.h / 2, R = diag * 50 + 1;
    X.push(cx - 2 * R, cx + 2 * R, cx); Y.push(cy - R, cy - R, cy + 2 * R);
    newTri(0, 1, 2, 0);
    let lastT = 0;
    const locate = (px, py, start) => {
      let t = start >= 0 && alive[start] ? start : lastT; if (!alive[t]) { t = 0; while (!alive[t]) t++; }
      for (let steps = 0; steps < 1e6; steps++) {
        let moved = false; const r = steps % 3;
        for (let q = 0; q < 3; q++) {
          const k = (q + r) % 3, a = tv[3 * t + (k + 1) % 3], b = tv[3 * t + (k + 2) % 3];
          if (orient(X[a], Y[a], X[b], Y[b], px, py) < 0) { const nb = tn[3 * t + k]; if (nb < 0) return { t, blocked: null, outside: true }; t = nb; moved = true; break; }
        }
        if (!moved) return { t };
      }
      return { t };
    };
    // walk that stops at constrained segments (for circumcentres): returns {t} or {blocked: key}
    const walkVisible = (px, py, t) => {
      for (let steps = 0; steps < 1e6; steps++) {
        let moved = false; const r = steps % 3;
        for (let q = 0; q < 3; q++) {
          const k = (q + r) % 3, a = tv[3 * t + (k + 1) % 3], b = tv[3 * t + (k + 2) % 3];
          if (orient(X[a], Y[a], X[b], Y[b], px, py) < 0) { const key = skey(a, b); if (seg.has(key)) return { blocked: key }; const nb = tn[3 * t + k]; if (nb < 0) return { blocked: -1 }; t = nb; moved = true; break; }
        }
        if (!moved) return { t };
      }
      return { blocked: -1 };
    };
    // Bowyer–Watson cavity from seed triangles; crossKey = constrained edge that may be crossed (segment split)
    const cavity = (px, py, seedTris, crossKey) => {
      const cav = [], mark = new Set(seedTris), bnd = [];
      seedTris.forEach(t => cav.push(t));
      for (let i = 0; i < cav.length; i++) {
        const t = cav[i];
        for (let k = 0; k < 3; k++) {
          const a = tv[3 * t + (k + 1) % 3], b = tv[3 * t + (k + 2) % 3], nb = tn[3 * t + k], key = skey(a, b);
          if (nb >= 0 && mark.has(nb)) continue;
          const blocked = seg.has(key) && key !== crossKey;
          if (nb >= 0 && !blocked) { const u = tv[3 * nb], v = tv[3 * nb + 1], w = tv[3 * nb + 2]; if (inCircle(X[u], Y[u], X[v], Y[v], X[w], Y[w], px, py) > 0) { mark.add(nb); cav.push(nb); continue; } }
          if (key === crossKey && nb >= 0) { if (!mark.has(nb)) { mark.add(nb); cav.push(nb); } continue; }
          bnd.push([a, b, nb, inside[t]]);
        }
      }
      return { cav, bnd };
    };
    const commit = (p, C) => {
      for (const t of C.cav) { alive[t] = 0; freeT.push(t); }
      const startAt = new Map(), endAt = new Map(), made = [];
      for (const [a, b, nb, flag] of C.bnd) {
        const t = newTri(p, a, b, flag); made.push(t); tn[3 * t] = nb;
        if (nb >= 0) for (let k = 0; k < 3; k++) { const x = tv[3 * nb + (k + 1) % 3], y = tv[3 * nb + (k + 2) % 3]; if (x === b && y === a) { tn[3 * nb + k] = t; break; } }
        startAt.set(a, t); endAt.set(b, t);
      }
      for (const t of made) { const a = tv[3 * t + 1], b = tv[3 * t + 2]; const n1 = startAt.get(b), n2 = endAt.get(a); tn[3 * t + 1] = n1 ?? -1; tn[3 * t + 2] = n2 ?? -1; }
      vtri[p] = made[0]; lastT = made[0];
      return made;
    };
    const addPoint = (x, y) => { X.push(x); Y.push(y); return X.length - 1; };
    const insertFree = (x, y, hint) => {
      const L = locate(x, y, hint); const t = L.t;
      for (let k = 0; k < 3; k++) { const v = tv[3 * t + k]; if (Math.abs(X[v] - x) + Math.abs(Y[v] - y) < 1e-12 * diag) return v; }
      const p = addPoint(x, y); commit(p, cavity(x, y, [t], -1)); return p;
    };
    // triangle containing directed edge a→b
    const triWithEdge = (a, b) => {
      const t0 = vtri[a]; if (t0 == null || !alive[t0] || (tv[3 * t0] !== a && tv[3 * t0 + 1] !== a && tv[3 * t0 + 2] !== a)) { for (let t = 0; t < nt; t++) if (alive[t]) for (let k = 0; k < 3; k++) if (tv[3 * t + k] === a && tv[3 * t + (k + 1) % 3] === b) return t; return -1; }
      let t = t0;
      for (let guard = 0; guard < 1000; guard++) {
        let k = tv[3 * t] === a ? 0 : tv[3 * t + 1] === a ? 1 : 2;
        if (tv[3 * t + (k + 1) % 3] === b) return t;
        const nb = tn[3 * t + (k + 2) % 3]; // rotate around a (clockwise neighbour across edge a–next)
        if (nb < 0 || nb === t0) break; t = nb;
      }
      // other direction
      t = t0;
      for (let guard = 0; guard < 1000; guard++) {
        let k = tv[3 * t] === a ? 0 : tv[3 * t + 1] === a ? 1 : 2;
        if (tv[3 * t + (k + 1) % 3] === b) return t;
        const nb = tn[3 * t + (k + 1) % 3]; if (nb < 0 || nb === t0) break; t = nb;
      }
      return -1;
    };
    const hasEdge = (a, b) => triWithEdge(a, b) >= 0 || triWithEdge(b, a) >= 0;

    // --- insert boundary points (graded along each edge) ---
    const vkey = (x, y) => Math.round(x / (diag * 1e-9)) + ',' + Math.round(y / (diag * 1e-9));
    const vmap = new Map(), segList = [];
    const vertexAt = p => { const k = vkey(p[0], p[1]); if (vmap.has(k)) return vmap.get(k); const v = insertFree(p[0], p[1], lastT); vmap.set(k, v); return v; };
    edges.forEach((E, k) => {
      const e = E.e, L = G.edgeLength(e), cap = edgeSize[k];
      // integrate 1/h along the edge to place points evenly in "size units"
      const M = 64, acc = [0]; for (let i = 1; i <= M; i++) { const p = G.edgePoint(e, (i - 0.5) / M); acc.push(acc[i - 1] + (L / M) / Math.min(cap, H(p[0], p[1]))); }
      const n = Math.max(e.type === 'arc' && Math.abs(e.da) > 6 ? 3 : 1, Math.round(acc[M]));
      const ts = [0]; for (let s = 1; s < n; s++) { const target = acc[M] * s / n; let i = 1; while (acc[i] < target) i++; ts.push((i - 1 + (target - acc[i - 1]) / (acc[i] - acc[i - 1])) / M); } ts.push(1);
      const vs = ts.map(t => vertexAt(G.edgePoint(e, t)));
      for (let i = 0; i + 1 < vs.length; i++) if (vs[i] !== vs[i + 1]) segList.push([vs[i], vs[i + 1], E.id]);
    });
    // --- recover segments by midpoint splitting (conforming) ---
    let stack = segList.slice(), guard = 0;
    while (stack.length && guard++ < 200000) {
      const [a, b, id] = stack.pop();
      if (hasEdge(a, b)) { seg.set(skey(a, b), id); continue; }
      const m = insertFree((X[a] + X[b]) / 2, (Y[a] + Y[b]) / 2, vtri[a]);
      stack.push([a, m, id], [m, b, id]);
    }
    // --- classify triangles by flood fill (crossing a segment flips inside/outside) ---
    {
      for (let t = 0; t < nt; t++) inside[t] = -1;
      let start = -1; for (let t = 0; t < nt; t++) if (alive[t] && (tv[3 * t] < 3 || tv[3 * t + 1] < 3 || tv[3 * t + 2] < 3)) { start = t; break; }
      const q = [start]; inside[start] = 0;
      for (let h = 0; h < q.length; h++) {
        const t = q[h];
        for (let k = 0; k < 3; k++) { const nb = tn[3 * t + k]; if (nb < 0 || !alive[nb] || inside[nb] >= 0) continue; const a = tv[3 * t + (k + 1) % 3], b = tv[3 * t + (k + 2) % 3]; inside[nb] = seg.has(skey(a, b)) ? 1 - inside[t] : inside[t]; q.push(nb); }
      }
    }
    // --- refinement ---
    const isSuper = v => v < 3;
    const encroached = (key, px, py) => { const a = Math.floor(key / K), b = key % K, mx = (X[a] + X[b]) / 2, my = (Y[a] + Y[b]) / 2, r2 = ((X[a] - X[b]) ** 2 + (Y[a] - Y[b]) ** 2) / 4; return (px - mx) ** 2 + (py - my) ** 2 < r2 * (1 - 1e-9); };
    const minSeg = diag * 2e-5;
    const splitSeg = key => {
      if (!seg.has(key)) return false;
      const a = Math.floor(key / K), b = key % K, id = seg.get(key);
      if (Math.hypot(X[a] - X[b], Y[a] - Y[b]) < minSeg) return false;
      const t1 = triWithEdge(a, b), t2 = triWithEdge(b, a), seeds = [t1, t2].filter(t => t >= 0);
      if (!seeds.length) return false;
      const mx = (X[a] + X[b]) / 2, my = (Y[a] + Y[b]) / 2, p = addPoint(mx, my);
      const C = cavity(mx, my, seeds, key); seg.delete(key);
      const made = commit(p, C);
      seg.set(skey(a, p), id); seg.set(skey(p, b), id);
      checkNew(p, made); return true;
    };
    const segQueue = [], triQueue = [];
    const checkNew = (p, made) => {
      for (const t of made) {
        const a = tv[3 * t + 1], b = tv[3 * t + 2], key = skey(a, b);
        if (seg.has(key) && encroached(key, X[p], Y[p])) segQueue.push(key);
        triQueue.push(t);
      }
    };
    for (const key of seg.keys()) {   // initial encroachment check via the apexes of both adjacent triangles
      const a = Math.floor(key / K), b = key % K;
      for (const t of [triWithEdge(a, b), triWithEdge(b, a)]) if (t >= 0) { for (let k = 0; k < 3; k++) { const v = tv[3 * t + k]; if (v !== a && v !== b && !isSuper(v) && encroached(key, X[v], Y[v])) { segQueue.push(key); break; } } }
    }
    for (let t = 0; t < nt; t++) if (alive[t] && inside[t] === 1) triQueue.push(t);
    const sinMin = Math.sin(minAng);
    const badness = t => {
      const a = tv[3 * t], b = tv[3 * t + 1], c = tv[3 * t + 2];
      const la = Math.hypot(X[b] - X[c], Y[b] - Y[c]), lb = Math.hypot(X[a] - X[c], Y[a] - Y[c]), lc = Math.hypot(X[a] - X[b], Y[a] - Y[b]);
      const area = Math.abs(orient(X[a], Y[a], X[b], Y[b], X[c], Y[c])) / 2; if (area <= 0) return 0;
      const Rc = la * lb * lc / (4 * area), lmin = Math.min(la, lb, lc), lmax = Math.max(la, lb, lc), h = H((X[a] + X[b] + X[c]) / 3, (Y[a] + Y[b] + Y[c]) / 3);
      if (lmax > h * 1.25) return 2;                          // too large
      if (lmin / (2 * Rc) < sinMin && lmin > h * 0.04) return 1;   // too skinny (tiny features are left alone)
      return 0;
    };
    let iter = 0, qh = 0;
    while ((segQueue.length || qh < triQueue.length) && X.length < maxNodes && iter++ < 4 * maxNodes) {
      if (segQueue.length) { splitSeg(segQueue.pop()); continue; }
      if (qh > 50000 && qh * 2 > triQueue.length) { triQueue.splice(0, qh); qh = 0; }
      const t = triQueue[qh++]; if (!alive[t] || inside[t] !== 1 || !badness(t)) continue;
      const a = tv[3 * t], b = tv[3 * t + 1], c = tv[3 * t + 2];
      // circumcentre
      const ax = X[a], ay = Y[a], bx = X[b] - ax, by = Y[b] - ay, qx = X[c] - ax, qy = Y[c] - ay, d = 2 * (bx * qy - by * qx);
      if (!d) continue;
      const b2 = bx * bx + by * by, c2 = qx * qx + qy * qy, ux = ax + (qy * b2 - by * c2) / d, uy = ay + (bx * c2 - qx * b2) / d;
      const W = walkVisible(ux, uy, t);
      if (W.blocked != null) { if (W.blocked >= 0 && splitSeg(W.blocked)) triQueue.push(t); continue; }
      if (inside[W.t] !== 1) continue;
      const C = cavity(ux, uy, [W.t], -1);
      const enc = C.bnd.filter(([p, q]) => seg.has(skey(p, q)) && encroached(skey(p, q), ux, uy)).map(([p, q]) => skey(p, q));
      if (enc.length) { let any = false; for (const k of enc) any = splitSeg(k) || any; if (any) triQueue.push(t); continue; }
      let dup = false; for (const tt of C.cav) for (let k = 0; k < 3; k++) { const v = tv[3 * tt + k]; if (Math.abs(X[v] - ux) + Math.abs(Y[v] - uy) < 1e-10 * diag) dup = true; }
      if (dup) continue;
      const p = addPoint(ux, uy); checkNew(p, commit(p, C));
    }
    // --- collect interior triangles ---
    const tris = []; for (let t = 0; t < nt; t++) if (alive[t] && inside[t] === 1) tris.push([tv[3 * t], tv[3 * t + 1], tv[3 * t + 2]]);
    if (!tris.length) throw new Error('Meshing produced no elements — is the outline closed?');
    // smoothing of interior vertices (not on segments), keeping every triangle valid
    const onSeg = new Uint8Array(X.length); for (const k of seg.keys()) { onSeg[Math.floor(k / K)] = 1; onSeg[k % K] = 1; }
    if (opts.smooth !== false) {
      const nbr = Array.from({ length: X.length }, () => []), vt = Array.from({ length: X.length }, () => []);
      tris.forEach((T, i) => { for (let k = 0; k < 3; k++) { nbr[T[k]].push(T[(k + 1) % 3], T[(k + 2) % 3]); vt[T[k]].push(i); } });
      for (let pass = 0; pass < 3; pass++) for (let v = 3; v < X.length; v++) {
        if (onSeg[v] || !nbr[v].length) continue;
        let sx = 0, sy = 0; for (const w of nbr[v]) { sx += X[w]; sy += Y[w]; }
        const ox = X[v], oy = Y[v]; X[v] = sx / nbr[v].length; Y[v] = sy / nbr[v].length;
        let ok = true; for (const i of vt[v]) { const [a, b, c] = tris[i]; if (orient(X[a], Y[a], X[b], Y[b], X[c], Y[c]) <= 1e-12 * diag * diag) { ok = false; break; } }
        if (!ok) { X[v] = ox; Y[v] = oy; }
      }
    }
    // --- renumber and build 6-node elements ---
    const map = new Int32Array(X.length).fill(-1), P = [];
    for (const T of tris) for (const v of T) if (map[v] < 0) { map[v] = P.length / 2; P.push(X[v], Y[v]); }
    const nCorner = P.length / 2, edgeMid = new Map(), edgeInfo = new Map();
    const shapeById = new Map(); shapes.forEach(s => shapeById.set(s.id, s));
    const geomEdge = id => { const [sid, i] = id.split(':'); const s = shapeById.get(sid); return s ? G.shapeEdges(s)[+i] : null; };
    // boundary edges: an interior triangle edge that is a segment
    const quadratic = opts.quadratic !== false, elems = [], bnd = [];
    for (const [a0, b0, c0] of tris) {
      const T = [a0, b0, c0], el = [map[a0], map[b0], map[c0]];
      for (let k = 0; k < 3; k++) {
        const u = T[k], v = T[(k + 1) % 3], key = skey(u, v);
        let m = edgeMid.get(key);
        if (m == null) {
          let mx = (X[u] + X[v]) / 2, my = (Y[u] + Y[v]) / 2; const id = seg.get(key);
          if (id != null) { const ge = geomEdge(id); if (ge && ge.type === 'arc') { const dx = mx - ge.c[0], dy = my - ge.c[1], L = Math.hypot(dx, dy) || 1; mx = ge.c[0] + dx / L * ge.r; my = ge.c[1] + dy / L * ge.r; } }
          m = P.length / 2; P.push(mx, my); edgeMid.set(key, m);
        }
        el.push(m);
        if (seg.has(key)) bnd.push({ n: [map[u], m, map[v]], edge: seg.get(key) });
      }
      // order: 0,1,2 corners, 3 = mid(0-1), 4 = mid(1-2), 5 = mid(2-0)
      elems.push(el[0], el[1], el[2], el[3], el[4], el[5]);
    }
    // a segment that is shared by two interior triangles is an internal outline (shouldn't happen with even-odd); keep only true boundary
    const cnt = new Map(); bnd.forEach(b => { const k = Math.min(b.n[0], b.n[2]) + ',' + Math.max(b.n[0], b.n[2]); cnt.set(k, (cnt.get(k) || 0) + 1); });
    const boundary = bnd.filter(b => cnt.get(Math.min(b.n[0], b.n[2]) + ',' + Math.max(b.n[0], b.n[2])) === 1);
    // quality
    let worst = 180, sumQ = 0;
    for (const [a, b, c] of tris) {
      const ang = [[a, b, c], [b, c, a], [c, a, b]].map(([p, q, r]) => { const ux = X[q] - X[p], uy = Y[q] - Y[p], vx = X[r] - X[p], vy = Y[r] - Y[p]; return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy))))) * 180 / Math.PI; });
      worst = Math.min(worst, ...ang); sumQ += Math.min(...ang);
    }
    return {
      kind: 'T6', nodes: new Float64Array(P), nCorner, elems: new Int32Array(elems), boundary,
      tri2d: { pts: Array.from({ length: nCorner }, (_, i) => [P[2 * i], P[2 * i + 1]]), tris: tris.map(T => T.map(v => map[v])) },
      stats: { nodes: P.length / 2, elements: tris.length, minAngle: worst, meanMinAngle: sumQ / tris.length, size: hg, ms: Date.now() - t0 }
    };
  }

  return { mesh, sizeField };
});
