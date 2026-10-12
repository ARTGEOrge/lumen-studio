'use strict';
/* Lumen Paint — app bootstrap: menus, commands, document lifecycle, dialogs. */
const APP = 'Lumen Paint';

/* ---------- document lifecycle ---------- */
function installDoc(d) {
  if (activeStroke) { activeTool?.cancel?.(); }
  cancelTransientTools(); discardAllWet(); floating = null;
  if (textEdit) { textEdit = null; $('#textpanel').hidden = true; }
  if (typeof animStop === 'function' && doc) { animStop(); animRT.thumbs.clear(); }
  doc = d; doc.selBox = null; selPath = null; composedVer = -1;
  resetGuides();
  if (R) { R.ensureDoc(); R.gc(); R.bk = R.ak = null; }
}
function finishDocLoad(label) {
  freezeAll(); for (const L of allLayers()) L.dirty.clear();
  hist.reset(label, snapshot());
  Aero.setDoc(doc.name, false);
  $('#st-size').textContent = `${doc.w} × ${doc.h} px`;
  const animWas = !$('#animbar').hidden; renderAnimBar(); if (animWas !== !$('#animbar').hidden) resizeStage();
  fitView(true); renderLayers(); renderHistoryPanel(); renderCmd(); renderBrushList();
  doc.ver++; requestRender();
  if (TL.segs.length === 0) tlCapture(true);
}
function onDocResized() { if (R) R.ensureDoc(); composedVer = -1; $('#st-size').textContent = `${doc.w} × ${doc.h} px`; fitView(); renderLayers(); }
function afterChange() {
  renderHistoryPanel(); refreshLayersSoon(); tlCapture();
  if (animOn()) { renderAnimBar(); animThumbsSoon(); }
  $('#st-msg').textContent = hist.items[hist.index]?.label || 'Ready';
}
function newDocument(w, h, bg = 'white', paper = 'cold', name = 'Untitled') {
  installDoc(newDoc(w, h, name));
  doc.paper = paper; layerSeq = 1;
  if (bg !== 'transparent') {
    const B = new Layer('fill', 'Paper', w, h); B.color = bg === 'cream' ? [0.98, 0.965, 0.93] : bg === 'gray' ? [0.5, 0.5, 0.5] : [1, 1, 1];
    doc.root.push(B);
  }
  const L = new Layer('pixel', 'Layer 1', w, h); doc.root.push(L); doc.active = L;
  doc.created = new Date().toISOString();
  tlReset(); finishDocLoad('New Canvas');
}
const PRESETS = [['screen', 'Screen — 1920 × 1080', 1920, 1080], ['screen4k', 'Screen 4K — 3840 × 2160', 3840, 2160], ['large', 'Large — 3000 × 2000', 3000, 2000], ['a4p', 'A4 portrait @300 dpi — 2480 × 3508', 2480, 3508], ['a4l', 'A4 landscape @300 dpi — 3508 × 2480', 3508, 2480], ['letter', 'US Letter @300 dpi — 2550 × 3300', 2550, 3300], ['square', 'Square — 2048 × 2048', 2048, 2048], ['insta', 'Social portrait — 1080 × 1350', 1080, 1350], ['custom', 'Custom…', 0, 0]];
async function dlgNew() {
  if (!(await confirmDiscard())) return;
  Aero.dialog({
    title: 'New Canvas', instruction: 'Choose a canvas size and paper', ok: 'Create',
    fields: [{ key: 'preset', label: 'Preset', type: 'select', options: PRESETS.map(p => [p[0], p[1]]), value: 'large' },
      { key: 'w', label: 'Width (px)', type: 'number', value: 3000, min: 16, max: MAX_DIM }, { key: 'h', label: 'Height (px)', type: 'number', value: 2000, min: 16, max: MAX_DIM },
      { key: 'bg', label: 'Background', type: 'select', options: [['white', 'White paper'], ['cream', 'Warm cream paper'], ['gray', 'Mid gray'], ['transparent', 'Transparent']], value: 'white' },
      { key: 'paper', label: 'Paper texture', type: 'select', options: PAPERS, value: 'cold' }],
    onInput: (k, v, set) => { if (k === 'preset') { const p = PRESETS.find(x => x[0] === v.preset); if (p && p[2]) { set('w', p[2]); set('h', p[3]); } } else if (k === 'w' || k === 'h') set('preset', 'custom'); },
    onOK: v => {
      const w = clamp(v.w | 0, 16, MAX_DIM), h = clamp(v.h | 0, 16, MAX_DIM);
      if (w * h > MAX_PIXELS) { Aero.alert('Canvas too large', `Please keep the canvas under ${Math.round(MAX_PIXELS / 1e6)} megapixels.`); return; }
      newDocument(w, h, v.bg, v.paper);
    }
  });
}
async function confirmDiscard() {
  if (!Aero.dirty) return true;
  return Aero.confirm('Unsaved changes', `“${doc.name}” has unsaved changes. Discard them?`, 'Discard');
}

