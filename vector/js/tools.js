'use strict';
/* Lumen Vector — interactive tools, pointer dispatch and snapping. */
(function () {
  const $ = s => document.querySelector(s);
  const T = LV.tools = {};
  const vdist = (a, b) => LV.v(a).getDistance(LV.v(b));
  const constrain45 = (o, p) => { const d = p.subtract(o), a = Math.round(d.angle / 45) * 45, r = a * Math.PI / 180, len = d.x * Math.cos(r) + d.y * Math.sin(r); return o.add(new P.Point(Math.cos(r), Math.sin(r)).multiply(len)); };
  LV.constrain45 = constrain45;
  const ROT_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M6 15a7 7 0 1 0 2-9" fill="none" stroke="#fff" stroke-width="4"/><path d="M6 15a7 7 0 1 0 2-9" fill="none" stroke="#000" stroke-width="1.6"/><path d="M4 3l5 3-4 4z" fill="#000" stroke="#fff"/></svg>')}") 12 12, crosshair`;
  const PEN_CURSOR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="M2 2l9 3 4 7-3 3-7-4z" fill="#fff" stroke="#000" stroke-width="1.2"/><circle cx="7" cy="7" r="1.3"/></svg>')}") 2 2, crosshair`;
  const setCursor = c => { $('#view').style.cursor = c; };

  /* ---------------- snapping ---------------- */
  let snapData = null;
  LV.buildSnap = (exclude = []) => {
    const ex = new Set(); exclude.forEach(it => LV.leaves(it).concat([it]).forEach(x => ex.add(x)));
    const xs = [], ys = [], pts = [], boxes = [];
    const addB = (b, src) => { xs.push({ v: b.left, a: b.top, b: b.bottom }, { v: b.center.x, a: b.top, b: b.bottom }, { v: b.right, a: b.top, b: b.bottom }); ys.push({ v: b.top, a: b.left, b: b.right }, { v: b.center.y, a: b.left, b: b.right }, { v: b.bottom, a: b.left, b: b.right }); };
    LV.doc.artboards.forEach(ab => { const b = LV.boardRect(ab); addB(b); [b.topLeft, b.topRight, b.bottomLeft, b.bottomRight, b.center].forEach(p => pts.push(p)); });
    LV.doc.guides.x.forEach(x => xs.push({ v: x, a: -1e6, b: 1e6, guide: true })); LV.doc.guides.y.forEach(y => ys.push({ v: y, a: -1e6, b: 1e6, guide: true }));
    LV.allObjects().forEach(o => {
      if (ex.has(o) || !o.visible || !LV.ancestorsOk(o)) return;
      addB(o.bounds); boxes.push(o.bounds.clone());
      LV.leaves(o).forEach(l => { if (ex.has(l)) return; const segs = l instanceof P.Path ? l.segments : l instanceof P.CompoundPath ? l.children.flatMap(c => c.segments) : []; if (pts.length < 6000) segs.forEach(s => pts.push(l.localToGlobal(s.point))); });
    });
    snapData = { xs, ys, pts, boxes }; return snapData;
  };
  LV.clearSnap = () => { snapData = null; LV.smartLines = []; };
  const gridSnap = v => { const g = LV.prefs.gridSize; return Math.round(v / g) * g; };
  const tolPx = () => LV.tol(LV.prefs.snapTol || 6);
  // angle guides: snap the direction origin → pt to 0/45/90… and to multiples of the preference increment
  const ANG = () => { const inc = Math.max(1, +LV.prefs.angleInc || 45), out = new Set(); for (let a = 0; a < 360; a += 45) out.add(a); for (let a = 0; a < 360 - 1e-9; a += inc) out.add(Math.round(a * 1000) / 1000); return [...out]; };
  LV.angleSnap = (origin, pt) => {
    if (!LV.prefs.smart || !LV.prefs.smartAngles || !origin) return null;
    const v = pt.subtract(origin), len = v.length; if (len * P.view.zoom < 12) return null;
    let best = null, bd = tolPx();
    for (const a of ANG()) { const dir = new P.Point(Math.cos(a * Math.PI / 180), Math.sin(a * Math.PI / 180)), along = v.dot(dir); if (along <= 0) continue; const perp = Math.abs(v.x * dir.y - v.y * dir.x); if (perp < bd) { bd = perp; best = { a, dir, along }; } }
    if (!best) return null;
    const p = origin.add(best.dir.multiply(best.along)), shown = (360 - best.a) % 360;
    return { pt: p, dir: best.dir, a: shown, line: { a: origin, b: origin.add(best.dir.multiply(best.along + 40 / P.view.zoom)), label: LV.fmt(shown) + '°', angle: true } };
  };
  // snap a single point; returns {pt, lines}. origin: reference point for angle guides (pen / line / anchor drag)
  LV.snapPoint = (pt, { exclude, origin } = {}) => {
    if (!snapData) LV.buildSnap(exclude || LV.sel);
    const tol = tolPx(), lines = [];
    if (LV.prefs.snapPoint) {
      let best = null, bd = tol; for (const p of snapData.pts) { const d = p.getDistance(pt); if (d < bd) { bd = d; best = p; } }
      if (best) { LV.smartLines = [{ pt: best, label: 'anchor' }]; return { pt: best.clone(), lines: LV.smartLines }; }
    }
    let x = pt.x, y = pt.y, sx = null, sy = null;
    if (LV.prefs.smart || LV.prefs.guides) {
      let bx = tol; for (const c of snapData.xs) { if (!LV.prefs.smart && !c.guide) continue; const d = Math.abs(c.v - pt.x); if (d < bx) { bx = d; sx = c; } }
      let by = tol; for (const c of snapData.ys) { if (!LV.prefs.smart && !c.guide) continue; const d = Math.abs(c.v - pt.y); if (d < by) { by = d; sy = c; } }
    }
    const ang = !(sx && sy) && LV.angleSnap(origin, pt);
    if (ang) { // combine the angle guide with one alignment guide where possible (intersection), else follow the angle
      const d = ang.dir;
      if (sx && Math.abs(d.x) > 1e-6 && (sx.v - origin.x) / d.x > 0) { const t = (sx.v - origin.x) / d.x; x = sx.v; y = origin.y + d.y * t; sy = null; }
      else if (sy && Math.abs(d.y) > 1e-6 && (sy.v - origin.y) / d.y > 0) { const t = (sy.v - origin.y) / d.y; y = sy.v; x = origin.x + d.x * t; sx = null; }
      else { x = ang.pt.x; y = ang.pt.y; sx = sy = null; }
      ang.line.b = origin.add(d.multiply(new P.Point(x, y).subtract(origin).length + 40 / P.view.zoom));
      lines.push(ang.line);
    } else {
      if (sx) x = sx.v; else if (LV.prefs.snapGrid) x = gridSnap(x);
      if (sy) y = sy.v; else if (LV.prefs.snapGrid) y = gridSnap(y);
    }
    if (sx && !sx.guide) lines.push({ a: new P.Point(x, Math.min(sx.a, y)), b: new P.Point(x, Math.max(sx.b, y)) });
    if (sy && !sy.guide) lines.push({ a: new P.Point(Math.min(sy.a, x), y), b: new P.Point(Math.max(sy.b, x), y) });
    LV.smartLines = lines; return { pt: new P.Point(x, y), lines };
  };
  // equal-spacing guides along one axis for a moving box r (returns {off, lines} or null)
  function spacingSnap(r, horiz, tol) {
    const lo = horiz ? 'left' : 'top', hi = horiz ? 'right' : 'bottom', clo = horiz ? 'top' : 'left', chi = horiz ? 'bottom' : 'right';
    const row = snapData.boxes.filter(b => b[chi] > r[clo] && b[clo] < r[chi] && !(b[hi] > r[lo] + tol && b[lo] < r[hi] - tol));
    const before = row.filter(b => b[hi] <= r[lo] + tol).sort((a, b) => b[hi] - a[hi]), after = row.filter(b => b[lo] >= r[hi] - tol).sort((a, b) => a[lo] - b[lo]);
    const size = r[hi] - r[lo], L = before[0], Rb = after[0], cands = [];
    const gaps = []; for (let i = 0; i + 1 < before.length; i++) gaps.push([before[i + 1], before[i]]); for (let i = 0; i + 1 < after.length; i++) gaps.push([after[i], after[i + 1]]);
    if (L && Rb) cands.push({ start: (L[hi] + Rb[lo] - size) / 2, kind: 'center' });
    gaps.forEach(([p, q]) => { const g = q[lo] - p[hi]; if (g <= 0) return; if (L) cands.push({ start: L[hi] + g, kind: 'left', g, ref: [p, q] }); if (Rb) cands.push({ start: Rb[lo] - g - size, kind: 'right', g, ref: [p, q] }); });
    let best = null, bd = tol; cands.forEach(c => { const d = Math.abs(c.start - r[lo]); if (d < bd) { bd = d; best = c; } });
    if (!best) return null;
    const off = best.start - r[lo], s = best.start, e = best.start + size;
    const mid = (p, q) => (Math.max(p[clo], q[clo]) + Math.min(p[chi], q[chi])) / 2;
    const mk = (a, b, c) => horiz ? { a: new P.Point(a, c), b: new P.Point(b, c), label: LV.fmt(b - a), gap: true } : { a: new P.Point(c, a), b: new P.Point(c, b), label: LV.fmt(b - a), gap: true };
    const lines = [], me = { [clo]: r[clo], [chi]: r[chi] };
    if (L && best.kind !== 'right') lines.push(mk(L[hi], s, mid(L, me)));
    if (Rb && best.kind !== 'left') lines.push(mk(e, Rb[lo], mid(Rb, me)));
    if (best.ref) lines.push(mk(best.ref[0][hi], best.ref[1][lo], mid(best.ref[0], best.ref[1])));
    return { off, lines, d: bd };
  }
  // snap a moving rectangle: returns adjusted delta
  LV.snapMove = (b0, d) => {
    if (!snapData) LV.buildSnap(LV.sel);
    const tol = tolPx(), lines = []; let dx = d.x, dy = d.y;
    if (LV.prefs.smart || LV.prefs.guides) {
      const cxs = [b0.left, b0.center.x, b0.right], cys = [b0.top, b0.center.y, b0.bottom];
      let bx = tol, hx = null; for (const c of snapData.xs) { if (!LV.prefs.smart && !c.guide) continue; for (const v of cxs) { const dd = Math.abs(c.v - (v + d.x)); if (dd < bx) { bx = dd; hx = { c, off: c.v - v }; } } }
      let by = tol, hy = null; for (const c of snapData.ys) { if (!LV.prefs.smart && !c.guide) continue; for (const v of cys) { const dd = Math.abs(c.v - (v + d.y)); if (dd < by) { by = dd; hy = { c, off: c.v - v }; } } }
      let gx = null, gy = null;
      if (LV.prefs.smart && LV.prefs.smartSpacing) { // equal spacing wins over a weaker alignment snap
        const moved = (ox, oy) => new P.Rectangle(b0.x + ox, b0.y + oy, b0.width, b0.height);
        gx = spacingSnap(moved(d.x, hy ? hy.off : d.y), true, tol); gy = spacingSnap(moved(hx ? hx.off : d.x, d.y), false, tol);
        if (gx && hx && bx < gx.d - 1e-9) gx = null; if (gy && hy && by < gy.d - 1e-9) gy = null;
      }
      if (gx) { dx = d.x + gx.off; hx = null; }
      if (gy) { dy = d.y + gy.off; hy = null; }
      if (hx) { dx = hx.off; if (!hx.c.guide) lines.push({ a: new P.Point(hx.c.v, Math.min(hx.c.a, b0.top + dy)), b: new P.Point(hx.c.v, Math.max(hx.c.b, b0.bottom + dy)) }); }
      if (hy) { dy = hy.off; if (!hy.c.guide) lines.push({ a: new P.Point(Math.min(hy.c.a, b0.left + dx), hy.c.v), b: new P.Point(Math.max(hy.c.b, b0.right + dx), hy.c.v) }); }
      // gap markers are placed after the final delta is known
      const fin = new P.Rectangle(b0.x + dx, b0.y + dy, b0.width, b0.height);
      if (gx) lines.push(...(spacingSnap(fin, true, 1e-6 + LV.tol(0.5)) || gx).lines);
      if (gy) lines.push(...(spacingSnap(fin, false, 1e-6 + LV.tol(0.5)) || gy).lines);
      // angle guide for the move direction when nothing else snapped
      if (!hx && !hy && !gx && !gy) { const ag = LV.angleSnap(b0.center, b0.center.add(d)); if (ag) { const nd = ag.pt.subtract(b0.center); dx = nd.x; dy = nd.y; lines.push(ag.line); } }
      const angled = lines.some(l => l.angle);
      if (!hx && !gx && !angled && LV.prefs.snapGrid) dx = gridSnap(b0.left + d.x) - b0.left;
      if (!hy && !gy && !angled && LV.prefs.snapGrid) dy = gridSnap(b0.top + d.y) - b0.top;
    } else if (LV.prefs.snapGrid) { dx = gridSnap(b0.left + d.x) - b0.left; dy = gridSnap(b0.top + d.y) - b0.top; }
    LV.smartLines = lines; return new P.Point(dx, dy);
  };

  /* ---------------- shared helpers ---------------- */
  LV.touchesRect = (it, r) => {
    const b = it.bounds; if (r.contains(b)) return true; if (!r.intersects(b)) return false;
    const rp = new P.Path.Rectangle({ rectangle: r, insert: false });
    return LV.leaves(it).some(l => {
      if (!LV.isPathItem(l)) return r.intersects(l.bounds);
      if (l.getIntersections(rp).length) return true;
      const p0 = l instanceof P.Path ? l.firstSegment?.point : l.firstChild?.firstSegment?.point;
      if (p0 && r.contains(l.localToGlobal(p0))) return true;
      return l.hasFill() && l.contains(r.center);
    });
  };
  function handleHit(vp, r) {
    const hp = LV.handlePositions(r);
    for (let i = 0; i < 8; i++) if (vp.getDistance(hp[i]) <= 6) return { type: 'scale', idx: i };
    const tl = hp[0], br = hp[4], inside = vp.x > tl.x - 2 && vp.x < br.x + 2 && vp.y > tl.y - 2 && vp.y < br.y + 2;
    if (!inside) for (const i of [0, 2, 4, 6]) if (vp.getDistance(hp[i]) < 24) return { type: 'rotate', idx: i };
    return null;
  }
  const SCALE_CURSORS = ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'];
  const boxPoint = (r, i) => [r.topLeft, r.topCenter, r.topRight, r.rightCenter, r.bottomRight, r.bottomCenter, r.bottomLeft, r.leftCenter][i];
  function guideHit(vp) {
    if (!LV.prefs.guides) return null;
    for (const [i, x] of LV.doc.guides.x.entries()) if (Math.abs(LV.v(new P.Point(x, 0)).x - vp.x) < 4) return { axis: 'x', i };
    for (const [i, y] of LV.doc.guides.y.entries()) if (Math.abs(LV.v(new P.Point(0, y)).y - vp.y) < 4) return { axis: 'y', i };
    return null;
  }
  /* text-frame ports (threading): in-port at the frame's top-left, out-port at its bottom-right */
  const portsOf = g => { const s = g.children.find(c => c.data.role === 'frame').segments; return { inP: LV.v(s[0].point), outP: LV.v(s[2].point) }; };
  function threadPortHit(vp) {
    if (LV.toolId !== 'select' || LV.sel.length !== 1 || LV.kind(LV.sel[0]) !== 'areatext') return null;
    const g = LV.sel[0], { outP } = portsOf(g); return outP.getDistance(vp) <= 7 ? g : null;
  }
  LV.overlays = LV.overlays || [];
  LV.overlays.push(ctx => {
    const frames = LV.sel.filter(it => LV.kind(it) === 'areatext' && it.parent); if (!frames.length || LV.textEditing) return;
    const box = (p, fill) => { ctx.fillStyle = fill; ctx.strokeStyle = LV.SEL_COLOR; ctx.lineWidth = 1; ctx.fillRect(Math.round(p.x) - 4, Math.round(p.y) - 4, 9, 9); ctx.strokeRect(Math.round(p.x) - 3.5, Math.round(p.y) - 3.5, 8, 8); };
    const tri = p => { ctx.fillStyle = LV.SEL_COLOR; ctx.beginPath(); ctx.moveTo(p.x - 2, p.y - 3); ctx.lineTo(p.x + 3, p.y + 0.5); ctx.lineTo(p.x - 2, p.y + 4); ctx.closePath(); ctx.fill(); };
    const drawn = new Set();
    frames.forEach(sel => {
      const chain = sel.data.next || sel.data.prev ? LV.threadChain(sel) : [sel];
      chain.forEach((g, i) => {
        if (drawn.has(g)) return; drawn.add(g);
        const { inP, outP } = portsOf(g), next = chain[i + 1];
        if (g !== sel && chain.length > 1) { ctx.strokeStyle = 'rgba(47,122,229,.55)'; ctx.setLineDash([3, 2]); ctx.beginPath(); LV.tracePath(ctx, g); ctx.stroke(); ctx.setLineDash([]); }
        box(inP, '#fff'); if (i > 0) tri(inP);
        if (next) { const n = portsOf(next).inP; ctx.strokeStyle = LV.SEL_COLOR; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(outP.x, outP.y); ctx.bezierCurveTo(outP.x + 40, outP.y, n.x - 40, n.y, n.x, n.y); ctx.stroke(); box(outP, '#fff'); tri(outP); }
        else if (g.data.overflow) { box(outP, '#fff'); ctx.strokeStyle = '#e0261b'; ctx.beginPath(); ctx.moveTo(outP.x - 2, outP.y + .5); ctx.lineTo(outP.x + 3, outP.y + .5); ctx.moveTo(outP.x + .5, outP.y - 2); ctx.lineTo(outP.x + .5, outP.y + 3); ctx.stroke(); }
        else box(outP, '#fff');
      });
    });
    if (LV.threadLoad && LV.hover && LV.hover !== LV.threadLoad) { ctx.strokeStyle = LV.SEL_COLOR; ctx.lineWidth = 2; ctx.beginPath(); LV.tracePath(ctx, LV.hover); ctx.stroke(); }
  });
  LV.overlays.push(ctx => LV.live.drawWidgets(ctx));
  LV.duplicateSel = () => { const c = LV.sel.map(it => LV.reUid(it.clone())); LV.setSel(c); return c; };
  LV.transformSel = (m) => { LV.sel.forEach(it => { it.transform(m); afterTransform(it); }); };
  function afterTransform(it) { // keep text frames / text on path consistent after transforms
    const walk = x => { const k = LV.kind(x); if (k === 'areatext') LV.reflow(x); else if (k === 'pathtext') LV.layoutPathText(x); else (x.children || []).forEach(walk); };
    walk(it);
  }
  LV.afterTransform = afterTransform;

  /* ---------------- Selection tool ---------------- */
  T.select = {
    name: 'Selection', showBBox: true, cursor: 'default',
    down(ev) {
      this.mode = null; this.changed = false; const r = LV.selBounds();
      if (LV.threadLoad) { // loaded text cursor: click a frame / closed path to link it, click or drag on empty canvas for a new frame
        const hit = LV.hitTest(ev.pt);
        this.mode = 'threadNew'; this.threadHit = hit && hit !== LV.threadLoad && (LV.kind(hit) === 'areatext' || (LV.isPathItem(hit) && hit.closed !== false)) ? hit : null; return;
      }
      const lw = LV.live.widgetHit(ev.vp);
      if (lw) { this.mode = 'live'; this.live = LV.live.dragStart(lw, ev); return; }
      const port = threadPortHit(ev.vp);
      if (port) { LV.threadLoad = port; setCursor('copy'); LV.toast('Click a text frame or closed shape to link it, or click / drag on the canvas for a new frame (Esc cancels)'); this.mode = 'port'; return; }
      if (r && LV.prefs.bbox) {
        const h = handleHit(ev.vp, r);
        if (h) {
          this.mode = h.type; this.idx = h.idx; this.b0 = r.clone(); this.prev = h.type === 'scale' ? new P.Point(1, 1) : 0;
          this.anchor = ev.alt ? r.center : boxPoint(r, (h.idx + 4) % 8); this.h0 = boxPoint(r, h.idx); this.alt = ev.alt;
          LV.buildSnap(LV.sel); return;
        }
      }
      const hit = LV.hitTest(ev.pt);
      if (hit) {
        if (ev.shift) { LV.toggleSel(hit); if (!LV.sel.includes(hit)) return; }
        else if (!LV.sel.includes(hit)) LV.setSel([hit]);
        this.mode = 'move'; this.dup = ev.alt; this.applied = new P.Point(0, 0); this.b0 = LV.selBounds(); LV.buildSnap(LV.sel); return;
      }
      const g = guideHit(ev.vp);
      if (g) { this.mode = 'guide'; this.g = g; return; }
      if (!ev.shift) LV.setSel([]);
      this.mode = 'marquee'; this.shiftAdd = ev.shift;
    },
    drag(ev) {
      const m = this.mode;
      if (m === 'move') {
        let target = ev.shift ? constrain45(ev.down, ev.pt) : ev.pt, d = target.subtract(ev.down);
        if (this.dup && !this.duped) { LV.duplicateSel(); this.duped = true; }
        if (!ev.shift) d = LV.snapMove(this.b0, d); else LV.smartLines = [];
        const inc = d.subtract(this.applied); if (!inc.isZero()) { LV.sel.forEach(it => it.translate(inc)); this.changed = true; }
        this.applied = d; LV.status(`Δx ${LV.fmt(d.x)}  Δy ${LV.fmt(d.y)}`);
      } else if (m === 'scale') {
        let p = ev.pt; if (!ev.shift) p = LV.snapPoint(p, { exclude: LV.sel }).pt;
        const v0 = this.h0.subtract(this.anchor), v = p.subtract(this.anchor), i = this.idx;
        let sx = (i === 1 || i === 5) ? 1 : (Math.abs(v0.x) > 1e-9 ? v.x / v0.x : 1), sy = (i === 3 || i === 7) ? 1 : (Math.abs(v0.y) > 1e-9 ? v.y / v0.y : 1);
        if (ev.shift) { if (i % 2 === 0) { const s = Math.max(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx || 1) * s; sy = Math.sign(sy || 1) * s; } else if (i === 1 || i === 5) sx = Math.abs(sy); else sy = Math.abs(sx); }
        const g = x => Math.abs(x) < 1e-3 ? (x < 0 ? -1e-3 : 1e-3) : x; sx = g(sx); sy = g(sy);
        const mm = new P.Matrix().scale(sx / this.prev.x, sy / this.prev.y, this.anchor);
        LV.sel.forEach(it => it.transform(mm)); this.prev = new P.Point(sx, sy); this.changed = true;
        LV.status(`W ${LV.fmt(Math.abs(this.b0.width * sx))}  H ${LV.fmt(Math.abs(this.b0.height * sy))}  (${Math.round(sx * 100)}% × ${Math.round(sy * 100)}%)`);
      } else if (m === 'rotate') {
        const c = this.b0.center; let a = ev.pt.subtract(c).angle - ev.down.subtract(c).angle;
        if (ev.shift) a = Math.round(a / 45) * 45;
        LV.sel.forEach(it => it.rotate(a - this.prev, c)); this.prev = a; this.changed = true;
        LV.status(`Rotate ${LV.fmt(((a % 360) + 540) % 360 - 180)}°`);
      } else if (m === 'marquee' || (m === 'threadNew' && !this.threadHit)) LV.marquee = new P.Rectangle(ev.down, ev.pt);
      else if (m === 'live') { if (this.live) { LV.live.dragMove(this.live, ev); this.changed = true; } }
      else if (m === 'guide') {
        const arr = LV.doc.guides[this.g.axis]; arr[this.g.i] = this.g.axis === 'x' ? ev.pt.x : ev.pt.y; this.changed = true;
      }
      LV.redraw();
    },
    up(ev) {
      const m = this.mode; this.mode = null;
      if (m === 'threadNew') {
        const src = LV.threadLoad, r = LV.marquee; LV.threadLoad = null; LV.marquee = null; setCursor('default');
        if (!src || !src.parent) return;
        let target = this.threadHit;
        if (!target) {
          const g0 = LV.areaGeom(src), rect = r && r.width * P.view.zoom > 8 && r.height * P.view.zoom > 8 ? r : new P.Rectangle(ev.down, new P.Size(g0.W, g0.H));
          target = LV.newAreaText(rect, '', LV.textStyleOf(src)); target.name = 'Area Type'; target.insertAbove(src); LV.uidOf(target);
        }
        const linked = LV.threadLink(src, target);
        if (linked) { LV.setSel([linked]); LV.commit('Thread Text'); } else { LV.toast('Only text frames and closed shapes can be threaded'); LV.redraw(); }
        return;
      }
      if (m === 'live') { this.live = null; if (this.changed) LV.commit('Edit Shape'); LV.status(''); LV.emit('selection'); return; }
      if (m === 'port') return;
      if (m === 'marquee' && LV.marquee) {
        const r = LV.marquee; LV.marquee = null;
        if (r.width * P.view.zoom > 2 || r.height * P.view.zoom > 2) {
          const items = LV.allObjects().filter(o => LV.ancestorsOk(o) && o.visible && !o.locked && LV.touchesRect(o, r));
          LV.setSel(this.shiftAdd ? [...new Set([...LV.sel, ...items])] : items);
        }
      } else if (m === 'move' && this.changed) {
        LV.lastTransform = { m: new P.Matrix().translate(this.applied), copy: this.dup };
        LV.commit(this.dup ? 'Duplicate' : 'Move');
      } else if (m === 'scale' && this.changed) {
        LV.sel.forEach(afterTransform);
        LV.lastTransform = { m: new P.Matrix().scale(this.prev.x, this.prev.y, this.anchor), copy: false, rel: 'scale', sx: this.prev.x, sy: this.prev.y };
        LV.commit('Scale');
      } else if (m === 'rotate' && this.changed) {
        LV.sel.forEach(it => { it.data.rot = (((it.data.rot || 0) + this.prev) % 360 + 540) % 360 - 180; afterTransform(it); });
        LV.lastTransform = { m: new P.Matrix().rotate(this.prev, this.b0.center), copy: false, rel: 'rotate', angle: this.prev };
        LV.commit('Rotate');
      } else if (m === 'guide' && this.changed) {
        const vp = ev.vp; if (vp.x < 0 || vp.y < 0) LV.doc.guides[this.g.axis].splice(this.g.i, 1);
        LV.commit('Move Guide');
      }
      this.duped = false; LV.clearSnap(); LV.redraw(); LV.emit('selection');
    },
    move(ev) {
      if (LV.threadLoad) { LV.hover = LV.hitTest(ev.pt); setCursor('copy'); LV.redraw(); return; }
      if (LV.live.widgetHit(ev.vp) || threadPortHit(ev.vp)) { LV.hover = null; setCursor('pointer'); LV.redraw(); return; }
      const r = LV.selBounds(), h = r && LV.prefs.bbox && handleHit(ev.vp, r);
      LV.hover = h ? null : LV.hitTest(ev.pt);
      setCursor(h ? (h.type === 'rotate' ? ROT_CURSOR : SCALE_CURSORS[h.idx]) : guideHit(ev.vp) && !LV.hover ? 'move' : 'default');
      LV.redraw();
    },
    deactivate() { LV.threadLoad = null; },
    dbl(ev) {
      const hit = LV.hitTest(ev.pt);
      if (!hit) { if (LV.isoRoot()) LV.sym.finishEdit(); return; }
      if (LV.kind(hit) === 'symbol') { LV.sym.edit(hit); return; }
      if (LV.isTextLike(hit)) { LV.setTool('type'); LV.beginTextEdit(hit); return; }
      if (hit instanceof P.Group) { const leaf = LV.hitTest(ev.pt, { leaf: true }); let c = leaf; while (c && c.parent !== hit) c = c.parent; if (c) LV.setSel([c]); }
    }
  };

  /* ---------------- Direct Selection tool ---------------- */
  const pathsOf = items => { const out = []; items.forEach(it => LV.leaves(it).forEach(l => { if (l instanceof P.Path) out.push(l); else if (l instanceof P.CompoundPath) out.push(...l.children); else if (l.data.kind === 'pathtext') out.push(l.children.find(c => c.data.role === 'guide')); })); return out.filter(Boolean); };
  LV.pathsOf = pathsOf;
  const isSmooth = s => !s.handleIn.isZero() && !s.handleOut.isZero() && Math.abs(Math.abs(s.handleIn.angle - s.handleOut.angle) - 180) < 3;
  const anchorAt = (paths, vp) => { for (const p of paths) for (const s of p.segments) if (LV.v(p.localToGlobal(s.point)).getDistance(vp) <= 5) return s; return null; };
  const ownerOf = path => { let o = path; while (o.parent && (o.parent instanceof P.CompoundPath || o.parent.data.kind === 'pathtext')) o = o.parent; return o; };
  T.direct = {
    name: 'Direct Selection', showAnchors: true, cursor: 'default',
    down(ev) {
      this.mode = null; this.changed = false;
      const selPaths = pathsOf(LV.sel);
      // 1. handles of selected anchors
      for (const p of selPaths) for (const s of p.segments) {
        const near = [s.previous, s, s.next].some(x => x && LV.selSegs.has(x)); if (!near) continue;
        for (const k of ['handleIn', 'handleOut']) {
          if (s[k].isZero()) continue;
          if (LV.v(p.localToGlobal(s.point.add(s[k]))).getDistance(ev.vp) <= 5) { this.mode = 'handle'; this.seg = s; this.key = k; this.smooth = isSmooth(s); return; }
        }
      }
      // 2. anchors of selected paths, then anything under the cursor
      let seg = anchorAt(selPaths, ev.vp), leaf = null;
      if (!seg) { leaf = LV.hitTest(ev.pt, { leaf: true }); if (leaf) seg = anchorAt(pathsOf([leaf]), ev.vp); }
      if (seg) {
        const owner = ownerOf(seg.path);
        if (ev.shift) { const s = new Set(LV.selSegs); s.has(seg) ? s.delete(seg) : s.add(seg); LV.setSel([...new Set([...LV.sel, owner])], [...s]); }
        else if (!LV.selSegs.has(seg)) LV.setSel([owner], [seg]);
        this.mode = 'segs'; this.grab = seg; this.last = seg.path.localToGlobal(seg.point); this.origin = this.last.clone(); LV.buildSnap([]); return;
      }
      if (leaf) {
        const owner = leaf instanceof P.Path ? ownerOf(leaf) : leaf;
        if (leaf instanceof P.Path) {
          const loc = leaf.getNearestLocation(leaf.globalToLocal(ev.pt));
          if (loc && LV.v(leaf.localToGlobal(loc.point)).getDistance(ev.vp) <= 5 && loc.curve) {
            if (!ev.shift) LV.setSel([owner]); else LV.addSel(owner);
            const c = loc.curve;
            if (c.hasHandles()) { this.mode = 'bend'; this.curve = c; this.t = loc.time; this.last = ev.pt; }
            else { LV.setSel(LV.sel, [c.segment1, c.segment2]); this.mode = 'segs'; this.grab = c.segment1; this.last = ev.pt; this.free = true; }
            return;
          }
        }
        const segs = pathsOf([owner]).flatMap(p => p.segments);
        if (ev.shift) LV.setSel([...new Set([...LV.sel, owner])], [...LV.selSegs, ...segs]); else LV.setSel([owner], segs);
        this.mode = segs.length ? 'segs' : 'item'; this.last = ev.pt; this.free = true; this.applied = new P.Point(0, 0); return;
      }
      if (!ev.shift) LV.setSel([]);
      this.mode = 'marquee';
    },
    drag(ev) {
      const m = this.mode;
      if (m === 'segs') {
        let target = ev.pt;
        if (ev.shift) target = constrain45(ev.down, ev.pt);
        else if (!this.free) target = LV.snapPoint(ev.pt, { exclude: [], origin: this.origin }).pt;
        const inc = target.subtract(this.last); this.last = target;
        if (!inc.isZero()) { LV.selSegs.forEach(s => { s.point = s.path.globalToLocal(s.path.localToGlobal(s.point).add(inc)); }); this.changed = true; }
        LV.sel.forEach(o => { if (o.data.kind === 'pathtext') LV.layoutPathText(o); });
      } else if (m === 'item') { const inc = ev.pt.subtract(this.last); this.last = ev.pt; LV.sel.forEach(o => o.translate(inc)); this.changed = true; }
      else if (m === 'handle') {
        const s = this.seg, h = s.path.globalToLocal(ev.pt).subtract(s.point);
        s[this.key] = h;
        const other = this.key === 'handleIn' ? 'handleOut' : 'handleIn';
        if (this.smooth && !ev.alt) s[other] = h.normalize(-s[other].length);
        this.changed = true; const o = ownerOf(s.path); if (o.data.kind === 'pathtext') LV.layoutPathText(o);
      } else if (m === 'bend') {
        const c = this.curve, t = this.t, d = ev.pt.subtract(this.last); this.last = ev.pt;
        const b1 = 3 * (1 - t) * (1 - t) * t, b2 = 3 * (1 - t) * t * t, den = b1 * b1 + b2 * b2;
        if (den > 1e-9) { const dl = c.path.globalToLocal(c.path.localToGlobal(c.point1).add(d)).subtract(c.point1); c.handle1 = c.handle1.add(dl.multiply(b1 / den)); c.handle2 = c.handle2.add(dl.multiply(b2 / den)); this.changed = true; }
      } else if (m === 'marquee') LV.marquee = new P.Rectangle(ev.down, ev.pt);
      LV.redraw();
    },
    up(ev) {
      const m = this.mode; this.mode = null; this.free = false;
      if (m === 'marquee' && LV.marquee) {
        const r = LV.marquee; LV.marquee = null;
        const owners = new Set(), segs = [];
        LV.allObjects().forEach(o => { if (!o.visible || o.locked || !LV.ancestorsOk(o) || !r.intersects(o.bounds)) return; pathsOf([o]).forEach(p => p.segments.forEach(s => { if (r.contains(p.localToGlobal(s.point))) { segs.push(s); owners.add(ownerOf(p)); } })); });
        if (ev.shift) LV.setSel([...new Set([...LV.sel, ...owners])], [...LV.selSegs, ...segs]); else LV.setSel([...owners], segs);
      } else if (this.changed) { LV.sel.forEach(o => { if (LV.kind(o) === 'areatext') LV.reflow(o); }); LV.commit(m === 'handle' ? 'Edit Handle' : m === 'bend' ? 'Reshape Curve' : m === 'item' ? 'Move' : 'Move Anchors'); }
      LV.clearSnap(); LV.redraw(); LV.emit('selection');
    },
    move(ev) { LV.hover = LV.hitTest(ev.pt, { leaf: true }); setCursor(anchorAt(pathsOf(LV.sel), ev.vp) ? 'pointer' : 'default'); LV.redraw(); }
  };

  /* ---------------- Pen tool ---------------- */
  T.pen = {
    name: 'Pen', showAnchors: true, cursor: PEN_CURSOR, path: null,
    reset() { this.path = null; this.seg = null; },
    deactivate() { this.finish(); },
    finish() {
      const p = this.path; this.path = null; this.seg = null;
      if (p && p.parent) { if (p.segments.length < 2) { p.remove(); LV.setSel([]); } else { LV.setSel([p]); LV.commit('Pen Path'); } }
      LV.redraw();
    },
    key(e) { if (e.key === 'Enter' || e.key === 'Escape') { if (this.path) { this.finish(); return true; } } return false; },
    down(ev) {
      this.mode = null;
      let pt = ev.pt;
      if (this.path && this.path.parent) {
        const last = this.path.lastSegment.point, first = this.path.firstSegment.point;
        if (this.path.segments.length > 1 && vdist(ev.pt, first) < 7) { this.path.closed = true; this.seg = this.path.firstSegment; this.mode = 'close'; return; }
        pt = ev.shift ? constrain45(last, pt) : LV.snapPoint(pt, { exclude: [this.path], origin: last }).pt;
        this.seg = this.path.add(pt); this.mode = 'new'; return;
      }
      // editing existing selected paths: continue / delete / add / convert
      const paths = pathsOf(LV.sel);
      const seg = anchorAt(paths, ev.vp);
      if (seg) {
        const p = seg.path;
        if (!p.closed && (seg.isFirst() || seg.isLast()) && !ev.alt && !(p.parent instanceof P.CompoundPath)) {
          if (seg.isFirst()) p.reverse();
          this.path = p; this.seg = p.lastSegment; this.mode = 'cont'; LV.setSel([p]); LV.toast?.('Continuing path'); return;
        }
        if (ev.alt) { // convert anchor point
          if (seg.hasHandles()) { seg.handleIn = null; seg.handleOut = null; } else seg.smooth({ type: 'catmull-rom' });
          LV.commit('Convert Anchor'); return;
        }
        if (p.segments.length > 2) { seg.remove(); LV.selSegs.delete(seg); LV.commit('Delete Anchor'); return; }
      }
      for (const p of paths) {
        const loc = p.getNearestLocation(p.globalToLocal(ev.pt));
        if (loc && LV.v(p.localToGlobal(loc.point)).getDistance(ev.vp) <= 5) { const s = p.divideAt(loc.offset); if (s) { LV.setSel(LV.sel, [s]); LV.commit('Add Anchor'); return; } }
      }
      pt = LV.snapPoint(pt, { exclude: [] }).pt;
      const path = new P.Path({ segments: [pt], insert: false }); LV.applyDefaultPaint(path); LV.insert(path);
      this.path = path; this.seg = path.firstSegment; this.mode = 'new'; LV.setSel([path]);
    },
    drag(ev) {
      if (!this.seg) return;
      const d = ev.pt.subtract(this.seg.point);
      if (this.mode === 'new' || this.mode === 'cont') { this.seg.handleOut = d; if (!ev.alt) this.seg.handleIn = d.negate(); }
      else if (this.mode === 'close') { this.seg.handleIn = d.negate(); if (!ev.alt) this.seg.handleOut = d; }
      LV.redraw();
    },
    up() { LV.clearSnap(); if (this.mode === 'close') this.finish(); this.mode = null; LV.redraw(); },
    move(ev) {
      this.hoverPt = ev.pt;
      if (this.path && this.path.parent) { if (ev.shift) this.hoverPt = constrain45(this.path.lastSegment.point, ev.pt); else this.hoverPt = LV.snapPoint(ev.pt, { exclude: [this.path], origin: this.path.lastSegment.point }).pt; }
      else {
        const paths = pathsOf(LV.sel), seg = anchorAt(paths, ev.vp);
        let hint = '';
        if (seg) hint = !seg.path.closed && (seg.isFirst() || seg.isLast()) ? 'continue' : ev.alt ? 'convert' : 'delete';
        else for (const p of paths) { const loc = p.getNearestLocation(p.globalToLocal(ev.pt)); if (loc && LV.v(p.localToGlobal(loc.point)).getDistance(ev.vp) <= 5) hint = 'add'; }
        this.hint = hint; LV.status(hint ? { continue: 'Click to continue this path', convert: 'Alt-click: convert anchor point', delete: 'Click to delete anchor point', add: 'Click to add an anchor point' }[hint] : 'Click for corner points, drag for curves');
      }
      LV.redraw();
    },
    overlay(ctx) {
      const p = this.path; if (!p || !p.parent || !this.hoverPt || this.mode) return;
      const last = p.lastSegment, a = LV.v(last.point), c1 = LV.v(last.point.add(last.handleOut)), b = LV.v(this.hoverPt);
      ctx.strokeStyle = LV.SEL_COLOR; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(c1.x, c1.y, b.x, b.y, b.x, b.y); ctx.stroke();
      if (p.segments.length > 1 && vdist(this.hoverPt, p.firstSegment.point) < 7) { const f = LV.v(p.firstSegment.point); ctx.beginPath(); ctx.arc(f.x, f.y, 6, 0, Math.PI * 2); ctx.stroke(); }
    }
  };

  /* ---------------- Pencil ---------------- */
  T.pencil = {
    name: 'Pencil', cursor: 'crosshair',
    down(ev) { const p = new P.Path({ segments: [ev.pt], insert: false }); p.strokeColor = LV.specToColor(LV.paint.stroke || '#1d2733'); p.strokeWidth = LV.paint.strokeWidth || 1; p.strokeCap = 'round'; p.strokeJoin = 'round'; this.path = LV.insert(p); },
    drag(ev) { if (this.path && vdist(this.path.lastSegment.point, ev.pt) >= 2) { this.path.add(ev.pt); LV.redraw(); } },
    up(ev) {
      const p = this.path; this.path = null; if (!p) return;
      if (p.segments.length < 2) { p.remove(); return; }
      const closeIt = p.segments.length > 4 && vdist(p.firstSegment.point, p.lastSegment.point) < 10;
      p.simplify(Math.max(0.2, LV.shape.smooth * 0.6) / P.view.zoom);
      if (closeIt) { p.lastSegment.remove(); p.closed = true; }
      LV.setSel([p]); LV.commit('Pencil');
    }
  };

  /* ---------------- Shapes ---------------- */
  function makeShape(kind, a, b, ev) {
    let item;
    if (kind === 'line') { const e = ev.shift ? constrain45(a, b) : b; item = new P.Path.Line({ from: a, to: e, insert: false }); }
    else if (kind === 'polygon' || kind === 'star') {
      const r = Math.max(b.getDistance(a), 0.5), ang = ev.shift ? 0 : b.subtract(a).angle + 90;
      item = kind === 'polygon' ? LV.live.polygon(a, LV.shape.sides, r, ang) : LV.live.star(a, LV.shape.points, r, r * LV.shape.inner / 100, ang);
    } else {
      let w = b.x - a.x, h = b.y - a.y;
      if (ev.shift) { const s = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * s; h = Math.sign(h || 1) * s; }
      const rect = ev.alt ? new P.Rectangle(a.subtract([w, h]), a.add([w, h])) : new P.Rectangle(a, a.add([w, h]));
      if (rect.width < 0.01 || rect.height < 0.01) return null;
      item = kind === 'ellipse' ? LV.live.ellipse(rect) : LV.live.rect(rect, kind === 'rounded' ? Math.max(0, LV.shape.radius) : 0);
    }
    if (kind === 'line') { item.strokeColor = LV.specToColor(LV.paint.stroke || '#1d2733'); item.strokeWidth = LV.paint.strokeWidth || 1; }
    else LV.applyDefaultPaint(item);
    item.name = { rect: 'Rectangle', rounded: 'Rounded Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', line: 'Line' }[kind];
    return item;
  }
  function shapeDialog(kind, at) {
    const S = LV.shape, f = { rect: [['w', 'Width', 100], ['h', 'Height', 100]], rounded: [['w', 'Width', 100], ['h', 'Height', 100], ['r', 'Corner radius', S.radius]], ellipse: [['w', 'Width', 100], ['h', 'Height', 100]], polygon: [['r', 'Radius', 50], ['n', 'Sides', S.sides]], star: [['r', 'Radius 1', 50], ['r2', 'Radius 2', 25], ['n', 'Points', S.points]], line: [['l', 'Length', 100], ['a', 'Angle', 0]] }[kind];
    Aero.dialog({
      title: { rect: 'Rectangle', rounded: 'Rounded Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', line: 'Line Segment' }[kind], instruction: 'Create the shape at the clicked point',
      fields: f.map(([key, label, value]) => ({ key, label, type: 'number', value, min: 0 })),
      onOK: v => {
        let item;
        if (!(v.r >= 0) && kind !== 'rect' && kind !== 'ellipse' && kind !== 'line') return;
        if (kind === 'polygon') { item = LV.live.polygon(at, v.n, v.r); S.sides = Math.max(3, v.n | 0); }
        else if (kind === 'star') { item = LV.live.star(at, v.n, v.r, v.r2); S.points = Math.max(3, v.n | 0); }
        else if (kind === 'line') { const r = v.a * Math.PI / 180; item = new P.Path.Line({ from: at, to: at.add([Math.cos(r) * v.l, -Math.sin(r) * v.l]), insert: false }); }
        else if (kind === 'ellipse') { if (!(v.w > 0 && v.h > 0)) return; item = LV.live.ellipse(new P.Rectangle(at, new P.Size(v.w, v.h))); }
        else { if (!(v.w > 0 && v.h > 0)) return; item = LV.live.rect(new P.Rectangle(at, new P.Size(v.w, v.h)), kind === 'rounded' ? Math.max(0, v.r) : 0); if (kind === 'rounded') S.radius = v.r; }
        if (kind === 'line') { item.strokeColor = LV.specToColor(LV.paint.stroke || '#1d2733'); item.strokeWidth = LV.paint.strokeWidth || 1; } else LV.applyDefaultPaint(item);
        item.name = { rect: 'Rectangle', rounded: 'Rounded Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', line: 'Line' }[kind];
        LV.insert(item); LV.setSel([item]); LV.commit(item.name);
      }
    });
  }
  const shapeTool = (kind, name) => ({
    name, cursor: 'crosshair', showBBox: false,
    down(ev) { this.a = kind === 'polygon' || kind === 'star' ? ev.pt : LV.snapPoint(ev.pt, { exclude: [] }).pt; this.item = null; },
    drag(ev) {
      if (this.item) this.item.remove();
      const b = ev.shift && kind !== 'line' ? ev.pt : LV.snapPoint(ev.pt, { exclude: [], origin: kind === 'line' ? this.a : null }).pt;
      this.item = makeShape(kind, this.a, b, ev); if (this.item) LV.insert(this.item); LV.redraw();
      if (this.item) LV.status(`W ${LV.fmt(this.item.bounds.width)}  H ${LV.fmt(this.item.bounds.height)}`);
    },
    up(ev) {
      LV.clearSnap();
      if (!this.item || vdist(ev.down, ev.pt) < 3) { if (this.item) this.item.remove(); this.item = null; shapeDialog(kind, this.a); return; }
      LV.setSel([this.item]); LV.commit(name); this.item = null;
    },
    move(ev) { LV.snapPoint(ev.pt, { exclude: [] }); LV.redraw(); },
    deactivate() { LV.clearSnap(); }
  });
  T.rect = shapeTool('rect', 'Rectangle'); T.rounded = shapeTool('rounded', 'Rounded Rectangle'); T.ellipse = shapeTool('ellipse', 'Ellipse');
  T.polygon = shapeTool('polygon', 'Polygon'); T.star = shapeTool('star', 'Star'); T.line = shapeTool('line', 'Line Segment');

  /* ---------------- Type ---------------- */
  T.type = {
    name: 'Type', cursor: 'text', showBBox: false,
    deactivate() { LV.endTextEdit(); LV.marquee = null; },
    down(ev) {
      if (LV.textEditing) { LV.endTextEdit(); }
      const hit = LV.hitTest(ev.pt);
      if (hit && LV.isTextLike(hit)) { LV.beginTextEdit(hit); this.mode = null; return; }
      this.mode = 'create';
    },
    drag(ev) { if (this.mode === 'create') { LV.marquee = new P.Rectangle(ev.down, ev.pt); LV.redraw(); } },
    up(ev) {
      if (this.mode !== 'create') return; this.mode = null; LV.marquee = null;
      let item;
      if (vdist(ev.down, ev.pt) > 8) { const r = new P.Rectangle(ev.down, ev.pt); item = LV.newAreaText(r, ''); item.name = 'Area Type'; }
      else { item = LV.newPointText(ev.down, ''); }
      LV.insert(item); LV.beginTextEdit(item); LV.textEditing.isNew = true; LV.redraw();
    },
    move(ev) { const h = LV.hitTest(ev.pt); LV.hover = h && LV.isTextLike(h) ? h : null; LV.redraw(); }
  };
  T.typepath = {
    name: 'Type on a Path', cursor: 'text',
    down(ev) {
      const leaf = LV.hitTest(ev.pt, { leaf: true });
      if (leaf && LV.kind(leaf.parent) === 'pathtext') { LV.beginTextEdit(leaf.parent); return; }
      if (leaf && leaf instanceof P.Path && leaf.segments.length > 1 && !(leaf.parent instanceof P.CompoundPath)) {
        const g = LV.makePathText(leaf, 'Type on a path'); g.name = 'Text on Path'; LV.reUid(g);
        LV.setSel([g]); LV.commit('Type on a Path'); LV.beginTextEdit(g);
      } else LV.toast('Click on a path to place text along it');
    },
    move(ev) { const h = LV.hitTest(ev.pt, { leaf: true }); LV.hover = h instanceof P.Path ? h : null; LV.redraw(); }
  };

  /* ---------------- Eyedropper ---------------- */
  T.eyedrop = {
    name: 'Eyedropper', cursor: 'crosshair',
    down(ev) {
      if (ev.shift) { // sample the rendered pixel color
        const cv = $('#cvArt'), r = cv.width / cv.clientWidth, d = cv.getContext('2d').getImageData(Math.round(ev.vp.x * r), Math.round(ev.vp.y * r), 1, 1).data;
        const css = d[3] ? new P.Color(d[0] / 255, d[1] / 255, d[2] / 255).toCSS(true) : '#ffffff';
        LV.applyPaintToSelection(LV.paint.active, css, 'Eyedropper'); return;
      }
      const hit = LV.hitTest(ev.pt, { leaf: true }); if (!hit) return;
      const owner = LV.kind(hit.parent) === 'areatext' || LV.kind(hit.parent) === 'pathtext' ? hit.parent : hit;
      const src = LV.firstPaintable(owner); if (!src) return;
      const fill = LV.colorToSpec(src.fillColor), stroke = LV.colorToSpec(src.strokeColor);
      if (!LV.sel.length) { Object.assign(LV.paint, { fill, stroke, strokeWidth: src.strokeWidth || 1 }); LV.emit('selection'); LV.toast('Picked up appearance'); return; }
      const ts = LV.textStyleOf(owner);
      LV.sel.forEach(it => {
        LV.setPaint(it, 'fill', fill); LV.setPaint(it, 'stroke', stroke);
        LV.paintTargets(it).forEach(t => { t.strokeWidth = src.strokeWidth; t.dashArray = src.dashArray; t.strokeCap = src.strokeCap; t.strokeJoin = src.strokeJoin; });
        it.opacity = owner.opacity; it.blendMode = owner.blendMode;
        if (ts && LV.isTextLike(it)) LV.setTextStyle(it, { family: ts.family, weight: ts.weight, size: ts.size, tracking: ts.tracking });
      });
      LV.commit('Eyedropper');
    },
    move(ev) { LV.hover = LV.hitTest(ev.pt, { leaf: true }); LV.redraw(); }
  };

  /* ---------------- Gradient ---------------- */
  const gradTarget = () => { const it = LV.sel[0]; return it ? LV.firstPaintable(it) : null; };
  const gradAttr = () => LV.paint.active === 'stroke' ? 'strokeColor' : 'fillColor';
  T.gradient = {
    name: 'Gradient', cursor: 'crosshair',
    markers() {
      const t = gradTarget(); if (!t) return null; const col = t[gradAttr()]; if (!col || col.type !== 'gradient') return null;
      const M = t.globalMatrix, o = M.transform(col.origin), d = M.transform(col.destination);
      return { t, col, o, d, stops: col.gradient.stops.map(s => o.add(d.subtract(o).multiply(s.offset ?? 0))) };
    },
    set(t, col, o, d, stops) { const inv = t.globalMatrix.inverted(); t[gradAttr()] = new P.Color({ gradient: { stops: stops.map(s => new P.GradientStop(new P.Color(s[0]), s[1])), radial: col.gradient.radial }, origin: inv.transform(o), destination: inv.transform(d) }); },
    stopsOf: col => col.gradient.stops.map(s => [LV.css(s.color), s.offset ?? 0]),
    down(ev) {
      this.mode = null; const mk = this.markers();
      if (mk) {
        const { o, d } = mk;
        if (vdist(ev.pt, o) < 7) { this.mode = 'o'; return; }
        if (vdist(ev.pt, d) < 7) { this.mode = 'd'; return; }
        const i = mk.stops.findIndex(p => vdist(ev.pt, p) < 6); if (i >= 0) { this.mode = 'stop'; this.si = i; this.selStop = i; LV.emit('gradstop', i); return; }
        const L = new P.Path.Line({ from: o, to: d, insert: false }), loc = L.getNearestLocation(ev.pt);
        if (loc && vdist(loc.point, ev.pt) < 5) { this.mode = 'line'; this.lineOff = loc.offset / L.length; return; } // click adds a stop, drag redraws the vector
      }
      const hit = LV.hitTest(ev.pt);
      if (hit && !LV.sel.includes(hit)) { LV.setSel([hit]); }
      if (!LV.sel.length) return;
      this.mode = 'new';
    },
    drag(ev) {
      const mk = this.markers(); let p = ev.shift ? constrain45(this.mode === 'o' ? (mk && mk.d) || ev.down : ev.down, ev.pt) : ev.pt;
      if (this.mode === 'line') this.mode = 'new';
      if (this.mode === 'new') {
        if (vdist(ev.down, ev.pt) < 3) return;
        LV.sel.forEach(it => LV.paintTargets(it).forEach(t => {
          const cur = t[gradAttr()]; let stops, radial = false;
          if (cur && cur.type === 'gradient') { stops = this.stopsOf(cur); radial = cur.gradient.radial; }
          else { const c = cur ? LV.css(cur) : '#ffffff'; stops = [[c, 0], [c === '#000000' ? '#ffffff' : '#000000', 1]]; }
          this.set(t, { gradient: { radial } }, ev.down, p, stops);
        }));
      } else if (mk && this.mode === 'o') this.set(mk.t, mk.col, p, mk.d, this.stopsOf(mk.col));
      else if (mk && this.mode === 'd') this.set(mk.t, mk.col, mk.o, p, this.stopsOf(mk.col));
      else if (mk && this.mode === 'stop') {
        const L = new P.Path.Line({ from: mk.o, to: mk.d, insert: false }), loc = L.getNearestLocation(ev.pt), st = this.stopsOf(mk.col);
        if (vdist(loc.point, ev.pt) > 40 && st.length > 2) { st.splice(this.si, 1); this.set(mk.t, mk.col, mk.o, mk.d, st); this.mode = null; LV.commit('Remove Gradient Stop'); LV.redraw(); return; }
        st[this.si][1] = LV.round(loc.offset / L.length, 4); this.set(mk.t, mk.col, mk.o, mk.d, st);
      }
      this.changed = true; LV.redraw(); LV.emit('selection');
    },
    up() {
      if (this.mode === 'line') { // add a stop with the interpolated color
        const mk = this.markers(), off = this.lineOff, st = this.stopsOf(mk.col); st.sort((a, b) => a[1] - b[1]);
        const nxt = st.find(s => s[1] >= off) || st[st.length - 1], prv = [...st].reverse().find(s => s[1] <= off) || st[0];
        const k = nxt[1] === prv[1] ? 0 : (off - prv[1]) / (nxt[1] - prv[1]), c1 = new P.Color(prv[0]), c2 = new P.Color(nxt[0]);
        const c = new P.Color(c1.red + (c2.red - c1.red) * k, c1.green + (c2.green - c1.green) * k, c1.blue + (c2.blue - c1.blue) * k, c1.alpha + (c2.alpha - c1.alpha) * k);
        st.push([LV.css(c), LV.round(off, 4)]); this.set(mk.t, mk.col, mk.o, mk.d, st); this.mode = null; LV.commit('Add Gradient Stop'); return;
      }
      if (this.changed) LV.commit('Gradient'); this.changed = false; this.mode = null;
    },
    dbl(ev) {
      const mk = this.markers(); if (!mk) return; const i = mk.stops.findIndex(p => vdist(ev.pt, p) < 6); if (i < 0) return;
      const st = this.stopsOf(mk.col), c = new P.Color(st[i][0]);
      Aero.dialog({ title: 'Gradient Stop', fields: [{ key: 'c', label: 'Color', type: 'color', value: c.toCSS(true) }, { key: 'a', label: 'Opacity', type: 'range', min: 0, max: 100, value: Math.round(c.alpha * 100), fmt: v => v + '%' }, { key: 'o', label: 'Location', type: 'range', min: 0, max: 100, value: Math.round(st[i][1] * 100), fmt: v => v + '%' }],
        onOK: v => { const nc = new P.Color(v.c); nc.alpha = v.a / 100; st[i] = [LV.css(nc), v.o / 100]; this.set(mk.t, mk.col, mk.o, mk.d, st); LV.commit('Edit Gradient Stop'); } });
    },
    overlay(ctx) {
      const mk = this.markers(); if (!mk) return;
      const o = LV.v(mk.o), d = LV.v(mk.d);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.lineTo(d.x, d.y); ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = '#1d2733';
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(o.x, o.y, 5.5, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillRect(d.x - 4.5, d.y - 4.5, 9, 9); ctx.strokeRect(d.x - 4.5, d.y - 4.5, 9, 9);
      mk.stops.forEach((p, i) => { const v = LV.v(p), b = LV.v(p.subtract(mk.off)); ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(v.x, v.y); ctx.stroke(); ctx.translate(v.x, v.y); ctx.rotate(Math.PI / 4); ctx.fillStyle = LV.css(mk.col.gradient.stops[i].color); ctx.fillRect(-5, -5, 10, 10); ctx.strokeStyle = i === this.selStop ? LV.SEL_COLOR : '#1d2733'; ctx.lineWidth = i === this.selStop ? 2 : 1; ctx.strokeRect(-5, -5, 10, 10); ctx.restore(); });
    }
  };
  // stops are drawn below the line; adjust hit test accordingly
  const origMarkers = T.gradient.markers;
  T.gradient.markers = function () { const m = origMarkers.call(this); if (m) { let n = m.d.subtract(m.o); n = n.length > 1e-6 ? n.normalize().rotate(90) : new P.Point(0, 1); if (n.y < 0 || (Math.abs(n.y) < 1e-6 && n.x < 0)) n = n.negate(); m.off = n.multiply(12 / P.view.zoom); m.stops = m.stops.map(p => p.add(m.off)); } return m; };

  /* ---------------- Scissors / Knife ---------------- */
  T.scissors = {
    name: 'Scissors', cursor: 'crosshair',
    down(ev) {
      const leaf = LV.hitTest(ev.pt, { leaf: true });
      const paths = leaf ? pathsOf([leaf]) : [];
      for (const p of paths) {
        const loc = p.getNearestLocation(p.globalToLocal(ev.pt));
        if (!loc || LV.v(p.localToGlobal(loc.point)).getDistance(ev.vp) > 6) continue;
        if (p.parent instanceof P.CompoundPath) { const cp = p.parent; cp.parent.insertChildren(cp.index + 1, cp.removeChildren()); cp.remove(); }
        const rest = p.splitAt(loc.offset);
        const out = [...new Set([p, rest])].filter(x => x && x.parent); out.forEach(x => { LV.reUid(x); });
        if (rest) LV.reUid(rest);
        LV.setSel(out); LV.commit('Scissors'); return;
      }
      LV.toast('Click on a path segment or anchor point to cut it');
    },
    move(ev) { LV.hover = LV.hitTest(ev.pt, { leaf: true }); LV.redraw(); }
  };
  LV.knifeCut = (pts, targets) => {
    const eps = 0.3 / P.view.zoom, left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], n = b.subtract(a).normalize().rotate(90).multiply(eps);
      left.push(pts[i].add(n)); right.unshift(pts[i].subtract(n));
    }
    const blade = new P.Path({ segments: left.concat(right), closed: true, insert: false });
    const line = new P.Path({ segments: pts, insert: false });
    const made = [];
    targets.forEach(t => {
      if (!LV.isPathItem(t) || !t.hasFill() && !t.closed) return;
      if (!t.bounds.intersects(line.bounds) || t.getIntersections(line).length < 2) return;
      const res = t.subtract(blade, { insert: false });
      const parts = res instanceof P.CompoundPath ? res.children.slice() : [res];
      const outers = parts.filter(c => !parts.some(o => o !== c && o.contains(c.interiorPoint) && Math.abs(o.area) > Math.abs(c.area)));
      outers.forEach(o => {
        const holes = parts.filter(h => h !== o && !outers.includes(h) && o.contains(h.interiorPoint));
        const piece = holes.length ? new P.CompoundPath({ children: [o, ...holes].map(x => x.clone({ insert: false })), insert: false, fillRule: t.fillRule }) : o.clone({ insert: false });
        piece.style = t.style; piece.opacity = t.opacity; piece.blendMode = t.blendMode; piece.name = t.name;
        piece.insertAbove(t); LV.reUid(piece); made.push(piece);
      });
      t.remove();
    });
    return made;
  };
  T.knife = {
    name: 'Knife', cursor: 'crosshair',
    down(ev) { this.pts = [ev.pt]; },
    drag(ev) { if (vdist(this.pts[this.pts.length - 1], ev.pt) > 2) this.pts.push(ev.pt); LV.redraw(); },
    up() {
      const pts = this.pts; this.pts = null; if (!pts || pts.length < 2) return LV.redraw();
      const scope = LV.sel.length ? LV.sel : LV.allObjects().filter(o => o.visible && !o.locked && LV.ancestorsOk(o));
      const targets = []; scope.forEach(o => LV.leaves(o).forEach(l => { if (LV.isPathItem(l) && l.closed !== false) targets.push(l); }));
      const made = LV.knifeCut(pts, targets);
      if (made.length) { LV.setSel(made); LV.commit('Knife'); } else LV.toast('Drag the knife fully across a filled shape');
      LV.redraw();
    },
    overlay(ctx) { if (!this.pts) return; ctx.strokeStyle = '#e0261b'; ctx.lineWidth = 1.2; ctx.beginPath(); this.pts.forEach((p, i) => { const v = LV.v(p); i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y); }); ctx.stroke(); }
  };

  /* ---------------- Blend tool: click two shapes ---------------- */
  const blendable = it => it && LV.isPathItem(it) && !it.clipMask;
  T.blend = {
    name: 'Blend', cursor: 'crosshair',
    activate() { this.first = null; },
    deactivate() { this.first = null; },
    down(ev) {
      const hit = LV.hitTest(ev.pt);
      if (!blendable(hit)) { LV.toast('Click a path or shape (then a second one) to blend between them'); return; }
      if (!this.first || !this.first.parent) { this.first = hit; LV.setSel([hit]); LV.status('Now click the object to blend to'); return; }
      if (hit === this.first) return;
      const a = this.first; this.first = null; LV.blend.make([a, hit]); LV.status('');
    },
    move(ev) { const h = LV.hitTest(ev.pt); LV.hover = blendable(h) ? h : null; LV.redraw(); },
    key(e) { if (e.key === 'Escape' && this.first) { this.first = null; LV.setSel([]); return true; } return false; },
    overlay(ctx) { if (!this.first || !this.first.parent) return; ctx.strokeStyle = '#ff2fb0'; ctx.lineWidth = 2; ctx.beginPath(); LV.tracePath(ctx, this.first); ctx.stroke(); if (LV.cursor) { const a = LV.v(this.first.bounds.center), b = LV.v(LV.cursor); ctx.setLineDash([4, 3]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]); } }
  };

  /* ---------------- Shape Builder: drag across regions of the selected shapes to merge them (Alt erases) ---------------- */
  const sbTargets = () => LV.sortZ(LV.sel).filter(it => LV.isPathItem(it) && !it.clipMask && (it instanceof P.CompoundPath || it.closed));
  T.shapebuilder = {
    name: 'Shape Builder', cursor: 'crosshair',
    regions() {
      const t = sbTargets(); if (t.length < 2) return null;
      const key = t.map(i => i.id + ':' + i._version + ':' + i.bounds.toString()).join('|');
      if (this.key !== key) { this.key = key; try { this.pieces = LV.dividePieces(t); } catch (e) { console.warn(e); this.pieces = []; } }
      return this.pieces;
    },
    at(pt) { const r = this.regions(); return r && r.find(pc => pc.path.contains(pt)); },
    activate() { this.key = null; this.picks = null; if (sbTargets().length < 2) LV.toast('Select two or more overlapping shapes, then drag across regions to merge them (Alt-drag erases)'); },
    deactivate() { this.picks = null; this.pieces = null; this.key = null; },
    down(ev) {
      if (!this.regions()) { const hit = LV.hitTest(ev.pt); if (hit) LV.addSel(hit); LV.toast('Select two or more overlapping shapes first'); return; }
      this.picks = this.at(ev.pt) ? [ev.pt] : []; this.alt = ev.alt;
    },
    drag(ev) { if (!this.picks) return; if (this.at(ev.pt) && (!this.picks.length || vdist(this.picks[this.picks.length - 1], ev.pt) > 3)) this.picks.push(ev.pt); this.alt = ev.alt; LV.redraw(); },
    up(ev) {
      const picks = this.picks; this.picks = null; if (!picks || !picks.length) return LV.redraw();
      const res = LV.shapeBuild(sbTargets(), picks, ev.alt || this.alt); this.key = null;
      if (!res) return LV.redraw();
      LV.setSel(res.made); LV.commit(ev.alt || this.alt ? 'Shape Builder Erase' : 'Shape Builder');
    },
    move(ev) { this.hoverPc = this.at(ev.pt) || null; LV.hover = null; setCursor(ev.alt ? 'not-allowed' : 'crosshair'); LV.redraw(); },
    overlay(ctx) {
      const r = this.regions(); if (!r) return;
      const hl = new Set(); if (this.picks) this.picks.forEach(p => { const pc = r.find(x => x.path.contains(p)); if (pc) hl.add(pc); }); else if (this.hoverPc) hl.add(this.hoverPc);
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(47,122,229,.5)'; ctx.setLineDash([3, 3]); r.forEach(pc => { ctx.beginPath(); LV.tracePath(ctx, pc.path); ctx.stroke(); }); ctx.setLineDash([]);
      hl.forEach(pc => { ctx.beginPath(); LV.tracePath(ctx, pc.path); ctx.fillStyle = this.alt ? 'rgba(224,38,27,.35)' : 'rgba(47,122,229,.25)'; ctx.fill('evenodd'); ctx.strokeStyle = this.alt ? '#e0261b' : LV.SEL_COLOR; ctx.lineWidth = 1.5; ctx.stroke(); });
      if (this.picks && this.picks.length > 1) { ctx.strokeStyle = this.alt ? '#e0261b' : LV.SEL_COLOR; ctx.lineWidth = 1; ctx.beginPath(); this.picks.forEach((p, i) => { const v = LV.v(p); i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y); }); ctx.stroke(); }
    }
  };

  /* ---------------- Width tool: drag on a stroke to add / adjust width points ---------------- */
  const strokedPath = it => it instanceof P.Path && it.hasStroke() && it.segments.length > 1 && !(it.parent instanceof P.CompoundPath);
  T.width = {
    name: 'Width', cursor: 'crosshair',
    activate() { this.path = LV.sel.find(strokedPath) || null; this.selPt = -1; },
    deactivate() { this.path = null; this.mode = null; },
    geo(path, i) { // width point i: centre, normal, handle positions (document coordinates)
      const w = LV.width.get(path), p = w.pts[i], L = path.length, off = Math.min(L, p.t * L), c = path.getPointAt(off), n = path.getNormalAt(off), hw = path.strokeWidth / 2;
      return { c, n, lp: c.add(n.multiply(p.l * hw)), rp: c.subtract(n.multiply(p.r * hw)), off };
    },
    pick(ev) {
      const paths = [this.path, ...LV.sel].filter(p => p && p.parent && strokedPath(p));
      for (const p of paths) { const w = LV.width.get(p); if (!w) continue; for (let i = 0; i < w.pts.length; i++) { const g = this.geo(p, i); if (vdist(ev.pt, g.lp) <= 6) return { p, i, side: 'l' }; if (vdist(ev.pt, g.rp) <= 6) return { p, i, side: 'r' }; if (vdist(ev.pt, g.c) <= 6) return { p, i, side: 'c' }; } }
      return null;
    },
    pathAt(ev) {
      const hit = LV.hitTest(ev.pt, { leaf: true, filter: strokedPath }) || (this.path && this.path.parent && this.path.getNearestPoint(ev.pt).getDistance(ev.pt) <= this.path.strokeWidth / 2 * LV.width.maxRatio(this.path) + LV.tol(5) ? this.path : null);
      return strokedPath(hit) ? hit : null;
    },
    down(ev) {
      this.mode = null; this.changed = false;
      const h = this.pick(ev);
      if (h) { this.path = h.p; this.selPt = h.i; this.mode = h.side === 'c' ? 'slide' : 'side'; this.side = h.side; this.alt = ev.alt; LV.setSel([h.p]); return; }
      const p = this.pathAt(ev); if (!p) { this.selPt = -1; LV.redraw(); return; }
      this.path = p; LV.setSel([p]);
      const L = p.length, loc = p.getNearestLocation(ev.pt), t = loc.offset / L, w = LV.width.get(p), v = LV.width.valueAt(w ? w.pts : [], t, p.closed);
      const pts = (w ? w.pts : [{ t: 0, l: 1, r: 1 }, { t: 1, l: 1, r: 1 }]).concat([{ t, l: v.l, r: v.r }]);
      LV.width.set(p, pts); this.selPt = LV.width.get(p).pts.findIndex(q => q.t === Math.min(1, Math.max(0, t)) && q.l === v.l);
      const n = p.getNormalAt(loc.offset); this.side = ev.pt.subtract(loc.point).dot(n) >= 0 ? 'l' : 'r'; this.alt = ev.alt; this.mode = 'side'; this.changed = true;
    },
    drag(ev) {
      const p = this.path; if (!p || !this.mode) return; const w = LV.width.get(p); if (!w) return; const pts = w.pts.map(q => ({ ...q })), i = this.selPt, q = pts[i]; if (!q) return;
      if (this.mode === 'side') {
        const g = this.geo(p, i), d = Math.abs(ev.pt.subtract(g.c).dot(g.n)), ratio = Math.min(100, d / (p.strokeWidth / 2));
        if (this.alt || ev.alt) q[this.side] = ratio; else { q.l = ratio; q.r = ratio; }
        LV.status(`Width ${LV.fmt((q.l + q.r) * p.strokeWidth / 2)}  (side 1 ${LV.fmt(q.l * p.strokeWidth / 2)}, side 2 ${LV.fmt(q.r * p.strokeWidth / 2)})`);
      } else if (this.mode === 'slide') {
        const t = p.getNearestLocation(ev.pt).offset / p.length, lo = i > 0 ? pts[i - 1].t + 1e-3 : 0, hi = i < pts.length - 1 ? pts[i + 1].t - 1e-3 : 1;
        q.t = Math.min(hi, Math.max(lo, t));
      }
      LV.width.set(p, pts); this.changed = true; LV.redraw();
    },
    up() { if (this.changed) LV.commit('Width'); this.mode = null; this.changed = false; LV.emit('selection'); },
    move(ev) { const h = this.pick(ev); this.hoverPath = h ? h.p : this.pathAt(ev); setCursor(h ? (h.side === 'c' ? 'ew-resize' : 'pointer') : this.hoverPath ? 'crosshair' : 'default'); LV.hover = null; LV.redraw(); },
    deletePoint() {
      const p = this.path, w = p && LV.width.get(p); if (!w || this.selPt < 0 || !w.pts[this.selPt]) return false;
      const pts = w.pts.filter((_, j) => j !== this.selPt); LV.width.set(p, pts.length ? pts : null); this.selPt = -1; LV.commit('Delete Width Point'); return true;
    },
    key(e) { if ((e.key === 'Delete' || e.key === 'Backspace') && this.deletePoint()) return true; if (e.key === 'Escape' && this.selPt >= 0) { this.selPt = -1; LV.redraw(); return true; } return false; },
    dbl(ev) {
      const h = this.pick(ev); if (!h) return; const p = h.p, w = LV.width.get(p), q = w.pts[h.i], hw = p.strokeWidth / 2;
      Aero.dialog({ title: 'Width Point Edit', fields: [{ key: 'l', label: 'Side 1', type: 'number', min: 0, step: 0.5, value: LV.round(q.l * hw, 2) }, { key: 'r', label: 'Side 2', type: 'number', min: 0, step: 0.5, value: LV.round(q.r * hw, 2) }, { key: 'del', label: 'Delete this point', type: 'checkbox', value: false }],
        onOK: v => { const pts = w.pts.map(x => ({ ...x })); if (v.del) pts.splice(h.i, 1); else { pts[h.i].l = Math.max(0, v.l) / hw; pts[h.i].r = Math.max(0, v.r) / hw; } LV.width.set(p, pts.length ? pts : null); LV.commit('Width Point Edit'); } });
    },
    overlay(ctx) {
      const show = new Set([this.path, this.hoverPath, ...LV.sel].filter(p => p && p.parent && strokedPath(p)));
      show.forEach(p => {
        const o = LV.width.outline(p); ctx.strokeStyle = LV.SEL_COLOR; ctx.lineWidth = 1; ctx.beginPath(); LV.tracePath(ctx, o || p); ctx.stroke();
        const w = LV.width.get(p); if (!w) return;
        w.pts.forEach((_, i) => {
          const g = this.geo(p, i), c = LV.v(g.c), a = LV.v(g.lp), b = LV.v(g.rp), sel = p === this.path && i === this.selPt;
          ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          [a, b].forEach(q => { ctx.beginPath(); ctx.arc(q.x, q.y, 3.2, 0, 7); ctx.fillStyle = sel ? LV.SEL_COLOR : '#fff'; ctx.fill(); ctx.stroke(); });
          ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(Math.PI / 4); ctx.fillStyle = sel ? LV.SEL_COLOR : '#fff'; ctx.fillRect(-3.5, -3.5, 7, 7); ctx.strokeRect(-3.5, -3.5, 7, 7); ctx.restore();
        });
      });
    }
  };

  /* ---------------- Hand / Zoom ---------------- */
  T.hand = { name: 'Hand', cursor: 'grab', down(ev) { this.last = ev.vp; setCursor('grabbing'); }, drag(ev) { LV.pan(ev.vp.x - this.last.x, ev.vp.y - this.last.y); this.last = ev.vp; }, up() { setCursor('grab'); }, dbl() { LV.fitBoard(); } };
  T.zoom = {
    name: 'Zoom', cursor: 'zoom-in',
    down(ev) { this.alt = ev.alt; },
    drag(ev) { LV.marquee = new P.Rectangle(ev.down, ev.pt); LV.redraw(); },
    up(ev) {
      const r = LV.marquee; LV.marquee = null;
      if (r && r.width * P.view.zoom > 8) LV.fitRect(r, 10);
      else LV.zoomAt(ev.alt ? 1 / 1.5 : 1.5, ev.vp);
    },
    move(ev) { setCursor(ev.alt ? 'zoom-out' : 'zoom-in'); }
  };

  /* ---------------- Artboard ---------------- */
  T.artboard = {
    name: 'Artboard', cursor: 'crosshair',
    activate() { LV.setSel([]); },
    down(ev) {
      this.mode = null; this.changed = false;
      const ab = LV.board(), r = LV.boardRect(ab), hp = LV.handlePositions(r);
      const hi = hp.findIndex(p => p.getDistance(ev.vp) <= 6);
      if (hi >= 0) { this.mode = 'resize'; this.idx = hi; this.r0 = r; return; }
      const i = LV.boardAt(ev.pt);
      if (i >= 0) {
        LV.doc.active = i; this.mode = 'move'; this.applied = new P.Point(0, 0); const b = LV.boardRect(LV.doc.artboards[i]);
        this.art = LV.prefs.moveArt ? LV.allObjects().filter(o => !o.locked && b.contains(o.bounds)) : [];
        LV.emit('changed'); return;
      }
      this.mode = 'new';
    },
    drag(ev) {
      const ab = LV.board(), p = LV.prefs.snapGrid ? new P.Point(Math.round(ev.pt.x / LV.prefs.gridSize) * LV.prefs.gridSize, Math.round(ev.pt.y / LV.prefs.gridSize) * LV.prefs.gridSize) : ev.pt.round();
      if (this.mode === 'move') {
        const d = ev.pt.subtract(ev.down).round(), inc = d.subtract(this.applied); ab.x += inc.x; ab.y += inc.y; this.art.forEach(o => o.translate(inc)); this.applied = d; this.changed = !d.isZero();
      } else if (this.mode === 'resize') {
        const r = this.r0, i = this.idx; let l = r.left, t = r.top, rr = r.right, b = r.bottom;
        if ([0, 6, 7].includes(i)) l = Math.min(p.x, rr - 1); if ([2, 3, 4].includes(i)) rr = Math.max(p.x, l + 1);
        if ([0, 1, 2].includes(i)) t = Math.min(p.y, b - 1); if ([4, 5, 6].includes(i)) b = Math.max(p.y, t + 1);
        Object.assign(ab, { x: l, y: t, w: rr - l, h: b - t }); this.changed = true;
      } else if (this.mode === 'new') { LV.marquee = new P.Rectangle(ev.down.round(), p); }
      LV.status(`${ab.name}: ${LV.fmt(ab.w)} × ${LV.fmt(ab.h)}`);
      LV.redraw(); LV.emit('view');
    },
    up() {
      if (this.mode === 'new' && LV.marquee && LV.marquee.width > 4 && LV.marquee.height > 4) {
        const r = LV.marquee; LV.doc.artboards.push({ id: Aero.uid(), name: 'Artboard ' + (LV.doc.artboards.length + 1), x: r.x, y: r.y, w: r.width, h: r.height });
        LV.doc.active = LV.doc.artboards.length - 1; LV.commit('New Artboard');
      } else if (this.changed) LV.commit(this.mode === 'move' ? 'Move Artboard' : 'Resize Artboard');
      LV.marquee = null; this.mode = null; LV.redraw(); LV.emit('changed');
    },
    move(ev) { const hp = LV.handlePositions(LV.boardRect(LV.board())), hi = hp.findIndex(p => p.getDistance(ev.vp) <= 6); setCursor(hi >= 0 ? SCALE_CURSORS[hi] : LV.boardAt(ev.pt) >= 0 ? 'move' : 'crosshair'); },
    dbl() { LV.artboardOptions(); },
    overlay(ctx) {
      LV.doc.artboards.forEach((ab, i) => {
        const r = LV.boardRect(ab), a = LV.v(r.topLeft), b = LV.v(r.bottomRight);
        ctx.setLineDash(i === LV.doc.active ? [] : [4, 3]); ctx.strokeStyle = i === LV.doc.active ? LV.SEL_COLOR : '#5d7fa3'; ctx.lineWidth = i === LV.doc.active ? 2 : 1;
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
      });
      ctx.setLineDash([]); ctx.strokeStyle = LV.SEL_COLOR; ctx.lineWidth = 1;
      LV.handlePositions(LV.boardRect(LV.board())).forEach(p => { ctx.fillStyle = '#fff'; ctx.fillRect(p.x - 4, p.y - 4, 8, 8); ctx.strokeRect(p.x - 3.5, p.y - 3.5, 8, 8); });
    }
  };

  /* ---------------- pointer dispatch ---------------- */
  let down = null, panning = null;
  LV.spaceHand = false;
  LV.setToolImpl = id => {
    if (LV.tool && LV.tool !== T[id]) LV.tool.deactivate?.();
    LV.tool = T[id]; LV.toolId = id; LV.hover = null; LV.marquee = null;
    LV.tool.activate?.(); setCursor(LV.tool.cursor || 'default'); LV.redraw(); LV.emit('tool', id);
  };
  const mkEv = (e, el) => { const r = el.getBoundingClientRect(), vp = new P.Point(e.clientX - r.left, e.clientY - r.top); return { e, vp, pt: P.view.viewToProject(vp), shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, down: down && down.pt, button: e.button }; };
  LV.initPointer = () => {
    const view = $('#view');
    view.addEventListener('pointerdown', e => {
      if (e.target.id === 'textEdit') return;
      document.activeElement && document.activeElement.blur && document.activeElement !== document.body && document.activeElement.blur();
      try { view.setPointerCapture(e.pointerId); } catch (err) { }
      const ev = mkEv(e, view);
      if (e.button === 1 || LV.spaceHand) { panning = ev.vp; setCursor('grabbing'); e.preventDefault(); return; }
      if (e.button !== 0) return;
      down = ev; ev.down = ev.pt; down.moved = false;
      if (LV.textEditing && LV.toolId !== 'type') LV.endTextEdit();
      LV.tool.down?.(ev);
    });
    view.addEventListener('pointermove', e => {
      const ev = mkEv(e, view); LV.cursor = ev.pt; LV.emit('cursor', ev.pt);
      if (panning) { LV.pan(ev.vp.x - panning.x, ev.vp.y - panning.y); panning = ev.vp; return; }
      if (down) { if (!down.moved && ev.vp.getDistance(down.vp) < 2) return; down.moved = true; ev.down = down.pt; LV.tool.drag?.(ev); }
      else { LV.tool.move?.(ev); LV.redraw(); }
    });
    const end = e => {
      if (panning) { panning = null; setCursor(LV.spaceHand ? 'grab' : LV.tool.cursor || 'default'); return; }
      if (!down) return; const ev = mkEv(e, view); ev.down = down.pt; ev.moved = down.moved;
      const d = down; down = null; LV.tool.up?.(ev, d);
    };
    view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
    view.addEventListener('dblclick', e => { const ev = mkEv(e, view); LV.tool.dbl?.(ev); });
    view.addEventListener('pointerleave', () => { LV.cursor = null; LV.redraw(); });
    view.addEventListener('wheel', e => {
      e.preventDefault();
      const r = view.getBoundingClientRect(), vp = new P.Point(e.clientX - r.left, e.clientY - r.top);
      if (e.ctrlKey || e.altKey) LV.zoomAt(Math.pow(1.0018, -e.deltaY), vp);
      else if (e.shiftKey) LV.pan(-e.deltaY, 0); else LV.pan(-e.deltaX, -e.deltaY);
    }, { passive: false });
    view.addEventListener('contextmenu', e => e.preventDefault());
    // ruler guides
    const rulerDrag = (axis) => e => {
      if (!LV.prefs.guides) return;
      const move = ev => { const r = view.getBoundingClientRect(), pt = P.view.viewToProject(new P.Point(ev.clientX - r.left, ev.clientY - r.top)); LV.guideDrag = { axis, v: axis === 'x' ? pt.x : pt.y }; LV.smartLines = [axis === 'x' ? { a: new P.Point(pt.x, -1e5), b: new P.Point(pt.x, 1e5) } : { a: new P.Point(-1e5, pt.y), b: new P.Point(1e5, pt.y) }]; LV.redraw(); };
      const up = ev => {
        removeEventListener('pointermove', move); removeEventListener('pointerup', up); LV.smartLines = [];
        const r = view.getBoundingClientRect();
        if (LV.guideDrag && ev.clientX > r.left && ev.clientY > r.top) { LV.doc.guides[axis].push(LV.round(LV.guideDrag.v, 2)); LV.commit('New Guide'); }
        LV.guideDrag = null; LV.redraw();
      };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    };
    $('#rulerH').addEventListener('pointerdown', rulerDrag('y'));
    $('#rulerV').addEventListener('pointerdown', rulerDrag('x'));
    // space = temporary hand
    document.addEventListener('keydown', e => {
      if (e.code === 'Space' && !e.target.matches('input,textarea,select') && !LV.spaceHand && !document.querySelector('.aero-modal')) { LV.spaceHand = true; setCursor('grab'); e.preventDefault(); }
    });
    document.addEventListener('keyup', e => { if (e.code === 'Space' && LV.spaceHand) { LV.spaceHand = false; setCursor(LV.tool.cursor || 'default'); } });
  };
})();
