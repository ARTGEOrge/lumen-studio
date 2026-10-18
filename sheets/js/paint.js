'use strict';
/* Lumen Sheets — cell painter shared by the on-screen grid and PDF/PNG export.
   paintCells(ctx, wb, sheet, rows, cols, opts): rows = [{i, y, h}], cols = [{i, x, w}] in canvas px (already zoomed).
   opts: {z (zoom), grid (gridlines), clip:{x,y,w,h}, filterBtns, formulas (show formulas)} */
(function (root) {
  const F = root.Formula, M = root.SheetModel;
  const K = M.K;
  const DEFAULT_FONT = 'Calibri', DEFAULT_SZ = 11;
  const FONT_STACK = f => `"${f}", Carlito, "Segoe UI", Arial, sans-serif`;
  const tw = new Map();
  function textW(ctx, font, s) {
    const k = font + '\u0001' + s; let w = tw.get(k);
    if (w == null) { ctx.font = font; w = ctx.measureText(s).width; if (tw.size > 20000) tw.clear(); tw.set(k, w); }
    return w;
  }
  function fontOf(s, z) {
    const sz = (s && s.sz || DEFAULT_SZ) * 96 / 72 * z;
    return `${s && s.i ? 'italic ' : ''}${s && s.b ? 'bold ' : ''}${sz.toFixed(2)}px ${FONT_STACK(s && s.font || DEFAULT_FONT)}`;
  }
  const isNum = v => typeof v === 'number';
  function wrapLines(ctx, font, text, maxW) {
    const out = [];
    for (const para of String(text).split('\n')) {
      const words = para.split(/(\s+)/); let line = '';
      for (const w of words) {
        const t = line + w;
        if (line && textW(ctx, font, t.trimEnd()) > maxW) { out.push(line.trimEnd()); line = w.trimStart(); }
        else line = t;
        while (textW(ctx, font, line) > maxW && line.length > 1) { // break very long words
          let k = line.length - 1; while (k > 1 && textW(ctx, font, line.slice(0, k)) > maxW) k--;
          out.push(line.slice(0, k)); line = line.slice(k);
        }
      }
      out.push(line);
    }
    return out;
  }
  // fit a General number into width by dropping decimals; '#' fill when impossible
  function fitNumber(ctx, font, disp, w, nf) {
    const s = disp.text; if (textW(ctx, font, s) <= w) return s;
    if ((!nf || /^general$/i.test(nf)) && isNum(disp.v)) {
      for (let p = 10; p >= 1; p--) { let t = String(parseFloat(disp.v.toPrecision(p))); if (/e/.test(t)) t = disp.v.toExponential(Math.max(0, p - 1)).replace(/e\+?/, 'E+').replace('E+-', 'E-'); if (textW(ctx, font, t) <= w) return t; }
    }
    const hw = textW(ctx, font, '#'); return '#'.repeat(Math.max(1, Math.floor(w / hw)));
  }
  const ICONS = {
    arrows: [['▼', '#c0504d'], ['▶', '#e7a300'], ['▲', '#4f9a3c']],
    traffic: [['●', '#d23b30'], ['●', '#f2b32b'], ['●', '#37a34a']],
    flags: [['⚑', '#d23b30'], ['⚑', '#f2b32b'], ['⚑', '#37a34a']]
  };
  function lineStyle(ctx, b, z) {
    const w = b.style === 'medium' ? 2 : b.style === 'thick' ? 3 : b.style === 'double' ? 3 : 1;
    ctx.lineWidth = Math.max(1, w * Math.min(1.5, z));
    ctx.setLineDash(b.style === 'dashed' ? [4, 2] : b.style === 'dotted' ? [1, 2] : b.style === 'hair' ? [1, 1] : []);
    ctx.strokeStyle = b.color || '#000';
  }

  function paintCells(ctx, wb, sheet, rows, cols, opts = {}) {
    const z = opts.z || 1;
    if (!rows.length || !cols.length) return;
    const x0 = cols[0].x, y0 = rows[0].y, x1 = cols[cols.length - 1].x + cols[cols.length - 1].w, y1 = rows[rows.length - 1].y + rows[rows.length - 1].h;
    ctx.save();
    if (opts.clip) { ctx.beginPath(); ctx.rect(opts.clip.x, opts.clip.y, opts.clip.w, opts.clip.h); ctx.clip(); }
    ctx.fillStyle = '#fff'; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    const colAt = new Map(cols.map((c, k) => [c.i, k]));
    const rowAt = new Map(rows.map((r, k) => [r.i, k]));
    // gridlines
    if (opts.grid !== false && sheet.showGrid) {
      ctx.beginPath(); ctx.strokeStyle = '#e1e5ea'; ctx.lineWidth = 1;
      for (const c of cols) { const x = Math.round(c.x + c.w) - 0.5; ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      for (const r of rows) { const y = Math.round(r.y + r.h) - 0.5; ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      ctx.stroke();
    }
    // merged regions that intersect the area
    const merges = sheet.merges.filter(m => m.r2 >= rows[0].i && m.r1 <= rows[rows.length - 1].i && m.c2 >= cols[0].i && m.c1 <= cols[cols.length - 1].i);
    const mergeRect = m => {
      // compute rect even if the top-left lies outside: use known positions + axis sizes from opts
      const rx = opts.posX ? opts.posX(m.c1) : (colAt.has(m.c1) ? cols[colAt.get(m.c1)].x : null);
      const ry = opts.posY ? opts.posY(m.r1) : (rowAt.has(m.r1) ? rows[rowAt.get(m.r1)].y : null);
      const rx2 = opts.posX ? opts.posX(m.c2 + 1) : (colAt.has(m.c2) ? cols[colAt.get(m.c2)].x + cols[colAt.get(m.c2)].w : null);
      const ry2 = opts.posY ? opts.posY(m.r2 + 1) : (rowAt.has(m.r2) ? rows[rowAt.get(m.r2)].y + rows[rowAt.get(m.r2)].h : null);
      if (rx == null || ry == null || rx2 == null || ry2 == null) return null;
      return { x: rx, y: ry, w: rx2 - rx, h: ry2 - ry };
    };
    const borders = [];
    const drawOne = (r, c, x, y, w, h, merged) => {
      const cell = sheet.cells.get(K(r, c)), s = cell && cell.s;
      const cf = sheet.cf.length ? wb.cfFormat(sheet, r, c) : null;
      const fill = (cf && cf.fill) || (s && s.fill);
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
      else if (merged) { ctx.fillStyle = '#fff'; ctx.fillRect(x, y, w - 1, h - 1); }
      if (cf && cf.bar) {
        const b = cf.bar, pad = 2 * z, bw = (w - pad * 2), zx = x + pad + bw * b.zero, ex = x + pad + bw * b.pct;
        const g = ctx.createLinearGradient(Math.min(zx, ex), 0, Math.max(zx, ex), 0);
        const col = b.neg ? '#e05d5d' : b.color; g.addColorStop(0, col); g.addColorStop(1, M.mixHex(col, '#ffffff', 0.85));
        ctx.fillStyle = g; ctx.fillRect(Math.min(zx, ex), y + pad, Math.abs(ex - zx), h - pad * 2);
      }
      if (s && (s.bt || s.bb || s.bl || s.br)) borders.push([x, y, w, h, s]);
      let v, disp;
      if (opts.formulas && cell && cell.f != null) { disp = { text: '=' + cell.f }; v = disp.text; }
      else { disp = wb.display(sheet, r, c); v = disp.v; }
      if (disp.text === '' && !(cf && cf.icon != null)) return;
      const ff = fontOf(cf && (cf.b || cf.i) ? Object.assign({}, s, { b: cf.b || (s && s.b), i: cf.i || (s && s.i) }) : s, z);
      ctx.font = ff;
      const err = v instanceof F.FErr;
      let ha = s && s.ha || (opts.formulas && cell && cell.f != null ? 'left' : isNum(v) ? 'right' : typeof v === 'boolean' || err ? 'center' : 'left');
      const va = s && s.va || 'bottom';
      const pad = 3 * z, indent = (s && s.indent || 0) * 9 * z;
      let tx = x + pad, text = disp.text, availW = w - pad * 2;
      if (cf && cf.icon != null) { const ic = ICONS[cf.iconSet || 'arrows'][cf.icon]; ctx.fillStyle = ic[1]; ctx.font = `${(11 * z).toFixed(1)}px "Segoe UI Symbol", "Segoe UI", sans-serif`; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(ic[0], x + pad, y + h / 2); ctx.font = ff; tx += 13 * z; availW -= 13 * z; }
      const color = (cf && cf.color) || disp.color || (s && s.color) || (err ? '#c00000' : '#000');
      ctx.fillStyle = color; ctx.textBaseline = 'alphabetic';
      const fsz = (s && s.sz || DEFAULT_SZ) * 96 / 72 * z, lineH = fsz * 1.22;
      const wrap = s && s.wrap;
      let lines;
      if (wrap) lines = wrapLines(ctx, ff, text, Math.max(4, availW - indent));
      else {
        if (isNum(v) && !(opts.formulas && cell && cell.f != null)) text = fitNumber(ctx, ff, disp, availW, s && s.nf);
        lines = [text.replace(/\n/g, ' ')];
      }
      const blockH = lines.length * lineH;
      let ty = va === 'top' ? y + fsz + 2 * z : va === 'middle' ? y + (h - blockH) / 2 + fsz * 0.95 : y + h - blockH + fsz * 0.95 - 3 * z;
      // overflow into empty neighbours for unwrapped text
      let clipX = x, clipW = w;
      const tW = textW(ctx, ff, lines[0]);
      if (!wrap && !merged && !isNum(v) && tW > availW) {
        if (ha === 'left') {
          let k = colAt.get(c); let ex = x + w;
          while (k != null && k + 1 < cols.length && ex - x - pad < tW + indent) { const nc = cols[k + 1]; if (sheet.value(r, nc.i) != null || sheet.mergeAt(r, nc.i)) break; const nfill = sheet.get(r, nc.i); if (!(nfill && nfill.s && nfill.s.fill)) { ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(nc.x, y, nc.w - 1, h - 1); ctx.restore(); } ex = nc.x + nc.w; k++; }
          clipW = ex - x;
        } else if (ha === 'right') {
          let k = colAt.get(c); let sx = x;
          while (k != null && k > 0 && x + w - sx - pad < tW) { const pc = cols[k - 1]; if (sheet.value(r, pc.i) != null || sheet.mergeAt(r, pc.i)) break; ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(pc.x, y, pc.w - 1, h - 1); ctx.restore(); sx = pc.x; k--; }
          clipW = x + w - sx; clipX = sx;
        }
        ctx.fillStyle = color;
      }
      ctx.save(); ctx.beginPath(); ctx.rect(clipX, y, clipW, h); ctx.clip();
      for (const line of lines) {
        const lw = textW(ctx, ff, line);
        let lx = ha === 'right' ? x + w - pad - lw - indent : ha === 'center' ? x + (w - lw) / 2 : tx + indent;
        ctx.textAlign = 'left'; ctx.fillText(line, lx, ty);
        if (s && (s.u || s.st)) { ctx.fillRect(lx, ty + (s.u ? fsz * 0.12 : -fsz * 0.3), lw, Math.max(1, z)); }
        ty += lineH;
      }
      ctx.restore();
    };
    // regular cells
    const covered = m => m && !(m.r1 === -1);
    for (const rr of rows) {
      for (const cc of cols) {
        const m = merges.length ? sheet.mergeAt(rr.i, cc.i) : null;
        if (covered(m)) continue;
        drawOne(rr.i, cc.i, cc.x, rr.y, cc.w, rr.h, false);
      }
    }
    // merged cells drawn whole
    for (const m of merges) { const rc = mergeRect(m); if (!rc) continue; ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip(); drawOne(m.r1, m.c1, rc.x, rc.y, rc.w, rc.h, true); ctx.restore(); }
    // borders
    for (const [x, y, w, h, s] of borders) {
      const L = (b, ax, ay, bx, by) => { if (!b) return; lineStyle(ctx, b, z); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); if (b.style === 'double') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke(); } };
      const X0 = Math.round(x) - 0.5, Y0 = Math.round(y) - 0.5, X1 = Math.round(x + w) - 0.5, Y1 = Math.round(y + h) - 0.5;
      L(s.bt, X0, Y0, X1, Y0); L(s.bb, X0, Y1, X1, Y1); L(s.bl, X0, Y0, X0, Y1); L(s.br, X1, Y0, X1, Y1);
    }
    ctx.setLineDash([]);
    // autofilter buttons
    if (opts.filterBtns && sheet.filter) {
      const g = sheet.filter.range;
      const hr = rows.find(r => r.i === g.r1);
      if (hr) for (const cc of cols) {
        if (cc.i < g.c1 || cc.i > g.c2) continue;
        const bs = Math.min(17, hr.h - 2), bx = cc.x + cc.w - bs - 1, by = hr.y + hr.h - bs - 1;
        const active = sheet.filter.crit && sheet.filter.crit[cc.i];
        const grd = ctx.createLinearGradient(0, by, 0, by + bs); grd.addColorStop(0, '#fdfdfd'); grd.addColorStop(1, '#dfe6ee');
        ctx.fillStyle = grd; ctx.fillRect(bx, by, bs, bs); ctx.strokeStyle = '#8fa2b8'; ctx.lineWidth = 1; ctx.strokeRect(bx + 0.5, by + 0.5, bs - 1, bs - 1);
        ctx.fillStyle = active ? '#1e5bb8' : '#333';
        if (active) { ctx.beginPath(); ctx.moveTo(bx + 4, by + 4); ctx.lineTo(bx + bs - 4, by + 4); ctx.lineTo(bx + bs / 2 + 1, by + bs / 2); ctx.lineTo(bx + bs / 2 + 1, by + bs - 4); ctx.lineTo(bx + bs / 2 - 1, by + bs - 5); ctx.lineTo(bx + bs / 2 - 1, by + bs / 2); ctx.closePath(); ctx.fill(); }
        else { ctx.beginPath(); ctx.moveTo(bx + 4.5, by + bs / 2 - 2); ctx.lineTo(bx + bs - 4.5, by + bs / 2 - 2); ctx.lineTo(bx + bs / 2, by + bs / 2 + 2.5); ctx.closePath(); ctx.fill(); }
      }
    }
    ctx.restore();
  }

  root.SheetPaint = { paintCells, fontOf, textW, wrapLines, DEFAULT_FONT, DEFAULT_SZ, FONT_STACK };
})(typeof self !== 'undefined' ? self : this);
