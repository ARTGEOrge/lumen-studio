// Lumen PCB autorouter: grid-based A* maze router for two-layer boards with vias, 45° moves, net-class widths and
// clearances, and rip-up-and-retry passes. No DOM — runs in Node for tests.
(function (root) {
  'use strict';
  const Core = typeof module !== 'undefined' && module.exports ? require('./core.js') : root.PcbCore;
  const BIG = 1e9;
  // 8 directions: E, SE, S, SW, W, NW, N, NE (board y grows downwards)
  const DX = [1, 1, 0, -1, -1, -1, 0, 1], DY = [0, 1, 1, 1, 0, -1, -1, -1];

  // Min-heap of (state, priority) pairs in typed arrays.
  class Heap {
    constructor() { this.s = new Int32Array(1024); this.p = new Float64Array(1024); this.n = 0; }
    push(s, p) {
      if (this.n === this.s.length) { const s2 = new Int32Array(this.n * 2), p2 = new Float64Array(this.n * 2); s2.set(this.s); p2.set(this.p); this.s = s2; this.p = p2; }
      let i = this.n++; while (i > 0) { const j = (i - 1) >> 1; if (this.p[j] <= p) break; this.s[i] = this.s[j]; this.p[i] = this.p[j]; i = j; }
      this.s[i] = s; this.p[i] = p;
    }
    pop() {
      const top = this.s[0], s = this.s[--this.n], p = this.p[this.n]; let i = 0; this.top = this.p[0];
      for (;;) { let c = 2 * i + 1; if (c >= this.n) break; if (c + 1 < this.n && this.p[c + 1] < this.p[c]) c++; if (this.p[c] >= p) break; this.s[i] = this.s[c]; this.p[i] = this.p[c]; i = c; }
      this.s[i] = s; this.p[i] = p; return top;
    }
  }

  // board: the board (not modified); pinNet: Map 'REF.pin' → net.
  // opt: { res: grid mm (0.25), width: default track width, nets: [names] | null (all), layers: ['top','bottom'], vias: true,
  //        viaCost: 10, passes: 3, timeLimit: ms, maxExpand (per connection), greed (heuristic weight) }
  // → { tracks, vias, routed: [lines], failed: [lines], connections, ms, passes }
  function autoroute(board, pinNet, opt = {}) {
    const t0 = Date.now(), R = { edge: 0.3, ...(board.rules || {}) };
    const res = Math.max(0.05, +opt.res || 0.25), nx = Math.floor(board.w / res) + 1, ny = Math.floor(board.h / res) + 1, N = nx * ny;
    if (N > 4e5) throw new Error('Board too large for this grid — use a coarser routing grid.');
    const allowL = [(opt.layers || ['top', 'bottom']).includes('top'), (opt.layers || ['top', 'bottom']).includes('bottom')];
    const useVias = opt.vias !== false && allowL[0] && allowL[1];
    const viaCost = opt.viaCost != null ? +opt.viaCost : 10, maxExpand = opt.maxExpand || 1.2e6, timeLimit = opt.timeLimit || 30000;
    const LI = { top: 0, bottom: 1 }, slack = res * 0.71, HW = opt.greed != null ? +opt.greed : 1.25;   // weighted A*: a little greed, much less searching

    // nets to route and their sizes
    const rn = Core.ratsnest(board, pinNet), want = opt.nets ? new Set(opt.nets) : null;
    const lines = rn.lines.filter(l => !want || want.has(l.net));
    const netIds = new Map(); let nextNull = -2; const idOf = n => { if (!n) return nextNull--; if (!netIds.has(n)) netIds.set(n, netIds.size + 1); return netIds.get(n); };
    const size = net => {
      const c = Core.classOf(board, net), w = c.name === 'Default' ? Math.max(c.width, +opt.width || 0) : c.width;
      return { w, c: c.clearance, viaDia: c.viaDia, viaDrill: c.viaDrill };
    };
    let maxHalf = 0; new Set(lines.map(l => l.net)).forEach(n => { const s = size(n); maxHalf = Math.max(maxHalf, s.w / 2, useVias ? s.viaDia / 2 : 0); });
    const RMAX = maxHalf + Core.maxClearance(board) + 2 * res;

    // per-layer obstacle fields: nearest copper gap (raw and minus that copper's class clearance) for the closest net and for any other net
    const mk = () => [0, 1].map(() => ({ g1: new Float32Array(N).fill(BIG), n1: new Int32Array(N), g2: new Float32Array(N).fill(BIG), a1: new Float32Array(N).fill(BIG), an1: new Int32Array(N), a2: new Float32Array(N).fill(BIG) }));
    const padGap = new Float32Array(N).fill(BIG);   // nearest pad of any net (vias are kept out of pads)
    const ins = (g1, n1, g2, k, g, id) => { if (n1[k] === id) { if (g < g1[k]) g1[k] = g; } else if (g < g1[k]) { g2[k] = Math.min(g2[k], g1[k]); g1[k] = g; n1[k] = id; } else if (g < g2[k]) g2[k] = g; };
    function addShape(F, shape, layers, id, clr, isPad) {
      const b = Core.bbox(shape), i0 = Math.max(0, Math.floor((b[0] - RMAX) / res)), i1 = Math.min(nx - 1, Math.ceil((b[2] + RMAX) / res)), j0 = Math.max(0, Math.floor((b[1] - RMAX) / res)), j1 = Math.min(ny - 1, Math.ceil((b[3] + RMAX) / res));
      const pt = { core: [[0, 0]], r: 0 };
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        pt.core[0][0] = i * res; pt.core[0][1] = j * res; const g = Core.gap(shape, pt); if (g > RMAX) continue; const k = j * nx + i;
        layers.forEach(l => { const f = F[LI[l]]; if (!f) return; ins(f.g1, f.n1, f.g2, k, g, id); ins(f.a1, f.an1, f.a2, k, g - clr, id); });
        if (isPad && g < padGap[k]) padGap[k] = g;
      }
    }
    // initial copper, with nets resolved through islands (tracks drawn without a net take their pads' net)
    const { items, dsu, net: islandNet } = Core.islandNets(board, pinNet);
    const itemNet = items.map((it, i) => { const s = islandNet.get(dsu.find(i)); return it.net || (s && s.size === 1 ? [...s][0] : null); });
    const itemId = items.map((it, i) => idOf(itemNet[i]));
    function freshFields() {
      const F = mk(); padGap.fill(BIG);
      items.forEach((it, i) => addShape(F, it, it.layers, itemId[i], Core.classOf(board, itemNet[i]).clearance, it.kind === 'pad'));
      return F;
    }
    const padIndex = new Map(); items.forEach((it, i) => { if (it.kind === 'pad') padIndex.set(it.ref + '.' + it.n, i); });

    const stamp = new Int32Array(N * 16), gS = new Float32Array(N * 16), par = new Int32Array(N * 16); let run = 0;
    const edgeOK = (k, half) => { const i = k % nx, j = (k - i) / nx, x = i * res, y = j * res; return Math.min(x, y, board.w - x, board.h - y) >= half + R.edge - 1e-9; };

    function runPass(order) {
      const F = freshFields();
      // islands: union-find over initial island roots, with the copper shapes of each group
      const grpParent = new Map(), find = a => { while (grpParent.has(a) && grpParent.get(a) !== a) a = grpParent.get(a); return a; };
      const shapes = new Map(); items.forEach((it, i) => { const r = dsu.find(i); if (!shapes.has(r)) shapes.set(r, []); shapes.get(r).push({ core: it.core, r: it.r, layers: it.layers, anchor: it.kind === 'pad' ? [it.pad.x, it.pad.y] : null }); });
      const outT = [], outV = [], routed = [], failed = [];
      for (const line of order) {
        if (Date.now() - t0 > timeLimit) { failed.push(line); continue; }
        const ia = padIndex.get(line.a), ib = padIndex.get(line.b); if (ia == null || ib == null) { failed.push(line); continue; }
        const ga = find(dsu.find(ia)), gb = find(dsu.find(ib)); if (ga === gb) { routed.push(line); continue; }
        const id = idOf(line.net), sz = size(line.net), hw = sz.w / 2, vr = sz.viaDia / 2;
        // free map for this net: bit0/1 = track may pass on top/bottom, bit2 = a via may sit here
        const free = new Uint8Array(N);
        for (let k = 0; k < N; k++) {
          let m = 0;
          for (let L = 0; L < 2; L++) {
            if (!allowL[L]) continue; const f = F[L];
            const raw = f.n1[k] !== id ? f.g1[k] : f.g2[k], adj = f.an1[k] !== id ? f.a1[k] : f.a2[k];
            if (raw >= hw + sz.c + slack && adj >= hw + slack && edgeOK(k, hw)) m |= 1 << L;
            if (useVias && raw >= vr + sz.c + 1e-6 && adj >= vr + 1e-6 && padGap[k] >= vr + sz.c && edgeOK(k, vr)) m |= 4 << L;  // bits 2,3
          }
          if ((m & 12) !== 12) m &= 3; else m = (m & 3) | 4;
          free[k] = m;
        }
        // source / target points: grid points inside the copper of each group
        const mark = (g, out) => shapes.get(g).forEach(sh => {
          const b = Core.bbox(sh), pt = { core: [[0, 0]], r: 0 };
          for (let j = Math.max(0, Math.ceil(b[1] / res)); j <= Math.min(ny - 1, Math.floor(b[3] / res)); j++) for (let i = Math.max(0, Math.ceil(b[0] / res)); i <= Math.min(nx - 1, Math.floor(b[2] / res)); i++) {
            pt.core[0][0] = i * res; pt.core[0][1] = j * res; if (Core.gap(sh, pt) > 1e-9) continue; const k = j * nx + i;
            sh.layers.forEach(l => { const L = LI[l]; if (L == null || !(free[k] & (1 << L))) return; const d = sh.anchor ? Math.hypot(i * res - sh.anchor[0], j * res - sh.anchor[1]) : 0; const key = L * N + k; if (!out.has(key) || out.get(key).d > d) out.set(key, { d, anchor: sh.anchor }); });
          }
        });
        const src = new Map(), tgt = new Map(); mark(ga, src); mark(gb, tgt);
        if (!src.size || !tgt.size) { failed.push(line); continue; }
        let ti0 = Infinity, ti1 = -Infinity, tj0 = Infinity, tj1 = -Infinity, si0 = Infinity, si1 = -Infinity, sj0 = Infinity, sj1 = -Infinity;
        tgt.forEach((v, key) => { const k = key % N, i = k % nx, j = (k - i) / nx; ti0 = Math.min(ti0, i); ti1 = Math.max(ti1, i); tj0 = Math.min(tj0, j); tj1 = Math.max(tj1, j); });
        src.forEach((v, key) => { const k = key % N, i = k % nx, j = (k - i) / nx; si0 = Math.min(si0, i); si1 = Math.max(si1, i); sj0 = Math.min(sj0, j); sj1 = Math.max(sj1, j); });
        const h = k => { const i = k % nx, j = (k - i) / nx, dx = i < ti0 ? ti0 - i : i > ti1 ? i - ti1 : 0, dy = j < tj0 ? tj0 - j : j > tj1 ? j - tj1 : 0; return HW * (Math.max(dx, dy) + 0.414 * Math.min(dx, dy)); };
        // A* over (layer, point, direction), first inside a window around both ends, then over the whole board
        let hitEdge = false;   // the search was cut short by the window (or the expansion cap), so a bigger search may still succeed
        const search = (wi0, wj0, wi1, wj1) => {
          run++; const heap = new Heap(); let expanded = 0; hitEdge = false;
          src.forEach((v, key) => { const L = (key / N) | 0, k = key % N; for (let d = 0; d < 8; d++) { const s = ((L * N + k) << 3) | d, g0 = v.d / res; stamp[s] = run; gS[s] = g0; par[s] = -1; heap.push(s, g0 + h(k)); } });
          while (heap.n) {
            const s = heap.pop(), d = s & 7, LK = s >> 3, L = LK >= N ? 1 : 0, k = LK - L * N, g = gS[s];
            if (heap.top > g + h(k) + 1e-6) continue;          // stale entry, a cheaper way here was found later
            if (++expanded > maxExpand) { hitEdge = true; return -1; }
            if (tgt.has(LK)) return s;
            const i = k % nx, j = (k - i) / nx;
            for (let nd = 0; nd < 8; nd++) {
              const turn = Math.min((nd - d + 8) & 7, (d - nd + 8) & 7); if (turn > 2) continue;
              const i2 = i + DX[nd], j2 = j + DY[nd]; if (i2 < wi0 || j2 < wj0 || i2 > wi1 || j2 > wj1) { hitEdge = true; continue; }
              const k2 = j2 * nx + i2; if (!(free[k2] & (1 << L))) continue;
              const orth = !(nd & 1), along = L === 0 ? (nd === 0 || nd === 4) : (nd === 2 || nd === 6);
              const c = g + (orth ? (along ? 1 : 1.6) : 1.414 * 1.12) + (turn === 1 ? 0.5 : turn === 2 ? 1.6 : 0);
              const s2 = (((L * N + k2) << 3) | nd); if (stamp[s2] === run && gS[s2] <= c) continue;
              stamp[s2] = run; gS[s2] = c; par[s2] = s; heap.push(s2, c + h(k2));
            }
            if ((free[k] & 4)) {   // via: switch layer in place
              const s2 = ((((1 - L) * N + k) << 3) | d), c = g + viaCost; if (!(stamp[s2] === run && gS[s2] <= c)) { stamp[s2] = run; gS[s2] = c; par[s2] = s; heap.push(s2, c + h(k)); }
            }
          }
          return -1;
        };
        const mg = Math.max(Math.round(6 / res), Math.round(0.25 * Math.max(Math.max(ti1, si1) - Math.min(ti0, si0), Math.max(tj1, sj1) - Math.min(tj0, sj0))));
        const W = [Math.max(0, Math.min(ti0, si0) - mg), Math.max(0, Math.min(tj0, sj0) - mg), Math.min(nx - 1, Math.max(ti1, si1) + mg), Math.min(ny - 1, Math.max(tj1, sj1) + mg)];
        const tq = Date.now(); let goal = search(...W); const dbg1 = Date.now() - tq;
        if (goal < 0 && hitEdge && (W[0] > 0 || W[1] > 0 || W[2] < nx - 1 || W[3] < ny - 1)) goal = search(0, 0, nx - 1, ny - 1);
        if (opt.debug) opt.debug(`${line.net} ${line.a}-${line.b} d=${line.d.toFixed(1)} win=${dbg1}ms total=${Date.now() - tq}ms ${goal < 0 ? 'FAIL' : 'ok'} src=${src.size} tgt=${tgt.size}`);
        if (goal < 0) { failed.push(line); continue; }
        // path → points (layer, x, y)
        const path = []; for (let s = goal; s >= 0; s = par[s]) { const LK = s >> 3, L = LK >= N ? 1 : 0, k = LK - L * N, i = k % nx; path.push([L, i * res, ((k - i) / nx) * res]); }
        path.reverse();
        const sA = src.get(path[0][0] * N + Math.round(path[0][2] / res) * nx + Math.round(path[0][1] / res)), tA = tgt.get(path[path.length - 1][0] * N + Math.round(path[path.length - 1][2] / res) * nx + Math.round(path[path.length - 1][1] / res));
        const near = (v, p) => v && v.anchor && v.d > 1e-6 && v.d <= res * 0.75;   // tiny jog onto the pad centre
        if (near(sA)) path.unshift([path[0][0], sA.anchor[0], sA.anchor[1]]);
        if (near(tA)) path.push([path[path.length - 1][0], tA.anchor[0], tA.anchor[1]]);
        const newT = [], newV = []; let cur = null;
        path.forEach(([L, x, y], idx) => {
          x = +x.toFixed(4); y = +y.toFixed(4);
          if (cur && cur.L !== L) { newV.push({ x, y, dia: sz.viaDia, drill: sz.viaDrill, net: line.net, auto: true }); if (cur.pts.length > 1) newT.push(cur); cur = null; }
          if (!cur) cur = { L, pts: [] };
          const P = cur.pts, n = P.length;
          if (n >= 2) { const ax = P[n - 1][0] - P[n - 2][0], ay = P[n - 1][1] - P[n - 2][1], bx = x - P[n - 1][0], by = y - P[n - 1][1]; if (Math.abs(ax * by - ay * bx) < 1e-9 && ax * bx + ay * by > 0) { P[n - 1] = [x, y]; return; } }
          if (n && P[n - 1][0] === x && P[n - 1][1] === y) return;
          P.push([x, y]);
        });
        if (cur && cur.pts.length > 1) newT.push(cur);
        const tracks = newT.map(t => ({ layer: t.L ? 'bottom' : 'top', w: sz.w, net: line.net, pts: t.pts, auto: true }));
        // the new copper becomes an obstacle for other nets and part of this group
        const grpShapes = shapes.get(ga);
        tracks.forEach(t => { for (let q = 1; q < t.pts.length; q++) { const sh = { core: [t.pts[q - 1], t.pts[q]], r: t.w / 2, layers: [t.layer], anchor: null }; addShape(F, sh, sh.layers, id, sz.c, false); grpShapes.push(sh); } });
        newV.forEach(v => { const sh = { core: [[v.x, v.y]], r: v.dia / 2, layers: ['top', 'bottom'], anchor: null }; addShape(F, sh, sh.layers, id, sz.c, false); grpShapes.push(sh); });
        shapes.get(gb).forEach(sh => grpShapes.push(sh)); grpParent.set(gb, ga);
        outT.push(...tracks); outV.push(...newV); routed.push(line);
      }
      return { tracks: outT, vias: outV, routed, failed };
    }

    // pass 1: shortest connections first; later passes put the failures first (rip up everything and retry)
    let order = lines.slice().sort((a, b) => a.d - b.d), best = null, passes = 0;
    const len = r => r.tracks.reduce((s, t) => s + t.pts.reduce((a, p, i) => i ? a + Math.hypot(p[0] - t.pts[i - 1][0], p[1] - t.pts[i - 1][1]) : 0, 0), 0) + r.vias.length * viaCost * res;
    for (let p = 0; p < Math.max(1, opt.passes || 3); p++) {
      const r = runPass(order); passes++;
      if (!best || r.failed.length < best.failed.length || (r.failed.length === best.failed.length && len(r) < len(best))) best = r;
      if (!r.failed.length || Date.now() - t0 > timeLimit) break;
      const fs = new Set(r.failed); order = [...r.failed, ...order.filter(l => !fs.has(l))];
    }
    return { tracks: best.tracks, vias: best.vias, routed: best.routed, failed: best.failed, connections: lines.length, passes, ms: Date.now() - t0 };
  }

  // remove tracks and vias (all, or only of the given nets / only auto-routed ones)
  function unroute(board, { nets = null, autoOnly = false } = {}) {
    const hit = x => (!nets || nets.includes(x.net)) && (!autoOnly || x.auto);
    const before = (board.tracks || []).length + (board.vias || []).length;
    board.tracks = (board.tracks || []).filter(t => !hit(t)); board.vias = (board.vias || []).filter(v => !hit(v));
    return before - board.tracks.length - board.vias.length;
  }

  const api = { autoroute, unroute };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PcbRoute = api;
})(typeof self !== 'undefined' ? self : this);
