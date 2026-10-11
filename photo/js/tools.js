'use strict';
/* Tools */
function pickColor(p, setBg) {
  let src, x, y;
  if (opts.sampleAll || tool !== 'eyedropper') { composite(); src = comp; x = p.x; y = p.y; }
  else { const s = sampleSource(); src = s.canvas; x = p.x - s.x; y = p.y - s.y; }
  x = Math.floor(x); y = Math.floor(y); if (x < 0 || y < 0 || x >= src.width || y >= src.height) return;
  const d = cx(src).getImageData(x, y, 1, 1).data; if (!d[3]) return;
  setColor(rgbToHex(d[0], d[1], d[2]), setBg);
}
const snap45 = (a, p) => { const ang = Math.round(Math.atan2(p.y - a.y, p.x - a.x) / (Math.PI / 4)) * Math.PI / 4, d = Math.hypot(p.x - a.x, p.y - a.y); return { x: a.x + Math.cos(ang) * d, y: a.y + Math.sin(ang) * d }; };
const paintTool = (mode, label) => ({
  down(p, e) {
    if (mode !== 'erase' && e.altKey) { pickColor(p); return this.skip = true; }
    this.skip = !beginStroke(mode, opts.opacity, label); if (this.skip) return;
    if (e.shiftKey && lastPaint) strokeTo(lastPaint);
    strokeTo(p, pressure(e));
  },
  move(p, e) { if (!this.skip && stroke) strokeTo(p, pressure(e)); },
  up(p) { if (!this.skip) { lastPaint = p; commitStroke(); } }
});
const sourceTool = (heal) => ({
  down(p, e) {
    if (e.altKey) { cloneSrc = { x: p.x, y: p.y }; cloneOffset = null; toast('Source set'); return this.skip = true; }
    if (!cloneSrc) { toast('Alt-click to set the source point first'); return this.skip = true; }
    if (!cloneOffset || !opts.aligned) cloneOffset = { x: cloneSrc.x - p.x, y: cloneSrc.y - p.y };
    if (heal) this.skip = !beginHeal(false);
    else { this.skip = !beginStroke('clone', opts.opacity, 'Clone Stamp'); if (!this.skip) stroke.src = clone(sourceDoc()); }
    if (!this.skip) strokeTo(p, pressure(e));
  },
  move(p, e) { if (!this.skip && stroke) strokeTo(p, pressure(e)); },
  up() { if (!this.skip) commitStroke(); }
});
const simpleStroke = (begin) => ({
  down(p, e) { this.skip = !begin(); if (!this.skip) strokeTo(p, pressure(e)); },
  move(p, e) { if (!this.skip && stroke) strokeTo(p, pressure(e)); },
  up() { if (!this.skip) commitStroke(); }
});

