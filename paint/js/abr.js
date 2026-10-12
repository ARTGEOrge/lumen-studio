'use strict';
/* Image brush tips: Photoshop .abr import (v6–v10 through ag-psd's readAbr, v1/v2 parsed here), brush tip
   from the selection, and persistence of custom tips (localStorage + .lpbrush files).
   Custom tips are 128×128 alpha maps; the image is fitted inside the tip circle (the brush engine evaluates
   tips inside the unit circle), so brush sizes are scaled by √2 to keep the visible stamp at Photoshop's size. */
const customTips = {}; // id → {name, data: Float32Array(TIPN²)}
const TIP_FIT = TIPN / Math.SQRT2 - 2;
const tipName = id => 'img:' + id;
function customTipMap(name) { const t = customTips[name.slice(4)]; return t ? t.data : null; }
function customTipOptions() { return Object.entries(customTips).map(([id, t]) => [tipName(id), '★ ' + t.name]); }

// alpha image (Uint8 w×h, 255 = paint) → tip map fitted into the tip circle
function tipFromAlpha(alpha, w, h) {
  // crop to the painted bounds first
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (alpha[y * w + x] > 2) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return null;
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, img = new ImageData(cw, ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) img.data[(y * cw + x) * 4 + 3] = alpha[(y + y0) * w + x + x0];
  const src = new OffscreenCanvas(cw, ch); src.getContext('2d').putImageData(img, 0, 0);
  const s = TIP_FIT / Math.max(cw, ch), dw = cw * s, dh = ch * s;
  const c = new OffscreenCanvas(TIPN, TIPN), x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high';
  x.drawImage(src, (TIPN - dw) / 2, (TIPN - dh) / 2, dw, dh);
  const d = x.getImageData(0, 0, TIPN, TIPN).data, m = new Float32Array(TIPN * TIPN);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] / 255;
  return { data: m, aspect: cw / ch, srcSize: Math.max(cw, ch) };
}
function registerTip(name, data, id = 'tip' + uid()) { customTips[id] = { name: String(name).slice(0, 40), data }; delete tipMaps[tipName(id)]; return id; }
const tipToB64 = d => { const u = new Uint8Array(d.length); for (let i = 0; i < d.length; i++) u[i] = Math.round(d[i] * 255); let s = ''; for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return btoa(s); };
function tipFromB64(b) { try { const s = atob(String(b)); if (s.length !== TIPN * TIPN) return null; const m = new Float32Array(s.length); for (let i = 0; i < s.length; i++) m[i] = s.charCodeAt(i) / 255; return m; } catch (e) { return null; } }
function usedTipIds(list = BRUSHES) { const s = new Set(); for (const b of list) if (typeof b.tip === 'string' && b.tip.startsWith('img:')) s.add(b.tip.slice(4)); return s; }
function saveCustomTips() {
  const used = usedTipIds(BRUSHES.filter(b => b.custom)), out = {};
  for (const id of used) if (customTips[id]) out[id] = { name: customTips[id].name, b64: tipToB64(customTips[id].data) };
  try { localStorage.setItem('lumenpaint.tips', JSON.stringify(out)); } catch (e) { Aero.toast('Could not store all brush tips (browser storage full)'); }
}
function loadCustomTips() {
  try { const o = JSON.parse(localStorage.getItem('lumenpaint.tips') || '{}'); for (const [id, t] of Object.entries(o)) { if (!/^[\w-]{1,40}$/.test(id) || !t) continue; const d = tipFromB64(t.b64); if (d) registerTip(t.name || 'Tip', d, id); } } catch (e) { }
}
// tips embedded in a .lpbrush file (untrusted)
function importTips(tips) {
  const map = {}; if (!tips || typeof tips !== 'object') return map;
  for (const [id, t] of Object.entries(tips).slice(0, 400)) { if (!t || typeof t !== 'object') continue; const d = tipFromB64(t.b64); if (d) map[id] = registerTip(t.name || 'Tip', d); }
  return map; // old id → new id
}
function exportTips(list) { const out = {}; for (const id of usedTipIds(list)) if (customTips[id]) out[id] = { name: customTips[id].name, b64: tipToB64(customTips[id].data) }; return out; }

