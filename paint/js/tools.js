'use strict';
/* Tools. Each tool: {down(pt,e) → false to refuse, move, up, cancel, hover, overlay(ctx,px), cursor(ctx,sp), options(bar)} */
let activeToolId = 'brush', activeTool = null, toolbox = null;
const toolBrush = { brush: 'wc-round', eraser: 'eraser-soft', smudge: 'blender' };
const topts = {
  liquify: { mode: 'push', size: 120, strength: 0.6 },
  fill: { tol: 12, gap: 2, sample: 'all', spread: 1 },
  gradient: { type: 'linear', colors: 'fg-bg', opacity: 1 },
  shape: { kind: 'line', style: 'stroke' },
  lasso: { mode: 'replace', feather: 0 }, marquee: { mode: 'replace', shape: 'rect', feather: 0 },
  pick: { sample: 'all' }
};
const guides = { sym: 'off', n: 6, cx: 0, cy: 0, persp: 'off', hy: 0, vp: [[0, 0], [0, 0]], snapPersp: false, ruler: { on: false, a: [0, 0], b: [0, 0] }, show: true };
function resetGuides() {
  guides.cx = doc.w / 2; guides.cy = doc.h / 2; guides.hy = doc.h * 0.45;
  guides.vp = [[doc.w * 0.5, guides.hy], [doc.w * 1.15, guides.hy]];
  guides.ruler.a = [doc.w * 0.25, doc.h * 0.7]; guides.ruler.b = [doc.w * 0.75, doc.h * 0.6];
}
function symmetryMats() {
  const { sym, n, cx, cy } = guides; if (sym === 'off') return [mat.id()];
  const about = m => mat.mul(mat.tr(cx, cy), mat.mul(m, mat.tr(-cx, -cy)));
  const mx = about(mat.sc(-1, 1)), my = about(mat.sc(1, -1));
  if (sym === 'v') return [mat.id(), mx];
  if (sym === 'h') return [mat.id(), my];
  if (sym === 'quad') return [mat.id(), mx, my, about(mat.sc(-1, -1))];
  const out = [], N = clamp(n | 0, 2, 32);
  for (let k = 0; k < N; k++) { const r = about(mat.rot(k * Math.PI * 2 / N)); out.push(r); if (sym === 'kaleido') out.push(mat.mul(r, mx)); }
  return out;
}