/* ---------- open / save ---------- */
async function openFiles(files, asImport) {
  for (const f of files) {
    const e = ext(f.name);
    try {
      if (e === 'abr') { await cmdImportAbr([f]); continue; }
      if (e === 'lpbrush') { importBrushFile(f); continue; }
      if (e === 'lpaint') { if (!(await confirmDiscard())) return; Aero.busy('Opening ' + f.name + '…'); await sleep(20); try { await loadLpaint(f.data, f.name, f.path); } finally { Aero.busy(); } Aero.toast('Opened ' + f.name); }
      else if (e === 'psd' || e === 'psb') { if (asImport === true) await loadPSD(f.data, f.name, true); else { if (!(await confirmDiscard())) return; await loadPSD(f.data, f.name, false); } }
      else {
        const mode = asImport || asImport === undefined ? 'layer' : doc ? await askImageMode(f.name) : 'doc';
        if (mode === 'layer') { await importImageLayer(f.data, f.name, f.type); Aero.toast('Imported ' + f.name + ' as a layer'); }
        else if (mode === 'doc') await openImageAsDoc(f.data, f.name, f.type);
      }
    } catch (err) { Aero.busy(); console.warn(err); Aero.alert('Could not open file', `${f.name}: ${err.message || err}`); }
  }
}
function askImageMode(name) { // 'layer' | 'doc' | null
  return new Promise(res => Aero.dialog({ title: 'Open image', instruction: `What should happen with “${name}”?`, fields: [{ key: 'm', label: 'Open as', type: 'select', options: [['layer', 'New layer in this canvas'], ['doc', 'New canvas (replace current)']], value: 'layer' }], onOK: async v => { if (v.m === 'doc') res((await confirmDiscard()) ? 'doc' : null); else res('layer'); }, onCancel: () => res(null) }));
}
async function cmdOpen() {
  const f = await Aero.openFile({ accept: '.lpaint,.psd,image/*', filters: [{ name: 'Lumen Paint & images', extensions: ['lpaint', 'psd', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] });
  if (f.length) await openFiles(f, false);
}
async function cmdImport() {
  const f = await Aero.openFile({ accept: '.psd,image/*', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'psd'] }], multiple: true });
  if (f.length) await openFiles(f, true);
}
async function cmdSave(as) {
  try {
    Aero.busy('Saving…'); await sleep(20);
    const data = await buildLpaint();
    Aero.busy();
    const name = (doc.name || 'Untitled').replace(/\.lpaint$/i, '') + '.lpaint';
    const p = await Aero.saveFile({ name, data, filters: [{ name: 'Lumen Paint', extensions: ['lpaint'] }], path: as ? null : doc.path });
    if (!p) return false;
    if (Aero.isDesktop) doc.path = p;
    doc.name = Aero.baseName(p); Aero.setDoc(doc.name, false);
    Aero.toast('Saved ' + Aero.baseName(p) + '.lpaint (' + (data.length / 1048576).toFixed(1) + ' MB)');
    return true;
  } catch (e) { Aero.busy(); console.warn(e); Aero.alert('Save failed', String(e.message || e)); return false; }
}
function dlgExport() {
  Aero.dialog({
    title: 'Export Image', ok: 'Export', fields: [
      { key: 'fmt', label: 'Format', type: 'select', options: [['png', 'PNG (lossless, transparency)'], ['jpeg', 'JPEG'], ['webp', 'WebP']], value: 'png' },
      { key: 'q', label: 'Quality', type: 'range', min: 50, max: 100, value: 92, fmt: v => v + '%' },
      { key: 's', label: 'Scale', type: 'select', options: [['0.25', '25%'], ['0.5', '50%'], ['1', '100%'], ['2', '200%']], value: '1' }],
    onOK: async v => {
      Aero.busy('Exporting…'); await sleep(20);
      try { const b = await exportImage(v.fmt, v.q / 100, +v.s); Aero.busy(); await Aero.saveFile({ name: `${doc.name}.${v.fmt === 'jpeg' ? 'jpg' : v.fmt}`, data: b, filters: [{ name: v.fmt.toUpperCase(), extensions: [v.fmt === 'jpeg' ? 'jpg' : v.fmt] }] }); }
      catch (e) { Aero.busy(); Aero.alert('Export failed', String(e.message || e)); }
    }
  });
}
async function cmdExportPSD() {
  Aero.busy('Writing PSD…'); await sleep(20);
  try { const d = exportPSD(); Aero.busy(); await Aero.saveFile({ name: doc.name + '.psd', data: d, filters: [{ name: 'Photoshop', extensions: ['psd'] }] }); }
  catch (e) { Aero.busy(); Aero.alert('PSD export failed', String(e.message || e)); }
}
function dlgTimelapse() {
  if (!TL.supported) { Aero.alert('Time-lapse', 'Video encoding (WebCodecs) is not available in this browser.'); return; }
  const n = tlFrameCount();
  Aero.dialog({
    title: 'Export Time-lapse', instruction: `${n} frames recorded`, ok: 'Export video',
    fields: [{ key: 'fps', label: 'Frame rate', type: 'select', options: [['15', '15 fps (slower)'], ['30', '30 fps'], ['60', '60 fps (faster)']], value: n > 600 ? '60' : '30' },
      { key: 'hold', label: 'Hold final image', type: 'range', min: 0, max: 6, step: 0.5, value: 2, fmt: v => v + ' s' },
      { key: 'fmt', label: 'Format', type: 'select', options: [['auto', 'MP4 (H.264) — falls back to WebM'], ['webm', 'WebM (VP9)']], value: 'auto' }],
    onOK: async v => {
      Aero.busy('Encoding time-lapse…');
      try { const r = await tlExport({ fps: +v.fps, hold: v.hold, fmt: v.fmt }); Aero.busy(); if (r) { await Aero.saveFile({ name: `${doc.name} time-lapse.${r.mp4 ? 'mp4' : 'webm'}`, data: r.data, filters: [{ name: r.mp4 ? 'MP4 video' : 'WebM video', extensions: [r.mp4 ? 'mp4' : 'webm'] }] }); Aero.toast(`Time-lapse exported: ${r.frames} frames, ${r.seconds.toFixed(1)} s`); } }
      catch (e) { Aero.busy(); console.warn(e); Aero.alert('Time-lapse export failed', String(e.message || e)); }
    }
  });
}

