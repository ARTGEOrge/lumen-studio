'use strict';
/* Lumen Sheets — virtual-scrolling canvas grid: headers, freeze panes, selection, in-cell editing with
   reference pointing / autocomplete, fill handle, resizing, keyboard navigation and clipboard. */
(function (root) {
  const F = root.Formula, M = root.SheetModel, P = root.SheetPaint, Fmt = root.SheetFormat;
  const { K } = M;
  const MAXR = F.MAXR, MAXC = F.MAXC;
  const DEF_W = 72, DEF_H = 20, HDR_W = 46, HDR_H = 22;
  const SEL = '#1f6fd0', SEL_FILL = 'rgba(31,111,208,0.10)';
  // most-used functions are offered first by autocomplete
  const POP = 'SUM AVERAGE COUNT IF VLOOKUP XLOOKUP INDEX MATCH MAX MIN ROUND SUMIF SUMIFS COUNTIF COUNTIFS IFERROR AND OR TEXT DATE TODAY NOW LEFT RIGHT MID LEN CONCAT TRIM UPPER LOWER ABS COUNTA AVERAGEIF IFS FILTER SORT UNIQUE SEQUENCE PMT NPV IRR YEAR MONTH DAY ROUNDUP ROUNDDOWN INT MOD MEDIAN STDEV.S RANK LARGE SMALL SUBTOTAL SUMPRODUCT TEXTJOIN SUBSTITUTE FIND SEARCH VALUE EOMONTH EDATE NETWORKDAYS WORKDAY'.split(' ');
  const REF_COLORS = ['#1f6fd0', '#d23f31', '#7b3fbf', '#1d8a4b', '#c46a00', '#0f8b8d', '#b5338a'];

  /* ---------- axis: positions with custom sizes and hidden rows/cols ---------- */
  class Axis {
    constructor(def, sizes, hidden, hidden2, count) {
      this.def = def; this.count = count;
      const idx = new Set(sizes.keys()); for (const i of hidden) idx.add(i); if (hidden2) for (const i of hidden2) idx.add(i);
      this.idx = [...idx].sort((a, b) => a - b);
      this.sz = this.idx.map(i => hidden.has(i) || (hidden2 && hidden2.has(i)) ? 0 : sizes.get(i));
      this.pre = new Float64Array(this.idx.length + 1);
      for (let k = 0; k < this.idx.length; k++) this.pre[k + 1] = this.pre[k] + this.sz[k] - def;
      this.map = new Map(this.idx.map((i, k) => [i, this.sz[k]]));
    }
    size(i) { const s = this.map.get(i); return s == null ? this.def : s; }
    lb(i) { let lo = 0, hi = this.idx.length; while (lo < hi) { const m = (lo + hi) >> 1; if (this.idx[m] < i) lo = m + 1; else hi = m; } return lo; }
    pos(i) { return i * this.def + this.pre[this.lb(i)]; }
    // first index whose extent contains p (skipping zero-size entries)
    index(p) {
      if (p <= 0) { let i = 0; while (i < this.count - 1 && this.size(i) === 0) i++; return i; }
      let lo = 0, hi = this.count - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (this.pos(m + 1) > p) hi = m; else lo = m + 1; }
      return lo;
    }
  }

  class GridView {
    constructor(host) {
      this.host = host; // {wb, sheet(), onSelect(), onChange(), openFilter(), contextMenu(), status()}
      this.wrap = document.getElementById('gridWrap');
      this.canvas = document.getElementById('grid'); this.ctx = this.canvas.getContext('2d');
      this.scroller = document.getElementById('scroller'); this.spacer = document.getElementById('spacer');
      this.objLayer = document.getElementById('objLayer');
      this.editor = document.getElementById('editor'); this.kbd = document.getElementById('kbd');
      this.fbar = document.getElementById('fbar'); this.nameBox = document.getElementById('nameBox');
      this.ac = document.getElementById('acList'); this.tip = document.getElementById('sigTip');
      this.sel = { r: 0, c: 0, ranges: [{ r1: 0, c1: 0, r2: 0, c2: 0 }], anchor: { r: 0, c: 0 } };
      this.edit = null; this.copyMark = null; this.extR = 1000; this.extC = 52; this.axisKey = null;
      this.showFormulas = false; this.drag = null; this.raf = 0; this.chartSel = null;
      this.bind();
      new ResizeObserver(() => this.render()).observe(this.wrap);
    }
    get wb() { return this.host.wb; }
    get sheet() { return this.host.sheet(); }
    get z() { return this.sheet.zoom || 1; }

    /* ---------- geometry ---------- */
    axes() {
      const sh = this.sheet, b = sh.bounds();
      this.extR = Math.min(MAXR, Math.max(this.extR, b.r + 200, 1000, sh.freeze.r + 50));
      this.extC = Math.min(MAXC, Math.max(this.extC, b.c + 12, 26, sh.freeze.c + 20));
      const key = sh.id + ':' + this.layoutGen + ':' + this.extR + ':' + this.extC;
      if (this.axisKey !== key) {
        this.rowsAx = new Axis(DEF_H, sh.rowH, sh.hiddenRows, sh.filtered, this.extR);
        this.colsAx = new Axis(DEF_W, sh.colW, sh.hiddenCols, null, this.extC);
        this.axisKey = key;
      }
      return [this.rowsAx, this.colsAx];
    }
    invalidate() { this.layoutGen = (this.layoutGen || 0) + 1; }
    metrics() {
      const [R, C] = this.axes(), sh = this.sheet, z = this.z;
      const fx = C.pos(sh.freeze.c), fy = R.pos(sh.freeze.r);
      const sx = this.scroller.scrollLeft / z, sy = this.scroller.scrollTop / z;
      const W = this.wrap.clientWidth, H = this.wrap.clientHeight;
      return { R, C, z, fx, fy, sx, sy, W, H, fr: sh.freeze.r, fc: sh.freeze.c };
    }
    // sheet units → screen px (relative to wrap)
    sx(m, x) { return x < m.fx ? HDR_W + x * m.z : HDR_W + (x - m.sx) * m.z; }
    sy(m, y) { return y < m.fy ? HDR_H + y * m.z : HDR_H + (y - m.sy) * m.z; }
    colX(m, c) { return this.sx(m, m.C.pos(c)); }
    rowY(m, r) { return this.sy(m, m.R.pos(r)); }
    // screen px → cell
    hit(px, py) {
      const m = this.metrics();
      const x = px < HDR_W + m.fx * m.z ? (px - HDR_W) / m.z : (px - HDR_W) / m.z + m.sx;
      const y = py < HDR_H + m.fy * m.z ? (py - HDR_H) / m.z : (py - HDR_H) / m.z + m.sy;
      return { r: m.R.index(Math.max(0, y)), c: m.C.index(Math.max(0, x)), inColHdr: py < HDR_H, inRowHdr: px < HDR_W, x, y, m };
    }
    cellRect(r, c) {
      const m = this.metrics(), mg = this.sheet.mergeAt(r, c);
      const r1 = mg ? mg.r1 : r, c1 = mg ? mg.c1 : c, r2 = mg ? mg.r2 : r, c2 = mg ? mg.c2 : c;
      const x = this.colX(m, c1), y = this.rowY(m, r1);
      return { x, y, w: this.colX(m, c2 + 1) - x, h: this.rowY(m, r2 + 1) - y };
    }

    /* ---------- painting ---------- */
    render() { if (this.raf) return; this.raf = requestAnimationFrame(() => { this.raf = 0; this.paint(); }); }
    paint() {
      const W = this.wrap.clientWidth, H = this.wrap.clientHeight; if (!W || !H) return;
      const dpr = window.devicePixelRatio || 1, cv = this.canvas;
      if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
      const ctx = this.ctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const m = this.metrics(), sh = this.sheet, z = m.z;
      // spacer size
      const totW = HDR_W + m.C.pos(this.extC) * z + 40, totH = HDR_H + m.R.pos(this.extR) * z + 40;
      if (this.spacer._w !== totW || this.spacer._h !== totH) { this.spacer.style.width = totW + 'px'; this.spacer.style.height = totH + 'px'; this.spacer._w = totW; this.spacer._h = totH; }
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
      const cellW = W - HDR_W, cellH = H - HDR_H;
      const frozenWpx = m.fx * z, frozenHpx = m.fy * z;
      const span = (ax, from, to, scr, isCol) => { // indices overlapping [from,to) sheet units with screen positions
        const out = []; let i = ax.index(from), guard = 0;
        while (i < ax.count && guard++ < 2000) {
          const p = ax.pos(i), s = ax.size(i); if (p >= to) break;
          if (s > 0) out.push(isCol ? { i, x: scr(p), w: s * z } : { i, y: scr(p), h: s * z });
          const nx = ax.index(p + s); i = nx > i ? nx : i + 1;
          if (p + s >= to) break;
        }
        return out;
      };
      const scrX = p => this.sx(m, p), scrY = p => this.sy(m, p);
      const colsF = m.fc ? span(m.C, 0, m.fx, scrX, true) : [];
      const rowsF = m.fr ? span(m.R, 0, m.fy, scrY, false) : [];
      const colsS = span(m.C, m.fx + m.sx, m.fx + m.sx + (cellW - frozenWpx) / z, scrX, true);
      const rowsS = span(m.R, m.fy + m.sy, m.fy + m.sy + (cellH - frozenHpx) / z, scrY, false);
      this.visible = { colsS, rowsS, colsF, rowsF };
      const opts = { z, grid: true, filterBtns: true, formulas: this.showFormulas, posX: c => this.colX(m, c), posY: r => this.rowY(m, r) };
      const paneX = HDR_W + frozenWpx, paneY = HDR_H + frozenHpx;
      P.paintCells(ctx, this.wb, sh, rowsS, colsS, Object.assign({}, opts, { clip: { x: paneX, y: paneY, w: W - paneX, h: H - paneY } }));
      if (rowsF.length) P.paintCells(ctx, this.wb, sh, rowsF, colsS, Object.assign({}, opts, { clip: { x: paneX, y: HDR_H, w: W - paneX, h: frozenHpx } }));
      if (colsF.length) P.paintCells(ctx, this.wb, sh, rowsS, colsF, Object.assign({}, opts, { clip: { x: HDR_W, y: paneY, w: frozenWpx, h: H - paneY } }));
      if (rowsF.length && colsF.length) P.paintCells(ctx, this.wb, sh, rowsF, colsF, Object.assign({}, opts, { clip: { x: HDR_W, y: HDR_H, w: frozenWpx, h: frozenHpx } }));
      // overlays clipped to the cell area
      ctx.save(); ctx.beginPath(); ctx.rect(HDR_W, HDR_H, cellW, cellH); ctx.clip();
      this.paintSpillBox(ctx, m);
      this.paintRefs(ctx, m);
      this.paintSelection(ctx, m);
      ctx.restore();
      // freeze lines
      ctx.strokeStyle = '#8c9bab'; ctx.lineWidth = 1.5;
      if (m.fc) { ctx.beginPath(); ctx.moveTo(paneX, HDR_H); ctx.lineTo(paneX, H); ctx.stroke(); }
      if (m.fr) { ctx.beginPath(); ctx.moveTo(HDR_W, paneY); ctx.lineTo(W, paneY); ctx.stroke(); }
      this.paintHeaders(ctx, m, [...colsF, ...colsS], [...rowsF, ...rowsS], W, H, frozenWpx, frozenHpx);
      this.placeObjects(m);
      if (this.edit) this.placeEditor();
    }
    paintHeaders(ctx, m, cols, rows, W, H, fW, fH) {
      const sel = this.sel, selCols = new Set(), selRows = new Set();
      let fullCols = new Set(), fullRows = new Set();
      for (const g of sel.ranges) {
        for (let c = g.c1; c <= Math.min(g.c2, g.c1 + 400); c++) selCols.add(c);
        for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 400); r++) selRows.add(r);
        if (g.r1 === 0 && g.r2 >= MAXR - 1) for (let c = g.c1; c <= Math.min(g.c2, g.c1 + 400); c++) fullCols.add(c);
        if (g.c1 === 0 && g.c2 >= MAXC - 1) for (let r = g.r1; r <= Math.min(g.r2, g.r1 + 400); r++) fullRows.add(r);
      }
      // column header
      ctx.save(); ctx.beginPath(); ctx.rect(HDR_W, 0, W - HDR_W, HDR_H); ctx.clip();
      let g = ctx.createLinearGradient(0, 0, 0, HDR_H); g.addColorStop(0, '#fbfcfe'); g.addColorStop(1, '#e6ecf3');
      ctx.fillStyle = g; ctx.fillRect(HDR_W, 0, W, HDR_H);
      ctx.font = '12px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const c of cols) {
        if (c.x + c.w < HDR_W + (cols === null ? 0 : 0)) continue;
        if (selCols.has(c.i)) { ctx.fillStyle = fullCols.has(c.i) ? '#9fc3ee' : '#d3e3f7'; ctx.fillRect(c.x, 0, c.w, HDR_H); ctx.fillStyle = SEL; ctx.fillRect(c.x, HDR_H - 2, c.w, 2); }
        ctx.fillStyle = selCols.has(c.i) ? '#0c3d7a' : '#3a4653'; ctx.fillText(F.colName(c.i), c.x + c.w / 2, HDR_H / 2 + 1);
        ctx.fillStyle = '#c5d0dc'; ctx.fillRect(Math.round(c.x + c.w) - 1, 3, 1, HDR_H - 6);
      }
      ctx.fillStyle = '#b6c3d1'; ctx.fillRect(HDR_W, HDR_H - 1, W, 1);
      ctx.restore();
      // row header
      ctx.save(); ctx.beginPath(); ctx.rect(0, HDR_H, HDR_W, H - HDR_H); ctx.clip();
      g = ctx.createLinearGradient(0, 0, HDR_W, 0); g.addColorStop(0, '#f7f9fc'); g.addColorStop(1, '#e9eef4');
      ctx.fillStyle = g; ctx.fillRect(0, HDR_H, HDR_W, H);
      ctx.font = '11.5px "Segoe UI", sans-serif'; ctx.textAlign = 'right';
      for (const r of rows) {
        if (selRows.has(r.i)) { ctx.fillStyle = fullRows.has(r.i) ? '#9fc3ee' : '#d3e3f7'; ctx.fillRect(0, r.y, HDR_W, r.h); ctx.fillStyle = SEL; ctx.fillRect(HDR_W - 2, r.y, 2, r.h); }
        if (r.h >= 9) { ctx.fillStyle = selRows.has(r.i) ? '#0c3d7a' : '#3a4653'; ctx.fillText(String(r.i + 1), HDR_W - 6, r.y + r.h / 2 + 1); }
        ctx.fillStyle = '#d3dbe4'; ctx.fillRect(0, Math.round(r.y + r.h) - 1, HDR_W, 1);
      }
      ctx.fillStyle = '#b6c3d1'; ctx.fillRect(HDR_W - 1, HDR_H, 1, H);
      ctx.restore();
      // corner
      g = ctx.createLinearGradient(0, 0, 0, HDR_H); g.addColorStop(0, '#fbfcfe'); g.addColorStop(1, '#e1e8f0');
      ctx.fillStyle = g; ctx.fillRect(0, 0, HDR_W, HDR_H);
      ctx.fillStyle = '#b0bccb'; ctx.beginPath(); ctx.moveTo(HDR_W - 4, 4); ctx.lineTo(HDR_W - 4, HDR_H - 4); ctx.lineTo(HDR_W - HDR_H + 4, HDR_H - 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#b6c3d1'; ctx.fillRect(HDR_W - 1, 0, 1, HDR_H); ctx.fillRect(0, HDR_H - 1, HDR_W, 1);
    }
    rangeRect(m, g) {
      const x1 = this.colX(m, g.c1), y1 = this.rowY(m, g.r1);
      const x2 = this.colX(m, Math.min(g.c2 + 1, this.extC + 50)), y2 = this.rowY(m, Math.min(g.r2 + 1, this.extR + 200));
      return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
    paintSelection(ctx, m) {
      const sel = this.sel;
      if (this.chartSel) return;
      ctx.fillStyle = SEL_FILL;
      for (const g of sel.ranges) {
        const e = this.expandMerges(g), rc = this.rangeRect(m, e);
        if (e.r1 === e.r2 && e.c1 === e.c2) continue;
        ctx.fillRect(rc.x, rc.y, rc.w, rc.h);
      }
      // active cell un-tinted
      const ac = this.cellRect(sel.r, sel.c);
      const last = this.expandMerges(sel.ranges[sel.ranges.length - 1]);
      if (!(last.r1 === last.r2 && last.c1 === last.c2)) { ctx.fillStyle = '#fff'; ctx.globalAlpha = 0; ctx.fillRect(ac.x, ac.y, ac.w, ac.h); ctx.globalAlpha = 1; }
      const rc = this.rangeRect(m, last);
      ctx.strokeStyle = SEL; ctx.lineWidth = 2; ctx.strokeRect(rc.x + 0.5, rc.y + 0.5, rc.w - 1, rc.h - 1);
      if (sel.ranges.length > 1 || !(last.r1 === last.r2 && last.c1 === last.c2)) { ctx.lineWidth = 1; ctx.strokeStyle = SEL; ctx.strokeRect(ac.x + 1.5, ac.y + 1.5, ac.w - 3, ac.h - 3); }
      // fill handle
      if (!this.edit) { ctx.fillStyle = '#fff'; ctx.fillRect(rc.x + rc.w - 4.5, rc.y + rc.h - 4.5, 7, 7); ctx.fillStyle = SEL; ctx.fillRect(rc.x + rc.w - 3.5, rc.y + rc.h - 3.5, 5, 5); }
      // fill preview
      if (this.drag && this.drag.kind === 'fill' && this.drag.target) { const t = this.rangeRect(m, this.drag.target); ctx.setLineDash([4, 3]); ctx.strokeStyle = '#555'; ctx.lineWidth = 1; ctx.strokeRect(t.x + 0.5, t.y + 0.5, t.w - 1, t.h - 1); ctx.setLineDash([]); }
      // copy marching ants
      if (this.copyMark && this.copyMark.sheet === this.sheet) {
        const t = this.rangeRect(m, this.copyMark.range); ctx.setLineDash([5, 3]); ctx.lineDashOffset = -(this.antPhase || 0); ctx.strokeStyle = '#1f6fd0'; ctx.lineWidth = 1.5; ctx.strokeRect(t.x + 1, t.y + 1, t.w - 2, t.h - 2); ctx.setLineDash([]);
      }
    }
    paintSpillBox(ctx, m) {
      const sh = this.sheet; let key = K(this.sel.r, this.sel.c), cell = sh.cells.get(key);
      if (!(cell && cell.spill)) { const src = sh.spill.get(key); if (src == null) return; key = src; cell = sh.cells.get(src); if (!cell || !cell.spill) return; }
      const r = Math.floor(key / MAXC), c = key % MAXC, rc = this.rangeRect(m, { r1: r, c1: c, r2: r + cell.spill.rows - 1, c2: c + cell.spill.cols - 1 });
      ctx.setLineDash([3, 2]); ctx.strokeStyle = '#4a86e8'; ctx.lineWidth = 1; ctx.strokeRect(rc.x + 0.5, rc.y + 0.5, rc.w - 1, rc.h - 1); ctx.setLineDash([]);
    }
    paintRefs(ctx, m) {
      if (!this.edit || this.edit.text[0] !== '=') return;
      let toks; try { toks = F.tokenize(this.edit.text.slice(1)); } catch (e) { return; }
      let k = 0;
      for (const t of toks) {
        if (t.t !== 'ref') continue;
        const col = REF_COLORS[k++ % REF_COLORS.length];
        if (t.sheet && t.sheet.toLowerCase() !== this.sheet.name.toLowerCase()) continue;
        const rc = this.rangeRect(m, { r1: t.r1, c1: t.c1, r2: Math.min(t.r2, this.extR), c2: Math.min(t.c2, this.extC) });
        ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.strokeRect(rc.x + 1, rc.y + 1, rc.w - 2, rc.h - 2);
        ctx.globalAlpha = 0.08; ctx.fillStyle = col; ctx.fillRect(rc.x, rc.y, rc.w, rc.h); ctx.globalAlpha = 1;
      }
    }
    expandMerges(g) {
      const sh = this.sheet; if (!sh.merges.length) return g;
      let e = { ...g }, changed = true, guard = 0;
      while (changed && guard++ < 20) {
        changed = false;
        for (const mg of sh.merges) if (mg.r2 >= e.r1 && mg.r1 <= e.r2 && mg.c2 >= e.c1 && mg.c1 <= e.c2) {
          if (mg.r1 < e.r1) { e.r1 = mg.r1; changed = true; } if (mg.c1 < e.c1) { e.c1 = mg.c1; changed = true; }
          if (mg.r2 > e.r2) { e.r2 = mg.r2; changed = true; } if (mg.c2 > e.c2) { e.c2 = mg.c2; changed = true; }
        }
      }
      return e;
    }
    placeObjects(m) {
      const host = this.host; if (!host.placeCharts) return;
      host.placeCharts(m, (x, y) => ({ x: this.sx(m, x) , y: this.sy(m, y) }), HDR_W, HDR_H);
    }

    /* ---------- selection ---------- */
    get range() { return this.sel.ranges[this.sel.ranges.length - 1]; }
    select(r, c, extend = false, add = false) {
      r = Math.max(0, Math.min(MAXR - 1, r)); c = Math.max(0, Math.min(MAXC - 1, c));
      const s = this.sel;
      if (extend) {
        const a = s.anchor; s.ranges[s.ranges.length - 1] = this.expandMerges({ r1: Math.min(a.r, r), c1: Math.min(a.c, c), r2: Math.max(a.r, r), c2: Math.max(a.c, c) });
      } else {
        const mg = this.sheet.mergeAt(r, c);
        if (mg) { r = mg.r1; c = mg.c1; }
        const g = mg ? { r1: mg.r1, c1: mg.c1, r2: mg.r2, c2: mg.c2 } : { r1: r, c1: c, r2: r, c2: c };
        if (add) s.ranges.push(g); else s.ranges = [g];
        s.r = r; s.c = c; s.anchor = { r, c }; s.er = s.ec = undefined;
      }
      this.chartSel = null; this.host.selectChart && this.host.selectChart(null);
      this.afterSelect();
      return this;
    }
    selectRange(g, active) { this.sel = { r: active ? active.r : g.r1, c: active ? active.c : g.c1, ranges: [{ ...g }], anchor: { r: g.r1, c: g.c1 } }; this.afterSelect(); }
    afterSelect(scroll = true) { if (scroll) this.scrollIntoView(this.sel.extR ?? this.sel.r, this.sel.c); this.host.onSelect && this.host.onSelect(); this.render(); }
    scrollIntoView(r, c) {
      const m = this.metrics(), z = m.z, W = this.wrap.clientWidth, H = this.wrap.clientHeight;
      if (c >= m.fc) {
        const x1 = m.C.pos(c) - m.fx, x2 = x1 + m.C.size(c), view = (W - HDR_W - 16) / z - m.fx;
        if (x1 < m.sx) this.scroller.scrollLeft = x1 * z; else if (x2 > m.sx + view) this.scroller.scrollLeft = (x2 - view) * z;
      }
      if (r >= m.fr) {
        if (r > this.extR - 50) { this.extR = Math.min(MAXR, r + 500); this.render(); }
        const y1 = m.R.pos(r) - m.fy, y2 = y1 + m.R.size(r), view = (H - HDR_H - 16) / z - m.fy;
        const [R] = this.axes(); void R;
        if (y1 < m.sy) this.scroller.scrollTop = y1 * z; else if (y2 > m.sy + view) this.scroller.scrollTop = (y2 - view) * z;
      }
    }
    // move the active cell (keyboard)
    move(dr, dc, extend) {
      const s = this.sel;
      let r = extend ? (s.er ?? s.r) : s.r, c = extend ? (s.ec ?? s.c) : s.c;
      const mg = this.sheet.mergeAt(r, c);
      if (mg && !extend) { if (dr > 0) r = mg.r2; if (dc > 0) c = mg.c2; }
      r = this.nextVisible(r, dr, 'row'); c = this.nextVisible(c, dc, 'col');
      if (extend) { s.er = r; s.ec = c; this.select(r, c, true); this.scrollIntoView(r, c); }
      else { s.er = s.ec = undefined; this.select(r, c); }
    }
    nextVisible(i, d, axis) {
      if (!d) return i;
      const hidden = axis === 'row' ? (x => this.sheet.rowHidden(x)) : (x => this.sheet.hiddenCols.has(x));
      const max = axis === 'row' ? MAXR - 1 : MAXC - 1;
      let j = i + d, guard = 0; while (j >= 0 && j <= max && hidden(j) && guard++ < 2e6) j += Math.sign(d);
      return Math.max(0, Math.min(max, j));
    }
    jump(dr, dc, extend) {
      const sh = this.sheet, s = this.sel;
      let r = extend ? (s.er ?? s.r) : s.r, c = extend ? (s.ec ?? s.c) : s.c;
      const b = sh.bounds(), filled = (rr, cc) => sh.value(rr, cc) != null;
      const step = () => { r += dr; c += dc; };
      const inside = () => r >= 0 && c >= 0 && r < MAXR && c < MAXC;
      const limitR = dr > 0 ? Math.max(b.r, r) + 1 : -1, limitC = dc > 0 ? Math.max(b.c, c) + 1 : -1;
      if (filled(r, c) && inside() && filled(r + dr, c + dc)) { while (inside() && filled(r + dr, c + dc)) step(); }
      else { step(); while (inside() && !filled(r, c) && !(dr > 0 && r >= limitR) && !(dc > 0 && c >= limitC)) step(); if (!filled(r, c)) { if (dr > 0) r = Math.max(s.r, Math.min(MAXR - 1, b.r >= 0 ? Math.max(b.r, r - 1) : r)); if (dc > 0) c = Math.max(s.c, Math.min(MAXC - 1, Math.max(b.c, c - 1))); } }
      r = Math.max(0, Math.min(MAXR - 1, r)); c = Math.max(0, Math.min(MAXC - 1, c));
      if (extend) { s.er = r; s.ec = c; this.select(r, c, true); this.scrollIntoView(r, c); } else this.select(r, c);
    }

    /* ---------- editing ---------- */
    startEdit(text, mode = 'enter', caretEnd = true) {
      if (this.host.readOnly) return;
      const s = this.sel, sh = this.sheet;
      const orig = this.wb.editText(sh, s.r, s.c);
      this.edit = { r: s.r, c: s.c, sheet: sh, mode, orig, text: text != null ? text : orig, point: null, acIdx: 0 };
      const ed = this.editor; ed.value = this.edit.text; ed.hidden = false;
      const cell = sh.get(s.r, s.c), st = cell && cell.s;
      ed.style.font = P.fontOf(st, this.z); ed.style.color = st && st.color || '#000'; ed.style.background = st && st.fill || '#fff';
      ed.style.textAlign = st && st.ha === 'right' ? 'right' : st && st.ha === 'center' ? 'center' : 'left';
      this.placeEditor(); ed.focus();
      if (caretEnd) ed.setSelectionRange(ed.value.length, ed.value.length);
      this.fbar.value = this.edit.text;
      this.host.status && this.host.status();
      this.render();
    }
    placeEditor() {
      const e = this.edit; if (!e || e.sheet !== this.sheet) { this.editor.hidden = true; return; }
      this.editor.hidden = false;
      const rc = this.cellRect(e.r, e.c), ed = this.editor;
      ed.style.left = rc.x + 'px'; ed.style.top = rc.y + 'px'; ed.style.minWidth = Math.max(rc.w, 30) + 'px'; ed.style.minHeight = rc.h + 'px'; ed.style.height = rc.h + 'px';
      const lines = ed.value.split('\n').length; ed.style.height = Math.max(rc.h, lines * 18 * this.z + 4) + 'px';
      const ctx = this.ctx; const w = Math.max(...ed.value.split('\n').map(l => P.textW(ctx, ed.style.font, l))) + 14;
      ed.style.width = Math.min(Math.max(rc.w, w), this.wrap.clientWidth - rc.x - 4) + 'px';
    }
    syncFromEditor(src) {
      const e = this.edit; if (!e) return;
      e.text = src.value;
      if (src === this.editor) this.fbar.value = e.text; else this.editor.value = e.text;
      if (e.point && !e.pointing) e.point = null;
      this.placeEditor(); this.autocomplete(src); this.render(); this.host.status && this.host.status();
    }
    activeInput() { return document.activeElement === this.fbar ? this.fbar : this.editor; }
    commitEdit(dr = 0, dc = 0) {
      const e = this.edit; if (!e) return true;
      let text = e.text;
      if (text[0] === '=' && text.length > 1) {
        // auto-close parentheses like Excel
        let depth = 0, q = false; for (const ch of text) { if (ch === '"') q = !q; else if (!q && ch === '(') depth++; else if (!q && ch === ')') depth--; }
        if (depth > 0 && !q) text += ')'.repeat(depth);
        try { F.parse(text); } catch (err) { Aero.toast('There is a problem with this formula: ' + err.message); this.activeInput().focus(); return false; }
      }
      this.edit = null; this.editor.hidden = true; this.hideAC();
      if (text !== e.orig) {
        const label = 'Edit ' + F.addr(e.r, e.c);
        this.wb.transact(label, () => {
          // typing into a multi-cell selection with Ctrl+Enter fills all of it
          if (e.fillAll) { for (const g of this.sel.ranges) for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) this.wb.input(e.sheet, r, c, text[0] === '=' ? F.shiftFormula(text, r - e.r, c - e.c) : text); }
          else this.wb.input(e.sheet, e.r, e.c, text);
        });
      }
      this.kbd.focus();
      this.host.afterCommit && this.host.afterCommit(e);
      if (dr || dc) this.advance(dr, dc); else this.afterSelect(false);
      return true;
    }
    cancelEdit() { if (!this.edit) return; this.edit = null; this.editor.hidden = true; this.hideAC(); this.fbar.value = this.wb.editText(this.sheet, this.sel.r, this.sel.c); this.kbd.focus(); this.render(); this.host.status && this.host.status(); }
    // Enter/Tab movement inside a multi-cell selection
    advance(dr, dc) {
      const s = this.sel, g = s.ranges[s.ranges.length - 1];
      if (s.ranges.length === 1 && !(g.r1 === g.r2 && g.c1 === g.c2)) {
        let r = s.r, c = s.c;
        if (dr) { r += dr; if (r > g.r2) { r = g.r1; c = c + 1 > g.c2 ? g.c1 : c + 1; } if (r < g.r1) { r = g.r2; c = c - 1 < g.c1 ? g.c2 : c - 1; } }
        if (dc) { c += dc; if (c > g.c2) { c = g.c1; r = r + 1 > g.r2 ? g.r1 : r + 1; } if (c < g.c1) { c = g.c2; r = r - 1 < g.r1 ? g.r2 : r - 1; } }
        s.r = r; s.c = c; this.afterSelect(); return;
      }
      this.move(dr, dc, false);
    }
    // can a reference be inserted at the caret? (formula point mode)
    pointable() {
      const e = this.edit; if (!e || e.text[0] !== '=') return false;
      const inp = this.activeInput(), pos = inp.selectionStart;
      if (e.point && e.point.end === pos) return true;
      const before = e.text.slice(0, pos).replace(/\s+$/, '');
      let q = 0; for (const ch of before) if (ch === '"') q ^= 1; if (q) return false;
      return /[=(,+\-*/^&<>;:]$/.test(before);
    }
    insertRef(g, sheetPrefix) {
      const e = this.edit, inp = this.activeInput();
      let txt = F.rangeText(g, sheetPrefix);
      let start = inp.selectionStart, end = inp.selectionEnd;
      if (e.point && e.point.end === start) start = e.point.start;
      e.text = e.text.slice(0, start) + txt + e.text.slice(end);
      e.point = { start, end: start + txt.length, g };
      inp.value = e.text; inp.setSelectionRange(e.point.end, e.point.end);
      e.pointing = true; this.syncFromEditor(inp); e.pointing = false;
    }
    toggleAbs() {
      const e = this.edit; if (!e || e.text[0] !== '=') return;
      const inp = this.activeInput(), pos = inp.selectionStart;
      let toks; try { toks = F.tokenize(e.text.slice(1)); } catch (err) { return; }
      const t = toks.find(x => x.t === 'ref' && pos - 1 >= x.s && pos - 1 <= x.e); if (!t) return;
      const cyc = ([ar, ac]) => ar && ac ? [true, false] : ar && !ac ? [false, true] : !ar && ac ? [false, false] : [true, true];
      const [ar, ac] = cyc([t.ar1, t.ac1]);
      const y = { sheet: t.sheet, kind: t.kind, r1: t.r1, c1: t.c1, r2: t.r2, c2: t.c2, ar1: ar, ac1: ac, ar2: ar, ac2: ac };
      const txt = F.refTokText(y);
      e.text = '=' + e.text.slice(1, t.s + 1) + txt + e.text.slice(t.e + 1);
      inp.value = e.text; const np = t.s + 1 + txt.length; inp.setSelectionRange(np, np); this.syncFromEditor(inp);
    }
    /* ---------- function autocomplete & signature tip ---------- */
    autocomplete(inp) {
      const e = this.edit; if (!e || e.text[0] !== '=') { this.hideAC(); return; }
      const pos = inp.selectionStart, before = e.text.slice(0, pos);
      const m = /(^|[=(,+\-*/^&<>;:\s])([A-Za-z][A-Za-z0-9.]*)$/.exec(before);
      let q = 0; for (const ch of before) if (ch === '"') q ^= 1;
      const names = !q && m ? Object.keys(F.FN).filter(n => n.startsWith(m[2].toUpperCase())).sort((a, b) => (POP.indexOf(a) + 1 || 999) - (POP.indexOf(b) + 1 || 999) || (a < b ? -1 : 1)).slice(0, 9) : [];
      if (names.length && !(names.length === 1 && names[0] === m[2].toUpperCase() && /\($/.test(before))) {
        e.ac = { names, word: m[2], start: pos - m[2].length }; e.acIdx = Math.min(e.acIdx || 0, names.length - 1);
        this.ac.innerHTML = names.map((n, i) => `<div class="ac-item${i === e.acIdx ? ' sel' : ''}" data-n="${n}"><b>${n}</b><span>${Aero.esc(F.FN[n].cat || '')}</span></div>`).join('');
        const r = inp.getBoundingClientRect(), wr = this.wrap.getBoundingClientRect();
        const left = inp === this.fbar ? r.left - wr.left + 6 * Math.min(pos, 60) : parseFloat(this.editor.style.left);
        const top = inp === this.fbar ? 0 : parseFloat(this.editor.style.top) + this.editor.offsetHeight;
        this.ac.style.left = Math.max(0, Math.min(left, this.wrap.clientWidth - 230)) + 'px'; this.ac.style.top = top + 'px'; this.ac.hidden = false;
      } else this.hideAC(true);
      // signature of the enclosing function
      let depth = 0, fnName = null, argi = 0; q = 0;
      for (let i = before.length - 1; i >= 0; i--) {
        const ch = before[i];
        if (ch === '"') q ^= 1; if (q) continue;
        if (ch === ')') depth++;
        else if (ch === '(') { if (depth === 0) { const mm = /([A-Za-z][A-Za-z0-9.]*)$/.exec(before.slice(0, i)); fnName = mm && mm[1].toUpperCase(); break; } depth--; }
        else if (ch === ',' && depth === 0) argi++;
      }
      const f = fnName && F.FN[fnName];
      if (f && this.ac.hidden) {
        const args = (f.sig || '…').split(', ');
        this.tip.innerHTML = `<b>${fnName}</b>(` + args.map((a, i) => i === Math.min(argi, args.length - 1) ? `<u>${Aero.esc(a)}</u>` : Aero.esc(a)).join(', ') + ')';
        const top = inp === this.fbar ? 0 : parseFloat(this.editor.style.top) + this.editor.offsetHeight + 2;
        this.tip.style.left = (inp === this.fbar ? 60 : parseFloat(this.editor.style.left)) + 'px'; this.tip.style.top = top + 'px'; this.tip.hidden = false;
      } else this.tip.hidden = true;
    }
    hideAC(keepTip) { this.ac.hidden = true; if (this.edit) this.edit.ac = null; if (!keepTip) this.tip.hidden = true; }
    acceptAC(name) {
      const e = this.edit, inp = this.activeInput(); if (!e || !e.ac) return;
      name = name || e.ac.names[e.acIdx];
      const pos = inp.selectionStart, after = e.text.slice(pos);
      e.text = e.text.slice(0, e.ac.start) + name + '(' + after.replace(/^\(/, '');
      inp.value = e.text; const np = e.ac.start + name.length + 1; inp.setSelectionRange(np, np);
      this.hideAC(); this.syncFromEditor(inp); inp.focus();
    }

    /* ---------- events ---------- */
    bind() {
      const sc = this.scroller;
      sc.addEventListener('scroll', () => {
        const m = this.metrics();
        if (sc.scrollTop + sc.clientHeight > sc.scrollHeight - 400 && this.extR < MAXR) this.extR = Math.min(MAXR, this.extR + 2000);
        if (sc.scrollLeft + sc.clientWidth > sc.scrollWidth - 300 && this.extC < MAXC) this.extC = Math.min(MAXC, this.extC + 26);
        void m; this.render();
      });
      sc.addEventListener('wheel', e => {
        if (e.ctrlKey) { e.preventDefault(); this.host.zoom && this.host.zoom(e.deltaY < 0 ? 0.1 : -0.1); }
      }, { passive: false });
      sc.addEventListener('mousedown', e => this.onDown(e));
      sc.addEventListener('mousemove', e => this.onHover(e));
      sc.addEventListener('dblclick', e => this.onDbl(e));
      sc.addEventListener('contextmenu', e => {
        e.preventDefault(); const p = this.local(e), h = this.hit(p.x, p.y);
        const inSel = this.sel.ranges.some(g => h.r >= g.r1 && h.r <= g.r2 && h.c >= g.c1 && h.c <= g.c2);
        if (!inSel && !h.inColHdr && !h.inRowHdr) this.select(h.r, h.c);
        if (h.inColHdr && !this.sel.ranges.some(g => g.r1 === 0 && g.r2 === MAXR - 1 && h.c >= g.c1 && h.c <= g.c2)) { this.selectRange({ r1: 0, c1: h.c, r2: MAXR - 1, c2: h.c }, { r: this.firstVisibleRow(), c: h.c }); }
        if (h.inRowHdr && !this.sel.ranges.some(g => g.c1 === 0 && g.c2 === MAXC - 1 && h.r >= g.r1 && h.r <= g.r2)) { this.selectRange({ r1: h.r, c1: 0, r2: h.r, c2: MAXC - 1 }, { r: h.r, c: 0 }); }
        this.host.contextMenu && this.host.contextMenu(e.clientX, e.clientY, h.inColHdr ? 'col' : h.inRowHdr ? 'row' : 'cell');
      });
      window.addEventListener('mousemove', e => this.onMove(e));
      window.addEventListener('mouseup', e => this.onUp(e));
      // keyboard sink
      const kbd = this.kbd;
      kbd.addEventListener('keydown', e => this.onKey(e));
      kbd.addEventListener('focus', () => { kbd.value = ' '; kbd.select(); });
      kbd.addEventListener('copy', e => this.host.copy && this.host.copy(e, false));
      kbd.addEventListener('cut', e => this.host.copy && this.host.copy(e, true));
      kbd.addEventListener('paste', e => this.host.paste && this.host.paste(e));
      for (const inp of [this.editor, this.fbar]) {
        inp.addEventListener('input', () => { if (!this.edit && inp === this.fbar) this.startEditFromBar(); this.syncFromEditor(inp); });
        inp.addEventListener('keydown', e => this.onEditKey(e, inp));
        inp.addEventListener('click', () => { if (this.edit) { this.edit.point = null; this.autocomplete(inp); } });
      }
      this.fbar.addEventListener('focus', () => { if (!this.edit) this.startEditFromBar(); });
      this.ac.addEventListener('mousedown', e => { const it = e.target.closest('.ac-item'); if (it) { e.preventDefault(); this.acceptAC(it.dataset.n); } });
      this.nameBox.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); this.host.goto && this.host.goto(this.nameBox.value); this.kbd.focus(); } if (e.key === 'Escape') { this.host.onSelect(); this.kbd.focus(); } });
      this.nameBox.addEventListener('focus', () => this.nameBox.select());
      setInterval(() => { if (this.copyMark) { this.antPhase = ((this.antPhase || 0) + 1) % 8; this.render(); } }, 120);
    }
    startEditFromBar() {
      const caret = this.fbar.selectionStart;
      this.startEdit(this.fbar.value, 'edit', false); this.fbar.focus();
      try { this.fbar.setSelectionRange(caret, caret); } catch (e) { /* ignore */ }
    }
    firstVisibleRow() { const m = this.metrics(); return m.R.index(m.fy + m.sy); }
    local(e) { const r = this.wrap.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    edgeHit(p) {
      const m = this.metrics();
      if (p.y < HDR_H && p.x > HDR_W) { const cols = [...this.visible.colsF, ...this.visible.colsS]; for (const c of cols) if (Math.abs(p.x - (c.x + c.w)) <= 4) return { axis: 'col', i: c.i, start: c.x }; }
      if (p.x < HDR_W && p.y > HDR_H) { const rows = [...this.visible.rowsF, ...this.visible.rowsS]; for (const r of rows) if (Math.abs(p.y - (r.y + r.h)) <= 3) return { axis: 'row', i: r.i, start: r.y }; }
      void m; return null;
    }
    fillHandleHit(p) {
      if (this.edit) return false;
      const m = this.metrics(), rc = this.rangeRect(m, this.expandMerges(this.range));
      return Math.abs(p.x - (rc.x + rc.w)) <= 5 && Math.abs(p.y - (rc.y + rc.h)) <= 5;
    }
    filterBtnHit(p, h) {
      const f = this.sheet.filter; if (!f || h.r !== f.range.r1 || h.c < f.range.c1 || h.c > f.range.c2) return false;
      const rc = this.cellRect(h.r, h.c); const bs = Math.min(17, rc.h - 2);
      return p.x >= rc.x + rc.w - bs - 2 && p.y >= rc.y + rc.h - bs - 2;
    }
    onHover(e) {
      if (this.drag) return;
      const p = this.local(e), eh = this.edgeHit(p);
      this.scroller.style.cursor = eh ? (eh.axis === 'col' ? 'col-resize' : 'row-resize') : this.fillHandleHit(p) ? 'crosshair' : p.y < HDR_H || p.x < HDR_W ? 'default' : 'cell';
    }
    onDown(e) {
      if (e.button !== 0) return;
      const p = this.local(e);
      if (p.x > this.scroller.clientWidth || p.y > this.scroller.clientHeight) return; // native scrollbar
      const h = this.hit(p.x, p.y);
      // formula point mode: clicking a cell inserts a reference
      if (this.edit && !h.inColHdr && !h.inRowHdr && this.pointable()) {
        e.preventDefault();
        const pre = this.sheet !== this.edit.sheet ? this.sheet.name : null;
        this.insertRef({ r1: h.r, c1: h.c, r2: h.r, c2: h.c }, pre);
        this.drag = { kind: 'point', r: h.r, c: h.c, pre };
        return;
      }
      if (this.edit && !this.commitEdit()) { e.preventDefault(); return; }
      e.preventDefault(); this.kbd.focus();
      const eh = this.edgeHit(p);
      if (eh) { this.drag = { kind: 'resize', axis: eh.axis, i: eh.i, start: eh.start, x0: p.x, y0: p.y }; return; }
      if (p.x < HDR_W && p.y < HDR_H) { this.selectRange({ r1: 0, c1: 0, r2: MAXR - 1, c2: MAXC - 1 }, { r: this.sel.r, c: this.sel.c }); return; }
      if (h.inColHdr) {
        if (e.shiftKey) { const a = this.sel.anchor; this.sel.ranges[this.sel.ranges.length - 1] = { r1: 0, r2: MAXR - 1, c1: Math.min(a.c, h.c), c2: Math.max(a.c, h.c) }; this.afterSelect(false); }
        else { const g = { r1: 0, c1: h.c, r2: MAXR - 1, c2: h.c }; if (e.ctrlKey) this.sel.ranges.push(g); else this.sel.ranges = [g]; this.sel.r = this.firstVisibleRow(); this.sel.c = h.c; this.sel.anchor = { r: this.sel.r, c: h.c }; this.afterSelect(false); }
        this.drag = { kind: 'cols', c0: e.shiftKey ? this.sel.anchor.c : h.c }; return;
      }
      if (h.inRowHdr) {
        if (e.shiftKey) { const a = this.sel.anchor; this.sel.ranges[this.sel.ranges.length - 1] = { c1: 0, c2: MAXC - 1, r1: Math.min(a.r, h.r), r2: Math.max(a.r, h.r) }; this.afterSelect(false); }
        else { const g = { r1: h.r, c1: 0, r2: h.r, c2: MAXC - 1 }; if (e.ctrlKey) this.sel.ranges.push(g); else this.sel.ranges = [g]; this.sel.r = h.r; this.sel.c = 0; this.sel.anchor = { r: h.r, c: 0 }; this.afterSelect(false); }
        this.drag = { kind: 'rows', r0: e.shiftKey ? this.sel.anchor.r : h.r }; return;
      }
      if (this.filterBtnHit(p, h)) { const rc = this.cellRect(h.r, h.c), wr = this.wrap.getBoundingClientRect(); this.host.openFilter && this.host.openFilter(h.c, wr.left + rc.x, wr.top + rc.y + rc.h); return; }
      if (this.fillHandleHit(p)) { this.drag = { kind: 'fill', src: this.expandMerges(this.range), target: null }; return; }
      if (e.shiftKey) this.select(h.r, h.c, true);
      else this.select(h.r, h.c, false, e.ctrlKey);
      this.drag = { kind: 'sel' };
    }
    onMove(e) {
      const d = this.drag; if (!d) return;
      const p = this.local(e), h = this.hit(Math.max(HDR_W + 1, p.x), Math.max(HDR_H + 1, p.y));
      // auto-scroll while dragging past the edges
      const W = this.scroller.clientWidth, H = this.scroller.clientHeight;
      if (d.kind !== 'resize') { if (p.y > H - 4) this.scroller.scrollTop += 20; if (p.y < HDR_H && d.kind !== 'cols') this.scroller.scrollTop -= 20; if (p.x > W - 4) this.scroller.scrollLeft += 20; if (p.x < HDR_W && d.kind !== 'rows') this.scroller.scrollLeft -= 20; }
      if (d.kind === 'sel') { this.select(h.r, h.c, true); }
      else if (d.kind === 'cols') { const g = this.sel.ranges[this.sel.ranges.length - 1]; g.c1 = Math.min(d.c0, h.c); g.c2 = Math.max(d.c0, h.c); this.afterSelect(false); }
      else if (d.kind === 'rows') { const g = this.sel.ranges[this.sel.ranges.length - 1]; g.r1 = Math.min(d.r0, h.r); g.r2 = Math.max(d.r0, h.r); this.afterSelect(false); }
      else if (d.kind === 'point') { const g = { r1: Math.min(d.r, h.r), c1: Math.min(d.c, h.c), r2: Math.max(d.r, h.r), c2: Math.max(d.c, h.c) }; this.insertRef(g, d.pre); }
      else if (d.kind === 'resize') {
        const z = this.z;
        if (d.axis === 'col') { d.size = Math.max(0, Math.round((p.x - d.start) / z)); this.tipAt(e, `Width: ${d.size} px`); }
        else { d.size = Math.max(0, Math.round((p.y - d.start) / z)); this.tipAt(e, `Height: ${d.size} px`); }
        this.liveResize(d);
      } else if (d.kind === 'fill') {
        const s = d.src; let t;
        const below = h.r - s.r2, above = s.r1 - h.r, right = h.c - s.c2, left = s.c1 - h.c;
        const best = Math.max(below, above, right, left);
        if (best <= 0) t = null;
        else if (best === below) t = { ...s, r2: h.r, dir: 'down' }; else if (best === above) t = { ...s, r1: h.r, dir: 'up' };
        else if (best === right) t = { ...s, c2: h.c, dir: 'right' }; else t = { ...s, c1: h.c, dir: 'left' };
        d.target = t; this.render();
      }
    }
    liveResize(d) {
      const sh = this.sheet, map = d.axis === 'col' ? sh.colW : sh.rowH;
      if (d.orig === undefined) d.orig = map.has(d.i) ? map.get(d.i) : undefined;
      map.set(d.i, d.size); this.invalidate(); this.render();
    }
    onUp() {
      const d = this.drag; this.drag = null; if (!d) return;
      this.hideTip();
      if (d.kind === 'resize' && d.size != null) {
        const sh = this.sheet, prop = d.axis === 'col' ? 'colW' : 'rowH', map = sh[prop];
        // put the original back, then apply through a transaction (undoable; applies to every selected column/row)
        if (d.orig === undefined) map.delete(d.i); else map.set(d.i, d.orig);
        const nm = new Map(map);
        const g = this.sel.ranges[this.sel.ranges.length - 1];
        const whole = d.axis === 'col' ? (g.r1 === 0 && g.r2 === MAXR - 1 && d.i >= g.c1 && d.i <= g.c2) : (g.c1 === 0 && g.c2 === MAXC - 1 && d.i >= g.r1 && d.i <= g.r2);
        const lo = whole ? (d.axis === 'col' ? g.c1 : g.r1) : d.i, hi = whole ? (d.axis === 'col' ? g.c2 : g.r2) : d.i;
        for (let i = lo; i <= hi; i++) nm.set(i, d.size);
        this.wb.transact(d.axis === 'col' ? 'Column width' : 'Row height', () => this.wb.setMeta(sh, prop, nm));
        this.invalidate(); this.render();
      }
      if (d.kind === 'fill' && d.target) {
        const t = d.target; this.wb.fill(this.sheet, d.src, t, t.dir);
        this.selectRange({ r1: t.r1, c1: t.c1, r2: t.r2, c2: t.c2 }, { r: this.sel.r, c: this.sel.c });
      }
      if (d.kind === 'point') this.activeInput().focus();
      this.render();
    }
    onDbl(e) {
      const p = this.local(e), eh = this.edgeHit(p);
      if (eh) { this.host.autofit && this.host.autofit(eh.axis, eh.i); return; }
      if (p.x < HDR_W || p.y < HDR_H) return;
      if (this.fillHandleHit(p)) { this.host.fillDownToData && this.host.fillDownToData(); return; }
      const h = this.hit(p.x, p.y);
      if (this.filterBtnHit(p, h)) return;
      this.select(h.r, h.c); this.startEdit(null, 'edit');
    }
    tipAt(e, text) { const t = document.getElementById('dragTip'); t.textContent = text; t.style.left = (e.clientX + 12) + 'px'; t.style.top = (e.clientY - 26) + 'px'; t.hidden = false; }
    hideTip() { document.getElementById('dragTip').hidden = true; }

    onKey(e) {
      if (this.edit) return;
      const k = e.key, ctrl = e.ctrlKey || e.metaKey, sh = e.shiftKey;
      const done = () => { e.preventDefault(); e.stopPropagation(); };
      if (this.chartSel && (k === 'Delete' || k === 'Backspace')) { done(); this.host.deleteChart && this.host.deleteChart(); return; }
      switch (k) {
        case 'ArrowDown': done(); return ctrl ? this.jump(1, 0, sh) : this.move(1, 0, sh);
        case 'ArrowUp': done(); return ctrl ? this.jump(-1, 0, sh) : this.move(-1, 0, sh);
        case 'ArrowRight': done(); return ctrl ? this.jump(0, 1, sh) : this.move(0, 1, sh);
        case 'ArrowLeft': done(); return ctrl ? this.jump(0, -1, sh) : this.move(0, -1, sh);
        case 'Enter': done(); if (e.altKey) return; return this.advance(sh ? -1 : 1, 0);
        case 'Tab': done(); return this.advance(0, sh ? -1 : 1);
        case 'PageDown': case 'PageUp': {
          done(); if (ctrl) { this.host.cycleSheet && this.host.cycleSheet(k === 'PageDown' ? 1 : -1); return; }
          const rows = Math.max(1, Math.floor((this.wrap.clientHeight - HDR_H) / (DEF_H * this.z)) - 1);
          return this.move(k === 'PageDown' ? rows : -rows, 0, sh);
        }
        case 'Home': done(); if (ctrl) return sh ? this.select(0, 0, true) : this.select(0, 0); return sh ? this.select(this.sel.r, 0, true) : this.select(this.sel.r, 0);
        case 'End': if (ctrl) { done(); const b = this.sheet.bounds(); return this.select(Math.max(0, b.r), Math.max(0, b.c), sh); } return;
        case 'F2': done(); return this.startEdit(null, 'edit');
        case 'Delete': case 'Backspace': done(); if (k === 'Backspace') return this.startEdit(''); return this.host.clear && this.host.clear('contents');
        case 'Escape': if (this.copyMark) { this.copyMark = null; this.render(); } return;
      }
      if (ctrl && !e.altKey) {
        const lk = k.toLowerCase();
        if (lk === 'z' && !sh) { done(); return this.host.undo(); }
        if (lk === 'y' || (lk === 'z' && sh)) { done(); return this.host.redo(); }
        if (lk === 'a') { done(); const g = this.wb.region(this.sheet, this.sel.r, this.sel.c); const all = this.sel.ranges.length === 1 && JSON.stringify(this.range) === JSON.stringify(g); return all || (g.r1 === g.r2 && g.c1 === g.c2) ? this.selectRange({ r1: 0, c1: 0, r2: MAXR - 1, c2: MAXC - 1 }, this.sel) : this.selectRange(g, { r: this.sel.r, c: this.sel.c }); }
        if (k === ' ') { done(); return this.selectRange({ r1: 0, c1: this.range.c1, r2: MAXR - 1, c2: this.range.c2 }, this.sel); }
        if (k === ';' || k === ':') { done(); const d = new Date(); const t = k === ':' ? `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}` : `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`; return this.startEdit(t); }
        if (k === 'Enter') { done(); return; }
        return; // let the menus handle other Ctrl shortcuts
      }
      if (sh && k === ' ') { done(); return this.selectRange({ r1: this.range.r1, c1: 0, r2: this.range.r2, c2: MAXC - 1 }, this.sel); }
      if (e.altKey && (k === '=' )) { done(); return this.host.autoSum && this.host.autoSum(); }
      if (k.length === 1 && !e.altKey) { done(); this.startEdit(k === '+' && false ? '=' : k); }
    }
    onEditKey(e, inp) {
      const ed = this.edit; if (!ed) return;
      const k = e.key;
      const done = () => { e.preventDefault(); e.stopPropagation(); };
      if (ed.ac && !this.ac.hidden) {
        if (k === 'ArrowDown') { done(); ed.acIdx = (ed.acIdx + 1) % ed.ac.names.length; this.autocomplete(inp); return; }
        if (k === 'ArrowUp') { done(); ed.acIdx = (ed.acIdx - 1 + ed.ac.names.length) % ed.ac.names.length; this.autocomplete(inp); return; }
        if (k === 'Tab' || (k === 'Enter' && !e.ctrlKey)) { done(); this.acceptAC(); return; }
        if (k === 'Escape') { done(); this.hideAC(); return; }
      }
      if (k === 'Enter' && e.altKey) { done(); const p = inp.selectionStart; ed.text = ed.text.slice(0, p) + '\n' + ed.text.slice(inp.selectionEnd); inp.value = ed.text; inp.setSelectionRange(p + 1, p + 1); this.syncFromEditor(inp); return; }
      if (k === 'Enter') { done(); if (e.ctrlKey) ed.fillAll = true; this.commitEdit(e.ctrlKey ? 0 : e.shiftKey ? -1 : 1, 0); return; }
      if (k === 'Tab') { done(); this.commitEdit(0, e.shiftKey ? -1 : 1); return; }
      if (k === 'Escape') { done(); this.cancelEdit(); return; }
      if (k === 'F4') { done(); this.toggleAbs(); return; }
      if (k === 'F2') { done(); ed.mode = ed.mode === 'enter' ? 'edit' : 'enter'; this.host.status && this.host.status(); return; }
      if (k.startsWith('Arrow') && ed.mode === 'enter' && inp === this.editor) {
        if (this.pointable()) { // point mode: arrows pick a reference
          done();
          const base = ed.point ? { r: ed.point.cr ?? ed.point.g.r1, c: ed.point.cc ?? ed.point.g.c1 } : { r: ed.r, c: ed.c };
          const dr = k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : 0, dc = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0;
          const r = Math.max(0, base.r + dr), c = Math.max(0, base.c + dc);
          this.insertRef({ r1: r, c1: c, r2: r, c2: c }); ed.point.cr = r; ed.point.cc = c;
          return;
        }
        done(); const dr = k === 'ArrowDown' ? 1 : k === 'ArrowUp' ? -1 : 0, dc = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : 0;
        this.commitEdit(dr, dc); return;
      }
      if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(k) && ed.text === ed.orig) { done(); this.cancelEdit(); k.toLowerCase() === 'z' ? this.host.undo() : this.host.redo(); }
    }
  }

  root.GridView = GridView; root.GridConst = { DEF_W, DEF_H, HDR_W, HDR_H };
})(typeof self !== 'undefined' ? self : this);
