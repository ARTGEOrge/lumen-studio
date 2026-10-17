'use strict';
/* Command bar, brush library + brush editor, layers panel, history panel. */

/* ---------- command bar helpers ---------- */
function cmdSlider(bar, label, min, max, step, get, set, fmt = v => v, log = false) {
  const lab = el('label', null, `${esc(label)} `), inp = el('input'); inp.type = 'range';
  const toS = v => log ? Math.round(Math.log(v / min) / Math.log(max / min) * 1000) : v, fromS = s => log ? Math.round(min * Math.pow(max / min, s / 1000) * 10) / 10 : +s;
  if (log) { inp.min = 0; inp.max = 1000; inp.step = 1; } else { inp.min = min; inp.max = max; inp.step = step; }
  inp.value = toS(get()); inp.style.width = '96px';
  const v = el('span', 'v', esc(fmt(get())));
  inp.oninput = () => { const x = fromS(inp.value); set(x); v.textContent = fmt(x); };
  inp.onchange = () => inp.blur();
  lab.append(inp, v); bar.appendChild(lab);
  return { sync() { inp.value = toS(get()); v.textContent = fmt(get()); } };
}
function cmdSelect(bar, label, opts, get, set) {
  const lab = el('label', null, esc(label) + ' '), s = el('select');
  opts.forEach(([v, t]) => s.add(new Option(t, v))); s.value = get(); s.onchange = () => { set(s.value); s.blur(); requestOverlay(); };
  lab.appendChild(s); bar.appendChild(lab); return s;
}
function cmdCheck(bar, label, get, set) { const lab = el('label'), c = el('input'); c.type = 'checkbox'; c.checked = get(); c.onchange = () => { set(c.checked); requestOverlay(); }; lab.append(c, document.createTextNode(label)); bar.appendChild(lab); return c; }
function cmdButton(bar, label, fn) { const b = el('button', 'aero-btn', esc(label)); b.onclick = () => { fn(); b.blur(); }; bar.appendChild(b); return b; }
function cmdHint(bar, t) { bar.appendChild(el('span', 'hint', esc(t))); }
function cmdLabel(bar, t) { bar.appendChild(el('span', 'hint', esc(t))); }
const TOOL_NAMES = { brush: 'Brush', eraser: 'Eraser', smudge: 'Blend', liquify: 'Liquify', fill: 'Paint Bucket', gradient: 'Gradient', shape: 'Shapes', lasso: 'Lasso', marquee: 'Marquee', transform: 'Transform', pick: 'Eyedropper', guides: 'Guides', hand: 'Hand' };
let cmdSync = [];
function renderCmd() {
  const bar = $('#cmd'); bar.innerHTML = ''; cmdSync = [];
  bar.appendChild(el('span', 'tname', esc(TOOL_NAMES[activeToolId] || '')));
  activeTool?.options?.(bar);
}
function brushOptions(bar, kind) {
  const b = brushFor(kind);
  const nb = el('button', 'aero-btn bname', `${esc(b.name)} ▾`); nb.title = 'Brush settings…'; nb.onclick = () => openBrushEditor(b); bar.appendChild(nb);
  cmdSync.push(cmdSlider(bar, 'Size', 1, 1000, 1, () => b.size, v => { b.size = v; brushStateChanged(b); }, v => Math.round(v) + ' px', true));
  if (!(kind === 'smudge' || b.mode === 'smudge')) cmdSync.push(cmdSlider(bar, 'Opacity', 0.01, 1, 0.01, () => b.opacity ?? 1, v => { b.opacity = v; brushStateChanged(b); }, v => Math.round(v * 100) + '%'));
  if (kind === 'smudge' || b.mode === 'smudge') cmdSync.push(cmdSlider(bar, 'Strength', 0.05, 1, 0.01, () => b.strength ?? 0.6, v => { b.strength = v; brushStateChanged(b); }, v => Math.round(v * 100) + '%'));
  else cmdSync.push(cmdSlider(bar, 'Flow', 0.01, 1, 0.01, () => b.flow ?? 1, v => { b.flow = v; brushStateChanged(b); }, v => Math.round(v * 100) + '%'));
  cmdSync.push(cmdSlider(bar, 'Smoothing', 0, 0.95, 0.01, () => b.smoothing ?? 0.25, v => { b.smoothing = v; brushStateChanged(b); }, v => Math.round(v * 100) + '%'));
  bar.appendChild(el('span', 'sep'));
  cmdSelect(bar, 'Symmetry', [['off', 'Off'], ['v', 'Vertical'], ['h', 'Horizontal'], ['quad', 'Quadrant'], ['radial', 'Radial'], ['kaleido', 'Kaleidoscope']], () => guides.sym, v => { guides.sym = v; if (v !== 'off') Aero.toast('Symmetry on — use the Guides tool (K) to move the center'); requestOverlay(); });
}
let brushSaveT = 0;
function brushStateChanged(b) {
  clearTimeout(brushSaveT); brushSaveT = setTimeout(saveBrushState, 400); requestOverlay();
  if (b.custom) saveCustomBrushes();
}
const BRUSH_FACTORY = {};
function snapshotBrushDefaults() { for (const b of BRUSHES) BRUSH_FACTORY[b.id] = JSON.parse(JSON.stringify(b)); }
function saveBrushState() {
  const st = {}; for (const b of BRUSHES) { if (b.custom) continue; const f = BRUSH_FACTORY[b.id]; const diff = {}; for (const k of Object.keys(BRUSH_DEF)) { const cur = b[k] ?? BRUSH_DEF[k], def = f[k] ?? BRUSH_DEF[k]; if (cur !== def) diff[k] = cur; } if (Object.keys(diff).length) st[b.id] = diff; }
  try { localStorage.setItem('lumenpaint.brushstate', JSON.stringify(st)); localStorage.setItem('lumenpaint.toolbrush', JSON.stringify(toolBrush)); } catch (e) { }
}
function loadBrushState() {
  try {
    const st = JSON.parse(localStorage.getItem('lumenpaint.brushstate') || '{}');
    for (const [id, diff] of Object.entries(st)) { const b = brushById(id); if (b) Object.assign(b, sanitizeBrush({ ...diff, id }), { id, name: b.name, cat: b.cat, custom: b.custom }); }
    const tb = JSON.parse(localStorage.getItem('lumenpaint.toolbrush') || '{}'); for (const k of Object.keys(toolBrush)) if (tb[k] && brushById(tb[k])) toolBrush[k] = tb[k];
  } catch (e) { }
}

