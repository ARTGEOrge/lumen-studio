'use strict';
/* UI: pointer & keyboard input, dialogs, menus, toolbar, options bar, panels, boot */

/* ---------- pointer ---------- */
let ftDragging = false;
overlay.addEventListener('pointerdown', e => {
  closeMenus(); if (!doc) return;
  if (canvasPickHook && e.button === 0) { canvasPickHook(toDoc(e)); return; }
  overlay.setPointerCapture(e.pointerId);
  if (e.button === 1 || spaceDown || tool === 'hand') { panning = { sx: e.clientX, sy: e.clientY, px: panX, py: panY }; updateCursor(); e.preventDefault(); return; }
  if (e.button !== 0 || stroke || document.querySelector('.modal')) return;
  if (compare) { if (compare.mode === 'split') { compare.drag = true; compare.pos = clamp(toDoc(e).x / doc.w, 0, 1); requestRender(); } return; }
  if (ft) { ftDragging = true; ftDown(toDoc(e), e); requestOverlay(); return; }
  if (tool === 'move' || e.ctrlKey) { const gi = hitGuide(e); if (gi >= 0) { overlay.releasePointerCapture(e.pointerId); startGuideDrag(doc.guides[gi].o, e, gi); return; } }
  dragging = true; Tools[tool].down?.(toDoc(e), e); requestOverlay();
});
overlay.addEventListener('pointermove', e => {
  const r = overlay.getBoundingClientRect(); mouse.sx = e.clientX - r.left; mouse.sy = e.clientY - r.top; mouse.inside = true;
  if (!doc) return;
  const p = toDoc(e); mouse.x = p.x; mouse.y = p.y;
  if (panning) { panX = panning.px + e.clientX - panning.sx; panY = panning.py + e.clientY - panning.sy; requestView(); return; }
  if (compare?.drag) { compare.pos = clamp(p.x / doc.w, 0, 1); requestView(); return; }
  if (ft) { if (ftDragging) ftMove(p, e); else overlay.style.cursor = spaceDown ? 'grab' : ftCursor(p); requestOverlay(); return; }
  if (!dragging && (tool === 'move' || e.ctrlKey) && guideCursor(e)) { requestOverlay(); return; }
  if (dragging && Tools[tool].move) {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    (evs.length ? evs : [e]).forEach(ev => Tools[tool].move(toDoc(ev), ev));
  }
  requestOverlay();
});
let guideHover = false;
function guideCursor(e) {
  const gi = hitGuide(e), on = gi >= 0;
  if (on) overlay.style.cursor = doc.guides[gi].o === 'v' ? 'col-resize' : 'row-resize';
  else if (guideHover) updateCursor();
  guideHover = on; return on;
}
const endPointer = e => {
  if (panning) { panning = null; updateCursor(); return; }
  if (compare?.drag) { compare.drag = false; return; }
  if (ftDragging) { ftDragging = false; ftUp(); return; }
  if (dragging) { dragging = false; Tools[tool].up?.(toDoc(e), e); requestRender(); }
};
overlay.addEventListener('pointerup', endPointer);
overlay.addEventListener('pointercancel', endPointer);
overlay.addEventListener('pointerleave', () => { mouse.inside = false; requestOverlay(); });
overlay.addEventListener('contextmenu', e => e.preventDefault());
overlay.addEventListener('dblclick', e => { if (tool === 'pen' && doc?.path) { doc.path.done = true; requestOverlay(); } });
vp.addEventListener('wheel', e => {
  e.preventDefault(); if (!doc) return;
  const r = overlay.getBoundingClientRect();
  if (e.shiftKey) { panX -= e.deltaY; requestView(); return; }
  zoomAt(zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
window.addEventListener('resize', () => requestView());

/* ---------- keyboard ---------- */
const TOOL_KEYS = { v: 'move', m: 'marquee', l: 'lasso', w: 'wand', W: 'quicksel',
 c: 'crop', i: 'eyedropper', j: 'spotheal', J: 'heal', b: 'brush', s: 'clone', e: 'eraser', g: 'fill', G: 'gradient', r: 'smudge', o: 'dodge', p: 'pen', t: 'text', u: 'shape', h: 'hand', z: 'zoom' };
document.addEventListener('keydown', e => {
  if (document.querySelector('.modal')) return;
  if (e.target.matches?.('input,textarea,select')) return;
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (e.key === ' ') { if (!spaceDown) { spaceDown = true; updateCursor(); } e.preventDefault(); return; }
  if (e.key === 'Alt') { e.preventDefault(); return; }
  if (!doc && !(ctrl && (k === 'n' || k === 'o' || k === 'v'))) return;
  if (ft) {   // Free Transform owns Enter / Esc / Ctrl+Z; view keys still work; anything else applies it first
    if (e.key === 'Enter') { e.preventDefault(); ftCommit(); return; }
    if (e.key === 'Escape') { e.preventDefault(); ftCancel(); return; }
    if (ctrl && k === 'z') { e.preventDefault(); ftUndo(); return; }
    if (ctrl && k === 't') { e.preventDefault(); ftCommit(); return; }
    if (e.key.startsWith('Arrow')) { e.preventDefault(); ftPush(); const s = e.shiftKey ? 10 : 1, dx = e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, dy = e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0; ft.q = ft.q.map(p => ({ x: p.x + dx, y: p.y + dy })); ftApply(); requestOverlay(); return; }
    if (['Shift', 'Control', 'Meta'].includes(e.key) || (ctrl && ['0', '1', '=', '+', '-'].includes(k))) { /* fall through to view keys */ }
    else ftCommit();
  }
  if (ctrl) {
    if (k === 'v') {
      if (clip && !clip.external) { e.preventDefault(); pasteClip(); }
      else { pasteHandled = false; setTimeout(() => { if (!pasteHandled) readSystemClipboard(); }, 150); }
      return;
    }
    const map = {
      z: e.shiftKey ? redo : undo, y: redo, n: e.shiftKey ? newLayerCmd : newDialog, o: () => openFile('open'),
      s: e.altKey ? (e.shiftKey ? exportSizesDialog : exportDialog) : () => saveProject(e.shiftKey), a: selectAllCmd, d: deselectCmd, i: e.shiftKey ? invertSelCmd : () => runFilter('Invert'),
      c: () => copySel(e.shiftKey), x: cutSel, j: layerViaCopy, e: e.shiftKey ? mergeVisible : mergeDown, t: e.altKey ? transformDialog : () => freeTransform(),
      g: e.shiftKey ? ungroup : groupLayers, r: toggleRulers, ';': e.shiftKey ? toggleSnap : toggleGuides, ':': toggleSnap,
      l: () => runFilter('Levels…'), m: () => runFilter('Curves…'), u: () => runFilter('Hue/Saturation…'), b: () => runFilter('Color Balance…'),
      '0': fit, '1': actualPixels, '=': () => zoomCenter(1.25), '+': () => zoomCenter(1.25), '-': () => zoomCenter(0.8),
      ']': () => moveLayer(1), '[': () => moveLayer(-1), backspace: () => fillSel(bg), '\\': () => { if (layer().mask) { doc.editMask = !doc.editMask; updatePanels(); } },
      enter: () => pathToSelection(e.shiftKey ? 'add' : 'new')
    };
    const f = map[k]; if (f) { e.preventDefault(); f(); }
    return;
  }
  if (e.key === 'F5' && e.shiftKey) { e.preventDefault(); contentAwareFill(); return; }
  if (e.altKey && e.key === 'Backspace') { e.preventDefault(); fillSel(fg); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (tool === 'pen' && doc.path) { doc.path.pts.pop(); if (!doc.path.pts.length) doc.path = null; requestOverlay(); return; }
    clearSel(); return;
  }
  if (e.key === 'Enter') { if (tool === 'crop') applyCrop(); else if (tool === 'pen') pathToSelection(); return; }
  if (k === 'y') { toggleCompare(); return; }
  if (e.key === 'Escape') { if (compare) return stopCompare(); if (tool === 'crop') cancelCrop(); else if (tool === 'pen' && doc.path) { doc.path.done = true; requestOverlay(); } return; }
  if (e.key === '[' || e.key === ']') { opts.size = clamp(Math.round(opts.size * (e.key === ']' ? 1.15 : 1 / 1.15)) + (e.key === ']' ? 1 : 0), 1, 1000); buildOptions(); requestOverlay(); return; }
  if (e.key.startsWith('Arrow') && tool === 'move') {
    e.preventDefault(); const s = e.shiftKey ? 10 : 1, T = Tools.move;
    if (!T.nudge) { T.down({ x: 0, y: 0 }); T.nudge = { x: 0, y: 0 }; }
    T.nudge.x += e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0;
    T.nudge.y += e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0;
    T.apply(T.nudge.x, T.nudge.y);
    clearTimeout(T.nt); T.nt = setTimeout(() => { T.up(); T.nudge = null; }, 400);
    return;
  }
  if (/^[0-9]$/.test(e.key) && ['brush', 'eraser', 'clone', 'fill', 'gradient', 'shape'].includes(tool)) { opts.opacity = e.key === '0' ? 1 : +e.key / 10; buildOptions(); return; }
  if (k === 'x') { swapColors(); return; }
  if (k === 'd') { fg = '#000000'; bg = '#ffffff'; updateSwatches(); return; }
  const t = TOOL_KEYS[e.key] || TOOL_KEYS[k]; if (t) setTool(t);
});
document.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; updateCursor(); } });
window.addEventListener('blur', () => { spaceDown = false; if (clip) clip.external = true; updateCursor(); });
document.addEventListener('paste', async e => {
  pasteHandled = true;
  if (e.target.matches?.('input,textarea') || document.querySelector('.modal')) return;
  const it = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (clip && !clip.external) { e.preventDefault(); pasteClip(); return; }
  if (it) { e.preventDefault(); const img = await loadImg(URL.createObjectURL(it.getAsFile())); const c = mk(img.width, img.height); cx(c).drawImage(img, 0, 0); pasteCanvas(c, null, null, 'Pasted'); }
  else if (clip) pasteClip();
});
vp.addEventListener('dragover', e => { e.preventDefault(); vp.classList.add('drag'); });
vp.addEventListener('dragleave', () => vp.classList.remove('drag'));
vp.addEventListener('drop', e => { e.preventDefault(); vp.classList.remove('drag'); [...e.dataTransfer.files].forEach((f, i) => handleFile(f, doc || i ? 'place' : 'open')); });

