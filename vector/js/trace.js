'use strict';
/* Lumen Vector — Image Trace: turns a placed bitmap into editable vector paths.
   Pipeline (all local, no libraries): preprocess (B&W threshold / grayscale / sketch edges / colour) → k-means colour
   quantisation → small-region (noise) removal → stacked layer masks → crack-following contour tracing with holes →
   corner detection + least-squares Bézier fitting (paper's PathFitter via Path.simplify) per run between corners.
   A trace stays "live" (data.kind 'trace': hidden source raster + result group) until Expanded or Released. */
(function () {
  const TR = LV.trace = {};
  TR.PRESETS = {
    bw: { name: 'Black and White', mode: 'bw', threshold: 128, colors: 2, paths: 55, corners: 50, noise: 12, ignoreWhite: true },
    color3: { name: '3 Colors', mode: 'color', threshold: 128, colors: 3, paths: 55, corners: 50, noise: 20, ignoreWhite: false },
    color6: { name: '6 Colors', mode: 'color', threshold: 128, colors: 6, paths: 60, corners: 50, noise: 16, ignoreWhite: false },
    color16: { name: '16 Colors', mode: 'color', threshold: 128, colors: 16, paths: 70, corners: 45, noise: 10, ignoreWhite: false },
    gray: { name: 'Shades of Gray', mode: 'gray', threshold: 128, colors: 6, paths: 60, corners: 50, noise: 16, ignoreWhite: false },
    sketch: { name: 'Sketched Art', mode: 'sketch', threshold: 120, colors: 2, paths: 45, corners: 35, noise: 14, ignoreWhite: true },
    silhouette: { name: 'Silhouettes', mode: 'bw', threshold: 200, colors: 2, paths: 45, corners: 50, noise: 30, ignoreWhite: true }
  };
  TR.DEFAULT = { preset: 'bw', ...TR.PRESETS.bw, maxSize: 800, view: 'result' };
  TR.sanitize = s => {
    const d = { ...TR.DEFAULT }, n = (v, lo, hi, def) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def; };
    if (!s || typeof s !== 'object') return d;
    if (TR.PRESETS[s.preset] || s.preset === 'custom') d.preset = s.preset;
    if (['bw', 'color', 'gray', 'sketch'].includes(s.mode)) d.mode = s.mode;
    d.threshold = Math.round(n(s.threshold, 0, 255, 128)); d.colors = Math.round(n(s.colors, 2, 64, 6)); d.paths = n(s.paths, 0, 100, 50); d.corners = n(s.corners, 0, 100, 50);
    d.noise = Math.round(n(s.noise, 1, 400, 12)); d.ignoreWhite = !!s.ignoreWhite; d.maxSize = Math.round(n(s.maxSize, 100, 2000, 800)); d.view = ['result', 'source', 'overlay', 'outline'].includes(s.view) ? s.view : 'result';
    return d;
  };

  /* ---------- 1. pixels ---------- */
  function pixelsOf(raster, maxSize) {
    const img = raster.image || raster.canvas; if (!img) return null;
    const w0 = raster.width, h0 = raster.height; if (!w0 || !h0) return null;
    const k = Math.min(1, maxSize / Math.max(w0, h0)), w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h; const g = c.getContext('2d', { willReadFrequently: true });
    g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, w, h);
    return { w, h, data: g.getImageData(0, 0, w, h).data, sx: w0 / w, sy: h0 / h };
  }
  const rng = seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  /* ---------- 2. quantise to a label map ---------- */
  function kmeans(samples, dim, k, iters = 10) {
    const n = samples.length / dim, rnd = rng(7), cent = [];
    if (!n) return [];
    // k-means++ seeding (deterministic)
    let first = Math.floor(rnd() * n); cent.push(Array.from(samples.subarray(first * dim, first * dim + dim)));
    const d2 = new Float64Array(n).fill(Infinity);
    while (cent.length < k) {
      const c = cent[cent.length - 1]; let sum = 0;
      for (let i = 0; i < n; i++) { let d = 0; for (let j = 0; j < dim; j++) { const t = samples[i * dim + j] - c[j]; d += t * t; } if (d < d2[i]) d2[i] = d; sum += d2[i]; }
      if (sum <= 0) break;
      let r = rnd() * sum, pick = 0; for (let i = 0; i < n; i++) { r -= d2[i]; if (r <= 0) { pick = i; break; } }
      cent.push(Array.from(samples.subarray(pick * dim, pick * dim + dim)));
    }
    const K = cent.length, acc = new Float64Array(K * dim), cnt = new Float64Array(K);
    for (let it = 0; it < iters; it++) {
      acc.fill(0); cnt.fill(0);
      for (let i = 0; i < n; i++) { let best = 0, bd = Infinity; for (let c = 0; c < K; c++) { let d = 0; for (let j = 0; j < dim; j++) { const t = samples[i * dim + j] - cent[c][j]; d += t * t; } if (d < bd) { bd = d; best = c; } } cnt[best]++; for (let j = 0; j < dim; j++) acc[best * dim + j] += samples[i * dim + j]; }
      for (let c = 0; c < K; c++) if (cnt[c]) for (let j = 0; j < dim; j++) cent[c][j] = acc[c * dim + j] / cnt[c];
    }
    return cent;
  }
  function quantize(px, s) {
    const { w, h, data } = px, N = w * h, label = new Int16Array(N), opaque = new Uint8Array(N);
    const gray = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = data[i * 4 + 3] / 255; opaque[i] = a >= 0.5 ? 1 : 0;
      const r = data[i * 4] * a + 255 * (1 - a), g = data[i * 4 + 1] * a + 255 * (1 - a), b = data[i * 4 + 2] * a + 255 * (1 - a);
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    let palette;
    if (s.mode === 'bw' || s.mode === 'sketch') {
      palette = [[255, 255, 255], [0, 0, 0]];
      if (s.mode === 'bw') for (let i = 0; i < N; i++) label[i] = gray[i] < s.threshold ? 1 : 0;
      else { // sketch: Sobel edges on a lightly blurred image + the darkest shadows
        const bl = new Float32Array(N);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let t = 0, c = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < w && yy < h) { t += gray[yy * w + xx]; c++; } } bl[y * w + x] = t / c; }
        const lim = (300 - s.threshold) * 0.9, dark = s.threshold * 0.32;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const g = (xx, yy) => bl[Math.min(h - 1, Math.max(0, yy)) * w + Math.min(w - 1, Math.max(0, xx))];
          const gx = -g(x - 1, y - 1) - 2 * g(x - 1, y) - g(x - 1, y + 1) + g(x + 1, y - 1) + 2 * g(x + 1, y) + g(x + 1, y + 1);
          const gy = -g(x - 1, y - 1) - 2 * g(x, y - 1) - g(x + 1, y - 1) + g(x - 1, y + 1) + 2 * g(x, y + 1) + g(x + 1, y + 1);
          label[y * w + x] = Math.hypot(gx, gy) > lim || bl[y * w + x] < dark ? 1 : 0;
        }
      }
    } else {
      const dim = s.mode === 'gray' ? 1 : 3, step = Math.max(1, Math.floor(N / 24000)), cnt = Math.ceil(N / step), smp = new Float64Array(cnt * dim);
      let m = 0;
      for (let i = 0; i < N; i += step) { if (!opaque[i]) continue; if (dim === 1) smp[m++] = gray[i]; else { const a = data[i * 4 + 3] / 255; for (let j = 0; j < 3; j++) smp[m++] = data[i * 4 + j] * a + 255 * (1 - a); } }
      const cent = kmeans(smp.subarray(0, m), dim, Math.max(2, s.colors));
      palette = cent.map(c => dim === 1 ? [c[0], c[0], c[0]] : c);
      if (!palette.length) palette = [[255, 255, 255]];
      for (let i = 0; i < N; i++) {
        let best = 0, bd = Infinity;
        if (dim === 1) { for (let c = 0; c < cent.length; c++) { const d = Math.abs(gray[i] - cent[c][0]); if (d < bd) { bd = d; best = c; } } }
        else { const a = data[i * 4 + 3] / 255, r = data[i * 4] * a + 255 * (1 - a), g = data[i * 4 + 1] * a + 255 * (1 - a), b = data[i * 4 + 2] * a + 255 * (1 - a); for (let c = 0; c < cent.length; c++) { const p = cent[c], d = (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2; if (d < bd) { bd = d; best = c; } } }
        label[i] = best;
      }
    }
    for (let i = 0; i < N; i++) if (!opaque[i]) label[i] = -1;
    return { label, palette };
  }

  /* ---------- 3. remove regions smaller than `noise` px (merge into the dominant neighbour) ---------- */
  function denoise(label, w, h, minArea) {
    if (minArea <= 1) return;
    const N = w * h, comp = new Int32Array(N).fill(-1), stack = new Int32Array(N);
    for (let pass = 0; pass < 2; pass++) {
      comp.fill(-1); let cid = 0;
      for (let s0 = 0; s0 < N; s0++) {
        if (comp[s0] >= 0) continue;
        const L = label[s0]; let sp = 0, n = 0; stack[sp++] = s0; comp[s0] = cid; const members = [];
        while (sp) { const p = stack[--sp]; members.push(p); n++; const x = p % w, y = (p - x) / w;
          if (x > 0 && comp[p - 1] < 0 && label[p - 1] === L) { comp[p - 1] = cid; stack[sp++] = p - 1; }
          if (x < w - 1 && comp[p + 1] < 0 && label[p + 1] === L) { comp[p + 1] = cid; stack[sp++] = p + 1; }
          if (y > 0 && comp[p - w] < 0 && label[p - w] === L) { comp[p - w] = cid; stack[sp++] = p - w; }
          if (y < h - 1 && comp[p + w] < 0 && label[p + w] === L) { comp[p + w] = cid; stack[sp++] = p + w; } }
        if (n < minArea && L >= 0) { // reassign to the most common neighbouring label
          const votes = new Map();
          for (const p of members) { const x = p % w, y = (p - x) / w; for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) if (q >= 0 && label[q] !== L && label[q] >= 0) votes.set(label[q], (votes.get(label[q]) || 0) + 1); }
          let best = -2, bv = 0; votes.forEach((v, k) => { if (v > bv) { bv = v; best = k; } });
          if (best >= 0) for (const p of members) label[p] = best;
        }
        cid++;
      }
    }
  }

  /* ---------- 4. contours of a binary mask (inside on the right ⇒ outer loops clockwise in y-down space) ---------- */
  const DX = [1, 0, -1, 0], DY = [0, 1, 0, -1]; // E S W N
  function contours(mask, w, h) {
    const W1 = w + 1, out = new Uint8Array(W1 * (h + 1));
    const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
    for (let y = 0; y <= h; y++) for (let x = 0; x < w; x++) { const a = inside(x, y - 1), b = inside(x, y); if (a !== b) { if (b) out[y * W1 + x] |= 1; else out[y * W1 + x + 1] |= 4; } }
    for (let x = 0; x <= w; x++) for (let y = 0; y < h; y++) { const a = inside(x - 1, y), b = inside(x, y); if (a !== b) { if (a) out[y * W1 + x] |= 2; else out[(y + 1) * W1 + x] |= 8; } }
    const loops = [], pop = v => (v & 1) + (v >> 1 & 1) + (v >> 2 & 1) + (v >> 3 & 1);
    const trace = start => {
      let v = start, dir = -1; const pts = [];
      for (let guard = 0; guard < 4 * W1 * (h + 1); guard++) {
        const m = out[v]; if (!m) break;
        let nd = -1;
        if (dir < 0) { for (let d = 0; d < 4; d++) if (m & (1 << d)) { nd = d; break; } }
        else for (const t of [1, 0, 3]) { const d = (dir + t) & 3; if (m & (1 << d)) { nd = d; break; } } // prefer right turn, straight, left
        if (nd < 0) break;
        out[v] &= ~(1 << nd);
        const x = v % W1, y = (v - x) / W1;
        if (nd !== dir) pts.push([x, y]);
        dir = nd; v = (y + DY[nd]) * W1 + x + DX[nd];
        if (v === start) break;
      }
      if (pts.length >= 4) loops.push(pts);
    };
    for (let v = 0; v < out.length; v++) if (out[v] && pop(out[v]) === 1) trace(v);
    for (let v = 0; v < out.length; v++) while (out[v]) trace(v);
    return loops;
  }
  const area = pts => { let a = 0; for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
  const inPoly = (pt, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < (b[0] - a[0]) * (pt[1] - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };

  /* ---------- 5. smoothing + curve fitting ---------- */
  // staircase corners → edge midpoints (a 45° staircase becomes a straight diagonal, rectangle corners stay sharp)
  function interpolate(pts) {
    const n = pts.length, out = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n], len = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]), dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
      if (len <= 1) out.push([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
      else { out.push([a[0] + dx * 0.5, a[1] + dy * 0.5]); out.push([b[0] - dx * 0.5, b[1] - dy * 0.5]); }
    }
    return out;
  }
  function fitLoop(pts0, tol, cornerDeg) {
    // densify long straight runs (≤ 1 px spacing) so the fitter and the corner test see the real outline
    const pts = [];
    for (let i = 0; i < pts0.length; i++) { const a = pts0[i], b = pts0[(i + 1) % pts0.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.ceil(L)); for (let j = 0; j < k; j++) pts.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]); }
    const n = pts.length;
    if (n < 3) return null;
    // turning angle measured over ~2.5 px of arc on each side
    const cum = [0]; for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + Math.hypot(pts[i % n][0] - pts[i - 1][0], pts[i % n][1] - pts[i - 1][1]));
    const total = cum[n], reach = Math.min(2.6, total / 8);
    const at = (i, dist) => { // point index at arc distance from i
      let j = i, d = 0, k = 0; const sgn = Math.sign(dist); dist = Math.abs(dist);
      while (d < dist && k < n) { const nj = (j + sgn + n) % n; d += Math.hypot(pts[nj][0] - pts[j][0], pts[nj][1] - pts[j][1]); j = nj; k++; }
      return pts[j];
    };
    const ang = new Float32Array(n), angAt = (i, rr) => {
      const a = at(i, -rr), b = pts[i], c = at(i, rr);
      const v1x = b[0] - a[0], v1y = b[1] - a[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
      const l = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y); return l ? Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / l))) * 180 / Math.PI : 0;
    };
    const reach2 = Math.min(6, total / 6);
    // a real corner is sharp at the small scale AND still turns at a larger scale (pixel jaggies do not)
    for (let i = 0; i < n; i++) { const a1 = angAt(i, reach); ang[i] = a1 >= cornerDeg && angAt(i, reach2) >= cornerDeg * 0.7 ? a1 : Math.min(a1, cornerDeg - 1e-3); }
    const corners = [];
    for (let i = 0; i < n; i++) { if (ang[i] < cornerDeg) continue; const p = ang[(i - 1 + n) % n], q = ang[(i + 1) % n]; if (ang[i] >= p && ang[i] > q) corners.push(i); }
    // non-maximum suppression within ~2 px (a chamfered pixel corner yields two candidates)
    for (let k = corners.length - 1; k > 0; k--) if (cum[corners[k]] - cum[corners[k - 1]] < 2.2) corners.splice(ang[corners[k]] > ang[corners[k - 1]] ? k - 1 : k, 1);
    // snap corners to the intersection of the incoming and outgoing edge directions
    corners.forEach(i => {
      const a1 = at(i, -reach * 2.2), a2 = at(i, -1.2), b1 = at(i, 1.2), b2 = at(i, reach * 2.2);
      const d1 = [a2[0] - a1[0], a2[1] - a1[1]], d2 = [b2[0] - b1[0], b2[1] - b1[1]], den = d1[0] * d2[1] - d1[1] * d2[0];
      if (Math.abs(den) < 1e-6) return;
      const t = ((b1[0] - a1[0]) * d2[1] - (b1[1] - a1[1]) * d2[0]) / den, X = [a1[0] + d1[0] * t, a1[1] + d1[1] * t];
      if (Math.hypot(X[0] - pts[i][0], X[1] - pts[i][1]) < 1.6) pts[i] = X;
    });
    const straight = run => { const a = run[0], b = run[run.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) return false; for (const p of run) if (Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / L > 0.45) return false; return true; };
    const smooth = run => { if (run.length < 5) return run; let r = run; for (let pass = 0; pass < 5; pass++) r = r.map((p, i) => i === 0 || i === r.length - 1 ? p : [(r[i - 1][0] + 2 * p[0] + r[i + 1][0]) / 4, (r[i - 1][1] + 2 * p[1] + r[i + 1][1]) / 4]); return r; };
    const toSegs = run => {
      if (run.length <= 2 || straight(run)) return [run[0], run[run.length - 1]].map(p => new P.Segment(new P.Point(p[0], p[1])));
      const path = new P.Path({ segments: smooth(run).map(p => new P.Point(p[0], p[1])), insert: false });
      path.simplify(tol); return path.segments.map(s => new P.Segment(s.point, s.handleIn, s.handleOut));
    };
    if (!corners.length) {
      const sm = smooth([...pts.slice(-6), ...pts, ...pts.slice(0, 6)]).slice(6, -6);
      const path = new P.Path({ segments: sm.map(p => new P.Point(p[0], p[1])), closed: true, insert: false });
      path.simplify(tol); return path;
    }
    const segs = [];
    for (let c = 0; c < corners.length; c++) {
      const s0 = corners[c], s1 = corners[(c + 1) % corners.length], run = [];
      for (let i = s0; ; i = (i + 1) % n) { run.push(pts[i]); if (i === s1 && run.length > 1) break; if (run.length > n + 1) break; }
      const rs = toSegs(run);
      if (segs.length) { const last = segs[segs.length - 1]; last.handleOut = rs[0].handleOut; segs.push(...rs.slice(1)); }
      else segs.push(...rs);
    }
    // the final run ends at the first corner: merge
    if (segs.length > 1 && segs[0].point.getDistance(segs[segs.length - 1].point) < 1e-6) { segs[0].handleIn = segs[segs.length - 1].handleIn; segs.pop(); }
    return new P.Path({ segments: segs, closed: true, insert: false });
  }

  /* ---------- 6. full trace → plain data ---------- */
  TR.run = (raster, s) => {
    const px = pixelsOf(raster, s.maxSize); if (!px) throw new Error('The image is not loaded yet.');
    const { w, h } = px, t0 = performance.now();
    const { label, palette } = quantize(px, s);
    denoise(label, w, h, s.noise);
    // order layers: white-ish first (droppable), then by area (largest = bottom)
    const count = new Array(palette.length).fill(0); for (let i = 0; i < label.length; i++) if (label[i] >= 0) count[label[i]]++;
    const isWhite = c => c[0] > 240 && c[1] > 240 && c[2] > 240;
    const order = palette.map((c, i) => i).filter(i => count[i] > 0).sort((a, b) => (isWhite(palette[b]) - isWhite(palette[a])) || count[b] - count[a]);
    const rank = new Int16Array(palette.length).fill(-1); order.forEach((c, r) => rank[c] = r);
    const tol = 0.02 + (100 - s.paths) / 100 * 0.6, cornerDeg = 120 - s.corners;
    const layers = [];
    order.forEach((ci, r) => {
      if (s.ignoreWhite && isWhite(palette[ci])) return;
      const mask = new Uint8Array(w * h); for (let i = 0; i < mask.length; i++) mask[i] = label[i] >= 0 && rank[label[i]] >= r ? 1 : 0;
      const loops = contours(mask, w, h).map(p => ({ p, a: area(p) })).filter(l => Math.abs(l.a) >= Math.min(s.noise, 4));
      layers.push({ color: palette[ci], loops });
    });
    return { w, h, sx: px.sx, sy: px.sy, layers, tol, cornerDeg, ms: performance.now() - t0 };
  };
  // build paper items in the raster's coordinate space
  TR.build = (raster, res) => {
    const out = new P.Group({ insert: false, data: { role: 'traceOut' } });
    const M = raster.matrix.clone().append(new P.Matrix().translate(-raster.width / 2, -raster.height / 2).scale(res.sx, res.sy));
    let nPaths = 0, nAnchors = 0;
    res.layers.forEach(L => {
      const col = new P.Color(L.color[0] / 255, L.color[1] / 255, L.color[2] / 255), css = col.toCSS(true);
      const outers = L.loops.filter(l => l.a > 0).map(l => ({ ...l, bb: bbox(l.p), holes: [] })).sort((a, b) => a.a - b.a);
      L.loops.filter(l => l.a < 0).forEach(hl => {
        const [x0, y0] = hl.p[0], [x1, y1] = hl.p[1], dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0), probe = [(x0 + x1) / 2 + dy * 0.5, (y0 + y1) / 2 - dx * 0.5];
        const host = outers.find(o => probe[0] > o.bb[0] && probe[0] < o.bb[2] && probe[1] > o.bb[1] && probe[1] < o.bb[3] && o.a > -hl.a && inPoly(probe, o.p));
        if (host) host.holes.push(hl);
      });
      outers.sort((a, b) => b.a - a.a).forEach(o => {
        const mk = l => fitLoop(interpolate(l.p), res.tol, res.cornerDeg);
        const main = mk(o); if (!main) return;
        const holes = o.holes.map(mk).filter(Boolean);
        const item = holes.length ? new P.CompoundPath({ children: [main, ...holes], insert: false, fillRule: 'evenodd' }) : main;
        item.transform(M); item.fillColor = css; item.strokeColor = null;
        nPaths++; nAnchors += [main, ...holes].reduce((s, p) => s + p.segments.length, 0);
        out.addChild(item);
      });
    });
    out.data.stats = { paths: nPaths, anchors: nAnchors, colors: res.layers.length };
    return out;
  };
  const bbox = p => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; p.forEach(([x, y]) => { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }); return [x0, y0, x1, y1]; };

  /* ---------- live trace objects ---------- */
  TR.src = g => g.children.find(c => c.data.role === 'traceSrc');
  TR.out = g => g.children.find(c => c.data.role === 'traceOut');
  TR.applyView = g => {
    const s = g.data.trace, src = TR.src(g), out = TR.out(g); if (!src || !out) return;
    src.visible = s.view === 'source' || s.view === 'overlay'; out.visible = s.view !== 'source';
    out.opacity = s.view === 'overlay' ? 0.6 : 1;
    const outline = s.view === 'outline';
    out.getItems({ match: x => LV.isPathItem(x) && !(x.parent instanceof P.CompoundPath) }).forEach(p => {
      if (outline) { if (!p.data.tfill) p.data.tfill = LV.css(p.fillColor); p.fillColor = null; p.strokeColor = '#1d2733'; p.strokeWidth = 0.6; }
      else if (p.data.tfill) { p.fillColor = p.data.tfill; p.strokeColor = null; delete p.data.tfill; }
    });
  };
  TR.retrace = g => {
    const src = TR.src(g); if (!src) return null;
    const res = TR.run(src, g.data.trace), out = TR.build(src, res), old = TR.out(g);
    if (old) old.replaceWith(out); else g.addChild(out);
    TR.applyView(g); return out.data.stats;
  };
  const loadRaster = r => new Promise(res => { if (r.loaded) return res(r); r.onLoad = () => res(r); r.onError = () => res(r); setTimeout(() => res(r), 4000); });
  TR.make = async (raster, settings) => {
    await loadRaster(raster);
    const s = TR.sanitize(settings || TR.last || TR.DEFAULT);
    const g = new P.Group({ insert: false, data: { kind: 'trace', trace: s } }); g.name = 'Image Tracing';
    g.insertAbove(raster); g.addChild(raster); raster.data.role = 'traceSrc'; raster.visible = false;
    TR.retrace(g); LV.uidOf(g); return g;
  };
  TR.expand = g => {
    const out = TR.out(g); if (!out) return g;
    if (g.data.trace.view === 'outline') { g.data.trace = { ...g.data.trace, view: 'result' }; TR.applyView(g); }
    out.visible = true; out.opacity = 1; delete out.data.role; delete out.data.stats;
    out.name = 'Traced Image'; out.insertAbove(g); out.opacity = g.opacity; out.blendMode = g.blendMode;
    if (g.data.fx) out.data.fx = g.data.fx;
    g.remove(); LV.reUid(out); return out;
  };
  TR.release = g => { const src = TR.src(g); if (!src) return g; src.visible = true; delete src.data.role; src.insertAbove(g); g.remove(); return src; };
  const selImages = () => LV.sel.filter(it => LV.kind(it) === 'image');
  const selTraces = () => LV.sel.filter(it => LV.kind(it) === 'trace');
  const busy = async (msg, fn) => { Aero.busy(msg); await new Promise(r => setTimeout(r, 30)); try { return await fn(); } catch (e) { console.error(e); Aero.alert('Image Trace', e.message || String(e)); } finally { Aero.busy(); } };
  TR.makeSel = async (expand = false, preset) => {
    const imgs = selImages(); if (!imgs.length) return LV.toast('Select a placed image to trace');
    await busy('Tracing image…', async () => {
      const out = [];
      for (const r of imgs) { const g = await TR.make(r, preset ? { ...TR.DEFAULT, preset, ...TR.PRESETS[preset] } : null); out.push(expand ? TR.expand(g) : g); }
      LV.setSel(out); LV.commit(expand ? 'Image Trace (Expanded)' : 'Image Trace');
    });
  };
  TR.expandSel = () => { const t = selTraces(); if (!t.length) return LV.toast('Select an image tracing object'); LV.setSel(t.map(TR.expand)); LV.commit('Expand Tracing'); };
  TR.releaseSel = () => { const t = selTraces(); if (!t.length) return LV.toast('Select an image tracing object'); LV.setSel(t.map(TR.release)); LV.commit('Release Tracing'); };
  // change settings of the selected trace objects (live: re-traces immediately)
  TR.setOptions = async (part, commit = true) => {
    const t = selTraces(); if (!t.length) return;
    const viewOnly = Object.keys(part).every(k => k === 'view');
    const run = () => { t.forEach(g => { g.data.trace = TR.sanitize({ ...g.data.trace, ...part }); if (viewOnly) TR.applyView(g); else TR.retrace(g); }); TR.last = { ...t[0].data.trace }; };
    if (viewOnly) run(); else await busy('Tracing image…', run);
    if (commit) LV.commit('Image Trace Options'); else LV.redraw();
    LV.emit('selection');
  };
  TR.presetValues = key => key === 'custom' ? {} : { preset: key, ...TR.PRESETS[key] };
  TR.optionsDialog = async () => {
    if (!selTraces().length) { if (selImages().length) await TR.makeSel(false); if (!selTraces().length) return LV.toast('Select a placed image or tracing object'); }
    const t = selTraces(), s0 = { ...t[0].data.trace }, before = t.map(g => ({ g, s: g.data.trace, out: TR.out(g) && TR.out(g).clone({ insert: false }) }));
    let timer = 0, lastKey = null;
    const fields = [
      { key: 'preset', label: 'Preset', type: 'select', value: s0.preset, options: [...Object.entries(TR.PRESETS).map(([k, p]) => [k, p.name]), ['custom', 'Custom']] },
      { key: 'mode', label: 'Mode', type: 'select', value: s0.mode, options: [['bw', 'Black and white'], ['gray', 'Grayscale'], ['color', 'Color'], ['sketch', 'Sketch (edges)']] },
      { key: 'threshold', label: 'Threshold', type: 'range', min: 0, max: 255, value: s0.threshold },
      { key: 'colors', label: 'Colors / gray levels', type: 'range', min: 2, max: 32, value: s0.colors },
      { key: 'paths', label: 'Paths (fidelity)', type: 'range', min: 0, max: 100, value: s0.paths, fmt: v => v + '%' },
      { key: 'corners', label: 'Corners', type: 'range', min: 0, max: 100, value: s0.corners, fmt: v => v + '%' },
      { key: 'noise', label: 'Noise (px)', type: 'range', min: 1, max: 100, value: s0.noise },
      { key: 'ignoreWhite', label: 'Ignore white', type: 'checkbox', value: s0.ignoreWhite },
      { key: 'maxSize', label: 'Resolution (longest side)', type: 'select', value: String(s0.maxSize), options: [['400', '400 px (fast)'], ['800', '800 px'], ['1200', '1200 px'], ['1600', '1600 px (slow)']] },
      { key: 'view', label: 'View', type: 'select', value: s0.view, options: [['result', 'Tracing result'], ['overlay', 'Result over source image'], ['outline', 'Outlines'], ['source', 'Source image']] }];
    const dlg = Aero.dialog({
      title: 'Image Trace', instruction: 'Changes preview live on the canvas. Expand the tracing (Object ▸ Image Trace ▸ Expand) to edit the paths.', fields, width: 460,
      html: '<div class="dnote" id="traceInfo"></div>',
      onInput: (k, v, set) => { if (k === 'preset' && v.preset !== 'custom') { const p = TR.PRESETS[v.preset]; ['mode', 'threshold', 'colors', 'paths', 'corners', 'noise', 'ignoreWhite'].forEach(x => set(x, p[x])); } else if (k !== 'preset' && k !== 'view' && k !== 'maxSize') set('preset', 'custom'); },
      onChange: v => {
        const key = JSON.stringify({ ...v, view: 0 }), first = lastKey === null, viewOnly = first || key === lastKey; lastKey = key;
        if (first && v.view === s0.view) return;
        clearTimeout(timer); timer = setTimeout(() => {
          const t0 = performance.now();
          t.forEach(g => { g.data.trace = TR.sanitize({ ...v, maxSize: +v.maxSize }); if (viewOnly) TR.applyView(g); else TR.retrace(g); });
          const st = TR.out(t[0])?.data.stats, el = document.getElementById('traceInfo');
          if (el && st) el.textContent = `${st.paths} paths · ${st.anchors} anchor points · ${st.colors} color${st.colors === 1 ? '' : 's'} · ${Math.round(performance.now() - t0)} ms`;
          LV.redraw();
        }, viewOnly ? 0 : 160);
      },
      onOK: () => { clearTimeout(timer); t.forEach(g => { if (!TR.out(g)) TR.retrace(g); }); TR.last = { ...t[0].data.trace }; LV.commit('Image Trace Options'); },
      onCancel: () => { clearTimeout(timer); before.forEach(b => { b.g.data.trace = b.s; const cur = TR.out(b.g); if (b.out) { if (cur) cur.replaceWith(b.out); else b.g.addChild(b.out); } TR.applyView(b.g); }); LV.redraw(); }
    });
    return dlg;
  };
})();
