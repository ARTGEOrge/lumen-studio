/* Lumen Convert — Python AST → readable modern JavaScript, using the "py" runtime for Python semantics.
   Anything outside the supported subset is reported with its line number instead of being translated wrongly. */
var PyCompile = (function () {
  'use strict';
  const Parse = typeof PyParse !== 'undefined' ? PyParse : require('./parser.js');
  class Unsupported extends Error { constructor(msg, line) { super(msg); this.line = line; } }
  const JS_RESERVED = new Set('arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof undefined var void while with yield NaN Infinity py Object Array Math JSON Number String Symbol Map Set Promise console window document globalThis Error'.split(' '));
  const MODULES = { math: true, random: true, time: true, json: true };
  const BUILTINS = {
    print: 'py.print', input: 'py.input', len: 'py.len', range: 'py.range', enumerate: 'py.enumerate', zip: 'py.zip', sorted: 'py.sorted', reversed: 'py.reversed',
    min: 'py.min', max: 'py.max', sum: 'py.sum', abs: 'py.abs', round: 'py.round', int: 'py.int', float: 'py.float', str: 'py.str', bool: 'py.bool_', list: 'py.list', tuple: 'py.tuple',
    dict: 'py.dict', set: 'py.set', frozenset: 'py.frozenset', isinstance: 'py.isinstance', issubclass: 'py.issubclass', type: 'py.type', map: 'py.map', filter: 'py.filter',
    chr: 'py.chr', ord: 'py.ord', hex: 'py.hex', oct: 'py.oct', bin: 'py.bin', all: 'py.all', any: 'py.any', next: 'py.next', iter: 'py.iter_', callable: 'py.callable',
    divmod: 'py.divmod', pow: 'py.pow', repr: 'py.repr_', format: 'py.format_', hasattr: 'py.hasattr', getattr: 'py.getattr', setattr: 'py.setattr', id: 'py.id', object: 'py.object', NotImplemented: 'py.NotImplemented'
  };
  const EXCEPTIONS = 'BaseException Exception ArithmeticError LookupError ZeroDivisionError OverflowError ValueError TypeError IndexError KeyError AttributeError NameError RuntimeError StopIteration AssertionError EOFError NotImplementedError RecursionError UnboundLocalError OSError ImportError ModuleNotFoundError FileNotFoundError SystemExit KeyboardInterrupt UnicodeError'.split(' ');
  for (const e of EXCEPTIONS) BUILTINS[e] = 'py.' + e;
  const NOT_SUPPORTED_BUILTINS = { open: 'file access (open) is not available in the browser', eval: 'eval() is not supported', exec: 'exec() is not supported', compile: 'compile() is not supported', globals: 'globals() is not supported', locals: 'locals() is not supported', vars: 'vars() is not supported', hash: 'hash() is not supported (Python randomises string hashes, so results would differ anyway)', dir: 'dir() is not supported', help: 'help() is not supported', memoryview: 'memoryview is not supported', bytearray: 'bytearray is not supported', bytes: 'bytes are not supported', complex: 'complex numbers are not supported', breakpoint: 'breakpoint() is not supported', __import__: '__import__() is not supported', classmethod: 'classmethod() as a function is not supported', staticmethod: 'staticmethod() as a function is not supported', property: 'property() as a function is not supported (use @property)', slice: 'slice() objects are not supported' };
  // built-ins that understand a trailing py.kw({...}) object
  const KW_BUILTINS = { print: ['sep', 'end', 'file', 'flush'], sorted: ['key', 'reverse'], max: ['key', 'default'], min: ['key', 'default'], sum: ['start'], enumerate: ['start'], zip: ['strict'], dict: null };
  const POS_BUILTINS = { round: ['number', 'ndigits'], int: ['x', 'base'], pow: ['base', 'exp', 'mod'], range: [], isinstance: [], getattr: [], next: [] };
  const KW_METHODS = { sort: ['key', 'reverse'], split: ['sep', 'maxsplit'], rsplit: ['sep', 'maxsplit'], dumps: ['indent', 'sort_keys', 'separators'], isclose: ['rel_tol', 'abs_tol'], prod: ['start'], update: null, format: null };
  const BUILTIN_METHOD_NAMES = new Set('upper lower casefold swapcase capitalize title strip lstrip rstrip split rsplit splitlines join replace find rfind index rindex count startswith endswith isdigit isdecimal isnumeric isalpha isalnum isspace isupper islower istitle isidentifier center ljust rjust zfill partition rpartition removeprefix removesuffix format expandtabs encode append extend insert remove pop sort reverse copy clear get keys values items setdefault update popitem add discard union intersection difference symmetric_difference issubset issuperset isdisjoint is_integer bit_length'.split(' '));
  const OPFN = { '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '//': 'floordiv', '%': 'mod', '**': 'pow', '&': 'and_', '|': 'or_', '^': 'xor', '<<': 'lshift', '>>': 'rshift' };
  const CMPFN = { '==': 'eq', '!=': 'ne', '<': 'lt', '>': 'gt', '<=': 'le', '>=': 'ge' };

  function compile(src, opts = {}) {
    const o = { module: false, runtime: 'inline', comments: true, runtimeSource: '', ...opts };
    let ast;
    try { ast = Parse.parse(src); }
    catch (e) { if (e instanceof Parse.PySyntaxError) return { code: '', errors: [{ line: e.line, msg: 'SyntaxError: ' + e.message }] }; throw e; }
    const C = new Compiler(ast, o);
    try { C.run(); } catch (e) { if (!(e instanceof Unsupported)) throw e; C.errors.push({ line: e.line, msg: e.message }); }
    const errors = C.errors.sort((a, b) => a.line - b.line).filter((e, i, a) => !i || e.line !== a[i - 1].line || e.msg !== a[i - 1].msg);
    if (errors.length) return { code: '', errors };
    return { code: C.output(), errors: [], warnings: C.warnings, info: C.info };
  }

  function Compiler(ast, o) { this.loopStack = []; this.handlerStack = []; this.ast = ast; this.o = o; this.errors = []; this.warnings = []; this.out = []; this.tmpN = 0; this.info = { functions: 0, classes: 0, lines: 0 }; this.comments = (ast.comments || []).slice(); }
  const C = Compiler.prototype;
  C.err = function (msg, line) { this.errors.push({ line, msg }); };
  C.fail = function (msg, line) { throw new Unsupported(msg, line); };
  C.safe = function (fn, line) { try { return fn(); } catch (e) { if (e instanceof Unsupported) { this.err(e.message, e.line || line); return 'undefined'; } throw e; } };

  /* ---------- scopes ---------- */
  function collectBindings(body, scope, isFunc) {
    const add = n => { if (!scope.globals.has(n) && !scope.nonlocals.has(n)) scope.locals.add(n); };
    const target = t => { if (!t) return; if (t.type === 'Name') add(t.id); else if (t.type === 'Tuple' || t.type === 'List') t.elts.forEach(target); else if (t.type === 'Starred') target(t.value); };
    const walkExpr = e => { // named expressions bind in the enclosing function
      if (!e || typeof e !== 'object') return;
      if (e.type === 'NamedExpr') add(e.target.id);
      if (e.type === 'Lambda' || e.type === 'FunctionDef' || e.type === 'ClassDef') return;
      if ((e.type === 'Yield' || e.type === 'YieldFrom') && isFunc) scope.generator = true;
      for (const k in e) { const v = e[k]; if (k === 'line' || k === 'type') continue; if (Array.isArray(v)) v.forEach(walkExpr); else if (v && typeof v === 'object') walkExpr(v); }
    };
    const walk = stmts => {
      for (const s of stmts) {
        switch (s.type) {
          case 'Global': s.names.forEach(n => { scope.globals.add(n); scope.locals.delete(n); }); break;
          case 'Nonlocal': s.names.forEach(n => { scope.nonlocals.add(n); scope.locals.delete(n); }); break;
          case 'Assign': s.targets.forEach(target); walkExpr(s.value); break;
          case 'AugAssign': target(s.target); walkExpr(s.value); break;
          case 'AnnAssign': if (s.value) target(s.target); walkExpr(s.value); break;
          case 'For': target(s.target); walkExpr(s.iter); walk(s.body); walk(s.orelse); break;
          case 'While': walkExpr(s.test); walk(s.body); walk(s.orelse); break;
          case 'If': walkExpr(s.test); walk(s.body); walk(s.orelse); break;
          case 'With': s.items.forEach(it => { walkExpr(it.expr); target(it.vars); }); walk(s.body); break;
          case 'Try': walk(s.body); s.handlers.forEach(h => { if (h.name) add(h.name); walk(h.body); }); walk(s.orelse); walk(s.finalbody); break;
          case 'FunctionDef': case 'ClassDef': add(s.name); (s.decorators || []).forEach(d => walkExpr(d.expr)); if (s.type === 'FunctionDef') [...s.args.args, ...s.args.kwonly].forEach(a => walkExpr(a.default)); else s.bases.forEach(walkExpr); break;
          case 'Import': s.names.forEach(n => add(n.asname || n.name.split('.')[0])); break;
          case 'ImportFrom': s.names.forEach(n => { if (n.name !== '*') add(n.asname || n.name); }); break;
          case 'Delete': s.targets.forEach(t => walkExpr(t)); break;
          default: for (const k of ['value', 'test', 'exc', 'msg', 'cause']) walkExpr(s[k]);
        }
      }
    };
    walk(body);
  }
  function newScope(kind, parent, node) { return { kind, parent, node, locals: new Set(), globals: new Set(), nonlocals: new Set(), params: new Set(), temps: [], funcs: new Map(), classes: new Map(), generator: false, selfName: null, className: null }; }
  C.tmp = function () { const n = '$' + (++this.tmpN); let s = this.scope; while (s.kind === 'class') s = s.parent; s.temps.push(n); return n; };
  C.lookup = function (name) {
    for (let s = this.scope; s; s = s.parent) {
      if (s.kind === 'class' && s !== this.scope) continue;
      if (s.kind === 'class') continue;
      if (s.params.has(name) || s.locals.has(name) || s.globals.has(name) || s.nonlocals.has(name)) {
        if (s.globals.has(name)) return this.moduleScope.locals.has(name) || this.moduleScope.funcs.has(name) || this.moduleScope.classes.has(name) ? { scope: this.moduleScope } : { scope: this.moduleScope };
        return { scope: s };
      }
    }
    return null;
  };
  const jsName = n => JS_RESERVED.has(n) ? n + '_' : n;
  C.name = function (n, line) {
    if (n === '__name__') return '"__main__"';
    if (this.lookup(n)) return jsName(n);
    if (n in BUILTINS) return BUILTINS[n];
    if (n in NOT_SUPPORTED_BUILTINS) this.fail(NOT_SUPPORTED_BUILTINS[n], line);
    if (n === 'super') this.fail('super is only supported as super().method(...) inside a method', line);
    if (n === 'self' && this.scope.selfName === null) return 'self';
    return jsName(n);
  };
  C.findDef = function (name) { for (let s = this.scope; s; s = s.parent) { if (s.kind === 'class') continue; if (s.funcs.has(name)) return { kind: 'func', def: s.funcs.get(name), scope: s }; if (s.classes.has(name)) return { kind: 'class', def: s.classes.get(name), scope: s }; if (s.params.has(name) || s.locals.has(name)) return null; } return null; };

  /* ---------- program ---------- */
  C.run = function () {
    const ms = this.moduleScope = this.scope = newScope('module', null, this.ast);
    collectBindings(this.ast.body, ms, false);
    this.indexDefs(this.ast.body, ms);
    this.userAttrs = new Set(); this.methodSigs = new Map(); this.collectAttrs(this.ast.body);
    this.lines = [];
    const topImports = new Set();
    for (const s of this.ast.body) if (s.type === 'Import' || s.type === 'ImportFrom') for (const n of s.names) topImports.add(n.asname || (s.type === 'Import' ? n.name.split('.')[0] : n.name));
    this.topImports = topImports;
    const body = this.stmts(this.ast.body, 0);
    const decl = [...ms.locals].filter(n => !this.declaredDirect(this.ast.body, n) && !topImports.has(n)).map(jsName);
    const temps = ms.temps;
    const head = [];
    if (decl.length || temps.length) head.push(`let ${[...decl, ...temps].join(', ')};`);
    this.lines = [...head, ...(head.length ? [''] : []), ...body];
    this.info.lines = this.lines.length;
  };
  C.indexDefs = function (body, scope) {
    for (const s of body) {
      if (s.type === 'FunctionDef') scope.funcs.set(s.name, s);
      else if (s.type === 'ClassDef') scope.classes.set(s.name, s);
      else for (const k of ['body', 'orelse', 'finalbody']) if (Array.isArray(s[k])) this.indexDefs(s[k], scope);
      if (s.type === 'Try') s.handlers.forEach(h => this.indexDefs(h.body, scope));
    }
  };
  C.collectAttrs = function (body) {
    const walk = n => {
      if (!n || typeof n !== 'object') return;
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n.type === 'Assign' || n.type === 'AugAssign' || n.type === 'AnnAssign') { const ts = n.targets || [n.target]; const tw = t => { if (!t) return; if (t.type === 'Attribute') this.userAttrs.add(t.attr); if (t.type === 'Tuple' || t.type === 'List') t.elts.forEach(tw); }; ts.forEach(tw); }
      if (n.type === 'ClassDef') for (const s of n.body) { if (s.type === 'FunctionDef') { this.userAttrs.add(s.name); const list = this.methodSigs.get(s.name) || []; list.push(s); this.methodSigs.set(s.name, list); } if ((s.type === 'Assign' || s.type === 'AnnAssign')) (s.targets || [s.target]).forEach(t => t.type === 'Name' && this.userAttrs.add(t.id)); }
      for (const k in n) if (k !== 'line' && k !== 'type' && n[k] && typeof n[k] === 'object') walk(n[k]);
    };
    walk(body);
  };
  C.output = function () {
    const o = this.o, parts = [];
    parts.push('// Transpiled from Python by Lumen Convert. Python semantics come from the small "py" runtime' + (o.runtime === 'inline' ? ' below.' : o.module ? " imported from './py-runtime.js'." : ' (load py-runtime.js first).'));
    if (o.runtime === 'inline') parts.push(o.runtimeSource.replace(/\nif \(typeof module !== 'undefined'[^\n]*\n?$/, '\n').trim(), '');
    else if (o.module) parts.push("import py from './py-runtime.js';", '');
    if (!o.module) parts.push("'use strict';");
    if (o.runtime === 'inline') parts.push('// ---------- program ----------');
    parts.push(...this.lines, '', 'py.stdout.flush();', '');
    if (o.module && o.runtime === 'inline') parts.push('export {};');
    return parts.join('\n');
  };

  /* ---------- comments ---------- */
  C.commentsBefore = function (line, ind) {
    const out = [];
    if (!this.o.comments) return out;
    while (this.comments.length && this.comments[0].line < line) { const c = this.comments.shift(); if (c.full) out.push(ind + '//' + (c.text.startsWith(' ') || !c.text ? '' : ' ') + c.text); }
    return out;
  };
  C.trailing = function (line) { if (!this.o.comments) return ''; const i = this.comments.findIndex(c => c.line === line && !c.full); if (i < 0) return ''; const c = this.comments.splice(i, 1)[0]; return ' //' + (c.text.startsWith(' ') ? '' : ' ') + c.text; };

  /* ---------- statements ---------- */
  const IND = '  ';
  C.stmts = function (body, depth) {
    const out = [];
    for (const s of body) {
      const ind = IND.repeat(depth);
      out.push(...this.commentsBefore(s.line, ind));
      let lines;
      try { lines = this.stmt(s, depth); } catch (e) { if (!(e instanceof Unsupported)) throw e; this.err(e.message, e.line || s.line); lines = []; }
      if (lines.length) { const tr = this.trailing(s.line); if (tr) lines[0] += tr; }
      out.push(...lines);
    }
    return out;
  };
  C.blockLines = function (body, depth) { const r = this.stmts(body, depth); return r.length ? r : [IND.repeat(depth) + '// pass']; };
  C.stmt = function (s, d) {
    const ind = IND.repeat(d), L = s.line;
    if (s.unsupported) this.fail(s.unsupported, L);
    switch (s.type) {
      case 'Pass': return [];
      case 'Expr': {
        const v = s.value;
        if (v.type === 'Constant' && v.kind === 'str') return this.o.comments ? v.value.split('\n').map(l => ind + '// ' + l.trim()).filter((l, i, a) => l.trim() !== '//' || (i > 0 && i < a.length - 1)) : [];
        if (v.type === 'Constant' && v.kind === 'ellipsis') return [];
        if (v.type === 'Yield' || v.type === 'YieldFrom') return [ind + this.yieldExpr(v) + ';'];
        return [ind + this.expr(v) + ';'];
      }
      case 'Assign': return this.assign(s, d);
      case 'AnnAssign': if (!s.value) return []; return this.assignTo(s.target, this.expr(s.value), d, L);
      case 'AugAssign': return this.augAssign(s, d);
      case 'Return': if (this.scope.kind === 'module') this.fail("'return' outside function", L); return [ind + (s.value ? 'return ' + this.expr(s.value) + ';' : 'return;')];
      case 'If': {
        const out = [ind + `if (${this.cond(s.test)}) {`, ...this.blockLines(s.body, d + 1)];
        let el = s.orelse;
        while (el.length === 1 && el[0].type === 'If') { out.push(ind + `} else if (${this.cond(el[0].test)}) {`, ...this.blockLines(el[0].body, d + 1)); el = el[0].orelse; }
        if (el.length) out.push(ind + '} else {', ...this.blockLines(el, d + 1));
        out.push(ind + '}'); return out;
      }
      case 'While': return this.loop(s, d, `while (${this.cond(s.test)})`);
      case 'For': {
        const iterJs = this.expr(s.iter);
        return this.loop(s, d, `for (${this.forTarget(s.target, L)} of py.iter(${iterJs}))`, s.target);
      }
      case 'Break': { const lp = this.loopStack[this.loopStack.length - 1]; if (!lp) this.fail("'break' outside loop", L); return lp.flag ? [ind + `${lp.flag} = true;`, ind + 'break;'] : [ind + 'break;']; }
      case 'Continue': if (!this.loopStack.length) this.fail("'continue' not properly in loop", L); return [ind + 'continue;'];
      case 'FunctionDef': return this.funcDef(s, d);
      case 'ClassDef': return this.classDef(s, d);
      case 'Raise': {
        if (!s.exc) { const h = this.handlerStack[this.handlerStack.length - 1]; if (!h) this.fail('bare raise outside an except block is not supported', L); return [ind + `throw ${h};`]; }
        const e = s.exc; let js;
        if (e.type === 'Name' && this.isExceptionClassName(e.id)) js = `new ${this.name(e.id, L)}()`;
        else if (e.type === 'Call') js = this.expr(e);
        else js = `py.mkexc(${this.expr(e)})`;
        return [ind + `throw ${js};`];
      }
      case 'Try': return this.tryStmt(s, d);
      case 'With': return this.withStmt(s, d);
      case 'Assert': return [ind + `if (!(${this.cond(s.test)})) throw new py.AssertionError(${s.msg ? this.expr(s.msg) : ''});`];
      case 'Global': case 'Nonlocal': return [];
      case 'Delete': return s.targets.map(t => {
        if (t.type === 'Subscript') return t.slice.type === 'Slice' ? ind + `py.delslice(${this.expr(t.value)}, ${this.optE(t.slice.lower)}, ${this.optE(t.slice.upper)}, ${this.optE(t.slice.step)});` : ind + `py.delitem(${this.expr(t.value)}, ${this.index(t.slice)});`;
        if (t.type === 'Attribute') return ind + `delete ${this.expr(t.value)}.${t.attr};`;
        if (t.type === 'Name') return ind + `${this.name(t.id, L)} = undefined;`;
        this.fail('this kind of del is not supported', L);
      });
      case 'Import': return s.names.map(n => {
        const base = n.name.split('.')[0];
        if (n.name.includes('.') || !MODULES[base]) this.fail(`import ${n.name}: only the math, random, time and json modules are available in transpiled code`, L);
        const local = jsName(n.asname || base);
        return ind + (d === 0 && this.scope.kind === 'module' ? `const ${local} = py.module('${base}');` : `${local} = py.module('${base}');`);
      });
      case 'ImportFrom': {
        if (s.module === '__future__') return [];
        if (!MODULES[s.module]) this.fail(`from ${s.module || '.'} import ...: only the math, random, time and json modules are available in transpiled code`, L);
        if (s.names.some(n => n.name === '*')) this.fail(`from ${s.module} import * is not supported; import the names you need`, L);
        const pairs = s.names.map(n => n.asname ? `${n.name}: ${jsName(n.asname)}` : jsName(n.name) === n.name ? n.name : `${n.name}: ${jsName(n.name)}`);
        return [ind + (d === 0 && this.scope.kind === 'module' ? `const { ${pairs.join(', ')} } = py.module('${s.module}');` : `({ ${pairs.join(', ')} } = py.module('${s.module}'));`)];
      }
    }
    this.fail(`${s.type} statements are not supported`, L);
  };
  C.loop = function (s, d, head, target) {
    const ind = IND.repeat(d), flag = s.orelse.length ? this.tmp() : null;
    this.loopStack.push({ flag });
    const body = this.blockLines(s.body, d + 1);
    this.loopStack.pop();
    const out = [];
    if (flag) out.push(ind + `${flag} = false;`);
    out.push(ind + head + ' {', ...body, ind + '}');
    if (flag) out.push(ind + `if (!${flag}) {`, ...this.blockLines(s.orelse, d + 1), ind + '}');
    return out;
  };
  C.forTarget = function (t, line) {
    if (t.type === 'Name') return this.name(t.id, line);
    if (t.type === 'Tuple' || t.type === 'List') { if (t.elts.some(e => e.type === 'Starred')) this.fail('starred targets in for loops are not supported', line); return '[' + t.elts.map(e => this.forTarget(e, line)).join(', ') + ']'; }
    this.fail('for-loop targets must be names or tuples of names', line);
  };
  C.assign = function (s, d) {
    const ind = IND.repeat(d);
    if (s.value.type === 'Yield' || s.value.type === 'YieldFrom') this.fail('using the value of yield (generator.send) is not supported', s.line);
    if (s.targets.length === 1) return this.assignTo(s.targets[0], this.expr(s.value), d, s.line, s.value);
    if (s.targets.every(t => t.type === 'Name')) return [ind + s.targets.map(t => this.name(t.id, s.line)).join(' = ') + ' = ' + this.expr(s.value) + ';'];
    const t = this.tmp(); return [ind + `${t} = ${this.expr(s.value)};`, ...s.targets.flatMap(tg => this.assignTo(tg, t, d, s.line))];
  };
  C.assignTo = function (t, v, d, line, valueNode) {
    const ind = IND.repeat(d);
    switch (t.type) {
      case 'Name': return [ind + `${this.name(t.id, line)} = ${v};`];
      case 'Attribute': return [ind + `${this.expr(t.value)}.${t.attr} = ${v};`];
      case 'Subscript': if (t.slice.type === 'Slice') return [ind + `py.setslice(${this.expr(t.value)}, ${this.optE(t.slice.lower)}, ${this.optE(t.slice.upper)}, ${this.optE(t.slice.step)}, ${v});`]; return [ind + `py.setitem(${this.expr(t.value)}, ${this.index(t.slice)}, ${v});`];
      case 'Tuple': case 'List': {
        const star = t.elts.findIndex(e => e.type === 'Starred');
        if (t.elts.filter(e => e.type === 'Starred').length > 1) this.fail('multiple starred expressions in assignment', line);
        const simple = t.elts.every(e => e.type === 'Name' || (e.type === 'Starred' && e.value.type === 'Name'));
        let rhs;
        if (star < 0 && valueNode && (valueNode.type === 'Tuple' || valueNode.type === 'List') && valueNode.elts.length === t.elts.length && !valueNode.elts.some(e => e.type === 'Starred')) rhs = '[' + valueNode.elts.map(e => this.expr(e)).join(', ') + ']';
        else rhs = star < 0 ? `py.unpack(${v}, ${t.elts.length})` : `py.unpackStar(${v}, ${star}, ${t.elts.length - star - 1})`;
        if (simple) return [ind + `[${t.elts.map(e => this.name(e.type === 'Starred' ? e.value.id : e.id, line)).join(', ')}] = ${rhs};`];
        const tmp = this.tmp(); const out = [ind + `${tmp} = ${rhs};`];
        t.elts.forEach((e, i) => out.push(...this.assignTo(e.type === 'Starred' ? e.value : e, `${tmp}[${i}]`, d, line)));
        return out;
      }
    }
    this.fail('cannot assign to this expression', line);
  };
  C.augAssign = function (s, d) {
    const ind = IND.repeat(d), t = s.target, fn = s.op === '+' ? 'iadd' : s.op === '*' ? 'imul' : OPFN[s.op];
    if (!fn) this.fail(`the ${s.op}= operator is not supported`, s.line);
    const v = this.expr(s.value);
    if (t.type === 'Name') { const n = this.name(t.id, s.line); return [ind + `${n} = py.${fn}(${n}, ${v});`]; }
    if (t.type === 'Attribute') { const simple = t.value.type === 'Name'; const o = simple ? this.expr(t.value) : this.tmp(); const pre = simple ? [] : [ind + `${o} = ${this.expr(t.value)};`]; return [...pre, ind + `${o}.${t.attr} = py.${fn}(${o}.${t.attr}, ${v});`]; }
    if (t.type === 'Subscript') {
      if (t.slice.type === 'Slice') this.fail('augmented assignment to a slice is not supported', s.line);
      const simpleO = t.value.type === 'Name', simpleK = t.slice.type === 'Name' || t.slice.type === 'Constant';
      const pre = []; let o = this.expr(t.value), k = this.index(t.slice);
      if (!simpleO) { const tmp = this.tmp(); pre.push(ind + `${tmp} = ${o};`); o = tmp; }
      if (!simpleK) { const tmp = this.tmp(); pre.push(ind + `${tmp} = ${k};`); k = tmp; }
      return [...pre, ind + `py.setitem(${o}, ${k}, py.${fn}(py.getitem(${o}, ${k}), ${v}));`];
    }
    this.fail('cannot assign to this expression', s.line);
  };
  C.isExceptionClassName = function (n) { if (EXCEPTIONS.includes(n) && !this.lookup(n)) return true; const def = this.findDef(n); return !!(def && def.kind === 'class'); };
  C.tryStmt = function (s, d) {
    const ind = IND.repeat(d), out = [];
    const ok = s.orelse.length ? this.tmp() : null;
    const inner = [];
    if (ok) inner.push(IND.repeat(d + 1) + `${ok} = false;`);
    inner.push(IND.repeat(d + 1) + 'try {', ...this.blockLines(s.body, d + 2));
    if (ok) inner.push(IND.repeat(d + 2) + `${ok} = true;`);
    if (s.handlers.length) {
      const ev = this.tmp(); inner.push(IND.repeat(d + 1) + `} catch (${ev}$) {`, IND.repeat(d + 2) + `${ev} = py.exc(${ev}$);`);
      this.handlerStack.push(ev);
      s.handlers.forEach((h, i) => {
        const test = h.type ? `py.isinstance(${ev}, ${h.type.type === 'Tuple' ? 'py.T(' + h.type.elts.map(e => this.expr(e)).join(', ') + ')' : this.expr(h.type)})` : 'true';
        inner.push(IND.repeat(d + 2) + (i === 0 ? '' : '} else ') + `if (${test}) {`);
        if (h.name) inner.push(IND.repeat(d + 3) + `${this.name(h.name, h.line)} = ${ev};`);
        inner.push(...this.blockLines(h.body, d + 3));
      });
      inner.push(IND.repeat(d + 2) + `} else throw ${ev};`);
      this.handlerStack.pop();
      if (!s.finalbody.length && !ok) inner.push(IND.repeat(d + 1) + '}');
      else inner.push(IND.repeat(d + 1) + '}');
    } else inner.push(IND.repeat(d + 1) + '} finally {', ...this.blockLines(s.finalbody, d + 2), IND.repeat(d + 1) + '}');
    if (ok) inner.push(IND.repeat(d + 1) + `if (${ok}) {`, ...this.blockLines(s.orelse, d + 2), IND.repeat(d + 1) + '}');
    const needsOuter = s.handlers.length && s.finalbody.length;
    // de-indent when no wrapper is needed
    const flat = lines => lines.map(l => l.startsWith(IND) ? l.slice(IND.length) : l);
    if (needsOuter) out.push(ind + 'try {', ...inner, ind + '} finally {', ...this.blockLines(s.finalbody, d + 1), ind + '}');
    else out.push(...flat(inner));
    return out;
  };
  C.withStmt = function (s, d) {
    const ind = IND.repeat(d);
    if (s.items.length > 1) { const [first, ...rest] = s.items; return this.withStmt({ ...s, items: [first], body: [{ ...s, items: rest }] }, d); }
    const it = s.items[0];
    if (it.expr.type === 'Call' && it.expr.func.type === 'Name' && it.expr.func.id === 'open' && !this.lookup('open')) this.fail('file access (open) is not available in the browser', s.line);
    const m = this.tmp(), err = this.tmp();
    const out = [ind + `${m} = ${this.expr(it.expr)};`, ind + `${err} = null;`];
    const enter = `${m}.__enter__()`;
    out.push(ind + 'try {');
    if (it.vars) out.push(...this.assignTo(it.vars, enter, d + 1, s.line)); else out.push(IND.repeat(d + 1) + enter + ';');
    out.push(...this.blockLines(s.body, d + 1));
    out.push(ind + `} catch (${err}$) {`, IND.repeat(d + 1) + `${err} = py.exc(${err}$);`, IND.repeat(d + 1) + `if (!py.bool(${m}.__exit__(py.type(${err}), ${err}, null))) throw ${err};`, ind + '} finally {', IND.repeat(d + 1) + `if (!${err}) ${m}.__exit__(null, null, null);`, ind + '}');
    return out;
  };
  /* ---------- functions & classes ---------- */
  C.params = function (a, line, { method = false } = {}) {
    if (a.kwarg) this.err('**kwargs parameters are not supported', a.kwarg.line || line);
    let args = a.args.slice();
    const self = method && args.length ? args.shift() : null;
    const pre = [];
    const defaultJs = (p) => {
      if (!p.default) return '';
      const dv = p.default;
      const literal = (dv.type === 'Constant' && dv.kind !== 'float') || (dv.type === 'UnaryOp' && dv.op === '-' && dv.operand.type === 'Constant' && dv.operand.kind === 'int');
      if (literal) return ' = ' + this.expr(dv);
      const t = '$d' + (++this.tmpN) + '_' + p.name; pre.push(`const ${t} = ${this.expr(dv)};`); return ' = ' + t;
    };
    const js = args.map(p => jsName(p.name) + defaultJs(p));
    let prologue = [];
    if (a.vararg) {
      if (a.kwonly.length) { js.push('...' + jsName(a.vararg.name) + '$'); prologue.push(`let [${jsName(a.vararg.name)}, { ${a.kwonly.map(k => jsName(k.name) + defaultJs(k)).join(', ')} }] = py.varargs(${jsName(a.vararg.name)}$);`); }
      else { js.push('...' + jsName(a.vararg.name) + '$'); prologue.push(`const ${jsName(a.vararg.name)} = py.T(...${jsName(a.vararg.name)}$);`); }
    } else a.kwonly.forEach(k => js.push(jsName(k.name) + defaultJs(k)));
    return { js: js.join(', '), pre, prologue, self };
  };
  C.funcBody = function (s, scope, d) {
    const prevScope = this.scope, prevLoops = this.loopStack, prevHandlers = this.handlerStack;
    this.scope = scope; this.loopStack = []; this.handlerStack = [];
    collectBindings(s.body, scope, true);
    [...s.args.args, ...s.args.kwonly].forEach(p => scope.params.add(p.name)); if (s.args.vararg) scope.params.add(s.args.vararg.name);
    for (const p of scope.params) scope.locals.delete(p);
    this.indexDefs(s.body, scope);
    const body = this.blockLines(s.body, d + 1);
    const decl = [...scope.locals].filter(n => !this.declaredDirect(s.body, n)).map(jsName);
    const lets = [...decl, ...scope.temps];
    this.scope = prevScope; this.loopStack = prevLoops; this.handlerStack = prevHandlers;
    return { body: body[0] === IND.repeat(d + 1) + '// pass' && lets.length ? [] : body, lets };
  };
  // a def/class directly in a function or module body becomes a JS declaration; one nested in a block (if/for/try)
  // becomes an assignment to a hoisted variable, because block-level declarations are block-scoped in strict JS
  C.declaredDirect = function (body, n) {
    let direct = false, other = false;
    const walk = (stmts, top) => { for (const st of stmts) { if ((st.type === 'FunctionDef' || st.type === 'ClassDef') && st.name === n) { if (top) direct = true; else other = true; } if (st.type !== 'FunctionDef' && st.type !== 'ClassDef') { for (const k of ['body', 'orelse', 'finalbody']) if (Array.isArray(st[k])) walk(st[k], false); if (st.type === 'Try') st.handlers.forEach(h => walk(h.body, false)); } } };
    walk(body, true);
    return direct && !other && !this.assignedElsewhere(body, n);
  };
  C.assignedElsewhere = function (body, n) { let hit = false; const walk = stmts => { for (const st of stmts) { if (st.type === 'Assign' && st.targets.some(t => t.type === 'Name' && t.id === n)) hit = true; if (st.type !== 'FunctionDef' && st.type !== 'ClassDef') for (const k of ['body', 'orelse', 'finalbody']) if (Array.isArray(st[k])) walk(st[k]); } }; walk(body); return hit; };
  C.funcDef = function (s, d, inClass) {
    const ind = IND.repeat(d);
    if (!inClass && s.decorators.length) this.err(`decorator @${this.decoName(s.decorators[0])} is not supported (only @staticmethod, @classmethod and @property inside classes)`, s.decorators[0].line);
    this.info.functions++;
    const scope = newScope('function', this.scope, s);
    const deco = inClass ? (s.decorators[0] ? this.decoName(s.decorators[0]) : null) : null;
    const isStatic = deco === 'staticmethod', isClassM = deco === 'classmethod', isProp = deco === 'property', isSetter = deco && /\.setter$/.test(deco);
    if (inClass && s.decorators.length > 1) this.fail('stacked decorators are not supported', s.decorators[1].line);
    if (deco && !isStatic && !isClassM && !isProp && !isSetter) this.fail(`decorator @${deco} is not supported (only @staticmethod, @classmethod and @property)`, s.decorators[0].line);
    const method = inClass && !isStatic;
    const prm = this.params(s.args, s.line, { method });
    if (method && prm.self) { scope.selfName = prm.self.name; scope.params.add(prm.self.name); scope.className = inClass; }
    if (inClass) scope.className = inClass;
    const { body, lets } = this.funcBody(s, scope, d);
    if (scope.generator && (isProp || isSetter || s.name === '__init__')) this.fail('yield is not supported here', s.line);
    const star = scope.generator ? '*' : '';
    const pro = [...prm.prologue];
    if (method && prm.self) pro.unshift(`const ${jsName(prm.self.name)} = ${isClassM ? 'this' : 'this'};`);
    if (lets.length) pro.push(`let ${lets.join(', ')};`);
    const inner = [...pro.map(l => IND.repeat(d + 1) + l), ...body];
    if (!inClass) {
      const nested = !this.isDirectBody(s) || !this.declaredDirect(this.scope.node.body, s.name);
      const head = nested ? `${jsName(s.name)} = function${star} ${jsName(s.name)}(${prm.js}) {` : `function${star} ${jsName(s.name)}(${prm.js}) {`;
      return [...prm.pre.map(l => ind + l), ind + head, ...inner, ind + (nested ? '};' : '}')];
    }
    let head;
    if (isProp) head = `get ${s.name}() {`;
    else if (isSetter) head = `set ${s.name}(${prm.js}) {`;
    else head = `${isStatic || isClassM ? 'static ' : ''}${star}${s.name}(${prm.js}) {`;
    return { pre: prm.pre, lines: [ind + head, ...inner, ind + '}'], isStatic, isClassM };
  };
  C.isDirectBody = function (s) { return this.scope.node && Array.isArray(this.scope.node.body) && this.scope.node.body.includes(s); };
  C.decoName = function (dd) { const e = dd.expr; if (e.type === 'Name') return e.id; if (e.type === 'Attribute') return (e.value.type === 'Name' ? e.value.id + '.' : '') + e.attr; if (e.type === 'Call') return this.decoName({ expr: e.func }) + '(...)'; return 'expression'; };
  C.classDef = function (s, d) {
    const ind = IND.repeat(d);
    if (s.decorators.length) this.fail(`class decorator @${this.decoName(s.decorators[0])} is not supported (dataclasses aren't supported; write __init__ yourself)`, s.decorators[0].line);
    if (s.bases.length > 1) this.fail('multiple inheritance is not supported', s.line);
    if (s.keywords.length) this.fail('class keywords (metaclass=...) are not supported', s.line);
    this.info.classes++;
    let base = 'py.object';
    if (s.bases.length) {
      const b = s.bases[0];
      if (b.type === 'Name' && b.id === 'object') base = 'py.object';
      else if (b.type === 'Name' && ['list', 'dict', 'str', 'int', 'float', 'tuple', 'set'].includes(b.id) && !this.lookup(b.id)) this.fail(`subclassing the built-in ${b.id} type is not supported`, s.line);
      else base = this.expr(b);
    }
    const cs = newScope('class', this.scope, s); const prevScope = this.scope; this.scope = cs;
    const members = [], after = [], pre = [];
    for (const st of s.body) {
      try {
        if (st.type === 'FunctionDef') { const r = this.funcDef(st, d + 1, s.name); pre.push(...r.pre.map(l => ind + l)); members.push(...this.commentsBefore(st.line, IND.repeat(d + 1)), ...r.lines); if (r.isStatic || r.isClassM) after.push(ind + `py.aliasStatic(${jsName(s.name)}, '${st.name}');`); }
        else if (st.type === 'Assign' && st.targets.length === 1 && st.targets[0].type === 'Name') after.push(ind + `py.classattr(${jsName(s.name)}, '${st.targets[0].id}', ${this.withScope(prevScope, () => this.expr(st.value))});`);
        else if (st.type === 'AnnAssign' && st.target.type === 'Name') { if (st.value) after.push(ind + `py.classattr(${jsName(s.name)}, '${st.target.id}', ${this.withScope(prevScope, () => this.expr(st.value))});`); }
        else if (st.type === 'Pass' || (st.type === 'Expr' && st.value.type === 'Constant')) { if (st.type === 'Expr' && st.value.kind === 'str' && this.o.comments) members.push(...st.value.value.split('\n').map(l => l.trim()).filter(Boolean).map(l => IND.repeat(d + 1) + '// ' + l)); }
        else this.fail(`${st.type} statements in a class body are not supported`, st.line);
      } catch (e) { if (!(e instanceof Unsupported)) throw e; this.err(e.message, e.line || st.line); }
    }
    this.scope = prevScope;
    const nestedC = !this.isDirectBody(s) || !this.declaredDirect(this.scope.node.body, s.name);
    return [...pre, ind + (nestedC ? `${jsName(s.name)} = class ${jsName(s.name)} extends ${base} {` : `class ${jsName(s.name)} extends ${base} {`), ...members, ind + (nestedC ? '};' : '}'), ...after];
  };
  C.withScope = function (sc, fn) { const p = this.scope; this.scope = sc; try { return fn(); } finally { this.scope = p; } };

  /* ---------- expressions ---------- */
  C.optE = function (e) { return e ? this.expr(e) : 'null'; };
  C.index = function (e) { if (e.type === 'Tuple') return `py.T(${e.elts.map(x => this.expr(x)).join(', ')})`; return this.expr(e); };
  C.isBoolExpr = function (e) { return (e.type === 'Compare') || (e.type === 'UnaryOp' && e.op === 'not') || (e.type === 'Constant' && e.kind === 'bool') || (e.type === 'BoolOp' && e.values.every(v => this.isBoolExpr(v))) || (e.type === 'Call' && e.func.type === 'Name' && ['isinstance', 'issubclass', 'callable', 'hasattr', 'all', 'any', 'bool'].includes(e.func.id) && !this.lookup(e.func.id)); };
  C.cond = function (e) {
    if (e.type === 'BoolOp') return e.values.map(v => { const c = this.cond(v); return v.type === 'BoolOp' ? `(${c})` : c; }).join(e.op === 'and' ? ' && ' : ' || ');
    if (e.type === 'UnaryOp' && e.op === 'not') return `!${this.wrapCond(e.operand)}`;
    if (e.type === 'Constant' && e.kind === 'bool') return e.value ? 'true' : 'false';
    if (e.type === 'NamedExpr') return `py.bool(${this.expr(e)})`;
    if (this.isBoolExpr(e)) return this.expr(e);
    return `py.bool(${this.expr(e)})`;
  };
  C.wrapCond = function (e) { const c = this.cond(e); return /^[\w.$]+(\(.*\))?$/.test(c) && !c.includes(' ') ? c : `(${c})`; };
  C.expr = function (e) {
    const L = e.line;
    switch (e.type) {
      case 'Constant':
        if (e.kind === 'int') { const v = BigInt(e.value); return v > 9007199254740991n ? `${v}n` : String(v); }
        if (e.kind === 'float') { const v = Number(e.value); return `py.f(${Number.isInteger(v) ? v.toFixed(1) : String(v)})`; }
        if (e.kind === 'str') return JSON.stringify(e.value);
        if (e.kind === 'bool') return e.value ? 'true' : 'false';
        if (e.kind === 'None') return 'null';
        this.fail('the ... (Ellipsis) value is not supported', L);
      case 'Name': return this.name(e.id, L);
      case 'JoinedStr': return '`' + e.values.map(p => typeof p === 'string' ? p.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${').replace(/\r/g, '\\r') : '${' + this.fpart(p) + '}').join('') + '`';
      case 'List': return this.seq(e.elts, '[', ']');
      case 'Tuple': return e.elts.some(x => x.type === 'Starred') ? `py.tuple(${this.seq(e.elts, '[', ']')})` : `py.T(${e.elts.map(x => this.expr(x)).join(', ')})`;
      case 'Set': return `py.set(${this.seq(e.elts, '[', ']')})`;
      case 'Dict': {
        if (!e.keys.length) return 'py.dict()';
        const parts = e.keys.map((k, i) => k === null ? `...py.dict(${this.expr(e.values[i])}).items()` : `[${this.expr(k)}, ${this.expr(e.values[i])}]`);
        return `py.dict([${parts.join(', ')}])`;
      }
      case 'BinOp': {
        if (e.op === '@') this.fail('the @ (matrix multiply) operator is not supported', L);
        if (e.op === '-' && e.left.type === 'Constant' && false) return '';
        return `py.${OPFN[e.op]}(${this.expr(e.left)}, ${this.expr(e.right)})`;
      }
      case 'UnaryOp':
        if (e.op === 'not') return `!${this.wrapCond(e.operand)}`;
        if (e.op === '-' && e.operand.type === 'Constant' && e.operand.kind === 'int') { const v = BigInt(e.operand.value); return v > 9007199254740991n ? `-${v}n` : `-${v}`; }
        if (e.op === '-' && e.operand.type === 'Constant' && e.operand.kind === 'float') return `py.f(-${Number(e.operand.value)})`;
        return `py.${e.op === '-' ? 'neg' : e.op === '+' ? 'pos' : 'invert'}(${this.expr(e.operand)})`;
      case 'BoolOp': { let r = this.expr(e.values[e.values.length - 1]); for (let i = e.values.length - 2; i >= 0; i--) r = `py.${e.op}(${this.expr(e.values[i])}, () => ${r})`; return r; }
      case 'Compare': return this.compare(e);
      case 'IfExp': return `(${this.cond(e.test)} ? ${this.expr(e.body)} : ${this.expr(e.orelse)})`;
      case 'Call': return this.call(e);
      case 'Attribute': {
        if (e.value.type === 'Name' && (this.isModuleName(e.value.id) || this.isSelf(e.value.id) || this.isClassName(e.value.id))) return `${this.expr(e.value)}.${e.attr}`;
        if (this.userAttrs.has(e.attr)) return `${this.expr(e.value)}.${e.attr}`;
        if (e.attr === '__name__') return `py.nameOf(${this.expr(e.value)})`;
        if (e.attr === '__class__') return `py.type(${this.expr(e.value)})`;
        if (e.attr === 'args') return `${this.expr(e.value)}.args`;
        return `py.getattr(${this.expr(e.value)}, '${e.attr}')`;
      }
      case 'Subscript': if (e.slice.type === 'Slice') return `py.getslice(${this.expr(e.value)}, ${this.optE(e.slice.lower)}, ${this.optE(e.slice.upper)}, ${this.optE(e.slice.step)})`; return `py.getitem(${this.expr(e.value)}, ${this.index(e.slice)})`;
      case 'Lambda': return this.lambda(e);
      case 'ListComp': return this.comp(e, 'list');
      case 'SetComp': return this.comp(e, 'set');
      case 'DictComp': return this.comp(e, 'dict');
      case 'GeneratorExp': return this.comp(e, 'gen');
      case 'NamedExpr': return `(${this.name(e.target.id, L)} = ${this.expr(e.value)})`;
      case 'Starred': this.fail('starred expressions are only supported in calls, list/tuple/set literals and assignments', L);
      case 'Yield': case 'YieldFrom': this.fail('yield used as a value is not supported (only "yield x" as a statement)', L);
      case 'Slice': this.fail('slices are only supported inside [ ]', L);
      case 'Await': this.fail('await is not supported', L);
    }
    this.fail(`${e.type} expressions are not supported`, L);
  };
  C.yieldExpr = function (e) { if (this.scope.kind !== 'function') this.fail("'yield' outside function", e.line); return e.type === 'YieldFrom' ? `yield* py.iter(${this.expr(e.value)})` : `yield ${e.value ? this.expr(e.value) : 'null'}`; };
  C.fpart = function (p) {
    const v = this.expr(p.expr);
    if (!p.spec && !p.conv) return `py.fmt(${v})`;
    const spec = !p.spec ? "''" : p.spec.every(x => typeof x === 'string') ? JSON.stringify(p.spec.join('')) : '`' + p.spec.map(x => typeof x === 'string' ? x.replace(/[`\\]/g, '\\$&').replace(/\$\{/g, '\\${') : '${' + this.fpart(x) + '}').join('') + '`';
    return `py.fmt(${v}, ${p.conv ? `'${p.conv}'` : 'null'}${p.spec ? ', ' + spec : ''})`;
  };
  C.seq = function (elts, a, b) { return a + elts.map(x => x.type === 'Starred' ? `...py.iter(${this.expr(x.value)})` : this.expr(x)).join(', ') + b; };
  C.compare = function (e) {
    const one = (op, a, b, aN, bN) => {
      if (op === 'is' || op === 'is not') { const none = (aN && aN.type === 'Constant' && aN.kind === 'None') || (bN && bN.type === 'Constant' && bN.kind === 'None'); return none ? `${a} ${op === 'is' ? '==' : '!='} ${b}` : `${a} ${op === 'is' ? '===' : '!=='} ${b}`; }
      if (op === 'in') return `py.contains(${b}, ${a})`;
      if (op === 'not in') return `!py.contains(${b}, ${a})`;
      return `py.${CMPFN[op]}(${a}, ${b})`;
    };
    if (e.ops.length === 1) return one(e.ops[0], this.expr(e.left), this.expr(e.comparators[0]), e.left, e.comparators[0]);
    const simple = n => n.type === 'Name' || n.type === 'Constant';
    if (e.comparators.slice(0, -1).every(simple)) { const parts = []; let l = e.left; e.ops.forEach((op, i) => { parts.push(one(op, this.expr(l), this.expr(e.comparators[i]), l, e.comparators[i])); l = e.comparators[i]; }); return '(' + parts.join(' && ') + ')'; }
    return `py.chain(${this.expr(e.left)}, ${e.ops.map((op, i) => `'${op}', () => ${this.expr(e.comparators[i])}`).join(', ')})`;
  };
  C.lambda = function (e) {
    const scope = newScope('function', this.scope, e); const prev = this.scope; this.scope = scope;
    [...e.args.args, ...e.args.kwonly].forEach(p => scope.params.add(p.name)); if (e.args.vararg) scope.params.add(e.args.vararg.name);
    if (e.args.kwarg) this.fail('**kwargs in lambda is not supported', e.line);
    const defs = [], vals = [];
    const ps = e.args.args.map(p => { if (!p.default) return jsName(p.name); const dv = p.default; if (dv.type === 'Constant' && dv.kind !== 'float') return jsName(p.name) + ' = ' + this.withScope(prev, () => this.expr(dv)); const t = '$ld' + (++this.tmpN); defs.push(t); vals.push(this.withScope(prev, () => this.expr(dv))); return jsName(p.name) + ' = ' + t; });
    if (e.args.vararg) ps.push('...' + jsName(e.args.vararg.name));
    const body = this.expr(e.body);
    this.scope = prev;
    const fn = `(${ps.join(', ')}) => ${body.startsWith('{') ? '(' + body + ')' : body}`;
    return defs.length ? `((${defs.join(', ')}) => ${fn})(${vals.join(', ')})` : fn;
  };
  C.comp = function (e, kind) {
    const vars = new Set(); const tv = t => { if (t.type === 'Name') vars.add(t.id); else if (t.type === 'Tuple' || t.type === 'List') t.elts.forEach(tv); };
    e.generators.forEach(g => tv(g.target));
    const scope = newScope('function', this.scope, e); vars.forEach(v => scope.params.add(v));
    const prev = this.scope;
    // the first iterable is evaluated in the enclosing scope (Python semantics)
    const firstIter = this.expr(e.generators[0].iter);
    this.scope = scope;
    const loops = e.generators.map((g, i) => ({ head: `for (${this.forTarget(g.target, e.line)} of py.iter(${i === 0 ? firstIter : this.expr(g.iter)}))`, ifs: g.ifs.map(c => this.cond(c)) }));
    let body;
    if (kind === 'list') body = `$r.push(${this.expr(e.elt)});`;
    else if (kind === 'set') body = `$r.add(${this.expr(e.elt)});`;
    else if (kind === 'dict') body = `py.setitem($r, ${this.expr(e.key)}, ${this.expr(e.value)});`;
    else body = `yield ${this.expr(e.elt)};`;
    this.scope = prev;
    let inner = body;
    for (let i = loops.length - 1; i >= 0; i--) { const c = loops[i].ifs.length ? `if (${loops[i].ifs.join(' && ')}) ` : ''; inner = `${loops[i].head} ${c}${inner}`; }
    const decl = vars.size ? `let ${[...vars].map(jsName).join(', ')}; ` : '';
    if (kind === 'gen') return `(function* () { ${decl}${inner} })()`;
    const init = kind === 'list' ? '[]' : kind === 'set' ? 'py.set()' : 'py.dict()';
    return `(() => { ${decl}const $r = ${init}; ${inner} return $r; })()`;
  };
  C.isModuleName = function (n) { return this.topImports && this.topImports.has(n) && !this.lookupLocalShadow(n); };
  C.lookupLocalShadow = function (n) { for (let s = this.scope; s && s.kind !== 'module'; s = s.parent) if (s.kind !== 'class' && (s.params.has(n) || s.locals.has(n))) return true; return false; };
  C.isSelf = function (n) { for (let s = this.scope; s; s = s.parent) { if (s.kind === 'function' && s.selfName) return s.selfName === n; if (s.kind === 'function' && s.node && s.node.type !== 'Lambda' && s.node.type !== 'ListComp') { if (s.params.has(n) || s.locals.has(n)) return false; } } return false; };
  C.isClassName = function (n) { const d = this.findDef(n); return !!(d && d.kind === 'class'); };
  C.currentClass = function () { for (let s = this.scope; s; s = s.parent) if (s.className) return s.className; return null; };
  C.classByName = function (n) { for (let s = this.scope; s; s = s.parent) if (s.classes && s.classes.has(n)) return s.classes.get(n); return this.moduleScope.classes.get(n) || null; };
  C.findMethod = function (cls, name) { for (let c = cls, guard = 0; c && guard < 50; guard++) { const m = c.body.find(st => st.type === 'FunctionDef' && st.name === name); if (m) return m; const b = c.bases[0]; c = b && b.type === 'Name' ? this.classByName(b.id) : null; } return null; };
  C.args = function (e, sig, what, dropSelf) {
    // positional + keyword arguments → JS argument list, binding keywords to parameter positions at compile time
    const L = e.line;
    if (e.keywords.some(k => k.arg === null)) this.fail(`**dict arguments in calls are not supported (${what})`, L);
    const pos = e.args.map(a => a.type === 'Starred' ? `...py.iter(${this.expr(a.value)})` : this.expr(a));
    if (!e.keywords.length) return pos.join(', ');
    if (!sig) this.fail(`keyword arguments in calls to ${what} are not supported (it isn't a function defined in this file)`, L);
    if (e.args.some(a => a.type === 'Starred')) this.fail('mixing *args and keyword arguments in one call is not supported', L);
    let params = sig.args.args.map(p => p.name); if (dropSelf) params = params.slice(1);
    const slots = pos.slice(); const kwonlyVals = {};
    for (const k of e.keywords) {
      const i = params.indexOf(k.arg);
      if (i >= 0) { if (i < pos.length) this.fail(`${what}() got multiple values for argument '${k.arg}'`, L); slots[i] = this.expr(k.value); }
      else if (sig.args.kwonly.some(p => p.name === k.arg)) kwonlyVals[k.arg] = this.expr(k.value);
      else this.fail(`${what}() got an unexpected keyword argument '${k.arg}'`, L);
    }
    for (let i = 0; i < slots.length; i++) if (slots[i] === undefined) { if (!sig.args.args[i + (dropSelf ? 1 : 0)].default) this.fail(`${what}() missing required argument '${params[i]}'`, L); slots[i] = 'undefined'; }
    if (Object.keys(kwonlyVals).length) {
      if (sig.args.vararg) slots.push(`py.kw({ ${Object.entries(kwonlyVals).map(([k, v]) => `${k}: ${v}`).join(', ')} })`);
      else { const kw = sig.args.kwonly; while (slots.length < params.length) slots.push('undefined'); kw.forEach(p => slots.push(p.name in kwonlyVals ? kwonlyVals[p.name] : 'undefined')); while (slots.length && slots[slots.length - 1] === 'undefined') slots.pop(); }
    }
    return slots.join(', ');
  };
  C.kwArgs = function (e, allowed, what) {
    const L = e.line; if (e.keywords.some(k => k.arg === null)) this.fail(`**dict arguments in calls are not supported (${what})`, L);
    const pos = e.args.map(a => a.type === 'Starred' ? `...py.iter(${this.expr(a.value)})` : this.expr(a));
    if (!e.keywords.length) return pos.join(', ');
    for (const k of e.keywords) if (allowed && !allowed.includes(k.arg)) this.fail(`${what}() got an unsupported keyword argument '${k.arg}'`, L);
    pos.push(`py.kw({ ${e.keywords.map(k => `${/^[A-Za-z_$][\w$]*$/.test(k.arg) ? k.arg : JSON.stringify(k.arg)}: ${this.expr(k.value)}`).join(', ')} })`);
    return pos.join(', ');
  };
  C.posArgs = function (e, names, what) {
    const pos = e.args.map(a => a.type === 'Starred' ? `...py.iter(${this.expr(a.value)})` : this.expr(a));
    for (const k of e.keywords) { const i = names.indexOf(k.arg); if (k.arg === null || i < 0) this.fail(`${what}() keyword argument '${k.arg}' is not supported`, e.line); while (pos.length < i) pos.push('undefined'); pos[i] = this.expr(k.value); }
    return pos.join(', ');
  };
  C.call = function (e) {
    const f = e.func, L = e.line;
    if (f.type === 'Name') {
      const n = f.id, local = this.lookup(n);
      if (!local && n === 'super') this.fail('super() is only supported as super().method(...) inside a method', L);
      if (!local && n in NOT_SUPPORTED_BUILTINS) this.fail(NOT_SUPPORTED_BUILTINS[n], L);
      if (!local && n in BUILTINS) {
        if (n in KW_BUILTINS) return `${BUILTINS[n]}(${this.kwArgs(e, KW_BUILTINS[n], n)})`;
        if (n in POS_BUILTINS && e.keywords.length) return `${BUILTINS[n]}(${this.posArgs(e, POS_BUILTINS[n], n)})`;
        if (e.keywords.length && !EXCEPTIONS.includes(n)) this.fail(`keyword arguments to ${n}() are not supported`, L);
        if (EXCEPTIONS.includes(n)) return `new ${BUILTINS[n]}(${this.args(e, null, n)})`;
        return `${BUILTINS[n]}(${this.args(e, null, n)})`;
      }
      const def = this.findDef(n);
      if (def && def.kind === 'func') return `${jsName(n)}(${this.args(e, def.def, n)})`;
      if (def && def.kind === 'class') { const init = this.findMethod(def.def, '__init__'); return `new ${jsName(n)}(${this.args(e, init, n, true)})`; }
      return `py.call(${this.name(n, L)}${e.args.length || e.keywords.length ? ', ' + this.args(e, null, n) : ''})`;
    }
    if (f.type === 'Attribute') {
      const v = f.value, m = f.attr;
      if (v.type === 'Call' && v.func.type === 'Name' && v.func.id === 'super' && !this.lookup('super')) {
        if (v.args.length) this.fail('super() with arguments is not supported; use super().method(...)', L);
        const cls = this.classByName(this.currentClass() || ''); const base = cls && cls.bases[0] && cls.bases[0].type === 'Name' ? this.classByName(cls.bases[0].id) : null;
        const sig = base ? this.findMethod(base, m) : null;
        return `super.${m}(${this.args(e, sig, 'super().' + m, true)})`;
      }
      if (v.type === 'Name' && this.isModuleName(v.id)) return `${this.expr(v)}.${m}(${this.kwArgs(e, KW_METHODS[m] || [], v.id + '.' + m)})`;
      if (v.type === 'Name' && this.isSelf(v.id)) { const cls = this.classByName(this.currentClass() || ''); const sig = cls ? this.findMethod(cls, m) : null; if (sig || !e.keywords.length) return `${this.expr(v)}.${m}(${this.args(e, sig, m, true)})`; }
      if (v.type === 'Name' && this.isClassName(v.id)) { const sig = this.findMethod(this.classByName(v.id), m); const isStatic = sig && sig.decorators.some(dd => this.decoName(dd) === 'staticmethod'); return `${jsName(v.id)}.${m}(${this.args(e, sig, v.id + '.' + m, !isStatic && sig && sig.decorators.some(dd => this.decoName(dd) === 'classmethod'))})`; }
      const obj = this.expr(v);
      if (e.keywords.length) {
        if (m in KW_METHODS) return `py.callm(${obj}, '${m}'${e.args.length || e.keywords.length ? ', ' + this.kwArgs(e, KW_METHODS[m], m) : ''})`;
        const sigs = this.methodSigs.get(m) || [];
        const names = new Set(sigs.map(s => s.args.args.map(a => a.name).slice(1).join(',')));
        if (sigs.length && names.size === 1) return `py.callm(${obj}, '${m}', ${this.args(e, sigs[0], m, true)})`;
        this.fail(`keyword arguments in the call to .${m}() are not supported here`, L);
      }
      const a = this.args(e, null, m);
      if (this.methodSigs.has(m) && !BUILTIN_METHOD_NAMES.has(m) && !/^__/.test(m)) return `${/^[\w$.]+$/.test(obj) ? obj : '(' + obj + ')'}.${m}(${a})`;
      return `py.callm(${obj}, '${m}'${a ? ', ' + a : ''})`;
    }
    if (e.keywords.length) this.fail('keyword arguments in calls to computed functions are not supported', L);
    const a = this.args(e, null, 'function');
    return `py.call(${this.expr(f)}${a ? ', ' + a : ''})`;
  };

  return { compile };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PyCompile;
