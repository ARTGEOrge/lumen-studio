'use strict';
/* Layer Styles: non-destructive effects rendered at composite time (drop shadow, inner shadow, outer/inner glow,
   bevel & emboss, color/gradient overlay, stroke, fill opacity). Stored on the layer as `style`, saved in .lumen
   and in history; baked into pixels for PSD export / merge. Distances use an exact Euclidean distance transform. */
const STYLE_KEYS = ['dropShadow', 'innerShadow', 'outerGlow', 'innerGlow', 'bevel', 'colorOverlay', 'gradientOverlay', 'stroke'];
const STYLE_NAMES = { dropShadow: 'Drop Shadow', innerShadow: 'Inner Shadow', outerGlow: 'Outer Glow', innerGlow: 'Inner Glow', bevel: 'Bevel & Emboss', colorOverlay: 'Color Overlay', gradientOverlay: 'Gradient Overlay', stroke: 'Stroke' };
const STYLE_DEFAULTS = {
  dropShadow: { on: false, color: '#000000', opacity: 0.6, blend: 'multiply', angle: 120, distance: 8, spread: 0, size: 12 },
  innerShadow: { on: false, color: '#000000', opacity: 0.6, blend: 'multiply', angle: 120, distance: 5, choke: 0, size: 8 },
  outerGlow: { on: false, color: '#ffe66b', opacity: 0.8, blend: 'screen', spread: 0, size: 16 },
  innerGlow: { on: false, color: '#ffffbe', opacity: 0.75, blend: 'screen', source: 'edge', choke: 0, size: 10 },
  bevel: { on: false, style: 'inner', technique: 'smooth', depth: 100, dir: 'up', size: 8, soften: 0, angle: 120, altitude: 30, hiColor: '#ffffff', hiOpacity: 0.75, hiBlend: 'screen', shColor: '#000000', shOpacity: 0.75, shBlend: 'multiply' },
  colorOverlay: { on: false, color: '#e8352a', opacity: 1, blend: 'source-over' },
  gradientOverlay: { on: false, opacity: 1, blend: 'source-over', type: 'linear', angle: 90, scale: 100, reverse: false, stops: [{ p: 0, c: '#000000', a: 1 }, { p: 1, c: '#ffffff', a: 1 }] },
  stroke: { on: false, size: 3, position: 'outside', color: '#000000', opacity: 1, blend: 'source-over' }
};
// numeric ranges and enums used to validate styles coming from files
const STYLE_NUM = { opacity: [0, 1], angle: [-360, 360], distance: [0, 1000], spread: [0, 100], choke: [0, 100], size: [0, 250], depth: [1, 1000], soften: [0, 50], altitude: [0, 90], hiOpacity: [0, 1], shOpacity: [0, 1], scale: [10, 150] };
const STYLE_ENUM = { source: ['edge', 'center'], style: ['inner', 'outer', 'emboss'], technique: ['smooth', 'chisel'], dir: ['up', 'down'], position: ['outside', 'inside', 'center'], type: ['linear', 'radial', 'reflected', 'angle'] };
const BLEND_IDS = () => BLENDS.map(b => b[0]);
function defaultStyle() { const s = { fill: 1 }; STYLE_KEYS.forEach(k => s[k] = JSON.parse(JSON.stringify(STYLE_DEFAULTS[k]))); return s; }
function sanitizeStyle(o) {
  if (!o || typeof o !== 'object') return null;
  const s = defaultStyle(), blends = BLEND_IDS();
  s.fill = clamp(Number.isFinite(+o.fill) ? +o.fill : 1, 0, 1);
  STYLE_KEYS.forEach(k => {
    const src = o[k]; if (!src || typeof src !== 'object') return;
    const d = s[k];
    Object.keys(d).forEach(f => {
      const v = src[f]; if (v === undefined) return;
      if (f === 'on' || f === 'reverse') d[f] = !!v;
      else if (f === 'stops') d.stops = sanitizeStops(v, d.stops);
      else if (/color$/i.test(f)) { if (HEX6.test(v)) d[f] = v.toLowerCase(); }
      else if (/blend$/i.test(f)) { if (blends.includes(v)) d[f] = v; }
      else if (STYLE_ENUM[f]) { if (STYLE_ENUM[f].includes(v)) d[f] = v; }
      else if (f === 'size' && k === 'stroke') d.size = clamp(Number.isFinite(+v) ? +v : d.size, 1, 250);
      else { const r = STYLE_NUM[f]; if (r && Number.isFinite(+v)) d[f] = clamp(+v, r[0], r[1]); }
    });
  });
  return s;
}
const styleHasEffects = s => !!s && (STYLE_KEYS.some(k => s[k]?.on) || (s.fill ?? 1) < 1);
function stylePad(s) {
  let p = 0;
  if (s.dropShadow.on) p = Math.max(p, s.dropShadow.distance + s.dropShadow.size * 1.3);
  if (s.outerGlow.on) p = Math.max(p, s.outerGlow.size * 1.3);
  if (s.stroke.on && s.stroke.position !== 'inside') p = Math.max(p, s.stroke.position === 'center' ? s.stroke.size / 2 : s.stroke.size);
  if (s.bevel.on && s.bevel.style !== 'inner') p = Math.max(p, s.bevel.size + s.bevel.soften);
  return Math.ceil(p) + 3;
}

