'use strict';
/* Lumen Diagram — connector routing.
   Endpoints stay glued: an end is {id, port:null} (floating, attaches wherever is best), {id, port:[px,py]} (fixed
   connection point in the shape's 0..1 box) or a free point {x,y}.
   Routes: straight, orthogonal (A* over a sparse visibility grid built from shape bounds, with bend penalties, so the
   line goes around other shapes) and curved (the orthogonal route smoothed into quadratic B-spline curves). */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const G = isNode ? require('./geom.js') : root.DiaGeom;
  const S = isNode ? require('./shapes.js') : root.DiaShapes;
  const M = isNode ? require('./model.js') : root.DiaModel;

  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1];   // 0 right, 1 down, 2 left, 3 up
  const dirOf = (dx, dy) => Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 0 : 2) : (dy >= 0 ? 1 : 3);
  const rotDir = (d, deg) => (d + ((Math.round((deg || 0) / 90) % 4) + 4)) % 4;

  // world point on the outline of shape c, on the ray from its centre toward p
  function perimeter(c, p) {
    const d = S.get(c.shape), ctr = M.center(c);
    if (d.perimeter === 'lifeline') return { x: ctr.x, y: Math.max(c.y + 40, Math.min(c.y + c.h, p.y)) };
    if (Math.abs(p.x - ctr.x) < 1e-6 && Math.abs(p.y - ctr.y) < 1e-6) return ctr;
    return G.rayHit(M.outline(c), ctr, p) || ctr;
  }
  // fixed port → {pt, dir}
  function portPoint(c, port) {
    const d = S.get(c.shape);
    let [px, py] = port; px = Math.max(0, Math.min(1, px)); py = Math.max(0, Math.min(1, py));
    const t = M.xf(c), w = t(px * c.w, py * c.h), lp = { x: w[0], y: w[1] };
    const fx = c.flipH ? 1 - px : px, fy = c.flipV ? 1 - py : py;
    const ds = [1 - fx, 1 - fy, fx, fy]; let side = 0; for (let i = 1; i < 4; i++) if (ds[i] < ds[side]) side = i;
    const dir = rotDir(side, c.rot);
    if (d.perimeter === 'lifeline') return { pt: lp, dir: px < 0.5 ? 2 : 0, exact: true };
    if (Math.abs(px - 0.5) < 1e-6 && Math.abs(py - 0.5) < 1e-6) return { pt: M.center(c), dir };
    return { pt: perimeter(c, lp), dir };
  }
  function sideCands(c, toward) {
    const d = S.get(c.shape);
    if (d.perimeter === 'lifeline') { const ctr = M.center(c), y = Math.max(c.y + 40, Math.min(c.y + c.h, toward ? toward.y : ctr.y)); return [{ pt: { x: ctr.x, y }, dir: 0 }, { pt: { x: ctr.x, y }, dir: 2 }]; }
    const t = M.xf(c), loc = [[c.w, c.h / 2], [c.w / 2, c.h], [0, c.h / 2], [c.w / 2, 0]];
    return loc.map(([a, b], i) => { const w = t(a, b); const dir = rotDir(c.flipH && i % 2 === 0 ? (i + 2) % 4 : c.flipV && i % 2 ? (i + 2) % 4 : i, c.rot); return { pt: perimeter(c, { x: w[0], y: w[1] }), dir }; });
  }

  /* ---------- orthogonal A* router ---------- */
  class Heap {
    constructor() { this.k = []; this.v = []; }
    get size() { return this.k.length; }
    push(key, val) { const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val); while (i > 0) { const p = (i - 1) >> 1; if (k[p] <= key) break; k[i] = k[p]; v[i] = v[p]; i = p; } k[i] = key; v[i] = val; }
    pop() {
      const k = this.k, v = this.v, top = v[0], lk = k.pop(), lv = v.pop(); const n = k.length;
      if (n) { let i = 0; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && k[c + 1] < k[c]) c++; if (k[c] >= lk) break; k[i] = k[c]; v[i] = v[c]; i = c; } k[i] = lk; v[i] = lv; }
      return top;
    }
  }
  const inflate = (b, m) => ({ x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m });
  // distance from p along dir until outside box b (b inflated)
  function exitDist(p, dir, b) {
    if (!b) return 0;
    if (dir === 0) return Math.max(0, b.x + b.w - p.x); if (dir === 2) return Math.max(0, p.x - b.x);
    if (dir === 1) return Math.max(0, b.y + b.h - p.y); return Math.max(0, p.y - b.y);
  }
  function uniqSorted(a, fixed) { a.sort((x, y) => x - y); const o = []; for (const v of a) { const last = o[o.length - 1]; if (o.length && v - last <= 1.5) { if (fixed.has(v) && !fixed.has(last)) o[o.length - 1] = v; else if (fixed.has(v) && fixed.has(last) && v - last > 0.01) o.push(v); continue; } o.push(v); } return o; }
  function lowerIdx(arr, v) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v - 0.01) lo = m + 1; else hi = m; } return lo; }

  // A, B: {cands:[{pt,dir}], box (shape AABB or null)}; obstacles: [{box}]
  function orthogonal(A, B, obstacles, o = {}) {
    const m = o.margin || 16, bend = o.bend || 24;
    let reg = G.bboxPts([...A.cands.map(c => c.pt), ...B.cands.map(c => c.pt)]);
    if (A.box) reg = G.unionBox(reg, A.box); if (B.box) reg = G.unionBox(reg, B.box);
    reg = inflate(reg, 140 + m);
    // raw obstacle boxes near the route; each gets a clearance of m, reduced where shapes sit closer than 2m
    // so that neighbouring clearances never overlap and every stub end stays reachable
    const raw = [];
    for (const ob of obstacles) if (G.boxHit(inflate(ob.box, m), reg)) raw.push({ r: ob.box, own: 0 });
    if (A.box) raw.push({ r: A.box, own: 1 }); if (B.box) raw.push({ r: B.box, own: 2 });
    const sep = (a, b) => Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), b.y - (a.y + a.h), a.y - (b.y + b.h));
    for (const o1 of raw) { o1.m = m; for (const o2 of raw) if (o1 !== o2) { const s = sep(o1.r, o2.r); if (s >= 0) o1.m = Math.min(o1.m, Math.max(2, s / 2 - 0.5)); } }
    const ownA = raw.find(o => o.own === 1), ownB = raw.find(o => o.own === 2);
    const mk = (E, own) => E.cands.map(c => { const L = Math.max(own ? exitDist(c.pt, c.dir, own) : 0, E.box ? 2 : 0); return { pt: c.pt, dir: c.dir, end: { x: c.pt.x + DX[c.dir] * L, y: c.pt.y + DY[c.dir] * L }, len: L, pen: c.pen || 0 }; });
    const sa = mk(A, ownA && inflate(ownA.r, ownA.m)), sb = mk(B, ownB && inflate(ownB.r, ownB.m));
    let obs = raw.map(o => ({ b: inflate(o.r, o.m), own: o.own }));
    const strictIn = (p, b) => p.x > b.x + 1.5 && p.x < b.x + b.w - 1.5 && p.y > b.y + 1.5 && p.y < b.y + b.h - 1.5;
    // an obstacle that swallows a stub end (shapes overlapping or very close) cannot be avoided: ignore it
    obs = obs.filter(o => !sa.some(s => o.own !== 1 && strictIn(s.end, o.b)) && !sb.some(s => o.own !== 2 && strictIn(s.end, o.b))).map(o => o.b);
    let full = reg; for (const b of obs) full = G.unionBox(full, b); full = inflate(full, 24);
    // grid lines
    const xs = [full.x, full.x + full.w], ys = [full.y, full.y + full.h], tagX = [], tagY = [];
    for (const b of obs) { xs.push(b.x, b.x + b.w); ys.push(b.y, b.y + b.h); tagX.push([b.x, 0], [b.x + b.w, 1]); tagY.push([b.y, 0], [b.y + b.h, 1]); }
    const fixX = new Set(), fixY = new Set();
    for (const s of [...sa, ...sb]) { xs.push(s.end.x); ys.push(s.end.y); fixX.add(s.end.x); fixY.add(s.end.y); }
    if (A.box && B.box) {
      const a = A.box, b = B.box;
      if (a.x + a.w < b.x) xs.push((a.x + a.w + b.x) / 2); else if (b.x + b.w < a.x) xs.push((b.x + b.w + a.x) / 2);
      if (a.y + a.h < b.y) ys.push((a.y + a.h + b.y) / 2); else if (b.y + b.h < a.y) ys.push((b.y + b.h + a.y) / 2);
    }
    const chan = (tags, out) => { tags.sort((p, q) => p[0] - q[0]); for (let i = 0; i + 1 < tags.length; i++) if (tags[i][1] === 1 && tags[i + 1][1] === 0 && tags[i + 1][0] - tags[i][0] > 4) out.push((tags[i][0] + tags[i + 1][0]) / 2); };
    chan(tagX, xs); chan(tagY, ys);
    const X = uniqSorted(xs, fixX), Y = uniqSorted(ys, fixY), nx = X.length, ny = Y.length, N = nx * ny;
    const nodeB = new Uint8Array(N), hB = new Uint8Array(N), vB = new Uint8Array(N);   // hB[j*nx+i]: segment i→i+1 at row j
    for (const b of obs) {
      const x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.h;
      const i0 = lowerIdx(X, x0), i1 = lowerIdx(X, x1), j0 = lowerIdx(Y, y0), j1 = lowerIdx(Y, y1);
      for (let j = j0; j <= j1 && j < ny; j++) {
        const yIn = Y[j] > y0 + 1.5 && Y[j] < y1 - 1.5;
        for (let i = i0; i <= i1 && i < nx; i++) {
          const xIn = X[i] > x0 + 1.5 && X[i] < x1 - 1.5;
          if (xIn && yIn) nodeB[j * nx + i] = 1;
          if (yIn && i + 1 < nx && X[i] >= x0 - 1.5 && X[i + 1] <= x1 + 1.5) hB[j * nx + i] = 1;
          if (xIn && j + 1 < ny && Y[j] >= y0 - 1.5 && Y[j + 1] <= y1 + 1.5) vB[j * nx + i] = 1;
        }
      }
    }
    const nodeAt = p => { const i = lowerIdx(X, p.x), j = lowerIdx(Y, p.y); return i < nx && j < ny && Math.abs(X[i] - p.x) < 0.02 && Math.abs(Y[j] - p.y) < 0.02 ? j * nx + i : -1; };
    const g = new Float64Array(N * 4).fill(Infinity), par = new Int32Array(N * 4).fill(-1), done = new Uint8Array(N * 4);
    const heap = new Heap(), targets = new Map();
    sb.forEach((s, k) => { const n = nodeAt(s.end); if (n >= 0) { if (!targets.has(n)) targets.set(n, []); targets.get(n).push(k); } });
    const tEnds = sb.map(s => s.end);
    const hFn = n => { const x = X[n % nx], y = Y[(n / nx) | 0]; let h = Infinity; for (const e of tEnds) { const d = Math.abs(e.x - x) + Math.abs(e.y - y); if (d < h) h = d; } return h; };
    const startOf = new Map();
    sa.forEach((s, k) => { const n = nodeAt(s.end); if (n < 0) return; const st = n * 4 + s.dir, c = s.len + s.pen; if (c < g[st]) { g[st] = c; startOf.set(st, k); heap.push(c + hFn(n), st); } });
    const FIN = N * 4; let best = null, iter = 0;
    while (heap.size && iter++ < 400000) {
      const st = heap.pop();
      if (st >= FIN) { best = st - FIN; break; }
      if (done[st]) continue; done[st] = 1;
      const n = (st / 4) | 0, d = st & 3, gc = g[st], i = n % nx, j = (n / nx) | 0;
      const tk = targets.get(n);
      if (tk) for (const k of tk) {
        const s = sb[k], opp = (s.dir + 2) % 4, term = d === opp ? 0 : d === s.dir ? 2 * bend : bend;
        heap.push(gc + term + s.len + s.pen, FIN + finList.length); finList.push({ st, k });
      }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (d + 2) % 4) continue;
        let ni = i + DX[nd], nj = j + DY[nd];
        if (ni < 0 || nj < 0 || ni >= nx || nj >= ny) continue;
        if (nd === 0 && hB[j * nx + i] || nd === 2 && hB[j * nx + ni] || nd === 1 && vB[j * nx + i] || nd === 3 && vB[nj * nx + i]) continue;
        const nn = nj * nx + ni; if (nodeB[nn] && !targets.has(nn)) continue;
        const ns = nn * 4 + nd, c = gc + Math.abs(X[ni] - X[i]) + Math.abs(Y[nj] - Y[j]) + (nd !== d ? bend : 0);
        if (c < g[ns]) { g[ns] = c; par[ns] = st; heap.push(c + hFn(nn), ns); }
      }
    }
    const fin = best == null ? null : finList[best]; finList.length = 0;
    if (!fin) return null;
    const nodes = []; let st = fin.st, guard = 0;
    while (st >= 0 && guard++ < 100000) { const n = (st / 4) | 0; nodes.push({ x: X[n % nx], y: Y[(n / nx) | 0] }); st = par[st]; }
    nodes.reverse();
    const first = sa[startOf.get(lastStart(fin.st, par, startOf))], last = sb[fin.k];
    const pts = G.simplify([first.pt, ...nodes, last.pt], 0.01);
    return { pts, sDir: first.dir, tDir: last.dir };
  }
  const finList = [];
  function lastStart(st, par, startOf) { let s = st, guard = 0; while (par[s] >= 0 && guard++ < 100000) s = par[s]; return s; }

  // simple elbow through points (used with manual waypoints and as fallback)
  function elbow(pts, sDir) {
    const out = [pts[0]]; let horiz = sDir == null ? Math.abs(pts[1].x - pts[0].x) >= Math.abs(pts[1].y - pts[0].y) : sDir % 2 === 0;
    for (let i = 1; i < pts.length; i++) {
      const a = out[out.length - 1], b = pts[i];
      if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) { out.push(horiz ? { x: b.x, y: a.y } : { x: a.x, y: b.y }); horiz = !horiz; }
      else horiz = Math.abs(a.x - b.x) > 0.5 ? false : true;
      out.push(b);
    }
    return G.simplify(out);
  }

  /* ---------- per edge ---------- */
  function endShape(end, byId) { return end && end.id ? byId.get(end.id) : null; }
  function endRef(end, byId) { const c = endShape(end, byId); if (!c) return end && end.id ? { x: 0, y: 0 } : { x: end ? end.x : 0, y: end ? end.y : 0 }; if (end.port) return portPoint(c, end.port).pt; return M.center(c); }

  function routeEdge(e, ctx) {
    const byId = ctx.byId, st = S.styleOf(e);
    const sc = endShape(e.src, byId), tc = endShape(e.tgt, byId);
    const sShape = sc && sc.kind === 'shape' ? sc : null, tShape = tc && tc.kind === 'shape' ? tc : null;
    const pts = (e.pts || []).map(p => ({ x: p.x, y: p.y }));
    const route = st.route === 'straight' || st.route === 'curved' ? st.route : 'orthogonal';
    const freePt = end => ({ x: end && end.x || 0, y: end && end.y || 0 });
    // self loop
    if (sShape && tShape && sShape === tShape && !pts.length) {
      const b = M.shapeBox(sShape), r = Math.min(30, b.h / 2);
      const p0 = { x: b.x + b.w, y: b.y + b.h / 2 - r / 2 }, p3 = { x: b.x + b.w - Math.min(30, b.w / 3), y: b.y };
      return { pts: [p0, { x: p0.x + r, y: p0.y }, { x: p0.x + r, y: b.y - r }, { x: p3.x, y: b.y - r }, p3], curved: route === 'curved', sDir: 0, tDir: 3 };
    }
    if (route === 'straight' || (route === 'curved' && pts.length)) {
      const sRef = pts.length ? pts[0] : endRef(e.tgt, byId), tRef = pts.length ? pts[pts.length - 1] : endRef(e.src, byId);
      const sp = sShape ? (e.src.port ? portPoint(sShape, e.src.port).pt : perimeter(sShape, sRef)) : freePt(e.src);
      let tp = tShape ? (e.tgt.port ? portPoint(tShape, e.tgt.port).pt : perimeter(tShape, pts.length ? tRef : sp)) : freePt(e.tgt);
      // re-aim the source at the target's actual attach point for floating→fixed pairs
      const sp2 = sShape && !e.src.port && !pts.length ? perimeter(sShape, tp) : sp;
      return { pts: [sp2, ...pts, tp], curved: route === 'curved' && pts.length > 0 };
    }
    // orthogonal (and curved without waypoints = smoothed orthogonal)
    const ends = (end, shape, toward) => {
      if (!shape) { const p = freePt(end); return { cands: [0, 1, 2, 3].map(d => ({ pt: p, dir: d })), box: null }; }
      if (end.port) { const pp = portPoint(shape, end.port); return { cands: [pp], box: M.shapeBox(shape) }; }
      const cs = sideCands(shape, toward);
      return { cands: cs, box: S.get(shape.shape).perimeter === 'lifeline' ? null : M.shapeBox(shape) };
    };
    if (pts.length) {
      const a = ends(e.src, sShape, pts[0]), b = ends(e.tgt, tShape, pts[pts.length - 1]);
      const pick = (E, ref) => { let best = E.cands[0], bd = Infinity; for (const c of E.cands) { const dx = ref.x - c.pt.x, dy = ref.y - c.pt.y, dd = Math.hypot(dx, dy) - (DX[c.dir] * dx + DY[c.dir] * dy) * 0.9; if (dd < bd) { bd = dd; best = c; } } return best; };
      const s = pick(a, pts[0]), t = pick(b, pts[pts.length - 1]);
      return { pts: elbow([s.pt, ...pts, t.pt], s.dir), curved: false, sDir: s.dir, tDir: t.dir };
    }
    const A = ends(e.src, sShape, endRef(e.tgt, byId)), B = ends(e.tgt, tShape, endRef(e.src, byId));
    const skip = new Set([sShape && sShape.id, tShape && tShape.id]);
    // shapes containing an endpoint shape (containers) are not obstacles; neither are the edge's own ends
    const obstacles = (ctx.obstacles || []).filter(o => !skip.has(o.id) && !(sShape && G.inBox(M.center(sShape), o.box)) && !(tShape && G.inBox(M.center(tShape), o.box)));
    // mild preference for sides facing the other end
    const cA = A.box && B.box ? M.center(sShape) : null, cB = A.box && B.box ? M.center(tShape) : null;
    if (cA && cB && !e.src.port) A.cands.forEach(c => { const dot = DX[c.dir] * (cB.x - cA.x) + DY[c.dir] * (cB.y - cA.y); c.pen = dot < 0 ? 8 : 0; });
    if (cA && cB && !e.tgt.port) B.cands.forEach(c => { const dot = DX[c.dir] * (cA.x - cB.x) + DY[c.dir] * (cA.y - cB.y); c.pen = dot < 0 ? 8 : 0; });
    let r = orthogonal(A, B, obstacles, { margin: st.jettySize || 18 });
    if (!r) { const s = A.cands[0], t = B.cands[0]; r = { pts: elbow([s.pt, t.pt], s.dir), sDir: s.dir, tDir: t.dir }; }
    return { pts: r.pts, curved: route === 'curved', sDir: r.sDir, tDir: r.tDir };
  }

  function obstaclesOf(page) {
    const vis = new Set(page.layers.filter(l => l.visible !== false).map(l => l.id)), out = [];
    for (const c of page.cells) {
      if (c.kind !== 'shape' || (c.layer && !vis.has(c.layer))) continue;
      const d = S.get(c.shape); if (d.obstacle === false || d.container) continue;
      out.push({ id: c.id, box: M.shapeBox(c) });
    }
    return out;
  }
  // route every edge of a page. o.only: Set of edge ids to recompute (others reused from o.prev)
  // memo: an edge is only re-routed when its own data, its end shapes or the obstacles near it change
  const memo = new Map();
  const geoKey = c => c ? `${c.x},${c.y},${c.w},${c.h},${c.rot || 0},${c.flipH ? 1 : 0}${c.flipV ? 1 : 0},${c.shape}` : '';
  function edgeKey(c, byId, obstacles) {
    const s = c.src && c.src.id ? byId.get(c.src.id) : null, t = c.tgt && c.tgt.id ? byId.get(c.tgt.id) : null;
    let k = JSON.stringify([c.src, c.tgt, c.pts, c.style.route, c.style.jettySize]) + geoKey(s) + '|' + geoKey(t);
    if ((c.style.route || 'orthogonal') !== 'straight' && !(c.pts && c.pts.length)) {
      let reg = null; for (const x of [s, t]) if (x) reg = G.unionBox(reg, M.shapeBox(x));
      if (!reg) { const a = endRef(c.src, byId), b = endRef(c.tgt, byId); reg = G.bboxPts([a, b]); }
      reg = inflate(reg, 200);
      for (const ob of obstacles) if (G.boxHit(ob.box, reg)) k += `|${ob.id}:${ob.box.x},${ob.box.y},${ob.box.w},${ob.box.h}`;
    }
    return k;
  }
  function routePage(page, o = {}) {
    const byId = o.byId || M.index(page), obstacles = obstaclesOf(page), out = new Map(), ctx = { byId, obstacles };
    for (const c of page.cells) {
      if (c.kind !== 'edge') continue;
      if (o.only && o.prev && !o.only.has(c.id) && o.prev.has(c.id)) { out.set(c.id, o.prev.get(c.id)); continue; }
      const key = page.id + '|' + edgeKey(c, byId, obstacles), m = memo.get(c.id);
      if (m && m.key === key && !o.noCache) { out.set(c.id, m.r); continue; }
      let r;
      try { r = routeEdge(c, ctx); } catch (err) { r = { pts: [endRef(c.src, byId), endRef(c.tgt, byId)], curved: false }; }
      out.set(c.id, r);
      if (memo.size > 20000) memo.clear();
      memo.set(c.id, { key, r });
    }
    return out;
  }

  /* ---------- path strings ---------- */
  function curveD(pts) {
    const P = G.P;
    if (pts.length < 3) return `M${P(pts[0].x, pts[0].y)} L${P(pts[pts.length - 1].x, pts[pts.length - 1].y)}`;
    let d = `M${P(pts[0].x, pts[0].y)}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i], q = i === pts.length - 2 ? pts[i + 1] : { x: (p.x + pts[i + 1].x) / 2, y: (p.y + pts[i + 1].y) / 2 };
      d += ` Q${P(p.x, p.y)} ${P(q.x, q.y)}`;
    }
    return d;
  }
  function polyD(pts, radius) {
    const P = G.P; let d = `M${P(pts[0].x, pts[0].y)}`;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (radius && i < pts.length - 1) {
        const a = pts[i - 1], b = pts[i + 1], l1 = G.dist(a, p), l2 = G.dist(p, b), r = Math.min(radius, l1 / 2, l2 / 2);
        if (r > 0.5) { const p1 = { x: p.x + (a.x - p.x) * r / l1, y: p.y + (a.y - p.y) * r / l1 }, p2 = { x: p.x + (b.x - p.x) * r / l2, y: p.y + (b.y - p.y) * r / l2 }; d += ` L${P(p1.x, p1.y)} Q${P(p.x, p.y)} ${P(p2.x, p2.y)}`; continue; }
      }
      d += ` L${P(p.x, p.y)}`;
    }
    return d;
  }

  const api = { routeEdge, routePage, obstaclesOf, orthogonal, elbow, perimeter, portPoint, sideCands, curveD, polyD, endRef, DX, DY, dirOf };
  if (isNode) module.exports = api; else root.DiaRoute = api;
})(typeof self !== 'undefined' ? self : this);
