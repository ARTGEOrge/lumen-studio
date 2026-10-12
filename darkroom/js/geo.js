'use strict';
/* Lumen Darkroom — geometry chain shared by the WebGL engine (as uniforms) and the interactive tools (in JS).

   Output pixel → source pixel ("inverse" chain, what the shader evaluates):
     view uv ─A1→ corrected oriented uv  (view rect, crop rect, straighten)
             ─H⁻¹→ original oriented uv   (upright / perspective: vertical, horizontal, rotate, aspect, scale, offset)
             ─A2→ corrected source uv     (flip, 90° rotations)
             ─D→  raw source uv           (manual lens distortion, radial)
   Spots and masks live in raw source uv, so they stay attached to the picture content whatever the crop,
   transform or lens settings are. "Square" coordinates (uv × size / long edge) are used for distances. */
const Geo = (() => {
  const DEG = Math.PI / 180;
  const mul3 = (A, B) => { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j]; return C; };
  function inv3(m) {
    const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-12) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const k = 1 / det;
    return [A * k, -(b * i - c * h) * k, (b * f - c * e) * k, B * k, (a * i - c * g) * k, -(a * f - c * d) * k, C * k, -(a * h - b * g) * k, (a * e - b * d) * k];
  }
  const ap3 = (m, x, y) => { const X = m[0] * x + m[1] * y + m[2], Y = m[3] * x + m[4] * y + m[5], W = m[6] * x + m[7] * y + m[8]; return [X / W, Y / W, W]; };
  const isIdentityUpright = u => !u || (!u.vert && !u.horiz && !u.rotate && !u.aspect && u.scale === 100 && !u.x && !u.y);
  const hasLens = l => l && (l.dist || l.vig || l.caR || l.caB);

  // forward perspective (original oriented centred coords → corrected), excluding scale; coordinates in units of the long edge
  function uprightMatrix(u) {
    const f = u.f || 1, tx = (u.vert || 0) / 100 * 35 * DEG, ty = (u.horiz || 0) / 100 * 35 * DEG, tz = (u.rotate || 0) * DEG;
    const cx = Math.cos(tx), sx = Math.sin(tx), cy = Math.cos(ty), sy = Math.sin(ty), cz = Math.cos(tz), sz = Math.sin(tz);
    const Rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx], Ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy], Rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
    const K = [f, 0, 0, 0, f, 0, 0, 0, 1], Ki = [1 / f, 0, 0, 0, 1 / f, 0, 0, 0, 1];
    let M = mul3(K, mul3(Rz, mul3(Rx, mul3(Ry, Ki))));
    // keep the image centre where it was
    const c = ap3(M, 0, 0); M = mul3([1, 0, -c[0], 0, 1, -c[1], 0, 0, 1], M);
    const asp = Math.pow(2, (u.aspect || 0) / 100 * .5);
    return mul3([asp, 0, 0, 0, 1 / asp, 0, 0, 0, 1], M);
  }

  /* build(w, h, st, full) — w,h: source texture size. full: ignore the crop rectangle (crop editing) */
  const scaleCache = new Map();
  function build(w, h, st, full, view) {
    const crop = st.crop, rot = ((crop.rot % 4) + 4) % 4, o = (rot & 1) ? { w: h, h: w } : { w, h };
    const Lg = Math.max(w, h), ow = o.w / Lg, oh = o.h / Lg, sq = [w / Lg, h / Lg];
    const v = view || { x: 0, y: 0, w: 1, h: 1 };
    // A1: view uv → crop uv → corrected oriented uv (undo straighten around the frame centre)
    const a = (crop.angle || 0) * DEG, ca = Math.cos(a), sa = Math.sin(a);
    const cx = full ? 0 : crop.x, cy = full ? 0 : crop.y, cw = full ? 1 : crop.w, ch = full ? 1 : crop.h;
    // crop-uv u → px = (cx + u cw - .5) o.w ; qx = ca px + sa py ; ou = qx / o.w + .5
    const lin = (u, vv) => { const px = (cx + u * cw - .5) * o.w, py = (cy + vv * ch - .5) * o.h; return [(ca * px + sa * py) / o.w + .5, (-sa * px + ca * py) / o.h + .5]; };
    const p00 = lin(0, 0), p10 = lin(1, 0), p01 = lin(0, 1);
    const C = [p10[0] - p00[0], p01[0] - p00[0], p00[0], p10[1] - p00[1], p01[1] - p00[1], p00[1]];          // crop uv → corrected oriented uv
    const A1 = [C[0] * v.w, C[1] * v.h, C[0] * v.x + C[1] * v.y + C[2], C[3] * v.w, C[4] * v.h, C[3] * v.x + C[4] * v.y + C[5]];  // view uv → …
    // A2: oriented uv → corrected source uv (flip, then rot quarter turns: (u,v) → (v, 1-u))
    let A2 = [1, 0, 0, 0, 1, 0];
    if (crop.flipH) A2 = [-1, 0, 1, 0, 1, 0];
    if (crop.flipV) A2 = [A2[0], A2[1], A2[2], 0, -1, 1];
    for (let i = 0; i < rot; i++) A2 = [A2[3], A2[4], A2[5], -A2[0], -A2[1], 1 - A2[2]];
    // lens distortion: Q' = Q (1 - K r²), r² relative to the half diagonal
    const hd2 = (sq[0] * sq[0] + sq[1] * sq[1]) / 4, k = (st.lens?.dist || 0) / 100 * .25, K = k / hd2;
    const u = st.upright || { scale: 100 };
    const ident = isIdentityUpright(u);
    let M = ident ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : uprightMatrix(u);
    // scale: user scale × automatic "constrain" scale so no empty borders appear
    const g = { w, h, o, ow, oh, sq, A1, A2, K, M, Hinv: null, C, crop, full };
    let s = (u.scale || 100) / 100;
    if (u.constrain !== false && (!ident || K < 0)) {
      const key = [w, h, rot, crop.flipH, crop.flipV, k, u.vert, u.horiz, u.rotate, u.aspect, u.x, u.y, u.f || 1].join('|');
      let auto = scaleCache.get(key);
      if (auto == null) { auto = autoScale(g); scaleCache.set(key, auto); if (scaleCache.size > 200) scaleCache.delete(scaleCache.keys().next().value); }
      s *= auto;
    }
    g.scale = s;
    const T = [s, 0, (u.x || 0) / 100 * .5 * ow, 0, s, (u.y || 0) / 100 * .5 * oh, 0, 0, 1];
    g.H = mul3(T, M); g.Hinv = inv3(g.H);
    return g;
  }
  // corrected oriented uv → raw source uv (null when behind the camera)
  function orientedToRaw(g, ou, ov) {
    const X = (ou - .5) * g.ow, Y = (ov - .5) * g.oh, r = ap3(g.Hinv, X, Y);
    if (r[2] <= 0) return null;
    const uu = r[0] / g.ow + .5, vv = r[1] / g.oh + .5, A = g.A2;
    const cu = A[0] * uu + A[1] * vv + A[2], cv = A[3] * uu + A[4] * vv + A[5];
    const Qx = (cu - .5) * g.sq[0], Qy = (cv - .5) * g.sq[1], f = 1 - g.K * (Qx * Qx + Qy * Qy);
    return [Qx * f / g.sq[0] + .5, Qy * f / g.sq[1] + .5];
  }
  function autoScale(g) {
    // smallest s ≥ 1 such that the whole frame maps inside the source
    const pts = []; for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push([t, 0], [t, 1], [0, t], [1, t]); }
    const ok = s => { const T = [s, 0, 0, 0, s, 0, 0, 0, 1], gg = { ...g, Hinv: inv3(mul3(T, g.M)) }; return pts.every(([x, y]) => { const r = orientedToRaw(gg, x, y); return r && r[0] >= -1e-4 && r[1] >= -1e-4 && r[0] <= 1 + 1e-4 && r[1] <= 1 + 1e-4; }); };
    if (ok(1)) return 1;
    let lo = 1, hi = 1.5; while (!ok(hi) && hi < 16) { lo = hi; hi *= 1.5; }
    if (!ok(hi)) return 1;
    for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (ok(m)) hi = m; else lo = m; }
    return hi;
  }
  // view/crop uv → raw source uv
  function fwd(g, u, v) { const A = g.C, ou = A[0] * u + A[1] * v + A[2], ov = A[3] * u + A[4] * v + A[5]; return orientedToRaw(g, ou, ov); }
  // raw source uv → crop uv (inverse of fwd)
  function inv(g, su, sv) {
    // undo distortion (radial, Newton)
    let Qx = (su - .5) * g.sq[0], Qy = (sv - .5) * g.sq[1];
    const rp = Math.hypot(Qx, Qy);
    if (g.K && rp > 1e-9) {
      let r = rp; for (let i = 0; i < 12; i++) { const f = r * (1 - g.K * r * r) - rp, d = 1 - 3 * g.K * r * r; if (Math.abs(d) < 1e-6) break; r -= f / d; }
      Qx *= r / rp; Qy *= r / rp;
    }
    const cu = Qx / g.sq[0] + .5, cv = Qy / g.sq[1] + .5;
    // undo A2 (affine)
    const A = g.A2, det = A[0] * A[4] - A[1] * A[3];
    const uu = (A[4] * (cu - A[2]) - A[1] * (cv - A[5])) / det, vv = (-A[3] * (cu - A[2]) + A[0] * (cv - A[5])) / det;
    // forward perspective
    const r = ap3(g.H, (uu - .5) * g.ow, (vv - .5) * g.oh);
    const ou = r[0] / g.ow + .5, ov = r[1] / g.oh + .5;
    // undo C (crop uv → oriented uv)
    const B = g.C, d2 = B[0] * B[4] - B[1] * B[3];
    return [(B[4] * (ou - B[2]) - B[1] * (ov - B[5])) / d2, (-B[3] * (ou - B[2]) + B[0] * (ov - B[5])) / d2];
  }
  // raw uv ↔ square coords (distances in units of the long edge)
  const toSq = (g, u, v) => [u * g.sq[0], v * g.sq[1]];
  const fromSq = (g, x, y) => [x / g.sq[0], y / g.sq[1]];

  // uniforms for the shaders. GLSL mat3 is column-major.
  function uniforms(g) {
    const H = g.Hinv;
    return { A1x: [g.A1[0], g.A1[1], g.A1[2]], A1y: [g.A1[3], g.A1[4], g.A1[5]], Hinv: [H[0], H[3], H[6], H[1], H[4], H[7], H[2], H[5], H[8]],
      osz: [g.ow, g.oh], A2x: [g.A2[0], g.A2[1], g.A2[2]], A2y: [g.A2[3], g.A2[4], g.A2[5]], sq: g.sq, K: g.K };
  }
  const GLSL = `
uniform vec3 uA1x, uA1y, uA2x, uA2y; uniform mat3 uHinv; uniform vec2 uOsz, uSq; uniform float uK;
// view uv → corrected source uv (before lens distortion); returns -1 when undefined
vec2 toCorr(vec2 uv){
  vec3 q = vec3(uv, 1.); vec2 o = vec2(dot(uA1x, q), dot(uA1y, q));
  vec3 h = uHinv*vec3((o - .5)*uOsz, 1.);
  if (h.z <= 0.) return vec2(-1.);
  vec3 r = vec3(h.xy/h.z/uOsz + .5, 1.);
  return vec2(dot(uA2x, r), dot(uA2y, r));
}
vec2 toRaw(vec2 cs){ vec2 Q = (cs - .5)*uSq; return Q*(1. - uK*dot(Q,Q))/uSq + .5; }
vec2 toSource(vec2 uv){ vec2 c = toCorr(uv); return c.x < -.5 ? vec2(-1.) : toRaw(c); }
`;
  return { build, fwd, inv, orientedToRaw, uniforms, toSq, fromSq, GLSL, isIdentityUpright, hasLens, uprightMatrix, mul3, inv3, ap3 };
})();
