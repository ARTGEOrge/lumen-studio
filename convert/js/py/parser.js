/* Lumen Convert — Python 3 tokenizer + recursive-descent parser producing a Python-style AST
   (Module, FunctionDef, ClassDef, For, If, ..., BinOp, Call, Subscript, JoinedStr ...), with line numbers. */
var PyParse = (function () {
  'use strict';
  class PySyntaxError extends Error { constructor(msg, line, col) { super(msg); this.line = line; this.col = col; } }
  const KEYWORDS = new Set('False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' '));
  const OPS = ['**=', '//=', '>>=', '<<=', '...', '->', ':=', '**', '//', '<<', '>>', '<=', '>=', '==', '!=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=', '+', '-', '*', '/', '%', '@', '&', '|', '^', '~', '<', '>', '(', ')', '[', ']', '{', '}', ',', ':', '.', ';', '='];
  const ESC = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', v: '\v', 0: '\0', '\n': '' };
  function unescape(s, line) {
    return s.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|[0-7]{1,3}|N\{[^}]+\}|[\s\S])/g, (m, e) => {
      if (e[0] === 'x' || e[0] === 'u' || e[0] === 'U') return String.fromCodePoint(parseInt(e.slice(1), 16));
      if (/^[0-7]+$/.test(e)) return String.fromCodePoint(parseInt(e, 8));
      if (e[0] === 'N' && e[1] === '{') throw new PySyntaxError('\\N{...} escapes are not supported', line);
      return e in ESC ? ESC[e] : '\\' + e;
    });
  }
  /* ---------------- tokenizer ---------------- */
  function tokenize(src) {
    src = src.replace(/\r\n?/g, '\n').replace(/^﻿/, ''); if (!src.endsWith('\n')) src += '\n';
    const toks = [], comments = [], indents = [0]; let i = 0, line = 1, depth = 0, atLineStart = true;
    const push = (type, value, extra) => toks.push({ type, value, line, ...extra });
    while (i < src.length) {
      if (atLineStart && depth === 0) {
        let col = 0, j = i;
        while (src[j] === ' ' || src[j] === '\t' || src[j] === '\f') { col = src[j] === '\t' ? (Math.floor(col / 8) + 1) * 8 : col + 1; j++; }
        if (src[j] === '\n' || src[j] === '#') { // blank or comment-only line
          if (src[j] === '#') { let k = j; while (src[k] !== '\n') k++; comments.push({ line, text: src.slice(j + 1, k), full: true, col }); j = k; }
          i = j + 1; line++; continue;
        }
        if (src[j] === '\\' && src[j + 1] === '\n') { i = j + 2; line++; continue; }
        i = j; atLineStart = false;
        if (col > indents[indents.length - 1]) { indents.push(col); push('INDENT'); }
        else { while (col < indents[indents.length - 1]) { indents.pop(); push('DEDENT'); } if (col !== indents[indents.length - 1]) throw new PySyntaxError('unindent does not match any outer indentation level', line); }
      }
      const c = src[i];
      if (c === '\n') { if (depth === 0) { push('NEWLINE'); atLineStart = true; } line++; i++; continue; }
      if (c === ' ' || c === '\t' || c === '\f') { i++; continue; }
      if (c === '#') { let k = i; while (src[k] !== '\n') k++; comments.push({ line, text: src.slice(i + 1, k), full: false }); i = k; continue; }
      if (c === '\\' && src[i + 1] === '\n') { i += 2; line++; continue; }
      // strings (with prefixes)
      const sm = /^([rRbBuUfF]{0,2})('''|"""|'|")/.exec(src.slice(i, i + 5));
      if (sm && (sm[1] === '' || /^(r|u|b|f|br|rb|fr|rf)$/i.test(sm[1])) && (sm[1] || true)) {
        const prefix = sm[1].toLowerCase(), q = sm[2], startLine = line; let j = i + sm[0].length, body = '';
        for (;;) {
          if (j >= src.length) throw new PySyntaxError('unterminated string literal', startLine);
          if (src.startsWith(q, j)) { j += q.length; break; }
          if (src[j] === '\\') { body += src[j] + (src[j + 1] || ''); if (src[j + 1] === '\n') line++; j += 2; continue; }
          if (src[j] === '\n') { if (q.length === 1) throw new PySyntaxError('unterminated string literal', startLine); line++; }
          body += src[j]; j++;
        }
        const tline = line; line = startLine;
        if (prefix.includes('b')) push('BYTES', body);
        else if (prefix.includes('f')) push('FSTRING', body, { raw: prefix.includes('r') });
        else push('STRING', prefix.includes('r') ? body : unescape(body, startLine));
        line = tline; i = j; continue;
      }
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1]))) {
        const m = /^(0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?)([jJ])?/.exec(src.slice(i));
        if (m[2]) throw new PySyntaxError('complex numbers (j) are not supported', line);
        const t = m[1].replace(/_/g, '');
        if (/^0[xob]/i.test(t)) push('NUMBER', BigInt(t).toString(), { kind: 'int' });
        else if (/[.eE]/.test(t)) push('NUMBER', t, { kind: 'float' });
        else push('NUMBER', BigInt(t).toString(), { kind: 'int' });
        i += m[0].length; continue;
      }
      if (/[A-Za-z_\u0080-￿]/.test(c)) {
        const m = /^[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*/.exec(src.slice(i)); const w = m[0];
        push(KEYWORDS.has(w) ? 'KW' : 'NAME', w); i += w.length; continue;
      }
      const op = OPS.find(o => src.startsWith(o, i));
      if (!op) throw new PySyntaxError(`invalid character '${c}'`, line);
      if ('([{'.includes(op)) depth++; else if (')]}'.includes(op)) depth = Math.max(0, depth - 1);
      push('OP', op); i += op.length;
    }
    if (toks.length && toks[toks.length - 1].type !== 'NEWLINE') push('NEWLINE');
    while (indents.length > 1) { indents.pop(); push('DEDENT'); }
    push('EOF');
    return { toks, comments };
  }
  /* ---------------- parser ---------------- */
  function Parser(toks) { this.t = toks; this.p = 0; }
  const P = Parser.prototype;
  P.peek = function (k = 0) { return this.t[this.p + k]; };
  P.next = function () { return this.t[this.p++]; };
  P.is = function (type, value, k = 0) { const t = this.t[this.p + k]; return t && t.type === type && (value === undefined || t.value === value); };
  P.op = function (v, k) { return this.is('OP', v, k); };
  P.kw = function (v, k) { return this.is('KW', v, k); };
  P.eat = function (type, value) { if (this.is(type, value)) return this.next(); return null; };
  P.expect = function (type, value, what) { const t = this.peek(); if (!this.is(type, value)) throw new PySyntaxError(`expected ${what || value || type}` + (t ? ` but found ${t.type === 'EOF' ? 'end of file' : t.type === 'NEWLINE' ? 'end of line' : `'${t.value || t.type}'`}` : ''), t ? t.line : 0); return this.next(); };
  P.line = function () { return this.peek().line; };
  P.parseModule = function () { const body = []; while (!this.is('EOF')) { if (this.eat('NEWLINE')) continue; body.push(...this.statement()); } return { type: 'Module', body }; };
  P.block = function () {
    this.expect('OP', ':');
    if (this.eat('NEWLINE')) { this.expect('INDENT', undefined, 'an indented block'); const body = []; while (!this.eat('DEDENT')) { if (this.eat('NEWLINE')) continue; body.push(...this.statement()); } return body; }
    return this.simpleStatements();
  };
  P.statement = function () {
    const t = this.peek();
    if (t.type === 'KW') switch (t.value) {
      case 'if': return [this.ifStmt()]; case 'while': return [this.whileStmt()]; case 'for': return [this.forStmt()];
      case 'try': return [this.tryStmt()]; case 'with': return [this.withStmt()]; case 'def': return [this.funcDef([])]; case 'class': return [this.classDef([])];
      case 'async': { this.next(); const st = this.statement(); st.forEach(n => { n.unsupported = `async ${n.type === 'FunctionDef' ? 'functions' : n.type === 'For' ? 'for loops' : 'with blocks'} are not supported`; }); return st; }
    }
    if (this.op('@')) { const decos = []; while (this.op('@')) { const line = this.line(); this.next(); decos.push({ expr: this.namedExpr(), line }); this.expect('NEWLINE'); } if (this.kw('def')) return [this.funcDef(decos)]; if (this.kw('class')) return [this.classDef(decos)]; throw new PySyntaxError('expected def or class after decorator', this.line()); }
    if (this.is('NAME', 'match') && !this.op('=', 1) && !this.op('.', 1) && !this.op('(', 1) && !this.op('[', 1) && !this.op(',', 1) && this.is('NAME', undefined, 1)) throw new PySyntaxError('match statements are not supported', t.line);
    return this.simpleStatements();
  };
  P.simpleStatements = function () { const out = [this.smallStmt()]; while (this.eat('OP', ';')) { if (this.is('NEWLINE')) break; out.push(this.smallStmt()); } this.expect('NEWLINE', undefined, 'end of line'); return out; };
  P.smallStmt = function () {
    const line = this.line(), t = this.peek();
    if (t.type === 'KW') switch (t.value) {
      case 'pass': this.next(); return { type: 'Pass', line };
      case 'break': this.next(); return { type: 'Break', line };
      case 'continue': this.next(); return { type: 'Continue', line };
      case 'return': this.next(); return { type: 'Return', value: this.atStmtEnd() ? null : this.testListStar(), line };
      case 'raise': { this.next(); if (this.atStmtEnd()) return { type: 'Raise', exc: null, line }; const exc = this.test(); const cause = this.eat('KW', 'from') ? this.test() : null; return { type: 'Raise', exc, cause, line }; }
      case 'global': case 'nonlocal': { this.next(); const names = [this.expect('NAME').value]; while (this.eat('OP', ',')) names.push(this.expect('NAME').value); return { type: t.value === 'global' ? 'Global' : 'Nonlocal', names, line }; }
      case 'del': { this.next(); const targets = [this.expr()]; while (this.eat('OP', ',')) { if (this.atStmtEnd()) break; targets.push(this.expr()); } return { type: 'Delete', targets, line }; }
      case 'assert': { this.next(); const test = this.test(); const msg = this.eat('OP', ',') ? this.test() : null; return { type: 'Assert', test, msg, line }; }
      case 'import': { this.next(); const names = []; do { let n = this.expect('NAME').value; while (this.eat('OP', '.')) n += '.' + this.expect('NAME').value; names.push({ name: n, asname: this.eat('KW', 'as') ? this.expect('NAME').value : null }); } while (this.eat('OP', ',')); return { type: 'Import', names, line }; }
      case 'from': { this.next(); let level = 0; while (this.op('.') || this.op('...')) level += this.next().value.length; let mod = this.is('NAME') ? this.next().value : ''; while (this.eat('OP', '.')) mod += '.' + this.expect('NAME').value; this.expect('KW', 'import'); const names = []; const paren = this.eat('OP', '('); if (this.eat('OP', '*')) names.push({ name: '*' }); else do { if (paren && this.op(')')) break; names.push({ name: this.expect('NAME').value, asname: this.eat('KW', 'as') ? this.expect('NAME').value : null }); } while (this.eat('OP', ',')); if (paren) this.expect('OP', ')'); return { type: 'ImportFrom', module: mod, names, level, line }; }
    }
    const e = this.testListStar(true);
    if (this.op('=')) { const targets = [e]; let value; while (this.eat('OP', '=')) { value = this.is('KW', 'yield') ? this.yieldExpr() : this.testListStar(true); targets.push(value); } targets.pop(); targets.forEach(x => this.checkTarget(x)); return { type: 'Assign', targets, value, line }; }
    const aug = this.peek(); if (aug.type === 'OP' && /^(\+|-|\*|\/|\/\/|%|\*\*|>>|<<|&|\||\^|@)=$/.test(aug.value)) { this.next(); this.checkTarget(e, true); const value = this.is('KW', 'yield') ? this.yieldExpr() : this.testList(); return { type: 'AugAssign', target: e, op: aug.value.slice(0, -1), value, line }; }
    if (this.op(':')) { this.next(); this.checkTarget(e, true); const annotation = this.test(); const value = this.eat('OP', '=') ? this.testListStar() : null; return { type: 'AnnAssign', target: e, annotation, value, line }; }
    return { type: 'Expr', value: e, line };
  };
  P.atStmtEnd = function () { return this.is('NEWLINE') || this.op(';') || this.is('EOF'); };
  P.checkTarget = function (e, single) {
    const ok = ['Name', 'Attribute', 'Subscript'].includes(e.type) || (!single && ['Tuple', 'List'].includes(e.type) && e.elts.every(x => (x.type === 'Starred' ? (this.checkTarget(x.value), true) : (this.checkTarget(x), true))));
    if (!ok) throw new PySyntaxError(`cannot assign to ${e.type === 'Call' ? 'function call' : e.type === 'Constant' ? 'literal' : 'expression'}`, e.line);
  };
  P.ifStmt = function () { const line = this.line(); this.next(); const test = this.namedExpr(); const body = this.block(); let orelse = []; if (this.kw('elif')) { orelse = [this.ifStmt()]; } else if (this.eat('KW', 'else')) orelse = this.block(); return { type: 'If', test, body, orelse, line }; };
  P.whileStmt = function () { const line = this.line(); this.next(); const test = this.namedExpr(); const body = this.block(); const orelse = this.eat('KW', 'else') ? this.block() : []; return { type: 'While', test, body, orelse, line }; };
  P.forStmt = function () { const line = this.line(); this.next(); const target = this.targetList(); this.expect('KW', 'in'); const iter = this.testList(); const body = this.block(); const orelse = this.eat('KW', 'else') ? this.block() : []; return { type: 'For', target, iter, body, orelse, line }; };
  P.targetList = function () { const line = this.line(); const elts = [this.starOr(() => this.expr())]; let tuple = false; while (this.op(',')) { this.next(); tuple = true; if (this.kw('in') || this.op('=')) break; elts.push(this.starOr(() => this.expr())); } const t = tuple ? { type: 'Tuple', elts, line } : elts[0]; this.checkTarget(t); return t; };
  P.tryStmt = function () {
    const line = this.line(); this.next(); const body = this.block(); const handlers = []; let orelse = [], finalbody = [];
    while (this.kw('except')) { const hl = this.line(); this.next(); if (this.op('*')) throw new PySyntaxError('except* is not supported', hl); let type = null, name = null; if (!this.op(':')) { type = this.test(); if (this.eat('KW', 'as')) name = this.expect('NAME').value; else if (this.op(',')) throw new PySyntaxError('multiple exception types must be parenthesized', hl); } handlers.push({ type, name, body: this.block(), line: hl }); }
    if (this.eat('KW', 'else')) orelse = this.block();
    if (this.eat('KW', 'finally')) finalbody = this.block();
    if (!handlers.length && !finalbody.length) throw new PySyntaxError("expected 'except' or 'finally' block", line);
    return { type: 'Try', body, handlers, orelse, finalbody, line };
  };
  P.withStmt = function () { const line = this.line(); this.next(); const items = []; const paren = this.op('(') && this.withParen(); if (paren) this.next(); do { if (paren && this.op(')')) break; const expr = this.test(); const vars = this.eat('KW', 'as') ? this.targetAtom() : null; items.push({ expr, vars }); } while (this.eat('OP', ',')); if (paren) this.expect('OP', ')'); return { type: 'With', items, body: this.block(), line }; };
  P.withParen = function () { let d = 0; for (let k = this.p; k < this.t.length; k++) { const t = this.t[k]; if (t.type === 'OP' && '([{'.includes(t.value)) d++; else if (t.type === 'OP' && ')]}'.includes(t.value)) { d--; if (d === 0) return this.t[k + 1] && this.t[k + 1].type === 'OP' && this.t[k + 1].value === ':' && this.t.slice(this.p, k).some(x => x.type === 'KW' && x.value === 'as'); } } return false; };
  P.targetAtom = function () { const e = this.expr(); this.checkTarget(e); return e; };
  P.funcDef = function (decorators) {
    const line = this.line(); this.expect('KW', 'def'); const name = this.expect('NAME').value; this.expect('OP', '(');
    const args = this.paramList(')'); this.expect('OP', ')');
    if (this.eat('OP', '->')) this.test();
    return { type: 'FunctionDef', name, args, body: this.block(), decorators, line };
  };
  P.paramList = function (close) {
    const a = { args: [], vararg: null, kwonly: [], kwarg: null, posonly: 0 };
    let seenStar = false;
    while (!this.op(close) && !(close === ':' && this.op(':'))) {
      const line = this.line();
      if (this.eat('OP', '/')) { a.posonly = a.args.length; } else if (this.eat('OP', '**')) { a.kwarg = { name: this.expect('NAME').value, line }; if (close === ')' && this.op(':')) { this.next(); this.test(); } }
      else if (this.eat('OP', '*')) { seenStar = true; if (this.is('NAME')) { a.vararg = { name: this.next().value, line }; if (close === ')' && this.eat('OP', ':')) this.test(); } }
      else {
        const pname = this.expect('NAME').value; if (close === ')' && this.eat('OP', ':')) this.test();
        const def = this.eat('OP', '=') ? this.test() : null; const prm = { name: pname, default: def, line };
        (seenStar ? a.kwonly : a.args).push(prm);
      }
      if (!this.eat('OP', ',')) break;
    }
    return a;
  };
  P.classDef = function (decorators) {
    const line = this.line(); this.expect('KW', 'class'); const name = this.expect('NAME').value; let bases = [], keywords = [];
    if (this.eat('OP', '(')) { if (!this.op(')')) { const r = this.callArgs(); bases = r.args; keywords = r.keywords; } this.expect('OP', ')'); }
    return { type: 'ClassDef', name, bases, keywords, body: this.block(), decorators, line };
  };
  // ---------- expressions ----------
  P.testListStar = function (allowYield) {
    if (allowYield && this.kw('yield')) return this.yieldExpr();
    const line = this.line(); const first = this.starOr(() => this.namedExpr());
    if (!this.op(',')) return first;
    const elts = [first]; while (this.eat('OP', ',')) { if (this.atTupleEnd()) break; elts.push(this.starOr(() => this.namedExpr())); }
    return { type: 'Tuple', elts, line };
  };
  P.atTupleEnd = function () { return this.atStmtEnd() || this.op('=') || this.op(')') || this.op(']') || this.op('}') || this.op(':') || this.is('KW', 'in') || (this.peek().type === 'OP' && /=$/.test(this.peek().value) && !['==', '<=', '>=', '!='].includes(this.peek().value)); };
  P.testList = function () { const line = this.line(); const first = this.starOr(() => this.test()); if (!this.op(',')) return first; const elts = [first]; while (this.eat('OP', ',')) { if (this.atTupleEnd()) break; elts.push(this.starOr(() => this.test())); } return { type: 'Tuple', elts, line }; };
  P.starOr = function (fn) { if (this.op('*')) { const line = this.line(); this.next(); return { type: 'Starred', value: this.expr(), line }; } return fn(); };
  P.yieldExpr = function () { const line = this.line(); this.expect('KW', 'yield'); if (this.eat('KW', 'from')) return { type: 'YieldFrom', value: this.test(), line }; return { type: 'Yield', value: this.atStmtEnd() || this.op(')') ? null : this.testList(), line }; };
  P.namedExpr = function () { if (this.is('NAME') && this.op(':=', 1)) { const line = this.line(); const target = { type: 'Name', id: this.next().value, line }; this.next(); return { type: 'NamedExpr', target, value: this.test(), line }; } return this.test(); };
  P.test = function () {
    if (this.kw('lambda')) { const line = this.line(); this.next(); const args = this.paramList(':'); this.expect('OP', ':'); return { type: 'Lambda', args, body: this.test(), line }; }
    const line = this.line(); const e = this.orTest();
    if (this.kw('if') ) { this.next(); const test = this.orTest(); this.expect('KW', 'else'); const orelse = this.test(); return { type: 'IfExp', test, body: e, orelse, line }; }
    return e;
  };
  P.testNoCond = function () { return this.orTest(); };
  P.orTest = function () { const line = this.line(); let e = this.andTest(); if (!this.kw('or')) return e; const values = [e]; while (this.eat('KW', 'or')) values.push(this.andTest()); return { type: 'BoolOp', op: 'or', values, line }; };
  P.andTest = function () { const line = this.line(); let e = this.notTest(); if (!this.kw('and')) return e; const values = [e]; while (this.eat('KW', 'and')) values.push(this.notTest()); return { type: 'BoolOp', op: 'and', values, line }; };
  P.notTest = function () { if (this.kw('not')) { const line = this.line(); this.next(); return { type: 'UnaryOp', op: 'not', operand: this.notTest(), line }; } return this.comparison(); };
  P.comparison = function () {
    const line = this.line(); const left = this.expr(); const ops = [], comparators = [];
    for (;;) {
      let op = null; const t = this.peek();
      if (t.type === 'OP' && ['<', '>', '==', '>=', '<=', '!='].includes(t.value)) { this.next(); op = t.value; }
      else if (this.kw('in')) { this.next(); op = 'in'; }
      else if (this.kw('not') && this.kw('in', 1)) { this.next(); this.next(); op = 'not in'; }
      else if (this.kw('is')) { this.next(); op = this.eat('KW', 'not') ? 'is not' : 'is'; }
      if (!op) break; ops.push(op); comparators.push(this.expr());
    }
    return ops.length ? { type: 'Compare', left, ops, comparators, line } : left;
  };
  const BIN = [['|'], ['^'], ['&'], ['<<', '>>'], ['+', '-'], ['*', '/', '//', '%', '@']];
  P.expr = function (level = 0) {
    if (level === BIN.length) return this.factor();
    const line = this.line(); let left = this.expr(level + 1);
    while (this.peek().type === 'OP' && BIN[level].includes(this.peek().value)) { const op = this.next().value; left = { type: 'BinOp', left, op, right: this.expr(level + 1), line }; }
    return left;
  };
  P.factor = function () { const t = this.peek(); if (t.type === 'OP' && ['+', '-', '~'].includes(t.value)) { this.next(); return { type: 'UnaryOp', op: t.value, operand: this.factor(), line: t.line }; } return this.power(); };
  P.power = function () { const line = this.line(); if (this.kw('await')) { this.next(); return { type: 'Await', value: this.power(), line }; } const base = this.atomExpr(); if (this.eat('OP', '**')) return { type: 'BinOp', left: base, op: '**', right: this.factor(), line }; return base; };
  P.atomExpr = function () {
    let e = this.atom();
    for (;;) {
      const line = this.line();
      if (this.eat('OP', '(')) { const r = this.op(')') ? { args: [], keywords: [] } : this.callArgs(); this.expect('OP', ')'); e = { type: 'Call', func: e, args: r.args, keywords: r.keywords, line }; }
      else if (this.eat('OP', '[')) { const s = this.subscriptList(); this.expect('OP', ']'); e = { type: 'Subscript', value: e, slice: s, line }; }
      else if (this.eat('OP', '.')) { const n = this.next(); if (n.type !== 'NAME' && n.type !== 'KW') throw new PySyntaxError('expected attribute name', line); e = { type: 'Attribute', value: e, attr: n.value, line }; }
      else return e;
    }
  };
  P.callArgs = function () {
    const args = [], keywords = [];
    while (!this.op(')')) {
      const line = this.line();
      if (this.eat('OP', '**')) keywords.push({ arg: null, value: this.test(), line });
      else if (this.eat('OP', '*')) args.push({ type: 'Starred', value: this.test(), line });
      else if (this.is('NAME') && this.op('=', 1)) { const arg = this.next().value; this.next(); keywords.push({ arg, value: this.test(), line }); }
      else {
        const e = this.namedExpr();
        if (this.kw('for') || this.kw('async')) { args.push({ type: 'GeneratorExp', elt: e, generators: this.compFor(), line }); }
        else args.push(e);
      }
      if (!this.eat('OP', ',')) break;
    }
    return { args, keywords };
  };
  P.subscriptList = function () { const line = this.line(); const first = this.subscript(); if (!this.op(',')) return first; const elts = [first]; while (this.eat('OP', ',')) { if (this.op(']')) break; elts.push(this.subscript()); } return { type: 'Tuple', elts, line }; };
  P.subscript = function () {
    const line = this.line(); let lower = null, upper = null, step = null;
    if (!this.op(':')) { lower = this.namedExpr(); if (!this.op(':')) return lower; }
    this.expect('OP', ':'); if (!this.op(']') && !this.op(':') && !this.op(',')) upper = this.test();
    if (this.eat('OP', ':')) { if (!this.op(']') && !this.op(',')) step = this.test(); }
    return { type: 'Slice', lower, upper, step, line };
  };
  P.compFor = function () {
    const gens = [];
    while (this.kw('for') || this.kw('async')) {
      if (this.kw('async')) throw new PySyntaxError('async comprehensions are not supported', this.line());
      this.next(); const target = this.targetList(); this.expect('KW', 'in'); const iter = this.orTest(); const ifs = [];
      while (this.kw('if')) { this.next(); ifs.push(this.testNoCondChain()); }
      gens.push({ target, iter, ifs });
    }
    return gens;
  };
  P.testNoCondChain = function () { return this.orTest(); };
  P.atom = function () {
    const t = this.peek(), line = t.line;
    if (t.type === 'NAME') { this.next(); return { type: 'Name', id: t.value, line }; }
    if (t.type === 'NUMBER') { this.next(); return { type: 'Constant', kind: t.kind, value: t.value, line }; }
    if (t.type === 'STRING' || t.type === 'FSTRING' || t.type === 'BYTES') {
      const parts = []; let hasF = false, hasB = false, hasS = false;
      while (this.is('STRING') || this.is('FSTRING') || this.is('BYTES')) { const s = this.next(); if (s.type === 'BYTES') hasB = true; else hasS = true; if (s.type === 'FSTRING') { hasF = true; parts.push(...parseFString(s.value, s.raw, s.line)); } else parts.push(s.value); }
      if (hasB) throw new PySyntaxError('bytes literals are not supported', line);
      if (!hasF) return { type: 'Constant', kind: 'str', value: parts.join(''), line };
      const merged = []; for (const p of parts) { if (typeof p === 'string' && typeof merged[merged.length - 1] === 'string') merged[merged.length - 1] += p; else merged.push(p); }
      return { type: 'JoinedStr', values: merged, line };
    }
    if (t.type === 'KW') {
      if (t.value === 'None' || t.value === 'True' || t.value === 'False') { this.next(); return { type: 'Constant', kind: t.value === 'None' ? 'None' : 'bool', value: t.value === 'True', line }; }
      if (t.value === 'yield') throw new PySyntaxError('yield must be the whole statement or inside parentheses as a statement; yield used as a value is not supported', line);
      if (t.value === 'lambda') return this.test();
    }
    if (t.type === 'OP') {
      if (t.value === '...') { this.next(); return { type: 'Constant', kind: 'ellipsis', value: null, line }; }
      if (t.value === '(') {
        this.next(); if (this.eat('OP', ')')) return { type: 'Tuple', elts: [], line };
        if (this.kw('yield')) { const y = this.yieldExpr(); this.expect('OP', ')'); return y; }
        const first = this.starOr(() => this.namedExpr());
        if (this.kw('for')) { const g = this.compFor(); this.expect('OP', ')'); return { type: 'GeneratorExp', elt: first, generators: g, line }; }
        if (this.eat('OP', ')')) return first.type === 'Starred' ? (() => { throw new PySyntaxError("can't use starred expression here", line); })() : { ...first, paren: true };
        const elts = [first]; while (this.eat('OP', ',')) { if (this.op(')')) break; elts.push(this.starOr(() => this.namedExpr())); } this.expect('OP', ')');
        return { type: 'Tuple', elts, line };
      }
      if (t.value === '[') {
        this.next(); if (this.eat('OP', ']')) return { type: 'List', elts: [], line };
        const first = this.starOr(() => this.namedExpr());
        if (this.kw('for')) { const g = this.compFor(); this.expect('OP', ']'); return { type: 'ListComp', elt: first, generators: g, line }; }
        const elts = [first]; while (this.eat('OP', ',')) { if (this.op(']')) break; elts.push(this.starOr(() => this.namedExpr())); } this.expect('OP', ']');
        return { type: 'List', elts, line };
      }
      if (t.value === '{') {
        this.next(); if (this.eat('OP', '}')) return { type: 'Dict', keys: [], values: [], line };
        if (this.eat('OP', '**')) { const keys = [null], values = [this.expr()]; return this.dictRest(keys, values, line); }
        const first = this.starOr(() => this.test());
        if (this.eat('OP', ':')) {
          const v = this.test();
          if (this.kw('for')) { const g = this.compFor(); this.expect('OP', '}'); return { type: 'DictComp', key: first, value: v, generators: g, line }; }
          return this.dictRest([first], [v], line);
        }
        if (this.kw('for')) { const g = this.compFor(); this.expect('OP', '}'); return { type: 'SetComp', elt: first, generators: g, line }; }
        const elts = [first]; while (this.eat('OP', ',')) { if (this.op('}')) break; elts.push(this.starOr(() => this.test())); } this.expect('OP', '}');
        return { type: 'Set', elts, line };
      }
    }
    throw new PySyntaxError(`invalid syntax near ${t.type === 'NEWLINE' ? 'end of line' : t.type === 'EOF' ? 'end of file' : `'${t.value || t.type}'`}`, line);
  };
  P.dictRest = function (keys, values, line) {
    while (this.eat('OP', ',')) { if (this.op('}')) break; if (this.eat('OP', '**')) { keys.push(null); values.push(this.expr()); } else { keys.push(this.test()); this.expect('OP', ':'); values.push(this.test()); } }
    this.expect('OP', '}'); return { type: 'Dict', keys, values, line };
  };
  // f-string: literal text and {expr!conv:spec} parts (spec may itself contain {expr})
  function parseFString(s, raw, line) {
    const parts = []; let i = 0, lit = '';
    const flush = () => { if (lit) { parts.push(raw ? lit : unescape(lit, line)); lit = ''; } };
    while (i < s.length) {
      const c = s[i];
      if (c === '{' && s[i + 1] === '{') { lit += '{'; i += 2; continue; }
      if (c === '}' && s[i + 1] === '}') { lit += '}'; i += 2; continue; }
      if (c === '}') throw new PySyntaxError("f-string: single '}' is not allowed", line);
      if (c !== '{') { lit += c; i++; continue; }
      flush();
      let j = i + 1, depth = 0, q = null, exprEnd = -1, conv = null;
      for (; j < s.length; j++) {
        const d = s[j];
        if (q) { if (d === q) q = null; continue; }
        if (d === "'" || d === '"') { q = d; continue; }
        if ('([{'.includes(d)) depth++;
        else if (')]}'.includes(d)) { if (depth === 0) { exprEnd = j; break; } depth--; }
        else if (depth === 0 && d === '!' && s[j + 1] !== '=') { exprEnd = j; break; }
        else if (depth === 0 && d === ':') { exprEnd = j; break; }
      }
      if (exprEnd < 0) throw new PySyntaxError("f-string: expecting '}'", line);
      let exprSrc = s.slice(i + 1, exprEnd), selfDoc = false;
      if (/=\s*$/.test(exprSrc) && !/[=!<>]=\s*$/.test(exprSrc)) { selfDoc = true; }
      const docText = exprSrc; if (selfDoc) exprSrc = exprSrc.replace(/=\s*$/, '');
      j = exprEnd;
      if (s[j] === '!') { conv = s[j + 1]; if (!'rsa'.includes(conv)) throw new PySyntaxError('f-string: invalid conversion character', line); j += 2; }
      let spec = null;
      if (s[j] === ':') { let k = j + 1, d2 = 0; for (; k < s.length; k++) { if (s[k] === '{') d2++; else if (s[k] === '}') { if (d2 === 0) break; d2--; } } spec = parseFString(s.slice(j + 1, k), true, line); j = k; }
      if (s[j] !== '}') throw new PySyntaxError("f-string: expecting '}'", line);
      if (!exprSrc.trim()) throw new PySyntaxError('f-string: empty expression not allowed', line);
      const { toks } = tokenize('(' + exprSrc.replace(/\n/g, ' ') + ')\n');
      toks.forEach(t => { t.line = line; });
      const p = new Parser(toks); p.next(); const expr = p.testListStar(); p.expect('OP', ')');
      if (selfDoc) { parts.push(docText); if (!conv && !spec) conv = 'r'; }
      parts.push({ expr, conv, spec });
      i = j + 1;
    }
    flush();
    return parts;
  }
  function parse(src) { const { toks, comments } = tokenize(src); const p = new Parser(toks); const mod = p.parseModule(); mod.comments = comments; return mod; }
  return { parse, tokenize, PySyntaxError };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PyParse;
