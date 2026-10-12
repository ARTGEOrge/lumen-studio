'use strict';
/* Lumen Darkroom — automatic Upright (Level / Vertical / Auto / Full).
   1. line segments: LSD-style region growing on the gradient level-line angle, PCA line fit
   2. vanishing points: RANSAC over segment pairs for the near-vertical and near-horizontal families
   3. solve the Transform sliders (vertical, horizontal, rotate) through Geo.uprightMatrix so the inlier
      verticals become vertical (and, for Full / Auto, the dominant horizontals horizontal). */
const Upright = (() => {
  const DEG = Math.PI / 180;
  // img: ImageData → segments [{x1,y1,x2,y2,len}] in pixels
  function segments(img) {
    const w = img.width, h = img.height, d = img.data, n = w * h, Y = new Float32Array(n);
    for (let i = 0; i < n; i++) Y[i] = .2126 * d[i * 4] + .7152 * d[i * 4 + 1] + .0722 * d[i * 4 + 2];
    const mag = new Float32Array(n), ang = new Float32Array(n);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, gx = Y[i + 1 - w] + 2 * Y[i + 1] + Y[i + 1 + w] - Y[i - 1 - w] - 2 * Y[i - 1] - Y[i - 1 + w], gy = Y[i + w - 1] + 2 * Y[i + w] + Y[i + w + 1] - Y[i - w - 1] - 2 * Y[i - w] - Y[i - w + 1];
      mag[i] = Math.hypot(gx, gy); ang[i] = Math.atan2(gx, -gy);   // level-line angle
    }
    const thr = 48, idx = []; for (let i = 0; i < n; i++) if (mag[i] > thr) idx.push(i);
    idx.sort((a, b) => mag[b] - mag[a]);
    const used = new Uint8Array(n), tau = 22.5 * DEG, out = [];
    const adiff = (a, b) => { let t = Math.abs(a - b) % (2 * Math.PI); return t > Math.PI ? 2 * Math.PI - t : t; };
    for (const seed of idx) {
      if (used[seed]) continue;
      const reg = [seed]; used[seed] = 1; let sc = Math.cos(ang[seed]), ss = Math.sin(ang[seed]), ra = ang[seed];
      for (let k = 0; k < reg.length && reg.length < 4000; k++) {
        const i = reg[k], x = i % w, y = (i / w) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy; if (xx < 1 || yy < 1 || xx >= w - 1 || yy >= h - 1) continue;
          const j = yy * w + xx; if (used[j] || mag[j] <= thr || adiff(ang[j], ra) > tau) continue;
          used[j] = 1; reg.push(j); sc += Math.cos(ang[j]); ss += Math.sin(ang[j]); ra = Math.atan2(ss, sc);
        }
      }
      if (reg.length < 12) continue;
      let mx = 0, my = 0, wsum = 0; reg.forEach(i => { const m = mag[i]; mx += (i % w) * m; my += ((i / w) | 0) * m; wsum += m; }); mx /= wsum; my /= wsum;
      let cxx = 0, cyy = 0, cxy = 0; reg.forEach(i => { const m = mag[i], dx = i % w - mx, dy = ((i / w) | 0) - my; cxx += m * dx * dx; cyy += m * dy * dy; cxy += m * dx * dy; });
      const th = .5 * Math.atan2(2 * cxy, cxx - cyy), ux = Math.cos(th), uy = Math.sin(th);
      let lo = Infinity, hi = -Infinity, wlo = Infinity, whi = -Infinity;
      reg.forEach(i => { const dx = i % w - mx, dy = ((i / w) | 0) - my, t = dx * ux + dy * uy, q = -dx * uy + dy * ux; lo = Math.min(lo, t); hi = Math.max(hi, t); wlo = Math.min(wlo, q); whi = Math.max(whi, q); });
      const len = hi - lo, wid = whi - wlo;
      if (len < 25 || wid > Math.max(3.5, len * .12)) continue;
      if (adiff(Math.atan2(uy, ux), ra) > 25 * DEG && adiff(Math.atan2(uy, ux) + Math.PI, ra) > 25 * DEG) continue;   // fit must follow the level line
      out.push({ x1: mx + ux * lo, y1: my + uy * lo, x2: mx + ux * hi, y2: my + uy * hi, len });
    }
    return out;
  }
  // RANSAC vanishing point for segments within maxTilt of the given axis ('v' | 'h'); returns inlier segments
  function vpFamily(segs, axis, maxTilt = 35) {
    const cand = segs.filter(s => { const a = Math.abs(Math.atan2(s.y2 - s.y1, s.x2 - s.x1)) / DEG; const t = axis === 'v' ? Math.abs(90 - a) : Math.min(a, 180 - a); return t < maxTilt; });
    if (cand.length < 2) return { inl: cand, vp: null };
    const line = s => [s.y1 - s.y2, s.x2 - s.x1, s.x1 * s.y2 - s.x2 * s.y1];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const consistent = (s, v) => {
      const mx = (s.x1 + s.x2) / 2, my = (s.y1 + s.y2) / 2, nv = Math.hypot(v[0], v[1], v[2]) || 1;
      const dx = Math.abs(v[2] / nv) < 1e-9 ? v[0] : v[0] / v[2] - mx, dy = Math.abs(v[2] / nv) < 1e-9 ? v[1] : v[1] / v[2] - my;
      const a1 = Math.atan2(s.y2 - s.y1, s.x2 - s.x1), a2 = Math.atan2(dy, dx); let t = Math.abs(a1 - a2) % Math.PI; if (t > Math.PI / 2) t = Math.PI - t;
      return t < 1.5 * DEG;
    };
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    let best = { score: -1, inl: [], vp: null };
    const lines = cand.map(line), W = cand.reduce((a, s) => a + s.len, 0);
    for (let it = 0; it < 400; it++) {
      const i = Math.floor(rnd() * cand.length), j = Math.floor(rnd() * cand.length); if (i === j) continue;
      const v = cross(lines[i], lines[j]); if (!v.some(Number.isFinite)) continue;
      let sc = 0; const inl = []; cand.forEach(s => { if (consistent(s, v)) { sc += s.len; inl.push(s); } });
      if (sc > best.score) best = { score: sc, inl, vp: v };
      if (sc > W * .9) break;
    }
    return best;
  }
  // solve the sliders; mode: 'vertical' | 'auto' | 'full'
  function solve(segs, w, h, mode) {
    const L = Math.max(w, h), V = vpFamily(segs, 'v'), Hf = vpFamily(segs, 'h');
    const toC = s => [[(s.x1 - w / 2) / L, (s.y1 - h / 2) / L], [(s.x2 - w / 2) / L, (s.y2 - h / 2) / L]];
    const vs = V.inl.map(s => ({ p: toC(s), w: s.len })), hs = Hf.inl.map(s => ({ p: toC(s), w: s.len }));
    const vW = vs.reduce((a, s) => a + s.w, 0), hW = hs.reduce((a, s) => a + s.w, 0);
    if (vW < h * .25 || vs.length < 2) return { error: 'not enough vertical lines were found', v: vs.length, h: hs.length };
    const useH = mode !== 'vertical' && hs.length >= 2 && hW > w * .2;
    const huber = t => { const c = 6 * DEG; return t < c ? t * t : c * (2 * t - c); };
    const cost = ([vert, horiz, rot, f]) => {
      const M = Geo.uprightMatrix({ vert, horiz, rotate: rot, aspect: 0, f });
      const dir = s => { const a = Geo.ap3(M, s.p[0][0], s.p[0][1]), b = Geo.ap3(M, s.p[1][0], s.p[1][1]); return [b[0] - a[0], b[1] - a[1], a[2] > 0 && b[2] > 0]; };
      let cv = 0; for (const s of vs) { const d = dir(s); if (!d[2]) return 1e9; cv += s.w * huber(Math.atan2(Math.abs(d[0]), Math.abs(d[1]))); }
      let c = cv / vW;
      if (useH) { let ch = 0; for (const s of hs) { const d = dir(s); if (!d[2]) return 1e9; ch += s.w * huber(Math.atan2(Math.abs(d[1]), Math.abs(d[0]))); } c += (mode === 'full' ? .6 : .35) * ch / hW; }
      if (mode === 'auto') c += 4e-4 * ((vert / 100) ** 2 + (horiz / 100) ** 2);      // balanced: prefer milder corrections
      return c;
    };
    // the focal length (in long-edge units) is only observable with both line families: estimate it for Full / Auto
    const free = mode === 'vertical' ? [true, false, true, false] : [true, useH, true, useH];
    const lim = [[-100, 100], [-100, 100], [-10, 10], [.4, 2.5]];
    // coarse grid then pattern search
    const grid = [];
    for (let a = -100; a <= 100; a += 10) for (let b = free[1] ? -100 : 0; b <= (free[1] ? 100 : 0); b += 10) for (let r = -10; r <= 10; r += 1) for (const f of free[3] ? [.6, .8, 1, 1.3, 1.8] : [1]) grid.push([cost([a, b, r, f]), [a, b, r, f]]);
    grid.sort((x, y) => x[0] - y[0]);
    let best = [0, 0, 0, 1], bc = Infinity;
    for (const [, start] of grid.slice(0, 6)) {    // multi-start pattern search from the best grid cells
      let cur = start.slice(), cc = cost(cur), step = [5, 5, .5, .1];
      while (step[0] > .02) {
        let improved = false;
        for (let k = 0; k < 4; k++) { if (!free[k]) continue; for (const sg of [-1, 1]) { const t = cur.slice(); t[k] = Math.max(lim[k][0], Math.min(lim[k][1], t[k] + sg * step[k])); const c = cost(t); if (c < cc - 1e-14) { cc = c; cur = t; improved = true; } } }
        if (!improved) step = step.map(x => x / 2);
      }
      if (cc < bc) { bc = cc; best = cur; }
    }
    return { f: Math.round(best[3] * 1000) / 1000, vert: Math.round(best[0] * 10) / 10, horiz: Math.round(best[1] * 10) / 10, rotate: Math.round(best[2] * 100) / 100, cost: bc, v: vs.length, h: hs.length, usedH: useH, vpV: V.vp, vpH: Hf.vp };
  }
  return { segments, vpFamily, solve };
})();