const Tools = {
  brush: paintTool('paint', 'Brush'),
  eraser: paintTool('erase', 'Eraser'),
  clone: sourceTool(false),
  heal: sourceTool(true),
  spotheal: simpleStroke(() => beginHeal(true)),
  smudge: simpleStroke(beginSmudge),
  dodge: simpleStroke(beginEffect),
  move: {
    down(p) {
      const L = layer(); this.a = p; this.moved = false; this.dx = this.dy = 0;
      if (selection && L.type !== 'adjust') {
        const t = editTarget(true); if (!t) return this.mode = null;
        this.mode = 'sel'; this.t = t; this.base = { x: L.x, y: L.y };
        this.rest = clone(t.canvas); const rc = cx(this.rest); rc.globalCompositeOperation = 'destination-out'; rc.drawImage(selection.mask, -L.x, -L.y); reset(rc);
        this.float = clone(maskedAt(t.canvas, L.x, L.y)); this.mask0 = clone(selection.mask);
        const self = this;
        live = { isMask: t.isMask, get() { const o = scratchSized('live', self.rest.width, self.rest.height), c = cx(o); c.drawImage(self.rest, 0, 0); c.drawImage(self.float, self.dx, self.dy); return o; } };
      } else { this.mode = 'layer'; this.ox = L.x; this.oy = L.y; this.ot = L.text ? { ax: L.text.ax, ay: L.text.ay } : null; }
    },
    move(p) { this.apply(Math.round(p.x - this.a.x), Math.round(p.y - this.a.y)); },
    apply(dx, dy) {
      const L = layer(); this.dx = dx; this.dy = dy; this.moved = true;
      if (this.mode === 'layer') { L.x = this.ox + dx; L.y = this.oy + dy; if (this.ot) { L.text.ax = this.ot.ax + dx; L.text.ay = this.ot.ay + dy; } requestRender(); }
      else if (this.mode === 'sel') { const m = cx(selection.mask); m.clearRect(0, 0, doc.w, doc.h); m.drawImage(this.mask0, dx, dy); setSel(selection.mask); requestRender(true); }
    },
    up() {
      if (this.mode === 'sel') {
        live = null;
        if (this.moved) {
          const L = this.t.L, r0 = { x: this.base.x, y: this.base.y, w: this.rest.width, h: this.rest.height };
          resizeLayerTo(L, unionRect(r0, { ...r0, x: r0.x + this.dx, y: r0.y + this.dy }));
          const tc = this.t.isMask ? L.mask.canvas : L.canvas, c = cx(tc); reset(c); c.clearRect(0, 0, tc.width, tc.height);
          c.drawImage(this.rest, this.base.x - L.x, this.base.y - L.y); c.drawImage(this.float, this.base.x + this.dx - L.x, this.base.y + this.dy - L.y);
        }
        this.rest = this.float = null;
      }
      if (this.moved) pushHistory('Move', this.mode === 'layer' ? 'none' : 'active'); else requestRender();
      this.mode = null;
    }
  },
  marquee: {
    down(p, e) { this.a = p; this.b = p; this.mode = selMode(e); },
    move(p, e) {
      this.b = p;
      if (e.shiftKey && this.mode === 'new') { const s = Math.max(Math.abs(p.x - this.a.x), Math.abs(p.y - this.a.y)); this.b = { x: this.a.x + Math.sign(p.x - this.a.x) * s, y: this.a.y + Math.sign(p.y - this.a.y) * s }; }
      const r = normRect(this.a, this.b), el = opts.marquee === 'ellipse';
      preview = (c, px) => { c.beginPath(); el ? c.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2) : c.rect(r.x, r.y, r.w, r.h); ants(c, px); };
    },
    up() {
      preview = null; const r = normRect(this.a, this.b);
      if (r.w < 2 && r.h < 2) { if (this.mode === 'new') deselect(); return; }
      applySelection(shapeMask(c => opts.marquee === 'ellipse' ? c.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2) : c.rect(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h))), this.mode);
    }
  },
  lasso: {
    down(p, e) { this.pts = [p]; this.mode = selMode(e); },
    move(p) { this.pts.push(p); const pts = this.pts; preview = (c, px) => { c.beginPath(); pts.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); ants(c, px); }; },
    up() {
      preview = null; const pts = this.pts;
      if (pts.length < 3) { if (this.mode === 'new') deselect(); return; }
      applySelection(shapeMask(c => { pts.forEach((q, i) => i ? c.lineTo(q.x, q.y) : c.moveTo(q.x, q.y)); c.closePath(); }), this.mode);
    }
  },
  wand: {
    down(p, e) { const s = sampleSource(), f = floodMask(p.x, p.y, s.canvas, s.x, s.y, opts.tolerance, opts.contiguous); if (f) applySelection(floodToCanvas(f), selMode(e)); }
  },
  fill: {
    down(p) {
      const t = editTarget(); if (!t) return;
      const s = sampleSource(), f = floodMask(p.x, p.y, s.canvas, s.x, s.y, opts.tolerance, opts.contiguous); if (!f) return;
      const fillC = floodToCanvas(f, hexToRgb(paintColor(fg))), c = tctx(t);
      c.globalAlpha = opts.opacity; c.drawImage(masked(fillC), 0, 0); reset(c); pushHistory('Paint Bucket');
    }
  },
  eyedropper: { down(p, e) { pickColor(p, e.altKey); }, move(p, e) { pickColor(p, e.altKey); } },
  gradient: {
    down(p) { this.a = snapPt(p); this.moved = false; this.ok = beginStroke('paint', opts.opacity, 'Gradient'); },
    move(p, e) {
      if (!this.ok) return;
      const a = this.a, b = e.shiftKey ? snap45(a, p) : snapPt(p), c = stroke.ctx; c.clearRect(0, 0, doc.w, doc.h);
      c.fillStyle = makeGradient(c, opts.grad, a, b, maskedStops(toolStops()), opts.gradReverse); c.fillRect(0, 0, doc.w, doc.h); this.moved = true;
      preview = (o, px) => { o.beginPath(); o.moveTo(a.x, a.y); o.lineTo(b.x, b.y); o.strokeStyle = '#000'; o.lineWidth = 3 * px; o.stroke(); o.strokeStyle = '#fff'; o.lineWidth = px; o.stroke(); };
      requestRender(true);
    },
    up() { preview = null; if (!this.ok) return; if (this.moved) commitStroke(); else cancelStroke(); }
  },
  shape: {
    down(p) { this.a = p; this.moved = false; this.ok = beginStroke('paint', opts.opacity, 'Shape'); },
    move(p, e) {
      if (!this.ok) return;
      const a = this.a, c = stroke.ctx; let b = p;
      if (e.shiftKey) {
        if (opts.shape === 'line') b = snap45(a, p);
        else { const s = Math.max(Math.abs(p.x - a.x), Math.abs(p.y - a.y)); b = { x: a.x + Math.sign(p.x - a.x) * s, y: a.y + Math.sign(p.y - a.y) * s }; }
      }
      const r = normRect(a, b);
      c.clearRect(0, 0, doc.w, doc.h); c.fillStyle = c.strokeStyle = stroke.color; c.lineWidth = opts.strokeW; c.lineJoin = 'round'; c.lineCap = 'round';
      c.beginPath();
      if (opts.shape === 'line') { c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke(); }
      else {
        if (opts.shape === 'ellipse') c.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
        else if (opts.shape === 'rounded') c.roundRect(r.x, r.y, r.w, r.h, Math.min(opts.radius, r.w / 2, r.h / 2));
        else c.rect(r.x, r.y, r.w, r.h);
        opts.shapeFill ? c.fill() : c.stroke();
      }
      this.moved = true; requestRender(true);
    },
    up() { if (!this.ok) return; if (this.moved) commitStroke(); else cancelStroke(); }
  },
  text: {
    down(p) {
      for (let i = doc.layers.length - 1; i >= 0; i--) {
        const L = doc.layers[i], r = L.type === 'text' && L.visible ? lrect(L) : null;
        if (r && p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h) { doc.active = i; doc.editMask = false; updatePanels(); return textDialog(L, false); }
      }
      const L = newLayer('Text', null, 0, 0, 'text');
      L.text = { ...TEXT_DEFAULT, ...(Tools.text.last || {}), text: 'Your text', color: fg, ax: Math.round(p.x), ay: Math.round(p.y), angle: 0 };
      if (!Tools.text.last) L.text.size = Math.max(12, Math.round(doc.h / 12));
      renderText(L); insertLayer(L); doc.editMask = false; textDialog(L, true);
    }
  },
  crop: {
    down(p) { this.a = { x: clamp(p.x, 0, doc.w), y: clamp(p.y, 0, doc.h) }; cropRect = null; },
    move(p) {
      cropRect = normRect(this.a, { x: clamp(p.x, 0, doc.w), y: clamp(p.y, 0, doc.h) });
      const r = cropRect;
      preview = (c, px) => {
        c.beginPath(); c.rect(0, 0, doc.w, doc.h); c.rect(r.x, r.y, r.w, r.h); c.fillStyle = '#000a'; c.fill('evenodd');
        c.beginPath(); for (let i = 1; i < 3; i++) { c.moveTo(r.x + r.w * i / 3, r.y); c.lineTo(r.x + r.w * i / 3, r.y + r.h); c.moveTo(r.x, r.y + r.h * i / 3); c.lineTo(r.x + r.w, r.y + r.h * i / 3); }
        c.strokeStyle = '#fff6'; c.lineWidth = px; c.stroke();
        c.beginPath(); c.rect(r.x, r.y, r.w, r.h); c.strokeStyle = '#fff'; c.lineWidth = 1.5 * px; c.stroke();
      };
    },
    up() { if (!cropRect || cropRect.w < 2 || cropRect.h < 2) cancelCrop(); else setStatusMsg('Press Enter to crop, Esc to cancel'); }
  },
  pen: {
    down(p, e) {
      let P = doc.path; const hit = P && hitAnchor(p);
      if (hit && (e.ctrlKey || e.metaKey)) { this.drag = { kind: 'anchor', pt: hit, last: p }; return; }
      if (hit && e.altKey) { hit.hin = { x: hit.x, y: hit.y }; hit.hout = { x: hit.x, y: hit.y }; this.drag = { kind: 'handle', pt: hit }; return; }
      if (P && !P.closed && !P.done && P.pts.length > 1 && hit === P.pts[0]) { P.closed = true; this.drag = null; requestOverlay(); return; }
      if (!P || P.closed || P.done) P = doc.path = { pts: [], closed: false, done: false };
      const pt = { x: p.x, y: p.y, hin: { x: p.x, y: p.y }, hout: { x: p.x, y: p.y } };
      P.pts.push(pt); this.drag = { kind: 'handle', pt };
    },
    move(p) {
      const d = this.drag; if (!d) return;
      if (d.kind === 'anchor') {
        const dx = p.x - d.last.x, dy = p.y - d.last.y; d.last = p;
        for (const q of [d.pt, d.pt.hin, d.pt.hout]) { q.x += dx; q.y += dy; }
      } else { d.pt.hout = { x: p.x, y: p.y }; d.pt.hin = { x: 2 * d.pt.x - p.x, y: 2 * d.pt.y - p.y }; }
    },
    up() { this.drag = null; }
  },
  hand: {},
  zoom: { down(p, e) { const r = overlay.getBoundingClientRect(); zoomAt(zoom * (e.altKey ? 1 / 1.5 : 1.5), e.clientX - r.left, e.clientY - r.top); } }
};

