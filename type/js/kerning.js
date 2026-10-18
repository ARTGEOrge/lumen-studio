'use strict';
/* Lumen Type — kerning: pair editor with group / exception modes, kerning groups, pair list. */
(function () {
  const A = window.LT, TM = window.TM, $ = id => document.getElementById(id);
  A.kernSel = null;          // {l, r} glyph names
  let mode = null, gsel = null, ctxMode = 'auto';
  const k1 = n => TM.groupIndex(A.font).k1.get(n), k2 = n => TM.groupIndex(A.font).k2.get(n);

  function modes(l, r) {
    const gl = k1(l), gr = k2(r), out = [];
    if (gl && gr) out.push({ id: 'gg', left: gl, right: gr, label: `Groups  ${TM.groupLabel(gl)} ⇄ ${TM.groupLabel(gr)}` });
    if (gr) out.push({ id: 'eg', left: l, right: gr, label: `Exception  ${l} ⇄ ${TM.groupLabel(gr)}` });
    if (gl) out.push({ id: 'ge', left: gl, right: r, label: `Exception  ${TM.groupLabel(gl)} ⇄ ${r}` });
    out.push({ id: 'ee', left: l, right: r, label: gl || gr ? `Exception  ${l} ⇄ ${r}` : `Pair  ${l} ⇄ ${r}` });
    return out;
  }
  const curMode = () => { if (!A.kernSel) return null; const ms = modes(A.kernSel.l, A.kernSel.r); return ms.find(m => m.id === mode) || ms[0]; };
  const entryValue = m => { const K = A.font.kerning; return K[m.left] && K[m.left][m.right] != null ? K[m.left][m.right] : null; };

  A.selectKernPair = (l, r, keepMode) => {
    if (!A.glyph(l) || !A.glyph(r)) return;
    A.kernSel = { l, r };
    if (!keepMode) { const src = TM.kernSource(A.font, l, r); const ms = modes(l, r); mode = src ? (ms.find(m => m.left === src.left && m.right === src.right) || ms[0]).id : ms[0].id; }
    buildTop(); redraw(); A.redrawPreview(); markPairList();
  };
  function setValue(v, live) {
    const m = curMode(); if (!m) return;
    const label = `Kern ${TM.groupLabel(m.left)} ${TM.groupLabel(m.right)}`;
    if (live) { const L = A.liveStart(label); L.setKern(m.left, m.right, v); redraw(); A.redrawPreview(); updateValueField(); return; }
    A.change(label, d => d.setKern(m.left, m.right, v));
  }
  A.kernNudge = (dv) => {
    const m = curMode(); if (!m) return;
    const cur = entryValue(m) != null ? entryValue(m) : TM.kernValue(A.font, A.kernSel.l, A.kernSel.r);
    setValue(cur + dv);
  };
  A.kernRemove = () => { const m = curMode(); if (!m || entryValue(m) == null) return; setValue(null); };

  // ---------- top bar ----------
  function glyphOptions() { return A.font.order.slice(0, 5000).map(n => `<option value="${Aero.esc(n)}">`).join(''); }
  let dlKey = null;
  function buildTop() {
    const T = $('kernTop'); if (!A.font) return;
    if (dlKey !== A.font.order) { dlKey = A.font.order; let dl = $('kernGlyphs'); if (!dl) { dl = document.createElement('datalist'); dl.id = 'kernGlyphs'; document.body.appendChild(dl); } dl.innerHTML = glyphOptions(); }
    if (!A.kernSel && A.glyph('A') && A.glyph('V')) A.kernSel = { l: 'A', r: 'V' };
    if (!A.kernSel) { const p = TM.kernPairs(A.font)[0]; const pick = k => TM.isGroup(k) ? (A.font.groups[k] || []).find(n => A.glyph(n)) : k; if (p && pick(p[0]) && pick(p[1])) { A.kernSel = { l: pick(p[0]), r: pick(p[1]) }; } else { const a = A.font.order.find(n => A.glyph(n).unicodes.includes(65)) || A.font.order[1], b = A.font.order.find(n => A.glyph(n).unicodes.includes(86)) || A.font.order[1]; A.kernSel = { l: a, r: b }; } const src = TM.kernSource(A.font, A.kernSel.l, A.kernSel.r); mode = null; if (src) { const ms = modes(A.kernSel.l, A.kernSel.r); mode = (ms.find(m => m.left === src.left && m.right === src.right) || ms[0]).id; } }
    const { l, r } = A.kernSel, ms = modes(l, r), m = curMode();
    const eff = TM.kernValue(A.font, l, r), src = TM.kernSource(A.font, l, r), ev = entryValue(m);
    T.innerHTML = `<div class="krow">
      <label>Left <input list="kernGlyphs" id="kL" value="${Aero.esc(l)}" class="gname"></label>
      <button class="aero-btn small" id="kSwap" title="Swap left and right">⇄</button>
      <label>Right <input list="kernGlyphs" id="kR" value="${Aero.esc(r)}" class="gname"></label>
      <span class="sep"></span>
      <label>Kern as <select id="kMode">${ms.map(x => `<option value="${x.id}"${x.id === m.id ? ' selected' : ''}>${Aero.esc(x.label)}</option>`).join('')}</select></label>
      </div><div class="krow">
      <label>Value <input type="number" id="kVal" step="1" value="${ev != null ? ev : ''}" placeholder="${eff}" style="width:70px"></label>
      <button class="aero-btn small" data-dv="-10">−10</button><button class="aero-btn small" data-dv="-1">−1</button><button class="aero-btn small" data-dv="1">+1</button><button class="aero-btn small" data-dv="10">+10</button>
      <button class="aero-btn small" id="kDel" ${ev == null ? 'disabled' : ''} title="Remove this kerning entry">Remove</button>
      <span class="sep"></span>
      <label>Context <select id="kCtx"><option value="auto">Auto</option><option value="HOH">HOH · HOH</option><option value="non">non · non</option><option value="none">Pair only</option></select></label>
      <span class="kinfo">Effective <b class="${eff < 0 ? 'neg' : eff > 0 ? 'pos' : ''}">${eff}</b>${src ? ` from ${Aero.esc(TM.groupLabel(src.left))} ⇄ ${Aero.esc(TM.groupLabel(src.right))}` : ' (no entry)'}</span>
    </div>`;
    $('kCtx').value = ctxMode;
    const pickGlyph = (inp, side) => { const n = inp.value.trim(); if (!A.glyph(n)) { inp.classList.add('bad'); return; } A.selectKernPair(side === 'l' ? n : A.kernSel.l, side === 'r' ? n : A.kernSel.r); };
    $('kL').onchange = e => pickGlyph(e.target, 'l'); $('kR').onchange = e => pickGlyph(e.target, 'r');
    $('kSwap').onclick = () => A.selectKernPair(A.kernSel.r, A.kernSel.l);
    $('kMode').onchange = e => { mode = e.target.value; buildTop(); redraw(); };
    $('kVal').onchange = e => { const v = e.target.value.trim(); if (v === '') A.kernRemove(); else if (isFinite(+v)) setValue(Math.round(+v)); };
    T.querySelectorAll('[data-dv]').forEach(b => b.onclick = () => A.kernNudge(+b.dataset.dv));
    $('kDel').onclick = A.kernRemove;
    $('kCtx').onchange = e => { ctxMode = e.target.value; redraw(); };
  }
  function updateValueField() { const m = curMode(), f = $('kVal'); if (f && m) f.value = entryValue(m) != null ? entryValue(m) : ''; }

  // ---------- canvas ----------
  function contextFor(l, r) {
    const F = A.font, cmap = TM.cmapOf(F), byCp = cp => cmap.get(cp);
    let mode = ctxMode;
    if (mode === 'auto') { const u = A.glyph(l).unicodes[0], v = A.glyph(r).unicodes[0]; const up = x => x != null && TM.category(x) === 'upper' || x != null && TM.category(x) === 'figure'; mode = up(u) && up(v) ? 'HOH' : 'non'; }
    if (mode === 'none') return [l, r];
    const [a, b] = mode === 'HOH' ? [byCp(72), byCp(79)] : [byCp(110), byCp(111)];
    const pad = [a, b, a].filter(Boolean);
    return [...pad, l, r, ...pad.slice().reverse()];
  }
  let raf = 0, cv, drag = null, pairX = null;
  function redraw() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; draw(); }); }
  A.redrawKern = redraw;
  function draw() {
    if (A.view !== 'kern' || !A.font || !A.kernSel) return;
    const { ctx, w, h } = A.R.sizeCanvas(cv), F = A.font, I = F.info;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    const names = contextFor(A.kernSel.l, A.kernSel.r), lay = TM.layout(F, names, true);
    const total = lay.reduce((m, p) => Math.max(m, p.x + F.glyphs[p.name].advance), 0);
    const em = I.ascender - I.descender;
    const s = Math.min((h - 70) / em, (w - 60) / Math.max(total, 1));
    const x0 = (w - total * s) / 2, base = (h - em * s) / 2 + I.ascender * s + 6;
    ctx.strokeStyle = '#e3e9f1'; ctx.beginPath(); [0, I.xHeight, I.capHeight].forEach(y => { const yy = Math.round(base - y * s) + .5; ctx.moveTo(0, yy); ctx.lineTo(w, yy); }); ctx.stroke();
    const pi = (names.length - 2) / 2 + 1;
    lay.forEach((p, i) => {
      const g = F.glyphs[p.name], gx = x0 + p.x * s;
      const isPair = i === pi - 1 || i === pi;
      if (isPair) { ctx.fillStyle = 'rgba(66,140,230,.07)'; ctx.fillRect(gx, base - I.ascender * s, g.advance * s, em * s); }
      A.R.drawGlyph(ctx, F, g, gx, base, s, isPair ? '#0b2f5c' : '#7c8ba0');
    });
    const p = lay[pi]; const kv = p ? p.kern : 0; pairX = { s, x: x0 + p.x * s };
    const kx = x0 + p.x * s, yb = base - I.descender * s + 14;
    ctx.fillStyle = kv < 0 ? '#d64545' : kv > 0 ? '#2e9e5b' : '#8a99ab';
    if (kv) ctx.fillRect(Math.min(kx, kx - kv * s), base - I.descender * s + 2, Math.abs(kv * s), 4);
    ctx.font = 'bold 15px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.fillText(String(kv), kx, yb); ctx.textAlign = 'left';
    ctx.font = '12px "Segoe UI", sans-serif'; ctx.fillStyle = '#5d7391';
    ctx.fillText('Drag the right glyph or use ← → (Shift = 1 unit) to kern · click pairs in the preview below', 10, h - 20);
  }
  function initCanvas() {
    cv = $('kernCv');
    cv.addEventListener('pointerdown', e => {
      if (!A.kernSel || !pairX) return; cv.focus(); try { cv.setPointerCapture(e.pointerId); } catch (x) { }
      const m = curMode(); drag = { x: e.clientX, v0: entryValue(m) != null ? entryValue(m) : TM.kernValue(A.font, A.kernSel.l, A.kernSel.r) };
    });
    cv.addEventListener('pointermove', e => { if (!drag) return; const v = Math.round(drag.v0 + (e.clientX - drag.x) / pairX.s); drag.moved = true; setValue(v, true); });
    cv.addEventListener('pointerup', () => { if (drag && drag.moved) { A.liveEnd(); } drag = null; });
    cv.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); A.kernNudge((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 1 : 10)); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); A.kernRemove(); }
    });
    new ResizeObserver(redraw).observe(cv);
  }

  // ---------- pair list (right panel) ----------
  let pairRows = [];
  A.buildPairList = () => {
    const L = $('pairList'); if (!A.font || $('pPairs').hidden) return;
    const q = $('pairFilter').value.trim().toLowerCase(), so = $('pairSort').value;
    let ps = TM.kernPairs(A.font);
    if (q) ps = ps.filter(p => (TM.groupLabel(p[0]) + ' ' + TM.groupLabel(p[1])).toLowerCase().includes(q));
    ps.sort((a, b) => so === 'v' ? a[2] - b[2] : so === 'r' ? TM.groupLabel(a[1]).localeCompare(TM.groupLabel(b[1])) : TM.groupLabel(a[0]).localeCompare(TM.groupLabel(b[0])) || TM.groupLabel(a[1]).localeCompare(TM.groupLabel(b[1])));
    pairRows = ps;
    const max = 1500;
    L.innerHTML = ps.slice(0, max).map((p, i) => `<div class="aero-item prow" data-i="${i}"><span class="pl${TM.isGroup(p[0]) ? ' grp' : ''}">${Aero.esc(TM.groupLabel(p[0]))}</span><span class="pr${TM.isGroup(p[1]) ? ' grp' : ''}">${Aero.esc(TM.groupLabel(p[1]))}</span><span class="pv ${p[2] < 0 ? 'neg' : 'pos'}">${p[2]}</span></div>`).join('') + (ps.length > max ? `<div class="dim" style="padding:6px">… ${ps.length - max} more (use the filter)</div>` : '') + (!ps.length ? '<div class="dim" style="padding:8px">No kerning pairs yet. Open the Kerning tab and set a value.</div>' : '');
    markPairList();
  };
  function markPairList() {
    if (!A.kernSel || $('pPairs').hidden) return; const m = curMode(); if (!m) return;
    $('pairList').querySelectorAll('.aero-item').forEach(el => { const p = pairRows[+el.dataset.i]; el.classList.toggle('sel', !!p && p[0] === m.left && p[1] === m.right); });
  }
  function initPairList() {
    $('pairFilter').addEventListener('input', A.buildPairList); $('pairSort').addEventListener('change', A.buildPairList);
    $('pairList').addEventListener('click', e => {
      const it = e.target.closest('.aero-item'); if (!it) return; const p = pairRows[+it.dataset.i]; if (!p) return;
      const pick = k => TM.isGroup(k) ? (A.font.groups[k] || []).find(n => A.glyph(n)) : k;
      const l = pick(p[0]), r = pick(p[1]); if (!l || !r) return A.toast('That group has no glyphs');
      if (A.view !== 'kern') A.setView('kern');
      A.selectKernPair(l, r, true);
      const ms = modes(l, r); mode = (ms.find(x => x.left === p[0] && x.right === p[1]) || ms[0]).id; buildTop(); redraw(); markPairList();
    });
  }

  // ---------- groups (left panel in kerning view) ----------
  function buildGroups() {
    if (A.view !== 'kern' || !A.font) return;
    $('leftTitle').textContent = 'Kerning groups';
    const G = A.font.groups, names = Object.keys(G).sort((a, b) => a.localeCompare(b));
    $('leftCount').textContent = names.length;
    const sec = (pre, title) => {
      const list = names.filter(n => n.startsWith(pre));
      return `<div class="lgroup">${title} <span class="dim">(${list.length})</span></div>` + list.map(n => `<div class="aero-item${gsel === n ? ' sel' : ''}" data-g="${Aero.esc(n)}" title="${Aero.esc(G[n].join(' '))}"><span class="grow">${Aero.esc(TM.groupLabel(n))}</span><span class="dim gmem">${Aero.esc(G[n].slice(0, 6).join(' '))}${G[n].length > 6 ? '…' : ''}</span></div>`).join('');
    };
    $('leftList').innerHTML = sec('public.kern1.', 'Left side of pair (kern1)') + sec('public.kern2.', 'Right side of pair (kern2)');
    $('leftBar').innerHTML = `<button class="aero-iconbtn" id="gNew" title="New group">＋ New</button><button class="aero-iconbtn" id="gEdit" title="Edit group members">✎ Edit</button><button class="aero-iconbtn" id="gDel" title="Delete group">✕</button>`;
    $('gNew').onclick = () => groupDialog(null); $('gEdit').onclick = () => gsel && groupDialog(gsel); $('gDel').onclick = () => gsel && deleteGroup(gsel);
  }
  A.buildKernGroups = buildGroups;
  function deleteGroup(n) {
    A.change('Delete Group', d => { d.setGroup(n, null); const k = d.kerning(); if (k[n]) delete k[n]; Object.keys(k).forEach(l => { if (n in k[l]) { k[l] = Object.assign({}, k[l]); delete k[l][n]; if (!Object.keys(k[l]).length) delete k[l]; } }); });
    gsel = null;
  }
  // set membership: a glyph may only be in one group per side
  A.setGroupMembers = (d, gname, members) => {
    const pre = gname.slice(0, 13), G = d.groups();
    Object.keys(G).forEach(k => { if (k !== gname && k.startsWith(pre) && G[k].some(n => members.includes(n))) G[k] = G[k].filter(n => !members.includes(n)); });
    d.setGroup(gname, members);
  };
  function groupDialog(n) {
    const isNew = !n, side = n ? (n.startsWith('public.kern1.') ? '1' : '2') : '1';
    const preset = n ? A.font.groups[n].join(' ') : (A.sel.length ? A.sel.join(' ') : (A.kernSel ? A.kernSel.l : ''));
    Aero.dialog({ title: isNew ? 'New Kerning Group' : 'Edit Kerning Group', instruction: 'A glyph can belong to one left-side and one right-side group. Kerning set between groups applies to all members.', width: 460,
      fields: [{ key: 'name', label: 'Name', type: 'text', value: n ? n.replace(/^public\.kern[12]\./, '') : (preset.split(' ')[0] || 'A') }, { key: 'side', label: 'Used when the glyph is', type: 'select', value: side, options: [['1', 'on the left of a pair (kern1)'], ['2', 'on the right of a pair (kern2)']] }, { key: 'mem', label: 'Members (glyph names)', type: 'textarea', value: preset }],
      onOK: v => {
        const name = String(v.name || '').trim().replace(/\s+/g, '_'); if (!/^[^\s]{1,60}$/.test(name)) return A.toast('Invalid group name');
        const gname = 'public.kern' + v.side + '.' + name;
        const mem = [...new Set(String(v.mem || '').split(/[\s,]+/).filter(x => A.glyph(x)))];
        if (!mem.length) return A.toast('Add at least one existing glyph');
        if (gname !== n && A.font.groups[gname]) return A.toast('A group with that name already exists');
        A.change(isNew ? 'New Group' : 'Edit Group', d => {
          if (n && gname !== n) {   // rename: move kerning entries
            const k = d.kerning(); if (k[n]) { k[gname] = k[n]; delete k[n]; }
            Object.keys(k).forEach(l => { if (n in k[l]) { k[l] = Object.assign({}, k[l]); k[l][gname] = k[l][n]; delete k[l][n]; } });
            d.setGroup(n, null);
          }
          A.setGroupMembers(d, gname, mem);
        });
        gsel = gname;
      } });
  }

  A.initKerning = () => {
    initCanvas(); initPairList();
    $('leftList').addEventListener('click', e => {
      if (A.view !== 'kern') return;
      const it = e.target.closest('.aero-item'); if (!it || !it.dataset.g) return;
      gsel = it.dataset.g; buildGroups();
      const mem = (A.font.groups[gsel] || []).filter(n => A.glyph(n)); if (!mem.length || !A.kernSel) return;
      if (gsel.startsWith('public.kern1.')) A.selectKernPair(mem[0], A.kernSel.r); else A.selectKernPair(A.kernSel.l, mem[0]);
    });
    $('leftList').addEventListener('dblclick', e => { if (A.view !== 'kern') return; const it = e.target.closest('.aero-item'); if (it && it.dataset.g) groupDialog(it.dataset.g); });
    A.on('view', v => { if (v === 'kern') { buildTop(); buildGroups(); redraw(); setTimeout(() => cv.focus()); } });
    A.on('change', () => { if (A.kernSel && (!A.glyph(A.kernSel.l) || !A.glyph(A.kernSel.r))) A.kernSel = null; if (A.view === 'kern') { if (!document.activeElement || document.activeElement.id !== 'kVal') buildTop(); buildGroups(); redraw(); } A.buildPairList(); });
    A.on('font', () => { A.kernSel = null; gsel = null; mode = null; });
  };
})();
