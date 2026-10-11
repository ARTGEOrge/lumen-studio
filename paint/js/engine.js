'use strict';
/* Lumen Paint brush engine.
   Input → pressure curve → stabiliser → constraints (ruler / perspective) → spacing → per-dab dynamics
   (pressure/tilt/velocity/jitter) → symmetry copies → rasterizer for the brush mode:
     paint/erase : dabs accumulate in a float stroke buffer (flow builds toward an opacity cap), the layer
                   is recomputed from the untouched original tiles → no 8-bit drift, true opacity ceiling
     smudge      : carried pixel patch (finger)
     oil         : paint reservoir + canvas pickup + smear patch + bristle impasto, paint runs out
     water       : deposits water+pigment into a per-layer wet simulation (wet.js) that keeps flowing
     liquify     : push / twirl / pinch / bloat / reconstruct displacement dabs */
let activeStroke = null;
const prefs = { pressureGamma: 1, mouseTaper: true, tiltEnabled: true, touchPaint: true };

function grainSampler(scale) {
  const G = grainMap(doc.paper || 'cold', true); if (!G) return null;
  return { G, k: 1 / Math.max(0.25, scale * (doc.paperScale || 1)) };
}

class Stroke {
  constructor(o) {
    this.L = o.layer; this.b = o.brush; this.mode = o.mode || o.brush.mode; this.color = o.color.slice();
    this.zoom = o.zoom || 1; this.constrain = o.constrain || null; this.subMode = o.subMode || 'push';
    this.mats = o.mats && o.mats.length ? o.mats : [mat.id()];
    this.subs = this.mats.map(m => ({ m, init: false, patch: null, res: this.color.slice(), load: this.b.load, lastX: null, lastY: null, dirx: 1, diry: 0 }));
    this.orig = new Map(); this.sb = new Map(); this.sbDirty = new Map(); this.needFlush = false;
    this.raw = []; this.sm = null; this.last = null; this.rem = 0; this.vel = 0; this.dir = [1, 0]; this.travel = 0;
    this.rng = mulberry32((Math.random() * 1e9) | 0);
    this.tip = tipMap(this.b.tip); this.grain = this.b.grain > 0 ? grainSampler(this.b.grainScale) : null;
    this.bbox = null; this.isMouse = !!o.mouse; this.dabs = 0; this.held = o.holdUntilDir ? [] : null;
    this.strokeColor = this.jitterColor(this.color, true);
    if (this.mode === 'water') this.wet = getWetSim(this.L, this.b);
    else if (this.mode !== 'liquify') dryWet(this.L);
    if (this.mode === 'liquify') this.lqOrig = null;
    activeStroke = this;
  }
  jitterColor(c, perStroke) {
    const b = this.b; if (!(b.jHue || b.jSat || b.jVal) || (b.colorPerStroke !== perStroke)) return c;
    let [h, s, v] = rgb2hsv(c[0], c[1], c[2]); const r = () => this.rng() * 2 - 1;
    h += b.jHue * 60 * r(); s = clamp(s + b.jSat * 0.5 * r(), 0, 1); v = clamp(v + b.jVal * 0.5 * r(), 0, 1);
    return hsv2rgb(h, s, v);
  }
  /* raw input point in doc space: {x,y,p,tx,ty,t} */
  add(pt) {
    const b = this.b; pt = { ...pt };
    let p = pt.p == null ? 1 : pt.p;
    if (this.isMouse) { p = prefs.mouseTaper && (b.pSize > 0 || b.pOpacity > 0 || b.pFlow > 0) ? Math.min(1, 0.3 + this.travel / (b.size * 2.5 + 30)) : 1; }
    pt.p = Math.pow(clamp(p, 0, 1), prefs.pressureGamma);
    const prev = this.raw[this.raw.length - 1];
    if (prev) {
      const d = Math.hypot(pt.x - prev.x, pt.y - prev.y), dt = Math.max(1, pt.t - prev.t);
      this.travel += d; this.vel = this.vel * 0.75 + 0.25 * (d * this.zoom / dt);
    }
    pt.v = this.vel; this.raw.push(pt); if (this.raw.length > 8) this.raw.shift();
    // stabiliser
    const s = b.smoothing;
    if (!this.sm) this.sm = { ...pt };
    else if (b.stabMode === 'rope') {
      const L = s * 60 / Math.max(0.2, this.zoom), dx = pt.x - this.sm.x, dy = pt.y - this.sm.y, d = Math.hypot(dx, dy);
      if (d > L) { const k = (d - L) / d; this.sm = { ...pt, x: this.sm.x + dx * k, y: this.sm.y + dy * k }; } else { this.sm.p = pt.p; return; }
    } else if (s > 0) {
      const dt = prev ? Math.max(1, Math.min(50, pt.t - prev.t)) : 8;
      const k = 1 - Math.pow(s * 0.97, dt / 8 * (1 + (1 - s) * 2));
      this.sm = { ...pt, x: this.sm.x + (pt.x - this.sm.x) * k, y: this.sm.y + (pt.y - this.sm.y) * k, p: this.sm.p + (pt.p - this.sm.p) * Math.min(1, k * 1.5) };
    } else this.sm = { ...pt };
    this.feed({ ...this.sm, v: pt.v, tx: pt.tx, ty: pt.ty });
  }
  feed(q) {
    if (this.constrain) { for (const x of this.constrain(q, this)) this.feed1(x); return; }
    this.feed1(q);
  }
  feed1(q) {
    if (!this.last) { this.last = q; this.dab(q); return; }
    const a = this.last, dx = q.x - a.x, dy = q.y - a.y, seg = Math.hypot(dx, dy); if (seg < 1e-6) { this.last = { ...a, p: q.p }; return; }
    this.dir = [this.dir[0] * 0.6 + dx / seg * 0.4, this.dir[1] * 0.6 + dy / seg * 0.4];
    let d = this.rem;
    while (d <= seg) {
      const t = d / seg, P = { x: a.x + dx * t, y: a.y + dy * t, p: a.p + (q.p - a.p) * t, v: a.v + (q.v - a.v) * t, tx: lerp(a.tx || 0, q.tx || 0, t), ty: lerp(a.ty || 0, q.ty || 0, t) };
      this.dab(P);
      d += this.spacingAt(P);
    }
    this.rem = d - seg; this.last = q;
  }
  end() {
    // catch up the smoothed position to the last raw input so the line reaches the pen-up point
    const r = this.raw[this.raw.length - 1];
    if (r && this.sm && this.b.smoothing > 0) {
      const n = 8; const s0 = { ...this.sm };
      for (let i = 1; i <= n; i++) this.feed({ x: lerp(s0.x, r.x, i / n), y: lerp(s0.y, r.y, i / n), p: lerp(s0.p, r.p, i / n), v: r.v, tx: r.tx, ty: r.ty });
    }
    if (this.wet) this.wet.endStroke();
    flushBuild(this);
    this.sb.clear(); activeStroke = null;
    return this.bbox;
  }
  sizeAt(P) {
    const b = this.b, p = P.p;
    let s = b.size * lerp(1, lerp(b.minSize, 1, p), b.pSize);
    if (b.velSize) s *= clamp(1 - b.velSize * clamp((P.v || 0) / 3, 0, 1), 0.05, 2);
    if (b.tiltSize && prefs.tiltEnabled) s *= 1 + b.tiltSize * this.tiltAmt(P);
    return s;
  }
  tiltAmt(P) { return clamp((Math.hypot(P.tx || 0, P.ty || 0) - 8) / 52, 0, 1); }
  spacingAt(P) { return Math.max(0.35, this.b.spacing * this.sizeAt(P)); }
  dab(P) {
    const b = this.b, r = this.rng;
    let size = this.sizeAt(P) * (1 + b.jSize * (r() * 2 - 1) * 0.5);
    if (size < 0.3) return;
    const tilt = prefs.tiltEnabled ? this.tiltAmt(P) : 0;
    const cap = clamp(b.opacity * lerp(1, P.p, b.pOpacity) * (1 - b.tiltOpacity * tilt) * (1 - b.jOpacity * r()), 0, 1);
    const flow = clamp(b.flow * lerp(1, P.p, b.pFlow), 0, 1);
    let ang = b.angle * Math.PI / 180;
    if (b.rotMode === 'direction') ang += Math.atan2(this.dir[1], this.dir[0]);
    else if (b.rotMode === 'tilt' && (P.tx || P.ty)) ang += Math.atan2(P.ty, P.tx);
    else if (b.rotMode === 'random') ang += r() * Math.PI * 2;
    if (b.jAngle) ang += (r() * 2 - 1) * Math.PI * b.jAngle;
    let x = P.x, y = P.y;
    if (b.scatter) { const a = r() * Math.PI * 2, d = r() * b.scatter * size; x += Math.cos(a) * d; y += Math.sin(a) * d; }
    const col = this.jitterColor(this.strokeColor, false);
    const rad = size / 2, ca = Math.cos(ang), sa = Math.sin(ang), rx = rad, ry = rad * b.roundness;
    // tip → doc linear map  R(ang)·diag(rx, ry)
    const l0 = ca * rx, l1 = sa * rx, l2 = -sa * ry, l3 = ca * ry;
    this.dabs++;
    for (const sub of this.subs) {
      const m = sub.m, X = m[0] * x + m[2] * y + m[4], Y = m[1] * x + m[3] * y + m[5];
      // M = m.linear · L   (columns: image of tip u-axis and v-axis)
      const M0 = m[0] * l0 + m[2] * l1, M1 = m[1] * l0 + m[3] * l1, M2 = m[0] * l2 + m[2] * l3, M3 = m[1] * l2 + m[3] * l3;
      // our dab function wants [a,b;c,d] with doc offset dx = a*u + b*v, dy = c*u + d*v
      const Mx = [M0, M2, M1, M3];
      switch (this.mode) {
        case 'smudge': dabSmudge(this, sub, X, Y, Mx, b.strength * lerp(1, P.p, Math.max(b.pFlow, 0.5)), rad); break;
        case 'oil': dabOil(this, sub, X, Y, Mx, flow * cap, P, rad); break;
        case 'water': this.wet.deposit(this, X, Y, Mx, flow * cap, col, P, rad); break;
        case 'liquify': dabLiquify(this, sub, X, Y, rad, P); break;
        default: dabBuild(this, X, Y, Mx, flow, cap, col, rad, P.p);
      }
      sub.lastX = X; sub.lastY = Y;
    }
  }
  grow(x0, y0, x1, y1) { const b = this.bbox; if (!b) this.bbox = [x0, y0, x1, y1]; else { if (x0 < b[0]) b[0] = x0; if (y0 < b[1]) b[1] = y0; if (x1 > b[2]) b[2] = x1; if (y1 > b[3]) b[3] = y1; } }
}

