'use strict';
/* Lumen Vector — view setup and drawing of artboards, grid, rulers, guides and the selection overlay. */
(function () {
  const $ = s => document.querySelector(s);
  let dpr = 1, W = 0, H = 0, cb, co, crh, crv;
  const SEL = '#2f7ae5', SMART = '#ff2fb0', GUIDE = '#18b6d8';
  LV.v = p => P.view.projectToView(p);

  LV.initView = () => {
    const view = $('#view');
    P.setup($('#cvArt'));
    P.settings.hitTolerance = 0;
    cb = $('#cvBoard').getContext('2d'); co = $('#cvOver').getContext('2d');
    crh = $('#rulerH').getContext('2d'); crv = $('#rulerV').getContext('2d');
    const resize = () => {
      const r = view.getBoundingClientRect(); dpr = devicePixelRatio || 1;
      W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
      const c = P.view.center;
      P.view.viewSize = new P.Size(W, H);
      if (c) P.view.center = c;
      for (const id of ['cvBoard', 'cvOver']) { const cv = $('#' + id); cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
      const rh = $('#rulerH'), rv = $('#rulerV');
      rh.width = W * dpr; rh.height = 18 * dpr; rh.style.width = W + 'px';
      rv.width = 18 * dpr; rv.height = H * dpr; rv.style.height = H + 'px';
      LV.redraw(); LV.emit('view');
    };
    new ResizeObserver(resize).observe(view); resize();
    const loop = () => {
      if (LV.needsDraw) { LV.needsDraw = false; try { drawBoards(); drawOverlay(); drawRulers(); } catch (e) { console.error(e); } }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  };
  LV.applyRulerLayout = () => { document.getElementById('stage').classList.toggle('rulers', !!LV.prefs.rulers); LV.redraw(); };

  /* ---------- artboards + grid (behind the art) ---------- */
  function drawBoards() {
    const ctx = cb; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!LV.doc) return;
    const z = P.view.zoom;
    LV.doc.artboards.forEach((ab, i) => {
      const p = LV.v(new P.Point(ab.x, ab.y)), w = ab.w * z, h = ab.h * z;
      ctx.save(); ctx.shadowColor = 'rgba(16,40,72,.38)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
      ctx.fillStyle = '#fff'; ctx.fillRect(p.x, p.y, w, h); ctx.restore();
      ctx.strokeStyle = i === LV.doc.active ? 'rgba(20,40,70,.9)' : 'rgba(40,60,90,.45)'; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(p.x) - .5, Math.round(p.y) - .5, Math.round(w) + 1, Math.round(h) + 1);
      ctx.font = (i === LV.doc.active ? '600 ' : '') + '11px "Segoe UI",sans-serif'; ctx.fillStyle = i === LV.doc.active ? '#0d2740' : '#3d5470';
      ctx.fillText(`${String(i + 1).padStart(2, '0')} – ${ab.name}`, p.x, p.y - 6);
    });
    if (LV.prefs.grid) {
      const g = LV.prefs.gridSize, every = LV.prefs.gridEvery; let step = g; while (step * z < 6) step *= every;
      const tl = P.view.viewToProject(new P.Point(0, 0)), br = P.view.viewToProject(new P.Point(W, H));
      ctx.save(); ctx.beginPath(); LV.doc.artboards.forEach(ab => { const p = LV.v(new P.Point(ab.x, ab.y)); ctx.rect(p.x, p.y, ab.w * z, ab.h * z); }); ctx.clip();
      const line = (major, x1, y1, x2, y2) => { ctx.strokeStyle = major ? 'rgba(60,110,170,.32)' : 'rgba(60,110,170,.13)'; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
      for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) { const vx = Math.round(LV.v(new P.Point(x, 0)).x) + .5; line(Math.abs(x / (step * every) - Math.round(x / (step * every))) < 1e-6, vx, 0, vx, H); }
      for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) { const vy = Math.round(LV.v(new P.Point(0, y)).y) + .5; line(Math.abs(y / (step * every) - Math.round(y / (step * every))) < 1e-6, 0, vy, W, vy); }
      ctx.restore();
    }
  }

  /* ---------- rulers ---------- */
  function niceStep(z) { const target = 70 / z; const p = 10 ** Math.floor(Math.log10(target)); for (const m of [1, 2, 5, 10]) if (m * p >= target) return m * p; return 10 * p; }
  function drawRulers() {
    if (!LV.prefs.rulers || !LV.doc) return;
    const z = P.view.zoom, ab = LV.board(), step = niceStep(z), sub = step / 10;
    const grad = (ctx, w, h, horiz) => { const g = horiz ? ctx.createLinearGradient(0, 0, 0, h) : ctx.createLinearGradient(0, 0, w, 0); g.addColorStop(0, '#f7fafd'); g.addColorStop(1, '#dde7f2'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); };
    // horizontal
    let ctx = crh; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); grad(ctx, W, 18, true);
    ctx.fillStyle = '#304a66'; ctx.strokeStyle = '#7f95ad'; ctx.font = '9.5px "Segoe UI",sans-serif'; ctx.lineWidth = 1;
    const t0 = P.view.viewToProject(new P.Point(0, 0)), t1 = P.view.viewToProject(new P.Point(W, H));
    ctx.beginPath();
    for (let x = Math.floor((t0.x - ab.x) / sub) * sub; x + ab.x <= t1.x; x += sub) {
      const vx = Math.round(LV.v(new P.Point(x + ab.x, 0)).x) + .5, major = Math.abs(x / step - Math.round(x / step)) < 1e-6;
      ctx.moveTo(vx, 18); ctx.lineTo(vx, major ? 2 : (Math.abs(x / (step / 2) - Math.round(x / (step / 2))) < 1e-6 ? 11 : 14));
      if (major) ctx.fillText(LV.fmt(x), vx + 3, 9);
    }
    ctx.stroke(); ctx.fillStyle = '#90a6bf'; ctx.fillRect(0, 17, W, 1);
    // vertical
    ctx = crv; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); grad(ctx, 18, H, false);
    ctx.fillStyle = '#304a66'; ctx.strokeStyle = '#7f95ad'; ctx.font = '9.5px "Segoe UI",sans-serif'; ctx.beginPath();
    for (let y = Math.floor((t0.y - ab.y) / sub) * sub; y + ab.y <= t1.y; y += sub) {
      const vy = Math.round(LV.v(new P.Point(0, y + ab.y)).y) + .5, major = Math.abs(y / step - Math.round(y / step)) < 1e-6;
      ctx.moveTo(18, vy); ctx.lineTo(major ? 2 : (Math.abs(y / (step / 2) - Math.round(y / (step / 2))) < 1e-6 ? 11 : 14), vy);
      if (major) { ctx.save(); ctx.translate(9, vy + 3); ctx.rotate(-Math.PI / 2); ctx.fillText(LV.fmt(y), 0, 0); ctx.restore(); }
    }
    ctx.stroke(); ctx.fillStyle = '#90a6bf'; ctx.fillRect(17, 0, 1, H);
    // cursor markers
    if (LV.cursor) {
      const c = LV.v(LV.cursor);
      crh.fillStyle = '#d0302a'; crh.fillRect(Math.round(c.x), 0, 1, 18);
      crv.fillStyle = '#d0302a'; crv.fillRect(0, Math.round(c.y), 18, 1);
    }
  }

  /* ---------- overlay ---------- */
  LV.tracePath = (ctx, item) => {   // add an item's outline (view coords) to ctx's current path
    if (item instanceof P.Path) {
      const M = P.view.matrix.appended(item.globalMatrix), s = item.segments; if (!s.length) return;
      const pt = p => M.transform(p);
      let a = pt(s[0].point); ctx.moveTo(a.x, a.y);
      const n = item.closed ? s.length : s.length - 1;
      for (let i = 0; i < n; i++) {
        const s1 = s[i], s2 = s[(i + 1) % s.length];
        const c1 = pt(s1.point.add(s1.handleOut)), c2 = pt(s2.point.add(s2.handleIn)), p2 = pt(s2.point);
        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, p2.x, p2.y);
      }
      if (item.closed) ctx.closePath();
    } else if (item instanceof P.CompoundPath || (item instanceof P.Group && !item.data.kind)) item.children.forEach(c => LV.tracePath(ctx, c));
    else if (item.data && item.data.kind === 'areatext') LV.tracePath(ctx, item.children.find(c => c.data.role === 'frame'));
    else if (item.data && item.data.kind === 'pathtext') { LV.tracePath(ctx, item.children.find(c => c.data.role === 'guide')); }
    else if (item.internalBounds) {
      const M = P.view.matrix.appended(item.globalMatrix), b = item.internalBounds;
      const q = [b.topLeft, b.topRight, b.bottomRight, b.bottomLeft].map(p => M.transform(p));
      ctx.moveTo(q[0].x, q[0].y); q.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.closePath();
    }
  };
  const square = (ctx, p, r, fill) => { ctx.fillStyle = fill; ctx.fillRect(Math.round(p.x) - r + .5, Math.round(p.y) - r + .5, r * 2, r * 2); ctx.strokeRect(Math.round(p.x) - r + .5, Math.round(p.y) - r + .5, r * 2, r * 2); };
  LV.handlePositions = r => {
    const tl = LV.v(r.topLeft), br = LV.v(r.bottomRight), cx = (tl.x + br.x) / 2, cy = (tl.y + br.y) / 2;
    return [[tl.x, tl.y], [cx, tl.y], [br.x, tl.y], [br.x, cy], [br.x, br.y], [cx, br.y], [tl.x, br.y], [tl.x, cy]].map(([x, y]) => new P.Point(x, y));
  };
  LV.drawAnchors = (ctx, path, { showHandles = 'selected' } = {}) => {
    const M = P.view.matrix.appended(path.globalMatrix);
    const segs = path.segments, selIdx = new Set(segs.filter(s => LV.selSegs.has(s)).map(s => s.index));
    ctx.lineWidth = 1; ctx.strokeStyle = SEL;
    segs.forEach((s, i) => {
      const near = selIdx.has(i) || selIdx.has(i - 1) || selIdx.has(i + 1) || (path.closed && (selIdx.has((i + 1) % segs.length) || selIdx.has((i - 1 + segs.length) % segs.length)));
      if (showHandles === 'all' || near && showHandles === 'selected') {
        const p = M.transform(s.point);
        for (const h of [s.handleIn, s.handleOut]) {
          if (h.isZero()) continue;
          const q = M.transform(s.point.add(h));
          ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fillStyle = selIdx.has(i) ? SEL : '#fff'; ctx.fill(); ctx.stroke();
        }
      }
    });
    segs.forEach((s, i) => square(ctx, M.transform(s.point), 3, selIdx.has(i) ? SEL : '#fff'));
  };
  function drawOverlay() {
    const ctx = co; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    if (!LV.doc) return;
    const tool = LV.tool || {};
    // ruler guides
    if (LV.prefs.guides) {
      ctx.strokeStyle = GUIDE; ctx.lineWidth = 1;
      LV.doc.guides.x.forEach(x => { const v = Math.round(LV.v(new P.Point(x, 0)).x) + .5; ctx.beginPath(); ctx.moveTo(v, 0); ctx.lineTo(v, H); ctx.stroke(); });
      LV.doc.guides.y.forEach(y => { const v = Math.round(LV.v(new P.Point(0, y)).y) + .5; ctx.beginPath(); ctx.moveTo(0, v); ctx.lineTo(W, v); ctx.stroke(); });
    }
    // hover highlight
    if (LV.hover && !LV.sel.includes(LV.hover) && LV.hover.parent) { ctx.strokeStyle = SEL; ctx.lineWidth = 1.5; ctx.beginPath(); LV.tracePath(ctx, LV.hover); ctx.stroke(); }
    // selection outlines
    ctx.strokeStyle = SEL; ctx.lineWidth = 1;
    LV.sel.forEach(it => { if (!it.parent) return; ctx.beginPath(); LV.tracePath(ctx, it); ctx.stroke(); });
    // area text overflow markers / text on path markers
    LV.sel.forEach(it => {
      if (it.data.overflow) { const b = it.bounds, p = LV.v(b.bottomRight); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#e0261b'; ctx.fillRect(p.x - 4, p.y - 4, 9, 9); ctx.strokeRect(p.x - 3.5, p.y - 3.5, 8, 8); ctx.beginPath(); ctx.moveTo(p.x - 2, p.y + .5); ctx.lineTo(p.x + 3, p.y + .5); ctx.moveTo(p.x + .5, p.y - 2); ctx.lineTo(p.x + .5, p.y + 3); ctx.stroke(); ctx.strokeStyle = SEL; }
    });
    // anchors (direct selection / pen)
    if (tool.showAnchors) LV.sel.forEach(it => { if (!it.parent) return; LV.leaves(it).forEach(l => { if (l instanceof P.Path) LV.drawAnchors(ctx, l); else if (l instanceof P.CompoundPath) l.children.forEach(c => LV.drawAnchors(ctx, c)); else if (l.data.kind === 'pathtext') LV.drawAnchors(ctx, l.children.find(c => c.data.role === 'guide')); }); });
    // bounding box
    if (tool.showBBox && LV.prefs.bbox && LV.sel.length && !LV.textEditing) {
      const r = LV.selBounds(); if (r) {
        const hp = LV.handlePositions(r), tl = hp[0], br = hp[4];
        ctx.strokeStyle = SEL; ctx.lineWidth = 1; ctx.strokeRect(Math.round(tl.x) + .5, Math.round(tl.y) + .5, Math.round(br.x - tl.x), Math.round(br.y - tl.y));
        hp.forEach(p => square(ctx, p, 3.5, '#fff'));
        const c = LV.v(r.center); ctx.fillStyle = SEL; ctx.fillRect(Math.round(c.x) - 1, Math.round(c.y) - 1, 3, 3);
      }
    }
    // marquee
    if (LV.marquee) {
      const a = LV.v(LV.marquee.topLeft), b = LV.v(LV.marquee.bottomRight);
      ctx.fillStyle = 'rgba(47,122,229,.08)'; ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
      ctx.setLineDash([4, 3]); ctx.strokeStyle = '#2f5f9a'; ctx.strokeRect(Math.round(a.x) + .5, Math.round(a.y) + .5, Math.round(b.x - a.x), Math.round(b.y - a.y)); ctx.setLineDash([]);
    }
    // smart guides
    if (LV.smartLines.length) {
      ctx.strokeStyle = SMART; ctx.lineWidth = 1; ctx.fillStyle = SMART; ctx.font = '10px "Segoe UI",sans-serif';
      LV.smartLines.forEach(l => {
        if (l.pt) { const p = LV.v(l.pt); ctx.beginPath(); ctx.moveTo(p.x - 4, p.y - 4); ctx.lineTo(p.x + 4, p.y + 4); ctx.moveTo(p.x + 4, p.y - 4); ctx.lineTo(p.x - 4, p.y + 4); ctx.stroke(); if (l.label) ctx.fillText(l.label, p.x + 6, p.y - 6); return; }
        const a = LV.v(l.a), b = LV.v(l.b); ctx.beginPath(); ctx.moveTo(Math.round(a.x) + .5, Math.round(a.y) + .5); ctx.lineTo(Math.round(b.x) + .5, Math.round(b.y) + .5); ctx.stroke();
      });
    }
    if (tool.overlay) { ctx.save(); tool.overlay(ctx); ctx.restore(); }
  }
  LV.SEL_COLOR = SEL;
})();
