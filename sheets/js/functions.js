'use strict';
/* Lumen Sheets — worksheet function library (registered into Formula.FN).
   Each entry: {fn, min, max, raw?, lazy?, err?, vol?, cat, sig, desc}. Scalar functions are lifted over arrays by the evaluator. */
(function (root) {
  const F = typeof module !== 'undefined' && module.exports ? require('./formula.js') : root.Formula;
  const Fmt = F.Fmt;
  const { ERR, FErr, Ref, num, str, bool, FN } = F;
  const isErr = v => v instanceof FErr;

  function def(names, opts, fn) {
    if (typeof opts === 'function') { fn = opts; opts = {}; }
    names.split('|').forEach(n => { FN[n] = Object.assign({ fn, min: 0, max: null }, opts); });
  }
  const S = (names, min, max, fn, extra = {}) => def(names, Object.assign({ min, max }, extra), fn);
  const R = (names, min, max, fn, extra = {}) => def(names, Object.assign({ min, max, raw: true }, extra), fn);
  const L = (names, min, max, fn, extra = {}) => def(names, Object.assign({ min, max, lazy: true }, extra), fn);

  /* ---------- iteration helpers ---------- */
  // visit every value: refs/arrays give (v, true), direct scalars (v, false)
  function iter(ctx, v, cb) {
    if (v instanceof Ref) {
      const b = ctx.bounds(v.sheet), r2 = Math.min(v.r2, b.r), c2 = Math.min(v.c2, b.c);
      for (let r = v.r1; r <= r2; r++) for (let c = v.c1; c <= c2; c++) cb(ctx.value(v.sheet, r, c), true, r, c);
    } else if (Array.isArray(v)) { for (const row of v) for (const x of row) cb(x, true); }
    else cb(v, false);
  }
  // numbers SUM-style: refs → numbers only; direct → coerced (bool, numeric text)
  function nums(ctx, args, { a = false } = {}) {
    const out = [];
    for (const arg of args) iter(ctx, arg, (v, inRef) => {
      if (v instanceof FErr) throw v;
      if (typeof v === 'number') out.push(v);
      else if (inRef) { if (a) { if (typeof v === 'boolean') out.push(v ? 1 : 0); else if (typeof v === 'string') out.push(0); } }
      else if (v != null) out.push(num(v));
    });
    return out;
  }
  const mat = (ctx, v) => F.toMatrix(ctx, v);
  const flatVals = (ctx, v) => { const o = []; iter(ctx, v, x => o.push(x)); return o; };
  const sum = a => { let s = 0; for (const x of a) s += x; return s; };
  const mean = a => sum(a) / a.length;
  const intArg = v => Math.trunc(num(v));
  const optNum = (v, d) => v == null ? d : num(v);
  const optBool = (v, d) => v == null ? d : bool(v);
  const round15 = x => parseFloat(x.toPrecision(15));
  const dims = v => v instanceof Ref ? [v.rows, v.cols] : Array.isArray(v) ? [v.length, v[0].length] : [1, 1];

  /* ---------- criteria (COUNTIF etc.) ---------- */
  function wildRe(s) {
    let re = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '~' && i + 1 < s.length && /[*?~]/.test(s[i + 1])) { re += '\\' + s[++i]; continue; }
      re += ch === '*' ? '[\\s\\S]*' : ch === '?' ? '[\\s\\S]' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp('^' + re + '$', 'i');
  }
  const hasWild = s => /[*?]/.test(s.replace(/~[*?~]/g, ''));
  function criterion(c) {
    if (c instanceof FErr) return v => v instanceof FErr && v.code === c.code;
    if (typeof c === 'number') return v => typeof v === 'number' ? v === c : typeof v === 'string' && v.trim() !== '' && !isNaN(+v) && +v === c;
    if (typeof c === 'boolean') return v => v === c;
    if (c == null) return v => v == null || v === '';
    const s = String(c);
    const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(s), op = m[1] || '=', rest = m[2];
    const p = rest === '' ? null : Fmt.parseInput(rest);
    const isNum = p && typeof p.v === 'number';
    if (rest === '') {
      if (op === '=') return v => v == null || v === '';
      if (op === '<>') return v => !(v == null || v === '');
    }
    if (isNum) {
      const x = p.v;
      const t = { '=': (a) => a === x, '<>': a => a !== x, '<': a => a < x, '>': a => a > x, '<=': a => a <= x, '>=': a => a >= x }[op];
      if (op === '<>') return v => typeof v !== 'number' || v !== x;
      return v => typeof v === 'number' && t(v);
    }
    if (/^(TRUE|FALSE)$/i.test(rest)) { const b = /^TRUE$/i.test(rest); return op === '<>' ? (v => v !== b) : op === '=' ? (v => v === b) : (() => false); }
    const lo = rest.toLowerCase();
    if (op === '=' || op === '<>') {
      const re = hasWild(rest) ? wildRe(rest) : null;
      const eq = v => { if (typeof v !== 'string') return false; return re ? re.test(v) : v.toLowerCase() === lo; };
      return op === '=' ? eq : v => !eq(v);
    }
    const t = { '<': (a) => a < lo, '>': a => a > lo, '<=': a => a <= lo, '>=': a => a >= lo }[op];
    return v => typeof v === 'string' && t(v.toLowerCase());
  }
  // iterate multiple same-shaped ranges row-major, calling cb(index-aligned values)
  function multiIter(ctx, ranges, cb) {
    const [rows, cols] = dims(ranges[0]);
    for (const r of ranges) { const [a, b] = dims(r); if (a !== rows || b !== cols) throw ERR.VALUE; }
    // clamp to the used area of all referenced sheets
    let maxR = rows, maxC = cols;
    if (ranges.every(r => r instanceof Ref)) {
      maxR = 0; maxC = 0;
      for (const r of ranges) { const b = ctx.bounds(r.sheet); maxR = Math.max(maxR, Math.min(rows, b.r - r.r1 + 1)); maxC = Math.max(maxC, Math.min(cols, b.c - r.c1 + 1)); }
    }
    const get = (rg, i, j) => rg instanceof Ref ? ctx.value(rg.sheet, rg.r1 + i, rg.c1 + j) : Array.isArray(rg) ? rg[i][j] : rg;
    for (let i = 0; i < maxR; i++) for (let j = 0; j < maxC; j++) cb(ranges.map(rg => get(rg, i, j)), i, j);
  }
  function ifsCore(ctx, target, pairs, onMatch) {
    const ranges = [], preds = [];
    for (let k = 0; k < pairs.length; k += 2) { ranges.push(pairs[k]); preds.push(criterion(F.scalar(ctx, pairs[k + 1]))); }
    const all = target ? [target, ...ranges] : ranges;
    multiIter(ctx, all, vals => {
      const off = target ? 1 : 0;
      for (let k = 0; k < preds.length; k++) if (!preds[k](vals[k + off])) return;
      onMatch(target ? vals[0] : null);
    });
  }

  /* ================= MATH ================= */
  R('SUM', 1, null, (a, ctx) => sum(nums(ctx, a)));
  R('SUMSQ', 1, null, (a, ctx) => sum(nums(ctx, a).map(x => x * x)));
  R('PRODUCT', 1, null, (a, ctx) => nums(ctx, a).reduce((p, x) => p * x, 1));
  R('SUMPRODUCT', 1, null, (a, ctx) => {
    const ms = a.map(v => F.toFullMatrix(ctx, v));
    const rows = ms[0].length, cols = ms[0][0].length;
    if (ms.some(m => m.length !== rows || m[0].length !== cols)) return ERR.VALUE;
    let s = 0;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
      let p = 1;
      for (const m of ms) { const v = m[i][j]; if (v instanceof FErr) return v; p *= typeof v === 'number' ? v : 0; }
      s += p;
    }
    return s;
  });
  R('SUMX2MY2', 2, 2, (a, ctx) => { const x = flatVals(ctx, a[0]), y = flatVals(ctx, a[1]); if (x.length !== y.length) return ERR.NA; let s = 0; x.forEach((v, i) => { if (typeof v === 'number' && typeof y[i] === 'number') s += v * v - y[i] * y[i]; }); return s; });
  S('ABS', 1, 1, ([x]) => Math.abs(num(x)));
  function roundTo(x, d, mode) {
    d = Math.trunc(d); const m = Math.pow(10, d), a = Math.abs(x);
    let t = round15(a * m);
    t = mode === 'up' ? Math.ceil(t) : mode === 'down' ? Math.floor(t) : Math.round(t);
    return Math.sign(x) * round15(t / m);
  }
  S('ROUND', 2, 2, ([x, d]) => roundTo(num(x), num(d)));
  S('ROUNDUP', 2, 2, ([x, d]) => roundTo(num(x), num(d), 'up'));
  S('ROUNDDOWN', 2, 2, ([x, d]) => roundTo(num(x), num(d), 'down'));
  S('INT', 1, 1, ([x]) => Math.floor(num(x)));
  S('TRUNC', 1, 2, ([x, d]) => roundTo(num(x), optNum(d, 0), 'down'));
  S('MOD', 2, 2, ([n, d]) => { n = num(n); d = num(d); if (d === 0) throw ERR.DIV0; const r = n - d * Math.floor(n / d); return round15(r); });
  S('POWER', 2, 2, ([x, y]) => { const r = F.binop('^', num(x), num(y)); if (isErr(r)) throw r; return r; });
  S('SQRT', 1, 1, ([x]) => { x = num(x); if (x < 0) throw ERR.NUM; return Math.sqrt(x); });
  S('SQRTPI', 1, 1, ([x]) => { x = num(x); if (x < 0) throw ERR.NUM; return Math.sqrt(x * Math.PI); });
  S('EXP', 1, 1, ([x]) => Math.exp(num(x)));
  S('LN', 1, 1, ([x]) => { x = num(x); if (x <= 0) throw ERR.NUM; return Math.log(x); });
  S('LOG', 1, 2, ([x, b]) => { x = num(x); b = optNum(b, 10); if (x <= 0 || b <= 0) throw ERR.NUM; if (b === 1) throw ERR.DIV0; return round15(Math.log(x) / Math.log(b)); });
  S('LOG10', 1, 1, ([x]) => { x = num(x); if (x <= 0) throw ERR.NUM; return Math.log10(x); });
  S('PI', 0, 0, () => Math.PI);
  S('SIGN', 1, 1, ([x]) => Math.sign(num(x)));
  S('CEILING', 2, 2, ([x, s]) => { x = num(x); s = num(s); if (s === 0) return 0; if (x > 0 && s < 0) throw ERR.NUM; return round15(Math.ceil(round15(x / s)) * s); });
  S('CEILING.MATH|CEILING.PRECISE|ISO.CEILING', 1, 3, ([x, s, m]) => { x = num(x); s = Math.abs(optNum(s, 1)); if (s === 0) return 0; const q = round15(x / s); return round15((x < 0 && optNum(m, 0) ? Math.floor(q) : Math.ceil(q)) * s); });
  S('FLOOR', 2, 2, ([x, s]) => { x = num(x); s = num(s); if (s === 0) throw ERR.DIV0; if (x > 0 && s < 0) throw ERR.NUM; return round15(Math.floor(round15(x / s)) * s); });
  S('FLOOR.MATH|FLOOR.PRECISE', 1, 3, ([x, s, m]) => { x = num(x); s = Math.abs(optNum(s, 1)); if (s === 0) return 0; const q = round15(x / s); return round15((x < 0 && optNum(m, 0) ? Math.ceil(q) : Math.floor(q)) * s); });
  S('MROUND', 2, 2, ([x, m]) => { x = num(x); m = num(m); if (m === 0) return 0; if (x * m < 0) throw ERR.NUM; return round15(Math.sign(x) * Math.round(round15(Math.abs(x / m))) * Math.abs(m)); });
  S('EVEN', 1, 1, ([x]) => { x = num(x); const a = Math.ceil(Math.abs(x)); return Math.sign(x) * (a % 2 ? a + 1 : a); });
  S('ODD', 1, 1, ([x]) => { x = num(x); let a = Math.ceil(Math.abs(x)); if (a % 2 === 0) a++; return (x < 0 ? -1 : 1) * a; });
  const fact = n => { let r = 1; for (let i = 2; i <= n; i++) r *= i; return r; };
  S('FACT', 1, 1, ([x]) => { x = Math.floor(num(x)); if (x < 0) throw ERR.NUM; return fact(x); });
  S('FACTDOUBLE', 1, 1, ([x]) => { x = Math.floor(num(x)); if (x < -1) throw ERR.NUM; let r = 1; for (let i = x; i > 1; i -= 2) r *= i; return r; });
  const combin = (n, k) => { if (k < 0 || n < 0 || k > n) throw ERR.NUM; k = Math.min(k, n - k); let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return Math.round(r); };
  S('COMBIN', 2, 2, ([n, k]) => combin(Math.trunc(num(n)), Math.trunc(num(k))));
  S('COMBINA', 2, 2, ([n, k]) => { n = Math.trunc(num(n)); k = Math.trunc(num(k)); return combin(n + k - 1, k); });
  S('PERMUT', 2, 2, ([n, k]) => { n = Math.trunc(num(n)); k = Math.trunc(num(k)); if (k < 0 || n < 0 || k > n) throw ERR.NUM; let r = 1; for (let i = 0; i < k; i++) r *= n - i; return r; });
  const gcd2 = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
  R('GCD', 1, null, (a, ctx) => { const x = nums(ctx, a).map(Math.trunc); if (x.some(v => v < 0)) throw ERR.NUM; return x.reduce(gcd2, 0); });
  R('LCM', 1, null, (a, ctx) => { const x = nums(ctx, a).map(Math.trunc); if (x.some(v => v < 0)) throw ERR.NUM; return x.reduce((p, v) => p === 0 || v === 0 ? 0 : p / gcd2(p, v) * v, 1); });
  S('RAND', 0, 0, () => Math.random(), { vol: true });
  S('RANDBETWEEN', 2, 2, ([a, b]) => { a = Math.ceil(num(a)); b = Math.floor(num(b)); if (a > b) throw ERR.NUM; return a + Math.floor(Math.random() * (b - a + 1)); }, { vol: true });
  S('QUOTIENT', 2, 2, ([n, d]) => { d = num(d); if (d === 0) throw ERR.DIV0; return Math.trunc(num(n) / d); });
  S('SIN', 1, 1, ([x]) => Math.sin(num(x))); S('COS', 1, 1, ([x]) => Math.cos(num(x))); S('TAN', 1, 1, ([x]) => Math.tan(num(x)));
  S('ASIN', 1, 1, ([x]) => { x = num(x); if (Math.abs(x) > 1) throw ERR.NUM; return Math.asin(x); });
  S('ACOS', 1, 1, ([x]) => { x = num(x); if (Math.abs(x) > 1) throw ERR.NUM; return Math.acos(x); });
  S('ATAN', 1, 1, ([x]) => Math.atan(num(x)));
  S('ATAN2', 2, 2, ([x, y]) => { x = num(x); y = num(y); if (x === 0 && y === 0) throw ERR.DIV0; return Math.atan2(y, x); });
  S('SINH', 1, 1, ([x]) => Math.sinh(num(x))); S('COSH', 1, 1, ([x]) => Math.cosh(num(x))); S('TANH', 1, 1, ([x]) => Math.tanh(num(x)));
  S('ASINH', 1, 1, ([x]) => Math.asinh(num(x))); S('ACOSH', 1, 1, ([x]) => { x = num(x); if (x < 1) throw ERR.NUM; return Math.acosh(x); }); S('ATANH', 1, 1, ([x]) => { x = num(x); if (Math.abs(x) >= 1) throw ERR.NUM; return Math.atanh(x); });
  S('COT', 1, 1, ([x]) => { x = num(x); if (x === 0) throw ERR.DIV0; return 1 / Math.tan(x); });
  S('SEC', 1, 1, ([x]) => 1 / Math.cos(num(x))); S('CSC', 1, 1, ([x]) => { x = num(x); if (x === 0) throw ERR.DIV0; return 1 / Math.sin(x); });
  S('DEGREES', 1, 1, ([x]) => num(x) * 180 / Math.PI);
  S('RADIANS', 1, 1, ([x]) => num(x) * Math.PI / 180);
  R('SUMIF', 2, 3, (a, ctx) => { let s = 0; const tgt = a[2] != null ? sizeLike(a[2], a[0]) : a[0]; ifsCore(ctx, tgt, [a[0], a[1]], v => { if (typeof v === 'number') s += v; }); return s; });
  R('SUMIFS', 3, null, (a, ctx) => { if (a.length % 2 === 0) return ERR.VALUE; let s = 0; ifsCore(ctx, a[0], a.slice(1), v => { if (typeof v === 'number') s += v; }); return s; });
  // SUMIF's sum_range is resized to the criteria range's shape (Excel behaviour)
  function sizeLike(r, like) { if (r instanceof Ref && like instanceof Ref) return new Ref(r.sheet, r.r1, r.c1, r.r1 + like.rows - 1, r.c1 + like.cols - 1); return r; }
  const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  S('ROMAN', 1, 2, ([x]) => { x = Math.trunc(num(x)); if (x < 0 || x > 3999) throw ERR.VALUE; let s = ''; for (const [v, r] of ROMAN) while (x >= v) { s += r; x -= v; } return s; });
  S('ARABIC', 1, 1, ([t]) => { t = str(t).trim().toUpperCase(); if (!/^-?[MDCLXVI]*$/.test(t)) throw ERR.VALUE; const neg = t[0] === '-'; if (neg) t = t.slice(1); const V = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 }; let s = 0; for (let i = 0; i < t.length; i++) { const v = V[t[i]], n = V[t[i + 1]] || 0; s += v < n ? -v : v; } return neg ? -s : s; });
  S('BASE', 2, 3, ([n, r, m]) => { n = Math.trunc(num(n)); r = Math.trunc(num(r)); if (n < 0 || r < 2 || r > 36) throw ERR.NUM; return n.toString(r).toUpperCase().padStart(Math.trunc(optNum(m, 0)), '0'); });
  S('DECIMAL', 2, 2, ([t, r]) => { r = Math.trunc(num(r)); t = str(t); if (r < 2 || r > 36) throw ERR.NUM; const v = parseInt(t, r); if (isNaN(v) || !new RegExp('^[0-9a-z]+$', 'i').test(t)) throw ERR.NUM; return v; });
  function radixConv(from, to, bits) {
    return ([v, places]) => {
      let n;
      if (from === 10) { n = Math.trunc(num(v)); const lim = Math.pow(2, bits - 1); const max = to === 2 ? 512 : to === 8 ? 536870912 : 549755813888; if (n < -max || n >= max) throw ERR.NUM; void lim; }
      else { const s = str(v).trim().toUpperCase(); if (!s || s.length > 10 || isNaN(parseInt(s, from)) || !new RegExp('^[' + '0123456789ABCDEF'.slice(0, from) + ']+$').test(s)) throw ERR.NUM; n = parseInt(s, from); if (s.length === 10 && parseInt(s[0], from) >= from / 2) n -= Math.pow(from, 10); }
      if (to === 10) return n;
      let s;
      if (n < 0) s = (Math.pow(to, 10) + n).toString(to).toUpperCase();
      else { s = n.toString(to).toUpperCase(); if (places != null) { const p = Math.trunc(num(places)); if (p < s.length) throw ERR.NUM; s = s.padStart(p, '0'); } }
      return s;
    };
  }
  S('DEC2BIN', 1, 2, radixConv(10, 2, 10)); S('DEC2OCT', 1, 2, radixConv(10, 8, 30)); S('DEC2HEX', 1, 2, radixConv(10, 16, 40));
  S('BIN2DEC', 1, 1, radixConv(2, 10)); S('OCT2DEC', 1, 1, radixConv(8, 10)); S('HEX2DEC', 1, 1, radixConv(16, 10));
  S('BIN2HEX', 1, 2, ([v, p]) => radixConv(10, 16)([radixConv(2, 10)([v]), p])); S('HEX2BIN', 1, 2, ([v, p]) => radixConv(10, 2)([radixConv(16, 10)([v]), p]));
  R('MMULT', 2, 2, (a, ctx) => {
    const A = F.toFullMatrix(ctx, a[0]), B = F.toFullMatrix(ctx, a[1]);
    if (A[0].length !== B.length) return ERR.VALUE;
    const out = [];
    for (let i = 0; i < A.length; i++) { const row = []; for (let j = 0; j < B[0].length; j++) { let s = 0; for (let k = 0; k < B.length; k++) { const x = A[i][k], y = B[k][j]; if (typeof x !== 'number' || typeof y !== 'number') return ERR.VALUE; s += x * y; } row.push(s); } out.push(row); }
    return out;
  });
  function luDet(M) {
    const n = M.length, A = M.map(r => r.slice()); let det = 1;
    for (let i = 0; i < n; i++) {
      let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
      if (A[p][i] === 0) return 0;
      if (p !== i) { [A[p], A[i]] = [A[i], A[p]]; det = -det; }
      det *= A[i][i];
      for (let k = i + 1; k < n; k++) { const f = A[k][i] / A[i][i]; for (let j = i; j < n; j++) A[k][j] -= f * A[i][j]; }
    }
    return det;
  }
  R('MDETERM', 1, 1, (a, ctx) => { const M = F.toFullMatrix(ctx, a[0]); if (M.length !== M[0].length) return ERR.VALUE; if (M.some(r => r.some(x => typeof x !== 'number'))) return ERR.VALUE; return round15(luDet(M)); });
  R('MINVERSE', 1, 1, (a, ctx) => {
    const M = F.toFullMatrix(ctx, a[0]), n = M.length; if (n !== M[0].length || M.some(r => r.some(x => typeof x !== 'number'))) return ERR.VALUE;
    const A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => +(i === j))]);
    for (let i = 0; i < n; i++) {
      let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
      if (Math.abs(A[p][i]) < 1e-15) return ERR.NUM;
      [A[p], A[i]] = [A[i], A[p]];
      const d = A[i][i]; for (let j = 0; j < 2 * n; j++) A[i][j] /= d;
      for (let k = 0; k < n; k++) if (k !== i) { const f = A[k][i]; for (let j = 0; j < 2 * n; j++) A[k][j] -= f * A[i][j]; }
    }
    return A.map(r => r.slice(n).map(round15));
  });
  R('MUNIT', 1, 1, (a, ctx) => { const n = Math.trunc(num(F.scalar(ctx, a[0]))); if (n < 1) return ERR.VALUE; return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => +(i === j))); });
  R('SEQUENCE', 1, 4, (a, ctx) => {
    const g = (i, d) => a[i] == null ? d : num(F.scalar(ctx, a[i]));
    const rows = Math.trunc(g(0, 1)), cols = Math.trunc(g(1, 1)), start = g(2, 1), step = g(3, 1);
    if (rows < 1 || cols < 1) return ERR.CALC; if (rows * cols > 1e6) return ERR.NUM;
    return Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => start + (i * cols + j) * step));
  });
  R('RANDARRAY', 0, 5, (a, ctx) => {
    const g = (i, d) => a[i] == null ? d : F.scalar(ctx, a[i]);
    const rows = Math.trunc(num(g(0, 1))), cols = Math.trunc(num(g(1, 1))), lo = num(g(2, 0)), hi = num(g(3, 1)), whole = bool(g(4, false));
    if (rows < 1 || cols < 1 || lo > hi) return ERR.VALUE;
    return Array.from({ length: rows }, () => Array.from({ length: cols }, () => whole ? Math.floor(lo + Math.random() * (Math.floor(hi) - Math.ceil(lo) + 1)) : lo + Math.random() * (hi - lo)));
  }, { vol: true });

  /* ================= STATISTICS ================= */
  R('AVERAGE', 1, null, (a, ctx) => { const x = nums(ctx, a); if (!x.length) return ERR.DIV0; return mean(x); });
  R('AVERAGEA', 1, null, (a, ctx) => { const x = nums(ctx, a, { a: true }); if (!x.length) return ERR.DIV0; return mean(x); });
  R('AVERAGEIF', 2, 3, (a, ctx) => { let s = 0, n = 0; ifsCore(ctx, a[2] != null ? sizeLike(a[2], a[0]) : a[0], [a[0], a[1]], v => { if (typeof v === 'number') { s += v; n++; } }); return n ? s / n : ERR.DIV0; });
  R('AVERAGEIFS', 3, null, (a, ctx) => { let s = 0, n = 0; ifsCore(ctx, a[0], a.slice(1), v => { if (typeof v === 'number') { s += v; n++; } }); return n ? s / n : ERR.DIV0; });
  R('COUNT', 0, null, (a, ctx) => { let n = 0; for (const arg of a) iter(ctx, arg, (v, inRef) => { if (typeof v === 'number') n++; else if (!inRef && v != null && !(v instanceof FErr)) { try { num(v); if (typeof v !== 'boolean' || true) n++; } catch (e) { /* not a number */ } } }); return n; });
  R('COUNTA', 0, null, (a, ctx) => { let n = 0; for (const arg of a) iter(ctx, arg, (v, inRef) => { if (v != null || !inRef) n++; }); return n; });
  R('COUNTBLANK', 1, 1, (a, ctx) => {
    const v = a[0]; if (!(v instanceof Ref)) return ERR.VALUE;
    let filled = 0; iter(ctx, v, x => { if (x != null && x !== '') filled++; }); return v.rows * v.cols - filled;
  });
  R('COUNTIF', 2, 2, (a, ctx) => { let n = 0; ifsCore(ctx, null, [a[0], a[1]], () => n++); return n; });
  R('COUNTIFS', 2, null, (a, ctx) => { if (a.length % 2) return ERR.VALUE; let n = 0; ifsCore(ctx, null, a, () => n++); return n; });
  R('MAX', 1, null, (a, ctx) => { const x = nums(ctx, a); return x.length ? x.reduce((m, v) => v > m ? v : m, -Infinity) : 0; });
  R('MIN', 1, null, (a, ctx) => { const x = nums(ctx, a); return x.length ? x.reduce((m, v) => v < m ? v : m, Infinity) : 0; });
  R('MAXA', 1, null, (a, ctx) => { const x = nums(ctx, a, { a: true }); return x.length ? Math.max(...x) : 0; });
  R('MINA', 1, null, (a, ctx) => { const x = nums(ctx, a, { a: true }); return x.length ? Math.min(...x) : 0; });
  R('MAXIFS', 3, null, (a, ctx) => { let m = -Infinity; ifsCore(ctx, a[0], a.slice(1), v => { if (typeof v === 'number' && v > m) m = v; }); return m === -Infinity ? 0 : m; });
  R('MINIFS', 3, null, (a, ctx) => { let m = Infinity; ifsCore(ctx, a[0], a.slice(1), v => { if (typeof v === 'number' && v < m) m = v; }); return m === Infinity ? 0 : m; });
  const sorted = x => x.slice().sort((p, q) => p - q);
  function median(x) { if (!x.length) throw ERR.NUM; const s = sorted(x), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  R('MEDIAN', 1, null, (a, ctx) => median(nums(ctx, a)));
  function modes(x) { const cnt = new Map(); x.forEach(v => cnt.set(v, (cnt.get(v) || 0) + 1)); let best = 1; cnt.forEach(c => { if (c > best) best = c; }); if (best < 2) throw ERR.NA; const out = []; for (const v of x) if (cnt.get(v) === best && !out.includes(v)) out.push(v); return out; }
  R('MODE|MODE.SNGL', 1, null, (a, ctx) => modes(nums(ctx, a))[0]);
  R('MODE.MULT', 1, null, (a, ctx) => modes(nums(ctx, a)).map(v => [v]));
  R('LARGE', 2, 2, (a, ctx) => { const x = sorted(nums(ctx, [a[0]])), k = Math.ceil(num(F.scalar(ctx, a[1]))); if (k < 1 || k > x.length) return ERR.NUM; return x[x.length - k]; });
  R('SMALL', 2, 2, (a, ctx) => { const x = sorted(nums(ctx, [a[0]])), k = Math.ceil(num(F.scalar(ctx, a[1]))); if (k < 1 || k > x.length) return ERR.NUM; return x[k - 1]; });
  function rank(a, ctx, avg) {
    const v = num(F.scalar(ctx, a[0])), x = nums(ctx, [a[1]]), asc = a[2] != null && num(F.scalar(ctx, a[2])) !== 0;
    if (!x.includes(v)) return ERR.NA;
    const better = x.filter(y => asc ? y < v : y > v).length, ties = x.filter(y => y === v).length;
    return avg ? better + (ties + 1) / 2 : better + 1;
  }
  R('RANK|RANK.EQ', 2, 3, (a, ctx) => rank(a, ctx, false));
  R('RANK.AVG', 2, 3, (a, ctx) => rank(a, ctx, true));
  const variance = (x, samp) => { const n = x.length; if (n - (samp ? 1 : 0) <= 0) throw ERR.DIV0; const m = mean(x); return sum(x.map(v => (v - m) * (v - m))) / (n - (samp ? 1 : 0)); };
  R('STDEV|STDEV.S', 1, null, (a, ctx) => Math.sqrt(variance(nums(ctx, a), true)));
  R('STDEVP|STDEV.P', 1, null, (a, ctx) => Math.sqrt(variance(nums(ctx, a), false)));
  R('STDEVA', 1, null, (a, ctx) => Math.sqrt(variance(nums(ctx, a, { a: true }), true)));
  R('VAR|VAR.S', 1, null, (a, ctx) => variance(nums(ctx, a), true));
  R('VARP|VAR.P', 1, null, (a, ctx) => variance(nums(ctx, a), false));
  function pctInc(x, p) { if (!x.length || p < 0 || p > 1) throw ERR.NUM; const s = sorted(x), h = (s.length - 1) * p, lo = Math.floor(h); return lo + 1 < s.length ? s[lo] + (h - lo) * (s[lo + 1] - s[lo]) : s[lo]; }
  function pctExc(x, p) { const s = sorted(x), n = s.length, h = (n + 1) * p - 1; if (!n || p <= 0 || p >= 1 || h < 0 || h > n - 1) throw ERR.NUM; const lo = Math.floor(h); return lo + 1 < n ? s[lo] + (h - lo) * (s[lo + 1] - s[lo]) : s[lo]; }
  R('PERCENTILE|PERCENTILE.INC', 2, 2, (a, ctx) => pctInc(nums(ctx, [a[0]]), num(F.scalar(ctx, a[1]))));
  R('PERCENTILE.EXC', 2, 2, (a, ctx) => pctExc(nums(ctx, [a[0]]), num(F.scalar(ctx, a[1]))));
  R('QUARTILE|QUARTILE.INC', 2, 2, (a, ctx) => { const q = Math.trunc(num(F.scalar(ctx, a[1]))); if (q < 0 || q > 4) return ERR.NUM; return pctInc(nums(ctx, [a[0]]), q / 4); });
  R('QUARTILE.EXC', 2, 2, (a, ctx) => { const q = Math.trunc(num(F.scalar(ctx, a[1]))); if (q < 1 || q > 3) return ERR.NUM; return pctExc(nums(ctx, [a[0]]), q / 4); });
  R('PERCENTRANK|PERCENTRANK.INC', 2, 3, (a, ctx) => {
    const x = sorted(nums(ctx, [a[0]])), v = num(F.scalar(ctx, a[1])), sig = a[2] != null ? num(F.scalar(ctx, a[2])) : 3, n = x.length;
    if (!n || v < x[0] || v > x[n - 1]) return ERR.NA;
    let i = 0; while (i < n - 1 && x[i + 1] <= v) i++;
    let r; if (x[i] === v) r = x.indexOf(v) / (n - 1); else r = (i + (v - x[i]) / (x[i + 1] - x[i])) / (n - 1);
    const m = Math.pow(10, sig); return Math.floor(r * m + 1e-9) / m;
  });
  function pairs(ctx, ya, xa) {
    const Y = flatVals(ctx, ya), X = flatVals(ctx, xa);
    if (Y.length !== X.length) throw ERR.NA;
    const xs = [], ys = [];
    for (let i = 0; i < Y.length; i++) { if (Y[i] instanceof FErr) throw Y[i]; if (X[i] instanceof FErr) throw X[i]; if (typeof Y[i] === 'number' && typeof X[i] === 'number') { ys.push(Y[i]); xs.push(X[i]); } }
    return [ys, xs];
  }
  function linreg(ys, xs) {
    const n = xs.length; if (n < 2) throw ERR.DIV0;
    const mx = mean(xs), my = mean(ys); let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; syy += (ys[i] - my) ** 2; }
    if (sxx === 0) throw ERR.DIV0;
    const slope = sxy / sxx; return { slope, icpt: my - slope * mx, r: sxy / Math.sqrt(sxx * syy), n, sxx, syy, sxy, mx, my };
  }
  R('SLOPE', 2, 2, (a, ctx) => linreg(...pairs(ctx, a[0], a[1])).slope);
  R('INTERCEPT', 2, 2, (a, ctx) => linreg(...pairs(ctx, a[0], a[1])).icpt);
  R('RSQ', 2, 2, (a, ctx) => linreg(...pairs(ctx, a[0], a[1])).r ** 2);
  R('CORREL|PEARSON', 2, 2, (a, ctx) => { const [y, x] = pairs(ctx, a[0], a[1]); const l = linreg(y, x); if (!l.syy) throw ERR.DIV0; return l.r; });
  R('FORECAST|FORECAST.LINEAR', 3, 3, (a, ctx) => { const l = linreg(...pairs(ctx, a[1], a[2])); return l.icpt + l.slope * num(F.scalar(ctx, a[0])); });
  R('STEYX', 2, 2, (a, ctx) => { const l = linreg(...pairs(ctx, a[0], a[1])); if (l.n < 3) throw ERR.DIV0; return Math.sqrt((l.syy - l.sxy * l.sxy / l.sxx) / (l.n - 2)); });
  R('TREND', 1, 3, (a, ctx) => {
    const ys = flatVals(ctx, a[0]).map(num), xs = a[1] != null ? flatVals(ctx, a[1]).map(num) : ys.map((_, i) => i + 1);
    const l = linreg(ys, xs), nx = a[2] != null ? F.toMatrix(ctx, a[2]) : xs.map(x => [x]);
    return nx.map(row => row.map(x => l.icpt + l.slope * num(x)));
  });
  R('COVARIANCE.P|COVAR', 2, 2, (a, ctx) => { const [y, x] = pairs(ctx, a[0], a[1]); if (!x.length) throw ERR.DIV0; const my = mean(y), mx = mean(x); return sum(x.map((v, i) => (v - mx) * (y[i] - my))) / x.length; });
  R('COVARIANCE.S', 2, 2, (a, ctx) => { const [y, x] = pairs(ctx, a[0], a[1]); if (x.length < 2) throw ERR.DIV0; const my = mean(y), mx = mean(x); return sum(x.map((v, i) => (v - mx) * (y[i] - my))) / (x.length - 1); });
  R('GEOMEAN', 1, null, (a, ctx) => { const x = nums(ctx, a); if (!x.length || x.some(v => v <= 0)) throw ERR.NUM; return Math.exp(mean(x.map(Math.log))); });
  R('HARMEAN', 1, null, (a, ctx) => { const x = nums(ctx, a); if (!x.length || x.some(v => v <= 0)) throw ERR.NUM; return x.length / sum(x.map(v => 1 / v)); });
  R('AVEDEV', 1, null, (a, ctx) => { const x = nums(ctx, a); if (!x.length) throw ERR.NUM; const m = mean(x); return mean(x.map(v => Math.abs(v - m))); });
  R('DEVSQ', 1, null, (a, ctx) => { const x = nums(ctx, a); const m = x.length ? mean(x) : 0; return sum(x.map(v => (v - m) ** 2)); });
  R('TRIMMEAN', 2, 2, (a, ctx) => { const x = sorted(nums(ctx, [a[0]])), p = num(F.scalar(ctx, a[1])); if (p < 0 || p >= 1) throw ERR.NUM; const k = Math.floor(x.length * p / 2); const y = x.slice(k, x.length - k); return mean(y); });
  R('KURT', 1, null, (a, ctx) => { const x = nums(ctx, a), n = x.length; if (n < 4) throw ERR.DIV0; const m = mean(x), s = Math.sqrt(variance(x, true)); const k = sum(x.map(v => ((v - m) / s) ** 4)); return n * (n + 1) / ((n - 1) * (n - 2) * (n - 3)) * k - 3 * (n - 1) ** 2 / ((n - 2) * (n - 3)); });
  R('SKEW', 1, null, (a, ctx) => { const x = nums(ctx, a), n = x.length; if (n < 3) throw ERR.DIV0; const m = mean(x), s = Math.sqrt(variance(x, true)); return n / ((n - 1) * (n - 2)) * sum(x.map(v => ((v - m) / s) ** 3)); });
  S('STANDARDIZE', 3, 3, ([x, m, s]) => { s = num(s); if (s <= 0) throw ERR.NUM; return (num(x) - num(m)) / s; });
  // normal distribution
  function erf(x) {
    // W. J. Cody rational approximations via erfc; accurate to ~1e-14
    const ax = Math.abs(x);
    if (ax < 0.5) {
      const t = x * x;
      const p = [3.16112374387056560e00, 1.13864154151050156e02, 3.77485237685302021e02, 3.20937758913846947e03, 1.85777706184603153e-1];
      const q = [2.36012909523441209e01, 2.44024637934444173e02, 1.28261652607737228e03, 2.84423683343917062e03];
      let num_ = p[4] * t, den = t;
      for (let i = 0; i < 3; i++) { num_ = (num_ + p[i]) * t; den = (den + q[i]) * t; }
      return x * (num_ + p[3]) / (den + q[3]);
    }
    return x < 0 ? -(1 - erfc(ax)) : 1 - erfc(ax);
  }
  function erfc(x) {
    const ax = Math.abs(x);
    if (ax < 0.5) return 1 - erf(x);
    let r;
    if (ax <= 4) {
      const c = [5.64188496988670089e-1, 8.88314979438837594e00, 6.61191906371416295e01, 2.98635138197400131e02, 8.81952221241769090e02, 1.71204761263407058e03, 2.05107837782607147e03, 1.23033935479799725e03, 2.15311535474403846e-8];
      const d = [1.57449261107098347e01, 1.17693950891312499e02, 5.37181101862009858e02, 1.62138957456669019e03, 3.29079923573345963e03, 4.36261909014324716e03, 3.43936767414372164e03, 1.23033935480374942e03];
      let n_ = c[8] * ax, den = ax;
      for (let i = 0; i < 7; i++) { n_ = (n_ + c[i]) * ax; den = (den + d[i]) * ax; }
      r = (n_ + c[7]) / (den + d[7]);
    } else {
      const p = [3.05326634961232344e-1, 3.60344899949804439e-1, 1.25781726111229246e-1, 1.60837851487422766e-2, 6.58749161529837803e-4, 1.63153871373020978e-2];
      const q = [2.56852019228982242e00, 1.87295284992346725e00, 5.27905102951428412e-1, 6.05183413124413191e-2, 2.33520497626869185e-3];
      const z = 1 / (ax * ax);
      let n_ = p[5] * z, den = z;
      for (let i = 0; i < 4; i++) { n_ = (n_ + p[i]) * z; den = (den + q[i]) * z; }
      r = z * (n_ + p[4]) / (den + q[4]);
      r = (1 / Math.sqrt(Math.PI) - r) / ax;
    }
    r *= Math.exp(-ax * ax);
    return x < 0 ? 2 - r : r;
  }
  const phi = z => 0.5 * erfc(-z / Math.SQRT2);
  function normsinv(p) {
    if (p <= 0 || p >= 1) throw ERR.NUM;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pl = 0.02425; let x;
    if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    else if (p <= 1 - pl) { const q = p - 0.5, r = q * q; x = (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1); }
    else { const q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    // one Halley refinement step
    const e = phi(x) - p, u = e * Math.sqrt(2 * Math.PI) * Math.exp(x * x / 2);
    return x - u / (1 + x * u / 2);
  }
  S('NORM.DIST|NORMDIST', 4, 4, ([x, m, s, c]) => { x = num(x); m = num(m); s = num(s); if (s <= 0) throw ERR.NUM; const z = (x - m) / s; return bool(c) ? phi(z) : Math.exp(-z * z / 2) / (s * Math.sqrt(2 * Math.PI)); });
  S('NORM.S.DIST', 2, 2, ([z, c]) => { z = num(z); return bool(c) ? phi(z) : Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI); });
  S('NORMSDIST', 1, 1, ([z]) => phi(num(z)));
  S('NORM.INV|NORMINV', 3, 3, ([p, m, s]) => { s = num(s); if (s <= 0) throw ERR.NUM; return num(m) + s * normsinv(num(p)); });
  S('NORM.S.INV|NORMSINV', 1, 1, ([p]) => normsinv(num(p)));
  S('ERF', 1, 2, ([a, b]) => b == null ? erf(num(a)) : erf(num(b)) - erf(num(a)));
  S('ERFC', 1, 1, ([x]) => erfc(num(x)));
  S('EXPON.DIST|EXPONDIST', 3, 3, ([x, l, c]) => { x = num(x); l = num(l); if (x < 0 || l <= 0) throw ERR.NUM; return bool(c) ? 1 - Math.exp(-l * x) : l * Math.exp(-l * x); });
  S('BINOM.DIST|BINOMDIST', 4, 4, ([k, n, p, c]) => { k = Math.trunc(num(k)); n = Math.trunc(num(n)); p = num(p); if (k < 0 || k > n || p < 0 || p > 1) throw ERR.NUM; const pmf = i => combin(n, i) * Math.pow(p, i) * Math.pow(1 - p, n - i); if (!bool(c)) return pmf(k); let s = 0; for (let i = 0; i <= k; i++) s += pmf(i); return s; });
  S('POISSON.DIST|POISSON', 3, 3, ([k, l, c]) => { k = Math.trunc(num(k)); l = num(l); if (k < 0 || l < 0) throw ERR.NUM; const pmf = i => Math.exp(-l + i * Math.log(l || 1e-300) - lnGamma(i + 1)); if (!bool(c)) return l === 0 ? +(k === 0) : pmf(k); let s = 0; for (let i = 0; i <= k; i++) s += l === 0 ? +(i === 0) : pmf(i); return s; });
  function lnGamma(z) { const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61503916999185, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]; if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lnGamma(1 - z); z -= 1; let x = c[0]; for (let i = 1; i < g + 2; i++) x += c[i] / (z + i); const t = z + g + 0.5; return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x); }
  S('GAMMALN|GAMMALN.PRECISE', 1, 1, ([x]) => { x = num(x); if (x <= 0) throw ERR.NUM; return lnGamma(x); });
  S('GAMMA', 1, 1, ([x]) => { x = num(x); if (x <= 0 && Number.isInteger(x)) throw ERR.NUM; return x > 0 ? Math.exp(lnGamma(x)) : Math.PI / (Math.sin(Math.PI * x) * Math.exp(lnGamma(1 - x))); });
  R('SUBTOTAL', 2, null, (a, ctx) => {
    const code = Math.trunc(num(F.scalar(ctx, a[0]))), skipManual = code > 100, k = code % 100;
    const vals = [];
    for (const arg of a.slice(1)) {
      if (arg instanceof Ref) {
        const b = ctx.bounds(arg.sheet), r2 = Math.min(arg.r2, b.r), c2 = Math.min(arg.c2, b.c);
        for (let r = arg.r1; r <= r2; r++) {
          const h = ctx.rowHidden ? ctx.rowHidden(arg.sheet, r) : false;
          if (h === 'filter' || (h && skipManual)) continue;
          for (let c = arg.c1; c <= c2; c++) { if (ctx.isSubtotal && ctx.isSubtotal(arg.sheet, r, c)) continue; vals.push(ctx.value(arg.sheet, r, c)); }
        }
      } else iter(ctx, arg, v => vals.push(v));
    }
    const arr = [vals];
    const fns = { 1: 'AVERAGE', 2: 'COUNT', 3: 'COUNTA', 4: 'MAX', 5: 'MIN', 6: 'PRODUCT', 7: 'STDEV', 8: 'STDEVP', 9: 'SUM', 10: 'VAR', 11: 'VARP' };
    if (!fns[k]) return ERR.VALUE;
    return FN[fns[k]].fn([arr], ctx);
  });
  FN.SUBTOTAL.subtotal = true;
  R('FREQUENCY', 2, 2, (a, ctx) => { const d = nums(ctx, [a[0]]), bins = sorted(nums(ctx, [a[1]])); const out = new Array(bins.length + 1).fill(0); d.forEach(v => { let i = bins.findIndex(b => v <= b); if (i < 0) i = bins.length; out[i]++; }); return out.map(v => [v]); });

  /* ================= LOGICAL ================= */
  function logicals(ctx, args) {
    const out = [];
    for (const arg of args) iter(ctx, arg, (v, inRef) => {
      if (v instanceof FErr) throw v;
      if (typeof v === 'boolean') out.push(v);
      else if (typeof v === 'number') out.push(v !== 0);
      else if (!inRef && typeof v === 'string') out.push(bool(v));
    });
    if (!out.length) throw ERR.VALUE;
    return out;
  }
  R('AND', 1, null, (a, ctx) => logicals(ctx, a).every(Boolean));
  R('OR', 1, null, (a, ctx) => logicals(ctx, a).some(Boolean));
  R('XOR', 1, null, (a, ctx) => logicals(ctx, a).filter(Boolean).length % 2 === 1);
  S('NOT', 1, 1, ([x]) => !bool(x));
  S('TRUE', 0, 0, () => true); S('FALSE', 0, 0, () => false);
  const ev = (n, ctx) => F.evaluate(n, ctx);
  L('IF', 1, 3, (args, ctx) => {
    const c = ev(args[0], ctx);
    const pick = (cv, t, f) => { if (cv instanceof FErr) return cv; let b; try { b = bool(cv); } catch (e) { return ERR.VALUE; } return b ? t() : f(); };
    const T = () => args.length > 1 ? (args[1].t === 'missing' ? 0 : ev(args[1], ctx)) : true;
    const Fv = () => args.length > 2 ? (args[2].t === 'missing' ? 0 : ev(args[2], ctx)) : false;
    if (F.isArrayish(c)) {
      const M = F.toMatrix(ctx, c), tv = T(), fv = Fv();
      const tm = F.isArrayish(tv) ? F.toMatrix(ctx, tv) : null, fm = F.isArrayish(fv) ? F.toMatrix(ctx, fv) : null;
      const ts = tm ? null : F.scalar(ctx, tv), fs = fm ? null : F.scalar(ctx, fv);
      const g = (m, s, i, j) => m ? (m[m.length === 1 ? 0 : i] || [])[m[0].length === 1 ? 0 : j] ?? ERR.NA : s;
      return M.map((row, i) => row.map((cv, j) => pick(cv, () => g(tm, ts, i, j), () => g(fm, fs, i, j))));
    }
    return pick(F.scalar(ctx, c), T, Fv);
  });
  L('IFS', 2, null, (args, ctx) => {
    if (args.length % 2) return ERR.VALUE;
    for (let i = 0; i < args.length; i += 2) {
      const c = F.scalar(ctx, ev(args[i], ctx)); if (c instanceof FErr) return c;
      if (bool(c)) return ev(args[i + 1], ctx);
    }
    return ERR.NA;
  });
  S('IFERROR', 2, 2, ([v, alt]) => v instanceof FErr ? (alt == null ? 0 : alt) : (v == null ? 0 : v), { err: true });
  S('IFNA', 2, 2, ([v, alt]) => v instanceof FErr && v.code === '#N/A' ? (alt == null ? 0 : alt) : (v == null ? 0 : v), { err: true });
  L('SWITCH', 3, null, (args, ctx) => {
    const v = F.scalar(ctx, ev(args[0], ctx)); if (v instanceof FErr) return v;
    let i = 1;
    for (; i + 1 < args.length; i += 2) { const c = F.scalar(ctx, ev(args[i], ctx)); if (c instanceof FErr) return c; if (F.compare(v, c) === 0 && typeof v === typeof c) return ev(args[i + 1], ctx); }
    return i < args.length ? ev(args[i], ctx) : ERR.NA;
  });
  L('CHOOSE', 2, null, (args, ctx) => {
    const iv = ev(args[0], ctx);
    if (F.isArrayish(iv)) return F.toMatrix(ctx, iv).map(row => row.map(x => { const i = Math.trunc(num(x)); if (i < 1 || i >= args.length) return ERR.VALUE; return F.scalar(ctx, ev(args[i], ctx)); }));
    const i = Math.trunc(num(F.scalar(ctx, iv)));
    if (i < 1 || i >= args.length) return ERR.VALUE;
    return ev(args[i], ctx);
  });
  L('LET', 3, null, (args, ctx) => {
    if (args.length % 2 === 0) return ERR.VALUE;
    const scope = { parent: ctx.scope, vars: new Map() }, c2 = Object.assign(Object.create(Object.getPrototypeOf(ctx)), ctx, { scope });
    for (let i = 0; i < args.length - 1; i += 2) {
      if (args[i].t !== 'name') return ERR.VALUE;
      scope.vars.set(args[i].name.toUpperCase(), ev(args[i + 1], c2));
    }
    return ev(args[args.length - 1], c2);
  });

  /* ================= LOOKUP & REFERENCE ================= */
  const eqLookup = (a, b) => {
    if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
    return a === b || (a == null && b === '') ;
  };
  function findExact(list, v, wild, fromEnd) {
    const re = wild && typeof v === 'string' && hasWild(v) ? wildRe(v) : null;
    const n = list.length;
    for (let k = 0; k < n; k++) { const i = fromEnd ? n - 1 - k : k, x = list[i]; if (re ? typeof x === 'string' && re.test(x) : eqLookup(x, v)) return i; }
    return -1;
  }
  // binary search on ascending data: last index with x <= v (same type)
  function findApprox(list, v, desc) {
    let lo = 0, hi = list.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1; let x = list[mid];
      // skip blanks / other types like Excel by probing linearly
      let m = mid; while (m <= hi && (x == null || typeRank(x) !== typeRank(v))) { m++; x = list[m]; }
      if (m > hi) { hi = mid - 1; continue; }
      const c = F.compare(x, v);
      if (desc ? c >= 0 : c <= 0) { best = m; lo = m + 1; } else hi = mid - 1;
    }
    return best;
  }
  const typeRank = v => typeof v === 'number' ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3;
  function vector(ctx, v) { // 1-D list from a row or column range
    const M = mat(ctx, v);
    if (M.length === 1) return M[0];
    return M.map(r => r[0]);
  }
  R('VLOOKUP', 3, 4, (a, ctx) => {
    const v = F.scalar(ctx, a[0]); if (v instanceof FErr) return v;
    const col = Math.trunc(num(F.scalar(ctx, a[2]))), approx = a[3] == null ? true : bool(F.scalar(ctx, a[3]));
    const tbl = a[1]; const [, cols] = dims(tbl);
    if (col < 1) return ERR.VALUE; if (col > cols) return ERR.REF;
    const M = mat(ctx, tbl), first = M.map(r => r[0]);
    const i = approx ? findApprox(first, v) : findExact(first, v, true);
    if (i < 0) return ERR.NA;
    const x = tbl instanceof Ref ? ctx.value(tbl.sheet, tbl.r1 + i, tbl.c1 + col - 1) : M[i][col - 1];
    return x == null ? 0 : x;
  });
  R('HLOOKUP', 3, 4, (a, ctx) => {
    const v = F.scalar(ctx, a[0]); if (v instanceof FErr) return v;
    const row = Math.trunc(num(F.scalar(ctx, a[2]))), approx = a[3] == null ? true : bool(F.scalar(ctx, a[3]));
    const tbl = a[1]; const [rows] = dims(tbl);
    if (row < 1) return ERR.VALUE; if (row > rows) return ERR.REF;
    const M = mat(ctx, tbl), first = M[0];
    const i = approx ? findApprox(first, v) : findExact(first, v, true);
    if (i < 0) return ERR.NA;
    const x = tbl instanceof Ref ? ctx.value(tbl.sheet, tbl.r1 + row - 1, tbl.c1 + i) : M[row - 1][i];
    return x == null ? 0 : x;
  });
  R('LOOKUP', 2, 3, (a, ctx) => {
    const v = F.scalar(ctx, a[0]); if (v instanceof FErr) return v;
    let look, res;
    if (a[2] != null) { look = vector(ctx, a[1]); res = vector(ctx, a[2]); }
    else { const M = mat(ctx, a[1]); if (M.length >= M[0].length) { look = M.map(r => r[0]); res = M.map(r => r[r.length - 1]); } else { look = M[0]; res = M[M.length - 1]; } }
    const i = findApprox(look, v); if (i < 0) return ERR.NA;
    return res[i] ?? ERR.NA;
  });
  function matchIdx(list, v, type) {
    if (type === 0) return findExact(list, v, true);
    if (type > 0) return findApprox(list, v);
    // descending: first index where x >= v... Excel: smallest value >= lookup in descending list
    let best = -1; for (let i = 0; i < list.length; i++) { if (list[i] == null) continue; if (F.compare(list[i], v) >= 0) best = i; else break; } return best;
  }
  R('MATCH', 2, 3, (a, ctx) => {
    const v = F.scalar(ctx, a[0]); if (v instanceof FErr) return v;
    const type = a[2] == null ? 1 : Math.sign(num(F.scalar(ctx, a[2])));
    const [r, c] = dims(a[1]); if (r > 1 && c > 1) return ERR.NA;
    const i = matchIdx(vector(ctx, a[1]), v, type);
    return i < 0 ? ERR.NA : i + 1;
  });
  function xfind(list, v, mode, search) {
    const n = list.length;
    if (mode === 0 || mode === 2) return findExact(list, v, mode === 2, search === -1 || search === -2);
    // next smaller (-1) / next larger (1)
    let ex = findExact(list, v, false, search < 0); if (ex >= 0) return ex;
    let best = -1;
    for (let k = 0; k < n; k++) {
      const i = search < 0 ? n - 1 - k : k, x = list[i];
      if (x == null || typeRank(x) !== typeRank(v)) continue;
      const c = F.compare(x, v);
      if (mode === -1 && c < 0 && (best < 0 || F.compare(x, list[best]) > 0)) best = i;
      if (mode === 1 && c > 0 && (best < 0 || F.compare(x, list[best]) < 0)) best = i;
    }
    return best;
  }
  R('XLOOKUP', 3, 6, (a, ctx) => {
    const lv = a[0], g = (i, d) => a[i] == null ? d : Math.trunc(num(F.scalar(ctx, a[i])));
    const mode = g(4, 0), search = g(5, 1);
    const [lr, lc] = dims(a[1]); if (lr > 1 && lc > 1) return ERR.VALUE;
    const list = vector(ctx, a[1]), vertical = lr > 1 || lc === 1;
    const one = v => {
      if (v instanceof FErr) return v;
      const i = xfind(list, v, mode, search);
      if (i < 0) return a[3] != null ? F.scalar(ctx, a[3]) ?? ERR.NA : ERR.NA;
      const rv = a[2];
      if (rv instanceof Ref) {
        const r = vertical ? new Ref(rv.sheet, rv.r1 + i, rv.c1, rv.r1 + i, rv.c2) : new Ref(rv.sheet, rv.r1, rv.c1 + i, rv.r2, rv.c1 + i);
        return r.single ? r : r;
      }
      const M = mat(ctx, rv);
      return vertical ? (M.length === 1 ? M[0][i] : [M[i]]) : M.map(r => [r[i]]);
    };
    if (F.isArrayish(lv)) return F.toMatrix(ctx, lv).map(row => row.map(v => { const r = one(v); return r instanceof Ref ? ctx.value(r.sheet, r.r1, r.c1) : Array.isArray(r) ? r[0][0] : r; }));
    const r = one(F.scalar(ctx, lv));
    if (Array.isArray(r) && r.length === 1 && r[0].length === 1) return r[0][0];
    return r;
  });
  R('XMATCH', 2, 4, (a, ctx) => {
    const v = F.scalar(ctx, a[0]); if (v instanceof FErr) return v;
    const g = (i, d) => a[i] == null ? d : Math.trunc(num(F.scalar(ctx, a[i])));
    const i = xfind(vector(ctx, a[1]), v, g(2, 0), g(3, 1));
    return i < 0 ? ERR.NA : i + 1;
  });
  R('INDEX', 2, 4, (a, ctx) => {
    const src = a[0], r = Math.trunc(num(F.scalar(ctx, a[1]))), c0 = a[2] == null ? null : Math.trunc(num(F.scalar(ctx, a[2])));
    const [rows, cols] = dims(src);
    let ri = r, ci = c0 == null ? (rows === 1 && cols > 1 ? r : 1) : c0;
    if (c0 == null && rows === 1 && cols > 1) ri = 1;
    if (ri < 0 || ci < 0 || ri > rows || ci > cols) return ERR.REF;
    if (src instanceof Ref) {
      const R1 = ri === 0 ? src.r1 : src.r1 + ri - 1, R2 = ri === 0 ? src.r2 : R1;
      const C1 = ci === 0 ? src.c1 : src.c1 + ci - 1, C2 = ci === 0 ? src.c2 : C1;
      return new Ref(src.sheet, R1, C1, R2, C2);
    }
    const M = mat(ctx, src);
    if (ri === 0) return M.map(row => [row[ci - 1]]);
    if (ci === 0) return [M[ri - 1]];
    return M[ri - 1][ci - 1];
  });
  R('OFFSET', 3, 5, (a, ctx) => {
    const ref = a[0]; if (!(ref instanceof Ref)) return ERR.VALUE;
    const dr = Math.trunc(num(F.scalar(ctx, a[1]))), dc = Math.trunc(num(F.scalar(ctx, a[2])));
    const h = a[3] == null ? ref.rows : Math.trunc(num(F.scalar(ctx, a[3]))), w = a[4] == null ? ref.cols : Math.trunc(num(F.scalar(ctx, a[4])));
    if (h < 1 || w < 1) return ERR.REF;
    const r1 = ref.r1 + dr, c1 = ref.c1 + dc;
    if (r1 < 0 || c1 < 0 || r1 + h > F.MAXR || c1 + w > F.MAXC) return ERR.REF;
    return new Ref(ref.sheet, r1, c1, r1 + h - 1, c1 + w - 1);
  }, { vol: true });
  R('INDIRECT', 1, 2, (a, ctx) => {
    const t = str(F.scalar(ctx, a[0])).trim(), a1 = a[1] == null ? true : bool(F.scalar(ctx, a[1]));
    let pr;
    if (a1) pr = F.parseRange(t);
    else {
      const m = /^(?:(?:'((?:[^']|'')+)'|([^!]+))!)?R(\d+)C(\d+)(?::R(\d+)C(\d+))?$/i.exec(t);
      if (m) pr = { sheet: m[1] ? m[1].replace(/''/g, "'") : m[2] || null, r1: +m[3] - 1, c1: +m[4] - 1, r2: +(m[5] || m[3]) - 1, c2: +(m[6] || m[4]) - 1 };
    }
    if (!pr) { const nm = ctx.name ? ctx.name(t) : null; return nm instanceof Ref ? nm : ERR.REF; }
    const sheet = pr.sheet != null ? ctx.sheetByName(pr.sheet) : ctx.sheet; if (!sheet) return ERR.REF;
    return new Ref(sheet, pr.r1, pr.c1, pr.r2, pr.c2);
  }, { vol: true });
  R('ROW', 0, 1, (a, ctx) => { if (!a.length || a[0] == null) return ctx.r + 1; const r = a[0]; if (!(r instanceof Ref)) return ERR.VALUE; return r.rows === 1 ? r.r1 + 1 : Array.from({ length: Math.min(r.rows, 1e6) }, (_, i) => [r.r1 + i + 1]); });
  R('COLUMN', 0, 1, (a, ctx) => { if (!a.length || a[0] == null) return ctx.c + 1; const r = a[0]; if (!(r instanceof Ref)) return ERR.VALUE; return r.cols === 1 ? r.c1 + 1 : [Array.from({ length: r.cols }, (_, i) => r.c1 + i + 1)]; });
  R('ROWS', 1, 1, a => dims(a[0])[0]);
  R('COLUMNS', 1, 1, a => dims(a[0])[1]);
  R('AREAS', 1, 1, a => a[0] instanceof Ref ? 1 : ERR.VALUE);
  S('ADDRESS', 2, 5, ([r, c, abs, a1, sh]) => {
    r = Math.trunc(num(r)); c = Math.trunc(num(c)); abs = abs == null ? 1 : Math.trunc(num(abs)); a1 = a1 == null ? true : bool(a1);
    if (r < 1 || c < 1 || r > F.MAXR || c > F.MAXC) throw ERR.VALUE;
    let s;
    if (a1) s = (abs === 1 || abs === 3 ? '$' : '') + F.colName(c - 1) + (abs === 1 || abs === 2 ? '$' : '') + r;
    else s = 'R' + (abs === 1 || abs === 2 ? r : '[' + r + ']') + 'C' + (abs === 1 || abs === 3 ? c : '[' + c + ']');
    return (sh != null && sh !== '' ? F.quoteSheet(str(sh)) + '!' : '') + s;
  });
  R('TRANSPOSE', 1, 1, (a, ctx) => { const M = mat(ctx, a[0]); return M[0].map((_, j) => M.map(r => r[j] ?? null)); });
  R('FILTER', 2, 3, (a, ctx) => {
    const M = F.toFullMatrix(ctx, a[0]), inc = F.toFullMatrix(ctx, a[1]);
    let out;
    const truthy = v => { if (v instanceof FErr) throw v; return typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : false; };
    if (inc[0].length === 1 && inc.length === M.length) out = M.filter((_, i) => truthy(inc[i][0]));
    else if (inc.length === 1 && inc[0].length === M[0].length) { const keep = inc[0].map(truthy); out = M.map(r => r.filter((_, j) => keep[j])); if (!out[0].length) out = []; }
    else return ERR.VALUE;
    if (!out.length) return a[2] != null ? F.scalar(ctx, a[2]) : ERR.CALC;
    return out;
  });
  R('SORT', 1, 4, (a, ctx) => {
    const M = mat(ctx, a[0]).map(r => r.slice());
    const idx = a[1] == null ? 1 : Math.trunc(num(F.scalar(ctx, a[1]))), ord = a[2] == null ? 1 : num(F.scalar(ctx, a[2])), byCol = a[3] == null ? false : bool(F.scalar(ctx, a[3]));
    const cmp = (x, y) => (x == null) - (y == null) || F.compare(x, y) * (ord < 0 ? -1 : 1);
    if (!byCol) { if (idx < 1 || idx > M[0].length) return ERR.VALUE; return M.sort((p, q) => cmp(p[idx - 1], q[idx - 1])); }
    if (idx < 1 || idx > M.length) return ERR.VALUE;
    const order = M[0].map((_, j) => j).sort((p, q) => cmp(M[idx - 1][p], M[idx - 1][q]));
    return M.map(r => order.map(j => r[j]));
  });
  R('SORTBY', 2, null, (a, ctx) => {
    const M = mat(ctx, a[0]); const keys = [];
    for (let i = 1; i < a.length; i += 2) { const k = vector(ctx, a[i]); if (k.length !== M.length) return ERR.VALUE; keys.push([k, a[i + 1] == null ? 1 : num(F.scalar(ctx, a[i + 1]))]); }
    const order = M.map((_, i) => i).sort((p, q) => { for (const [k, o] of keys) { const c = F.compare(k[p], k[q]); if (c) return c * (o < 0 ? -1 : 1); } return p - q; });
    return order.map(i => M[i]);
  });
  R('UNIQUE', 1, 3, (a, ctx) => {
    const M = mat(ctx, a[0]), byCol = a[1] == null ? false : bool(F.scalar(ctx, a[1])), once = a[2] == null ? false : bool(F.scalar(ctx, a[2]));
    const items = byCol ? M[0].map((_, j) => M.map(r => r[j])) : M;
    const key = r => r.map(v => typeof v === 'string' ? 's' + v.toLowerCase() : typeof v + String(v)).join('\u0001');
    const cnt = new Map(); items.forEach(r => { const k = key(r); cnt.set(k, (cnt.get(k) || 0) + 1); });
    const seen = new Set(), out = [];
    items.forEach(r => { const k = key(r); if (seen.has(k)) return; seen.add(k); if (!once || cnt.get(k) === 1) out.push(r); });
    if (!out.length) return ERR.CALC;
    return byCol ? out[0].map((_, i) => out.map(r => r[i])) : out;
  });
  R('VSTACK', 1, null, (a, ctx) => { const ms = a.map(v => mat(ctx, v)), w = Math.max(...ms.map(m => m[0].length)); return ms.flatMap(m => m.map(r => r.concat(new Array(w - r.length).fill(ERR.NA)))); });
  R('HSTACK', 1, null, (a, ctx) => { const ms = a.map(v => mat(ctx, v)), h = Math.max(...ms.map(m => m.length)); return Array.from({ length: h }, (_, i) => ms.flatMap(m => m[i] || new Array(m[0].length).fill(ERR.NA))); });
  R('TAKE', 2, 3, (a, ctx) => { const M = mat(ctx, a[0]); const r = a[1] == null ? M.length : Math.trunc(num(F.scalar(ctx, a[1]))), c = a[2] == null ? M[0].length : Math.trunc(num(F.scalar(ctx, a[2]))); const rows = r >= 0 ? M.slice(0, r) : M.slice(r); const out = rows.map(x => c >= 0 ? x.slice(0, c) : x.slice(c)); return out.length && out[0].length ? out : ERR.CALC; });
  R('DROP', 2, 3, (a, ctx) => { const M = mat(ctx, a[0]); const r = a[1] == null ? 0 : Math.trunc(num(F.scalar(ctx, a[1]))), c = a[2] == null ? 0 : Math.trunc(num(F.scalar(ctx, a[2]))); const rows = r >= 0 ? M.slice(r) : M.slice(0, r); const out = rows.map(x => c >= 0 ? x.slice(c) : x.slice(0, c)); return out.length && out[0].length ? out : ERR.CALC; });
  S('HYPERLINK', 1, 2, ([url, name]) => name == null ? str(url) : name);

  /* ================= TEXT ================= */
  const chars = s => Array.from(s);
  S('LEFT', 1, 2, ([t, n]) => { t = str(t); n = n == null ? 1 : Math.trunc(num(n)); if (n < 0) throw ERR.VALUE; return chars(t).slice(0, n).join(''); });
  S('RIGHT', 1, 2, ([t, n]) => { t = str(t); n = n == null ? 1 : Math.trunc(num(n)); if (n < 0) throw ERR.VALUE; const c = chars(t); return n === 0 ? '' : c.slice(Math.max(0, c.length - n)).join(''); });
  S('MID', 3, 3, ([t, s, n]) => { t = str(t); s = Math.trunc(num(s)); n = Math.trunc(num(n)); if (s < 1 || n < 0) throw ERR.VALUE; return chars(t).slice(s - 1, s - 1 + n).join(''); });
  S('LEN', 1, 1, ([t]) => chars(str(t)).length);
  S('LOWER', 1, 1, ([t]) => str(t).toLowerCase());
  S('UPPER', 1, 1, ([t]) => str(t).toUpperCase());
  S('PROPER', 1, 1, ([t]) => str(t).toLowerCase().replace(/(^|[^a-zA-ZÀ-￿])([a-zà-￿])/g, (m, p, c) => p + c.toUpperCase()));
  S('TRIM', 1, 1, ([t]) => str(t).replace(/ +/g, ' ').trim());
  S('CLEAN', 1, 1, ([t]) => str(t).replace(/[\x00-\x1f]/g, ''));
  S('SUBSTITUTE', 3, 4, ([t, o, n, k]) => {
    t = str(t); o = str(o); n = str(n); if (!o) return t;
    if (k == null) return t.split(o).join(n);
    k = Math.trunc(num(k)); if (k < 1) throw ERR.VALUE;
    let idx = -1; for (let i = 0; i < k; i++) { idx = t.indexOf(o, idx + 1); if (idx < 0) return t; }
    return t.slice(0, idx) + n + t.slice(idx + o.length);
  });
  S('REPLACE', 4, 4, ([t, s, n, x]) => { t = str(t); s = Math.trunc(num(s)); n = Math.trunc(num(n)); if (s < 1 || n < 0) throw ERR.VALUE; return t.slice(0, s - 1) + str(x) + t.slice(s - 1 + n); });
  S('FIND', 2, 3, ([f, t, s]) => { f = str(f); t = str(t); s = s == null ? 1 : Math.trunc(num(s)); if (s < 1 || s > t.length + 1) throw ERR.VALUE; const i = t.indexOf(f, s - 1); if (i < 0) throw ERR.VALUE; return i + 1; });
  S('SEARCH', 2, 3, ([f, t, s]) => {
    f = str(f); t = str(t); s = s == null ? 1 : Math.trunc(num(s)); if (s < 1 || s > t.length + 1) throw ERR.VALUE;
    if (hasWild(f)) { const re = new RegExp(wildRe(f).source.slice(1, -1), 'i'); const m = re.exec(t.slice(s - 1)); if (!m) throw ERR.VALUE; return m.index + s; }
    const i = t.toLowerCase().indexOf(f.toLowerCase(), s - 1); if (i < 0) throw ERR.VALUE; return i + 1;
  });
  S('TEXT', 2, 2, ([v, f]) => {
    f = str(f);
    if (typeof v === 'string') { const p = Fmt.parseInput(v); if (typeof p.v === 'number') v = p.v; else return Fmt.format(v, f).text; }
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return Fmt.format(v == null ? 0 : num(v), f).text;
  });
  S('VALUE', 1, 1, ([t]) => { if (typeof t === 'number') return t; const s = str(t).trim(); if (s === '') return 0; const p = Fmt.parseInput(s); if (typeof p.v === 'number') return p.v; throw ERR.VALUE; });
  S('NUMBERVALUE', 1, 3, ([t, d, g]) => { let s = str(t).replace(/\s/g, ''); d = d == null ? '.' : str(d)[0]; g = g == null ? ',' : str(g)[0]; s = s.split(g).join(''); s = s.replace(d, '.'); let pct = 0; while (s.endsWith('%')) { pct++; s = s.slice(0, -1); } if (s === '') return 0; const x = Number(s); if (isNaN(x)) throw ERR.VALUE; return x / Math.pow(100, pct); });
  S('REPT', 2, 2, ([t, n]) => { n = Math.trunc(num(n)); if (n < 0) throw ERR.VALUE; const s = str(t); if (s.length * n > 32767) throw ERR.VALUE; return s.repeat(n); });
  S('EXACT', 2, 2, ([a, b]) => str(a) === str(b));
  S('CHAR', 1, 1, ([n]) => { n = Math.trunc(num(n)); if (n < 1 || n > 255) throw ERR.VALUE; return String.fromCharCode(n); });
  S('CODE', 1, 1, ([t]) => { t = str(t); if (!t) throw ERR.VALUE; return t.charCodeAt(0); });
  S('UNICHAR', 1, 1, ([n]) => { n = Math.trunc(num(n)); if (n < 1 || n > 0x10ffff) throw ERR.VALUE; return String.fromCodePoint(n); });
  S('UNICODE', 1, 1, ([t]) => { t = str(t); if (!t) throw ERR.VALUE; return t.codePointAt(0); });
  S('T', 1, 1, ([v]) => typeof v === 'string' ? v : '', { err: false });
  S('N', 1, 1, ([v]) => typeof v === 'number' ? v : typeof v === 'boolean' ? +v : 0);
  const fixedStr = (x, d, commas) => { const r = roundTo(x, d); const s = Math.abs(r).toFixed(Math.max(0, d)); const [i, f] = s.split('.'); return (r < 0 ? '-' : '') + (commas ? i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : i) + (f ? '.' + f : ''); };
  S('FIXED', 1, 3, ([x, d, nc]) => fixedStr(num(x), d == null ? 2 : Math.trunc(num(d)), !(nc != null && bool(nc))));
  S('DOLLAR', 1, 2, ([x, d]) => { x = num(x); d = d == null ? 2 : Math.trunc(num(d)); const s = fixedStr(Math.abs(x), d, true); return x < 0 ? '($' + s + ')' : '$' + s; });
  S('CONCATENATE', 1, null, a => a.map(str).join(''));
  R('CONCAT', 1, null, (a, ctx) => { let s = ''; for (const arg of a) iter(ctx, arg, v => { s += str(v); }); return s; });
  R('TEXTJOIN', 3, null, (a, ctx) => {
    const dl = flatVals(ctx, a[0]).map(str), ign = bool(F.scalar(ctx, a[1])), parts = [];
    for (const arg of a.slice(2)) iter(ctx, arg, v => { if (v instanceof FErr) throw v; const s = str(v); if (!(ign && s === '')) parts.push(s); });
    let out = ''; parts.forEach((p, i) => { out += (i ? dl[(i - 1) % dl.length] : '') + p; });
    if (out.length > 32767) throw ERR.VALUE; return out;
  });
  function textPart(before) {
    return ([t, d, n, mm, me, nf]) => {
      t = str(t); d = str(d); n = n == null ? 1 : Math.trunc(num(n));
      const ci = mm != null && num(mm) === 1, tt = ci ? t.toLowerCase() : t, dd = ci ? d.toLowerCase() : d;
      if (n === 0) throw ERR.VALUE;
      let idx = -1;
      if (n > 0) { let from = 0; for (let i = 0; i < n; i++) { idx = tt.indexOf(dd, from); if (idx < 0) break; from = idx + Math.max(1, dd.length); } }
      else { let from = tt.length; for (let i = 0; i < -n; i++) { idx = tt.lastIndexOf(dd, from); if (idx < 0) break; from = idx - 1; } }
      if (idx < 0) { if (me != null && num(me) === 1) return before ? t : ''; if (nf != null) return nf; throw ERR.NA; }
      return before ? t.slice(0, idx) : t.slice(idx + d.length);
    };
  }
  S('TEXTBEFORE', 2, 6, textPart(true)); S('TEXTAFTER', 2, 6, textPart(false));
  R('TEXTSPLIT', 2, 4, (a, ctx) => {
    const t = str(F.scalar(ctx, a[0])), cd = a[1] == null ? null : str(F.scalar(ctx, a[1])), rd = a[2] == null ? null : str(F.scalar(ctx, a[2])), ign = a[3] != null && bool(F.scalar(ctx, a[3]));
    let rows = rd ? t.split(rd) : [t];
    let M = rows.map(r => cd ? r.split(cd) : [r]);
    if (ign) M = M.map(r => r.filter(x => x !== '')).filter(r => r.length);
    const w = Math.max(...M.map(r => r.length));
    return M.map(r => r.concat(new Array(w - r.length).fill(ERR.NA)));
  });

  /* ================= DATE & TIME ================= */
  const P = v => Fmt.serialToParts(v);
  const D = (y, m, d) => Fmt.dateToSerial(y, m, d);
  const dateArg = v => { const x = num(v); if (x < 0) throw ERR.NUM; return Math.floor(x); };
  S('DATE', 3, 3, ([y, m, d]) => { y = Math.trunc(num(y)); m = Math.trunc(num(m)); d = Math.trunc(num(d)); if (y < 0 || y > 9999) throw ERR.NUM; if (y < 1900) y += 1900; const s = D(y, m, d); if (s < 0) throw ERR.NUM; return s; });
  S('TIME', 3, 3, ([h, m, s]) => { const t = (Math.trunc(num(h)) * 3600 + Math.trunc(num(m)) * 60 + Math.trunc(num(s))) / 86400; if (t < 0) throw ERR.NUM; return t - Math.floor(t); });
  S('DATEVALUE', 1, 1, ([t]) => { const p = Fmt.parseInput(str(t)); if (typeof p.v !== 'number' || !p.fmt || !Fmt.isDateFormat(p.fmt)) throw ERR.VALUE; return Math.floor(p.v); });
  S('TIMEVALUE', 1, 1, ([t]) => { const p = Fmt.parseInput(str(t)); if (typeof p.v !== 'number' || !p.fmt || !Fmt.isDateFormat(p.fmt)) throw ERR.VALUE; return p.v - Math.floor(p.v); });
  S('TODAY', 0, 0, (a, ctx) => Math.floor(ctx.now ? ctx.now() : Fmt.nowSerial()), { vol: true });
  S('NOW', 0, 0, (a, ctx) => ctx.now ? ctx.now() : Fmt.nowSerial(), { vol: true });
  S('YEAR', 1, 1, ([v]) => P(dateArg(v)).y);
  S('MONTH', 1, 1, ([v]) => P(dateArg(v)).m);
  S('DAY', 1, 1, ([v]) => P(dateArg(v)).d);
  S('HOUR', 1, 1, ([v]) => { const x = num(v); if (x < 0) throw ERR.NUM; return P(x).H; });
  S('MINUTE', 1, 1, ([v]) => { const x = num(v); if (x < 0) throw ERR.NUM; return P(x).M; });
  S('SECOND', 1, 1, ([v]) => { const x = num(v); if (x < 0) throw ERR.NUM; return Math.round(P(x).S + P(x).ms / 1000); });
  S('WEEKDAY', 1, 2, ([v, t]) => {
    const d = P(dateArg(v)).dow; t = t == null ? 1 : Math.trunc(num(t));
    if (t === 1 || t === 17) return d + 1;
    if (t === 2 || t === 11) return (d + 6) % 7 + 1;
    if (t === 3) return (d + 6) % 7;
    if (t >= 12 && t <= 16) { const start = t - 10; return (d - start + 7) % 7 + 1; }
    throw ERR.NUM;
  });
  function isoWeek(s) { const p = P(s); const dt = new Date(Date.UTC(p.y, p.m - 1, p.d)); const day = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - day + 3); const fy = dt.getUTCFullYear(); const jan4 = new Date(Date.UTC(fy, 0, 4)); return 1 + Math.round(((dt - jan4) / 86400000 - 3 + (jan4.getUTCDay() + 6) % 7) / 7); }
  S('ISOWEEKNUM', 1, 1, ([v]) => isoWeek(dateArg(v)));
  S('WEEKNUM', 1, 2, ([v, t]) => {
    const s = dateArg(v); t = t == null ? 1 : Math.trunc(num(t));
    if (t === 21) return isoWeek(s);
    const startDow = { 1: 0, 17: 0, 2: 1, 11: 1, 12: 2, 13: 3, 14: 4, 15: 5, 16: 6 }[t]; if (startDow == null) throw ERR.NUM;
    const p = P(s), jan1 = D(p.y, 1, 1), jdow = P(jan1).dow;
    const off = (jdow - startDow + 7) % 7;
    return Math.floor((s - jan1 + off) / 7) + 1;
  });
  function addMonths(s, n) { const p = P(s); const y = p.y, m = p.m - 1 + n; const ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12 + 1; const last = new Date(Date.UTC(ty, tm, 0)).getUTCDate(); return D(ty, tm, Math.min(p.d, last)); }
  S('EDATE', 2, 2, ([s, n]) => { const r = addMonths(dateArg(s), Math.trunc(num(n))); if (r < 0) throw ERR.NUM; return r; });
  S('EOMONTH', 2, 2, ([s, n]) => { const p = P(dateArg(s)); const m = p.m - 1 + Math.trunc(num(n)); const ty = p.y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12 + 1; const r = D(ty, tm + 1, 0); if (r < 0) throw ERR.NUM; return r; });
  S('DAYS', 2, 2, ([e, s]) => Math.floor(num(e)) - Math.floor(num(s)));
  S('DATEDIF', 3, 3, ([s, e, u]) => {
    s = dateArg(s); e = dateArg(e); u = str(u).toUpperCase(); if (s > e) throw ERR.NUM;
    const a = P(s), b = P(e);
    let months = (b.y - a.y) * 12 + (b.m - a.m); if (b.d < a.d) months--;
    switch (u) {
      case 'D': return e - s;
      case 'M': return months;
      case 'Y': return Math.floor(months / 12);
      case 'YM': return ((months % 12) + 12) % 12;
      case 'MD': { let d = b.d - a.d; if (d < 0) { const pm = new Date(Date.UTC(b.y, b.m - 1, 0)).getUTCDate(); d += pm; } return d; }
      case 'YD': { let ys = D(b.y, a.m, a.d); if (ys > e) ys = D(b.y - 1, a.m, a.d); return e - ys; }
    }
    throw ERR.NUM;
  });
  S('DAYS360', 2, 3, ([s, e, m]) => {
    const a = P(dateArg(s)), b = P(dateArg(e)), eu = m != null && bool(m);
    let d1 = a.d, d2 = b.d;
    const lastFeb = p => p.m === 2 && p.d === new Date(Date.UTC(p.y, 2, 0)).getUTCDate();
    if (eu) { if (d1 === 31) d1 = 30; if (d2 === 31) d2 = 30; }
    else { if (lastFeb(a) && lastFeb(b)) d2 = 30; if (lastFeb(a) || d1 === 31) d1 = 30; if (d2 === 31 && d1 >= 30) d2 = 30; }
    return (b.y - a.y) * 360 + (b.m - a.m) * 30 + d2 - d1;
  });
  function holidaySet(ctx, h) { const s = new Set(); if (h != null) iter(ctx, h, v => { if (typeof v === 'number') s.add(Math.floor(v)); }); return s; }
  const isWork = (s, hol) => { const d = P(s).dow; return d !== 0 && d !== 6 && !hol.has(s); };
  R('NETWORKDAYS', 2, 3, (a, ctx) => {
    let s = dateArg(F.scalar(ctx, a[0])), e = dateArg(F.scalar(ctx, a[1])); const hol = holidaySet(ctx, a[2]);
    let sign = 1; if (s > e) { [s, e] = [e, s]; sign = -1; }
    let n = 0; for (let d = s; d <= e; d++) if (isWork(d, hol)) n++; return sign * n;
  });
  R('WORKDAY', 2, 3, (a, ctx) => {
    let d = dateArg(F.scalar(ctx, a[0])), n = Math.trunc(num(F.scalar(ctx, a[1]))); const hol = holidaySet(ctx, a[2]);
    const step = n < 0 ? -1 : 1; while (n !== 0) { d += step; if (isWork(d, hol)) n -= step; } return d;
  });
  S('YEARFRAC', 2, 3, ([s, e, b]) => {
    s = dateArg(s); e = dateArg(e); b = b == null ? 0 : Math.trunc(num(b)); if (s > e) [s, e] = [e, s];
    const a = P(s), c = P(e);
    switch (b) {
      case 0: { let d1 = a.d, d2 = c.d; if (d1 === 31) d1 = 30; if (d2 === 31 && d1 >= 30) d2 = 30; const lastFeb = p => p.m === 2 && p.d === new Date(Date.UTC(p.y, 2, 0)).getUTCDate(); if (lastFeb(a)) { d1 = 30; if (lastFeb(c)) d2 = 30; } return ((c.y - a.y) * 360 + (c.m - a.m) * 30 + d2 - d1) / 360; }
      case 1: {
        const leap = y => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
        if (a.y === c.y) return (e - s) / (leap(a.y) ? 366 : 365);
        if (c.y - a.y === 1 && (c.m < a.m || (c.m === a.m && c.d <= a.d))) {
          const feb29 = (leap(a.y) && (a.m < 3)) || (leap(c.y) && (c.m > 2 || (c.m === 2 && c.d === 29)));
          return (e - s) / (feb29 ? 366 : 365);
        }
        let days = 0; for (let y = a.y; y <= c.y; y++) days += leap(y) ? 366 : 365;
        return (e - s) / (days / (c.y - a.y + 1));
      }
      case 2: return (e - s) / 360;
      case 3: return (e - s) / 365;
      case 4: { const d1 = Math.min(a.d, 30), d2 = Math.min(c.d, 30); return ((c.y - a.y) * 360 + (c.m - a.m) * 30 + d2 - d1) / 360; }
    }
    throw ERR.NUM;
  });

  /* ================= INFORMATION ================= */
  S('ISBLANK', 1, 1, ([v]) => v == null, { err: true });
  S('ISNUMBER', 1, 1, ([v]) => typeof v === 'number', { err: true });
  S('ISTEXT', 1, 1, ([v]) => typeof v === 'string', { err: true });
  S('ISNONTEXT', 1, 1, ([v]) => typeof v !== 'string', { err: true });
  S('ISLOGICAL', 1, 1, ([v]) => typeof v === 'boolean', { err: true });
  S('ISERROR', 1, 1, ([v]) => v instanceof FErr, { err: true });
  S('ISERR', 1, 1, ([v]) => v instanceof FErr && v.code !== '#N/A', { err: true });
  S('ISNA', 1, 1, ([v]) => v instanceof FErr && v.code === '#N/A', { err: true });
  S('ISEVEN', 1, 1, ([v]) => Math.trunc(num(v)) % 2 === 0);
  S('ISODD', 1, 1, ([v]) => Math.abs(Math.trunc(num(v))) % 2 === 1);
  R('ISREF', 1, 1, a => a[0] instanceof Ref);
  R('ISFORMULA', 1, 1, (a, ctx) => a[0] instanceof Ref ? !!(ctx.isFormula && ctx.isFormula(a[0].sheet, a[0].r1, a[0].c1)) : ERR.VALUE);
  R('FORMULATEXT', 1, 1, (a, ctx) => { const r = a[0]; if (!(r instanceof Ref)) return ERR.VALUE; const f = ctx.formulaText && ctx.formulaText(r.sheet, r.r1, r.c1); return f ? f : ERR.NA; });
  S('NA', 0, 0, () => ERR.NA);
  S('ERROR.TYPE', 1, 1, ([v]) => { if (!(v instanceof FErr)) throw ERR.NA; return { '#NULL!': 1, '#DIV/0!': 2, '#VALUE!': 3, '#REF!': 4, '#NAME?': 5, '#NUM!': 6, '#N/A': 7, '#SPILL!': 9, '#CALC!': 14 }[v.code] || 8; }, { err: true });
  R('TYPE', 1, 1, (a, ctx) => { const v = a[0]; if (Array.isArray(v) || (v instanceof Ref && !v.single)) return 64; const x = F.scalar(ctx, v); return typeof x === 'number' || x == null ? 1 : typeof x === 'string' ? 2 : typeof x === 'boolean' ? 4 : 16; });
  R('SHEET', 0, 1, (a, ctx) => { const sh = a[0] instanceof Ref ? a[0].sheet : a[0] == null ? ctx.sheet : ctx.sheetByName(str(F.scalar(ctx, a[0]))); return sh && ctx.sheetIndex ? ctx.sheetIndex(sh) + 1 : ERR.NA; });
  R('SHEETS', 0, 1, (a, ctx) => ctx.sheetCount ? ctx.sheetCount() : 1);

  /* ================= FINANCIAL ================= */
  function fvCalc(r, n, pmt, pv, t) { if (r === 0) return -(pv + pmt * n); const f = Math.pow(1 + r, n); return -(pv * f + pmt * (1 + r * t) * (f - 1) / r); }
  function pmtCalc(r, n, pv, fv, t) { if (n === 0) throw ERR.NUM; if (r === 0) return -(pv + fv) / n; const f = Math.pow(1 + r, n); return -(r * (fv + pv * f)) / ((1 + r * t) * (f - 1)); }
  function ipmtCalc(r, per, n, pv, fv, t) {
    if (per < 1 || per > n) throw ERR.NUM;
    const pmt = pmtCalc(r, n, pv, fv, t);
    let ip;
    if (per === 1) ip = t === 1 ? 0 : -pv;
    else ip = t === 1 ? fvCalc(r, per - 2, pmt, pv, 1) - pmt : fvCalc(r, per - 1, pmt, pv, 0);
    return ip * r;
  }
  const finArgs = (a, defs) => Array.from({ length: Math.max(a.length, defs.length) }, (_, i) => a[i] == null ? defs[i] : num(a[i]));
  S('PMT', 3, 5, a => { const [r, n, pv, fv, t] = finArgs(a, [0, 0, 0, 0, 0]); return pmtCalc(r, n, pv, fv, t ? 1 : 0); });
  S('FV', 3, 5, a => { const [r, n, pmt, pv, t] = finArgs(a, [0, 0, 0, 0, 0]); return fvCalc(r, n, pmt, pv, t ? 1 : 0); });
  S('PV', 3, 5, a => { const [r, n, pmt, fv, t] = finArgs(a, [0, 0, 0, 0, 0]); if (r === 0) return -(fv + pmt * n); const f = Math.pow(1 + r, n); return -(fv + pmt * (1 + r * (t ? 1 : 0)) * (f - 1) / r) / f; });
  S('NPER', 3, 5, a => { const [r, pmt, pv, fv, t0] = finArgs(a, [0, 0, 0, 0, 0]); const t = t0 ? 1 : 0; if (r === 0) { if (pmt === 0) throw ERR.NUM; return -(pv + fv) / pmt; } const num_ = pmt * (1 + r * t) - fv * r, den = pv * r + pmt * (1 + r * t); if (num_ / den <= 0) throw ERR.NUM; return Math.log(num_ / den) / Math.log(1 + r); });
  S('IPMT', 4, 6, a => { const [r, per, n, pv, fv, t] = finArgs(a, [0, 0, 0, 0, 0, 0]); return ipmtCalc(r, per, n, pv, fv, t ? 1 : 0); });
  S('PPMT', 4, 6, a => { const [r, per, n, pv, fv, t] = finArgs(a, [0, 0, 0, 0, 0, 0]); return pmtCalc(r, n, pv, fv, t ? 1 : 0) - ipmtCalc(r, per, n, pv, fv, t ? 1 : 0); });
  S('CUMIPMT', 6, 6, a => { const [r, n, pv, s, e, t] = finArgs(a, []); if (r <= 0 || n <= 0 || pv <= 0 || s < 1 || e < s || e > n || (t !== 0 && t !== 1)) throw ERR.NUM; let x = 0; for (let p = Math.ceil(s); p <= Math.floor(e); p++) x += ipmtCalc(r, p, n, pv, 0, t); return x; });
  S('CUMPRINC', 6, 6, a => { const [r, n, pv, s, e, t] = finArgs(a, []); if (r <= 0 || n <= 0 || pv <= 0 || s < 1 || e < s || e > n || (t !== 0 && t !== 1)) throw ERR.NUM; const pmt = pmtCalc(r, n, pv, 0, t); let x = 0; for (let p = Math.ceil(s); p <= Math.floor(e); p++) x += pmt - ipmtCalc(r, p, n, pv, 0, t); return x; });
  S('RATE', 3, 6, a => {
    const [n, pmt, pv, fv, t0, g] = finArgs(a, [0, 0, 0, 0, 0, 0.1]); const t = t0 ? 1 : 0;
    const f = r => { if (Math.abs(r) < 1e-12) return pv + pmt * n + fv; const x = Math.pow(1 + r, n); return pv * x + pmt * (1 + r * t) * (x - 1) / r + fv; };
    let r = g;
    for (let i = 0; i < 100; i++) {
      const y = f(r), h = 1e-7, d = (f(r + h) - f(r - h)) / (2 * h);
      if (!isFinite(d) || d === 0) break;
      const nr = r - y / d; if (Math.abs(nr - r) < 1e-12) return nr; r = nr;
      if (r <= -1) r = -0.999999;
    }
    if (Math.abs(f(r)) < 1e-6) return r;
    throw ERR.NUM;
  });
  R('NPV', 2, null, (a, ctx) => { const r = num(F.scalar(ctx, a[0])); const v = nums(ctx, a.slice(1)); let s = 0; v.forEach((x, i) => { s += x / Math.pow(1 + r, i + 1); }); return s; });
  function irr(v, g) {
    const f = r => v.reduce((s, x, i) => s + x / Math.pow(1 + r, i), 0);
    const df = r => v.reduce((s, x, i) => s - i * x / Math.pow(1 + r, i + 1), 0);
    let r = g;
    for (let i = 0; i < 100; i++) { const y = f(r), d = df(r); if (d === 0 || !isFinite(d)) break; const nr = r - y / d; if (Math.abs(nr - r) < 1e-12) return nr; r = nr <= -1 ? (r - 1) / 2 : nr; }
    // fall back to bisection on a bracket
    let lo = -0.9999, hi = 10; if (f(lo) * f(hi) > 0) throw ERR.NUM;
    for (let i = 0; i < 300; i++) { const m = (lo + hi) / 2; if (f(lo) * f(m) <= 0) hi = m; else lo = m; }
    return (lo + hi) / 2;
  }
  R('IRR', 1, 2, (a, ctx) => { const v = nums(ctx, [a[0]]); if (!v.some(x => x > 0) || !v.some(x => x < 0)) return ERR.NUM; return irr(v, a[1] == null ? 0.1 : num(F.scalar(ctx, a[1]))); });
  R('MIRR', 3, 3, (a, ctx) => {
    const v = nums(ctx, [a[0]]), fr = num(F.scalar(ctx, a[1])), rr = num(F.scalar(ctx, a[2])), n = v.length;
    let pos = 0, neg = 0; v.forEach((x, i) => { if (x > 0) pos += x * Math.pow(1 + rr, n - 1 - i); else neg += x / Math.pow(1 + fr, i); });
    if (neg === 0 || pos === 0) return ERR.DIV0;
    return Math.pow(-pos / neg, 1 / (n - 1)) - 1;
  });
  function xnpv(r, v, d) { return v.reduce((s, x, i) => s + x / Math.pow(1 + r, (d[i] - d[0]) / 365), 0); }
  R('XNPV', 3, 3, (a, ctx) => { const r = num(F.scalar(ctx, a[0])), v = flatVals(ctx, a[1]).map(num), d = flatVals(ctx, a[2]).map(x => Math.floor(num(x))); if (v.length !== d.length) return ERR.NUM; return xnpv(r, v, d); });
  R('XIRR', 2, 3, (a, ctx) => {
    const v = flatVals(ctx, a[0]).map(num), d = flatVals(ctx, a[1]).map(x => Math.floor(num(x))); if (v.length !== d.length) return ERR.NUM;
    if (!v.some(x => x > 0) || !v.some(x => x < 0)) return ERR.NUM;
    let r = a[2] == null ? 0.1 : num(F.scalar(ctx, a[2]));
    for (let i = 0; i < 100; i++) {
      const y = xnpv(r, v, d), dy = v.reduce((s, x, k) => s - (d[k] - d[0]) / 365 * x / Math.pow(1 + r, (d[k] - d[0]) / 365 + 1), 0);
      if (!dy) break; const nr = r - y / dy; if (Math.abs(nr - r) < 1e-12) return nr; r = nr <= -1 ? (r - 1) / 2 : nr;
    }
    if (Math.abs(xnpv(r, v, d)) < 1e-6) return r;
    return ERR.NUM;
  });
  S('SLN', 3, 3, ([c, s, l]) => { l = num(l); if (l === 0) throw ERR.DIV0; return (num(c) - num(s)) / l; });
  S('SYD', 4, 4, ([c, s, l, p]) => { c = num(c); s = num(s); l = num(l); p = num(p); if (l <= 0 || p < 1 || p > l) throw ERR.NUM; return (c - s) * (l - p + 1) * 2 / (l * (l + 1)); });
  S('DDB', 4, 5, ([c, s, l, p, f]) => {
    c = num(c); s = num(s); l = num(l); p = num(p); f = f == null ? 2 : num(f); if (l <= 0 || p < 1 || p > l || f <= 0 || c < 0 || s < 0) throw ERR.NUM;
    let book = c, dep = 0;
    for (let i = 1; i <= p; i++) { dep = Math.min(book * f / l, Math.max(0, book - s)); book -= dep; }
    return dep;
  });
  S('DB', 4, 5, ([c, s, l, p, m]) => {
    c = num(c); s = num(s); l = num(l); p = num(p); m = m == null ? 12 : num(m); if (l <= 0 || p < 1 || p > l + 1 || m < 1 || m > 12 || c < 0) throw ERR.NUM;
    if (c === 0) return 0;
    const rate = Math.round((1 - Math.pow(s / c, 1 / l)) * 1000) / 1000;
    let total = 0, dep = c * rate * m / 12;
    if (p === 1) return dep;
    total = dep;
    for (let i = 2; i <= p; i++) { dep = i === l + 1 ? (c - total) * rate * (12 - m) / 12 : (c - total) * rate; if (i < p) total += dep; }
    return dep;
  });
  S('EFFECT', 2, 2, ([r, n]) => { r = num(r); n = Math.trunc(num(n)); if (r <= 0 || n < 1) throw ERR.NUM; return Math.pow(1 + r / n, n) - 1; });
  S('NOMINAL', 2, 2, ([r, n]) => { r = num(r); n = Math.trunc(num(n)); if (r <= 0 || n < 1) throw ERR.NUM; return n * (Math.pow(1 + r, 1 / n) - 1); });
  S('RRI', 3, 3, ([n, pv, fv]) => { n = num(n); pv = num(pv); fv = num(fv); if (n <= 0 || pv === 0) throw ERR.NUM; return Math.pow(fv / pv, 1 / n) - 1; });
  S('PDURATION', 3, 3, ([r, pv, fv]) => { r = num(r); pv = num(pv); fv = num(fv); if (r <= 0 || pv <= 0 || fv <= 0) throw ERR.NUM; return (Math.log(fv) - Math.log(pv)) / Math.log(1 + r); });
  R('FVSCHEDULE', 2, 2, (a, ctx) => { let p = num(F.scalar(ctx, a[0])); for (const r of nums(ctx, [a[1]])) p *= 1 + r; return p; });

  /* ---------- metadata for the function picker / autocomplete ---------- */
  const CATS = {
    Math: 'SUM SUMPRODUCT SUMSQ SUMX2MY2 PRODUCT ABS ROUND ROUNDUP ROUNDDOWN INT TRUNC MOD POWER SQRT SQRTPI EXP LN LOG LOG10 PI SIGN CEILING CEILING.MATH FLOOR FLOOR.MATH MROUND EVEN ODD FACT FACTDOUBLE COMBIN COMBINA PERMUT GCD LCM RAND RANDBETWEEN RANDARRAY QUOTIENT SIN COS TAN ASIN ACOS ATAN ATAN2 SINH COSH TANH ASINH ACOSH ATANH COT SEC CSC DEGREES RADIANS SUMIF SUMIFS SUBTOTAL ROMAN ARABIC BASE DECIMAL MMULT MDETERM MINVERSE MUNIT SEQUENCE DEC2BIN DEC2OCT DEC2HEX BIN2DEC OCT2DEC HEX2DEC BIN2HEX HEX2BIN',
    Statistical: 'AVERAGE AVERAGEA AVERAGEIF AVERAGEIFS COUNT COUNTA COUNTBLANK COUNTIF COUNTIFS MAX MIN MAXA MINA MAXIFS MINIFS MEDIAN MODE MODE.SNGL MODE.MULT LARGE SMALL RANK RANK.EQ RANK.AVG STDEV STDEV.S STDEVP STDEV.P STDEVA VAR VAR.S VARP VAR.P PERCENTILE PERCENTILE.INC PERCENTILE.EXC QUARTILE QUARTILE.INC QUARTILE.EXC PERCENTRANK SLOPE INTERCEPT RSQ CORREL PEARSON FORECAST FORECAST.LINEAR STEYX TREND COVARIANCE.P COVARIANCE.S GEOMEAN HARMEAN AVEDEV DEVSQ TRIMMEAN KURT SKEW STANDARDIZE NORM.DIST NORM.S.DIST NORM.INV NORM.S.INV NORMSDIST NORMSINV ERF ERFC EXPON.DIST BINOM.DIST POISSON.DIST GAMMA GAMMALN FREQUENCY',
    Logical: 'IF IFS IFERROR IFNA AND OR XOR NOT TRUE FALSE SWITCH LET',
    Lookup: 'VLOOKUP HLOOKUP XLOOKUP LOOKUP MATCH XMATCH INDEX OFFSET INDIRECT CHOOSE ROW ROWS COLUMN COLUMNS ADDRESS AREAS TRANSPOSE FILTER SORT SORTBY UNIQUE VSTACK HSTACK TAKE DROP HYPERLINK FORMULATEXT',
    Text: 'LEFT RIGHT MID LEN LOWER UPPER PROPER TRIM CLEAN SUBSTITUTE REPLACE FIND SEARCH TEXT VALUE NUMBERVALUE REPT EXACT CHAR CODE UNICHAR UNICODE T N FIXED DOLLAR CONCATENATE CONCAT TEXTJOIN TEXTBEFORE TEXTAFTER TEXTSPLIT',
    'Date & Time': 'DATE TIME DATEVALUE TIMEVALUE TODAY NOW YEAR MONTH DAY HOUR MINUTE SECOND WEEKDAY WEEKNUM ISOWEEKNUM EDATE EOMONTH DAYS DAYS360 DATEDIF NETWORKDAYS WORKDAY YEARFRAC',
    Information: 'ISBLANK ISNUMBER ISTEXT ISNONTEXT ISLOGICAL ISERROR ISERR ISNA ISEVEN ISODD ISREF ISFORMULA NA ERROR.TYPE TYPE SHEET SHEETS',
    Financial: 'PMT IPMT PPMT FV PV NPER RATE NPV XNPV IRR XIRR MIRR SLN SYD DDB DB EFFECT NOMINAL CUMIPMT CUMPRINC RRI PDURATION FVSCHEDULE'
  };
  Object.entries(CATS).forEach(([cat, list]) => list.split(' ').forEach(n => { if (FN[n]) FN[n].cat = cat; }));
  const SIG = {
    SUM: 'number1, [number2], …', AVERAGE: 'number1, [number2], …', COUNT: 'value1, [value2], …', MAX: 'number1, …', MIN: 'number1, …',
    IF: 'logical_test, [value_if_true], [value_if_false]', IFS: 'test1, value1, [test2, value2], …', IFERROR: 'value, value_if_error',
    VLOOKUP: 'lookup_value, table_array, col_index_num, [range_lookup]', HLOOKUP: 'lookup_value, table_array, row_index_num, [range_lookup]',
    XLOOKUP: 'lookup_value, lookup_array, return_array, [if_not_found], [match_mode], [search_mode]', INDEX: 'array, row_num, [column_num]',
    MATCH: 'lookup_value, lookup_array, [match_type]', XMATCH: 'lookup_value, lookup_array, [match_mode], [search_mode]',
    SUMIF: 'range, criteria, [sum_range]', SUMIFS: 'sum_range, criteria_range1, criteria1, …', COUNTIF: 'range, criteria', COUNTIFS: 'criteria_range1, criteria1, …',
    AVERAGEIF: 'range, criteria, [average_range]', AVERAGEIFS: 'average_range, criteria_range1, criteria1, …', MAXIFS: 'max_range, criteria_range1, criteria1, …', MINIFS: 'min_range, criteria_range1, criteria1, …',
    TEXT: 'value, format_text', DATE: 'year, month, day', TIME: 'hour, minute, second', EDATE: 'start_date, months', EOMONTH: 'start_date, months', DATEDIF: 'start_date, end_date, unit',
    NETWORKDAYS: 'start_date, end_date, [holidays]', WORKDAY: 'start_date, days, [holidays]', YEARFRAC: 'start_date, end_date, [basis]', WEEKDAY: 'serial_number, [return_type]',
    PMT: 'rate, nper, pv, [fv], [type]', IPMT: 'rate, per, nper, pv, [fv], [type]', PPMT: 'rate, per, nper, pv, [fv], [type]', FV: 'rate, nper, pmt, [pv], [type]', PV: 'rate, nper, pmt, [fv], [type]',
    NPER: 'rate, pmt, pv, [fv], [type]', RATE: 'nper, pmt, pv, [fv], [type], [guess]', NPV: 'rate, value1, [value2], …', IRR: 'values, [guess]', XNPV: 'rate, values, dates', XIRR: 'values, dates, [guess]',
    ROUND: 'number, num_digits', ROUNDUP: 'number, num_digits', ROUNDDOWN: 'number, num_digits', LEFT: 'text, [num_chars]', RIGHT: 'text, [num_chars]', MID: 'text, start_num, num_chars',
    SUBSTITUTE: 'text, old_text, new_text, [instance_num]', FIND: 'find_text, within_text, [start_num]', SEARCH: 'find_text, within_text, [start_num]', TEXTJOIN: 'delimiter, ignore_empty, text1, …',
    CONCAT: 'text1, [text2], …', FILTER: 'array, include, [if_empty]', SORT: 'array, [sort_index], [sort_order], [by_col]', UNIQUE: 'array, [by_col], [exactly_once]', SEQUENCE: 'rows, [columns], [start], [step]',
    OFFSET: 'reference, rows, cols, [height], [width]', INDIRECT: 'ref_text, [a1]', CHOOSE: 'index_num, value1, [value2], …', SWITCH: 'expression, value1, result1, …, [default]', LET: 'name1, value1, calculation',
    SUMPRODUCT: 'array1, [array2], …', RANK: 'number, ref, [order]', LARGE: 'array, k', SMALL: 'array, k', PERCENTILE: 'array, k', SUBTOTAL: 'function_num, ref1, …', MOD: 'number, divisor', POWER: 'number, power'
  };
  Object.entries(SIG).forEach(([n, s]) => { if (FN[n]) FN[n].sig = s; });
  F.criterion = criterion;
  if (typeof module !== 'undefined' && module.exports) module.exports = F;
})(typeof self !== 'undefined' ? self : this);
