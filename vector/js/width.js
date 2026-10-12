'use strict';
/* Lumen Vector — variable-width strokes (Width tool + width profiles).
   Model: path.data.width = { pts: [{ t, l, r }] } — t is the position along the path (0..1 of its length),
   l / r are the widths on the left / right side as multiples of half the stroke weight (1 = normal weight),
   so changing the stroke weight scales the whole profile. The stroke is drawn as a filled outline; exports
   (SVG / PDF) and Outline Stroke use the same outline, the .lvec keeps the editable width points. */
(function () {
  const W = LV.width = {};
  W.PROFILES = {
    uniform: { name: 'Uniform', pts: null },
    bulge: { name: 'Bulge', pts: [{ t: 0, l: 0.15, r: 0.15 }, { t: 0.5, l: 1.8, r: 1.8 }, { t: 1, l: 0.15, r: 0.15 }] },
    taperStart: { name: 'Taper start', pts: [{ t: 0, l: 0, r: 0 }, { t: 0.4, l: 1, r: 1 }, { t: 1, l: 1, r: 1 }] },
    taperEnd: { name: 'Taper end', pts: [{ t: 0, l: 1, r: 1 }, { t: 0.6, l: 1, r: 1 }, { t: 1, l: 0, r: 0 }] },
    taperBoth: { name: 'Taper both ends', pts: [{ t: 0, l: 0, r: 0 }, { t: 0.5, l: 1.2, r: 1.2 }, { t: 1, l: 0, r: 0 }] },
    wedge: { name: 'Wedge', pts: [{ t: 0, l: 2, r: 2 }, { t: 1, l: 0, r: 0 }] }
  };
  W.get = it => { const w = it && it._data && it._data.width; return w && Array.isArray(w.pts) && w.pts.length ? w : null; };
  W.active = it => it instanceof P.Path && !!W.get(it) && it.hasStroke() && it.segments.length > 1;
  W.set = (it, pts) => {
    if (!pts || !pts.length) delete it.data.width;
    else it.data.width = { pts: pts.map(p => ({ t: Math.min(1, Math.max(0, +p.t)), l: Math.max(0, +p.l), r: Math.max(0, +p.r) })).sort((a, b) => a.t - b.t) };
    it._changed(9); // bounds caches include the variable width
  };
  W.sanitize = w => {
    if (!w || typeof w !== 'object' || !Array.isArray(w.pts)) return undefined;
    const n = (v, lo, hi, d) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    const pts = w.pts.slice(0, 200).filter(p => p && typeof p === 'object').map(p => ({ t: n(p.t, 0, 1, 0), l: n(p.l, 0, 100, 1), r: n(p.r, 0, 100, 1) })).sort((a, b) => a.t - b.t);
    return pts.length ? { pts } : undefined;
  };
  W.maxRatio = it => { const w = W.get(it); return w ? Math.max(1e-9, ...w.pts.map(p => Math.max(p.l, p.r))) : 1; };
  // smooth (ease-in-out) interpolation between width points
  W.valueAt = (pts, t, closed) => {
    if (!pts.length) return { l: 1, r: 1 };
    if (pts.length === 1) return { l: pts[0].l, r: pts[0].r };
    const ease = (a, b, u) => { const s = u * u * (3 - 2 * u); return { l: a.l + (b.l - a.l) * s, r: a.r + (b.r - a.r) * s }; };
    const first = pts[0], last = pts[pts.length - 1];
    if (closed) {
      if (t < first.t || t > last.t) { const span = first.t + 1 - last.t, u = span > 1e-9 ? ((t < first.t ? t + 1 : t) - last.t) / span : 0; return ease(last, first, u); }
    } else { if (t <= first.t) return { l: first.l, r: first.r }; if (t >= last.t) return { l: last.l, r: last.r }; }
    for (let i = 0; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; if (t >= a.t && t <= b.t) return ease(a, b, b.t - a.t > 1e-9 ? (t - a.t) / (b.t - a.t) : 0); }
    return { l: last.l, r: last.r };
  };
  // outline of the variable-width stroke, in the path's own coordinates
  const cache = new WeakMap();
  W.outline = path => {
    const w = W.get(path), sw = path.strokeWidth || 0; if (!w || !(sw > 0) || path.segments.length < 2) return null;
    const key = path._version + '|' + path.segments.length + '|' + path.closed + '|' + sw + '|' + path.strokeCap + '|' + JSON.stringify(w.pts) + '|' + path.firstSegment.point + path.lastSegment.point;
    const hit = cache.get(path); if (hit && hit.key === key) return hit.out;
    const L = path.length; if (!(L > 0)) return null;
    const closed = path.closed, n = Math.max(24, Math.min(1500, Math.ceil(L / 2))), hw = sw / 2;
    // sample at regular spacing plus exactly at every anchor (keeps corners crisp)
    const offs = new Set(); for (let i = 0; i <= n; i++) offs.add(L * i / n);
    let acc = 0; path.curves.forEach(c => { acc += c.length; if (acc < L - 1e-6) { offs.add(Math.max(0, acc - 1e-3)); offs.add(Math.min(L, acc + 1e-3)); } });
    const list = [...offs].sort((a, b) => a - b).filter((v, i, a) => !i || v - a[i - 1] > 1e-6);
    if (closed && L - list[list.length - 1] < 1e-6) list.pop();
    const left = [], right = [];
    list.forEach(off => {
      const p = path.getPointAt(off), nv = path.getNormalAt(off); if (!p || !nv) return;
      const v = W.valueAt(w.pts, off / L, closed);
      left.push(p.add(nv.multiply(v.l * hw))); right.push(p.subtract(nv.multiply(v.r * hw)));
    });
    let out;
    if (closed) {
      out = new P.CompoundPath({ children: [new P.Path({ segments: left, closed: true, insert: false }), new P.Path({ segments: right.reverse(), closed: true, insert: false })], insert: false, fillRule: 'evenodd' });
    } else {
      const cap = path.strokeCap, ring = [...left];
      const capPts = (atEnd) => {
        const off = atEnd ? L : 0, p = path.getPointAt(off), tan = path.getTangentAt(off).multiply(atEnd ? 1 : -1), v = W.valueAt(w.pts, atEnd ? 1 : 0, false), r = (v.l + v.r) / 2 * hw;
        const from = atEnd ? left[left.length - 1] : right[0], to = atEnd ? right[right.length - 1] : left[0], o = [];
        if (cap === 'round' && r > 1e-6) { const nv = path.getNormalAt(off), u = atEnd ? nv : nv.negate(); for (let k = 1; k < 12; k++) { const th = Math.PI * k / 12; o.push(p.add(u.multiply(Math.cos(th) * r)).add(tan.multiply(Math.sin(th) * r))); } }
        else if (cap === 'square') { o.push(from.add(tan.multiply(r)), to.add(tan.multiply(r))); }
        return o;
      };
      ring.push(...capPts(true)); ring.push(...right.slice().reverse()); ring.push(...capPts(false));
      out = new P.Path({ segments: ring, closed: true, insert: false });
    }
    cache.set(path, { key, out }); return out;
  };
  // a filled replacement (for exports and Outline Stroke): fill copy + outlined stroke
  W.expand = path => {
    const o = W.outline(path); if (!o) return null;
    const stroke = o.clone({ insert: false }); stroke.fillColor = path.strokeColor; stroke.strokeColor = null; stroke.name = 'Outlined Stroke';
    if (!path.hasFill()) { stroke.opacity = path.opacity; stroke.blendMode = path.blendMode; return stroke; }
    const f = path.clone({ insert: false }); f.strokeColor = null; delete f.data.width; f.opacity = 1; f.blendMode = 'normal';
    const g = new P.Group({ insert: false, children: [f, stroke] }); g.opacity = path.opacity; g.blendMode = path.blendMode; g.name = path.name || 'Outlined';
    return g;
  };

  /* ---------- rendering: fill the outline instead of stroking ---------- */
  const origDraw = P.Path.prototype._draw;
  P.Path.prototype._draw = function (ctx, param, viewMatrix, strokeMatrix) {
    if (!W.get(this) || param.clip || param.dontFinish || strokeMatrix || !this.hasStroke()) return origDraw.call(this, ctx, param, viewMatrix, strokeMatrix);
    const o = W.outline(this); if (!o) return origDraw.call(this, ctx, param, viewMatrix, strokeMatrix);
    ctx.stroke = function () { }; // suppress the uniform stroke
    try { origDraw.call(this, ctx, param, viewMatrix, strokeMatrix); } finally { delete ctx.stroke; }
    const col = this.strokeColor; ctx.save(); ctx.fillStyle = col.toCanvasStyle(ctx); ctx.fill(new Path2D(o.pathData), o instanceof P.CompoundPath ? 'evenodd' : 'nonzero'); ctx.restore();
  };
  // stroke bounds grow with the widest width point (selection, export culling, offscreen compositing)
  const origBounds = P.Path.prototype._getBounds;
  P.Path.prototype._getBounds = function (matrix, options) {
    const r = origBounds.call(this, matrix, options);
    if (options && options.stroke && W.get(this) && this.hasStroke()) { const extra = (W.maxRatio(this) - 1) * this.strokeWidth / 2; if (extra > 0) { const s = matrix ? Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c)) : 1; return r.expand(extra * 2 * s); } }
    return r;
  };

  /* ---------- profiles ---------- */
  W.profileOf = it => {
    const w = W.get(it); if (!w) return 'uniform';
    const k = Object.keys(W.PROFILES).find(k => W.PROFILES[k].pts && JSON.stringify(W.PROFILES[k].pts) === JSON.stringify(w.pts));
    return k || 'custom';
  };
  W.applyProfile = (items, key, flip) => {
    const ps = items.flatMap(it => LV.leaves(it)).filter(p => p instanceof P.Path && p.segments.length > 1);
    if (!ps.length) return LV.toast('Select a stroked path');
    const pr = W.PROFILES[key]; if (!pr) return;
    ps.forEach(p => { if (!p.hasStroke()) { p.strokeColor = LV.specToColor(LV.paint.stroke || '#1d2733'); p.strokeWidth = Math.max(p.strokeWidth, 4); } W.set(p, pr.pts ? pr.pts.map(q => flip ? { t: 1 - q.t, l: q.r, r: q.l } : { ...q }) : null); });
    LV.commit('Width Profile');
  };
})();
