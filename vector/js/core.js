'use strict';
/* Lumen Vector — core: paper.js setup, document model, selection, history, paint helpers. */
const P = paper;
const LV = window.LV = {
  doc: null,            // { name, path, artboards:[{id,name,x,y,w,h}], active, guides:{x:[],y:[]}, swatches:[] }
  sel: [],              // selected items (top level objects for Selection tool, leaves for Direct Selection)
  selSegs: new Set(),   // selected anchor points (Direct Selection)
  prefs: { rulers: true, grid: false, snapGrid: false, snapPoint: true, smart: true, guides: true, gridSize: 10, gridEvery: 10, bbox: true, moveArt: true, smartAngles: true, angleInc: 45, smartSpacing: true, snapTol: 6 },
  paint: { fill: '#ffffff', stroke: '#1d2733', strokeWidth: 1, active: 'fill' },
  text: { family: 'Inter', weight: 400, size: 36, leading: 1.2, tracking: 0, align: 'left' },
  shape: { radius: 16, sides: 6, points: 5, inner: 50, smooth: 5 },
  clipboard: null, lastTransform: null, smartLines: [], marquee: null,
  needsDraw: true, hooks: { changed: [], selection: [], view: [] }
};
LV.on = (ev, fn) => (LV.hooks[ev] = LV.hooks[ev] || []).push(fn);
LV.emit = (ev, ...a) => (LV.hooks[ev] || []).forEach(f => { try { f(...a); } catch (e) { console.error(e); } });
LV.redraw = () => { LV.needsDraw = true; };

