'use strict';
/* Lumen Vector — toolbox, command bar, Properties / Align panels, swatches, layers, artboards, history, status bar. */
(function () {
  const $ = s => document.querySelector(s), esc = Aero.esc;
  const ICON = {
    select: '<path d="M6 3l11 10-5 .8 3 6-2.2 1-3-6L6 18z" fill="currentColor"/>',
    direct: '<path d="M6 3l11 10-5 .8 3 6-2.2 1-3-6L6 18z" fill="#fff"/>',
    pen: '<path d="M12 3l5 9-2 5H9l-2-5z"/><path d="M12 3v7"/><circle cx="12" cy="11.2" r="1.2"/><path d="M9 20.5h6"/>',
    pencil: '<path d="M4 20l1.5-5L16 4.5l3.5 3.5L9 18.5z"/><path d="M14 6.5l3.5 3.5M5.5 15l3.5 3.5"/>',
    rect: '<rect x="4" y="6" width="16" height="12"/>', rounded: '<rect x="4" y="6" width="16" height="12" rx="4"/>',
    ellipse: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>', polygon: '<path d="M12 3.5l7.8 5.6-3 9.4H7.2l-3-9.4z"/>',
    star: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4l-5.3 3 1.2-6-4.5-4.1 6-.7z"/>', line: '<path d="M5 19L19 5"/>',
    type: '<path d="M5 7V4.5h14V7M12 4.5v15M9 19.5h6"/>', typepath: '<path d="M3.5 19c4-8 13-8 17 0"/><path d="M8 4h8M12 4v8"/>',
    eyedrop: '<path d="M14.5 4.5l5 5-2 2-5-5z"/><path d="M13.5 8.5L5 17v2.5h2.5L16 11"/>',
    gradient: '<defs><linearGradient id="tgr" x2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#0d2740"/></linearGradient></defs><rect x="4" y="5" width="16" height="14" rx="1.5" fill="url(#tgr)"/>',
    scissors: '<circle cx="6.5" cy="17.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/><path d="M8.3 15.8L18 4M15.7 15.8L6 4"/>',
    knife: '<path d="M4 20L17.5 6.5c1.8-1.8 3.4-.4 2.4 1L8.5 19.5z"/><path d="M4 20l3-1"/>',
    artboard: '<path d="M7 3v18M17 3v18M3 7h18M3 17h18"/>',
    shaper: '<path d="M4 19c3-9 4-12 8-14" stroke-dasharray="2 1.6"/><rect x="11" y="10" width="9" height="9"/><circle cx="7" cy="8" r="3"/>',
    width: '<path d="M3 16c4-1 5-8 9-8s5 7 9 8"/><path d="M3 18c4 0 5-4 9-4s5 4 9 4"/><path d="M12 8v6" stroke-width="1"/>',
    shapebuilder: '<circle cx="9" cy="10" r="5.5"/><rect x="10" y="9" width="10" height="10"/><path d="M4 21l5-5" stroke-width="2.2"/><path d="M11.5 13.5h3"/>',
    blend: '<rect x="2.5" y="13" width="7" height="7" rx="1"/><circle cx="17.5" cy="6.5" r="4"/><path d="M8 12l2-2M11 9l2-2" stroke-dasharray="1.5 1.5"/>',
    hand: '<path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11V4.5a1.5 1.5 0 0 1 3 0V11V6a1.5 1.5 0 0 1 3 0v8c0 3.5-2.5 6-6 6-2.6 0-4.2-1.3-5.6-3.4L4.7 13.4a1.4 1.4 0 0 1 2.3-1.6z"/>',
    zoom: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5M8 10.5h5M10.5 8v5"/>'
  };
  const TOOLS = [
    { id: 'select', title: 'Selection', key: 'V' }, { id: 'direct', title: 'Direct Selection', key: 'A' }, null,
    { id: 'pen', title: 'Pen', key: 'P' }, { id: 'pencil', title: 'Pencil', key: 'N' }, { id: 'shaper', title: 'Shaper', key: 'Shift+N' }, { id: 'type', title: 'Type', key: 'T' }, { id: 'typepath', title: 'Type on a Path', key: 'Shift+T' }, null,
    { id: 'rect', title: 'Rectangle', key: 'M' }, { id: 'rounded', title: 'Rounded Rectangle' }, { id: 'ellipse', title: 'Ellipse', key: 'L' }, { id: 'polygon', title: 'Polygon' }, { id: 'star', title: 'Star' }, { id: 'line', title: 'Line Segment', key: '\\' }, null,
    { id: 'eyedrop', title: 'Eyedropper', key: 'I' }, { id: 'gradient', title: 'Gradient', key: 'G' }, { id: 'blend', title: 'Blend', key: 'W' }, { id: 'shapebuilder', title: 'Shape Builder', key: 'Shift+M' }, { id: 'width', title: 'Width', key: 'Shift+W' }, { id: 'scissors', title: 'Scissors', key: 'C' }, { id: 'knife', title: 'Knife' }, { id: 'artboard', title: 'Artboard', key: 'Shift+O' }, null,
    { id: 'hand', title: 'Hand', key: 'H' }, { id: 'zoom', title: 'Zoom', key: 'Z' }
  ];
  LV.status = msg => { $('#stMsg').textContent = msg || ''; };
  LV.toast = m => Aero.toast(m);

  /* ---------------- toolbox ---------------- */
  let tb;
  LV.initToolbox = () => {
    tb = Aero.toolbox($('#tools'), TOOLS.map(t => t && { ...t, icon: ICON[t.id] }), id => LV.setToolImpl(id));
    LV.setTool = id => tb.set(id);
    const pw = Aero.el('div', 'lv-paint', `<div class="pw-box"><div class="pw-stroke" title="Stroke (X toggles, double-click to pick)"><i></i></div><div class="pw-fill" title="Fill (X toggles, double-click to pick)"><i></i></div></div>
      <div class="pw-row"><span class="pw-b" data-a="swap" title="Swap fill and stroke (Shift+X)">⇄</span><span class="pw-b" data-a="def" title="Default fill and stroke (D)">◩</span></div>
      <div class="pw-row"><span class="pw-b" data-a="color" title="Color (,)"><svg viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="#0d2740"/></svg></span><span class="pw-b" data-a="grad" title="Gradient (.)"><svg viewBox="0 0 10 10"><defs><linearGradient id="pwg"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#0d2740"/></linearGradient></defs><rect x="1" y="1" width="8" height="8" fill="url(#pwg)" stroke="#0d2740" stroke-width=".6"/></svg></span><span class="pw-b" data-a="none" title="None (/)"><svg viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" fill="#fff" stroke="#0d2740" stroke-width=".6"/><path d="M1.5 8.5l7-7" stroke="#e0261b" stroke-width="1.3"/></svg></span></div>`);
    $('#tools').appendChild(pw);
    pw.querySelector('.pw-fill').onclick = () => { LV.paint.active = 'fill'; LV.refreshPanels(); };
    pw.querySelector('.pw-stroke').onclick = () => { LV.paint.active = 'stroke'; LV.refreshPanels(); };
    pw.querySelector('.pw-fill').ondblclick = () => pickColor('fill');
    pw.querySelector('.pw-stroke').ondblclick = () => pickColor('stroke');
    pw.querySelectorAll('.pw-b').forEach(b => b.onclick = () => LV.paintAction(b.dataset.a));
  };
  LV.paintAction = a => {
    const attr = LV.paint.active, cur = curSpec(attr);
    if (a === 'swap') return LV.swapFillStroke();
    if (a === 'def') { if (LV.sel.length) { LV.sel.forEach(it => { LV.setPaint(it, 'fill', '#ffffff'); LV.setPaint(it, 'stroke', '#000000'); LV.setStyle(it, 'strokeWidth', 1); }); LV.commit('Default Fill & Stroke'); } else Object.assign(LV.paint, { fill: '#ffffff', stroke: '#000000', strokeWidth: 1 }); LV.refreshPanels(); return; }
    if (a === 'none') return LV.applyPaintToSelection(attr, null, 'None');
    if (a === 'color') return LV.applyPaintToSelection(attr, LV.isGrad(cur) ? cur.stops[0][0] : cur || '#000000', 'Color');
    if (a === 'grad') return LV.applyPaintToSelection(attr, LV.isGrad(cur) ? cur : { type: 'linear', angle: 0, stops: [[cur || '#ffffff', 0], ['#000000', 1]] }, 'Gradient');
  };
  LV.swapFillStroke = () => {
    if (LV.sel.length) { LV.sel.forEach(it => LV.paintTargets(it).forEach(t => { const f = t.fillColor, s = t.strokeColor; t.fillColor = s; t.strokeColor = f; if (f && !t.strokeWidth) t.strokeWidth = 1; })); LV.commit('Swap Fill & Stroke'); }
    else { const f = LV.paint.fill; LV.paint.fill = LV.paint.stroke; LV.paint.stroke = f; }
    LV.refreshPanels();
  };
  function pickColor(attr) {
    const inp = $('#colorPick'), cur = curSpec(attr);
    inp.value = cur && !LV.isGrad(cur) ? LV.hex(cur) : '#000000';
    inp.oninput = () => LV.applyPaintToSelection(attr, inp.value, null);
    inp.onchange = () => LV.applyPaintToSelection(attr, inp.value, 'Color');
    inp.click();
  }

  /* ---------------- paint helpers ---------------- */
  const curSpec = attr => { const t = LV.sel.length ? LV.firstPaintable(LV.sel[0]) : null; return t ? LV.colorToSpec(t[attr + 'Color']) : LV.paint[attr]; };
  LV.curSpec = curSpec;
  // apply spec to selection; label=null applies without a history entry (live preview)
  LV.applyPaintToSelection = (attr, spec, label) => {
    if (LV.sel.length) { LV.sel.forEach(it => LV.setPaint(it, attr, spec)); if (label) LV.commit(label); else LV.redraw(); }
    else LV.paint[attr] = spec;
    refreshPaint();
  };
  const setStops = (attr, stops, commit) => {
    if (LV.sel.length) {
      LV.sel.forEach(it => LV.paintTargets(it).forEach(t => { const c = t[attr + 'Color']; if (c && c.type === 'gradient') t[attr + 'Color'] = new P.Color({ gradient: { stops: stops.map(s => new P.GradientStop(new P.Color(s[0]), s[1])), radial: c.gradient.radial }, origin: c.origin, destination: c.destination }); }));
      if (commit) LV.commit('Edit Gradient'); else LV.redraw();
    } else if (LV.isGrad(LV.paint[attr])) LV.paint[attr].stops = stops;
    refreshPaint();
  };
  const cssBg = spec => !spec ? '' : LV.isGrad(spec) ? `${spec.type === 'radial' ? 'radial-gradient(circle,' : `linear-gradient(${90 + (spec.angle || 0)}deg,`}${spec.stops.map(s => `${s[0]} ${Math.round(s[1] * 100)}%`).join(',')})` : spec;
  LV.cssBg = cssBg;
  const swatchHTML = spec => spec ? `<i style="background:${esc(cssBg(spec))}"></i>` : '<i class="none"></i>';

  /* ---------------- Properties panel ---------------- */
  const btn3 = (k, opts) => `<span class="seg" data-k="${k}">${opts.map(([v, t, ic]) => `<button class="aero-iconbtn" data-v="${v}" title="${t}">${ic}</button>`).join('')}</span>`;
  const capIc = { butt: '<svg viewBox="0 0 16 16"><path d="M8 2v12" stroke="#0d2740" stroke-width="5"/><path d="M8 0v16" stroke="#e0261b" stroke-width=".8"/></svg>', round: '<svg viewBox="0 0 16 16"><path d="M8 4.5v7" stroke="#0d2740" stroke-width="5" stroke-linecap="round"/></svg>', square: '<svg viewBox="0 0 16 16"><path d="M8 4.5v7" stroke="#0d2740" stroke-width="5" stroke-linecap="square"/></svg>' };
  const joinIc = { miter: '<svg viewBox="0 0 16 16"><path d="M3 14V3h11" fill="none" stroke="#0d2740" stroke-width="4" stroke-linejoin="miter"/></svg>', round: '<svg viewBox="0 0 16 16"><path d="M3 14V3h11" fill="none" stroke="#0d2740" stroke-width="4" stroke-linejoin="round"/></svg>', bevel: '<svg viewBox="0 0 16 16"><path d="M3 14V3h11" fill="none" stroke="#0d2740" stroke-width="4" stroke-linejoin="bevel"/></svg>' };
  const alignIc = { center: '<svg viewBox="0 0 16 16"><rect x="3" y="3" width="10" height="10" fill="#cfe2f5" stroke="#0d2740" stroke-width="2.4"/></svg>', inside: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" fill="#cfe2f5" stroke="#9aaabb" stroke-width=".8"/><rect x="3.5" y="3.5" width="9" height="9" fill="none" stroke="#0d2740" stroke-width="2.6"/></svg>', outside: '<svg viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" fill="none" stroke="#0d2740" stroke-width="2.6"/><rect x="3" y="3" width="10" height="10" fill="#cfe2f5" stroke="#9aaabb" stroke-width=".8"/></svg>' };
  const tAlignIc = a => `<svg viewBox="0 0 16 16"><path d="${{ left: 'M2 3h12M2 6.5h8M2 10h12M2 13.5h7', center: 'M2 3h12M4 6.5h8M2 10h12M4.5 13.5h7', right: 'M2 3h12M6 6.5h8M2 10h12M7 13.5h7' }[a]}" stroke="#0d2740" stroke-width="1.5"/></svg>`;
  const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
  const paintRow = attr => `
    <div class="prow"><span class="pchip ${attr}" data-attr="${attr}" title="Make ${attr} active">${''}</span><b>${attr === 'fill' ? 'Fill' : 'Stroke'}</b>
      <select data-k="${attr}Type"><option value="none">None</option><option value="solid">Color</option><option value="linear">Linear</option><option value="radial">Radial</option></select>
      <input type="color" data-k="${attr}Color"><input type="text" data-k="${attr}Hex" class="hex" spellcheck="false"></div>
    <div class="gedit" data-attr="${attr}" hidden>
      <div class="gstrip"><div class="gbar"></div><div class="gstops"></div></div>
      <div class="prow small"><span>Stop</span><input type="color" data-k="${attr}StopColor"><span>Opacity</span><input type="number" min="0" max="100" data-k="${attr}StopAlpha" class="n3">%<span>At</span><input type="number" min="0" max="100" data-k="${attr}StopPos" class="n3">%</div>
      <div class="prow small"><span>Angle</span><input type="number" data-k="${attr}Angle" class="n3">°<button class="aero-btn small" data-act="${attr}Reverse">Reverse</button><button class="aero-btn small" data-act="${attr}DelStop" title="Delete selected stop">Delete stop</button></div>
    </div>`;
  LV.initProps = () => {
    const el = $('#pProps');
    el.innerHTML = `
      <div class="pkind" id="pKind"></div>
      <div class="pgroup" id="pShape" hidden></div>
      ${paintRow('fill')}
      ${paintRow('stroke')}
      <div class="pgroup" id="pStroke">
        <div class="prow"><span class="lbl">Weight</span><input type="number" min="0" step="0.5" data-k="strokeWidth" class="n4"><span class="lbl">Cap</span>${btn3('strokeCap', [['butt', 'Butt cap', capIc.butt], ['round', 'Round cap', capIc.round], ['square', 'Projecting cap', capIc.square]])}</div>
        <div class="prow"><span class="lbl">Corner</span>${btn3('strokeJoin', [['miter', 'Miter join', joinIc.miter], ['round', 'Round join', joinIc.round], ['bevel', 'Bevel join', joinIc.bevel]])}<span class="lbl">Align</span>${btn3('strokeAlign', [['center', 'Align stroke to center', alignIc.center], ['inside', 'Align stroke to inside', alignIc.inside], ['outside', 'Align stroke to outside', alignIc.outside]])}</div>
        <div class="prow"><span class="lbl" title="Variable width profile (Width tool, Shift+W)">Profile</span><select data-k="wprofile" style="flex:1"><option value="custom" hidden>Custom (Width tool)</option>${Object.entries(LV.width.PROFILES).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('')}</select></div>
        <div class="prow"><label class="lbl"><input type="checkbox" data-k="dashed"> Dash</label><input type="number" min="0" data-k="dash1" class="n3" title="Dash length"><input type="number" min="0" data-k="gap1" class="n3" title="Gap length"><input type="number" min="0" data-k="dash2" class="n3" title="Optional second dash"></div>
      </div>
      <div class="prow"><span class="lbl">Opacity</span><input type="range" min="0" max="100" data-k="opacity"><span data-v="opacity" class="dim n3"></span></div>
      <div class="prow"><span class="lbl">Blending</span><select data-k="blendMode">${BLENDS.map(b => `<option value="${b}">${b.replace(/(^|-)(\w)/g, (m, a, c) => (a ? ' ' : '') + c.toUpperCase())}</option>`).join('')}</select></div>
      <div class="pgroup" id="pAppear" hidden></div>
      <div class="pgroup" id="pObj" hidden></div>
      <div class="pgroup" id="pTrace" hidden></div>
      <div class="pgroup" id="pChar">
        <div class="psub">Character</div>
        <div class="prow"><select data-k="family" style="flex:1">${LV.FONTS.map(f => `<option>${esc(f.family)}</option>`).join('')}</select><select data-k="weight"></select></div>
        <div class="prow"><span class="lbl" title="Font size">Size</span><input type="number" min="1" data-k="size" class="n4"><span title="Leading">Lead</span><input type="number" min="1" data-k="leading" class="n4"><span title="Tracking (1/1000 em)">Track</span><input type="number" step="10" data-k="tracking" class="n4"></div>
        <div class="prow"><span class="lbl">Align</span>${btn3('align', [['left', 'Align left', tAlignIc('left')], ['center', 'Align center', tAlignIc('center')], ['right', 'Align right', tAlignIc('right')]])}<button class="aero-btn small" data-act="outlines" title="Create Outlines (Ctrl+Shift+O)">Create Outlines</button></div>
      </div>
      <div class="pgroup" id="pInfo"></div>`;
    el.addEventListener('click', e => {
      const chip = e.target.closest('.pchip'); if (chip) { LV.paint.active = chip.dataset.attr; refreshPaint(); return; }
      const b = e.target.closest('.seg button'); if (b) { const k = b.parentNode.dataset.k; setProp(k, b.dataset.v, true); return; }
      const a = e.target.closest('[data-act]'); if (a) act(a.dataset.act);
    });
    el.addEventListener('input', e => { const k = e.target.dataset.k; if (k) setProp(k, val(e.target), false); });
    el.addEventListener('change', e => { const k = e.target.dataset.k; if (k) setProp(k, val(e.target), true); });
    const strip = s => el.querySelector(`.gedit[data-attr=${s}] .gstrip`);
    ['fill', 'stroke'].forEach(attr => {
      const st = strip(attr);
      st.addEventListener('pointerdown', e => {
        const spec = curSpec(attr); if (!LV.isGrad(spec)) return;
        const r = st.getBoundingClientRect(), pos = x => Aero.clamp((x - r.left - 6) / (r.width - 12), 0, 1);
        let i = +(e.target.closest('.gstop')?.dataset.i ?? -1);
        const stops = spec.stops.map(s => s.slice());
        if (i < 0) { // add a stop at the clicked position
          const p = pos(e.clientX), sorted = stops.slice().sort((a, b) => a[1] - b[1]);
          const nx = sorted.find(s => s[1] >= p) || sorted[sorted.length - 1]; stops.push([nx[0], LV.round(p, 3)]); i = stops.length - 1; setStops(attr, stops, true);
        }
        gSel[attr] = i; refreshPaint();
        st.setPointerCapture(e.pointerId);
        const mv = ev => { stops[i][1] = LV.round(pos(ev.clientX), 3); setStops(attr, stops, false); };
        const up = () => { st.removeEventListener('pointermove', mv); st.removeEventListener('pointerup', up); setStops(attr, stops, true); };
        st.addEventListener('pointermove', mv); st.addEventListener('pointerup', up);
      });
    });
  };
  const gSel = { fill: 0, stroke: 0 };
  const val = inp => inp.type === 'checkbox' ? inp.checked : inp.type === 'number' || inp.type === 'range' ? parseFloat(inp.value) : inp.value;
  function act(a) {
    const attr = a.startsWith('fill') ? 'fill' : 'stroke', spec = curSpec(attr);
    if (a.endsWith('Reverse') && LV.isGrad(spec)) setStops(attr, spec.stops.map(s => [s[0], LV.round(1 - s[1], 4)]), true);
    else if (a.endsWith('DelStop') && LV.isGrad(spec) && spec.stops.length > 2) { const st = spec.stops.slice(); st.splice(gSel[attr], 1); gSel[attr] = 0; setStops(attr, st, true); }
    else if (a === 'outlines') LV.createOutlines();
  }
  function setProp(k, v, commit) {
    const label = commit ? 'Change ' + k.replace(/([A-Z])/g, ' $1').toLowerCase() : null;
    const m = /^(fill|stroke)(Type|Color|Hex|StopColor|StopAlpha|StopPos|Angle)$/.exec(k);
    if (m) {
      const attr = m[1], what = m[2], spec = curSpec(attr);
      if (what === 'Type') {
        let ns = null; const base = LV.isGrad(spec) ? spec.stops[0][0] : spec || (attr === 'fill' ? '#ffffff' : '#000000');
        if (v === 'solid') ns = base; else if (v === 'linear' || v === 'radial') ns = LV.isGrad(spec) ? { ...spec, type: v } : { type: v, angle: 0, stops: [[base, 0], [base === '#000000' ? '#ffffff' : '#000000', 1]] };
        return LV.applyPaintToSelection(attr, ns, 'Fill/Stroke Type');
      }
      if (what === 'Color' || what === 'Hex') {
        if (what === 'Hex' && !/^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v.trim())) return;
        const c = what === 'Hex' ? (v.trim()[0] === '#' ? v.trim() : '#' + v.trim()) : v;
        if (LV.isGrad(spec)) { const st = spec.stops.map(s => s.slice()); st[gSel[attr]] = [c, st[gSel[attr]][1]]; return setStops(attr, st, commit); }
        return LV.applyPaintToSelection(attr, c, commit ? 'Color' : null);
      }
      if (!LV.isGrad(spec)) return;
      const st = spec.stops.map(s => s.slice()), i = Math.min(gSel[attr], st.length - 1);
      if (what === 'StopColor') { const a = new P.Color(st[i][0]).alpha, c = new P.Color(v); c.alpha = a; st[i][0] = LV.css(c); return setStops(attr, st, commit); }
      if (what === 'StopAlpha') { const c = new P.Color(st[i][0]); c.alpha = Aero.clamp(v / 100, 0, 1); st[i][0] = LV.css(c); return setStops(attr, st, commit); }
      if (what === 'StopPos') { st[i][1] = Aero.clamp(v / 100, 0, 1); return setStops(attr, st, commit); }
      if (what === 'Angle' && commit) return LV.applyPaintToSelection(attr, { ...spec, angle: v }, 'Gradient Angle');
      return;
    }
    if (['family', 'weight', 'size', 'leading', 'tracking', 'align'].includes(k)) {
      if (!isFinite(v) && ['size', 'leading', 'tracking'].includes(k)) return;
      const part = { [k]: k === 'weight' ? +v : v };
      const targets = LV.sel.filter(LV.isTextLike);
      if (targets.length) { targets.forEach(t => LV.setTextStyle(t, part)); if (LV.textEditing) LV.layoutTextEditor(); if (commit) LV.commit('Character'); else LV.redraw(); }
      if (!targets.length || commit) { Object.assign(LV.text, part); if (k === 'family') LV.text.weight = LV.nearestWeight(v, LV.text.weight); if (k === 'leading' && targets[0]) LV.text.leading = LV.textStyleOf(targets[0]).leading / LV.textStyleOf(targets[0]).size; else if (k === 'leading') LV.text.leading = v / LV.text.size; }
      if (k === 'family' || k === 'align') LV.refreshPanels();
      return;
    }
    if (k === 'wprofile') { if (commit && LV.sel.length) LV.width.applyProfile(LV.sel, v); return; }
    if (!LV.sel.length) { if (k === 'strokeWidth') LV.paint.strokeWidth = v; return; }
    if (k === 'opacity') { LV.sel.forEach(it => it.opacity = v / 100); const o = $('[data-v=opacity]'); if (o) o.textContent = v + '%'; }
    else if (k === 'blendMode') LV.sel.forEach(it => it.blendMode = v);
    else if (k === 'strokeWidth') { if (!(v >= 0)) return; LV.sel.forEach(it => LV.setStyle(it, 'strokeWidth', v)); }
    else if (k === 'strokeCap' || k === 'strokeJoin' || k === 'strokeAlign') LV.sel.forEach(it => LV.setStyle(it, k, v));
    else if (['dashed', 'dash1', 'gap1', 'dash2'].includes(k)) {
      const q = n => parseFloat($(`#pProps [data-k=${n}]`).value) || 0, on = $('#pProps [data-k=dashed]').checked;
      let arr = on ? [q('dash1') || 6, q('gap1') || q('dash1') || 4] : []; if (on && q('dash2')) arr.push(q('dash2'), q('gap1') || 4);
      LV.sel.forEach(it => LV.setStyle(it, 'dashArray', arr));
    } else return;
    if (commit) LV.commit(label); else LV.redraw();
    if (['strokeCap', 'strokeJoin', 'strokeAlign', 'dashed'].includes(k)) refreshPaint();
  }

  function refreshPaint() {
    const el = $('#pProps'); if (!el || !el.firstChild) return;
    const n = LV.sel.length, first = n ? LV.sel[0] : null, t = first ? LV.firstPaintable(first) : null;
    const kindName = { path: 'Path', compound: 'Compound Path', group: 'Group', clip: 'Clip Group', text: 'Point Type', areatext: 'Area Type', pathtext: 'Type on a Path', image: 'Image', trace: 'Image Tracing', symbol: 'Symbol Instance', blend: 'Blend', repeat: 'Repeat', warp: 'Envelope Warp' };
    $('#pKind').innerHTML = n ? (n === 1 ? `<b>${esc(kindName[LV.kind(first)] || 'Object')}</b> <span class="dim">${esc(first.name || '')}</span>` : `<b>${n} objects</b>`) : '<b>No selection</b> <span class="dim">— defaults for new objects</span>';
    ['fill', 'stroke'].forEach(attr => {
      const spec = curSpec(attr), q = k => el.querySelector(`[data-k=${attr}${k}]`);
      el.querySelector(`.pchip.${attr}`).innerHTML = swatchHTML(spec);
      el.querySelector(`.pchip.${attr}`).classList.toggle('on', LV.paint.active === attr);
      q('Type').value = !spec ? 'none' : LV.isGrad(spec) ? spec.type : 'solid';
      const g = el.querySelector(`.gedit[data-attr=${attr}]`); g.hidden = !LV.isGrad(spec);
      if (LV.isGrad(spec)) {
        const i = Math.min(gSel[attr], spec.stops.length - 1); gSel[attr] = i;
        const sc = new P.Color(spec.stops[i][0]);
        q('Color').value = sc.toCSS(true); q('Hex').value = sc.toCSS(true);
        if (document.activeElement !== q('StopColor')) q('StopColor').value = sc.toCSS(true);
        if (document.activeElement !== q('StopAlpha')) q('StopAlpha').value = Math.round(sc.alpha * 100);
        if (document.activeElement !== q('StopPos')) q('StopPos').value = Math.round(spec.stops[i][1] * 100);
        if (document.activeElement !== q('Angle')) q('Angle').value = LV.round(spec.angle || 0, 1);
        q('Angle').disabled = spec.type === 'radial';
        g.querySelector('.gbar').style.background = `linear-gradient(90deg,${spec.stops.slice().sort((a, b) => a[1] - b[1]).map(s => `${s[0]} ${s[1] * 100}%`).join(',')})`;
        g.querySelector('.gstops').innerHTML = spec.stops.map((s, j) => `<span class="gstop${j === i ? ' sel' : ''}" data-i="${j}" style="left:${s[1] * 100}%;--c:${esc(s[0])}"></span>`).join('');
      } else {
        const hx = spec ? LV.hex(spec) : '';
        if (document.activeElement !== q('Color')) q('Color').value = hx || '#000000';
        if (document.activeElement !== q('Hex')) q('Hex').value = hx;
      }
      q('Color').disabled = !spec; q('Hex').disabled = !spec;
    });
    // stroke details
    const S = t || {}, sw = n ? (t ? t.strokeWidth : 0) : LV.paint.strokeWidth;
    const swi = el.querySelector('[data-k=strokeWidth]'); if (document.activeElement !== swi) swi.value = LV.round(sw || 0, 2);
    const segOn = (k, v) => el.querySelectorAll(`.seg[data-k=${k}] button`).forEach(b => b.classList.toggle('on', b.dataset.v === v));
    segOn('strokeCap', S.strokeCap || 'butt'); segOn('strokeJoin', S.strokeJoin || 'miter'); segOn('strokeAlign', (t && t.data.strokeAlign) || 'center');
    const wp = el.querySelector('[data-k=wprofile]'); if (wp && document.activeElement !== wp) { wp.value = t ? LV.width.profileOf(t) : 'uniform'; wp.disabled = !(t instanceof P.Path); }
    const da = (t && t.dashArray) || [];
    el.querySelector('[data-k=dashed]').checked = da.length > 0;
    ['dash1', 'gap1', 'dash2'].forEach((k, i) => { const inp = el.querySelector(`[data-k=${k}]`); if (document.activeElement !== inp) inp.value = da[i] != null ? da[i] : ''; });
    const op = el.querySelector('[data-k=opacity]'), opv = Math.round((first ? first.opacity : 1) * 100);
    if (document.activeElement !== op) op.value = opv; el.querySelector('[data-v=opacity]').textContent = opv + '%';
    el.querySelector('[data-k=opacity]').disabled = !n; el.querySelector('[data-k=blendMode]').disabled = !n;
    el.querySelector('[data-k=blendMode]').value = first ? first.blendMode : 'normal';
    // character
    const txt = LV.sel.find(LV.isTextLike), showChar = !!txt || ['type', 'typepath'].includes(LV.toolId);
    $('#pChar').hidden = !showChar;
    if (showChar) {
      const s = txt ? LV.textStyleOf(txt) : { ...LV.text, leading: LV.text.size * LV.text.leading };
      const fam = el.querySelector('[data-k=family]'), w = el.querySelector('[data-k=weight]'), fi = LV.fontInfo(s.family) || LV.FONTS[0];
      fam.value = fi.family; w.innerHTML = fi.weights.map(x => `<option value="${x}">${{ 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' }[x]}</option>`).join(''); w.value = LV.nearestWeight(fi.family, s.weight);
      for (const k of ['size', 'leading', 'tracking']) { const inp = el.querySelector(`[data-k=${k}]`); if (document.activeElement !== inp) inp.value = LV.round(s[k], 2); }
      el.querySelector('[data-k=leading]').disabled = txt && LV.kind(txt) === 'pathtext';
      segOn('align', s.align);
      el.querySelector('[data-act=outlines]').disabled = !txt;
    }
    // info
    const info = $('#pInfo');
    if (n === 1 && LV.isPathItem(first)) {
      const segs = LV.pathsOf([first]).reduce((a, p) => a + p.segments.length, 0);
      info.innerHTML = `<span class="dim">${segs} anchor points · ${first instanceof P.Path ? (first.closed ? 'closed' : 'open') : first.children.length + ' sub-paths'} · area ${LV.fmt(Math.abs(first.area || 0))}</span>`;
    } else if (n === 1 && LV.kind(first) === 'image') info.innerHTML = `<span class="dim">Image ${first.width} × ${first.height} px</span>`;
    else info.innerHTML = '';
    // toolbox paint widget
    const pw = document.querySelector('.lv-paint'); if (pw) {
      pw.querySelector('.pw-fill i').style.background = cssBg(curSpec('fill')) || ''; pw.querySelector('.pw-fill').classList.toggle('none', !curSpec('fill'));
      pw.querySelector('.pw-stroke i').style.background = cssBg(curSpec('stroke')) || ''; pw.querySelector('.pw-stroke').classList.toggle('none', !curSpec('stroke'));
      pw.classList.toggle('stroke-active', LV.paint.active === 'stroke');
    }
  }
  LV.refreshPaint = refreshPaint;

  /* ---------------- Align & Pathfinder panel ---------------- */
  const aIc = {
    left: '<path d="M2 1v14" stroke="#0d2740"/><rect x="3" y="3" width="9" height="4" fill="#4a90d9"/><rect x="3" y="9" width="5" height="4" fill="#4a90d9"/>',
    hcenter: '<path d="M8 1v14" stroke="#0d2740"/><rect x="3" y="3" width="10" height="4" fill="#4a90d9"/><rect x="5" y="9" width="6" height="4" fill="#4a90d9"/>',
    right: '<path d="M14 1v14" stroke="#0d2740"/><rect x="4" y="3" width="9" height="4" fill="#4a90d9"/><rect x="8" y="9" width="5" height="4" fill="#4a90d9"/>',
    top: '<path d="M1 2h14" stroke="#0d2740"/><rect x="3" y="3" width="4" height="9" fill="#4a90d9"/><rect x="9" y="3" width="4" height="5" fill="#4a90d9"/>',
    vcenter: '<path d="M1 8h14" stroke="#0d2740"/><rect x="3" y="3" width="4" height="10" fill="#4a90d9"/><rect x="9" y="5" width="4" height="6" fill="#4a90d9"/>',
    bottom: '<path d="M1 14h14" stroke="#0d2740"/><rect x="3" y="4" width="4" height="9" fill="#4a90d9"/><rect x="9" y="8" width="4" height="5" fill="#4a90d9"/>',
    hdist: '<rect x="1" y="4" width="3" height="8" fill="#4a90d9"/><rect x="6.5" y="4" width="3" height="8" fill="#4a90d9"/><rect x="12" y="4" width="3" height="8" fill="#4a90d9"/><path d="M2.5 2v12M8 2v12M13.5 2v12" stroke="#0d2740" stroke-width=".8"/>',
    vdist: '<rect x="4" y="1" width="8" height="3" fill="#4a90d9"/><rect x="4" y="6.5" width="8" height="3" fill="#4a90d9"/><rect x="4" y="12" width="8" height="3" fill="#4a90d9"/><path d="M2 2.5h12M2 8h12M2 13.5h12" stroke="#0d2740" stroke-width=".8"/>',
    hspace: '<rect x="1" y="4" width="3" height="8" fill="#4a90d9"/><rect x="6.5" y="4" width="3" height="8" fill="#4a90d9"/><rect x="12" y="4" width="3" height="8" fill="#4a90d9"/><path d="M4.5 8h1.5M10 8h1.5" stroke="#e0261b"/>',
    vspace: '<rect x="4" y="1" width="8" height="3" fill="#4a90d9"/><rect x="4" y="6.5" width="8" height="3" fill="#4a90d9"/><rect x="4" y="12" width="8" height="3" fill="#4a90d9"/><path d="M8 4.5v1.5M8 10v1.5" stroke="#e0261b"/>'
  };
  const pfIc = op => {
    const a = '<rect x="1.5" y="1.5" width="8.5" height="8.5"/>', b = '<rect x="6" y="6" width="8.5" height="8.5"/>';
    const clipA = '<clipPath id="pa"><rect x="1.5" y="1.5" width="8.5" height="8.5"/></clipPath>';
    switch (op) {
      case 'unite': return `<g fill="#4a90d9" stroke="#0d2740" stroke-width=".8"><path d="M1.5 1.5h8.5V6h4.5v8.5H6V10H1.5z"/></g>`;
      case 'subtract': return `<path d="M1.5 1.5h8.5V6H6v4H1.5z" fill="#4a90d9" stroke="#0d2740" stroke-width=".8"/><g fill="none" stroke="#7a8a9a" stroke-width=".6" stroke-dasharray="1 1">${b}</g>`;
      case 'intersect': return `<g fill="none" stroke="#7a8a9a" stroke-width=".6" stroke-dasharray="1 1">${a}${b}</g><rect x="6" y="6" width="4" height="4" fill="#4a90d9" stroke="#0d2740" stroke-width=".8"/>`;
      case 'exclude': return `<path d="M1.5 1.5h8.5V6H6v4H1.5zM10 6h4.5v8.5H6V10h4z" fill="#4a90d9" stroke="#0d2740" stroke-width=".8"/>`;
      case 'divide': return `<g stroke="#0d2740" stroke-width=".8"><path d="M1.5 1.5h8.5V6H6v4H1.5z" fill="#4a90d9"/><rect x="6" y="6" width="4" height="4" fill="#9cc6ee"/><path d="M10 6h4.5v8.5H6V10h4z" fill="#2d6db3"/></g>`;
    }
  };
  const ibtn = (act, title, svg, label) => `<button class="aero-iconbtn big" data-act="${act}" title="${title}"><svg viewBox="0 0 16 16">${svg}</svg>${label ? `<span>${label}</span>` : ''}</button>`;
  LV.initAlign = () => {
    const el = $('#pAlign');
    el.innerHTML = `
      <div class="psub">Align Objects <select id="alignTo" style="margin-left:auto"><option value="selection">Align to selection</option><option value="artboard">Align to artboard</option></select></div>
      <div class="brow">${ibtn('a:left', 'Horizontal align left', aIc.left)}${ibtn('a:hcenter', 'Horizontal align center', aIc.hcenter)}${ibtn('a:right', 'Horizontal align right', aIc.right)}<span class="gap"></span>${ibtn('a:top', 'Vertical align top', aIc.top)}${ibtn('a:vcenter', 'Vertical align center', aIc.vcenter)}${ibtn('a:bottom', 'Vertical align bottom', aIc.bottom)}</div>
      <div class="psub">Distribute</div>
      <div class="brow">${ibtn('d:hcenter', 'Distribute horizontal centers', aIc.hdist)}${ibtn('d:vcenter', 'Distribute vertical centers', aIc.vdist)}<span class="gap"></span>${ibtn('d:hspace', 'Distribute horizontal spacing', aIc.hspace)}${ibtn('d:vspace', 'Distribute vertical spacing', aIc.vspace)}</div>
      <div class="psub">Pathfinder</div>
      <div class="brow">${ibtn('p:unite', 'Unite', pfIc('unite'))}${ibtn('p:subtract', 'Minus Front', pfIc('subtract'))}${ibtn('p:intersect', 'Intersect', pfIc('intersect'))}${ibtn('p:exclude', 'Exclude', pfIc('exclude'))}${ibtn('p:divide', 'Divide', pfIc('divide'))}</div>
      <div class="psub">Path</div>
      <div class="brow wrap"><button class="aero-btn small" data-act="x:offset">Offset Path…</button><button class="aero-btn small" data-act="x:outline">Outline Stroke</button><button class="aero-btn small" data-act="x:simplify">Simplify…</button><button class="aero-btn small" data-act="x:join">Join</button><button class="aero-btn small" data-act="x:reverse">Reverse</button></div>
      <div class="psub">Transform</div>
      <div class="brow wrap"><button class="aero-btn small" data-act="t:fliph">Flip H</button><button class="aero-btn small" data-act="t:flipv">Flip V</button><button class="aero-btn small" data-act="t:rot">Rotate…</button><button class="aero-btn small" data-act="t:reflect">Reflect…</button><button class="aero-btn small" data-act="t:scale">Scale…</button><button class="aero-btn small" data-act="t:move">Move…</button></div>`;
    $('#alignTo').onchange = e => { LV.alignTo = e.target.value; };
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return; const [k, v] = b.dataset.act.split(':');
      if (k === 'a') LV.align(v); else if (k === 'd') LV.distribute(v); else if (k === 'p') LV.pathfinder(v);
      else if (k === 'x') ({ offset: LV.offsetPath, outline: LV.outlineStroke, simplify: LV.simplify, join: LV.joinPaths, reverse: LV.reversePath })[v]();
      else if (k === 't') ({ fliph: () => LV.flip('h'), flipv: () => LV.flip('v'), rot: LV.rotateDialog, reflect: LV.reflectDialog, scale: LV.scaleDialog, move: LV.moveDialog })[v]();
    });
  };

  /* ---------------- swatches ---------------- */
  function renderSwatches() {
    const el = $('#swatches'), sw = LV.doc.swatches;
    el.innerHTML = '<span class="sw none" data-i="none" title="None"><i class="none"></i></span>' + sw.map((s, i) => `<span class="sw" data-i="${i}" title="${esc(LV.isGrad(s) ? s.type + ' gradient' : s)}"><i style="background:${esc(cssBg(s))}"></i></span>`).join('') + '<span class="sw add" data-i="add" title="New swatch from the active fill/stroke">+</span>';
    $('#swCount').textContent = sw.length;
  }
  LV.initSwatches = () => {
    const el = $('#swatches');
    el.addEventListener('click', e => {
      const s = e.target.closest('.sw'); if (!s) return; const i = s.dataset.i;
      if (i === 'add') { const cur = curSpec(LV.paint.active); if (!cur) return; LV.doc.swatches.push(JSON.parse(JSON.stringify(cur))); LV.commit('New Swatch'); return; }
      LV.applyPaintToSelection(LV.paint.active, i === 'none' ? null : JSON.parse(JSON.stringify(LV.doc.swatches[+i])), 'Apply Swatch');
    });
    el.addEventListener('contextmenu', e => {
      e.preventDefault(); const s = e.target.closest('.sw'); if (!s || !/^\d+$/.test(s.dataset.i)) return;
      Aero.confirm('Delete Swatch', 'Delete this swatch from the document?', 'Delete').then(ok => { if (ok) { LV.doc.swatches.splice(+s.dataset.i, 1); LV.commit('Delete Swatch'); } });
    });
  };

  /* ---------------- layers ---------------- */
  const expanded = new Set();
  const typeIcon = it => {
    const k = LV.kind(it);
    const m = { layer: '<rect x="2" y="3" width="12" height="10" rx="1" fill="#cfe2f5" stroke="#3a6c97"/>', group: '<path d="M2 4h5l1 1.5h6V13H2z" fill="#ffe08a" stroke="#a07a10"/>', clip: '<rect x="2" y="2" width="12" height="12" fill="none" stroke="#3a6c97" stroke-dasharray="2 1"/><circle cx="8" cy="8" r="3.5" fill="#9cc6ee"/>', text: '<path d="M3 4h10M8 4v9" stroke="#0d2740" stroke-width="1.8"/>', areatext: '<rect x="2" y="2" width="12" height="12" fill="none" stroke="#9aaabb"/><path d="M4.5 5h7M8 5v7" stroke="#0d2740" stroke-width="1.5"/>', pathtext: '<path d="M2 12c3-6 9-6 12 0" fill="none" stroke="#9aaabb"/><path d="M5 4h6M8 4v5" stroke="#0d2740" stroke-width="1.5"/>', image: '<rect x="2" y="3" width="12" height="10" fill="#bfe3ff" stroke="#3a6c97"/><path d="M2 12l4-4 3 3 2-2 3 3" fill="#4cb82c"/>', trace: '<rect x="2" y="3" width="12" height="10" fill="#fff" stroke="#3a6c97"/><path d="M3 12c2-6 4-1 6-5s3-2 4-3" fill="none" stroke="#e0457b" stroke-width="1.5"/>', symbol: '<path d="M8 1.5l1.9 4 4.4.4-3.3 3 1 4.3L8 11l-4 2.2 1-4.3-3.3-3 4.4-.4z" fill="#ffd36e" stroke="#a07a10"/>', blend: '<rect x="1.5" y="8.5" width="6" height="6" fill="#4a90d9"/><rect x="5" y="5" width="6" height="6" fill="#8fb8e6" opacity=".8"/><rect x="8.5" y="1.5" width="6" height="6" fill="#cfe2f5" stroke="#3a6c97"/>', compound: '<path d="M2 2h12v12H2z M5 5v6h6V5z" fill="#4a90d9" fill-rule="evenodd"/>', repeat: '<circle cx="8" cy="3.5" r="2.2" fill="#4a90d9"/><circle cx="12.3" cy="10.5" r="2.2" fill="#8fb8e6"/><circle cx="3.7" cy="10.5" r="2.2" fill="#8fb8e6"/><circle cx="8" cy="8.5" r="5" fill="none" stroke="#3a6c97" stroke-dasharray="1.5 1.5"/>', warp: '<path d="M2 11C4 5 12 5 14 11" fill="none" stroke="#3a6c97" stroke-width="1.4"/><path d="M4 13c1.5-3 6.5-3 8 0" fill="none" stroke="#e0457b" stroke-width="1.4"/>' };
    if (m[k]) return m[k];
    const t = LV.firstPaintable(it), fill = t && t.fillColor ? (t.fillColor.type === 'gradient' ? LV.css(t.fillColor.gradient.stops[0].color) : LV.css(t.fillColor)) : 'none', st = t && t.strokeColor && t.strokeColor.type !== 'gradient' ? LV.css(t.strokeColor) : (fill === 'none' ? '#0d2740' : 'none');
    return `<path d="M2.5 12.5C4 4 10 3 13.5 3.5L12 13z" fill="${esc(fill)}" stroke="${esc(st)}" stroke-width="1.2"/>`;
  };
  const itemName = it => it.name || ({ path: it.closed ? 'Path' : 'Open Path', compound: 'Compound Path', group: 'Group', clip: 'Clip Group', text: (it.content || 'Text').split('\n')[0].slice(0, 30), areatext: (it.data.text || 'Area Type').split('\n')[0].slice(0, 30), pathtext: (it.data.text || 'Text on Path').slice(0, 30), image: 'Image', trace: 'Image Tracing', symbol: 'Symbol', blend: 'Blend', repeat: 'Repeat', warp: 'Warp' }[LV.kind(it)] || 'Item');
  const EYE = '<svg viewBox="0 0 16 16"><path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z" fill="#fff" stroke="#3a5a7a"/><circle cx="8" cy="8" r="2.2" fill="#2f5f9a"/></svg>';
  const LOCK = '<svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="7" rx="1" fill="#e3a21a" stroke="#8a5a0a"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="#5a5a5a" stroke-width="1.4"/></svg>';
  function renderLayers() {
    const el = $('#layers'), sel = new Set(LV.sel), act = P.project.activeLayer; el.innerHTML = '';
    let count = 0;
    const row = (it, depth) => {
      count++; if (count > 1500) return;
      const isL = it instanceof P.Layer, uid = LV.uidOf(it), hasKids = (isL || (it instanceof P.Group && !it.data.kind)) && it.children.length;
      const open = isL ? !expanded.has('c' + uid) : expanded.has(uid);
      const d = Aero.el('div', 'aero-item lrow' + (sel.has(it) ? ' sel' : '') + (isL ? ' layer' : '') + (isL && it === act ? ' active' : '') + (!it.visible ? ' hiddenrow' : ''));
      d.dataset.uid = uid; d.draggable = true; d.style.paddingLeft = (4 + depth * 14) + 'px';
      d.innerHTML = `<span class="lv-eye${it.visible ? '' : ' off'}" title="Toggle visibility">${EYE}</span><span class="lv-lock${it.locked ? '' : ' off'}" title="Toggle lock">${LOCK}</span><span class="lv-exp">${hasKids ? (open ? '▾' : '▸') : ''}</span><svg class="lv-ic" viewBox="0 0 16 16">${typeIcon(it)}</svg><span class="grow lv-name"></span>${isL ? `<span class="dim small">${it.children.length}</span>` : ''}${sel.has(it) ? '<span class="lv-selbox"></span>' : ''}`;
      d.querySelector('.lv-name').textContent = isL ? it.name || 'Layer' : itemName(it);
      d._item = it; el.appendChild(d);
      if (hasKids && open) for (let i = it.children.length - 1; i >= 0; i--) { const c = it.children[i]; if (c.clipMask && !isL) { row(c, depth + 1); continue; } row(c, depth + 1); }
    };
    for (let i = P.project.layers.length - 1; i >= 0; i--) row(P.project.layers[i], 0);
  }
  const findRowItem = uid => { let found = null; P.project.layers.forEach(L => { if (L.data.uid === uid) found = L; else if (!found) found = L.getItem({ match: x => x.data && x.data.uid === uid }); }); return found; };
  LV.initLayers = () => {
    const el = $('#layers');
    el.addEventListener('click', e => {
      const r = e.target.closest('.lrow'); if (!r) return; const it = r._item;
      if (e.target.closest('.lv-eye')) { it.visible = !it.visible; LV.pruneSel(); LV.commit(it.visible ? 'Show' : 'Hide'); return; }
      if (e.target.closest('.lv-lock')) { it.locked = !it.locked; LV.pruneSel(); LV.commit(it.locked ? 'Lock' : 'Unlock'); return; }
      if (e.target.closest('.lv-exp')) { const uid = it.data.uid, key = it instanceof P.Layer ? 'c' + uid : uid; expanded.has(key) ? expanded.delete(key) : expanded.add(key); renderLayers(); return; }
      if (it instanceof P.Layer) { it.activate(); if (e.ctrlKey || e.shiftKey) LV.setSel(it.children.filter(c => c.visible && !c.locked)); else renderLayers(); LV.emit('changed'); return; }
      if (!it.visible || it.locked || !LV.ancestorsOk(it)) { LV.toast('Hidden or locked objects cannot be selected'); return; }
      it.layer && it.layer.activate();
      if (e.shiftKey || e.ctrlKey) LV.toggleSel(it); else LV.setSel([it]);
    });
    el.addEventListener('dblclick', e => {
      const r = e.target.closest('.lrow'); if (!r || !e.target.closest('.lv-name')) return; const it = r._item, nm = r.querySelector('.lv-name');
      const inp = Aero.el('input'); inp.type = 'text'; inp.value = it.name || nm.textContent; inp.className = 'lv-rename'; nm.replaceWith(inp); inp.focus(); inp.select();
      const done = ok => { if (inp._done) return; inp._done = true; if (ok && inp.value.trim() && inp.value !== it.name) { it.name = inp.value.trim(); LV.commit('Rename'); } else renderLayers(); };
      inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); };
      inp.onblur = () => done(true);
    });
    // drag & drop reordering
    let dragItem = null;
    el.addEventListener('dragstart', e => { const r = e.target.closest('.lrow'); if (!r) return; dragItem = r._item; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', 'lv'); });
    const zone = (r, e) => { const b = r.getBoundingClientRect(), y = (e.clientY - b.top) / b.height, it = r._item, container = it instanceof P.Layer || (it instanceof P.Group && !it.data.kind && !it.clipped); return container && y > .3 && y < .7 ? 'into' : y < .5 ? 'above' : 'below'; };
    el.addEventListener('dragover', e => {
      if (!dragItem) return; const r = e.target.closest('.lrow'); if (!r) return; e.preventDefault();
      el.querySelectorAll('.drop-above,.drop-below,.drop-into').forEach(x => x.classList.remove('drop-above', 'drop-below', 'drop-into'));
      r.classList.add('drop-' + zone(r, e));
    });
    el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.querySelectorAll('.drop-above,.drop-below,.drop-into').forEach(x => x.classList.remove('drop-above', 'drop-below', 'drop-into')); });
    el.addEventListener('drop', e => {
      e.preventDefault(); const r = e.target.closest('.lrow'), it = dragItem; dragItem = null; if (!r || !it) return renderLayers();
      const target = r._item, z = zone(r, e); if (target === it || target.isDescendant?.(it)) return renderLayers();
      const moving = LV.sel.includes(it) && !(it instanceof P.Layer) ? LV.sortZ(LV.sel) : [it];
      if (it instanceof P.Layer) { if (!(target instanceof P.Layer)) return renderLayers(); if (z === 'below') it.insertBelow(target); else it.insertAbove(target); }
      else if (z === 'into') moving.forEach(m => target.addChild(m));
      else if (target instanceof P.Layer) { const L = target; moving.forEach(m => z === 'above' ? L.addChild(m) : L.insertChild(0, m)); }
      else moving.forEach(m => z === 'above' ? m.insertAbove(target) : m.insertBelow(target));
      LV.commit('Reorder');
    });
    el.addEventListener('dragend', () => { dragItem = null; el.querySelectorAll('.drop-above,.drop-below,.drop-into').forEach(x => x.classList.remove('drop-above', 'drop-below', 'drop-into')); });
    const bar = $('#bar-layers');
    const B = (title, svg, fn) => { const b = Aero.el('button', 'aero-iconbtn', `<svg viewBox="0 0 16 16">${svg}</svg>`); b.title = title; b.onclick = fn; bar.appendChild(b); };
    B('New layer', '<path d="M2 5l6-3 6 3-6 3z" fill="#bfe3ff" stroke="#3a6c97"/><path d="M2 9l6 3 6-3" fill="none" stroke="#3a6c97"/><circle cx="12" cy="12" r="3.4" fill="#4cb82c" stroke="#2a6a14" stroke-width=".7"/><path d="M12 10.2v3.6M10.2 12h3.6" stroke="#fff" stroke-width="1.3"/>', LV.newLayer);
    B('Move selection to active layer', '<path d="M2 11l6 3 6-3-6-3z" fill="#bfe3ff" stroke="#3a6c97"/><path d="M8 1.5v6M5.5 5L8 7.5 10.5 5" fill="none" stroke="#2a6a14" stroke-width="1.5"/>', LV.moveSelToLayer);
    B('Group selection (Ctrl+G)', '<path d="M2 4h5l1 1.5h6V13H2z" fill="#ffe08a" stroke="#a07a10"/>', LV.group);
    B('Make clipping mask (Ctrl+7)', '<rect x="2" y="2" width="12" height="12" fill="none" stroke="#3a6c97" stroke-dasharray="2 1"/><circle cx="8" cy="8" r="3.5" fill="#4a90d9"/>', LV.makeClip);
    B('Duplicate selection', '<path d="M5 4.5h8v10H5z" fill="#fff" stroke="#5a7a9a"/><path d="M3 1.5h8v10H3z" fill="#fff" stroke="#5a7a9a"/>', LV.duplicate);
    const sp = Aero.el('span'); sp.style.flex = '1'; bar.appendChild(sp);
    B('Delete selection or active layer', '<circle cx="8" cy="8" r="6.3" fill="#e0402c" stroke="#8a1a10"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>', LV.deleteLayerOrSel);
  };

  /* ---------------- artboards panel ---------------- */
  function renderBoards() {
    const el = $('#boards'); el.innerHTML = '';
    LV.doc.artboards.forEach((ab, i) => {
      const d = Aero.el('div', 'aero-item abrow' + (i === LV.doc.active ? ' sel' : ''), `<span class="abnum">${i + 1}</span><span class="grow"></span><span class="dim">${LV.fmt(ab.w)} × ${LV.fmt(ab.h)}</span>`);
      d.querySelector('.grow').textContent = ab.name; d.dataset.i = i; el.appendChild(d);
    });
  }
  LV.initBoards = () => {
    const el = $('#boards');
    el.addEventListener('click', e => { const r = e.target.closest('.abrow'); if (!r) return; LV.doc.active = +r.dataset.i; LV.fitBoard(); LV.emit('changed'); });
    el.addEventListener('dblclick', e => { const r = e.target.closest('.abrow'); if (r) LV.artboardOptions(+r.dataset.i); });
    const bar = $('#bar-boards');
    const B = (title, svg, fn) => { const b = Aero.el('button', 'aero-iconbtn', `<svg viewBox="0 0 16 16">${svg}</svg>`); b.title = title; b.onclick = fn; bar.appendChild(b); };
    B('New artboard…', '<rect x="2" y="2" width="10" height="12" fill="#fff" stroke="#3a6c97"/><circle cx="12" cy="12" r="3.4" fill="#4cb82c" stroke="#2a6a14" stroke-width=".7"/><path d="M12 10.2v3.6M10.2 12h3.6" stroke="#fff" stroke-width="1.3"/>', LV.newArtboardDialog);
    B('Duplicate artboard with its artwork', '<path d="M5 4.5h8v10H5z" fill="#fff" stroke="#5a7a9a"/><path d="M3 1.5h8v10H3z" fill="#fff" stroke="#5a7a9a"/>', () => LV.duplicateArtboard());
    B('Move up', '<path d="M8 2 14 9h-3.5v5h-5V9H2z" fill="#4a90d9" stroke="#174a85" stroke-linejoin="round"/>', () => LV.moveArtboard(LV.doc.active, -1));
    B('Move down', '<path d="M8 14 2 7h3.5V2h5v5H14z" fill="#4a90d9" stroke="#174a85" stroke-linejoin="round"/>', () => LV.moveArtboard(LV.doc.active, 1));
    B('Artboard options…', '<circle cx="8" cy="8" r="5" fill="#cfe2f5" stroke="#3a6c97" stroke-width="2" stroke-dasharray="2.2 1.4"/><circle cx="8" cy="8" r="2" fill="#3a6c97"/>', () => LV.artboardOptions());
    B('Fit artboard to selection / artwork', '<rect x="2" y="2" width="12" height="12" fill="none" stroke="#3a6c97" stroke-dasharray="2 1"/><rect x="5" y="5" width="6" height="6" fill="#4a90d9"/>', LV.fitArtboardToArt);
    const sp = Aero.el('span'); sp.style.flex = '1'; bar.appendChild(sp);
    B('Delete artboard', '<circle cx="8" cy="8" r="6.3" fill="#e0402c" stroke="#8a1a10"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>', () => LV.deleteArtboard());
  };

  /* ---------------- tabs ---------------- */
  LV.initTabs = () => {
    const tabs = (id, map) => $(id).addEventListener('click', e => {
      const t = e.target.closest('.aero-tab'); if (!t) return;
      $(id).querySelectorAll('.aero-tab').forEach(x => x.classList.toggle('on', x === t));
      Object.entries(map).forEach(([k, els]) => els.forEach(s => $(s).hidden = k !== t.dataset.t));
    });
    tabs('#tabsTop', { props: ['#pProps'], align: ['#pAlign'] });
    tabs('#tabsBot', { layers: ['#layers', '#bar-layers'], boards: ['#boards', '#bar-boards'], syms: ['#symbols', '#bar-symbols'], hist: ['#hist'] });
  };

  /* ---------------- command bar ---------------- */
  const num = (k, title, w = 58, step = 1) => `<input type="number" data-c="${k}" title="${title}" step="${step}" style="width:${w}px">`;
  const REF = ['topLeft', 'topCenter', 'topRight', 'leftCenter', 'center', 'rightCenter', 'bottomLeft', 'bottomCenter', 'bottomRight'];
  LV.refPt = 'topLeft'; LV.lockRatio = false;
  function buildCmd() {
    const id = LV.toolId, el = $('#cmd'), name = LV.tool ? LV.tool.name : '';
    let h = `<span class="tname">${esc(name)}</span>`;
    const iso = LV.isoRoot();
    if (iso) h += `<span class="isoBanner" title="Isolation mode: only the symbol's artwork can be selected">✎ Editing symbol <b>${esc((LV.sym.find(iso.data.symEdit.sym) || {}).name || '')}</b><button class="aero-btn small pri" data-cact="isodone">Done</button><button class="aero-btn small" data-cact="isocancel">Cancel</button></span><span class="sep"></span>`;
    const profOpts = () => Object.entries(LV.width.PROFILES).map(([k, p]) => `<option value="${k}">${esc(p.name)}</option>`).join('');
    if (id === 'shaper') h += `<span class="hint">Draw a rough rectangle, ellipse, triangle, polygon or line — it becomes a clean live shape · scribble over an overlap to punch it out, across shapes to merge them, inside one shape to delete it</span>`;
    else if (id === 'width') h += `<label>Profile <select data-c="wprofile"><option value="">Apply profile…</option>${profOpts()}</select></label><button class="aero-btn small" data-cact="wflip" title="Flip the profile along the path">Flip</button><span class="hint">Drag on a stroke to add a width point · drag a handle (Alt: one side only) · drag the diamond along the path · Delete removes the selected point · double-click to type widths</span>`;
    else if (id === 'shapebuilder') h += `<span class="hint">Select overlapping shapes, then drag across regions to merge them · Alt-drag (or Alt-click) deletes regions</span>`;
    else if (id === 'blend') h += `<button class="aero-btn small" data-cact="blendopts">Blend Options…</button><span class="hint">Click a shape, then another shape to blend between them · Object ▸ Blend ▸ Make blends the selection</span>`;
    else if (id === 'select' || id === 'direct') {
      h += `<span class="refpt" title="Reference point">${REF.map(r => `<i data-r="${r}" class="${r === LV.refPt ? 'on' : ''}"></i>`).join('')}</span>
        <label>X ${num('x', 'X position (relative to the active artboard)')}</label><label>Y ${num('y', 'Y position')}</label>
        <label>W ${num('w', 'Width')}</label><button class="aero-btn small lock${LV.lockRatio ? ' on' : ''}" data-cact="lock" title="Constrain width and height proportions">⛓</button><label>H ${num('h', 'Height')}</label>
        <label>∠ ${num('r', 'Rotation (degrees)', 50)}°</label><span class="sep"></span>
        <label>Opacity <input type="range" min="0" max="100" data-c="op" style="width:80px"><span class="v" data-cv="op"></span></label>
        <span class="hint" data-hint></span>`;
    } else if (id === 'type' || id === 'typepath') {
      h += `<label><select data-c="family">${LV.FONTS.map(f => `<option>${esc(f.family)}</option>`).join('')}</select></label><label><select data-c="weight"></select></label>
        <label>Size ${num('size', 'Font size', 54)}</label><label>Leading ${num('leading', 'Leading', 54)}</label><label>Tracking ${num('tracking', 'Tracking (1/1000 em)', 54, 10)}</label>
        <span class="aero-seg">${['left', 'center', 'right'].map(a => `<button class="aero-btn small" data-c-align="${a}">${a[0].toUpperCase() + a.slice(1)}</button>`).join('')}</span>
        <span class="hint">${id === 'type' ? 'Click for point type · drag for area type · click text to edit' : 'Click a path to type along it'}</span>`;
    } else if (id === 'rounded') h += `<label>Corner radius ${num('radius', 'Corner radius', 56)}</label><span class="hint">Drag to draw · Shift = square · Alt = from center · click for exact size</span>`;
    else if (id === 'polygon') h += `<label>Sides ${num('sides', 'Number of sides', 50)}</label><span class="hint">Drag from the center · Shift keeps it upright · click for exact size</span>`;
    else if (id === 'star') h += `<label>Points ${num('points', 'Number of points', 50)}</label><label>Inner radius % ${num('inner', 'Inner radius %', 50)}</label><span class="hint">Drag from the center · Shift keeps it upright</span>`;
    else if (id === 'pencil') h += `<label>Smoothness <input type="range" min="1" max="20" data-c="smooth" style="width:110px"><span class="v" data-cv="smooth"></span></label><span class="hint">Draw freehand · end near the start to close the path</span>`;
    else if (id === 'pen') h += `<span class="hint">Click = corner · drag = smooth curve · click the first point to close · Enter/Esc to finish · on a selected path: click to add / delete anchors, Alt-click to convert, click an end point to continue</span>`;
    else if (id === 'gradient') h += `<span class="aero-seg"><button class="aero-btn small" data-cact="glinear">Linear</button><button class="aero-btn small" data-cact="gradial">Radial</button></span><button class="aero-btn small" data-cact="grev">Reverse</button><span class="hint">Drag across an object to set the gradient vector · drag the ends or stops · click the bar to add a stop · double-click a stop to edit · drag a stop away to remove it</span>`;
    else if (id === 'eyedrop') h += `<span class="hint">Click an object to copy its appearance to the selection (or to the defaults) · Shift-click samples a single color</span>`;
    else if (id === 'scissors') h += `<span class="hint">Click on a path to cut it at that point</span>`;
    else if (id === 'knife') h += `<span class="hint">Drag across shapes to slice them (selected shapes only, if any are selected)</span>`;
    else if (id === 'artboard') {
      h += `<label>Name <input type="text" data-c="abname" style="width:120px"></label><label><select data-c="abpreset"><option value="">Preset…</option>${LV.PRESETS.map((p, i) => `<option value="${i}">${esc(p[0])}</option>`).join('')}</select></label>
        <label>W ${num('abw', 'Artboard width')}</label><label>H ${num('abh', 'Artboard height')}</label>
        <label><input type="checkbox" data-c="moveart"> Move artwork with artboard</label><button class="aero-btn small" data-cact="abnew">New</button><button class="aero-btn small" data-cact="abdel">Delete</button>`;
    } else if (id === 'zoom' || id === 'hand') h += `<span class="v" data-cv="zoom"></span><button class="aero-btn small" data-cact="zin">Zoom In</button><button class="aero-btn small" data-cact="zout">Zoom Out</button><button class="aero-btn small" data-cact="z100">100%</button><button class="aero-btn small" data-cact="zfit">Fit Artboard</button><button class="aero-btn small" data-cact="zall">Fit All</button><span class="hint">${id === 'zoom' ? 'Click to zoom in, Alt-click to zoom out, drag to zoom to an area' : 'Drag to pan · hold Space with any tool'}</span>`;
    else h += `<span class="hint">Drag to draw · Shift constrains · Alt draws from the center · click for exact size</span>`;
    el.innerHTML = h; refreshCmd();
  }
  function refreshCmd() {
    const el = $('#cmd'), q = k => el.querySelector(`[data-c=${k}]`), setv = (k, v) => { const i = q(k); if (i && document.activeElement !== i) i.value = v; };
    const id = LV.toolId;
    if (id === 'select' || id === 'direct') {
      const r = LV.selBounds(), ab = LV.board(), dis = !r;
      ['x', 'y', 'w', 'h', 'r', 'op'].forEach(k => { const i = q(k); if (i) i.disabled = dis; });
      if (r) { const ref = LV.refPt === 'center' ? r.center : r[LV.refPt]; setv('x', LV.fmt(ref.x - ab.x)); setv('y', LV.fmt(ref.y - ab.y)); setv('w', LV.fmt(r.width)); setv('h', LV.fmt(r.height)); setv('r', LV.sel.length === 1 ? LV.fmt(-(LV.sel[0].data.rot || 0)) : 0); setv('op', Math.round(LV.sel[0].opacity * 100)); const v = el.querySelector('[data-cv=op]'); if (v) v.textContent = Math.round(LV.sel[0].opacity * 100) + '%'; }
      else ['x', 'y', 'w', 'h', 'r'].forEach(k => setv(k, ''));
      const hint = el.querySelector('[data-hint]'); if (hint) hint.textContent = id === 'select' ? 'Shift constrains · Alt-drag duplicates · drag outside a corner to rotate' : 'Drag anchors and handles · Alt breaks a smooth point · drag a curve to reshape it';
    } else if (id === 'type' || id === 'typepath') {
      const txt = LV.sel.find(LV.isTextLike), s = txt ? LV.textStyleOf(txt) : { ...LV.text, leading: LV.text.size * LV.text.leading };
      const fi = LV.fontInfo(s.family) || LV.FONTS[0]; setv('family', fi.family);
      const w = q('weight'); if (w) { w.innerHTML = fi.weights.map(x => `<option value="${x}">${{ 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra Bold', 900: 'Black' }[x]}</option>`).join(''); w.value = LV.nearestWeight(fi.family, s.weight); }
      setv('size', LV.round(s.size, 2)); setv('leading', LV.round(s.leading, 2)); setv('tracking', s.tracking);
      el.querySelectorAll('[data-c-align]').forEach(b => b.classList.toggle('on', b.dataset.cAlign === s.align));
    } else if (id === 'rounded') setv('radius', LV.shape.radius);
    else if (id === 'polygon') setv('sides', LV.shape.sides);
    else if (id === 'star') { setv('points', LV.shape.points); setv('inner', LV.shape.inner); }
    else if (id === 'pencil') { setv('smooth', LV.shape.smooth); const v = el.querySelector('[data-cv=smooth]'); if (v) v.textContent = LV.shape.smooth; }
    else if (id === 'artboard') { const ab = LV.board(); setv('abname', ab.name); setv('abw', LV.fmt(ab.w)); setv('abh', LV.fmt(ab.h)); const m = q('moveart'); if (m) m.checked = LV.prefs.moveArt; }
    const z = el.querySelector('[data-cv=zoom]'); if (z) z.textContent = Math.round(P.view.zoom * 100) + '%';
  }
  LV.initCmd = () => {
    const el = $('#cmd');
    const onVal = (e, commit) => {
      const k = e.target.dataset.c; if (!k) return; const v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'number' || e.target.type === 'range' ? parseFloat(e.target.value) : e.target.value;
      if (['x', 'y', 'w', 'h', 'r'].includes(k)) { if (commit) LV.setGeom(k, v); return; }
      if (k === 'op') { LV.sel.forEach(it => it.opacity = v / 100); const o = el.querySelector('[data-cv=op]'); if (o) o.textContent = v + '%'; if (commit) LV.commit('Opacity'); else LV.redraw(); return; }
      if (['family', 'weight', 'size', 'leading', 'tracking'].includes(k)) { if (commit || e.target.tagName === 'SELECT') { const inp = $(`#pProps [data-k=${k}]`); setPropFromCmd(k, v); } return; }
      if (k === 'radius' || k === 'sides' || k === 'points' || k === 'inner' || k === 'smooth') { if (isFinite(v)) LV.shape[k] = v; const o = el.querySelector(`[data-cv=${k}]`); if (o) o.textContent = v; return; }
      if (k === 'abname' && commit) { LV.board().name = v || LV.board().name; LV.commit('Rename Artboard'); }
      if ((k === 'abw' || k === 'abh') && commit && v > 0) { LV.board()[k === 'abw' ? 'w' : 'h'] = v; LV.commit('Resize Artboard'); }
      if (k === 'abpreset' && v !== '') { const p = LV.PRESETS[+v]; Object.assign(LV.board(), { w: p[1], h: p[2] }); LV.commit('Artboard Preset'); e.target.value = ''; }
      if (k === 'moveart') LV.prefs.moveArt = v;
      if (k === 'wprofile' && v) { LV.width.applyProfile(LV.sel, v); e.target.value = ''; }
    };
    el.addEventListener('input', e => onVal(e, false));
    el.addEventListener('change', e => onVal(e, true));
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input')) e.target.blur(); });
    el.addEventListener('click', e => {
      const r = e.target.closest('.refpt i'); if (r) { LV.refPt = r.dataset.r; buildCmd(); return; }
      const al = e.target.closest('[data-c-align]'); if (al) { setPropFromCmd('align', al.dataset.cAlign); return; }
      const a = e.target.closest('[data-cact]'); if (!a) return; const c = a.dataset.cact;
      if (c === 'lock') { LV.lockRatio = !LV.lockRatio; a.classList.toggle('on', LV.lockRatio); }
      else if (c === 'isodone') LV.sym.finishEdit(); else if (c === 'isocancel') LV.sym.finishEdit(true);
      else if (c === 'blendopts') LV.blend.optionsDialog();
      else if (c === 'wflip') { const ps = LV.sel.filter(p => LV.width.get(p)); ps.forEach(p => LV.width.set(p, LV.width.get(p).pts.map(q => ({ t: 1 - q.t, l: q.r, r: q.l })))); if (ps.length) LV.commit('Flip Width Profile'); }
      else if (c === 'glinear' || c === 'gradial') { const attr = LV.paint.active, s = curSpec(attr); LV.applyPaintToSelection(attr, LV.isGrad(s) ? { ...s, type: c === 'gradial' ? 'radial' : 'linear' } : { type: c === 'gradial' ? 'radial' : 'linear', angle: 0, stops: [[s || '#ffffff', 0], ['#000000', 1]] }, 'Gradient Type'); }
      else if (c === 'grev') act(LV.paint.active + 'Reverse');
      else if (c === 'abnew') LV.newArtboardDialog(); else if (c === 'abdel') LV.deleteArtboard();
      else if (c === 'zin') LV.zoomAt(1.5); else if (c === 'zout') LV.zoomAt(1 / 1.5); else if (c === 'z100') LV.setZoom(1); else if (c === 'zfit') LV.fitBoard(); else if (c === 'zall') LV.fitAll();
    });
  };
  function setPropFromCmd(k, v) { setProp(k, k === 'weight' ? +v : v, true); refreshCmd(); }

  /* ---------------- status + refresh ---------------- */
  function refreshStatus() {
    if (!LV.doc) return;
    $('#stZoom').textContent = Math.round(P.view.zoom * 100) + '%';
    const n = LV.sel.length; $('#stSel').textContent = n ? (n === 1 ? (itemName(LV.sel[0]) + (LV.selSegs.size ? ` · ${LV.selSegs.size} anchor${LV.selSegs.size > 1 ? 's' : ''}` : '')) : n + ' objects') : 'No selection';
    const ab = LV.board(); $('#stBoard').textContent = `${ab.name} · ${LV.fmt(ab.w)} × ${LV.fmt(ab.h)} px · ${LV.doc.artboards.length} artboard${LV.doc.artboards.length > 1 ? 's' : ''}`;
  }
  let rq = 0;
  LV.refreshPanels = () => { if (rq) return; rq = requestAnimationFrame(() => { rq = 0; try { refreshPaint(); renderLayers(); renderBoards(); renderSwatches(); refreshCmd(); refreshStatus(); (LV.panelHooks || []).forEach(f => f()); } catch (e) { console.error(e); } }); };
  LV.on('selection', LV.refreshPanels); LV.on('changed', LV.refreshPanels);
  LV.on('history', () => Aero.renderHistory($('#hist'), LV.hist, i => { const s = LV.hist.go(i); if (s) LV.restore(s); }));
  LV.on('view', () => { refreshStatus(); const z = document.querySelector('[data-cv=zoom]'); if (z) z.textContent = Math.round(P.view.zoom * 100) + '%'; });
  LV.on('tool', () => { buildCmd(); refreshPaint(); });
  LV.on('cursor', pt => { if (!LV.doc) return; const ab = LV.board(); $('#stPos').textContent = `X ${LV.fmt(pt.x - ab.x)}  Y ${LV.fmt(pt.y - ab.y)}`; LV.redraw(); });
})();