/* ---------- brush-like tools ---------- */
function brushFor(tool) { return brushById(toolBrush[tool]) || BRUSHES[0]; }
function currentBrush() { return brushFor(['eraser', 'smudge'].includes(activeToolId) ? activeToolId : 'brush'); }
/* the tile layer that painting tools write into: the active layer, or its mask while the mask is targeted */
function paintTarget() { const A = doc.active; return A && A.mask && doc.editMask ? A.mask : A; }
// colours painted into a mask become gray (black hides, white reveals)
function paintColor(L, c) { if (!L || !L.isMask) return c; const l = luma(c); return [l, l, l]; }
function requirePixelLayer() {
  const A = doc.active;
  if (A && A.mask && doc.editMask) { if (!isEffectivelyVisible(A)) { Aero.toast('The current layer is hidden'); return null; } return A.mask; }
  const L = A;
  if (L && L.text) { askRasterizeText(L); return null; }
  if (!L || L.type !== 'pixel') { Aero.toast(L && L.type === 'group' ? 'Select a pixel layer inside the group to paint' : 'This is a fill layer — select or add a pixel layer to paint'); return null; }
  if (!isEffectivelyVisible(L)) { Aero.toast('The current layer is hidden'); return null; }
  return L;
}
function strokeConstraint(start) {
  const r = guides.ruler, zoomPx = 28 / view.zoom;
  if (r.on) {
    const ax = r.a[0], ay = r.a[1], dx = r.b[0] - ax, dy = r.b[1] - ay, L2 = dx * dx + dy * dy || 1;
    const t = ((start.x - ax) * dx + (start.y - ay) * dy) / L2, px = ax + dx * t, py = ay + dy * t;
    if (Math.hypot(start.x - px, start.y - py) < zoomPx * 1.5) {
      return q => { const t = ((q.x - ax) * dx + (q.y - ay) * dy) / L2; return [{ ...q, x: ax + dx * t, y: ay + dy * t }]; };
    }
  }
  if (guides.persp !== 'off' && guides.snapPersp) {
    let line = null; const held = [];
    return q => {
      if (line) return [proj(line, q)];
      held.push(q); const s = held[0], d = Math.hypot(q.x - s.x, q.y - s.y);
      if (d < 14 / view.zoom) return [];
      const ang = Math.atan2(q.y - s.y, q.x - s.x), cands = [];
      const vps = guides.persp === '1' ? [guides.vp[0]] : guides.vp;
      for (const v of vps) cands.push([s.x, s.y, v[0] - s.x, v[1] - s.y]);
      cands.push([s.x, s.y, 1, 0]); cands.push([s.x, s.y, 0, 1]);
      let best = null, bd = 9;
      for (const c of cands) { const a = Math.atan2(c[3], c[2]); let df = Math.abs(((ang - a) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2); if (df < bd) { bd = df; best = c; } }
      line = best; return held.map(h => proj(line, h));
    };
    function proj(l, q) { const L2 = l[2] * l[2] + l[3] * l[3] || 1, t = ((q.x - l[0]) * l[2] + (q.y - l[1]) * l[3]) / L2; return { ...q, x: l[0] + l[2] * t, y: l[1] + l[3] * t }; }
  }
  return null;
}
function brushTool(kind) {
  return {
    down(pt) {
      const L = requirePixelLayer(); if (!L) return false;
      if (floating) commitTransform();
      const b = brushFor(kind), fb = fullBrush(b);
      let mode = kind === 'eraser' ? 'erase' : kind === 'smudge' ? 'smudge' : fb.mode === 'erase' ? 'erase' : fb.mode;
      if (L.isMask && (mode === 'water' || mode === 'oil')) mode = 'paint'; // masks take plain gray paint
      this.S = new Stroke({ layer: L, brush: fb, color: paintColor(L, FG), mode, mats: symmetryMats(), zoom: view.zoom, constrain: strokeConstraint(pt), mouse: pt.mouse });
      this.label = (L.isMask ? 'Mask: ' : '') + (mode === 'erase' && kind === 'eraser' && fb.mode !== 'erase' ? 'Erase: ' : '') + b.name;
      this.S.add(pt);
    },
    move(pt) { this.S?.add(pt); },
    up(pt) {
      const S = this.S; if (!S) return; this.S = null;
      S.add(pt); const bb = S.end();
      if (S.mode === 'water' && S.wet) { pendingDryUI = true; }
      if (bb || S.mode === 'water') commitPaint(this.label, S.L, S);
      if (S.mode !== 'erase' && S.mode !== 'smudge') pushRecent(FG);
    },
    cancel() { const S = this.S; this.S = null; if (S) cancelStroke(S); },
    cursor(c, sp) { brushCursor(c, sp, brushFor(kind).size, brushFor(kind)); },
    options: bar => brushOptions(bar, kind)
  };
}
function cancelStroke(S) {
  activeStroke = null;
  if (S.wet) { dryWet(S.L); }
  for (const [idx, t] of S.orig) { S.L.tiles[idx] = t; S.L.owned.delete(idx); S.L.dirty.add(idx); }
  markDirty(S.L);
}
function commitPaint(label, L, S) {
  histPush(label);
  if (S && S.wet && !S.wet.firstState && wetSims.get(L) === S.wet) S.wet.firstState = hist.items[hist.index].state;
  layerThumbDirty(L);
  if (!(S && S.wet && wetSims.has(L))) tlCapture();
}
function onWetDried(sim) {
  if (previewing) return;
  const L = sim.L;
  if (sim.firstState) {
    const from = hist.items.findIndex(it => it.state === sim.firstState);
    if (from >= 0) patchHistoryTiles(from, L, [...sim.touched].filter(i => L.tiles[i]));
  }
  freezeAll(); layerThumbDirty(L); tlCapture(); pendingDryUI = true;
}
function brushCursor(c, sp, size, b) {
  const r = Math.max(1.5, size * view.zoom / 2);
  c.lineWidth = 1;
  if (b && b.tip && b.tip !== 'round' && r > 4 && !toolPointer) { // hover preview of the actual stamp shape
    const fb = fullBrush(b), tc = tipCursorCanvas(b.tip, rgbHex(paintColor(paintTarget(), FG)));
    if (tc) { c.save(); c.translate(sp[0], sp[1]); c.rotate((fb.angle || 0) * Math.PI / 180 + (view.flip ? -1 : 1) * view.angle); c.scale(1, fb.roundness || 1); c.globalAlpha = 0.4; c.drawImage(tc, -r, -r, r * 2, r * 2); c.restore(); }
  }
  c.strokeStyle = 'rgba(255,255,255,.9)'; c.beginPath(); c.arc(sp[0], sp[1], r + 1, 0, 7); c.stroke();
  c.strokeStyle = 'rgba(0,0,0,.75)'; c.beginPath(); c.arc(sp[0], sp[1], r, 0, 7); c.stroke();
  if (r < 6) { c.beginPath(); c.moveTo(sp[0] - 8, sp[1]); c.lineTo(sp[0] - 3, sp[1]); c.moveTo(sp[0] + 3, sp[1]); c.lineTo(sp[0] + 8, sp[1]); c.moveTo(sp[0], sp[1] - 8); c.lineTo(sp[0], sp[1] - 3); c.moveTo(sp[0], sp[1] + 3); c.lineTo(sp[0], sp[1] + 8); c.stroke(); }
  if (keys.alt && isPaintTool()) { c.fillStyle = rgbHex(FG); c.beginPath(); c.arc(sp[0] + 14, sp[1] - 14, 7, 0, 7); c.fill(); c.stroke(); }
}

/* ---------- liquify ---------- */
const liquifyTool = {
  down(pt) {
    const L = requirePixelLayer(); if (!L) return false;
    const o = topts.liquify;
    this.S = new Stroke({ layer: L, brush: fullBrush({ size: o.size, strength: o.strength, spacing: 0.08, smoothing: 0.15, pSize: 0, mode: 'liquify' }), color: FG, mode: 'liquify', subMode: o.mode, mats: symmetryMats(), zoom: view.zoom, mouse: pt.mouse });
    this.S.add(pt);
    if (o.mode !== 'push') { this.timer = setInterval(() => { if (this.S && this.S.last) { this.S.dab(this.S.last); } }, 30); }
  },
  move(pt) { this.S?.add(pt); },
  up(pt) { clearInterval(this.timer); const S = this.S; if (!S) return; this.S = null; S.add(pt); const bb = S.end(); if (bb) commitPaint('Liquify', S.L); },
  cancel() { clearInterval(this.timer); const S = this.S; this.S = null; if (S) cancelStroke(S); },
  cursor(c, sp) { brushCursor(c, sp, topts.liquify.size); },
  options(bar) {
    const o = topts.liquify;
    cmdSelect(bar, 'Mode', [['push', 'Push'], ['twirl', 'Twirl right'], ['twirl-ccw', 'Twirl left'], ['pinch', 'Pinch'], ['bloat', 'Bloat'], ['reconstruct', 'Reconstruct']], () => o.mode, v => o.mode = v);
    cmdSlider(bar, 'Size', 5, 800, 1, () => o.size, v => o.size = v, v => v + ' px');
    cmdSlider(bar, 'Strength', 0.05, 1, 0.01, () => o.strength, v => o.strength = v, v => Math.round(v * 100) + '%');
    cmdHint(bar, 'Hold still to keep twirling / pinching');
  }
};

/* ---------- paint bucket ---------- */
function distTransform(src, w, h, isZero) { // chamfer distance to nearest pixel where isZero(src[i]) — approx euclidean
  const INF = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = isZero(src[i]) ? 0 : INF;
  const A = 1, B = 1.4142;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; let v = d[i]; if (!v) continue;
    if (x > 0) v = Math.min(v, d[i - 1] + A); if (y > 0) { v = Math.min(v, d[i - w] + A); if (x > 0) v = Math.min(v, d[i - w - 1] + B); if (x < w - 1) v = Math.min(v, d[i - w + 1] + B); }
    d[i] = v;
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; let v = d[i]; if (!v) continue;
    if (x < w - 1) v = Math.min(v, d[i + 1] + A); if (y < h - 1) { v = Math.min(v, d[i + w] + A); if (x < w - 1) v = Math.min(v, d[i + w + 1] + B); if (x > 0) v = Math.min(v, d[i + w - 1] + B); }
    d[i] = v;
  }
  return d;
}
function floodRegion(ok, w, h, sx, sy) {
  const reg = new Uint8Array(w * h); if (!ok[sy * w + sx]) return reg;
  const st = [sx, sy];
  while (st.length) {
    const y = st.pop(), x0 = st.pop(); let x = x0;
    while (x > 0 && ok[y * w + x - 1] && !reg[y * w + x - 1]) x--;
    let up = false, dn = false;
    for (; x < w && ok[y * w + x] && !reg[y * w + x]; x++) {
      reg[y * w + x] = 1;
      if (y > 0) { const k = ok[(y - 1) * w + x] && !reg[(y - 1) * w + x]; if (k && !up) { st.push(x, y - 1); up = true; } else if (!k) up = false; }
      if (y < h - 1) { const k = ok[(y + 1) * w + x] && !reg[(y + 1) * w + x]; if (k && !dn) { st.push(x, y + 1); dn = true; } else if (!k) dn = false; }
    }
  }
  return reg;
}
function floodFill(px, py, color = FG) {
  const L = requirePixelLayer(); if (!L) return false;
  const x0 = px | 0, y0 = py | 0, w = doc.w, h = doc.h; if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return false;
  dryWet(L);
  const o = topts.fill;
  if (o.sample === 'all' && doc.ver !== composedVer) { R.compose(); composedVer = doc.ver; }
  const src = o.sample === 'all' ? R.readComposite() : layerRGBA(L);
  const si = (y0 * w + x0) * 4, sr = src[si], sg = src[si + 1], sb = src[si + 2], sa = src[si + 3], tol = o.tol / 100 * 255;
  const match = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < match.length; i++, j += 4) {
    const a = src[j + 3]; let d;
    if (sa < 8 && a < 8) d = 0; else d = Math.max(Math.abs(a - sa), Math.abs(src[j] - sr) * Math.min(a, sa) / 255, Math.abs(src[j + 1] - sg) * Math.min(a, sa) / 255, Math.abs(src[j + 2] - sb) * Math.min(a, sa) / 255);
    match[i] = d <= tol ? 1 : 0;
  }
  let reg;
  const gap = o.gap | 0;
  if (gap > 0) {
    const dist = distTransform(match, w, h, v => !v);
    const closed = new Uint8Array(w * h); for (let i = 0; i < closed.length; i++) closed[i] = match[i] && dist[i] > gap ? 1 : 0;
    if (closed[y0 * w + x0]) {
      const core = floodRegion(closed, w, h, x0, y0);
      const d2 = distTransform(core, w, h, v => v);
      reg = new Uint8Array(w * h); for (let i = 0; i < reg.length; i++) reg[i] = match[i] && d2[i] <= gap + 1 ? 1 : 0;
    }
  }
  if (!reg) reg = floodRegion(match, w, h, x0, y0);
  // spread under anti-aliased edges
  const spread = o.spread | 0;
  if (spread > 0) { const d3 = distTransform(reg, w, h, v => v); for (let i = 0; i < reg.length; i++) if (!reg[i] && d3[i] <= spread + 0.5) reg[i] = 2; }
  let bx0 = w, by0 = h, bx1 = -1, by1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (reg[y * w + x]) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  if (bx1 < 0) return false;
  color = paintColor(L, color);
  const sel = doc.sel, cr = color[0] * 255, cg = color[1] * 255, cb = color[2] * 255, lock = L.lockAlpha;
  forPixels(L, [bx0, by0, bx1 + 1, by1 + 1], false, (t, o2, x, y) => {
    const r = reg[y * w + x]; if (!r) return;
    let a = r === 2 ? 0.85 : 1; if (sel) a *= sel[y * w + x] / 255; if (a <= 0) return;
    const oa = t[o2 + 3] / 255;
    if (lock) { t[o2] += (cr - t[o2]) * a; t[o2 + 1] += (cg - t[o2 + 1]) * a; t[o2 + 2] += (cb - t[o2 + 2]) * a; return; }
    const na = a + oa * (1 - a), k = a / na;
    t[o2] = t[o2] + (cr - t[o2]) * k; t[o2 + 1] = t[o2 + 1] + (cg - t[o2 + 1]) * k; t[o2 + 2] = t[o2 + 2] + (cb - t[o2 + 2]) * k; t[o2 + 3] = na * 255;
  });
  markDirty(L); commitPaint('Paint Bucket', L); pushRecent(color);
  return true;
}
const fillTool = {
  down(pt) { floodFill(pt.x, pt.y); return false; },
  cursor(c, sp) { c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.moveTo(sp[0] - 6, sp[1]); c.lineTo(sp[0] + 6, sp[1]); c.moveTo(sp[0], sp[1] - 6); c.lineTo(sp[0], sp[1] + 6); c.stroke(); c.fillStyle = rgbHex(FG); c.fillRect(sp[0] + 6, sp[1] + 6, 10, 10); c.strokeRect(sp[0] + 6.5, sp[1] + 6.5, 10, 10); },
  options(bar) {
    const o = topts.fill;
    cmdSlider(bar, 'Tolerance', 0, 100, 1, () => o.tol, v => o.tol = v, v => v + '%');
    cmdSlider(bar, 'Gap closing', 0, 12, 1, () => o.gap, v => o.gap = v, v => v ? v + ' px' : 'off');
    cmdSlider(bar, 'Spread', 0, 4, 1, () => o.spread, v => o.spread = v, v => v + ' px');
    cmdSelect(bar, 'Sample', [['all', 'All layers'], ['layer', 'Current layer']], () => o.sample, v => o.sample = v);
  }
};

