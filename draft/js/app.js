// Lumen Draft — free AutoCAD-style 2-D drafting. Application shell: input, command line, panels, dialogs, files.
(function () {
  'use strict';
  const G = window.LDGeom, M = window.LDModel, X = window.LDDxf, EX = window.LDExport;
  const $ = id => document.getElementById(id), esc = s => Aero.esc(String(s ?? ''));
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  const A = window.LDApp = {
    doc: null, space: 'model', selSet: new Set(), hoverId: null, cursor: null, preview: null, rubber: null, track: null, winSel: null, busy: false,
    grid: true, snapOn: false, gridStep: 10, ortho: false, polar: true, polarInc: 45, osnapOn: true, lwt: true, prec: 4, crossFull: false,
    osnap: { end: true, mid: true, cen: true, quad: true, int: true, perp: true, tan: true, nea: false, node: true, ins: true },
    filletR: 0, chamD1: 0, chamD2: 0, hatch: { pat: 'ANSI31', sc: 1, ang: 0 }, curColor: 256, curLt: 'BYLAYER', curLw: -1,
    docName: 'Drawing1', filePath: null, fmt: 'ldraft', lastPt: null, clip: null,
  };
  const hist = new Aero.History({ max: 120, onChange: () => { } });
  let V, E;

  /* ======================= document lifecycle ======================= */
  function load(doc, name, path, fmt) {
    if (E) E.cancel();
    A.doc = M.normalize(doc); A.docName = name || 'Drawing1'; A.filePath = path || null; A.fmt = fmt || 'ldraft';
    A.selSet = new Set(); A.hoverId = null; A.lastPt = null;
    hist.reset('Open', JSON.stringify(A.doc)); Aero.setDoc(A.docName, false);
    V.invalidate(); V.zoomExtents(); refresh();
    $('welcome').hidden = A.doc.ents.length > 0 || A.welcomeDismissed;
  }
  function commit(label) {
    hist.push(label, JSON.stringify(A.doc)); V.invalidate();
    if (A.selSet.size) { const ids = new Set(A.doc.ents.map(e => e.id)); A.selSet = new Set([...A.selSet].filter(id => ids.has(id))); }
    refresh();
    if (A.doc.ents.length) $('welcome').hidden = true;
  }
  function restore(state) {
    if (!state) return; A.doc = JSON.parse(state); A.selSet = new Set(); V.invalidate(); refresh();
  }
  function undo() { if (E.running()) E.cancel(); const s = hist.undo(); if (s) { restore(s); echo('Undo: ' + hist.items[hist.index + 1].label); } else echo('Nothing to undo.'); }
  function redo() { const s = hist.redo(); if (s) { restore(s); echo('Redo: ' + hist.items[hist.index].label); } else echo('Nothing to redo.'); }
  function refresh() { V.draw(); V.overlay(); renderProps(); renderLayers(); renderBars(); renderStatus(); }
  // edit selected entities (replaces objects so caches stay valid)
  function editSel(label, fn) {
    if (E.running()) return;
    let n = 0; A.doc.ents = A.doc.ents.map(e => { if (!A.selSet.has(e.id)) return e; const c = JSON.parse(JSON.stringify(e)); const r = fn(c) || c; n++; return M.validEnt(r) ? r : e; });
    if (n) commit(label);
  }
  const selEnts = () => A.doc.ents.filter(e => A.selSet.has(e.id));

  /* ======================= command line ======================= */
  const hEl = () => $('cmdhist');
  function histLine(text, cls) { const d = document.createElement('div'); if (cls) d.className = cls; d.textContent = text; const h = hEl(); h.appendChild(d); while (h.childNodes.length > 400) h.firstChild.remove(); h.scrollTop = h.scrollHeight; }
  function echo(s) { histLine(s); }
  let promptText = 'Command:';
  function setPrompt(text, kws) {
    promptText = text; const p = $('prompt');
    const m = text.match(/^(.*?)\[([^\]]+)\](.*)$/);
    if (m) p.innerHTML = esc(m[1]) + '[' + m[2].split('/').map(k => `<span class="kw" data-k="${esc(k)}">${esc(k)}</span>`).join('/') + ']' + esc(m[3]);
    else p.textContent = text;
    p.title = text;
  }
  const ui = {
    setPrompt, echo, status: s => { $('st1').textContent = s; },
    echoInput: t => histLine(promptText + ' ' + t, 'i'),
    echoCmd: n => histLine('Command: ' + n, 'c'),
    commit, mouseMoved: () => { if (A.lastMouse) onMove(A.lastMouse, true); },
    setSpace: s => setSpace(s),
    cmdState: n => { const t = TOOLMAP[n]; tb.set(t || null); $('hint').textContent = n ? '' : hintIdle(); },
    undo, redo, refreshPanels: () => { renderLayers(); renderProps(); renderBars(); },
    describe, layerDialog, showProps: () => { renderProps(); $('props').scrollIntoView({ block: 'nearest' }); },
    draftingDialog, unitsDialog, pageDialog, exportDialog, dimStyleDialog, hatchDialog, textDialog, insertDialog,
    selectAll: () => { A.selSet = new Set(A.doc.ents.filter(V.selectable).map(e => e.id)); refresh(); },
    copyClip,
  };
  function submitInput() {
    const inp = $('cmdIn'), t = inp.value; inp.value = ''; hideSuggest();
    if (!E.pending && E.zoomFactor && /^[\d.]+x$/i.test(t.trim())) { E.zoomFactor(t); return; }
    if (!E.pending && t.trim()) cmdHistory.push(t.trim()), histIdx = cmdHistory.length;
    E.input(t);
  }
  const cmdHistory = []; let histIdx = 0, sugIdx = -1;
  function suggestions(t) {
    t = t.trim().toUpperCase(); if (!t || E.pending || /[\d,@<]/.test(t)) return [];
    const out = [], seen = new Set();
    for (const [a, n] of Object.entries(E.ALIAS)) if (a.startsWith(t) && !E.REG[n].hidden && !seen.has(n)) { seen.add(n); out.push({ a, n }); }
    out.sort((x, y) => (x.a === t ? -1 : y.a === t ? 1 : x.a.length - y.a.length));
    return out.slice(0, 9);
  }
  function showSuggest() {
    const list = suggestions($('cmdIn').value), box = $('suggest');
    if (!list.length) return hideSuggest();
    sugIdx = Math.min(Math.max(sugIdx, -1), list.length - 1);
    box.innerHTML = list.map((s, i) => `<div data-n="${s.n}" class="${i === sugIdx ? 'on' : ''}"><b>${esc(s.n)}${s.a !== s.n ? ` (${esc(s.a)})` : ''}</b><span>${esc(E.REG[s.n].desc)}</span></div>`).join('');
    box.hidden = false;
  }
  function hideSuggest() { $('suggest').hidden = true; sugIdx = -1; }

  /* ======================= pointer input ======================= */
  let panning = null, winStart = null, gripDrag = null;
  function capture(ev) { try { $('ov').setPointerCapture(ev.pointerId); } catch (e) { } }
  function screenOf(ev) { const r = $('ov').getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
  function resolvePoint(sx, sy) {
    let pt = V.s2w(sx, sy); A.snapHit = null; A.track = null; A.trackTip = null; A.dynTip = null;
    const p = E.pending, wantsPt = p && (p.kind === 'point' || p.kind === 'dist' || p.kind === 'angle');
    if (A.space !== 'model' || !wantsPt) return pt;
    const base = p.opts.base;
    if (A.osnapOn) { const s = V.snap(sx, sy, base, A.osnap); if (s) { A.snapHit = s; pt = [s.x, s.y]; } }
    if (!A.snapHit) {
      if (A.snapOn) { const g = A.gridStep; pt = [Math.round(pt[0] / g) * g, Math.round(pt[1] / g) * g]; }
      if (base) {
        const dx = pt[0] - base[0], dy = pt[1] - base[1];
        if (A.ortho) pt = Math.abs(dx) >= Math.abs(dy) ? [pt[0], base[1]] : [base[0], pt[1]];
        else if (A.polar && Math.hypot(dx, dy) > 1e-12) {
          const inc = A.polarInc * D2R, a = Math.atan2(dy, dx), k = Math.round(a / inc), ta = k * inc, d = Math.hypot(dx, dy);
          if (d * V.scale() * Math.abs(Math.sin(a - ta)) < 9) {
            const ux = Math.cos(ta), uy = Math.sin(ta), proj = dx * ux + dy * uy;
            pt = [base[0] + ux * proj, base[1] + uy * proj]; A.track = [base, ta];
            A.trackTip = `Polar: ${E.f4(Math.abs(proj))} < ${E.fa(proj >= 0 ? ta : ta + Math.PI)}`;
          }
        }
      }
    }
    if (base && !A.trackTip) A.dynTip = `${E.f4(G.dist(base, pt))} < ${E.fa(G.ang(pt[0] - base[0], pt[1] - base[1]))}`;
    return pt;
  }
  function onMove(ev, synthetic) {
    A.lastMouse = { clientX: ev.clientX, clientY: ev.clientY, shiftKey: ev.shiftKey };
    const [sx, sy] = screenOf(ev);
    if (panning) { V.pan(sx - panning[0], sy - panning[1]); panning = [sx, sy]; return; }
    const pt = resolvePoint(sx, sy);
    A.cursor = { sx, sy, pt };
    const c = A.space === 'model' ? pt : V.s2w(sx, sy);
    $('coords').textContent = `${E.f4(c[0])}, ${E.f4(c[1])}${A.space === 'layout' ? ' (paper)' : ''}`;
    const p = E.pending;
    A.rubber = p && p.opts.base && !p.opts.noRubber && (p.kind === 'point' || p.kind === 'dist' || p.kind === 'angle') ? [p.opts.base, pt] : null;
    if (p && p.opts.preview && A.space === 'model') { try { A.preview = p.opts.preview(pt) || null; } catch (e) { A.preview = null; } }
    else if (p && p.opts.previewPick) { try { A.preview = p.opts.previewPick(V.s2w(sx, sy)) || null; } catch (e) { A.preview = null; } }
    else if (!gripDrag) A.preview = null;
    if (winStart) A.winSel = { x1: winStart[0], y1: winStart[1], x2: sx, y2: sy };
    // pre-selection highlight
    let hov = null;
    if (A.space === 'model' && !winStart && (!p || p.kind === 'sel' || p.kind === 'ent') && A.doc.ents.length < 20000) { const e = V.pick(sx, sy, p && p.opts.filter); hov = e ? e.id : null; }
    A.hoverId = hov;
    V.overlay();
  }
  function finishWindow(sx, sy, shift) {
    const [x1, y1] = V.s2w(winStart[0], winStart[1]), [x2, y2] = V.s2w(sx, sy);
    const crossing = sx < winStart[0], r = [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    winStart = null; A.winSel = null;
    const ids = V.windowSelect(r, crossing);
    if (E.pending && E.pending.kind === 'sel') E.windowDone(ids);
    else { ids.forEach(id => shift ? A.selSet.delete(id) : A.selSet.add(id)); refresh(); }
    V.overlay();
  }
  function onDown(ev) {
    const [sx, sy] = screenOf(ev);
    $('welcome').hidden = true; A.welcomeDismissed = true;
    if (ev.button === 1 || (ev.button === 0 && A.space === 'layout' && !E.pending) || (ev.button === 0 && ev.altKey)) { ev.preventDefault(); panning = [sx, sy]; $('stage').classList.add('pan'); capture(ev); return; }
    if (ev.button !== 0) return;
    capture(ev);
    if (winStart) { finishWindow(sx, sy, ev.shiftKey); return; }
    const p = E.pending;
    if (p) {
      if (A.space !== 'model' && p.kind !== 'point') return;
      const pt = A.space === 'model' ? resolvePoint(sx, sy) : V.s2w(sx, sy);
      const handled = E.click(pt, ev, [sx, sy]);
      if (!handled && p.kind === 'sel') { winStart = [sx, sy]; A.downAt = [sx, sy]; }
      return;
    }
    if (A.space !== 'model') return;
    const gh = V.gripAt(sx, sy);
    if (gh) { startGrip(gh); return; }
    const e = V.pick(sx, sy);
    if (e) { if (ev.shiftKey) A.selSet.delete(e.id); else A.selSet.add(e.id); refresh(); return; }
    if (ev.shiftKey && !A.selSet.size) return;
    winStart = [sx, sy]; A.downAt = [sx, sy];
  }
  function onUp(ev) {
    const [sx, sy] = screenOf(ev);
    if (panning) { panning = null; $('stage').classList.remove('pan'); return; }
    if (winStart && A.downAt && Math.hypot(sx - A.downAt[0], sy - A.downAt[1]) > 5) finishWindow(sx, sy, ev.shiftKey);
    A.downAt = null;
  }
  function startGrip(gh) {
    A.gripTarget = gh; E.run('GRIPEDIT');
  }
  function onWheel(ev) { ev.preventDefault(); const [sx, sy] = screenOf(ev); V.zoomAt(Math.pow(1.0018, -ev.deltaY * (ev.deltaMode ? 30 : 1)), sx, sy); onMove(ev); }
  function onDbl(ev) {
    const [sx, sy] = screenOf(ev);
    if (ev.button === 1) { V.zoomExtents(); return; }
    if (E.pending || A.space !== 'model') return;
    const e = V.pick(sx, sy); if (!e) return;
    if (e.type === 'text' || e.type === 'mtext' || e.type === 'dim') { A.selSet = new Set(); E.run('TEXTEDIT').then(() => { }); setTimeout(() => { if (E.pending && E.pending.kind === 'ent') E.click(V.s2w(sx, sy), ev, [sx, sy]); }, 0); }
    else { A.selSet = new Set([e.id]); refresh(); }
  }

  /* ======================= keyboard ======================= */
  function onKey(ev) {
    if (document.querySelector('.aero-modal')) return;
    const inp = $('cmdIn'), t = ev.target, inCmd = t === inp;
    const typing = !inCmd && t.matches && t.matches('input,textarea,select,[contenteditable=true]');
    if (typing) return;
    if (inCmd) {
      const sugOpen = !$('suggest').hidden;
      if (ev.key === 'Enter' || (ev.key === ' ' && !(E.pending && E.pending.kind === 'string'))) {
        ev.preventDefault();
        if (sugOpen && sugIdx >= 0) { const n = $('suggest').children[sugIdx].dataset.n; inp.value = n; }
        submitInput(); return;
      }
      if (ev.key === 'Escape') { ev.preventDefault(); inp.value = ''; hideSuggest(); escape(); return; }
      if (ev.key === 'Tab') { ev.preventDefault(); const s = suggestions(inp.value); if (s.length) { inp.value = s[Math.max(0, sugIdx)].n; hideSuggest(); } return; }
      if (ev.key === 'ArrowDown' && sugOpen) { ev.preventDefault(); sugIdx++; showSuggest(); return; }
      if (ev.key === 'ArrowUp' && sugOpen) { ev.preventDefault(); sugIdx = Math.max(-1, sugIdx - 1); showSuggest(); return; }
      if (ev.key === 'ArrowUp' && !inp.value.length && cmdHistory.length) { ev.preventDefault(); histIdx = Math.max(0, histIdx - 1); inp.value = cmdHistory[histIdx] || ''; return; }
      if (ev.key === 'ArrowDown' && cmdHistory.length) { ev.preventDefault(); histIdx = Math.min(cmdHistory.length, histIdx + 1); inp.value = cmdHistory[histIdx] || ''; return; }
      const fk = { F3: 'osnapOn', F7: 'grid', F8: 'ortho', F9: 'snapOn', F10: 'polar' }[ev.key];
      if (fk) { ev.preventDefault(); toggle(fk); return; }
      if ((ev.ctrlKey || ev.metaKey) && !inp.value) {
        const k = ev.key.toLowerCase(), f = { z: undo, y: redo, a: ui.selectAll, c: () => copyClip(), v: () => E.run('PASTECLIP') }[k];
        if (f) { ev.preventDefault(); f(); }
      }
      return;
    }
    if (ev.key === 'Escape') { ev.preventDefault(); escape(); return; }
    if ((ev.key === 'Enter' || ev.key === ' ') && !ev.ctrlKey && !ev.altKey) { ev.preventDefault(); E.enter(); return; }
    if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) { inp.focus(); }
  }
  function escape() {
    if (winStart) { winStart = null; A.winSel = null; V.overlay(); return; }
    if (E.cancel()) return;
    if (A.selSet.size) { A.selSet = new Set(); refresh(); }
  }

  /* ======================= grips ======================= */
  function registerGrip() {
    E.REG.GRIPEDIT = { name: 'GRIPEDIT', aliases: [], hidden: true, desc: 'Grip edit', label: 'Grip edit', noRepeat: true, keepSel: true, fn: async C => {
      const { ent, grip } = A.gripTarget; A.gripTarget = null; const base = [grip.x, grip.y];
      gripDrag = true;
      try {
        const r = await C.point('Specify stretch point', { base, preview: q => { const n = grip.fn(q); return M.validEnt(n) ? [n] : []; } });
        const n = grip.fn(r.pt); if (M.validEnt(n)) C.update(ent, n);
      } finally { gripDrag = null; }
    } };
    E.ALIAS.GRIPEDIT = 'GRIPEDIT';
  }

  /* ======================= properties palette ======================= */
  const TYPE_NAME = { line: 'Line', pline: 'Polyline', circle: 'Circle', arc: 'Arc', point: 'Point', text: 'Text', mtext: 'MText', insert: 'Block Reference', dim: 'Dimension', hatch: 'Hatch', solid: 'Solid' };
  const DIM_NAME = { lin: 'Linear', ali: 'Aligned', rad: 'Radius', dia: 'Diameter', ang: 'Angular' };
  const f4 = v => E.f4(v);
  function colorOptions(sel, withBy = true) {
    const opts = (withBy ? [[256, 'ByLayer'], [0, 'ByBlock']] : []).concat([1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => [i, M.colorName(i)]));
    if (sel != null && !opts.some(o => o[0] === sel)) opts.push([sel, M.colorName(sel)]);
    return opts.map(([v, t]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${esc(t)}</option>`).join('') + `<option value="other">Select colour…</option>`;
  }
  const ltNames = () => [...Object.keys(M.LTYPES), ...Object.keys(A.doc.ltypes || {})];
  function ltOptions(sel, withBy = true) { return (withBy ? ['BYLAYER', 'BYBLOCK'] : []).concat(ltNames()).map(n => `<option value="${n}" ${n === sel ? 'selected' : ''}>${n === 'BYLAYER' ? 'ByLayer' : n === 'BYBLOCK' ? 'ByBlock' : n}</option>`).join(''); }
  const lwText = v => v === -1 ? 'ByLayer' : v === -2 ? 'ByBlock' : v === -3 ? 'Default' : (v / 100).toFixed(2) + ' mm';
  function lwOptions(sel, withBy = true) { return (withBy ? [-1, -2] : []).concat([-3, ...M.LWEIGHTS]).map(v => `<option value="${v}" ${v === sel ? 'selected' : ''}>${lwText(v)}</option>`).join(''); }
  const common = (ents, f) => { const v = ents.map(f); return v.every(x => x === v[0]) ? v[0] : undefined; };
  function renderProps() {
    const el = $('props'), ents = selEnts();
    $('propCount').textContent = ents.length ? ents.length + ' selected' : '';
    if (!ents.length) {
      $('propTitle').textContent = 'Drawing';
      const ext = M.extents(A.doc);
      el.innerHTML = `<div class="pgrid"><div class="sec">General</div>
        <label>Objects</label><span class="ro">${A.doc.ents.length}</span>
        <label>Units</label><select data-d="units">${['mm', 'cm', 'm', 'in', 'ft'].map(u => `<option ${u === A.doc.units ? 'selected' : ''}>${u}</option>`).join('')}</select>
        <label>Extents</label><span class="ro">${ext ? `${f4(ext[2] - ext[0])} × ${f4(ext[3] - ext[1])}` : '—'}</span>
        <label>LT scale</label><input data-d="ltscale" type="number" step="0.1" min="0.001" value="${A.doc.ltscale}">
        <label>Text height</label><input data-d="textH" type="number" step="0.5" min="0.01" value="${A.doc.textH}">
        <label>Dim scale</label><input data-d="dimscale" type="number" step="0.5" min="0.01" value="${A.doc.dimstyle.scale}">
        <div class="sec">Blocks</div>
        <span class="ro" style="grid-column:1/-1">${Object.keys(A.doc.blocks).filter(k => !k.startsWith('*')).map(esc).join(', ') || 'None'}</span></div>`;
      el.querySelectorAll('[data-d]').forEach(i => i.onchange = () => {
        const k = i.dataset.d, v = i.value;
        if (k === 'units') A.doc.units = v; else if (k === 'dimscale') { if (+v > 0) A.doc.dimstyle.scale = +v; } else if (+v > 0) A.doc[k] = +v;
        commit('Drawing settings');
      });
      return;
    }
    const types = [...new Set(ents.map(e => e.type))];
    $('propTitle').textContent = types.length === 1 ? TYPE_NAME[types[0]] + (types[0] === 'dim' && ents.length === 1 ? ' · ' + DIM_NAME[ents[0].dt] : '') : 'All (' + ents.length + ')';
    const lay = common(ents, e => e.layer), col = common(ents, e => e.color ?? 256), lt = common(ents, e => e.lt || 'BYLAYER'), lw = common(ents, e => e.lw ?? -1);
    let h = `<div class="pgrid"><div class="sec">General</div>
      <label>Layer</label><select data-g="layer">${lay === undefined ? '<option value="">*varies*</option>' : ''}${A.doc.layers.map(l => `<option ${l.name === lay ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
      <label>Color</label><select data-g="color">${col === undefined ? '<option value="">*varies*</option>' : ''}${colorOptions(col)}</select>
      <label>Linetype</label><select data-g="lt">${lt === undefined ? '<option value="">*varies*</option>' : ''}${ltOptions(lt)}</select>
      <label>Lineweight</label><select data-g="lw">${lw === undefined ? '<option value="">*varies*</option>' : ''}${lwOptions(lw)}</select>
      <label>LT scale</label><input data-g="lts" type="number" step="0.1" min="0.001" value="${common(ents, e => e.lts || 1) ?? ''}">`;
    if (ents.length === 1) h += geomFields(ents[0]);
    else if (types.length === 1 && (types[0] === 'text' || types[0] === 'mtext')) h += `<div class="sec">Text</div><label>Height</label><input data-f="h" type="number" step="0.5" value="${common(ents, e => e.h) ?? ''}">`;
    el.innerHTML = h + '</div>';
    el.querySelectorAll('[data-g]').forEach(i => i.onchange = async () => {
      const k = i.dataset.g; let v = i.value; if (v === '') return;
      if (k === 'color') { if (v === 'other') { const c = await colorPicker(col ?? 7); if (c == null) return renderProps(); v = c; } else v = +v; }
      if (k === 'lw') v = +v; if (k === 'lts') { v = +v; if (!(v > 0)) return; }
      editSel('Change ' + k, e => { if ((k === 'color' && v === 256) || (k === 'lt' && v === 'BYLAYER') || (k === 'lw' && v === -1) || (k === 'lts' && v === 1)) delete e[k]; else e[k] = v; });
    });
    el.querySelectorAll('[data-f]').forEach(i => i.onchange = () => {
      const k = i.dataset.f, raw = i.type === 'checkbox' ? i.checked : i.value, ang = i.dataset.a === '1';
      editSel('Edit ' + k, e => setField(e, k, raw, ang));
    });
  }
  const numIn = (k, v, ang, step = 'any') => `<input data-f="${k}" ${ang ? 'data-a="1"' : ''} type="number" step="${step}" value="${+(+(ang ? v * R2D : v)).toFixed(6)}">`;
  function geomFields(e) {
    const ro = (l, v) => `<label>${l}</label><span class="ro">${v}</span>`, row = (l, k, v, ang) => `<label>${l}</label>${numIn(k, v, ang)}`;
    let h = '<div class="sec">Geometry</div>';
    switch (e.type) {
      case 'line': h += row('Start X', 'x1', e.x1) + row('Start Y', 'y1', e.y1) + row('End X', 'x2', e.x2) + row('End Y', 'y2', e.y2) + ro('Length', f4(G.entLength(e))) + ro('Angle', E.fa(G.ang(e.x2 - e.x1, e.y2 - e.y1))) + ro('Delta X / Y', `${f4(e.x2 - e.x1)} / ${f4(e.y2 - e.y1)}`); break;
      case 'circle': h += row('Center X', 'cx', e.cx) + row('Center Y', 'cy', e.cy) + row('Radius', 'r', e.r) + row('Diameter', 'dia', e.r * 2) + ro('Circumference', f4(2 * Math.PI * e.r)) + ro('Area', f4(Math.PI * e.r * e.r)); break;
      case 'arc': h += row('Center X', 'cx', e.cx) + row('Center Y', 'cy', e.cy) + row('Radius', 'r', e.r) + row('Start angle', 'a1', e.a1, true) + row('End angle', 'a2', e.a2, true) + ro('Total angle', E.fa(G.arcSweep(e.a1, e.a2))) + ro('Arc length', f4(G.entLength(e))); break;
      case 'pline': h += ro('Vertices', e.pts.length) + `<label>Closed</label><input data-f="closed" type="checkbox" ${e.closed ? 'checked' : ''}>` + row('Global width', 'w', e.w || 0) + ro('Length', f4(G.entLength(e))) + (e.closed ? ro('Area', f4(Math.abs(G.loopArea(e.pts)))) : ''); break;
      case 'point': h += row('Position X', 'x', e.x) + row('Position Y', 'y', e.y); break;
      case 'text': h += `<label>Contents</label><input data-f="s" type="text" value="${esc(e.s)}">` + row('Height', 'h', e.h) + row('Rotation', 'rot', e.rot || 0, true) + row('Position X', 'x', e.x) + row('Position Y', 'y', e.y) + `<label>Justify</label><select data-f="just">${[['0,0', 'Left'], ['1,0', 'Center'], ['2,0', 'Right'], ['1,2', 'Middle'], ['0,3', 'Top left'], ['1,3', 'Top center'], ['2,3', 'Top right'], ['0,2', 'Middle left'], ['2,2', 'Middle right'], ['0,1', 'Bottom left'], ['1,1', 'Bottom center'], ['2,1', 'Bottom right']].map(([v, t]) => `<option value="${v}" ${v === `${e.align || 0},${e.valign || 0}` ? 'selected' : ''}>${t}</option>`).join('')}</select>`; break;
      case 'mtext': h += `<label>Contents</label><textarea data-f="s" rows="3">${esc(e.s)}</textarea>` + row('Height', 'h', e.h) + row('Width', 'w', e.w || 0) + row('Rotation', 'rot', e.rot || 0, true) + row('Position X', 'x', e.x) + row('Position Y', 'y', e.y) + `<label>Attachment</label><select data-f="attach">${['Top left', 'Top center', 'Top right', 'Middle left', 'Middle center', 'Middle right', 'Bottom left', 'Bottom center', 'Bottom right'].map((t, i) => `<option value="${i + 1}" ${i + 1 === (e.attach || 1) ? 'selected' : ''}>${t}</option>`).join('')}</select>`; break;
      case 'insert': h += ro('Name', esc(e.name)) + row('Position X', 'x', e.x) + row('Position Y', 'y', e.y) + row('Scale X', 'sx', e.sx ?? 1) + row('Scale Y', 'sy', e.sy ?? 1) + row('Rotation', 'rot', e.rot || 0, true); break;
      case 'dim': h += ro('Type', DIM_NAME[e.dt]) + ro('Measurement', esc(M.dimText({ ...e, txt: null }, A.doc.dimstyle))) + `<label>Text override</label><input data-f="txt" type="text" placeholder="&lt;&gt; = measured" value="${esc(e.txt ?? '')}">` + (e.dt === 'lin' ? row('Rotation', 'ang', e.ang || 0, true) : ''); break;
      case 'hatch': h += `<label>Pattern</label><select data-f="pat">${Object.keys(M.PATTERNS).map(p => `<option ${p === e.pat ? 'selected' : ''}>${p}</option>`).join('')}</select>` + row('Scale', 'sc', e.sc || 1) + row('Angle', 'ang', e.ang || 0, true) + ro('Boundaries', e.loops.length) + ro('Area', f4(e.loops.reduce((s, l, i) => s + (i ? -1 : 1) * Math.abs(G.loopArea(l.pts)), 0))); break;
    }
    return h;
  }
  function setField(e, k, raw, ang) {
    if (k === 's') { e.s = String(raw); if (e.type === 'text') e.s = e.s.split('\n')[0]; return e; }
    if (k === 'txt') { e.txt = raw === '' ? null : String(raw); return e; }
    if (k === 'pat') { e.pat = raw; return e; }
    if (k === 'closed') { e.closed = !!raw; return e; }
    if (k === 'just') { const [a, b] = String(raw).split(',').map(Number); e.align = a; e.valign = b; return e; }
    if (k === 'attach') { e.attach = +raw; return e; }
    let v = parseFloat(raw); if (!Number.isFinite(v)) return e;
    if (ang) v = G.normA(v * D2R);
    if (k === 'dia') { if (v > 0) e.r = v / 2; return e; }
    if ((k === 'r' || k === 'h' || k === 'sc') && !(v > 0)) return e;
    if ((k === 'sx' || k === 'sy') && v === 0) return e;
    if (k === 'w' && v < 0) return e;
    e[k] = v; return e;
  }
  function describe(e) {
    const L = `${TYPE_NAME[e.type]}  Layer: "${e.layer}"  Color: ${M.colorName(e.color)}  Linetype: ${e.lt || 'BYLAYER'}`;
    switch (e.type) {
      case 'line': return `${L}\n   from ${f4(e.x1)},${f4(e.y1)} to ${f4(e.x2)},${f4(e.y2)}  Length = ${f4(G.entLength(e))}  Angle = ${E.fa(G.ang(e.x2 - e.x1, e.y2 - e.y1))}`;
      case 'circle': return `${L}\n   center ${f4(e.cx)},${f4(e.cy)}  radius ${f4(e.r)}  circumference ${f4(2 * Math.PI * e.r)}  area ${f4(Math.PI * e.r * e.r)}`;
      case 'arc': return `${L}\n   center ${f4(e.cx)},${f4(e.cy)}  radius ${f4(e.r)}  start ${E.fa(e.a1)}  end ${E.fa(e.a2)}  length ${f4(G.entLength(e))}`;
      case 'pline': return `${L}\n   ${e.closed ? 'Closed' : 'Open'}, ${e.pts.length} vertices, length ${f4(G.entLength(e))}${e.closed ? ', area ' + f4(Math.abs(G.loopArea(e.pts))) : ''}`;
      case 'text': case 'mtext': return `${L}\n   at ${f4(e.x)},${f4(e.y)}  height ${f4(e.h)}  "${e.s.replace(/\n/g, ' ⏎ ')}"`;
      case 'insert': return `${L}\n   block "${e.name}" at ${f4(e.x)},${f4(e.y)}  scale ${f4(e.sx ?? 1)},${f4(e.sy ?? 1)}  rotation ${E.fa(e.rot || 0)}`;
      case 'dim': return `${L}\n   ${DIM_NAME[e.dt]} dimension, text "${M.dimText(e, A.doc.dimstyle)}"`;
      case 'hatch': return `${L}\n   pattern ${e.pat}, scale ${f4(e.sc || 1)}, ${e.loops.length} boundaries`;
      case 'point': return `${L}\n   at ${f4(e.x)},${f4(e.y)}`;
    }
    return L;
  }

  /* ======================= layers panel ======================= */
  let layerSelName = null;
  function renderLayers() {
    const el = $('layers'); el.innerHTML = '';
    $('layerCount').textContent = A.doc.layers.length;
    const counts = {}; A.doc.ents.forEach(e => counts[e.layer] = (counts[e.layer] || 0) + 1);
    A.doc.layers.forEach(l => {
      const c = M.ACI[l.color] || M.ACI[7], d = Aero.el('div', 'aero-item lrow' + (l.name === layerSelName ? ' sel' : '') + (!l.on || l.frozen ? ' hidden' : ''));
      d.innerHTML = `<span class="cur" title="Current layer">${l.name === A.doc.cur ? '✓' : ''}</span>
        <span class="ic ${l.on ? '' : 'off'}" data-t="on" title="On / off">${l.on ? '●' : '○'}</span>
        <span class="ic ${l.frozen ? '' : 'off'}" data-t="frozen" title="Freeze / thaw">❄</span>
        <span class="ic ${l.locked ? '' : 'off'}" data-t="locked" title="Lock / unlock">${l.locked ? '🔒' : '🔓'}</span>
        <span class="sw" data-t="color" title="${esc(M.colorName(l.color))}" style="background:rgb(${c.join(',')})"></span>
        <span class="nm" title="${esc(l.name)} · ${counts[l.name] || 0} objects">${esc(l.name)}</span><span class="lt" title="${esc(l.lt)} · ${lwText(l.lw)}">${esc(l.lt === 'CONTINUOUS' ? 'Continuous' : l.lt)}</span>`;
      d.onclick = async ev => {
        const t = ev.target.dataset.t; layerSelName = l.name;
        if (t === 'on' || t === 'frozen' || t === 'locked') {
          if (t !== 'locked' && l.name === A.doc.cur && (t === 'frozen' ? !l.frozen : l.on)) { if (t === 'frozen') return Aero.toast('Cannot freeze the current layer'); }
          l[t] = !l[t]; commit(`Layer ${l.name} ${t}`); return;
        }
        if (t === 'color') { const cc = await colorPicker(l.color, false); if (cc != null && cc !== l.color) { l.color = cc; commit('Layer colour'); } return; }
        renderLayers();
      };
      d.ondblclick = ev => { if (!ev.target.dataset.t) { A.doc.cur = l.name; commit('Set current layer'); } };
      el.appendChild(d);
    });
  }
  async function newLayer() {
    let n = 1; while (A.doc.layers.some(l => l.name === 'Layer' + n)) n++;
    const name = await Aero.prompt('New layer', 'Layer name', 'Layer' + n); if (name == null) return;
    const nm = name.trim(); if (!nm || /[<>\/\\":;?*|=,`]/.test(nm)) return Aero.toast('Invalid layer name');
    if (A.doc.layers.some(l => l.name.toUpperCase() === nm.toUpperCase())) return Aero.toast('A layer with that name already exists');
    A.doc.layers.push({ name: nm, color: 7, lt: 'CONTINUOUS', lw: -3, on: true, frozen: false, locked: false, plot: true }); A.doc.cur = nm; layerSelName = nm; commit('New layer');
  }
  function deleteLayer() {
    const nm = layerSelName; if (!nm) return Aero.toast('Click a layer first');
    if (nm === '0') return Aero.toast('Layer 0 cannot be deleted');
    if (nm === A.doc.cur) return Aero.toast('Cannot delete the current layer');
    const used = A.doc.ents.some(e => e.layer === nm) || Object.values(A.doc.blocks).some(b => b.ents.some(e => e.layer === nm));
    if (used) return Aero.toast('Layer is not empty — move or erase its objects first');
    A.doc.layers = A.doc.layers.filter(l => l.name !== nm); layerSelName = null; commit('Delete layer');
  }
  function layerDialog() {
    const L = A.doc.layers.map(l => ({ ...l }));
    const rows = () => L.map((l, i) => `<tr class="${l.name === A.doc.cur ? 'cur' : ''}"><td><input data-i="${i}" data-k="name" value="${esc(l.name)}" ${l.name === '0' ? 'disabled' : ''}></td>
      <td><input type="checkbox" data-i="${i}" data-k="on" ${l.on ? 'checked' : ''}></td><td><input type="checkbox" data-i="${i}" data-k="frozen" ${l.frozen ? 'checked' : ''}></td><td><input type="checkbox" data-i="${i}" data-k="locked" ${l.locked ? 'checked' : ''}></td>
      <td><select data-i="${i}" data-k="color">${colorOptions(l.color, false)}</select></td><td><select data-i="${i}" data-k="lt">${ltOptions(l.lt, false)}</select></td><td><select data-i="${i}" data-k="lw">${lwOptions(l.lw, false)}</select></td>
      <td><input type="checkbox" data-i="${i}" data-k="plot" ${l.plot !== false ? 'checked' : ''}></td><td><input type="radio" name="lcur" data-i="${i}" data-k="cur" ${l.name === A.doc.cur ? 'checked' : ''}></td></tr>`).join('');
    let cur = A.doc.cur;
    const dlg = Aero.dialog({ title: 'Layer Properties Manager', width: 760, instruction: 'Edit layers. Colour, linetype and lineweight apply to every ByLayer object on the layer.',
      html: `<div class="scrollbox"><table class="ltab"><thead><tr><th>Name</th><th>On</th><th>Freeze</th><th>Lock</th><th>Color</th><th>Linetype</th><th>Lineweight</th><th>Plot</th><th>Current</th></tr></thead><tbody id="ltb">${rows()}</tbody></table></div>`,
      onOK: () => {
        const ren = {}; const names = new Set();
        for (const [i, l] of L.entries()) { const nm = String(l.name).trim(); if (!nm || names.has(nm.toUpperCase())) { Aero.toast('Layer names must be unique and non-empty'); return; } names.add(nm.toUpperCase()); if (nm !== A.doc.layers[i].name) ren[A.doc.layers[i].name] = nm; l.name = nm; }
        A.doc.layers = L.map(l => ({ ...l }));
        if (Object.keys(ren).length) { A.doc.ents = A.doc.ents.map(e => ren[e.layer] ? { ...e, layer: ren[e.layer] } : e); Object.values(A.doc.blocks).forEach(b => b.ents.forEach(e => { if (ren[e.layer]) e.layer = ren[e.layer]; })); }
        A.doc.cur = ren[cur] || cur; commit('Layer properties');
      } });
    const tb2 = dlg.el.querySelector('#ltb');
    tb2.addEventListener('change', async ev => {
      const t = ev.target, i = +t.dataset.i, k = t.dataset.k; if (!L[i]) return;
      if (k === 'cur') { cur = L[i].name; return; }
      if (k === 'color') { if (t.value === 'other') { const c = await colorPicker(L[i].color, false); if (c != null) L[i].color = c; tb2.innerHTML = rows(); return; } L[i].color = +t.value; return; }
      if (k === 'lw') L[i].lw = +t.value; else if (t.type === 'checkbox') L[i][k] = t.checked; else L[i][k] = t.value;
    });
  }
  function colorPicker(cur, withBy = true) {
    return new Promise(res => {
      let val = cur;
      const sw = i => `rgb(${M.ACI[i].join(',')})`;
      let grid = ''; for (let i = 10; i <= 249; i++) { const col = Math.floor((i - 10) / 10), row = (i - 10) % 10; grid += `<i data-c="${i}" title="Color ${i}" style="background:${sw(i)};grid-column:${col + 1};grid-row:${row + 1}"></i>`; }
      const std = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => `<i data-c="${i}" title="${M.colorName(i)}" style="background:${sw(i)}"></i>`).join('') + ' ' + [250, 251, 252, 253, 254, 255].map(i => `<i data-c="${i}" title="Color ${i}" style="background:${sw(i)}"></i>`).join('');
      const dlg = Aero.dialog({ title: 'Select Color', width: 420, instruction: 'AutoCAD Color Index (ACI)', fields: [{ key: 'v', label: 'Color', type: 'text', value: String(cur ?? 7) }],
        html: `<div class="aci-grid">${grid}</div><div class="aci-std">${std}</div>${withBy ? '<div class="aci-std"><button class="aero-btn small" data-c="256">ByLayer</button><button class="aero-btn small" data-c="0">ByBlock</button></div>' : ''}`,
        onOK: v => { const t = String(v.v).trim().toLowerCase(); const n = t === 'bylayer' ? 256 : t === 'byblock' ? 0 : parseInt(t, 10); res(Number.isInteger(n) && n >= (withBy ? 0 : 1) && n <= (withBy ? 256 : 255) ? n : null); }, onCancel: () => res(null) });
      dlg.el.addEventListener('click', ev => { const c = ev.target.dataset && ev.target.dataset.c; if (c != null) { val = +c; dlg.set('v', c === '256' ? 'ByLayer' : c === '0' ? 'ByBlock' : c); dlg.el.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x.dataset.c === c)); } });
      dlg.el.addEventListener('dblclick', ev => { if (ev.target.dataset && ev.target.dataset.c != null) dlg.el.querySelector('[data-a=o]').click(); });
    });
  }

  /* ======================= command bar / status ======================= */
  function renderBars() {
    const ents = selEnts(), isL = A.space === 'layout';
    $('propBar').hidden = isL; $('layoutBar').hidden = !isL;
    const lay = ents.length ? common(ents, e => e.layer) : A.doc.cur;
    $('layerSel').innerHTML = (lay === undefined ? '<option value="">*varies*</option>' : '') + A.doc.layers.map(l => `<option ${l.name === lay ? 'selected' : ''} value="${esc(l.name)}">${esc(l.name)}${l.on ? '' : ' (off)'}</option>`).join('');
    const col = ents.length ? common(ents, e => e.color ?? 256) : A.curColor;
    $('colorSel').innerHTML = (col === undefined ? '<option value="">*varies*</option>' : '') + colorOptions(col);
    const lt = ents.length ? common(ents, e => e.lt || 'BYLAYER') : A.curLt;
    $('ltSel').innerHTML = (lt === undefined ? '<option value="">*varies*</option>' : '') + ltOptions(lt);
    const lw = ents.length ? common(ents, e => e.lw ?? -1) : A.curLw;
    $('lwSel').innerHTML = (lw === undefined ? '<option value="">*varies*</option>' : '') + lwOptions(lw);
    if (isL) {
      const L = A.doc.layout;
      $('paperSel').innerHTML = Object.keys(M.PAPERS).map(p => `<option ${p === L.paper ? 'selected' : ''}>${p}</option>`).join('');
      const sc = M.SCALES.slice(); if (!sc.some(s => s[0] === L.scale[0] && s[1] === L.scale[1])) sc.push(L.scale);
      $('scaleSel').innerHTML = sc.map(s => `<option value="${s[0]}:${s[1]}" ${s[0] === L.scale[0] && s[1] === L.scale[1] ? 'selected' : ''}>${s[0]}:${s[1]}</option>`).join('') + '<option value="custom">Custom…</option>';
    }
    $('hint').textContent = E.running() ? '' : hintIdle();
  }
  const hintIdle = () => A.space === 'layout' ? 'Drag to pan · wheel to zoom · Plot exports this sheet at true scale' : 'Type a command · wheel zooms · middle-drag pans · drag a window to select';
  async function onPropBar(k, v) {
    const ents = selEnts();
    if (k === 'color' && v === 'other') { const c = await colorPicker(ents.length ? (common(ents, e => e.color ?? 256) ?? 7) : A.curColor); if (c == null) return renderBars(); v = c; }
    if (v === '') return;
    if (ents.length) {
      if (k === 'layer') editSel('Change layer', e => { e.layer = v; });
      else { const val = k === 'lt' ? v : +v; editSel('Change ' + k, e => { if ((k === 'color' && val === 256) || (k === 'lt' && val === 'BYLAYER') || (k === 'lw' && val === -1)) delete e[k]; else e[k] = val; }); }
      return;
    }
    if (k === 'layer') { A.doc.cur = v; commit('Set current layer'); }
    else if (k === 'color') { A.curColor = +v; renderBars(); }
    else if (k === 'lt') { A.curLt = v; renderBars(); }
    else if (k === 'lw') { A.curLw = +v; renderBars(); }
  }
  const TOGGLES = [['GRID', 'grid', 'F7', 'Grid display'], ['SNAP', 'snapOn', 'F9', 'Snap to grid'], ['ORTHO', 'ortho', 'F8', 'Ortho mode'], ['POLAR', 'polar', 'F10', 'Polar tracking'], ['OSNAP', 'osnapOn', 'F3', 'Object snap'], ['LWT', 'lwt', '', 'Show lineweights']];
  function renderStatus() {
    $('toggles').innerHTML = TOGGLES.map(([lab, k, key, tip]) => `<button class="tg ${A[k] ? 'on' : ''}" data-k="${k}" title="${tip}${key ? ' (' + key + ')' : ''}">${lab}</button>`).join('');
    document.querySelectorAll('.stab').forEach(b => b.classList.toggle('on', b.dataset.s === A.space));
    $('st2').textContent = `${A.doc.ents.length} objects · ${A.doc.units}`;
    $('stage').classList.toggle('layout', A.space === 'layout');
  }
  function toggle(k) {
    A[k] = !A[k];
    if (k === 'ortho' && A.ortho) A.polar = false; if (k === 'polar' && A.polar) A.ortho = false;
    const nm = TOGGLES.find(t => t[1] === k)[0]; echo(`<${nm[0] + nm.slice(1).toLowerCase()} ${A[k] ? 'on' : 'off'}>`);
    renderStatus(); V.draw(); if (A.lastMouse) onMove(A.lastMouse, true); savePrefs();
  }
  function setSpace(s) {
    if (A.space === s) return;
    if (E.running() && s === 'layout') E.cancel();
    A.space = s; A.selSet = new Set();
    if (s === 'layout' && !A.layoutViewed) { A.layoutViewed = true; V.zoomExtents(); }
    refresh(); V.draw();
  }

  /* ======================= dialogs ======================= */
  function textDialog({ s, h, title, single }) {
    return new Promise(res => Aero.dialog({ title, width: 460, fields: [{ key: 's', label: 'Text', type: single ? 'text' : 'textarea', value: s, rows: 6 }, { key: 'h', label: 'Height', type: 'number', value: h, min: 0.01, step: 0.5 }],
      onOK: v => res(v.h > 0 ? { s: String(v.s), h: v.h } : { s: String(v.s), h }), onCancel: () => res(null) }));
  }
  function insertDialog(names) {
    return new Promise(res => Aero.dialog({ title: 'Insert Block', fields: [{ key: 'name', label: 'Block', type: 'select', options: names, value: A.lastBlock && names.includes(A.lastBlock) ? A.lastBlock : names[0] }, { key: 'sx', label: 'Scale X', type: 'number', value: 1, step: 0.1 }, { key: 'sy', label: 'Scale Y', type: 'number', value: 1, step: 0.1 }, { key: 'rot', label: 'Rotation (°)', type: 'number', value: 0, step: 15 }, { key: 'repeat', label: 'Place several', type: 'checkbox', value: false }],
      ok: 'Place', onOK: v => { A.lastBlock = v.name; res({ ...v, sx: v.sx || 1, sy: v.sy || 1, rot: v.rot || 0 }); }, onCancel: () => res(null) }));
  }
  function dimStyleDialog() {
    const ds = A.doc.dimstyle;
    return new Promise(res => Aero.dialog({ title: 'Dimension Style — STANDARD', instruction: 'Sizes are in drawing units before the overall scale is applied.', fields: [
      { key: 'txt', label: 'Text height', type: 'number', value: ds.txt, step: 0.25, min: 0.01 }, { key: 'asz', label: 'Arrow size', type: 'number', value: ds.asz, step: 0.25, min: 0 },
      { key: 'exo', label: 'Extension offset', type: 'number', value: ds.exo, step: 0.125, min: 0 }, { key: 'exe', label: 'Extend beyond', type: 'number', value: ds.exe, step: 0.125, min: 0 },
      { key: 'gap', label: 'Text gap', type: 'number', value: ds.gap, step: 0.125, min: 0 }, { key: 'dec', label: 'Decimals', type: 'number', value: ds.dec, step: 1, min: 0, max: 8 },
      { key: 'scale', label: 'Overall scale', type: 'number', value: ds.scale, step: 0.5, min: 0.01 }],
      onOK: v => { const n = { ...ds }; for (const k of Object.keys(v)) if (Number.isFinite(v[k]) && v[k] >= 0) n[k] = k === 'dec' ? Math.min(8, Math.round(v[k])) : v[k]; if (!(n.txt > 0)) n.txt = ds.txt; if (!(n.scale > 0)) n.scale = ds.scale; A.doc.dimstyle = n; E.C.changed(); A.cmdChanged = true; if (!E.running()) commit('Dimension style'); res(); }, onCancel: () => res() }));
  }
  function draftingDialog() {
    const o = A.osnap;
    return new Promise(res => Aero.dialog({ title: 'Drafting Settings', width: 420, fields: [
      { key: 'osnapOn', label: 'Object snap on (F3)', type: 'checkbox', value: A.osnapOn },
      ...[['end', 'Endpoint'], ['mid', 'Midpoint'], ['cen', 'Center'], ['quad', 'Quadrant'], ['int', 'Intersection'], ['perp', 'Perpendicular'], ['tan', 'Tangent'], ['nea', 'Nearest'], ['node', 'Node'], ['ins', 'Insertion']].map(([k, l]) => ({ key: 'o_' + k, label: '   ' + l, type: 'checkbox', value: o[k] })),
      { key: 'polar', label: 'Polar tracking (F10)', type: 'checkbox', value: A.polar }, { key: 'polarInc', label: 'Polar increment (°)', type: 'select', options: ['5', '10', '15', '18', '22.5', '30', '45', '90'], value: String(A.polarInc) },
      { key: 'snapOn', label: 'Snap to grid (F9)', type: 'checkbox', value: A.snapOn }, { key: 'gridStep', label: 'Grid / snap spacing', type: 'number', value: A.gridStep, min: 0.001, step: 1 }],
      onOK: v => { A.osnapOn = v.osnapOn; for (const k of Object.keys(o)) o[k] = v['o_' + k]; A.polar = v.polar; if (A.polar) A.ortho = false; A.polarInc = +v.polarInc || 45; A.snapOn = v.snapOn; if (v.gridStep > 0) A.gridStep = v.gridStep; renderStatus(); V.draw(); savePrefs(); res(); }, onCancel: () => res() }));
  }
  function unitsDialog() {
    return new Promise(res => Aero.dialog({ title: 'Drawing Units', fields: [{ key: 'units', label: 'Insertion units', type: 'select', options: [['mm', 'Millimeters'], ['cm', 'Centimeters'], ['m', 'Meters'], ['in', 'Inches'], ['ft', 'Feet']], value: A.doc.units }, { key: 'prec', label: 'Display precision', type: 'select', options: ['0', '1', '2', '3', '4', '5', '6', '8'], value: String(A.prec) }],
      onOK: v => { A.prec = +v.prec; if (v.units !== A.doc.units) { A.doc.units = v.units; commit('Units'); } else refresh(); savePrefs(); res(); }, onCancel: () => res() }));
  }
  function hatchDialog() {
    const hs = A.hatch;
    return new Promise(res => {
      const names = Object.keys(M.PATTERNS);
      const dlg = Aero.dialog({ title: 'Hatch Settings', width: 470, fields: [{ key: 'pat', label: 'Pattern', type: 'select', options: names.map(n => [n, `${n} — ${M.PATTERNS[n].desc}`]), value: hs.pat }, { key: 'sc', label: 'Scale', type: 'number', value: hs.sc, step: 0.25, min: 0.01 }, { key: 'ang', label: 'Angle (°)', type: 'number', value: +(hs.ang * R2D).toFixed(3), step: 15 }],
        html: `<div class="pat-prev">${names.map(n => `<div data-p="${n}" class="${n === hs.pat ? 'on' : ''}"><canvas width="64" height="40"></canvas>${n}</div>`).join('')}</div>`,
        onOK: v => { if (M.PATTERNS[v.pat]) hs.pat = v.pat; if (v.sc > 0) hs.sc = v.sc; hs.ang = G.normA((v.ang || 0) * D2R); res(); }, onCancel: () => res() });
      dlg.el.querySelectorAll('.pat-prev div').forEach(d => {
        const c = d.querySelector('canvas'), g = c.getContext('2d'), pat = M.PATTERNS[d.dataset.p];
        g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 40); g.strokeStyle = '#123'; g.fillStyle = '#123'; g.lineWidth = 1;
        const loops = [{ pts: [[0, 0, 0], [64, 0, 0], [64, 40, 0], [0, 40, 0]] }];
        if (!pat.fams.length) g.fillRect(2, 2, 60, 36); else { g.beginPath(); for (const s of G.hatchLines(loops, pat.fams, 1.6, 0)) { g.moveTo(s[0], 40 - s[1]); g.lineTo(s[2] + (s[0] === s[2] && s[1] === s[3] ? 0.8 : 0), 40 - s[3]); } g.stroke(); }
        d.onclick = () => { dlg.set('pat', d.dataset.p); dlg.el.querySelectorAll('.pat-prev div').forEach(x => x.classList.toggle('on', x === d)); };
      });
    });
  }
  function pageDialog() {
    const L = A.doc.layout;
    return new Promise(res => Aero.dialog({ title: 'Page Setup — Layout1', width: 460, fields: [
      { key: 'paper', label: 'Paper size', type: 'select', options: Object.keys(M.PAPERS).map(p => [p, `${p} (${M.PAPERS[p][0]} × ${M.PAPERS[p][1]} mm)`]), value: L.paper },
      { key: 'scale', label: 'Plot scale (paper:drawing)', type: 'text', value: `${L.scale[0]}:${L.scale[1]}` },
      { key: 'tb', label: 'Title block', type: 'checkbox', value: L.tb },
      { key: 'title', label: 'Title', type: 'text', value: L.title }, { key: 'number', label: 'Drawing number', type: 'text', value: L.number }, { key: 'company', label: 'Company', type: 'text', value: L.company },
      { key: 'by', label: 'Drawn by', type: 'text', value: L.by }, { key: 'checked', label: 'Checked by', type: 'text', value: L.checked }, { key: 'date', label: 'Date', type: 'text', value: L.date || new Date().toISOString().slice(0, 10) },
      { key: 'rev', label: 'Revision', type: 'text', value: L.rev }, { key: 'sheet', label: 'Sheet', type: 'text', value: L.sheet }],
      onOK: v => {
        const m = String(v.scale).match(/^\s*([\d.]+)\s*[:\/=]\s*([\d.]+)\s*$/);
        const n = { ...L, ...v, scale: m && +m[1] > 0 && +m[2] > 0 ? [+m[1], +m[2]] : L.scale };
        A.doc.layout = n; commit('Page setup'); res();
      }, onCancel: () => res() }));
  }
  function exportDialog(fmt) {
    return new Promise(res => Aero.dialog({ title: 'Plot / Export', width: 440, instruction: 'Vector output at true scale. Layout1 prints the sheet with its title block; Model prints the drawing extents at the chosen scale.', fields: [
      { key: 'fmt', label: 'Format', type: 'select', options: [['pdf', 'PDF document'], ['svg', 'SVG drawing']], value: fmt || A.lastExport || 'pdf' },
      { key: 'src', label: 'What to plot', type: 'select', options: [['layout', `Layout1 (${A.doc.layout.paper}, ${A.doc.layout.scale.join(':')})`], ['model', 'Model space extents']], value: A.space === 'model' && A.lastSrc === 'model' ? 'model' : 'layout' },
      { key: 'scale', label: 'Model scale', type: 'select', options: M.SCALES.map(s => [`${s[0]}:${s[1]}`, `${s[0]}:${s[1]}`]), value: `${A.doc.layout.scale[0]}:${A.doc.layout.scale[1]}` },
      { key: 'mono', label: 'Monochrome (all black)', type: 'checkbox', value: !!A.lastMono }],
      ok: 'Export', onOK: async v => {
        A.lastExport = v.fmt; A.lastSrc = v.src; A.lastMono = v.mono;
        const sc = v.scale.split(':').map(Number), opts = { scale: sc, mono: v.mono, title: A.doc.layout.title };
        const base = Aero.baseName(A.docName) || 'drawing';
        try {
          if (v.fmt === 'pdf') await Aero.saveFile({ name: base + '.pdf', data: EX.toPDF(A.doc, v.src, opts), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
          else await Aero.saveFile({ name: base + '.svg', data: EX.toSVG(A.doc, v.src, opts), filters: [{ name: 'SVG', extensions: ['svg'] }] });
          Aero.toast('Exported ' + v.fmt.toUpperCase());
        } catch (e) { Aero.alert('Export failed', String(e.message || e)); }
        res();
      }, onCancel: () => res() }));
  }
  function copyClip(ents) {
    ents = ents || selEnts(); if (!ents.length) return Aero.toast('Select objects to copy');
    const b = M.extents(A.doc, ents) || [0, 0];
    A.clip = { base: [b[0], b[1]], ents: ents.map(e => { const o = JSON.parse(JSON.stringify(e)); delete o.id; return o; }) };
    Aero.toast(`${ents.length} object${ents.length > 1 ? 's' : ''} copied`);
  }
  function showCommands() {
    const rows = Object.values(E.REG).filter(r => !r.hidden).sort((a, b) => a.name.localeCompare(b.name)).map(r => `<tr><td>${r.name}${r.aliases.length ? ' · ' + r.aliases.join(', ') : ''}</td><td>${esc(r.desc)}</td></tr>`).join('');
    Aero.dialog({ title: 'Command Reference', width: 640, noCancel: true, instruction: 'Type a command or its alias in the command line and press Enter or Space. Enter on an empty line repeats the last command.', html: `<div class="scrollbox"><table class="keys">${rows}</table></div>` });
  }
  function showShortcuts() {
    const k = [['Enter / Space', 'Finish input · repeat the last command'], ['Esc', 'Cancel the command · clear the selection'], ['Right-click', 'Same as Enter'], ['Wheel · middle-drag', 'Zoom at cursor · pan'], ['Double-click middle', 'Zoom extents'], ['Alt + drag', 'Pan'],
      ['F3 / F7 / F8 / F9 / F10', 'Object snap / grid / ortho / snap / polar tracking'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+C / Ctrl+V', 'Copy / paste with base point'], ['Ctrl+A', 'Select all'], ['Delete', 'Erase selection'],
      ['Ctrl+1', 'Properties'], ['Ctrl+P', 'Plot / export PDF or SVG'], ['Shift + click', 'Remove from selection · extend while trimming'],
      ['100,50', 'Absolute coordinates'], ['@25,10', 'Relative to the last point'], ['@40<30', 'Relative polar: distance < angle'], ['25 (with a rubber band)', 'Direct distance along the cursor direction'],
      ['Window left→right', 'Selects objects fully inside'], ['Window right→left', 'Selects objects crossing the window']];
    Aero.dialog({ title: 'Keyboard Shortcuts & Input', width: 560, noCancel: true, html: `<table class="keys">${k.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('')}</table>` });
  }

  /* ======================= files ======================= */
  const DXF_FILTER = [{ name: 'DXF drawing', extensions: ['dxf'] }], LD_FILTER = [{ name: 'Lumen Draft drawing', extensions: ['ldraft'] }];
  function decodeDxf(buf) {
    const u8 = new Uint8Array(buf);
    let t = new TextDecoder('utf-8').decode(u8);
    if (t.includes('�') && !/\$DWGCODEPAGE\s*\n\s*3\s*\n\s*UTF-?8/i.test(t)) t = new TextDecoder('windows-1252').decode(u8);
    return t.replace(/^﻿/, '');
  }
  function parseFile(f) {
    const ext = (f.name.match(/\.([^.]+)$/) || [])[1]?.toLowerCase();
    if (ext === 'dxf') { const { doc, warnings } = X.readDXF(decodeDxf(f.data)); return { doc, warnings, fmt: doc.dxfVersion === 'AC1009' ? 'dxf12' : 'dxf' }; }
    if (ext === 'ldraft' || ext === 'json') {
      const j = JSON.parse(new TextDecoder().decode(new Uint8Array(f.data)));
      if (!j || j.app !== 'lumen-draft') throw new Error('Not a Lumen Draft drawing');
      return { doc: j, warnings: [], fmt: 'ldraft' };
    }
    throw new Error('Unsupported file type: ' + f.name);
  }
  async function openFiles(files) {
    const f = files && files[0]; if (!f) return;
    if (Aero.dirty && !(await Aero.confirm('Open drawing', 'Discard unsaved changes to ' + A.docName + '?', 'Discard'))) return;
    Aero.busy('Opening ' + f.name + '…');
    await new Promise(r => setTimeout(r, 20));
    try {
      const r = parseFile(f);
      load(r.doc, f.name, f.path, r.fmt);
      echo(`Opened ${f.name}: ${A.doc.ents.length} objects, ${A.doc.layers.length} layers.`);
      if (r.warnings.length) { echo('Note: ' + r.warnings.join('; ')); Aero.toast(r.warnings.join(' · '), 5000); }
    } catch (e) { console.warn(e); Aero.alert('Cannot open file', String(e.message || e)); }
    finally { Aero.busy(); }
  }
  async function importDxf() {
    const fs = await Aero.openFile({ accept: '.dxf', filters: DXF_FILTER }); const f = fs[0]; if (!f) return;
    try {
      const { doc: d, warnings } = X.readDXF(decodeDxf(f.data));
      for (const l of d.layers) if (!A.doc.layers.some(x => x.name === l.name)) A.doc.layers.push(l);
      const ren = {};
      for (const [k, b] of Object.entries(d.blocks)) { let n = k; while (A.doc.blocks[n]) n = n + '_1'; ren[k] = n; A.doc.blocks[n] = b; }
      for (const b of Object.values(d.blocks)) b.ents.forEach(e => { if (e.type === 'insert' && ren[e.name]) e.name = ren[e.name]; });
      Object.assign(A.doc.ltypes, d.ltypes || {});
      d.ents.forEach(e => { if (e.type === 'insert' && ren[e.name]) e.name = ren[e.name]; A.doc.ents.push({ ...e, id: A.doc.nextId++ }); });
      commit('Import DXF'); V.zoomExtents(); echo(`Imported ${d.ents.length} objects from ${f.name}.` + (warnings.length ? ' Note: ' + warnings.join('; ') : ''));
    } catch (e) { Aero.alert('Import failed', String(e.message || e)); }
  }
  function serialize(fmt) {
    if (fmt === 'dxf') return X.writeDXF(A.doc, { version: 'R2000' });
    if (fmt === 'dxf12') return X.writeDXF(A.doc, { version: 'R12' });
    const d = JSON.parse(JSON.stringify(A.doc)); delete d.dxfVersion; return JSON.stringify(d);
  }
  async function save(as, fmt) {
    if (E.running()) E.cancel();
    fmt = fmt || (as ? 'ldraft' : A.fmt);
    const ext = fmt === 'ldraft' ? '.ldraft' : '.dxf', base = Aero.baseName(A.docName) || 'Drawing1';
    const samePath = !as && A.filePath && A.fmt === fmt ? A.filePath : null;
    const p = await Aero.saveFile({ name: base + ext, data: serialize(fmt), filters: fmt === 'ldraft' ? LD_FILTER : DXF_FILTER, path: samePath });
    if (!p) return false;
    A.fmt = fmt; A.filePath = Aero.isDesktop ? p : null; A.docName = String(p).replace(/^.*[\\/]/, '');
    Aero.setDoc(A.docName, false); Aero.toast('Saved ' + A.docName + (fmt === 'dxf12' ? ' (DXF R12)' : fmt === 'dxf' ? ' (DXF R2000)' : ''));
    return true;
  }
  async function newDrawing() {
    if (Aero.dirty && !(await Aero.confirm('New drawing', 'Discard unsaved changes to ' + A.docName + '?', 'Discard'))) return;
    const d = M.newDoc(); load(d, 'Drawing1'); V.zoomBox([0, 0, 420, 297]);
  }
  async function openSample() {
    if (Aero.dirty && !(await Aero.confirm('Open sample', 'Discard unsaved changes to ' + A.docName + '?', 'Discard'))) return;
    load(window.LDSample.sampleDoc(), 'Mounting plate.ldraft'); A.welcomeDismissed = true; $('welcome').hidden = true;
    echo('Sample drawing: front view, section A–A, dimensions, hatch and a block. Click the Layout1 tab for the plotted sheet.');
  }
  function savePrefs() { try { localStorage.setItem('lumen-draft-prefs', JSON.stringify({ osnap: A.osnap, osnapOn: A.osnapOn, polar: A.polar, polarInc: A.polarInc, ortho: A.ortho, grid: A.grid, lwt: A.lwt, gridStep: A.gridStep, prec: A.prec, dark: V.dark })); } catch (e) { } }
  function loadPrefs() { try { const p = JSON.parse(localStorage.getItem('lumen-draft-prefs') || 'null'); if (!p) return; for (const k of ['osnapOn', 'polar', 'polarInc', 'ortho', 'grid', 'lwt', 'gridStep', 'prec']) if (p[k] != null) A[k] = p[k]; if (p.osnap) Object.assign(A.osnap, p.osnap); if (p.dark != null) V.dark = p.dark; } catch (e) { } }

  /* ======================= toolbox & menus ======================= */
  const ICON = {
    line: '<path d="M4 20 20 4"/><circle cx="4" cy="20" r="1.7"/><circle cx="20" cy="4" r="1.7"/>',
    pline: '<path d="M3 19 8 8l6 7 7-11"/><path d="M14 15"/>',
    circle: '<circle cx="12" cy="12" r="8"/><path d="M12 12h8"/><circle cx="12" cy="12" r="1"/>',
    arc: '<path d="M4 18a9 9 0 0 1 16 0"/><circle cx="4" cy="18" r="1.4"/><circle cx="20" cy="18" r="1.4"/>',
    rect: '<rect x="4" y="6" width="16" height="12"/>',
    hatch: '<rect x="4" y="4" width="16" height="16"/><path d="M4 12l8-8M4 20 20 4M12 20l8-8"/>',
    text: '<path d="M5 7V4h14v3M12 4v16M9 20h6"/>',
    mtext: '<path d="M4 5h16M4 10h16M4 15h11M4 20h7"/>',
    dim: '<path d="M4 6v12M20 6v12M4 12h16M4 12l3-2.2M4 12l3 2.2M20 12l-3-2.2M20 12l-3 2.2"/>',
    move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
    copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5"/><path d="M4 15.5V4h11.5"/>',
    rotate: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M18 2.5v4h-4"/>',
    scale: '<rect x="3" y="12" width="9" height="9"/><path d="M12 12l8-8M14.5 4H20v5.5"/>',
    mirror: '<path d="M12 2v20" stroke-dasharray="2 2.2"/><path d="M9 6 3.5 18H9zM15 6l5.5 12H15z"/>',
    offset: '<path d="M3 15c4-8 14-8 18 0"/><path d="M6.5 20c3-5 8-5 11 0"/>',
    trim: '<circle cx="6.5" cy="18" r="2.6"/><circle cx="17.5" cy="18" r="2.6"/><path d="M8.3 16 18 3.5M15.7 16 6 3.5"/>',
    extend: '<path d="M20.5 3v18"/><path d="M3 12h13.5M13 8.5l3.5 3.5-3.5 3.5"/>',
    fillet: '<path d="M4 20v-7a9 9 0 0 1 9-9h7"/>',
    chamfer: '<path d="M4 20v-9l7-7h9"/>',
    array: '<rect x="3.5" y="3.5" width="6" height="6"/><rect x="14.5" y="3.5" width="6" height="6"/><rect x="3.5" y="14.5" width="6" height="6"/><rect x="14.5" y="14.5" width="6" height="6"/>',
    erase: '<path d="M4 16.5 12.5 8l6 6-6 6H8z"/><path d="M13 20h7.5"/>',
    dist: '<path d="M3 17 17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
  };
  const TOOLS = [
    ['LINE', 'line', 'Line (L)'], ['PLINE', 'pline', 'Polyline (PL)'], ['CIRCLE', 'circle', 'Circle (C)'], ['ARC', 'arc', 'Arc (A)'], ['RECTANG', 'rect', 'Rectangle (REC)'], ['HATCH', 'hatch', 'Hatch (H)'], ['TEXT', 'text', 'Text (DT)'], ['MTEXT', 'mtext', 'Multiline text (T)'], ['DIMLINEAR', 'dim', 'Linear dimension (DLI)'], null,
    ['MOVE', 'move', 'Move (M)'], ['COPY', 'copy', 'Copy (CO)'], ['ROTATE', 'rotate', 'Rotate (RO)'], ['SCALE', 'scale', 'Scale (SC)'], ['MIRROR', 'mirror', 'Mirror (MI)'], ['OFFSET', 'offset', 'Offset (O)'], ['ARRAY', 'array', 'Array (AR)'], null,
    ['TRIM', 'trim', 'Trim (TR) — shift-click extends'], ['EXTEND', 'extend', 'Extend (EX)'], ['FILLET', 'fillet', 'Fillet (F)'], ['CHAMFER', 'chamfer', 'Chamfer (CHA)'], ['ERASE', 'erase', 'Erase (E)'], null, ['DIST', 'dist', 'Measure distance (DI)'],
  ];
  const TOOLMAP = {}; TOOLS.forEach(t => { if (t) TOOLMAP[t[0]] = t[0]; });
  let tb = { set() { } };
  const run = (name, ...inputs) => () => { E.run(name); inputs.forEach((t, i) => setTimeout(() => { if (E.pending) E.input(t); }, 10 * (i + 1))); $('cmdIn').focus(); };
  function buildMenus() {
    Aero.menus({
      File: [['New', 'Ctrl+N', newDrawing], ['Open…', 'Ctrl+O', async () => { const fs = await Aero.openFile({ accept: '.dxf,.ldraft,.json', filters: [{ name: 'Drawings', extensions: ['dxf', 'ldraft'] }] }); if (fs.length) openFiles(fs); }], ['Open Sample', '', openSample], '-',
        ['Save', 'Ctrl+S', () => save(false)], ['Save As…', 'Ctrl+Shift+S', () => save(true, 'ldraft')], ['Save As DXF (R2000)…', '', () => save(true, 'dxf')], ['Save As DXF (R12)…', '', () => save(true, 'dxf12')], '-',
        ['Import DXF into Drawing…', '', importDxf], ['Page Setup…', '', pageDialog], ['Export PDF…', 'Ctrl+P', () => exportDialog('pdf')], ['Export SVG…', '', () => exportDialog('svg')]],
      Edit: [['Undo', 'Ctrl+Z', undo], ['Redo', 'Ctrl+Y', redo], '-', ['Copy', 'Ctrl+C', () => copyClip()], ['Paste', 'Ctrl+V', run('PASTECLIP')], '-', ['Select All', 'Ctrl+A', ui.selectAll], ['Erase', 'Delete', () => { if (A.selSet.size && !E.running()) E.run('ERASE'); }], '-', ['Properties', 'Ctrl+1', ui.showProps]],
      View: [['Zoom In', 'Ctrl+=', () => V.zoomScale(1.5)], ['Zoom Out', 'Ctrl+-', () => V.zoomScale(1 / 1.5)], ['Zoom Extents', 'Ctrl+0', () => V.zoomExtents()], ['Zoom Window', '', run('ZOOM', 'W')], '-',
        { label: 'Model', fn: () => setSpace('model'), checked: () => A.space === 'model' }, { label: 'Layout1 (sheet)', fn: () => setSpace('layout'), checked: () => A.space === 'layout' }, '-',
        { label: 'Grid', key: 'F7', fn: () => toggle('grid'), checked: () => A.grid }, { label: 'Lineweights', fn: () => toggle('lwt'), checked: () => A.lwt },
        { label: 'Dark model background', fn: () => { V.dark = !V.dark; $('stage').style.background = V.dark ? '' : '#fff'; savePrefs(); V.draw(); }, checked: () => V.dark },
        { label: 'Full-screen crosshair', fn: () => { A.crossFull = !A.crossFull; V.overlay(); }, checked: () => A.crossFull }],
      Draw: [['Line', '', run('LINE')], ['Polyline', '', run('PLINE')], '#Circle', ['Center, Radius', '', run('CIRCLE')], ['3 Points', '', run('CIRCLE', '3P')], ['2 Points', '', run('CIRCLE', '2P')], ['Tangent, Tangent, Radius', '', run('CIRCLE', 'T')], '#Arc', ['3 Points', '', run('ARC')], ['Center, Start, End', '', run('ARC', 'C')], '-',
        ['Rectangle', '', run('RECTANG')], ['Polygon', '', run('POLYGON')], ['Point', '', run('POINT')], '-', ['Hatch', '', run('HATCH')], ['Hatch Settings…', '', hatchDialog], '-', ['Single-line Text', '', run('TEXT')], ['Multiline Text', '', run('MTEXT')], '-', ['Make Block…', '', run('BLOCK')], ['Insert Block…', '', run('INSERT')]],
      Modify: [['Move', '', run('MOVE')], ['Copy', '', run('COPY')], ['Rotate', '', run('ROTATE')], ['Scale', '', run('SCALE')], ['Mirror', '', run('MIRROR')], ['Offset', '', run('OFFSET')], ['Array', '', run('ARRAY')], '-',
        ['Trim', '', run('TRIM')], ['Extend', '', run('EXTEND')], ['Fillet', '', run('FILLET')], ['Chamfer', '', run('CHAMFER')], ['Break', '', run('BREAK')], ['Join', '', run('JOIN')], ['Explode', '', run('EXPLODE')], ['Erase', '', run('ERASE')], '-', ['Match Properties', '', run('MATCHPROP')], ['Edit Text', '', run('TEXTEDIT')]],
      Dimension: [['Linear', '', run('DIMLINEAR')], ['Aligned', '', run('DIMALIGNED')], ['Radius', '', run('DIMRADIUS')], ['Diameter', '', run('DIMDIAMETER')], ['Angular', '', run('DIMANGULAR')], '-', ['Dimension Style…', '', dimStyleDialog]],
      Format: [['Layers…', '', layerDialog], ['Units…', '', unitsDialog], ['Linetype Scale…', '', run('LTSCALE')], ['Drafting Settings…', '', draftingDialog], ['Dimension Style…', '', dimStyleDialog], ['Page Setup…', '', pageDialog]],
      Tools: [['Distance', '', run('DIST')], ['Area', '', run('AREA')], ['ID Point', '', run('ID')], ['List', '', run('LIST')], '-', ['Measure (points at interval)', '', run('MEASURE')], ['Divide', '', run('DIVIDE')], '-', ['Regenerate', '', run('REGEN')],
        { label: 'Object Snap', key: 'F3', fn: () => toggle('osnapOn'), checked: () => A.osnapOn }, { label: 'Ortho', key: 'F8', fn: () => toggle('ortho'), checked: () => A.ortho }, { label: 'Snap to Grid', key: 'F9', fn: () => toggle('snapOn'), checked: () => A.snapOn }, { label: 'Polar Tracking', key: 'F10', fn: () => toggle('polar'), checked: () => A.polar }],
      Help: [['Command Reference', 'F1', showCommands], ['Keyboard Shortcuts', '', showShortcuts], '-', ['About Lumen Draft', '', () => Aero.alert('About Lumen Draft', 'Lumen Draft 1.0 — free AutoCAD-style 2-D drafting. Real units, command line, object snaps, layers, dimensions, hatches, blocks; opens and saves DXF (R12 / R2000), plots PDF and SVG at scale. Part of Lumen Studio.')]],
    });
  }

  /* ======================= init ======================= */
  function init() {
    Aero.init({ name: 'Lumen Draft', icon: '../kit/icons/draft.png', onDropFiles: openFiles, dropTarget: $('stage'), dropText: 'Drop a DXF or .ldraft drawing to open it', onSave: () => save(false) });
    V = window.LDView(A); E = window.LDCmd(A, V, ui); A.V = V; A.E = E;
    registerGrip(); A.refresh = refresh;
    loadPrefs();
    buildMenus();
    tb = Aero.toolbox($('tools'), TOOLS.map(t => t && { id: t[0], title: t[2], icon: ICON[t[1]] }), id => { if (id && E.running() !== id) { if (!toolLock) run(id)(); } });
    let toolLock = false; const tbSet = tb.set; tb.set = id => { toolLock = true; tbSet(id); toolLock = false; };
    $('tools').querySelectorAll('.aero-tool').forEach(b => b.addEventListener('click', () => { }));
    const ov = $('ov');
    ov.addEventListener('pointerdown', onDown); ov.addEventListener('pointermove', onMove); ov.addEventListener('pointerup', onUp);
    ov.addEventListener('pointerleave', () => { A.cursor = A.cursor ? { ...A.cursor, out: true } : null; V.overlay(); });
    ov.addEventListener('wheel', onWheel, { passive: false }); ov.addEventListener('dblclick', onDbl);
    ov.addEventListener('auxclick', ev => { if (ev.button === 1) ev.preventDefault(); });
    ov.addEventListener('mousedown', ev => { if (ev.button === 1 && ev.detail === 2) V.zoomExtents(); });
    ov.addEventListener('contextmenu', ev => { ev.preventDefault(); if (winStart) { winStart = null; A.winSel = null; V.overlay(); return; } E.enter(); });
    document.addEventListener('keydown', onKey);
    $('cmdIn').addEventListener('input', () => { sugIdx = -1; showSuggest(); });
    $('cmdIn').addEventListener('blur', () => setTimeout(hideSuggest, 150));
    $('suggest').addEventListener('mousedown', ev => { const d = ev.target.closest('[data-n]'); if (d) { ev.preventDefault(); $('cmdIn').value = d.dataset.n; submitInput(); } });
    $('prompt').addEventListener('click', ev => { const k = ev.target.dataset.k; if (k && E.pending) { E.input(k); $('cmdIn').focus(); } });
    $('toggles').addEventListener('click', ev => { const k = ev.target.dataset.k; if (k) toggle(k); });
    $('spaceTabs').addEventListener('click', ev => { const s = ev.target.dataset.s; if (s) setSpace(s); });
    for (const [id, k] of [['layerSel', 'layer'], ['colorSel', 'color'], ['ltSel', 'lt'], ['lwSel', 'lw']]) $(id).addEventListener('change', ev => onPropBar(k, ev.target.value));
    $('paperSel').onchange = ev => { A.doc.layout.paper = ev.target.value; commit('Paper size'); V.zoomExtents(); };
    $('scaleSel').onchange = async ev => {
      let v = ev.target.value;
      if (v === 'custom') { const t = await Aero.prompt('Custom scale', 'Paper units : drawing units (e.g. 1:75)', `${A.doc.layout.scale[0]}:${A.doc.layout.scale[1]}`); if (!t) return renderBars(); v = t; }
      const m = String(v).match(/^\s*([\d.]+)\s*:\s*([\d.]+)\s*$/); if (!m || !(+m[1] > 0) || !(+m[2] > 0)) return renderBars();
      A.doc.layout.scale = [+m[1], +m[2]]; commit('Plot scale');
    };
    $('bFit').onclick = () => { A.doc.layout.scale = EX.fitScale(A.doc); A.doc.layout.cx = null; A.doc.layout.cy = null; commit('Fit drawing to sheet'); Aero.toast('Scale ' + A.doc.layout.scale.join(':')); };
    $('bPage').onclick = pageDialog; $('bPlot').onclick = () => exportDialog();
    $('lNew').onclick = newLayer; $('lDel').onclick = deleteLayer; $('lEdit').onclick = layerDialog;
    $('lCur').onclick = () => { const e = selEnts()[0]; if (e) { A.doc.cur = e.layer; commit('Set current layer'); } else if (layerSelName) { A.doc.cur = layerSelName; commit('Set current layer'); } else Aero.toast('Select an object or click a layer first'); };
    $('wSample').onclick = openSample; $('wOpen').onclick = async () => { const fs = await Aero.openFile({ accept: '.dxf,.ldraft,.json' }); if (fs.length) openFiles(fs); }; $('wStart').onclick = () => { A.welcomeDismissed = true; $('welcome').hidden = true; $('cmdIn').focus(); };
    new ResizeObserver(() => V.resize()).observe($('stage'));
    V.resize(); load(M.newDoc(), 'Drawing1'); V.zoomBox([0, 0, 420, 297]);
    $('welcome').hidden = false;
    setPrompt('Command:', []);
    echo('Lumen Draft ready. Type a command (e.g. LINE or L) and press Enter. F1 lists every command.');
    $('stage').style.background = V.dark ? '' : '#fff';
  }
  init();
})();