/* ---------- exact Euclidean distance transform (Felzenszwalb & Huttenlocher) ---------- */
function edt1d(f, n, d, v, z) {
  let k = 0; v[0] = 0; z[0] = -1e20; z[1] = 1e20;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = 1e20;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; const t = q - v[k]; d[q] = t * t + f[v[k]]; }
}
// distance from every pixel to the nearest pixel where src[i] is true
function edt(src, w, h) {
  const n = Math.max(w, h), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1), g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = src[i] ? 0 : 1e20;
  for (let x = 0; x < w; x++) { for (let y = 0; y < h; y++) f[y] = g[y * w + x]; edt1d(f, h, d, v, z); for (let y = 0; y < h; y++) g[y * w + x] = d[y]; }
  for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) f[x] = g[o + x]; edt1d(f, w, d, v, z); for (let x = 0; x < w; x++) g[o + x] = Math.sqrt(d[x]); }
  return g;
}

/* ---------- canvas helpers ---------- */
function covCanvas(cov, w, h, color) {   // Float32 coverage (0..1) -> canvas filled with color
  const img = new ImageData(w, h), d = img.data, [r, g, b] = hexToRgb(color);
  for (let i = 0, j = 0; i < cov.length; i++, j += 4) { const a = cov[i]; if (a <= 0) continue; d[j] = r; d[j + 1] = g; d[j + 2] = b; d[j + 3] = a >= 1 ? 255 : a * 255; }
  const c = mkR(w, h); cx(c).putImageData(img, 0, 0); return c;
}
function tint(src, color) { const o = clone(src), c = cx(o); c.globalCompositeOperation = 'source-in'; c.fillStyle = color; c.fillRect(0, 0, o.width, o.height); return o; }
function blurred(src, r) {
  if (r <= 0.3) return clone(src);
  const o = mk(src.width, src.height), c = cx(o);
  if (r <= 6) { c.filter = `blur(${r}px)`; c.drawImage(src, 0, 0); return o; }
  // large radius: blur a downscaled copy (much faster, visually identical for soft shadows/glows)
  const f = Math.min(8, r / 3), sw = Math.max(1, Math.round(src.width / f)), sh = Math.max(1, Math.round(src.height / f)), sm = mk(sw, sh), smc = cx(sm);
  smc.filter = `blur(${r / f}px)`; smc.drawImage(src, 0, 0, sw, sh);
  c.imageSmoothingQuality = 'high'; c.drawImage(sm, 0, 0, src.width, src.height); return o;
}
function inverseOf(shape) { const o = mk(shape.width, shape.height), c = cx(o); c.fillStyle = '#fff'; c.fillRect(0, 0, o.width, o.height); c.globalCompositeOperation = 'destination-out'; c.drawImage(shape, 0, 0); return o; }
function shifted(src, dx, dy, fillOutside) {
  const o = mk(src.width, src.height), c = cx(o);
  if (fillOutside) { c.fillStyle = '#fff'; c.fillRect(0, 0, o.width, o.height); c.clearRect(dx, dy, o.width, o.height); }
  c.drawImage(src, dx, dy); return o;
}
function boxBlurF(a, w, h, r) {   // separable box blur on a Float32 field (soften)
  r = Math.round(r); if (r < 1) return a;
  const t = new Float32Array(a.length), o = new Float32Array(a.length), k = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) { let s = 0; const row = y * w; for (let x = -r; x <= r; x++) s += a[row + clamp(x, 0, w - 1)]; for (let x = 0; x < w; x++) { t[row + x] = s * k; s += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)]; } }
  for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[clamp(y, 0, h - 1) * w + x]; for (let y = 0; y < h; y++) { o[y * w + x] = s * k; s += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; } }
  return o;
}
const smoothstep = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);

/* ---------- build the styled rendering of a layer ----------
   Returns { x, y, behind:[{canvas, opacity, blend}], body } in doc space. `behind` effects blend with the backdrop;
   `body` = fill pixels + overlays + inner effects + stroke, drawn with the layer's blend mode. */
