'use strict';
/* Lumen Layout — Swatches panel (process CMYK / RGB / named spot colors, tints), swatch editor and
   the Separations preview bar. */
const Swatches = (() => {
  const el = Aero.el, esc = Aero.esc;
  let selId = null;
  const target = () => S.edit ? 'text' : S.cell ? 'cell' : S.swTarget;
  // reference currently applied to the active target (for highlighting + tint)
  function currentRef() {
    const t = target();
    if (t === 'text') return UI.charState()?.color || null;
    if (t === 'cell') { const c = S.cell, tb = UI.tableById(c.id); return tb?.cells[c.r]?.[c.c]?.fill || null; }
    const it = UI.selItems()[0]; return it ? it[t] : null;
  }
  const parseRef = r => { const m = /^@([\w-]+)(?:\/([\d.]+))?$/.exec(r || ''); return m ? { id: m[1], tint: m[2] != null ? +m[2] : 100 } : null; };
  function apply(ref, label) {
    const t = target();
    if (t === 'text') { UI.applyChar({ color: ref }, label || 'Text Color'); return; }
    if (t === 'cell') { const tb = UI.tableById(S.cell.id); if (!tb) return; for (const [r, c] of UI.cellRange()) tb.cells[r][c].fill = ref; commit(label || 'Cell Fill'); return; }
    if (!S.sel.length) { Aero.toast('Select an object, a table cell or text to apply a swatch'); return; }
    UI.setProp(t, ref);
  }
  function applySwatch(id) {
    const tint = Aero.clamp(+($('#sw-tint')?.value) || 100, 0, 100);
    apply('@' + id + (tint < 100 ? '/' + +tint.toFixed(1) : ''), 'Apply Swatch');
  }
  function chip(ref, spot) {
    const c = el('span', 'swchip' + (spot ? ' spot' : '')); c.style.background = ref ? Color.hex(ref) : 'transparent'; if (!ref) c.classList.add('none'); return c;
  }
  function build() {
    const bar = $('#swbar'), list = $('#swlist'); if (!bar || !list || $('#tp-swatches').hidden) return;
    const t = target(), cur = currentRef(), pr = parseRef(cur);
    if (bar.dataset.t !== t || !bar.children.length) {
      bar.dataset.t = t; bar.innerHTML = '';
      if (t === 'fill' || t === 'stroke') {
        for (const k of ['fill', 'stroke']) { const b = el('button', 'aero-btn small swt' + (S.swTarget === k ? ' on' : ''), k === 'fill' ? 'Fill' : 'Stroke'); b.dataset.k = k; b.onclick = () => { S.swTarget = k; bar.dataset.t = ''; build(); }; bar.appendChild(b); }
      } else bar.appendChild(el('span', 'swtl', t === 'text' ? 'Text color' : 'Cell fill'));
      bar.appendChild(el('span', 'grow'));
      bar.insertAdjacentHTML('beforeend', '<label title="Tint of the applied swatch">Tint <input id="sw-tint" type="number" min="0" max="100" step="5" style="width:52px">%</label>');
      const ti = $('#sw-tint');
      ti.onchange = () => { const r = parseRef(currentRef()); if (r) { const v = Aero.clamp(+ti.value || 0, 0, 100); apply('@' + r.id + (v < 100 ? '/' + v : ''), 'Tint'); } };
      ti.onkeydown = e => { if (e.key === 'Enter') ti.blur(); };
    }
    const ti = $('#sw-tint'); if (ti && document.activeElement !== ti) ti.value = pr ? pr.tint : 100;
    bar.querySelectorAll('.swt').forEach(b => b.classList.toggle('on', b.dataset.k === S.swTarget));
    list.innerHTML = '';
    const none = el('div', 'aero-item swrow' + (!cur && t !== 'text' ? ' cur' : '')); none.appendChild(chip(null)); none.appendChild(el('span', 'grow', '[None]'));
    none.onclick = () => { if (t !== 'text') apply(null, 'No Color'); }; list.appendChild(none);
    S.doc.swatches.forEach(sw => {
      const row = el('div', 'aero-item swrow' + (selId === sw.id ? ' sel' : '') + (pr && pr.id === sw.id ? ' cur' : ''));
      row.appendChild(chip('@' + sw.id, sw.spot));
      const nm = el('span', 'grow'); nm.textContent = sw.name; row.appendChild(nm);
      row.appendChild(el('span', 'swkind', sw.spot ? '<b title="Spot color">◉</b>' : sw.model === 'cmyk' ? '<i class="cmyk" title="Process CMYK"></i>' : '<i class="rgb" title="RGB"></i>'));
      row.title = `${sw.name} — ${sw.spot ? 'Spot · ' : sw.model === 'cmyk' ? 'Process · ' : 'RGB · '}${Color.describe(sw)}${sw.model === 'cmyk' && Color.totalInk(Color.parse('@' + sw.id)) > 300 ? ' · total ink over 300%' : ''}`;
      row.onclick = () => { selId = sw.id; applySwatch(sw.id); };
      row.ondblclick = () => { selId = sw.id; dialog(sw); };
      list.appendChild(row);
    });
  }
  // swatch editor (new or existing)
  function dialog(sw, preset) {
    const isNew = !sw; sw = sw || preset || { id: null, name: '', model: S.doc.cmyk ? 'cmyk' : 'rgb', v: S.doc.cmyk ? [0, 50, 100, 0] : [220, 120, 40] };
    const cm = sw.model === 'cmyk' ? sw.v : Color.rgbToCmyk(...sw.v.map(x => x / 255)).map(x => Math.round(x * 100));
    const rgb = sw.model === 'rgb' ? sw.v : Color.cmykToRgb(...sw.v.map(x => x / 100)).map(x => Math.round(x * 255));
    const f = [
      { key: 'name', label: 'Swatch name', type: 'text', value: sw.name, placeholder: 'e.g. PANTONE 185 C' },
      { key: 'type', label: 'Color type', type: 'select', value: sw.spot ? 'spot' : 'process', options: [['process', 'Process'], ['spot', 'Spot (separate ink plate)']] },
      { key: 'model', label: 'Color mode', type: 'select', value: sw.model, options: [['cmyk', 'CMYK'], ['rgb', 'RGB']] },
      { key: 'c', label: 'Cyan %', type: 'range', min: 0, max: 100, step: 0.5, value: cm[0] }, { key: 'm', label: 'Magenta %', type: 'range', min: 0, max: 100, step: 0.5, value: cm[1] },
      { key: 'y', label: 'Yellow %', type: 'range', min: 0, max: 100, step: 0.5, value: cm[2] }, { key: 'k', label: 'Black %', type: 'range', min: 0, max: 100, step: 0.5, value: cm[3] },
      { key: 'r', label: 'Red', type: 'range', min: 0, max: 255, value: rgb[0] }, { key: 'g', label: 'Green', type: 'range', min: 0, max: 255, value: rgb[1] }, { key: 'b', label: 'Blue', type: 'range', min: 0, max: 255, value: rgb[2] },
      { key: 'hex', label: 'Hex', type: 'text', value: Color.toHex(rgb.map(x => x / 255)) },
    ];
    const dlg = Aero.dialog({ title: isNew ? 'New Color Swatch' : 'Swatch Options', fields: f, width: 460,
      html: '<div class="swprev"><span class="swbig"></span><span class="swinfo"></span></div>',
      onInput: (k, v, set) => {
        if (k === 'hex') { const p = Color.parseHex(String(v.hex).trim()); if (p) { const c = Color.rgbToCmyk(...p).map(x => Math.round(x * 100)); ['r', 'g', 'b'].forEach((x, i) => set(x, Math.round(p[i] * 255))); ['c', 'm', 'y', 'k'].forEach((x, i) => set(x, c[i])); } }
        if (k === 'model') vis(v.model);
      },
      onChange: v => {
        const ref = v.model === 'cmyk' ? `cmyk(${v.c},${v.m},${v.y},${v.k})` : Color.toHex([v.r, v.g, v.b].map(x => x / 255));
        const box = document.querySelector('.swprev'); if (!box) return;
        box.querySelector('.swbig').style.background = Color.hex(ref);
        const tot = v.c + v.m + v.y + v.k;
        box.querySelector('.swinfo').textContent = v.model === 'cmyk' ? `C=${v.c} M=${v.m} Y=${v.y} K=${v.k} · total ink ${Math.round(tot)}%${tot > 300 ? ' (over 300% — risky on press)' : ''}` : `R=${v.r} G=${v.g} B=${v.b}${v.type === 'spot' ? ' · spot inks are defined by their CMYK alternate' : ''}`;
      },
      onOK: v => {
        const model = v.model === 'rgb' && v.type !== 'spot' ? 'rgb' : 'cmyk';
        const vals = model === 'cmyk' ? (v.model === 'rgb' ? Color.rgbToCmyk(v.r / 255, v.g / 255, v.b / 255).map(x => Math.round(x * 1000) / 10) : [v.c, v.m, v.y, v.k]) : [v.r, v.g, v.b].map(Math.round);
        let name = String(v.name || '').trim().slice(0, 64);
        if (!name) name = v.type === 'spot' ? 'Spot ' + (S.doc.swatches.filter(s => s.spot).length + 1) : model === 'cmyk' ? `C=${vals[0]} M=${vals[1]} Y=${vals[2]} K=${vals[3]}` : `R=${vals[0]} G=${vals[1]} B=${vals[2]}`;
        if (v.type === 'spot' && S.doc.swatches.some(s => s.spot && s.name === name && s.id !== sw.id)) { Aero.alert('Swatch', `A spot color named “${name}” already exists.`); return; }
        const o = { id: sw.id || 'sw' + M.uid().slice(0, 6), name, model, v: vals, ...(v.type === 'spot' ? { spot: true } : {}) };
        const k = S.doc.swatches.findIndex(s => s.id === o.id);
        if (k >= 0) S.doc.swatches[k] = o; else S.doc.swatches.push(o);
        selId = o.id; commit(isNew ? 'New Swatch' : 'Swatch Options');
      } });
    const rows = [...dlg.el.querySelectorAll('.aero-row')];
    function vis(model) { rows.forEach((r, i) => { const key = f[i]?.key; if ('cmyk'.includes(key) && key.length === 1) r.style.display = model === 'cmyk' ? '' : 'none'; if (['r', 'g', 'b'].includes(key)) r.style.display = model === 'rgb' ? '' : 'none'; }); }
    vis(sw.model);
  }
  function selected() { return S.doc.swatches.find(s => s.id === selId) || parseRef(currentRef()) && S.doc.swatches.find(s => s.id === parseRef(currentRef()).id) || null; }
  function duplicate() { const sw = selected(); if (!sw) { Aero.toast('Click a swatch first'); return; } const o = structuredClone(sw); o.id = 'sw' + M.uid().slice(0, 6); o.name = (sw.name + ' copy').slice(0, 64); S.doc.swatches.push(o); selId = o.id; commit('Duplicate Swatch'); }
  async function remove() {
    const sw = selected(); if (!sw) { Aero.toast('Click a swatch first'); return; }
    const used = Color.refsIn(S.doc).filter(x => parseRef(x.ref)?.id === sw.id).length;
    if (used && !(await Aero.confirm('Delete Swatch', `“${sw.name}” is used ${used} time(s). Those colors keep their appearance as unnamed ${sw.model === 'rgb' ? 'RGB' : 'CMYK'} colors${sw.spot ? ' (the spot plate is removed)' : ''}.`, 'Delete'))) return;
    replaceRefs(S.doc, ref => Color.detach(sw, ref));
    S.doc.swatches = S.doc.swatches.filter(s => s !== sw); selId = null; commit('Delete Swatch');
  }
  // rewrite every color reference in the document
  function replaceRefs(d, fn) {
    const fix = (o, k) => { if (typeof o[k] === 'string' && o[k]) o[k] = fn(o[k]); };
    const tbl = t => { ['tcolor', 'hfill', 'hcolor', 'bcolor', 'zebra'].forEach(k => fix(t, k)); t.cells.forEach(r => r.forEach(c => { fix(c, 'fill'); fix(c, 'color'); })); };
    const item = it => { fix(it, 'fill'); fix(it, 'stroke'); if (it.grad) { fix(it.grad, 'c0'); fix(it.grad, 'c1'); } if (it.type === 'table') tbl(it); };
    M.walkAll(d, item);
    for (const s of Object.values(d.stories)) {
      s.attrs = s.attrs.map(a => { const o = { ...a }; fix(o, 'color'); return o; }); s.paras.forEach(p => fix(p, 'color'));
      for (const o of Object.values(s.objs || {})) { if (o.kind === 'table') tbl(o); else if (o.item) item(o.item); }
    }
    Object.values(d.paraStyles).forEach(st => fix(st, 'color')); Object.values(d.charStyles).forEach(st => fix(st, 'color'));
  }
  // add swatches for unnamed colors used in the document
  function addUnnamed() {
    const seen = new Map(S.doc.swatches.map(s => [JSON.stringify([s.model, s.v.map(x => +x.toFixed(1))]), s.id])); let n = 0;
    Color.use(S.doc);
    for (const { ref } of Color.refsIn(S.doc)) {
      if (ref[0] === '@') continue; const c = Color.parse(ref); if (c.kind === 'none') continue;
      const sw = c.kind === 'cmyk' ? { model: 'cmyk', v: c.cmyk.map(x => Math.round(x * 1000) / 10) } : { model: 'rgb', v: c.rgb.map(x => Math.round(x * 255)) };
      const key = JSON.stringify([sw.model, sw.v]); if (seen.has(key)) continue;
      const id = 'sw' + M.uid().slice(0, 6); seen.set(key, id);
      S.doc.swatches.push({ id, name: sw.model === 'cmyk' ? `C=${sw.v[0]} M=${sw.v[1]} Y=${sw.v[2]} K=${sw.v[3]}` : `R=${sw.v[0]} G=${sw.v[1]} B=${sw.v[2]}`, ...sw }); n++;
    }
    if (n) commit('Add Unnamed Colors'); Aero.toast(n ? `Added ${n} swatch${n > 1 ? 'es' : ''}` : 'No unnamed colors found');
  }

  /* ---------- separations preview ---------- */
  function sepBar() {
    let bar = $('#seps');
    if (!S.opt.seps) { if (bar) bar.hidden = true; return; }
    if (!bar) { bar = el('div', 'aero-pill'); bar.id = 'seps'; $('#stagewrap').appendChild(bar); }
    bar.hidden = false; bar.innerHTML = '<b>Separations</b>';
    for (const p of [null, ...Color.inks(S.doc)]) {
      const b = el('button', 'aero-btn small sepb' + ((S.sepPlate || null) === p ? ' on' : ''));
      const sw = p && p.startsWith('S:') ? S.doc.swatches.find(s => s.spot && s.name === p.slice(2)) : null;
      const dot = p ? `<i style="background:${p === 'C' ? '#00aeef' : p === 'M' ? '#ec008c' : p === 'Y' ? '#fff200' : p === 'K' ? '#231f20' : esc(Color.hex('@' + sw?.id) || '#888')}"></i>` : '';
      b.innerHTML = dot + esc(Color.plateLabel(p)); b.title = p ? `Show the ${Color.plateLabel(p)} plate (ink coverage as black)` : 'All inks (composite)';
      b.onclick = () => { S.sepPlate = p; sepBar(); requestRender(true); UI.status(); };
      bar.appendChild(b);
    }
    const x = el('button', 'aero-btn small', '✕'); x.title = 'Close separations preview'; x.onclick = toggleSeps; bar.appendChild(x);
  }
  function toggleSeps() { S.opt.seps = !S.opt.seps; if (!S.opt.seps) S.sepPlate = null; sepBar(); requestRender(true); UI.status(); }

  return { build, dialog, duplicate, remove, addUnnamed, sepBar, toggleSeps, replaceRefs, apply, selected };
})();
