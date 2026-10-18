// Lumen Stats — dataset model: variables, missing values, value labels, CSV, type conversion,
// the (sandboxed, interpreted) expression language for Compute / Select cases, Recode, and the .lstat format.
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const Dist = isNode ? require('./dist.js') : root.LDist;
  const TYPES = ['numeric', 'string', 'date', 'categorical'];
  const MEASURES = ['scale', 'ordinal', 'nominal'];
  const NAME_RE = /^[A-Za-z_À-ɏ][A-Za-z0-9_.À-ɏ]*$/;

  // ---------- variables ----------
  function newVar(name, type = 'numeric', extra = {}) {
    return { name, type, label: '', decimals: type === 'numeric' ? 2 : 0, values: {}, missing: [], missRange: null,
      measure: type === 'string' || type === 'categorical' ? 'nominal' : 'scale', width: type === 'string' ? 110 : type === 'date' ? 96 : 84, ...extra };
  }
  const isNumericType = t => t !== 'string';
  function isMissing(v, meta) {
    if (v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))) return true;
    if (!meta) return false;
    if (meta.missing && meta.missing.length && meta.missing.some(m => m === v || (typeof v === 'number' && +m === v))) return true;
    if (meta.missRange && typeof v === 'number' && v >= meta.missRange[0] && v <= meta.missRange[1]) return true;
    return false;
  }
  const isUserMissing = (v, meta) => v != null && v !== '' && isMissing(v, meta);
  function labelOf(v, meta) { if (v == null || !meta || !meta.values) return null; const k = String(v); if (!Object.prototype.hasOwnProperty.call(meta.values, k)) return null; const l = meta.values[k]; return l == null ? null : String(l); }
  function uniqueName(vars, base) {
    base = sanitizeName(base || 'VAR');
    const has = n => vars.some(v => v.name.toLowerCase() === n.toLowerCase());
    if (!has(base)) return base;
    for (let i = 2; ; i++) if (!has(base + '_' + i)) return base + '_' + i;
  }
  function sanitizeName(s) {
    let n = String(s ?? '').trim().replace(/[\s\-/\\]+/g, '_').replace(/[^A-Za-z0-9_.À-ɏ]/g, '');
    if (!n) n = 'VAR'; if (!/^[A-Za-z_À-ɏ]/.test(n)) n = 'v' + n;
    return n.slice(0, 64);
  }
  const RESERVED = new Set(['and', 'or', 'not', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'true', 'false', 'by', 'to', 'with', 'all', 'thru']);
  function validName(n, vars, self) {
    if (!NAME_RE.test(n)) return 'Names start with a letter or _ and contain only letters, digits, _ and .';
    if (RESERVED.has(n.toLowerCase())) return `“${n}” is a reserved word.`;
    if (vars.some(v => v !== self && v.name.toLowerCase() === n.toLowerCase())) return `A variable named “${n}” already exists.`;
    return null;
  }

  // ---------- dates (stored as days since 1970-01-01, may be fractional for times) ----------
  const pad = n => String(n).padStart(2, '0');
  function dateStr(d) {
    if (d == null || !Number.isFinite(d)) return '';
    const t = new Date(Math.round(d * 864e5)); const s = `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
    const frac = d - Math.floor(d); if (frac > 1e-6) return s + ` ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
    return s;
  }
  const ymd = (y, m, d) => Date.UTC(y, m - 1, d) / 864e5;
  function parseDate(s, order) {
    if (s instanceof Date) return Number.isNaN(+s) ? null : Date.UTC(s.getFullYear(), s.getMonth(), s.getDate(), s.getHours(), s.getMinutes(), s.getSeconds()) / 864e5;
    s = String(s).trim(); let m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?Z?$/.exec(s))) {
      const y = +m[1], mo = +m[2], d = +m[3]; if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      return ymd(y, mo, d) + ((+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) / 86400;
    }
    if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(s))) {
      let a = +m[1], b = +m[2]; const y = +m[3];
      let mo, d; if (order === 'dmy' || a > 12) { d = a; mo = b; } else { mo = a; d = b; }
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
      return ymd(y, mo, d);
    }
    return null;
  }

  // ---------- formatting ----------
  function fmtNum(v, dec) {
    if (v == null || !Number.isFinite(v)) return v == null ? '' : String(v);
    if (dec == null) return String(+v.toPrecision(12));
    return v.toFixed(Math.max(0, Math.min(10, dec)));
  }
  function fmtValue(v, meta, useLabels) {
    if (v == null) return '';
    if (useLabels) { const l = labelOf(v, meta); if (l != null) return l; }
    if (meta.type === 'string') return String(v);
    if (meta.type === 'date') return typeof v === 'number' ? dateStr(v) : String(v);
    if (typeof v !== 'number') return String(v);
    return fmtNum(v, meta.decimals);
  }
  // parse typed text into a value for a variable; returns {v} or {error}
  function parseInput(text, meta) {
    const s = String(text ?? '').trim();
    if (meta.type === 'string') return { v: String(text ?? '') };
    if (s === '' || s === '.') return { v: null };
    if (meta.type === 'date') { const d = parseDate(s); if (d == null) { const n = toNumber(s); if (n != null) return { v: n }; return { error: `“${s}” is not a date (use YYYY-MM-DD).` }; } return { v: d }; }
    const n = toNumber(s); if (n != null) return { v: n };
    if (meta.values) { const hit = Object.entries(meta.values).find(([, l]) => l.toLowerCase() === s.toLowerCase()); if (hit) return { v: +hit[0] }; }
    return { error: `“${s}” is not a number${meta.type === 'categorical' ? ' or a value label' : ''}.` };
  }
  function toNumber(s, decimalComma) {
    if (typeof s === 'number') return Number.isFinite(s) ? s : null;
    let t = String(s).trim(); if (!t) return null;
    if (decimalComma) t = t.replace(/\./g, '').replace(',', '.');
    if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t)) return null;
    const n = +t; return Number.isFinite(n) ? n : null;
  }

  // ---------- CSV ----------
  function detectDelim(text) {
    const head = text.slice(0, 20000).split(/\r?\n/).slice(0, 20).filter(Boolean);
    let best = ',', score = -1;
    for (const d of [',', '\t', ';', '|']) {
      const counts = head.map(l => splitLine(l, d).length);
      const c = counts[0]; if (c < 2) continue;
      const same = counts.filter(x => x === c).length;
      const s = same * 100 + c; if (s > score) { score = s; best = d; }
    }
    return best;
  }
  function splitLine(l, d) { return parseCSV(l, d)[0] || []; }
  function parseCSV(text, delim) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    delim = delim || detectDelim(text);
    const rows = []; let row = [], f = '', q = false, i = 0; const n = text.length;
    while (i < n) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; }
        f += c; i++; continue;
      }
      if (c === '"' && f === '') { q = true; i++; continue; }
      if (c === delim) { row.push(f); f = ''; i++; continue; }
      if (c === '\r' || c === '\n') { row.push(f); rows.push(row); row = []; f = ''; if (c === '\r' && text[i + 1] === '\n') i++; i++; continue; }
      f += c; i++;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    while (rows.length && rows[rows.length - 1].every(x => x === '')) rows.pop();
    rows.delim = delim;
    return rows;
  }
  // rows: array of arrays (strings, numbers, Dates or null). Infers variable types.
  function fromRows(rows, { header = true, name = 'Data', decimalComma, autoCategorical = true } = {}) {
    const hdr = header ? rows[0] || [] : [], body = header ? rows.slice(1) : rows;
    const ncol = Math.max(hdr.length, ...body.slice(0, 5000).map(r => r.length), 0);
    const vars = [], cols = [];
    for (let j = 0; j < ncol; j++) {
      const raw = body.map(r => r[j] ?? null);
      const lab = header && hdr[j] != null ? String(hdr[j]).trim() : '';
      const nm = uniqueName(vars, lab ? sanitizeName(lab) : 'VAR' + String(j + 1).padStart(5, '0'));
      const r = inferColumn(raw, decimalComma, autoCategorical);
      const meta = newVar(nm, r.type, r.meta || {}); if (lab && lab !== nm) meta.label = lab;
      vars.push(meta); cols.push(r.col);
    }
    return { name, vars, cols, n: body.length };
  }
  function inferColumn(raw, decimalComma, autoCat) {
    const vals = raw.map(v => v instanceof Date ? v : v == null ? '' : typeof v === 'string' ? v.trim() : v);
    const nonEmpty = vals.filter(v => v !== '' && v != null);
    if (!nonEmpty.length) return { type: 'numeric', col: vals.map(() => null), meta: { decimals: 0 } };
    if (nonEmpty.every(v => v instanceof Date || (typeof v === 'string' && parseDate(v) != null && /\d{4}/.test(v))))
      return { type: 'date', col: vals.map(v => v === '' ? null : parseDate(v)) };
    const nums = nonEmpty.map(v => typeof v === 'number' ? v : typeof v === 'boolean' ? +v : toNumber(v, decimalComma));
    if (nums.every(x => x != null)) {
      const col = vals.map(v => v === '' || v == null ? null : typeof v === 'number' ? v : typeof v === 'boolean' ? +v : toNumber(v, decimalComma));
      let dec = 0; for (const x of nums.slice(0, 2000)) { const s = String(x); const k = s.includes('e') ? 3 : (s.split('.')[1] || '').length; if (k > dec) dec = k; }
      return { type: 'numeric', col, meta: { decimals: Math.min(dec, 6) } };
    }
    const col = vals.map(v => v == null ? '' : String(v instanceof Date ? dateStr(parseDate(v)) : v));
    if (autoCat) {
      const uniq = [...new Set(col.filter(v => v !== ''))];
      if (uniq.length >= 2 && uniq.length <= 24 && uniq.length <= nonEmpty.length / 2) return toCategorical(col, uniq);
    }
    return { type: 'string', col, meta: { width: Math.min(220, Math.max(90, 7 * Math.max(...col.slice(0, 500).map(s => s.length)))) } };
  }
  function toCategorical(col, uniq) {
    uniq = uniq || [...new Set(col.filter(v => v !== '' && v != null))];
    uniq.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    const code = new Map(uniq.map((u, i) => [u, i + 1])), values = {};
    uniq.forEach((u, i) => values[i + 1] = String(u));
    return { type: 'categorical', col: col.map(v => v === '' || v == null ? null : code.get(v)), meta: { values, decimals: 0, measure: 'nominal' } };
  }
  function csvField(s, delim) { s = String(s); return /[",\r\n]/.test(s) || s.includes(delim) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function toCSV(doc, { delim = ',', labels = false, cases } = {}) {
    const idx = cases || Array.from({ length: doc.n }, (_, i) => i);
    const lines = [doc.vars.map(v => csvField(v.name, delim)).join(delim)];
    for (const i of idx) lines.push(doc.vars.map((v, j) => { const x = doc.cols[j][i]; if (x == null) return ''; return csvField(v.type === 'date' || labels || v.type === 'string' ? fmtValue(x, v, labels) : String(x), delim); }).join(delim));
    return lines.join('\r\n') + '\r\n';
  }

  // ---------- type conversion ----------
  function convertColumn(col, from, to, meta) {
    if (from.type === to) return { col, meta: {} };
    if (to === 'string') return { col: col.map(v => v == null ? '' : fmtValue(v, from, false)), meta: { values: {}, missing: [], missRange: null, measure: 'nominal' } };
    if (from.type === 'string') {
      if (to === 'categorical') { const r = toCategorical(col); return { col: r.col, meta: r.meta }; }
      if (to === 'date') return { col: col.map(v => v === '' ? null : parseDate(v)), meta: { measure: 'scale', values: {} } };
      return { col: col.map(v => toNumber(v)), meta: { measure: 'scale', values: {} } };
    }
    // numeric-like ↔ numeric-like keep the numbers
    const m = {};
    if (to === 'categorical') { m.measure = 'nominal'; m.decimals = 0; }
    if (to === 'numeric' && from.type === 'categorical') m.measure = 'scale';
    if (to === 'date') m.measure = 'scale';
    return { col, meta: m };
  }

  // ---------- expression language ----------
  // Tokenizer
  function tokenize(src) {
    const t = []; let i = 0; const n = src.length;
    while (i < n) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) {
        const m = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(src.slice(i)); t.push({ k: 'num', v: +m[0], p: i }); i += m[0].length; continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1, s = ''; while (j < n && src[j] !== c) { if (src[j] === '\\' && j + 1 < n) { s += src[j + 1]; j += 2; } else s += src[j++]; }
        if (j >= n) throw new ExprError('Unterminated text in quotes', i);
        t.push({ k: 'str', v: s, p: i }); i = j + 1; continue;
      }
      if (/[A-Za-z_$#@À-ɏ]/.test(c)) {
        const m = /^[A-Za-z_$#@À-ɏ][A-Za-z0-9_.$#@À-ɏ]*/.exec(src.slice(i)); let w = m[0];
        while (w.endsWith('.')) w = w.slice(0, -1);
        t.push({ k: 'id', v: w, p: i }); i += w.length; continue;
      }
      const two = src.slice(i, i + 2);
      if (['**', '<=', '>=', '<>', '~=', '!=', '==', '&&', '||'].includes(two)) { t.push({ k: 'op', v: two, p: i }); i += 2; continue; }
      if ('+-*/^%()<>=,&|~!'.includes(c)) { t.push({ k: 'op', v: c, p: i }); i++; continue; }
      throw new ExprError(`Unexpected character “${c}”`, i);
    }
    t.push({ k: 'end', p: n });
    return t;
  }
  class ExprError extends Error { constructor(msg, pos) { super(msg + (pos != null ? ` (at character ${pos + 1})` : '')); this.pos = pos; } }
  const WORD_OPS = Object.assign(Object.create(null), { and: '&', or: '|', not: '~', eq: '=', ne: '~=', lt: '<', le: '<=', gt: '>', ge: '>=' });
  function parse(src) {
    const t = tokenize(src); let i = 0;
    const peek = () => { const x = t[i]; if (x.k === 'id' && WORD_OPS[x.v.toLowerCase()]) return { k: 'op', v: WORD_OPS[x.v.toLowerCase()], p: x.p }; return x; };
    const isOp = (...ops) => { const x = peek(); return x.k === 'op' && ops.includes(x.v); };
    const next = () => { const x = peek(); i++; return x; };
    const expect = v => { const x = next(); if (x.k !== 'op' || x.v !== v) throw new ExprError(`Expected “${v}”`, x.p); };
    function orE() { let a = andE(); while (isOp('|', '||')) { next(); a = { t: 'or', a, b: andE() }; } return a; }
    function andE() { let a = notE(); while (isOp('&', '&&')) { next(); a = { t: 'and', a, b: notE() }; } return a; }
    function notE() { if (isOp('~', '!')) { next(); return { t: 'not', a: notE() }; } return cmpE(); }
    function cmpE() {
      const a = addE();
      if (isOp('=', '==', '~=', '<>', '!=', '<', '<=', '>', '>=')) { let op = next().v; if (op === '==') op = '='; if (op === '<>' || op === '!=') op = '~='; return { t: 'cmp', op, a, b: addE() }; }
      return a;
    }
    function addE() { let a = mulE(); while (isOp('+', '-')) { const op = next().v; a = { t: 'bin', op, a, b: mulE() }; } return a; }
    function mulE() { let a = unE(); while (isOp('*', '/', '%')) { const op = next().v; a = { t: 'bin', op, a, b: unE() }; } return a; }
    function unE() { if (isOp('-')) { next(); return { t: 'neg', a: unE() }; } if (isOp('+')) { next(); return unE(); } return powE(); }
    function powE() { const a = prim(); if (isOp('**', '^')) { next(); return { t: 'bin', op: '^', a, b: unE() }; } return a; }
    function prim() {
      const x = next();
      if (x.k === 'num') return { t: 'num', v: x.v };
      if (x.k === 'str') return { t: 'str', v: x.v };
      if (x.k === 'op' && x.v === '(') { const e = orE(); expect(')'); return e; }
      if (x.k === 'id') {
        if (isOp('(')) {
          next(); const args = [];
          if (!isOp(')')) { do { args.push(orE()); } while (isOp(',') && next()); }
          expect(')'); return { t: 'call', name: x.v.toLowerCase(), args, p: x.p };
        }
        return { t: 'id', name: x.v, p: x.p };
      }
      throw new ExprError(x.k === 'end' ? 'The expression ends too early' : `Unexpected “${x.v}”`, x.p);
    }
    const e = orE();
    if (peek().k !== 'end') throw new ExprError(`Unexpected “${peek().v}”`, peek().p);
    return e;
  }
  const num = v => v == null ? null : typeof v === 'number' ? v : typeof v === 'boolean' ? +v : (toNumber(v) ?? null);
  const truth = v => v == null ? null : typeof v === 'string' ? v !== '' : !!(+v);
  const vals = args => args.filter(v => v != null && !(typeof v === 'number' && Number.isNaN(v)));
  const numArgs = args => vals(args).map(num).filter(v => v != null);
  let rnd = Math.random;
  const nrand = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd()); };
  const N1 = f => a => { const x = num(a[0]); return x == null ? null : f(x); };
  const fin = v => v == null || !Number.isFinite(v) ? null : v;
  const dateParts = d => { const t = new Date(Math.round(d * 864e5)); return t; };
  const FUNCS = Object.assign(Object.create(null), {
    abs: N1(Math.abs), sqrt: N1(x => x < 0 ? null : Math.sqrt(x)), exp: N1(x => fin(Math.exp(x))), ln: N1(x => x > 0 ? Math.log(x) : null),
    lg10: N1(x => x > 0 ? Math.log10(x) : null), log10: N1(x => x > 0 ? Math.log10(x) : null),
    log: a => { const x = num(a[0]), b = a.length > 1 ? num(a[1]) : Math.E; return x > 0 && b > 0 && b !== 1 ? Math.log(x) / Math.log(b) : null; },
    round: a => { const x = num(a[0]), d = a.length > 1 ? num(a[1]) : 0; if (x == null) return null; const f = 10 ** d; return Math.round(x * f + Math.sign(x) * 1e-9) / f; },
    rnd: a => { const x = num(a[0]), m = a.length > 1 ? num(a[1]) : 1; return x == null || !m ? null : Math.round(x / m + Math.sign(x) * 1e-9) * m; },
    trunc: N1(Math.trunc), ceil: N1(Math.ceil), floor: N1(Math.floor), sign: N1(Math.sign),
    mod: a => { const x = num(a[0]), m = num(a[1]); return x == null || !m ? null : x % m; },
    sin: N1(Math.sin), cos: N1(Math.cos), tan: N1(Math.tan), asin: N1(Math.asin), acos: N1(Math.acos), atan: N1(Math.atan), arsin: N1(Math.asin), artan: N1(Math.atan),
    min: a => { const v = numArgs(a); return v.length ? Math.min(...v) : null; }, max: a => { const v = numArgs(a); return v.length ? Math.max(...v) : null; },
    sum: a => { const v = numArgs(a); return v.length ? v.reduce((s, x) => s + x, 0) : null; },
    mean: a => { const v = numArgs(a); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; },
    sd: a => { const v = numArgs(a); if (v.length < 2) return null; const m = v.reduce((s, x) => s + x, 0) / v.length; return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); },
    variance: a => { const v = numArgs(a); if (v.length < 2) return null; const m = v.reduce((s, x) => s + x, 0) / v.length; return v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1); },
    median: a => { const v = numArgs(a).sort((x, y) => x - y), n = v.length; return n ? n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2 : null; },
    nvalid: a => vals(a).length, nmiss: a => a.length - vals(a).length,
    missing: a => a[0] == null ? 1 : 0,
    if: a => { const c = truth(a[0]); if (c == null) return null; return c ? a[1] : a.length > 2 ? a[2] : null; },
    any: a => { if (a[0] == null) return null; return a.slice(1).some(v => v === a[0] || (v != null && num(v) === num(a[0]) && typeof a[0] === 'number')) ? 1 : 0; },
    range: a => { const x = num(a[0]); if (x == null) return null; for (let k = 1; k + 1 < a.length; k += 2) if (x >= num(a[k]) && x <= num(a[k + 1])) return 1; return 0; },
    upcase: a => a[0] == null ? null : String(a[0]).toUpperCase(), lower: a => a[0] == null ? null : String(a[0]).toLowerCase(),
    length: a => a[0] == null ? null : String(a[0]).length,
    concat: a => a.map(v => v == null ? '' : typeof v === 'number' ? String(+v.toPrecision(12)) : String(v)).join(''),
    substr: a => { if (a[0] == null) return null; const s = String(a[0]), st = Math.max(1, num(a[1]) || 1) - 1; return a.length > 2 ? s.substr(st, Math.max(0, num(a[2]) || 0)) : s.slice(st); },
    index: a => a[0] == null ? null : String(a[0]).indexOf(String(a[1] ?? '')) + 1,
    trim: a => a[0] == null ? null : String(a[0]).trim(), ltrim: a => a[0] == null ? null : String(a[0]).trimStart(), rtrim: a => a[0] == null ? null : String(a[0]).trimEnd(),
    replace: a => a[0] == null ? null : String(a[0]).split(String(a[1] ?? '')).join(String(a[2] ?? '')),
    number: a => a[0] == null ? null : toNumber(a[0]), string: a => { if (a[0] == null) return ''; const x = num(a[0]); return a.length > 1 && x != null ? x.toFixed(num(a[1])) : String(a[0]); },
    year: a => { const d = num(a[0]); return d == null ? null : dateParts(d).getUTCFullYear(); },
    month: a => { const d = num(a[0]); return d == null ? null : dateParts(d).getUTCMonth() + 1; },
    day: a => { const d = num(a[0]); return d == null ? null : dateParts(d).getUTCDate(); },
    weekday: a => { const d = num(a[0]); return d == null ? null : dateParts(d).getUTCDay() + 1; },
    date: a => { const y = num(a[0]), m = num(a[1] ?? 1), d = num(a[2] ?? 1); return y == null || m == null || d == null ? null : ymd(y, m, d); },
    datevalue: a => a[0] == null ? null : parseDate(String(a[0])),
    datediff: a => { const x = num(a[0]), y = num(a[1]); return x == null || y == null ? null : x - y; },
    'cdf.normal': a => { const x = num(a[0]); return x == null ? null : Dist.pnorm(x, num(a[1] ?? 0), num(a[2] ?? 1)); },
    'idf.normal': a => { const p = num(a[0]); return p == null || p <= 0 || p >= 1 ? null : Dist.qnorm(p, num(a[1] ?? 0), num(a[2] ?? 1)); },
    'pdf.normal': a => { const x = num(a[0]); return x == null ? null : Dist.dnorm(x, num(a[1] ?? 0), num(a[2] ?? 1)); },
    'cdf.t': a => { const x = num(a[0]), df = num(a[1]); return x == null || !(df > 0) ? null : Dist.pt(x, df); },
    'idf.t': a => { const p = num(a[0]), df = num(a[1]); return p == null || !(df > 0) || p <= 0 || p >= 1 ? null : Dist.qt(p, df); },
    'cdf.chisq': a => { const x = num(a[0]), df = num(a[1]); return x == null || !(df > 0) ? null : Dist.pchisq(x, df); },
    'cdf.f': a => { const x = num(a[0]), d1 = num(a[1]), d2 = num(a[2]); return x == null || !(d1 > 0 && d2 > 0) ? null : Dist.pf(x, d1, d2); },
    'rv.normal': a => num(a[0] ?? 0) + num(a[1] ?? 1) * nrand(), 'rv.uniform': a => { const lo = num(a[0] ?? 0), hi = num(a[1] ?? 1); return lo + (hi - lo) * rnd(); },
    normal: a => num(a[0] ?? 1) * nrand(), uniform: a => num(a[0] ?? 1) * rnd(),
  });
  const ALIAS = Object.assign(Object.create(null), { iif: 'if', ifelse: 'if', upper: 'upcase', lowcase: 'lower', len: 'length', arctan: 'atan', rv_normal: 'rv.normal', rv_uniform: 'rv.uniform', cdfnorm: 'cdf.normal' });
  const FUNC_NAMES = Object.keys(FUNCS).sort();
  // compile an expression against a dataset → function(caseIndex) → value (number|string|null)
  function compile(src, doc) {
    const ast = parse(src);
    const byName = new Map(doc.vars.map((v, j) => [v.name.toLowerCase(), j]));
    const used = new Set();
    function build(e) {
      switch (e.t) {
        case 'num': { const v = e.v; return () => v; }
        case 'str': { const v = e.v; return () => v; }
        case 'id': {
          const nm = e.name.toLowerCase();
          if (nm === '$casenum') return i => i + 1;
          if (nm === '$sysmis') return () => null;
          if (nm === 'true') return () => 1; if (nm === 'false') return () => 0;
          if (nm === 'pi' && !byName.has('pi')) return () => Math.PI;
          const j = byName.get(nm); if (j == null) throw new ExprError(`Unknown variable “${e.name}”`, e.p);
          used.add(j);
          const meta = doc.vars[j], col = doc.cols[j];
          if (meta.type === 'string') return i => col[i] ?? '';
          return i => { const v = col[i]; return isMissing(v, meta) ? null : v; };
        }
        case 'neg': { const a = build(e.a); return i => { const x = num(a(i)); return x == null ? null : -x; }; }
        case 'not': { const a = build(e.a); return i => { const x = truth(a(i)); return x == null ? null : x ? 0 : 1; }; }
        case 'and': { const a = build(e.a), b = build(e.b); return i => { const x = truth(a(i)); if (x === false) return 0; const y = truth(b(i)); if (y === false) return 0; return x == null || y == null ? null : 1; }; }
        case 'or': { const a = build(e.a), b = build(e.b); return i => { const x = truth(a(i)); if (x === true) return 1; const y = truth(b(i)); if (y === true) return 1; return x == null || y == null ? null : 0; }; }
        case 'cmp': {
          const a = build(e.a), b = build(e.b), op = e.op;
          return i => {
            let x = a(i), y = b(i); if (x == null || y == null) return null;
            if (typeof x === 'string' || typeof y === 'string') { if (typeof x !== 'string' || typeof y !== 'string') { const nx = num(x), ny = num(y); if (nx != null && ny != null) { x = nx; y = ny; } else { x = String(x); y = String(y); } } }
            switch (op) { case '=': return x === y ? 1 : 0; case '~=': return x !== y ? 1 : 0; case '<': return x < y ? 1 : 0; case '<=': return x <= y ? 1 : 0; case '>': return x > y ? 1 : 0; default: return x >= y ? 1 : 0; }
          };
        }
        case 'bin': {
          const a = build(e.a), b = build(e.b), op = e.op;
          if (op === '+') return i => { const x = a(i), y = b(i); if (typeof x === 'string' && typeof y === 'string') return x + y; const p = num(x), q = num(y); return p == null || q == null ? null : p + q; };
          return i => {
            const x = num(a(i)), y = num(b(i)); if (x == null || y == null) return null;
            switch (op) { case '-': return x - y; case '*': return x * y; case '/': return y === 0 ? null : x / y; case '%': return y === 0 ? null : x % y; default: return fin(Math.pow(x, y)); }
          };
        }
        case 'call': {
          let nm = e.name; nm = ALIAS[nm] || nm;
          if (nm === 'sysmis' || nm === 'value' || nm === 'lag') {   // need the raw column
            const arg = e.args[0]; if (!arg || arg.t !== 'id') throw new ExprError(`${nm.toUpperCase()}() takes a variable name`, e.p);
            const j = byName.get(arg.name.toLowerCase()); if (j == null) throw new ExprError(`Unknown variable “${arg.name}”`, arg.p);
            used.add(j); const col = doc.cols[j], meta = doc.vars[j];
            if (nm === 'sysmis') return i => col[i] == null || col[i] === '' ? 1 : 0;
            if (nm === 'value') return i => col[i] ?? null;
            const k = e.args[1] && e.args[1].t === 'num' ? Math.max(1, Math.round(e.args[1].v)) : 1;
            return i => { const v = i - k >= 0 ? col[i - k] : null; return isMissing(v, meta) && meta.type !== 'string' ? null : v; };
          }
          const f = FUNCS[nm]; if (!f) throw new ExprError(`Unknown function “${e.name}”`, e.p);
          const args = e.args.map(build);
          if (nm === 'if') { if (args.length < 2) throw new ExprError('IF(condition, value-if-true, value-if-false)', e.p); return i => { const c = truth(args[0](i)); if (c == null) return null; return c ? args[1](i) : args[2] ? args[2](i) : null; }; }
          return i => f(args.map(g => g(i)));
        }
      }
      throw new ExprError('Bad expression');
    }
    const fn = build(ast);
    fn.used = [...used];
    return fn;
  }
  function evaluate(src, doc) { const f = compile(src, doc), out = new Array(doc.n); for (let i = 0; i < doc.n; i++) out[i] = f(i); return out; }
  // value to store in a variable of the given type
  function coerce(v, type) {
    if (type === 'string') return v == null ? '' : typeof v === 'number' ? String(+v.toPrecision(12)) : String(v);
    if (v == null) return null; const x = num(v); return x == null || !Number.isFinite(x) ? null : x;
  }

  // ---------- filter ----------
  // returns Uint8Array mask of selected cases, or null when no filter is active
  function filterMask(doc) {
    if (!doc.filter || !doc.filter.active || !doc.filter.expr) return null;
    const f = compile(doc.filter.expr, doc), m = new Uint8Array(doc.n);
    for (let i = 0; i < doc.n; i++) m[i] = truth(f(i)) === true ? 1 : 0;
    return m;
  }

  // ---------- recode ----------
  // rules: [{from:{k:'value',v}|{k:'range',lo,hi}|{k:'lowest',hi}|{k:'highest',lo}|{k:'missing'}|{k:'sysmis'}|{k:'else'}, to:{k:'value',v}|{k:'sysmis'}|{k:'copy'}}]
  function recodeColumn(col, meta, rules, { same = false, cases } = {}) {
    const matches = (f, v) => {
      switch (f.k) {
        case 'value': return v != null && (v === f.v || (typeof v === 'number' && num(f.v) === v) || (typeof v === 'string' && String(f.v) === v));
        case 'range': return typeof v === 'number' && !isMissing(v, meta) && v >= f.lo && v <= f.hi;
        case 'lowest': return typeof v === 'number' && !isMissing(v, meta) && v <= f.hi;
        case 'highest': return typeof v === 'number' && !isMissing(v, meta) && v >= f.lo;
        case 'missing': return isMissing(v, meta);
        case 'sysmis': return v == null || v === '';
        case 'else': return true;
      }
      return false;
    };
    return col.map((v, i) => {
      if (cases && !cases[i]) return same ? v : null;
      for (const r of rules) if (matches(r.from, v)) return r.to.k === 'copy' ? v : r.to.k === 'sysmis' ? null : r.to.v;
      return same ? v : null;
    });
  }
  function describeRule(r) {
    const f = r.from, t = r.to;
    const fs = f.k === 'value' ? String(f.v) : f.k === 'range' ? `${f.lo} thru ${f.hi}` : f.k === 'lowest' ? `Lowest thru ${f.hi}` : f.k === 'highest' ? `${f.lo} thru Highest` : f.k === 'missing' ? 'MISSING' : f.k === 'sysmis' ? 'SYSMIS' : 'ELSE';
    const ts = t.k === 'value' ? String(t.v) : t.k === 'sysmis' ? 'SYSMIS' : 'COPY';
    return `${fs} → ${ts}`;
  }

  // ---------- cases for analysis ----------
  // indices of cases (after filter) where all listed variables are non-missing
  function validCases(doc, varIdx, mask) {
    const out = [];
    outer: for (let i = 0; i < doc.n; i++) {
      if (mask && !mask[i]) continue;
      for (const j of varIdx) if (isMissing(doc.cols[j][i], doc.vars[j])) continue outer;
      out.push(i);
    }
    return out;
  }

  // ---------- project file (.lstat) ----------
  function serialize(doc, extra = {}) {
    return JSON.stringify({ format: 'lumen-stats', version: 1, name: doc.name, vars: doc.vars, data: doc.cols, filter: doc.filter || null, output: doc.output || [], ...extra });
  }
  const str = (v, max = 4000) => v == null ? '' : String(v).slice(0, max);
  // Validate and normalise an untrusted project file. Throws on malformed input.
  function deserialize(text) {
    let j; try { j = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { throw new Error('This is not a Lumen Stats project (invalid JSON).'); }
    if (!j || j.format !== 'lumen-stats' || !Array.isArray(j.vars) || !Array.isArray(j.data)) throw new Error('This is not a Lumen Stats project.');
    if (j.vars.length !== j.data.length) throw new Error('The project is damaged: variable and data counts differ.');
    const n = j.data.reduce((m, c) => Math.max(m, Array.isArray(c) ? c.length : 0), 0);
    const vars = [];
    const cols = j.vars.map((v, k) => {
      const type = TYPES.includes(v.type) ? v.type : 'numeric';
      let name = sanitizeName(v.name); if (vars.some(x => x.name.toLowerCase() === name.toLowerCase())) name = uniqueName(vars, name);
      const values = {}; if (v.values && typeof v.values === 'object') Object.entries(v.values).slice(0, 5000).forEach(([a, b]) => { const k = str(a, 200); if (k !== '__proto__') values[k] = str(b, 400); });
      const meta = newVar(name, type, { label: str(v.label, 400), decimals: Math.max(0, Math.min(10, +v.decimals || 0)), values,
        missing: Array.isArray(v.missing) ? v.missing.slice(0, 50).map(x => type === 'string' ? str(x, 200) : +x).filter(x => type === 'string' || Number.isFinite(x)) : [],
        missRange: Array.isArray(v.missRange) && v.missRange.length === 2 && v.missRange.every(Number.isFinite) ? [+v.missRange[0], +v.missRange[1]] : null,
        measure: MEASURES.includes(v.measure) ? v.measure : type === 'string' ? 'nominal' : 'scale', width: Math.max(40, Math.min(600, +v.width || 84)) });
      vars.push(meta);
      const c = Array.isArray(j.data[k]) ? j.data[k] : [];
      const out = new Array(n);
      for (let i = 0; i < n; i++) { const x = c[i]; out[i] = type === 'string' ? (x == null ? '' : str(x, 10000)) : (typeof x === 'number' && Number.isFinite(x) ? x : null); }
      return out;
    });
    const filter = j.filter && typeof j.filter.expr === 'string' ? { expr: str(j.filter.expr, 2000), active: !!j.filter.active } : null;
    const output = Array.isArray(j.output) ? j.output.slice(0, 2000) : [];
    return { name: str(j.name, 200) || 'Untitled', vars, cols, n, filter, output, view: j.view && typeof j.view === 'object' ? j.view : {} };
  }

  const api = { TYPES, MEASURES, NAME_RE, newVar, isNumericType, isMissing, isUserMissing, labelOf, uniqueName, sanitizeName, validName, dateStr, parseDate, ymd,
    fmtNum, fmtValue, parseInput, toNumber, detectDelim, parseCSV, fromRows, inferColumn, toCategorical, toCSV, convertColumn,
    tokenize, parse, compile, evaluate, coerce, truth, filterMask, recodeColumn, describeRule, validCases, serialize, deserialize, ExprError, FUNC_NAMES,
    setRandom: f => { rnd = f || Math.random; } };
  if (isNode) module.exports = api; else root.LData = api;
})(typeof self !== 'undefined' ? self : this);
