'use strict';
/* Lumen Slides — user interface: menus, toolbox, command bar, slide list / sorter, Format, Animations, Design and
   History panels, colour picker, dialogs and slide/arrange operations. */
const UI = (() => {
  const M = Model, el = Aero.el, esc = Aero.esc;
  let tb = null, propsKey = '', animKey = '', designKey = '', animSel = null, ssel = new Set();
  const ICON = {
    select: '<path d="M6 3l12 9-6 .8L9 19z"/>', text: '<path d="M5 5h14M12 5v14M9 19h6"/>', rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8" ry="6.5"/>', line: '<path d="M5 19 19 5"/>', shapes: '<path d="M4 20l5-9 5 9z"/><circle cx="16.5" cy="7.5" r="3.5"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M5 17l5-5 4 4 2-2 4 3"/><circle cx="15.5" cy="9" r="1.6"/>',
    table: '<rect x="3.5" y="5" width="17" height="14"/><path d="M3.5 10h17M3.5 14.5h17M9.5 5v14M15 5v14"/>', chart: '<path d="M4 20h16"/><path d="M6 20v-6h3v6M11 20V8h3v12M16 20v-9h3v9"/>',
    hand: '<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11V5a1.5 1.5 0 0 1 3 0v6V6.5a1.5 1.5 0 0 1 3 0V14c0 3.5-2.5 6-6 6s-4.5-1.5-6-4l-2-3.2a1.5 1.5 0 0 1 2.5-1.6z"/>',
  };

  /* ---------------- init ---------------- */
  function init() {
    tb = Aero.toolbox($('#tools'), [
      { id: 'select', title: 'Select', key: 'V', icon: ICON.select }, null,
      { id: 'text', title: 'Text box', key: 'T', icon: ICON.text }, { id: 'rect', title: 'Rectangle', key: 'R', icon: ICON.rect }, { id: 'ellipse', title: 'Oval', key: 'O', icon: ICON.ellipse },
      { id: 'line', title: 'Line / arrow', key: 'L', icon: ICON.line }, { id: 'shapes', title: 'More shapes', key: 'S', icon: ICON.shapes }, null,
      { id: 'image', title: 'Picture…', icon: ICON.image }, { id: 'table', title: 'Table…', icon: ICON.table }, { id: 'chart', title: 'Chart…', icon: ICON.chart }, null,
      { id: 'hand', title: 'Pan', key: 'H', icon: ICON.hand },
    ], id => onTool(id));
    tb.set('select');
    buildMenus();
    buildCmd();
    // tabs
    document.querySelectorAll('#rtabs .aero-tab').forEach(t => t.onclick = () => { document.querySelectorAll('#rtabs .aero-tab').forEach(x => x.classList.toggle('on', x === t)); document.querySelectorAll('#rightside .tabpane').forEach(p => p.hidden = p.id !== t.dataset.p); propsKey = animKey = designKey = ''; refresh(true); });
    // slide list buttons
    $('#sl-add').onclick = () => newSlide(); $('#sl-dup').onclick = dupSlide; $('#sl-del').onclick = delSlides;
    $('#sl-up').onclick = () => moveSlide(-1); $('#sl-down').onclick = () => moveSlide(1); $('#sl-hide').onclick = hideSlides;
    $('#slides').addEventListener('keydown', e => {
      if (e.target.closest('input,textarea')) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); e.stopPropagation(); goSlide(S.cur + 1); }
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); e.stopPropagation(); goSlide(S.cur - 1); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && S.mode === 'slide') { e.preventDefault(); e.stopPropagation(); delSlides(); }
    }, true);
    $('#mb-close').onclick = () => setMode('slide');
    // notes
    const notes = $('#notes');
    notes.addEventListener('input', () => { const s = curSlide(); if (!s) return; s.notes = notes.value; commit('Edit notes', { merge: true, panels: false }); });
    let nsDrag = null;
    $('#notesplit').addEventListener('pointerdown', e => { nsDrag = { y: e.clientY, h: $('#notesbox').offsetHeight }; e.target.setPointerCapture(e.pointerId); });
    $('#notesplit').addEventListener('pointermove', e => { if (!nsDrag) return; $('#notesbox').style.height = Aero.clamp(nsDrag.h - (e.clientY - nsDrag.y), 40, 420) + 'px'; });
    $('#notesplit').addEventListener('pointerup', () => { nsDrag = null; });
  }
  function onTool(id) {
    if (id === 'image') { tb.set('select'); IO.insertPicture(); return; }
    if (id === 'table') { tb.set('select'); insertTableDialog(); return; }
    if (id === 'chart') { tb.set('select'); insertChart(); return; }
    if (id === 'shapes') { const b = document.querySelector('.aero-tool[data-tool="shapes"]'); shapeGallery(b, g => { S.geom = g; S.tool = g === 'line' ? 'line' : 'shape'; markTool('shapes'); }); return; }
    if (id === 'rect') S.geom = 'rect'; if (id === 'ellipse') S.geom = 'ellipse';
    S.tool = id === 'rect' || id === 'ellipse' ? 'shape' : id;
    if (S.edit) Editor.endEdit(true);
    $('#cv').style.cursor = S.tool === 'select' ? 'default' : S.tool === 'hand' ? 'grab' : 'crosshair';
    status();
  }
  function markTool(id) { document.querySelectorAll('#tools .aero-tool').forEach(b => b.classList.toggle('on', b.dataset.tool === id)); }
  function setTool(id) { tb.set(id); }

  /* ---------------- menus ---------------- */
  function buildMenus() {
    const sel1 = () => selObjs().length === 0, noSel = sel1;
    const inShow = () => showActive();
    Aero.menus({
      File: [['New', 'Ctrl+N', () => IO.newDoc()], ['New from Theme…', '', newFromTheme], ['Open…', 'Ctrl+O', () => IO.open()], ['Open Sample', '', () => IO.openSample()], '-',
        ['Save', 'Ctrl+S', () => IO.save()], ['Save As…', 'Ctrl+Shift+S', () => IO.save(true)], '-',
        '#Export', ['PowerPoint (.pptx)…', 'Ctrl+Shift+E', () => IO.exportPptx()], ['PDF…', 'Ctrl+P', () => IO.exportPdf()], ['All Slides as PNG (zip)…', '', () => IO.exportPngs()], ['Current Slide as PNG…', '', () => IO.exportPng()], '-',
        ['Import Slides from File…', '', () => IO.importSlides()], ['Import Theme (.thmx / .pptx)…', '', () => IO.importTheme()]],
      Edit: [{ label: 'Undo', key: 'Ctrl+Z', fn: undo, disabled: () => S.hist.index <= 0 }, { label: 'Redo', key: 'Ctrl+Y/Ctrl+Shift+Z', fn: redo, disabled: () => S.hist.index >= S.hist.items.length - 1 }, '-',
        { label: 'Cut', key: 'Ctrl+X', fn: () => Editor.copy(true), disabled: noSel }, { label: 'Copy', key: 'Ctrl+C', fn: () => Editor.copy(), disabled: noSel }, { label: 'Paste', key: 'Ctrl+V', fn: () => Editor.paste(), disabled: () => !S.clip, noShortcut: true },
        { label: 'Duplicate', key: 'Ctrl+D', fn: duplicate, disabled: noSel }, { label: 'Delete', key: 'Delete', fn: () => Editor.del(), disabled: noSel }, '-',
        ['Select All', 'Ctrl+A', () => select(topObjs().filter(o => !o.locked).map(o => o.id))], { label: 'Lock / Unlock', key: 'Ctrl+Shift+L', fn: toggleLock, disabled: noSel }, '-', ['Find & Replace…', 'Ctrl+H', findReplace]],
      View: [{ label: 'Normal', key: '', fn: () => { setMode('slide'); setSorter(false); }, checked: () => S.mode === 'slide' && !S.sorter }, { label: 'Slide Sorter', key: 'Ctrl+Shift+O', fn: () => setSorter(!S.sorter), checked: () => S.sorter }, { label: 'Slide Master', key: '', fn: () => setMode(S.mode === 'master' ? 'slide' : 'master'), checked: () => S.mode === 'master' }, '-',
        ['Zoom In', 'Ctrl+=', () => View.zoomBy(1.25)], ['Zoom Out', 'Ctrl+-', () => View.zoomBy(0.8)], ['Fit Slide', 'Ctrl+0', () => View.fit()], ['Actual Size (100%)', 'Ctrl+1', () => View.actual()], '-',
        { label: 'Notes Pane', key: '', fn: () => { S.opt.notes = !S.opt.notes; $('#notesbox').hidden = $('#notesplit').hidden = !S.opt.notes; }, checked: () => S.opt.notes },
        { label: 'Smart Guides', key: '', fn: () => { S.opt.guides = !S.opt.guides; }, checked: () => S.opt.guides }, { label: 'Snap to Objects', key: '', fn: () => { S.opt.snap = !S.opt.snap; }, checked: () => S.opt.snap }],
      Insert: [['New Slide', 'Ctrl+M', () => newSlide()], ['Duplicate Slide', 'Ctrl+Shift+D', dupSlide], '-', ['Text Box', '', () => setTool('text')], ['Shape…', '', () => setTool('shapes')], ['Picture…', 'Ctrl+Shift+P', () => IO.insertPicture()], ['Table…', '', insertTableDialog], ['Chart…', '', insertChart], '-', ['Header & Footer…', '', footerDialog], ['Slide Number Field', '', insertSlideNum]],
      Format: [['Bold', 'Ctrl+B', () => Editor.format('b')], ['Italic', 'Ctrl+I', () => Editor.format('i')], ['Underline', 'Ctrl+U', () => Editor.format('u')], ['Strikethrough', '', () => Editor.format('s')], '-',
        ['Increase Font Size', 'Ctrl+]', () => fontStep(1)], ['Decrease Font Size', 'Ctrl+[', () => fontStep(-1)], '-',
        ['Align Left', 'Ctrl+L', () => Editor.paraFormat('align', 'l')], ['Center', 'Ctrl+E', () => Editor.paraFormat('align', 'c')], ['Align Right', 'Ctrl+R', () => Editor.paraFormat('align', 'r')], ['Justify', 'Ctrl+J', () => Editor.paraFormat('align', 'j')], '-',
        ['Bullets', '', () => Editor.paraFormat('bullet', '•')], ['Numbering', '', () => Editor.paraFormat('bullet', { num: 'arabicPeriod', start: 1 })], ['Increase List Level', 'Shift+Alt+ArrowRight', () => Editor.paraFormat('level', 1)], ['Decrease List Level', 'Shift+Alt+ArrowLeft', () => Editor.paraFormat('level', -1)], '-',
        ['Slide Background…', '', () => { selectTab('tp-format'); select([]); }], ['Slide Size…', '', slideSizeDialog]],
      Arrange: [{ label: 'Bring to Front', key: 'Ctrl+Shift+F', fn: () => zorder('front'), disabled: noSel }, { label: 'Bring Forward', key: 'Ctrl+Alt+]', fn: () => zorder('fwd'), disabled: noSel }, { label: 'Send Backward', key: 'Ctrl+Alt+[', fn: () => zorder('back1'), disabled: noSel }, { label: 'Send to Back', key: 'Ctrl+Shift+B', fn: () => zorder('back'), disabled: noSel }, '-',
        { label: 'Group', key: 'Ctrl+G', fn: group, disabled: () => selObjs().length < 2 }, { label: 'Ungroup', key: 'Ctrl+Shift+G', fn: ungroup, disabled: () => !selObjs().some(o => o.type === 'group') }, '-',
        '#Align', ['Align Left', '', () => align('l')], ['Align Center', '', () => align('c')], ['Align Right', '', () => align('r')], ['Align Top', '', () => align('t')], ['Align Middle', '', () => align('m')], ['Align Bottom', '', () => align('b')],
        ['Distribute Horizontally', '', () => distribute('h')], ['Distribute Vertically', '', () => distribute('v')], '-',
        ['Rotate Right 90°', '', () => rotate(90)], ['Rotate Left 90°', '', () => rotate(-90)], ['Flip Horizontal', '', () => flip('h')], ['Flip Vertical', '', () => flip('v')]],
      'Slide Show': [['From Beginning', 'F5', () => Present.start(0)], ['From Current Slide', 'Shift+F5', () => Present.start(S.cur)], ['Presenter View', 'Alt+F5', () => Present.start(S.cur, true)], '-',
        { label: 'Loop Until Esc', key: '', fn: () => { S.opt.loop = !S.opt.loop; }, checked: () => S.opt.loop }, { label: 'Hide Slide', key: '', fn: hideSlides, checked: () => !!(curSlide() && curSlide().hidden) }, '-', ['Preview Animations', '', previewAnims]],
      Help: [['Keyboard Shortcuts', 'F1', shortcutsDialog], ['About Lumen Slides', '', aboutDialog]],
    });
    // extra keys (single keys are ignored while typing)
    Aero.shortcut('ArrowLeft', () => Editor.nudge(-1, 0)); Aero.shortcut('ArrowRight', () => Editor.nudge(1, 0)); Aero.shortcut('ArrowUp', () => Editor.nudge(0, -1)); Aero.shortcut('ArrowDown', () => Editor.nudge(0, 1));
    Aero.shortcut('Shift+ArrowLeft', () => Editor.nudge(-10, 0)); Aero.shortcut('Shift+ArrowRight', () => Editor.nudge(10, 0)); Aero.shortcut('Shift+ArrowUp', () => Editor.nudge(0, -10)); Aero.shortcut('Shift+ArrowDown', () => Editor.nudge(0, 10));
    Aero.shortcut('Backspace', () => Editor.del());
    Aero.shortcut('PageDown', () => goSlide(S.cur + 1)); Aero.shortcut('PageUp', () => goSlide(S.cur - 1));
    Aero.shortcut('Home', () => goSlide(0)); Aero.shortcut('End', () => goSlide(S.doc.slides.length - 1));
    void inShow;
  }
  function selectTab(id) { document.querySelectorAll('#rtabs .aero-tab').forEach(x => x.classList.toggle('on', x.dataset.p === id)); document.querySelectorAll('#rightside .tabpane').forEach(p => p.hidden = p.id !== id); propsKey = animKey = designKey = ''; refresh(true); }

  /* ---------------- command bar ---------------- */
  const C = {};
  const svgI = inner => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#1e395b" stroke-width="1.4">${inner}</svg>`;
  function buildCmd() {
    const cmd = $('#cmd'); cmd.innerHTML = '';
    const g = () => { const d = el('div', 'cg'); cmd.appendChild(d); return d; };
    const btn = (p, html, title, fn, cls = 'small') => { const b = el('button', 'aero-btn ' + cls, html); b.title = title; b.onmousedown = e => e.preventDefault(); b.onclick = fn; p.appendChild(b); return b; };
    let p = g();
    C.newSlide = btn(p, `<svg width="16" height="16"><use href="#i-new"/></svg>`, 'New slide (Ctrl+M)', () => newSlide()); C.newSlide.style.minWidth = '28px';
    C.layoutBtn = btn(p, 'Layout ▾', 'Change the slide layout', e => layoutMenu(e.currentTarget));
    cmd.appendChild(el('span', 'sep'));
    p = g();
    C.font = el('select'); C.font.title = 'Font'; C.font.style.width = '140px'; p.appendChild(C.font);
    C.font.onchange = () => Editor.format('font', C.font.value);
    C.size = el('input'); C.size.type = 'number'; C.size.min = 1; C.size.max = 400; C.size.step = 1; C.size.title = 'Font size (pt)'; p.appendChild(C.size);
    C.size.onchange = () => { const v = parseFloat(C.size.value); if (v > 0) Editor.format('size', v); };
    C.size.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); C.size.dispatchEvent(new Event('change')); } };
    btn(p, 'A▴', 'Increase font size (Ctrl+])', () => fontStep(1)); btn(p, 'A▾', 'Decrease font size (Ctrl+[)', () => fontStep(-1));
    p = g();
    C.b = btn(p, '<b>B</b>', 'Bold (Ctrl+B)', () => Editor.format('b')); C.i = btn(p, '<i style="font-family:Georgia">I</i>', 'Italic (Ctrl+I)', () => Editor.format('i'));
    C.u = btn(p, '<u>U</u>', 'Underline (Ctrl+U)', () => Editor.format('u')); C.s = btn(p, '<s>S</s>', 'Strikethrough', () => Editor.format('s'));
    C.color = btn(p, 'A<i></i>', 'Font colour', e => colorPop(e.currentTarget, null, c => Editor.format('color', c)), 'small cbtn-color'); C.color.querySelector('i').style.background = '#c00';
    cmd.appendChild(el('span', 'sep'));
    p = g();
    const AL = { l: '<path d="M2 3h12M2 6.3h8M2 9.6h12M2 13h8"/>', c: '<path d="M2 3h12M4 6.3h8M2 9.6h12M4 13h8"/>', r: '<path d="M2 3h12M6 6.3h8M2 9.6h12M6 13h8"/>', j: '<path d="M2 3h12M2 6.3h12M2 9.6h12M2 13h12"/>' };
    C.al = {}; for (const k of ['l', 'c', 'r', 'j']) C.al[k] = btn(p, svgI(AL[k]), { l: 'Align left (Ctrl+L)', c: 'Center (Ctrl+E)', r: 'Align right (Ctrl+R)', j: 'Justify (Ctrl+J)' }[k], () => Editor.paraFormat('align', k));
    C.bul = btn(p, svgI('<circle cx="3" cy="4" r="1.2" fill="#1e395b"/><circle cx="3" cy="8" r="1.2" fill="#1e395b"/><circle cx="3" cy="12" r="1.2" fill="#1e395b"/><path d="M6.5 4h7.5M6.5 8h7.5M6.5 12h7.5"/>'), 'Bullets', () => Editor.paraFormat('bullet', '•'));
    C.num = btn(p, svgI('<text x="1" y="6" font-size="5" fill="#1e395b" stroke="none" font-family="Segoe UI">1.</text><text x="1" y="13" font-size="5" fill="#1e395b" stroke="none" font-family="Segoe UI">2.</text><path d="M6.5 4.5h7.5M6.5 11.5h7.5"/>'), 'Numbering', () => Editor.paraFormat('bullet', { num: 'arabicPeriod', start: 1 }));
    btn(p, svgI('<path d="M6 4h8M6 8h8M6 12h8M4.5 6 2 8l2.5 2"/>'), 'Decrease list level (Shift+Tab)', () => Editor.paraFormat('level', -1));
    btn(p, svgI('<path d="M6 4h8M6 8h8M6 12h8M2 6l2.5 2L2 10"/>'), 'Increase list level (Tab)', () => Editor.paraFormat('level', 1));
    cmd.appendChild(el('span', 'sep'));
    p = g();
    C.fill = btn(p, svgI('<path d="M3 9 8 4l5 5-5 5z" fill="#fff"/><path d="M13 10.5c0 1 .7 2 1.3 2" />') + '<i></i>', 'Shape fill', e => colorPop(e.currentTarget, null, c => setFill(c), { none: 'No fill' }), 'small cbtn-color');
    C.line = btn(p, svgI('<rect x="3" y="3" width="10" height="9" fill="#fff"/>') + '<i></i>', 'Shape outline', e => colorPop(e.currentTarget, null, c => setLineColor(c), { none: 'No outline' }), 'small cbtn-color');
    C.arr = btn(p, 'Arrange ▾', 'Order, align, group', e => arrangeMenu(e.currentTarget));
    const pr = el('div', 'cg present'); cmd.appendChild(pr);
    C.play = btn(pr, `<svg width="14" height="14"><use href="#i-play"/></svg> Present`, 'Start the slide show from the current slide (Shift+F5)', () => Present.start(S.cur), ''); C.play.style.display = 'inline-flex'; C.play.style.gap = '4px'; C.play.style.alignItems = 'center';
    fillFontSelect();
  }
  function fillFontSelect() {
    const s = C.font, th = S.doc ? S.doc.theme : M.makeTheme('lumen');
    s.innerHTML = '';
    const og1 = el('optgroup'); og1.label = 'Theme fonts';
    og1.appendChild(new Option(`${th.fonts.major} (Headings)`, '+mj')); og1.appendChild(new Option(`${th.fonts.minor} (Body)`, '+mn')); s.appendChild(og1);
    const og2 = el('optgroup'); og2.label = 'Bundled'; Fonts.BUNDLED.forEach(f => og2.appendChild(new Option(f, f))); s.appendChild(og2);
    const og3 = el('optgroup'); og3.label = 'System'; Fonts.SYSTEM.forEach(f => og3.appendChild(new Option(f, f))); s.appendChild(og3);
  }
  function updateCmd() {
    const st = Editor.caretStyle(), textOn = !!st;
    for (const k of ['font', 'size']) C[k].disabled = !textOn;
    if (st) {
      const th = S.doc.theme; const v = st.font === th.fonts.major ? '+mj' : st.font === th.fonts.minor ? '+mn' : st.font;
      if (![...C.font.options].some(o => o.value === v)) C.font.appendChild(new Option(v, v));
      if (document.activeElement !== C.font) C.font.value = v;
      if (document.activeElement !== C.size) C.size.value = st.size;
      C.b.classList.toggle('on', !!st.b); C.i.classList.toggle('on', !!st.i); C.u.classList.toggle('on', !!st.u); C.s.classList.toggle('on', !!st.s);
      for (const k in C.al) C.al[k].classList.toggle('on', st.align === k);
      C.bul.classList.toggle('on', typeof st.bullet === 'string'); C.num.classList.toggle('on', !!st.bullet && typeof st.bullet === 'object');
      C.color.querySelector('i').style.background = st.color || '#000';
    } else { [C.b, C.i, C.u, C.s, C.bul, C.num, ...Object.values(C.al)].forEach(b => b.classList.remove('on')); C.size.value = ''; }
    const one = selObjs()[0];
    C.fill.querySelector('i').style.background = one && one.fill && one.fill.color ? M.color(one.fill.color, S.doc.theme) : 'transparent';
    C.line.querySelector('i').style.background = one && one.line ? M.color(one.line.color, S.doc.theme) : 'transparent';
    C.layoutBtn.disabled = S.mode !== 'slide';
  }
  function fontStep(d) {
    const st = Editor.caretStyle(); if (!st) return;
    const SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 48, 54, 60, 66, 72, 80, 88, 96];
    const cur = st.size || 18; let n = d > 0 ? SIZES.find(s => s > cur + 0.01) || cur + 8 : [...SIZES].reverse().find(s => s < cur - 0.01) || Math.max(1, cur - 1);
    Editor.format('size', n);
  }

  /* ---------------- colour picker ---------------- */
  let pop = null;
  function closePop() { if (pop) { pop.remove(); pop = null; document.removeEventListener('pointerdown', popOutside, true); } }
  function popOutside(e) { if (pop && !pop.contains(e.target)) closePop(); }
  function placePop(p, anchor) {
    document.body.appendChild(p); const r = anchor.getBoundingClientRect(), w = p.offsetWidth, h = p.offsetHeight;
    p.style.left = Math.max(4, Math.min(innerWidth - w - 4, r.left)) + 'px'; p.style.top = (r.bottom + h + 4 > innerHeight ? Math.max(4, r.top - h - 2) : r.bottom + 2) + 'px';
    setTimeout(() => document.addEventListener('pointerdown', popOutside, true), 0);
  }
  function colorPop(anchor, cur, onPick, o = {}) {
    closePop();
    const th = S.doc.theme, p = el('div', 'cpop'); pop = p;
    p.onmousedown = e => { if (e.target.tagName !== 'INPUT') e.preventDefault(); };
    const names = ['bg1', 'tx1', 'bg2', 'tx2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
    const add = (grid, c, title) => { const d = el('div', 'c'); d.style.background = M.color(c, th); d.title = title || c; d.onclick = () => { closePop(); onPick(c); }; grid.appendChild(d); };
    if (o.none) { const n = el('div', 'none', `<span class="swbtn none"></span>${esc(o.none)}`); n.onclick = () => { closePop(); onPick(null); }; p.appendChild(n); }
    p.appendChild(el('div', 'cph', 'Theme Colours'));
    const g1 = el('div', 'grid'); names.forEach(n => add(g1, n, n)); p.appendChild(g1);
    const g2 = el('div', 'grid tints');
    for (const m of [':+80', ':+60', ':+40', ':-25', ':-50']) names.forEach(n => add(g2, n + m, n + ' ' + (m[1] === '+' ? 'lighter ' : 'darker ') + m.slice(2) + '%'));
    g2.style.marginTop = '3px'; p.appendChild(g2);
    p.appendChild(el('div', 'cph', 'Standard Colours'));
    const g3 = el('div', 'grid'); ['#c00000', '#ff0000', '#ffc000', '#ffff00', '#92d050', '#00b050', '#00b0f0', '#0070c0', '#002060', '#7030a0'].forEach(c => add(g3, c)); p.appendChild(g3);
    const row = el('div', 'row', '<span>Custom</span>'); const inp = el('input'); inp.type = 'color'; inp.value = cur && cur[0] === '#' ? cur : '#3366cc';
    inp.onchange = () => { closePop(); onPick(inp.value); }; row.appendChild(inp); p.appendChild(row);
    placePop(p, anchor);
  }
  function shapeGallery(anchor, onPick) {
    closePop();
    const p = el('div', 'gpop'); pop = p;
    for (const [g, name] of M.GEOMS) {
      const b = el('button'); b.title = name; const c = el('canvas'); c.width = 56; c.height = 48; b.appendChild(c);
      const x = c.getContext('2d'); x.translate(6, 6); const path = Render.geomPath(g, 44, 36, {}); x.fillStyle = '#7fb2ea'; x.strokeStyle = '#1e5fa8'; x.lineWidth = 2;
      if (g !== 'line') x.fill(path, g === 'donut' ? 'evenodd' : 'nonzero'); x.stroke(path);
      b.onclick = () => { closePop(); onPick(g); }; p.appendChild(b);
    }
    placePop(p, anchor);
  }
  function menuPop(anchor, items) {
    closePop();
    const p = el('div', 'ctx'), dd = el('div', 'aero-dropdown'); p.appendChild(dd); pop = p;
    for (const it of items) {
      if (it === '-') { dd.appendChild(el('div', 'aero-msep')); continue; }
      if (typeof it === 'string' && it[0] === '#') { dd.appendChild(el('div', 'aero-mhead', esc(it.slice(1)))); continue; }
      const mi = el('div', 'aero-mi', `<span>${esc(it.label)}</span><span class="k">${esc(it.key || '')}</span>`);
      if (it.checked) mi.classList.add('checked'); if (it.disabled) mi.classList.add('disabled');
      mi.onclick = () => { closePop(); if (!it.disabled) it.fn(); }; dd.appendChild(mi);
    }
    if (anchor.x != null) { document.body.appendChild(p); p.style.left = Math.min(innerWidth - p.offsetWidth - 4, anchor.x) + 'px'; p.style.top = Math.min(innerHeight - p.offsetHeight - 4, anchor.y) + 'px'; setTimeout(() => document.addEventListener('pointerdown', popOutside, true), 0); }
    else placePop(p, anchor);
  }
  function layoutMenu(anchor, forNew) {
    menuPop(anchor, S.doc.layouts.map(l => ({ label: l.name, checked: !forNew && curSlide() && curSlide().layout === l.id, fn: () => forNew ? newSlide(l.id) : setLayout(l.id) })));
  }
  function arrangeMenu(anchor) {
    const n = selObjs().length;
    menuPop(anchor, [{ label: 'Bring to Front', fn: () => zorder('front'), disabled: !n }, { label: 'Bring Forward', fn: () => zorder('fwd'), disabled: !n }, { label: 'Send Backward', fn: () => zorder('back1'), disabled: !n }, { label: 'Send to Back', fn: () => zorder('back'), disabled: !n }, '-',
      { label: 'Group', key: 'Ctrl+G', fn: group, disabled: n < 2 }, { label: 'Ungroup', key: 'Ctrl+Shift+G', fn: ungroup, disabled: !selObjs().some(o => o.type === 'group') }, '-',
      { label: 'Align Left', fn: () => align('l'), disabled: !n }, { label: 'Align Center', fn: () => align('c'), disabled: !n }, { label: 'Align Right', fn: () => align('r'), disabled: !n }, { label: 'Align Top', fn: () => align('t'), disabled: !n }, { label: 'Align Middle', fn: () => align('m'), disabled: !n }, { label: 'Align Bottom', fn: () => align('b'), disabled: !n },
      { label: 'Distribute Horizontally', fn: () => distribute('h'), disabled: n < 3 }, { label: 'Distribute Vertically', fn: () => distribute('v'), disabled: n < 3 }, '-',
      { label: 'Rotate Right 90°', fn: () => rotate(90), disabled: !n }, { label: 'Flip Horizontal', fn: () => flip('h'), disabled: !n }, { label: 'Flip Vertical', fn: () => flip('v'), disabled: !n }]);
  }
  function contextMenu(e) {
    const n = selObjs().length;
    const one = selObjs()[0];
    const items = [{ label: 'Cut', key: 'Ctrl+X', fn: () => Editor.copy(true), disabled: !n }, { label: 'Copy', key: 'Ctrl+C', fn: () => Editor.copy(), disabled: !n }, { label: 'Paste', key: 'Ctrl+V', fn: () => Editor.paste(), disabled: !S.clip }, { label: 'Duplicate', key: 'Ctrl+D', fn: duplicate, disabled: !n }, { label: 'Delete', key: 'Del', fn: () => Editor.del(), disabled: !n }, '-'];
    if (n) {
      if (one && Editor.isText(one) && n === 1) items.push({ label: 'Edit Text', key: 'Enter', fn: () => Editor.beginEdit(one, {}) });
      if (one && one.type === 'chart') items.push({ label: 'Edit Chart Data…', fn: () => editChartData(one) });
      if (one && one.type === 'image') items.push({ label: 'Crop Picture…', fn: () => cropDialog(one) }, { label: 'Reset Picture Size', fn: () => resetImage(one) });
      items.push({ label: 'Bring to Front', fn: () => zorder('front') }, { label: 'Send to Back', fn: () => zorder('back') });
      if (n > 1) items.push({ label: 'Group', key: 'Ctrl+G', fn: group }); if (selObjs().some(o => o.type === 'group')) items.push({ label: 'Ungroup', key: 'Ctrl+Shift+G', fn: ungroup });
      if (S.mode === 'slide') items.push('-', { label: 'Add Animation…', fn: () => { selectTab('tp-anim'); } });
    } else items.push({ label: 'New Slide', fn: () => newSlide() }, { label: 'Layout', fn: () => layoutMenu({ x: e.clientX, y: e.clientY }) }, { label: 'Format Background…', fn: () => selectTab('tp-format') });
    menuPop({ x: e.clientX, y: e.clientY }, items);
  }

  /* ---------------- slides list ---------------- */
  let listSig = '';
  function renderSlides() {
    const list = $('#slides');
    const master = S.mode === 'master';
    $('#lefttitle').textContent = master ? 'Master & Layouts' : 'Slides';
    $('#slidebar').style.display = master ? 'none' : '';
    const sig = master ? 'm' + S.doc.layouts.map(l => l.id).join() : S.doc.slides.map(s => s.id + (s.hidden ? 'h' : '')).join();
    if (sig !== listSig) {
      listSig = sig; list.innerHTML = '';
      if (master) {
        const mk = (i, label) => { const d = el('div', 'sl'); d.dataset.i = i; const col = el('div', 'col'); const c = el('canvas'); col.appendChild(c); col.appendChild(el('div', 'lname', esc(label))); d.appendChild(el('span', 'n', i < 0 ? '' : '')); d.appendChild(col); d.onclick = () => { S.mcur = i; S.sel = []; Editor.endEdit(true); changed(true); }; list.appendChild(d); return d; };
        mk(-1, 'Slide Master').style.marginBottom = '6px';
        S.doc.layouts.forEach((l, i) => { const d = mk(i, l.name); d.style.paddingLeft = '16px'; });
      } else {
        S.doc.slides.forEach((s, i) => {
          const d = el('div', 'sl' + (s.hidden ? ' hid' : '')); d.dataset.i = i; d.draggable = true;
          d.appendChild(el('span', 'n', String(i + 1))); const c = el('canvas'); d.appendChild(c);
          const bd = el('div', 'badges'); d.appendChild(bd);
          d.onclick = e => slideClick(i, e);
          d.oncontextmenu = e => { e.preventDefault(); if (!ssel.has(i)) slideClick(i, {}); slideCtx(e); };
          d.ondblclick = () => { if (S.sorter) setSorter(false); };
          d.ondragstart = e => { e.dataTransfer.setData('text/x-slide', String(i)); e.dataTransfer.effectAllowed = 'move'; };
          d.ondragover = e => { if (![...e.dataTransfer.types].includes('text/x-slide')) return; e.preventDefault(); const r = d.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; list.querySelectorAll('.sl').forEach(x => x.classList.remove('drop-before', 'drop-after')); d.classList.add(after ? 'drop-after' : 'drop-before'); };
          d.ondragleave = () => d.classList.remove('drop-before', 'drop-after');
          d.ondrop = e => { e.preventDefault(); const from = +e.dataTransfer.getData('text/x-slide'); const r = d.getBoundingClientRect(); const after = e.clientY > r.top + r.height / 2; list.querySelectorAll('.sl').forEach(x => x.classList.remove('drop-before', 'drop-after')); reorder(ssel.has(from) ? [...ssel] : [from], i + (after ? 1 : 0)); };
          list.appendChild(d);
        });
      }
    }
    // update selection + thumbnails
    [...list.children].forEach(d => {
      const i = +d.dataset.i, c = d.querySelector('canvas');
      if (master) { d.classList.toggle('sel', i === S.mcur); Thumbs.drawLayout(c, i < 0 ? null : S.doc.layouts[i], i < 0 ? 150 : 136); }
      else {
        const s = S.doc.slides[i]; if (!s) return;
        d.classList.toggle('sel', i === S.cur); d.classList.toggle('multi', ssel.has(i) && i !== S.cur && ssel.size > 1);
        Thumbs.draw(c, s, 150);
        const bd = d.querySelector('.badges'); const want = (s.anims.length ? 'a' : '') + (s.transition.type !== 'none' ? 't' : '');
        if (bd.dataset.k !== want) { bd.dataset.k = want; bd.innerHTML = (s.transition.type !== 'none' ? '<svg title="Transition"><use href="#i-play"/></svg>' : '') + (s.anims.length ? '<svg title="Animations"><use href="#i-star"/></svg>' : ''); }
      }
    });
    $('#scount').textContent = master ? `${S.doc.layouts.length} layouts` : `${S.doc.slides.length} slide${S.doc.slides.length === 1 ? '' : 's'}`;
    const sd = list.querySelector('.sl.sel'); if (sd && !thumbsSoon.scrolled) sd.scrollIntoView({ block: 'nearest' });
  }
  function thumbsSoon(force) { if (force) Thumbs.keys = new WeakMap(); clearTimeout(thumbsSoon.t); thumbsSoon.t = setTimeout(() => { renderSlides(); if (S.sorter) renderSorter(); }, 60); }
  function slideClick(i, e) {
    if (e.shiftKey) { const a = Math.min(S.cur, i), b = Math.max(S.cur, i); ssel = new Set(Array.from({ length: b - a + 1 }, (_, k) => a + k)); }
    else if (e.ctrlKey) { if (ssel.has(i) && ssel.size > 1) ssel.delete(i); else ssel.add(i); }
    else ssel = new Set([i]);
    goSlide(i, true);
  }
  function slideCtx(e) {
    menuPop({ x: e.clientX, y: e.clientY }, [{ label: 'New Slide', key: 'Ctrl+M', fn: () => newSlide() }, { label: 'Duplicate Slide', fn: dupSlide }, { label: 'Delete Slide', fn: delSlides }, '-', { label: 'Layout', fn: () => layoutMenu({ x: e.clientX, y: e.clientY }) }, { label: curSlide().hidden ? 'Show Slide' : 'Hide Slide', fn: hideSlides }, '-', { label: 'Present From Here', fn: () => Present.start(S.cur) }]);
  }
  function goSlide(i, keepSel) {
    if (S.mode !== 'slide' || !S.doc.slides.length) return;
    i = Aero.clamp(i, 0, S.doc.slides.length - 1);
    if (i === S.cur && keepSel) { refresh(false); return; }
    Editor.endEdit(true);
    S.cur = i; S.sel = []; S.inGroup = null; if (!keepSel) ssel = new Set([i]);
    propsKey = animKey = ''; requestRender(); refresh(true);
  }
  function renderSorter() {
    const box = $('#sorter'); const W = 240;
    if (box.dataset.sig !== S.doc.slides.map(s => s.id + s.hidden).join()) {
      box.dataset.sig = S.doc.slides.map(s => s.id + s.hidden).join(); box.innerHTML = '';
      S.doc.slides.forEach((s, i) => {
        const d = el('div', 'ss' + (s.hidden ? ' hid' : '')); d.dataset.i = i; d.draggable = true; const c = el('canvas'); d.appendChild(c);
        d.appendChild(el('div', 'n', `<b>${i + 1}</b>${s.transition.type !== 'none' ? '<svg width="12" height="12"><use href="#i-play"/></svg>' : ''}${s.anims.length ? '<svg width="12" height="12"><use href="#i-star"/></svg>' : ''}${s.hidden ? '<span class="dim">hidden</span>' : ''}`));
        d.onclick = e => slideClick(i, e); d.ondblclick = () => { S.cur = i; setSorter(false); };
        d.oncontextmenu = e => { e.preventDefault(); if (!ssel.has(i)) slideClick(i, {}); slideCtx(e); };
        d.ondragstart = e => { e.dataTransfer.setData('text/x-slide', String(i)); };
        d.ondragover = e => { e.preventDefault(); const r = d.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2; box.querySelectorAll('.ss').forEach(x => x.classList.remove('drop-before', 'drop-after')); d.classList.add(after ? 'drop-after' : 'drop-before'); };
        d.ondrop = e => { e.preventDefault(); const from = +e.dataTransfer.getData('text/x-slide'), r = d.getBoundingClientRect(), after = e.clientX > r.left + r.width / 2; box.querySelectorAll('.ss').forEach(x => x.classList.remove('drop-before', 'drop-after')); reorder(ssel.has(from) ? [...ssel] : [from], i + (after ? 1 : 0)); };
        box.appendChild(d);
      });
    }
    [...box.children].forEach(d => { const i = +d.dataset.i; d.classList.toggle('sel', ssel.has(i) || i === S.cur); Thumbs.draw(d.querySelector('canvas'), S.doc.slides[i], W); });
  }
  function setSorter(on) {
    if (on && S.mode !== 'slide') setMode('slide');
    Editor.endEdit(true); S.sorter = on; $('#sorter').hidden = !on; $('#stagewrap').hidden = on;
    if (on) renderSorter(); else requestAnimationFrame(() => View.fit());
    refresh(true);
  }
  function setMode(m) {
    Editor.endEdit(true);
    if (m === 'master' && S.sorter) setSorter(false);
    S.mode = m; S.sel = []; S.inGroup = null;
    if (m === 'master') { const s = curSlide(); S.mcur = s ? S.doc.layouts.findIndex(l => l.id === s.layout) : -1; }
    $('#masterbar').hidden = m !== 'master';
    listSig = ''; propsKey = animKey = '';
    changed(true);
  }

  /* ---------------- slide operations ---------------- */
  function newSlide(layoutId) {
    if (S.mode !== 'slide') setMode('slide');
    const cs = curSlide();
    let lid = layoutId;
    if (!lid) { // like PowerPoint: after a title slide, use Title and Content; otherwise repeat the current layout
      const cl = cs && S.doc.layouts.find(l => l.id === cs.layout);
      lid = cl && cl.kind === 'title' ? (S.doc.layouts.find(l => l.kind === 'obj') || cl).id : cl ? cl.id : S.doc.layouts[0].id;
    }
    const s = M.newSlide(S.doc, lid);
    S.doc.slides.splice(S.cur + 1, 0, s); S.cur++; ssel = new Set([S.cur]); S.sel = [];
    commit('New slide');
  }
  function dupSlide() {
    if (S.mode !== 'slide') return;
    const idx = [...ssel].sort((a, b) => a - b); if (!idx.length) idx.push(S.cur);
    const clones = idx.map(i => { const s = JSON.parse(JSON.stringify(S.doc.slides[i])); s.id = M.uid(); const map = {}; M.walk(s.objects, o => { const n = M.uid(); map[o.id] = n; o.id = n; }); s.anims.forEach(a => { a.id = M.uid(); a.target = map[a.target] || a.target; }); return s; });
    const at = idx[idx.length - 1] + 1; S.doc.slides.splice(at, 0, ...clones); S.cur = at; ssel = new Set(clones.map((_, k) => at + k));
    commit('Duplicate slide');
  }
  async function delSlides() {
    if (S.mode !== 'slide' || !S.doc.slides.length) return;
    const idx = [...(ssel.size ? ssel : new Set([S.cur]))].sort((a, b) => b - a);
    if (idx.length >= S.doc.slides.length) { if (!(await Aero.confirm('Delete slides', 'Delete all slides? A blank title slide will be added.', 'Delete'))) return; }
    for (const i of idx) S.doc.slides.splice(i, 1);
    if (!S.doc.slides.length) S.doc.slides.push(M.newSlide(S.doc, S.doc.layouts[0].id));
    S.cur = Math.min(idx[idx.length - 1], S.doc.slides.length - 1); ssel = new Set([S.cur]); S.sel = [];
    commit(idx.length > 1 ? 'Delete slides' : 'Delete slide');
  }
  function moveSlide(d) { const i = S.cur, j = i + d; if (j < 0 || j >= S.doc.slides.length) return; reorder([i], d > 0 ? j + 1 : j); }
  function reorder(idx, to) {
    idx = [...new Set(idx)].sort((a, b) => a - b);
    const moving = idx.map(i => S.doc.slides[i]); const cur = S.doc.slides[S.cur];
    let at = to - idx.filter(i => i < to).length;
    const rest = S.doc.slides.filter((_, i) => !idx.includes(i)); rest.splice(at, 0, ...moving);
    if (rest.every((s, i) => s === S.doc.slides[i])) return;
    S.doc.slides = rest; S.cur = rest.indexOf(moving.includes(cur) ? cur : cur); ssel = new Set(moving.map(s => rest.indexOf(s)));
    commit('Move slide');
  }
  function hideSlides() { if (S.mode !== 'slide') return; const idx = ssel.size ? [...ssel] : [S.cur]; const v = !S.doc.slides[idx[0]].hidden; idx.forEach(i => S.doc.slides[i].hidden = v); commit(v ? 'Hide slide' : 'Show slide'); }
  function setLayout(id) { const idx = ssel.size ? [...ssel] : [S.cur]; idx.forEach(i => M.applyLayout(S.doc, S.doc.slides[i], id)); S.sel = []; commit('Change layout'); }

  /* ---------------- arrange ---------------- */
  function duplicate() {
    const objs = selObjs(); if (!objs.length) { dupSlide(); return; }
    const ids = []; for (const o of objs) { const l = listOf(o.id); const c = M.cloneObj(o); delete c.ph; M.translate(c, 20, 20); (l === S.doc.master.ph ? S.doc.master.objects : l).push(c); ids.push(c.id); }
    S.sel = ids; commit('Duplicate');
  }
  function zorder(k) {
    const objs = selObjs(); if (!objs.length) return;
    for (const o of objs) {
      const l = listOf(o.id); const i = l.indexOf(o); l.splice(i, 1);
      const n = k === 'front' ? l.length : k === 'back' ? 0 : k === 'fwd' ? Math.min(l.length, i + 1) : Math.max(0, i - 1);
      l.splice(n, 0, o);
    }
    commit('Arrange');
  }
  function group() {
    const objs = selObjs(); if (objs.length < 2) return;
    const l = listOf(objs[0].id); if (!objs.every(o => listOf(o.id) === l) || l === S.doc.master.ph) { Aero.toast('Objects must be on the same level to group'); return; }
    const sorted = objs.slice().sort((a, b) => l.indexOf(a) - l.indexOf(b)); const at = l.indexOf(sorted[sorted.length - 1]);
    const g = { id: M.uid(), type: 'group', rot: 0, children: sorted.map(o => { delete o.ph; return o; }), ...M.groupBounds(sorted) };
    const rest = l.filter(o => !objs.includes(o)); const pos = at - (sorted.length - 1);
    l.length = 0; l.push(...rest); l.splice(Math.max(0, pos), 0, g);
    const s = curSlide(); if (s && S.mode === 'slide') { s.anims = s.anims.filter(a => !objs.some(o => o.id === a.target)); }
    S.sel = [g.id]; S.inGroup = null; commit('Group');
  }
  function ungroup() {
    const ids = [];
    for (const g of selObjs().filter(o => o.type === 'group')) {
      const l = listOf(g.id), i = l.indexOf(g);
      if (g.rot) for (const c of g.children) { const gcx = g.x + g.w / 2, gcy = g.y + g.h / 2, r = g.rot * Math.PI / 180, cx = c.x + c.w / 2 - gcx, cy = c.y + c.h / 2 - gcy; const nx = gcx + cx * Math.cos(r) - cy * Math.sin(r), ny = gcy + cx * Math.sin(r) + cy * Math.cos(r); M.translate(c, nx - (c.x + c.w / 2), ny - (c.y + c.h / 2)); c.rot = ((c.rot || 0) + g.rot) % 360; }
      l.splice(i, 1, ...g.children); ids.push(...g.children.map(c => c.id));
      const s = curSlide(); if (s) s.anims = s.anims.filter(a => a.target !== g.id);
    }
    if (!ids.length) return;
    S.sel = ids; S.inGroup = null; commit('Ungroup');
  }
  function align(k) {
    const objs = selObjs(); if (!objs.length) return;
    const ref = objs.length === 1 ? { x: 0, y: 0, w: S.doc.w, h: S.doc.h } : Editor.selBox(objs);
    for (const o of objs) { const b = M.aabb(o); let dx = 0, dy = 0;
      if (k === 'l') dx = ref.x - b.x; else if (k === 'c') dx = ref.x + ref.w / 2 - (b.x + b.w / 2); else if (k === 'r') dx = ref.x + ref.w - (b.x + b.w);
      else if (k === 't') dy = ref.y - b.y; else if (k === 'm') dy = ref.y + ref.h / 2 - (b.y + b.h / 2); else dy = ref.y + ref.h - (b.y + b.h);
      M.translate(o, dx, dy); if (o.ph) o.ownGeo = true; }
    commit('Align');
  }
  function distribute(k) {
    const objs = selObjs(); if (objs.length < 3) return;
    const bs = objs.map(o => ({ o, b: M.aabb(o) })).sort((a, b) => k === 'h' ? a.b.x - b.b.x : a.b.y - b.b.y);
    const first = bs[0].b, last = bs[bs.length - 1].b;
    const total = bs.reduce((a, x) => a + (k === 'h' ? x.b.w : x.b.h), 0);
    const gap = ((k === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y) - total) / (bs.length - 1);
    let p = k === 'h' ? first.x : first.y;
    for (const x of bs) { if (k === 'h') M.translate(x.o, p - x.b.x, 0); else M.translate(x.o, 0, p - x.b.y); p += (k === 'h' ? x.b.w : x.b.h) + gap; }
    commit('Distribute');
  }
  function rotate(d) { const objs = selObjs(); if (!objs.length) return; objs.forEach(o => { if (o.type !== 'table') o.rot = (((o.rot || 0) + d) % 360 + 360) % 360; }); commit('Rotate'); }
  function flip(k) { const objs = selObjs(); if (!objs.length) return; objs.forEach(o => { if (k === 'h') o.flipH = !o.flipH || undefined; else o.flipV = !o.flipV || undefined; }); commit('Flip'); }
  function toggleLock() { const objs = selObjs(); if (!objs.length) return; const v = !objs[0].locked; objs.forEach(o => o.locked = v || undefined); if (v) S.sel = []; commit(v ? 'Lock' : 'Unlock'); }
  function setFill(c) { const objs = selObjs(); if (!objs.length) return; objs.forEach(o => { if (o.type === 'table') o.style.color = c || 'accent1'; else if (o.type !== 'image') o.fill = c ? { color: c } : null; }); commit('Fill'); }
  function setLineColor(c) { const objs = selObjs(); if (!objs.length) return; objs.forEach(o => { o.line = c ? { ...(o.line || { w: o.geom === 'line' ? 3 : 1.5 }), color: c } : (o.geom === 'line' ? o.line : null); }); commit('Outline'); }
  function insertSlideNum() {
    if (Editor.editing()) { Aero.toast('Leave text editing first, then insert a slide number box'); return; }
    const o = M.textBox(S.doc.w - 200, S.doc.h - 60, 120, 40, ''); o.text.paras = [{ runs: [{ t: '', fld: 'slidenum' }], align: 'r' }]; target().main.push(o); S.sel = [o.id]; commit('Insert slide number');
  }
  function resetImage(o) { const a = S.assets[o.asset]; if (!a || !a.w) return; const k = Math.min(1, S.doc.w * 0.8 / a.w, S.doc.h * 0.8 / a.h); const cx = o.x + o.w / 2, cy = o.y + o.h / 2; o.w = a.w * k; o.h = a.h * k; o.x = cx - o.w / 2; o.y = cy - o.h / 2; o.crop = null; commit('Reset picture'); }

  /* ---------------- Format panel ---------------- */
  const sec = (title, extra = '') => { const s = el('div', 'psec'); s.appendChild(el('div', 'psh', esc(title) + extra)); return s; };
  const form = s => { const f = el('div', 'pform'); s.appendChild(f); return f; };
  function row(f, label, ctl) { f.appendChild(el('label', '', esc(label))); const pc = el('div', 'pc'); (Array.isArray(ctl) ? ctl : [ctl]).forEach(c => pc.appendChild(c)); f.appendChild(pc); return pc; }
  function numIn(v, step, fn, o = {}) { const i = el('input'); i.type = 'number'; i.step = step; if (o.min != null) i.min = o.min; if (o.max != null) i.max = o.max; i.value = Math.round(v * 100) / 100; i.oninput = () => { const x = parseFloat(i.value); if (Number.isFinite(x)) { fn(x); requestRender(); } }; i.onchange = () => commit(o.label || 'Format', { merge: true }); return i; }
  function selIn(opts, v, fn, label) { const s = el('select'); opts.forEach(([val, t]) => s.add(new Option(t, val))); s.value = v; s.onchange = () => { fn(s.value); commit(label || 'Format'); }; return s; }
  function chk(v, fn, label) { const c = el('input'); c.type = 'checkbox'; c.checked = !!v; c.onchange = () => { fn(c.checked); commit(label || 'Format'); }; return c; }
  function rng(v, min, max, step, fn, fmt, label) { const wrap = []; const r = el('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = v; const out = el('span', 'v', fmt(v)); r.oninput = () => { fn(+r.value); out.textContent = fmt(+r.value); requestRender(); }; r.onchange = () => commit(label || 'Format', { merge: true }); wrap.push(r, out); return wrap; }
  function swatch(c, onPick, none) { const b = el('button', 'swbtn' + (c ? '' : ' none')); b.style.background = c ? M.color(c, S.doc.theme) : ''; b.title = c || 'None'; b.onclick = () => colorPop(b, c, v => onPick(v), none ? { none } : {}); return b; }
  function btnEl(label, fn, title) { const b = el('button', 'aero-btn small', esc(label)); b.onclick = fn; if (title) b.title = title; return b; }
  function renderProps() {
    const box = $('#props');
    const key = [S.mode, S.cur, S.mcur, S.sel.join(), S.ver].join('|');
    if (key === propsKey || box.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') { return; }
    propsKey = key;
    box.innerHTML = '';
    const objs = selObjs();
    if (!objs.length) { renderSlideProps(box); return; }
    const o = objs[0], th = S.doc.theme;
    // position & size
    const s1 = sec(objs.length > 1 ? `${objs.length} objects` : objName(o)); box.appendChild(s1);
    if (objs.length === 1) {
      const f = form(s1);
      const geo = (k, fn) => numIn(o[k], 1, fn);
      const xy = el('div', 'xy');
      const pair = (lab, inp) => { const sp = el('span', '', lab); sp.appendChild(inp); xy.appendChild(sp); };
      pair('X', geo('x', v => { M.translate(o, v - o.x, 0); if (o.ph) o.ownGeo = true; })); pair('Y', geo('y', v => { M.translate(o, 0, v - o.y); if (o.ph) o.ownGeo = true; }));
      pair('W', geo('w', v => { M.setRect(o, o.x, o.y, Math.max(1, v), o.h); if (o.ph) o.ownGeo = true; })); pair('H', geo('h', v => { M.setRect(o, o.x, o.y, o.w, Math.max(1, v)); if (o.ph) o.ownGeo = true; }));
      row(f, 'Position, size', xy);
      if (o.type !== 'table') row(f, 'Rotation', numIn(o.rot || 0, 1, v => o.rot = ((v % 360) + 360) % 360));
      row(f, 'Opacity', rng(Math.round((o.alpha != null ? o.alpha : 1) * 100), 0, 100, 1, v => o.alpha = v >= 100 ? undefined : v / 100, v => v + '%', 'Opacity'));
      if (o.type !== 'table' && o.type !== 'chart') row(f, 'Shadow', chk(o.shadow, v => o.shadow = v || undefined, 'Shadow'));
      if (o.name || true) { const n = el('input'); n.type = 'text'; n.value = o.name || ''; n.placeholder = objName(o); n.onchange = () => { o.name = n.value.trim() || undefined; commit('Rename'); }; row(f, 'Name', n); }
    }
    // fill & line
    const shapes = objs.filter(x => x.type === 'shape' || x.type === 'image' || x.type === 'chart');
    if (shapes.length && objs.length === shapes.length) {
      const s2 = sec('Fill & outline'); box.appendChild(s2); const f = form(s2);
      if (o.type !== 'image' && o.geom !== 'line') {
        const ft = o.fill ? (o.fill.grad ? 'grad' : 'solid') : 'none';
        row(f, 'Fill', selIn([['none', 'No fill'], ['solid', 'Solid'], ['grad', 'Gradient']], ft, v => objs.forEach(x => { if (x.type === 'image') return; const c = x.fill && (x.fill.color || x.fill.grad && x.fill.grad[0][1]) || 'accent1'; x.fill = v === 'none' ? null : v === 'solid' ? { color: c } : { grad: [[0, c], [1, c + ':-50']], ang: 90 }; }), 'Fill'));
        if (o.fill && !o.fill.grad) row(f, 'Colour', [swatch(o.fill.color, c => { objs.forEach(x => { if (x.fill && !x.fill.grad) x.fill.color = c || x.fill.color; }); commit('Fill'); })]);
        if (o.fill && o.fill.grad) {
          row(f, 'Colours', [swatch(o.fill.grad[0][1], c => { o.fill.grad[0][1] = c; commit('Gradient'); }), swatch(o.fill.grad[o.fill.grad.length - 1][1], c => { o.fill.grad[o.fill.grad.length - 1][1] = c; commit('Gradient'); })]);
          row(f, 'Angle', rng(o.fill.ang || 0, 0, 359, 1, v => o.fill.ang = v, v => v + '°', 'Gradient'));
        }
        if (o.fill) row(f, 'Transparency', rng(Math.round((1 - (o.fill.alpha != null ? o.fill.alpha : 1)) * 100), 0, 100, 1, v => objs.forEach(x => { if (x.fill) x.fill.alpha = v ? 1 - v / 100 : undefined; }), v => v + '%', 'Transparency'));
      }
      row(f, 'Outline', [swatch(o.line && o.line.color, c => { objs.forEach(x => { x.line = c ? { ...(x.line || { w: 1.5 }), color: c } : (x.geom === 'line' ? x.line : null); }); commit('Outline'); }, o.geom === 'line' ? null : 'No outline')]);
      if (o.line) {
        row(f, 'Width', numIn(o.line.w, 0.5, v => objs.forEach(x => { if (x.line) x.line.w = Math.max(0.25, v); }), { min: 0.25, label: 'Line width' }));
        row(f, 'Dash', selIn([['solid', 'Solid'], ['dash', 'Dash'], ['dot', 'Dot'], ['dashDot', 'Dash dot'], ['lgDash', 'Long dash']], o.line.dash || 'solid', v => objs.forEach(x => { if (x.line) x.line.dash = v === 'solid' ? undefined : v; }), 'Dash'));
        if (o.geom === 'line') row(f, 'Arrows', selIn([['none', 'None'], ['end', 'End arrow'], ['start', 'Start arrow'], ['both', 'Both ends']], o.line.head && o.line.tail ? 'both' : o.line.tail ? 'end' : o.line.head ? 'start' : 'none', v => objs.forEach(x => { if (!x.line) return; x.line.tail = v === 'end' || v === 'both' ? 'arrow' : undefined; x.line.head = v === 'start' || v === 'both' ? 'arrow' : undefined; }), 'Arrows'));
      }
      if (o.type === 'shape' && o.geom !== 'line' && objs.length === 1) row(f, 'Shape', selIn(M.GEOMS.filter(g => g[0] !== 'line').map(g => [g[0], g[1]]).concat(o.geom === 'cust' ? [['cust', 'Custom']] : []), o.geom, v => o.geom = v, 'Change shape'));
    }
    // text
    const texts = objs.filter(x => x.type === 'shape' && x.text);
    if (texts.length) {
      const s3 = sec('Text box'); box.appendChild(s3); const f = form(s3); const t = texts[0].text, base = M.baseStyle(S.doc, target().ctx, texts[0]);
      row(f, 'Vertical', selIn([['t', 'Top'], ['ctr', 'Middle'], ['b', 'Bottom']], t.anchor || base.anchor || 't', v => texts.forEach(x => x.text.anchor = v), 'Text anchor'));
      row(f, 'Autofit', selIn([['none', 'Do not autofit'], ['shrink', 'Shrink text on overflow'], ['grow', 'Resize shape to fit text']], t.autofit || (texts[0].ph && M.phCat(texts[0].ph) === 'body' ? 'shrink' : 'none'), v => texts.forEach(x => { x.text.autofit = v; Editor.fitGrow(x); }), 'Autofit'));
      row(f, 'Wrap text', chk(t.wrap !== false, v => texts.forEach(x => x.text.wrap = v ? undefined : false), 'Wrap'));
      const lnSp = (t.paras[0] && t.paras[0].lnSp) || base.lnSp || 1;
      row(f, 'Line spacing', selIn([['0.8', '0.8'], ['0.9', '0.9'], ['1', '1.0'], ['1.15', '1.15'], ['1.5', '1.5'], ['2', '2.0']], String(lnSp), v => texts.forEach(x => x.text.paras.forEach(p => p.lnSp = +v)), 'Line spacing'));
      const ins = t.ins || Render.DEF_INS;
      row(f, 'Margins', numIn(ins[0], 1, v => texts.forEach(x => { const i = (x.text.ins || Render.DEF_INS).slice(); i[0] = i[2] = Math.max(0, v); x.text.ins = i; }), { min: 0, label: 'Text margins' }));
      if (texts[0].ph && S.mode === 'slide') { const pf = el('div', 'pbtns'); pf.appendChild(btnEl('Reset placeholder', () => { texts.forEach(x => { delete x.ownGeo; const lp = M.layoutPh(S.doc, curSlide(), x); if (lp) { x.x = lp.x; x.y = lp.y; x.w = lp.w; x.h = lp.h; } x.text.paras.forEach(p => { p.runs.forEach(r => { delete r.size; delete r.color; delete r.font; delete r.b; delete r.i; }); delete p.align; delete p.bullet; delete p.marL; delete p.indent; delete p.lnSp; }); delete x.text.def; }); commit('Reset placeholder'); }, 'Restore the layout position and master text styles')); s3.appendChild(pf); }
      if (S.mode === 'master' && texts[0].ph) s3.appendChild(el('div', 'pnote', 'Select this placeholder and use the font, size, colour, bold and alignment buttons: the change becomes the default for every slide that uses it (text you formatted on a slide keeps its own formatting).'));
    }
    if (o.type === 'image' && objs.length === 1) {
      const s4 = sec('Picture'); box.appendChild(s4); const f = form(s4);
      const cr = o.crop || { l: 0, t: 0, r: 0, b: 0 };
      for (const [k, lab] of [['l', 'Crop left'], ['r', 'Crop right'], ['t', 'Crop top'], ['b', 'Crop bottom']]) row(f, lab, rng(Math.round((cr[k] || 0) * 100), 0, 90, 1, v => { o.crop = { ...(o.crop || { l: 0, t: 0, r: 0, b: 0 }), [k]: v / 100 }; }, v => v + '%', 'Crop'));
      row(f, 'Mask', selIn([['rect', 'Rectangle'], ['roundRect', 'Rounded'], ['ellipse', 'Oval'], ['hexagon', 'Hexagon'], ['diamond', 'Diamond'], ['star5', 'Star'], ['heart', 'Heart']], o.geom || 'rect', v => o.geom = v === 'rect' ? undefined : v, 'Picture shape'));
      const pb = el('div', 'pbtns'); pb.appendChild(btnEl('Fill frame', () => fillCrop(o), 'Crop to fill the frame without distortion')); pb.appendChild(btnEl('Reset size', () => resetImage(o))); pb.appendChild(btnEl('Change picture…', () => IO.insertPicture(o))); s4.appendChild(pb);
      const a = S.assets[o.asset]; if (a) s4.appendChild(el('div', 'pnote', `${esc(a.name || 'image')} · ${a.w}×${a.h}px · ${a.mime.replace('image/', '').toUpperCase()}`));
    }
    if (o.type === 'table' && objs.length === 1) renderTableProps(box, o);
    if (o.type === 'chart' && objs.length === 1) renderChartProps(box, o);
    // arrange buttons
    const s5 = sec('Arrange'); box.appendChild(s5); const pb = el('div', 'pbtns');
    [['Front', () => zorder('front')], ['Back', () => zorder('back')], ['Forward', () => zorder('fwd')], ['Backward', () => zorder('back1')]].forEach(([l, fn]) => pb.appendChild(btnEl(l, fn)));
    if (objs.length > 1) pb.appendChild(btnEl('Group', group)); if (objs.some(x => x.type === 'group')) pb.appendChild(btnEl('Ungroup', ungroup));
    s5.appendChild(pb);
    const pb2 = el('div', 'pbtns'); [['⇤', 'l', 'Align left'], ['↔', 'c', 'Align center'], ['⇥', 'r', 'Align right'], ['⤒', 't', 'Align top'], ['↕', 'm', 'Align middle'], ['⤓', 'b', 'Align bottom']].forEach(([l, k, t]) => pb2.appendChild(btnEl(l, () => align(k), t + (objs.length === 1 ? ' (to slide)' : ''))));
    s5.appendChild(pb2);
    void th;
  }
  function fillCrop(o) {
    const a = S.assets[o.asset]; if (!a || !a.w) return;
    const ia = a.w / a.h, fa = o.w / o.h;
    o.crop = ia > fa ? { l: (1 - fa / ia) / 2, r: (1 - fa / ia) / 2, t: 0, b: 0 } : { t: (1 - ia / fa) / 2, b: (1 - ia / fa) / 2, l: 0, r: 0 };
    commit('Crop to fill');
  }
  function objName(o) { if (o.name) return o.name; if (o.ph) return { title: 'Title', ctrTitle: 'Title', subTitle: 'Subtitle', body: 'Content', pic: 'Picture placeholder', dt: 'Date', ftr: 'Footer', sldNum: 'Slide number' }[o.ph.type] || 'Placeholder'; if (o.type === 'shape') return o.tb ? 'Text box' : o.geom === 'line' ? 'Line' : (M.GEOMS.find(g => g[0] === o.geom) || [0, 'Shape'])[1]; return { image: 'Picture', table: 'Table', chart: 'Chart', group: 'Group' }[o.type] || o.type; }
  function renderSlideProps(box) {
    const master = S.mode === 'master', lay = curLayout(), s = curSlide();
    if (!master && !s) return;
    const s1 = sec(master ? (lay ? `Layout: ${lay.name}` : 'Slide Master') : `Slide ${S.cur + 1}`); box.appendChild(s1); const f = form(s1);
    if (!master) row(f, 'Layout', selIn(S.doc.layouts.map(l => [l.id, l.name]), s.layout, v => M.applyLayout(S.doc, s, v), 'Change layout'));
    if (master && lay) { const n = el('input'); n.type = 'text'; n.value = lay.name; n.onchange = () => { lay.name = n.value.trim() || lay.name; commit('Rename layout'); }; row(f, 'Name', n); row(f, 'Hide master shapes', chk(lay.hideMaster, v => lay.hideMaster = v || undefined, 'Hide master graphics')); }
    // background
    const owner = master ? (lay || S.doc.master) : s;
    const bg = owner.bg;
    const kind = !bg ? 'inherit' : bg.img ? 'image' : bg.grad ? 'grad' : 'solid';
    const opts = [['solid', 'Solid colour'], ['grad', 'Gradient'], ['image', 'Picture']]; if (owner !== S.doc.master) opts.unshift(['inherit', master ? 'Follow master' : 'Follow layout / master']);
    const s2 = sec('Background'); box.appendChild(s2); const f2 = form(s2);
    row(f2, 'Fill', selIn(opts, kind, v => {
      const cur = Render.effBg(S.doc, s, M.layoutOf(S.doc, s)) || { color: 'bg1' }; const c0 = cur.color || (cur.grad && cur.grad[0][1]) || 'bg1';
      if (v === 'inherit') owner.bg = null; else if (v === 'solid') owner.bg = { color: c0 }; else if (v === 'grad') owner.bg = { grad: [[0, c0], [1, 'accent1:+60']], ang: 90 }; else { IO.pickBackgroundImage(owner); }
    }, 'Background'));
    if (bg && bg.color) row(f2, 'Colour', [swatch(bg.color, c => { owner.bg = { color: c || 'bg1' }; commit('Background'); })]);
    if (bg && bg.grad) { row(f2, 'Colours', [swatch(bg.grad[0][1], c => { bg.grad[0][1] = c || 'bg1'; commit('Background'); }), swatch(bg.grad[bg.grad.length - 1][1], c => { bg.grad[bg.grad.length - 1][1] = c || 'bg1'; commit('Background'); })]); row(f2, 'Angle', rng(bg.grad && owner.bg.ang || 0, 0, 359, 1, v => owner.bg.ang = v, v => v + '°', 'Background')); }
    if (bg && bg.img) { const pb = el('div', 'pbtns'); pb.appendChild(btnEl('Change picture…', () => IO.pickBackgroundImage(owner))); s2.appendChild(pb); }
    if (!master) { const pb = el('div', 'pbtns'); pb.appendChild(btnEl('Apply to all slides', () => { S.doc.slides.forEach(x => x.bg = s.bg ? JSON.parse(JSON.stringify(s.bg)) : null); commit('Background to all'); })); s2.appendChild(pb); }
    if (master) { s2.appendChild(el('div', 'pnote', 'Shapes you add here appear on every slide that uses this ' + (lay ? 'layout' : 'master') + '. Drag placeholders to change where slide titles and content go.')); const pb = el('div', 'pbtns'); if (lay) { pb.appendChild(btnEl('Duplicate layout', () => { const c = JSON.parse(JSON.stringify(lay)); c.id = M.uid(); c.name += ' copy'; M.walk(c.objects, o => o.id = M.uid()); S.doc.layouts.splice(S.mcur + 1, 0, c); S.mcur++; commit('Duplicate layout'); })); pb.appendChild(btnEl('Delete layout', () => { if (S.doc.layouts.length < 2) return; if (S.doc.slides.some(x => x.layout === lay.id)) { Aero.toast('This layout is used by slides'); return; } S.doc.layouts.splice(S.mcur, 1); S.mcur = Math.min(S.mcur, S.doc.layouts.length - 1); commit('Delete layout'); })); }
      pb.appendChild(btnEl('Close master view', () => setMode('slide'))); s2.appendChild(pb);
      if (!lay) renderMasterStyles(box);
      return; }
    // transition
    const t = s.transition;
    const s3 = sec('Transition'); box.appendChild(s3); const f3 = form(s3);
    row(f3, 'Effect', selIn(M.TRANS.map(x => [x, { none: 'None', fade: 'Fade', push: 'Push', wipe: 'Wipe', cover: 'Cover', uncover: 'Uncover', zoom: 'Zoom', split: 'Split', flash: 'Flash' }[x]]), t.type, v => { t.type = v; if (['push', 'wipe', 'cover', 'uncover'].includes(v) && !['l', 'r', 'u', 'd'].includes(t.dir)) t.dir = 'l'; if (v === 'split' && !['h', 'v'].includes(t.dir)) t.dir = 'v'; }, 'Transition'));
    if (['push', 'wipe', 'cover', 'uncover'].includes(t.type)) row(f3, 'Direction', selIn([['l', 'From right'], ['r', 'From left'], ['u', 'From bottom'], ['d', 'From top']], t.dir || 'l', v => t.dir = v, 'Transition direction'));
    if (t.type === 'split') row(f3, 'Direction', selIn([['v', 'Vertical out'], ['h', 'Horizontal out']], t.dir || 'v', v => t.dir = v, 'Transition direction'));
    if (t.type !== 'none') row(f3, 'Duration (s)', numIn(t.dur, 0.1, v => t.dur = Aero.clamp(v, 0.1, 10), { min: 0.1, max: 10, label: 'Transition duration' }));
    row(f3, 'Advance after', [chk(t.after != null, v => t.after = v ? 5 : undefined, 'Auto advance'), ...(t.after != null ? [numIn(t.after, 1, v => t.after = Math.max(0, v), { min: 0, label: 'Auto advance' }), el('span', 'v', 's')] : [])]);
    const pb = el('div', 'pbtns'); pb.appendChild(btnEl('Preview', () => previewTransition())); pb.appendChild(btnEl('Apply to all slides', () => { S.doc.slides.forEach(x => x.transition = { ...t }); commit('Transition to all'); })); s3.appendChild(pb);
    // footer & hidden
    const s4 = sec('Slide'); box.appendChild(s4); const f4 = form(s4);
    row(f4, 'Hidden in show', chk(s.hidden, v => s.hidden = v, 'Hide slide'));
    const pb4 = el('div', 'pbtns'); pb4.appendChild(btnEl('Header & footer…', footerDialog)); pb4.appendChild(btnEl('Slide size…', slideSizeDialog)); s4.appendChild(pb4);
  }
  function renderMasterStyles(box) {
    const st = S.doc.master.styles;
    const s = sec('Master text styles'); box.appendChild(s); const f = form(s);
    const fontSel = (v, fn) => { const sel = el('select'); sel.add(new Option(`${S.doc.theme.fonts.major} (Headings)`, '+mj')); sel.add(new Option(`${S.doc.theme.fonts.minor} (Body)`, '+mn')); Fonts.names().forEach(n => sel.add(new Option(n, n))); sel.value = v; if (sel.value !== v) { sel.add(new Option(v, v)); sel.value = v; } sel.onchange = () => { fn(sel.value); commit('Master style'); }; return sel; };
    row(f, 'Title font', fontSel(st.title.font, v => st.title.font = v));
    row(f, 'Title size', numIn(st.title.size, 1, v => st.title.size = Math.max(4, v), { label: 'Master style' }));
    row(f, 'Title colour', [swatch(st.title.color, c => { st.title.color = c || 'tx1'; commit('Master style'); }), chk(st.title.b, v => st.title.b = v, 'Master style'), el('span', 'v', 'bold')]);
    row(f, 'Body font', fontSel(st.body.font, v => st.body.font = v));
    row(f, 'Body size', numIn(st.body.lv[0].size, 1, v => { const d = v - st.body.lv[0].size; st.body.lv.forEach(l => l.size = Math.max(4, l.size + d)); }, { label: 'Master style' }));
    row(f, 'Body colour', [swatch(st.body.color, c => { st.body.color = c || 'tx1'; commit('Master style'); })]);
    row(f, 'Bullet', selIn([['•', '•  Round'], ['–', '–  Dash'], ['▪', '▪  Square'], ['›', '›  Chevron'], ['none', 'None']], st.body.lv[0].bullet, v => { st.body.lv[0].bullet = v; st.body.lv[2] && (st.body.lv[2].bullet = v); }, 'Master style'));
  }
  function renderTableProps(box, o) {
    const s = sec('Table'); box.appendChild(s); const f = form(s);
    const cell = S.edit && S.edit.id === o.id && S.edit.cell || lastCell.get(o.id) || { r: 0, c: 0 };
    row(f, 'Style colour', [swatch(o.style.color, c => { o.style.color = c || 'accent1'; o.style.none = false; commit('Table style'); })]);
    row(f, 'Header row', chk(o.style.first, v => o.style.first = v, 'Table style'));
    row(f, 'Banded rows', chk(o.style.band, v => o.style.band = v, 'Table style'));
    row(f, 'Plain (no style)', chk(o.style.none, v => o.style.none = v, 'Table style'));
    row(f, 'Cell fill', [swatch(o.rows[cell.r] && o.rows[cell.r].cells[cell.c].fill && o.rows[cell.r].cells[cell.c].fill.color, c => { o.rows[cell.r].cells[cell.c].fill = c ? { color: c } : undefined; commit('Cell fill'); }, 'Style default'), el('span', 'v', `R${cell.r + 1}C${cell.c + 1}`)]);
    const pb = el('div', 'pbtns');
    [['Row above', 'rowAbove'], ['Row below', 'rowBelow'], ['Col left', 'colLeft'], ['Col right', 'colRight'], ['Delete row', 'delRow'], ['Delete col', 'delCol'], ['Equal widths', 'equal']].forEach(([l, k]) => pb.appendChild(btnEl(l, () => tableOp(o, k, cell))));
    s.appendChild(pb);
    s.appendChild(el('div', 'pnote', 'Double-click a cell to type; Tab moves to the next cell (and adds a row at the end).'));
  }
  const lastCell = new Map();
  function tableOp(o, k, cell, noCommit) {
    if (S.edit && !noCommit) Editor.endEdit(true);
    o = byId(o.id) || o;
    const emptyCell = () => ({ text: M.textBody([M.para('')]) });
    const { r, c } = cell;
    if (k === 'rowAbove' || k === 'rowBelow') { const h = o.rows[r] ? o.rows[r].h : 40; o.rows.splice(k === 'rowAbove' ? r : r + 1, 0, { h, cells: o.cols.map(emptyCell) }); }
    else if (k === 'colLeft' || k === 'colRight') { const at = k === 'colLeft' ? c : c + 1, w = o.cols[c] || 100; o.cols.splice(at, 0, w); o.rows.forEach(rw => rw.cells.splice(at, 0, emptyCell())); const tot = o.cols.reduce((a, b) => a + b, 0); o.cols = o.cols.map(x => x * o.w / tot); }
    else if (k === 'delRow') { if (o.rows.length < 2) return; o.rows.splice(r, 1); }
    else if (k === 'delCol') { if (o.cols.length < 2) return; o.cols.splice(c, 1); o.rows.forEach(rw => rw.cells.splice(c, 1)); const tot = o.cols.reduce((a, b) => a + b, 0); o.cols = o.cols.map(x => x * o.w / tot); }
    else if (k === 'equal') o.cols = o.cols.map(() => o.w / o.cols.length);
    o.h = o.rows.reduce((a, rw) => a + rw.h, 0);
    lastCell.set(o.id, { r: Math.min(r, o.rows.length - 1), c: Math.min(c, o.cols.length - 1) });
    commit('Table: ' + k);
  }
  function renderChartProps(box, o) {
    const s = sec('Chart'); box.appendChild(s); const f = form(s);
    row(f, 'Type', selIn([['col', 'Column'], ['stacked', 'Stacked column'], ['bar', 'Bar'], ['line', 'Line'], ['area', 'Area'], ['pie', 'Pie'], ['doughnut', 'Doughnut']], o.kind, v => o.kind = v, 'Chart type'));
    const t = el('input'); t.type = 'text'; t.value = o.title || ''; t.oninput = () => { o.title = t.value; requestRender(); }; t.onchange = () => commit('Chart title', { merge: true }); row(f, 'Title', t);
    row(f, 'Legend', chk(o.legend, v => o.legend = v, 'Chart legend'));
    row(f, 'Data labels', chk(o.labels, v => o.labels = v, 'Chart labels'));
    o.series.forEach((sr, i) => row(f, sr.name || `Series ${i + 1}`, [swatch(sr.color || 'accent' + (i % 6 + 1), c => { sr.color = c || undefined; commit('Series colour'); })]));
    const pb = el('div', 'pbtns'); pb.appendChild(btnEl('Edit data…', () => editChartData(o))); s.appendChild(pb);
  }
  function editChartData(o) {
    const tsv = [['', ...o.series.map(s => s.name)].join('\t'), ...o.cats.map((c, i) => [c, ...o.series.map(s => s.vals[i])].join('\t'))].join('\n');
    Aero.dialog({ title: 'Chart Data', instruction: 'One row per category. First row: series names. Separate columns with Tab or comma (you can paste from a spreadsheet).', width: 520,
      fields: [{ key: 'd', label: 'Data', type: 'textarea', mono: true, rows: 10, value: tsv }],
      onOK: v => {
        const rows = String(v.d).split(/\r?\n/).filter(l => l.trim()).map(l => l.split(/\t|,/).map(x => x.trim()));
        if (rows.length < 2 || rows[0].length < 2) { Aero.toast('Need a header row and at least one data row'); return; }
        o.series = rows[0].slice(1).map((n, si) => ({ name: n || `Series ${si + 1}`, vals: rows.slice(1).map(r => parseFloat(r[si + 1]) || 0), color: o.series[si] && o.series[si].color }));
        o.cats = rows.slice(1).map(r => r[0]); commit('Chart data');
      } });
  }
  function cropDialog(o) {
    const cr = { l: 0, t: 0, r: 0, b: 0, ...(o.crop || {}) }, before = JSON.stringify(o.crop || null);
    Aero.dialog({ title: 'Crop Picture', fields: ['l', 'r', 't', 'b'].map(k => ({ key: k, label: { l: 'Left', r: 'Right', t: 'Top', b: 'Bottom' }[k], type: 'range', min: 0, max: 90, step: 1, value: Math.round(cr[k] * 100), fmt: v => v + '%' })),
      onChange: v => { o.crop = { l: v.l / 100, t: v.t / 100, r: v.r / 100, b: v.b / 100 }; requestRender(); },
      onOK: () => commit('Crop'), onCancel: () => { o.crop = JSON.parse(before); requestRender(); } });
  }

  /* ---------------- Animations panel ---------------- */
  const FXN = { appear: 'Appear', fade: 'Fade', fly: 'Fly In', float: 'Float In', wipe: 'Wipe', split: 'Split', zoom: 'Zoom', grow: 'Grow', pulse: 'Pulse', spin: 'Spin', teeter: 'Teeter' };
  const FX_ENTR = ['appear', 'fade', 'fly', 'float', 'wipe', 'split', 'zoom', 'grow'], FX_EMPH = ['pulse', 'spin', 'grow', 'teeter'];
  function renderAnim() {
    const box = $('#anim'), s = curSlide();
    const key = [S.mode, S.cur, S.sel.join(), S.ver, animSel].join('|');
    if (key === animKey || box.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') return;
    animKey = key; box.innerHTML = '';
    if (S.mode !== 'slide' || !s) { box.appendChild(el('div', 'pnote', 'Animations are added to objects on slides. Close the master view to animate.')); return; }
    const sel = selObjs();
    const s1 = sec('Add effect'); box.appendChild(s1);
    if (!sel.length) s1.appendChild(el('div', 'pnote', 'Select one or more objects on the slide, then choose an effect.'));
    else {
      const pb = el('div', 'pbtns');
      const add = (cls, fx) => { for (const o of sel) { const a = { id: M.uid(), target: o.id, cls, fx, dir: 'b', dur: fx === 'appear' ? 0.5 : cls === 'emph' ? 0.8 : 0.5, delay: 0, trig: 'click' }; s.anims.push(a); animSel = a.id; } commit('Add animation'); };
      pb.appendChild(el('div', 'pnote', '<b style="color:#2a9d3a">Entrance</b>')); pb.lastChild.style.width = '100%'; pb.lastChild.style.padding = '0';
      FX_ENTR.forEach(fx => pb.appendChild(btnEl(FXN[fx], () => add('entr', fx))));
      const pe = el('div', 'pnote', '<b style="color:#b8860b">Emphasis</b>'); pe.style.width = '100%'; pe.style.padding = '0'; pb.appendChild(pe);
      FX_EMPH.forEach(fx => pb.appendChild(btnEl(FXN[fx], () => add('emph', fx))));
      const px = el('div', 'pnote', '<b style="color:#c73a2c">Exit</b>'); px.style.width = '100%'; px.style.padding = '0'; pb.appendChild(px);
      FX_ENTR.forEach(fx => pb.appendChild(btnEl(FXN[fx], () => add('exit', fx))));
      s1.appendChild(pb);
    }
    const s2 = sec('Animation order', `<span style="flex:1"></span><span class="dim">${s.anims.length}</span>`); box.appendChild(s2);
    const list = el('div', 'alist'); s2.appendChild(list);
    let step = 0;
    s.anims.forEach((a, i) => {
      if (a.trig === 'click' || i === 0) step++;
      const o = byId(a.target);
      const r = el('div', 'arow' + (a.id === animSel ? ' sel' : ''), `<span class="k ${a.cls}">${a.trig === 'click' || i === 0 ? step : ''}</span><span class="t"></span><span class="st">${a.trig === 'click' ? '' : a.trig === 'with' ? 'with' : 'after'}</span>`);
      r.querySelector('.t').textContent = `${FXN[a.fx]}${a.cls === 'exit' ? ' out' : ''} · ${o ? objName(o) + (o.text ? ': ' + M.plainText(o.text).slice(0, 24) : '') : '?'}`;
      r.onclick = () => { animSel = a.id; if (o) S.sel = [o.id]; animKey = ''; requestRender(); refresh(false); renderAnim(); };
      list.appendChild(r);
    });
    if (!s.anims.length) list.appendChild(el('div', 'arow', '<span class="t dim">No animations on this slide</span>'));
    const a = s.anims.find(x => x.id === animSel);
    if (a) {
      const s3 = sec('Effect options'); box.appendChild(s3); const f = form(s3);
      row(f, 'Effect', selIn((a.cls === 'emph' ? FX_EMPH : FX_ENTR).map(x => [x, FXN[x]]), a.fx, v => a.fx = v, 'Animation effect'));
      row(f, 'Type', selIn([['entr', 'Entrance'], ['emph', 'Emphasis'], ['exit', 'Exit']], a.cls, v => { a.cls = v; if (v === 'emph' && !FX_EMPH.includes(a.fx)) a.fx = 'pulse'; if (v !== 'emph' && !FX_ENTR.includes(a.fx)) a.fx = 'fade'; }, 'Animation type'));
      if (['fly', 'wipe', 'float'].includes(a.fx)) row(f, 'Direction', selIn([['b', 'From bottom'], ['t', 'From top'], ['l', 'From left'], ['r', 'From right']], a.dir, v => a.dir = v, 'Animation direction'));
      row(f, 'Start', selIn([['click', 'On click'], ['with', 'With previous'], ['after', 'After previous']], a.trig, v => a.trig = v, 'Animation start'));
      if (a.fx !== 'appear') row(f, 'Duration (s)', numIn(a.dur, 0.1, v => a.dur = Aero.clamp(v, 0.05, 30), { min: 0.05, label: 'Animation duration' }));
      row(f, 'Delay (s)', numIn(a.delay, 0.1, v => a.delay = Aero.clamp(v, 0, 60), { min: 0, label: 'Animation delay' }));
      const pb = el('div', 'pbtns');
      pb.appendChild(btnEl('▲ Earlier', () => { const i = s.anims.indexOf(a); if (i > 0) { s.anims.splice(i, 1); s.anims.splice(i - 1, 0, a); commit('Reorder animation'); } }));
      pb.appendChild(btnEl('▼ Later', () => { const i = s.anims.indexOf(a); if (i < s.anims.length - 1) { s.anims.splice(i, 1); s.anims.splice(i + 1, 0, a); commit('Reorder animation'); } }));
      pb.appendChild(btnEl('Remove', () => { s.anims.splice(s.anims.indexOf(a), 1); animSel = null; commit('Remove animation'); }));
      s3.appendChild(pb);
    }
    const pb = el('div', 'pbtns'); pb.style.paddingTop = '8px';
    pb.appendChild(btnEl('▶ Preview', previewAnims, 'Play this slide\'s animations in the editor'));
    s2.appendChild(pb);
  }
  function previewAnims() {
    const s = curSlide(); if (!s || S.mode !== 'slide') return;
    const steps = Anim.build(s); if (!steps.length) { Aero.toast('This slide has no animations'); return; }
    Editor.endEdit(true);
    let si = 0, t0 = performance.now();
    const tick = () => {
      const t = (performance.now() - t0) / 1000, st = steps[si];
      if (!st || !S.preview) { S.preview = null; requestRender(); return; }
      if (t >= st.dur + 0.35) { si++; t0 = performance.now(); S.preview = Anim.state(S.doc, s, steps, si, null); requestRender(); if (si >= steps.length) { setTimeout(() => { S.preview = null; requestRender(); }, 500); return; } requestAnimationFrame(tick); return; }
      S.preview = Anim.state(S.doc, s, steps, si, Math.min(t, st.dur)); requestRender(); requestAnimationFrame(tick);
    };
    S.preview = Anim.state(S.doc, s, steps, 0, null); requestRender();
    setTimeout(() => requestAnimationFrame(tick), 300);
  }
  function previewTransition() {
    const s = curSlide(); if (!s || S.cur === 0 && false) return;
    const cv = $('#cv'), prev = S.doc.slides[S.cur - 1] || null;
    const dpr = DPR(), z = S.view.z, f = { k: z * dpr, ox: S.view.ox * dpr, oy: S.view.oy * dpr, w: S.doc.w * z * dpr, h: S.doc.h * z * dpr };
    const mk = sl => { const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height; const x = c.getContext('2d'); if (sl) { x.setTransform(f.k, 0, 0, f.k, f.ox, f.oy); Render.drawSlide(x, S.doc, sl, S.assets, { scale: f.k, slideNum: S.doc.slides.indexOf(sl) + 1, anim: Anim.state(S.doc, sl, Anim.build(sl), sl === s ? 0 : 999, null) }); } else { x.fillStyle = '#000'; x.fillRect(f.ox, f.oy, f.w, f.h); } return c; };
    const A = mk(prev), B = mk(s), t0 = performance.now(), dur = (s.transition.dur || 0.7) * 1000;
    S.preview = new Map();
    const tick = () => { const p = (performance.now() - t0) / dur; if (p >= 1) { S.preview = null; requestRender(); return; } const c = cv.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#c9d4e1'; c.fillRect(0, 0, cv.width, cv.height); Player.composite(c, A, B, s.transition.type, s.transition.dir, p, f); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  /* ---------------- Design panel ---------------- */
  const themeCards = new Map();
  function themeCard(th) {
    const d = S.doc; const k = th.id + d.w + 'x' + d.h;
    if (themeCards.has(k)) return themeCards.get(k);
    const t = M.makeTheme(th.id); const tmp = { ...d, theme: t, master: { ...M.defaultMaster(d.w, d.h, th.id), styles: M.defaultStyles() }, layouts: M.defaultLayouts(d.w), footer: {} };
    const sl = M.newSlide(tmp, tmp.layouts[0].id); sl.objects[0].text = M.textBody([M.para(th.name)]); sl.objects[1].text = M.textBody([M.para('Aa · Subtitle')]);
    const c = document.createElement('canvas'); Thumbs.keys.delete(c);
    const w = 124, kk = w / d.w, dpr = DPR(); c.width = Math.round(w * dpr); c.height = Math.round(d.h * kk * dpr);
    const x = c.getContext('2d'); x.setTransform(kk * dpr, 0, 0, kk * dpr, 0, 0); Render.drawSlide(x, tmp, sl, {}, { scale: kk * dpr });
    themeCards.set(k, c); return c;
  }
  function renderDesign() {
    const box = $('#design');
    const key = [S.ver, S.doc.theme.id, JSON.stringify(S.doc.theme)].join('|');
    if (key === designKey) return; designKey = key; box.innerHTML = '';
    const s1 = sec('Themes'); box.appendChild(s1);
    const gal = el('div', 'tgal'); s1.appendChild(gal);
    for (const th of M.THEMES) {
      const card = el('div', 'tcard' + (S.doc.theme.id === th.id ? ' sel' : '')); const src = themeCard(th); const c = el('canvas'); c.width = src.width; c.height = src.height; c.getContext('2d').drawImage(src, 0, 0); card.appendChild(c); card.appendChild(el('div', 'tn', esc(th.name)));
      card.title = 'Apply the ' + th.name + ' theme (colours, fonts, background and master graphics)';
      card.onclick = () => applyTheme(th.id); gal.appendChild(card);
    }
    const s2 = sec('Colours'); box.appendChild(s2); const pl = el('div', 'plist'); s2.appendChild(pl);
    for (const p of M.PALETTES) {
      const cur = Object.keys(p.colors).every(k => S.doc.theme.colors[k] === p.colors[k]);
      const r = el('div', 'pal' + (cur ? ' sel' : ''), `<span class="sw">${['dk1', 'lt1', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map(k => `<i style="background:${p.colors[k]}"></i>`).join('')}</span><span class="nm">${esc(p.name)}</span>`);
      r.onclick = () => { S.doc.theme.colors = { ...p.colors }; commit('Theme colours'); }; pl.appendChild(r);
    }
    const f0 = form(s2);
    row(f0, 'Background', selIn([['light', 'Light (dark text)'], ['dark', 'Dark (light text)']], S.doc.theme.map && S.doc.theme.map.tx1 === 'lt1' ? 'dark' : 'light', v => { S.doc.theme.map = v === 'dark' ? { tx1: 'lt1', bg1: 'dk1', tx2: 'lt2', bg2: 'dk2' } : {}; }, 'Light/dark'));
    const cf = form(s2);
    for (const k of ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'dk1', 'lt1']) { const i = el('input'); i.type = 'color'; i.value = S.doc.theme.colors[k]; i.onchange = () => { S.doc.theme.colors[k] = i.value.toLowerCase(); S.doc.theme.id = 'custom'; commit('Theme colour'); }; row(cf, { dk1: 'Dark 1', lt1: 'Light 1' }[k] || 'Accent ' + k.slice(6), i); }
    const s3 = sec('Fonts'); box.appendChild(s3); const fl = el('div', 'plist'); s3.appendChild(fl);
    for (const fp of M.FONT_PAIRS) {
      const cur = S.doc.theme.fonts.major === fp.major && S.doc.theme.fonts.minor === fp.minor;
      const r = el('div', 'pal' + (cur ? ' sel' : ''), `<span class="nm"><b style="font-family:${esc(Render.famCss(fp.major)).replace(/"/g, "'")};font-size:14px">${esc(fp.major)}</b> · <span style="font-family:${esc(Render.famCss(fp.minor)).replace(/"/g, "'")}">${esc(fp.minor)}</span></span>`);
      r.onclick = () => { S.doc.theme.fonts = { major: fp.major, minor: fp.minor }; fillFontSelect(); commit('Theme fonts'); }; fl.appendChild(r);
    }
    const s4 = sec('Slide size & master'); box.appendChild(s4); const pb = el('div', 'pbtns');
    pb.appendChild(btnEl('Slide size…', slideSizeDialog)); pb.appendChild(btnEl('Edit slide master', () => setMode('master'))); pb.appendChild(btnEl('Import theme…', () => IO.importTheme()));
    s4.appendChild(pb);
    s4.appendChild(el('div', 'pnote', `Current: ${esc(S.doc.theme.name || 'Custom')} · ${Math.round(S.doc.w)}×${Math.round(S.doc.h)} (${S.doc.w / S.doc.h > 1.7 ? '16:9' : S.doc.w / S.doc.h > 1.5 ? '16:10' : '4:3'})`));
  }
  function applyTheme(id) {
    const th = M.THEMES.find(t => t.id === id); if (!th) return;
    const d = S.doc; d.theme = M.makeTheme(id);
    d.master.bg = { ...th.bg }; d.master.objects = M.themeDeco(th.deco, d.w, d.h);
    d.master.styles.title.font = '+mj'; d.master.styles.body.font = '+mn';
    fillFontSelect(); commit('Apply theme ' + th.name);
  }

  /* ---------------- dialogs ---------------- */
  function insertTableDialog() {
    if (S.mode === 'slide' && !curSlide()) return;
    Aero.dialog({ title: 'Insert Table', fields: [{ key: 'r', label: 'Rows', type: 'number', value: 4, min: 1, max: 60 }, { key: 'c', label: 'Columns', type: 'number', value: 3, min: 1, max: 20 }],
      onOK: v => { const r = Aero.clamp(v.r | 0, 1, 60), c = Aero.clamp(v.c | 0, 1, 20); const w = Math.min(S.doc.w * 0.8, c * 200); const t = M.table((S.doc.w - w) / 2, S.doc.h * 0.28, w, r, c); target().main.push(t); S.sel = [t.id]; commit('Insert table'); } });
  }
  function insertChart() {
    if (S.mode === 'slide' && !curSlide()) return;
    Aero.dialog({ title: 'Insert Chart', fields: [{ key: 'k', label: 'Chart type', type: 'select', value: 'col', options: [['col', 'Column'], ['stacked', 'Stacked column'], ['bar', 'Bar'], ['line', 'Line'], ['area', 'Area'], ['pie', 'Pie'], ['doughnut', 'Doughnut']] }],
      onOK: v => { const w = S.doc.w * 0.6, h = S.doc.h * 0.6; const o = M.chart(v.k, (S.doc.w - w) / 2, S.doc.h * 0.24, w, h); if (v.k === 'pie' || v.k === 'doughnut') { o.series = [o.series[0]]; o.labels = true; } target().main.push(o); S.sel = [o.id]; commit('Insert chart'); setTimeout(() => editChartData(o), 50); } });
  }
  function footerDialog() {
    const f = S.doc.footer;
    Aero.dialog({ title: 'Header & Footer', instruction: 'Shown on every slide in the positions set by the slide master.', fields: [{ key: 'num', label: 'Slide number', type: 'checkbox', value: f.num }, { key: 'date', label: 'Date', type: 'checkbox', value: f.date }, { key: 'text', label: 'Footer text', type: 'text', value: f.text }, { key: 'skip', label: "Don't show on title slide", type: 'checkbox', value: f.skipTitle }],
      onOK: v => { S.doc.footer = { num: !!v.num, date: !!v.date, text: String(v.text || '').slice(0, 300), skipTitle: !!v.skip }; commit('Header & footer'); } });
  }
  function slideSizeDialog() {
    const d = S.doc; const cur = d.w / d.h > 1.7 ? '169' : d.w / d.h > 1.5 ? '1610' : '43';
    Aero.dialog({ title: 'Slide Size', fields: [{ key: 's', label: 'Size', type: 'select', value: cur, options: [['169', 'Widescreen 16:9 (13.33 × 7.5 in)'], ['1610', '16:10'], ['43', 'Standard 4:3 (10 × 7.5 in)']] }],
      onOK: v => { const [W, H] = { 169: [1280, 720], 1610: [1280, 800], 43: [960, 720] }[v.s]; if (W === d.w && H === d.h) return; resize(W, H); commit('Slide size'); requestAnimationFrame(() => View.fit()); themeCards.clear(); } });
  }
  function resize(W, H) {
    const d = S.doc, k = Math.min(W / d.w, H / d.h), ox = (W - d.w * k) / 2, oy = (H - d.h * k) / 2;
    const fix = list => M.walk(list, o => { o.x = ox + o.x * k; o.y = oy + o.y * k; o.w *= k; o.h *= k; if (o.type === 'table') { o.cols = o.cols.map(c => c * k); o.rows.forEach(r => r.h *= k); } });
    // only top-level of groups to avoid double scaling: walk handles children separately, so scale children absolute coordinates too (they are absolute)
    fix(d.master.objects); fix(d.master.ph); d.layouts.forEach(l => fix(l.objects)); d.slides.forEach(s => fix(s.objects));
    d.w = W; d.h = H;
  }
  function newFromTheme() {
    Aero.dialog({ title: 'New Presentation', fields: [{ key: 't', label: 'Theme', type: 'select', value: 'lumen', options: M.THEMES.map(t => [t.id, t.name]) }, { key: 's', label: 'Size', type: 'select', value: '169', options: [['169', 'Widescreen 16:9'], ['43', 'Standard 4:3']] }],
      onOK: async v => { if (!(await IO.confirmDiscard())) return; const [w, h] = v.s === '43' ? [960, 720] : [1280, 720]; setDocument(M.newDoc({ theme: v.t, w, h }), {}, 'Untitled', null); } });
  }
  function findReplace() {
    Aero.dialog({ title: 'Find & Replace', fields: [{ key: 'f', label: 'Find', type: 'text', value: '' }, { key: 'r', label: 'Replace with', type: 'text', value: '' }, { key: 'c', label: 'Match case', type: 'checkbox', value: false }], ok: 'Replace All',
      onOK: v => {
        if (!v.f) return; let n = 0; const re = new RegExp(v.f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), v.c ? 'g' : 'gi');
        const fixTb = tb => tb && tb.paras.forEach(p => p.runs.forEach(r => { if (r.t) { const t = r.t.replace(re, () => { n++; return v.r; }); r.t = t; } }));
        S.doc.slides.forEach(s => { M.walk(s.objects, o => { fixTb(o.text); if (o.type === 'table') o.rows.forEach(r => r.cells.forEach(c => fixTb(c.text))); }); if (s.notes) s.notes = s.notes.replace(re, () => { n++; return v.r; }); });
        if (n) commit('Replace'); Aero.toast(n ? `Replaced ${n} occurrence${n > 1 ? 's' : ''}` : 'No matches found');
      } });
  }
  function shortcutsDialog() {
    const rows = [['F5 / Shift+F5 / Alt+F5', 'Present from start / current / presenter view'], ['Ctrl+M', 'New slide'], ['Ctrl+D', 'Duplicate'], ['Ctrl+G / Ctrl+Shift+G', 'Group / ungroup'], ['Enter / F2 / double-click', 'Edit text of the selected shape'], ['Esc', 'Stop editing / leave group / deselect'], ['Tab / Shift+Tab', 'Select next object · in text: change list level'],
      ['Arrows (Shift)', 'Nudge 1 px (10 px)'], ['Shift while dragging', 'Constrain / keep proportions / 15° rotation'], ['Alt while dragging', 'Disable snapping'], ['Ctrl+drag', 'Duplicate while moving'], ['Ctrl+wheel', 'Zoom'], ['PageUp / PageDown', 'Previous / next slide'],
      ['Ctrl+B / I / U', 'Bold / italic / underline'], ['Ctrl+] / Ctrl+[', 'Bigger / smaller text'], ['Ctrl+L / E / R / J', 'Align left / center / right / justify'], ['V T R O L S H', 'Tools: select, text, rectangle, oval, line, shapes, pan'],
      ['In the show', '→ Space click: next · ←: previous · B/W: black/white · number+Enter: go to slide · Esc: end']];
    Aero.dialog({ title: 'Keyboard Shortcuts', noCancel: true, width: 560, html: `<table style="width:100%;border-collapse:collapse;font-size:12px">${rows.map(([k, v]) => `<tr><td style="padding:3px 10px 3px 0;white-space:nowrap;color:#1e395b;font-weight:600">${esc(k)}</td><td style="padding:3px 0">${esc(v)}</td></tr>`).join('')}</table>` });
  }
  function aboutDialog() {
    Aero.dialog({ title: 'About Lumen Slides', noCancel: true, html: `<div style="line-height:1.55;font-size:12px"><b style="font-size:15px;color:#1e395b">Lumen Slides</b> — free presentation editor, part of Lumen Studio.<br>Slide masters &amp; layouts, themes, rich text, shapes, pictures, tables, charts, transitions, animations, speaker notes and a presenter view. Opens and saves PowerPoint (.pptx); exports PDF and PNG.<br><br><span class="dim">Bundled: fflate (MIT) · pdf-lib (MIT) · Inter, Montserrat, Lora, Playfair Display, Bebas Neue, Caveat fonts (SIL OFL 1.1).</span></div>` });
  }

  /* ---------------- refresh & status ---------------- */
  function refresh(panels) {
    if (!S.doc) return;
    renderSlides();
    if (S.sorter) renderSorter();
    updateCmd();
    const vis = id => !$('#' + id).hidden;
    if (vis('tp-format')) renderProps();
    if (vis('tp-anim')) renderAnim();
    if (vis('tp-design')) renderDesign();
    if (vis('tp-hist')) Aero.renderHistory($('#hist'), S.hist, i => restore(S.hist.go(i)));
    const s = curSlide(), notes = $('#notes');
    notes.disabled = S.mode !== 'slide' || !s;
    if (document.activeElement !== notes) notes.value = s && S.mode === 'slide' ? s.notes || '' : '';
    $('#masterbar').hidden = S.mode !== 'master';
    if (S.mode === 'master') $('#mastername').textContent = curLayout() ? '· ' + curLayout().name : '· Master';
    status();
  }
  function status(wx, wy) {
    if (!S.doc) return;
    $('#st-slide').textContent = S.mode === 'master' ? 'Slide Master' : `Slide ${S.cur + 1} of ${S.doc.slides.length}`;
    $('#st-zoom').textContent = Math.round(S.view.z * 100) + '%';
    if (wx != null) $('#st-pos').textContent = `${Math.round(wx)}, ${Math.round(wy)} px`;
    const sel = selObjs();
    $('#st-sel').textContent = S.edit ? 'Editing text' : sel.length === 1 ? `${objName(sel[0])} · ${Math.round(sel[0].w)}×${Math.round(sel[0].h)}${sel[0].rot ? ' · ' + Math.round(sel[0].rot) + '°' : ''}` : sel.length ? `${sel.length} objects` : S.tool !== 'select' ? 'Drag on the slide to draw' : '';
    $('#st-theme').textContent = `${S.doc.theme.name || 'Theme'} · ${S.doc.theme.fonts.major} / ${S.doc.theme.fonts.minor}`;
  }
  const showActive = () => !$('#show').hidden || !$('#pres').hidden;
  return { init, refresh, status, setTool, goSlide, renderSorter, thumbsSoon, contextMenu, editChartData, cropDialog, tableOp, showActive, colorPop, selectTab, setMode, setSorter, applyTheme, newSlide, fillFontSelect, lastCell, previewAnims, objName, resize };
})();
