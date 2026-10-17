'use strict';
/* Lumen Motion — menus, toolbox, keyboard shortcuts, text editing, startup. */
(function () {
  const LM = window.LM, F = LM.factory, st = LM.st, esc = Aero.esc, W = LM.w, $ = LM.$;

  /* ---------- text layers ---------- */
  LM.editText = L => {
    const T = L.text;
    Aero.dialog({
      title: 'Edit Text', width: 520,
      fields: [{ key: 'str', label: 'Text', type: 'textarea', value: T.str, rows: 3 }, { key: 'font', label: 'Font', type: 'select', value: T.font, options: LM.FONTS.map(f => [f, f]) }, { key: 'weight', label: 'Weight', type: 'select', value: T.weight, options: [['300', 'Light'], ['400', 'Regular'], ['600', 'Semibold'], ['700', 'Bold'], ['900', 'Black']] }, { key: 'align', label: 'Alignment', type: 'select', value: T.align, options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] }, { key: 'italic', label: 'Italic', type: 'checkbox', value: !!T.italic }],
      onOK: v => { if (!v.str.trim()) return; T.str = v.str; T.font = v.font; T.weight = v.weight; T.align = v.align; T.italic = v.italic; if (/^Text( \d+)?$/.test(L.name) || L.name === T.str.split('\n')[0].slice(0, 24)) L.name = v.str.split('\n')[0].slice(0, 24); LM.commit('Edit Text'); }
    });
  };
  LM.createTextAt = (x, y) => {
    const c = LM.comp(), O = st.textOpts;
    Aero.dialog({
      title: 'New Text Layer', width: 480,
      fields: [{ key: 'str', label: 'Text', type: 'textarea', value: 'Your Title', rows: 3 }, { key: 'font', label: 'Font', type: 'select', value: O.font, options: LM.FONTS.map(f => [f, f]) }, { key: 'size', label: 'Size (px)', type: 'number', value: O.size, min: 4, max: 1000 }, { key: 'color', label: 'Color', type: 'color', value: O.color }],
      onOK: v => { if (!v.str.trim()) return; const L = F.text(c, v.str, { font: v.font, size: v.size, fill: v.color, pos: [x ?? c.w / 2, y ?? c.h / 2] }); L.tr.anchor.v = [0, -v.size * .35]; L.name = LM.uniqueName(c, L.name); LM.addLayer(L, 'New Text Layer'); }
    });
  };

  /* ---------- new layers ---------- */
  const NEW = {
    solid: () => { const c = LM.comp(); Aero.dialog({ title: 'Solid Settings', fields: [{ key: 'name', label: 'Name', type: 'text', value: LM.uniqueName(c, 'Solid 1') }, { key: 'w', label: 'Width', type: 'number', value: c.w, min: 1, max: 16000 }, { key: 'h', label: 'Height', type: 'number', value: c.h, min: 1, max: 16000 }, { key: 'color', label: 'Color', type: 'color', value: '#3a7bd5' }], onOK: v => LM.addLayer(F.solid(c, v.color, v.name, Math.round(v.w), Math.round(v.h)), 'New Solid') }); },
    text: () => { const c = LM.comp(); tools.set('text'); LM.textEdit.toolClick(c.w / 2, c.h / 2); },
    camera: () => LM.newCamera(),
    shape: () => { const c = LM.comp(), L = F.shape(c, 'rect', { size: [600, 340], roundness: 40, pos: [c.w / 2, c.h / 2] }); L.shape.roundness.v = 40; L.name = LM.uniqueName(c, 'Shape Layer 1'); LM.addLayer(L, 'New Shape Layer'); },
    null: () => { const c = LM.comp(), L = F.nul(c); L.name = LM.uniqueName(c, 'Null 1'); LM.addLayer(L, 'New Null Object'); },
    adjust: () => { const c = LM.comp(), L = F.adjust(c); L.name = LM.uniqueName(c, 'Adjustment Layer 1'); LM.addLayer(L, 'New Adjustment Layer'); Aero.toast('Add effects to the adjustment layer — they apply to all layers below it'); },
    draw: () => { const c = LM.comp(), L = F.draw(c); L.name = LM.uniqueName(c, 'Drawing 1'); LM.addLayer(L, 'New Drawing Layer'); tools.set('brush'); Aero.toast('Drawing layer: paint with the Brush (F7 new cel, F6 duplicate cel, Page Down next frame)'); },
  };
  LM.newLayer = NEW;
  LM.layerContextMenu = (x, y) => {
    const L = LM.selLayer();
    const items = ['#New', ['Text', NEW.text], ['Solid…', NEW.solid], ['Shape Layer', NEW.shape], ['Null Object', NEW.null], ['Adjustment Layer', NEW.adjust], ['Drawing Layer', NEW.draw], ['Camera…', NEW.camera]];
    if (L) items.push('-', `#${L.name}`, ['Rename…', async () => { const v = await Aero.prompt('Rename Layer', 'Name', L.name); if (v) { L.name = v; LM.commit('Rename Layer'); } }], ['Duplicate', LM.duplicateLayers, { key: 'Ctrl+D' }], ['Split Layer', LM.splitLayer, { key: 'Ctrl+Shift+D' }], ['Pre-compose…', LM.precompose, { key: 'Ctrl+Shift+C' }], ['Add Mask', () => LM.addMask(L, 'rect'), { disabled: L.type === 'null' }],
      ['Add Text Animator', () => LM.addAnimator(L), { disabled: L.type !== 'text' }], ['Edit Text…', () => LM.editText(L), { disabled: L.type !== 'text' }], ['Open Precomp', () => LM.setActiveComp(L.comp), { disabled: L.type !== 'precomp' }], '-',
      ['3D Layer', () => LM.set3D([L]), { checked: !!L.threeD, disabled: L.type === 'audio' || L.type === 'camera' }], ['Enable Time Remapping', () => LM.toggleTimeRemap(), { checked: !!L.tm?.on, disabled: !LM.canTimeRemap(L), key: 'Ctrl+Alt+T' }], ['Freeze Frame', () => LM.freezeFrame(), { disabled: !LM.canTimeRemap(L) }], ['Add Shape Group / Repeater…', () => { const r = { x: x + 20, y: y + 20 }; LM.shapeAddMenu(L, r.x, r.y); }, { disabled: L.type !== 'shape' }], '-', ['Bring Forward', () => LM.moveLayers(-1), { key: 'Ctrl+]' }], ['Send Backward', () => LM.moveLayers(1), { key: 'Ctrl+[' }], ['Clear Parent', () => LM.setParent(L, null), { disabled: !L.parent }], ['Add Layer Marker', () => LM.addMarker(), { key: '*' }], '-', ['Delete', LM.deleteLayers, { key: 'Delete' }]);
    W.menu(x, y, items);
  };

  /* ---------- toolbox ---------- */
  const I = {
    select: '<path d="M5 3l12 8-6 1-3 6z"/>', hand: '<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6.5a1.5 1.5 0 0 1 3 0v7c0 4-2.5 6.5-6 6.5-2.6 0-4-1.3-5.5-3.5L3.8 13a1.5 1.5 0 0 1 2.4-1.8L8 13"/>',
    zoom: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5 20 20M7.5 10h5M10 7.5v5"/>', rotate: '<path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M17.5 3v4.5H13"/>',
    anchor: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3v5.5M12 15.5V21M3 12h5.5M15.5 12H21"/>', pen: '<path d="M12 3 5.5 13l2.2 6.5h8.6l2.2-6.5z"/><circle cx="12" cy="12" r="1.6"/><path d="M12 3v7.4"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>', ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>', polygon: '<path d="M12 3.5l7.8 5.7-3 9.1H7.2l-3-9.1z"/>', star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    text: '<path d="M5 5h14M12 5v14M9 19h6"/>', brush: '<path d="M14.5 4.5l5 5L11 18l-5-5z"/><path d="M6 13c-2 1-2.5 3-2.5 6.5C7 19.5 9 19 11 18"/>', eraser: '<path d="M4 15.5 13.5 6l6 6-7.5 7.5H8z"/><path d="M9.5 10 15.5 16M8 19.5h12"/>',
  };
  const tools = LM.tools = Aero.toolbox($('#tools'), [
    { id: 'select', title: 'Selection Tool', key: 'V', icon: I.select }, { id: 'hand', title: 'Hand Tool', key: 'H', icon: I.hand }, { id: 'zoom', title: 'Zoom Tool', key: 'Z', icon: I.zoom }, null,
    { id: 'rotate', title: 'Rotation Tool', key: 'W', icon: I.rotate }, { id: 'anchor', title: 'Pan Behind (Anchor Point) Tool', key: 'Y', icon: I.anchor }, null,
    { id: 'rect', title: 'Rectangle Tool', key: 'Q', icon: I.rect }, { id: 'ellipse', title: 'Ellipse Tool', key: 'Shift+Q', icon: I.ellipse }, { id: 'polygon', title: 'Polygon Tool', icon: I.polygon }, { id: 'star', title: 'Star Tool', icon: I.star }, { id: 'pen', title: 'Pen Tool', key: 'G', icon: I.pen }, null,
    { id: 'text', title: 'Type Tool', key: 'Ctrl+T', icon: I.text }, null,
    { id: 'brush', title: 'Brush Tool (drawing layers)', key: 'Ctrl+B', icon: I.brush }, { id: 'eraser', title: 'Eraser Tool (drawing layers)', key: 'E', icon: I.eraser },
  ], id => { if (st.textEdit) LM.textEdit.finish(); if (st.tool === 'pen' && id !== 'pen' && LM.viewer.pen.pts.length) LM.viewer.penFinish(false); st.tool = id; LM.renderCmd(); LM.requestRender(); });

  /* ---------- keyframe navigation ---------- */
  function jumpKey(dir) {
    const c = LM.comp(), ls = LM.selLayers().length ? LM.selLayers() : c.layers; const t = st.time;
    let best = null;
    ls.forEach(L => LM.leaves(L).forEach(n => (n.p.k || []).forEach(k => { const kt = LM.snap(k.t + L.start); if (dir > 0 ? kt > t + 1e-6 && (best === null || kt < best) : kt < t - 1e-6 && (best === null || kt > best)) best = kt; })));
    if (best !== null) LM.setTime(best);
  }
  function nudge(dx, dy) { const t = st.time; const ls = LM.selLayers().filter(l => !l.locked); if (!ls.length) return; ls.forEach(L => { const v = LM.val(L.tr.position, t).slice(); v[0] += dx; v[1] += dy; LM.setVal(L.tr.position, t, v); }); LM.commit('Nudge', false); }
  function reveal(id) {
    const ls = LM.selLayers().length ? LM.selLayers() : LM.comp().layers;
    st.reveal = false;
    const same = st.revealOnly === id && ls.every(L => L.expanded);
    st.revealOnly = same ? null : id;
    ls.forEach(L => { L.expanded = !same; if (!same) { LM.ui.open.add(L.id + '|transform'); if (id === 'masks') LM.ui.open.add(L.id + '|masks'); if (id === 'effects') LM.ui.open.add(L.id + '|effects'); } });
    LM.tl.rebuild();
  }
  LM.reveal = reveal;
  function easeSel(type) { LM.setKeysInterp(type); }

  /* ---------- menus ---------- */
  const fxItems = Object.entries(LM.FX).map(([k, d]) => [d.name, () => LM.addEffect(k)]);
  const presetItems = []; let lastCat = '';
  Object.entries(LM.PRESETS).forEach(([k, p]) => { if (p.cat !== lastCat) { presetItems.push('#' + p.cat); lastCat = p.cat; } presetItems.push([p.name, () => LM.applyPreset(k)]); });
  const has = () => !!LM.selLayer();
  Aero.init({
    name: 'Lumen Motion', icon: '../kit/icons/motion.png', doc: 'Untitled',
    onDropFiles: files => LM.importFiles(files), dropText: 'Drop images, video or a .lmot project',
    onSave: () => LM.saveProject(false),
    menus: {
      File: [
        ['New Project', 'Ctrl+Alt+N', () => LM.newProject()], ['New Composition…', 'Ctrl+N', () => LM.newCompDialog()], ['Open Project…', 'Ctrl+O', () => LM.openProject()], ['Open Sample', '', () => LM.openSample()], '-',
        ['Save', 'Ctrl+S', () => LM.saveProject(false)], ['Save As…', 'Ctrl+Shift+S', () => LM.saveProject(true)], '-',
        ['Import File…', 'Ctrl+I', () => LM.importDialog()], ['Import Audio…', 'Ctrl+Alt+I', () => LM.importAudioDialog()], '-', '#Export',
        ['Render MP4 Video…', 'Ctrl+M', () => LM.exportDialog('mp4')], ['Render WebM Video…', '', () => LM.exportDialog('webm')], ['Export Animated GIF…', '', () => LM.exportDialog('gif')], ['Export PNG Sequence (.zip)…', '', () => LM.exportDialog('png')], ['Save Current Frame as PNG…', 'Ctrl+Alt+S', () => LM.render({ fmt: 'frame', scale: 1 })], ['Export Audio (WAV)…', '', () => LM.exportDialog('wav')], ['Export Lottie JSON (Bodymovin)…', 'Ctrl+Alt+L', () => LM.lottieDialog()],
      ],
      Edit: [
        { label: 'Undo', key: 'Ctrl+Z', fn: LM.undo, disabled: () => LM.hist.index <= 0 }, { label: 'Redo', key: 'Ctrl+Shift+Z/Ctrl+Y', fn: LM.redo, disabled: () => LM.hist.index >= LM.hist.items.length - 1 }, '-',
        ['Copy Keyframes', 'Ctrl+C', () => { if (!LM.copyKeys()) Aero.toast('Select keyframes to copy'); }], ['Paste Keyframes', 'Ctrl+V', () => { if (!LM.pasteKeys()) Aero.toast('Nothing to paste'); }],
        ['Duplicate Layer', 'Ctrl+D', () => LM.duplicateLayers()], ['Delete', 'Delete/Backspace', () => { if (!LM.deleteSelectedKeys()) LM.deleteLayers(); }], '-',
        ['Select All Layers', 'Ctrl+A', () => LM.select(LM.comp().layers.map(l => l.id))], ['Deselect All', 'Ctrl+Shift+A', () => { LM.select([]); st.selKeys.clear(); LM.tl.markKeys(); }], ['Split Layer', 'Ctrl+Shift+D', () => LM.splitLayer()], '-',
        ['Enable Expressions…', '', () => LM.reviewExpressions()], { label: 'Evaluate Expressions', fn: () => { LM.exprState.enabled = !LM.exprState.enabled; LM.st.ver++; LM.emit('change'); LM.requestRender(); }, checked: () => LM.exprState.enabled },
      ],
      Composition: [
        ['New Composition…', '', () => LM.newCompDialog()], ['Composition Settings…', 'Ctrl+K', () => LM.compSettings()], ['Pre-compose…', 'Ctrl+Shift+C', () => LM.precompose()], '-',
        ['Set Work Area Start', 'B', () => { const c = LM.comp(); c.workIn = Math.min(st.time, c.workOut - 1 / c.fps); LM.commit('Work Area', false); LM.tl.drawRuler(); }], ['Set Work Area End', 'N', () => { const c = LM.comp(); c.workOut = Math.max(st.time + 1 / c.fps, c.workIn + 1 / c.fps); LM.commit('Work Area', false); LM.tl.drawRuler(); }], ['Reset Work Area', '', () => { const c = LM.comp(); c.workIn = 0; c.workOut = c.duration; LM.commit('Work Area', false); LM.tl.drawRuler(); }], ['Trim Comp to Work Area', '', () => LM.trimCompToWork()], '-',
        ['Play / Stop', 'Space', () => LM.togglePlay()], ['RAM Preview', '0', () => LM.ramPreview()], { label: 'Loop Playback', fn: () => { st.loop = !st.loop; LM.emit('play'); }, checked: () => st.loop }, { label: 'Audio Preview', fn: () => { LM.audio.toggle(); LM.tl.rebuild(); }, checked: () => LM.audio.enabled }, { label: 'Scrub Audio', fn: () => { LM.audio.scrubOn = !LM.audio.scrubOn; }, checked: () => LM.audio.scrubOn }, { label: 'Motion Blur', fn: () => { const c = LM.comp(); c.mbOn = !c.mbOn; LM.commit('Motion Blur', false); }, checked: () => !!LM.comp()?.mbOn }, ['Motion Blur Settings…', '', () => LM.mbSettings()], '-',
        ['Add Marker', '*', () => LM.addMarker()], ['Previous Marker', 'Alt+J', () => LM.jumpMarker(-1)], ['Next Marker', 'Alt+K', () => LM.jumpMarker(1)], ['Delete All Markers', '', () => LM.clearMarkers()], '-',
        ['Go to Start', 'Home', () => LM.setTime(0)], ['Go to End', 'End', () => LM.setTime(1e9)], ['Previous Frame', 'PageUp/Ctrl+ArrowLeft', () => LM.setTime(st.time - 1 / LM.fps())], ['Next Frame', 'PageDown/Ctrl+ArrowRight', () => LM.setTime(st.time + 1 / LM.fps())], ['Go to Time…', 'Alt+Shift+J', () => document.querySelector('.tl-time').click()],
      ],
      Layer: [
        '#New', ['Text', 'Ctrl+Alt+Shift+T', NEW.text], ['Solid…', 'Ctrl+Alt+Y', NEW.solid], ['Shape Layer', '', NEW.shape], ['Null Object', 'Ctrl+Alt+Shift+Y', NEW.null], ['Adjustment Layer', 'Ctrl+Alt+Shift+A', NEW.adjust], ['Drawing Layer (cel animation)', '', NEW.draw], ['Camera…', 'Ctrl+Alt+Shift+C', NEW.camera], '-',
        { label: 'New Mask', key: 'Ctrl+Shift+N', fn: () => LM.addMask(LM.selLayer(), 'rect'), disabled: () => !has() }, { label: 'Add Text Animator', fn: () => LM.addAnimator(LM.selLayer()), disabled: () => LM.selLayer()?.type !== 'text' }, { label: 'Edit Text…', fn: () => LM.editText(LM.selLayer()), disabled: () => LM.selLayer()?.type !== 'text' }, '-',
        '#3D', { label: '3D Layer', fn: () => LM.set3D(), disabled: () => !LM.selLayers().some(l => l.type !== 'audio' && l.type !== 'camera'), checked: () => !!LM.selLayer()?.threeD }, '-',
        '#Time', { label: 'Enable Time Remapping', key: 'Ctrl+Alt+T', fn: () => LM.toggleTimeRemap(), disabled: () => !LM.selLayers().some(LM.canTimeRemap), checked: () => !!LM.selLayer()?.tm?.on }, { label: 'Freeze Frame', fn: () => LM.freezeFrame(), disabled: () => !LM.selLayers().some(LM.canTimeRemap) }, { label: 'Time-Reverse Layer', key: 'Ctrl+Alt+R', fn: () => LM.timeReverse(), disabled: () => !LM.selLayers().some(LM.canTimeRemap) }, { label: 'Frame Blending', fn: () => LM.toggleFrameBlend(), disabled: () => !LM.selLayers().some(l => l.type === 'precomp' || l.type === 'video'), checked: () => !!LM.selLayer()?.fb }, '-',
        '#Shape', { label: 'Add Rectangle Group', fn: () => LM.addShapeGroup(LM.selLayer(), 'rect'), disabled: () => LM.selLayer()?.type !== 'shape' }, { label: 'Add Ellipse Group', fn: () => LM.addShapeGroup(LM.selLayer(), 'ellipse'), disabled: () => LM.selLayer()?.type !== 'shape' }, { label: 'Add Star Group', fn: () => LM.addShapeGroup(LM.selLayer(), 'star'), disabled: () => LM.selLayer()?.type !== 'shape' }, { label: 'Repeater', fn: () => LM.toggleRepeater(LM.selLayer(), null), disabled: () => LM.selLayer()?.type !== 'shape', checked: () => !!LM.selLayer()?.shape?.rep.on }, { label: 'Merge Paths (Add)', fn: () => { const L = LM.selLayer(); LM.setMerge(L, L.shape.merge === 'add' ? 'off' : 'add'); }, disabled: () => LM.selLayer()?.type !== 'shape', checked: () => LM.selLayer()?.shape?.merge === 'add' }, { label: 'Gradient Fill', fn: () => { const L = LM.selLayer(); LM.setGradient(L, 'fill', L.shape.fill.gtype === 'solid' ? 'linear' : 'solid'); }, disabled: () => LM.selLayer()?.type !== 'shape', checked: () => !!LM.selLayer()?.shape && LM.selLayer().shape.fill.gtype !== 'solid' }, { label: 'Combine Shape Layers', fn: () => LM.combineShapes(), disabled: () => LM.selLayers().filter(l => l.type === 'shape').length < 2 }, '-',
        ['Bring Layer Forward', 'Ctrl+]', () => LM.moveLayers(-1)], ['Send Layer Backward', 'Ctrl+[', () => LM.moveLayers(1)], ['Bring Layer to Front', 'Ctrl+Shift+]', () => LM.moveLayers('top')], ['Send Layer to Back', 'Ctrl+Shift+[', () => LM.moveLayers('bottom')], '-',
        ['Move In Point to Current Time', '[', () => LM.slideLayerTo('in')], ['Move Out Point to Current Time', ']', () => LM.slideLayerTo('out')], ['Trim In Point', 'Alt+[', () => LM.trimLayer('in')], ['Trim Out Point', 'Alt+]', () => LM.trimLayer('out')], '-',
        { label: 'Motion Blur Switch', fn: () => { LM.selLayers().forEach(l => l.mb = !l.mb); LM.commit('Motion Blur Switch'); }, disabled: () => !has(), checked: () => !!LM.selLayer()?.mb }, { label: 'Lock', key: 'Ctrl+L', fn: () => { LM.selLayers().forEach(l => l.locked = !l.locked); LM.commit('Lock'); }, disabled: () => !has() }, { label: 'Hide', fn: () => { LM.selLayers().forEach(l => l.visible = !l.visible); LM.commit('Hide'); }, disabled: () => !has() },
      ],
      Animation: [
        ['Easy Ease', 'F9', () => easeSel('ease')], ['Easy Ease In', 'Shift+F9', () => easeSel('easeIn')], ['Easy Ease Out', 'Ctrl+Shift+F9', () => easeSel('easeOut')], ['Linear', '', () => easeSel('linear')], ['Bezier', '', () => easeSel('bezier')], ['Toggle Hold Keyframe', 'Ctrl+Alt+H', () => LM.toggleHold()], ['Keyframe Velocity…', 'Ctrl+Shift+K', () => LM.keyVelocityDialog()], '-',
        ['Auto-Bezier Motion Path', '', () => LM.autoBezierPath()], ['Linear Motion Path', '', () => LM.linearPath()], '-',
        '#Keyframe Assistant', ['Convert Expression to Keyframes', '', () => LM.bakeSelected()], ['Convert Audio to Keyframes', '', () => LM.audioToKeys()], ['Sequence Layers…', '', () => LM.sequenceLayers()], ['Time-Reverse Keyframes', '', () => LM.reverseKeys()], '-',
        ['Previous Keyframe', 'J', () => jumpKey(-1)], ['Next Keyframe', 'K', () => jumpKey(1)], ['Reveal Animated Properties', 'U', () => { st.revealOnly = null; st.reveal = !st.reveal; LM.tl.rebuild(); }], ['Reveal Position', 'P', () => reveal('tr.position')], ['Reveal Scale', 'S', () => reveal('tr.scale')], ['Reveal Rotation', 'R', () => reveal('tr.rotation')], ['Reveal Opacity', 'T', () => reveal('tr.opacity')], ['Reveal Anchor Point', 'A', () => reveal('tr.anchor')], ['Reveal Masks', 'M', () => reveal('masks')], '-',
        { label: 'Graph Editor', key: 'Shift+F3', fn: () => LM.tl.toggleGraph(), checked: () => LM.tl.graph }, '-', '#Animation Presets', ...presetItems,
      ],
      Effect: [...fxItems, '-', { label: 'Remove All Effects', fn: () => { const ls = LM.selLayers(); ls.forEach(l => l.effects = []); LM.commit('Remove All Effects'); }, disabled: () => !LM.selLayer()?.effects.length }],
      Drawing: [
        ['New Drawing Layer', '', NEW.draw], ['Insert Blank Cel', 'F7', () => LM.celCommand('blank')], ['Duplicate Cel', 'F6', () => LM.celCommand('dup')], ['Clear Cel', '', () => LM.celCommand('clear')], '-',
        { label: 'Onion Skin', fn: () => { const L = LM.selLayer(); if (L?.type === 'draw') { L.draw.onion = !L.draw.onion; LM.requestRender(); LM.renderCmd(); } }, checked: () => !!LM.selLayer()?.draw?.onion, disabled: () => LM.selLayer()?.type !== 'draw' }, ['Brush Tool', '', () => tools.set('brush')], ['Eraser Tool', '', () => tools.set('eraser')],
      ],
      View: [
        ['Zoom In', 'Ctrl+=', () => LM.viewer.setZoom(LM.viewer.z * 1.25)], ['Zoom Out', 'Ctrl+-', () => LM.viewer.setZoom(LM.viewer.z / 1.25)], ['Fit in Viewer', 'Ctrl+0', () => LM.viewer.fitView()], ['Actual Size (100%)', 'Ctrl+1', () => LM.viewer.setZoom(1)], '-',
        ...[['Full', 1], ['Half', .5], ['Third', .333333], ['Quarter', .25]].map(([n, r]) => ({ label: 'Resolution: ' + n, fn: () => { st.res = r; document.querySelector('#vres').value = r; LM.cacheReset(); LM.requestRender(); }, checked: () => st.res === r })), '-',
        { label: 'Transparency Grid', fn: () => document.querySelector('#vgrid').click(), checked: () => LM.viewer.grid }, { label: 'Show Motion Paths', fn: () => document.querySelector('#vpath').click(), checked: () => LM.viewer.showPaths },
      ],
      Help: [['Keyboard Shortcuts', 'F1', () => shortcutsDialog()], ['Expressions Reference', '', () => exprHelp()], '-', ['About Lumen Motion', '', () => aboutDialog()]],
    }
  });
  // extra shortcuts
  Aero.shortcut('Space', () => { if (st.rendering) LM.ramPreview(); else LM.togglePlay(); });
  Aero.shortcut('Escape', () => { if (LM.viewer.pen.pts.length) LM.viewer.penCancel(); else if (st.playing || st.rendering) { LM.stop(); if (st.rendering) LM.ramPreview(); } else { st.selKeys.clear(); LM.tl.markKeys(); } });
  Aero.shortcut('Enter', () => { if (LM.viewer.pen.pts.length) LM.viewer.penFinish(false); });
  Aero.shortcut('ArrowLeft', () => nudge(-1, 0)); Aero.shortcut('ArrowRight', () => nudge(1, 0)); Aero.shortcut('ArrowUp', () => nudge(0, -1)); Aero.shortcut('ArrowDown', () => nudge(0, 1));
  Aero.shortcut('Shift+ArrowLeft', () => nudge(-10, 0)); Aero.shortcut('Shift+ArrowRight', () => nudge(10, 0)); Aero.shortcut('Shift+ArrowUp', () => nudge(0, -10)); Aero.shortcut('Shift+ArrowDown', () => nudge(0, 10));
  Aero.shortcut('Ctrl+ArrowUp', () => { const c = LM.comp(), i = c.layers.findIndex(l => st.sel.includes(l.id)); LM.select([c.layers[Math.max(0, i - 1)]?.id]); });
  Aero.shortcut('Ctrl+ArrowDown', () => { const c = LM.comp(), i = c.layers.findIndex(l => st.sel.includes(l.id)); LM.select([c.layers[Math.min(c.layers.length - 1, i + 1)]?.id]); });

  LM.trimCompToWork = () => { const c = LM.comp(), a = c.workIn, b = c.workOut; c.layers.forEach(L => { L.start -= a; L.in = Math.max(0, L.in - a); L.out = Math.min(b - a, L.out - a); }); c.duration = b - a; c.workIn = 0; c.workOut = c.duration; st.time = Math.max(0, st.time - a); LM.commit('Trim Comp to Work Area'); LM.emit('compchange'); };
  LM.mbSettings = () => { const c = LM.comp(); Aero.dialog({ title: 'Motion Blur', fields: [{ key: 'on', label: 'Enable motion blur', type: 'checkbox', value: !!c.mbOn }, { key: 'angle', label: 'Shutter angle (°)', type: 'range', value: c.mb.angle, min: 0, max: 720, step: 1 }, { key: 'phase', label: 'Shutter phase (°)', type: 'range', value: c.mb.phase, min: -360, max: 360, step: 1 }, { key: 'samples', label: 'Samples per frame', type: 'range', value: c.mb.samples, min: 2, max: 64, step: 1 }], onOK: v => { c.mbOn = v.on; c.mb = { angle: v.angle, phase: v.phase, samples: Math.round(v.samples) }; LM.commit('Motion Blur Settings', false); } }); };
  LM.newProject = async () => {
    if (Aero.dirty && !(await Aero.confirm('New Project', 'Discard unsaved changes to the current project?', 'Discard'))) return;
    LM.stop?.(); LM.media.clear(); LM.assets.clear();
    const c = F.comp({ name: 'Comp 1' }); LM.doc.comps = [c]; LM.doc.active = c.id; LM.doc.name = 'Untitled'; LM.doc.path = null;
    st.sel = []; st.selKeys.clear(); st.time = 0; LM.ui.open.clear(); LM.tl.openTabs.clear();
    LM.resetHistory('New Project'); LM.setActiveComp(c.id);
  };

  /* ---------- help ---------- */
  function shortcutsDialog() {
    const rows = [['Play / Stop', 'Space'], ['RAM preview', '0'], ['Previous / next frame', 'Page Up / Page Down'], ['First / last frame', 'Home / End'], ['Previous / next keyframe', 'J / K'], ['Work area start / end', 'B / N'],
      ['Selection · Hand · Zoom', 'V · H · Z'], ['Rotation · Pan Behind', 'W · Y'], ['Rectangle · Ellipse · Pen', 'Q · Shift+Q · G'], ['Type tool', 'Ctrl+T'], ['Brush · Eraser', 'Ctrl+B · E'],
      ['Reveal Position/Scale/Rotation/Opacity/Anchor', 'P / S / R / T / A'], ['Reveal masks · animated properties', 'M · U'], ['Easy Ease · In · Out', 'F9 · Shift+F9 · Ctrl+Shift+F9'], ['Hold keyframe', 'Ctrl+Alt+H'], ['Graph Editor', 'Shift+F3'],
      ['Copy / paste keyframes', 'Ctrl+C / Ctrl+V'], ['Duplicate · split layer', 'Ctrl+D · Ctrl+Shift+D'], ['Pre-compose', 'Ctrl+Shift+C'], ['Move / trim in & out point', '[ ] · Alt+[ Alt+]'], ['Nudge position', 'Arrow keys (Shift ×10)'],
      ['New cel · duplicate cel', 'F7 · F6'], ['Edit text on canvas', 'Type tool click · double-click text · Esc to finish'], ['Time remapping · time-reverse', 'Ctrl+Alt+T · Ctrl+Alt+R'], ['New camera', 'Ctrl+Alt+Shift+C'], ['Import audio', 'Ctrl+Alt+I'], ['Scrub audio', 'Drag in the time ruler (Composition › Scrub Audio)'], ['Export Lottie JSON', 'Ctrl+Alt+L'], ['Composition settings', 'Ctrl+K'], ['Render MP4', 'Ctrl+M'], ['Pan view (any tool)', 'Hold Space and drag'], ['Zoom view', 'Mouse wheel'],
      ['Scrub a value', 'Drag the blue number (Shift ×10, Ctrl ×0.1), click to type'], ['Add expression', 'Alt+click a stopwatch or click “=”'], ['Link properties', 'Right-click a property name › Copy Expression Reference, then › Link to … on another'], ...LM.markerHelpRows];
    Aero.dialog({ title: 'Keyboard Shortcuts', noCancel: true, width: 620, html: `<table class="kbd">${rows.map(r => `<tr><td>${esc(r[0])}</td><td><b>${esc(r[1])}</b></td></tr>`).join('')}</table>` });
  }
  function exprHelp() {
    Aero.dialog({ title: 'Expressions Reference', noCancel: true, width: 620, html: `<p class="dnote">Expressions compute a property's value every frame. They run in a sandbox with no access to the page, files or the network. The last line is the result.</p>
<table class="kbd"><tr><td class="mono">wiggle(freq, amp)</td><td>random organic motion around the keyframed value</td></tr><tr><td class="mono">time * 90</td><td>time in seconds (comp time) — e.g. continuous rotation</td></tr><tr><td class="mono">loopOut("cycle")</td><td>repeat keyframes; also "pingpong", "offset", "continue"; loopIn()</td></tr>
<tr><td class="mono">linear(t, t0, t1, v0, v1)</td><td>map a range; also ease(), easeIn(), easeOut()</td></tr><tr><td class="mono">value + [100, 0]</td><td>value math with arrays</td></tr><tr><td class="mono">valueAtTime(time - 0.2)</td><td>delay / echo</td></tr>
<tr><td class="mono">thisComp.layer("Null 1").transform.position</td><td>read another layer's property (also .scale, .rotation, .opacity, .anchorPoint, .valueAtTime(t), .velocity)</td></tr><tr><td class="mono">effect("Slider Control")("Slider")</td><td>read an Expression Control on this layer; thisComp.layer("A").effect(…)(…) for another layer</td></tr>
<tr><td class="mono">thisComp.layer(1).toComp([0, 0])</td><td>layer space → composition space (also fromComp, parent, index, name)</td></tr><tr><td class="mono">thisComp.marker.key(1).time</td><td>markers: numKeys, key(i).time / .comment / .duration, nearestKey(time); marker for layer markers</td></tr>
<tr><td class="mono">Math.sin(time * 4) * 30</td><td>Math functions, clamp(), random(), noise(), seedRandom()</td></tr><tr><td class="mono">posterizeTime(8); wiggle(3, 20)</td><td>stepped, hand-made feel</td></tr><tr><td class="mono">thisComp.width, index</td><td>comp size, layer index, inPoint, outPoint</td></tr></table>` });
  }
  function aboutDialog() {
    Aero.dialog({ title: 'About Lumen Motion', noCancel: true, html: `<div class="about"><img src="../kit/icons/motion.png" alt=""><div><b>Lumen Motion</b><br>Motion graphics &amp; animation for Lumen Studio.<br><span class="dim">Compositions &amp; precomps · keyframes &amp; graph editor · shape groups, repeaters &amp; gradients · text &amp; cel layers · audio · time remapping · 2.5D layers &amp; cameras · effects &amp; color keying · expressions with layer links &amp; controls · markers &amp; keyframe assistants · MP4/WebM (with audio), GIF, PNG, WAV &amp; Lottie export.</span><br><br><span class="dim">Uses mp4-muxer, webm-muxer (MIT, Vanilagy), gifenc (MIT, Matt DesLauriers), fflate (MIT, 101arrowz).</span></div></div>` });
  }

  /* ---------- startup ---------- */
  tools.set('select');
  const c0 = F.comp({ name: 'Comp 1' }); LM.doc.comps = [c0]; LM.doc.active = c0.id;
  LM.resetHistory('New Project'); LM.setActiveComp(c0.id);
  LM.viewer.resize();
  // ?sample in the URL opens the sample directly (used for screenshots)
  if (/[?&]sample\b/.test(location.search)) LM.openSample();
})();