function buildStyled(L, img, s) {
  const P = stylePad(s), W = img.width + 2 * P, H = img.height + 2 * P, N = W * H;
  const shape = mkR(W, H); cx(shape).drawImage(img, P, P);
  let A = null, dIn = null, dOut = null;
  const alpha = () => { if (!A) { const d = cx(shape).getImageData(0, 0, W, H).data; A = new Float32Array(N); for (let i = 0; i < N; i++) A[i] = d[i * 4 + 3] / 255; } return A; };
  const distOut = () => { if (!dOut) { const a = alpha(), m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = a[i] >= 0.5; dOut = edt(m, W, H); } return dOut; };
  const distIn = () => { if (!dIn) { const a = alpha(), m = new Uint8Array(N); for (let i = 0; i < N; i++) m[i] = a[i] < 0.5; dIn = edt(m, W, H); } return dIn; };
  const dilated = r => { const a = alpha(), d = distOut(), c = new Float32Array(N); for (let i = 0; i < N; i++) c[i] = Math.max(a[i], clamp(r - d[i] + 1, 0, 1)); return c; };
  const eroded = r => { const a = alpha(), d = distIn(), c = new Float32Array(N); for (let i = 0; i < N; i++) c[i] = a[i] * clamp(d[i] - r, 0, 1); return c; };
  const rad = deg => deg * Math.PI / 180;
  const behind = [];
  const knock = cv => { const c = cx(cv); c.globalCompositeOperation = 'destination-out'; c.drawImage(shape, 0, 0); reset(c); return cv; };
  if (s.dropShadow.on) {
    const e = s.dropShadow, sp = e.size * e.spread / 100, base = sp >= 0.5 ? covCanvas(dilated(sp), W, H, '#ffffff') : shape;
    const a = rad(e.angle), dx = Math.round(-Math.cos(a) * e.distance), dy = Math.round(Math.sin(a) * e.distance);
    const sh = tint(shifted(blurred(base, (e.size - sp) / 2), dx, dy), e.color);
    behind.push({ canvas: knock(sh), opacity: e.opacity, blend: e.blend });
  }
  if (s.outerGlow.on) {
    const e = s.outerGlow, sp = e.size * e.spread / 100, base = sp >= 0.5 ? covCanvas(dilated(sp), W, H, '#ffffff') : shape;
    const gl = tint(blurred(base, (e.size - sp) / 2), e.color), gc = cx(gl);
    if (e.size - sp > 1) { gc.globalCompositeOperation = 'source-over'; gc.globalAlpha = 0.6; gc.drawImage(tint(blurred(base, (e.size - sp) / 5), e.color), 0, 0); reset(gc); } // denser core
    behind.push({ canvas: knock(gl), opacity: e.opacity, blend: e.blend });
  }
  const body = mk(W, H), bc = cx(body);
  bc.globalAlpha = s.fill ?? 1; bc.drawImage(shape, 0, 0); reset(bc);
  const onBody = (cv, opacity, blend) => { reset(bc); blendDraw(bc, cv, 0, 0, opacity, blend); };
  const clipToShape = cv => { const c = cx(cv); c.globalCompositeOperation = 'destination-in'; c.drawImage(shape, 0, 0); reset(c); return cv; };
  if (s.gradientOverlay.on) {
    const e = s.gradientOverlay, g = mk(W, H), c = cx(g), a = rad(e.angle); let cxp, cyp;
    // align to the layer's content bounds (not its canvas, which may be larger)
    const al = alpha(); let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (al[y * W + x] > 0.02) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) { x0 = 0; y0 = 0; x1 = W - 1; y1 = H - 1; }
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1; cxp = x0 + bw / 2; cyp = y0 + bh / 2;
    const dir = { x: Math.cos(a), y: -Math.sin(a) }, half = (Math.abs(bw * dir.x) + Math.abs(bh * dir.y)) / 2 * e.scale / 100;
    let p0, p1;
    if (e.type === 'radial' || e.type === 'angle') { p0 = { x: cxp, y: cyp }; p1 = { x: cxp + dir.x * Math.max(bw, bh) / 2 * e.scale / 100, y: cyp + dir.y * Math.max(bw, bh) / 2 * e.scale / 100 }; }
    else if (e.type === 'reflected') { p0 = { x: cxp, y: cyp }; p1 = { x: cxp + dir.x * half, y: cyp + dir.y * half }; }
    else { p0 = { x: cxp - dir.x * half, y: cyp - dir.y * half }; p1 = { x: cxp + dir.x * half, y: cyp + dir.y * half }; }
    c.fillStyle = makeGradient(c, e.type, p0, p1, e.stops, e.reverse); c.fillRect(0, 0, W, H);
    onBody(clipToShape(g), e.opacity, e.blend);
  }
  if (s.colorOverlay.on) { const e = s.colorOverlay; onBody(tint(shape, e.color), e.opacity, e.blend); }
  if (s.innerGlow.on) {
    const e = s.innerGlow; let gl;
    if (e.source === 'center') { const a = alpha(), d = distIn(), ch = e.size * e.choke / 100, c = new Float32Array(N); for (let i = 0; i < N; i++) c[i] = a[i] * smoothstep((d[i] - ch) / Math.max(1, e.size - ch)); gl = covCanvas(c, W, H, e.color); }
    else {   // edge: full strength at the edge, fading inwards over `size` (choke keeps it solid longer)
      const a = alpha(), d = distIn(), ch = e.size * e.choke / 100, c = new Float32Array(N), span = Math.max(1, e.size - ch);
      for (let i = 0; i < N; i++) if (a[i] > 0) c[i] = a[i] * (1 - smoothstep((d[i] - 0.5 - ch) / span));
      gl = covCanvas(c, W, H, e.color);
    }
    onBody(gl, e.opacity, e.blend);
  }
  if (s.innerShadow.on) {
    const e = s.innerShadow, ch = e.size * e.choke / 100, a = rad(e.angle), dx = Math.round(-Math.cos(a) * e.distance), dy = Math.round(Math.sin(a) * e.distance);
    const inv = ch >= 0.5 ? covCanvas(eroded(ch).map(v => 1 - v), W, H, '#ffffff') : inverseOf(shape);
    onBody(clipToShape(tint(blurred(shifted(inv, dx, dy, true), (e.size - ch) / 2), e.color)), e.opacity, e.blend);
  }
  if (s.bevel.on) { const b = bevelMaps(s.bevel, alpha, distIn, distOut, shape, W, H); onBody(b.hi, s.bevel.hiOpacity, s.bevel.hiBlend); onBody(b.sh, s.bevel.shOpacity, s.bevel.shBlend); }
  if (s.stroke.on) {
    const e = s.stroke, a = alpha(), c = new Float32Array(N), r = e.position === 'center' ? e.size / 2 : e.size;
    if (e.position !== 'inside') { const d = distOut(); for (let i = 0; i < N; i++) c[i] = clamp(r - d[i] + 1, 0, 1) * (1 - a[i]); }
    if (e.position !== 'outside') { const d = distIn(); for (let i = 0; i < N; i++) c[i] += a[i] * clamp(r - d[i] + 1, 0, 1); }
    onBody(covCanvas(c, W, H, e.color), e.opacity, e.blend);
  }
  return { x: L.x - P, y: L.y - P, behind, body };
}
// Bevel & Emboss: height field from the shape, lit by a directional light -> highlight & shadow canvases
function bevelMaps(e, alpha, distIn, distOut, shape, W, H) {
  const N = W * H, a = alpha(), hgt = new Float32Array(N), sz = Math.max(1, e.size);
  if (e.technique === 'smooth') {
    const b = cx(blurred(shape, sz / 2)).getImageData(0, 0, W, H).data;
    for (let i = 0; i < N; i++) { const v = b[i * 4 + 3] / 255; hgt[i] = e.style === 'inner' ? Math.min(a[i], v) : e.style === 'outer' ? Math.max(a[i], v) : v; }
  } else {
    const di = e.style !== 'outer' ? distIn() : null, dO = e.style !== 'inner' ? distOut() : null;
    for (let i = 0; i < N; i++) {
      if (e.style === 'inner') hgt[i] = a[i] * smoothstep((di[i] - 0.5) / sz);
      else if (e.style === 'outer') hgt[i] = a[i] >= 0.5 ? 1 : 1 - smoothstep((dO[i] - 0.5) / sz);
      else hgt[i] = a[i] >= 0.5 ? 0.5 + 0.5 * smoothstep((di[i] - 0.5) / (sz / 2)) : 0.5 - 0.5 * smoothstep((dO[i] - 0.5) / (sz / 2));
    }
  }
  const h = e.soften > 0 ? boxBlurF(hgt, W, H, e.soften) : hgt;
  const ang = e.angle * Math.PI / 180, alt = e.altitude * Math.PI / 180, lx = Math.cos(alt) * Math.cos(ang), ly = -Math.cos(alt) * Math.sin(ang), lz = Math.sin(alt);
  const k = (e.dir === 'down' ? -1 : 1) * e.depth / 100 * sz * 1.6, flat = lz;
  const hi = new Float32Array(N), sh = new Float32Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, gx = (h[i + 1] - h[i - 1]) / 2, gy = (h[i + W] - h[i - W]) / 2;
    if (!gx && !gy) continue;
    const nx = -gx * k, ny = -gy * k, inv = 1 / Math.sqrt(nx * nx + ny * ny + 1), sd = (nx * lx + ny * ly + lz) * inv;
    const region = e.style === 'inner' ? a[i] : e.style === 'outer' ? 1 - a[i] : 1;
    if (sd > flat) hi[i] = Math.min(1, (sd - flat) / Math.max(0.05, 1 - flat) * 1.4) * region;
    else sh[i] = Math.min(1, (flat - sd) / Math.max(0.05, flat) * 1.2) * region;
  }
  return { hi: covCanvas(hi, W, H, e.hiColor), sh: covCanvas(sh, W, H, e.shColor) };
}
const styleCache = new Map();
function styledOf(L, img, cacheable) {
  if (!cacheable) return buildStyled(L, img, L.style);
  const key = docVer + '|' + L.id;
  let r = styleCache.get(L.id);
  if (!r || r.key !== key) { if (styleCache.size > 48) styleCache.clear(); r = buildStyled(L, img, L.style); r.key = key; styleCache.set(L.id, r); }
  return r;
}
function drawStyled(target, L, img, cacheable) {
  const r = styledOf(L, img, cacheable), c = cx(target); reset(c);
  r.behind.forEach(b => blendDraw(c, b.canvas, r.x, r.y, L.opacity * b.opacity, b.blend));
  blendDraw(c, r.body, r.x, r.y, L.opacity, L.blend);
}
// Bake a layer's style (and mask) into plain pixels: {canvas, x, y} with normal blending of the effects
function bakeStyled(L) {
  let img = L.canvas;
  if (L.mask && L.mask.enabled) { img = clone(L.canvas); const ic = cx(img); ic.globalCompositeOperation = 'destination-in'; drawLumAlpha(ic, L.mask.canvas, 0, 0); reset(ic); }
  const r = buildStyled(L, img, L.style), o = mk(r.body.width, r.body.height), c = cx(o);
  r.behind.forEach(b => { c.globalAlpha = b.opacity; c.drawImage(b.canvas, 0, 0); });
  c.globalAlpha = 1; c.drawImage(r.body, 0, 0); reset(c);
  return { canvas: o, x: r.x, y: r.y };
}
function rasterizeStyle(L, quiet) {
  if (!L.style || !styleHasEffects(L.style) || !L.canvas) { L.style = null; return false; }
  rasterize(L);
  const b = bakeStyled(L); setCanvas(L, b.canvas); L.x = b.x; L.y = b.y; L.mask = null; L.style = null;
  if (!quiet) toast('Layer style rasterized into pixels');
  return true;
}

