'use strict';
/* Lumen Vector — menus, shortcuts, startup. */
(function () {
  const $ = s => document.querySelector(s);
  const PREF_KEYS = ['rulers', 'grid', 'snapGrid', 'snapPoint', 'smart', 'guides', 'bbox', 'smartAngles', 'angleInc', 'smartSpacing', 'snapTol', 'gridSize', 'gridEvery'];
  const savePrefs = () => { try { localStorage.setItem('lumen-vector-prefs', JSON.stringify(Object.fromEntries(PREF_KEYS.map(k => [k, LV.prefs[k]])))); } catch (e) { } };
  try { const p = JSON.parse(localStorage.getItem('lumen-vector-prefs') || 'null'); if (p && typeof p === 'object') PREF_KEYS.forEach(k => { if (typeof p[k] === typeof LV.prefs[k]) LV.prefs[k] = p[k]; }); } catch (e) { }
  LV.prefsDialog = () => Aero.dialog({
    title: 'Preferences', instruction: 'Smart guides and snapping', width: 440,
    fields: [{ key: 'smart', label: 'Smart guides (align to edges & centers)', type: 'checkbox', value: LV.prefs.smart }, { key: 'smartAngles', label: 'Angle guides', type: 'checkbox', value: LV.prefs.smartAngles }, { key: 'angleInc', label: 'Extra angle increment (°) — 0/45/90 always', type: 'select', value: String(LV.prefs.angleInc), options: ['15', '30', '45', '60', '90'].map(v => [v, v + '°']) }, { key: 'smartSpacing', label: 'Equal spacing guides', type: 'checkbox', value: LV.prefs.smartSpacing }, { key: 'snapPoint', label: 'Snap to point', type: 'checkbox', value: LV.prefs.snapPoint }, { key: 'snapTol', label: 'Snapping tolerance (screen px)', type: 'number', min: 1, max: 30, value: LV.prefs.snapTol }],
    onOK: v => { LV.prefs.smart = v.smart; LV.prefs.smartAngles = v.smartAngles; LV.prefs.angleInc = +v.angleInc || 45; LV.prefs.smartSpacing = v.smartSpacing; LV.prefs.snapPoint = v.snapPoint; LV.prefs.snapTol = Math.min(30, Math.max(1, +v.snapTol || 6)); savePrefs(); LV.redraw(); }
  });
  const tog = (key, label) => () => { LV.prefs[key] = !LV.prefs[key]; savePrefs(); if (key === 'rulers') LV.applyRulerLayout(); LV.redraw(); LV.toast(`${label} ${LV.prefs[key] ? 'on' : 'off'}`); };
  const fontItems = () => LV.FONTS.map(f => ({ label: f.family, fn: () => { const t = LV.sel.filter(LV.isTextLike); if (t.length) { t.forEach(x => LV.setTextStyle(x, { family: f.family })); LV.commit('Font'); } else { LV.text.family = f.family; LV.text.weight = LV.nearestWeight(f.family, LV.text.weight); LV.refreshPanels(); } }, checked: () => { const t = LV.sel.find(LV.isTextLike); return (t ? LV.textStyleOf(t).family : LV.text.family) === f.family; } }));
  const menus = {
    File: [['New…', 'Ctrl+N', () => LV.newDialog()], ['Open…', 'Ctrl+O', () => LV.openDialog()], { label: 'Open Sample', fn: async () => { if (await LV.confirmDiscard()) { hideWelcome(); LV.buildSample(); } } }, '-',
      ['Save', 'Ctrl+S', () => LV.save(false)], ['Save As…', 'Ctrl+Shift+S', () => LV.save(true)], '-',
      ['Place… (SVG or image)', 'Ctrl+Shift+P', () => LV.placeDialog()], '-',
      ['Export SVG…', 'Ctrl+Alt+S', () => LV.exportSVGDialog()], ['Export PNG…', 'Ctrl+Shift+E', () => LV.exportPNGDialog()], ['Export PDF…', 'Ctrl+Alt+P', () => LV.exportPDFDialog()]],
    Edit: [['Undo', 'Ctrl+Z', () => LV.undo()], ['Redo', 'Ctrl+Shift+Z/Ctrl+Y', () => LV.redo()], '-',
      ['Cut', 'Ctrl+X', () => LV.cut()], ['Copy', 'Ctrl+C', () => LV.copy()], ['Paste', 'Ctrl+V', () => LV.paste('center')], ['Paste in Front', 'Ctrl+F', () => LV.paste('front')], ['Paste in Back', 'Ctrl+B', () => LV.paste('back')], ['Paste in Place', 'Ctrl+Shift+V', () => LV.paste('place')],
      ['Duplicate', 'Ctrl+Shift+D', () => LV.duplicate()], ['Delete', 'Delete/Backspace', () => LV.deleteSel()], '-',
      ['Preferences…', 'Ctrl+K', () => LV.prefsDialog()], '-',
      ['Swap Fill & Stroke', 'Shift+X', () => LV.swapFillStroke()], ['Default Fill & Stroke', 'D', () => LV.paintAction('def')]],
    Object: ['#Transform', ['Transform Again', 'Ctrl+D', () => LV.transformAgain()], ['Move…', 'Ctrl+Shift+M', () => LV.moveDialog()], ['Rotate…', '', () => LV.rotateDialog()], ['Reflect…', '', () => LV.reflectDialog()], ['Scale…', '', () => LV.scaleDialog()], ['Flip Horizontal', '', () => LV.flip('h')], ['Flip Vertical', '', () => LV.flip('v')],
      '#Arrange', { label: 'Bring to Front', key: 'Ctrl+Shift+]', fn: () => LV.arrange('front') }, ['Bring Forward', 'Ctrl+]', () => LV.arrange('forward')], ['Send Backward', 'Ctrl+[', () => LV.arrange('backward')], { label: 'Send to Back', key: 'Ctrl+Shift+[', fn: () => LV.arrange('back') },
      '#Group & Lock', ['Group', 'Ctrl+G', () => LV.group()], ['Ungroup', 'Ctrl+Shift+G', () => LV.ungroup()], ['Lock Selection', 'Ctrl+2', () => LV.lockSel()], ['Unlock All', 'Ctrl+Alt+2', () => LV.unlockAll()], ['Hide Selection', 'Ctrl+3', () => LV.hideSel()], ['Show All', 'Ctrl+Alt+3', () => LV.showAll()],
      '#Masks & Compound Paths', ['Make Clipping Mask', 'Ctrl+7', () => LV.makeClip()], ['Release Clipping Mask', 'Ctrl+Alt+7', () => LV.releaseClip()], ['Make Compound Path', 'Ctrl+8', () => LV.makeCompound()], ['Release Compound Path', 'Ctrl+Alt+8', () => LV.releaseCompound()],
      '#Live Shape', ['Expand Shape', '', () => { if (!LV.live.expand(LV.sel)) return LV.toast('Select a live rectangle, polygon or star'); LV.commit('Expand Shape'); }]],
    Path: ['#Pathfinder', ['Unite', '', () => LV.pathfinder('unite')], ['Minus Front', '', () => LV.pathfinder('subtract')], ['Intersect', '', () => LV.pathfinder('intersect')], ['Exclude', '', () => LV.pathfinder('exclude')], ['Divide', '', () => LV.pathfinder('divide')],
      '#Blend', ['Make Blend', 'Ctrl+Alt+B', () => LV.blend.make()], ['Release Blend', 'Ctrl+Alt+Shift+B', () => LV.blend.release()], ['Expand Blend', '', () => LV.blend.expand()], ['Blend Options…', '', () => LV.blend.optionsDialog()], ['Replace Spine', '', () => LV.blend.replaceSpine()], ['Reverse Spine', '', () => LV.blend.reverseSpine()],
      '#Path', ['Join', 'Ctrl+J', () => LV.joinPaths()], ['Offset Path…', '', () => LV.offsetPath()], ['Outline Stroke', '', () => LV.outlineStroke()], ['Simplify…', '', () => LV.simplify()], ['Reverse Path Direction', '', () => LV.reversePath()],
      '#Align', ['Align Left', '', () => LV.align('left')], ['Align Horizontal Center', '', () => LV.align('hcenter')], ['Align Right', '', () => LV.align('right')], ['Align Top', '', () => LV.align('top')], ['Align Vertical Center', '', () => LV.align('vcenter')], ['Align Bottom', '', () => LV.align('bottom')],
      ['Distribute Horizontal Spacing', '', () => LV.distribute('hspace')], ['Distribute Vertical Spacing', '', () => LV.distribute('vspace')],
      { label: 'Align to Artboard', fn: () => { LV.alignTo = LV.alignTo === 'artboard' ? 'selection' : 'artboard'; const s = document.getElementById('alignTo'); if (s) s.value = LV.alignTo; }, checked: () => LV.alignTo === 'artboard' }],
    Type: [['Create Outlines', 'Ctrl+Shift+O', () => LV.createOutlines()], ['Edit Text', '', () => { const t = LV.sel.find(LV.isTextLike); if (t) { if (LV.kind(t) !== 'pathtext') LV.setTool('type'); LV.beginTextEdit(t); } else LV.toast('Select a text object'); }],
      ['Type Tool', '', () => LV.setTool('type')], ['Type on a Path Tool', '', () => LV.setTool('typepath')],
      '#Threaded Text', ['Create (link selected frames)', '', () => LV.threadCreateSel()], ['Thread to New Frame', '', () => LV.threadNewFrame()], ['Release Selection', '', () => LV.threadReleaseSel()], ['Remove Threading', '', () => LV.threadRemoveSel()], '#Font', ...fontItems()],
    Select: [['All', 'Ctrl+A', () => LV.selectAll(false)], ['All on Active Artboard', 'Ctrl+Alt+A', () => LV.selectAll(true)], ['Deselect', 'Ctrl+Shift+A', () => LV.setSel([])], ['Inverse', '', () => LV.selectInverse()], '-',
      ['Same Fill Color', '', () => LV.selectSame('fillColor')], ['Same Stroke Color', '', () => LV.selectSame('strokeColor')]],
    Effect: ['#Appearance', ['Add New Fill', '', () => LV.fx.addExtra('fill')], ['Add New Stroke', '', () => LV.fx.addExtra('stroke')], ['Clear Appearance', '', () => LV.fx.clear()], ['Expand Appearance', '', () => LV.fx.expand()],
      '#Stylize', ['Drop Shadow…', '', () => LV.fx.effectDialog('shadow')], ['Inner Glow…', '', () => LV.fx.effectDialog('innerGlow')], ['Outer Glow…', '', () => LV.fx.effectDialog('outerGlow')], ['Feather…', '', () => LV.fx.effectDialog('feather')],
      '#Blur', ['Gaussian Blur…', '', () => LV.fx.effectDialog('blur')]],
    View: [['Zoom In', 'Ctrl+=', () => LV.zoomAt(1.5)], ['Zoom Out', 'Ctrl+-', () => LV.zoomAt(1 / 1.5)], ['Fit Artboard in Window', 'Ctrl+0', () => LV.fitBoard()], ['Fit All in Window', 'Ctrl+Alt+0', () => LV.fitAll()], ['Actual Size', 'Ctrl+1', () => LV.setZoom(1)], '-',
      { label: 'Rulers', key: 'Ctrl+R', fn: tog('rulers', 'Rulers'), checked: () => LV.prefs.rulers }, { label: 'Grid', key: "Ctrl+'", fn: tog('grid', 'Grid'), checked: () => LV.prefs.grid },
      { label: 'Snap to Grid', fn: tog('snapGrid', 'Snap to grid'), checked: () => LV.prefs.snapGrid }, { label: 'Snap to Point', fn: tog('snapPoint', 'Snap to point'), checked: () => LV.prefs.snapPoint },
      { label: 'Smart Guides', key: 'Ctrl+U', fn: tog('smart', 'Smart guides'), checked: () => LV.prefs.smart }, { label: 'Angle Guides', fn: tog('smartAngles', 'Angle guides'), checked: () => LV.prefs.smartAngles }, { label: 'Equal Spacing Guides', fn: tog('smartSpacing', 'Spacing guides'), checked: () => LV.prefs.smartSpacing }, { label: 'Guides', key: 'Ctrl+;', fn: tog('guides', 'Guides'), checked: () => LV.prefs.guides }, ['Clear Guides', '', () => { LV.doc.guides = { x: [], y: [] }; LV.commit('Clear Guides'); }],
      { label: 'Bounding Box', key: 'Ctrl+Shift+B', fn: tog('bbox', 'Bounding box'), checked: () => LV.prefs.bbox }, '-',
      ['Grid Size…', '', () => Aero.dialog({ title: 'Grid', fields: [{ key: 'g', label: 'Gridline every (px)', type: 'number', value: LV.prefs.gridSize, min: 1 }, { key: 'e', label: 'Major line every', type: 'number', value: LV.prefs.gridEvery, min: 1 }], onOK: v => { if (v.g > 0) LV.prefs.gridSize = v.g; if (v.e >= 1) LV.prefs.gridEvery = Math.round(v.e); LV.redraw(); } })], '#Artboards', ['New Artboard…', '', () => LV.newArtboardDialog()], ['Duplicate Artboard', '', () => LV.duplicateArtboard()], ['Artboard Options…', '', () => LV.artboardOptions()], ['Fit Artboard to Selection / Artwork', '', () => LV.fitArtboardToArt()], ['Delete Artboard', '', () => LV.deleteArtboard()]],
    Window: ['#Panels', ['Properties & Appearance', '', () => document.querySelector('#tabsTop [data-t=props]').click()], ['Align & Pathfinder', '', () => document.querySelector('#tabsTop [data-t=align]').click()], ['Layers', 'F7', () => document.querySelector('#tabsBot [data-t=layers]').click()], ['Artboards', '', () => document.querySelector('#tabsBot [data-t=boards]').click()], ['Symbols', 'Shift+Ctrl+F11', () => document.querySelector('#tabsBot [data-t=syms]').click()], ['History', '', () => document.querySelector('#tabsBot [data-t=hist]').click()],
      '#Image Trace', ['Make', '', () => LV.trace.makeSel(false)], ['Make and Expand', '', () => LV.trace.makeSel(true)], ['Image Trace Options…', '', () => LV.trace.optionsDialog()], ['Expand Tracing', '', () => LV.trace.expandSel()], ['Release Tracing', '', () => LV.trace.releaseSel()],
      '#Symbols', ['New Symbol…', 'F8', () => LV.sym.create()], ['Place Symbol Instance', '', () => LV.sym.place()], ['Edit Symbol', '', () => LV.sym.edit()], ['Break Link to Symbol', '', () => LV.sym.breakLink()]],
    Help: [['Keyboard Shortcuts', 'F1', () => shortcutsDialog()], ['About Lumen Vector', '', () => Aero.dialog({ title: 'About Lumen Vector', noCancel: true, html: `<div style="display:flex;gap:16px;align-items:center;margin:6px 0 4px"><img src="../kit/icons/vector.png" width="64" height="64" alt=""><div><div style="font-size:18px;color:#003399">Lumen Vector</div><div class="dnote">Vector illustration for Lumen Studio — pen &amp; live shapes, Shape Builder, Pathfinder, gradients, Image Trace, symbols, blends, live effects &amp; multiple fills/strokes, type with threading, artboards, SVG/PNG/PDF export.<br>Built on paper.js, opentype.js, jsPDF and svg2pdf.js (MIT). Fonts: Inter, Montserrat, Playfair Display, Lora, Roboto Mono, Bebas Neue, Pacifico (SIL OFL).</div></div></div>` })]]
  };
  function shortcutsDialog() {
    const rows = [['V / A', 'Selection / Direct Selection'], ['P / N', 'Pen / Pencil'], ['T / Shift+T', 'Type / Type on a Path'], ['M / L / \\', 'Rectangle / Ellipse / Line'], ['I / G / W', 'Eyedropper / Gradient / Blend'], ['Shift+M', 'Shape Builder (drag across regions to merge, Alt erases)'], ['Shift+W', 'Width tool (drag a stroke; Alt = one side; Delete removes a point)'], ['Shift+N', 'Shaper (draw rough shapes; scribble to punch out / merge)'], ['Ctrl+K', 'Preferences (smart guides, angle increment, spacing)'], ['C', 'Scissors'], ['Shift+O', 'Artboard tool'], ['H / Z / Space', 'Hand / Zoom / temporary Hand'],
      ['Shift (drag)', 'Constrain proportions / 45° angles'], ['Alt (drag)', 'Duplicate (Selection) · draw from center (shapes) · break handles (Pen)'], ['Arrows / Shift+Arrows', 'Nudge 1 px / 10 px'], ['X / Shift+X / D / /', 'Toggle fill-stroke / swap / default / none'],
      ['Ctrl+G / Ctrl+Shift+G', 'Group / Ungroup'], ['Ctrl+] [ (Shift)', 'Arrange forward / backward (to front / back)'], ['Ctrl+7 / Ctrl+8', 'Clipping mask / Compound path'], ['Ctrl+D', 'Transform again'], ['Ctrl+J', 'Join paths'], ['Ctrl+Shift+O', 'Create outlines'],
      ['Ctrl+F / Ctrl+B', 'Paste in front / back'], ['Ctrl+Alt+B / Ctrl+Alt+Shift+B', 'Make / release blend'], ['F8', 'New symbol from selection'], ['Double-click instance', 'Edit symbol (Esc or Done to finish)'], ['Drag corner widget', 'Round rectangle corners (Alt: one corner)'], ['Click a text frame’s out-port', 'Thread overflow text into a new or existing frame'], ['Ctrl+0 / Ctrl+1', 'Fit artboard / 100%'], ['Ctrl+R / Ctrl+\' / Ctrl+U', 'Rulers / Grid / Smart guides'], ['Ctrl+wheel', 'Zoom at the cursor'], ['Enter', 'Move dialog (Selection) · finish path (Pen)']];
    Aero.dialog({ title: 'Keyboard Shortcuts', noCancel: true, width: 560, html: `<table class="kbd">${rows.map(r => `<tr><td>${Aero.esc(r[0])}</td><td>${Aero.esc(r[1])}</td></tr>`).join('')}</table>` });
  }

  /* ---------- welcome card ---------- */
  function showWelcome() {
    const w = $('#welcome'); w.hidden = false;
    w.innerHTML = `<div class="wcard"><img src="../kit/icons/vector.png" alt=""><h2>Lumen Vector</h2><p>Precise vector illustration — paths, shapes, type and artboards.</p>
      <div class="wbtns"><button class="aero-btn pri" data-w="sample">Open Sample</button><button class="aero-btn" data-w="new">New Document…</button><button class="aero-btn" data-w="open">Open…</button><button class="aero-btn" data-w="blank">Start drawing</button></div>
      <p class="dim">Drop .lvec, .svg or images anywhere to open them.</p></div>`;
    w.onclick = e => { const b = e.target.closest('[data-w]'); if (!b) return; hideWelcome(); ({ sample: () => LV.buildSample(), new: () => LV.newDialog(), open: () => LV.openDialog(), blank: () => { } })[b.dataset.w](); };
  }
  function hideWelcome() { $('#welcome').hidden = true; }
  LV.hideWelcome = hideWelcome;

  /* ---------- startup ---------- */
  Aero.init({
    name: 'Lumen Vector', icon: '../kit/icons/vector.png', doc: 'Untitled-1', menus,
    dropTarget: $('#stage'), dropText: 'Drop .lvec / .svg to open · images and SVG are placed into the document',
    onDropFiles: files => { hideWelcome(); const native = files.some(f => /\.lvec$|\.json$/i.test(f.name)); LV.openFiles(files, { place: !native }); },
    onSave: () => LV.save(false)
  });
  LV.initView(); LV.initPointer(); LV.initToolbox(); LV.initProps(); LV.initAlign(); LV.initSwatches(); LV.initLayers(); LV.initBoards(); LV.initTabs(); LV.initCmd(); LV.initPanels2();
  LV.applyRulerLayout();
  LV.newDoc({ w: 1080, h: 1080, name: 'Untitled-1.lvec' });
  LV.setTool('select');

  // extra shortcuts
  const S = Aero.shortcut;
  S('Ctrl+}', () => LV.arrange('front')); S('Ctrl+{', () => LV.arrange('back'));
  S('X', () => { LV.paint.active = LV.paint.active === 'fill' ? 'stroke' : 'fill'; LV.refreshPanels(); });
  S('Shift+X', () => LV.swapFillStroke()); S('/', () => LV.paintAction('none')); S(',', () => LV.paintAction('color')); S('.', () => LV.paintAction('grad'));
  [['ArrowLeft', -1, 0], ['ArrowRight', 1, 0], ['ArrowUp', 0, -1], ['ArrowDown', 0, 1]].forEach(([k, x, y]) => { S(k, () => LV.nudge(x, y)); S('Shift+' + k, () => LV.nudge(x * 10, y * 10)); });
  S('Enter', () => { if (LV.tool.key?.({ key: 'Enter' })) return; if (LV.toolId === 'select' && LV.sel.length) LV.moveDialog(); });
  S('Escape', () => { if (LV.tool.key?.({ key: 'Escape' })) return; if (LV.threadLoad) { LV.threadLoad = null; LV.redraw(); return; } if (!LV.sel.length && LV.isoRoot()) return LV.sym.finishEdit(); LV.setSel([]); });
  S('Ctrl+Numpad0', () => LV.fitBoard());
  LV.on('history', () => {});

  // fonts, then welcome / sample
  (async () => {
    await LV.loadFonts();
    LV.fontsReady = true;
    if (/[?&]sample\b/.test(location.search)) LV.buildSample(); else showWelcome();
    LV.redraw();
  })();
  window.addEventListener('error', e => console.error('Uncaught', e.message));
})();