/* dab bounds in doc px, clipped to doc and selection */
function dabRect(S, cx, cy, M, pad = 1) {
  const ex = Math.abs(M[0]) + Math.abs(M[1]) + pad, ey = Math.abs(M[2]) + Math.abs(M[3]) + pad;
  let x0 = Math.floor(cx - ex), y0 = Math.floor(cy - ey), x1 = Math.ceil(cx + ex), y1 = Math.ceil(cy + ey);
  const sb = doc.selBox;
  if (doc.sel && sb) { x0 = Math.max(x0, sb.x); y0 = Math.max(y0, sb.y); x1 = Math.min(x1, sb.x + sb.w); y1 = Math.min(y1, sb.y + sb.h); }
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(doc.w, x1); y1 = Math.min(doc.h, y1);
  if (x0 >= x1 || y0 >= y1) return null;
  S.grow(x0, y0, x1, y1);
  return [x0, y0, x1, y1];
}
// common tip evaluation setup; returns inverse map + params
function tipSetup(M, rad, hardness) {
  const det = M[0] * M[3] - M[1] * M[2] || 1e-9;
  const minR = Math.max(0.5, Math.min(Math.hypot(M[0], M[2]), Math.hypot(M[1], M[3])));
  const h = Math.min(hardness, 1 - 1.2 / minR);
  return { i0: M[3] / det, i1: -M[1] / det, i2: -M[2] / det, i3: M[0] / det, h: Math.max(0, h), ih: 1 / (1 - Math.max(0, h)) };
}
function sampleTip(T, u, v) {
  const fx = (u + 1) * 0.5 * (TIPN - 1), fy = (v + 1) * 0.5 * (TIPN - 1);
  if (fx < 0 || fy < 0 || fx >= TIPN - 1 || fy >= TIPN - 1) return 0;
  const x0 = fx | 0, y0 = fy | 0, ax = fx - x0, ay = fy - y0, i = y0 * TIPN + x0;
  const a = T[i], b = T[i + 1], c = T[i + TIPN], d = T[i + TIPN + 1];
  return a + (b - a) * ax + (c - a) * ay + (a - b - c + d) * ax * ay;
}