/* ---------- brush previews ---------- */
let previewing = false;
function withTempDoc(w, h, fn) {
  const saved = doc, savedSims = new Map(wetSims), savedStroke = activeStroke; wetSims.clear(); previewing = true;
  doc = newDoc(w, h); doc.paper = saved ? saved.paper : 'cold'; doc.paperScale = saved ? saved.paperScale : 1;
  const L = new Layer('pixel', 'preview', w, h); doc.root = [L]; doc.active = L;
  let out;
  try { fn(L); for (const s of [...wetSims.values()]) s.finish(400); out = layerRGBA(L); }
  finally { doc = saved; previewing = false; wetSims.clear(); for (const [k, v] of savedSims) wetSims.set(k, v); activeStroke = savedStroke; }
  return out;
}
function previewStroke(b, w, h, color, scale) {
  const fb = fullBrush(b), sz = clamp(fb.size, 2, h * (fb.mode === 'water' ? 0.55 : 0.6) / Math.max(0.6, 1 + (fb.tiltSize || 0) * 0));
  const fbx = { ...fb, size: scale ? sz : fb.size, smoothing: 0 };
  return withTempDoc(w, h, L => {
    if (fbx.mode === 'erase' || fbx.mode === 'smudge' || fbx.mode === 'oil') {
      const cols = fbx.mode === 'erase' ? [[0.55, 0.62, 0.72]] : [[0.95, 0.75, 0.2], [0.85, 0.25, 0.25], [0.2, 0.45, 0.8]];
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = cols[Math.floor(x / w * cols.length)], i = (y * w + x) * 4; if (fbx.mode !== 'erase' && (y < h * 0.2 || y > h * 0.8)) continue; data[i] = c[0] * 255; data[i + 1] = c[1] * 255; data[i + 2] = c[2] * 255; data[i + 3] = 255; }
      writeRegion(L, 0, 0, w, h, data, false); freezeAll();
    }
    const pts = [], n = 60, m = sz * 0.6 + 6;
    for (let i = 0; i <= n; i++) { const t = i / n; pts.push({ x: m + t * (w - 2 * m), y: h / 2 + Math.sin(t * Math.PI * 2) * (h / 2 - m * 0.9) * 0.8, p: Math.pow(Math.sin(Math.PI * clamp(t * 1.1 - 0.05, 0, 1)), 0.6) * 0.95 + 0.05, dt: 6 }); }
    paintPath(pts, fbx, color, { layer: L, mode: fbx.mode === 'erase' ? 'erase' : undefined });
  });
}
function previewToCanvas(cv, rgba, w, h) {
  cv.width = w; cv.height = h; const c = cv.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, w, h);
  const tmp = rgbaToCanvas(w, h, rgba); c.drawImage(tmp, 0, 0);
}