/* ---------- gradient ---------- */
function applyGradient(a, b) {
  const L = requirePixelLayer(); if (!L) return;
  dryWet(L);
  const o = topts.gradient, dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; if (L2 < 1) return;
  const len = Math.sqrt(L2), sel = doc.sel, W = doc.w, f = paintColor(L, FG).map(v => v * 255), g = paintColor(L, BG).map(v => v * 255), lock = L.lockAlpha, op = o.opacity;
  const R0 = doc.selBox ? [doc.selBox.x, doc.selBox.y, doc.selBox.x + doc.selBox.w, doc.selBox.y + doc.selBox.h] : [0, 0, doc.w, doc.h];
  let dz = 0;
  forPixels(L, R0, false, (t, o2, x, y) => {
    let s = o.type === 'radial' ? Math.hypot(x + 0.5 - a[0], y + 0.5 - a[1]) / len : ((x + 0.5 - a[0]) * dx + (y + 0.5 - a[1]) * dy) / L2;
    s = clamp(s, 0, 1);
    let cr, cg, cb, ca;
    if (o.colors === 'fg-bg') { cr = f[0] + (g[0] - f[0]) * s; cg = f[1] + (g[1] - f[1]) * s; cb = f[2] + (g[2] - f[2]) * s; ca = 1; }
    else { cr = f[0]; cg = f[1]; cb = f[2]; ca = 1 - s; }
    let al = ca * op; if (sel) al *= sel[y * W + x] / 255; if (al <= 0) return;
    const dd = DITHER[dz = (dz + 1) & 4095] - 0.5, oa = t[o2 + 3] / 255;
    if (lock) { t[o2] += (cr - t[o2]) * al + dd; t[o2 + 1] += (cg - t[o2 + 1]) * al + dd; t[o2 + 2] += (cb - t[o2 + 2]) * al + dd; return; }
    const na = al + oa * (1 - al), k = al / na;
    t[o2] = t[o2] + (cr - t[o2]) * k + dd; t[o2 + 1] = t[o2 + 1] + (cg - t[o2 + 1]) * k + dd; t[o2 + 2] = t[o2 + 2] + (cb - t[o2 + 2]) * k + dd; t[o2 + 3] = na * 255 + dd;
  }, null);
  markDirty(L); commitPaint('Gradient', L);
}
const gradientTool = {
  down(pt) { if (!requirePixelLayer()) return false; this.a = [pt.x, pt.y]; this.b = [pt.x, pt.y]; },
  move(pt) { if (this.a) { this.b = [pt.x, pt.y]; if (keys.shift) { const dx = this.b[0] - this.a[0], dy = this.b[1] - this.a[1], an = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, l = Math.hypot(dx, dy); this.b = [this.a[0] + Math.cos(an) * l, this.a[1] + Math.sin(an) * l]; } } },
  up() { if (this.a) { const a = this.a, b = this.b; this.a = null; applyGradient(a, b); } },
  cancel() { this.a = null; },
  overlay(c, px) {
    if (!this.a) return; const o = topts.gradient, a = this.a, b = this.b;
    const gr = o.type === 'radial' ? c.createRadialGradient(a[0], a[1], 0, a[0], a[1], Math.max(1, Math.hypot(b[0] - a[0], b[1] - a[1]))) : c.createLinearGradient(a[0], a[1], b[0], b[1]);
    gr.addColorStop(0, rgbHex(FG)); gr.addColorStop(1, o.colors === 'fg-bg' ? rgbHex(BG) : rgbHex(FG) + '00');
    c.globalAlpha = 0.55 * o.opacity; c.fillStyle = gr;
    const sb = doc.selBox; if (sb) c.fillRect(sb.x, sb.y, sb.w, sb.h); else c.fillRect(0, 0, doc.w, doc.h); c.globalAlpha = 1;
    c.lineWidth = 2 * px; c.strokeStyle = '#fff'; c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke();
    c.lineWidth = px; c.strokeStyle = '#000'; c.stroke();
    for (const p of [a, b]) { c.beginPath(); c.arc(p[0], p[1], 4 * px, 0, 7); c.fillStyle = '#fff'; c.fill(); c.stroke(); }
  },
  animating: false,
  options(bar) {
    const o = topts.gradient;
    cmdSelect(bar, 'Type', [['linear', 'Linear'], ['radial', 'Radial']], () => o.type, v => o.type = v);
    cmdSelect(bar, 'Colors', [['fg-bg', 'Foreground → Background'], ['fg-clear', 'Foreground → Transparent']], () => o.colors, v => o.colors = v);
    cmdSlider(bar, 'Opacity', 0.01, 1, 0.01, () => o.opacity, v => o.opacity = v, v => Math.round(v * 100) + '%');
    cmdHint(bar, 'Drag on the canvas · Shift snaps to 45°');
  }
};

