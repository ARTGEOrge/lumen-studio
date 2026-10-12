'use strict';
/* Advanced selection: Select > Color Range, the Quick Selection brush (Shift+W) and Refine Edge (edge-aware matting). */
function selAlpha() {   // current selection as Float32 alpha 0..1 (doc-sized)
  const a = new Float32Array(doc.w * doc.h); if (!selection) return a;
  const d = cx(selection.mask).getImageData(0, 0, doc.w, doc.h).data;
  for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255;
  return a;
}
function alphaToMask(a) {
  const img = new ImageData(doc.w, doc.h), d = img.data;
  for (let i = 0; i < a.length; i++) { const v = a[i]; if (v <= 0) continue; const j = i * 4; d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = v >= 1 ? 255 : v * 255; }
  const m = mk(doc.w, doc.h); cx(m).putImageData(img, 0, 0); return m;
}
let pixCache = { key: null };
function docPixels() {   // composite RGBA + Sobel gradient magnitude, cached per document version
  const key = docVer + ':' + doc.w + 'x' + doc.h;
  if (pixCache.key === key) return pixCache;
  composite(); const d = cx(comp).getImageData(0, 0, doc.w, doc.h).data, w = doc.w, h = doc.h, lum = new Float32Array(w * h), grad = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) lum[i] = .299 * d[i * 4] + .587 * d[i * 4 + 1] + .114 * d[i * 4 + 2];
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, gx = lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1] - lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1], gy = lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1] - lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1];
    grad[i] = Math.hypot(gx, gy) / 4;
  }
  pixCache = { key, d, lum, grad }; return pixCache;
}

/* ---------- Color Range ---------- */
function hsvOf(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dd = mx - mn; return { h: hueOf(r, g, b), s: mx ? dd / mx : 0, v: mx / 255 }; }
const hueDist = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
function colorRangeAlpha(v) {
  const { d } = docPixels(), n = doc.w * doc.h, a = new Float32Array(n), fz = v.fuzz;
  const [sr, sg, sb] = hexToRgb(HEX6.test(v.color) ? v.color : '#000000'), fam = { reds: 0, yellows: 60, greens: 120, cyans: 180, blues: 240, magentas: 300 }[v.mode];
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2]; let w;
    if (v.mode === 'sample') { const dist = Math.sqrt(((r - sr) ** 2 * 2 + (g - sg) ** 2 * 4 + (b - sb) ** 2 * 3) / 9); w = 1 - dist / (fz + 1); }
    else if (fam !== undefined) { const c = hsvOf(r, g, b), width = 22 + fz / 5; w = clamp((width + 12 - hueDist(c.h, fam)) / 12, 0, 1) * smoothstep((c.s - 0.08) / 0.22) * smoothstep((c.v - 0.06) / 0.15); }
    else if (v.mode === 'skin') { const c = hsvOf(r, g, b); w = clamp((22 + fz / 8 - hueDist(c.h, 22)) / 10, 0, 1) * smoothstep((c.s - 0.12) / 0.12) * (1 - smoothstep((c.s - 0.62) / 0.15)) * smoothstep((c.v - 0.25) / 0.2); }
    else { const L = (.299 * r + .587 * g + .114 * b), k = fz / 4 + 20; w = v.mode === 'highlights' ? smoothstep((L - (200 - k)) / k) : v.mode === 'shadows' ? 1 - smoothstep((L - 55) / k) : 1 - Math.abs(L - 128) / (60 + k); }
    w = clamp(w, 0, 1); if (d[i * 4 + 3] === 0) w = 0;
    a[i] = v.invert ? 1 - w : w;
  }
  return a;
}
let canvasPickHook = null;   // while a dialog wants a color from the image, clicks on the canvas go here
function colorRangeDialog() {
  const prev = selection ? clone(selection.mask) : null, base = selAlpha();
  showDialog({
    title: 'Color Range', ok: 'OK', side: true, fields: [
      { key: 'mode', label: 'Select', type: 'select', value: 'sample', options: [['sample', 'Sampled color'], ['reds', 'Reds'], ['yellows', 'Yellows'], ['greens', 'Greens'], ['cyans', 'Cyans'], ['blues', 'Blues'], ['magentas', 'Magentas'], ['highlights', 'Highlights'], ['midtones', 'Midtones'], ['shadows', 'Shadows'], ['skin', 'Skin tones']] },
      { key: 'color', label: 'Sampled color', type: 'color', value: fg },
      { key: 'fuzz', label: 'Fuzziness', type: 'range', min: 0, max: 200, value: 40 },
      { key: 'invert', label: 'Invert', type: 'checkbox', value: false },
      { key: 'add', label: 'Add to selection', type: 'checkbox', value: false }],
    html: '<p class="dnote">Click in the image to sample a color. The marching ants preview the selection live.</p>',
    onMount: (box, set) => { canvasPickHook = p => { composite(); const x = Math.floor(p.x), y = Math.floor(p.y); if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return; const d = cx(comp).getImageData(x, y, 1, 1).data; set('mode', 'sample'); set('color', rgbToHex(d[0], d[1], d[2])); }; },
    onChange: v => { const a = colorRangeAlpha(v); if (v.add) for (let i = 0; i < a.length; i++) a[i] = Math.max(a[i], base[i]); setSel(alphaToMask(a)); },
    onOK: v => { canvasPickHook = null; const a = colorRangeAlpha(v); if (v.add) for (let i = 0; i < a.length; i++) a[i] = Math.max(a[i], base[i]); const m = alphaToMask(a); setSel(maskEmpty(m) ? null : m); if (!selection) toast('No pixels matched'); recordStep({ type: 'colorRange', params: v }); },
    onCancel: () => { canvasPickHook = null; setSel(prev); }
  });
}

