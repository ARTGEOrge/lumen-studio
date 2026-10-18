// Lumen Spice — SPICE numbers (1k, 4k7, 10uF, 2meg) and a small, safe expression evaluator.
// Expressions come from untrusted files (netlists, projects), so nothing here ever calls eval/Function:
// text is tokenised and parsed into a tiny AST that only knows arithmetic and a fixed list of math functions.
(function (root) {
  'use strict';
  const SCALE = { t: 1e12, g: 1e9, meg: 1e6, k: 1e3, m: 1e-3, mil: 25.4e-6, u: 1e-6, 'µ': 1e-6, 'μ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };
  const NUM_RE = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(meg|mil|[tgkmuµμnpf])?([a-zµμΩ]*)$/i;
  // "4k7" = 4.7k, "2R2" = 2.2, "1u5" = 1.5u (European notation used on schematics)
  const RKM_RE = /^(\d+)(meg|[rkmunpgtµ])(\d+)([a-zΩ]*)$/i;

  function parseNum(s) {
    if (typeof s === 'number') return s;
    if (s == null) return NaN;
    s = String(s).trim();
    let m = NUM_RE.exec(s);
    if (m) {
      // "1e3" is caught by the number part; a bare unit such as "F", "V", "Hz", "Ohm" is ignored like SPICE does
      const v = parseFloat(m[1]); const sfx = (m[2] || '').toLowerCase();
      // "1F" means femto in SPICE; "1Meg" mega. Words like "10uF" → micro (suffix u) + unit F
      return sfx ? v * SCALE[sfx] : v;
    }
    m = RKM_RE.exec(s);
    if (m) { const sfx = m[2].toLowerCase(), f = sfx === 'r' ? 1 : SCALE[sfx]; return parseFloat(m[1] + '.' + m[3]) * f; }
    return NaN;
  }

  // engineering format: 4.7k, 10µ, 1.5Meg
  const PFX = [[1e12, 'T'], [1e9, 'G'], [1e6, 'Meg'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
  function fmtEng(v, digits = 4, unit = '') {
    if (!Number.isFinite(v)) return String(v);
    if (v === 0) return '0' + (unit ? ' ' + unit : '');
    const a = Math.abs(v);
    let p = PFX.find(([f]) => a >= f * 0.99995) || PFX[PFX.length - 1];
    const s = +(v / p[0]).toPrecision(digits);
    return s + (unit ? ' ' + p[1] + unit : p[1]);
  }
  // SPICE-safe formatting for netlists (ASCII "u", "Meg")
  function fmtSpice(v) {
    if (!Number.isFinite(v)) return String(v);
    if (v === 0) return '0';
    const a = Math.abs(v);
    const tab = [[1e12, 'T'], [1e9, 'G'], [1e6, 'Meg'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'u'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
    const p = tab.find(([f]) => a >= f * 0.99995);
    if (!p) return String(+v.toPrecision(6));
    return String(+(v / p[0]).toPrecision(6)) + p[1];
  }

  // ---------- expressions ----------
  const FUNCS = {
    sqrt: Math.sqrt, exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10, sin: Math.sin, cos: Math.cos, tan: Math.tan,
    asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    abs: Math.abs, min: Math.min, max: Math.max, pow: Math.pow, pwr: (a, b) => Math.sign(a) * Math.pow(Math.abs(a), b),
    floor: Math.floor, ceil: Math.ceil, round: Math.round, sgn: Math.sign, sign: Math.sign, hypot: Math.hypot,
    db: x => 20 * Math.log10(Math.abs(x)), limit: (x, a, b) => Math.min(Math.max(x, Math.min(a, b)), Math.max(a, b)),
    if: (c, a, b) => (c ? a : b), u: x => (x > 0 ? 1 : 0),
  };
  const CONST = { pi: Math.PI, e: Math.E, k: 1.380649e-23, q: 1.602176634e-19 };
  const SIGFN = /^(v|i|ic|ib|ie|id|ig|is|vd|vb|vc|ve)$/i;

  function tokenize(src) {
    const out = []; let i = 0; const s = String(src);
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      let m;
      if ((m = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:meg|mil|[tgkmuµμnpf])?(?![a-z0-9_])/i.exec(s.slice(i))) ||
          (m = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?(?:meg|mil|[tgkmuµμnpf])?[a-z]*/i.exec(s.slice(i)))) {
        out.push({ t: 'num', v: parseNum(m[0]) }); i += m[0].length; continue;
      }
      if ((m = /^[a-z_][\w.:$#]*/i.exec(s.slice(i)))) {
        const name = m[0]; i += name.length;
        // signal reference: V(out), V(a,b), I(R1), Ic(Q1) — arguments are raw node/device names
        if (SIGFN.test(name) && s[i] === '(') {
          const close = s.indexOf(')', i); if (close < 0) throw new Error('Missing ) after ' + name);
          const args = s.slice(i + 1, close).split(',').map(a => a.trim()).filter(Boolean);
          out.push({ t: 'sig', fn: name.toUpperCase(), args }); i = close + 1; continue;
        }
        out.push({ t: 'id', v: name }); continue;
      }
      if (s.startsWith('**', i)) { out.push({ t: 'op', v: '^' }); i += 2; continue; }
      if (/^(<=|>=|==|!=|&&|\|\|)/.test(s.slice(i))) { out.push({ t: 'op', v: s.slice(i, i + 2) }); i += 2; continue; }
      if ('+-*/^(),<>!'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
      throw new Error(`Unexpected "${c}" in expression`);
    }
    return out;
  }

  // precedence climbing → AST nodes: ['n',v] ['id',name] ['sig',fn,args] ['u',op,a] ['b',op,a,b] ['f',name,args]
  function parse(src) {
    const tk = tokenize(src); let p = 0;
    const peek = () => tk[p], next = () => tk[p++];
    const isOp = v => tk[p] && tk[p].t === 'op' && tk[p].v === v;
    const PREC = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '^': 8 };
    function primary() {
      const t = next(); if (!t) throw new Error('Unexpected end of expression');
      if (t.t === 'num') return ['n', t.v];
      if (t.t === 'sig') return ['sig', t.fn, t.args];
      if (t.t === 'id') {
        if (isOp('(')) {
          next(); const args = [];
          if (!isOp(')')) { do { args.push(expr(0)); } while (isOp(',') && next()); }
          if (!isOp(')')) throw new Error('Missing ) in call to ' + t.v); next();
          const fn = t.v.toLowerCase(); if (!Object.prototype.hasOwnProperty.call(FUNCS, fn)) throw new Error('Unknown function ' + t.v);
          return ['f', fn, args];
        }
        return ['id', t.v];
      }
      if (t.t === 'op' && t.v === '(') { const e = expr(0); if (!isOp(')')) throw new Error('Missing )'); next(); return e; }
      if (t.t === 'op' && (t.v === '-' || t.v === '+' || t.v === '!')) return ['u', t.v, expr(7)];
      throw new Error('Unexpected ' + (t.v ?? t.t));
    }
    function expr(minP) {
      let lhs = primary();
      for (;;) {
        const t = peek(); if (!t || t.t !== 'op' || !(t.v in PREC)) break;
        const pr = PREC[t.v]; if (pr < minP) break;
        next(); const rhs = expr(t.v === '^' ? pr : pr + 1);   // ^ is right-associative
        lhs = ['b', t.v, lhs, rhs];
      }
      return lhs;
    }
    const e = expr(0); if (p < tk.length) throw new Error('Unexpected ' + (tk[p].v ?? tk[p].t)); return e;
  }

  // env(name) → number | undefined ; sig(fn, args) → number
  function evalAst(a, env, sig) {
    switch (a[0]) {
      case 'n': return a[1];
      case 'id': {
        const v = env ? env(a[1]) : undefined; if (v !== undefined) return v;
        const ck = a[1].toLowerCase(); if (Object.prototype.hasOwnProperty.call(CONST, ck)) return CONST[ck];
        throw new Error('Unknown parameter ' + a[1]);
      }
      case 'sig': if (!sig) throw new Error(a[1] + '(…) is not allowed here'); return sig(a[1], a[2]);
      case 'u': { const x = evalAst(a[2], env, sig); return a[1] === '-' ? -x : a[1] === '!' ? (x ? 0 : 1) : x; }
      case 'f': return FUNCS[a[1]](...a[2].map(z => evalAst(z, env, sig)));
      case 'b': {
        const x = evalAst(a[2], env, sig), y = evalAst(a[3], env, sig);
        switch (a[1]) {
          case '+': return x + y; case '-': return x - y; case '*': return x * y; case '/': return x / y; case '^': return Math.pow(x, y);
          case '<': return +(x < y); case '>': return +(x > y); case '<=': return +(x <= y); case '>=': return +(x >= y);
          case '==': return +(x === y); case '!=': return +(x !== y); case '&&': return +(x && y); case '||': return +(x || y);
        }
      }
    }
    throw new Error('Bad expression');
  }
  // collect signal references (for trace expressions)
  function signals(a, out = []) {
    if (a[0] === 'sig') out.push([a[1], a[2]]);
    else if (a[0] === 'u') signals(a[2], out);
    else if (a[0] === 'b') { signals(a[2], out); signals(a[3], out); }
    else if (a[0] === 'f') a[2].forEach(z => signals(z, out));
    return out;
  }
  function evaluate(src, env, sig) { return evalAst(parse(src), env, sig); }
  // value that may be a number with suffix, or {expression}, or a bare expression
  function value(s, env) {
    if (typeof s === 'number') return s;
    s = String(s).trim();
    const n = parseNum(s); if (!Number.isNaN(n)) return n;
    if (/^\{.*\}$/.test(s) || /^'.*'$/.test(s)) s = s.slice(1, -1);
    return evaluate(s, env);
  }

  const api = { parseNum, fmtEng, fmtSpice, tokenize, parse, evalAst, evaluate, value, signals, FUNCS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SpiceExpr = api;
})(typeof self !== 'undefined' ? self : this);