/* ---------- brush library ---------- */
let brushCat = 'Inking';
const previewCache = new Map();
function renderBrushCats() {
  const c = $('#brushcats'); c.innerHTML = '';
  BRUSH_CATS.forEach(cat => {
    const n = BRUSHES.filter(b => b.cat === cat).length; if (!n && cat === 'Custom') return;
    const t = el('span', 'bcat' + (cat === brushCat ? ' on' : ''), esc(cat)); t.onclick = () => { brushCat = cat; renderBrushCats(); renderBrushList(); }; c.appendChild(t);
  });
}
function renderBrushList() {
  const list = $('#brushlist'); if (!list) return; list.innerHTML = '';
  const kind = ['eraser', 'smudge'].includes(activeToolId) ? activeToolId : 'brush', cur = toolBrush[kind];
  const items = BRUSHES.filter(b => b.cat === brushCat);
  $('#brushcount').textContent = `${TOOL_NAMES[kind]}: ${brushFor(kind).name}`;
  for (const b of items) {
    const it = el('div', 'aero-item bitem' + (b.id === cur ? ' sel' : ''));
    const cv = el('canvas', 'bprev'); cv.width = 210; cv.height = 34;
    it.append(el('div', 'bname', esc(b.name) + (b.custom ? ' <span class="dim">(custom)</span>' : '')), cv);
    it.onclick = () => { if (!['brush', 'eraser', 'smudge'].includes(activeToolId)) setTool('brush'); const k = ['eraser', 'smudge'].includes(activeToolId) ? activeToolId : 'brush'; toolBrush[k] = b.id; saveBrushState(); renderBrushList(); renderCmd(); };
    it.ondblclick = () => openBrushEditor(b);
    list.appendChild(it);
    queuePreview(b, cv);
  }
  list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
}
let pq = [], pqRunning = false;
function brushKey(b) { return JSON.stringify(fullBrush(b)) + (doc ? doc.paper : ''); }
function queuePreview(b, cv) {
  const k = b.id + '|' + brushKey(b), cached = previewCache.get(b.id);
  if (cached && cached.k === k) { cv.getContext('2d').drawImage(cached.cv, 0, 0); return; }
  pq.push({ b, cv, k }); if (!pqRunning) { pqRunning = true; setTimeout(runPreviews, 30); }
}
function runPreviews() {
  const t0 = performance.now();
  while (pq.length && performance.now() - t0 < 25) {
    const { b, cv, k } = pq.shift();
    const cached = previewCache.get(b.id);
    let src;
    if (cached && cached.k === k) src = cached.cv;
    else { const w = 210, h = 34, rgba = previewStroke(b, w, h, [0.14, 0.2, 0.32], true); src = el('canvas'); previewToCanvas(src, rgba, w, h); previewCache.set(b.id, { k, cv: src }); }
    cv.getContext('2d').drawImage(src, 0, 0);
  }
  if (pq.length) setTimeout(runPreviews, 16); else pqRunning = false;
}

