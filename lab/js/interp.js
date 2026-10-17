// Lumen Lab — tree-walking interpreter: workspaces, indexing/assignment with copy-on-write,
// user functions (script local functions and function files), anonymous functions, display.
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const M = node ? require('./mat.js') : root.LabMat;
  const Lang = node ? require('./lang.js') : root.LabLang;
  const { Mat, fail, num, str } = M;

  // ---------- other value types ----------
  class Cell {
    constructor(r, c, data) { this.r = r; this.c = c; this.data = data || Array.from({ length: r * c }, () => M.empty()); }
    get n() { return this.r * this.c; } get type() { return 'cell'; }
  }
  class Struct {
    constructor(f) { this.f = f || new Map(); }
    get r() { return 1; } get c() { return 1; } get n() { return 1; } get type() { return 'struct'; }
  }
  class Func {
    constructor(o) { Object.assign(this, o); }
    get r() { return 1; } get c() { return 1; } get n() { return 1; } get type() { return 'func'; }
    get src() { return this.js ? '@(x)<internal>' : this.name ? '@' + this.name : Lang.unparse({ t: 'anon', params: this.params, body: this.body }); }
  }
  const clsOf = v => v.type === 'num' ? v.cls : v.type === 'cell' ? 'cell' : v.type === 'struct' ? 'struct' : 'function_handle';
  const isNum = v => v && v.type === 'num';

  class Signal { constructor(kind) { this.kind = kind; } }
  const BREAK = new Signal('break'), CONTINUE = new Signal('continue'), RETURN = new Signal('return');

  class Interp {
    constructor(opts = {}) {
      this.out = opts.out || (s => process.stdout.write(s));
      this.base = new Map(); this.globals = new Map();
      this.files = new Map();          // virtual current folder: name → text (.m scripts/functions, .csv data)
      this.lib = Object.create(null);  // builtins: name → fn(args, nargout, interp)
      this.checkInterrupt = opts.interrupt || null;
      this.frames = [{ scope: this.base, name: 'base', funcs: new Map(), globalNames: new Set() }];
      this.ticks = 0; this.depth = 0;
      this.parseCache = new Map();
      this.rng = mulberry32(5489);
    }
    get frame() { return this.frames[this.frames.length - 1]; }
    get scope() { return this.frame.scope; }
    tick() {
      if ((++this.ticks & 1023) === 0 && this.checkInterrupt && this.checkInterrupt()) { const e = new M.LabError('Operation terminated by user.', 'MATLAB:interrupt'); e.interrupt = true; throw e; }
    }
    print(s) { this.out(s, 'out'); }
    warn(s) { this.out('Warning: ' + s + '\n', 'warn'); }

    // ----- variables -----
    getVar(name) {
      const f = this.frame;
      if (f.globalNames.has(name)) return this.globals.get(name);
      return f.scope.get(name);
    }
    setVar(name, v) {
      const f = this.frame;
      if (f.globalNames.has(name)) this.globals.set(name, v); else f.scope.set(name, v);
    }
    hasVar(name) { return this.getVar(name) !== undefined; }

    // ----- running code -----
    parseCached(src, key) {
      if (key && this.parseCache.has(key) && this.parseCache.get(key).src === src) return this.parseCache.get(key).ast;
      const ast = Lang.parse(src); if (key) this.parseCache.set(key, { src, ast }); return ast;
    }
    // run text in the base workspace (command window, editor Run). name labels errors.
    run(src, name) {
      const ast = Lang.parse(src);
      const f = this.frames[0], saved = f.funcs, savedName = f.name, savedSrc = f.src;
      f.src = name || null;
      if (ast.funcs.length) { f.funcs = new Map(saved); ast.funcs.forEach(fn => f.funcs.set(fn.name, { def: fn, file: name || 'base', funcs: new Map(ast.funcs.map(x => [x.name, x])) })); }
      if (name) f.name = name;
      try { this.execBlock(ast.body); }
      catch (e) { if (e === RETURN) return; throw e; }
      finally { f.name = savedName; f.src = savedSrc; }
    }
    // hook(s, sameLine): debugger / profiler entry before every statement (null when neither is active)
    execBlock(stmts) {
      if (!this.hook) { for (let i = 0; i < stmts.length; i++) this.exec(stmts[i]); return; }
      for (let i = 0; i < stmts.length; i++) { const s = stmts[i]; this.frame.line = s.line; const tok = this.hook(s, i > 0 && stmts[i - 1].line === s.line); this.exec(s); if (tok) this.hookEnd(tok); }
    }
    exec(s) {
      this.frame.line = s.line;
      try { this['s_' + s.t](s); }
      catch (e) {
        if (e instanceof Signal) throw e;
        if (!(e instanceof M.LabError)) { const x = new M.LabError(e instanceof RangeError && /call stack/.test(e.message) ? 'Maximum recursion limit reached.' : (e.message || String(e))); x.js = e; e = x; }
        if (this.onError && !e.dbgSeen && !e.interrupt && !this.tryDepth) { e.dbgSeen = true; this.frame.line = s.line; this.onError(e, s); }
        if (!e.where) e.where = []; if (!e.marked) { e.marked = new Set(); }
        if (!e.marked.has(this.frames.length)) { e.marked.add(this.frames.length); e.where.push({ name: this.frame.name, line: s.line }); }
        throw e;
      }
    }
    s_expr(s) {
      const e = s.e;
      if (e.t === 'id' && this.hasVar(e.name)) { const v = this.getVar(e.name); if (s.print) this.display(e.name, v); return; }
      const vals = this.evalMulti(e, 0, true);
      if (vals.length && vals[0] !== undefined) {
        this.setVar('ans', vals[0]);
        if (s.print) this.display('ans', vals[0]);
      }
    }
    s_assign(s) {
      if (s.multi) {
        const want = s.lhs.length, vals = this.evalMulti(s.rhs, want, false);
        s.lhs.forEach((l, i) => { if (l && vals[i] === undefined) fail(vals.length ? 'Too many output arguments.' : 'Insufficient number of outputs from right hand side of equal sign to satisfy assignment.', 'MATLAB:TooManyOutputs'); });
        s.lhs.forEach((l, i) => { if (l && vals[i] !== undefined) { this.assign(l, vals[i]); } });
        if (s.print) s.lhs.forEach(l => { if (l) { const nm = rootName(l); this.display(nm, this.getVar(nm)); } });
        return;
      }
      const lhs = s.lhs[0];
      let v;
      if (s.rhs.t === 'cellindex' || (s.rhs.t === 'field')) { const vs = this.evalMulti(s.rhs, 1, false); if (!vs.length) fail('Insufficient number of outputs from right hand side of equal sign to satisfy assignment.'); v = vs[0]; }
      else v = this.eval(s.rhs);
      if (v === undefined) fail('Insufficient number of outputs from right hand side of equal sign to satisfy assignment.');
      this.assign(lhs, v);
      if (s.print) { const nm = rootName(lhs); this.display(nm, this.getVar(nm)); }
    }
    s_if(s) {
      for (const c of s.clauses) if (this.truthy(this.eval(c.cond))) return this.execBlock(c.body);
      if (s.els) this.execBlock(s.els);
    }
    s_for(s) {
      const v = this.eval(s.e);
      const loop = item => { this.tick(); this.setVar(s.name, item); try { this.execBlock(s.body); } catch (e) { if (e === BREAK) return false; if (e !== CONTINUE) throw e; } return true; };
      if (isNum(v)) {
        if (v.r === 1 && !v.im && v.cls === 'double') { for (let j = 0; j < v.c; j++) if (!loop(num(v.re[j]))) break; return; }
        if (!v.n) return;
        for (let j = 0; j < v.c; j++) if (!loop(this.idxRead(v, [{ colon: true }, num(j + 1)]))) break;
      } else if (v.type === 'cell') { for (let j = 0; j < v.c; j++) if (!loop(this.cellIdx(v, [{ colon: true }, num(j + 1)]))) break; }
      else loop(v);
    }
    s_while(s) {
      while (this.truthy(this.eval(s.cond))) {
        this.tick();
        try { this.execBlock(s.body); } catch (e) { if (e === BREAK) break; if (e !== CONTINUE) throw e; }
      }
    }
    s_dountil(s) {
      do { this.tick(); try { this.execBlock(s.body); } catch (e) { if (e === BREAK) break; if (e !== CONTINUE) throw e; } } while (!this.truthy(this.eval(s.cond)));
    }
    s_switch(s) {
      const v = this.eval(s.e);
      const match = c => {
        if (c.type === 'cell') return c.data.some(match);
        if (isNum(v) && v.cls === 'char') return isNum(c) && c.cls === 'char' && M.toStr(c) === M.toStr(v);
        if (isNum(v) && isNum(c) && c.cls !== 'char') return v.n && c.n && v.re[0] === c.re[0];
        return false;
      };
      for (const c of s.cases) if (match(this.eval(c.val))) return this.execBlock(c.body);
      if (s.other) this.execBlock(s.other);
    }
    s_try(s) {
      const depth = this.frames.length;
      const td = this.tryDepth || 0; this.tryDepth = td + 1;
      try { this.execBlock(s.body); this.tryDepth = td; }
      catch (e) {
        this.tryDepth = td;
        if (e instanceof Signal) throw e;
        if (e.interrupt) throw e;
        this.frames.length = depth;
        if (s.id) this.setVar(s.id, errStruct(e));
        this.execBlock(s.cbody);
      }
    }
    s_break() { throw BREAK; }
    s_continue() { throw CONTINUE; }
    s_return() { throw RETURN; }
    s_global(s) { for (const n of s.names) { this.frame.globalNames.add(n); if (!this.globals.has(n)) this.globals.set(n, M.empty()); } }
    s_persistent(s) {
      const f = this.frame; if (!f.def) return; f.def.persist = f.def.persist || new Map();
      for (const n of s.names) { if (!f.def.persist.has(n)) f.def.persist.set(n, M.empty()); f.persistNames.add(n); f.scope.set(n, f.def.persist.get(n)); }
    }

    truthy(v) {
      if (isNum(v)) { if (!v.n) return false; for (let k = 0; k < v.n; k++) { if (v.re[k] === 0 && !(v.im && v.im[k] !== 0)) return false; if (Number.isNaN(v.re[k])) fail("NaN's cannot be converted to logicals."); } return true; }
      fail(`Conversion to logical from ${clsOf(v)} is not possible.`);
    }

    // ----- expressions -----
    eval(e) {
      switch (e.t) {
        case 'num': return e.imag ? new Mat(1, 1, Float64Array.of(0), Float64Array.of(e.v)) : num(e.v);
        case 'str': return str(e.v);
        case 'paren': { const v = this.evalMulti(e.e, 1, false); if (!v.length) fail('Expression produced no value.'); return v[0]; }
        case 'id': {
          const v = this.getVar(e.name);
          if (v !== undefined) { v._sh = true; return v; }
          const r = this.call(e.name, [], 1); if (!r.length || r[0] === undefined) fail(`Value expected: ${e.name} did not return a value.`); return r[0];
        }
        case 'bin': return this.binop(e);
        case 'un': { const a = this.eval(e.a); if (e.op === '-') return M.neg(toNum(a, '-')); if (e.op === '~') return M.not(toNum(a, '~')); return a; }
        case 'post': { const a = toNum(this.eval(e.a), "'"); return M.transpose(a, e.op === "'"); }
        case 'range': return this.range(e);
        case 'matrix': return this.matrix(e);
        case 'cell': return this.cellLit(e);
        case 'anon': return this.makeAnon(e);
        case 'handle': return new Func({ name: e.name, funcs: this.frame.funcs });
        case 'colon': return str(':');
        case 'end': fail("'end' is only valid inside an index.");
        case 'index': case 'cellindex': case 'field': case 'dynfield': {
          const v = this.evalMulti(e, 1, false);
          if (!v.length || v[0] === undefined) fail(e.t === 'cellindex' ? 'The cell index produced no value.' : 'Expression produced no value.');
          return v[0];
        }
      }
      fail('Unsupported expression ' + e.t);
    }
    binop(e) {
      if (e.op === '&&' || e.op === '||') {
        const a = this.eval(e.a); const ta = this.scalarLogical(a, e.op);
        if (e.op === '&&' ? !ta : ta) return M.bool(ta);
        return M.bool(this.scalarLogical(this.eval(e.b), e.op));
      }
      const a = toNum(this.eval(e.a), e.op), b = toNum(this.eval(e.b), e.op);
      switch (e.op) {
        case '+': return M.plus(a, b); case '-': return M.minus(a, b);
        case '.*': return M.times(a, b); case './': return M.rdivide(a, b); case '.\\': return M.ldivide(a, b); case '.^': return M.power(a, b);
        case '*': return M.mtimes(a, b);
        case '/': return b.n === 1 ? M.rdivide(a, b) : this.callB('mrdivide', [a, b]);
        case '\\': return a.n === 1 ? M.ldivide(a, b) : this.callB('mldivide', [a, b]);
        case '^': return a.n === 1 && b.n === 1 ? M.power(a, b) : this.callB('mpower', [a, b]);
        case '==': return M.eq(a, b); case '~=': return M.ne(a, b);
        case '<': return M.lt(a, b); case '<=': return M.le(a, b); case '>': return M.gt(a, b); case '>=': return M.ge(a, b);
        case '&': return M.and(a, b); case '|': return M.or(a, b);
      }
      fail('Unknown operator ' + e.op);
    }
    scalarLogical(v, op) {
      if (!isNum(v) || v.n !== 1) { if (isNum(v) && v.n === 0) fail(`Invalid operand for ${op}: the value is empty.`); fail(`Operands to the ${op} operator must be convertible to logical scalar values. Use the ${op[0]} operator for arrays.`, 'MATLAB:nonLogicalConditional'); }
      return v.re[0] !== 0 || !!(v.im && v.im[0] !== 0);
    }
    callB(name, args) { const r = this.lib[name](args, 1, this); return Array.isArray(r) ? r[0] : r; }
    range(e) {
      const a = scal(this.eval(e.a), 'colon'), step = e.step ? scal(this.eval(e.step), 'colon') : 1, b = scal(this.eval(e.b), 'colon');
      return colon(a, step, b);
    }
    matrix(e) {
      const rows = [];
      for (const r of e.rows) {
        const items = [];
        for (const x of r) for (const v of this.evalMulti(x, 1, false, true)) items.push(v);
        if (items.some(v => v.type === 'cell')) rows.push(cellCat(items.map(v => v.type === 'cell' ? v : new Cell(1, 1, [v])), 'h'));
        else if (items.some(v => v.type === 'struct' || v.type === 'func')) { if (items.length === 1) rows.push(items[0]); else fail('Concatenation of structs and function handles is not supported.'); }
        else rows.push(M.hcat(items.map(v => toNum(v, '[]'))));
      }
      if (rows.length === 1) return rows[0];
      if (rows.some(v => v.type === 'cell')) return cellCat(rows.map(v => v.type === 'cell' ? v : new Cell(1, 1, [v])), 'v');
      return M.vcat(rows);
    }
    cellLit(e) {
      const rows = [];
      for (const r of e.rows) {
        const items = [];
        for (const x of r) for (const v of this.evalMulti(x, 1, false, true)) items.push(v.type === 'cell' && x.t === 'cell' ? v : (v.type === 'cell' ? v : new Cell(1, 1, [v])));
        rows.push(cellCat(items, 'h'));
      }
      if (!rows.length) return new Cell(0, 0, []);
      return rows.length === 1 ? rows[0] : cellCat(rows, 'v');
    }
    makeAnon(e) {
      // capture the variables the body uses, by value (as MATLAB does)
      const cap = new Map(), params = new Set(e.params);
      const walk = n => {
        if (!n || typeof n !== 'object') return;
        if (n.t === 'id' && !params.has(n.name)) { const v = this.getVar(n.name); if (v !== undefined) { v._sh = true; cap.set(n.name, v); } }
        if (n.t === 'anon') { const inner = new Set(n.params); const w2 = m => { if (!m || typeof m !== 'object') return; if (m.t === 'id' && !params.has(m.name) && !inner.has(m.name)) { const v = this.getVar(m.name); if (v !== undefined) cap.set(m.name, v); } for (const k in m) if (k !== 't') { const c = m[k]; if (Array.isArray(c)) c.forEach(x => Array.isArray(x) ? x.forEach(w2) : w2(x)); else if (c && typeof c === 'object') w2(c); } }; w2(n.body); return; }
        for (const k in n) if (k !== 't') { const c = n[k]; if (Array.isArray(c)) c.forEach(x => Array.isArray(x) ? x.forEach(walk) : walk(x)); else if (c && typeof c === 'object') walk(c); }
      };
      walk(e.body);
      return new Func({ params: e.params, body: e.body, closure: cap, funcs: this.frame.funcs });
    }

    // evaluate an expression that may yield several values (function call outputs, c{:}, s.f lists)
    // stmt: statement level (nargout 0); spread: allow cs-list expansion inside [] / args
    evalMulti(e, nargout, stmt, spread) {
      if (e.t === 'id') {
        const v = this.getVar(e.name);
        if (v !== undefined) { v._sh = true; return [v]; }
        return this.call(e.name, [], stmt ? 0 : nargout);
      }
      if (e.t === 'index' && e.obj.t === 'id' && !this.hasVar(e.obj.name)) {
        // function call
        const args = this.evalArgs(e.args);
        return this.call(e.obj.name, args, stmt ? 0 : nargout);
      }
      if (e.t === 'index' || e.t === 'cellindex' || e.t === 'field' || e.t === 'dynfield') {
        // chained access: evaluate the base, then apply this step
        let baseVals;
        if (e.obj.t === 'id' && this.hasVar(e.obj.name)) baseVals = [this.getVar(e.obj.name)];
        else baseVals = this.evalMulti(e.obj, 1, false);
        if (!baseVals.length) fail('Expression produced no value.');
        const base = baseVals[0];
        if (e.t === 'index') {
          if (base.type === 'func') { const args = this.evalArgs(e.args); return this.callFunc(base, args, stmt ? 0 : nargout); }
          const args = this.evalIndexArgs(e.args, base);
          if (base.type === 'cell') return [this.cellIdx(base, args)];
          if (base.type === 'struct') { if (args.every(a => a.colon || (isNum(a) && a.n === 1 && a.re[0] === 1))) return [base]; fail('Index exceeds the number of array elements (1).'); }
          if (base.type === 'num') return [this.idxRead(base, args)];
          fail(`Cannot index into a ${clsOf(base)}.`);
        }
        if (e.t === 'cellindex') {
          if (base.type !== 'cell') fail(`Brace indexing is not supported for variables of this type (${clsOf(base)}).`, 'MATLAB:cellRefFromNonCell');
          const args = this.evalIndexArgs(e.args, base), sub = this.cellIdx(base, args);
          sub.data.forEach(v => { v._sh = true; });
          return spread || sub.n <= 1 ? sub.data.slice() : sub.data.slice(0, Math.max(1, nargout));
        }
        const fname = e.t === 'field' ? e.name : M.toStr(toNum(this.eval(e.e), '.()'));
        if (base.type !== 'struct') {
          if (base.type === 'func' || base.type === 'num' && base.cls === 'char') fail(`Dot indexing is not supported for variables of this type.`, 'MATLAB:structRefFromNonStruct');
          fail(`Dot indexing is not supported for variables of this type.`, 'MATLAB:structRefFromNonStruct');
        }
        if (!base.f.has(fname)) fail(`Unrecognized field name "${fname}".`, 'MATLAB:nonExistentField');
        const v = base.f.get(fname); v._sh = true; return [v];
      }
      return [this.eval(e)];
    }
    evalArgs(nodes) {
      const out = [];
      for (const a of nodes) {
        if (a.t === 'colon') { out.push(str(':')); continue; }
        if (a.t === 'cellindex') { for (const v of this.evalMulti(a, 1, false, true)) out.push(v); continue; }
        const v = this.evalMulti(a, 1, false); if (!v.length || v[0] === undefined) fail('Function argument produced no value.'); out.push(v[0]);
      }
      return out;
    }
    // index arguments with 'end' bound to the indexed value's size
    evalIndexArgs(nodes, base) {
      const out = [], n = nodes.length;
      for (let k = 0; k < n; k++) {
        const a = nodes[k];
        if (a.t === 'colon') { out.push({ colon: true }); continue; }
        if (a.t === 'str' && a.v === ':' ) { out.push({ colon: true }); continue; }
        const endVal = n === 1 ? base.n : k === 0 ? base.r : k === 1 ? (n === 2 ? base.c : base.c) : 1;
        const saved = this.endVal; this.endVal = endVal;
        try { out.push(this.evalIdx(a)); } finally { this.endVal = saved; }
      }
      return out;
    }
    evalIdx(a) {
      if (a.t === 'end') return num(this.endVal);
      if (!hasEnd(a)) return this.eval(a);
      // evaluate with 'end' substituted (handles end inside ranges and arithmetic)
      const sub = n => {
        if (n.t === 'end') return { t: 'num', v: this.endVal };
        if (n.t === 'index' || n.t === 'cellindex') return Object.assign({}, n, { obj: sub(n.obj) }); // inner end belongs to the inner index
        const o = {}; for (const k in n) { const c = n[k]; o[k] = Array.isArray(c) ? c.map(x => Array.isArray(x) ? x.map(sub) : (x && typeof x === 'object' ? sub(x) : x)) : (c && typeof c === 'object' ? sub(c) : c); } return o;
      };
      return this.eval(sub(a));
    }

    // ----- indexing -----
    idxList(arg, len, pos, grow) { // → Int32Array of 0-based indices
      if (arg.colon) { const r = new Int32Array(len); for (let i = 0; i < len; i++) r[i] = i; return r; }
      if (arg.type !== 'num') fail(`Array indices must be positive integers or logical values.`, 'MATLAB:badsubscript');
      if (arg.cls === 'logical') {
        let cnt = 0; for (let k = 0; k < arg.n; k++) if (arg.re[k]) { cnt++; if (k >= len && !grow) fail(`The logical indices contain a true value outside of the array bounds.`, 'MATLAB:badsubscript'); }
        const r = new Int32Array(cnt); let j = 0; for (let k = 0; k < arg.n; k++) if (arg.re[k]) r[j++] = k; return r;
      }
      if (arg.cls === 'char' && arg.n === 1 && arg.re[0] === 58) return this.idxList({ colon: true }, len);
      const r = new Int32Array(arg.n);
      for (let k = 0; k < arg.n; k++) {
        const v = arg.re[k];
        if (!(v >= 1) || v !== Math.floor(v)) fail(v === 0 ? 'Index in position ' + (pos || 1) + ' is invalid. Array indices must be positive integers or logical values.' : `Array indices must be positive integers or logical values.`, 'MATLAB:badsubscript');
        r[k] = v - 1;
      }
      return r;
    }
    idxRead(A, args) {
      if (args.length === 1) {
        const a = args[0], N = A.n, ix = this.idxList(a, N, 1);
        for (let k = 0; k < ix.length; k++) if (ix[k] >= N) fail(`Index exceeds the number of array elements. Index must not exceed ${N}.`, 'MATLAB:badsubscript');
        let r, c;
        if (a.colon) { r = N; c = 1; }
        else if (a.cls === 'logical') { if (A.r === 1 && (a.r === 1 || A.n === a.n)) { r = 1; c = ix.length; } else if (a.r === 1 && A.r !== 1 && A.c !== 1) { r = 1; c = ix.length; } else { r = ix.length; c = 1; } }
        else if ((A.r === 1 || A.c === 1) && (a.r === 1 || a.c === 1)) { if (A.r === 1 && A.n >= 1 && !(A.n === 1 && a.c === 1 && a.r > 1)) { r = 1; c = ix.length; } else { r = ix.length; c = 1; } }
        else { r = a.r; c = a.c; }
        const o = new Mat(r, c, null, A.im ? new Float64Array(r * c) : null, A.cls);
        for (let k = 0; k < ix.length; k++) { o.re[k] = A.re[ix[k]]; if (A.im) o.im[k] = A.im[ix[k]]; }
        return A.im ? M.narrow(o) : o;
      }
      for (let k = 2; k < args.length; k++) { const x = args[k]; if (!x.colon && !(isNum(x) && x.n === 1 && x.re[0] === 1)) fail(`Index in position ${k + 1} exceeds array bounds (must not exceed 1).`, 'MATLAB:badsubscript'); }
      const ri = this.idxList(args[0], A.r, 1), ci = this.idxList(args[1], A.c, 2);
      for (const i of ri) if (i >= A.r) fail(`Index in position 1 exceeds array bounds. Index must not exceed ${A.r}.`, 'MATLAB:badsubscript');
      for (const j of ci) if (j >= A.c) fail(`Index in position 2 exceeds array bounds. Index must not exceed ${A.c}.`, 'MATLAB:badsubscript');
      const o = new Mat(ri.length, ci.length, null, A.im ? new Float64Array(ri.length * ci.length) : null, A.cls);
      for (let j = 0; j < ci.length; j++) for (let i = 0; i < ri.length; i++) { const s = ri[i] + ci[j] * A.r, d = i + j * ri.length; o.re[d] = A.re[s]; if (A.im) o.im[d] = A.im[s]; }
      return A.im ? M.narrow(o) : o;
    }
    cellIdx(C, args) { // parenthesis indexing on a cell → cell
      const proxy = new Mat(C.r, C.c); for (let k = 0; k < C.n; k++) proxy.re[k] = k;
      const sel = this.idxRead(proxy, args.map(a => a.colon ? a : a));
      return new Cell(sel.r, sel.c, Array.from(sel.re, k => C.data[k]));
    }

    // ----- assignment -----
    assign(lhs, val) {
      if (lhs.t === 'id') { this.setVar(lhs.name, val); return; }
      const cur = this.lvalueCurrent(lhs.obj);
      const upd = this.setIn(cur, lhs, val);
      this.assign(lhs.obj, upd);
    }
    lvalueCurrent(e) { // current value at an assignment path (undefined if it doesn't exist yet)
      if (e.t === 'id') return this.getVar(e.name);
      const b = this.lvalueCurrent(e.obj); if (b === undefined) return undefined;
      if (e.t === 'field' || e.t === 'dynfield') { if (b.type !== 'struct') return undefined; const nm = e.t === 'field' ? e.name : M.toStr(toNum(this.eval(e.e))); return b.f.get(nm); }
      if (e.t === 'cellindex') {
        if (b.type !== 'cell') return undefined;
        const args = this.evalIndexArgs(e.args, b);
        try { const sub = this.cellIdx(b, args); return sub.n === 1 ? sub.data[0] : undefined; } catch (x) { return undefined; }
      }
      if (e.t === 'index') { // struct arrays are not supported: s(1).x works for scalar s
        if (b.type === 'struct') return b;
        fail('Nested parenthesis indexing on the left side of an assignment is not supported here.');
      }
    }
    setIn(cur, lhs, val) {
      if (cur && cur._sh) cur = cloneShallow(cur);
      if (lhs.t === 'field' || lhs.t === 'dynfield') {
        const nm = lhs.t === 'field' ? lhs.name : M.toStr(toNum(this.eval(lhs.e)));
        if (cur === undefined || (isNum(cur) && cur.n === 0)) cur = new Struct();
        if (cur.type !== 'struct') fail('Unable to perform assignment because dot indexing is not supported for variables of this type.');
        cur.f.set(nm, val); return cur;
      }
      if (lhs.t === 'cellindex') {
        if (cur === undefined || (isNum(cur) && cur.n === 0)) cur = new Cell(0, 0, []);
        if (cur.type !== 'cell') fail('Unable to perform assignment because brace indexing is not supported for variables of this type.', 'MATLAB:cellAssToNonCell');
        const args = this.evalIndexArgs(lhs.args, cur);
        return this.cellAssign(cur, args, [val]);
      }
      // parenthesis
      if (cur === undefined) cur = val.type === 'cell' ? new Cell(0, 0, []) : val.type === 'struct' ? undefined : new Mat(0, 0, null, null, isNum(val) ? val.cls : 'double');
      if (cur === undefined) { const args = this.evalIndexArgs(lhs.args, { n: 1, r: 1, c: 1 }); if (args.every(a => a.colon || (isNum(a) && a.n === 1 && a.re[0] === 1))) return val; fail('Struct arrays are not supported in Lumen Lab.'); }
      const args = this.evalIndexArgs(lhs.args, cur);
      if (cur.type === 'struct') { if (args.every(a => a.colon || (isNum(a) && a.n === 1 && a.re[0] === 1))) return val; fail('Struct arrays are not supported in Lumen Lab.'); }
      if (cur.type === 'cell') {
        if (isNum(val) && val.n === 0 && val.r === 0 && val.cls === 'double') return this.deleteElems(cur, args);
        if (val.type !== 'cell') fail('Conversion to cell from ' + clsOf(val) + ' is not possible. Use braces {} to put values into a cell.');
        return this.cellAssign(cur, args, val.data, val);
      }
      if (cur.type !== 'num') fail(`Unable to index into a ${clsOf(cur)}.`);
      if (isNum(val) && val.n === 0 && val.r === 0 && val.c === 0 && val.cls === 'double') return this.deleteElems(cur, args);
      if (!isNum(val)) fail(`Conversion to ${cur.cls} from ${clsOf(val)} is not possible.`);
      return this.matAssign(cur, args, val);
    }
    // grow-aware target index computation shared by numeric and cell assignment
    targetIndices(cur, args, count) {
      if (args.length === 1) {
        const a = args[0], ix = this.idxList(a, cur.n, 1, true);
        let need = 0; for (const k of ix) need = Math.max(need, k + 1);
        let r = cur.r, c = cur.c;
        if (need > cur.n) {
          if (cur.n === 0 && cur.r <= 1 && cur.c <= 1) { r = 1; c = need; if (a.type === 'num' && a.c === 1 && a.r > 1) { r = need; c = 1; } }
          else if (cur.r === 1) c = need; else if (cur.c === 1) r = need;
          else if (cur.r === 0 || cur.c === 0) { r = 1; c = need; }
          else fail(`Attempt to grow array along ambiguous dimension.`, 'MATLAB:indexed_matrix_cannot_be_resized');
        }
        return { r, c, lin: ix };
      }
      for (let k = 2; k < args.length; k++) { const x = args[k]; if (!x.colon && !(isNum(x) && x.n === 1 && x.re[0] === 1)) fail('Lumen Lab supports only two-dimensional arrays.'); }
      const [a0, a1] = args;
      let ri = a0.colon ? null : this.idxList(a0, cur.r, 1, true), ci = a1.colon ? null : this.idxList(a1, cur.c, 2, true);
      let r = cur.r, c = cur.c;
      if (ri) for (const i of ri) r = Math.max(r, i + 1);
      if (ci) for (const j of ci) c = Math.max(c, j + 1);
      // A(:, j) = v on an empty A takes its height from v
      if (!ri && cur.r === 0) { r = ci ? Math.max(1, Math.round(count / ci.length)) : count; }
      if (!ci && cur.c === 0) { c = ri ? Math.max(1, Math.round(count / ri.length)) : count; }
      if (!ri) ri = Int32Array.from({ length: r }, (_, i) => i);
      if (!ci) ci = Int32Array.from({ length: c }, (_, j) => j);
      const lin = new Int32Array(ri.length * ci.length);
      for (let j = 0; j < ci.length; j++) for (let i = 0; i < ri.length; i++) lin[i + j * ri.length] = ri[i] + ci[j] * r;
      return { r, c, lin, rows: ri.length, cols: ci.length };
    }
    matAssign(cur, args, val) {
      const t = this.targetIndices(cur, args, val.n), cnt = t.lin.length;
      if (val.n !== 1 && val.n !== cnt) {
        if (t.rows !== undefined) fail(`Unable to perform assignment because the size of the left side is ${t.rows}-by-${t.cols} and the size of the right side is ${val.r}-by-${val.c}.`, 'MATLAB:subsassigndimmismatch');
        fail(`Unable to perform assignment because the left and right sides have a different number of elements (${cnt} and ${val.n}).`, 'MATLAB:index_assign_element_count_mismatch');
      }
      let A = cur;
      const cls = cur.n === 0 ? val.cls : (cur.cls === val.cls ? cur.cls : cur.cls === 'char' && val.cls !== 'char' ? 'double' : cur.cls === 'logical' ? (val.cls === 'logical' ? 'logical' : 'double') : cur.cls);
      if (t.r !== cur.r || t.c !== cur.c) { // grow, keeping existing elements in place
        A = new Mat(t.r, t.c, null, cur.im ? new Float64Array(t.r * t.c) : null, cls);
        for (let j = 0; j < cur.c; j++) for (let i = 0; i < cur.r; i++) { A.re[i + j * t.r] = cur.re[i + j * cur.r]; if (cur.im) A.im[i + j * t.r] = cur.im[i + j * cur.r]; }
      } else if (cls !== cur.cls) { A = new Mat(cur.r, cur.c, cur.re, cur.im, cls); }
      if (val.im && !A.im) A.im = new Float64Array(A.n);
      if (val.n === 1) { const x = val.re[0], y = val.im ? val.im[0] : 0; for (let k = 0; k < cnt; k++) { A.re[t.lin[k]] = x; if (A.im) A.im[t.lin[k]] = y; } }
      else for (let k = 0; k < cnt; k++) { A.re[t.lin[k]] = val.re[k]; if (A.im) A.im[t.lin[k]] = val.im ? val.im[k] : 0; }
      if (A.im) M.narrow(A);
      A._sh = false; return A;
    }
    cellAssign(cur, args, vals, src) {
      const t = this.targetIndices(cur, args, vals.length), cnt = t.lin.length;
      if (vals.length !== 1 && vals.length !== cnt) fail(`Unable to perform assignment because the left and right sides have a different number of elements.`);
      let C = cur;
      if (t.r !== cur.r || t.c !== cur.c) {
        C = new Cell(t.r, t.c);
        for (let j = 0; j < cur.c; j++) for (let i = 0; i < cur.r; i++) C.data[i + j * t.r] = cur.data[i + j * cur.r];
      }
      for (let k = 0; k < cnt; k++) C.data[t.lin[k]] = vals.length === 1 ? vals[0] : vals[k];
      void src; C._sh = false; return C;
    }
    deleteElems(cur, args) {
      const isCell = cur.type === 'cell', get = k => isCell ? cur.data[k] : k;
      if (args.length === 1) {
        const del = new Set(this.idxList(args[0], cur.n)); for (const k of del) if (k >= cur.n) fail('Matrix index is out of range for deletion.');
        const keep = []; for (let k = 0; k < cur.n; k++) if (!del.has(k)) keep.push(k);
        const col = cur.c === 1 && cur.r !== 1;
        const [r, c] = col ? [keep.length, 1] : [keep.length ? 1 : (args[0].colon ? 0 : 1), keep.length];
        if (isCell) return new Cell(r, c, keep.map(get));
        const o = new Mat(r, c, null, cur.im ? new Float64Array(keep.length) : null, cur.cls); keep.forEach((k, i) => { o.re[i] = cur.re[k]; if (cur.im) o.im[i] = cur.im[k]; }); return o;
      }
      const [a0, a1] = args, all0 = a0.colon || covers(this.idxList(a0, cur.r), cur.r), all1 = a1.colon || covers(this.idxList(a1, cur.c), cur.c);
      let rk = [...Array(cur.r).keys()], ck = [...Array(cur.c).keys()];
      if (all0) { const d = new Set(a1.colon ? ck : this.idxList(a1, cur.c)); ck = ck.filter(j => !d.has(j)); }
      else if (all1) { const d = new Set(this.idxList(a0, cur.r)); rk = rk.filter(i => !d.has(i)); }
      else fail('A null assignment can have only one non-colon index.', 'MATLAB:nullAssignmentNonColon');
      if (isCell) { const C = new Cell(rk.length, ck.length); ck.forEach((j, jj) => rk.forEach((i, ii) => { C.data[ii + jj * rk.length] = cur.data[i + j * cur.r]; })); return C; }
      const o = new Mat(rk.length, ck.length, null, cur.im ? new Float64Array(rk.length * ck.length) : null, cur.cls);
      ck.forEach((j, jj) => rk.forEach((i, ii) => { o.re[ii + jj * rk.length] = cur.re[i + j * cur.r]; if (cur.im) o.im[ii + jj * rk.length] = cur.im[i + j * cur.r]; }));
      return o;
    }

    // ----- functions -----
    findUser(name) {
      const f = this.frame;
      if (f.funcs && f.funcs.has(name)) { const x = f.funcs.get(name); return x.def ? x : { def: x, file: f.file, funcs: f.funcs }; }
      if (this.frames[0].funcs.has(name)) return this.frames[0].funcs.get(name);
      const text = this.files.get(name + '.m');
      if (text !== undefined) {
        const ast = this.parseCached(text, name + '.m');
        if (!ast.funcs.length || ast.body.length) return { script: ast, file: name };
        const funcs = new Map(ast.funcs.map(x => [x.name, x]));
        return { def: ast.funcs[0], file: name, funcs };
      }
      return null;
    }
    hasFunction(name) { return !!(this.lib[name] || this.findUser(name)); }
    call(name, args, nargout) {
      const u = this.findUser(name);
      if (u) {
        if (u.script) { if (args.length) fail(`Attempt to execute SCRIPT ${name} as a function.`); this.runScript(u.script, name); return []; }
        return this.callUser(u, args, nargout);
      }
      const b = this.lib[name];
      if (b) {
        this.tick();
        if (this.prof && this.prof.on && !b.noProfile) { const p = this.prof.enter(name, 'built-in'); try { const r = b(args, nargout, this); return r === undefined ? [] : Array.isArray(r) ? r : [r]; } finally { this.prof.leave(p); } }
        const r = b(args, nargout, this);
        return r === undefined ? [] : Array.isArray(r) ? r : [r];
      }
      fail(`Unrecognized function or variable '${name}'.`, 'MATLAB:UndefinedFunction');
    }
    runScript(ast, name) {
      const f = this.frame, saved = f.funcs, savedName = f.name, savedSrc = f.src;
      if (ast.funcs.length) f.funcs = new Map([...saved, ...ast.funcs.map(x => [x.name, { def: x, file: name, funcs: new Map(ast.funcs.map(y => [y.name, y])) }])]);
      f.name = name; f.src = name;
      const prof = this.prof && this.prof.on ? this.prof.enter(name, 'script', name) : null;
      try { this.execBlock(ast.body); } catch (e) { if (e !== RETURN) throw e; } finally { if (prof) this.prof.leave(prof); f.funcs = saved; f.name = savedName; f.src = savedSrc; }
    }
    callUser(u, args, nargout) {
      const d = u.def;
      const nparams = d.params.length, hasVarargin = nparams && d.params[nparams - 1] === 'varargin';
      if (args.length > nparams && !hasVarargin) fail(`Too many input arguments.`, 'MATLAB:TooManyInputs');
      const nOut = d.outs.length, hasVarargout = nOut && d.outs[nOut - 1] === 'varargout';
      if (nargout > nOut && !hasVarargout) fail(`Too many output arguments.`, 'MATLAB:TooManyOutputs');
      if (this.depth > 400) fail('Maximum recursion limit of 400 reached.', 'MATLAB:recursionLimit');
      const scope = new Map();
      const fixed = hasVarargin ? nparams - 1 : nparams;
      for (let i = 0; i < Math.min(fixed, args.length); i++) if (d.params[i] !== '~') scope.set(d.params[i], args[i]);
      if (hasVarargin) { const rest = args.slice(fixed); scope.set('varargin', new Cell(1, rest.length, rest)); }
      const frame = { scope, name: d.name, funcs: u.funcs || new Map(), file: u.file, src: u.file, globalNames: new Set(), nargin: args.length, nargout, def: d, persistNames: new Set() };
      this.frames.push(frame); this.depth++;
      const prof = this.prof && this.prof.on ? this.prof.enter(d.name === u.file || !u.file ? d.name : `${u.file}>${d.name}`, 'function', u.file) : null;
      try { this.execBlock(d.body); }
      catch (e) { if (e !== RETURN) { if (e instanceof Signal) fail('A BREAK or CONTINUE statement is outside a loop.'); throw e; } }
      finally {
        if (prof) this.prof.leave(prof);
        this.depth--; this.frames.pop();
        if (d.persist) for (const n of frame.persistNames) d.persist.set(n, scope.get(n));
      }
      const outs = [];
      const fixedOut = hasVarargout ? nOut - 1 : nOut;
      for (let i = 0; i < fixedOut; i++) {
        const v = scope.get(d.outs[i]);
        if (v === undefined) { if (i < nargout) fail(`Output argument "${d.outs[i]}" (and possibly others) not assigned a value in the execution with "${d.name}" function.`, 'MATLAB:unassignedOutputs'); break; }
        outs.push(v);
      }
      if (hasVarargout && outs.length === fixedOut) { const vo = scope.get('varargout'); if (vo && vo.type === 'cell') outs.push(...vo.data); }
      return outs;
    }
    callFunc(f, args, nargout) {
      if (typeof f === 'string') return this.call(f, args, nargout);
      if (f.type !== 'func') fail('Expected a function handle.');
      if (f.js) return [f.js(...args)];
      if (f.name) {
        if (f.funcs && f.funcs.has(f.name)) { const x = f.funcs.get(f.name); return this.callUser(x.def ? x : { def: x, funcs: f.funcs }, args, nargout); }
        return this.call(f.name, args, nargout);
      }
      if (args.length > f.params.length && f.params[f.params.length - 1] !== 'varargin') fail('Too many input arguments.', 'MATLAB:TooManyInputs');
      const scope = new Map(f.closure);
      f.params.forEach((p, i) => { if (p === 'varargin') scope.set(p, new Cell(1, Math.max(0, args.length - i), args.slice(i))); else if (i < args.length && p !== '~') scope.set(p, args[i]); });
      if (this.depth > 400) fail('Maximum recursion limit of 400 reached.', 'MATLAB:recursionLimit');
      this.frames.push({ scope, name: 'anonymous function', funcs: f.funcs || new Map(), globalNames: new Set(), nargin: args.length, nargout }); this.depth++;
      const prof = this.prof && this.prof.on ? this.prof.enter(f._profName || (f._profName = (s => s.length > 48 ? s.slice(0, 47) + '…' : s)(f.src)), 'anonymous') : null;
      try { return this.evalMulti(f.body, Math.max(1, nargout), false); }
      finally { if (prof) this.prof.leave(prof); this.depth--; this.frames.pop(); }
    }
    // call a function value and return its first output (for library functions like ode45 / fzero)
    fcall(f, args) { const r = this.callFunc(f, args, 1); if (!r.length || r[0] === undefined) fail('The function did not return a value.'); return r[0]; }

    // evaluate text as an expression in the current workspace (eval with outputs, str2num, input)
    evalString(code) {
      const ast = Lang.parse(code);
      if (ast.body.length !== 1 || ast.body[0].t !== 'expr') fail('The text is not a single expression.');
      const v = this.evalMulti(ast.body[0].e, 1, false); if (!v.length) fail('The expression produced no value.'); return v[0];
    }
    evalHere(code) { const ast = Lang.parse(code); this.execBlock(ast.body); }

    // ----- display -----
    display(name, v) { this.print(this.displayText(name, v)); }
    displayText(name, v) {
      const width = this.width || 100;
      if (v.type === 'num') {
        if (v.cls === 'char' && v.r <= 1) return `${name} = '${M.toStr(v)}'\n`;
        if (v.n === 0) return v.r === 0 && v.c === 0 ? `${name} =\n     []\n` : `${name} =\n  ${v.r}×${v.c} empty ${v.cls} ${v.r === 1 ? 'row vector' : v.c === 1 ? 'column vector' : 'matrix'}\n`;
        if (v.n === 1) return `${name} = ${M.scalarText(v.re[0], v.im ? v.im[0] : null)}\n`;
        const L = M.matrixLines(v);
        let s = `${name} =\n`;
        if (v.cls === 'logical') s += `  ${v.r}×${v.c} logical array\n\n`;
        if (L.head) s += L.head + '\n\n';
        if (v.cls === 'char' || !L.cellW || L.rows[0].length <= width) return s + L.rows.join('\n') + '\n\n';
        const per = Math.max(1, Math.floor(width / L.cellW));
        for (let c0 = 0; c0 < v.c; c0 += per) {
          const c1 = Math.min(v.c, c0 + per);
          s += c1 - c0 === 1 ? `  Column ${c0 + 1}\n\n` : `  Columns ${c0 + 1} through ${c1}\n\n`;
          s += L.rows.map(r => r.slice(c0 * L.cellW, c1 * L.cellW)).join('\n') + '\n\n';
        }
        return s;
      }
      if (v.type === 'cell') {
        if (!v.n) return `${name} =\n  ${v.r}×${v.c} empty cell array\n`;
        const cells = v.data.map(x => `{${shortText(x, true)}}`), w = [];
        for (let j = 0; j < v.c; j++) { let m = 0; for (let i = 0; i < v.r; i++) m = Math.max(m, cells[i + j * v.r].length); w.push(m); }
        let s = `${name} =\n  ${v.r}×${v.c} cell array\n`;
        for (let i = 0; i < v.r; i++) { let line = '  '; for (let j = 0; j < v.c; j++) line += (j ? '    ' : '  ') + cells[i + j * v.r].padEnd(w[j]); s += line.replace(/\s+$/, '') + '\n'; }
        return s + '\n';
      }
      if (v.type === 'struct') {
        const keys = [...v.f.keys()], w = Math.max(0, ...keys.map(k => k.length));
        return `${name} = \n  struct with fields:\n\n` + keys.map(k => `    ${k.padStart(w)}: ${shortText(v.f.get(k))}`).join('\n') + '\n\n';
      }
      if (v.type === 'func') return `${name} =\n  function_handle with value:\n    ${v.src}\n`;
      return `${name} = ?\n`;
    }
  }

  // ---------- helpers ----------
  function rootName(e) { while (e.t !== 'id') e = e.obj; return e.name; }
  function hasEnd(n) {
    if (!n || typeof n !== 'object') return false;
    if (n.t === 'end') return true;
    if (n.t === 'index' || n.t === 'cellindex') return hasEnd(n.obj);
    if (n.t === 'anon') return false;
    for (const k in n) { const c = n[k]; if (Array.isArray(c)) { if (c.some(x => Array.isArray(x) ? x.some(hasEnd) : hasEnd(x))) return true; } else if (c && typeof c === 'object' && hasEnd(c)) return true; }
    return false;
  }
  const covers = (ix, n) => { const s = new Set(ix); for (let k = 0; k < n; k++) if (!s.has(k)) return false; return true; };
  function toNum(v, op) {
    if (v && v.type === 'num') return v;
    const what = v ? clsOf(v) : 'nothing';
    fail(`Operator '${op}' is not supported for operands of type '${what}'.`, 'MATLAB:UndefinedFunction');
  }
  function scal(v, what) { v = toNum(v, ':'); if (!v.n) return NaN; return v.re[0]; }
  function colon(a, step, b) {
    if (Number.isNaN(a) || Number.isNaN(step) || Number.isNaN(b)) return new Mat(1, 1, Float64Array.of(NaN));
    if (step === 0 || (step > 0 && a > b) || (step < 0 && a < b)) return new Mat(1, 0);
    const n = Math.floor((b - a) / step * (1 + 1e-15) + 1e-10) + 1;
    if (!isFinite(n) || n > 2e8) fail('Maximum variable size allowed by the program is exceeded.', 'MATLAB:array:SizeLimitExceeded');
    const o = new Mat(1, n);
    for (let k = 0; k < n; k++) o.re[k] = a + k * step;
    if (n > 1 && Number.isInteger(a) && Number.isInteger(step)) { /* exact */ } else if (n > 1 && Math.abs(o.re[n - 1] - b) < Math.abs(step) * 1e-10) o.re[n - 1] = b;
    return o;
  }
  function cellCat(list, dir) {
    const xs = list.filter(c => c.n > 0); if (!xs.length) return new Cell(0, 0, []);
    if (dir === 'h') {
      const r = xs[0].r; if (xs.some(c => c.r !== r)) fail('Dimensions of arrays being concatenated are not consistent.');
      const data = []; xs.forEach(c => data.push(...c.data)); return new Cell(r, data.length / r, data);
    }
    const c = xs[0].c; if (xs.some(x => x.c !== c)) fail('Dimensions of arrays being concatenated are not consistent.');
    const r = xs.reduce((s, x) => s + x.r, 0), o = new Cell(r, c); let off = 0;
    for (const x of xs) { for (let j = 0; j < c; j++) for (let i = 0; i < x.r; i++) o.data[off + i + j * r] = x.data[i + j * x.r]; off += x.r; }
    return o;
  }
  function cloneShallow(v) {
    if (v.type === 'num') return M.copy(v);
    if (v.type === 'cell') { v.data.forEach(x => { x._sh = true; }); return new Cell(v.r, v.c, v.data.slice()); }
    if (v.type === 'struct') { v.f.forEach(x => { x._sh = true; }); return new Struct(new Map(v.f)); }
    return v;
  }
  function shortText(x, inCell) {
    if (x.type === 'num') {
      if (x.cls === 'char' && x.r <= 1) return `'${M.toStr(x)}'`;
      if (x.n === 0) return '[]';
      if (x.n === 1) { const t = M.scalarText(x.re[0], x.im ? x.im[0] : null); return inCell ? `[${t}]` : (x.cls === 'logical' ? String(x.re[0]) : t); }
      if (x.r === 1 && x.n <= 10 && !x.im && !inCell) return '[' + Array.from(x.re, v => M.scalarText(v)).join(' ') + ']';
      return `${x.r}×${x.c} ${x.cls}`;
    }
    if (x.type === 'cell') return `${x.r}×${x.c} cell`;
    if (x.type === 'struct') return '1×1 struct';
    if (x.type === 'func') return inCell ? x.src : x.src;
    return '?';
  }
  function errStruct(e) {
    const s = new Struct(); s.f.set('message', str(e.message || String(e))); s.f.set('identifier', str(e.identifier || ''));
    const st = new Struct(); st.f.set('name', str((e.where && e.where[0] && e.where[0].name) || '')); st.f.set('line', num((e.where && e.where[0] && e.where[0].line) || 0)); s.f.set('stack', st);
    return s;
  }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  // format an error the way the command window shows it
  function errorText(e) {
    let s = (e.message || String(e));
    if (e.line && !e.where) s = `Error: ${s} (line ${e.line})`;
    const w = (e.where || []).filter(x => x.name && x.name !== 'base');
    if (w.length) s += '\n' + w.map(x => `Error in ${x.name} (line ${x.line})`).join('\n');
    return s;
  }

  const api = { Interp, Cell, Struct, Func, clsOf, isNum, colon, cellCat, shortText, errorText, mulberry32, errStruct, toNum };
  if (node) module.exports = api; else root.LabInterp = api;
})(typeof self !== 'undefined' ? self : this);