/* ---------- layer commands ---------- */
function prepEdit() { if (activeStroke) return false; dryAllWet(); if (floating) commitTransform(); return true; }
function cmdNewLayer() { if (!prepEdit()) return; const L = new Layer('pixel', null, doc.w, doc.h); insertLayer(L, doc.active); doc.ver++; histPush('New Layer'); }
function cmdNewGroup() { if (!prepEdit()) return; const G = new Layer('group', 'Group ' + (allLayers().filter(l => l.type === 'group').length + 1), doc.w, doc.h); insertLayer(G, doc.active); doc.ver++; histPush('New Group'); }
function cmdGroupActive() { if (!prepEdit() || !doc.active) return; const L = doc.active, list = parentList(L), i = list.indexOf(L); const G = new Layer('group', 'Group ' + (allLayers().filter(l => l.type === 'group').length + 1), doc.w, doc.h); list.splice(i, 1, G); G.children.push(L); L.clip = false; doc.active = L; doc.ver++; histPush('Group Layers'); }
function cmdUngroup() { if (!prepEdit()) return; const G = doc.active?.type === 'group' ? doc.active : parentOf(doc.active); if (!G) { Aero.toast('Select a group (or a layer inside one) to ungroup'); return; } const list = parentList(G), i = list.indexOf(G); list.splice(i, 1, ...G.children); doc.active = G.children[G.children.length - 1] || list[0]; doc.ver++; histPush('Ungroup'); }
function cmdNewFill() { if (!prepEdit()) return; const L = new Layer('fill', 'Fill', doc.w, doc.h); L.color = FG.slice(); insertLayer(L, doc.active); doc.ver++; histPush('New Fill Layer'); }
function cloneLayer(L) { const C = new Layer(L.type, L.name + ' copy', doc.w, doc.h); Object.assign(C, { visible: L.visible, opacity: L.opacity, blend: L.blend, lockAlpha: L.lockAlpha, clip: L.clip, color: L.color.slice(), open: L.open, maskOn: L.maskOn, maskLinked: L.maskLinked, text: L.text }); if (L.tiles) C.tiles = L.tiles.slice(); if (L.mask) { C.mask = newMask(C); C.mask.tiles = L.mask.tiles.slice(); } if (L.children) C.children = L.children.map(cloneLayer).map(x => (x.name = x.name.replace(/ copy$/, ''), x)); return C; }
function cmdDuplicate() { if (!prepEdit() || !doc.active) return; freezeAll(); const C = cloneLayer(doc.active); insertLayer(C, doc.active); doc.ver++; histPush('Duplicate Layer'); }
function cmdDeleteLayer() {
  if (!prepEdit() || !doc.active) return; const L = doc.active, list = parentList(L), i = list.indexOf(L);
  removeLayer(L); if (list[i] && list[i].clip && (i === 0)) list[i].clip = false;
  if (!pixelLayers().length && !allLayers().length) doc.root.push(new Layer('pixel', 'Layer 1', doc.w, doc.h));
  doc.active = list[Math.min(i, list.length - 1)] || parentOf(L) || allLayers().pop();
  doc.ver++; histPush('Delete Layer'); R.gc();
}
// composite a list of layers (with their own props) into straight RGBA via the GPU
function composeToRGBA(list) { const t = R.composeList(list, 0); const gl = R.gl; R.draw(R.p.copy, R.final, u => { R.bindTex(0, t.tex, u.uS); gl.uniform1i(u.uKind, 1); }); const out = R.readComposite(); composedVer = -1; return out; }
function cmdMergeDown() {
  if (!prepEdit()) return; const L = doc.active, list = parentList(L), i = list.indexOf(L);
  if (i <= 0) { Aero.toast('No layer below to merge into'); return; }
  const B = list[i - 1];
  if (B.type !== 'pixel') { Aero.toast('The layer below must be a pixel layer'); return; }
  freezeAll();
  const tmpB = cloneLayer(B); tmpB.opacity = 1; tmpB.blend = 'normal'; tmpB.visible = true; tmpB.clip = false;
  const tmpL = { ...L }; Object.setPrototypeOf(tmpL, Layer.prototype); tmpL.visible = true;
  R.ensureDoc(); const out = composeToRGBA([tmpB, L.visible ? L : tmpL]);
  writeRegion(B, 0, 0, doc.w, doc.h, out, false);
  for (let k = 0; k < B.tiles.length; k++) if (B.tiles[k] && tileEmpty(B.tiles[k])) { B.tiles[k] = null; B.owned.delete(k); }
  B.mask = null; B.text = null; removeLayer(L); doc.active = B; doc.editMask = false; doc.ver++; histPush('Merge Down'); R.gc(); layerThumbDirty(B);
}
function cmdMergeGroup() {
  if (!prepEdit()) return; const G = doc.active?.type === 'group' ? doc.active : null; if (!G) { Aero.toast('Select a group to merge'); return; }
  const out = composeToRGBA(G.children);
  const L = new Layer('pixel', G.name, doc.w, doc.h); writeRegion(L, 0, 0, doc.w, doc.h, out); Object.assign(L, { opacity: G.opacity, blend: G.blend === 'pass-through' ? 'normal' : G.blend, visible: G.visible, clip: G.clip, mask: G.mask, maskOn: G.maskOn, maskLinked: G.maskLinked }); if (L.mask) L.mask.owner = L;
  const list = parentList(G); list.splice(list.indexOf(G), 1, L); doc.active = L; doc.ver++; histPush('Merge Group'); R.gc();
}
function cmdFlatten() {
  if (!prepEdit()) return;
  const out = composeToRGBA(doc.root);
  const L = new Layer('pixel', 'Flattened', doc.w, doc.h); writeRegion(L, 0, 0, doc.w, doc.h, out);
  doc.root = [L]; doc.active = L; doc.ver++; histPush('Flatten Image'); R.gc();
}
function cmdClearLayer() {
  if (!prepEdit()) return; const L = paintTarget(); if (!L || L.type !== 'pixel') return;
  if (L.text) L.text = null;
  if (doc.sel) { const sel = doc.sel, W = doc.w, b = doc.selBox; if (!b) return; forPixels(L, [b.x, b.y, b.x + b.w, b.y + b.h], true, (t, o, x, y) => { t[o + 3] = t[o + 3] * (1 - sel[y * W + x] / 255); }); markDirty(L); }
  else { for (let i = 0; i < L.tiles.length; i++) if (L.tiles[i]) { L.tiles[i] = null; L.dirty.add(i); } markDirty(L); }
  histPush('Clear'); layerThumbDirty(L);
}
function cmdFillFG() {
  if (!prepEdit()) return; const L = requirePixelLayer(); if (!L) return;
  const m = new Uint8Array(doc.w * doc.h).fill(255); paintMask(L, m, paintColor(L, FG)); histPush('Fill'); layerThumbDirty(L);
}
function cmdFlipLayer(h) {
  if (!prepEdit()) return; const L = requirePixelLayer(); if (!L) return;
  const d = layerRGBA(L), w = doc.w, H = doc.h, o = new Uint8ClampedArray(d.length);
  for (let y = 0; y < H; y++) for (let x = 0; x < w; x++) { const s = (y * w + x) * 4, t = h ? (y * w + (w - 1 - x)) * 4 : ((H - 1 - y) * w + x) * 4; o[t] = d[s]; o[t + 1] = d[s + 1]; o[t + 2] = d[s + 2]; o[t + 3] = d[s + 3]; }
  writeRegion(L, 0, 0, w, H, o, false); if (!L.isMask) flipLinkedMask(L, h); histPush(h ? 'Flip Layer Horizontal' : 'Flip Layer Vertical'); layerThumbDirty(L);
}
function cmdMoveLayer(dir) {
  if (!prepEdit() || !doc.active) return; const L = doc.active, list = parentList(L), i = list.indexOf(L), j = i + dir;
  if (j < 0 || j >= list.length) return; list.splice(i, 1); list.splice(j, 0, L); if (list[0].clip) list[0].clip = false; doc.ver++; histPush(dir > 0 ? 'Move Layer Up' : 'Move Layer Down');
}
function cmdSelectAlpha() { if (doc.editMask && doc.active?.mask) return cmdMaskToSelection(); const L = doc.active; if (!L || L.type !== 'pixel') return; const d = layerRGBA(L), m = new Uint8Array(doc.w * doc.h); for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3]; setSelection(m, 'Select Layer Pixels'); }
function cmdFeather() {
  if (!doc.sel) { Aero.toast('No selection'); return; }
  Aero.dialog({ title: 'Feather Selection', fields: [{ key: 'r', label: 'Radius', type: 'range', min: 1, max: 100, value: 8, fmt: v => v + ' px' }], onOK: v => {
    const c = new OffscreenCanvas(doc.w, doc.h), x = c.getContext('2d', { willReadFrequently: true }), img = new ImageData(doc.w, doc.h);
    for (let i = 0; i < doc.sel.length; i++) img.data[i * 4 + 3] = doc.sel[i];
    const c2 = new OffscreenCanvas(doc.w, doc.h); c2.getContext('2d').putImageData(img, 0, 0);
    x.filter = `blur(${v.r}px)`; x.drawImage(c2, 0, 0); const d = x.getImageData(0, 0, doc.w, doc.h).data, m = new Uint8Array(doc.w * doc.h); for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3];
    setSelection(m, 'Feather');
  } });
}
/* ---------- canvas commands ---------- */
function transformDoc(nw, nh, mapFn, label, textFn = () => null) { // mapFn(L) → new tiles via RGBA; textFn(props) → new text props, or null to rasterize
  if (!prepEdit()) return;
  const datas = tileLayers().map(L => [L, mapFn(layerRGBA(L))]);
  for (const L of pixelLayers()) if (L.text) L.text = textFn(L.text);
  const sel = null;
  doc.w = nw; doc.h = nh; doc.tw = Math.ceil(nw / TS); doc.th = Math.ceil(nh / TS);
  for (const [L, d] of datas) { L.tiles = new Array(doc.tw * doc.th).fill(null); L.owned.clear(); writeRegion(L, 0, 0, nw, nh, d); }
  doc.sel = sel; doc.selV++; selectionChanged(); resetGuides();
  onDocResized(); doc.ver++; histPush(label);
}
function dlgCanvasSize() {
  Aero.dialog({ title: 'Canvas Size', instruction: 'Change the canvas size without scaling the artwork', fields: [{ key: 'w', label: 'Width', type: 'number', value: doc.w, min: 16, max: MAX_DIM }, { key: 'h', label: 'Height', type: 'number', value: doc.h, min: 16, max: MAX_DIM }, { key: 'a', label: 'Anchor', type: 'select', options: [['c', 'Center'], ['tl', 'Top left'], ['t', 'Top'], ['b', 'Bottom'], ['l', 'Left'], ['r', 'Right']], value: 'c' }],
    onOK: v => {
      const nw = clamp(v.w | 0, 16, MAX_DIM), nh = clamp(v.h | 0, 16, MAX_DIM); if (nw * nh > MAX_PIXELS) return Aero.alert('Too large', 'Canvas too large.');
      const ow = doc.w, oh = doc.h, ax = { c: 0.5, tl: 0, t: 0.5, b: 0.5, l: 0, r: 1 }[v.a], ay = { c: 0.5, tl: 0, t: 0, b: 1, l: 0.5, r: 0.5 }[v.a];
      const dx = Math.round((nw - ow) * ax), dy = Math.round((nh - oh) * ay);
      transformDoc(nw, nh, d => { const o = new Uint8ClampedArray(nw * nh * 4); for (let y = 0; y < oh; y++) { const ty = y + dy; if (ty < 0 || ty >= nh) continue; for (let x = 0; x < ow; x++) { const tx = x + dx; if (tx < 0 || tx >= nw) continue; const s = (y * ow + x) * 4, t = (ty * nw + tx) * 4; o[t] = d[s]; o[t + 1] = d[s + 1]; o[t + 2] = d[s + 2]; o[t + 3] = d[s + 3]; } } return o; }, 'Canvas Size', t => ({ ...t, x: t.x + dx, y: t.y + dy }));
    } });
}
function dlgResize() {
  Aero.dialog({ title: 'Resize Image', instruction: 'Scale the artwork', fields: [{ key: 'p', label: 'Scale', type: 'range', min: 10, max: 300, value: 100, fmt: v => v + '%' }],
    onInput: () => { },
    onOK: v => {
      const s = v.p / 100, nw = clamp(Math.round(doc.w * s), 16, MAX_DIM), nh = clamp(Math.round(doc.h * s), 16, MAX_DIM); if (nw * nh > MAX_PIXELS) return Aero.alert('Too large', 'Canvas too large.');
      const ow = doc.w, oh = doc.h;
      transformDoc(nw, nh, d => { const c = new OffscreenCanvas(nw, nh), x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(rgbaToCanvas(ow, oh, d), 0, 0, nw, nh); return x.getImageData(0, 0, nw, nh).data; }, 'Resize Image', t => ({ ...t, x: t.x * nw / ow, y: t.y * nh / oh, size: Math.max(1, t.size * nw / ow) }));
    } });
}
function cmdRotateCanvas(cw) {
  const ow = doc.w, oh = doc.h;
  transformDoc(oh, ow, d => { const o = new Uint8ClampedArray(d.length); for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) { const s = (y * ow + x) * 4, nx = cw ? oh - 1 - y : y, ny = cw ? x : ow - 1 - x, t = (ny * oh + nx) * 4; o[t] = d[s]; o[t + 1] = d[s + 1]; o[t + 2] = d[s + 2]; o[t + 3] = d[s + 3]; } return o; }, cw ? 'Rotate Canvas 90° CW' : 'Rotate Canvas 90° CCW');
}
function cmdFlipCanvas() { const w = doc.w, h = doc.h; transformDoc(w, h, d => { const o = new Uint8ClampedArray(d.length); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const s = (y * w + x) * 4, t = (y * w + w - 1 - x) * 4; o[t] = d[s]; o[t + 1] = d[s + 1]; o[t + 2] = d[s + 2]; o[t + 3] = d[s + 3]; } return o; }, 'Flip Canvas'); }
function dlgPaper() {
  Aero.dialog({ title: 'Paper Texture', instruction: 'Grain used by pencils, chalk, charcoal, crayon and watercolor granulation', fields: [{ key: 'p', label: 'Paper', type: 'select', options: PAPERS, value: doc.paper }, { key: 's', label: 'Grain scale', type: 'range', min: 0.5, max: 4, step: 0.1, value: doc.paperScale, fmt: v => v.toFixed(1) + '×' }],
    onOK: v => { doc.paper = v.p; doc.paperScale = v.s; Aero.setDirty(true); renderBrushList(); Aero.toast('Paper: ' + PAPERS.find(p => p[0] === v.p)[1]); } });
}

