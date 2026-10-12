'use strict';
/* Lumen Vector — Appearance & Effects: extra fills/strokes per object and non-destructive raster effects
   (drop shadow, inner/outer glow, gaussian blur, feather). Rendered live on canvas (also used by PNG export),
   exported to SVG as <filter> chains and rasterised for PDF.
   Model: item.data.fx = { extra:[{kind:'fill'|'stroke', paint:spec, opacity, width, above, on}],
                           shadow:{on,x,y,blur,color,opacity}, innerGlow:{on,blur,color,opacity}, outerGlow:{…},
                           blur:{on,radius}, feather:{on,radius} }  — always replaced, never mutated in place. */
(function () {
  const FX = LV.fx = {};
  const SVGNS = 'http://www.w3.org/2000/svg';
  FX.EFFECTS = {
    shadow: { name: 'Drop Shadow', def: { on: true, x: 7, y: 7, blur: 5, color: '#000000', opacity: 0.75 } },
    innerGlow: { name: 'Inner Glow', def: { on: true, blur: 5, color: '#ffffff', opacity: 0.75 } },
    outerGlow: { name: 'Outer Glow', def: { on: true, blur: 8, color: '#ffd36e', opacity: 0.75 } },
    blur: { name: 'Gaussian Blur', def: { on: true, radius: 4 } },
    feather: { name: 'Feather', def: { on: true, radius: 6 } }
  };
  FX.KEYS = Object.keys(FX.EFFECTS);
  FX.get = it => (it && it._data && it._data.fx) || null;
  FX.set = (it, fx) => { const clean = FX.prune(fx); if (clean) it.data.fx = clean; else delete it.data.fx; };
  FX.prune = fx => { if (!fx) return null; const o = {}; if (fx.extra && fx.extra.length) o.extra = fx.extra; FX.KEYS.forEach(k => { if (fx[k]) o[k] = fx[k]; }); return Object.keys(o).length ? o : null; };
  FX.canExtra = it => LV.isPathItem(it) && !(it.parent instanceof P.CompoundPath) && !it.clipMask;
  const on = e => e && e.on !== false;
  const rasterOn = fx => fx && FX.KEYS.some(k => on(fx[k]));
  FX.hasRaster = it => rasterOn(FX.get(it));
  FX.hasAny = it => { const fx = FX.get(it); return !!(fx && (rasterOn(fx) || (fx.extra || []).some(on))); };
  // how far (document units, parent space) the appearance reaches beyond the stroke bounds
  FX.margin = fx => {
    let m = 0; if (!fx) return 0;
    (fx.extra || []).forEach(e => { if (on(e) && e.kind === 'stroke') m = Math.max(m, (+e.width || 0) / 2); });
    if (on(fx.shadow)) m = Math.max(m, Math.max(Math.abs(fx.shadow.x), Math.abs(fx.shadow.y)) + fx.shadow.blur * 1.5 + 2);
    if (on(fx.outerGlow)) m = Math.max(m, fx.outerGlow.blur * 1.5 + 2);
    if (on(fx.innerGlow)) m = Math.max(m, fx.innerGlow.blur * 1.5 + 2);
    if (on(fx.feather)) m = Math.max(m, fx.feather.radius * 1.5 + 2);
    if (on(fx.blur)) m = Math.max(m, fx.blur.radius * 3 + 2);
    return m + 2;
  };
  // sanitize effect data from an opened (untrusted) file
  FX.sanitize = fx => {
    if (!fx || typeof fx !== 'object') return undefined;
    const n = (v, lo, hi, def) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; };
    const col = c => { try { return LV.css(new P.Color(String(c || '#000'))) || '#000000'; } catch (e) { return '#000000'; } };
    const o = {};
    if (Array.isArray(fx.extra)) o.extra = fx.extra.slice(0, 32).filter(e => e && (e.kind === 'fill' || e.kind === 'stroke')).map(e => ({ kind: e.kind, paint: LV.sanitizeSpec(e.paint), opacity: n(e.opacity, 0, 1, 1), width: n(e.width, 0, 1000, 1), above: !!e.above, on: e.on !== false }));
    FX.KEYS.forEach(k => {
      const e = fx[k]; if (!e || typeof e !== 'object') return; const d = FX.EFFECTS[k].def, x = { on: e.on !== false };
      Object.keys(d).forEach(key => { if (key === 'on') return; x[key] = key === 'color' ? col(e[key]) : n(e[key], key === 'x' || key === 'y' ? -1000 : 0, key === 'opacity' ? 1 : 1000, d[key]); });
      o[k] = x;
    });
    return FX.prune(o) || undefined;
  };

  /* ---------- extra fills / strokes (drawn inside the path's own _draw) ---------- */
  function drawExtras(ctx, item, list) {
    if (!list.length) return;
    const p2d = new Path2D(item.getPathData(null, 4)), rule = item.getFillRule();
    list.forEach(e => {
      if (!e.paint) return;
      const col = LV.specToColor(e.paint, e.kind === 'stroke' ? item.strokeBounds : item.bounds); if (!col) return;
      ctx.save(); ctx.globalAlpha *= e.opacity ?? 1;
      if (e.kind === 'fill') { ctx.fillStyle = col.toCanvasStyle(ctx); ctx.fill(p2d, rule); }
      else if (e.width > 0) {
        ctx.strokeStyle = col.toCanvasStyle(ctx); ctx.lineWidth = e.width; ctx.lineJoin = item.strokeJoin || 'miter'; ctx.lineCap = item.strokeCap || 'butt'; ctx.miterLimit = item.miterLimit || 10;
        ctx.setLineDash([]); ctx.stroke(p2d);
      }
      ctx.restore();
    });
  }
  [P.Path.prototype, P.CompoundPath.prototype].forEach(proto => {
    const orig = proto._draw;
    proto._draw = function (ctx, param, viewMatrix, strokeMatrix) {
      const fx = this._data && this._data.fx, ex = fx && fx.extra;
      if (!ex || !ex.length || param.clip || param.dontFinish || strokeMatrix) return orig.call(this, ctx, param, viewMatrix, strokeMatrix);
      drawExtras(ctx, this, ex.filter(e => on(e) && !e.above));
      orig.call(this, ctx, param, viewMatrix, strokeMatrix);
      drawExtras(ctx, this, ex.filter(e => on(e) && e.above));
    };
  });

  /* ---------- raster effects: offscreen compositing in device pixels ---------- */
  const pool = [];
  const canvasN = (i, w, h) => { let c = pool[i]; if (!c) c = pool[i] = document.createElement('canvas'); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } const g = c.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.filter = 'none'; g.clearRect(0, 0, w, h); return [c, g]; };
  // pipeline on a device canvas `src` (content already drawn). s = device px per document unit, lin = linear map for offsets.
  FX.process = (fx, src, W, H, s, lin, base = 1) => {
    const [cA, gA] = canvasN(base, W, H); gA.drawImage(src, 0, 0); // working copy of the content
    if (on(fx.innerGlow)) {
      const e = fx.innerGlow, [cM, gM] = canvasN(base + 1, W, H), [cG, gG] = canvasN(base + 2, W, H);
      gM.fillStyle = e.color; gM.fillRect(0, 0, W, H); gM.globalCompositeOperation = 'destination-out'; gM.drawImage(cA, 0, 0);
      gG.filter = `blur(${Math.max(0.01, e.blur / 2 * s)}px)`; gG.drawImage(cM, 0, 0); gG.filter = 'none';
      gG.globalCompositeOperation = 'destination-in'; gG.drawImage(cA, 0, 0);
      gA.globalCompositeOperation = 'source-atop'; gA.globalAlpha = e.opacity; gA.drawImage(cG, 0, 0); gA.globalAlpha = 1; gA.globalCompositeOperation = 'source-over';
    }
    if (on(fx.feather)) {
      const [cF, gF] = canvasN(base + 1, W, H); gF.filter = `blur(${Math.max(0.01, fx.feather.radius / 2 * s)}px)`; gF.drawImage(cA, 0, 0); gF.filter = 'none';
      gA.globalCompositeOperation = 'destination-in'; gA.drawImage(cF, 0, 0); gA.globalCompositeOperation = 'source-over';
    }
    let content = cA;
    if (on(fx.blur)) { const [cB, gB] = canvasN(base + 2, W, H); gB.filter = `blur(${Math.max(0.01, fx.blur.radius * s)}px)`; gB.drawImage(cA, 0, 0); content = cB; }
    const [cS, gS] = canvasN(base + 3, W, H);
    const silhouette = (e, dx, dy) => {
      const [cT, gT] = canvasN(base + 4, W, H); gT.filter = `blur(${Math.max(0.01, e.blur / 2 * s)}px)`; gT.drawImage(content, dx, dy); gT.filter = 'none';
      gT.globalCompositeOperation = 'source-in'; gT.fillStyle = e.color; gT.fillRect(0, 0, W, H);
      gS.globalAlpha = e.opacity; gS.drawImage(cT, 0, 0); gS.globalAlpha = 1;
    };
    if (on(fx.outerGlow)) silhouette(fx.outerGlow, 0, 0);
    if (on(fx.shadow)) { const v = lin(fx.shadow.x, fx.shadow.y); silhouette(fx.shadow, v.x, v.y); }
    gS.drawImage(content, 0, 0);
    return cS;
  };
  const MAXPX = 4096 * 4096;
  const origDraw = P.Item.prototype.draw;
  P.Item.prototype.draw = function (ctx, param, psm) {
    const fx = this._data && this._data.fx;
    if (!fx || param.clip || param.fxBusy || !this._visible || this._opacity === 0) return origDraw.call(this, ctx, param, psm);
    const raster = rasterOn(fx), extras = (fx.extra || []).some(on);
    if (!raster && !(extras && (this._opacity < 1 || this._blendMode !== 'normal'))) return origDraw.call(this, ctx, param, psm);
    const T = ctx.getTransform(), M = this._matrix;
    const sb = this.getStrokeBounds(); if (!sb || (!sb.width && !sb.height)) return origDraw.call(this, ctx, param, psm);
    const s = Math.sqrt(Math.abs(T.a * T.d - T.b * T.c)) || 1, mg = FX.margin(fx);
    const r = sb.expand(mg * 2), cw = ctx.canvas.width, ch = ctx.canvas.height, pad = mg * s + 4;
    const q = [r.topLeft, r.topRight, r.bottomRight, r.bottomLeft].map(p => ({ x: T.a * p.x + T.c * p.y + T.e, y: T.b * p.x + T.d * p.y + T.f }));
    const x0 = Math.floor(Math.max(-pad, Math.min(...q.map(p => p.x)))), y0 = Math.floor(Math.max(-pad, Math.min(...q.map(p => p.y))));
    const x1 = Math.ceil(Math.min(cw + pad, Math.max(...q.map(p => p.x)))), y1 = Math.ceil(Math.min(ch + pad, Math.max(...q.map(p => p.y))));
    const W = x1 - x0, H = y1 - y0; if (W <= 0 || H <= 0) return;
    if (W * H > MAXPX) return origDraw.call(this, ctx, param, psm);
    // draw the item itself (opaque, normal blend) into an offscreen canvas that shares the device pixel grid
    const own = document.createElement('canvas'); own.width = W; own.height = H; const g0 = own.getContext('2d');
    g0.setTransform(T.a, T.b, T.c, T.d, T.e - x0, T.f - y0);
    const op = this._opacity, bm = this._blendMode, prevOff = param.offset, pr = param.pixelRatio || 1;
    param.offset = (prevOff || new P.Point(0, 0)).add(new P.Point(x0 / pr, y0 / pr));
    this._opacity = 1; this._blendMode = 'normal';
    try { origDraw.call(this, g0, param, psm); } finally { this._opacity = op; this._blendMode = bm; param.offset = prevOff; }
    const out = raster ? FX.process(fx, own, W, H, s, (x, y) => ({ x: T.a * x + T.c * y, y: T.b * x + T.d * y }), 0) : own;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = op; ctx.globalCompositeOperation = bm === 'normal' ? 'source-over' : bm;
    ctx.drawImage(out, x0, y0); ctx.restore();
  };

  /* ---------- rasterise an item with its effects (PDF export, Expand Appearance) ---------- */
  FX.rasterize = (item, scale = 2) => {
    const fx = FX.get(item), b = item.getStrokeBounds().expand(FX.margin(fx) * 2), tl = b.topLeft.floor(), br = b.bottomRight.ceil(), sz = br.subtract(tl);
    const W = Math.max(1, Math.ceil(sz.x * scale)), H = Math.max(1, Math.ceil(sz.y * scale)); if (W * H > MAXPX) return null;
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const m = new P.Matrix().scale(scale).translate(tl.negate()); g.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty);
    const bm = item.blendMode; item._blendMode = 'normal';
    try { item.draw(g, new P.Base({ matrices: [m], pixelRatio: 1 })); } finally { item._blendMode = bm; }
    const r = new P.Raster({ insert: false }); r.setImage(c);
    r.matrix = new P.Matrix().translate(tl.add(sz.divide(2))).scale(1 / scale); r.blendMode = bm;
    return r;
  };

  /* ---------- SVG export ---------- */
  // ctx: { defs: [], n } shared during one export; returns the node to use in place of `node`
  FX.svgWrap = (item, node, ectx) => {
    const fx = FX.get(item); if (!fx || !FX.hasAny(item)) return node;
    const g = document.createElementNS(SVGNS, 'g'), ex = (fx.extra || []).filter(on);
    const paintAttr = (spec, b) => {
      if (!LV.isGrad(spec)) { const c = new P.Color(spec); return { v: c.toCSS(true), a: c.alpha }; }
      const col = LV.specToColor(spec, b), gr = document.createElementNS(SVGNS, spec.type === 'radial' ? 'radialGradient' : 'linearGradient'), id = 'lvgrad' + (++ectx.n);
      gr.setAttribute('id', id); gr.setAttribute('gradientUnits', 'userSpaceOnUse');
      const o = col.origin, d = col.destination;
      if (spec.type === 'radial') { gr.setAttribute('cx', o.x); gr.setAttribute('cy', o.y); gr.setAttribute('r', o.getDistance(d)); }
      else { gr.setAttribute('x1', o.x); gr.setAttribute('y1', o.y); gr.setAttribute('x2', d.x); gr.setAttribute('y2', d.y); }
      spec.stops.forEach(([c, off]) => { const st = document.createElementNS(SVGNS, 'stop'), pc = new P.Color(c); st.setAttribute('offset', off); st.setAttribute('stop-color', pc.toCSS(true)); if (pc.alpha < 1) st.setAttribute('stop-opacity', pc.alpha); gr.appendChild(st); });
      ectx.defs.push(gr); return { v: `url(#${id})`, a: 1 };
    };
    const extraNode = e => {
      const n = node.cloneNode(true); n.removeAttribute('id');
      const pa = paintAttr(e.paint, e.kind === 'stroke' ? item.strokeBounds : item.bounds);
      if (e.kind === 'fill') { n.setAttribute('fill', pa.v); if (pa.a < 1) n.setAttribute('fill-opacity', pa.a); n.setAttribute('stroke', 'none'); }
      else { n.setAttribute('fill', 'none'); n.setAttribute('stroke', pa.v); if (pa.a < 1) n.setAttribute('stroke-opacity', pa.a); n.setAttribute('stroke-width', e.width); n.setAttribute('stroke-dasharray', 'none'); }
      if ((e.opacity ?? 1) < 1) n.setAttribute('opacity', e.opacity);
      return n;
    };
    if (FX.canExtra(item)) ex.filter(e => !e.above && e.paint).forEach(e => g.appendChild(extraNode(e)));
    g.appendChild(node);
    if (FX.canExtra(item)) ex.filter(e => e.above && e.paint).forEach(e => g.appendChild(extraNode(e)));
    if (rasterOn(fx)) {
      const id = 'lvfx' + (++ectx.n), f = document.createElementNS(SVGNS, 'filter'), r = item.strokeBounds.expand(FX.margin(fx) * 2);
      [['id', id], ['filterUnits', 'userSpaceOnUse'], ['x', r.x], ['y', r.y], ['width', r.width], ['height', r.height], ['color-interpolation-filters', 'sRGB']].forEach(([k, v]) => f.setAttribute(k, v));
      const P_ = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v)); f.appendChild(e); return e; };
      let cur = 'SourceGraphic';
      if (on(fx.innerGlow)) {
        const e = fx.innerGlow;
        P_('feFlood', { 'flood-color': new P.Color(e.color).toCSS(true), 'flood-opacity': 1, result: 'igF' });
        P_('feComposite', { in: 'igF', in2: 'SourceAlpha', operator: 'out', result: 'igInv' });
        P_('feGaussianBlur', { in: 'igInv', stdDeviation: e.blur / 2, result: 'igB' });
        P_('feComposite', { in: 'igB', in2: 'SourceAlpha', operator: 'in', result: 'igIn' });
        const ct = P_('feComponentTransfer', { in: 'igIn', result: 'igA' }); const fa = document.createElementNS(SVGNS, 'feFuncA'); fa.setAttribute('type', 'linear'); fa.setAttribute('slope', e.opacity); ct.appendChild(fa);
        P_('feComposite', { in: 'igA', in2: cur, operator: 'atop', result: 'c1' }); cur = 'c1';
      }
      if (on(fx.feather)) { P_('feGaussianBlur', { in: cur, stdDeviation: fx.feather.radius / 2, result: 'fB' }); P_('feComposite', { in: cur, in2: 'fB', operator: 'in', result: 'c2' }); cur = 'c2'; }
      if (on(fx.blur)) { P_('feGaussianBlur', { in: cur, stdDeviation: fx.blur.radius, result: 'c3' }); cur = 'c3'; }
      const merge = [];
      const sil = (e, dx, dy, tag) => {
        P_('feGaussianBlur', { in: cur, stdDeviation: e.blur / 2, result: tag + 'B' });
        if (dx || dy) P_('feOffset', { in: tag + 'B', dx, dy, result: tag + 'O' });
        P_('feFlood', { 'flood-color': new P.Color(e.color).toCSS(true), 'flood-opacity': e.opacity, result: tag + 'F' });
        P_('feComposite', { in: tag + 'F', in2: dx || dy ? tag + 'O' : tag + 'B', operator: 'in', result: tag });
        merge.push(tag);
      };
      if (on(fx.outerGlow)) sil(fx.outerGlow, 0, 0, 'og');
      if (on(fx.shadow)) sil(fx.shadow, fx.shadow.x, fx.shadow.y, 'sh');
      merge.push(cur);
      const fm = P_('feMerge', {}); merge.forEach(m => { const mn = document.createElementNS(SVGNS, 'feMergeNode'); mn.setAttribute('in', m); fm.appendChild(mn); });
      ectx.defs.push(f); g.setAttribute('filter', `url(#${id})`);
    }
    return g;
  };

  /* ---------- operations (menus / Appearance panel) ---------- */
  const targets = () => LV.sel.filter(Boolean);
  FX.addExtra = kind => {
    const ts = targets().filter(FX.canExtra); if (!ts.length) return LV.toast('Select a path or shape to add a ' + kind);
    ts.forEach(it => {
      const fx = FX.get(it) || {}, base = LV.colorToSpec(kind === 'fill' ? it.fillColor : it.strokeColor);
      const e = kind === 'fill' ? { kind, paint: base || '#ffd36e', opacity: 0.6, above: true, on: true } : { kind, paint: base || '#1d2733', width: Math.max(2, (it.strokeWidth || 1) * 3), opacity: 1, above: false, on: true };
      FX.set(it, { ...fx, extra: [...(fx.extra || []), e] });
    });
    LV.commit(kind === 'fill' ? 'Add New Fill' : 'Add New Stroke');
  };
  FX.clear = () => { const ts = targets().filter(FX.get); if (!ts.length) return LV.toast('The selection has no extra appearance'); ts.forEach(it => delete it.data.fx); LV.commit('Clear Appearance'); };
  FX.setEffect = (it, key, val) => { const fx = { ...(FX.get(it) || {}) }; if (val) fx[key] = val; else delete fx[key]; FX.set(it, fx); };
  FX.setExtra = (it, i, val) => { const fx = { ...(FX.get(it) || {}) }, ex = (fx.extra || []).slice(); if (val) ex[i] = val; else ex.splice(i, 1); fx.extra = ex; FX.set(it, fx); };
  FX.moveExtra = (it, i, dir) => { const fx = { ...(FX.get(it) || {}) }, ex = (fx.extra || []).slice(), j = i + dir; if (j < 0 || j >= ex.length) return; [ex[i], ex[j]] = [ex[j], ex[i]]; fx.extra = ex; FX.set(it, fx); };
  const effFields = (key, e) => {
    const pct = v => v + '%', F = [];
    if (key === 'shadow') F.push({ key: 'x', label: 'X offset', type: 'number', value: e.x, step: 1 }, { key: 'y', label: 'Y offset', type: 'number', value: e.y, step: 1 });
    if ('blur' in e) F.push({ key: 'blur', label: 'Blur', type: 'range', min: 0, max: 100, step: 0.5, value: e.blur });
    if ('radius' in e) F.push({ key: 'radius', label: 'Radius', type: 'range', min: 0, max: 100, step: 0.5, value: e.radius });
    if ('color' in e) F.push({ key: 'color', label: 'Color', type: 'color', value: LV.hex(e.color) }, { key: 'opacity', label: 'Opacity', type: 'range', min: 0, max: 100, value: Math.round(e.opacity * 100), fmt: pct });
    return F;
  };
  FX.effectDialog = (key, items = targets()) => {
    if (!items.length) return LV.toast('Select an object first');
    const before = items.map(it => it.data.fx), cur = (FX.get(items[0]) || {})[key] || FX.EFFECTS[key].def;
    const build = v => { const e = { ...FX.EFFECTS[key].def, ...cur, on: true }; Object.keys(v).forEach(k => { if (k === 'opacity') e.opacity = v.opacity / 100; else if (k === 'color') e.color = v.color; else if (isFinite(v[k])) e[k] = +v[k]; }); return e; };
    const apply = v => { items.forEach(it => FX.setEffect(it, key, build(v))); LV.redraw(); };
    Aero.dialog({
      title: FX.EFFECTS[key].name, instruction: 'Non-destructive effect — edit or remove it later in the Appearance section of the Properties panel.', fields: effFields(key, cur),
      onChange: apply, onOK: v => { apply(v); LV.commit(FX.EFFECTS[key].name); },
      onCancel: () => { items.forEach((it, i) => { if (before[i]) it.data.fx = before[i]; else delete it.data.fx; }); LV.redraw(); }
    });
  };
  FX.extraDialog = (it, i) => {
    const fx = FX.get(it), e = fx && fx.extra[i]; if (!e) return; const before = fx;
    const g = LV.isGrad(e.paint), c1 = g ? e.paint.stops[0][0] : e.paint || '#000000', c2 = g ? e.paint.stops[e.paint.stops.length - 1][0] : '#000000';
    const fields = [{ key: 't', label: 'Paint', type: 'select', value: g ? e.paint.type : 'solid', options: [['solid', 'Color'], ['linear', 'Linear gradient'], ['radial', 'Radial gradient']] },
      { key: 'c1', label: 'Color', type: 'color', value: LV.hex(c1) }, { key: 'c2', label: 'Gradient end color', type: 'color', value: LV.hex(c2) }, { key: 'ang', label: 'Gradient angle', type: 'number', value: g ? e.paint.angle || 0 : 90 },
      { key: 'op', label: 'Opacity', type: 'range', min: 0, max: 100, value: Math.round((e.opacity ?? 1) * 100), fmt: v => v + '%' }];
    if (e.kind === 'stroke') fields.push({ key: 'w', label: 'Weight', type: 'number', value: e.width, min: 0, step: 0.5 });
    fields.push({ key: 'pos', label: 'Stacking', type: 'select', value: e.above ? 'above' : 'below', options: [['below', 'Below the object\'s own fill & stroke'], ['above', 'Above the object\'s own fill & stroke']] });
    const build = v => ({ ...e, paint: v.t === 'solid' ? v.c1 : (g && e.paint.stops.length > 2 && v.t === e.paint.type ? { ...e.paint, angle: v.ang } : { type: v.t, angle: v.ang, stops: [[v.c1, 0], [v.c2, 1]] }), opacity: v.op / 100, width: e.kind === 'stroke' ? Math.max(0, +v.w || 0) : e.width, above: v.pos === 'above' });
    Aero.dialog({ title: e.kind === 'fill' ? 'Edit Fill' : 'Edit Stroke', fields, onChange: v => { FX.setExtra(it, i, build(v)); LV.redraw(); }, onOK: v => { FX.setExtra(it, i, build(v)); LV.commit(e.kind === 'fill' ? 'Edit Fill' : 'Edit Stroke'); }, onCancel: () => { it.data.fx = before; LV.redraw(); } });
  };
  // Expand Appearance: extra fills/strokes become real paths; raster effects become an image
  FX.expand = () => {
    const ts = targets().filter(FX.hasAny); if (!ts.length) return LV.toast('The selection has no appearance to expand');
    const out = [];
    ts.forEach(it => {
      const fx = FX.get(it); let res = it;
      if ((fx.extra || []).some(on) && FX.canExtra(it)) {
        const mk = e => { const c = it.clone({ insert: false }); delete c.data.fx; delete c.data.live; c.opacity = e.opacity ?? 1; c.blendMode = 'normal'; c.dashArray = []; if (e.kind === 'fill') { c.fillColor = LV.specToColor(e.paint, c.bounds); c.strokeColor = null; } else { c.fillColor = null; c.strokeColor = LV.specToColor(e.paint, c.strokeBounds); c.strokeWidth = e.width; } c.name = e.kind === 'fill' ? 'Fill' : 'Stroke'; return LV.reUid(c); };
        const base = it.clone({ insert: false }); delete base.data.fx; base.opacity = 1; base.blendMode = 'normal'; LV.reUid(base);
        const g = new P.Group({ insert: false, children: [...fx.extra.filter(e => on(e) && !e.above).map(mk), base, ...fx.extra.filter(e => on(e) && e.above).map(mk)] });
        g.name = it.name || 'Expanded Appearance'; g.opacity = it.opacity; g.blendMode = it.blendMode; LV.uidOf(g);
        const rest = { ...fx }; delete rest.extra; FX.set(g, rest);
        g.insertAbove(it); it.remove(); res = g;
      }
      if (FX.hasRaster(res)) { const r = FX.rasterize(res, 2); if (r) { r.name = (res.name || 'Object') + ' (expanded)'; r.insertAbove(res); res.remove(); LV.reUid(r); res = r; } }
      out.push(res);
    });
    LV.setSel(out); LV.commit('Expand Appearance');
  };
})();
