'use strict';
/* Watercolor simulation. Each layer with wet paint owns a WetSim covering a growing rectangle of cells
   (1 cell = 1 px for small brushes, 2×2 px for washes). Per cell: water W, suspended pigment P
   (premultiplied rgba) and deposited pigment D. Work is block-sparse (32×32 cells): only wet blocks and
   their neighbours are simulated and re-rendered.
   Every tick: water spreads into the paper where the grain lets it (irregular, bleeding edges), pigment
   diffuses through wet paper and is carried by capillary flow toward drier cells (dark wet edges /
   coffee rings), pigment settles into paper valleys (granulation), water evaporates and on drying all
   remaining pigment is deposited. The layer shows base ⊕ (D + P) live, so strokes keep blooming for a
   moment after the pen lifts. */
const wetSims = new Map();
const WET_MAX_CELLS = 1.6e6, BS = 32;

function getWetSim(L, brush) {
  let s = wetSims.get(L);
  if (!s) { s = wetGLAvailable() ? new WetSimGL(L) : new WetSim(L, brush.size >= 64 ? 2 : 1); wetSims.set(L, s); }
  s.brush = brush; s.painting = true; s.age = 0;
  return s;
}
function dryWet(L) { const s = wetSims.get(L); if (s) s.finish(); }
function dryAllWet() { for (const s of [...wetSims.values()]) s.finish(); }
function discardAllWet() { for (const s of wetSims.values()) if (s.gpu) s.free(); wetSims.clear(); }
function wetBusy() { return wetSims.size > 0; }
let wetLast = 0, wetFrame = 0;
function tickWet(now) {
  if (!wetSims.size) { wetLast = now; return; }
  const dt = Math.min(50, now - (wetLast || now - 16)); wetLast = now; wetFrame++;
  const steps = dt > 26 ? 2 : 1;
  for (const s of [...wetSims.values()]) {
    for (let i = 0; i < steps; i++) s.tick();
    s.age += dt / 1000;
    if (!s.painting && s.age > s.dryLimit) s.finish();
    else s.render(s.painting ? 10 : 6);
  }
}

