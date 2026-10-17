'use strict';
/* Lumen Proto — effect styles: shared, named drop / inner shadow + blur sets (like Figma's effect styles).
   doc.effectStyles = [{id, name, shadows:[…], blur:{type,r,on}|null}]; a layer (or an instance override) links one
   with fxStyle:id. The layer's own shadows / blur are kept as a synced copy of its style, so every renderer and
   exporter works unchanged and files stay readable; editing a style re-syncs every user. */
(function (root) {
  const LP = root.LP = root.LP || {};
  const num = (v, d, lo, hi) => { v = Number(v); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const hexOk = c => typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c.trim());
  LP.cleanShadow = s => ({ x: num(s.x, 0, -1e4, 1e4), y: num(s.y, 0, -1e4, 1e4), blur: num(s.blur, 0, 0, 1e4), spread: num(s.spread, 0, -1e4, 1e4), color: hexOk(s.color) ? s.color.trim() : '#000000', a: num(s.a, .25, 0, 1), inner: !!s.inner, on: s.on !== false });
  LP.cleanBlur = b => b && typeof b === 'object' && (b.type === 'layer' || b.type === 'bg') ? { type: b.type, r: num(b.r, 8, 0, 250), on: b.on !== false } : null;
  // untrusted file data → effect style list
  LP.cleanEffectStyles = arr => {
    const seen = new Set();
    return (Array.isArray(arr) ? arr : []).filter(s => s && typeof s === 'object' && typeof s.id === 'string' && /^[\w-]{1,64}$/.test(s.id) && !seen.has(s.id) && seen.add(s.id)).slice(0, 1000).map(s => ({
      id: s.id, name: String(s.name || 'Effect').slice(0, 100),
      shadows: (Array.isArray(s.shadows) ? s.shadows : []).filter(x => x && typeof x === 'object').slice(0, 16).map(LP.cleanShadow),
      blur: LP.cleanBlur(s.blur), ...(s.lib ? { lib: String(s.lib).slice(0, 100) } : {})
    }));
  };
  const copy = o => JSON.parse(JSON.stringify(o));
  // write each linked style's effects into the layers (and instance overrides) that use it; unlink missing styles.
  // returns the number of layers updated
  LP.syncEffectStyles = doc => {
    const byId = {}; (doc.effectStyles || []).forEach(s => byId[s.id] = s);
    let k = 0;
    const put = (o, keepNull) => {
      if (o.fxStyle == null) return;
      const s = byId[o.fxStyle];
      if (!s) { delete o.fxStyle; return; }
      o.shadows = copy(s.shadows || []); if (s.blur) o.blur = copy(s.blur); else if (keepNull) o.blur = null; else delete o.blur; k++;
    };
    const walk = n => { put(n, n.type === 'instance'); if (n.overrides && typeof n.overrides === 'object') Object.values(n.overrides).forEach(o => o && typeof o === 'object' && put(o, true)); (n.children || []).forEach(walk); };
    (doc.children || []).forEach(walk);
    return k;
  };
  // CSS used for the swatch in the Assets panel
  LP.effectCss = s => {
    const sh = (s.shadows || []).filter(x => x.on !== false).map(x => `${x.inner ? 'inset ' : ''}${x.x}px ${x.y}px ${x.blur}px ${x.spread || 0}px ${LP.rgba ? LP.rgba(x.color, x.a) : x.color}`);
    return (sh.length ? `box-shadow:${sh.join(',')};` : '') + (s.blur && s.blur.on !== false && s.blur.type === 'bg' ? `backdrop-filter:blur(${Math.min(8, s.blur.r)}px);background:rgba(255,255,255,.55);` : '') + (s.blur && s.blur.on !== false && s.blur.type === 'layer' ? `filter:blur(${Math.min(4, s.blur.r / 4)}px);` : '');
  };
  LP.effectSummary = s => {
    const parts = [];
    const d = (s.shadows || []).filter(x => !x.inner).length, i = (s.shadows || []).filter(x => x.inner).length;
    if (d) parts.push(d + ' drop'); if (i) parts.push(i + ' inner');
    if (s.blur) parts.push((s.blur.type === 'bg' ? 'bg blur ' : 'blur ') + s.blur.r);
    return parts.join(' · ') || 'empty';
  };
  if (!root.document) return;

  const ED = root.ED, A = root.ACT;
  const need = (c, msg) => { if (!c) Aero.toast(msg); return !!c; };
  const list = () => (ED.doc.effectStyles = ED.doc.effectStyles || []);
  A.effectStyleOf = n => { const id = ED.scene.view(n).fxStyle; return id ? list().find(s => s.id === id) || null : null; };
  A.addEffectStyle = async () => {
    const n = ED.selNodes()[0]; const v = n && ED.scene.view(n);
    if (!need(v && ((v.shadows || []).length || v.blur), 'Select a layer with shadows or blur to create an effect style from it')) return;
    const name = await Aero.prompt('New effect style', 'Name', 'Elevation ' + (list().length + 1)); if (!name) return;
    const st = { id: LP.newId(), name: String(name).slice(0, 100), shadows: copy(v.shadows || []).map(LP.cleanShadow), blur: LP.cleanBlur(v.blur) };
    list().push(st);
    ED.setProp(n, 'fxStyle', st.id);
    LP.syncEffectStyles(ED.doc);
    ED.commit('Add effect style');
  };
  A.applyEffectStyle = st => {
    const sel = ED.selNodes().filter(n => n.type !== 'group'); if (!need(sel.length, 'Select layers to apply the effect style')) return;
    sel.forEach(n => { if (!ED.canEdit(n, 'fxStyle')) return; ED.setProp(n, 'fxStyle', st.id); ED.setProp(n, 'shadows', copy(st.shadows)); ED.setProp(n, 'blur', st.blur ? copy(st.blur) : null); });
    LP.syncEffectStyles(ED.doc);
    ED.commit('Apply effect style');
  };
  // unlink but keep the look
  A.detachEffectStyle = () => {
    let k = 0;
    ED.selNodes().forEach(n => { if (!ED.scene.view(n).fxStyle) return; if (ED.isClone(n) || n.type === 'instance') ED.setProp(n, 'fxStyle', null); else delete n.fxStyle; k++; });
    if (k) ED.commit('Detach effect style');
  };
  A.deleteEffectStyle = st => {
    const l = list(); const i = l.indexOf(st); if (i < 0) return;
    l.splice(i, 1);
    const unlink = o => { if (o && o.fxStyle === st.id) delete o.fxStyle; };
    LP.walk(ED.doc, n => { unlink(n); Object.values(n.overrides || {}).forEach(unlink); });
    ED.commit('Delete effect style');
  };
  A.effectStyleUsers = st => Object.values(ED.scene.byId).filter(n => n !== ED.doc && ED.scene.view(n).fxStyle === st.id).length;
  // edit dialog: first drop shadow + blur numerically, or redefine from the selected layer
  A.editEffectStyle = st => {
    const before = copy(st);
    const s0 = st.shadows[0];
    const sel = ED.selNodes()[0], sv = sel && ED.scene.view(sel);
    const fields = [{ key: 'name', label: 'Name', type: 'text', value: st.name }];
    if (s0) fields.push({ key: 'kind', label: 'Shadow 1', type: 'select', options: [['drop', 'Drop shadow'], ['inner', 'Inner shadow']], value: s0.inner ? 'inner' : 'drop' },
      { key: 'x', label: 'X offset', type: 'number', value: s0.x }, { key: 'y', label: 'Y offset', type: 'number', value: s0.y },
      { key: 'blur', label: 'Blur', type: 'number', min: 0, value: s0.blur }, { key: 'spread', label: 'Spread', type: 'number', value: s0.spread || 0 },
      { key: 'color', label: 'Color', type: 'color', value: LP.toHex(s0.color) }, { key: 'a', label: 'Opacity %', type: 'range', min: 0, max: 100, value: Math.round((s0.a ?? .25) * 100) });
    if (st.blur) fields.push({ key: 'br', label: st.blur.type === 'bg' ? 'Background blur' : 'Layer blur', type: 'number', min: 0, max: 250, value: st.blur.r });
    if (sv && ((sv.shadows || []).length || sv.blur)) fields.push({ key: 'redef', label: `Redefine from "${String(sel.name).slice(0, 30)}"`, type: 'checkbox', value: false });
    fields.push({ key: 'del', label: 'Delete this style', type: 'checkbox', value: false });
    const fromV = v => {
      Object.assign(st, copy(before));
      if (v.redef && sv) { st.shadows = copy(sv.shadows || []).map(LP.cleanShadow); st.blur = LP.cleanBlur(sv.blur); return; }
      if (s0) Object.assign(st.shadows[0], { inner: v.kind === 'inner', x: +v.x || 0, y: +v.y || 0, blur: Math.max(0, +v.blur || 0), spread: +v.spread || 0, color: v.color, a: v.a / 100 });
      if (st.blur && isFinite(v.br)) st.blur.r = Math.max(0, Math.min(250, v.br));
    };
    Aero.dialog({
      title: 'Edit effect style', instruction: `Changes update every layer that uses this style (${A.effectStyleUsers(st)}).`, fields,
      onChange: v => { if (v.del) return; fromV(v); LP.syncEffectStyles(ED.doc); ED.live(); },
      onOK: v => { if (v.del) { Object.assign(st, before); A.deleteEffectStyle(st); return; } fromV(v); st.name = String(v.name || st.name).slice(0, 100); LP.syncEffectStyles(ED.doc); ED.commit('Edit effect style'); },
      onCancel: () => { Object.assign(st, before); LP.syncEffectStyles(ED.doc); ED.live(); }
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