/* ---------- clipboard ---------- */
let clip = null;
function cmdCopy(cut) {
  const L = doc.active; if (!L || L.type !== 'pixel') return; dryWet(L);
  const b = doc.selBox || layerBounds(L); if (!b) { Aero.toast('Nothing to copy'); return; }
  const d = readRegion(L, b.x, b.y, b.w, b.h);
  if (doc.sel) for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) d[(y * b.w + x) * 4 + 3] *= doc.sel[(y + b.y) * doc.w + x + b.x] / 255;
  clip = { ...b, data: d };
  try { const blob = new Blob([pngEncode(b.w, b.h, d)], { type: 'image/png' }); navigator.clipboard?.write?.([new ClipboardItem({ 'image/png': blob })]).catch(() => { }); } catch (e) { }
  if (cut) cmdClearLayer(); else Aero.toast('Copied');
}
async function pasteMenu() {
  try { const items = await navigator.clipboard.read(); for (const it of items) { const t = it.types.find(x => x.startsWith('image/')); if (t) { const b = await it.getType(t); await importImageLayer(await b.arrayBuffer(), 'Pasted image', t); return; } } } catch (e) { }
  cmdPaste();
}
function cmdPaste() {
  if (!clip) { Aero.toast('Clipboard is empty (paste images from other apps with Ctrl+V)'); return; }
  if (!prepEdit()) return; const L = addPixelLayer('Pasted'); writeRegion(L, clip.x, clip.y, clip.w, clip.h, clip.data); histPush('Paste'); layerThumbDirty(L);
}
addEventListener('paste', async e => {
  if (e.target.matches?.('input,textarea')) return;
  const it = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (!it) { cmdPaste(); return; }
  e.preventDefault(); const f = it.getAsFile(); if (!f) return;
  try { await importImageLayer(await f.arrayBuffer(), 'Pasted image', f.type); } catch (err) { Aero.toast('Paste failed: ' + err.message); }
});