/* ---------- shapes (stroked with the current brush, or filled) ---------- */
function shapePoints(kind, a, b) {
  const pts = [];
  const seg = (p, q) => { const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 3)); for (let i = 0; i <= n; i++) pts.push({ x: lerp(p[0], q[0], i / n), y: lerp(p[1], q[1], i / n), p: 1 }); };
  if (kind === 'line') seg(a, b);
  else if (kind === 'rect') { const c = [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [a[0], a[1]]]; for (let i = 0; i < 4; i++) seg(c[i], c[i + 1]); }
  else { const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2, n = Math.max(24, Math.ceil(Math.PI * (rx + ry) / 3)); for (let i = 0; i <= n; i++) { const t = i / n * Math.PI * 2; pts.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry, p: 1 }); } }
  return pts;
}
const shapeTool = {
  down(pt) { if (!requirePixelLayer()) return false; this.a = [pt.x, pt.y]; this.b = this.a.slice(); },
  move(pt) {
    if (!this.a) return; let b = [pt.x, pt.y];
    if (keys.shift) {
      const dx = b[0] - this.a[0], dy = b[1] - this.a[1];
      if (topts.shape.kind === 'line') { const an = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * Math.PI / 12, l = Math.hypot(dx, dy); b = [this.a[0] + Math.cos(an) * l, this.a[1] + Math.sin(an) * l]; }
      else { const m = Math.max(Math.abs(dx), Math.abs(dy)); b = [this.a[0] + Math.sign(dx || 1) * m, this.a[1] + Math.sign(dy || 1) * m]; }
    }
    this.b = b;
  },
  up() {
    const a = this.a, b = this.b; this.a = null; if (!a || Math.hypot(b[0] - a[0], b[1] - a[1]) < 2) return;
    const L = requirePixelLayer(), o = topts.shape; if (!L) return;
    if (o.style === 'fill' && o.kind !== 'line') {
      dryWet(L);
      const mats = symmetryMats();
      const m = maskFromPath(x => { for (const M of mats) { x.setTransform(M[0], M[1], M[2], M[3], M[4], M[5]); x.beginPath(); if (o.kind === 'rect') x.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); else x.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, 7); x.fill(); } });
      paintMask(L, m, paintColor(L, FG)); commitPaint('Shape', L);
    } else {
      const br = brushFor('brush'); const fb = fullBrush({ ...br, smoothing: 0, pSize: 0, velSize: 0 });
      const S = new Stroke({ layer: L, brush: L.isMask && (fb.mode === 'water' || fb.mode === 'oil') ? { ...fb, mode: 'paint' } : fb, color: paintColor(L, FG), mats: symmetryMats(), zoom: view.zoom });
      let t = 0; for (const p of shapePoints(o.kind, a, b)) { t += 4; S.add({ ...p, t }); }
      S.end(); commitPaint(o.kind === 'line' ? 'Line' : 'Shape', L, S);
    }
    pushRecent(FG);
  },
  cancel() { this.a = null; },
  overlay(c, px) {
    if (!this.a) return; const a = this.a, b = this.b, o = topts.shape;
    for (const M of symmetryMats()) {
      c.save(); c.transform(M[0], M[1], M[2], M[3], M[4], M[5]);
      c.beginPath();
      if (o.kind === 'line') { c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
      else if (o.kind === 'rect') c.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
      else c.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, 7);
      if (o.style === 'fill' && o.kind !== 'line') { c.fillStyle = rgbHex(FG) + '88'; c.fill(); }
      c.lineWidth = Math.max(px, brushFor('brush').size * (o.style === 'fill' ? 0 : 1)) || px; c.strokeStyle = rgbHex(FG) + 'aa'; c.stroke();
      c.lineWidth = px; c.strokeStyle = '#000'; c.setLineDash([5 * px, 4 * px]); c.stroke(); c.setLineDash([]);
      c.restore();
    }
  },
  cursor(c, sp) { c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.moveTo(sp[0] - 8, sp[1]); c.lineTo(sp[0] + 8, sp[1]); c.moveTo(sp[0], sp[1] - 8); c.lineTo(sp[0], sp[1] + 8); c.stroke(); },
  options(bar) {
    const o = topts.shape;
    cmdSelect(bar, 'Shape', [['line', 'Line'], ['rect', 'Rectangle'], ['ellipse', 'Ellipse']], () => o.kind, v => o.kind = v);
    cmdSelect(bar, 'Style', [['stroke', 'Stroke with brush'], ['fill', 'Fill']], () => o.style, v => o.style = v);
    cmdLabel(bar, 'Brush: ' + brushFor('brush').name);
    cmdHint(bar, 'Shift constrains · symmetry applies');
  }
};
function paintMask(L, m, color) { // composite color through an 8-bit coverage mask (and selection)
  const sel = doc.sel, W = doc.w, cr = color[0] * 255, cg = color[1] * 255, cb = color[2] * 255, lock = L.lockAlpha;
  let x0 = W, y0 = doc.h, x1 = -1, y1 = -1;
  for (let y = 0; y < doc.h; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return;
  forPixels(L, [x0, y0, x1 + 1, y1 + 1], false, (t, o, x, y) => {
    let a = m[y * W + x] / 255; if (sel) a *= sel[y * W + x] / 255; if (!a) return;
    if (lock) { t[o] += (cr - t[o]) * a; t[o + 1] += (cg - t[o + 1]) * a; t[o + 2] += (cb - t[o + 2]) * a; return; }
    const oa = t[o + 3] / 255, na = a + oa * (1 - a), k = a / na;
    t[o] += (cr - t[o]) * k; t[o + 1] += (cg - t[o + 1]) * k; t[o + 2] += (cb - t[o + 2]) * k; t[o + 3] = na * 255;
  });
  markDirty(L);
}

/* ---------- selection tools ---------- */
function selMode(o) { return keys.shift && keys.alt ? 'intersect' : keys.shift ? 'add' : keys.alt ? 'subtract' : o.mode; }
const lassoTool = {
  down(pt) { this.pts = [[pt.x, pt.y]]; this.mode = selMode(topts.lasso); },
  move(pt) { if (this.pts) { const l = this.pts[this.pts.length - 1]; if (Math.hypot(pt.x - l[0], pt.y - l[1]) * view.zoom > 2) this.pts.push([pt.x, pt.y]); } },
  up() {
    const p = this.pts; this.pts = null; if (!p) return;
    if (p.length < 3) { if (this.mode === 'replace') { if (doc.sel) setSelection(null, 'Deselect'); } return; }
    const m = maskFromPath(x => { x.beginPath(); p.forEach((q, i) => i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1])); x.closePath(); x.fill(); }, topts.lasso.feather);
    setSelection(combineSel(m, this.mode), 'Lasso Select');
  },
  cancel() { this.pts = null; },
  overlay(c, px) { if (!this.pts) return; c.beginPath(); this.pts.forEach((q, i) => i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1])); c.lineWidth = px; c.strokeStyle = '#fff'; c.stroke(); c.setLineDash([4 * px, 4 * px]); c.strokeStyle = '#000'; c.stroke(); c.setLineDash([]); },
  cursor(c, sp) { c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.arc(sp[0], sp[1], 3, 0, 7); c.stroke(); },
  options(bar) { selOptions(bar, topts.lasso); }
};
const marqueeTool = {
  down(pt) { this.a = [pt.x, pt.y]; this.b = this.a.slice(); this.mode = selMode(topts.marquee); },
  move(pt) { if (!this.a) return; let b = [pt.x, pt.y]; if (keys.shift && this.mode !== 'add') { const dx = b[0] - this.a[0], dy = b[1] - this.a[1], m = Math.max(Math.abs(dx), Math.abs(dy)); b = [this.a[0] + Math.sign(dx || 1) * m, this.a[1] + Math.sign(dy || 1) * m]; } this.b = b; },
  up() {
    const a = this.a, b = this.b; this.a = null; if (!a) return;
    if (Math.abs(b[0] - a[0]) < 1 || Math.abs(b[1] - a[1]) < 1) { if (this.mode === 'replace' && doc.sel) setSelection(null, 'Deselect'); return; }
    const o = topts.marquee;
    const m = maskFromPath(x => { x.beginPath(); if (o.shape === 'ellipse') x.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, 7); else x.rect(Math.round(Math.min(a[0], b[0])), Math.round(Math.min(a[1], b[1])), Math.round(Math.abs(b[0] - a[0])), Math.round(Math.abs(b[1] - a[1]))); x.fill(); }, o.feather);
    setSelection(combineSel(m, this.mode), o.shape === 'ellipse' ? 'Ellipse Select' : 'Rectangle Select');
  },
  cancel() { this.a = null; },
  overlay(c, px) { if (!this.a) return; const a = this.a, b = this.b; c.beginPath(); if (topts.marquee.shape === 'ellipse') c.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2, Math.abs(b[1] - a[1]) / 2, 0, 0, 7); else c.rect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); c.lineWidth = px; c.strokeStyle = '#fff'; c.stroke(); c.setLineDash([4 * px, 4 * px]); c.strokeStyle = '#000'; c.stroke(); c.setLineDash([]); },
  cursor(c, sp) { c.strokeStyle = '#000'; c.lineWidth = 1; c.beginPath(); c.moveTo(sp[0] - 7, sp[1]); c.lineTo(sp[0] + 7, sp[1]); c.moveTo(sp[0], sp[1] - 7); c.lineTo(sp[0], sp[1] + 7); c.stroke(); },
  options(bar) { cmdSelect(bar, 'Shape', [['rect', 'Rectangle'], ['ellipse', 'Ellipse']], () => topts.marquee.shape, v => topts.marquee.shape = v); selOptions(bar, topts.marquee); }
};
function selOptions(bar, o) {
  cmdSelect(bar, 'Mode', [['replace', 'New'], ['add', 'Add (Shift)'], ['subtract', 'Subtract (Alt)'], ['intersect', 'Intersect']], () => o.mode, v => o.mode = v);
  cmdSlider(bar, 'Feather', 0, 60, 1, () => o.feather, v => o.feather = v, v => v + ' px');
  cmdButton(bar, 'Invert', invertSelection); cmdButton(bar, 'Deselect', () => setSelection(null, 'Deselect'));
}
function invertSelection() { const m = new Uint8Array(doc.w * doc.h); if (doc.sel) for (let i = 0; i < m.length; i++) m[i] = 255 - doc.sel[i]; setSelection(doc.sel ? m : null, 'Invert Selection'); }

