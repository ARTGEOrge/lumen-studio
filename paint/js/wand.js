'use strict';
/* Magic Wand selection, Select › Modify (Expand / Contract / Smooth) and Reference layers.
   A reference layer (Layer › Reference Layer) is what the Paint Bucket and Magic Wand "see" when their
   Sample option is "Reference layer": keep line art on its own layer, mark it as reference, and fill
   flat colors on a layer underneath without the fill leaking or touching the lines. */

topts.wand = { tol: 20, contiguous: true, sample: 'all', gap: 0, mode: 'replace', feather: 0, aa: true };

/* ---------- reference layers & sampling ---------- */
function refLayers() { return allLayers().filter(L => L.ref && L.type !== 'fill'); }
function refComposite() { // straight RGBA of all reference layers (normal blending, each at its opacity, visible or not)
  const list = refLayers().map(L => Object.assign(Object.create(Layer.prototype), L, { visible: true, clip: false, blend: L.type === 'group' ? 'normal' : L.blend }));
  R.ensureDoc(); return composeToRGBA(list);
}
// pixels a fill / wand compares against: 'all' layers, the current 'layer', or the 'ref'erence layers
function sampleSource(mode, L) {
  if (mode === 'ref') {
    if (refLayers().length) return refComposite();
    Aero.toast('No reference layer — sampling all layers (Layer › Reference Layer)');
    mode = 'all';
  }
  if (mode === 'layer' && L && L.type === 'pixel') return layerRGBA(L);
  if (doc.ver !== composedVer) { R.compose(); composedVer = doc.ver; }
  return R.readComposite();
}
function toggleRefLayer() {
  const L = doc.active; if (!L) return;
  if (L.type === 'fill') { Aero.toast('A fill layer cannot be a reference layer'); return; }
  if (!prepEdit()) return;
  L.ref = !L.ref; histPush(L.ref ? 'Set Reference Layer' : 'Clear Reference Layer');
  if (L.ref) { topts.fill.sample = topts.wand.sample = 'ref'; Aero.toast(`“${L.name}” is now the reference — the Paint Bucket and Magic Wand sample it`); }
  else if (!refLayers().length) { if (topts.fill.sample === 'ref') topts.fill.sample = 'all'; if (topts.wand.sample === 'ref') topts.wand.sample = 'all'; }
  renderCmd(); renderLayers();
}
const SAMPLE_OPTS = [['all', 'All layers'], ['layer', 'Current layer'], ['ref', 'Reference layer']];

/* ---------- matching (shared with the paint bucket) ---------- */
function colorMatchMask(src, w, h, x0, y0, tolPct) {
  const si = (y0 * w + x0) * 4, sr = src[si], sg = src[si + 1], sb = src[si + 2], sa = src[si + 3], tol = tolPct / 100 * 255;
  const match = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < match.length; i++, j += 4) {
    const a = src[j + 3]; let d;
    if (sa < 8 && a < 8) d = 0; else d = Math.max(Math.abs(a - sa), Math.abs(src[j] - sr) * Math.min(a, sa) / 255, Math.abs(src[j + 1] - sg) * Math.min(a, sa) / 255, Math.abs(src[j + 2] - sb) * Math.min(a, sa) / 255);
    match[i] = d <= tol ? 1 : 0;
  }
  return match;
}
// contiguous region around (x0,y0); gap > 0 closes small gaps in the outline first
function regionFromMatch(match, w, h, x0, y0, gap) {
  let reg = null;
  if (gap > 0) {
    const dist = distTransform(match, w, h, v => !v);
    const closed = new Uint8Array(w * h); for (let i = 0; i < closed.length; i++) closed[i] = match[i] && dist[i] > gap ? 1 : 0;
    if (closed[y0 * w + x0]) {
      const core = floodRegion(closed, w, h, x0, y0);
      const d2 = distTransform(core, w, h, v => v);
      reg = new Uint8Array(w * h); for (let i = 0; i < reg.length; i++) reg[i] = match[i] && d2[i] <= gap + 1 ? 1 : 0;
    }
  }
  return reg || floodRegion(match, w, h, x0, y0);
}
function featherMask(m, r) { // gaussian-soften an 8-bit mask by r px
  if (!(r > 0)) return m;
  const w = doc.w, h = doc.h, img = new ImageData(w, h); for (let i = 0; i < m.length; i++) img.data[i * 4 + 3] = m[i];
  const c1 = new OffscreenCanvas(w, h); c1.getContext('2d').putImageData(img, 0, 0);
  const c2 = new OffscreenCanvas(w, h), x = c2.getContext('2d', { willReadFrequently: true }); x.filter = `blur(${r}px)`; x.drawImage(c1, 0, 0);
  const d = x.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h); for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3];
  return out;
}

