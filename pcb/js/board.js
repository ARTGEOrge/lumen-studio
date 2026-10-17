// Lumen PCB board editor: place footprints, route tracks on two layers, vias, ratsnest and DRC markers.
(function () {
  const Core = window.PcbCore;
  let A, view, mouse = [0, 0], route = null, drag = null, measure = null;
  const COL = { bg: '#0d1117', board: '#0f3d1f', edge: '#e8d44d', top: '#d9342b', bottom: '#2f6fdb', pad: '#c9a23a', silk: '#f2f2f2', rats: '#e8e8e8', hole: '#0d1117', sel: '#ffffff', err: '#ff4fd8', via: '#b8b8b8' };
  const grid = () => A.grid || 0.635;
  const snap = v => Math.round(v / grid()) * grid();

  function netOfPad(ref, n) { return A.pinNet.get(ref + '.' + n) || null; }

  function draw() {
    const g = view.begin(); g.fillStyle = COL.bg; g.fillRect(0, 0, view.w, view.h);
    view.world(); g.lineCap = 'round'; g.lineJoin = 'round';
    const b = A.doc.board, vis = A.layers;
    g.fillStyle = COL.board; g.fillRect(0, 0, b.w, b.h);
    // grid dots
    if (view.scale * grid() >= 6) { g.fillStyle = 'rgba(255,255,255,.12)'; const [x0, y0] = view.toWorld(0, 0), [x1, y1] = view.toWorld(view.w, view.h); const s = grid() * (view.scale * grid() < 12 ? 2 : 1); const d = 1.2 / view.scale;
      for (let x = Math.max(0, Math.floor(x0 / s) * s); x <= Math.min(b.w, x1); x += s) for (let y = Math.max(0, Math.floor(y0 / s) * s); y <= Math.min(b.h, y1); y += s) g.fillRect(x - d / 2, y - d / 2, d, d); }
    const order = A.layer === 'top' ? ['bottom', 'top'] : ['top', 'bottom'];
    const selNet = A.sel && A.sel.net;
    order.forEach(layer => {
      if (!vis[layer]) return; const alpha = layer === A.layer ? 1 : 0.55;
      (b.zones || []).filter(z => z.layer === layer).forEach(z => { g.globalAlpha = alpha * 0.55; g.fillStyle = COL[layer]; g.beginPath(); Core.zoneRects(Core.fillZone(b, z, A.pinNet)).forEach(([x0, y0, x1, y1]) => g.rect(x0, y0 - 0.01, x1 - x0, y1 - y0 + 0.02)); g.fill(); });   // one path: no seams
      g.globalAlpha = alpha;
      b.tracks.forEach((t, i) => { if (t.layer !== layer) return; const sel = A.sel && A.sel.kind === 'track' && A.sel.i === i; g.strokeStyle = sel ? COL.sel : COL[layer]; g.lineWidth = t.w; if (selNet && t.net === selNet && !sel) g.strokeStyle = '#ffb3ae'; g.beginPath(); t.pts.forEach((p, k) => k ? g.lineTo(...p) : g.moveTo(...p)); g.stroke(); });
      g.globalAlpha = 1;
    });
    // pads
    b.parts.forEach((fp, fi) => Core.padsOf(fp).forEach(p => {
      if (!p.layers.some(l => vis[l])) return;
      const smdOther = p.layers.length === 1 && p.layers[0] !== A.layer;
      g.fillStyle = smdOther ? COL[p.layers[0]] : COL.pad; if (selNet && netOfPad(p.ref, p.n) === selNet) g.fillStyle = '#ffe08a';
      g.globalAlpha = smdOther ? 0.6 : 1;
      g.beginPath();
      if (p.shape === 'round') g.arc(p.x, p.y, p.w / 2, 0, 7);
      else if (p.shape === 'oval') { const r = Math.min(p.w, p.h) / 2; g.roundRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, r); }
      else g.rect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
      g.fill(); g.globalAlpha = 1;
      if (p.drill) { g.fillStyle = COL.hole; g.beginPath(); g.arc(p.x, p.y, p.drill / 2, 0, 7); g.fill(); }
      if (view.scale > 14 && Math.min(p.w, p.h) * view.scale > 14) { g.fillStyle = '#1b1b1b'; g.font = `${Math.min(p.w, p.h) * 0.5}px Segoe UI`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p.n, p.x, p.y); }
    }));
    b.vias.forEach((v, i) => { const sel = A.sel && A.sel.kind === 'via' && A.sel.i === i; g.fillStyle = sel ? COL.sel : COL.via; g.beginPath(); g.arc(v.x, v.y, v.dia / 2, 0, 7); g.fill(); g.fillStyle = COL.hole; g.beginPath(); g.arc(v.x, v.y, v.drill / 2, 0, 7); g.fill(); });
    // silk + refs
    if (vis.silk) b.parts.forEach((fp, i) => {
      const sel = A.sel && A.sel.kind === 'fp' && A.sel.i === i; g.strokeStyle = sel ? '#7fd3ff' : fp.side === 'bottom' ? '#9aa6b4' : COL.silk; g.lineWidth = 0.15;
      g.beginPath(); Core.silkOf(fp).forEach(([a, c]) => { g.moveTo(...a); g.lineTo(...c); }); g.stroke();
      const bb = fpBox(fp); g.fillStyle = g.strokeStyle; g.font = '1.1px Segoe UI'; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(fp.ref, (bb[0] + bb[2]) / 2, bb[1] - 0.2);
      if (sel) { g.setLineDash([0.4, 0.3]); g.lineWidth = 0.08; g.strokeRect(bb[0], bb[1], bb[2] - bb[0], bb[3] - bb[1]); g.setLineDash([]); }
    });
    // outline
    g.strokeStyle = COL.edge; g.lineWidth = 0.15; g.strokeRect(0, 0, b.w, b.h);
    // ratsnest
    if (vis.rats) { g.strokeStyle = COL.rats; g.lineWidth = 1 / view.scale; g.globalAlpha = 0.8; g.beginPath(); A.rats.lines.forEach(l => { g.moveTo(l.x1, l.y1); g.lineTo(l.x2, l.y2); }); g.stroke(); g.globalAlpha = 1; }
    // DRC markers
    if (A.mode === 'pcb') A.messages.filter(m => m.x != null && m.type !== 'Unrouted').forEach(m => { const r = 7 / view.scale; g.strokeStyle = COL.err; g.lineWidth = 2 / view.scale; g.beginPath(); g.arc(m.x, m.y, r, 0, 7); g.moveTo(m.x - r * .6, m.y - r * .6); g.lineTo(m.x + r * .6, m.y + r * .6); g.stroke(); });
    // routing preview
    if (route) {
      const pts = routePreview(); g.strokeStyle = COL[route.layer]; g.globalAlpha = 0.85; g.lineWidth = route.w; g.beginPath(); pts.forEach((p, k) => k ? g.lineTo(...p) : g.moveTo(...p)); g.stroke(); g.globalAlpha = 1;
      g.strokeStyle = '#fff'; g.lineWidth = 1 / view.scale; g.beginPath(); g.arc(...pts[pts.length - 1], route.w / 2 + A.doc.board.rules.clearance, 0, 7); g.stroke();
    }
    if (measure) { const [a, c] = [measure.a, measure.b || mouse.map(snap)]; g.strokeStyle = '#7fd3ff'; g.lineWidth = 1.5 / view.scale; g.beginPath(); g.moveTo(...a); g.lineTo(...c); g.stroke(); g.fillStyle = '#7fd3ff'; g.font = `${12 / view.scale}px Segoe UI`; g.textAlign = 'left'; g.fillText(`${Math.hypot(c[0] - a[0], c[1] - a[1]).toFixed(3)} mm  (dx ${(c[0] - a[0]).toFixed(2)}, dy ${(c[1] - a[1]).toFixed(2)})`, c[0] + 8 / view.scale, c[1] - 6 / view.scale); }
    const [mx, my] = mouse.map(snap);
    if (A.tool !== 'select') { g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1 / view.scale; const r = 8 / view.scale; g.beginPath(); g.moveTo(mx - r, my); g.lineTo(mx + r, my); g.moveTo(mx, my - r); g.lineTo(mx, my + r); g.stroke(); }
    A.status(`x ${mx.toFixed(3)}  y ${my.toFixed(3)} mm`);
  }
  function fpBox(fp) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    Core.padsOf(fp).forEach(p => { add(p.x - p.w / 2, p.y - p.h / 2); add(p.x + p.w / 2, p.y + p.h / 2); }); Core.silkOf(fp).forEach(([a, c]) => { add(...a); add(...c); });
    return [x0 - 0.2, y0 - 0.2, x1 + 0.2, y1 + 0.2];
  }

  // 45° routing: straight along the dominant axis, then a diagonal into the cursor (Space-free toggle with "/")
  function routePreview() {
    const last = route.pts[route.pts.length - 1]; let [mx, my] = route.snapTo || mouse.map(snap);
    const dx = mx - last[0], dy = my - last[1], adx = Math.abs(dx), ady = Math.abs(dy);
    let corner;
    if (route.diagFirst) { const d = Math.min(adx, ady); corner = [last[0] + Math.sign(dx) * d, last[1] + Math.sign(dy) * d]; }
    else corner = adx > ady ? [mx - Math.sign(dx) * ady, last[1]] : [last[0], my - Math.sign(dy) * adx];
    return [...route.pts, corner, [mx, my]];
  }
  function padAt(x, y, layer) {
    const b = A.doc.board;
    for (const fp of b.parts) for (const p of Core.padsOf(fp)) { if (layer && !p.layers.includes(layer)) continue; if (Math.abs(x - p.x) <= p.w / 2 && Math.abs(y - p.y) <= p.h / 2) return p; }
    return null;
  }
  function trackAt(x, y, layer) {
    const b = A.doc.board;
    for (let i = b.tracks.length - 1; i >= 0; i--) { const t = b.tracks[i]; if (layer && t.layer !== layer) continue; for (let k = 1; k < t.pts.length; k++) if (Core.gap({ core: [t.pts[k - 1], t.pts[k]], r: t.w / 2 }, { core: [[x, y]], r: 0 }) <= 0.05) return { i, k }; }
    return null;
  }
  function viaAt(x, y) { const b = A.doc.board; return b.vias.findIndex(v => Math.hypot(v.x - x, v.y - y) <= v.dia / 2); }
  function netAt(x, y, layer) {
    const p = padAt(x, y, layer); if (p) return netOfPad(p.ref, p.n);
    const t = trackAt(x, y, layer); if (t) return A.doc.board.tracks[t.i].net;
    const v = viaAt(x, y); if (v >= 0) return A.doc.board.vias[v].net; return null;
  }

  function commitRoute(final) {
    if (!route) return; const pts = []; route.pts.forEach(p => { const q = [+p[0].toFixed(4), +p[1].toFixed(4)]; if (!pts.length || pts[pts.length - 1][0] !== q[0] || pts[pts.length - 1][1] !== q[1]) pts.push(q); });
    const r = route; route = null;
    if (pts.length >= 2) A.commit('Route track', d => { d.board.tracks.push({ layer: r.layer, w: r.w, net: r.net, pts }); (r.vias || []).forEach(v => d.board.vias.push(v)); });
    else if ((r.vias || []).length) A.commit('Add via', d => r.vias.forEach(v => d.board.vias.push(v)));
    else draw();
  }

  function onDown(e) {
    if (e.button !== 0 || view.space) return;
    const [x, y] = view.eventWorld(e); mouse = [x, y]; const sx = snap(x), sy = snap(y);
    if (A.tool === 'route') {
      const pad = padAt(x, y, A.layer), here = pad ? [pad.x, pad.y] : [sx, sy];
      if (!route) { const net = netAt(x, y, A.layer); route = { pts: [here], layer: A.layer, w: A.routeWidth(net), net, vias: [] }; A.select(net ? { net } : null); draw(); return; }
      route.snapTo = pad ? here : null; const pts = routePreview(); route.snapTo = null; route.pts = pts;
      const endNet = pad ? netOfPad(pad.ref, pad.n) : null;
      if (!route.net && endNet) route.net = endNet;
      if (pad || (trackAt(...here, route.layer) && route.pts.length > 2)) commitRoute(true); else draw();
      return;
    }
    if (A.tool === 'via') { const net = netAt(sx, sy, null); A.commit('Add via', d => d.board.vias.push({ x: sx, y: sy, dia: A.doc.board.rules.viaDia || 0.8, drill: A.doc.board.rules.viaDrill || 0.4, net })); return; }
    if (A.tool === 'measure') { if (!measure || measure.b) measure = { a: [sx, sy] }; else measure.b = [sx, sy]; draw(); return; }
    // select
    const b = A.doc.board, v = viaAt(x, y);
    if (v >= 0) { A.select({ kind: 'via', i: v, net: b.vias[v].net }); drag = { kind: 'via', i: v, sx, sy, ox: b.vias[v].x, oy: b.vias[v].y, before: JSON.stringify(A.doc) }; return; }
    const fi = b.parts.map((fp, i) => [fp, i]).reverse().find(([fp]) => { const bb = fpBox(fp); return x >= bb[0] && x <= bb[2] && y >= bb[1] && y <= bb[3]; });
    const pad = padAt(x, y, null);
    if (fi) { A.select({ kind: 'fp', i: fi[1], net: pad ? netOfPad(pad.ref, pad.n) : null }); drag = { kind: 'fp', i: fi[1], sx, sy, ox: fi[0].x, oy: fi[0].y, before: JSON.stringify(A.doc) }; return; }
    const t = trackAt(x, y, A.layer) || trackAt(x, y, null);
    if (t) { A.select({ kind: 'track', i: t.i, net: b.tracks[t.i].net }); return; }
    A.select(null);
  }
  function onMove(e) {
    const [x, y] = view.eventWorld(e); mouse = [x, y];
    if (drag) { const b = A.doc.board, o = drag.kind === 'fp' ? b.parts[drag.i] : b.vias[drag.i]; const nx = drag.ox + snap(x) - drag.sx, ny = drag.oy + snap(y) - drag.sy; if (nx !== o.x || ny !== o.y) { o.x = +nx.toFixed(4); o.y = +ny.toFixed(4); drag.moved = true; A.refreshRats(); } }
    draw();
  }
  function onUp() { if (drag) { const d = drag; drag = null; if (d.moved) A.commitMoved('Move', d.before); } }

  function placeVia() { // during routing: drop a via at the current end and switch layer
    if (!route) { A.setTool('via'); return; }
    const pts = routePreview(); route.pts = pts; const end = pts[pts.length - 1];
    route.vias.push({ x: end[0], y: end[1], dia: A.doc.board.rules.viaDia || 0.8, drill: A.doc.board.rules.viaDrill || 0.4, net: route.net });
    const keep = { ...route }; commitRoute();
    A.layer = keep.layer === 'top' ? 'bottom' : 'top'; A.syncLayerUI();
    route = { pts: [end], layer: A.layer, w: keep.w, net: keep.net, vias: [] }; draw();
  }
  function rotateSel(dir = 1) { if (!A.sel || A.sel.kind !== 'fp') return; A.commit('Rotate', d => { const p = d.board.parts[A.sel.i]; p.rot = (((p.rot || 0) + 90 * dir) % 360 + 360) % 360; }); }
  function flipSel() { if (!A.sel || A.sel.kind !== 'fp') return; A.commit('Flip side', d => { const p = d.board.parts[A.sel.i]; p.side = p.side === 'bottom' ? 'top' : 'bottom'; }); }
  function cancel() { if (route) { if (route.pts.length >= 2) commitRoute(); else { route = null; draw(); } return true; } if (measure) { measure = null; draw(); return true; } if (A.tool !== 'select') { A.setTool('select'); return true; } return false; }
  function fit() { const b = A.doc.board; view.fit(-3, -3, b.w + 3, b.h + 3); }
  function attach(app, canvas) {
    A = app;
    view = new window.PcbView(canvas, { scale: 12, min: 1, max: 400, onChange: () => A.mode === 'pcb' && draw() });
    canvas.addEventListener('pointerdown', e => A.mode === 'pcb' && onDown(e));
    canvas.addEventListener('pointermove', e => A.mode === 'pcb' && onMove(e));
    addEventListener('pointerup', e => A.mode === 'pcb' && onUp(e));
    canvas.addEventListener('dblclick', e => { if (A.mode === 'pcb' && route) commitRoute(); });
  }
  window.BoardEditor = { attach, draw, fit, rotateSel, flipSel, cancel, placeVia, toggleBend: () => { if (route) { route.diagFirst = !route.diagFirst; draw(); } }, get view() { return view; }, get routing() { return !!route; } };
})();