/* ---------------- fonts (bundled, OFL) ---------------- */
LV.FONTS = [
  { family: 'Inter', file: 'inter', weights: [400, 500, 600, 700, 800, 900] },
  { family: 'Montserrat', file: 'montserrat', weights: [400, 600, 700, 800] },
  { family: 'Playfair Display', file: 'playfair-display', weights: [400, 700, 900] },
  { family: 'Lora', file: 'lora', weights: [400, 700] },
  { family: 'Roboto Mono', file: 'roboto-mono', weights: [400, 700] },
  { family: 'Bebas Neue', file: 'bebas-neue', weights: [400] },
  { family: 'Pacifico', file: 'pacifico', weights: [400] }
];
LV.fontInfo = fam => LV.FONTS.find(f => f.family.toLowerCase() === String(fam || '').replace(/["']/g, '').split(',')[0].trim().toLowerCase());
LV.nearestWeight = (fam, w) => { const f = LV.fontInfo(fam) || LV.FONTS[0]; w = parseInt(w) || (String(w) === 'bold' ? 700 : 400); return f.weights.reduce((a, b) => Math.abs(b - w) < Math.abs(a - w) ? b : a); };
LV.fontUrl = (f, w) => `vendor/fonts/${f.file}-latin-${w}-normal.woff`;
const otCache = {}, bytesCache = {};
LV.fontBytes = async (fam, w) => {
  const f = LV.fontInfo(fam) || LV.FONTS[0]; w = LV.nearestWeight(f.family, w); const k = f.file + w;
  if (!bytesCache[k]) bytesCache[k] = fetch(LV.fontUrl(f, w)).then(r => r.arrayBuffer());
  return bytesCache[k];
};
LV.otFont = async (fam, w) => {
  const f = LV.fontInfo(fam) || LV.FONTS[0]; w = LV.nearestWeight(f.family, w); const k = f.file + w;
  if (!otCache[k]) otCache[k] = LV.fontBytes(f.family, w).then(b => opentype.parse(b));
  return otCache[k];
};
LV.otFontSync = {}; // resolved fonts for synchronous use (text on path)
LV.loadFonts = async () => {
  const jobs = [];
  for (const f of LV.FONTS) for (const w of f.weights) {
    const ff = new FontFace(f.family, `url(${LV.fontUrl(f, w)})`, { weight: String(w) });
    document.fonts.add(ff);
    jobs.push(ff.load().catch(() => {}));
    jobs.push(LV.otFont(f.family, w).then(o => { LV.otFontSync[f.file + w] = o; }).catch(e => console.warn('font', f.file, w, e)));
  }
  await Promise.all(jobs);
};
LV.otGet = (fam, w) => { const f = LV.fontInfo(fam) || LV.FONTS[0]; return LV.otFontSync[f.file + LV.nearestWeight(f.family, w)] || LV.otFontSync['inter400']; };

/* ---------------- paper patches ---------------- */
const mctx = document.createElement('canvas').getContext('2d');
LV.measure = (font, tracking, line) => { mctx.font = font; mctx.letterSpacing = (tracking || 0) + 'px'; const w = mctx.measureText(line).width; mctx.letterSpacing = '0px'; return w; };
LV.fontMetrics = font => { mctx.font = font; const m = mctx.measureText('Hgjy'); return { a: m.fontBoundingBoxAscent, d: m.fontBoundingBoxDescent }; };
const trackPx = it => ((it._data && it._data.tracking) || 0) / 1000 * it._style.getFontSize();
P.PointText.prototype._draw = function (ctx, param, viewMatrix) {
  if (!this._content) return;
  this._setStyles(ctx, param, viewMatrix);
  const lines = this._lines, style = this._style, hasFill = style.hasFill(), hasStroke = style.hasStroke(), leading = style.getLeading(), shadow = ctx.shadowColor;
  ctx.font = style.getFontStyle(); ctx.textAlign = style.getJustification();
  const tr = trackPx(this); ctx.letterSpacing = tr + 'px';
  const just = style.getJustification(); if (tr && just !== 'left') ctx.translate(just === 'center' ? tr / 2 : tr, 0); // ignore trailing spacing
  for (let i = 0; i < lines.length; i++) {
    ctx.shadowColor = shadow;
    if (hasFill) { ctx.fillText(lines[i], 0, 0); ctx.shadowColor = 'rgba(0,0,0,0)'; }
    if (hasStroke) ctx.strokeText(lines[i], 0, 0);
    ctx.translate(0, leading);
  }
  ctx.letterSpacing = '0px';
};
P.PointText.prototype._getBounds = function (matrix) {
  const style = this._style, lines = this._lines, n = lines.length, just = style.getJustification(), leading = style.getLeading(), font = style.getFontStyle(), tr = trackPx(this);
  let width = 0; for (const l of lines) width = Math.max(width, LV.measure(font, tr, l) - (l.length ? tr : 0));
  let x = 0; if (just !== 'left') x -= width / (just === 'center' ? 2 : 1);
  const rect = new P.Rectangle(x, n ? -0.75 * leading : 0, width, n * leading);
  return matrix ? matrix._transformBounds(rect, rect) : rect;
};
// Stroke alignment (inside / outside) for closed paths: draw a double-width stroke clipped to the shape (or its outside).
function wrapAlign(proto) {
  const orig = proto._draw;
  proto._draw = function (ctx, param, viewMatrix, strokeMatrix) {
    const al = this._data && this._data.strokeAlign;
    if (!al || al === 'center' || param.dontFinish || param.clip || !this._style.hasStroke() || (this instanceof P.Path && !this._closed)) return orig.call(this, ctx, param, viewMatrix, strokeMatrix);
    const rule = this._style.getFillRule();
    ctx.stroke = function () {
      delete ctx.stroke; ctx.save();
      if (al === 'inside') ctx.clip(rule);
      else { ctx.rect(-1e7, -1e7, 2e7, 2e7); ctx.clip('evenodd'); }
      ctx.lineWidth *= 2; ctx.stroke(); ctx.restore();
    };
    try { orig.call(this, ctx, param, viewMatrix, strokeMatrix); } finally { delete ctx.stroke; }
  };
}
wrapAlign(P.Path.prototype); wrapAlign(P.CompoundPath.prototype);

/* ---------------- helpers ---------------- */
LV.round = (v, d = 2) => { const m = 10 ** d; return Math.round(v * m) / m; };
LV.fmt = v => String(LV.round(v, 2));
LV.uidOf = it => it.data.uid || (it.data.uid = Aero.uid());
LV.kind = it => it && it.data && it.data.kind || (it instanceof P.PointText ? 'text' : it instanceof P.Raster ? 'image' : it instanceof P.CompoundPath ? 'compound' : it instanceof P.Path ? 'path' : it instanceof P.Layer ? 'layer' : it instanceof P.Group ? (it.clipped ? 'clip' : 'group') : 'item');
LV.isTextLike = it => ['text', 'areatext', 'pathtext'].includes(LV.kind(it));
LV.isPathItem = it => it instanceof P.Path || it instanceof P.CompoundPath;
LV.layers = () => P.project.layers;
LV.ancestorsOk = it => { for (let p = it; p && !(p instanceof P.Project); p = p.parent) { if (!p.visible || p.locked) return false; if (p instanceof P.Layer) return true; } return true; };
LV.topOf = it => { while (it && it.parent && !(it.parent instanceof P.Layer)) it = it.parent; return it; };
// paint order index of every item
LV.zMap = () => { const m = new Map(); let i = 0; const walk = it => { m.set(it, i++); (it.children || []).forEach(walk); }; P.project.layers.forEach(walk); return m; };
LV.sortZ = items => { const m = LV.zMap(); return items.slice().sort((a, b) => m.get(a) - m.get(b)); };
LV.reUid = it => { it.data.uid = Aero.uid(); (it.children || []).forEach(LV.reUid); return it; };
LV.leaves = (it, out = []) => { if (it.children && !it.data.kind && !(it instanceof P.CompoundPath)) it.children.forEach(c => LV.leaves(c, out)); else out.push(it); return out; };
LV.isoRoot = () => (LV.sym && LV.sym.editing && LV.sym.editing()) || null; // symbol editing ("isolation mode")
LV.allObjects = () => { const iso = LV.isoRoot(); if (iso) return iso.children.slice(); const out = []; P.project.layers.forEach(l => l.children.forEach(c => out.push(c))); return out; };
LV.selBounds = (items = LV.sel) => { let r = null; items.forEach(it => { const b = it.bounds; r = r ? r.unite(b) : b.clone(); }); return r; };
LV.tol = (px = 4) => px / P.view.zoom;

/* hit testing: walk paint order top-down. leaf=true returns innermost item (direct selection). */
LV.hitTest = (pt, { leaf = false, tol = LV.tol(4), filter } = {}) => {
  const test = it => {
    if (!it.visible || it.locked || it.data.role === 'frame' && !leaf) return null;
    if (leaf && (it.data.role === 'blendSteps' || it.data.role === 'repeatCopies' || it.data.role === 'warpOut')) return null;
    if (it.data.role === 'blendSpine') return leaf && it.getNearestPoint(pt).getDistance(pt) <= tol * 1.5 ? it : null; // unpainted spine: hit near its line (direct selection)
    const k = LV.kind(it);
    if (k === 'symbol') { // instance: hit its artwork as a whole (children live in the instance's own coordinate space)
      if (!it.bounds.expand(tol * 2).contains(pt)) return null;
      return it.hitTest(pt, { fill: true, stroke: true, tolerance: tol }) || it.children.some(c => (c instanceof P.PointText || c instanceof P.Raster) && c.bounds.contains(it.globalToLocal(pt))) ? it : null;
    }
    if (k === 'areatext' || k === 'pathtext') {
      if (!it.bounds.expand(tol * 2).contains(pt)) return null;
      if (k === 'areatext') return it;
      const g = it.children.find(c => c.data.role === 'glyphs'), gd = it.children.find(c => c.data.role === 'guide');
      const near = (g && g.bounds.expand(tol * 3).contains(pt) && g.hitTest(pt, { fill: true, stroke: true, tolerance: tol * 3 })) || (gd && gd.hitTest(pt, { stroke: true, fill: false, tolerance: tol * 3 }));
      return near ? it : null;
    }
    if (it instanceof P.Group || it instanceof P.Layer) {
      if (it.clipped) { const m = it.children.find(c => c.clipMask); if (m && !m.contains(pt)) return null; }
      for (let i = it.children.length - 1; i >= 0; i--) { const c = it.children[i]; if (c.clipMask && !leaf) continue; const h = test(c); if (h) return leaf || it instanceof P.Layer ? h : it; }
      return null;
    }
    if (it instanceof P.PointText || it instanceof P.Raster) return it.bounds.expand(tol).contains(pt) ? it : null;
    if (LV.isPathItem(it)) {
      const hasFill = it.hasFill(), hs = it.hasStroke();
      const r = it.hitTest(pt, { fill: hasFill, stroke: true, tolerance: Math.max(tol, hs ? it.strokeWidth / 2 * (LV.width ? LV.width.maxRatio(it) : 1) : 0), segments: leaf });
      if (!r && it.clipMask && leaf && it.hitTest(pt, { stroke: true, tolerance: tol })) return it;
      return r ? it : null;
    }
    return null;
  };
  const iso = LV.isoRoot();
  if (iso) { for (let j = iso.children.length - 1; j >= 0; j--) { const h = test(iso.children[j]); if (h && (!filter || filter(h))) return h; } return null; }
  const ls = P.project.layers;
  for (let i = ls.length - 1; i >= 0; i--) {
    const L = ls[i]; if (!L.visible || L.locked) continue;
    for (let j = L.children.length - 1; j >= 0; j--) {
      const h = test(L.children[j]);
      if (h && (!filter || filter(h))) return h;
    }
  }
  return null;
};

/* ---------------- paint (fill/stroke specs) ---------------- */
// spec: null | css string | {type:'linear'|'radial', stops:[[css, offset]], angle}
LV.isGrad = s => s && typeof s === 'object';
LV.specToColor = (spec, bounds) => {
  if (!spec) return null;
  if (!LV.isGrad(spec)) return new P.Color(spec);
  const b = bounds || new P.Rectangle(0, 0, 100, 100), c = b.center;
  const stops = spec.stops.map(s => new P.GradientStop(new P.Color(s[0]), s[1]));
  if (spec.type === 'radial') {
    return new P.Color({ gradient: { stops, radial: true }, origin: c, destination: c.add([Math.max(b.width, b.height) / 2, 0]) });
  }
  const a = (spec.angle || 0) * Math.PI / 180, dir = new P.Point(Math.cos(a), Math.sin(a));
  const len = Math.abs(b.width * dir.x) + Math.abs(b.height * dir.y) || 1;
  return new P.Color({ gradient: { stops }, origin: c.subtract(dir.multiply(len / 2)), destination: c.add(dir.multiply(len / 2)) });
};
LV.css = col => col ? (col.alpha < 1 ? col.toCSS(false) : col.toCSS(true)) : null;
LV.colorToSpec = col => {
  if (!col) return null;
  if (col.type === 'gradient') {
    const v = col.destination.subtract(col.origin);
    return { type: col.gradient.radial ? 'radial' : 'linear', stops: col.gradient.stops.map(s => [LV.css(s.color), LV.round(s.offset ?? 0, 4)]), angle: LV.round(v.angle, 2) };
  }
  return LV.css(col);
};
// paint spec from an untrusted file: css colour string or {type, angle, stops:[[css, offset]]}
LV.sanitizeSpec = s => {
  const col = c => { try { return LV.css(new P.Color(String(c))) || '#000000'; } catch (e) { return '#000000'; } };
  if (s == null) return null;
  if (typeof s === 'string') return col(s);
  if (typeof s === 'object' && Array.isArray(s.stops) && s.stops.length >= 2) return { type: s.type === 'radial' ? 'radial' : 'linear', angle: isFinite(+s.angle) ? +s.angle : 0, stops: s.stops.slice(0, 64).map(st => [col(Array.isArray(st) ? st[0] : '#000'), Math.min(1, Math.max(0, +(Array.isArray(st) ? st[1] : 0) || 0))]) };
  return null;
};
LV.hex = css => { try { const c = new P.Color(css); return c.toCSS(true); } catch (e) { return '#000000'; } };
LV.paintTargets = it => {      // the items that actually carry the paint for an object
  const k = LV.kind(it);
  if (k === 'symbol' || k === 'trace') return [];
  if (k === 'blend') return it.children.filter(c => c.data.role === 'blendKey').flatMap(LV.paintTargets);
  if (k === 'repeat' || k === 'warp') return it.children.filter(c => c.data.role === 'repeatSrc' || c.data.role === 'warpSrc').flatMap(LV.paintTargets);
  if (k === 'areatext') return [it.children.find(c => c.data.role === 'text')].filter(Boolean);
  if (k === 'pathtext') return [it.children.find(c => c.data.role === 'glyphs')].filter(Boolean);
  if (it instanceof P.Group || it instanceof P.Layer) { const out = []; it.children.forEach(c => { if (!c.clipMask) out.push(...LV.paintTargets(c)); }); return out; }
  return [it];
};
LV.firstPaintable = it => LV.paintTargets(it)[0] || null;
LV.setPaint = (it, attr, spec) => {
  LV.paintTargets(it).forEach(t => {
    if (attr === 'fill') t.fillColor = LV.specToColor(spec, t.bounds);
    else { t.strokeColor = LV.specToColor(spec, t.strokeBounds || t.bounds); if (spec && !t.strokeWidth) t.strokeWidth = 1; }
    if (LV.kind(it) === 'pathtext') it.data.fill = LV.colorToSpec(t.fillColor);
  });
};
LV.setStyle = (it, key, val) => LV.paintTargets(it).forEach(t => {
  if (key === 'strokeAlign') t.data.strokeAlign = val; else t[key] = val;
});
LV.applyDefaultPaint = (it, { noFill } = {}) => {
  it.fillColor = noFill ? null : LV.specToColor(LV.paint.fill, it.bounds);
  it.strokeColor = LV.specToColor(LV.paint.stroke, it.bounds);
  it.strokeWidth = LV.paint.strokeWidth;
  return it;
};

/* ---------------- selection ---------------- */
LV.setSel = (items, segs) => {
  LV.sel = (items || []).filter(Boolean);
  if (!segs) LV.selSegs.clear(); else LV.selSegs = new Set(segs);
  if (LV.sel.length && LV.doc) { const i = LV.boardAt(LV.selBounds().center); if (i >= 0 && i !== LV.doc.active) { LV.doc.active = i; LV.emit('changed'); } } // like Illustrator: selecting art activates its artboard
  LV.redraw(); LV.emit('selection');
};
LV.addSel = it => { if (!LV.sel.includes(it)) LV.setSel([...LV.sel, it], [...LV.selSegs]); };
LV.toggleSel = it => LV.sel.includes(it) ? LV.setSel(LV.sel.filter(x => x !== it)) : LV.addSel(it);
LV.pruneSel = () => { const ok = LV.sel.filter(it => it.parent && it.project && LV.ancestorsOk(it)); if (ok.length !== LV.sel.length) LV.setSel(ok); };

/* ---------------- document ---------------- */
LV.PRESETS = [
  ['A4 (595 × 842)', 595, 842], ['A4 landscape', 842, 595], ['Letter (612 × 792)', 612, 792], ['Tabloid (792 × 1224)', 792, 1224],
  ['HD 1920 × 1080', 1920, 1080], ['4K 3840 × 2160', 3840, 2160], ['Instagram post 1080 × 1080', 1080, 1080], ['Instagram portrait 1080 × 1350', 1080, 1350],
  ['Instagram story 1080 × 1920', 1080, 1920], ['Business card 252 × 144', 252, 144], ['Icon 16', 16, 16], ['Icon 32', 32, 32], ['Icon 64', 64, 64], ['Icon 128', 128, 128], ['Icon 256', 256, 256], ['Icon 512', 512, 512], ['Icon 1024', 1024, 1024]
];
LV.DEFAULT_SWATCHES = ['#ffffff', '#000000', '#e6e6e6', '#b3b3b3', '#808080', '#4d4d4d', '#ff1d25', '#ff7b00', '#ffc300', '#fff200', '#8cc63f', '#22b573', '#00a99d', '#29abe2', '#0071bc', '#2e3192', '#662d91', '#93278f', '#d4145a', '#ed1e79', '#f7931e', '#c69c6d', '#8c6239', '#603813', '#1d2733', '#33475b', '#5d7fa3', '#a7c4e0', '#f4d6c6', '#ffe8a3',
  { type: 'linear', angle: 0, stops: [['#ffffff', 0], ['#000000', 1]] }, { type: 'linear', angle: 0, stops: [['#ff7b00', 0], ['#ff1d25', 1]] }, { type: 'linear', angle: 90, stops: [['#29abe2', 0], ['#2e3192', 1]] },
  { type: 'linear', angle: 0, stops: [['#8cc63f', 0], ['#00a99d', 1]] }, { type: 'radial', stops: [['#fff200', 0], ['#f7931e', 1]] }, { type: 'linear', angle: 45, stops: [['#ed1e79', 0], ['#662d91', 0.5], ['#29abe2', 1]] }];
LV.newDoc = ({ w = 1080, h = 1080, name = 'Untitled-1', boardName = 'Artboard 1' } = {}) => {
  P.project.clear();
  new P.Layer({ name: 'Layer 1' });
  LV.doc = { name, path: null, artboards: [{ id: Aero.uid(), name: boardName, x: 0, y: 0, w, h }], active: 0, guides: { x: [], y: [] }, swatches: LV.DEFAULT_SWATCHES.slice(), symbols: [] };
  LV.setSel([]);
  LV.hist.reset('New Document', LV.snapshot());
  Aero.setDoc(name, false);
  LV.fitBoard(); LV.emit('changed');
};
LV.board = () => LV.doc.artboards[LV.doc.active] || LV.doc.artboards[0];
LV.boardRect = ab => new P.Rectangle(ab.x, ab.y, ab.w, ab.h);
LV.boardAt = pt => { for (let i = LV.doc.artboards.length - 1; i >= 0; i--) { const a = LV.doc.artboards[i]; if (LV.boardRect(a).contains(pt)) return i; } return -1; };
LV.activeLayer = () => { let L = P.project.activeLayer; if (!L || !L.parent) { L = P.project.layers[P.project.layers.length - 1] || new P.Layer({ name: 'Layer 1' }); L.activate(); } if (L.locked || !L.visible) { const ok = P.project.layers.slice().reverse().find(l => !l.locked && l.visible); if (ok) { ok.activate(); L = ok; } } return L; };
LV.insert = it => { LV.activeLayer().addChild(it); LV.uidOf(it); return it; };

/* ---------------- history ---------------- */
LV.snapshot = () => JSON.stringify({ ab: LV.doc.artboards, active: LV.doc.active, guides: LV.doc.guides, swatches: LV.doc.swatches, symbols: LV.doc.symbols || [], layers: JSON.parse(P.project.exportJSON()), activeLayer: P.project.activeLayer ? P.project.activeLayer.index : 0 });
LV.restore = (s, { keepSel = true } = {}) => {
  const st = JSON.parse(s), uids = keepSel ? LV.sel.map(it => it.data.uid) : [];
  LV.doc.artboards = st.ab; LV.doc.active = Math.min(st.active, st.ab.length - 1); LV.doc.guides = st.guides || { x: [], y: [] }; LV.doc.swatches = st.swatches || LV.DEFAULT_SWATCHES.slice(); LV.doc.symbols = st.symbols || [];
  P.project.clear();
  P.project.importJSON(st.layers);
  if (!P.project.layers.length) new P.Layer({ name: 'Layer 1' });
  (P.project.layers[st.activeLayer] || P.project.layers[P.project.layers.length - 1]).activate();
  LV.tool?.reset?.();
  const items = uids.length ? P.project.getItems({ match: it => uids.includes(it.data && it.data.uid) }) : [];
  LV.setSel(items);
  LV.redraw(); LV.emit('changed');
};
LV.hist = new Aero.History({ max: 80, onChange: () => LV.emit('history') });
LV.commit = label => {
  LV.emit('precommit');
  LV.hist.push(label, LV.snapshot());
  LV.pruneSel(); LV.redraw(); LV.emit('changed');
};
LV.undo = () => { if (LV.textEditing) LV.endTextEdit(); const s = LV.hist.undo(); if (s) LV.restore(s); };
LV.redo = () => { const s = LV.hist.redo(); if (s) LV.restore(s); };

/* ---------------- view ---------------- */
LV.zoomAt = (factor, viewPt) => {
  const v = P.view, z = Aero.clamp(v.zoom * factor, 0.02, 64); factor = z / v.zoom;
  const c = viewPt ? v.viewToProject(viewPt) : v.center;
  v.scale(factor, c); LV.redraw(); LV.emit('view');
};
LV.setZoom = (z, center) => { const v = P.view; v.zoom = Aero.clamp(z, 0.02, 64); if (center) v.center = center; LV.redraw(); LV.emit('view'); };
LV.fitRect = (r, pad = 40) => {
  const v = P.view, vs = v.viewSize; if (!r || !vs.width) return;
  const z = Math.min((vs.width - pad * 2) / Math.max(r.width, 1), (vs.height - pad * 2) / Math.max(r.height, 1));
  v.zoom = Aero.clamp(z, 0.02, 64); v.center = r.center; LV.redraw(); LV.emit('view');
};
LV.fitBoard = () => LV.fitRect(LV.boardRect(LV.board()));
LV.fitAll = () => { let r = null; LV.doc.artboards.forEach(a => { const b = LV.boardRect(a); r = r ? r.unite(b) : b; }); LV.fitRect(r); };
LV.pan = (dx, dy) => { P.view.translate(new P.Point(dx, dy).divide(P.view.zoom)); LV.redraw(); LV.emit('view'); };
