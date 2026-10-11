'use strict';
/* Files: .lpaint (zip: doc.json + per-layer lossless PNGs + thumbnail + optional time-lapse), PSD in/out
   with layers & groups (ag-psd), image import, PNG/JPEG/WebP export. Opened files are untrusted data:
   everything is validated, sizes are capped, nothing in a file is ever executed. */
const MAX_DIM = 16384, MAX_PIXELS = 80e6, MAX_LAYERS = 300;
const PSD_BLEND = { 'normal': 'normal', 'multiply': 'multiply', 'screen': 'screen', 'overlay': 'overlay', 'darken': 'darken', 'lighten': 'lighten', 'color dodge': 'color-dodge', 'color burn': 'color-burn', 'hard light': 'hard-light', 'soft light': 'soft-light', 'difference': 'difference', 'exclusion': 'exclusion', 'linear dodge': 'add', 'hue': 'hue', 'saturation': 'saturation', 'color': 'color', 'luminosity': 'luminosity' };
const TO_PSD_BLEND = Object.fromEntries(Object.entries(PSD_BLEND).map(([k, v]) => [v, k]));
const ext = n => (String(n).match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();

/* ---------- .lpaint ---------- */
async function buildLpaint() {
  dryAllWet(); if (floating) commitTransform();
  const files = {};
  const enc = new TextEncoder();
  const ser = list => list.map(L => {
    const o = { id: L.id, type: L.type, name: L.name, visible: L.visible, opacity: L.opacity, blend: L.blend, lockAlpha: L.lockAlpha, clip: L.clip };
    if (L.type === 'fill') o.color = L.color.slice();
    if (L.type === 'group') { o.open = L.open; o.children = ser(L.children); }
    if (L.type === 'pixel') o.file = 'layers/' + L.id + '.png';
    return o;
  });
  const meta = { format: 'lumen-paint', version: 1, app: 'Lumen Paint', width: doc.w, height: doc.h, paper: doc.paper, paperScale: doc.paperScale, active: doc.active?.id, guides: JSON.parse(JSON.stringify(guides)), layers: ser(doc.root), created: doc.created || new Date().toISOString(), saved: new Date().toISOString() };
  const jobs = pixelLayers().map(async L => { const png = await pngEncodeAsync(doc.w, doc.h, layerRGBA(L), 4); files['layers/' + L.id + '.png'] = [png, { level: 0 }]; });
  await Promise.all(jobs);
  // thumbnail
  if (doc.ver !== composedVer) { R.compose(); composedVer = doc.ver; }
  const s = Math.min(1, 512 / Math.max(doc.w, doc.h)), tw = Math.max(1, Math.round(doc.w * s)), th = Math.max(1, Math.round(doc.h * s));
  files['thumbnail.png'] = [pngEncode(tw, th, R.readScaled(tw, th, true)), { level: 0 }];
  const tl = await tlSerialize(); if (tl) { meta.timelapse = tl.meta; files['timelapse/chunks.bin'] = [tl.bin, { level: 0 }]; }
  files['doc.json'] = enc.encode(JSON.stringify(meta, null, 1));
  return fflate.zipSync(files);
}
async function loadLpaint(buf, name, path) {
  let files;
  try { files = fflate.unzipSync(new Uint8Array(buf), { filter: f => f.originalSize < 1.2e9 && /^(doc\.json|thumbnail\.png|layers\/[\w-]+\.png|timelapse\/chunks\.bin)$/.test(f.name) }); }
  catch (e) { throw new Error('Not a valid .lpaint file (zip could not be read)'); }
  if (!files['doc.json']) throw new Error('Not a Lumen Paint document (doc.json missing)');
  let meta; try { meta = JSON.parse(new TextDecoder().decode(files['doc.json'])); } catch (e) { throw new Error('doc.json is not valid JSON'); }
  if (meta.format !== 'lumen-paint') throw new Error('Unknown document format');
  const w = meta.width | 0, h = meta.height | 0;
  if (!(w > 0 && h > 0 && w <= MAX_DIM && h <= MAX_DIM && w * h <= MAX_PIXELS)) throw new Error(`Unsupported canvas size ${w}×${h}`);
  const d = newDoc(w, h, Aero.baseName(name)); d.path = path || null;
  d.paper = PAPERS.some(p => p[0] === meta.paper) ? meta.paper : 'cold'; d.paperScale = clamp(+meta.paperScale || 1, 0.25, 8);
  installDoc(d, true);
  // decode all layer PNGs in parallel first
  const decoded = new Map();
  await Promise.all(Object.keys(files).filter(k => /^layers\/[\w-]+\.png$/.test(k)).map(async k => decoded.set(k, await pngDecodeAsync(files[k]))));
  let count = 0;
  const build = (arr, depth) => {
    if (!Array.isArray(arr) || depth > 12) return [];
    const out = [];
    for (const o of arr) {
      if (!o || typeof o !== 'object' || ++count > MAX_LAYERS) continue;
      const type = ['pixel', 'fill', 'group'].includes(o.type) ? o.type : null; if (!type) continue;
      const L = new Layer(type, String(o.name ?? 'Layer').slice(0, 120), w, h);
      if (typeof o.id === 'string' && /^[\w-]{1,40}$/.test(o.id)) L.id = o.id;
      L.visible = o.visible !== false; L.opacity = clamp(+o.opacity, 0, 1); if (!Number.isFinite(L.opacity)) L.opacity = 1;
      L.blend = BLEND_IDX[o.blend] != null ? o.blend : 'normal'; L.lockAlpha = !!o.lockAlpha; L.clip = !!o.clip;
      if (type === 'fill' && Array.isArray(o.color)) L.color = [0, 1, 2].map(i => clamp(+o.color[i] || 0, 0, 1));
      if (type === 'group') { L.open = o.open !== false; L.children = build(o.children, depth + 1); }
      if (type === 'pixel') {
        const img = decoded.get('layers/' + L.id + '.png');
        if (img && img.w === w && img.h === h) writeRegion(L, 0, 0, w, h, img.data);
      }
      out.push(L);
    }
    if (out.length && out[0].clip) out[0].clip = false;
    return out;
  };
  doc.root = build(meta.layers, 0);
  if (!doc.root.length) doc.root.push(new Layer('pixel', 'Layer 1', w, h));
  doc.active = (meta.active && findLayer(meta.active)) || pixelLayers().pop() || doc.root[0];
  if (meta.guides && typeof meta.guides === 'object') loadGuides(meta.guides);
  await tlLoad(meta.timelapse, files['timelapse/chunks.bin']);
  finishDocLoad('Open');
}
function loadGuides(g) {
  const num = v => Number.isFinite(+v) ? +v : 0, pt = p => Array.isArray(p) ? [num(p[0]), num(p[1])] : [0, 0];
  if (['off', 'v', 'h', 'quad', 'radial', 'kaleido'].includes(g.sym)) guides.sym = g.sym;
  guides.n = clamp(num(g.n) | 0, 2, 32); guides.cx = num(g.cx); guides.cy = num(g.cy);
  if (['off', '1', '2'].includes(g.persp)) guides.persp = g.persp; guides.hy = num(g.hy);
  if (Array.isArray(g.vp)) guides.vp = [pt(g.vp[0]), pt(g.vp[1])];
  if (g.ruler) guides.ruler = { on: !!g.ruler.on, a: pt(g.ruler.a), b: pt(g.ruler.b) };
  guides.snapPersp = !!g.snapPersp;
}

/* ---------- PSD ---------- */
function exportPSD() {
  dryAllWet(); if (floating) commitTransform();
  const toImg = (data, w, h) => ({ width: w, height: h, data });
  const ser = list => list.map(L => {
    const base = { name: L.name, opacity: L.opacity, blendMode: TO_PSD_BLEND[L.blend] || 'normal', hidden: !L.visible, clipping: L.clip };
    if (L.type === 'group') return { ...base, opened: L.open, children: ser(L.children) };
    if (L.type === 'fill') { const d = new Uint8ClampedArray(doc.w * doc.h * 4); const c = L.color.map(v => v * 255); for (let i = 0; i < d.length; i += 4) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255; } return { ...base, left: 0, top: 0, imageData: toImg(d, doc.w, doc.h) }; }
    const b = layerBounds(L);
    if (!b) return { ...base, transparencyProtected: L.lockAlpha, left: 0, top: 0, imageData: toImg(new Uint8ClampedArray(4), 1, 1) };
    return { ...base, transparencyProtected: L.lockAlpha, left: b.x, top: b.y, imageData: toImg(readRegion(L, b.x, b.y, b.w, b.h), b.w, b.h) };
  });
  if (doc.ver !== composedVer) { R.compose(); composedVer = doc.ver; }
  const comp = R.readComposite();
  return new Uint8Array(agPsd.writePsd({ width: doc.w, height: doc.h, children: ser(doc.root), imageData: toImg(comp, doc.w, doc.h) }, { generateThumbnail: false }));
}
async function loadPSD(buf, name, asImport) {
  if (!window.agPsd) throw new Error('PSD support not loaded');
  { // validate the header before handing an untrusted file to the parser
    const u = new Uint8Array(buf, 0, Math.min(26, buf.byteLength)), dv = new DataView(u.buffer, u.byteOffset, u.length);
    if (u.length < 26 || String.fromCharCode(u[0], u[1], u[2], u[3]) !== '8BPS') throw new Error('Not a Photoshop file');
    const hh = dv.getUint32(14), ww = dv.getUint32(18);
    if (!(ww > 0 && hh > 0 && ww <= MAX_DIM && hh <= MAX_DIM && ww * hh <= MAX_PIXELS)) throw new Error(`Unsupported PSD size ${ww}×${hh}`);
  }
  Aero.busy('Reading PSD…'); await sleep(20);
  let psd;
  try { psd = agPsd.readPsd(buf, { useImageData: true, skipThumbnail: true, skipLinkedFilesData: true }); } finally { Aero.busy(); }
  const w = psd.width, h = psd.height;
  if (!(w > 0 && h > 0 && w <= MAX_DIM && h <= MAX_DIM && w * h <= MAX_PIXELS)) throw new Error(`Unsupported PSD size ${w}×${h}`);
  let skipped = 0, count = 0;
  const conv = (arr, depth) => {
    const out = [];
    for (const ch of arr || []) {
      if (++count > MAX_LAYERS || depth > 12) break;
      if (ch.children) { const G = new Layer('group', ch.name || 'Group', doc.w, doc.h); G.children = conv(ch.children, depth + 1); G.visible = !ch.hidden; G.opacity = ch.opacity ?? 1; G.blend = PSD_BLEND[ch.blendMode] || 'normal'; G.open = ch.opened !== false; out.push(G); continue; }
      const im = ch.imageData; if (!im || !im.width) { skipped++; continue; }
      const L = new Layer('pixel', ch.name || 'Layer', doc.w, doc.h);
      writeRegion(L, ch.left || 0, ch.top || 0, im.width, im.height, im.data instanceof Uint8ClampedArray ? im.data : new Uint8ClampedArray(im.data));
      L.visible = !ch.hidden; L.opacity = clamp(ch.opacity ?? 1, 0, 1); L.blend = PSD_BLEND[ch.blendMode] || 'normal'; L.clip = !!ch.clipping; L.lockAlpha = !!ch.transparencyProtected;
      out.push(L);
    }
    if (out[0]?.clip) out[0].clip = false;
    return out;
  };
  if (asImport) {
    const G = new Layer('group', Aero.baseName(name), doc.w, doc.h); G.children = conv(psd.children, 0);
    if (!G.children.length && psd.imageData) { const L = new Layer('pixel', Aero.baseName(name), doc.w, doc.h); writeRegion(L, 0, 0, psd.imageData.width, psd.imageData.height, psd.imageData.data); G.children.push(L); }
    insertLayer(G); doc.active = G.children[G.children.length - 1] || G; doc.ver++; histPush('Import PSD');
  } else {
    installDoc(newDoc(w, h, Aero.baseName(name)), true);
    doc.root = conv(psd.children, 0);
    if (!doc.root.length && psd.imageData) { const L = new Layer('pixel', 'Background', w, h); writeRegion(L, 0, 0, w, h, psd.imageData.data); doc.root.push(L); }
    if (!doc.root.length) doc.root.push(new Layer('pixel', 'Layer 1', w, h));
    doc.active = pixelLayers().pop() || doc.root[0];
    finishDocLoad('Open PSD');
  }
  if (skipped) Aero.toast(`${skipped} adjustment/text layer${skipped > 1 ? 's' : ''} without pixels skipped`);
}

