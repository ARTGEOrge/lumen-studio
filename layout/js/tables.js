'use strict';
/* Lumen Layout — table model shared by standalone table frames and inline tables that live in a story
   (story.objs[id] = {kind:'table', …}). Cells may span rows/columns: an owner cell carries cs/rs and the
   cells it covers are marked {m:1}. Provides span-aware row/column insert/delete, merge, unmerge and
   split, auto-growing row heights for inline tables, and a renderer-independent display list
   (fills, text, borders) used by both the canvas renderer and the PDF writer. */
(function () {
  const cellAt = (t, r, c) => (t.cells[r] && t.cells[r][c]) || { t: '' };
  // owner grid: own[r][c] = [r0, c0] of the cell that paints (r, c)
  function owners(t) {
    const nr = t.rowH.length, nc = t.colW.length, own = Array.from({ length: nr }, () => new Array(nc).fill(null));
    for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
      if (own[r][c]) continue;
      const cell = cellAt(t, r, c);
      const rs = Math.max(1, Math.min(nr - r, cell.rs | 0 || 1)), cs = Math.max(1, Math.min(nc - c, cell.cs | 0 || 1));
      for (let y = r; y < r + rs; y++) for (let x = c; x < c + cs; x++) if (!own[y][x]) own[y][x] = [r, c];
    }
    return own;
  }
  // make cells consistent with spans (after edits or when loading a file)
  function normalize(t) {
    const nr = t.rowH.length, nc = t.colW.length;
    t.cells = Array.from({ length: nr }, (_, r) => Array.from({ length: nc }, (_, c) => { const x = t.cells?.[r]?.[c]; return x && typeof x === 'object' ? x : { t: '' }; }));
    for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) delete t.cells[r][c].m;
    const own = owners(t);
    for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
      const [r0, c0] = own[r][c], cell = t.cells[r][c];
      if (r0 !== r || c0 !== c) { t.cells[r][c] = { t: '', m: 1 }; continue; }
      let rs = 1, cs = 1; while (r + rs < nr && own[r + rs][c] && own[r + rs][c][0] === r && own[r + rs][c][1] === c) rs++; while (c + cs < nc && own[r][c + cs] && own[r][c + cs][0] === r && own[r][c + cs][1] === c) cs++;
      if (rs > 1) cell.rs = rs; else delete cell.rs; if (cs > 1) cell.cs = cs; else delete cell.cs;
    }
    t.w = t.colW.reduce((a, b) => a + b, 0);
    if (t.type === 'table') t.h = t.rowH.reduce((a, b) => a + b, 0);
    return t;
  }
  const span = (t, r, c) => { const cell = cellAt(t, r, c); return { rs: Math.max(1, cell.rs | 0 || 1), cs: Math.max(1, cell.cs | 0 || 1) }; };
  // the owner of the cell under (r, c)
  function ownerOf(t, r, c) { const o = owners(t)[r]?.[c]; return o || [r, c]; }
  // rectangle covering a selection, grown so it never cuts through a merged cell
  function expand(t, r0, c0, r1, c1) {
    [r0, r1] = [Math.min(r0, r1), Math.max(r0, r1)]; [c0, c1] = [Math.min(c0, c1), Math.max(c0, c1)];
    const own = owners(t);
    for (let changed = true; changed;) {
      changed = false;
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
        const [or, oc] = own[r][c], s = span(t, or, oc);
        if (or < r0) { r0 = or; changed = true; } if (oc < c0) { c0 = oc; changed = true; }
        if (or + s.rs - 1 > r1) { r1 = or + s.rs - 1; changed = true; } if (oc + s.cs - 1 > c1) { c1 = oc + s.cs - 1; changed = true; }
      }
    }
    return [r0, c0, r1, c1];
  }

  /* ---------- operations (return true when the table changed) ---------- */
  function merge(t, r0, c0, r1, c1) {
    [r0, c0, r1, c1] = expand(t, r0, c0, r1, c1);
    if (r0 === r1 && c0 === c1) return false;
    const texts = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const x = cellAt(t, r, c); if (!x.m && x.t && x.t.trim()) texts.push(x.t); }
    const o = { ...cellAt(t, r0, c0), t: texts.join('\n') }; delete o.m;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) t.cells[r][c] = { t: '', m: 1 };
    o.rs = r1 - r0 + 1; o.cs = c1 - c0 + 1; t.cells[r0][c0] = o;
    normalize(t); return true;
  }
  function unmerge(t, r, c) {
    const [r0, c0] = ownerOf(t, r, c), s = span(t, r0, c0); if (s.rs === 1 && s.cs === 1) return false;
    for (let y = r0; y < r0 + s.rs; y++) for (let x = c0; x < c0 + s.cs; x++) if (y !== r0 || x !== c0) t.cells[y][x] = { t: '' };
    delete t.cells[r0][c0].rs; delete t.cells[r0][c0].cs;
    normalize(t); return true;
  }
  function insertRow(t, at, tpl) {
    const nc = t.colW.length, own = owners(t), row = [], grown = new Set();
    for (let c = 0; c < nc; c++) {
      const above = at > 0 ? own[at - 1][c] : null, below = at < t.rowH.length ? own[at][c] : null;
      if (above && below && above[0] === below[0] && above[1] === below[1]) { const k = above.join(','); if (!grown.has(k)) { grown.add(k); const o = t.cells[above[0]][above[1]]; o.rs = (o.rs || 1) + 1; } row.push({ t: '', m: 1 }); }
      else row.push({ t: '' });
    }
    t.rowH.splice(at, 0, t.rowH[Math.min(t.rowH.length - 1, Math.max(0, tpl ?? at - 1))] || 20);
    t.cells.splice(at, 0, row);
    normalize(t); return true;
  }
  function insertCol(t, at, from) {
    const nr = t.rowH.length, own = owners(t), grown = new Set();
    const w = t.colW[from] / 2; t.colW[from] = w; t.colW.splice(at, 0, w);
    for (let r = 0; r < nr; r++) {
      const left = at > 0 ? own[r][at - 1] : null, right = at < own[r].length ? own[r][at] : null;
      if (left && right && left[0] === right[0] && left[1] === right[1]) { const k = left.join(','); if (!grown.has(k)) { grown.add(k); const o = t.cells[left[0]][left[1]]; o.cs = (o.cs || 1) + 1; } t.cells[r].splice(at, 0, { t: '', m: 1 }); }
      else t.cells[r].splice(at, 0, { t: '' });
    }
    normalize(t); return true;
  }
  function deleteRow(t, r) {
    if (t.rowH.length < 2) return false;
    const nc = t.colW.length, own = owners(t), done = new Set();
    for (let c = 0; c < nc; c++) {
      const [or, oc] = own[r][c], k = or + ',' + oc; if (done.has(k)) continue; done.add(k);
      const o = t.cells[or][oc], s = span(t, or, oc); if (s.rs < 2) continue;
      if (or === r) { const moved = { ...o, rs: s.rs - 1 }; t.cells[r + 1][oc] = moved; }
      else o.rs = s.rs - 1;
    }
    t.rowH.splice(r, 1); t.cells.splice(r, 1);
    if ((t.header || 0) > r) t.header--;
    if (t.header > t.rowH.length) t.header = t.rowH.length;
    normalize(t); return true;
  }
  function deleteCol(t, c) {
    if (t.colW.length < 2) return false;
    const nr = t.rowH.length, own = owners(t), done = new Set();
    for (let r = 0; r < nr; r++) {
      const [or, oc] = own[r][c], k = or + ',' + oc; if (done.has(k)) continue; done.add(k);
      const o = t.cells[or][oc], s = span(t, or, oc); if (s.cs < 2) continue;
      if (oc === c) t.cells[or][c + 1] = { ...o, cs: s.cs - 1 }; else o.cs = s.cs - 1;
    }
    const w = t.colW[c]; t.colW.splice(c, 1); t.colW[Math.max(0, c - 1)] += w;
    t.cells.forEach(row => row.splice(c, 1));
    normalize(t); return true;
  }
  // split the cell under (r, c) into two side-by-side cells (vertical split) or stacked cells (horizontal)
  function splitCell(t, r, c, vertical) {
    const [r0, c0] = ownerOf(t, r, c), s = span(t, r0, c0), o = t.cells[r0][c0];
    if (vertical) {
      if (s.cs > 1) { const a = Math.ceil(s.cs / 2); o.cs = a; t.cells[r0][c0 + a] = { t: '', ...(s.rs > 1 ? { rs: s.rs } : {}), cs: s.cs - a }; for (let y = r0; y < r0 + s.rs; y++) for (let x = c0 + a; x < c0 + s.cs; x++) if (y !== r0 || x !== c0 + a) t.cells[y][x] = { t: '', m: 1 }; normalize(t); return true; }
      const own = owners(t), grown = new Set();
      const w = t.colW[c0] / 2; t.colW[c0] = w; t.colW.splice(c0 + 1, 0, w);
      for (let y = 0; y < t.rowH.length; y++) {
        if (y >= r0 && y < r0 + s.rs) { t.cells[y].splice(c0 + 1, 0, y === r0 ? { t: '', ...(s.rs > 1 ? { rs: s.rs } : {}) } : { t: '', m: 1 }); continue; }
        const [or, oc] = own[y][c0], k = or + ',' + oc;
        if (!grown.has(k)) { grown.add(k); const ow = t.cells[or][oc]; ow.cs = (ow.cs || 1) + 1; }
        t.cells[y].splice(c0 + 1, 0, { t: '', m: 1 });
      }
      normalize(t); return true;
    }
    if (s.rs > 1) { const a = Math.ceil(s.rs / 2); o.rs = a; t.cells[r0 + a][c0] = { t: '', rs: s.rs - a, ...(s.cs > 1 ? { cs: s.cs } : {}) }; for (let y = r0 + a; y < r0 + s.rs; y++) for (let x = c0; x < c0 + s.cs; x++) if (y !== r0 + a || x !== c0) t.cells[y][x] = { t: '', m: 1 }; normalize(t); return true; }
    const own = owners(t), grown = new Set();
    const h = t.rowH[r0] / 2; t.rowH[r0] = h; t.rowH.splice(r0 + 1, 0, h);
    const row = [];
    for (let x = 0; x < t.colW.length; x++) {
      if (x >= c0 && x < c0 + s.cs) { row.push(x === c0 ? { t: '', ...(s.cs > 1 ? { cs: s.cs } : {}) } : { t: '', m: 1 }); continue; }
      const [or, oc] = own[r0][x], k = or + ',' + oc;
      if (!grown.has(k)) { grown.add(k); const ow = t.cells[or][oc]; ow.rs = (ow.rs || 1) + 1; }
      row.push({ t: '', m: 1 });
    }
    t.cells.splice(r0 + 1, 0, row);
    if ((t.header || 0) > r0) t.header++;
    normalize(t); return true;
  }

  /* ---------- geometry ---------- */
  function cellFont(t, r, cell) { return Fonts.resolve(t.tfont, r < (t.header || 0) || cell.bold ? 700 : 400, false); }
  function cellText(t, r, c, w, h) {
    const cell = cellAt(t, r, c), head = r < (t.header || 0);
    const fk = cellFont(t, r, cell), pad = t.pad ?? 4;
    const ls = Layout.simpleLines(cell.t || '', fk, t.tsize, w - pad * 2);
    const lh = t.tsize * 1.25, m = Fonts.metrics(fk);
    const y0 = (h - ls.length * lh) / 2 + lh / 2 + m.cap * t.tsize / 2;
    const align = cell.align || (c === 0 ? 'left' : t.calign?.[c] || 'left');
    return ls.map((l, k) => ({ text: l.text, fk, x: align === 'right' ? w - pad - l.w : align === 'center' ? (w - l.w) / 2 : pad, y: y0 + k * lh }));
  }
  // row heights: standalone tables have fixed rows; inline tables grow to fit their text
  function rowHeights(t) {
    if (t.kind !== 'table') return t.rowH.slice();
    const own = owners(t), pad = t.pad ?? 4, lh = t.tsize * 1.25;
    return t.rowH.map((h0, r) => {
      let h = h0;
      for (let c = 0; c < t.colW.length; c++) {
        const [or, oc] = own[r][c]; if (or !== r || oc !== c) continue;
        const s = span(t, r, c); if (s.rs > 1) continue;
        let w = 0; for (let x = c; x < c + s.cs; x++) w += t.colW[x];
        const cell = cellAt(t, r, c);
        const n = cell.t ? Layout.simpleLines(cell.t, cellFont(t, r, cell), t.tsize, w - pad * 2).length : 1;
        h = Math.max(h, n * lh + pad * 2);
      }
      return h;
    });
  }
  // rows that must stay together because of row spans: gEnd[r] = last row of the group starting at r
  function rowGroupEnds(t) {
    const nr = t.rowH.length, out = new Array(nr);
    for (let r = 0; r < nr; r++) {
      let e = r;
      for (let k = r; k <= e; k++) for (let c = 0; c < t.colW.length; c++) { const cell = cellAt(t, k, c); if (!cell.m && (cell.rs | 0) > 1) e = Math.max(e, k + cell.rs - 1); }
      out[r] = Math.min(nr - 1, e);
    }
    return out;
  }
  /* display list for a set of rows (all rows for a standalone table, or the rows of one inline piece):
     {fills:[{x,y,w,h,color}], texts:[{x,y,text,fk,size,color}], borders:[[x0,y0,x1,y1]], cells:[{r,c,x,y,w,h}] } */
  function display(t, rows, rhs) {
    const own = owners(t), nc = t.colW.length, out = { fills: [], texts: [], borders: [], cells: [] };
    const ry = new Map(); let y = 0; rows.forEach((r, k) => { ry.set(r, { y, h: rhs[k] }); y += rhs[k]; });
    const cx = [0]; for (let c = 0; c < nc; c++) cx.push(cx[c] + t.colW[c]);
    const segs = new Set();
    const seg = (x0, y0, x1, y1) => { const k = [x0, y0, x1, y1].map(v => v.toFixed(2)).join(','); if (!segs.has(k)) { segs.add(k); out.borders.push([x0, y0, x1, y1]); } };
    for (const r of rows) {
      for (let c = 0; c < nc; c++) {
        const [or, oc] = own[r][c];
        // a cell is drawn at its owner row, or at the first row of this piece it covers
        const first = or === r || (!ry.has(or) && rows.find(x => own[x][c][0] === or && own[x][c][1] === oc) === r);
        if (oc !== c || !first) continue;
        const cell = cellAt(t, or, oc), s = span(t, or, oc), head = or < (t.header || 0);
        let h = 0; for (let k = r; k < or + s.rs; k++) if (ry.has(k)) h += ry.get(k).h;
        const x = cx[oc], w = cx[Math.min(nc, oc + s.cs)] - x, yy = ry.get(r).y;
        const fill = cell.fill || (head ? t.hfill : (t.zebra && (or - (t.header || 0)) % 2 === 1 ? t.zebra : null));
        if (fill) out.fills.push({ x, y: yy, w, h, color: fill });
        for (const l of cellText(t, or, oc, w, h)) out.texts.push({ x: x + l.x, y: yy + l.y, text: l.text, fk: l.fk, size: t.tsize, color: cell.color || (head ? t.hcolor : t.tcolor) });
        out.cells.push({ r: or, c: oc, x, y: yy, w, h });
        if (t.bw > 0) { seg(x, yy, x + w, yy); seg(x, yy + h, x + w, yy + h); seg(x, yy, x, yy + h); seg(x + w, yy, x + w, yy + h); }
      }
    }
    return out;
  }
  // which cell (owner) is at local point (lx, ly) within a piece
  function hit(t, rows, rhs, lx, ly) {
    let y = 0, r = -1; for (let k = 0; k < rows.length; k++) { if (ly >= y && ly < y + rhs[k]) { r = rows[k]; break; } y += rhs[k]; }
    let x = 0, c = -1; for (let k = 0; k < t.colW.length; k++) { if (lx >= x && lx < x + t.colW[k]) { c = k; break; } x += t.colW[k]; }
    if (r < 0 || c < 0) return null;
    return ownerOf(t, r, c);
  }
  // rect of an owner cell within a piece (local coords) or null when not in the piece
  function cellRect(t, rows, rhs, r, c) {
    const d = display(t, rows, rhs);
    return d.cells.find(x => x.r === r && x.c === c) || null;
  }
  function newInline(cols, rows, w, header = 1) {
    const cw = w / cols, cells = [];
    for (let r = 0; r < rows; r++) { const row = []; for (let c = 0; c < cols; c++) row.push({ t: r < header ? 'Heading ' + (c + 1) : '' }); cells.push(row); }
    return { kind: 'table', colW: new Array(cols).fill(cw), rowH: new Array(rows).fill(18), cells, header,
      tfont: 'Montserrat', tsize: 8, tcolor: '#1a1a1a', hfill: '#1f3b57', hcolor: '#ffffff', bcolor: '#9fb0c2', bw: 0.5, zebra: '#eef3f8', pad: 4 };
  }

  window.Tables = { owners, normalize, ownerOf, expand, span, merge, unmerge, insertRow, insertCol, deleteRow, deleteCol, splitCell, cellText, rowHeights, rowGroupEnds, display, hit, cellRect, newInline, cellAt };
})();
