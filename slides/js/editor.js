'use strict';
/* Lumen Slides — stage interaction: selection, move/resize/rotate with smart guides & snapping, drawing tools,
   in-place rich-text editing (contenteditable overlay mapped to/from the text model), table cells, clipboard, keys. */
const Editor = (() => {
  const M = Model, PT = Render.PT;
  const rad = d => d * Math.PI / 180;
  const rotP = (x, y, r) => [x * Math.cos(r) - y * Math.sin(r), x * Math.sin(r) + y * Math.cos(r)];
  const isText = o => o && o.type === 'shape' && !(o.ph && o.ph.type === 'pic') && o.geom !== 'line';

  /* ---------- geometry ---------- */
  function lineEnds(o) {
    let x0 = o.x, y0 = o.y, x1 = o.x + o.w, y1 = o.y + o.h;
    if (o.flipH) [x0, x1] = [x1, x0]; if (o.flipV) [y0, y1] = [y1, y0];
    if (o.rot) { const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = rad(o.rot); const a = rotP(x0 - cx, y0 - cy, r), b = rotP(x1 - cx, y1 - cy, r); return [[cx + a[0], cy + a[1]], [cx + b[0], cy + b[1]]]; }
    return [[x0, y0], [x1, y1]];
  }
  function setLine(o, a, b) { o.rot = 0; o.x = Math.min(a[0], b[0]); o.y = Math.min(a[1], b[1]); o.w = Math.abs(b[0] - a[0]); o.h = Math.abs(b[1] - a[1]); o.flipH = a[0] > b[0] || undefined; o.flipV = a[1] > b[1] || undefined; }
  function segDist(px, py, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((px - a[0]) * dx + (py - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy); }
  function hitObj(o, x, y, tol) {
    if (o.type === 'shape' && o.geom === 'line') { const [a, b] = lineEnds(o); return segDist(x, y, a, b) <= tol + (o.line ? o.line.w / 2 : 1); }
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2, [lx, ly] = rotP(x - cx, y - cy, -rad(o.rot || 0));
    return Math.abs(lx) <= o.w / 2 + tol && Math.abs(ly) <= o.h / 2 + tol;
  }
  function hitTest(x, y) {
    const tol = 3 / S.view.z;
    if (S.inGroup) { const g = byId(S.inGroup); if (g) for (let i = g.children.length - 1; i >= 0; i--) if (!g.children[i].locked && hitObj(g.children[i], x, y, tol)) return g.children[i]; }
    const L = topObjs();
    for (let i = L.length - 1; i >= 0; i--) { const o = L[i]; if (o.locked) continue; if (hitObj(o, x, y, tol)) return o; }
    return null;
  }
  function selBox(objs) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const o of objs) { const b = M.aabb(o); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); } return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
  const HK = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };
  function handles() {
    const sel = selObjs(); if (!sel.length || S.drag && S.drag.kind === 'create') return [];
    if (sel.length === 1) {
      const o = sel[0]; if (o.locked) return [];
      if (o.type === 'shape' && o.geom === 'line') { const [a, b] = lineEnds(o); return [{ k: 'p0', x: a[0], y: a[1] }, { k: 'p1', x: b[0], y: b[1] }]; }
      const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = rad(o.rot || 0);
      const out = Object.entries(HK).map(([k, [hx, hy]]) => { const [dx, dy] = rotP(hx * o.w / 2, hy * o.h / 2, r); return { k, x: cx + dx, y: cy + dy }; });
      if (o.type !== 'table') { const [dx, dy] = rotP(0, -o.h / 2 - 24 / S.view.z, r); out.push({ k: 'rot', x: cx + dx, y: cy + dy }); }
      return out;
    }
    const b = selBox(sel);
    return Object.entries(HK).map(([k, [hx, hy]]) => ({ k, x: b.x + b.w / 2 + hx * b.w / 2, y: b.y + b.h / 2 + hy * b.h / 2 }));
  }
  function hitHandle(sx, sy) { for (const h of handles()) { const [hx, hy] = View.w2s(h.x, h.y); if (Math.abs(hx - sx) <= 6 && Math.abs(hy - sy) <= 6) return h; } return null; }
  const CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', rot: 'grab', p0: 'crosshair', p1: 'crosshair' };
  function cursorFor(h, o) {
    if (!h) return o ? 'move' : S.tool === 'select' ? 'default' : S.tool === 'hand' ? 'grab' : 'crosshair';
    if (h.k === 'rot' || h.k[0] === 'p') return CURSOR[h.k];
    const one = selObjs()[0], r = one && selObjs().length === 1 ? (one.rot || 0) : 0;
    const ang = (Math.atan2(HK[h.k][1], HK[h.k][0]) * 180 / Math.PI + r + 360) % 180;
    return ang < 22.5 || ang >= 157.5 ? 'ew-resize' : ang < 67.5 ? 'nwse-resize' : ang < 112.5 ? 'ns-resize' : 'nesw-resize';
  }
  function cellRect(o, r, c) {
    const tot = o.cols.reduce((a, b) => a + b, 0) || 1, kx = o.w / tot, rh = Render.tableRowHeights(S.doc, target().ctx, o);
    let x = o.x, y = o.y; for (let i = 0; i < c; i++) x += o.cols[i] * kx; for (let i = 0; i < r; i++) y += rh[i];
    return { x, y, w: o.cols[c] * kx, h: rh[r] };
  }
  function cellAt(o, wx, wy) { for (let r = 0; r < o.rows.length; r++) for (let c = 0; c < o.cols.length; c++) { const q = cellRect(o, r, c); if (wx >= q.x && wx <= q.x + q.w && wy >= q.y && wy <= q.y + q.h) return { r, c }; } return null; }

  /* ---------- snapping ---------- */
  function snapTargets(exclude) {
    const d = S.doc, xs = [{ v: 0 }, { v: d.w / 2, mid: true }, { v: d.w }], ys = [{ v: 0 }, { v: d.h / 2, mid: true }, { v: d.h }];
    const others = (S.inGroup ? (byId(S.inGroup) || { children: [] }).children : topObjs()).filter(o => !exclude.has(o.id) && !o.hidden);
    for (const o of others) { const b = M.aabb(o); xs.push({ v: b.x, b }, { v: b.x + b.w / 2, b, mid: true }, { v: b.x + b.w, b }); ys.push({ v: b.y, b }, { v: b.y + b.h / 2, b, mid: true }, { v: b.y + b.h, b }); }
    return { xs, ys };
  }
  // box: {x,y,w,h}; which: which edges move ('all' for move) → returns {dx, dy, guides}
  function snapBox(box, T, edgesX = [0, .5, 1], edgesY = [0, .5, 1]) {
    const thr = 6 / S.view.z; let bx = null, by = null;
    for (const f of edgesX) { const v = box.x + box.w * f; for (const t of T.xs) { const d = t.v - v; if (Math.abs(d) < thr && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, t, f }; } }
    for (const f of edgesY) { const v = box.y + box.h * f; for (const t of T.ys) { const d = t.v - v; if (Math.abs(d) < thr && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, t, f }; } }
    const guides = [], dx = bx ? bx.d : 0, dy = by ? by.d : 0;
    if (bx) { const y0 = Math.min(box.y + dy, bx.t.b ? bx.t.b.y : 0), y1 = Math.max(box.y + dy + box.h, bx.t.b ? bx.t.b.y + bx.t.b.h : S.doc.h); guides.push({ v: bx.t.v, a: y0, b: y1 }); }
    if (by) { const x0 = Math.min(box.x + dx, by.t.b ? by.t.b.x : 0), x1 = Math.max(box.x + dx + box.w, by.t.b ? by.t.b.x + by.t.b.w : S.doc.w); guides.push({ h: by.t.v, a: x0, b: x1 }); }
    return { dx, dy, guides, sx: !!bx, sy: !!by };
  }

  /* ---------- pointer ---------- */
  let cv, wrap;
  function init() {
    cv = $('#cv'); wrap = $('#stagewrap');
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('dblclick', dbl);
    cv.addEventListener('wheel', wheel, { passive: false });
    cv.addEventListener('contextmenu', e => { e.preventDefault(); UI.contextMenu(e); });
    new ResizeObserver(() => { if (S.view.fit) View.fit(); else requestRender(); placeEditor(); }).observe(wrap);
    document.addEventListener('paste', onPaste);
    document.addEventListener('keydown', onKey);
  }
  const cap = e => { try { cv.setPointerCapture(e.pointerId); } catch (_) { } };
  const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function down(e) {
    if (S.preview) return;
    cv.focus({ preventScroll: true });
    const [sx, sy] = pos(e), [wx, wy] = View.s2w(sx, sy);
    if (S.edit) endEdit(true);
    if (e.button === 1 || S.tool === 'hand' || (e.button === 0 && e.altKey && e.ctrlKey)) { S.drag = { kind: 'pan', sx, sy, ox: S.view.ox, oy: S.view.oy }; cap(e); cv.style.cursor = 'grabbing'; return; }
    if (e.button !== 0) { const o = hitTest(wx, wy); if (o && !S.sel.includes(o.id)) select([o.id], true); return; }
    if (S.tool !== 'select') { S.drag = { kind: 'create', x0: wx, y0: wy, x1: wx, y1: wy, tool: S.tool }; S.marquee = { x0: wx, y0: wy, x1: wx, y1: wy }; cap(e); return; }
    const h = hitHandle(sx, sy);
    if (h) { startTransform(h, wx, wy, e); cap(e); return; }
    const o = hitTest(wx, wy);
    if (o) {
      if (S.inGroup && !byId(S.inGroup).children.includes(o)) S.inGroup = null;
      if (e.shiftKey || e.ctrlKey && !S.sel.includes(o.id)) { select(S.sel.includes(o.id) ? S.sel.filter(i => i !== o.id) : [...S.sel, o.id], true); if (!S.sel.includes(o.id)) return; }
      else if (!S.sel.includes(o.id)) select([o.id], true);
      const objs = selObjs();
      S.drag = { kind: 'move', x0: wx, y0: wy, applied: [0, 0], objs, box: selBox(objs), T: snapTargets(new Set(objs.map(x => x.id))), dup: e.ctrlKey, moved: false };
      cap(e);
      return;
    }
    if (!e.shiftKey) { S.inGroup = null; select([]); }
    S.drag = { kind: 'marquee', x0: wx, y0: wy, add: e.shiftKey ? [...S.sel] : [] }; S.marquee = { x0: wx, y0: wy, x1: wx, y1: wy };
    cap(e);
  }
  function startTransform(h, wx, wy, e) {
    const sel = selObjs();
    const orig = sel.map(o => JSON.parse(JSON.stringify(o)));
    if (h.k === 'rot') { const o = sel[0]; S.drag = { kind: 'rotate', o, cx: o.x + o.w / 2, cy: o.y + o.h / 2, r0: o.rot || 0, a0: Math.atan2(wy - (o.y + o.h / 2), wx - (o.x + o.w / 2)) }; return; }
    if (h.k === 'p0' || h.k === 'p1') { const o = sel[0]; S.drag = { kind: 'line', o, k: h.k, ends: lineEnds(o), T: snapTargets(new Set([o.id])) }; return; }
    S.drag = { kind: 'resize', h: h.k, sel, orig, box: sel.length > 1 ? selBox(sel) : null, T: snapTargets(new Set(sel.map(o => o.id))) };
  }
  function move(e) {
    const [sx, sy] = pos(e), [wx, wy] = View.s2w(sx, sy);
    UI.status(wx, wy);
    const d = S.drag;
    if (!d) {
      const h = hitHandle(sx, sy), o = h ? null : hitTest(wx, wy);
      cv.style.cursor = cursorFor(h, o);
      const hid = o ? o.id : null; if (hid !== S.hover) { S.hover = hid; requestRender(); }
      return;
    }
    if (d.kind === 'pan') { S.view.ox = d.ox + sx - d.sx; S.view.oy = d.oy + sy - d.sy; S.view.fit = false; requestRender(); return; }
    if (d.kind === 'marquee' || d.kind === 'create') {
      let x1 = wx, y1 = wy;
      if (d.kind === 'create' && e.shiftKey) { if (d.tool === 'line') { const a = Math.round(Math.atan2(wy - d.y0, wx - d.x0) / (Math.PI / 4)) * Math.PI / 4, L = Math.hypot(wx - d.x0, wy - d.y0); x1 = d.x0 + Math.cos(a) * L; y1 = d.y0 + Math.sin(a) * L; } else { const s = Math.max(Math.abs(wx - d.x0), Math.abs(wy - d.y0)); x1 = d.x0 + Math.sign(wx - d.x0 || 1) * s; y1 = d.y0 + Math.sign(wy - d.y0 || 1) * s; } }
      d.x1 = x1; d.y1 = y1; S.marquee = { x0: d.x0, y0: d.y0, x1, y1 };
      if (d.kind === 'marquee') {
        const bx = { x: Math.min(d.x0, wx), y: Math.min(d.y0, wy), w: Math.abs(wx - d.x0), h: Math.abs(wy - d.y0) };
        const ids = topObjs().filter(o => !o.locked && (() => { const b = M.aabb(o); return b.x >= bx.x && b.y >= bx.y && b.x + b.w <= bx.x + bx.w && b.y + b.h <= bx.y + bx.h; })()).map(o => o.id);
        S.sel = [...new Set([...d.add, ...ids])];
      }
      requestRender(); return;
    }
    if (d.kind === 'move') {
      let dx = wx - d.x0, dy = wy - d.y0;
      if (!d.moved && Math.hypot(dx, dy) * S.view.z < 3) return;
      if (!d.moved && d.dup) { // ctrl-drag duplicates
        const list = target().main, clones = d.objs.map(o => M.cloneObj(o)); clones.forEach(c => { delete c.ph; list.push(c); });
        d.objs = clones; S.sel = clones.map(c => c.id);
      }
      d.moved = true;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      S.guides = [];
      if (S.opt.snap && !e.altKey) { const sn = snapBox({ x: d.box.x + dx, y: d.box.y + dy, w: d.box.w, h: d.box.h }, d.T); dx += sn.dx; dy += sn.dy; if (S.opt.guides) S.guides = sn.guides; }
      const ddx = dx - d.applied[0], ddy = dy - d.applied[1];
      for (const o of d.objs) M.translate(o, ddx, ddy);
      d.applied = [dx, dy];
      requestRender(); placeEditor(); return;
    }
    if (d.kind === 'rotate') {
      let a = d.r0 + (Math.atan2(wy - d.cy, wx - d.cx) - d.a0) * 180 / Math.PI;
      a = ((a % 360) + 360) % 360; if (e.shiftKey) a = Math.round(a / 15) * 15; else for (const s of [0, 90, 180, 270, 360]) if (Math.abs(a - s) < 3) a = s;
      d.o.rot = Math.round((a % 360) * 10) / 10; requestRender(); UI.status(); return;
    }
    if (d.kind === 'line') {
      let p = [wx, wy]; const other = d.k === 'p0' ? d.ends[1] : d.ends[0];
      if (e.shiftKey) { const a = Math.round(Math.atan2(wy - other[1], wx - other[0]) / (Math.PI / 4)) * Math.PI / 4, L = Math.hypot(wx - other[0], wy - other[1]); p = [other[0] + Math.cos(a) * L, other[1] + Math.sin(a) * L]; }
      else if (S.opt.snap && !e.altKey) { const sn = snapBox({ x: p[0], y: p[1], w: 0, h: 0 }, d.T, [0], [0]); p = [p[0] + sn.dx, p[1] + sn.dy]; S.guides = S.opt.guides ? sn.guides : []; }
      if (d.k === 'p0') setLine(d.o, p, other); else setLine(d.o, other, p);
      requestRender(); return;
    }
    if (d.kind === 'resize') { doResize(d, wx, wy, e); requestRender(); placeEditor(); }
  }
  function doResize(d, wx, wy, e) {
    const [hx, hy] = HK[d.h];
    S.guides = [];
    if (d.box) { // multi selection: scale about opposite corner of the bbox
      const b = d.box, ax = b.x + (hx < 0 ? b.w : hx > 0 ? 0 : b.w / 2), ay = b.y + (hy < 0 ? b.h : hy > 0 ? 0 : b.h / 2);
      let sxk = hx ? Math.max(0.02, (wx - ax) * hx / b.w) : 1, syk = hy ? Math.max(0.02, (wy - ay) * hy / b.h) : 1;
      if (e.shiftKey && hx && hy) sxk = syk = Math.max(sxk, syk);
      d.sel.forEach((o, i) => { const q = d.orig[i]; const nx = ax + (q.x - ax) * sxk * (hx ? 1 : 1), ny = ay + (q.y - ay) * syk; restoreGeo(o, q); M.setRect(o, hx ? nx : q.x, hy ? ny : q.y, q.w * sxk, q.h * syk); if (o.ph) o.ownGeo = true; });
      return;
    }
    const o = d.sel[0], q = d.orig[0], r = rad(q.rot || 0);
    const c0 = [q.x + q.w / 2, q.y + q.h / 2];
    const al = rotP(-hx * q.w / 2, -hy * q.h / 2, r), A = [c0[0] + al[0], c0[1] + al[1]];
    let [lx, ly] = rotP(wx - A[0], wy - A[1], -r);
    // snapping (only for unrotated objects)
    if (!q.rot && S.opt.snap && !e.altKey) {
      const ex = hx ? [hx > 0 ? 1 : 0] : [], ey = hy ? [hy > 0 ? 1 : 0] : [];
      const bx = { x: Math.min(A[0], A[0] + lx), y: Math.min(A[1], A[1] + ly), w: Math.abs(lx), h: Math.abs(ly) };
      const sn = snapBox({ x: hx ? Math.min(A[0], A[0] + lx) : q.x, y: hy ? Math.min(A[1], A[1] + ly) : q.y, w: hx ? Math.abs(lx) : q.w, h: hy ? Math.abs(ly) : q.h }, d.T, ex.length ? [lx * hx >= 0 ? (hx > 0 ? 1 : 0) : 0] : [], ey.length ? [ly * hy >= 0 ? (hy > 0 ? 1 : 0) : 0] : []);
      lx += sn.dx; ly += sn.dy; if (S.opt.guides) S.guides = sn.guides; void bx;
    }
    let w = hx ? Math.max(2, lx * hx) : q.w, h = hy ? Math.max(2, ly * hy) : q.h;
    const keep = (o.type === 'image' || o.type === 'group') !== !!e.shiftKey;
    if (keep && hx && hy) { const s = Math.max(w / q.w, h / q.h); w = q.w * s; h = q.h * s; }
    const ca = rotP(hx * w / 2, hy * h / 2, r), C = [A[0] + ca[0], A[1] + ca[1]];
    restoreGeo(o, q);
    M.setRect(o, C[0] - w / 2, C[1] - h / 2, w, h);
    if (o.ph) o.ownGeo = true;
    if (o.text && o.text.autofit === 'grow' && hx && !hy) { /* height re-fitted on release */ }
  }
  function restoreGeo(o, q) { o.x = q.x; o.y = q.y; o.w = q.w; o.h = q.h; if (o.type === 'group') o.children = JSON.parse(JSON.stringify(q.children)); if (o.type === 'table') { o.cols = [...q.cols]; o.rows.forEach((r, i) => r.h = q.rows[i].h); } }
  function up(e) {
    const d = S.drag; if (!d) return;
    S.drag = null; S.guides = []; cv.style.cursor = 'default';
    try { cv.releasePointerCapture(e.pointerId); } catch (_) { }
    if (d.kind === 'pan') { requestRender(); return; }
    if (d.kind === 'marquee') { S.marquee = null; select(S.sel); return; }
    if (d.kind === 'create') { S.marquee = null; create(d); return; }
    if (d.kind === 'move') { if (d.moved) { for (const o of d.objs) if (o.ph && S.mode === 'slide') o.ownGeo = true; if (S.mode === 'master') syncLayoutPh(); commit(d.dup ? 'Duplicate' : 'Move'); } else requestRender(); return; }
    if (d.kind === 'resize') { for (const o of d.sel) fitGrow(o); if (S.mode === 'master') syncLayoutPh(); commit('Resize'); return; }
    if (d.kind === 'rotate') { commit('Rotate'); return; }
    if (d.kind === 'line') { commit('Edit line'); return; }
  }
  // when a placeholder is moved on a layout / the master, slides that inherit its geometry follow
  function syncLayoutPh() {
    const lay = curLayout(), d = S.doc;
    for (const s of d.slides) {
      if (lay && s.layout !== lay.id) continue;
      for (const o of s.objects) if (o.ph && !o.ownGeo) { const lp = M.layoutPh(d, s, o); if (lp) { o.x = lp.x; o.y = lp.y; o.w = lp.w; o.h = lp.h; } }
    }
  }
  function fitGrow(o) {
    if (!o || o.type !== 'shape' || !o.text || o.text.autofit !== 'grow' || o.rot) return;
    const L = Render.layoutText(S.doc, target().ctx, o, o.text, o.w, o.h, { slideNum: S.cur + 1 });
    if (Math.abs(L.need - o.h) > 0.5) o.h = Math.max(L.need, 10);
  }
  function create(d) {
    let x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1), w = Math.abs(d.x1 - d.x0), h = Math.abs(d.y1 - d.y0);
    const click = w * S.view.z < 4 && h * S.view.z < 4;
    let o;
    if (d.tool === 'text') { if (click) { w = 320; } o = M.textBox(x, y, Math.max(w, 40), 40, ''); o.text.paras = [{ runs: [] }]; fitGrow(o); }
    else if (d.tool === 'line') { if (click) { d.x1 = d.x0 + 200; d.y1 = d.y0; } o = M.shape('line', 0, 0, 0, 0); setLine(o, [d.x0, d.y0], [d.x1, d.y1]); }
    else { if (click) { w = h = 160; x -= 80; y -= 80; } o = M.shape(S.geom || 'rect', x, y, Math.max(w, 4), Math.max(h, 4)); if (S.geom === 'roundRect' || S.geom === 'rect' || /Callout/.test(S.geom)) o.text = M.textBody([M.para('')]); }
    target().main.push(o);
    S.sel = [o.id];
    UI.setTool('select');
    commit('Insert ' + (d.tool === 'text' ? 'text box' : d.tool === 'line' ? 'line' : 'shape'));
    if (d.tool === 'text') beginEdit(o, {});
  }
  function dbl(e) {
    const [sx, sy] = pos(e), [wx, wy] = View.s2w(sx, sy);
    let o = hitTest(wx, wy); if (!o) return;
    if (o.type === 'group') { S.inGroup = o.id; const k = o.children.slice().reverse().find(c => hitObj(c, wx, wy, 2 / S.view.z)); select(k ? [k.id] : [], true); return; }
    if (o.type === 'table') { const c = cellAt(o, wx, wy); if (c) { S.sel = [o.id]; beginEdit(o, { cell: c, point: [e.clientX, e.clientY] }); } return; }
    if (o.type === 'chart') { UI.editChartData(o); return; }
    if (o.ph && o.ph.type === 'pic' && o.type === 'shape') { IO.insertPicture(o); return; }
    if (o.type === 'image') { UI.cropDialog(o); return; }
    if (isText(o)) { S.sel = [o.id]; beginEdit(o, { point: [e.clientX, e.clientY] }); }
  }
  function wheel(e) {
    e.preventDefault();
    const [sx, sy] = pos(e);
    if (e.ctrlKey) { View.zoomAt(S.view.z * Math.exp(-e.deltaY * 0.0022), sx, sy); return; }
    if (S.view.fit && !e.shiftKey) { // in fit mode the wheel flips slides
      if (S.mode === 'slide') { const now = performance.now(); if (now - (wheel.t || 0) > 220) { wheel.t = now; UI.goSlide(S.cur + Math.sign(e.deltaY)); } }
      return;
    }
    S.view.ox -= e.shiftKey ? e.deltaY : e.deltaX; S.view.oy -= e.shiftKey ? 0 : e.deltaY; requestRender(); placeEditor();
  }

  /* ---------- text editing ---------- */
  let te = null; // {wrap, ed, o, cell, sc, orig, ctx, base}
  function textCtxFor(o, cell) {
    const tc = target().ctx;
    if (!cell) return { ctx: tc, pseudo: o, tb: o.text || (o.text = M.textBody([M.para('')])) };
    const t = o, ct = t.rows[cell.r].cells[cell.c]; const st = t.style || {}; const hdr = st.first && cell.r === 0 && !st.none;
    const pseudo = { type: 'table', text: { ...ct.text, def: { ...(ct.text.def || {}), ...(hdr ? { b: ct.b != null ? ct.b : true, color: (ct.text.def && ct.text.def.color) || 'bg1' } : {}) } } };
    return { ctx: tc, pseudo, tb: ct.text };
  }
  const cssColor = c => M.color(c, S.doc.theme);
  function runCss(r, sc) {
    let s = '';
    if (r.font) s += `font-family:${Render.famCss(M.font(r.font, S.doc.theme))};`;
    if (r.size != null) s += `font-size:${(r.size * PT * sc).toFixed(2)}px;`;
    if (r.b != null) s += `font-weight:${r.b ? 700 : 400};`;
    if (r.i != null) s += `font-style:${r.i ? 'italic' : 'normal'};`;
    const dec = [r.u ? 'underline' : '', r.s ? 'line-through' : ''].filter(Boolean).join(' ');
    if (r.u != null || r.s) s += `text-decoration:${dec || 'none'};`;
    if (r.color) s += `color:${cssColor(r.color)};`;
    if (r.sup) s += `vertical-align:${r.sup > 0 ? 'super' : 'sub'};font-size:${r.size != null ? (r.size * PT * sc * 0.66).toFixed(2) + 'px' : '66%'};`;
    return s;
  }
  function paraAttrs(base, p, pi, numCount, sc) {
    const ps = Render.paraStyle(base, p, S.doc.theme);
    const fr = p.runs.find(r => r.t) || {}, rs = Render.runStyle(base, ps, fr, S.doc.theme);
    let bt = '';
    if (ps.bullet) { if (typeof ps.bullet === 'object') { numCount.length = ps.lvl + 1; numCount[ps.lvl] = (numCount[ps.lvl] || (ps.bullet.start || 1) - 1) + 1; bt = M.numLabel(ps.bullet.num, numCount[ps.lvl]); } else bt = ps.bullet; }
    else if (ps.lvl < numCount.length) numCount.length = ps.lvl;
    const lvSize = ps.size * PT * sc;
    const st = `text-align:${{ l: 'left', c: 'center', r: 'right', j: 'justify' }[ps.align]};padding-left:${ps.marL}px;text-indent:${ps.indent}px;line-height:${(Render.LH * ps.lnSp).toFixed(3)};font-size:${lvSize.toFixed(2)}px;margin:${pi > 0 ? (ps.spB * PT * sc).toFixed(2) : 0}px 0 ${(ps.spA * PT * sc).toFixed(2)}px;` + (bt ? `--bw:${Math.max(0, -ps.indent)}px;--bf:${rs.b && typeof ps.bullet === 'object' ? 700 : 400} ${(rs.size * PT * sc).toFixed(2)}px ${Render.famCss(rs.font)};--bc:${cssColor(rs.color)};` : '');
    const keep = {}; for (const k of ['bullet', 'align', 'lnSp', 'spB', 'spA', 'marL', 'indent', 'endSize']) if (p[k] != null) keep[k] = p[k];
    return { st, bt, keep, lvl: p.lvl || 0 };
  }
  const escH = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function toHTML(tb, base, sc, slideNum) {
    const numCount = [];
    return tb.paras.map((p, pi) => {
      const a = paraAttrs(base, p, pi, numCount, sc);
      let inner = '';
      for (const r of p.runs) {
        const meta = {}; for (const k of ['color', 'font', 'size', 'fld']) if (r[k] != null) meta[k] = r[k];
        const m = Object.keys(meta).length ? ` data-r="${escH(JSON.stringify(meta))}"` : '';
        if (r.br) { inner += '<br>'; continue; }
        if (r.fld) { inner += `<span contenteditable="false" class="fld"${m} style="${runCss(r, sc)}">${escH(r.fld === 'slidenum' ? String(slideNum) : new Date().toLocaleDateString())}</span>`; continue; }
        if (!r.t) continue;
        inner += `<span${m} style="${runCss(r, sc)}">${escH(r.t)}</span>`;
      }
      if (!inner || /<br>$/.test(inner)) inner += '<br>';
      return `<div class="tp${a.bt ? ' bu' : ''}" data-lvl="${a.lvl}" data-p="${escH(JSON.stringify(a.keep))}" data-bt="${escH(a.bt)}" style="${a.st}">${inner}</div>`;
    }).join('');
  }
  const rgbHex = s => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s || ''); return m ? M.rgb2hex(+m[1], +m[2], +m[3]) : s && s[0] === '#' ? s.toLowerCase() : null; };
  function fromHTML(ed, sc) {
    const paras = [];
    const blocks = [];
    // collect paragraph blocks (top-level divs); inline content directly in the editor forms its own paragraph
    let loose = null;
    for (const n of [...ed.childNodes]) {
      if (n.nodeType === 1 && (n.tagName === 'DIV' || n.tagName === 'P')) { loose = null; blocks.push(n); }
      else { if (!loose) { loose = document.createElement('div'); blocks.push(loose); loose._virtual = true; } loose.appendChild(n.cloneNode(true)); }
    }
    for (const b of blocks) {
      // nested block divs (pasted content) are flattened into separate paragraphs
      const sub = [...b.children].filter(c => c.tagName === 'DIV' || c.tagName === 'P');
      if (sub.length && !b._virtual) { for (const s of sub) { if (!s.dataset.p && b.dataset.p) { s.dataset.p = b.dataset.p; s.dataset.lvl = b.dataset.lvl; } } }
      const list = sub.length && !b._virtual ? sub : [b];
      for (const blk of list) paras.push(parseBlock(blk, ed, sc));
    }
    if (!paras.length) paras.push({ runs: [] });
    return paras;
  }
  function parseBlock(blk, ed, sc) {
    let keep = {}; try { keep = JSON.parse(blk.dataset.p || '{}'); } catch (_) { }
    const p = { runs: [], ...keep }; const lvl = +blk.dataset.lvl || 0; if (lvl) p.lvl = lvl;
    const ta = blk.style.textAlign; if (ta) { const al = { left: 'l', center: 'c', right: 'r', justify: 'j' }[ta]; if (al && keep.align == null && blk.dataset.alignSet) p.align = al; }
    const walk = (n, ctxRun) => {
      if (n.nodeType === 3) { if (n.nodeValue) pushRun(p, { ...ctxRun, t: n.nodeValue.replace(/ /g, ' ') }); return; }
      if (n.nodeType !== 1) return;
      if (n.tagName === 'BR') { if (n !== lastBr(blk)) pushRun(p, { ...ctxRun, t: '', br: true }); return; }
      const r = { ...ctxRun };
      let meta = {}; try { meta = n.dataset && n.dataset.r ? JSON.parse(n.dataset.r) : {}; } catch (_) { }
      const tag = n.tagName;
      if (tag === 'B' || tag === 'STRONG') r.b = true; if (tag === 'I' || tag === 'EM') r.i = true; if (tag === 'U') r.u = true; if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL') r.s = true;
      if (tag === 'SUP') r.sup = 30; if (tag === 'SUB') r.sup = -25;
      if (tag === 'FONT') { if (n.getAttribute('color')) r.color = rgbHex(n.getAttribute('color')) || r.color; if (n.getAttribute('face')) r.font = n.getAttribute('face'); }
      const st = n.style;
      if (st) {
        if (st.fontWeight) r.b = st.fontWeight === 'bold' || +st.fontWeight >= 600;
        if (st.fontStyle) r.i = st.fontStyle === 'italic';
        const td = st.textDecorationLine || st.textDecoration; if (td) { r.u = /underline/.test(td); r.s = /line-through/.test(td) || undefined; }
        if (st.color) { const hx = rgbHex(st.color); r.color = n.dataset.c && hx === cssColor(n.dataset.c) ? n.dataset.c : meta.color && hx === cssColor(meta.color) ? meta.color : hx; }
        if (st.fontFamily) { const fam = st.fontFamily.split(',')[0].replace(/["']/g, '').trim(); r.font = n.dataset.f ? n.dataset.f : meta.font && M.font(meta.font, S.doc.theme) === fam ? meta.font : fam; }
        if (st.fontSize && /px$/.test(st.fontSize) && st.verticalAlign !== 'super' && st.verticalAlign !== 'sub') { const pt = parseFloat(st.fontSize) / PT / sc; r.size = meta.size != null && Math.abs(meta.size - pt) < 0.05 ? meta.size : Math.round(pt * 10) / 10; }
        if (st.verticalAlign === 'super') r.sup = 30; else if (st.verticalAlign === 'sub') r.sup = -25; else if (st.verticalAlign === 'baseline') r.sup = undefined;
      }
      if (meta.fld) { pushRun(p, { ...r, t: '', fld: meta.fld }); return; }
      for (const k of n.childNodes) walk(k, r);
    };
    for (const k of blk.childNodes) walk(k, {});
    return p;
  }
  const lastBr = blk => { const l = blk.lastChild; return l && l.nodeType === 1 && l.tagName === 'BR' ? l : l && l.nodeType === 1 && l.lastChild && l.lastChild.tagName === 'BR' && !l.textContent ? l.lastChild : null; };
  function pushRun(p, r) {
    for (const k of Object.keys(r)) if (r[k] === undefined) delete r[k];
    const last = p.runs[p.runs.length - 1];
    const same = (a, b) => ['b', 'i', 'u', 's', 'color', 'font', 'size', 'sup'].every(k => a[k] === b[k]);
    if (last && !last.br && !last.fld && !r.br && !r.fld && same(last, r)) last.t += r.t; else p.runs.push(r);
  }
  function beginEdit(o, opts = {}) {
    if (te) endEdit(true);
    const { ctx, pseudo, tb } = textCtxFor(o, opts.cell);
    const base = M.baseStyle(S.doc, ctx, pseudo);
    const lay = Render.layoutText(S.doc, ctx, pseudo, tb, opts.cell ? 10 : o.w, opts.cell ? 10 : o.h, { slideNum: S.cur + 1 });
    const sc = opts.cell ? 1 : lay.scale;
    S.edit = { id: o.id, cell: opts.cell || null };
    const w = Aero.el('div', 'te'), inner = Aero.el('div', 'te-in'), ed = Aero.el('div', 'te-ed');
    ed.contentEditable = 'true'; ed.spellcheck = true;
    inner.appendChild(ed); w.appendChild(inner); wrap.appendChild(w);
    const ins = tb.ins || Render.DEF_INS;
    inner.style.padding = `${ins[1]}px ${ins[2]}px ${ins[3]}px ${ins[0]}px`;
    const anchor = tb.anchor || base.anchor || 't';
    inner.style.justifyContent = anchor === 'ctr' ? 'center' : anchor === 'b' ? 'flex-end' : 'flex-start';
    ed.style.fontFamily = Render.famCss(M.font(base.font, S.doc.theme)); ed.style.color = cssColor(base.color || 'tx1');
    ed.style.fontWeight = base.b ? 700 : 400; ed.style.fontStyle = base.i ? 'italic' : 'normal';
    if (tb.wrap === false) ed.style.whiteSpace = 'pre';
    ed.innerHTML = toHTML(tb, base, sc, S.cur + 1);
    te = { wrap: w, ed, o, cell: opts.cell || null, sc, orig: JSON.stringify(tb.paras), ctx, base, pseudo };
    placeEditor();
    ed.addEventListener('input', onEdInput);
    ed.addEventListener('keydown', onEdKey);
    ed.addEventListener('paste', onEdPaste);
    ed.addEventListener('blur', () => setTimeout(() => { if (te && te.ed === ed && !wrap.contains(document.activeElement) && !document.activeElement.closest?.('.aero-cmdbar,.cpop,.aero-side,.aero-menubar,.aero-modal')) endEdit(true); }, 0));
    document.execCommand('styleWithCSS', false, true);
    ed.focus({ preventScroll: true });
    const sel = getSelection();
    if (opts.point && document.caretRangeFromPoint) { const r = document.caretRangeFromPoint(opts.point[0], opts.point[1]); if (r && ed.contains(r.startContainer)) { sel.removeAllRanges(); sel.addRange(r); } else caretEnd(ed); }
    else if (opts.selectAll) { const r = document.createRange(); r.selectNodeContents(ed); sel.removeAllRanges(); sel.addRange(r); }
    else caretEnd(ed);
    if (opts.text) document.execCommand('insertText', false, opts.text);
    requestRender(); UI.refresh(false);
  }
  function caretEnd(ed) { const r = document.createRange(); r.selectNodeContents(ed); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  function placeEditor() {
    if (!te) return;
    const o = te.o; let x = o.x, y = o.y, w = o.w, h = o.h, rot = o.rot || 0;
    if (te.cell) { const r = cellRect(o, te.cell.r, te.cell.c); x = r.x; y = r.y; w = r.w; h = r.h; rot = 0; }
    const [sx, sy] = View.w2s(x, y), z = S.view.z;
    Object.assign(te.wrap.style, { left: sx + 'px', top: sy + 'px', width: w + 'px', minHeight: h + 'px', height: (te.o.text && te.o.text.autofit === 'grow' && !te.cell) ? 'auto' : h + 'px', transform: `scale(${z}) translate(${w / 2}px,${h / 2}px) rotate(${rot}deg) translate(${-w / 2}px,${-h / 2}px)` });
  }
  function onEdInput() {
    // keep bullets / numbering labels current
    refreshBullets();
    if (te && te.o.text && te.o.text.autofit === 'grow') placeEditor();
  }
  function refreshBullets() {
    if (!te) return;
    const paras = fromHTML(te.ed, te.sc); const numCount = [];
    const blocks = [...te.ed.children].filter(c => c.tagName === 'DIV' || c.tagName === 'P');
    blocks.forEach((b, i) => {
      const p = paras[i]; if (!p) return;
      const a = paraAttrs(te.base, p, i, numCount, te.sc);
      if (b.dataset.bt !== a.bt) b.dataset.bt = a.bt;
      b.classList.toggle('bu', !!a.bt); b.classList.add('tp');
      // keep inline paragraph styling in sync (Chrome copies attributes when splitting blocks)
      const cur = b.getAttribute('style') || ''; if (cur !== a.st) b.setAttribute('style', a.st);
    });
  }
  function onEdKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); const id = te.o.id; endEdit(true); select([id]); return; }
    if (e.key === 'Tab') {
      e.preventDefault(); e.stopPropagation();
      if (te.cell) { const o = te.o, n = o.rows.length * o.cols.length; let k = te.cell.r * o.cols.length + te.cell.c + (e.shiftKey ? -1 : 1); if (k >= n && !e.shiftKey) { UI.tableOp(o, 'rowBelow', { r: o.rows.length - 1, c: 0 }, true); } k = Math.max(0, k); const cell = { r: Math.floor(k / o.cols.length), c: k % o.cols.length }; endEdit(true); const o2 = byId(o.id); if (o2) beginEdit(o2, { cell, selectAll: true }); return; }
      changeLevel(e.shiftKey ? -1 : 1); return;
    }
    if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); document.execCommand('insertLineBreak'); return; }
  }
  function onEdPaste(e) {
    // paste as plain text (keeps the deck's formatting)
    const t = e.clipboardData && e.clipboardData.getData('text/plain');
    if (t != null) { e.preventDefault(); e.stopPropagation(); document.execCommand('insertText', false, t); }
  }
  function selectedBlocks() {
    if (!te) return [];
    const sel = getSelection(); if (!sel.rangeCount) return [];
    const r = sel.getRangeAt(0);
    const blocks = [...te.ed.children].filter(c => c.tagName === 'DIV' || c.tagName === 'P');
    const out = blocks.filter(b => r.intersectsNode(b));
    if (!out.length && blocks.length) { let n = r.startContainer; while (n && n.parentNode !== te.ed) n = n.parentNode; if (n && blocks.includes(n)) out.push(n); }
    return out;
  }
  function setParaProp(fn) {
    // apply to paragraphs (editing → selected blocks; otherwise → whole text of selected objects)
    if (te) {
      for (const b of selectedBlocks()) { let k = {}; try { k = JSON.parse(b.dataset.p || '{}'); } catch (_) { } const lvl = { v: +b.dataset.lvl || 0 }; fn(k, lvl); for (const x of Object.keys(k)) if (k[x] === undefined) delete k[x]; b.dataset.p = JSON.stringify(k); b.dataset.lvl = lvl.v; }
      refreshBullets(); te.ed.focus(); return true;
    }
    return false;
  }
  function changeLevel(d) { setParaProp((k, l) => { l.v = Math.max(0, Math.min(8, l.v + d)); delete k.marL; delete k.indent; }); }
  // character formatting on the live editor
  function execFormat(cmd, val) {
    if (!te) return false;
    te.ed.focus();
    if (cmd === 'size') {
      document.execCommand('styleWithCSS', false, false); document.execCommand('fontSize', false, '7'); document.execCommand('styleWithCSS', false, true);
      te.ed.querySelectorAll('font[size="7"]').forEach(f => { const s = document.createElement('span'); s.style.fontSize = (val * PT * te.sc).toFixed(2) + 'px'; s.dataset.r = JSON.stringify({ size: val }); s.append(...f.childNodes); f.replaceWith(s); s.querySelectorAll('span').forEach(k => { k.style.fontSize = ''; if (k.dataset.r) { try { const m = JSON.parse(k.dataset.r); delete m.size; k.dataset.r = JSON.stringify(m); } catch (_) { } } }); });
      refreshBullets(); return true;
    }
    if (cmd === 'color') {
      const SENT = '#010203'; document.execCommand('foreColor', false, SENT);
      te.ed.querySelectorAll('*').forEach(n => { if (rgbHex(n.style && n.style.color) === SENT || (n.tagName === 'FONT' && rgbHex(n.getAttribute('color')) === SENT)) { if (n.tagName === 'FONT') { const s = document.createElement('span'); s.append(...n.childNodes); n.replaceWith(s); n = s; } n.style.color = cssColor(val); if (M.isScheme(val)) n.dataset.c = val; else delete n.dataset.c; } });
      refreshBullets(); return true;
    }
    if (cmd === 'font') {
      const SENT = 'LumenSentinelFont'; document.execCommand('fontName', false, SENT);
      te.ed.querySelectorAll('*').forEach(n => { const f = n.tagName === 'FONT' ? n.getAttribute('face') : n.style && n.style.fontFamily; if (f && f.replace(/["']/g, '') === SENT) { if (n.tagName === 'FONT') { const s = document.createElement('span'); s.append(...n.childNodes); n.replaceWith(s); n = s; } n.style.fontFamily = Render.famCss(M.font(val, S.doc.theme)); if (val === '+mj' || val === '+mn') n.dataset.f = val; else delete n.dataset.f; } });
      return true;
    }
    document.execCommand(cmd, false, val); refreshBullets(); return true;
  }
  function endEdit(doCommit) {
    if (!te) { S.edit = null; return; }
    const t = te; te = null;
    let paras = null;
    try { paras = fromHTML(t.ed, t.sc); } catch (e) { console.warn(e); }
    t.wrap.remove();
    S.edit = null;
    const o = byId(t.o.id);
    if (doCommit && paras && o) {
      const json = JSON.stringify(paras);
      if (json !== t.orig) {
        if (t.cell) o.rows[t.cell.r].cells[t.cell.c].text.paras = paras; else { o.text.paras = paras; delete o.text.scale; fitGrow(o); }
        const empty = paras.every(p => p.runs.every(r => !r.t && !r.fld));
        if (empty && o.tb && !o.ph && !o.fill && !o.line && !t.cell) { const l = listOf(o.id); l.splice(l.indexOf(o), 1); S.sel = []; commit('Delete empty text box'); }
        else commit('Edit text');
        return;
      }
      const empty = paras.every(p => p.runs.every(r => !r.t && !r.fld));
      if (empty && o.tb && !o.ph && !o.fill && !o.line && !t.cell) { const l = listOf(o.id); l.splice(l.indexOf(o), 1); S.sel = []; commit('Delete empty text box'); return; }
    }
    requestRender(); UI.refresh(false);
  }
  const editing = () => !!te;
  // current character style (for the command bar)
  function caretStyle() {
    if (te) {
      const sel = getSelection(); let n = sel.rangeCount ? sel.getRangeAt(0).startContainer : null;
      if (n && n.nodeType === 1 && n.childNodes.length) { const r = sel.getRangeAt(0); n = n.childNodes[Math.max(0, Math.min(n.childNodes.length - 1, r.startOffset - (r.startOffset >= n.childNodes.length ? 1 : 0)))] || n; }
      while (n && n.nodeType === 1 && n.lastChild && (n === te.ed || n.classList.contains('tp')) && n.tagName !== 'BR') n = n.lastChild;
      if (n && n.nodeType === 3) n = n.parentNode; if (n && n.tagName === 'BR') n = n.parentNode;
      if (n && te.ed.contains(n)) {
        const cs = getComputedStyle(n);
        const blk = n.closest('.tp'); let keep = {}; try { keep = JSON.parse(blk && blk.dataset.p || '{}'); } catch (_) { }
        const lvl = blk ? +blk.dataset.lvl || 0 : 0;
        const ps = Render.paraStyle(te.base, { ...keep, lvl, runs: [] }, S.doc.theme);
        return { font: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), size: Math.round(parseFloat(cs.fontSize) / PT / te.sc * 10) / 10, b: +cs.fontWeight >= 600, i: cs.fontStyle === 'italic', u: /underline/.test(cs.textDecorationLine), s: /line-through/.test(cs.textDecorationLine), color: rgbHex(cs.color), align: ps.align, bullet: ps.bullet };
      }
    }
    const o = selObjs().find(x => x.text); if (!o) return null;
    const base = M.baseStyle(S.doc, target().ctx, o), p = o.text.paras[0] || { runs: [] }, ps = Render.paraStyle(base, p, S.doc.theme), r = Render.runStyle(base, ps, p.runs[0] || {}, S.doc.theme);
    return { font: M.font(r.font, S.doc.theme), size: r.size, b: r.b, i: r.i, u: r.u, s: r.s, color: M.color(r.color, S.doc.theme), align: ps.align, bullet: ps.bullet };
  }

  /* ---------- formatting without an active editor (applies to whole objects) ---------- */
  function eachRun(objs, fn) { for (const o of objs) { if (o.type === 'table') o.rows.forEach(r => r.cells.forEach(c => c.text.paras.forEach(p => { p.runs.forEach(fn); }))); else if (o.text) o.text.paras.forEach(p => p.runs.forEach(fn)); if (o.type === 'group') eachRun(o.children, fn); } }
  function eachPara(objs, fn) { for (const o of objs) { if (o.type === 'table') o.rows.forEach(r => r.cells.forEach(c => c.text.paras.forEach(fn))); else if (o.text) o.text.paras.forEach(fn); if (o.type === 'group') eachPara(o.children, fn); } }
  function format(cmd, val) {
    if (execFormat(cmd === 'b' ? 'bold' : cmd === 'i' ? 'italic' : cmd === 'u' ? 'underline' : cmd === 's' ? 'strikeThrough' : cmd, val)) return;
    const objs = selObjs(); if (!objs.length) return;
    const st = caretStyle() || {};
    if (S.mode === 'master' && objs.some(o => o.ph)) { masterFormat(objs.filter(o => o.ph), cmd, val, st); return; }
    if (['b', 'i', 'u', 's'].includes(cmd)) { const v = !st[cmd]; eachRun(objs, r => r[cmd] = v); objs.forEach(o => { if (o.text) { o.text.def = { ...(o.text.def || {}) }; if (cmd === 'b' || cmd === 'i') o.text.def[cmd] = v; } }); }
    else if (cmd === 'size') { eachRun(objs, r => r.size = val); eachPara(objs, p => p.endSize = val); }
    else if (cmd === 'grow') { eachRun(objs, r => { r.size = Math.max(1, Math.round(((r.size || st.size || 18) * (val > 0 ? 1.1 : 1 / 1.1)) * 2) / 2); }); }
    else if (cmd === 'color') eachRun(objs, r => r.color = val);
    else if (cmd === 'font') eachRun(objs, r => r.font = val);
    else return;
    objs.forEach(fitGrow);
    commit('Format text');
  }
  // On the slide master / layouts, formatting a placeholder changes the inherited style of every slide using it.
  function masterFormat(objs, cmd, val, st) {
    const ms = S.doc.master.styles;
    for (const o of objs) {
      const cat = M.phCat(o.ph), isMaster = S.doc.master.ph.includes(o);
      const tgt = isMaster && cat === 'title' ? ms.title : isMaster && cat === 'body' ? ms.body : (o.text.def = o.text.def || {});
      if (cmd === 'b' || cmd === 'i') tgt[cmd] = !st[cmd];
      else if (cmd === 'size' || cmd === 'grow') {
        const cur = st.size || 18, v = cmd === 'size' ? val : Math.max(4, Math.round(cur * (val > 0 ? 1.1 : 1 / 1.1)));
        if (tgt === ms.body) { const d = v - ms.body.lv[0].size; ms.body.lv.forEach(l => l.size = Math.max(4, l.size + d)); } else tgt.size = v;
      }
      else if (cmd === 'color') tgt.color = val || 'tx1';
      else if (cmd === 'font') tgt.font = val;
      else if (cmd === 'align') tgt.align = val;
      else if (cmd === 'bullet') { if (tgt === ms.body) ms.body.lv[0].bullet = val; else tgt.bullet = val; }
    }
    commit('Master text style');
  }
  function paraFormat(kind, val) {
    if (!te && S.mode === 'master' && selObjs().some(o => o.ph) && (kind === 'align' || kind === 'bullet')) { masterFormat(selObjs().filter(o => o.ph), kind, kind === 'bullet' ? (JSON.stringify((caretStyle() || {}).bullet) === JSON.stringify(val) ? 'none' : val) : val, caretStyle() || {}); return; }
    const apply = (k, l) => {
      if (kind === 'align') k.align = val;
      else if (kind === 'bullet') { const cur = k.bullet; k.bullet = JSON.stringify(cur) === JSON.stringify(val) ? 'none' : val; delete k.marL; delete k.indent; }
      else if (kind === 'level') { l.v = Math.max(0, Math.min(8, l.v + val)); delete k.marL; delete k.indent; }
      else if (kind === 'lnSp') k.lnSp = val;
    };
    if (kind === 'bullet' && te) { // toggle based on the caret paragraph's effective bullet
      const st = caretStyle(); const on = st && st.bullet && JSON.stringify(st.bullet) === JSON.stringify(val);
      setParaProp(k => { k.bullet = on ? 'none' : val; delete k.marL; delete k.indent; }); return;
    }
    if (setParaProp(apply)) return;
    const objs = selObjs(); if (!objs.length) return;
    if (kind === 'bullet') { const st = caretStyle(); const on = st && st.bullet && JSON.stringify(st.bullet) === JSON.stringify(val); eachPara(objs, p => { p.bullet = on ? 'none' : val; delete p.marL; delete p.indent; }); }
    else eachPara(objs, p => { const l = { v: p.lvl || 0 }; apply(p, l); if (l.v) p.lvl = l.v; else delete p.lvl; });
    objs.forEach(fitGrow);
    commit('Format paragraph');
  }

  /* ---------- clipboard & keys ---------- */
  function copy(cut) {
    const objs = selObjs(); if (!objs.length) return;
    S.clip = { objs: objs.map(o => JSON.parse(JSON.stringify(o))), n: 0, assets: Object.fromEntries(objs.flatMap(o => { const ids = []; M.walk([o], x => { if (x.type === 'image') ids.push(x.asset); }); return ids; }).filter(id => S.assets[id]).map(id => [id, S.assets[id]])) };
    try { navigator.clipboard && navigator.clipboard.writeText(objs.map(o => o.text ? M.plainText(o.text) : '').filter(Boolean).join('\n')).catch(() => { }); } catch (_) { }
    if (cut) { del(); }
  }
  function paste() {
    if (!S.clip) return;
    S.clip.n++;
    const off = 20 * S.clip.n, list = target().main, ids = [];
    Object.assign(S.assets, S.clip.assets);
    for (const o of S.clip.objs) { const c = M.cloneObj(o); if (S.mode === 'slide' && c.ph && target().slide.objects.some(x => x.ph && x.ph.type === c.ph.type && x.ph.idx === c.ph.idx)) delete c.ph; M.translate(c, off, off); list.push(c); ids.push(c.id); }
    S.sel = ids; commit('Paste');
  }
  function onPaste(e) {
    if (te || e.target.closest && e.target.closest('input,textarea,[contenteditable=true]')) return;
    const files = [...(e.clipboardData && e.clipboardData.files || [])].filter(f => /^image\//.test(f.type));
    if (files.length) { e.preventDefault(); IO.insertImageFiles(files); return; }
    const t = e.clipboardData && e.clipboardData.getData('text/plain');
    if (S.clip) { e.preventDefault(); paste(); return; }
    if (t && t.trim()) { e.preventDefault(); const o = M.textBox(S.doc.w / 2 - 300, S.doc.h / 2 - 30, 600, 60, t.trim()); target().main.push(o); fitGrow(o); S.sel = [o.id]; commit('Paste text'); }
  }
  function del() {
    const objs = selObjs(); if (!objs.length) return;
    for (const o of objs) { const l = listOf(o.id); if (l && l !== S.doc.master.ph) l.splice(l.indexOf(o), 1); }
    const s = curSlide(); if (s && S.mode === 'slide') s.anims = s.anims.filter(a => byId(a.target));
    // a group left with one child is dissolved
    if (S.inGroup) { const g = byId(S.inGroup); if (g && g.children.length < 2) { const l = listOf(g.id); l.splice(l.indexOf(g), 1, ...g.children); S.inGroup = null; } else if (g) Object.assign(g, M.groupBounds(g.children)); }
    S.sel = []; commit('Delete');
  }
  function nudge(dx, dy) { const objs = selObjs(); if (!objs.length) return; objs.forEach(o => { M.translate(o, dx, dy); if (o.ph) o.ownGeo = true; }); commit('Nudge', { merge: true, panels: false }); UI.refresh(true); }
  function onKey(e) {
    if (te || S.preview || $('.aero-modal') || UI.showActive()) return;
    if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable=true]')) return;
    const k = e.key;
    if (k === 'Escape') { if (S.inGroup) { const g = S.inGroup; S.inGroup = null; select([g]); } else if (S.sel.length) select([]); else if (S.tool !== 'select') UI.setTool('select'); return; }
    if ((k === 'Enter' || k === 'F2') && S.sel.length === 1) { const o = byId(S.sel[0]); if (o && o.type === 'group') { S.inGroup = o.id; select([o.children[0].id], true); e.preventDefault(); return; } if (isText(o)) { e.preventDefault(); beginEdit(o, { selectAll: k === 'F2' }); } return; }
    if (k === 'Tab' && S.mode && topObjs().length) { e.preventDefault(); const L = topObjs(); const i = S.sel.length ? L.findIndex(o => o.id === S.sel[S.sel.length - 1]) : -1; const n = (i + (e.shiftKey ? -1 : 1) + L.length) % L.length; select([L[n].id]); return; }
    // typing replaces the text of a selected shape
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && S.sel.length === 1) { const o = byId(S.sel[0]); if (isText(o) && !o.locked) { e.preventDefault(); beginEdit(o, { selectAll: true, text: k }); } }
  }
  return { init, handles, lineEnds, setLine, hitTest, beginEdit, endEdit, placeEditor, editing, caretStyle, format, paraFormat, execFormat, copy, paste, del, nudge, cellRect, cellAt, fitGrow, selBox, syncLayoutPh, isText, toHTML, fromHTML };
})();