class WetSim {
  constructor(L, scale) {
    this.L = L; this.s = scale; this.x0 = 0; this.y0 = 0; this.w = 0; this.h = 0;
    this.W = null; this.touched = new Set(); this.age = 0; this.painting = true; this.dryLimit = 2;
    this.evap = 0.0006; this.firstState = null; this.anyAct = false;
    this.G = grainMap(doc.paper === 'none' ? 'cold' : doc.paper) || grainMap('cold');
  }
  /* grow simulation region to include doc rect (px) */
  ensure(x0, y0, x1, y1) {
    const s = this.s, cw = Math.ceil(doc.w / s), ch = Math.ceil(doc.h / s), m = 96;
    let nx0 = Math.max(0, Math.floor((x0 - m) / s)), ny0 = Math.max(0, Math.floor((y0 - m) / s));
    let nx1 = Math.min(cw, Math.ceil((x1 + m) / s)), ny1 = Math.min(ch, Math.ceil((y1 + m) / s));
    if (this.W && nx0 >= this.x0 && ny0 >= this.y0 && nx1 <= this.x0 + this.w && ny1 <= this.y0 + this.h) return;
    if (this.W) {
      nx0 = Math.min(nx0, this.x0); ny0 = Math.min(ny0, this.y0); nx1 = Math.max(nx1, this.x0 + this.w); ny1 = Math.max(ny1, this.y0 + this.h);
      // geometric growth so a long stroke reallocates only a few times
      const gx = Math.round((nx1 - nx0) * 0.5), gy = Math.round((ny1 - ny0) * 0.5);
      if (nx0 < this.x0) nx0 = Math.max(0, nx0 - gx); if (nx1 > this.x0 + this.w) nx1 = Math.min(cw, nx1 + gx);
      if (ny0 < this.y0) ny0 = Math.max(0, ny0 - gy); if (ny1 > this.y0 + this.h) ny1 = Math.min(ch, ny1 + gy);
    }
    // align origin to blocks (keeps block grids of old and new regions aligned)
    nx0 = Math.floor(nx0 / BS) * BS; ny0 = Math.floor(ny0 / BS) * BS;
    const w = nx1 - nx0, h = ny1 - ny0;
    if (w * h > WET_MAX_CELLS && s === 1) { this.rescale(); return this.ensure(x0, y0, x1, y1); }
    const n = w * h, W = new Float32Array(n), P = new Float32Array(n * 4), D = new Float32Array(n * 4);
    const bw = Math.ceil(w / BS), bh = Math.ceil(h / BS), act = new Uint8Array(bw * bh), dirty = new Uint8Array(bw * bh);
    const bx = nx0 * s, by = ny0 * s, bW = Math.min(doc.w, nx1 * s) - bx, bH = Math.min(doc.h, ny1 * s) - by;
    const base = readRegion(this.L, bx, by, bW, bH);
    if (this.W) {
      const ox = this.x0 - nx0, oy = this.y0 - ny0;
      for (let y = 0; y < this.h; y++) {
        const r0 = y * this.w, r1 = (y + oy) * w + ox;
        W.set(this.W.subarray(r0, r0 + this.w), r1); P.set(this.P.subarray(r0 * 4, (r0 + this.w) * 4), r1 * 4); D.set(this.D.subarray(r0 * 4, (r0 + this.w) * 4), r1 * 4);
      }
      const obx = this.bx - bx, oby = this.by - by;
      for (let y = 0; y < this.bH; y++) base.set(this.base.subarray(y * this.bW * 4, (y + 1) * this.bW * 4), ((y + oby) * bW + obx) * 4);
      const obw = this.bw, bxo = ox / BS, byo = oy / BS;
      for (let j = 0; j < this.bh; j++) for (let i = 0; i < obw; i++) { act[(j + byo) * bw + i + bxo] = this.act[j * obw + i]; dirty[(j + byo) * bw + i + bxo] = this.dirtyB[j * obw + i]; }
    }
    Object.assign(this, { x0: nx0, y0: ny0, w, h, W, P, D, W2: new Float32Array(n), P2: new Float32Array(n * 4), base, bx, by, bW, bH, bw, bh, act, dirtyB: dirty, list: new Int32Array(bw * bh) });
  }
  rescale() { // switch from 1 px cells to 2×2 px cells
    const ow = this.w, oh = this.h, w = Math.ceil(ow / 2), h = Math.ceil(oh / 2), n = w * h;
    const W = new Float32Array(n), P = new Float32Array(n * 4), D = new Float32Array(n * 4);
    for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
      const i = y * ow + x, j = (y >> 1) * w + (x >> 1); W[j] += this.W[i] / 4;
      for (let c = 0; c < 4; c++) { P[j * 4 + c] += this.P[i * 4 + c] / 4; D[j * 4 + c] += this.D[i * 4 + c] / 4; }
    }
    const nx0 = this.x0 >> 1, ny0 = this.y0 >> 1; // x0 is block aligned (even)
    const bw = Math.ceil(w / BS), bh = Math.ceil(h / BS), act = new Uint8Array(bw * bh).fill(1), dirty = new Uint8Array(bw * bh).fill(1);
    Object.assign(this, { s: 2, x0: nx0, y0: ny0, w, h, W, P, D, W2: new Float32Array(n), P2: new Float32Array(n * 4), bw, bh, act, dirtyB: dirty, list: new Int32Array(bw * bh) });
    this.anyAct = true;
    // base keeps full resolution; its region (bx,by,bW,bH) is unchanged and still covers the cells
  }
  markBlocks(cx0, cy0, cx1, cy1) { // region cells, exclusive end
    const b0 = Math.max(0, (cx0 / BS) | 0), b1 = Math.min(this.bw - 1, ((cx1 - 1) / BS) | 0), c0 = Math.max(0, (cy0 / BS) | 0), c1 = Math.min(this.bh - 1, ((cy1 - 1) / BS) | 0);
    for (let j = c0; j <= c1; j++) for (let i = b0; i <= b1; i++) { this.act[j * this.bw + i] = 1; this.dirtyB[j * this.bw + i] = 2; }
    this.anyAct = true;
  }
  /* dab: put water + pigment */
  deposit(S, cx, cy, M, alpha, col, P, rad) {
    const R = dabRect(S, cx, cy, M, 2); if (!R) return;
    this.ensure(R[0], R[1], R[2], R[3]);
    const b = this.brush, s = this.s, T = S.tip, sel = doc.sel, G = this.G, dw = doc.w, dh = doc.h;
    const { i0, i1, i2, i3, h, ih } = tipSetup(M, rad, b.hardness);
    const cx0 = Math.max(this.x0, Math.floor(R[0] / s)), cy0 = Math.max(this.y0, Math.floor(R[1] / s)), cx1 = Math.min(this.x0 + this.w, Math.ceil(R[2] / s)), cy1 = Math.min(this.y0 + this.h, Math.ceil(R[3] / s));
    const water = b.water * (0.55 + 0.45 * P.p), pig = b.pigment * alpha;
    const cr = col[0], cg = col[1], cbb = col[2];
    const gk = 1 / Math.max(0.25, b.grainScale * (doc.paperScale || 1)), gd = b.grain, gthr = 1 - (0.35 + 0.45 * P.p);
    const Wa = this.W, Pa = this.P, rw = this.w, ox = this.x0, oy = this.y0;
    for (let y = cy0; y < cy1; y++) {
      const py = (y + 0.5) * s, dy = py - cy, gy = ((((py * gk) | 0) & 511) << 9), sy = Math.min(dh - 1, py | 0) * dw;
      for (let x = cx0; x < cx1; x++) {
        const px = (x + 0.5) * s, dx = px - cx, u = i0 * dx + i1 * dy, v = i2 * dx + i3 * dy, r2 = u * u + v * v;
        if (r2 >= 1) continue;
        let a; if (T) a = sampleTip(T, u, v); else { let r = Math.sqrt(r2); a = r <= h ? 1 : (r = (1 - r) * ih, r * r * (3 - 2 * r)); }
        if (gd) { const g = G[gy + (((px * gk) | 0) & 511)]; let q = (g - gthr) * 4; q = q < 0 ? 0 : q > 1 ? 1 : q; a *= 1 - gd + gd * q; }
        if (sel) a *= sel[sy + Math.min(dw - 1, px | 0)] / 255;
        if (a < 0.003) continue;
        const i = (y - oy) * rw + (x - ox), j = i * 4, wa = water * (a > 0.333 ? 1 : a * 3);
        if (Wa[i] < wa) Wa[i] = wa; else Wa[i] = Math.min(1.8, Wa[i] + wa * 0.05);
        const target = pig * (a > 0.4545 ? 1 : a * 2.2), cur = Pa[j + 3];
        const add = (target > cur ? (target - cur) * 0.5 : 0) + target * 0.045;
        Pa[j] += cr * add; Pa[j + 1] += cg * add; Pa[j + 2] += cbb * add; Pa[j + 3] += add;
      }
    }
    this.markBlocks(cx0 - ox, cy0 - oy, cx1 - ox, cy1 - oy);
  }
  endStroke() {
    this.painting = false; this.age = 0;
    const b = this.brush; this.dryLimit = b.dryTime * 1.4 + 0.4;
    this.evap = 1 / (Math.max(0.3, b.dryTime) * 60) * 0.8;
  }
  tick() {
    if (!this.anyAct) return;
    const w = this.w, h = this.h, W = this.W, P = this.P, D = this.D, W2 = this.W2, P2 = this.P2, G = this.G, s = this.s;
    const b = this.brush, kw = (0.1 + 0.14 * b.bleed) * 0.25, kp = 0.18 * 0.25, ke = 0.9 * b.edge, gran = b.gran * 0.022;
    const evap = this.painting ? 0.0007 : this.evap, bleedT = 1.02 - 0.5 * b.bleed;
    const bw = this.bw, bh = this.bh, act = this.act, list = this.list;
    // blocks to simulate: active ones plus their neighbours
    let n = 0;
    for (let j = 0; j < bh; j++) for (let i = 0; i < bw; i++) {
      const k = j * bw + i;
      if (act[k] || (i > 0 && act[k - 1]) || (i < bw - 1 && act[k + 1]) || (j > 0 && act[k - bw]) || (j < bh - 1 && act[k + bw])) list[n++] = k;
    }
    if (!n) { this.anyAct = false; return; }
    const gox = this.x0 * s, goy = this.y0 * s;
    let anyLive = 0;
    for (let q = 0; q < n; q++) {
      const k = list[q], bx = (k % bw) * BS, by = ((k / bw) | 0) * BS, ex = Math.min(w, bx + BS), ey = Math.min(h, by + BS);
      let live = 0, had = 0;
      for (let y = by; y < ey; y++) {
        const gy = ((((y * s + goy) >> 1) & 511) << 9), row = y * w;
        for (let x = bx; x < ex; x++) {
          const i = row + x, j = i << 2, wi = W[i];
          const iL = x > 0 ? i - 1 : i, iR = x < w - 1 ? i + 1 : i, iU = y > 0 ? i - w : i, iD = y < h - 1 ? i + w : i;
          const wl = W[iL], wr = W[iR], wu = W[iU], wd = W[iD];
          const pa0 = P[j + 3];
          if (wi <= 0 && pa0 <= 0 && wl <= 0 && wr <= 0 && wu <= 0 && wd <= 0) { W2[i] = 0; P2[j] = 0; P2[j + 1] = 0; P2[j + 2] = 0; P2[j + 3] = 0; continue; }
          had = 1;
          const g = G[gy + (((x * s + gox) >> 1) & 511)];
          // --- water
          let nw = wi;
          if (wi > 0) {
            let sum = 0, dry = 0;
            if (wl > 0) sum += wl - wi; else dry++;
            if (wr > 0) sum += wr - wi; else dry++;
            if (wu > 0) sum += wu - wi; else dry++;
            if (wd > 0) sum += wd - wi; else dry++;
            nw += kw * sum;
            if (dry && wi > 0.14) nw -= wi * kw * 0.5 * dry;
          } else {
            let mx = wl; if (wr > mx) mx = wr; if (wu > mx) mx = wu; if (wd > mx) mx = wd;
            if (mx > 0.22 && g + mx * 0.15 > bleedT) nw = mx * kw * 1.5;
          }
          nw -= evap * (nw < 0.5 ? 2.2 - nw * 2.4 : 1);
          if (nw < 0.004) nw = 0;
          W2[i] = nw;
          // --- pigment
          let pr = P[j], pg = P[j + 1], pb = P[j + 2], pa = pa0;
          if (wi > 0) {
            // diffusion (only through wet paper) + capillary flow toward drier neighbours
            let nn = iL, wn = wl;
            for (let e = 0; e < 4; e++) {
              if (e === 1) { nn = iR; wn = wr; } else if (e === 2) { nn = iU; wn = wu; } else if (e === 3) { nn = iD; wn = wd; }
              if (wn <= 0) continue;
              const m4 = nn << 2, mn = wi < wn ? wi : wn, c = kp * (mn > 0.33 ? 1 : mn * 3);
              const qr = P[m4], qg = P[m4 + 1], qb = P[m4 + 2], qa = P[m4 + 3];
              pr += (qr - P[j]) * c; pg += (qg - P[j + 1]) * c; pb += (qb - P[j + 2]) * c; pa += (qa - pa0) * c;
              const dw = wn - wi;
              if (dw > 0) { let f = ke * dw * 0.25; if (f > 0.05) f = 0.05; pr += qr * f; pg += qg * f; pb += qb * f; pa += qa * f; }
              else { let f = -ke * dw * 0.25; if (f > 0.05) f = 0.05; pr -= P[j] * f; pg -= P[j + 1] * f; pb -= P[j + 2] * f; pa -= pa0 * f; }
            }
            if (pa < 0) pa = 0; if (pr < 0) pr = 0; if (pg < 0) pg = 0; if (pb < 0) pb = 0;
          }
          if (pa > 0) {
            // settle: granulation into paper valleys; all of it once dry
            const dep = nw <= 0 ? 1 : 0.003 + gran * (1 - g) * (1 - g);
            D[j] += pr * dep; D[j + 1] += pg * dep; D[j + 2] += pb * dep; D[j + 3] += pa * dep;
            const k1 = 1 - dep; pr *= k1; pg *= k1; pb *= k1; pa *= k1;
            if (pa < 2e-4) pr = pg = pb = pa = 0;
          }
          P2[j] = pr; P2[j + 1] = pg; P2[j + 2] = pb; P2[j + 3] = pa;
          if (nw > 0 || pa > 0) live = 1;
        }
      }
      act[k] = live; if (had && !this.dirtyB[k]) this.dirtyB[k] = 1; anyLive |= live;
    }
    // copy back simulated blocks
    for (let q = 0; q < n; q++) {
      const k = list[q], bx = (k % bw) * BS, by = ((k / bw) | 0) * BS, ex = Math.min(w, bx + BS), ey = Math.min(h, by + BS);
      for (let y = by; y < ey; y++) { const r = y * w; W.set(W2.subarray(r + bx, r + ex), r + bx); P.set(P2.subarray((r + bx) << 2, (r + ex) << 2), (r + bx) << 2); }
    }
    this.anyAct = !!anyLive;
  }
  /* write base ⊕ wet paint into the layer for dirty blocks (fresh deposits first, others rate-limited) */
  render(budgetMs = 1e9) {
    const t0 = performance.now(), dB = this.dirtyB;
    if (!dB) return;
    const n = this.bw * this.bh;
    for (let k = 0; k < n; k++) if (dB[k] === 2) { dB[k] = 0; this.renderBlock(k); }
    // continue round-robin so long washes don't stall the frame
    const start = this.rr || 0;
    for (let c = 0; c < n; c++) {
      const k = (start + c) % n; if (dB[k] !== 1) continue;
      if (performance.now() - t0 > budgetMs) { this.rr = k; return; }
      dB[k] = 0; this.renderBlock(k);
    }
    this.rr = 0;
  }
  renderBlock(k) {
    const s = this.s, L = this.L, bw = this.bw;
    const cbx = (k % bw) * BS, cby = ((k / bw) | 0) * BS;
    const X0 = (this.x0 + cbx) * s, Y0 = (this.y0 + cby) * s, X1 = Math.min(doc.w, (this.x0 + Math.min(this.w, cbx + BS)) * s), Y1 = Math.min(doc.h, (this.y0 + Math.min(this.h, cby + BS)) * s);
    if (X0 >= X1 || Y0 >= Y1) return;
    const w = this.w, h = this.h, P = this.P, D = this.D, base = this.base, bW = this.bW, bxo = this.bx, byo = this.by, ox = this.x0, oy = this.y0;
    const sel = doc.sel, Wd = doc.w, lock = L.lockAlpha, inv = 1 / s, tw = doc.tw;
    let dz = (k * 37) & 4095;
    for (let ty = (Y0 / TS) | 0; ty <= ((Y1 - 1) / TS | 0); ty++) for (let tx = (X0 / TS) | 0; tx <= ((X1 - 1) / TS | 0); tx++) {
      const idx = ty * tw + tx, otx = tx * TS, oty = ty * TS;
      const ax = Math.max(X0, otx), ay = Math.max(Y0, oty), ex = Math.min(X1, otx + TS), ey = Math.min(Y1, oty + TS);
      // don't create tiles where there is no paint at all
      if (!L.tiles[idx]) {
        let any = false;
        for (let y = ay; y < ey && !any; y += s) { const r = (((y * inv) | 0) - oy) * w - ox; for (let x = ax; x < ex; x += s) { const j = (r + ((x * inv) | 0)) * 4; if (D[j + 3] + P[j + 3] > 0.0005) { any = true; break; } } }
        if (!any) continue;
      }
      const t = writeTile(L, idx); this.touched.add(idx);
      for (let y = ay; y < ey; y++) {
        let o = ((y - oty) * TS + (ax - otx)) * 4;
        let fy = (y + 0.5) * inv - 0.5 - oy; if (fy < 0) fy = 0; if (fy > h - 1) fy = h - 1;
        const yi = fy | 0, ay2 = fy - yi, y2 = yi < h - 1 ? yi + 1 : yi, r0 = yi * w, r1 = y2 * w;
        const brow = (y - byo) * bW - bxo;
        for (let x = ax; x < ex; x++, o += 4) {
          let wr = 0, wg = 0, wb = 0, wa;
          if (s === 1) { const j = (r0 + x - ox) << 2; wa = D[j + 3] + P[j + 3]; if (wa > 0.0005) { wr = D[j] + P[j]; wg = D[j + 1] + P[j + 1]; wb = D[j + 2] + P[j + 2]; } }
          else {
            let fx = (x + 0.5) * inv - 0.5 - ox; if (fx < 0) fx = 0; if (fx > w - 1) fx = w - 1;
            const xi = fx | 0, ax2 = fx - xi, x2 = xi < w - 1 ? xi + 1 : xi;
            const j00 = (r0 + xi) << 2, j10 = (r0 + x2) << 2, j01 = (r1 + xi) << 2, j11 = (r1 + x2) << 2;
            const w00 = (1 - ax2) * (1 - ay2), w10 = ax2 * (1 - ay2), w01 = (1 - ax2) * ay2, w11 = ax2 * ay2;
            wa = (D[j00 + 3] + P[j00 + 3]) * w00 + (D[j10 + 3] + P[j10 + 3]) * w10 + (D[j01 + 3] + P[j01 + 3]) * w01 + (D[j11 + 3] + P[j11 + 3]) * w11;
            if (wa > 0.0005) {
              wr = (D[j00] + P[j00]) * w00 + (D[j10] + P[j10]) * w10 + (D[j01] + P[j01]) * w01 + (D[j11] + P[j11]) * w11;
              wg = (D[j00 + 1] + P[j00 + 1]) * w00 + (D[j10 + 1] + P[j10 + 1]) * w10 + (D[j01 + 1] + P[j01 + 1]) * w01 + (D[j11 + 1] + P[j11 + 1]) * w11;
              wb = (D[j00 + 2] + P[j00 + 2]) * w00 + (D[j10 + 2] + P[j10 + 2]) * w10 + (D[j01 + 2] + P[j01 + 2]) * w01 + (D[j11 + 2] + P[j11 + 2]) * w11;
            }
          }
          const bi = (brow + x) * 4;
          if (wa <= 0.0005) { t[o] = base[bi]; t[o + 1] = base[bi + 1]; t[o + 2] = base[bi + 2]; t[o + 3] = base[bi + 3]; continue; }
          const ba = base[bi + 3] * 0.00392156862745098, br = base[bi] * 0.00392156862745098, bg = base[bi + 1] * 0.00392156862745098, bb = base[bi + 2] * 0.00392156862745098;
          if (wa > 1) { const q = 1 / wa; wr *= q; wg *= q; wb *= q; wa = 1; }
          // transparent pigment glazing: over-composite, darkened multiplicatively where it lies on paint
          const ia = 1 / wa, sr = wr * ia, sg = wg * ia, sb = wb * ia, ow = ba * (1 - wa);
          let oa = wa + ow; const m = 1 / oa;
          let rr = (wr + br * ow) * m, rg = (wg + bg * ow) * m, rb = (wb + bb * ow) * m;
          if (ba > 0) { const q = ba * 0.7, k1 = 1 - wa; rr += (br * (k1 + sr * wa) - rr) * q; rg += (bg * (k1 + sg * wa) - rg) * q; rb += (bb * (k1 + sb * wa) - rb) * q; }
          if (lock) oa = ba;
          if (sel) { const sv = sel[y * Wd + x] * 0.00392156862745098; if (sv < 1) { rr = br + (rr - br) * sv; rg = bg + (rg - bg) * sv; rb = bb + (rb - bb) * sv; oa = ba + (oa - ba) * sv; } }
          const dd = DITHER[dz = (dz + 1) & 4095] - 0.5;
          t[o] = rr * 255 + dd; t[o + 1] = rg * 255 + dd; t[o + 2] = rb * 255 + dd; t[o + 3] = oa * 255 + dd;
        }
      }
    }
    markDirty(L);
  }
  /* settle everything now (fast-forward a little, then deposit) */
  finish(maxMs = 120) {
    if (wetSims.get(this.L) !== this) return;
    wetSims.delete(this.L);
    if (!this.W) return;
    const t0 = performance.now();
    this.painting = false; if (this.evap < 0.01) this.evap = 0.02;
    let n = 0; while (this.anyAct && n < 300 && (performance.now() - t0 < maxMs)) { this.tick(); n++; }
    const P = this.P, D = this.D, act = this.act, bw = this.bw;
    for (let k = 0; k < act.length; k++) {
      if (!act[k]) continue;
      const bx = (k % bw) * BS, by = ((k / bw) | 0) * BS, ex = Math.min(this.w, bx + BS), ey = Math.min(this.h, by + BS);
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) { const j = (y * this.w + x) * 4; D[j] += P[j]; D[j + 1] += P[j + 1]; D[j + 2] += P[j + 2]; D[j + 3] += P[j + 3]; P[j] = P[j + 1] = P[j + 2] = P[j + 3] = 0; }
      this.dirtyB[k] = 1;
    }
    this.W.fill(0); this.anyAct = false;
    this.render();
    if (typeof onWetDried === 'function') onWetDried(this);
  }
}