/* ---------- Layer Style dialog ---------- */
const STYLE_FIELDS = {
  blending: [['fill', 'Fill opacity', 'pct'], ['_opacity', 'Layer opacity', 'pct'], ['_blend', 'Blend mode', 'blend']],
  dropShadow: [['blend', 'Blend mode', 'blend'], ['color', 'Color', 'color'], ['opacity', 'Opacity', 'pct'], ['angle', 'Angle °', 'range', -180, 180], ['distance', 'Distance', 'px', 0, 200], ['spread', 'Spread %', 'range', 0, 100], ['size', 'Size', 'px', 0, 120]],
  innerShadow: [['blend', 'Blend mode', 'blend'], ['color', 'Color', 'color'], ['opacity', 'Opacity', 'pct'], ['angle', 'Angle °', 'range', -180, 180], ['distance', 'Distance', 'px', 0, 120], ['choke', 'Choke %', 'range', 0, 100], ['size', 'Size', 'px', 0, 120]],
  outerGlow: [['blend', 'Blend mode', 'blend'], ['color', 'Color', 'color'], ['opacity', 'Opacity', 'pct'], ['spread', 'Spread %', 'range', 0, 100], ['size', 'Size', 'px', 0, 150]],
  innerGlow: [['blend', 'Blend mode', 'blend'], ['color', 'Color', 'color'], ['opacity', 'Opacity', 'pct'], ['source', 'Source', 'sel', [['edge', 'Edge'], ['center', 'Center']]], ['choke', 'Choke %', 'range', 0, 100], ['size', 'Size', 'px', 0, 120]],
  bevel: [['style', 'Style', 'sel', [['inner', 'Inner Bevel'], ['outer', 'Outer Bevel'], ['emboss', 'Emboss']]], ['technique', 'Technique', 'sel', [['smooth', 'Smooth'], ['chisel', 'Chisel']]], ['depth', 'Depth %', 'range', 1, 500], ['dir', 'Direction', 'sel', [['up', 'Up'], ['down', 'Down']]], ['size', 'Size', 'px', 1, 100], ['soften', 'Soften', 'px', 0, 20], ['angle', 'Light angle °', 'range', -180, 180], ['altitude', 'Altitude °', 'range', 0, 90], ['hiColor', 'Highlight', 'color'], ['hiOpacity', 'Highlight opacity', 'pct'], ['shColor', 'Shadow', 'color'], ['shOpacity', 'Shadow opacity', 'pct']],
  colorOverlay: [['blend', 'Blend mode', 'blend'], ['color', 'Color', 'color'], ['opacity', 'Opacity', 'pct']],
  gradientOverlay: [['blend', 'Blend mode', 'blend'], ['opacity', 'Opacity', 'pct'], ['type', 'Style', 'sel', [['linear', 'Linear'], ['radial', 'Radial'], ['reflected', 'Reflected'], ['angle', 'Angle']]], ['angle', 'Angle °', 'range', -180, 180], ['scale', 'Scale %', 'range', 10, 150], ['reverse', 'Reverse', 'check'], ['stops', 'Gradient', 'gradient']],
  stroke: [['size', 'Size', 'px', 1, 100], ['position', 'Position', 'sel', [['outside', 'Outside'], ['inside', 'Inside'], ['center', 'Center']]], ['blend', 'Blend mode', 'blend'], ['color', 'Color', 'color'], ['opacity', 'Opacity', 'pct']]
};
const STYLE_PRESETS = [
  ['Soft shadow', { dropShadow: { on: true, opacity: 0.55, distance: 10, size: 18 } }],
  ['Outline', { stroke: { on: true, size: 4, color: '#ffffff' }, dropShadow: { on: true, opacity: 0.45, distance: 3, size: 6 } }],
  ['Neon glow', { outerGlow: { on: true, color: '#3fe0ff', size: 26, spread: 10, opacity: 0.95 }, innerGlow: { on: true, color: '#ffffff', size: 6, opacity: 0.7 }, colorOverlay: { on: true, color: '#9af3ff' } }],
  ['Embossed', { bevel: { on: true, style: 'inner', size: 10, depth: 140 }, dropShadow: { on: true, opacity: 0.4, distance: 4, size: 8 } }],
  ['Gold', { gradientOverlay: { on: true, stops: GRADIENT_PRESETS[6][1](), angle: 90 }, bevel: { on: true, size: 6, depth: 180, technique: 'chisel' }, stroke: { on: true, size: 2, color: '#5a3600' }, dropShadow: { on: true, opacity: 0.5, distance: 6, size: 10 } }],
  ['Letterpress', { innerShadow: { on: true, opacity: 0.7, distance: 3, size: 4 }, dropShadow: { on: true, color: '#ffffff', blend: 'screen', opacity: 0.8, distance: 1, size: 0 } }]
];
function styleTargetOk(L) {
  if (L.type === 'adjust' || L.type === 'group') { toast('Layer styles apply to pixel and text layers'); return false; }
  if (!L.canvas) { toast('This layer has no pixels'); return false; }
  return true;
}
function layerStyleDialog(L = layer(), focus) {
  if (!doc || !styleTargetOk(L)) return;
  const old = { style: L.style ? JSON.parse(JSON.stringify(L.style)) : null, opacity: L.opacity, blend: L.blend };
  const st = L.style ? sanitizeStyle(L.style) : defaultStyle();
  L.style = st;
  let sel = focus && STYLE_FIELDS[focus] ? focus : (STYLE_KEYS.find(k => st[k].on) || 'blending'), pend = false;
  const live = () => { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; requestRender(); }); };
  const ov = document.createElement('div'); ov.className = 'modal';
  const box = document.createElement('div'); box.className = 'box lsbox'; ov.appendChild(box);
  box.innerHTML = '<h3></h3><div class="lsgrid"><div class="lslist"></div><div class="lspanel"></div></div><div class="btns"><select class="lspreset"><option value="">Presets…</option></select><span style="flex:1"></span><button class="b" data-a="r">Clear All</button><button class="b" data-a="c">Cancel</button><button class="b pri" data-a="o">OK</button></div>';
  box.querySelector('h3').textContent = 'Layer Style — ' + L.name;
  const list = box.querySelector('.lslist'), panel = box.querySelector('.lspanel'), pre = box.querySelector('.lspreset');
  STYLE_PRESETS.forEach(([n], i) => pre.add(new Option(n, i)));
  pre.onchange = () => {
    if (pre.value === '') return;
    const p = STYLE_PRESETS[+pre.value][1], fresh = defaultStyle();
    STYLE_KEYS.forEach(k => { st[k] = Object.assign(fresh[k], p[k] ? JSON.parse(JSON.stringify(p[k])) : {}); });
    pre.value = ''; sel = STYLE_KEYS.find(k => st[k].on) || 'blending'; buildList(); buildPanel(); live();
  };
  const buildList = () => {
    list.innerHTML = '';
    [['blending', 'Blending Options'], ...STYLE_KEYS.map(k => [k, STYLE_NAMES[k]])].forEach(([k, name]) => {
      const it = document.createElement('div'); it.className = 'lsitem' + (k === sel ? ' on' : '');
      if (k !== 'blending') { const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = st[k].on; cb.onclick = e => { e.stopPropagation(); st[k].on = cb.checked; sel = k; buildList(); buildPanel(); live(); }; it.appendChild(cb); }
      else it.classList.add('bo');
      it.appendChild(document.createTextNode(name));
      it.onclick = () => { sel = k; buildList(); buildPanel(); };
      list.appendChild(it);
    });
  };
  const buildPanel = () => {
    panel.innerHTML = '';
    const head = document.createElement('div'); head.className = 'lshead'; head.textContent = sel === 'blending' ? 'Blending Options' : STYLE_NAMES[sel]; panel.appendChild(head);
    const obj = sel === 'blending' ? null : st[sel];
    STYLE_FIELDS[sel].forEach(([key, label, kind, a, b]) => {
      const row = document.createElement('div'); row.className = 'row'; const lab = document.createElement('label'); lab.textContent = label; row.appendChild(lab);
      const get = () => sel === 'blending' ? (key === 'fill' ? st.fill : key === '_opacity' ? L.opacity : L.blend) : obj[key];
      const put = v => { if (sel === 'blending') { if (key === 'fill') st.fill = v; else if (key === '_opacity') L.opacity = v; else L.blend = v; } else { obj[key] = v; if (!obj.on) { obj.on = true; buildList(); } } live(); };
      const val = document.createElement('span'); val.className = 'val';
      let inp;
      if (kind === 'gradient') {
        const host = document.createElement('div'); host.className = 'lsgrad'; row.classList.add('wide'); row.appendChild(host); panel.appendChild(row);
        gradientWidget(host, obj, () => { if (!obj.on) { obj.on = true; buildList(); } live(); });
        return;
      }
      if (kind === 'blend' || kind === 'sel') {
        inp = document.createElement('select');
        (kind === 'blend' ? (key === '_blend' ? BLENDS : BLENDS.filter(b => b[0] !== 'pass-through')) : a).forEach(([v, t]) => inp.add(new Option(t, v)));
        inp.value = get(); inp.onchange = () => put(inp.value);
      } else if (kind === 'color') { inp = document.createElement('input'); inp.type = 'color'; inp.value = get(); inp.oninput = () => put(inp.value); inp.style.justifySelf = 'start'; }
      else if (kind === 'check') { inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = !!get(); inp.onchange = () => put(inp.checked); inp.style.justifySelf = 'start'; }
      else {
        inp = document.createElement('input'); inp.type = 'range';
        const pct = kind === 'pct', lo = pct ? 0 : a, hi = pct ? 100 : b;
        inp.min = lo; inp.max = hi; inp.step = 1; inp.value = pct ? Math.round(get() * 100) : get();
        const show = () => val.textContent = pct ? inp.value + '%' : kind === 'px' ? inp.value + ' px' : inp.value;
        inp.oninput = () => { show(); put(pct ? inp.value / 100 : +inp.value); }; show();
      }
      inp.dataset.k = key; row.append(inp, val); panel.appendChild(row);
    });
    if (sel === 'blending') panel.insertAdjacentHTML('beforeend', '<p class="dnote">Fill opacity fades the layer\'s own pixels but keeps its effects — set it to 0% for an outline-only or glass look.</p>');
  };
  const close = () => { ov.remove(); document.removeEventListener('keydown', kh, true); };
  const ok = () => { close(); if (!styleHasEffects(st)) L.style = null; pushHistory('Layer Style'); };
  const cancel = () => { close(); L.style = old.style; L.opacity = old.opacity; L.blend = old.blend; requestRender(); updatePanels(); };
  const kh = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); e.stopPropagation(); ok(); } };
  box.querySelector('.btns').addEventListener('click', e => {
    const a = e.target.dataset.a;
    if (a === 'o') ok(); else if (a === 'c') cancel();
    else if (a === 'r') { const f = defaultStyle(); STYLE_KEYS.forEach(k => st[k] = f[k]); st.fill = 1; sel = 'blending'; buildList(); buildPanel(); live(); }
  });
  document.addEventListener('keydown', kh, true);
  buildList(); buildPanel(); document.body.appendChild(ov); live();
}
let styleClipboard = null;
function copyStyle() { const L = layer(); if (!L.style) return toast('This layer has no style'); styleClipboard = JSON.parse(JSON.stringify(L.style)); toast('Layer style copied'); }
function pasteStyle() { const L = layer(); if (!styleClipboard) return toast('Copy a layer style first'); if (!styleTargetOk(L)) return; L.style = sanitizeStyle(styleClipboard); pushHistory('Paste Layer Style'); }
function clearStyle() { const L = layer(); if (!L.style) return; L.style = null; pushHistory('Clear Layer Style'); }
function rasterizeStyleCmd() { const L = layer(); if (!L.style) return toast('This layer has no style'); if (rasterizeStyle(L)) pushHistory('Rasterize Layer Style'); }

