'use strict';
/* Lumen Diagram — editor core: state, incremental SVG rendering, selection, pointer interactions
   (move with snapping & guides, resize, rotate, connect, reconnect, waypoints, labels, marquee, pan/zoom),
   undo history, clipboard and the in-place text editor. UI panels/menus/IO live in ui.js. */
(function () {
  const G = DiaGeom, S = DiaShapes, M = DiaModel, R = DiaRoute, Rn = DiaRender;
  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const svg = $('cv'), vpG = $('vp'), cellsG = $('cells'), ovG = $('ov'), hovG = $('hov'), stage = $('stage'), ted = $('ted');

  const A = window.DiaApp = {
    doc: M.newDoc(), pi: 0, sel: new Set(), tool: 'select', routes: new Map(), views: new Map(), snap: true,
    edgeStyle: { route: 'orthogonal', endArrow: 'classic' }, clip: null, pasteN: 0, activeLayer: null, fileName: 'Untitled', filePath: null,
    hist: null, listeners: { panels: [], status: [] }, entered: null,
  };
  const page = () => A.doc.pages[A.pi];
  A.page = page;
  A.hist = new Aero.History({ max: 150, onChange: () => A.onHistory && A.onHistory() });

  /* ---------- view (pan / zoom) ---------- */
  const view = () => { const p = page(); let v = A.views.get(p.id); if (!v) { v = { x: 60, y: 60, z: 1 }; A.views.set(p.id, v); } return v; };
  A.view = view;
  const toWorld = (cx, cy) => { const r = svg.getBoundingClientRect(), v = view(); return { x: (cx - r.left - v.x) / v.z, y: (cy - r.top - v.y) / v.z }; };
  const toScreen = (x, y) => { const v = view(); return { x: x * v.z + v.x, y: y * v.z + v.y }; };
  A.toWorld = toWorld; A.toScreen = toScreen;
  function applyView() {
    const v = view(), p = page();
    vpG.setAttribute('transform', `translate(${v.x} ${v.y}) scale(${v.z})`);
    $('bgRect').setAttribute('fill', p.bg || '#ffffff');
    const g = p.grid || 10, gz = g * v.z, dark = isDark(p.bg);
    const minorOk = gz >= 6;
    const minor = $('gridMinor'), major = $('gridMajor');
    minor.setAttribute('width', gz); minor.setAttribute('height', gz);
    $('gridMinorP').setAttribute('d', `M${gz} 0 L0 0 0 ${gz}`); $('gridMinorP').setAttribute('stroke', minorOk ? (dark ? 'rgba(255,255,255,.07)' : '#edf1f6') : 'none');
    const mz = gz * 5; major.setAttribute('width', mz); major.setAttribute('height', mz);
    $('gridMinorR').setAttribute('width', mz); $('gridMinorR').setAttribute('height', mz);
    $('gridMajorP').setAttribute('d', `M${mz} 0 L0 0 0 ${mz}`); $('gridMajorP').setAttribute('stroke', dark ? 'rgba(255,255,255,.14)' : '#dde4ec');
    for (const pt of [minor, major]) { pt.setAttribute('x', v.x); pt.setAttribute('y', v.y); }
    $('gridRect').style.display = p.showGrid === false ? 'none' : '';
    A.onView && A.onView();
  }
  function isDark(c) { const m = /^#([0-9a-f]{6})$/i.exec(c || ''); if (!m) return false; const n = parseInt(m[1], 16); return ((n >> 16) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11) < 110; }
  A.isDark = isDark;
  function zoomAt(z, cx, cy) {
    const v = view(); z = Aero.clamp(z, 0.05, 8);
    const r = svg.getBoundingClientRect(); if (cx == null) { cx = r.left + r.width / 2; cy = r.top + r.height / 2; }
    const wx = (cx - r.left - v.x) / v.z, wy = (cy - r.top - v.y) / v.z;
    v.z = z; v.x = cx - r.left - wx * z; v.y = cy - r.top - wy * z;
    applyView(); drawOverlay(); hideTed(true);
  }
  A.zoomAt = zoomAt;
  A.zoomBy = f => zoomAt(view().z * f);
  A.fit = (cells) => {
    const p = page(); const b = cells ? boxOfCells(cells) : M.pageBounds(p, A.routes);
    const r = svg.getBoundingClientRect(), v = view();
    if (!b || !r.width) { v.x = 60; v.y = 60; v.z = 1; applyView(); return; }
    const pad = 40, z = Math.min((r.width - 2 * pad) / Math.max(b.w, 1), (r.height - 27 - 2 * pad) / Math.max(b.h, 1), 2);
    v.z = Math.max(0.05, z); v.x = (r.width - b.w * v.z) / 2 - b.x * v.z; v.y = (r.height - 27 - b.h * v.z) / 2 - b.y * v.z;
    applyView(); drawOverlay();
  };

  /* ---------- rendering ---------- */
  const cache = new Map();      // id → {g, key}
  let orderSig = '';
  A.byId = new Map();
  function visibleLayer(c, p) { const L = p.layers.find(l => l.id === c.layer) || p.layers[0]; return L.visible !== false; }
  function lockedCell(c) { const p = page(); const L = p.layers.find(l => l.id === c.layer) || p.layers[0]; return !!L.locked; }
  A.lockedCell = lockedCell;
  let liveEdges = null;
  function computeRoutes() {
    const p = page();
    A.routes = liveEdges && A.routes.size ? R.routePage(p, { only: liveEdges, prev: A.routes, byId: A.byId }) : R.routePage(p, { byId: A.byId });
  }
  function render() {
    const p = page();
    A.byId = M.index(p);
    computeRoutes();
    const ctx = { routes: A.routes, bg: p.bg || '#ffffff' };
    const order = Rn.drawOrder(p);
    const seen = new Set();
    for (const c of order) {
      seen.add(c.id);
      const r = c.kind === 'edge' ? A.routes.get(c.id) : null;
      const key = JSON.stringify(c) + (r ? JSON.stringify(r.pts) + r.curved : '') + ctx.bg;
      let ent = cache.get(c.id);
      if (!ent) { ent = { g: document.createElementNS(NS, 'g'), key: '' }; ent.g.setAttribute('data-id', c.id); cache.set(c.id, ent); }
      if (ent.key !== key) {
        ent.key = key;
        let inner = '';
        try {
          const prims = Rn.cellPrims(c, ctx);
          if (c.kind === 'shape') {
            const d = S.get(c.shape);
            const hit = G.transform(d.perimeter === 'lifeline' ? G.rect(0, 0, c.w, 40) + ` M${c.w / 2 - 6} 40 L${c.w / 2 + 6} 40 L${c.w / 2 + 6} ${c.h} L${c.w / 2 - 6} ${c.h} Z` : d.container && (S.styleOf(c).fill === 'none' || !S.styleOf(c).header) && d.id !== 'container' ? G.rect(0, 0, c.w, c.h) : d.path(c.w, c.h, c), M.xf(c));
            const hitAll = d.container && !(d.id === 'group' || d.id === 'fragment' || d.id === 'boundary' || d.id === 'package');
            inner = `<path d="${hit}" fill="${hitAll || d.perimeter !== 'lifeline' ? 'rgba(0,0,0,0)' : 'none'}" stroke="rgba(0,0,0,0)" stroke-width="${d.container && !hitAll ? 8 : 4}" pointer-events="${hitAll || !d.container ? 'all' : 'stroke'}"/>`;
            if (d.container && !hitAll) { const st = S.styleOf(c); const hb = d.id === 'fragment' ? G.rect(0, 0, Math.min(70, c.w * 0.45), 20) : d.id === 'package' ? G.rect(0, 0, Math.min(c.w * 0.45, 80), 18) : G.rect(0, 0, c.w, 24); inner += `<path d="${G.transform(hb, M.xf(c))}" fill="rgba(0,0,0,0)" pointer-events="all"/>`; }
            if (d.label === 'below' && c.text) { const b = M.shapeBox(c); inner += `<rect x="${b.x - 10}" y="${b.y + b.h}" width="${b.w + 20}" height="${(S.styleOf(c).fontSize || 12) * 1.3 * Math.max(1, c.text.split('\n').length) + 4}" fill="rgba(0,0,0,0)"/>`; }
          } else if (c.kind === 'edge' && r) {
            inner = `<path d="${r.curved ? R.curveD(r.pts) : R.polyD(r.pts, 0)}" fill="none" stroke="rgba(0,0,0,0)" stroke-width="12" pointer-events="stroke"/>`;
          }
          inner += Rn.primsSVG(prims, c.id.replace(/[^\w-]/g, ''));
        } catch (err) { console.warn('render', c.id, err); }
        ent.g.innerHTML = inner;
      }
    }
    for (const [id, ent] of cache) if (!seen.has(id)) { ent.g.remove(); cache.delete(id); }
    const sig = order.map(c => c.id).join('|');
    if (sig !== orderSig || cellsG.childElementCount !== order.length) { orderSig = sig; const frag = document.createDocumentFragment(); for (const c of order) frag.appendChild(cache.get(c.id).g); cellsG.appendChild(frag); }
    applyView();
    drawOverlay();
    A.onStatus && A.onStatus();
  }
  A.resetCache = () => { cache.clear(); cellsG.innerHTML = ''; orderSig = ''; };
  let rafPending = false, panelsPending = false;
  function refresh(o = {}) {
    if (o.panels) panelsPending = true;
    if (o.now) { rafPending = false; doRefresh(); return; }
    if (rafPending) return; rafPending = true;
    requestAnimationFrame(() => { if (!rafPending) return; rafPending = false; doRefresh(); });
  }
  function doRefresh() { render(); if (panelsPending) { panelsPending = false; A.onPanels && A.onPanels(); } }
  A.refresh = refresh; A.render = () => refresh({ now: true });

  /* ---------- history ---------- */
  const snapshot = () => JSON.stringify({ pages: A.doc.pages, theme: A.doc.theme, pi: A.pi });
  A.commit = (label, fn) => {
    if (fn) fn(page());
    A.hist.push(label, snapshot());
    liveEdges = null; refresh({ panels: true, now: true }); A.autosave && A.autosave();
  };
  // pi: page to show (the page where the undone/redone change happened)
  A.restore = (state, pi) => {
    if (!state) return; const s = JSON.parse(state);
    const prevPage = A.pi;
    A.doc.pages = s.pages; A.doc.theme = s.theme; A.pi = Math.max(0, Math.min(pi ?? s.pi ?? 0, A.doc.pages.length - 1));
    if (A.pi !== prevPage) { A.sel.clear(); A.activeLayer = null; }
    const ids = M.index(page()); for (const id of [...A.sel]) if (!ids.has(id)) A.sel.delete(id);
    hideTed(false); refresh({ panels: true, now: true }); A.autosave && A.autosave();
  };
  const piOf = i => { const it = A.hist.items[i]; try { return JSON.parse(it.state).pi; } catch (e) { return undefined; } };
  A.undo = () => { const from = A.hist.index; const st = A.hist.undo(); if (st) A.restore(st, piOf(from)); };
  A.redo = () => { const st = A.hist.redo(); if (st) A.restore(st, piOf(A.hist.index)); };
  A.load = (doc, name, path) => {
    A.doc = doc; A.pi = 0; A.sel.clear(); A.views.clear(); A.resetCache(); A.fileName = name || 'Untitled'; A.filePath = path || null; A.activeLayer = null;
    A.hist.reset('Open', snapshot()); Aero.setDoc(A.fileName, false);
    render(); A.fit(); A.onPanels && A.onPanels();
  };
  A.setPage = i => { if (i < 0 || i >= A.doc.pages.length || i === A.pi) return; hideTed(false); A.pi = i; A.sel.clear(); A.activeLayer = null; A.resetCache(); const first = !A.views.has(page().id); render(); if (first) A.fit(); A.onPanels && A.onPanels(); };

  /* ---------- selection helpers ---------- */
  const selCells = () => { const p = page(); return [...A.sel].map(id => A.byId.get(id)).filter(Boolean); };
  A.selCells = selCells;
  A.select = (ids, add) => { if (!add) A.sel.clear(); for (const id of [].concat(ids)) if (id) A.sel.add(id); drawOverlay(); A.onPanels && A.onPanels(); A.onStatus && A.onStatus(); };
  function boxOfCells(cells) { let b = null; for (const c of cells) { const x = M.cellBox(page(), c, A.byId, A.routes); if (x) b = G.unionBox(b, x); } return b; }
  A.boxOfCells = boxOfCells;
  // ids moved together with a cell (descendants of groups and containers)
  function withDesc(cells) {
    const p = page(), out = new Map();
    const add = c => { if (out.has(c.id)) return; out.set(c.id, c); for (const k of p.cells) if (k.parent === c.id) add(k); };
    cells.forEach(add); return [...out.values()];
  }
  A.withDesc = withDesc;
  function pickTarget(id, e) {
    const c = A.byId.get(id); if (!c) return null;
    if (e && e.altKey) return c;
    // select the outermost group, unless we "entered" that group by double-clicking
    let x = c, guard = 0;
    while (x.parent && guard++ < 50) { const p = A.byId.get(x.parent); if (!p || p.kind !== 'group' || p.id === A.entered) break; x = p; }
    return x;
  }

  /* ---------- overlay: selection, handles, guides ---------- */
  let guides = [], marquee = null, preview = null, hoverInfo = null;
  const el = (tag, attrs) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  function handle(x, y, h, o = {}) {
    const z = view().z, s = (o.size || 8) / z;
    const shape = o.circle ? el('circle', { cx: x, cy: y, r: s / 2 + 0.5 / z }) : el('rect', { x: x - s / 2, y: y - s / 2, width: s, height: s, rx: o.round ? s / 2 : 1 / z });
    shape.setAttribute('fill', o.fill || '#ffffff'); shape.setAttribute('stroke', o.stroke || '#2b7de9'); shape.setAttribute('stroke-width', 1.2 / z);
    shape.setAttribute('data-h', h); if (o.op) shape.setAttribute('opacity', o.op);
    return shape;
  }
  function drawOverlay() {
    ovG.textContent = '';
    const z = view().z, p = page();
    const cells = selCells();
    const dash = `${4 / z} ${3 / z}`;
    for (const c of cells) {
      if (c.kind === 'shape' || c.kind === 'group') {
        let d;
        if (c.kind === 'shape') d = G.transform(G.rect(0, 0, c.w, c.h), M.xf(c));
        else { const b = M.cellBox(p, c, A.byId, A.routes); d = G.rect(b.x - 4 / z, b.y - 4 / z, b.w + 8 / z, b.h + 8 / z); }
        ovG.appendChild(el('path', { d, fill: 'none', stroke: c.kind === 'group' ? '#7d3cff' : '#2b7de9', 'stroke-width': 1.2 / z, 'stroke-dasharray': dash, 'pointer-events': 'none' }));
      }
      if (c.kind === 'edge') {
        const r = A.routes.get(c.id); if (!r) continue;
        ovG.appendChild(el('path', { d: r.curved ? R.curveD(r.pts) : R.polyD(r.pts, 0), fill: 'none', stroke: '#2b7de9', 'stroke-width': 3 / z, opacity: 0.35, 'pointer-events': 'none' }));
      }
    }
    const locked = cells.some(lockedCell);
    if (cells.length === 1 && !locked && !drag) {
      const c = cells[0];
      if (c.kind === 'shape') {
        const T = M.xf(c);
        const hs = { nw: [0, 0], n: [c.w / 2, 0], ne: [c.w, 0], e: [c.w, c.h / 2], se: [c.w, c.h], s: [c.w / 2, c.h], sw: [0, c.h], w: [0, c.h / 2] };
        const small = c.w * z < 30 || c.h * z < 30;
        for (const [k, [lx, ly]] of Object.entries(hs)) { if (small && k.length === 1) continue; const q = T(lx, ly); ovG.appendChild(handle(q[0], q[1], 'rs:' + k)); }
        const rq = T(c.w / 2, -22 / z), tq = T(c.w / 2, 0);
        ovG.appendChild(el('line', { x1: tq[0], y1: tq[1], x2: rq[0], y2: rq[1], stroke: '#2b7de9', 'stroke-width': 1 / z, 'pointer-events': 'none' }));
        ovG.appendChild(handle(rq[0], rq[1], 'rot', { circle: true, fill: '#5bc236', stroke: '#2a7d18', size: 10 }));
      } else if (c.kind === 'edge') {
        const r = A.routes.get(c.id);
        if (r) {
          const sp = r.pts[0], tp = r.pts[r.pts.length - 1];
          ovG.appendChild(handle(sp.x, sp.y, 'ep:src', { circle: true, size: 10, fill: c.src.id ? '#2b7de9' : '#ffffff' }));
          ovG.appendChild(handle(tp.x, tp.y, 'ep:tgt', { circle: true, size: 10, fill: c.tgt.id ? '#2b7de9' : '#ffffff' }));
          (c.pts || []).forEach((q, i) => ovG.appendChild(handle(q.x, q.y, 'wp:' + i, { fill: '#ffd34d', stroke: '#9a6b00' })));
          // virtual handles on route segment midpoints (drag to add a waypoint)
          const rp = r.curved ? [sp, ...(c.pts || []), tp] : r.pts;
          for (let i = 0; i + 1 < rp.length; i++) { const a = rp[i], b = rp[i + 1]; if (G.dist(a, b) * z < 30) continue; ovG.appendChild(handle((a.x + b.x) / 2, (a.y + b.y) / 2, 'mid:' + i, { round: true, size: 7, op: 0.75, fill: '#e8f1fd' })); }
          if (c.text) { const L = Rn.edgeGeom(c, r, {}).label; if (L) ovG.appendChild(handle(L.x + L.w / 2, L.y - 4 / z, 'lbl', { size: 7, fill: '#ffd34d', stroke: '#9a6b00', circle: true })); }
        }
      }
    }
    if (cells.length > 1) { const b = boxOfCells(cells); if (b) ovG.appendChild(el('rect', { x: b.x - 6 / z, y: b.y - 6 / z, width: b.w + 12 / z, height: b.h + 12 / z, fill: 'none', stroke: '#2b7de9', 'stroke-width': 1 / z, 'stroke-dasharray': `${2 / z} ${3 / z}`, 'pointer-events': 'none' })); }
    for (const g of guides) ovG.appendChild(el('line', { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, stroke: '#ff3d8b', 'stroke-width': 1 / z, 'pointer-events': 'none' }));
    if (marquee) ovG.appendChild(el('rect', { x: Math.min(marquee.x0, marquee.x1), y: Math.min(marquee.y0, marquee.y1), width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0), fill: 'rgba(43,125,233,.08)', stroke: '#2b7de9', 'stroke-width': 1 / z, 'pointer-events': 'none' }));
    if (preview) {
      if (preview.target) { const t = A.byId.get(preview.target); if (t) ovG.appendChild(el('path', { d: G.transform(G.rect(0, 0, t.w, t.h), M.xf(t)), fill: 'rgba(43,200,120,.08)', stroke: '#22a06b', 'stroke-width': 2 / z, 'pointer-events': 'none' })); }
      if (preview.d) ovG.appendChild(el('path', { d: preview.d, fill: 'none', stroke: '#2b7de9', 'stroke-width': 1.5 / z, 'stroke-dasharray': `${5 / z} ${3 / z}`, 'pointer-events': 'none' }));
      if (preview.rect) ovG.appendChild(el('rect', { ...preview.rect, fill: 'rgba(43,125,233,.06)', stroke: '#2b7de9', 'stroke-width': 1 / z, 'stroke-dasharray': `${4 / z} ${3 / z}`, 'pointer-events': 'none' }));
      if (preview.port) ovG.appendChild(handle(preview.port.x, preview.port.y, 'x', { circle: true, size: 12, fill: '#22a06b', stroke: '#11663f' }));
    }
    drawHover();
  }
  A.drawOverlay = drawOverlay;
  const PORTS = [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
  const portsOf = c => S.get(c.shape).ports || PORTS;
  function portWorld(c, port) { return R.portPoint(c, port).pt; }
  function drawHover() {
    hovG.textContent = '';
    if (!hoverInfo || drag && drag.mode !== 'connect' && drag.mode !== 'endpoint') return;
    const c = A.byId.get(hoverInfo.id); if (!c || c.kind !== 'shape') return;
    const z = view().z;
    portsOf(c).forEach((pt, i) => {
      const q = portWorld(c, pt), s = 4 / z;
      const g = el('g', { 'data-h': `port:${c.id}:${i}` });
      g.appendChild(el('circle', { cx: q.x, cy: q.y, r: 7 / z, fill: 'rgba(0,0,0,0)' }));
      g.appendChild(el('path', { d: `M${q.x - s} ${q.y - s} L${q.x + s} ${q.y + s} M${q.x + s} ${q.y - s} L${q.x - s} ${q.y + s}`, stroke: '#2b7de9', 'stroke-width': 1.6 / z, 'pointer-events': 'none' }));
      hovG.appendChild(g);
    });
    if (drag) return;
    const d = S.get(c.shape);
    if (d.container || d.perimeter === 'lifeline' || lockedCell(c)) return;
    const b = M.shapeBox(c), off = 20 / z, a = 6 / z;
    const arrows = { e: [b.x + b.w + off, b.y + b.h / 2, 0], s: [b.x + b.w / 2, b.y + b.h + off, 90], w: [b.x - off, b.y + b.h / 2, 180], n: [b.x + b.w / 2, b.y - off, 270] };
    for (const [k, [x, y, ang]] of Object.entries(arrows)) {
      const t = el('path', { d: `M${x + a} ${y} L${x - a * 0.7} ${y - a} L${x - a * 0.7} ${y + a} Z`, transform: `rotate(${ang} ${x} ${y})`, fill: '#2b7de9', opacity: 0.55, 'data-h': `qa:${c.id}:${k}` });
      t.appendChild(el('title', {})).textContent = 'Click: add a connected copy · Drag: connect';
      hovG.appendChild(t);
    }
  }

  /* ---------- snapping ---------- */
  function snapMove(box, movingIds, noSnap) {
    guides = [];
    if (noSnap || !A.snap) return { dx: 0, dy: 0 };
    const z = view().z, tol = 6 / z, p = page();
    let bx = null, by = null;
    const xs = [box.x, box.x + box.w / 2, box.x + box.w], ys = [box.y, box.y + box.h / 2, box.y + box.h];
    for (const c of p.cells) {
      if (c.kind !== 'shape' || movingIds.has(c.id) || !visibleLayer(c, p)) continue;
      const b = M.shapeBox(c), cx = [b.x, b.x + b.w / 2, b.x + b.w], cy = [b.y, b.y + b.h / 2, b.y + b.h];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const dx = cx[j] - xs[i]; if (Math.abs(dx) < tol && (!bx || Math.abs(dx) < Math.abs(bx.d) - 0.01)) bx = { d: dx, x: cx[j], b };
        const dy = cy[j] - ys[i]; if (Math.abs(dy) < tol && (!by || Math.abs(dy) < Math.abs(by.d) - 0.01)) by = { d: dy, y: cy[j], b };
      }
    }
    const g = p.grid || 10;
    const dx = bx ? bx.d : Math.round(box.x / g) * g - box.x, dy = by ? by.d : Math.round(box.y / g) * g - box.y;
    if (bx) guides.push({ x1: bx.x, x2: bx.x, y1: Math.min(bx.b.y, box.y + dy) - 10, y2: Math.max(bx.b.y + bx.b.h, box.y + dy + box.h) + 10 });
    if (by) guides.push({ y1: by.y, y2: by.y, x1: Math.min(by.b.x, box.x + dx) - 10, x2: Math.max(by.b.x + by.b.w, box.x + dx + box.w) + 10 });
    return { dx, dy };
  }
  const snapV = (v, noSnap) => noSnap || !A.snap ? v : Math.round(v / (page().grid || 10)) * (page().grid || 10);

  /* ---------- containers ---------- */
  function containerAt(pt, excludeIds) {
    const p = page(); let best = null;
    for (const c of p.cells) {
      if (c.kind !== 'shape' || excludeIds.has(c.id) || !S.get(c.shape).container || !visibleLayer(c, p)) continue;
      const b = M.shapeBox(c); if (pt.x > b.x && pt.x < b.x + b.w && pt.y > b.y && pt.y < b.y + b.h) best = c;   // last = topmost
    }
    return best;
  }
  // put moved/dropped shapes into the container under their centre (or take them out)
  A.reparent = cells => {
    const p = page();
    for (const c of cells) {
      if (c.kind !== 'shape') continue;
      if (c.parent) { const par = A.byId.get(c.parent) || M.index(p).get(c.parent); if (par && par.kind === 'group') continue; }
      const ex = new Set(withDesc([c]).map(x => x.id));
      const ct = containerAt(M.center(c), ex);
      const np = ct ? ct.id : null;
      if (np !== c.parent) c.parent = np;
      if (ct) { const ci = p.cells.indexOf(ct), i = p.cells.indexOf(c); if (i < ci) { p.cells.splice(i, 1); p.cells.splice(p.cells.indexOf(ct) + 1, 0, c); } }
    }
  };

  /* ---------- creating cells ---------- */
  A.layerForNew = () => { const p = page(); const L = p.layers.find(l => l.id === A.activeLayer && !l.locked) || p.layers.find(l => !l.locked && l.visible !== false) || p.layers[0]; return L.id; };
  A.addShape = (shape, x, y, o = {}) => {
    const c = M.makeShape(shape, x, y, { ...o, layer: A.layerForNew() });
    page().cells.push(c); A.byId.set(c.id, c); return c;
  };
  A.addEdge = (src, tgt, o = {}) => {
    const e = M.makeEdge(src, tgt, { style: { ...A.edgeStyle, ...(o.style || {}) }, text: o.text, layer: A.layerForNew(), pts: o.pts });
    page().cells.push(e); A.byId.set(e.id, e); return e;
  };
  A.viewCenter = () => { const r = svg.getBoundingClientRect(); return toWorld(r.left + r.width / 2, r.top + (r.height - 27) / 2); };

  /* ---------- clipboard ---------- */
  A.copy = (cut) => {
    const cells = withDesc(selCells()); if (!cells.length) return false;
    const ids = new Set(cells.map(c => c.id));
    for (const e of page().cells) if (e.kind === 'edge' && !ids.has(e.id) && e.src.id && e.tgt.id && ids.has(e.src.id) && ids.has(e.tgt.id)) { cells.push(e); ids.add(e.id); }
    const ordered = page().cells.filter(c => ids.has(c.id));
    A.clip = JSON.stringify(ordered); A.pasteN = 0;
    try { localStorage.setItem('lumen-diagram-clip', A.clip); } catch (e) { }
    if (cut) A.commit('Cut', p => { p.cells = p.cells.filter(c => !ids.has(c.id)); for (const e of p.cells) if (e.kind === 'edge') { fixDangling(e, ids); } A.sel.clear(); });
    return true;
  };
  function fixDangling(e, ids) {
    for (const k of ['src', 'tgt']) if (e[k] && e[k].id && ids.has(e[k].id)) { const r = A.routes.get(e.id); const q = r ? r.pts[k === 'src' ? 0 : r.pts.length - 1] : { x: 0, y: 0 }; e[k] = { x: q.x, y: q.y }; }
  }
  A.paste = (json, at) => {
    let data = json || A.clip; if (!data) { try { data = localStorage.getItem('lumen-diagram-clip'); } catch (e) { } } if (!data) return;
    let cells; try { cells = M.normalize({ pages: [{ layers: page().layers, cells: JSON.parse(data) }] }).pages[0].cells; } catch (e) { return; }
    const map = new Map(); cells.forEach(c => map.set(c.id, M.uid(c.kind === 'edge' ? 'e' : 's')));
    A.pasteN++;
    let off = 20 * A.pasteN, dxy = { x: off, y: off };
    if (at) { const b = G.bboxPts(cells.filter(c => c.kind === 'shape').flatMap(c => [{ x: c.x, y: c.y }, { x: c.x + c.w, y: c.y + c.h }])); if (isFinite(b.x)) dxy = { x: at.x - b.x - b.w / 2, y: at.y - b.y - b.h / 2 }; }
    const L = A.layerForNew(), lids = new Set(page().layers.map(l => l.id));
    for (const c of cells) {
      c.id = map.get(c.id); if (c.parent) c.parent = map.get(c.parent) || null; if (!lids.has(c.layer) || lockedLayer(c.layer)) c.layer = L;
      if (c.kind === 'shape') { c.x += dxy.x; c.y += dxy.y; }
      if (c.kind === 'edge') { for (const k of ['src', 'tgt']) { if (c[k].id) c[k] = { id: map.get(c[k].id) || null, port: c[k].port }; else c[k] = { x: c[k].x + dxy.x, y: c[k].y + dxy.y }; if (c[k].id === null) c[k] = { x: 0, y: 0 }; } c.pts = c.pts.map(q => ({ x: q.x + dxy.x, y: q.y + dxy.y })); }
    }
    A.commit('Paste', p => { p.cells.push(...cells); A.sel.clear(); cells.filter(c => !c.parent || !map.has([...map.keys()].find(k => map.get(k) === c.parent) || '')).forEach(c => { if (!c.parent || !cells.some(x => x.id === c.parent)) A.sel.add(c.id); }); });
  };
  const lockedLayer = id => { const L = page().layers.find(l => l.id === id); return L && L.locked; };
  A.duplicate = () => { const keep = A.clip; if (A.copy(false)) { A.pasteN = 0; A.paste(); } A.clip = keep; };
  A.deleteSel = () => {
    const cells = selCells().filter(c => !lockedCell(c)); if (!cells.length) return;
    const ids = new Set(withDesc(cells).map(c => c.id));
    A.commit(cells.length === 1 ? 'Delete' : `Delete ${cells.length} items`, p => {
      // deleting a group keeps nothing of it; edges attached to deleted shapes are removed too (like Visio)
      for (const e of p.cells) if (e.kind === 'edge' && ((e.src.id && ids.has(e.src.id)) || (e.tgt.id && ids.has(e.tgt.id)))) ids.add(e.id);
      p.cells = p.cells.filter(c => !ids.has(c.id)); A.sel.clear();
    });
  };

  /* ---------- text editing ---------- */
  let editing = null;
  function showTed(c, initial) {
    hideTed(false);
    const p = page(), z = view().z, st = S.styleOf(c);
    let box, align = st.align || 'center';
    if (c.kind === 'shape') {
      const d = S.get(c.shape), tb = d.sections ? { x: 0, y: 0, w: c.w, h: c.h } : S.textBox(c);
      if (d.sections) align = 'left';
      box = { x: c.x + tb.x, y: c.y + tb.y, w: Math.max(tb.w, 60), h: Math.max(tb.h, 24) };
      if (d.label === 'below') box = { x: c.x + c.w / 2 - 80, y: c.y + c.h + 2, w: 160, h: 40 };
    } else {
      const r = A.routes.get(c.id); const L = r && Rn.edgeGeom(c, r, {}).label; const q = r ? G.pointAt(r.pts, c.labelT ?? 0.5) : { x: 0, y: 0 };
      box = L ? { x: L.x - 30, y: L.y, w: L.w + 60, h: L.h + 4 } : { x: q.x - 70, y: q.y - 14, w: 140, h: 28 };
      align = 'center';
    }
    const s = toScreen(box.x, box.y);
    Object.assign(ted.style, { left: s.x + 'px', top: s.y + 'px', width: Math.max(80, box.w * z) + 'px', height: Math.max(26, box.h * z) + 'px', fontSize: (st.fontSize || 12) * z + 'px', fontFamily: Rn.FAMILY[st.font] || Rn.FAMILY.sans, textAlign: align, fontWeight: st.bold ? 'bold' : 'normal', fontStyle: st.italic ? 'italic' : 'normal', color: isDark(p.bg) ? '#111' : st.fontColor || '#000' });
    ted.hidden = false; ted.value = initial != null ? initial : c.text || '';
    editing = { id: c.id, orig: c.text || '' };
    ted.focus(); if (initial == null) ted.select(); else ted.setSelectionRange(ted.value.length, ted.value.length);
    A.onStatus && A.onStatus('Editing text — Ctrl+Enter or click outside to finish, Esc to cancel');
  }
  function hideTed(commit) {
    if (!editing) return; const e = editing; editing = null; ted.hidden = true;
    if (commit) {
      const c = A.byId.get(e.id) || M.index(page()).get(e.id), v = ted.value.replace(/\r/g, '');
      if (c && v !== e.orig) A.commit('Edit text', () => { c.text = v; if (c.kind === 'shape' && S.get(c.shape).sections) { const L = Rn.classSections(c, S.styleOf(c)); c.h = Math.max(c.h, Math.ceil(L.total)); } });
    }
    svg.focus && svg.focus();
  }
  A.editText = (c, initial) => { c = c || selCells()[0]; if (!c || (c.kind !== 'shape' && c.kind !== 'edge') || lockedCell(c)) return; showTed(c, initial); };
  A.isEditing = () => !!editing;
  A.commitText = () => hideTed(true);
  ted.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); hideTed(false); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); hideTed(true); }
    e.stopPropagation();
  });
  ted.addEventListener('blur', () => setTimeout(() => { if (editing && document.activeElement !== ted) hideTed(true); }, 0));

  /* ---------- pointer interaction ---------- */
  let drag = null, spaceDown = false;
  const capture = e => { try { svg.setPointerCapture(e.pointerId); } catch (err) { /* synthetic or finished pointer */ } };
  A.isDragging = () => !!drag;
  addEventListener('keydown', e => { if (e.code === 'Space' && !e.target.matches('input,textarea,select') && !editing) { if (!spaceDown) { spaceDown = true; svg.classList.add('pan'); } e.preventDefault(); } });
  addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; if (A.tool !== 'hand') svg.classList.remove('pan'); } });
  const cellIdAt = target => { const g = target && target.closest && target.closest('#cells [data-id]'); return g ? g.getAttribute('data-id') : null; };
  // shape under a world point (topmost; optional exclude set)
  function shapeAt(pt, exclude) {
    const p = page(), order = Rn.drawOrder(p);
    for (let i = order.length - 1; i >= 0; i--) {
      const c = order[i]; if (c.kind !== 'shape' || (exclude && exclude.has(c.id))) continue;
      const d = S.get(c.shape);
      if (d.container) { const b = M.shapeBox(c); const inside = G.inBox(pt, b, 4 / view().z); if (inside) { const head = S.styleOf(c).header || 24; const nearEdge = pt.x - b.x < 8 || b.x + b.w - pt.x < 8 || pt.y - b.y < head || b.y + b.h - pt.y < 8; if (nearEdge) return c; } continue; }
      const rings = M.outline(c);
      if (G.pointInRings(rings, pt) || G.inBox(pt, M.shapeBox(c), 3 / view().z) && (d.perimeter === 'rect' || d.perimeter === 'lifeline')) return c;
    }
    return null;
  }
  A.shapeAt = shapeAt;
  function nearestPort(c, pt, tol) {
    let best = null, bd = tol;
    portsOf(c).forEach(port => { const q = portWorld(c, port), d = G.dist(q, pt); if (d < bd) { bd = d; best = { port, q }; } });
    return best;
  }
  // free point → end spec, gluing to shape/port under the pointer
  function endAt(pt, exclude, e) {
    const z = view().z;
    const t = shapeAt(pt, exclude);
    if (!t || lockedCell(t)) return { end: { x: snapV(pt.x, e.altKey), y: snapV(pt.y, e.altKey) }, target: null };
    const d = S.get(t.shape);
    if (d.perimeter === 'lifeline') { const py = Aero.clamp((pt.y - t.y) / t.h, 40 / t.h, 1); return { end: { id: t.id, port: [0.5, Math.round(py * t.h) / t.h] }, target: t.id, port: { x: t.x + t.w / 2, y: t.y + py * t.h } }; }
    const np = nearestPort(t, pt, 10 / z);
    if (np) return { end: { id: t.id, port: np.port }, target: t.id, port: np.q };
    return { end: { id: t.id, port: null }, target: t.id };
  }

  svg.addEventListener('contextmenu', e => { e.preventDefault(); A.contextMenu && A.contextMenu(e); });
  svg.addEventListener('pointerdown', e => {
    if (editing) { hideTed(true); }
    Aero.closeMenus(); A.hideContext && A.hideContext();
    const w = toWorld(e.clientX, e.clientY);
    if (e.button === 1 || (e.button === 0 && (spaceDown || A.tool === 'hand'))) { drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, v0: { ...view() } }; svg.classList.add('panning'); capture(e); e.preventDefault(); return; }
    if (e.button !== 0) { const id = cellIdAt(e.target); if (id && !A.sel.has(id)) { const t = pickTarget(id, e); if (t) A.select(t.id); } return; }
    capture(e);
    const h = e.target.closest && e.target.closest('[data-h]'), hk = h && h.getAttribute('data-h');
    const one = selCells().length === 1 ? selCells()[0] : null;
    if (hk) {
      if (hk.startsWith('rs:') && one) { drag = { mode: 'resize', dir: hk.slice(3), c: one, o: { x: one.x, y: one.y, w: one.w, h: one.h }, start: w }; return; }
      if (hk === 'rot' && one) { drag = { mode: 'rotate', c: one, rot0: one.rot || 0 }; return; }
      if (hk.startsWith('ep:') && one) { const which = hk.slice(3); drag = { mode: 'endpoint', e: one, which, orig: JSON.stringify(one[which]) }; liveEdges = new Set([one.id]); return; }
      if (hk.startsWith('wp:') && one) { drag = { mode: 'waypoint', e: one, i: +hk.slice(3) }; liveEdges = new Set([one.id]); return; }
      if (hk.startsWith('mid:') && one) {
        const r = A.routes.get(one.id), ctrl = [r.pts[0], ...(one.pts || []), r.pts[r.pts.length - 1]];
        const k = G.nearestT(ctrl, w); let acc = 0, idx = 0; const L = G.polyLen(ctrl) * k.t;
        for (let i = 1; i < ctrl.length; i++) { acc += G.dist(ctrl[i - 1], ctrl[i]); if (acc >= L - 0.01) { idx = i - 1; break; } idx = i - 1; }
        one.pts = one.pts || []; one.pts.splice(idx, 0, { x: w.x, y: w.y });
        drag = { mode: 'waypoint', e: one, i: idx, created: true }; liveEdges = new Set([one.id]); refresh(); return;
      }
      if (hk === 'lbl' && one) { drag = { mode: 'label', e: one }; return; }
      if (hk.startsWith('port:') || hk.startsWith('qa:')) {
        const [, id, k] = hk.split(':'); const c = A.byId.get(id);
        if (c) { const port = hk.startsWith('port:') ? portsOf(c)[+k] : null; drag = { mode: 'connect', src: { id, port }, from: port ? portWorld(c, port) : M.center(c), qa: hk.startsWith('qa:') ? k : null, sx: e.clientX, sy: e.clientY }; return; }
      }
    }
    if (A.tool === 'connector') {
      const t = shapeAt(w);
      if (t && !lockedCell(t)) { const np = nearestPort(t, w, 10 / view().z); drag = { mode: 'connect', src: { id: t.id, port: np ? np.port : null }, from: np ? np.q : M.center(t), sx: e.clientX, sy: e.clientY }; }
      else drag = { mode: 'connect', src: { x: snapV(w.x, e.altKey), y: snapV(w.y, e.altKey) }, from: { x: snapV(w.x, e.altKey), y: snapV(w.y, e.altKey) }, sx: e.clientX, sy: e.clientY };
      return;
    }
    if (A.tool === 'text') { const c = A.addShape('text', snapV(w.x - 60, e.altKey), snapV(w.y - 15, e.altKey), { text: '' }); A.commit('Add text'); A.select(c.id); A.setTool('select'); A.render(); A.editText(c, ''); return; }
    if (A.tool && A.tool.startsWith('draw:')) { drag = { mode: 'draw', shape: A.tool.slice(5), x0: snapV(w.x, e.altKey), y0: snapV(w.y, e.altKey), x1: w.x, y1: w.y }; return; }
    const id = cellIdAt(e.target);
    const c0 = id ? pickTarget(id, e) : null;
    const c = c0 && !lockedCell(c0) ? c0 : null;
    if (c) {
      const wasSel = A.sel.has(c.id);
      if (e.shiftKey) { if (A.sel.has(c.id)) A.sel.delete(c.id); else A.sel.add(c.id); A.select([...A.sel]); }
      else if (!A.sel.has(c.id)) A.select(c.id);
      drag = { mode: 'pending', start: w, sx: e.clientX, sy: e.clientY, dup: e.ctrlKey || e.metaKey, alt: e.altKey, cid: c.id, wasSel: wasSel && !e.shiftKey };
      return;
    }
    if (!e.shiftKey) A.select([]);
    marquee = { x0: w.x, y0: w.y, x1: w.x, y1: w.y, add: e.shiftKey }; drag = { mode: 'marquee' };
  });
  svg.addEventListener('dblclick', e => {
    const h = e.target.closest && e.target.closest('[data-h]'), hk = h && h.getAttribute('data-h');
    const one = selCells().length === 1 ? selCells()[0] : null;
    if (hk && hk.startsWith('wp:') && one) { const i = +hk.slice(3); A.commit('Remove waypoint', () => one.pts.splice(i, 1)); return; }
    const id = cellIdAt(e.target);
    if (id) {
      let c = pickTarget(id, e);
      if (c && c.kind === 'group') { A.entered = c.id; const inner = pickTarget(id, e); A.select(inner.id); c = inner; if (c.kind === 'group') return; }
      if (c && !lockedCell(c)) { A.select(c.id); A.editText(c); }
      return;
    }
    if (!hk) { const w = toWorld(e.clientX, e.clientY); const c = A.addShape('text', snapV(w.x - 60), snapV(w.y - 15), { text: '' }); A.commit('Add text'); A.select(c.id); A.render(); A.editText(c, ''); }
  });
  let hoverRaf = 0, lastMove = null;
  svg.addEventListener('pointermove', e => {
    lastMove = e;
    if (drag) { onDrag(e); return; }
    if (hoverRaf) return; hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; updateHover(lastMove); });
  });
  svg.addEventListener('pointerleave', () => { if (!drag && hoverInfo) { hoverInfo = null; drawHover(); } });
  function updateHover(e) {
    const w = toWorld(e.clientX, e.clientY);
    A.onPointer && A.onPointer(w);
    if (A.tool !== 'select' && A.tool !== 'connector') { if (hoverInfo) { hoverInfo = null; drawHover(); } return; }
    const h = e.target.closest && e.target.closest('#hov [data-h]');
    if (h) return;     // keep current affordances while over them
    const id = cellIdAt(e.target); let c = id ? A.byId.get(id) : null;
    if (c && c.kind !== 'shape') c = null;
    if (!c && hoverInfo) { const hc = A.byId.get(hoverInfo.id); if (hc && G.inBox(w, M.shapeBox(hc), 32 / view().z)) return; }
    const nid = c ? c.id : null;
    if ((hoverInfo && hoverInfo.id) !== nid) { hoverInfo = nid ? { id: nid } : null; drawHover(); }
  }
  function onDrag(e) {
    const w = toWorld(e.clientX, e.clientY), d = drag;
    A.onPointer && A.onPointer(w);
    if (d.mode === 'pan') { const v = view(); v.x = d.v0.x + e.clientX - d.sx; v.y = d.v0.y + e.clientY - d.sy; applyView(); drawOverlay(); return; }
    if (d.mode === 'pending') {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) return;
      let cells = selCells().filter(c => !lockedCell(c));
      // free-standing edges can be dragged; glued ones only move with their shapes
      cells = cells.filter(c => c.kind !== 'edge' || (!c.src.id && !c.tgt.id));
      if (!cells.length) { drag = null; return; }
      if (d.dup) { A.copy(false); A.pasteN = -1; const before = new Set(page().cells.map(c => c.id)); A.paste(); A.hist.undo(); A.hist.items.pop(); const fresh = page().cells.filter(c => !before.has(c.id)); cells = fresh.filter(c => A.sel.has(c.id)); }
      const moving = withDesc(cells);
      const ids = new Set(moving.map(c => c.id));
      const edges = page().cells.filter(c => c.kind === 'edge' && ((c.src.id && ids.has(c.src.id)) || (c.tgt.id && ids.has(c.tgt.id)) || ids.has(c.id)));
      liveEdges = new Set(edges.map(e => e.id));
      const box = boxOfCells(cells.filter(c => c.kind !== 'edge')) || boxOfCells(cells);
      drag = { mode: 'move', start: d.start, moving, ids, edges, box, orig: new Map(moving.map(c => [c.id, c.kind === 'shape' ? { x: c.x, y: c.y } : { src: { ...c.src }, tgt: { ...c.tgt }, pts: (c.pts || []).map(q => ({ ...q })) }])), eorig: new Map(edges.map(e => [e.id, (e.pts || []).map(q => ({ ...q }))])), dup: d.dup };
      hoverInfo = null; drawHover();
      return onDrag(e);
    }
    if (d.mode === 'move') {
      let dx = w.x - d.start.x, dy = w.y - d.start.y;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      const sn = snapMove({ x: d.box.x + dx, y: d.box.y + dy, w: d.box.w, h: d.box.h }, d.ids, e.altKey);
      dx += sn.dx; dy += sn.dy;
      for (const c of d.moving) {
        const o = d.orig.get(c.id);
        if (c.kind === 'shape') { c.x = Math.round((o.x + dx) * 100) / 100; c.y = Math.round((o.y + dy) * 100) / 100; }
        else if (c.kind === 'edge') { if (!c.src.id) c.src = { x: o.src.x + dx, y: o.src.y + dy }; if (!c.tgt.id) c.tgt = { x: o.tgt.x + dx, y: o.tgt.y + dy }; c.pts = o.pts.map(q => ({ x: q.x + dx, y: q.y + dy })); }
      }
      // waypoints of edges whose both ends move go along
      for (const ed of d.edges) { if (d.ids.has(ed.id)) continue; const both = (!ed.src.id || d.ids.has(ed.src.id)) && (!ed.tgt.id || d.ids.has(ed.tgt.id)); if (both) ed.pts = d.eorig.get(ed.id).map(q => ({ x: q.x + dx, y: q.y + dy })); }
      d.dx = dx; d.dy = dy;
      A.onStatus && A.onStatus(`Move ${Math.round(dx)}, ${Math.round(dy)}`);
      refresh(); return;
    }
    if (d.mode === 'resize') {
      const c = d.c, o = d.o, rot = c.rot || 0, cx = o.x + o.w / 2, cy = o.y + o.h / 2;
      const lp = G.rotPt(w.x, w.y, cx, cy, -rot), lx = lp[0] - cx, ly = lp[1] - cy;
      const hx = d.dir.includes('e') ? 1 : d.dir.includes('w') ? -1 : 0, hy = d.dir.includes('s') ? 1 : d.dir.includes('n') ? -1 : 0;
      const ax = -hx * o.w / 2, ay = -hy * o.h / 2;
      let nw = hx ? Math.max(8, Math.abs(lx - ax)) : o.w, nh = hy ? Math.max(8, Math.abs(ly - ay)) : o.h;
      if (!rot && A.snap && !e.altKey) {
        const g = page().grid || 10;
        if (hx === 1) nw = Math.max(g, Math.round((o.x + nw) / g) * g - o.x); if (hx === -1) nw = Math.max(g, o.x + o.w - Math.round((o.x + o.w - nw) / g) * g);
        if (hy === 1) nh = Math.max(g, Math.round((o.y + nh) / g) * g - o.y); if (hy === -1) nh = Math.max(g, o.y + o.h - Math.round((o.y + o.h - nh) / g) * g);
      }
      if (e.shiftKey && hx && hy) { const k = Math.max(nw / o.w, nh / o.h); nw = o.w * k; nh = o.h * k; }
      const ncx = hx ? ax + hx * nw / 2 : 0, ncy = hy ? ay + hy * nh / 2 : 0;
      const wc = G.rotPt(cx + ncx, cy + ncy, cx, cy, rot);
      c.w = Math.round(nw * 100) / 100; c.h = Math.round(nh * 100) / 100; c.x = Math.round((wc[0] - nw / 2) * 100) / 100; c.y = Math.round((wc[1] - nh / 2) * 100) / 100;
      liveEdges = new Set(page().cells.filter(x => x.kind === 'edge' && (x.src.id === c.id || x.tgt.id === c.id)).map(x => x.id));
      A.onStatus && A.onStatus(`${Math.round(c.w)} × ${Math.round(c.h)}`);
      refresh(); return;
    }
    if (d.mode === 'rotate') {
      const c = d.c, ctr = M.center(c);
      let a = Math.atan2(w.y - ctr.y, w.x - ctr.x) * 180 / Math.PI + 90;
      a = e.shiftKey ? Math.round(a / 15) * 15 : Math.abs(a - Math.round(a / 90) * 90) < 4 ? Math.round(a / 90) * 90 : Math.round(a);
      c.rot = ((a % 360) + 360) % 360;
      liveEdges = new Set(page().cells.filter(x => x.kind === 'edge' && (x.src.id === c.id || x.tgt.id === c.id)).map(x => x.id));
      A.onStatus && A.onStatus(`Rotate ${c.rot}°`);
      refresh(); return;
    }
    if (d.mode === 'connect') {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4 && !d.moved) return;
      d.moved = true;
      const ex = new Set(); if (d.src.id) ex.add(d.src.id);
      const r = endAt(w, d.src.id && A.tool !== 'connector' && !d.src.port ? null : null, e);
      d.end = r.end; d.target = r.target;
      // temporary route preview
      const tmp = M.makeEdge(d.src, r.end, { style: { ...A.edgeStyle } });
      const tr = R.routeEdge(tmp, { byId: A.byId, obstacles: R.obstaclesOf(page()) });
      preview = { d: tr.curved ? R.curveD(tr.pts) : R.polyD(tr.pts, 0), target: r.target && r.target !== d.src.id ? r.target : null, port: r.port };
      hoverInfo = r.target ? { id: r.target } : null;
      drawOverlay(); return;
    }
    if (d.mode === 'endpoint') {
      const ed = d.e, ex = new Set([ed.id]);
      const r = endAt(w, ex, e);
      ed[d.which] = r.end; preview = { target: r.target, port: r.port }; hoverInfo = r.target ? { id: r.target } : null;
      refresh(); return;
    }
    if (d.mode === 'waypoint') { d.e.pts[d.i] = { x: snapV(w.x, e.altKey), y: snapV(w.y, e.altKey) }; refresh(); return; }
    if (d.mode === 'label') {
      const ed = d.e, r = A.routes.get(ed.id); if (!r) return;
      const flat = r.curved ? G.flatten(R.curveD(r.pts), 12)[0].pts : r.pts;
      const k = G.nearestT(flat, w), q = G.pointAt(flat, k.t);
      ed.labelT = Math.round(k.t * 1000) / 1000;
      if (k.d > 12 / view().z) { ed.labelDx = Math.round(w.x - q.x); ed.labelDy = Math.round(w.y - q.y); } else { ed.labelDx = 0; ed.labelDy = 0; }
      refresh(); return;
    }
    if (d.mode === 'marquee') { marquee.x1 = w.x; marquee.y1 = w.y; drawOverlay(); return; }
    if (d.mode === 'draw') { d.x1 = w.x; d.y1 = w.y; const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1); preview = { rect: { x, y, width: Math.abs(d.x1 - d.x0), height: Math.abs(d.y1 - d.y0) } }; drawOverlay(); return; }
  }
  svg.addEventListener('pointerup', e => endDrag(e));
  svg.addEventListener('pointercancel', e => endDrag(e, true));
  function endDrag(e, cancel) {
    const d = drag; drag = null; svg.classList.remove('panning');
    guides = []; const hadPreview = preview; preview = null;
    if (!d) return;
    const w = toWorld(e.clientX, e.clientY);
    if (d.mode === 'pan') { drawOverlay(); return; }
    if (d.mode === 'pending') {
      // plain click on an already-selected item inside a multi-selection selects just it
      if (d.wasSel && A.sel.size > 1) A.select(d.cid); else drawOverlay();
      return;
    }
    if (d.mode === 'move') {
      if (cancel || (!d.dx && !d.dy && !d.dup)) { for (const c of d.moving) { const o = d.orig.get(c.id); if (c.kind === 'shape') { c.x = o.x; c.y = o.y; } } liveEdges = null; refresh(); return; }
      A.reparent(d.moving.filter(c => c.kind === 'shape' && !d.ids.has(c.parent)));
      liveEdges = null;
      A.commit(d.dup ? 'Duplicate' : (d.moving.length === 1 ? 'Move' : `Move ${d.moving.length} items`));
      return;
    }
    if (d.mode === 'resize') { liveEdges = null; if (cancel) { Object.assign(d.c, d.o); refresh(); return; } A.commit('Resize'); return; }
    if (d.mode === 'rotate') { liveEdges = null; if (cancel) { d.c.rot = d.rot0; refresh(); return; } A.commit('Rotate'); return; }
    if (d.mode === 'connect') {
      if (cancel) { drawOverlay(); return; }
      if (!d.moved) {
        // click on a quick-connect arrow: clone the shape in that direction and connect it
        if (d.qa) { A.quickAdd(d.src.id, d.qa); return; }
        drawOverlay(); return;
      }
      if (d.target && d.target === d.src.id && !d.end.port && !d.src.port) { drawOverlay(); return; }
      const ed = A.addEdge(d.src, d.end);
      A.commit('Connect'); A.select(ed.id); return;
    }
    if (d.mode === 'endpoint') { liveEdges = null; if (cancel) { d.e[d.which] = JSON.parse(d.orig); refresh(); return; } A.commit('Reconnect'); return; }
    if (d.mode === 'waypoint') { liveEdges = null; A.commit(d.created ? 'Add waypoint' : 'Move waypoint'); return; }
    if (d.mode === 'label') { A.commit('Move label'); return; }
    if (d.mode === 'marquee') {
      const m = marquee; marquee = null;
      const b = { x: Math.min(m.x0, m.x1), y: Math.min(m.y0, m.y1), w: Math.abs(m.x1 - m.x0), h: Math.abs(m.y1 - m.y0) };
      if (b.w * view().z < 3 && b.h * view().z < 3) { A.entered = null; drawOverlay(); A.onPanels && A.onPanels(); return; }
      const p = page(), ids = m.add ? new Set(A.sel) : new Set();
      for (const c of p.cells) {
        if (!visibleLayer(c, p) || lockedCell(c)) continue;
        const top = pickTarget(c.id); if (top !== c) continue;
        const cb = M.cellBox(p, c, A.byId, A.routes);
        if (cb && cb.x >= b.x && cb.y >= b.y && cb.x + cb.w <= b.x + b.w && cb.y + cb.h <= b.y + b.h) ids.add(c.id);
      }
      A.select([...ids]); return;
    }
    if (d.mode === 'draw') {
      let x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), ww = Math.abs(d.x1 - d.x0), hh = Math.abs(d.y1 - d.y0);
      const def = S.get(d.shape);
      if (ww < 8 || hh < 8) { ww = def.w; hh = def.h; x = d.x0 - ww / 2; y = d.y0 - hh / 2; }
      ww = snapV(ww, e.altKey) || ww; hh = snapV(hh, e.altKey) || hh;
      const c = A.addShape(d.shape, x, y, { w: ww, h: hh, style: A.themeStyle ? A.themeStyle(d.shape) : {} });
      A.reparent([c]); A.commit('Add ' + def.name.toLowerCase()); A.select(c.id); A.setTool('select'); return;
    }
    if (hadPreview) drawOverlay();
  }
  // clone a shape next to itself (quick-connect arrows)
  A.quickAdd = (id, dir) => {
    const c = A.byId.get(id); if (!c) return;
    const gap = 60, dx = dir === 'e' ? c.w + gap : dir === 'w' ? -(c.w + gap) : 0, dy = dir === 's' ? c.h + gap : dir === 'n' ? -(c.h + gap) : 0;
    const n = A.addShape(c.shape, c.x + dx, c.y + dy, { w: c.w, h: c.h, rot: c.rot, style: { ...c.style }, text: '' });
    A.reparent([n]);
    A.addEdge({ id: c.id, port: null }, { id: n.id, port: null });
    A.commit('Add connected shape'); A.select(n.id);
  };

  // wheel: scroll pans, Ctrl+wheel zooms at the pointer
  svg.addEventListener('wheel', e => {
    e.preventDefault(); if (editing) hideTed(true);
    if (e.ctrlKey || e.metaKey) { zoomAt(view().z * Math.pow(1.0018, -e.deltaY * (e.deltaMode === 1 ? 30 : 1)), e.clientX, e.clientY); return; }
    const v = view(), k = e.deltaMode === 1 ? 30 : 1;
    if (e.shiftKey && !e.deltaX) v.x -= e.deltaY * k; else { v.x -= e.deltaX * k; v.y -= e.deltaY * k; }
    applyView(); drawOverlay();
  }, { passive: false });

  // drop from the shape library (HTML5 drag & drop)
  stage.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('application/x-lumen-shape')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  stage.addEventListener('drop', e => {
    const id = e.dataTransfer.getData('application/x-lumen-shape'); if (!id) return;
    e.preventDefault(); e.stopPropagation();
    const w = toWorld(e.clientX, e.clientY);
    A.insertItem && A.insertItem(id, w, e.altKey);
  }, true);

  window.addEventListener('resize', () => { applyView(); drawOverlay(); });
  A.svg = svg; A.stage = stage;
  A.setTool = t => { A.tool = t; A.toolbox && A.toolbox.set(t); };
  A.edgeEnd = endAt;
})();