/* ---------- dialog ---------- */
function showDialog({ title, fields = [], ok = 'OK', onChange, onOK, onCancel, html, noCancel, onInput, onMount, side }) {
  const ov = document.createElement('div'); ov.className = 'modal' + (side ? ' side' : '');
  const box = document.createElement('div'); box.className = 'box'; ov.appendChild(box);
  box.innerHTML = `<h3>${title}</h3>`;
  const v = {}, inputs = {}; let closed = false, pending = false;
  const set = (key, val) => { const i = inputs[key]; if (!i) { v[key] = val; return; } if (i.type === 'checkbox') i.checked = !!val; else i.value = val; i._read(); };
  const fire = () => { if (!onChange || pending) return; pending = true; requestAnimationFrame(() => { pending = false; if (!closed) onChange({ ...v }); }); };
  fields.forEach(f => {
    v[f.key] = f.value;
    if (f.type === 'hidden') return;
    const row = document.createElement('div'); row.className = 'row';
    const lab = document.createElement('label'); lab.textContent = f.label; row.appendChild(lab);
    if (f.swatch) { const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = f.swatch; lab.prepend(sw); }
    let inp;
    if (f.type === 'select') { inp = document.createElement('select'); f.options.forEach(o => { const [val, txt] = Array.isArray(o) ? o : [o, o]; inp.add(new Option(txt, val)); }); inp.value = f.value; }
    else if (f.type === 'textarea') { inp = document.createElement('textarea'); inp.rows = f.mono ? 9 : 3; inp.value = f.value; if (f.mono) { inp.className = 'code'; inp.spellcheck = false; row.classList.add('wide'); } }
    else { inp = document.createElement('input'); inp.type = f.type || 'number'; ['min', 'max', 'step'].forEach(a => f[a] != null && (inp[a] = f[a])); if (f.type === 'checkbox') inp.checked = !!f.value; else inp.value = f.value; }
    if (f.type === 'checkbox' || f.type === 'color') inp.style.justifySelf = 'start';
    row.appendChild(inp);
    const out = document.createElement('span'); out.className = 'val'; row.appendChild(out);
    const read = () => {
      let x = f.type === 'checkbox' ? inp.checked : (f.type === 'range' || f.type === 'number' || !f.type) ? parseFloat(inp.value) : inp.value;
      if (typeof x === 'number' && Number.isNaN(x)) x = f.value;
      v[f.key] = x; if (f.type === 'range') out.textContent = f.fmt ? f.fmt(x) : x;
    };
    inp._read = read; inputs[f.key] = inp;
    read(); inp.addEventListener('input', () => { read(); onInput?.(f.key, v, set); fire(); }); inp.addEventListener('change', () => { read(); fire(); });
    box.appendChild(row);
  });
  if (html) box.insertAdjacentHTML('beforeend', html);
  const btns = document.createElement('div'); btns.className = 'btns';
  btns.innerHTML = (noCancel ? '' : '<button class="b" data-a="c">Cancel</button>') + `<button class="b pri" data-a="o">${ok}</button>`;
  box.appendChild(btns);
  const close = () => { closed = true; ov.remove(); document.removeEventListener('keydown', kh, true); };
  const okf = () => { close(); onOK && onOK({ ...v }); };
  const cancel = () => { close(); onCancel && onCancel(); };
  const kh = e => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); noCancel ? okf() : cancel(); }
    else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); e.stopPropagation(); okf(); }
  };
  btns.addEventListener('click', e => { const a = e.target.dataset.a; if (a === 'o') okf(); else if (a === 'c') cancel(); });
  document.addEventListener('keydown', kh, true);
  document.body.appendChild(ov);
  onMount?.(box, (key, val) => { set(key, val); fire(); });
  const first = box.querySelector('textarea:not(.code),input[type=text],input[type=number]'); if (first) { first.focus(); first.select?.(); }
  if (onChange) onChange({ ...v });
}
function showShortcuts() {
  const K = [['New / Open', 'Ctrl+N / Ctrl+O'], ['Save / Save As', 'Ctrl+S / Ctrl+Shift+S'], ['Export (PNG, JPEG, WebP, PSD)', 'Ctrl+Alt+S'], ['Export Multiple Sizes (ZIP)', 'Ctrl+Alt+Shift+S'], ['Undo / Redo', 'Ctrl+Z / Ctrl+Shift+Z'], ['Copy / Copy merged', 'Ctrl+C / Ctrl+Shift+C'], ['Cut / Paste', 'Ctrl+X / Ctrl+V'], ['Select all / Deselect', 'Ctrl+A / Ctrl+D'], ['Inverse selection', 'Ctrl+Shift+I'], ['Clear / Fill fg / Fill bg', 'Del / Alt+⌫ / Ctrl+⌫'], ['Content-Aware Fill', 'Shift+F5'], ['Layer via copy', 'Ctrl+J'], ['Merge down / visible', 'Ctrl+E / Ctrl+Shift+E'], ['New layer', 'Ctrl+Shift+N'], ['Free Transform (Enter apply · Esc cancel)', 'Ctrl+T'], ['  scale proportional / from center', 'Shift / Alt + drag handle'], ['  rotate (15° steps with Shift)', 'drag outside the box'], ['  skew / distort', 'Ctrl + drag side / corner'], ['  perspective', 'Ctrl+Alt+Shift + drag corner'], ['Numeric transform', 'Ctrl+Alt+T'], ['Group / ungroup layers', 'Ctrl+G / Ctrl+Shift+G'], ['Layer Style', 'double-click layer · fx'], ['Rulers', 'Ctrl+R'], ['Show guides / snap', 'Ctrl+; / Ctrl+Shift+;'], ['Move a guide', 'Move tool or Ctrl + drag'], ['Quick Selection', 'Shift+W'], ['Edit mask ↔ pixels', 'Ctrl+\\'], ['Levels / Curves / Hue-Sat / Balance', 'Ctrl+L / M / U / B'], ['Path → selection', 'Enter (Pen) · Ctrl+Enter'], ['Fit / 100%', 'Ctrl+0 / Ctrl+1'], ['Zoom', 'Wheel, Ctrl+= / Ctrl+-'], ['Pan', 'Space+drag, middle drag'], ['Brush size', '[ / ]'], ['Opacity 10–100%', '1 … 0'], ['Swap / default colors', 'X / D'], ['Pick color while painting', 'Alt+click'], ['Add / subtract selection', 'Shift / Alt + drag'], ['Straight line', 'Shift+click'], ['Move · Marquee · Lasso · Wand', 'V · M · L · W'], ['Crop · Eyedropper', 'C · I'], ['Spot heal · Healing brush', 'J · Shift+J'], ['Clone · Brush · Eraser', 'S · B · E'], ['Bucket · Gradient', 'G · Shift+G'], ['Smudge · Dodge/Burn', 'R · O'], ['Pen · Text · Shape', 'P · T · U'], ['Hand · Zoom', 'H · Z'], ['Compare before/after', 'Y'], ['Jump to any history branch', 'click in History']];
  showDialog({ title: 'Keyboard Shortcuts', ok: 'Close', noCancel: true, html: '<div class="keys">' + K.map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('') + '</div>' });
}

