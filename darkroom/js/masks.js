'use strict';
/* Lumen Darkroom — brush-mask rasters, reference images (auto mask, spot source search) and mask helpers.
   A brush raster lives in raw-source uv at a fixed long edge (RES px): R = painted coverage, G = erased coverage.
   Rasters are rebuilt from the stroke list (non-destructive) and updated incrementally while a stroke grows. */
const Masks = (() => {
  const RES = 1536, MAX_ENTRIES = 8;
  const rasters = new Map();      // key → entry
  const refs = new Map();         // fileId → {img, px: Map(WxH → Uint8ClampedArray)}

  /* ---------- reference images ---------- */
  function setRef(fileId, img) { const r = refs.get(fileId); if (r && r.img === img) return; refs.set(fileId, { img, px: new Map() }); if (refs.size > 6) refs.delete(refs.keys().next().value); invalidateRef(fileId); }
  const hasRef = fileId => refs.has(fileId);
  async function ensureRef(p) { if (refs.has(p.fileId)) return; try { setRef(p.fileId, await Cat.workImage(p)); } catch (e) { console.warn('mask reference unavailable', e); } }
  function refPixels(fileId, W, H) {
    const r = refs.get(fileId); if (!r) return null;
    const k = W + 'x' + H; let px = r.px.get(k);
    if (!px) {
      const c = Decode.mkCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high';
      x.drawImage(r.img, 0, 0, W, H); px = x.getImageData(0, 0, W, H).data; r.px.set(k, px);
      if (r.px.size > 3) r.px.delete(r.px.keys().next().value);
    }
    return px;
  }
  function invalidateRef(fileId) { rasters.forEach((e, k) => { if (e.ref === fileId && e.needRef) { e.dead = true; rasters.delete(k); } }); }
  const needsRef = st => (st.masks || []).some(m => m.on && m.strokes.some(s => s.auto));

  /* ---------- rasters ---------- */
  const sig = s => `${s.erase ? 1 : 0}|${s.size}|${s.feather}|${s.flow}|${s.auto ? 1 : 0}`;
  const dimsFor = (w, h) => { const L = Math.max(w, h); return [Math.max(1, Math.round(RES * w / L)), Math.max(1, Math.round(RES * h / L))]; };
  function newEntry(ref, W, H) { return { ref, w: W, h: H, f: new Float32Array(W * H * 2), data: new Uint8Array(W * H * 2), ver: 0, dirty: null, applied: [], needRef: false, dead: false }; }
  function clearEntry(e) { e.f.fill(0); e.data.fill(0); e.applied = []; e.needRef = false; e.dirty = { y0: 0, y1: e.h }; e.ver++; }
  function isPrefix(e, strokes) {
    if (strokes.length < e.applied.length) return false;
    for (let i = 0; i < e.applied.length; i++) {
      const a = e.applied[i], s = strokes[i];
      if (s.id !== a.id || sig(s) !== a.sig || s.pts.length < a.n) return false;
      const l = s.pts[a.n - 1]; if (l[0] !== a.last[0] || l[1] !== a.last[1]) return false;
    }
    return true;
  }
  function stamp(e, s, u, v, refPx) {
    const W = e.w, H = e.h, r = Math.max(.6, s.size * RES), inner = r * (1 - s.feather / 100), flow = s.flow / 100;
    const cx = u * W, cy = v * H, x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
    if (x1 < x0 || y1 < y0) return;
    let rc = null;
    if (s.auto && refPx) { const ix = Math.min(W - 1, Math.max(0, Math.round(cx))), iy = Math.min(H - 1, Math.max(0, Math.round(cy))), k = (iy * W + ix) * 4; rc = [refPx[k], refPx[k + 1], refPx[k + 2]]; }
    const f = e.f, d = e.data, ch = s.erase ? 1 : 0, other = 1 - ch;
    for (let y = y0; y <= y1; y++) {
      const dy = y + .5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + .5 - cx, dist = Math.sqrt(dx * dx + dy * dy); if (dist >= r) continue;
        let a = dist <= inner ? 1 : 1 - smooth((dist - inner) / Math.max(1e-6, r - inner));
        if (rc) { const k = (y * W + x) * 4, dr = refPx[k] - rc[0], dg = refPx[k + 1] - rc[1], db = refPx[k + 2] - rc[2]; a *= 1 - smoothRange(14, 46, Math.sqrt(dr * dr + dg * dg + db * db)); }
        a *= flow; if (a <= 0) continue;
        const i = (y * W + x) * 2;
        f[i + ch] += (1 - f[i + ch]) * a; f[i + other] *= 1 - a;
        d[i] = Math.round(f[i] * 255); d[i + 1] = Math.round(f[i + 1] * 255);
      }
    }
    const dt = e.dirty || { y0: H, y1: 0 }; e.dirty = { y0: Math.min(dt.y0, y0), y1: Math.max(dt.y1, y1 + 1) };
  }
  const smooth = t => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
  const smoothRange = (a, b, x) => smooth((x - a) / (b - a));
  function applyStroke(e, s, from, refPx) {
    const r = Math.max(.6, s.size * RES), sp = Math.max(.75, r * .15);
    for (let k = from; k < s.pts.length; k++) {
      const p = s.pts[k];
      if (k === 0) { stamp(e, s, p[0], p[1], refPx); continue; }
      const q = s.pts[k - 1], len = Math.hypot((p[0] - q[0]) * e.w, (p[1] - q[1]) * e.h), n = Math.max(1, Math.ceil(len / sp));
      for (let j = 1; j <= n; j++) stamp(e, s, q[0] + (p[0] - q[0]) * j / n, q[1] + (p[1] - q[1]) * j / n, refPx);
    }
  }
  // → raster entry for this mask (built or extended as needed)
  function raster(ref, mask, w, h) {
    const [W, H] = dimsFor(w, h), key = ref + '|' + mask.id + '|' + W + 'x' + H;
    let e = rasters.get(key);
    const auto = mask.strokes.some(s => s.auto), refPx = auto ? refPixels(ref, W, H) : null;
    if (e && e.needRef && refPx) { e.dead = true; rasters.delete(key); e = null; }
    if (!e) { e = newEntry(ref, W, H); e.dirty = { y0: 0, y1: H }; }
    else rasters.delete(key);
    rasters.set(key, e);   // LRU order
    while (rasters.size > MAX_ENTRIES) { const [k0, e0] = rasters.entries().next().value; e0.dead = true; rasters.delete(k0); }
    if (!isPrefix(e, mask.strokes)) clearEntry(e);
    let changed = false;
    mask.strokes.forEach((s, i) => {
      const a = e.applied[i], from = a ? a.n : 0;
      if (from >= s.pts.length) return;
      applyStroke(e, s, from ? from : 0, refPx); changed = true;
      if (s.auto && !refPx) e.needRef = true;
      e.applied[i] = { id: s.id, sig: sig(s), n: s.pts.length, last: s.pts[s.pts.length - 1].slice() };
    });
    if (changed) e.ver++;
    return e;
  }
  function dropFile(fileId) { rasters.forEach((e, k) => { if (e.ref === fileId) { e.dead = true; rasters.delete(k); } }); }

  /* ---------- spot removal: automatic source search ---------- */
  // x,y: raw uv of the spot centre, r: radius (long-edge units); w,h: source size. Returns [sx, sy] raw uv.
  function findSource(fileId, x, y, r, w, h) {
    const L = Math.max(w, h), S = 512, W = Math.max(8, Math.round(S * w / L)), H = Math.max(8, Math.round(S * h / L));
    const px = refPixels(fileId, W, H), rp = r * S;   // radius in ref pixels
    const fallback = () => { const sx = x + (x > .5 ? -1 : 1) * r * 2.4 * L / w; return [Math.max(0, Math.min(1, sx)), y]; };
    if (!px || rp < .8) return fallback();
    const lum = (X, Y) => { X = Math.max(0, Math.min(W - 1, Math.round(X))); Y = Math.max(0, Math.min(H - 1, Math.round(Y))); const k = (Y * W + X) * 4; return [px[k], px[k + 1], px[k + 2]]; };
    const cx = x * W, cy = y * H, ring = [];
    for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2; for (const f of [1.15, 1.45]) ring.push([Math.cos(a) * rp * f, Math.sin(a) * rp * f]); }
    const inner = []; for (let i = 0; i < 24; i++) { const a = i / 24 * Math.PI * 2; for (const f of [.3, .7]) inner.push([Math.cos(a) * rp * f, Math.sin(a) * rp * f]); } inner.push([0, 0]);
    const ringD = ring.map(([dx, dy]) => lum(cx + dx, cy + dy));
    let best = null;
    for (const dist of [2.3, 3, 4, 5.5]) for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2, sx = cx + Math.cos(a) * rp * dist, sy = cy + Math.sin(a) * rp * dist;
      if (sx - rp * 1.5 < 0 || sy - rp * 1.5 < 0 || sx + rp * 1.5 > W || sy + rp * 1.5 > H) continue;
      let ssd = 0;
      ring.forEach(([dx, dy], k) => { const c = lum(sx + dx, sy + dy), d = ringD[k]; ssd += (c[0] - d[0]) ** 2 + (c[1] - d[1]) ** 2 + (c[2] - d[2]) ** 2; });
      // prefer clean sources: the inside of the source should look like its own surroundings
      let m = [0, 0, 0], v = 0; const ins = inner.map(([dx, dy]) => lum(sx + dx, sy + dy)); ins.forEach(c => { m[0] += c[0]; m[1] += c[1]; m[2] += c[2]; }); m = m.map(t => t / ins.length);
      ins.forEach(c => { v += (c[0] - m[0]) ** 2 + (c[1] - m[1]) ** 2 + (c[2] - m[2]) ** 2; });
      const score = ssd / ring.length + .6 * v / ins.length + dist * 8;
      if (!best || score < best.score) best = { score, sx, sy };
    }
    return best ? [best.sx / W, best.sy / H] : fallback();
  }

  // brush-stroke spot: pts (raw uv), r (long-edge units) → [dx, dy] source offset in raw uv
  function findStrokeSource(fileId, pts, r, w, h) {
    const L = Math.max(w, h), S = 512, W = Math.max(8, Math.round(S * w / L)), H = Math.max(8, Math.round(S * h / L));
    const px = refPixels(fileId, W, H), rp = Math.max(.8, r * S);
    const P = pts.map(([u, v]) => [u * W, v * H]);
    // main direction → perpendicular fallback offset
    const dx0 = P[P.length - 1][0] - P[0][0], dy0 = P[P.length - 1][1] - P[0][1], dl = Math.hypot(dx0, dy0) || 1;
    const fallback = () => [-dy0 / dl * rp * 3 / W, dx0 / dl * rp * 3 / H];
    if (!px) return fallback();
    const col = (X, Y) => { X = Math.max(0, Math.min(W - 1, Math.round(X))); Y = Math.max(0, Math.min(H - 1, Math.round(Y))); const k = (Y * W + X) * 4; return [px[k], px[k + 1], px[k + 2]]; };
    // resample the stroke evenly (≤ 32 samples) with normals
    const samp = []; let acc = 0; const seg = []; for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); seg.push(l); acc += l; }
    const n = Math.min(32, Math.max(2, Math.ceil(acc / (rp * .7))));
    for (let k = 0; k < n; k++) {
      let t = acc * k / (n - 1), i = 0; while (i < seg.length - 1 && t > seg[i]) { t -= seg[i]; i++; }
      const a = P[i], b = P[i + 1] || P[i], l = seg[i] || 1, f = Math.min(1, t / l), x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
      const tx = (b[0] - a[0]) / l, ty = (b[1] - a[1]) / l; samp.push([x, y, -ty, tx]);
    }
    const side = []; samp.forEach(([x, y, nx, ny]) => { for (const k of [1.3, 1.7, -1.3, -1.7]) side.push([x + nx * rp * k, y + ny * rp * k]); });
    const sideD = side.map(([x, y]) => col(x, y));
    const distToStroke = (x, y) => { let m = Infinity; samp.forEach(([sx, sy]) => { m = Math.min(m, Math.hypot(x - sx, y - sy)); }); return m; };
    let best = null;
    for (const dist of [2.5, 3.5, 5, 7]) for (let i = 0; i < 24; i++) {
      const a = i / 24 * Math.PI * 2, ox = Math.cos(a) * rp * dist, oy = Math.sin(a) * rp * dist;
      if (samp.some(([x, y]) => x + ox < rp || y + oy < rp || x + ox > W - rp || y + oy > H - rp)) continue;
      if (samp.some(([x, y]) => distToStroke(x + ox, y + oy) < rp * 2.2)) continue;      // the source must not overlap the defect
      let ssd = 0; side.forEach(([x, y], k) => { const c = col(x + ox, y + oy), d = sideD[k]; ssd += (c[0] - d[0]) ** 2 + (c[1] - d[1]) ** 2 + (c[2] - d[2]) ** 2; });
      let m = [0, 0, 0], v = 0; const ins = samp.map(([x, y]) => col(x + ox, y + oy)); ins.forEach(c => { m[0] += c[0]; m[1] += c[1]; m[2] += c[2]; }); m = m.map(t => t / ins.length);
      ins.forEach(c => { v += (c[0] - m[0]) ** 2 + (c[1] - m[1]) ** 2 + (c[2] - m[2]) ** 2; });
      const score = ssd / side.length + .6 * v / ins.length + dist * 8;
      if (!best || score < best.score) best = { score, ox, oy };
    }
    return best ? [best.ox / W, best.oy / H] : fallback();
  }

  /* ---------- colour helpers ---------- */
  function oklab(r, g, b) {   // linear RGB → Oklab
    let l = .4122214708 * r + .5363325363 * g + .0514459929 * b, m = .2119034982 * r + .6806995451 * g + .1073969566 * b, s = .0883024619 * r + .2817188376 * g + .6299787005 * b;
    l = Math.cbrt(Math.max(0, l)); m = Math.cbrt(Math.max(0, m)); s = Math.cbrt(Math.max(0, s));
    return [.2104542553 * l + .7936177850 * m - .0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .8086757660 * s];
  }
  function oklabToCss(L, a, b) {
    const l = (L + .3963377774 * a + .2158037573 * b) ** 3, m = (L - .1055613458 * a - .0638541728 * b) ** 3, s = (L - .0894841775 * a - 1.2914855480 * b) ** 3;
    const lin = [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.7076147010 * s];
    const enc = v => { v = Math.max(0, Math.min(1, v)); return Math.round(255 * (v <= .0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - .055)); };
    return `rgb(${lin.map(enc).join(',')})`;
  }

  return { RES, setRef, hasRef, ensureRef, needsRef, raster, dropFile, findSource, findStrokeSource, oklab, oklabToCss, refPixels, _rasters: rasters };
})();