/* ---------- brush editor ---------- */
const BE_FIELDS = {
  Shape: [['tip', 'Tip', 'select', () => [['round', 'Round'], ['pencil', 'Pencil grit'], ['chalk', 'Chalk'], ['charcoal', 'Charcoal'], ['crayon', 'Wax crayon'], ['sponge', 'Sponge'], ['bristle', 'Round bristle'], ['flat', 'Flat bristle'], ['knife', 'Palette knife'], ...customTipOptions()]],
    ['size', 'Size (px)', 'range', 1, 1000, 1], ['hardness', 'Hardness', 'range', 0, 1, 0.01], ['roundness', 'Roundness', 'range', 0.05, 1, 0.01], ['angle', 'Angle (°)', 'range', -180, 180, 1],
    ['rotMode', 'Rotation', 'select', [['fixed', 'Fixed angle'], ['direction', 'Follow stroke'], ['tilt', 'Follow pen tilt'], ['random', 'Random']]], ['spacing', 'Spacing', 'range', 0.01, 1, 0.01]],
  Stroke: [['mode', 'Paint mode', 'select', [['paint', 'Paint'], ['water', 'Watercolor (wet)'], ['oil', 'Oil / acrylic'], ['smudge', 'Blend / smudge'], ['erase', 'Erase']]], ['blend', 'Blend', 'select', [['normal', 'Normal'], ['multiply', 'Multiply (marker)']]],
    ['opacity', 'Max opacity', 'range', 0.01, 1, 0.01], ['flow', 'Flow', 'range', 0.01, 1, 0.01], ['smoothing', 'Smoothing', 'range', 0, 0.95, 0.01], ['stabMode', 'Stabiliser', 'select', [['smooth', 'Streamline (smooth)'], ['rope', 'Pulled string (lazy)']]]],
  Dynamics: [['pSize', 'Pressure → size', 'range', 0, 1, 0.01], ['minSize', 'Minimum size', 'range', 0, 1, 0.01], ['pOpacity', 'Pressure → opacity', 'range', 0, 1, 0.01], ['pFlow', 'Pressure → flow', 'range', 0, 1, 0.01],
    ['tiltSize', 'Tilt → size', 'range', 0, 5, 0.05], ['tiltOpacity', 'Tilt → lighter', 'range', 0, 1, 0.01], ['velSize', 'Speed → thinner', 'range', -1, 1, 0.01]],
  Jitter: [['jSize', 'Size jitter', 'range', 0, 1, 0.01], ['jAngle', 'Angle jitter', 'range', 0, 1, 0.01], ['scatter', 'Scatter', 'range', 0, 3, 0.01], ['jOpacity', 'Opacity jitter', 'range', 0, 1, 0.01],
    ['jHue', 'Hue jitter', 'range', 0, 1, 0.01], ['jSat', 'Saturation jitter', 'range', 0, 1, 0.01], ['jVal', 'Brightness jitter', 'range', 0, 1, 0.01], ['colorPerStroke', 'Color jitter per stroke', 'checkbox']],
  Texture: [['grain', 'Paper grain', 'range', 0, 1, 0.01], ['grainScale', 'Grain scale', 'range', 0.25, 6, 0.05], ['grainPressure', 'Pressure fills grain', 'range', 0, 1, 0.01]],
  Wet: [['water', 'Water (watercolor)', 'range', 0.05, 2, 0.01], ['pigment', 'Pigment load', 'range', 0.02, 1, 0.01], ['bleed', 'Bleed / diffusion', 'range', 0, 1, 0.01], ['edge', 'Wet edge darkening', 'range', 0, 1, 0.01], ['gran', 'Granulation', 'range', 0, 1, 0.01], ['dryTime', 'Drying time (s)', 'range', 0.3, 5, 0.1],
    ['mix', 'Color pickup (oil)', 'range', 0, 1, 0.01], ['smear', 'Smear (oil)', 'range', 0, 1, 0.01], ['dry', 'Paint runs out (oil)', 'range', 0, 0.006, 0.0001], ['impasto', 'Impasto (oil)', 'range', 0, 0.5, 0.01], ['strength', 'Smudge strength', 'range', 0.05, 1, 0.01]]
};
function openBrushEditor(target) {
  const work = JSON.parse(JSON.stringify(fullBrush(target)));
  const ov = el('div', 'aero-modal'), box = el('div', 'aero-box be-box'); ov.appendChild(box);
  box.innerHTML = `<h3><img src="../kit/icons/paint.png" alt="">Brush Settings — ${esc(target.name)}</h3>
    <div class="content"><div class="be-top"><canvas id="be-prev" width="560" height="120"></canvas></div>
    <div class="be-name"><label>Name <input type="text" id="be-name" value="${esc(target.name)}" maxlength="60"></label><span class="dim" id="be-note"></span></div>
    <div class="aero-tabs be-tabs">${Object.keys(BE_FIELDS).map((t, i) => `<div class="aero-tab${i ? '' : ' on'}" data-t="${t}">${t}</div>`).join('')}</div><div class="be-pane" id="be-pane"></div></div>
    <div class="aero-btns"><button class="aero-btn" data-a="reset">Reset</button><span style="flex:1"></span><button class="aero-btn" data-a="new">Save as New Brush</button><button class="aero-btn" data-a="c">Cancel</button><button class="aero-btn pri" data-a="o">Apply</button></div>`;
  document.body.appendChild(ov);
  let tab = 'Shape', pending = false;
  const prev = $('#be-prev', box);
  const drawPrev = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; const rgba = previewStroke(work, 560, 120, FG, false); previewToCanvas(prev, rgba, 560, 120); }); };
  const renderPane = () => {
    const p = $('#be-pane', box); p.innerHTML = '';
    for (const f of BE_FIELDS[tab]) {
      const [key, label, type] = f, row = el('div', 'aero-row'), lab = el('label'); lab.textContent = label; row.appendChild(lab);
      let inp; const out = el('span', 'val');
      if (type === 'select') { inp = el('select'); (typeof f[3] === 'function' ? f[3]() : f[3]).forEach(([v, t]) => inp.add(new Option(t, v))); inp.value = work[key]; inp.onchange = () => { work[key] = inp.value; drawPrev(); }; }
      else if (type === 'checkbox') { inp = el('input'); inp.type = 'checkbox'; inp.checked = !!work[key]; inp.style.justifySelf = 'start'; inp.onchange = () => { work[key] = inp.checked; drawPrev(); }; }
      else { inp = el('input'); inp.type = 'range'; inp.min = f[3]; inp.max = f[4]; inp.step = f[5]; inp.value = work[key]; const fmt = v => f[5] >= 1 ? String(Math.round(v)) : f[5] < 0.001 ? (+v).toFixed(4) : (+v).toFixed(2); out.textContent = fmt(work[key]); inp.oninput = () => { work[key] = +inp.value; out.textContent = fmt(work[key]); drawPrev(); }; }
      row.append(inp, out); p.appendChild(row);
    }
    if (tab === 'Wet') p.insertAdjacentHTML('beforeend', '<div class="dnote">Watercolor settings apply in “Watercolor (wet)” mode, oil settings in “Oil / acrylic” mode, smudge strength in “Blend / smudge” mode.</div>');
    if (tab === 'Texture') p.insertAdjacentHTML('beforeend', `<div class="dnote">Paper texture is set per canvas (Canvas › Paper Texture). Current: ${esc((PAPERS.find(p => p[0] === doc.paper) || [, ''])[1])}.</div>`);
  };
  $$('.be-tabs .aero-tab', box).forEach(t => t.onclick = () => { tab = t.dataset.t; $$('.be-tabs .aero-tab', box).forEach(x => x.classList.toggle('on', x === t)); renderPane(); });
  $('#be-note', box).textContent = target.custom ? 'Custom brush' : 'Built-in brush — Apply changes it for this browser (Reset restores defaults)';
  const close = () => { ov.remove(); document.removeEventListener('keydown', kh, true); };
  const kh = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', kh, true);
  box.querySelector('.aero-btns').onclick = e => {
    const a = e.target.dataset.a; if (!a) return;
    const name = $('#be-name', box).value.trim() || target.name;
    if (a === 'c') close();
    else if (a === 'reset') { const f = target.custom ? target : BRUSH_FACTORY[target.id]; Object.keys(BRUSH_DEF).forEach(k => work[k] = f[k] ?? BRUSH_DEF[k]); renderPane(); drawPrev(); }
    else if (a === 'o') { for (const k of Object.keys(BRUSH_DEF)) target[k] = work[k]; if (target.custom) target.name = name; saveBrushState(); if (target.custom) { saveCustomBrushes(); saveCustomTips(); } close(); renderBrushList(); renderCmd(); Aero.toast('Brush updated'); }
    else if (a === 'new') {
      const nb = sanitizeBrush({ ...work, id: 'custom-' + uid(), name: name === target.name ? name + ' copy' : name });
      BRUSHES.push(nb); saveCustomBrushes(); saveCustomTips(); brushCat = 'Custom'; const k = ['eraser', 'smudge'].includes(activeToolId) ? activeToolId : 'brush'; toolBrush[k] = nb.id; saveBrushState();
      close(); renderBrushCats(); renderBrushList(); renderCmd(); Aero.toast('Saved custom brush “' + nb.name + '”');
    }
  };
  renderPane(); drawPrev();
}