/* ---------- paint / erase (stroke buffer) ---------- */
function dabBuild(S, cx, cy, M, flow, cap, col, rad, pr) {
  // tiny dabs: keep a minimum footprint and scale alpha by area to stay smooth
  let areaK = 1;
  const r0 = Math.min(Math.hypot(M[0], M[2]), Math.hypot(M[1], M[3]));
  if (r0 < 0.75) { const f = 0.75 / Math.max(r0, 0.05); areaK = Math.min(1, (r0 / 0.75) * (r0 / 0.75) * 1.4); M = [M[0] * f, M[1] * f, M[2] * f, M[3] * f]; }
  const R = dabRect(S, cx, cy, M); if (!R) return;
  const b = S.b, L = S.L, W = doc.w, tw = doc.tw, sel = doc.sel, T = S.tip, G = S.grain;
  const ts = tipSetup(M, rad, b.hardness), { i0, i1, i2, i3, h, ih } = ts;
  const QA = i0 * i0 + i2 * i2, QB = 2 * (i0 * i1 + i2 * i3), QC = i1 * i1 + i3 * i3, QI = 1 / (2 * QA);
  const mode = S.mode, lock = L.lockAlpha;
  const ccr = col[0] * cap, ccg = col[1] * cap, ccb = col[2] * cap, fl = flow * areaK;
  const gd = b.grain, gthr = G ? 1 - (0.35 + 0.42 * lerp(1, pr, b.grainPressure)) : 0;
  const GG = G && G.G, gk = G && G.k;
  const tx0 = (R[0] / TS) | 0, ty0 = (R[1] / TS) | 0, tx1 = ((R[2] - 1) / TS) | 0, ty1 = ((R[3] - 1) / TS) | 0;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const idx = ty * tw + tx, ox = tx * TS, oy = ty * TS;
    let orig = S.orig.get(idx); if (orig === undefined) { orig = L.tiles[idx]; S.orig.set(idx, orig); }
    if ((mode === 'erase' || lock) && !orig) continue;
    let sb = S.sb.get(idx); if (!sb) { sb = new Float32Array(TS * TS * 4); S.sb.set(idx, sb); }
    const ax = Math.max(R[0], ox), ay = Math.max(R[1], oy), bx = Math.min(R[2], ox + TS), by = Math.min(R[3], oy + TS);
    for (let y = ay; y < by; y++) {
      const dy = y + 0.5 - cy;
      // exact span of the elliptical footprint on this row
      const qb = QB * dy, qc = QC * dy * dy - 1, disc = qb * qb - 4 * QA * qc; if (disc <= 0) continue;
      const sq = Math.sqrt(disc), xs0 = Math.max(ax, Math.floor(cx - 0.5 + (-qb - sq) * QI)), xe0 = Math.min(bx, Math.ceil(cx - 0.5 + (-qb + sq) * QI) + 1);
      let o = ((y - oy) * TS + (xs0 - ox)) * 4;
      for (let x = xs0; x < xe0; x++, o += 4) {
        const dx = x + 0.5 - cx, u = i0 * dx + i1 * dy, v = i2 * dx + i3 * dy, r2 = u * u + v * v;
        if (r2 >= 1) continue;
        let a;
        if (T) a = sampleTip(T, u, v);
        else { let r = Math.sqrt(r2); a = r <= h ? 1 : (r = (1 - r) * ih, r * r * (3 - 2 * r)); }
        if (GG) {
          const fx = (x + 0.5) * gk, fy = (y + 0.5) * gk, ix = fx | 0, iy = fy | 0, gx = fx - ix, gy = fy - iy;
          const q0 = (iy & 511) << 9, q1 = ((iy + 1) & 511) << 9, c0 = ix & 511, c1 = (ix + 1) & 511;
          const g00 = GG[q0 + c0], g10 = GG[q0 + c1], g01 = GG[q1 + c0], g11 = GG[q1 + c1];
          const gv = g00 + (g10 - g00) * gx + (g01 - g00) * gy + (g00 - g10 - g01 + g11) * gx * gy;
          let q = (gv - gthr) * 3.2; q = q < 0 ? 0 : q > 1 ? 1 : q; a *= 1 - gd + gd * q;
        }
        if (sel) a *= sel[y * W + x] * 0.00392156862745098;
        a *= fl; if (a < 0.0005) continue;
        const sa = sb[o + 3]; if (sa >= cap) continue;
        // flow builds the stroke buffer toward the opacity ceiling
        sb[o] += (ccr - sb[o]) * a; sb[o + 1] += (ccg - sb[o + 1]) * a; sb[o + 2] += (ccb - sb[o + 2]) * a; sb[o + 3] = sa + (cap - sa) * a;
      }
    }
    // remember what needs recompositing (tile-local rect)
    const d = S.sbDirty.get(idx), lx0 = ax - ox, ly0 = ay - oy, lx1 = bx - ox, ly1 = by - oy;
    if (!d) S.sbDirty.set(idx, [lx0, ly0, lx1, ly1]); else { if (lx0 < d[0]) d[0] = lx0; if (ly0 < d[1]) d[1] = ly0; if (lx1 > d[2]) d[2] = lx1; if (ly1 > d[3]) d[3] = ly1; }
  }
  S.needFlush = true; requestRender();
}
/* recompute layer pixels = original ⊕ stroke buffer for the dirty rects (once per frame, not per dab) */
function flushBuild(S) {
  if (!S.needFlush) return; S.needFlush = false;
  const L = S.L, mode = S.mode, lock = L.lockAlpha, mult = S.b.blend === 'multiply';
  let dz = (S.dabs * 131) & 4095;
  for (const [idx, d] of S.sbDirty) {
    const orig = S.orig.get(idx), sb = S.sb.get(idx); if (!sb) continue;
    const t = writeTile(L, idx);
    for (let y = d[1]; y < d[3]; y++) {
      let o = (y * TS + d[0]) * 4;
      for (let x = d[0]; x < d[2]; x++, o += 4) {
        const nsa = sb[o + 3]; if (nsa <= 0) continue;
        let or_ = 0, og = 0, ob = 0, oa = 0;
        if (orig) { oa = orig[o + 3] * 0.00392156862745098; or_ = orig[o] * 0.00392156862745098; og = orig[o + 1] * 0.00392156862745098; ob = orig[o + 2] * 0.00392156862745098; }
        const dd = DITHER[dz = (dz + 1) & 4095] - 0.5;
        if (mode === 'erase') { t[o + 3] = oa * (1 - nsa) * 255 + dd; continue; }
        let sr = sb[o], sg = sb[o + 1], sbb = sb[o + 2];
        if (mult && oa > 0) { const m1 = 1 - oa; sr *= m1 + oa * or_; sg *= m1 + oa * og; sbb *= m1 + oa * ob; }
        if (lock) { const m = 1 - nsa; t[o] = (or_ * m + sr) * 255 + dd; t[o + 1] = (og * m + sg) * 255 + dd; t[o + 2] = (ob * m + sbb) * 255 + dd; continue; }
        const ow = oa * (1 - nsa), na = nsa + ow, inv = 255 / na;
        t[o] = (sr + or_ * ow) * inv + dd; t[o + 1] = (sg + og * ow) * inv + dd; t[o + 2] = (sbb + ob * ow) * inv + dd; t[o + 3] = na * 255 + dd;
      }
    }
  }
  S.sbDirty.clear();
  markDirty(L);
}