/* ---------- ABR ---------- */
const ABR_MAX_PX = 25e6;
function readAbrOld(buf) { // Photoshop ≤ 6 brushes (v1 / v2): sampled tips only
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength), u8 = buf;
  let o = 0; const ver = dv.getInt16(0), count = dv.getInt16(2); o = 4;
  if (ver !== 1 && ver !== 2) throw new Error('Unsupported ABR version ' + ver);
  const samples = [];
  for (let n = 0; n < count && o + 6 <= u8.length; n++) {
    const type = dv.getUint16(o), size = dv.getUint32(o + 2); o += 6; const end = o + size;
    if (end > u8.length) break;
    if (type === 2) {
      let p = o + 4; const spacing = dv.getUint16(p); p += 2; let name = '';
      if (ver === 2) { const len = dv.getUint32(p); p += 4; if (len > 1000) throw new Error('Bad brush name'); for (let i = 0; i < len; i++) { const c = dv.getUint16(p + i * 2); if (c) name += String.fromCharCode(c); } p += len * 2; }
      p += 1 + 8; // antialias + short bounds
      const top = dv.getInt32(p), left = dv.getInt32(p + 4), bottom = dv.getInt32(p + 8), right = dv.getInt32(p + 12); p += 16;
      const depth = dv.getUint16(p), comp = u8[p + 2]; p += 3;
      const w = right - left, h = bottom - top;
      if (w > 0 && h > 0 && w * h <= ABR_MAX_PX && depth === 8) {
        const a = new Uint8Array(w * h);
        if (!comp) a.set(u8.subarray(p, Math.min(end, p + w * h)));
        else { // PackBits rows
          let q = p + h * 2;
          for (let y = 0; y < h; y++) {
            const rowEnd = q + dv.getUint16(p + y * 2); let x = 0;
            while (q < rowEnd && q < end && x < w) {
              let k = u8[q++]; if (k > 127) k -= 256;
              if (k >= 0) { for (let i = 0; i <= k && x < w; i++) a[y * w + x++] = u8[q++]; }
              else if (k !== -128) { const v = u8[q++]; for (let i = 0; i < 1 - k && x < w; i++) a[y * w + x++] = v; }
            }
            q = rowEnd;
          }
        }
        samples.push({ id: 's' + n, name, alpha: a, bounds: { w, h }, spacing: spacing / 100 });
      }
    }
    o = end;
  }
  return { samples, brushes: [] };
}
function abrDynamics(b, nb) {
  const sd = b.shapeDynamics, ctl = d => d && d.control;
  if (sd) {
    if (ctl(sd.sizeDynamics) === 'pen pressure') { nb.pSize = 1; nb.minSize = clamp(sd.minimumDiameter ?? sd.sizeDynamics.minimum ?? 0, 0, 1); } else nb.pSize = 0;
    if (ctl(sd.sizeDynamics) === 'pen tilt') nb.tiltSize = 1.5;
    if (sd.sizeDynamics && sd.sizeDynamics.jitter > 0 && sd.sizeDynamics.jitter <= 1) nb.jSize = sd.sizeDynamics.jitter;
    const ad = sd.angleDynamics;
    if (ad) { if (ad.jitter > 0 && ad.jitter <= 1) nb.jAngle = ad.jitter; const c = ctl(ad); if (c === 'direction' || c === 'initial direction') nb.rotMode = 'direction'; else if (c === 'pen tilt') nb.rotMode = 'tilt'; }
  } else nb.pSize = 0;
  if (b.scatter && b.scatter.scatterDynamics) { const j = b.scatter.scatterDynamics.jitter; if (j > 0 && j <= 10) nb.scatter = Math.min(3, j / 2); }
  if (b.transfer) {
    const od = b.transfer.opacityDynamics, fd = b.transfer.flowDynamics;
    if (ctl(od) === 'pen pressure') nb.pOpacity = 1; if (od && od.jitter > 0 && od.jitter <= 1) nb.jOpacity = od.jitter;
    if (ctl(fd) === 'pen pressure') nb.pFlow = 1;
  }
  if (b.colorDynamics) { const c = b.colorDynamics; nb.jHue = clamp(c.hue || 0, 0, 1); nb.jSat = clamp(c.saturation || 0, 0, 1); nb.jVal = clamp(c.brightness || 0, 0, 1); nb.colorPerStroke = !c.perTip; }
  if (b.texture) { nb.grain = clamp(b.texture.depth ?? 0.5, 0, 1); nb.grainScale = clamp(b.texture.scale || 1, 0.25, 6); }
  const to = b.toolOptions;
  if (to) {
    nb.opacity = clamp((to.opacity ?? 100) / 100, 0.01, 1); nb.flow = clamp((to.flow ?? 100) / 100, 0.01, 1);
    if (to.smoothing) nb.smoothing = clamp((to.smoothingValue || 0) / 100 * 0.9, 0, 0.95);
    if (to.usePressureOverridesSize) nb.pSize = 1; if (to.usePressureOverridesOpacity) nb.pOpacity = 1;
    if (to.type === 'smudge brush') { nb.mode = 'smudge'; nb.strength = clamp((to.strength ?? 50) / 100, 0.05, 1); }
    else if (to.type === 'mixer brush') { nb.mode = 'oil'; nb.mix = clamp((to.mix ?? 50) / 100, 0, 1); }
  }
}
function importAbr(buf, fileName = 'brushes.abr') {
  const u8 = new Uint8Array(buf); if (u8.length < 4) throw new Error('File too short');
  const ver = (u8[0] << 8) | u8[1];
  let abr;
  if (ver === 1 || ver === 2) abr = readAbrOld(u8);
  else if (ver >= 6 && ver <= 10) { if (!window.agPsd?.readAbr) throw new Error('ABR reader not available'); abr = agPsd.readAbr(u8); }
  else throw new Error('Not a Photoshop brush file (version ' + ver + ')');
  const base = Aero.baseName(fileName).slice(0, 30), tipOf = new Map(), out = [];
  let skipped = 0;
  const sampleTip = s => {
    if (tipOf.has(s.id)) return tipOf.get(s.id);
    const w = s.bounds.w, h = s.bounds.h; if (!(w > 0 && h > 0 && w * h <= ABR_MAX_PX && s.alpha && s.alpha.length >= w * h)) return null;
    const t = tipFromAlpha(s.alpha, w, h); if (!t) return null;
    const r = { id: registerTip(s.name || base, t.data), size: t.srcSize }; tipOf.set(s.id, r); return r;
  };
  for (const b of (abr.brushes || []).slice(0, 400)) {
    const sh = b.shape || {}, nb = { id: 'custom-' + uid(), name: String(b.name || base).slice(0, 60), spacing: 0.25, hardness: 1, smoothing: 0.1 };
    if (sh.type === 'sampled') {
      const s = (abr.samples || []).find(x => x.id === sh.sampledData); const t = s && sampleTip(s); if (!t) { skipped++; continue; }
      nb.tip = tipName(t.id); nb.size = clamp(Math.round((sh.size || t.size) * Math.SQRT2), 1, 1000);
      nb.spacing = clamp((sh.spacingOn === false ? 0.25 : sh.spacing ?? 0.25) / Math.SQRT2, 0.01, 1);
    } else if (sh.type === 'computed') {
      nb.tip = 'round'; nb.size = clamp(Math.round(sh.size || 20), 1, 1000); nb.hardness = clamp(sh.hardness ?? 1, 0, 1); nb.spacing = clamp(sh.spacingOn === false ? 0.1 : sh.spacing ?? 0.25, 0.01, 1);
    } else { skipped++; continue; }
    nb.angle = clamp(Math.round(sh.angle || 0), -180, 180); nb.roundness = clamp(sh.roundness ?? 1, 0.05, 1);
    abrDynamics(b, nb);
    out.push(nb);
  }
  if (!out.length) for (const s of (abr.samples || []).slice(0, 400)) { // sample-only files (old ABRs)
    const t = sampleTip(s); if (!t) { skipped++; continue; }
    out.push({ id: 'custom-' + uid(), name: String(s.name || `${base} ${out.length + 1}`).slice(0, 60), tip: tipName(t.id), size: clamp(Math.round(t.size * Math.SQRT2), 1, 1000), spacing: clamp((s.spacing || 0.25) / Math.SQRT2, 0.01, 1), hardness: 1, pSize: 0.6, smoothing: 0.1 });
  }
  for (const nb of out) BRUSHES.push(sanitizeBrush(nb));
  saveCustomBrushes(); saveCustomTips();
  return { count: out.length, skipped };
}
async function cmdImportAbr(files) {
  if (!files) files = await Aero.openFile({ accept: '.abr', filters: [{ name: 'Photoshop brushes', extensions: ['abr'] }] });
  let n = 0, sk = 0;
  for (const f of files) { try { const r = importAbr(f.data, f.name); n += r.count; sk += r.skipped; } catch (e) { console.warn(e); Aero.alert('Brush import failed', `${f.name}: ${e.message || e}`); } }
  if (!n) { if (files.length) Aero.toast('No usable brushes found' + (sk ? ` (${sk} unsupported)` : '')); return; }
  brushCat = 'Custom'; renderBrushCats(); renderBrushList();
  Aero.toast(`Imported ${n} Photoshop brush${n === 1 ? '' : 'es'}` + (sk ? ` · ${sk} unsupported skipped` : ''));
}

