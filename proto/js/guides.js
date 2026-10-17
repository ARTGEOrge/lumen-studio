'use strict';
/* Lumen Proto — rulers and draggable guides.
   Guides live on artboards (doc.children frames: n.guides = [{axis:'x'|'y', v}] in artboard coordinates, so they
   move with the artboard) or on the canvas (doc.guides, world coordinates). Drag from a ruler to create one, drag a
   guide to move it, drop it back on the ruler to delete it. Moving / resizing layers snaps to guides. */
(function (root) {
  const LP = root.LP = root.LP || {};
  // untrusted file data → [{axis, v}]
  LP.cleanGuides = arr => (Array.isArray(arr) ? arr : []).filter(g => g && typeof g === 'object' && (g.axis === 'x' || g.axis === 'y') && isFinite(Number(g.v)) && g.v !== null && g.v !== '')
    .slice(0, 1000).map(g => ({ axis: g.axis, v: Math.max(-1e6, Math.min(1e6, Number(g.v))) }));
  // nice ruler step (world units) so labelled ticks are ≥ minPx apart at zoom z
  LP.rulerStep = (z, minPx = 56) => { const raw = minPx / z; const p = Math.pow(10, Math.floor(Math.log10(raw))); for (const m of [1, 2, 5, 10]) if (m * p >= raw) return m * p; return 10 * p; };
  if (!root.document) return;

  const ED = root.ED;
  const RS = 20, CYAN = '#00a8d6';
  const store = (k, v) => { try { localStorage.setItem('lproto.' + k, v ? '1' : '0'); } catch (e) { } };
  const load = (k, d) => { try { const v = localStorage.getItem('lproto.' + k); return v == null ? d : v === '1'; } catch (e) { return d; } };
  ED.showRulers = load('rulers', false); ED.showGuides = load('guides', true); ED.lockGuides = false;
  const G = ED.GUIDES = { RS };

  // every guide as a world line: {owner, g, axis, v (world), span:[a,b] | null}
  G.all = () => {
    const out = [];
    (ED.doc.guides || []).forEach(g => out.push({ owner: ED.doc, g, axis: g.axis, v: g.v, span: null }));
    ED.doc.children.forEach(n => {
      if (n.type !== 'frame' || n.visible === false || !Array.isArray(n.guides)) return;
      n.guides.forEach(g => out.push({ owner: n, g, axis: g.axis, v: (g.axis === 'x' ? n.x : n.y) + g.v, span: g.axis === 'x' ? [n.y, n.y + n.h] : [n.x, n.x + n.w] }));
    });
    return out;
  };
  ED.guideSnapLines = () => { const o = { x: [], y: [] }; if (!ED.showGuides) return o; G.all().forEach(l => o[l.axis].push(l.v)); return o; };
  // top-most visible artboard under a world point
  G.artboardAt = (x, y) => ED.doc.children.slice().reverse().find(n => n.type === 'frame' && n.visible !== false && !n.r && x >= n.x && x <= n.x + n.w && y >= n.y && y <= n.y + n.h) || null;
  // guide under a screen point
  G.at = (sx, sy) => {
    if (!ED.showGuides || ED.lockGuides || ED.mode !== 'design') return null;
    const w = ED.s2w(sx, sy), tol = 4 / ED.view.z;
    let best = null;
    G.all().forEach(l => {
      const d = Math.abs((l.axis === 'x' ? w.x : w.y) - l.v), along = l.axis === 'x' ? w.y : w.x;
      if (d > tol || (l.span && (along < l.span[0] - tol || along > l.span[1] + tol))) return;
      if (!best || d < best.d || (best.l.owner === ED.doc && l.owner !== ED.doc)) best = { l, d };
    });
    return best && best.l;
  };
  ED.guideAt = G.at;

  /* ---------------- drawing ---------------- */
  ED.drawGuideLines = (ctx, r) => {
    if (!ED.showGuides) return;
    const d = ED.drag && ED.drag.guide;
    ctx.save(); ctx.lineWidth = 1;
    const line = (axis, v, span, col) => {
      ctx.strokeStyle = col;
      ctx.beginPath();
      if (axis === 'x') { const x = Math.round(ED.w2s(v, 0).x) + .5, a = span ? ED.w2s(0, span[0]).y : 0, b = span ? ED.w2s(0, span[1]).y : r.height; ctx.moveTo(x, a); ctx.lineTo(x, b); }
      else { const y = Math.round(ED.w2s(0, v).y) + .5, a = span ? ED.w2s(span[0], 0).x : 0, b = span ? ED.w2s(span[1], 0).x : r.width; ctx.moveTo(a, y); ctx.lineTo(b, y); }
      ctx.stroke();
    };
    G.all().forEach(l => line(l.axis, l.v, l.span, l.owner === ED.doc ? 'rgba(0,168,214,.65)' : CYAN));
    if (d && d.v != null) {
      line(d.axis, d.v, d.ab ? (d.axis === 'x' ? [d.ab.y, d.ab.y + d.ab.h] : [d.ab.x, d.ab.x + d.ab.w]) : null, d.del ? 'rgba(242,72,34,.8)' : CYAN);
      // value label
      const rel = d.v - (d.ab ? (d.axis === 'x' ? d.ab.x : d.ab.y) : 0);
      const p = d.axis === 'x' ? { x: ED.w2s(d.v, 0).x, y: d.sy } : { x: d.sx, y: ED.w2s(0, d.v).y };
      const txt = d.del ? 'Delete' : ED.fmt(rel);
      ctx.font = '600 10.5px "Segoe UI",sans-serif'; const tw = ctx.measureText(txt).width + 8;
      const lx = d.axis === 'x' ? p.x + 6 : p.x + 10, ly = d.axis === 'x' ? p.y + 10 : p.y - 20;
      ctx.fillStyle = d.del ? '#f24822' : CYAN; ctx.beginPath(); ctx.roundRect(Math.round(lx), Math.round(ly), tw, 16, 3); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(txt, Math.round(lx) + 4, Math.round(ly) + 8.5);
    }
    ctx.restore();
  };
  // ruler origin: the artboard holding the selection (XD-style), else the canvas origin
  G.origin = () => {
    const n = ED.selNodes()[0]; const top = n && ED.scene.top(n);
    return top && top.type === 'frame' && !top.r ? { x: top.x, y: top.y, ab: top } : { x: 0, y: 0, ab: null };
  };
  ED.drawRulers = (ctx, r) => {
    if (!ED.showRulers) return;
    const z = ED.view.z, o = G.origin(), step = LP.rulerStep(z), minor = step / (String(step)[0] === '5' ? 5 : String(step)[0] === '2' ? 4 : 10);
    ctx.save();
    ctx.fillStyle = 'rgba(246,248,251,.97)'; ctx.fillRect(0, 0, r.width, RS); ctx.fillRect(0, 0, RS, r.height);
    // selection extent band
    const sel = ED.selNodes(); if (sel.length) { const b = ED.unionBox(sel), a = ED.w2s(b.x, b.y), c = ED.w2s(b.x + b.w, b.y + b.h); ctx.fillStyle = 'rgba(31,139,255,.16)'; ctx.fillRect(Math.max(RS, a.x), 0, c.x - Math.max(RS, a.x), RS); ctx.fillRect(0, Math.max(RS, a.y), RS, c.y - Math.max(RS, a.y)); }
    ctx.strokeStyle = '#a9b4c2'; ctx.fillStyle = '#5b6b7c'; ctx.lineWidth = 1; ctx.font = '9.5px "Segoe UI",sans-serif'; ctx.textBaseline = 'top';
    ctx.beginPath();
    // horizontal ruler
    const w0 = ED.s2w(RS, 0).x - o.x, w1 = ED.s2w(r.width, 0).x - o.x;
    for (let v = Math.floor(w0 / minor) * minor; v <= w1; v += minor) {
      const x = Math.round(ED.w2s(v + o.x, 0).x) + .5; if (x < RS) continue;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      ctx.moveTo(x, major ? 2 : RS - 5); ctx.lineTo(x, RS);
      if (major) ctx.fillText(String(Math.round(v * 100) / 100), x + 3, 2);
    }
    // vertical ruler (rotated labels)
    const h0 = ED.s2w(0, RS).y - o.y, h1 = ED.s2w(0, r.height).y - o.y;
    for (let v = Math.floor(h0 / minor) * minor; v <= h1; v += minor) {
      const y = Math.round(ED.w2s(0, v + o.y).y) + .5; if (y < RS) continue;
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6;
      ctx.moveTo(major ? 2 : RS - 5, y); ctx.lineTo(RS, y);
      if (major) { ctx.save(); ctx.translate(2, y - 3); ctx.rotate(-Math.PI / 2); ctx.fillText(String(Math.round(v * 100) / 100), 0, 0); ctx.restore(); }
    }
    ctx.stroke();
    // guide markers on the rulers
    if (ED.showGuides) { ctx.fillStyle = CYAN; G.all().forEach(l => { if (l.axis === 'x') { const x = ED.w2s(l.v, 0).x; if (x > RS) ctx.fillRect(Math.round(x) - 1, RS - 6, 3, 6); } else { const y = ED.w2s(0, l.v).y; if (y > RS) ctx.fillRect(RS - 6, Math.round(y) - 1, 6, 3); } }); }
    // edges + corner
    ctx.strokeStyle = '#c3ccd8'; ctx.beginPath(); ctx.moveTo(RS, RS - .5); ctx.lineTo(r.width, RS - .5); ctx.moveTo(RS - .5, RS); ctx.lineTo(RS - .5, r.height); ctx.stroke();
    ctx.fillStyle = '#eef1f5'; ctx.fillRect(0, 0, RS, RS); ctx.strokeRect(-.5, -.5, RS, RS);
    ctx.restore();
  };

  /* ---------------- interaction ---------------- */
  // snap a world guide value to integers (artboard space) and to nearby layer edges
  function snapValue(axis, v, ab) {
    const th = 6 / ED.view.z, base = ab ? (axis === 'x' ? ab.x : ab.y) : 0;
    let best = null;
    const cand = [];
    if (ab) { const b = ED.wbox(ab); cand.push(axis === 'x' ? b.x : b.y, axis === 'x' ? b.x + b.w / 2 : b.y + b.h / 2, axis === 'x' ? b.x + b.w : b.y + b.h); }
    (ab ? ED.kids(ab) : ED.doc.children).forEach(k => { if (!ED.scene.isVis(k)) return; const b = ED.wbox(k); cand.push(axis === 'x' ? b.x : b.y, axis === 'x' ? b.x + b.w / 2 : b.y + b.h / 2, axis === 'x' ? b.x + b.w : b.y + b.h); });
    cand.forEach(c => { const d = Math.abs(c - v); if (d <= th && (!best || d < best.d)) best = { c, d }; });
    return best ? best.c : base + Math.round(v - base);
  }
  function startDrag(axis, existing, sx, sy) {
    const d = { kind: 'ext', guide: { axis, v: null, ab: null, sx, sy, del: false, existing } };
    d.move = (sx2, sy2, w) => {
      const gd = d.guide; gd.sx = sx2; gd.sy = sy2;
      gd.del = axis === 'x' ? sx2 < RS : sy2 < RS;
      gd.ab = G.artboardAt(w.x, w.y);
      gd.v = snapValue(axis, axis === 'x' ? w.x : w.y, gd.ab);
      gd.moved = true;
      ED.redraw();
    };
    d.up = () => {
      const gd = d.guide;
      if (!gd.moved) { if (existing) { existing.owner === ED.doc ? (ED.doc.guides = ED.doc.guides || []).push(existing.g) : existing.owner.guides.push(existing.g); } ED.redraw(); return; }
      if (gd.del || gd.v == null) { if (existing) ED.commit('Delete guide'); else ED.redraw(); return; }
      const g = { axis, v: gd.v };
      if (gd.ab) { g.v = ED.fmt(gd.v - (axis === 'x' ? gd.ab.x : gd.ab.y)) * 1; (gd.ab.guides = gd.ab.guides || []).push(g); }
      else (ED.doc.guides = ED.doc.guides || []).push(g);
      if (!ED.showGuides) { ED.showGuides = true; store('guides', true); }
      ED.commit(existing ? 'Move guide' : 'Add guide');
    };
    ED.drag = d;
    ED.updateCursor(axis === 'x' ? 'col-resize' : 'row-resize');
  }
  // pointer down anywhere on the canvas: rulers first (called by the editor before hit-testing)
  ED.rulerDown = (e, sx, sy) => {
    if (!ED.showRulers || (sx >= RS && sy >= RS)) return false;
    if (sx < RS && sy < RS) return true;
    if (ED.mode !== 'design') return true;
    startDrag(sy < RS ? 'y' : 'x', null, sx, sy);
    return true;
  };
  // pointer down on an existing guide (select tool, after selection handles)
  ED.guideGrab = (e, sx, sy) => {
    const l = G.at(sx, sy); if (!l) return false;
    const arr = l.owner === ED.doc ? ED.doc.guides : l.owner.guides; const i = arr.indexOf(l.g); if (i < 0) return false;
    arr.splice(i, 1);
    startDrag(l.axis, l, sx, sy);
    return true;
  };

  /* ---------------- commands ---------------- */
  G.toggleRulers = () => { ED.showRulers = !ED.showRulers; store('rulers', ED.showRulers); ED.redraw(); };
  G.toggleGuides = () => { ED.showGuides = !ED.showGuides; store('guides', ED.showGuides); ED.redraw(); };
  G.toggleLock = () => { ED.lockGuides = !ED.lockGuides; Aero.toast(ED.lockGuides ? 'Guides locked' : 'Guides unlocked'); };
  G.count = () => G.all().length;
  // remove guides from the selected artboards, or every guide when nothing on an artboard is selected
  G.clear = () => {
    const tops = [...new Set(ED.selNodes().map(n => ED.scene.top(n)).filter(n => n && n.type === 'frame' && n.guides?.length))];
    let k = 0;
    if (tops.length) tops.forEach(n => { k += n.guides.length; delete n.guides; });
    else { k = (ED.doc.guides || []).length; delete ED.doc.guides; ED.doc.children.forEach(n => { if (n.guides) { k += n.guides.length; delete n.guides; } }); }
    if (!k) return Aero.toast('No guides to remove');
    ED.commit('Remove guides'); Aero.toast(`Removed ${k} guide${k > 1 ? 's' : ''}`);
  };
  // add a guide numerically to the artboard holding the selection (or the canvas)
  G.addDialog = () => {
    const o = G.origin();
    Aero.dialog({
      title: 'Add guide', instruction: o.ab ? `Position is measured from the top-left of "${o.ab.name}".` : 'Position is in canvas coordinates (select a layer on an artboard to add an artboard guide).',
      fields: [{ key: 'axis', label: 'Orientation', type: 'select', options: [['x', 'Vertical (x)'], ['y', 'Horizontal (y)']], value: 'x' }, { key: 'v', label: 'Position', type: 'number', value: 0, step: 1 }],
      onOK: v => { if (!isFinite(v.v)) return; const g = { axis: v.axis, v: Number(v.v) }; if (o.ab) (o.ab.guides = o.ab.guides || []).push(g); else (ED.doc.guides = ED.doc.guides || []).push(g); ED.showGuides = true; ED.commit('Add guide'); }
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