/* ---------- transform ---------- */
function beginTransform() {
  if (floating) return true;
  const L = requirePixelLayer(); if (!L) return false;
  dryWet(L);
  const lb = layerBounds(L); let bb = lb;
  if (doc.sel && doc.selBox && lb) { const s = doc.selBox, x0 = Math.max(s.x, lb.x), y0 = Math.max(s.y, lb.y), x1 = Math.min(s.x + s.w, lb.x + lb.w), y1 = Math.min(s.y + s.h, lb.y + lb.h); bb = x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null; }
  if (!bb) { Aero.toast('Nothing to transform on this layer' + (doc.sel ? ' inside the selection' : '')); return false; }
  const data = readRegion(L, bb.x, bb.y, bb.w, bb.h);
  const rest = data.slice(), sel = doc.sel;
  for (let y = 0; y < bb.h; y++) for (let x = 0; x < bb.w; x++) {
    const i = (y * bb.w + x) * 4, s = sel ? sel[(y + bb.y) * doc.w + x + bb.x] / 255 : 1;
    data[i + 3] = data[i + 3] * s; rest[i + 3] = rest[i + 3] * (1 - s);
  }
  writeRegion(L, bb.x, bb.y, bb.w, bb.h, rest, false);
  floating = { L, data, w: bb.w, h: bb.h, quad: [[bb.x, bb.y], [bb.x + bb.w, bb.y], [bb.x + bb.w, bb.y + bb.h], [bb.x, bb.y + bb.h]], ver: 1, hadSel: !!sel, src: { ...bb } };
  doc.ver++; requestRender(); showTransformPill(); return true;
}
function commitTransform() {
  const f = floating; if (!f) return;
  floating = null; hideTransformPill();
  if (R && f.gtex) R.gl.deleteTexture(f.gtex);
  const L = f.L, H = inv3(squareToQuad(f.quad));
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const p of f.quad) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const Rr = [Math.max(0, Math.floor(x0)), Math.max(0, Math.floor(y0)), Math.min(doc.w, Math.ceil(x1)), Math.min(doc.h, Math.ceil(y1))];
  // estimate minification for supersampling
  const area = Math.abs((f.quad[1][0] - f.quad[0][0]) * (f.quad[3][1] - f.quad[0][1]) - (f.quad[3][0] - f.quad[0][0]) * (f.quad[1][1] - f.quad[0][1]));
  const ss = area < f.w * f.h * 0.4 ? 2 : 1;
  const D = f.data, w = f.w, h = f.h;
  if (Rr[0] < Rr[2] && Rr[1] < Rr[3]) forPixels(L, Rr, false, (t, o, x, y) => {
    let sr = 0, sg = 0, sb = 0, sa = 0;
    for (let k = 0; k < ss * ss; k++) {
      const px = x + (ss === 1 ? 0.5 : 0.25 + 0.5 * (k % 2)), py = y + (ss === 1 ? 0.5 : 0.25 + 0.5 * (k >> 1));
      const q = ap3(H, px, py); const u = q[0] * w - 0.5, v = q[1] * h - 0.5;
      if (u < -1 || v < -1 || u > w || v > h) continue;
      const xi = Math.floor(u), yi = Math.floor(v), ax = u - xi, ay = v - yi;
      for (let j = 0; j < 4; j++) {
        const xx = xi + (j & 1), yy = yi + (j >> 1); if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const wg = (j & 1 ? ax : 1 - ax) * (j >> 1 ? ay : 1 - ay), i = (yy * w + xx) * 4, a = D[i + 3] / 255 * wg;
        sr += D[i] * a; sg += D[i + 1] * a; sb += D[i + 2] * a; sa += a;
      }
    }
    const n = ss * ss; sa /= n; if (sa <= 0.001) return; sr /= n; sg /= n; sb /= n;
    const oa = t[o + 3] / 255, na = sa + oa * (1 - sa);
    t[o] = (sr + t[o] * oa * (1 - sa)) / na; t[o + 1] = (sg + t[o + 1] * oa * (1 - sa)) / na; t[o + 2] = (sb + t[o + 2] * oa * (1 - sa)) / na; t[o + 3] = na * 255;
  });
  markDirty(L);
  if (!f.hadSel && !L.isMask && L.mask) transformLinkedMask(L, f.src, f.quad);
  if (f.hadSel) { // move the selection with the pixels
    const m = maskFromPath(x => { const q = f.quad; x.beginPath(); x.moveTo(q[0][0], q[0][1]); for (let i = 1; i < 4; i++) x.lineTo(q[i][0], q[i][1]); x.closePath(); x.fill(); });
    doc.sel = m; doc.selV++; selectionChanged();
  }
  commitPaint('Transform', L);
}
function cancelTransform() {
  if (!floating) return; const f = floating; floating = null; hideTransformPill();
  if (R && f.gtex) R.gl.deleteTexture(f.gtex);
  restoreSnapshot(hist.items[hist.index].state);
}
function cancelTransientTools() { if (floating) { const f = floating; floating = null; hideTransformPill(); if (R && f.gtex) R.gl.deleteTexture(f.gtex); } activeTool?.cancel?.(); }
function quadOp(fn) { if (!floating && !beginTransform()) return; floating.quad = fn(floating.quad); doc.ver++; requestRender(); requestOverlay(); }
const qCenter = q => [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4];
const flipFloatH = () => quadOp(q => [q[1], q[0], q[3], q[2]]);
const flipFloatV = () => quadOp(q => [q[3], q[2], q[1], q[0]]);
const rotFloat = a => quadOp(q => { const c = qCenter(q), cs = Math.cos(a), sn = Math.sin(a); return q.map(p => [c[0] + (p[0] - c[0]) * cs - (p[1] - c[1]) * sn, c[1] + (p[0] - c[0]) * sn + (p[1] - c[1]) * cs]); });
const transformTool = {
  activate() { beginTransform(); },
  deactivate() { commitTransform(); },
  hit(pt) {
    if (!floating) return null; const q = floating.quad, tol = 9 / view.zoom;
    for (let i = 0; i < 4; i++) if (Math.hypot(pt.x - q[i][0], pt.y - q[i][1]) < tol) return { k: 'corner', i };
    for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; if (Math.hypot(pt.x - (a[0] + b[0]) / 2, pt.y - (a[1] + b[1]) / 2) < tol) return { k: 'edge', i }; }
    if (pointInPoly(pt.x, pt.y, q)) return { k: 'move' };
    return { k: 'rotate' };
  },
  down(pt) {
    if (!floating && !beginTransform()) return false;
    this.drag = { h: this.hit(pt), p0: [pt.x, pt.y], q0: floating.quad.map(p => p.slice()) };
  },
  move(pt) {
    const d = this.drag; if (!d) return; const q0 = d.q0, dx = pt.x - d.p0[0], dy = pt.y - d.p0[1];
    let q = q0.map(p => p.slice());
    if (d.h.k === 'move') q = q0.map(p => [p[0] + dx, p[1] + dy]);
    else if (d.h.k === 'rotate') {
      const c = qCenter(q0); let a = Math.atan2(pt.y - c[1], pt.x - c[0]) - Math.atan2(d.p0[1] - c[1], d.p0[0] - c[0]);
      if (keys.shift) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
      const cs = Math.cos(a), sn = Math.sin(a); q = q0.map(p => [c[0] + (p[0] - c[0]) * cs - (p[1] - c[1]) * sn, c[1] + (p[0] - c[0]) * sn + (p[1] - c[1]) * cs]);
    } else if (d.h.k === 'corner') {
      const i = d.h.i;
      if (keys.ctrl || keys.shift) q[i] = [q0[i][0] + dx, q0[i][1] + dy];
      else {
        const o = keys.alt ? qCenter(q0) : q0[(i + 2) % 4], d0 = Math.hypot(q0[i][0] - o[0], q0[i][1] - o[1]) || 1;
        const v0 = [(q0[i][0] - o[0]) / d0, (q0[i][1] - o[1]) / d0], proj = ((pt.x - o[0]) * v0[0] + (pt.y - o[1]) * v0[1]);
        const s = proj / d0; q = q0.map(p => [o[0] + (p[0] - o[0]) * s, o[1] + (p[1] - o[1]) * s]);
      }
    } else if (d.h.k === 'edge') {
      const i = d.h.i, j = (i + 1) % 4, a = q0[i], b = q0[j], ex = b[0] - a[0], ey = b[1] - a[1], el = Math.hypot(ex, ey) || 1, nx = -ey / el, ny = ex / el;
      const m = dx * nx + dy * ny; q[i] = [a[0] + nx * m, a[1] + ny * m]; q[j] = [b[0] + nx * m, b[1] + ny * m];
      if (keys.alt) { const k = (i + 2) % 4, l = (i + 3) % 4; q[k] = [q0[k][0] - nx * m, q0[k][1] - ny * m]; q[l] = [q0[l][0] - nx * m, q0[l][1] - ny * m]; }
    }
    floating.quad = q; doc.ver++; requestRender();
  },
  up() { this.drag = null; },
  cancel() { this.drag = null; },
  overlay(c, px) {
    if (!floating) return; const q = floating.quad;
    c.beginPath(); c.moveTo(q[0][0], q[0][1]); for (let i = 1; i < 4; i++) c.lineTo(q[i][0], q[i][1]); c.closePath();
    c.lineWidth = 2.5 * px; c.strokeStyle = 'rgba(255,255,255,.85)'; c.stroke(); c.lineWidth = px; c.strokeStyle = '#1f6fd0'; c.stroke();
    const hs = 5 * px;
    const handle = (x, y) => { c.fillStyle = '#fff'; c.fillRect(x - hs, y - hs, hs * 2, hs * 2); c.strokeStyle = '#1f6fd0'; c.strokeRect(x - hs, y - hs, hs * 2, hs * 2); };
    for (let i = 0; i < 4; i++) { handle(q[i][0], q[i][1]); const b = q[(i + 1) % 4]; handle((q[i][0] + b[0]) / 2, (q[i][1] + b[1]) / 2); }
    const cc = qCenter(q); c.beginPath(); c.arc(cc[0], cc[1], 3 * px, 0, 7); c.stroke();
  },
  hover(dp) { const h = this.hit({ x: dp[0], y: dp[1] }); $('#stage').style.cursor = !h ? '' : h.k === 'move' ? 'move' : h.k === 'rotate' ? 'alias' : h.k === 'corner' ? 'nwse-resize' : 'ew-resize'; },
  options(bar) {
    cmdButton(bar, 'Flip H', flipFloatH); cmdButton(bar, 'Flip V', flipFloatV); cmdButton(bar, 'Rotate 90°', () => rotFloat(Math.PI / 2));
    bar.appendChild(el('span', 'sep'));
    cmdButton(bar, 'Apply (Enter)', () => { commitTransform(); }); cmdButton(bar, 'Cancel (Esc)', cancelTransform);
    cmdHint(bar, 'Drag inside: move · outside: rotate · corner: scale (Alt: from center, Ctrl/Shift: distort) · edge: stretch');
  }
};
function showTransformPill() { const p = $('#tfpill'); p.hidden = false; p.innerHTML = '<span>Transform</span>'; [['Apply', commitTransform], ['Cancel', cancelTransform]].forEach(([t, f]) => { const b = el('button', 'aero-btn small', t); b.onclick = f; p.appendChild(b); }); }
function hideTransformPill() { $('#tfpill').hidden = true; $('#stage').style.cursor = ''; }

