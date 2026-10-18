'use strict';
/* Lumen Type — right-hand panels: glyph properties, selection, components, groups; history list; panel tabs. */
(function () {
  const A = window.LT, TM = window.TM, $ = id => document.getElementById(id);
  const ICON = {
    rev: '<path d="M4 8h12l-3-3M20 16H8l3 3"/>', dir: '<circle cx="12" cy="12" r="7"/><path d="M12 5l3-2M12 5l3 2"/>', ovl: '<rect x="3" y="3" width="11" height="11"/><rect x="10" y="10" width="11" height="11"/>',
    ext: '<path d="M4 18C4 8 20 8 20 18"/><circle cx="12" cy="10.5" r="2"/>', rnd: '<path d="M5 5h14v14H5z"/><path d="M9 9h6v6H9z"/>', fh: '<path d="M12 3v18M9 7 4 12l5 5M15 7l5 5-5 5"/>', fv: '<path d="M3 12h18M7 9l5-5 5 5M7 15l5 5 5-5"/>',
    q: '<path d="M4 18Q12 2 20 18"/><circle cx="12" cy="4" r="1.6"/>', c: '<path d="M4 18C6 4 18 4 20 18"/><circle cx="6.5" cy="5" r="1.5"/><circle cx="17.5" cy="5" r="1.5"/>', tf: '<path d="M5 19 19 5M14 5h5v5M5 14v5h5"/>',
  };
  const ib = (id, title, icon) => `<button class="aero-iconbtn" data-act="${id}" title="${title}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON[icon]}</svg></button>`;
  const num = (id, v, title, w = 58) => `<input type="number" id="${id}" value="${v}" title="${title || ''}" style="width:${w}px">`;

  function build() {
    const P = $('pProps'); if (!A.font || $('pProps').hidden) return;
    if (P.contains(document.activeElement) && document.activeElement.tagName !== 'BUTTON') return;
    const g = A.glyph(A.cur);
    if (!g) { P.innerHTML = '<div class="dim" style="padding:10px">No glyph selected</div>'; return; }
    const F = A.font, sb = TM.sidebearings(F, g), ix = TM.groupIndex(F), u = g.unicodes[0];
    const gk1 = (ix.k1.get(g.name) || '').replace('public.kern1.', ''), gk2 = (ix.k2.get(g.name) || '').replace('public.kern2.', '');
    let h = '';
    if (A.view === 'font' && A.sel.length > 1) h += `<div class="pnote">${A.sel.length} glyphs selected — showing <b>${Aero.esc(g.name)}</b></div>`;
    h += `<div class="gcard"><canvas id="gThumb" width="96" height="96"></canvas><div class="gmeta"><div class="gbig">${Aero.esc(g.name)}</div><div class="dim">${u != null ? 'U+' + TM.hex(u) + ' · ' + Aero.esc(TM.uniName(u).toLowerCase() || '') : 'unencoded'}</div><div class="dim">${g.contours.length} contours · ${g.components.length} components</div></div></div>`;
    h += `<div class="psub">Glyph</div>
      <div class="prow"><span class="lbl">Name</span><input type="text" id="pName" value="${Aero.esc(g.name)}" class="grow1"></div>
      <div class="prow"><span class="lbl">Unicode</span><input type="text" id="pUni" value="${g.unicodes.map(x => TM.hex(x)).join(' ')}" class="grow1 mono" placeholder="e.g. 0041"></div>`;
    h += `<div class="psub">Metrics</div>
      <div class="prow mets"><label>LSB ${num('pLSB', sb.lsb, 'Left sidebearing')}</label><label>Width ${num('pAdv', g.advance, 'Advance width')}</label><label>RSB ${num('pRSB', sb.rsb, 'Right sidebearing')}</label></div>
      <div class="prow"><button class="aero-btn small" id="pCenter" title="Make both sidebearings equal">Center</button><button class="aero-btn small" id="pCopyM" title="Copy width and sidebearings from another glyph">Copy from…</button></div>`;
    h += `<div class="psub">Kerning groups</div>
      <div class="prow"><span class="lbl" title="Group used when this glyph is the FIRST (left) glyph of a pair">As left</span><input type="text" id="pK1" value="${Aero.esc(gk1)}" list="dlK1" placeholder="none" class="grow1"></div>
      <div class="prow"><span class="lbl" title="Group used when this glyph is the SECOND (right) glyph of a pair">As right</span><input type="text" id="pK2" value="${Aero.esc(gk2)}" list="dlK2" placeholder="none" class="grow1"></div>
      <datalist id="dlK1">${Object.keys(F.groups).filter(k => k.startsWith('public.kern1.')).map(k => `<option value="${Aero.esc(k.slice(13))}">`).join('')}</datalist>
      <datalist id="dlK2">${Object.keys(F.groups).filter(k => k.startsWith('public.kern2.')).map(k => `<option value="${Aero.esc(k.slice(13))}">`).join('')}</datalist>`;
    h += `<div class="psub">Mark</div><div class="marks">${A.MARKS.map((c, k) => `<span class="mk${k ? '' : ' none'}${(g.mark ?? 0) === k || (!k && g.mark == null) ? ' on' : ''}" data-mk="${k}" ${c ? `style="background:${c}"` : ''}></span>`).join('')}</div>`;
    if (A.view === 'glyph') {
      const pts = A.E.selectedPoints();
      h += `<div class="psub">Selection</div>`;
      if (pts.length === 1) {
        const p = pts[0].p;
        h += `<div class="prow"><label>X ${num('pX', Math.round(p.x))}</label><label>Y ${num('pY', Math.round(p.y))}</label>${p.t !== 'o' ? `<label title="Smooth (tangent) point — double-click a point to toggle"><input type="checkbox" id="pSmooth"${p.s ? ' checked' : ''}> Smooth</label>` : '<span class="dim">off-curve</span>'}</div>`;
      } else if (pts.length > 1) {
        const b = A.ed.selectionBox();
        h += `<div class="prow"><label>X ${num('pBX', Math.round(b.xMin))}</label><label>Y ${num('pBY', Math.round(b.yMin))}</label><span class="dim">${pts.length} pts · ${Math.round(b.xMax - b.xMin)}×${Math.round(b.yMax - b.yMin)}</span></div>`;
      } else h += `<div class="dim small">Click points, drag a marquee, or double-click a segment to select a contour.</div>`;
      h += `<div class="brow">${ib('reverse', 'Reverse contour direction', 'rev')}${ib('correctDirection', 'Correct path direction (Ctrl+Shift+R)', 'dir')}${ib('removeOverlap', 'Remove overlap (Ctrl+Shift+O)', 'ovl')}${ib('addExtremes', 'Add extreme points', 'ext')}${ib('round', 'Round coordinates', 'rnd')}${ib('flipH', 'Flip horizontally', 'fh')}${ib('flipV', 'Flip vertically', 'fv')}${ib('transformDialog', 'Transform…', 'tf')}${ib('toQuadratic', 'Convert to quadratic (TrueType) curves', 'q')}${ib('toCubic', 'Convert to cubic (PostScript) curves', 'c')}</div>`;
      h += `<div class="psub">Components <button class="aero-btn small right" id="pAddComp">Add…</button></div>`;
      if (!g.components.length) h += `<div class="dim small">None. Components reuse another glyph (e.g. A + acute → Aacute).</div>`;
      g.components.forEach((c, i) => {
        h += `<div class="crow${A.E.csel.has(i) ? ' sel' : ''}" data-ci="${i}"><a href="#" data-goto="${Aero.esc(c.base)}" title="Edit ${Aero.esc(c.base)}">${Aero.esc(c.base)}</a>${A.glyph(c.base) ? '' : ' <span class="bad">missing</span>'}<span class="grow"></span><label>x ${num('cx' + i, Math.round(c.m[4]), 'Offset X', 50)}</label><label>y ${num('cy' + i, Math.round(c.m[5]), 'Offset Y', 50)}</label><button class="aero-btn small" data-dec="${i}" title="Decompose this component">⇲</button></div>`;
      });
      const users = TM.componentUsers(F).get(g.name);
      if (users && users.length) h += `<div class="dim small" style="margin-top:4px">Used by: ${users.slice(0, 12).map(n => `<a href="#" data-goto="${Aero.esc(n)}">${Aero.esc(n)}</a>`).join(', ')}${users.length > 12 ? ' …' : ''}</div>`;
    }
    h += `<div class="psub">Note</div><textarea id="pNote" rows="2" placeholder="Notes for this glyph">${Aero.esc(g.note || '')}</textarea>`;
    P.innerHTML = h;
    // thumbnail
    const tc = $('gThumb').getContext('2d'), I = F.info, em = I.ascender - I.descender, s = Math.min(84 / em, 84 / Math.max(g.advance, 1));
    tc.fillStyle = '#fff'; tc.fillRect(0, 0, 96, 96); tc.strokeStyle = '#e1e8f0'; tc.strokeRect(.5, .5, 95, 95);
    A.R.drawGlyph(tc, F, g, 48 - g.advance * s / 2, 6 + (84 - em * s) / 2 + I.ascender * s, s, '#14202e');
    wire(g);
  }
  function wire(g) {
    const F = A.font, name = g.name;
    $('pName').onchange = e => {
      const nu = e.target.value.trim(); if (nu === name) return;
      if (!TM.validName(nu)) { A.toast('Glyph names may use A–Z a–z 0–9 . _ - (max 63)'); e.target.value = name; return; }
      if (A.glyph(nu)) { A.toast('A glyph named ' + nu + ' already exists'); e.target.value = name; return; }
      A.change('Rename ' + name, d => { if (!d.renameGlyph(name, nu)) return false; }); A.cur = nu; A.sel = A.sel.map(n => n === name ? nu : n); A.emit('cur');
    };
    $('pUni').onchange = e => {
      const toks = e.target.value.trim().split(/[\s,]+/).filter(Boolean), us = [];
      for (const t of toks) { const v = parseInt(t.replace(/^(u\+|0x)/i, ''), 16); if (!isFinite(v) || v < 0 || v > 0x10FFFF) { A.toast('Invalid code point: ' + t); e.target.value = g.unicodes.map(x => TM.hex(x)).join(' '); return; } us.push(v); }
      const clash = F.order.find(n => n !== name && F.glyphs[n].unicodes.some(x => us.includes(x)));
      A.change('Set Unicode', d => { d.glyph(name).unicodes = us; if (clash) { const c = d.glyph(clash); c.unicodes = c.unicodes.filter(x => !us.includes(x)); } });
      if (clash) A.toast(`Code point moved from ${clash}`);
    };
    const met = (id, fn, label) => { $(id).onchange = e => { const v = Math.round(+e.target.value); if (!isFinite(v)) return build(); A.change(label, d => fn(d.glyph(name), v, d)); }; };
    met('pLSB', (gg, v, d) => TM.setLSB(d.font, gg, v), 'Set LSB'); met('pRSB', (gg, v, d) => TM.setRSB(d.font, gg, v), 'Set RSB'); met('pAdv', (gg, v) => { gg.advance = Math.max(0, v); }, 'Set Width');
    $('pCenter').onclick = () => A.change('Center Glyph', d => { const gg = d.glyph(name), sb = TM.sidebearings(d.font, gg); if (!sb.bounds) return false; const t = Math.round((sb.lsb + sb.rsb) / 2); TM.setLSB(d.font, gg, t); TM.setRSB(d.font, gg, t); });
    $('pCopyM').onclick = async () => { const src = await Aero.prompt('Copy metrics', 'Copy width & sidebearings from glyph', ''); if (!src) return; const s = A.glyph(src.trim()); if (!s) return A.toast('No glyph named ' + src); const ssb = TM.sidebearings(F, s); A.change('Copy Metrics', d => { const gg = d.glyph(name); if (ssb.bounds && TM.sidebearings(d.font, gg).bounds) { TM.setLSB(d.font, gg, ssb.lsb); TM.setRSB(d.font, gg, ssb.rsb); } else gg.advance = s.advance; }); };
    const grp = (id, side) => { $(id).onchange = e => {
      const v = e.target.value.trim().replace(/\s+/g, '_'), pre = 'public.kern' + side + '.';
      A.change('Kerning Group', d => {
        const G = d.groups();
        Object.keys(G).forEach(k => { if (k.startsWith(pre) && G[k].includes(name)) G[k] = G[k].filter(n => n !== name); });
        if (v) { G[pre + v] = [...(G[pre + v] || []).filter(n => n !== name), name]; }
        Object.keys(G).forEach(k => { if (k.startsWith(pre) && !G[k].length && !Object.keys(d.font.kerning).some(l => l === k || d.font.kerning[l][k] != null)) delete G[k]; });
      });
    }; };
    grp('pK1', 1); grp('pK2', 2);
    $('pProps').querySelectorAll('[data-mk]').forEach(s => s.onclick = () => A.setMark(A.view === 'font' && A.sel.length > 1 ? A.sel : [name], +s.dataset.mk || null));
    $('pNote').onchange = e => A.change('Note', d => { const gg = d.glyph(name); if (e.target.value.trim()) gg.note = e.target.value; else delete gg.note; });
    if (A.view !== 'glyph') return;
    if ($('pX')) { const [{ c, i }] = A.E.selectedPoints(); const mv = () => A.change('Move Point', d => { const p = d.glyph(name).contours[c].points[i]; const nx = Math.round(+$('pX').value), ny = Math.round(+$('pY').value); if (!isFinite(nx) || !isFinite(ny)) return false; const dx = nx - p.x, dy = ny - p.y; p.x = nx; p.y = ny; if (p.t !== 'o') { const cc = d.glyph(name).contours[c]; TM.segments(cc).forEach(sg => { if (sg.t !== 'c') return; if (sg.a === i && sg.offs.length) { const h = cc.points[sg.offs[0]]; h.x += dx; h.y += dy; } if (sg.b === i && sg.offs.length) { const h = cc.points[sg.offs[sg.offs.length - 1]]; h.x += dx; h.y += dy; } }); } }); $('pX').onchange = mv; $('pY').onchange = mv; }
    if ($('pSmooth')) $('pSmooth').onchange = () => A.ed.toggleSmoothSel();
    if ($('pBX')) { const b = A.ed.selectionBox(); const mv = () => { const dx = Math.round(+$('pBX').value - b.xMin), dy = Math.round(+$('pBY').value - b.yMin); if (isFinite(dx) && isFinite(dy) && (dx || dy)) A.ed.nudge(dx, dy); }; $('pBX').onchange = mv; $('pBY').onchange = mv; }
    $('pProps').querySelectorAll('[data-act]').forEach(b => b.onclick = () => { const a = b.dataset.act; if (a === 'flipH') A.ed.flip('h'); else if (a === 'flipV') A.ed.flip('v'); else A.ed[a](); });
    $('pAddComp').onclick = () => A.ed.addComponentDialog();
    $('pProps').querySelectorAll('[data-goto]').forEach(a => a.onclick = e => { e.preventDefault(); A.openGlyph(a.dataset.goto); });
    $('pProps').querySelectorAll('[data-dec]').forEach(b => b.onclick = () => { A.E.csel.clear(); A.E.csel.add(+b.dataset.dec); A.ed.decompose(); });
    g.components.forEach((c, i) => { const f = () => A.change('Move Component', d => { const cm = d.glyph(name).components[i]; cm.m[4] = Math.round(+$('cx' + i).value) || 0; cm.m[5] = Math.round(+$('cy' + i).value) || 0; }); $('cx' + i).onchange = f; $('cy' + i).onchange = f; });
    $('pProps').querySelectorAll('.crow').forEach(r => r.addEventListener('click', e => { if (e.target.closest('input,button,a')) return; A.E.csel.clear(); A.E.sel.clear(); A.E.csel.add(+r.dataset.ci); A.redrawEditor(); build(); }));
  }
  let raf = 0;
  A.buildProps = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; build(); }); };

  function rightTab(t) {
    document.querySelectorAll('#rightTabs .aero-tab').forEach(x => x.classList.toggle('on', x.dataset.r === t));
    $('pProps').hidden = t !== 'props'; $('pPairs').hidden = t !== 'pairs'; $('histList').hidden = t !== 'hist';
    if (t === 'props') build(); if (t === 'pairs') A.buildPairList(); if (t === 'hist') renderHist();
  }
  A.rightTab = rightTab;
  function renderHist() { if ($('histList').hidden) return; Aero.renderHistory($('histList'), A.hist, i => { const s = A.hist.go(i); if (s) { A.font = s; A.emit('change', { undo: true }); } }); }
  A.initPanels = () => {
    $('rightTabs').addEventListener('click', e => { const t = e.target.closest('.aero-tab'); if (t) rightTab(t.dataset.r); });
    A.on('change', A.buildProps); A.on('cur', A.buildProps); A.on('esel', A.buildProps); A.on('sel', A.buildProps); A.on('live', A.buildProps);
    A.on('view', v => { if (v === 'kern' && !$('pProps').hidden) rightTab('pairs'); else if ((v === 'glyph' || v === 'font') && !$('pPairs').hidden) rightTab('props'); else build(); });
    A.on('history', renderHist);
  };
})();