function applyCrop() {
  if (!cropRect) return;
  const r = roundRect(cropRect); preview = null; cropRect = null; setStatusMsg('');
  if (r.w < 1 || r.h < 1) return;
  doc.layers.forEach(L => {
    shiftLayer(L, -r.x, -r.y);
    if (opts.cropDelete && L.type === 'raster') {
      const b = lrect(L), nr = interRect(b, { x: 0, y: 0, w: r.w, h: r.h });
      if (nr) resizeLayerTo(L, nr); else { setCanvas(L, mk(1, 1)); L.x = L.y = 0; if (L.mask) L.mask.canvas = newMaskCanvas(L, '#fff'); }
    }
  });
  setDocSize(r.w, r.h); pushHistory('Crop', 'all'); fit();
}
function cancelCrop() { cropRect = null; preview = null; requestOverlay(); setStatusMsg(''); }

/* ---------- text dialog ---------- */
function textDialog(L, isNew) {
  const old = { ...L.text };
  const apply = v => { Object.assign(L.text, v); renderText(L); requestRender(); updatePanels(); };
  const t = L.text;
  showDialog({
    title: isNew ? 'New Text Layer' : 'Edit Text', fields: [
      { key: 'text', label: 'Text', type: 'textarea', value: t.text },
      { key: 'font', label: 'Font', type: 'select', value: t.font, options: FONTS.includes(t.font) ? FONTS : [t.font, ...FONTS] },
      { key: 'size', label: 'Size (px)', type: 'range', min: 6, max: 600, value: Math.round(t.size) },
      { key: 'color', label: 'Color', type: 'color', value: t.color },
      { key: 'bold', label: 'Bold', type: 'checkbox', value: t.bold },
      { key: 'italic', label: 'Italic', type: 'checkbox', value: t.italic },
      { key: 'align', label: 'Align', type: 'select', value: t.align, options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] },
      { key: 'lh', label: 'Line height', type: 'range', min: 0.8, max: 2.5, step: 0.05, value: t.lh },
      { key: 'tracking', label: 'Letter spacing', type: 'range', min: -20, max: 100, value: t.tracking },
      { key: 'outline', label: 'Outline (px)', type: 'range', min: 0, max: 40, value: t.outline },
      { key: 'outlineColor', label: 'Outline color', type: 'color', value: t.outlineColor },
      { key: 'shadow', label: 'Drop shadow', type: 'checkbox', value: t.shadow },
      { key: 'angle', label: 'Rotation °', type: 'range', min: -180, max: 180, value: Math.round(t.angle) }],
    onChange: apply,
    onOK: v => { apply(v); const { ax, ay, angle, text, ...style } = L.text; Tools.text.last = style; pushHistory(isNew ? 'Text' : 'Edit Text'); },
    onCancel: () => {
      if (isNew) { const i = doc.layers.indexOf(L); if (i >= 0) { doc.layers.splice(i, 1); doc.active = clamp(i - 1, 0, doc.layers.length - 1); } }
      else { L.text = old; renderText(L); }
      requestRender(); updatePanels();
    }
  });
}

