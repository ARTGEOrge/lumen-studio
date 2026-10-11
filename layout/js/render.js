'use strict';
/* Lumen Layout — canvas renderer for page content (screen, thumbnails, PNG/JPEG export, print).
   Coordinates: the caller sets up ctx so that 1 unit = 1 pt with the page's top-left at the origin. */
(function () {
  const KAPPA = 0.5522847498;
  function shapePath(ctx, it) {
    const w = it.w, h = it.h;
    ctx.beginPath();
    if (it.type === 'ellipse') { ctx.ellipse(w / 2, h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2); return; }
    if (it.type === 'line') { if ((it.dir || 1) > 0) { ctx.moveTo(0, 0); ctx.lineTo(w, h); } else { ctx.moveTo(0, h); ctx.lineTo(w, 0); } return; }
    const r = Math.max(0, Math.min(it.radius || 0, Math.abs(w) / 2, Math.abs(h) / 2));
    if (r > 0) ctx.roundRect(0, 0, w, h, r); else ctx.rect(0, 0, w, h);
  }
  function applyTransform(ctx, it) {
    if (it.rot) { ctx.translate(it.x + it.w / 2, it.y + it.h / 2); ctx.rotate(it.rot * Math.PI / 180); ctx.translate(-it.w / 2, -it.h / 2); }
    else ctx.translate(it.x, it.y);
  }
  let lastFont = '';
  function setFont(ctx, st) { const f = Fonts.css(st.fk, st.size); if (ctx.font !== f || lastFont !== f) { ctx.font = f; lastFont = f; } }

  function drawLines(ctx, lines, opt = {}) {
    lastFont = '';
    try { ctx.fontKerning = 'none'; } catch (e) { }
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    for (const ln of lines) {
      if (ln.drop) { setFont(ctx, ln.drop.st); ctx.fillStyle = ln.drop.st.color; ctx.fillText(ln.drop.text, ln.drop.x, ln.drop.y); }
      for (const r of ln.runs) {
        const st = r.st; setFont(ctx, st); ctx.fillStyle = st.color;
        const y = ln.y - st.shift;
        if (st.track && r.parts) for (let k = 0; k < r.parts.length; k++) ctx.fillText(r.parts[k], r.px[k], y);
        else ctx.fillText(r.text, r.x, y);
        if (st.under || st.strike) {
          ctx.fillRect(r.x, st.under ? y + st.size * 0.12 : y - st.size * 0.28, r.end - r.x, Math.max(0.4, st.size * 0.06));
        }
      }
    }
  }
  // hidden characters (¶, ·, »)
  function drawHidden(ctx, lines, text, scale) {
    ctx.save(); ctx.fillStyle = 'rgba(40,110,220,.75)';
    for (const ln of lines) {
      for (let k = ln.a; k < ln.b; k++) {
        const c = text[k], x = ln.xs[k - ln.a]; if (x == null) continue;
        const sz = 9;
        ctx.font = `${sz}px "Segoe UI",sans-serif`;
        if (c === ' ') ctx.fillText('·', x + ((ln.xs[k - ln.a + 1] ?? x) - x) / 2 - 1.5, ln.y);
        else if (c === '\n') ctx.fillText('¶', x + 1, ln.y);
        else if (c === '\t') ctx.fillText('»', x + 1, ln.y);
        else if (c === '\u2028') ctx.fillText('¬', x + 1, ln.y);
      }
      if (ln.b === text.length && ln.a <= text.length) { ctx.font = '9px "Segoe UI",sans-serif'; ctx.fillText('#', (ln.xs[ln.xs.length - 1] || ln.L) + 1, ln.y); }
    }
    ctx.restore();
  }

  function drawTable(ctx, it) {
    const ncol = it.colW.length, nrow = it.rowH.length;
    let y = 0;
    const fkB = Fonts.resolve(it.tfont, 700, false), fk = Fonts.resolve(it.tfont, 400, false);
    for (let r = 0; r < nrow; r++) {
      let x = 0; const rh = it.rowH[r];
      for (let c = 0; c < ncol; c++) {
        const cw = it.colW[c], cell = it.cells[r][c] || { t: '' };
        const head = r < (it.header || 0);
        const fill = cell.fill || (head ? it.hfill : (it.zebra && (r - (it.header || 0)) % 2 === 1 ? it.zebra : null));
        if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, cw, rh); }
        const lines = tableCellLines(it, r, c);
        ctx.fillStyle = cell.color || (head ? it.hcolor : it.tcolor);
        ctx.font = Fonts.css(head || cell.bold ? fkB : fk, it.tsize);
        for (const l of lines) ctx.fillText(l.text, x + l.x, y + l.y);
        x += cw;
      }
      y += rh;
    }
    if (it.bw > 0) {
      ctx.strokeStyle = it.bcolor; ctx.lineWidth = it.bw; ctx.beginPath();
      let yy = 0; for (let r = 0; r <= nrow; r++) { ctx.moveTo(0, yy); ctx.lineTo(it.w, yy); yy += it.rowH[r] || 0; }
      let xx = 0; for (let c = 0; c <= ncol; c++) { ctx.moveTo(xx, 0); ctx.lineTo(xx, it.h); xx += it.colW[c] || 0; }
      ctx.stroke();
    }
  }
  // positioned lines inside a table cell (shared with PDF)
  function tableCellLines(it, r, c) {
    const cell = it.cells[r][c] || { t: '' }, head = r < (it.header || 0);
    const fk = Fonts.resolve(it.tfont, head || cell.bold ? 700 : 400, false);
    const pad = it.pad ?? 4, cw = it.colW[c], rh = it.rowH[r];
    const ls = Layout.simpleLines(cell.t || '', fk, it.tsize, cw - pad * 2);
    const lh = it.tsize * 1.25, m = Fonts.metrics(fk);
    const total = ls.length * lh;
    const y0 = (rh - total) / 2 + lh / 2 + m.cap * it.tsize / 2;
    const align = cell.align || (c === 0 ? 'left' : it.calign?.[c] || 'left');
    return ls.map((l, k) => ({ text: l.text, fk, x: align === 'right' ? cw - pad - l.w : align === 'center' ? (cw - l.w) / 2 : pad, y: y0 + k * lh }));
  }

  // linear gradient fill: it.grad = {angle (deg, 0 = left→right, 90 = top→bottom), c0, o0, c1, o1}
  function gradPts(it) { const a = (it.grad.angle || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), L = (Math.abs(it.w * c) + Math.abs(it.h * s)) / 2; return [it.w / 2 - c * L, it.h / 2 - s * L, it.w / 2 + c * L, it.h / 2 + s * L]; }
  function rgba(hex, o) { const m = /^#?([0-9a-f]{6})$/i.exec(hex || '') ; const n = m ? parseInt(m[1], 16) : 0; return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${o ?? 1})`; }
  function gradStyle(ctx, it) { const [x0, y0, x1, y1] = gradPts(it), g = ctx.createLinearGradient(x0, y0, x1, y1), G = it.grad; g.addColorStop(0, rgba(G.c0, G.o0)); g.addColorStop(1, rgba(G.c1, G.o1)); return g; }
  // env: {engine, images (id -> {el,w,h}), label, hidden (show hidden chars), skipText}
  function drawItem(ctx, it, env) {
    if (it.hidden) return;
    if (env.engine && !env.engine.layerVisible(it) && it.type !== 'group') return;
    if (it.type === 'group') { ctx.save(); if (it.opacity < 1) ctx.globalAlpha *= it.opacity; for (const c of it.children) drawItem(ctx, c, env); ctx.restore(); return; }
    ctx.save();
    if (it.opacity != null && it.opacity < 1) ctx.globalAlpha *= it.opacity;
    applyTransform(ctx, it);
    if (it.type !== 'line' && (it.grad || it.fill)) { shapePath(ctx, it); ctx.fillStyle = it.grad ? gradStyle(ctx, it) : it.fill; ctx.fill(); }
    if (it.type === 'image' && it.img) {
      const im = env.images[it.img];
      if (im && im.el && im.el.complete && im.el.naturalWidth) {
        ctx.save(); shapePath(ctx, it); ctx.clip();
        ctx.drawImage(im.el, it.cx, it.cy, im.w * it.cs, im.h * it.cs);
        ctx.restore();
      }
    }
    if (it.type === 'table') drawTable(ctx, it);
    if (it.type === 'text' && env.engine) {
      const L = env.engine.frameLayout(it, env.label);
      if (L) { drawLines(ctx, L.lines); if (env.hidden) drawHidden(ctx, L.lines, L.story.text); }
    }
    if (it.stroke && it.sw > 0) {
      shapePath(ctx, it); ctx.strokeStyle = it.stroke; ctx.lineWidth = it.sw; ctx.lineJoin = 'miter';
      if (it.dash) ctx.setLineDash([it.sw * 3, it.sw * 2]);
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // Draw a full page (master items + page items). pageRef = {page, kind, index}
  function drawPage(ctx, env, page, i, opt = {}) {
    const E = env.engine;
    const mp = page.master !== undefined && i != null ? E.masterPage(page, i) : null;
    const over = page.overrides || [];
    if (mp) for (const it of E.sortedItems(mp.items)) { if (over.includes(it.id)) continue; drawItem(ctx, it, env); }
    for (const it of E.sortedItems(page.items)) drawItem(ctx, it, env);
  }

  window.Render = { gradPts, rgba, shapePath, applyTransform, drawItem, drawPage, drawLines, drawHidden, drawTable, tableCellLines, KAPPA };
})();