/* ---------- Quick Selection brush ---------- */
const QS = {
  down(p, e) {
    const P = docPixels(), n = doc.w * doc.h;
    this.mode = e.altKey ? 'sub' : 'add';
    this.sel = new Uint8Array(n);
    if (selection) { const a = selAlpha(); for (let i = 0; i < n; i++) this.sel[i] = a[i] >= 0.5; }   // strokes add to (Alt: subtract from) the selection
    this.P = P; this.stats = { n: 0, r: 0, g: 0, b: 0, rr: 0, gg: 0, bb: 0 }; this.last = null; this.dirty = null;
    this.dab(p);
  },
  move(p) {
    if (!this.sel) return;
    const l = this.last, r = Math.max(2, opts.size / 2), st = Math.max(1, r / 2);
    if (l) { const d = Math.hypot(p.x - l.x, p.y - l.y); if (d < st) return; for (let t = st; t < d; t += st) this.dab({ x: l.x + (p.x - l.x) * t / d, y: l.y + (p.y - l.y) * t / d }); }
    this.dab(p);
  },
  dab(p) {
    this.last = p;
    const w = doc.w, h = doc.h, d = this.P.d, grad = this.P.grad, r = Math.max(2, opts.size / 2), S = this.stats, sel = this.sel, val = this.mode === 'sub' ? 0 : 1;
    const x0 = Math.max(0, Math.floor(p.x - r)), x1 = Math.min(w - 1, Math.ceil(p.x + r)), y0 = Math.max(0, Math.floor(p.y - r)), y1 = Math.min(h - 1, Math.ceil(p.y + r));
    if (x0 > x1 || y0 > y1) return;
    const seeds = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if ((x - p.x) ** 2 + (y - p.y) ** 2 <= r * r) {
      const i = y * w + x, R = d[i * 4], G = d[i * 4 + 1], B = d[i * 4 + 2];
      S.n++; S.r += R; S.g += G; S.b += B; S.rr += R * R; S.gg += G * G; S.bb += B * B; seeds.push(i);
    }
    const mr = S.r / S.n, mg = S.g / S.n, mb = S.b / S.n, sd = Math.sqrt(Math.max(0, (S.rr / S.n - mr * mr + S.gg / S.n - mg * mg + S.bb / S.n - mb * mb) / 3));
    const T = 14 + opts.qsTol + sd * 1.6, T2 = T * T, G = 26 + opts.qsTol * 1.2 + sd, R = Math.max(r * 5, 80);
    const wx0 = Math.max(0, Math.floor(p.x - R)), wx1 = Math.min(w - 1, Math.ceil(p.x + R)), wy0 = Math.max(0, Math.floor(p.y - R)), wy1 = Math.min(h - 1, Math.ceil(p.y + R));
    const seen = new Uint8Array((wx1 - wx0 + 1) * (wy1 - wy0 + 1)), ww = wx1 - wx0 + 1, q = [];
    seeds.forEach(i => { sel[i] = val; const x = i % w, y = (i / w) | 0; seen[(y - wy0) * ww + x - wx0] = 1; q.push(i); });
    const ok = i => { const dr = d[i * 4] - mr, dg = d[i * 4 + 1] - mg, db = d[i * 4 + 2] - mb; return (dr * dr * 2 + dg * dg * 4 + db * db * 3) / 3 < T2 && grad[i] < G; };
    while (q.length) {
      const i = q.pop(), x = i % w, y = (i / w) | 0;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        if (nx < wx0 || nx > wx1 || ny < wy0 || ny > wy1) continue;
        const k = (ny - wy0) * ww + nx - wx0; if (seen[k]) continue; seen[k] = 1;
        if ((nx - p.x) ** 2 + (ny - p.y) ** 2 > R * R) continue;
        const j = ny * w + nx; if (!ok(j)) continue;
        sel[j] = val; q.push(j);
      }
    }
    const box = { x: wx0, y: wy0, w: ww, h: wy1 - wy0 + 1 };
    this.dirty = this.dirty ? unionRect(this.dirty, box) : box;
    if (!QS.raf) QS.raf = requestAnimationFrame(() => { QS.raf = 0; QS.flush(); });
  },
  flush() {
    if (!this.sel || !this.dirty) return;
    const b = this.dirty; this.dirty = null;
    if (!selection) setSel(mk(doc.w, doc.h));
    const c = cx(selection.mask), img = c.createImageData(b.w, b.h), dd = img.data, w = doc.w;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) { if (this.sel[(b.y + y) * w + b.x + x]) { const j = (y * b.w + x) * 4; dd[j] = dd[j + 1] = dd[j + 2] = dd[j + 3] = 255; } }
    c.putImageData(img, b.x, b.y); setSel(selection.mask);
  },
  up() {
    if (!this.sel) return;
    if (QS.raf) { cancelAnimationFrame(QS.raf); QS.raf = 0; }
    this.dirty = { x: 0, y: 0, w: doc.w, h: doc.h }; this.flush();
    // light cleanup: close pinholes and smooth jaggies
    const m = thresholdBlur(selection.mask, 1.2, 110);
    setSel(maskEmpty(m) ? null : m);
    this.sel = null; this.P = null;
  }
};
opts.qsTol = 12;

