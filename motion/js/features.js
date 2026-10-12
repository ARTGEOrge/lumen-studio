'use strict';
/* Lumen Motion — v1.1 commands: 3D layers & cameras, time remapping / freeze / reverse, frame blending,
   shape groups, repeaters, merge paths, gradients, combining shape layers. */
(function () {
  const LM = window.LM, F = LM.factory, st = LM.st, M = LM.M, W = LM.w;
  const sel = () => LM.selLayers();

  /* ---------- 3D & camera ---------- */
  LM.set3D = (layers = sel(), on) => {
    const ls = layers.filter(L => L.type !== 'audio' && L.type !== 'camera'); if (!ls.length) return Aero.toast('Select a visual layer to make it 3D');
    if (on === undefined) on = !ls.every(L => L.threeD);
    ls.forEach(L => { L.threeD = on; if (on) { L.expanded = true; LM.ui.open.add(L.id + '|transform'); } });
    LM.commit(on ? '3D Layer On' : '3D Layer Off');
  };
  LM.newCamera = () => {
    const c = LM.comp(), def = Math.round(LM.space.defaultZoom(c) * 10) / 10;
    const lenses = [['15', '15 mm (very wide)'], ['24', '24 mm (wide)'], ['35', '35 mm'], ['50', '50 mm (normal)'], ['80', '80 mm'], ['135', '135 mm (tele)'], ['200', '200 mm (long tele)']];
    Aero.dialog({
      title: 'Camera Settings', width: 440, instruction: 'A camera views every 3D layer (cube switch) in this composition with perspective.',
      fields: [{ key: 'name', label: 'Name', type: 'text', value: LM.uniqueName(c, 'Camera 1') }, { key: 'lens', label: 'Preset', type: 'select', value: '50', options: lenses }, { key: 'zoom', label: 'Zoom (px)', type: 'number', value: def, min: 10, max: 100000 }, { key: 'make3d', label: 'Make selected layers 3D', type: 'checkbox', value: sel().some(l => l.type !== 'audio' && l.type !== 'camera' && !l.threeD) }],
      onInput: (k, v, set) => { if (k === 'lens') set('zoom', Math.round(def * (+v.lens) / 50 * 10) / 10); },
      onOK: v => {
        const ls = sel();
        if (v.make3d) ls.forEach(l => { if (l.type !== 'audio' && l.type !== 'camera') l.threeD = true; });
        const L = F.camera(c, Math.max(10, v.zoom || def)); L.name = v.name || 'Camera 1';
        L.expanded = true; LM.ui.open.add(L.id + '|camera'); LM.ui.open.add(L.id + '|transform');
        c.layers.unshift(L); LM.st.sel = [L.id]; LM.commit('New Camera'); LM.emit('select');
        if (!c.layers.some(l => l.threeD)) Aero.toast('Turn on the 3D switch (cube) on layers to view them through the camera');
      }
    });
  };

  /* ---------- time ---------- */
  const remappable = () => { const ls = sel().filter(LM.canTimeRemap); if (!ls.length) Aero.toast('Time remapping works on precomp, video and audio layers'); return ls; };
  const openTM = L => { L.expanded = true; };
  LM.toggleTimeRemap = (layers) => {
    const ls = layers || remappable(); if (!ls.length) return;
    const on = !ls.every(L => L.tm.on);
    ls.forEach(L => {
      const p = L.tm.p; delete p.x;
      if (on) { const a = L.in - L.start, b = L.out - L.start; L.tm.on = true; p.v = a; p.k = [{ t: a, v: a, i: 'linear', o: 'linear' }, { t: b, v: b, i: 'linear', o: 'linear' }]; openTM(L); }
      else { L.tm.on = false; delete p.k; p.v = 0; }
    });
    LM.commit(on ? 'Enable Time Remapping' : 'Disable Time Remapping');
  };
  LM.freezeFrame = () => {
    const ls = remappable(); if (!ls.length) return;
    ls.forEach(L => { const v = LM.srcTime(L, st.time), lt = LM.snap(st.time - L.start); L.tm.on = true; delete L.tm.p.x; L.tm.p.v = v; L.tm.p.k = [{ t: lt, v, i: 'hold', o: 'hold' }]; openTM(L); });
    LM.commit('Freeze Frame');
  };
  LM.timeReverse = () => {
    const ls = remappable(); if (!ls.length) return;
    ls.forEach(L => { const f = 1 / L._c.fps, a = L.in - L.start, b = L.out - L.start; L.tm.on = true; delete L.tm.p.x; L.tm.p.v = a; L.tm.p.k = [{ t: a, v: b - f, i: 'linear', o: 'linear' }, { t: b, v: a - f, i: 'linear', o: 'linear' }]; openTM(L); });
    LM.commit('Time-Reverse Layer');
  };
  LM.toggleFrameBlend = () => {
    const ls = sel().filter(L => L.type === 'precomp' || L.type === 'video'); if (!ls.length) return Aero.toast('Frame blending works on precomp and video layers');
    const on = !ls.every(L => L.fb); ls.forEach(L => L.fb = on); LM.commit(on ? 'Frame Blending On' : 'Frame Blending Off');
  };

  /* ---------- shape contents ---------- */
  const KIND_NAME = { rect: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', star: 'Star', path: 'Path' };
  const uniqueGroupName = (L, base) => { let n = base, i = 2; while (L.shape.groups.some(g => g.name === n)) n = base + ' ' + i++; return n; };
  const openContents = (L, ...ids) => { L.expanded = true; LM.ui.open.add(L.id + '|contents'); ids.forEach(i => LM.ui.open.add(L.id + '|' + i)); };
  LM.addShapeGroup = (L, kind = 'rect') => {
    if (!L || L.type !== 'shape') return Aero.toast('Select a shape layer first');
    const b = LM.layerBounds(L, st.time), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const COLORS = ['#ffb020', '#ff5a7a', '#36c98e', '#8f6bff', '#2fb5ff'];
    const g = F.shapeGroup(kind, { size: [200, 200], outer: 100, inner: 45, points: kind === 'star' ? 5 : kind === 'polygon' ? 6 : 5, fill: COLORS[L.shape.groups.length % COLORS.length], pos: [cx + 80, cy + 80], name: uniqueGroupName(L, KIND_NAME[kind] + ' Group') });
    if (kind === 'path') g.path.v = { c: true, pts: [[-100, -80, 0, 0, 0, 0], [100, -80, 0, 0, 0, 0], [0, 100, 0, 0, 0, 0]] };
    L.shape.groups.unshift(g); if (L.shape.order > 0) L.shape.order++; openContents(L, 'grp.' + g.id);
    LM.commit('Add ' + KIND_NAME[kind] + ' Group');
    return g;
  };
  LM.toggleRepeater = (L, g) => {
    if (!L || L.type !== 'shape') return Aero.toast('Select a shape layer first');
    const R = g ? g.rep : L.shape.rep; R.on = !R.on;
    if (R.on) { const b = LM.layerBounds(L, st.time); if (!g && R.position.v[0] === 100 && R.position.v[1] === 0 && !R.position.k) R.position.v = [Math.max(40, Math.round((b[2] - b[0]) * 1.2)), 0]; openContents(L, g ? 'grp.' + g.id : 'shape.rep', g ? 'grp.' + g.id + '.rep' : 'shape.rep.tr'); }
    LM.commit(R.on ? 'Add Repeater' : 'Remove Repeater');
  };
  LM.setMerge = (L, mode) => { if (!L || L.type !== 'shape') return; L.shape.merge = mode; openContents(L); LM.commit(mode === 'off' ? 'Merge Paths Off' : 'Merge Paths'); };
  LM.setGradient = (L, which, type) => {
    if (!L || L.type !== 'shape') return Aero.toast('Select a shape layer first');
    const P = L.shape[which]; P.gtype = type;
    if (type !== 'solid') {
      const b = LM.flatten(LM.shapePath(L, st.time), 8).reduce((a, [x, y]) => [Math.min(a[0], x), Math.min(a[1], y), Math.max(a[2], x), Math.max(a[3], y)], [Infinity, Infinity, -Infinity, -Infinity]);
      const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
      if (!P.gs.k && !P.ge.k) { if (type === 'linear') { P.gs.v = [b[0], cy]; P.ge.v = [b[2], cy]; } else { P.gs.v = [cx, cy]; P.ge.v = [b[2], cy]; } }
      if (which === 'stroke') P.on = true;
      if (!P.c2.k && P.c2.v === '#000000') { const c = LM.hex2rgb(LM.val(P.color, st.time)); P.c2.v = LM.rgb2hex(c[0] * .25, c[1] * .25, c[2] * .45 + 40); }
    }
    openContents(L, 'shape.' + which); LM.commit(type === 'solid' ? 'Solid ' + which : 'Gradient ' + (which === 'fill' ? 'Fill' : 'Stroke'));
  };
  LM.shapeAddMenu = (L, x, y) => {
    const S = L.shape;
    W.menu(x, y, ['#Add Group', ['Rectangle', () => LM.addShapeGroup(L, 'rect')], ['Ellipse', () => LM.addShapeGroup(L, 'ellipse')], ['Polygon', () => LM.addShapeGroup(L, 'polygon')], ['Star', () => LM.addShapeGroup(L, 'star')], ['Bezier Path', () => LM.addShapeGroup(L, 'path')], '-',
      [S.rep.on ? 'Remove Repeater' : 'Repeater', () => LM.toggleRepeater(L, null), { checked: S.rep.on }], '#Merge Paths', ...LM.MERGE_MODES.map(([m, label]) => [label, () => LM.setMerge(L, m), { checked: S.merge === m }]), '-',
      '#Fill', ...[['solid', 'Solid Fill'], ['linear', 'Linear Gradient Fill'], ['radial', 'Radial Gradient Fill']].map(([k, label]) => [label, () => LM.setGradient(L, 'fill', k), { checked: S.fill.gtype === k }]),
      '#Stroke', ...[['solid', 'Solid Stroke'], ['linear', 'Linear Gradient Stroke'], ['radial', 'Radial Gradient Stroke']].map(([k, label]) => [label, () => LM.setGradient(L, 'stroke', k), { checked: S.stroke.gtype === k }])]);
  };
  // Combine selected shape layers into the topmost one: the others become groups (transforms baked at the current time)
  const decompose = m => { const sx = Math.hypot(m[0], m[1]), det = m[0] * m[3] - m[1] * m[2]; return { position: [m[4], m[5]], rotation: Math.atan2(m[1], m[0]) * 180 / Math.PI, scale: [sx * 100, (sx ? det / sx : 0) * 100] }; };
  LM.combineShapes = () => {
    const c = LM.comp(), ls = sel().filter(L => L.type === 'shape');
    if (ls.length < 2) return Aero.toast('Select two or more shape layers to combine');
    ls.sort((a, b) => c.layers.indexOf(a) - c.layers.indexOf(b));
    const base = ls[0], t = st.time, inv = M.inv(LM.layerMatrix(base, t, c));
    const groups = [];
    ls.slice(1).forEach(O => {
      const rel = M.mul(inv, LM.layerMatrix(O, t, c)), op = LM.val(O.tr.opacity, t);
      const mk = (src, m, name, opMul) => {
        const g = F.shapeGroup(src.kind); ['kind', 'size', 'roundness', 'points', 'outer', 'inner', 'path', 'fill', 'stroke', 'trim'].forEach(k => g[k] = LM.clone(src[k]));
        if (src.rep) g.rep = LM.clone(src.rep);
        const d = decompose(m); g.gt.position.v = d.position; g.gt.rotation.v = d.rotation; g.gt.scale.v = d.scale; g.gt.opacity.v = opMul; g.name = name; return g;
      };
      O.shape.groups.forEach(gr => groups.push(mk(gr, M.mul(rel, LM.groupMatrix(gr, t)), O.name + ' › ' + gr.name, op * LM.val(gr.gt.opacity, t) / 100)));
      groups.push(mk(O.shape, rel, O.name, op));
    });
    base.shape.groups.push(...groups.reverse());
    const drop = new Set(ls.slice(1).map(l => l.id));
    c.layers = c.layers.filter(l => !drop.has(l.id)); c.layers.forEach(l => { if (drop.has(l.parent)) l.parent = null; });
    base.expanded = true; LM.ui.open.add(base.id + '|contents'); LM.st.sel = [base.id];
    LM.commit('Combine Shape Layers'); LM.emit('select');
    Aero.toast(`Combined ${ls.length} layers into “${base.name}” (positions baked at the current time)`);
  };

})();
