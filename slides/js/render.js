'use strict';
/* Lumen Slides — canvas renderer shared by the editor, thumbnails, slide show, presenter view and PNG/PDF export.
   All slide geometry is in slide pixels (1280×720 for 16:9). Font sizes are in points (1pt = 4/3 px). */
const Render = (() => {
  const PT = 4 / 3;
  const M = Model;
  const FALLBACK = '"Segoe UI", Arial, sans-serif';
  const LH = 1.2; // single line spacing multiple (matches PowerPoint closely)
  const DEF_INS = [9.6, 4.8, 9.6, 4.8];
  let mctx = null; const mcache = new Map();
  function mc() { if (!mctx) { const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(8, 8) : document.createElement('canvas'); mctx = c.getContext('2d'); } return mctx; }
  const famCss = f => `"${String(f || 'Inter').replace(/["\\]/g, '')}", ${FALLBACK}`;
  const cssFont = (fam, px, b, i) => `${i ? 'italic ' : ''}${b ? 700 : 400} ${Math.max(0.5, px).toFixed(2)}px ${famCss(fam)}`;
  function measure(font, s) {
    const k = font + '\u0001' + s; let w = mcache.get(k);
    if (w == null) { const c = mc(); c.font = font; w = c.measureText(s).width; if (mcache.size > 60000) mcache.clear(); mcache.set(k, w); }
    return w;
  }
  const clearMeasureCache = () => { mcache.clear(); fmCache.clear(); };

  /* ---------------- text layout ---------------- */
  // Effective style of a paragraph / run.
  function paraStyle(base, p, theme) {
    const lvl = Math.min(p.lvl || 0, base.lv.length - 1), lv = base.lv[lvl] || base.lv[0];
    let bullet = p.bullet != null ? p.bullet : lv.bullet != null ? lv.bullet : 'none';
    if (base.bullet != null && p.bullet == null) bullet = base.bullet;
    const on = bullet && bullet !== 'none';
    return { lvl: p.lvl || 0, size: lv.size, align: p.align || base.align || 'l', bullet: on ? bullet : null,
      marL: p.marL != null ? p.marL : (p.lvl || 0) * 48 + (on ? 36 : 0), indent: p.indent != null ? p.indent : on ? -36 : 0,
      lnSp: p.lnSp != null ? p.lnSp : base.lnSp || 1, spB: p.spB != null ? p.spB : base.spB || 0, spA: p.spA != null ? p.spA : base.spA || 0 };
  }
  function runStyle(base, ps, r, theme) {
    return { font: M.font(r.font || base.font, theme), size: r.size != null ? r.size : ps.size, b: r.b != null ? r.b : !!base.b, i: r.i != null ? r.i : !!base.i,
      u: r.u != null ? r.u : !!base.u, s: !!r.s, color: r.color || base.color || 'tx1', sup: r.sup || 0 };
  }
  function layoutText(doc, ctx, o, tb, W, H, opts = {}) {
    const theme = doc.theme, base = opts.base || M.baseStyle(doc, ctx, o);
    const ins = tb.ins || DEF_INS;
    const availW = Math.max(1, W - ins[0] - ins[2]), availH = Math.max(1, H - ins[1] - ins[3]);
    const auto = tb.autofit || (o.ph && M.phCat(o.ph) === 'body' ? 'shrink' : 'none');
    const run = sc => layoutPass(doc, theme, base, tb, availW, sc, opts);
    let scale = 1, res = run(1);
    if (auto === 'shrink' && res.h > availH + 0.5) {
      if (tb.scale && opts.useStoredScale) { scale = tb.scale; res = run(scale); }
      else { let lo = 0.25, hi = 1; for (let k = 0; k < 7; k++) { const mid = (lo + hi) / 2; if (run(mid).h > availH) hi = mid; else lo = mid; } scale = lo; res = run(scale); }
    }
    const anchor = tb.anchor || base.anchor || 't';
    const oy = ins[1] + (anchor === 'ctr' ? (availH - res.h) / 2 : anchor === 'b' ? availH - res.h : 0);
    for (const ln of res.lines) { ln.y += oy; ln.base += oy; }
    return { lines: res.lines, h: res.h, need: res.h + ins[1] + ins[3], scale, ins, availW, base, anchor };
  }
  function layoutPass(doc, theme, base, tb, availW, scale, opts) {
    const lines = []; let y = 0; const numCount = []; const wrap = tb.wrap !== false;
    tb.paras.forEach((p, pi) => {
      const ps = paraStyle(base, p, theme);
      // numbering counters per level
      if (ps.bullet && typeof ps.bullet === 'object') { numCount.length = ps.lvl + 1; numCount[ps.lvl] = (numCount[ps.lvl] || (ps.bullet.start || 1) - 1) + 1; }
      else if (ps.lvl < numCount.length) numCount.length = ps.lvl;
      const spB = pi > 0 ? ps.spB * PT * scale : 0, spA = ps.spA * PT * scale;
      y += spB;
      // tokens
      const toks = [];
      for (const r of p.runs) {
        const rs = runStyle(base, ps, r, theme); const px = rs.size * PT * scale * (rs.sup ? 0.66 : 1);
        const font = cssFont(rs.font, px, rs.b, rs.i);
        if (r.br) { toks.push({ br: true, px }); continue; }
        let t = r.fld === 'slidenum' ? String(opts.slideNum || '‹#›') : r.fld === 'date' ? new Date().toLocaleDateString() : r.t;
        if (!t) continue;
        for (const part of t.split(/(\s+)/)) if (part) toks.push({ t: part, ws: /^\s+$/.test(part), font, px, rs });
      }
      const endPx = (p.endSize || (p.runs.length ? runStyle(base, ps, p.runs[p.runs.length - 1], theme).size : ps.size)) * PT * scale;
      let bullet = null;
      if (ps.bullet) {
        const fr = p.runs.find(r => r.t) || {}; const rs = runStyle(base, ps, fr, theme);
        const px = (p.runs.length ? rs.size : (p.endSize || ps.size)) * PT * scale;
        const txt = typeof ps.bullet === 'object' ? M.numLabel(ps.bullet.num, numCount[ps.lvl] || 1) : ps.bullet;
        bullet = { t: txt, font: cssFont(typeof ps.bullet === 'object' ? rs.font : rs.font, px, typeof ps.bullet === 'object' ? rs.b : false, false), color: rs.color, px };
      }
      const marL = ps.marL * scale ** 0, ind = ps.indent;
      let cur = null, first = true;
      const bw = bullet ? measure(bullet.font, bullet.t) : 0;
      const firstX = bullet ? Math.max(marL, marL + ind + bw) : marL + ind;
      const newLine = () => { cur = { segs: [], x: (first ? firstX : marL), w: 0, maxPx: 0, para: pi, align: ps.align, lnSp: ps.lnSp, bullet: first ? bullet : null, bx: marL + ind, last: false, start: first ? firstX : marL }; first = false; lines.push(cur); };
      newLine();
      const limit = () => wrap ? availW : 1e9;
      const pushSeg = (tk, text, w) => { const sg = cur.segs[cur.segs.length - 1]; if (sg && sg.font === tk.font && sg.rs === tk.rs && !sg.ws === !tk.ws) { sg.t += text; sg.w += w; } else cur.segs.push({ t: text, w, font: tk.font, px: tk.px, rs: tk.rs, ws: tk.ws }); cur.w += w; cur.maxPx = Math.max(cur.maxPx, tk.px); };
      for (const tk of toks) {
        if (tk.br) { cur.maxPx = Math.max(cur.maxPx, tk.px); newLine(); continue; }
        const w = measure(tk.font, tk.t);
        if (tk.ws) { pushSeg(tk, tk.t, w); continue; }
        if (cur.x + cur.w + w > limit() + 0.01 && cur.segs.some(s => !s.ws)) { trimTrail(cur); newLine(); }
        if (cur.x + w > limit() + 0.01 && wrap) {
          // break a long word by characters
          let s = tk.t;
          while (s) {
            let k = 1; while (k < s.length && cur.x + cur.w + measure(tk.font, s.slice(0, k + 1)) <= limit()) k++;
            const piece = s.slice(0, k); pushSeg(tk, piece, measure(tk.font, piece)); s = s.slice(k);
            if (s) { newLine(); }
          }
          continue;
        }
        pushSeg(tk, tk.t, w);
      }
      // finalize paragraph lines
      const pl = lines.filter(l => l.para === pi);
      pl[pl.length - 1].last = true;
      for (const ln of pl) {
        trimTrail(ln);
        const mpx = ln.maxPx || endPx; ln.h = mpx * LH * ln.lnSp; ln.y = y;
        // CSS-like half-leading: baseline = top + (lineH - (asc+desc))/2 + asc, asc≈0.78em·LH-ish; use font metrics
        const fm = fontMetrics(ln.segs.length ? ln.segs.reduce((a, b) => b.px > a.px ? b : a).font : cssFont(M.font(base.font, theme), mpx, false, false), mpx);
        ln.base = y + (ln.h - (fm.a + fm.d)) / 2 + fm.a;
        y += ln.h;
        // alignment
        const avail = availW - ln.start;
        if (ln.align === 'c') ln.off = (avail - ln.w) / 2; else if (ln.align === 'r') ln.off = avail - ln.w;
        else if (ln.align === 'j' && !ln.last && wrap) { const gaps = ln.segs.filter(s => s.ws).length; ln.just = gaps ? (avail - ln.w) / gaps : 0; ln.off = 0; }
        else ln.off = 0;
        if (!wrap) ln.off = ln.align === 'c' ? (availW - ln.start - ln.w) / 2 : ln.align === 'r' ? availW - ln.start - ln.w : 0;
      }
      y += spA;
    });
    return { lines, h: y };
  }
  function trimTrail(ln) { while (ln.segs.length && ln.segs[ln.segs.length - 1].ws) ln.w -= ln.segs.pop().w; }
  const fmCache = new Map();
  function fontMetrics(font, px) {
    const k = font; let m = fmCache.get(k);
    if (!m) {
      const c = mc(); c.font = font; const t = c.measureText('Hg');
      const a = t.fontBoundingBoxAscent, d = t.fontBoundingBoxDescent;
      m = Number.isFinite(a) && a > 0 ? { a, d } : { a: px * 0.9, d: px * 0.25 };
      if (fmCache.size > 4000) fmCache.clear(); fmCache.set(k, m);
    }
    return m;
  }
  function drawText(c, doc, L, color) {
    const theme = doc.theme;
    for (const ln of L.lines) {
      let x = L.ins[0] + ln.start + (ln.off || 0);
      if (ln.bullet) { c.font = ln.bullet.font; c.fillStyle = M.color(ln.bullet.color, theme); c.fillText(ln.bullet.t, L.ins[0] + ln.bx + (ln.align === 'c' || ln.align === 'r' ? (ln.off || 0) : 0), ln.base); }
      for (const s of ln.segs) {
        if (s.ws) { x += s.w + (ln.just || 0); continue; }
        c.font = s.font; const col = color || M.color(s.rs.color, theme); c.fillStyle = col;
        const by = ln.base - (s.rs.sup ? s.rs.sup / 100 * s.px * 1.5 : 0);
        c.fillText(s.t, x, by);
        if (s.rs.u) c.fillRect(x, by + s.px * 0.11, s.w, Math.max(0.75, s.px / 16));
        if (s.rs.s) c.fillRect(x, by - s.px * 0.3, s.w, Math.max(0.75, s.px / 16));
        x += s.w;
      }
      // underline whitespace between underlined runs
    }
  }

  /* ---------------- shapes ---------------- */
  function geomPath(g, w, h, o) {
    const p = new Path2D(), ss = Math.min(w, h);
    const poly = pts => { p.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) p.lineTo(pts[i][0], pts[i][1]); p.closePath(); };
    switch (g) {
      case 'roundRect': { const r = Math.min(ss * (o && o.adj != null ? o.adj : 0.16667), w / 2, h / 2); p.roundRect(0, 0, w, h, r); break; }
      case 'ellipse': p.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); break;
      case 'triangle': poly([[w / 2, 0], [w, h], [0, h]]); break;
      case 'rtTriangle': poly([[0, 0], [w, h], [0, h]]); break;
      case 'diamond': poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]); break;
      case 'parallelogram': { const d = ss * 0.25; poly([[d, 0], [w, 0], [w - d, h], [0, h]]); break; }
      case 'trapezoid': { const d = ss * 0.25; poly([[d, 0], [w - d, 0], [w, h], [0, h]]); break; }
      case 'pentagon': poly([[w / 2, 0], [w, h * 0.382], [w * 0.809, h], [w * 0.191, h], [0, h * 0.382]]); break;
      case 'hexagon': { const d = ss * 0.25; poly([[d, 0], [w - d, 0], [w, h / 2], [w - d, h], [d, h], [0, h / 2]]); break; }
      case 'octagon': { const d = ss * 0.29289; poly([[d, 0], [w - d, 0], [w, d], [w, h - d], [w - d, h], [d, h], [0, h - d], [0, d]]); break; }
      case 'star5': case 'star4': case 'star6': case 'star8': {
        const n = { star4: 4, star5: 5, star6: 6, star8: 8 }[g], ir = { star4: 0.25, star5: 0.382, star6: 0.5, star8: 0.38 }[g], pts = [];
        const cy = g === 'star5' ? h * 0.5257 : h / 2, ry = g === 'star5' ? h * 0.5257 : h / 2;
        for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? ir : 1; pts.push([w / 2 + Math.cos(a) * w / 2 * r, cy + Math.sin(a) * ry * r]); }
        poly(pts); break;
      }
      case 'plus': { const d = ss * 0.25; poly([[d, 0], [w - d, 0], [w - d, d], [w, d], [w, h - d], [w - d, h - d], [w - d, h], [d, h], [d, h - d], [0, h - d], [0, d], [d, d]]); break; }
      case 'heart': p.moveTo(w / 2, h * 0.25); p.bezierCurveTo(w * 0.5, -h * 0.05, w * -0.15, h * 0.05, w * 0.05, h * 0.4); p.bezierCurveTo(w * 0.15, h * 0.62, w * 0.42, h * 0.8, w / 2, h); p.bezierCurveTo(w * 0.58, h * 0.8, w * 0.85, h * 0.62, w * 0.95, h * 0.4); p.bezierCurveTo(w * 1.15, h * 0.05, w * 0.5, -h * 0.05, w / 2, h * 0.25); p.closePath(); break;
      case 'donut': { const d = ss * 0.25; p.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); p.moveTo(w - d, h / 2); p.ellipse(w / 2, h / 2, Math.max(0, w / 2 - d), Math.max(0, h / 2 - d), 0, 0, -Math.PI * 2, true); break; }
      case 'rightArrow': { const hl = Math.min(ss * 0.5, w), t = h * 0.25; poly([[0, t], [w - hl, t], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, h - t], [0, h - t]]); break; }
      case 'leftArrow': { const hl = Math.min(ss * 0.5, w), t = h * 0.25; poly([[w, t], [hl, t], [hl, 0], [0, h / 2], [hl, h], [hl, h - t], [w, h - t]]); break; }
      case 'upArrow': { const hl = Math.min(ss * 0.5, h), t = w * 0.25; poly([[t, h], [t, hl], [0, hl], [w / 2, 0], [w, hl], [w - t, hl], [w - t, h]]); break; }
      case 'downArrow': { const hl = Math.min(ss * 0.5, h), t = w * 0.25; poly([[t, 0], [t, h - hl], [0, h - hl], [w / 2, h], [w, h - hl], [w - t, h - hl], [w - t, 0]]); break; }
      case 'leftRightArrow': { const hl = Math.min(ss * 0.5, w / 2), t = h * 0.25; poly([[0, h / 2], [hl, 0], [hl, t], [w - hl, t], [w - hl, 0], [w, h / 2], [w - hl, h], [w - hl, h - t], [hl, h - t], [hl, h]]); break; }
      case 'chevron': { const d = Math.min(ss * 0.5, w); poly([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h], [d, h / 2]]); break; }
      case 'homePlate': { const d = Math.min(ss * 0.5, w); poly([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h]]); break; }
      case 'wedgeRectCallout': poly([[0, 0], [w, 0], [w, h], [w * 0.35, h], [w * 0.29, h * 1.125 + 0], [w * 0.17, h], [0, h]]); break;
      case 'wedgeEllipseCallout': { p.ellipse(w / 2, h / 2, w / 2, h / 2, 0, -Math.PI * 0.62, Math.PI * 0.62 + Math.PI * 0.0, true); p.lineTo(w * 0.29, h * 1.125); p.closePath(); break; }
      case 'line': p.moveTo(0, 0); p.lineTo(w, h); break;
      case 'cust': {
        for (const sp of (o && o.path) || []) {
          const kx = sp.w ? w / sp.w : 1, ky = sp.h ? h / sp.h : 1;
          for (const k of sp.cmds) {
            if (k[0] === 'M') p.moveTo(k[1] * kx, k[2] * ky); else if (k[0] === 'L') p.lineTo(k[1] * kx, k[2] * ky);
            else if (k[0] === 'C') p.bezierCurveTo(k[1] * kx, k[2] * ky, k[3] * kx, k[4] * ky, k[5] * kx, k[6] * ky);
            else if (k[0] === 'Q') p.quadraticCurveTo(k[1] * kx, k[2] * ky, k[3] * kx, k[4] * ky); else if (k[0] === 'Z') p.closePath();
          }
        }
        break;
      }
      default: p.rect(0, 0, w, h);
    }
    return p;
  }

  function paintFill(c, f, theme, w, h, alpha) {
    if (!f) return null;
    if (f.grad) {
      const a = (f.ang || 0) * Math.PI / 180, cx = w / 2, cy = h / 2, L = Math.abs(w * Math.cos(a)) / 2 + Math.abs(h * Math.sin(a)) / 2;
      const g = c.createLinearGradient(cx - Math.cos(a) * L, cy - Math.sin(a) * L, cx + Math.cos(a) * L, cy + Math.sin(a) * L);
      for (const [pos, col] of f.grad) g.addColorStop(M.clamp(pos, 0, 1), M.color(col, theme));
      return g;
    }
    if (f.color) return M.color(f.color, theme);
    return null;
  }
  const DASH = { dash: [4, 3], dot: [1, 2], dashDot: [4, 3, 1, 3], lgDash: [8, 3] };
  function strokeLine(c, ln, theme, p) {
    if (!ln || !(ln.w > 0)) return;
    c.save(); c.strokeStyle = M.color(ln.color, theme); c.lineWidth = ln.w; if (ln.alpha != null) c.globalAlpha *= ln.alpha;
    const d = DASH[ln.dash]; c.setLineDash(d ? d.map(v => v * Math.max(1, ln.w)) : []); c.lineJoin = 'round'; c.lineCap = d ? 'butt' : 'round';
    c.stroke(p); c.restore();
  }
  function arrowHead(c, x0, y0, x1, y1, ln, theme) {
    const a = Math.atan2(y1 - y0, x1 - x0), L = Math.max(8, ln.w * 3.5), W = Math.max(6, ln.w * 2.6);
    c.save(); c.fillStyle = M.color(ln.color, theme); c.beginPath(); c.moveTo(x1, y1);
    c.lineTo(x1 - Math.cos(a) * L + Math.sin(a) * W / 2, y1 - Math.sin(a) * L - Math.cos(a) * W / 2);
    c.lineTo(x1 - Math.cos(a) * L - Math.sin(a) * W / 2, y1 - Math.sin(a) * L + Math.cos(a) * W / 2); c.closePath(); c.fill(); c.restore();
  }

  /* ---------------- images ---------------- */
  const imgCache = new Map(); let onImageLoad = null;
  function imageEl(assets, id) {
    const a = assets && assets[id]; if (!a) return null;
    let im = imgCache.get(id);
    if (!im || im._src !== a.data) {
      im = new Image(); im._src = a.data; im.decoding = 'async';
      im.onload = () => { if (!a.w) { a.w = im.naturalWidth; a.h = im.naturalHeight; } onImageLoad && onImageLoad(id); };
      im.src = a.data; imgCache.set(id, im);
    }
    return im.complete && im.naturalWidth ? im : null;
  }
  function imagesReady(assets) { return Promise.all(Object.keys(assets || {}).map(id => { imageEl(assets, id); const im = imgCache.get(id); return im && !im.complete ? im.decode().catch(() => {}) : null; })); }
  function drawImageCropped(c, im, w, h, crop) {
    const cr = crop || { l: 0, t: 0, r: 0, b: 0 }, iw = im.naturalWidth, ih = im.naturalHeight;
    // crop fractions may be negative (letterbox): map the visible part
    const fw = 1 - cr.l - cr.r, fh = 1 - cr.t - cr.b; if (fw <= 0 || fh <= 0) return;
    const sx0 = Math.max(0, cr.l), sy0 = Math.max(0, cr.t), sx1 = Math.min(1, 1 - cr.r), sy1 = Math.min(1, 1 - cr.b);
    const dx0 = (sx0 - cr.l) / fw * w, dy0 = (sy0 - cr.t) / fh * h, dx1 = (sx1 - cr.l) / fw * w, dy1 = (sy1 - cr.t) / fh * h;
    if (sx1 <= sx0 || sy1 <= sy0) return;
    c.drawImage(im, sx0 * iw, sy0 * ih, (sx1 - sx0) * iw, (sy1 - sy0) * ih, dx0, dy0, dx1 - dx0, dy1 - dy0);
  }

  /* ---------------- tables ---------------- */
  function tableCellFill(t, r, ci, theme) {
    const cell = t.rows[r].cells[ci];
    if (cell.fill) return cell.fill;
    const st = t.style || {}; if (st.none) return null;
    const col = st.color || 'accent1';
    if (st.first && r === 0) return { color: col };
    const k = st.first ? r - 1 : r;
    return { color: st.band && k % 2 === 0 ? col + ':+60' : col + ':+80' };
  }
  function drawTable(c, doc, ctx, o, opts) {
    const theme = doc.theme, st = o.style || {};
    let y = 0;
    const tot = o.cols.reduce((a, b) => a + b, 0) || 1, kx = o.w / tot, th = o.rows.reduce((a, r) => a + r.h, 0) || 1;
    const rowH = o.rows.map(r => Math.max(r.h, cellNeed(doc, ctx, o, r, kx)));
    const ky = 1;
    for (let r = 0; r < o.rows.length; r++) {
      let x = 0; const rh = rowH[r] * ky;
      for (let ci = 0; ci < o.cols.length; ci++) {
        const cw = o.cols[ci] * kx, f = tableCellFill(o, r, ci, theme);
        if (f) { c.fillStyle = paintFill(c, f, theme, cw, rh); c.fillRect(x, y, cw, rh); }
        const cell = o.rows[r].cells[ci];
        if (cell && cell.text && !(opts.editCell && opts.editCell.r === r && opts.editCell.c === ci && opts.editing === o.id)) {
          const hdr = st.first && r === 0 && !st.none;
          const pseudo = { type: 'table', text: { ...cell.text, def: { ...(cell.text.def || {}), ...(hdr ? { b: cell.b != null ? cell.b : true, color: (cell.text.def && cell.text.def.color) || 'bg1' } : {}) } } };
          const L = layoutText(doc, ctx, pseudo, pseudo.text, cw, rh, { slideNum: opts.slideNum });
          c.save(); c.translate(x, y); c.beginPath(); c.rect(0, 0, cw, rh); c.clip(); drawText(c, doc, L); c.restore();
        }
        x += cw;
      }
      y += rh;
    }
    // grid lines (white separators, like PowerPoint's "Medium Style 2")
    c.save(); c.strokeStyle = st.none ? M.color('tx1:+50', theme) : M.color('bg1', theme); c.lineWidth = st.none ? 1 : 2;
    let gx = 0; for (let ci = 0; ci < o.cols.length - 1; ci++) { gx += o.cols[ci] * kx; c.beginPath(); c.moveTo(gx, 0); c.lineTo(gx, y); c.stroke(); }
    let gy = 0; for (let r = 0; r < o.rows.length - 1; r++) { gy += rowH[r]; c.beginPath(); c.moveTo(0, gy); c.lineTo(o.w, gy); c.stroke(); }
    if (st.none) c.strokeRect(0, 0, o.w, y);
    c.restore();
    return y;
  }
  function cellNeed(doc, ctx, o, row, kx) {
    let need = 0;
    row.cells.forEach((cell, ci) => { if (!cell || !cell.text) return; const pseudo = { type: 'table', text: cell.text }; const L = layoutText(doc, ctx, pseudo, cell.text, o.cols[ci] * kx, row.h); need = Math.max(need, L.need); });
    return need;
  }
  function tableRowHeights(doc, ctx, o) { const tot = o.cols.reduce((a, b) => a + b, 0) || 1, kx = o.w / tot; return o.rows.map(r => Math.max(r.h, cellNeed(doc, ctx, o, r, kx))); }

  /* ---------------- charts ---------------- */
  function niceScale(min, max, n = 5) {
    if (min === max) { max = min + 1; }
    const span = max - min, raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    return { lo: Math.floor(min / step) * step, hi: Math.ceil(max / step) * step, step };
  }
  const fmtNum = v => Math.abs(v) >= 1e6 ? (v / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : Math.abs(v) >= 1e4 ? (v / 1e3).toFixed(0) + 'k' : String(+v.toFixed(2));
  function seriesColor(o, i, theme) { const s = o.series[i]; return M.color(s && s.color || ('accent' + (i % 6 + 1)) + (i >= 6 ? ':-25' : ''), theme); }
  function drawChart(c, doc, o) {
    const theme = doc.theme, W = o.w, H = o.h, fam = M.font('+mn', theme), txt = M.color('tx1:+25', theme), grid = M.color('tx1:+80', theme);
    const fs = M.clamp(Math.min(W, H) / 26, 10, 20);
    let top = 8, bottom = H - 8;
    c.textBaseline = 'alphabetic';
    if (o.title) { c.font = cssFont(fam, fs * 1.35, true, false); c.fillStyle = M.color('tx1', theme); c.textAlign = 'center'; c.fillText(o.title, W / 2, top + fs * 1.35); top += fs * 2.2; }
    const pie = o.kind === 'pie' || o.kind === 'doughnut';
    const legendItems = pie ? o.cats.map((cname, i) => [cname, seriesColor({ series: [] }, i, theme)]) : o.series.map((s, i) => [s.name, seriesColor(o, i, theme)]);
    if (o.legend && legendItems.length) {
      c.font = cssFont(fam, fs, false, false); const items = legendItems.map(([n, col]) => ({ n, col, w: measure(c.font, n) + fs * 1.6 }));
      const total = items.reduce((a, b) => a + b.w + fs, 0) - fs; let x = Math.max(4, (W - total) / 2); const y = bottom - fs * 0.3;
      c.textAlign = 'left';
      for (const it of items) { c.fillStyle = it.col; c.fillRect(x, y - fs * 0.8, fs * 0.8, fs * 0.8); c.fillStyle = txt; c.fillText(it.n, x + fs * 1.2, y); x += it.w + fs; }
      bottom -= fs * 2;
    }
    if (pie) {
      const s = o.series[0]; if (!s) return; const vals = s.vals.map(v => Math.max(0, v)); const sum = vals.reduce((a, b) => a + b, 0) || 1;
      const cx = W / 2, cy = (top + bottom) / 2, r = Math.max(4, Math.min(W / 2 - 8, (bottom - top) / 2));
      let a = -Math.PI / 2;
      vals.forEach((v, i) => {
        const da = v / sum * Math.PI * 2; c.beginPath(); c.moveTo(cx, cy); c.arc(cx, cy, r, a, a + da); c.closePath(); c.fillStyle = seriesColor({ series: [] }, i, theme); c.fill();
        c.strokeStyle = M.color('bg1', theme); c.lineWidth = 2; c.stroke();
        if (o.labels && v > 0) { const m = a + da / 2, lr = o.kind === 'doughnut' ? r * 0.78 : r * 0.62; c.font = cssFont(fam, fs, true, false); c.fillStyle = '#ffffff'; c.textAlign = 'center'; c.fillText(Math.round(v / sum * 100) + '%', cx + Math.cos(m) * lr, cy + Math.sin(m) * lr + fs * 0.35); }
        a += da;
      });
      if (o.kind === 'doughnut') { c.globalCompositeOperation = 'destination-out'; c.beginPath(); c.arc(cx, cy, r * 0.55, 0, Math.PI * 2); c.fill(); c.globalCompositeOperation = 'source-over'; }
      c.textAlign = 'left'; return;
    }
    const horiz = o.kind === 'bar', stacked = o.kind === 'stacked';
    let mn = 0, mx = 0;
    o.cats.forEach((_, ci) => { if (stacked) { let pos = 0, neg = 0; o.series.forEach(s => { const v = s.vals[ci] || 0; if (v > 0) pos += v; else neg += v; }); mx = Math.max(mx, pos); mn = Math.min(mn, neg); } else o.series.forEach(s => { const v = s.vals[ci] || 0; mx = Math.max(mx, v); mn = Math.min(mn, v); }); });
    const sc = niceScale(mn, mx);
    c.font = cssFont(fam, fs, false, false);
    const labW = horiz ? Math.max(...o.cats.map(n => measure(c.font, n)), 10) + 10 : Math.max(measure(c.font, fmtNum(sc.hi)), measure(c.font, fmtNum(sc.lo))) + 10;
    const px0 = 6 + labW, px1 = W - 10, py0 = top + 4, py1 = bottom - (horiz ? fs * 1.6 : fs * 1.8);
    if (px1 <= px0 || py1 <= py0) return;
    const vpos = v => horiz ? px0 + (v - sc.lo) / (sc.hi - sc.lo) * (px1 - px0) : py1 - (v - sc.lo) / (sc.hi - sc.lo) * (py1 - py0);
    // grid + value labels
    c.strokeStyle = grid; c.lineWidth = 1; c.fillStyle = txt;
    for (let v = sc.lo; v <= sc.hi + sc.step * 0.001; v += sc.step) {
      const p = vpos(v); c.beginPath();
      if (horiz) { c.moveTo(p, py0); c.lineTo(p, py1); c.stroke(); c.textAlign = 'center'; c.fillText(fmtNum(v), p, py1 + fs * 1.3); }
      else { c.moveTo(px0, p); c.lineTo(px1, p); c.stroke(); c.textAlign = 'right'; c.fillText(fmtNum(v), px0 - 6, p + fs * 0.35); }
    }
    const n = Math.max(1, o.cats.length), band = (horiz ? py1 - py0 : px1 - px0) / n, ns = Math.max(1, o.series.length);
    const zero = vpos(Math.max(sc.lo, Math.min(0, sc.hi)));
    c.strokeStyle = M.color('tx1:+50', theme); c.beginPath(); if (horiz) { c.moveTo(zero, py0); c.lineTo(zero, py1); } else { c.moveTo(px0, zero); c.lineTo(px1, zero); } c.stroke();
    // category labels
    c.fillStyle = txt;
    o.cats.forEach((name, i) => { const m = (horiz ? py0 : px0) + band * (i + 0.5); if (horiz) { c.textAlign = 'right'; c.fillText(name, px0 - 6, m + fs * 0.35); } else { c.textAlign = 'center'; c.fillText(name, m, py1 + fs * 1.4); } });
    if (o.kind === 'line' || o.kind === 'area') {
      o.series.forEach((s, si) => {
        const col = seriesColor(o, si, theme), pts = o.cats.map((_, i) => [px0 + band * (i + 0.5), vpos(s.vals[i] || 0)]);
        if (o.kind === 'area') { c.beginPath(); c.moveTo(pts[0][0], zero); pts.forEach(p => c.lineTo(p[0], p[1])); c.lineTo(pts[pts.length - 1][0], zero); c.closePath(); c.globalAlpha = 0.55; c.fillStyle = col; c.fill(); c.globalAlpha = 1; }
        c.beginPath(); pts.forEach((p, i) => i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.strokeStyle = col; c.lineWidth = Math.max(2, fs / 5); c.lineJoin = 'round'; c.stroke();
        if (o.kind === 'line') pts.forEach(p => { c.beginPath(); c.arc(p[0], p[1], Math.max(3, fs / 4), 0, Math.PI * 2); c.fillStyle = col; c.fill(); c.strokeStyle = M.color('bg1', theme); c.lineWidth = 1.5; c.stroke(); });
        if (o.labels) { c.fillStyle = txt; c.textAlign = 'center'; pts.forEach((p, i) => c.fillText(fmtNum(s.vals[i] || 0), p[0], p[1] - fs * 0.7)); }
      });
    } else {
      const gap = band * 0.25, bw = stacked ? band - gap * 2 : (band - gap * 2) / ns;
      o.cats.forEach((_, ci) => {
        let pos = 0, neg = 0;
        o.series.forEach((s, si) => {
          const v = s.vals[ci] || 0; let a, b;
          if (stacked) { if (v >= 0) { a = pos; pos += v; b = pos; } else { a = neg; neg += v; b = neg; } } else { a = 0; b = v; }
          const p0 = vpos(Math.max(sc.lo, Math.min(sc.hi, a))), p1 = vpos(Math.max(sc.lo, Math.min(sc.hi, b)));
          const off = (horiz ? py0 : px0) + band * ci + gap + (stacked ? 0 : bw * si);
          c.fillStyle = seriesColor(o, si, theme);
          if (horiz) c.fillRect(Math.min(p0, p1), off, Math.abs(p1 - p0), bw * 0.92); else c.fillRect(off, Math.min(p0, p1), bw * 0.92, Math.abs(p1 - p0));
          if (o.labels && v) { c.fillStyle = txt; c.textAlign = 'center'; if (horiz) c.fillText(fmtNum(v), Math.max(p0, p1) + 14, off + bw * 0.46 + fs * 0.35); else c.fillText(fmtNum(v), off + bw * 0.46, Math.min(p0, p1) - 4); }
        });
      });
    }
    c.textAlign = 'left';
  }

  /* ---------------- objects ---------------- */
  const PROMPT = { title: 'Click to add title', ctrTitle: 'Click to add title', subTitle: 'Click to add subtitle', body: 'Click to add text', pic: 'Click the icon to add a picture', dt: 'Date', ftr: 'Footer', sldNum: '‹#›' };
  function isEmptyText(tb) { return !tb || tb.paras.every(p => p.runs.every(r => !r.t && !r.fld)); }
  function drawObject(c, doc, ctx, o, assets, opts) {
    if (o.hidden && !opts.showHidden) return;
    const A = opts.anim && opts.anim.get(o.id);
    if (A && A.hidden) return;
    const theme = doc.theme;
    c.save();
    let alpha = (o.alpha != null ? o.alpha : 1) * (A && A.alpha != null ? A.alpha : 1);
    c.globalAlpha *= alpha;
    const cx = o.x + o.w / 2, cy = o.y + o.h / 2;
    c.translate(cx + (A && A.dx || 0), cy + (A && A.dy || 0));
    if (A && A.clip) { // wipe / split reveal, in slide space (unrotated)
      const p = A.clip.p, d = A.clip.dir; c.beginPath();
      const bx = -o.w / 2 - 4, by = -o.h / 2 - 4, bw = o.w + 8, bh = o.h + 8;
      if (d === 'l') c.rect(bx, by, bw * p, bh); else if (d === 'r') c.rect(bx + bw * (1 - p), by, bw * p, bh);
      else if (d === 't') c.rect(bx, by, bw, bh * p); else if (d === 'split') c.rect(bx + bw * (1 - p) / 2, by, bw * p, bh); else c.rect(bx, by + bh * (1 - p), bw, bh * p);
      c.clip();
    }
    if (A && (A.sx != null || A.rot)) { if (A.rot) c.rotate(A.rot * Math.PI / 180); if (A.sx != null) c.scale(A.sx, A.sy != null ? A.sy : A.sx); }
    if (o.rot) c.rotate(o.rot * Math.PI / 180);
    if (o.type === 'group') {
      c.translate(-cx, -cy);
      for (const k of o.children) drawObject(c, doc, ctx, k, assets, { ...opts, anim: null });
      c.restore(); return;
    }
    if (o.flipH || o.flipV) c.scale(o.flipH ? -1 : 1, o.flipV ? -1 : 1);
    c.translate(-o.w / 2, -o.h / 2);
    if (o.shadow) { const k = opts.scale || 1; c.shadowColor = 'rgba(0,0,0,0.32)'; c.shadowBlur = 14 * k; c.shadowOffsetX = 0; c.shadowOffsetY = 5 * k; }
    const prompts = opts.prompts && o.ph;
    if (o.type === 'shape') {
      const path = geomPath(o.geom, o.w, o.h, o);
      const fs = o.geom !== 'line' && paintFill(c, o.fill, theme, o.w, o.h);
      if (fs) { c.save(); if (o.fill.alpha != null) c.globalAlpha *= o.fill.alpha; c.fillStyle = fs; c.fill(path, o.geom === 'donut' ? 'evenodd' : 'nonzero'); c.restore(); }
      if (fs && o.shadow) c.shadowColor = 'transparent';
      if (o.line) {
        strokeLine(c, o.line, theme, path);
        if (o.geom === 'line') { if (o.line.tail) arrowHead(c, 0, 0, o.w, o.h, o.line, theme); if (o.line.head) arrowHead(c, o.w, o.h, 0, 0, o.line, theme); }
      }
      c.shadowColor = 'transparent';
      if (o.ph && o.ph.type === 'pic' && prompts) drawPicPrompt(c, doc, o);
      else if (o.text && opts.editing !== o.id) {
        const empty = isEmptyText(o.text);
        if (empty && prompts && o.ph.type !== 'sldNum') {
          const t = { paras: [{ runs: [{ t: PROMPT[o.ph.type] || PROMPT.body }] }] };
          const L = layoutText(doc, ctx, o, { ...o.text, paras: t.paras }, o.w, o.h, { slideNum: opts.slideNum });
          c.save(); c.globalAlpha *= 0.55; drawText(c, doc, L); c.restore();
        } else if (!empty) {
          const L = layoutText(doc, ctx, o, o.text, o.w, o.h, { slideNum: opts.slideNum, useStoredScale: opts.useStoredScale });
          if (o.text.vert === 'vert' || o.text.vert === 'vert270') { c.save(); c.translate(o.w / 2, o.h / 2); c.rotate((o.text.vert === 'vert' ? 90 : -90) * Math.PI / 180); c.translate(-o.h / 2, -o.w / 2); drawText(c, doc, layoutText(doc, ctx, o, o.text, o.h, o.w, { slideNum: opts.slideNum })); c.restore(); }
          else drawText(c, doc, L);
        }
      }
      if (prompts && (!o.fill && !o.line)) { c.save(); c.globalAlpha = 1; c.strokeStyle = 'rgba(110,130,160,.75)'; c.lineWidth = 1 / (opts.scale || 1); c.setLineDash([4 / (opts.scale || 1), 3 / (opts.scale || 1)]); c.strokeRect(0, 0, o.w, o.h); c.restore(); }
    } else if (o.type === 'image') {
      const im = imageEl(assets, o.asset);
      c.save();
      if (o.geom && o.geom !== 'rect') { c.clip(geomPath(o.geom, o.w, o.h, o)); }
      if (im) { if (o.shadow) { c.fillStyle = '#000'; c.fillRect(0, 0, o.w, o.h); c.shadowColor = 'transparent'; } drawImageCropped(c, im, o.w, o.h, o.crop); }
      else { c.fillStyle = 'rgba(150,170,200,.25)'; c.fillRect(0, 0, o.w, o.h); }
      c.restore();
      c.shadowColor = 'transparent';
      if (o.line) strokeLine(c, o.line, theme, o.geom && o.geom !== 'rect' ? geomPath(o.geom, o.w, o.h, o) : rectPath(o.w, o.h));
    } else if (o.type === 'table') {
      c.shadowColor = 'transparent';
      drawTable(c, doc, ctx, o, opts);
    } else if (o.type === 'chart') {
      c.shadowColor = 'transparent';
      if (o.fill) { c.fillStyle = paintFill(c, o.fill, theme, o.w, o.h); c.fillRect(0, 0, o.w, o.h); }
      drawChart(c, doc, o);
    }
    c.restore();
  }
  const rectPath = (w, h) => { const p = new Path2D(); p.rect(0, 0, w, h); return p; };
  function drawPicPrompt(c, doc, o) {
    c.save(); c.fillStyle = 'rgba(160,180,210,.18)'; c.fillRect(0, 0, o.w, o.h);
    const s = Math.min(o.w, o.h) * 0.16, x = o.w / 2 - s / 2, y = o.h / 2 - s / 2 - 10;
    c.strokeStyle = 'rgba(80,100,130,.7)'; c.lineWidth = Math.max(1.5, s / 22); c.strokeRect(x, y, s, s * 0.78);
    c.beginPath(); c.moveTo(x + s * 0.1, y + s * 0.68); c.lineTo(x + s * 0.38, y + s * 0.36); c.lineTo(x + s * 0.6, y + s * 0.58); c.lineTo(x + s * 0.72, y + s * 0.46); c.lineTo(x + s * 0.9, y + s * 0.68); c.stroke();
    c.beginPath(); c.arc(x + s * 0.72, y + s * 0.22, s * 0.08, 0, Math.PI * 2); c.stroke();
    c.font = cssFont('Segoe UI', 15, false, false); c.fillStyle = 'rgba(60,80,110,.8)'; c.textAlign = 'center'; c.fillText(PROMPT.pic, o.w / 2, y + s + 24); c.textAlign = 'left';
    c.restore();
  }
  function drawBackground(c, doc, bg, assets, W, H) {
    const theme = doc.theme;
    c.fillStyle = M.color('bg1', theme); c.fillRect(0, 0, W, H);
    if (!bg) return;
    if (bg.img) { const im = imageEl(assets, bg.img); if (im) { const k = Math.max(W / im.naturalWidth, H / im.naturalHeight), w = im.naturalWidth * k, h = im.naturalHeight * k; c.drawImage(im, (W - w) / 2, (H - h) / 2, w, h); } return; }
    const f = paintFill(c, bg, theme, W, H); if (f) { c.fillStyle = f; c.fillRect(0, 0, W, H); }
  }
  const effBg = (doc, slide, lay) => (slide && slide.bg) || (lay && lay.bg) || doc.master.bg;

  // footers: date / footer text / slide number placed by the master placeholders
  function drawFooters(c, doc, slide, lay, idx, opts) {
    const f = doc.footer; if (!f || (!f.num && !f.text && !f.date)) return;
    if (f.skipTitle && lay && lay.kind === 'title') return;
    const put = (type, runs) => { const p = M.masterPh(doc, type); if (!p) return; const o = { ...p, text: { ...p.text, paras: [{ runs }] } }; drawObject(c, doc, { master: true }, o, null, { ...opts, prompts: false, anim: null }); };
    if (f.date) put('dt', [{ t: '', fld: 'date' }]);
    if (f.text) put('ftr', [{ t: f.text }]);
    if (f.num) put('sldNum', [{ t: '', fld: 'slidenum' }]);
  }

  /* Draw a whole slide in slide coordinates (caller sets the transform).
     opts: {scale, anim:Map, prompts, editing, slideNum, showHidden} */
  function drawSlide(c, doc, slide, assets, opts = {}) {
    const lay = M.layoutOf(doc, slide), W = doc.w, H = doc.h;
    c.save();
    c.beginPath(); c.rect(0, 0, W, H); c.clip();
    drawBackground(c, doc, effBg(doc, slide, lay), assets, W, H);
    const o2 = { ...opts, prompts: false, anim: null };
    if (!(lay && lay.hideMaster)) for (const o of doc.master.objects) drawObject(c, doc, { master: true }, o, assets, o2);
    if (lay) for (const o of lay.objects) if (!o.ph) drawObject(c, doc, { layout: lay }, o, assets, o2);
    const ctx = { slide };
    for (const o of slide.objects) drawObject(c, doc, ctx, o, assets, opts);
    drawFooters(c, doc, slide, lay, opts.slideNum, opts);
    c.restore();
  }
  // Master / layout editing views
  function drawLayout(c, doc, lay, assets, opts = {}) {
    const W = doc.w, H = doc.h;
    c.save(); c.beginPath(); c.rect(0, 0, W, H); c.clip();
    drawBackground(c, doc, (lay && lay.bg) || doc.master.bg, assets, W, H);
    if (!lay) { for (const o of doc.master.objects) drawObject(c, doc, { master: true }, o, assets, opts); for (const o of doc.master.ph) drawObject(c, doc, { master: true }, o, assets, { ...opts, prompts: true }); }
    else {
      if (!lay.hideMaster) for (const o of doc.master.objects) drawObject(c, doc, { master: true }, o, assets, { ...opts, prompts: false, editing: null });
      for (const o of lay.objects) drawObject(c, doc, { layout: lay }, o, assets, { ...opts, prompts: true });
    }
    c.restore();
  }
  // render a slide into a new canvas of the given pixel width
  function slideCanvas(doc, slide, assets, width, opts = {}) {
    const k = width / doc.w, cv = opts.canvas || document.createElement('canvas');
    cv.width = Math.round(doc.w * k); cv.height = Math.round(doc.h * k);
    const c = cv.getContext('2d'); c.setTransform(k, 0, 0, k, 0, 0);
    drawSlide(c, doc, slide, assets, { scale: k, ...opts });
    return cv;
  }
  return { PT, LH, DEF_INS, layoutText, drawText, drawSlide, drawLayout, drawObject, slideCanvas, geomPath, cssFont, famCss, measure, paraStyle, runStyle, imageEl, imagesReady, tableRowHeights, clearMeasureCache,
    set onImageLoad(f) { onImageLoad = f; }, isEmptyText, PROMPT, effBg, fontMetrics };
})();
