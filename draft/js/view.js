// Lumen Draft — canvas view: model space / layout rendering, picking, window selection, object snaps, grips.
(function () {
  'use strict';
  const G = window.LDGeom, M = window.LDModel, X = window.LDExport;
  const APERTURE = 10, PICKBOX = 6;

  window.LDView = function (A) {
    const base = document.getElementById('cv'), over = document.getElementById('ov');
    const g = base.getContext('2d'), o = over.getContext('2d');
    let W = 0, H = 0, dpr = 1;
    const V = { model: { cx: 50, cy: 30, s: 4 }, layout: { cx: 210, cy: 148, s: 2 } };
    let bbCache = new WeakMap(), primCache = new WeakMap(), snapCache = new WeakMap(), hatchCache = new WeakMap();
    V.invalidate = () => { bbCache = new WeakMap(); primCache = new WeakMap(); snapCache = new WeakMap(); hatchCache = new WeakMap(); };
    const bbOf = e => { let b = bbCache.get(e); if (!b) { b = M.entBBox(A.doc, e); bbCache.set(e, b); } return b; };
    const primsOf = e => { let p = primCache.get(e); if (!p) { p = M.entPrims(A.doc, e); primCache.set(e, p); } return p; };
    const snapPrims = e => { let p = snapCache.get(e); if (!p) { p = M.entPrims(A.doc, e, true); snapCache.set(e, p); } return p; };
    V.bbOf = bbOf; V.primsOf = primsOf; V.snapPrims = snapPrims;

    /* ---------- transforms ---------- */
    const cur = () => A.space === 'layout' ? V.layout : V.model;
    // screen ↔ "space" coordinates (world in model, paper mm in layout)
    V.w2s = (x, y) => { const v = cur(); return [W / 2 + (x - v.cx) * v.s, H / 2 - (y - v.cy) * v.s]; };
    V.s2w = (sx, sy) => { const v = cur(); return [v.cx + (sx - W / 2) / v.s, v.cy - (sy - H / 2) / v.s]; };
    V.scale = () => cur().s;
    V.size = () => [W, H];
    V.resize = () => {
      const r = base.parentElement.getBoundingClientRect(); dpr = window.devicePixelRatio || 1; W = Math.max(50, r.width); H = Math.max(50, r.height);
      for (const c of [base, over]) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); c.style.width = W + 'px'; c.style.height = H + 'px'; }
      V.draw(); V.overlay();
    };
    V.zoomAt = (f, sx, sy) => { const v = cur(), p = V.s2w(sx, sy); v.s = Math.max(1e-6, Math.min(1e6, v.s * f)); const q = V.s2w(sx, sy); v.cx += p[0] - q[0]; v.cy += p[1] - q[1]; V.draw(); V.overlay(); };
    V.pan = (dx, dy) => { const v = cur(); v.cx -= dx / v.s; v.cy += dy / v.s; V.draw(); V.overlay(); };
    V.zoomBox = (b, pad = 0.06) => {
      const v = cur(); if (!b || !isFinite(b[0])) return;
      const w = Math.max(b[2] - b[0], 1e-6), h = Math.max(b[3] - b[1], 1e-6);
      v.s = Math.min(W * (1 - 2 * pad) / w, H * (1 - 2 * pad) / h); v.cx = (b[0] + b[2]) / 2; v.cy = (b[1] + b[3]) / 2; V.draw(); V.overlay();
    };
    V.zoomExtents = () => {
      if (A.space === 'layout') { const L = X.layoutGeom(A.doc); V.zoomBox([0, 0, L.W, L.H], 0.04); return; }
      const e = M.extents(A.doc); if (e) V.zoomBox(e); else V.zoomBox([0, 0, 420, 297]);
    };
    V.zoomScale = f => V.zoomAt(f, W / 2, H / 2);

    /* ---------- rendering ---------- */
    function cssRgb(c) { return `rgb(${c[0]},${c[1]},${c[2]})`; }
    function canvasSink(ctx, T, opt) {
      // T: screen = (x·m + tx, −y·m + ty)
      const { m, tx, ty } = T, X1 = x => x * m + tx, Y1 = y => -y * m + ty;
      let st = null, lw = 1;
      const pathPoly = (pts, closed) => {
        const n = pts.length; ctx.moveTo(X1(pts[0][0]), Y1(pts[0][1]));
        for (let i = 0; i < (closed ? n : n - 1); i++) {
          const p = pts[i], q = pts[(i + 1) % n], b = p[2] || 0;
          if (!b) { ctx.lineTo(X1(q[0]), Y1(q[1])); continue; }
          const a = G.bulgeArc(p, q, b); if (!a) { ctx.lineTo(X1(q[0]), Y1(q[1])); continue; }
          ctx.arc(X1(a.cx), Y1(a.cy), a.r * m, -a.a0, -(a.a0 + a.th), a.th > 0);
        }
        if (closed) ctx.closePath();
      };
      const color = s => {
        if (opt.mono) return opt.paper ? '#000' : '#fff';
        let c = s.rgb; if (s.aci === 7 && !s.ent?.rgb) c = opt.paper ? [0, 0, 0] : [255, 255, 255];
        else if (opt.paper && c[0] > 235 && c[1] > 235 && c[2] > 235) c = [0, 0, 0];
        return cssRgb(c);
      };
      let open = false, dashed = false, key = '';
      const begin = () => { if (!open) { ctx.beginPath(); open = true; } };
      const flush = () => { if (open) { ctx.stroke(); open = false; } };
      const after = () => { if (dashed) flush(); };
      return {
        flush,
        style(s) {
          st = s; const sel = opt.sel && opt.sel.has(s.ent.id), hov = opt.hover === s.ent.id;
          let w = opt.lwt ? Math.max(1, s.lw * opt.lwPx) : 1; if (hov) w += 1.5;
          const c = sel ? '#58a6ff' : opt.color || color(s);
          let dash = null;
          if (sel) dash = [6, 4];
          else { const d = M.dashPattern(A.doc, s); if (d) { const px = d.map(v => v * opt.dashPx); const tot = px.reduce((a2, b2) => a2 + b2, 0); if (tot > 3) dash = px.map(v => Math.max(v, 1)); } }
          const k = c + '|' + w + '|' + (dash ? dash.join(',') : '');
          if (k === key && !dash) return;
          flush(); key = k; lw = w; dashed = !!dash;
          ctx.lineWidth = w; ctx.strokeStyle = c; ctx.fillStyle = c; ctx.setLineDash(dash || []);
        },
        line(x1, y1, x2, y2) { begin(); ctx.moveTo(X1(x1), Y1(y1)); ctx.lineTo(X1(x2), Y1(y2)); after(); },
        poly(pts, closed, w) { if (w > 0) { flush(); ctx.beginPath(); pathPoly(pts, closed); const l = ctx.lineWidth; ctx.lineWidth = Math.max(l, w * m); ctx.stroke(); ctx.lineWidth = l; return; } begin(); pathPoly(pts, closed); after(); },
        arc(cx, cy, r, a1, sw) { begin(); ctx.moveTo(X1(cx + r * Math.cos(a1)), Y1(cy + r * Math.sin(a1))); ctx.arc(X1(cx), Y1(cy), Math.max(0, r * m), -a1, -(a1 + sw), true); after(); },
        circle(cx, cy, r) { begin(); ctx.moveTo(X1(cx + r), Y1(cy)); ctx.arc(X1(cx), Y1(cy), Math.max(0, r * m), 0, Math.PI * 2); after(); },
        fill(loops) { flush(); ctx.beginPath(); for (const l of loops) pathPoly(l.pts, true); const sel = opt.sel && opt.sel.has(st.ent.id); if (sel) { ctx.globalAlpha = 0.45; ctx.fill('evenodd'); ctx.globalAlpha = 1; ctx.stroke(); } else ctx.fill('evenodd'); },
        hatchLines(segs) {
          flush(); ctx.save(); ctx.setLineDash(opt.sel && opt.sel.has(st.ent.id) ? [4, 3] : []); ctx.lineWidth = opt.hover === st.ent.id ? 2.5 : 1; ctx.beginPath();
          for (const s of segs) { ctx.moveTo(X1(s[0]), Y1(s[1])); ctx.lineTo(X1(s[2]), Y1(s[3])); }
          ctx.stroke(); ctx.restore();
        },
        text(x, y, h, rot, s, al, va) {
          const px = h * G.EM * m; if (px < 1.2 || !s) return; flush();
          const bo = G.baseOff(va, h), c = Math.cos(rot), sn = Math.sin(rot);
          const bx = x - bo * sn, by = y + bo * c;
          ctx.save(); ctx.translate(X1(bx), Y1(by)); ctx.rotate(-rot);
          if (px < 4) { const w = G.textWidth(s, h) * m, x0 = al === 1 || al === 4 ? -w / 2 : al === 2 ? -w : 0; ctx.globalAlpha = 0.6; ctx.fillRect(x0, -px * 0.45, w, Math.max(1, px * 0.35)); ctx.restore(); return; }
          ctx.font = `${px}px Arial, Helvetica, sans-serif`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = al === 1 || al === 4 ? 'center' : al === 2 ? 'right' : 'left';
          ctx.fillText(s, 0, 0); ctx.restore();
        },
        point(x, y) { const sx = X1(x), sy = Y1(y); begin(); ctx.moveTo(sx - 3, sy - 3); ctx.lineTo(sx + 3, sy + 3); ctx.moveTo(sx + 3, sy - 3); ctx.lineTo(sx - 3, sy + 3); after(); },
      };
    }
    V.canvasSink = canvasSink;
    function visibleFilter(T) {
      // world bbox of the screen
      const x0 = (0 - T.tx) / T.m, x1 = (W - T.tx) / T.m, y0 = (T.ty - H) / T.m, y1 = T.ty / T.m, pad = 2 / T.m;
      return e => { const b = bbOf(e); return b[2] >= x0 - pad && b[0] <= x1 + pad && b[3] >= y0 - pad && b[1] <= y1 + pad; };
    }
    V.dark = true;
    V.draw = () => {
      if (!A.doc) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.lineCap = 'butt'; g.lineJoin = 'round';
      if (A.space === 'layout') return drawLayout();
      const v = V.model, T = { m: v.s, tx: W / 2 - v.cx * v.s, ty: H / 2 + v.cy * v.s };
      g.fillStyle = V.dark ? '#212830' : '#ffffff'; g.fillRect(0, 0, W, H);
      if (A.grid) drawGrid(T);
      drawUcs();
      const t0 = performance.now();
      const sk = canvasSink(g, T, { sel: A.selSet, lwt: A.lwt, lwPx: 3.2, dashPx: v.s, paper: !V.dark });
      M.emit(A.doc, A.doc.ents, sk, { filter: visibleFilter(T), hatchCache }); sk.flush();
      V.lastDrawMs = performance.now() - t0;
      if (A.selSet.size && A.selSet.size <= 200) drawGrips(g);
    };
    function drawGrid(T) {
      const s = T.m; let step = A.gridStep || 10; while (step * s < 8) step *= step % 3 === 0 ? 2 : 5; while (step * s > 80 && step / 10 >= 1e-6) step /= 10;
      const [x0, y1] = V.s2w(0, 0), [x1, y0] = V.s2w(W, H);
      g.save();
      const minor = V.dark ? 'rgba(255,255,255,0.045)' : 'rgba(0,40,90,0.06)', major = V.dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,40,90,0.13)';
      for (const [stp, col] of [[step, minor], [step * 5, major]]) {
        g.strokeStyle = col; g.lineWidth = 1; g.beginPath();
        for (let x = Math.ceil(x0 / stp) * stp; x <= x1; x += stp) { const sx = Math.round(x * s + T.tx) + 0.5; g.moveTo(sx, 0); g.lineTo(sx, H); }
        for (let y = Math.ceil(y0 / stp) * stp; y <= y1; y += stp) { const sy = Math.round(-y * s + T.ty) + 0.5; g.moveTo(0, sy); g.lineTo(W, sy); }
        g.stroke();
      }
      // axes
      g.strokeStyle = V.dark ? 'rgba(255,90,90,0.28)' : 'rgba(200,40,40,0.25)'; g.beginPath(); g.moveTo(0, Math.round(T.ty) + 0.5); g.lineTo(W, Math.round(T.ty) + 0.5); g.stroke();
      g.strokeStyle = V.dark ? 'rgba(90,220,90,0.28)' : 'rgba(30,150,30,0.25)'; g.beginPath(); g.moveTo(Math.round(T.tx) + 0.5, 0); g.lineTo(Math.round(T.tx) + 0.5, H); g.stroke();
      g.restore();
      V.gridShown = step;
    }
    function drawUcs() {
      const x = 22, y = H - 22; g.save(); g.lineWidth = 1.5;
      g.strokeStyle = '#e04848'; g.fillStyle = '#e04848'; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 34, y); g.stroke(); g.beginPath(); g.moveTo(x + 40, y); g.lineTo(x + 32, y - 3.5); g.lineTo(x + 32, y + 3.5); g.fill();
      g.strokeStyle = '#38c038'; g.fillStyle = '#38c038'; g.beginPath(); g.moveTo(x, y); g.lineTo(x, y - 34); g.stroke(); g.beginPath(); g.moveTo(x, y - 40); g.lineTo(x - 3.5, y - 32); g.lineTo(x + 3.5, y - 32); g.fill();
      g.font = '10px Segoe UI, Arial'; g.fillStyle = V.dark ? '#c9d1d9' : '#334'; g.fillText('X', x + 42, y + 4); g.fillText('Y', x - 3, y - 44);
      g.restore();
    }
    function drawLayout() {
      const L = X.layoutGeom(A.doc), v = V.layout, s = v.s;
      g.fillStyle = '#7d8b9a'; g.fillRect(0, 0, W, H);
      const P = (x, y) => [W / 2 + (x - v.cx) * s, H / 2 - (y - v.cy) * s];
      const [px0, py1] = P(0, L.H), [px1, py0] = P(L.W, 0);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(px0 + 5, py1 + 5, px1 - px0, py0 - py1);
      g.fillStyle = '#fff'; g.fillRect(px0, py1, px1 - px0, py0 - py1);
      // printable-area hint
      g.save(); g.setLineDash([3, 3]); g.strokeStyle = '#b8c4d0'; const [a0, a1] = P(5, L.H - 5), [b0, b1] = P(L.W - 5, 5); g.strokeRect(a0, a1, b0 - a0, b1 - a1); g.restore();
      // viewport (model space through the paper)
      const [vx0, vy1] = P(L.vp[0], L.vp[3]), [vx1, vy0] = P(L.vp[2], L.vp[1]);
      g.save(); g.beginPath(); g.rect(vx0, vy1, vx1 - vx0, vy0 - vy1); g.clip();
      const m = L.k * s, T = { m, tx: W / 2 + (L.ox - v.cx) * s, ty: H / 2 + (v.cy - L.oy) * s };
      const sk = canvasSink(g, T, { sel: null, lwt: A.lwt, lwPx: s, dashPx: s / L.k, paper: true });
      M.emit(A.doc, A.doc.ents, sk, { filter: visibleFilter(T), hatchCache, plot: true }); sk.flush();
      g.restore();
      // frame + title block (paper space)
      const Tp = { m: s, tx: W / 2 - v.cx * s, ty: H / 2 + v.cy * s }, ps = canvasSink(g, Tp, { lwt: true, lwPx: s, dashPx: s, paper: true });
      ps.fillWhite = r => { const [x0, y1] = P(r[0], r[3]), [x1, y0] = P(r[2], r[1]); g.fillStyle = '#fff'; g.fillRect(x0, y1, x1 - x0, y0 - y1); };
      const wrap = { ...ps, style: st => ps.style({ ...st, ent: { id: -1 } }), fillWhite: r => { ps.flush(); ps.fillWhite(r); } };
      X.paperItems(A.doc, L, wrap); ps.flush();
      // viewport outline (screen only)
      g.save(); g.strokeStyle = 'rgba(40,110,200,0.55)'; g.setLineDash([5, 4]); g.lineWidth = 1; g.strokeRect(vx0, vy1, vx1 - vx0, vy0 - vy1); g.restore();
      V.layoutGeom = L;
    }

    /* ---------- grips ---------- */
    function gripsOf(e) {
      const P = (x, y, fn) => ({ x, y, fn });
      switch (e.type) {
        case 'line': return [P(e.x1, e.y1, (q) => ({ ...e, x1: q[0], y1: q[1] })), P((e.x1 + e.x2) / 2, (e.y1 + e.y2) / 2, (q) => { const dx = q[0] - (e.x1 + e.x2) / 2, dy = q[1] - (e.y1 + e.y2) / 2; return { ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy }; }), P(e.x2, e.y2, (q) => ({ ...e, x2: q[0], y2: q[1] }))];
        case 'circle': return [P(e.cx, e.cy, q => ({ ...e, cx: q[0], cy: q[1] })), ...[0, 1, 2, 3].map(k => P(e.cx + e.r * Math.cos(k * Math.PI / 2), e.cy + e.r * Math.sin(k * Math.PI / 2), q => ({ ...e, r: Math.max(1e-6, G.dist(q, [e.cx, e.cy])) })))];
        case 'arc': {
          const s = G.pointAt(e, 0), en = [e.cx + e.r * Math.cos(e.a2), e.cy + e.r * Math.sin(e.a2)];
          return [P(e.cx, e.cy, q => ({ ...e, cx: q[0], cy: q[1] })), P(s[0], s[1], q => ({ ...e, a1: G.normA(G.ang(q[0] - e.cx, q[1] - e.cy)) })), P(en[0], en[1], q => ({ ...e, a2: G.normA(G.ang(q[0] - e.cx, q[1] - e.cy)) }))];
        }
        case 'pline': return e.pts.map((p, i) => P(p[0], p[1], q => ({ ...e, pts: e.pts.map((r, j) => j === i ? [q[0], q[1], r[2] || 0] : r) })));
        case 'text': case 'mtext': case 'point': return [P(e.x, e.y, q => ({ ...e, x: q[0], y: q[1] }))];
        case 'insert': return [P(e.x, e.y, q => ({ ...e, x: q[0], y: q[1] }))];
        case 'dim': return ['p1', 'p2', 'p', 'c'].filter(k => e[k]).map(k => P(e[k][0], e[k][1], q => ({ ...e, [k]: [q[0], q[1]] })));
        case 'hatch': return [];
      }
      return [];
    }
    V.gripsOf = gripsOf;
    function drawGrips(ctx) {
      ctx.save(); ctx.setLineDash([]);
      for (const e of A.doc.ents) {
        if (!A.selSet.has(e.id)) continue;
        for (const gp of gripsOf(e)) { const [sx, sy] = V.w2s(gp.x, gp.y); ctx.fillStyle = '#3a7bd5'; ctx.strokeStyle = '#dbe9ff'; ctx.lineWidth = 1; ctx.fillRect(sx - 4, sy - 4, 8, 8); ctx.strokeRect(sx - 4.5, sy - 4.5, 9, 9); }
      }
      ctx.restore();
    }
    V.gripAt = (sx, sy) => {
      if (A.space !== 'model') return null;
      for (const e of A.doc.ents) { if (!A.selSet.has(e.id)) continue; for (const gp of gripsOf(e)) { const [x, y] = V.w2s(gp.x, gp.y); if (Math.abs(x - sx) <= 5 && Math.abs(y - sy) <= 5) return { ent: e, grip: gp }; } }
      return null;
    };

    /* ---------- picking ---------- */
    const selectable = e => { const l = M.layerOf(A.doc, e.layer); return l.on && !l.frozen && !l.locked; };
    V.selectable = selectable;
    V.pick = (sx, sy, filter) => {
      if (A.space !== 'model') return null;
      const [x, y] = V.s2w(sx, sy), tol = PICKBOX / V.model.s; let best = null, bd = Infinity;
      for (let i = A.doc.ents.length - 1; i >= 0; i--) {
        const e = A.doc.ents[i]; if (!selectable(e) || (filter && !filter(e))) continue;
        const b = bbOf(e); if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) continue;
        let d = Infinity;
        if (e.type === 'text' || e.type === 'mtext') { if (G.pointInPoly(G.textCorners(e), x, y)) d = tol * 0.5; }
        else if (e.type === 'point') d = Math.hypot(x - e.x, y - e.y);
        else { for (const p of primsOf(e)) { const nn = G.primNearest(p, x, y); if (nn.d < d) d = nn.d; } if (e.type === 'hatch' && d > tol && G.pointInLoops(e.loops, x, y)) d = tol * 0.95; }
        if (d <= tol && d < bd - 1e-12) { bd = d; best = e; }
      }
      return best;
    };
    function primHitsRect(p, r) {
      const inR = (x, y) => x >= r[0] && x <= r[2] && y >= r[1] && y <= r[3];
      if (p.t === 'L') { if (inR(p.x1, p.y1) || inR(p.x2, p.y2)) return true; }
      else { const s = G.primStart(p); if (inR(s[0], s[1])) return true; }
      const edges = [G.L(r[0], r[1], r[2], r[1]), G.L(r[2], r[1], r[2], r[3]), G.L(r[2], r[3], r[0], r[3]), G.L(r[0], r[3], r[0], r[1])];
      return edges.some(ed => G.interPrims(p, ed).length > 0);
    }
    V.windowSelect = (r, crossing) => {   // r in world coords [x0,y0,x1,y1]
      const out = [];
      for (const e of A.doc.ents) {
        if (!selectable(e)) continue;
        const b = bbOf(e);
        if (b[0] >= r[0] && b[2] <= r[2] && b[1] >= r[1] && b[3] <= r[3]) { out.push(e.id); continue; }
        if (!crossing || b[2] < r[0] || b[0] > r[2] || b[3] < r[1] || b[1] > r[3]) continue;
        if (e.type === 'text' || e.type === 'mtext' || e.type === 'point') { out.push(e.id); continue; }
        if (primsOf(e).some(p => primHitsRect(p, r)) || (e.type === 'hatch' && G.pointInLoops(e.loops, (r[0] + r[2]) / 2, (r[1] + r[3]) / 2))) out.push(e.id);
      }
      return out;
    };

    /* ---------- object snaps ---------- */
    V.snap = (sx, sy, basePt, modes) => {
      if (A.space !== 'model') return null;
      const [x, y] = V.s2w(sx, sy), s = V.model.s, tol = APERTURE / s;
      const cand = [], near = [];
      for (const e of A.doc.ents) {
        if (!M.isVisible(A.doc, e)) continue;
        const b = bbOf(e); if (x < b[0] - tol || x > b[2] + tol || y < b[1] - tol || y > b[3] + tol) continue;
        if (e.type === 'point' && modes.node) cand.push({ x: e.x, y: e.y, k: 'node' });
        if ((e.type === 'text' || e.type === 'mtext' || e.type === 'insert') && modes.ins) cand.push({ x: e.x, y: e.y, k: 'ins' });
        if (e.type === 'dim' && modes.node) for (const key of ['p1', 'p2']) if (e[key]) cand.push({ x: e[key][0], y: e[key][1], k: 'node' });
        for (const p of snapPrims(e)) {
          const nn = G.primNearest(p, x, y); if (nn.d > tol) continue;
          near.push({ p, nn });
        }
      }
      for (const { p, nn } of near) {
        const full = p.t === 'A' && p.sw >= G.TAU - 1e-9;
        if (modes.end && !full) { const a = G.primStart(p), b = G.primEnd(p); cand.push({ x: a[0], y: a[1], k: 'end' }, { x: b[0], y: b[1], k: 'end' }); }
        if (modes.mid && !full) { const m = G.primPoint(p, 0.5); cand.push({ x: m[0], y: m[1], k: 'mid' }); }
        if (p.t === 'A') {
          if (modes.cen) cand.push({ x: p.cx, y: p.cy, k: 'cen', viaCurve: true });
          if (modes.quad) for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; if (G.onArc(p, a, 0)) cand.push({ x: p.cx + p.r * Math.cos(a), y: p.cy + p.r * Math.sin(a), k: 'quad' }); }
        }
        if (basePt && modes.perp) { const f = G.perpFoot(p, basePt[0], basePt[1]); if (f) cand.push({ x: f[0], y: f[1], k: 'perp' }); }
        if (basePt && modes.tan) for (const q of G.tangentPts(p, basePt[0], basePt[1])) cand.push({ x: q[0], y: q[1], k: 'tan' });
        if (modes.nea) cand.push({ x: nn.x, y: nn.y, k: 'nea' });
      }
      if (modes.int && near.length > 1) {
        const ps = near.slice(0, 60);
        for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) for (const q of G.interPrims(ps[i].p, ps[j].p)) cand.push({ x: q[0], y: q[1], k: 'int' });
      }
      let best = null, bd = Infinity;
      const prio = { end: 0, int: 0, mid: 1, cen: 1, quad: 1, node: 0, ins: 1, perp: 2, tan: 2, nea: 9 };
      for (const c of cand) {
        if (c.k === 'nea') continue;
        const d = Math.hypot(c.x - x, c.y - y) * s; if (d > APERTURE && !(c.viaCurve)) continue;
        const score = c.viaCurve && d > APERTURE ? 1000 + d : d + prio[c.k] * 0.5;
        if (score < bd) { bd = score; best = c; }
      }
      if (best && best.viaCurve && bd >= 1000) { const hasClose = cand.some(c => c.k !== 'nea' && c.k !== 'cen' && Math.hypot(c.x - x, c.y - y) * s <= APERTURE); if (hasClose) best = null; }
      if (!best && modes.nea) { const ns = cand.filter(c => c.k === 'nea').sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y)); best = ns[0] || null; }
      return best;
    };
    const SNAP_NAME = { end: 'Endpoint', mid: 'Midpoint', cen: 'Center', quad: 'Quadrant', int: 'Intersection', perp: 'Perpendicular', tan: 'Tangent', nea: 'Nearest', node: 'Node', ins: 'Insertion' };
    function drawSnapMarker(c) {
      const [sx, sy] = V.w2s(c.x, c.y), r = 6; o.save(); o.strokeStyle = '#ffcc33'; o.lineWidth = 2; o.setLineDash([]); o.beginPath();
      switch (c.k) {
        case 'end': o.rect(sx - r, sy - r, 2 * r, 2 * r); break;
        case 'mid': o.moveTo(sx, sy - r - 1); o.lineTo(sx + r + 1, sy + r); o.lineTo(sx - r - 1, sy + r); o.closePath(); break;
        case 'cen': o.arc(sx, sy, r, 0, 7); break;
        case 'quad': o.moveTo(sx, sy - r - 1); o.lineTo(sx + r + 1, sy); o.lineTo(sx, sy + r + 1); o.lineTo(sx - r - 1, sy); o.closePath(); break;
        case 'int': o.moveTo(sx - r, sy - r); o.lineTo(sx + r, sy + r); o.moveTo(sx + r, sy - r); o.lineTo(sx - r, sy + r); break;
        case 'perp': o.moveTo(sx - r, sy - r); o.lineTo(sx - r, sy + r); o.lineTo(sx + r, sy + r); o.moveTo(sx - r, sy); o.lineTo(sx, sy); o.lineTo(sx, sy + r); break;
        case 'tan': o.arc(sx, sy, r - 1, 0, 7); o.moveTo(sx - r - 2, sy - r + 1); o.lineTo(sx + r + 2, sy - r + 1); break;
        case 'nea': o.moveTo(sx - r, sy - r); o.lineTo(sx + r, sy - r); o.lineTo(sx - r, sy + r); o.lineTo(sx + r, sy + r); o.closePath(); break;
        case 'node': o.arc(sx, sy, r, 0, 7); o.moveTo(sx - r, sy - r); o.lineTo(sx + r, sy + r); o.moveTo(sx + r, sy - r); o.lineTo(sx - r, sy + r); break;
        case 'ins': o.rect(sx - r, sy - r, r, r); o.rect(sx, sy, r, r); break;
      }
      o.stroke(); tip(sx + 12, sy + 22, SNAP_NAME[c.k]); o.restore();
    }
    function tip(x, y, text, warm) {
      o.save(); o.font = '11.5px Segoe UI, Arial'; const w = o.measureText(text).width + 12;
      x = Math.min(x, W - w - 4); y = Math.min(y, H - 6);
      o.fillStyle = warm ? 'rgba(255,248,214,0.96)' : 'rgba(255,255,255,0.94)'; o.strokeStyle = 'rgba(60,80,110,0.6)'; o.lineWidth = 1;
      o.beginPath(); o.rect(x + 0.5, y - 15.5, w, 19); o.fill(); o.stroke(); o.fillStyle = '#1e2a3a'; o.fillText(text, x + 6, y - 2); o.restore();
    }

    /* ---------- overlay: crosshair, previews, rubber bands, snap marker ---------- */
    V.overlay = () => {
      o.setTransform(dpr, 0, 0, dpr, 0, 0); o.clearRect(0, 0, W, H);
      const st = A.cursor; if (!A.doc) return;
      if (A.space === 'model' && A.preview && A.preview.length) {
        const v = V.model, T = { m: v.s, tx: W / 2 - v.cx * v.s, ty: H / 2 + v.cy * v.s };
        o.save(); o.globalAlpha = 0.9;
        const pk = canvasSink(o, T, { lwt: A.lwt, lwPx: 3.2, dashPx: v.s, paper: !V.dark });
        M.emit(A.doc, A.preview.map(e => ({ id: -2, layer: A.doc.cur, ...e })), pk, {}); pk.flush();
        o.restore();
      }
      if (A.space === 'model' && A.hoverId != null) {   // pre-selection highlight
        const e = A.doc.ents.find(x => x.id === A.hoverId);
        if (e) { const v = V.model, T = { m: v.s, tx: W / 2 - v.cx * v.s, ty: H / 2 + v.cy * v.s }, hk = canvasSink(o, T, { hover: e.id, lwt: A.lwt, lwPx: 3.2, dashPx: v.s, paper: !V.dark, color: V.dark ? 'rgba(160,205,255,0.9)' : 'rgba(30,110,210,0.85)' }); o.save(); M.emit(A.doc, [e], hk, { hatchCache }); hk.flush(); o.restore(); }
      }
      if (A.rubber) {   // rubber-band line from base to cursor
        const [a, b] = A.rubber, [x1, y1] = V.w2s(a[0], a[1]), [x2, y2] = V.w2s(b[0], b[1]);
        o.save(); o.strokeStyle = V.dark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.6)'; o.setLineDash([4, 4]); o.lineWidth = 1; o.beginPath(); o.moveTo(x1, y1); o.lineTo(x2, y2); o.stroke(); o.restore();
      }
      if (A.track) {   // polar tracking ray
        const [a, ang] = A.track, [x1, y1] = V.w2s(a[0], a[1]), L = (W + H) * 2;
        o.save(); o.strokeStyle = 'rgba(80,200,120,0.85)'; o.setLineDash([2, 4]); o.lineWidth = 1; o.beginPath(); o.moveTo(x1, y1); o.lineTo(x1 + Math.cos(ang) * L, y1 - Math.sin(ang) * L); o.stroke(); o.restore();
      }
      if (A.winSel) {
        const r = A.winSel, crossing = r.x2 < r.x1;
        o.save(); o.fillStyle = crossing ? 'rgba(80,200,90,0.16)' : 'rgba(70,130,230,0.18)'; o.strokeStyle = crossing ? 'rgba(90,210,100,0.95)' : 'rgba(90,150,240,0.95)'; o.lineWidth = 1;
        if (crossing) o.setLineDash([5, 4]);
        const x = Math.min(r.x1, r.x2), y = Math.min(r.y1, r.y2); o.fillRect(x, y, Math.abs(r.x2 - r.x1), Math.abs(r.y2 - r.y1)); o.strokeRect(x + 0.5, y + 0.5, Math.abs(r.x2 - r.x1), Math.abs(r.y2 - r.y1)); o.restore();
      }
      if (!st || st.out) return;
      // crosshair + pickbox
      const [sx, sy] = A.space === 'model' && st.pt ? V.w2s(st.pt[0], st.pt[1]) : [st.sx, st.sy];
      o.save(); o.strokeStyle = A.space === 'layout' ? 'rgba(30,40,60,0.6)' : V.dark ? 'rgba(235,240,245,0.85)' : 'rgba(20,30,40,0.75)'; o.lineWidth = 1; o.beginPath();
      const big = A.crossFull ? Math.max(W, H) : 40;
      o.moveTo(Math.round(sx) + 0.5, sy - big); o.lineTo(Math.round(sx) + 0.5, sy + big); o.moveTo(sx - big, Math.round(sy) + 0.5); o.lineTo(sx + big, Math.round(sy) + 0.5); o.stroke();
      if (A.wantsPick || !A.busy) o.strokeRect(Math.round(sx) - PICKBOX + 0.5, Math.round(sy) - PICKBOX + 0.5, PICKBOX * 2, PICKBOX * 2);
      o.restore();
      if (A.snapHit) drawSnapMarker(A.snapHit);
      else if (A.trackTip) tip(sx + 14, sy + 24, A.trackTip, true);
      if (A.dynTip && !A.snapHit) tip(sx + 14, sy - 12, A.dynTip);
    };
    return V;
  };
})();