/* ---------- magic wand ---------- */
function wandMask(px, py, o = topts.wand) {
  const x0 = px | 0, y0 = py | 0, w = doc.w, h = doc.h; if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return null;
  dryAllWet();
  const src = sampleSource(o.sample, doc.active), match = colorMatchMask(src, w, h, x0, y0, o.tol);
  const reg = o.contiguous ? regionFromMatch(match, w, h, x0, y0, o.gap | 0) : match;
  let m = new Uint8Array(w * h); for (let i = 0; i < m.length; i++) m[i] = reg[i] ? 255 : 0;
  if (o.feather > 0) m = featherMask(m, o.feather);
  else if (o.aa) { // anti-alias: soften the outer edge with a [1 2 1] kernel (inside stays fully selected)
    const t = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0, i = y * w; x < w; x++, i++) t[i] = (m[x > 0 ? i - 1 : i] + 2 * m[i] + m[x < w - 1 ? i + 1 : i]) / 4;
    for (let y = 0; y < h; y++) for (let x = 0, i = y * w; x < w; x++, i++) { const v = (t[y > 0 ? i - w : i] + 2 * t[i] + t[y < h - 1 ? i + w : i]) / 4; if (v > m[i]) m[i] = v; }
  }
  return m;
}
const wandTool = {
  down(pt) {
    const mode = selMode(topts.wand), m = wandMask(pt.x, pt.y); if (!m) return false;
    setSelection(combineSel(m, mode), 'Magic Wand'); return false;
  },
  cursor(c, sp) {
    c.lineWidth = 1; c.strokeStyle = '#fff'; c.lineWidth = 3; c.beginPath(); c.moveTo(sp[0] + 2, sp[1] + 2); c.lineTo(sp[0] + 14, sp[1] + 14); c.stroke();
    c.lineWidth = 1.5; c.strokeStyle = '#000'; c.stroke();
    c.lineWidth = 1; c.beginPath(); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; c.moveTo(sp[0] + Math.cos(a) * 2, sp[1] + Math.sin(a) * 2); c.lineTo(sp[0] + Math.cos(a) * 6, sp[1] + Math.sin(a) * 6); } c.stroke();
  },
  options(bar) {
    const o = topts.wand;
    cmdSlider(bar, 'Tolerance', 0, 100, 1, () => o.tol, v => o.tol = v, v => v + '%');
    cmdCheck(bar, 'Contiguous', () => o.contiguous, v => o.contiguous = v);
    cmdSelect(bar, 'Sample', SAMPLE_OPTS, () => o.sample, v => o.sample = v);
    cmdCheck(bar, 'Anti-alias', () => o.aa, v => o.aa = v);
    selOptions(bar, o);
  }
};
TOOLS.wand = wandTool;
TOOL_DEFS.splice(TOOL_DEFS.findIndex(t => t && t.id === 'marquee') + 1, 0, { id: 'wand', title: 'Magic Wand (select by color)', key: 'Q', icon: '<path d="M4 20 15 9"/><path d="M15 9l2-2"/><path d="M17 2v3M17 11v3M20.5 4.5l-2 2M13.5 4.5l2 2M22 8h-3M12 8h3" opacity=".8"/>' });
TOOL_NAMES.wand = 'Magic Wand';

/* ---------- Select › Modify ---------- */
function selModify(kind, r) {
  const s = doc.sel; if (!s) { Aero.toast('No selection'); return; }
  const w = doc.w, h = doc.h, out = new Uint8Array(w * h);
  if (kind === 'expand') {
    const d = distTransform(s, w, h, v => v >= 128);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(s[i], Math.round(clamp(r + 1 - d[i], 0, 1) * 255));
  } else if (kind === 'contract') {
    const d = distTransform(s, w, h, v => v < 128);
    for (let i = 0; i < out.length; i++) out[i] = Math.min(s[i], Math.round(clamp(d[i] - r, 0, 1) * 255));
  } else if (kind === 'smooth') {
    const b = featherMask(s, r);
    for (let i = 0; i < out.length; i++) out[i] = clamp(Math.round((b[i] - 128) * 3 + 128), 0, 255);
  } else if (kind === 'border') {
    const di = distTransform(s, w, h, v => v < 128), dout = distTransform(s, w, h, v => v >= 128), hw = r / 2;
    for (let i = 0; i < out.length; i++) { const d = s[i] >= 128 ? di[i] - 0.5 : dout[i] - 0.5; out[i] = Math.round(clamp(hw + 0.5 - Math.abs(d), 0, 1) * 255); }
  }
  setSelection(out, { expand: 'Expand Selection', contract: 'Contract Selection', smooth: 'Smooth Selection', border: 'Border Selection' }[kind]);
}
function dlgSelModify(kind) {
  if (!doc.sel) { Aero.toast('No selection'); return; }
  const t = { expand: 'Expand Selection', contract: 'Contract Selection', smooth: 'Smooth Selection', border: 'Border Selection' }[kind];
  Aero.dialog({ title: t, fields: [{ key: 'r', label: kind === 'border' ? 'Width' : 'By', type: 'range', min: 1, max: 100, value: kind === 'smooth' ? 4 : 8, fmt: v => v + ' px' }], onOK: v => selModify(kind, +v.r) });
}
