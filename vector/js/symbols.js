'use strict';
/* Lumen Vector — Symbols: reusable artwork. Definitions live in LV.doc.symbols = [{id, name, art}] where `art` is the
   paper JSON of a group centred on the origin. Instances are groups with data.kind 'symbol', data.sym = id and
   applyMatrix = false (their matrix holds the placement, their children are a copy of the master art).
   Editing a master (double-click an instance) opens an editable copy in place; "Done" updates every instance. */
(function () {
  const SY = LV.sym = {};
  SY.list = () => LV.doc.symbols || (LV.doc.symbols = []);
  SY.find = id => SY.list().find(s => s.id === id);
  SY.instances = id => P.project.getItems({ match: it => it.data && it.data.kind === 'symbol' && (!id || it.data.sym === id) && !(it.parent && it.parent.data && it.parent.data.symEditFrozen) });
  SY.selected = null; // symbol id highlighted in the Symbols panel
  const stripUids = it => { if (it.data) { delete it.data.uid; } (it.children || []).forEach(stripUids); return it; };
  const importArt = json => { const a = P.Base.importJSON(json); if (a && a.parent) a.remove(); return a; };
  // fill an instance's children from its master (and refresh nested instances)
  SY.fill = (inst, depth = 0) => {
    const s = SY.find(inst.data.sym); if (!s || depth > 8) return false;
    const art = importArt(s.art); if (!art) return false;
    inst.removeChildren(); inst.addChildren(art.children.slice());
    inst.getItems({ match: x => x.data && x.data.kind === 'symbol' }).forEach(n => SY.fill(n, depth + 1));
    return true;
  };
  SY.makeInstance = (s, matrix) => {
    const g = new P.Group({ insert: false }); g.applyMatrix = false;
    g.data = { kind: 'symbol', sym: s.id }; SY.fill(g); g.matrix = matrix; g.name = s.name; LV.uidOf(g);
    return g;
  };
  SY.refreshAll = id => SY.instances(id).forEach(inst => { if (!SY.editing() || inst !== SY.editInstance()) SY.fill(inst); });
  const artFrom = (items, center) => {
    const art = new P.Group({ insert: false, children: items.map(it => it.clone({ insert: false })) });
    art.translate(center.negate()); stripUids(art); return art.exportJSON({ asString: false });
  };
  const uniqueName = base => { let n = SY.list().length + 1, nm = base + ' ' + n; while (SY.list().some(s => s.name === nm)) nm = base + ' ' + ++n; return nm; };

  /* ---------- commands ---------- */
  SY.create = async () => {
    if (SY.editing()) return LV.toast('Finish editing the symbol first');
    const items = LV.sortZ(LV.sel); if (!items.length) return LV.toast('Select the artwork to turn into a symbol');
    const name = await Aero.prompt('New Symbol', 'Symbol name', uniqueName('Symbol')); if (name == null) return;
    const c = LV.selBounds().center, s = { id: Aero.uid(), name: name.trim() || uniqueName('Symbol'), art: artFrom(items, c), v: 1 };
    SY.list().push(s); SY.selected = s.id;
    const inst = SY.makeInstance(s, new P.Matrix().translate(c));
    inst.insertAbove(items[items.length - 1]); items.forEach(it => it.remove());
    LV.setSel([inst]); LV.commit('New Symbol'); return s;
  };
  SY.place = (id = SY.selected, at) => {
    const s = SY.find(id); if (!s) return LV.toast('Select a symbol in the Symbols panel');
    const p = at || LV.boardRect(LV.board()).center, inst = SY.makeInstance(s, new P.Matrix().translate(p));
    LV.insert(inst); LV.setSel([inst]); LV.commit('Place Symbol'); return inst;
  };
  SY.breakLink = (items = LV.sel) => {
    const insts = items.filter(it => LV.kind(it) === 'symbol'); if (!insts.length) return LV.toast('Select a symbol instance');
    const out = insts.map(inst => { inst.applyMatrix = true; delete inst.data.kind; delete inst.data.sym; inst.children.forEach(LV.reUid); return inst; });
    LV.setSel(out); LV.commit('Break Link to Symbol');
  };
  SY.redefine = (id = SY.selected) => {
    const s = SY.find(id); if (!s) return LV.toast('Select a symbol in the Symbols panel');
    const items = LV.sortZ(LV.sel.filter(it => !(LV.kind(it) === 'symbol' && it.data.sym === id))); if (!items.length) return LV.toast('Select artwork to redefine the symbol with');
    s.art = artFrom(items, LV.selBounds(items).center); s.v = (s.v || 0) + 1;
    SY.refreshAll(id); LV.commit('Redefine Symbol');
  };
  SY.rename = async (id = SY.selected) => {
    const s = SY.find(id); if (!s) return;
    const n = await Aero.prompt('Rename Symbol', 'Symbol name', s.name); if (n == null || !n.trim()) return;
    s.name = n.trim(); SY.instances(id).forEach(i => { i.name = s.name; }); LV.commit('Rename Symbol');
  };
  SY.remove = async (id = SY.selected) => {
    const s = SY.find(id); if (!s) return;
    const insts = SY.instances(id);
    if (insts.length && !(await Aero.confirm('Delete Symbol', `"${s.name}" is used by ${insts.length} instance${insts.length > 1 ? 's' : ''} in the document. They will be expanded into plain groups.`, 'Delete'))) return;
    insts.forEach(inst => { inst.applyMatrix = true; delete inst.data.kind; delete inst.data.sym; });
    LV.doc.symbols = SY.list().filter(x => x !== s); if (SY.selected === id) SY.selected = null;
    LV.pruneSel(); LV.commit('Delete Symbol');
  };
  SY.duplicateDef = (id = SY.selected) => { const s = SY.find(id); if (!s) return; const n = { id: Aero.uid(), name: s.name + ' copy', art: JSON.parse(JSON.stringify(s.art)), v: 1 }; SY.list().push(n); SY.selected = n.id; LV.commit('Duplicate Symbol'); };

  /* ---------- editing a master in place ---------- */
  SY.editing = () => P.project.getItem({ match: it => it.data && it.data.symEdit }) || null;
  SY.editInstance = () => { const g = SY.editing(); if (!g) return null; const uid = g.data.symEdit.inst; return P.project.getItem({ match: it => it.data && it.data.uid === uid }); };
  SY.edit = inst => {
    if (SY.editing()) SY.finishEdit();
    inst = inst || LV.sel.find(it => LV.kind(it) === 'symbol');
    if (!inst && SY.selected) { inst = SY.instances(SY.selected)[0]; if (!inst) inst = SY.place(SY.selected); }
    if (!inst) return LV.toast('Select a symbol instance to edit');
    const s = SY.find(inst.data.sym); if (!s) return LV.toast('The definition of this symbol is missing');
    if (!inst.matrix.isInvertible()) return LV.toast('This instance is scaled to zero');
    const art = importArt(s.art), g = new P.Group({ insert: false });
    g.addChildren(art.children.slice()); g.transform(inst.matrix);
    g.data = { symEdit: { sym: s.id, inst: LV.uidOf(inst), m: inst.matrix.values } }; g.name = 'Editing ' + s.name;
    g.getItems({}).forEach(x => LV.uidOf(x)); LV.uidOf(g);
    g.insertAbove(inst); inst.visible = false;
    LV.setSel(g.children.slice()); LV.toast(`Editing symbol "${s.name}" — click Done (or press Esc with nothing selected) to update all instances`);
    LV.emit('changed'); LV.emit('tool');
  };
  SY.finishEdit = (cancel = false) => {
    const g = SY.editing(); if (!g) return;
    const { sym, m, inst: iu } = g.data.symEdit, s = SY.find(sym), inst = P.project.getItem({ match: it => it.data && it.data.uid === iu });
    if (s && !cancel && g.children.length) {
      const inv = new P.Matrix(m).inverted(), art = new P.Group({ insert: false, children: g.removeChildren() });
      if (inv) art.transform(inv);
      stripUids(art); s.art = art.exportJSON({ asString: false }); s.v = (s.v || 0) + 1;
    }
    g.remove(); if (inst) inst.visible = true;
    SY.refreshAll(sym); LV.setSel(inst ? [inst] : []);
    LV.commit(cancel ? 'Cancel Symbol Edit' : 'Edit Symbol'); LV.emit('tool');
  };

  /* ---------- thumbnails ---------- */
  const thumbs = new Map();
  SY.thumb = (s, size = 30) => {
    const key = s.id + ':' + (s.v || 0) + ':' + size; if (thumbs.has(key)) return thumbs.get(key);
    let url = '';
    try {
      const it = P.Base.importJSON(s.art), b = it.strokeBounds, pr = 2, c = document.createElement('canvas'); c.width = c.height = size * pr;
      if (b.width > 0 || b.height > 0) {
        const k = (size - 4) * pr / Math.max(b.width, b.height, 1e-6), m = new P.Matrix().translate(size * pr / 2, size * pr / 2).scale(k).translate(b.center.negate());
        const g = c.getContext('2d'); g.setTransform(m.a, m.b, m.c, m.d, m.tx, m.ty); it.draw(g, new P.Base({ matrices: [m], pixelRatio: 1 }));
      }
      it.remove(); url = c.toDataURL();
    } catch (e) { console.warn(e); }
    thumbs.set(key, url); return url;
  };

  /* ---------- untrusted file data ---------- */
  SY.sanitizeList = (arr, checkJSON) => {
    if (!Array.isArray(arr)) return [];
    const seen = new Set();
    return arr.slice(0, 500).filter(s => s && typeof s === 'object' && typeof s.id === 'string' && Array.isArray(s.art) && !seen.has(s.id) && seen.add(s.id)).map(s => { checkJSON(s.art); return { id: s.id.slice(0, 64), name: String(s.name || 'Symbol').slice(0, 120), art: s.art, v: 1 }; });
  };
})();
