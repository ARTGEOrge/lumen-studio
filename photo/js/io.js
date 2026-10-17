'use strict';
/* File I/O: images, .lumen projects, PSD (ag-psd), camera RAW (LibRaw/WASM), export. */
const nativeApi = window.desktop || null;   // provided by Electron preload
const RAW_EXT = /\.(cr2|cr3|crw|nef|nrw|arw|srf|sr2|dng|raf|orf|rw2|rwl|pef|srw|3fr|erf|kdc|dcr|mrw|x3f|iiq|mos|raw)$/i;
const OPEN_FILTERS = [
  { name: 'All supported', extensions: ['lumen', 'psd', 'psb', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif', 'ico', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'raf', 'orf', 'rw2', 'rwl', 'pef', 'srw', '3fr', 'erf', 'kdc', 'dcr', 'mrw', 'x3f', 'iiq', 'mos', 'raw'] },
  { name: 'Lumen project', extensions: ['lumen'] }, { name: 'Photoshop', extensions: ['psd', 'psb'] },
  { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif'] },
  { name: 'Camera RAW', extensions: ['cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw'] }, { name: 'All files', extensions: ['*'] }];
const baseName = n => n.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); }
let busyEl = null;
function busy(msg) { if (!msg) { busyEl?.remove(); busyEl = null; return; } if (!busyEl) { busyEl = document.createElement('div'); busyEl.className = 'modal busy'; document.body.appendChild(busyEl); } busyEl.innerHTML = `<div class="box"><div class="spin"></div>${msg}</div>`; }

/* ---------- open ---------- */
let openMode = 'open';
async function openFile(mode = 'open') {
  openMode = mode;
  if (nativeApi) { const f = await nativeApi.openFile(OPEN_FILTERS); if (f) handleBuffer(f.name, f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength), mode, f.path); return; }
  $('#filein').click();
}
const placeFile = () => openFile('place');
$('#filein').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (f) handleBuffer(f.name, await f.arrayBuffer(), openMode, null); });
async function handleFile(f, mode) { handleBuffer(f.name, await f.arrayBuffer(), mode, nativeApi?.pathForFile?.(f) || null); }
async function handleBuffer(name, buf, mode, path) {
  const place = mode === 'place' && doc;
  try {
    if (/\.lumen$/i.test(name)) return await loadProject(new TextDecoder().decode(buf), baseName(name), path);
    if (/\.(psd|psb)$/i.test(name)) return await loadPSD(buf, baseName(name), place);
    if (RAW_EXT.test(name)) return await loadRAW(buf, baseName(name), place);
    const img = await loadImg(URL.createObjectURL(new Blob([buf])));
    if (place) { const c = mk(img.naturalWidth || img.width, img.naturalHeight || img.height); cx(c).drawImage(img, 0, 0); placeCanvas(c, baseName(name)); }
    else startFromImage(img, baseName(name));
  } catch (err) { busy(); console.error(err); toast('Could not open ' + name + (err?.message ? ': ' + err.message : '')); }
}

