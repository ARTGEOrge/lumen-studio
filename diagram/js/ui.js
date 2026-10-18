'use strict';
/* Lumen Diagram — UI: toolbox, menus, shape library, format/arrange/layers panels, page tabs, context menu,
   file open/save, import/export (SVG, PNG, PDF, draw.io), keyboard handling and start-up. */
(function () {
  const A = DiaApp, G = DiaGeom, S = DiaShapes, M = DiaModel, R = DiaRoute, Rn = DiaRender, X = DiaXML;
  const $ = id => document.getElementById(id);
  const esc = Aero.esc;
  const AUTOSAVE = 'lumen-diagram-autosave';
  const page = () => A.page();

  /* ---------- toolbox ---------- */
  const ICON = {
    select: '<path d="M6 3l12 9-5.5 1 3.5 6.5-2.5 1.3-3.4-6.6L6 18z"/>',
    connector: '<circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="6" r="2.5"/><path d="M7.5 18H12V6h4.5"/>',
    text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
    hand: '<path d="M8 13V6.5a1.5 1.5 0 013 0V12M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7c0 4-2.5 7-6 7-2.6 0-4-1.4-5.4-3.4L3.8 13a1.5 1.5 0 012.5-1.6L8 14"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1.5"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
    diamond: '<path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.8"/><path d="M4 17l5-5 4 4 2.5-2.5L20 18"/>',
    layout: '<rect x="9" y="3" width="6" height="4" rx="1"/><rect x="3" y="17" width="6" height="4" rx="1"/><rect x="15" y="17" width="6" height="4" rx="1"/><path d="M12 7v5M6 17v-5h12v5"/>',
  };
  const TOOLS = [
    { id: 'select', title: 'Select / move', key: 'V', icon: ICON.select },
    { id: 'connector', title: 'Connector', key: 'C', icon: ICON.connector },
    { id: 'text', title: 'Text', key: 'T', icon: ICON.text },
    { id: 'hand', title: 'Pan (or hold Space)', key: 'H', icon: ICON.hand },
    null,
    { id: 'draw:rect', title: 'Draw rectangle', key: 'R', icon: ICON.rect },
    { id: 'draw:ellipse', title: 'Draw ellipse', key: 'E', icon: ICON.ellipse },
    { id: 'draw:diamond', title: 'Draw diamond', key: 'D', icon: ICON.diamond },
  ];
  const TOOLNAME = { select: 'Select', connector: 'Connector', text: 'Text', hand: 'Pan', 'draw:rect': 'Rectangle', 'draw:ellipse': 'Ellipse', 'draw:diamond': 'Diamond' };
  const HINTS = {
    select: 'Drag to move · Shift adds · Ctrl-drag copies · Alt skips snapping · hover a shape for connection points',
    connector: 'Drag from a shape (or its ✕ points) to another shape · drop on a ✕ for a fixed point',
    text: 'Click to place text', hand: 'Drag to pan · Ctrl+wheel zooms',
    'draw:rect': 'Drag to draw · click for default size', 'draw:ellipse': 'Drag to draw', 'draw:diamond': 'Drag to draw',
  };
  // keys are handled by our own key handler (so typing on a selected shape edits its text instead)
  A.toolbox = Aero.toolbox($('tools'), TOOLS.map(t => t && { ...t, key: undefined, title: t.title + ` (${t.key})` }), id => {
    A.tool = id; $('toolName').textContent = TOOLNAME[id] || id; $('hint').textContent = HINTS[id] || '';
    A.svg.classList.toggle('pan', id === 'hand'); A.svg.classList.toggle('cross', id === 'connector' || id.startsWith('draw:') || id === 'text');
  });

  /* ---------- command bar ---------- */
  const ARROWS = [['none', 'None'], ['classic', 'Classic'], ['block', 'Block'], ['blockOpen', 'Open triangle'], ['open', 'Open'], ['diamond', 'Diamond'], ['diamondOpen', 'Open diamond'], ['oval', 'Dot'], ['ovalOpen', 'Circle'], ['erMandOne', 'ER one'], ['erMany', 'ER many'], ['erOneMany', 'ER one-or-many'], ['erZeroMany', 'ER zero-or-many']];
  $('cArrow').innerHTML = ARROWS.map(([v, t]) => `<option value="${v}">${t}</option>`).join(''); $('cArrow').value = 'classic';
  $('cRoute').onchange = () => { A.edgeStyle = { ...A.edgeStyle, route: $('cRoute').value }; markEdgePreset(); };
  $('cArrow').onchange = () => { A.edgeStyle = { ...A.edgeStyle, endArrow: $('cArrow').value }; markEdgePreset(); };
  $('cSnap').onchange = () => { A.snap = $('cSnap').checked; };
  $('cGrid').onchange = () => A.commit($('cGrid').checked ? 'Show grid' : 'Hide grid', p => { p.showGrid = $('cGrid').checked; });
  $('cZoom').onchange = () => { const v = $('cZoom').value; if (v === 'fit') A.fit(); else if (v !== 'custom') A.zoomAt(+v); updateZoomBox(); };
  $('bUndo').onclick = () => A.undo(); $('bRedo').onclick = () => A.redo();
  function updateZoomBox() { const z = A.view().z, s = $('cZoom'), o = [...s.options].find(o => +o.value && Math.abs(+o.value - z) < 0.001); if (o) s.value = o.value; else { const c = s.querySelector('[value=custom]'); c.textContent = Math.round(z * 100) + '%'; c.hidden = false; s.value = 'custom'; } }

  /* ---------- status ---------- */
  let ptr = { x: 0, y: 0 }, msgT = null;
  A.onPointer = w => { ptr = w; $('st4').textContent = `${page().name} (${A.pi + 1}/${A.doc.pages.length}) · ${Math.round(w.x)}, ${Math.round(w.y)}`; };
  A.onStatus = msg => {
    if (msg) { $('st1').textContent = msg; clearTimeout(msgT); msgT = setTimeout(() => A.onStatus(), 2500); }
    else $('st1').textContent = 'Ready';
    $('st2').textContent = Math.round(A.view().z * 100) + '%';
    const cells = A.selCells();
    $('st3').textContent = cells.length ? (cells.length === 1 ? describe(cells[0]) : `${cells.length} selected`) : `${page().cells.filter(c => c.kind === 'shape').length} shapes · ${page().cells.filter(c => c.kind === 'edge').length} connectors`;
    A.onPointer(ptr);
  };
  const describe = c => c.kind === 'edge' ? `Connector (${S.styleOf(c).route})` : c.kind === 'group' ? 'Group' : `${S.get(c.shape).name} · ${Math.round(c.x)}, ${Math.round(c.y)} · ${Math.round(c.w)} × ${Math.round(c.h)}${c.rot ? ' · ' + c.rot + '°' : ''}`;
  A.onView = () => { updateZoomBox(); $('st2').textContent = Math.round(A.view().z * 100) + '%'; };
  A.onHistory = () => { $('bUndo').disabled = A.hist.index <= 0; $('bRedo').disabled = A.hist.index >= A.hist.items.length - 1; };

  /* ---------- shape library ---------- */
  function thumbSVG(item) {
    let prims = [];
    if (item.startsWith('e:')) {
      const st = S.EP[item.slice(2)].style;
      const e = M.makeEdge({ x: 3, y: 29 }, { x: 37, y: 5 }, { style: { ...st, arrowSize: 7, sw: Math.min(st.sw || 1.5, 1.6) } });
      const r = R.routeEdge(e, { byId: new Map(), obstacles: [] });
      prims = Rn.edgeGeom(e, r, {}).prims;
      return `<svg viewBox="0 0 40 34">${Rn.primsSVG(prims, 't' + item.replace(/\W/g, ''))}</svg>`;
    }
    const id = item.startsWith('t:') ? S.TPL[item.slice(2)].icon : item, d = S.get(id);
    if (id === 'text' || id === 'heading') return `<svg viewBox="0 0 40 34"><text x="20" y="${id === 'text' ? 22 : 23}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${id === 'text' ? 15 : 17}" font-weight="${id === 'text' ? 'normal' : 'bold'}" fill="#1f2933">${id === 'text' ? 'Text' : 'H1'}</text></svg>`;
    const text = id === 'text' ? 'Text' : id === 'heading' ? 'Title' : d.sections ? d.text : '';
    const c = M.makeShape(id, 0, 0, { text, style: id === 'heading' ? { fontSize: 20 } : {} });
    prims = Rn.shapePrims(c);
    const b = Rn.primsBox(prims) || { x: 0, y: 0, w: c.w, h: c.h }, pad = Math.max(b.w, b.h) * 0.06;
    const k = Math.min(36 / b.w, 32 / b.h);
    if (k < 0.18) prims = prims.filter(p => p.k !== 'text');
    let s = Rn.primsSVG(prims, 't' + id).replace(/<path /g, '<path vector-effect="non-scaling-stroke" ');
    return `<svg viewBox="${b.x - pad} ${b.y - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}" preserveAspectRatio="xMidYMid meet">${s}</svg>`;
  }
  const itemName = it => it.startsWith('e:') ? S.EP[it.slice(2)].name : it.startsWith('t:') ? S.TPL[it.slice(2)].name : S.get(it).name;
  let closedLibs = new Set(); try { closedLibs = new Set(JSON.parse(localStorage.getItem('lumen-diagram-libs') || '[]')); } catch (e) { }
  const thumbCache = new Map();
  function buildLibrary() {
    const q = $('libSearch').value.trim().toLowerCase(), lib = $('lib'); lib.innerHTML = ''; let n = 0;
    for (const L of S.libs) {
      const items = L.items.filter(it => !q || itemName(it).toLowerCase().includes(q) || L.name.toLowerCase().includes(q));
      if (!items.length) continue;
      const sec = Aero.el('div', 'libsec' + (closedLibs.has(L.id) && !q ? ' closed' : ''));
      const ph = Aero.el('div', 'aero-ph', `<span class="tw">${closedLibs.has(L.id) && !q ? '▶' : '▼'}</span>${esc(L.name)}<span class="right">${items.length}</span>`);
      ph.onclick = () => { if (closedLibs.has(L.id)) closedLibs.delete(L.id); else closedLibs.add(L.id); try { localStorage.setItem('lumen-diagram-libs', JSON.stringify([...closedLibs])); } catch (e) { } buildLibrary(); };
      const grid = Aero.el('div', 'libgrid');
      for (const it of items) {
        if (!thumbCache.has(it)) thumbCache.set(it, thumbSVG(it));
        const b = Aero.el('div', 'libitem' + (it.startsWith('e:') ? ' edgeitem' : ''), thumbCache.get(it));
        b.title = itemName(it) + (it.startsWith('e:') ? ' — click to use for new connectors (or apply to selected connectors)' : ' — click to add, drag onto the page; Shift+click adds it connected to the selected shape');
        b.dataset.item = it; b.draggable = !it.startsWith('e:');
        b.addEventListener('dragstart', e => { e.dataTransfer.setData('application/x-lumen-shape', it); e.dataTransfer.effectAllowed = 'copy'; });
        b.onclick = e => A.insertItem(it, null, false, e.shiftKey);
        grid.appendChild(b); n++;
      }
      sec.append(ph, grid); lib.appendChild(sec);
    }
    if (!n) lib.innerHTML = '<div class="empty">No shapes match.</div>';
    $('libCount').textContent = n; markEdgePreset();
  }
  $('libSearch').oninput = buildLibrary;
  function markEdgePreset() {
    document.querySelectorAll('.libitem.edgeitem').forEach(b => { const st = S.EP[b.dataset.item.slice(2)].style; b.classList.toggle('on', Object.keys(st).every(k => A.edgeStyle[k] === st[k]) && Object.keys(A.edgeStyle).every(k => st[k] === A.edgeStyle[k])); });
    $('cRoute').value = A.edgeStyle.route || 'orthogonal'; $('cArrow').value = A.edgeStyle.endArrow || 'classic';
  }
  A.themeStyle = shape => {
    const T = M.THEMES[A.doc.theme]; if (!T || A.doc.theme === 'lumen') return {};
    const d = S.get(shape); if (d.id === 'text' || d.id === 'heading') return { fontColor: A.isDark(T.bg) ? T.font : '#1f2933' };
    if (d.style && d.style.fill === 'none') return { stroke: T.palette[0][1], fontColor: A.isDark(T.bg) ? T.font : '#1f2933' };
    return { fill: T.palette[0][0], stroke: T.palette[0][1], fontColor: d.label === 'below' && !A.isDark(T.bg) ? '#1f2933' : T.font };
  };
  A.insertItem = (it, at, alt, connect) => {
    if (it.startsWith('e:')) {
      const st = S.EP[it.slice(2)].style, edges = A.selCells().filter(c => c.kind === 'edge');
      if (edges.length) { A.commit('Connector style', () => edges.forEach(e => { delete e.style.startArrow; delete e.style.dash; Object.assign(e.style, st); })); return; }
      A.edgeStyle = { ...st }; markEdgePreset(); A.setTool('connector'); Aero.toast(`New connectors: ${S.EP[it.slice(2)].name}`); return;
    }
    const sel = A.selCells(), from = connect && sel.length === 1 && sel[0].kind === 'shape' ? sel[0] : null;
    const pos = at || A.viewCenter();
    if (it.startsWith('t:')) {
      const T = S.TPL[it.slice(2)], specs = T.make(0, 0);
      const b = G.bboxPts(specs.flatMap(s => [{ x: s.x, y: s.y }, { x: s.x + s.w, y: s.y + s.h }]));
      const ox = Math.round(pos.x - b.w / 2), oy = Math.round(pos.y - b.h / 2), made = [];
      for (const s of specs) { const c = A.addShape(s.shape, s.x + ox, s.y + oy, { w: s.w, h: s.h, text: s.text, style: { ...A.themeStyle(s.shape), ...(s.style || {}) } }); if (s.parentIdx != null) c.parent = made[s.parentIdx].id; made.push(c); }
      A.commit('Insert ' + T.name.toLowerCase()); A.select(made.filter(c => !c.parent).map(c => c.id)); return;
    }
    const d = S.get(it);
    let x = Math.round(pos.x - d.w / 2), y = Math.round(pos.y - d.h / 2);
    if (from) { x = Math.round(from.x + from.w + 60); y = Math.round(from.y + from.h / 2 - d.h / 2); }
    else if (!at) { // avoid stacking repeated clicks
      const p = page(); let guard = 0; while (guard++ < 30 && p.cells.some(c => c.kind === 'shape' && Math.abs(c.x - x) < 4 && Math.abs(c.y - y) < 4)) { x += 20; y += 20; }
    }
    if (A.snap && !alt) { const g = page().grid || 10; x = Math.round(x / g) * g; y = Math.round(y / g) * g; }
    const c = A.addShape(it, x, y, { style: A.themeStyle(it) });
    if (d.sections) c.h = Math.max(c.h, Math.ceil(Rn.classSections(c, S.styleOf(c)).total));
    A.reparent([c]);
    if (from) A.addEdge({ id: from.id, port: null }, { id: c.id, port: null });
    A.commit('Add ' + d.name.toLowerCase()); A.select(c.id);
  };

  /* ---------- arrange operations ---------- */
  const tops = () => A.selCells().filter(c => c.kind !== 'edge' && !A.lockedCell(c));
  const boxOf = c => M.cellBox(page(), c, A.byId, A.routes);
  function moveBy(c, dx, dy) {
    for (const k of A.withDesc([c])) { if (k.kind === 'shape') { k.x += dx; k.y += dy; } else if (k.kind === 'edge') { k.pts = (k.pts || []).map(q => ({ x: q.x + dx, y: q.y + dy })); if (!k.src.id) k.src = { x: k.src.x + dx, y: k.src.y + dy }; if (!k.tgt.id) k.tgt = { x: k.tgt.x + dx, y: k.tgt.y + dy }; } }
  }
  A.align = how => {
    const cs = tops(); if (cs.length < 2) return Aero.toast('Select two or more shapes to align');
    const bs = cs.map(boxOf), U = bs.reduce((a, b) => G.unionBox(a, b), null);
    A.commit('Align ' + how, () => cs.forEach((c, i) => { const b = bs[i]; const dx = how === 'left' ? U.x - b.x : how === 'right' ? U.x + U.w - b.x - b.w : how === 'center' ? U.x + U.w / 2 - b.x - b.w / 2 : 0; const dy = how === 'top' ? U.y - b.y : how === 'bottom' ? U.y + U.h - b.y - b.h : how === 'middle' ? U.y + U.h / 2 - b.y - b.h / 2 : 0; moveBy(c, dx, dy); }));
  };
  A.distribute = axis => {
    const cs = tops(); if (cs.length < 3) return Aero.toast('Select three or more shapes to distribute');
    const items = cs.map(c => ({ c, b: boxOf(c) })).sort((p, q) => axis === 'h' ? p.b.x - q.b.x : p.b.y - q.b.y);
    const first = items[0].b, last = items[items.length - 1].b;
    const total = items.reduce((s, it) => s + (axis === 'h' ? it.b.w : it.b.h), 0);
    const span = axis === 'h' ? last.x + last.w - first.x : last.y + last.h - first.y, gap = (span - total) / (items.length - 1);
    A.commit('Distribute', () => { let pos = axis === 'h' ? first.x : first.y; for (const it of items) { const d = pos - (axis === 'h' ? it.b.x : it.b.y); moveBy(it.c, axis === 'h' ? d : 0, axis === 'h' ? 0 : d); pos += (axis === 'h' ? it.b.w : it.b.h) + gap; } });
  };
  A.sameSize = what => { const cs = tops().filter(c => c.kind === 'shape'); if (cs.length < 2) return Aero.toast('Select two or more shapes'); const r = cs[0]; A.commit('Same size', () => cs.slice(1).forEach(c => { if (what !== 'h') c.w = r.w; if (what !== 'w') c.h = r.h; })); };
  A.order = how => {
    const sel = A.selCells(); if (!sel.length) return;
    A.commit({ front: 'Bring to front', back: 'Send to back', forward: 'Bring forward', backward: 'Send backward' }[how], p => {
      const ids = new Set(A.withDesc(sel).map(c => c.id));
      const moving = p.cells.filter(c => ids.has(c.id)), rest = p.cells.filter(c => !ids.has(c.id));
      if (how === 'front') p.cells = [...rest, ...moving];
      else if (how === 'back') p.cells = [...moving, ...rest];
      else {
        const idx = p.cells.findIndex(c => ids.has(c.id)), lastIdx = p.cells.map(c => ids.has(c.id)).lastIndexOf(true);
        if (how === 'forward') { const after = p.cells.slice(lastIdx + 1); const nextOverlap = after.findIndex(c => c.kind !== 'group'); if (nextOverlap < 0) return; const ins = rest.indexOf(after[nextOverlap]) + 1; p.cells = [...rest.slice(0, ins), ...moving, ...rest.slice(ins)]; }
        else { const before = p.cells.slice(0, idx).filter(c => c.kind !== 'group'); if (!before.length) return; const ins = rest.indexOf(before[before.length - 1]); p.cells = [...rest.slice(0, ins), ...moving, ...rest.slice(ins)]; }
      }
    });
  };
  A.group = () => {
    const cs = A.selCells().filter(c => !A.lockedCell(c)); if (cs.length < 2) return Aero.toast('Select two or more items to group');
    A.commit('Group', p => {
      const parents = new Set(cs.map(c => c.parent || null)), gp = parents.size === 1 ? [...parents][0] : null;
      const g = { id: M.uid('g'), kind: 'group', layer: cs[0].layer, parent: gp };
      cs.forEach(c => c.parent = g.id);
      p.cells.splice(Math.max(...cs.map(c => p.cells.indexOf(c))) + 1, 0, g);
      A.sel.clear(); A.sel.add(g.id);
    });
  };
  A.ungroup = () => {
    const gs = A.selCells().filter(c => c.kind === 'group'); if (!gs.length) return;
    A.commit('Ungroup', p => { A.sel.clear(); for (const g of gs) { p.cells.forEach(c => { if (c.parent === g.id) { c.parent = g.parent; A.sel.add(c.id); } }); p.cells = p.cells.filter(c => c !== g); } });
  };
  A.rotate90 = () => { const cs = tops().filter(c => c.kind === 'shape'); if (cs.length) A.commit('Rotate 90°', () => cs.forEach(c => c.rot = ((c.rot || 0) + 90) % 360)); };
  A.flip = k => { const cs = tops().filter(c => c.kind === 'shape'); if (cs.length) A.commit(k === 'flipH' ? 'Flip horizontal' : 'Flip vertical', () => cs.forEach(c => c[k] = !c[k])); };
  A.nudge = (dx, dy) => { const cs = A.selCells().filter(c => !A.lockedCell(c) && (c.kind !== 'edge' || (!c.src.id && !c.tgt.id))); if (!cs.length) return; A.commit('Nudge', () => cs.forEach(c => moveBy(c, dx, dy))); };
  A.fitContainer = () => {
    const c = A.selCells().find(c => c.kind === 'shape' && S.get(c.shape).container); if (!c) return Aero.toast('Select a container or swimlane');
    const kids = page().cells.filter(k => k.parent === c.id && k.kind === 'shape'); if (!kids.length) return Aero.toast('The container is empty');
    const b = A.boxOfCells(kids), st = S.styleOf(c), left = S.get(c.shape).container.side === 'left', hd = st.header || 26, m = 20;
    A.commit('Fit container', () => { c.x = b.x - m - (left ? hd : 0); c.y = b.y - m - (left ? 0 : hd); c.w = b.w + 2 * m + (left ? hd : 0); c.h = b.h + 2 * m + (left ? 0 : hd); });
  };
  A.layout = (kind, dir) => {
    const sel = A.selCells().filter(c => c.kind === 'shape');
    const ids = sel.length >= 2 ? new Set(sel.map(c => c.id)) : null;
    const gx = +(($('lgx') || {}).value || (kind === 'tree' ? 24 : 40)), gy = +(($('lgy') || {}).value || 60);
    let n = 0;
    A.commit(kind === 'tree' ? 'Tree layout' : 'Hierarchical layout', p => { n = (kind === 'tree' ? DiaLayout.tree : DiaLayout.layered)(p, { ids, dir, gapX: gx, gapY: gy }); });
    if (!n) Aero.toast('Nothing to lay out: connect shapes with connectors first'); else { A.fit(); Aero.toast(`Arranged ${n} shapes${ids ? ' (selection)' : ''}`); }
  };
  A.reverseEdges = () => { const es = A.selCells().filter(c => c.kind === 'edge'); if (es.length) A.commit('Reverse connector', () => es.forEach(e => { [e.src, e.tgt] = [e.tgt, e.src]; e.pts = (e.pts || []).reverse(); e.labelT = 1 - (e.labelT ?? 0.5); const s = e.style; [s.startArrow, s.endArrow] = [s.endArrow, s.startArrow]; if (s.startArrow === undefined) delete s.startArrow; if (s.endArrow === undefined) s.endArrow = 'none'; })); };
  A.clearWaypoints = () => { const es = A.selCells().filter(c => c.kind === 'edge'); if (es.length) A.commit('Clear waypoints', () => es.forEach(e => e.pts = [])); };
  A.selectKind = kind => { A.select(page().cells.filter(c => (kind === 'all' ? c.kind !== 'group' && !(c.parent && A.byId.get(c.parent) && A.byId.get(c.parent).kind === 'group') : c.kind === kind) && !A.lockedCell(c) && visible(c)).map(c => c.id)); };
  const visible = c => { const L = page().layers.find(l => l.id === c.layer) || page().layers[0]; return L.visible !== false; };
  let styleClip = null;
  A.copyStyle = () => { const c = A.selCells()[0]; if (!c) return; styleClip = { kind: c.kind, style: { ...c.style } }; Aero.toast('Style copied'); };
  A.pasteStyle = () => { if (!styleClip) return Aero.toast('Copy a style first (Ctrl+Shift+C)'); const cs = A.withDesc(A.selCells()).filter(c => c.kind === styleClip.kind); if (cs.length) A.commit('Paste style', () => cs.forEach(c => c.style = { ...styleClip.style })); };
  A.applyTheme = id => { A.commit('Theme: ' + M.THEMES[id].name, p => { M.applyTheme(p, id); A.doc.theme = id; }); };

  /* ---------- pages ---------- */
  A.addPage = () => { A.commit('New page', () => { const n = A.doc.pages.length + 1; let name = 'Page-' + n; while (A.doc.pages.some(p => p.name === name)) name += '+'; const p = M.newPage(name); A.doc.pages.splice(A.pi + 1, 0, p); }); A.setPage(A.pi + 1); };
  A.duplicatePage = () => { const src = page(); A.commit('Duplicate page', () => { const p = M.normalize({ pages: [JSON.parse(JSON.stringify(src))] }).pages[0]; p.id = M.uid('p'); p.name = src.name + ' (copy)'; A.doc.pages.splice(A.pi + 1, 0, p); }); A.setPage(A.pi + 1); };
  A.renamePage = async () => { const v = await Aero.prompt('Rename page', 'Page name', page().name); if (v && v.trim()) A.commit('Rename page', p => p.name = v.trim().slice(0, 120)); };
  A.deletePage = async () => {
    if (A.doc.pages.length < 2) return Aero.toast('A diagram needs at least one page');
    if (page().cells.length && !await Aero.confirm('Delete page', `Delete “${page().name}” and its ${page().cells.length} items?`, 'Delete')) return;
    const i = A.pi; A.commit('Delete page', () => { A.doc.pages.splice(i, 1); A.pi = Math.max(0, i - 1); A.sel.clear(); }); A.resetCache(); A.render(); A.onPanels();
  };
  A.movePage = d => { const i = A.pi, j = i + d; if (j < 0 || j >= A.doc.pages.length) return; A.commit('Move page', () => { const [p] = A.doc.pages.splice(i, 1); A.doc.pages.splice(j, 0, p); A.pi = j; }); };
  function buildTabs() {
    const bar = $('pageTabs'); bar.innerHTML = '';
    A.doc.pages.forEach((p, i) => {
      const t = Aero.el('div', 'ptab' + (i === A.pi ? ' on' : '')); t.textContent = p.name; t.title = p.name + ' — double-click to rename, right-click for options';
      t.onclick = () => A.setPage(i);
      t.ondblclick = () => { A.setPage(i); inlineRename(t); };
      t.oncontextmenu = e => { e.preventDefault(); A.setPage(i); showMenu(e.clientX, e.clientY, [['Rename…', A.renamePage], ['Duplicate', A.duplicatePage], ['Delete', A.deletePage], '-', ['Move left', () => A.movePage(-1)], ['Move right', () => A.movePage(1)], '-', ['Page settings…', pageSettings]]); };
      bar.appendChild(t);
    });
    const add = Aero.el('div', 'ptab add', '+'); add.title = 'Add page'; add.onclick = A.addPage; bar.appendChild(add);
  }
  function inlineRename(t) {
    const inp = Aero.el('input'); inp.value = page().name; t.textContent = ''; t.appendChild(inp); inp.focus(); inp.select();
    const done = ok => { const v = inp.value.trim(); if (ok && v && v !== page().name) A.commit('Rename page', p => p.name = v.slice(0, 120)); else buildTabs(); };
    inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
    inp.onblur = () => done(true);
  }
  function pageSettings() {
    const p = page();
    Aero.dialog({ title: 'Page settings', fields: [{ key: 'name', label: 'Name', type: 'text', value: p.name }, { key: 'bg', label: 'Background', type: 'color', value: p.bg }, { key: 'grid', label: 'Grid size', type: 'number', value: p.grid, min: 2, max: 200 }, { key: 'show', label: 'Show grid', type: 'checkbox', value: p.showGrid !== false }],
      onOK: v => A.commit('Page settings', q => { q.name = (v.name || q.name).slice(0, 120); q.bg = v.bg; q.grid = Aero.clamp(v.grid || 10, 2, 200); q.showGrid = v.show; }) });
  }
  A.pageSettings = pageSettings;

  /* ---------- side panels ---------- */
  let sideTab = 'style';
  document.querySelectorAll('#sideTabs .aero-tab').forEach(t => t.onclick = () => { sideTab = t.dataset.t; document.querySelectorAll('#sideTabs .aero-tab').forEach(x => x.classList.toggle('on', x === t)); buildSide(); });
  A.setSideTab = t => { sideTab = t; document.querySelectorAll('#sideTabs .aero-tab').forEach(x => x.classList.toggle('on', x.dataset.t === t)); buildSide(); };
  const sec = (title, html) => `<div class="psec">${title ? `<h4>${esc(title)}</h4>` : ''}${html}</div>`;
  const row = (label, ctl) => `<div class="prow"><label>${esc(label)}</label><div class="ctl">${ctl}</div></div>`;
  const tbtn = (k, v, label, on, title) => `<button data-k="${k}" data-v="${esc(String(v))}" class="${on ? 'on' : ''}" title="${esc(title || label)}">${label}</button>`;
  const DASH = [['', 'Solid'], ['dash', 'Dashed'], ['dot', 'Dotted'], ['dashdot', 'Dash-dot'], ['longdash', 'Long dash']];
  const opts = (list, v) => list.map(([a, b]) => `<option value="${esc(a)}"${a === v ? ' selected' : ''}>${esc(b)}</option>`).join('');
  const hex = c => /^#[0-9a-f]{6}$/i.test(c || '') ? c : /^#[0-9a-f]{3}$/i.test(c || '') ? '#' + c.slice(1).split('').map(x => x + x).join('') : '#ffffff';
  const AL = { left: '<svg viewBox="0 0 16 16"><path d="M2 3h12M2 6.5h8M2 10h12M2 13.5h7"/></svg>', center: '<svg viewBox="0 0 16 16"><path d="M2 3h12M4 6.5h8M2 10h12M4.5 13.5h7"/></svg>', right: '<svg viewBox="0 0 16 16"><path d="M2 3h12M6 6.5h8M2 10h12M7 13.5h7"/></svg>' };
  const VA = { top: '<svg viewBox="0 0 16 16"><path d="M2 2h12M8 4v10M5 7l3-3 3 3"/></svg>', middle: '<svg viewBox="0 0 16 16"><path d="M2 8h12M8 2v4M8 10v4"/></svg>', bottom: '<svg viewBox="0 0 16 16"><path d="M2 14h12M8 2v10M5 9l3 3 3-3"/></svg>' };
  const ALIGN_ICONS = {
    left: '<svg viewBox="0 0 16 16"><path d="M2 1v14"/><rect x="4" y="3" width="9" height="4"/><rect x="4" y="9" width="6" height="4"/></svg>', center: '<svg viewBox="0 0 16 16"><path d="M8 1v14"/><rect x="3" y="3" width="10" height="4"/><rect x="5" y="9" width="6" height="4"/></svg>', right: '<svg viewBox="0 0 16 16"><path d="M14 1v14"/><rect x="3" y="3" width="9" height="4"/><rect x="6" y="9" width="6" height="4"/></svg>',
    top: '<svg viewBox="0 0 16 16"><path d="M1 2h14"/><rect x="3" y="4" width="4" height="9"/><rect x="9" y="4" width="4" height="6"/></svg>', middle: '<svg viewBox="0 0 16 16"><path d="M1 8h14"/><rect x="3" y="3" width="4" height="10"/><rect x="9" y="5" width="4" height="6"/></svg>', bottom: '<svg viewBox="0 0 16 16"><path d="M1 14h14"/><rect x="3" y="3" width="4" height="9"/><rect x="9" y="6" width="4" height="6"/></svg>',
    dh: '<svg viewBox="0 0 16 16"><rect x="1" y="5" width="3" height="6"/><rect x="6.5" y="5" width="3" height="6"/><rect x="12" y="5" width="3" height="6"/></svg>', dv: '<svg viewBox="0 0 16 16"><rect x="5" y="1" width="6" height="3"/><rect x="5" y="6.5" width="6" height="3"/><rect x="5" y="12" width="6" height="3"/></svg>',
  };

  function targets() { return A.withDesc(A.selCells()).filter(c => c.kind === 'shape' || c.kind === 'edge'); }
  function setStyleLive(kind, key, val) { for (const c of targets()) { if (kind && c.kind !== kind) continue; if (val === undefined) delete c.style[key]; else c.style[key] = val; } A.refresh(); }
  function buildSide() {
    const body = $('sideBody'); if (!body) return;
    const cells = A.selCells(), shapes = targets().filter(c => c.kind === 'shape'), edges = targets().filter(c => c.kind === 'edge');
    let h = '';
    if (sideTab === 'style') {
      if (!cells.length) h = pagePanel();
      else {
        if (shapes.length) h += shapePanel(shapes);
        if (edges.length) h += edgePanel(edges);
        if (!shapes.length && !edges.length) h = sec('', '<div class="pnote">Empty group.</div>');
      }
    } else if (sideTab === 'arrange') h = arrangePanel(cells);
    else h = layersPanel();
    body.innerHTML = h;
    wireSide(body, shapes, edges);
  }
  A.onPanels = () => { buildSide(); buildTabs(); A.onStatus(); $('cGrid').checked = page().showGrid !== false; };
  function pagePanel() {
    const p = page(), T = A.doc.theme;
    return sec('Page', row('Name', `<input type="text" data-p="name" value="${esc(p.name)}">`) + row('Background', `<span class="colorpair"><input type="color" data-p="bg" value="${hex(p.bg)}"></span>`) + row('Grid', `<input type="number" data-p="grid" min="2" max="200" value="${p.grid}"> <label><input type="checkbox" data-p="showGrid"${p.showGrid !== false ? ' checked' : ''}> Show</label>`))
      + sec('Theme', row('Theme', `<select data-p="theme">${opts(Object.entries(M.THEMES).map(([k, t]) => [k, t.name]), T)}</select>`) + `<div class="btnrow"><button class="aero-btn" data-act="applyTheme">Apply to page</button></div><div class="pnote">Recolours every shape on this page: each fill colour in use is mapped to the theme palette in order.</div>`)
      + sec('Diagram', `<div class="pnote">${p.cells.filter(c => c.kind === 'shape').length} shapes, ${p.cells.filter(c => c.kind === 'edge').length} connectors, ${p.layers.length} layer${p.layers.length > 1 ? 's' : ''} on this page · ${A.doc.pages.length} page${A.doc.pages.length > 1 ? 's' : ''}.</div><div class="pnote">Select a shape or connector to style it. Hover a shape to see its connection points; drag from one to connect.</div>`);
  }
  function shapePanel(shapes) {
    const st = S.styleOf(shapes[0]), d = S.get(shapes[0].shape), T = M.THEMES[A.doc.theme] || M.THEMES.lumen;
    const sw = [...T.palette, ['#ffffff', '#333333'], ['none', '#333333']].map(([f, s], i) => `<div class="swatch-b" data-sw="${i}" title="Quick style" style="background:${f === 'none' ? 'repeating-linear-gradient(45deg,#fff 0 3px,#eee 3px 6px)' : f};border-color:${s}"></div>`).join('');
    let h = sec('Quick styles', `<div class="swatches">${sw}</div>`);
    h += sec('Fill & line',
      row('Fill', `<span class="colorpair"><input type="color" data-s="fill" value="${hex(st.fill)}"${st.fill === 'none' ? ' disabled' : ''}><label><input type="checkbox" data-none="fill"${st.fill === 'none' ? ' checked' : ''}> None</label></span>`)
      + row('Gradient', `<span class="colorpair"><input type="checkbox" data-grad${st.fill2 ? ' checked' : ''}><input type="color" data-s="fill2" value="${hex(st.fill2 || '#ffffff')}"${st.fill2 ? '' : ' disabled'}></span>`)
      + row('Line', `<span class="colorpair"><input type="color" data-s="stroke" value="${hex(st.stroke)}"${st.stroke === 'none' ? ' disabled' : ''}><label><input type="checkbox" data-none="stroke"${st.stroke === 'none' ? ' checked' : ''}> None</label></span>`)
      + row('Width', `<input type="number" data-s="sw" min="0" max="40" step="0.5" value="${st.sw}"> <select data-s="dash">${opts(DASH, st.dash || '')}</select>`)
      + row('Opacity', `<input type="range" data-s="op" min="0.05" max="1" step="0.05" value="${st.op ?? 1}">`)
      + row('Options', `${d.id === 'rect' || d.id === 'process' ? `<label><input type="checkbox" data-b="rounded"${st.rounded ? ' checked' : ''}> Rounded</label>` : ''}<label><input type="checkbox" data-b="shadow"${st.shadow ? ' checked' : ''}> Shadow</label>`)
      + (d.container && st.header != null ? row('Header', `<input type="number" data-s="header" min="0" max="200" value="${st.header}"> <input type="color" data-s="bodyFill" value="${hex(st.bodyFill || '#ffffff')}" title="Body fill">`) : '')
      + (st.accent ? row('Accent', `<input type="color" data-s="accent" value="${hex(st.accent)}">`) : ''));
    h += sec('Text',
      row('Font', `<select data-s="font">${opts([['sans', 'Helvetica / Arial'], ['serif', 'Times'], ['mono', 'Courier']], st.font)}</select>`)
      + row('Size', `<input type="number" data-s="fontSize" min="4" max="200" value="${st.fontSize}"> <input type="color" data-s="fontColor" value="${hex(st.fontColor)}" title="Text colour">`)
      + row('Style', `<span class="tb">${tbtn('bold', 1, '<b>B</b>', st.bold, 'Bold (Ctrl+B)')}${tbtn('italic', 1, '<i>I</i>', st.italic, 'Italic (Ctrl+I)')}${tbtn('underline', 1, '<u>U</u>', st.underline, 'Underline (Ctrl+U)')}</span> <label><input type="checkbox" data-b="wrap"${st.wrap !== false ? ' checked' : ''}> Wrap</label>`)
      + row('Align', `<span class="tb">${['left', 'center', 'right'].map(a => tbtn('align', a, AL[a], st.align === a, a)).join('')}</span> <span class="tb">${['top', 'middle', 'bottom'].map(a => tbtn('valign', a, VA[a], st.valign === a, a)).join('')}</span>`)
      + row('Label bg', `<span class="colorpair"><input type="color" data-s="textBg" value="${hex(st.textBg || '#ffffff')}"${st.textBg ? '' : ' disabled'}><label><input type="checkbox" data-tbg${st.textBg ? ' checked' : ''}> On</label></span>`));
    return h;
  }
  function edgePanel(edges) {
    const st = S.styleOf(edges[0]);
    let h = sec('Connector',
      row('Route', `<span class="tb">${[['straight', 'Straight'], ['orthogonal', 'Orthogonal'], ['curved', 'Curved']].map(([v, t]) => tbtn('route', v, t, st.route === v)).join('')}</span>`)
      + row('Corners', `<label><input type="checkbox" data-b="rounded"${st.rounded ? ' checked' : ''}> Rounded</label>`)
      + row('Start', `<select data-s="startArrow">${opts(ARROWS, st.startArrow)}</select>`)
      + row('End', `<select data-s="endArrow">${opts(ARROWS, st.endArrow)}</select>`)
      + row('Arrow size', `<input type="number" data-s="arrowSize" min="4" max="40" value="${st.arrowSize}">`)
      + row('Line', `<input type="color" data-s="stroke" value="${hex(st.stroke)}"> <input type="number" data-s="sw" min="0.5" max="20" step="0.5" value="${st.sw}"> <select data-s="dash">${opts(DASH, st.dash || '')}</select>`)
      + row('Opacity', `<input type="range" data-s="op" min="0.05" max="1" step="0.05" value="${st.op ?? 1}">`)
      + `<div class="btnrow"><button class="aero-btn" data-act="reverse" title="Swap source and target">⇄ Reverse</button><button class="aero-btn" data-act="clearWp">Clear waypoints</button><button class="aero-btn" data-act="asDefault" title="Use this style for new connectors">Set as default</button></div>`);
    h += sec('Label', row('Size', `<input type="number" data-s="fontSize" min="4" max="120" value="${st.fontSize}"> <input type="color" data-s="fontColor" value="${hex(st.fontColor)}" title="Text colour"> <span class="tb">${tbtn('bold', 1, '<b>B</b>', st.bold)}${tbtn('italic', 1, '<i>I</i>', st.italic)}</span>`)
      + row('Background', `<span class="colorpair"><input type="color" data-s="labelBg" value="${hex(st.labelBg)}"${st.labelBg === 'none' ? ' disabled' : ''}><label><input type="checkbox" data-none="labelBg"${st.labelBg === 'none' ? ' checked' : ''}> None</label></span>`)
      + '<div class="pnote">Double-click a connector to edit its label; drag the yellow dot to move it. Drag the round midpoint handles to add waypoints; double-click a waypoint to remove it.</div>');
    return h;
  }
  function arrangePanel(cells) {
    let h = '';
    const one = cells.length === 1 ? cells[0] : null;
    if (one && one.kind === 'shape') h += sec('Position & size', `<div class="g4"><label>X <input type="number" data-g="x" value="${Math.round(one.x * 100) / 100}"></label><label>Y <input type="number" data-g="y" value="${Math.round(one.y * 100) / 100}"></label><label>W <input type="number" data-g="w" min="1" value="${Math.round(one.w * 100) / 100}"></label><label>H <input type="number" data-g="h" min="1" value="${Math.round(one.h * 100) / 100}"></label></div>`
      + row('Angle', `<input type="number" data-g="rot" min="0" max="359" value="${one.rot || 0}">°`) + `<div class="btnrow"><button class="aero-btn" data-act="rot90">⟳ 90°</button><button class="aero-btn" data-act="flipH">⇋ Flip H</button><button class="aero-btn" data-act="flipV">⇵ Flip V</button></div>`);
    if (cells.length) {
      h += sec('Align & distribute', `<div class="btnrow"><span class="tb">${['left', 'center', 'right'].map(a => `<button data-al="${a}" title="Align ${a}">${ALIGN_ICONS[a]}</button>`).join('')}</span><span class="tb">${['top', 'middle', 'bottom'].map(a => `<button data-al="${a}" title="Align ${a}">${ALIGN_ICONS[a]}</button>`).join('')}</span><span class="tb"><button data-act="dh" title="Distribute horizontally">${ALIGN_ICONS.dh}</button><button data-act="dv" title="Distribute vertically">${ALIGN_ICONS.dv}</button></span></div>`
        + `<div class="btnrow" style="margin-top:6px"><button class="aero-btn" data-act="sameW">Same width</button><button class="aero-btn" data-act="sameH">Same height</button></div>`);
      h += sec('Order & grouping', `<div class="btnrow"><button class="aero-btn" data-act="front">To front</button><button class="aero-btn" data-act="forward">Forward</button><button class="aero-btn" data-act="backward">Backward</button><button class="aero-btn" data-act="back">To back</button></div><div class="btnrow" style="margin-top:6px"><button class="aero-btn" data-act="group">Group</button><button class="aero-btn" data-act="ungroup">Ungroup</button><button class="aero-btn" data-act="fitCt" title="Resize the selected container around its contents">Fit container</button></div>`);
    }
    const scope = cells.filter(c => c.kind === 'shape').length >= 2 ? 'the selected shapes' : 'all connected shapes on this page';
    h += sec('Auto-layout', `<div class="pnote">Arranges ${scope} using their connectors.</div><div class="btnrow"><button class="aero-btn" data-lay="tree:TB" title="Org chart / tree, top-down">${ICON_SVG('layout')} Tree ↓</button><button class="aero-btn" data-lay="tree:LR">Tree →</button><button class="aero-btn" data-lay="layered:TB" title="Hierarchical (flowchart), top-down">Hierarchy ↓</button><button class="aero-btn" data-lay="layered:LR">Hierarchy →</button></div>` + row('Spacing', `<input type="number" id="lgx" value="40" min="0" max="400" title="Horizontal gap"> <input type="number" id="lgy" value="60" min="0" max="400" title="Vertical gap">`));
    return h;
  }
  const ICON_SVG = k => `<svg viewBox="0 0 24 24" style="width:14px;height:14px;vertical-align:-2px;fill:none;stroke:currentColor;stroke-width:1.8">${ICON[k]}</svg>`;
  function layersPanel() {
    const p = page(), act = A.layerForNew();
    const rows = [...p.layers].reverse().map(L => `<div class="aero-item layerrow${L.id === act ? ' sel' : ''}" data-layer="${esc(L.id)}"><span class="lv${L.visible === false ? ' off' : ''}" data-lv title="Show / hide">👁</span><span class="lk${L.locked ? '' : ' off'}" data-lk title="Lock / unlock">🔒</span><span class="grow">${esc(L.name)}</span><span class="dim">${p.cells.filter(c => (c.layer || p.layers[0].id) === L.id && c.kind !== 'group').length}</span></div>`).join('');
    return `<div class="aero-list" style="min-height:120px">${rows}</div><div class="aero-iconbar"><button class="aero-iconbtn" data-act="layerAdd" title="New layer">＋</button><button class="aero-iconbtn" data-act="layerDel" title="Delete layer">✕</button><button class="aero-iconbtn" data-act="layerUp" title="Move layer up">▲</button><button class="aero-iconbtn" data-act="layerDown" title="Move layer down">▼</button><button class="aero-iconbtn" data-act="layerMove" title="Move selection to this layer">⇥ Move selection here</button></div><div class="psec"><div class="pnote">The highlighted layer receives new shapes. Hidden layers are not exported; locked layers can’t be selected. Double-click a layer to rename it.</div></div>`;
  }
  function wireSide(body, shapes, edges) {
    const all = targets();
    const kindOf = el => el.closest('.psec') && el.closest('.psec').querySelector('h4') && /connector|label/i.test(el.closest('.psec').querySelector('h4').textContent) ? 'edge' : 'shape';
    body.querySelectorAll('[data-s]').forEach(inp => {
      const k = inp.dataset.s, kind = kindOf(inp);
      const val = () => inp.type === 'number' || inp.type === 'range' ? parseFloat(inp.value) : inp.value;
      inp.addEventListener('input', () => { if (inp.type === 'color' || inp.type === 'range') setStyleLive(kind, k, val()); });
      inp.addEventListener('change', () => { const v = val(); if (typeof v === 'number' && !isFinite(v)) return; A.commit('Style', () => { for (const c of targets()) if (c.kind === kind) c.style[k] = v; }); });
    });
    body.querySelectorAll('[data-none]').forEach(cb => cb.onchange = () => { const k = cb.dataset.none, kind = kindOf(cb); A.commit('Style', () => { for (const c of targets()) if (c.kind === kind) c.style[k] = cb.checked ? 'none' : (k === 'fill' ? '#ffffff' : k === 'labelBg' ? page().bg || '#ffffff' : '#333333'); }); });
    const grad = body.querySelector('[data-grad]'); if (grad) grad.onchange = () => A.commit('Gradient', () => { for (const c of targets()) if (c.kind === 'shape') c.style.fill2 = grad.checked ? '#ffffff' : ''; });
    const tbg = body.querySelector('[data-tbg]'); if (tbg) tbg.onchange = () => A.commit('Label background', () => { for (const c of targets()) if (c.kind === 'shape') c.style.textBg = tbg.checked ? '#ffffff' : ''; });
    body.querySelectorAll('[data-b]').forEach(cb => cb.onchange = () => { const k = cb.dataset.b, kind = kindOf(cb); A.commit('Style', () => { for (const c of targets()) if (c.kind === kind) c.style[k] = cb.checked; }); });
    body.querySelectorAll('.tb [data-k]').forEach(b => b.onclick = () => {
      const k = b.dataset.k, kind = kindOf(b); let v = b.dataset.v;
      if (k === 'bold' || k === 'italic' || k === 'underline') { const cur = S.styleOf(targets().find(c => c.kind === kind) || {}); A.commit('Style', () => { for (const c of targets()) if (c.kind === kind) c.style[k] = !cur[k]; }); return; }
      A.commit('Style', () => { for (const c of targets()) if (c.kind === kind) { c.style[k] = v; if (k === 'route') c.pts = c.pts || []; } });
    });
    body.querySelectorAll('[data-sw]').forEach(b => b.onclick = () => {
      const T = M.THEMES[A.doc.theme] || M.THEMES.lumen, list = [...T.palette, ['#ffffff', '#333333'], ['none', '#333333']], [f, s] = list[+b.dataset.sw];
      const dark = A.isDark(f === 'none' ? page().bg : f);
      A.commit('Quick style', () => { for (const c of targets()) if (c.kind === 'shape') { c.style.fill = f; c.style.stroke = s; c.style.fill2 = ''; if (S.get(c.shape).label !== 'below') c.style.fontColor = dark ? '#ffffff' : '#1f2933'; if (c.style.accent) c.style.accent = s; } });
    });
    body.querySelectorAll('[data-g]').forEach(inp => inp.onchange = () => { const one = A.selCells()[0], v = parseFloat(inp.value); if (!one || !isFinite(v)) return; A.commit('Geometry', () => { if (inp.dataset.g === 'rot') one.rot = ((v % 360) + 360) % 360; else if (inp.dataset.g === 'w' || inp.dataset.g === 'h') one[inp.dataset.g] = Math.max(1, v); else one[inp.dataset.g] = v; }); });
    body.querySelectorAll('[data-al]').forEach(b => b.onclick = () => A.align(b.dataset.al));
    body.querySelectorAll('[data-lay]').forEach(b => b.onclick = () => { const [k, d] = b.dataset.lay.split(':'); A.layout(k, d); });
    body.querySelectorAll('[data-p]').forEach(inp => inp.onchange = () => {
      const k = inp.dataset.p;
      if (k === 'theme') { A.doc.theme = inp.value; return; }
      A.commit('Page', p => { if (k === 'name') p.name = inp.value.slice(0, 120) || p.name; else if (k === 'bg') p.bg = inp.value; else if (k === 'grid') p.grid = Aero.clamp(+inp.value || 10, 2, 200); else if (k === 'showGrid') p.showGrid = inp.checked; });
    });
    const acts = {
      applyTheme: () => A.applyTheme(body.querySelector('[data-p=theme]').value), reverse: A.reverseEdges, clearWp: A.clearWaypoints,
      asDefault: () => { const e = A.selCells().find(c => c.kind === 'edge'); if (e) { A.edgeStyle = { ...e.style }; markEdgePreset(); Aero.toast('New connectors will use this style'); } },
      rot90: A.rotate90, flipH: () => A.flip('flipH'), flipV: () => A.flip('flipV'), dh: () => A.distribute('h'), dv: () => A.distribute('v'), sameW: () => A.sameSize('w'), sameH: () => A.sameSize('h'),
      front: () => A.order('front'), back: () => A.order('back'), forward: () => A.order('forward'), backward: () => A.order('backward'), group: A.group, ungroup: A.ungroup, fitCt: A.fitContainer,
      layerAdd: () => { let L; A.commit('New layer', p => { L = { id: M.uid('L'), name: 'Layer ' + (p.layers.length + 1), visible: true, locked: false }; p.layers.push(L); }); A.activeLayer = L.id; buildSide(); },
      layerDel: async () => { const p = page(), L = p.layers.find(l => l.id === A.layerForNew()); if (p.layers.length < 2) return Aero.toast('A page needs at least one layer'); const n = p.cells.filter(c => c.layer === L.id).length; if (n && !await Aero.confirm('Delete layer', `Delete “${L.name}” and the ${n} items on it?`, 'Delete')) return; A.commit('Delete layer', q => { q.cells = q.cells.filter(c => c.layer !== L.id); q.layers = q.layers.filter(l => l !== L); A.sel.clear(); }); A.activeLayer = null; buildSide(); },
      layerUp: () => moveLayer(1), layerDown: () => moveLayer(-1),
      layerMove: () => { const L = A.layerForNew(), cs = A.withDesc(A.selCells()); if (!cs.length) return Aero.toast('Select something to move'); A.commit('Move to layer', () => cs.forEach(c => c.layer = L)); },
    };
    body.querySelectorAll('[data-act]').forEach(b => b.onclick = () => acts[b.dataset.act] && acts[b.dataset.act]());
    body.querySelectorAll('[data-layer]').forEach(r => {
      const id = r.dataset.layer, L = page().layers.find(l => l.id === id);
      r.onclick = e => { if (e.target.dataset.lv !== undefined) A.commit(L.visible === false ? 'Show layer' : 'Hide layer', () => { L.visible = L.visible === false; A.sel.clear(); }); else if (e.target.dataset.lk !== undefined) A.commit(L.locked ? 'Unlock layer' : 'Lock layer', () => { L.locked = !L.locked; A.sel.clear(); }); else { A.activeLayer = id; buildSide(); } };
      r.ondblclick = async () => { const v = await Aero.prompt('Rename layer', 'Layer name', L.name); if (v && v.trim()) A.commit('Rename layer', () => L.name = v.trim().slice(0, 80)); };
    });
  }
  function moveLayer(d) { const p = page(), id = A.layerForNew(), i = p.layers.findIndex(l => l.id === id), j = i + d; if (j < 0 || j >= p.layers.length) return; A.commit('Reorder layers', q => { const [L] = q.layers.splice(i, 1); q.layers.splice(j, 0, L); }); A.activeLayer = id; buildSide(); }

  /* ---------- context menu ---------- */
  const ctx = $('ctx');
  function showMenu(cx, cy, items) {
    ctx.innerHTML = '';
    for (const it of items) {
      if (it === '-') { ctx.appendChild(Aero.el('div', 'aero-msep')); continue; }
      const [label, fn, key, dis] = it;
      const mi = Aero.el('div', 'aero-mi' + (dis ? ' disabled' : ''), `<span>${esc(label)}</span><span class="k">${esc(key || '')}</span>`);
      mi.onclick = e => { e.stopPropagation(); A.hideContext(); fn(); }; ctx.appendChild(mi);
    }
    const r = A.stage.getBoundingClientRect(); ctx.hidden = false;
    const w = ctx.offsetWidth, h = ctx.offsetHeight;
    ctx.style.left = Math.min(cx - r.left, r.width - w - 4) + 'px'; ctx.style.top = Math.min(cy - r.top, r.height - h - 4) + 'px';
  }
  A.hideContext = () => { ctx.hidden = true; };
  document.addEventListener('pointerdown', e => { if (!ctx.hidden && !ctx.contains(e.target)) A.hideContext(); }, true);
  A.contextMenu = e => {
    const cells = A.selCells(), w = A.toWorld(e.clientX, e.clientY);
    const hasEdge = cells.some(c => c.kind === 'edge');
    if (cells.length) showMenu(e.clientX, e.clientY, [['Edit text', () => A.editText(), 'F2', cells.length !== 1], '-', ['Cut', () => A.copy(true), 'Ctrl+X'], ['Copy', () => A.copy(false), 'Ctrl+C'], ['Paste', () => A.paste(), 'Ctrl+V'], ['Duplicate', A.duplicate, 'Ctrl+D'], ['Delete', A.deleteSel, 'Del'], '-',
      ['Bring to front', () => A.order('front'), 'Ctrl+Shift+F'], ['Send to back', () => A.order('back'), 'Ctrl+Shift+B'], '-', ['Group', A.group, 'Ctrl+G', cells.length < 2], ['Ungroup', A.ungroup, 'Ctrl+Shift+G', !cells.some(c => c.kind === 'group')],
      ...(hasEdge ? ['-', ['Reverse connector', A.reverseEdges], ['Clear waypoints', A.clearWaypoints]] : []), '-', ['Copy style', A.copyStyle, 'Ctrl+Shift+C'], ['Paste style', A.pasteStyle, 'Ctrl+Shift+V']]);
    else showMenu(e.clientX, e.clientY, [['Paste here', () => A.paste(null, w), '', !A.clip && !hasClip()], ['Select all', () => A.selectKind('all'), 'Ctrl+A'], '-', ['Add text here', () => { const c = A.addShape('text', Math.round(w.x - 60), Math.round(w.y - 15), { text: '' }); A.commit('Add text'); A.select(c.id); A.render(); A.editText(c, ''); }], ['Fit diagram', () => A.fit(), 'Ctrl+0'], '-', ['Page settings…', pageSettings]]);
  };
  const hasClip = () => { try { return !!localStorage.getItem('lumen-diagram-clip'); } catch (e) { return false; } };

  /* ---------- files ---------- */
  const extOf = n => (/\.drawio\.svg$/i.test(n) ? 'drawio.svg' : (n.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase());
  const docName = () => Aero.baseName(A.fileName || 'Untitled');
  function readDoc(f) {
    const ext = extOf(f.name), text = new TextDecoder().decode(new Uint8Array(f.data));
    if (ext === 'ldia' || ext === 'json' || /^\s*\{/.test(text)) return { doc: M.normalize(JSON.parse(text)), kind: 'ldia' };
    if (/^\s*</.test(text)) {
      // our own SVG export carries the diagram in <metadata id="lumen-diagram">
      if (/<svg/i.test(text.slice(0, 2000)) && /id="lumen-diagram"/.test(text)) { const md = X.findAll(X.parse(text), 'metadata').find(m => m.attrs.id === 'lumen-diagram'); if (md) return { doc: M.normalize(JSON.parse(md.text)), kind: 'svg' }; }
      const r = DiaDrawio.importDrawio(text, { name: Aero.baseName(f.name) });
      return { doc: r.doc, kind: 'drawio', report: r.report };
    }
    throw new Error('Unrecognised file format');
  }
  async function openFiles(files) {
    const imgs = files.filter(f => /\.(png|jpe?g|gif|webp)$/i.test(f.name) || /\.svg$/i.test(f.name) && !/lumen-diagram|mxfile/.test(new TextDecoder().decode(new Uint8Array(f.data).slice(0, 200000))));
    if (imgs.length && imgs.length === files.length) { for (const f of imgs) await insertImage(f); return; }
    const f = files.find(x => !imgs.includes(x)); if (!f) return;
    if (Aero.dirty && !await Aero.confirm('Open', 'Discard unsaved changes to the current diagram?', 'Discard')) return;
    try {
      Aero.busy('Opening ' + f.name + '…');
      const r = readDoc(f);
      const nm = r.kind === 'ldia' ? f.name : Aero.baseName(f.name.replace(/\.drawio\.svg$/i, '')) + '.ldia';
      A.load(r.doc, nm, r.kind === 'ldia' ? f.path : null);
      if (r.report) Aero.toast(`Imported ${r.report.pages} page${r.report.pages > 1 ? 's' : ''}, ${r.report.cells} items${r.report.approximated ? ` (${r.report.approximated} drawn as approximations)` : ''}`);
    } catch (e) { Aero.alert('Could not open file', `${f.name}: ${e.message}`); } finally { Aero.busy(); }
  }
  async function importAsPages() {
    const fs = await Aero.openFile({ accept: '.drawio,.xml,.ldia,.svg', filters: [{ name: 'Diagrams', extensions: ['drawio', 'xml', 'ldia', 'svg'] }] });
    if (!fs.length) return;
    try {
      const r = readDoc(fs[0]); const at = A.pi + 1;
      A.commit('Import pages', () => { for (const p of r.doc.pages) { p.id = M.uid('p'); } A.doc.pages.splice(at, 0, ...r.doc.pages); });
      A.setPage(at); Aero.toast(`Added ${r.doc.pages.length} page${r.doc.pages.length > 1 ? 's' : ''} from ${fs[0].name}`);
    } catch (e) { Aero.alert('Import failed', e.message); }
  }
  async function insertImage(f) {
    if (!f) { const fs = await Aero.openFile({ accept: 'image/*', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] }] }); f = fs[0]; if (!f) return; }
    const ext = extOf(f.name), mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/' + ext;
    const u8 = new Uint8Array(f.data); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    const url = `data:${mime};base64,${btoa(s)}`;
    const img = new Image(); img.src = url; try { await img.decode(); } catch (e) { return Aero.alert('Image', 'This image could not be read.'); }
    let w = img.naturalWidth || 200, h = img.naturalHeight || 150; const k = Math.min(1, 400 / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
    const c0 = A.viewCenter(); const c = A.addShape('image', Math.round(c0.x - w / 2), Math.round(c0.y - h / 2), { w, h, image: url, text: '' });
    A.commit('Insert image'); A.select(c.id);
  }
  A.insertImage = insertImage;
  async function save(as) {
    let name = docName() + '.ldia';
    const p = await Aero.saveFile({ name, data: M.serialize(A.doc), filters: [{ name: 'Lumen Diagram', extensions: ['ldia'] }], path: as ? null : A.filePath });
    if (!p) return false;
    if (/[\\/]/.test(p)) A.filePath = p;
    A.fileName = String(p).replace(/^.*[\\/]/, ''); Aero.setDoc(A.fileName, false);
    try { localStorage.removeItem(AUTOSAVE); } catch (e) { }
    Aero.toast('Saved ' + A.fileName); return true;
  }
  A.save = save;
  async function newDoc() {
    if (Aero.dirty && !await Aero.confirm('New diagram', 'Discard unsaved changes to the current diagram?', 'Discard')) return;
    A.load(M.newDoc(), 'Untitled'); try { localStorage.removeItem(AUTOSAVE); } catch (e) { }
  }
  async function openSample() {
    if (Aero.dirty && !await Aero.confirm('Open sample', 'Discard unsaved changes to the current diagram?', 'Discard')) return;
    A.load(DiaSample.sampleDoc(), 'Sample diagrams.ldia');
  }
  let asT = null;
  A.autosave = () => { clearTimeout(asT); asT = setTimeout(() => { try { localStorage.setItem(AUTOSAVE, JSON.stringify({ name: A.fileName, doc: A.doc })); } catch (e) { } }, 800); };

  /* ---------- export ---------- */
  const selFilter = () => { const ids = new Set(A.withDesc(A.selCells()).map(c => c.id)); return ids.size ? c => ids.has(c.id) : null; };
  A.exportSVGString = (o = {}) => {
    const p = page(), filter = o.selection ? selFilter() : null;
    const meta = o.embed ? JSON.stringify({ format: 'lumen-diagram', version: 1, theme: A.doc.theme, pages: [p] }) : null;
    return Rn.pageSVG(p, { routes: A.routes, transparent: o.transparent, filter, metadata: meta, title: p.name, padding: o.padding ?? 20 });
  };
  async function svgToPNG(svgStr, w, h, scale) {
    const url = URL.createObjectURL(new Blob([svgStr], { type: 'image/svg+xml' }));
    try {
      const img = new Image(); img.src = url; await img.decode();
      const k = Math.min(scale, 16000 / w, 16000 / h, Math.sqrt(120e6 / (w * h)));
      const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
      const g = cv.getContext('2d'); g.drawImage(img, 0, 0, cv.width, cv.height);
      return await new Promise(res => cv.toBlob(res, 'image/png'));
    } finally { URL.revokeObjectURL(url); }
  }
  A.exportPNGBlob = async (o = {}) => { const r = A.exportSVGString(o); return svgToPNG(r.svg, r.box.w, r.box.h, o.scale || 2); };
  A.exportPDFBytes = async (o = {}) => {
    const pages = o.all ? A.doc.pages : [page()];
    return DiaPDF.exportPDF(pages, { size: o.size, title: docName(), transparent: false, routesFor: p => p === page() ? A.routes : R.routePage(p), filterFor: p => (o.selection && p === page() ? selFilter() : null), rasterize: async href => { const img = new Image(); img.src = href; await img.decode(); const cv = document.createElement('canvas'); cv.width = img.naturalWidth || 300; cv.height = img.naturalHeight || 200; cv.getContext('2d').drawImage(img, 0, 0); const b = await new Promise(r => cv.toBlob(r, 'image/png')); return new Uint8Array(await b.arrayBuffer()); } });
  };
  function exportDialog(kind) {
    const hasSel = A.selCells().length > 0;
    const f = [];
    if (kind !== 'drawio') f.push({ key: 'sel', label: 'Selection only', type: 'checkbox', value: false });
    if (kind === 'png') f.push({ key: 'scale', label: 'Scale', type: 'select', value: '2', options: [['1', '1× (screen)'], ['2', '2× (sharp)'], ['3', '3×'], ['4', '4× (print)']] });
    if (kind === 'png' || kind === 'svg') f.push({ key: 'transparent', label: 'Transparent background', type: 'checkbox', value: false });
    if (kind === 'svg') f.push({ key: 'embed', label: 'Embed diagram (re-open in Lumen Diagram)', type: 'checkbox', value: true });
    if (kind === 'pdf') f.push({ key: 'all', label: 'Pages', type: 'select', value: 'all', options: [['all', `All pages (${A.doc.pages.length})`], ['cur', 'Current page']] }, { key: 'size', label: 'Paper', type: 'select', value: 'fit', options: [['fit', 'Fit to diagram'], ['a4', 'A4'], ['letter', 'US Letter'], ['a3', 'A3']] });
    if (kind === 'drawio') f.push({ key: 'compressed', label: 'Compress pages', type: 'checkbox', value: false });
    const title = { svg: 'Export SVG', png: 'Export PNG', pdf: 'Export PDF', drawio: 'Export draw.io' }[kind];
    Aero.dialog({ title, instruction: kind === 'drawio' ? 'Saves every page as a diagrams.net / draw.io file.' : kind === 'pdf' ? 'Vector PDF with selectable text.' : `Exports the page “${page().name}”.`, fields: f, ok: 'Export',
      onOK: async v => {
        try {
          Aero.busy('Exporting…');
          const sel = v.sel && hasSel, base = (docName() + (kind !== 'pdf' && kind !== 'drawio' && A.doc.pages.length > 1 ? ' - ' + page().name : '')).replace(/[\\/:*?"<>|]+/g, '-');
          if (kind === 'svg') { const r = A.exportSVGString({ selection: sel, transparent: v.transparent, embed: v.embed }); await Aero.saveFile({ name: base + '.svg', data: r.svg, filters: [{ name: 'SVG', extensions: ['svg'] }] }); }
          else if (kind === 'png') { const b = await A.exportPNGBlob({ selection: sel, transparent: v.transparent, scale: +v.scale }); await Aero.saveFile({ name: base + '.png', data: b, filters: [{ name: 'PNG image', extensions: ['png'] }] }); }
          else if (kind === 'pdf') { const b = await A.exportPDFBytes({ all: v.all === 'all', size: v.size === 'fit' ? null : v.size, selection: sel }); await Aero.saveFile({ name: base + '.pdf', data: b, filters: [{ name: 'PDF', extensions: ['pdf'] }] }); }
          else { const x = DiaDrawio.exportDrawio(A.doc, { compressed: v.compressed }); await Aero.saveFile({ name: base + '.drawio', data: x, filters: [{ name: 'draw.io diagram', extensions: ['drawio'] }] }); }
        } catch (e) { Aero.alert('Export failed', e.message); } finally { Aero.busy(); }
      } });
  }
  A.exportDialog = exportDialog;

  /* ---------- help ---------- */
  function shortcutsDialog() {
    const rows = [['V / C / T / H', 'Select · Connector · Text · Pan tools'], ['R / E / D', 'Draw rectangle · ellipse · diamond'], ['Space + drag, middle drag', 'Pan'], ['Wheel · Shift+wheel', 'Scroll vertically · horizontally'], ['Ctrl + wheel', 'Zoom at the pointer'], ['Ctrl+= / Ctrl+- / Ctrl+0 / Ctrl+1', 'Zoom in · out · fit · 100%'],
      ['Type on a selected shape, F2, double-click', 'Edit text (Ctrl+Enter finishes, Esc cancels)'], ['Arrows · Shift+arrows', 'Nudge 1 px · one grid step'], ['Shift+drag · Alt+drag · Ctrl+drag', 'Constrain · no snapping · copy'], ['Ctrl+C / X / V / D', 'Copy · cut · paste · duplicate'], ['Delete / Backspace', 'Delete'], ['Ctrl+Z / Ctrl+Y', 'Undo · redo'],
      ['Ctrl+G / Ctrl+Shift+G', 'Group · ungroup'], ['Ctrl+Shift+F / B, Ctrl+] / [', 'Front · back · forward · backward'], ['Ctrl+R · Ctrl+B/I/U', 'Rotate 90° · bold/italic/underline'], ['Ctrl+Shift+C / V', 'Copy / paste style'], ['Ctrl+PageDown / PageUp', 'Next / previous page'], ['Alt+click', 'Select a shape inside a group']];
    Aero.dialog({ title: 'Keyboard shortcuts', noCancel: true, width: 560, html: `<table class="mini" style="border-collapse:collapse;width:100%">${rows.map(([k, v]) => `<tr><td style="padding:3px 10px 3px 0;white-space:nowrap;color:#1e395b;font-weight:600">${esc(k)}</td><td style="padding:3px 0">${esc(v)}</td></tr>`).join('')}</table>` });
  }
  function about() { Aero.dialog({ title: 'About Lumen Diagram', noCancel: true, instruction: 'Lumen Diagram 1.0', html: '<div class="dnote">A free diagram editor for flowcharts, org charts, UML, BPMN, network diagrams and floor plans — part of Lumen Studio.<br><br>Opens and saves draw.io / diagrams.net files. Exports SVG, PNG and vector PDF.<br><br>Uses pdf-lib (MIT) and fflate (MIT). Everything runs locally; nothing is uploaded.</div>' }); }

  /* ---------- menus ---------- */
  const one = () => A.selCells().length === 1;
  const textStyleToggle = k => () => { const cs = targets(); if (!cs.length) return; const cur = S.styleOf(cs[0])[k]; A.commit('Style', () => cs.forEach(c => c.style[k] = !cur)); };
  Aero.init({
    name: 'Lumen Diagram', icon: '../kit/icons/diagram.png', doc: 'Untitled', onDropFiles: openFiles, dropTarget: A.stage, dropText: 'Drop a .ldia or .drawio diagram, or images to insert', onSave: () => save(false),
    menus: {
      File: [['New', 'Ctrl+N', newDoc], ['Open…', 'Ctrl+O', async () => { const fs = await Aero.openFile({ accept: '.ldia,.drawio,.xml,.svg,.json', filters: [{ name: 'Diagrams', extensions: ['ldia', 'drawio', 'xml', 'svg'] }] }); if (fs.length) openFiles(fs); }], ['Open Sample', '', openSample], '-',
        ['Save', 'Ctrl+S', () => save(false)], ['Save As…', 'Ctrl+Shift+S', () => save(true)], '-', '#Import', ['draw.io file as new pages…', '', importAsPages], ['Image…', '', () => insertImage()], '#Export',
        ['SVG image…', '', () => exportDialog('svg')], ['PNG image…', '', () => exportDialog('png')], ['PDF document…', 'Ctrl+P', () => exportDialog('pdf')], ['draw.io / diagrams.net…', '', () => exportDialog('drawio')]],
      Edit: [['Undo', 'Ctrl+Z', A.undo], ['Redo', 'Ctrl+Y/Ctrl+Shift+Z', A.redo], '-', ['Cut', 'Ctrl+X', () => A.copy(true)], ['Copy', 'Ctrl+C', () => A.copy(false)], ['Paste', 'Ctrl+V', () => A.paste()], ['Duplicate', 'Ctrl+D', A.duplicate], ['Delete', 'Delete', A.deleteSel], '-',
        ['Select all', 'Ctrl+A', () => A.selectKind('all')], ['Select shapes', 'Ctrl+Shift+A', () => A.selectKind('shape')], ['Select connectors', 'Ctrl+Shift+E', () => A.selectKind('edge')], ['Select none', 'Escape', () => { if (A.tool !== 'select') A.setTool('select'); A.entered = null; A.hideContext(); A.select([]); }], '-',
        { label: 'Edit text', key: 'F2', fn: () => A.editText(), disabled: () => !one() }, ['Copy style', 'Ctrl+Shift+C', A.copyStyle], ['Paste style', 'Ctrl+Shift+V', A.pasteStyle]],
      View: [['Zoom in', 'Ctrl+=', () => A.zoomBy(1.25)], ['Zoom out', 'Ctrl+-', () => A.zoomBy(0.8)], ['Fit diagram', 'Ctrl+0', () => A.fit()], ['Actual size (100%)', 'Ctrl+1', () => A.zoomAt(1)], { label: 'Zoom to selection', key: 'Ctrl+2', fn: () => A.fit(A.selCells()), disabled: () => !A.selCells().length }, '-',
        { label: 'Grid', checked: () => page().showGrid !== false, fn: () => A.commit('Toggle grid', p => p.showGrid = p.showGrid === false) }, { label: 'Snap to grid & shapes', checked: () => A.snap, fn: () => { A.snap = !A.snap; $('cSnap').checked = A.snap; } }, '-',
        { label: 'Shape library', checked: () => !$('libPane').hidden, fn: () => togglePane('libPane') }, { label: 'Format panel', checked: () => !$('sidePane').hidden, fn: () => togglePane('sidePane') }],
      Insert: [['Text', 'T', () => A.setTool('text')], ['Image…', '', () => insertImage()], ['Connector', 'C', () => A.setTool('connector')], '-', ['Rectangle', 'R', () => A.setTool('draw:rect')], ['Ellipse', 'E', () => A.setTool('draw:ellipse')], ['Diamond', 'D', () => A.setTool('draw:diamond')], '-',
        ['Swimlanes (3 vertical)', '', () => A.insertItem('t:lanes3')], ['BPMN pool with 2 lanes', '', () => A.insertItem('t:pool2')], ['UML class', '', () => A.insertItem('umlClass')], ['Org chart card', '', () => A.insertItem('orgCard')], '-', ['New page', '', A.addPage]],
      Arrange: [['Bring to front', 'Ctrl+Shift+F', () => A.order('front')], ['Bring forward', 'Ctrl+]', () => A.order('forward')], ['Send backward', 'Ctrl+[', () => A.order('backward')], ['Send to back', 'Ctrl+Shift+B', () => A.order('back')], '-',
        ['Group', 'Ctrl+G', A.group], ['Ungroup', 'Ctrl+Shift+G', A.ungroup], ['Fit container to contents', '', A.fitContainer], '-', '#Align',
        ['Align left', '', () => A.align('left')], ['Align center', '', () => A.align('center')], ['Align right', '', () => A.align('right')], ['Align top', '', () => A.align('top')], ['Align middle', '', () => A.align('middle')], ['Align bottom', '', () => A.align('bottom')],
        ['Distribute horizontally', '', () => A.distribute('h')], ['Distribute vertically', '', () => A.distribute('v')], '-', ['Rotate 90°', 'Ctrl+R', A.rotate90], ['Flip horizontal', '', () => A.flip('flipH')], ['Flip vertical', '', () => A.flip('flipV')], '-', '#Auto-layout',
        ['Tree / org chart (top-down)', '', () => A.layout('tree', 'TB')], ['Tree (left-right)', '', () => A.layout('tree', 'LR')], ['Hierarchical (top-down)', '', () => A.layout('layered', 'TB')], ['Hierarchical (left-right)', '', () => A.layout('layered', 'LR')], '-',
        ['Reverse connector', '', A.reverseEdges], ['Clear waypoints', '', A.clearWaypoints]],
      Format: [['Bold', 'Ctrl+B', textStyleToggle('bold')], ['Italic', 'Ctrl+I', textStyleToggle('italic')], ['Underline', 'Ctrl+U', textStyleToggle('underline')], '-', '#Theme (applies to the page)', ...Object.entries(M.THEMES).map(([k, t]) => ({ label: t.name, checked: () => A.doc.theme === k, fn: () => A.applyTheme(k) })), '-', ['Page settings…', '', pageSettings]],
      Page: [['New page', '', A.addPage], ['Duplicate page', '', A.duplicatePage], ['Rename page…', '', A.renamePage], ['Delete page', '', A.deletePage], '-', ['Move page left', '', () => A.movePage(-1)], ['Move page right', '', () => A.movePage(1)], '-',
        ['Next page', 'Ctrl+PageDown', () => A.setPage(A.pi + 1)], ['Previous page', 'Ctrl+PageUp', () => A.setPage(A.pi - 1)], '-', ['Page settings…', '', pageSettings]],
      Help: [['Keyboard shortcuts', 'F1', shortcutsDialog], ['About Lumen Diagram', '', about]],
    },
  });
  function togglePane(id) { const p = $(id); p.hidden = !p.hidden; const work = document.querySelector('.dia-work'); work.style.gridTemplateColumns = `${$('libPane').hidden ? '' : '218px '}1fr${$('sidePane').hidden ? '' : ' 272px'}`; A.render(); }
  Aero.shortcut('Backspace', A.deleteSel);
  for (const [k, dx, dy] of [['ArrowLeft', -1, 0], ['ArrowRight', 1, 0], ['ArrowUp', 0, -1], ['ArrowDown', 0, 1]]) { Aero.shortcut(k, () => A.nudge(dx, dy)); Aero.shortcut('Shift+' + k, () => A.nudge(dx * (page().grid || 10), dy * (page().grid || 10))); }

  // keys: typing on a selection edits its text; otherwise single letters pick tools
  const TOOLKEYS = { v: 'select', c: 'connector', t: 'text', h: 'hand', r: 'draw:rect', e: 'draw:ellipse', d: 'draw:diamond' };
  addEventListener('keydown', e => {
    if (document.querySelector('.aero-modal') || A.isEditing()) return;
    if (e.target.matches && e.target.matches('input,textarea,select,[contenteditable=true]')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter' && one()) { e.preventDefault(); e.stopImmediatePropagation(); A.editText(); return; }
    if (e.key.length !== 1 || e.key === ' ') return;
    const sel = A.selCells();
    if (sel.length === 1 && (sel[0].kind === 'shape' || sel[0].kind === 'edge') && !A.lockedCell(sel[0])) { e.preventDefault(); e.stopImmediatePropagation(); A.editText(sel[0], e.key); return; }
    const t = TOOLKEYS[e.key.toLowerCase()]; if (t) { e.preventDefault(); e.stopImmediatePropagation(); A.setTool(t); }
  }, true);

  /* ---------- start ---------- */
  A.setTool('select');
  buildLibrary();
  let start = null;
  try { const j = JSON.parse(localStorage.getItem(AUTOSAVE) || 'null'); if (j && j.doc && j.doc.pages) start = j; } catch (e) { }
  if (start) { try { A.load(M.normalize(start.doc), start.name || 'Untitled'); Aero.setDirty(true); } catch (e) { start = null; } }
  if (!start) A.load(DiaSample.sampleDoc(), 'Sample diagrams.ldia');
  window.DiaUI = { buildSide, buildLibrary, openFiles, readDoc, save, exportDialog, svgToPNG, showMenu };
})();
