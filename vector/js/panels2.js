'use strict';
/* Lumen Vector — panels for the newer features: live shape, Appearance (fills/strokes/effects), Image Trace,
   symbol instance, blend, threaded text sections of the Properties panel, and the Symbols panel. */
(function () {
  const $ = s => document.querySelector(s), esc = Aero.esc, R = v => LV.round(v, 2);
  const num = (k, v, cls = 'n4', attrs = '') => `<input type="number" data-x="${k}" class="${cls}" value="${esc(String(v))}" ${attrs}>`;
  const one = () => LV.sel.length === 1 ? LV.sel[0] : null;
  const sigCache = new WeakMap();
  // re-render a section only when its content would change (keeps focus while typing)
  const render = (el, sig, html) => { if (sigCache.get(el) === sig) return; sigCache.set(el, sig); el.innerHTML = html; };
  const ICO = {
    eye: '<svg viewBox="0 0 16 16"><path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z" fill="#fff" stroke="#3a5a7a"/><circle cx="8" cy="8" r="2.2" fill="#2f5f9a"/></svg>',
    edit: '<svg viewBox="0 0 16 16"><path d="M3 13l1-3.5L11 2.5l2.5 2.5L6.5 12z" fill="#ffe08a" stroke="#8a6a10"/></svg>',
    del: '<svg viewBox="0 0 16 16"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" stroke="#c0301c" stroke-width="2" stroke-linecap="round"/></svg>',
    up: '<svg viewBox="0 0 16 16"><path d="M8 3l5 6H3z" fill="#3a6c97"/></svg>', down: '<svg viewBox="0 0 16 16"><path d="M8 13l5-6H3z" fill="#3a6c97"/></svg>'
  };
  const ib = (x, title, svg, extra = '') => `<button class="aero-iconbtn ap-b" data-x="${x}" title="${esc(title)}" ${extra}>${svg}</button>`;

  /* ---------------- live shape ---------------- */
  function shapeSection() {
    const el = $('#pShape'), it = one(), d = it && LV.live.get(it);
    el.hidden = !d; if (!d) { render(el, '', ''); return; }
    let h = `<div class="psub">${esc(LV.live.label(d))}<span class="dim" style="font-weight:400;margin-left:5px">live shape</span><button class="aero-btn small" data-x="expand" style="margin-left:auto" title="Convert to an ordinary path (Object ▸ Expand Shape)">Expand Shape</button></div>`;
    if (d.type === 'rect') {
      const linked = d.r.every(v => Math.abs(v - d.r[0]) < 1e-9);
      h += `<div class="prow"><span class="lbl">Size</span>W ${num('w', R(d.w))} H ${num('h', R(d.h))}</div>
        <div class="prow"><span class="lbl">Corners</span>${[0, 1, 2, 3].map(i => num('r' + i, R(d.r[i]), 'n3', `min="0" title="${['Top-left', 'Top-right', 'Bottom-right', 'Bottom-left'][i]} corner radius"`)).join('')}<label title="Change all corners together" class="small"><input type="checkbox" data-x="link" ${linked ? 'checked' : ''}>Link</label></div>`;
    } else if (d.type === 'ellipse') h += `<div class="prow"><span class="lbl">Size</span>W ${num('w', R(d.w))} H ${num('h', R(d.h))}</div><div class="prow"><span class="lbl" title="Pie angles (degrees, clockwise from 3 o'clock); equal = full ellipse">Pie</span>Start ${num('start', R(d.start ?? 0), 'n4')} End ${num('end', R(d.end ?? 360), 'n4')}</div>`;
    else if (d.type === 'polygon') h += `<div class="prow"><span class="lbl">Sides</span>${num('sides', d.sides, 'n3', 'min="3" max="1000"')}<span class="lbl">Radius</span>${num('radius', R(d.radius), 'n4', 'min="0"')}</div>`;
    else h += `<div class="prow"><span class="lbl">Points</span>${num('points', d.points, 'n3', 'min="3" max="1000"')}<span title="Outer radius">R1</span>${num('r1', R(d.r1), 'n4', 'min="0"')}<span title="Inner radius">R2</span>${num('r2', R(d.r2), 'n4', 'min="0"')}</div>`;
    if (d.type === 'polygon' || d.type === 'star') h += `<div class="prow"><span class="lbl" title="Rounds every corner">Corners</span>${num('cr', R(d.cr || 0), 'n4', 'min="0" title="Corner radius"')}</div>`;
    render(el, JSON.stringify(d), h);
  }
  function shapeInput(e) {
    const it = one(), d = it && LV.live.get(it), k = e.target.dataset.x; if (!d || !k) return;
    const v = parseFloat(e.target.value); if (!isFinite(v) || (v < 0 && k !== 'start' && k !== 'end')) return;
    let part = null;
    if (k === 'w' || k === 'h') { if (v > 0) part = { [k]: v }; }
    else if (/^r[0-3]$/.test(k)) { const i = +k[1], link = $('#pShape [data-x=link]')?.checked; part = { r: link ? [v, v, v, v] : d.r.map((x, j) => j === i ? v : x) }; }
    else if (k === 'sides' || k === 'points') part = { [k]: Math.max(3, Math.min(1000, Math.round(v))) };
    else if (k === 'radius' || k === 'r1' || k === 'r2' || k === 'cr') part = { [k]: v };
    else if (k === 'start' || k === 'end') { const s = k === 'start' ? v : d.start ?? 0, e2 = k === 'end' ? v : d.end ?? 360; if (Math.abs(((e2 - s) % 360 + 360) % 360) < 1e-6) { const nd = { ...d }; delete nd.start; delete nd.end; LV.live.set(it, nd); LV.commit('Edit Shape'); return; } part = { start: s, end: e2 }; }
    if (part && LV.live.update(it, part)) LV.commit('Edit Shape');
  }

  /* ---------------- appearance ---------------- */
  function appearSection() {
    const el = $('#pAppear'), it = LV.sel[0];
    el.hidden = !it; if (!it) { render(el, '', ''); return; }
    const fx = LV.fx.get(it) || {}, canEx = LV.sel.some(LV.fx.canExtra);
    const rows = [];
    (fx.extra || []).forEach((e, i) => {
      rows.push(`<div class="ap-row${e.on === false ? ' off' : ''}" data-i="${i}"><input type="checkbox" data-x="exon" ${e.on !== false ? 'checked' : ''} title="Show / hide">
        <span class="pchip ap-chip" data-x="exedit" title="Edit">${e.paint ? `<i style="background:${esc(LV.cssBg(e.paint))}"></i>` : '<i class="none"></i>'}</span>
        <span class="grow">${e.kind === 'fill' ? 'Fill' : `Stroke ${R(e.width)} px`}${(e.opacity ?? 1) < 1 ? ` · ${Math.round(e.opacity * 100)}%` : ''} <span class="dim small">${e.above ? 'above' : 'below'}</span></span>
        ${ib('exup', 'Move up in the stack', ICO.up)}${ib('exdown', 'Move down in the stack', ICO.down)}${ib('exedit', 'Edit…', ICO.edit)}${ib('exdel', 'Remove', ICO.del)}</div>`);
    });
    LV.fx.KEYS.forEach(k => {
      const e = fx[k]; if (!e) return;
      const info = k === 'shadow' ? `${R(e.x)}, ${R(e.y)} · blur ${R(e.blur)}` : 'blur' in e ? `blur ${R(e.blur)} · ${Math.round(e.opacity * 100)}%` : `radius ${R(e.radius)}`;
      rows.push(`<div class="ap-row${e.on === false ? ' off' : ''}" data-k="${k}"><input type="checkbox" data-x="efon" ${e.on !== false ? 'checked' : ''} title="Show / hide"><span class="ap-fx">fx</span><span class="grow">${esc(LV.fx.EFFECTS[k].name)} <span class="dim small">${esc(info)}</span></span>${ib('efedit', 'Edit…', ICO.edit)}${ib('efdel', 'Remove', ICO.del)}</div>`);
    });
    const h = `<div class="psub">Appearance${LV.sel.length > 1 ? `<span class="dim" style="font-weight:400;margin-left:5px">(${LV.sel.length} objects)</span>` : ''}</div>
      ${rows.join('') || '<div class="dim small" style="margin:2px 0 4px">Own fill &amp; stroke only. Add extra fills, strokes or live effects:</div>'}
      <div class="brow wrap" style="margin-top:3px"><button class="aero-btn small" data-x="addfill" ${canEx ? '' : 'disabled'} title="Add another fill on top (Effect ▸ Add New Fill)">+ Fill</button><button class="aero-btn small" data-x="addstroke" ${canEx ? '' : 'disabled'} title="Add another stroke underneath (Effect ▸ Add New Stroke)">+ Stroke</button>
      <select data-x="addfx" title="Add a live effect"><option value="">fx Add effect…</option>${LV.fx.KEYS.map(k => `<option value="${k}">${esc(LV.fx.EFFECTS[k].name)}</option>`).join('')}</select>
      <button class="aero-btn small" data-x="clearfx" ${Object.keys(fx).length ? '' : 'disabled'} title="Remove all extra fills, strokes and effects">Clear</button><button class="aero-btn small" data-x="expandfx" ${LV.fx.hasAny(it) ? '' : 'disabled'} title="Expand Appearance: extra fills/strokes become paths, effects become an image">Expand</button></div>`;
    render(el, JSON.stringify([LV.sel.length, fx, canEx]), h);
  }
  function appearClick(e) {
    const b = e.target.closest('[data-x]'); if (!b || b.disabled) return; const x = b.dataset.x, it = LV.sel[0]; if (!it) return;
    const row = b.closest('.ap-row'), i = row && row.dataset.i != null ? +row.dataset.i : -1, k = row && row.dataset.k;
    if (x === 'addfill') LV.fx.addExtra('fill');
    else if (x === 'addstroke') LV.fx.addExtra('stroke');
    else if (x === 'clearfx') LV.fx.clear();
    else if (x === 'expandfx') LV.fx.expand();
    else if (x === 'exedit' && i >= 0) LV.fx.extraDialog(it, i);
    else if (x === 'exdel' && i >= 0) { LV.fx.setExtra(it, i, null); LV.commit('Remove Appearance'); }
    else if ((x === 'exup' || x === 'exdown') && i >= 0) {
      const ex = LV.fx.get(it).extra, e0 = ex[i];
      // "up" = towards the top of the painting stack
      if (x === 'exup') { if (!e0.above && !ex.some((e, j) => j > i && !e.above)) LV.fx.setExtra(it, i, { ...e0, above: true }); else LV.fx.moveExtra(it, i, 1); }
      else { if (e0.above && !ex.some((e, j) => j < i && e.above)) LV.fx.setExtra(it, i, { ...e0, above: false }); else LV.fx.moveExtra(it, i, -1); }
      LV.commit('Reorder Appearance');
    }
    else if (x === 'efedit' && k) LV.fx.effectDialog(k, LV.sel.filter(o => LV.fx.get(o) && LV.fx.get(o)[k]));
    else if (x === 'efdel' && k) { LV.sel.forEach(o => LV.fx.setEffect(o, k, null)); LV.commit('Remove ' + LV.fx.EFFECTS[k].name); }
  }
  function appearChange(e) {
    const x = e.target.dataset.x, it = LV.sel[0]; if (!x || !it) return;
    const row = e.target.closest('.ap-row');
    if (x === 'addfx' && e.target.value) { const k = e.target.value; e.target.value = ''; LV.fx.effectDialog(k); }
    else if (x === 'exon' && row) { const i = +row.dataset.i, ex = LV.fx.get(it).extra[i]; LV.fx.setExtra(it, i, { ...ex, on: e.target.checked }); LV.commit('Toggle Appearance'); }
    else if (x === 'efon' && row) { const k = row.dataset.k; LV.sel.forEach(o => { const f = LV.fx.get(o); if (f && f[k]) LV.fx.setEffect(o, k, { ...f[k], on: e.target.checked }); }); LV.commit('Toggle Effect'); }
  }

  /* ---------------- image / image trace ---------------- */
  const presetOpts = cur => Object.entries(LV.trace.PRESETS).map(([k, p]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(p.name)}</option>`).join('') + (cur === 'custom' ? '<option value="custom" selected>Custom</option>' : '');
  function traceSection() {
    const el = $('#pTrace'), it = one(), k = it && LV.kind(it);
    el.hidden = k !== 'image' && k !== 'trace'; if (el.hidden) { render(el, '', ''); return; }
    if (k === 'image') {
      render(el, 'img', `<div class="psub">Image Trace</div><div class="prow"><select data-x="tpreset" style="flex:1">${presetOpts(LV.trace.last?.preset || 'bw')}</select><button class="aero-btn small" data-x="trace" title="Object ▸ Image Trace ▸ Make">Trace</button><button class="aero-btn small" data-x="topts" title="Trace with live preview of all options">Options…</button></div>`);
      return;
    }
    const s = it.data.trace, st = LV.trace.out(it)?.data.stats || {};
    const rng = (key, label, min, max, v, title) => `<div class="prow"><span class="lbl" title="${esc(title)}">${label}</span><input type="range" min="${min}" max="${max}" data-x="t_${key}" value="${v}"><span class="dim n3">${v}</span></div>`;
    const h = `<div class="psub">Image Tracing<span class="dim" style="font-weight:400;margin-left:5px">live</span></div>
      <div class="prow"><span class="lbl">Preset</span><select data-x="t_preset" style="flex:1">${presetOpts(s.preset)}</select></div>
      <div class="prow"><span class="lbl">Mode</span><select data-x="t_mode" style="flex:1">${[['bw', 'Black and white'], ['gray', 'Grayscale'], ['color', 'Color'], ['sketch', 'Sketch (edges)']].map(([v, t]) => `<option value="${v}" ${v === s.mode ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      ${s.mode === 'bw' || s.mode === 'sketch' ? rng('threshold', 'Threshold', 0, 255, s.threshold, 'Pixels darker than this become black') : rng('colors', s.mode === 'gray' ? 'Grays' : 'Colors', 2, 32, s.colors, 'Number of colors')}
      ${rng('paths', 'Paths', 0, 100, s.paths, 'Fidelity: higher follows the pixels more tightly')}${rng('corners', 'Corners', 0, 100, s.corners, 'Higher keeps more sharp corners')}${rng('noise', 'Noise', 1, 100, s.noise, 'Ignore areas smaller than this (px)')}
      <div class="prow"><label class="small"><input type="checkbox" data-x="t_ignoreWhite" ${s.ignoreWhite ? 'checked' : ''}> Ignore white</label><span class="lbl" style="margin-left:auto">View</span><select data-x="t_view">${[['result', 'Result'], ['overlay', 'Over source'], ['outline', 'Outlines'], ['source', 'Source']].map(([v, t]) => `<option value="${v}" ${v === s.view ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="dim small">${st.paths || 0} paths · ${st.anchors || 0} anchors · ${st.colors || 0} color${st.colors === 1 ? '' : 's'}</div>
      <div class="brow wrap" style="margin-top:4px"><button class="aero-btn small" data-x="topts">Options…</button><button class="aero-btn small pri" data-x="texpand" title="Object ▸ Image Trace ▸ Expand">Expand</button><button class="aero-btn small" data-x="trelease" title="Object ▸ Image Trace ▸ Release">Release</button></div>`;
    render(el, JSON.stringify([s, st]), h);
  }
  function traceInput(e) { const x = e.target.dataset.x; if (x && x.startsWith('t_') && e.target.type === 'range') e.target.nextElementSibling.textContent = e.target.value; }
  function traceChange(e) {
    const x = e.target.dataset.x; if (!x) return;
    if (x === 'tpreset') { LV.trace.last = { ...LV.trace.DEFAULT, ...LV.trace.presetValues(e.target.value) }; return; }
    if (!x.startsWith('t_')) return;
    const key = x.slice(2), v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? +e.target.value : e.target.value;
    if (key === 'preset') LV.trace.setOptions(LV.trace.presetValues(v));
    else LV.trace.setOptions(key === 'view' ? { view: v } : { [key]: v, preset: 'custom' });
  }
  function traceClick(e) {
    const b = e.target.closest('button[data-x]'); if (!b) return; const x = b.dataset.x;
    if (x === 'trace') { const p = $('#pTrace [data-x=tpreset]')?.value || 'bw'; LV.trace.makeSel(false, p); }
    else if (x === 'topts') LV.trace.optionsDialog();
    else if (x === 'texpand') LV.trace.expandSel();
    else if (x === 'trelease') LV.trace.releaseSel();
  }

  /* ---------------- symbol instance / blend / threads ---------------- */
  function objSection() {
    const el = $('#pObj'), it = one(), k = it && LV.kind(it);
    let h = '', sig = '';
    if (k === 'symbol') {
      const s = LV.sym.find(it.data.sym);
      sig = 'sym' + it.data.sym + (s && s.name);
      h = `<div class="psub">Symbol<span class="dim" style="font-weight:400;margin-left:5px">${esc(s ? s.name : 'missing definition')}</span></div>
        <div class="brow wrap"><button class="aero-btn small" data-x="symedit" title="Edit the master; all instances update (or double-click the instance)">Edit Symbol</button><button class="aero-btn small" data-x="symbreak">Break Link</button><button class="aero-btn small" data-x="symreset" title="Remove rotation and scaling from this instance">Reset Transform</button></div>`;
    } else if (k === 'blend') {
      const o = LV.blend.sanitize(it.data.blend), keys = LV.blend.keys(it).length;
      const hasSpine = !!LV.blend.spine(it);
      sig = 'blend' + JSON.stringify(o) + keys + hasSpine;
      h = `<div class="psub">Blend<span class="dim" style="font-weight:400;margin-left:5px">${keys} objects</span></div>
        <div class="prow"><span class="lbl">Spacing</span><select data-x="bmode">${[['smooth', 'Smooth Color'], ['steps', 'Specified Steps'], ['distance', 'Specified Distance']].map(([v, t]) => `<option value="${v}" ${v === o.mode ? 'selected' : ''}>${t}</option>`).join('')}</select>${o.mode === 'steps' ? num('bsteps', o.steps, 'n3', 'min="1" max="500" title="Steps"') : o.mode === 'distance' ? num('bdist', R(o.dist), 'n4', 'min="0.5" title="Distance between steps"') : ''}</div>
        <div class="brow wrap"><label class="small" title="Rotate the steps to follow the spine"><input type="checkbox" data-x="balign" ${o.align ? 'checked' : ''}>Align to path</label>${hasSpine ? '<button class="aero-btn small" data-x="brevspine" title="Path ▸ Blend ▸ Reverse Spine">Reverse Spine</button>' : '<span class="dim small">Select a path too and use Path ▸ Blend ▸ Replace Spine</span>'}</div><div class="brow wrap"><button class="aero-btn small" data-x="breverse" title="Reverse the stacking order of the blend">Reverse Front to Back</button><button class="aero-btn small" data-x="bexpand">Expand</button><button class="aero-btn small" data-x="brelease">Release</button></div>`;
    } else if (k === 'areatext') {
      const chain = LV.threadChain(it), i = chain.indexOf(it);
      sig = 'thread' + chain.length + ':' + i;
      h = `<div class="psub">Text Frame${chain.length > 1 ? `<span class="dim" style="font-weight:400;margin-left:5px">thread: frame ${i + 1} of ${chain.length}</span>` : ''}</div>
        <div class="brow wrap"><button class="aero-btn small" data-x="thnew" title="Create a linked frame next to this one; overflow text flows into it">Thread to New Frame</button>${chain.length > 1 ? '<button class="aero-btn small" data-x="threl" title="Type ▸ Threaded Text ▸ Release Selection">Release Frame</button><button class="aero-btn small" data-x="thrm" title="Type ▸ Threaded Text ▸ Remove Threading">Remove Threading</button>' : ''}</div>`;
    }
    el.hidden = !h; render(el, sig, h);
  }
  function objClick(e) {
    const b = e.target.closest('button[data-x]'); if (!b) return; const x = b.dataset.x, it = one(); if (!it) return;
    if (x === 'symedit') LV.sym.edit(it);
    else if (x === 'symbreak') LV.sym.breakLink([it]);
    else if (x === 'symreset') { const m = it.matrix; it.matrix = new P.Matrix().translate(m.tx, m.ty); LV.commit('Reset Transform'); }
    else if (x === 'bexpand') LV.blend.expand();
    else if (x === 'brelease') LV.blend.release();
    else if (x === 'breverse') LV.blend.reverse();
    else if (x === 'brevspine') LV.blend.reverseSpine();
    else if (x === 'thnew') LV.threadNewFrame();
    else if (x === 'threl') LV.threadReleaseSel();
    else if (x === 'thrm') LV.threadRemoveSel();
  }
  function objChange(e) {
    const x = e.target.dataset.x, it = one(); if (!x || !it || LV.kind(it) !== 'blend') return;
    const o = LV.blend.sanitize(it.data.blend);
    if (x === 'bmode') o.mode = e.target.value; else if (x === 'bsteps') o.steps = +e.target.value; else if (x === 'bdist') o.dist = +e.target.value; else if (x === 'balign') o.align = e.target.checked; else return;
    it.data.blend = LV.blend.sanitize(o); LV.blend.regen(it, true); LV.blend.last = { ...it.data.blend }; LV.commit('Blend Options');
  }

  /* ---------------- Symbols panel ---------------- */
  function renderSymbols() {
    const el = $('#symbols'); if (!el || !LV.doc) return;
    const list = LV.sym.list(), counts = new Map(); LV.sym.instances().forEach(i => counts.set(i.data.sym, (counts.get(i.data.sym) || 0) + 1));
    if (LV.sym.selected && !LV.sym.find(LV.sym.selected)) LV.sym.selected = null;
    const sig = JSON.stringify([list.map(s => [s.id, s.name, s.v]), [...counts], LV.sym.selected]);
    if (!list.length) { render(el, sig, '<div class="dim" style="padding:8px 10px;white-space:normal">No symbols yet. Select artwork and click <b>New Symbol</b> (F8) to reuse it — editing the master updates every instance.</div>'); return; }
    render(el, sig, list.map(s => `<div class="aero-item symrow${s.id === LV.sym.selected ? ' sel' : ''}" data-id="${esc(s.id)}" draggable="true" title="Double-click or drag onto the canvas to place an instance"><img class="symthumb" src="${LV.sym.thumb(s)}" alt=""><span class="grow"></span><span class="dim small">${counts.get(s.id) || 0}</span></div>`).join(''));
    el.querySelectorAll('.symrow').forEach((r, i) => { r.querySelector('.grow').textContent = list[i].name; });
  }
  function initSymbols() {
    const el = $('#symbols'), bar = $('#bar-symbols');
    el.addEventListener('click', e => { const r = e.target.closest('.symrow'); if (!r) return; LV.sym.selected = r.dataset.id; sigCache.delete(el); renderSymbols(); });
    el.addEventListener('dblclick', e => { const r = e.target.closest('.symrow'); if (!r) return; if (e.target.closest('.grow')) { LV.sym.rename(r.dataset.id); return; } LV.sym.place(r.dataset.id); });
    el.addEventListener('dragstart', e => { const r = e.target.closest('.symrow'); if (!r) return; e.dataTransfer.setData('text/x-lv-symbol', r.dataset.id); e.dataTransfer.effectAllowed = 'copy'; });
    const view = $('#view');
    view.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('text/x-lv-symbol')) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; } });
    view.addEventListener('drop', e => {
      const id = e.dataTransfer.getData('text/x-lv-symbol'); if (!id) return; e.preventDefault(); e.stopPropagation();
      const r = view.getBoundingClientRect(); LV.sym.place(id, P.view.viewToProject(new P.Point(e.clientX - r.left, e.clientY - r.top)));
    });
    const B = (title, svg, fn) => { const b = Aero.el('button', 'aero-iconbtn', `<svg viewBox="0 0 16 16">${svg}</svg>`); b.title = title; b.onclick = fn; bar.appendChild(b); };
    B('New symbol from selection (F8)', '<path d="M8 1.5l1.9 4 4.4.4-3.3 3 1 4.3L8 11l-4 2.2 1-4.3-3.3-3 4.4-.4z" fill="#ffd36e" stroke="#a07a10"/><circle cx="12.5" cy="12.5" r="3" fill="#4cb82c" stroke="#2a6a14" stroke-width=".7"/><path d="M12.5 11v3M11 12.5h3" stroke="#fff" stroke-width="1.2"/>', () => LV.sym.create());
    B('Place symbol instance (or double-click / drag the symbol)', '<rect x="2" y="2" width="12" height="12" rx="1" fill="#fff" stroke="#3a6c97"/><path d="M8 4.5l1.1 2.3 2.5.3-1.9 1.7.5 2.5L8 10.1l-2.2 1.2.5-2.5-1.9-1.7 2.5-.3z" fill="#4a90d9"/>', () => LV.sym.place());
    B('Edit symbol (all instances update)', ICO.edit.replace('<svg viewBox="0 0 16 16">', '').replace('</svg>', ''), () => LV.sym.edit());
    B('Break link to symbol', '<path d="M6.5 9.5l-2 2a2 2 0 0 1-2.8-2.8l2-2M9.5 6.5l2-2a2 2 0 0 1 2.8 2.8l-2 2" fill="none" stroke="#3a6c97" stroke-width="1.5"/><path d="M6 6L4 4M10 10l2 2" stroke="#c0301c" stroke-width="1.5"/>', () => LV.sym.breakLink());
    B('Redefine symbol with the selected artwork', '<path d="M13 8a5 5 0 1 1-1.5-3.6" fill="none" stroke="#3a6c97" stroke-width="1.6"/><path d="M12.5 1.5v3.5H9" fill="none" stroke="#3a6c97" stroke-width="1.6"/>', () => LV.sym.redefine());
    B('Duplicate symbol', '<path d="M5 4.5h8v10H5z" fill="#fff" stroke="#5a7a9a"/><path d="M3 1.5h8v10H3z" fill="#fff" stroke="#5a7a9a"/>', () => LV.sym.duplicateDef());
    const sp = Aero.el('span'); sp.style.flex = '1'; bar.appendChild(sp);
    B('Delete symbol', '<circle cx="8" cy="8" r="6.3" fill="#e0402c" stroke="#8a1a10"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>', () => LV.sym.remove());
  }

  /* ---------------- wiring ---------------- */
  LV.initPanels2 = () => {
    const shape = $('#pShape'), ap = $('#pAppear'), tr = $('#pTrace'), ob = $('#pObj');
    shape.addEventListener('change', shapeInput);
    shape.addEventListener('click', e => { const b = e.target.closest('[data-x=expand]'); if (b) { LV.live.expand(LV.sel); LV.commit('Expand Shape'); } });
    ap.addEventListener('click', appearClick); ap.addEventListener('change', appearChange);
    tr.addEventListener('input', traceInput); tr.addEventListener('change', traceChange); tr.addEventListener('click', traceClick);
    ob.addEventListener('click', objClick); ob.addEventListener('change', objChange);
    initSymbols();
    LV.panelHooks = LV.panelHooks || [];
    LV.panelHooks.push(() => { shapeSection(); traceSection(); objSection(); appearSection(); renderSymbols(); });
  };
})();