/* ---------- pen paths ---------- */
function hitAnchor(p) { const P = doc.path; if (!P) return null; const r = 7 / zoom; return P.pts.find(q => Math.hypot(q.x - p.x, q.y - p.y) <= r) || null; }
function pathToPath2D(P) {
  const g = new Path2D(), pts = P.pts; if (!pts.length) return g;
  g.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; g.bezierCurveTo(a.hout.x, a.hout.y, b.hin.x, b.hin.y, b.x, b.y); }
  if (P.closed && pts.length > 1) { const a = pts[pts.length - 1], b = pts[0]; g.bezierCurveTo(a.hout.x, a.hout.y, b.hin.x, b.hin.y, b.x, b.y); g.closePath(); }
  return g;
}
function drawPath(c) {
  const P = doc.path, s = q => [panX + q.x * zoom, panY + q.y * zoom];
  c.save(); c.translate(panX, panY); c.scale(zoom, zoom);
  c.lineWidth = 1.5 / zoom; c.strokeStyle = '#2f8bff'; c.stroke(pathToPath2D(P)); c.restore();
  if (tool !== 'pen') return;
  P.pts.forEach((q, i) => {
    const [x, y] = s(q);
    if (q.hout.x !== q.x || q.hout.y !== q.y) {
      for (const h of [q.hin, q.hout]) { const [hx, hy] = s(h); c.beginPath(); c.moveTo(x, y); c.lineTo(hx, hy); c.strokeStyle = '#2f8bff'; c.lineWidth = 1; c.stroke(); c.beginPath(); c.arc(hx, hy, 3, 0, 7); c.fillStyle = '#2f8bff'; c.fill(); }
    }
    c.fillStyle = i === 0 && !P.closed ? '#2f8bff' : '#fff'; c.strokeStyle = '#2f8bff'; c.lineWidth = 1;
    c.fillRect(x - 3.5, y - 3.5, 7, 7); c.strokeRect(x - 3.5, y - 3.5, 7, 7);
  });
}
function needPath() { if (!doc.path || doc.path.pts.length < 2) { toast('Draw a path with the Pen tool first'); return false; } return true; }
function pathToSelection(mode = 'new') { if (!needPath()) return; const m = mk(doc.w, doc.h), c = cx(m); c.fillStyle = '#fff'; c.fill(pathToPath2D(doc.path)); applySelection(m, mode); }
function fillPath() {
  if (!needPath() || !beginStroke('paint', opts.opacity, 'Fill Path')) return;
  stroke.ctx.fillStyle = stroke.color; stroke.ctx.fill(pathToPath2D(doc.path)); commitStroke();
}
function strokePath() {
  if (!needPath() || !beginStroke('paint', opts.opacity, 'Stroke Path')) return;
  const c = stroke.ctx; c.strokeStyle = stroke.color; c.lineWidth = Math.max(1, opts.strokeW); c.lineCap = c.lineJoin = 'round'; c.stroke(pathToPath2D(doc.path)); commitStroke();
}
function clearPath() { doc.path = null; requestOverlay(); }