/* ---------- eyedropper ---------- */
const pickTool = {
  down(pt) { this.pick(pt); },
  move(pt) { this.pick(pt); },
  up() { pushRecent(FG); },
  pick(pt) {
    if (topts.pick.sample === 'layer' && doc.active?.type === 'pixel') {
      const x = pt.x | 0, y = pt.y | 0; if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return;
      const d = readRegion(doc.active, x, y, 1, 1); if (d[3] > 8) setFG([d[0] / 255, d[1] / 255, d[2] / 255]);
    } else pickColorAt([pt.x, pt.y]);
  },
  cursor(c, sp) { c.lineWidth = 3; c.strokeStyle = '#fff'; c.beginPath(); c.arc(sp[0], sp[1], 12, 0, 7); c.stroke(); c.lineWidth = 6; c.strokeStyle = rgbHex(FG); c.beginPath(); c.arc(sp[0], sp[1], 17, 0, 7); c.stroke(); c.lineWidth = 1; c.strokeStyle = '#000'; c.beginPath(); c.arc(sp[0], sp[1], 20.5, 0, 7); c.stroke(); },
  options(bar) { cmdSelect(bar, 'Sample', [['all', 'All layers'], ['layer', 'Current layer']], () => topts.pick.sample, v => topts.pick.sample = v); cmdHint(bar, 'Tip: Alt-click or right-click while painting picks a color'); }
};

