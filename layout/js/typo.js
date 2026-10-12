'use strict';
/* Lumen Layout — typography UI: the Tabs panel (a ruler docked above the text frame being edited, with
   left / center / right / decimal stops and leaders) and the Bullets and Numbering dialog. */
const Typo = (() => {
  const el = Aero.el, esc = Aero.esc;
  let panel = null, cur = { type: 'l', sel: -1 }, drag = null;
  const TYPES = [['l', 'Left-justified tab'], ['c', 'Center-justified tab'], ['r', 'Right-justified tab'], ['d', 'Align to decimal (or other specified character) tab']];
  const ICON = { l: 'M3 2v9h7', c: 'M7 2v9M2 11h10', r: 'M11 2v9H4', d: 'M7 2v9M2 11h10M10 7.5h1.6' };
  const svg = t => `<svg viewBox="0 0 14 13" width="14" height="13"><path d="${ICON[t]}" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
  // the text frame + column the panel is attached to
  function target() {
    let it = null, col = 0;
    if (S.edit) { it = S.eng.idx.get(S.edit.fid)?.item; const r = Tools.T.lineOf(S.edit.sid, S.edit.f); if (r) { it = r.it; col = r.ln.col || 0; } }
    else it = UI.selItems().find(i => i.type === 'text');
    if (!it) return null;
    const inf = S.eng.idx.get(it.id); if (!inf) return null;
    const pp = placedOf(inf.page); if (!pp) return null;
    const cols = Math.max(1, it.cols | 0 || 1), inset = it.inset || 0, g = it.gutter ?? 12, colW = (it.w - inset * 2 - g * (cols - 1)) / cols;
    return { it, pp, colL: inset + col * (colW + g), colW };
  }
  function tabs() { const c = UI.charState(); return c ? (c.pe.tabs || []).map(t => ({ ...t })) : []; }
  function setTabs(list, label = 'Tabs') { UI.applyPara({ tabs: list.sort((a, b) => a.x - b.x) }, label); }
  function open() {
    if (panel) { close(); return; }
    if (!target()) { Aero.toast('Select a text frame or place the text cursor first'); return; }
    panel = el('div', 'tabpanel');
    panel.innerHTML = `<div class="tp-row">${TYPES.map(([t, n]) => `<button class="aero-btn small tp-t" data-t="${t}" title="${esc(n)}">${svg(t)}</button>`).join('')}
      <label>X <input id="tp-x" type="text" style="width:58px" title="Position of the selected tab"></label><label>Leader <input id="tp-ld" type="text" maxlength="2" style="width:30px" title="Leader characters, e.g. ."></label>
      <label>Align On <input id="tp-ac" type="text" maxlength="1" style="width:24px" title="Decimal tab alignment character"></label>
      <button class="aero-btn small" id="tp-clear" title="Remove all tab stops">Clear All</button><span style="flex:1"></span><button class="aero-btn small" id="tp-close" title="Close (Ctrl+Shift+T)">✕</button></div><canvas class="tp-ruler"></canvas>`;
    $('#stagewrap').appendChild(panel);
    panel.querySelectorAll('.tp-t').forEach(b => b.onmousedown = e => { e.preventDefault(); cur.type = b.dataset.t; const L = tabs(); if (L[cur.sel]) { L[cur.sel].t = cur.type; setTabs(L, 'Tab Type'); } sync(); });
    const fx = $('#tp-x'), fl = $('#tp-ld'), fa = $('#tp-ac');
    fx.onchange = () => { const v = parseLen(fx.value); const L = tabs(); if (v == null) return sync(); if (L[cur.sel]) L[cur.sel].x = Math.max(0, v); else { L.push({ x: Math.max(0, v), t: cur.type }); } setTabs(L); cur.sel = tabs().findIndex(t => Math.abs(t.x - Math.max(0, v)) < 0.01); sync(); };
    fl.onchange = () => { const L = tabs(); if (L[cur.sel]) { if (fl.value) L[cur.sel].ld = fl.value.slice(0, 2); else delete L[cur.sel].ld; setTabs(L, 'Tab Leader'); } };
    fa.onchange = () => { const L = tabs(); if (L[cur.sel]) { if (fa.value) L[cur.sel].ac = fa.value.slice(0, 1); else delete L[cur.sel].ac; setTabs(L, 'Tab Alignment'); } };
    for (const i of [fx, fl, fa]) i.onkeydown = e => { if (e.key === 'Enter') { i.blur(); e.preventDefault(); } e.stopPropagation(); };
    $('#tp-clear').onclick = () => { setTabs([], 'Clear Tabs'); cur.sel = -1; };
    $('#tp-close').onclick = close;
    const rc = panel.querySelector('.tp-ruler');
    rc.addEventListener('pointerdown', rulerDown);
    for (const b of panel.querySelectorAll('button')) b.addEventListener('mousedown', e => e.preventDefault());
    place(); sync();
  }
  function close() { panel?.remove(); panel = null; drag = null; }
  function parseLen(v) { const m = /^\s*(-?[\d.]+)\s*(mm|in|pt|px|pc|")?\s*$/i.exec(String(v)); if (!m) return null; const u = m[2] ? (m[2] === '"' ? 'in' : m[2].toLowerCase()) : S.doc.units; return M.fromU(+m[1], u); }
  let geo = null;
  function place() {
    if (!panel) return;
    const t = target(); if (!t) { panel.hidden = true; return; }
    panel.hidden = false;
    const [x0, y0] = Tools.l2s(t.pp, t.it, t.colL, 0), [x1] = Tools.l2s(t.pp, t.it, t.colL + t.colW, 0);
    const z = S.view.z, wrap = $('#stagewrap'), W = wrap.clientWidth;
    const left = Math.max(4, Math.min(W - 420, x0 - 6)), top = Math.max(4, y0 - 66);
    panel.style.left = left + 'px'; panel.style.top = top + 'px';
    const rw = Math.max(120, x1 - x0 + 12);
    panel.style.width = Math.max(420, rw + (x0 - 6 - left) + 4) + 'px';
    geo = { t, z, ox: x0 - left - 4 + 2, width: rw };
    draw();
  }
  function draw() {
    if (!panel || !geo) return;
    const c = panel.querySelector('.tp-ruler'), dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = 22;
    c.width = w * dpr; c.height = h * dpr; c.style.height = h + 'px';
    const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, h); g.addColorStop(0, '#fbfdff'); g.addColorStop(1, '#e3ebf5'); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    const { z, ox, t } = geo, u = M.UNITS[S.doc.units];
    ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fillRect(ox, 0, t.colW * z, h);
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200]; const major = steps.find(s => s * u * z >= 48) || 200;
    ctx.strokeStyle = '#7c8fa6'; ctx.fillStyle = '#3a4d63'; ctx.font = '9px "Segoe UI",sans-serif'; ctx.beginPath();
    for (let k = 0; k * major / 4 * u * z <= w; k++) { const x = Math.round(ox + k * major / 4 * u * z) + .5; const isM = k % 4 === 0; ctx.moveTo(x, h); ctx.lineTo(x, h - (isM ? 9 : 4)); if (isM) ctx.fillText(String(+(k * major / 4).toFixed(2)), x + 2, 9); }
    ctx.stroke();
    // indents
    const pe = UI.charState()?.pe;
    if (pe) { ctx.fillStyle = '#8a4fd6'; for (const [xx, up] of [[pe.indL + pe.indF, true], [pe.indL, false]]) { const x = ox + xx * z; ctx.beginPath(); if (up) { ctx.moveTo(x - 4, 0); ctx.lineTo(x + 4, 0); ctx.lineTo(x, 5); } else { ctx.moveTo(x - 4, h); ctx.lineTo(x + 4, h); ctx.lineTo(x, h - 5); } ctx.fill(); } }
    tabs().forEach((tb, k) => {
      const x = ox + tb.x * z; ctx.strokeStyle = k === cur.sel ? '#d42020' : '#1e395b'; ctx.lineWidth = 1.6; ctx.beginPath();
      const p = new Path2D(ICON[tb.t || 'l']); ctx.save(); ctx.translate(x - (tb.t === 'r' ? 11 : tb.t === 'l' ? 3 : 7), h - 14); ctx.stroke(p); ctx.restore();
    });
  }
  function sync() {
    if (!panel) return;
    const L = tabs(); if (cur.sel >= L.length) cur.sel = -1;
    panel.querySelectorAll('.tp-t').forEach(b => b.classList.toggle('on', b.dataset.t === (L[cur.sel]?.t || cur.type)));
    const s = L[cur.sel], fo = document.activeElement;
    if ($('#tp-x') !== fo) $('#tp-x').value = s ? M.fmtU(s.x, S.doc.units) : '';
    if ($('#tp-ld') !== fo) $('#tp-ld').value = s?.ld || '';
    if ($('#tp-ac') !== fo) $('#tp-ac').value = s?.ac || (s?.t === 'd' ? '.' : '');
    place();
  }
  function rulerDown(e) {
    if (!geo) return; e.preventDefault();
    const rc = e.currentTarget, r = rc.getBoundingClientRect(), pos = x => Math.max(0, (x - r.left - geo.ox) / geo.z);
    const L = tabs(); let k = L.findIndex(t => Math.abs(geo.ox + t.x * geo.z - (e.clientX - r.left)) < 6);
    if (k < 0) { L.push({ x: pos(e.clientX), t: cur.type }); L.sort((a, b) => a.x - b.x); k = L.findIndex(t => Math.abs(t.x - pos(e.clientX)) < 1e-6); }
    cur.sel = k; drag = { L, k, y0: e.clientY };
    try { rc.setPointerCapture(e.pointerId); } catch (err) { }
    const mv = ev => { drag.L[drag.k].x = pos(ev.clientX); drag.off = Math.abs(ev.clientY - drag.y0) > 26; drawPreview(); };
    const upf = ev => {
      rc.removeEventListener('pointermove', mv); rc.removeEventListener('pointerup', upf);
      const D = drag; drag = null; if (!D) return;
      if (D.off) { D.L.splice(D.k, 1); cur.sel = -1; setTabs(D.L, 'Remove Tab'); }
      else { const x = D.L[D.k].x; setTabs(D.L, 'Tab Stop'); cur.sel = tabs().findIndex(t => Math.abs(t.x - x) < 1e-6); }
      sync();
    };
    rc.addEventListener('pointermove', mv); rc.addEventListener('pointerup', upf);
    drawPreview();
  }
  function drawPreview() { if (!drag) return; const c = panel.querySelector('.tp-ruler'); draw(); const ctx = c.getContext('2d'); const t = drag.L[drag.k]; const x = geo.ox + t.x * geo.z; ctx.strokeStyle = drag.off ? '#d42020' : '#1f6fd6'; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, 22); ctx.stroke(); ctx.setLineDash([]); }
  function refresh() { if (panel) { if (!target()) { close(); return; } sync(); } }

  /* ---------- bullets & numbering ---------- */
  const BULLETS = ['•', '–', '▪', '■', '►', '◦', '○', '→', '✓', '★', '◆', '❖'];
  function bulletsDialog() {
    const c = UI.charState(); if (!c) { Aero.toast('Select text or a text frame first'); return; }
    const pe = c.pe, fk = Fonts.resolve(c.font, c.weight, c.italic), u = S.doc.units;
    const chars = BULLETS.filter(b => Fonts.hasGlyph(fk, b));
    Aero.dialog({ title: 'Bullets and Numbering', fields: [
      { key: 'list', label: 'List type', type: 'select', value: pe.list || '', options: [['', 'None'], ['bullet', 'Bullets'], ['number', 'Numbers']] },
      { key: 'lchar', label: 'Bullet character', type: 'select', value: chars.includes(pe.lchar) ? pe.lchar : chars[0] || '•', options: chars.map(b => [b, b]) },
      { key: 'lfmt', label: 'Number format', type: 'select', value: pe.lfmt || '1.', options: [['1.', '1. 2. 3.'], ['1)', '1) 2) 3)'], ['1', '1 2 3'], ['a.', 'a. b. c.'], ['A.', 'A. B. C.'], ['i.', 'i. ii. iii.'], ['I.', 'I. II. III.'], ['a)', 'a) b) c)']] },
      { key: 'lstart', label: 'Start at (blank = continue)', type: 'text', value: pe.lstart > 0 ? String(pe.lstart) : '' },
      { key: 'indL', label: `Left indent (${u})`, type: 'number', step: 0.1, value: +M.fmtU(pe.list ? pe.indL : Math.max(pe.indL, 14), u) },
      { key: 'indF', label: `First line indent (${u})`, type: 'number', step: 0.1, value: +M.fmtU(pe.list ? pe.indF : -14, u) }],
      onOK: v => {
        const n = parseInt(v.lstart, 10);
        const o = { list: v.list, lchar: v.lchar, lfmt: v.lfmt, lstart: n > 0 ? n : 0 };
        if (v.list) { o.indL = M.fromU(+v.indL || 0, u); o.indF = M.fromU(+v.indF || 0, u); }
        UI.applyPara(o, v.list ? (v.list === 'bullet' ? 'Bulleted List' : 'Numbered List') : 'Remove List');
      } });
  }
  function toggleList(kind) {
    const c = UI.charState(); if (!c) return;
    if (c.pe.list === kind) UI.applyPara({ list: '' }, 'Remove List');
    else UI.applyPara({ list: kind, ...(c.pe.list ? {} : { indL: Math.max(c.pe.indL, 14), indF: c.pe.indF < 0 ? c.pe.indF : -14 }) }, kind === 'bullet' ? 'Bulleted List' : 'Numbered List');
  }
  return { open, close, place, refresh, bulletsDialog, toggleList, get isOpen() { return !!panel; } };
})();
