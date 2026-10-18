'use strict';
/* Lumen Type — glyph editor: canvas view, select / pen / shape / measure / hand tools, path operations. */
(function () {
  const A = window.LT, TM = window.TM, $ = id => document.getElementById(id);
  const E = A.E = { s: 0.5, ox: 0, oy: 0, fitted: null, sel: new Set(), csel: new Set(), drag: null, pen: null, hover: null, measure: null, space: false, mouse: null };
  const hctx = document.createElement('canvas').getContext('2d');
  const key = (c, i) => c + ':' + i;
  const parseKey = k => k.split(':').map(Number);
  const G = () => A.font && A.glyph(A.cur);
  const toS = (x, y) => [E.ox + x * E.s, E.oy - y * E.s];
  const toF = (sx, sy) => [(sx - E.ox) / E.s, (E.oy - sy) / E.s];
  let cv, ctx, W = 0, H = 0;

  // ---------- view ----------
  A.fitGlyph = () => {
    const g = G(); if (!g || !cv) return;
    const I = A.font.info, b = A.R.glyphBox(A.font, g);
    const x0 = Math.min(0, b ? b.xMin : 0), x1 = Math.max(g.advance, b ? b.xMax : 0, I.unitsPerEm * 0.3);
    const y0 = Math.min(I.descender, b ? b.yMin : 0), y1 = Math.max(I.ascender, b ? b.yMax : 0);
    const r = cv.getBoundingClientRect(); const w = r.width || 800, h = r.height || 500;
    E.s = Math.min((w - 120) / (x1 - x0), (h - 70) / (y1 - y0));
    E.ox = w / 2 - (x0 + x1) / 2 * E.s; E.oy = h / 2 + (y0 + y1) / 2 * E.s;
    E.fitted = A.cur; redraw();
  };
  A.zoomEditor = (f, cx, cy) => {
    if (cx == null) { cx = W / 2; cy = H / 2; }
    const [fx, fy] = toF(cx, cy); E.s = Math.max(0.01, Math.min(40, E.s * f)); E.ox = cx - fx * E.s; E.oy = cy + fy * E.s; redraw();
  };
  A.editorActual = () => { const em = A.font.info.unitsPerEm; A.zoomEditor((H * 0.75 / em) / E.s); };

  // ---------- drawing ----------
  function redraw() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
  let raf = 0;
  A.redrawEditor = redraw;
  function draw() {
    if (!cv || A.view !== 'glyph' || !A.font) return;
    const r = A.R.sizeCanvas(cv); ctx = r.ctx; W = r.w; H = r.h;
    const g = G(); if (!g) return;
    if (E.fitted !== A.cur) { E.fitted = A.cur; A.fitGlyph(); return; }
    const F = A.font, I = F.info;
    ctx.fillStyle = '#e6ecf3'; ctx.fillRect(0, 0, W, H);
    // metrics box
    const [bx0, by0] = toS(0, I.ascender), [bx1, by1] = toS(g.advance, I.descender);
    ctx.fillStyle = '#fff'; ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
    ctx.shadowColor = 'transparent';
    // metric lines
    ctx.font = '11px "Segoe UI", Tahoma, sans-serif'; ctx.textBaseline = 'bottom';
    const lines = [['Ascender', I.ascender, '#8fa3bd'], ['Cap height', I.capHeight, '#8fa3bd'], ['x-height', I.xHeight, '#8fa3bd'], ['Baseline', 0, '#3d5675'], ['Descender', I.descender, '#8fa3bd']];
    if (A.prefs.metrics) lines.forEach(([n, y, c]) => {
      const sy = Math.round(toS(0, y)[1]) + .5;
      ctx.strokeStyle = c; ctx.lineWidth = y === 0 ? 1.2 : 1; ctx.setLineDash(y === 0 ? [] : [4, 3]);
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(W, sy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#5d7391'; ctx.fillText(`${n} ${y}`, 8, sy - 2);
    });
    // advance lines
    ctx.strokeStyle = '#5b7da6'; ctx.lineWidth = 1;
    [0, g.advance].forEach(x => { const sx = Math.round(toS(x, 0)[0]) + .5; ctx.beginPath(); ctx.moveTo(sx, by0 - 30); ctx.lineTo(sx, by1 + 30); ctx.stroke(); });
    if (E.hover && E.hover.kind === 'adv') { const sx = Math.round(toS(g.advance, 0)[0]) + .5; ctx.strokeStyle = '#2a6fd6'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx, by0 - 30); ctx.lineTo(sx, by1 + 30); ctx.stroke(); ctx.lineWidth = 1; }
    // context glyphs (from the preview text neighbours)
    drawNeighbours(g);
    // glyph body
    const fillMode = A.prefs.fill || E.space || A.prefs.tool === 'hand';
    ctx.save(); ctx.translate(E.ox, E.oy); ctx.scale(E.s, -E.s);
    const own = A.R.toPath2D(g.contours.reduce((o, c) => TM.contourCommands(c, o), []));
    ctx.fillStyle = fillMode ? '#141a22' : 'rgba(40,60,90,.09)'; ctx.fill(own, 'nonzero');
    g.components.forEach((c, i) => {
      const b = F.glyphs[c.base]; if (!b) return;
      ctx.save(); ctx.transform(c.m[0], c.m[1], c.m[2], c.m[3], c.m[4], c.m[5]);
      const p = A.R.glyphPath(F, b);
      ctx.fillStyle = fillMode ? '#141a22' : E.csel.has(i) ? 'rgba(42,111,214,.42)' : 'rgba(70,110,170,.26)'; ctx.fill(p, 'nonzero');
      if (!fillMode) { ctx.lineWidth = 1 / E.s / Math.sqrt(Math.abs(c.m[0] * c.m[3] - c.m[1] * c.m[2]) || 1); ctx.strokeStyle = E.csel.has(i) ? '#2a6fd6' : '#6d8db8'; ctx.stroke(p); }
      ctx.restore();
    });
    if (!fillMode) { ctx.lineWidth = 1.2 / E.s; ctx.strokeStyle = '#1b2633'; ctx.stroke(own); }
    ctx.restore();
    if (!fillMode) drawNodes(g);
    // component labels
    if (!fillMode) g.components.forEach((c, i) => { const b = F.glyphs[c.base]; const bb = b && A.R.glyphBox(F, b); if (!bb) return; const p = TM.tfPt(c.m, { x: bb.xMin, y: bb.yMax }); const [sx, sy] = toS(p.x, p.y); ctx.fillStyle = E.csel.has(i) ? '#1d5fc0' : '#5876a0'; ctx.textBaseline = 'bottom'; ctx.fillText(c.base, sx, sy - 3); });
    // sidebearings
    const sb = TM.sidebearings(F, g);
    ctx.fillStyle = '#2d4a6e'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
    const yb = by1 + 8;
    ctx.fillText(`${g.advance}`, (bx0 + bx1) / 2, yb + 14);
    if (sb.bounds) { ctx.fillText(`${sb.lsb}`, bx0 + Math.max(16, (toS(sb.bounds.xMin, 0)[0] - bx0) / 2), yb); ctx.fillText(`${sb.rsb}`, bx1 - Math.max(16, (bx1 - toS(sb.bounds.xMax, 0)[0]) / 2), yb); }
    ctx.textAlign = 'left';
    // marquee / measure / pen rubber band
    if (E.drag && E.drag.kind === 'marquee') { const d = E.drag; ctx.fillStyle = 'rgba(66,140,230,.12)'; ctx.strokeStyle = '#3a7bd5'; const x = Math.min(d.x0, d.x1), y = Math.min(d.y0, d.y1); ctx.fillRect(x, y, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0)); ctx.strokeRect(x + .5, y + .5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0)); }
    if (E.measure) drawMeasure(g);
    if (E.pen && E.mouse && !E.drag && A.prefs.tool === 'pen') {
      const c = g.contours[E.pen.ci]; if (c) { const last = c.points[c.points.length - 1], [ax, ay] = toS(last.x, last.y); ctx.strokeStyle = 'rgba(42,111,214,.6)'; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(E.mouse[0], E.mouse[1]); ctx.stroke(); ctx.setLineDash([]); }
    }
    hud(g);
  }
  function drawNeighbours(g) {
    const names = TM.textToGlyphs(A.font, A.previewText ? A.previewText() : '');
    const i = names.indexOf(A.cur); if (i < 0 || !A.prefs.metrics) return;
    const F = A.font;
    const prev = names[i - 1], next = names[i + 1];
    ctx.save();
    if (prev && prev !== '\n' && F.glyphs[prev]) { const p = F.glyphs[prev], k = A.prefs.kern ? TM.kernValue(F, prev, A.cur) : 0; A.R.drawGlyph(ctx, F, p, E.ox + (-p.advance - k) * E.s, E.oy, E.s, 'rgba(60,80,110,.16)'); }
    if (next && next !== '\n' && F.glyphs[next]) { const k = A.prefs.kern ? TM.kernValue(F, A.cur, next) : 0; A.R.drawGlyph(ctx, F, F.glyphs[next], E.ox + (g.advance + k) * E.s, E.oy, E.s, 'rgba(60,80,110,.16)'); }
    ctx.restore();
  }
  function drawNodes(g) {
    ctx.lineWidth = 1;
    g.contours.forEach((c, ci) => {
      const P = c.points, segs = TM.segments(c);
      // handle lines
      ctx.strokeStyle = '#8c9bb0'; ctx.beginPath();
      segs.forEach(sg => {
        if (!sg.offs.length) return;
        const a = toS(P[sg.a].x, P[sg.a].y), b = toS(P[sg.b].x, P[sg.b].y), O = sg.offs.map(i => toS(P[i].x, P[i].y));
        if (sg.t === 'c' && O.length >= 2) { ctx.moveTo(...a); ctx.lineTo(...O[0]); ctx.moveTo(...b); ctx.lineTo(...O[O.length - 1]); }
        else { ctx.moveTo(...a); O.forEach(o => ctx.lineTo(...o)); ctx.lineTo(...b); }
      });
      if (!segs.length && P.length) { ctx.moveTo(...toS(P[0].x, P[0].y)); P.forEach(p => ctx.lineTo(...toS(p.x, p.y))); ctx.closePath(); }
      ctx.stroke();
      // start point arrow
      const s0 = P.findIndex(p => p.t !== 'o');
      if (s0 >= 0 && P.length > 1) {
        const p = P[s0], q = P[(s0 + 1) % P.length], [px, py] = toS(p.x, p.y), [qx, qy] = toS(q.x, q.y);
        const ang = Math.atan2(qy - py, qx - px);
        ctx.save(); ctx.translate(px, py); ctx.rotate(ang); ctx.fillStyle = '#e07a1f'; ctx.beginPath(); ctx.moveTo(14, 0); ctx.lineTo(7, -4.5); ctx.lineTo(7, 4.5); ctx.closePath(); ctx.fill(); ctx.restore();
      }
      P.forEach((p, i) => {
        const [x, y] = toS(p.x, p.y), sel = E.sel.has(key(ci, i)), hov = E.hover && E.hover.kind === 'pt' && E.hover.c === ci && E.hover.i === i;
        if (p.t === 'o') {
          ctx.beginPath(); ctx.arc(x, y, hov ? 4.2 : 3.3, 0, 7);
          ctx.fillStyle = sel ? '#2a6fd6' : '#fff'; ctx.strokeStyle = sel ? '#1b4f9c' : '#6d7f96'; ctx.fill(); ctx.stroke();
        } else if (p.s) {
          ctx.beginPath(); ctx.arc(x, y, hov ? 5.2 : 4.3, 0, 7);
          ctx.fillStyle = sel ? '#21934f' : '#fff'; ctx.strokeStyle = '#21934f'; ctx.lineWidth = 1.4; ctx.fill(); ctx.stroke(); ctx.lineWidth = 1;
        } else {
          const r = hov ? 4.5 : 3.6; ctx.fillStyle = sel ? '#2a6fd6' : '#fff'; ctx.strokeStyle = '#2a6fd6'; ctx.lineWidth = 1.4;
          ctx.fillRect(x - r, y - r, 2 * r, 2 * r); ctx.strokeRect(x - r, y - r, 2 * r, 2 * r); ctx.lineWidth = 1;
        }
      });
      if (c.open && P.length) { const [x, y] = toS(P[0].x, P[0].y); ctx.strokeStyle = '#e07a1f'; ctx.beginPath(); ctx.arc(x, y, 7, 0, 7); ctx.stroke(); }
    });
    // coordinates of single selected point
    if (A.prefs.coords && E.sel.size >= 1 && E.sel.size <= 2) {
      E.sel.forEach(k => { const [ci, i] = parseKey(k), p = g.contours[ci] && g.contours[ci].points[i]; if (!p) return; const [x, y] = toS(p.x, p.y); const s = `${Math.round(p.x)}, ${Math.round(p.y)}`; ctx.font = '11px "Segoe UI", sans-serif'; const w = ctx.measureText(s).width + 8; ctx.fillStyle = 'rgba(255,255,240,.92)'; ctx.strokeStyle = '#b8a96a'; ctx.fillRect(x + 8, y + 6, w, 16); ctx.strokeRect(x + 8.5, y + 6.5, w - 1, 15); ctx.fillStyle = '#3d3a20'; ctx.textBaseline = 'middle'; ctx.fillText(s, x + 12, y + 14); });
    }
  }
  function drawMeasure(g) {
    const m = E.measure, [ax, ay] = toS(m.x0, m.y0), [bx, by] = toS(m.x1, m.y1);
    ctx.strokeStyle = '#d2461f'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.lineWidth = 1;
    // intersections with the outline
    const dg = TM.cloneGlyph(g); TM.decompose(A.font, dg);
    const hits = [];
    dg.contours.forEach(c => { const P = TM.flatten(c, 24); for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; const t = segX(m.x0, m.y0, m.x1, m.y1, p[0], p[1], q[0], q[1]); if (t != null) hits.push(t); } });
    hits.sort((a, b) => a - b);
    const L = Math.hypot(m.x1 - m.x0, m.y1 - m.y0);
    ctx.font = '11px "Segoe UI", sans-serif'; ctx.textBaseline = 'middle';
    const label = (x, y, s) => { const w = ctx.measureText(s).width + 6; ctx.fillStyle = 'rgba(210,70,31,.92)'; ctx.fillRect(x - w / 2, y - 8, w, 16); ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.fillText(s, x, y); ctx.textAlign = 'left'; };
    const pts = [0, ...hits, 1];
    hits.forEach(t => { const [x, y] = toS(m.x0 + (m.x1 - m.x0) * t, m.y0 + (m.y1 - m.y0) * t); ctx.fillStyle = '#d2461f'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill(); });
    for (let i = 0; i < pts.length - 1; i++) { const d = (pts[i + 1] - pts[i]) * L; if (d * E.s < 22) continue; const t = (pts[i] + pts[i + 1]) / 2; const [x, y] = toS(m.x0 + (m.x1 - m.x0) * t, m.y0 + (m.y1 - m.y0) * t); label(x, y - 10, String(Math.round(d))); }
    const ang = Math.atan2(m.y1 - m.y0, m.x1 - m.x0) * 180 / Math.PI;
    label(bx + 34, by, `${Math.round(L)} · ${ang.toFixed(1)}°`);
  }
  function segX(x1, y1, x2, y2, x3, y3, x4, y4) {
    const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4); if (Math.abs(d) < 1e-9) return null;
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d, u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / d;
    return t >= 0 && t <= 1 && u >= 0 && u < 1 ? t : null;
  }
  function hud(g) {
    const sb = TM.sidebearings(A.font, g), u = g.unicodes[0];
    $('edHud').innerHTML = `<b>${Aero.esc(g.name)}</b>${u != null ? ` <span>U+${TM.hex(u)}</span>` : ''} <span class="dim">${u != null ? Aero.esc(TM.uniName(u).toLowerCase()) : 'unencoded'}</span>`;
    A.status(2, `Advance ${g.advance} · LSB ${sb.lsb} · RSB ${sb.rsb}`);
    A.status(3, `${g.contours.length} contour${g.contours.length === 1 ? '' : 's'} · ${g.contours.reduce((a, c) => a + c.points.length, 0)} points${g.components.length ? ` · ${g.components.length} component${g.components.length > 1 ? 's' : ''}` : ''}${E.sel.size ? ` · ${E.sel.size} selected` : ''}`);
    A.status(1, `Zoom ${Math.round(E.s * A.font.info.unitsPerEm / 10)}%`);
  }

  // ---------- hit testing ----------
  function hitPoint(g, sx, sy, r = 7) {
    let best = null;
    g.contours.forEach((c, ci) => c.points.forEach((p, i) => { const [x, y] = toS(p.x, p.y), d = Math.hypot(x - sx, y - sy); if (d <= r && (!best || d < best.d - (p.t !== 'o' ? 0.5 : 0))) best = { c: ci, i, d }; }));
    return best;
  }
  function hitSegment(g, sx, sy) {
    const [fx, fy] = toF(sx, sy); let best = null;
    g.contours.forEach((c, ci) => { const n = TM.nearestOnContour(c, fx, fy); if (n && n.d * E.s < 5 && (!best || n.d < best.d)) best = { c: ci, ...n }; });
    return best;
  }
  function hitComponent(g, sx, sy) {
    const [fx, fy] = toF(sx, sy);
    for (let i = g.components.length - 1; i >= 0; i--) {
      const c = g.components[i], b = A.font.glyphs[c.base]; if (!b) continue;
      const m = c.m, det = m[0] * m[3] - m[1] * m[2]; if (!det) continue;
      const x = fx - m[4], y = fy - m[5], ix = (m[3] * x - m[2] * y) / det, iy = (-m[1] * x + m[0] * y) / det;
      if (hctx.isPointInPath(A.R.glyphPath(A.font, b), ix, iy, 'nonzero')) return i;
    }
    return -1;
  }
  const nearAdvance = (g, sx, sy) => Math.abs(toS(g.advance, 0)[0] - sx) < 5 && sy > toS(0, A.font.info.ascender)[1] - 30 && sy < toS(0, A.font.info.descender)[1] + 30;

  // ---------- selection helpers ----------
  function validateSel() {
    const g = G(); if (!g) { E.sel.clear(); E.csel.clear(); return; }
    [...E.sel].forEach(k => { const [c, i] = parseKey(k); if (!g.contours[c] || !g.contours[c].points[i]) E.sel.delete(k); });
    [...E.csel].forEach(i => { if (!g.components[i]) E.csel.delete(i); });
    if (E.pen && (!g.contours[E.pen.ci] || !g.contours[E.pen.ci].open)) E.pen = null;
  }
  // points that move with the selection: selected points + cubic handles attached to selected on-curve points
  function movingSet(g) {
    const s = new Set(E.sel);
    g.contours.forEach((c, ci) => TM.segments(c).forEach(sg => {
      if (sg.t !== 'c') return;
      if (E.sel.has(key(ci, sg.a)) && sg.offs.length) s.add(key(ci, sg.offs[0]));
      if (E.sel.has(key(ci, sg.b)) && sg.offs.length) s.add(key(ci, sg.offs[sg.offs.length - 1]));
    }));
    return s;
  }
  // for a dragged off-curve: its on-curve owner and the opposite handle
  function handleInfo(c, i) {
    const P = c.points, n = P.length;
    for (const sg of TM.segments(c)) {
      const k = sg.offs.indexOf(i); if (k < 0) continue;
      if (sg.t === 'c' && sg.offs.length >= 2) {
        const owner = k === 0 ? sg.a : k === sg.offs.length - 1 ? sg.b : -1; if (owner < 0) return null;
        const opp = owner === sg.a ? (owner - 1 + n) % n : (owner + 1) % n;
        if (c.open && ((owner === 0 && opp === n - 1) || (owner === n - 1 && opp === 0))) return { owner, opp: -1 };
        return { owner, opp };
      }
      return null;
    }
    return null;
  }
  const snapY = (y) => { const I = A.font.info, t = 5 / E.s; for (const v of [0, I.xHeight, I.capHeight, I.ascender, I.descender]) if (Math.abs(y - v) < t) return v; return y; };

  // ---------- pointer ----------
  function onDown(e) {
    if (!A.font || !G()) return;
    cv.focus();
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top, g = G();
    const [fx, fy] = toF(sx, sy);
    const tool = E.space || e.button === 1 ? 'hand' : A.prefs.tool;
    try { cv.setPointerCapture(e.pointerId); } catch (x) { }
    if (tool === 'hand') { E.drag = { kind: 'pan', sx, sy, ox: E.ox, oy: E.oy }; return; }
    if (tool === 'measure') { E.measure = { x0: Math.round(fx), y0: Math.round(fy), x1: Math.round(fx), y1: Math.round(fy) }; E.drag = { kind: 'measure' }; redraw(); return; }
    if (tool === 'rect' || tool === 'ellipse') {
      const live = A.liveStart(tool === 'rect' ? 'Rectangle' : 'Ellipse'); const gg = live.glyph(A.cur);
      gg.contours.push({ points: [] });
      E.drag = { kind: 'shape', tool, x0: Math.round(fx), y0: Math.round(fy), ci: gg.contours.length - 1 }; return;
    }
    if (tool === 'pen') return penDown(e, g, sx, sy, fx, fy);
    // select tool
    const hp = hitPoint(g, sx, sy);
    if (e.detail >= 2 && hp) { toggleSmooth([key(hp.c, hp.i)]); return; }
    if (hp) {
      const k = key(hp.c, hp.i);
      if (e.shiftKey) { if (E.sel.has(k)) E.sel.delete(k); else E.sel.add(k); }
      else if (!E.sel.has(k)) { E.sel.clear(); E.csel.clear(); E.sel.add(k); }
      startMove(g, sx, sy, hp);
      redraw(); A.emit('esel'); return;
    }
    if (nearAdvance(g, sx, sy)) { E.drag = { kind: 'adv', sx, adv0: g.advance }; return; }
    const hs = hitSegment(g, sx, sy);
    if (hs) {
      if (e.altKey) { insertPoint(hs); return; }
      const c = g.contours[hs.c];
      if (e.detail >= 2) { E.sel.clear(); c.points.forEach((p, i) => E.sel.add(key(hs.c, i))); redraw(); A.emit('esel'); return; }
      const sg = TM.segments(c).find(s => s.b === hs.b);
      if (!e.shiftKey) { E.sel.clear(); E.csel.clear(); }
      [sg.a, sg.b].forEach(i => E.sel.add(key(hs.c, i)));
      startMove(g, sx, sy, null); redraw(); A.emit('esel'); return;
    }
    const hc = hitComponent(g, sx, sy);
    if (hc >= 0) {
      if (e.detail >= 2) { A.openGlyph(g.components[hc].base); return; }
      if (e.shiftKey) { if (E.csel.has(hc)) E.csel.delete(hc); else E.csel.add(hc); } else if (!E.csel.has(hc)) { E.csel.clear(); E.sel.clear(); E.csel.add(hc); }
      startMove(g, sx, sy, null); redraw(); A.emit('esel'); return;
    }
    if (!e.shiftKey) { E.sel.clear(); E.csel.clear(); A.emit('esel'); }
    E.drag = { kind: 'marquee', x0: sx, y0: sy, x1: sx, y1: sy, base: new Set(E.sel) };
    redraw();
  }
  function startMove(g, sx, sy, hp) {
    const mv = movingSet(g), orig = new Map();
    mv.forEach(k => { const [c, i] = parseKey(k); const p = g.contours[c].points[i]; orig.set(k, { x: p.x, y: p.y }); });
    const comps = new Map(); E.csel.forEach(i => comps.set(i, [g.components[i].m[4], g.components[i].m[5]]));
    let single = null;
    if (hp && E.sel.size === 1) { const c = g.contours[hp.c], p = c.points[hp.i]; if (p.t === 'o') { const hi = handleInfo(c, hp.i); if (hi) single = { c: hp.c, i: hp.i, ...hi, oppLen: hi.opp >= 0 ? Math.hypot(c.points[hi.opp].x - c.points[hi.owner].x, c.points[hi.opp].y - c.points[hi.owner].y) : 0 }; } }
    E.drag = { kind: 'move', sx, sy, orig, comps, single, onCurve: hp ? g.contours[hp.c].points[hp.i].t !== 'o' : false, moved: false };
  }
  function onMove(e) {
    const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
    E.mouse = [sx, sy];
    const [fx, fy] = toF(sx, sy);
    A.status(4, `${Math.round(fx)}, ${Math.round(fy)}`);
    const d = E.drag, g = G(); if (!g) return;
    if (!d) {
      const hp = A.prefs.tool === 'select' || A.prefs.tool === 'pen' ? hitPoint(g, sx, sy) : null;
      const nh = hp ? { kind: 'pt', c: hp.c, i: hp.i } : (A.prefs.tool === 'select' && nearAdvance(g, sx, sy)) ? { kind: 'adv' } : null;
      if (JSON.stringify(nh) !== JSON.stringify(E.hover)) { E.hover = nh; redraw(); }
      cv.style.cursor = E.space || A.prefs.tool === 'hand' ? 'grab' : nh && nh.kind === 'adv' ? 'ew-resize' : A.prefs.tool === 'select' ? 'default' : 'crosshair';
      if (E.pen) redraw();
      return;
    }
    if (d.kind === 'pan') { E.ox = d.ox + sx - d.sx; E.oy = d.oy + sy - d.sy; redraw(); return; }
    if (d.kind === 'measure') { let x = Math.round(fx), y = Math.round(fy); if (e.shiftKey) { if (Math.abs(x - E.measure.x0) > Math.abs(y - E.measure.y0)) y = E.measure.y0; else x = E.measure.x0; } E.measure.x1 = x; E.measure.y1 = y; redraw(); return; }
    if (d.kind === 'marquee') {
      d.x1 = sx; d.y1 = sy;
      E.sel = new Set(d.base);
      const x0 = Math.min(d.x0, sx), x1 = Math.max(d.x0, sx), y0 = Math.min(d.y0, sy), y1 = Math.max(d.y0, sy);
      g.contours.forEach((c, ci) => c.points.forEach((p, i) => { const [x, y] = toS(p.x, p.y); if (x >= x0 && x <= x1 && y >= y0 && y <= y1) E.sel.add(key(ci, i)); }));
      redraw(); return;
    }
    if (d.kind === 'adv') {
      const live = A.liveStart('Change Width'); const gg = live.glyph(A.cur);
      gg.advance = Math.max(0, Math.round(d.adv0 + (sx - d.sx) / E.s)); redraw(); A.emit('live'); return;
    }
    if (d.kind === 'shape') {
      let x0 = d.x0, y0 = d.y0, x1 = Math.round(fx), y1 = Math.round(fy);
      if (e.shiftKey) { const m = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)); x1 = x0 + Math.sign(x1 - x0 || 1) * m; y1 = y0 + Math.sign(y1 - y0 || 1) * m; }
      if (e.altKey) { x0 = 2 * d.x0 - x1; y0 = 2 * d.y0 - y1; }
      const gg = A.liveStart().glyph(A.cur);
      const [a, b, c2, dd] = [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
      let c = d.tool === 'rect' ? TM.rectContour(a, b, c2, dd) : TM.ellipseContour((a + c2) / 2, (b + dd) / 2, (c2 - a) / 2, (dd - b) / 2);
      if (d.tool === 'ellipse' && A.prefs.penMode === 'quadratic') { c = TM.contourToQuadratic(c, 1); c.points.forEach(p => { p.x = Math.round(p.x); p.y = Math.round(p.y); }); }
      gg.contours[d.ci] = c; d.made = c2 - a > 0 && dd - b > 0; redraw(); return;
    }
    if (d.kind === 'pen') return penMove(e, d, fx, fy);
    if (d.kind === 'move') {
      let dx = (sx - d.sx) / E.s, dy = -(sy - d.sy) / E.s;
      if (!d.moved && Math.hypot(sx - d.sx, sy - d.sy) < 3) return;
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      dx = Math.round(dx); dy = Math.round(dy);
      const live = A.liveStart(d.single ? 'Move Handle' : E.csel.size && !E.sel.size ? 'Move Component' : 'Move Points'); const gg = live.glyph(A.cur);
      d.moved = true;
      // vertical snap of on-curve points to metric lines
      if (d.onCurve && !e.ctrlKey && E.sel.size <= 2) { const k = [...E.sel][0], o = d.orig.get(k); if (o) dy = snapY(o.y + dy) - o.y; }
      d.orig.forEach((o, k) => { const [c, i] = parseKey(k); const p = gg.contours[c] && gg.contours[c].points[i]; if (p) { p.x = o.x + dx; p.y = o.y + dy; } });
      d.comps.forEach((o, i) => { if (gg.components[i]) { gg.components[i].m[4] = o[0] + dx; gg.components[i].m[5] = o[1] + dy; } });
      if (d.single) {
        const c = gg.contours[d.single.c], P = c.points, h = P[d.single.i], own = P[d.single.owner];
        if (own.s) {
          const opp = d.single.opp >= 0 ? P[d.single.opp] : null;
          if (opp && opp.t === 'o') { const vx = h.x - own.x, vy = h.y - own.y, L = Math.hypot(vx, vy); if (L > 0) { opp.x = Math.round(own.x - vx / L * d.single.oppLen); opp.y = Math.round(own.y - vy / L * d.single.oppLen); } }
          else if (opp) { // tangent to a line segment: keep the handle on the line's direction
            const ux = own.x - opp.x, uy = own.y - opp.y, L = Math.hypot(ux, uy); if (L > 0) { const t = ((h.x - own.x) * ux + (h.y - own.y) * uy) / L; h.x = Math.round(own.x + ux / L * Math.max(0, t)); h.y = Math.round(own.y + uy / L * Math.max(0, t)); }
          }
        }
      }
      redraw(); A.emit('live');
    }
  }
  function onUp(e) {
    const d = E.drag; E.drag = null;
    try { cv.releasePointerCapture(e.pointerId); } catch (x) { }
    if (!d) return;
    if (d.kind === 'adv' || d.kind === 'move') { if (A.isLive()) A.liveEnd(); }
    else if (d.kind === 'shape') {
      if (!d.made) { A.liveEnd(false); return; }
      const gg = A.liveStart().glyph(A.cur); TM.correctDirections(gg);
      E.sel.clear(); gg.contours[d.ci] && gg.contours[d.ci].points.forEach((p, i) => E.sel.add(key(d.ci, i)));
      A.liveEnd(d.tool === 'rect' ? 'Rectangle' : 'Ellipse'); A.emit('esel');
    } else if (d.kind === 'pen') penUp(d);
    else if (d.kind === 'marquee') { A.emit('esel'); }
    redraw();
  }

  // ---------- pen ----------
  function penDown(e, g, sx, sy, fx, fy) {
    const x = Math.round(fx), y = Math.round(fy);
    const hp = hitPoint(g, sx, sy, 8);
    if (E.pen) {
      const c = g.contours[E.pen.ci];
      if (c && hp && hp.c === E.pen.ci && hp.i === 0 && c.points.length > 1) {   // close the contour
        const live = A.liveStart('Close Contour'); const cc = live.glyph(A.cur).contours[E.pen.ci];
        const p0 = cc.points[0];
        setSegmentOffs(cc, cc.points.length, E.pen.out, E.pen.firstIn, p0, true);
        delete cc.open;
        E.drag = { kind: 'pen', mode: 'close', ci: E.pen.ci, x0: p0.x, y0: p0.y, out: E.pen.out };
        return;
      }
      const live = A.liveStart('Add Point'); const cc = live.glyph(A.cur).contours[E.pen.ci];
      if (!cc) { E.pen = null; A.liveEnd(false); return; }
      const P = { x, y, t: 'l' }; cc.points.push(P);
      setSegmentOffs(cc, cc.points.length - 1, E.pen.out, null, P, false);
      E.drag = { kind: 'pen', mode: 'add', ci: E.pen.ci, x0: x, y0: y, out: E.pen.out };
      E.sel.clear(); E.sel.add(key(E.pen.ci, cc.points.length - 1));
      return;
    }
    // continue an open contour from one of its ends
    if (hp && g.contours[hp.c].open) {
      const c = g.contours[hp.c];
      if (hp.i === 0 || hp.i === c.points.length - 1) {
        if (hp.i === 0) A.change('Continue Contour', d => { const gg = d.glyph(A.cur); gg.contours[hp.c] = TM.reverseContour(gg.contours[hp.c]); });
        E.pen = { ci: hp.c, out: null, firstIn: null }; redraw(); return;
      }
    }
    // insert a point on a segment
    const hs = hitSegment(g, sx, sy);
    if (hs) { insertPoint(hs); return; }
    // start a new contour
    const live = A.liveStart('Draw Contour'); const gg = live.glyph(A.cur);
    gg.contours.push({ points: [{ x, y, t: 'l' }], open: true });
    E.pen = { ci: gg.contours.length - 1, out: null, firstIn: null };
    E.sel.clear(); E.sel.add(key(E.pen.ci, 0));
    E.drag = { kind: 'pen', mode: 'first', ci: E.pen.ci, x0: x, y0: y };
  }
  // rebuild the off-curve points of the segment ending at index bIdx (bIdx === points.length means the closing segment)
  function setSegmentOffs(c, bIdx, out, inH, P, closing) {
    const pts = c.points;
    // find previous on-curve before bIdx (for closing, the last on-curve of the list)
    let a = bIdx - 1; while (a >= 0 && pts[a].t === 'o') a--;
    const tail = closing ? pts.length : bIdx;
    pts.splice(a + 1, tail - (a + 1));     // remove existing offcurves of this segment
    const A0 = pts[a];
    const quad = A.prefs.penMode === 'quadratic';
    let offs = [];
    if (quad) { if (out) offs.push({ x: out.x, y: out.y, t: 'o' }); if (inH) offs.push({ x: inH.x, y: inH.y, t: 'o' }); }
    else if (out || inH) offs = [{ ...(out || { x: Math.round(A0.x + (P.x - A0.x) / 3), y: Math.round(A0.y + (P.y - A0.y) / 3) }), t: 'o' }, { ...(inH || { x: Math.round(P.x + (A0.x - P.x) / 3), y: Math.round(P.y + (A0.y - P.y) / 3) }), t: 'o' }];
    if (closing) pts.push(...offs); else pts.splice(a + 1, 0, ...offs);
    P.t = offs.length ? (quad ? 'q' : 'c') : 'l';
  }
  function penMove(e, d, fx, fy) {
    const x = Math.round(fx), y = Math.round(fy);
    if (!d.dragged && Math.hypot(x - d.x0, y - d.y0) * E.s < 3) return;
    d.dragged = true;
    const live = A.liveStart(); const c = live.glyph(A.cur).contours[d.ci]; if (!c) return;
    const inH = { x: 2 * d.x0 - x, y: 2 * d.y0 - y }, outH = { x, y };
    if (d.mode === 'first') { c.points[0].s = true; E.pen.out = outH; E.pen.firstIn = e.altKey ? null : inH; }
    else if (d.mode === 'add') { const P = c.points[c.points.length - 1]; P.s = !e.altKey; setSegmentOffs(c, c.points.length - 1, d.out, e.altKey ? null : inH, P, false); E.pen.out = outH; }
    else if (d.mode === 'close') {
      const p0 = c.points[0]; p0.s = true;
      setSegmentOffs(c, c.points.length, d.out, inH, p0, true);
      if (c.points[1] && c.points[1].t === 'o') { c.points[1].x = x; c.points[1].y = y; }
    }
    redraw();
  }
  function penUp(d) {
    if (d.mode === 'add' && !d.dragged) E.pen.out = null;
    if (d.mode === 'first' && !d.dragged) { E.pen.out = null; E.pen.firstIn = null; }
    if (d.mode === 'close') { E.pen = null; const gg = A.liveStart().glyph(A.cur); const c = gg.contours[d.ci]; if (c) TM.canonical(c); TM.correctDirections(gg); }
    A.liveEnd(d.mode === 'close' ? 'Close Contour' : d.mode === 'first' ? 'Draw Contour' : 'Add Point');
    A.emit('esel');
  }
  function insertPoint(hs) {
    let ni = -1;
    A.change('Add Point', d => { const c = d.glyph(A.cur).contours[hs.c]; ni = TM.splitSegment(c, hs.b, hs.t); if (ni < 0) return false; });
    if (ni >= 0) { E.sel.clear(); E.sel.add(key(hs.c, ni)); A.emit('esel'); }
  }
  A.penFinish = () => { if (E.pen) { E.pen = null; redraw(); return true; } return false; };

  // ---------- operations ----------
  const selContours = g => { const s = new Set(); E.sel.forEach(k => s.add(parseKey(k)[0])); return s.size ? s : new Set(g.contours.map((c, i) => i)); };
  function op(label, fn, keepSel) {
    const g = G(); if (!g) return;
    const ok = A.change(label, d => fn(d.glyph(A.cur), d));
    if (ok && !keepSel) { E.sel.clear(); E.csel.clear(); }
    validateSel(); redraw(); A.emit('esel');
  }
  function toggleSmooth(keys) {
    op('Toggle Smooth', g => { keys.forEach(k => { const [c, i] = parseKey(k), p = g.contours[c] && g.contours[c].points[i]; if (p && p.t !== 'o') { if (p.s) delete p.s; else { p.s = true; alignHandles(g.contours[c], i); } } }); }, true);
  }
  function alignHandles(c, i) {
    const P = c.points, n = P.length, p = P[i], a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
    if (a.t === 'o' && b.t === 'o') { const vx = b.x - a.x, vy = b.y - a.y, L = Math.hypot(vx, vy); if (!L) return; const la = Math.hypot(a.x - p.x, a.y - p.y), lb = Math.hypot(b.x - p.x, b.y - p.y); a.x = Math.round(p.x - vx / L * la); a.y = Math.round(p.y - vy / L * la); b.x = Math.round(p.x + vx / L * lb); b.y = Math.round(p.y + vy / L * lb); }
    else if (a.t === 'o' || b.t === 'o') { const h = a.t === 'o' ? a : b, o = a.t === 'o' ? b : a; const ux = p.x - o.x, uy = p.y - o.y, L = Math.hypot(ux, uy); if (!L) return; const lh = Math.hypot(h.x - p.x, h.y - p.y); h.x = Math.round(p.x + ux / L * lh); h.y = Math.round(p.y + uy / L * lh); }
  }
  A.ed = {
    selectAll() { const g = G(); if (!g) return; E.sel.clear(); g.contours.forEach((c, ci) => c.points.forEach((p, i) => E.sel.add(key(ci, i)))); g.components.forEach((c, i) => E.csel.add(i)); redraw(); A.emit('esel'); },
    deselect() { E.sel.clear(); E.csel.clear(); redraw(); A.emit('esel'); },
    hasSelection: () => E.sel.size > 0 || E.csel.size > 0,
    deleteSel() {
      const g = G(); if (!g || (!E.sel.size && !E.csel.size)) return false;
      const by = new Map(); E.sel.forEach(k => { const [c, i] = parseKey(k); if (!by.has(c)) by.set(c, []); by.get(c).push(i); });
      op('Delete', gg => {
        by.forEach((idx, c) => { const cc = gg.contours[c]; const whole = idx.length >= cc.points.length; gg.contours[c] = whole ? null : TM.deletePoints(cc, idx); });
        gg.contours = gg.contours.filter(Boolean);
        gg.components = gg.components.filter((c, i) => !E.csel.has(i));
      });
      E.pen = null; return true;
    },
    reverse() { op('Reverse Contours', g => { selContours(g).forEach(i => { g.contours[i] = TM.reverseContour(g.contours[i]); }); }); },
    correctDirection() { let n = 0; op('Correct Path Direction', g => { n = TM.correctDirections(g); g.contours.forEach(TM.canonical); }); A.toast(n ? `Reversed ${n} contour${n > 1 ? 's' : ''}` : 'Path directions are already correct'); },
    removeOverlap() { const g = G(); if (!g || !g.contours.length) return A.toast('No contours to merge'); op('Remove Overlap', gg => { if (!window.Overlap.removeOverlap(gg, window.paper)) return false; }); },
    round() { op('Round Coordinates', g => TM.roundGlyph(g), true); },
    toQuadratic() { op('Convert to Quadratic', g => { selContours(g).forEach(i => { const c = TM.contourToQuadratic(g.contours[i], 1); c.points.forEach(p => { p.x = Math.round(p.x); p.y = Math.round(p.y); }); g.contours[i] = c; }); }); },
    toCubic() { op('Convert to Cubic', g => { selContours(g).forEach(i => { const c = TM.contourToCubic(g.contours[i]); c.points.forEach(p => { p.x = Math.round(p.x); p.y = Math.round(p.y); }); g.contours[i] = c; }); }); },
    addExtremes() {
      let added = 0;
      op('Add Extremes', g => {
        selContours(g).forEach(ci => {
          let guard = 0, again = true;
          while (again && guard++ < 200) {
            again = false; const c = g.contours[ci];
            for (const sg of TM.segments(c)) {
              if (sg.t !== 'c' || sg.offs.length < 2) continue;
              const P = c.points, p0 = P[sg.a], p1 = P[sg.offs[0]], p2 = P[sg.offs[1]], p3 = P[sg.b];
              let ts = [];
              ['x', 'y'].forEach(k => { const a = -p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k], b = 2 * (p0[k] - 2 * p1[k] + p2[k]), cc = p1[k] - p0[k]; if (Math.abs(a) < 1e-9) { if (Math.abs(b) > 1e-9) ts.push(-cc / b); } else { const dd = b * b - 4 * a * cc; if (dd >= 0) { const r = Math.sqrt(dd); ts.push((-b + r) / (2 * a), (-b - r) / (2 * a)); } } });
              ts = ts.filter(t => t > 0.03 && t < 0.97);
              if (ts.length) { TM.splitSegment(c, sg.b, ts[0]); added++; again = true; break; }
            }
          }
        });
        if (!added) return false;
      });
      A.toast(added ? `Added ${added} extreme point${added > 1 ? 's' : ''}` : 'No missing extremes');
    },
    setStart() {
      const k = [...E.sel].find(k => { const [c, i] = parseKey(k); const p = G().contours[c].points[i]; return p.t !== 'o'; });
      if (!k) return A.toast('Select an on-curve point');
      const [ci, i] = parseKey(k);
      op('Set Start Point', g => { const c = g.contours[ci]; if (c.open) return false; c.points = c.points.slice(i).concat(c.points.slice(0, i)); });
    },
    closePaths() { op('Close Path', g => { let n = 0; g.contours.forEach(c => { if (c.open) { delete c.open; TM.canonical(c); n++; } }); if (!n) return false; TM.correctDirections(g); }); E.pen = null; },
    transform(m, label) {
      const g = G(); if (!g) return;
      const hasPts = E.sel.size > 0;
      op(label || 'Transform', gg => {
        if (!hasPts && !E.csel.size) { TM.transformGlyph(gg, m); return; }
        const mv = movingSet(gg);
        mv.forEach(k => { const [c, i] = parseKey(k), p = gg.contours[c].points[i]; const q = TM.tfPt(m, p); p.x = Math.round(q.x); p.y = Math.round(q.y); });
        E.csel.forEach(i => { gg.components[i].m = TM.tfMul(m, gg.components[i].m); });
      }, true);
    },
    selectionBox() {
      const g = G(); if (!g) return null;
      let pts = [];
      if (E.sel.size) E.sel.forEach(k => { const [c, i] = parseKey(k); pts.push(g.contours[c].points[i]); });
      else if (!E.csel.size) { const b = A.R.glyphBox(A.font, g); return b; }
      E.csel.forEach(i => { const c = g.components[i], b = A.R.glyphBox(A.font, A.font.glyphs[c.base]); if (b) [[b.xMin, b.yMin], [b.xMax, b.yMax]].forEach(([x, y]) => pts.push(TM.tfPt(c.m, { x, y }))); });
      if (!pts.length) return null;
      return { xMin: Math.min(...pts.map(p => p.x)), xMax: Math.max(...pts.map(p => p.x)), yMin: Math.min(...pts.map(p => p.y)), yMax: Math.max(...pts.map(p => p.y)) };
    },
    flip(axis) {
      const b = A.ed.selectionBox(); if (!b) return;
      const cx = (b.xMin + b.xMax) / 2, cy = (b.yMin + b.yMax) / 2;
      A.ed.transform(axis === 'h' ? [-1, 0, 0, 1, 2 * cx, 0] : [1, 0, 0, -1, 0, 2 * cy], axis === 'h' ? 'Flip Horizontal' : 'Flip Vertical');
      if (!E.sel.size && !E.csel.size) return;
      // flipping a subset reverses its direction: fix contours that are now wrong
      op('Correct Path Direction', g => { TM.correctDirections(g); }, true);
    },
    transformDialog() {
      const b = A.ed.selectionBox() || { xMin: 0, xMax: 0, yMin: 0, yMax: 0 };
      Aero.dialog({ title: 'Transform', instruction: E.sel.size || E.csel.size ? 'Applies to the selected points / components.' : 'Applies to the whole glyph.', fields: [
        { key: 'dx', label: 'Move X', type: 'number', value: 0 }, { key: 'dy', label: 'Move Y', type: 'number', value: 0 },
        { key: 'sx', label: 'Scale X %', type: 'number', value: 100 }, { key: 'sy', label: 'Scale Y %', type: 'number', value: 100 },
        { key: 'rot', label: 'Rotate °', type: 'number', value: 0 }, { key: 'skew', label: 'Slant °', type: 'number', value: 0 },
        { key: 'origin', label: 'Origin', type: 'select', value: 'center', options: [['center', 'Selection center'], ['base', 'Baseline / left of selection'], ['zero', 'Glyph origin (0, 0)']] }],
        onOK: v => {
          const o = v.origin === 'zero' ? [0, 0] : v.origin === 'base' ? [b.xMin, 0] : [(b.xMin + b.xMax) / 2, (b.yMin + b.yMax) / 2];
          const r = (v.rot || 0) * Math.PI / 180, k = Math.tan((v.skew || 0) * Math.PI / 180), sx = (v.sx || 100) / 100, sy = (v.sy || 100) / 100;
          let m = [1, 0, 0, 1, -o[0], -o[1]];
          m = TM.tfMul([sx, 0, 0, sy, 0, 0], m); m = TM.tfMul([1, 0, k, 1, 0, 0], m); m = TM.tfMul([Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0], m);
          m = TM.tfMul([1, 0, 0, 1, o[0] + (v.dx || 0), o[1] + (v.dy || 0)], m);
          A.ed.transform(m, 'Transform');
          if (sx * sy < 0) op('Correct Path Direction', g => { TM.correctDirections(g); }, true);
        } });
    },
    decompose() { const g = G(); if (!g || !g.components.length) return A.toast('This glyph has no components'); op('Decompose', gg => { if (E.csel.size) { const keep = gg.components.filter((c, i) => !E.csel.has(i)); gg.components = gg.components.filter((c, i) => E.csel.has(i)); TM.decompose(A.font, gg); gg.components = keep; } else TM.decompose(A.font, gg); TM.roundGlyph(gg); }); },
    addComponentDialog() {
      const g = G(); if (!g) return;
      const opts = A.font.order.filter(n => n !== A.cur && !TM.usesComponent(A.font, n, A.cur));
      Aero.dialog({ title: 'Add Component', instruction: `Insert another glyph into “${A.cur}” as a linked component.`, fields: [
        { key: 'base', label: 'Glyph', type: 'text', value: '' }, { key: 'x', label: 'Offset X', type: 'number', value: 0 }, { key: 'y', label: 'Offset Y', type: 'number', value: 0 }],
        html: `<datalist id="compList">${opts.slice(0, 3000).map(n => `<option value="${Aero.esc(n)}">`).join('')}</datalist>`,
        onOK: v => {
          const n = String(v.base || '').trim(); if (!A.glyph(n)) return A.toast('No glyph named ' + n);
          if (n === A.cur || TM.usesComponent(A.font, n, A.cur)) return A.toast('That would make a component loop');
          op('Add Component', gg => { gg.components.push({ base: n, m: [1, 0, 0, 1, Math.round(v.x || 0), Math.round(v.y || 0)] }); });
          E.csel.clear(); E.csel.add(G().components.length - 1); redraw();
        } });
      setTimeout(() => { const i = document.querySelector('.aero-box input[type=text]'); if (i) i.setAttribute('list', 'compList'); });
    },
    convertSegments(to) {
      const g = G(); if (!g || !E.sel.size) return A.toast('Select the points of the segments to convert');
      op(to === 'line' ? 'Convert to Line' : 'Convert to Curve', gg => {
        let n = 0;
        gg.contours.forEach((c, ci) => {
          const segs = TM.segments(c).filter(sg => E.sel.has(key(ci, sg.a)) && E.sel.has(key(ci, sg.b)));
          if (!segs.length) return;
          const drop = new Set(), adds = new Map();
          segs.forEach(sg => {
            if (to === 'line' && sg.offs.length) { sg.offs.forEach(i => drop.add(i)); c.points[sg.b].t = 'l'; n++; }
            else if (to === 'curve' && !sg.offs.length) {
              const a = c.points[sg.a], b = c.points[sg.b], q = A.prefs.penMode === 'quadratic';
              adds.set(sg.b, q ? [{ x: Math.round((a.x + b.x) / 2), y: Math.round((a.y + b.y) / 2), t: 'o' }] : [{ x: Math.round(a.x + (b.x - a.x) / 3), y: Math.round(a.y + (b.y - a.y) / 3), t: 'o' }, { x: Math.round(a.x + (b.x - a.x) * 2 / 3), y: Math.round(a.y + (b.y - a.y) * 2 / 3), t: 'o' }]);
              c.points[sg.b].t = q ? 'q' : 'c'; n++;
            }
          });
          const out = [];
          c.points.forEach((p, i) => { if (drop.has(i)) return; if (adds.has(i)) { if (i === 0 && !c.open) { out.push(p); return; } out.push(...adds.get(i)); } out.push(p); });
          if (adds.has(0) && !c.open) out.push(...adds.get(0));
          c.points = out;
        });
        if (!n) return false;
      });
    },
    nudge(dx, dy) {
      const g = G(); if (!g) return;
      if (!E.sel.size && !E.csel.size) return;
      const live = A.liveStart('Nudge'), gg = live.glyph(A.cur);
      movingSet(gg).forEach(k => { const [c, i] = parseKey(k), p = gg.contours[c].points[i]; p.x += dx; p.y += dy; });
      E.csel.forEach(i => { gg.components[i].m[4] += dx; gg.components[i].m[5] += dy; });
      A.liveEnd('Nudge'); redraw();
    },
    copy() {
      const g = G(); if (!g) return;
      const cs = selContours(g), whole = !E.sel.size && !E.csel.size;
      A.clip = { contours: [...cs].map(i => TM.clone(g.contours[i])), components: g.components.filter((c, i) => whole || E.csel.has(i)).map(c => ({ base: c.base, m: c.m.slice() })) };
      A.toast(`Copied ${A.clip.contours.length} contour(s)` + (A.clip.components.length ? ` and ${A.clip.components.length} component(s)` : ''));
    },
    paste() {
      if (!A.clip || !G()) return;
      let n0 = G().contours.length, c0 = G().components.length;
      op('Paste', g => { A.clip.contours.forEach(c => g.contours.push(TM.clone(c))); A.clip.components.forEach(c => { if (A.font.glyphs[c.base] && c.base !== A.cur && !TM.usesComponent(A.font, c.base, A.cur)) g.components.push({ base: c.base, m: c.m.slice() }); }); });
      const g = G(); E.sel.clear(); E.csel.clear();
      for (let ci = n0; ci < g.contours.length; ci++) g.contours[ci].points.forEach((p, i) => E.sel.add(key(ci, i)));
      for (let i = c0; i < g.components.length; i++) E.csel.add(i);
      redraw(); A.emit('esel');
    },
    toggleSmoothSel() { toggleSmooth([...E.sel]); },
    centerGlyph() { op('Center Glyph', (g, d) => { const sb = TM.sidebearings(d.font, g); if (!sb.bounds) return false; const t = Math.round((sb.lsb + sb.rsb) / 2); TM.setLSB(d.font, g, t); TM.setRSB(d.font, g, t); }, true); },
  };
  A.E.selectedPoints = () => { const g = G(); return g ? [...E.sel].map(k => { const [c, i] = parseKey(k); return { c, i, p: g.contours[c] && g.contours[c].points[i] }; }).filter(x => x.p) : []; };

  A.initEditor = () => {
    cv = $('edCv');
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('pointerleave', () => { E.mouse = null; if (E.pen) redraw(); });
    cv.addEventListener('dblclick', e => e.preventDefault());
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey || e.altKey) A.zoomEditor(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      else { E.ox -= e.shiftKey ? e.deltaY : e.deltaX; E.oy -= e.shiftKey ? 0 : e.deltaY; redraw(); }
    }, { passive: false });
    cv.addEventListener('keydown', e => {
      if (e.key === ' ' && !E.space) { E.space = true; cv.style.cursor = 'grab'; redraw(); e.preventDefault(); }
    });
    window.addEventListener('keyup', e => { if (e.key === ' ' && E.space) { E.space = false; redraw(); } });
    new ResizeObserver(() => { if (A.view === 'glyph') redraw(); }).observe(cv);
    A.on('change', a => { validateSel(); if (a && a.all) E.fitted = null; redraw(); });
    A.on('cur', () => { E.sel.clear(); E.csel.clear(); E.pen = null; E.measure = null; redraw(); A.emit('esel'); });
    A.on('view', v => { if (v === 'glyph') { redraw(); setTimeout(() => cv.focus()); } });
    A.on('tool', () => { if (A.prefs.tool !== 'pen') E.pen = null; if (A.prefs.tool !== 'measure') E.measure = null; redraw(); });
  };
})();
