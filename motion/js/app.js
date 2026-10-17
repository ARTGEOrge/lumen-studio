'use strict';
/* Lumen Motion — app state, history and document commands. */
(function () {
  const LM = window.LM, { factory: F } = LM;
  const $ = s => document.querySelector(s);
  LM.$ = $;

  LM.doc = { comps: [], active: null, name: 'Untitled', path: null };
  LM.st = { time: 0, sel: [], selKeys: new Set(), selProps: new Set(), tool: 'select', playing: false, res: 1, loop: true, ver: 0, reveal: false, zoom: 'fit', mode: 'shape' };
  LM.ui = { open: new Set() };

  /* ---------- events ---------- */
  const handlers = {};
  LM.on = (ev, fn) => (handlers[ev] = handlers[ev] || []).push(fn);
  LM.emit = (ev, a) => (handlers[ev] || []).forEach(f => { try { f(a); } catch (e) { console.error(e); } });

  LM.comp = () => LM.doc.comps.find(c => c.id === LM.doc.active) || LM.doc.comps[0];
  LM.compById = id => LM.doc.comps.find(c => c.id === id);
  LM.selLayers = () => { const c = LM.comp(); return c ? c.layers.filter(l => LM.st.sel.includes(l.id)) : []; };
  LM.selLayer = () => LM.selLayers()[0] || null;
  LM.fps = () => LM.comp()?.fps || 30;
  LM.frame = t => Math.round(t * LM.fps());
  LM.snap = t => Math.round(t * LM.fps()) / LM.fps();

  /* ---------- history ---------- */
  const snapshot = () => JSON.stringify({ comps: LM.doc.comps, active: LM.doc.active });
  LM.hist = new Aero.History({ max: 120, onChange: () => LM.emit('history') });
  function restore(state) {
    if (state == null) return;
    const s = JSON.parse(state);
    LM.doc.comps = s.comps; LM.doc.active = s.active;
    LM.linkDoc(LM.doc);
    const c = LM.comp(); LM.st.sel = LM.st.sel.filter(id => c.layers.some(l => l.id === id)); LM.st.selKeys.clear();
    LM.st.ver++; LM.emit('structure'); LM.emit('change'); LM.requestRender();
  }
  LM.undo = () => restore(LM.hist.undo());
  LM.redo = () => restore(LM.hist.redo());
  LM.historyGo = i => restore(LM.hist.go(i));
  // call after every document edit: relinks, records undo, refreshes UI
  LM.commit = (label, structural = true) => {
    LM.linkDoc(LM.doc);
    LM.hist.push(label, snapshot());
    LM.st.ver++;
    if (structural) LM.emit('structure');
    LM.emit('change'); LM.requestRender();
  };
  // live (uncommitted) change during drags
  LM.touch = () => { LM.st.ver++; LM.emit('values'); LM.requestRender(); };
  LM.resetHistory = (label = 'Open') => { LM.linkDoc(LM.doc); LM.hist.reset(label, snapshot()); Aero.setDoc(LM.doc.name, false); LM.st.ver++; LM.emit('structure'); LM.emit('change'); LM.requestRender(); };

  /* ---------- rendering request (viewer registers LM.draw) ---------- */
  let raf = 0;
  LM.requestRender = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; LM.draw && LM.draw(); }); };

  /* ---------- time & selection ---------- */
  LM.setTime = (t, opts = {}) => {
    const c = LM.comp(); if (!c) return;
    t = Math.max(0, Math.min(c.duration - 1 / c.fps, t));
    if (!opts.exact) t = LM.snap(t);
    LM.st.time = t; LM.emit('time'); LM.requestRender();
  };
  LM.select = (ids, add) => {
    ids = ids.filter(Boolean);
    LM.st.sel = add ? [...new Set([...LM.st.sel, ...ids])] : ids;
    LM.emit('select'); LM.requestRender();
  };
  LM.setActiveComp = id => {
    if (!LM.compById(id)) return;
    LM.doc.active = id; LM.st.sel = []; LM.st.selKeys.clear(); LM.st.selProps.clear();
    const c = LM.comp(); LM.st.time = Math.min(LM.st.time, c.duration - 1 / c.fps);
    LM.emit('structure'); LM.emit('compchange'); LM.emit('time'); LM.requestRender();
  };

  /* ---------- layer commands ---------- */
  LM.addLayer = (L, label, comp = LM.comp()) => {
    const sel = comp.layers.findIndex(l => LM.st.sel.includes(l.id));
    comp.layers.splice(sel >= 0 ? sel : 0, 0, L);
    LM.st.sel = [L.id];
    LM.commit(label || 'New ' + L.name);
    LM.emit('select');
    return L;
  };
  LM.uniqueName = (comp, base) => { let n = base, i = 2; const has = x => comp.layers.some(l => l.name === x); while (has(n)) n = base.replace(/ \d+$/, '') + ' ' + i++; return n; };
  LM.deleteLayers = () => {
    const c = LM.comp(), ids = LM.st.sel; if (!ids.length) return;
    c.layers = c.layers.filter(l => !ids.includes(l.id));
    c.layers.forEach(l => { if (ids.includes(l.parent)) l.parent = null; });
    LM.st.sel = []; LM.commit('Delete Layer'); LM.emit('select');
  };
  LM.duplicateLayers = () => {
    const c = LM.comp(), ls = LM.selLayers(); if (!ls.length) return;
    const ids = [];
    ls.slice().reverse().forEach(L => {
      const d = LM.clone(L); d.id = LM.uid(); d.name = LM.uniqueName(c, L.name.replace(/ \d+$/, '') + ' 2');
      [...d.masks, ...d.effects].forEach(x => x.id = LM.uid()); if (d.text) d.text.animators.forEach(a => a.id = LM.uid());
      c.layers.splice(c.layers.indexOf(L), 0, d); ids.push(d.id);
    });
    LM.st.sel = ids; LM.commit('Duplicate Layer'); LM.emit('select');
  };
  LM.moveLayers = dir => { // dir: -1 up (toward top), +1 down, 'top', 'bottom'
    const c = LM.comp(), ls = LM.selLayers(); if (!ls.length) return;
    const rest = c.layers.filter(l => !ls.includes(l));
    if (dir === 'top') c.layers = [...ls, ...rest];
    else if (dir === 'bottom') c.layers = [...rest, ...ls];
    else {
      const arr = c.layers.slice(), order = dir < 0 ? ls : ls.slice().reverse();
      order.forEach(L => { const i = arr.indexOf(L), j = i + dir; if (j < 0 || j >= arr.length || ls.includes(arr[j])) return; arr.splice(i, 1); arr.splice(j, 0, L); });
      c.layers = arr;
    }
    LM.commit('Reorder Layers');
  };
  LM.reorderLayer = (L, toIndex) => { const c = LM.comp(); const i = c.layers.indexOf(L); if (i < 0) return; c.layers.splice(i, 1); c.layers.splice(Math.max(0, Math.min(c.layers.length, toIndex)), 0, L); LM.commit('Reorder Layers'); };
  // set parent while keeping the child's current appearance (when its transform is not animated)
  LM.setParent = (L, pid) => {
    const c = LM.comp();
    if (pid && (pid === L.id || LM.wouldCycle(c, L, pid))) { Aero.toast('That would create a parenting loop'); return; }
    const t = LM.st.time, tr = L.tr, anim = ['anchor', 'position', 'scale', 'rotation'].some(k => LM.animated(tr[k]));
    if (!anim) {
      const world = LM.layerMatrix(L, t, c), P = pid ? LM.layerMatrix(c.layers.find(l => l.id === pid), t, c) : LM.M.id();
      const loc = LM.M.mul(LM.M.inv(P), world);   // = T(p) R S T(-a)
      const sx = Math.hypot(loc[0], loc[1]), rot = Math.atan2(loc[1], loc[0]), det = loc[0] * loc[3] - loc[1] * loc[2], sy = det / (sx || 1);
      const a = LM.val(tr.anchor, t);
      tr.scale.v = [sx * 100, sy * 100]; tr.rotation.v = rot * 180 / Math.PI;
      const p = LM.M.apply(loc, a[0], a[1]); tr.position.v = [p[0], p[1]];
    }
    L.parent = pid || null;
    LM.commit(pid ? 'Set Parent' : 'Clear Parent');
  };
  LM.trimLayer = (which) => { const t = LM.st.time; LM.selLayers().forEach(L => { if (which === 'in') L.in = Math.min(t, L.out - 1 / LM.fps()); else L.out = Math.max(t + 1 / LM.fps(), L.in + 1 / LM.fps()); }); LM.commit(which === 'in' ? 'Trim In Point' : 'Trim Out Point'); };
  LM.slideLayerTo = (which) => { const t = LM.st.time; LM.selLayers().forEach(L => { const d = which === 'in' ? t - L.in : t + 1 / LM.fps() - L.out; L.start += d; L.in += d; L.out += d; }); LM.commit('Move Layer'); };
  LM.splitLayer = () => {
    const c = LM.comp(), t = LM.st.time, ls = LM.selLayers().filter(L => t > L.in && t < L.out); if (!ls.length) return Aero.toast('Put the time indicator inside the layer to split it');
    const ids = [];
    ls.forEach(L => { const d = LM.clone(L); d.id = LM.uid(); d.name = L.name + ' (split)'; [...d.masks, ...d.effects].forEach(x => x.id = LM.uid()); L.out = t; d.in = t; c.layers.splice(c.layers.indexOf(L), 0, d); ids.push(d.id); });
    LM.st.sel = ids; LM.commit('Split Layer'); LM.emit('select');
  };
  LM.precompose = async () => {
    const c = LM.comp(), ls = LM.selLayers(); if (!ls.length) return Aero.toast('Select layers to pre-compose');
    const name = await Aero.prompt('Pre-compose', 'New composition name', LM.uniqueCompName('Pre-comp 1')); if (!name) return;
    const sub = F.comp({ name, w: c.w, h: c.h, fps: c.fps, duration: c.duration }); sub.bg = c.bg;
    const ids = ls.map(l => l.id);
    sub.layers = c.layers.filter(l => ids.includes(l.id));
    sub.layers.forEach(l => { if (l.parent && !ids.includes(l.parent)) l.parent = null; });
    c.layers.forEach(l => { if (!ids.includes(l.id) && ids.includes(l.parent)) l.parent = null; });
    const at = c.layers.findIndex(l => ids.includes(l.id));
    c.layers = c.layers.filter(l => !ids.includes(l.id));
    LM.doc.comps.push(sub);
    const P = F.precomp(c, sub); P.tr.position.v = [c.w / 2, c.h / 2];
    c.layers.splice(at, 0, P); LM.st.sel = [P.id];
    LM.commit('Pre-compose'); LM.emit('select');
  };
  LM.uniqueCompName = base => { let n = base, i = 2; while (LM.doc.comps.some(c => c.name === n)) n = base.replace(/ \d+$/, '') + ' ' + i++; return n; };
  // comps that (transitively) contain comp id — used to block precomp cycles
  LM.compContains = (outerId, innerId, depth = 0) => {
    if (outerId === innerId) return true; if (depth > 20) return false;
    const o = LM.compById(outerId); if (!o) return false;
    return o.layers.some(l => l.type === 'precomp' && LM.compContains(l.comp, innerId, depth + 1));
  };
  LM.addPrecompLayer = sub => {
    const c = LM.comp(); if (LM.compContains(sub.id, c.id)) return Aero.toast('A composition cannot contain itself');
    LM.addLayer(F.precomp(c, sub), 'Add Precomp Layer');
  };

  /* ---------- effects & keyframe helpers ---------- */
  LM.addEffect = (type, L = LM.selLayer()) => {
    if (!L) { Aero.toast('Select a layer first'); return; }
    const fx = F.effect(type);
    if (type === 'rays') { const b = LM.layerBounds(L, LM.st.time); fx.p.center.v = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; }
    if (type === 'ramp') { const [w, h] = LM.layerSize(L); fx.p.p0.v = [w / 2, 0]; fx.p.p1.v = [w / 2, h]; if (L.type === 'shape' || L.type === 'text') { const b = LM.layerBounds(L, LM.st.time); fx.p.p0.v = [(b[0] + b[2]) / 2, b[1]]; fx.p.p1.v = [(b[0] + b[2]) / 2, b[3]]; } }
    if (type === 'pointCtl') { const c = L._c || LM.comp(); fx.p.point.v = [c.w / 2, c.h / 2]; }
    // a second instance of the same effect gets a numbered name so expressions can address it ("Slider Control 2")
    const fxName = f => f.name || LM.FX[f.type].name, base = LM.FX[type].name;
    if (L.effects.some(f => fxName(f) === base)) { let i = 2; while (L.effects.some(f => fxName(f) === base + ' ' + i)) i++; fx.name = base + ' ' + i; }
    L.effects.push(fx); L.expanded = true; LM.ui.open.add(L.id + '|effects'); LM.ui.open.add(L.id + '|fx.' + fx.id);
    LM.commit('Add ' + LM.FX[type].name);
  };
  LM.allKeys = () => { const out = []; const c = LM.comp(); c && c.layers.forEach(L => LM.leaves(L).forEach(n => (n.p.k || []).forEach(k => out.push({ L, n, k })))); return out; };
  LM.selectedKeyRefs = () => LM.allKeys().filter(r => LM.st.selKeys.has(r.k));
  LM.deleteSelectedKeys = () => {
    const refs = LM.selectedKeyRefs(); if (!refs.length) return false;
    refs.forEach(({ n, k }) => { const p = n.p; p.k = p.k.filter(x => x !== k); if (!p.k.length) { p.v = k.v; delete p.k; } });
    LM.st.selKeys.clear(); LM.commit('Delete Keyframes'); return true;
  };
  LM.setKeysInterp = type => {
    const refs = LM.selectedKeyRefs(); if (!refs.length) return Aero.toast('Select keyframes first');
    refs.forEach(({ k }) => LM.setInterp(k, type)); LM.commit('Keyframe Interpolation', false);
  };
  // copy / paste keyframes
  let clip = null;
  LM.copyKeys = () => {
    const refs = LM.selectedKeyRefs(); if (!refs.length) return false;
    const t0 = Math.min(...refs.map(r => r.k.t));
    clip = refs.map(r => ({ id: r.n.id, k: LM.clone({ ...r.k, t: r.k.t - t0 }) }));
    Aero.toast(`Copied ${refs.length} keyframe${refs.length > 1 ? 's' : ''}`); return true;
  };
  LM.pasteKeys = () => {
    if (!clip) return false;
    const L = LM.selLayer(); if (!L) { Aero.toast('Select a layer to paste keyframes into'); return true; }
    const lt0 = LM.snap(LM.st.time - L.start), selIds = [...LM.st.selProps].filter(s => s.startsWith(L.id + '|')).map(s => s.split('|')[1]);
    const ids = [...new Set(clip.map(c => c.id))];
    LM.st.selKeys.clear(); let n = 0;
    clip.forEach(c => {
      let node = LM.findNode(L, c.id);
      if (!node && ids.length === 1 && selIds.length === 1) node = LM.findNode(L, selIds[0]);
      if (!node || node.type !== (LM.findNode(L, c.id) || node).type) return;
      const p = node.p; if (!p.k) { p.k = []; }
      const k = LM.clone(c.k); k.t = LM.snap(lt0 + c.k.t);
      p.k = p.k.filter(x => Math.abs(x.t - k.t) > 1e-6); p.k.push(k); p.k.sort((a, b) => a.t - b.t);
      LM.st.selKeys.add(k); n++;
    });
    if (!n) { Aero.toast('No matching properties on the selected layer'); return true; }
    L.expanded = true; LM.commit('Paste Keyframes'); return true;
  };
  LM.hasKeyClip = () => !!clip;

  /* ---------- status line ---------- */
  LM.status = msg => { const s = $('#st-msg'); if (s) s.textContent = msg || ''; };
})();