/* ---------- view: zen, reference ---------- */
let zen = false;
function toggleZen() {
  zen = !zen; document.body.classList.toggle('zen', zen); $('#zenpill').hidden = !zen;
  setTimeout(() => { resizeStage(); }, 30);
}
function toggleFullscreen() { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.().catch(() => Aero.toast('Full screen not available')); }
function initRefPanel() {
  const p = $('#refpanel'), cv = $('#refcv');
  const title = p.querySelector('.rp-title');
  title.onpointerdown = e => { if (e.target.closest('button')) return; const r = p.getBoundingClientRect(), sr = $('#stage').getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top; try { title.setPointerCapture(e.pointerId); } catch (_) { } title.onpointermove = ev => { p.style.left = clamp(ev.clientX - sr.left - ox, 0, sr.width - 60) + 'px'; p.style.top = clamp(ev.clientY - sr.top - oy, 0, sr.height - 30) + 'px'; }; };
  title.onpointerup = () => title.onpointermove = null;
  p.querySelector('.rp-x').onclick = () => { p.hidden = true; };
  $('#rp-open').onclick = cmdPlaceRef; $('#rp-fit').onclick = () => drawRef();
  cv.onpointerdown = e => { if (!refImg) return; const r = cv.getBoundingClientRect(), x = (e.clientX - r.left) * cv.width / r.width, y = (e.clientY - r.top) * cv.height / r.height; const d = cv.getContext('2d').getImageData(x | 0, y | 0, 1, 1).data; if (d[3] > 8) { setFG([d[0] / 255, d[1] / 255, d[2] / 255]); pushRecent(); } };
  p.addEventListener('dragover', e => e.preventDefault());
  p.addEventListener('drop', async e => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) await loadRef(await f.arrayBuffer(), f.type); });
  new ResizeObserver(() => drawRef()).observe(p.querySelector('.rp-body'));
}
let refImg = null;
async function loadRef(buf, mime) { try { const d = await decodeImage(buf, mime); refImg = rgbaToCanvas(d.w, d.h, d.data); $('#refpanel').hidden = false; $('#refpanel').classList.add('has'); drawRef(); } catch (e) { Aero.toast('Could not load reference image'); } }
function drawRef() {
  const cv = $('#refcv'), body = $('#refpanel .rp-body'); if (!refImg || !body) return;
  const bw = body.clientWidth, bh = body.clientHeight, s = Math.min(bw / refImg.width, bh / refImg.height);
  cv.width = Math.max(1, Math.round(refImg.width * s)); cv.height = Math.max(1, Math.round(refImg.height * s));
  const c = cv.getContext('2d', { willReadFrequently: true }); c.imageSmoothingQuality = 'high'; c.drawImage(refImg, 0, 0, cv.width, cv.height);
}
async function cmdPlaceRef() { const f = await Aero.openFile({ accept: 'image/*', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] }); if (f[0]) await loadRef(f[0].data, f[0].type); }
function toggleRef() { const p = $('#refpanel'); p.hidden = !p.hidden; if (!p.hidden) drawRef(); }

