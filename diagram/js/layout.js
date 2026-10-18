'use strict';
/* Lumen Diagram — automatic layout.
   tree(): tidy tree for org charts (parents centred over children, subtrees packed by contour).
   layered(): Sugiyama-style hierarchical layout for flowcharts (cycle breaking, longest-path layering,
   dummy nodes for long edges, barycentre crossing reduction, priority-based coordinate assignment).
   Both work on the shapes connected by edges (optionally only the selected ones) and move shapes in place. */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const M = isNode ? require('./model.js') : root.DiaModel;
  const S = isNode ? require('./shapes.js') : root.DiaShapes;

  function graphOf(page, ids) {
    const byId = M.index(page);
    const movable = c => c && c.kind === 'shape' && !S.get(c.shape).container && !(c.parent && byId.get(c.parent) && byId.get(c.parent).kind === 'group');
    const nodes = page.cells.filter(c => movable(c) && (!ids || ids.has(c.id)));
    const set = new Set(nodes.map(n => n.id));
    const edges = [];
    for (const e of page.cells) if (e.kind === 'edge' && e.src && e.tgt && set.has(e.src.id) && set.has(e.tgt.id) && e.src.id !== e.tgt.id) edges.push({ s: e.src.id, t: e.tgt.id, e });
    return { nodes, edges, byId };
  }
  const horizontal = dir => dir === 'LR' || dir === 'RL';

  /* ---------- tidy tree ---------- */
  function tree(page, o = {}) {
    const dir = o.dir || 'TB', gx = o.gapX ?? 30, gy = o.gapY ?? 60;
    const { nodes, edges } = graphOf(page, o.ids);
    if (!nodes.length) return 0;
    const H = horizontal(dir);
    const size = n => H ? { a: n.h, b: n.w } : { a: n.w, b: n.h };   // a = breadth, b = depth
    const kids = new Map(nodes.map(n => [n.id, []])), hasParent = new Set();
    for (const { s, t } of edges) if (!hasParent.has(t) && s !== t) { kids.get(s).push(t); hasParent.add(t); }
    const byId = new Map(nodes.map(n => [n.id, n]));
    // keep existing left-to-right order of children
    for (const [k, v] of kids) v.sort((p, q) => H ? byId.get(p).y - byId.get(q).y : byId.get(p).x - byId.get(q).x);
    let roots = nodes.filter(n => !hasParent.has(n.id)).sort((p, q) => H ? p.y - q.y : p.x - q.x);
    // cycles without a root: pick the first node
    const seen = new Set();
    const pos = new Map();     // id → {a (breadth centre), depth}
    const depthSize = [];
    // contour-based layout: returns contour [{lo, hi}] per depth level relative to subtree root centre 0
    function lay(id, depth) {
      seen.add(id); const n = byId.get(id), sz = size(n);
      depthSize[depth] = Math.max(depthSize[depth] || 0, sz.b);
      const ch = kids.get(id).filter(k => !seen.has(k));
      ch.forEach(k => seen.add(k));
      const subs = ch.map(k => ({ id: k, c: lay(k, depth + 1), off: 0 }));
      // place subtrees left to right with contours not overlapping
      let acc = null;
      for (const sb of subs) {
        if (!acc) { sb.off = 0; acc = sb.c.map(x => ({ ...x })); continue; }
        let shift = -Infinity;
        for (let i = 0; i < Math.min(acc.length, sb.c.length); i++) shift = Math.max(shift, acc[i].hi - sb.c[i].lo + gx);
        sb.off = shift;
        for (let i = 0; i < sb.c.length; i++) { const r = { lo: sb.c[i].lo + shift, hi: sb.c[i].hi + shift }; if (i < acc.length) { acc[i].lo = Math.min(acc[i].lo, r.lo); acc[i].hi = Math.max(acc[i].hi, r.hi); } else acc.push(r); }
      }
      let mid = 0;
      if (subs.length) { mid = (subs[0].off + subs[subs.length - 1].off) / 2; subs.forEach(sb => sb.off -= mid); if (acc) acc.forEach(r => { r.lo -= mid; r.hi -= mid; }); }
      pos.set(id, { subs, depth });
      return [{ lo: -sz.a / 2, hi: sz.a / 2 }, ...(acc || [])];
    }
    const forest = [];
    for (const r of roots) if (!seen.has(r.id)) forest.push({ id: r.id, c: lay(r.id, 0) });
    for (const n of nodes) if (!seen.has(n.id)) forest.push({ id: n.id, c: lay(n.id, 0) });
    // depth offsets
    const depthPos = []; let acc = 0; for (let i = 0; i < depthSize.length; i++) { depthPos[i] = acc; acc += (depthSize[i] || 0) + gy; }
    // place forest trees side by side
    const ox = o.x ?? Math.min(...nodes.map(n => H ? n.x : n.x)), oy = o.y ?? Math.min(...nodes.map(n => n.y));
    let cursor = 0, moved = 0;
    const place = (id, centre) => {
      const n = byId.get(id), p = pos.get(id), sz = size(n);
      const b = depthPos[p.depth] + ((depthSize[p.depth] || 0) - sz.b) / 2;
      if (H) { n.x = Math.round(ox + b); n.y = Math.round(oy + centre - sz.a / 2); }
      else { n.x = Math.round(ox + centre - sz.a / 2); n.y = Math.round(oy + b); }
      moved++;
      for (const sb of p.subs) place(sb.id, centre + sb.off);
    };
    for (const t of forest) { const lo = Math.min(...t.c.map(r => r.lo)), hi = Math.max(...t.c.map(r => r.hi)); place(t.id, cursor - lo); cursor += hi - lo + gx * 2; }
    if (dir === 'BT' || dir === 'RL') { const span = acc - gy; for (const n of nodes) { if (dir === 'BT') n.y = Math.round(2 * oy + span - n.y - n.h); else n.x = Math.round(2 * ox + span - n.x - n.w); } }
    resetEdges(edges, H ? 'LR' : 'TB', o.edgeRoute);
    return moved;
  }

  /* ---------- layered (Sugiyama) ---------- */
  function layered(page, o = {}) {
    const dir = o.dir || 'TB', gx = o.gapX ?? 40, gy = o.gapY ?? 60;
    const { nodes, edges } = graphOf(page, o.ids);
    if (!nodes.length) return 0;
    const H = horizontal(dir);
    const id2i = new Map(nodes.map((n, i) => [n.id, i])), N = nodes.length;
    const out = Array.from({ length: N }, () => []);
    const E = edges.map(({ s, t }) => [id2i.get(s), id2i.get(t)]);
    // 1. break cycles (DFS back edges reversed), ordering roots by current position
    const orderIdx = [...nodes.keys()].sort((a, b) => (H ? nodes[a].x - nodes[b].x : nodes[a].y - nodes[b].y) || (H ? nodes[a].y - nodes[b].y : nodes[a].x - nodes[b].x));
    E.forEach(([s, t], k) => out[s].push(k));
    const state = new Uint8Array(N), rev = new Set();
    const indeg0 = new Array(N).fill(0); E.forEach(([s, t]) => indeg0[t]++);
    const starts = [...orderIdx.filter(i => !indeg0[i]), ...orderIdx];
    for (const s0 of starts) {
      if (state[s0]) continue;
      const stack = [[s0, 0]]; state[s0] = 1;
      while (stack.length) {
        const top = stack[stack.length - 1], [v, k] = top;
        if (k >= out[v].length) { state[v] = 2; stack.pop(); continue; }
        top[1]++; const ei = out[v][k], w = E[ei][1];
        if (state[w] === 1) rev.add(ei); else if (!state[w]) { state[w] = 1; stack.push([w, 0]); }
      }
    }
    const DE = E.map(([s, t], k) => rev.has(k) ? [t, s] : [s, t]).filter(([s, t]) => s !== t);
    // 2. longest-path layering
    const layer = new Array(N).fill(0), indeg = new Array(N).fill(0), succ = Array.from({ length: N }, () => []), pred = Array.from({ length: N }, () => []);
    DE.forEach(([s, t]) => { indeg[t]++; succ[s].push(t); pred[t].push(s); });
    const q = orderIdx.filter(i => !indeg[i]); const deg = indeg.slice();
    while (q.length) { const v = q.shift(); for (const w of succ[v]) { layer[w] = Math.max(layer[w], layer[v] + 1); if (--deg[w] === 0) q.push(w); } }
    // pull sources down next to their successors (shorter edges)
    for (let i = 0; i < N; i++) if (!pred[i].length && succ[i].length) layer[i] = Math.max(layer[i], Math.min(...succ[i].map(w => layer[w])) - 1);
    // 3. dummy nodes
    const V = nodes.map((n, i) => ({ i, w: H ? n.h : n.w, h: H ? n.w : n.h, layer: layer[i], dummy: false }));
    const adjDown = [], adjUp = [];
    const link = (a, b) => { (adjDown[a] = adjDown[a] || []).push(b); (adjUp[b] = adjUp[b] || []).push(a); };
    for (const [s, t] of DE) {
      let prev = s;
      for (let L = layer[s] + 1; L < layer[t]; L++) { const d = V.length; V.push({ i: -1, w: 8, h: 0, layer: L, dummy: true }); link(prev, d); prev = d; }
      link(prev, t);
    }
    const nL = Math.max(...V.map(v => v.layer)) + 1;
    const layers = Array.from({ length: nL }, () => []);
    // initial order: current position
    V.forEach((v, k) => layers[v.layer].push(k));
    const coordOf = k => V[k].dummy ? 0 : (H ? nodes[V[k].i].y : nodes[V[k].i].x);
    layers.forEach(L => L.sort((a, b) => coordOf(a) - coordOf(b)));
    // 4. crossing reduction (barycentre, alternating sweeps, keep best)
    const posIn = new Array(V.length);
    const setPos = () => layers.forEach(L => L.forEach((k, i) => posIn[k] = i));
    const crossings = () => {
      let c = 0;
      for (let l = 0; l + 1 < nL; l++) {
        const es = []; for (const a of layers[l]) for (const b of adjDown[a] || []) es.push([posIn[a], posIn[b]]);
        es.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
        for (let i = 0; i < es.length; i++) for (let j = i + 1; j < es.length; j++) if (es[i][0] < es[j][0] && es[i][1] > es[j][1]) c++;
      }
      return c;
    };
    setPos(); let best = layers.map(L => L.slice()), bestC = crossings();
    for (let it = 0; it < 12 && bestC > 0; it++) {
      const down = it % 2 === 0;
      for (let li = down ? 1 : nL - 2; down ? li < nL : li >= 0; li += down ? 1 : -1) {
        const L = layers[li], nb = down ? adjUp : adjDown;
        const bc = new Map(L.map(k => { const ns = nb[k] || []; return [k, ns.length ? ns.reduce((s, x) => s + posIn[x], 0) / ns.length : posIn[k]]; }));
        L.sort((a, b) => bc.get(a) - bc.get(b)); L.forEach((k, i) => posIn[k] = i);
      }
      const c = crossings(); if (c < bestC) { bestC = c; best = layers.map(L => L.slice()); }
    }
    best.forEach((L, i) => layers[i] = L); setPos();
    // 5. coordinates: initial packing, then pull toward neighbour medians keeping order and spacing
    const x = new Array(V.length).fill(0);
    layers.forEach(L => { let c = 0; L.forEach(k => { x[k] = c + V[k].w / 2; c += V[k].w + gx; }); const w = c - gx; L.forEach(k => x[k] -= w / 2); });
    const sep = (a, b) => (V[a].w + V[b].w) / 2 + (V[a].dummy && V[b].dummy ? 10 : V[a].dummy || V[b].dummy ? gx / 2 : gx);
    for (let it = 0; it < 24; it++) {
      const down = it % 2 === 0;
      for (let li = down ? 0 : nL - 1; down ? li < nL : li >= 0; li += down ? 1 : -1) {
        const L = layers[li];
        const want = L.map(k => { const ns = [...(adjUp[k] || []), ...(adjDown[k] || [])]; if (!ns.length) return x[k]; const xs = ns.map(n => x[n]).sort((a, b) => a - b); const m = xs.length >> 1; return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2; });
        // priority: dummies and high degree first
        const pri = L.map((k, i) => ({ i, p: (V[k].dummy ? 1000 : 0) + ((adjUp[k] || []).length + (adjDown[k] || []).length) })).sort((a, b) => b.p - a.p);
        const placed = new Array(L.length).fill(false);
        for (const { i } of pri) {
          let v = want[i];
          // limits from already placed neighbours in the layer
          for (let j = i - 1; j >= 0; j--) if (placed[j]) { let need = x[L[j]]; for (let k = j; k < i; k++) need += sep(L[k], L[k + 1]); v = Math.max(v, need); break; }
          for (let j = i + 1; j < L.length; j++) if (placed[j]) { let need = x[L[j]]; for (let k = j; k > i; k--) need -= sep(L[k - 1], L[k]); v = Math.min(v, need); break; }
          x[L[i]] = v; placed[i] = true;
        }
        // final left-to-right spacing fix
        for (let i = 1; i < L.length; i++) { const need = x[L[i - 1]] + sep(L[i - 1], L[i]); if (x[L[i]] < need) x[L[i]] = need; }
      }
    }
    // layer depths
    const lh = layers.map(L => Math.max(0, ...L.map(k => V[k].h)));
    const ly = []; let acc = 0; for (let i = 0; i < nL; i++) { ly[i] = acc; acc += lh[i] + gy; }
    const minX = Math.min(...V.map((v, k) => x[k] - v.w / 2));
    const ox = o.x ?? Math.min(...nodes.map(n => n.x)), oy = o.y ?? Math.min(...nodes.map(n => n.y));
    V.forEach((v, k) => {
      if (v.dummy) return; const n = nodes[v.i];
      const a = x[k] - minX - v.w / 2, b = ly[v.layer] + (lh[v.layer] - v.h) / 2;
      if (H) { n.x = Math.round(ox + b); n.y = Math.round(oy + a); } else { n.x = Math.round(ox + a); n.y = Math.round(oy + b); }
    });
    if (dir === 'BT' || dir === 'RL') { const span = acc - gy; for (const n of nodes) { if (dir === 'BT') n.y = Math.round(2 * oy + span - n.y - n.h); else n.x = Math.round(2 * ox + span - n.x - n.w); } }
    resetEdges(edges, H ? 'LR' : 'TB', o.edgeRoute);
    return nodes.length;
  }
  // after a layout, manual waypoints and fixed ports no longer make sense
  function resetEdges(edges, flow, route) {
    for (const { e } of edges) {
      e.pts = [];
      if (e.src && e.src.port) e.src.port = null; if (e.tgt && e.tgt.port) e.tgt.port = null;
      if (route) e.style.route = route;
    }
  }
  // count edge crossings between straight centre-to-centre segments (test helper / quality metric)
  function crossingCount(page) {
    const byId = M.index(page), segs = [];
    for (const e of page.cells) if (e.kind === 'edge' && e.src.id && e.tgt.id) { const a = byId.get(e.src.id), b = byId.get(e.tgt.id); if (a && b) segs.push([M.center(a), M.center(b), e.src.id, e.tgt.id]); }
    const X = (p, q, r, s) => { const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x); if (!d) return false; const t = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d, u = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d; return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999; };
    let c = 0; for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) { const [a, b, s1, t1] = segs[i], [p, q, s2, t2] = segs[j]; if (s1 === s2 || s1 === t2 || t1 === s2 || t1 === t2) continue; if (X(a, b, p, q)) c++; }
    return c;
  }

  const api = { tree, layered, crossingCount, graphOf };
  if (isNode) module.exports = api; else root.DiaLayout = api;
})(typeof self !== 'undefined' ? self : this);