/* ---------- tip from selection (darker = more paint, like Photoshop's Define Brush) ---------- */
function cmdTipFromSelection() {
  if (!doc.sel || !doc.selBox) { Aero.toast('Select an area of the canvas first (Lasso or Marquee)'); return; }
  const b = doc.selBox; if (b.w * b.h > ABR_MAX_PX) { Aero.toast('Selection too large'); return; }
  dryAllWet(); if (doc.ver !== composedVer) { R.compose(); composedVer = doc.ver; }
  const px = R.readComposite(b.x, b.y, b.w, b.h), a = new Uint8Array(b.w * b.h);
  for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
    const i = y * b.w + x, j = i * 4, al = px[j + 3] / 255, l = (0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]) / 255;
    a[i] = Math.round((1 - (l * al + 1 - al)) * doc.sel[(y + b.y) * doc.w + x + b.x]);
  }
  const t = tipFromAlpha(a, b.w, b.h); if (!t) { Aero.toast('The selection is empty or white — dark pixels become paint'); return; }
  const n = BRUSHES.filter(x => x.custom && /^Custom tip/.test(x.name)).length + 1, name = 'Custom tip ' + n;
  const id = registerTip(name, t.data);
  const nb = sanitizeBrush({ id: 'custom-' + uid(), name, tip: tipName(id), size: clamp(Math.round(t.srcSize * Math.SQRT2), 4, 600), spacing: 0.12, hardness: 1, pSize: 0.5, smoothing: 0.15 });
  BRUSHES.push(nb); saveCustomBrushes(); saveCustomTips();
  toolBrush.brush = nb.id; saveBrushState(); brushCat = 'Custom'; if (activeToolId !== 'brush') setTool('brush'); renderBrushCats(); renderBrushList(); renderCmd();
  Aero.toast('New brush “' + name + '” from the selection');
  openBrushEditor(nb);
}

