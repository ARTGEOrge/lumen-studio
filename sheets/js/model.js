'use strict';
/* Lumen Sheets — workbook model: sparse cell storage, dependency graph, incremental recalculation with
   cycle detection and dynamic-array spilling, undo transactions, structural edits, fill series, sort,
   conditional formats, find/replace and the .lsheet (JSON) format. Browser: window.SheetModel. Node: module.exports. */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const F = isNode ? require('./functions.js') : root.Formula;
  const Fmt = F.Fmt;
  const { MAXR, MAXC, FErr, ERR, Ref, Need } = F;
  const K = (r, c) => r * MAXC + c;
  const LOCK = 17179869184; // 2^34
  const RC = k => [Math.floor(k / MAXC), k % MAXC];
  let sheetSeq = 1;

  class Sheet {
    constructor(wb, name) {
      this.wb = wb; this.id = sheetSeq++; this.name = name;
      this.reset();
    }
    reset() {
      this.cells = new Map(); this.formulas = new Set(); this.spill = new Map(); this.blocked = new Set();
      this.colW = new Map(); this.rowH = new Map(); this.hiddenRows = new Set(); this.hiddenCols = new Set(); this.filtered = new Set();
      this.merges = []; this.freeze = { r: 0, c: 0 }; this.cf = []; this.filter = null; this.charts = []; this.tabColor = null; this.pivot = null;
      this.showGrid = true; this.zoom = 1;
      this.maxR = -1; this.maxC = -1; this.boundsDirty = false; this._mergeIdx = null;
    }
    get(r, c) { return this.cells.get(K(r, c)); }
    bounds() {
      if (this.boundsDirty) {
        let mr = -1, mc = -1;
        for (const k of this.cells.keys()) { const r = Math.floor(k / MAXC), c = k % MAXC; if (r > mr) mr = r; if (c > mc) mc = c; }
        for (const k of this.spill.keys()) { const r = Math.floor(k / MAXC), c = k % MAXC; if (r > mr) mr = r; if (c > mc) mc = c; }
        this.maxR = mr; this.maxC = mc; this.boundsDirty = false;
      }
      return { r: this.maxR, c: this.maxC };
    }
    grow(r, c) { if (r > this.maxR) this.maxR = r; if (c > this.maxC) this.maxC = c; }
    // value incl. spilled values; null when empty
    value(r, c) {
      const cell = this.cells.get(K(r, c));
      if (cell) {
        if (cell.f != null) return Array.isArray(cell.val) ? cell.val[0][0] : cell.val;
        if (cell.v != null) return cell.v;
      }
      const src = this.spill.get(K(r, c));
      if (src != null) { const sc = this.cells.get(src); if (sc && Array.isArray(sc.val)) { const [sr, scc] = RC(src); return (sc.val[r - sr] || [])[c - scc] ?? null; } }
      return null;
    }
    mergeAt(r, c) {
      if (!this._mergeIdx) { this._mergeIdx = new Map(); for (const m of this.merges) for (let i = m.r1; i <= m.r2; i++) for (let j = m.c1; j <= m.c2; j++) this._mergeIdx.set(K(i, j), m); }
      return this._mergeIdx.get(K(r, c)) || null;
    }
    rowHidden(r) { return this.filtered.has(r) || this.hiddenRows.has(r); }
  }

  const cloneCell = c => c ? { v: c.v, f: c.f, s: c.s } : null;
  const emptyCell = c => !c || (c.v == null && c.f == null && !c.s);
  const deep = x => x == null ? x : JSON.parse(JSON.stringify(x, (k, v) => v instanceof Map ? { __map: [...v] } : v instanceof Set ? { __set: [...v] } : v), (k, v) => v && v.__map ? new Map(v.__map) : v && v.__set ? new Set(v.__set) : v);

  class Workbook {
    constructor() {
      this.sheets = []; this.names = new Map(); this.active = 0;
      this.deps = new Map(); this.rangeDeps = new Map(); this.volatile = new Set();
      this.changed = new Set(); this.dirty = new Set(); this.circular = [];
      this.undoStack = []; this.redoStack = []; this.tx = null; this.calcGen = 0; this.nowOverride = null;
      this.onChange = null; this.maxUndo = 100;
      this.ctx = this.makeCtx();
    }
    static blank(n = 1) { const wb = new Workbook(); for (let i = 1; i <= n; i++) wb.addSheetRaw('Sheet' + i); return wb; }
    sheetByName(name) { const lo = String(name).toLowerCase(); return this.sheets.find(s => s.name.toLowerCase() === lo) || null; }
    sheetById(id) { const c = this._byId; if (c && c.n === this.sheets.length && c.m.get(id) && this.sheets.includes(c.m.get(id))) return c.m.get(id); this._byId = { n: this.sheets.length, m: new Map(this.sheets.map(s => [s.id, s])) }; return this._byId.m.get(id) || null; }
    addSheetRaw(name, at = this.sheets.length) { const s = new Sheet(this, name); this.sheets.splice(at, 0, s); return s; }
    uniqueName(base) { let n = base, i = 2; while (this.sheetByName(n)) n = base.replace(/\s*\(\d+\)$/, '') + ` (${i++})`; return n; }
    // a cell location as one number: sheet id * 2^34 + cell key (keys stay below 2^34)
    loc(sheet, key) { return sheet.id * LOCK + key; }
    parseLoc(l) { const sid = Math.floor(l / LOCK); return [this.sheetById(sid), l - sid * LOCK]; }

    /* ---------- evaluation context ---------- */
    makeCtx() {
      const wb = this;
      return {
        sheet: null, r: 0, c: 0, dr: 0, dc: 0, scope: null,
        value(sheet, r, c) {
          const key = K(r, c), cell = sheet.cells.get(key);
          if (cell) {
            if (cell.f != null) { if (cell.dirty) throw new Need(sheet, key); const v = cell.val; return Array.isArray(v) ? v[0][0] : v === undefined ? null : v; }
            if (cell.v != null) return cell.v;
          }
          const src = sheet.spill.get(key);
          if (src != null) {
            const sc = sheet.cells.get(src); if (!sc) return null;
            if (sc.dirty) throw new Need(sheet, src);
            if (!Array.isArray(sc.val)) return null;
            const [sr, scc] = RC(src); return (sc.val[r - sr] || [])[c - scc] ?? null;
          }
          return null;
        },
        bounds(sheet) { return sheet.bounds(); },
        sheetByName: n => wb.sheetByName(n),
        sheetIndex: s => wb.sheets.indexOf(s),
        sheetCount: () => wb.sheets.length,
        name(n) { const d = wb.names.get(String(n).toUpperCase()); if (!d) return null; try { const ast = d.ast || (d.ast = F.parse(d.ref)); const c2 = Object.assign({}, this, { sheet: wb.sheets[0], dr: 0, dc: 0 }); return F.evaluate(ast, c2); } catch (e) { if (e instanceof Need) throw e; return ERR.NAME; } },
        rowHidden: (sheet, r) => sheet.filtered.has(r) ? 'filter' : sheet.hiddenRows.has(r) ? 'manual' : false,
        isSubtotal: (sheet, r, c) => { const x = sheet.cells.get(K(r, c)); return !!(x && x.f && /SUBTOTAL\s*\(/i.test(x.f)); },
        isFormula: (sheet, r, c) => { const x = sheet.cells.get(K(r, c)); return !!(x && x.f != null); },
        formulaText: (sheet, r, c) => { const x = sheet.cells.get(K(r, c)); return x && x.f != null ? '=' + x.f : null; },
        now: () => wb.nowOverride != null ? wb.nowOverride : Fmt.nowSerial()
      };
    }

    /* ---------- dependency graph ---------- */
    register(sheet, key, cell) {
      const loc = this.loc(sheet, key);
      cell.precs = [];
      if (!cell.ast) return;
      const an = F.analyse(cell.ast);
      const refs = an.refs.slice();
      for (const nm of an.names) { const d = this.names.get(nm.toUpperCase()); if (d) { try { const a2 = F.analyse(d.ast || (d.ast = F.parse(d.ref))); a2.refs.forEach(x => refs.push(Object.assign({}, x, { sheet: x.sheet ?? this.sheets[0].name }))); } catch (e) { /* bad name */ } } }
      if (an.vol) this.volatile.add(loc); else this.volatile.delete(loc);
      const multi = [];
      for (const x of refs) {
        const sh = x.sheet != null ? this.sheetByName(x.sheet) : sheet; if (!sh) continue;
        const p = { sid: sh.id, r1: x.r1, c1: x.c1, r2: x.r2, c2: x.c2 };
        cell.precs.push(p);
        if (p.r1 === p.r2 && p.c1 === p.c2) { const l = sh.id * LOCK + K(p.r1, p.c1); let s = this.deps.get(l); if (!s) this.deps.set(l, s = new Set()); s.add(loc); }
        else multi.push(p);
      }
      if (multi.length) this.rangeDeps.set(loc, multi); else this.rangeDeps.delete(loc);
    }
    unregister(sheet, key, cell) {
      const loc = this.loc(sheet, key);
      for (const p of cell.precs || []) if (p.r1 === p.r2 && p.c1 === p.c2) { const l = p.sid * LOCK + K(p.r1, p.c1), s = this.deps.get(l); if (s) { s.delete(loc); if (!s.size) this.deps.delete(l); } }
      this.rangeDeps.delete(loc); this.volatile.delete(loc); this.dirty.delete(loc);
      cell.precs = null;
    }
    rebuildGraph() {
      this.deps.clear(); this.rangeDeps.clear(); this.volatile.clear(); this.dirty.clear();
      for (const sh of this.sheets) {
        sh.formulas.clear(); sh.spill.clear(); sh.blocked.clear(); sh.boundsDirty = true; sh._mergeIdx = null;
        for (const [k, cell] of sh.cells) if (cell.f != null) { sh.formulas.add(k); this.compile(cell); this.register(sh, k, cell); cell.spill = null; cell.dirty = true; this.dirty.add(this.loc(sh, k)); }
      }
    }
    compile(cell) {
      try { cell.ast = F.parse(cell.f); cell.perr = null; }
      catch (e) { cell.ast = null; cell.perr = e.message || 'Formula error'; }
    }

    /* ---------- cell mutation ---------- */
    setCellRaw(sheet, key, cell) {
      const old = sheet.cells.get(key), loc = this.loc(sheet, key);
      if (old && old.f != null) {
        this.unregister(sheet, key, old); sheet.formulas.delete(key);
        if (old.spill) this.clearSpill(sheet, key, old);
        sheet.blocked.delete(key);
      }
      if (emptyCell(cell)) { if (old) { sheet.cells.delete(key); sheet.boundsDirty = true; } }
      else {
        const c = { v: cell.v ?? null, s: cell.s || null };
        if (cell.f != null) { c.f = String(cell.f).replace(/^=/, ''); c.v = null; }
        sheet.cells.set(key, c);
        const [r, cc] = RC(key); sheet.grow(r, cc);
        if (c.f != null) { sheet.formulas.add(key); this.compile(c); this.register(sheet, key, c); c.dirty = true; this.dirty.add(loc); }
      }
      this.changed.add(loc);
      const src = sheet.spill.get(key);
      if (src != null) this.markDirty(sheet, src);
      for (const b of sheet.blocked) this.markDirty(sheet, b);
    }
    markDirty(sheet, key) { const c = sheet.cells.get(key); if (c && c.f != null && !c.dirty) { c.dirty = true; this.dirty.add(this.loc(sheet, key)); this.changed.add(this.loc(sheet, key)); } }
    clearSpill(sheet, key, cell) {
      const [r, c] = RC(key), { rows, cols } = cell.spill;
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { if (!i && !j) continue; const k2 = K(r + i, c + j); if (sheet.spill.get(k2) === key) { sheet.spill.delete(k2); this.changed.add(this.loc(sheet, k2)); } }
      cell.spill = null; sheet.boundsDirty = true;
    }
    // public, transactional
    setCell(sheet, r, c, cell) {
      const key = K(r, c);
      if (this.tx) { const l = this.loc(sheet, key); if (!this.tx.cells.has(l)) this.tx.cells.set(l, { sheet, key, before: cloneCell(sheet.cells.get(key)) }); }
      this.setCellRaw(sheet, key, cell);
    }
    // typed entry: "=SUM(A1:A3)", "12%", "hello" — keeps the cell's style, applies an auto number format for dates/percent/currency
    input(sheet, r, c, text) {
      const old = sheet.get(r, c), s = old ? old.s : null;
      if (text == null || text === '') { this.setCell(sheet, r, c, s ? { v: null, s } : null); return; }
      const t = String(text);
      if (t[0] === '=' && t.length > 1) { this.setCell(sheet, r, c, { f: t.slice(1), s }); return; }
      if (t[0] === "'") { this.setCell(sheet, r, c, { v: t.slice(1), s }); return; }
      const err = F.errOf(t.trim());
      if (err) { this.setCell(sheet, r, c, { v: err, s }); return; }
      const p = Fmt.parseInput(t);
      let ns = s;
      if (p.fmt && !(s && s.nf && (Fmt.isDateFormat(s.nf) === Fmt.isDateFormat(p.fmt)) && !/%/.test(p.fmt) === !/%/.test(s.nf))) ns = Object.assign({}, s || {}, { nf: p.fmt });
      this.setCell(sheet, r, c, { v: typeof p.v === 'string' ? t : p.v, s: ns });
    }
    setStyle(sheet, r, c, patch) {
      const old = sheet.get(r, c);
      const s = Object.assign({}, old && old.s || {}, patch);
      Object.keys(s).forEach(k => { if (s[k] == null || s[k] === false || s[k] === '') delete s[k]; });
      this.setCell(sheet, r, c, { v: old ? old.v : null, f: old ? old.f : undefined, s: Object.keys(s).length ? s : null });
    }
    setMeta(sheet, prop, value) {
      if (this.tx) this.tx.meta.push({ sheet, prop, before: deep(sheet[prop]) });
      sheet[prop] = value;
      if (prop === 'merges') sheet._mergeIdx = null;
      if (prop === 'filtered' || prop === 'hiddenRows') this.markSubtotalsDirty(sheet);
    }
    markSubtotalsDirty(sheet) { for (const k of sheet.formulas) { const c = sheet.cells.get(k); if (c && /SUBTOTAL|AGGREGATE/i.test(c.f)) this.markDirty(sheet, k); } }

    /* ---------- transactions / undo ---------- */
    begin(label) { if (this.tx) { this.tx.depth++; return; } this.tx = { label, cells: new Map(), meta: [], depth: 0 }; }
    commit() {
      const tx = this.tx; if (!tx) return;
      if (tx.depth) { tx.depth--; return; }
      this.tx = null;
      for (const e of tx.cells.values()) e.after = cloneCell(e.sheet.cells.get(e.key));
      for (const m of tx.meta) m.after = deep(m.sheet[m.prop]);
      const changedCells = [...tx.cells.values()].some(e => JSON.stringify(e.before) !== JSON.stringify(e.after));
      if (changedCells || tx.meta.length) this.pushUndo({ label: tx.label, cells: [...tx.cells.values()], meta: tx.meta });
      this.recalc();
      this.onChange && this.onChange(tx.label);
    }
    pushUndo(e) { this.undoStack.push(e); this.redoStack.length = 0; let mem = 0; for (let i = this.undoStack.length - 1; i >= 0; i--) { const x = this.undoStack[i]; mem += x.snap ? x.before.length + x.after.length : x.cells.length * 60; if (mem > 4e8 || this.undoStack.length - i > this.maxUndo) { this.undoStack.splice(0, i + 1); break; } } }
    transact(label, fn) { this.begin(label); try { return fn(); } finally { this.commit(); } }
    applyEntry(e, dir) {
      if (e.snap) { this.restore(JSON.parse(dir === 'undo' ? e.before : e.after)); return; }
      const cells = dir === 'undo' ? e.cells.slice().reverse() : e.cells;
      for (const c of cells) { if (!this.sheets.includes(c.sheet)) continue; this.setCellRaw(c.sheet, c.key, dir === 'undo' ? c.before : c.after); }
      const meta = dir === 'undo' ? e.meta.slice().reverse() : e.meta;
      for (const m of meta) { m.sheet[m.prop] = deep(dir === 'undo' ? m.before : m.after); if (m.prop === 'merges') m.sheet._mergeIdx = null; }
      this.recalc();
    }
    undo() { const e = this.undoStack.pop(); if (!e) return null; this.applyEntry(e, 'undo'); this.redoStack.push(e); this.onChange && this.onChange('undo'); return e.label; }
    redo() { const e = this.redoStack.pop(); if (!e) return null; this.applyEntry(e, 'redo'); this.undoStack.push(e); this.onChange && this.onChange('redo'); return e.label; }
    // whole-workbook snapshot transaction for structural edits (insert/delete rows, sheets, …)
    structural(label, fn) {
      const before = JSON.stringify(this.toJSON());
      const r = fn();
      this.rebuildGraph(); this.recalc();
      const after = JSON.stringify(this.toJSON());
      this.pushUndo({ label, snap: true, before, after });
      this.onChange && this.onChange(label);
      return r;
    }

    /* ---------- recalculation ---------- */
    propagate() {
      const q = [...this.changed]; this.changed.clear();
      if (!q.length) return;
      if (q.length * this.rangeDeps.size > 4e6) { for (const sh of this.sheets) for (const k of sh.formulas) this.markDirtyQuiet(sh, k); return; }
      const rl = []; for (const [dep, ranges] of this.rangeDeps) for (const p of ranges) rl.push(p.sid, p.r1, p.c1, p.r2, p.c2, dep);
      const seen = new Set(q);
      const visit = d => {
        const sid = Math.floor(d / LOCK), sh = this.sheetById(sid); if (!sh) return;
        const cell = sh.cells.get(d - sid * LOCK); if (!cell || cell.f == null) return;
        if (!cell.dirty) { cell.dirty = true; this.dirty.add(d); }
        if (!seen.has(d)) { seen.add(d); q.push(d); }
      };
      while (q.length) {
        const l = q.pop();
        const s = this.deps.get(l);
        if (s) for (const d of s) visit(d);
        if (rl.length) {
          const sid = Math.floor(l / LOCK), key = l - sid * LOCK, r = Math.floor(key / MAXC), c = key - r * MAXC;
          let last = -1;
          for (let i = 0; i < rl.length; i += 6) if (rl[i] === sid && r >= rl[i + 1] && r <= rl[i + 3] && c >= rl[i + 2] && c <= rl[i + 4] && rl[i + 5] !== last) { last = rl[i + 5]; visit(last); }
        }
      }
    }
    markDirtyQuiet(sh, k) { const c = sh.cells.get(k); if (c && c.f != null) { c.dirty = true; this.dirty.add(this.loc(sh, k)); } }
    recalc(full = false) {
      if (full) for (const sh of this.sheets) for (const k of sh.formulas) this.markDirtyQuiet(sh, k);
      for (const l of this.volatile) { const [sh, k] = this.parseLoc(l); if (sh) this.markDirtyQuiet(sh, k); }
      this.circular = [];
      for (let wave = 0; wave < 20; wave++) {
        this.propagate();
        if (!this.dirty.size) break;
        const list = [...this.dirty];
        for (const l of list) { const [sh, k] = this.parseLoc(l); const cell = sh && sh.cells.get(k); if (cell && cell.dirty) this.evalLoop(sh, k); else this.dirty.delete(l); }
        if (!this.changed.size && !this.dirty.size) break;
      }
      this.calcGen++;
    }
    dirtyPrecedents(cell, out) {
      for (const p of cell.precs || []) {
        const sh = this.sheetById(p.sid); if (!sh) continue;
        if (p.r1 === p.r2 && p.c1 === p.c2) { const k = K(p.r1, p.c1), c = sh.cells.get(k); if (c && c.dirty) out.push([sh, k]); const src = sh.spill.get(k); if (src != null) { const sc = sh.cells.get(src); if (sc && sc.dirty) out.push([sh, src]); } continue; }
        const area = (p.r2 - p.r1 + 1) * (p.c2 - p.c1 + 1);
        if (area > sh.formulas.size) { for (const k of sh.formulas) { const c = sh.cells.get(k); if (!c.dirty) continue; const r = Math.floor(k / MAXC), cc = k % MAXC; if (r >= p.r1 && r <= p.r2 && cc >= p.c1 && cc <= p.c2) out.push([sh, k]); } }
        else for (let r = p.r1; r <= p.r2; r++) for (let c = p.c1; c <= p.c2; c++) { const k = K(r, c), x = sh.cells.get(k); if (x && x.dirty) out.push([sh, k]); }
      }
    }
    evalLoop(sheet, key) {
      // explicit stack (no recursion, so 100k-long chains are fine). Frames with exp=true are the ancestors
      // of the frame on top; meeting one of them again means a circular reference.
      const stack = [{ sh: sheet, k: key, exp: false }], active = new Set();
      let guard = 0;
      while (stack.length) {
        if (++guard > 5e7) break;
        const top = stack[stack.length - 1], cell = top.sh.cells.get(top.k), tl = this.loc(top.sh, top.k);
        if (!cell || cell.f == null || !cell.dirty) { stack.pop(); if (top.exp) active.delete(tl); continue; }
        if (!top.exp) {
          if (active.has(tl)) { this.markCycle(stack, active, tl); continue; }
          top.exp = true; active.add(tl);
          const ps = []; this.dirtyPrecedents(cell, ps);
          let pushed = false, cyc = null;
          for (const [sh, k] of ps) {
            const l = this.loc(sh, k);
            if (active.has(l)) { cyc = l; break; }
            stack.push({ sh, k, exp: false }); pushed = true;
          }
          if (cyc) { this.markCycle(stack, active, cyc); continue; }
          if (pushed) continue;
        }
        try {
          this.evalCell(top.sh, top.k, cell);
          stack.pop(); active.delete(tl);
        } catch (e) {
          if (!(e instanceof Need)) throw e;
          const l = this.loc(e.sheet, e.key);
          if (active.has(l)) { this.markCycle(stack, active, l); continue; }
          stack.push({ sh: e.sheet, k: e.key, exp: false });
        }
      }
    }
    markCycle(stack, active, l) {
      let i = stack.findIndex(f => f.exp && this.loc(f.sh, f.k) === l); if (i < 0) i = stack.length - 1;
      const frames = stack.splice(i);
      for (const f of frames) {
        const fl = this.loc(f.sh, f.k);
        if (!f.exp && fl !== l) continue;
        active.delete(fl);
        const c = f.sh.cells.get(f.k);
        if (c && c.dirty) { if (c.spill) this.clearSpill(f.sh, f.k, c); c.val = ERR.CIRC; c.dirty = false; this.dirty.delete(fl); this.changed.add(fl); this.circular.push({ sheet: f.sh.name, addr: F.addr(...RC(f.k)) }); }
      }
    }
    evalCell(sheet, key, cell) {
      const [r, c] = RC(key), ctx = this.ctx;
      if (cell.spill) this.clearSpill(sheet, key, cell);
      let v;
      if (!cell.ast) v = cell.perr && /Unexpected character|Missing closing/.test(cell.perr) ? ERR.NAME : ERR.NAME;
      else {
        ctx.sheet = sheet; ctx.r = r; ctx.c = c; ctx.dr = 0; ctx.dc = 0; ctx.scope = null;
        v = F.evaluate(cell.ast, ctx);
        if (v instanceof Ref) {
          if (v.single) { v = ctx.value(v.sheet, v.r1, v.c1); if (v == null) v = 0; }
          else v = F.toMatrix(ctx, v);
        }
        if (Array.isArray(v)) {
          if (v.length === 1 && v[0].length === 1) v = v[0][0];
          else if (!v.length || !v[0].length) v = ERR.CALC;
        }
        if (v == null) v = 0;
        if (typeof v === 'number' && !Number.isFinite(v)) v = ERR.NUM;
      }
      const old = cell.val;
      cell.val = v; cell.dirty = false; this.dirty.delete(this.loc(sheet, key));
      sheet.blocked.delete(key);
      if (Array.isArray(v)) this.placeSpill(sheet, key, cell, r, c);
      void old; // dependents were already marked dirty by propagate() and are evaluated after this cell
    }
    changedAfterEval(sheet, key) { this.changed.add(this.loc(sheet, key)); }
    placeSpill(sheet, key, cell, r, c) {
      const M = cell.val, rows = M.length, cols = M[0].length;
      let blocked = r + rows > MAXR || c + cols > MAXC || rows * cols > 4e6;
      for (let i = 0; i < rows && !blocked; i++) for (let j = 0; j < cols; j++) {
        if (!i && !j) continue;
        const k2 = K(r + i, c + j), x = sheet.cells.get(k2);
        if (x && (x.v != null || x.f != null)) { blocked = true; break; }
        const o = sheet.spill.get(k2); if (o != null && o !== key) { blocked = true; break; }
      }
      if (blocked) { cell.val = ERR.SPILL; sheet.blocked.add(key); return; }
      cell.spill = { rows, cols };
      for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) { if (!i && !j) continue; const k2 = K(r + i, c + j); sheet.spill.set(k2, key); this.changed.add(this.loc(sheet, k2)); }
      sheet.grow(r + rows - 1, c + cols - 1);
    }

    /* ---------- convenience for tests / scripts ---------- */
    // wb.calc('=SUM(1,2)') evaluates a formula in the context of sheet 0 at A1 without storing it
    calc(formula, sheet = this.sheets[0], r = 0, c = 0) {
      const ctx = this.ctx; ctx.sheet = sheet; ctx.r = r; ctx.c = c; ctx.dr = 0; ctx.dc = 0; ctx.scope = null;
      let v = F.evaluate(F.parse(formula), ctx);
      if (v instanceof Ref) v = v.single ? ctx.value(v.sheet, v.r1, v.c1) : F.toMatrix(ctx, v);
      if (Array.isArray(v) && v.length === 1 && v[0].length === 1) v = v[0][0];
      return v;
    }
    // set many cells from A1-keyed object: {A1: 5, B1: '=A1*2'}
    load(sheet, obj) { this.transact('Load', () => { for (const [a, v] of Object.entries(obj)) { const p = F.parseAddr(a); if (typeof v === 'string') this.input(sheet, p.r, p.c, v); else this.setCell(sheet, p.r, p.c, { v }); } }); }
    val(ref, sheet = this.sheets[0]) { let sh = sheet, a = ref; const m = /^(.*)!(.*)$/.exec(ref); if (m) { sh = this.sheetByName(m[1].replace(/^'|'$/g, '')); a = m[2]; } const p = F.parseAddr(a); return sh.value(p.r, p.c); }

    /* ---------- display ---------- */
    display(sheet, r, c) {
      const cell = sheet.get(r, c), v = sheet.value(r, c);
      let nf = cell && cell.s && cell.s.nf;
      if (!cell || !cell.s || !cell.s.nf) {
        const src = sheet.spill.get(K(r, c)); if (src != null) { const sc = sheet.cells.get(src); nf = sc && sc.s && sc.s.nf; }
        if (!nf && cell && cell.f != null && typeof v === 'number') nf = this.inferFormat(sheet, cell);
      }
      if (typeof v === 'number' && !nf && Math.abs(v) >= 1e11 === false) return { text: Fmt.general(v), v };
      const out = Fmt.format(v, nf); out.v = v; return out;
    }
    // formulas like =A1+1 where A1 is a date show as a date (Excel infers the first referenced cell's format)
    inferFormat(sheet, cell) {
      if (cell._nfGen === this.calcGen) return cell._nf;
      let nf = null;
      if (cell.ast && cell.precs && cell.precs.length) {
        const top = cell.ast;
        const fnName = top.t === 'fn' ? top.name : null;
        if (fnName && /^(DATE|EDATE|EOMONTH|TODAY|WORKDAY|DATEVALUE)$/.test(fnName)) nf = 'm/d/yyyy';
        else if (fnName === 'NOW') nf = 'm/d/yyyy h:mm';
        else if (fnName === 'TIME') nf = 'h:mm AM/PM';
        else if (!fnName || /^(SUM|MIN|MAX|AVERAGE|ROUND|IF|INDEX|VLOOKUP|XLOOKUP|HLOOKUP|LOOKUP|MEDIAN|LARGE|SMALL|SUMIF|SUMIFS)$/.test(fnName)) {
          const p = cell.precs[0], sh = this.sheetById(p.sid);
          const x = sh && sh.get(p.r1, p.c1); if (x && x.s && x.s.nf && !/%/.test(x.s.nf)) nf = x.s.nf;
          if (x && x.s && x.s.nf && /%/.test(x.s.nf) && (top.t === 'ref' || fnName)) nf = x.s.nf;
        }
      } else if (cell.ast && cell.ast.t === 'fn') {
        const n = cell.ast.name;
        if (/^(TODAY|DATE)$/.test(n)) nf = 'm/d/yyyy'; else if (n === 'NOW') nf = 'm/d/yyyy h:mm'; else if (n === 'TIME') nf = 'h:mm AM/PM';
      }
      cell._nf = nf; cell._nfGen = this.calcGen; return nf;
    }
    editText(sheet, r, c) {
      const cell = sheet.get(r, c); if (!cell) return '';
      if (cell.f != null) return '=' + cell.f;
      const v = cell.v;
      if (v == null) return '';
      if (v instanceof FErr) return v.code;
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
      if (typeof v === 'number') {
        const nf = cell.s && cell.s.nf;
        if (nf && Fmt.isDateFormat(nf)) { const t = v % 1 !== 0; return Fmt.format(v, v >= 1 ? (t ? 'm/d/yyyy h:mm:ss' : 'm/d/yyyy') : 'h:mm:ss').text; }
        if (nf && /%/.test(nf)) return Fmt.numToText(+(v * 100).toPrecision(15)) + '%';
        return Fmt.numToText(v);
      }
      const s = String(v);
      const p = Fmt.parseInput(s); if (p.v !== s || s[0] === '=' || F.errOf(s)) return "'" + s; // keep text that looks like a number as text
      return s;
    }

    /* ---------- structural edits ---------- */
    insertRows(sheet, at, n) { this.structural(n > 0 ? 'Insert rows' : 'Delete rows', () => this.shiftAxis(sheet, 'row', at, n)); }
    insertCols(sheet, at, n) { this.structural(n > 0 ? 'Insert columns' : 'Delete columns', () => this.shiftAxis(sheet, 'col', at, n)); }
    shiftAxis(sheet, axis, at, n) {
      const isRow = axis === 'row', d = -n, end = at + d;
      const mapIdx = v => n > 0 ? (v >= at ? v + n : v) : (v < at ? v : v >= end ? v - d : -1);
      // move cells
      const cells = new Map();
      for (const [k, cell] of sheet.cells) {
        const [r, c] = RC(k); const x = isRow ? mapIdx(r) : mapIdx(c); if (x < 0) continue;
        const nr = isRow ? x : r, nc = isRow ? c : x; if (nr >= MAXR || nc >= MAXC) continue;
        cells.set(K(nr, nc), cell);
      }
      sheet.cells = cells;
      // formulas everywhere
      for (const sh of this.sheets) for (const cell of sh.cells.values()) if (cell.f != null) {
        cell.f = F.adjustForInsert(cell.f, nm => nm == null ? sh === sheet : nm.toLowerCase() === sheet.name.toLowerCase(), axis, at, n);
      }
      for (const [nm, d2] of this.names) { d2.ref = F.adjustForInsert(d2.ref, x => x != null && x.toLowerCase() === sheet.name.toLowerCase(), axis, at, n); d2.ast = null; void nm; }
      const remapMap = m => { const o = new Map(); for (const [i, v] of m) { const x = mapIdx(i); if (x >= 0) o.set(x, v); } return o; };
      const remapSet = s => { const o = new Set(); for (const i of s) { const x = mapIdx(i); if (x >= 0) o.add(x); } return o; };
      if (isRow) { sheet.rowH = remapMap(sheet.rowH); sheet.hiddenRows = remapSet(sheet.hiddenRows); sheet.filtered = remapSet(sheet.filtered); }
      else { sheet.colW = remapMap(sheet.colW); sheet.hiddenCols = remapSet(sheet.hiddenCols); }
      const adjRange = g => {
        const k1 = isRow ? 'r1' : 'c1', k2 = isRow ? 'r2' : 'c2';
        const t = F.adjustForInsert(F.rangeText(g), () => true, axis, at, n);
        if (/#REF!/.test(t)) return null;
        const p = F.parseRange(t); if (!p) return null;
        return Object.assign({}, g, { [k1]: p[k1], [k2]: p[k2] });
      };
      sheet.merges = sheet.merges.map(adjRange).filter(Boolean); sheet._mergeIdx = null;
      sheet.cf = sheet.cf.map(rule => { const g = adjRange(rule.range); return g ? Object.assign({}, rule, { range: g }) : null; }).filter(Boolean);
      if (sheet.filter) { const g = adjRange(sheet.filter.range); sheet.filter = g ? Object.assign({}, sheet.filter, { range: g }) : null; }
      for (const sh of this.sheets) for (const ch of sh.charts) ch.range = F.adjustForInsert(ch.range, nm => nm == null ? sh === sheet : nm.toLowerCase() === sheet.name.toLowerCase(), axis, at, n);
      if (isRow && sheet.freeze.r > at) sheet.freeze = { r: Math.max(at, sheet.freeze.r + n), c: sheet.freeze.c };
      if (!isRow && sheet.freeze.c > at) sheet.freeze = { r: sheet.freeze.r, c: Math.max(at, sheet.freeze.c + n) };
    }
    addSheet(name, at) { return this.structural('Add sheet', () => this.addSheetRaw(this.uniqueName(name || 'Sheet' + (this.sheets.length + 1)), at)); }
    deleteSheet(sheet) {
      if (this.sheets.length < 2) return;
      this.structural('Delete sheet', () => {
        const i = this.sheets.indexOf(sheet); this.sheets.splice(i, 1);
        const lo = sheet.name.toLowerCase();
        for (const sh of this.sheets) for (const cell of sh.cells.values()) if (cell.f != null) cell.f = F.mapRefs(cell.f, x => x.sheet != null && x.sheet.toLowerCase() === lo ? null : undefined);
        this.active = Math.min(this.active, this.sheets.length - 1);
      });
    }
    renameSheet(sheet, name) {
      name = String(name).trim().replace(/[\\/?*[\]:]/g, '').slice(0, 31);
      if (!name || (this.sheetByName(name) && this.sheetByName(name) !== sheet)) return false;
      this.structural('Rename sheet', () => {
        const old = sheet.name; sheet.name = name;
        for (const sh of this.sheets) {
          for (const cell of sh.cells.values()) if (cell.f != null) cell.f = F.renameSheetIn(cell.f, old, name);
          for (const ch of sh.charts) ch.range = F.renameSheetIn(ch.range, old, name);
        }
        for (const d of this.names.values()) { d.ref = F.renameSheetIn(d.ref, old, name); d.ast = null; }
      });
      return true;
    }
    moveSheet(sheet, to) { this.structural('Move sheet', () => { const cur = this.sheets[this.active]; const i = this.sheets.indexOf(sheet); this.sheets.splice(i, 1); this.sheets.splice(Math.max(0, Math.min(to, this.sheets.length)), 0, sheet); this.active = this.sheets.indexOf(cur); }); }
    duplicateSheet(sheet) {
      return this.structural('Duplicate sheet', () => {
        const js = this.sheetJSON(sheet, this.styleTable());
        const s = this.addSheetRaw(this.uniqueName(sheet.name + ' (2)'), this.sheets.indexOf(sheet) + 1);
        this.applySheetJSON(s, js.sheet, js.styles); return s;
      });
    }

    /* ---------- copy / fill / sort ---------- */
    // grab cells of a rectangle as a clip: {rows, cols, cells[i][j] = {v,f,s}|null, r, c, sheet}
    copyRange(sheet, g) {
      const cells = [];
      for (let r = g.r1; r <= g.r2; r++) { const row = []; for (let c = g.c1; c <= g.c2; c++) row.push(cloneCell(sheet.get(r, c))); cells.push(row); }
      return { sheet, r: g.r1, c: g.c1, rows: g.r2 - g.r1 + 1, cols: g.c2 - g.c1 + 1, cells, merges: sheet.merges.filter(m => m.r1 >= g.r1 && m.r2 <= g.r2 && m.c1 >= g.c1 && m.c2 <= g.c2).map(m => ({ r1: m.r1 - g.r1, c1: m.c1 - g.c1, r2: m.r2 - g.r1, c2: m.c2 - g.c1 })) };
    }
    // paste a clip at (r, c); opts: {values, formats, transpose, cut, tile:{rows,cols}}
    pasteClip(sheet, r, c, clip, opts = {}) {
      const tr = !!opts.transpose;
      const R = tr ? clip.cols : clip.rows, C = tr ? clip.rows : clip.cols;
      const reps = opts.tile && opts.tile.rows % R === 0 && opts.tile.cols % C === 0 ? [opts.tile.rows / R, opts.tile.cols / C] : [1, 1];
      this.transact(opts.cut ? 'Move cells' : 'Paste', () => {
        if (opts.cut && clip.sheet) for (let i = 0; i < clip.rows; i++) for (let j = 0; j < clip.cols; j++) this.setCell(clip.sheet, clip.r + i, clip.c + j, null);
        for (let ti = 0; ti < reps[0]; ti++) for (let tj = 0; tj < reps[1]; tj++) for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
          const src = tr ? clip.cells[j][i] : clip.cells[i][j];
          const tr_ = r + ti * R + i, tc = c + tj * C + j; if (tr_ >= MAXR || tc >= MAXC) continue;
          const old = sheet.get(tr_, tc);
          let cell = src ? { v: src.v, f: src.f, s: src.s } : null;
          if (cell && cell.f != null && !opts.cut && clip.r != null) cell.f = F.shiftFormula(cell.f, tr_ - (clip.r + (tr ? j : i)), tc - (clip.c + (tr ? i : j)));
          if (opts.values && cell) { const sv = clip.sheet && clip.sheet.value(clip.r + (tr ? j : i), clip.c + (tr ? i : j)); cell = { v: cell.f != null ? (sv instanceof FErr ? sv : sv) : cell.v, s: old ? old.s : null }; if (src && src.f == null) cell.v = src.v; }
          if (opts.values && !cell) cell = old && old.s ? { v: null, s: old.s } : null;
          if (opts.formats) cell = { v: old ? old.v : null, f: old ? old.f : undefined, s: src ? src.s : null };
          this.setCell(sheet, tr_, tc, cell);
        }
        if (!opts.values && !opts.formats && clip.merges && clip.merges.length && !tr) {
          const ms = sheet.merges.slice(); clip.merges.forEach(m => ms.push({ r1: r + m.r1, c1: c + m.c1, r2: r + m.r2, c2: c + m.c2 })); this.setMeta(sheet, 'merges', ms);
        }
      });
    }
    // fill src rectangle into the extended target rectangle (dir: down|up|right|left)
    fill(sheet, src, dst, dir) {
      const vertical = dir === 'down' || dir === 'up';
      this.transact('Fill', () => {
        const lines = vertical ? [src.c1, src.c2] : [src.r1, src.r2];
        for (let line = lines[0]; line <= lines[1]; line++) {
          const seq = [];
          const n = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1;
          for (let i = 0; i < n; i++) { const r = vertical ? src.r1 + i : line, c = vertical ? line : src.c1 + i; seq.push({ r, c, cell: cloneCell(sheet.get(r, c)) }); }
          const targets = [];
          if (dir === 'down') for (let r = src.r2 + 1; r <= dst.r2; r++) targets.push({ r, c: line, k: r - src.r1 });
          if (dir === 'up') for (let r = src.r1 - 1; r >= dst.r1; r--) targets.push({ r, c: line, k: r - src.r1 });
          if (dir === 'right') for (let c = src.c2 + 1; c <= dst.c2; c++) targets.push({ r: line, c, k: c - src.c1 });
          if (dir === 'left') for (let c = src.c1 - 1; c >= dst.c1; c--) targets.push({ r: line, c, k: c - src.c1 });
          const series = fillSeries(seq.map(x => x.cell));
          for (const t of targets) {
            const idx = ((t.k % n) + n) % n, s = seq[idx];
            let cell = s.cell ? { v: s.cell.v, f: s.cell.f, s: s.cell.s } : null;
            if (cell && cell.f != null) cell.f = F.shiftFormula(cell.f, t.r - s.r, t.c - s.c);
            else if (series && cell) cell.v = series(t.k);
            this.setCell(sheet, t.r, t.c, cell);
          }
        }
      });
    }
    // sort rows of range g by keys [{col (absolute index), asc, by:'value'}]; header row excluded when hasHeader
    sortRange(sheet, g, keys, hasHeader) {
      const r0 = g.r1 + (hasHeader ? 1 : 0);
      if (r0 >= g.r2) return;
      const rows = [];
      for (let r = r0; r <= g.r2; r++) { const cells = []; for (let c = g.c1; c <= g.c2; c++) cells.push(cloneCell(sheet.get(r, c))); rows.push({ r, cells, keys: keys.map(k => sheet.value(r, k.col)) }); }
      const cmp = (a, b) => {
        for (let i = 0; i < keys.length; i++) {
          const x = a.keys[i], y = b.keys[i], ex = x == null || x === '', ey = y == null || y === '';
          if (ex || ey) { if (ex && ey) continue; return ex ? 1 : -1; }
          const c = F.compare(x, y); if (c) return keys[i].asc === false ? -c : c;
        }
        return a.r - b.r;
      };
      rows.sort(cmp);
      this.transact('Sort', () => {
        rows.forEach((row, i) => {
          const r = r0 + i;
          row.cells.forEach((cell, j) => {
            if (cell && cell.f != null) cell = { v: null, f: F.shiftFormula(cell.f, r - row.r, 0), s: cell.s };
            this.setCell(sheet, r, g.c1 + j, cell);
          });
        });
      });
    }
    // contiguous data region around (r, c) like Ctrl+A / Excel's current region
    region(sheet, r, c) {
      let g = { r1: r, c1: c, r2: r, c2: c }, grew = true;
      const filled = (rr, cc) => rr >= 0 && cc >= 0 && sheet.value(rr, cc) != null;
      if (!filled(r, c)) {
        const nb = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]].find(([a, b]) => filled(a, b));
        if (!nb) return g; g = { r1: nb[0], c1: nb[1], r2: nb[0], c2: nb[1] };
      }
      let guard = 0;
      while (grew && guard++ < 10000) {
        grew = false;
        const scanRow = (rr, c1, c2) => { for (let cc = c1; cc <= c2; cc++) if (filled(rr, cc)) return true; return false; };
        const scanCol = (cc, r1, r2) => { for (let rr = r1; rr <= r2; rr++) if (filled(rr, cc)) return true; return false; };
        if (g.r1 > 0 && scanRow(g.r1 - 1, Math.max(0, g.c1 - 1), g.c2 + 1)) { g.r1--; grew = true; }
        if (scanRow(g.r2 + 1, Math.max(0, g.c1 - 1), g.c2 + 1)) { g.r2++; grew = true; }
        if (g.c1 > 0 && scanCol(g.c1 - 1, Math.max(0, g.r1 - 1), g.r2 + 1)) { g.c1--; grew = true; }
        if (scanCol(g.c2 + 1, Math.max(0, g.r1 - 1), g.r2 + 1)) { g.c2++; grew = true; }
      }
      return g;
    }
    applyFilter(sheet) {
      const flt = sheet.filter; const hidden = new Set();
      if (flt) {
        const g = flt.range;
        const b = sheet.bounds();
        for (let r = g.r1 + 1; r <= Math.min(g.r2, b.r); r++) {
          for (const [col, crit] of Object.entries(flt.crit || {})) {
            const v = sheet.value(r, +col);
            if (!filterMatch(crit, v, sheet, r, +col)) { hidden.add(r); break; }
          }
        }
      }
      this.setMeta(sheet, 'filtered', hidden);
    }

    /* ---------- find / replace ---------- */
    find(sheets, query, opts = {}) {
      const out = []; if (query === '') return out;
      const re = buildFindRe(query, opts);
      for (const sh of sheets) {
        const keys = [...sh.cells.keys(), ...sh.spill.keys()].sort((a, b) => opts.byCols ? (a % MAXC - b % MAXC) || a - b : a - b);
        for (const k of keys) {
          const [r, c] = RC(k), cell = sh.cells.get(k);
          const text = opts.inFormulas && cell && cell.f != null ? '=' + cell.f : this.display(sh, r, c).text;
          if (text !== '' && re.test(text)) out.push({ sheet: sh, r, c });
        }
      }
      return out;
    }
    replaceAll(sheets, query, repl, opts = {}) {
      const hits = this.find(sheets, query, Object.assign({}, opts, { inFormulas: true })).filter(h => !opts.only || (h.r === opts.only[0] && h.c === opts.only[1]));
      const re = buildFindRe(query, Object.assign({}, opts, { global: true }));
      let n = 0;
      this.transact('Replace', () => {
        for (const h of hits) {
          const cell = h.sheet.get(h.r, h.c); if (!cell) continue;
          const t = this.editText(h.sheet, h.r, h.c).replace(/^'/, '');
          const nt = opts.whole ? repl : t.replace(re, () => repl);
          if (nt !== t) { this.input(h.sheet, h.r, h.c, nt); n++; }
        }
      });
      return n;
    }

    /* ---------- conditional formatting ---------- */
    cfStats(sheet, rule) {
      if (rule._gen === this.calcGen && rule._sheet === sheet) return rule._stats;
      const g = rule.range, b = sheet.bounds(), vals = [], all = [];
      for (let r = g.r1; r <= Math.min(g.r2, b.r); r++) for (let c = g.c1; c <= Math.min(g.c2, b.c); c++) { const v = sheet.value(r, c); all.push(v); if (typeof v === 'number') vals.push(v); }
      const sorted = vals.slice().sort((a, b2) => a - b2);
      const counts = new Map(); all.forEach(v => { if (v == null || v === '') return; const k = typeof v === 'string' ? v.toLowerCase() : String(v); counts.set(k, (counts.get(k) || 0) + 1); });
      const st = { min: sorted[0], max: sorted[sorted.length - 1], mean: vals.length ? vals.reduce((a, x) => a + x, 0) / vals.length : 0, sorted, counts };
      Object.defineProperty(rule, '_stats', { value: st, writable: true, configurable: true, enumerable: false });
      Object.defineProperty(rule, '_gen', { value: this.calcGen, writable: true, configurable: true, enumerable: false });
      Object.defineProperty(rule, '_sheet', { value: sheet, writable: true, configurable: true, enumerable: false });
      return st;
    }
    // → {fill, color, b, i, st, bar:{pct,color}, icon} merged over all matching rules
    cfFormat(sheet, r, c) {
      if (!sheet.cf.length) return null;
      let out = null;
      for (const rule of sheet.cf) {
        const g = rule.range; if (r < g.r1 || r > g.r2 || c < g.c1 || c > g.c2) continue;
        const v = sheet.value(r, c);
        const res = this.cfRule(sheet, rule, v, r, c);
        if (res) { out = Object.assign(out || {}, res); if (rule.stop) break; }
      }
      return out;
    }
    cfRule(sheet, rule, v, r, c) {
      const sty = () => Object.assign({}, rule.style || {});
      const n = typeof v === 'number' ? v : null;
      const toNum = x => { if (typeof x === 'number') return x; const p = Fmt.parseInput(String(x ?? '')); return typeof p.v === 'number' ? p.v : x; };
      switch (rule.type) {
        case 'cell': {
          if (v == null) return null;
          const a = toNum(rule.v1), b = toNum(rule.v2);
          const cmp = (x, y) => F.compare(x, y);
          const ok = { '>': () => cmp(v, a) > 0, '<': () => cmp(v, a) < 0, '>=': () => cmp(v, a) >= 0, '<=': () => cmp(v, a) <= 0, '=': () => cmp(v, a) === 0, '<>': () => cmp(v, a) !== 0, between: () => cmp(v, Math.min(a, b)) >= 0 && cmp(v, Math.max(a, b)) <= 0, notBetween: () => !(cmp(v, Math.min(a, b)) >= 0 && cmp(v, Math.max(a, b)) <= 0) }[rule.op];
          return ok && ok() ? sty() : null;
        }
        case 'text': { if (v == null) return null; const t = String(typeof v === 'number' ? Fmt.general(v) : v).toLowerCase(), q = String(rule.v1 || '').toLowerCase(); const ok = rule.op === 'begins' ? t.startsWith(q) : rule.op === 'ends' ? t.endsWith(q) : rule.op === 'notContains' ? !t.includes(q) : t.includes(q); return ok ? sty() : null; }
        case 'blank': return (v == null || v === '') === (rule.op !== 'notBlank') ? sty() : null;
        case 'error': return v instanceof FErr ? sty() : null;
        case 'top': {
          if (n == null) return null; const st = this.cfStats(sheet, rule), s = st.sorted; if (!s.length) return null;
          let k = Math.max(1, Math.round(+rule.v1 || 10)); if (rule.pct) k = Math.max(1, Math.floor(s.length * k / 100));
          const thr = rule.bottom ? s[Math.min(k, s.length) - 1] : s[Math.max(0, s.length - k)];
          return (rule.bottom ? n <= thr : n >= thr) ? sty() : null;
        }
        case 'avg': { if (n == null) return null; const st = this.cfStats(sheet, rule); return (rule.op === 'below' ? n < st.mean : n > st.mean) ? sty() : null; }
        case 'dup': { if (v == null || v === '') return null; const st = this.cfStats(sheet, rule); const k = typeof v === 'string' ? v.toLowerCase() : String(v); const d = (st.counts.get(k) || 0) > 1; return (rule.op === 'unique' ? !d : d) ? sty() : null; }
        case 'formula': {
          if (!rule._ast) { try { Object.defineProperty(rule, '_ast', { value: F.parse(rule.v1), writable: true, configurable: true, enumerable: false }); } catch (e) { return null; } }
          const ctx = this.ctx; ctx.sheet = sheet; ctx.r = r; ctx.c = c; ctx.dr = r - rule.range.r1; ctx.dc = c - rule.range.c1; ctx.scope = null;
          let x; try { x = F.scalar(ctx, F.evaluate(rule._ast, ctx)); } catch (e) { x = null; } finally { ctx.dr = 0; ctx.dc = 0; }
          return x === true || (typeof x === 'number' && x !== 0) ? sty() : null;
        }
        case 'scale': {
          if (n == null) return null; const st = this.cfStats(sheet, rule); if (st.min === st.max) return { fill: rule.colors[rule.colors.length - 1] };
          const t = (n - st.min) / (st.max - st.min), cs = rule.colors;
          if (cs.length === 3) return { fill: t < 0.5 ? mixHex(cs[0], cs[1], t * 2) : mixHex(cs[1], cs[2], (t - 0.5) * 2) };
          return { fill: mixHex(cs[0], cs[1], t) };
        }
        case 'bar': {
          if (n == null) return null; const st = this.cfStats(sheet, rule);
          const lo = Math.min(0, st.min), hi = Math.max(0, st.max); if (hi === lo) return null;
          return { bar: { pct: (n - lo) / (hi - lo), zero: -lo / (hi - lo), color: rule.color || '#638ec6', neg: n < 0 } };
        }
        case 'icons': {
          if (n == null) return null; const st = this.cfStats(sheet, rule); if (st.max === st.min) return { icon: 1 };
          const t = (n - st.min) / (st.max - st.min);
          return { icon: t >= 0.67 ? 2 : t >= 0.33 ? 1 : 0, iconSet: rule.set || 'arrows' };
        }
      }
      return null;
    }

    /* ---------- serialisation (.lsheet) ---------- */
    styleTable() { return { list: [], index: new Map() }; }
    styleId(tbl, s) { if (!s) return undefined; const key = JSON.stringify(s); let i = tbl.index.get(key); if (i == null) { i = tbl.list.length; tbl.list.push(s); tbl.index.set(key, i); } return i; }
    sheetJSON(sh, tbl) {
      const cells = [];
      const keys = [...sh.cells.keys()].sort((a, b) => a - b);
      for (const k of keys) {
        const cell = sh.cells.get(k), [r, c] = RC(k);
        let v = cell.v; if (v instanceof FErr) v = { e: v.code };
        const row = [r, c, v === undefined ? null : v];
        const si = this.styleId(tbl, cell.s);
        if (cell.f != null || si != null) row.push(cell.f != null ? cell.f : null);
        if (si != null) row.push(si);
        cells.push(row);
      }
      const o = {
        id: sh.id, name: sh.name, cells,
        colW: Object.fromEntries(sh.colW), rowH: Object.fromEntries(sh.rowH), hiddenRows: [...sh.hiddenRows], hiddenCols: [...sh.hiddenCols], filtered: [...sh.filtered],
        merges: sh.merges.map(m => [m.r1, m.c1, m.r2, m.c2]), freeze: [sh.freeze.r, sh.freeze.c],
        cf: sh.cf, filter: sh.filter, charts: sh.charts, tabColor: sh.tabColor, pivot: sh.pivot, showGrid: sh.showGrid, zoom: sh.zoom
      };
      return { sheet: o, styles: tbl.list };
    }
    toJSON() {
      const tbl = this.styleTable();
      const sheets = this.sheets.map(sh => this.sheetJSON(sh, tbl).sheet);
      return { format: 'lumen-sheets', version: 1, active: this.active, names: [...this.names.values()].map(d => ({ name: d.name, ref: d.ref })), styles: tbl.list, sheets };
    }
    applySheetJSON(sh, o, styles) {
      for (const row of o.cells || []) {
        if (!Array.isArray(row)) continue;
        const [r, c, v0, f, si] = row;
        if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= MAXR || c >= MAXC) continue;
        let v = v0;
        if (v && typeof v === 'object') v = typeof v.e === 'string' ? (F.errOf(v.e) || ERR.VALUE) : null;
        else if (!(typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean')) v = null;
        if (typeof v === 'number' && !Number.isFinite(v)) v = null;
        const cell = { v, s: Number.isInteger(si) && styles[si] ? styles[si] : null };
        if (typeof f === 'string' && f !== '') { cell.f = f.replace(/^=/, '').slice(0, 8192); cell.v = null; }
        sh.cells.set(K(r, c), cell); sh.grow(r, c);
      }
      const nums = (obj, max) => { const m = new Map(); if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) { const i = +k; if (Number.isInteger(i) && i >= 0 && i < max && typeof v === 'number' && v >= 0 && v < 2000) m.set(i, v); } return m; };
      const ints = (a, max) => new Set((Array.isArray(a) ? a : []).filter(i => Number.isInteger(i) && i >= 0 && i < max));
      sh.colW = nums(o.colW, MAXC); sh.rowH = nums(o.rowH, MAXR); sh.hiddenRows = ints(o.hiddenRows, MAXR); sh.hiddenCols = ints(o.hiddenCols, MAXC); sh.filtered = ints(o.filtered, MAXR);
      sh.merges = (Array.isArray(o.merges) ? o.merges : []).filter(m => Array.isArray(m) && m.length === 4 && m.every(Number.isInteger)).map(([r1, c1, r2, c2]) => ({ r1, c1, r2, c2 })).filter(m => m.r1 >= 0 && m.c1 >= 0 && m.r2 >= m.r1 && m.c2 >= m.c1);
      const fz = Array.isArray(o.freeze) ? o.freeze : [0, 0]; sh.freeze = { r: Math.max(0, Math.min(1000, fz[0] | 0)), c: Math.max(0, Math.min(200, fz[1] | 0)) };
      sh.cf = sanitizeCF(o.cf); sh.filter = sanitizeFilter(o.filter); sh.charts = sanitizeCharts(o.charts);
      sh.tabColor = isColor(o.tabColor) ? o.tabColor : null; sh.pivot = sanitizePivot(o.pivot);
      sh.showGrid = o.showGrid !== false; sh.zoom = typeof o.zoom === 'number' && o.zoom >= 0.25 && o.zoom <= 4 ? o.zoom : 1;
      sh._mergeIdx = null;
    }
    restore(js) {
      const styles = (Array.isArray(js.styles) ? js.styles : []).map(sanitizeStyle);
      // reuse Sheet objects (matched by id) so references held by the UI stay valid across undo/redo
      const existing = new Map(this.sheets.map(s => [s.id, s]));
      this.sheets = [];
      (Array.isArray(js.sheets) ? js.sheets : []).forEach((o, i) => {
        o = o || {};
        let name = String(o.name || 'Sheet' + (i + 1)).slice(0, 31) || 'Sheet' + (i + 1);
        if (this.sheetByName(name)) name = this.uniqueName(name);
        let sh = Number.isInteger(o.id) ? existing.get(o.id) : null;
        if (sh) { existing.delete(o.id); sh.reset(); sh.name = name; this.sheets.push(sh); }
        else { sh = this.addSheetRaw(name); if (Number.isInteger(o.id) && o.id > 0 && !this.sheets.some(x => x !== sh && x.id === o.id)) { sh.id = o.id; if (o.id >= sheetSeq) sheetSeq = o.id + 1; } }
        this.applySheetJSON(sh, o, styles);
      });
      if (!this.sheets.length) this.addSheetRaw('Sheet1');
      this.names = new Map();
      (Array.isArray(js.names) ? js.names : []).forEach(d => { if (d && typeof d.name === 'string' && typeof d.ref === 'string' && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(d.name)) this.names.set(d.name.toUpperCase(), { name: d.name, ref: d.ref.replace(/^=/, '') }); });
      this.active = Math.max(0, Math.min(this.sheets.length - 1, js.active | 0));
      this.rebuildGraph(); this.recalc();
    }
    static fromJSON(js) {
      if (!js || js.format !== 'lumen-sheets') throw new Error('Not a Lumen Sheets file');
      const wb = new Workbook(); wb.restore(js); wb.undoStack = []; wb.redoStack = []; return wb;
    }
    // used range of a sheet
    usedRange(sheet) { const b = sheet.bounds(); return b.r < 0 ? null : { r1: 0, c1: 0, r2: b.r, c2: b.c }; }
  }

  /* ---------- helpers ---------- */
  function sameVal(a, b) {
    if (a === b) return true;
    if (a instanceof FErr && b instanceof FErr) return a.code === b.code;
    if (Array.isArray(a) || Array.isArray(b)) return false;
    return false;
  }
  function mixHex(a, b, t) {
    t = Math.max(0, Math.min(1, t));
    const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)), x = p(a), y = p(b);
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  const isColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  const BORDER_STYLES = ['thin', 'medium', 'thick', 'dashed', 'dotted', 'double', 'hair'];
  function sanitizeStyle(s) {
    if (!s || typeof s !== 'object') return null;
    const o = {};
    ['b', 'i', 'u', 'st', 'wrap'].forEach(k => { if (s[k]) o[k] = 1; });
    if (typeof s.font === 'string' && /^[\w \-]{1,40}$/.test(s.font)) o.font = s.font;
    if (typeof s.sz === 'number' && s.sz >= 4 && s.sz <= 96) o.sz = s.sz;
    ['color', 'fill'].forEach(k => { if (isColor(s[k])) o[k] = s[k]; });
    if (['left', 'center', 'right'].includes(s.ha)) o.ha = s.ha;
    if (['top', 'middle', 'bottom'].includes(s.va)) o.va = s.va;
    if (typeof s.nf === 'string' && s.nf.length < 200) o.nf = s.nf;
    if (Number.isInteger(s.indent) && s.indent > 0 && s.indent < 16) o.indent = s.indent;
    ['bt', 'bb', 'bl', 'br'].forEach(k => { const b = s[k]; if (b && BORDER_STYLES.includes(b.style)) o[k] = { style: b.style, color: isColor(b.color) ? b.color : '#000000' }; });
    return Object.keys(o).length ? o : null;
  }
  const isRange = g => g && [g.r1, g.c1, g.r2, g.c2].every(x => Number.isInteger(x) && x >= 0) && g.r2 >= g.r1 && g.c2 >= g.c1 && g.r2 < MAXR && g.c2 < MAXC;
  const CF_TYPES = ['cell', 'text', 'blank', 'error', 'top', 'avg', 'dup', 'formula', 'scale', 'bar', 'icons'];
  function sanitizeCF(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(x => x && CF_TYPES.includes(x.type) && isRange(x.range)).map(x => {
      const o = { type: x.type, range: { r1: x.range.r1, c1: x.range.c1, r2: x.range.r2, c2: x.range.c2 } };
      if (typeof x.op === 'string' && x.op.length < 20) o.op = x.op;
      ['v1', 'v2'].forEach(k => { if (typeof x[k] === 'string' || typeof x[k] === 'number') o[k] = typeof x[k] === 'string' ? x[k].slice(0, 2000) : x[k]; });
      if (x.style) o.style = sanitizeStyle(x.style) || {};
      if (Array.isArray(x.colors) && x.colors.every(isColor) && (x.colors.length === 2 || x.colors.length === 3)) o.colors = x.colors.slice();
      if (o.type === 'scale' && !o.colors) o.colors = ['#f8696b', '#63be7b'];
      if (isColor(x.color)) o.color = x.color;
      if (x.bottom) o.bottom = true; if (x.pct) o.pct = true; if (x.stop) o.stop = true;
      if (['arrows', 'traffic', 'flags'].includes(x.set)) o.set = x.set;
      return o;
    });
  }
  function sanitizeFilter(f) {
    if (!f || !isRange(f.range)) return null;
    const crit = {};
    if (f.crit && typeof f.crit === 'object') for (const [k, v] of Object.entries(f.crit)) {
      if (!/^\d+$/.test(k) || !v || typeof v !== 'object') continue;
      const o = {};
      if (Array.isArray(v.values)) o.values = v.values.filter(x => typeof x === 'string').slice(0, 100000);
      if (typeof v.op === 'string' && v.op.length < 12) o.op = v.op;
      if (typeof v.v1 === 'string' || typeof v.v1 === 'number') o.v1 = v.v1;
      if (typeof v.v2 === 'string' || typeof v.v2 === 'number') o.v2 = v.v2;
      crit[k] = o;
    }
    const o = { range: { ...f.range }, crit };
    if (f.sort && Number.isInteger(f.sort.col)) o.sort = { col: f.sort.col, asc: !!f.sort.asc };
    return o;
  }
  const CHART_TYPES = ['column', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter'];
  function sanitizeCharts(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(c => c && CHART_TYPES.includes(c.type) && typeof c.range === 'string').slice(0, 200).map(c => ({
      id: typeof c.id === 'string' ? c.id.slice(0, 20) : Math.random().toString(36).slice(2, 10), type: c.type, range: c.range.slice(0, 300),
      title: typeof c.title === 'string' ? c.title.slice(0, 200) : '', x: num0(c.x, 100), y: num0(c.y, 60), w: Math.max(120, num0(c.w, 480)), h: Math.max(90, num0(c.h, 300)),
      byRow: !!c.byRow, stacked: !!c.stacked, legend: c.legend !== false, labels: !!c.labels, smooth: !!c.smooth
    }));
  }
  function sanitizePivot(p) {
    if (!p || typeof p !== 'object' || typeof p.src !== 'string') return null;
    const s = v => typeof v === 'string' ? v.slice(0, 200) : null;
    return { src: p.src.slice(0, 300), rows: s(p.rows), cols: s(p.cols), val: s(p.val), agg: ['sum', 'count', 'average', 'min', 'max'].includes(p.agg) ? p.agg : 'sum' };
  }
  const num0 = (v, d) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 1e7 ? v : d;
  function buildFindRe(q, o) {
    let src = q.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/~\*/g, '\u0001').replace(/~\?/g, '\u0002').replace(/\*/g, '[\\s\\S]*').replace(/\?/g, '[\\s\\S]').replace(/\u0001/g, '\\*').replace(/\u0002/g, '\\?');
    if (o.whole) src = '^' + src + '$';
    return new RegExp(src, (o.matchCase ? '' : 'i') + (o.global ? 'g' : ''));
  }
  function filterMatch(crit, v, sheet, r, c) {
    if (crit.values) {
      const t = v == null || v === '' ? '' : sheet.wb.display(sheet, r, c).text;
      return crit.values.includes(t);
    }
    if (crit.op) {
      const p = x => { const y = Fmt.parseInput(String(x ?? '')); return typeof y.v === 'number' ? y.v : String(x ?? '').toLowerCase(); };
      const a = p(crit.v1), b = p(crit.v2), x = typeof v === 'string' ? v.toLowerCase() : v;
      switch (crit.op) {
        case '>': return typeof x === typeof a && x > a; case '<': return typeof x === typeof a && x < a;
        case '>=': return typeof x === typeof a && x >= a; case '<=': return typeof x === typeof a && x <= a;
        case '=': return x === a; case '<>': return x !== a;
        case 'between': return typeof x === 'number' && x >= Math.min(a, b) && x <= Math.max(a, b);
        case 'contains': return String(x ?? '').toLowerCase().includes(String(crit.v1).toLowerCase());
        case 'notContains': return !String(x ?? '').toLowerCase().includes(String(crit.v1).toLowerCase());
        case 'begins': return String(x ?? '').toLowerCase().startsWith(String(crit.v1).toLowerCase());
        case 'top': { const vals = []; const g = sheet.filter.range; for (let rr = g.r1 + 1; rr <= g.r2; rr++) { const y = sheet.value(rr, c); if (typeof y === 'number') vals.push(y); } vals.sort((p1, p2) => p2 - p1); const k = Math.max(1, +crit.v1 || 10); return typeof v === 'number' && v >= vals[Math.min(k, vals.length) - 1]; }
        case 'aboveAvg': case 'belowAvg': { let s = 0, n = 0; const g = sheet.filter.range; for (let rr = g.r1 + 1; rr <= g.r2; rr++) { const y = sheet.value(rr, c); if (typeof y === 'number') { s += y; n++; } } const m = n ? s / n : 0; return typeof v === 'number' && (crit.op === 'aboveAvg' ? v > m : v < m); }
      }
    }
    return true;
  }
  // fill series generator from the source cells of one line; returns k → value or null (plain copy)
  const MONTHS = Fmt.MONTHS, DAYS = Fmt.DAYS;
  function fillSeries(cells) {
    const n = cells.length;
    if (!cells.every(c => c && c.f == null && c.v != null)) return null;
    const vals = cells.map(c => c.v);
    if (vals.every(v => typeof v === 'number')) {
      const isDate = cells[0].s && cells[0].s.nf && Fmt.isDateFormat(cells[0].s.nf);
      if (n === 1) return isDate ? (k => vals[0] + k) : null;
      if (isDate && n >= 2 && vals.every((v, i) => !i || v - vals[i - 1] === vals[1] - vals[0])) {
        // monthly / yearly steps when the source steps by whole months on the same day
        const p = vals.map(v => Fmt.serialToParts(v));
        const months = (p[1].y - p[0].y) * 12 + p[1].m - p[0].m;
        if (p.every(x => x.d === p[0].d) && months !== 0 && p.every((x, i) => !i || (x.y - p[i - 1].y) * 12 + x.m - p[i - 1].m === months)) {
          return k => { const m = p[0].m - 1 + months * k; const y = p[0].y + Math.floor(m / 12), mm = ((m % 12) + 12) % 12 + 1; const last = new Date(Date.UTC(y, mm, 0)).getUTCDate(); return Fmt.dateToSerial(y, mm, Math.min(p[0].d, last)); };
        }
      }
      // least-squares linear trend (equals the constant step for arithmetic series)
      const xm = (n - 1) / 2, ym = vals.reduce((a, b) => a + b, 0) / n;
      let sxy = 0, sxx = 0; vals.forEach((v, i) => { sxy += (i - xm) * (v - ym); sxx += (i - xm) ** 2; });
      const slope = sxy / sxx, icpt = ym - slope * xm;
      return k => parseFloat((icpt + slope * k).toPrecision(15));
    }
    if (vals.every(v => typeof v === 'string')) {
      const lists = [MONTHS, MONTHS.map(m => m.slice(0, 3)), DAYS, DAYS.map(d => d.slice(0, 3))];
      for (const L of lists) {
        const idx = vals.map(v => L.findIndex(x => x.toLowerCase() === v.toLowerCase()));
        if (idx.every(i => i >= 0)) {
          const step = n > 1 ? ((idx[1] - idx[0]) % L.length + L.length) % L.length || 1 : 1;
          const cased = s => vals[0] === vals[0].toUpperCase() ? s.toUpperCase() : vals[0] === vals[0].toLowerCase() ? s.toLowerCase() : s;
          return k => cased(L[(((idx[0] + step * k) % L.length) + L.length) % L.length]);
        }
      }
      const m = vals.map(v => /^(.*?)(\d+)(\D*)$/.exec(v));
      if (m.every(x => x) && m.every(x => x[1] === m[0][1] && x[3] === m[0][3])) {
        const nums = m.map(x => +x[2]), width = m[0][2].length;
        const step = n > 1 ? nums[1] - nums[0] : 1;
        if (n === 1 || nums.every((x, i) => !i || x - nums[i - 1] === step)) {
          const quarter = /^Q$/i.test(m[0][1]) && nums.every(x => x >= 1 && x <= 4);
          return k => { let v = nums[0] + step * k; if (quarter) v = ((v - 1) % 4 + 4) % 4 + 1; if (v < 0) return m[0][1] + v + m[0][3]; return m[0][1] + String(v).padStart(width, '0') + m[0][3]; };
        }
      }
    }
    return null;
  }

  const API = { Workbook, Sheet, K, RC, cloneCell, fillSeries, mixHex, sanitizeStyle, sanitizeCF, sanitizeCharts, isColor };
  if (isNode) module.exports = Object.assign(API, { F }); else root.SheetModel = API;
})(typeof self !== 'undefined' ? self : this);
