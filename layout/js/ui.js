'use strict';
/* Lumen Layout — UI: menus, toolbox, context command bar, Properties / Layers / Styles / History panels,
   Pages panel with live thumbnails, dialogs and all editing commands. */
const UI = (() => {
  const el = Aero.el, esc = Aero.esc;
  let toolbox = null, settingTool = false;
  const U = () => S.doc.units;
  const info = id => S.eng.idx.get(id);
  const selItems = () => S.sel.map(info).filter(Boolean).map(i => i.item);
  const T = () => Tools.T;

  /* ---------- tools ---------- */
  const ICON = {
    select: '<path d="M6 3l12 9-5.5 1 3 6-2.4 1.1-3-6L6 17z" fill="#fff"/>',
    direct: '<path d="M6 3l12 9-5.5 1 3 6-2.4 1.1-3-6L6 17z" fill="#0d2740"/>',
    type: '<path d="M5 5h14M12 5v14M9 19h6"/>',
    frame: '<rect x="4" y="5" width="16" height="14"/><path d="M4 5l16 14M20 5 4 19"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>',
    line: '<path d="M5 19 19 5"/>',
    hand: '<path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11V4.5a1.5 1.5 0 0 1 3 0V11V6a1.5 1.5 0 0 1 3 0v8c0 4-2.5 6-6 6-2.6 0-4-1-5.5-3L5 14a1.5 1.5 0 0 1 2.5-1.6z"/>',
    zoom: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5M10.5 8v5"/>',
  };
  function setTool(id, keepEdit) {
    if (settingTool) return; settingTool = true;
    if (S.edit && id !== 'type' && !keepEdit) T().exit();
    if (id !== 'direct' && id !== 'select') S.content = null;
    S.tool = id; toolbox?.set(id); settingTool = false;
    S.loadedThread = null;
    $('#ov').style.cursor = ''; requestRender(); refresh(true);
  }

  /* ---------- text formatting commands ---------- */
  function textTargets() {
    if (S.edit) { const s = S.doc.stories[S.edit.sid]; const [a, b] = T().range(); return s ? [{ s, a, b, caret: a === b }] : []; }
    const seen = new Set(), out = [];
    for (const it of selItems()) M.walkItems([it], x => { if (x.type === 'text' && !seen.has(x.story) && S.doc.stories[x.story]) { seen.add(x.story); const s = S.doc.stories[x.story]; out.push({ s, a: 0, b: s.text.length }); } });
    return out;
  }
  function charState() {
    const t = textTargets()[0]; if (!t) return null;
    const s = t.s, pos = t.caret ? t.a : t.a;
    const pi = M.paraIndexAt(s, pos), pe = M.paraEff(S.doc, s.paras[pi]);
    let attr = t.caret ? (S.edit.typing || s.attrs[s.ca[pos - 1] ?? s.ca[pos] ?? 0] || {}) : (s.attrs[s.ca[pos] ?? 0] || {});
    if (t.caret && pos > 0 && s.text[pos - 1] === '\n' && !S.edit.typing) attr = s.attrs[s.ca[pos] ?? s.ca[pos - 1] ?? 0] || {};
    return { ...M.charEff(S.doc, pe, attr), ps: s.paras[pi].ps, cs: attr.cs || '', para: s.paras[pi], pe };
  }
  function applyChar(props, label = 'Character Format') {
    const ts = textTargets(); if (!ts.length) return;
    if (ts.length === 1 && ts[0].caret) { const cur = charState(); const base = S.edit.typing || (T().attrAt(ts[0].a)); S.edit.typing = clean({ ...base, ...props }); refresh(); return; }
    for (const { s, a, b } of ts) for (let i = a; i < b; i++) s.ca[i] = M.attrIdx(s, clean({ ...s.attrs[s.ca[i]], ...props }));
    commit(label);
  }
  function clean(o) { const r = {}; for (const k in o) if (o[k] !== null && o[k] !== undefined) r[k] = o[k]; return r; }
  function applyPara(props, label = 'Paragraph Format') {
    const ts = textTargets(); if (!ts.length) return;
    for (const { s, a, b } of ts) { const p0 = M.paraIndexAt(s, a), p1 = M.paraIndexAt(s, b); for (let k = p0; k <= p1; k++) s.paras[k] = clean({ ...s.paras[k], ...props }); }
    commit(label);
  }
  function applyParaStyle(id) {
    const ts = textTargets(); if (!ts.length) { Aero.toast('Select text or a text frame first'); return; }
    for (const { s, a, b } of ts) { const p0 = M.paraIndexAt(s, a), p1 = M.paraIndexAt(s, b); for (let k = p0; k <= p1; k++) s.paras[k] = { ps: id }; }
    commit('Apply Paragraph Style');
  }
  function applyCharStyle(id) {
    const ts = textTargets(); if (!ts.length) { Aero.toast('Select text first'); return; }
    const st = id ? S.doc.charStyles[id] : null;
    const strip = a => { const o = { ...a }; if (st) for (const k in st) if (k !== 'name') delete o[k]; if (id) o.cs = id; else delete o.cs; return o; };
    if (ts.length === 1 && ts[0].caret) { S.edit.typing = strip(T().attrAt(ts[0].a)); refresh(); return; }
    for (const { s, a, b } of ts) for (let i = a; i < b; i++) s.ca[i] = M.attrIdx(s, strip(s.attrs[s.ca[i]]));
    commit('Apply Character Style');
  }
  // current style values for a "new style from selection"
  function styleFromSelection() {
    const c = charState(); if (!c) return {};
    const o = {}; for (const k of [...M.CHAR_KEYS, ...M.PARA_KEYS]) o[k] = c[k]; return o;
  }

  /* ---------- object commands ---------- */
  function deleteSel() {
    if (S.edit) return;
    if (!S.sel.length) return;
    for (const id of [...S.sel]) Tools.removeItemById(id);
    S.sel = []; S.content = null; commit('Delete');
  }
  function topLevelSel() { return S.sel.map(info).filter(i => i && !i.parent); }
  function arrange(how) {
    const infs = topLevelSel(); if (!infs.length) return;
    const byPage = new Map(); infs.forEach(i => { const a = byPage.get(i.page) || []; a.push(i.item); byPage.set(i.page, a); });
    for (const [page, items] of byPage) {
      const arr = page.items;
      if (how === 'front') { items.forEach(it => arr.splice(arr.indexOf(it), 1)); arr.push(...items); }
      else if (how === 'back') { items.forEach(it => arr.splice(arr.indexOf(it), 1)); arr.unshift(...items); }
      else if (how === 'forward') { for (const it of [...items].reverse()) { const k = arr.indexOf(it); if (k < arr.length - 1 && !items.includes(arr[k + 1])) { arr.splice(k, 1); arr.splice(k + 1, 0, it); } } }
      else if (how === 'backward') { for (const it of items) { const k = arr.indexOf(it); if (k > 0 && !items.includes(arr[k - 1])) { arr.splice(k, 1); arr.splice(k - 1, 0, it); } } }
    }
    commit('Arrange');
  }
  function group() {
    const infs = topLevelSel(); if (infs.length < 2) { Aero.toast('Select two or more objects to group'); return; }
    const page = infs[0].page; if (infs.some(i => i.page !== page)) { Aero.toast('Objects must be on the same page to group'); return; }
    const items = page.items.filter(it => infs.some(i => i.item === it));
    const k = Math.max(...items.map(it => page.items.indexOf(it)));
    const g = { id: 'I' + M.uid(), type: 'group', children: items, layer: items[items.length - 1].layer, opacity: 1, rot: 0, x: 0, y: 0, w: 0, h: 0 };
    Geo.syncGroup(g);
    page.items.splice(k + 1, 0, g); page.items = page.items.filter(it => !items.includes(it));
    S.sel = [g.id]; commit('Group');
  }
  function ungroup() {
    const gs = topLevelSel().filter(i => i.item.type === 'group'); if (!gs.length) return;
    const ns = [];
    for (const { item: g, page } of gs) { const k = page.items.indexOf(g); page.items.splice(k, 1, ...g.children); ns.push(...g.children.map(c => c.id)); }
    S.sel = ns; commit('Ungroup');
  }
  function align(how) {
    const infs = S.sel.map(info).filter(Boolean); if (!infs.length) return;
    let ref;
    if (infs.length === 1) { const pp = placedOf(infs[0].page); const m = S.eng.marginsFor(pp.kind, pp.kind === 'doc' ? pp.index : pp.side); ref = { x: pp.x + m.l, y: pp.y + m.t, w: pp.w - m.l - m.r, h: pp.h - m.t - m.b }; }
    else ref = Tools.selBox();
    for (const i of infs) {
      const b = Tools.worldBox(i.item.id); let dx = 0, dy = 0;
      if (how === 'left') dx = ref.x - b.x; if (how === 'hcenter') dx = ref.x + ref.w / 2 - (b.x + b.w / 2); if (how === 'right') dx = ref.x + ref.w - (b.x + b.w);
      if (how === 'top') dy = ref.y - b.y; if (how === 'vcenter') dy = ref.y + ref.h / 2 - (b.y + b.h / 2); if (how === 'bottom') dy = ref.y + ref.h - (b.y + b.h);
      Tools.moveTo(i.item, structuredClone(i.item), dx, dy); if (i.parent) Geo.syncGroup(i.parent);
    }
    commit('Align');
  }
  function distribute(axis) {
    const infs = S.sel.map(info).filter(Boolean); if (infs.length < 3) { Aero.toast('Select three or more objects to distribute'); return; }
    const bs = infs.map(i => ({ i, b: Tools.worldBox(i.item.id) })).sort((p, q) => axis === 'h' ? p.b.x + p.b.w / 2 - q.b.x - q.b.w / 2 : p.b.y + p.b.h / 2 - q.b.y - q.b.h / 2);
    const c = x => axis === 'h' ? x.b.x + x.b.w / 2 : x.b.y + x.b.h / 2;
    const c0 = c(bs[0]), c1 = c(bs[bs.length - 1]), step = (c1 - c0) / (bs.length - 1);
    bs.forEach((x, k) => { const d = c0 + k * step - c(x); Tools.moveTo(x.i.item, structuredClone(x.i.item), axis === 'h' ? d : 0, axis === 'v' ? d : 0); });
    commit('Distribute');
  }
  function nudge(dx, dy) {
    if (S.edit || !S.sel.length) return;
    for (const i of S.sel.map(info)) { Tools.moveTo(i.item, structuredClone(i.item), dx, dy); if (i.parent) Geo.syncGroup(i.parent); }
    commit('Nudge');
  }
  function copyItems(cut) {
    const infs = topLevelSel(); if (!infs.length) return false;
    const stories = {}; infs.forEach(i => M.walkItems([i.item], it => { if (it.type === 'text') stories[it.story] = structuredClone(S.doc.stories[it.story]); }));
    S.clip = { items: infs.map(i => structuredClone(i.item)), stories, page: infs[0].page.id };
    if (cut) { infs.forEach(i => Tools.removeItemById(i.item.id)); S.sel = []; commit('Cut'); }
    return true;
  }
  function pasteItems(inPlace) {
    if (!S.clip) return;
    const pp = curPlaced(); const same = S.clip.page === pp.page.id && !inPlace;
    // temporarily register clipboard stories so cloneItems can copy them
    const added = []; for (const [id, s] of Object.entries(S.clip.stories)) if (!S.doc.stories[id]) { S.doc.stories[id] = structuredClone(s); added.push(id); }
    const cl = Tools.cloneItems(S.clip.items, same ? 12 : 0, same ? 12 : 0);
    added.forEach(id => delete S.doc.stories[id]);
    cl.forEach(c => { c.layer = S.doc.layers.find(l => l.id === c.layer) ? c.layer : S.activeLayer; });
    // stories created by clone keep a frames list; drop frames not pasted (none) — fine
    pp.page.items.push(...cl); S.sel = cl.map(c => c.id); commit('Paste');
  }
  function lockSel(v) { for (const it of selItems()) it.locked = v; if (v) S.sel = []; commit(v ? 'Lock' : 'Unlock'); }
  function unlockAll() { for (const pp of S.placed) M.walkItems(pp.page.items, it => { it.locked = false; }); commit('Unlock All on Spread'); }
  function fitImage(mode) {
    const its = selItems().filter(i => i.type === 'image' && i.img); if (!its.length) { Aero.toast('Select an image frame with an image'); return; }
    its.forEach(it => { Tools.applyFit(it, mode); if (mode === 'fit' || mode === 'fill') it.fit = null; });
    commit({ fit: 'Fit Content Proportionally', fill: 'Fill Frame Proportionally', center: 'Center Content', frame: 'Fit Frame to Content' }[mode]);
  }
  function setWrap(v) { for (const it of selItems()) it.wrap = v; commit('Text Wrap'); }

  /* placeholder text */
  const LOREM = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer vitae libero ac risus egestas placerat. Curabitur nec elit eu nisl tempor vehicula. Mauris porta nibh in sem gravida, at feugiat erat porttitor. Vivamus sagittis lacus vel augue laoreet rutrum faucibus dolor auctor. Donec ullamcorper nulla non metus auctor fringilla. Nullam quis risus eget urna mollis ornare vel eu leo. Maecenas faucibus mollis interdum. Sed posuere consectetur est at lobortis. Cras mattis consectetur purus sit amet fermentum. Aenean lacinia bibendum nulla sed consectetur. Etiam porta sem malesuada magna mollis euismod. Praesent commodo cursus magna, vel scelerisque nisl consectetur et. Duis mollis, est non commodo luctus, nisi erat porttitor ligula, eget lacinia odio sem nec elit. Vestibulum id ligula porta felis euismod semper. Fusce dapibus, tellus ac cursus commodo, tortor mauris condimentum nibh, ut fermentum massa justo sit amet risus.';
  function fillPlaceholder() {
    let it = S.edit ? info(S.edit.fid)?.item : selItems().find(i => i.type === 'text');
    if (!it) { Aero.toast('Select a text frame first'); return; }
    const s = S.doc.stories[it.story];
    const sentences = LOREM.match(/[^.]+\./g).map(x => x.trim());
    let k = 0, guard = 0, start = s.text.length;
    if (start && s.text[start - 1] !== '\n') { M.insertText(s, start, '\n'); start++; }
    const eng = () => { const e = new Engine(S.doc); e.ensure(); return e.storyRes.get(s.id) || (e.frameLayout(it, '1')?.res); };
    while (guard++ < 400) {
      const before = s.text.length;
      const sn = (k % 5 === 4 ? '\n' : (s.text.length > start && s.text[s.text.length - 1] !== '\n' ? ' ' : '')) + sentences[k % sentences.length];
      M.insertText(s, s.text.length, sn); k++;
      const r = eng();
      if (r && r.overset) { M.deleteRange(s, before, s.text.length); break; }
    }
    if (S.edit) { S.edit.a = S.edit.f = s.text.length; }
    commit('Fill with Placeholder Text');
  }
  function insertSpecial(ch, label) { if (!S.edit) { Aero.toast('Place the text cursor first'); return; } T().insert(ch); commit(label); }

  /* ---------- pages ---------- */
  function addPage(after = S.curPage, dup = false) {
    const src = S.doc.pages[after];
    let p;
    if (dup && src) {
      p = M.newPage(src.master); p.guides = structuredClone(src.guides);
      // clone items, re-threading stories wholly contained in the page
      p.items = Tools.cloneItems(src.items);
    } else p = M.newPage(src ? src.master : (S.doc.masters[0]?.id || null));
    S.doc.pages.splice(after + 1, 0, p); S.curPage = after + 1;
    commit(dup ? 'Duplicate Page' : 'Add Page'); requestAnimationFrame(() => { if (S.mode.kind === 'doc') View.goPage(S.curPage); });
  }
  async function deletePage(i = S.curPage) {
    if (S.doc.pages.length <= 1) { Aero.toast('A document needs at least one page'); return; }
    const p = S.doc.pages[i];
    if (p.items.length && !(await Aero.confirm('Delete Page', `Page ${i + 1} contains ${p.items.length} object(s). Delete it anyway?`, 'Delete'))) return;
    M.walkItems(p.items, it => { if (it.type === 'text') { const s = S.doc.stories[it.story]; if (s) { s.frames = s.frames.filter(f => f !== it.id); if (!s.frames.length) delete S.doc.stories[s.id]; } } });
    S.doc.pages.splice(i, 1); S.curPage = Math.min(i, S.doc.pages.length - 1); S.sel = []; S.edit = null;
    commit('Delete Page');
  }
  function movePage(from, to) {
    if (from === to || from < 0 || to < 0 || to >= S.doc.pages.length) return;
    const [p] = S.doc.pages.splice(from, 1); S.doc.pages.splice(to, 0, p); S.curPage = to;
    // keep story frame order in page order
    commit('Move Page');
  }
  async function insertPagesDialog() {
    Aero.dialog({ title: 'Insert Pages', fields: [{ key: 'n', label: 'Pages', type: 'number', value: 1, min: 1, max: 100 }, { key: 'where', label: 'Insert', type: 'select', value: 'after', options: [['after', 'After current page'], ['before', 'Before current page'], ['end', 'At end of document'], ['start', 'At start of document']] },
      { key: 'm', label: 'Master', type: 'select', value: S.doc.pages[S.curPage]?.master || '', options: [['', '[None]'], ...S.doc.masters.map(m => [m.id, `${m.prefix}-${m.name}`])] }],
      onOK: v => {
        const n = Aero.clamp(v.n | 0, 1, 100); let at = v.where === 'after' ? S.curPage + 1 : v.where === 'before' ? S.curPage : v.where === 'end' ? S.doc.pages.length : 0;
        const ps = []; for (let k = 0; k < n; k++) ps.push(M.newPage(v.m || null));
        S.doc.pages.splice(at, 0, ...ps); S.curPage = at; commit(`Insert ${n} Page${n > 1 ? 's' : ''}`); requestAnimationFrame(() => { if (S.mode.kind === 'doc') View.goPage(at); });
      } });
  }
  function applyMaster(mid, pages = [S.curPage]) { pages.forEach(i => { S.doc.pages[i].master = mid || null; S.doc.pages[i].overrides = []; }); commit('Apply Master'); }
  function newMaster() {
    const used = new Set(S.doc.masters.map(m => m.prefix)); let pre = 'A'; while (used.has(pre)) pre = String.fromCharCode(pre.charCodeAt(0) + 1);
    const m = { id: pre + M.uid().slice(0, 4), prefix: pre, name: 'Master', pages: S.doc.facing ? [M.newPage(), M.newPage()] : [M.newPage()] };
    S.doc.masters.push(m); commit('New Master'); editMaster(m.id);
  }
  async function deleteMaster(id) {
    const m = S.doc.masters.find(x => x.id === id); if (!m) return;
    const users = S.doc.pages.filter(p => p.master === id).length;
    if (!(await Aero.confirm('Delete Master', `Delete master “${m.prefix}-${m.name}”?${users ? ` ${users} page(s) use it and will be set to [None].` : ''}`, 'Delete'))) return;
    m.pages.forEach(p => M.walkItems(p.items, it => { if (it.type === 'text') { const s = S.doc.stories[it.story]; if (s) { s.frames = s.frames.filter(f => f !== it.id); if (!s.frames.length) delete S.doc.stories[s.id]; } } }));
    S.doc.pages.forEach(p => { if (p.master === id) { p.master = null; p.overrides = []; } });
    S.doc.masters = S.doc.masters.filter(x => x !== m);
    if (S.mode.kind === 'master') { S.mode = { kind: 'doc' }; S.sel = []; }
    commit('Delete Master'); requestAnimationFrame(() => View.fitPage());
  }
  function editMaster(id) { T().exit(); S.mode = { kind: 'master', id }; S.sel = []; S.content = null; placePages(); requestRender(true); refresh(true); requestAnimationFrame(() => View.fitSpread()); }
  function overrideMaster() {
    const page = S.doc.pages[S.curPage], mp = S.eng.masterPage(page, S.curPage); if (!mp || S.mode.kind !== 'doc') { Aero.toast('This page has no master items'); return; }
    page.overrides = page.overrides || [];
    const todo = mp.items.filter(it => !page.overrides.includes(it.id));
    if (!todo.length) return;
    const cl = Tools.cloneItems(todo); page.items.unshift(...cl); page.overrides.push(...todo.map(t => t.id));
    commit('Override All Master Items');
  }

  /* ---------- document setup ---------- */
  function docDialog(isNew) {
    const d = S.doc; const u0 = isNew ? 'mm' : d.units;
    const cur = isNew ? { w: 595.28, h: 841.89, facing: true, m: { t: 36, b: 36, i: 36, o: 36 }, cols: 2, gutter: 12, bleed: 9, slug: 0, pages: 4 } : { w: d.w, h: d.h, facing: d.facing, m: d.margins, cols: d.cols, gutter: d.gutter, bleed: d.bleed, slug: d.slug };
    const presetOf = (w, h) => (M.PRESETS.find(p => (Math.abs(p[1] - w) < .6 && Math.abs(p[2] - h) < .6) || (Math.abs(p[2] - w) < .6 && Math.abs(p[1] - h) < .6)) || ['Custom'])[0];
    let unit = u0;
    const f = (pt) => +M.fmtU(pt, unit);
    const fields = [
      { key: 'preset', label: 'Page size', type: 'select', value: presetOf(cur.w, cur.h), options: [...M.PRESETS.map(p => p[0]), 'Custom'] },
      { key: 'units', label: 'Units', type: 'select', value: unit, options: Object.entries(M.UNIT_NAMES).map(([k, v]) => [k, v]) },
      { key: 'w', label: 'Width', type: 'number', value: f(cur.w), step: 0.01 }, { key: 'h', label: 'Height', type: 'number', value: f(cur.h), step: 0.01 },
      { key: 'orient', label: 'Orientation', type: 'select', value: cur.w > cur.h ? 'landscape' : 'portrait', options: [['portrait', 'Portrait'], ['landscape', 'Landscape']] },
      ...(isNew ? [{ key: 'pages', label: 'Number of pages', type: 'number', value: cur.pages, min: 1, max: 500 }] : []),
      { key: 'facing', label: 'Facing pages', type: 'checkbox', value: cur.facing },
      { key: 'mt', label: 'Margin top', type: 'number', value: f(cur.m.t), step: 0.1 }, { key: 'mb', label: 'Margin bottom', type: 'number', value: f(cur.m.b), step: 0.1 },
      { key: 'mi', label: 'Margin inside / left', type: 'number', value: f(cur.m.i), step: 0.1 }, { key: 'mo', label: 'Margin outside / right', type: 'number', value: f(cur.m.o), step: 0.1 },
      { key: 'cols', label: 'Columns', type: 'number', value: cur.cols, min: 1, max: 20 }, { key: 'gutter', label: 'Gutter', type: 'number', value: f(cur.gutter), step: 0.1 },
      { key: 'bleed', label: 'Bleed', type: 'number', value: f(cur.bleed), step: 0.1 }, { key: 'slug', label: 'Slug', type: 'number', value: f(cur.slug), step: 0.1 },
    ];
    const LEN = ['w', 'h', 'mt', 'mb', 'mi', 'mo', 'gutter', 'bleed', 'slug'];
    Aero.dialog({ title: isNew ? 'New Document' : 'Document Setup', instruction: isNew ? 'Choose a page size, margins and columns' : null, fields, ok: isNew ? 'Create' : 'OK',
      onInput: (k, v, set) => {
        if (k === 'preset' && v.preset !== 'Custom') { const p = M.PRESETS.find(x => x[0] === v.preset); let w = p[1], h = p[2]; if (v.orient === 'landscape') [w, h] = [h, w]; set('w', +M.fmtU(w, unit)); set('h', +M.fmtU(h, unit)); }
        if (k === 'orient') { const w = v.w, h = v.h; if ((v.orient === 'landscape') !== (w > h)) { set('w', h); set('h', w); } }
        if (k === 'w' || k === 'h') set('preset', presetOf(M.fromU(v.w, unit), M.fromU(v.h, unit)));
        if (k === 'units') { const nu = v.units; for (const key of LEN) set(key, +M.fmtU(M.fromU(v[key], unit), nu)); unit = nu; }
      },
      onOK: v => {
        const P = key => Math.max(0, M.fromU(+v[key] || 0, v.units));
        const o = { units: v.units, w: Math.max(9, P('w')), h: Math.max(9, P('h')), facing: !!v.facing, margins: { t: P('mt'), b: P('mb'), i: P('mi'), o: P('mo') }, cols: Aero.clamp(v.cols | 0, 1, 20), gutter: P('gutter'), bleed: P('bleed'), slug: P('slug') };
        if (isNew) { const nd = M.newDoc({ ...o, pages: Aero.clamp(v.pages | 0, 1, 500) }); IO.defaultStyles(nd); setDocument(nd, {}, 'Untitled'); return; }
        const d = S.doc; const wasFacing = d.facing;
        Object.assign(d, { units: o.units, w: o.w, h: o.h, facing: o.facing, margins: o.margins, cols: o.cols, gutter: o.gutter, bleed: o.bleed, slug: o.slug });
        if (wasFacing !== o.facing) for (const m of d.masters) { if (o.facing && m.pages.length === 1) m.pages.push(structuredClone({ ...m.pages[0], id: 'P' + M.uid(), items: Tools.cloneItems(m.pages[0].items) })); if (!o.facing && m.pages.length > 1) m.pages = [m.pages[1]]; }
        commit('Document Setup'); requestAnimationFrame(() => View.fitPage());
      } });
  }
  function marginsDialog() {
    const d = S.doc, f = pt => +M.fmtU(pt, U());
    Aero.dialog({ title: 'Margins and Columns', fields: [
      { key: 't', label: 'Top', type: 'number', value: f(d.margins.t), step: 0.1 }, { key: 'b', label: 'Bottom', type: 'number', value: f(d.margins.b), step: 0.1 },
      { key: 'i', label: d.facing ? 'Inside' : 'Left', type: 'number', value: f(d.margins.i), step: 0.1 }, { key: 'o', label: d.facing ? 'Outside' : 'Right', type: 'number', value: f(d.margins.o), step: 0.1 },
      { key: 'cols', label: 'Columns', type: 'number', value: d.cols, min: 1, max: 20 }, { key: 'g', label: 'Gutter', type: 'number', value: f(d.gutter), step: 0.1 }],
      onOK: v => { d.margins = { t: M.fromU(v.t, U()), b: M.fromU(v.b, U()), i: M.fromU(v.i, U()), o: M.fromU(v.o, U()) }; d.cols = Aero.clamp(v.cols | 0, 1, 20); d.gutter = M.fromU(v.g, U()); commit('Margins and Columns'); } });
  }
  function gridDialog() {
    const d = S.doc;
    Aero.dialog({ title: 'Baseline Grid', fields: [{ key: 's', label: 'Start (pt)', type: 'number', value: d.grid.start, step: 0.5 }, { key: 'i', label: 'Increment (pt)', type: 'number', value: d.grid.step, step: 0.5, min: 2 }],
      onOK: v => { d.grid = { start: Math.max(0, v.s), step: Math.max(2, v.i) }; S.opt.baseline = true; commit('Baseline Grid'); } });
  }
  function createGuidesDialog() {
    Aero.dialog({ title: 'Create Guides', fields: [{ key: 'r', label: 'Rows', type: 'number', value: 0, min: 0, max: 40 }, { key: 'c', label: 'Columns', type: 'number', value: 3, min: 0, max: 40 }, { key: 'g', label: `Gutter (${U()})`, type: 'number', value: 0, step: 0.1 }, { key: 'fit', label: 'Fit to', type: 'select', value: 'margins', options: [['margins', 'Margins'], ['page', 'Page']] }, { key: 'clear', label: 'Remove existing guides', type: 'checkbox', value: true }],
      onOK: v => {
        const pp = curPlaced(), page = pp.page, m = v.fit === 'margins' ? S.eng.marginsFor(pp.kind, pp.kind === 'doc' ? pp.index : pp.side) : { t: 0, b: 0, l: 0, r: 0 };
        if (v.clear) page.guides = [];
        const g = M.fromU(v.g || 0, U()), W = pp.w - m.l - m.r, H = pp.h - m.t - m.b;
        const mk = (n, len, o, off) => { if (n < 1) return; const cell = (len - g * (n - 1)) / n; for (let k = 1; k < n; k++) { const p = off + k * cell + (k - 1) * g; page.guides.push({ o, pos: p }); if (g > 0) page.guides.push({ o, pos: p + g }); } };
        mk(v.c | 0, W, 'v', m.l); mk(v.r | 0, H, 'h', m.t); commit('Create Guides');
      } });
  }

  /* ---------- table commands ---------- */
  function insertTable() {
    Aero.dialog({ title: 'Insert Table', fields: [{ key: 'r', label: 'Body rows', type: 'number', value: 5, min: 1, max: 200 }, { key: 'c', label: 'Columns', type: 'number', value: 3, min: 1, max: 30 }, { key: 'h', label: 'Header rows', type: 'number', value: 1, min: 0, max: 5 }],
      onOK: v => {
        const pp = curPlaced(); const m = S.eng.marginsFor(pp.kind, pp.kind === 'doc' ? pp.index : pp.side);
        const rows = Aero.clamp(v.r | 0, 1, 200) + Aero.clamp(v.h | 0, 0, 5), cols = Aero.clamp(v.c | 0, 1, 30);
        const t = M.newTable(m.l, m.t, cols, rows, pp.w - m.l - m.r, 20, Aero.clamp(v.h | 0, 0, 5));
        for (let c = 0; c < cols; c++) if (t.header) t.cells[0][c].t = 'Heading ' + (c + 1);
        Tools.addItem(pp, t); S.sel = [t.id]; commit('Insert Table');
      } });
  }
  function curTable() { if (S.cell) return { t: info(S.cell.id)?.item, r: S.cell.r, c: S.cell.c }; const t = selItems().find(i => i.type === 'table'); return t ? { t, r: t.rowH.length - 1, c: t.colW.length - 1 } : null; }
  function tableOp(op) {
    const ct = curTable(); if (!ct || !ct.t) { Aero.toast('Select a table (double-click a cell to pick a row/column)'); return; }
    const { t, r, c } = ct;
    if (op === 'rowAbove' || op === 'rowBelow') { const at = op === 'rowAbove' ? r : r + 1; t.rowH.splice(at, 0, t.rowH[r]); t.cells.splice(at, 0, t.colW.map(() => ({ t: '' }))); }
    if (op === 'colLeft' || op === 'colRight') { const at = op === 'colLeft' ? c : c + 1; const w = t.colW[c] / 2; t.colW[c] = w; t.colW.splice(at, 0, w); t.cells.forEach(row => row.splice(at, 0, { t: '' })); }
    if (op === 'delRow') { if (t.rowH.length < 2) return; t.rowH.splice(r, 1); t.cells.splice(r, 1); if (S.cell) S.cell.r = Math.min(r, t.rowH.length - 1); if (t.header > t.rowH.length) t.header = t.rowH.length; }
    if (op === 'delCol') { if (t.colW.length < 2) return; const w = t.colW[c]; t.colW.splice(c, 1); t.colW[Math.max(0, c - 1)] += w; t.cells.forEach(row => row.splice(c, 1)); if (S.cell) S.cell.c = Math.min(c, t.colW.length - 1); }
    t.h = t.rowH.reduce((a, b) => a + b, 0); t.w = t.colW.reduce((a, b) => a + b, 0);
    commit('Table: ' + op);
  }
  let cellEd = null;
  function openCellEditor(t, r, c) {
    closeCellEditor(true);
    S.cell = { id: t.id, r, c }; S.sel = [t.id];
    const inf = info(t.id), pp = placedOf(inf.page);
    let x = 0; for (let k = 0; k < c; k++) x += t.colW[k]; let y = 0; for (let k = 0; k < r; k++) y += t.rowH[k];
    const [sx, sy] = Tools.l2s(pp, t, x, y), z = S.view.z;
    const ta = el('textarea', 'celled'); ta.value = t.cells[r][c].t || '';
    Object.assign(ta.style, { left: sx + 'px', top: sy + 'px', width: Math.max(60, t.colW[c] * z) + 'px', height: Math.max(22, t.rowH[r] * z) + 'px', fontSize: Math.max(10, t.tsize * z) + 'px' });
    $('#stagewrap').appendChild(ta); ta.focus(); ta.select();
    ta.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); closeCellEditor(false); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); closeCellEditor(true); }
      else if (e.key === 'Tab') { e.preventDefault(); const n = t.colW.length; let k = r * n + c + (e.shiftKey ? -1 : 1); k = Aero.clamp(k, 0, n * t.rowH.length - 1); closeCellEditor(true); openCellEditor(info(t.id).item, Math.floor(k / n), k % n); }
      e.stopPropagation();
    });
    cellEd = { ta, id: t.id, r, c };
    requestRender(); refresh(true);
  }
  function closeCellEditor(save) {
    if (!cellEd) return; const { ta, id, r, c } = cellEd; cellEd = null;
    const t = info(id)?.item;
    if (save && t && t.cells[r] && t.cells[r][c] && t.cells[r][c].t !== ta.value) { t.cells[r][c].t = ta.value; ta.remove(); commit('Edit Cell'); return; }
    ta.remove(); requestRender();
  }

  /* ---------- styles ---------- */
  const fontOpts = () => Fonts.families.map(f => [f, f]);
  const styleOpts = fam => Fonts.styleOptions(fam).map(o => [`${o.weight}|${o.italic ? 1 : 0}`, o.label]);
  function paraStyleDialog(id, isNew, preset) {
    const d = S.doc; const st = id ? d.paraStyles[id] : null;
    const base = { ...M.DEF, ...(st ? M.paraStyleChain(d, id) : {}), ...(preset || {}) };
    const fields = [
      { key: 'name', label: 'Style name', type: 'text', value: isNew ? (preset ? 'Paragraph Style ' + (Object.keys(d.paraStyles).length) : 'New Style') : st.name },
      { key: 'basedOn', label: 'Based on', type: 'select', value: st?.basedOn || '', options: [['', '[No Paragraph Style]'], ...Object.entries(d.paraStyles).filter(([k]) => k !== id).map(([k, v]) => [k, v.name])] },
      { key: 'next', label: 'Next style', type: 'select', value: st?.next || '', options: [['', '[Same style]'], ...Object.entries(d.paraStyles).map(([k, v]) => [k, v.name])] },
      { key: 'font', label: 'Font family', type: 'select', value: base.font, options: fontOpts() },
      { key: 'fs', label: 'Font style', type: 'select', value: `${Fonts.parse(Fonts.resolve(base.font, base.weight, false)).weight}|${base.italic ? 1 : 0}`, options: styleOpts(base.font) },
      { key: 'size', label: 'Size (pt)', type: 'number', value: base.size, step: 0.5, min: 1 }, { key: 'lead', label: 'Leading (pt, 0 = auto)', type: 'number', value: base.lead, step: 0.5, min: 0 },
      { key: 'track', label: 'Tracking (1/1000 em)', type: 'number', value: base.track, step: 5 }, { key: 'color', label: 'Color', type: 'color', value: base.color },
      { key: 'caps', label: 'Case', type: 'select', value: base.caps, options: [['none', 'Normal'], ['all', 'All Caps'], ['small', 'Small Caps']] },
      { key: 'align', label: 'Alignment', type: 'select', value: base.align, options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right'], ['justify', 'Justify (last line left)'], ['justify-all', 'Justify all lines']] },
      { key: 'indL', label: 'Left indent (pt)', type: 'number', value: base.indL, step: 1 }, { key: 'indR', label: 'Right indent (pt)', type: 'number', value: base.indR, step: 1 }, { key: 'indF', label: 'First line indent (pt)', type: 'number', value: base.indF, step: 1 },
      { key: 'spB', label: 'Space before (pt)', type: 'number', value: base.spB, step: 1 }, { key: 'spA', label: 'Space after (pt)', type: 'number', value: base.spA, step: 1 },
      { key: 'dropL', label: 'Drop cap lines', type: 'number', value: base.dropL, min: 0, max: 10 }, { key: 'dropC', label: 'Drop cap characters', type: 'number', value: base.dropC, min: 1, max: 10 },
      { key: 'hyph', label: 'Hyphenate', type: 'checkbox', value: base.hyph }, { key: 'grid', label: 'Align to baseline grid', type: 'checkbox', value: base.grid },
    ];
    Aero.dialog({ title: isNew ? 'New Paragraph Style' : 'Paragraph Style Options', fields, width: 520,
      onInput: (k, v, set) => { if (k === 'font') { const sel = document.querySelectorAll('.aero-modal select')[3]; } },
      onOK: v => {
        const [w, it] = String(v.fs).split('|');
        const o = { name: String(v.name || 'Style').slice(0, 60), font: v.font, weight: +w || 400, italic: it === '1', size: Math.max(1, v.size), lead: Math.max(0, v.lead), track: v.track, color: v.color, caps: v.caps, align: v.align, indL: v.indL, indR: v.indR, indF: v.indF, spB: v.spB, spA: v.spA, dropL: v.dropL | 0, dropC: Math.max(1, v.dropC | 0), hyph: !!v.hyph, grid: !!v.grid };
        // store only what differs from the parent style so "Based on" inheritance keeps working
        const parent = { ...M.DEF, ...(v.basedOn ? M.paraStyleChain(d, v.basedOn) : {}) };
        for (const k of Object.keys(o)) if (k !== 'name' && o[k] === parent[k]) delete o[k];
        if (v.basedOn) o.basedOn = v.basedOn; if (v.next) o.next = v.next;
        const nid = isNew ? 'ps' + M.uid().slice(0, 6) : id;
        if (id === 'basic') o.name = 'Basic Paragraph';
        d.paraStyles[nid] = o;
        if (isNew && preset) applyParaStyleNoCommit(nid);
        commit(isNew ? 'New Paragraph Style' : 'Edit Paragraph Style');
      } });
    // live update style options when family changes
    const sels = document.querySelectorAll('.aero-modal:last-child select');
    const famSel = [...sels].find(s => [...s.options].some(o => o.value === 'Montserrat')), fsSel = [...sels].find(s => [...s.options].some(o => /\|/.test(o.value)));
    if (famSel && fsSel) famSel.addEventListener('change', () => { const keep = fsSel.value; fsSel.innerHTML = ''; styleOpts(famSel.value).forEach(([a, b]) => fsSel.add(new Option(b, a))); fsSel.value = [...fsSel.options].some(o => o.value === keep) ? keep : fsSel.options[0].value; fsSel.dispatchEvent(new Event('input')); });
  }
  function applyParaStyleNoCommit(id) { for (const { s, a, b } of textTargets()) { const p0 = M.paraIndexAt(s, a), p1 = M.paraIndexAt(s, b); for (let k = p0; k <= p1; k++) s.paras[k] = { ps: id }; } }
  function charStyleDialog(id, isNew, preset) {
    const d = S.doc; const st = (id ? d.charStyles[id] : null) || preset || {};
    const fields = [
      { key: 'name', label: 'Style name', type: 'text', value: isNew ? 'Character Style ' + (Object.keys(d.charStyles).length + 1) : st.name },
      { key: 'font', label: 'Font family', type: 'select', value: st.font || '', options: [['', '(inherit)'], ...fontOpts()] },
      { key: 'weight', label: 'Weight', type: 'select', value: st.weight ? String(st.weight) : '', options: [['', '(inherit)'], ...[300, 400, 500, 600, 700, 800, 900].map(w => [String(w), `${w} ${Fonts.WNAMES[w]}`])] },
      { key: 'italic', label: 'Italic', type: 'select', value: st.italic === undefined ? '' : st.italic ? '1' : '0', options: [['', '(inherit)'], ['1', 'Italic'], ['0', 'Roman']] },
      { key: 'size', label: 'Size (pt, blank = inherit)', type: 'text', value: st.size ?? '' },
      { key: 'track', label: 'Tracking (blank = inherit)', type: 'text', value: st.track ?? '' },
      { key: 'shift', label: 'Baseline shift (pt)', type: 'text', value: st.shift ?? '' },
      { key: 'useColor', label: 'Set color', type: 'checkbox', value: !!st.color }, { key: 'color', label: 'Color', type: 'color', value: st.color || '#c8102e' },
      { key: 'caps', label: 'Case', type: 'select', value: st.caps || '', options: [['', '(inherit)'], ['none', 'Normal'], ['all', 'All Caps'], ['small', 'Small Caps']] },
      { key: 'under', label: 'Underline', type: 'select', value: st.under === undefined ? '' : st.under ? '1' : '0', options: [['', '(inherit)'], ['1', 'On'], ['0', 'Off']] },
    ];
    Aero.dialog({ title: isNew ? 'New Character Style' : 'Character Style Options', fields, width: 500,
      onOK: v => {
        const o = { name: String(v.name || 'Style').slice(0, 60) };
        if (v.font) o.font = v.font; if (v.weight) o.weight = +v.weight; if (v.italic) o.italic = v.italic === '1';
        const num = x => x === '' || x == null || isNaN(+x) ? undefined : +x;
        if (num(v.size) !== undefined) o.size = Math.max(1, num(v.size)); if (num(v.track) !== undefined) o.track = num(v.track); if (num(v.shift) !== undefined) o.shift = num(v.shift);
        if (v.useColor) o.color = v.color; if (v.caps) o.caps = v.caps; if (v.under) o.under = v.under === '1';
        const nid = isNew ? 'cs' + M.uid().slice(0, 6) : id;
        d.charStyles[nid] = o; commit(isNew ? 'New Character Style' : 'Edit Character Style');
      } });
  }
  async function deleteStyle(kind, id) {
    const d = S.doc;
    if (kind === 'p') {
      if (id === 'basic') { Aero.toast('The Basic Paragraph style cannot be deleted'); return; }
      if (!(await Aero.confirm('Delete Style', `Delete paragraph style “${d.paraStyles[id].name}”? Paragraphs using it revert to Basic Paragraph.`, 'Delete'))) return;
      for (const s of Object.values(d.stories)) s.paras.forEach(p => { if (p.ps === id) p.ps = 'basic'; });
      for (const st of Object.values(d.paraStyles)) { if (st.basedOn === id) delete st.basedOn; if (st.next === id) delete st.next; }
      delete d.paraStyles[id];
    } else {
      if (!(await Aero.confirm('Delete Style', `Delete character style “${d.charStyles[id].name}”?`, 'Delete'))) return;
      for (const s of Object.values(d.stories)) s.attrs = s.attrs.map(a => { if (a.cs === id) { const o = { ...a }; delete o.cs; return o; } return a; });
      delete d.charStyles[id];
    }
    commit('Delete Style');
  }

  /* ---------- menus ---------- */
  const cmd = {
    undo() { flushTyping(true); const st = S.hist.undo(); if (st) restore(st); },
    redo() { flushTyping(true); const st = S.hist.redo(); if (st) restore(st); },
    toggleChar(k) {
      const c = charState(); if (!c) return;
      if (k === 'bold') { const opts = Fonts.styleOptions(c.font).map(o => o.weight); const heavy = Math.max(...opts); const isB = c.weight >= 600; applyChar({ weight: isB ? 400 : (opts.includes(700) ? 700 : heavy) }, 'Bold'); }
      if (k === 'italic') applyChar({ italic: !c.italic }, 'Italic');
      if (k === 'under') applyChar({ under: !c.under }, 'Underline');
      if (k === 'strike') applyChar({ strike: !c.strike }, 'Strikethrough');
      if (k === 'allcaps') applyChar({ caps: c.caps === 'all' ? 'none' : 'all' }, 'All Caps');
      if (k === 'smallcaps') applyChar({ caps: c.caps === 'small' ? 'none' : 'small' }, 'Small Caps');
    },
    bumpSize(d) { const c = charState(); if (!c) return; const sizes = [6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 21, 24, 30, 36, 48, 60, 72, 96, 120, 144]; let n = d > 0 ? sizes.find(s => s > c.size + .01) : [...sizes].reverse().find(s => s < c.size - .01); applyChar({ size: n || c.size }, 'Font Size'); },
    selectAll() { if (S.edit) { S.edit.a = 0; S.edit.f = S.doc.stories[S.edit.sid].text.length; T().sync(); return; } const pp = curPlaced(); S.sel = S.placed.filter(p => p.row === pp.row).flatMap(p => p.page.items.filter(it => !it.locked).map(it => it.id)); requestRender(); refresh(true); },
    deselect() { if (S.edit) { T().exit(); setTool('select'); return; } if (S.loadedThread) { S.loadedThread = null; requestRender(); return; } if (S.content) { S.content = null; requestRender(); refresh(true); return; } S.sel = []; requestRender(); refresh(true); },
    copy() { if (S.edit) { document.execCommand('copy'); return; } copyItems(false); },
    cut() { if (S.edit) { document.execCommand('cut'); return; } copyItems(true); },
    async paste() {
      if (S.edit) { if (!document.execCommand('paste')) { try { const t = await navigator.clipboard.readText(); if (t) { T().insert(t); commit('Paste'); } } catch (e) { Aero.toast('Use Ctrl+V to paste text'); } } return; }
      pasteItems(false);
    },
    duplicate() { const infs = topLevelSel(); if (!infs.length) return; const byPage = new Map(); infs.forEach(i => { const a = byPage.get(i.page) || []; a.push(i.item); byPage.set(i.page, a); }); const ns = []; for (const [p, items] of byPage) { const cl = Tools.cloneItems(items, 12, 12); p.items.push(...cl); ns.push(...cl.map(c => c.id)); } S.sel = ns; commit('Duplicate'); },
  };
  function menus() {
    const sel = () => S.sel.length > 0, ed = () => !!S.edit;
    return {
      File: [['New…', 'Ctrl+N', () => docDialog(true)], ['Open…', 'Ctrl+O', () => IO.open()], ['Open Sample', '', () => IO.openSample()], '-',
        ['Save', 'Ctrl+S', () => IO.save(false)], ['Save As…', 'Ctrl+Shift+S', () => IO.save(true)], '-',
        ['Place…', 'Ctrl+D', () => IO.place()], '-',
        ['Export PDF…', 'Ctrl+E', () => IO.exportPdfDialog()], ['Export Pages as PNG…', '', () => IO.exportImagesDialog('png')], ['Export Pages as JPEG…', '', () => IO.exportImagesDialog('jpeg')], '-',
        ['Print…', 'Ctrl+P', () => IO.print()], '-', ['Document Setup…', 'Ctrl+Alt+P', () => docDialog(false)]],
      Edit: [['Undo', 'Ctrl+Z', cmd.undo], ['Redo', 'Ctrl+Y/Ctrl+Shift+Z', cmd.redo], '-', ['Cut', 'Ctrl+X', cmd.cut], ['Copy', 'Ctrl+C', cmd.copy], ['Paste', 'Ctrl+V', cmd.paste], ['Paste in Place', 'Ctrl+Alt+Shift+V', () => pasteItems(true)],
        ['Duplicate', 'Ctrl+Alt+Shift+D', cmd.duplicate], { label: 'Delete', key: 'Delete/Backspace', fn: deleteSel, disabled: () => !sel() || ed() }, '-',
        ['Select All', 'Ctrl+A', cmd.selectAll], ['Deselect', 'Escape', cmd.deselect]],
      Layout: [['Add Page', 'Ctrl+Shift+P', () => addPage()], ['Insert Pages…', '', insertPagesDialog], ['Duplicate Page', '', () => addPage(S.curPage, true)], ['Delete Page', '', () => deletePage()], '-',
        ['First Page', 'Ctrl+Shift+PageUp', () => View.goPage(0)], ['Previous Page', 'Shift+PageUp', () => View.goPage(S.curPage - 1)], ['Next Page', 'Shift+PageDown', () => View.goPage(S.curPage + 1)], ['Last Page', 'Ctrl+Shift+PageDown', () => View.goPage(S.doc.pages.length - 1)], '-',
        '#Masters', ['New Master', '', newMaster], ['Edit Master of Current Page', '', () => { const m = S.doc.pages[S.curPage]?.master; if (m) editMaster(m); else Aero.toast('The current page has no master'); }], ['Back to Document Pages', '', () => View.goPage(S.curPage)], { label: 'Delete Master Being Edited', fn: () => deleteMaster(S.mode.id), disabled: () => S.mode.kind !== 'master' }, ['Override All Master Page Items', 'Ctrl+Alt+Shift+L', overrideMaster], '-',
        ['Margins and Columns…', '', marginsDialog], ['Create Guides…', '', createGuidesDialog], ['Baseline Grid…', '', gridDialog], ['Clear Guides on Page', '', () => { curPlaced().page.guides = []; commit('Clear Guides'); }]],
      Type: [['Font Size Up', 'Ctrl+Shift+>', () => cmd.bumpSize(1)], ['Font Size Down', 'Ctrl+Shift+<', () => cmd.bumpSize(-1)], ['Bold', 'Ctrl+Shift+B', () => cmd.toggleChar('bold')], ['Italic', 'Ctrl+Shift+I', () => cmd.toggleChar('italic')], ['Underline', 'Ctrl+Shift+U', () => cmd.toggleChar('under')], ['All Caps', 'Ctrl+Shift+K', () => cmd.toggleChar('allcaps')], ['Small Caps', 'Ctrl+Shift+H', () => cmd.toggleChar('smallcaps')], '-',
        ['Insert Page Number', 'Ctrl+Alt+Shift+N', () => insertSpecial('\uE000', 'Insert Page Number')], ['Insert Em Dash', '', () => insertSpecial('—', 'Insert Em Dash')], ['Insert Forced Line Break', '', () => insertSpecial('\u2028', 'Forced Line Break')], ['Fill with Placeholder Text', '', fillPlaceholder], '-',
        ['Text Frame Options…', 'Ctrl+B', textFrameOptions], { label: 'Show Hidden Characters', key: 'Ctrl+Alt+I', fn: () => toggleOpt('hidden'), checked: () => S.opt.hidden }, '-',
        ['New Paragraph Style…', '', () => paraStyleDialog(null, true, styleFromSelection())], ['New Character Style…', '', () => charStyleDialog(null, true)]],
      Object: [['Bring to Front', 'Ctrl+Shift+]', () => arrange('front')], ['Bring Forward', 'Ctrl+]', () => arrange('forward')], ['Send Backward', 'Ctrl+[', () => arrange('backward')], ['Send to Back', 'Ctrl+Shift+[', () => arrange('back')], '-',
        ['Group', 'Ctrl+G', group], ['Ungroup', 'Ctrl+Shift+G', ungroup], ['Lock', 'Ctrl+L', () => lockSel(true)], ['Unlock All on Spread', 'Ctrl+Alt+L', unlockAll], '-',
        '#Align', ['Align Left', '', () => align('left')], ['Align Horizontal Centers', '', () => align('hcenter')], ['Align Right', '', () => align('right')], ['Align Top', '', () => align('top')], ['Align Vertical Centers', '', () => align('vcenter')], ['Align Bottom', '', () => align('bottom')],
        ['Distribute Horizontal Centers', '', () => distribute('h')], ['Distribute Vertical Centers', '', () => distribute('v')], '-',
        '#Fitting', ['Fit Content Proportionally', 'Ctrl+Alt+Shift+E', () => fitImage('fit')], ['Fill Frame Proportionally', 'Ctrl+Alt+Shift+C', () => fitImage('fill')], ['Center Content', 'Ctrl+Shift+E', () => fitImage('center')], ['Fit Frame to Content', 'Ctrl+Alt+C', () => fitImage('frame')], '-',
        ['Text Wrap: Bounding Box', '', () => setWrap('box')], ['Text Wrap: None', '', () => setWrap('none')], '-', ['Rotate 90° CW', '', () => rotateSel(90)], ['Rotate 90° CCW', '', () => rotateSel(-90)]],
      Table: [['Insert Table…', 'Ctrl+Alt+Shift+T', insertTable], '-', ['Insert Row Above', '', () => tableOp('rowAbove')], ['Insert Row Below', '', () => tableOp('rowBelow')], ['Insert Column Left', '', () => tableOp('colLeft')], ['Insert Column Right', '', () => tableOp('colRight')], '-', ['Delete Row', '', () => tableOp('delRow')], ['Delete Column', '', () => tableOp('delCol')]],
      View: [['Zoom In', 'Ctrl+=', () => View.zoomBy(1.25)], ['Zoom Out', 'Ctrl+-', () => View.zoomBy(0.8)], ['Fit Page in Window', 'Ctrl+0', () => View.fitPage()], ['Fit Spread in Window', 'Ctrl+Alt+0', () => View.fitSpread()], ['Actual Size', 'Ctrl+1', () => View.actual()], '-',
        { label: 'Preview Mode', key: 'W', fn: () => toggleOpt('preview'), checked: () => S.opt.preview }, '-',
        { label: 'Rulers', key: 'Ctrl+R', fn: () => toggleOpt('rulers'), checked: () => S.opt.rulers }, { label: 'Guides', key: 'Ctrl+;', fn: () => toggleOpt('guides'), checked: () => S.opt.guides }, { label: 'Lock Guides', key: 'Ctrl+Alt+;', fn: () => toggleOpt('lockGuides'), checked: () => S.opt.lockGuides },
        { label: 'Baseline Grid', key: "Ctrl+Alt+'", fn: () => toggleOpt('baseline'), checked: () => S.opt.baseline }, { label: 'Frame Edges', key: 'Ctrl+H', fn: () => toggleOpt('frames'), checked: () => S.opt.frames }, { label: 'Text Threads', key: 'Ctrl+Alt+Y', fn: () => toggleOpt('threads'), checked: () => S.opt.threads }, '-',
        { label: 'Snap to Guides', key: 'Ctrl+Shift+;', fn: () => toggleOpt('snap'), checked: () => S.opt.snap }, { label: 'Smart Guides', key: 'Ctrl+U', fn: () => toggleOpt('smart'), checked: () => S.opt.smart }],
      Help: [['Keyboard Shortcuts', 'F1', shortcutsDialog], ['About Lumen Layout', '', () => Aero.alert('About Lumen Layout', 'Lumen Layout 1.0 — page layout and desktop publishing for the Lumen Studio suite. Threaded text, master pages, paragraph & character styles, tables and print-ready vector PDF export. Bundled typefaces: Source Serif 4, Playfair Display, Lora, Montserrat and Oswald (SIL Open Font License).')]],
    };
  }
  function rotateSel(deg) { const b = Tools.selBox(); if (!b) return; for (const i of S.sel.map(info)) { const pp = placedOf(i.page); Tools.rotateAbout(i.item, structuredClone(i.item), deg, b.x + b.w / 2 - pp.x, b.y + b.h / 2 - pp.y); } commit('Rotate'); }
  function toggleOpt(k) { S.opt[k] = !S.opt[k]; if (k === 'preview' && S.opt.preview) { } requestRender(true); refresh(); Rulers.draw(); requestAnimationFrame(() => requestRender(true)); }
  function textFrameOptions() {
    const it = S.edit ? info(S.edit.fid)?.item : selItems().find(i => i.type === 'text'); if (!it) { Aero.toast('Select a text frame'); return; }
    Aero.dialog({ title: 'Text Frame Options', fields: [{ key: 'cols', label: 'Columns', type: 'number', value: it.cols, min: 1, max: 12 }, { key: 'gutter', label: `Gutter (${U()})`, type: 'number', value: +M.fmtU(it.gutter, U()), step: 0.1 }, { key: 'inset', label: `Inset spacing (${U()})`, type: 'number', value: +M.fmtU(it.inset, U()), step: 0.1 }, { key: 'valign', label: 'Vertical justification', type: 'select', value: it.valign, options: [['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']] }],
      onOK: v => { const t = info(it.id).item; t.cols = Aero.clamp(v.cols | 0, 1, 12); t.gutter = M.fromU(v.gutter, U()); t.inset = M.fromU(v.inset, U()); t.valign = v.valign; commit('Text Frame Options'); } });
  }
  function shortcutsDialog() {
    const rows = [['V / A', 'Selection / Direct Selection'], ['T', 'Type tool (drag to create a text frame)'], ['F / M / L / \\', 'Image frame / Rectangle / Ellipse / Line'], ['H, hold Space', 'Hand (pan)'], ['Z', 'Zoom (Alt-click zooms out)'], ['W', 'Preview mode'],
      ['Double-click', 'Edit text • adjust image content • edit table cell • enter group'], ['Out-port ▸ click', 'Load text to thread into another frame'], ['Shift-drag', 'Constrain proportions / angle'], ['Alt-drag', 'Duplicate while moving'], ['Arrows / Shift+Arrows', 'Nudge 1 pt / 10 pt'],
      ['Ctrl+Shift+B / I / U', 'Bold / Italic / Underline'], ['Ctrl+Shift+. / ,', 'Increase / decrease font size'], ['Ctrl+Alt+Shift+N', 'Insert automatic page number'], ['Ctrl+B', 'Text frame options'], ['Ctrl+D', 'Place image or text'], ['Ctrl+E', 'Export PDF'], ['Ctrl+G / Ctrl+Shift+G', 'Group / Ungroup'],
      ['Ctrl+0 / Ctrl+1', 'Fit page / Actual size'], ['Ctrl+wheel', 'Zoom at pointer'], ['Drag from ruler', 'Create guide (drag back onto ruler to delete)']];
    Aero.dialog({ title: 'Keyboard Shortcuts', noCancel: true, width: 560, html: `<table class="kbd">${rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('')}</table>` });
  }

  /* ---------- command bar ---------- */
  let cmdSig = '';
  const CMD = $ => null;
  function buildCmd() {
    const bar = $('#cmd'); const textCtx = !!(S.edit || selItems().some(i => i.type === 'text'));
    const tname = { select: 'Selection', direct: 'Direct Selection', type: 'Type', frame: 'Image Frame', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', hand: 'Hand', zoom: 'Zoom' }[S.tool];
    const sig = (textCtx ? 'T' : S.sel.length ? 'O' : 'N') + S.tool;
    if (sig === cmdSig) return syncCmd(); cmdSig = sig;
    bar.innerHTML = '';
    bar.appendChild(el('span', 'tname', esc(tname)));
    const add = (h) => { const x = el('span', 'cg', h); bar.appendChild(x); return x; };
    if (textCtx) {
      const g = add(`<select id="c-font" title="Font family" style="width:128px"></select><select id="c-style" title="Font style" style="width:104px"></select>`);
      Fonts.families.forEach(f => $('#c-font').add(new Option(f, f)));
      add(`<label title="Font size (pt)"><b class="ic">T</b><input id="c-size" type="text" list="sizes" style="width:44px"></label><label title="Leading (pt), blank = auto"><b class="ic">↕</b><input id="c-lead" type="text" style="width:40px" placeholder="auto"></label><label title="Tracking (1/1000 em)"><b class="ic">VA</b><input id="c-track" type="number" step="10" style="width:52px"></label><input id="c-color" type="color" title="Text color">`);
      add(`<button class="aero-btn small" id="c-b" title="Bold (Ctrl+Shift+B)"><b>B</b></button><button class="aero-btn small" id="c-i" title="Italic (Ctrl+Shift+I)"><i>I</i></button><button class="aero-btn small" id="c-u" title="Underline"><u>U</u></button><button class="aero-btn small" id="c-tt" title="All caps">TT</button><button class="aero-btn small" id="c-sc" title="Small caps">Tt</button>`);
      bar.appendChild(el('span', 'sep'));
      add(['left', 'center', 'right', 'justify', 'justify-all'].map(a => `<button class="aero-btn small al" data-al="${a}" title="Align ${a}">${alignIcon(a)}</button>`).join(''));
      bar.appendChild(el('span', 'sep'));
      add(`<label title="Paragraph style">¶<select id="c-ps" style="width:120px"></select></label><label title="Character style"><b class="ic">A</b><select id="c-cs" style="width:104px"></select></label>`);
      $('#c-font').onchange = e => { const c = charState(); applyChar({ font: e.target.value, weight: c?.weight, italic: c?.italic }, 'Font'); };
      $('#c-style').onchange = e => { const [w, i] = e.target.value.split('|'); applyChar({ weight: +w, italic: i === '1' }, 'Font Style'); };
      const numIn = (id, key, label, min) => { const i = $(id); i.onchange = () => { const v = i.value.trim(); if (key === 'lead' && (v === '' || /auto/i.test(v))) return applyChar({ lead: 0 }, label); const n = parseFloat(v); if (!isNaN(n)) applyChar({ [key]: min != null ? Math.max(min, n) : n }, label); }; i.onkeydown = e => { if (e.key === 'Enter') { i.blur(); } }; };
      numIn('#c-size', 'size', 'Font Size', 1); numIn('#c-lead', 'lead', 'Leading', 0); numIn('#c-track', 'track', 'Tracking');
      $('#c-color').onchange = e => applyChar({ color: e.target.value }, 'Text Color');
      $('#c-b').onclick = () => cmd.toggleChar('bold'); $('#c-i').onclick = () => cmd.toggleChar('italic'); $('#c-u').onclick = () => cmd.toggleChar('under'); $('#c-tt').onclick = () => cmd.toggleChar('allcaps'); $('#c-sc').onclick = () => cmd.toggleChar('smallcaps');
      bar.querySelectorAll('.al').forEach(b => b.onclick = () => applyPara({ align: b.dataset.al }, 'Alignment'));
      $('#c-ps').onchange = e => applyParaStyle(e.target.value);
      $('#c-cs').onchange = e => applyCharStyle(e.target.value || null);
      for (const b of bar.querySelectorAll('button')) b.addEventListener('mousedown', e => e.preventDefault()); // keep text focus
    } else if (S.sel.length) {
      add(`<label>X<input id="o-x" type="text" style="width:54px"></label><label>Y<input id="o-y" type="text" style="width:54px"></label><label>W<input id="o-w" type="text" style="width:54px"></label><label>H<input id="o-h" type="text" style="width:54px"></label><label title="Rotation">∠<input id="o-r" type="text" style="width:40px"></label>`);
      bar.appendChild(el('span', 'sep'));
      add(`<label>Fill<input id="o-fill" type="color"><button class="aero-btn small" id="o-fn" title="No fill">∅</button></label><label>Stroke<input id="o-stroke" type="color"><button class="aero-btn small" id="o-sn" title="No stroke">∅</button></label><label title="Stroke weight (pt)"><input id="o-sw" type="number" min="0" step="0.25" style="width:48px">pt</label><label>Opacity<input id="o-op" type="range" min="0" max="100" style="width:80px"><span class="v" id="o-opv"></span></label>`);
      const geo = (id, k) => { const i = $(id); i.onchange = () => setGeo(k, i.value); i.onkeydown = e => { if (e.key === 'Enter') i.blur(); if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const v = parseFloat(i.value) || 0; i.value = +(v + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)).toFixed(3); setGeo(k, i.value); } }; };
      geo('#o-x', 'x'); geo('#o-y', 'y'); geo('#o-w', 'w'); geo('#o-h', 'h'); geo('#o-r', 'rot');
      $('#o-fill').oninput = e => setProp('fill', e.target.value, true); $('#o-fill').onchange = e => setProp('fill', e.target.value);
      $('#o-stroke').oninput = e => setProp('stroke', e.target.value, true); $('#o-stroke').onchange = e => setProp('stroke', e.target.value);
      $('#o-fn').onclick = () => setProp('fill', null); $('#o-sn').onclick = () => setProp('stroke', null);
      $('#o-sw').onchange = e => setProp('sw', Math.max(0, +e.target.value || 0));
      $('#o-op').oninput = e => setProp('opacity', +e.target.value / 100, true); $('#o-op').onchange = e => setProp('opacity', +e.target.value / 100);
    } else {
      const hints = { select: 'Click to select • drag to move • double-click a frame to edit its content • drag from the rulers to create guides', direct: 'Select objects inside groups • drag inside an image frame to pan the image', type: 'Drag to create a text frame, or click into an existing frame to type', frame: 'Drag to draw an image frame, then File ▸ Place (Ctrl+D)', rect: 'Drag to draw a rectangle (Shift = square). Click for an exact size', ellipse: 'Drag to draw an ellipse (Shift = circle)', line: 'Drag to draw a line (Shift = 45° steps)', hand: 'Drag to pan the pasteboard', zoom: 'Click to zoom in, Alt-click to zoom out' };
      bar.appendChild(el('span', 'hint', esc(hints[S.tool] || '')));
    }
    syncCmd();
  }
  function alignIcon(a) {
    const L = { left: [14, 10, 14, 8], center: [14, 10, 14, 8], right: [14, 10, 14, 8], justify: [14, 14, 14, 9], 'justify-all': [14, 14, 14, 14] }[a];
    return `<svg viewBox="0 0 16 14" width="14" height="12">${L.map((w, k) => { const x = a === 'center' ? (16 - w) / 2 : a === 'right' ? 15 - w : 1; return `<rect x="${x}" y="${1 + k * 3.2}" width="${w}" height="1.6" fill="currentColor"/>`; }).join('')}</svg>`;
  }
  function syncCmd() {
    const foc = document.activeElement;
    const setV = (id, v) => { const i = $(id); if (i && i !== foc) i.value = v; };
    if ($('#c-font')) {
      const c = charState(); if (!c) return;
      setV('#c-font', c.font);
      const so = $('#c-style'); if (so && so !== foc) { const key = c.font; if (so.dataset.fam !== key) { so.innerHTML = ''; styleOpts(c.font).forEach(([a, b]) => so.add(new Option(b, a))); so.dataset.fam = key; } const p = Fonts.parse(Fonts.resolve(c.font, c.weight, c.italic)); so.value = `${p.weight}|${c.italic ? 1 : 0}`; }
      setV('#c-size', +(+c.size).toFixed(2)); setV('#c-lead', c.lead > 0 ? +(+c.lead).toFixed(2) : ''); $('#c-lead').placeholder = 'auto ' + +(c.size * 1.2).toFixed(1); setV('#c-track', c.track || 0); setV('#c-color', /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '#000000');
      $('#c-b').classList.toggle('on', c.weight >= 600); $('#c-i').classList.toggle('on', !!c.italic); $('#c-u').classList.toggle('on', !!c.under); $('#c-tt').classList.toggle('on', c.caps === 'all'); $('#c-sc').classList.toggle('on', c.caps === 'small');
      document.querySelectorAll('#cmd .al').forEach(b => b.classList.toggle('on', b.dataset.al === c.pe.align));
      const ps = $('#c-ps'); if (ps && ps !== foc) { ps.innerHTML = ''; Object.entries(S.doc.paraStyles).forEach(([k, v]) => ps.add(new Option(v.name + (Object.keys(M.stripMeta(c.para)).filter(x => x !== 'ps').length ? '' : ''), k))); ps.value = c.ps; }
      const cs = $('#c-cs'); if (cs && cs !== foc) { cs.innerHTML = ''; cs.add(new Option('[None]', '')); Object.entries(S.doc.charStyles).forEach(([k, v]) => cs.add(new Option(v.name, k))); cs.value = c.cs || ''; }
    } else if ($('#o-x')) {
      const b = Tools.selBox(); if (!b) return;
      const pp = curOrigin(), u = U();
      const one = S.sel.length === 1 ? info(S.sel[0]).item : null;
      setV('#o-x', M.fmtU(b.x - pp.x, u)); setV('#o-y', M.fmtU(b.y - pp.y, u));
      setV('#o-w', M.fmtU(one && one.type !== 'group' ? one.w : b.w, u)); setV('#o-h', M.fmtU(one && one.type !== 'group' ? one.h : b.h, u));
      setV('#o-r', one ? +(one.rot || 0).toFixed(1) : 0);
      const f = one || selItems()[0];
      setV('#o-fill', f?.fill && /^#[0-9a-f]{6}$/i.test(f.fill) ? f.fill : '#ffffff'); setV('#o-stroke', f?.stroke && /^#[0-9a-f]{6}$/i.test(f.stroke) ? f.stroke : '#000000');
      $('#o-fn').classList.toggle('on', !f?.fill); $('#o-sn').classList.toggle('on', !f?.stroke);
      setV('#o-sw', f?.sw ?? 1); setV('#o-op', Math.round((f?.opacity ?? 1) * 100)); $('#o-opv').textContent = Math.round((f?.opacity ?? 1) * 100) + '%';
    }
  }
  function curOrigin() { const id = S.sel[0]; const inf = id && info(id); return inf ? placedOf(inf.page) : curPlaced(); }
  function parseLen(v) { const m = /^\s*(-?[\d.]+)\s*(mm|in|pt|px|pc|")?\s*$/i.exec(String(v)); if (!m) return null; const u = m[2] ? (m[2] === '"' ? 'in' : m[2].toLowerCase()) : U(); return M.fromU(+m[1], u); }
  function setGeo(k, val) {
    if (k === 'rot') { const deg = parseFloat(val); if (isNaN(deg)) return syncCmd(); for (const i of S.sel.map(info)) { if (i.item.type === 'group') continue; const it = i.item, d = deg - (it.rot || 0); Tools.rotateAbout(it, structuredClone(it), d, it.x + it.w / 2, it.y + it.h / 2); } commit('Rotate'); return; }
    const v = parseLen(val); if (v == null) return syncCmd();
    const b = Tools.selBox(), pp = curOrigin();
    if (k === 'x' || k === 'y') { const d = k === 'x' ? v - (b.x - pp.x) : v - (b.y - pp.y); for (const i of S.sel.map(info)) { Tools.moveTo(i.item, structuredClone(i.item), k === 'x' ? d : 0, k === 'y' ? d : 0); if (i.parent) Geo.syncGroup(i.parent); } commit('Move'); return; }
    if (S.sel.length === 1 && info(S.sel[0]).item.type !== 'group') {
      const it = info(S.sel[0]).item, o = structuredClone(it);
      if (k === 'w') { it.w = Math.max(it.type === 'line' ? 0 : 1, v); } else { it.h = Math.max(it.type === 'line' ? 0 : 1, v); }
      if (it.type === 'table') { it.colW = o.colW.map(c => c * it.w / o.w); it.rowH = o.rowH.map(r => r * it.h / o.h); }
      if (it.type === 'image' && it.fit) Tools.applyFit(it, it.fit);
      commit('Resize'); return;
    }
    const sx = k === 'w' ? Math.max(1, v) / b.w : 1, sy = k === 'h' ? Math.max(1, v) / b.h : 1;
    for (const i of S.sel.map(info)) { const p = placedOf(i.page); Tools.scaleItem(i.item, structuredClone(i.item), b.x - p.x, b.y - p.y, sx, sy); }
    commit('Resize');
  }
  let liveT = null;
  function setProp(k, v, live) {
    const items = []; for (const it of selItems()) M.walkItems([it], x => { if (x.type !== 'group') items.push(x); });
    if (k === 'opacity') { selItems().forEach(it => it.opacity = v); }
    else items.forEach(it => { if (k === 'fill' && it.type === 'line') return; it[k] = v; if (k === 'fill') delete it.grad; if (k === 'stroke' && v && !(it.sw > 0)) it.sw = 1; });
    if (live) { S.eng = new Engine(S.doc); requestRender(true); return; }
    commit({ fill: 'Fill', stroke: 'Stroke', sw: 'Stroke Weight', opacity: 'Opacity' }[k] || 'Change ' + k);
  }

  /* ---------- properties panel ---------- */
  let propSig = '';
  const binds = [];
  function pf(h) { return el('div', 'pform', h); }
  function section(title, body) { const s = el('div', 'psec'); s.appendChild(el('div', 'psh', esc(title))); s.appendChild(body); return s; }
  function bindRow(form, label, inputHtml, get, set, opts = {}) {
    const lab = el('label', null, esc(label)); const wrap = el('div', 'pc', inputHtml); form.append(lab, wrap);
    const inp = wrap.querySelector('input,select');
    const read = () => inp.type === 'checkbox' ? inp.checked : inp.value;
    const evt = opts.live ? 'input' : 'change';
    inp.addEventListener(evt, () => set(read(), false));
    if (opts.live) inp.addEventListener('change', () => set(read(), true));
    if (inp.tagName === 'INPUT' && inp.type === 'text') inp.addEventListener('keydown', e => { if (e.key === 'Enter') inp.blur(); });
    binds.push({ inp, get, extra: wrap });
    return wrap;
  }
  function lenRow(form, label, get, set) { return bindRow(form, label, `<input type="text">`, () => M.fmtU(get(), U()), v => { const n = parseLen(v); if (n != null) set(n); else syncProps(); }); }
  function numRow(form, label, get, set, step = 1) { return bindRow(form, label, `<input type="number" step="${step}">`, () => +(+get()).toFixed(2), v => { const n = parseFloat(v); if (!isNaN(n)) set(n); }); }
  function buildProps() {
    const host = $('#props'); binds.length = 0; host.innerHTML = '';
    const its = selItems(), one = its.length === 1 ? its[0] : null;
    const textCtx = S.edit || its.some(i => i.type === 'text');
    if (S.edit || (one && one.type === 'text')) host.appendChild(textProps());
    if (textCtx && (S.edit || one?.type === 'text')) host.appendChild(frameTextProps());
    if (its.length && !S.edit) host.appendChild(objProps(its, one));
    if (one?.type === 'image') host.appendChild(imageProps(one));
    if (one?.type === 'table') host.appendChild(tableProps(one));
    if (!its.length && !S.edit) host.appendChild(docProps());
    syncProps();
  }
  function textProps() {
    const f = pf(''); const P = () => charState()?.pe || M.DEF; const C = () => charState() || M.DEF;
    numRow(f, 'Left indent (pt)', () => P().indL, v => applyPara({ indL: v }, 'Indent'));
    numRow(f, 'Right indent (pt)', () => P().indR, v => applyPara({ indR: v }, 'Indent'));
    numRow(f, 'First line (pt)', () => P().indF, v => applyPara({ indF: v }, 'Indent'));
    numRow(f, 'Space before (pt)', () => P().spB, v => applyPara({ spB: Math.max(0, v) }, 'Space Before'));
    numRow(f, 'Space after (pt)', () => P().spA, v => applyPara({ spA: Math.max(0, v) }, 'Space After'));
    numRow(f, 'Drop cap lines', () => P().dropL, v => applyPara({ dropL: Aero.clamp(v | 0, 0, 10) }, 'Drop Cap'));
    numRow(f, 'Drop cap chars', () => P().dropC, v => applyPara({ dropC: Aero.clamp(v | 0, 1, 10) }, 'Drop Cap'));
    bindRow(f, 'Hyphenate', '<input type="checkbox">', () => P().hyph !== false, v => applyPara({ hyph: !!v }, 'Hyphenation'));
    bindRow(f, 'Align to baseline grid', '<input type="checkbox">', () => !!P().grid, v => applyPara({ grid: !!v }, 'Align to Grid'));
    const c = pf('');
    numRow(c, 'Baseline shift (pt)', () => C().shift || 0, v => applyChar({ shift: v }, 'Baseline Shift'), 0.5);
    bindRow(c, 'Case', `<select><option value="none">Normal</option><option value="all">All Caps</option><option value="small">Small Caps</option></select>`, () => C().caps || 'none', v => applyChar({ caps: v }, 'Case'));
    bindRow(c, 'Underline', '<input type="checkbox">', () => !!C().under, v => applyChar({ under: !!v }, 'Underline'));
    bindRow(c, 'Strikethrough', '<input type="checkbox">', () => !!C().strike, v => applyChar({ strike: !!v }, 'Strikethrough'));
    const box = el('div'); box.appendChild(section('Paragraph', f)); box.appendChild(section('Character', c));
    const btns = el('div', 'pbtns'); btns.innerHTML = `<button class="aero-btn small" data-a="clr">Clear Overrides</button><button class="aero-btn small" data-a="lorem">Placeholder Text</button>`;
    btns.querySelector('[data-a=clr]').onclick = () => { const ts = textTargets(); for (const { s, a, b } of ts) { const lo = a === b ? M.paraStart(s, M.paraIndexAt(s, a)) : a, hi = a === b ? M.paraEnd(s, M.paraIndexAt(s, a)) : b; for (let i = lo; i < hi; i++) { const at = s.attrs[s.ca[i]]; s.ca[i] = M.attrIdx(s, at.cs ? { cs: at.cs } : {}); } const p0 = M.paraIndexAt(s, lo), p1 = M.paraIndexAt(s, hi); for (let k = p0; k <= p1; k++) s.paras[k] = { ps: s.paras[k].ps }; } commit('Clear Overrides'); };
    btns.querySelector('[data-a=lorem]').onclick = fillPlaceholder;
    box.appendChild(btns);
    return box;
  }
  function frameTextProps() {
    const it0 = () => S.edit ? info(S.edit.fid)?.item : selItems().find(i => i.type === 'text');
    const f = pf('');
    numRow(f, 'Columns', () => it0()?.cols || 1, v => { const it = it0(); if (it) { it.cols = Aero.clamp(v | 0, 1, 12); commit('Columns'); } });
    lenRow(f, 'Gutter', () => it0()?.gutter ?? 12, v => { const it = it0(); if (it) { it.gutter = Math.max(0, v); commit('Gutter'); } });
    lenRow(f, 'Inset', () => it0()?.inset || 0, v => { const it = it0(); if (it) { it.inset = Math.max(0, v); commit('Inset'); } });
    bindRow(f, 'Vertical align', `<select><option value="top">Top</option><option value="center">Center</option><option value="bottom">Bottom</option></select>`, () => it0()?.valign || 'top', v => { const it = it0(); if (it) { it.valign = v; commit('Vertical Justification'); } });
    const st = el('div', 'pnote'); binds.push({ inp: null, get: () => { const it = it0(); if (!it) return ''; const L = S.eng.frameLayout(it, labelFor(placedOf(info(it.id).page))); const s = S.doc.stories[it.story]; const k = s.frames.indexOf(it.id); st.innerHTML = `Frame ${k + 1} of ${s.frames.length} in story · ${s.text.length} characters${L?.overset ? ' · <b style="color:#c01818">overset text</b>' : ''}`; } });
    f.appendChild(st); st.style.gridColumn = '1/-1';
    return section('Text Frame', f);
  }
  function objProps(its, one) {
    const f = pf('');
    if (one && one.type !== 'group' && one.type !== 'line' && one.type !== 'table') {
      lenRow(f, 'Corner radius', () => one.radius || 0, v => { info(one.id).item.radius = Math.max(0, v); commit('Corner Radius'); });
      const cur = () => info(one.id)?.item || one;
      bindRow(f, 'Fill type', `<select><option value="solid">Solid color</option><option value="grad">Linear gradient</option></select>`, () => cur().grad ? 'grad' : 'solid', v => {
        const it = cur(); if (v === 'grad' && !it.grad) it.grad = { angle: 90, c0: it.fill || '#ffffff', o0: 1, c1: '#1f3b57', o1: 1 }; if (v === 'solid') delete it.grad; commit('Fill Type'); propSig = ''; refresh(true); });
      if (one.grad) {
        const G = () => cur().grad || {};
        const setG = (k, val, lbl) => { const it = cur(); it.grad = { ...it.grad, [k]: val }; commit(lbl); };
        numRow(f, 'Gradient angle (°)', () => G().angle || 0, v => setG('angle', v, 'Gradient Angle'), 15);
        bindRow(f, 'Start color', '<input type="color">', () => G().c0 || '#ffffff', v => setG('c0', v, 'Gradient Color'));
        numRow(f, 'Start opacity %', () => Math.round((G().o0 ?? 1) * 100), v => setG('o0', Aero.clamp(v, 0, 100) / 100, 'Gradient Opacity'), 5);
        bindRow(f, 'End color', '<input type="color">', () => G().c1 || '#000000', v => setG('c1', v, 'Gradient Color'));
        numRow(f, 'End opacity %', () => Math.round((G().o1 ?? 1) * 100), v => setG('o1', Aero.clamp(v, 0, 100) / 100, 'Gradient Opacity'), 5);
      }
    }
    bindRow(f, 'Stroke style', `<select><option value="">Solid</option><option value="1">Dashed</option></select>`, () => (its[0].dash ? '1' : ''), v => { its.forEach(it => M.walkItems([info(it.id).item], x => x.dash = !!v)); commit('Stroke Style'); });
    bindRow(f, 'Text wrap', `<select><option value="none">No wrap</option><option value="box">Wrap around bounding box</option></select>`, () => its[0].wrap || 'none', v => setWrap(v));
    lenRow(f, 'Wrap offset', () => its[0].wrapOff ?? 6, v => { selItems().forEach(it => it.wrapOff = Math.max(0, v)); commit('Wrap Offset'); });
    bindRow(f, 'Layer', `<select>${S.doc.layers.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('')}</select>`, () => its[0].layer, v => { selItems().forEach(it => M.walkItems([it], x => x.layer = v)); commit('Move to Layer'); });
    bindRow(f, 'Locked', '<input type="checkbox">', () => !!its[0].locked, v => lockSel(!!v));
    const sw = el('div', 'swatches'); sw.style.gridColumn = '1/-1';
    S.doc.swatches.forEach(c => { const b = el('button', 'sw'); b.style.background = c; b.title = c + ' — click: fill, Alt+click: stroke'; b.onclick = e => setProp(e.altKey ? 'stroke' : 'fill', c); sw.appendChild(b); });
    const none = el('button', 'sw none'); none.title = 'None — click: no fill, Alt+click: no stroke'; none.onclick = e => setProp(e.altKey ? 'stroke' : 'fill', null); sw.appendChild(none);
    f.appendChild(sw);
    const al = el('div', 'pbtns'); al.style.gridColumn = '1/-1';
    al.innerHTML = [['left', 'Align left'], ['hcenter', 'Align centers'], ['right', 'Align right'], ['top', 'Align top'], ['vcenter', 'Align middles'], ['bottom', 'Align bottom']].map(([k, t]) => `<button class="aero-iconbtn" data-al="${k}" title="${t}${S.sel.length === 1 ? ' (to margins)' : ''}">${alignObjIcon(k)}</button>`).join('') + `<button class="aero-iconbtn" data-d="h" title="Distribute horizontally">${alignObjIcon('dh')}</button><button class="aero-iconbtn" data-d="v" title="Distribute vertically">${alignObjIcon('dv')}</button>`;
    al.querySelectorAll('[data-al]').forEach(b => b.onclick = () => align(b.dataset.al)); al.querySelectorAll('[data-d]').forEach(b => b.onclick = () => distribute(b.dataset.d));
    f.appendChild(al);
    return section(its.length > 1 ? `${its.length} Objects` : ({ rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', image: 'Image Frame', text: 'Text Frame', group: 'Group', table: 'Table' }[one.type] || 'Object'), f);
  }
  function alignObjIcon(k) {
    const r = (x, y, w, h, c = '#3a78c2') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}" rx=".6"/>`;
    const L = (x1, y1, x2, y2) => `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="#1e395b" stroke-width="1.2"/>`;
    const m = { left: L(2, 1, 2, 15) + r(3, 3, 9, 4) + r(3, 9, 6, 4), hcenter: L(8, 1, 8, 15) + r(3, 3, 10, 4) + r(5, 9, 6, 4), right: L(14, 1, 14, 15) + r(4, 3, 9, 4) + r(7, 9, 6, 4),
      top: L(1, 2, 15, 2) + r(3, 3, 4, 9) + r(9, 3, 4, 6), vcenter: L(1, 8, 15, 8) + r(3, 3, 4, 10) + r(9, 5, 4, 6), bottom: L(1, 14, 15, 14) + r(3, 4, 4, 9) + r(9, 7, 4, 6),
      dh: r(1, 4, 3, 8) + r(6.5, 4, 3, 8) + r(12, 4, 3, 8), dv: r(4, 1, 8, 3) + r(4, 6.5, 8, 3) + r(4, 12, 8, 3) };
    return `<svg viewBox="0 0 16 16">${m[k]}</svg>`;
  }
  function imageProps(it) {
    const f = pf(''); const im = S.images[it.img];
    const n = el('div', 'pnote'); n.style.gridColumn = '1/-1';
    binds.push({ inp: null, get: () => { const t = info(it.id)?.item; const I = t && S.images[t.img]; n.innerHTML = I ? `${esc(I.name)} · ${I.w}×${I.h}px · effective ${Math.round(72 / t.cs)} ppi${72 / t.cs < 150 ? ' <b style="color:#c06010">(low for print)</b>' : ''}` : 'Empty frame — use File ▸ Place (Ctrl+D) or drop an image here'; } });
    f.appendChild(n);
    if (im) {
      numRow(f, 'Content scale %', () => (info(it.id)?.item.cs || 1) * 100, v => { const t = info(it.id).item; const k = Math.max(0.01, v / 100); const cx = t.w / 2, cy = t.h / 2; t.cx = cx - (cx - t.cx) * k / t.cs; t.cy = cy - (cy - t.cy) * k / t.cs; t.cs = k; t.fit = null; commit('Scale Content'); });
      bindRow(f, 'Auto-fit', `<select><option value="">Off</option><option value="fit">Fit proportionally</option><option value="fill">Fill proportionally</option></select>`, () => info(it.id)?.item.fit || '', v => { const t = info(it.id).item; t.fit = v || null; if (v) Tools.applyFit(t, v); commit('Auto-Fit'); });
    }
    const b = el('div', 'pbtns'); b.style.gridColumn = '1/-1';
    b.innerHTML = `<button class="aero-btn small" data-f="fit">Fit</button><button class="aero-btn small" data-f="fill">Fill</button><button class="aero-btn small" data-f="center">Center</button><button class="aero-btn small" data-f="frame">Frame to Content</button><button class="aero-btn small" data-f="place">${im ? 'Replace…' : 'Place…'}</button>`;
    b.querySelectorAll('[data-f]').forEach(x => x.onclick = () => x.dataset.f === 'place' ? IO.place() : fitImage(x.dataset.f));
    if (!im) b.querySelectorAll('[data-f]:not([data-f=place])').forEach(x => x.disabled = true);
    f.appendChild(b);
    return section('Image', f);
  }
  function tableProps(t0) {
    const t = () => info(t0.id)?.item || t0; const f = pf('');
    const n = el('div', 'pnote'); n.style.gridColumn = '1/-1';
    binds.push({ inp: null, get: () => { n.textContent = `${t().rowH.length} rows × ${t().colW.length} columns` + (S.cell ? ` · cell ${S.cell.r + 1}, ${S.cell.c + 1}` : ' · double-click a cell to edit'); } });
    f.appendChild(n);
    numRow(f, 'Header rows', () => t().header || 0, v => { t().header = Aero.clamp(v | 0, 0, t().rowH.length); commit('Header Rows'); });
    numRow(f, 'Text size (pt)', () => t().tsize, v => { t().tsize = Math.max(4, v); commit('Table Text Size'); }, 0.5);
    bindRow(f, 'Font', `<select>${Fonts.families.map(x => `<option>${esc(x)}</option>`).join('')}</select>`, () => t().tfont, v => { t().tfont = v; commit('Table Font'); });
    bindRow(f, 'Header fill', '<input type="color">', () => t().hfill || '#ffffff', v => { t().hfill = v; commit('Header Fill'); });
    bindRow(f, 'Header text', '<input type="color">', () => t().hcolor || '#000000', v => { t().hcolor = v; commit('Header Text'); });
    bindRow(f, 'Alternate rows', '<input type="color">', () => t().zebra || '#ffffff', v => { t().zebra = v; commit('Alternating Fill'); });
    bindRow(f, 'Border color', '<input type="color">', () => t().bcolor, v => { t().bcolor = v; commit('Border Color'); });
    numRow(f, 'Border weight (pt)', () => t().bw, v => { t().bw = Math.max(0, v); commit('Border Weight'); }, 0.25);
    if (S.cell) {
      bindRow(f, 'Cell fill', '<input type="color">', () => t().cells[S.cell.r]?.[S.cell.c]?.fill || '#ffffff', v => { t().cells[S.cell.r][S.cell.c].fill = v; commit('Cell Fill'); });
      bindRow(f, 'Cell align', `<select><option value="">Default</option><option value="left">Left</option><option value="center">Center</option><option value="right">Right</option></select>`, () => t().cells[S.cell.r]?.[S.cell.c]?.align || '', v => { const c = t().cells[S.cell.r][S.cell.c]; if (v) c.align = v; else delete c.align; commit('Cell Align'); });
      lenRow(f, 'Row height', () => t().rowH[S.cell.r], v => { const T0 = t(); T0.rowH[S.cell.r] = Math.max(4, v); T0.h = T0.rowH.reduce((a, b) => a + b, 0); commit('Row Height'); });
      lenRow(f, 'Column width', () => t().colW[S.cell.c], v => { const T0 = t(); T0.colW[S.cell.c] = Math.max(4, v); T0.w = T0.colW.reduce((a, b) => a + b, 0); commit('Column Width'); });
    }
    const b = el('div', 'pbtns'); b.style.gridColumn = '1/-1';
    b.innerHTML = `<button class="aero-btn small" data-o="rowAbove">+ Row ↑</button><button class="aero-btn small" data-o="rowBelow">+ Row ↓</button><button class="aero-btn small" data-o="colLeft">+ Col ←</button><button class="aero-btn small" data-o="colRight">+ Col →</button><button class="aero-btn small" data-o="delRow">− Row</button><button class="aero-btn small" data-o="delCol">− Col</button>`;
    b.querySelectorAll('[data-o]').forEach(x => x.onclick = () => tableOp(x.dataset.o));
    f.appendChild(b);
    return section('Table', f);
  }
  function docProps() {
    const d = S.doc, f = pf('');
    const n = el('div', 'pnote'); n.style.gridColumn = '1/-1';
    binds.push({ inp: null, get: () => { const pre = M.PRESETS.find(p => Math.abs(p[1] - d.w) < .6 && Math.abs(p[2] - d.h) < .6 || Math.abs(p[2] - d.w) < .6 && Math.abs(p[1] - d.h) < .6); n.innerHTML = `<b>${pre ? pre[0] : 'Custom'}</b> · ${M.fmtU(d.w, d.units)} × ${M.fmtU(d.h, d.units)} ${d.units} · ${d.pages.length} page${d.pages.length > 1 ? 's' : ''}${d.facing ? ' · facing' : ''}`; } });
    f.appendChild(n);
    bindRow(f, 'Units', `<select>${Object.entries(M.UNIT_NAMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>`, () => d.units, v => { d.units = v; commit('Units'); });
    if (S.mode.kind === 'doc') bindRow(f, 'Page master', `<select><option value="">[None]</option>${d.masters.map(m => `<option value="${esc(m.id)}">${esc(m.prefix + '-' + m.name)}</option>`).join('')}</select>`, () => d.pages[S.curPage]?.master || '', v => applyMaster(v));
    else bindRow(f, 'Master name', '<input type="text">', () => d.masters.find(m => m.id === S.mode.id)?.name || '', v => { const m = d.masters.find(m => m.id === S.mode.id); if (m) { m.name = String(v).slice(0, 40) || 'Master'; commit('Rename Master'); } });
    numRow(f, 'Grid start (pt)', () => d.grid.start, v => { d.grid.start = Math.max(0, v); commit('Baseline Grid'); }, 0.5);
    numRow(f, 'Grid increment (pt)', () => d.grid.step, v => { d.grid.step = Math.max(2, v); commit('Baseline Grid'); }, 0.5);
    const b = el('div', 'pbtns'); b.style.gridColumn = '1/-1';
    b.innerHTML = `<button class="aero-btn small" data-a="setup">Document Setup…</button><button class="aero-btn small" data-a="mc">Margins & Columns…</button>`;
    b.querySelector('[data-a=setup]').onclick = () => docDialog(false); b.querySelector('[data-a=mc]').onclick = marginsDialog;
    f.appendChild(b);
    return section(S.mode.kind === 'master' ? 'Master Page' : 'Document', f);
  }
  function syncProps() {
    const foc = document.activeElement;
    for (const b of binds) {
      if (!b.inp) { b.get(); continue; }
      if (b.inp === foc) continue;
      let v; try { v = b.get(); } catch (e) { continue; }
      if (b.inp.type === 'checkbox') b.inp.checked = !!v; else if (v != null) b.inp.value = v;
    }
  }

  /* ---------- layers panel ---------- */
  function buildLayers() {
    const host = $('#layers'); host.innerHTML = '';
    const selLayers = new Set(selItems().map(i => i.layer));
    S.doc.layers.forEach((l, k) => {
      const count = S.doc.pages.reduce((n, p) => n + p.items.filter(i => i.layer === l.id).length, 0);
      const row = el('div', 'aero-item lrow' + (l.id === S.activeLayer ? ' sel' : ''));
      row.innerHTML = `<button class="lb eye" title="Show/hide">${l.visible !== false ? '<svg viewBox="0 0 16 16"><path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z" fill="#fff" stroke="#28507a"/><circle cx="8" cy="8" r="2.4" fill="#28507a"/></svg>' : ''}</button><button class="lb lock" title="Lock/unlock">${l.locked ? '<svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="7" rx="1" fill="#e3a21a" stroke="#8a5a0a"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="#8a5a0a" stroke-width="1.5"/></svg>' : ''}</button><span class="lc" style="background:${esc(l.color)}"></span><span class="grow"></span><span class="dim">${count}</span>${selLayers.has(l.id) ? '<span class="lsel" style="background:' + esc(l.color) + '"></span>' : ''}`;
      row.querySelector('.grow').textContent = l.name;
      row.onclick = e => { if (e.target.closest('.lb')) return; S.activeLayer = l.id; buildLayers(); };
      row.ondblclick = async e => { if (e.target.closest('.lb')) return; layerOptions(l); };
      row.querySelector('.eye').onclick = () => { l.visible = l.visible === false; commit(l.visible ? 'Show Layer' : 'Hide Layer'); };
      row.querySelector('.lock').onclick = () => { l.locked = !l.locked; commit(l.locked ? 'Lock Layer' : 'Unlock Layer'); };
      host.appendChild(row);
    });
  }
  function layerOptions(l) {
    Aero.dialog({ title: 'Layer Options', fields: [{ key: 'name', label: 'Name', type: 'text', value: l.name }, { key: 'color', label: 'Color', type: 'color', value: l.color }],
      onOK: v => { const L = S.doc.layers.find(x => x.id === l.id); L.name = String(v.name).slice(0, 40) || 'Layer'; L.color = v.color; commit('Layer Options'); } });
  }
  const LCOL = ['#4f7fd9', '#d9534f', '#3fae5a', '#e0a020', '#8a5fd0', '#20a8b8', '#d05fa0'];
  const layerCmd = {
    add() { const n = S.doc.layers.length + 1; const l = { id: 'L' + M.uid(), name: 'Layer ' + n, color: LCOL[(n - 1) % LCOL.length], visible: true, locked: false }; S.doc.layers.unshift(l); S.activeLayer = l.id; commit('New Layer'); },
    async del() {
      if (S.doc.layers.length < 2) { Aero.toast('A document needs at least one layer'); return; }
      const l = S.doc.layers.find(x => x.id === S.activeLayer);
      const ids = []; for (const p of [...S.doc.pages, ...S.doc.masters.flatMap(m => m.pages)]) for (const it of p.items) if (it.layer === l.id) ids.push(it.id);
      if (ids.length && !(await Aero.confirm('Delete Layer', `Layer “${l.name}” contains ${ids.length} object(s). Delete the layer and its objects?`, 'Delete'))) return;
      ids.forEach(id => Tools.removeItemById(id)); S.doc.layers = S.doc.layers.filter(x => x !== l); commit('Delete Layer');
    },
    move(d) { const L = S.doc.layers, k = L.findIndex(x => x.id === S.activeLayer), j = k + d; if (j < 0 || j >= L.length) return; [L[k], L[j]] = [L[j], L[k]]; commit('Reorder Layers'); },
    toActive() { if (!S.sel.length) { Aero.toast('Select objects first'); return; } selItems().forEach(it => M.walkItems([it], x => x.layer = S.activeLayer)); commit('Move to Layer'); },
  };

  /* ---------- styles panel ---------- */
  function buildStyles() {
    const c = charState();
    const ph = $('#pstyles'); ph.innerHTML = '';
    Object.entries(S.doc.paraStyles).forEach(([id, s]) => {
      const row = el('div', 'aero-item' + (c && c.ps === id ? ' sel' : ''), `<span class="sti">¶</span><span class="grow"></span>`);
      row.querySelector('.grow').textContent = s.name; row.dataset.id = id;
      row.onclick = () => { selStyle.p = id; applyParaStyle(id); };
      row.ondblclick = () => paraStyleDialog(id, false);
      ph.appendChild(row);
    });
    const ch = $('#cstyles'); ch.innerHTML = '';
    [['', { name: '[None]' }], ...Object.entries(S.doc.charStyles)].forEach(([id, s]) => {
      const row = el('div', 'aero-item' + (c && (c.cs || '') === id ? ' sel' : ''), `<span class="sti">A</span><span class="grow"></span>`);
      row.querySelector('.grow').textContent = s.name;
      row.onclick = () => { selStyle.c = id; applyCharStyle(id || null); };
      if (id) row.ondblclick = () => charStyleDialog(id, false);
      ch.appendChild(row);
    });
  }
  const selStyle = { p: null, c: null };

  /* ---------- pages panel ---------- */
  let thumbT = null;
  function thumbsSoon() { clearTimeout(thumbT); thumbT = setTimeout(buildPages, 220); }
  let thumbQ = [], thumbJob = 0;
  function thumb(page, idx, kind, master, side) {
    const W = S.doc.w, H = S.doc.h, tw = kind === 'master' ? 30 : 38, th = Math.max(16, Math.round(tw * H / W));
    const c = el('canvas'); const dpr = DPR(); c.width = tw * dpr; c.height = th * dpr; c.style.width = tw + 'px'; c.style.height = th + 'px';
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    thumbQ.push(() => paintThumb(c, page, idx, kind, master));
    return c;
  }
  // thumbnails are painted in small batches so big documents stay responsive
  function pumpThumbs(job) {
    if (job !== thumbJob) return;
    const t0 = performance.now();
    while (thumbQ.length && performance.now() - t0 < 12) thumbQ.shift()();
    if (thumbQ.length) setTimeout(() => pumpThumbs(job), 16);
  }
  function paintThumb(c, page, idx, kind, master) {
    if (!c.isConnected) return;
    const W = S.doc.w, H = S.doc.h, dpr = DPR();
    const ctx = c.getContext('2d'); const s = c.width / W; ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip();
    try { Render.drawPage(ctx, { engine: S.eng, images: S.images, label: kind === 'doc' ? String(idx + 1) : master.prefix }, page, kind === 'doc' ? idx : null); } catch (e) { console.error(e); }
    ctx.restore();
  }
  function buildPages() {
    const host = $('#pages'); if (!host) return; const scroll = host.scrollTop; host.innerHTML = '';
    thumbQ = []; const job = ++thumbJob; setTimeout(() => pumpThumbs(job), 0);
    const d = S.doc;
    const ms = el('div', 'pp-masters');
    const none = el('div', 'pp-m' , '<div class="pp-mt">[None]</div>'); none.draggable = true; none.ondragstart = e => e.dataTransfer.setData('text/master', '-');
    ms.appendChild(none);
    d.masters.forEach(m => {
      const t = el('div', 'pp-m' + (S.mode.kind === 'master' && S.mode.id === m.id ? ' sel' : ''));
      const sp = el('div', 'pp-spread'); m.pages.forEach((p, side) => sp.appendChild(thumb(p, null, 'master', m, side)));
      t.appendChild(sp); t.appendChild(el('div', 'pp-mt', esc(`${m.prefix}-${m.name}`)));
      t.title = 'Double-click to edit this master • drag onto a page to apply';
      t.draggable = true; t.ondragstart = e => e.dataTransfer.setData('text/master', m.id);
      t.ondblclick = () => editMaster(m.id);
      ms.appendChild(t);
    });
    host.appendChild(ms);
    const pg = el('div', 'pp-pages');
    const rows = []; if (d.facing) { rows.push([0]); for (let i = 1; i < d.pages.length; i += 2) rows.push(i + 1 < d.pages.length ? [i, i + 1] : [i]); } else d.pages.forEach((_, i) => rows.push([i]));
    for (const r of rows) {
      const row = el('div', 'pp-row' + (d.facing ? ' facing' : ''));
      if (d.facing && r.length === 1 && r[0] === 0) row.classList.add('right');
      if (d.facing && r.length === 1 && r[0] !== 0) row.classList.add('left');
      const sp = el('div', 'pp-spread');
      for (const i of r) {
        const p = d.pages[i];
        const t = el('div', 'pp-p' + (S.mode.kind === 'doc' && i === S.curPage ? ' sel' : ''));
        t.appendChild(thumb(p, i, 'doc'));
        const mm = d.masters.find(m => m.id === p.master);
        if (mm) t.appendChild(el('span', 'pp-pre', esc(mm.prefix)));
        t.appendChild(el('div', 'pp-n', String(i + 1)));
        t.draggable = true; t.title = `Page ${i + 1}${mm ? ' · master ' + mm.prefix : ''} — drag to reorder`;
        t.onclick = () => View.goPage(i);
        t.ondblclick = () => { View.goPage(i); View.fitPage(); };
        t.ondragstart = e => e.dataTransfer.setData('text/page', String(i));
        t.ondragover = e => { e.preventDefault(); t.classList.add('drop'); };
        t.ondragleave = () => t.classList.remove('drop');
        t.ondrop = e => { e.preventDefault(); e.stopPropagation(); t.classList.remove('drop'); const m = e.dataTransfer.getData('text/master'); if (m) { S.curPage = i; applyMaster(m === '-' ? null : m, [i]); return; } const from = e.dataTransfer.getData('text/page'); if (from !== '') movePage(+from, i); };
        sp.appendChild(t);
      }
      row.appendChild(sp); pg.appendChild(row);
    }
    host.appendChild(pg);
    host.scrollTop = scroll;
    $('#pcount').textContent = `${d.pages.length} page${d.pages.length > 1 ? 's' : ''}${d.facing ? ' in ' + rows.length + ' spreads' : ''}`;
  }

  /* ---------- status ---------- */
  function status() {
    $('#st-zoom').textContent = Math.round(S.view.z * 100) + '%';
    $('#st-page').textContent = S.mode.kind === 'master' ? `Editing master ${S.doc.masters.find(m => m.id === S.mode.id)?.prefix || ''}` : `Page ${S.curPage + 1} of ${S.doc.pages.length}`;
    let over = 0; S.eng.ensure(); for (const r of S.eng.storyRes.values()) if (r.overset) over++;
    let sel = '';
    if (S.edit) { const [a, b] = T().range(); sel = a === b ? `Text cursor at ${a}` : `${b - a} characters selected`; }
    else if (S.sel.length === 1) { const it = info(S.sel[0]).item; sel = { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', image: 'Image frame', text: 'Text frame', group: 'Group', table: 'Table' }[it.type] + (it.locked ? ' (locked)' : ''); }
    else if (S.sel.length) sel = `${S.sel.length} objects selected`;
    $('#st-sel').textContent = sel;
    const ov = $('#st-over'); ov.textContent = over ? `⚠ ${over} overset ${over > 1 ? 'stories' : 'story'}` : 'No errors'; ov.className = over ? 'err' : 'ok';
  }
  function statusPos(wx, wy) { const p = pageAt(wx, wy, true) || curPlaced(); if (!p) return; $('#st-pos').textContent = `X ${M.fmtU(wx - p.x, U())}  Y ${M.fmtU(wy - p.y, U())} ${U()}`; }

  /* ---------- refresh ---------- */
  let rq = false, rebuildReq = false;
  function refresh(rebuild) {
    if (rebuild) rebuildReq = true;
    if (rq) return; rq = true;
    queueMicrotask(() => {
      rq = false;
      if (!S.doc || !S.eng) return;
      buildCmd();
      const sig = JSON.stringify([S.sel, !!S.edit, S.edit?.fid, S.content, S.cell && [S.cell.id, S.cell.r, S.cell.c], S.mode, S.sel.map(id => info(id)?.item.type), S.doc.layers.length, Object.keys(S.doc.masters).length]);
      if (rebuildReq || sig !== propSig) { propSig = sig; buildProps(); } else syncProps();
      rebuildReq = false;
      buildLayers(); buildStyles(); status(); thumbsSoon();
      $('#welcome').hidden = !(S.mode.kind === 'doc' && !Aero.dirty && S.doc.pages.every(p => !p.items.length) && S.doc.masters.every(m => m.pages.every(p => !p.items.length)));
    });
  }
  function historyList() { const h = $('#hist'); if (h) Aero.renderHistory(h, S.hist, i => { flushTyping(true); const st = S.hist.go(i); if (st) restore(st); }); }
  function syncEditor() {
    const ta = $('#ta');
    if (!S.edit) return;
    ta.value = T().selectedText(); ta.select();
    if (document.activeElement !== ta) ta.focus({ preventScroll: true });
  }

  /* ---------- build ---------- */
  function build() {
    Aero.init({ name: 'Lumen Layout', icon: '../kit/icons/layout.png', doc: 'Untitled', menus: menus(),
      onDropFiles: files => IO.dropFiles(files), dropTarget: $('#stage'), dropText: 'Drop images or text to place • .llay to open',
      onSave: async () => { try { return !!(await IO.save(false)); } catch (e) { return false; } } });
    toolbox = Aero.toolbox($('#tools'), [
      { id: 'select', title: 'Selection', key: 'V', icon: ICON.select }, { id: 'direct', title: 'Direct Selection', key: 'A', icon: ICON.direct }, null,
      { id: 'type', title: 'Type', key: 'T', icon: ICON.type }, { id: 'frame', title: 'Rectangle Frame (image)', key: 'F', icon: ICON.frame },
      { id: 'rect', title: 'Rectangle', key: 'M', icon: ICON.rect }, { id: 'ellipse', title: 'Ellipse', key: 'L', icon: ICON.ellipse }, { id: 'line', title: 'Line', key: '\\', icon: ICON.line }, null,
      { id: 'hand', title: 'Hand', key: 'H', icon: ICON.hand }, { id: 'zoom', title: 'Zoom', key: 'Z', icon: ICON.zoom }], id => setTool(id));
    toolbox.set('select');
    // nudge & misc shortcuts
    const n = (dx, dy) => () => nudge(dx, dy);
    Aero.shortcut('ArrowLeft', n(-1, 0)); Aero.shortcut('ArrowRight', n(1, 0)); Aero.shortcut('ArrowUp', n(0, -1)); Aero.shortcut('ArrowDown', n(0, 1));
    Aero.shortcut('Shift+ArrowLeft', n(-10, 0)); Aero.shortcut('Shift+ArrowRight', n(10, 0)); Aero.shortcut('Shift+ArrowUp', n(0, -10)); Aero.shortcut('Shift+ArrowDown', n(0, 10));
    // shifted punctuation arrives as the shifted character (e.g. '>' rather than Shift+.)
    Aero.shortcut('Ctrl+>', () => cmd.bumpSize(1)); Aero.shortcut('Ctrl+<', () => cmd.bumpSize(-1));
    Aero.shortcut('Ctrl+}', () => arrange('front')); Aero.shortcut('Ctrl+{', () => arrange('back')); Aero.shortcut('Ctrl+:', () => toggleOpt('snap'));
    // tabs
    document.querySelectorAll('#ptabs .aero-tab').forEach(t => t.onclick = () => { document.querySelectorAll('#ptabs .aero-tab').forEach(x => x.classList.toggle('on', x === t)); document.querySelectorAll('.tabpane').forEach(p => p.hidden = p.id !== t.dataset.p); if (t.dataset.p === 'tp-hist') historyList(); });
    // pages iconbar
    const pb = (id, fn) => $(id).onclick = fn;
    pb('#pg-add', () => addPage()); pb('#pg-dup', () => addPage(S.curPage, true)); pb('#pg-del', () => S.mode.kind === 'master' ? deleteMaster(S.mode.id) : deletePage()); pb('#pg-up', () => movePage(S.curPage, S.curPage - 1)); pb('#pg-down', () => movePage(S.curPage, S.curPage + 1)); pb('#pg-master', newMaster);
    pb('#ly-add', layerCmd.add); pb('#ly-del', layerCmd.del); pb('#ly-up', () => layerCmd.move(-1)); pb('#ly-down', () => layerCmd.move(1)); pb('#ly-to', layerCmd.toActive);
    pb('#ps-new', () => paraStyleDialog(null, true, styleFromSelection())); pb('#ps-edit', () => { const c = charState(); paraStyleDialog(selStyle.p || c?.ps || 'basic', false); });
    pb('#ps-dup', () => { const id = selStyle.p || charState()?.ps || 'basic'; const s = structuredClone(S.doc.paraStyles[id]); s.name += ' copy'; S.doc.paraStyles['ps' + M.uid().slice(0, 6)] = s; commit('Duplicate Style'); });
    pb('#ps-del', () => deleteStyle('p', selStyle.p || charState()?.ps));
    pb('#cs-new', () => charStyleDialog(null, true)); pb('#cs-edit', () => { const id = selStyle.c || charState()?.cs; if (id) charStyleDialog(id, false); else Aero.toast('Pick a character style first'); });
    pb('#cs-del', () => { const id = selStyle.c || charState()?.cs; if (id) deleteStyle('c', id); });
    Tools.init();
    $('#w-sample').onclick = () => IO.openSample(); $('#w-new').onclick = () => docDialog(true);
    window.addEventListener('keydown', e => { if (e.key === 'F1') { e.preventDefault(); shortcutsDialog(); } });
  }

  return { build, refresh, setTool, status, statusPos, historyList, syncEditor, thumbsSoon, cmd, defaultFill: () => '#cfd8e3', defaultStroke: () => null,
    openCellEditor, closeCellEditor, applyChar, applyPara, applyParaStyle, applyCharStyle, charState, fillPlaceholder, docDialog, editMaster, addPage, deletePage, movePage, applyMaster,
    group, ungroup, align, distribute, arrange, fitImage, tableOp, copyItems, pasteItems, deleteSel, newMaster, overrideMaster, layerCmd, textTargets };
})();