/* ---------- menus ---------- */
const need = fn => () => { if (!doc) return toast('Create or open an image first'); if (ft) ftCommit(); fn(); };
const selectAllCmd = () => { selectAll(); recordStep({ type: 'selectAll' }); };
const deselectCmd = () => { deselect(); recordStep({ type: 'deselect' }); };
const invertSelCmd = () => { invertSel(); recordStep({ type: 'invertSel' }); };
const chk = (on, label) => (on ? '✓ ' : '  ') + label;
const F = n => need(() => runFilter(n));
const A = n => need(() => addAdjustmentLayer(n));
const SUB = (label, items) => [label, '', null, items];
const MENUS = {
  File: [['New…', 'Ctrl+N', newDialog], ['Open…', 'Ctrl+O', () => openFile('open')], ['Open Sample', '', () => { if (ft) ftCommit(); openSample(); }], ['Place as Layer…', '', need(placeFile)], '-', ['Save', 'Ctrl+S', need(() => saveProject(false))], ['Save As…', 'Ctrl+Shift+S', need(() => saveProject(true))], ['Export…', 'Ctrl+Alt+S', need(exportDialog)], ['Export Multiple Sizes…', 'Ctrl+Alt+Shift+S', need(exportSizesDialog)], ['Export Time-lapse Video…', '', need(exportTimelapse)], '-',
    SUB('Automate', [['Actions Panel', '', showActionsTab], ['Play Selected Action', '', need(() => playAction())], ['Batch…', '', batchDialog], '-', ['Import Actions…', '', importActions], ['Export Actions…', '', exportActions]]), '-',
    [() => chk(saveHistoryPref, 'Keep History in Saved Projects'), '', toggleSaveHistory]],
  Edit: [['Undo', 'Ctrl+Z', need(undo)], ['Redo', 'Ctrl+Shift+Z', need(redo)], '-', ['Cut', 'Ctrl+X', need(cutSel)], ['Copy', 'Ctrl+C', need(() => copySel(false))], ['Copy Merged', 'Ctrl+Shift+C', need(() => copySel(true))], ['Paste', 'Ctrl+V', readSystemClipboard], ['Clear', 'Del', need(clearSel)], '-', ['Content-Aware Fill', 'Shift+F5', need(contentAwareFill)], ['Fill with Foreground', 'Alt+⌫', need(() => fillSel(fg))], ['Fill with Background', 'Ctrl+⌫', need(() => fillSel(bg))], ['Stroke Selection…', '', need(strokeSel)], '-',
    ['Free Transform', 'Ctrl+T', need(() => freeTransform())],
    SUB('Transform', [['Scale', '', need(() => freeTransform('free'))], ['Rotate', '', need(() => freeTransform('rotate'))], ['Skew', '', need(() => freeTransform('skew'))], ['Distort', '', need(() => freeTransform('distort'))], ['Perspective', '', need(() => freeTransform('perspective'))], '-', ['Numeric Transform…', 'Ctrl+Alt+T', need(transformDialog)]]), '-',
    ['Gradient Editor…', '', gradientEditorDialog]],
  Image: ['#Adjustments (destructive)', ...['Brightness/Contrast…', 'Levels…', 'Curves…', 'Hue/Saturation…', 'Color Balance…', 'Vibrance…', 'Photo Filter…', 'Gradient Map…', 'Recolor (Palette)…', 'Formula…', 'Auto Contrast', 'Black & White', 'Sepia', 'Invert', 'Threshold…', 'Posterize…'].map(n => [n, { 'Levels…': 'Ctrl+L', 'Curves…': 'Ctrl+M', 'Hue/Saturation…': 'Ctrl+U', 'Color Balance…': 'Ctrl+B', 'Invert': 'Ctrl+I' }[n] || '', F(n)]),
    '-', ['Image Size…', '', need(imageSizeDialog)], ['Canvas Size…', '', need(canvasSizeDialog)], ['Reveal All', '', need(revealAll)], '-', ['Rotate 90° Clockwise', '', need(() => rotateCanvas(90))], ['Rotate 90° Counter-clockwise', '', need(() => rotateCanvas(-90))], ['Rotate 180°', '', need(() => rotateCanvas(180))], ['Flip Canvas Horizontal', '', need(() => flipCanvas(true))], ['Flip Canvas Vertical', '', need(() => flipCanvas(false))], '-', ['Crop to Selection', '', need(cropToSelection)], ['Trim Transparent Pixels', '', need(trimTransparent)]],
  Layer: [['New Layer', 'Ctrl+Shift+N', need(newLayerCmd)], ['New Group', '', need(newGroup)], ['Duplicate Layer', '', need(dupLayer)], ['Layer via Copy', 'Ctrl+J', need(layerViaCopy)], ['Delete Layer', '', need(deleteLayer)], ['Rename Layer…', '', need(renameLayer)], '-',
    SUB('New Adjustment Layer', ADJ_KINDS.map(n => [plainName(n), '', A(n)])),
    SUB('Layer Mask', [['Reveal All', '', need(() => addMask('reveal'))], ['Hide All', '', need(() => addMask('hide'))], ['Reveal Selection', '', need(() => addMask('sel'))], ['Hide Selection', '', need(() => addMask('hidesel'))], ['From Transparency', '', need(maskFromAlpha)], '-', ['Edit Mask / Pixels', 'Ctrl+\\', need(() => { if (layer().mask) { doc.editMask = !doc.editMask; updatePanels(); } })], ['Disable / Enable Mask', 'Shift+click', need(toggleMask)], ['Invert Mask', '', need(invertMask)], ['Apply Mask', '', need(applyMaskCmd)], ['Delete Mask', '', need(deleteMask)]]),
    SUB('Layer Style', [['Layer Style…', 'dbl-click', need(() => layerStyleDialog())], '-', ...STYLE_KEYS.map(k => [STYLE_NAMES[k] + '…', '', need(() => layerStyleDialog(layer(), k))]), '-', ['Copy Layer Style', '', need(copyStyle)], ['Paste Layer Style', '', need(pasteStyle)], ['Clear Layer Style', '', need(clearStyle)], ['Rasterize Layer Style', '', need(rasterizeStyleCmd)]]),
    '-', ['Group Layers', 'Ctrl+G', need(groupLayers)], ['Ungroup Layers', 'Ctrl+Shift+G', need(ungroup)], '-',
    ['Edit Text / Adjustment…', '', need(() => editLayerContent())], ['Rasterize Text', '', need(rasterizeCmd)], '-',
    ['Bring Forward', 'Ctrl+]', need(() => moveLayer(1))], ['Send Backward', 'Ctrl+[', need(() => moveLayer(-1))], ['Flip Layer Horizontal', '', need(() => flipLayer(true))], ['Flip Layer Vertical', '', need(() => flipLayer(false))], '-',
    [() => doc && layer()?.type === 'group' ? 'Merge Group' : 'Merge Down', 'Ctrl+E', need(mergeDown)], ['Merge Visible', 'Ctrl+Shift+E', need(mergeVisible)], ['Flatten Image', '', need(flatten)]],
  Select: [['All', 'Ctrl+A', need(selectAllCmd)], ['Deselect', 'Ctrl+D', need(deselectCmd)], ['Inverse', 'Ctrl+Shift+I', need(invertSelCmd)], ['Layer Pixels', '', need(selectLayerPixels)], ['From Pen Path', 'Ctrl+Enter', need(() => pathToSelection())], '-', ['Color Range…', '', need(colorRangeDialog)], ['Refine Edge…', '', need(refineEdgeDialog)], '-', ['Feather…', '', need(() => modifySel('feather'))], ['Expand…', '', need(() => modifySel('expand'))], ['Contract…', '', need(() => modifySel('contract'))], '-', ['Transform Selection', '', need(() => freeTransform('free', 'selection'))]],
  Filter: ['#Blur', ...['Gaussian Blur…', 'Motion Blur…'].map(n => [n, '', F(n)]), '#Sharpen', ...['Sharpen', 'Unsharp Mask…'].map(n => [n, '', F(n)]), '#Stylize', ...['Add Noise…', 'Pixelate…', 'Emboss', 'Find Edges', 'Vignette…'].map(n => [n, '', F(n)]), '#Glitch', ...['Pixel Sort…', 'RGB Split…', 'Glitch Slices…'].map(n => [n, '', F(n)]), '#Retouch', ['Frequency Separation…', '', need(frequencySeparation)], '#Code', ['Formula…', '', F('Formula…')]],
  View: [['Compare with Original', 'Y', need(toggleCompare)], '-', ['Zoom In', 'Ctrl+=', need(() => zoomCenter(1.25))], ['Zoom Out', 'Ctrl+-', need(() => zoomCenter(0.8))], ['Fit on Screen', 'Ctrl+0', need(fit)], ['Actual Pixels', 'Ctrl+1', need(actualPixels)], '-',
    [() => chk(view2.rulers, 'Rulers'), 'Ctrl+R', toggleRulers], [() => chk(view2.guides, 'Guides'), 'Ctrl+;', toggleGuides], [() => chk(view2.snap, 'Snap'), 'Ctrl+Shift+;', toggleSnap], [() => chk(view2.lockGuides, 'Lock Guides'), '', toggleLockGuides], ['New Guide…', '', need(newGuideDialog)], ['Clear Guides', '', need(clearGuides)]],
  Help: [['Keyboard Shortcuts', '', showShortcuts], ['About Lumen Photo', '', () => showDialog({ title: 'Lumen Photo', noCancel: true, html: '<p style="line-height:1.6;margin:0">A layered image editor.<br>Positioned layers · groups · masks · adjustment layers · layer styles · editable text · free transform with perspective · healing &amp; content-aware fill · frequency separation · Linear Light &amp; other pro blend modes · multi-stop gradient maps · export multiple sizes · quick selection &amp; refine edge · pen paths · actions &amp; batch · PSD and camera RAW.</p>' })]]
};
function buildMenuItems(dd, items) {
  items.forEach(it => {
    if (it === '-') { dd.insertAdjacentHTML('beforeend', '<div class="sep"></div>'); return; }
    if (typeof it === 'string' && it[0] === '#') { dd.insertAdjacentHTML('beforeend', `<div class="mhead">${it.slice(1)}</div>`); return; }
    const [label, key, fn, sub] = it, el = document.createElement('div'); el.className = 'item' + (sub ? ' sub' : '');
    el.innerHTML = `<span class="lb"></span><span class="k">${sub ? '▸' : key}</span>`;
    el._label = label; el.querySelector('.lb').textContent = typeof label === 'function' ? '' : label;
    if (sub) { const d2 = document.createElement('div'); d2.className = 'dropdown'; buildMenuItems(d2, sub); el.appendChild(d2); el.addEventListener('click', e => e.stopPropagation()); }
    else el.addEventListener('click', e => { e.stopPropagation(); closeMenus(); fn(); });
    dd.appendChild(el);
  });
}
function refreshMenuLabels(m) { m.querySelectorAll('.item').forEach(el => { if (typeof el._label === 'function') { try { el.querySelector('.lb').textContent = el._label(); } catch (e) { } } }); }
function buildMenus() {
  const bar = $('#menubar');
  Object.entries(MENUS).forEach(([name, items]) => {
    const m = document.createElement('div'); m.className = 'menu'; m.textContent = name;
    const dd = document.createElement('div'); dd.className = 'dropdown';
    buildMenuItems(dd, items);
    m.appendChild(dd);
    m.addEventListener('click', e => { e.stopPropagation(); const was = m.classList.contains('open'); closeMenus(); if (!was) { refreshMenuLabels(m); m.classList.add('open'); } });
    m.addEventListener('mouseenter', () => { if (document.querySelector('.menu.open') && !m.classList.contains('open')) { closeMenus(); refreshMenuLabels(m); m.classList.add('open'); } });
    bar.appendChild(m);
  });
  document.addEventListener('click', closeMenus);
}
function closeMenus() { document.querySelectorAll('.menu.open').forEach(m => m.classList.remove('open')); }

