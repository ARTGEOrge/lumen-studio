// Lumen Stats — virtual data grid (Data View). Renders only the visible cells; sticky headers and case numbers.
// host: { doc, labels, mask, commitCells(list), pasteBlock(r,c,rows), onSelect(sel), onHeaderDbl(c), onContext(e,r,c), clearRange(sel) }
(function (root) {
  'use strict';
  const D = root.LData, esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const RH = 22, HH = 26, GHOST_C = 8, GHOST_R = 40, GW = 72;
  const TY = { numeric: '#', string: 'A', date: 'D', categorical: 'C' };

  class DataGrid {
    constructor(el, host) {
      this.el = el; this.h = host; this.sel = { r: 0, c: 0, r2: 0, c2: 0 }; this.editor = null;
      el.innerHTML = '<div class="dg-space"><div class="dg-hrow"></div><div class="dg-rcol"></div><div class="dg-cells"></div></div>';
      this.space = el.firstChild; [this.hrow, this.rcol, this.cells] = this.space.children;
      Object.assign(this.hrow.style, { position: 'sticky', top: '0', height: HH + 'px', zIndex: 3 });
      Object.assign(this.rcol.style, { position: 'sticky', left: '0', width: this.rw + 'px', zIndex: 2 });
      Object.assign(this.cells.style, { position: 'absolute', left: '0', top: '0' });
      el.addEventListener('scroll', () => this.render());
      el.addEventListener('mousedown', e => this.mouseDown(e));
      el.addEventListener('dblclick', e => this.dblClick(e));
      el.addEventListener('contextmenu', e => this.context(e));
      el.addEventListener('keydown', e => this.key(e));
      el.addEventListener('copy', e => this.copy(e, false));
      el.addEventListener('cut', e => this.copy(e, true));
      el.addEventListener('paste', e => this.paste(e));
      new ResizeObserver(() => this.render()).observe(el);
    }
    get doc() { return this.h.doc; }
    get rw() { return Math.max(48, 14 + 7.2 * String(this.doc ? this.doc.n + GHOST_R : 100).length); }
    layout() {
      const key = (this.doc.version ?? 0) + ':' + this.doc.vars.length + ':' + this.doc.n;
      if (this._lkey === key && this._ldoc === this.doc) return;
      this._lkey = key; this._ldoc = this.doc;
      const vars = this.doc.vars, X = [0];
      vars.forEach(v => X.push(X[X.length - 1] + Math.max(40, v.width || 84)));
      for (let k = 0; k < GHOST_C; k++) X.push(X[X.length - 1] + GW);
      this.X = X; this.nc = vars.length; this.ncAll = vars.length + GHOST_C; this.nrAll = this.doc.n + GHOST_R;
      const rw = this.rw; this._rw = rw;
      this.space.style.width = rw + X[X.length - 1] + 'px';
      this.hrow.style.width = rw + X[X.length - 1] + 'px';
      this.rcol.style.width = rw + 'px'; this.rcol.style.height = this.nrAll * RH + 'px';
    }
    colAt(x) { const X = this.X; let lo = 0, hi = X.length - 2; if (x < 0) return 0; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (X[m] <= x) lo = m; else hi = m - 1; } return lo; }
    render() {
      if (!this.doc) return;
      this.layout();
      const el = this.el, st = el.scrollTop, sl = el.scrollLeft, W = el.clientWidth, Hh = el.clientHeight, rw = this._rw;
      const r0 = Math.max(0, Math.floor(st / RH) - 2), r1 = Math.min(this.nrAll - 1, Math.ceil((st + Hh) / RH) + 2);
      const c0 = this.colAt(sl - 2), c1 = Math.min(this.ncAll - 1, this.colAt(sl + W - rw) + 1);
      const { vars, cols, n } = this.doc, labels = this.h.labels, mask = this.h.mask, s = this.norm();
      // headers
      let hh = `<div class="corner" style="position:sticky;left:0;width:${rw}px;display:block"></div>`;
      for (let c = c0; c <= c1; c++) {
        const v = vars[c], on = c >= s.c0 && c <= s.c1;
        hh += v ? `<div class="h${on ? ' on' : ''}" data-c="${c}" style="left:${rw + this.X[c]}px;width:${this.X[c + 1] - this.X[c]}px" title="${esc(v.label ? v.name + ' — ' + v.label : v.name)}"><span class="ty ${v.type}">${TY[v.type]}</span>${esc(v.name)}</div>`
          : `<div class="h ghost" style="left:${rw + this.X[c]}px;width:${GW}px">var</div>`;
      }
      this.hrow.innerHTML = hh;
      // case numbers
      let rn = '';
      for (let r = r0; r <= r1; r++) {
        const off = r < n && mask && !mask[r], on = r >= s.r0 && r <= s.r1;
        rn += `<div class="rn${on ? ' on' : ''}${off ? ' off' : ''}" style="top:${r * RH}px;width:${rw}px">${r < n ? r + 1 : ''}</div>`;
      }
      this.rcol.innerHTML = rn;
      // cells
      let html = '';
      for (let r = r0; r <= r1; r++) {
        const y = HH + r * RH, off = r < n && mask && !mask[r];
        for (let c = c0; c <= c1; c++) {
          const x = rw + this.X[c], w = this.X[c + 1] - this.X[c], v = vars[c];
          if (!v || r >= n) { html += `<div class="c ghost" style="left:${x}px;top:${y}px;width:${w}px"></div>`; continue; }
          const val = cols[c][r];
          let cls = 'c', txt;
          if (val == null || val === '') txt = v.type === 'string' ? '' : '.';
          else {
            const lab = labels ? D.labelOf(val, v) : null;
            txt = lab != null ? lab : D.fmtValue(val, v, false);
            if (lab != null || v.type === 'string') cls += lab != null ? ' lab' : ' s';
            if (D.isUserMissing(val, v)) cls += ' um';
          }
          if (off) cls += ' off';
          html += `<div class="${cls}" style="left:${x}px;top:${y}px;width:${w}px">${esc(txt)}</div>`;
        }
      }
      // selection
      const sx = rw + this.X[s.c0], sw = this.X[s.c1 + 1] - this.X[s.c0], sy = HH + s.r0 * RH, sh = (s.r1 - s.r0 + 1) * RH;
      if (s.r1 > s.r0 || s.c1 > s.c0) html += `<div class="selr" style="left:${sx}px;top:${sy}px;width:${sw}px;height:${sh}px"></div>`;
      const cx = rw + this.X[this.sel.c], cy = HH + this.sel.r * RH;
      html += `<div class="cur" style="left:${cx - 1}px;top:${cy - 1}px;width:${this.X[this.sel.c + 1] - this.X[this.sel.c] + 1}px;height:${RH + 1}px"></div>`;
      this.cells.innerHTML = html;
    }
    norm() { const s = this.sel; return { r0: Math.min(s.r, s.r2), r1: Math.max(s.r, s.r2), c0: Math.min(s.c, s.c2), c1: Math.max(s.c, s.c2) }; }
    select(r, c, extend = false, keepView = false) {
      r = Math.max(0, Math.min(this.nrAll - 1, r)); c = Math.max(0, Math.min(this.ncAll - 1, c));
      if (extend) { this.sel.r2 = r; this.sel.c2 = c; } else this.sel = { r, c, r2: r, c2: c };
      if (!keepView) this.scrollTo(extend ? r : this.sel.r, extend ? c : this.sel.c);
      this.render(); this.h.onSelect?.(this.norm(), this.sel);
    }
    selectRect(r0, c0, r1, c1) { this.sel = { r: r0, c: c0, r2: r1, c2: c1 }; this.render(); this.h.onSelect?.(this.norm(), this.sel); }
    scrollTo(r, c) {
      const el = this.el, rw = this._rw || this.rw; if (!this.X) this.layout();
      const top = r * RH, bottom = top + RH, viewH = el.clientHeight - HH;
      if (top < el.scrollTop) el.scrollTop = top; else if (bottom > el.scrollTop + viewH) el.scrollTop = bottom - viewH;
      const left = this.X[c], right = this.X[c + 1], viewW = el.clientWidth - rw;
      if (left < el.scrollLeft) el.scrollLeft = left; else if (right > el.scrollLeft + viewW) el.scrollLeft = right - viewW;
    }
    hit(e) {
      const rect = this.el.getBoundingClientRect(), vx = e.clientX - rect.left, vy = e.clientY - rect.top;
      if (vx > this.el.clientWidth || vy > this.el.clientHeight) return null;   // scrollbars
      const x = vx + this.el.scrollLeft - this._rw, y = vy + this.el.scrollTop - HH;
      return { head: vy < HH, rowh: vx < this._rw, r: Math.max(0, Math.min(this.nrAll - 1, Math.floor(y / RH))), c: this.colAt(x) };
    }
    mouseDown(e) {
      if (e.target === this.editor) return;
      const h = this.hit(e); if (!h) return;
      this.commitEdit();
      this.el.focus({ preventScroll: true });
      if (e.button === 2) { const s = this.norm(); if (!(h.r >= s.r0 && h.r <= s.r1 && h.c >= s.c0 && h.c <= s.c1)) { if (h.head) this.selectRect(0, h.c, Math.max(0, this.doc.n - 1), h.c); else this.select(h.r, h.c, false, true); } return; }
      e.preventDefault();
      if (h.head && h.rowh) { this.selectRect(0, 0, Math.max(0, this.doc.n - 1), Math.max(0, this.nc - 1)); return; }
      if (h.head) { if (e.shiftKey) { this.sel.c2 = h.c; this.sel.r = 0; this.sel.r2 = Math.max(0, this.doc.n - 1); this.render(); this.h.onSelect?.(this.norm(), this.sel); } else this.selectRect(0, h.c, Math.max(0, this.doc.n - 1), h.c); this.dragMode = 'col'; }
      else if (h.rowh) { if (e.shiftKey) { this.sel.r2 = h.r; this.sel.c = 0; this.sel.c2 = Math.max(0, this.nc - 1); this.render(); this.h.onSelect?.(this.norm(), this.sel); } else this.selectRect(h.r, 0, h.r, Math.max(0, this.nc - 1)); this.dragMode = 'row'; }
      else { this.select(h.r, h.c, e.shiftKey, true); this.dragMode = 'cell'; }
      const move = ev => {
        const k = this.hit(ev); if (!k) return;
        if (this.dragMode === 'col') { this.sel.c2 = k.c; } else if (this.dragMode === 'row') { this.sel.r2 = k.r; } else { this.sel.r2 = k.r; this.sel.c2 = k.c; }
        this.render(); this.h.onSelect?.(this.norm(), this.sel);
      };
      const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); this.dragMode = null; };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    }
    dblClick(e) { const h = this.hit(e); if (!h) return; if (h.head) { if (h.c < this.nc) this.h.onHeaderDbl?.(h.c); return; } if (!h.rowh) this.startEdit(); }
    context(e) { e.preventDefault(); const h = this.hit(e); if (h) this.h.onContext?.(e, h); }
    key(e) {
      if (this.editor) return;   // the editor handles its own keys
      const s = this.sel, k = e.key, ext = e.shiftKey, pageRows = Math.max(1, Math.floor((this.el.clientHeight - HH) / RH) - 1);
      const cr = ext ? s.r2 : s.r, cc = ext ? s.c2 : s.c;
      const go = (r, c) => { e.preventDefault(); e.stopPropagation(); this.select(r, c, ext); };
      if (e.ctrlKey && (k === 'Home')) return go(0, 0);
      if (e.ctrlKey && (k === 'End')) return go(Math.max(0, this.doc.n - 1), Math.max(0, this.nc - 1));
      if (e.ctrlKey && k === 'ArrowDown') return go(Math.max(0, this.doc.n - 1), cc);
      if (e.ctrlKey && k === 'ArrowUp') return go(0, cc);
      if (e.ctrlKey && k === 'ArrowRight') return go(cr, Math.max(0, this.nc - 1));
      if (e.ctrlKey && k === 'ArrowLeft') return go(cr, 0);
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      switch (k) {
        case 'ArrowDown': return go(cr + 1, cc); case 'ArrowUp': return go(cr - 1, cc);
        case 'ArrowRight': return go(cr, cc + 1); case 'ArrowLeft': return go(cr, cc - 1);
        case 'PageDown': return go(cr + pageRows, cc); case 'PageUp': return go(cr - pageRows, cc);
        case 'Home': return go(cr, 0); case 'End': return go(cr, Math.max(0, this.nc - 1));
        case 'Enter': e.preventDefault(); e.stopPropagation(); this.sel = { r: s.r + (ext ? -1 : 1), c: s.c, r2: s.r + (ext ? -1 : 1), c2: s.c }; return this.select(this.sel.r, this.sel.c);
        case 'Tab': e.preventDefault(); e.stopPropagation(); return this.select(s.r, s.c + (ext ? -1 : 1));
        case 'F2': e.preventDefault(); e.stopPropagation(); return this.startEdit();
        case 'Delete': case 'Backspace': e.preventDefault(); e.stopPropagation(); return this.h.clearRange?.(this.norm());
        case 'Escape': return;
      }
      if (k.length === 1) { e.preventDefault(); e.stopPropagation(); this.startEdit(k); }
    }
    startEdit(initial) {
      const { r, c } = this.sel; this.commitEdit();
      this.sel.r2 = r; this.sel.c2 = c; this.scrollTo(r, c); this.render();
      const v = this.doc.vars[c], inp = document.createElement('input');
      inp.className = 'ed' + (!v || v.type === 'string' || (this.h.labels && v.values && Object.keys(v.values).length) ? ' s' : '');
      const x = this._rw + this.X[c], y = HH + r * RH;
      Object.assign(inp.style, { left: x - 1 + 'px', top: y - 1 + 'px', width: Math.max(80, this.X[c + 1] - this.X[c] + 2) + 'px' });
      let cur = '';
      if (v && r < this.doc.n) { const val = this.doc.cols[c][r]; if (val != null && val !== '') { const lab = this.h.labels ? D.labelOf(val, v) : null; cur = lab != null ? lab : v.type === 'date' ? D.dateStr(val) : v.type === 'string' ? String(val) : String(val); } }
      inp.value = initial != null ? initial : cur;
      if (v && v.values && Object.keys(v.values).length) {
        const dl = document.createElement('datalist'); dl.id = 'dgdl'; Object.entries(v.values).forEach(([code, lab]) => { const o = document.createElement('option'); o.value = this.h.labels ? lab : code; o.label = this.h.labels ? code : lab; dl.appendChild(o); });
        this.space.appendChild(dl); inp.setAttribute('list', 'dgdl'); this.dl = dl;
      }
      this.space.appendChild(inp); this.editor = inp; this.editAt = { r, c };
      inp.focus(); if (initial == null) inp.select(); else inp.setSelectionRange(inp.value.length, inp.value.length);
      inp.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); if (this.commitEdit()) this.select(r + (e.shiftKey ? -1 : 1), c); }
        else if (e.key === 'Tab') { e.preventDefault(); if (this.commitEdit()) this.select(r, c + (e.shiftKey ? -1 : 1)); }
        else if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit(); }
        else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && initial != null) { e.preventDefault(); if (this.commitEdit()) this.select(r + (e.key === 'ArrowDown' ? 1 : -1), c); }
      });
      inp.addEventListener('blur', () => setTimeout(() => { if (this.editor === inp) this.commitEdit(); }, 0));
    }
    cancelEdit() { if (!this.editor) return; this.editor.remove(); this.dl?.remove(); this.dl = null; this.editor = null; this.el.focus({ preventScroll: true }); }
    commitEdit() {
      if (!this.editor) return true;
      const inp = this.editor, { r, c } = this.editAt, text = inp.value;
      const v = this.doc.vars[c];
      let cur = '';
      if (v && r < this.doc.n) { const val = this.doc.cols[c][r]; cur = val == null ? '' : this.h.labels && D.labelOf(val, v) != null ? D.labelOf(val, v) : v.type === 'date' ? D.dateStr(val) : String(val); }
      this.editor = null; inp.remove(); this.dl?.remove(); this.dl = null;
      this.el.focus({ preventScroll: true });
      if (text === cur || (!v && text === '')) return true;
      return this.h.commitCells([{ r, c, text }]) !== false;
    }
    rangeTSV(s) {
      const { vars, cols, n } = this.doc, lines = [];
      for (let r = s.r0; r <= Math.min(s.r1, n - 1); r++) {
        const row = []; for (let c = s.c0; c <= Math.min(s.c1, vars.length - 1); c++) { const v = vars[c], x = cols[c][r]; row.push(x == null ? '' : D.fmtValue(x, v, this.h.labels && D.labelOf(x, v) != null).replace(/[\t\r\n]/g, ' ')); }
        lines.push(row.join('\t'));
      }
      return lines.join('\r\n');
    }
    copy(e, cut) {
      if (this.editor) return; e.preventDefault();
      const s = this.norm(); e.clipboardData.setData('text/plain', this.rangeTSV(s));
      if (cut) this.h.clearRange?.(s);
    }
    paste(e) {
      if (this.editor) return; e.preventDefault();
      const t = e.clipboardData.getData('text/plain'); if (!t) return;
      const rows = t.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(l => l.split('\t'));
      this.h.pasteBlock?.(this.norm().r0, this.norm().c0, rows);
    }
  }
  root.DataGrid = DataGrid;
})(typeof self !== 'undefined' ? self : this);