/* ---------- dialogs ---------- */
function dlgPrefs() {
  Aero.dialog({ title: 'Preferences', fields: [
    { key: 'g', label: prefs.pressureCurve ? 'Pressure (custom curve set)' : 'Pressure curve', type: 'range', min: 0.4, max: 2.5, step: 0.05, value: prefs.pressureGamma, fmt: v => v < 0.95 ? 'soft ' + v.toFixed(2) : v > 1.05 ? 'firm ' + v.toFixed(2) : 'linear' },
    { key: 'mt', label: 'Taper mouse strokes', type: 'checkbox', value: prefs.mouseTaper },
    { key: 'tilt', label: 'Use pen tilt', type: 'checkbox', value: prefs.tiltEnabled },
    { key: 'touch', label: 'Paint with finger (until a pen is used)', type: 'checkbox', value: prefs.touchPaint },
    { key: 'tl', label: 'Record time-lapse', type: 'checkbox', value: TL.on }],
    html: '<div class="dnote">Edit › Pressure Curve… draws a custom curve and calibrates it to your pen. Moving the slider here replaces a custom curve.</div>',
    onOK: v => { if (v.g !== prefs.pressureGamma) { prefs.pressureCurve = null; rebuildPressureLUT(); } prefs.pressureGamma = v.g; prefs.mouseTaper = v.mt; prefs.tiltEnabled = v.tilt; prefs.touchPaint = v.touch; TL.on = prefs.tl = v.tl; tlStatus(); try { localStorage.setItem('lumenpaint.prefs', JSON.stringify(prefs)); } catch (e) { } } });
}
function dlgShortcuts() {
  const rows = [['B / E / S', 'Brush / Eraser / Blend'], ['W', 'Liquify'], ['G / Shift+G', 'Paint bucket / Gradient'], ['U', 'Shapes & lines'], ['L / M', 'Lasso / Marquee select'], ['V', 'Transform'], ['I', 'Eyedropper'], ['K', 'Guides (symmetry, perspective, ruler)'],
    ['Alt-click / right-click', 'Pick color while painting'], ['[ / ]', 'Brush size smaller / larger'], ['1 … 0', 'Brush opacity 10% … 100%'], ['X', 'Swap foreground / background'],
    ['Space + drag', 'Pan'], ['R + drag', 'Rotate the view (Shift snaps 15°)'], ['Shift+R', 'Reset rotation'], ['H', 'Flip view horizontally'], ['Wheel / Ctrl+wheel', 'Zoom at cursor'], ['Ctrl+0 / Ctrl+1', 'Fit / 100%'],
    ['Two-finger pinch', 'Zoom + rotate + pan'], ['Two-finger / three-finger tap', 'Undo / Redo'], ['Tab', 'Zen mode (hide panels)'], ['F11', 'Full screen'],
    ['Ctrl+Z / Ctrl+Y', 'Undo / Redo'], ['Ctrl+Shift+N / Ctrl+J / Ctrl+E', 'New / Duplicate / Merge down'], ['/', 'Lock transparency'], ['Ctrl+Alt+G', 'Clipping mask'], ['Ctrl+G', 'Group layer'],
    ['Ctrl+A / Ctrl+D / Ctrl+Shift+I', 'Select all / Deselect / Invert'], ['Enter / Esc', 'Apply / cancel transform'],
    ['T', 'Text tool (click to type, drag a text box to move)'], [String.fromCharCode(92), 'Paint on layer / layer mask'], ['Alt-click mask thumbnail', 'View the mask · Shift-click: disable it'],
    ['Ctrl+U / Ctrl+B', 'Hue/Saturation / Color Balance'], ['Ctrl+M / Ctrl+L', 'Curves / Levels'], ['Ctrl+I', 'Invert layer colors'],
    ['Ctrl+Shift+Space', 'Play / pause animation'], [', / .', 'Previous / next frame'], ['Ctrl+Alt+N', 'New animation frame']];
  Aero.dialog({ title: 'Keyboard Shortcuts', noCancel: true, width: 560, html: `<table class="kbd">${rows.map(r => `<tr><td><b>${esc(r[0])}</b></td><td>${esc(r[1])}</td></tr>`).join('')}</table>` });
}
function dlgAbout() {
  const gl = R?.gl, info = gl ? (R.float ? '8-bit compositing, float watercolor simulation' : '8-bit compositing') : '';
  Aero.dialog({ title: 'About Lumen Paint', noCancel: true, html: `<div class="about"><img src="../kit/icons/paint.png" alt=""><div><h2>Lumen Paint</h2><p>Natural-media painting for Lumen Studio — watercolor that blooms and bleeds, oils that pick up and smear, pencils that catch the paper grain.</p><p class="dim">WebGL2 compositor (${info}) · tiled copy-on-write undo · WebCodecs time-lapse.<br>Libraries: fflate (MIT), ag-psd (MIT), mp4-muxer (MIT), webm-muxer (MIT), gifenc (MIT).</p></div></div>` });
}