/* ---------- Refine Edge ---------- */
function refineAlpha(v, base) {
  const w = doc.w, h = doc.h, n = w * h, a = Float32Array.from(base);
  if (v.radius > 0) {
    const hard = new Uint8Array(n), soft = new Uint8Array(n); for (let i = 0; i < n; i++) { hard[i] = base[i] >= 0.5; soft[i] = !hard[i]; }
    const dIn = edt(soft, w, h), dOut = edt(hard, w, h), R = v.radius;
    const { d } = docPixels();
    const src = mk(w, h); cx(src).drawImage(comp, 0, 0);
    const est = sure => { const o = clone(src), c = cx(o), m = alphaToMask(sure); c.globalCompositeOperation = 'destination-in'; c.drawImage(m, 0, 0); return cx(cssFilter(o, `blur(${Math.max(2, R * 0.8)}px)`)).getImageData(0, 0, w, h).data; };
    const fgA = new Float32Array(n), bgA = new Float32Array(n);
    for (let i = 0; i < n; i++) { fgA[i] = hard[i] && dIn[i] > R ? 1 : 0; bgA[i] = !hard[i] && dOut[i] > R ? 1 : 0; }
    const F = est(fgA), B = est(bgA);
    for (let i = 0; i < n; i++) {
      const dist = hard[i] ? dIn[i] : dOut[i]; if (dist > R) continue;
      const j = i * 4; if (F[j + 3] < 8 || B[j + 3] < 8) continue;
      const fr = F[j] - B[j], fg2 = F[j + 1] - B[j + 1], fb = F[j + 2] - B[j + 2], den = fr * fr + fg2 * fg2 + fb * fb;
      if (den < 900) continue;   // fore/background colors too similar here: keep the original edge
      const t = ((d[j] - B[j]) * fr + (d[j + 1] - B[j + 1]) * fg2 + (d[j + 2] - B[j + 2]) * fb) / den;
      a[i] = clamp(t, 0, 1);
    }
  }
  let m = alphaToMask(a);
  if (v.smooth > 0) m = cssFilter(m, `blur(${v.smooth * 0.6}px)`);
  if (v.feather > 0) m = cssFilter(m, `blur(${v.feather}px)`);
  const out = new Float32Array(n), md = cx(m).getImageData(0, 0, w, h).data, k = 1 + v.contrast / 100 * 9, sh = v.shift / 100;
  for (let i = 0; i < n; i++) { let x = md[i * 4 + 3] / 255; if (v.smooth > 0) x = smoothstep((x - 0.3) / 0.4) * 0.6 + x * 0.4; x = (x - 0.5) * k + 0.5 + sh; out[i] = clamp(x, 0, 1); }
  return out;
}
function refineEdgeDialog() {
  if (!selection) return toast('Make a selection first (Quick Selection, Magic Wand, Color Range…)');
  const prev = clone(selection.mask), base = selAlpha();
  showDialog({
    title: 'Refine Edge', side: true, fields: [
      { key: 'radius', label: 'Edge radius (px)', type: 'range', min: 0, max: 60, value: 8 },
      { key: 'smooth', label: 'Smooth', type: 'range', min: 0, max: 20, value: 2 },
      { key: 'feather', label: 'Feather (px)', type: 'range', min: 0, max: 30, step: 0.5, value: 0 },
      { key: 'contrast', label: 'Contrast %', type: 'range', min: 0, max: 100, value: 0 },
      { key: 'shift', label: 'Shift edge %', type: 'range', min: -50, max: 50, value: 0 },
      { key: 'out', label: 'Output to', type: 'select', value: 'sel', options: [['sel', 'Selection'], ['mask', 'Layer mask'], ['layer', 'New layer with mask']] }],
    html: '<p class="dnote">The edge radius band is re-estimated from the colors on both sides — great for hair and fur on a contrasting background.</p>',
    onChange: v => setSel(alphaToMask(refineAlpha(v, base))),
    onOK: v => {
      const a = refineAlpha(v, base), m = alphaToMask(a);
      if (v.out === 'sel') { setSel(maskEmpty(m) ? null : m); return; }
      const L0 = layer();
      if (L0.type === 'group' || L0.type === 'adjust' || !L0.canvas) { setSel(m); return toast('Pick a pixel layer to output a mask'); }
      let L = L0;
      if (v.out === 'layer') { L = newLayer(L0.name + ' (refined)', clone(L0.canvas), L0.x, L0.y); L.parent = L0.parent; insertLayer(L); L0.visible = false; }
      else if (L.mask) { setSel(m); return toast('This layer already has a mask — delete it first or output to a new layer'); }
      ensureCover(L);
      const mm = newMaskCanvas(L, '#000'); const c = cx(mm); c.drawImage(m, -L.x, -L.y);
      L.mask = { canvas: mm, enabled: true }; doc.editMask = false; setSel(null);
      pushHistory(v.out === 'layer' ? 'Refine Edge (new layer)' : 'Refine Edge (mask)', 'all');
    },
    onCancel: () => setSel(prev)
  });
}
Tools.quicksel = QS;