/* ---------- direct pixel helpers for wet modes ---------- */
// iterate pixels of rect R across tiles; fn(t, o, x, y) — t writable tile
function forPixels(L, R, needExisting, fn, S) {
  const tw = doc.tw, tx0 = (R[0] / TS) | 0, ty0 = (R[1] / TS) | 0, tx1 = ((R[2] - 1) / TS) | 0, ty1 = ((R[3] - 1) / TS) | 0;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const idx = ty * tw + tx; if (needExisting && !L.tiles[idx]) continue;
    if (S && !S.orig.has(idx)) S.orig.set(idx, L.tiles[idx]);
    const t = writeTile(L, idx), ox = tx * TS, oy = ty * TS;
    const ax = Math.max(R[0], ox), ay = Math.max(R[1], oy), bx = Math.min(R[2], ox + TS), by = Math.min(R[3], oy + TS);
    for (let y = ay; y < by; y++) { let o = ((y - oy) * TS + (ax - ox)) * 4; for (let x = ax; x < bx; x++, o += 4) fn(t, o, x, y); }
  }
}
function ensurePatch(sub, rad) {
  const P = Math.ceil(rad * 2 * 1.5) + 4;
  if (!sub.patch || sub.patchN < P) { const old = sub.patch, oN = sub.patchN; sub.patch = new Float32Array(P * P * 4); sub.patchN = P; sub.init = false; if (old) sub.init = false; }
  return sub.patch;
}

