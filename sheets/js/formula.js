'use strict';
/* Lumen Sheets — formula language: tokenizer, parser (AST), evaluator and reference rewriting.
   Formulas are parsed and interpreted here; nothing from a document is ever turned into JavaScript.
   Browser: window.Formula. Node: module.exports. Functions live in functions.js (Formula.FN). */
(function (root) {
  const MAXR = 1048576, MAXC = 16384;

  /* ---------- values ---------- */
  class FErr { constructor(code) { this.code = code; } toString() { return this.code; } }
  const ERR = {};
  ['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#SPILL!', '#CALC!', '#CIRC!'].forEach(c => {
    ERR[c.replace(/[#!?/]/g, '').replace('N/A', 'NA').replace('DIV0', 'DIV0')] = new FErr(c);
  });
  ERR.NA = ERR.NA || ERR['NA']; ERR.DIV0 = ERR.DIV0;
  const errOf = code => Object.values(ERR).find(e => e.code === String(code).toUpperCase()) || null;
  const isErr = v => v instanceof FErr;
  // A rectangular reference into a sheet (sheet is the model's sheet object)
  class Ref {
    constructor(sheet, r1, c1, r2, c2) { this.sheet = sheet; this.r1 = r1; this.c1 = c1; this.r2 = r2; this.c2 = c2; }
    get rows() { return this.r2 - this.r1 + 1; }
    get cols() { return this.c2 - this.c1 + 1; }
    get single() { return this.r1 === this.r2 && this.c1 === this.c2; }
  }
  // Thrown when evaluation needs a cell that has not been recalculated yet (handled by the model)
  class Need { constructor(sheet, key) { this.sheet = sheet; this.key = key; } }

  /* ---------- addresses ---------- */
  function colName(c) { let s = ''; c++; while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - 1 - m) / 26; } return s; }
  function colIndex(s) { let c = 0; s = s.toUpperCase(); for (let i = 0; i < s.length; i++) c = c * 26 + (s.charCodeAt(i) - 64); return c - 1; }
  const addr = (r, c) => colName(c) + (r + 1);
  function parseAddr(s) {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(s).trim()); if (!m) return null;
    const c = colIndex(m[1]), r = +m[2] - 1; if (c >= MAXC || r < 0 || r >= MAXR) return null; return { r, c };
  }
  function quoteSheet(name) { return /^[A-Za-z_][A-Za-z0-9_.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) && !/^(TRUE|FALSE)$/i.test(name) ? name : "'" + name.replace(/'/g, "''") + "'"; }
  // parse "A1", "A1:B5", "Sheet 2!A1:B3", "A:C", "3:5" → {sheet, r1,c1,r2,c2} (sheet name or null)
  function parseRange(text) {
    const toks = tokenize(String(text).trim());
    if (toks.length !== 1 || toks[0].t !== 'ref') return null;
    const x = toks[0]; return { sheet: x.sheet, r1: x.r1, c1: x.c1, r2: x.r2, c2: x.c2, kind: x.kind };
  }
  function rangeText(r, sheetName) {
    const pre = sheetName ? quoteSheet(sheetName) + '!' : '';
    if (r.r1 === r.r2 && r.c1 === r.c2) return pre + addr(r.r1, r.c1);
    return pre + addr(r.r1, r.c1) + ':' + addr(r.r2, r.c2);
  }

  /* ---------- tokenizer ---------- */
  const ERRLIT = /^(#NULL!|#DIV\/0!|#VALUE!|#REF!|#NAME\?|#NUM!|#N\/A|#SPILL!|#CALC!|#CIRC!|#GETTING_DATA)/i;
  const SHEETPRE = /^(?:'((?:[^']|'')+)'|([A-Za-z0-9_.À-￿]+))!/;
  const CELL = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(.])/;
  const CELLRANGE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7}):(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})(?![A-Za-z0-9_(.])/;
  const COLRANGE = /^(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})(?![A-Za-z0-9_(.!])/;
  const ROWRANGE = /^(\$?)(\d{1,7}):(\$?)(\d{1,7})(?![A-Za-z0-9_(.])/;
  const IDENT = /^[A-Za-z_\\À-￿][A-Za-z0-9_.\\À-￿]*/;
  function okCell(c, r) { return c < MAXC && r >= 0 && r < MAXR; }
  function matchRef(s) {
    let m;
    if ((m = CELLRANGE.exec(s))) {
      const c1 = colIndex(m[2]), r1 = +m[4] - 1, c2 = colIndex(m[6]), r2 = +m[8] - 1;
      if (okCell(c1, r1) && okCell(c2, r2)) return { len: m[0].length, kind: 'cells', r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: Math.min(c1, c2), c2: Math.max(c1, c2), ac1: !!(c1 <= c2 ? m[1] : m[5]), ar1: !!(r1 <= r2 ? m[3] : m[7]), ac2: !!(c1 <= c2 ? m[5] : m[1]), ar2: !!(r1 <= r2 ? m[7] : m[3]) };
    }
    if ((m = CELL.exec(s))) {
      const c = colIndex(m[2]), r = +m[4] - 1;
      if (okCell(c, r)) return { len: m[0].length, kind: 'cell', r1: r, r2: r, c1: c, c2: c, ac1: !!m[1], ar1: !!m[3], ac2: !!m[1], ar2: !!m[3] };
    }
    if ((m = COLRANGE.exec(s))) {
      const c1 = colIndex(m[2]), c2 = colIndex(m[4]);
      if (c1 < MAXC && c2 < MAXC) return { len: m[0].length, kind: 'cols', r1: 0, r2: MAXR - 1, c1: Math.min(c1, c2), c2: Math.max(c1, c2), ac1: !!m[1], ac2: !!m[3], ar1: true, ar2: true };
    }
    if ((m = ROWRANGE.exec(s))) {
      const r1 = +m[2] - 1, r2 = +m[4] - 1;
      if (r1 >= 0 && r2 >= 0 && r1 < MAXR && r2 < MAXR) return { len: m[0].length, kind: 'rows', r1: Math.min(r1, r2), r2: Math.max(r1, r2), c1: 0, c2: MAXC - 1, ar1: !!m[1], ar2: !!m[3], ac1: true, ac2: true };
    }
    return null;
  }
  class ParseError extends Error { }
  function tokenize(src) {
    const toks = []; let i = 0;
    const push = (t, v, start, extra) => toks.push(Object.assign({ t, v, s: start, e: i }, extra));
    while (i < src.length) {
      const ch = src[i], rest = src.slice(i), start = i;
      if (/\s/.test(ch)) { i++; continue; }
      let m;
      if (ch === '"') {
        let j = i + 1, s = '';
        for (; ;) { if (j >= src.length) throw new ParseError('Missing closing quote'); if (src[j] === '"') { if (src[j + 1] === '"') { s += '"'; j += 2; continue; } break; } s += src[j++]; }
        i = j + 1; push('str', s, start); continue;
      }
      if ((m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(rest)) && !ROWRANGE.exec(rest)) {
        // a number unless it is followed by letters making it a name (rare)
        i += m[0].length; push('num', parseFloat(m[0]), start); continue;
      }
      if ((m = ERRLIT.exec(rest))) { i += m[0].length; push('err', m[0].toUpperCase(), start); continue; }
      // sheet-qualified reference
      if ((m = SHEETPRE.exec(rest))) {
        const sheet = m[1] != null ? m[1].replace(/''/g, "'") : m[2];
        const r = matchRef(rest.slice(m[0].length));
        if (r) { i += m[0].length + r.len; push('ref', null, start, Object.assign(r, { sheet })); continue; }
        if (/^#REF!/i.test(rest.slice(m[0].length))) { i += m[0].length + 5; push('err', '#REF!', start); continue; }
      }
      if (/[A-Za-z$0-9]/.test(ch)) {
        const r = matchRef(rest);
        if (r) {
          // e.g. LOG10( is a function, not cell LOG10
          const after = rest.slice(r.len);
          if (!(r.kind === 'cell' && /^\s*\(/.test(after))) { i += r.len; push('ref', null, start, Object.assign(r, { sheet: null })); continue; }
        }
      }
      if ((m = IDENT.exec(rest))) {
        i += m[0].length;
        const name = m[0];
        if (/^\s*\(/.test(src.slice(i))) push('fn', name.toUpperCase().replace(/^(_XLFN\.)?(_XLWS\.)?/, ''), start);
        else if (/^(TRUE|FALSE)$/i.test(name)) push('bool', /^TRUE$/i.test(name), start);
        else push('name', name, start);
        continue;
      }
      if ((m = /^(<>|<=|>=|[-+*/^&=<>%(),;:{}])/.exec(rest))) { i += m[0].length; push('op', m[0], start); continue; }
      if (ch === '@') { i++; continue; } // implicit-intersection operator: ignored
      throw new ParseError('Unexpected character ' + ch);
    }
    return toks;
  }

  /* ---------- parser ---------- */
  function parse(src) {
    src = String(src);
    if (src[0] === '=') src = src.slice(1);
    const toks = tokenize(src); let p = 0;
    const peek = () => toks[p], next = () => toks[p++];
    const isOp = (v) => { const t = toks[p]; return t && t.t === 'op' && t.v === v; };
    const expect = v => { if (!isOp(v)) throw new ParseError(`Expected ${v}`); p++; };
    function expr() { return comparison(); }
    function comparison() { let a = concat(); while (peek() && peek().t === 'op' && /^(=|<>|<|>|<=|>=)$/.test(peek().v)) { const op = next().v; a = { t: 'bin', op, a, b: concat() }; } return a; }
    function concat() { let a = additive(); while (isOp('&')) { next(); a = { t: 'bin', op: '&', a, b: additive() }; } return a; }
    function additive() { let a = mult(); while (isOp('+') || isOp('-')) { const op = next().v; a = { t: 'bin', op, a, b: mult() }; } return a; }
    function mult() { let a = power(); while (isOp('*') || isOp('/')) { const op = next().v; a = { t: 'bin', op, a, b: power() }; } return a; }
    function power() { let a = unary(); while (isOp('^')) { next(); a = { t: 'bin', op: '^', a, b: unary() }; } return a; }
    function unary() { if (isOp('-')) { next(); return { t: 'neg', a: unary() }; } if (isOp('+')) { next(); return unary(); } return postfix(); }
    function postfix() { let a = rangeOp(); while (isOp('%')) { next(); a = { t: 'pct', a }; } return a; }
    function rangeOp() { let a = primary(); while (isOp(':')) { next(); a = { t: 'bin', op: ':', a, b: primary() }; } return a; }
    function primary() {
      const t = next();
      if (!t) throw new ParseError('Unexpected end of formula');
      switch (t.t) {
        case 'num': return { t: 'num', v: t.v };
        case 'str': return { t: 'str', v: t.v };
        case 'bool': return { t: 'bool', v: t.v };
        case 'err': return { t: 'err', v: errOf(t.v) || ERR.REF };
        case 'ref': return { t: 'ref', sheet: t.sheet, kind: t.kind, r1: t.r1, c1: t.c1, r2: t.r2, c2: t.c2, ar1: t.ar1, ac1: t.ac1, ar2: t.ar2, ac2: t.ac2 };
        case 'name': return { t: 'name', name: t.v };
        case 'fn': {
          expect('('); const args = [];
          if (isOp(')')) { next(); return { t: 'fn', name: t.v, args }; }
          for (; ;) {
            if (isOp(',') || isOp(')')) args.push({ t: 'missing' }); else args.push(expr());
            if (isOp(',')) { next(); continue; }
            expect(')'); break;
          }
          return { t: 'fn', name: t.v, args };
        }
        case 'op':
          if (t.v === '(') { const e = expr(); expect(')'); return e; }
          if (t.v === '{') {
            const rows = [[]];
            for (; ;) {
              let neg = false; if (isOp('-')) { next(); neg = true; }
              const x = next(); if (!x) throw new ParseError('Bad array');
              let v = x.t === 'num' ? (neg ? -x.v : x.v) : x.t === 'str' ? x.v : x.t === 'bool' ? x.v : x.t === 'err' ? errOf(x.v) : undefined;
              if (v === undefined) throw new ParseError('Array constants may only hold values');
              rows[rows.length - 1].push(v);
              if (isOp(',')) { next(); continue; }
              if (isOp(';')) { next(); rows.push([]); continue; }
              expect('}'); break;
            }
            if (rows.some(r => r.length !== rows[0].length)) throw new ParseError('Array rows differ in length');
            return { t: 'arr', v: rows };
          }
      }
      throw new ParseError('Unexpected ' + (t.v ?? t.t));
    }
    if (!toks.length) throw new ParseError('Empty formula');
    const ast = expr();
    if (p < toks.length) throw new ParseError('Unexpected ' + (toks[p].v ?? toks[p].t));
    return ast;
  }

  /* ---------- static analysis ---------- */
  // walk AST collecting references → [{sheet:name|null, r1,c1,r2,c2}], names, volatile flag
  function analyse(ast) {
    const refs = [], names = []; let vol = false;
    (function walk(n) {
      if (!n) return;
      switch (n.t) {
        case 'ref': refs.push(n); break;
        case 'name': names.push(n.name); break;
        case 'fn': { const f = FN[n.name]; if (f && f.vol) vol = true; n.args.forEach(walk); break; }
        case 'bin': walk(n.a); walk(n.b); break;
        case 'neg': case 'pct': walk(n.a); break;
      }
    })(ast);
    return { refs, names, vol };
  }

  /* ---------- reference rewriting (fill, copy, insert/delete, rename) ---------- */
  function refTokText(x) {
    const pre = x.sheet != null ? quoteSheet(x.sheet) + '!' : '';
    const C = (c, a) => (a ? '$' : '') + colName(c), R = (r, a) => (a ? '$' : '') + (r + 1);
    if (x.kind === 'cols') return pre + C(x.c1, x.ac1) + ':' + C(x.c2, x.ac2);
    if (x.kind === 'rows') return pre + R(x.r1, x.ar1) + ':' + R(x.r2, x.ar2);
    if (x.kind === 'cell') return pre + C(x.c1, x.ac1) + R(x.r1, x.ar1);
    return pre + C(x.c1, x.ac1) + R(x.r1, x.ar1) + ':' + C(x.c2, x.ac2) + R(x.r2, x.ar2);
  }
  // fn(ref) → new ref object | null (→ #REF!) | undefined (unchanged). Also rewrites sheet names via opts.renameSheet.
  function mapRefs(text, fn) {
    const hasEq = text[0] === '=', src = hasEq ? text.slice(1) : text;
    let toks; try { toks = tokenize(src); } catch (e) { return text; }
    let out = '', pos = 0, changed = false;
    for (const t of toks) {
      if (t.t !== 'ref') continue;
      const r = fn({ sheet: t.sheet, kind: t.kind, r1: t.r1, c1: t.c1, r2: t.r2, c2: t.c2, ar1: t.ar1, ac1: t.ac1, ar2: t.ar2, ac2: t.ac2 });
      if (r === undefined) continue;
      changed = true;
      out += src.slice(pos, t.s) + (r === null ? (t.sheet != null ? quoteSheet(t.sheet) + '!' : '') + '#REF!' : refTokText(r));
      pos = t.e;
    }
    if (!changed) return text;
    return (hasEq ? '=' : '') + out + src.slice(pos);
  }
  // shift relative references by (dr, dc) — used by fill handle and copy/paste
  function shiftFormula(text, dr, dc) {
    if (!dr && !dc) return text;
    return mapRefs(text, x => {
      const y = { ...x };
      if (x.kind !== 'cols') { if (!x.ar1) y.r1 += dr; if (!x.ar2) y.r2 += dr; }
      if (x.kind !== 'rows') { if (!x.ac1) y.c1 += dc; if (!x.ac2) y.c2 += dc; }
      if (y.r1 < 0 || y.r2 < 0 || y.c1 < 0 || y.c2 < 0 || y.r1 >= MAXR || y.r2 >= MAXR || y.c1 >= MAXC || y.c2 >= MAXC) return null;
      if (x.kind === 'cells' || x.kind === 'cell') { if (y.r1 > y.r2) { [y.r1, y.r2] = [y.r2, y.r1]; [y.ar1, y.ar2] = [y.ar2, y.ar1]; } if (y.c1 > y.c2) { [y.c1, y.c2] = [y.c2, y.c1]; [y.ac1, y.ac2] = [y.ac2, y.ac1]; } }
      return y;
    });
  }
  // insert (n>0) or delete (n<0) rows/cols at index `at` in the sheet the predicate selects
  function adjustForInsert(text, isTarget, axis, at, n) {
    return mapRefs(text, x => {
      if (!isTarget(x.sheet)) return undefined;
      const y = { ...x };
      const k1 = axis === 'row' ? 'r1' : 'c1', k2 = axis === 'row' ? 'r2' : 'c2';
      if ((axis === 'row' && x.kind === 'cols') || (axis === 'col' && x.kind === 'rows')) return undefined;
      if (n > 0) {
        if (y[k1] >= at) y[k1] += n;
        if (y[k2] >= at) y[k2] += n;
        const max = axis === 'row' ? MAXR : MAXC;
        if (y[k1] >= max) return null; if (y[k2] >= max) y[k2] = max - 1;
      } else {
        const d = -n, end = at + d; // deleted [at, end)
        const m = v => v < at ? v : v >= end ? v - d : -1;
        let a = m(y[k1]), b = m(y[k2]);
        if (a < 0 && b < 0 && x[k1] >= at && x[k2] < end) return null;
        if (a < 0) a = at; if (b < 0) b = at - 1;
        if (b < a) return null;
        y[k1] = a; y[k2] = b;
      }
      if (y.kind === 'cell' && (y.r1 !== y.r2 || y.c1 !== y.c2)) y.kind = 'cells';
      return JSON.stringify(y) === JSON.stringify(x) ? undefined : y;
    });
  }
  function renameSheetIn(text, oldName, newName) {
    return mapRefs(text, x => x.sheet != null && x.sheet.toLowerCase() === oldName.toLowerCase() ? { ...x, sheet: newName } : undefined);
  }

  /* ---------- evaluator ---------- */
  const FN = Object.create(null);
  function num(v) {
    if (typeof v === 'number') return v;
    if (v == null) return 0;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof FErr) throw v;
    if (typeof v === 'string') {
      const s = v.trim(); if (s === '') throw ERR.VALUE;
      const P = Formula.parseInput; if (P) { const r = P(s); if (typeof r.v === 'number') return r.v; }
      const x = Number(s); if (!isNaN(x)) return x;
    }
    throw ERR.VALUE;
  }
  function str(v) {
    if (typeof v === 'string') return v;
    if (v == null) return '';
    if (typeof v === 'number') return Formula.numToText ? Formula.numToText(v) : String(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    if (v instanceof FErr) throw v;
    return String(v);
  }
  function bool(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (v == null) return false;
    if (v instanceof FErr) throw v;
    if (typeof v === 'string') { if (/^true$/i.test(v)) return true; if (/^false$/i.test(v)) return false; }
    throw ERR.VALUE;
  }
  // Excel ordering: numbers < text < booleans; blanks act as 0 / "" / FALSE
  function typeRank(v) { return typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 0; }
  function compare(a, b) {
    if (a == null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
    if (b == null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
    const ta = typeRank(a), tb = typeRank(b);
    if (ta !== tb) return ta - tb;
    if (typeof a === 'string') { const x = a.toLowerCase(), y = b.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; }
    if (typeof a === 'boolean') return (a ? 1 : 0) - (b ? 1 : 0);
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function binop(op, a, b) {
    if (a instanceof FErr) return a; if (b instanceof FErr) return b;
    try {
      switch (op) {
        case '+': return fin(num(a) + num(b));
        case '-': return fin(num(a) - num(b));
        case '*': return fin(num(a) * num(b));
        case '/': { const d = num(b); if (d === 0) return ERR.DIV0; return fin(num(a) / d); }
        case '^': { const x = num(a), y = num(b); if (x === 0 && y === 0) return ERR.NUM; if (x === 0 && y < 0) return ERR.DIV0; return fin(Math.pow(x, y)); }
        case '&': return str(a) + str(b);
        case '=': return compare(a, b) === 0;
        case '<>': return compare(a, b) !== 0;
        case '<': return compare(a, b) < 0;
        case '>': return compare(a, b) > 0;
        case '<=': return compare(a, b) <= 0;
        case '>=': return compare(a, b) >= 0;
      }
    } catch (e) { if (e instanceof FErr) return e; throw e; }
    return ERR.VALUE;
  }
  function fin(x) { return Number.isFinite(x) ? x : ERR.NUM; }

  // materialise a value: Ref → scalar (single) or matrix; arrays unchanged
  function refValue(ctx, ref, r, c) { return ctx.value(ref.sheet, r, c); }
  function toMatrix(ctx, v) {
    if (v instanceof Ref) {
      const b = ctx.bounds(v.sheet), r2 = Math.min(v.r2, b.r), c2 = Math.min(v.c2, b.c);
      const out = [];
      for (let r = v.r1; r <= r2; r++) { const row = []; for (let c = v.c1; c <= c2; c++) row.push(ctx.value(v.sheet, r, c)); out.push(row); }
      if (!out.length || !out[0].length) {
        // reference entirely beyond the used area → blanks of the right shape (bounded)
        const rows = Math.min(v.rows, Math.max(1, b.r - v.r1 + 1, 1)), cols = Math.min(v.cols, 1 + Math.max(0, b.c - v.c1));
        return Array.from({ length: Math.max(1, Math.min(rows, v.rows)) }, () => new Array(Math.max(1, Math.min(cols, v.cols))).fill(null));
      }
      return out;
    }
    if (Array.isArray(v)) return v;
    return [[v]];
  }
  // full-shape matrix (no clamping) — used where exact dimensions matter and the range is small
  function toFullMatrix(ctx, v, limit = 2e6) {
    if (!(v instanceof Ref)) return toMatrix(ctx, v);
    if (v.rows * v.cols > limit) return toMatrix(ctx, v);
    const out = [];
    for (let r = v.r1; r <= v.r2; r++) { const row = []; for (let c = v.c1; c <= v.c2; c++) row.push(ctx.value(v.sheet, r, c)); out.push(row); }
    return out;
  }
  function scalar(ctx, v) {
    if (v instanceof Ref) {
      if (v.single) { const x = ctx.value(v.sheet, v.r1, v.c1); return x; }
      // implicit intersection with the formula's row/column
      if (v.c1 === v.c2 && ctx.r >= v.r1 && ctx.r <= v.r2) return ctx.value(v.sheet, ctx.r, v.c1);
      if (v.r1 === v.r2 && ctx.c >= v.c1 && ctx.c <= v.c2) return ctx.value(v.sheet, v.r1, ctx.c);
      return ERR.VALUE;
    }
    if (Array.isArray(v)) return v[0][0];
    return v;
  }
  const isArrayish = v => Array.isArray(v) || (v instanceof Ref && !v.single);
  function broadcast(ctx, a, b, f) {
    const A = isArrayish(a) ? toMatrix(ctx, a) : null, B = isArrayish(b) ? toMatrix(ctx, b) : null;
    const sa = A ? null : scalar(ctx, a), sb = B ? null : scalar(ctx, b);
    const rows = Math.max(A ? A.length : 1, B ? B.length : 1), cols = Math.max(A ? A[0].length : 1, B ? B[0].length : 1);
    const pick = (M, s, r, c) => {
      if (!M) return s;
      const rr = M.length === 1 ? 0 : r, cc = M[0].length === 1 ? 0 : c;
      return rr < M.length && cc < M[0].length ? M[rr][cc] : ERR.NA;
    };
    const out = [];
    for (let r = 0; r < rows; r++) { const row = []; for (let c = 0; c < cols; c++) row.push(f(pick(A, sa, r, c), pick(B, sb, r, c))); out.push(row); }
    return out;
  }
  function mapValue(ctx, v, f) {
    if (isArrayish(v)) return toMatrix(ctx, v).map(row => row.map(f));
    return f(scalar(ctx, v));
  }
  function resolveRef(ctx, n) {
    let sheet = ctx.sheet;
    if (n.sheet != null) { sheet = ctx.sheetByName(n.sheet); if (!sheet) return ERR.REF; }
    const dr = ctx.dr || 0, dc = ctx.dc || 0;
    let r1 = n.r1, r2 = n.r2, c1 = n.c1, c2 = n.c2;
    if (dr && n.kind !== 'cols') { if (!n.ar1) r1 += dr; if (!n.ar2) r2 += dr; }
    if (dc && n.kind !== 'rows') { if (!n.ac1) c1 += dc; if (!n.ac2) c2 += dc; }
    if (r1 < 0 || c1 < 0 || r2 >= MAXR || c2 >= MAXC) return ERR.REF;
    return new Ref(sheet, r1, c1, r2, c2);
  }
  function evaluate(n, ctx) {
    switch (n.t) {
      case 'num': case 'str': case 'bool': return n.v;
      case 'err': return n.v;
      case 'arr': return n.v;
      case 'missing': return null;
      case 'ref': return resolveRef(ctx, n);
      case 'name': {
        for (let s = ctx.scope; s; s = s.parent) if (s.vars.has(n.name.toUpperCase())) return s.vars.get(n.name.toUpperCase());
        const nm = ctx.name ? ctx.name(n.name) : null;
        if (nm == null) return ERR.NAME;
        return nm;
      }
      case 'neg': return mapValue(ctx, evaluate(n.a, ctx), x => { if (x instanceof FErr) return x; try { return -num(x); } catch (e) { if (e instanceof FErr) return e; throw e; } });
      case 'pct': return mapValue(ctx, evaluate(n.a, ctx), x => { if (x instanceof FErr) return x; try { return num(x) / 100; } catch (e) { if (e instanceof FErr) return e; throw e; } });
      case 'bin': {
        if (n.op === ':') {
          const a = evaluate(n.a, ctx), b = evaluate(n.b, ctx);
          if (a instanceof FErr) return a; if (b instanceof FErr) return b;
          if (!(a instanceof Ref) || !(b instanceof Ref) || a.sheet !== b.sheet) return ERR.VALUE;
          return new Ref(a.sheet, Math.min(a.r1, b.r1), Math.min(a.c1, b.c1), Math.max(a.r2, b.r2), Math.max(a.c2, b.c2));
        }
        const a = evaluate(n.a, ctx), b = evaluate(n.b, ctx);
        if (isArrayish(a) || isArrayish(b)) return broadcast(ctx, a, b, (x, y) => binop(n.op, x, y));
        return binop(n.op, scalar(ctx, a), scalar(ctx, b));
      }
      case 'fn': return callFn(n, ctx);
    }
    return ERR.VALUE;
  }
  function callFn(n, ctx) {
    const f = FN[n.name];
    if (!f) return ERR.NAME;
    const argc = n.args.length;
    if (argc < (f.min || 0) || argc > (f.max == null ? 255 : f.max)) return ERR.VALUE;
    try {
      if (f.lazy) return f.fn(n.args, ctx);
      const args = n.args.map(a => evaluate(a, ctx));
      if (f.raw) return f.fn(args, ctx);
      // scalar function: lift over arrays
      const lift = args.findIndex(isArrayish) >= 0 && !f.noLift;
      const call = vals => {
        if (!f.err) for (const v of vals) if (v instanceof FErr) return v;
        try { const r = f.fn(vals, ctx); return typeof r === 'number' && !Number.isFinite(r) ? ERR.NUM : r; }
        catch (e) { if (e instanceof FErr) return e; throw e; }
      };
      if (!lift) return call(args.map(a => scalar(ctx, a)));
      const mats = args.map(a => isArrayish(a) ? toMatrix(ctx, a) : null);
      const rows = Math.max(...mats.map(m => m ? m.length : 1)), cols = Math.max(...mats.map(m => m ? m[0].length : 1));
      const out = [];
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) row.push(call(args.map((a, k) => { const M = mats[k]; if (!M) return scalar(ctx, a); const rr = M.length === 1 ? 0 : r, cc = M[0].length === 1 ? 0 : c; return rr < M.length && cc < M[0].length ? M[rr][cc] : ERR.NA; })));
        out.push(row);
      }
      return out;
    } catch (e) {
      if (e instanceof FErr) return e;
      if (e instanceof Need) throw e;
      if (root.LUMEN_DEBUG || (typeof process !== 'undefined' && process.env && process.env.FORMULA_DEBUG)) console.warn(n.name, e);
      return ERR.VALUE;
    }
  }

  const Formula = {
    MAXR, MAXC, FErr, ERR, Ref, Need, ParseError, FN, errOf, isErr,
    colName, colIndex, addr, parseAddr, parseRange, rangeText, quoteSheet,
    tokenize, parse, analyse, mapRefs, shiftFormula, adjustForInsert, renameSheetIn, refTokText,
    evaluate, num, str, bool, compare, binop, scalar, toMatrix, toFullMatrix, isArrayish, mapValue, broadcast, refValue
  };
  if (typeof module !== 'undefined' && module.exports) {
    const F = require('./format.js'); Formula.parseInput = F.parseInput; Formula.numToText = F.numToText; Formula.Fmt = F;
    module.exports = Formula;
  } else {
    const F = root.SheetFormat; Formula.parseInput = F.parseInput; Formula.numToText = F.numToText; Formula.Fmt = F;
    root.Formula = Formula;
  }
})(typeof self !== 'undefined' ? self : this);