/* ---------- .lumen projects ---------- */
function projectJSON() {
  const withHist = saveHistoryPref && !!hist.cur;  // with history, pixels live in the history blobs
  const j = {
    app: 'lumen', version: 4, w: doc.w, h: doc.h, active: doc.active, guides: doc.guides || [],
    layers: doc.layers.map(L => ({
      id: L.id, parent: L.parent || 0, name: L.name, type: L.type, x: L.x, y: L.y, visible: L.visible, opacity: L.opacity, blend: L.blend,
      data: !withHist && L.canvas && L.type !== 'text' ? L.canvas.toDataURL('image/png') : null,
      mask: !withHist && L.mask ? L.mask.canvas.toDataURL('image/png') : null, maskEnabled: L.mask?.enabled ?? true,
      text: L.text, adjust: L.adjust, style: L.style || null, collapsed: !!L.collapsed
    }))
  };
  if (withHist) {
    const h = serializeHistory(); j.history = h.history; j.blobs = h.blobs;
    if (h.history.dropped) toast(`Oldest ${h.history.dropped} history states not saved (file size limit)`);
  }
  return j;
}
async function loadProject(text, name, path) {
  const j = JSON.parse(text);
  const toCanvas = async (url, w, h) => { const img = await loadImg(url), c = mk(w || img.width, h || img.height); cx(c).drawImage(img, 0, 0); return c; };
  if (j.history && j.blobs) {
    busy('Restoring project and its history…');
    const canv = {};
    await Promise.all(Object.entries(j.blobs).map(async ([r, url]) => { canv[r] = await toCanvas(url); }));
    startDoc(j.w, j.h, [{ name: 'Background', canvas: mk(j.w, j.h) }], 'Open Project', name, path);
    const cur = await deserializeHistory(j.history, canv);
    restoreNode(cur); busy();
    doc.guides = sanitizeGuides(j.guides);
    window.__lumenDirty = false; updateTitle(); fit(); checkFormulaTrust();
    toast(`Opened with ${hist.nodes.size} history states — you can still undo`);
    return;
  }
  const specs = await Promise.all(j.layers.map(async o => ({
    ...o, canvas: o.data ? await toCanvas(o.data, j.version < 2 ? j.w : 0, j.version < 2 ? j.h : 0) : (o.type === 'adjust' ? null : undefined),
    mask: o.mask ? await toCanvas(o.mask) : null
  })));
  specs.forEach(s => { if (s.type === 'group') s.canvas = null; else if (s.canvas === undefined && s.type !== 'text') s.canvas = mk(j.w, j.h); });
  specs.activeIndex = j.active; startDoc(j.w, j.h, specs, 'Open Project', name, path);
  doc.guides = sanitizeGuides(j.guides); checkFormulaTrust();
}
async function saveProject(as) {
  if (!doc) return false;
  const data = new TextEncoder().encode(JSON.stringify(projectJSON()));
  if (nativeApi) {
    const p = (!as && doc.filePath) || await nativeApi.saveDialog({ defaultPath: doc.name + '.lumen', filters: [{ name: 'Lumen Project', extensions: ['lumen'] }] });
    if (!p) return false;
    await nativeApi.writeFile(p, data); doc.filePath = p; doc.name = baseName(p);
  } else download(new Blob([data], { type: 'application/json' }), doc.name + '.lumen');
  window.__lumenDirty = false; updateTitle(); toast('Saved'); return true;
}
window.lumenSaveBeforeClose = async () => { try { return await saveProject(false); } catch (e) { return false; } };

