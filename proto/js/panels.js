'use strict';
/* Lumen Proto — side panels: layers tree, assets, design / prototype / inspect inspector. */
(function () {
  const LP = window.LP, ED = window.ED, A = window.ACT;
  const P = window.PANELS = {};
  const esc = Aero.esc;
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k]; if (v == null || v === false) continue;
      if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v; else if (k === 'text') e.textContent = v; else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach(c => c != null && c !== false && e.append(c instanceof Node ? c : document.createTextNode(String(c))));
    return e;
  }
  P.h = h;
  const svg = (inner, vb = '0 0 16 16') => `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const ICON = {
    frame: svg('<path d="M4 1.5v13M12 1.5v13M1.5 4h13M1.5 12h13"/>'), group: svg('<rect x="2" y="2" width="12" height="12" rx="1.5" stroke-dasharray="2 2"/>'),
    rect: svg('<rect x="2.5" y="3.5" width="11" height="9" rx="1"/>'), ellipse: svg('<circle cx="8" cy="8" r="5.5"/>'), path: svg('<path d="M2.5 12.5C5 3 11 13 13.5 3.5"/>'),
    text: svg('<path d="M3 3.5h10M8 3.5v10"/>'), icon: svg('<path d="M8 2.5l1.7 3.5 3.8.5-2.8 2.7.7 3.8L8 11.2 4.6 13l.7-3.8L2.5 6.5l3.8-.5z"/>'),
    instance: svg('<path d="M8 1.8 14.2 8 8 14.2 1.8 8z"/>'), component: svg('<path d="M8 1.5 10.5 4 8 6.5 5.5 4zM8 9.5l2.5 2.5L8 14.5 5.5 12zM4 5.5 6.5 8 4 10.5 1.5 8zM12 5.5 14.5 8 12 10.5 9.5 8z"/>'),
    image: svg('<rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="6" cy="6.5" r="1.2"/><path d="m3 12 3.5-3.5 2.5 2.5 2-2 2.5 2.5"/>'),
    eye: svg('<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'), eyeoff: svg('<path d="M2 2l12 12M6.5 4C7 3.6 7.5 3.5 8 3.5c4.1 0 6.5 4.5 6.5 4.5a12 12 0 0 1-1.8 2.3M4.2 5.1A12 12 0 0 0 1.5 8s2.4 4.5 6.5 4.5c1 0 1.9-.3 2.7-.7"/>'),
    lock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'), unlock: svg('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.8-1"/>'),
    plus: svg('<path d="M8 3v10M3 8h10"/>'), minus: svg('<path d="M3 8h10"/>'), x: svg('<path d="M4 4l8 8M12 4l-8 8"/>'), link: svg('<path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1"/>'),
    unlinkStyle: svg('<path d="M4 8h8"/><circle cx="8" cy="8" r="6"/>'), caretR: '<svg viewBox="0 0 10 10"><path d="M3 2l4 3-4 3z" fill="currentColor"/></svg>', caretD: '<svg viewBox="0 0 10 10"><path d="M2 3l3 4 3-4z" fill="currentColor"/></svg>',
    alL: svg('<path d="M2 2v12M5 5h8M5 11h5"/>'), alC: svg('<path d="M8 2v12M3 5h10M5 11h6"/>'), alR: svg('<path d="M14 2v12M3 5h8M6 11h5"/>'),
    alT: svg('<path d="M2 2h12M5 5v8M11 5v5"/>'), alM: svg('<path d="M2 8h12M5 3v10M11 5v6"/>'), alB: svg('<path d="M2 14h12M5 3v8M11 6v5"/>'),
    disH: svg('<path d="M2 2v12M14 2v12M6 5v6M10 5v6"/>'), disV: svg('<path d="M2 2h12M2 14h12M5 6h6M5 10h6"/>'), tidy: svg('<rect x="2" y="2" width="5" height="5"/><rect x="9" y="2" width="5" height="5"/><rect x="2" y="9" width="5" height="5"/><rect x="9" y="9" width="5" height="5"/>'),
    dirH: svg('<path d="M2 8h11M10 5l3 3-3 3"/>'), dirV: svg('<path d="M8 2v11M5 10l3 3 3-3"/>'), wrap: svg('<path d="M2 4h10a2 2 0 0 1 0 4H5M7 6 5 8l2 2"/>'),
    tL: svg('<path d="M2 4h12M2 8h8M2 12h11"/>'), tC: svg('<path d="M2 4h12M4 8h8M3 12h10"/>'), tR: svg('<path d="M2 4h12M6 8h8M3 12h11"/>'), tJ: svg('<path d="M2 4h12M2 8h12M2 12h12"/>'),
    vT: svg('<path d="M2 2h12M8 5v9M5 8l3-3 3 3"/>'), vM: svg('<path d="M2 8h12M8 2v3M8 11v3"/>'), vB: svg('<path d="M2 14h12M8 2v9M5 8l3 3 3-3"/>'),
    play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor"/></svg>', home: svg('<path d="M2 7.5 8 2.5l6 5M3.5 6.5v7h9v-7"/>'), copy: svg('<rect x="5" y="5" width="9" height="9" rx="1"/><path d="M11 5V3a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h2"/>')
  };
  P.ICON = ICON;
  ICON.bool = svg('<rect x="1.8" y="1.8" width="8" height="8" rx="1"/><rect x="6.2" y="6.2" width="8" height="8" rx="1"/>');
  ICON.mask = svg('<rect x="2" y="2" width="12" height="12" rx="2"/><circle cx="8" cy="8" r="3.5" fill="currentColor"/>');
  ICON.bUnion = svg('<path d="M2 2h7v4h5v8H6v-4H2z" fill="currentColor" fill-opacity=".35"/>');
  ICON.bSubtract = svg('<path d="M2 2h7v4H6v4H2z" fill="currentColor" fill-opacity=".35"/><rect x="6" y="6" width="8" height="8" stroke-dasharray="2 1.5"/>');
  ICON.bIntersect = svg('<rect x="2" y="2" width="7" height="8"/><rect x="6" y="6" width="8" height="8"/><rect x="6" y="6" width="3" height="4" fill="currentColor"/>');
  ICON.bExclude = svg('<path d="M2 2h7v4H6v4H2zM9 6h5v8H6v-4h3z" fill="currentColor" fill-opacity=".35"/>');
  const typeIcon = n => n.mask ? ICON.mask : n.component ? ICON.component : n.type === 'instance' ? ICON.instance : (n.type === 'rect' && (n.fills || []).some(f => f.type === 'image')) ? ICON.image : ICON[n.type] || ICON.rect;

  /* ======================= layers ======================= */
  const expanded = new Set();
  P.expanded = expanded;
  let layersEl;
  P.initLayers = el => {
    layersEl = el;
    ED.on('doc', renderLayers); ED.on('sel', () => { ED.selNodes().forEach(n => ED.ancestors(n).forEach(a => expanded.add(a.id))); renderLayers(); });
  };
  function renderLayers() {
    if (!layersEl || !ED.scene) return;
    const st = layersEl.scrollTop;
    layersEl.innerHTML = '';
    const sel = new Set(ED.sel);
    const add = (n, depth) => {
      const kids = ED.kids(n), clone = ED.isClone(n);
      const isExp = expanded.has(n.id);
      const row = h('div', { class: 'aero-item lrow' + (sel.has(n.id) ? ' sel' : '') + (clone ? ' clone' : '') + (n.visible === false ? ' hid' : '') + (n.component || n.type === 'instance' ? ' comp' : '') });
      row.dataset.id = n.id;
      row.style.paddingLeft = (4 + depth * 14) + 'px';
      const caret = h('span', { class: 'caret', html: kids.length ? (isExp ? ICON.caretD : ICON.caretR) : '' });
      caret.onclick = e => { e.stopPropagation(); if (isExp) expanded.delete(n.id); else expanded.add(n.id); renderLayers(); };
      const nm = h('span', { class: 'grow lname', text: n.name || n.type });
      const eye = h('button', { class: 'lbtn' + (n.visible === false ? ' on' : ''), title: n.visible === false ? 'Show' : 'Hide', html: n.visible === false ? ICON.eyeoff : ICON.eye });
      eye.onclick = e => { e.stopPropagation(); ED.setProp(n, 'visible', n.visible === false); ED.commit(n.visible === false ? 'Hide' : 'Show'); };
      const lock = h('button', { class: 'lbtn' + (n.locked ? ' on' : ''), title: n.locked ? 'Unlock' : 'Lock', html: n.locked ? ICON.lock : ICON.unlock });
      lock.onclick = e => { e.stopPropagation(); if (clone) return; n.locked = !n.locked; ED.commit(n.locked ? 'Lock' : 'Unlock'); };
      row.append(caret, h('span', { class: 'ticon', html: typeIcon(n) }), nm, clone ? '' : lock, eye);
      row.onpointerdown = e => rowDown(e, n, row);
      row.ondblclick = e => { e.stopPropagation(); renameInline(n, nm); };
      layersEl.appendChild(row);
      if (isExp) kids.slice().reverse().forEach(k => add(k, depth + 1));
    };
    ED.doc.children.slice().reverse().forEach(n => add(n, 0));
    if (!ED.doc.children.length) layersEl.appendChild(h('div', { class: 'dim', style: 'padding:14px;text-align:center', text: 'No layers yet — pick the Artboard tool (A) or use File › Open Sample.' }));
    layersEl.scrollTop = st;
    layersEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
  P.renderLayers = renderLayers;
  function renameInline(n, nm) {
    if (ED.isClone(n)) return;
    const inp = h('input', { type: 'text', class: 'lrename', value: n.name });
    nm.replaceWith(inp); inp.focus(); inp.select();
    const done = ok => { if (ok && inp.value.trim() && inp.value !== n.name) { n.name = inp.value.trim(); ED.commit('Rename'); } else renderLayers(); };
    inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); };
    inp.onblur = () => done(true);
  }
  ED.renameNode = n => { const row = layersEl.querySelector(`[data-id="${CSS.escape(n.id)}"] .lname`); if (row) renameInline(n, row); else Aero.prompt('Rename', 'Name', n.name).then(v => { if (v) { n.name = v; ED.commit('Rename'); } }); };
  function rowDown(e, n, row) {
    if (e.button !== 0 || e.target.closest('.lbtn,.caret,input')) return;
    const start = { x: e.clientX, y: e.clientY }; let dragging = false, ind = null, drop = null;
    const move = ev => {
      if (!dragging && Math.abs(ev.clientY - start.y) > 4 && !ED.isClone(n)) { dragging = true; ind = h('div', { class: 'ldrop' }); layersEl.appendChild(ind); }
      if (!dragging) return;
      const r = layersEl.getBoundingClientRect();
      const rows = [...layersEl.querySelectorAll('.lrow')];
      const over = rows.find(rw => { const b = rw.getBoundingClientRect(); return ev.clientY >= b.top && ev.clientY < b.bottom; });
      drop = null; ind.style.display = 'none'; layersEl.querySelectorAll('.lrow.dropin').forEach(x => x.classList.remove('dropin'));
      if (!over) return;
      const t = ED.get(over.dataset.id); if (!t || t === n || ED.isAncestor(n, t) || ED.isClone(t)) return;
      const b = over.getBoundingClientRect(), f = (ev.clientY - b.top) / b.height;
      const cont = ED.isContainer(t) && !ED.isClone(t);
      if (cont && f > .28 && f < .72) { drop = { into: t }; over.classList.add('dropin'); }
      else { drop = { ref: t, above: f < .5 }; ind.style.display = 'block'; ind.style.top = ((f < .5 ? b.top : b.bottom) - r.top + layersEl.scrollTop - 1) + 'px'; ind.style.left = over.style.paddingLeft; }
    };
    const up = ev => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (!dragging) {
        if (ev.shiftKey || ev.ctrlKey) ED.select([n.id], true); else ED.select([n.id]);
        return;
      }
      ind?.remove();
      if (!drop) { renderLayers(); return; }
      const movers = ED.sel.includes(n.id) ? ED.selRoots().filter(x => !ED.isClone(x)) : [n];
      if (drop.into) { movers.forEach(m => ED.reparent(m, drop.into)); }
      else {
        const par = ED.parent(drop.ref);
        movers.forEach(m => {
          if (m === drop.ref) return;
          if (ED.parent(m) !== par) ED.reparent(m, par);
          const arr = ED.childArr(par); arr.splice(arr.indexOf(m), 1);
          const i = arr.indexOf(drop.ref); arr.splice(drop.above ? i + 1 : i, 0, m);
        });
      }
      ED.commit('Reorder layers');
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  /* ======================= assets ======================= */
  let assetsEl, iconQuery = '';
  P.initAssets = el => { assetsEl = el; ED.on('doc', () => { if (!assetsEl.hidden) renderAssets(); }); ED.on('images', () => { if (!assetsEl.hidden) renderAssets(); }); };
  function renderAssets() {
    if (!assetsEl) return;
    const st = assetsEl.scrollTop;
    assetsEl.innerHTML = '';
    const sec = (title, onAdd, addTitle) => { const hd = h('div', { class: 'asec' }, h('span', { class: 'grow', text: title })); if (onAdd) hd.append(h('button', { class: 'lbtn', title: addTitle, html: ICON.plus, onclick: onAdd })); assetsEl.append(hd); const body = h('div', { class: 'abody' }); assetsEl.append(body); return body; };
    // colors
    const cb = sec(`Colors (${ED.doc.colorStyles.length})`, () => A.addColorStyle(), 'New color style from selection');
    const grid = h('div', { class: 'swgrid' });
    ED.doc.colorStyles.forEach(s => {
      const sw = h('div', { class: 'csw', title: `${s.name}  ${s.color}${s.a < 1 ? ' ' + Math.round(s.a * 100) + '%' : ''}\nClick: apply as fill · Shift+click: apply as stroke · Double-click: edit` },
        h('span', { class: 'chip', style: (() => { const vs = [{ color: s.color, a: s.a }].concat(LP.modesOf(ED.doc).slice(1).map(m => s.modes?.[m.id] || (m.id === 'dark' && s.dark)).filter(Boolean)); if (vs.length < 2) return `background:${LP.rgba(s.color, s.a)}`; const st = 100 / vs.length; return `background:linear-gradient(135deg,${vs.map((c, i) => `${LP.rgba(c.color, c.a ?? 1)} ${i * st}% ${(i + 1) * st}%`).join(',')})`; })() }), h('span', { class: 'cname', text: s.name }));
      sw.onclick = e => A.applyColorStyle(s, e.shiftKey ? 'stroke' : 'fill');
      sw.ondblclick = () => editColorStyle(s);
      grid.append(sw);
    });
    if (!ED.doc.colorStyles.length) grid.append(h('div', { class: 'dim small', text: 'Select a layer and press + to save its fill as a shared color.' }));
    cb.append(grid);
    // text styles
    const tb = sec(`Text styles (${ED.doc.textStyles.length})`, () => A.addTextStyle(), 'New text style from selected text');
    ED.doc.textStyles.forEach(s => {
      const row = h('div', { class: 'aero-item tstyle', title: 'Click: apply · Double-click: edit' },
        h('span', { class: 'grow', style: `font:${s.italic ? 'italic ' : ''}${s.weight} ${Math.min(18, s.size)}px ${LP.fontCss(s.font)}`, text: s.name }),
        h('span', { class: 'dim small', text: `${s.size}/${s.lh || 'auto'}` }));
      row.onclick = () => A.applyTextStyle(s); row.ondblclick = () => editTextStyle(s);
      tb.append(row);
    });
    if (!ED.doc.textStyles.length) tb.append(h('div', { class: 'dim small', text: 'Select a text layer and press + to create a style.' }));
    // components
    const comps = A.components();
    const kb = sec(`Components (${comps.length})`, () => A.createComponent(), 'Create component from selection (Ctrl+Alt+K)');
    const sets = {};
    comps.forEach(c => { const k = c.component.set || c.name; (sets[k] = sets[k] || []).push(c); });
    Object.entries(sets).forEach(([name, list]) => {
      if (list.length > 1 || list[0].component.set) kb.append(h('div', { class: 'cset', text: `${name} · ${list.length} variant${list.length > 1 ? 's' : ''}` }));
      const g = h('div', { class: 'cgrid' });
      list.forEach(c => {
        const thumb = document.createElement('canvas'); thumb.width = 120; thumb.height = 72;
        try {
          const s = Math.min(1.6, 108 / c.w, 60 / c.h); const r = LP.renderNodeCanvas(ED.scene, Object.assign(Object.create(Object.getPrototypeOf(c)), c, { x: 0, y: 0, r: 0 }), s * 2);
          const x = thumb.getContext('2d'); x.drawImage(r, (120 - r.width / 2) / 2, (72 - r.height / 2) / 2, r.width / 2, r.height / 2);
        } catch (e) { }
        const card = h('div', { class: 'ccard', draggable: 'true', title: 'Click to insert an instance, or drag onto the canvas' }, thumb, h('span', { text: c.component.variant || c.name }));
        card.onclick = () => A.insertComponent(c);
        card.ondblclick = () => { ED.select([c.id]); ED.zoomToBox(ED.wbox(c), 2); };
        card.ondragstart = e => { e.dataTransfer.setData('text/lproto-comp', c.id); e.dataTransfer.effectAllowed = 'copy'; };
        g.append(card);
      });
      kb.append(g);
    });
    if (!comps.length) kb.append(h('div', { class: 'dim small', text: 'Select layers and press Ctrl+Alt+K to make a reusable component.' }));
    // icons
    const ib = sec(`Icons (Lucide, ${Object.keys(window.LP_ICONS).length})`);
    const q = h('input', { type: 'search', placeholder: 'Search icons…', value: iconQuery, class: 'isearch' });
    const ig = h('div', { class: 'igrid' });
    const fillIcons = () => {
      ig.innerHTML = '';
      Object.keys(window.LP_ICONS).filter(k => !iconQuery || k.includes(iconQuery.toLowerCase())).forEach(k => {
        const b = h('button', { class: 'ibtn', title: k + ' — click to insert (replaces the icon if an icon is selected), or drag onto the canvas', draggable: 'true', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${window.LP_ICONS[k]}"/></svg>` });
        b.onclick = () => A.addIcon(k);
        b.ondragstart = e => { e.dataTransfer.setData('text/lproto-icon', k); };
        ig.append(b);
      });
    };
    q.oninput = () => { iconQuery = q.value; fillIcons(); };
    ib.append(q, ig); fillIcons();
    assetsEl.scrollTop = st;
  }
  P.renderAssets = renderAssets;
  function editColorStyle(s) {
    const extra = LP.modesOf(ED.doc).slice(1);
    const fromV = v => { s.color = v.color; s.a = v.a / 100; delete s.dark; s.modes = {}; extra.forEach(m => { if (v['on_' + m.id]) s.modes[m.id] = { color: v['c_' + m.id], a: v['a_' + m.id] / 100 }; }); if (!Object.keys(s.modes).length) delete s.modes; };
    const mv = id => (s.modes && s.modes[id]) || (id === 'dark' && s.dark) || null;
    const fields = [{ key: 'name', label: 'Name', type: 'text', value: s.name }, { key: 'color', label: LP.modesOf(ED.doc)[0].name + ' color', type: 'color', value: s.color }, { key: 'a', label: 'Opacity %', type: 'range', min: 0, max: 100, value: Math.round((s.a ?? 1) * 100) }];
    extra.forEach(m => fields.push({ key: 'on_' + m.id, label: `Own value in "${m.name}" mode`, type: 'checkbox', value: !!mv(m.id) }, { key: 'c_' + m.id, label: m.name + ' color', type: 'color', value: mv(m.id)?.color || s.color }, { key: 'a_' + m.id, label: m.name + ' opacity %', type: 'range', min: 0, max: 100, value: Math.round((mv(m.id)?.a ?? s.a ?? 1) * 100) }));
    fields.push({ key: 'del', label: 'Delete this style', type: 'checkbox', value: false });
    Aero.dialog({
      title: 'Edit color style', instruction: 'Changes update every layer that uses this style. Per-mode values are used by artboards / prototypes in that color mode.',
      fields,
      onChange: v => { if (v.del) return; fromV(v); ED.live(); },
      onOK: v => { if (v.del) { A.deleteStyle('color', s); return; } s.name = v.name; fromV(v); syncStyleCopies(); ED.commit('Edit color style'); },
      onCancel: () => restoreFromHist()
    });
  }
  function syncStyleCopies() { // keep stored colors in sync with styles (for files read by other tools)
    LP.walk(ED.doc, n => ['fills', 'strokes'].forEach(k => (n[k] || []).forEach(f => { const s = f.style && ED.doc.colorStyles.find(x => x.id === f.style); if (s) { f.color = s.color; f.a = s.a; } })));
  }
  function restoreFromHist() { const st = ED.hist.current; if (st) { const images = ED.doc.images; ED.doc = JSON.parse(st); ED.doc.images = images; ED.update(); ED.emit('doc'); ED.redraw(); } }
  function editTextStyle(s) {
    Aero.dialog({
      title: 'Edit text style', instruction: 'Changes update every text layer that uses this style.',
      fields: [{ key: 'name', label: 'Name', type: 'text', value: s.name }, { key: 'font', label: 'Font', type: 'select', options: LP.FONTS, value: s.font }, { key: 'size', label: 'Size', type: 'number', min: 1, max: 999, value: s.size },
        { key: 'weight', label: 'Weight', type: 'select', options: WEIGHTS, value: String(s.weight) }, { key: 'lh', label: 'Line height (0 = auto)', type: 'number', min: 0, value: s.lh || 0 }, { key: 'ls', label: 'Letter spacing', type: 'number', step: .1, value: s.ls || 0 },
        { key: 'italic', label: 'Italic', type: 'checkbox', value: !!s.italic }, { key: 'del', label: 'Delete this style', type: 'checkbox', value: false }],
      onChange: v => { if (v.del) return; Object.assign(s, { font: v.font, size: v.size, weight: +v.weight, lh: v.lh, ls: v.ls, italic: v.italic }); ED.live(); },
      onOK: v => { if (v.del) { A.deleteStyle('text', s); return; } Object.assign(s, { name: v.name, font: v.font, size: v.size, weight: +v.weight, lh: v.lh, ls: v.ls, italic: v.italic }); ED.commit('Edit text style'); },
      onCancel: () => restoreFromHist()
    });
  }
  const WEIGHTS = [['100', 'Thin 100'], ['200', 'Extra Light 200'], ['300', 'Light 300'], ['400', 'Regular 400'], ['500', 'Medium 500'], ['600', 'Semibold 600'], ['700', 'Bold 700'], ['800', 'Extra Bold 800'], ['900', 'Black 900']];
  P.WEIGHTS = WEIGHTS;

  /* ======================= inspector ======================= */
  let inspEl;
  P.initInspector = el => {
    inspEl = el;
    ED.on('sel', renderInspector); ED.on('doc', renderInspector);
    ED.on('live', () => { if (!inspEl.contains(document.activeElement) && !scrubbing) renderInspector(); });
    ED.on('mode', renderInspector);
    ED.on('textsel', () => { if (!inspEl.contains(document.activeElement)) renderInspector(); });
  };
  ED.listeners.mode = [];
  let scrubbing = false;
  function renderInspector() {
    if (!inspEl || !ED.scene) return;
    const st = inspEl.scrollTop;
    inspEl.innerHTML = '';
    try {
      if (ED.mode === 'proto') protoInspector(); else if (ED.mode === 'inspect') devInspector(); else designInspector();
    } catch (e) { console.error(e); inspEl.append(h('div', { class: 'dim', style: 'padding:10px', text: 'Inspector error: ' + e.message })); }
    inspEl.scrollTop = st;
  }
  P.renderInspector = renderInspector;

  // ----- small form widgets -----
  const section = (title, ...right) => { const s = h('div', { class: 'isec' }, h('div', { class: 'ihead' }, h('span', { class: 'grow', text: title }), ...right)); inspEl.append(s); return s; };
  const iconBtn = (icon, title, fn, on) => h('button', { class: 'ib' + (on ? ' on' : ''), title, html: icon, onclick: fn });
  const sel = () => ED.selNodes();
  const mixed = (ns, f) => { const vs = ns.map(f); return vs.every(v => JSON.stringify(v) === JSON.stringify(vs[0])) ? vs[0] : null; };
  function apply(key, fn, label, live) {
    sel().forEach(n => {
      if (!ED.canEdit(n, key)) return;
      ED.setProp(n, key, typeof fn === 'function' ? fn(n) : fn);
      // a new layer fill on mixed-style text replaces the per-range colors
      if (key === 'fills' && n.type === 'text' && n.runs && !live && /color/i.test(label || '')) { const r = LP.applyRunStyle(n, 0, String(n.text || '').length, { color: null, a: null, cs: null }); ED.setProp(n, 'runs', r); if (!r) delete n.runs; }
    });
    live ? ED.live() : ED.commit(label);
  }
  P.apply = apply;
  function numField(lbl, val, onSet, o = {}) {
    const wrap = h('label', { class: 'nf' + (o.wide ? ' wide' : ''), title: o.title || '' });
    const l = h('span', { class: 'nl', text: lbl });
    const inp = h('input', { type: 'text', value: val == null ? '' : ED.fmt(val), placeholder: val == null ? 'Mixed' : '' });
    if (o.disabled) inp.disabled = true;
    const commit = () => { const v = evalNum(inp.value, val); if (v != null && !Number.isNaN(v) && v !== val) onSet(clampV(v, o), false); };
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { commit(); inp.blur(); } if (e.key === 'Escape') { inp.value = val == null ? '' : ED.fmt(val); inp.blur(); } if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const v = (evalNum(inp.value, val) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) * (o.step || 1); inp.value = ED.fmt(clampV(v, o)); onSet(clampV(v, o), false); } });
    inp.addEventListener('change', commit);
    // scrub on label
    l.addEventListener('pointerdown', e => {
      if (o.disabled) return; e.preventDefault(); l.setPointerCapture(e.pointerId); scrubbing = true;
      const x0 = e.clientX, v0 = val ?? 0; let moved = false;
      const mv = ev => { const dv = (ev.clientX - x0) * (o.step || 1) * (ev.shiftKey ? 10 : 1); if (Math.abs(ev.clientX - x0) > 2) moved = true; const v = clampV(Math.round((v0 + dv) * 100) / 100, o); inp.value = ED.fmt(v); onSet(v, true); };
      const up = () => { l.removeEventListener('pointermove', mv); l.removeEventListener('pointerup', up); scrubbing = false; if (moved) onSet(evalNum(inp.value, v0), false); else inp.focus(); };
      l.addEventListener('pointermove', mv); l.addEventListener('pointerup', up);
    });
    wrap.append(l, inp); if (o.suffix) wrap.append(h('span', { class: 'sfx', text: o.suffix }));
    return wrap;
  }
  const clampV = (v, o) => Math.max(o.min ?? -1e9, Math.min(o.max ?? 1e9, v));
  function evalNum(s, cur) { s = String(s).trim(); if (!s) return null; if (/^[-+*/]\s*\d/.test(s) && cur != null) s = cur + s; if (!/^[\d\s.+\-*/()]+$/.test(s)) return parseFloat(s); try { const v = Function('"use strict";return (' + s + ')')(); return typeof v === 'number' && isFinite(v) ? v : null; } catch (e) { return null; } }
  function selectEl(options, value, onChange, o = {}) {
    const s = h('select', { class: o.cls || '' });
    options.forEach(op => { const [v, t] = Array.isArray(op) ? op : [op, op]; s.add(new Option(t, v)); });
    s.value = value ?? ''; if (value == null) { s.add(new Option('Mixed', ''), 0); s.value = ''; }
    s.onchange = () => onChange(s.value);
    if (o.disabled) s.disabled = true;
    return s;
  }
  const row = (...k) => h('div', { class: 'irow' }, ...k);
  function segBtns(items, cur, onPick) { return h('div', { class: 'seg' }, ...items.map(([v, icon, title]) => iconBtn(icon, title, () => onPick(v), cur === v))); }
  function colorInput(color, a, onChange) {
    const wrap = h('div', { class: 'cin' });
    const sw = h('input', { type: 'color', value: LP.toHex(color || '#000') });
    const hex = h('input', { type: 'text', class: 'hex', value: LP.toHex(color || '#000').slice(1).toUpperCase() });
    const al = h('input', { type: 'text', class: 'alpha', value: Math.round((a ?? 1) * 100) + '%' });
    sw.oninput = () => { hex.value = sw.value.slice(1).toUpperCase(); onChange(sw.value, parseFloat(al.value) / 100, true); };
    sw.onchange = () => onChange(sw.value, parseFloat(al.value) / 100, false);
    const fromHex = () => { let v = hex.value.replace(/[^0-9a-f]/gi, ''); if (v.length === 3) v = [...v].map(c => c + c).join(''); if (v.length === 6) onChange('#' + v.toLowerCase(), parseFloat(al.value) / 100, false); };
    hex.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') fromHex(); }; hex.onchange = fromHex;
    al.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') al.blur(); };
    al.onchange = () => { const v = Math.max(0, Math.min(100, parseFloat(al.value) || 0)); onChange(sw.value, v / 100, false); };
    wrap.append(sw, hex, al);
    return wrap;
  }

  /* ---------- design inspector ---------- */
  function designInspector() {
    const ns = sel();
    if (!ns.length) return docInspector();
    const n = ns[0], one = ns.length === 1, v = ED.scene.view(n), clone = ED.isClone(n);
    // header
    const hd = h('div', { class: 'ititle' }, h('span', { class: 'ticon', html: typeIcon(n) }), h('span', { class: 'grow', text: one ? n.name : `${ns.length} layers` }));
    if (one && clone) hd.append(h('span', { class: 'badge', text: 'in instance' }));
    inspEl.append(hd);
    // align
    const al = section('Align');
    al.append(row(iconBtn(ICON.alL, 'Align left', () => A.align('left')), iconBtn(ICON.alC, 'Align horizontal centers', () => A.align('hcenter')), iconBtn(ICON.alR, 'Align right', () => A.align('right')),
      iconBtn(ICON.alT, 'Align top', () => A.align('top')), iconBtn(ICON.alM, 'Align vertical centers', () => A.align('vcenter')), iconBtn(ICON.alB, 'Align bottom', () => A.align('bottom')),
      h('span', { class: 'vsep' }), iconBtn(ICON.disH, 'Distribute horizontally', () => A.distribute('h')), iconBtn(ICON.disV, 'Distribute vertically', () => A.distribute('v')), iconBtn(ICON.tidy, 'Tidy up', () => A.tidyUp())));
    // components
    if (one && (n.component || n.type === 'instance')) componentSection(n, v);
    // geometry
    const geo = section(one && ED.isArtboard(n) ? 'Artboard' : 'Position & size');
    if (one && ED.isArtboard(n)) {
      geo.append(row(h('span', { class: 'lbl', text: 'Color mode' }), selectEl(LP.modesOf(ED.doc).map(m => [m.id, m.name]), LP.nodeMode(ED.doc, n), m => { if (m === LP.defaultMode(ED.doc)) delete n.cmode; else n.cmode = m; ED.commit('Color mode'); }), h('span', { class: 'dim small', text: 'color styles use this mode\'s values' })));
      geo.append(row(selectEl([['', 'Device preset…'], ...A.PRESETS.map(p => [p.name, `${p.name}  ${p.w}×${p.h}`])], '', name => { const p = A.PRESETS.find(q => q.name === name); if (!p) return; setSize(n, p.w, p.h); ED.commit('Artboard preset'); }, { cls: 'wide' })));
    }
    const dis = clone;
    geo.append(row(
      numField('X', mixed(ns, x => x.x), (val, live) => { ns.forEach(x => !ED.isClone(x) && (x.x = val)); live ? ED.live() : ED.commit('Move'); }, { disabled: dis }),
      numField('Y', mixed(ns, x => x.y), (val, live) => { ns.forEach(x => !ED.isClone(x) && (x.y = val)); live ? ED.live() : ED.commit('Move'); }, { disabled: dis })));
    geo.append(row(
      numField('W', mixed(ns, x => x.w), (val, live) => { ns.forEach(x => !ED.isClone(x) && setSize(x, val, x.lockRatio ? x.h * val / x.w : x.h)); live ? ED.live() : ED.commit('Resize'); }, { min: 1, disabled: dis }),
      numField('H', mixed(ns, x => x.h), (val, live) => { ns.forEach(x => !ED.isClone(x) && setSize(x, x.lockRatio ? x.w * val / x.h : x.w, val)); live ? ED.live() : ED.commit('Resize'); }, { min: 1, disabled: dis }),
      iconBtn(ICON.link, 'Lock aspect ratio', () => { const on = !ns.every(x => x.lockRatio); ns.forEach(x => x.lockRatio = on); ED.commit('Lock ratio'); }, ns.every(x => x.lockRatio))));
    geo.append(row(numField('↻', mixed(ns, x => x.r || 0), (val, live) => { ns.forEach(x => !ED.isClone(x) && (x.r = ((val % 360) + 540) % 360 - 180)); live ? ED.live() : ED.commit('Rotate'); }, { suffix: '°', disabled: dis, title: 'Rotation' }),
      ['rect', 'frame', 'instance'].includes(n.type) ? radiusField(ns) : h('span')));
    if (one && (n.type === 'frame' || n.type === 'instance' && v.mainType === 'frame')) geo.append(row(checkbox('Clip content', !!v.clip, c => apply('clip', c, 'Clip content'), n.type === 'instance')));
    // constraints / sizing
    const par = ED.parent(n), pv = par && par !== ED.doc ? ED.scene.view(par) : null;
    if (pv && pv.layout && !clone) {
      const s = section('Auto layout child');
      const opts = [['fixed', 'Fixed'], ['hug', 'Hug contents'], ['fill', 'Fill container']];
      s.append(row(h('span', { class: 'lbl', text: 'Width' }), selectEl(opts, mixed(ns, x => x.sizeH || 'fixed'), val => apply('sizeH', val, 'Sizing'))),
        row(h('span', { class: 'lbl', text: 'Height' }), selectEl(opts, mixed(ns, x => x.sizeV || 'fixed'), val => apply('sizeV', val, 'Sizing'))),
        row(checkbox('Absolute position (ignore auto layout)', ns.every(x => x.absolute), c => apply('absolute', c, 'Absolute position'))), ...minMaxRows(ns));
    } else if (pv && !clone) {
      const s = section('Constraints');
      const ch = mixed(ns, x => (x.cons || {}).h || 'left'), cv = mixed(ns, x => (x.cons || {}).v || 'top');
      s.append(row(consWidget(ch, cv, (k, val) => apply('cons', x => Object.assign({}, x.cons || { h: 'left', v: 'top' }, { [k]: val }), 'Constraints')),
        h('div', { class: 'col' },
          selectEl([['left', 'Left'], ['right', 'Right'], ['lr', 'Left & Right'], ['center', 'Center'], ['scale', 'Scale']], ch, val => apply('cons', x => Object.assign({}, x.cons, { h: val }), 'Constraints')),
          selectEl([['top', 'Top'], ['bottom', 'Bottom'], ['tb', 'Top & Bottom'], ['center', 'Center'], ['scale', 'Scale']], cv, val => apply('cons', x => Object.assign({}, x.cons, { v: val }), 'Constraints')))));
    }
    // auto layout
    if (one && (n.type === 'frame' && !clone)) autoLayoutSection(n);
    if (one && n.type === 'frame' && !clone) gridSection(n);
    // text
    if (ns.every(x => x.type === 'text')) textSection(ns);
    if (ns.every(x => x.type === 'icon')) iconSection(ns);
    vectorSection(ns);
    // appearance
    const ap = section('Layer');
    ap.append(row(numField('Opacity', Math.round(mixed(ns, x => ED.scene.view(x).opacity ?? 1) * 100), (val, live) => apply('opacity', val / 100, 'Opacity', live), { min: 0, max: 100, suffix: '%', wide: true }),
      selectEl(BLENDS, mixed(ns, x => ED.scene.view(x).blend || 'normal'), val => apply('blend', val, 'Blend mode'), { disabled: clone })));
    if (n.type !== 'icon' && n.type !== 'group') { paintSection(ns, 'fills', 'Fill'); strokeSection(ns); }
    if (n.type !== 'group') shadowSection(ns);
    blurSection(ns);
    exportSection(ns);
  }
  const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'].map(b => [b, b === 'normal' ? 'Normal' : b.replace(/(^|-)(\w)/g, (m, a, c) => (a ? ' ' : '') + c.toUpperCase())]);
  function checkbox(label, val, onChange, disabled) { const c = h('input', { type: 'checkbox' }); c.checked = !!val; c.disabled = !!disabled; c.onchange = () => onChange(c.checked); return h('label', { class: 'cb' }, c, label); }
  function setSize(n, w, hh) {
    w = Math.max(1, w); hh = Math.max(1, hh);
    const ow = n.w, oh = n.h;
    if (n.type === 'text') { if (w !== ow && n.auto === 'width') n.auto = 'height'; if (hh !== oh) n.auto = 'fixed'; }
    if (w !== ow && n.sizeH === 'hug') n.sizeH = 'fixed'; if (hh !== oh && n.sizeV === 'hug') n.sizeV = 'fixed';
    const c = ED.centerWorld(n);
    n.w = w; n.h = hh;
    if (n.r) { ED.wm = new Map(); ED.placeCenter(n, ED.parent(n), c.x, c.y); }
    if (n.children && !n.layout) LP.applyConstraintsKids(null, n.children, ow, oh, w, hh);
    if (n.type === 'group') { }
  }
  P.setSize = setSize;
  function radiusField(ns) {
    const v0 = ns.map(n => ED.scene.view(n).radius || [0, 0, 0, 0]);
    const same = v0.every(r => r.every(x => x === r[0]));
    const all = same ? mixed(ns, n => (ED.scene.view(n).radius || [0])[0]) : null;
    const wrap = h('div', { class: 'rad' });
    wrap.append(numField('◜', all, (val, live) => apply('radius', [val, val, val, val], 'Corner radius', live), { min: 0, title: 'Corner radius (all corners)' }));
    const more = iconBtn(svg('<path d="M2 6V3a1 1 0 0 1 1-1h3M10 2h3a1 1 0 0 1 1 1v3M14 10v3a1 1 0 0 1-1 1h-3M6 14H3a1 1 0 0 1-1-1v-3"/>'), 'Individual corners', () => { wrap.classList.toggle('open'); });
    wrap.append(more);
    const per = h('div', { class: 'per' });
    ['↖', '↗', '↘', '↙'].forEach((s, i) => per.append(numField(s, mixed(ns, n => (ED.scene.view(n).radius || [0, 0, 0, 0])[i]), (val, live) => apply('radius', n => { const r = (ED.scene.view(n).radius || [0, 0, 0, 0]).slice(); r[i] = val; return r; }, 'Corner radius', live), { min: 0 })));
    if (!same) wrap.classList.add('open');
    wrap.append(per);
    return wrap;
  }
  function consWidget(ch, cv, onSet) {
    const w = h('div', { class: 'consw' });
    const b = (cls, k, val, on) => { const e = h('div', { class: 'cb-' + cls + (on ? ' on' : ''), title: `${k === 'h' ? 'Horizontal' : 'Vertical'}: ${val}` }); e.onclick = () => onSet(k, val); w.append(e); };
    b('l', 'h', ch === 'lr' ? 'right' : ch === 'left' ? 'center' : 'left', ch === 'left' || ch === 'lr');
    b('r', 'h', ch === 'lr' ? 'left' : ch === 'right' ? 'center' : (ch === 'left' ? 'lr' : 'right'), ch === 'right' || ch === 'lr');
    b('t', 'v', cv === 'tb' ? 'bottom' : cv === 'top' ? 'center' : 'top', cv === 'top' || cv === 'tb');
    b('b', 'v', cv === 'tb' ? 'top' : cv === 'bottom' ? 'center' : (cv === 'top' ? 'tb' : 'bottom'), cv === 'bottom' || cv === 'tb');
    w.append(h('div', { class: 'cb-c' + (ch === 'center' || cv === 'center' ? ' on' : '') }));
    return w;
  }
  function componentSection(n, v) {
    const clone = ED.isClone(n);
    if (n.component) {
      const s = section('Main component', h('span', { class: 'badge purple', text: '◆' }));
      s.append(row(h('span', { class: 'lbl', text: 'Set' }), textInput(n.component.set || '', val => { n.component.set = val || null; ED.commit('Rename set'); }, 'Component set name')),
        row(h('span', { class: 'lbl', text: 'Variant' }), textInput(n.component.variant || '', val => { n.component.variant = val || null; ED.commit('Rename variant'); }, 'e.g. Default, Hover, Pressed')),
        row(h('button', { class: 'aero-btn small', text: '+ Add variant', onclick: () => A.addVariant() }), h('span', { class: 'dim small', text: `${Object.values(ED.scene.byId).filter(x => x.type === 'instance' && x.componentId === n.id).length} instance(s)` })));
      return;
    }
    const main = A.mainOf(n);
    const s = section('Instance', h('span', { class: 'badge purple', text: '◇' }));
    if (!main) { s.append(h('div', { class: 'dim', text: 'Main component is missing.' })); return; }
    const vars = A.variantsOf(main);
    if (vars.length > 1) s.append(row(h('span', { class: 'lbl', text: main.component.set || 'Variant' }), selectEl(vars.map(c => [c.id, c.component.variant || c.name]), main.id, id => A.setVariant(n, id))));
    else s.append(row(h('span', { class: 'lbl', text: 'Of' }), h('span', { class: 'grow', text: main.name })));
    if (!clone) s.append(row(h('button', { class: 'aero-btn small', text: 'Go to main', onclick: A.goToMain }), h('button', { class: 'aero-btn small', text: 'Reset', title: 'Reset overrides', onclick: A.resetOverrides }), h('button', { class: 'aero-btn small', text: 'Detach', onclick: A.detach })));
  }
  function textInput(val, onSet, ph) { const i = h('input', { type: 'text', value: val, placeholder: ph || '' }); i.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') i.blur(); }; i.onchange = () => onSet(i.value.trim()); return i; }
  // min / max width & height (auto layout sizing limits)
  function minMaxRows(ns) {
    const f = (k, lbl, t) => numField(lbl, mixed(ns, x => x[k] || 0), (val, live) => { ns.forEach(x => { if (ED.isClone(x)) return; if (val > 0) x[k] = val; else delete x[k]; }); live ? ED.live() : ED.commit('Min / max size'); }, { min: 0, title: t + ' (0 = none)' });
    return [row(f('minW', 'Min W', 'Minimum width'), f('maxW', 'Max W', 'Maximum width')), row(f('minH', 'Min H', 'Minimum height'), f('maxH', 'Max H', 'Maximum height'))];
  }
  function autoLayoutSection(n) {
    const L = n.layout;
    const s = section('Auto layout', iconBtn(L ? ICON.minus : ICON.plus, L ? 'Remove auto layout' : 'Add auto layout (Shift+A)', () => L ? A.removeAutoLayout() : A.addAutoLayout()));
    if (!L) { s.append(h('div', { class: 'dim small', text: 'Stack children horizontally, vertically or in a grid; they reflow as content changes.' })); return; }
    const set = (fn, label, live) => { fn(n.layout); live ? ED.live() : ED.commit(label); };
    const G = L.mode === 'grid', H = L.mode === 'h';
    s.append(row(segBtns([['h', ICON.dirH, 'Horizontal'], ['v', ICON.dirV, 'Vertical'], ['grid', ICON.tidy, 'Grid']], L.mode, m => set(l => { l.mode = m; if (m === 'grid' && !l.cols) l.cols = 2; }, 'Direction')),
      numField(G || L.wrap ? 'Col gap' : 'Gap', L.gap, (val, live) => set(l => l.gap = val, 'Spacing', live), { min: 0, title: 'Spacing between items' })));
    if (H) s.append(row(checkbox('Wrap onto new rows', !!L.wrap, c => set(l => { l.wrap = c; if (c && l.gapY == null) l.gapY = l.gap || 0; }, 'Wrap')), L.wrap ? numField('Row gap', L.gapY ?? L.gap, (val, live) => set(l => l.gapY = val, 'Row gap', live), { min: 0 }) : h('span')));
    if (G) s.append(row(numField('Columns', L.cols || 2, (val, live) => set(l => l.cols = Math.max(1, Math.min(64, Math.round(val))), 'Grid columns', live), { min: 1, max: 64 }), numField('Row gap', L.gapY ?? L.gap, (val, live) => set(l => l.gapY = val, 'Row gap', live), { min: 0 })));
    const pad = L.pad || [0, 0, 0, 0];
    s.append(row(...['↑', '→', '↓', '←'].map((t, i) => numField(t, pad[i], (val, live) => set(l => { l.pad = (l.pad || [0, 0, 0, 0]).slice(); l.pad[i] = val; }, 'Padding', live), { min: 0, title: ['Top', 'Right', 'Bottom', 'Left'][i] + ' padding' }))));
    const vOpts = [['start', ICON.vT, 'Top'], ['center', ICON.vM, 'Middle'], ['end', ICON.vB, 'Bottom']], hOpts = [['start', ICON.tL, 'Left'], ['center', ICON.tC, 'Center'], ['end', ICON.tR, 'Right']];
    if (G) {
      s.append(row(h('span', { class: 'lbl', text: 'In cell X' }), segBtns(hOpts, L.justify || 'start', val => set(l => l.justify = val, 'Align'))));
      s.append(row(h('span', { class: 'lbl', text: 'In cell Y' }), segBtns(vOpts, L.align || 'start', val => set(l => l.align = val, 'Align'))));
    } else {
      s.append(row(h('span', { class: 'lbl', text: H ? 'Align Y' : 'Align X' }), segBtns(H ? vOpts : hOpts, L.align || 'start', val => set(l => l.align = val, 'Align'))));
      s.append(row(h('span', { class: 'lbl', text: 'Distribute' }), selectEl([['start', 'Packed start'], ['center', 'Packed center'], ['end', 'Packed end'], ['between', 'Space between']], L.justify || 'start', val => set(l => l.justify = val, 'Distribute'))));
    }
    const opts = [['fixed', 'Fixed'], ['hug', 'Hug contents']];
    s.append(row(h('span', { class: 'lbl', text: 'Width' }), selectEl(opts, n.sizeH === 'fill' ? 'fixed' : n.sizeH || 'fixed', val => { n.sizeH = val; ED.commit('Sizing'); }), h('span', { class: 'lbl', text: 'Height' }), selectEl(opts, n.sizeV === 'fill' ? 'fixed' : n.sizeV || 'fixed', val => { n.sizeV = val; ED.commit('Sizing'); })));
    s.append(...minMaxRows([n]));
  }
  function gridSection(n) {
    const s = section('Layout grid', iconBtn(ICON.plus, 'Add layout grid', () => { n.grids = n.grids || []; n.grids.push({ type: 'columns', count: n.w > 600 ? 12 : 4, gutter: n.w > 600 ? 24 : 16, margin: n.w > 600 ? 80 : 16, color: '#ff3b3b', a: .1, visible: true }); ED.commit('Add layout grid'); }));
    (n.grids || []).forEach((g, i) => {
      const set = (fn, label, live) => { fn(g); live ? ED.live() : ED.commit(label); };
      s.append(row(selectEl([['columns', 'Columns'], ['rows', 'Rows'], ['grid', 'Grid']], g.type, val => set(x => x.type = val, 'Grid type')),
        g.type === 'grid' ? numField('Size', g.size || 8, (val, live) => set(x => x.size = val, 'Grid', live), { min: 1 }) : numField('#', g.count, (val, live) => set(x => x.count = Math.round(val), 'Grid', live), { min: 1, max: 48, title: 'Count' }),
        iconBtn(g.visible === false ? ICON.eyeoff : ICON.eye, 'Toggle visibility', () => set(x => x.visible = x.visible === false, 'Grid visibility')), iconBtn(ICON.x, 'Remove', () => { n.grids.splice(i, 1); ED.commit('Remove grid'); })));
      if (g.type !== 'grid') s.append(row(numField('Gutter', g.gutter, (val, live) => set(x => x.gutter = val, 'Grid', live), { min: 0, wide: true }), numField('Margin', g.margin, (val, live) => set(x => x.margin = val, 'Grid', live), { min: 0, wide: true })));
    });
  }
  // a text layer's value for key over its whole text (null when ranges differ)
  const layerTextVal = (x, key) => { const v = LP.rangeValue(x, ED.doc, 0, Math.max(1, String(x.text || '').length), key); return v === undefined ? null : v; };
  const rangeTs = (x, s, e) => { let val, first = true; const len = String(x.text || '').length; if (e <= s) { s = Math.max(0, s - 1); e = s + 1; } LP.normRuns(x.runs, len).forEach(g => { if (!(g.e > s && g.s < e)) return; const v = g.st.ts || ''; if (first) { val = v; first = false; } else if (v !== val) val = null; }); return first ? '' : val; };
  function textSection(ns) {
    const n = ns[0], s = section('Text');
    const ts = ED.textSel(), editing = ts && ns.length === 1 && ts.n.id === n.id, hasRange = editing && ts.e > ts.s;
    const pend = editing && !hasRange ? ED.pendingStyle() : null;
    if (editing) s.querySelector('.ihead').append(h('span', { class: 'badge', text: hasRange ? `${ts.e - ts.s} chars selected` : 'next typed text' }));
    const val = key => pend && pend[key] !== undefined && pend[key] !== null ? pend[key] : editing ? (v => v === undefined ? null : v)(LP.rangeValue(n, ED.doc, ts.s, ts.e, key)) : mixed(ns, x => layerTextVal(x, key));
    const clone = ns.some(x => ED.isClone(x));
    // whole-layer change: set the layer key and drop per-range overrides of it
    const setT = (key, v, label, live) => {
      if (editing) { ED.applyRangeStyle({ [key]: v }); return; } // range, or pending style at the caret
      sel().forEach(x => {
        if (ED.isClone(x)) return;
        x[key] = v; if (x.textStyleId && LP.TEXT_KEYS.includes(key)) x.textStyleId = null;
        if (x.runs) { const r = LP.applyRunStyle(x, 0, String(x.text || '').length, LP.TEXT_KEYS.includes(key) ? { [key]: null, ts: null } : { [key]: null }); if (r) x.runs = r; else delete x.runs; }
      });
      if (editing) { if (!live) ED.editing.snapshot(); ED.editing.refresh(ED.editing.sel); return; }
      live ? ED.live() : ED.commit(label);
    };
    const dis = clone && !hasRange;
    const stVal = hasRange ? rangeTs(n, ts.s, ts.e) : mixed(ns, x => ED.scene.view(x).textStyleId || '');
    const styleSel = selectEl([['', hasRange ? 'No text style (range)' : 'No text style'], ...ED.doc.textStyles.map(t => [t.id, t.name])], stVal, id => {
      if (editing) { ED.applyRangeStyle({ ts: id || null, font: null, size: null, weight: null, italic: null, lh: null, ls: null }); return; }
      if (!id) { apply('textStyleId', null, 'Detach text style'); return; } A.applyTextStyle(ED.doc.textStyles.find(t => t.id === id));
    });
    s.append(row(styleSel, iconBtn(ICON.plus, 'Create text style from this text', () => A.addTextStyle())));
    s.append(row(selectEl(LP.FONTS, val('font'), v => setT('font', v, 'Font'), { disabled: dis, cls: 'wide' })));
    s.append(row(selectEl(WEIGHTS, (w => w == null ? null : String(w))(val('weight')), v => setT('weight', +v, 'Font weight'), { disabled: dis }),
      numField('Size', val('size'), (v, live) => setT('size', v, 'Font size', live), { min: 1, max: 1000, disabled: dis })));
    s.append(row(numField('Line', val('lh'), (v, live) => setT('lh', v, 'Line height', live), { min: 0, title: 'Line height in px (0 = auto)', disabled: dis }),
      numField('Letter', val('ls'), (v, live) => setT('ls', v, 'Letter spacing', live), { step: .1, title: 'Letter spacing in px', disabled: dis })));
    s.append(row(segBtns([['left', ICON.tL, 'Align left'], ['center', ICON.tC, 'Center'], ['right', ICON.tR, 'Align right'], ['justify', ICON.tJ, 'Justify']], mixed(ns, x => x.align), v => layerSet('align', v, 'Text align')),
      segBtns([['top', ICON.vT, 'Top'], ['middle', ICON.vM, 'Middle'], ['bottom', ICON.vB, 'Bottom']], mixed(ns, x => x.valign || 'top'), v => layerSet('valign', v, 'Vertical align'))));
    s.append(row(h('span', { class: 'lbl', text: 'Resizing' }), selectEl([['width', 'Auto width'], ['height', 'Auto height'], ['fixed', 'Fixed size']], mixed(ns, x => x.auto || 'width'), v => layerSet('auto', v, 'Text resizing'))));
    const it = val('italic');
    s.append(row(selectEl([['none', 'No decoration'], ['underline', 'Underline'], ['strike', 'Strikethrough']], val('deco'), v => setT('deco', v, 'Decoration'), { disabled: dis }),
      selectEl([['none', 'As typed'], ['upper', 'UPPERCASE'], ['lower', 'lowercase']], mixed(ns, x => x.tcase || 'none'), v => layerSet('tcase', v, 'Case')),
      iconBtn('<b style="font-style:italic;font-family:Georgia">I</b>', 'Italic (Ctrl+I while editing)', () => setT('italic', !it, 'Italic'), !!it)));
    // range color (mixed-style text): overrides the layer fill for the selected characters
    if (hasRange || ns.some(x => (x.runs || []).some(r => r.color || r.cs))) {
      let cs = null;
      if (hasRange) { let f = true; LP.normRuns(n.runs, String(n.text || '').length).forEach(g => { if (!(g.e > ts.s && g.s < ts.e)) return; const q = g.st.cs || ''; if (f) { cs = q; f = false; } else if (q !== cs) cs = null; }); }
      const col = val('color');
      const st = cs && ED.doc.colorStyles.find(c => c.id === cs);
      const r = row(h('span', { class: 'lbl', text: hasRange ? 'Color' : 'Range colors' }));
      if (hasRange) {
        if (st) r.append(h('span', { class: 'grow stylename', html: `<span class="chip" style="background:${LP.rgba(st.color, st.a)}"></span>${esc(st.name)}` }));
        else r.append(colorInput(col || '#000000', val('a') ?? 1, (c, a, live) => { if (!live) ED.applyRangeStyle({ color: c, a, cs: null }); }));
        r.append(styleMenu(id => ED.applyRangeStyle({ cs: id, color: null, a: null })));
      } else r.append(h('span', { class: 'grow dim small', text: 'some characters have their own color' }));
      r.append(iconBtn(ICON.unlinkStyle, hasRange ? 'Use the layer fill for these characters' : 'Remove all range colors', () => {
        if (hasRange) ED.applyRangeStyle({ color: null, a: null, cs: null });
        else { sel().forEach(x => { if (!x.runs) return; const rr = LP.applyRunStyle(x, 0, String(x.text || '').length, { color: null, a: null, cs: null }); ED.setProp(x, 'runs', rr); if (!rr) delete x.runs; }); ED.commit('Remove range colors'); }
      }));
      s.append(r);
    }
    if (hasRange) s.append(row(h('button', { class: 'aero-btn small', text: 'Clear range styles', title: 'Remove every style override from the selected characters', onclick: () => ED.applyRangeStyle(Object.fromEntries(LP.RUN_KEYS.map(k => [k, null]))) }), h('span', { class: 'dim small', text: 'Ctrl+B / I / U toggle bold, italic, underline' })));
    else if (!editing && ns.length === 1) s.append(h('div', { class: 'dim small', text: 'Double-click the text to edit it in place; select characters to style them individually.' }));
    if (ns.length === 1 && !editing) {
      const ta = h('textarea', { class: 'tcontent', rows: 2 }); ta.value = n.text || '';
      ta.onkeydown = e => e.stopPropagation();
      ta.onchange = () => { ED.setProp(n, 'text', ta.value); ED.commit('Edit text'); };
      s.append(ta);
    }
    function layerSet(key, v, label) { if (editing) { sel().forEach(x => ED.setProp(x, key, v)); ED.editing.refresh(ED.editing.sel); return; } apply(key, v, label); }
  }
  // boolean ops / flatten / point editing / mask
  function vectorSection(ns) {
    const n = ns[0], one = ns.length === 1, clone = ns.some(x => ED.isClone(x));
    if (clone) return;
    const shapes = ns.filter(x => !ED.isArtboard(x));
    const isBool = one && n.type === 'bool';
    const canBool = isBool || shapes.length >= 2;
    const isPath = one && n.type === 'path';
    const canFlatten = ns.some(x => ['rect', 'ellipse', 'bool', 'path', 'group', 'frame'].includes(x.type) && !ED.isArtboard(x) && !x.component);
    const inParent = ns.every(x => ED.parent(x) && ED.parent(x) !== ED.doc);
    if (!canBool && !canFlatten && !inParent) return;
    const s = section(isBool ? 'Boolean group' : 'Vector');
    if (canBool) {
      const ops = [['union', ICON.bUnion, 'Union (Ctrl+Alt+U)'], ['subtract', ICON.bSubtract, 'Subtract (Ctrl+Alt+S)'], ['intersect', ICON.bIntersect, 'Intersect (Ctrl+Alt+I)'], ['exclude', ICON.bExclude, 'Exclude (Ctrl+Alt+X)']];
      s.append(row(h('span', { class: 'lbl', text: isBool ? 'Operation' : 'Combine' }), segBtns(ops, isBool ? n.op || 'union' : null, op => A.boolean(op))));
      if (isBool) s.append(h('div', { class: 'dim small', text: 'Operands stay editable: double-click to select one and move or edit it.' }));
    }
    if (ED.pathEdit && isPath && ED.pathEdit === n.id) {
      const ps = ED.pathSel, c = ps && LP.contoursOf(n)[ps.ci], pt = c && c.pts[ps.i];
      s.append(h('div', { class: 'dim small', text: 'Editing points — drag points/handles (Alt breaks handles), click a segment to add a point, Delete removes, Alt+click or double-click toggles corner/smooth.' }));
      s.append(row(
        h('button', { class: 'aero-btn small', text: pt && (pt.ox != null || pt.ix != null) ? 'Make corner' : 'Make smooth', disabled: !pt, onclick: () => { ED.convertPathPoint(n, ps.ci, ps.i); ED.normalizePath(n); ED.commit('Convert point'); } }),
        h('button', { class: 'aero-btn small', text: 'Delete point', disabled: !pt, onclick: () => ED.deleteSelectedPoint() }),
        h('button', { class: 'aero-btn small', text: c ? (c.closed ? 'Open path' : 'Close path') : 'Close path', disabled: !c, onclick: () => { c.closed = !c.closed; ED.commit(c.closed ? 'Close path' : 'Open path'); } })));
      s.append(row(h('button', { class: 'aero-btn small pri', text: 'Done', onclick: () => ED.exitPathEdit() })));
    } else if (canFlatten || isPath) {
      s.append(row(
        one && ['path', 'rect', 'ellipse', 'bool'].includes(n.type) ? h('button', { class: 'aero-btn small', text: 'Edit points', title: 'Edit anchor points (Enter); shapes are converted to vectors first', onclick: () => A.editPoints() }) : '',
        canFlatten ? h('button', { class: 'aero-btn small', text: 'Flatten', title: 'Convert to a single editable vector (Ctrl+E)', onclick: () => A.flatten() }) : ''));
    }
    if (inParent) s.append(row(checkbox('Use as mask (clips the layers above it)', ns.every(x => x.mask), c => { ns.forEach(x => { x.mask = c; }); ED.commit(c ? 'Use as mask' : 'Release mask'); })));
    if (inParent && ns.every(x => x.mask)) s.append(row(h('span', { class: 'lbl', text: 'Mask type' }), selectEl([['alpha', 'Alpha (opacity, soft edges)'], ['luminance', 'Luminance (brightness)'], ['vector', 'Vector outline (clip)']], mixed(ns, x => x.maskType || 'alpha'), v => { ns.forEach(x => { if (v === 'alpha') delete x.maskType; else x.maskType = v; }); ED.commit('Mask type'); })));
  }
  function iconSection(ns) {
    const s = section('Icon');
    const n = ns[0];
    s.append(row(h('span', { class: 'ipreview', html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${(window.LP_ICONS[ED.scene.view(n).icon] || '')}"/></svg>` }),
      selectEl(Object.keys(window.LP_ICONS).map(k => [k, k]), mixed(ns, x => ED.scene.view(x).icon), val => apply('icon', val, 'Change icon'))));
    s.append(row(colorInput(mixed(ns, x => ED.scene.view(x).color) || '#000000', 1, (c, a, live) => apply('color', c, 'Icon color', live)),
      numField('Stroke', mixed(ns, x => ED.scene.view(x).sw || 2), (val, live) => apply('sw', val, 'Icon stroke', live), { min: .25, max: 6, step: .25 })));
    const cs = ED.doc.colorStyles; if (cs.length) s.append(row(h('span', { class: 'lbl', text: 'Style' }), selectEl([['', 'Apply color style…'], ...cs.map(c => [c.id, c.name])], '', id => { const st = cs.find(c => c.id === id); if (st) apply('color', st.color, 'Icon color'); })));
  }
  function paintSection(ns, key, title) {
    const n = ns[0]; const list = ED.scene.view(n)[key] || [];
    const multiDiff = ns.length > 1 && !ns.every(x => JSON.stringify(ED.scene.view(x)[key] || []) === JSON.stringify(list));
    const s = section(title, iconBtn(ICON.plus, 'Add ' + title.toLowerCase(), () => { apply(key, x => (ED.scene.view(x)[key] || []).concat([LP.solid(list.length ? '#000000' : '#d9d9d9', list.length ? .2 : 1)]), 'Add fill'); }));
    if (multiDiff) { s.append(h('div', { class: 'dim small', text: 'Mixed — click + to replace all.' })); return; }
    list.forEach((f, i) => {
      const upd = (fn, label, live) => apply(key, x => { const arr = JSON.parse(JSON.stringify(ED.scene.view(x)[key] || [])); if (!arr[i]) return arr; fn(arr[i], arr); return arr; }, label, live);
      const r = h('div', { class: 'paint' });
      const typeSel = selectEl([['solid', 'Solid'], ['linear', 'Linear gradient'], ['radial', 'Radial gradient'], ['image', 'Image']], f.type, t => upd(p => {
        const c = p.type === 'solid' ? p.color : p.stops?.[0]?.color || '#888888';
        Object.keys(p).forEach(k => delete p[k]); p.on = true; p.type = t;
        if (t === 'solid') Object.assign(p, { color: c, a: 1 });
        else if (t === 'image') Object.assign(p, { img: null, mode: 'fill', a: 1 });
        else Object.assign(p, { angle: 180, a: 1, stops: [{ p: 0, color: c, a: 1 }, { p: 1, color: '#ffffff', a: 1 }] });
      }, 'Fill type'), { cls: 'ptype' });
      const vis = iconBtn(f.on === false ? ICON.eyeoff : ICON.eye, 'Toggle', () => upd(p => p.on = p.on === false, 'Toggle fill'));
      const del = iconBtn(ICON.x, 'Remove', () => apply(key, x => (ED.scene.view(x)[key] || []).filter((_, j) => j !== i), 'Remove fill'));
      if (f.type === 'solid') {
        const st = f.style && ED.doc.colorStyles.find(c => c.id === f.style);
        if (st) r.append(row(h('span', { class: 'chip', style: `background:${LP.rgba(st.color, st.a)}` }), h('span', { class: 'grow stylename', text: st.name }), iconBtn(ICON.unlinkStyle, 'Detach style', () => upd(p => { p.color = st.color; p.a = st.a; p.style = null; }, 'Detach style')), vis, del));
        else {
          const c = LP.fillColor(f, ED.doc);
          r.append(row(colorInput(c.color, c.a, (col, a, live) => upd(p => { p.color = col; p.a = a; p.style = null; }, 'Fill color', live)), styleMenu(id => upd(p => { const s2 = ED.doc.colorStyles.find(c2 => c2.id === id); p.style = id; p.color = s2.color; p.a = s2.a; }, 'Apply color style')), vis, del));
        }
        r.append(row(typeSel));
      } else if (f.type === 'linear' || f.type === 'radial') {
        r.append(row(typeSel, vis, del));
        r.append(gradPreview(f));
        (f.stops || []).forEach((sp, j) => r.append(row(colorInput(sp.color, sp.a ?? 1, (col, a, live) => upd(p => { p.stops[j].color = col; p.stops[j].a = a; }, 'Gradient stop', live)),
          numField('@', Math.round(sp.p * 100), (val, live) => upd(p => p.stops[j].p = val / 100, 'Gradient stop', live), { min: 0, max: 100, suffix: '%' }),
          iconBtn(ICON.x, 'Remove stop', () => upd(p => { if (p.stops.length > 2) p.stops.splice(j, 1); }, 'Remove stop')))));
        r.append(row(f.type === 'linear' ? numField('Angle', f.angle ?? 180, (val, live) => upd(p => p.angle = val, 'Gradient angle', live), { suffix: '°', wide: true }) : h('span', { class: 'grow' }),
          h('button', { class: 'aero-btn small', text: '+ Stop', onclick: () => upd(p => p.stops.push({ p: .5, color: '#888888', a: 1 }), 'Add stop') })));
      } else if (f.type === 'image') {
        r.append(row(typeSel, vis, del));
        const src = f.img && ED.doc.images[f.img];
        const th = h('div', { class: 'imgthumb', style: src ? `background-image:url("${src}")` : '' }, src ? '' : 'No image');
        th.onclick = async () => { const fl = await Aero.openFile({ accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml' }); if (!fl[0]) return; const url = await window.IO.toDataURL(fl[0]); const id = LP.newId(); ED.doc.images[id] = url; upd(p => p.img = id, 'Image fill'); };
        r.append(th);
        r.append(row(h('span', { class: 'lbl', text: 'Mode' }), selectEl([['fill', 'Fill'], ['fit', 'Fit'], ['crop', 'Crop'], ['tile', 'Tile']], f.mode || 'fill', m => upd(p => { p.mode = m; if (m === 'crop') { p.sc = p.sc || 1.3; p.ox = .5; p.oy = .5; } }, 'Image mode'))));
        if (f.mode === 'crop') r.append(row(numField('Zoom', Math.round((f.sc || 1) * 100), (val, live) => upd(p => p.sc = val / 100, 'Crop', live), { min: 100, max: 800, suffix: '%' }),
          numField('X', Math.round((f.ox ?? .5) * 100), (val, live) => upd(p => p.ox = val / 100, 'Crop', live), { min: 0, max: 100, suffix: '%' }), numField('Y', Math.round((f.oy ?? .5) * 100), (val, live) => upd(p => p.oy = val / 100, 'Crop', live), { min: 0, max: 100, suffix: '%' })));
        if (f.mode === 'tile') r.append(row(numField('Scale', Math.round((f.sc || 1) * 100), (val, live) => upd(p => p.sc = val / 100, 'Tile', live), { min: 5, max: 800, suffix: '%' })));
        r.append(row(numField('Opacity', Math.round((f.a ?? 1) * 100), (val, live) => upd(p => p.a = val / 100, 'Image opacity', live), { min: 0, max: 100, suffix: '%', wide: true })));
      }
      s.append(r);
    });
  }
  function gradPreview(f) {
    const stops = (f.stops || []).slice().sort((a, b) => a.p - b.p).map(s => `${LP.rgba(s.color, s.a ?? 1)} ${Math.round(s.p * 100)}%`).join(',');
    return h('div', { class: 'gradbar', style: `background:linear-gradient(90deg,${stops}),repeating-conic-gradient(#ccc 0 25%,#fff 0 50%) 0 0/8px 8px` });
  }
  function styleMenu(onPick) {
    const cs = ED.doc.colorStyles;
    const s = h('select', { class: 'stylepick', title: 'Apply a color style' }); s.add(new Option('◈', '')); cs.forEach(c => s.add(new Option(c.name, c.id)));
    s.onchange = () => { if (s.value) onPick(s.value); };
    if (!cs.length) s.disabled = true;
    return s;
  }
  function strokeSection(ns) {
    const n = ns[0]; const list = ED.scene.view(n).strokes || [];
    const s = section('Stroke', iconBtn(ICON.plus, 'Add stroke', () => apply('strokes', x => (ED.scene.view(x).strokes || []).concat([{ color: '#1e1e1e', a: 1, w: 1, align: x.type === 'path' ? 'center' : 'inside', on: true }]), 'Add stroke')));
    list.forEach((st, i) => {
      const upd = (fn, label, live) => apply('strokes', x => { const arr = JSON.parse(JSON.stringify(ED.scene.view(x).strokes || [])); if (arr[i]) fn(arr[i]); return arr; }, label, live);
      const sty = st.style && ED.doc.colorStyles.find(c => c.id === st.style);
      const c = LP.fillColor(st, ED.doc);
      s.append(row(sty ? h('span', { class: 'grow stylename', html: `<span class="chip" style="background:${LP.rgba(sty.color, sty.a)}"></span>${esc(sty.name)}` }) : colorInput(c.color, c.a, (col, a, live) => upd(p => { p.color = col; p.a = a; p.style = null; }, 'Stroke color', live)),
        styleMenu(id => upd(p => { const s2 = ED.doc.colorStyles.find(q => q.id === id); p.style = id; p.color = s2.color; p.a = s2.a; }, 'Stroke style')),
        iconBtn(st.on === false ? ICON.eyeoff : ICON.eye, 'Toggle', () => upd(p => p.on = p.on === false, 'Toggle stroke')), iconBtn(ICON.x, 'Remove', () => apply('strokes', x => (ED.scene.view(x).strokes || []).filter((_, j) => j !== i), 'Remove stroke'))));
      s.append(row(numField('W', st.w, (val, live) => upd(p => p.w = val, 'Stroke width', live), { min: 0, step: .5 }),
        selectEl([['inside', 'Inside'], ['center', 'Center'], ['outside', 'Outside']], st.align || 'inside', val => upd(p => p.align = val, 'Stroke align')),
        selectEl([['solid', 'Solid'], ['dash', 'Dashed'], ['dot', 'Dotted']], st.dash ? (st.dash[0] <= st.w ? 'dot' : 'dash') : 'solid', val => upd(p => { p.dash = val === 'solid' ? null : val === 'dash' ? [p.w * 4, p.w * 3] : [p.w, p.w * 2]; if (val === 'dot') p.cap = 'round'; }, 'Dash'))));
    });
  }
  function shadowSection(ns) {
    const n = ns[0]; const list = ED.scene.view(n).shadows || [];
    const s = section('Shadows', iconBtn(ICON.plus, 'Add shadow', () => apply('shadows', x => (ED.scene.view(x).shadows || []).concat([{ x: 0, y: 4, blur: 12, spread: 0, color: '#000000', a: .18, on: true }]), 'Add shadow')));
    list.forEach((sh, i) => {
      const upd = (fn, label, live) => apply('shadows', x => { const arr = JSON.parse(JSON.stringify(ED.scene.view(x).shadows || [])); if (arr[i]) fn(arr[i]); return arr; }, label, live);
      s.append(row(selectEl([['drop', 'Drop shadow'], ['inner', 'Inner shadow']], sh.inner ? 'inner' : 'drop', val => upd(p => p.inner = val === 'inner', 'Shadow type')),
        iconBtn(sh.on === false ? ICON.eyeoff : ICON.eye, 'Toggle', () => upd(p => p.on = p.on === false, 'Toggle shadow')), iconBtn(ICON.x, 'Remove', () => apply('shadows', x => (ED.scene.view(x).shadows || []).filter((_, j) => j !== i), 'Remove shadow'))));
      s.append(row(numField('X', sh.x, (val, live) => upd(p => p.x = val, 'Shadow', live)), numField('Y', sh.y, (val, live) => upd(p => p.y = val, 'Shadow', live)),
        numField('B', sh.blur, (val, live) => upd(p => p.blur = val, 'Shadow', live), { min: 0, title: 'Blur' }), numField('S', sh.spread || 0, (val, live) => upd(p => p.spread = val, 'Shadow', live), { title: 'Spread' })));
      s.append(row(colorInput(sh.color, sh.a, (col, a, live) => upd(p => { p.color = col; p.a = a; }, 'Shadow color', live))));
    });
  }
  function blurSection(ns) {
    const b = ED.scene.view(ns[0]).blur;
    const s = section('Blur');
    s.append(row(selectEl([['none', 'None'], ['layer', 'Layer blur'], ['bg', 'Background blur']], b && b.type ? b.type : 'none', val => apply('blur', val === 'none' ? null : { type: val, r: b?.r || 12, on: true }, 'Blur')),
      b ? numField('R', b.r, (val, live) => apply('blur', x => Object.assign({}, ED.scene.view(x).blur, { r: val }), 'Blur radius', live), { min: 0, max: 250 }) : h('span')));
    if (b && b.type === 'bg') s.append(h('div', { class: 'dim small', text: 'Use a semi-transparent fill to see the frosted-glass effect.' }));
  }
  function exportSection(ns) {
    const n = ns[0];
    const s = section('Export', iconBtn(ICON.plus, 'Mark for export', () => { ns.forEach(x => { if (ED.isClone(x)) return; x.exports = x.exports || []; const sc = [1, 2, 3].find(q => !x.exports.some(e => e.scale === q)) || 1; x.exports.push({ scale: sc, fmt: 'png' }); }); ED.commit('Mark for export'); }));
    if (ns.length === 1 && !ED.isClone(n)) (n.exports || []).forEach((e, i) => {
      s.append(row(selectEl([['0.5', '0.5×'], ['1', '1×'], ['1.5', '1.5×'], ['2', '2×'], ['3', '3×'], ['4', '4×']], String(e.scale), val => { e.scale = +val; ED.commit('Export scale'); }),
        selectEl([['png', 'PNG'], ['jpg', 'JPG'], ['svg', 'SVG'], ['pdf', 'PDF']], e.fmt, val => { e.fmt = val; ED.commit('Export format'); }), iconBtn(ICON.x, 'Remove', () => { n.exports.splice(i, 1); ED.commit('Unmark export'); })));
    });
    s.append(row(h('button', { class: 'aero-btn small', text: ns.length > 1 ? `Export ${ns.length} layers` : `Export ${n.name}`, onclick: () => window.IO.exportNodes(ns) })));
  }
  function docInspector() {
    inspEl.append(h('div', { class: 'ititle' }, h('span', { class: 'grow', text: ED.doc.name || 'Document' })));
    const s = section('Canvas');
    s.append(row(h('span', { class: 'lbl', text: 'Background' }), colorInput(ED.doc.bg || '#e8ecf1', 1, (c, a, live) => { ED.doc.bg = c; live ? ED.redraw() : ED.commit('Canvas color'); })));
    const ms = section('Color modes', iconBtn(ICON.plus, 'Add color mode', async () => { const name = await Aero.prompt('New color mode', 'Name', 'Mode ' + (LP.modesOf(ED.doc).length + 1)); if (!name) return; ED.doc.modes = LP.modesOf(ED.doc).slice(); let id = name.toLowerCase().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'mode'; while (ED.doc.modes.some(m => m.id === id)) id += '-2'; ED.doc.modes.push({ id, name: name.slice(0, 60) }); ED.commit('Add color mode'); }));
    LP.modesOf(ED.doc).forEach((m, i) => ms.append(row(textInput(m.name, v => { ED.doc.modes = LP.modesOf(ED.doc).slice(); ED.doc.modes[i] = Object.assign({}, m, { name: v || m.name }); ED.commit('Rename color mode'); }, 'name'), h('span', { class: 'dim small', text: i ? `${ED.doc.colorStyles.filter(c => c.modes?.[m.id]).length} styles` : 'default' }),
      i ? iconBtn(ICON.x, 'Delete mode', () => { ED.doc.modes = LP.modesOf(ED.doc).filter(x => x.id !== m.id); ED.doc.colorStyles.forEach(c => { if (c.modes) delete c.modes[m.id]; }); LP.walk(ED.doc, n => { if (n.cmode === m.id) delete n.cmode; }); ED.commit('Delete color mode'); }) : h('span'))));
    ms.append(h('div', { class: 'dim small', text: 'Give color styles a value per mode (double-click a color in Assets); artboards pick a mode; the "Set color mode" interaction switches it in the prototype.' }));
    const ab = section('New artboard');
    const g = h('div', { class: 'presets' });
    A.PRESETS.forEach(p => g.append(h('button', { class: 'preset', onclick: () => A.newArtboard(p) }, h('b', { text: p.name }), h('span', { class: 'dim', text: `${p.w} × ${p.h}` }))));
    ab.append(g);
    const st = section('Document');
    const count = { a: LP.artboards(ED.doc).length, c: A.components().length, l: Object.keys(ED.scene.byId).length - 1 };
    st.append(h('div', { class: 'dim', text: `${count.a} artboards · ${count.c} components · ${count.l} layers · ${ED.doc.colorStyles.length} colors · ${ED.doc.textStyles.length} text styles` }));
    st.append(h('div', { class: 'dim small', style: 'margin-top:8px', html: 'Tip: drag with the <b>Artboard</b> tool (A), or pick a device preset above. Hold <b>Space</b> to pan, <b>Ctrl+wheel</b> to zoom.' }));
  }

  /* ---------- prototype inspector ---------- */
  const TRIGGERS = [['tap', 'Tap / click'], ['drag', 'On drag'], ['swipe', 'Swipe'], ['hover', 'While hovering'], ['press', 'While pressing'], ['delay', 'After delay'], ['key', 'Key press']];
  const ACTIONS = [['navigate', 'Navigate to'], ['overlay', 'Open overlay'], ['back', 'Back'], ['scrollTo', 'Scroll to'], ['changeTo', 'Change to (variant)'], ['setVar', 'Set variable'], ['setMode', 'Set color mode']];
  const TRANS = [['instant', 'Instant'], ['dissolve', 'Dissolve'], ['smart', 'Smart animate'], ['slideLeft', 'Slide in ←'], ['slideRight', 'Slide in →'], ['slideUp', 'Slide in ↑'], ['slideDown', 'Slide in ↓'], ['pushLeft', 'Push ←'], ['pushRight', 'Push →'], ['pushUp', 'Push ↑'], ['pushDown', 'Push ↓']];
  const EASES = [['linear', 'Linear'], ['ease-in', 'Ease in'], ['ease-out', 'Ease out'], ['ease-in-out', 'Ease in & out'], ['snap', 'Snap'], ['spring', 'Spring']];
  const CMPS = [['==', '='], ['!=', '≠'], ['>', '>'], ['<', '<'], ['>=', '≥'], ['<=', '≤']];
  const VTYPES = [['bool', 'Boolean'], ['num', 'Number'], ['str', 'String']];
  P.TRANS = TRANS;
  const varName = id => (ED.doc.vars || []).find(v => v.id === id)?.name || '—';
  // value editor matching a variable's type
  function varValueInput(def, val, onSet) {
    if (!def || def.type === 'bool') return selectEl([['true', 'true'], ['false', 'false']], String(LP.coerceVar('bool', val)), v => onSet(v === 'true'));
    if (def.type === 'num') return numField('=', Number(val) || 0, v => onSet(v), { step: 1 });
    return textInput(String(val ?? ''), v => onSet(v), 'text');
  }
  // condition row {v, op, val}; onSet(null) removes it
  function condRow(label, c, onSet) {
    const vars = ED.doc.vars || [];
    if (!c) return row(h('span', { class: 'lbl', text: label }), h('button', { class: 'aero-btn small', text: '+ Condition', disabled: !vars.length, title: vars.length ? 'Only when a variable matches' : 'Create a variable first (Prototype tab, nothing selected)', onclick: () => onSet({ v: vars[0].id, op: '==', val: vars[0].type === 'bool' ? true : vars[0].value }) }));
    const def = vars.find(v => v.id === c.v);
    return row(h('span', { class: 'lbl', text: label }), selectEl(vars.map(v => [v.id, v.name]), c.v, id => onSet(Object.assign({}, c, { v: id }))),
      selectEl(def && def.type !== 'num' ? CMPS.slice(0, 2) : CMPS, c.op || '==', op => onSet(Object.assign({}, c, { op }))),
      varValueInput(def, c.val, val => onSet(Object.assign({}, c, { val }))), iconBtn(ICON.x, 'Remove condition', () => onSet(null)));
  }
  function varsSection() {
    const s = section('Variables', iconBtn(ICON.plus, 'Add variable', () => { const vars = ED.doc.vars = ED.doc.vars || []; vars.push({ id: LP.newId(), name: 'variable' + (vars.length + 1), type: 'bool', value: false }); ED.commit('Add variable'); }));
    const vars = ED.doc.vars || [];
    if (!vars.length) s.append(h('div', { class: 'dim small', text: 'Booleans, numbers and strings that interactions can set ("Set variable"), that can show / hide layers ("Visible when") and that text can display.' }));
    vars.forEach((v, i) => {
      const set = (fn, label) => { fn(v); ED.commit(label); };
      s.append(row(textInput(v.name, val => set(x => { x.name = val || x.name; }, 'Rename variable'), 'name'),
        selectEl(VTYPES, v.type, t => set(x => { x.type = t; x.value = LP.coerceVar(t, x.value); }, 'Variable type')),
        varValueInput(v, v.value, val => set(x => { x.value = LP.coerceVar(x.type, val); }, 'Variable value')),
        iconBtn(ICON.x, 'Delete variable', () => { vars.splice(i, 1); ED.commit('Delete variable'); })));
    });
  }
  function protoInspector() {
    const ns = sel();
    if (ns.length !== 1) {
      inspEl.append(h('div', { class: 'ititle' }, h('span', { class: 'grow', text: 'Prototype' })));
      const s = section('Flows');
      const flows = LP.flowStarts(ED.doc);
      if (!flows.length) s.append(h('div', { class: 'dim small', text: 'Select an artboard and tick "Flow starting point". Without one, preview starts at the first artboard.' }));
      flows.forEach(f => s.append(row(h('span', { class: 'ticon', html: ICON.home }), h('span', { class: 'grow', text: `${f.flowStart} → ${f.name}` }), h('button', { class: 'aero-btn small', text: '▶', title: 'Preview this flow', onclick: () => window.APP.preview(f.id) }))));
      varsSection();
      const h2 = section('How to');
      h2.append(h('div', { class: 'dim small', html: 'Select a layer, then drag the <b style="color:#1f8bff">●</b> handle onto an artboard to create a tap → navigate interaction. Edit trigger, action and transition here. Press <b>Ctrl+Enter</b> to preview.' }));
      return;
    }
    const n = ns[0], v = ED.scene.view(n), clone = ED.isClone(n);
    inspEl.append(h('div', { class: 'ititle' }, h('span', { class: 'ticon', html: typeIcon(n) }), h('span', { class: 'grow', text: n.name })));
    if (ED.isArtboard(n)) {
      const s = section('Artboard');
      s.append(row(checkbox('Flow starting point', !!n.flowStart, c => { n.flowStart = c ? (n.name.replace(/\s+\d+$/, '') + ' flow') : null; ED.commit('Flow start'); })));
      if (n.flowStart) s.append(row(h('span', { class: 'lbl', text: 'Flow name' }), textInput(n.flowStart, val => { n.flowStart = val || 'Flow'; ED.commit('Rename flow'); })));
      s.append(row(numField('Viewport W', n.viewportW || 0, (val) => { n.viewportW = val > 0 ? val : null; ED.commit('Viewport width'); }, { min: 0, title: 'Visible width in preview; wider artboards scroll horizontally (0 = no scrolling)' }),
        numField('Viewport H', n.viewportH || 0, (val) => { n.viewportH = val > 0 ? val : null; ED.commit('Viewport height'); }, { min: 0, title: 'Visible height in preview; taller artboards scroll vertically (0 = no scrolling)' })));
      const sx = n.viewportW && n.viewportW < n.w ? Math.round(n.w - n.viewportW) : 0, sy = n.viewportH && n.viewportH < n.h ? Math.round(n.h - n.viewportH) : 0;
      s.append(h('div', { class: 'dim small', text: sx || sy ? `Scrolls ${sy ? sy + 'px vertically' : ''}${sx && sy ? ' and ' : ''}${sx ? sx + 'px horizontally' : ''} in preview.` : 'Set a viewport smaller than the artboard to make the screen scroll.' }));
    } else if (!clone) {
      const s = section('Scrolling');
      if (ED.isArtboard(ED.parent(n))) s.append(row(checkbox('Fix position when scrolling', !!n.fixed, c => { n.fixed = c; ED.commit('Fixed position'); })));
      if (n.type === 'frame' || n.type === 'instance') {
        s.append(row(h('span', { class: 'lbl', text: 'Overflow' }), selectEl([['', 'No scrolling'], ['v', 'Vertical scrolling'], ['h', 'Horizontal scrolling'], ['both', 'Both directions']], n.scroll || '', val => { if (val) { n.scroll = val; if (n.type === 'frame') n.clip = true; } else delete n.scroll; ED.commit('Overflow scrolling'); })));
        if (n.scroll) { const R = LP.scrollRange(ED.scene, n); s.append(h('div', { class: 'dim small', text: R.x || R.y ? `Content scrolls ${R.y ? Math.round(R.y) + 'px vertically' : ''}${R.x && R.y ? ', ' : ''}${R.x ? Math.round(R.x) + 'px horizontally' : ''} (drag or wheel in preview).` : 'Content fits — make children extend past the frame to scroll.' })); }
      }
      if (!s.querySelector('.irow')) s.remove();
    }
    // conditional visibility & text binding
    if (!ED.isArtboard(n)) {
      const s = section('Variables');
      s.append(condRow('Visible when', v.showIf || null, c => { if (c) ED.setProp(n, 'showIf', c); else { ED.setProp(n, 'showIf', null); delete n.showIf; } ED.commit('Conditional visibility'); }));
      if ((v.mainType || n.type) === 'text') s.append(row(h('span', { class: 'lbl', text: 'Text shows' }), selectEl([['', 'its own text'], ...(ED.doc.vars || []).map(x => [x.id, 'variable: ' + x.name])], v.bindText || '', id => { ED.setProp(n, 'bindText', id || null); if (!id) delete n.bindText; ED.commit('Bind text'); })));
    }
    const own = (clone ? v.proto : (n.type === 'instance' ? n.proto : n.proto)) || [];
    const inherited = n.type === 'instance' ? (v.proto || []).filter(p => !own.includes(p) && !(n.proto || []).some(q => q.trigger === p.trigger)) : [];
    const s = section('Interactions', iconBtn(ICON.plus, 'Add interaction', () => { const list = JSON.parse(JSON.stringify(own)); list.push({ trigger: 'tap', action: 'navigate', target: null, trans: 'dissolve', ease: 'ease-out', dur: 300 }); if (!ED.setProp(n, 'proto', list)) return Aero.toast('Edit interactions of instance contents on the main component'); ED.commit('Add interaction'); }));
    if (!own.length && !inherited.length) s.append(h('div', { class: 'dim small', text: 'No interactions. Click + or drag the blue handle to an artboard.' }));
    own.forEach((p, i) => s.append(interactionCard(n, p, i, own)));
    if (n.component && own.some(p => p.trigger === 'hover' || p.trigger === 'press')) s.append(h('div', { class: 'dim small', style: 'margin-top:6px', text: 'Interactive component: these interactions work in every instance.' }));
    if (inherited.length) { s.append(h('div', { class: 'dim small', style: 'margin-top:6px', text: 'From main component (interactive component):' })); inherited.forEach(p => s.append(h('div', { class: 'icard inh', text: `${(TRIGGERS.find(t => t[0] === p.trigger) || [, p.trigger])[1]} → ${(ACTIONS.find(a => a[0] === p.action) || [, p.action])[1]} ${p.action === 'setVar' ? varName(p.v) : p.target && ED.get(p.target) ? ED.get(p.target).component?.variant || ED.get(p.target).name : ''}` }))); }
  }
  function interactionCard(n, p, i, list) {
    const card = h('div', { class: 'icard' });
    const upd = (fn, label) => { const l = JSON.parse(JSON.stringify(list)); fn(l[i]); ED.setProp(n, 'proto', l); ED.commit(label); };
    card.append(row(h('span', { class: 'lbl', text: 'Trigger' }), selectEl(TRIGGERS, p.trigger, val => upd(q => { q.trigger = val; if (val === 'swipe' && !q.dir) q.dir = 'left'; }, 'Trigger')), iconBtn(ICON.x, 'Remove interaction', () => { const l = list.filter((_, j) => j !== i); ED.setProp(n, 'proto', l); ED.commit('Remove interaction'); })));
    if (p.trigger === 'delay') card.append(row(numField('Delay', p.delay ?? 1000, val => upd(q => q.delay = val, 'Delay'), { min: 0, suffix: 'ms', wide: true })));
    if (p.trigger === 'swipe') card.append(row(h('span', { class: 'lbl', text: 'Direction' }), selectEl([['left', '← Left'], ['right', '→ Right'], ['up', '↑ Up'], ['down', '↓ Down'], ['any', 'Any direction']], p.dir || 'left', val => upd(q => q.dir = val, 'Swipe direction'))));
    if (p.trigger === 'key') { const k = h('input', { type: 'text', value: p.key || '', placeholder: 'Press a key…', readonly: true, class: 'keycap' }); k.onkeydown = e => { e.preventDefault(); e.stopPropagation(); upd(q => q.key = e.key === ' ' ? 'Space' : e.key, 'Key'); }; card.append(row(h('span', { class: 'lbl', text: 'Key' }), k)); }
    card.append(row(h('span', { class: 'lbl', text: 'Action' }), selectEl(ACTIONS, p.action, val => upd(q => { q.action = val; q.target = null; if (val === 'changeTo') q.trans = 'smart'; if (val === 'setVar') { const v0 = (ED.doc.vars || [])[0]; q.v = v0 ? v0.id : null; q.vop = v0 && v0.type === 'bool' ? 'toggle' : 'set'; q.val = v0 ? v0.value : null; q.trans = 'smart'; } if (val === 'setMode') { q.mode = 'toggle'; q.trans = 'dissolve'; } }, 'Action'))));
    let dests = null;
    if (p.action === 'navigate' || p.action === 'overlay') dests = LP.artboards(ED.doc).filter(a => a !== ED.scene.top(n) || p.action === 'overlay').map(a => [a.id, a.name]);
    if (p.action === 'scrollTo') { const top = ED.scene.top(n); dests = []; const walk = (x, d) => ED.kids(x).forEach(k => { if (!ED.isClone(k)) { dests.push([k.id, '  '.repeat(d) + k.name]); walk(k, d + 1); } }); if (top) walk(top, 0); }
    if (p.action === 'changeTo') { const main = n.type === 'instance' ? A.mainOf(n) : (n.component ? n : null); dests = main ? A.variantsOf(main).map(c => [c.id, c.component.variant || c.name]) : []; if (!main) card.append(h('div', { class: 'dim small', text: 'Change to works on component instances (or on a main component, for interactive components).' })); }
    if (dests) card.append(row(h('span', { class: 'lbl', text: 'Destination' }), selectEl([['', '— choose —'], ...dests], p.target || '', val => upd(q => q.target = val || null, 'Destination'))));
    if (p.action === 'setVar') {
      const vars = ED.doc.vars || [], def = vars.find(x => x.id === p.v);
      if (!vars.length) card.append(h('div', { class: 'dim small', text: 'No variables yet — add one in the Prototype tab with nothing selected.' }));
      else {
        card.append(row(h('span', { class: 'lbl', text: 'Variable' }), selectEl(vars.map(x => [x.id, x.name]), p.v || '', id => upd(q => { q.v = id; const d = vars.find(x => x.id === id); q.val = d ? d.value : null; }, 'Variable'))));
        const ops = def && def.type === 'bool' ? [['set', 'Set to'], ['toggle', 'Toggle']] : def && def.type === 'num' ? [['set', 'Set to'], ['add', 'Increase by'], ['sub', 'Decrease by']] : [['set', 'Set to'], ['add', 'Append']];
        card.append(row(selectEl(ops, p.vop || 'set', val => upd(q => q.vop = val, 'Variable operation')), p.vop === 'toggle' ? h('span', { class: 'grow' }) : varValueInput(def, p.val, val => upd(q => q.val = val, 'Variable value'))));
      }
    }
    if (p.action === 'setMode') card.append(row(h('span', { class: 'lbl', text: 'Mode' }), selectEl([['toggle', 'Next mode (cycle)'], ...LP.modesOf(ED.doc).map(m => [m.id, m.name])], p.mode || 'toggle', val => upd(q => q.mode = val, 'Color mode'))));
    if (p.action === 'overlay') card.append(row(h('span', { class: 'lbl', text: 'Position' }), selectEl([['center', 'Center'], ['top', 'Top'], ['bottom', 'Bottom']], p.overlayPos || 'center', val => upd(q => q.overlayPos = val, 'Overlay position')), checkbox('Dim', p.dim !== false, c => upd(q => q.dim = c, 'Overlay dim'))));
    card.append(row(h('span', { class: 'lbl', text: 'Animation' }), selectEl(TRANS, p.trans || 'instant', val => upd(q => q.trans = val, 'Transition'))));
    if ((p.trans || 'instant') !== 'instant' || p.action === 'scrollTo') card.append(row(selectEl(EASES, p.ease || 'ease-out', val => upd(q => q.ease = val, 'Easing')), numField('ms', p.dur ?? 300, val => upd(q => q.dur = val, 'Duration'), { min: 0, max: 10000, step: 10 })));
    card.append(condRow('Only if', p.cond || null, c => upd(q => { if (c) q.cond = c; else delete q.cond; }, 'Condition')));
    return card;
  }

  /* ---------- inspect (dev handoff) ---------- */
  let codeLang = 'css';
  function devInspector() {
    const ns = sel();
    if (!ns.length) {
      inspEl.append(h('div', { class: 'ititle' }, h('span', { class: 'grow', text: 'Inspect' })));
      const s = section('Dev handoff');
      s.append(h('div', { class: 'dim small', html: 'Click a layer to see its CSS / SwiftUI / Compose code. Hover other layers to measure distances. Layers marked for export can be batch-exported as a ZIP.' }));
      s.append(row(h('button', { class: 'aero-btn small', text: 'Export all marked (ZIP)', onclick: () => window.IO.batchExport() })));
      const marked = Object.values(ED.scene.byId).filter(n => n.exports?.length && !ED.isClone(n));
      s.append(h('div', { class: 'dim small', text: `${marked.length} layer(s) marked for export.` }));
      return;
    }
    const n = ns[0], v = ED.scene.view(n);
    inspEl.append(h('div', { class: 'ititle' }, h('span', { class: 'ticon', html: typeIcon(n) }), h('span', { class: 'grow', text: n.name })));
    const g = section('Properties');
    const b = ED.wbox(n), par = ED.parent(n), top = ED.scene.top(n);
    const rel = par && par !== ED.doc ? ED.wbox(top) : { x: 0, y: 0 };
    const kv = (k, val) => g.append(h('div', { class: 'kv' }, h('span', { class: 'k', text: k }), h('span', { class: 'v mono', text: val })));
    kv('Size', `${ED.fmt(n.w)} × ${ED.fmt(n.h)}`); kv('Position', `${ED.fmt(b.x - rel.x)}, ${ED.fmt(b.y - rel.y)}${top && top !== n ? ' in ' + top.name : ''}`);
    if (n.r) kv('Rotation', ED.fmt(n.r) + '°'); if ((v.opacity ?? 1) < 1) kv('Opacity', Math.round(v.opacity * 100) + '%');
    if (v.radius && v.radius.some(r => r)) kv('Radius', v.radius.join(' '));
    if (n.type === 'text') { const t = LP.textProps(v, ED.doc); kv('Font', `${t.font} ${t.weight}${t.italic ? ' italic' : ''}`); kv('Size / line', `${t.size}px / ${LP.lineHeight(t)}px`); if (t.ls) kv('Letter spacing', t.ls + 'px'); const st = v.textStyleId && ED.doc.textStyles.find(s => s.id === v.textStyleId); if (st) kv('Text style', st.name); }
    (v.fills || []).filter(f => f.on !== false).forEach(f => { const st = f.style && ED.doc.colorStyles.find(s => s.id === f.style); kv('Fill', f.type === 'solid' ? `${LP.rgba(LP.fillColor(f, ED.doc).color, LP.fillColor(f, ED.doc).a)}${st ? ' (' + st.name + ')' : ''}` : f.type); });
    const tabs = h('div', { class: 'aero-tabs codetabs' });
    [['css', 'CSS'], ['swift', 'SwiftUI'], ['android', 'Compose']].forEach(([k, t]) => { const tb = h('div', { class: 'aero-tab' + (codeLang === k ? ' on' : ''), text: t }); tb.onclick = () => { codeLang = k; renderInspector(); }; tabs.append(tb); });
    const cs = section('Code', iconBtn(ICON.copy, 'Copy code', () => { navigator.clipboard?.writeText(code).then(() => Aero.toast('Code copied'), () => Aero.toast('Copy failed')); }));
    const code = window.CODEGEN[codeLang](n, v);
    cs.append(tabs, h('pre', { class: 'code', text: code }));
    exportSection(ns);
  }
})();
