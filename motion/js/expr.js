'use strict';
/* Lumen Motion — expressions-lite.
   A tiny, self-contained interpreter for After-Effects-style property expressions.
   It never calls eval/Function and exposes no host objects: the only things an expression can reach
   are numbers, strings, arrays and the whitelisted built-ins below. There are no loops or user
   functions, so every expression terminates. */
(function () {
  const LM = window.LM = window.LM || {};

  /* ---------- tokenizer ---------- */
  const PUNCT = ['===', '!==', '**', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '+', '-', '*', '/', '%', '<', '>', '!', '?', ':', '(', ')', '[', ']', ',', '.', '=', ';', '{', '}'];
  function tokenize(src) {
    const out = []; let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (c === '\n') { out.push({ t: 'nl' }); i++; continue; }
      if (/\s/.test(c)) { i++; continue; }
      if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) {
        const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i)); out.push({ t: 'num', v: parseFloat(m[0]) }); i += m[0].length; continue;
      }
      if (/[A-Za-z_$]/.test(c)) { const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i)); out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1, s = '';
        while (j < src.length && src[j] !== c) { if (src[j] === '\\' && j + 1 < src.length) { j++; s += src[j] === 'n' ? '\n' : src[j]; } else s += src[j]; j++; }
        if (j >= src.length) throw new SyntaxError('Unterminated string');
        out.push({ t: 'str', v: s }); i = j + 1; continue;
      }
      const p = PUNCT.find(p => src.startsWith(p, i));
      if (!p) throw new SyntaxError(`Unexpected character "${c}"`);
      out.push({ t: 'p', v: p }); i += p.length;
    }
    out.push({ t: 'eof' });
    return out;
  }

  /* ---------- parser → AST ---------- */
  function parse(src) {
    if (src.length > 4000) throw new SyntaxError('Expression too long');
    const toks = tokenize(src); let pos = 0;
    const peek = () => toks[pos], next = () => toks[pos++];
    const isP = v => peek().t === 'p' && peek().v === v;
    const eat = v => { if (!isP(v)) throw new SyntaxError(`Expected "${v}"`); pos++; };
    const skipSep = () => { while (peek().t === 'nl' || isP(';')) pos++; };
    const skipNl = () => { while (peek().t === 'nl') pos++; };

    function program() { const body = []; skipSep(); while (peek().t !== 'eof') { body.push(statement()); skipSep(); } return { k: 'prog', body }; }
    function block() {
      skipNl();
      if (isP('{')) { pos++; const body = []; skipSep(); while (!isP('}')) { if (peek().t === 'eof') throw new SyntaxError('Missing }'); body.push(statement()); skipSep(); } pos++; return { k: 'block', body }; }
      return statement();
    }
    function statement() {
      const tk = peek();
      if (tk.t === 'id' && (tk.v === 'var' || tk.v === 'let' || tk.v === 'const')) {
        pos++; const decls = [];
        do { const n = next(); if (n.t !== 'id') throw new SyntaxError('Expected a name'); let init = null; if (isP('=')) { pos++; init = expr(); } decls.push({ name: n.v, init }); } while (isP(',') && ++pos);
        return { k: 'var', decls };
      }
      if (tk.t === 'id' && tk.v === 'if') {
        pos++; eat('('); const test = expr(); eat(')'); const cons = block(); let alt = null;
        const save = pos; skipSep(); if (peek().t === 'id' && peek().v === 'else') { pos++; alt = block(); } else pos = save;
        return { k: 'if', test, cons, alt };
      }
      if (tk.t === 'id' && toks[pos + 1].t === 'p' && ['=', '+=', '-=', '*=', '/='].includes(toks[pos + 1].v)) {
        pos += 2; return { k: 'assign', name: tk.v, op: toks[pos - 1].v, value: expr() };
      }
      return { k: 'expr', e: expr() };
    }
    function expr() {
      const test = binary(0);
      if (isP('?')) { pos++; skipNl(); const a = expr(); skipNl(); eat(':'); skipNl(); const b = expr(); return { k: 'cond', test, a, b }; }
      return test;
    }
    const PREC = [['||'], ['&&'], ['==', '!=', '===', '!=='], ['<', '>', '<=', '>='], ['+', '-'], ['*', '/', '%']];
    function binary(level) {
      if (level >= PREC.length) return unary();
      let left = binary(level + 1);
      while (peek().t === 'p' && PREC[level].includes(peek().v)) { const op = next().v; skipNl(); left = { k: 'bin', op, l: left, r: binary(level + 1) }; }
      return left;
    }
    function unary() {
      if (isP('-') || isP('+') || isP('!')) { const op = next().v; return { k: 'un', op, e: unary() }; }
      const base = postfix();
      if (isP('**')) { pos++; return { k: 'bin', op: '**', l: base, r: unary() }; }
      return base;
    }
    function postfix() {
      let e = primary();
      for (;;) {
        if (isP('.')) { pos++; const n = next(); if (n.t !== 'id') throw new SyntaxError('Expected a property name'); e = { k: 'mem', o: e, name: n.v }; }
        else if (isP('[')) { pos++; const i = expr(); eat(']'); e = { k: 'idx', o: e, i }; }
        else if (isP('(')) { pos++; const args = []; skipNl(); while (!isP(')')) { args.push(expr()); skipNl(); if (isP(',')) { pos++; skipNl(); } else break; } eat(')'); e = { k: 'call', f: e, args }; }
        else return e;
      }
    }
    function primary() {
      const tk = next();
      if (tk.t === 'num') return { k: 'num', v: tk.v };
      if (tk.t === 'str') return { k: 'str', v: tk.v };
      if (tk.t === 'id') { if (tk.v === 'true') return { k: 'num', v: true }; if (tk.v === 'false') return { k: 'num', v: false }; return { k: 'id', name: tk.v }; }
      if (tk.t === 'p' && tk.v === '(') { skipNl(); const e = expr(); skipNl(); eat(')'); return e; }
      if (tk.t === 'p' && tk.v === '[') { const items = []; skipNl(); while (!isP(']')) { items.push(expr()); skipNl(); if (isP(',')) { pos++; skipNl(); } else break; } eat(']'); return { k: 'arr', items }; }
      throw new SyntaxError(tk.t === 'eof' ? 'Unexpected end of expression' : `Unexpected "${tk.v ?? tk.t}"`);
    }
    return program();
  }

  /* ---------- values & math ---------- */
  class Fn { constructor(f, members) { this.f = f; if (members) this.m = new Map(Object.entries(members)); } }   // callable built-in (optionally with members)
  class NS { constructor(map) { this.m = new Map(Object.entries(map)); } }   // namespace (Math, thisComp…)
  class Lazy { constructor(f) { this.f = f; } }        // namespace member computed when it is read
  class Prop { constructor(get, at) { this.get = get; this.at = at; } }   // reference to another property (value, valueAtTime, velocity)
  const V = x => x instanceof Prop ? x.get() : x;
  const isArr = Array.isArray;
  function num(v) { if (typeof v === 'number') return v; if (typeof v === 'boolean') return +v; if (isArr(v)) return num(v[0]); throw new TypeError('Expected a number'); }
  function vecOp(a, b, f, name) {
    if (isArr(a) && isArr(b)) { if (name === '*' || name === '/') throw new TypeError(`Cannot ${name === '*' ? 'multiply' : 'divide'} two arrays (use mul()/div() with a number)`); const n = Math.max(a.length, b.length), o = []; for (let i = 0; i < n; i++) o.push(f(+(a[i] ?? 0), +(b[i] ?? 0))); return o; }
    if (isArr(a)) { if (name === '+' || name === '-') return a.map((x, i) => i === 0 ? f(x, num(b)) : x); return a.map(x => f(x, num(b))); }
    if (isArr(b)) { if (name === '+' || name === '-') return b.map((x, i) => i === 0 ? f(num(a), x) : (name === '-' ? -x : x)); return b.map(x => f(num(a), x)); }
    return f(num(a), num(b));
  }
  function binop(op, a, b) {
    switch (op) {
      case '+': if (typeof a === 'string' || typeof b === 'string') return String(a) + String(b); return vecOp(a, b, (x, y) => x + y, '+');
      case '-': return vecOp(a, b, (x, y) => x - y, '-');
      case '*': return vecOp(a, b, (x, y) => x * y, '*');
      case '/': return vecOp(a, b, (x, y) => x / y, '/');
      case '%': return vecOp(a, b, (x, y) => x % y, '%');
      case '**': return Math.pow(num(a), num(b));
      case '<': return num(a) < num(b); case '>': return num(a) > num(b);
      case '<=': return num(a) <= num(b); case '>=': return num(a) >= num(b);
      case '==': case '===': return eq(a, b); case '!=': case '!==': return !eq(a, b);
    }
    throw new SyntaxError('Unknown operator ' + op);
  }
  const eq = (a, b) => isArr(a) && isArr(b) ? a.length === b.length && a.every((x, i) => x === b[i]) : a === b;
  const truthy = v => isArr(v) ? true : !!v;

  /* deterministic noise for wiggle()/noise()/random() */
  function hash(n) { n = (n | 0) ^ 0x9e3779b9; n = Math.imul(n ^ (n >>> 16), 0x85ebca6b); n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35); n ^= n >>> 16; return (n >>> 0) / 4294967296; }
  function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h | 0; }
  function vnoise(seed, x) { // smooth value noise, -1..1
    const i = Math.floor(x), f = x - i, u = f * f * f * (f * (f * 6 - 15) + 10);
    const a = hash(seed * 7919 + i) * 2 - 1, b = hash(seed * 7919 + i + 1) * 2 - 1;
    return a + (b - a) * u;
  }
  function easeCurve(kind, s) { s = Math.min(1, Math.max(0, s)); if (kind === 'linear') return s; if (kind === 'easeIn') return s * s * s; if (kind === 'easeOut') { const r = 1 - s; return 1 - r * r * r; } return s * s * (3 - 2 * s); }
  function lerpV(a, b, p) { if (isArr(a) || isArr(b)) { const A = isArr(a) ? a : [a], B = isArr(b) ? b : [b]; const n = Math.max(A.length, B.length), o = []; for (let i = 0; i < n; i++) o.push(+(A[i] ?? 0) + (+(B[i] ?? 0) - +(A[i] ?? 0)) * p); return o; } return num(a) + (num(b) - num(a)) * p; }
  function mapper(kind) {
    return (...a) => {
      let t, t0 = 0, t1 = 1, v1, v2;
      if (a.length >= 5) [t, t0, t1, v1, v2] = a; else if (a.length === 3) [t, v1, v2] = a; else throw new TypeError(`${kind}() needs 3 or 5 arguments`);
      t = num(t); t0 = num(t0); t1 = num(t1);
      const s = t1 === t0 ? (t >= t1 ? 1 : 0) : (t - t0) / (t1 - t0);
      return lerpV(v1, v2, easeCurve(kind, s));
    };
  }

  const MATH = new NS(Object.fromEntries(['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'abs', 'min', 'max', 'floor', 'ceil', 'round', 'sqrt', 'pow', 'exp', 'log', 'sign', 'hypot', 'trunc', 'log10', 'log2', 'cbrt']
    .map(n => [n, new Fn((...a) => Math[n](...a.map(num)))]).concat([['PI', Math.PI], ['E', Math.E], ['SQRT2', Math.SQRT2]])));

  /* ---------- evaluation ----------
     ctx: { value, time, fps, seed, layerIndex, inPoint, outPoint, comp:{width,height,duration,fps}, valueAtTime(t), loop(type,dir,n) } */
  class Restart { constructor(t) { this.t = t; } }
  const SOFT = new Set(['transform', 'effect', 'position', 'scale', 'rotation', 'opacity', 'anchorPoint', 'marker', 'toComp', 'fromComp']);
  const TR_NAMES = { anchorPoint: 'anchor', position: 'position', scale: 'scale', rotation: 'rotation', zRotation: 'rotation', opacity: 'opacity', zPosition: 'posZ', xRotation: 'rotX', yRotation: 'rotY' };
  const lc = s => String(s).trim().toLowerCase();
  // read-only references to other layers, their properties and effects, and markers of the same composition
  function refScope(ctx) {
    const C = ctx.compObj, depth = (ctx.depth || 0) + 1, cache = new Map();
    const prop = p => new Prop(() => LM.val(p, ctx.time, depth), t => LM.val(p, t, depth));
    const markers = (list, off) => {
      const ms = (isArr(list) ? list : []).slice().sort((a, b) => a.t - b.t);
      const key = i => { i = Math.round(num(i)); const m = ms[i - 1]; if (!m) throw new RangeError(`Marker ${i} does not exist`); return new NS({ time: m.t + off, index: i, comment: m.name || '', name: m.name || '', duration: m.dur || 0 }); };
      return new NS({ numKeys: ms.length, key: new Fn(key), nearestKey: new Fn(t => { if (!ms.length) throw new RangeError('There are no markers'); t = num(t); let bi = 0; ms.forEach((m, i) => { if (Math.abs(m.t + off - t) < Math.abs(ms[bi].t + off - t)) bi = i; }); return key(bi + 1); }) });
    };
    function effectFn(L) {
      return new Fn(sel => {
        let fx;
        if (typeof sel === 'number') fx = L.effects[Math.round(sel) - 1];
        else { const s = lc(sel); fx = L.effects.find(f => lc(f.name || LM.FX[f.type].name) === s) || L.effects.find(f => lc(LM.FX[f.type].name) === s); }
        if (!fx) throw new ReferenceError(`Effect ${typeof sel === 'number' ? sel : '“' + sel + '”'} not found on “${L.name}”`);
        const D = LM.FX[fx.type], params = D.params.filter(q => !q.static);
        return new Fn(ps => {
          const q = typeof ps === 'number' ? params[Math.round(ps) - 1] : params.find(q => lc(q.label) === lc(ps) || lc(q.k) === lc(ps));
          if (!q) throw new ReferenceError(`“${fx.name || D.name}” has no parameter ${typeof ps === 'number' ? ps : '“' + ps + '”'}`);
          return prop(fx.p[q.k]);
        }, { name: fx.name || D.name, active: !!fx.on });
      });
    }
    const M2 = p => { if (!isArr(p) || p.length < 2) throw new TypeError('Expected a point [x, y]'); return [num(p[0]), num(p[1])]; };
    function layerNS(L) {
      if (cache.has(L)) return cache.get(L);
      const tr = L.tr, T = {}; Object.entries(TR_NAMES).forEach(([k, id]) => { if (tr[id]) T[k] = new Lazy(() => prop(tr[id])); });
      const mat = () => LM.layerMatrix(L, ctx.time, C);
      const ns = new NS(Object.assign({
        name: L.name, index: C.layers.indexOf(L) + 1, inPoint: L.in, outPoint: L.out, startTime: L.start, hasParent: !!L.parent,
        parent: new Lazy(() => { const P = L.parent && C.layers.find(x => x.id === L.parent); if (!P) throw new ReferenceError(`“${L.name}” has no parent`); return layerNS(P); }),
        transform: new NS(T), effect: effectFn(L), marker: new Lazy(() => markers(L.markers, L.start)),
        toComp: new Fn(p => { const q = M2(p); return LM.M.apply(mat(), q[0], q[1]); }),
        fromComp: new Fn(p => { const q = M2(p); return LM.M.apply(LM.M.inv(mat()), q[0], q[1]); }),
      }, T));
      cache.set(L, ns); return ns;
    }
    const layerBy = sel => {
      if (!C) throw new ReferenceError('No composition');
      const L = typeof sel === 'number' ? C.layers[Math.round(sel) - 1] : C.layers.find(l => l.name === String(sel)) || C.layers.find(l => lc(l.name) === lc(sel));
      if (!L) throw new ReferenceError(`Layer ${typeof sel === 'number' ? sel : '“' + sel + '”'} not found`);
      return layerNS(L);
    };
    return { layerNS, layerBy, markers };
  }
  function makeScope(ctx) {
    let rngState = ctx.seed >>> 0;
    const rnd = () => { rngState = (rngState + 0x6D2B79F5) >>> 0; let t = rngState; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    let seeded = false;
    const seedFromTime = () => { if (!seeded) { rngState = (hashStr(String(ctx.seed)) ^ Math.floor(ctx.time * ctx.fps + .5) * 2654435761) >>> 0; seeded = true; } };
    const wiggle = (freq, amp, oct = 1, mult = .5, t = ctx.time) => {
      freq = num(freq); amp = num(amp); oct = Math.max(1, Math.min(8, Math.round(num(oct)))); mult = num(mult); t = num(t);
      const w = d => { let s = 0, a = 1, f = 1, norm = 0; for (let o = 0; o < oct; o++) { s += vnoise(ctx.seed + d * 131 + o * 17, t * freq * f + d * 3.7) * a; norm += a; a *= mult; f *= 2; } return s / (oct > 1 ? norm : 1) * amp; };
      const v = ctx.value; return isArr(v) ? v.map((x, d) => x + w(d)) : num(v) + w(0);
    };
    const C = ctx.compObj, Lr = ctx.layer, refs = refScope(ctx);
    const B = {
      Math: MATH,
      time: ctx.time, value: ctx.value, index: ctx.layerIndex, inPoint: ctx.inPoint, outPoint: ctx.outPoint,
      thisComp: new NS({ width: ctx.comp.width, height: ctx.comp.height, duration: ctx.comp.duration, frameDuration: 1 / ctx.fps, fps: ctx.fps, numLayers: ctx.comp.numLayers,
        layer: new Fn(refs.layerBy), marker: new Lazy(() => refs.markers(C && C.markers, 0)) }),
      thisLayer: Lr && C ? refs.layerNS(Lr) : new NS({ index: ctx.layerIndex, inPoint: ctx.inPoint, outPoint: ctx.outPoint, name: ctx.layerName || '' }),
      wiggle: new Fn(wiggle),
      loopOut: new Fn((type = 'cycle', n = 0) => ctx.loop(String(type), 'out', num(n))),
      loopIn: new Fn((type = 'cycle', n = 0) => ctx.loop(String(type), 'in', num(n))),
      valueAtTime: new Fn(t => ctx.valueAtTime(num(t))),
      linear: new Fn(mapper('linear')), ease: new Fn(mapper('ease')), easeIn: new Fn(mapper('easeIn')), easeOut: new Fn(mapper('easeOut')),
      clamp: new Fn((v, a, b) => isArr(v) ? v.map((x, i) => Math.min(Math.max(x, isArr(a) ? a[i] : num(a)), isArr(b) ? b[i] : num(b))) : Math.min(Math.max(num(v), num(a)), num(b))),
      random: new Fn((a, b) => { seedFromTime(); const r = rnd(); if (a === undefined) return r; if (b === undefined) return isArr(a) ? a.map(x => x * rnd()) : r * num(a); if (isArr(a) || isArr(b)) { const A = isArr(a) ? a : [a], Bb = isArr(b) ? b : [b]; return A.map((x, i) => x + (Bb[i] - x) * rnd()); } return num(a) + (num(b) - num(a)) * r; }),
      seedRandom: new Fn((s, timeless = false) => { rngState = (hashStr(String(ctx.seed)) ^ Math.imul(num(s) | 0, 2654435761) ^ (truthy(timeless) ? 0 : Math.floor(ctx.time * ctx.fps + .5) * 40503)) >>> 0; seeded = true; return 0; }),
      noise: new Fn(x => vnoise(ctx.seed, isArr(x) ? num(x[0]) + num(x[1] ?? 0) * 1.618 : num(x))),
      degreesToRadians: new Fn(d => num(d) * Math.PI / 180), radiansToDegrees: new Fn(r => num(r) * 180 / Math.PI),
      timeToFrames: new Fn((t = ctx.time) => Math.round(num(t) * ctx.fps)), framesToTime: new Fn(f => num(f) / ctx.fps),
      posterizeTime: new Fn(f => { f = num(f); if (f > 0 && !ctx.posterized) { const t = Math.floor(ctx.time * f + 1e-6) / f; throw new Restart(t); } return f; }),
      add: new Fn((a, b) => binop('+', a, b)), sub: new Fn((a, b) => binop('-', a, b)), mul: new Fn((a, b) => binop('*', a, b)), div: new Fn((a, b) => binop('/', a, b)),
      length: new Fn((a, b) => { if (b !== undefined) a = binop('-', a, b); return isArr(a) ? Math.hypot(...a) : Math.abs(num(a)); }),
      normalize: new Fn(a => { const l = Math.hypot(...a) || 1; return a.map(x => x / l); }),
      dot: new Fn((a, b) => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0)),
      Number: new Fn(x => +x), parseFloat: new Fn(x => parseFloat(x)), isNaN: new Fn(x => Number.isNaN(+x)),
    };
    // layer-scope shorthands as in After Effects (transform.position, effect("Slider Control")("Slider"), marker…); a var may shadow them
    if (Lr && C) { const me = B.thisLayer; SOFT.forEach(k => { if (me.m.has(k)) B[k] = me.m.get(k); }); }
    return B;
  }
  const MAX_STEPS = 20000;
  function run(ast, ctx) {
    const builtins = makeScope(ctx), locals = new Map();
    let steps = 0, last;
    const look = n => { if (locals.has(n)) return locals.get(n); if (Object.prototype.hasOwnProperty.call(builtins, n)) { const b = builtins[n]; return b instanceof Lazy ? b.f() : b; } throw new ReferenceError(`${n} is not defined`); };
    const evv = n => V(ev(n));
    function ev(n) {
      if (++steps > MAX_STEPS) throw new Error('Expression too complex');
      switch (n.k) {
        case 'num': case 'str': return n.v;
        case 'id': return look(n.name);
        case 'arr': return n.items.map(i => { const v = evv(i); if (isArr(v)) throw new TypeError('Nested arrays are not supported'); if (!(typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string')) throw new TypeError('Arrays can only hold numbers'); return v; });
        case 'un': { const v = evv(n.e); if (n.op === '!') return !truthy(v); if (n.op === '-') return isArr(v) ? v.map(x => -x) : -num(v); return isArr(v) ? v : +num(v); }
        case 'bin': {
          if (n.op === '&&') { const a = evv(n.l); return truthy(a) ? evv(n.r) : a; }
          if (n.op === '||') { const a = evv(n.l); return truthy(a) ? a : evv(n.r); }
          return binop(n.op, evv(n.l), evv(n.r));
        }
        case 'cond': return truthy(evv(n.test)) ? ev(n.a) : ev(n.b);
        case 'mem': {
          let o = ev(n.o);
          if (o instanceof NS || (o instanceof Fn && o.m)) { if (!o.m.has(n.name)) throw new ReferenceError(`${n.name} is not available`); const v = o.m.get(n.name); return v instanceof Lazy ? v.f() : v; }
          if (o instanceof Prop) {
            if (n.name === 'value') return o.get();
            if (n.name === 'valueAtTime') return new Fn(t => o.at(num(t)));
            const vel = t => { const h = 1 / (ctx.fps * 4); return binop('/', binop('-', o.at(t + h), o.at(t - h)), 2 * h); };
            if (n.name === 'velocity') return vel(ctx.time);
            if (n.name === 'speed') { const d = vel(ctx.time); return isArr(d) ? Math.hypot(...d) : Math.abs(num(d)); }
            if (n.name === 'velocityAtTime') return new Fn(t => vel(num(t)));
            o = o.get();
          }
          if ((isArr(o) || typeof o === 'string') && n.name === 'length') return o.length;
          if (isArr(o) && (n.name === 'x' || n.name === 'y')) return o[n.name === 'x' ? 0 : 1];
          throw new ReferenceError(`.${n.name} is not available`);
        }
        case 'idx': { const o = evv(n.o), i = num(evv(n.i)); if (isArr(o) || typeof o === 'string') { const v = o[Math.floor(i)]; if (v === undefined) throw new RangeError('Index out of range'); return v; } throw new TypeError('Only arrays can be indexed'); }
        case 'call': {
          const f = ev(n.f);
          if (!(f instanceof Fn)) throw new TypeError('Not a function');
          const r = f.f(...n.args.map(evv));
          if (typeof r === 'number' || typeof r === 'boolean' || typeof r === 'string' || isArr(r) || r instanceof NS || r instanceof Fn || r instanceof Prop) return r;
          if (r === undefined) return 0;
          throw new TypeError('Invalid result');
        }
      }
      throw new SyntaxError('Bad expression');
    }
    function exec(s) {
      switch (s.k) {
        case 'var': s.decls.forEach(d => { if (Object.prototype.hasOwnProperty.call(builtins, d.name) && d.name !== 'value' && !SOFT.has(d.name)) throw new SyntaxError(`Cannot redefine ${d.name}`); locals.set(d.name, d.init ? ev(d.init) : 0); }); last = undefined; return;
        case 'assign': {
          let v = ev(s.value);
          if (s.op !== '=') v = binop(s.op[0], V(look(s.name)), V(v));
          if (!locals.has(s.name)) { if (s.name === 'value' || SOFT.has(s.name) || !Object.prototype.hasOwnProperty.call(builtins, s.name)) { locals.set(s.name, v); last = v; return; } throw new SyntaxError(`Cannot assign to ${s.name}`); }
          locals.set(s.name, v); last = v; return;
        }
        case 'if': { if (truthy(evv(s.test))) exec(s.cons); else if (s.alt) exec(s.alt); return; }
        case 'block': s.body.forEach(exec); return;
        case 'expr': last = ev(s.e); return;
      }
    }
    ast.body.forEach(exec);
    return V(last);
  }

  const cache = new Map();
  function compile(src) {
    let c = cache.get(src);
    if (!c) { try { c = { ast: parse(src) }; } catch (e) { c = { err: e.message }; } if (cache.size > 500) cache.clear(); cache.set(src, c); }
    return c;
  }
  // Evaluate expression source. Returns {v} or {err}. `ctx.value` is the pre-expression value.
  function evaluate(src, ctx) {
    const c = compile(src); if (c.err) return { err: c.err };
    try {
      let r;
      try { r = run(c.ast, ctx); }
      catch (e) {
        if (!(e instanceof Restart)) throw e;
        const c2 = { ...ctx, time: e.t, posterized: true, value: ctx.valueAtTime(e.t, true) };
        r = run(c2.ast || c.ast, c2);
      }
      return { v: r };
    } catch (e) { return { err: e.message || String(e) }; }
  }
  // coerce an expression result to the shape of the property value
  function coerce(r, like) {
    if (isArr(like)) {
      if (isArr(r)) { const o = like.slice(); for (let i = 0; i < o.length; i++) if (typeof r[i] === 'number' && isFinite(r[i])) o[i] = r[i]; return o; }
      if (typeof r === 'number' && isFinite(r)) return like.map(() => r);
      return null;
    }
    if (typeof like === 'number') { const n = isArr(r) ? r[0] : typeof r === 'boolean' ? +r : r; return typeof n === 'number' && isFinite(n) ? n : null; }
    return null;
  }

  LM.expr = { parse, evaluate, coerce, compile, hashStr, vnoise, hash };
})();
