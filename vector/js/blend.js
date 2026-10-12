'use strict';
/* Lumen Vector — Blends: live shape + colour interpolation between two or more paths.
   Group data.kind 'blend', data.blend = { mode:'smooth'|'steps'|'distance', steps, dist, sig };
   children (bottom → top): key0, steps(0→1), key1, steps(1→2), key2 … — keys keep role 'blendKey', generated
   intermediates live in groups with role 'blendSteps' and are rebuilt whenever a key changes (checked on commit). */
(function () {
  const BL = LV.blend = {};
  BL.defaults = { mode: 'steps', steps: 6, dist: 20 };
  BL.keys = g => g.children.filter(c => c.data.role === 'blendKey');
  BL.sanitize = b => { const n = (v, lo, hi, d) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; }; b = b && typeof b === 'object' ? b : {}; return { mode: ['smooth', 'steps', 'distance'].includes(b.mode) ? b.mode : 'steps', steps: Math.round(n(b.steps, 1, 500, 6)), dist: n(b.dist, 0.5, 1e5, 20), align: !!b.align }; };
  BL.spine = g => g.children.find(c => c.data.role === 'blendSpine') || null;

  /* ---------- geometry ---------- */
  const subpaths = it => it instanceof P.CompoundPath ? it.children.slice() : [it];
  const equalize = (p, n) => { let guard = 0; while (p.segments.length < n && guard++ < 5000) { const c = p.curves.reduce((a, b) => b.length > a.length ? b : a); c.divideAtTime(0.5); } return p; };
  const segData = p => p.segments.map(s => [s.point.x, s.point.y, s.handleIn.x, s.handleIn.y, s.handleOut.x, s.handleOut.y]);
  // make two subpaths structurally compatible: same anchor count, same direction, matched start point
  function pairUp(a, b) {
    const A = a.clone({ insert: false }), B = b.clone({ insert: false });
    if (A.closed && B.closed && A.clockwise !== B.clockwise) B.reverse();
    const n = Math.max(A.segments.length, B.segments.length); equalize(A, n); equalize(B, n);
    let da = segData(A), db = segData(B);
    if (A.closed && B.closed && n > 1) {
      const ca = A.bounds.center, cb = B.bounds.center; let best = 0, bd = Infinity;
      for (let k = 0; k < n; k++) { let d = 0; for (let i = 0; i < n; i++) { const p = da[i], q = db[(i + k) % n]; d += (p[0] - ca.x - (q[0] - cb.x)) ** 2 + (p[1] - ca.y - (q[1] - cb.y)) ** 2; } if (d < bd) { bd = d; best = k; } }
      if (best) db = db.slice(best).concat(db.slice(0, best));
    }
    return { da, db, closed: A.closed || B.closed };
  }
  const collapsed = p => { const c = p.clone({ insert: false }); c.scale(1e-4, p.bounds.center); return c; };
  function shapePairs(A, B) {
    const sa = subpaths(A), sb = subpaths(B), n = Math.max(sa.length, sb.length), out = [];
    for (let i = 0; i < n; i++) { const a = sa[i] || collapsed(sb[i]), b = sb[i] || collapsed(sa[i]); out.push(pairUp(a, b)); }
    return out;
  }
  const lerp = (a, b, t) => a + (b - a) * t;
  /* ---------- colour ---------- */
  const solidOf = c => c ? (c.type === 'gradient' ? c.gradient.stops[0].color : c) : null;
  function lerpColor(ca, cb, t, ia, ib) {
    if (!ca && !cb) return null;
    const ga = ca && ca.type === 'gradient', gb = cb && cb.type === 'gradient';
    if (ga || gb) {
      const sa = ga ? LV.colorToSpec(ca) : null, sb = gb ? LV.colorToSpec(cb) : null;
      const base = sa || sb, stopsA = sa ? sa.stops : base.stops.map(s => [LV.css(ca || new P.Color(0, 0, 0, 0)), s[1]]), stopsB = sb ? sb.stops : base.stops.map(s => [LV.css(cb || new P.Color(0, 0, 0, 0)), s[1]]);
      if (stopsA.length === stopsB.length && (!sa || !sb || sa.type === sb.type)) {
        const spec = { type: base.type, angle: lerp(sa ? sa.angle || 0 : sb.angle || 0, sb ? sb.angle || 0 : sa.angle || 0, t), stops: stopsA.map((s, i) => [LV.css(mix(new P.Color(s[0]), new P.Color(stopsB[i][0]), t)), lerp(s[1], stopsB[i][1], t)]) };
        return { spec };
      }
      ca = solidOf(ca); cb = solidOf(cb);
    }
    const a = ca || new P.Color(cb.red, cb.green, cb.blue, 0), b = cb || new P.Color(ca.red, ca.green, ca.blue, 0);
    return { color: mix(a, b, t) };
  }
  const mix = (a, b, t) => new P.Color(lerp(a.red, b.red, t), lerp(a.green, b.green, t), lerp(a.blue, b.blue, t), lerp(a.alpha, b.alpha, t));
  const colorDelta = (ca, cb) => { const a = solidOf(ca), b = solidOf(cb); if (!a && !b) return 0; const x = a || new P.Color(0, 0, 0, 0), y = b || new P.Color(0, 0, 0, 0); return Math.max(Math.abs(x.red - y.red), Math.abs(x.green - y.green), Math.abs(x.blue - y.blue), Math.abs(x.alpha - y.alpha)) * 255; };

  BL.stepsFor = (A, B, o) => {
    const d = A.bounds.center.getDistance(B.bounds.center);
    if (o.mode === 'steps') return Math.max(1, Math.min(500, o.steps | 0));
    if (o.mode === 'distance') return Math.max(0, Math.min(500, Math.floor(d / Math.max(0.5, o.dist)) - 1));
    const cd = Math.max(colorDelta(A.fillColor, B.fillColor), colorDelta(A.strokeColor, B.strokeColor));
    return Math.max(1, Math.min(256, Math.round(cd > 4 ? cd : d / 4)));
  };
  BL.interp = (A, B, pairs, t) => {
    const paths = pairs.map(({ da, db, closed }) => new P.Path({ insert: false, closed, segments: da.map((p, i) => { const q = db[i]; return new P.Segment(new P.Point(lerp(p[0], q[0], t), lerp(p[1], q[1], t)), new P.Point(lerp(p[2], q[2], t), lerp(p[3], q[3], t)), new P.Point(lerp(p[4], q[4], t), lerp(p[5], q[5], t))); }) }));
    const it = paths.length > 1 ? new P.CompoundPath({ children: paths, insert: false, fillRule: A.fillRule }) : paths[0];
    const f = lerpColor(A.fillColor, B.fillColor, t), s = lerpColor(A.strokeColor, B.strokeColor, t);
    it.fillColor = f ? (f.spec ? LV.specToColor(f.spec, it.bounds) : f.color) : null;
    it.strokeColor = s ? (s.spec ? LV.specToColor(s.spec, it.strokeBounds) : s.color) : null;
    it.strokeWidth = lerp(A.hasStroke() ? A.strokeWidth : B.strokeWidth, B.hasStroke() ? B.strokeWidth : A.strokeWidth, t);
    it.strokeJoin = A.strokeJoin; it.strokeCap = A.strokeCap; it.dashArray = t < 0.5 ? A.dashArray : B.dashArray;
    it.opacity = lerp(A.opacity, B.opacity, t);
    return it;
  };
  const sigOf = (g, o) => { const sp = BL.spine(g); return JSON.stringify([o.mode, o.steps, o.dist, o.align, sp && sp.exportJSON({ asString: false, precision: 3 }), BL.keys(g).map(k => k.exportJSON({ asString: false, precision: 3 }))]); };
  // spine: the first/last keys stay attached to the spine's end points (moving such a key moves the end point);
  // middle keys are spread evenly along the spine
  const syncSpine = (g, sp) => {
    const keys = BL.keys(g), n = keys.length, L = sp.length; if (n < 2 || !(L > 0)) return;
    const first = keys[0].bounds.center, last = keys[n - 1].bounds.center;
    if (!sp.closed) {
      if (first.getDistance(sp.firstSegment.point) > 0.01) sp.firstSegment.point = first;
      if (last.getDistance(sp.lastSegment.point) > 0.01) sp.lastSegment.point = last;
    }
    for (let i = sp.closed ? 0 : 1; i < (sp.closed ? n : n - 1); i++) { const want = sp.getPointAt(sp.length * i / (sp.closed ? n : n - 1)); keys[i].translate(want.subtract(keys[i].bounds.center)); }
  };
  BL.placeOnSpine = g => { const sp = BL.spine(g), keys = BL.keys(g), n = keys.length; if (!sp) return; const den = sp.closed ? n : n - 1; keys.forEach((k, i) => k.translate(sp.getPointAt(Math.min(sp.length, sp.length * i / den)).subtract(k.bounds.center))); };
  BL.regen = (g, force) => {
    const o0 = BL.sanitize(g.data.blend), sp = BL.spine(g); if (sp) syncSpine(g, sp);
    const o = o0, sig = sigOf(g, o);
    if (!force && g.data.blend && g.data.blend.sig === sig && g.children.some(c => c.data.role === 'blendSteps')) return false;
    g.children.filter(c => c.data.role === 'blendSteps').forEach(c => c.remove());
    const keys = BL.keys(g);
    for (let i = 0; i < keys.length - 1; i++) {
      const A = keys[i], B = keys[i + 1], n = BL.stepsFor(A, B, o), pairs = shapePairs(A, B), sg = new P.Group({ insert: false, data: { role: 'blendSteps' } });
      const den = sp ? (sp.closed ? keys.length : keys.length - 1) : 1, cA = A.bounds.center, cB = B.bounds.center;
      const tangA = sp ? sp.getTangentAt(Math.min(sp.length, sp.length * i / den)).angle : 0, tangB = sp ? sp.getTangentAt(Math.min(sp.length, sp.length * (i + 1) / den)).angle : 0;
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1), it = BL.interp(A, B, pairs, t);
        if (sp) { // follow the spine instead of the straight line between the keys
          const off = Math.min(sp.length, sp.length * (i + t) / den), p = sp.getPointAt(off), lin = cA.add(cB.subtract(cA).multiply(t));
          it.translate(p.subtract(lin));
          if (o.align) { let dA = tangB - tangA; dA = ((dA + 540) % 360) - 180; const rot = sp.getTangentAt(off).angle - (tangA + dA * t); it.rotate(((rot + 540) % 360) - 180, p); }
        }
        sg.addChild(it);
      }
      sg.insertAbove(A);
    }
    g.data.blend = { ...o, sig };
    return true;
  };
  BL.regenAll = () => P.project.getItems({ match: it => it.data && it.data.kind === 'blend' }).forEach(g => { try { BL.regen(g); } catch (e) { console.warn('blend', e); } });

  /* ---------- commands ---------- */
  const blendable = it => LV.isPathItem(it) && !it.clipMask && !(it.parent instanceof P.CompoundPath) && (it instanceof P.Path ? it.segments.length > 1 : it.children.length);
  BL.make = (items = LV.sortZ(LV.sel), opts) => {
    items = items.filter(blendable);
    if (items.length < 2) { LV.toast('Select two or more paths or shapes to blend'); return null; }
    const g = new P.Group({ insert: false, data: { kind: 'blend', blend: { ...BL.sanitize(opts || BL.last || BL.defaults) } } }); g.name = 'Blend';
    g.insertAbove(items[items.length - 1]);
    items.forEach(it => { delete it.data.live; it.data.role = 'blendKey'; g.addChild(it); });
    BL.regen(g, true); LV.uidOf(g); LV.setSel([g]); LV.commit('Make Blend'); return g;
  };
  const selBlends = () => LV.sel.filter(it => LV.kind(it) === 'blend');
  BL.release = () => {
    const bs = selBlends(); if (!bs.length) return LV.toast('Select a blend');
    const out = [];
    bs.forEach(g => { const keys = BL.keys(g), sp = BL.spine(g); if (sp) { delete sp.data.role; sp.strokeColor = '#1d2733'; sp.strokeWidth = 1; keys.unshift(sp); } keys.forEach(k => { delete k.data.role; }); g.parent.insertChildren(g.index, keys); out.push(...keys); g.remove(); });
    LV.setSel(out); LV.commit('Release Blend');
  };
  BL.expandOne = g => {
    BL.regen(g); const sp = BL.spine(g); if (sp) sp.remove();
    g.children.slice().forEach(c => { if (c.data.role === 'blendSteps') { const kids = c.removeChildren(); g.insertChildren(c.index, kids); c.remove(); } else delete c.data.role; });
    delete g.data.kind; delete g.data.blend; g.name = 'Expanded Blend'; g.children.forEach(c => LV.reUid(c)); return g;
  };
  BL.expand = () => { const bs = selBlends(); if (!bs.length) return LV.toast('Select a blend'); LV.setSel(bs.map(BL.expandOne)); LV.commit('Expand Blend'); };
  BL.reverse = () => {
    const bs = selBlends(); if (!bs.length) return LV.toast('Select a blend');
    bs.forEach(g => { const keys = BL.keys(g); g.children.filter(c => c.data.role === 'blendSteps').forEach(c => c.remove()); keys.reverse().forEach(k => g.addChild(k)); BL.regen(g, true); });
    LV.commit('Reverse Blend');
  };
  // Replace Spine: select a blend and a path; the path becomes the blend's spine
  BL.replaceSpine = () => {
    const g = selBlends()[0], path = LV.sel.find(it => it instanceof P.Path && LV.kind(it) !== 'blend' && it.segments.length > 1);
    if (!g || !path) return LV.toast('Select a blend and a path to use as its spine');
    const old = BL.spine(g); if (old) old.remove();
    const sp = path.clone({ insert: false }); sp.fillColor = null; sp.strokeColor = null; sp.data = { role: 'blendSpine' }; LV.uidOf(sp);
    g.insertChild(0, sp); path.remove(); BL.placeOnSpine(g); BL.regen(g, true);
    LV.setSel([g]); LV.commit('Replace Spine');
  };
  BL.reverseSpine = () => {
    const bs = selBlends().filter(BL.spine); if (!bs.length) return LV.toast('Select a blend that has a spine (Replace Spine first)');
    bs.forEach(g => { BL.spine(g).reverse(); BL.placeOnSpine(g); BL.regen(g, true); });
    LV.commit('Reverse Spine');
  };
  BL.optionsDialog = () => {
    const bs = selBlends(), cur = bs.length ? BL.sanitize(bs[0].data.blend) : BL.sanitize(BL.last || BL.defaults), before = bs.map(g => g.data.blend);
    const apply = v => { const o = BL.sanitize({ mode: v.mode, steps: v.steps, dist: v.dist, align: v.align === 'path' }); bs.forEach(g => { g.data.blend = { ...o }; BL.regen(g, true); }); LV.redraw(); return o; };
    Aero.dialog({
      title: 'Blend Options', instruction: bs.length ? 'Changes preview live on the canvas.' : 'Options for new blends (no blend selected).',
      fields: [{ key: 'mode', label: 'Spacing', type: 'select', value: cur.mode, options: [['smooth', 'Smooth Color'], ['steps', 'Specified Steps'], ['distance', 'Specified Distance']] }, { key: 'steps', label: 'Steps', type: 'number', min: 1, max: 500, value: cur.steps }, { key: 'dist', label: 'Distance', type: 'number', min: 0.5, value: cur.dist }, { key: 'align', label: 'Orientation', type: 'select', value: cur.align ? 'path' : 'page', options: [['page', 'Align to Page'], ['path', 'Align to Path']] }],
      onChange: v => { if (bs.length) apply(v); },
      onOK: v => { const o = bs.length ? apply(v) : BL.sanitize({ ...v, align: v.align === 'path' }); BL.last = o; if (bs.length) LV.commit('Blend Options'); },
      onCancel: () => { bs.forEach((g, i) => { g.data.blend = before[i]; BL.regen(g, true); }); LV.redraw(); }
    });
  };
  LV.on('precommit', BL.regenAll);
})();
