// Lumen Lab — lexer and parser for a MATLAB-compatible language subset.
(function (root) {
  'use strict';
  const M = typeof module === 'object' && module.exports ? require('./mat.js') : root.LabMat;
  const KW = new Set(['if', 'elseif', 'else', 'end', 'for', 'parfor', 'while', 'break', 'continue', 'return', 'function', 'switch', 'case', 'otherwise', 'try', 'catch', 'global', 'persistent', 'do', 'until', 'endfunction', 'endif', 'endfor', 'endwhile']);
  // words that accept "command syntax" (hold on, format long, close all …)
  const CMD = new Set(['hold', 'grid', 'axis', 'close', 'clc', 'clear', 'clearvars', 'format', 'figure', 'clf', 'box', 'colorbar', 'colormap', 'shading', 'legend', 'more', 'warning', 'who', 'whos', 'help', 'doc', 'rotate3d', 'disp', 'echo', 'load', 'save', 'type', 'edit', 'cd', 'pkg', 'tic', 'drawnow', 'syms', 'yyaxis', 'fclose', 'dbstop', 'dbclear', 'dbstatus', 'dbstep', 'dbcont', 'dbquit', 'dbstack', 'dbup', 'dbdown', 'profile']);
  const synErr = (msg, line) => { const e = new M.LabError(msg, 'MATLAB:parse'); e.line = line; throw e; };

  // ---------- lexer ----------
  function lex(src) {
    const toks = [], stack = []; let i = 0, line = 1, sawSpace = false, stmtStart = true;
    const n = src.length;
    const push = (t, v, extra) => { toks.push(Object.assign({ t, v, line, sp: sawSpace }, extra)); sawSpace = false; stmtStart = (t === 'nl' || (t === ';' || t === ',') && !inBr()); };
    const inBr = () => stack.length && stack[stack.length - 1] !== '(';
    const last = () => toks[toks.length - 1];
    const valueEnd = () => { const t = last(); if (!t) return false; return t.t === 'num' || t.t === 'str' || t.t === 'id' || (t.t === 'kw' && t.v === 'end') || (t.t === 'op' && (t.v === ')' || t.v === ']' || t.v === '}' || t.v === "'" || t.v === ".'")); };
    const isIdStart = c => /[A-Za-z_]/.test(c), isId = c => /[A-Za-z0-9_]/.test(c), isDigit = c => c >= '0' && c <= '9';
    while (i < n) {
      const c = src[i];
      // block comment %{ … %} on their own lines
      if (c === '%' && src[i + 1] === '{' && /^[ \t]*$/.test(src.slice(src.lastIndexOf('\n', i - 1) + 1, i)) && /^\{[ \t]*(\r?\n|$)/.test(src.slice(i + 1, i + 4))) {
        let depth = 0, j = i;
        while (j < n) {
          const eol = src.indexOf('\n', j), ln = src.slice(j, eol < 0 ? n : eol).trim();
          if (ln === '%{') depth++; else if (ln === '%}') depth--;
          if (eol < 0) { j = n; break; }
          j = eol + 1; line++;
          if (depth === 0) break;
        }
        i = j; if (!inBr()) push('nl', '\n'); continue;
      }
      if (c === '%' || (c === '#' && !inBr())) { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '.' && src.startsWith('...', i)) { while (i < n && src[i] !== '\n') i++; i++; line++; sawSpace = true; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { i++; sawSpace = true; continue; }
      if (c === '\n') {
        i++;
        if (inBr()) { if (!(last() && (last().t === ';' || (last().t === 'op' && (last().v === '[' || last().v === '{'))))) push(';', ';', { row: true }); }
        else if (!stack.length) push('nl', '\n');
        line++; continue;
      }
      // implicit comma between whitespace-separated elements inside [ ] and { }
      if (inBr() && sawSpace && valueEnd()) {
        const nx = src[i + 1] || '';
        const startsValue = isIdStart(c) || isDigit(c) || c === '(' || c === '[' || c === '{' || c === "'" || c === '"' || c === '@' || (c === '.' && isDigit(nx)) || (c === '~' && nx !== '=');
        const signed = (c === '+' || c === '-') && nx !== ' ' && nx !== '\t' && nx !== '=' && !(c === '+' && nx === '+');
        if (startsValue || signed) push(',', ',', { implicit: true });
      }
      // command syntax: hold on / format long / close all
      if (stmtStart && !stack.length && isIdStart(c)) {
        let j = i; while (j < n && isId(src[j])) j++;
        const word = src.slice(i, j);
        if (word === 'dbstop') { // dbstop in f at 12 if x(k) >= 3 — the condition may hold any characters
          const rest = src.slice(j).match(/^[ \t]+([^\n;%]*?)[ \t]*(?=[\n;%]|$)/);
          if (rest && rest[1] && /^(in|if)\b/.test(rest[1].trim())) {
            const m = rest[1].trim().match(/^(.*?)\s+if\s+(.+)$/), head = m && !/^if$/.test(m[1]) ? m[1] : rest[1].trim();
            const args = head.split(/\s+/); if (m && head === m[1]) args.push('if', m[2].trim());
            push('cmd', word, { args }); i = j + rest[0].length; continue;
          }
        }
        if (CMD.has(word)) {
          const rest = src.slice(j).match(/^[ \t]+([^\n;,%=(]*?)[ \t]*(?=[\n;,%]|$)/);
          if (rest && rest[1] && !/^[=(]/.test(rest[1]) && !/^[-+*/\\^&|<>~.:]\s/.test(rest[1]) && /^[A-Za-z0-9_\-.'"\s]+$/.test(rest[1])) {
            const args = rest[1].trim().split(/\s+/).map(a => a.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1'));
            push('cmd', word, { args }); i = j + rest[0].length; continue;
          }
        }
      }
      if (isIdStart(c)) {
        let j = i; while (j < n && isId(src[j])) j++;
        const w = src.slice(i, j);
        if (KW.has(w) && !(last() && last().t === 'op' && last().v === '.' && !last().sp)) push('kw', normKw(w)); else push('id', w);
        i = j; continue;
      }
      if (isDigit(c) || (c === '.' && isDigit(src[i + 1] || ''))) {
        let j = i; while (j < n && isDigit(src[j])) j++;
        if (src[j] === '.' && !/[*\/\\^']/.test(src[j + 1] || '')) { j++; while (j < n && isDigit(src[j])) j++; }
        if (/[eEdD]/.test(src[j] || '') && /[0-9+-]/.test(src[j + 1] || '') && (isDigit(src[j + 1]) || isDigit(src[j + 2] || ''))) { j += 2; while (j < n && isDigit(src[j])) j++; }
        let text = src.slice(i, j).replace(/[dD]/, 'e'), v = parseFloat(text);
        if (/^0x[0-9a-fA-F]+/.test(src.slice(i))) { const m = src.slice(i).match(/^0x[0-9a-fA-F]+/)[0]; v = parseInt(m, 16); j = i + m.length; }
        let imag = false; if (/[ij]/.test(src[j] || '') && !isId(src[j + 1] || '')) { imag = true; j++; }
        push('num', v, { imag }); i = j; continue;
      }
      if (c === '"' || (c === "'" && !(valueEnd() && !sawSpace) && !(valueEnd() && !inBr()))) {
        let j = i + 1, s = '';
        for (; ;) {
          if (j >= n || src[j] === '\n') synErr('String is not terminated properly.', line);
          if (src[j] === c) { if (src[j + 1] === c) { s += c; j += 2; continue; } break; }
          s += src[j++];
        }
        push('str', s, { dq: c === '"' }); i = j + 1; continue;
      }
      const two = src.substr(i, 2);
      const op = ['==', '~=', '!=', '<=', '>=', '&&', '||', '.*', './', '.\\', '.^', ".'"].find(o => o === two) || null;
      if (op) {
        push('op', op === '!=' ? '~=' : op); i += 2; continue;
      }
      if ('+-*/\\^\'<>&|~!=:,;()[]{}.@'.includes(c)) {
        if (c === '(' || c === '[' || c === '{') { push('op', c); stack.push(c); i++; continue; }
        if (c === ')' || c === ']' || c === '}') {
          // drop a trailing implicit separator before a closing bracket
          while (last() && (last().t === ';' && last().row || last().t === ',' && last().implicit)) toks.pop();
          stack.pop(); push('op', c); i++; continue;
        }
        if (c === ';') { push(';', ';'); i++; continue; }
        if (c === ',') { push(',', ','); i++; continue; }
        push('op', c === '!' ? '~' : c); i++; continue;
      }
      synErr(`Invalid character '${c}' in input.`, line);
    }
    push('nl', '\n'); push('eof', null);
    return toks;
  }
  const normKw = w => ({ endfunction: 'end', endif: 'end', endfor: 'end', endwhile: 'end', parfor: 'for' })[w] || w;

  // ---------- parser ----------
  function parse(src) {
    const toks = lex(src); let p = 0, indexDepth = 0, matDepth = 0;
    const peek = (o = 0) => toks[p + o], next = () => toks[p++];
    const isOp = (v, o = 0) => { const t = toks[p + o]; return t && t.t === 'op' && t.v === v; };
    const isKw = (v, o = 0) => { const t = toks[p + o]; return t && t.t === 'kw' && t.v === v; };
    const expectOp = v => { if (!isOp(v)) err(`Expected '${v}'`); return next(); };
    const err = m => { const t = peek(); synErr(`${m}${t && t.t !== 'eof' ? ` near '${t.t === 'nl' ? 'end of line' : t.v}'` : ' at end of input'}.`, t ? t.line : 0); };
    const skipSep = () => { while (peek().t === 'nl' || peek().t === ';' || peek().t === ',') next(); };

    function program() {
      const body = [], funcs = []; skipSep();
      while (peek().t !== 'eof') {
        if (isKw('function')) funcs.push(funcDef());
        else body.push(statement());
        skipSep();
      }
      return { body, funcs };
    }
    function funcDef() {
      const line = next().line; let outs = [], name, params = [];
      if (isOp('[')) {
        next(); while (!isOp(']')) { const t = next(); if (t.t === 'id') outs.push(t.v); else if (t.t !== ',') err('Invalid function output list'); }
        next(); expectOp('='); name = next().v;
      } else {
        const t = next(); if (t.t !== 'id') err('Invalid function name');
        if (isOp('=')) { next(); outs = [t.v]; name = next().v; } else name = t.v;
      }
      while (isOp('.') && peek(1).t === 'id') { next(); name += '.' + next().v; }
      if (isOp('(')) {
        next(); while (!isOp(')')) { const t = next(); if (t.t === 'id') params.push(t.v); else if (t.t === 'op' && t.v === '~') params.push('~'); else if (t.t !== ',') err('Invalid parameter list'); }
        next();
      }
      const body = block(['end', 'function'], true);
      if (isKw('end')) next();
      return { t: 'function', name, params, outs, body, line };
    }
    function block(enders, inFunc) {
      const out = []; skipSep();
      while (true) {
        const t = peek();
        if (t.t === 'eof') { if (inFunc) break; err('Missing END for a block'); }
        if (t.t === 'kw' && enders.includes(t.v)) break;
        out.push(statement()); skipSep();
      }
      return out;
    }
    const endStmt = s => {
      const t = peek();
      if (t.t === ';') { next(); s.print = false; }
      else if (t.t === ',' || t.t === 'nl') { next(); s.print = true; }
      else if (t.t === 'eof' || t.t === 'kw') s.print = true;
      else err('Unexpected text after statement — check for a missing operator or semicolon');
      return s;
    };
    function statement() {
      const t = peek(), line = t.line;
      if (t.t === 'cmd') { next(); return endStmt({ t: 'expr', e: { t: 'index', obj: { t: 'id', name: t.v }, args: t.args.map(a => ({ t: 'str', v: a })) }, line, cmd: true }); }
      if (t.t === 'kw') {
        switch (t.v) {
          case 'if': {
            next(); const clauses = [{ cond: expr(), body: block(['elseif', 'else', 'end']) }]; let els = null;
            while (isKw('elseif')) { next(); clauses.push({ cond: expr(), body: block(['elseif', 'else', 'end']) }); }
            if (isKw('else')) { next(); els = block(['end']); }
            next(); return endStmt({ t: 'if', clauses, els, line });
          }
          case 'for': {
            next(); const paren = isOp('(') && hasAssignInParens(); if (paren) next();
            const v = next(); if (v.t !== 'id') err('Expected a loop variable'); expectOp('=');
            const e = expr(); if (paren) expectOp(')');
            const body = block(['end']); next(); return endStmt({ t: 'for', name: v.v, e, body, line });
          }
          case 'while': { next(); const cond = expr(); const body = block(['end']); next(); return endStmt({ t: 'while', cond, body, line }); }
          case 'do': { next(); const body = block(['until']); next(); const cond = expr(); return endStmt({ t: 'dountil', cond, body, line }); }
          case 'switch': {
            next(); const e = expr(); skipSep(); const cases = []; let other = null;
            while (isKw('case')) { next(); const val = expr(); cases.push({ val, body: block(['case', 'otherwise', 'end']) }); }
            if (isKw('otherwise')) { next(); other = block(['end']); }
            if (!isKw('end')) err('Missing END for SWITCH'); next(); return endStmt({ t: 'switch', e, cases, other, line });
          }
          case 'try': {
            next(); const body = block(['catch', 'end']); let id = null, cbody = [];
            if (isKw('catch')) { next(); if (peek().t === 'id' && peek(1).t !== 'op' || (peek().t === 'id' && (peek(1).t === 'nl' || peek(1).t === ';'))) id = next().v; cbody = block(['end']); }
            next(); return endStmt({ t: 'try', body, id, cbody, line });
          }
          case 'break': case 'continue': case 'return': next(); return endStmt({ t: t.v, line });
          case 'global': case 'persistent': { next(); const names = []; while (peek().t === 'id') names.push(next().v); return endStmt({ t: t.v, names, line }); }
          case 'function': err('Function definitions must come after the script code (local functions)');
          default: err(`Unexpected keyword '${t.v}'`);
        }
      }
      // [a, b] = f(...)
      if (isOp('[') && isMultiAssign()) {
        next(); const lhs = [];
        while (!isOp(']')) {
          if (peek().t === ',') { next(); continue; }
          if (isOp('~') && (peek(1).t === ',' || (peek(1).t === 'op' && peek(1).v === ']'))) { next(); lhs.push(null); continue; }
          lhs.push(postfix(true));
        }
        next(); expectOp('=');
        const rhs = expr(); return endStmt({ t: 'assign', lhs, rhs, line, multi: true });
      }
      const e = expr();
      if (isOp('=')) {
        if (!isLValue(e)) err('The expression to the left of the equals sign is not a valid target for an assignment');
        next(); const rhs = expr(); return endStmt({ t: 'assign', lhs: [e], rhs, line });
      }
      return endStmt({ t: 'expr', e, line });
    }
    function hasAssignInParens() { let d = 0; for (let k = p; k < toks.length; k++) { const t = toks[k]; if (t.t === 'op' && t.v === '(') d++; else if (t.t === 'op' && t.v === ')') { d--; if (!d) return false; } else if (d === 1 && t.t === 'op' && t.v === '=') return true; else if (t.t === 'nl') return false; } return false; }
    function isMultiAssign() { let d = 0; for (let k = p; k < toks.length; k++) { const t = toks[k]; if (t.t === 'op' && (t.v === '[' || t.v === '(' || t.v === '{')) d++; else if (t.t === 'op' && (t.v === ']' || t.v === ')' || t.v === '}')) { d--; if (!d) { const n = toks[k + 1]; return n && n.t === 'op' && n.v === '='; } } else if (t.t === 'nl' || t.t === 'eof') return false; } return false; }
    const isLValue = e => e.t === 'id' || ((e.t === 'index' || e.t === 'cellindex' || e.t === 'field' || e.t === 'dynfield') && isLValue(e.obj));

    // precedence: || < && < | < & < comparison < : < +- < */ < unary < ^ '
    function expr() { return oror(); }
    function binLevel(sub, ops) { return function lvl() { let a = sub(); while (peek().t === 'op' && ops.includes(peek().v)) { const op = next().v; a = { t: 'bin', op, a, b: sub() }; } return a; }; }
    const comparison = () => { let a = range(); while (peek().t === 'op' && ['==', '~=', '<', '<=', '>', '>='].includes(peek().v)) { const op = next().v; a = { t: 'bin', op, a, b: range() }; } return a; };
    const and = binLevel(comparison, ['&']), or = binLevel(and, ['|']), andand = binLevel(or, ['&&']), oror = binLevel(andand, ['||']);
    function range() {
      if (isOp(':') && indexDepth > 0 && matDepth === 0 && (peek(1).t === ',' || (peek(1).t === 'op' && (peek(1).v === ')' || peek(1).v === '}')))) { next(); return { t: 'colon' }; }
      const a = additive();
      if (isOp(':')) {
        next(); const b = additive();
        if (isOp(':')) { next(); const c = additive(); return { t: 'range', a, step: b, b: c }; }
        return { t: 'range', a, step: null, b };
      }
      return a;
    }
    const additive = binLevel(multiplicative, ['+', '-']);
    function multiplicative() { let a = unary(); while (peek().t === 'op' && ['*', '/', '\\', '.*', './', '.\\'].includes(peek().v)) { const op = next().v; a = { t: 'bin', op, a, b: unary() }; } return a; }
    function unary() {
      if (peek().t === 'op' && ['-', '+', '~'].includes(peek().v)) { const op = next().v; const a = unary(); if (op === '-' && a.t === 'num') return { t: 'num', v: -a.v, imag: a.imag }; return op === '+' ? a : { t: 'un', op, a }; }
      return power();
    }
    function power() {
      let a = postfix();
      while (peek().t === 'op' && (peek().v === '^' || peek().v === '.^')) {
        const op = next().v; let b;
        if (peek().t === 'op' && ['-', '+', '~'].includes(peek().v)) { const u = next().v; const x = postfix(); b = u === '+' ? x : { t: 'un', op: u, a: x }; } else b = postfix();
        a = { t: 'bin', op, a, b };
      }
      return a;
    }
    function postfix(lvalue) {
      let e = primary();
      for (; ;) {
        const t = peek();
        if (t.t === 'op' && t.v === '(' && !(matDepth && t.sp && indexDepth === 0)) { next(); e = { t: 'index', obj: e, args: args(')') }; continue; }
        if (t.t === 'op' && t.v === '{' && !(matDepth && t.sp)) { next(); e = { t: 'cellindex', obj: e, args: args('}') }; continue; }
        if (t.t === 'op' && t.v === '.' && !t.sp) {
          next();
          if (peek().t === 'id' || peek().t === 'kw') { e = { t: 'field', obj: e, name: next().v }; continue; }
          if (isOp('(')) { next(); const fe = expr(); expectOp(')'); e = { t: 'dynfield', obj: e, e: fe }; continue; }
          err('Invalid use of a period');
        }
        if (!lvalue && t.t === 'op' && (t.v === "'" || t.v === ".'") && !t.sp) { next(); e = { t: 'post', op: t.v, a: e }; continue; }
        break;
      }
      return e;
    }
    function args(close) {
      const out = []; indexDepth++; const md = matDepth; matDepth = 0;
      while (peek().t === 'nl') next();
      if (isOp(close)) { next(); indexDepth--; matDepth = md; return out; }
      for (; ;) {
        out.push(expr());
        if (peek().t === ',') { next(); continue; }
        if (isOp(close)) { next(); break; }
        err(`Expected ',' or '${close}'`);
      }
      indexDepth--; matDepth = md; return out;
    }
    function primary() {
      const t = peek();
      if (t.t === 'num') { next(); return { t: 'num', v: t.v, imag: t.imag }; }
      if (t.t === 'str') { next(); return { t: 'str', v: t.v, dq: t.dq }; }
      if (t.t === 'id') { next(); return { t: 'id', name: t.v }; }
      if (t.t === 'kw' && t.v === 'end' && indexDepth > 0) { next(); return { t: 'end' }; }
      if (t.t === 'op') {
        if (t.v === '(') { next(); const md = matDepth; matDepth = 0; const e = expr(); matDepth = md; expectOp(')'); return { t: 'paren', e }; }
        if (t.v === '[' || t.v === '{') return matrix(t.v);
        if (t.v === '@') {
          next();
          if (isOp('(')) {
            next(); const params = []; while (!isOp(')')) { const x = next(); if (x.t === 'id') params.push(x.v); else if (x.t === 'op' && x.v === '~') params.push('~'); else if (x.t !== ',') err('Invalid anonymous function parameter list'); }
            next(); const id = indexDepth, md = matDepth; indexDepth = 0; matDepth = 0;
            const body = expr(); indexDepth = id; matDepth = md;
            return { t: 'anon', params, body };
          }
          const x = next(); if (x.t !== 'id') err('Invalid function handle'); let name = x.v;
          while (isOp('.') && peek(1).t === 'id') { next(); name += '.' + next().v; }
          return { t: 'handle', name };
        }
        if (t.v === ':') { next(); return { t: 'colon' }; }
      }
      err(t.t === 'eof' || t.t === 'nl' ? 'Incomplete expression' : 'Invalid expression');
    }
    function matrix(open) {
      next(); const close = open === '[' ? ']' : '}', rows = []; let row = [];
      matDepth++;
      for (; ;) {
        const t = peek();
        if (t.t === 'op' && t.v === close) { next(); break; }
        if (t.t === 'eof') err(`Missing '${close}'`);
        if (t.t === ';' || t.t === 'nl') { next(); if (row.length) rows.push(row); row = []; continue; }
        if (t.t === ',') { next(); continue; }
        row.push(expr());
      }
      if (row.length) rows.push(row);
      matDepth--;
      return { t: open === '[' ? 'matrix' : 'cell', rows };
    }
    return program();
  }

  // source text for anonymous functions and handles (func2str, display)
  const PREC = { '||': 1, '&&': 2, '|': 3, '&': 4, '==': 5, '~=': 5, '<': 5, '<=': 5, '>': 5, '>=': 5, ':': 6, '+': 7, '-': 7, '*': 8, '/': 8, '\\': 8, '.*': 8, './': 8, '.\\': 8, '^': 10, '.^': 10 };
  function unparse(e, ctx = 0) {
    const wrap = (s, p) => p < ctx ? `(${s})` : s;
    switch (e.t) {
      case 'num': { let s = String(e.v); if (/e/.test(s)) s = s.replace('e+', 'e'); return (e.imag ? s + 'i' : s); }
      case 'str': return e.dq ? `"${e.v.replace(/"/g, '""')}"` : `'${e.v.replace(/'/g, "''")}'`;
      case 'id': return e.name;
      case 'end': return 'end';
      case 'colon': return ':';
      case 'paren': return `(${unparse(e.e)})`;
      case 'bin': { const p = PREC[e.op]; return wrap(unparse(e.a, p) + e.op + unparse(e.b, p + 1), p); }
      case 'un': return wrap(e.op + unparse(e.a, 9), 9);
      case 'post': return unparse(e.a, 11) + e.op;
      case 'range': return wrap(unparse(e.a, 7) + ':' + (e.step ? unparse(e.step, 7) + ':' : '') + unparse(e.b, 7), 6);
      case 'index': return unparse(e.obj, 11) + '(' + e.args.map(a => unparse(a)).join(',') + ')';
      case 'cellindex': return unparse(e.obj, 11) + '{' + e.args.map(a => unparse(a)).join(',') + '}';
      case 'field': return unparse(e.obj, 11) + '.' + e.name;
      case 'dynfield': return unparse(e.obj, 11) + '.(' + unparse(e.e) + ')';
      case 'matrix': case 'cell': { const [o, c] = e.t === 'matrix' ? ['[', ']'] : ['{', '}']; return o + e.rows.map(r => r.map(x => unparse(x)).join(',')).join(';') + c; }
      case 'anon': return '@(' + e.params.join(',') + ')' + unparse(e.body);
      case 'handle': return '@' + e.name;
    }
    return '?';
  }

  const api = { lex, parse, unparse, KW, CMD };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LabLang = api;
})(typeof self !== 'undefined' ? self : this);