/* ---------- images ---------- */
async function importImageLayer(buf, name, mime) {
  const img = await decodeImage(buf, mime);
  let { w, h, data } = img;
  if (!w || !h) throw new Error('Image has no pixels');
  if (w > doc.w || h > doc.h) { // scale down to fit the canvas
    const s = Math.min(doc.w / w, doc.h / h), nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s));
    const c = new OffscreenCanvas(nw, nh), x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(rgbaToCanvas(w, h, data), 0, 0, nw, nh);
    data = x.getImageData(0, 0, nw, nh).data; w = nw; h = nh;
  }
  dryAllWet(); if (floating) commitTransform();
  const L = addPixelLayer(Aero.baseName(name).slice(0, 60) || 'Image');
  writeRegion(L, Math.round((doc.w - w) / 2), Math.round((doc.h - h) / 2), w, h, data);
  histPush('Import Image'); layerThumbDirty(L);
  return L;
}
async function openImageAsDoc(buf, name, mime) {
  const img = await decodeImage(buf, mime);
  if (!(img.w <= MAX_DIM && img.h <= MAX_DIM && img.w * img.h <= MAX_PIXELS)) throw new Error('Image too large');
  installDoc(newDoc(img.w, img.h, Aero.baseName(name)), true);
  const L = new Layer('pixel', 'Background', img.w, img.h); writeRegion(L, 0, 0, img.w, img.h, img.data);
  doc.root = [L]; doc.active = L; finishDocLoad('Open Image');
}

/* ---------- export ---------- */
async function exportImage(fmt, quality = 0.92, scale = 1) {
  dryAllWet(); if (floating) commitTransform();
  if (doc.ver !== composedVer) { R.compose(); composedVer = doc.ver; }
  const w = Math.max(1, Math.round(doc.w * scale)), h = Math.max(1, Math.round(doc.h * scale));
  if (fmt === 'png' && scale === 1) return new Blob([pngEncode(doc.w, doc.h, R.readComposite(), 6)], { type: 'image/png' });
  const src = rgbaToCanvas(doc.w, doc.h, R.readComposite());
  const c = new OffscreenCanvas(w, h), x = c.getContext('2d');
  if (fmt === 'jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); }
  x.imageSmoothingQuality = 'high'; x.drawImage(src, 0, 0, w, h);
  return c.convertToBlob({ type: 'image/' + fmt, quality });
}
