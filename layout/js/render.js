'use strict';
/* Lumen Layout — canvas renderer for page content (screen, thumbnails, PNG/JPEG export, print).
   Coordinates: the caller sets up ctx so that 1 unit = 1 pt with the page's top-left at the origin.
   Colors go through Color.css so swatches, tints, CMYK preview and separation plates all apply. */
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
  // glyph outlines for runs using OpenType features canvas text cannot express (or ligatures switched off)
  function drawGlyphRun(ctx, r, y) {
    const st = r.st, synth = Fonts.parse(st.fk).synthItalic;
    for (let k = 0; k < r.px.length; k++) {
      const gs = r.g && r.g[k];
      if (!gs) { setFont(ctx, st); ctx.fillText(r.parts[k], r.px[k], y); continue; }
      for (const g of gs) {
        const gp = Fonts.glyphPath(st.fk, g.id); if (!gp) continue;
        const s = st.size / gp.upem;
        ctx.save(); ctx.translate(r.px[k] + g.x * st.size / 100, y - g.y * st.size / 100);
        if (synth) ctx.transform(1, 0, -0.21, 1, 0, 0);
        ctx.scale(s, -s); ctx.fill(gp.path); ctx.restore();
      }
    }
  }

  function drawLines(ctx, lines, env = {}) {
    lastFont = '';
    try { ctx.fontKerning = 'none'; } catch (e) { }
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    for (const ln of lines) {
      if (ln.block) { drawBlock(ctx, ln.block, env); continue; }
      if (ln.drop) { setFont(ctx, ln.drop.st); ctx.fillStyle = Color.css(ln.drop.st.color); ctx.fillText(ln.drop.text, ln.drop.x, ln.drop.y); }
      for (const r of ln.runs) {
        const st = r.st; setFont(ctx, st); ctx.fillStyle = Color.css(st.color);
        const y = ln.y - st.shift;
        if (r.path && !r.marker && !r.leader && !r.hy) drawGlyphRun(ctx, r, y);
        else if (st.track && r.parts && r.parts.length > 1) for (let k = 0; k < r.parts.length; k++) ctx.fillText(r.parts[k], r.px[k], y);
        else ctx.fillText(r.text, r.x, y);
        if ((st.under || st.strike) && !r.marker && !r.leader) ctx.fillRect(r.x, st.under ? y + st.size * 0.12 : y - st.size * 0.28, r.end - r.x, Math.max(0.4, st.size * 0.06));
      }
      if (ln.objs) for (const o of ln.objs) drawGraphic(ctx, o.o, o.x, ln.y - o.o.item.h - (o.o.shift || 0), env);
    }
  }
  function drawGraphic(ctx, o, x, y, env) {
    const it = { ...o.item, x, y, rot: 0, opacity: 1, id: 'inline' };
    drawItem(ctx, it, { ...env, engine: null });
  }
  function drawBlock(ctx, b, env) {
    if (b.kind === 'graphic') { drawGraphic(ctx, b.obj, b.x, b.y, env); return; }
    ctx.save(); ctx.translate(b.x, b.y); drawTableRows(ctx, b.obj, b.rows, b.rh); ctx.restore();
  }
  function drawNotes(ctx, blocks) {
    for (const nb of blocks || []) {
      const st = nb.st; if (!st) continue;
      ctx.fillStyle = Color.css(st.color); ctx.fillRect(nb.x, nb.y + 2, Math.min(72, nb.w / 3), 0.5);
      let y = nb.y + Layout.FN_SEP;
      setFont(ctx, st);
      for (const n of nb.notes) {
        const asc = st.m.asc * st.size;
        if (!n.cont) ctx.fillText(String(n.num), nb.x, y + asc);
        n.lines.forEach((l, k) => ctx.fillText(l.text, nb.x + n.ind, y + asc + k * st.lead));
        y += n.h;
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
        else if (c === '￼') ctx.fillText('⚓', x - 4, ln.y + 8);
      }
      if (ln.b === text.length && ln.a <= text.length) { ctx.font = '9px "Segoe UI",sans-serif'; ctx.fillText('#', (ln.xs[ln.xs.length - 1] || ln.L) + 1, ln.y); }
    }
    ctx.restore();
  }

  function drawTableRows(ctx, t, rows, rhs) {
    const d = Tables.display(t, rows, rhs);
    for (const f of d.fills) { ctx.fillStyle = Color.css(f.color); ctx.fillRect(f.x, f.y, f.w, f.h); }
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    for (const x of d.texts) { ctx.fillStyle = Color.css(x.color); ctx.font = Fonts.css(x.fk, x.size); ctx.fillText(x.text, x.x, x.y); }
    lastFont = '';
    if (t.bw > 0 && d.borders.length) { ctx.strokeStyle = Color.css(t.bcolor); ctx.lineWidth = t.bw; ctx.beginPath(); for (const [x0, y0, x1, y1] of d.borders) { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); } ctx.stroke(); }
  }
  function drawTable(ctx, it) { drawTableRows(ctx, it, it.rowH.map((_, r) => r), it.rowH); }
  // positioned lines inside a table cell (shared with PDF)
  function tableCellLines(it, r, c) { return Tables.cellText(it, r, c, it.colW[c], it.rowH[r]); }

  // linear gradient fill: it.grad = {angle (deg, 0 = left→right, 90 = top→bottom), c0, o0, c1, o1}
  function gradPts(it) { const a = (it.grad.angle || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), L = (Math.abs(it.w * c) + Math.abs(it.h * s)) / 2; return [it.w / 2 - c * L, it.h / 2 - s * L, it.w / 2 + c * L, it.h / 2 + s * L]; }
  const rgba = (ref, o) => Color.rgba(ref, o);
  function gradStyle(ctx, it) { const [x0, y0, x1, y1] = gradPts(it), g = ctx.createLinearGradient(x0, y0, x1, y1), G = it.grad; g.addColorStop(0, rgba(G.c0, G.o0)); g.addColorStop(1, rgba(G.c1, G.o1)); return g; }
  // overprinted paint leaves a separation plate untouched where it carries none of that ink (PDF /OPM 1 semantics)
  function opSkip(op, refs) { if (!op || !Color.plate) return false; return refs.every(r => Color.plateAmount(Color.parse(r), Color.plate) <= 0); }
  // env: {engine, images (id -> {el,w,h}), label, hidden (show hidden chars), skipText}
  function drawItem(ctx, it, env) {
    if (it.hidden) return;
    if (env.engine && !env.engine.layerVisible(it) && it.type !== 'group') return;
    if (it.type === 'group') { ctx.save(); if (it.opacity < 1) ctx.globalAlpha *= it.opacity; for (const c of it.children) drawItem(ctx, c, env); ctx.restore(); return; }
    ctx.save();
    if (it.opacity != null && it.opacity < 1) ctx.globalAlpha *= it.opacity;
    applyTransform(ctx, it);
    if (it.type !== 'line' && (it.grad || it.fill) && !opSkip(it.opFill, it.grad ? [it.grad.c0, it.grad.c1] : [it.fill])) {
      const op = it.opFill && env.opPreview && !Color.plate; if (op) { ctx.save(); ctx.globalCompositeOperation = 'multiply'; }
      shapePath(ctx, it); ctx.fillStyle = it.grad ? gradStyle(ctx, it) : Color.css(it.fill); ctx.fill();
      if (op) ctx.restore();
    }
    if (it.type === 'image' && it.img) {
      const im = env.images && env.images[it.img];
      if (im && im.el && im.el.complete && im.el.naturalWidth) {
        ctx.save(); shapePath(ctx, it); ctx.clip();
        ctx.drawImage(Color.plate ? Color.plateImage(im, Color.plate) : im.el, it.cx, it.cy, im.w * it.cs, im.h * it.cs);
        ctx.restore();
      }
    }
    if (it.type === 'table') drawTable(ctx, it);
    if (it.type === 'text' && env.engine) {
      const L = env.engine.frameLayout(it, env.label);
      if (L) { drawLines(ctx, L.lines, env); drawNotes(ctx, L.notes); if (env.hidden) drawHidden(ctx, L.lines, L.story.text); }
    }
    if (it.stroke && it.sw > 0 && !opSkip(it.opStroke, [it.stroke])) {
      const op = it.opStroke && env.opPreview && !Color.plate; if (op) ctx.globalCompositeOperation = 'multiply';
      shapePath(ctx, it); ctx.strokeStyle = Color.css(it.stroke); ctx.lineWidth = it.sw; ctx.lineJoin = 'miter';
      if (it.dash) ctx.setLineDash([it.sw * 3, it.sw * 2]);
      ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.restore();
  }

  // Draw a full page (master items + page items). pageRef = {page, kind, index}
  function drawPage(ctx, env, page, i, opt = {}) {
    const E = env.engine;
    Color.use(E.doc);
    const mp = page.master !== undefined && i != null ? E.masterPage(page, i) : null;
    const over = page.overrides || [];
    if (mp) for (const it of E.sortedItems(mp.items)) { if (over.includes(it.id)) continue; drawItem(ctx, it, env); }
    for (const it of E.sortedItems(page.items)) drawItem(ctx, it, env);
  }

  window.Render = { gradPts, rgba, shapePath, applyTransform, drawItem, drawPage, drawLines, drawHidden, drawTable, drawTableRows, tableCellLines, drawNotes, KAPPA };
})();
