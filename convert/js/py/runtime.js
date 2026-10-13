/* Lumen Convert — Python semantics runtime for transpiled code ("py").
   Gives JavaScript the Python behaviours that differ from JS: int vs float (floats are PyFloat wrappers),
   arbitrary-size ints (BigInt when needed), floor division / modulo with negative numbers, truthiness of empty
   containers, == on lists/dicts, negative indexes, slicing, str/list/dict/set methods, print/format/repr,
   exceptions, and the math / random (Mersenne Twister, same sequence as CPython) / time / json modules.
   MIT licence, part of Lumen Studio. */
var py = (function () {
  'use strict';
  /* ---------- numbers ---------- */
  class PyFloat { constructor(v) { this.v = +v; } valueOf() { return this.v; } toString() { return floatRepr(this.v); } }
  const f = v => new PyFloat(v);
  const isF = x => x instanceof PyFloat || (typeof x === 'number' && !Number.isInteger(x));
  const isInt = x => (typeof x === 'number' && Number.isInteger(x)) || typeof x === 'bigint' || typeof x === 'boolean';
  const isNum = x => typeof x === 'number' || typeof x === 'bigint' || typeof x === 'boolean' || x instanceof PyFloat;
  const num = x => x instanceof PyFloat ? x.v : typeof x === 'boolean' ? +x : x;
  const fl = x => x instanceof PyFloat ? x.v : Number(typeof x === 'boolean' ? +x : x);
  const big = x => typeof x === 'bigint' ? x : BigInt(typeof x === 'boolean' ? +x : x);
  const normInt = b => (b >= -9007199254740991n && b <= 9007199254740991n) ? Number(b) : b;
  function intOp(a, b, opN, opB) {
    a = num(a); b = num(b);
    if (typeof a === 'number' && typeof b === 'number') { const r = opN(a, b); if (Number.isSafeInteger(r)) return r; }
    return normInt(opB(big(a), big(b)));
  }
  function floatRepr(v) {
    if (v !== v) return 'nan'; if (v === Infinity) return 'inf'; if (v === -Infinity) return '-inf';
    if (v === 0) return Object.is(v, -0) ? '-0.0' : '0.0';
    let [m, e] = v.toExponential().split('e'); e = +e;
    if (e >= -4 && e < 16) { let s = String(v); if (/e/.test(s)) s = Number(v).toFixed(Math.max(0, (m.replace(/^-?\d\.?/, '').length) - e)); if (!/[.e]/.test(s)) s += '.0'; return s; }
    return m + 'e' + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(2, '0');
  }
  /* ---------- exceptions ---------- */
  class BaseException extends Error {
    constructor(...a) { super(); this.args = Tuple.from(a); this.__init__(...a); }
    __init__(...a) { this.args = Tuple.from(a); }
    get message() { return this.__str__(); }
    __str__() { return this.args.length === 0 ? '' : this.args.length === 1 ? str(this.args[0]) : repr(this.args); }
    get name() { return this.constructor.name; }
  }
  const mk = (name, base) => { const C = { [name]: class extends base { } }[name]; return C; };
  const Exception = mk('Exception', BaseException), ArithmeticError = mk('ArithmeticError', Exception), LookupError = mk('LookupError', Exception);
  const E = { BaseException, Exception, ArithmeticError, LookupError };
  for (const [n, b] of [['ZeroDivisionError', ArithmeticError], ['OverflowError', ArithmeticError], ['ValueError', Exception], ['TypeError', Exception], ['IndexError', LookupError], ['AttributeError', Exception], ['NameError', Exception], ['RuntimeError', Exception], ['StopIteration', Exception], ['AssertionError', Exception], ['EOFError', Exception], ['NotImplementedError', null], ['RecursionError', null], ['UnboundLocalError', null], ['OSError', Exception], ['ImportError', Exception], ['SystemExit', BaseException], ['KeyboardInterrupt', BaseException], ['UnicodeError', null]])
    E[n] = mk(n, b || (n === 'NotImplementedError' || n === 'RecursionError' ? E.RuntimeError : n === 'UnboundLocalError' ? E.NameError : E.ValueError));
  E.KeyError = class KeyError extends LookupError { __str__() { return this.args.length === 1 ? repr(this.args[0]) : super.__str__(); } };
  E.ModuleNotFoundError = mk('ModuleNotFoundError', E.ImportError); E.FileNotFoundError = mk('FileNotFoundError', E.OSError);
  function exc(e) { // any thrown value → Python exception object
    if (e instanceof BaseException) return e;
    if (e instanceof RangeError && /call stack/i.test(e.message)) return new E.RecursionError('maximum recursion depth exceeded');
    if (e instanceof ReferenceError) return new E.NameError(String(e.message).replace(/ is not defined$/, '').replace(/^(\w+)$/, "name '$1' is not defined").replace(/^Cannot access '(\w+)' before initialization$/, "cannot access local variable '$1' where it is not associated with a value"));
    if (e instanceof TypeError) return new E.TypeError(e.message);
    return new E.RuntimeError(String(e && e.message || e));
  }
  function mkexc(x) { if (typeof x === 'function') return new x(); if (x instanceof BaseException) return x; return new E.TypeError('exceptions must derive from BaseException'); }
  /* ---------- containers ---------- */
  class Tuple extends Array { static get [Symbol.species]() { return Array; } count(x) { return this.filter(y => eq(x, y)).length; } index(x) { const i = this.findIndex(y => eq(x, y)); if (i < 0) throw new E.ValueError('tuple.index(x): x not in tuple'); return i; } }
  const tuple = it => it === undefined ? Tuple.from([]) : Tuple.from(iter(it));
  const T = (...a) => Tuple.from(a);
  let oid = 0; const ids = new WeakMap(); const idOf = o => { let i = ids.get(o); if (!i) { i = ++oid; ids.set(o, i); } return i; };
  function hkey(k) {
    if (typeof k === 'string') return 's' + k;
    if (k === null || k === undefined) return 'N';
    if (isNum(k)) { const v = num(k); return 'n' + (typeof v === 'bigint' ? v.toString() : Object.is(v, -0) ? '0' : String(v)); }
    if (k instanceof Tuple) return 't(' + k.map(hkey).join(',') + ')';
    if (k instanceof FrozenSet) return 'f{' + [...k.m.keys()].sort().join(',') + '}';
    if (Array.isArray(k)) throw new E.TypeError("unhashable type: 'list'");
    if (k instanceof Dict) throw new E.TypeError("unhashable type: 'dict'");
    if (k instanceof PySet) throw new E.TypeError("unhashable type: 'set'");
    if (k && typeof k.__hash__ === 'function') return 'h' + hkey(k.__hash__());
    if (k && typeof k === 'object' || typeof k === 'function') return 'o' + idOf(k);
    return 'x' + String(k);
  }
  class Dict {
    constructor(src) { this.m = new Map(); if (src) this.update(src); }
    get size() { return this.m.size; }
    [Symbol.iterator]() { const it = this.m.values(); return { [Symbol.iterator]() { return this; }, next: () => { const r = it.next(); return r.done ? r : { value: r.value[0], done: false }; } }; }
    __getitem__(k) { const e = this.m.get(hkey(k)); if (!e) { if (this.__missing__) return this.__missing__(k); throw new E.KeyError(k); } return e[1]; }
    __setitem__(k, v) { const h = hkey(k), e = this.m.get(h); if (e) e[1] = v; else this.m.set(h, [k, v]); }
    __delitem__(k) { if (!this.m.delete(hkey(k))) throw new E.KeyError(k); }
    __contains__(k) { return this.m.has(hkey(k)); }
    get(k, d = null) { const e = this.m.get(hkey(k)); return e ? e[1] : d; }
    keys() { return [...this.m.values()].map(e => e[0]); }
    values() { return [...this.m.values()].map(e => e[1]); }
    items() { return [...this.m.values()].map(e => T(e[0], e[1])); }
    pop(k, ...d) { const h = hkey(k), e = this.m.get(h); if (!e) { if (d.length) return d[0]; throw new E.KeyError(k); } this.m.delete(h); return e[1]; }
    popitem() { if (!this.m.size) throw new E.KeyError('popitem(): dictionary is empty'); const k = [...this.m.keys()].pop(), e = this.m.get(k); this.m.delete(k); return T(e[0], e[1]); }
    setdefault(k, d = null) { const e = this.m.get(hkey(k)); if (e) return e[1]; this.__setitem__(k, d); return d; }
    update(src, kw) {
      if (src instanceof KW) { kw = src; src = null; }
      if (src instanceof Dict) for (const e of src.m.values()) this.__setitem__(e[0], e[1]);
      else if (src) for (const p of iter(src)) { const a = [...iter(p)]; if (a.length !== 2) throw new E.ValueError('dictionary update sequence element has length ' + a.length + '; 2 is required'); this.__setitem__(a[0], a[1]); }
      if (kw) for (const k in kw.o) this.__setitem__(k, kw.o[k]);
      return null;
    }
    copy() { return new Dict(this); }
    clear() { this.m.clear(); return null; }
    static fromkeys(it, v = null) { const d = new Dict(); for (const k of iter(it)) d.__setitem__(k, v); return d; }
  }
  class PySet {
    constructor(it) { this.m = new Map(); if (it !== undefined && it !== null) for (const x of iter(it)) this.m.set(hkey(x), x); }
    get size() { return this.m.size; }
    [Symbol.iterator]() { return this.m.values(); }
    __contains__(x) { return this.m.has(hkey(x)); }
    _new(it) { const s = new this.constructor(); for (const x of it) s.m.set(hkey(x), x); return s; }
    add(x) { this.m.set(hkey(x), x); return null; }
    remove(x) { if (!this.m.delete(hkey(x))) throw new E.KeyError(x); return null; }
    discard(x) { this.m.delete(hkey(x)); return null; }
    pop() { if (!this.m.size) throw new E.KeyError('pop from an empty set'); const [k, v] = this.m.entries().next().value; this.m.delete(k); return v; }
    clear() { this.m.clear(); return null; }
    copy() { return this._new(this); }
    union(...o) { const s = this.copy(); for (const it of o) for (const x of iter(it)) s.m.set(hkey(x), x); return s; }
    update(...o) { for (const it of o) for (const x of iter(it)) this.m.set(hkey(x), x); return null; }
    intersection(...o) { let s = this.copy(); for (const it of o) { const b = it instanceof PySet ? it : new PySet(it); s = s._new([...s].filter(x => b.__contains__(x))); } return s; }
    difference(...o) { let s = this.copy(); for (const it of o) { const b = it instanceof PySet ? it : new PySet(it); s = s._new([...s].filter(x => !b.__contains__(x))); } return s; }
    symmetric_difference(o) { const b = o instanceof PySet ? o : new PySet(o); return this._new([...[...this].filter(x => !b.__contains__(x)), ...[...b].filter(x => !this.__contains__(x))]); }
    intersection_update(...o) { const r = this.intersection(...o); this.m = r.m; return null; }
    difference_update(...o) { const r = this.difference(...o); this.m = r.m; return null; }
    issubset(o) { const b = o instanceof PySet ? o : new PySet(o); return [...this].every(x => b.__contains__(x)); }
    issuperset(o) { return [...iter(o)].every(x => this.__contains__(x)); }
    isdisjoint(o) { return [...iter(o)].every(x => !this.__contains__(x)); }
  }
  class FrozenSet extends PySet { }
  class Range {
    constructor(a, b, c) { if (b === undefined) { b = a; a = 0; } c = c === undefined ? 1 : c; [a, b, c] = [a, b, c].map(x => { if (!isInt(x)) throw new E.TypeError(`'${typeName(x)}' object cannot be interpreted as an integer`); return Number(num(x)); }); if (c === 0) throw new E.ValueError('range() arg 3 must not be zero'); this.start = a; this.stop = b; this.step = c; this.length = Math.max(0, Math.ceil((b - a) / c)); }
    *[Symbol.iterator]() { for (let i = 0, v = this.start; i < this.length; i++, v += this.step) yield v; }
    __getitem__(i) { i = num(i); if (i < 0) i += this.length; if (i < 0 || i >= this.length) throw new E.IndexError('range object index out of range'); return this.start + i * this.step; }
    __contains__(x) { if (!isNum(x)) return false; x = fl(x); if (!Number.isInteger(x)) return false; const k = (x - this.start) / this.step; return Number.isInteger(k) && k >= 0 && k < this.length; }
    __len__() { return this.length; }
    index(x) { if (!this.__contains__(x)) throw new E.ValueError(`${repr(x)} is not in range`); return (fl(x) - this.start) / this.step; }
    count(x) { return this.__contains__(x) ? 1 : 0; }
  }
  class KW { constructor(o) { this.o = o; } }
  const kw = o => new KW(o);
  const varargs = a => { const k = popKW(a); return [Tuple.from(a), k]; };
  const popKW = a => (a.length && a[a.length - 1] instanceof KW) ? a.pop().o : {};
  /* ---------- object base for user classes ---------- */
  class object { constructor(...a) { this.__init__(...a); } __init__() { } }
  function classattr(C, name, value) {
    C[name] = value;
    Object.defineProperty(C.prototype, name, { configurable: true, get() { return C[name]; }, set(v) { Object.defineProperty(this, name, { value: v, writable: true, enumerable: true, configurable: true }); } });
  }
  function aliasStatic(C, name) { Object.defineProperty(C.prototype, name, { configurable: true, get() { return C[name].bind(this.constructor); } }); }
  /* ---------- type names & isinstance ---------- */
  function typeName(x) {
    if (x === null || x === undefined) return 'NoneType';
    if (typeof x === 'boolean') return 'bool';
    if (x instanceof PyFloat || (typeof x === 'number' && !Number.isInteger(x))) return 'float';
    if (typeof x === 'number' || typeof x === 'bigint') return 'int';
    if (typeof x === 'string') return 'str';
    if (x instanceof Tuple) return 'tuple'; if (Array.isArray(x)) return 'list';
    if (x instanceof Dict) return x.constructor === Dict ? 'dict' : x.constructor.name;
    if (x instanceof FrozenSet) return 'frozenset'; if (x instanceof PySet) return 'set';
    if (x instanceof Range) return 'range';
    if (typeof x === 'function') return x.prototype && x.prototype instanceof object ? 'type' : 'function';
    if (x && typeof x.next === 'function') return 'generator';
    return x && x.constructor ? x.constructor.name : 'object';
  }
  /* ---------- truthiness ---------- */
  function bool(x) {
    if (x === null || x === undefined || x === false) return false;
    if (x === true) return true;
    if (typeof x === 'number') return x !== 0;
    if (typeof x === 'bigint') return x !== 0n;
    if (x instanceof PyFloat) return x.v !== 0;
    if (typeof x === 'string' || Array.isArray(x)) return x.length > 0;
    if (x instanceof Dict || x instanceof PySet) return x.size > 0;
    if (x instanceof Range) return x.length > 0;
    if (typeof x.__bool__ === 'function') return !!bool(x.__bool__());
    if (typeof x.__len__ === 'function') return num(x.__len__()) > 0;
    return true;
  }
  const or = (a, b) => bool(a) ? a : b();
  const and = (a, b) => bool(a) ? b() : a;
  /* ---------- repr / str ---------- */
  function strRepr(s) {
    const q = s.includes("'") && !s.includes('"') ? '"' : "'";
    let o = q;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (ch === '\\') o += '\\\\'; else if (ch === q) o += '\\' + q; else if (ch === '\n') o += '\\n'; else if (ch === '\r') o += '\\r'; else if (ch === '\t') o += '\\t';
      else if (c < 32 || c === 127) o += '\\x' + c.toString(16).padStart(2, '0'); else o += ch;
    }
    return o + q;
  }
  function repr(x, seen) {
    if (x === null || x === undefined) return 'None';
    if (x === true) return 'True'; if (x === false) return 'False';
    if (typeof x === 'number') return Number.isInteger(x) ? (Object.is(x, -0) ? '0' : String(x)) : floatRepr(x);
    if (x instanceof PyFloat) return floatRepr(x.v);
    if (typeof x === 'bigint') return x.toString();
    if (typeof x === 'string') return strRepr(x);
    seen = seen || new Set();
    if (typeof x === 'object' && seen.has(x)) return Array.isArray(x) ? '[...]' : '{...}';
    if (x && typeof x.__repr__ === 'function') return str(x.__repr__());
    if (Array.isArray(x)) { seen.add(x); const r = x.map(y => repr(y, seen)); seen.delete(x); return x instanceof Tuple ? '(' + r.join(', ') + (x.length === 1 ? ',' : '') + ')' : '[' + r.join(', ') + ']'; }
    if (x instanceof Dict) { seen.add(x); const r = [...x.m.values()].map(e => repr(e[0], seen) + ': ' + repr(e[1], seen)); seen.delete(x); return '{' + r.join(', ') + '}'; }
    if (x instanceof PySet) { const nm = x instanceof FrozenSet ? 'frozenset' : 'set'; if (!x.size) return nm + '()'; const r = '{' + [...x].map(y => repr(y)).join(', ') + '}'; return x instanceof FrozenSet ? `frozenset(${r})` : r; }
    if (x instanceof Range) return `range(${x.start}, ${x.stop}${x.step !== 1 ? ', ' + x.step : ''})`;
    if (x instanceof BaseException) return `${x.constructor.name}(${x.args.map(a => repr(a)).join(', ')})`;
    if (typeof x === 'function') { if (x.__pytype__) return `<class '${x.__pytype__}'>`; if (x.prototype && (x.prototype instanceof object || x.prototype instanceof BaseException || x === object)) return `<class '__main__.${x.name}'>`; return `<function ${x.name || '<lambda>'}>`; }
    if (x && x.__module_name__) return `<module '${x.__module_name__}'>`;
    if (x && typeof x.next === 'function') return '<generator object>';
    return `<__main__.${x.constructor ? x.constructor.name : 'object'} object at 0x${(idOf(x) * 4096 + 0x7f0000000000).toString(16)}>`;
  }
  function str(x) {
    if (typeof x === 'string') return x;
    if (x instanceof BaseException && typeof x.__str__ === 'function') return str(x.__str__());
    if (x && typeof x === 'object' && !(x instanceof PyFloat) && typeof x.__str__ === 'function') return str(x.__str__());
    return repr(x);
  }
  /* ---------- formatting ---------- */
  function group(s, sep) { const neg = s[0] === '-'; if (neg) s = s.slice(1); const [i, d] = s.split('.'); const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, sep); return (neg ? '-' : '') + g + (d !== undefined ? '.' + d : ''); }
  // exact decimal rounding of a double (round-half-even on its true binary value, like CPython)
  function exactScaled(a, k) { // round(a * 10^k) as BigInt, a >= 0 finite
    const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, a);
    const hi = dv.getUint32(0), lo = dv.getUint32(4); let ex = (hi >>> 20) & 0x7ff; let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
    if (ex === 0) ex = 1; else mant |= 1n << 52n;
    const e2 = ex - 1075; let n = mant, d = 1n;
    if (k >= 0) n *= 10n ** BigInt(k); else d *= 10n ** BigInt(-k);
    if (e2 >= 0) n <<= BigInt(e2); else d <<= BigInt(-e2);
    let q = n / d; const r2 = (n % d) * 2n;
    if (r2 > d || (r2 === d && (q & 1n))) q += 1n;
    return q;
  }
  function toFixedEven(v, p) {
    const neg = v < 0 || Object.is(v, -0), a = Math.abs(v);
    let s = exactScaled(a, p).toString();
    if (p > 0) { s = s.padStart(p + 1, '0'); s = s.slice(0, -p) + '.' + s.slice(-p); }
    return (neg ? '-' : '') + s;
  }
  function expFmt(v, p, upper) {
    const neg = v < 0, a = Math.abs(v); let E = 0, q;
    if (a === 0) q = 0n; else { E = Math.floor(Math.log10(a)); q = exactScaled(a, p - E); if (q >= 10n ** BigInt(p + 1)) { E++; q = exactScaled(a, p - E); } else if (q < 10n ** BigInt(p)) { E--; q = exactScaled(a, p - E); } }
    let d = q.toString().padStart(p + 1, '0'); d = p > 0 ? d[0] + '.' + d.slice(1) : d;
    const s = (neg ? '-' : '') + d + 'e' + (E < 0 ? '-' : '+') + String(Math.abs(E)).padStart(2, '0');
    return upper ? s.toUpperCase() : s;
  }
  function gFmt(v, p, alt, upper) {
    if (p === 0) p = 1;
    if (v === 0) return alt ? '0.' + '0'.repeat(p - 1) : (Object.is(v, -0) ? '-0' : '0');
    const e = Number(expFmt(Math.abs(v), p - 1, false).split('e')[1]);
    let s;
    if (e >= -4 && e < p) { s = toFixedEven(v, p - 1 - e); if (!alt && s.includes('.')) s = s.replace(/\.?0+$/, ''); }
    else { s = expFmt(v, p - 1, false); if (!alt) s = s.replace(/\.?0+e/, 'e'); }
    return upper ? s.toUpperCase() : s;
  }
  function format(x, spec) {
    spec = spec || '';
    if (x && typeof x === 'object' && typeof x.__format__ === 'function' && !(x instanceof PyFloat)) return str(x.__format__(spec));
    const m = spec.match(/^(?:(.)?([<>=^]))?([+\- ])?(z)?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/s);
    if (!m) throw new E.ValueError('Invalid format specifier');
    let [, fill, align, sign, , alt, zero, width, grouping, prec, type] = m;
    if (zero && !align) { fill = '0'; align = '='; }
    fill = fill || ' '; width = width ? +width : 0; prec = prec !== undefined ? +prec : undefined;
    let body, neg = false, prefix = '';
    const numeric = isNum(x) && typeof x !== 'boolean' || (typeof x === 'boolean' && type && type !== 's');
    if (!numeric) {
      if (type && type !== 's') throw new E.ValueError(`Unknown format code '${type}' for object of type '${typeName(x)}'`);
      body = str(x); if (prec !== undefined) body = [...body].slice(0, prec).join('');
      align = align || '<';
    } else {
      align = align || '>';
      const isFloatVal = isF(x);
      if (!type) type = isFloatVal ? (prec !== undefined ? 'G_' : 'r') : 'd';
      if ('bcdoxXn'.includes(type) && isFloatVal) throw new E.ValueError(`Unknown format code '${type}' for object of type 'float'`);
      let v = num(x);
      if ('bcdoxXn'.includes(type)) {
        const b = big(v); neg = b < 0n; const a = neg ? -b : b;
        if (type === 'c') body = String.fromCodePoint(Number(a));
        else { body = a.toString({ b: 2, o: 8, x: 16, X: 16, d: 10, n: 10 }[type]); if (type === 'X') body = body.toUpperCase(); if (alt && 'boxX'.includes(type)) prefix = '0' + type; }
      } else {
        v = fl(v); neg = v < 0 || Object.is(v, -0); const a = Math.abs(v);
        if (!isFinite(a)) body = a !== a ? 'nan' : 'inf';
        else if (type === 'f' || type === 'F') body = toFixedEven(a, prec === undefined ? 6 : prec);
        else if (type === 'e' || type === 'E') body = expFmt(a, prec === undefined ? 6 : prec, type === 'E');
        else if (type === 'g' || type === 'G') body = gFmt(a, prec === undefined ? 6 : prec, alt, type === 'G');
        else if (type === '%') body = toFixedEven(a * 100, prec === undefined ? 6 : prec) + '%';
        else if (type === 'G_') { body = gFmt(a, prec, alt, false); if (!/[.e]/.test(body) && /^\d/.test(body)) body += (Number(body) === a ? '.0' : ''); }
        else body = floatRepr(a);
        if ((type === 'F' || type === 'E' || type === 'G') && !isFinite(a)) body = body.toUpperCase();
      }
      if (grouping) body = group(body.replace(/%$/, ''), grouping) + (body.endsWith('%') ? '%' : '');
    }
    let sg = numeric ? (neg ? '-' : sign === '+' ? '+' : sign === ' ' ? ' ' : '') : '';
    let out = sg + prefix + body;
    const len = [...out].length;
    if (width > len) {
      const pad = width - len;
      if (align === '<') out = out + fill.repeat(pad);
      else if (align === '>') out = fill.repeat(pad) + out;
      else if (align === '^') out = fill.repeat(Math.floor(pad / 2)) + out + fill.repeat(pad - Math.floor(pad / 2));
      else if (align === '=') { let b2 = body; if (fill === '0' && grouping) { const target = width - sg.length - prefix.length; let digits = body.replace(/[^\d.]/g, ''); while (group(digits, grouping).length < target) digits = '0' + digits; b2 = group(digits, grouping); if (b2.length > target && b2[0] === grouping) b2 = b2.slice(1); out = sg + prefix + b2; } else out = sg + prefix + fill.repeat(pad) + body; }
    }
    return out;
  }
  function fmt(x, conv, spec) { if (conv === 'r') x = repr(x); else if (conv === 's') x = str(x); else if (conv === 'a') x = repr(x); return spec ? format(x, spec) : str(x); }
  function percentFormat(s, args) {
    let i = 0; const list = args instanceof Tuple ? args : [args], isMap = args instanceof Dict;
    const out = s.replace(/%(\([^)]*\))?([-+ #0]*)(\*|\d+)?(?:\.(\*|\d+))?([diouxXeEfFgGcrsa%])/g, (all, key, flags, width, prec, type) => {
      if (type === '%') return '%';
      let v;
      if (key) v = args.__getitem__(key.slice(1, -1)); else { if (i >= list.length) throw new E.TypeError('not enough arguments for format string'); v = list[i++]; }
      let spec = '';
      if (flags.includes('-')) spec += '<'; else if (flags.includes('0') && type !== 's' && type !== 'r') spec += '0'.length ? '' : '';
      if (flags.includes('+')) spec += '+'; else if (flags.includes(' ')) spec += ' ';
      if (flags.includes('0') && !flags.includes('-') && 'diouxXeEfFgG'.includes(type)) spec += '0';
      if (width) spec += width; if (prec !== undefined) spec += '.' + prec;
      const t = type === 'i' || type === 'u' ? 'd' : type;
      if (t === 's') return format(str(v), spec);
      if (t === 'r' || t === 'a') return format(repr(v), spec);
      if ('dxXo'.includes(t)) { if (!isNum(v)) throw new E.TypeError(`%${type} format: a real number is required, not ${typeName(v)}`); v = isF(v) ? Math.trunc(fl(v)) : v; }
      if ('eEfFgG'.includes(t) && !isNum(v)) throw new E.TypeError('must be real number, not ' + typeName(v));
      return format('eEfFgG'.includes(t) ? f(fl(v)) : v, spec + t);
    });
    if (!isMap && i < list.length && args instanceof Tuple) throw new E.TypeError('not all arguments converted during string formatting');
    return out;
  }
  function strFormat(s, args, kwargs) {
    let auto = 0;
    const field = (name) => {
      const m = name.match(/^([^.[]*)(.*)$/); let v = m[1] === '' ? args[auto++] : /^\d+$/.test(m[1]) ? args[+m[1]] : kwargs[m[1]];
      if (v === undefined && m[1] !== '' && !/^\d+$/.test(m[1])) throw new E.KeyError(m[1]);
      for (const part of m[2].match(/\.\w+|\[[^\]]*\]/g) || []) v = part[0] === '.' ? v[part.slice(1)] : getitem(v, /^\d+$/.test(part.slice(1, -1)) ? +part.slice(1, -1) : part.slice(1, -1));
      return v;
    };
    let out = '', i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === '{' && s[i + 1] === '{') { out += '{'; i += 2; continue; }
      if (c === '}' && s[i + 1] === '}') { out += '}'; i += 2; continue; }
      if (c === '{') {
        let depth = 1, j = i + 1; while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
        const inner = s.slice(i + 1, j - 1), m = inner.match(/^([^!:]*)(?:!([rsa]))?(?::(.*))?$/s);
        const v = field(m[1]); const spec = (m[3] || '').replace(/\{([^}]*)\}/g, (a, n) => str(field(n)));
        out += fmt(v, m[2], spec); i = j; continue;
      }
      out += c; i++;
    }
    return out;
  }
  /* ---------- arithmetic ---------- */
  const tn = typeName;
  function opErr(op, a, b) { return new E.TypeError(`unsupported operand type(s) for ${op}: '${tn(a)}' and '${tn(b)}'`); }
  function dunder(a, b, name, rname) { if (a && typeof a === 'object' && typeof a[name] === 'function' && !(a instanceof PyFloat)) { const r = a[name](b); if (r !== NotImplemented) return [r]; } if (b && typeof b === 'object' && typeof b[rname] === 'function' && !(b instanceof PyFloat)) { const r = b[rname](a); if (r !== NotImplemented) return [r]; } return null; }
  const NotImplemented = { __repr__() { return 'NotImplemented'; } };
  function add(a, b) {
    if (typeof a === 'string' && typeof b === 'string') return a + b;
    if (isNum(a) && isNum(b)) return isF(a) || isF(b) ? f(fl(a) + fl(b)) : intOp(a, b, (x, y) => x + y, (x, y) => x + y);
    if (Array.isArray(a) && Array.isArray(b) && (a instanceof Tuple) === (b instanceof Tuple)) return a instanceof Tuple ? Tuple.from([...a, ...b]) : a.concat(b);
    const d = dunder(a, b, '__add__', '__radd__'); if (d) return d[0];
    if (typeof a === 'string') throw new E.TypeError(`can only concatenate str (not "${tn(b)}") to str`);
    if (Array.isArray(a) && !(a instanceof Tuple)) throw new E.TypeError(`can only concatenate list (not "${tn(b)}") to list`);
    throw opErr('+', a, b);
  }
  function sub(a, b) {
    if (isNum(a) && isNum(b)) return isF(a) || isF(b) ? f(fl(a) - fl(b)) : intOp(a, b, (x, y) => x - y, (x, y) => x - y);
    if (a instanceof PySet && b instanceof PySet) return a.difference(b);
    const d = dunder(a, b, '__sub__', '__rsub__'); if (d) return d[0]; throw opErr('-', a, b);
  }
  function repeat(seq, n) { n = Number(num(n)); if (typeof seq === 'string') return n > 0 ? seq.repeat(n) : ''; const out = []; for (let i = 0; i < n; i++) out.push(...seq); return seq instanceof Tuple ? Tuple.from(out) : out; }
  function mul(a, b) {
    if (isNum(a) && isNum(b)) return isF(a) || isF(b) ? f(fl(a) * fl(b)) : intOp(a, b, (x, y) => x * y, (x, y) => x * y);
    if ((typeof a === 'string' || Array.isArray(a)) && isInt(b)) return repeat(a, b);
    if ((typeof b === 'string' || Array.isArray(b)) && isInt(a)) return repeat(b, a);
    const d = dunder(a, b, '__mul__', '__rmul__'); if (d) return d[0]; throw opErr('*', a, b);
  }
  function div(a, b) {
    if (isNum(a) && isNum(b)) { const y = fl(b); if (y === 0) throw new E.ZeroDivisionError('division by zero'); if (typeof num(a) === 'bigint' || typeof num(b) === 'bigint') return f(Number(num(a)) / Number(num(b))); return f(fl(a) / y); }
    const d = dunder(a, b, '__truediv__', '__rtruediv__'); if (d) return d[0]; throw opErr('/', a, b);
  }
  function floordiv(a, b) {
    if (isNum(a) && isNum(b)) {
      if (isF(a) || isF(b)) { const y = fl(b); if (y === 0) throw new E.ZeroDivisionError('float floor division by zero'); return f(Math.floor(fl(a) / y)); }
      if (Number(num(b)) === 0) throw new E.ZeroDivisionError('integer division or modulo by zero');
      return intOp(a, b, (x, y) => Math.floor(x / y), (x, y) => { const q = x / y; return (x % y !== 0n && ((x < 0n) !== (y < 0n))) ? q - 1n : q; });
    }
    const d = dunder(a, b, '__floordiv__', '__rfloordiv__'); if (d) return d[0]; throw opErr('//', a, b);
  }
  function mod(a, b) {
    if (typeof a === 'string') return percentFormat(a, b);
    if (isNum(a) && isNum(b)) {
      if (isF(a) || isF(b)) { const x = fl(a), y = fl(b); if (y === 0) throw new E.ZeroDivisionError('float modulo'); let r = x % y; if (r !== 0 && (r < 0) !== (y < 0)) r += y; return f(r === 0 ? (y < 0 ? -0 : 0) : r); }
      if (Number(num(b)) === 0) throw new E.ZeroDivisionError('integer division or modulo by zero');
      return intOp(a, b, (x, y) => { const r = x % y; return r !== 0 && (r < 0) !== (y < 0) ? r + y : r; }, (x, y) => { const r = x % y; return r !== 0n && (r < 0n) !== (y < 0n) ? r + y : r; });
    }
    const d = dunder(a, b, '__mod__', '__rmod__'); if (d) return d[0]; throw opErr('%', a, b);
  }
  function pow(a, b, m) {
    if (m !== undefined && m !== null) { let r = 1n, x = big(a) % big(m), e = big(b); const M = big(m); if (x < 0n) x += M; while (e > 0n) { if (e & 1n) r = r * x % M; x = x * x % M; e >>= 1n; } return normInt(r); }
    if (isNum(a) && isNum(b)) {
      if (isF(a) || isF(b) || num(b) < 0) { const x = fl(a), y = fl(b); if (x === 0 && y < 0) throw new E.ZeroDivisionError('0.0 cannot be raised to a negative power'); return f(Math.pow(x, y)); }
      const r = Math.pow(Number(num(a)), Number(num(b))); if (Number.isSafeInteger(r)) return r; return normInt(big(a) ** big(b));
    }
    const d = dunder(a, b, '__pow__', '__rpow__'); if (d) return d[0]; throw opErr('** or pow()', a, b);
  }
  function neg(a) { if (isNum(a)) { if (isF(a)) return f(-fl(a)); const v = num(a); return typeof v === 'bigint' ? normInt(-v) : (v === 0 ? 0 : -v); } if (a && a.__neg__) return a.__neg__(); throw new E.TypeError(`bad operand type for unary -: '${tn(a)}'`); }
  function pos(a) { if (isNum(a)) return typeof a === 'boolean' ? +a : a; if (a && a.__pos__) return a.__pos__(); throw new E.TypeError(`bad operand type for unary +: '${tn(a)}'`); }
  function invert(a) { if (isInt(a)) return intOp(a, 0, x => ~x, x => ~x); throw new E.TypeError(`bad operand type for unary ~: '${tn(a)}'`); }
  const bitop = (name, sym, nf, bf, setop) => (a, b) => {
    if (isInt(a) && isInt(b)) { if (typeof a === 'boolean' && typeof b === 'boolean' && name !== 'lshift' && name !== 'rshift') return !!nf(+a, +b); const x = num(a), y = num(b); if (typeof x === 'number' && typeof y === 'number' && Math.abs(x) < 2 ** 31 && Math.abs(y) < 2 ** 31 && (name !== 'lshift' || y < 22)) return nf(x, y); return normInt(bf(big(x), big(y))); }
    if (setop && a instanceof PySet && b instanceof PySet) return setop(a, b);
    if (setop && a instanceof Dict && b instanceof Dict && name === 'or') { const d = a.copy(); d.update(b); return d; }
    const d = dunder(a, b, '__' + name + '__', '__r' + name + '__'); if (d) return d[0]; throw opErr(sym, a, b);
  };
  const and_ = bitop('and', '&', (x, y) => x & y, (x, y) => x & y, (a, b) => a.intersection(b));
  const or_ = bitop('or', '|', (x, y) => x | y, (x, y) => x | y, (a, b) => a.union(b));
  const xor = bitop('xor', '^', (x, y) => x ^ y, (x, y) => x ^ y, (a, b) => a.symmetric_difference(b));
  const lshift = bitop('lshift', '<<', (x, y) => x * 2 ** y, (x, y) => x << y);
  const rshift = bitop('rshift', '>>', (x, y) => Math.floor(x / 2 ** y), (x, y) => x >> y);
  const iadd = (a, b) => { if (Array.isArray(a) && !(a instanceof Tuple)) { a.push(...iter(b)); return a; } if (a && a.__iadd__) return a.__iadd__(b); return add(a, b); };
  const imul = (a, b) => { if (Array.isArray(a) && !(a instanceof Tuple) && isInt(b)) { const c = a.slice(); a.length = 0; for (let i = 0; i < num(b); i++) a.push(...c); return a; } return mul(a, b); };
  /* ---------- comparison ---------- */
  function eq(a, b) {
    if (a === b) return true;
    if (isNum(a) && isNum(b)) { const x = num(a), y = num(b); if (typeof x === 'bigint' || typeof y === 'bigint') { try { return big(x) === big(y); } catch (e) { return Number(x) === Number(y); } } return x === y; }
    if (a === null || a === undefined || b === null || b === undefined) return (a == null) && (b == null);
    if (a && typeof a.__eq__ === 'function' && !(a instanceof PyFloat)) { const r = a.__eq__(b); if (r !== NotImplemented) return r; }
    if (b && typeof b.__eq__ === 'function' && !(b instanceof PyFloat)) { const r = b.__eq__(a); if (r !== NotImplemented) return r; }
    if (Array.isArray(a) && Array.isArray(b)) { if ((a instanceof Tuple) !== (b instanceof Tuple) || a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!eq(a[i], b[i])) return false; return true; }
    if (a instanceof Dict && b instanceof Dict) { if (a.size !== b.size) return false; for (const [h, e] of a.m) { const o = b.m.get(h); if (!o || !eq(e[1], o[1])) return false; } return true; }
    if (a instanceof PySet && b instanceof PySet) return a.size === b.size && [...a].every(x => b.__contains__(x));
    if (a instanceof Range && b instanceof Range) return a.length === b.length && (a.length === 0 || (a.start === b.start && (a.length === 1 || a.step === b.step)));
    return false;
  }
  const ne = (a, b) => !eq(a, b);
  function lt(a, b) {
    if (isNum(a) && isNum(b)) { const x = num(a), y = num(b); return (typeof x === 'bigint' || typeof y === 'bigint') && Number.isInteger(Number(x)) && Number.isInteger(Number(y)) ? big(x) < big(y) : x < y; }
    if (typeof a === 'string' && typeof b === 'string') return a < b;
    if (Array.isArray(a) && Array.isArray(b) && (a instanceof Tuple) === (b instanceof Tuple)) { for (let i = 0; i < Math.min(a.length, b.length); i++) if (!eq(a[i], b[i])) return lt(a[i], b[i]); return a.length < b.length; }
    if (a instanceof PySet && b instanceof PySet) return a.size < b.size && a.issubset(b);
    if (a && typeof a.__lt__ === 'function') { const r = a.__lt__(b); if (r !== NotImplemented) return r; }
    if (b && typeof b.__gt__ === 'function') { const r = b.__gt__(a); if (r !== NotImplemented) return r; }
    throw new E.TypeError(`'<' not supported between instances of '${tn(a)}' and '${tn(b)}'`);
  }
  function gt(a, b) { if (a && typeof a === 'object' && typeof a.__gt__ === 'function' && !(a instanceof PyFloat)) { const r = a.__gt__(b); if (r !== NotImplemented) return r; } try { return lt(b, a); } catch (e) { throw new E.TypeError(`'>' not supported between instances of '${tn(a)}' and '${tn(b)}'`); } }
  function le(a, b) { if (a && typeof a === 'object' && typeof a.__le__ === 'function' && !(a instanceof PyFloat)) { const r = a.__le__(b); if (r !== NotImplemented) return r; } if (a instanceof PySet && b instanceof PySet) return a.issubset(b); try { return lt(a, b) || eq(a, b); } catch (e) { throw new E.TypeError(`'<=' not supported between instances of '${tn(a)}' and '${tn(b)}'`); } }
  function ge(a, b) { if (a && typeof a === 'object' && typeof a.__ge__ === 'function' && !(a instanceof PyFloat)) { const r = a.__ge__(b); if (r !== NotImplemented) return r; } if (a instanceof PySet && b instanceof PySet) return a.issuperset(b); try { return lt(b, a) || eq(a, b); } catch (e) { throw new E.TypeError(`'>=' not supported between instances of '${tn(a)}' and '${tn(b)}'`); } }
  function contains(c, x) {
    if (typeof c === 'string') { if (typeof x !== 'string') throw new E.TypeError(`'in <string>' requires string as left operand, not ${tn(x)}`); return c.includes(x); }
    if (Array.isArray(c)) return c.some(y => eq(x, y));
    if (c && typeof c.__contains__ === 'function') return !!c.__contains__(x);
    for (const y of iter(c)) if (eq(x, y)) return true; return false;
  }
  function chain(a, ...rest) { let l = a; for (let i = 0; i < rest.length; i += 2) { const op = rest[i], r = rest[i + 1](); if (!CMP[op](l, r)) return false; l = r; } return true; }
  const CMP = { '<': lt, '>': gt, '<=': le, '>=': ge, '==': eq, '!=': ne, 'in': (a, b) => contains(b, a), 'not in': (a, b) => !contains(b, a), 'is': (a, b) => a === b || (a == null && b == null), 'is not': (a, b) => !(a === b || (a == null && b == null)) };
  /* ---------- iteration ---------- */
  function iter(x) {
    if (x === null || x === undefined) throw new E.TypeError("'NoneType' object is not iterable");
    if (typeof x === 'string' || Array.isArray(x) || x instanceof Dict || x instanceof PySet || x instanceof Range) return x;
    if (typeof x.__iter__ === 'function') { const it = x.__iter__(); if (it && typeof it[Symbol.iterator] === 'function') return it; if (it && typeof it.__next__ === 'function') return { [Symbol.iterator]() { return this; }, next() { try { return { value: it.__next__(), done: false }; } catch (e) { if (e instanceof E.StopIteration) return { value: undefined, done: true }; throw e; } } }; }
    if (typeof x[Symbol.iterator] === 'function') return x;
    if (typeof x.__getitem__ === 'function') return (function* () { for (let i = 0; ; i++) { try { yield x.__getitem__(i); } catch (e) { if (e instanceof E.IndexError) return; throw e; } } })();
    throw new E.TypeError(`'${tn(x)}' object is not iterable`);
  }
  function unpack(x, n) { const a = [...iter(x)]; if (a.length !== n) throw new E.ValueError(a.length > n ? `too many values to unpack (expected ${n})` : `not enough values to unpack (expected ${n}, got ${a.length})`); return a; }
  function unpackStar(x, before, after) { const a = [...iter(x)]; if (a.length < before + after) throw new E.ValueError(`not enough values to unpack (expected at least ${before + after}, got ${a.length})`); return [...a.slice(0, before), a.slice(before, a.length - after), ...a.slice(a.length - after)]; }
  /* ---------- items & slices ---------- */
  const cp = s => /[\uD800-\uDFFF]/.test(s) ? Array.from(s) : null;
  function idx(i, n, what) { i = num(i); if (typeof i === 'bigint') i = Number(i); if (typeof i !== 'number' || !Number.isInteger(i)) throw new E.TypeError(`${what} indices must be integers or slices, not ${tn(i)}`); if (i < 0) i += n; return i; }
  function getitem(o, k) {
    if (Array.isArray(o)) { const i = idx(k, o.length, o instanceof Tuple ? 'tuple' : 'list'); if (i < 0 || i >= o.length) throw new E.IndexError((o instanceof Tuple ? 'tuple' : 'list') + ' index out of range'); return o[i]; }
    if (typeof o === 'string') { const a = cp(o) || o; const i = idx(k, a.length, 'string'); if (i < 0 || i >= a.length) throw new E.IndexError('string index out of range'); return a[i]; }
    if (o && typeof o.__getitem__ === 'function') return o.__getitem__(k);
    throw new E.TypeError(`'${tn(o)}' object is not subscriptable`);
  }
  function setitem(o, k, v) {
    if (Array.isArray(o) && !(o instanceof Tuple)) { const i = idx(k, o.length, 'list'); if (i < 0 || i >= o.length) throw new E.IndexError('list assignment index out of range'); o[i] = v; return; }
    if (o && typeof o.__setitem__ === 'function') { o.__setitem__(k, v); return; }
    throw new E.TypeError(`'${tn(o)}' object does not support item assignment`);
  }
  function delitem(o, k) {
    if (Array.isArray(o) && !(o instanceof Tuple)) { const i = idx(k, o.length, 'list'); if (i < 0 || i >= o.length) throw new E.IndexError('list assignment index out of range'); o.splice(i, 1); return; }
    if (o && typeof o.__delitem__ === 'function') { o.__delitem__(k); return; }
    throw new E.TypeError(`'${tn(o)}' object doesn't support item deletion`);
  }
  function sliceIdx(n, lo, hi, st) {
    st = st === null || st === undefined ? 1 : Number(num(st)); if (st === 0) throw new E.ValueError('slice step cannot be zero');
    const norm = (v, def, isLo) => { if (v === null || v === undefined) return def; v = Number(num(v)); if (v < 0) { v += n; if (v < 0) v = st < 0 ? -1 : 0; } else if (v >= n) v = st < 0 ? n - 1 : n; return v; };
    const a = norm(lo, st < 0 ? n - 1 : 0), b = norm(hi, st < 0 ? -1 : n); const out = [];
    if (st > 0) for (let i = a; i < b; i += st) out.push(i); else for (let i = a; i > b; i += st) out.push(i);
    return out;
  }
  function getslice(o, lo, hi, st) {
    if (typeof o === 'string') { const a = cp(o) || o; return sliceIdx(a.length, lo, hi, st).map(i => a[i]).join(''); }
    if (Array.isArray(o)) { const r = sliceIdx(o.length, lo, hi, st).map(i => o[i]); return o instanceof Tuple ? Tuple.from(r) : r; }
    if (o instanceof Range) { const r = sliceIdx(o.length, lo, hi, st).map(i => o.__getitem__(i)); return r; }
    if (o && typeof o.__getitem__ === 'function') return o.__getitem__(new Slice(lo, hi, st));
    throw new E.TypeError(`'${tn(o)}' object is not subscriptable`);
  }
  class Slice { constructor(a, b, c) { this.start = a ?? null; this.stop = b ?? null; this.step = c ?? null; } }
  function setslice(o, lo, hi, st, v) {
    if (!Array.isArray(o) || o instanceof Tuple) throw new E.TypeError(`'${tn(o)}' object does not support slice assignment`);
    const vals = [...iter(v)];
    if (st === null || st === undefined || num(st) === 1) { const n = o.length; let a = lo == null ? 0 : Number(num(lo)), b = hi == null ? n : Number(num(hi)); if (a < 0) a = Math.max(0, a + n); if (b < 0) b = Math.max(0, b + n); a = Math.min(a, n); b = Math.max(a, Math.min(b, n)); o.splice(a, b - a, ...vals); return; }
    const ix = sliceIdx(o.length, lo, hi, st); if (ix.length !== vals.length) throw new E.ValueError(`attempt to assign sequence of size ${vals.length} to extended slice of size ${ix.length}`); ix.forEach((i, k) => { o[i] = vals[k]; });
  }
  function delslice(o, lo, hi, st) { const ix = new Set(sliceIdx(o.length, lo, hi, st)); const keep = o.filter((_, i) => !ix.has(i)); o.length = 0; o.push(...keep); }
  /* ---------- method dispatch for built-in types ---------- */
  const isWs = c => /\s/.test(c);
  function splitWs(s, max) { const out = []; let i = 0; const n = s.length; while (i < n) { while (i < n && isWs(s[i])) i++; if (i >= n) break; if (max >= 0 && out.length === max) { out.push(s.slice(i).replace(/\s+$/, '')); break; } let j = i; while (j < n && !isWs(s[j])) j++; out.push(s.slice(i, j)); i = j; } return out; }
  function stripChars(s, chars, l, r) { if (chars === null || chars === undefined) { if (l) s = s.replace(/^\s+/, ''); if (r) s = s.replace(/\s+$/, ''); return s; } let a = 0, b = s.length; if (l) while (a < b && chars.includes(s[a])) a++; if (r) while (b > a && chars.includes(s[b - 1])) b--; return s.slice(a, b); }
  const S = {
    upper: s => s.toUpperCase(), lower: s => s.toLowerCase(), casefold: s => s.toLowerCase(), swapcase: s => [...s].map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join(''),
    capitalize: s => s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s,
    title: s => s.replace(/[A-Za-zÀ-ɏ]+/g, w => w[0].toUpperCase() + w.slice(1).toLowerCase()),
    strip: (s, c) => stripChars(s, c, true, true), lstrip: (s, c) => stripChars(s, c, true, false), rstrip: (s, c) => stripChars(s, c, false, true),
    split(s, sep = null, max = -1) { if (sep instanceof KW) { ({ sep = null, maxsplit: max = -1 } = sep.o); } max = Number(num(max)); if (sep === null) return splitWs(s, max); if (sep === '') throw new E.ValueError('empty separator'); const p = s.split(sep); return max >= 0 && p.length > max + 1 ? [...p.slice(0, max), p.slice(max).join(sep)] : p; },
    rsplit(s, sep = null, max = -1) { if (sep instanceof KW) { ({ sep = null, maxsplit: max = -1 } = sep.o); } max = Number(num(max)); if (max < 0) return S.split(s, sep); if (sep === null) { const w = splitWs(s, -1); return w.length > max + 1 ? [w.slice(0, w.length - max).join(' '), ...w.slice(w.length - max)] : w; } const p = s.split(sep); return p.length > max + 1 ? [p.slice(0, p.length - max).join(sep), ...p.slice(p.length - max)] : p; },
    splitlines: (s, keep) => { const out = s.split(/(\r\n|\r|\n)/); const r = []; for (let i = 0; i < out.length; i += 2) { if (i === out.length - 1 && out[i] === '') break; r.push(out[i] + (keep && out[i + 1] ? out[i + 1] : '')); } return r; },
    join(s, it) { const a = [...iter(it)]; a.forEach((x, i) => { if (typeof x !== 'string') throw new E.TypeError(`sequence item ${i}: expected str instance, ${tn(x)} found`); }); return a.join(s); },
    replace: (s, a, b, n = -1) => { n = Number(num(n)); if (n < 0) return s.split(a).join(b); let out = s, i = 0, k = 0, res = ''; while (k < n) { const j = out.indexOf(a, i); if (j < 0) break; res += out.slice(i, j) + b; i = j + a.length; k++; if (!a) { res += out[i] || ''; i++; } } return res + out.slice(i); },
    find: (s, x, a, b) => { const sub = s.slice(a == null ? 0 : num(a) < 0 ? s.length + num(a) : num(a), b == null ? undefined : num(b)); const i = sub.indexOf(x); return i < 0 ? -1 : i + (a == null ? 0 : Math.max(0, num(a) < 0 ? s.length + num(a) : num(a))); },
    rfind: (s, x) => s.lastIndexOf(x),
    index: (s, x, a, b) => { const i = S.find(s, x, a, b); if (i < 0) throw new E.ValueError('substring not found'); return i; },
    rindex: (s, x) => { const i = s.lastIndexOf(x); if (i < 0) throw new E.ValueError('substring not found'); return i; },
    count: (s, x) => x === '' ? [...s].length + 1 : s.split(x).length - 1,
    startswith: (s, p, a) => { const t = a == null ? s : s.slice(num(a)); return p instanceof Tuple ? p.some(q => t.startsWith(q)) : t.startsWith(p); },
    endswith: (s, p) => p instanceof Tuple ? p.some(q => s.endsWith(q)) : s.endsWith(p),
    isdigit: s => s.length > 0 && /^\p{Nd}+$/u.test(s), isdecimal: s => s.length > 0 && /^\p{Nd}+$/u.test(s), isnumeric: s => s.length > 0 && /^\p{N}+$/u.test(s),
    isalpha: s => s.length > 0 && /^\p{L}+$/u.test(s), isalnum: s => s.length > 0 && /^[\p{L}\p{N}]+$/u.test(s), isspace: s => s.length > 0 && /^\s+$/.test(s),
    isupper: s => /\p{Lu}/u.test(s) && !/\p{Ll}/u.test(s), islower: s => /\p{Ll}/u.test(s) && !/\p{Lu}/u.test(s), istitle: s => s === S.title(s) && /\p{L}/u.test(s), isidentifier: s => /^[\p{L}_][\p{L}\p{N}_]*$/u.test(s),
    center: (s, w, c = ' ') => { w = Number(num(w)); const n = [...s].length; if (w <= n) return s; const pad = w - n, l = Math.floor(pad / 2) + (pad & w & 1); return c.repeat(l) + s + c.repeat(pad - l); },
    ljust: (s, w, c = ' ') => s + c.repeat(Math.max(0, Number(num(w)) - [...s].length)), rjust: (s, w, c = ' ') => c.repeat(Math.max(0, Number(num(w)) - [...s].length)) + s,
    zfill: (s, w) => { w = Number(num(w)); const sg = /^[+-]/.test(s) ? s[0] : ''; const b = sg ? s.slice(1) : s; return sg + '0'.repeat(Math.max(0, w - s.length)) + b; },
    partition: (s, sep) => { const i = s.indexOf(sep); return i < 0 ? T(s, '', '') : T(s.slice(0, i), sep, s.slice(i + sep.length)); },
    rpartition: (s, sep) => { const i = s.lastIndexOf(sep); return i < 0 ? T('', '', s) : T(s.slice(0, i), sep, s.slice(i + sep.length)); },
    removeprefix: (s, p) => s.startsWith(p) ? s.slice(p.length) : s, removesuffix: (s, p) => p && s.endsWith(p) ? s.slice(0, -p.length) : s,
    format: (s, ...a) => { const k = popKW(a); return strFormat(s, a, k); },
    expandtabs: (s, n = 8) => { n = Number(num(n)); let out = '', col = 0; for (const ch of s) { if (ch === '\t') { const k = n > 0 ? n - (col % n) : 0; out += ' '.repeat(k); col += k; } else if (ch === '\n' || ch === '\r') { out += ch; col = 0; } else { out += ch; col++; } } return out; },
    encode: () => { throw new E.NotImplementedError('bytes are not supported in transpiled code'); }
  };
  function sortKey(a, k) { const kw = popKW(a); const key = kw.key ?? null, rev = bool(kw.reverse ?? false); return [key, rev]; }
  function sortArr(arr, key, rev) {
    const keyed = arr.map((v, i) => [key ? key(v) : v, v]);
    keyed.sort((x, y) => { if (lt(x[0], y[0])) return rev ? 1 : -1; if (lt(y[0], x[0])) return rev ? -1 : 1; return 0; });
    return keyed.map(p => p[1]);
  }
  const L = {
    append: (l, x) => { l.push(x); return null; }, extend: (l, it) => { l.push(...iter(it)); return null; },
    insert: (l, i, x) => { i = Number(num(i)); if (i < 0) i = Math.max(0, i + l.length); l.splice(Math.min(i, l.length), 0, x); return null; },
    remove: (l, x) => { const i = l.findIndex(y => eq(x, y)); if (i < 0) throw new E.ValueError('list.remove(x): x not in list'); l.splice(i, 1); return null; },
    pop: (l, i = -1) => { if (!l.length) throw new E.IndexError('pop from empty list'); i = Number(num(i)); if (i < 0) i += l.length; if (i < 0 || i >= l.length) throw new E.IndexError('pop index out of range'); return l.splice(i, 1)[0]; },
    index: (l, x, a = 0) => { const i = l.findIndex((y, k) => k >= num(a) && eq(x, y)); if (i < 0) throw new E.ValueError(`${repr(x)} is not in list`); return i; },
    count: (l, x) => l.filter(y => eq(x, y)).length,
    sort: (l, ...a) => { const [key, rev] = sortKey(a); const s = sortArr(l, key, rev); for (let i = 0; i < s.length; i++) l[i] = s[i]; return null; },
    reverse: l => { l.reverse(); return null; }, copy: l => l.slice(), clear: l => { l.length = 0; return null; }
  };
  function callm(o, name, ...a) {
    if (typeof o === 'string') { const fn = S[name]; if (fn) return fn(o, ...a); }
    else if (Array.isArray(o) && !(o instanceof Tuple)) { const fn = L[name]; if (fn) return fn(o, ...a); }
    else if (o instanceof PyFloat) { if (name === 'is_integer') return Number.isInteger(o.v); if (name === 'hex') return o.v.toString(16); }
    else if (isInt(o)) { if (name === 'bit_length') { const v = big(num(o)); return (v < 0n ? -v : v).toString(2).replace(/^0$/, '').length; } if (name === 'to_bytes') throw new E.NotImplementedError('bytes are not supported'); }
    if (o !== null && o !== undefined) { const fn = o[name]; if (typeof fn === 'function') return fn.apply(o, a); }
    throw new E.AttributeError(`'${tn(o)}' object has no attribute '${name}'`);
  }
  function getattr(o, name, ...d) { if (o !== null && o !== undefined && name in Object(o)) { const v = o[name]; return typeof v === 'function' && !(v.prototype && v.prototype.constructor === v && /^class/.test(String(v))) ? v.bind(o) : v; } if (typeof o === 'string' && S[name]) return (...a) => S[name](o, ...a); if (Array.isArray(o) && L[name]) return (...a) => L[name](o, ...a); if (d.length) return d[0]; throw new E.AttributeError(`'${tn(o)}' object has no attribute '${name}'`); }
  /* ---------- I/O ---------- */
  let outBuf = '';
  const stdout = { write(s) { outBuf += s; let i; while ((i = outBuf.indexOf('\n')) >= 0) { stdout.line(outBuf.slice(0, i)); outBuf = outBuf.slice(i + 1); } }, line: s => console.log(s), flush() { if (outBuf) { stdout.line(outBuf); outBuf = ''; } } };
  const stdin = { lines: null };
  function print(...a) { const k = popKW(a); const sep = k.sep === undefined || k.sep === null ? ' ' : k.sep, end = k.end === undefined || k.end === null ? '\n' : k.end; const s = a.map(str).join(sep) + end; if (k.file && k.file !== stdout && typeof k.file.write === 'function') k.file.write(s); else stdout.write(s); return null; }
  function input(prompt) {
    if (prompt !== undefined) stdout.write(str(prompt));
    if (stdin.lines && stdin.lines.length) return stdin.lines.shift();
    if (stdin.lines) throw new E.EOFError('EOF when reading a line');
    if (typeof window !== 'undefined' && typeof window.prompt === 'function') { stdout.flush(); const r = window.prompt(prompt === undefined ? '' : str(prompt)); if (r === null) throw new E.EOFError('EOF when reading a line'); return r; }
    throw new E.EOFError('EOF when reading a line');
  }
  /* ---------- built-in functions ---------- */
  function len(x) {
    if (typeof x === 'string') { const a = cp(x); return a ? a.length : x.length; }
    if (Array.isArray(x)) return x.length; if (x instanceof Dict || x instanceof PySet) return x.size; if (x instanceof Range) return x.length;
    if (x && typeof x.__len__ === 'function') return x.__len__();
    throw new E.TypeError(`object of type '${tn(x)}' has no len()`);
  }
  const typeObj = (name, fn, test) => { fn.__pytype__ = name; fn.__name__ = name; fn.__test__ = test; return fn; };
  function toInt(x, base) {
    if (base !== undefined && base !== null) { if (typeof x !== 'string') throw new E.TypeError("int() can't convert non-string with explicit base"); let s = x.trim().toLowerCase().replace(/_/g, ''), b = Number(num(base)); let neg = false; if (/^[+-]/.test(s)) { neg = s[0] === '-'; s = s.slice(1); } if (b === 16) s = s.replace(/^0x/, ''); if (b === 8) s = s.replace(/^0o/, ''); if (b === 2) s = s.replace(/^0b/, ''); if (b === 0) { b = /^0x/.test(s) ? 16 : /^0o/.test(s) ? 8 : /^0b/.test(s) ? 2 : 10; s = s.replace(/^0[xob]/, ''); } const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, b); if (!s || [...s].some(c => !digits.includes(c))) throw new E.ValueError(`invalid literal for int() with base ${num(base)}: ${repr(x)}`); let v = 0n; for (const c of s) v = v * BigInt(b) + BigInt(digits.indexOf(c)); return normInt(neg ? -v : v); }
    if (x === undefined) return 0;
    if (typeof x === 'boolean') return +x;
    if (isInt(x)) return num(x);
    if (isF(x)) { const v = fl(x); if (!isFinite(v)) throw new (v !== v ? E.ValueError : E.OverflowError)(v !== v ? 'cannot convert float NaN to integer' : 'cannot convert float infinity to integer'); const t = Math.trunc(v); return Number.isSafeInteger(t) ? (t === 0 ? 0 : t) : normInt(BigInt(t)); }
    if (typeof x === 'string') { const s = x.trim().replace(/_/g, ''); if (!/^[+-]?\d+$/.test(s)) throw new E.ValueError(`invalid literal for int() with base 10: ${repr(x)}`); return normInt(BigInt(s)); }
    if (x && x.__int__) return x.__int__();
    throw new E.TypeError(`int() argument must be a string, a bytes-like object or a real number, not '${tn(x)}'`);
  }
  function toFloat(x) {
    if (x === undefined) return f(0);
    if (isNum(x)) return f(Number(num(x)));
    if (typeof x === 'string') { const s = x.trim().toLowerCase().replace(/_/g, ''); if (/^[+-]?(inf|infinity)$/.test(s)) return f(s[0] === '-' ? -Infinity : Infinity); if (/^[+-]?nan$/.test(s)) return f(NaN); if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/.test(s)) throw new E.ValueError(`could not convert string to float: ${repr(x)}`); return f(parseFloat(s)); }
    if (x && x.__float__) return x.__float__();
    throw new E.TypeError(`float() argument must be a string or a real number, not '${tn(x)}'`);
  }
  const int = typeObj('int', toInt, x => isInt(x));
  const float = typeObj('float', toFloat, x => isF(x));
  const strT = typeObj('str', (x = '') => str(x), x => typeof x === 'string');
  const boolT = typeObj('bool', (x = false) => bool(x), x => typeof x === 'boolean');
  const list = typeObj('list', it => it === undefined ? [] : [...iter(it)], x => Array.isArray(x) && !(x instanceof Tuple));
  const tupleT = typeObj('tuple', tuple, x => x instanceof Tuple);
  const dict = typeObj('dict', (src, k) => { const d = new Dict(); d.update(src, k); return d; }, x => x instanceof Dict);
  dict.fromkeys = Dict.fromkeys;
  for (const k of Object.keys(S)) strT[k] = (s, ...a) => S[k](s, ...a);
  for (const k of Object.keys(L)) list[k] = (l, ...a) => L[k](l, ...a);
  for (const k of ['get', 'keys', 'values', 'items', 'pop', 'update', 'setdefault', 'copy', 'clear']) dict[k] = (d, ...a) => d[k](...a);
  const set = typeObj('set', it => new PySet(it), x => x instanceof PySet && !(x instanceof FrozenSet));
  const frozenset = typeObj('frozenset', it => new FrozenSet(it), x => x instanceof FrozenSet);
  const rangeT = typeObj('range', (...a) => new Range(...a), x => x instanceof Range);
  const NoneType = typeObj('NoneType', () => null, x => x === null || x === undefined);
  function isinstance(x, C) {
    if (C instanceof Tuple || Array.isArray(C)) return C.some(c => isinstance(x, c));
    if (C === object) return true;
    if (C && C.__test__) return !!C.__test__(x);
    if (C === E.BaseException || (C && C.prototype instanceof Error)) return x instanceof C;
    return typeof C === 'function' && x instanceof C;
  }
  function issubclass(A, B) { if (B instanceof Tuple || Array.isArray(B)) return B.some(b => issubclass(A, b)); return A === B || (A && B && A.prototype instanceof B); }
  function type(x) {
    if (typeof x === 'boolean') return boolT; if (isF(x)) return float; if (isInt(x)) return int; if (typeof x === 'string') return strT;
    if (x === null || x === undefined) return NoneType; if (x instanceof Tuple) return tupleT; if (Array.isArray(x)) return list; if (x instanceof Dict && x.constructor === Dict) return dict;
    if (x instanceof FrozenSet) return frozenset; if (x instanceof PySet) return set; if (x instanceof Range) return rangeT;
    return x.constructor;
  }
  function range(...a) { return new Range(...a); }
  function enumerate(it, start = 0) { if (start instanceof KW) start = start.o.start; const s = num(start); return (function* () { let i = s; for (const x of iter(it)) yield T(i++, x); })(); }
  function zip(...its) { const k = popKW(its); const iters = its.map(i => iter(i)[Symbol.iterator]()); return (function* () { if (!iters.length) return; for (;;) { const row = []; for (const it of iters) { const r = it.next(); if (r.done) { if (k.strict && row.length) throw new E.ValueError('zip() argument ' + (row.length + 1) + ' is shorter than argument 1'); return; } row.push(r.value); } yield Tuple.from(row); } })(); }
  function map(fn, ...its) { const iters = its.map(i => iter(i)[Symbol.iterator]()); return (function* () { for (;;) { const row = []; for (const it of iters) { const r = it.next(); if (r.done) return; row.push(r.value); } yield fn(...row); } })(); }
  function filter(fn, it) { return (function* () { for (const x of iter(it)) if (fn === null || fn === undefined ? bool(x) : bool(fn(x))) yield x; })(); }
  function reversed(x) { if (x && typeof x.__reversed__ === 'function') return x.__reversed__(); if (x instanceof Dict) return x.keys().reverse(); const a = typeof x === 'string' ? Array.from(x) : x instanceof Range ? [...x] : x; if (!Array.isArray(a)) throw new E.TypeError(`'${tn(x)}' object is not reversible`); return (function* () { for (let i = a.length - 1; i >= 0; i--) yield a[i]; })(); }
  function sorted(it, ...a) { const [key, rev] = sortKey(a); return sortArr([...iter(it)], key, rev); }
  function minmax(name, better, a) {
    const k = popKW(a); const key = k.key ?? null;
    let items = a.length === 1 ? [...iter(a[0])] : a;
    if (!items.length) { if ('default' in k) return k.default; throw new E.ValueError(`${name}() iterable argument is empty`); }
    let best = items[0], bk = key ? key(best) : best;
    for (let i = 1; i < items.length; i++) { const kk = key ? key(items[i]) : items[i]; if (better(kk, bk)) { best = items[i]; bk = kk; } }
    return best;
  }
  const max = (...a) => minmax('max', (x, y) => gt(x, y), a), min = (...a) => minmax('min', (x, y) => lt(x, y), a);
  function sum(it, start = 0) {
    if (start instanceof KW) start = start.o.start ?? 0;
    let acc = start, fsum = null, comp = 0;
    for (const x of iter(it)) {
      if (fsum !== null || (isF(x) && isNum(acc))) { // CPython 3.12 sums floats with Neumaier compensation
        if (fsum === null) { fsum = fl(acc); comp = 0; }
        if (!isNum(x)) { acc = add(f(fsum + comp), x); fsum = null; continue; }
        const v = fl(x), t = fsum + v; comp += Math.abs(fsum) >= Math.abs(v) ? (fsum - t) + v : (v - t) + fsum; fsum = t;
      } else acc = add(acc, x);
    }
    return fsum !== null ? f(fsum + comp) : acc;
  }
  function abs(x) { if (isF(x)) return f(Math.abs(fl(x))); if (isInt(x)) { const v = num(x); return typeof v === 'bigint' ? (v < 0n ? -v : v) : Math.abs(v); } if (x && x.__abs__) return x.__abs__(); throw new E.TypeError(`bad operand type for abs(): '${tn(x)}'`); }
  function round(x, n) {
    if (n === undefined || n === null) { if (isInt(x)) return num(x); const v = fl(x); if (!isFinite(v)) throw new E.OverflowError('cannot convert float infinity to integer'); const r = Math.round(v); return (Math.abs(v % 1) === 0.5 && r % 2 !== 0) ? r - 1 : (r === 0 ? 0 : r); }
    n = Number(num(n));
    if (isInt(x)) { if (n >= 0) return num(x); const p = 10 ** -n; return Number(num(x)) / p % 1 === 0.5 ? x : Math.round(Number(num(x)) / p) * p; }
    const v = fl(x); if (!isFinite(v) || n > 15) return f(v);
    if (n >= 0) return f(Number(toFixedEven(v, n)));
    const p = 10 ** -n, q = v / p, r = Math.round(q), even = (Math.abs(q % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r;
    return f(even * p);
  }
  function divmod(a, b) { return T(floordiv(a, b), mod(a, b)); }
  const chr = n => String.fromCodePoint(Number(num(n)));
  const ord = s => { if (typeof s !== 'string' || [...s].length !== 1) throw new E.TypeError(`ord() expected a character, but string of length ${typeof s === 'string' ? s.length : 0} found`); return s.codePointAt(0); };
  const baseStr = (pre, b) => n => { if (!isInt(n)) throw new E.TypeError(`'${tn(n)}' object cannot be interpreted as an integer`); const v = big(num(n)); return (v < 0n ? '-' : '') + pre + (v < 0n ? -v : v).toString(b); };
  const hex = baseStr('0x', 16), oct = baseStr('0o', 8), bin = baseStr('0b', 2);
  const all = it => { for (const x of iter(it)) if (!bool(x)) return false; return true; };
  const any = it => { for (const x of iter(it)) if (bool(x)) return true; return false; };
  function next(it, ...d) { if (it && typeof it.__next__ === 'function') { try { return it.__next__(); } catch (e) { if (d.length && e instanceof E.StopIteration) return d[0]; throw e; } } if (!it || typeof it.next !== 'function') throw new E.TypeError(`'${tn(it)}' object is not an iterator`); const r = it.next(); if (r.done) { if (d.length) return d[0]; throw new E.StopIteration(); } return r.value; }
  function iterB(x) { const i = iter(x); return i[Symbol.iterator](); }
  const callable = x => typeof x === 'function' || !!(x && typeof x.__call__ === 'function');
  const hasattr = (o, n) => { try { getattr(o, n); return true; } catch (e) { return false; } };
  const setattr = (o, n, v) => { o[n] = v; return null; };
  const id = x => idOf(Object(x));
  const nameOf = x => x == null ? 'NoneType' : (x.__name__ ?? x.__pytype__ ?? x.name);
  function call(fn, ...a) { if (typeof fn === 'function') { if (fn.prototype && (fn.prototype instanceof object || fn.prototype instanceof Error || fn === object) && !fn.__pytype__) return new fn(...a); return fn(...a); } if (fn && typeof fn.__call__ === 'function') return fn.__call__(...a); throw new E.TypeError(`'${tn(fn)}' object is not callable`); }
  /* ---------- modules ---------- */
  const mathM = {
    __module_name__: 'math', pi: f(Math.PI), e: f(Math.E), tau: f(2 * Math.PI), inf: f(Infinity), nan: f(NaN),
    sqrt: x => { const v = fl(x); if (v < 0) throw new E.ValueError('math domain error'); return f(Math.sqrt(v)); },
    floor: x => isInt(x) ? num(x) : toInt(f(Math.floor(fl(x)))), ceil: x => isInt(x) ? num(x) : toInt(f(Math.ceil(fl(x)))), trunc: x => toInt(x),
    fabs: x => f(Math.abs(fl(x))), exp: x => f(Math.exp(fl(x))), log: (x, b) => { const v = fl(x); if (v <= 0) throw new E.ValueError('math domain error'); return f(b === undefined ? Math.log(v) : Math.log(v) / Math.log(fl(b))); },
    log2: x => f(Math.log2(fl(x))), log10: x => f(Math.log10(fl(x))), pow: (a, b) => f(Math.pow(fl(a), fl(b))),
    sin: x => f(Math.sin(fl(x))), cos: x => f(Math.cos(fl(x))), tan: x => f(Math.tan(fl(x))), asin: x => f(Math.asin(fl(x))), acos: x => f(Math.acos(fl(x))), atan: x => f(Math.atan(fl(x))), atan2: (y, x) => f(Math.atan2(fl(y), fl(x))),
    sinh: x => f(Math.sinh(fl(x))), cosh: x => f(Math.cosh(fl(x))), tanh: x => f(Math.tanh(fl(x))),
    hypot: (...a) => f(Math.hypot(...a.map(fl))), degrees: x => f(fl(x) * 180 / Math.PI), radians: x => f(fl(x) * Math.PI / 180),
    gcd: (...a) => { let g = 0n; for (const x of a) { let y = big(num(x)); if (y < 0n) y = -y; while (y) [g, y] = [y, g % y]; } return normInt(g); },
    lcm: (...a) => { let l = 1n; for (const x of a) { const y = big(num(x)); if (y === 0n) return 0; let g = l, z = y < 0n ? -y : y; while (z) [g, z] = [z, g % z]; l = l * (y < 0n ? -y : y) / g; } return normInt(l); },
    factorial: n => { if (!isInt(n) || num(n) < 0) throw new E.ValueError('factorial() not defined for negative values'); let r = 1n; for (let i = 2n; i <= big(num(n)); i++) r *= i; return normInt(r); },
    comb: (n, k) => { n = big(num(n)); k = big(num(k)); if (k < 0n || k > n) return 0; let r = 1n; for (let i = 1n; i <= k; i++) r = r * (n - k + i) / i; return normInt(r); },
    perm: (n, k) => { n = big(num(n)); k = k === undefined ? n : big(num(k)); if (k > n) return 0; let r = 1n; for (let i = 0n; i < k; i++) r *= n - i; return normInt(r); },
    isqrt: n => { const v = big(num(n)); if (v < 0n) throw new E.ValueError('isqrt() argument must be nonnegative'); if (v < 2n) return normInt(v); let x = BigInt(Math.floor(Math.sqrt(Number(v)))); while (x * x > v) x--; while ((x + 1n) * (x + 1n) <= v) x++; return normInt(x); },
    isclose: (a, b, k) => { const o = k instanceof KW ? k.o : {}; const rt = o.rel_tol !== undefined ? fl(o.rel_tol) : 1e-9, at = o.abs_tol !== undefined ? fl(o.abs_tol) : 0; const x = fl(a), y = fl(b); return x === y || Math.abs(x - y) <= Math.max(rt * Math.max(Math.abs(x), Math.abs(y)), at); },
    isfinite: x => isFinite(fl(x)), isinf: x => Math.abs(fl(x)) === Infinity, isnan: x => fl(x) !== fl(x),
    prod: (it, s = 1) => { let p = s instanceof KW ? (s.o.start ?? 1) : s; for (const x of iter(it)) p = mul(p, x); return p; },
    fsum: it => { let s = 0, c = 0; for (const x of iter(it)) { const v = fl(x), t = s + v; c += Math.abs(s) >= Math.abs(v) ? (s - t) + v : (v - t) + s; s = t; } return f(s + c); },
    copysign: (a, b) => f(Math.sign(fl(b)) * Math.abs(fl(a)) || (Object.is(fl(b), -0) ? -Math.abs(fl(a)) : Math.abs(fl(a)))), dist: (p, q) => f(Math.hypot(...[...iter(p)].map((v, i) => fl(v) - fl([...iter(q)][i]))))
  };
  // random: MT19937 seeded exactly like CPython (init_by_array), so seeded programs print the same numbers
  function MT() {
    const mt = new Uint32Array(624); let mti = 625;
    const init = s => { mt[0] = s >>> 0; for (mti = 1; mti < 624; mti++) { const p = mt[mti - 1] ^ (mt[mti - 1] >>> 30); mt[mti] = (((((p & 0xffff0000) >>> 16) * 1812433253) << 16) + (p & 0x0000ffff) * 1812433253 + mti) >>> 0; } };
    const initArr = key => { init(19650218); let i = 1, j = 0; for (let k = Math.max(624, key.length); k; k--) { const p = mt[i - 1] ^ (mt[i - 1] >>> 30); mt[i] = ((mt[i] ^ (((((p & 0xffff0000) >>> 16) * 1664525) << 16) + ((p & 0x0000ffff) * 1664525))) + key[j] + j) >>> 0; i++; j++; if (i >= 624) { mt[0] = mt[623]; i = 1; } if (j >= key.length) j = 0; } for (let k = 623; k; k--) { const p = mt[i - 1] ^ (mt[i - 1] >>> 30); mt[i] = ((mt[i] ^ (((((p & 0xffff0000) >>> 16) * 1566083941) << 16) + (p & 0x0000ffff) * 1566083941)) - i) >>> 0; i++; if (i >= 624) { mt[0] = mt[623]; i = 1; } } mt[0] = 0x80000000; mti = 624; };
    const gen = () => { let y; if (mti >= 624) { let kk; for (kk = 0; kk < 624 - 397; kk++) { y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff); mt[kk] = mt[kk + 397] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0); } for (; kk < 623; kk++) { y = (mt[kk] & 0x80000000) | (mt[kk + 1] & 0x7fffffff); mt[kk] = mt[kk + (397 - 624)] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0); } y = (mt[623] & 0x80000000) | (mt[0] & 0x7fffffff); mt[623] = mt[396] ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0); mti = 0; } y = mt[mti++]; y ^= y >>> 11; y ^= (y << 7) & 0x9d2c5680; y ^= (y << 15) & 0xefc60000; y ^= y >>> 18; return y >>> 0; };
    return { initArr, gen };
  }
  const rng = MT();
  function seedR(s) { if (s === undefined || s === null) { const a = new Uint32Array(4); (typeof crypto !== 'undefined' ? crypto : { getRandomValues: x => { for (let i = 0; i < x.length; i++) x[i] = Math.random() * 2 ** 32; return x; } }).getRandomValues(a); rng.initArr([...a]); return null; } let v; if (typeof s === 'string') throw new E.NotImplementedError('random.seed() with a string seed is not supported (use an integer)'); v = big(num(isF(s) ? toInt(s) : s)); if (v < 0n) v = -v; const key = []; do { key.push(Number(v & 0xffffffffn)); v >>= 32n; } while (v > 0n); rng.initArr(key); return null; }
  seedR();
  const rand = () => { const a = rng.gen() >>> 5, b = rng.gen() >>> 6; return (a * 67108864 + b) / 9007199254740992; };
  function getrandbits(k) { if (k <= 32) return rng.gen() >>> (32 - k); let r = 0n, shift = 0n; const words = Math.ceil(k / 32); for (let i = 0; i < words; i++, k -= 32) { let w = rng.gen(); if (k < 32) w >>>= (32 - k); r |= BigInt(w) << shift; shift += 32n; } return normInt(r); }
  function randbelow(n) { n = Number(n); if (n <= 0) throw new E.ValueError('empty range for randrange()'); const k = n.toString(2).length; let r = getrandbits(k); while (r >= n) r = getrandbits(k); return r; }
  const randomM = {
    __module_name__: 'random', seed: seedR, random: () => f(rand()), getrandbits: k => getrandbits(Number(num(k))),
    randrange(a, b, st = 1) { if (b === undefined || b === null) return randbelow(num(a)); a = Number(num(a)); b = Number(num(b)); st = Number(num(st)); if (st === 1) return a + randbelow(b - a); const n = st > 0 ? Math.floor((b - a + st - 1) / st) : Math.floor((b - a + st + 1) / st); return a + st * randbelow(n); },
    randint(a, b) { return Number(num(a)) + randbelow(Number(num(b)) - Number(num(a)) + 1); },
    choice(seq) { const a = Array.isArray(seq) || typeof seq === 'string' ? seq : [...iter(seq)]; if (!len(a)) throw new E.IndexError('Cannot choose from an empty sequence'); return getitem(a, randbelow(len(a))); },
    shuffle(x) { for (let i = x.length - 1; i > 0; i--) { const j = randbelow(i + 1); [x[i], x[j]] = [x[j], x[i]]; } return null; },
    uniform: (a, b) => f(fl(a) + (fl(b) - fl(a)) * rand()),
    sample(pop, k) { // CPython's algorithm (set-based selection for large populations, pool for small)
      const p = [...iter(pop)], n = p.length; k = Number(num(k)); if (k < 0 || k > n) throw new E.ValueError('Sample larger than population or is negative');
      const result = new Array(k); let setsize = 21; if (k > 5) setsize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4));
      if (n <= setsize) { const pool = p.slice(); for (let i = 0; i < k; i++) { const j = randbelow(n - i); result[i] = pool[j]; pool[j] = pool[n - i - 1]; } }
      else { const sel = new Set(); for (let i = 0; i < k; i++) { let j = randbelow(n); while (sel.has(j)) j = randbelow(n); sel.add(j); result[i] = p[j]; } }
      return result;
    }
  };
  const t0 = Date.now();
  const timeM = { __module_name__: 'time', time: () => f(Date.now() / 1000), perf_counter: () => f(typeof performance !== 'undefined' ? performance.now() / 1000 : (Date.now() - t0) / 1000), monotonic: () => f((Date.now() - t0) / 1000), sleep: s => { const end = Date.now() + fl(s) * 1000; while (Date.now() < end) { /* busy wait: transpiled code is synchronous */ } return null; } };
  const toPy = v => v === null ? null : Array.isArray(v) ? v.map(toPy) : typeof v === 'object' ? (() => { const d = new Dict(); for (const k of Object.keys(v)) d.__setitem__(k, toPy(v[k])); return d; })() : typeof v === 'number' ? (Number.isInteger(v) ? v : f(v)) : v;
  function jsonDumps(x, ...a) {
    const k = popKW(a); const indent = k.indent ?? null, sortK = bool(k.sort_keys ?? false); const [isep, ksep] = k.separators ? [...k.separators] : [indent === null ? ', ' : ',', ': '];
    const ind = indent === null ? null : typeof indent === 'string' ? indent : ' '.repeat(Number(num(indent)));
    const enc = (v, lvl) => {
      if (v === null || v === undefined) return 'null'; if (v === true) return 'true'; if (v === false) return 'false';
      if (isNum(v)) { if (isF(v)) { const x = fl(v); return isFinite(x) ? floatRepr(x) : x !== x ? 'NaN' : x > 0 ? 'Infinity' : '-Infinity'; } return String(num(v)); }
      if (typeof v === 'string') return JSON.stringify(v).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
      const nl = ind === null ? '' : '\n' + ind.repeat(lvl + 1), end = ind === null ? '' : '\n' + ind.repeat(lvl);
      if (Array.isArray(v)) return v.length ? '[' + nl + v.map(y => enc(y, lvl + 1)).join(isep + nl) + end + ']' : '[]';
      if (v instanceof Dict) { let es = [...v.m.values()]; if (sortK) es = sortArr(es, e => e[0], false); return es.length ? '{' + nl + es.map(e => enc(typeof e[0] === 'string' ? e[0] : str(e[0]), lvl + 1) + ksep + enc(e[1], lvl + 1)).join(isep + nl) + end + '}' : '{}'; }
      throw new E.TypeError(`Object of type ${tn(v)} is not JSON serializable`);
    };
    return enc(x, 0);
  }
  const jsonM = { __module_name__: 'json', dumps: jsonDumps, loads: s => { try { return toPy(JSON.parse(s)); } catch (e) { throw new E.ValueError(String(e.message)); } } };
  const MODS = { math: mathM, random: randomM, time: timeM, json: jsonM };
  function module(name) { const m = MODS[name]; if (!m) throw new E.ModuleNotFoundError(`No module named '${name}'`); return m; }
  /* ---------- uncaught errors ---------- */
  function report(e) { e = exc(e); stdout.flush(); const msg = `${e.constructor.name}${str(e) ? ': ' + str(e) : ''}`; (console.error || console.log)('Traceback (most recent call last):\n  (transpiled code)\n' + msg); return msg; }
  return {
    PyFloat, f, Tuple, T, Dict, PySet, FrozenSet, Range, KW, kw, varargs, object, classattr, aliasStatic, NotImplemented,
    bool, or, and, repr, str: strT, format, fmt, add, sub, mul, div, floordiv, mod, pow, neg, pos, invert, and_, or_, xor, lshift, rshift, iadd, imul,
    eq, ne, lt, gt, le, ge, contains, chain, iter, unpack, unpackStar, getitem, setitem, delitem, getslice, setslice, delslice, Slice, callm, call, getattr, hasattr, setattr,
    print, input, stdout, stdin, len, int, float, bool_: boolT, list, tuple: tupleT, dict, set, frozenset, range, isinstance, issubclass, type, enumerate, zip, map, filter, reversed, sorted, max, min, sum, abs, round, divmod, chr, ord, hex, oct, bin, all, any, next, iter_: iterB, callable, id, repr_: repr, format_: format,
    exc, mkexc, report, module, typeName, nameOf, toStr: str, ...E
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = py;