/* ---------- smudge / blender ---------- */
function dabSmudge(S, sub, cx, cy, M, strength, rad) {
  const R = dabRect(S, cx, cy, M); if (!R) return;
  const L = S.L, b = S.b, T = S.tip, sel = doc.sel, W = doc.w, lock = L.lockAlpha, tw = doc.tw;
  const { i0, i1, i2, i3, h, ih } = tipSetup(M, rad, b.hardness);
  const PT = ensurePatch(sub, Math.max(Math.abs(M[0]) + Math.abs(M[1]), Math.abs(M[2]) + Math.abs(M[3]))), N = sub.patchN, half = N >> 1;
  const rcx = Math.round(cx), rcy = Math.round(cy);
  const tk = 1 - clamp(strength, 0, 0.99);
  const first = !sub.init; sub.init = true;
  let dz = (S.dabs * 71) & 4095;
  const tx0 = (R[0] / TS) | 0, ty0 = (R[1] / TS) | 0, tx1 = ((R[2] - 1) / TS) | 0, ty1 = ((R[3] - 1) / TS) | 0;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const idx = ty * tw + tx, ox = tx * TS, oy = ty * TS;
    if (!S.orig.has(idx)) S.orig.set(idx, L.tiles[idx]);
    const t = writeTile(L, idx);
    const ax = Math.max(R[0], ox), ay = Math.max(R[1], oy), bx = Math.min(R[2], ox + TS), by = Math.min(R[3], oy + TS);
    for (let y = ay; y < by; y++) {
      const py = y - rcy + half; if (py < 0 || py >= N) continue;
      const dy = y + 0.5 - cy; let o = ((y - oy) * TS + (ax - ox)) * 4;
      for (let x = ax; x < bx; x++, o += 4) {
        const px = x - rcx + half; if (px < 0 || px >= N) continue;
        const pi = (py * N + px) * 4;
        const ca = t[o + 3] * 0.00392156862745098, cr = t[o] * 0.00392156862745098 * ca, cg = t[o + 1] * 0.00392156862745098 * ca, cb = t[o + 2] * 0.00392156862745098 * ca;
        if (first) { PT[pi] = cr; PT[pi + 1] = cg; PT[pi + 2] = cb; PT[pi + 3] = ca; continue; }
        const dx = x + 0.5 - cx, u = i0 * dx + i1 * dy, v = i2 * dx + i3 * dy, r2 = u * u + v * v;
        if (r2 >= 1) { PT[pi] = cr; PT[pi + 1] = cg; PT[pi + 2] = cb; PT[pi + 3] = ca; continue; }
        let a; if (T) a = sampleTip(T, u, v); else { let r = Math.sqrt(r2); a = r <= h ? 1 : (r = (1 - r) * ih, r * r * (3 - 2 * r)); }
        if (sel) a *= sel[y * W + x] * 0.00392156862745098;
        a *= strength; if (a > 1) a = 1;
        const pr = PT[pi], pg = PT[pi + 1], pb = PT[pi + 2], pa = PT[pi + 3];
        const nr = cr + (pr - cr) * a, ng = cg + (pg - cg) * a, nb = cb + (pb - cb) * a; let na = ca + (pa - ca) * a;
        PT[pi] = pr + (cr - pr) * tk; PT[pi + 1] = pg + (cg - pg) * tk; PT[pi + 2] = pb + (cb - pb) * tk; PT[pi + 3] = pa + (ca - pa) * tk;
        if (a < 0.002) continue;
        const dd = DITHER[dz = (dz + 1) & 4095] - 0.5;
        if (na > 0.0001) { const inv = 255 / na; t[o] = nr * inv + dd; t[o + 1] = ng * inv + dd; t[o + 2] = nb * inv + dd; }
        if (lock) na = ca;
        t[o + 3] = na * 255 + dd;
      }
    }
  }
  markDirty(L);
}