/* ---------- toolbar & options ---------- */
const BANDAGE = '<rect x="2" y="8.5" width="20" height="7" rx="3.5" transform="rotate(-45 12 12)"/><path d="M10.5 10.5h.01M13.5 13.5h.01M10.5 13.5h.01M13.5 10.5h.01"/>';
const ICONS = {
  move: '<path d="M12 2v20M2 12h20M12 2 9 5M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>',
  marquee: '<rect x="4" y="5" width="16" height="14" stroke-dasharray="3 2.4"/>',
  lasso: '<ellipse cx="13" cy="9" rx="8" ry="5" stroke-dasharray="3 2.2"/><path d="M7 13c-2 2-1 4 1 4s2 2 0 4"/>',
  wand: '<path d="M4 20 15 9M15 3v2.5M15 12.5V15M9 9H11.5M18.5 9H21M19 5l-1.6 1.6M19 13l-1.6-1.6"/>',
  quicksel: '<circle cx="14" cy="10" r="6.5" stroke-dasharray="2.6 2"/><path d="M9.5 14.5 3.5 20.5M11.5 12.5l-2 2"/><path d="M14 7.5v5M11.5 10h5" stroke-width="1.3"/>',
  crop: '<path d="M6 2v16h16M2 6h16v16"/>',
  eyedropper: '<path d="M14.5 4.5a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3L17 12l-5-5zM12 7l-7.5 7.5L4 20l5.5-.5L17 12"/>',
  spotheal: BANDAGE + '<path d="M19 2v3M17.5 3.5h3" stroke-width="1.4"/>',
  heal: BANDAGE,
  brush: '<path d="M19.5 3.5a2 2 0 0 1 1 3L13 14l-3-3 7.5-7.5a2 2 0 0 1 2 0zM10 11c-3 0-5 2-5 4.5 0 2-1.2 3.3-2.5 4 4.5.5 10-1 10.5-5.5z"/>',
  clone: '<path d="M9 3h6v5l-1.5 3h4.5v4H6v-4h4.5L9 8zM5 18h14v3H5z"/>',
  eraser: '<path d="M15.5 3.5 21 9 11 19H6l-3.5-3.5zM8.5 10.5l5.5 5.5M11 19h10"/>',
  fill: '<path d="M4.5 11 12 3.5l8 8-7.5 7.5zM4.5 11h15.5M20 15.5s2 2.7 2 4a2 2 0 0 1-4 0c0-1.3 2-4 2-4z"/>',
  gradient: '<rect x="3.5" y="3.5" width="17" height="17" rx="1.5"/><path d="M8 3.5v17M12 3.5v17M16 3.5v17" stroke-dasharray="1.5 2"/>',
  smudge: '<path d="M10 21v-8.5a1.6 1.6 0 0 1 3.2 0V8a1.6 1.6 0 0 1 3.2 0v8.5"/><path d="M16.4 13a1.6 1.6 0 0 1 3.2 0v3a5 5 0 0 1-5 5H13"/><path d="M3 7c2-1.5 3.5 1 5.5 0" />',
  dodge: '<circle cx="9" cy="9" r="5.5"/><path d="M13 13l8 8"/>',
  pen: '<path d="M12 2.5 5.5 12l2 6.5h9l2-6.5z"/><circle cx="12" cy="12" r="1.6"/><path d="M12 2.5v7.9M7.5 21.5h9"/>',
  text: '<path d="M5 5h14M12 5v15M9 20h6"/>',
  shape: '<rect x="3" y="3" width="11" height="11" rx="1"/><circle cx="15.5" cy="15.5" r="5.5"/>',
  hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4a1.5 1.5 0 0 1 3 0v6M14 10V5.5a1.5 1.5 0 0 1 3 0V12M17 9.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-6-3.3l-2.8-4.6A1.5 1.5 0 0 1 5.6 12.4L8 15"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21M8 10.5h5M10.5 8v5"/>'
};
const TOOL_LIST = [['move', 'Move (V)'], ['marquee', 'Marquee Select (M)'], ['lasso', 'Lasso (L)'], ['wand', 'Magic Wand (W)'], ['quicksel', 'Quick Selection (Shift+W)'], ['crop', 'Crop (C)'], ['eyedropper', 'Eyedropper (I)'], null,
  ['spotheal', 'Spot Healing Brush (J)'], ['heal', 'Healing Brush (Shift+J)'], ['clone', 'Clone Stamp (S)'], ['brush', 'Brush (B)'], ['eraser', 'Eraser (E)'], ['fill', 'Paint Bucket (G)'], ['gradient', 'Gradient (Shift+G)'], ['smudge', 'Smudge (R)'], ['dodge', 'Dodge / Burn / Sponge (O)'], null,
  ['pen', 'Pen (P)'], ['text', 'Text (T)'], ['shape', 'Shape (U)'], null, ['hand', 'Hand (H) · or hold Space'], ['zoom', 'Zoom (Z) · Alt to zoom out']];