/* ---------- brush panel buttons ---------- */
function initBrushButtons() {
  $('#bb-edit').onclick = () => openBrushEditor(currentBrush());
  $('#bb-dup').onclick = () => {
    const b = currentBrush(), nb = sanitizeBrush({ ...fullBrush(b), id: 'custom-' + uid(), name: b.name + ' copy' });
    BRUSHES.push(nb); saveCustomBrushes(); saveCustomTips(); const k = ['eraser', 'smudge'].includes(activeToolId) ? activeToolId : 'brush'; toolBrush[k] = nb.id; saveBrushState();
    brushCat = 'Custom'; renderBrushCats(); renderBrushList(); renderCmd(); Aero.toast('Duplicated as “' + nb.name + '”');
  };
  $('#bb-reset').onclick = () => {
    const b = currentBrush(); if (b.custom) { Aero.toast('Custom brushes have no factory settings'); return; }
    const f = BRUSH_FACTORY[b.id]; for (const k of Object.keys(BRUSH_DEF)) { if (k in f) b[k] = f[k]; else delete b[k]; }
    saveBrushState(); renderBrushList(); renderCmd(); Aero.toast('“' + b.name + '” reset to defaults');
  };
  $('#bb-del').onclick = async () => {
    const b = currentBrush(); if (!b.custom) { Aero.toast('Built-in brushes can’t be deleted (use Reset)'); return; }
    if (!(await Aero.confirm('Delete brush', `Delete the custom brush “${b.name}”?`, 'Delete'))) return;
    BRUSHES.splice(BRUSHES.indexOf(b), 1); saveCustomBrushes(); saveCustomTips();
    for (const k of Object.keys(toolBrush)) if (toolBrush[k] === b.id) toolBrush[k] = { brush: 'wc-round', eraser: 'eraser-soft', smudge: 'blender' }[k];
    saveBrushState(); if (!BRUSHES.some(x => x.cat === brushCat)) brushCat = 'Inking'; renderBrushCats(); renderBrushList(); renderCmd();
  };
}
/* cursor preview of image / textured tips (shows the actual stamp shape while hovering) */
const tipCursorCache = new Map();
function tipCursorCanvas(tip, col) {
  const key = tip + col; let c = tipCursorCache.get(key); if (c) return c;
  const m = tipMap(tip); if (!m) return null;
  c = new OffscreenCanvas(TIPN, TIPN); const x = c.getContext('2d'), img = x.createImageData(TIPN, TIPN), rgb = hexRgb(col);
  for (let i = 0; i < m.length; i++) { img.data[i * 4] = rgb[0] * 255; img.data[i * 4 + 1] = rgb[1] * 255; img.data[i * 4 + 2] = rgb[2] * 255; img.data[i * 4 + 3] = m[i] * 255; }
  x.putImageData(img, 0, 0); if (tipCursorCache.size > 40) tipCursorCache.clear(); tipCursorCache.set(key, c); return c;
}