/* ---------- PSD ---------- */
const PSD_BLEND = { 'normal': 'source-over', 'pass through': 'source-over', 'dissolve': 'source-over', 'multiply': 'multiply', 'screen': 'screen', 'overlay': 'overlay', 'darken': 'darken', 'lighten': 'lighten', 'color dodge': 'color-dodge', 'linear dodge': 'lighter', 'color burn': 'color-burn', 'hard light': 'hard-light', 'soft light': 'soft-light', 'difference': 'difference', 'exclusion': 'exclusion', 'hue': 'hue', 'saturation': 'saturation', 'color': 'color', 'luminosity': 'luminosity', 'linear burn': 'linear-burn', 'linear light': 'linear-light', 'vivid light': 'vivid-light', 'pin light': 'pin-light', 'hard mix': 'hard-mix', 'subtract': 'subtract', 'divide': 'divide' };
const TO_PSD_BLEND = Object.fromEntries(BLENDS.map(([v]) => [v, v === 'source-over' ? 'normal' : v === 'lighter' ? 'linear dodge' : v.replace('-', ' ')]));
// PSD masks may come as gray RGB or as alpha; normalize to opaque gray in the layer's bounds
function psdMaskCanvas(ch, mask) {
  const w = ch.canvas.width, h = ch.canvas.height, m = mk(w, h), c = cx(m), dc = mask.defaultColor ?? 255;
  c.fillStyle = rgbToHex(dc, dc, dc); c.fillRect(0, 0, w, h);
  const src = clone(mask.canvas), sc = cx(src), img = sc.getImageData(0, 0, src.width, src.height), d = img.data;
  for (let i = 0; i < d.length; i += 4) { const v = d[i + 3] === 255 ? d[i] : d[i + 3]; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  sc.putImageData(img, 0, 0);
  c.drawImage(src, (mask.left || 0) - (ch.left || 0), (mask.top || 0) - (ch.top || 0));
  return m;
}
async function loadPSD(buf, name, place) {
  if (!window.agPsd) throw new Error('PSD support not loaded');
  busy('Reading PSD…'); await new Promise(r => setTimeout(r, 30));
  const psd = agPsd.readPsd(buf, { skipThumbnail: true });
  const specs = []; let skipped = 0, gid = 0;
  const walk = (list, parent) => (list || []).forEach(ch => {
    if (ch.children) {   // group (folder): children first, then the group entry above them
      const id = 'g' + (++gid);
      walk(ch.children, id);
      const g = { id, parent, type: 'group', name: ch.name || 'Group', canvas: null, visible: !ch.hidden, opacity: ch.opacity ?? 1, blend: ch.blendMode === 'pass through' || !ch.blendMode ? 'pass-through' : (PSD_BLEND[ch.blendMode] || 'pass-through'), collapsed: ch.opened === false };
      if (ch.mask?.canvas && !ch.mask.disabled) { const m = mk(psd.width, psd.height), c = cx(m); c.fillStyle = '#fff'; c.fillRect(0, 0, m.width, m.height); c.drawImage(psdMaskCanvas({ canvas: ch.mask.canvas, left: ch.mask.left, top: ch.mask.top }, ch.mask), ch.mask.left || 0, ch.mask.top || 0); g.mask = m; }
      specs.push(g); return;
    }
    if (!ch.canvas || !ch.canvas.width) { if (ch.adjustment) skipped++; return; }
    const s = { parent, name: ch.name || 'Layer', canvas: ch.canvas, x: ch.left || 0, y: ch.top || 0, visible: !ch.hidden, opacity: ch.opacity ?? 1, blend: PSD_BLEND[ch.blendMode] || 'source-over' };
    if (ch.mask?.canvas && !ch.mask.disabled) s.mask = psdMaskCanvas(ch, ch.mask);
    try { const st = styleFromPsdEffects(ch.effects); if (st) s.style = st; } catch (e) { }
    specs.push(s);
  });
  walk(psd.children, null);
  if (!specs.length && psd.canvas) specs.push({ name: 'Background', canvas: psd.canvas });
  busy();
  if (place) { insertBlock(layersFromSpecs(specs)); pushHistory('Place PSD', 'all'); }
  else startDoc(psd.width, psd.height, specs, 'Open PSD', name);
  if (skipped) toast(`${skipped} Photoshop adjustment layer${skipped > 1 ? 's' : ''} skipped (not supported)`);
}
// PSD export keeps groups (folders); layer styles are baked into the layer pixels so every app shows them
function exportPSD() {
  composite();
  const toPsd = n => {
    const L = n.L;
    if (L.type === 'group') {
      const g = { name: L.name, opened: !L.collapsed, opacity: L.opacity, blendMode: L.blend === 'pass-through' ? 'pass through' : (TO_PSD_BLEND[L.blend] || 'normal'), hidden: !L.visible, children: n.kids.map(toPsd).filter(Boolean) };
      if (L.mask) g.mask = { left: L.x, top: L.y, canvas: L.mask.canvas, defaultColor: 255, disabled: !L.mask.enabled };
      return g;
    }
    if (!L.canvas) return null;
    if (L.style && styleHasEffects(L.style)) {
      const b = bakeStyled(L);
      return { name: L.name, left: b.x, top: b.y, canvas: b.canvas, opacity: L.opacity, blendMode: TO_PSD_BLEND[L.blend] || 'normal', hidden: !L.visible };
    }
    const o = { name: L.name, left: L.x, top: L.y, canvas: L.canvas, opacity: L.opacity, blendMode: TO_PSD_BLEND[L.blend] || 'normal', hidden: !L.visible };
    if (L.mask) o.mask = { left: L.x, top: L.y, canvas: L.mask.canvas, defaultColor: 255, disabled: !L.mask.enabled };
    return o;
  };
  const children = buildTree(doc.layers).map(toPsd).filter(Boolean);
  const skipped = doc.layers.filter(L => L.type === 'adjust').length;
  if (skipped) toast('Adjustment layers are baked into the PSD preview only');
  return new Uint8Array(agPsd.writePsd({ width: doc.w, height: doc.h, children, canvas: clone(comp) }));
}

/* ---------- camera RAW ---------- */
let LibRawMod = null;
async function loadRAW(buf, name, place) {
  const settings = await new Promise(res => showDialog({
    title: 'Develop RAW — ' + name, ok: 'Open', fields: [
      { key: 'wb', label: 'White balance', type: 'select', value: 'camera', options: [['camera', 'As shot (camera)'], ['auto', 'Auto'], ['daylight', 'Daylight (neutral)']] },
      { key: 'ev', label: 'Exposure (EV)', type: 'range', min: -2, max: 3, step: 0.1, value: 0, fmt: v => (v > 0 ? '+' : '') + v.toFixed(1) },
      { key: 'auto', label: 'Auto brighten', type: 'checkbox', value: true },
      { key: 'hl', label: 'Highlights', type: 'select', value: '0', options: [['0', 'Clip'], ['2', 'Blend'], ['5', 'Rebuild']] },
      { key: 'nr', label: 'Noise reduction', type: 'select', value: '0', options: [['0', 'Off'], ['100', 'Light'], ['300', 'Strong']] },
      { key: 'half', label: 'Half size (fast)', type: 'checkbox', value: false }],
    onOK: v => res(v), onCancel: () => res(null)
  }));
  if (!settings) return;
  busy('Developing RAW… this can take a few seconds');
  let canvas = null, note = '';
  try {
    if (!self.crossOriginIsolated) throw new Error('needs cross-origin isolation');
    LibRawMod = LibRawMod || (await import('../vendor/libraw/index.js')).default;
    const raw = new LibRawMod();
    await raw.open(new Uint8Array(buf), {
      useCameraWb: settings.wb === 'camera', useAutoWb: settings.wb === 'auto', outputBps: 8, outputColor: 1, userQual: 3,
      noAutoBright: !settings.auto, expCorrec: settings.ev !== 0, expShift: Math.pow(2, settings.ev), expPreser: 0.8,
      highlight: +settings.hl, threshold: +settings.nr, halfSize: settings.half
    });
    const im = await raw.imageData(); raw.dispose();
    if (!im) throw new Error('decoder returned no image');
    canvas = rawToCanvas(im);
  } catch (err) {
    console.warn('LibRaw failed, using embedded preview:', err);
    canvas = await embeddedPreview(buf); note = ' (embedded preview — full RAW decode unavailable: ' + err.message + ')';
  }
  busy();
  if (!canvas) throw new Error('unsupported RAW file');
  if (place) placeCanvas(canvas, name); else startDoc(canvas.width, canvas.height, [{ name: 'Background', canvas }], 'Open RAW', name);
  if (note) toast('Opened' + note);
}
function rawToCanvas(im) {
  const { width: w, height: h, colors = 3, bits = 8 } = im, src = im.data, img = new ImageData(w, h), d = img.data, n = w * h;
  const sh = bits === 16 ? 8 : 0;
  for (let i = 0; i < n; i++) {
    const j = i * 4, k = i * colors;
    if (colors >= 3) { d[j] = src[k] >> sh; d[j + 1] = src[k + 1] >> sh; d[j + 2] = src[k + 2] >> sh; }
    else d[j] = d[j + 1] = d[j + 2] = src[k] >> sh;
    d[j + 3] = 255;
  }
  const c = mk(w, h); cx(c).putImageData(img, 0, 0); return c;
}
// Fallback: largest JPEG embedded in the RAW container
async function embeddedPreview(buf) {
  const u = new Uint8Array(buf), starts = [];
  for (let i = 0; i < u.length - 3 && starts.length < 40; i++) if (u[i] === 0xFF && u[i + 1] === 0xD8 && u[i + 2] === 0xFF) starts.push(i);
  let best = null;
  for (const s of starts) {
    try { const bmp = await createImageBitmap(new Blob([u.subarray(s)], { type: 'image/jpeg' })); if (!best || bmp.width * bmp.height > best.width * best.height) best = bmp; } catch (e) { }
  }
  if (!best) return null;
  const c = mk(best.width, best.height); cx(c).drawImage(best, 0, 0); return c;
}

/* ---------- export ---------- */
function exportDialog() {
  showDialog({
    title: 'Export', ok: 'Export', fields: [
      { key: 'name', label: 'File name', type: 'text', value: doc.name },
      { key: 'fmt', label: 'Format', type: 'select', value: 'png', options: [['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP'], ['psd', 'Photoshop PSD (layers)']] },
      { key: 'q', label: 'Quality (JPEG/WebP)', type: 'range', min: 10, max: 100, value: 92, fmt: pct },
      { key: 's', label: 'Scale % (PNG/JPEG/WebP)', type: 'number', min: 1, max: 400, value: 100 }],
    onOK: async v => {
      const ext = v.fmt === 'jpeg' ? 'jpg' : v.fmt, fname = (v.name || 'image') + '.' + ext;
      const bytes = v.fmt === 'psd' ? exportPSD() : await exportBytes(v.fmt, v.q, v.s);
      if (v.fmt !== 'psd') recordStep({ type: 'export', fmt: v.fmt, q: v.q, s: v.s });
      if (await saveBytes(fname, ext, bytes)) toast('Exported ' + fname);
    }
  });
}
async function exportBytes(fmt, q = 92, s = 100) {
  composite(); const w = Math.max(1, Math.round(doc.w * s / 100)), h = Math.max(1, Math.round(doc.h * s / 100)), o = mk(w, h), c = cx(o);
  if (fmt === 'jpeg') { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); }
  c.imageSmoothingQuality = 'high'; c.drawImage(comp, 0, 0, w, h);
  const blob = await new Promise(r => o.toBlob(r, 'image/' + fmt, q / 100));
  return new Uint8Array(await blob.arrayBuffer());
}
let lastSaved = null;   // {name, bytes} — last file handed to the user (used by tests)
async function saveBytes(fname, ext, bytes) {
  lastSaved = { name: fname, bytes };
  if (window.__lumenNoDownload) return true;
  if (nativeApi) {
    const p = await nativeApi.saveDialog({ defaultPath: fname, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!p) return false; await nativeApi.writeFile(p, bytes);
  } else download(new Blob([bytes]), fname);
  return true;
}
function newDialog() {
  showDialog({
    title: 'New Document', ok: 'Create', fields: [
      { key: 'p', label: 'Preset', type: 'select', value: 'custom', options: [['custom', 'Custom (below)'], ['1920x1080', 'HD 1920×1080'], ['3840x2160', '4K 3840×2160'], ['1080x1080', 'Square post 1080×1080'], ['1080x1920', 'Story 1080×1920'], ['2480x3508', 'A4 @300dpi'], ['800x600', '800×600']] },
      { key: 'w', label: 'Width (px)', type: 'number', min: 1, value: doc?.w || 1600 },
      { key: 'h', label: 'Height (px)', type: 'number', min: 1, value: doc?.h || 1000 },
      { key: 'bg', label: 'Background', type: 'select', value: 'white', options: [['white', 'White'], ['transparent', 'Transparent'], ['bgc', 'Background color'], ['black', 'Black']] }],
    onOK: v => {
      let w = v.w, h = v.h; if (v.p !== 'custom') [w, h] = v.p.split('x').map(Number);
      newDocument(clamp(Math.round(w), 1, 20000), clamp(Math.round(h), 1, 20000), { white: '#fff', black: '#000', bgc: bg, transparent: null }[v.bg]);
    }
  });
}
// Desktop: open files passed on the command line / via "Open with"
async function openPath(p) { try { const f = await nativeApi.readFile(p); handleBuffer(f.name, f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength), 'open', f.path); } catch (e) { toast('Could not open ' + p); } }
if (nativeApi) { nativeApi.onOpenFile(openPath); nativeApi.launchFile().then(p => { if (p) openPath(p); }); }
/* ---------- Export Multiple Sizes: several sizes / formats in one go (one file, or a ZIP) ---------- */
const EXPORT_SET_PRESETS = {
  web: { name: 'Web @1x · @2x · @3x', rows: [['scale', 100, 'png', 92, '@1x'], ['scale', 200, 'png', 92, '@2x'], ['scale', 300, 'png', 92, '@3x']] },
  resp: { name: 'Responsive widths (JPEG)', rows: [['w', 480, 'jpeg', 82, '-480w'], ['w', 960, 'jpeg', 82, '-960w'], ['w', 1440, 'jpeg', 82, '-1440w'], ['w', 1920, 'jpeg', 85, '-1920w']] },
  thumbs: { name: 'Thumbnails (long edge)', rows: [['long', 150, 'jpeg', 85, '-thumb150'], ['long', 300, 'jpeg', 85, '-thumb300'], ['long', 600, 'jpeg', 85, '-thumb600']] },
  icons: { name: 'Icon sizes (PNG, long edge)', rows: [16, 32, 48, 64, 128, 256, 512].map(n => ['long', n, 'png', 92, '-' + n]) },
  modern: { name: 'Full size in every format', rows: [['scale', 100, 'png', 92, ''], ['scale', 100, 'jpeg', 90, ''], ['scale', 100, 'webp', 90, '']] }
};
let exportSetRows = EXPORT_SET_PRESETS.web.rows.map(r => r.slice());
try { const s = JSON.parse(localStorage.getItem('lumen.exportSet') || 'null'); if (Array.isArray(s)) exportSetRows = sanitizeExportRows(s); } catch (e) { }
function sanitizeExportRows(rows) {
  const out = (Array.isArray(rows) ? rows : []).slice(0, 24).filter(Array.isArray).map(r => [
    ['scale', 'w', 'h', 'long'].includes(r[0]) ? r[0] : 'scale', clamp(Math.round(+r[1]) || 100, 1, 20000),
    ['png', 'jpeg', 'webp'].includes(r[2]) ? r[2] : 'png', clamp(Math.round(+r[3]) || 92, 10, 100), String(r[4] ?? '').replace(/[\\/:*?"<>|]/g, '').slice(0, 40)]);
  return out.length ? out : EXPORT_SET_PRESETS.web.rows.map(r => r.slice());
}
// Output pixel size for a row; capped at 16384 px per side
function exportRowSize(r, w = doc.w, h = doc.h) {
  const [mode, n] = r, f = mode === 'scale' ? n / 100 : mode === 'w' ? n / w : mode === 'h' ? n / h : n / Math.max(w, h);
  const k = Math.min(f, 16384 / w, 16384 / h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}
// Encode the flattened image at an exact size; big reductions step down by halves for clean thumbnails
async function exportBytesAt(fmt, q, w, h) {
  composite(); let src = comp;
  while (src.width / 2 >= w && src.height / 2 >= h && src.width > 2) {
    const t = mk(Math.ceil(src.width / 2), Math.ceil(src.height / 2)), tc = cx(t); tc.imageSmoothingQuality = 'high'; tc.drawImage(src, 0, 0, t.width, t.height); src = t;
  }
  const o = mk(w, h), c = cx(o);
  if (fmt === 'jpeg') { c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); }
  c.imageSmoothingQuality = 'high'; c.drawImage(src, 0, 0, w, h);
  const blob = await new Promise(r => o.toBlob(r, 'image/' + fmt, q / 100));
  return new Uint8Array(await blob.arrayBuffer());
}
async function exportSetFiles(base, rows) {
  const out = [];
  for (const r of rows) {
    const { w, h } = exportRowSize(r), ext = r[2] === 'jpeg' ? 'jpg' : r[2];
    out.push({ name: `${base}${r[4]}.${ext}`, bytes: await exportBytesAt(r[2], r[3], w, h), w, h });
  }
  return out;
}
function exportSizesDialog() {
  let rows = exportSetRows.map(r => r.slice());
  const opt = (v, list) => list.map(([a, b]) => `<option value="${a}"${a === v ? ' selected' : ''}>${b}</option>`).join('');
  showDialog({
    title: 'Export Multiple Sizes', ok: 'Export All',
    fields: [{ key: 'name', label: 'Base file name', type: 'text', value: doc.name }],
    html: `<div class="row"><label>Preset</label><select id="xsp"><option value="">Choose a set…</option>${Object.entries(EXPORT_SET_PRESETS).map(([k, p]) => `<option value="${k}">${p.name}</option>`).join('')}</select><span></span></div>
      <table class="xstable"><thead><tr><th>Size by</th><th>Value</th><th>Format</th><th>Quality</th><th>Suffix</th><th>Result</th><th></th></tr></thead><tbody id="xsrows"></tbody></table>
      <div class="btnrow"><button class="b small" id="xsadd">＋ Add size</button></div>
      <p class="dnote">One size is saved as a single file; several are saved together as a ZIP. Your set is remembered for next time.</p>`,
    onMount: box => {
      const tb = box.querySelector('#xsrows');
      const render = () => {
        tb.innerHTML = rows.map((r, i) => `<tr data-i="${i}"><td><select data-k="0">${opt(r[0], [['scale', 'Scale %'], ['w', 'Width px'], ['h', 'Height px'], ['long', 'Long edge px']])}</select></td>
          <td><input type="number" data-k="1" min="1" max="20000" value="${r[1]}" style="width:64px"></td>
          <td><select data-k="2">${opt(r[2], [['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP']])}</select></td>
          <td><input type="number" data-k="3" min="10" max="100" value="${r[3]}" style="width:48px"${r[2] === 'png' ? ' disabled' : ''}></td>
          <td><input type="text" data-k="4" value="${Aesc(r[4])}" style="width:84px" spellcheck="false"></td>
          <td class="dim xsdim">${(s => s.w + '×' + s.h)(exportRowSize(r))}</td><td><button class="b small" data-del="${i}" title="Remove">✕</button></td></tr>`).join('');
      };
      tb.addEventListener('input', e => {
        const tr = e.target.closest('tr'), k = +e.target.dataset.k; if (!tr || Number.isNaN(k)) return;
        const r = rows[+tr.dataset.i]; r[k] = k === 1 || k === 3 ? +e.target.value : e.target.value;
        rows[+tr.dataset.i] = sanitizeExportRows([r])[0];
        tr.querySelector('.xsdim').textContent = (s => s.w + '×' + s.h)(exportRowSize(rows[+tr.dataset.i]));
        if (k === 2) render();
      });
      tb.addEventListener('click', e => { const d = e.target.dataset.del; if (d != null) { if (rows.length > 1) { rows.splice(+d, 1); render(); } else toast('Keep at least one size'); } });
      box.querySelector('#xsadd').onclick = () => { if (rows.length >= 24) return toast('Up to 24 sizes'); rows.push(rows[rows.length - 1].slice()); render(); };
      box.querySelector('#xsp').onchange = e => { const p = EXPORT_SET_PRESETS[e.target.value]; if (p) { rows = p.rows.map(r => r.slice()); render(); } e.target.value = ''; };
      render();
    },
    onOK: async v => {
      rows = sanitizeExportRows(rows); exportSetRows = rows;
      try { localStorage.setItem('lumen.exportSet', JSON.stringify(rows)); } catch (e) { }
      const base = String(v.name || doc.name || 'image').replace(/[\\/:*?"<>|]/g, '').slice(0, 120) || 'image';
      busy('Exporting ' + rows.length + ' file(s)…');
      let files; try { files = await exportSetFiles(base, rows); } finally { busy(); }
      const ok = files.length === 1 ? await saveBytes(files[0].name, files[0].name.split('.').pop(), files[0].bytes) : await saveBytes(base + ' (sizes).zip', 'zip', makeZip(files));
      if (ok) toast(`Exported ${files.length} file${files.length > 1 ? 's' : ''}`);
    }
  });
}
const Aesc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
