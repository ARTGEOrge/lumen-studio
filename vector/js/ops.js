'use strict';
/* Lumen Vector — object operations: edit, arrange, group, align, pathfinder, path ops, transforms, artboards. */
(function () {
  const need = (n = 1, msg) => { if (LV.sel.length < n) { LV.toast(msg || (n > 1 ? `Select at least ${n} objects` : 'Select an object first')); return false; } return true; };
  const sorted = () => LV.sortZ(LV.sel);

  /* ---------- edit ---------- */
  LV.deleteSel = () => {
    if (LV.toolId === 'artboard') return LV.deleteArtboard();
    if (LV.toolId === 'width' && LV.tool.deletePoint()) return;
    if (LV.toolId === 'direct' && LV.selSegs.size) {
      const segs = [...LV.selSegs], paths = new Set(segs.map(s => s.path));
      segs.forEach(s => s.remove());
      paths.forEach(p => { if (p.segments.length < 2) { const par = p.parent; p.remove(); if (par instanceof P.CompoundPath && !par.children.length) par.remove(); } });
      LV.setSel(LV.sel.filter(it => it.parent)); LV.commit('Delete Anchors'); return;
    }
    if (!LV.sel.length) return;
    LV.threadUnlink(LV.sel); LV.sel.forEach(it => it.remove()); LV.setSel([]); LV.commit('Delete');
  };
  // turn live/compound objects (symbol instances, tracings, blends) into plain groups before path operations
  LV.expandSpecial = it => {
    const k = LV.kind(it);
    if (k === 'symbol') { it.applyMatrix = true; delete it.data.kind; delete it.data.sym; return it; }
    if (k === 'trace') return LV.trace.expand(it);
    if (k === 'blend') return LV.blend.expandOne(it);
    return it;
  };
  LV.copy = () => { if (!need()) return false; LV.clipboard = { items: sorted().map(it => it.exportJSON({ asString: false })), bounds: LV.selBounds() }; LV.toast(`Copied ${LV.sel.length} object${LV.sel.length > 1 ? 's' : ''}`); return true; };
  LV.cut = () => { if (LV.copy()) { LV.threadUnlink(LV.sel); LV.sel.forEach(it => it.remove()); LV.setSel([]); LV.commit('Cut'); } };
  LV.paste = (mode = 'center') => {
    const cb = LV.clipboard; if (!cb) return LV.toast('Clipboard is empty');
    const L = LV.activeLayer(), items = cb.items.map(j => LV.reUid(P.Base.importJSON(j)));
    const front = mode === 'back' ? null : LV.sel.length ? sorted()[LV.sel.length - 1] : null, back = mode === 'back' && LV.sel.length ? sorted()[0] : null;
    items.forEach(it => { if (front && (mode === 'front')) it.insertAbove(front); else if (back) it.insertBelow(back); else L.addChild(it); });
    if (back) { /* keep order */ }
    if (mode === 'center') { const b = cb.bounds, c = P.view.center; items.forEach(it => it.translate(c.subtract(b.center))); }
    LV.setSel(items); LV.commit(mode === 'center' ? 'Paste' : mode === 'front' ? 'Paste in Front' : mode === 'back' ? 'Paste in Back' : 'Paste in Place');
  };
  LV.duplicate = () => { if (!need()) return; const c = LV.duplicateSel(); c.forEach(it => it.translate([10, 10])); LV.commit('Duplicate'); };
  LV.selectAll = (onBoard) => {
    let items = LV.allObjects().filter(o => o.visible && !o.locked && LV.ancestorsOk(o));
    if (onBoard) { const r = LV.boardRect(LV.board()); items = items.filter(o => r.intersects(o.bounds)); }
    if (LV.toolId === 'direct') LV.setSel(items, LV.pathsOf(items).flatMap(p => p.segments)); else LV.setSel(items);
  };
  LV.selectInverse = () => LV.setSel(LV.allObjects().filter(o => o.visible && !o.locked && LV.ancestorsOk(o) && !LV.sel.includes(o)));
  LV.selectSame = attr => {
    if (!need()) return; const src = LV.firstPaintable(LV.sel[0]); if (!src) return;
    const key = JSON.stringify(LV.colorToSpec(src[attr]));
    LV.setSel(LV.allObjects().filter(o => o.visible && !o.locked && LV.ancestorsOk(o) && LV.paintTargets(o).some(t => JSON.stringify(LV.colorToSpec(t[attr])) === key)));
  };

  /* ---------- arrange / group / lock ---------- */
  LV.arrange = how => {
    if (!need()) return; const s = sorted();
    if (how === 'front') s.forEach(it => it.bringToFront());
    else if (how === 'back') s.slice().reverse().forEach(it => it.sendToBack());
    else if (how === 'forward') s.slice().reverse().forEach(it => { const n = it.nextSibling; if (n && !LV.sel.includes(n)) it.insertAbove(n); });
    else if (how === 'backward') s.forEach(it => { const p = it.previousSibling; if (p && !LV.sel.includes(p)) it.insertBelow(p); });
    LV.commit({ front: 'Bring to Front', back: 'Send to Back', forward: 'Bring Forward', backward: 'Send Backward' }[how]);
  };
  LV.group = () => {
    if (!need(1)) return; const s = sorted(), top = s[s.length - 1];
    const g = new P.Group({ insert: false }); g.insertAbove(top); g.addChildren(s); g.name = 'Group'; LV.uidOf(g);
    LV.setSel([g]); LV.commit('Group');
  };
  LV.ungroup = () => {
    const out = []; let did = false;
    LV.sel.forEach(it => {
      if (it instanceof P.Group && !it.data.kind && !(it instanceof P.Layer)) {
        const kids = it.removeChildren(); const mask = it.clipped ? kids.find(k => k.clipMask) : null;
        if (mask) { mask.clipMask = false; mask.fillColor = null; mask.strokeColor = null; }
        it.parent.insertChildren(it.index, kids); kids.forEach(k => { k.transform(it.matrix); out.push(k); }); it.remove(); did = true;
      } else out.push(it);
    });
    if (!did) return LV.toast('Selection contains no groups');
    LV.setSel(out); LV.commit('Ungroup');
  };
  LV.lockSel = () => { if (!need()) return; LV.sel.forEach(it => it.locked = true); LV.setSel([]); LV.commit('Lock'); };
  LV.unlockAll = () => { const items = P.project.getItems({ match: it => !(it instanceof P.Layer) && it.locked }); items.forEach(it => it.locked = false); LV.setSel(items.filter(i => i.parent instanceof P.Layer)); LV.commit('Unlock All'); };
  LV.hideSel = () => { if (!need()) return; LV.sel.forEach(it => it.visible = false); LV.setSel([]); LV.commit('Hide'); };
  LV.showAll = () => { const items = P.project.getItems({ match: it => !(it instanceof P.Layer) && !it.visible && it.data.role !== 'frame' }); items.forEach(it => it.visible = true); LV.setSel(items.filter(i => i.parent instanceof P.Layer)); LV.commit('Show All'); };

  /* ---------- align & distribute ---------- */
  LV.alignTo = 'selection';
  LV.align = how => {
    const toBoard = LV.alignTo === 'artboard' || LV.sel.length === 1;
    if (!need(toBoard ? 1 : 2)) return;
    const R = toBoard ? LV.boardRect(LV.board()) : LV.selBounds();
    LV.sel.forEach(it => {
      const b = it.bounds; let d = new P.Point(0, 0);
      if (how === 'left') d.x = R.left - b.left; else if (how === 'hcenter') d.x = R.center.x - b.center.x; else if (how === 'right') d.x = R.right - b.right;
      else if (how === 'top') d.y = R.top - b.top; else if (how === 'vcenter') d.y = R.center.y - b.center.y; else if (how === 'bottom') d.y = R.bottom - b.bottom;
      it.translate(d);
    });
    LV.commit('Align');
  };
  LV.distribute = how => {
    if (!need(3, 'Select at least 3 objects to distribute')) return;
    const horiz = how.startsWith('h'), key = horiz ? 'x' : 'y';
    const items = LV.sel.slice().sort((a, b) => a.bounds.center[key] - b.bounds.center[key]), n = items.length;
    if (how.endsWith('space')) {
      const lo = horiz ? 'left' : 'top', hi = horiz ? 'right' : 'bottom', size = horiz ? 'width' : 'height';
      const first = items[0].bounds[lo], last = items[n - 1].bounds[hi], total = items.reduce((s, it) => s + it.bounds[size], 0), gap = (last - first - total) / (n - 1);
      let pos = first; items.forEach(it => { const d = pos - it.bounds[lo]; it.translate(horiz ? [d, 0] : [0, d]); pos += it.bounds[size] + gap; });
    } else {
      const a = items[0].bounds.center[key], b = items[n - 1].bounds.center[key];
      items.forEach((it, i) => { const d = a + (b - a) * i / (n - 1) - it.bounds.center[key]; it.translate(horiz ? [d, 0] : [0, d]); });
    }
    LV.commit('Distribute');
  };

  /* ---------- pathfinder ---------- */
  const toPathItem = it => {
    if (['symbol', 'trace', 'blend'].includes(LV.kind(it))) it = LV.expandSpecial(it);
    if (LV.isPathItem(it)) return it;
    if (LV.isTextLike(it)) return LV.outlineText(it);
    if (it instanceof P.Group && !it.clipped) { // unite children into one compound shape
      const parts = LV.leaves(it).map(toPathItem).filter(LV.isPathItem); if (!parts.length) return null;
      let r = parts[0].clone({ insert: false }); for (const p of parts.slice(1)) r = r.unite(p, { insert: false });
      r.style = parts[parts.length - 1].style; r.insertAbove(it); it.remove(); return r;
    }
    return null;
  };
  LV.pathfinder = op => {
    if (!need(2, 'Select at least 2 shapes')) return;
    const items = sorted().map(toPathItem).filter(Boolean);
    if (items.length < 2) return LV.toast('Pathfinder works on shapes and paths');
    const top = items[items.length - 1], bottom = items[0];
    let result;
    if (op === 'divide') {
      const pieces = LV.dividePieces(items, false);
      const g = new P.Group({ insert: false, name: 'Divided' });
      pieces.forEach(pc => { const parts = pc.path instanceof P.CompoundPath ? splitCompound(pc.path) : [pc.path]; parts.forEach(pp => { pp.style = pc.src.style; LV.reUid(pp); g.addChild(pp); }); });
      g.insertAbove(top); result = g;
    } else {
      const fn = { unite: 'unite', subtract: 'subtract', intersect: 'intersect', exclude: 'exclude' }[op];
      let r = op === 'subtract' ? bottom.clone({ insert: false }) : bottom.clone({ insert: false });
      for (const it of items.slice(1)) r = r[fn](it, { insert: false });
      r.style = (op === 'subtract' ? bottom : top).style; r.opacity = (op === 'subtract' ? bottom : top).opacity;
      if (r instanceof P.CompoundPath) r.reduce();
      r.insertAbove(top); r.name = { unite: 'Unite', subtract: 'Minus Front', intersect: 'Intersect', exclude: 'Exclude' }[op]; result = r;
    }
    items.forEach(i => i.remove());
    LV.reUid(result); LV.setSel([result]); LV.commit({ unite: 'Unite', subtract: 'Minus Front', intersect: 'Intersect', exclude: 'Exclude', divide: 'Divide' }[op]);
  };
  // non-destructive Divide: the regions formed by overlapping path items (bottom → top), each with the item that paints it
  LV.dividePieces = (items, split = true) => {
    const bottom = items[0]; let pieces = [{ path: bottom.clone({ insert: false }), src: bottom }];
    for (const it of items.slice(1)) {
      const next = []; let covered = null;
      for (const pc of pieces) {
        const inter = pc.path.intersect(it, { insert: false }), rest = pc.path.subtract(it, { insert: false });
        if (!inter.isEmpty() && Math.abs(inter.area) > 1e-3) next.push({ path: inter, src: it });
        if (!rest.isEmpty() && Math.abs(rest.area) > 1e-3) next.push({ path: rest, src: pc.src });
        covered = covered ? covered.unite(pc.path, { insert: false }) : pc.path;
      }
      const own = covered ? it.subtract(covered, { insert: false }) : it.clone({ insert: false });
      if (!own.isEmpty() && Math.abs(own.area) > 1e-3) next.push({ path: own, src: it });
      pieces = next;
    }
    if (!split) return pieces;
    return pieces.flatMap(pc => (pc.path instanceof P.CompoundPath ? splitCompound(pc.path) : [pc.path]).filter(p => Math.abs(p.area) > 0.5).map(p => ({ path: p, src: pc.src })));
  };
  // Shape Builder: merge (or with erase, delete) regions of the selected shapes; the rest stay as separate shapes
  LV.shapeBuild = (items, picked, erase) => {
    const pieces = LV.dividePieces(items), first = pc => picked.findIndex(p => pc.path.contains(p));
    const sel = pieces.filter(pc => first(pc) >= 0).sort((x, y) => first(x) - first(y)); // style comes from where the drag started
    if (!sel.length) return null;
    const top = items[items.length - 1], made = [];
    const styled = (p, src) => { p.style = src.style; p.opacity = src.opacity; p.blendMode = src.blendMode; if (src.data.fx) p.data.fx = src.data.fx; p.name = src.name || 'Path'; return LV.reUid(p); };
    pieces.filter(pc => !sel.includes(pc)).forEach(pc => { const p = styled(pc.path, pc.src); p.insertAbove(top); made.push(p); });
    let merged = null;
    if (!erase) {
      merged = sel[0].path; sel.slice(1).forEach(pc => { merged = merged.unite(pc.path, { insert: false }); });
      if (merged instanceof P.CompoundPath) merged.reduce();
      styled(merged, sel[0].src); merged.name = 'Shape'; merged.insertAbove(top); made.push(merged);
    }
    items.forEach(i => i.remove());
    return { merged, made };
  };
  function splitCompound(cp) {
    const parts = cp.children.slice();
    const outers = parts.filter(c => !parts.some(o => o !== c && Math.abs(o.area) > Math.abs(c.area) && o.contains(c.interiorPoint)));
    return outers.map(o => { const holes = parts.filter(h => h !== o && !outers.includes(h) && o.contains(h.interiorPoint)); return holes.length ? new P.CompoundPath({ children: [o, ...holes].map(x => x.clone({ insert: false })), insert: false }) : o.clone({ insert: false }); });
  }

  /* ---------- path operations ---------- */
  const pathSel = () => LV.sel.flatMap(it => LV.leaves(it)).filter(LV.isPathItem);
  LV.offsetPath = () => {
    const ps = pathSel(); if (!ps.length) return LV.toast('Select one or more paths');
    let made = [];
    const run = v => { made.forEach(m => m.remove()); made = []; if (!v.d) return LV.redraw(); ps.forEach(p => { try { const o = PaperOffset.offset(p, v.d, { join: v.j, limit: v.l, insert: false }); o.insertBelow(p); made.push(o); } catch (e) { console.warn(e); } }); LV.redraw(); };
    Aero.dialog({
      title: 'Offset Path', fields: [{ key: 'd', label: 'Offset', type: 'number', value: 10, step: 1 }, { key: 'j', label: 'Joins', type: 'select', value: 'round', options: [['miter', 'Miter'], ['round', 'Round'], ['bevel', 'Bevel']] }, { key: 'l', label: 'Miter limit', type: 'number', value: 4 }],
      onChange: v => run(v),
      onOK: v => { run(v); made.forEach(m => { LV.reUid(m); m.name = 'Offset Path'; }); LV.setSel(made); LV.commit('Offset Path'); },
      onCancel: () => { made.forEach(m => m.remove()); LV.redraw(); }
    });
  };
  LV.outlineStroke = () => {
    const ps = pathSel().filter(p => p.hasStroke()); if (!ps.length) return LV.toast('Select a stroked path');
    const out = [];
    ps.forEach(p => {
      if (LV.width.active(p)) { const x = LV.width.expand(p); if (x) { x.insertAbove(p); LV.reUid(x); out.push(x); p.remove(); return; } }
      const w = p.strokeWidth, al = p.data.strokeAlign, closed = p instanceof P.CompoundPath || p.closed;
      let o = PaperOffset.offsetStroke(p, w / 2, { join: p.strokeJoin, cap: p.strokeCap, limit: p.miterLimit, insert: false });
      if (al && al !== 'center' && closed) { o = PaperOffset.offsetStroke(p, w, { join: p.strokeJoin, cap: p.strokeCap, limit: p.miterLimit, insert: false }); o = al === 'inside' ? o.intersect(p, { insert: false }) : o.subtract(p, { insert: false }); }
      o.fillColor = p.strokeColor; o.strokeColor = null; o.name = 'Outlined Stroke';
      if (p.hasFill()) {
        const f = p.clone({ insert: false }); f.strokeColor = null; f.data.strokeAlign = null;
        const g = new P.Group({ children: [f, o], insert: false, name: 'Outlined' }); g.opacity = p.opacity; g.blendMode = p.blendMode; f.opacity = 1; f.blendMode = 'normal';
        g.insertAbove(p); LV.reUid(g); out.push(g);
      } else { o.opacity = p.opacity; o.blendMode = p.blendMode; o.insertAbove(p); LV.reUid(o); out.push(o); }
      p.remove();
    });
    LV.setSel(out); LV.commit('Outline Stroke');
  };
  LV.simplify = () => {
    const ps = pathSel().flatMap(p => p instanceof P.CompoundPath ? p.children : [p]); if (!ps.length) return LV.toast('Select one or more paths');
    const orig = ps.map(p => p.segments.map(s => [s.point.clone(), s.handleIn.clone(), s.handleOut.clone()])), before = ps.reduce((n, p) => n + p.segments.length, 0);
    const restore = () => ps.forEach((p, i) => { p.removeSegments(); p.addSegments(orig[i].map(a => new P.Segment(a[0], a[1], a[2]))); });
    let after = before;
    Aero.dialog({
      title: 'Simplify', instruction: `Reduce anchor points (currently ${before})`, fields: [{ key: 't', label: 'Tolerance', type: 'range', min: 0, max: 100, value: 25, fmt: v => v + '%' }],
      html: '<div class="dnote" id="simpInfo"></div>',
      onChange: v => run(v),
      onOK: v => { run(v); LV.commit('Simplify'); }, onCancel: () => { restore(); LV.redraw(); }
    });
    function run(v) { restore(); if (v.t > 0) ps.forEach(p => { const closed = p.closed; p.flatten(Math.max(0.25, v.t / 40)); p.simplify(v.t / 10); p.closed = closed; }); after = ps.reduce((n, p) => n + p.segments.length, 0); const el = document.getElementById('simpInfo'); if (el) el.textContent = `${before} → ${after} anchor points`; LV.redraw(); }
  };
  LV.reversePath = () => { const ps = pathSel(); if (!ps.length) return; ps.forEach(p => p.reverse()); LV.commit('Reverse Path Direction'); };
  LV.joinPaths = () => {
    const ps = pathSel().filter(p => p instanceof P.Path);
    if (ps.length === 1 && !ps[0].closed) { ps[0].closed = true; LV.commit('Join'); return; }
    const open = ps.filter(p => !p.closed); if (open.length < 2) return LV.toast('Select one open path to close, or two open paths to join');
    const [a, b] = open, ends = [[a.lastSegment, b.firstSegment, false, false], [a.lastSegment, b.lastSegment, false, true], [a.firstSegment, b.firstSegment, true, false], [a.firstSegment, b.lastSegment, true, true]];
    const best = ends.reduce((m, e) => e[0].point.getDistance(e[1].point) < m[0].point.getDistance(m[1].point) ? e : m);
    if (best[2]) a.reverse(); if (best[3]) b.reverse();
    a.join(b, 0.01); LV.setSel([a]); LV.commit('Join');
  };
  LV.makeCompound = () => {
    const ps = sorted().filter(LV.isPathItem); if (ps.length < 2) return LV.toast('Select at least 2 paths');
    const top = ps[ps.length - 1], cp = new P.CompoundPath({ insert: false, fillRule: 'evenodd' });
    cp.insertAbove(top); ps.forEach(p => cp.addChildren(p instanceof P.CompoundPath ? p.removeChildren() : [p]));
    cp.style = top.style; cp.fillRule = 'evenodd'; ps.forEach(p => { if (p instanceof P.CompoundPath) p.remove(); });
    cp.name = 'Compound Path'; LV.uidOf(cp); LV.setSel([cp]); LV.commit('Make Compound Path');
  };
  LV.releaseCompound = () => {
    const out = [];
    LV.sel.forEach(it => { if (it instanceof P.CompoundPath) { const kids = it.removeChildren(); kids.forEach(k => { k.style = it.style; LV.reUid(k); }); it.parent.insertChildren(it.index, kids); out.push(...kids); it.remove(); } else out.push(it); });
    LV.setSel(out); LV.commit('Release Compound Path');
  };
  LV.makeClip = () => {
    if (!need(2, 'Select the artwork and a clipping shape on top')) return;
    const s = sorted(), mask = s[s.length - 1];
    if (!LV.isPathItem(mask) && !LV.isTextLike(mask)) return LV.toast('The top object must be a shape or path');
    const m2 = LV.isTextLike(mask) ? LV.outlineText(mask) : mask;
    const g = new P.Group({ insert: false }); g.insertAbove(m2); g.addChild(m2); g.addChildren(s.slice(0, -1)); g.clipped = true; g.name = 'Clip Group';
    LV.uidOf(g); LV.setSel([g]); LV.commit('Make Clipping Mask');
  };
  LV.releaseClip = () => {
    const out = []; let did = false;
    LV.sel.forEach(it => { if (it instanceof P.Group && it.clipped) { it.clipped = false; const m = it.firstChild; m.clipMask = false; m.fillColor = null; m.strokeColor = null; const kids = it.removeChildren(); it.parent.insertChildren(it.index, kids); it.remove(); out.push(...kids); did = true; } else out.push(it); });
    if (!did) return LV.toast('Select a clip group');
    LV.setSel(out); LV.commit('Release Clipping Mask');
  };
  LV.createOutlines = () => {
    const out = []; let n = 0;
    LV.sel.forEach(it => { if (LV.isTextLike(it)) { out.push(LV.outlineText(it)); n++; } else { LV.outlineAll(it); out.push(it); } });
    if (!n && !out.length) return LV.toast('Select text to convert');
    LV.setSel(out); LV.commit('Create Outlines');
  };

  /* ---------- transforms ---------- */
  const refPoint = () => { const r = LV.selBounds(); const k = LV.refPt || 'center'; return k === 'center' ? r.center : r[k]; };
  LV.applyTransform = (m, copy, label, meta = {}) => {
    if (!need()) return;
    if (copy) LV.duplicateSel();
    LV.transformSel(m);
    if (meta.rot) LV.sel.forEach(it => it.data.rot = (((it.data.rot || 0) + meta.rot) % 360 + 540) % 360 - 180);
    LV.lastTransform = { m, copy, label, ...meta }; LV.commit(label + (copy ? ' (Copy)' : ''));
  };
  LV.transformAgain = () => {
    const t = LV.lastTransform; if (!t) return LV.toast('No transform to repeat');
    let m = t.m;
    if (t.rel === 'rotate') m = new P.Matrix().rotate(t.angle, LV.selBounds().center);
    else if (t.rel === 'scale') m = new P.Matrix().scale(t.sx, t.sy, LV.selBounds().center);
    LV.applyTransform(m, t.copy, 'Transform Again', t.rel === 'rotate' ? { rot: t.angle } : {});
  };
  LV.moveDialog = () => { if (!need()) return; Aero.dialog({ title: 'Move', fields: [{ key: 'x', label: 'Horizontal', type: 'number', value: 10 }, { key: 'y', label: 'Vertical', type: 'number', value: 0 }, { key: 'c', label: 'Copy', type: 'checkbox', value: false }], onOK: v => LV.applyTransform(new P.Matrix().translate(v.x, v.y), v.c, 'Move') }); };
  LV.rotateDialog = () => { if (!need()) return; Aero.dialog({ title: 'Rotate', fields: [{ key: 'a', label: 'Angle (°)', type: 'number', value: 90 }, { key: 'c', label: 'Copy', type: 'checkbox', value: false }], onOK: v => LV.applyTransform(new P.Matrix().rotate(-v.a, refPoint()), v.c, 'Rotate', { rot: -v.a, rel: 'rotate', angle: -v.a }) }); };
  LV.reflectDialog = () => {
    if (!need()) return;
    Aero.dialog({ title: 'Reflect', fields: [{ key: 'ax', label: 'Axis', type: 'select', value: 'v', options: [['v', 'Vertical (flip horizontally)'], ['h', 'Horizontal (flip vertically)'], ['a', 'Angle']] }, { key: 'a', label: 'Angle (°)', type: 'number', value: 45 }, { key: 'c', label: 'Copy', type: 'checkbox', value: false }],
      onOK: v => { const c = refPoint(); let m; if (v.ax === 'v') m = new P.Matrix().scale(-1, 1, c); else if (v.ax === 'h') m = new P.Matrix().scale(1, -1, c); else m = new P.Matrix().rotate(-v.a, c).scale(1, -1, c).rotate(v.a, c); LV.applyTransform(m, v.c, 'Reflect'); } });
  };
  LV.flip = axis => { if (!need()) return; const c = refPoint(); LV.applyTransform(axis === 'h' ? new P.Matrix().scale(-1, 1, c) : new P.Matrix().scale(1, -1, c), false, axis === 'h' ? 'Flip Horizontal' : 'Flip Vertical'); };
  LV.scaleDialog = () => {
    if (!need()) return;
    Aero.dialog({ title: 'Scale', fields: [{ key: 'u', label: 'Uniform', type: 'checkbox', value: true }, { key: 's', label: 'Scale %', type: 'number', value: 100 }, { key: 'h', label: 'Horizontal %', type: 'number', value: 100 }, { key: 'v', label: 'Vertical %', type: 'number', value: 100 }, { key: 'sw', label: 'Scale strokes', type: 'checkbox', value: false }, { key: 'c', label: 'Copy', type: 'checkbox', value: false }],
      onOK: v => {
        const sx = (v.u ? v.s : v.h) / 100, sy = (v.u ? v.s : v.v) / 100; if (!sx || !sy) return;
        if (v.sw) { const f = Math.sqrt(Math.abs(sx * sy)); LV.sel.forEach(it => LV.leaves(it).forEach(l => { if (l.strokeWidth) l.strokeWidth *= f; })); }
        LV.applyTransform(new P.Matrix().scale(sx, sy, refPoint()), v.c, 'Scale', { rel: 'scale', sx, sy });
      } });
  };
  LV.nudge = (dx, dy) => {
    if (LV.toolId === 'direct' && LV.selSegs.size) { LV.selSegs.forEach(s => s.point = s.point.add([dx, dy])); LV.commit('Nudge Anchors'); return; }
    if (!LV.sel.length) return; LV.sel.forEach(it => it.translate([dx, dy])); LV.commit('Nudge');
  };
  // numeric transform from the command bar
  LV.setGeom = (key, val) => {
    if (!LV.sel.length || !isFinite(val)) return;
    const r = LV.selBounds(), ab = LV.board(), k = LV.refPt || 'topLeft', ref = k === 'center' ? r.center : r[k];
    if (key === 'x' || key === 'y') { const d = key === 'x' ? new P.Point(val + ab.x - ref.x, 0) : new P.Point(0, val + ab.y - ref.y); LV.sel.forEach(it => it.translate(d)); LV.commit('Move'); return; }
    if (key === 'w' || key === 'h') {
      if (val <= 0) return; let sx = key === 'w' ? val / (r.width || 1) : 1, sy = key === 'h' ? val / (r.height || 1) : 1;
      if (LV.lockRatio) { if (key === 'w') sy = sx; else sx = sy; }
      LV.transformSel(new P.Matrix().scale(sx, sy, ref)); LV.commit('Scale'); return;
    }
    if (key === 'r') { const cur = LV.sel.length === 1 ? (LV.sel[0].data.rot || 0) : 0, d = -(val) - cur; LV.transformSel(new P.Matrix().rotate(d, r.center)); LV.sel.forEach(it => it.data.rot = (((it.data.rot || 0) + d) % 360 + 540) % 360 - 180); LV.commit('Rotate'); }
  };

  /* ---------- artboards ---------- */
  const presetOptions = () => [['custom', 'Custom'], ...LV.PRESETS.map((p, i) => [String(i), p[0]])];
  LV.newArtboardDialog = () => {
    const last = LV.doc.artboards[LV.doc.artboards.length - 1];
    Aero.dialog({ title: 'New Artboard', fields: [{ key: 'n', label: 'Name', type: 'text', value: 'Artboard ' + (LV.doc.artboards.length + 1) }, { key: 'p', label: 'Preset', type: 'select', value: '6', options: presetOptions() }, { key: 'w', label: 'Width', type: 'number', value: 1080 }, { key: 'h', label: 'Height', type: 'number', value: 1080 }],
      onInput: (k, v, set) => { if (k === 'p' && v.p !== 'custom') { const p = LV.PRESETS[+v.p]; set('w', p[1]); set('h', p[2]); } },
      onOK: v => { if (!(v.w > 0 && v.h > 0)) return; LV.doc.artboards.push({ id: Aero.uid(), name: v.n || 'Artboard', x: last.x + last.w + 60, y: last.y, w: v.w, h: v.h }); LV.doc.active = LV.doc.artboards.length - 1; LV.commit('New Artboard'); LV.fitBoard(); } });
  };
  LV.artboardOptions = (i = LV.doc.active) => {
    const ab = LV.doc.artboards[i];
    Aero.dialog({ title: 'Artboard Options', fields: [{ key: 'n', label: 'Name', type: 'text', value: ab.name }, { key: 'p', label: 'Preset', type: 'select', value: 'custom', options: presetOptions() }, { key: 'x', label: 'X', type: 'number', value: ab.x }, { key: 'y', label: 'Y', type: 'number', value: ab.y }, { key: 'w', label: 'Width', type: 'number', value: ab.w }, { key: 'h', label: 'Height', type: 'number', value: ab.h }],
      onInput: (k, v, set) => { if (k === 'p' && v.p !== 'custom') { const p = LV.PRESETS[+v.p]; set('w', p[1]); set('h', p[2]); } },
      onOK: v => { if (!(v.w > 0 && v.h > 0)) return; Object.assign(ab, { name: v.n || ab.name, x: v.x, y: v.y, w: v.w, h: v.h }); LV.commit('Artboard Options'); } });
  };
  LV.deleteArtboard = (i = LV.doc.active) => { if (LV.doc.artboards.length < 2) return LV.toast('A document needs at least one artboard'); LV.doc.artboards.splice(i, 1); LV.doc.active = Math.min(LV.doc.active, LV.doc.artboards.length - 1); LV.commit('Delete Artboard'); };
  LV.duplicateArtboard = (i = LV.doc.active) => {
    const ab = LV.doc.artboards[i], r = LV.boardRect(ab), dx = ab.w + 60;
    const n = { ...ab, id: Aero.uid(), name: ab.name + ' copy', x: ab.x + dx };
    LV.allObjects().filter(o => r.contains(o.bounds)).forEach(o => LV.reUid(o.clone()).translate([dx, 0]));
    LV.doc.artboards.splice(i + 1, 0, n); LV.doc.active = i + 1; LV.commit('Duplicate Artboard'); LV.fitBoard();
  };
  LV.moveArtboard = (i, dir) => { const a = LV.doc.artboards, j = i + dir; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; if (LV.doc.active === i) LV.doc.active = j; else if (LV.doc.active === j) LV.doc.active = i; LV.commit('Reorder Artboards'); };
  LV.fitArtboardToArt = () => { const r = LV.sel.length ? LV.selBounds() : (() => { let u = null; LV.allObjects().forEach(o => { if (o.visible) u = u ? u.unite(o.bounds) : o.bounds.clone(); }); return u; })(); if (!r) return; Object.assign(LV.board(), { x: LV.round(r.x), y: LV.round(r.y), w: LV.round(r.width), h: LV.round(r.height) }); LV.commit('Fit Artboard'); };

  /* ---------- layers ---------- */
  LV.newLayer = () => { const n = P.project.layers.length + 1; const L = new P.Layer({ name: 'Layer ' + n }); const cur = P.project.activeLayer; if (cur && cur !== L) L.insertAbove(cur); L.activate(); LV.uidOf(L); LV.commit('New Layer'); };
  LV.deleteLayerOrSel = () => {
    if (LV.sel.length) return LV.deleteSel();
    const L = P.project.activeLayer; if (!L || P.project.layers.length < 2) return LV.toast('Cannot delete the only layer');
    L.remove(); P.project.layers[P.project.layers.length - 1].activate(); LV.commit('Delete Layer');
  };
  LV.moveSelToLayer = () => { if (!need()) return; const L = LV.activeLayer(); sorted().forEach(it => L.addChild(it)); LV.commit('Move to Layer'); };
})();