/* ---------- PSD effects -> layer styles (import) ---------- */
function psdColor(c) { if (!c || typeof c !== 'object') return null; const r = c.r ?? (c.fr != null ? c.fr * 255 : null), g = c.g ?? (c.fg != null ? c.fg * 255 : null), b = c.b ?? (c.fb != null ? c.fb * 255 : null); return r == null ? null : rgbToHex(clamp(r, 0, 255), clamp(g, 0, 255), clamp(b, 0, 255)); }
const psdUnits = u => typeof u === 'number' ? u : u && Number.isFinite(+u.value) ? +u.value : undefined;
function styleFromPsdEffects(fx) {
  if (!fx || typeof fx !== 'object' || fx.disabled) return null;
  const first = v => Array.isArray(v) ? v.find(e => e && e.enabled !== false) : v && v.enabled !== false ? v : null;
  const bl = m => PSD_BLEND[m] || undefined, s = {}; let any = false;
  const put = (k, o) => { s[k] = { on: true }; Object.entries(o).forEach(([a, v]) => { if (v !== undefined && v !== null) s[k][a] = v; }); any = true; };
  let e;
  if ((e = first(fx.dropShadow))) put('dropShadow', { color: psdColor(e.color), opacity: e.opacity, blend: bl(e.blendMode), angle: e.angle, distance: psdUnits(e.distance), spread: psdUnits(e.choke), size: psdUnits(e.size) });
  if ((e = first(fx.innerShadow))) put('innerShadow', { color: psdColor(e.color), opacity: e.opacity, blend: bl(e.blendMode), angle: e.angle, distance: psdUnits(e.distance), choke: psdUnits(e.choke), size: psdUnits(e.size) });
  if ((e = first(fx.outerGlow))) put('outerGlow', { color: psdColor(e.color), opacity: e.opacity, blend: bl(e.blendMode), spread: psdUnits(e.choke), size: psdUnits(e.size) });
  if ((e = first(fx.innerGlow))) put('innerGlow', { color: psdColor(e.color), opacity: e.opacity, blend: bl(e.blendMode), source: e.source === 'center' ? 'center' : 'edge', choke: psdUnits(e.choke), size: psdUnits(e.size) });
  if ((e = first(fx.solidFill))) put('colorOverlay', { color: psdColor(e.color), opacity: e.opacity, blend: bl(e.blendMode) });
  if ((e = first(fx.stroke)) && (!e.fillType || e.fillType === 'color')) put('stroke', { color: psdColor(e.color), opacity: e.opacity, blend: bl(e.blendMode), size: psdUnits(e.size), position: e.position === 'inside' ? 'inside' : e.position === 'center' ? 'center' : 'outside' });
  if ((e = first(fx.bevel))) put('bevel', { style: e.style === 'outer bevel' ? 'outer' : e.style === 'emboss' ? 'emboss' : 'inner', technique: /chisel/.test(e.technique || '') ? 'chisel' : 'smooth', depth: e.strength != null ? e.strength * 100 : undefined, dir: e.direction === 'down' ? 'down' : 'up', size: psdUnits(e.size), soften: psdUnits(e.soften), angle: e.angle, altitude: e.altitude, hiColor: psdColor(e.highlightColor), hiOpacity: e.highlightOpacity, shColor: psdColor(e.shadowColor), shOpacity: e.shadowOpacity });
  if ((e = first(fx.gradientOverlay)) && e.gradient && Array.isArray(e.gradient.colorStops)) {
    const op = e.gradient.opacityStops || [];
    put('gradientOverlay', { opacity: e.opacity, blend: bl(e.blendMode), angle: e.angle, reverse: !!e.reverse, scale: e.scale != null ? e.scale * 100 : undefined, type: ['linear', 'radial', 'reflected', 'angle'].includes(e.type) ? e.type : 'linear', stops: e.gradient.colorStops.map(c => ({ p: c.location, c: psdColor(c.color) || '#000000', a: op.length ? (op.reduce((m, o) => Math.abs(o.location - c.location) < Math.abs(m.location - c.location) ? o : m, op[0]).opacity ?? 1) : 1 })) });
  }
  return any ? sanitizeStyle(s) : null;
}
