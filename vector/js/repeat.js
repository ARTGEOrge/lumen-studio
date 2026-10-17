'use strict';
/* Lumen Vector — Repeat objects (radial / grid / mirror), live like Illustrator's Object ▸ Repeat.
   A repeat is a group with data.kind 'repeat', data.repeat = { type, …options, sig } and applyMatrix = false
   (moving / scaling / rotating the whole repeat only changes its matrix). Children, in the group's own space:
     role 'repeatCopies' — generated copies (rebuilt when the source or the options change, checked on commit)
     role 'repeatSrc'    — the source artwork (editable with Direct Selection; on top so it stays reachable). */
(function () {
  const RP = LV.repeat = {};
  const n = (v, lo, hi, d) => { v = +v; return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
  RP.TYPES = { radial: 'Radial', grid: 'Grid', mirror: 'Mirror' };
  RP.sanitize = o => {
    o = o && typeof o === 'object' ? o : {};
    const type = RP.TYPES[o.type] ? o.type : 'radial';
    if (type === 'radial') return { type, count: Math.round(n(o.count, 2, 200, 8)), radius: n(o.radius, 0, 1e5, 100), overlap: !!o.overlap };
    if (type === 'grid') {
      let cols = Math.round(n(o.cols, 1, 100, 3)), rows = Math.round(n(o.rows, 1, 100, 3));
      while (cols * rows > 2500) { if (cols > rows) cols--; else rows--; }
      return { type, cols, rows, gx: n(o.gx, -1e5, 1e5, 10), gy: n(o.gy, -1e5, 1e5, 10), offset: ['none', 'rows', 'cols'].includes(o.offset) ? o.offset : 'none', flip: ['none', 'h', 'v', 'both'].includes(o.flip) ? o.flip : 'none' };
    }
    return { type, angle: n(o.angle, -360, 360, 90), gap: n(o.gap, -1e5, 1e5, 0) };
  };
  RP.src = g => g.children.find(c => c.data.role === 'repeatSrc') || null;
  RP.copies = g => g.children.find(c => c.data.role === 'repeatCopies') || null;
  const isRepeat = it => LV.kind(it) === 'repeat';

  /* ---------- geometry: one matrix per copy (group-local space) ---------- */
  RP.matrices = (b, o) => {
    const out = [];
    if (o.type === 'radial') {
      const c = b.center.add([0, o.radius]); // the source sits at 12 o'clock
      for (let k = 1; k < o.count; k++) out.push(new P.Matrix().rotate(360 * k / o.count, c));
    } else if (o.type === 'grid') {
      const sx = b.width + o.gx, sy = b.height + o.gy;
      for (let r = 0; r < o.rows; r++) for (let q = 0; q < o.cols; q++) {
        if (!r && !q) continue;
        let dx = q * sx, dy = r * sy;
        if (o.offset === 'rows' && r % 2) dx += sx / 2;
        if (o.offset === 'cols' && q % 2) dy += sy / 2;
        const m = new P.Matrix().translate(dx, dy);
        const fh = (o.flip === 'h' || o.flip === 'both') && q % 2, fv = (o.flip === 'v' || o.flip === 'both') && r % 2;
        if (fh || fv) m.scale(fh ? -1 : 1, fv ? -1 : 1, b.center);
        out.push(m);
      }
    } else { // mirror across an axis through a point beside the source
      const a = o.angle * Math.PI / 180, dir = new P.Point(Math.cos(a), Math.sin(a)), nrm = new P.Point(-dir.y, dir.x);
      // put the axis just outside the source, on the side its normal points to (right for a vertical axis)
      const side = nrm.x < -1e-9 || (Math.abs(nrm.x) < 1e-9 && nrm.y < 0) ? nrm.negate() : nrm;
      const ext = Math.abs(side.x) * b.width / 2 + Math.abs(side.y) * b.height / 2;
      const p = b.center.add(side.multiply(ext + o.gap / 2));
      const d2 = dir.x * dir.x - dir.y * dir.y, s2 = 2 * dir.x * dir.y; // reflection matrix [[cos2a, sin2a],[sin2a,-cos2a]]
      const R = new P.Matrix(d2, s2, s2, -d2, 0, 0);
      out.push(new P.Matrix().translate(p).append(R).translate(p.negate()));
    }
    return out;
  };
  RP.axis = (g) => { // for the overlay: radial centre / mirror axis (group-local)
    const s = RP.src(g), o = RP.sanitize(g.data.repeat); if (!s) return null; const b = s.bounds;
    if (o.type === 'radial') return { center: b.center.add([0, o.radius]), radius: o.radius };
    if (o.type === 'mirror') { const m = RP.matrices(b, o)[0], p = b.center.add(m.transform(b.center)).divide(2), a = o.angle * Math.PI / 180, dir = new P.Point(Math.cos(a), Math.sin(a)), L = Math.max(b.width, b.height) * 0.75 + 20; return { a: p.subtract(dir.multiply(L)), b: p.add(dir.multiply(L)) }; }
    return null;
  };

  const cleanCopy = it => { // copies must not share ids / text-thread links with the source
    const d = it.data || {}; delete d.uid; delete d.next; delete d.prev; delete d.role;
    (it.children || []).forEach(cleanCopy); return it;
  };
  const sigOf = (g, o) => { const s = RP.src(g); return JSON.stringify([o, s && s.exportJSON({ asString: false, precision: 3 })]); };
  RP.regen = (g, force) => {
    const s = RP.src(g); if (!s) return false;
    const o = RP.sanitize(g.data.repeat), sig = sigOf(g, o), old = RP.copies(g);
    if (!force && old && g.data.repeat && g.data.repeat.sig === sig) return false;
    if (old) old.remove();
    const cg = new P.Group({ insert: false, data: { role: 'repeatCopies' } }), b = s.bounds;
    if (b.width > 0 || b.height > 0) RP.matrices(b, o).forEach(m => {
      const c = cleanCopy(s.clone({ insert: false })); c.transform(m); cg.addChild(c);
    });
    if (o.type === 'radial' && o.overlap) { cg.insertAbove(s); } else cg.insertBelow(s);
    g.data.repeat = { ...o, sig };
    return true;
  };

  /* ---------- commands ---------- */
  const usable = it => it && it.parent && !it.locked && !LV.isoRoot?.();
  RP.make = (type, items = LV.sortZ(LV.sel)) => {
    items = items.filter(usable);
    if (!items.length) { LV.toast('Select the artwork to repeat'); return null; }
    const b = LV.selBounds(items), base = { ...(RP.last && RP.last[type] || {}), type };
    if (type === 'radial' && !(RP.last && RP.last.radial)) { base.count = 8; base.radius = Math.max(b.height * 0.5, b.width / (2 * Math.sin(Math.PI / 8)) * 1.15); }
    if (type === 'grid' && !(RP.last && RP.last.grid)) { base.cols = 3; base.rows = 3; base.gx = base.gy = Math.round(Math.max(4, Math.min(b.width, b.height) * 0.15)); }
    const o = RP.sanitize(base);
    const g = new P.Group({ insert: false }); g.applyMatrix = false; g.data = { kind: 'repeat', repeat: o }; g.name = RP.TYPES[type] + ' Repeat';
    g.insertAbove(items[items.length - 1]);
    const src = new P.Group({ insert: false, data: { role: 'repeatSrc' } }); src.name = 'Source';
    items.forEach(it => src.addChild(it));
    g.addChild(src); LV.uidOf(src); RP.regen(g, true); LV.uidOf(g);
    LV.setSel([g]); LV.commit('Repeat ' + RP.TYPES[type]); return g;
  };
  const sel = () => LV.sel.filter(isRepeat);
  RP.release = () => {
    const rs = sel(); if (!rs.length) return LV.toast('Select a repeat');
    const out = [];
    rs.forEach(g => { RP.copies(g)?.remove(); g.applyMatrix = true; const s = RP.src(g); const kids = s ? s.removeChildren() : []; g.parent.insertChildren(g.index, kids); out.push(...kids); g.remove(); });
    LV.setSel(out); LV.commit('Release Repeat');
  };
  RP.expandOne = g => {
    RP.regen(g); g.applyMatrix = true;
    g.children.slice().forEach(c => { const kids = c.removeChildren(); g.insertChildren(c.index, kids); c.remove(); });
    delete g.data.kind; delete g.data.repeat; g.name = 'Expanded Repeat'; g.children.forEach(c => LV.reUid(c)); return g;
  };
  RP.expand = () => { const rs = sel(); if (!rs.length) return LV.toast('Select a repeat'); LV.setSel(rs.map(RP.expandOne)); LV.commit('Expand Repeat'); };
  RP.setOptions = (g, part, label = 'Repeat Options') => {
    const o = RP.sanitize({ ...RP.sanitize(g.data.repeat), ...part });
    g.data.repeat = o; RP.regen(g, true); RP.last = { ...(RP.last || {}), [o.type]: o }; if (label) LV.commit(label); else LV.redraw();
  };
  RP.optionsDialog = () => {
    const g = sel()[0]; if (!g) return LV.toast('Select a repeat');
    const o = RP.sanitize(g.data.repeat), before = JSON.stringify(g.data.repeat);
    const fields = o.type === 'radial' ? [{ key: 'count', label: 'Instances', type: 'number', min: 2, max: 200, value: o.count }, { key: 'radius', label: 'Radius', type: 'number', min: 0, value: LV.round(o.radius) }, { key: 'overlap', label: 'Copies overlap the source', type: 'checkbox', value: o.overlap }]
      : o.type === 'grid' ? [{ key: 'cols', label: 'Columns', type: 'number', min: 1, max: 100, value: o.cols }, { key: 'rows', label: 'Rows', type: 'number', min: 1, max: 100, value: o.rows }, { key: 'gx', label: 'Horizontal spacing', type: 'number', value: LV.round(o.gx) }, { key: 'gy', label: 'Vertical spacing', type: 'number', value: LV.round(o.gy) }, { key: 'offset', label: 'Grid type', type: 'select', value: o.offset, options: [['none', 'Grid'], ['rows', 'Brick by row'], ['cols', 'Brick by column']] }, { key: 'flip', label: 'Flip', type: 'select', value: o.flip, options: [['none', 'None'], ['h', 'Every other column'], ['v', 'Every other row'], ['both', 'Both']] }]
        : [{ key: 'angle', label: 'Axis angle (°, 90 = vertical)', type: 'number', value: o.angle }, { key: 'gap', label: 'Gap to the axis (×2)', type: 'number', value: LV.round(o.gap) }];
    Aero.dialog({
      title: RP.TYPES[o.type] + ' Repeat Options', instruction: 'Changes preview live on the canvas.', fields,
      onChange: v => RP.setOptions(g, v, null),
      onOK: v => RP.setOptions(g, v),
      onCancel: () => { g.data.repeat = JSON.parse(before); RP.regen(g, true); LV.redraw(); }
    });
  };
  RP.regenAll = () => P.project.getItems({ match: it => it.data && it.data.kind === 'repeat' }).forEach(g => { try { RP.regen(g); } catch (e) { console.warn('repeat', e); } });

  /* ---------- canvas overlay: radial centre ring / mirror axis ---------- */
  (LV.overlays = LV.overlays || []).push(ctx => {
    const g = LV.sel.length === 1 && isRepeat(LV.sel[0]) ? LV.sel[0] : null; if (!g) return;
    const ax = RP.axis(g); if (!ax) return;
    const G = p => LV.v(g.localToGlobal(p));
    ctx.strokeStyle = 'rgba(47,122,229,.8)'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    if (ax.center) {
      const c = G(ax.center), r = G(ax.center.add([ax.radius, 0])).getDistance(c);
      ctx.beginPath(); ctx.arc(c.x, c.y, r, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(c.x, c.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else { const a = G(ax.a), b = G(ax.b); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    ctx.setLineDash([]);
  });

  /* ---------- Properties panel section ---------- */
  let secEl = null, secSig = '';
  const R = v => LV.round(v, 2), esc = Aero.esc;
  const num = (k, v, attrs = '') => `<input type="number" data-r="${k}" class="n4" value="${esc(String(v))}" ${attrs}>`;
  function section() {
    if (!secEl) {
      const host = document.getElementById('pObj'); if (!host) return;
      secEl = Aero.el('div', 'pgroup'); secEl.id = 'pRepeat'; secEl.hidden = true; host.after(secEl);
      secEl.addEventListener('change', e => {
        const g = LV.sel[0], k = e.target.dataset.r; if (!g || !isRepeat(g) || !k) return;
        const v = e.target.type === 'checkbox' ? e.target.checked : e.target.tagName === 'SELECT' ? e.target.value : parseFloat(e.target.value);
        if (typeof v === 'number' && !isFinite(v)) return;
        if (k === 'type') { const b = RP.src(g).bounds; const d = v === 'radial' ? { count: 8, radius: Math.max(b.height * 0.5, b.width / (2 * Math.sin(Math.PI / 8)) * 1.15) } : v === 'grid' ? { cols: 3, rows: 3, gx: 10, gy: 10 } : { angle: 90, gap: 0 }; g.data.repeat = RP.sanitize({ ...(RP.last && RP.last[v] || d), type: v }); g.name = RP.TYPES[v] + ' Repeat'; RP.setOptions(g, {}, 'Repeat Type'); return; }
        RP.setOptions(g, { [k]: v });
      });
      secEl.addEventListener('click', e => { const b = e.target.closest('button[data-ra]'); if (!b) return; ({ expand: RP.expand, release: RP.release, opts: RP.optionsDialog })[b.dataset.ra](); });
    }
    const g = LV.sel.length === 1 && isRepeat(LV.sel[0]) ? LV.sel[0] : null;
    secEl.hidden = !g; if (!g) { secSig = ''; secEl.innerHTML = ''; return; }
    const o = RP.sanitize(g.data.repeat), sig = JSON.stringify(o); if (sig === secSig) return; secSig = sig;
    let h = `<div class="psub">Repeat<span class="dim" style="font-weight:400;margin-left:5px">live</span><select data-r="type" style="margin-left:auto">${Object.entries(RP.TYPES).map(([k, t]) => `<option value="${k}" ${k === o.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    if (o.type === 'radial') h += `<div class="prow"><span class="lbl">Instances</span>${num('count', o.count, 'min="2" max="200"')}<span class="lbl">Radius</span>${num('radius', R(o.radius), 'min="0"')}</div><div class="prow"><label class="small"><input type="checkbox" data-r="overlap" ${o.overlap ? 'checked' : ''}>Copies overlap the source</label></div>`;
    else if (o.type === 'grid') h += `<div class="prow"><span class="lbl">Columns</span>${num('cols', o.cols, 'min="1" max="100"')}<span class="lbl">Rows</span>${num('rows', o.rows, 'min="1" max="100"')}</div>
      <div class="prow"><span class="lbl" title="Spacing between copies">Spacing</span>H ${num('gx', R(o.gx))} V ${num('gy', R(o.gy))}</div>
      <div class="prow"><span class="lbl">Type</span><select data-r="offset">${[['none', 'Grid'], ['rows', 'Brick by row'], ['cols', 'Brick by column']].map(([v, t]) => `<option value="${v}" ${v === o.offset ? 'selected' : ''}>${t}</option>`).join('')}</select><span class="lbl">Flip</span><select data-r="flip">${[['none', 'None'], ['h', 'Alt. columns'], ['v', 'Alt. rows'], ['both', 'Both']].map(([v, t]) => `<option value="${v}" ${v === o.flip ? 'selected' : ''}>${t}</option>`).join('')}</select></div>`;
    else h += `<div class="prow"><span class="lbl" title="Mirror axis angle (90 = vertical)">Axis °</span>${num('angle', R(o.angle))}<span class="lbl" title="Space between the source and its reflection">Gap</span>${num('gap', R(o.gap))}</div>`;
    h += `<div class="dim small" style="margin:2px 0 3px">Edit the source with Direct Selection (A); copies follow.</div><div class="brow wrap"><button class="aero-btn small" data-ra="expand" title="Object ▸ Repeat ▸ Expand">Expand</button><button class="aero-btn small" data-ra="release" title="Object ▸ Repeat ▸ Release">Release</button></div>`;
    secEl.innerHTML = h;
  }
  (LV.panelHooks = LV.panelHooks || []).push(section);
})();
