// Lumen Map — a small, sandboxed QGIS-style expression language for filters, selection and the field calculator.
// It is parsed and interpreted here (never eval'd), so expressions stored in opened projects are safe to run.
//   "field" or [field] or bare name → attribute · 'text' → string · numbers · + - * / % ^ || · = != <> < <= > >=
//   AND OR NOT · LIKE / ILIKE (% and _) · IN (…) · IS [NOT] NULL · BETWEEN a AND b · CASE WHEN … THEN … ELSE … END
//   $area $length $perimeter (geodesic m² / m) · $x $y (centroid lon/lat) · $id · $geomtype · functions below.
(function (root) {
  'use strict';
  const G = root.MapGeo || (typeof require !== 'undefined' ? require('./geo.js') : null);
  function tokenize(s) {
    const t = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/\d/.test(c) || (c === '.' && /\d/.test(s[i + 1]))) { const m = /^(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s.slice(i)); t.push({ k: 'num', v: +m[0] }); i += m[0].length; continue; }
      if (c === "'" || c === '"') { let j = i + 1, v = ''; for (;;) { if (j >= s.length) throw new Error('Unterminated ' + (c === "'" ? 'string' : 'field name')); if (s[j] === c) { if (s[j + 1] === c) { v += c; j += 2; continue; } break; } v += s[j++]; } t.push({ k: c === "'" ? 'str' : 'field', v }); i = j + 1; continue; }
      if (c === '[') { const j = s.indexOf(']', i); if (j < 0) throw new Error('Missing ]'); t.push({ k: 'field', v: s.slice(i + 1, j) }); i = j + 1; continue; }
      const m = /^(\$?[A-Za-z_À-￿][\wÀ-￿]*)/.exec(s.slice(i));
      if (m) { t.push({ k: 'id', v: m[0] }); i += m[0].length; continue; }
      const op = /^(<=|>=|<>|!=|==|\|\||[-+*/%^()=<>,])/.exec(s.slice(i));
      if (op) { t.push({ k: 'op', v: op[0] }); i += op[0].length; continue; }
      throw new Error(`Unexpected character “${c}”`);
    }
    return t;
  }
  const FN = {
    upper: s => s == null ? null : String(s).toUpperCase(), lower: s => s == null ? null : String(s).toLowerCase(), trim: s => s == null ? null : String(s).trim(),
    length: s => s == null ? null : String(s).length, title: s => s == null ? null : String(s).toLowerCase().replace(/(^|\s)\S/g, x => x.toUpperCase()),
    substr: (s, a, n) => s == null ? null : String(s).substr(Math.max(0, (a || 1) - 1), n == null ? undefined : n), left: (s, n) => s == null ? null : String(s).slice(0, n), right: (s, n) => s == null ? null : String(s).slice(-n),
    replace: (s, a, b) => s == null ? null : String(s).split(String(a)).join(String(b ?? '')), strpos: (s, a) => s == null ? null : String(s).indexOf(String(a)) + 1,
    lpad: (s, n, c) => String(s ?? '').padStart(n, c || ' '), rpad: (s, n, c) => String(s ?? '').padEnd(n, c || ' '),
    concat: (...a) => a.map(x => x ?? '').join(''), coalesce: (...a) => { for (const x of a) if (x != null && x !== '') return x; return null; },
    round: (x, n = 0) => x == null ? null : Math.round(x * Math.pow(10, n)) / Math.pow(10, n), floor: x => x == null ? null : Math.floor(x), ceil: x => x == null ? null : Math.ceil(x),
    abs: Math.abs, sqrt: Math.sqrt, ln: Math.log, log10: Math.log10, exp: Math.exp, sin: Math.sin, cos: Math.cos, tan: Math.tan, atan2: Math.atan2, pi: () => Math.PI,
    power: Math.pow, pow: Math.pow, min: (...a) => { a = a.filter(x => x != null); return a.length ? Math.min(...a) : null; }, max: (...a) => { a = a.filter(x => x != null); return a.length ? Math.max(...a) : null; },
    if: (c, a, b) => truthy(c) ? a : b, to_int: x => x == null || x === '' || isNaN(+x) ? null : Math.trunc(+x), to_real: x => x == null || x === '' || isNaN(+x) ? null : +x, to_string: x => x == null ? null : String(x),
    format_number: (x, d = 0) => x == null ? null : Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }),
    clamp: (a, x, b) => Math.min(Math.max(x, a), b), scale_linear: (x, d0, d1, r0, r1) => r0 + (Math.min(Math.max(x, d0), d1) - d0) / (d1 - d0) * (r1 - r0),
    rand: (a = 0, b = 1) => a + Math.floor(Math.random() * (b - a + 1)),
  };
  const ARITY = { pi: [0, 0], rand: [0, 2], if: [3, 3], substr: [2, 3], replace: [3, 3], round: [1, 2], format_number: [1, 2], lpad: [2, 3], rpad: [2, 3], left: [2, 2], right: [2, 2], strpos: [2, 2], atan2: [2, 2], power: [2, 2], pow: [2, 2], clamp: [3, 3], scale_linear: [5, 5] };
  const truthy = v => v != null && v !== false && v !== 0 && v !== '';
  const num = v => v == null || v === '' ? null : typeof v === 'number' ? v : typeof v === 'boolean' ? +v : isNaN(+v) ? null : +v;

  function parse(src) {
    const t = tokenize(String(src)); let i = 0;
    const peek = () => t[i], isKw = (w, k = t[i]) => k && k.k === 'id' && k.v.toUpperCase() === w, isOp = (o, k = t[i]) => k && k.k === 'op' && k.v === o;
    const take = () => t[i++], need = o => { if (!isOp(o)) throw new Error(`Expected “${o}”`); i++; };
    const kw = w => { if (!isKw(w)) throw new Error('Expected ' + w); i++; };
    function or() { let a = and(); while (isKw('OR')) { i++; a = { t: 'or', a, b: and() }; } return a; }
    function and() { let a = not(); while (isKw('AND')) { i++; a = { t: 'and', a, b: not() }; } return a; }
    function not() { if (isKw('NOT')) { i++; return { t: 'not', a: not() }; } return cmp(); }
    function cmp() {
      const a = cat();
      const k = peek();
      if (k && k.k === 'op' && ['=', '==', '!=', '<>', '<', '<=', '>', '>='].includes(k.v)) { i++; return { t: 'cmp', op: k.v === '==' ? '=' : k.v === '<>' ? '!=' : k.v, a, b: cat() }; }
      let neg = false; if (isKw('NOT') && (isKw('LIKE', t[i + 1]) || isKw('ILIKE', t[i + 1]) || isKw('IN', t[i + 1]) || isKw('BETWEEN', t[i + 1]))) { neg = true; i++; }
      if (isKw('LIKE') || isKw('ILIKE')) { const ci = isKw('ILIKE'); i++; return { t: 'like', ci, neg, a, b: cat() }; }
      if (isKw('IN')) { i++; need('('); const list = [or()]; while (isOp(',')) { i++; list.push(or()); } need(')'); return { t: 'in', neg, a, list }; }
      if (isKw('BETWEEN')) { i++; const lo = cat(); kw('AND'); const hi = cat(); return { t: 'between', neg, a, lo, hi }; }
      if (isKw('IS')) { i++; let n = false; if (isKw('NOT')) { i++; n = true; } kw('NULL'); return { t: 'isnull', neg: n, a }; }
      return a;
    }
    function cat() { let a = add(); while (isOp('||')) { i++; a = { t: 'cat', a, b: add() }; } return a; }
    function add() { let a = mul(); while (isOp('+') || isOp('-')) { const op = take().v; a = { t: 'bin', op, a, b: mul() }; } return a; }
    function mul() { let a = unary(); while (isOp('*') || isOp('/') || isOp('%')) { const op = take().v; a = { t: 'bin', op, a, b: unary() }; } return a; }
    function unary() { if (isOp('-')) { i++; return { t: 'neg', a: unary() }; } if (isOp('+')) { i++; return unary(); } return pow(); }
    function pow() { const a = prim(); if (isOp('^')) { i++; return { t: 'bin', op: '^', a, b: unary() }; } return a; }
    function prim() {
      const k = take(); if (!k) throw new Error('Unexpected end of expression');
      if (k.k === 'num') return { t: 'lit', v: k.v };
      if (k.k === 'str') return { t: 'lit', v: k.v };
      if (k.k === 'field') return { t: 'field', name: k.v };
      if (k.k === 'op' && k.v === '(') { const e = or(); need(')'); return e; }
      if (k.k === 'id') {
        const U = k.v.toUpperCase();
        if (U === 'TRUE') return { t: 'lit', v: true }; if (U === 'FALSE') return { t: 'lit', v: false }; if (U === 'NULL') return { t: 'lit', v: null };
        if (U === 'CASE') {
          const whens = []; let els = { t: 'lit', v: null };
          while (isKw('WHEN')) { i++; const c = or(); kw('THEN'); whens.push([c, or()]); }
          if (isKw('ELSE')) { i++; els = or(); } kw('END'); if (!whens.length) throw new Error('CASE needs WHEN'); return { t: 'case', whens, els };
        }
        if (k.v[0] === '$') { const v = k.v.toLowerCase(); if (!['$area', '$length', '$perimeter', '$x', '$y', '$id', '$geomtype', '$numparts', '$numpoints'].includes(v)) throw new Error('Unknown variable ' + k.v); return { t: 'var', v }; }
        if (isOp('(')) {
          const f = k.v.toLowerCase(); if (!FN[f]) throw new Error(`Unknown function ${k.v}()`);
          i++; const args = []; if (!isOp(')')) { args.push(or()); while (isOp(',')) { i++; args.push(or()); } } need(')');
          const ar = ARITY[f]; if (ar && (args.length < ar[0] || args.length > ar[1])) throw new Error(`${f}() takes ${ar[0] === ar[1] ? ar[0] : ar[0] + '–' + ar[1]} arguments`);
          return { t: 'call', f, args };
        }
        return { t: 'field', name: k.v, bare: true };
      }
      throw new Error(`Unexpected “${k.v}”`);
    }
    if (!t.length) throw new Error('Empty expression');
    const e = or(); if (i < t.length) throw new Error(`Unexpected “${t[i].v}”`); return e;
  }
  function likeRe(p, ci) { let r = ''; for (const c of String(p)) r += c === '%' ? '.*' : c === '_' ? '.' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return new RegExp('^' + r + '$', ci ? 'is' : 's'); }
  function cmpv(op, a, b) {
    if (a == null || b == null) return null;
    if (typeof a !== typeof b) { const na = num(a), nb = num(b); if (na != null && nb != null) { a = na; b = nb; } else { a = String(a); b = String(b); } }
    switch (op) { case '=': return a === b; case '!=': return a !== b; case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b; }
  }
  function ev(n, f, ctx) {
    switch (n.t) {
      case 'lit': return n.v;
      case 'field': { const p = f.properties || {}; if (Object.prototype.hasOwnProperty.call(p, n.name)) return p[n.name]; if (n.bare) throw new Error(`Unknown field “${n.name}”`); return null; }
      case 'var': {
        const g = f.geometry;
        switch (n.v) {
          case '$area': return G.geomArea(g); case '$length': return G.geomLength(G.baseType(g && g.type) === 'Polygon' ? null : g); case '$perimeter': return G.geomLength(G.baseType(g && g.type) === 'Polygon' ? g : null);
          case '$x': { const c = g && G.centroid(g); return c ? c[0] : null; } case '$y': { const c = g && G.centroid(g); return c ? c[1] : null; }
          case '$id': return f.id; case '$geomtype': return g ? G.baseType(g.type) : null;
          case '$numparts': return g ? (g.type.startsWith('Multi') ? g.coordinates.length : 1) : 0; case '$numpoints': return g ? G.parts(g).reduce((s, p) => s + p.length, 0) : 0;
        }
        return null;
      }
      case 'or': { const a = ev(n.a, f, ctx); if (truthy(a)) return true; const b = ev(n.b, f, ctx); return truthy(b) ? true : (a == null || b == null) ? null : false; }
      case 'and': { const a = ev(n.a, f, ctx); if (a != null && !truthy(a)) return false; const b = ev(n.b, f, ctx); if (b != null && !truthy(b)) return false; return a == null || b == null ? null : true; }
      case 'not': { const a = ev(n.a, f, ctx); return a == null ? null : !truthy(a); }
      case 'cmp': return cmpv(n.op, ev(n.a, f, ctx), ev(n.b, f, ctx));
      case 'like': { const a = ev(n.a, f, ctx), b = ev(n.b, f, ctx); if (a == null || b == null) return null; const key = (n.ci ? 'i' : 's') + b; ctx.re = ctx.re || new Map(); let re = ctx.re.get(key); if (!re) { re = likeRe(b, n.ci); ctx.re.set(key, re); } const r = re.test(String(a)); return n.neg ? !r : r; }
      case 'in': { const a = ev(n.a, f, ctx); if (a == null) return null; const r = n.list.some(x => cmpv('=', a, ev(x, f, ctx))); return n.neg ? !r : r; }
      case 'between': { const a = ev(n.a, f, ctx), lo = ev(n.lo, f, ctx), hi = ev(n.hi, f, ctx); const r = cmpv('>=', a, lo); const s = cmpv('<=', a, hi); if (r == null || s == null) return null; return n.neg ? !(r && s) : r && s; }
      case 'isnull': { const a = ev(n.a, f, ctx), r = a == null || a === ''; return n.neg ? !r : r; }
      case 'cat': { const a = ev(n.a, f, ctx), b = ev(n.b, f, ctx); return a == null || b == null ? null : String(a) + String(b); }
      case 'neg': { const a = num(ev(n.a, f, ctx)); return a == null ? null : -a; }
      case 'bin': {
        const ra = ev(n.a, f, ctx), rb = ev(n.b, f, ctx);
        if (n.op === '+' && (typeof ra === 'string' && isNaN(+ra) || typeof rb === 'string' && isNaN(+rb))) return ra == null || rb == null ? null : String(ra) + String(rb);
        const a = num(ra), b = num(rb); if (a == null || b == null) return null;
        switch (n.op) { case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return b === 0 ? null : a / b; case '%': return b === 0 ? null : a % b; case '^': return Math.pow(a, b); }
        return null;
      }
      case 'case': { for (const [c, v] of n.whens) if (truthy(ev(c, f, ctx))) return ev(v, f, ctx); return ev(n.els, f, ctx); }
      case 'call': { const args = n.args.map(a => ev(a, f, ctx)); const r = FN[n.f](...args); return typeof r === 'number' && !isFinite(r) ? null : r; }
    }
    return null;
  }
  function fieldsOf(n, out = new Set()) { if (!n || typeof n !== 'object') return out; if (n.t === 'field') out.add(n.name); Object.values(n).forEach(v => Array.isArray(v) ? v.forEach(x => Array.isArray(x) ? x.forEach(y => fieldsOf(y, out)) : fieldsOf(x, out)) : v && typeof v === 'object' && fieldsOf(v, out)); return out; }
  // compile(src, fields?) → { ok, error, eval(feature), test(feature) }
  function compile(src, fields) {
    try {
      const ast = parse(src), used = fieldsOf(ast);
      if (fields) { const names = new Set(fields.map(x => x.name || x)); for (const u of used) if (!names.has(u)) throw new Error(`Unknown field “${u}”`); }
      const ctx = {};
      return { ok: true, ast, fields: [...used], eval: f => ev(ast, f, ctx), test: f => { try { return truthy(ev(ast, f, ctx)); } catch (e) { return false; } } };
    } catch (e) { return { ok: false, error: e.message, eval: () => null, test: () => false }; }
  }
  const quoteField = n => '"' + String(n).replace(/"/g, '""') + '"';
  const quoteValue = v => v == null ? 'NULL' : typeof v === 'number' || typeof v === 'boolean' ? String(v).toUpperCase() === 'TRUE' || String(v).toUpperCase() === 'FALSE' ? String(v).toUpperCase() : String(v) : "'" + String(v).replace(/'/g, "''") + "'";
  const api = { compile, parse, tokenize, truthy, quoteField, quoteValue, FUNCTIONS: Object.keys(FN) };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MapExpr = api;
})(typeof self !== 'undefined' ? self : this);