const TOOL_NAMES = Object.fromEntries(TOOL_LIST.filter(Boolean).map(([k, t]) => [k, t.replace(/ \(.*/, '')]));
function buildTools() {
  const box = $('#tools');
  TOOL_LIST.forEach(t => {
    if (!t) { box.insertAdjacentHTML('beforeend', '<div class="tsep"></div>'); return; }
    const b = document.createElement('button'); b.className = 'tool'; b.dataset.tool = t[0]; b.title = t[1];
    b.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[t[0]]}</svg>`; b.onclick = () => setTool(t[0]); box.appendChild(b);
  });
}
function setTool(t) {
  if (dragging) return;
  if (ft) ftCommit();
  if (tool === 'crop' && t !== 'crop') cancelCrop();
  tool = t; document.querySelectorAll('.tool').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  buildOptions(); updateCursor(); requestOverlay();
}
function updateCursor() {
  overlay.style.cursor = compare ? 'col-resize' : panning ? 'grabbing' : spaceDown || tool === 'hand' ? 'grab' : ft ? 'default' :
    BRUSH_TOOLS.includes(tool) ? 'none' : tool === 'zoom' ? 'zoom-in' : tool === 'move' ? 'move' : tool === 'text' ? 'text' : tool === 'pen' ? 'default' : 'crosshair';
}
function optRange(label, key, min, max, step, fmt) {
  const l = document.createElement('label'), i = document.createElement('input'), s = document.createElement('span');
  i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = opts[key]; s.className = 'v';
  const show = () => s.textContent = fmt ? fmt(opts[key]) : opts[key];
  i.oninput = () => { opts[key] = +i.value; show(); requestOverlay(); }; show();
  l.append(label, i, s); return l;
}
function optCheck(label, key) { const l = document.createElement('label'), i = document.createElement('input'); i.type = 'checkbox'; i.checked = opts[key]; i.onchange = () => opts[key] = i.checked; l.append(i, label); return l; }
function optSelect(label, key, options, after) {
  const l = document.createElement('label'), s = document.createElement('select');
  options.forEach(([v, t]) => s.add(new Option(t, v))); s.value = opts[key]; s.onchange = () => { opts[key] = s.value; after?.(); }; l.append(label, s); return l;
}
function gradPreviewBtn() {
  const cv = mk(96, 18); cv.className = 'gradbtn'; cv.title = 'Click to edit the gradient (multiple color & opacity stops)';
  drawStopsPreview(cv, toolStops()); cv.onclick = () => gradientEditorDialog(); return cv;
}
/* brush presets: built-ins + user presets (saved per user) */
const BUILTIN_BRUSHES = [['Soft round 60', 60, 0, 1], ['Hard round 12', 12, 1, 1], ['Airbrush 120', 120, 0, 0.15], ['Pencil 2', 2, 1, 1], ['Marker 24', 24, 0.9, 0.7], ['Soft round 200', 200, 0, 0.6]].map(([name, size, hardness, opacity]) => ({ name, size, hardness, opacity, builtin: true }));
let userBrushes = [];
try { const b = JSON.parse(localStorage.getItem('lumen.brushes') || '[]'); if (Array.isArray(b)) userBrushes = b.filter(o => o && typeof o.name === 'string').slice(0, 60).map(o => ({ name: o.name.slice(0, 40), size: clamp(+o.size || 10, 1, 1000), hardness: clamp(+o.hardness || 0, 0, 1), opacity: clamp(+o.opacity || 1, 0.01, 1) })); } catch (e) { }
function brushPresetPicker() {
  const l = document.createElement('label'), s = document.createElement('select'); s.className = 'bpreset';
  const all = [...BUILTIN_BRUSHES, ...userBrushes];
  s.add(new Option('Presets…', ''));
  all.forEach((b, i) => s.add(new Option(`${b.name}${b.builtin ? '' : ' ★'}`, String(i))));
  s.add(new Option('＋ Save current as preset…', 'save'));
  if (userBrushes.length) s.add(new Option('✕ Delete my presets', 'clear'));
  s.onchange = async () => {
    const v = s.value; s.value = '';
    if (v === 'save') {
      const name = await new Promise(res => showDialog({ title: 'New Brush Preset', fields: [{ key: 'n', label: 'Name', type: 'text', value: `Brush ${opts.size}px` }], onOK: x => res(x.n), onCancel: () => res(null) }));
      if (!name) return; userBrushes.push({ name: String(name).slice(0, 40), size: opts.size, hardness: opts.hardness, opacity: opts.opacity });
    } else if (v === 'clear') userBrushes = [];
    else if (v !== '') { const b = all[+v]; Object.assign(opts, { size: b.size, hardness: b.hardness, opacity: b.opacity }); }
    try { localStorage.setItem('lumen.brushes', JSON.stringify(userBrushes)); } catch (e) { }
    buildOptions(); requestOverlay();
  };
  l.append(s); return l;
}

function optBtn(label, fn) { const b = document.createElement('button'); b.className = 'b'; b.textContent = label; b.onclick = need(fn); return b; }
function hint(t) { const s = document.createElement('span'); s.className = 'hint'; s.textContent = t; return s; }
const P = v => Math.round(v * 100) + '%', PX = v => v + 'px';
function buildOptions() {
  const o = $('#options'); o.innerHTML = '';
  if (ft) { ftOptions(o); return; }
  const nm = document.createElement('span');
 nm.className = 'tname'; nm.textContent = TOOL_NAMES[tool]; o.appendChild(nm);
  const size = () => [optRange('Size', 'size', 1, 500, 1, PX), optRange('Hardness', 'hardness', 0, 1, 0.01, P)];
  const brush = () => [...size(), optRange('Opacity', 'opacity', 0.01, 1, 0.01, P)];
  const sets = {
    brush: () => [brushPresetPicker(), ...brush(), hint('Alt-click picks color · Shift-click draws a straight line')],
    eraser: () => [brushPresetPicker(), ...brush()],
    quicksel: () => [optRange('Size', 'size', 2, 300, 1, PX), optRange('Spread', 'qsTol', 0, 60, 1), optBtn('Refine Edge…', refineEdgeDialog), optBtn('Deselect', deselect), hint('Paint over the object — the selection grows to its edges · Alt subtracts')],

    clone: () => [...brush(), optCheck('Aligned', 'aligned'), optCheck('Sample all layers', 'sampleAll'), hint('Alt-click to set source')],
    heal: () => [...size(), optCheck('Aligned', 'aligned'), optCheck('Sample all layers', 'sampleAll'), hint('Alt-click to set source, then paint over the flaw')],
    spotheal: () => [...size(), hint('Paint over blemishes, dust or small objects — texture is pulled from nearby')],
    smudge: () => [...size(), optRange('Strength', 'strength', 0.05, 0.98, 0.01, P)],
    dodge: () => [...size(), optSelect('Mode', 'dodgeMode', [['dodge', 'Dodge (lighten)'], ['burn', 'Burn (darken)'], ['desat', 'Sponge: desaturate'], ['sat', 'Sponge: saturate']]), optSelect('Range', 'range', [['shadows', 'Shadows'], ['mid', 'Midtones'], ['highlights', 'Highlights']]), optRange('Exposure', 'exposure', 0.05, 1, 0.01, P)],
    fill: () => [optRange('Tolerance', 'tolerance', 0, 255, 1), optCheck('Contiguous', 'contiguous'), optCheck('Sample all layers', 'sampleAll'), optRange('Opacity', 'opacity', 0.01, 1, 0.01, P)],
    wand: () => [optRange('Tolerance', 'tolerance', 0, 255, 1), optCheck('Contiguous', 'contiguous'), optCheck('Sample all layers', 'sampleAll'), hint('Shift add · Alt subtract')],
    marquee: () => [optSelect('Shape', 'marquee', [['rect', 'Rectangle'], ['ellipse', 'Ellipse']]), hint('Shift add · Alt subtract · Shift+Alt intersect')],
    lasso: () => [hint('Drag a freehand outline · Shift add · Alt subtract')],
    move: () => [hint('Drag to move the layer (or only the selected pixels) — nothing is cut off at the canvas edge · arrows nudge')],
    crop: () => [optBtn('✓ Apply', applyCrop), optBtn('✕ Cancel', cancelCrop), optCheck('Delete cropped pixels', 'cropDelete'), hint('Drag a crop box, then press Enter')],
    eyedropper: () => [optCheck('Sample all layers', 'sampleAll'), hint('Click sets foreground · Alt-click sets background')],
    gradient: () => [optSelect('Type', 'grad', [['linear', 'Linear'], ['radial', 'Radial'], ['reflected', 'Reflected'], ['angle', 'Angle']]), optSelect('Colors', 'gradMode', [['fgbg', 'Foreground → Background'], ['fgt', 'Foreground → Transparent'], ['custom', 'Custom gradient']], () => buildOptions()), gradPreviewBtn(), optCheck('Reverse', 'gradReverse'), optRange('Opacity', 'opacity', 0.01, 1, 0.01, P)],

    shape: () => [optSelect('Shape', 'shape', [['rect', 'Rectangle'], ['rounded', 'Rounded rect'], ['ellipse', 'Ellipse'], ['line', 'Line']]), optCheck('Filled', 'shapeFill'), optRange('Stroke', 'strokeW', 1, 100, 1, PX), optRange('Corner', 'radius', 0, 200, 1, PX), optRange('Opacity', 'opacity', 0.01, 1, 0.01, P)],
    pen: () => [optBtn('Make Selection', () => pathToSelection()), optBtn('Fill Path', fillPath), optBtn('Stroke Path', strokePath), optRange('Stroke', 'strokeW', 1, 100, 1, PX), optBtn('Clear', clearPath), hint('Click = corner · drag = curve · click first point to close · Ctrl-drag moves a point · Esc ends')],
    text: () => [hint('Click empty canvas for new text · click existing text to edit it')],
    hand: () => [optBtn('Fit', fit), optBtn('100%', actualPixels)],
    zoom: () => [optBtn('Fit', fit), optBtn('100%', actualPixels), hint('Click to zoom in · Alt-click to zoom out')]
  };
  (sets[tool] || (() => []))().forEach(el => o.appendChild(el));
}

/* ---------- colors ---------- */
function setColor(hex, toBg) { if (toBg) bg = hex; else fg = hex; updateSwatches(); }
function swapColors() { [fg, bg] = [bg, fg]; updateSwatches(); }
function updateSwatches() {
  $('#fgsw').style.background = fg; $('#bgsw').style.background = bg;
  $('#fgin').value = fg; $('#fghex').value = fg.toUpperCase(); $('#fgpick').value = fg; $('#bgpick').value = bg;
}
function buildColors() {
  const pal = ['#000000', '#404040', '#808080', '#bfbfbf', '#ffffff', '#ff3b30', '#ff9500', '#ffcc00', '#34c759', '#00c7be', '#0a84ff', '#5e5ce6',
    '#bf5af2', '#ff2d55', '#8e5a3c', '#f2d0a9', '#7a1f1f', '#c45a00', '#8a7a00', '#1d6b34', '#006a6a', '#003f8a', '#2c2a7a', '#6a2a8a'];
  pal.forEach(c => { const d = document.createElement('div'); d.style.background = c; d.title = c + ' · right-click for background'; d.onclick = () => setColor(c); d.oncontextmenu = e => { e.preventDefault(); setColor(c, true); }; $('#palette').appendChild(d); });
  $('#fgsw').onclick = () => $('#fgpick').click(); $('#bgsw').onclick = () => $('#bgpick').click();
  $('#fgpick').oninput = e => setColor(e.target.value); $('#bgpick').oninput = e => setColor(e.target.value, true);
  $('#fgin').oninput = e => setColor(e.target.value);
  $('#fghex').onchange = e => { const v = e.target.value.trim(); if (/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) setColor(rgbToHex(...hexToRgb(v))); else updateSwatches(); };
  $('#swapc').onclick = swapColors; $('#resetc').onclick = () => { fg = '#000000'; bg = '#ffffff'; updateSwatches(); };
  updateSwatches();
}

/* ---------- panels ---------- */
const EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
function thumb(canvas, L, isMask) {
  const th = document.createElement('canvas'); th.width = 40; th.height = 30;
  const tc = cx(th), s = Math.min(40 / doc.w, 30 / doc.h), ox = (40 - doc.w * s) / 2, oy = (30 - doc.h * s) / 2;
  if (isMask) { tc.fillStyle = '#fff'; tc.fillRect(0, 0, 40, 30); } else { tc.fillStyle = tc.createPattern(checker, 'repeat'); tc.fillRect(0, 0, 40, 30); }
  tc.save(); tc.beginPath(); tc.rect(ox, oy, doc.w * s, doc.h * s); tc.clip();
  tc.drawImage(canvas, ox + L.x * s, oy + L.y * s, canvas.width * s, canvas.height * s); tc.restore();
  return th;
}
const FOLDER = '<svg viewBox="0 0 24 18"><path d="M1.5 3.5a1.5 1.5 0 0 1 1.5-1.5h5.5l2 2.2H21a1.5 1.5 0 0 1 1.5 1.5v9.8A1.5 1.5 0 0 1 21 17H3a1.5 1.5 0 0 1-1.5-1.5z" fill="url(#gGold)" stroke="#8a5a0a"/><path d="M1.5 7h21" stroke="#fff6" /></svg>';
const blendName = b => b === 'pass-through' ? 'Pass Through' : (BLENDS.find(x => x[0] === b) || [, b])[1];
function selectLayerRow(i, mask) { if (ft) ftCommit(); doc.active = i; doc.editMask = !!mask; updatePanels(); }
let layerDrag = null;
function updatePanels() {
  if (!doc) return;
  if (!layer()) doc.active = clamp(doc.active, 0, doc.layers.length - 1);
  if (!layer().mask) doc.editMask = false;
  const box = $('#layers'); box.innerHTML = '';
  const byId = new Map(doc.layers.map(L => [L.id, L]));
  const hiddenByCollapse = L => { for (let p = byId.get(L.parent), g = 0; p && g < 100; p = byId.get(p.parent), g++) if (p.collapsed) return true; return false; };
  for (let i = doc.layers.length - 1; i >= 0; i--) {
    const L = doc.layers[i]; if (hiddenByCollapse(L)) continue;
    const row = document.createElement('div'), on = i === doc.active, depth = depthOf(L), dimmed = L.visible && !effVisible(L);
    row.className = 'layer' + (on ? ' on' : '') + (L.type === 'group' ? ' grp' : '') + (dimmed ? ' dimmed' : '');
    row.style.paddingLeft = (6 + depth * 16) + 'px';
    row.draggable = true; row.dataset.i = i;
    const eye = document.createElement('span'); eye.className = 'eye' + (L.visible ? '' : ' off'); eye.title = 'Toggle visibility'; eye.innerHTML = EYE;
    eye.onclick = e => { e.stopPropagation(); L.visible = !L.visible; pushHistory(L.visible ? 'Show Layer' : 'Hide Layer', 'none'); };
    row.appendChild(eye);
    let pix;
    if (L.type === 'group') {
      const tw = document.createElement('span'); tw.className = 'twisty'; tw.textContent = L.collapsed ? '▸' : '▾'; tw.title = L.collapsed ? 'Expand group' : 'Collapse group';
      tw.onclick = e => { e.stopPropagation(); toggleCollapse(L); };
      row.appendChild(tw);
      pix = document.createElement('div'); pix.className = 'ficon'; pix.innerHTML = FOLDER; pix.title = 'Group — drag layers onto it to put them inside';
    }
    else if (L.type === 'adjust') { pix = document.createElement('div'); pix.className = 'ticon'; pix.textContent = '◐'; pix.title = 'Adjustment layer — double-click to edit'; }
    else if (L.type === 'text') { pix = document.createElement('div'); pix.className = 'ticon'; pix.textContent = 'T'; pix.title = 'Text layer — double-click to edit the text'; }
    else pix = thumb(L.canvas, L, false);
    pix.classList.add('th'); if (on && !doc.editMask) pix.classList.add('tgt');
    pix.onclick = e => { e.stopPropagation(); selectLayerRow(i, false); };
    pix.ondblclick = e => { e.stopPropagation(); doc.active = i; if (L.type === 'text' || L.type === 'adjust') editLayerContent(L); else if (L.type === 'group') toggleCollapse(L); else layerStyleDialog(L); };
    row.appendChild(pix);
    if (L.mask) {
      const mt = thumb(L.mask.canvas, L, true); mt.classList.add('th', 'mth'); if (!L.mask.enabled) mt.classList.add('disabled'); if (on && doc.editMask) mt.classList.add('tgt');
      mt.title = 'Layer mask — click to edit (paint black to hide, white to reveal) · Shift-click to disable';
      mt.onclick = e => { e.stopPropagation(); doc.active = i; if (e.shiftKey) { toggleMask(); return; } selectLayerRow(i, true); };
      row.appendChild(mt);
    }
    const isGrp = L.type === 'group', bm = (isGrp ? L.blend !== 'pass-through' : L.blend !== 'source-over') || L.opacity < 1 ? `<div class="bm">${blendName(L.blend)} · ${Math.round(L.opacity * 100)}%</div>` : '';
    const nm = document.createElement('div'); nm.className = 'ln'; nm.innerHTML = `<div class="lname"></div>${bm}`; nm.querySelector('.lname').textContent = L.name; row.appendChild(nm);
    nm.querySelector('.lname').ondblclick = e => { e.stopPropagation(); doc.active = i; renameLayer(); };
    if (L.style && styleHasEffects(L.style)) {
      const fx = document.createElement('span'); fx.className = 'fxb'; fx.textContent = 'fx'; fx.title = 'Layer style: ' + STYLE_KEYS.filter(k => L.style[k].on).map(k => STYLE_NAMES[k]).join(', ') + ' — click to edit';
      fx.onclick = e => { e.stopPropagation(); doc.active = i; layerStyleDialog(L); };
      row.appendChild(fx);
    }
    row.onclick = () => selectLayerRow(i, false);
    row.ondblclick = () => { doc.active = i; if (L.type === 'adjust') editLayerContent(L); else if (L.type === 'group') toggleCollapse(L); else layerStyleDialog(L); };
    // drag & drop reordering, into and out of groups
    row.ondragstart = e => { if (ft) ftCommit(); layerDrag = { id: L.id }; e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/x-lumen-layer', String(L.id)); } catch (er) { } row.classList.add('dragging'); };
    row.ondragend = () => { layerDrag = null; box.querySelectorAll('.layer').forEach(r => r.classList.remove('dragging', 'drop-above', 'drop-below', 'drop-into')); };
    row.ondragover = e => {
      if (!layerDrag) return; e.preventDefault(); e.stopPropagation();
      const where = dropZone(e, row, L); box.querySelectorAll('.layer').forEach(r => r.classList.remove('drop-above', 'drop-below', 'drop-into'));
      if (where) row.classList.add('drop-' + (where === 'intoTop' ? 'into' : where));
    };
    row.ondrop = e => {
      if (!layerDrag) return; e.preventDefault(); e.stopPropagation();
      const where = dropZone(e, row, L), from = doc.layers.findIndex(x => x.id === layerDrag.id); layerDrag = null;
      if (from < 0 || !where || doc.layers[from] === L) return updatePanels();
      if (moveBlock(from, L.id, where)) pushHistory('Move Layer', 'none'); else updatePanels();
    };
    box.appendChild(row);
  }
  box.ondragover = e => { if (layerDrag) e.preventDefault(); };
  box.ondrop = e => {   // dropped on empty space below the list: move to the very bottom, outside groups
    if (!layerDrag) return; e.preventDefault();
    const from = doc.layers.findIndex(x => x.id === layerDrag.id); layerDrag = null;
    const bottom = doc.layers.find((x, k) => k !== from && !x.parent && !isDescendant(x, doc.layers[from]?.id));
    if (from >= 0 && bottom && moveBlock(from, bottom.id, 'below')) pushHistory('Move Layer', 'none'); else updatePanels();
  };
  const L = layer(), bs = $('#blend'), grp = L.type === 'group';
  if (bs.dataset.grp !== String(grp)) { bs.innerHTML = ''; (grp ? [['pass-through', 'Pass Through'], ...BLENDS] : BLENDS).forEach(([v, t]) => bs.add(new Option(t, v))); bs.dataset.grp = String(grp); }
  bs.value = L.blend; $('#lopacity').value = Math.round(L.opacity * 100); $('#lopv').textContent = Math.round(L.opacity * 100) + '%';
  $('#target').textContent = doc.editMask ? 'Editing: layer mask' : L.type === 'adjust' ? 'Adjustment layer' : L.type === 'text' ? 'Text layer (editable)' : grp ? 'Group — ' + doc.layers.filter(x => isDescendant(x, L.id)).length + ' layer(s) inside' : '';
  renderHistoryPanel();
}
function dropZone(e, row, L) {
  const r = row.getBoundingClientRect(), t = (e.clientY - r.top) / r.height;
  const dragged = layerById(layerDrag?.id); if (!dragged || dragged === L || isDescendant(L, dragged.id)) return null;
  if (L.type === 'group' && t > 0.3 && t < 0.7) return 'intoTop';
  if (t <= 0.5) return 'above';
  return L.type === 'group' && !L.collapsed ? 'intoTop' : 'below';
}
function buildLayerControls() {
  BLENDS.forEach(([v, t]) => $('#blend').add(new Option(t, v)));
  $('#blend').onchange = e => { if (!doc) return; layer().blend = e.target.value; pushHistory('Blend Mode', 'none'); };
  $('#lopacity').oninput = e => { if (!doc) return; layer().opacity = e.target.value / 100; $('#lopv').textContent = e.target.value + '%'; requestRender(); };
  $('#lopacity').onchange = () => { if (doc) pushHistory('Layer Opacity', 'none'); };
  $('#lb-new').onclick = need(newLayerCmd); $('#lb-dup').onclick = need(dupLayer); $('#lb-del').onclick = need(deleteLayer);
  $('#lb-up').onclick = need(() => moveLayer(1)); $('#lb-down').onclick = need(() => moveLayer(-1)); $('#lb-merge').onclick = need(mergeDown);
  $('#lb-mask').onclick = need(() => addMask(selection ? 'sel' : 'reveal'));
  $('#lb-fx').onclick = need(() => layerStyleDialog());
  $('#lb-grp').onclick = need(() => (layer().type === 'group' ? newGroup() : groupLayers()));
  $('#lb-adj').onclick = need(() => {
    showDialog({ title: 'New Adjustment Layer', ok: 'Add', fields: [{ key: 'k', label: 'Type', type: 'select', value: ADJ_KINDS[0], options: ADJ_KINDS.map(k => [k, plainName(k)]) }], onOK: v => addAdjustmentLayer(v.k) });
  });
}
let statusMsg = '';
function setStatusMsg(m) { statusMsg = m; updateStatus(); }
function updateStatus() {
  if (!doc) return;
  $('#st-zoom').textContent = Math.round(zoom * 100) + '%';
  $('#st-size').textContent = `${doc.w} × ${doc.h} px · ${doc.layers.length} layer${doc.layers.length > 1 ? 's' : ''}`;
  $('#st-pos').textContent = mouse.inside ? `x ${Math.floor(mouse.x)}  y ${Math.floor(mouse.y)}` : '';
  $('#st-msg').textContent = statusMsg;
}

/* ---------- boot ---------- */
testL2A();
buildMenus(); buildTools(); buildColors(); buildLayerControls(); buildActionsPanel();

newDocument(1600, 1000, '#ffffff');
window.__lumenDirty = false; updateTitle();
setTool('brush');
