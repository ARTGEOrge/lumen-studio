'use strict';
/* Lumen Darkroom — local tools in Develop: Masking (linear / radial / brush masks with local adjustments)
   and Spot Removal (heal / clone). Everything is stored in the photo's settings (non-destructive, undoable). */
const Local = (() => {
  let tool = null;                 // 'mask' | 'spot' | null
  let selMask = null, selSpot = null, overlay = false, tempOv = false, vis = false, pending = null, picking = false;
  const brush = { size: 50, feather: 60, flow: 100, auto: false, erase: false, refine: false };
  const spotDef = { mode: 'heal', size: 30, feather: 50, opacity: 100 };
  let drag = null, hoverPt = null, tempOvTimer = null;
  const sizeToR = s => .002 * Math.pow(125, s / 100);          // slider 1..100 → radius in long-edge units (0.2 % … 25 %)
  const rToSize = r => Math.max(1, Math.min(100, Math.log(r / .002) / Math.log(125) * 100));
  const q4 = v => Math.round(v * 1e4) / 1e4;
  const photo = () => activePhoto();
  const st = () => Dev.cur();
  const masks = () => st()?.masks || [];
  const selIndex = () => masks().findIndex(m => m.id === selMask);
  const selMaskObj = () => masks().find(m => m.id === selMask) || null;
  const spots = () => st()?.spots || [];
  const resync = () => Dev.syncPanels();   // sliders + mask list (selection changed)
  const isBrushing = () => { const m = selMaskObj(); return tool === 'mask' && !!m && (m.type === 'brush' || brush.refine) && !pending; };

  /* ---------- tool state ---------- */
  function setTool(t) {
    if (t === tool) t = null;
    if (t && !photo()) return Aero.toast('Select a photo first');
    if (t && S.module !== 'develop') setModule('develop');
    if (t) Dev.closeTools();
    tool = t; pending = null; picking = false; drag = null;
    if (tool === 'mask' && !selMaskObj() && masks().length) selMask = masks()[masks().length - 1].id;
    if (tool === 'mask') Dev.openPanel('masks');
    if (photo()) resync(); else syncUI(); Dev.requestRender();
  }
  function photoChanged() {
    drag = null; picking = false;
    if (!masks().some(m => m.id === selMask)) selMask = masks().length ? masks()[masks().length - 1].id : null;
    if (!spots().some(p => p.id === selSpot)) selSpot = null;
    syncUI();
  }
  const overlayId = () => tool === 'mask' && selMask && (overlay || tempOv || (drag && drag.kind !== 'pan')) ? selMask : null;
  const visSpots = () => tool === 'spot' && vis;
  function flashOverlay() { tempOv = true; clearTimeout(tempOvTimer); tempOvTimer = setTimeout(() => { tempOv = false; Dev.requestRender(); }, 900); }

  /* ---------- coordinates ---------- */
  function ctx() {
    const L = Dev.lastView; if (!L) return null; const ss = Engine.sourceSize(L.key); if (!ss) return null;
    return { L, g: Geo.build(ss.w, ss.h, L.st, Dev.cropMode), ss };
  }
  function scr(c, u, v) { const q = Geo.inv(c.g, u, v), L = c.L; return [L.left + (q[0] - L.view.x) / L.view.w * L.cssW, L.top + (q[1] - L.view.y) / L.view.h * L.cssH]; }
  function rawAt(c, mx, my) { const L = c.L; return Geo.fwd(c.g, L.view.x + (mx - L.left) / L.cssW * L.view.w, L.view.y + (my - L.top) / L.cssH * L.view.h); }
  const toSq = (c, p) => [p[0] * c.g.sq[0], p[1] * c.g.sq[1]];
  const fromSq = (c, x, y) => [x / c.g.sq[0], y / c.g.sq[1]];
  // screen-space radius of a circle of radius r (long-edge units) around raw point p
  function scrRadius(c, p, r) { const a = scr(c, p[0], p[1]), q = toSq(c, p), b = fromSq(c, q[0] + r, q[1]), s = scr(c, b[0], b[1]); return Math.hypot(s[0] - a[0], s[1] - a[1]); }
  function circlePts(c, p, r, n = 40) { const q = toSq(c, p), out = []; for (let i = 0; i <= n; i++) { const a = i / n * Math.PI * 2, b = fromSq(c, q[0] + Math.cos(a) * r, q[1] + Math.sin(a) * r); out.push(scr(c, b[0], b[1])); } return out; }
  function ellipsePts(c, m, k = 1, n = 64) {
    const r = m.rad, a = r.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), q = toSq(c, [r.cx, r.cy]), out = [];
    for (let i = 0; i <= n; i++) { const t = i / n * Math.PI * 2, x = Math.cos(t) * r.rx * k, y = Math.sin(t) * r.ry * k, b = fromSq(c, q[0] + x * ca - y * sa, q[1] + x * sa + y * ca); out.push(scr(c, b[0], b[1])); }
    return out;
  }
  function radialHandles(c, m) {
    const r = m.rad, a = r.angle * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), q = toSq(c, [r.cx, r.cy]);
    const at = (x, y) => { const b = fromSq(c, q[0] + x * ca - y * sa, q[1] + x * sa + y * ca); return scr(c, b[0], b[1]); };
    return { c: scr(c, r.cx, r.cy), e: at(r.rx, 0), w: at(-r.rx, 0), s: at(0, r.ry), n: at(0, -r.ry), rot: at(0, -r.ry * 1.3 - .02) };
  }
  function linearLines(c, m) {
    const l = m.lin, p0 = toSq(c, [l.x0, l.y0]), p1 = toSq(c, [l.x1, l.y1]), d = [p1[0] - p0[0], p1[1] - p0[1]], len = Math.hypot(d[0], d[1]) || 1e-6, n = [-d[1] / len, d[0] / len];
    const line = p => { const out = []; for (let i = -8; i <= 8; i++) { const t = i / 8 * 1.6, b = fromSq(c, p[0] + n[0] * t, p[1] + n[1] * t); out.push(scr(c, b[0], b[1])); } return out; };
    const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
    return { a: line(p0), b: line(p1), m: line(mid), h0: scr(c, l.x0, l.y0), h1: scr(c, l.x1, l.y1), hm: (() => { const b = fromSq(c, mid[0], mid[1]); return scr(c, b[0], b[1]); })() };
  }
  function pinOf(c, m) {
    if (m.type === 'linear') return linearLines(c, m).hm;
    if (m.type === 'radial') return scr(c, m.rad.cx, m.rad.cy);
    const s = m.strokes.find(x => !x.erase) || m.strokes[0]; if (!s) return null;
    let x = 0, y = 0; s.pts.forEach(p => { x += p[0]; y += p[1]; }); return scr(c, x / s.pts.length, y / s.pts.length);
  }

  /* ---------- overlay ---------- */
  function poly(x, pts, close) { x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); if (close) x.closePath(); }
  function dot(x, p, r, fill, stroke = 'rgba(0,25,50,.85)') { x.beginPath(); x.arc(p[0], p[1], r, 0, Math.PI * 2); x.fillStyle = fill; x.fill(); x.lineWidth = 1.5; x.strokeStyle = stroke; x.stroke(); }
  function drawOverlay(x) {
    if (!tool || Dev.cropMode) return;
    const c = ctx(); if (!c) return;
    x.save(); x.lineCap = 'round'; x.lineJoin = 'round';
    x.beginPath(); x.rect(c.L.left, c.L.top, c.L.cssW, c.L.cssH); x.clip();
    const shadow = () => { x.shadowColor = 'rgba(0,0,0,.7)'; x.shadowBlur = 3; };
    if (tool === 'mask') {
      const sel = selMaskObj();
      masks().forEach(m => { if (m === sel) return; const p = pinOf(c, m); if (p) dot(x, p, 5, m.on ? 'rgba(255,255,255,.85)' : 'rgba(160,160,160,.7)'); });
      if (sel && !picking) {
        shadow(); x.strokeStyle = '#fff'; x.lineWidth = 1.5;
        if (sel.type === 'linear') {
          const L = linearLines(c, sel); poly(x, L.a); x.stroke(); x.setLineDash([6, 4]); poly(x, L.b); x.stroke(); x.setLineDash([2, 4]); poly(x, L.m); x.stroke(); x.setLineDash([]);
          x.shadowBlur = 0; dot(x, L.h0, 5, '#fff'); dot(x, L.h1, 5, '#fff'); dot(x, L.hm, 6, '#3b8be0', '#fff');
        } else if (sel.type === 'radial') {
          poly(x, ellipsePts(c, sel), true); x.stroke();
          if (sel.rad.feather > 0) { x.setLineDash([4, 4]); poly(x, ellipsePts(c, sel, Math.max(.02, 1 - sel.rad.feather / 100)), true); x.stroke(); x.setLineDash([]); }
          const h = radialHandles(c, sel); x.shadowBlur = 0;
          x.strokeStyle = 'rgba(255,255,255,.7)'; x.beginPath(); x.moveTo(h.n[0], h.n[1]); x.lineTo(h.rot[0], h.rot[1]); x.stroke();
          ['e', 'w', 's', 'n'].forEach(k => dot(x, h[k], 4.5, '#fff')); dot(x, h.rot, 4, '#ffd23f'); dot(x, h.c, 6, '#3b8be0', '#fff');
        } else { const p = pinOf(c, sel); x.shadowBlur = 0; if (p) dot(x, p, 6, '#3b8be0', '#fff'); }
      }
      if (hoverPt && (isBrushing() || pending === 'brush') && !drag?.kind?.startsWith('h')) {
        const p = rawAt(c, hoverPt[0], hoverPt[1]);
        if (p) { const r = sizeToR(brush.size), erase = brush.erase || hoverPt.alt; x.shadowBlur = 0; x.lineWidth = 1.5; x.strokeStyle = erase ? '#ff6a5a' : '#fff'; poly(x, circlePts(c, p, r), true); x.stroke();
          if (brush.feather > 0) { x.setLineDash([3, 3]); x.strokeStyle = 'rgba(255,255,255,.6)'; poly(x, circlePts(c, p, r * (1 - brush.feather / 100)), true); x.stroke(); x.setLineDash([]); }
          x.fillStyle = x.strokeStyle; x.font = 'bold 12px Segoe UI'; x.textAlign = 'center'; x.fillText(erase ? '−' : '+', hoverPt[0], hoverPt[1] + 4); }
      }
    }
    if (tool === 'spot') {
      spots().forEach(p => {
        if (p.pts) { drawStrokeSpot(x, c, p, p.id === selSpot); return; }
        const s = p.id === selSpot, d = circlePts(c, [p.x, p.y], p.r), so = circlePts(c, [p.sx, p.sy], p.r), a = scr(c, p.x, p.y), b = scr(c, p.sx, p.sy);
        shadow(); x.lineWidth = s ? 2 : 1.3; x.strokeStyle = s ? '#fff' : 'rgba(255,255,255,.75)';
        poly(x, d, true); x.stroke();
        if (s) {
          x.setLineDash([5, 4]); poly(x, so, true); x.stroke(); x.setLineDash([]);
          // arrow source → destination
          const ang = Math.atan2(a[1] - b[1], a[0] - b[0]), rd = scrRadius(c, [p.x, p.y], p.r), rs = scrRadius(c, [p.sx, p.sy], p.r);
          const p0 = [b[0] + Math.cos(ang) * rs, b[1] + Math.sin(ang) * rs], p1 = [a[0] - Math.cos(ang) * rd, a[1] - Math.sin(ang) * rd];
          if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) > 8) { x.beginPath(); x.moveTo(p0[0], p0[1]); x.lineTo(p1[0], p1[1]); x.moveTo(p1[0] - Math.cos(ang - .45) * 8, p1[1] - Math.sin(ang - .45) * 8); x.lineTo(p1[0], p1[1]); x.lineTo(p1[0] - Math.cos(ang + .45) * 8, p1[1] - Math.sin(ang + .45) * 8); x.stroke(); }
        }
        x.shadowBlur = 0;
        if (s) { dot(x, a, 3.5, p.mode === 'heal' ? '#3b8be0' : '#e3a21a', '#fff'); dot(x, b, 3, 'rgba(255,255,255,.8)'); }
      });
      if (hoverPt && !drag) { const p = rawAt(c, hoverPt[0], hoverPt[1]); if (p && !hitSpot(c, hoverPt[0], hoverPt[1])) { x.lineWidth = 1; x.strokeStyle = 'rgba(255,255,255,.65)'; x.setLineDash([2, 3]); poly(x, circlePts(c, p, sizeToR(spotDef.size)), true); x.stroke(); x.setLineDash([]); } }
    }
    x.restore();
  }

  const strokeScr = (c, p, dx = 0, dy = 0) => p.pts.map(([u, v]) => scr(c, u + dx, v + dy));
  function drawStrokeSpot(x, c, p, sel) {
    const d = strokeScr(c, p), so = strokeScr(c, p, p.sx - p.x, p.sy - p.y), rw = scrRadius(c, p.pts[0], p.r) * 2;
    x.save(); x.lineCap = x.lineJoin = 'round';
    x.lineWidth = rw; x.strokeStyle = sel ? 'rgba(255,255,255,.28)' : 'rgba(255,255,255,.16)'; poly(x, d); x.stroke();
    x.lineWidth = sel ? 2 : 1.3; x.strokeStyle = sel ? '#fff' : 'rgba(255,255,255,.75)'; x.shadowColor = 'rgba(0,0,0,.7)'; x.shadowBlur = 3; poly(x, d); x.stroke();
    if (sel) {
      x.shadowBlur = 0; x.lineWidth = rw; x.strokeStyle = 'rgba(255,255,255,.12)'; poly(x, so); x.stroke();
      x.lineWidth = 1.5; x.strokeStyle = '#fff'; x.setLineDash([5, 4]); poly(x, so); x.stroke(); x.setLineDash([]);
      const a = d[0], b = so[0]; x.beginPath(); x.moveTo(b[0], b[1]); x.lineTo(a[0], a[1]); x.stroke();
      dot(x, a, 3.5, p.mode === 'heal' ? '#3b8be0' : '#e3a21a', '#fff'); dot(x, b, 3, 'rgba(255,255,255,.8)');
    }
    x.restore();
  }
  const segDist = (pts, mx, my) => { let m = Infinity; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[Math.min(pts.length - 1, i + 1)], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey, t = l2 ? Math.max(0, Math.min(1, ((mx - a[0]) * ex + (my - a[1]) * ey) / l2)) : 0; m = Math.min(m, Math.hypot(mx - a[0] - ex * t, my - a[1] - ey * t)); } return m; };

  /* ---------- hit testing ---------- */
  function hitSpot(c, mx, my) {
    const list = spots();
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (p.pts) { const ra = Math.max(6, scrRadius(c, p.pts[0], p.r)); if (p.id === selSpot && segDist(strokeScr(c, p, p.sx - p.x, p.sy - p.y), mx, my) < ra) return { p, part: 'src' }; if (segDist(strokeScr(c, p), mx, my) < ra) return { p, part: 'dst' }; continue; }
      const a = scr(c, p.x, p.y), ra = scrRadius(c, [p.x, p.y], p.r), da = Math.hypot(mx - a[0], my - a[1]);
      if (p.id === selSpot) { const b = scr(c, p.sx, p.sy), db = Math.hypot(mx - b[0], my - b[1]); if (Math.abs(da - ra) < 6) return { p, part: 'edge' }; if (db < ra) return { p, part: 'src' }; }
      if (da < Math.max(ra, 6)) return { p, part: 'dst' };
    }
    return null;
  }
  function hitMask(c, mx, my) {
    const sel = selMaskObj(), near = (p, r = 9) => p && Math.hypot(mx - p[0], my - p[1]) < r;
    if (sel?.type === 'linear') { const L = linearLines(c, sel); if (near(L.h0)) return 'h0'; if (near(L.h1)) return 'h1'; if (near(L.hm)) return 'hm'; }
    if (sel?.type === 'radial') { const h = radialHandles(c, sel); for (const k of ['rot', 'e', 'w', 'n', 's']) if (near(h[k])) return 'h' + k; if (near(h.c, 10)) return 'hc'; }
    for (const m of masks()) if (m !== sel && near(pinOf(c, m), 8)) return { pin: m.id };
    if (sel?.type === 'radial') { const r = sel.rad, q = rawAt(c, mx, my); if (q) { const a = toSq(c, q), b = toSq(c, [r.cx, r.cy]), an = -r.angle * Math.PI / 180, dx = a[0] - b[0], dy = a[1] - b[1], u = (dx * Math.cos(an) - dy * Math.sin(an)) / r.rx, v = (dx * Math.sin(an) + dy * Math.cos(an)) / r.ry; if (u * u + v * v < .85 && !isBrushing()) return 'hc'; } }
    return null;
  }

  /* ---------- pointer handling (called by the viewer) ---------- */
  function pointerDown(e, mx, my) {
    if (!tool || Dev.cropMode || e.button !== 0) return false;
    const c = ctx(); if (!c) return true;
    const p = rawAt(c, mx, my);
    if (picking) { pickColor(e); return true; }
    if (tool === 'spot') {
      const h = hitSpot(c, mx, my);
      if (h) { selSpot = h.p.id; drag = { kind: 'spot-' + h.part, id: h.p.id, mx, my, moved: false, raw0: p, p0: { ...h.p } }; syncUI(); Dev.drawOverlay(); return true; }
      if (!p) return true;
      const s = Dev.beginLive(), r = sizeToR(spotDef.size);
      const sp = Model.sanitizeSpot({ id: Aero.uid(), mode: spotDef.mode, x: p[0], y: p[1], sx: p[0], sy: p[1], r, feather: spotDef.feather, opacity: spotDef.opacity });
      if (s.spots.length >= Model.MAX_SPOTS) { Dev.cancelLive(); Aero.toast(`At most ${Model.MAX_SPOTS} spots per photo`); return true; }
      s.spots.push(sp); selSpot = sp.id; autoSource(sp, c);
      drag = { kind: 'spot-paint', id: sp.id, mx, my, moved: false, raw0: p, pts: [[sp.x, sp.y]] };
      Dev.requestRender(); syncUI(); return true;
    }
    // mask tool
    if (pending === 'linear' || pending === 'radial') {
      if (!p) return true;
      const s = Dev.beginLive(); if (s.masks.length >= Model.MAX_MASKS) { Dev.cancelLive(); Aero.toast(`At most ${Model.MAX_MASKS} masks per photo`); return true; }
      const m = Model.newMask(pending, s.masks.filter(x => x.type === pending).length + 1);
      if (pending === 'linear') m.lin = { x0: q4(p[0]), y0: q4(p[1]), x1: q4(p[0]), y1: q4(p[1]) };
      else m.rad = { cx: q4(p[0]), cy: q4(p[1]), rx: .002, ry: .002, angle: 0, feather: 50 };
      s.masks.push(m); selMask = m.id;
      drag = { kind: 'create-' + pending, id: m.id, mx, my, moved: false, raw0: p };
      pending = null; syncUI(); Dev.requestRender(); return true;
    }
    const h = pending === 'brush' ? null : hitMask(c, mx, my);
    if (h && h.pin) { selMask = h.pin; brush.refine = false; resync(); Dev.requestRender(); return true; }
    if (h) { const m = selMaskObj(); drag = { kind: h, id: m.id, mx, my, moved: false, raw0: p, m0: Model.clone(m) }; return true; }
    if (pending === 'brush' || isBrushing()) {
      if (!p) return true;
      const s = Dev.beginLive();
      let m = pending === 'brush' ? null : s.masks.find(x => x.id === selMask);
      if (!m) { if (s.masks.length >= Model.MAX_MASKS) { Dev.cancelLive(); Aero.toast(`At most ${Model.MAX_MASKS} masks per photo`); return true; } m = Model.newMask('brush', s.masks.filter(x => x.type === 'brush').length + 1); s.masks.push(m); selMask = m.id; pending = null; syncUI(); }
      if (m.strokes.length >= 400) { Aero.toast('This mask has too many strokes — start a new brush mask'); return true; }
      const stroke = { id: Aero.uid(), erase: brush.erase || e.altKey, size: sizeToR(brush.size), feather: brush.feather, flow: brush.flow, auto: brush.auto, pts: [[q4(p[0]), q4(p[1])]] };
      m.strokes.push(stroke);
      drag = { kind: 'paint', id: m.id, stroke, mx, my, moved: true };
      Dev.requestRender(); return true;
    }
    return false;   // let the viewer pan / zoom
  }
  function pointerMove(e, mx, my) {
    if (!tool || Dev.cropMode) return false;
    hoverPt = [mx, my]; hoverPt.alt = e.altKey;
    if (!drag) { setCursor(mx, my); Dev.drawOverlay(); return true; }
    const c = ctx(); if (!c) return true;
    const p = rawAt(c, mx, my); if (!p) return true;
    if (Math.hypot(mx - drag.mx, my - drag.my) > 3) drag.moved = true;
    if (!drag.moved) return true;
    const s = Dev.beginLive();
    if (drag.kind.startsWith('spot')) {
      const sp = s.spots.find(x => x.id === drag.id); if (!sp) return true;
      const dq = [p[0] - drag.raw0[0], p[1] - drag.raw0[1]];
      if (drag.kind === 'spot-paint') {
        const last = drag.pts[drag.pts.length - 1], a = toSq(c, last), b = toSq(c, p);
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) > sp.r * .3 && drag.pts.length < 300) { drag.pts.push([q4(p[0]), q4(p[1])]); sp.pts = drag.pts.map(t => t.slice()); sp.sx = sp.x; sp.sy = sp.y; }
      }
      else if (drag.kind === 'spot-dst') {
        const nx = q4(Math.max(0, Math.min(1, drag.p0.x + dq[0]))), ny = q4(Math.max(0, Math.min(1, drag.p0.y + dq[1])));
        if (drag.p0.pts) sp.pts = drag.p0.pts.map(([u, v]) => [q4(u + nx - drag.p0.x), q4(v + ny - drag.p0.y)]);
        sp.x = nx; sp.y = ny;
      }
      else if (drag.kind === 'spot-src') { sp.sx = q4(drag.p0.sx + dq[0]); sp.sy = q4(drag.p0.sy + dq[1]); }
      else if (!sp.pts) { const a = toSq(c, [sp.x, sp.y]), b = toSq(c, p); sp.r = Math.max(.002, Math.min(.25, Math.hypot(b[0] - a[0], b[1] - a[1]))); spotDef.size = rToSize(sp.r); }
      Dev.requestRender(); syncPill(); return true;
    }
    const m = s.masks.find(x => x.id === drag.id); if (!m) return true;
    if (drag.kind === 'paint') {
      const st = drag.stroke && m.strokes.find(x => x.id === drag.stroke.id); if (!st) return true;
      const last = st.pts[st.pts.length - 1], a = toSq(c, last), b = toSq(c, p);
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) > st.size * .12 && st.pts.length < 3000) { st.pts.push([q4(p[0]), q4(p[1])]); Dev.requestRender(); }
      return true;
    }
    const k = drag.kind, m0 = drag.m0;
    if (k === 'create-linear') { m.lin.x1 = q4(p[0]); m.lin.y1 = q4(p[1]); }
    else if (k === 'create-radial') {
      const cen = [m.rad.cx, m.rad.cy], c0 = toSq(c, cen);
      const ax = rawAt(c, mx, drag.my), ay = rawAt(c, drag.mx, my);
      if (ax && ay) { const a = toSq(c, ax), b = toSq(c, ay); m.rad.rx = Math.max(.003, Math.hypot(a[0] - c0[0], a[1] - c0[1])); m.rad.ry = Math.max(.003, Math.hypot(b[0] - c0[0], b[1] - c0[1])); m.rad.angle = Math.round(Math.atan2(a[1] - c0[1], a[0] - c0[0]) * 180 / Math.PI * 10) / 10; if (e.shiftKey) m.rad.ry = m.rad.rx; }
    } else if (k === 'h0' || k === 'h1' || k === 'hm') {
      const dq = [p[0] - drag.raw0[0], p[1] - drag.raw0[1]], l = m0.lin;
      if (k !== 'h1') { m.lin.x0 = q4(l.x0 + dq[0]); m.lin.y0 = q4(l.y0 + dq[1]); }
      if (k !== 'h0') { m.lin.x1 = q4(l.x1 + dq[0]); m.lin.y1 = q4(l.y1 + dq[1]); }
    } else if (k === 'hc') { const dq = [p[0] - drag.raw0[0], p[1] - drag.raw0[1]]; m.rad.cx = q4(m0.rad.cx + dq[0]); m.rad.cy = q4(m0.rad.cy + dq[1]); }
    else if (k[0] === 'h') {
      const r = m0.rad, an = r.angle * Math.PI / 180, cq = toSq(c, [r.cx, r.cy]), q = toSq(c, p), dx = q[0] - cq[0], dy = q[1] - cq[1];
      if (k === 'hrot') m.rad.angle = Math.round((Math.atan2(dy, dx) * 180 / Math.PI + 90) * 10) / 10;
      else if (k === 'he' || k === 'hw') { m.rad.rx = Math.max(.003, Math.abs(dx * Math.cos(an) + dy * Math.sin(an))); if (e.shiftKey) m.rad.ry = m.rad.rx * r.ry / r.rx; }
      else { m.rad.ry = Math.max(.003, Math.abs(-dx * Math.sin(an) + dy * Math.cos(an))); if (e.shiftKey) m.rad.rx = m.rad.ry * r.rx / r.ry; }
    }
    Dev.requestRender(); return true;
  }
  function pointerUp() {
    if (!drag) return false;
    const d = drag; drag = null;
    const labels = { 'create-linear': 'New linear gradient', 'create-radial': 'New radial gradient', paint: 'Brush stroke', 'spot-paint': 'Spot removal', 'spot-dst': 'Move spot', 'spot-src': 'Move spot source', 'spot-edge': 'Resize spot' };
    const s = Dev.liveSettings();
    if (d.kind === 'create-linear' && s) { const m = s.masks.find(x => x.id === d.id); if (m && !d.moved) { m.lin = { x0: m.lin.x0, y0: Math.max(0, m.lin.y0 - .15), x1: m.lin.x0, y1: Math.min(1, m.lin.y0 + .15) }; } }
    if (d.kind === 'create-radial' && s) { const m = s.masks.find(x => x.id === d.id); if (m && !d.moved) { m.rad.rx = .18; m.rad.ry = .12; } }
    if (d.kind === 'spot-paint' && s) {
      const sp = s.spots.find(x => x.id === d.id), c = ctx();
      if (sp && c) { if (!sp.pts || sp.pts.length < 2) { delete sp.pts; autoSource(sp, c); } else autoStrokeSource(sp, c); }
      if (sp?.pts) labels['spot-paint'] = 'Spot removal (stroke)';
    }
    if (!d.moved && !d.kind.startsWith('create') && d.kind !== 'spot-paint' && d.kind !== 'paint') { Dev.cancelLive(); syncUI(); Dev.requestRender(); return true; }
    Dev.commit(labels[d.kind] || (d.kind === 'hrot' ? 'Rotate radial gradient' : 'Edit mask'));
    syncUI(); return true;
  }
  function setCursor(mx, my) {
    const vw = $('#viewer'); if (!tool) return;
    const c = ctx(); if (!c) return;
    let cur = 'crosshair';
    if (picking) cur = 'crosshair';
    else if (tool === 'spot') { const h = hitSpot(c, mx, my); if (h) cur = h.part === 'edge' ? 'ew-resize' : 'move'; }
    else { const h = pending ? null : hitMask(c, mx, my); if (h) cur = h.pin ? 'pointer' : h === 'hrot' ? 'alias' : 'move'; else if (isBrushing() || pending === 'brush') cur = 'none'; }
    vw.className = ''; vw.style.cursor = cur;
  }
  function autoStrokeSource(sp, c) {
    const p = photo(); if (!p) return;
    const [dx, dy] = Masks.findStrokeSource(p.fileId, sp.pts, sp.r, c.ss.w, c.ss.h);
    sp.x = sp.pts[0][0]; sp.y = sp.pts[0][1]; sp.sx = q4(sp.x + dx); sp.sy = q4(sp.y + dy);
  }
  function autoSource(sp, c) {
    const p = photo(); if (!p) return;
    const [sx, sy] = Masks.findSource(p.fileId, sp.x, sp.y, sp.r, c.ss.w, c.ss.h);
    sp.sx = q4(sx); sp.sy = q4(sy);
  }

  /* ---------- colour range picker ---------- */
  function startPick() { if (!selMaskObj()) return; picking = true; $('#localhint').textContent = 'Click the colour to select · Esc to cancel'; $('#localhint').hidden = false; }
  function pickColor(e) {
    picking = false; $('#localhint').hidden = true;
    const L = Dev.lastView; if (!L) return;
    Engine.render(L.key, L.st, { outW: L.outW, outH: L.outH, view: L.view, slot: 'v' });
    const r = Engine.canvas.getBoundingClientRect(), rgb = Engine.sampleLinear((e.clientX - r.left) / r.width * L.outW, (e.clientY - r.top) / r.height * L.outH, 2);
    if (!rgb) return Dev.requestRender();
    const [Lk, a, b] = Masks.oklab(...rgb);
    Dev.setSettings(s => { const m = s.masks.find(x => x.id === selMask); if (m) { m.range.mode = 'color'; m.range.L = Lk; m.range.a = a; m.range.b = b; } }, 'Mask colour range');
    flashOverlay();
  }

  /* ---------- mask commands ---------- */
  function addMask(type) {
    if (tool !== 'mask') setTool('mask');
    if (!photo()) return;
    pending = type; brush.refine = false;
    $('#localhint').textContent = type === 'brush' ? 'Paint on the photo to create a brush mask (Alt paints erase)' : type === 'linear' ? 'Drag on the photo: 100 % effect where you start, 0 % where you release' : 'Drag from the centre outward to place the radial gradient (Shift: circle)';
    $('#localhint').hidden = false; setTimeout(() => { if (!pending) $('#localhint').hidden = true; }, 50);
    syncUI();
  }
  function maskOp(fn, label) { if (!selMaskObj()) return; Dev.setSettings(s => { const i = s.masks.findIndex(m => m.id === selMask); if (i >= 0) fn(s, i); }, label); syncUI(); }
  function deleteMask() { const m = selMaskObj(); if (!m) return false; maskOp((s, i) => s.masks.splice(i, 1), 'Delete mask'); selMask = masks().length ? masks()[masks().length - 1].id : null; resync(); return true; }
  function duplicateMask() { maskOp((s, i) => { const c = Model.clone(s.masks[i]); c.id = Aero.uid(); c.name = s.masks[i].name + ' copy'; s.masks.splice(i + 1, 0, c); selMask = c.id; }, 'Duplicate mask'); resync(); }
  async function renameMask() { const m = selMaskObj(); if (!m) return; const n = await Aero.prompt('Rename Mask', 'Name', m.name); if (n && n.trim()) maskOp((s, i) => { s.masks[i].name = n.trim().slice(0, 60); }, 'Rename mask'); }
  function deleteSpot() { if (!selSpot || !spots().some(p => p.id === selSpot)) return false; const id = selSpot; Dev.setSettings(s => { s.spots = s.spots.filter(p => p.id !== id); }, 'Delete spot'); selSpot = null; syncUI(); return true; }
  function deleteSelected() { if (tool === 'mask') return deleteMask(); if (tool === 'spot') return deleteSpot(); return false; }
  function clearSpots() { if (!spots().length) return; Dev.setSettings(s => { s.spots = []; }, 'Clear spots'); selSpot = null; syncUI(); }
  function setSpotParam(k, v, commit) {
    spotDef[k] = v;
    const sp = spots().find(p => p.id === selSpot);
    if (sp) { const s = Dev.beginLive(), t = s.spots.find(p => p.id === selSpot); if (k === 'size') t.r = sizeToR(v); else t[k] = v; if (commit) Dev.commit('Spot ' + k); Dev.requestRender(); }
  }
  function brushSize(d) {
    if (tool === 'spot') { spotDef.size = Math.max(1, Math.min(100, spotDef.size + d)); setSpotParam('size', spotDef.size, true); }
    else if (tool === 'mask') brush.size = Math.max(1, Math.min(100, brush.size + d));
    syncPill(); Dev.drawOverlay();
  }

  /* ---------- UI ---------- */
  let ui = null;
  function buildPanel(b, h) {
    // h: {slider, sub}
    const add = el('div', 'btnrow mk-add', '<button class="aero-btn" data-add="linear" title="New linear gradient mask">▤ Linear</button><button class="aero-btn" data-add="radial" title="New radial gradient mask">◎ Radial</button><button class="aero-btn" data-add="brush" title="New brush mask">✎ Brush</button><label class="ovl" title="Show the selected mask as a red overlay (O)"><input type="checkbox" id="mk-ov"> Overlay</label>');
    add.onclick = e => { const t = e.target.closest('[data-add]'); if (t) addMask(t.dataset.add); };
    b.appendChild(add);
    const list = el('div', 'aero-list mk-list'); b.appendChild(list);
    list.onclick = e => {
      const it = e.target.closest('[data-m]'); if (!it) return;
      if (e.target.matches('input[type=checkbox]')) { const id = it.dataset.m, on = e.target.checked; Dev.setSettings(s => { const m = s.masks.find(x => x.id === id); if (m) m.on = on; }, on ? 'Show mask' : 'Hide mask'); return; }
      selMask = it.dataset.m; brush.refine = false; pending = null; if (tool !== 'mask') setTool('mask'); resync(); Dev.requestRender();
    };
    list.ondblclick = e => { if (e.target.closest('[data-m]') && !e.target.matches('input')) renameMask(); };
    const acts = el('div', 'btnrow mk-acts', '<button class="aero-btn" data-a="inv" title="Invert the gradient">Invert</button><button class="aero-btn" data-a="dup">Duplicate</button><button class="aero-btn" data-a="ren">Rename…</button><button class="aero-btn" data-a="del" title="Delete mask (Delete)">Delete</button>');
    acts.onclick = e => { const a = e.target.closest('[data-a]')?.dataset.a; if (a === 'inv') maskOp((s, i) => { s.masks[i].invert = !s.masks[i].invert; }, 'Invert mask'); if (a === 'dup') duplicateMask(); if (a === 'ren') renameMask(); if (a === 'del') deleteMask(); };
    b.appendChild(acts);
    const empty = el('div', 'dim mk-empty', 'Masks apply local adjustments to part of the photo. Add a linear gradient, a radial gradient or paint with the brush — then refine it by luminance or colour.'); b.appendChild(empty);
    const box = el('div', 'mk-sel'); b.appendChild(box);
    h.slider(box, 'Amount', '@mask.amount', 0, 100, 1, v => Math.round(v) + '%', null, 'Mask amount');
    const fe = h.slider(box, 'Feather', '@mask.rad.feather', 0, 100, 1, v => String(Math.round(v)), null, 'Radial feather'); fe.classList.add('mk-radial');
    const br = el('div', 'btnrow mk-brushrow', '<span class="dim" style="align-self:center;width:72px">Brush</span><button class="aero-btn" data-b="add" title="Paint to add to the mask">+ Add</button><button class="aero-btn" data-b="erase" title="Paint to erase from the mask (or hold Alt)">− Erase</button><button class="aero-btn" data-b="clear" title="Remove all brush strokes of this mask">Clear</button>');
    br.onclick = e => {
      const a = e.target.closest('[data-b]')?.dataset.b; if (!a) return; const m = selMaskObj(); if (!m) return;
      if (a === 'clear') { maskOp((s, i) => { s.masks[i].strokes = []; }, 'Clear brush strokes'); return; }
      const want = a === 'erase'; if (m.type !== 'brush' && brush.refine && brush.erase === want) brush.refine = false; else { brush.refine = m.type !== 'brush'; brush.erase = want; }
      pending = null; syncUI();
    };
    box.appendChild(br);
    h.sub(box, 'Range');
    const rr = el('div', 'srow', '<span>Refine</span><select id="mk-range"><option value="none">None</option><option value="lum">Luminance range</option><option value="color">Colour range</option></select><span></span>'); rr.style.gridTemplateColumns = '78px 1fr 10px'; box.appendChild(rr);
    rr.querySelector('select').onchange = e => { const v = e.target.value; maskOp((s, i) => { s.masks[i].range.mode = v; }, 'Mask range: ' + v); if (v === 'color') startPick(); flashOverlay(); };
    const lum = el('div', 'mk-lum'); box.appendChild(lum);
    [['From', '@mask.range.lo', 'Range from'], ['To', '@mask.range.hi', 'Range to'], ['Smoothness', '@mask.range.smooth', 'Range smoothness']].forEach(([n, pth, hn]) => { const r = h.slider(lum, n, pth, 0, 100, 1, v => String(Math.round(v)), null, hn); r.querySelector('input').addEventListener('input', flashOverlay); });
    lum.querySelector('.srow').style.setProperty('--trk', 'linear-gradient(90deg,#000,#fff)'); lum.querySelector('.srow').classList.add('grad');
    const col = el('div', 'mk-col'); box.appendChild(col);
    const cr = el('div', 'btnrow', '<span class="dim" style="align-self:center;width:72px">Colour</span><span class="mk-sw" id="mk-sw"></span><button class="aero-btn" id="mk-pick" title="Click a colour in the photo">✚ Pick colour</button>'); col.appendChild(cr);
    cr.querySelector('#mk-pick').onclick = startPick;
    const tr = h.slider(col, 'Amount', '@mask.range.tol', 0, 100, 1, v => String(Math.round(v)), null, 'Colour range amount'); tr.querySelector('input').addEventListener('input', flashOverlay);
    h.sub(box, 'Adjustments');
    Model.LOCAL.forEach(([k, n, lo, hi]) => h.slider(box, n, '@mask.adj.' + k, lo, hi, k === 'exposure' ? .01 : 1, k === 'exposure' ? v => (v > 0 ? '+' : '') + v.toFixed(2) : v => (v > 0 && lo < 0 ? '+' : '') + Math.round(v),
      { temp: 'linear-gradient(90deg,#3a76e0,#d9dde0 50%,#e8c23a)', tint: 'linear-gradient(90deg,#3cb84a,#d9dde0 50%,#c84ad0)', exposure: 'linear-gradient(90deg,#222,#ddd)' }[k] || null, 'Mask ' + n.toLowerCase()));
    const rs = el('div', 'btnrow', '<button class="aero-btn" id="mk-rstadj">Reset adjustments</button>'); box.appendChild(rs);
    rs.querySelector('button').onclick = () => maskOp((s, i) => { Model.LOCAL.forEach(([k]) => s.masks[i].adj[k] = 0); }, 'Reset mask adjustments');
    add.querySelector('#mk-ov').onchange = e => { overlay = e.target.checked; Dev.requestRender(); };
    ui = { list, acts, empty, box, br, lum, col };
  }
  function syncUI() {
    if (!ui) return;
    const ms = masks(), sel = selMaskObj();
    ui.list.innerHTML = ms.map(m => `<div class="aero-item${m.id === selMask ? ' sel' : ''}" data-m="${esc(m.id)}"><input type="checkbox" ${m.on ? 'checked' : ''} title="Show / hide this mask's effect"><span class="mkic ${m.type}"></span><span class="grow">${esc(m.name)}</span><span class="cnt">${m.invert ? 'inv' : ''}${m.range.mode !== 'none' ? ' ' + (m.range.mode === 'lum' ? 'L' : 'C') : ''}</span></div>`).join('');
    ui.list.hidden = !ms.length; ui.acts.hidden = !sel; ui.box.hidden = !sel; ui.empty.hidden = !!ms.length;
    if (sel) {
      ui.box.querySelectorAll('.mk-radial').forEach(x => x.hidden = sel.type !== 'radial');
      ui.acts.querySelector('[data-a=inv]').hidden = sel.type === 'brush';
      ui.acts.querySelector('[data-a=inv]').classList.toggle('on', sel.invert);
      const brushing = sel.type === 'brush' || brush.refine;
      ui.br.querySelector('[data-b=add]').classList.toggle('on', brushing && !brush.erase);
      ui.br.querySelector('[data-b=erase]').classList.toggle('on', brushing && brush.erase);
      ui.br.querySelector('[data-b=clear]').disabled = !sel.strokes.length;
      $('#mk-range').value = sel.range.mode; ui.lum.hidden = sel.range.mode !== 'lum'; ui.col.hidden = sel.range.mode !== 'color';
      $('#mk-sw').style.background = Masks.oklabToCss(sel.range.L, sel.range.a, sel.range.b);
    }
    $('#mk-ov').checked = overlay;
    $('#d-mask').classList.toggle('on', tool === 'mask'); $('#d-spot').classList.toggle('on', tool === 'spot');
    if (!pending && !picking) $('#localhint').hidden = true;
    syncPill();
  }
  function syncPill() {
    const bp = $('#brushpill'), sp = $('#spotpill');
    bp.hidden = !(tool === 'mask' && (isBrushing() || pending === 'brush')); sp.hidden = tool !== 'spot';
    if (!bp.hidden) { $('#bp-size').value = brush.size; $('#bp-feather').value = brush.feather; $('#bp-flow').value = brush.flow; $('#bp-auto').checked = brush.auto; $('#bp-add').classList.toggle('on', !brush.erase); $('#bp-erase').classList.toggle('on', brush.erase); }
    if (!sp.hidden) {
      const s = spots().find(p => p.id === selSpot); if (s) { spotDef.mode = s.mode; spotDef.size = rToSize(s.r); spotDef.feather = s.feather; spotDef.opacity = s.opacity; }
      $('#sp-heal').classList.toggle('on', spotDef.mode === 'heal'); $('#sp-clone').classList.toggle('on', spotDef.mode === 'clone');
      if (document.activeElement !== $('#sp-size')) $('#sp-size').value = spotDef.size; if (document.activeElement !== $('#sp-feather')) $('#sp-feather').value = spotDef.feather; if (document.activeElement !== $('#sp-opacity')) $('#sp-opacity').value = spotDef.opacity;
      $('#sp-vis').checked = vis; $('#sp-count').textContent = `${spots().length} spot${spots().length === 1 ? '' : 's'}`;
    }
  }
  function wirePills() {
    $('#bp-add').onclick = () => { brush.erase = false; syncUI(); }; $('#bp-erase').onclick = () => { brush.erase = true; syncUI(); };
    $('#bp-size').oninput = e => { brush.size = +e.target.value; Dev.drawOverlay(); };
    $('#bp-feather').oninput = e => { brush.feather = +e.target.value; };
    $('#bp-flow').oninput = e => { brush.flow = +e.target.value; };
    $('#bp-auto').onchange = e => { brush.auto = e.target.checked; const p = photo(); if (p && brush.auto) Masks.ensureRef(p); };
    $('#bp-done').onclick = () => { brush.refine = false; if (selMaskObj()?.type === 'brush') setTool(null); else syncUI(); };
    const setMode = m => { spotDef.mode = m; const s = spots().find(p => p.id === selSpot); if (s) Dev.setSettings(st => { const t = st.spots.find(p => p.id === selSpot); if (t) t.mode = m; }, m === 'heal' ? 'Spot: heal' : 'Spot: clone'); syncPill(); };
    $('#sp-heal').onclick = () => setMode('heal'); $('#sp-clone').onclick = () => setMode('clone');
    ['size', 'feather', 'opacity'].forEach(k => { const i = $('#sp-' + k); i.oninput = () => setSpotParam(k, +i.value, false); i.onchange = () => setSpotParam(k, +i.value, true); });
    $('#sp-vis').onchange = e => { vis = e.target.checked; Dev.requestRender(); };
    $('#sp-clear').onclick = clearSpots; $('#sp-done').onclick = () => setTool(null);
  }
  function init() {
    wirePills();
    $('#d-mask').onclick = () => setTool('mask'); $('#d-spot').onclick = () => setTool('spot');
    Aero.shortcut('[', () => brushSize(-4)); Aero.shortcut(']', () => brushSize(4));
    document.addEventListener('keydown', e => {
      if (document.querySelector('.aero-modal') || !tool) return;
      if (e.key === 'Escape') { if (picking) { picking = false; $('#localhint').hidden = true; } else if (pending) { pending = null; syncUI(); } else if (drag) { drag = null; Dev.cancelLive(); Dev.requestRender(); } else setTool(null); e.stopImmediatePropagation(); }
      if (e.key === 'Alt') e.preventDefault();
    }, true);
    addEventListener('keyup', e => { if (e.key === 'Alt' && hoverPt) { hoverPt.alt = false; Dev.drawOverlay(); } });
  }
  function toggleOverlay() { if (tool !== 'mask') setTool('mask'); overlay = !overlay; syncUI(); Dev.requestRender(); }
  function toggleVis() { if (tool !== 'spot') setTool('spot'); vis = !vis; syncUI(); Dev.requestRender(); }
  function leaveViewer() { hoverPt = null; Dev.drawOverlay(); }

  return {
    init, buildPanel, syncUI, setTool, photoChanged, overlayId, visSpots, drawOverlay, pointerDown, pointerMove, pointerUp, leaveViewer,
    addMask, deleteSelected, deleteMask, duplicateMask, clearSpots, toggleOverlay, toggleVis, selIndex, brushSize,
    get tool() { return tool; }, get overlay() { return overlay; }, get vis() { return vis; }, get selMask() { return selMask; }, set selMask(v) { selMask = v; resync(); },
    get selSpot() { return selSpot; }, set selSpot(v) { selSpot = v; syncUI(); }, brush, spotDef, sizeToR, get busy() { return !!drag; }
  };
})();
