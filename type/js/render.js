'use strict';
/* Lumen Type — glyph path cache, drawing helpers and the live text preview strip. */
(function () {
  const A = window.LT, TM = window.TM, $ = id => document.getElementById(id);
  const cache = new WeakMap();
  function deps(font, g, out = [], d = 0) {
    if (d > 12) return out;
    g.components.forEach(c => { const b = font.glyphs[c.base]; out.push([c.base, b]); if (b) deps(font, b, out, d + 1); });
    return out;
  }
  function toPath2D(cmds) {
    const p = new Path2D();
    cmds.forEach(c => { switch (c[0]) { case 'M': p.moveTo(c[1], c[2]); break; case 'L': p.lineTo(c[1], c[2]); break; case 'C': p.bezierCurveTo(c[1], c[2], c[3], c[4], c[5], c[6]); break; case 'Q': p.quadraticCurveTo(c[1], c[2], c[3], c[4]); break; case 'Z': p.closePath(); } });
    return p;
  }
  // Path2D of a glyph in font units (y up), components included; cached per glyph object
  function glyphPath(font, g) {
    if (!g) return new Path2D();
    const c = cache.get(g);
    if (c && c.deps.every(([n, o]) => font.glyphs[n] === o)) return c.p;
    const p = toPath2D(TM.glyphCommands(font, g));
    cache.set(g, { p, deps: deps(font, g) });
    return p;
  }
  const bcache = new WeakMap();
  function glyphBox(font, g) {
    const c = bcache.get(g);
    if (c && c.deps.every(([n, o]) => font.glyphs[n] === o)) return c.b;
    const b = TM.glyphBounds(font, g); bcache.set(g, { b, deps: deps(font, g) }); return b;
  }
  // draw glyph with its origin at (x, y) screen px and `s` px per unit
  function drawGlyph(ctx, font, g, x, y, s, fill = '#111') {
    ctx.save(); ctx.translate(x, y); ctx.scale(s, -s); ctx.fillStyle = fill; ctx.fill(glyphPath(font, g), 'nonzero'); ctx.restore();
  }
  function sizeCanvas(cv) {
    const r = cv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    const w = Math.max(10, Math.floor(cv.clientWidth || r.width)), h = Math.max(10, Math.floor(cv.clientHeight || r.height));
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h, dpr };
  }
  A.R = { glyphPath, glyphBox, drawGlyph, sizeCanvas, toPath2D };

  // ---------- preview strip ----------
  const SAMPLES = ['Hamburgefonstiv HAMBURGEFONSTIV', 'The quick brown fox jumps over the lazy dog.', 'AVATAR WAVE To Ty Yo LT P. F, r. y,', 'nnnonnoonoo HHHOHHOOHOO', '0123456789 $€£ %‰ (a) [b] {c}', 'Àlçàçôn Ésîëñ Ølæ Œuvre Ångström', 'minimum illuminating hamburger'];
  let hits = [];
  A.previewText = () => $('pvText').value;
  function drawPreview() {
    const cv = $('pvCv'); if (!A.font || !cv.offsetParent) return;
    const { ctx, w, h } = sizeCanvas(cv);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    const F = A.font, size = +$('pvSize').value, upm = F.info.unitsPerEm, s = size / upm;
    const names = TM.textToGlyphs(F, A.previewText());
    const lay = TM.layout(F, names, $('pvKern').checked);
    const lineH = (F.info.ascender - F.info.descender + (F.info.lineGap || 0)) * s;
    const x0 = 14, top = 10 + F.info.ascender * s;
    hits = [];
    const kv = A.view === 'kern' && A.kernSel ? A.kernSel : null;
    lay.forEach((p, i) => {
      if (!p) return;
      const g = F.glyphs[p.name], gx = x0 + p.x * s, gy = top + p.line * lineH;
      if (gx > w + 200 || gy - F.info.ascender * s > h) return;
      const cur = A.view === 'glyph' && p.name === A.cur;
      if (cur) { ctx.fillStyle = 'rgba(66,140,230,.13)'; ctx.fillRect(gx, gy - F.info.ascender * s, g.advance * s, (F.info.ascender - F.info.descender) * s); }
      if ($('pvBoxes').checked) { ctx.strokeStyle = 'rgba(80,120,170,.35)'; ctx.strokeRect(Math.round(gx) + .5, Math.round(gy - F.info.ascender * s) + .5, Math.round(g.advance * s), Math.round((F.info.ascender - F.info.descender) * s)); }
      if (p.kern && $('pvKern').checked && size >= 36) {
        ctx.fillStyle = p.kern < 0 ? 'rgba(230,80,80,.18)' : 'rgba(60,170,90,.2)';
        ctx.fillRect(gx - (p.kern > 0 ? p.kern * s : 0), gy - F.info.descender * s - 3, Math.abs(p.kern) * s, 3);
      }
      const isPair = kv && i > 0 && lay[i - 1] && lay[i - 1].name === kv.l && p.name === kv.r;
      drawGlyph(ctx, F, g, gx, gy, s, cur ? '#0b4f9e' : isPair ? '#b2361f' : '#141a22');
      hits.push({ i, name: p.name, x0: gx, x1: gx + g.advance * s, y0: gy - F.info.ascender * s, y1: gy - F.info.descender * s, prev: i > 0 && lay[i - 1] ? lay[i - 1].name : null });
    });
  }
  let raf = 0;
  A.redrawPreview = () => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; drawPreview(); }); };
  A.initPreview = () => {
    const t = $('pvText');
    try { t.value = localStorage.getItem('lumen-type-pvtext') || SAMPLES[0]; } catch (e) { t.value = SAMPLES[0]; }
    t.addEventListener('input', () => { try { localStorage.setItem('lumen-type-pvtext', t.value); } catch (e) { } A.redrawPreview(); });
    ['pvSize', 'pvKern', 'pvBoxes'].forEach(id => $(id).addEventListener('change', A.redrawPreview));
    $('pvSamples').onclick = e => {
      e.stopPropagation();
      const m = Aero.el('div', 'aero-menu pv-menu'); const r = e.target.getBoundingClientRect();
      m.style.cssText = `position:fixed;left:${r.left}px;bottom:${innerHeight - r.top + 2}px;display:block;z-index:50`;
      const list = [...SAMPLES]; if (A.cur) list.unshift(`HH/${A.cur} HH oo/${A.cur} oo nn/${A.cur} nn`);
      list.forEach(s => { const it = Aero.el('div', 'aero-mi', `<span class="ml"></span>`); it.querySelector('.ml').textContent = s; it.onclick = () => { t.value = s; m.remove(); t.dispatchEvent(new Event('input')); }; m.appendChild(it); });
      document.body.appendChild(m); setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }));
    };
    $('pvCv').addEventListener('mousedown', e => {
      const r = e.target.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const h = hits.find(k => x >= k.x0 && x < k.x1 && y >= k.y0 && y < k.y1);
      if (!h) return;
      if (A.view === 'kern') { if (h.prev) A.selectKernPair(h.prev, h.name); }
      else if (e.detail >= 2 || A.view === 'glyph') A.openGlyph(h.name);
      else { A.cur = h.name; A.sel = [h.name]; A.emit('cur'); A.emit('sel'); }
    });
    new ResizeObserver(A.redrawPreview).observe($('pvCv'));
    A.on('change', A.redrawPreview); A.on('cur', A.redrawPreview); A.on('view', A.redrawPreview); A.on('font', A.redrawPreview);
  };
})();
