'use strict';
/* Lumen Motion — document model: compositions, layers, animatable properties, keyframe interpolation,
   expressions hookup, property trees (shared by timeline, inspector and graph editor). */
(function () {
  const LM = window.LM = window.LM || {};
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clone = o => JSON.parse(JSON.stringify(o));
  const isArr = Array.isArray;
  LM.uid = uid; LM.clone = clone;

  /* ---------- colors ---------- */
  function hex2rgb(h) { h = String(h || '#000').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h.slice(0, 6), 16) || 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  function rgb2hex(r, g, b) { const c = v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); return '#' + c(r) + c(g) + c(b); }
  LM.hex2rgb = hex2rgb; LM.rgb2hex = rgb2hex;

  /* ---------- properties ----------
     P = { v: value, k?: [keyframe], x?: expression source }
     keyframe = { t (layer seconds), v, i/o: 'linear'|'ease'|'hold'|'bezier', ei/eo: [influence, y] (temporal bezier),
                  si/so: [dx,dy] spatial tangents (position only) } */
  const P = v => ({ v });
  LM.P = P;
  const animated = p => !!(p && p.k && p.k.length);
  LM.animated = animated;

  function lerp(a, b, s) {
    if (typeof a === 'number') return a + (b - a) * s;
    if (typeof a === 'string') { if (a[0] !== '#') return s < 1 ? a : b; const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A[0] + (B[0] - A[0]) * s, A[1] + (B[1] - A[1]) * s, A[2] + (B[2] - A[2]) * s); }
    if (isArr(a)) { if (!isArr(b) || b.length !== a.length) return s < 1 ? a : b; return a.map((x, i) => lerp(x, b[i], s)); }
    if (a && typeof a === 'object' && a.pts) { // bezier path {c, pts:[[x,y,ix,iy,ox,oy]]}
      if (!b || !b.pts || b.pts.length !== a.pts.length) return s < 1 ? a : b;
      return { c: a.c, pts: a.pts.map((p, i) => p.map((x, j) => x + (b.pts[i][j] - x) * s)) };
    }
    return s < 1 ? a : b;
  }
  LM.lerp = lerp;

  // cubic-bezier timing (like CSS): control points (x1,y1),(x2,y2); returns y at x=s. y may overshoot.
  function bez(s, x1, y1, x2, y2) {
    if (s <= 0) return 0; if (s >= 1) return 1;
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = u => ((ax * u + bx) * u + cx) * u, dX = u => (3 * ax * u + 2 * bx) * u + cx;
    let u = s;
    for (let i = 0; i < 8; i++) { const e = X(u) - s; if (Math.abs(e) < 1e-6) break; const d = dX(u); if (Math.abs(d) < 1e-6) break; u -= e / d; }
    if (u < 0 || u > 1 || Math.abs(X(u) - s) > 1e-4) { let lo = 0, hi = 1; u = s; for (let i = 0; i < 40; i++) { if (X(u) < s) lo = u; else hi = u; u = (lo + hi) / 2; } }
    return ((ay * u + by) * u + cy) * u;
  }
  LM.bez = bez;
  const EASE = [0.333333, 0];
  // control points for segment a→b
  function segCtrl(a, b) {
    const o = a.o === 'linear' || !a.o ? [1 / 3, 1 / 3] : (a.eo || EASE);
    const i = b.i === 'linear' || !b.i ? [2 / 3, 2 / 3] : [1 - (b.ei || EASE)[0], 1 - (b.ei || EASE)[1]];
    return [o[0], o[1], i[0], i[1]];
  }
  LM.segCtrl = segCtrl;
  function segProgress(a, b, t) {
    const s = (t - a.t) / (b.t - a.t);
    if (a.o === 'hold') return 0;
    const c = segCtrl(a, b);
    if (c[0] === 1 / 3 && c[1] === 1 / 3 && c[2] === 2 / 3 && c[3] === 2 / 3) return s;
    return bez(s, c[0], c[1], c[2], c[3]);
  }
  LM.segProgress = segProgress;

  /* spatial bezier (position): arc-length parameterised */
  const spatialCache = new WeakMap();
  function hasSpatial(a, b) { return (a.so && (a.so[0] || a.so[1])) || (b.si && (b.si[0] || b.si[1])); }
  function spatialLUT(a, b) {
    let c = spatialCache.get(a);
    const key = JSON.stringify([a.v, a.so, b.v, b.si]);
    if (c && c.key === key) return c;
    const p0 = a.v, p3 = b.v, p1 = [p0[0] + (a.so?.[0] || 0), p0[1] + (a.so?.[1] || 0)], p2 = [p3[0] + (b.si?.[0] || 0), p3[1] + (b.si?.[1] || 0)];
    const N = 64, pts = [], len = [0];
    for (let i = 0; i <= N; i++) { const u = i / N, m = 1 - u; pts.push([m * m * m * p0[0] + 3 * m * m * u * p1[0] + 3 * m * u * u * p2[0] + u * u * u * p3[0], m * m * m * p0[1] + 3 * m * m * u * p1[1] + 3 * m * u * u * p2[1] + u * u * u * p3[1]]); if (i) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])); }
    c = { key, pts, len, total: len[N] }; spatialCache.set(a, c); return c;
  }
  function spatialAt(a, b, p) {
    const L = spatialLUT(a, b);
    if (p <= 0 || p >= 1 || !L.total) { // extrapolate linearly along end tangents for overshoot
      const v0 = p <= 0 ? L.pts[0] : L.pts[L.pts.length - 1];
      if (p === 0 || p === 1 || !L.total) return v0.slice(0, 2).concat(a.v.slice(2));
      const q = p < 0 ? L.pts[1] : L.pts[L.pts.length - 2], d = Math.hypot(v0[0] - q[0], v0[1] - q[1]) || 1, ex = p < 0 ? -p : p - 1;
      return [v0[0] + (v0[0] - q[0]) / d * ex * L.total, v0[1] + (v0[1] - q[1]) / d * ex * L.total].concat(a.v.slice(2));
    }
    const target = p * L.total; let lo = 0, hi = L.len.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L.len[m] < target) lo = m; else hi = m; }
    const f = (target - L.len[lo]) / ((L.len[hi] - L.len[lo]) || 1);
    return [L.pts[lo][0] + (L.pts[hi][0] - L.pts[lo][0]) * f, L.pts[lo][1] + (L.pts[hi][1] - L.pts[lo][1]) * f].concat(a.v.slice(2));
  }
  LM.spatialLUT = spatialLUT; LM.hasSpatial = hasSpatial;

  // keyframed (pre-expression) value at layer time lt
  function rawValue(p, lt) {
    const k = p.k;
    if (!k || !k.length) return p.v;
    if (lt <= k[0].t) return k[0].v;
    const n = k.length; if (lt >= k[n - 1].t) return k[n - 1].v;
    let i = 0; while (i < n - 2 && lt >= k[i + 1].t) i++;
    const a = k[i], b = k[i + 1];
    const s = segProgress(a, b, lt);
    if (a.o === 'hold') return a.v;
    if (p._sp && isArr(a.v) && hasSpatial(a, b)) return spatialAt(a, b, s);
    return lerp(a.v, b.v, s);
  }
  LM.rawValue = rawValue;

  /* ---------- expressions & trust ---------- */
  LM.trusted = new Set();      // expression sources the user typed/approved in this session
  LM.exprState = { enabled: true };
  function loopValue(p, lt, type, dir, n) {
    const k = p.k; if (!k || k.length < 2) return rawValue(p, lt);
    const first = dir === 'out' ? (n > 0 ? k[Math.max(0, k.length - 1 - n)] : k[0]) : k[0];
    const last = dir === 'out' ? k[k.length - 1] : (n > 0 ? k[Math.min(k.length - 1, n)] : k[k.length - 1]);
    const t0 = first.t, t1 = last.t, per = t1 - t0;
    if (per <= 0) return rawValue(p, lt);
    if (dir === 'out' && lt <= t1) return rawValue(p, lt);
    if (dir === 'in' && lt >= t0) return rawValue(p, lt);
    if (type === 'continue') {
      const e = dir === 'out' ? t1 : t0, h = 1 / 120, v = rawValue(p, e), v2 = rawValue(p, dir === 'out' ? e - h : e + h);
      const d = (lt - e) / h;
      return isArr(v) ? v.map((x, i) => x + (x - v2[i]) * Math.abs(d)) : typeof v === 'number' ? v + (v - v2) * Math.abs(d) : v;
    }
    const rel = lt - t0, cyc = Math.floor(rel / per); let ph = rel - cyc * per;
    if (type === 'pingpong' && (cyc % 2 + 2) % 2 === 1) ph = per - ph;
    let v = rawValue(p, t0 + ph);
    if (type === 'offset') { const d = (x, y) => isArr(x) ? x.map((q, i) => q - y[i]) : x - y; const delta = d(last.v, first.v); v = isArr(v) ? v.map((x, i) => x + delta[i] * cyc) : typeof v === 'number' ? v + delta * cyc : v; }
    return v;
  }
  LM.loopValue = loopValue;
  const exprErrors = new WeakMap();
  LM.exprError = p => exprErrors.get(p);
  LM.exprBlocked = p => !!(p.x && p.xe !== false && !LM.trusted.has(p.x));
  // final value of property p at comp time t
  function val(p, t, depth = 0) {
    const L = p._l, lt = t - (L ? L.start : 0);
    let v = rawValue(p, lt);
    if (p.x && p.xe !== false && LM.exprState.enabled && depth < 4 && (typeof v === 'number' || (isArr(v) && typeof v[0] === 'number'))) {
      if (!LM.trusted.has(p.x)) return v;
      const C = p._c || { w: 1920, h: 1080, duration: 10, fps: 30, layers: [] };
      const ctx = {
        value: v, time: t, fps: C.fps, seed: LM.expr.hashStr((L ? L.id : '') + '|' + (p._id || '')),
        layerIndex: L && C.layers ? C.layers.indexOf(L) + 1 : 1, layerName: L ? L.name : '', inPoint: L ? L.in : 0, outPoint: L ? L.out : 0,
        comp: { width: C.w, height: C.h, duration: C.duration, numLayers: C.layers ? C.layers.length : 0 },
        valueAtTime: (tt, rawOnly) => rawOnly ? rawValue(p, tt - (L ? L.start : 0)) : val(p, tt, depth + 1),
        loop: (type, dir, n) => loopValue(p, lt, type, dir, n),
        layer: L && C.layers ? L : null, compObj: C.layers ? C : null, depth,
      };
      const r = LM.expr.evaluate(p.x, ctx);
      if (r.err) { exprErrors.set(p, r.err); return v; }
      const c = LM.expr.coerce(r.v, v);
      if (c === null) { exprErrors.set(p, 'Result has the wrong type'); return v; }
      exprErrors.delete(p);
      return c;
    }
    return v;
  }
  LM.val = val;
  LM.hasExpr = p => !!(p && p.x && p.xe !== false);

  // set value at comp time t: adds/updates keyframe if animated, else sets static value
  function setVal(p, t, v) {
    if (animated(p)) {
      const L = p._l, fps = p._c ? p._c.fps : 30;
      const lt = Math.round((t - (L ? L.start : 0)) * fps) / fps;
      const k = p.k.find(k => Math.abs(k.t - lt) < 1e-6);
      if (k) k.v = v; else addKey(p, lt, v);
    } else p.v = v;
  }
  LM.setVal = setVal;
  function addKey(p, lt, v, interp) {
    p.k = p.k || [];
    const ex = p.k.find(k => Math.abs(k.t - lt) < 1e-6);
    if (ex) { ex.v = v; return ex; }
    const prev = p.k.filter(k => k.t < lt).pop();
    const k = { t: lt, v, i: interp || prev?.o || (p._t === 'drawing' ? 'hold' : 'linear'), o: interp || prev?.o || (p._t === 'drawing' ? 'hold' : 'linear') };
    if (k.i === 'bezier' || k.i === 'ease') { k.ei = [.333333, 0]; k.eo = [.333333, 0]; }
    p.k.push(k); p.k.sort((a, b) => a.t - b.t); return k;
  }
  LM.addKey = addKey;
  LM.setInterp = function (k, type) {
    if (type === 'easeIn') { k.i = 'ease'; k.ei = [.333333, 0]; return; }
    if (type === 'easeOut') { k.o = 'ease'; k.eo = [.333333, 0]; return; }
    k.i = k.o = type;
    if (type === 'ease' || type === 'bezier') { k.ei = k.ei && type === 'bezier' ? k.ei : [.333333, 0]; k.eo = k.eo && type === 'bezier' ? k.eo : [.333333, 0]; }
  };
  LM.toggleStopwatch = function (p, t) {
    if (animated(p)) { p.v = val(p, t); delete p.k; }
    else { const L = p._l, fps = p._c ? p._c.fps : 30; p.k = []; addKey(p, Math.round((t - (L ? L.start : 0)) * fps) / fps, clone(p.v)); }
  };

  /* ---------- 2D affine matrices [a,b,c,d,e,f] ---------- */
  const M = {
    id: () => [1, 0, 0, 1, 0, 0],
    mul: (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]],
    inv: m => { const d = m[0] * m[3] - m[1] * m[2] || 1e-12; return [m[3] / d, -m[1] / d, -m[2] / d, m[0] / d, (m[2] * m[5] - m[3] * m[4]) / d, (m[1] * m[4] - m[0] * m[5]) / d]; },
    apply: (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]],
    scaleOf: m => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])),
  };
  LM.M = M;
  function localMatrix(L, t) {
    const tr = L.tr, a = L.type === 'camera' ? [0, 0] : val(tr.anchor, t), p = val(tr.position, t), s = L.type === 'camera' ? [100, 100] : val(tr.scale, t), r = val(tr.rotation, t) * Math.PI / 180;
    const c = Math.cos(r), sn = Math.sin(r), sx = s[0] / 100, sy = s[1] / 100;
    // T(p) R S T(-a)
    const A = c * sx, B = sn * sx, Cc = -sn * sy, D = c * sy;
    return [A, B, Cc, D, p[0] - (A * a[0] + Cc * a[1]), p[1] - (B * a[0] + D * a[1])];
  }
  // true when the layer or any ancestor is a 3D layer (then the 4×4 path is needed)
  const is3D = L => !!(L.threeD || L.type === 'camera');
  function chain3D(L, comp, guard = 0) {
    if (is3D(L)) return true;
    if (!L.parent || guard > 32 || !comp) return false;
    const par = comp.layers.find(x => x.id === L.parent); return par ? chain3D(par, comp, guard + 1) : false;
  }
  function layerMatrix(L, t, comp, guard = 0) {
    if (comp && chain3D(L, comp)) { const W = world4(L, t, comp); return [W[0], W[4], W[1], W[5], W[3], W[7]]; }
    let m = localMatrix(L, t);
    if (L.parent && guard < 32) { const par = comp.layers.find(x => x.id === L.parent); if (par) m = M.mul(layerMatrix(par, t, comp, guard + 1), m); }
    return m;
  }
  LM.localMatrix = localMatrix; LM.layerMatrix = layerMatrix; LM.is3D = is3D; LM.chain3D = chain3D;

  /* ---------- 4×4 matrices (row-major, column vectors) for 2.5D layers ---------- */
  const M4 = {
    id: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    mul(a, b) { const o = new Array(16); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c]; return o; },
    T: (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1],
    S: (x, y, z) => [x, 0, 0, 0, 0, y, 0, 0, 0, 0, z, 0, 0, 0, 0, 1],
    RX: a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]; },
    RY: a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1]; },
    RZ: a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]; },
    apply: (m, x, y, z) => [m[0] * x + m[1] * y + m[2] * z + m[3], m[4] * x + m[5] * y + m[6] * z + m[7], m[8] * x + m[9] * y + m[10] * z + m[11]],
  };
  LM.M4 = M4;
  const D2R = Math.PI / 180;
  function local4(L, t) {
    const tr = L.tr;
    if (!is3D(L)) { const m = localMatrix(L, t); return [m[0], m[2], 0, m[4], m[1], m[3], 0, m[5], 0, 0, 1, 0, 0, 0, 0, 1]; }
    const p = val(tr.position, t), z = val(tr.posZ, t);
    let m = M4.mul(M4.T(p[0], p[1], z), M4.mul(M4.RX(val(tr.rotX, t) * D2R), M4.mul(M4.RY(val(tr.rotY, t) * D2R), M4.RZ(val(tr.rotation, t) * D2R))));
    if (L.type !== 'camera') { const s = val(tr.scale, t), a = val(tr.anchor, t); m = M4.mul(m, M4.mul(M4.S(s[0] / 100, s[1] / 100, 1), M4.T(-a[0], -a[1], 0))); }
    return m;
  }
  function world4(L, t, comp, guard = 0) {
    let m = local4(L, t);
    if (L.parent && guard < 32) { const par = comp.layers.find(x => x.id === L.parent); if (par) m = M4.mul(world4(par, t, comp, guard + 1), m); }
    return m;
  }
  LM.local4 = local4; LM.world4 = world4;
  LM.wouldCycle = (comp, L, parentId) => { let id = parentId, n = 0; while (id && n++ < 64) { if (id === L.id) return true; id = comp.layers.find(x => x.id === id)?.parent; } return false; };

  /* ---------- factories ---------- */
  const LABELS = ['#e05252', '#e0c040', '#58a4e0', '#e88ad0', '#9b7ee0', '#e8a060', '#60c0a0', '#8090a8', '#70c050', '#4060d0', '#c07040'];
  LM.LABELS = LABELS;
  const TYPE_LABEL = { solid: 6, shape: 2, text: 0, image: 5, video: 4, null: 7, adjust: 3, precomp: 1, draw: 8, audio: 9, camera: 10 };
  function transform(cx, cy, ax = 0, ay = 0) { return { anchor: P([ax, ay]), position: P([cx, cy]), scale: P([100, 100]), rotation: P(0), opacity: P(100), posZ: P(0), rotX: P(0), rotY: P(0) }; }
  function baseLayer(comp, type, name, extra) {
    const L = { id: uid(), name, type, label: TYPE_LABEL[type] ?? 2, start: 0, in: 0, out: comp.duration, visible: true, solo: false, locked: false, mb: false, blend: 'normal', matte: null, parent: null, expanded: false, masks: [], effects: [], tr: transform(comp.w / 2, comp.h / 2),
      threeD: false, fb: false, tm: { on: false, p: P(0) }, au: { on: true, level: P(0) }, markers: [] };
    return Object.assign(L, extra);
  }
  // fill / stroke style with an optional gradient (gtype: solid | linear | radial; gradient points are in shape space)
  const paint = (color, extra) => Object.assign({ color: P(color), opacity: P(100), gtype: 'solid', c2: P('#000000'), gs: P([-100, 0]), ge: P([100, 0]) }, extra);
  const repeater = () => ({ on: false, copies: P(3), offset: P(0), anchor: P([0, 0]), position: P([100, 0]), scale: P([100, 100]), rotation: P(0), so: P(100), eo: P(100), comp: 'below' });
  LM.SHAPE_KINDS = ['rect', 'ellipse', 'polygon', 'star', 'path'];
  function shapeDef(kind, o) {
    return {
      kind, size: P(o.size || [400, 300]), roundness: P(o.roundness || 0), points: P(o.points || (kind === 'star' ? 5 : 6)),
      outer: P(o.outer || 200), inner: P(o.inner || 90), path: P(o.path || { c: true, pts: [[-150, -100, 0, 0, 0, 0], [150, -100, 0, 0, 0, 0], [0, 150, 0, 0, 0, 0]] }),
      fill: paint(o.fill || '#4aa3ff', { on: o.fillOn !== false }),
      stroke: paint(o.stroke || '#ffffff', { on: !!o.strokeOn, width: P(o.strokeWidth || 6), cap: 'round', join: 'round' }),
      trim: { start: P(0), end: P(100), offset: P(0) },
    };
  }
  const F = LM.factory = {
    comp: (o = {}) => ({ id: uid(), name: o.name || 'Comp 1', w: o.w || 1920, h: o.h || 1080, fps: o.fps || 30, duration: o.duration || 10, bg: o.bg || '#000000', workIn: 0, workOut: o.duration || 10, layers: [], markers: [], mb: { angle: 180, phase: -90, samples: 8 } }),
    solid(comp, color = '#3a7bd5', name = 'Solid', w = comp.w, h = comp.h) { const L = baseLayer(comp, 'solid', name, { solid: { color: P(color), w, h } }); L.tr.anchor.v = [w / 2, h / 2]; return L; },
    shape(comp, kind = 'rect', o = {}) {
      const L = baseLayer(comp, 'shape', o.name || ({ rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', path: 'Shape' })[kind], {
        shape: Object.assign(shapeDef(kind, o), { groups: [], rep: repeater(), merge: 'off', order: 0 })
      });
      if (o.pos) L.tr.position.v = o.pos.slice();
      return L;
    },
    // an extra shape group inside a shape layer: its own path, fill, stroke, trim, transform and repeater
    shapeGroup(kind = 'rect', o = {}) {
      return Object.assign(shapeDef(kind, o), { id: uid(), name: o.name || ({ rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', path: 'Path' })[kind] + ' Group', on: true,
        gt: { anchor: P([0, 0]), position: P(o.pos ? o.pos.slice() : [0, 0]), scale: P([100, 100]), rotation: P(0), opacity: P(100) }, rep: repeater() });
    },
    repeater,
    audio(comp, asset) { const L = baseLayer(comp, 'audio', asset.name, { asset: asset.id }); L.out = Math.min(comp.duration, asset.duration || comp.duration); return L; },
    camera(comp, zoom) {
      zoom = zoom || Math.round(comp.w * 1.3889 * 10) / 10;
      const L = baseLayer(comp, 'camera', 'Camera 1', { cam: { zoom: P(zoom), poi: P([comp.w / 2, comp.h / 2, 0]) } });
      L.tr.posZ.v = -zoom; return L;
    },
    text(comp, str = 'Text', o = {}) {
      const L = baseLayer(comp, 'text', o.name || str.split('\n')[0].slice(0, 24) || 'Text', {
        text: { str, font: o.font || 'Segoe UI', weight: o.weight || '700', italic: false, size: P(o.size || 120), fill: P(o.fill || '#ffffff'), strokeOn: false, stroke: P('#000000'), strokeWidth: P(4), tracking: P(o.tracking || 0), leading: P(o.leading || 1.2), align: o.align || 'center', animators: [] }
      });
      if (o.pos) L.tr.position.v = o.pos.slice();
      return L;
    },
    animator(name = 'Animator 1') { return { id: uid(), name, opacity: P(100), position: P([0, 0]), scale: P(100), rotation: P(0), fillOn: false, fill: P('#ff3366'), blur: P(0), sel: { start: P(0), end: P(100), offset: P(0), shape: 'square', smooth: true } }; },
    image(comp, asset) { const L = baseLayer(comp, 'image', asset.name, { asset: asset.id }); L.tr.anchor.v = [asset.w / 2, asset.h / 2]; const s = Math.min(1, comp.w / asset.w, comp.h / asset.h) * 100; L.tr.scale.v = [s, s]; return L; },
    video(comp, asset) { const L = baseLayer(comp, 'video', asset.name, { asset: asset.id }); L.tr.anchor.v = [asset.w / 2, asset.h / 2]; const s = Math.min(1, comp.w / asset.w, comp.h / asset.h) * 100; L.tr.scale.v = [s, s]; L.out = Math.min(comp.duration, asset.duration || comp.duration); return L; },
    nul(comp) { const L = baseLayer(comp, 'null', 'Null 1', {}); L.tr.anchor.v = [50, 50]; return L; },
    adjust(comp) { const L = baseLayer(comp, 'adjust', 'Adjustment Layer', {}); L.tr.anchor.v = [comp.w / 2, comp.h / 2]; return L; },
    precomp(comp, sub) { const L = baseLayer(comp, 'precomp', sub.name, { comp: sub.id }); L.tr.anchor.v = [sub.w / 2, sub.h / 2]; L.out = Math.min(comp.duration, sub.duration); return L; },
    draw(comp) { const L = baseLayer(comp, 'draw', 'Drawing', { draw: { cels: P([]), onion: true } }); L.tr.anchor.v = [comp.w / 2, comp.h / 2]; L.draw.cels.k = [{ t: 0, v: [], i: 'hold', o: 'hold' }]; return L; },
    mask(kind, pts, name) { return { id: uid(), name: name || 'Mask', mode: 'add', inv: false, path: P({ c: true, pts }), feather: P(0), opacity: P(100), expansion: P(0) }; },
    effect(type) { const d = LM.FX[type]; const fx = { id: uid(), type, on: true, p: {} }; d.params.forEach(q => fx.p[q.k] = q.static ? { v: clone(q.v), s: 1 } : P(clone(q.v))); return fx; },
  };

  /* ---------- effects registry ---------- */
  LM.FX = {
    blur: { name: 'Gaussian Blur', cat: 'Blur & Sharpen', params: [{ k: 'amount', label: 'Blurriness', type: 'num', v: 12, min: 0, max: 250 }, { k: 'dir', label: 'Blur Dimensions', static: true, v: 'both', options: [['both', 'Horizontal and Vertical'], ['h', 'Horizontal'], ['v', 'Vertical']] }] },
    glow: { name: 'Glow', cat: 'Stylize', params: [{ k: 'threshold', label: 'Glow Threshold', type: 'pct', v: 50, min: 0, max: 100 }, { k: 'radius', label: 'Glow Radius', type: 'num', v: 30, min: 0, max: 400 }, { k: 'intensity', label: 'Glow Intensity', type: 'num', v: 1.2, min: 0, max: 8, step: .05 }, { k: 'tint', label: 'Glow Colors', static: true, v: 'original', options: [['original', 'Original Colors'], ['color', 'A Color']] }, { k: 'color', label: 'Color A', type: 'color', v: '#66c2ff' }] },
    shadow: { name: 'Drop Shadow', cat: 'Perspective', params: [{ k: 'color', label: 'Shadow Color', type: 'color', v: '#000000' }, { k: 'opacity', label: 'Opacity', type: 'pct', v: 60, min: 0, max: 100 }, { k: 'direction', label: 'Direction', type: 'angle', v: 135 }, { k: 'distance', label: 'Distance', type: 'num', v: 12, min: 0, max: 1000 }, { k: 'softness', label: 'Softness', type: 'num', v: 16, min: 0, max: 250 }] },
    bc: { name: 'Brightness & Contrast', cat: 'Color Correction', params: [{ k: 'brightness', label: 'Brightness', type: 'num', v: 0, min: -150, max: 150 }, { k: 'contrast', label: 'Contrast', type: 'num', v: 0, min: -100, max: 100 }] },
    hs: { name: 'Hue/Saturation', cat: 'Color Correction', params: [{ k: 'hue', label: 'Master Hue', type: 'angle', v: 0 }, { k: 'sat', label: 'Master Saturation', type: 'num', v: 0, min: -100, max: 100 }, { k: 'light', label: 'Master Lightness', type: 'num', v: 0, min: -100, max: 100 }] },
    tint: { name: 'Tint', cat: 'Color Correction', params: [{ k: 'black', label: 'Map Black To', type: 'color', v: '#1a1040' }, { k: 'white', label: 'Map White To', type: 'color', v: '#ffd890' }, { k: 'amount', label: 'Amount to Tint', type: 'pct', v: 100, min: 0, max: 100 }] },
    ramp: { name: 'Gradient Ramp', cat: 'Generate', params: [{ k: 'p0', label: 'Start of Ramp', type: 'vec2', v: [960, 0] }, { k: 'c0', label: 'Start Color', type: 'color', v: '#1d2b64' }, { k: 'p1', label: 'End of Ramp', type: 'vec2', v: [960, 1080] }, { k: 'c1', label: 'End Color', type: 'color', v: '#f8cdda' }, { k: 'shape', label: 'Ramp Shape', static: true, v: 'linear', options: [['linear', 'Linear Ramp'], ['radial', 'Radial Ramp']] }, { k: 'blend', label: 'Blend With Original', type: 'pct', v: 0, min: 0, max: 100 }] },
    noise: { name: 'Noise', cat: 'Noise & Grain', params: [{ k: 'amount', label: 'Amount of Noise', type: 'pct', v: 12, min: 0, max: 100 }, { k: 'colored', label: 'Use Color Noise', static: true, v: true, options: 'bool' }, { k: 'animated', label: 'Animated', static: true, v: true, options: 'bool' }] },
    mblur: { name: 'Motion Blur', cat: 'Time', params: [{ k: 'angle', label: 'Shutter Angle', type: 'num', v: 180, min: 0, max: 720 }, { k: 'samples', label: 'Samples', type: 'num', v: 12, min: 2, max: 64, step: 1 }, { k: 'phase', label: 'Shutter Phase', type: 'num', v: -90, min: -360, max: 360 }] },
    levels: { name: 'Levels', cat: 'Color Correction', params: [{ k: 'channel', label: 'Channel', static: true, v: 'rgb', options: [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']] }, { k: 'inBlack', label: 'Input Black', type: 'num', v: 0, min: 0, max: 255 }, { k: 'inWhite', label: 'Input White', type: 'num', v: 255, min: 0, max: 255 }, { k: 'gamma', label: 'Gamma', type: 'num', v: 1, min: .1, max: 10, step: .01 }, { k: 'outBlack', label: 'Output Black', type: 'num', v: 0, min: 0, max: 255 }, { k: 'outWhite', label: 'Output White', type: 'num', v: 255, min: 0, max: 255 }] },
    curves: { name: 'Curves', cat: 'Color Correction', params: [{ k: 'curves', label: 'Curves', static: true, v: { rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] }, options: 'curves' }] },
    fill: { name: 'Fill', cat: 'Generate', params: [{ k: 'color', label: 'Color', type: 'color', v: '#ff3b30' }, { k: 'opacity', label: 'Opacity', type: 'pct', v: 100, min: 0, max: 100 }] },
    stroke: { name: 'Stroke', cat: 'Generate', params: [{ k: 'path', label: 'Path', static: true, v: 'all', options: [['all', 'All Masks (or Shape)'], ['1', 'Mask 1'], ['2', 'Mask 2'], ['3', 'Mask 3'], ['4', 'Mask 4'], ['5', 'Mask 5'], ['6', 'Mask 6'], ['7', 'Mask 7'], ['8', 'Mask 8']] }, { k: 'color', label: 'Color', type: 'color', v: '#ffffff' }, { k: 'size', label: 'Brush Size', type: 'num', v: 6, min: 0, max: 400 }, { k: 'opacity', label: 'Opacity', type: 'pct', v: 100, min: 0, max: 100 }, { k: 'start', label: 'Start', type: 'pct', v: 0, min: 0, max: 100 }, { k: 'end', label: 'End', type: 'pct', v: 100, min: 0, max: 100 }, { k: 'style', label: 'Paint Style', static: true, v: 'on', options: [['on', 'On Original Image'], ['transparent', 'On Transparent'], ['reveal', 'Reveal Original Image']] }] },
    turb: { name: 'Turbulent Displace', cat: 'Distort', params: [{ k: 'amount', label: 'Amount', type: 'num', v: 50, min: 0, max: 1000 }, { k: 'size', label: 'Size', type: 'num', v: 100, min: 2, max: 2000 }, { k: 'offset', label: 'Offset (Turbulence)', type: 'vec2', v: [0, 0] }, { k: 'complexity', label: 'Complexity', type: 'num', v: 2, min: 1, max: 6, step: 1 }, { k: 'evolution', label: 'Evolution', type: 'angle', v: 0 }] },
    wave: { name: 'Wave Warp', cat: 'Distort', params: [{ k: 'type', label: 'Wave Type', static: true, v: 'sine', options: [['sine', 'Sine'], ['square', 'Square'], ['triangle', 'Triangle'], ['saw', 'Sawtooth']] }, { k: 'height', label: 'Wave Height', type: 'num', v: 10, min: -1000, max: 1000 }, { k: 'width', label: 'Wave Width', type: 'num', v: 40, min: 1, max: 4000 }, { k: 'direction', label: 'Direction', type: 'angle', v: 90 }, { k: 'speed', label: 'Wave Speed', type: 'num', v: 1, min: -100, max: 100, step: .05 }, { k: 'phase', label: 'Phase', type: 'angle', v: 0 }] },
    rays: { name: 'Light Rays', cat: 'Generate', params: [{ k: 'intensity', label: 'Intensity', type: 'num', v: 100, min: 0, max: 600 }, { k: 'center', label: 'Center', type: 'vec2', v: [960, 540] }, { k: 'radius', label: 'Ray Length', type: 'num', v: 40, min: 0, max: 300 }, { k: 'mode', label: 'Ray Color', static: true, v: 'source', options: [['source', 'From Source'], ['color', 'Color']] }, { k: 'color', label: 'Color', type: 'color', v: '#ffd890' }] },
    ckey: { name: 'Color Key', cat: 'Keying', params: [{ k: 'color', label: 'Key Color', type: 'color', v: '#00b140' }, { k: 'tolerance', label: 'Tolerance', type: 'pct', v: 25, min: 0, max: 100 }, { k: 'softness', label: 'Edge Softness', type: 'pct', v: 10, min: 0, max: 100 }, { k: 'spill', label: 'Spill Suppression', type: 'pct', v: 50, min: 0, max: 100 }, { k: 'view', label: 'View', static: true, v: 'final', options: [['final', 'Final Result'], ['matte', 'Matte (alpha as gray)']] }] },
    slider: { name: 'Slider Control', cat: 'Expression Controls', ctrl: true, params: [{ k: 'slider', label: 'Slider', type: 'num', v: 0 }] },
    angleCtl: { name: 'Angle Control', cat: 'Expression Controls', ctrl: true, params: [{ k: 'angle', label: 'Angle', type: 'angle', v: 0 }] },
    pointCtl: { name: 'Point Control', cat: 'Expression Controls', ctrl: true, params: [{ k: 'point', label: 'Point', type: 'vec2', v: [960, 540] }] },
    echo: { name: 'Echo', cat: 'Time', params: [{ k: 'time', label: 'Echo Time (seconds)', type: 'num', v: -0.05, min: -10, max: 10, step: .001 }, { k: 'count', label: 'Number Of Echoes', type: 'num', v: 4, min: 0, max: 60, step: 1 }, { k: 'start', label: 'Starting Intensity', type: 'num', v: 1, min: 0, max: 1, step: .01 }, { k: 'decay', label: 'Decay', type: 'num', v: .6, min: 0, max: 1, step: .01 }, { k: 'op', label: 'Echo Operator', static: true, v: 'add', options: [['add', 'Add'], ['max', 'Maximum'], ['screen', 'Screen'], ['back', 'Composite In Back'], ['front', 'Composite In Front']] }] },
  };
  // validation for static params whose options are not a simple list
  LM.validStatic = (q, v) => {
    if (q.options === 'bool') return typeof v === 'boolean';
    if (q.options === 'curves') { const okC = a => Array.isArray(a) && a.length >= 2 && a.length <= 32 && a.every(p => Array.isArray(p) && p.length === 2 && p.every(x => typeof x === 'number' && isFinite(x) && x >= 0 && x <= 1)); return !!v && typeof v === 'object' && ['rgb', 'r', 'g', 'b'].every(c => okC(v[c])); }
    return q.options.some(x => x[0] === v);
  };

  /* ---------- property tree (for timeline / inspector / graph editor) ----------
     node: {id, label, p, type, min,max,step, spatial} | {group, label, id, items, kind?, ref?} | {id,label,setting:{get,set,options}} */
  function link(comp) {
    const def = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: false, configurable: true, writable: true });
    comp.layers.forEach(L => {
      def(L, '_c', comp);
      // every property (including ones hidden in the UI right now) gets its layer/comp links
      const walk = items => items.forEach(n => { if (n.items) walk(n.items); else if (n.p) { def(n.p, '_l', L); def(n.p, '_c', comp); def(n.p, '_id', n.id); def(n.p, '_sp', !!n.spatial); def(n.p, '_t', n.type); def(n.p, '_n', n); } });
      walk(propTree(L, comp, true));
      const tree = propTree(L, comp);
      walk(tree);
      def(L, '_tree', tree);
    });
  }
  LM.link = link;
  LM.linkDoc = doc => doc.comps.forEach(link);

  const KIND_OPTS = [['rect', 'Rectangle'], ['ellipse', 'Ellipse'], ['polygon', 'Polygon'], ['star', 'Star'], ['path', 'Bezier Path']];
  const GEO_LABEL = { rect: 'Rectangle Path', ellipse: 'Ellipse Path', polygon: 'Polystar Path', star: 'Polystar Path', path: 'Path' };
  const GTYPES = [['solid', 'Solid Color'], ['linear', 'Linear Gradient'], ['radial', 'Radial Gradient']];
  LM.MERGE_MODES = [['off', 'Off'], ['add', 'Merge: Add'], ['subtract', 'Merge: Subtract'], ['intersect', 'Merge: Intersect'], ['exclude', 'Merge: Exclude Intersections']];
  // all = true lists every property (for linking / validation); otherwise only what the UI shows now
  function propTree(L, comp, all = false) {
    const out = [];
    const n = (id, label, p, type, o = {}) => Object.assign({ id, label, p, type }, o);
    const set = (id, label, get, setf, options, o = {}) => Object.assign({ id, label, setting: { get, set: setf, options } }, o);
    // geometry + stroke + fill + trim of one shape definition (the layer's own shape, or a group)
    const shapeItems = (S, pre) => {
      const geo = [set(pre + '.kind', 'Shape', () => S.kind, v => S.kind = v, KIND_OPTS)], k = S.kind, poly = k === 'polygon' || k === 'star';
      if (all || k === 'rect' || k === 'ellipse') geo.push(n(pre + '.size', 'Size', S.size, 'vec2', { min: 0 }));
      if (all || k === 'rect' || poly) geo.push(n(pre + '.roundness', 'Roundness', S.roundness, poly ? 'pct' : 'num', poly ? { min: 0, max: 100 } : { min: 0 }));
      if (all || poly) geo.push(n(pre + '.points', 'Points', S.points, 'num', { min: 3, max: 100, step: 1 }), n(pre + '.outer', 'Outer Radius', S.outer, 'num', { min: 0 }));
      if (all || k === 'star') geo.push(n(pre + '.inner', 'Inner Radius', S.inner, 'num', { min: 0 }));
      if (all || k === 'path') geo.push(n(pre + '.path', 'Path', S.path, 'path'));
      const grad = (P, pp) => [set(`${pp}.gtype`, 'Type', () => P.gtype, v => P.gtype = v, GTYPES), ...(all || P.gtype !== 'solid' ? [n(`${pp}.c2`, 'Color B', P.c2, 'color'), n(`${pp}.gs`, 'Start Point', P.gs, 'vec2'), n(`${pp}.ge`, 'End Point', P.ge, 'vec2')] : [])];
      const St = S.stroke, Fi = S.fill;
      return [
        { group: true, id: pre + '.geo', label: GEO_LABEL[k], items: geo },
        { group: true, id: pre + '.stroke', label: St.gtype !== 'solid' ? 'Gradient Stroke' : 'Stroke', items: [set(pre + '.stroke.on', 'Enabled', () => St.on, v => St.on = v, 'bool'), ...grad(St, pre + '.stroke'), n(pre + '.stroke.color', St.gtype !== 'solid' ? 'Color A' : 'Color', St.color, 'color'), n(pre + '.stroke.opacity', 'Opacity', St.opacity, 'pct', { min: 0, max: 100 }), n(pre + '.stroke.width', 'Stroke Width', St.width, 'num', { min: 0 }), set(pre + '.stroke.cap', 'Line Cap', () => St.cap, v => St.cap = v, [['butt', 'Butt Cap'], ['round', 'Round Cap'], ['square', 'Projecting Cap']])] },
        { group: true, id: pre + '.fill', label: Fi.gtype !== 'solid' ? 'Gradient Fill' : 'Fill', items: [set(pre + '.fill.on', 'Enabled', () => Fi.on, v => Fi.on = v, 'bool'), ...grad(Fi, pre + '.fill'), n(pre + '.fill.color', Fi.gtype !== 'solid' ? 'Color A' : 'Color', Fi.color, 'color'), n(pre + '.fill.opacity', 'Opacity', Fi.opacity, 'pct', { min: 0, max: 100 })] },
        { group: true, id: pre + '.trim', label: 'Trim Paths', items: [n(pre + '.trim.start', 'Start', S.trim.start, 'pct', { min: 0, max: 100 }), n(pre + '.trim.end', 'End', S.trim.end, 'pct', { min: 0, max: 100 }), n(pre + '.trim.offset', 'Offset', S.trim.offset, 'angle')] },
      ];
    };
    const repGroup = (R, pre, owner) => ({ group: true, id: pre + '.rep', label: 'Repeater', kind: 'repeater', ref: owner, items: [
      n(pre + '.rep.copies', 'Copies', R.copies, 'num', { min: 0, max: 400, step: 1 }), n(pre + '.rep.offset', 'Offset', R.offset, 'num', { min: -400, max: 400, step: .1 }),
      set(pre + '.rep.comp', 'Composite', () => R.comp, v => R.comp = v, [['below', 'Below'], ['above', 'Above']]),
      { group: true, id: pre + '.rep.tr', label: 'Transform: Repeater', items: [n(pre + '.rep.anchor', 'Anchor Point', R.anchor, 'vec2'), n(pre + '.rep.position', 'Position', R.position, 'vec2'), n(pre + '.rep.scale', 'Scale', R.scale, 'vec2pct'), n(pre + '.rep.rotation', 'Rotation', R.rotation, 'angle'),
        n(pre + '.rep.so', 'Start Opacity', R.so, 'pct', { min: 0, max: 100 }), n(pre + '.rep.eo', 'End Opacity', R.eo, 'pct', { min: 0, max: 100 })] }] });
    if (L.type === 'solid') out.push({ group: true, id: 'solid', label: 'Solid', items: [n('solid.color', 'Color', L.solid.color, 'color')] });
    if (L.type === 'shape') {
      const S = L.shape, items = shapeItems(S, 'shape');
      S.groups.forEach(g => {
        const gi = shapeItems(g, 'grp.' + g.id);
        gi.push({ group: true, id: `grp.${g.id}.gt`, label: 'Transform: ' + g.name, items: [n(`grp.${g.id}.gt.anchor`, 'Anchor Point', g.gt.anchor, 'vec2'), n(`grp.${g.id}.gt.position`, 'Position', g.gt.position, 'vec2'), n(`grp.${g.id}.gt.scale`, 'Scale', g.gt.scale, 'vec2pct'), n(`grp.${g.id}.gt.rotation`, 'Rotation', g.gt.rotation, 'angle'), n(`grp.${g.id}.gt.opacity`, 'Opacity', g.gt.opacity, 'pct', { min: 0, max: 100 })] });
        if (all || g.rep.on) gi.push(repGroup(g.rep, 'grp.' + g.id, g));
        items.push({ group: true, id: 'grp.' + g.id, label: g.name, kind: 'sgroup', ref: g, items: gi });
      });
      if (all || S.rep.on) items.push(repGroup(S.rep, 'shape', S));
      if (S.groups.length) items.push(set('shape.order', 'Own Shape Order', () => String(Math.max(0, Math.min(S.groups.length, S.order | 0))), v => S.order = Math.max(0, Math.min(S.groups.length, parseInt(v) || 0)), [['0', 'Top (above all groups)'], ...S.groups.map((g, i) => [String(i + 1), i === S.groups.length - 1 ? 'Bottom (below all groups)' : `Below “${g.name}”`])]));
      if (S.merge !== 'off' || S.groups.length || S.rep.on) items.push(set('shape.merge', 'Merge Paths', () => S.merge, v => S.merge = v, LM.MERGE_MODES));
      out.push({ group: true, id: 'contents', label: 'Contents', items });
    }
    if (L.type === 'text') {
      const T = L.text, settings = [
        set('text.str', 'Source Text', () => T.str, v => T.str = v, 'text'),
        set('text.font', 'Font', () => T.font, v => T.font = v, LM.FONTS.map(f => [f, f])),
        set('text.weight', 'Weight', () => T.weight, v => T.weight = v, [['300', 'Light'], ['400', 'Regular'], ['600', 'Semibold'], ['700', 'Bold'], ['900', 'Black']]),
        set('text.align', 'Alignment', () => T.align, v => T.align = v, [['left', 'Left'], ['center', 'Center'], ['right', 'Right']]),
        set('text.strokeOn', 'Stroke', () => T.strokeOn, v => T.strokeOn = v, 'bool')], items = [];
      const props = [n('text.size', 'Font Size', T.size, 'num', { min: 1 }), n('text.fill', 'Fill Color', T.fill, 'color'), n('text.stroke', 'Stroke Color', T.stroke, 'color'), n('text.strokeWidth', 'Stroke Width', T.strokeWidth, 'num', { min: 0 }),
        n('text.tracking', 'Tracking', T.tracking, 'num'), n('text.leading', 'Line Spacing', T.leading, 'num', { step: .01, min: .3 })];
      T.animators.forEach(A => items.push({ group: true, id: 'anim.' + A.id, label: A.name, kind: 'animator', ref: A, items: [
        { group: true, id: 'anim.' + A.id + '.sel', label: 'Range Selector 1', items: [n(`anim.${A.id}.start`, 'Start', A.sel.start, 'pct', { min: 0, max: 100 }), n(`anim.${A.id}.end`, 'End', A.sel.end, 'pct', { min: 0, max: 100 }), n(`anim.${A.id}.offset`, 'Offset', A.sel.offset, 'pct', { min: -100, max: 100 }),
          set(`anim.${A.id}.shape`, 'Shape', () => A.sel.shape, v => A.sel.shape = v, [['square', 'Square'], ['rampUp', 'Ramp Up'], ['rampDown', 'Ramp Down'], ['triangle', 'Triangle'], ['round', 'Round'], ['smooth', 'Smooth']]),
          set(`anim.${A.id}.smooth`, 'Smooth Edges', () => A.sel.smooth, v => A.sel.smooth = v, 'bool')] },
        n(`anim.${A.id}.position`, 'Position', A.position, 'vec2'), n(`anim.${A.id}.scale`, 'Scale', A.scale, 'pct'), n(`anim.${A.id}.rotation`, 'Rotation', A.rotation, 'angle'), n(`anim.${A.id}.opacity`, 'Opacity', A.opacity, 'pct', { min: 0, max: 100 }), n(`anim.${A.id}.blur`, 'Blur', A.blur, 'num', { min: 0 }),
        set(`anim.${A.id}.fillOn`, 'Fill Color On', () => A.fillOn, v => A.fillOn = v, 'bool'), n(`anim.${A.id}.fill`, 'Fill Color', A.fill, 'color'),
      ] }));
      items.push(...props, { group: true, id: 'text.opts', label: 'Character & Paragraph', items: settings });
      out.push({ group: true, id: 'text', label: 'Text', items });
    }
    if (L.type === 'draw') out.push({ group: true, id: 'draw', label: 'Drawing', items: [n('draw.cels', 'Cels', L.draw.cels, 'drawing'), set('draw.onion', 'Onion Skin', () => L.draw.onion, v => L.draw.onion = v, 'bool')] });
    if (L.type === 'camera') out.push({ group: true, id: 'camera', label: 'Camera Options', items: [n('cam.zoom', 'Zoom', L.cam.zoom, 'num', { min: 1, unit: ' px' }), n('cam.poi', 'Point of Interest', L.cam.poi, 'vec3')] });
    if (all || (L.tm.on && LM.canTimeRemap(L))) out.push(n('tm', 'Time Remap', L.tm.p, 'num', { fmt: 'sec', step: 1 / ((comp && comp.fps) || 30) }));
    if (all || L.type === 'audio' || ((L.type === 'video' || L.type === 'precomp') && LM.layerHasAudio?.(L, comp))) out.push({ group: true, id: 'audio', label: 'Audio', items: [n('au.level', 'Audio Levels', L.au.level, 'num', { min: -96, max: 24, unit: ' dB', step: .1 })] });
    if (L.masks.length) out.push({ group: true, id: 'masks', label: 'Masks', items: L.masks.map(m => ({ group: true, id: 'mask.' + m.id, label: m.name, kind: 'mask', ref: m, items: [
      set(`mask.${m.id}.mode`, 'Mode', () => m.mode, v => m.mode = v, [['add', 'Add'], ['subtract', 'Subtract'], ['intersect', 'Intersect'], ['none', 'None']]),
      set(`mask.${m.id}.inv`, 'Inverted', () => m.inv, v => m.inv = v, 'bool'),
      n(`mask.${m.id}.path`, 'Mask Path', m.path, 'path'), n(`mask.${m.id}.feather`, 'Mask Feather', m.feather, 'num', { min: 0 }), n(`mask.${m.id}.opacity`, 'Mask Opacity', m.opacity, 'pct', { min: 0, max: 100 }), n(`mask.${m.id}.expansion`, 'Mask Expansion', m.expansion, 'num')] })) });
    if (L.effects.length) out.push({ group: true, id: 'effects', label: 'Effects', items: L.effects.map(fx => { const d = LM.FX[fx.type]; return { group: true, id: 'fx.' + fx.id, label: fx.name || d.name, kind: 'effect', ref: fx, items: d.params.map(q => q.static ? set(`fx.${fx.id}.${q.k}`, q.label, () => fx.p[q.k].v, v => fx.p[q.k].v = v, q.options) : n(`fx.${fx.id}.${q.k}`, q.label, fx.p[q.k], q.type, { min: q.min, max: q.max, step: q.step, spatial: false })) }; }) });
    const T = L.tr, d3 = LM.is3D(L);
    const tri = [];
    if (L.type !== 'camera' && (all || L.type !== 'audio')) tri.push(n('tr.anchor', 'Anchor Point', T.anchor, 'vec2'));
    if (all || L.type !== 'audio') tri.push(n('tr.position', 'Position', T.position, 'vec2', { spatial: true }));
    if (all || d3) tri.push(n('tr.posZ', 'Z Position', T.posZ, 'num'));
    if (L.type !== 'camera' && (all || L.type !== 'audio')) tri.push(n('tr.scale', 'Scale', T.scale, 'vec2pct'));
    if (all || d3) tri.push(n('tr.rotX', 'X Rotation', T.rotX, 'angle'), n('tr.rotY', 'Y Rotation', T.rotY, 'angle'));
    if (all || L.type !== 'audio') tri.push(n('tr.rotation', d3 ? 'Z Rotation' : 'Rotation', T.rotation, 'angle'));
    if (L.type !== 'camera' && (all || L.type !== 'audio')) tri.push(n('tr.opacity', 'Opacity', T.opacity, 'pct', { min: 0, max: 100 }));
    if (tri.length) out.push({ group: true, id: 'transform', label: 'Transform', items: tri });
    return out;
  }
  LM.propTree = propTree;
  // contents top → bottom: groups with the layer's own shape inserted at shape.order
  LM.shapeOrder = S => { const out = S.groups.map(g => ({ g })); out.splice(Math.max(0, Math.min(S.groups.length, S.order | 0)), 0, { root: true }); return out; };
  LM.canTimeRemap = L => L.type === 'precomp' || L.type === 'video' || L.type === 'audio';
  LM.FONTS = ['Segoe UI', 'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Georgia', 'Impact', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
  // flat list of property leaf nodes of a layer (with keyframes etc.)
  LM.leaves = (L, filter) => { const out = []; const walk = items => items.forEach(n => n.items ? walk(n.items) : n.p && (!filter || filter(n)) && out.push(n)); walk(L._tree || propTree(L, L._c)); return out; };
  // every property, including ones the UI currently hides
  LM.allLeaves = L => { const out = []; const walk = items => items.forEach(n => n.items ? walk(n.items) : n.p && out.push(n)); walk(propTree(L, L._c, true)); return out; };
  LM.findNode = (L, id) => LM.leaves(L).find(n => n.id === id);
  LM.layerHasAnim = L => LM.leaves(L).some(n => animated(n.p) || LM.hasExpr(n.p));
  // source time of a layer's content (time remapping), in seconds of the source
  LM.srcTime = (L, t) => (L.tm && L.tm.on && LM.canTimeRemap(L)) ? val(L.tm.p, t) : t - L.start;

  /* ---------- assets (kept outside undo history; never mutated) ---------- */
  LM.assets = new Map();   // id → {id,name,type,mime,data(dataURL),w,h,duration, el (decoded)}
})();