/* ---------- oil / acrylic ---------- */
function dabOil(S, sub, cx, cy, M, alpha, P, rad) {
  const R = dabRect(S, cx, cy, M); if (!R) return;
  const L = S.L, b = S.b, T = S.tip, sel = doc.sel, W = doc.w, lock = L.lockAlpha, tw = doc.tw, G = S.grain || grainSampler(1.2);
  const { i0, i1, i2, i3, h, ih } = tipSetup(M, rad, b.hardness);
  const ext = Math.max(Math.abs(M[0]) + Math.abs(M[1]), Math.abs(M[2]) + Math.abs(M[3]));
  const PT = ensurePatch(sub, ext), N = sub.patchN, half = N >> 1, rcx = Math.round(cx), rcy = Math.round(cy);
  // 1) pick up canvas colour under the brush into the reservoir
  let sr = 0, sg = 0, sbb = 0, sa = 0, n = 0;
  for (let k = 0; k < 16; k++) {
    const u = ((k & 3) - 1.5) / 2, v = ((k >> 2) - 1.5) / 2, x = Math.round(cx + M[0] * u + M[1] * v), y = Math.round(cy + M[2] * u + M[3] * v);
    if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) continue;
    const t = L.tiles[((y / TS) | 0) * tw + ((x / TS) | 0)]; n++; if (!t) continue;
    const o = ((y % TS) * TS + (x % TS)) * 4, a = t[o + 3] / 255; sr += t[o] / 255 * a; sg += t[o + 1] / 255 * a; sbb += t[o + 2] / 255 * a; sa += a;
  }
  if (n && sa > 0.01) {
    // pickup rate is defined per brush-diameter travelled, so spacing doesn't change how fast colours mix
    const avgA = sa / n, m = (1 - Math.pow(1 - b.mix * 0.3, Math.max(0.002, b.spacing))) * avgA;
    sub.res[0] += (sr / sa - sub.res[0]) * m; sub.res[1] += (sg / sa - sub.res[1]) * m; sub.res[2] += (sbb / sa - sub.res[2]) * m;
  }
  // 2) paint runs out over distance → dry-brush scumbling on the paper grain
  const stepLen = Math.max(0.5, b.spacing * rad * 2);
  sub.load = Math.max(0, sub.load - b.dry * stepLen);
  const load = sub.load, lthr = load >= 0.55 ? -1 : 1 - load / 0.55, lk = Math.min(1, load * 3);
  const rr = sub.res[0], rg = sub.res[1], rb = sub.res[2], smear = b.smear, imp = b.impasto * 1.6;
  const GG = G && G.G, gk = G ? G.k : 1;
  const first = !sub.init; sub.init = true;
  const take0 = 0.5 * (1 - smear * 0.6);
  let dz = (S.dabs * 53) & 4095;
  const tx0 = (R[0] / TS) | 0, ty0 = (R[1] / TS) | 0, tx1 = ((R[2] - 1) / TS) | 0, ty1 = ((R[3] - 1) / TS) | 0;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    const idx = ty * tw + tx, ox = tx * TS, oy = ty * TS;
    if (!S.orig.has(idx)) S.orig.set(idx, L.tiles[idx]);
    if (lock && !L.tiles[idx]) continue;
    const t = writeTile(L, idx);
    const ax = Math.max(R[0], ox), ay = Math.max(R[1], oy), bx = Math.min(R[2], ox + TS), by = Math.min(R[3], oy + TS);
    for (let y = ay; y < by; y++) {
      const py = y - rcy + half; if (py < 0 || py >= N) continue;
      const dy = y + 0.5 - cy; let o = ((y - oy) * TS + (ax - ox)) * 4;
      const grow = GG ? ((((y * gk) | 0) & 511) << 9) : 0;
      for (let x = ax; x < bx; x++, o += 4) {
        const px = x - rcx + half; if (px < 0 || px >= N) continue;
        const pi = (py * N + px) * 4;
        const ca = t[o + 3] * 0.00392156862745098, cr = t[o] * 0.00392156862745098 * ca, cg = t[o + 1] * 0.00392156862745098 * ca, cb = t[o + 2] * 0.00392156862745098 * ca;
        if (first) { PT[pi] = cr; PT[pi + 1] = cg; PT[pi + 2] = cb; PT[pi + 3] = ca; }
        const dx = x + 0.5 - cx, u = i0 * dx + i1 * dy, v = i2 * dx + i3 * dy, r2 = u * u + v * v;
        if (r2 >= 1) continue;
        let tipv; if (T) tipv = sampleTip(T, u, v); else { let r = Math.sqrt(r2); tipv = r <= h ? 1 : (r = (1 - r) * ih, r * r * (3 - 2 * r)); }
        let a = tipv * alpha;
        if (lthr > 0 && GG) { const gv = GG[grow + (((x * gk) | 0) & 511)]; let q = (gv - lthr) * 4; q = q < 0 ? 0 : q > 1 ? 1 : q; a *= q * lk; }
        if (sel) a *= sel[y * W + x] * 0.00392156862745098;
        if (a < 0.002) continue;
        // paint colour = reservoir mixed with smeared canvas paint carried in the patch
        const pa = PT[pi + 3], sm = smear * pa;
        let pr = rr, pg = rg, pb = rb;
        if (pa > 0.004) { const ip = 1 / pa; pr = rr + (PT[pi] * ip - rr) * sm; pg = rg + (PT[pi + 1] * ip - rg) * sm; pb = rb + (PT[pi + 2] * ip - rb) * sm; }
        const shade = 1 + imp * (tipv - 0.62);
        pr *= shade; pg *= shade; pb *= shade;
        const ia = 1 - a, nr = pr * a + cr * ia, ng = pg * a + cg * ia, nb = pb * a + cb * ia, na0 = a + ca * ia;
        // the brush drags wet canvas paint along (smear)
        const take = take0 * tipv;
        PT[pi] += (nr - PT[pi]) * take; PT[pi + 1] += (ng - PT[pi + 1]) * take; PT[pi + 2] += (nb - PT[pi + 2]) * take; PT[pi + 3] += (na0 - PT[pi + 3]) * take;
        const dd = DITHER[dz = (dz + 1) & 4095] - 0.5, inv = 255 / na0;
        t[o] = nr * inv + dd; t[o + 1] = ng * inv + dd; t[o + 2] = nb * inv + dd;
        t[o + 3] = (lock ? ca : na0) * 255 + dd;
      }
    }
  }
  markDirty(L);
}

