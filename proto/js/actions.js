'use strict';
/* Lumen Proto — document actions: delete, duplicate, group, align, components, auto layout, clipboard… */
(function () {
  const LP = window.LP, M = LP.M, ED = window.ED;
  const A = window.ACT = {};
  const editableRoots = () => ED.selRoots().filter(n => !ED.isClone(n));
  const need = (ok, msg) => { if (!ok) Aero.toast(msg); return ok; };

  A.deleteSel = () => {
    if (ED.pathEdit && ED.pathSel && ED.deleteSelectedPoint()) return;
    const roots = ED.selRoots();
    if (roots.some(n => ED.isClone(n))) {
      // hide layers inside instances (override) instead of deleting
      roots.filter(n => ED.isClone(n)).forEach(n => ED.setProp(n, 'visible', false));
    }
    roots.filter(n => !ED.isClone(n)).forEach(n => ED.removeNode(n));
    ED.sel = []; ED.commit('Delete');
  };
  A.duplicate = () => {
    const roots = editableRoots(); if (!roots.length) return;
    const ids = [];
    roots.forEach(n => {
      const p = ED.parent(n), arr = ED.childArr(p), c = LP.cloneFresh(n, {});
      if (c.component) { c.component = Object.assign({}, c.component); }
      if (ED.isArtboard(n)) { const right = Math.max(...ED.doc.children.map(k => k.x + k.w)); c.x = right + 80; c.y = n.y; c.name = n.name + ' copy'; }
      else if (!(p !== ED.doc && ED.scene.view(p).layout)) { c.x += 10; c.y += 10; }
      arr.splice(arr.indexOf(n) + 1, 0, c); ids.push(c.id);
    });
    ED.sel = ids; ED.commit('Duplicate');
  };
  A.group = () => {
    const roots = editableRoots(); if (!need(roots.length, 'Select layers to group')) return;
    const par = ED.parent(roots[0]);
    const arr = ED.childArr(par);
    const idx = Math.max(...roots.map(n => arr.indexOf(n)));
    const g = LP.node('group', { name: 'Group', x: 0, y: 0, w: 1, h: 1 });
    arr.splice(idx + 1, 0, g); ED.update();
    const order = roots.slice().sort((a, b) => ED.childArr(ED.parent(a)).indexOf(a) - ED.childArr(ED.parent(b)).indexOf(b));
    order.forEach(n => ED.reparent(n, g));
    ED.sel = [g.id]; ED.commit('Group');
  };
  A.ungroup = () => {
    const roots = editableRoots().filter(n => (n.type === 'group' || n.type === 'bool' || n.type === 'frame' && !ED.isArtboard(n)));
    if (!need(roots.length, 'Select a group or frame to ungroup')) return;
    const ids = [];
    roots.forEach(g => {
      const par = ED.parent(g), arr = ED.childArr(par); let idx = arr.indexOf(g);
      g.children.slice().forEach(c => { ED.reparent(c, par, ++idx); if (par === ED.doc) delete c.mask; ids.push(c.id); });
      ED.removeNode(g);
    });
    ED.sel = ids; ED.commit('Ungroup');
  };
  /* ---------- boolean operations, flatten, masks ---------- */
  const SHAPE_TYPES = { rect: 1, ellipse: 1, path: 1, bool: 1, frame: 1, instance: 1, group: 1, icon: 1, text: 1 };
  // wrap layers (same parent) into a new container node, keeping their stacking order
  function wrapRoots(roots, node) {
    const par = ED.parent(roots[0]), arr = ED.childArr(par);
    const order = roots.slice().sort((a, b) => arr.indexOf(a) - arr.indexOf(b));
    arr.splice(Math.max(...order.map(n => arr.indexOf(n))) + 1, 0, node); ED.update();
    order.forEach(n => ED.reparent(n, node));
    return order;
  }
  A.boolean = op => {
    const sel = ED.selNodes();
    if (sel.length === 1 && sel[0].type === 'bool' && !ED.isClone(sel[0])) { sel[0].op = op; sel[0].name = /^(Union|Subtract|Intersect|Exclude)$/.test(sel[0].name) ? LP.BOOL_OPS[op] : sel[0].name; ED.commit(LP.BOOL_OPS[op]); return; }
    const roots = editableRoots().filter(n => !ED.isArtboard(n) && SHAPE_TYPES[n.type]);
    if (!need(roots.length >= 2, 'Select two or more shapes for a boolean operation')) return;
    const par = ED.parent(roots[0]);
    if (!need(roots.every(n => ED.parent(n) === par), 'Boolean operations need layers with the same parent')) return;
    if (!need(window.paper, 'Boolean engine unavailable')) return;
    const arr = ED.childArr(par), bottom = roots.slice().sort((a, b) => arr.indexOf(a) - arr.indexOf(b))[0];
    const bv = ED.scene.view(bottom), paintable = bottom.type !== 'text' && bottom.type !== 'icon' && bottom.type !== 'group';
    const g = LP.node('bool', { name: LP.BOOL_OPS[op], op, x: 0, y: 0, w: 1, h: 1,
      fills: paintable && (bv.fills || []).length ? JSON.parse(JSON.stringify(bv.fills)) : [LP.solid(bottom.type === 'icon' ? (bv.color || '#1e1e1e') : '#d9d9d9')],
      strokes: paintable ? JSON.parse(JSON.stringify(bv.strokes || [])) : [] });
    wrapRoots(roots, g);
    ED.sel = [g.id]; ED.commit(LP.BOOL_OPS[op]);
  };
  // convert shapes / boolean groups into an editable vector path
  A.flatten = () => {
    const roots = editableRoots().filter(n => ['rect', 'ellipse', 'path', 'bool', 'frame', 'group'].includes(n.type) && !ED.isArtboard(n) && !n.component);
    if (!need(roots.length, 'Select shapes or a boolean group to flatten')) return [];
    const ids = [];
    roots.forEach(n => {
      const v = ED.scene.view(n);
      const d = LP.outlineD(ED.scene, n); if (!d) return;
      const segs = LP.parsePath(d), b = LP.segBounds(segs);
      const local = LP.segsToD(segs, b.x, b.y);
      const src = n.type === 'group' ? (ED.kids(n).find(k => (ED.scene.view(k).fills || []).length) || n) : n;
      const sv = ED.scene.view(src);
      const p = LP.node('path', { name: n.type === 'bool' || n.type === 'group' ? n.name : n.name + ' (vector)', x: b.x, y: b.y, w: Math.max(1, b.w), h: Math.max(1, b.h), bw: Math.max(1, b.w), bh: Math.max(1, b.h),
        cont: LP.dToContours(local), pts: [], closed: false, fills: JSON.parse(JSON.stringify(sv.fills || [])), strokes: JSON.parse(JSON.stringify(sv.strokes || [])), shadows: JSON.parse(JSON.stringify(v.shadows || [])),
        opacity: v.opacity ?? 1, blend: v.blend || 'normal', rule: v.rule === 'evenodd' ? 'evenodd' : 'nonzero', cons: n.cons, sizeH: n.sizeH, sizeV: n.sizeV, absolute: n.absolute, proto: n.proto, mask: n.mask, exports: n.exports });
      if (v.blur) p.blur = JSON.parse(JSON.stringify(v.blur));
      ['proto', 'mask', 'exports', 'absolute'].forEach(k => { if (p[k] == null) delete p[k]; });
      const arr = ED.childArr(ED.parent(n)); arr.splice(arr.indexOf(n), 1, p); ids.push(p.id);
    });
    ED.sel = ids; ED.commit('Flatten');
    return ids;
  };
  A.editPoints = () => {
    let n = ED.selNodes()[0]; if (!need(n && !ED.isClone(n), 'Select a vector or shape')) return;
    if (n.type !== 'path') { const ids = A.flatten(); n = ids.length ? ED.get(ids[0]) : null; }
    if (n) ED.enterPathEdit(n);
  };
  // the bottom-most selected layer masks the layers above it (grouped together)
  A.useAsMask = () => {
    const roots = editableRoots().filter(n => !ED.isArtboard(n));
    if (!need(roots.length, 'Select a shape to use as a mask (plus the layers to mask)')) return;
    if (roots.length === 1) {
      const n = roots[0];
      if (!need(ED.parent(n) !== ED.doc, 'Put the mask inside a frame or group, or select it together with the layers to mask')) return;
      n.mask = !n.mask; ED.commit(n.mask ? 'Use as mask' : 'Release mask'); return;
    }
    const par = ED.parent(roots[0]);
    if (!need(roots.every(n => ED.parent(n) === par), 'Mask layers must share the same parent')) return;
    const g = LP.node('group', { name: 'Mask group', x: 0, y: 0, w: 1, h: 1 });
    const order = wrapRoots(roots, g);
    order[0].mask = true;
    ED.sel = [g.id]; ED.commit('Use as mask');
  };
  A.frameSelection = (auto) => {
    const roots = editableRoots(); if (!need(roots.length, 'Select layers first')) return null;
    const par = ED.parent(roots[0]); const arr = ED.childArr(par);
    const b = ED.unionBox(roots); const o = ED.toLocal(par, b.x, b.y);
    const f = LP.node('frame', { name: auto ? 'Stack' : 'Frame', x: o.x, y: o.y, w: Math.max(1, b.w), h: Math.max(1, b.h), fills: [] });
    arr.splice(Math.max(...roots.map(n => arr.indexOf(n))) + 1, 0, f); ED.update();
    roots.slice().sort((a, c) => auto ? (ED.wbox(a)[auto === 'h' ? 'x' : 'y'] - ED.wbox(c)[auto === 'h' ? 'x' : 'y']) : arr.indexOf(a) - arr.indexOf(c)).forEach(n => ED.reparent(n, f));
    return f;
  };
  A.wrapInFrame = () => { const f = A.frameSelection(); if (f) { ED.sel = [f.id]; ED.commit('Frame selection'); } };

  /* ---------- auto layout ---------- */
  A.addAutoLayout = () => {
    const roots = editableRoots(); if (!roots.length) return;
    let f;
    if (roots.length === 1 && roots[0].type === 'frame' && !ED.isClone(roots[0])) {
      f = roots[0];
      if (f.layout) { A.removeAutoLayout(); return; }
      setupLayout(f);
    } else {
      const b = roots.map(n => ED.wbox(n));
      const spreadX = Math.max(...b.map(q => q.x + q.w)) - Math.min(...b.map(q => q.x)), spreadY = Math.max(...b.map(q => q.y + q.h)) - Math.min(...b.map(q => q.y));
      const dir = spreadX > spreadY ? 'h' : 'v';
      f = A.frameSelection(dir); if (!f) return;
      setupLayout(f, dir);
    }
    ED.sel = [f.id]; ED.commit('Add auto layout');
  };
  function setupLayout(f, dir) {
    const kids = (f.children || []).filter(k => k.visible !== false);
    if (!dir) {
      const xs = kids.map(k => k.x), ys = kids.map(k => k.y);
      dir = kids.length > 1 && (Math.max(...xs) - Math.min(...xs)) > (Math.max(...ys) - Math.min(...ys)) ? 'h' : 'v';
    }
    const H = dir === 'h';
    kids.sort((a, b) => H ? a.x - b.x : a.y - b.y);
    const others = (f.children || []).filter(k => !kids.includes(k));
    f.children = kids.concat(others);
    let gap = 10;
    if (kids.length > 1) { const g = []; for (let i = 1; i < kids.length; i++) g.push(H ? kids[i].x - kids[i - 1].x - kids[i - 1].w : kids[i].y - kids[i - 1].y - kids[i - 1].h); gap = Math.max(0, Math.round(g.reduce((a, b) => a + b, 0) / g.length)); }
    const minX = kids.length ? Math.min(...kids.map(k => k.x)) : 0, minY = kids.length ? Math.min(...kids.map(k => k.y)) : 0;
    const maxX = kids.length ? Math.max(...kids.map(k => k.x + k.w)) : 0, maxY = kids.length ? Math.max(...kids.map(k => k.y + k.h)) : 0;
    const pad = kids.length ? [Math.max(0, Math.round(minY)), Math.max(0, Math.round(f.w - maxX)), Math.max(0, Math.round(f.h - maxY)), Math.max(0, Math.round(minX))] : [10, 10, 10, 10];
    f.layout = { mode: dir, gap, pad, align: 'start', justify: 'start' };
    f.sizeH = 'hug'; f.sizeV = 'hug';
  }
  A.removeAutoLayout = () => { editableRoots().forEach(f => { if (f.layout) { f.layout = null; if (f.sizeH === 'hug') f.sizeH = 'fixed'; if (f.sizeV === 'hug') f.sizeV = 'fixed'; } }); ED.commit('Remove auto layout'); };

  /* ---------- arrange / align ---------- */
  A.arrange = how => {
    const roots = editableRoots(); if (!roots.length) return;
    roots.forEach(n => {
      const arr = ED.childArr(ED.parent(n)), i = arr.indexOf(n); arr.splice(i, 1);
      const j = how === 'front' ? arr.length : how === 'back' ? 0 : how === 'forward' ? Math.min(arr.length, i + 1) : Math.max(0, i - 1);
      arr.splice(j, 0, n);
    });
    ED.commit({ front: 'Bring to front', back: 'Send to back', forward: 'Bring forward', backward: 'Send backward' }[how]);
  };
  function shiftWorld(n, dx, dy) { const v = M.apv(M.inv(ED.parentMatrix(n)), dx, dy); n.x = Math.round((n.x + v.x) * 100) / 100; n.y = Math.round((n.y + v.y) * 100) / 100; }
  A.align = how => {
    const roots = editableRoots(); if (!roots.length) return;
    let B;
    if (roots.length === 1) { const p = ED.parent(roots[0]); if (!p || p === ED.doc) { Aero.toast('Select two or more layers, or a layer inside a frame'); return; } B = ED.wbox(p); }
    else B = ED.unionBox(roots);
    roots.forEach(n => {
      const b = ED.wbox(n); let dx = 0, dy = 0;
      if (how === 'left') dx = B.x - b.x; if (how === 'right') dx = B.x + B.w - b.x - b.w; if (how === 'hcenter') dx = B.x + B.w / 2 - b.x - b.w / 2;
      if (how === 'top') dy = B.y - b.y; if (how === 'bottom') dy = B.y + B.h - b.y - b.h; if (how === 'vcenter') dy = B.y + B.h / 2 - b.y - b.h / 2;
      shiftWorld(n, dx, dy);
    });
    ED.commit('Align ' + how);
  };
  A.distribute = axis => {
    const roots = editableRoots(); if (!need(roots.length >= 3, 'Select three or more layers to distribute')) return;
    const H = axis === 'h';
    const items = roots.map(n => ({ n, b: ED.wbox(n) })).sort((a, b) => H ? a.b.x - b.b.x : a.b.y - b.b.y);
    const first = items[0].b, last = items[items.length - 1].b;
    const total = items.reduce((s, it) => s + (H ? it.b.w : it.b.h), 0);
    const span = H ? last.x + last.w - first.x : last.y + last.h - first.y;
    const gap = (span - total) / (items.length - 1);
    let pos = H ? first.x : first.y;
    items.forEach(it => { const d = pos - (H ? it.b.x : it.b.y); shiftWorld(it.n, H ? d : 0, H ? 0 : d); pos += (H ? it.b.w : it.b.h) + gap; });
    ED.commit('Distribute');
  };
  A.tidyUp = () => {
    const roots = editableRoots(); if (!need(roots.length >= 2, 'Select two or more layers to tidy up')) return;
    const items = roots.map(n => ({ n, b: ED.wbox(n) }));
    // group into rows by vertical overlap
    items.sort((a, b) => a.b.y - b.b.y);
    const rows = [];
    items.forEach(it => { const r = rows.find(r => Math.abs(r.cy - (it.b.y + it.b.h / 2)) < Math.max(it.b.h, r.h) / 2); if (r) { r.items.push(it); } else rows.push({ cy: it.b.y + it.b.h / 2, h: it.b.h, items: [it] }); });
    rows.forEach(r => r.items.sort((a, b) => a.b.x - b.b.x));
    const gx = [], gy = [];
    rows.forEach(r => { for (let i = 1; i < r.items.length; i++) gx.push(r.items[i].b.x - r.items[i - 1].b.x - r.items[i - 1].b.w); });
    for (let i = 1; i < rows.length; i++) gy.push(Math.min(...rows[i].items.map(it => it.b.y)) - Math.max(...rows[i - 1].items.map(it => it.b.y + it.b.h)));
    const avg = a => a.length ? Math.max(0, Math.round(a.reduce((s, v) => s + v, 0) / a.length)) : 20;
    const GX = avg(gx), GY = avg(gy);
    const x0 = Math.min(...items.map(it => it.b.x)); let y = Math.min(...items.map(it => it.b.y));
    rows.forEach(r => { let x = x0; const rh = Math.max(...r.items.map(it => it.b.h)); r.items.forEach(it => { shiftWorld(it.n, x - it.b.x, y - it.b.y); x += it.b.w + GX; }); y += rh + GY; });
    ED.commit('Tidy up');
  };
  A.nudge = (dx, dy) => {
    const roots = editableRoots().filter(n => !n.locked); if (!roots.length) return;
    roots.forEach(n => shiftWorld(n, dx, dy));
    clearTimeout(A._nt); ED.live(); ED.emit('sel');
    A._nt = setTimeout(() => ED.commit('Nudge'), 350);
  };
  A.selectAll = () => {
    const s = ED.selNodes()[0];
    const p = s ? ED.parent(s) : ED.doc;
    ED.select(ED.kids(p).filter(n => n.visible !== false && !n.locked).map(n => n.id));
  };
  A.selectParent = () => { if (ED.pathEdit) { ED.exitPathEdit(); return; } const s = ED.selNodes()[0]; if (!s) return; const p = ED.parent(s); ED.select(p && p !== ED.doc ? [p.id] : []); };
  A.selectChildren = () => { const s = ED.selNodes()[0]; if (!s) return; if (s.type === 'text') { ED.startTextEdit(s); return; } if (s.type === 'path' && !ED.pathEdit) { ED.enterPathEdit(s); return; } const k = ED.kids(s); if (k.length) ED.select(k.map(n => n.id)); };
  A.toggle = key => { const roots = ED.selNodes(); if (!roots.length) return; const val = key === 'visible' ? !roots.every(n => n.visible !== false) : !roots.every(n => n.locked); roots.forEach(n => ED.setProp(n, key, val)); ED.commit(key === 'visible' ? (val ? 'Show' : 'Hide') : (val ? 'Lock' : 'Unlock')); };
  A.flip = axis => {
    const roots = editableRoots().filter(n => n.type === 'path'); if (!need(roots.length, 'Flip works on paths')) return;
    roots.forEach(n => {
      if (n.d) { n.d = window.IO.transformD(n.d, axis === 'h' ? [-1, 0, 0, 1, n.bw, 0] : [1, 0, 0, -1, 0, n.bh]); return; }
      LP.contoursOf(n).forEach(c => c.pts.forEach(p => { const k = axis === 'h' ? 'x' : 'y', b = axis === 'h' ? n.bw : n.bh; ['', 'o', 'i'].forEach(q => { const kk = q ? q + k : k; if (p[kk] != null) p[kk] = b - p[kk]; }); }));
    });
    ED.commit('Flip');
  };

  /* ---------- components ---------- */
  A.createComponent = () => {
    let roots = editableRoots(); if (!need(roots.length, 'Select layers to turn into a component')) return;
    let f;
    if (roots.length === 1 && roots[0].type === 'frame' && !roots[0].component) f = roots[0];
    else if (roots.length === 1 && roots[0].component) { Aero.toast('That is already a main component'); return; }
    else { f = A.frameSelection(); if (!f) return; f.fills = []; f.clip = false; f.name = roots.length === 1 ? roots[0].name : 'Component'; }
    if (roots.length === 1 && roots[0].type === 'group') { f.name = roots[0].name; }
    f.component = { set: null, variant: null, desc: '' };
    ED.sel = [f.id]; ED.commit('Create component');
    Aero.toast('Component created — find it in Assets');
  };
  A.components = () => Object.values(ED.scene.byId).filter(n => n.component && !ED.isClone(n));
  A.variantsOf = main => { const set = main?.component?.set; return set ? A.components().filter(c => c.component.set === set) : main ? [main] : []; };
  A.mainOf = n => n && n.type === 'instance' ? ED.get(ED.scene.view(n).componentId || n.componentId) : null;
  A.makeInstance = (main, parent, cx, cy) => {
    const inst = LP.node('instance', { name: main.component?.set ? main.component.set : main.name, componentId: main.id, w: main.w, h: main.h, sizeH: main.sizeH || 'fixed', sizeV: main.sizeV || 'fixed' });
    ED.childArr(parent).push(inst); ED.update();
    if (cx != null) { if (parent !== ED.doc && ED.scene.view(parent).layout) { } else ED.placeCenter(inst, parent, cx, cy); }
    return inst;
  };
  A.insertComponent = (main, at) => {
    const r = ED.stage.getBoundingClientRect();
    const c = at || ED.s2w(r.width / 2, r.height / 2);
    let par = ED.frameAt(c.x, c.y, new Set([main, ...ED.ancestors(main)])) || ED.doc;
    if (par === main || ED.isAncestor(main, par)) par = ED.doc;
    const inst = A.makeInstance(main, par, c.x, c.y);
    ED.sel = [inst.id]; ED.commit('Insert instance');
  };
  A.addVariant = async () => {
    const main = ED.selNodes()[0];
    if (!need(main && main.component && !ED.isClone(main), 'Select a main component to add a variant')) return;
    const name = await Aero.prompt('Add variant', 'Variant name (e.g. Hover, Pressed)', 'Hover'); if (!name) return;
    const set = main.component.set || main.name.replace(/\s*[–-]\s*\w+$/, '');
    A.variantsOf(main).forEach(v => { v.component.set = set; if (!v.component.variant) { v.component.variant = 'Default'; v.name = `${set} – Default`; } });
    const sib = A.variantsOf(main);
    const right = Math.max(...sib.map(v => ED.wbox(v).x + ED.wbox(v).w));
    const c = LP.cloneFresh(main, {}); c.component = { set, variant: name, desc: '' }; c.name = `${set} – ${name}`;
    const par = ED.parent(main), arr = ED.childArr(par); arr.splice(arr.indexOf(main) + 1, 0, c);
    ED.update(); const b = ED.wbox(main); ED.placeCenter(c, par, right + 24 + b.w / 2, b.y + b.h / 2);
    ED.sel = [c.id]; ED.commit('Add variant');
  };
  A.setVariant = (inst, compId) => { ED.setProp(inst, 'componentId', compId); if (!ED.isClone(inst)) inst.componentId = compId; ED.commit('Switch variant'); };
  A.detach = () => {
    const insts = editableRoots().filter(n => n.type === 'instance'); if (!need(insts.length, 'Select an instance to detach')) return;
    const ids = [];
    insts.forEach(inst => {
      const v = ED.scene.view(inst);
      const strip = (c) => { const o = {}; for (const k in c) if (!k.startsWith('_') && k !== 'overrides' && k !== 'mainType') o[k] = c[k]; return o; };
      const build = k => { const o = strip(k); const kids = ED.scene.kids(k); if (k.type === 'instance') { const vv = ED.scene.view(k); Object.assign(o, strip(vv), { type: vv.mainType || 'frame', x: k.x, y: k.y, w: k.w, h: k.h }); delete o.componentId; } if (kids.length || o.children) o.children = kids.map(build); return o; };
      const f = build(inst);
      Object.assign(f, strip(v), { type: v.mainType === 'group' ? 'group' : 'frame', x: inst.x, y: inst.y, w: inst.w, h: inst.h, children: ED.scene.kids(inst).map(build) });
      delete f.componentId; delete f.component;
      const fresh = LP.cloneFresh(f, {});
      fresh.name = inst.name;
      const arr = ED.childArr(ED.parent(inst)); arr.splice(arr.indexOf(inst), 1, fresh); ids.push(fresh.id);
    });
    ED.sel = ids; ED.commit('Detach instance');
  };
  A.resetOverrides = () => {
    const insts = ED.selNodes().filter(n => n.type === 'instance' && !ED.isClone(n)); if (!need(insts.length, 'Select an instance')) return;
    const keep = new Set(['id', 'type', 'name', 'x', 'y', 'w', 'h', 'r', 'visible', 'locked', 'cons', 'sizeH', 'sizeV', 'absolute', 'proto', 'componentId', 'overrides', 'exports', 'opacity', 'blend', 'fixed']);
    insts.forEach(n => { n.overrides = {}; Object.keys(n).forEach(k => { if (!keep.has(k)) delete n[k]; }); });
    ED.commit('Reset overrides');
  };
  A.goToMain = () => { const n = ED.selNodes()[0]; const m = n && n.type === 'instance' ? A.mainOf(n) : null; if (!need(m, 'Select an instance')) return; ED.select([m.id]); ED.zoomToBox(ED.wbox(m), 2); };

  /* ---------- clipboard ---------- */
  A.clip = null;
  A.copy = () => {
    const roots = ED.selRoots(); if (!roots.length) return false;
    const items = roots.map(n => { if (ED.isClone(n)) { return null; } return JSON.parse(JSON.stringify(n)); }).filter(Boolean);
    if (!items.length) return false;
    const wb = roots.map(n => ED.wbox(n));
    // carry referenced images
    const imgs = {}; items.forEach(it => LP.walk(it, x => (x.fills || []).forEach(f => { if (f.type === 'image' && ED.doc.images[f.img]) imgs[f.img] = ED.doc.images[f.img]; })));
    A.clip = { items, boxes: wb, parentId: ED.parent(roots[0])?.id, images: imgs };
    return 'LPROTO:' + JSON.stringify({ items, boxes: wb, images: imgs });
  };
  A.cut = () => { const r = A.copy(); if (r) A.deleteSel(); return r; };
  A.paste = (data) => {
    const clip = data || A.clip; if (!clip?.items?.length) return;
    Object.assign(ED.doc.images, clip.images || {});
    const s = ED.selNodes()[0];
    let par = ED.doc;
    if (s && !ED.isClone(s)) { if (s.type === 'frame' && !clip.items.some(i => i.id === s.id)) par = s; else par = ED.parent(s) || ED.doc; }
    if (par !== ED.doc && ED.isClone(par)) par = ED.doc;
    const ids = [];
    clip.items.forEach((it, i) => {
      const c = LP.cloneFresh(it, {});
      ED.childArr(par).push(c); ED.update();
      const b = clip.boxes[i];
      const same = clip.parentId && par.id === clip.parentId;
      if (b) ED.placeCenter(c, par, b.x + b.w / 2 + (same ? 10 : 0), b.y + b.h / 2 + (same ? 10 : 0));
      if (par !== ED.doc && !ED.scene.view(par).layout) { const pb = ED.wbox(par), cb = ED.wbox(c); if (cb.x > pb.x + pb.w || cb.y > pb.y + pb.h || cb.x + cb.w < pb.x || cb.y + cb.h < pb.y) ED.placeCenter(c, par, pb.x + pb.w / 2, pb.y + pb.h / 2); }
      ids.push(c.id);
    });
    ED.sel = ids; ED.commit('Paste');
  };

  /* ---------- styles ---------- */
  A.addColorStyle = async (color, a = 1) => {
    const s = ED.selNodes()[0];
    const f = s && (ED.scene.view(s).fills || []).find(x => x.type === 'solid');
    const c = color || (f ? LP.fillColor(f, ED.doc) : { color: '#1f8bff', a: 1 });
    const name = await Aero.prompt('New color style', 'Name', 'Color ' + (ED.doc.colorStyles.length + 1)); if (!name) return;
    const st = { id: LP.newId(), name, color: LP.toHex(c.color), a: c.a ?? 1 };
    ED.doc.colorStyles.push(st);
    if (f && s && !color) { const fills = JSON.parse(JSON.stringify(ED.scene.view(s).fills)); const ff = fills.find(x => x.type === 'solid'); ff.style = st.id; ED.setProp(s, 'fills', fills); }
    ED.commit('Add color style');
  };
  A.applyColorStyle = (st, target = 'fill') => {
    if (target === 'fill' && ED.applyRangeStyle && ED.applyRangeStyle({ cs: st.id, color: null, a: null })) return;
    const sel = ED.selNodes(); if (!need(sel.length, 'Select layers to apply the color')) return;
    sel.forEach(n => {
      if (n.type === 'icon') { ED.setProp(n, 'color', st.color); return; }
      const key = target === 'stroke' ? 'strokes' : 'fills';
      const arr = JSON.parse(JSON.stringify(ED.scene.view(n)[key] || []));
      if (key === 'strokes') { if (arr[0]) Object.assign(arr[0], { style: st.id, color: st.color, a: st.a }); else arr.push({ color: st.color, a: st.a, w: 1, align: 'inside', on: true, style: st.id }); }
      else { const i = arr.findIndex(f => f.type === 'solid'); const nf = { type: 'solid', color: st.color, a: st.a, style: st.id, on: true }; if (i >= 0) arr[i] = nf; else arr.unshift(nf); }
      ED.setProp(n, key, arr);
    });
    ED.commit('Apply color style');
  };
  A.addTextStyle = async () => {
    const s = ED.selNodes().find(n => n.type === 'text');
    if (!need(s, 'Select a text layer to create a text style from it')) return;
    const name = await Aero.prompt('New text style', 'Name', `${s.size}/${s.weight}`); if (!name) return;
    const t = LP.textProps(s, ED.doc);
    const st = { id: LP.newId(), name }; LP.TEXT_KEYS.forEach(k => st[k] = t[k]);
    ED.doc.textStyles.push(st);
    if (!ED.isClone(s)) s.textStyleId = st.id;
    ED.commit('Add text style');
  };
  A.applyTextStyle = st => {
    if (ED.applyRangeStyle && ED.applyRangeStyle({ ts: st.id, font: null, size: null, weight: null, italic: null, lh: null, ls: null })) return;
    const sel = ED.selNodes().filter(n => n.type === 'text'); if (!need(sel.length, 'Select text layers')) return;
    sel.forEach(n => { ED.setProp(n, 'textStyleId', st.id); if (!ED.isClone(n)) { LP.TEXT_KEYS.forEach(k => n[k] = st[k]); if (n.runs) { const r = LP.applyRunStyle(n, 0, String(n.text || '').length, { font: null, size: null, weight: null, italic: null, lh: null, ls: null, ts: null }); if (r) n.runs = r; else delete n.runs; } } });
    ED.commit('Apply text style');
  };
  A.deleteStyle = (kind, st) => {
    const list = kind === 'color' ? ED.doc.colorStyles : ED.doc.textStyles;
    list.splice(list.indexOf(st), 1);
    // detach references, keeping the look
    LP.walk(ED.doc, n => {
      if (kind === 'color') ['fills', 'strokes'].forEach(k => (n[k] || []).forEach(f => { if (f.style === st.id) { f.style = null; f.color = st.color; f.a = st.a; } }));
      else if (n.textStyleId === st.id) { LP.TEXT_KEYS.forEach(k => n[k] = st[k]); n.textStyleId = null; }
      Object.values(n.overrides || {}).forEach(o => { if (kind === 'text' && o.textStyleId === st.id) delete o.textStyleId; ['fills', 'strokes'].forEach(k => (o[k] || []).forEach(f => { if (f.style === st.id) { f.style = null; f.color = st.color; f.a = st.a; } })); });
    });
    ED.commit('Delete style');
  };

  /* ---------- images & icons ---------- */
  A.addImage = (dataUrl, w, h, at, name) => {
    const id = LP.newId(); ED.doc.images[id] = dataUrl;
    const r = ED.stage.getBoundingClientRect();
    const c = at || ED.s2w(r.width / 2, r.height / 2);
    const sel = ED.selNodes()[0];
    // drop into a selected rectangle/frame shape: becomes its image fill
    if (!at && sel && !ED.isClone(sel) && (sel.type === 'rect' || sel.type === 'ellipse') ) {
      sel.fills = [{ type: 'image', img: id, mode: 'fill', a: 1, on: true }]; ED.commit('Image fill'); return sel;
    }
    const par = ED.frameAt(c.x, c.y, new Set()) || ED.doc;
    let W = w, H = h; const max = par !== ED.doc ? Math.min(par.w, 600) : 800;
    if (W > max) { H = H * max / W; W = max; }
    const n = LP.node('rect', { name: name || 'Image', w: Math.round(W), h: Math.round(H), fills: [{ type: 'image', img: id, mode: 'fill', a: 1, on: true }] });
    ED.childArr(par).push(n); ED.update(); ED.placeCenter(n, par, c.x, c.y);
    ED.sel = [n.id]; ED.commit('Place image'); return n;
  };
  A.addIcon = (name, at) => {
    const r = ED.stage.getBoundingClientRect(); const c = at || ED.s2w(r.width / 2, r.height / 2);
    const sel = ED.selNodes()[0];
    if (!at && sel && sel.type === 'icon') { ED.setProp(sel, 'icon', name); ED.commit('Change icon'); return; }
    const par = ED.frameAt(c.x, c.y, new Set()) || ED.doc;
    const n = LP.node('icon', { name, icon: name });
    ED.childArr(par).push(n); ED.update(); ED.placeCenter(n, par, c.x, c.y);
    ED.sel = [n.id]; ED.commit('Insert icon');
  };
  A.newArtboard = (preset) => {
    const right = ED.doc.children.length ? Math.max(...ED.doc.children.map(k => k.x + k.w)) + 80 : 0;
    const top = ED.doc.children.length ? Math.min(...ED.doc.children.map(k => k.y)) : 0;
    const n = LP.node('frame', { name: preset.name, x: right, y: top, w: preset.w, h: preset.h });
    ED.doc.children.push(n); ED.sel = [n.id]; ED.commit('New artboard');
    ED.zoomToBox(ED.wbox(n), 1);
  };
  A.PRESETS = [
    { name: 'iPhone 15', w: 393, h: 852 }, { name: 'iPhone SE', w: 375, h: 667 }, { name: 'Android', w: 360, h: 800 }, { name: 'iPad', w: 820, h: 1180 },
    { name: 'Desktop 1440', w: 1440, h: 1024 }, { name: 'Web 1920', w: 1920, h: 1080 }
  ];
})();
