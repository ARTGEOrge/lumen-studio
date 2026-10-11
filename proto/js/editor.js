'use strict';
/* Lumen Proto — editor state, canvas view, tools, selection, snapping, smart guides, prototype wires. */
(function () {
  const LP = window.LP, M = LP.M;
  const ED = window.ED = {
    doc: LP.newDoc(), scene: null, sel: [], mode: 'design', tool: 'select',
    view: { z: 1, x: 0, y: 0 }, clip: null, hover: null, drag: null, editing: null, penPts: null,
    listeners: { sel: [], doc: [], view: [] }, showGrids: true, snapOn: true, filePath: null
  };
  const on = (ev, fn) => (ED.listeners[ev] = ED.listeners[ev] || []).push(fn);
  const emit = ev => (ED.listeners[ev] || []).forEach(f => f());
  ED.on = on; ED.emit = emit;

  /* ======================= document & history ======================= */
  const snap = () => JSON.stringify(ED.doc, (k, v) => k === 'images' || k[0] === '_' ? undefined : v);
  ED.hist = new Aero.History({ max: 120, onChange: () => emit('hist') });
  ED.listeners.hist = [];
  ED.update = () => { ED.scene = new LP.Scene(ED.doc).update(); ED.wm = new Map(); };
  ED.setDoc = (doc, name) => {
    ED.doc = doc; ED.update(); ED.sel = []; ED.hist.reset('Open', snap()); Aero.setDoc(name || doc.name || 'Untitled', false);
    emit('doc'); emit('sel'); ED.redraw();
  };
  ED.commit = (label) => {
    ED.update();
    ED.sel = ED.sel.filter(id => ED.scene.get(id));
    ED.hist.push(label, snap());
    emit('doc'); emit('sel'); ED.redraw();
  };
  ED.live = () => { ED.update(); ED.redraw(); emit('live'); };
  ED.listeners.live = [];
  function restore(state) { if (state == null) return; const images = ED.doc.images; ED.doc = JSON.parse(state); ED.doc.images = images; ED.update(); ED.sel = ED.sel.filter(id => ED.scene.get(id)); emit('doc'); emit('sel'); ED.redraw(); }
  ED.undo = () => { if (ED.editing) return; restore(ED.hist.undo()); };
  ED.redo = () => { if (ED.editing) return; restore(ED.hist.redo()); };
  ED.goHist = i => restore(ED.hist.go(i));

  /* ======================= tree helpers ======================= */
  ED.get = id => ED.scene.get(id);
  ED.parent = n => ED.scene.parentOf(n);
  ED.isClone = n => String(n.id).includes('/');
  ED.isArtboard = n => n && n.type === 'frame' && ED.scene.parent[n.id] === '0';
  ED.isContainer = n => n && (n.type === 'frame' || n.type === 'group');
  ED.kids = n => ED.scene.kids(n);
  ED.selNodes = () => ED.sel.map(ED.get).filter(Boolean);
  ED.topInstance = n => ED.get(String(n.id).split('/')[0]);
  ED.ancestors = n => { const out = []; let p = ED.parent(n); while (p && p !== ED.doc) { out.push(p); p = ED.parent(p); } return out; };
  ED.isAncestor = (a, n) => ED.ancestors(n).includes(a);
  // top-most selected nodes (drop those whose ancestor is also selected)
  ED.selRoots = () => { const s = ED.selNodes(); return s.filter(n => !s.some(o => o !== n && ED.isAncestor(o, n))); };
  ED.siblings = n => { const p = ED.parent(n); return p ? ED.kids(p) : []; };
  // set a property, routing edits on instance contents into overrides
  ED.setProp = (n, key, val) => {
    if (ED.isClone(n)) {
      if (!LP.OVERRIDABLE.has(key)) return false;
      const top = ED.topInstance(n); const rel = String(n.id).slice(String(top.id).length + 1);
      top.overrides = top.overrides || {}; const o = (top.overrides[rel] = top.overrides[rel] || {}); o[key] = JSON.parse(JSON.stringify(val));
      if (n._nrel) o.__ = n._nrel;
      n[key] = val; return true;
    }
    n[key] = val; return true;
  };
  ED.canEdit = (n, key) => !ED.isClone(n) || LP.OVERRIDABLE.has(key);
  ED.removeNode = n => { const p = ED.parent(n); if (!p || ED.isClone(n)) return; const arr = p === ED.doc ? ED.doc.children : p.children; const i = arr.indexOf(n); if (i >= 0) arr.splice(i, 1); };
  ED.childArr = p => p === ED.doc ? ED.doc.children : p.children;

  /* ======================= matrices ======================= */
  ED.wm = new Map();
  ED.worldMatrix = n => {
    if (!n || n === ED.doc) return M.id();
    let m = ED.wm.get(n); if (m) return m;
    const p = ED.parent(n);
    m = M.mul(p && p !== ED.doc ? ED.worldMatrix(p) : M.id(), LP.localMatrix(n));
    ED.wm.set(n, m); return m;
  };
  ED.parentMatrix = n => { const p = ED.parent(n); return p && p !== ED.doc ? ED.worldMatrix(p) : M.id(); };
  ED.corners = n => { const m = ED.worldMatrix(n); return [[0, 0], [n.w, 0], [n.w, n.h], [0, n.h]].map(p => M.ap(m, p[0], p[1])); };
  ED.wbox = n => { const c = ED.corners(n); const xs = c.map(p => p.x), ys = c.map(p => p.y); const x = Math.min(...xs), y = Math.min(...ys); return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }; };
  ED.unionBox = ns => { if (!ns.length) return null; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; ns.forEach(n => { const b = ED.wbox(n); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }); return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
  // world point → local coords of a container (or root)
  ED.toLocal = (container, x, y) => (!container || container === ED.doc) ? { x, y } : M.ap(M.inv(ED.worldMatrix(container)), x, y);
  // move node so its unrotated box centre lands at world point (cx,cy) inside new parent space
  ED.placeCenter = (n, newParent, cx, cy) => { const p = ED.toLocal(newParent, cx, cy); n.x = p.x - n.w / 2; n.y = p.y - n.h / 2; };
  ED.centerWorld = n => M.ap(ED.worldMatrix(n), n.w / 2, n.h / 2);
  ED.reparent = (n, np, index) => {
    const c = ED.centerWorld(n);
    const pr = ED.worldRotation(ED.parent(n)), nr = ED.worldRotation(np);
    ED.removeNode(n);
    const arr = ED.childArr(np);
    if (index == null || index > arr.length) arr.push(n); else arr.splice(index, 0, n);
    n.r = ((n.r || 0) + pr - nr) % 360;
    ED.wm = new Map(); ED.scene.parent[n.id] = np === ED.doc ? '0' : np.id;
    ED.placeCenter(n, np, c.x, c.y);
  };
  ED.worldRotation = n => { let r = 0, p = n; while (p && p !== ED.doc) { r += p.r || 0; p = ED.parent(p); } return r; };

  /* ======================= view ======================= */
  ED.s2w = (sx, sy) => ({ x: (sx - ED.view.x) / ED.view.z, y: (sy - ED.view.y) / ED.view.z });
  ED.w2s = (x, y) => ({ x: x * ED.view.z + ED.view.x, y: y * ED.view.z + ED.view.y });
  ED.zoomAt = (z, sx, sy) => {
    z = Math.max(0.02, Math.min(64, z));
    const w = ED.s2w(sx, sy); ED.view.z = z; ED.view.x = sx - w.x * z; ED.view.y = sy - w.y * z;
    ED.redraw(); emit('view');
  };
  ED.zoomBy = f => { const r = ED.stage.getBoundingClientRect(); ED.zoomAt(ED.view.z * f, r.width / 2, r.height / 2); };
  ED.zoomToBox = (b, maxZ = 1, pad = 60) => {
    if (!b) return; const r = ED.stage.getBoundingClientRect();
    const z = Math.min(maxZ, (r.width - pad * 2) / Math.max(1, b.w), (r.height - pad * 2) / Math.max(1, b.h));
    ED.view.z = Math.max(0.02, z); ED.view.x = r.width / 2 - (b.x + b.w / 2) * ED.view.z; ED.view.y = r.height / 2 - (b.y + b.h / 2) * ED.view.z;
    ED.redraw(); emit('view');
  };
  ED.zoomFit = () => ED.zoomToBox(ED.unionBox(ED.doc.children.filter(n => n.visible !== false)), 1);
  ED.zoomSel = () => ED.zoomToBox(ED.unionBox(ED.selNodes()), 4);
  ED.zoom100 = () => { const r = ED.stage.getBoundingClientRect(); ED.zoomAt(1, r.width / 2, r.height / 2); };

  /* ======================= selection ======================= */
  ED.select = (ids, add) => {
    ids = ids.filter(Boolean).map(x => typeof x === 'object' ? x.id : x);
    if (add) { ids.forEach(id => { const i = ED.sel.indexOf(id); if (i >= 0) ED.sel.splice(i, 1); else ED.sel.push(id); }); }
    else ED.sel = ids;
    emit('sel'); ED.redraw();
  };
  // choose which node of a hit chain a click should select
  ED.pickTarget = (chain, deep) => {
    if (!chain) return null;
    const c = chain.slice().reverse();
    if (deep) { const d = chain[0]; return (ED.isArtboard(d) && ED.kids(d).length) ? null : d; }
    let i = 0;
    if (ED.isArtboard(c[0])) { if (c.length === 1) return ED.kids(c[0]).length ? null : c[0]; i = 1; }
    const anc = new Set(); ED.selNodes().forEach(n => ED.ancestors(n).forEach(a => anc.add(a.id)));
    while (i < c.length - 1 && anc.has(c[i].id) && !ED.sel.includes(c[i].id)) i++;
    return c[i];
  };
  const hitSkip = n => n.locked && !ED.isArtboard(n);
  ED.hitChain = (wx, wy, extra = {}) => LP.hitTest(ED.scene, ED.doc.children, wx, wy, Object.assign({ skip: hitSkip, tol: 3 / ED.view.z, matrix: null }, extra));

  /* ======================= rendering ======================= */
  let raf = 0;
  ED.redraw = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  LP.onImageLoad = () => { ED.redraw(); emit('images'); };
  ED.listeners.images = [];
  function draw() {
    const c = ED.canvas; if (!c) return;
    const r = ED.stage.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = ED.ctx; ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = ED.doc.bg || '#e8ecf1'; ctx.fillRect(0, 0, W, H);
    const z = ED.view.z;
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ED.view.x, dpr * ED.view.y);
    const vw = { x: -ED.view.x / z, y: -ED.view.y / z, w: r.width / z, h: r.height / z };
    const hide = ED.editing ? new Set([ED.editing.id]) : null;
    ED.doc.children.forEach(n => {
      const b = ED.wbox(n); if (b.x > vw.x + vw.w || b.y > vw.y + vw.h || b.x + b.w < vw.x || b.y + b.h < vw.y) return;
      if (ED.isArtboard(n) && n.visible !== false) { ctx.save(); ctx.shadowColor = 'rgba(20,40,70,.18)'; ctx.shadowBlur = 6 * dpr; ctx.shadowOffsetY = 1 * dpr; ctx.fillStyle = '#fff'; ctx.fillRect(n.x, n.y, n.w, n.h); ctx.restore(); }
      LP.drawNode(ctx, ED.scene, n, { hide, base: c });
    });
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawOverlay(ctx, r);
  }

  const BLUE = '#1f8bff', PURPLE = '#9747ff', RED = '#f24822', PINK = '#ff2d84';
  function strokePoly(ctx, pts, color, w = 1, dash) { ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = w; if (dash) ctx.setLineDash(dash); ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.closePath(); ctx.stroke(); ctx.restore(); }
  const sPts = n => ED.corners(n).map(p => ED.w2s(p.x, p.y));
  function label(ctx, txt, x, y, bg = RED, fg = '#fff') {
    ctx.save(); ctx.font = '600 10.5px "Segoe UI",sans-serif'; const w = ctx.measureText(txt).width + 8;
    ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(Math.round(x - w / 2), Math.round(y - 8), w, 16, 3); ctx.fill();
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(txt, Math.round(x), Math.round(y) + .5); ctx.restore();
  }
  ED.fmt = v => (Math.round(v * 100) / 100).toString();

  function drawOverlay(ctx, r) {
    const z = ED.view.z;
    // layout grids
    if (ED.showGrids) ED.scene && LP.walk(ED.doc, n => { if (n !== ED.doc && n.grids?.length && n.visible !== false) drawGrids(ctx, n); });
    // artboard titles
    ctx.save(); ctx.font = '11px "Segoe UI",sans-serif'; ctx.textBaseline = 'bottom';
    ED.doc.children.forEach(n => {
      if (n.type !== 'frame' || n.visible === false) return;
      const p = ED.w2s(n.x, n.y), selected = ED.sel.includes(n.id);
      let x = p.x;
      if (n.flowStart && ED.mode === 'proto') { ctx.save(); ctx.font = '600 10.5px "Segoe UI",sans-serif'; const fw = ctx.measureText('▶ ' + n.flowStart).width + 8; ctx.restore(); label(ctx, '▶ ' + n.flowStart, x + fw / 2, p.y - 27, BLUE); }
      ctx.fillStyle = n.component ? PURPLE : selected ? BLUE : '#5b6b7c';
      let t = (n.component ? '◆ ' : '') + n.name;
      const maxW = Math.max(30, n.w * z);
      while (ctx.measureText(t).width > maxW && t.length > 3) t = t.slice(0, -2);
      ctx.fillText(t, x, p.y - 4);
      n._titleW = ctx.measureText(t).width;
    });
    ctx.restore();
    // prototype viewport marker on scrollable artboards
    ED.doc.children.forEach(n => {
      if (n.type !== 'frame' || !(n.viewportH > 0 && n.viewportH < n.h) || n.visible === false) return;
      const a = ED.w2s(n.x, n.y + n.viewportH), b = ED.w2s(n.x + n.w, n.y + n.viewportH);
      ctx.save(); ctx.strokeStyle = 'rgba(31,139,255,.75)'; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(a.x, Math.round(a.y) + .5); ctx.lineTo(b.x, Math.round(b.y) + .5); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.font = '10px "Segoe UI",sans-serif'; ctx.fillStyle = 'rgba(31,139,255,.9)'; ctx.textAlign = 'right'; ctx.fillText('Viewport', b.x + 46, b.y + 3); ctx.restore();
    });
    // component frames (non top-level) get a purple outline on hover; instances on hover too
    const hv = ED.hover && ED.get(ED.hover);
    if (hv && !ED.sel.includes(hv.id) && !ED.drag) strokePoly(ctx, sPts(hv), hv.component || hv.type === 'instance' || ED.isClone(hv) ? PURPLE : BLUE, 1.5);
    // auto-layout hints for selected auto layout frame
    const sel = ED.selNodes();
    if (ED.mode === 'design' && sel.length === 1 && sel[0].type === 'frame' && sel[0].layout && !ED.drag) drawPadding(ctx, sel[0]);
    // selection
    if (sel.length) {
      const purple = sel.every(n => n.component || n.type === 'instance' || ED.isClone(n));
      const col = purple ? PURPLE : BLUE;
      sel.forEach(n => strokePoly(ctx, sPts(n), col, 1));
      if (ED.mode === 'design' && !ED.editing && !(ED.drag && ED.drag.kind === 'move')) {
        const H = ED.handles();
        if (H) {
          if (sel.length > 1) strokePoly(ctx, H.box, col, 1);
          ctx.save(); ctx.fillStyle = '#fff'; ctx.strokeStyle = col; ctx.lineWidth = 1;
          H.pts.forEach(h => { if (h.hidden) return; ctx.beginPath(); ctx.rect(Math.round(h.x) - 3.5, Math.round(h.y) - 3.5, 7, 7); ctx.fill(); ctx.stroke(); });
          ctx.restore();
          // size badge
          const b = ED.unionBox(sel), bp = ED.w2s(b.x + b.w / 2, b.y + b.h);
          if (b.w * z > 30 || ED.drag) label(ctx, `${ED.fmt(sel.length === 1 ? sel[0].w : b.w)} × ${ED.fmt(sel.length === 1 ? sel[0].h : b.h)}`, bp.x, bp.y + 16, col);
        }
      }
      // path point editing
      if (ED.pathEdit && sel.length === 1 && sel[0].id === ED.pathEdit) drawPathPoints(ctx, sel[0]);
    }
    // guides and distances
    if (ED.guides) drawGuides(ctx, ED.guides);
    // marquee
    if (ED.drag && ED.drag.kind === 'marquee') { const d = ED.drag, a = ED.w2s(d.x0, d.y0), b = ED.w2s(d.x1, d.y1); ctx.save(); ctx.fillStyle = 'rgba(31,139,255,.08)'; ctx.strokeStyle = BLUE; ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)); ctx.strokeRect(Math.min(a.x, b.x) + .5, Math.min(a.y, b.y) + .5, Math.abs(b.x - a.x), Math.abs(b.y - a.y)); ctx.restore(); }
    // creating shape preview
    if (ED.drag && ED.drag.kind === 'create' && ED.drag.box) { const b = ED.drag.box; const a = ED.w2s(b.x, b.y); ctx.save(); ctx.strokeStyle = BLUE; ctx.setLineDash([4, 3]); ED.drag.tool === 'ellipse' ? (ctx.beginPath(), ctx.ellipse(a.x + b.w * z / 2, a.y + b.h * z / 2, b.w * z / 2, b.h * z / 2, 0, 0, 7), ctx.stroke()) : ED.drag.tool === 'line' ? (ctx.beginPath(), ctx.moveTo(...Object.values(ED.w2s(ED.drag.x0, ED.drag.y0))), ctx.lineTo(...Object.values(ED.w2s(ED.drag.x1, ED.drag.y1))), ctx.stroke()) : ctx.strokeRect(a.x, a.y, b.w * z, b.h * z); ctx.restore(); label(ctx, `${ED.fmt(b.w)} × ${ED.fmt(b.h)}`, a.x + b.w * z / 2, a.y + b.h * z + 16, BLUE); }
    // auto layout reorder indicator
    if (ED.drag && ED.drag.insert) { const L = ED.drag.insert; ctx.save(); ctx.strokeStyle = PINK; ctx.lineWidth = 2.5; ctx.beginPath(); const a = ED.w2s(L.x0, L.y0), b = ED.w2s(L.x1, L.y1); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.restore(); }
    if (ED.drag && ED.drag.dropTarget) strokePoly(ctx, sPts(ED.drag.dropTarget), BLUE, 2);
    // pen preview
    if (ED.penPts) drawPen(ctx);
    // prototype wires
    if (ED.mode === 'proto') drawWires(ctx);
    // inspect measurements
    if ((ED.mode === 'inspect' || ED.altDown) && sel.length && hv && !sel.includes(hv) && !ED.drag) drawMeasure(ctx, ED.unionBox(sel), ED.wbox(hv));
  }
  function drawGrids(ctx, n) {
    const m = ED.worldMatrix(n), z = ED.view.z;
    ctx.save();
    const t = M.mul([z, 0, 0, z, ED.view.x, ED.view.y], m);
    ctx.transform(t[0], t[1], t[2], t[3], t[4], t[5]);
    ctx.beginPath(); ctx.rect(0, 0, n.w, n.h); ctx.clip();
    n.grids.forEach(g => {
      if (g.visible === false) return;
      ctx.fillStyle = LP.rgba(g.color || '#ff3b3b', g.a ?? .1); ctx.strokeStyle = LP.rgba(g.color || '#ff3b3b', .25); ctx.lineWidth = 1 / z;
      if (g.type === 'grid') { const s = g.size || 8; ctx.beginPath(); for (let x = s; x < n.w; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, n.h); } for (let y = s; y < n.h; y += s) { ctx.moveTo(0, y); ctx.lineTo(n.w, y); } ctx.stroke(); return; }
      const cols = g.type === 'columns', len = cols ? n.w : n.h, cnt = Math.max(1, g.count || 4), gut = g.gutter ?? 16, mar = g.margin ?? 16;
      const size = (len - mar * 2 - gut * (cnt - 1)) / cnt;
      for (let i = 0; i < cnt; i++) { const a = mar + i * (size + gut); cols ? ctx.fillRect(a, 0, size, n.h) : ctx.fillRect(0, a, n.w, size); }
    });
    ctx.restore();
  }
  ED.gridLines = n => { // snap lines from layout grids (world)
    const out = { x: [], y: [] }; if (!n?.grids?.length || n.r) return out;
    const o = M.ap(ED.worldMatrix(n), 0, 0);
    n.grids.forEach(g => {
      if (g.visible === false || g.type === 'grid') return;
      const cols = g.type === 'columns', len = cols ? n.w : n.h, cnt = Math.max(1, g.count || 4), gut = g.gutter ?? 16, mar = g.margin ?? 16, size = (len - mar * 2 - gut * (cnt - 1)) / cnt;
      for (let i = 0; i < cnt; i++) { const a = mar + i * (size + gut); (cols ? out.x : out.y).push((cols ? o.x : o.y) + a, (cols ? o.x : o.y) + a + size); }
    });
    return out;
  };
  function drawPadding(ctx, n) {
    const v = ED.scene.view(n), L = v.layout, pad = L.pad || [0, 0, 0, 0];
    if (n.r) return;
    const b = ED.wbox(n), z = ED.view.z;
    const a = ED.w2s(b.x, b.y);
    ctx.save(); ctx.fillStyle = 'rgba(255,45,132,.10)';
    ctx.fillRect(a.x, a.y, b.w * z, pad[0] * z); ctx.fillRect(a.x, a.y + (b.h - pad[2]) * z, b.w * z, pad[2] * z);
    ctx.fillRect(a.x, a.y, pad[3] * z, b.h * z); ctx.fillRect(a.x + (b.w - pad[1]) * z, a.y, pad[1] * z, b.h * z);
    // gaps
    const kids = ED.kids(n).filter(k => k.visible !== false && !k.absolute);
    ctx.fillStyle = 'rgba(255,45,132,.18)';
    for (let i = 1; i < kids.length; i++) {
      const p = ED.wbox(kids[i - 1]), q = ED.wbox(kids[i]);
      if (L.mode === 'h') { const x0 = p.x + p.w, x1 = q.x; if (x1 > x0) { const s = ED.w2s(x0, b.y + pad[0]); ctx.fillRect(s.x, s.y, (x1 - x0) * z, (b.h - pad[0] - pad[2]) * z); } }
      else { const y0 = p.y + p.h, y1 = q.y; if (y1 > y0) { const s = ED.w2s(b.x + pad[3], y0); ctx.fillRect(s.x, s.y, (b.w - pad[1] - pad[3]) * z, (y1 - y0) * z); } }
    }
    ctx.restore();
  }
  function drawGuides(ctx, G) {
    ctx.save(); ctx.strokeStyle = PINK; ctx.lineWidth = 1;
    (G.lines || []).forEach(l => { const a = ED.w2s(l.x0, l.y0), b = ED.w2s(l.x1, l.y1); ctx.beginPath(); ctx.moveTo(Math.round(a.x) + .5, Math.round(a.y) + .5); ctx.lineTo(Math.round(b.x) + .5, Math.round(b.y) + .5); ctx.stroke(); });
    (G.dists || []).forEach(d => {
      const a = ED.w2s(d.x0, d.y0), b = ED.w2s(d.x1, d.y1);
      ctx.beginPath(); ctx.moveTo(Math.round(a.x) + .5, Math.round(a.y) + .5); ctx.lineTo(Math.round(b.x) + .5, Math.round(b.y) + .5); ctx.stroke();
      // end ticks
      const vert = Math.abs(a.x - b.x) < .5;
      [a, b].forEach(p => { ctx.beginPath(); vert ? (ctx.moveTo(p.x - 3, p.y), ctx.lineTo(p.x + 3, p.y)) : (ctx.moveTo(p.x, p.y - 3), ctx.lineTo(p.x, p.y + 3)); ctx.stroke(); });
      label(ctx, ED.fmt(d.v), (a.x + b.x) / 2 + (vert ? 18 : 0), (a.y + b.y) / 2 + (vert ? 0 : -11), PINK);
    });
    ctx.restore();
  }
  // red measurement lines between selected box A and hovered box B (world)
  function drawMeasure(ctx, A, B) {
    const G = { dists: [], lines: [] };
    const ax1 = A.x + A.w, ay1 = A.y + A.h, bx1 = B.x + B.w, by1 = B.y + B.h;
    const midY = (Math.max(A.y, B.y) + Math.min(ay1, by1)) / 2, midX = (Math.max(A.x, B.x) + Math.min(ax1, bx1)) / 2;
    const inside = A.x >= B.x && A.y >= B.y && ax1 <= bx1 && ay1 <= by1;
    if (inside) {
      const cy = A.y + A.h / 2, cx = A.x + A.w / 2;
      G.dists.push({ x0: B.x, y0: cy, x1: A.x, y1: cy, v: A.x - B.x }, { x0: ax1, y0: cy, x1: bx1, y1: cy, v: bx1 - ax1 }, { x0: cx, y0: B.y, x1: cx, y1: A.y, v: A.y - B.y }, { x0: cx, y0: ay1, x1: cx, y1: by1, v: by1 - ay1 });
    } else {
      const yy = Math.max(A.y, B.y) < Math.min(ay1, by1) ? midY : A.y + A.h / 2;
      const xx = Math.max(A.x, B.x) < Math.min(ax1, bx1) ? midX : A.x + A.w / 2;
      if (bx1 <= A.x) G.dists.push({ x0: bx1, y0: yy, x1: A.x, y1: yy, v: A.x - bx1 });
      else if (B.x >= ax1) G.dists.push({ x0: ax1, y0: yy, x1: B.x, y1: yy, v: B.x - ax1 });
      if (by1 <= A.y) G.dists.push({ x0: xx, y0: by1, x1: xx, y1: A.y, v: A.y - by1 });
      else if (B.y >= ay1) G.dists.push({ x0: xx, y0: ay1, x1: xx, y1: B.y, v: B.y - ay1 });
      if (!G.dists.length) { // overlapping: edge distances
        G.dists.push({ x0: Math.min(A.x, B.x), y0: yy, x1: Math.max(A.x, B.x), y1: yy, v: Math.abs(A.x - B.x) }, { x0: xx, y0: Math.min(A.y, B.y), x1: xx, y1: Math.max(A.y, B.y), v: Math.abs(A.y - B.y) });
      }
    }
    G.dists = G.dists.filter(d => d.v > 0.01);
    ctx.save();
    const bp = ED.w2s(B.x, B.y); ctx.strokeStyle = RED; ctx.setLineDash([3, 3]); ctx.strokeRect(bp.x + .5, bp.y + .5, B.w * ED.view.z, B.h * ED.view.z); ctx.restore();
    ctx.save(); ctx.strokeStyle = RED; ctx.lineWidth = 1;
    G.dists.forEach(d => { const a = ED.w2s(d.x0, d.y0), b = ED.w2s(d.x1, d.y1); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); label(ctx, ED.fmt(d.v), (a.x + b.x) / 2, (a.y + b.y) / 2, RED); });
    ctx.restore();
  }
  ED.measure = (A, B) => { const out = []; const ax1 = A.x + A.w, bx1 = B.x + B.w, ay1 = A.y + A.h, by1 = B.y + B.h; if (bx1 <= A.x) out.push(['left', A.x - bx1]); if (B.x >= ax1) out.push(['right', B.x - ax1]); if (by1 <= A.y) out.push(['top', A.y - by1]); if (B.y >= ay1) out.push(['bottom', B.y - ay1]); return out; };

  /* ----- prototype wires ----- */
  ED.wireHandle = () => {
    const s = ED.selNodes(); if (s.length !== 1) return null;
    const b = ED.wbox(s[0]); const p = ED.w2s(b.x + b.w, b.y + b.h / 2); return { x: p.x + 10, y: p.y, n: s[0] };
  };
  function wirePath(ctx, a, b) {
    const dx = Math.max(40, Math.abs(b.x - a.x) * .45);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(a.x + dx, a.y, b.x - dx, b.y, b.x, b.y); ctx.stroke();
  }
  function drawWires(ctx) {
    const selIds = new Set(ED.sel);
    const items = [];
    Object.values(ED.scene.byId).forEach(n => {
      if (n === ED.doc) return;
      const ps = n.proto || (ED.isClone(n) ? null : null); if (!ps?.length) return;
      ps.forEach(p => { if ((p.action === 'navigate' || p.action === 'overlay') && p.target && ED.get(p.target)) items.push({ n, p }); });
    });
    items.forEach(({ n, p }) => {
      const t = ED.get(p.target), b = ED.wbox(n), tb = ED.wbox(t);
      const s = ED.w2s(b.x + b.w, b.y + b.h / 2), e = ED.w2s(tb.x, tb.y + Math.min(40, tb.h / 2));
      const active = selIds.has(n.id) || selIds.has(t.id) && false;
      ctx.save(); ctx.strokeStyle = active ? BLUE : 'rgba(31,139,255,.38)'; ctx.lineWidth = active ? 2 : 1.25;
      if (p.action === 'overlay') ctx.setLineDash([6, 4]);
      wirePath(ctx, s, e);
      ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.moveTo(e.x, e.y); ctx.lineTo(e.x - 8, e.y - 4.5); ctx.lineTo(e.x - 8, e.y + 4.5); ctx.fill();
      ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, 7); ctx.fill();
      if (active) label(ctx, ({ tap: 'Tap', hover: 'Hover', press: 'Press', delay: 'Delay', key: 'Key' }[p.trigger] || p.trigger), (s.x + e.x) / 2, (s.y + e.y) / 2 - 10, BLUE);
      ctx.restore();
    });
    const h = ED.wireHandle();
    if (h && !ED.isArtboard(h.n)) {
      ctx.save(); ctx.fillStyle = BLUE; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(h.x, h.y, 7, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(h.x - 2.5, h.y - 3.5); ctx.lineTo(h.x + 3, h.y); ctx.lineTo(h.x - 2.5, h.y + 3.5); ctx.stroke(); ctx.restore();
    }
    if (ED.drag && ED.drag.kind === 'wire') {
      const d = ED.drag; ctx.save(); ctx.strokeStyle = BLUE; ctx.lineWidth = 2; wirePath(ctx, d.s, d.e); ctx.restore();
      if (d.target) strokePoly(ctx, sPts(d.target), BLUE, 2.5);
    }
  }

  /* ----- pen ----- */
  function drawPen(ctx) {
    const pts = ED.penPts; if (!pts.length) return;
    ctx.save(); ctx.strokeStyle = BLUE; ctx.lineWidth = 1.5;
    const S = p => ED.w2s(p.x, p.y);
    ctx.beginPath(); const p0 = S(pts[0]); ctx.moveTo(p0.x, p0.y);
    const seg = (a, b) => { const A = S(a), Bp = S(b); const c1 = a.ox != null ? S({ x: a.ox, y: a.oy }) : A, c2 = b.ix != null ? S({ x: b.ix, y: b.iy }) : Bp; ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, Bp.x, Bp.y); };
    for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
    if (ED.penHover && !ED.drag) seg(pts[pts.length - 1], ED.penHover);
    ctx.stroke();
    pts.forEach((p, i) => {
      const s = S(p);
      if (p.ox != null) { const o = S({ x: p.ox, y: p.oy }), q = S({ x: p.ix, y: p.iy }); ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(o.x, o.y); ctx.stroke(); [o, q].forEach(h => { ctx.beginPath(); ctx.arc(h.x, h.y, 3, 0, 7); ctx.fillStyle = BLUE; ctx.fill(); }); }
      ctx.fillStyle = i === 0 ? BLUE : '#fff'; ctx.beginPath(); ctx.rect(s.x - 3.5, s.y - 3.5, 7, 7); ctx.fill(); ctx.stroke();
    });
    ctx.restore();
  }
  function drawPathPoints(ctx, n) {
    const m = ED.worldMatrix(n), sx = n.bw ? n.w / n.bw : 1, sy = n.bh ? n.h / n.bh : 1;
    const S = (x, y) => { const p = M.ap(m, x * sx, y * sy); return ED.w2s(p.x, p.y); };
    ctx.save(); ctx.strokeStyle = BLUE; ctx.lineWidth = 1;
    (n.pts || []).forEach(p => {
      const a = S(p.x, p.y);
      if (p.ox != null) { const o = S(p.ox, p.oy), q = S(p.ix ?? p.x, p.iy ?? p.y); ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(o.x, o.y); ctx.stroke(); [o, q].forEach(h => { ctx.beginPath(); ctx.arc(h.x, h.y, 3, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); }); }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.rect(a.x - 3.5, a.y - 3.5, 7, 7); ctx.fill(); ctx.stroke();
    });
    ctx.restore();
  }

  /* ======================= handles ======================= */
  ED.handles = () => {
    const sel = ED.selNodes(); if (!sel.length) return null;
    if (sel.some(n => ED.isClone(n))) return { pts: [], box: [] };
    let corners;
    if (sel.length === 1) corners = sPts(sel[0]);
    else { const b = ED.unionBox(sel); corners = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]].map(p => ED.w2s(p[0], p[1])); }
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const [a, b, c, d] = corners;
    const small = Math.hypot(b.x - a.x, b.y - a.y) < 24 || Math.hypot(d.x - a.x, d.y - a.y) < 24;
    const isText = sel.length === 1 && sel[0].type === 'text';
    const pts = [
      { k: 'nw', ...a }, { k: 'ne', ...b }, { k: 'se', ...c }, { k: 'sw', ...d },
      { k: 'n', ...mid(a, b), hidden: small }, { k: 'e', ...mid(b, c), hidden: small }, { k: 's', ...mid(c, d), hidden: small }, { k: 'w', ...mid(d, a), hidden: small }
    ];
    if (isText) pts.forEach(p => { if (p.k === 'n' || p.k === 's') p.hidden = true; });
    return { pts, box: corners };
  };
  function handleAt(sx, sy) {
    const H = ED.handles(); if (!H || !H.pts.length) return null;
    for (const h of H.pts) if (!h.hidden && Math.abs(h.x - sx) <= 6 && Math.abs(h.y - sy) <= 6) return { kind: "resize", k: h.k };
    // rotation zone: just outside corners (single selection)
    if (ED.selNodes().length === 1) for (const h of H.pts.slice(0, 4)) { const d = Math.hypot(h.x - sx, h.y - sy); if (d > 6 && d < 18) { const box = H.box; if (!pointInPoly({ x: sx, y: sy }, box)) return { kind: 'rotate', k: h.k }; } }
    return null;
  }
  function pointInPoly(p, poly) { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) c = !c; } return c; }
  const CURSORS = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };

  /* ======================= snapping ======================= */
  function snapTargets(exclude) {
    const xs = [], ys = [], boxes = [];
    const add = (b, kind) => { xs.push({ v: b.x, b }, { v: b.x + b.w / 2, b }, { v: b.x + b.w, b }); ys.push({ v: b.y, b }, { v: b.y + b.h / 2, b }, { v: b.y + b.h, b }); if (kind !== 'parent') boxes.push(b); };
    const parents = new Set();
    exclude.forEach(n => { const p = ED.parent(n); if (p && p !== ED.doc) parents.add(p); });
    const ex = new Set(exclude);
    const sibs = new Set();
    exclude.forEach(n => { const p = ED.parent(n); (p === ED.doc || !p ? ED.doc.children : ED.kids(p)).forEach(s => { if (!ex.has(s) && s.visible !== false) sibs.add(s); }); });
    sibs.forEach(s => add(ED.wbox(s)));
    parents.forEach(p => { add(ED.wbox(p), 'parent'); const g = ED.gridLines(p); g.x.forEach(v => xs.push({ v, b: null })); g.y.forEach(v => ys.push({ v, b: null })); });
    return { xs, ys, boxes };
  }
  // snap box b (world). returns {dx, dy, lines}
  function snapBox(b, T, which = { x: [0, .5, 1], y: [0, .5, 1] }) {
    const th = 6 / ED.view.z;
    let best = { x: null, y: null };
    which.x.forEach(f => { const v = b.x + b.w * f; T.xs.forEach(t => { const d = t.v - v; if (Math.abs(d) <= th && (!best.x || Math.abs(d) < Math.abs(best.x.d))) best.x = { d, v: t.v }; }); });
    which.y.forEach(f => { const v = b.y + b.h * f; T.ys.forEach(t => { const d = t.v - v; if (Math.abs(d) <= th && (!best.y || Math.abs(d) < Math.abs(best.y.d))) best.y = { d, v: t.v }; }); });
    return { dx: best.x ? best.x.d : 0, dy: best.y ? best.y.d : 0, sx: best.x?.v, sy: best.y?.v };
  }
  function guidesFor(b, T, sx, sy) {
    const lines = [], dists = [];
    const near = (a, c) => Math.abs(a - c) < 0.01;
    if (sx != null) { const ys = [b.y, b.y + b.h]; T.xs.filter(t => near(t.v, sx) && t.b).forEach(t => ys.push(t.b.y, t.b.y + t.b.h)); lines.push({ x0: sx, y0: Math.min(...ys), x1: sx, y1: Math.max(...ys) }); }
    if (sy != null) { const xs = [b.x, b.x + b.w]; T.ys.filter(t => near(t.v, sy) && t.b).forEach(t => xs.push(t.b.x, t.b.x + t.b.w)); lines.push({ x0: Math.min(...xs), y0: sy, x1: Math.max(...xs), y1: sy }); }
    // distance to nearest neighbours left/right/top/bottom
    let L = null, R = null, U = null, D = null;
    T.boxes.forEach(o => {
      const vOverlap = o.y < b.y + b.h && o.y + o.h > b.y, hOverlap = o.x < b.x + b.w && o.x + o.w > b.x;
      if (vOverlap) { if (o.x + o.w <= b.x + .01 && (!L || o.x + o.w > L.x + L.w)) L = o; if (o.x >= b.x + b.w - .01 && (!R || o.x < R.x)) R = o; }
      if (hOverlap) { if (o.y + o.h <= b.y + .01 && (!U || o.y + o.h > U.y + U.h)) U = o; if (o.y >= b.y + b.h - .01 && (!D || o.y < D.y)) D = o; }
    });
    const my = o => (Math.max(b.y, o.y) + Math.min(b.y + b.h, o.y + o.h)) / 2, mx = o => (Math.max(b.x, o.x) + Math.min(b.x + b.w, o.x + o.w)) / 2;
    if (L) dists.push({ x0: L.x + L.w, y0: my(L), x1: b.x, y1: my(L), v: b.x - L.x - L.w });
    if (R) dists.push({ x0: b.x + b.w, y0: my(R), x1: R.x, y1: my(R), v: R.x - b.x - b.w });
    if (U) dists.push({ x0: mx(U), y0: U.y + U.h, x1: mx(U), y1: b.y, v: b.y - U.y - U.h });
    if (D) dists.push({ x0: mx(D), y0: b.y + b.h, x1: mx(D), y1: D.y, v: D.y - b.y - b.h });
    // inside a parent frame: distances to parent edges when no neighbour on that side
    return { lines, dists: dists.filter(d => d.v > 0.01 && d.v < 2000) };
  }

  /* ======================= pointer handling ======================= */
  let spaceDown = false;
  ED.setTool = id => { ED.tool = id; ED.penPts = null; ED.pathEdit = null; if (ED.toolbox && ED.toolbox.get() !== id) ED.toolbox.set(id); ED.updateCursor(); emit('tool'); ED.redraw(); };
  ED.listeners.tool = [];
  ED.updateCursor = (c) => { if (!ED.canvas) return; ED.canvas.style.cursor = c || (spaceDown || ED.tool === 'hand' ? 'grab' : ED.tool === 'select' ? 'default' : ED.tool === 'text' ? 'text' : 'crosshair'); };
  const localPt = e => { const r = ED.canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };

  ED.initCanvas = (stage) => {
    ED.stage = stage;
    const c = ED.canvas = document.createElement('canvas'); c.id = 'canvas'; stage.appendChild(c);
    ED.ctx = c.getContext('2d');
    new ResizeObserver(() => ED.redraw()).observe(stage);
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    c.addEventListener('dblclick', onDbl);
    c.addEventListener('pointerleave', () => { if (!ED.drag) { ED.hover = null; ED.redraw(); } });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const p = localPt(e);
      if (e.ctrlKey || e.metaKey) ED.zoomAt(ED.view.z * Math.pow(1.0018, -e.deltaY * (e.deltaMode ? 30 : 1)), p.sx, p.sy);
      else { const dx = e.shiftKey ? e.deltaY : e.deltaX, dy = e.shiftKey ? 0 : e.deltaY; ED.view.x -= dx; ED.view.y -= dy; ED.redraw(); emit('view'); }
    }, { passive: false });
    c.addEventListener('contextmenu', e => { e.preventDefault(); ED.contextMenu?.(e); });
    addEventListener('keydown', e => {
      if (e.key === ' ' && !isTyping(e)) { if (!spaceDown) { spaceDown = true; ED.updateCursor(); } e.preventDefault(); }
      if (e.key === 'Alt') { ED.altDown = true; ED.redraw(); e.preventDefault(); }
    });
    addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; ED.updateCursor(); } if (e.key === 'Alt') { ED.altDown = false; ED.redraw(); } });
    addEventListener('blur', () => { spaceDown = false; ED.altDown = false; });
  };
  const isTyping = e => e.target.matches?.('input:not([type=range]):not([type=checkbox]),textarea,select,[contenteditable=true]');

  function onDown(e) {
    if (ED.editing) { ED.endTextEdit(); }
    ED.canvas.setPointerCapture(e.pointerId);
    const { sx, sy } = localPt(e), w = ED.s2w(sx, sy);
    if (e.button === 1 || e.button === 0 && (spaceDown || ED.tool === 'hand')) { ED.drag = { kind: 'pan', sx, sy, vx: ED.view.x, vy: ED.view.y }; ED.updateCursor('grabbing'); return; }
    if (e.button === 2) return;
    if (ED.mode === 'proto') return protoDown(e, sx, sy, w);
    if (ED.mode === 'inspect') { const ch = ED.hitChain(w.x, w.y); ED.select([ED.pickTarget(ch, true) || ED.pickTarget(ch)].filter(Boolean)); return; }
    const tool = ED.tool;
    if (tool === 'pen') return penDown(e, w);
    if (['rect', 'ellipse', 'frame', 'text', 'line'].includes(tool)) { ED.drag = { kind: 'create', tool, x0: w.x, y0: w.y, x1: w.x, y1: w.y, sx, sy }; return; }
    // select tool
    if (ED.pathEdit) { const ph = pathPointAt(sx, sy); if (ph) { ED.drag = { kind: 'pathpt', ...ph, start: JSON.stringify(ED.get(ED.pathEdit).pts) }; return; } }
    const h = handleAt(sx, sy);
    if (h) { startTransform(h, w, e); return; }
    // artboard title?
    const tnode = titleAt(sx, sy);
    if (tnode) { if (e.shiftKey) ED.select([tnode.id], true); else if (!ED.sel.includes(tnode.id)) ED.select([tnode.id]); startMove(w, e); return; }
    const chain = ED.hitChain(w.x, w.y);
    const t = ED.pickTarget(chain, e.ctrlKey || e.metaKey);
    if (t) {
      if (e.shiftKey) ED.select([t.id], true);
      else if (!ED.sel.includes(t.id)) ED.select([t.id]);
      if (e.altKey && ED.sel.includes(t.id)) duplicateForDrag();
      startMove(w, e);
    } else {
      if (!e.shiftKey) ED.select([]);
      ED.drag = { kind: 'marquee', x0: w.x, y0: w.y, x1: w.x, y1: w.y, base: e.shiftKey ? ED.sel.slice() : [] };
    }
  }
  function titleAt(sx, sy) {
    for (let i = ED.doc.children.length - 1; i >= 0; i--) {
      const n = ED.doc.children[i]; if (n.type !== 'frame' || n.visible === false) continue;
      const p = ED.w2s(n.x, n.y);
      if (sx >= p.x && sx <= p.x + Math.max(30, n._titleW || 60) && sy >= p.y - 18 && sy <= p.y - 1) return n;
    }
    return null;
  }
  function duplicateForDrag() {
    const roots = ED.selRoots().filter(n => !ED.isClone(n));
    const ids = [];
    roots.forEach(n => { const p = ED.parent(n); const c = LP.cloneFresh(n, {}); const arr = ED.childArr(p); arr.splice(arr.indexOf(n) + 1, 0, c); ids.push(c.id); });
    ED.update(); ED.sel = ids; emit('sel');
  }
  function startMove(w, e) {
    const roots = ED.selRoots().filter(n => !n.locked);
    if (!roots.length) return;
    if (roots.some(n => ED.isClone(n))) { ED.drag = { kind: 'noop' }; return; }
    ED.drag = { kind: 'move', x0: w.x, y0: w.y, moved: false, items: roots.map(n => ({ n, x: n.x, y: n.y, pm: M.inv(ED.parentMatrix(n)) })), box: ED.unionBox(roots), T: snapTargets(roots) };
  }
  function startTransform(h, w, e) {
    const sel = ED.selRoots();
    if (h.kind === 'rotate') {
      const n = sel[0], c = ED.centerWorld(n);
      ED.drag = { kind: 'rotate', n, c, a0: Math.atan2(w.y - c.y, w.x - c.x), r0: n.r || 0 };
      return;
    }
    if (sel.length === 1) {
      const n = sel[0];
      ED.drag = { kind: 'resize', k: h.k, n, start: { x: n.x, y: n.y, w: n.w, h: n.h, r: n.r || 0, auto: n.auto, sizeH: n.sizeH, sizeV: n.sizeV }, kids: n.children ? JSON.stringify(n.children) : null, pm: M.inv(ED.parentMatrix(n)), T: snapTargets([n]) };
    } else {
      const box = ED.unionBox(sel);
      ED.drag = { kind: 'mresize', k: h.k, box, items: sel.map(n => ({ n, b: ED.wbox(n), w: n.w, h: n.h, kids: n.children ? JSON.stringify(n.children) : null })) };
    }
  }

  function onMove(e) {
    const { sx, sy } = localPt(e), w = ED.s2w(sx, sy);
    ED.cursorWorld = w; emit('cursor');
    const d = ED.drag;
    if (!d) return hoverMove(e, sx, sy, w);
    switch (d.kind) {
      case 'pan': ED.view.x = d.vx + sx - d.sx; ED.view.y = d.vy + sy - d.sy; ED.redraw(); emit('view'); break;
      case 'marquee': {
        d.x1 = w.x; d.y1 = w.y;
        const b = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0) };
        // select top-level items, or children of artboards the marquee starts in
        const startAb = ED.doc.children.slice().reverse().find(n => ED.isArtboard(n) && n.visible !== false && inside(d.x0, d.y0, ED.wbox(n)));
        const pool = startAb ? ED.kids(startAb) : ED.doc.children;
        const hits = pool.filter(n => n.visible !== false && !n.locked && intersects(ED.wbox(n), b) && (startAb || !ED.isArtboard(n) || contains(b, ED.wbox(n))));
        ED.sel = d.base.concat(hits.map(n => n.id).filter(id => !d.base.includes(id))); emit('sel'); ED.redraw(); break;
      }
      case 'move': moveDrag(d, w, e); break;
      case 'resize': resizeDrag(d, w, e); break;
      case 'mresize': mresizeDrag(d, w, e); break;
      case 'rotate': {
        let a = (d.r0 + (Math.atan2(w.y - d.c.y, w.x - d.c.x) - d.a0) * 180 / Math.PI);
        if (e.shiftKey) a = Math.round(a / 15) * 15;
        a = ((a % 360) + 540) % 360 - 180;
        const n = d.n, c = ED.centerWorld(n); n.r = Math.round(a * 10) / 10; ED.wm = new Map(); ED.placeCenter(n, ED.parent(n), c.x, c.y);
        ED.live(); ED.updateCursor('crosshair'); break;
      }
      case 'create': {
        let x1 = w.x, y1 = w.y;
        if (e.shiftKey) { if (d.tool === 'line') { const a = Math.round(Math.atan2(y1 - d.y0, x1 - d.x0) / (Math.PI / 4)) * Math.PI / 4, L = Math.hypot(x1 - d.x0, y1 - d.y0); x1 = d.x0 + Math.cos(a) * L; y1 = d.y0 + Math.sin(a) * L; } else { const s = Math.max(Math.abs(x1 - d.x0), Math.abs(y1 - d.y0)); x1 = d.x0 + Math.sign(x1 - d.x0 || 1) * s; y1 = d.y0 + Math.sign(y1 - d.y0 || 1) * s; } }
        d.x1 = x1; d.y1 = y1; d.box = { x: Math.min(d.x0, x1), y: Math.min(d.y0, y1), w: Math.abs(x1 - d.x0), h: Math.abs(y1 - d.y0) };
        ED.redraw(); break;
      }
      case 'pen': { const p = d.pt; p.ox = w.x; p.oy = w.y; p.ix = 2 * p.x - w.x; p.iy = 2 * p.y - w.y; ED.redraw(); break; }
      case 'pathpt': pathPtDrag(d, w); break;
      case 'wire': {
        d.e = { x: sx, y: sy };
        const ch = ED.hitChain(w.x, w.y, { skip: n => n === d.n || ED.isAncestor(d.n, n) && false });
        const ab = ch ? ch[ch.length - 1] : null;
        d.target = ab && ED.isArtboard(ab) && ab !== ED.scene.top(d.n) ? ab : null;
        ED.redraw(); break;
      }
    }
  }
  const inside = (x, y, b) => x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h;
  const intersects = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const contains = (a, b) => b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;

  function hoverMove(e, sx, sy, w) {
    if (ED.tool === 'pen' && ED.penPts) { ED.penHover = w; ED.redraw(); return; }
    let cur = null;
    if (ED.mode === 'design' && ED.tool === 'select') { const h = handleAt(sx, sy); if (h) cur = h.kind === 'rotate' ? 'crosshair' : CURSORS[h.k]; }
    if (ED.mode === 'proto') { const h = ED.wireHandle(); if (h && Math.hypot(h.x - sx, h.y - sy) < 9) cur = 'pointer'; }
    ED.updateCursor(cur);
    let hv = null;
    if (ED.tool === 'select' || ED.mode !== 'design') {
      const ch = ED.hitChain(w.x, w.y);
      const t = ED.mode === 'inspect' || (ED.altDown) ? (ch ? ch[0] : null) : ED.pickTarget(ch, e.ctrlKey || e.metaKey);
      hv = t ? t.id : (titleAt(sx, sy)?.id || null);
    }
    if (hv !== ED.hover) { ED.hover = hv; ED.redraw(); }
    else if (ED.altDown) ED.redraw();
  }

  /* ----- move ----- */
  function moveDrag(d, w, e) {
    let dx = w.x - d.x0, dy = w.y - d.y0;
    if (!d.moved && Math.hypot(dx, dy) * ED.view.z < 3) return;
    d.moved = true;
    if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
    // auto layout reorder?
    const first = d.items[0].n, par = ED.parent(first);
    const pv = par && par !== ED.doc ? ED.scene.view(par) : null;
    if (pv && pv.layout && !first.absolute && d.items.length === 1 && !ED.isClone(par)) {
      const pb = ED.wbox(par);
      if (inside(w.x, w.y, { x: pb.x - 20, y: pb.y - 20, w: pb.w + 40, h: pb.h + 40 })) {
        const kids = ED.kids(par).filter(k => k !== first && k.visible !== false && !k.absolute);
        const H = pv.layout.mode === 'h';
        let idx = kids.length;
        for (let i = 0; i < kids.length; i++) { const b = ED.wbox(kids[i]); if ((H ? w.x < b.x + b.w / 2 : w.y < b.y + b.h / 2)) { idx = i; break; } }
        d.reorder = { par, idx };
        const ref = kids[idx] ? ED.wbox(kids[idx]) : null, prev = kids[idx - 1] ? ED.wbox(kids[idx - 1]) : null;
        const gapPos = ref && prev ? (H ? (prev.x + prev.w + ref.x) / 2 : (prev.y + prev.h + ref.y) / 2) : ref ? (H ? ref.x - 2 : ref.y - 2) : prev ? (H ? prev.x + prev.w + 2 : prev.y + prev.h + 2) : (H ? pb.x + 4 : pb.y + 4);
        d.insert = H ? { x0: gapPos, y0: pb.y + 4, x1: gapPos, y1: pb.y + pb.h - 4 } : { x0: pb.x + 4, y0: gapPos, x1: pb.x + pb.w - 4, y1: gapPos };
        ED.guides = null; ED.redraw(); return;
      }
    }
    d.reorder = null; d.insert = null;
    // snapping
    let b = { x: d.box.x + dx, y: d.box.y + dy, w: d.box.w, h: d.box.h };
    let gs = null;
    if (ED.snapOn && !e.ctrlKey) {
      const s = snapBox(b, d.T); dx += s.dx; dy += s.dy; b.x += s.dx; b.y += s.dy;
      gs = guidesFor(b, d.T, s.sx, s.sy);
    }
    ED.guides = gs;
    d.items.forEach(it => { const v = M.apv(it.pm, dx, dy); it.n.x = Math.round((it.x + v.x) * 100) / 100; it.n.y = Math.round((it.y + v.y) * 100) / 100; });
    // drop target highlight (reparent)
    d.dropTarget = null;
    const tgt = frameAt(w.x, w.y, new Set(d.items.map(i => i.n)));
    const cur = ED.parent(first);
    if (tgt !== (cur === ED.doc ? null : cur) && tgt && !d.items.some(i => ED.isArtboard(i.n))) d.dropTarget = tgt;
    ED.live();
  }
  // deepest frame (editable doc frame) under a world point, excluding nodes in `ex` and their descendants
  function frameAt(x, y, ex) {
    let found = null;
    const walk = (list) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const n = list[i];
        if (ex.has(n) || n.visible === false || n.type !== 'frame' || ED.isClone(n) || n.locked && !ED.isArtboard(n)) continue;
        const p = M.ap(M.inv(ED.worldMatrix(n)), x, y);
        if (p.x >= 0 && p.y >= 0 && p.x <= n.w && p.y <= n.h) { found = n; walk(n.children || []); return true; }
      }
      return false;
    };
    walk(ED.doc.children);
    return found;
  }
  ED.frameAt = frameAt;

  /* ----- resize ----- */
  function resizeDrag(d, w, e) {
    const n = d.n, s = d.start, k = d.k;
    const pp = M.ap(d.pm, w.x, w.y); // pointer in parent space
    // into the node's unrotated local frame (relative to original box origin)
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2, a = -(s.r || 0) * Math.PI / 180;
    const rx = pp.x - cx, ry = pp.y - cy;
    let qx = rx * Math.cos(a) - ry * Math.sin(a) + s.w / 2, qy = rx * Math.sin(a) + ry * Math.cos(a) + s.h / 2;
    // snap edges (unrotated only)
    let gs = null;
    if (!s.r && ED.snapOn && !e.ctrlKey) {
      const T = d.T, th = 6 / ED.view.z, pm0 = ED.parentMatrix(n), wp = M.ap(pm0, qx + s.x, qy + s.y);
      let best = null, bestY = null;
      if (/e|w/.test(k)) T.xs.forEach(t => { const dd = t.v - wp.x; if (Math.abs(dd) <= th && (!best || Math.abs(dd) < Math.abs(best))) best = dd; });
      if (/n|s/.test(k)) T.ys.forEach(t => { const dd = t.v - wp.y; if (Math.abs(dd) <= th && (!bestY || Math.abs(dd) < Math.abs(bestY))) bestY = dd; });
      if (best) qx += best; if (bestY) qy += bestY;
      if (best || bestY) gs = { lines: [] };
      if (best) gs.lines.push({ x0: wp.x + best, y0: wp.y - 2000, x1: wp.x + best, y1: wp.y + 2000 });
      if (bestY) gs.lines.push({ x0: wp.x - 2000, y0: wp.y + bestY, x1: wp.x + 2000, y1: wp.y + bestY });
    }
    ED.guides = gs;
    let l = 0, t = 0, r = s.w, b = s.h;
    if (k.includes('w')) l = qx; if (k.includes('e')) r = qx; if (k.includes('n')) t = qy; if (k.includes('s')) b = qy;
    if (e.altKey) { if (k.includes('w')) r = s.w - l; if (k.includes('e')) l = s.w - r; if (k.includes('n')) b = s.h - t; if (k.includes('s')) t = s.h - b; }
    if (r - l < 1) { if (k.includes('w')) l = r - 1; else r = l + 1; }
    if (b - t < 1) { if (k.includes('n')) t = b - 1; else b = t + 1; }
    if (e.shiftKey || n.lockRatio) {
      const ar = s.w / s.h; let W = r - l, Hh = b - t;
      if (k.length === 2) { if (W / Hh > ar) Hh = W / ar; else W = Hh * ar; }
      else if (k === 'e' || k === 'w') Hh = W / ar; else W = Hh * ar;
      if (k.includes('w')) l = r - W; else if (k === 'n' || k === 's') { const m = (l + r) / 2; l = m - W / 2; r = m + W / 2; } else r = l + W;
      if (k.includes('n')) t = b - Hh; else if (k === 'e' || k === 'w') { const m = (t + b) / 2; t = m - Hh / 2; b = m + Hh / 2; } else b = t + Hh;
    }
    const W = Math.round((r - l) * 100) / 100, Hh = Math.round((b - t) * 100) / 100;
    // new centre in parent space
    const ncx = (l + r) / 2 - s.w / 2, ncy = (t + b) / 2 - s.h / 2, ra = (s.r || 0) * Math.PI / 180;
    const pcx = cx + ncx * Math.cos(ra) - ncy * Math.sin(ra), pcy = cy + ncx * Math.sin(ra) + ncy * Math.cos(ra);
    n.w = W; n.h = Hh; n.x = Math.round((pcx - W / 2) * 100) / 100; n.y = Math.round((pcy - Hh / 2) * 100) / 100;
    if (n.type === 'text') { if (/e|w/.test(k) && n.auto === 'width') n.auto = 'height'; if (/n|s/.test(k)) n.auto = 'fixed'; }
    if (/e|w/.test(k) && n.sizeH === 'hug') n.sizeH = 'fixed';
    if (/n|s/.test(k) && n.sizeV === 'hug') n.sizeV = 'fixed';
    if (d.kids && !ED.scene.view(n).layout) {
      n.children = JSON.parse(d.kids);
      if (n.type === 'group') n.children.forEach(c => { c.cons = { h: 'scale', v: 'scale', _g: 1 }; });
      LP.applyConstraintsKids(null, n.children, s.w, s.h, W, Hh);
      if (n.type === 'group') { const orig = JSON.parse(d.kids); n.children.forEach((c, i) => c.cons = orig[i].cons); }
    }
    ED.live();
  }
  function mresizeDrag(d, w, e) {
    const B = d.box, k = d.k;
    let l = B.x, t = B.y, r = B.x + B.w, b = B.y + B.h;
    if (k.includes('w')) l = Math.min(w.x, r - 1); if (k.includes('e')) r = Math.max(w.x, l + 1); if (k.includes('n')) t = Math.min(w.y, b - 1); if (k.includes('s')) b = Math.max(w.y, t + 1);
    if (e.shiftKey) { const s = Math.max((r - l) / B.w, (b - t) / B.h); if (k.includes('w')) l = r - B.w * s; else r = l + B.w * s; if (k.includes('n')) t = b - B.h * s; else b = t + B.h * s; }
    const sx = (r - l) / B.w, sy = (b - t) / B.h;
    d.items.forEach(it => {
      const n = it.n, nb = it.b;
      const nw = Math.max(1, nb.w * sx), nh = Math.max(1, nb.h * sy);
      n.w = Math.max(1, it.w * sx); n.h = Math.max(1, it.h * sy);
      if (it.kids && !ED.scene.view(n).layout) { n.children = JSON.parse(it.kids); LP.applyConstraintsKids(null, n.children, it.w, it.h, n.w, n.h); }
      if (n.type === 'text' && n.auto === 'width') n.auto = 'height';
      ED.wm = new Map();
      ED.placeCenter(n, ED.parent(n), l + (nb.x - B.x) * sx + nw / 2, t + (nb.y - B.y) * sy + nh / 2);
    });
    ED.live();
  }

  /* ----- pen ----- */
  function penDown(e, w) {
    if (!ED.penPts) ED.penPts = [];
    const pts = ED.penPts;
    if (pts.length > 2) { const p0 = ED.w2s(pts[0].x, pts[0].y), s = ED.w2s(w.x, w.y); if (Math.hypot(p0.x - s.x, p0.y - s.y) < 8) { finishPen(true); return; } }
    const pt = { x: w.x, y: w.y };
    pts.push(pt); ED.drag = { kind: 'pen', pt }; ED.redraw();
  }
  function finishPen(closed) {
    const pts = ED.penPts; ED.penPts = null; ED.penHover = null;
    if (!pts || pts.length < 2) { ED.redraw(); return; }
    const all = []; pts.forEach(p => { all.push([p.x, p.y]); if (p.ox != null) all.push([p.ox, p.oy], [p.ix, p.iy]); });
    const x0 = Math.min(...all.map(a => a[0])), y0 = Math.min(...all.map(a => a[1])), x1 = Math.max(...all.map(a => a[0])), y1 = Math.max(...all.map(a => a[1]));
    const W = Math.max(1, x1 - x0), H = Math.max(1, y1 - y0);
    const par = frameAt(pts[0].x, pts[0].y, new Set()) || ED.doc;
    const o = ED.toLocal(par, x0, y0);
    const n = LP.node('path', { name: 'Path', x: o.x, y: o.y, w: W, h: H, bw: W, bh: H, closed, pts: pts.map(p => { const q = { x: p.x - x0, y: p.y - y0 }; if (p.ox != null) Object.assign(q, { ox: p.ox - x0, oy: p.oy - y0, ix: p.ix - x0, iy: p.iy - y0 }); return q; }) });
    if (closed) n.fills = [LP.solid('#c7d2fe')];
    ED.childArr(par).push(n); ED.sel = [n.id]; ED.commit('Pen path'); ED.setTool('select');
  }
  ED.finishPen = finishPen;
  function pathPointAt(sx, sy) {
    const n = ED.get(ED.pathEdit); if (!n) return null;
    const m = ED.worldMatrix(n), kx = n.bw ? n.w / n.bw : 1, ky = n.bh ? n.h / n.bh : 1;
    for (let i = 0; i < n.pts.length; i++) {
      const p = n.pts[i];
      for (const key of ['', 'o', 'i']) {
        const x = key ? p[key + 'x'] : p.x, y = key ? p[key + 'y'] : p.y; if (x == null) continue;
        const wp = M.ap(m, x * kx, y * ky), s = ED.w2s(wp.x, wp.y);
        if (Math.hypot(s.x - sx, s.y - sy) < 7) return { i, key, n };
      }
    }
    return null;
  }
  function pathPtDrag(d, w) {
    const n = d.n, m = M.inv(ED.worldMatrix(n)), kx = n.bw ? n.w / n.bw : 1, ky = n.bh ? n.h / n.bh : 1;
    const l = M.ap(m, w.x, w.y), x = l.x / kx, y = l.y / ky, p = n.pts[d.i];
    if (!d.key) { const dx = x - p.x, dy = y - p.y; p.x = x; p.y = y; if (p.ox != null) { p.ox += dx; p.oy += dy; p.ix += dx; p.iy += dy; } }
    else { p[d.key + 'x'] = x; p[d.key + 'y'] = y; const o = d.key === 'o' ? 'i' : 'o'; if (p[o + 'x'] != null) { p[o + 'x'] = 2 * p.x - x; p[o + 'y'] = 2 * p.y - y; } }
    ED.live();
  }
  // re-fit a path's box to its points after editing
  ED.normalizePath = n => {
    const kx = n.bw ? n.w / n.bw : 1, ky = n.bh ? n.h / n.bh : 1;
    const all = []; n.pts.forEach(p => { all.push([p.x * kx, p.y * ky]); if (p.ox != null) all.push([p.ox * kx, p.oy * ky], [p.ix * kx, p.iy * ky]); });
    const x0 = Math.min(...all.map(a => a[0])), y0 = Math.min(...all.map(a => a[1])), x1 = Math.max(...all.map(a => a[0])), y1 = Math.max(...all.map(a => a[1]));
    n.pts.forEach(p => { p.x = p.x * kx - x0; p.y = p.y * ky - y0; if (p.ox != null) { p.ox = p.ox * kx - x0; p.oy = p.oy * ky - y0; p.ix = p.ix * kx - x0; p.iy = p.iy * ky - y0; } });
    n.x += x0; n.y += y0; n.w = n.bw = Math.max(1, x1 - x0); n.h = n.bh = Math.max(1, y1 - y0);
  };

  /* ----- prototype mode pointer ----- */
  function protoDown(e, sx, sy, w) {
    const h = ED.wireHandle();
    if (h && Math.hypot(h.x - sx, h.y - sy) < 9 && !ED.isArtboard(h.n)) { ED.drag = { kind: 'wire', n: h.n, s: { x: h.x, y: h.y }, e: { x: sx, y: sy } }; return; }
    const tnode = titleAt(sx, sy);
    if (tnode) { ED.select([tnode.id]); return; }
    const ch = ED.hitChain(w.x, w.y);
    const t = ED.pickTarget(ch, e.ctrlKey || e.metaKey);
    ED.select(t ? [t.id] : []);
  }

  function onUp(e) {
    const d = ED.drag; ED.drag = null; ED.guides = null;
    if (!d) return;
    const { sx, sy } = localPt(e), w = ED.s2w(sx, sy);
    switch (d.kind) {
      case 'pan': ED.updateCursor(); break;
      case 'marquee': ED.redraw(); break;
      case 'move': {
        if (!d.moved) {
          // plain click on an already-selected item inside a multi-selection: select just it
          if (!e.shiftKey && ED.sel.length > 1) { const ch = ED.hitChain(w.x, w.y); const t = ED.pickTarget(ch, e.ctrlKey); if (t) ED.select([t.id]); }
          ED.redraw(); break;
        }
        if (d.reorder) {
          const n = d.items[0].n, { par, idx } = d.reorder;
          const arr = ED.childArr(par), others = arr.filter(k => k !== n && k.visible !== false && !k.absolute);
          const ref = others[idx];
          arr.splice(arr.indexOf(n), 1);
          if (ref) arr.splice(arr.indexOf(ref), 0, n); else arr.push(n);
          ED.commit('Reorder'); break;
        }
        if (d.dropTarget || d.items.some(it => { const p = ED.parent(it.n); return p !== ED.doc && !ED.isArtboard(it.n) && !intersects(ED.wbox(it.n), ED.wbox(p)); })) {
          const tgt = d.dropTarget || frameAt(w.x, w.y, new Set(d.items.map(i => i.n))) || ED.doc;
          d.items.forEach(it => {
            if (ED.isArtboard(it.n) || ED.parent(it.n) === tgt) return;
            const tv = tgt !== ED.doc ? ED.scene.view(tgt) : null;
            let idx;
            if (tv && tv.layout) { const H = tv.layout.mode === 'h'; const kids = ED.kids(tgt); idx = kids.findIndex(k => { const b = ED.wbox(k); return H ? w.x < b.x + b.w / 2 : w.y < b.y + b.h / 2; }); if (idx < 0) idx = undefined; }
            ED.reparent(it.n, tgt, idx);
          });
        }
        ED.commit('Move'); break;
      }
      case 'resize': case 'mresize': ED.commit('Resize'); break;
      case 'rotate': ED.commit('Rotate'); break;
      case 'create': createFromDrag(d); break;
      case 'pen': ED.redraw(); break;
      case 'pathpt': ED.normalizePath(d.n); ED.commit('Edit path'); break;
      case 'wire': {
        if (d.target) {
          const n = d.n; const ps = (ED.isClone(n) ? JSON.parse(JSON.stringify(n.proto || [])) : n.proto = n.proto || []);
          let p = ps.find(q => q.trigger === 'tap');
          if (!p) { p = { trigger: 'tap', action: 'navigate', trans: 'dissolve', ease: 'ease-out', dur: 300 }; ps.push(p); }
          if (p.action !== 'overlay') p.action = 'navigate';
          p.target = d.target.id;
          if (ED.isClone(n)) { if (!ED.setProp(n, 'proto', ps)) Aero.toast('Interactions on instance contents must be set on the main component'); }
          ED.commit('Connect');
        } else ED.redraw();
        break;
      }
    }
  }

  function createFromDrag(d) {
    const tool = d.tool; let b = d.box;
    const clicked = !b || b.w * ED.view.z < 3 && b.h * ED.view.z < 3;
    if (tool === 'text') {
      const par = frameAt(d.x0, d.y0, new Set()) || ED.doc;
      const o = ED.toLocal(par, d.x0, d.y0);
      const n = LP.node('text', { text: '', x: o.x, y: o.y - 2, name: 'Text', auto: clicked ? 'width' : 'height' });
      if (!clicked) { n.w = b.w; n.x = ED.toLocal(par, b.x, b.y).x; }
      ED.childArr(par).push(n); ED.update(); ED.sel = [n.id]; emit('sel');
      ED.setTool('select');
      ED.startTextEdit(n, true);
      return;
    }
    if (clicked) {
      if (tool === 'frame') { b = { x: d.x0, y: d.y0, w: 100, h: 100 }; }
      else if (tool === 'line') { ED.redraw(); return; }
      else b = { x: d.x0 - 50, y: d.y0 - 50, w: 100, h: 100 };
    }
    const parAt = tool === 'frame' ? frameAt(b.x, b.y, new Set()) : frameAt(d.x0, d.y0, new Set());
    const par = parAt || ED.doc;
    let n;
    if (tool === 'line') {
      const x0 = Math.min(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), W = Math.max(1, Math.abs(d.x1 - d.x0)), H = Math.max(1, Math.abs(d.y1 - d.y0));
      const o = ED.toLocal(par, x0, y0);
      n = LP.node('path', { name: 'Line', x: o.x, y: o.y, w: W, h: H, bw: W, bh: H, pts: [{ x: d.x0 - x0, y: d.y0 - y0 }, { x: d.x1 - x0, y: d.y1 - y0 }] });
    } else {
      const o = ED.toLocal(par, b.x, b.y);
      n = LP.node(tool, { x: Math.round(o.x), y: Math.round(o.y), w: Math.max(1, Math.round(b.w)), h: Math.max(1, Math.round(b.h)) });
      if (tool === 'frame') { n.name = par === ED.doc ? 'Artboard ' + (ED.doc.children.filter(x => x.type === 'frame').length + 1) : 'Frame'; }
    }
    // frames drawn around existing siblings adopt them
    ED.childArr(par).push(n);
    if (tool === 'frame' && !clicked) {
      ED.update();
      const sib = ED.childArr(par).filter(s => s !== n && !ED.isClone(s) && contains(ED.wbox(n), ED.wbox(s)));
      sib.forEach(s => ED.reparent(s, n));
    }
    ED.sel = [n.id]; ED.commit('Create ' + (LP.TYPE_NAMES[n.type] || n.type).toLowerCase()); ED.setTool('select');
  }

  function onDbl(e) {
    if (ED.mode !== 'design') return;
    const { sx, sy } = localPt(e), w = ED.s2w(sx, sy);
    if (ED.tool === 'pen' && ED.penPts) { ED.penPts.pop(); finishPen(false); return; }
    const tnode = titleAt(sx, sy);
    if (tnode) { ED.renameNode?.(tnode); return; }
    const chain = ED.hitChain(w.x, w.y); if (!chain) return;
    const cur = ED.selNodes()[0];
    if (cur && cur.type === 'text' && chain.includes(cur)) { ED.startTextEdit(cur); return; }
    if (cur && cur.type === 'path' && cur.pts?.length && !cur.d && chain.includes(cur) && !ED.isClone(cur)) { ED.pathEdit = cur.id; ED.redraw(); Aero.toast('Drag points or handles. Press Esc when done.'); return; }
    // drill one level deeper
    const c = chain.slice().reverse();
    const i = cur ? c.indexOf(cur) : -1;
    const next = i >= 0 && i < c.length - 1 ? c[i + 1] : ED.pickTarget(chain);
    if (next) { ED.select([next.id]); if (next.type === 'text' && i >= 0 && i === c.length - 2) ED.startTextEdit(next); }
  }

  /* ======================= text editing ======================= */
  ED.startTextEdit = (n, fresh) => {
    if (n.locked) return;
    if (ED.isClone(n) && !LP.OVERRIDABLE.has('text')) return;
    ED.endTextEdit();
    const ta = document.createElement('textarea'); ta.className = 'lp-textedit'; ta.spellcheck = false;
    ta.value = n.text || '';
    ED.stage.appendChild(ta);
    ED.editing = { id: n.id, ta, fresh, orig: n.text };
    const sync = () => {
      const t = LP.textProps(ED.scene.view(n), ED.doc), z = ED.view.z;
      const m = ED.worldMatrix(n);
      const fill = (n.fills || []).find(f => f.type === 'solid' && f.on !== false);
      Object.assign(ta.style, {
        left: '0px', top: '0px', width: (n.auto === 'width' ? Math.max(n.w, 4) + t.size : n.w) + 'px', height: Math.max(n.h, LP.lineHeight(t)) + 'px',
        transform: `matrix(${m[0] * z},${m[1] * z},${m[2] * z},${m[3] * z},${m[4] * z + ED.view.x},${m[5] * z + ED.view.y})`,
        font: LP.fontString(t), lineHeight: LP.lineHeight(t) + 'px', letterSpacing: (t.ls || 0) + 'px', textAlign: n.align === 'justify' ? 'justify' : n.align,
        color: fill ? LP.rgba(LP.fillColor(fill, ED.doc).color, 1) : '#000', whiteSpace: n.auto === 'width' ? 'pre' : 'pre-wrap', textTransform: n.tcase === 'upper' ? 'uppercase' : n.tcase === 'lower' ? 'lowercase' : 'none'
      });
    };
    ta.addEventListener('input', () => { ED.setProp(n, 'text', ta.value); n.text = ta.value; ED.update(); const nn = ED.get(n.id); if (nn) n = nn; ED.editing.node = n; sync(); ED.redraw(); });
    ta.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); ED.endTextEdit(); } });
    ta.addEventListener('blur', () => setTimeout(() => { if (ED.editing && ED.editing.ta === ta) ED.endTextEdit(); }, 0));
    ED.update(); sync(); ED.redraw();
    setTimeout(() => { ta.focus(); if (!fresh) ta.select(); }, 0);
    ED.editing.sync = sync;
  };
  ED.endTextEdit = () => {
    const ed = ED.editing; if (!ed) return;
    ED.editing = null; ed.ta.remove();
    const n = ED.get(ed.id);
    if (n && !String(n.text || '').trim() && ed.fresh && !ED.isClone(n)) { ED.removeNode(n); ED.sel = []; ED.update(); emit('sel'); ED.redraw(); return; }
    if (n && n.text !== ed.orig) ED.commit('Edit text'); else ED.redraw();
  };
  on('view', () => ED.editing?.sync?.());
})();