/* ---------- liquify ---------- */
function dabLiquify(S, sub, cx, cy, rad, P) {
  const mode = S.subMode, L = S.L, b = S.b, str = b.strength * lerp(1, P.p, 0.5);
  let mvx = 0, mvy = 0;
  if (sub.lastX != null) { mvx = cx - sub.lastX; mvy = cy - sub.lastY; }
  if (mode === 'push' && !mvx && !mvy) return;
  const M = [rad, 0, 0, rad], R = dabRect(S, cx, cy, M); if (!R) return;
  const w = R[2] - R[0], hh = R[3] - R[1];
  // source: current pixels, plus a margin so pushes can pull from outside the dab
  const mg = Math.ceil(Math.hypot(mvx, mvy) * 2 + 4), sx = R[0] - mg, sy = R[1] - mg, sw = w + mg * 2, sh = hh + mg * 2;
  const src = readRegion(L, sx, sy, sw, sh);
  if (!S.lqOrig) S.lqOrig = new Map();
  const sel = doc.sel, W = doc.w, r2max = rad * rad;
  const sample = (fx, fy, out) => { // premultiplied bilinear
    fx -= sx + 0.5; fy -= sy + 0.5;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    out[0] = out[1] = out[2] = out[3] = 0;
    for (let k = 0; k < 4; k++) {
      const xx = x0 + (k & 1), yy = y0 + (k >> 1), wgt = (k & 1 ? ax : 1 - ax) * (k >> 1 ? ay : 1 - ay);
      if (xx < 0 || yy < 0 || xx >= sw || yy >= sh || !wgt) continue;
      const i = (yy * sw + xx) * 4, a = src[i + 3] / 255 * wgt;
      out[0] += src[i] * a; out[1] += src[i + 1] * a; out[2] += src[i + 2] * a; out[3] += a;
    }
  };
  const tmp = [0, 0, 0, 0]; let dz = (S.dabs * 31) & 4095;
  const recon = mode === 'reconstruct';
  forPixels(L, R, false, (t, o, x, y) => {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d2 = dx * dx + dy * dy; if (d2 >= r2max) return;
    let f = 1 - d2 / r2max; f = f * f * str; if (sel) f *= sel[y * W + x] / 255; if (f < 0.002) return;
    if (recon) {
      const idx = ((y / TS) | 0) * doc.tw + ((x / TS) | 0); const ot = S.orig.get(idx); const k = Math.min(1, f * 0.5);
      for (let c = 0; c < 4; c++) { const ov = ot ? ot[o + c] : 0; t[o + c] = t[o + c] + (ov - t[o + c]) * k + (DITHER[dz = (dz + 1) & 4095] - 0.5); }
      return;
    }
    let fx = x + 0.5, fy = y + 0.5;
    if (mode === 'push') { fx -= mvx * f * 1.2; fy -= mvy * f * 1.2; }
    else if (mode === 'twirl' || mode === 'twirl-ccw') { const a = (mode === 'twirl' ? 1 : -1) * f * 0.25, c = Math.cos(a), s = Math.sin(a); fx = cx + dx * c - dy * s; fy = cy + dx * s + dy * c; }
    else if (mode === 'pinch') { const k = 1 + f * 0.12; fx = cx + dx * k; fy = cy + dy * k; }
    else if (mode === 'bloat') { const k = 1 - f * 0.12; fx = cx + dx * k; fy = cy + dy * k; }
    sample(fx, fy, tmp);
    const dd = DITHER[dz = (dz + 1) & 4095] - 0.5;
    let na = tmp[3]; if (L.lockAlpha) na = t[o + 3] / 255;
    if (tmp[3] > 0.0001) { const inv = 1 / tmp[3]; t[o] = tmp[0] * inv + dd; t[o + 1] = tmp[1] * inv + dd; t[o + 2] = tmp[2] * inv + dd; }
    t[o + 3] = na * 255 + dd;
  }, S);
  markDirty(L);
}

/* run a whole stroke programmatically (sample painting, previews, shapes) */
function paintPath(pts, brush, color, o = {}) {
  const S = new Stroke({ layer: o.layer || doc.active, brush: fullBrush(brush), color, mode: o.mode, mats: o.mats, zoom: 1, subMode: o.subMode });
  let t = 0;
  for (const p of pts) { t += p.dt || 8; S.add({ x: p.x, y: p.y, p: p.p ?? 1, tx: p.tx || 0, ty: p.ty || 0, t }); }
  return S.end();
}
