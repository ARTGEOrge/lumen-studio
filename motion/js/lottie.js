'use strict';
/* Lumen Motion — Lottie (Bodymovin JSON) export for shape, text, solid, image, null and precomp layers:
   transforms with easing & spatial tangents, shape groups / repeaters / trim paths / gradients / merge paths,
   text with range-selector animators, masks, track mattes, parenting, blend modes and time remapping.
   Expressions are baked to per-frame keyframes. Unsupported features are listed as warnings. */
(function () {
  const LM = window.LM, { val } = LM;
  const r3 = v => Math.round(v * 1000) / 1000;
  const rgb = h => { const c = LM.hex2rgb(h); return [r3(c[0] / 255), r3(c[1] / 255), r3(c[2] / 255), 1]; };
  const BM = { normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5, 'color-dodge': 6, 'color-burn': 7, 'hard-light': 8, 'soft-light': 9, difference: 10, exclusion: 11, hue: 12, saturation: 13, color: 14, luminosity: 15, add: 16 };
  const TT = { alpha: 1, alphaInv: 2, luma: 3, lumaInv: 4 };
  const pathK = p => ({ c: !!p.c, v: p.pts.map(q => [r3(q[0]), r3(q[1])]), i: p.pts.map(q => [r3(q[2]), r3(q[3])]), o: p.pts.map(q => [r3(q[4]), r3(q[5])]) });
  const arr = v => Array.isArray(v) ? v : [v];
  const fill = (x, n) => new Array(n).fill(r3(x));

  LM.exportLottie = (comp, opts = {}) => {
    const warnings = new Set(), assets = [], fonts = new Map(), fps = comp.fps;
    const warn = w => warnings.add(w);

    // property → Lottie animatable value. conv: our value → Lottie value (number, array or shape)
    function prop(p, L, conv, o = {}) {
      const off = L ? L.start : 0;
      if (LM.hasExpr(p) && LM.exprState.enabled && !LM.exprBlocked(p)) return bake(p, L, conv, o);
      if (!LM.animated(p)) return { a: 0, k: conv(p.v) };
      const k = p.k, out = [];
      for (let i = 0; i < k.length; i++) {
        const a = k[i], b = k[i + 1], kv = conv(a.v), item = { t: r3((a.t + off) * fps), s: o.shape ? [kv] : arr(kv) };
        if (b) {
          if (a.o === 'hold') item.h = 1;
          else {
            const c = LM.segCtrl(a, b), n = o.shape ? 1 : arr(kv).length;
            item.o = { x: fill(c[0], n), y: fill(c[1], n) }; item.i = { x: fill(c[2], n), y: fill(c[3], n) };
            if (o.spatial) { item.to = [r3(a.so?.[0] || 0), r3(a.so?.[1] || 0), 0]; item.ti = [r3(b.si?.[0] || 0), r3(b.si?.[1] || 0), 0]; }
          }
        }
        out.push(item);
      }
      return { a: 1, k: out };
    }
    // expressions: sample every frame of the layer
    function bake(p, L, conv, o) {
      const f0 = Math.floor((L ? L.in : 0) * fps), f1 = Math.ceil((L ? L.out : comp.duration) * fps), out = [];
      for (let f = f0; f <= f1; f++) { const kv = conv(val(p, f / fps)), n = o.shape ? 1 : arr(kv).length; out.push({ t: f, s: o.shape ? [kv] : arr(kv), o: { x: fill(0, n), y: fill(0, n) }, i: { x: fill(1, n), y: fill(1, n) } }); }
      return { a: 1, k: out };
    }
    const num = v => r3(v), v2 = v => [r3(v[0]), r3(v[1])], v3 = v => [r3(v[0]), r3(v[1]), 0], sc = v => [r3(v[0]), r3(v[1]), 100], col = v => rgb(v);
    const transform = (T, L, extra = {}) => Object.assign({ a: prop(T.anchor, L, v3), p: prop(T.position, L, v3, { spatial: true }), s: prop(T.scale, L, sc), r: prop(T.rotation, L, num), o: prop(T.opacity, L, num) }, extra);

    /* ---- shapes ---- */
    function geo(S, L) {
      const k = S.kind;
      if (k === 'rect') return { ty: 'rc', nm: 'Rectangle Path', d: 1, p: { a: 0, k: [0, 0] }, s: prop(S.size, L, v2), r: prop(S.roundness, L, num) };
      if (k === 'ellipse') return { ty: 'el', nm: 'Ellipse Path', d: 1, p: { a: 0, k: [0, 0] }, s: prop(S.size, L, v2) };
      if (k === 'path') return { ty: 'sh', nm: 'Path', d: 1, ks: prop(S.path, L, pathK, { shape: true }) };
      const g = { ty: 'sr', nm: 'Polystar Path', d: 1, sy: k === 'star' ? 1 : 2, pt: prop(S.points, L, num), p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 }, or: prop(S.outer, L, num), os: prop(S.roundness, L, num) };
      if (k === 'star') { g.ir = prop(S.inner, L, num); g.is = prop(S.roundness, L, num); }
      return g;
    }
    function gradient(P, L) {
      if (LM.animated(P.color) || LM.animated(P.c2) || LM.hasExpr(P.color)) warn('Animated gradient colors are exported at their first value');
      const a = rgb(val(P.color, L.start)), b = rgb(val(P.c2, L.start));
      return { s: prop(P.gs, L, v2), e: prop(P.ge, L, v2), t: P.gtype === 'radial' ? 2 : 1, g: { p: 2, k: { a: 0, k: [0, a[0], a[1], a[2], 1, b[0], b[1], b[2]] } }, h: { a: 0, k: 0 }, a: { a: 0, k: 0 } };
    }
    const LC = { butt: 1, round: 2, square: 3 }, LJ = { miter: 1, round: 2, bevel: 3 };
    function styles(S, L, merged) {
      const out = [];
      const St = S.stroke, Fi = S.fill;
      if (St.on) {
        const base = { o: prop(St.opacity, L, num), w: prop(St.width, L, num), lc: LC[St.cap] || 2, lj: LJ[St.join] || 2, ml: 4 };
        out.push(St.gtype !== 'solid' ? Object.assign({ ty: 'gs', nm: 'Gradient Stroke' }, base, gradient(St, L)) : Object.assign({ ty: 'st', nm: 'Stroke', c: prop(St.color, L, col) }, base));
      }
      if (Fi.on) out.push(Fi.gtype !== 'solid' ? Object.assign({ ty: 'gf', nm: 'Gradient Fill', o: prop(Fi.opacity, L, num), r: 1 }, gradient(Fi, L)) : { ty: 'fl', nm: 'Fill', c: prop(Fi.color, L, col), o: prop(Fi.opacity, L, num), r: 1 });
      void merged; return out;
    }
    const trim = (S, L) => { const T = S.trim; if (!LM.animated(T.start) && !LM.animated(T.end) && !LM.animated(T.offset) && T.start.v === 0 && T.end.v === 100 && T.offset.v === 0) return []; return [{ ty: 'tm', nm: 'Trim Paths', s: prop(T.start, L, num), e: prop(T.end, L, num), o: prop(T.offset, L, num), m: 1 }]; };
    const idTr = (o = {}) => Object.assign({ ty: 'tr', nm: 'Transform', a: { a: 0, k: [0, 0] }, p: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } }, o);
    const repeater = (R, L) => ({ ty: 'rp', nm: 'Repeater', c: prop(R.copies, L, num), o: prop(R.offset, L, num), m: R.comp === 'above' ? 1 : 2, tr: { ty: 'tr', a: prop(R.anchor, L, v2), p: prop(R.position, L, v2), s: prop(R.scale, L, v2), r: prop(R.rotation, L, num), so: prop(R.so, L, num), eo: prop(R.eo, L, num) } });
    function shapeContents(L) {
      const S = L.shape, merged = S.merge !== 'off', items = [];
      const MM = { add: 2, subtract: 3, intersect: 4, exclude: 5 };
      LM.shapeOrder(S).forEach(e => {
        if (e.root) { items.push({ ty: 'gr', nm: 'Shape 1', it: [geo(S, L), ...trim(S, L), ...(merged ? [] : styles(S, L)), idTr()] }); return; }
        const g = e.g; if (g.on === false) return;
        const gt = { ty: 'tr', nm: 'Transform', a: prop(g.gt.anchor, L, v2), p: prop(g.gt.position, L, v2), s: prop(g.gt.scale, L, v2), r: prop(g.gt.rotation, L, num), o: prop(g.gt.opacity, L, num), sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } };
        const body = [geo(g, L), ...trim(g, L), ...(merged ? [] : styles(g, L))];
        if (g.rep.on) items.push({ ty: 'gr', nm: g.name, it: [{ ty: 'gr', nm: g.name + ' content', it: [...body, idTr()] }, repeater(g.rep, L), gt] });
        else items.push({ ty: 'gr', nm: g.name, it: [...body, gt] });
      });
      let out = items;
      if (merged) { warn('Merge Paths is exported, but many Lottie players do not render it'); out = [{ ty: 'gr', nm: 'Merged', it: [...items, { ty: 'mm', nm: 'Merge Paths', mm: MM[S.merge] || 1 }, ...styles(S, L), idTr()] }]; }
      if (S.rep.on) out = [{ ty: 'gr', nm: 'Contents', it: [...out, idTr()] }, repeater(S.rep, L)];
      return out;
    }

    /* ---- text ---- */
    const SHAPES = { square: 1, rampUp: 2, rampDown: 3, triangle: 4, round: 5, smooth: 6 };
    function textData(L) {
      const T = L.text, style = { 300: 'Light', 400: 'Regular', 600: 'Semibold', 700: 'Bold', 900: 'Black' }[T.weight] || 'Regular', fName = (T.font + '-' + style + (T.italic ? 'Italic' : '')).replace(/\s+/g, '');
      fonts.set(fName, { fName, fFamily: T.font, fStyle: style + (T.italic ? ' Italic' : ''), ascent: 75, fWeight: String(T.weight) });
      ['size', 'fill', 'leading', 'stroke', 'strokeWidth'].forEach(k => { if (LM.animated(T[k]) || LM.hasExpr(T[k])) warn(`Animated text ${k} is exported at its first value`); });
      const t0 = L.start, size = val(T.size, t0);
      const doc = { s: size, f: fName, t: T.str.replace(/\n/g, '\r'), j: { left: 0, right: 1, center: 2 }[T.align] ?? 2, tr: 0, lh: r3(val(T.leading, t0) * size), ls: 0, fc: rgb(val(T.fill, t0)).slice(0, 3) };
      if (T.strokeOn) { doc.sc = rgb(val(T.stroke, t0)).slice(0, 3); doc.sw = val(T.strokeWidth, t0); doc.of = false; }
      const anims = [];
      // tracking is a document property in Lottie; animate it through a full-range animator
      if (LM.animated(T.tracking) || LM.hasExpr(T.tracking) || T.tracking.v) anims.push({ nm: 'Tracking', s: { t: 0, xe: { a: 0, k: 0 }, ne: { a: 0, k: 0 }, a: { a: 0, k: 100 }, b: 1, rn: 0, sh: 1, r: 1, s: { a: 0, k: 0 }, e: { a: 0, k: 100 }, o: { a: 0, k: 0 } }, a: { t: prop(T.tracking, L, num) } });
      T.animators.forEach(A => {
        if (LM.animated(A.blur) || A.blur.v) warn('Text animator blur is not supported by Lottie');
        const a = { p: prop(A.position, L, v3), s: prop(A.scale, L, v => [r3(v), r3(v), 100]), r: prop(A.rotation, L, num), o: prop(A.opacity, L, num) };
        if (A.fillOn) a.fc = prop(A.fill, L, col);
        anims.push({ nm: A.name, s: { t: 0, xe: { a: 0, k: A.sel.smooth ? 0 : 0 }, ne: { a: 0, k: 0 }, a: { a: 0, k: 100 }, b: 1, rn: 0, sh: SHAPES[A.sel.shape] || 1, r: 1, s: prop(A.sel.start, L, num), e: prop(A.sel.end, L, num), o: prop(A.sel.offset, L, num) }, a });
      });
      return { d: { k: [{ s: doc, t: 0 }] }, p: {}, m: { g: 1, a: { a: 0, k: [0, 0] } }, a: anims };
    }

    /* ---- layers ---- */
    const precompIds = new Map();
    function layers(c, depth = 0) {
      const out = [], ind = new Map(c.layers.map((L, i) => [L.id, i + 1]));
      c.layers.forEach((L, i) => {
        const base = { ddd: 0, ind: i + 1, nm: L.name, sr: 1, ao: 0, ip: r3(L.in * c.fps), op: r3(L.out * c.fps), st: r3(L.start * c.fps), bm: BM[L.blend] || 0 };
        if (!L.visible) base.hd = true;
        if (L.parent && ind.has(L.parent)) base.parent = ind.get(L.parent);
        if (L.matte) base.tt = TT[L.matte];
        if (c.layers[i + 1]?.matte) base.td = 1;
        if (L.mb) warn('Motion blur (layer switch / Motion Blur effect) cannot be represented in Lottie');
        const ks = transform(L.tr, L);
        if (LM.is3D(L)) { base.ddd = 1; is3d = true; Object.assign(ks, transform3D(L)); delete ks.r; if (L.type === 'camera') { delete ks.a; delete ks.s; delete ks.o; } }
        let lay = null;
        switch (L.type) {
          case 'shape': lay = Object.assign(base, { ty: 4, ks, shapes: shapeContents(L) }); break;
          case 'text': lay = Object.assign(base, { ty: 5, ks, t: textData(L) }); break;
          case 'solid': if (LM.animated(L.solid.color)) warn('Animated solid colors are exported at their first value'); lay = Object.assign(base, { ty: 1, ks, sc: val(L.solid.color, L.start), sw: L.solid.w, sh: L.solid.h }); break;
          case 'null': lay = Object.assign(base, { ty: 3, ks }); break;
          case 'image': { const a = LM.assets.get(L.asset); if (!a) break; const id = 'img_' + a.id; if (!assets.some(x => x.id === id)) assets.push({ id, w: a.w, h: a.h, u: '', p: a.data, e: 1 }); lay = Object.assign(base, { ty: 2, ks, refId: id }); break; }
          case 'precomp': {
            const sub = LM.compById(L.comp); if (!sub || depth > 10) break;
            let id = precompIds.get(sub.id); if (!id) { id = 'comp_' + sub.id; precompIds.set(sub.id, id); assets.push({ id, nm: sub.name, fr: sub.fps, layers: null }); const lay2 = layers(sub, depth + 1); assets.find(x => x.id === id).layers = lay2; }
            lay = Object.assign(base, { ty: 0, ks, refId: id, w: sub.w, h: sub.h });
            if (L.tm.on) lay.tm = prop(L.tm.p, L, num);
            if (L.fb) warn('Frame blending is not exported');
            break;
          }
          case 'camera': ks.a = prop(L.cam.poi, L, v => [r3(v[0]), r3(v[1]), r3(v[2])]); lay = Object.assign(base, { ty: 13, ks, pe: prop(L.cam.zoom, L, num) }); delete lay.bm; break;
          default: warn(`${({ video: 'Video', audio: 'Audio', adjust: 'Adjustment', draw: 'Drawing (cel)' })[L.type] || L.type} layers cannot be represented in Lottie and were skipped (“${L.name}”)`);
        }
        if (!lay) return;
        const ef = effects(L); if (ef.length) lay.ef = ef;
        const masks = L.masks;
        if (masks.length) { lay.hasMask = true; lay.masksProperties = masks.map(m => ({ inv: !!m.inv, mode: { add: 'a', subtract: 's', intersect: 'i', none: 'n' }[m.mode], pt: prop(m.path, L, pathK, { shape: true }), o: prop(m.opacity, L, num), x: prop(m.expansion, L, num), nm: m.name })); if (masks.some(m => m.feather.v || LM.animated(m.feather))) warn('Mask feather is not supported by most Lottie players'); }
        out.push(lay);
      });
      return out;
    }
    /* ---- effects that Lottie can carry (rendered by the SVG renderer of lottie-web and other full players) ---- */
    const efv = (ty, nm, v, i) => ({ ty, nm, mn: 'ADBE ' + nm, ix: i + 1, v });
    const stat = k => ({ a: 0, k });
    function effects(L) {
      const out = [];
      L.effects.forEach((fx, idx) => {
        if (!fx.on) return;
        const P = k => fx.p[k], pv = (k, conv) => prop(P(k), L, conv);
        let e = null;
        switch (fx.type) {
          case 'fill': e = { ty: 21, nm: 'Fill', ef: [efv(10, 'Fill Mask', stat(0), 0), efv(7, 'All Masks', stat(0), 1), efv(2, 'Color', pv('color', col), 2), efv(7, 'Invert', stat(0), 3), efv(0, 'Horizontal Feather', stat(0), 4), efv(0, 'Vertical Feather', stat(0), 5), efv(0, 'Opacity', pv('opacity', v => r3(v / 100)), 6)] }; break;
          case 'tint': e = { ty: 20, nm: 'Tint', ef: [efv(2, 'Map Black To', pv('black', col), 0), efv(2, 'Map White To', pv('white', col), 1), efv(0, 'Amount to Tint', pv('amount', num), 2)] }; break;
          case 'blur': e = { ty: 29, nm: 'Gaussian Blur', ef: [efv(0, 'Blurriness', pv('amount', num), 0), efv(7, 'Blur Dimensions', stat({ both: 1, h: 2, v: 3 }[P('dir').v] || 1), 1), efv(7, 'Repeat Edge Pixels', stat(0), 2)] }; break;
          case 'shadow': e = { ty: 25, nm: 'Drop Shadow', ef: [efv(2, 'Shadow Color', pv('color', col), 0), efv(0, 'Opacity', pv('opacity', v => r3(v * 2.55)), 1), efv(1, 'Direction', pv('direction', num), 2), efv(0, 'Distance', pv('distance', num), 3), efv(0, 'Softness', pv('softness', num), 4), efv(7, 'Shadow Only', stat(0), 5)] }; break;
          case 'stroke': {
            if (!L.masks.length) { warn(`“${L.name}”: Stroke effect along shape outlines (no masks) cannot be represented; Lottie strokes masks only`); return; }
            const all = P('path').v === 'all';
            e = { ty: 22, nm: 'Stroke', ef: [efv(11, 'Path', stat(all ? 1 : +P('path').v), 0), efv(7, 'All Masks', stat(all ? 1 : 0), 1), efv(7, 'Stroke Sequentially', stat(0), 2), efv(2, 'Color', pv('color', col), 3), efv(0, 'Brush Size', pv('size', v => r3(v / 2)), 4), efv(0, 'Brush Hardness', stat(1), 5), efv(0, 'Opacity', pv('opacity', v => r3(v / 100)), 6), efv(0, 'Start', pv('start', num), 7), efv(0, 'End', pv('end', num), 8), efv(0, 'Spacing', stat(0), 9), efv(7, 'Paint Style', stat({ on: 1, transparent: 2, reveal: 3 }[P('style').v] || 1), 10)] };
            break;
          }
          case 'mblur': warn('Motion blur (layer switch / Motion Blur effect) cannot be represented in Lottie'); return;
          default: warn(`“${L.name}”: effect “${LM.FX[fx.type].name}” has no Lottie equivalent and was skipped`); return;
        }
        usedFx = true;
        out.push(Object.assign({ np: e.ef.length + 2, mn: 'ADBE ' + e.nm, ix: idx + 1, en: 1 }, e));
      });
      return out;
    }
    /* ---- 3D transforms (Lottie 'ddd' layers and cameras) ---- */
    function transform3D(L) {
      const T = L.tr, D2 = LM.animated(T.position) || LM.hasExpr(T.position), DZ = LM.animated(T.posZ) || LM.hasExpr(T.posZ);
      let p;
      if (D2 && DZ) { // both animated: bake [x, y, z] per frame
        const f0 = Math.floor(L.in * fps), f1 = Math.ceil(L.out * fps), k = [];
        for (let f = f0; f <= f1; f++) { const a = val(T.position, f / fps), z = val(T.posZ, f / fps); k.push({ t: f, s: [r3(a[0]), r3(a[1]), r3(z)], o: { x: [0, 0, 0], y: [0, 0, 0] }, i: { x: [1, 1, 1], y: [1, 1, 1] } }); }
        p = { a: 1, k };
      } else if (DZ) { const xy = val(T.position, L.start); p = prop(T.posZ, L, z => [r3(xy[0]), r3(xy[1]), r3(z)]); }
      else { const z = val(T.posZ, L.start); p = prop(T.position, L, v => [r3(v[0]), r3(v[1]), r3(z)], { spatial: true }); }
      return { p, rx: prop(T.rotX, L, num), ry: prop(T.rotY, L, num), rz: prop(T.rotation, L, num), or: { a: 0, k: [0, 0, 0] } };
    }
    let is3d = false, usedFx = false;
    const range = opts.range === 'work' ? [comp.workIn, Math.min(comp.workOut, comp.duration)] : [0, comp.duration];
    const json = { v: '5.7.4', fr: fps, ip: r3(range[0] * fps), op: r3(range[1] * fps), w: comp.w, h: comp.h, nm: comp.name, ddd: 0, assets, layers: layers(comp), markers: [], meta: { g: 'Lumen Motion' } };
    if (fonts.size) json.fonts = { list: [...fonts.values()] };
    if (is3d) { json.ddd = 1; warn('3D layers and cameras are exported as Lottie 3D (ddd) layers; lottie-web shows perspective only with its HTML renderer — the SVG and canvas renderers flatten them'); }
    if (usedFx) warn('Effects were exported as Lottie effects (Fill, Tint, Gaussian Blur, Drop Shadow, Stroke); lottie-web renders them only with its SVG renderer');
    return { json, warnings: [...warnings] };
  };

  LM.lottieDialog = () => {
    const c = LM.comp(); if (!c) return;
    Aero.dialog({
      title: 'Export Lottie JSON', width: 500, ok: 'Export…',
      instruction: `Composition “${c.name}” → Bodymovin/Lottie JSON for web and mobile players`,
      html: '<p class="dnote">Exports shape, text, solid, image, null, precomp, 3D and camera layers with their keyframes (easing and motion paths), shape groups, repeaters, trim paths, gradients, text animators, masks, mattes, parenting and the Fill, Tint, Gaussian Blur, Drop Shadow and Stroke effects. Expressions are baked into keyframes. Anything Lottie cannot hold (video, audio, other effects…) is listed after export.</p>',
      fields: [{ key: 'range', label: 'Range', type: 'select', value: c.workIn > 0 || c.workOut < c.duration ? 'work' : 'all', options: [['work', 'Work area'], ['all', 'Entire composition']] }],
      onOK: async v => {
        const { json, warnings } = LM.exportLottie(c, v);
        const base = c.name.replace(/[\\/:*?"<>|]+/g, '_'), data = JSON.stringify(json);
        const saved = await Aero.saveFile({ name: base + '.json', data, filters: [{ name: 'Lottie JSON', extensions: ['json'] }] });
        if (!saved) return;
        if (warnings.length) Aero.dialog({ title: 'Lottie export', noCancel: true, width: 560, instruction: `Saved ${base}.json (${(data.length / 1024).toFixed(0)} KB). Some parts of this composition cannot be represented in Lottie:`, html: `<ul class="lwarn">${warnings.map(w => '<li>' + Aero.esc(w) + '</li>').join('')}</ul>` });
        else Aero.toast(`Saved ${base}.json (${(data.length / 1024).toFixed(0)} KB)`);
      }
    });
  };
})();