/* ---------- menus ---------- */
function brushSizeStep(dir) { const b = currentBrush(); b.size = clamp(Math.round(b.size * (dir > 0 ? 1.18 : 1 / 1.18) + dir), 1, 1000); brushStateChanged(b); cmdSync.forEach(s => s.sync()); }
function buildMenus() {
  const chk = (fn) => fn;
  return {
    File: [['New Canvas…', 'Ctrl+N', dlgNew], ['Open…', 'Ctrl+O', cmdOpen], ['Open Sample', '', openSample], '-',
      ['Save', 'Ctrl+S', () => cmdSave(false)], ['Save As…', 'Ctrl+Shift+S', () => cmdSave(true)], '-',
      ['Import Image / PSD as Layer…', 'Ctrl+Shift+O', cmdImport], ['Place Reference Image…', '', cmdPlaceRef], '-',
      ['Export PNG / JPEG / WebP…', 'Ctrl+Shift+E', dlgExport], ['Export PSD (layers)…', '', cmdExportPSD], ['Export Time-lapse Video…', '', dlgTimelapse]],
    Edit: [{ label: 'Undo', key: 'Ctrl+Z', fn: undo, disabled: () => hist.index <= 0 }, { label: 'Redo', key: 'Ctrl+Y/Ctrl+Shift+Z', fn: redo, disabled: () => hist.index >= hist.items.length - 1 }, '-',
      ['Cut', 'Ctrl+X', () => cmdCopy(true)], ['Copy', 'Ctrl+C', () => cmdCopy(false)], { label: 'Paste', key: 'Ctrl+V', fn: pasteMenu, noShortcut: true }, '-',
      ['Fill with Foreground', 'Alt+Backspace', cmdFillFG], ['Clear', 'Delete', cmdClearLayer], '-', ['Preferences…', 'Ctrl+K', dlgPrefs], ['Pressure Curve…', '', dlgPressure]],
    Select: [['All', 'Ctrl+A', () => setSelection(new Uint8Array(doc.w * doc.h).fill(255), 'Select All')], ['Deselect', 'Ctrl+D', () => doc.sel && setSelection(null, 'Deselect')], ['Invert', 'Ctrl+Shift+I', invertSelection], '-',
      ['Layer Pixels', '', cmdSelectAlpha], ['Feather…', 'Shift+F6', cmdFeather], '-', ['Lasso', 'L', () => setTool('lasso')], ['Rectangle / Ellipse', 'M', () => setTool('marquee')]],
    Layer: [['New Layer', 'Ctrl+Shift+N', cmdNewLayer], ['New Group', '', cmdNewGroup], ['New Fill Layer', '', cmdNewFill], ['Duplicate Layer', 'Ctrl+J', cmdDuplicate], ['Delete Layer', '', cmdDeleteLayer], '-',
      ['Group Layer', 'Ctrl+G', cmdGroupActive], ['Ungroup', 'Ctrl+Shift+G', cmdUngroup], ['Merge Down', 'Ctrl+E', cmdMergeDown], ['Merge Group', '', cmdMergeGroup], ['Flatten Image', 'Ctrl+Shift+F', cmdFlatten], '-',
      { label: 'Lock Transparency', key: '/', fn: toggleLockAlpha, checked: () => !!doc?.active?.lockAlpha }, { label: 'Clipping Mask', key: 'Ctrl+Alt+G', fn: toggleClip, checked: () => !!doc?.active?.clip }, '-',
      '#Layer mask', ['Add Mask (Reveal All)', '', () => cmdAddMask('reveal')], ['Add Mask (Hide All)', '', () => cmdAddMask('hide')], { label: 'Add Mask from Selection', fn: () => cmdAddMask('selection'), disabled: () => !doc?.sel },
      { label: 'Paint on Mask', key: String.fromCharCode(92), fn: toggleEditMask, checked: () => !!(doc?.editMask && doc.active?.mask), disabled: () => !doc?.active?.mask },
      { label: 'Enable Mask', fn: cmdToggleMaskOn, checked: () => !!(doc?.active?.mask && doc.active.maskOn), disabled: () => !doc?.active?.mask }, { label: 'Link Mask to Layer', fn: cmdToggleMaskLink, checked: () => !!(doc?.active?.mask && doc.active.maskLinked), disabled: () => !doc?.active?.mask },
      { label: 'Invert Mask', fn: cmdInvertMask, disabled: () => !doc?.active?.mask }, { label: 'Load Mask as Selection', fn: cmdMaskToSelection, disabled: () => !doc?.active?.mask }, { label: 'Apply Mask', fn: cmdApplyMask, disabled: () => !doc?.active?.mask }, { label: 'Delete Mask', fn: cmdDeleteMask, disabled: () => !doc?.active?.mask }, '-',
      { label: 'Edit Text…', fn: () => editTextLayer(doc.active), disabled: () => !doc?.active?.text }, { label: 'Rasterize Text', fn: () => cmdRasterizeText(), disabled: () => !doc?.active?.text }, '-',
      ['Move Up', 'Ctrl+]', () => cmdMoveLayer(1)], ['Move Down', 'Ctrl+[', () => cmdMoveLayer(-1)], ['Flip Layer Horizontal', '', () => cmdFlipLayer(true)], ['Flip Layer Vertical', '', () => cmdFlipLayer(false)], ['Transform…', 'Ctrl+T', () => setTool('transform')], '-', ['Layer Properties…', '', () => doc.active && layerProps(doc.active)]],
    Image: ['#Adjustments (current layer, inside the selection)', ['Hue / Saturation…', 'Ctrl+U', adjHSL], ['Brightness / Contrast…', '', adjBrightnessContrast], ['Curves…', 'Ctrl+M', adjCurves], ['Levels…', 'Ctrl+L', adjLevels], ['Color Balance…', 'Ctrl+B', adjColorBalance], ['Invert', 'Ctrl+I', adjInvert], ['Gradient Map…', '', adjGradientMap], '-', ['Extract Palette from Canvas', '', cmdCanvasPalette]],
    Canvas: [['Canvas Size…', 'Ctrl+Alt+C', dlgCanvasSize], ['Resize Image…', 'Ctrl+Alt+I', dlgResize], '-', ['Rotate 90° Clockwise', '', () => cmdRotateCanvas(true)], ['Rotate 90° Counter-clockwise', '', () => cmdRotateCanvas(false)], ['Flip Canvas Horizontal', '', cmdFlipCanvas], '-', ['Paper Texture…', '', dlgPaper]],
    View: [['Zoom In', 'Ctrl+=', () => zoomAt(1.25)], ['Zoom Out', 'Ctrl+-', () => zoomAt(0.8)], ['Fit on Screen', 'Ctrl+0', () => fitView()], ['Actual Pixels (100%)', 'Ctrl+1', () => setZoom(1)], '-',
      ['Reset Rotation', 'Shift+R', () => rotateView(0)], { label: 'Flip View Horizontal', key: 'H', fn: flipView, checked: () => view.flip }, '-',
      { label: 'Zen Mode (hide panels)', key: 'Tab', fn: toggleZen, checked: () => zen }, ['Full Screen', 'F11', toggleFullscreen], { label: 'Reference Image Panel', key: '', fn: toggleRef, checked: () => !$('#refpanel').hidden }, ['Extract Palette from Reference', '', () => cmdRefPalette()], '-',
      '#Guides',
      ...[['off', 'Symmetry Off'], ['v', 'Vertical Symmetry'], ['h', 'Horizontal Symmetry'], ['quad', 'Quadrant Symmetry'], ['radial', 'Radial Symmetry'], ['kaleido', 'Kaleidoscope']].map(([v, t]) => ({ label: t, fn: () => { guides.sym = v; renderCmd(); requestOverlay(); }, checked: () => guides.sym === v })),
      ...[['off', 'Perspective Off'], ['1', '1-Point Perspective'], ['2', '2-Point Perspective']].map(([v, t]) => ({ label: t, fn: () => { guides.persp = v; renderCmd(); requestOverlay(); }, checked: () => guides.persp === v })),
      { label: 'Ruler', key: '', fn: () => { guides.ruler.on = !guides.ruler.on; renderCmd(); requestOverlay(); }, checked: () => guides.ruler.on }, { label: 'Show Guides', key: ';', fn: () => { guides.show = !guides.show; requestOverlay(); }, checked: () => guides.show }],
    Brush: [['Brush Settings…', 'F5', () => openBrushEditor(currentBrush())], ['Larger', ']', () => brushSizeStep(1)], ['Smaller', '[', () => brushSizeStep(-1)], '-', ['Import Brushes (.lpbrush, .abr)…', '', cmdImportBrushes], ['Import Photoshop Brushes (.abr)…', '', () => cmdImportAbr()], ['New Brush Tip from Selection', '', cmdTipFromSelection], ['Export Custom Brushes…', '', cmdExportBrushes]],
    Animation: [{ label: 'Animation Mode', fn: () => toggleAnimMode(), checked: () => animOn() }, { label: 'Play / Pause', key: 'Ctrl+Shift+Space', fn: animPlay }, { label: 'Previous Frame', key: ',', fn: () => animStep(-1), disabled: () => !animOn() }, { label: 'Next Frame', key: '.', fn: () => animStep(1), disabled: () => !animOn() }, '-',
      ['New Frame', 'Ctrl+Alt+N', () => animNewFrame(false)], ['Duplicate Frame', '', () => animNewFrame(true)], { label: 'Delete Frame', fn: animDeleteFrame, disabled: () => !animOn() }, '-', ['Onion Skin…', '', dlgOnion], { label: 'Export Animation (GIF / MP4)…', fn: dlgAnimExport, disabled: () => !animOn() }],
    'Time-lapse': [{ label: 'Record Time-lapse', fn: () => { TL.on = !TL.on; tlStatus(); Aero.toast(TL.on ? 'Time-lapse recording on' : 'Time-lapse recording paused'); }, checked: () => TL.on }, ['Export Time-lapse Video…', '', dlgTimelapse], ['Clear Recording', '', async () => { if (await Aero.confirm('Clear recording', 'Delete all recorded time-lapse frames for this canvas?', 'Delete')) { tlReset(); Aero.toast('Recording cleared'); } }]],
    Help: [['Keyboard Shortcuts', 'F1', dlgShortcuts], ['About Lumen Paint', '', dlgAbout]]
  };
}
async function cmdImportBrushes() {
  const f = await Aero.openFile({ accept: '.json,.lpbrush,.abr', filters: [{ name: 'Brush sets (Lumen, Photoshop)', extensions: ['lpbrush', 'json', 'abr'] }] }); if (!f[0]) return;
  if (ext(f[0].name) === 'abr') return cmdImportAbr(f);
  importBrushFile(f[0]);
}
function importBrushFile(file) {
  try {
    const arr = JSON.parse(new TextDecoder().decode(file.data)); const list = Array.isArray(arr) ? arr : arr.brushes; if (!Array.isArray(list)) throw new Error('No brushes in file');
    const tipIds = importTips(arr.tips);
    let n = 0; for (const b of list.slice(0, 200)) { if (!b || typeof b !== 'object') continue; const tip = typeof b.tip === 'string' && b.tip.startsWith('img:') ? (tipIds[b.tip.slice(4)] ? 'img:' + tipIds[b.tip.slice(4)] : 'round') : b.tip; const nb = sanitizeBrush({ ...b, tip, id: 'custom-' + uid() }); BRUSHES.push(nb); n++; }
    saveCustomBrushes(); saveCustomTips(); brushCat = 'Custom'; renderBrushCats(); renderBrushList(); Aero.toast(`Imported ${n} brush${n === 1 ? '' : 'es'}`);
  } catch (e) { Aero.alert('Import failed', String(e.message || e)); }
}
function cmdExportBrushes() { const list = BRUSHES.filter(b => b.custom); if (!list.length) { Aero.toast('No custom brushes yet — use Brush Settings › Save as New Brush'); return; } Aero.saveFile({ name: 'Lumen Paint brushes.lpbrush', data: JSON.stringify({ format: 'lumen-paint-brushes', version: 2, brushes: list, tips: exportTips(list) }, null, 1) }); }