/* ---------- layers panel ---------- */
const thumbDirty = new Set(); let thumbT = 0;
function layerThumbDirty(L) { if (L) thumbDirty.add(L); clearTimeout(thumbT); thumbT = setTimeout(updateThumbs, 160); }
function drawThumb(L, cv) {
  if (L.isMask) return drawMaskThumb(L, cv);
  const tw = 44, th = 33; cv.width = tw; cv.height = th; const c = cv.getContext('2d');
  if (L.type === 'fill') { c.fillStyle = rgbHex(L.color); c.fillRect(0, 0, tw, th); return; }
  if (L.type === 'group') { c.clearRect(0, 0, tw, th); return; }
  const s = Math.min(tw / doc.w, th / doc.h), w = Math.max(1, Math.round(doc.w * s)), h = Math.max(1, Math.round(doc.h * s));
  const img = c.createImageData(w, h), d = img.data, step = 1 / s;
  for (let y = 0; y < h; y++) {
    const sy = Math.min(doc.h - 1, Math.floor((y + 0.5) * step)), ty = (sy / TS) | 0, oy = sy % TS;
    for (let x = 0; x < w; x++) {
      const sx = Math.min(doc.w - 1, Math.floor((x + 0.5) * step)), t = L.tiles[ty * doc.tw + ((sx / TS) | 0)]; if (!t) continue;
      const o = (oy * TS + sx % TS) * 4, i = (y * w + x) * 4; d[i] = t[o]; d[i + 1] = t[o + 1]; d[i + 2] = t[o + 2]; d[i + 3] = t[o + 3];
    }
  }
  c.clearRect(0, 0, tw, th); c.putImageData(img, Math.round((tw - w) / 2), Math.round((th - h) / 2));
}
function updateThumbs() { for (const L of thumbDirty) { const cv = document.querySelector(`.lthumb[data-id="${L.id}"]`); if (cv) drawThumb(L, cv); } thumbDirty.clear(); }
let layersT = 0; function refreshLayersSoon() { clearTimeout(layersT); layersT = setTimeout(() => { renderLayers(); }, 30); }
const ICON_EYE = '<svg viewBox="0 0 16 16"><path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z" fill="#fff" stroke="#3a5a7a"/><circle cx="8" cy="8" r="2.4" fill="url(#gBlue)" stroke="#174a85" stroke-width=".7"/></svg>';
function renderLayers() {
  if (!doc) return;
  const list = $('#layers'); list.innerHTML = '';
  const rows = [];
  const visit = (arr, depth) => { for (let i = arr.length - 1; i >= 0; i--) { const L = arr[i]; rows.push({ L, depth }); if (L.type === 'group' && L.open) visit(L.children, depth + 1); } };
  visit(doc.root, 0);
  for (const { L, depth } of rows) {
    const it = el('div', 'aero-item litem' + (L === doc.active ? ' sel' : '') + (L.clip ? ' clipped' : '')); it.dataset.id = L.id;
    it.style.paddingLeft = (4 + depth * 14 + (L.clip ? 10 : 0)) + 'px';
    const eye = el('span', 'leye' + (L.visible ? '' : ' off'), ICON_EYE); eye.title = 'Show / hide';
    eye.onclick = e => { e.stopPropagation(); L.visible = !L.visible; doc.ver++; requestRender(); histPush(L.visible ? 'Show Layer' : 'Hide Layer'); };
    it.appendChild(eye);
    if (L.type === 'group') { const tg = el('span', 'ltog', L.open ? '▾' : '▸'); tg.onclick = e => { e.stopPropagation(); L.open = !L.open; renderLayers(); }; it.appendChild(tg); it.appendChild(el('span', 'lfolder', '<svg viewBox="0 0 16 16"><path d="M1.5 3.5h5l1.5 1.5h6.5v8.5h-13z" fill="url(#gFolder)" stroke="#a87a1a"/></svg>')); }
    else {
      const cv = el('canvas', 'lthumb' + (L.mask && !doc.editMask && L === doc.active ? ' tsel' : '')); cv.dataset.id = L.id; drawThumb(L, cv); it.appendChild(cv);
      if (L.text) { const tb = el('span', 'ltext', 'T'); tb.title = 'Text layer — double-click to edit'; it.appendChild(tb); }
      if (L.mask) cv.onclick = e => { if (L === doc.active) { e.stopPropagation(); doc.active = L; setEditMask(false); } };
    }
    if (L.mask) {
      const lk = el('span', 'llink' + (L.maskLinked ? '' : ' off'), '<svg viewBox="0 0 10 16"><path d="M5 1.5v4M5 10.5v4" stroke="#3a5a7a" stroke-width="1.4"/><rect x="2" y="4.5" width="6" height="3.5" rx="1.7" fill="none" stroke="#3a5a7a" stroke-width="1.2"/><rect x="2" y="8" width="6" height="3.5" rx="1.7" fill="none" stroke="#3a5a7a" stroke-width="1.2"/></svg>');
      lk.title = L.maskLinked ? 'Mask linked to layer (click to unlink)' : 'Mask not linked (click to link)';
      lk.onclick = e => { e.stopPropagation(); doc.active = L; cmdToggleMaskLink(); };
      const mc = el('canvas', 'lthumb lmask' + (doc.editMask && L === doc.active ? ' tsel' : '') + (L.maskOn ? '' : ' moff')); mc.dataset.id = L.mask.id; drawMaskThumb(L.mask, mc);
      mc.title = 'Layer mask — click to paint on it · Shift-click: disable · Alt-click: view mask';
      mc.onclick = e => {
        e.stopPropagation(); if (floating) commitTransform();
        if (doc.active !== L) { doc.active = L; doc.showMask = false; }
        if (e.shiftKey) { cmdToggleMaskOn(); return; }
        if (e.altKey) { toggleShowMask(); return; }
        setEditMask(true); renderLayers();
      };
      it.append(lk, mc);
    }
    if (L.clip) it.appendChild(el('span', 'lclip', '↳'));
    const nm = el('span', 'grow lname'); nm.textContent = L.name; it.appendChild(nm);
    const badges = el('span', 'lbadges');
    if (L.ref) badges.insertAdjacentHTML('beforeend', '<span class="lref" title="Reference layer — the Paint Bucket and Magic Wand can sample it">Ref</span>');
    if (L.lockAlpha) badges.insertAdjacentHTML('beforeend', '<span title="Transparency locked">🔒︎</span>');
    if (L.blend !== 'normal') badges.insertAdjacentHTML('beforeend', `<span class="dim">${esc((blendOptions(L).find(b => b[0] === L.blend) || [, ''])[1].split(' ')[0])}</span>`);
    if (L.opacity < 1) badges.insertAdjacentHTML('beforeend', `<span class="dim">${Math.round(L.opacity * 100)}%</span>`);
    if (wetSims.has(L)) badges.insertAdjacentHTML('beforeend', '<span class="wetdot" title="Wet paint drying">●</span>');
    it.appendChild(badges);
    it.onclick = () => { if (doc.active !== L) { if (floating) commitTransform(); doc.active = L; doc.editMask = false; if (doc.showMask) { doc.showMask = false; doc.ver++; requestRender(); } renderLayers(); renderLayerCtl(); if (typeof animLayerSelected === 'function') animLayerSelected(); } };
    it.ondblclick = () => L.text ? editTextLayer(L) : layerProps(L);
    it.onpointerdown = e => startLayerDrag(e, L, it);
    list.appendChild(it);
  }
  renderLayerCtl();
  $('#rtabs [data-t=layers]').textContent = `Layers (${allLayers().length})`;
}
function renderLayerCtl() {
  const c = $('#layerctl'), L = doc.active; c.innerHTML = '';
  if (!L) return;
  const bs = el('select'); blendOptions(L).forEach(([v, t]) => bs.add(new Option(t, v))); bs.value = L.blend; bs.title = 'Blend mode';
  bs.onchange = () => { L.blend = bs.value; doc.ver++; requestRender(); histPush('Blend Mode'); bs.blur(); };
  const op = el('input'); op.type = 'range'; op.min = 0; op.max = 100; op.value = Math.round(L.opacity * 100); op.title = 'Layer opacity';
  const ov = el('span', 'dim opv', op.value + '%');
  op.oninput = () => { L.opacity = op.value / 100; ov.textContent = op.value + '%'; doc.ver++; requestRender(); };
  op.onchange = () => { histPush('Layer Opacity'); op.blur(); };
  const lk = el('button', 'aero-iconbtn' + (L.lockAlpha ? ' on' : ''), '<svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="7.5" rx="1.2" fill="url(#gGold)" stroke="#8a5a0a"/><path d="M5.2 7V5a2.8 2.8 0 0 1 5.6 0v2" fill="none" stroke="#5a6a7a" stroke-width="1.5"/><path d="M6 10h4" stroke="#8a5a0a"/></svg>');
  lk.title = 'Lock transparency (/)'; lk.onclick = toggleLockAlpha; if (L.type !== 'pixel') lk.disabled = true;
  const cl = el('button', 'aero-iconbtn' + (L.clip ? ' on' : ''), '<svg viewBox="0 0 16 16"><path d="M4 2v8h8" fill="none" stroke="#1c5fb4" stroke-width="1.8"/><path d="M12 7l3 3-3 3z" fill="#1c5fb4"/></svg>');
  cl.title = 'Clipping mask — clip to layer below (Ctrl+Alt+G)'; cl.onclick = toggleClip;
  const row1 = el('div', 'lc-row'); row1.append(bs, lk, cl);
  const row2 = el('div', 'lc-row'); row2.append(el('span', 'dim', 'Opacity'), op, ov);
  c.append(row1, row2);
  if (L.type === 'fill') { const ci = el('input'); ci.type = 'color'; ci.value = rgbHex(L.color); ci.title = 'Fill color'; ci.oninput = () => { L.color = hexRgb(ci.value); doc.ver++; requestRender(); updateThumbs(); thumbDirty.add(L); updateThumbs(); renderLayers(); }; ci.onchange = () => histPush('Fill Color'); row2.appendChild(ci); }
}
function toggleLockAlpha() { const L = doc.active; if (!L || L.type !== 'pixel') return; L.lockAlpha = !L.lockAlpha; histPush(L.lockAlpha ? 'Lock Transparency' : 'Unlock Transparency'); Aero.toast(L.lockAlpha ? 'Transparency locked — paint stays inside existing pixels' : 'Transparency unlocked'); }
function toggleClip() { const L = doc.active; if (!L) return; const list = parentList(L); if (!L.clip && list.indexOf(L) === 0) { Aero.toast('A clipping mask needs a layer below it'); return; } L.clip = !L.clip; doc.ver++; requestRender(); histPush(L.clip ? 'Create Clipping Mask' : 'Release Clipping Mask'); }
let ldrag = null;
function startLayerDrag(e, L, it) {
  if (e.button !== 0 || e.target.closest('.leye,.ltog')) return;
  const y0 = e.clientY; let started = false, mark = null, drop = null;
  const list = $('#layers');
  const mv = ev => {
    if (!started && Math.abs(ev.clientY - y0) < 5) return;
    if (!started) { started = true; it.classList.add('dragging'); mark = el('div', 'ldropmark'); list.appendChild(mark); }
    const items = $$('.litem', list).filter(x => x !== it); drop = null;
    for (const x of items) {
      const r = x.getBoundingClientRect(); if (ev.clientY < r.top || ev.clientY > r.bottom) continue;
      const T = findLayer(x.dataset.id), f = (ev.clientY - r.top) / r.height;
      if (T.type === 'group' && f > 0.3 && f < 0.7) drop = { T, where: 'into', r }; else drop = { T, where: f < 0.5 ? 'above' : 'below', r };
    }
    if (drop) { const lr = list.getBoundingClientRect(); mark.style.display = 'block'; mark.className = 'ldropmark' + (drop.where === 'into' ? ' into' : ''); mark.style.top = (drop.where === 'below' ? drop.r.bottom : drop.where === 'into' ? drop.r.top : drop.r.top) - lr.top + list.scrollTop + 'px'; mark.style.height = drop.where === 'into' ? drop.r.height + 'px' : ''; }
    else if (mark) mark.style.display = 'none';
  };
  const upf = () => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', upf);
    if (!started) return; it.classList.remove('dragging'); mark?.remove();
    if (!drop || drop.T === L) return;
    // forbid dropping a group into itself
    let p = drop.where === 'into' ? drop.T : parentOf(drop.T); for (; p; p = parentOf(p)) if (p === L) return;
    removeLayer(L);
    if (drop.where === 'into') drop.T.children.push(L);
    else { const tl = parentList(drop.T), i = tl.indexOf(drop.T); tl.splice(drop.where === 'above' ? i + 1 : i, 0, L); }
    const pl = parentList(L); if (L.clip && pl.indexOf(L) === 0) L.clip = false;
    doc.ver++; requestRender(); histPush('Move Layer');
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', upf);
}
const blendOptions = L => L.type === 'group' ? [['pass-through', 'Pass Through'], ...BLENDS] : BLENDS;
function layerProps(L) {
  Aero.dialog({ title: 'Layer Properties', fields: [{ key: 'name', label: 'Name', type: 'text', value: L.name }, { key: 'op', label: 'Opacity', type: 'range', min: 0, max: 100, value: Math.round(L.opacity * 100), fmt: v => v + '%' }, { key: 'blend', label: 'Blend mode', type: 'select', options: blendOptions(L), value: L.blend }],
    onOK: v => { L.name = String(v.name || L.name).slice(0, 80); L.opacity = v.op / 100; L.blend = v.blend; doc.ver++; requestRender(); histPush('Layer Properties'); } });
}
function buildLayerButtons() {
  const bar = $('#layerbtns'); bar.innerHTML = '';
  const B = [
    ['New pixel layer (Ctrl+Shift+N)', '<path d="M3 1.5h6l3.5 3.5v9.5H3z" fill="url(#gPaper)" stroke="#5a7a9a"/><circle cx="11.5" cy="11.5" r="3.6" fill="url(#gGreen)" stroke="#2a6a14" stroke-width=".8"/><path d="M11.5 9.6v3.8M9.6 11.5h3.8" stroke="#fff" stroke-width="1.4"/>', () => cmdNewLayer()],
    ['New group (Ctrl+G groups the current layer)', '<path d="M1.5 3.5h5l1.5 1.5h6.5v8.5h-13z" fill="url(#gFolder)" stroke="#a87a1a"/>', () => cmdNewGroup()],
    ['New fill layer', '<rect x="2" y="2" width="12" height="12" rx="2" fill="url(#gBlue)" stroke="#174a85"/><path d="M5 11 11 5" stroke="#fff" stroke-width="1.6"/>', () => cmdNewFill()],
    ['Add layer mask (Alt-click: hide all)', '<rect x="1.5" y="2.5" width="13" height="11" rx="1.5" fill="url(#gPaper)" stroke="#5a7a9a"/><circle cx="8" cy="8" r="3.4" fill="#3a3f48"/>', e => cmdAddMask(e && e.altKey ? 'hide' : doc.sel ? 'selection' : 'reveal')],
    ['Duplicate layer (Ctrl+J)', '<path d="M5 4.5h8v10H5z" fill="url(#gPaper)" stroke="#5a7a9a"/><path d="M3 1.5h8v10H3z" fill="url(#gPaper)" stroke="#5a7a9a"/>', () => cmdDuplicate()],
    ['Merge down (Ctrl+E)', '<path d="M8 11 3.5 6H6V1.5h4V6h2.5z" fill="url(#gGold)" stroke="#8a5a0a" stroke-linejoin="round"/><rect x="2" y="12.3" width="12" height="2.4" rx=".8" fill="url(#gBlue)" stroke="#174a85" stroke-width=".7"/>', () => cmdMergeDown()],
    ['Delete layer', '<circle cx="8" cy="8" r="6.3" fill="url(#gRed)" stroke="#8a1a10"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>', () => cmdDeleteLayer()]
  ];
  for (const [t, svg, fn] of B) { const b = el('button', 'aero-iconbtn', `<svg viewBox="0 0 16 16">${svg}</svg>`); b.title = t; b.onclick = e => fn(e); bar.appendChild(b); }
}

/* ---------- history panel ---------- */
function renderHistoryPanel() { const h = $('#history'); if (h && !$('#histpane').hidden) Aero.renderHistory(h, hist, i => histGo(i)); }
