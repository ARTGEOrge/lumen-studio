'use strict';
/* Lumen Proto — app shell: menus, toolbox, command bar, panels wiring, preview, welcome screen. */
(function () {
  const LP = window.LP, ED = window.ED, A = window.ACT, IO = window.IO, P = window.PANELS;
  const $ = s => document.querySelector(s), h = P.h;
  const APP = window.APP = {};

  /* ---------- modes ---------- */
  APP.setMode = m => {
    if (ED.editing) ED.endTextEdit();
    ED.mode = m; ED.pathEdit = null; if (m !== 'design') ED.setTool('select');
    document.querySelectorAll('.modebtn').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    document.querySelectorAll('#rtabs .aero-tab').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    document.body.dataset.mode = m;
    ED.emit('mode'); updateCmd(); ED.redraw();
  };

  /* ---------- preview ---------- */
  let player = null;
  APP.preview = (startId) => {
    if (!LP.artboards(ED.doc).length) { Aero.toast('Add an artboard first'); return; }
    if (ED.editing) ED.endTextEdit();
    let start = startId;
    if (!start) { const s = ED.selNodes()[0]; const top = s && ED.scene.top(s); if (top && LP.artboards(ED.doc).includes(top)) start = top.id; }
    const ov = h('div', { class: 'lp-preview' });
    const bar = h('div', { class: 'aero-pill pbar' });
    const flows = LP.flowStarts(ED.doc);
    const fsel = h('select', { title: 'Start from' });
    LP.artboards(ED.doc).forEach(a => fsel.add(new Option((a.flowStart ? '▶ ' + a.flowStart + ' — ' : '') + a.name, a.id)));
    const where = h('span', { class: 'pwhere' });
    const close = () => { player?.destroy(); player = null; ov.remove(); removeEventListener('keydown', kh, true); ED.canvas.focus?.(); LP.onImageLoad = () => { ED.redraw(); ED.emit('images'); }; };
    // while previewing, keys go to the prototype only (never to editor shortcuts behind it)
    const kh = e => {
      if (e.target && e.target.closest && e.target.closest('.pbar') && e.target.matches('select,input')) return;
      e.stopPropagation();
      if (e.key === 'Escape' && !(player && player.overlays.length)) { e.preventDefault(); close(); return; }
      player?.onKey(e);
    };
    bar.append(h('b', { text: 'Preview' }), fsel, h('button', { class: 'aero-btn small', text: '⟲ Restart', title: 'Restart (R)', onclick: () => { player.restart(); player.canvas.focus(); } }),
      h('button', { class: 'aero-btn small', text: '⇩ Export HTML', title: 'Save as a self-contained interactive HTML file', onclick: () => IO.exportHTML() }), where,
      h('span', { class: 'dim', text: 'Click hotspots · Esc to close' }), h('button', { class: 'aero-btn small pri', text: 'Close', onclick: close }));
    const stage = h('div', { class: 'pstage' });
    ov.append(stage, bar); document.body.append(ov);
    const run = id => { player?.destroy(); player = new LP.Player(stage, ED.doc, { start: id, ownKeys: false, onNavigate: i => { const n = player.scene.get(i); where.textContent = n ? n.name : ''; fsel.value = i; } }); where.textContent = player.cur?.name || ''; fsel.value = player.curId; player.canvas.focus(); APP.player = player; };
    fsel.onchange = () => run(fsel.value);
    addEventListener('keydown', kh, true);
    run(start || flows[0]?.id || null);
  };
  APP.closePreview = () => document.querySelector('.lp-preview .pri')?.click();

  /* ---------- command bar ---------- */
  const TOOL_NAMES = { comment: 'Comment', select: 'Select', frame: 'Artboard / Frame', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', pen: 'Pen', text: 'Text', hand: 'Hand' };
  function updateCmd() {
    const cmd = $('#cmd'); cmd.innerHTML = '';
    const modes = h('div', { class: 'modes' });
    [['design', 'Design'], ['proto', 'Prototype'], ['inspect', 'Inspect']].forEach(([m, t]) => modes.append(h('button', { class: 'aero-btn modebtn' + (ED.mode === m ? ' on' : ''), 'data-mode': m, text: t, title: `${t} mode (Alt+${m === 'design' ? 1 : m === 'proto' ? 2 : 3})`, onclick: () => APP.setMode(m) })));
    cmd.append(modes, h('span', { class: 'sep' }));
    if (ED.mode === 'design') {
      cmd.append(h('span', { class: 'tname', text: TOOL_NAMES[ED.tool] || ED.tool }));
      if (ED.tool === 'frame') {
        const s = h('select', {}); s.add(new Option('New artboard preset…', ''));
        A.PRESETS.forEach(p => s.add(new Option(`${p.name} — ${p.w}×${p.h}`, p.name)));
        s.add(new Option('Custom: drag on the canvas', ''));
        s.onchange = () => { const p = A.PRESETS.find(q => q.name === s.value); if (p) { A.newArtboard(p); ED.setTool('select'); } };
        cmd.append(s, h('span', { class: 'hint', text: 'Drag to draw a frame · drawing around layers wraps them' }));
      } else if (ED.tool === 'pen') cmd.append(h('span', { class: 'hint', text: 'Click to add points · drag for curves · click the first point to close · Enter to finish' }));
      else if (ED.tool === 'text') cmd.append(h('span', { class: 'hint', text: 'Click for auto-width text · drag for a fixed-width text box' }));
      else if (ED.tool === 'comment') cmd.append(h('span', { class: 'hint', text: 'Click anywhere to pin a review comment · click a pin to reply or resolve' }));
      else if (ED.tool === 'select') cmd.append(h('span', { class: 'hint', text: 'Double-click to enter groups/instances · Ctrl+click selects deep · Alt shows distances' }));
      else cmd.append(h('span', { class: 'hint', text: 'Drag on the canvas · Shift keeps proportions' }));
    } else if (ED.mode === 'proto') cmd.append(h('span', { class: 'hint', text: 'Select a layer and drag its blue handle onto an artboard to link it' }));
    else cmd.append(h('span', { class: 'hint', text: 'Select a layer for code; hover others to measure distances' }));
    cmd.append(h('span', { class: 'grow' }));
    const zb = h('div', { class: 'zoomctl' },
      h('button', { class: 'aero-btn', text: '−', title: 'Zoom out (Ctrl+-)', onclick: () => ED.zoomBy(1 / 1.25) }),
      h('button', { class: 'aero-btn zval', id: 'zval', text: Math.round(ED.view.z * 100) + '%', title: 'Zoom to fit (Ctrl+1)', onclick: () => ED.zoomFit() }),
      h('button', { class: 'aero-btn', text: '+', title: 'Zoom in (Ctrl+=)', onclick: () => ED.zoomBy(1.25) }));
    cmd.append(zb, h('span', { class: 'sep' }), h('button', { class: 'aero-btn playbtn', html: P.ICON.play + ' Preview', title: 'Preview prototype (Ctrl+Enter)', onclick: () => APP.preview() }));
  }
  APP.updateCmd = updateCmd;

  /* ---------- status ---------- */
  function updateStatus() {
    $('#st-zoom').textContent = Math.round(ED.view.z * 100) + '%';
    const z = $('#zval'); if (z) z.textContent = Math.round(ED.view.z * 100) + '%';
    const s = ED.selNodes();
    $('#st-sel').textContent = s.length ? (s.length === 1 ? `${s[0].name} — ${ED.fmt(s[0].w)} × ${ED.fmt(s[0].h)}` : `${s.length} layers selected`) : `${LP.artboards(ED.doc).length} artboards`;
    $('#st-mode').textContent = { design: 'Design', proto: 'Prototype', inspect: 'Inspect' }[ED.mode];
  }
  ED.on('sel', updateStatus); ED.on('view', updateStatus); ED.on('mode', updateStatus); ED.on('live', updateStatus); ED.on('doc', updateStatus);
  ED.on('cursor', () => { const w = ED.cursorWorld; if (w) $('#st-pos').textContent = `X ${Math.round(w.x)}  Y ${Math.round(w.y)}`; });
  ED.on('tool', updateCmd);

  /* ---------- welcome ---------- */
  function updateWelcome() {
    let w = $('#welcome');
    if (ED.doc.children.length) { w?.remove(); return; }
    if (w) return;
    w = h('div', { id: 'welcome' });
    const card = h('div', { class: 'wcard' });
    card.append(h('div', { class: 'whead' }, h('img', { src: '../kit/icons/proto.png', alt: '' }), h('div', {}, h('h2', { text: 'Lumen Proto' }), h('div', { class: 'dim', text: 'Design, prototype and hand off app & web interfaces.' }))));
    const grid = h('div', { class: 'wgrid' });
    A.PRESETS.forEach(p => grid.append(h('button', { class: 'wtile', onclick: () => A.newArtboard(p) }, h('span', { class: 'dev', style: `aspect-ratio:${p.w}/${p.h}` }), h('b', { text: p.name }), h('span', { class: 'dim', text: `${p.w} × ${p.h}` }))));
    card.append(h('div', { class: 'wsub', text: 'Start with an artboard' }), grid);
    card.append(h('div', { class: 'wbtns' }, h('button', { class: 'aero-btn pri', text: 'Open Sample (Wanderly app)', onclick: APP.openSample }), h('button', { class: 'aero-btn', text: 'Open…', onclick: IO.open }), h('span', { class: 'dim', text: 'or drop a .lproto, SVG or image here' })));
    w.append(card); ED.stage.append(w);
  }
  ED.on('doc', updateWelcome);

  /* ---------- file commands ---------- */
  APP.newDoc = async () => { if (Aero.dirty && !(await Aero.confirm('New document', 'Discard unsaved changes?'))) return; ED.filePath = null; ED.setDoc(LP.newDoc(), 'Untitled'); ED.view = { z: 1, x: 80, y: 60 }; ED.redraw(); };
  APP.openSample = async () => {
    if (Aero.dirty && !(await Aero.confirm('Open sample', 'Discard unsaved changes?'))) return;
    Aero.busy('Building sample…');
    await new Promise(r => setTimeout(r, 20));
    try { await document.fonts?.load?.('600 16px "Inter"'); } catch (e) { }
    const doc = window.SAMPLE.build();
    ED.filePath = null; ED.setDoc(doc, doc.name);
    await LP.imagesReady(doc); ED.update(); ED.redraw(); P.renderAssets();
    Aero.busy();
    ED.zoomToBox(ED.unionBox(LP.artboards(doc)), 1, 50);
    Aero.toast('Sample loaded — press Ctrl+Enter to try the prototype');
  };
  APP.placeImage = async () => { const f = await Aero.openFile({ accept: 'image/png,image/jpeg,image/gif,image/webp,.svg', multiple: true }); if (f.length) IO.handleFiles(f); };
  APP.import = async () => { const f = await Aero.openFile({ accept: '.svg,.png,.jpg,.jpeg,.gif,.webp', multiple: true }); if (f.length) IO.handleFiles(f); };

  /* ---------- dialogs ---------- */
  function shortcutsDialog() {
    const rows = [['Tools', 'V select · A/F artboard & frame · R rectangle · E ellipse · L line · P pen · T text · H hand'], ['Navigate', 'Space+drag or middle-drag to pan · wheel scrolls · Ctrl+wheel zooms · Ctrl+1 fit · Ctrl+2 selection · Ctrl+0 100%'],
      ['Select', 'Click · Shift+click add · Ctrl+click deep select · double-click enter group / edit text · Enter select children · Esc select parent'],
      ['Edit', 'Ctrl+D duplicate · Alt+drag duplicate · arrows nudge (Shift ×10) · Ctrl+G group · Ctrl+Shift+G ungroup · Ctrl+Alt+G frame selection · Shift+A auto layout'],
      ['Transform', 'Shift constrains proportions / 45° lines / 15° rotation · Alt resizes from centre · Ctrl while moving disables snapping'],
      ['Components', 'Ctrl+Alt+K create component · Ctrl+Alt+B detach instance'], ['Align', 'Alt+A left · Alt+D right · Alt+W top · Alt+S bottom · Alt+H / Alt+V centres · Ctrl+Alt+T tidy up'],
      ['Text', 'Double-click / Enter edits text in place · select characters and use the inspector to style them (with only a caret, the style applies to what you type next) · Ctrl+B / Ctrl+I / Ctrl+U bold, italic, underline · Ctrl+Z inside the editor undoes typing · Esc or Ctrl+Enter finishes'],
      ['Vector', 'Ctrl+Alt+U union · Ctrl+Alt+S subtract · Ctrl+Alt+I intersect · Ctrl+Alt+X exclude · Ctrl+E flatten · Ctrl+Alt+M use as mask · Enter / double-click a path edits points (click a segment adds a point, Delete removes, Alt+click converts corner/smooth, Alt-drag breaks handles, Esc done)'],
      ['Review', 'C comment tool · click a pin to reply / resolve · Shift+C show / hide comments'],
      ['Modes', 'Alt+1 design · Alt+2 prototype · Alt+3 inspect · Ctrl+Enter preview (Esc closes)'], ['Measure', 'Hold Alt and hover to see distances to the selection']];
    Aero.dialog({ title: 'Keyboard shortcuts', noCancel: true, width: 620, html: `<table class="kbd">${rows.map(r => `<tr><th>${r[0]}</th><td>${Aero.esc(r[1])}</td></tr>`).join('')}</table>` });
  }
  function aboutDialog() {
    Aero.dialog({ title: 'About Lumen Proto', noCancel: true, instruction: 'Lumen Proto 1.1', html: `<p class="dnote">UI/UX design and prototyping: artboards, components with variants, auto layout, color &amp; text styles, interactive prototypes with smart animate, dev handoff and export to PNG, SVG, PDF and standalone HTML.</p><p class="dnote">New in 1.1: mixed-style text, boolean operations, masks, point editing, vector PDF, drag &amp; swipe triggers, overflow scrolling, variables &amp; conditions, dark-mode color styles, review comments, wrap / grid auto layout, design libraries.</p><p class="dnote">Bundled: Lucide icons (ISC), Inter typeface (SIL OFL 1.1), fflate (MIT), paper.js 0.12.18 (MIT, boolean geometry), Inter 4.1 static TTFs (SIL OFL 1.1, embedded as font subsets in PDF exports). Part of the Lumen Studio suite.</p>` });
  }

  /* ---------- context menu ---------- */
  ED.contextMenu = e => {
    document.querySelector('.lp-ctx')?.remove();
    const w = ED.s2w(e.offsetX, e.offsetY);
    if (!ED.sel.length) { const ch = ED.hitChain(w.x, w.y); const t = ED.pickTarget(ch); if (t) ED.select([t.id]); }
    const has = ED.sel.length > 0, one = ED.selNodes()[0];
    const items = [
      ['Cut', 'Ctrl+X', () => { const r = A.cut(); }, has], ['Copy', 'Ctrl+C', () => A.copy(), has], ['Paste', 'Ctrl+V', () => A.paste(), !!A.clip], ['Duplicate', 'Ctrl+D', A.duplicate, has], ['Delete', 'Del', A.deleteSel, has], '-',
      ['Group', 'Ctrl+G', A.group, has], ['Ungroup', 'Ctrl+Shift+G', A.ungroup, has], ['Frame selection', 'Ctrl+Alt+G', A.wrapInFrame, has], ['Add auto layout', 'Shift+A', A.addAutoLayout, has], '-',
      ['Create component', 'Ctrl+Alt+K', A.createComponent, has], ['Detach instance', 'Ctrl+Alt+B', A.detach, one?.type === 'instance'], ['Go to main component', '', A.goToMain, one?.type === 'instance'], '-',
      ['Bring to front', 'Ctrl+Shift+]', () => A.arrange('front'), has], ['Send to back', 'Ctrl+Shift+[', () => A.arrange('back'), has], '-',
      ['Hide / show', 'Ctrl+Shift+H', () => A.toggle('visible'), has], ['Lock / unlock', 'Ctrl+Shift+L', () => A.toggle('locked'), has], ['Rename…', 'F2', () => one && ED.renameNode(one), !!one], ['Export selection…', '', () => IO.exportNodes(ED.selNodes()), has]
    ];
    const m = h('div', { class: 'lp-ctx aero-dropdown' });
    items.forEach(it => { if (it === '-') return m.append(h('div', { class: 'aero-msep' })); const mi = h('div', { class: 'aero-mi' + (it[3] ? '' : ' disabled') }, h('span', { text: it[0] }), h('span', { class: 'k', text: it[1] })); mi.onclick = ev => { ev.stopPropagation(); m.remove(); it[2](); }; m.append(mi); });
    m.style.left = Math.min(e.clientX, innerWidth - 270) + 'px'; m.style.top = Math.min(e.clientY, innerHeight - 520) + 'px';
    document.body.append(m);
    setTimeout(() => addEventListener('pointerdown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); removeEventListener('pointerdown', off, true); } }, true));
  };

  /* ---------- init ---------- */
  function init() {
    const stage = $('#stage');
    ED.initCanvas(stage);
    const any = () => ED.sel.length > 0;
    Aero.init({
      name: 'Lumen Proto', icon: '../kit/icons/proto.png', doc: 'Untitled', dropTarget: stage, dropText: 'Drop .lproto to open, or SVG / PNG / JPEG to import',
      onDropFiles: files => IO.handleFiles(files, ED.lastDrop),
      onSave: () => IO.save(false),
      menus: {
        File: [['New', 'Ctrl+N', APP.newDoc], ['Open…', 'Ctrl+O', IO.open], ['Open Sample', '', APP.openSample], '-', ['Save', 'Ctrl+S', () => IO.save(false)], ['Save As…', 'Ctrl+Shift+S', () => IO.save(true)], '-',
          '#Design library', ['Import design library…', '', () => IO.importLibraryFile().catch(e => Aero.alert('Import library', e.message))], ['Export design library…', '', IO.exportLibrary], '-',
          ['Import review comments…', '', IO.importReviewFile],
          ['Import SVG / PNG / JPEG…', 'Ctrl+Shift+I', APP.import], ['Place image…', 'Ctrl+Shift+K', APP.placeImage], '-', '#Export',
          ['Artboards as PNG', 'Ctrl+Shift+E', () => IO.exportArtboards('png', 1)], ['Artboards as PNG @2x', '', () => IO.exportArtboards('png', 2)], ['Artboards as SVG', '', () => IO.exportArtboards('svg', 1)], ['Artboards as PDF', '', () => IO.exportArtboards('pdf', 2)],
          ['Selection (export settings)…', '', () => IO.exportNodes(ED.selNodes())], ['Batch export marked layers (ZIP)', 'Ctrl+Alt+E', IO.batchExport], '-', ['Interactive HTML prototype…', 'Ctrl+Alt+H', IO.exportHTML]],
        Edit: [{ label: 'Undo', key: 'Ctrl+Z', fn: ED.undo, disabled: () => ED.hist.index <= 0 }, { label: 'Redo', key: 'Ctrl+Y/Ctrl+Shift+Z', fn: ED.redo, disabled: () => ED.hist.index >= ED.hist.items.length - 1 }, '-',
          { label: 'Cut', key: 'Ctrl+X', noShortcut: true, fn: () => A.cut(), disabled: () => !any() }, { label: 'Copy', key: 'Ctrl+C', noShortcut: true, fn: () => A.copy(), disabled: () => !any() }, { label: 'Paste', key: 'Ctrl+V', noShortcut: true, fn: () => A.paste(), disabled: () => !A.clip },
          ['Duplicate', 'Ctrl+D', A.duplicate], ['Delete', 'Delete/Backspace', A.deleteSel], '-', ['Select all', 'Ctrl+A', A.selectAll], ['Select children', 'Enter', A.selectChildren], ['Select parent / deselect', 'Escape', () => { if (ED.penPts) { ED.finishPen(false); return; } if (document.querySelector('.lp-ctx')) { document.querySelector('.lp-ctx').remove(); return; } if (!ED.sel.length) return; A.selectParent(); }]],
        Object: [['Group', 'Ctrl+G', A.group], ['Ungroup', 'Ctrl+Shift+G', A.ungroup], ['Frame selection', 'Ctrl+Alt+G', A.wrapInFrame], '-', ['Add / remove auto layout', 'Shift+A', A.addAutoLayout], '-',
          '#Vector', ['Union selection', 'Ctrl+Alt+U', () => A.boolean('union')], ['Subtract selection', 'Ctrl+Alt+S', () => A.boolean('subtract')], ['Intersect selection', 'Ctrl+Alt+I', () => A.boolean('intersect')], ['Exclude selection', 'Ctrl+Alt+X', () => A.boolean('exclude')],
          ['Flatten', 'Ctrl+E', A.flatten], ['Edit points', '', A.editPoints], ['Use as mask', 'Ctrl+Alt+M', A.useAsMask], '-',
          ['Create component', 'Ctrl+Alt+K', A.createComponent], ['Add variant…', '', A.addVariant], ['Detach instance', 'Ctrl+Alt+B', A.detach], ['Reset overrides', '', A.resetOverrides], ['Go to main component', '', A.goToMain], '-',
          ['Bring to front', 'Ctrl+Shift+]', () => A.arrange('front')], ['Bring forward', 'Ctrl+]', () => A.arrange('forward')], ['Send backward', 'Ctrl+[', () => A.arrange('backward')], ['Send to back', 'Ctrl+Shift+[', () => A.arrange('back')], '-',
          ['Align left', 'Alt+A', () => A.align('left')], ['Align horizontal centers', 'Alt+H', () => A.align('hcenter')], ['Align right', 'Alt+D', () => A.align('right')], ['Align top', 'Alt+W', () => A.align('top')], ['Align vertical centers', 'Alt+V', () => A.align('vcenter')], ['Align bottom', 'Alt+S', () => A.align('bottom')],
          ['Distribute horizontally', 'Shift+Alt+H', () => A.distribute('h')], ['Distribute vertically', 'Shift+Alt+V', () => A.distribute('v')], ['Tidy up', 'Ctrl+Alt+T', A.tidyUp], '-',
          ['Flip path horizontal', 'Shift+H', () => A.flip('h')], ['Flip path vertical', 'Shift+V', () => A.flip('v')], ['Show / hide', 'Ctrl+Shift+H', () => A.toggle('visible')], ['Lock / unlock', 'Ctrl+Shift+L', () => A.toggle('locked')], ['Rename…', 'F2', () => { const n = ED.selNodes()[0]; if (n) ED.renameNode(n); }]],
        View: [['Zoom in', 'Ctrl+=', () => ED.zoomBy(1.25)], ['Zoom out', 'Ctrl+-', () => ED.zoomBy(0.8)], ['Zoom to fit', 'Ctrl+1', ED.zoomFit], ['Zoom to selection', 'Ctrl+2', ED.zoomSel], ['Actual size (100%)', 'Ctrl+0', ED.zoom100], '-',
          { label: 'Comments', key: 'Shift+C', fn: () => window.COMMENTS.toggleVisible(), checked: () => ED.showComments }, { label: 'Resolved comments', key: '', fn: () => { ED.showResolved = !ED.showResolved; ED.redraw(); window.COMMENTS.renderList(); }, checked: () => ED.showResolved },
          { label: 'Layout grids', key: "Ctrl+'", fn: () => { ED.showGrids = !ED.showGrids; ED.redraw(); }, checked: () => ED.showGrids }, { label: 'Snapping & smart guides', key: '', fn: () => { ED.snapOn = !ED.snapOn; }, checked: () => ED.snapOn }, '-',
          { label: 'Design mode', key: 'Alt+1', fn: () => APP.setMode('design'), checked: () => ED.mode === 'design' }, { label: 'Prototype mode', key: 'Alt+2', fn: () => APP.setMode('proto'), checked: () => ED.mode === 'proto' }, { label: 'Inspect mode (dev handoff)', key: 'Alt+3', fn: () => APP.setMode('inspect'), checked: () => ED.mode === 'inspect' }, '-',
          ['Preview prototype', 'Ctrl+Enter/F5', () => APP.preview()]],
        Help: [['Keyboard shortcuts', 'F1', shortcutsDialog], ['About Lumen Proto', '', aboutDialog]]
      }
    });
    // toolbox
    const I = {
      select: '<path d="M5 3l13 8-6 1.2L9 18z"/>', frame: '<path d="M7 3v18M17 3v18M3 7h18M3 17h18"/>', rect: '<rect x="4" y="5" width="16" height="14" rx="1.5"/>', ellipse: '<circle cx="12" cy="12" r="8"/>',
      line: '<path d="M5 19 19 5"/>', pen: '<path d="M12 19l7-7 3 3-7 7z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18z"/><circle cx="11" cy="11" r="2"/>', text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
      image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>', icon: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z"/>',
      hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-8a1.5 1.5 0 0 1 3 0V12M14 10.5V5a1.5 1.5 0 0 1 3 0v8.5M17 9a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-7 7h-1.2a7 7 0 0 1-5.7-3L3.5 14a1.6 1.6 0 0 1 2.5-2L8 14"/>'
    };
    ED.toolbox = Aero.toolbox($('#tools'), [
      { id: 'select', title: 'Select', key: 'V', icon: I.select }, null,
      { id: 'frame', title: 'Artboard / Frame', key: 'A', icon: I.frame }, { id: 'rect', title: 'Rectangle', key: 'R', icon: I.rect }, { id: 'ellipse', title: 'Ellipse', key: 'E', icon: I.ellipse },
      { id: 'line', title: 'Line', key: 'L', icon: I.line }, { id: 'pen', title: 'Pen', key: 'P', icon: I.pen }, { id: 'text', title: 'Text', key: 'T', icon: I.text }, null,
      { id: 'comment', title: 'Comment (review)', key: 'C', icon: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>' }, null,
      { id: 'image', title: 'Place image', icon: I.image }, { id: 'icon', title: 'Icons (Assets)', icon: I.icon }, null, { id: 'hand', title: 'Hand', key: 'H', icon: I.hand }
    ], id => {
      if (id === 'image') { setTimeout(() => ED.toolbox.set(ED.tool === 'image' ? 'select' : ED.tool), 0); APP.placeImage(); return; }
      if (id === 'icon') { setTimeout(() => ED.toolbox.set(ED.tool === 'icon' ? 'select' : ED.tool), 0); showLeft('assets'); setTimeout(() => document.querySelector('.isearch')?.scrollIntoView({ block: 'start' }), 30); return; }
      if (ED.mode !== 'design' && id !== 'select' && id !== 'hand') APP.setMode('design');
      if (ED.tool !== id) ED.setTool(id);
    });
    ED.toolbox.set('select');
    Aero.shortcut('F', () => ED.toolbox.set('frame'));
    Aero.shortcut('O', () => ED.toolbox.set('ellipse'));
    // extra shortcuts
    const nud = (dx, dy) => () => A.nudge(dx, dy);
    [['ArrowLeft', -1, 0], ['ArrowRight', 1, 0], ['ArrowUp', 0, -1], ['ArrowDown', 0, 1]].forEach(([k, dx, dy]) => { Aero.shortcut(k, nud(dx, dy)); Aero.shortcut('Shift+' + k, nud(dx * 10, dy * 10)); });
    Aero.shortcut('Ctrl+Shift+Enter', () => APP.preview());
    Aero.shortcut('Ctrl+}', () => A.arrange('front')); Aero.shortcut('Ctrl+{', () => A.arrange('back'));
    // left tabs
    document.querySelectorAll('#ltabs .aero-tab').forEach(t => t.onclick = () => showLeft(t.dataset.tab));
    document.querySelectorAll('#rtabs .aero-tab').forEach(t => t.onclick = () => APP.setMode(t.dataset.mode));
    P.initLayers($('#layers')); P.initAssets($('#assets')); P.initInspector($('#insp')); window.COMMENTS.initList($('#comments'));
    ED.listeners.hist.push(() => { if (!$('#history').hidden) Aero.renderHistory($('#history'), ED.hist, i => ED.goHist(i)); });
    // clipboard events (system clipboard aware)
    const typing = () => document.activeElement?.matches?.('input,textarea,select,[contenteditable=true]');
    document.addEventListener('copy', e => { if (typing() || document.querySelector('.aero-modal')) return; const t = A.copy(); if (t) { e.clipboardData.setData('text/plain', t); e.preventDefault(); } });
    document.addEventListener('cut', e => { if (typing() || document.querySelector('.aero-modal')) return; const t = A.cut(); if (t) { e.clipboardData.setData('text/plain', t); e.preventDefault(); } });
    document.addEventListener('paste', e => {
      if (typing() || document.querySelector('.aero-modal')) return;
      e.preventDefault();
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { Promise.all(files.map(async f => ({ name: f.name || 'pasted.png', type: f.type, data: await f.arrayBuffer() }))).then(fs => IO.handleFiles(fs)); return; }
      const t = e.clipboardData?.getData('text/plain') || '';
      if (t.startsWith('LPROTO:')) { try { A.paste(JSON.parse(t.slice(7))); } catch (err) { A.paste(); } return; }
      if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(t)) { try { IO.importSVG(t, 'Pasted SVG'); } catch (err) { Aero.toast('Could not paste SVG'); } return; }
      A.paste();
    });
    // drag & drop positions + assets drops
    stage.addEventListener('dragover', e => { const r = ED.canvas.getBoundingClientRect(); ED.lastDrop = ED.s2w(e.clientX - r.left, e.clientY - r.top); if ([...e.dataTransfer.types].some(t => t.startsWith('text/lproto'))) e.dataTransfer.dropEffect = 'copy'; });
    stage.addEventListener('drop', e => {
      const comp = e.dataTransfer.getData('text/lproto-comp'), icon = e.dataTransfer.getData('text/lproto-icon');
      const r = ED.canvas.getBoundingClientRect(), at = ED.s2w(e.clientX - r.left, e.clientY - r.top);
      if (comp && ED.get(comp)) { e.preventDefault(); A.insertComponent(ED.get(comp), at); }
      else if (icon) { e.preventDefault(); A.addIcon(icon, at); }
    });
    // pen: Enter finishes
    addEventListener('keydown', e => {
      if (e.key === 'Enter' && ED.penPts && !e.target.matches('input,textarea')) { e.preventDefault(); e.stopImmediatePropagation(); ED.finishPen(false); }
      if (e.key === 'Escape' && ED.pathEdit && !e.target.matches('input,textarea')) { e.preventDefault(); e.stopImmediatePropagation(); ED.exitPathEdit(); }
    }, true);
    APP.setMode('design');
    ED.setDoc(LP.newDoc(), 'Untitled');
    ED.view = { z: 1, x: 80, y: 60 };
    updateWelcome(); updateCmd(); updateStatus();
    document.fonts?.load?.('400 16px "Inter"').then(() => { ED.update(); ED.redraw(); });
    document.fonts?.ready?.then(() => { ED.update(); ED.redraw(); });
  }
  function showLeft(tab) {
    document.querySelectorAll('#ltabs .aero-tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
    $('#layers').hidden = tab !== 'layers'; $('#assets').hidden = tab !== 'assets'; $('#history').hidden = tab !== 'history'; $('#comments').hidden = tab !== 'comments';
    if (tab === 'comments') window.COMMENTS.renderList();
    if (tab === 'assets') P.renderAssets();
    if (tab === 'history') Aero.renderHistory($('#history'), ED.hist, i => ED.goHist(i));
  }
  APP.showLeft = showLeft;
  init();
})();
