'use strict';
/* Lumen Type — font overview: virtualised glyph grid, category / Unicode-block filters, search. */
(function () {
  const A = window.LT, TM = window.TM, $ = id => document.getElementById(id);
  const CATS = [['all', 'All glyphs'], ['upper', 'Uppercase letters'], ['lower', 'Lowercase letters'], ['figure', 'Figures'], ['punct', 'Punctuation'], ['symbol', 'Symbols'], ['mark', 'Marks'], ['space', 'Separators'], ['unencoded', 'Unencoded'], ['composite', 'Composites'], ['marked', 'Color-marked']];
  let items = [], itemsKey = null;
  const LABEL_H = 18;

  function compute() {
    const F = A.font, f = A.filter; if (!F) return [];
    let out;
    if (f.kind === 'block' && f.block) {
      const b = TM.UNI.blocks.find(x => x[0] === f.block) || TM.UNI.blocks[0], cmap = TM.cmapOf(F);
      out = [];
      for (let cp = b[1]; cp <= b[2]; cp++) { if (!TM.UNI.names.has(cp)) continue; const n = cmap.get(cp); out.push(n ? { name: n } : { missing: true, cp, name: TM.glyphNameFor(cp) }); }
    } else {
      const k = f.kind;
      out = F.order.filter(n => {
        const g = F.glyphs[n], u = g.unicodes[0];
        if (k === 'all') return true; if (k === 'unencoded') return !g.unicodes.length; if (k === 'composite') return g.components.length > 0; if (k === 'marked') return g.mark != null;
        return u != null && TM.category(u) === k;
      }).map(n => ({ name: n }));
    }
    const q = f.q.trim();
    if (q) {
      let cpq = null; const m = /^(?:u\+|U\+|0x)?([0-9a-fA-F]{4,6})$/.exec(q); if (m && /^(u\+|0x)/i.test(q)) cpq = parseInt(m[1], 16);
      const single = [...q].length === 1 ? q.codePointAt(0) : null, ql = q.toLowerCase();
      out = out.filter(it => {
        const g = F.glyphs[it.name], us = it.missing ? [it.cp] : g ? g.unicodes : [];
        if (single != null) return us.includes(single) || it.name.toLowerCase() === ql;
        if (cpq != null) return us.includes(cpq);
        return it.name.toLowerCase().includes(ql) || us.some(u => TM.uniName(u).toLowerCase().includes(ql));
      });
    }
    return out;
  }
  function getItems() {
    const key = A.font && [A.font.order, A.font.glyphs, A.filter.kind, A.filter.block, A.filter.q].map(x => typeof x === 'object' ? x : String(x));
    if (!itemsKey || !key || key.some((v, i) => v !== itemsKey[i])) { items = compute(); itemsKey = key; }
    return items;
  }
  A.visibleItems = getItems;
  A.visibleNames = () => getItems().filter(i => !i.missing).map(i => i.name);

  // ---------- grid ----------
  const geo = () => { const sc = $('gridScroll'), cw = A.prefs.cell, ch = cw + LABEL_H, cols = Math.max(1, Math.floor((sc.clientWidth - 2) / cw)); return { sc, cw, ch, cols }; };
  function drawGrid() {
    const cv = $('gridCv'); if (!A.font || A.view !== 'font') return;
    const its = getItems(), { sc, cw, ch, cols } = geo();
    const rows = Math.ceil(its.length / cols);
    $('gridSpace').style.height = (rows * ch + 8) + 'px';
    const { ctx, w, h } = A.R.sizeCanvas(cv);
    cv.style.marginBottom = -h + 'px';
    ctx.fillStyle = '#f7f9fc'; ctx.fillRect(0, 0, w, h);
    const F = A.font, I = F.info, top = sc.scrollTop;
    const r0 = Math.floor(top / ch), r1 = Math.min(rows, Math.ceil((top + h) / ch));
    const ox = Math.floor((w - cols * cw) / 2);
    const em = (I.ascender - I.descender) || I.unitsPerEm, selSet = new Set(A.sel);
    ctx.font = '10px "Segoe UI", Tahoma, sans-serif'; ctx.textBaseline = 'middle';
    for (let r = r0; r < r1; r++) for (let c = 0; c < cols; c++) {
      const i = r * cols + c; if (i >= its.length) break;
      const it = its[i], x = ox + c * cw, y = r * ch - top;
      const sel = selSet.has(it.name) && !it.missing;
      // cell background
      ctx.fillStyle = sel ? '#dcebfc' : '#fff'; ctx.fillRect(x + 1, y + 1, cw - 2, ch - 2);
      ctx.strokeStyle = sel ? '#7da2ce' : '#d5dee9'; ctx.lineWidth = 1;
      if (it.missing) ctx.setLineDash([3, 3]);
      ctx.strokeRect(x + 1.5, y + 1.5, cw - 3, ch - 3); ctx.setLineDash([]);
      // label strip
      ctx.fillStyle = sel ? '#c3dbf7' : it.missing ? '#f5f7fa' : '#edf2f8'; ctx.fillRect(x + 2, y + ch - LABEL_H, cw - 4, LABEL_H - 2);
      const g = !it.missing && F.glyphs[it.name];
      if (g && g.mark != null && A.MARKS[g.mark]) { ctx.fillStyle = A.MARKS[g.mark]; ctx.fillRect(x + 2, y + 2, cw - 4, 4); }
      ctx.fillStyle = it.missing ? '#9aa6b4' : '#2b3c52';
      let label = it.name; while (label.length > 2 && ctx.measureText(label).width > cw - 8) label = label.slice(0, -2) + '…';
      ctx.textAlign = 'center'; ctx.fillText(label, x + cw / 2, y + ch - LABEL_H / 2 - 1);
      if (g) {
        let s = (cw - 14) / em; const adv = Math.max(g.advance, 1);
        if (adv * s > cw - 10) s = (cw - 10) / adv;
        const gx = x + cw / 2 - g.advance * s / 2, base = y + 6 + (cw - 14) * I.ascender / em + 2;
        if (A.prefs.metrics && cw >= 60) { ctx.fillStyle = 'rgba(120,150,190,.10)'; ctx.fillRect(gx, base - I.ascender * s, g.advance * s, (I.ascender - I.descender) * s); }
        A.R.drawGlyph(ctx, F, g, gx, base, s, g.name === A.cur ? '#0b3f80' : '#141a22');
        if (!g.contours.length && !g.components.length && g.unicodes[0] !== 32 && !/space/i.test(g.name)) { ctx.fillStyle = '#c7d0db'; ctx.font = `${Math.round(cw * 0.36)}px "Segoe UI", sans-serif`; ctx.fillText(g.unicodes.length ? String.fromCodePoint(g.unicodes[0]) : '?', x + cw / 2, y + (ch - LABEL_H) / 2 + 2); ctx.font = '10px "Segoe UI", Tahoma, sans-serif'; }
        if (g.components.length) { ctx.fillStyle = '#4c7bb3'; ctx.beginPath(); ctx.arc(x + cw - 9, y + 11, 3, 0, 7); ctx.fill(); }
      } else if (it.missing) {
        ctx.fillStyle = '#d0d8e2'; ctx.font = `${Math.round(cw * 0.38)}px "Segoe UI", sans-serif`;
        ctx.fillText(String.fromCodePoint(it.cp), x + cw / 2, y + (ch - LABEL_H) / 2 + 2); ctx.font = '10px "Segoe UI", Tahoma, sans-serif';
      }
      if (g && g.name === A.cur) { ctx.strokeStyle = '#3a78c9'; ctx.setLineDash([2, 2]); ctx.strokeRect(x + 3.5, y + 3.5, cw - 7, ch - 7); ctx.setLineDash([]); }
    }
    ctx.textAlign = 'left';
    A.status(2, `${its.filter(i => !i.missing).length} of ${F.order.length} glyphs shown` + (its.some(i => i.missing) ? ` · ${its.filter(i => i.missing).length} missing in block` : ''));
    A.status(3, A.sel.length ? `${A.sel.length} selected` : '');
  }
  let raf = 0;
  A.redrawGrid = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; drawGrid(); }); };
  function hit(e) {
    const { sc, cw, ch, cols } = geo(), r = sc.getBoundingClientRect();
    const ox = Math.floor((sc.clientWidth - cols * cw) / 2);
    const x = e.clientX - r.left - ox, y = e.clientY - r.top + sc.scrollTop;
    if (x < 0 || x >= cols * cw) return -1;
    const i = Math.floor(y / ch) * cols + Math.floor(x / cw);
    return i < getItems().length ? i : -1;
  }
  // create a missing glyph (composite if the Unicode decomposition allows)
  A.createMissing = (it) => {
    let name = it.name; if (A.glyph(name)) name = TM.uniqueName(A.font, name);
    A.change('New Glyph ' + name, d => {
      const comp = it.cp != null ? TM.buildComposite(d.font, name, it.cp) : null;
      d.addGlyph(comp || A.newGlyphFor(d.font, it.cp, name), insertIndexFor(d.font, it.cp));
    });
    return name;
  };
  // keep encoded glyphs roughly in Unicode order when adding
  function insertIndexFor(font, cp) {
    if (cp == null) return font.order.length;
    let best = -1, bestCp = -1;
    font.order.forEach((n, i) => { const u = font.glyphs[n].unicodes[0]; if (u != null && u < cp && u > bestCp) { bestCp = u; best = i; } });
    return best + 1;
  }
  A.insertIndexFor = insertIndexFor;
  function openItem(it) { if (it.missing) { const n = A.createMissing(it); A.openGlyph(n); } else A.openGlyph(it.name); }
  function select(i, e) {
    const its = getItems(), it = its[i]; if (!it || it.missing) { A.sel = []; A.emit('sel'); return; }
    if (e && (e.ctrlKey || e.metaKey)) { A.sel = A.sel.includes(it.name) ? A.sel.filter(n => n !== it.name) : [...A.sel, it.name]; A.anchor = i; }
    else if (e && e.shiftKey && A.anchor != null) { const [a, b] = [Math.min(A.anchor, i), Math.max(A.anchor, i)]; A.sel = its.slice(a, b + 1).filter(x => !x.missing).map(x => x.name); }
    else { A.sel = [it.name]; A.anchor = i; }
    A.cur = it.name; A.emit('sel'); A.emit('cur');
  }
  function ensureVisible(i) {
    const { sc, ch, cols } = geo(), y = Math.floor(i / cols) * ch;
    if (y < sc.scrollTop) sc.scrollTop = y; else if (y + ch > sc.scrollTop + sc.clientHeight) sc.scrollTop = y + ch - sc.clientHeight;
  }
  function contextMenu(e, i) {
    const it = getItems()[i]; if (!it) return;
    e.preventDefault();
    if (!it.missing && !A.sel.includes(it.name)) select(i);
    const m = Aero.el('div', 'aero-menu ctx'); m.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;display:block;z-index:60`;
    const add = (label, fn, dis) => { const d = Aero.el('div', 'aero-mi' + (dis ? ' dis' : ''), `<span class="ml">${Aero.esc(label)}</span>`); if (!dis) d.onclick = () => { m.remove(); fn(); }; m.appendChild(d); };
    if (it.missing) { add('Create ' + it.name, () => { const n = A.createMissing(it); A.cur = n; A.sel = [n]; A.emit('sel'); }); add('Create && Edit', () => openItem(it)); }
    else {
      add('Edit Glyph', () => A.openGlyph(it.name)); add('Duplicate', () => A.duplicateGlyphs()); add('Build Composite', () => A.buildComposites(A.sel), !A.sel.some(n => (A.glyph(n).unicodes[0] != null) && TM.compositeRecipe(A.font, A.glyph(n).unicodes[0])));
      add('Delete', () => A.deleteGlyphs());
      const row = Aero.el('div', 'ctx-marks'); A.MARKS.forEach((c, k) => { const s = Aero.el('span', 'mk' + (k ? '' : ' none')); if (c) s.style.background = c; s.title = k ? 'Mark color' : 'No mark'; s.onclick = () => { m.remove(); A.setMark(A.sel, k || null); }; row.appendChild(s); }); m.appendChild(row);
    }
    document.body.appendChild(m); setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }));
  }

  // ---------- glyph-level actions ----------
  A.setMark = (names, k) => A.change('Mark Color', d => names.forEach(n => { const g = d.glyph(n); if (!g) return; if (k == null) delete g.mark; else g.mark = k; }));
  A.deleteGlyphs = async (names = A.sel.slice()) => {
    names = names.filter(n => A.glyph(n)); if (!names.length) return;
    if (names.includes('.notdef')) { A.toast('.notdef cannot be deleted'); names = names.filter(n => n !== '.notdef'); if (!names.length) return; }
    const users = TM.componentUsers(A.font), affected = [...new Set(names.flatMap(n => users.get(n) || []))].filter(n => !names.includes(n));
    if (affected.length && !await Aero.confirm('Delete glyphs', `${affected.length} other glyph(s) use these as components (${affected.slice(0, 6).join(', ')}${affected.length > 6 ? '…' : ''}). They will be decomposed first.`)) return;
    A.change(names.length === 1 ? 'Delete ' + names[0] : `Delete ${names.length} Glyphs`, d => {
      affected.forEach(n => { const g = d.glyph(n); TM.decompose(d.font, g); });
      names.forEach(n => d.removeGlyph(n));
    });
    A.sel = []; if (!A.glyph(A.cur)) A.cur = A.font.order[Math.min(A.font.order.length - 1, 1)];
    A.emit('sel'); A.emit('cur');
  };
  A.duplicateGlyphs = (names = A.sel.slice()) => {
    if (!names.length) return; const made = [];
    A.change('Duplicate', d => names.forEach(n => { const g = TM.cloneGlyph(d.font.glyphs[n]); g.name = TM.uniqueName(d.font, n); g.unicodes = []; delete g.mark; d.addGlyph(g, d.font.order.indexOf(n) + 1); made.push(g.name); }));
    A.sel = made; A.emit('sel');
  };
  A.buildComposites = (names) => {
    let n = 0, skipped = 0;
    A.change('Build Composites', d => {
      names.forEach(nm => { const g = d.font.glyphs[nm]; const cp = g && g.unicodes[0]; const c = cp != null && TM.buildComposite(d.font, nm, cp); if (!c) { skipped++; return; } const gg = d.glyph(nm); gg.contours = []; gg.components = c.components; gg.advance = c.advance; n++; });
      if (!n) return false;
    });
    A.toast(n ? `Built ${n} composite${n > 1 ? 's' : ''}` + (skipped ? ` (${skipped} without a recipe)` : '') : 'No composite recipe for the selection (needs base letter + accent glyphs)');
  };
  A.createBlockMissing = () => {
    const miss = getItems().filter(i => i.missing); if (!miss.length) return A.toast('Nothing missing in this view');
    let made = 0, comps = 0;
    A.change(`Add ${miss.length} Glyphs`, d => miss.forEach(it => { if (d.font.glyphs[it.name]) return; const c = TM.buildComposite(d.font, it.name, it.cp); if (c) comps++; d.addGlyph(c || A.newGlyphFor(d.font, it.cp, it.name), insertIndexFor(d.font, it.cp)); made++; }));
    A.toast(`Added ${made} glyphs (${comps} built as composites)`);
  };
  A.newGlyphDialog = () => Aero.dialog({
    title: 'New Glyph', instruction: 'Type characters or glyph names (separated by spaces) to add several at once.',
    fields: [{ key: 'v', label: 'Characters or names', type: 'text', value: '' }, { key: 'comp', label: 'Build composites where possible', type: 'checkbox', value: true }],
    onOK: v => {
      const toks = []; String(v.v || '').trim().split(/\s+/).forEach(t => { if (!t) return; if (TM.validName(t) && t.length > 1) toks.push({ name: t, cp: TM.unicodeForName(t) }); else for (const ch of t) { const cp = ch.codePointAt(0); toks.push({ name: TM.glyphNameFor(cp), cp }); } });
      if (!toks.length) return;
      const cmap = TM.cmapOf(A.font), added = [];
      A.change('New Glyph', d => {
        toks.forEach(t => {
          if (t.cp != null && cmap.has(t.cp)) return; if (d.font.glyphs[t.name]) return;
          const c = v.comp && t.cp != null ? TM.buildComposite(d.font, t.name, t.cp) : null;
          d.addGlyph(c || A.newGlyphFor(d.font, t.cp, t.name), insertIndexFor(d.font, t.cp)); added.push(t.name); if (t.cp != null) cmap.set(t.cp, t.name);
        });
        if (!added.length) return false;
      });
      if (!added.length) return A.toast('Those glyphs already exist');
      A.sel = added; A.cur = added[0]; A.emit('sel'); A.emit('cur'); A.toast(`Added ${added.length} glyph${added.length > 1 ? 's' : ''}`);
    }
  });

  // ---------- left filter list ----------
  function buildLeft() {
    if (A.view !== 'font' && A.view !== 'glyph') return;
    const L = $('leftList'), F = A.font; if (!F) return;
    $('leftTitle').textContent = 'Glyphs'; $('leftCount').textContent = F.order.length;
    const cmapCps = new Set(); F.order.forEach(n => F.glyphs[n].unicodes.forEach(u => cmapCps.add(u)));
    const cnt = {}; CATS.forEach(([k]) => cnt[k] = 0);
    F.order.forEach(n => { const g = F.glyphs[n], u = g.unicodes[0]; cnt.all++; if (!g.unicodes.length) cnt.unencoded++; else cnt[TM.category(u)] = (cnt[TM.category(u)] || 0) + 1; if (g.components.length) cnt.composite++; if (g.mark != null) cnt.marked++; });
    let h = '<div class="lgroup">Categories</div>';
    CATS.forEach(([k, label]) => { if (k !== 'all' && !cnt[k] && !['upper', 'lower', 'figure', 'punct'].includes(k)) return; h += `<div class="aero-item${A.filter.kind === k ? ' sel' : ''}" data-k="${k}"><span class="grow">${label}</span><span class="dim">${cnt[k] || 0}</span></div>`; });
    h += '<div class="lgroup">Unicode blocks</div>';
    TM.UNI.blocks.forEach(([name, a, b, total]) => {
      let have = 0; for (let c = a; c <= b; c++) if (cmapCps.has(c)) have++;
      const pct = Math.round(have / total * 100);
      h += `<div class="aero-item blk${A.filter.kind === 'block' && A.filter.block === name ? ' sel' : ''}" data-b="${Aero.esc(name)}" title="${Aero.esc(name)}: ${have} of ${total} characters"><span class="grow">${Aero.esc(name)}</span><span class="cov"><i style="width:${pct}%"></i></span><span class="dim">${have}/${total}</span></div>`;
    });
    L.innerHTML = h;
    $('leftBar').innerHTML = '';
  }
  A.buildLeftGlyphs = buildLeft;

  A.initFontView = () => {
    const sc = $('gridScroll');
    sc.addEventListener('scroll', A.redrawGrid);
    new ResizeObserver(A.redrawGrid).observe(sc);
    sc.addEventListener('mousedown', e => { sc.focus(); if (e.button !== 0) return; const i = hit(e); if (i < 0) { A.sel = []; A.emit('sel'); return; } select(i, e); if (e.detail >= 2) openItem(getItems()[i]); });
    sc.addEventListener('contextmenu', e => { const i = hit(e); if (i >= 0) contextMenu(e, i); else e.preventDefault(); });
    sc.addEventListener('mousemove', e => { const i = hit(e), it = getItems()[i]; if (!it) { A.status(4, ''); return; } const g = A.glyph(it.name), cp = it.missing ? it.cp : g && g.unicodes[0]; A.status(4, `${it.name}${cp != null ? ' · U+' + TM.hex(cp) + ' ' + TM.uniName(cp) : ''}${it.missing ? ' · missing (double-click to create)' : ''}`); });
    sc.addEventListener('keydown', e => {
      if (A.view !== 'font') return;
      const its = getItems(), { cols } = geo(); let i = A.anchor != null ? A.anchor : its.findIndex(x => x.name === A.cur);
      const mv = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }[e.key];
      if (mv) { e.preventDefault(); e.stopPropagation(); i = Math.max(0, Math.min(its.length - 1, (i < 0 ? 0 : i) + mv)); select(i, e.shiftKey ? { shiftKey: true } : null); A.anchor = e.shiftKey ? A.anchor : i; ensureVisible(i); }
      else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); openItem(its[i]); }
    });
    $('leftList').addEventListener('click', e => {
      if (A.view !== 'font' && A.view !== 'glyph') return;
      const it = e.target.closest('.aero-item'); if (!it) return;
      if (it.dataset.k) A.filter = { ...A.filter, kind: it.dataset.k, block: null };
      else if (it.dataset.b) A.filter = { ...A.filter, kind: 'block', block: it.dataset.b };
      $('gridScroll').scrollTop = 0; A.anchor = null;
      if (A.view !== 'font') A.setView('font');
      A.emit('filter');
    });
    const redrawAll = () => { A.redrawGrid(); };
    A.on('change', () => { redrawAll(); buildLeft(); }); A.on('sel', redrawAll); A.on('cur', redrawAll); A.on('filter', () => { buildLeft(); redrawAll(); });
    A.on('view', v => { if (v === 'font') { buildLeft(); redrawAll(); setTimeout(() => sc.focus()); } else if (v === 'glyph') buildLeft(); });
    A.on('font', buildLeft);
  };
})();