/* ---------- guides (symmetry, perspective, ruler) ---------- */
const guidesTool = {
  handles() {
    const h = [];
    if (guides.sym !== 'off') h.push({ k: 'sym', p: [guides.cx, guides.cy] });
    if (guides.persp !== 'off') { h.push({ k: 'vp0', p: guides.vp[0] }); if (guides.persp === '2') h.push({ k: 'vp1', p: guides.vp[1] }); }
    if (guides.ruler.on) { h.push({ k: 'ra', p: guides.ruler.a }); h.push({ k: 'rb', p: guides.ruler.b }); h.push({ k: 'rm', p: [(guides.ruler.a[0] + guides.ruler.b[0]) / 2, (guides.ruler.a[1] + guides.ruler.b[1]) / 2] }); }
    return h;
  },
  down(pt) {
    const tol = 12 / view.zoom; const h = this.handles().find(h => Math.hypot(pt.x - h.p[0], pt.y - h.p[1]) < tol);
    if (!h) { if (guides.persp !== 'off' && Math.abs(pt.y - guides.hy) < tol) this.drag = { k: 'hz', y0: guides.hy, p0: [pt.x, pt.y] }; else return false; }
    else this.drag = { k: h.k, p0: [pt.x, pt.y], a: guides.ruler.a.slice(), b: guides.ruler.b.slice() };
  },
  move(pt) {
    const d = this.drag; if (!d) return;
    if (d.k === 'sym') { guides.cx = pt.x; guides.cy = pt.y; if (keys.shift) { guides.cx = Math.round(pt.x / (doc.w / 2)) * doc.w / 2 || doc.w / 2; guides.cy = Math.round(pt.y / (doc.h / 2)) * doc.h / 2 || doc.h / 2; } }
    else if (d.k === 'vp0' || d.k === 'vp1') { const i = +d.k[2]; guides.vp[i] = [pt.x, pt.y]; guides.hy = pt.y; guides.vp[1 - i][1] = pt.y; }
    else if (d.k === 'hz') { guides.hy = d.y0 + pt.y - d.p0[1]; guides.vp.forEach(v => v[1] = guides.hy); }
    else if (d.k === 'ra') guides.ruler.a = [pt.x, pt.y];
    else if (d.k === 'rb') guides.ruler.b = [pt.x, pt.y];
    else if (d.k === 'rm') { const dx = pt.x - d.p0[0], dy = pt.y - d.p0[1]; guides.ruler.a = [d.a[0] + dx, d.a[1] + dy]; guides.ruler.b = [d.b[0] + dx, d.b[1] + dy]; }
  },
  up() { this.drag = null; saveGuides(); },
  hover(dp) { const tol = 12 / view.zoom; const h = this.handles().find(h => Math.hypot(dp[0] - h.p[0], dp[1] - h.p[1]) < tol); $('#stage').style.cursor = h || (guides.persp !== 'off' && Math.abs(dp[1] - guides.hy) < tol) ? 'move' : ''; },
  overlay(c, px) {
    for (const h of this.handles()) { c.beginPath(); c.arc(h.p[0], h.p[1], 7 * px, 0, 7); c.fillStyle = 'rgba(255,255,255,.9)'; c.fill(); c.lineWidth = 2 * px; c.strokeStyle = h.k === 'sym' ? '#0a9bd6' : h.k.startsWith('vp') ? '#d6500a' : '#2a7f14'; c.stroke(); }
  },
  options(bar) { guideOptions(bar); cmdHint(bar, 'Drag the handles to move the symmetry center, vanishing points, horizon and ruler'); }
};
function guideOptions(bar) {
  cmdSelect(bar, 'Symmetry', [['off', 'Off'], ['v', 'Vertical'], ['h', 'Horizontal'], ['quad', 'Quadrant'], ['radial', 'Radial'], ['kaleido', 'Kaleidoscope']], () => guides.sym, v => { guides.sym = v; saveGuides(); renderCmd(); });
  if (guides.sym === 'radial' || guides.sym === 'kaleido') cmdSlider(bar, 'Axes', 2, 24, 1, () => guides.n, v => { guides.n = v; requestOverlay(); });
  cmdSelect(bar, 'Perspective', [['off', 'Off'], ['1', '1-point'], ['2', '2-point']], () => guides.persp, v => { guides.persp = v; saveGuides(); renderCmd(); });
  if (guides.persp !== 'off') cmdCheck(bar, 'Snap strokes', () => guides.snapPersp, v => guides.snapPersp = v);
  cmdCheck(bar, 'Ruler', () => guides.ruler.on, v => { guides.ruler.on = v; saveGuides(); });
}
function saveGuides() { requestOverlay(); }
function drawGuides(c, px) {
  if (!guides.show) return;
  const W = doc.w, H = doc.h;
  c.save(); c.beginPath(); c.rect(0, 0, W, H); c.clip();
  if (guides.persp !== 'off') {
    c.lineWidth = px; c.strokeStyle = 'rgba(214,80,10,.35)'; c.beginPath();
    const vps = guides.persp === '1' ? [guides.vp[0]] : guides.vp, Lr = Math.hypot(W, H) * 3;
    for (const v of vps) for (let k = 0; k < 36; k++) { const a = k / 36 * Math.PI * 2; c.moveTo(v[0], v[1]); c.lineTo(v[0] + Math.cos(a) * Lr, v[1] + Math.sin(a) * Lr); }
    if (guides.persp === '2') for (let k = 1; k < 12; k++) { const x = W * k / 12; c.moveTo(x, 0); c.lineTo(x, H); }
    c.stroke();
    c.lineWidth = 2 * px; c.strokeStyle = 'rgba(214,80,10,.75)'; c.beginPath(); c.moveTo(-W, guides.hy); c.lineTo(W * 2, guides.hy); c.stroke();
  }
  if (guides.sym !== 'off') {
    const { cx, cy } = guides, Lr = Math.hypot(W, H) * 2;
    c.beginPath();
    if (guides.sym === 'v' || guides.sym === 'quad') { c.moveTo(cx, -H); c.lineTo(cx, H * 2); }
    if (guides.sym === 'h' || guides.sym === 'quad') { c.moveTo(-W, cy); c.lineTo(W * 2, cy); }
    if (guides.sym === 'radial' || guides.sym === 'kaleido') { const N = guides.n * (guides.sym === 'kaleido' ? 2 : 1); for (let k = 0; k < N; k++) { const a = -Math.PI / 2 + k / N * Math.PI * 2; c.moveTo(cx, cy); c.lineTo(cx + Math.cos(a) * Lr, cy + Math.sin(a) * Lr); } }
    c.lineWidth = 3 * px; c.strokeStyle = 'rgba(255,255,255,.6)'; c.stroke();
    c.lineWidth = 1.2 * px; c.strokeStyle = 'rgba(10,155,214,.9)'; c.setLineDash([8 * px, 5 * px]); c.stroke(); c.setLineDash([]);
  }
  c.restore();
  if (guides.ruler.on) {
    const { a, b } = guides.ruler, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, wd = 14 * px;
    c.beginPath(); c.moveTo(a[0] + nx * wd, a[1] + ny * wd); c.lineTo(b[0] + nx * wd, b[1] + ny * wd); c.lineTo(b[0] - nx * wd, b[1] - ny * wd); c.lineTo(a[0] - nx * wd, a[1] - ny * wd); c.closePath();
    c.fillStyle = 'rgba(120,200,90,.18)'; c.fill(); c.lineWidth = px; c.strokeStyle = 'rgba(42,127,20,.6)'; c.stroke();
    c.beginPath(); const L2 = l * 3; c.moveTo(a[0] - dx / l * L2, a[1] - dy / l * L2); c.lineTo(b[0] + dx / l * L2, b[1] + dy / l * L2); c.strokeStyle = 'rgba(42,127,20,.9)'; c.stroke();
    const step = 20 * px * 2; c.beginPath(); for (let t = 0; t <= l; t += step) { const x = a[0] + dx / l * t, y = a[1] + dy / l * t, s = (Math.round(t / step) % 5 ? 5 : 10) * px; c.moveTo(x + nx * wd, y + ny * wd); c.lineTo(x + nx * (wd - s), y + ny * (wd - s)); } c.stroke();
  }
}
const handTool = { down() { }, cursor() { }, options(bar) { cmdButton(bar, 'Fit', () => fitView()); cmdButton(bar, '100%', () => setZoom(1)); cmdButton(bar, 'Reset rotation', () => rotateView(0)); cmdButton(bar, 'Flip view', flipView); cmdHint(bar, 'Drag to pan · R+drag rotates · wheel zooms'); } };