/* ---------- boot ---------- */
async function boot() {
  try { Object.assign(prefs, JSON.parse(localStorage.getItem('lumenpaint.prefs') || '{}')); } catch (e) { }
  TL.on = prefs.tl !== false;
  prefs.pressureCurve = validCurve(prefs.pressureCurve); rebuildPressureLUT();
  snapshotBrushDefaults(); loadCustomTips(); loadCustomBrushes(); loadBrushState();
  hist = new Aero.History({ max: 100, onChange: () => renderHistoryPanel() });
  Aero.init({ name: APP, icon: '../kit/icons/paint.png', menus: buildMenus(), onDropFiles: files => openFiles(files, undefined), dropTarget: $('#stage'), dropText: 'Drop .lpaint, PSD or images — images are added as layers', onSave: () => cmdSave(false) });
  toolbox = Aero.toolbox($('#tools'), TOOL_DEFS, id => setTool(id));
  // swatches under the tools
  const sw = el('div', 'tb-colors', '<div class="tb-bg" title="Background (X swaps)"></div><div class="tb-fg" title="Foreground"></div>'); $('#tools').appendChild(sw);
  sw.querySelector('.tb-bg').onclick = swapColors;
  colorListeners.push(() => { sw.querySelector('.tb-fg').style.background = rgbHex(FG); sw.querySelector('.tb-bg').style.background = rgbHex(BG); if (pointerPos) requestOverlay(); });
  buildColorPanel(); buildLayerButtons(); renderBrushCats(); initRefPanel();
  initHarmony(); restorePaletteSets(); initBrushButtons(); initTextPanel(); initAnimBar();
  $$('#rtabs .aero-tab').forEach(t => t.onclick = () => { $$('#rtabs .aero-tab').forEach(x => x.classList.toggle('on', x === t)); $('#layerpane').hidden = t.dataset.t !== 'layers'; $('#histpane').hidden = t.dataset.t !== 'history'; renderHistoryPanel(); });
  $('#zenexit').onclick = toggleZen; $('#rp-pal-btn').onclick = () => cmdRefPalette();
  // extra shortcuts
  Aero.shortcut('X', swapColors); Aero.shortcut('D', () => { FG = [0, 0, 0]; BG = [1, 1, 1]; fgHSV = [fgHSV[0], 0, 0]; updateColorUI(); });
  for (let i = 0; i <= 9; i++) Aero.shortcut(String(i), () => { if (!['brush', 'eraser', 'smudge'].includes(activeToolId)) return; const b = currentBrush(); b.opacity = i === 0 ? 1 : i / 10; brushStateChanged(b); cmdSync.forEach(s => s.sync()); Aero.toast('Opacity ' + Math.round(b.opacity * 100) + '%', 700); });
  Aero.shortcut('Enter', () => { if (floating) commitTransform(); });
  Aero.shortcut('Escape', () => { if (floating) cancelTransform(); else activeTool?.cancel?.(); });
  document.addEventListener('keydown', e => { if (e.key === 'Tab' && !e.target.matches?.('input,textarea,select') && !$('.aero-modal')) { e.preventDefault(); } }, true);
  initStage();
  setTool('brush');
  if (TL.supported) tlPickCodec(1280, 854).catch(() => { });
  // start with the sample painting so the app is never empty
  if (/[?&]nosample/.test(location.search)) newDocument(3000, 2000, 'white', 'cold'); else await openSample(true);
  window.LumenPaint = { get doc() { return doc; }, hist, importAbr, extractPalette, animExport, animRenderFrame, renderTextLayer, maskValues, pressureMap, R: () => R, TL, BRUSHES, paintPath, setTool, frameStats, prefs, guides, newDocument, buildLpaint, loadLpaint, exportPSD, loadPSD, exportImage, tlExport, floodFill, view };
}
addEventListener('DOMContentLoaded', () => { boot().catch(e => { console.error(e); Aero.alert('Lumen Paint failed to start', String(e.message || e)); }); });
