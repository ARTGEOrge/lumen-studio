// Lumen PCB engine: schematic netlist, footprint geometry, copper connectivity, ratsnest, DRC,
// Gerber RS-274X / Excellon export and a store-only ZIP writer. No DOM — runs in Node for tests.
(function (root) {
  'use strict';
  const LIB = typeof module !== 'undefined' && module.exports ? require('./lib.js') : root.PcbLib;

  // ---------- schematic geometry ----------
  // rot = quarter turns clockwise (0..3), mirror flips x before rotating
  function xform(p, x, y) {
    if (p.mirror) x = -x;
    for (let k = 0; k < ((p.rot || 0) % 4 + 4) % 4; k++) [x, y] = [-y, x];
    return [p.x + x, p.y + y];
  }
  function pinsOf(part) {
    const def = LIB.PART[part.lib]; if (!def) return [];
    return def.sym.pins.map(pin => { const [x, y] = xform(part, pin.x, pin.y); return { ref: part.ref, n: pin.n, name: pin.name, x, y }; });
  }
  const key = (x, y) => Math.round(x * 1000) + ',' + Math.round(y * 1000);
  const onSeg = (px, py, ax, ay, bx, by) => {
    const cross = (bx - ax) * (py - ay) - (by - ay) * (px - ax); if (Math.abs(cross) > 1e-6) return false;
    return px >= Math.min(ax, bx) - 1e-6 && px <= Math.max(ax, bx) + 1e-6 && py >= Math.min(ay, by) - 1e-6 && py <= Math.max(ay, by) + 1e-6;
  };
  class DSU { constructor() { this.p = new Map(); } find(a) { if (!this.p.has(a)) this.p.set(a, a); let r = a; while (this.p.get(r) !== r) r = this.p.get(r); while (this.p.get(a) !== r) { const n = this.p.get(a); this.p.set(a, r); a = n; } return r; } union(a, b) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); } }

  // sch = { parts:[{ref,lib,value,fp,x,y,rot,mirror}], wires:[{pts:[[x,y],…]}], labels:[{x,y,name}] }
  function netlist(sch) {
    const dsu = new DSU(), names = new Map(), pins = [];
    const segs = [];
    (sch.wires || []).forEach(w => { for (let i = 1; i < w.pts.length; i++) { const [a, b] = [w.pts[i - 1], w.pts[i]]; segs.push([a, b]); dsu.union(key(...a), key(...b)); } });
    const attach = (x, y, id) => { dsu.union(id, key(x, y)); segs.forEach(([a, b]) => { if (onSeg(x, y, a[0], a[1], b[0], b[1])) dsu.union(key(x, y), key(...a)); }); };
    // wire ends landing on the middle of another wire make a junction
    (sch.wires || []).forEach(w => [w.pts[0], w.pts[w.pts.length - 1]].forEach(p => attach(p[0], p[1], key(...p))));
    (sch.parts || []).forEach(part => {
      const def = LIB.PART[part.lib]; if (!def) return;
      pinsOf(part).forEach(pin => {
        const id = 'pin:' + pin.ref + '.' + pin.n; attach(pin.x, pin.y, id);
        if (!def.power) pins.push({ ...pin, id, ref: part.ref }); else { const r = 'name:' + part.value; dsu.union(id, r); names.set(r, part.value); }
      });
    });
    (sch.labels || []).forEach(l => { const r = 'name:' + l.name; attach(l.x, l.y, r); names.set(r, l.name); });
    // pins of the same part sitting on top of each other are not joined unless wired — ok
    const groups = new Map();
    pins.forEach(p => { const r = dsu.find(p.id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
    const nameOf = new Map(); names.forEach((n, id) => { const r = dsu.find(id); if (!nameOf.has(r) || n < nameOf.get(r)) nameOf.set(r, n); });
    let k = 1; const nets = [], pinNet = new Map(), unconnected = [];
    [...groups.entries()].sort((a, b) => (a[1][0].ref + a[1][0].n).localeCompare(b[1][0].ref + b[1][0].n, undefined, { numeric: true })).forEach(([r, list]) => {
      const named = nameOf.get(r);
      if (list.length === 1 && !named) { unconnected.push(list[0]); return; }
      const name = named || 'N$' + k++;
      nets.push({ name, nodes: list.map(p => ({ ref: p.ref, pin: p.n })) });
      list.forEach(p => pinNet.set(p.ref + '.' + p.n, name));
    });
    // merge nets with the same name (different groups that share a label name are already unioned; this is for safety)
    return { nets, pinNet, unconnected };
  }

  function annotate(sch) {
    const used = new Map();
    sch.parts.forEach(p => { const m = /^([A-Z#]+[A-Z]*)(\d+)$/.exec(p.ref || ''); if (m) { if (!used.has(m[1])) used.set(m[1], new Set()); used.get(m[1]).add(+m[2]); } });
    sch.parts.forEach(p => { if (p.ref && !/\?$/.test(p.ref)) return; const pre = LIB.PART[p.lib].prefix; if (!used.has(pre)) used.set(pre, new Set()); const s = used.get(pre); let n = 1; while (s.has(n)) n++; s.add(n); p.ref = pre + n; });
    return sch;
  }

  function erc(sch, nl) {
    const out = [];
    nl.unconnected.forEach(p => { const def = LIB.PART[(sch.parts.find(x => x.ref === p.ref) || {}).lib]; if (def && def.sym.nopin) return; out.push({ type: 'Unconnected pin', msg: `${p.ref} pin ${p.n}${p.name ? ' (' + p.name + ')' : ''} is not connected`, x: p.x, y: p.y }); });
    const refs = new Map(); sch.parts.forEach(p => { if (LIB.PART[p.lib].power) return; refs.set(p.ref, (refs.get(p.ref) || 0) + 1); });
    refs.forEach((n, r) => n > 1 && out.push({ type: 'Duplicate reference', msg: `${r} is used ${n} times`, ref: r }));
    sch.parts.forEach(p => { const d = LIB.PART[p.lib]; if (!d.power && d.fps && !p.fp) out.push({ type: 'No footprint', msg: `${p.ref} has no footprint`, ref: p.ref }); });
    return out;
  }

  // ---------- board geometry ----------
  const rot2 = (x, y, deg) => { const r = deg * Math.PI / 180, c = Math.round(Math.cos(r) * 1e9) / 1e9, s = Math.round(Math.sin(r) * 1e9) / 1e9; return [x * c - y * s, x * s + y * c]; };
  // board = { w, h, parts:[{ref,fp,x,y,rot,side}], tracks:[{layer,w,pts,net}], vias:[{x,y,dia,drill,net}], rules:{clearance,track,via,drill} }
  function padsOf(fpPart) {
    const fp = LIB.FP[fpPart.fp]; if (!fp) return [];
    const bottom = fpPart.side === 'bottom';
    return fp.pads.map(p => {
      let [x, y] = rot2(bottom ? -p.x : p.x, p.y, fpPart.rot || 0);
      const quarter = Math.round(((fpPart.rot || 0) % 180 + 180) % 180) === 90;
      return { ref: fpPart.ref, n: p.n, x: fpPart.x + x, y: fpPart.y + y, w: quarter ? p.h : p.w, h: quarter ? p.w : p.h, shape: p.shape, drill: p.drill || 0,
        layers: p.drill ? ['top', 'bottom'] : [bottom ? 'bottom' : 'top'] };
    });
  }
  function silkOf(fpPart) {
    const fp = LIB.FP[fpPart.fp]; if (!fp) return [];
    const T = (x, y) => { const [a, b] = rot2(fpPart.side === 'bottom' ? -x : x, y, fpPart.rot || 0); return [fpPart.x + a, fpPart.y + b]; };
    const out = [];
    fp.silk.forEach(s => {
      if (s[0] === 'line') out.push([T(s[1], s[2]), T(s[3], s[4])]);
      else if (s[0] === 'rect') { const c = [T(s[1], s[2]), T(s[3], s[2]), T(s[3], s[4]), T(s[1], s[4])]; for (let i = 0; i < 4; i++) out.push([c[i], c[(i + 1) % 4]]); }
      else if (s[0] === 'circle' || s[0] === 'arc') { const n = 24, a0 = s[0] === 'arc' ? 0 : 0, a1 = s[0] === 'arc' ? Math.PI : 2 * Math.PI; for (let i = 0; i < n; i++) { const t0 = a0 + (a1 - a0) * i / n, t1 = a0 + (a1 - a0) * (i + 1) / n; out.push([T(s[1] + s[3] * Math.cos(t0), s[2] + s[3] * Math.sin(t0)), T(s[1] + s[3] * Math.cos(t1), s[2] + s[3] * Math.sin(t1))]); } }
    });
    return out;
  }

  // copper as "convex core + radius" shapes, so one distance function covers pads, tracks and vias
  function padShape(p) {
    if (p.shape === 'round') return { core: [[p.x, p.y]], r: p.w / 2 };
    if (p.shape === 'oval') { const r = Math.min(p.w, p.h) / 2, dx = p.w / 2 - r, dy = p.h / 2 - r; return { core: [[p.x - dx, p.y - dy], [p.x + dx, p.y + dy]], r }; }
    return { core: [[p.x - p.w / 2, p.y - p.h / 2], [p.x + p.w / 2, p.y - p.h / 2], [p.x + p.w / 2, p.y + p.h / 2], [p.x - p.w / 2, p.y + p.h / 2]], r: 0 };
  }
  function copper(board, pinNet) {
    const items = [];
    (board.parts || []).forEach(fp => padsOf(fp).forEach(p => { const s = padShape(p); items.push({ kind: 'pad', ref: p.ref, n: p.n, net: pinNet ? pinNet.get(p.ref + '.' + p.n) || null : null, layers: p.layers, ...s, pad: p }); }));
    (board.tracks || []).forEach((t, ti) => { for (let i = 1; i < t.pts.length; i++) items.push({ kind: 'track', ti, seg: i, net: t.net || null, layers: [t.layer], core: [t.pts[i - 1], t.pts[i]], r: t.w / 2 }); });
    (board.vias || []).forEach((v, vi) => items.push({ kind: 'via', vi, net: v.net || null, layers: ['top', 'bottom'], core: [[v.x, v.y]], r: v.dia / 2, drill: v.drill }));
    return items;
  }

  // distance between convex polygons (1, 2 or n points); 0 when they overlap
  const dPS = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); };
  const orient = (a, b, c) => Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  const segX = (a, b, c, d) => orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0;
  const dSS = (a, b, c, d) => segX(a, b, c, d) ? 0 : Math.min(dPS(a, c, d), dPS(b, c, d), dPS(c, a, b), dPS(d, a, b));
  const inside = (p, poly) => { if (poly.length < 3) return false; let s = 0; for (let i = 0; i < poly.length; i++) { const o = orient(poly[i], poly[(i + 1) % poly.length], p); if (o === 0) continue; if (s === 0) s = o; else if (o !== s) return false; } return true; };
  const edges = P => P.length === 1 ? [[P[0], P[0]]] : P.length === 2 ? [[P[0], P[1]]] : P.map((p, i) => [p, P[(i + 1) % P.length]]);
  function coreDist(A, B) {
    if (A.some(p => inside(p, B)) || B.some(p => inside(p, A))) return 0;
    let m = Infinity; for (const [a, b] of edges(A)) for (const [c, d] of edges(B)) m = Math.min(m, dSS(a, b, c, d)); return m;
  }
  const gap = (a, b) => coreDist(a.core, b.core) - a.r - b.r;
  const shareLayer = (a, b) => a.layers.some(l => b.layers.includes(l));
  const bbox = it => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; it.core.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }); return [x0 - it.r, y0 - it.r, x1 + it.r, y1 + it.r]; };


  // ---------- copper pours (zones) ----------
  // zone = { net, layer, clearance } fills the whole board (minus the edge clearance) on one layer, keeps `clearance`
  // from copper of every other net, joins same-net copper solidly, and drops islands that touch none of its net.
  const fillCache = new Map();
  function fillZone(board, zone, pinNet, res = 0.1) {
    const key = JSON.stringify([board.w, board.h, board.parts, board.tracks, board.vias, board.rules && board.rules.edge, zone, res]) + (pinNet ? [...pinNet].join() : '');
    if (fillCache.has(key)) return fillCache.get(key);
    const nx = Math.ceil(board.w / res), ny = Math.ceil(board.h / res), grid = new Int32Array(nx * ny);   // 0 empty, -1 blocked, >0 island id
    const edge = Math.max(zone.clearance, (board.rules && board.rules.edge) || 0.3), cl = zone.clearance + res * 0.71;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const x = (i + 0.5) * res, y = (j + 0.5) * res; if (x < edge || y < edge || x > board.w - edge || y > board.h - edge) grid[j * nx + i] = -1; }
    const items = copper(board, pinNet).filter(it => it.layers.includes(zone.layer)), seeds = [];
    items.forEach(it => {
      const same = it.net === zone.net, b = bbox(it), m = same ? 0 : cl;
      const i0 = Math.max(0, Math.floor((b[0] - m) / res)), i1 = Math.min(nx - 1, Math.ceil((b[2] + m) / res)), j0 = Math.max(0, Math.floor((b[1] - m) / res)), j1 = Math.min(ny - 1, Math.ceil((b[3] + m) / res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * nx + i; if (grid[k] === -1) continue;
        const g = gap(it, { core: [[(i + 0.5) * res, (j + 0.5) * res]], r: 0 });
        if (!same && g < cl) grid[k] = -1; else if (same && g <= 0) seeds.push(k);
      }
    });
    // flood fill from same-net copper; everything else is an isolated island and is removed
    let id = 0; const isl = [];
    seeds.forEach(k0 => { if (grid[k0] !== 0) return; id++; let n = 0; const st = [k0]; grid[k0] = id;
      while (st.length) { const k = st.pop(); n++; const i = k % nx, j = (k - i) / nx; if (i > 0 && !grid[k - 1]) { grid[k - 1] = id; st.push(k - 1); } if (i < nx - 1 && !grid[k + 1]) { grid[k + 1] = id; st.push(k + 1); } if (j > 0 && !grid[k - nx]) { grid[k - nx] = id; st.push(k - nx); } if (j < ny - 1 && !grid[k + nx]) { grid[k + nx] = id; st.push(k + nx); } }
      isl.push(n); });
    const out = { res, nx, ny, grid, islands: id, area: isl.reduce((a, b) => a + b, 0) * res * res, zone };
    if (fillCache.size > 20) fillCache.clear(); fillCache.set(key, out); return out;
  }
  // filled area as rectangles (row runs merged downwards) — used for drawing and Gerber regions
  function zoneRects(f) {
    const { nx, ny, grid, res } = f, open = new Map(), out = [];
    for (let j = 0; j <= ny; j++) {
      const runs = new Map(); if (j < ny) { let i = 0; while (i < nx) { if (grid[j * nx + i] > 0) { const a = i; while (i < nx && grid[j * nx + i] > 0) i++; runs.set(a + ':' + i, [a, i]); } else i++; } }
      open.forEach((r, k) => { if (!runs.has(k)) { out.push([r.a * res, r.j0 * res, r.b * res, j * res]); open.delete(k); } });
      runs.forEach(([a, b], k) => { if (!open.has(k)) open.set(k, { a, b, j0: j }); });
    }
    return out;
  }

  // which pads end up electrically joined by copper (touching items on a common layer)
  function connectivity(board, pinNet) {
    const items = copper(board, pinNet), dsu = new DSU();
    const bb = items.map(bbox);
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = bb[i], b = bb[j]; if (a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]) continue;
      if (shareLayer(items[i], items[j]) && gap(items[i], items[j]) <= 1e-6) dsu.union(i, j);
    }
    // a pour joins every same-net item it touches (on its layer) through the same filled island
    (board.zones || []).forEach(z => {
      const f = fillZone(board, z, pinNet), first = new Map();
      items.forEach((it, idx) => {
        if (!it.layers.includes(z.layer) || it.net !== z.net) return;
        const [x, y] = it.core[0], i = Math.floor(x / f.res), j = Math.floor(y / f.res); if (i < 0 || j < 0 || i >= f.nx || j >= f.ny) return;
        const id = f.grid[j * f.nx + i]; if (id <= 0) return;
        if (first.has(id)) dsu.union(first.get(id), idx); else first.set(id, idx);
      });
    });
    return { items, dsu };
  }
  // ratsnest: per net, join the copper islands with the shortest pad-to-pad lines (Prim's MST over islands)
  function ratsnest(board, pinNet) {
    const { items, dsu } = connectivity(board, pinNet);
    const byNet = new Map();
    items.forEach((it, i) => { if (it.kind !== 'pad' || !it.net) return; if (!byNet.has(it.net)) byNet.set(it.net, []); byNet.get(it.net).push(i); });
    const lines = []; let unroutedNets = 0;
    byNet.forEach((idx, net) => {
      const islands = new Map(); idx.forEach(i => { const r = dsu.find(i); if (!islands.has(r)) islands.set(r, []); islands.get(r).push(items[i].pad); });
      const groups = [...islands.values()]; if (groups.length < 2) return; unroutedNets++;
      const inTree = [groups[0]], rest = groups.slice(1);
      while (rest.length) {
        let best = null;
        rest.forEach((g, gi) => inTree.forEach(t => g.forEach(p => t.forEach(q => { const d = Math.hypot(p.x - q.x, p.y - q.y); if (!best || d < best.d) best = { d, gi, a: q, b: p }; }))));
        lines.push({ net, x1: best.a.x, y1: best.a.y, x2: best.b.x, y2: best.b.y, d: best.d }); inTree.push(rest.splice(best.gi, 1)[0]);
      }
    });
    return { lines, unroutedNets, totalNets: byNet.size };
  }

  // nets of copper islands: an island takes the net of the pads it touches (tracks drawn without a net pick one up)
  function islandNets(board, pinNet) {
    const { items, dsu } = connectivity(board, pinNet), net = new Map();
    items.forEach((it, i) => { if (it.kind === 'pad' && it.net) { const r = dsu.find(i); if (!net.has(r)) net.set(r, new Set()); net.get(r).add(it.net); } });
    return { items, dsu, net };
  }

  function drc(board, pinNet) {
    const R = { clearance: 0.2, track: 0.2, drill: 0.3, edge: 0.3, ...(board.rules || {}) };
    const { items, dsu, net } = islandNets(board, pinNet), out = [];
    const where = it => { const b = bbox(it); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
    const label = it => it.kind === 'pad' ? `${it.ref}.${it.n}` : it.kind === 'via' ? 'via' : `${it.layers[0]} track`;
    // shorts: one copper island touching pads of two nets
    net.forEach((set, r) => { if (set.size > 1) { const i = items.findIndex((it, k) => dsu.find(k) === r && it.kind === 'pad'); const [x, y] = where(items[i]); out.push({ type: 'Short', msg: `Nets ${[...set].join(' and ')} are shorted together`, x, y }); } });
    const netOf = i => { const s = net.get(dsu.find(i)); return items[i].net || (s && s.size === 1 ? [...s][0] : null); };
    const bb = items.map(bbox);
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j]; if (!shareLayer(a, b)) continue;
      if (dsu.find(i) === dsu.find(j)) continue;                    // same copper island
      const na = netOf(i), nb = netOf(j); if (na && na === nb) continue;  // same net, not yet joined — that's the ratsnest's job
      const A = bb[i], B = bb[j]; if (A[2] + R.clearance < B[0] || B[2] + R.clearance < A[0] || A[3] + R.clearance < B[1] || B[3] + R.clearance < A[1]) continue;
      const g = gap(a, b);
      if (g < R.clearance - 1e-6) { const [x1, y1] = where(a), [x2, y2] = where(b); out.push({ type: 'Clearance', msg: `${label(a)} to ${label(b)}: ${Math.max(0, g).toFixed(3)} mm (min ${R.clearance})`, x: (x1 + x2) / 2, y: (y1 + y2) / 2 }); }
    }
    (board.tracks || []).forEach(t => { if (t.w < R.track - 1e-9) out.push({ type: 'Track width', msg: `${t.layer} track ${t.w} mm is under ${R.track} mm`, x: t.pts[0][0], y: t.pts[0][1] }); });
    (board.vias || []).forEach(v => { if (v.drill < R.drill - 1e-9) out.push({ type: 'Drill', msg: `via drill ${v.drill} mm is under ${R.drill} mm`, x: v.x, y: v.y }); });
    items.forEach(it => { const b = bbox(it); if (b[0] < R.edge || b[1] < R.edge || b[2] > board.w - R.edge || b[3] > board.h - R.edge) { const [x, y] = where(it); out.push({ type: 'Board edge', msg: `${label(it)} is closer than ${R.edge} mm to the board edge`, x, y }); } });
    const rn = ratsnest(board, pinNet);
    rn.lines.forEach(l => out.push({ type: 'Unrouted', msg: `${l.net}: ${l.d.toFixed(2)} mm connection not routed`, x: (l.x1 + l.x2) / 2, y: (l.y1 + l.y2) / 2 }));
    const missing = []; if (pinNet) { const placed = new Set((board.parts || []).map(p => p.ref)); new Set([...pinNet.keys()].map(k => k.split('.')[0])).forEach(r => !placed.has(r) && missing.push(r)); }
    missing.forEach(r => out.push({ type: 'Missing part', msg: `${r} is in the schematic but not on the board — use Update PCB` }));
    return out;
  }

  // ---------- Gerber X2-ish RS-274X ----------
  const f6 = v => Math.round(v * 1e6).toString();
  function gerber(board, layer, pinNet) {
    const L = [], ap = new Map(); let next = 10;
    const head = { top: ['Copper,L1,Top', 'Copper'], bottom: ['Copper,L2,Bot', 'Copper'], mask_top: ['Soldermask,Top', 'Mask'], mask_bottom: ['Soldermask,Bot', 'Mask'], silk_top: ['Legend,Top', 'Silk'], outline: ['Profile,NP', 'Outline'] }[layer];
    const body = [];
    const aperture = (spec) => { if (!ap.has(spec)) ap.set(spec, next++); return 'D' + ap.get(spec); };
    // board y grows down on screen; Gerber y grows up → flip
    const X = x => 'X' + f6(x), Y = y => 'Y' + f6(board.h - y);
    let cur = null; const use = d => { if (cur !== d) { body.push(d + '*'); cur = d; } };
    const flash = (x, y, d) => { use(d); body.push(`${X(x)}${Y(y)}D03*`); };
    const draw = (pts, d) => { use(d); body.push(`${X(pts[0][0])}${Y(pts[0][1])}D02*`); for (let i = 1; i < pts.length; i++) body.push(`${X(pts[i][0])}${Y(pts[i][1])}D01*`); };
    const padAp = (p, grow = 0) => { const w = +(p.w + 2 * grow).toFixed(4), h = +(p.h + 2 * grow).toFixed(4); return aperture(p.shape === 'round' ? `C,${w}` : p.shape === 'oval' ? `O,${w}X${h}` : `R,${w}X${h}`); };
    const copperLayer = layer === 'top' || layer === 'bottom' ? layer : layer === 'mask_top' ? 'top' : layer === 'mask_bottom' ? 'bottom' : null;
    if (layer === 'top' || layer === 'bottom') (board.zones || []).filter(z => z.layer === layer).forEach(z => {   // pours as G36/G37 regions
      zoneRects(fillZone(board, z, pinNet)).forEach(([x0, y0, x1, y1]) => { body.push('G36*', `${X(x0)}${Y(y0)}D02*`, `${X(x1)}${Y(y0)}D01*`, `${X(x1)}${Y(y1)}D01*`, `${X(x0)}${Y(y1)}D01*`, `${X(x0)}${Y(y0)}D01*`, 'G37*'); });
    });
    if (layer === 'top' || layer === 'bottom') {
      (board.tracks || []).filter(t => t.layer === layer).forEach(t => draw(t.pts, aperture(`C,${t.w}`)));
      (board.vias || []).forEach(v => flash(v.x, v.y, aperture(`C,${v.dia}`)));
    }
    if (copperLayer) (board.parts || []).forEach(fp => padsOf(fp).forEach(p => p.layers.includes(copperLayer) && flash(p.x, p.y, padAp(p, layer.startsWith('mask') ? 0.05 : 0))));
    if (layer === 'silk_top') (board.parts || []).filter(fp => fp.side !== 'bottom').forEach(fp => silkOf(fp).forEach(seg => draw(seg, aperture('C,0.15'))));
    if (layer === 'outline') draw([[0, 0], [board.w, 0], [board.w, board.h], [0, board.h], [0, 0]], aperture('C,0.1'));
    L.push(`%TF.GenerationSoftware,Lumen Studio,Lumen PCB,1.0*%`, `%TF.FileFunction,${head[0]}*%`, `%TF.FilePolarity,Positive*%`, '%FSLAX46Y46*%', '%MOMM*%', '%LPD*%', 'G01*');
    ap.forEach((n, spec) => { const [t, dims] = spec.split(','); L.push(`%ADD${n}${t},${dims}*%`); });
    return [...L, ...body, 'M02*'].join('\n') + '\n';
  }
  function drill(board) {
    const holes = [];
    (board.parts || []).forEach(fp => padsOf(fp).forEach(p => p.drill && holes.push([p.x, p.y, p.drill])));
    (board.vias || []).forEach(v => holes.push([v.x, v.y, v.drill]));
    const sizes = [...new Set(holes.map(h => h[2].toFixed(3)))].sort((a, b) => a - b);
    const L = ['M48', '; Lumen PCB drill file', 'FMAT,2', 'METRIC', ...sizes.map((s, i) => `T${i + 1}C${s}`), '%', 'G90', 'G05'];
    sizes.forEach((s, i) => { L.push(`T${i + 1}`); holes.filter(h => h[2].toFixed(3) === s).forEach(h => L.push(`X${h[0].toFixed(3)}Y${(board.h - h[1]).toFixed(3)}`)); });
    L.push('T0', 'M30'); return L.join('\n') + '\n';
  }
  function bom(sch) {
    const rows = new Map();
    sch.parts.forEach(p => { const d = LIB.PART[p.lib]; if (d.power) return; const k = [p.lib, p.value, p.fp].join('|'); if (!rows.has(k)) rows.set(k, { refs: [], value: p.value, fp: p.fp, name: d.name }); rows.get(k).refs.push(p.ref); });
    const out = [['Qty', 'References', 'Value', 'Footprint', 'Description']];
    [...rows.values()].sort((a, b) => a.refs[0].localeCompare(b.refs[0], undefined, { numeric: true })).forEach(r => out.push([r.refs.length, r.refs.sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(' '), r.value, r.fp || '', r.name]));
    return out.map(r => r.map(c => /[",]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c).join(',')).join('\r\n') + '\r\n';
  }

  // ---------- store-only ZIP ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    files.forEach(f => {
      const name = enc.encode(f.name), data = typeof f.data === 'string' ? enc.encode(f.data) : f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name); off += 30 + name.length + data.length;
    });
    const csize = central.reduce((s, b) => s + b.length, 0);
    const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((s, b) => s + b.length, 0)); let p = 0; all.forEach(b => { out.set(b, p); p += b.length; });
    return out;
  }
  function fabFiles(board, name = 'board', pinNet = null) {
    return [['top', '-F_Cu.gtl'], ['bottom', '-B_Cu.gbl'], ['mask_top', '-F_Mask.gts'], ['mask_bottom', '-B_Mask.gbs'], ['silk_top', '-F_Silkscreen.gto'], ['outline', '-Edge_Cuts.gm1']]
      .map(([l, ext]) => ({ name: name + ext, data: gerber(board, l, pinNet) })).concat([{ name: name + '.drl', data: drill(board) }]);
  }

  // place footprints that aren't on the board yet, in a grid inside the outline
  function syncBoard(sch, board) {
    const want = sch.parts.filter(p => !LIB.PART[p.lib].power && p.fp);
    const have = new Map((board.parts || []).map(p => [p.ref, p]));
    board.parts = (board.parts || []).filter(p => want.some(w => w.ref === p.ref));
    board.parts.forEach(p => { const w = want.find(x => x.ref === p.ref); if (w.fp !== p.fp) p.fp = w.fp; });
    let x = 6, y = 6, rowH = 0; const added = [];
    want.forEach(w => {
      if (have.has(w.ref)) return;
      const fp = LIB.FP[w.fp]; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      fp.pads.forEach(p => { x0 = Math.min(x0, p.x - p.w / 2); x1 = Math.max(x1, p.x + p.w / 2); y0 = Math.min(y0, p.y - p.h / 2); y1 = Math.max(y1, p.y + p.h / 2); });
      const fw = x1 - x0 + 3, fh = y1 - y0 + 3;
      if (x + fw > board.w - 2) { x = 6; y += rowH; rowH = 0; }
      const part = { ref: w.ref, fp: w.fp, x: +(x - x0).toFixed(2), y: +(y - y0).toFixed(2), rot: 0, side: 'top' };
      board.parts.push(part); added.push(w.ref); x += fw; rowH = Math.max(rowH, fh);
    });
    return added;
  }

  const api = { fillZone, zoneRects, xform, pinsOf, netlist, annotate, erc, padsOf, silkOf, padShape, copper, coreDist, gap, connectivity, ratsnest, drc, gerber, drill, bom, zip, crc32, fabFiles, syncBoard, rot2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PcbCore = api;
})(typeof self !== 'undefined' ? self : this);