const TOOLS = {
  brush: brushTool('brush'), eraser: brushTool('eraser'), smudge: brushTool('smudge'), liquify: liquifyTool,
  fill: fillTool, gradient: gradientTool, shape: shapeTool, lasso: lassoTool, marquee: marqueeTool,
  transform: transformTool, pick: pickTool, guides: guidesTool, hand: handTool
};
const TOOL_DEFS = [
  { id: 'brush', title: 'Brush', key: 'B', icon: '<path d="M4 20c3 0 5-1.5 5-4 0-1.6 1.2-2.6 2.6-2.4M20 4 10.5 13.5l2 2L22 6"/><path d="M9 16c-.4 1.2-1.6 2-3 2"/>' },
  { id: 'eraser', title: 'Eraser', key: 'E', icon: '<path d="M8 20h12M5 15l9-9 5 5-8 9H8z"/><path d="M10 10l5 5"/>' },
  { id: 'smudge', title: 'Blend / Smudge', key: 'S', icon: '<path d="M8 21v-6l-2-3V6a1.5 1.5 0 0 1 3 0v4m0-6a1.5 1.5 0 0 1 3 0v6m0-5a1.5 1.5 0 0 1 3 0v5m0-3a1.5 1.5 0 0 1 3 0v6c0 3-2 5-3 6v2"/>' },
  { id: 'liquify', title: 'Liquify', key: 'W', icon: '<path d="M3 12c3-6 6 6 9 0s6 6 9 0"/><path d="M3 18c3-6 6 6 9 0s6 6 9 0" opacity=".6"/><path d="M3 6c3-6 6 6 9 0s6 6 9 0" opacity=".6"/>' },
  null,
  { id: 'fill', title: 'Paint Bucket', key: 'G', icon: '<path d="M5 11 12 4l7 7-7 7z"/><path d="M5 11h14M20 15c0 1.5-1 3-2 3s-1.6-1.4-1-3l1-2z"/>' },
  { id: 'gradient', title: 'Gradient', key: 'Shift+G', icon: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M11 5v14" opacity=".7"/><path d="M15 5v14" opacity=".4"/>' },
  { id: 'shape', title: 'Shapes & Lines', key: 'U', icon: '<path d="M4 20 20 4"/><circle cx="16" cy="16" r="4"/><rect x="4" y="4" width="7" height="7"/>' },
  null,
  { id: 'lasso', title: 'Lasso Select', key: 'L', icon: '<path d="M12 5c5 0 8 2 8 5s-4 5-8 5-8-2-8-5 3-5 8-5z" stroke-dasharray="3 2"/><path d="M6 13c-1 2 0 4 2 4s2 3 0 4"/>' },
  { id: 'marquee', title: 'Rectangle / Ellipse Select', key: 'M', icon: '<rect x="4" y="5" width="16" height="14" rx="1" stroke-dasharray="3 2"/>' },
  { id: 'transform', title: 'Transform (move / scale / rotate / distort)', key: 'V', icon: '<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>' },
  null,
  { id: 'pick', title: 'Eyedropper', key: 'I', icon: '<path d="M14 6l4 4M4 20l2-1 9-9-2-2-9 9z"/><path d="M15 5l2-2a2 2 0 0 1 3 3l-2 2"/>' },
  { id: 'guides', title: 'Guides: symmetry, perspective, ruler', key: 'K', icon: '<path d="M12 3v18" stroke-dasharray="3 2"/><path d="M5 8l4 4-4 4M19 8l-4 4 4 4"/>' },
  { id: 'hand', title: 'Hand (hold Space)', key: '', icon: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12m0-7a1.5 1.5 0 0 1 3 0v7m0-5.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 7-6 7s-5-2-7-5l-1.5-2.5a1.4 1.4 0 0 1 2.3-1.6L8 14"/>' }
];
function setTool(id) {
  if (id === activeToolId && activeTool) return;
  activeTool?.cancel?.(); if (id !== activeToolId) activeTool?.deactivate?.();
  activeToolId = id; activeTool = TOOLS[id];
  $('#stage').style.cursor = id === 'hand' ? 'grab' : '';
  activeTool.activate?.();
  if (['brush', 'eraser', 'smudge'].includes(id)) brushCat = brushFor(id).cat;
  renderBrushCats(); renderCmd(); renderBrushList(); requestOverlay();
}
