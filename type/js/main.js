'use strict';
/* Lumen Type — menus, toolbox, command bar, shortcuts, welcome, startup. */
(function () {
  const A = window.LT, TM = window.TM, $ = id => document.getElementById(id);
  const inGlyph = () => A.view === 'glyph', inFont = () => A.view === 'font';
  const need = fn => () => { if (A.font) fn(); };
  const ed = name => need(() => { if (!inGlyph()) A.setView('glyph'); A.ed[name](); });

  const menus = {
    File: [['New Font…', 'Ctrl+N', () => A.newDialog()], ['Open…', 'Ctrl+O', () => A.openDialog()], { label: 'Open Sample', fn: async () => { if (await A.confirmDiscard()) A.openSample(); } }, '-',
      ['Save', 'Ctrl+S', need(() => A.save(false))], ['Save As…', 'Ctrl+Shift+S', need(() => A.save(true))], '-',
      ['Export Font…', 'Ctrl+E', need(() => A.exportDialog())], ['Export TrueType (.ttf)', '', need(() => A.exportDialog('ttf'))], ['Export OpenType CFF (.otf)', '', need(() => A.exportDialog('otf'))], ['Export WOFF2', '', need(() => A.exportDialog('woff2-ttf'))], ['Export UFO (zipped)…', '', need(() => A.exportUFO())], '-',
      ['Proof in Browser…', 'F5', need(() => A.testInstall())]],
    Edit: [['Undo', 'Ctrl+Z', () => A.undo()], ['Redo', 'Ctrl+Shift+Z/Ctrl+Y', () => A.redo()], '-',
      ['Copy', 'Ctrl+C', need(() => { if (inGlyph()) A.ed.copy(); else if (inFont()) copyGlyph(); })], ['Paste', 'Ctrl+V', need(() => { if (inGlyph()) A.ed.paste(); else if (inFont()) pasteGlyphs(); })],
      ['Delete', 'Delete/Backspace', need(() => deleteKey())], ['Select All', 'Ctrl+A', need(() => { if (inGlyph()) A.ed.selectAll(); else if (inFont()) { A.sel = A.visibleNames(); A.emit('sel'); } })], ['Deselect', 'Ctrl+Shift+A', need(() => { if (inGlyph()) A.ed.deselect(); else { A.sel = []; A.emit('sel'); } })]],
    Glyph: [['New Glyph…', 'Ctrl+Shift+N', need(() => A.newGlyphDialog())], ['Duplicate Glyph', 'Ctrl+D', need(() => A.duplicateGlyphs(inFont() ? A.sel : [A.cur]))], ['Delete Glyph', 'Ctrl+Delete', need(() => A.deleteGlyphs(inFont() ? A.sel : [A.cur]))], '-',
      ['Build Composite (accents)', '', need(() => A.buildComposites(inFont() && A.sel.length ? A.sel : [A.cur]))], ['Add All Missing in Block', '', need(() => { if (A.filter.kind !== 'block') return A.toast('Pick a Unicode block on the left first'); A.createBlockMissing(); })], '-',
      ['Previous Glyph', 'PageUp', need(() => A.view === 'glyph' ? A.openGlyph(A.adjacent(-1)) : A.setCur(A.adjacent(-1)))], ['Next Glyph', 'PageDown', need(() => A.view === 'glyph' ? A.openGlyph(A.adjacent(1)) : A.setCur(A.adjacent(1)))], '-',
      ['Add Component…', 'Ctrl+Shift+C', ed('addComponentDialog')], ['Decompose Components', '', ed('decompose')], ['Center in Width', '', ed('centerGlyph')],
      '#Mark color', ...A.MARKS.slice(0, 7).map((c, k) => ({ label: k ? `Mark ${['', 'red', 'orange', 'yellow', 'green', 'teal', 'blue'][k]}` : 'No mark', fn: need(() => A.setMark(inFont() && A.sel.length ? A.sel : [A.cur], k || null)) }))],
    Path: [['Reverse Contours', '', ed('reverse')], ['Correct Path Direction', 'Ctrl+Shift+R', ed('correctDirection')], ['Remove Overlap', 'Ctrl+Shift+O', ed('removeOverlap')], ['Add Extremes', '', ed('addExtremes')], ['Round Coordinates', '', ed('round')], ['Set Start Point', '', ed('setStart')], ['Close Open Paths', '', ed('closePaths')], '-',
      ['Convert to Quadratic (TrueType)', '', ed('toQuadratic')], ['Convert to Cubic (PostScript)', '', ed('toCubic')], ['Selected Segments → Line', '', need(() => A.ed.convertSegments('line'))], ['Selected Segments → Curve', '', need(() => A.ed.convertSegments('curve'))], ['Toggle Smooth / Corner', 'Ctrl+Shift+T', need(() => A.ed.toggleSmoothSel())], '-',
      ['Flip Horizontal', 'Ctrl+Shift+H', need(() => { if (inGlyph()) A.ed.flip('h'); })], ['Flip Vertical', 'Ctrl+Shift+V', need(() => { if (inGlyph()) A.ed.flip('v'); })], ['Transform…', 'Ctrl+T', ed('transformDialog')]],
    Font: [['Font Info', 'Ctrl+I', need(() => A.setView('info'))], ['Kerning', 'Ctrl+K', need(() => A.setView('kern'))], '-',
      ['Sort Glyphs by Unicode', '', need(() => A.change('Sort Glyphs', d => { const o = d.order(); const key = n => { const u = d.font.glyphs[n].unicodes[0]; return n === '.notdef' ? -2 : u == null ? 0x200000 : u; }; o.sort((a, b) => key(a) - key(b) || a.localeCompare(b)); }))],
      ['Correct Directions in All Glyphs', '', need(() => { let n = 0; A.change('Correct All Directions', d => { d.font.order.forEach(nm => { const g = d.font.glyphs[nm]; if (!g.contours.length) return; const c = TM.cloneGlyph(g); if (TM.correctDirections(c)) { d.glyph(nm).contours = c.contours; n++; } }); if (!n) return false; }); A.toast(n ? `Fixed ${n} glyph(s)` : 'All contour directions are correct'); })]],
    View: [['Font Overview', 'Alt+1', need(() => A.setView('font'))], ['Edit Glyph', 'Alt+2', need(() => A.setView('glyph'))], ['Kerning', 'Alt+3', need(() => A.setView('kern'))], ['Font Info', 'Alt+4', need(() => A.setView('info'))], '-',
      ['Zoom In', 'Ctrl+=', need(() => zoom(1.25))], ['Zoom Out', 'Ctrl+-', need(() => zoom(0.8))], ['Fit Glyph', 'Ctrl+0', need(() => { if (inGlyph()) A.fitGlyph(); else { A.prefs.cell = 76; A.savePrefs(); A.redrawGrid(); syncCmd(); } })], ['Actual Size (1 em = 75% height)', 'Ctrl+1', need(() => { if (inGlyph()) A.editorActual(); })], '-',
      { label: 'Preview Fill', key: 'Ctrl+Shift+F', fn: () => togglePref('fill'), checked: () => A.prefs.fill }, { label: 'Metric Lines', fn: () => togglePref('metrics'), checked: () => A.prefs.metrics }, { label: 'Point Coordinates', fn: () => togglePref('coords'), checked: () => A.prefs.coords },
      { label: 'Text Preview Strip', fn: () => { togglePref('preview'); applyPreview(); }, checked: () => A.prefs.preview }],
    Help: [['Keyboard Shortcuts', 'F1', () => shortcutsDialog()], ['About Lumen Type', '', () => Aero.dialog({ title: 'About Lumen Type', noCancel: true, html: `<div style="display:flex;gap:16px;align-items:center;margin:6px 0 4px"><img src="../kit/icons/type.png" width="64" height="64" alt="" onerror="this.style.visibility='hidden'"><div><div style="font-size:18px;color:#003399">Lumen Type</div><div class="dnote">Font editor for Lumen Studio — glyph overview by Unicode block, cubic &amp; quadratic Bézier pen, components and accent composites, metrics, contour direction and overlap removal, kerning pairs with groups and exceptions, font info, TTF / OTF (CFF) / WOFF / WOFF2 / UFO export.<br>Built on opentype.js (MIT, CFF writer &amp; parser), paper.js (MIT, overlap removal), fflate (MIT) and wawoff2 (MIT, Google woff2). Sample: Montserrat (SIL OFL 1.1).</div></div></div>` })]],
  };
  // font overview: copy the current glyph's outline, paste it into the selected glyphs (replacing their outlines)
  function copyGlyph() { const g = A.glyph(A.cur); if (!g) return; A.clip = { contours: TM.clone(g.contours), components: TM.clone(g.components), advance: g.advance, from: g.name }; A.toast('Copied glyph ' + g.name); }
  function pasteGlyphs() {
    if (!A.clip) return; const tgt = (A.sel.length ? A.sel : [A.cur]).filter(n => A.glyph(n));
    A.change('Paste Glyph', d => tgt.forEach(n => { const g = d.glyph(n); g.contours = TM.clone(A.clip.contours); g.components = TM.clone(A.clip.components).filter(c => c.base !== n && !TM.usesComponent(d.font, c.base, n)); if (A.clip.advance != null) g.advance = A.clip.advance; }));
    A.toast(`Pasted into ${tgt.length} glyph${tgt.length > 1 ? 's' : ''}`);
  }
  function zoom(f) { if (inGlyph()) A.zoomEditor(f); else if (inFont()) { A.prefs.cell = Math.max(40, Math.min(200, Math.round(A.prefs.cell * f))); A.savePrefs(); A.redrawGrid(); syncCmd(); } }
  function togglePref(k) { A.prefs[k] = !A.prefs[k]; A.savePrefs(); A.redrawEditor(); A.redrawGrid(); syncCmd(); }
  function applyPreview() { $('preview').hidden = !A.prefs.preview; A.redrawPreview(); }
  function deleteKey() {
    if (inGlyph()) { A.ed.deleteSel(); return; }
    if (inFont() && A.sel.length) { A.deleteGlyphs(); return; }
    if (A.view === 'kern') A.kernRemove();
  }
  function shortcutsDialog() {
    const rows = [['V · P · R · E · M · H', 'Select · Pen · Rectangle · Ellipse · Measure · Hand'], ['Space (hold)', 'Temporary hand + filled preview'], ['Click / drag (Pen)', 'Corner point / smooth point with handles; click the first point to close'], ['Alt+drag (Pen)', 'Break the handle (only the outgoing handle moves)'], ['Click a segment (Pen) / Alt+click (Select)', 'Insert a point'], ['Double-click point', 'Toggle smooth / corner'], ['Double-click segment', 'Select the whole contour'], ['Drag the right metric line', 'Change the advance width'], ['Arrows / Shift / Ctrl', 'Nudge 1 / 10 / 100 units'], ['PageUp / PageDown', 'Previous / next glyph'], ['Ctrl+Shift+R / Ctrl+Shift+O', 'Correct path direction / Remove overlap'], ['Ctrl+T', 'Transform selection'], ['Ctrl+Shift+C', 'Add component'], ['Alt+1 … Alt+4', 'Font · Glyph · Kerning · Font Info'], ['← / → in Kerning (Shift = 1)', 'Kern the selected pair by 10 units'], ['Ctrl+wheel', 'Zoom at the cursor'], ['/name in the preview', 'Type an unencoded glyph by name'], ['F5', 'Proof the compiled font in the browser'], ['Ctrl+E', 'Export font']];
    Aero.dialog({ title: 'Keyboard Shortcuts', noCancel: true, width: 560, html: `<table class="kbd">${rows.map(r => `<tr><td>${Aero.esc(r[0])}</td><td>${Aero.esc(r[1])}</td></tr>`).join('')}</table>` });
  }

  // ---------- command bar ----------
  function buildCmd() {
    const c = $('cmd'), v = A.view;
    if (!A.font) { c.innerHTML = '<span class="hint">Open a font or start a new one.</span>'; return; }
    if (v === 'font') c.innerHTML = `<button class="aero-btn" id="cNew" title="New glyph (Ctrl+Shift+N)">＋ Glyph</button><button class="aero-btn" id="cDup" title="Duplicate (Ctrl+D)">Duplicate</button><button class="aero-btn" id="cDel" title="Delete selected glyphs">Delete</button><span class="sep"></span><button class="aero-btn" id="cComp" title="Build accented letters from base + accent components">Build Composites</button><button class="aero-btn" id="cMiss" title="Create all glyphs missing from the selected Unicode block">Add Missing</button><span class="sep"></span><input type="search" id="cSearch" placeholder="Search name, character, U+0041…" style="width:200px" value="${Aero.esc(A.filter.q)}"><span class="sep"></span><label>Size <input type="range" id="cCell" min="44" max="180" value="${A.prefs.cell}" style="width:90px"></label>`;
    else if (v === 'glyph') c.innerHTML = `<button class="aero-btn small" id="cPrev" title="Previous glyph (PageUp)">◀</button><input type="text" id="cGlyph" list="cGlyphs" value="${Aero.esc(A.cur || '')}" class="gname" title="Go to glyph"><datalist id="cGlyphs">${A.font.order.slice(0, 5000).map(n => `<option value="${Aero.esc(n)}">`).join('')}</datalist><button class="aero-btn small" id="cNext" title="Next glyph (PageDown)">▶</button><span class="sep"></span><label title="Curve type the pen and shape tools create">Curves <select id="cPen"><option value="cubic">Cubic (PostScript)</option><option value="quadratic">Quadratic (TrueType)</option></select></label><label><input type="checkbox" id="cFill"${A.prefs.fill ? ' checked' : ''}> Fill</label><span class="sep"></span><button class="aero-btn" id="cComp2" title="Add component (Ctrl+Shift+C)">＋ Component</button><button class="aero-btn" id="cDir" title="Correct path direction (Ctrl+Shift+R)">Correct Direction</button><button class="aero-btn" id="cOvl" title="Remove overlap (Ctrl+Shift+O)">Remove Overlap</button><span class="sep"></span><button class="aero-btn small" id="cFit" title="Fit (Ctrl+0)">Fit</button>`;
    else if (v === 'kern') c.innerHTML = `<span class="tname">Kerning</span><span class="hint">${TM.kernPairs(A.font).length} entries · ${Object.keys(A.font.groups).length} groups — click a pair in the preview strip, or type glyphs above the canvas</span><span class="sep"></span><button class="aero-btn" id="cPairs">Show pair list</button>`;
    else c.innerHTML = `<span class="tname">Font Info</span><span class="sep"></span><button class="aero-btn" id="cExp">Export Font…</button><button class="aero-btn" id="cProof" title="Compile and load the font in the browser (F5)">Proof in Browser</button>`;
    const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };
    on('cNew', 'click', () => A.newGlyphDialog()); on('cDup', 'click', () => A.duplicateGlyphs()); on('cDel', 'click', () => A.deleteGlyphs());
    on('cComp', 'click', () => A.buildComposites(A.sel.length ? A.sel : [A.cur])); on('cMiss', 'click', () => { if (A.filter.kind !== 'block') return A.toast('Pick a Unicode block on the left first'); A.createBlockMissing(); });
    on('cSearch', 'input', e => { A.filter = { ...A.filter, q: e.target.value }; $('gridScroll').scrollTop = 0; A.emit('filter'); });
    on('cCell', 'input', e => { A.prefs.cell = +e.target.value; A.savePrefs(); A.redrawGrid(); });
    on('cPrev', 'click', () => A.openGlyph(A.adjacent(-1))); on('cNext', 'click', () => A.openGlyph(A.adjacent(1)));
    on('cGlyph', 'change', e => { const n = e.target.value.trim(); if (A.glyph(n)) A.openGlyph(n); else { const g = A.font.order.find(x => A.glyph(x).unicodes.includes(n.codePointAt(0)) && [...n].length === 1); if (g) A.openGlyph(g); else A.toast('No glyph ' + n); } });
    if ($('cPen')) $('cPen').value = A.prefs.penMode;
    on('cPen', 'change', e => { A.prefs.penMode = e.target.value; A.savePrefs(); });
    on('cFill', 'change', e => { A.prefs.fill = e.target.checked; A.savePrefs(); A.redrawEditor(); });
    on('cComp2', 'click', () => A.ed.addComponentDialog()); on('cDir', 'click', () => A.ed.correctDirection()); on('cOvl', 'click', () => A.ed.removeOverlap()); on('cFit', 'click', () => A.fitGlyph());
    on('cPairs', 'click', () => A.rightTab('pairs')); on('cExp', 'click', () => A.exportDialog()); on('cProof', 'click', () => A.testInstall());
  }
  function syncCmd() { if ($('cCell')) $('cCell').value = A.prefs.cell; if ($('cFill')) $('cFill').checked = A.prefs.fill; if ($('cGlyph') && document.activeElement !== $('cGlyph')) $('cGlyph').value = A.cur || ''; }

  // ---------- welcome ----------
  function showWelcome() {
    const w = $('welcome'); w.hidden = false;
    w.innerHTML = `<div class="wcard"><img src="../kit/icons/type.png" alt="" onerror="this.style.visibility='hidden'"><h2>Lumen Type</h2><p>Design fonts: draw glyphs with Bézier curves, space and kern them, export TTF, OTF, WOFF and WOFF2.</p>
      <div class="wbtns"><button class="aero-btn pri" data-w="sample">Open Sample</button><button class="aero-btn" data-w="new">New Font…</button><button class="aero-btn" data-w="open">Open…</button></div>
      <p class="dim">Drop a .ltype project, a .ttf / .otf / .woff / .woff2 font or a zipped .ufo anywhere to open it.</p></div>`;
    w.onclick = e => { const b = e.target.closest('[data-w]'); if (!b) return; ({ sample: () => A.openSample(), new: () => A.newDialog(), open: () => A.openDialog() })[b.dataset.w](); };
  }
  A.hideWelcome = () => { $('welcome').hidden = true; };

  // ---------- startup ----------
  Aero.init({
    name: 'Lumen Type', icon: '../kit/icons/type.png', doc: 'Untitled', menus,
    dropTarget: $('stage'), dropText: 'Drop a font (.ttf .otf .woff .woff2), zipped UFO or .ltype project to open it',
    onDropFiles: files => A.openFiles(files),
    onSave: () => A.save(false),
  });
  const TOOLS = [
    { id: 'select', title: 'Select', key: 'V', icon: '<path d="M6 3l12 9-5.5 1.2L15 20l-2.6 1-2.6-6.6L6 18z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' },
    { id: 'pen', title: 'Pen', key: 'P', icon: '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"><path d="M12 20l7-7 2.5 2.5-7 7z"/><path d="M18 13l-1.5-7.5L3 2l3.5 13.5L14 17"/><path d="M3 2l7.6 7.6"/><circle cx="11.5" cy="11" r="1.8"/></g>' },
    { id: 'rect', title: 'Rectangle', key: 'R', icon: '<rect x="4" y="6" width="16" height="12" rx="1" fill="none" stroke="currentColor" stroke-width="1.7"/>' },
    { id: 'ellipse', title: 'Ellipse', key: 'E', icon: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5" fill="none" stroke="currentColor" stroke-width="1.7"/>' },
    null,
    { id: 'measure', title: 'Measure', key: 'M', icon: '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 17 17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/></g>' },
    { id: 'hand', title: 'Hand', key: 'H', icon: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V5.5a1.5 1.5 0 0 1 3 0V12M17 12V8.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1a7 7 0 0 1-5.5-2.8L3.3 15.6a1.6 1.6 0 0 1 2.5-2L8 15.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' },
  ];
  A.toolbox = Aero.toolbox($('tools'), TOOLS, id => {
    A.prefs.tool = id; A.emit('tool');
    if (A.font && id !== 'hand' && A.view !== 'glyph' && ['pen', 'rect', 'ellipse', 'measure'].includes(id)) A.setView('glyph');
  });
  const S = Aero.shortcut;
  [['ArrowLeft', -1, 0], ['ArrowRight', 1, 0], ['ArrowUp', 0, 1], ['ArrowDown', 0, -1]].forEach(([k, x, y]) => {
    S(k, () => { if (inGlyph()) A.ed.nudge(x, y); }); S('Shift+' + k, () => { if (inGlyph()) A.ed.nudge(x * 10, y * 10); }); S('Ctrl+' + k, () => { if (inGlyph()) A.ed.nudge(x * 100, y * 100); });
  });
  S('Escape', () => { if (inGlyph()) { if (!A.penFinish()) A.ed.deselect(); } else if (inFont()) { A.sel = []; A.emit('sel'); } });
  S('Enter', () => { if (inGlyph()) A.penFinish(); else if (inFont() && A.cur) A.openGlyph(A.cur); });

  A.initPreview(); A.initFontView(); A.initEditor(); A.initKerning(); A.initInfo(); A.initPanels();
  document.querySelectorAll('#viewTabs .aero-tab').forEach(t => t.addEventListener('click', () => A.setView(t.dataset.v)));
  A.on('view', v => { buildCmd(); A.status(4, ''); if (v === 'kern' || v === 'info') { A.status(1, v === 'kern' ? 'Kerning' : 'Font Info'); A.status(2, ''); A.status(3, ''); } else if (v === 'font') A.status(1, 'Ready'); });
  A.on('font', () => { buildCmd(); $('vtDoc').textContent = ''; });
  A.on('cur', syncCmd);
  A.on('change', () => { const I = A.font && A.font.info; $('vtDoc').textContent = I ? `${I.familyName} ${I.styleName} · ${A.font.order.length} glyphs · ${I.unitsPerEm} UPM` : ''; if (A.view === 'kern') { const h = $('cmd').querySelector('.hint'); if (h) h.textContent = `${TM.kernPairs(A.font).length} entries · ${Object.keys(A.font.groups).length} groups — click a pair in the preview strip, or type glyphs above the canvas`; } });
  A.toolbox.set(['select', 'pen', 'rect', 'ellipse', 'measure', 'hand'].includes(A.prefs.tool) ? A.prefs.tool : 'select');
  applyPreview(); buildCmd();
  window.addEventListener('error', e => console.error('Uncaught', e.message));
  if (/[?&]sample\b/.test(location.search)) A.openSample(); else showWelcome();
})();
