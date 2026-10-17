// Lumen Lab — debugger (breakpoints, conditional breakpoints, dbstop if error, stepping, keyboard,
// evaluating in any frame of the paused call stack) and profiler (profile on/off/viewer/info:
// per-function calls, total and self time, per-line counts and time).
// The engine calls In.hook(stmt, sameLine) before each statement while either is active; the host
// (the worker) supplies debugPause(info) / debugRead() / debugResume() to talk to the desktop.
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const M = node ? require('./mat.js') : root.LabMat;
  const I = node ? require('./interp.js') : root.LabInterp;
  const Lang = node ? require('./lang.js') : root.LabLang;
  const Lib = node ? require('./lib.js') : root.LabLib;
  const { fail, num, str } = M;
  const { Struct, Cell } = I;
  const { L, Str, isStr } = Lib;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const COMPOUND = new Set(['if', 'for', 'while', 'switch', 'try', 'dountil']);

  // lines of a file that hold statements (breakpoints snap to the next one, like MATLAB)
  function execLines(text) {
    let ast; try { ast = Lang.parse(text); } catch (e) { return null; }
    const set = new Set();
    const walk = list => { for (const s of list || []) { if (!s || typeof s !== 'object') continue; if (s.line) set.add(s.line); walk(s.body); walk(s.els); walk(s.cbody); walk(s.other); (s.clauses || []).forEach(c => walk(c.body)); (s.cases || []).forEach(c => walk(c.body)); } };
    walk(ast.body); ast.funcs.forEach(f => walk(f.body));
    return [...set].sort((a, b) => a - b);
  }
  function snapLine(text, line) { const ls = execLines(text); if (!ls) return line; const l = ls.find(x => x >= line); return l === undefined ? null : l; }

  class Debugger {
    constructor(In) { this.In = In; this.bps = new Map(); this.stopOnError = false; this.mode = null; this.depth = 0; this.paused = false; this.view = 0; this.evaluating = false; this.resume = null; this.changed = false; this.pendingKeyboard = false; }
    get active() { return this.bps.size > 0 || !!this.mode; }
    toJSON() { const o = {}; this.bps.forEach((m, f) => { o[f] = [...m].map(([l, c]) => [l, c]); }); return { bps: o, err: this.stopOnError }; }
    load(j) {
      this.bps.clear();
      if (j && j.bps && typeof j.bps === 'object') for (const f of Object.keys(j.bps)) {
        if (!/^[A-Za-z]\w*$/.test(f) || !Array.isArray(j.bps[f])) continue;
        const m = new Map(); for (const e of j.bps[f]) if (Array.isArray(e) && Number.isInteger(e[0]) && e[0] >= 0) m.set(e[0], typeof e[1] === 'string' ? e[1] : '');
        if (m.size) this.bps.set(f, m);
      }
      this.stopOnError = !!(j && j.err); refresh(this.In);
    }
    reset() { this.mode = null; this.resume = null; this.paused = false; refresh(this.In); }
    condTrue(cond) {
      if (!cond) return true;
      const In = this.In, hk = In.hook; this.evaluating = true; In.hook = null;
      try { return In.truthy(In.evalString(cond)); } catch (e) { if (e.interrupt) throw e; In.warn(`Error evaluating the breakpoint condition "${cond}": ${e.message}. Stopping.`); return true; }
      finally { this.evaluating = false; In.hook = hk; }
    }
    check(s, same) {
      const In = this.In, f = In.frame, n = In.frames.length;
      if (this.evaluating || same) { f.dbgEntered = true; return; }
      let why = null;
      if (this.mode === 'in') why = 'step'; else if (this.mode === 'step' && n <= this.depth) why = 'step'; else if (this.mode === 'out' && n < this.depth) why = 'step';
      if (!why && f.src) { const b = this.bps.get(f.src); if (b) { if (b.has(s.line) && this.condTrue(b.get(s.line))) why = 'breakpoint'; else if (b.has(0) && !f.dbgEntered) why = 'breakpoint'; } }
      f.dbgEntered = true;
      if (why) this.pause(why);
    }
    stack() { return this.In.frames.map(f => ({ name: f.name, src: f.src || null, line: f.line || 0 })).reverse(); }
    info(reason) { const In = this.In, f = In.frames[this.view]; return { reason, file: f.src || null, name: f.name, line: f.line || 0, view: In.frames.length - 1 - this.view, stack: this.stack(), scope: f.scope, dbg: this.changed ? this.toJSON() : null }; }
    pause(reason) {
      const In = this.In, host = In.host;
      if (!host || !host.debugRead) { In.warn('The debugger needs the Lumen Lab desktop (it cannot pause here).'); this.mode = null; refresh(In); return; }
      this.paused = true; this.view = In.frames.length - 1; this.mode = null; this.resume = null;
      try {
        host.debugPause(this.info(reason)); this.changed = false;
        for (;;) {
          const cmd = host.debugRead();
          if (cmd === null) { const e = new M.LabError('Operation terminated by user.', 'MATLAB:interrupt'); e.interrupt = true; throw e; }
          if (cmd.charCodeAt(0) === 1) { try { this.load(JSON.parse(cmd.slice(1))); } catch (e) { /* ignore a bad sync */ } continue; }
          this.evalAt(cmd);
          if (this.resume) break;
          host.debugPause(this.info(null)); this.changed = false;
        }
      } finally { this.paused = false; }
      const r = this.resume; this.resume = null; this.view = In.frames.length - 1;
      if (r.quit) { const e = new M.LabError('Debugging stopped.', 'MATLAB:dbquit'); e.interrupt = true; e.dbquit = true; this.mode = null; refresh(In); throw e; }
      this.mode = r.mode; this.depth = In.frames.length; refresh(In);
      if (host.debugResume) host.debugResume();
    }
    // run code typed at the K>> prompt in the frame being viewed (dbup / dbdown move it)
    evalAt(code) {
      const In = this.In, v = this.view, keep = In.frames.slice(v + 1), top = In.frames[v], line = top.line, hk = In.hook;
      this.fullStack = In.frames.slice(); top.dbgLine = line;
      In.frames.length = v + 1; this.evaluating = true; In.hook = null;
      try { In.evalHere(code); }
      catch (e) { if (e.interrupt && !e.dbquit) throw e; if (!e.dbquit) In.out(I.errorText(e).replace(/\nError in [\s\S]*$/, '') + '\n', 'err'); }
      finally { In.frames.length = v + 1; In.frames.push(...keep); top.line = line; delete top.dbgLine; this.fullStack = null; this.evaluating = false; In.hook = hk; }
    }
  }

  class Profiler {
    constructor() { this.on = false; this.clear(); }
    clear() { this.fns = new Map(); this.lines = new Map(); this.stk = []; this.t0 = now(); this.elapsed = 0; }
    enter(name, type, file) {
      let r = this.fns.get(name); if (!r) { r = { name, type, file: file || null, calls: 0, total: 0, self: 0, active: 0 }; this.fns.set(name, r); }
      r.calls++; r.active++; const fr = { r, t: now(), child: 0 }; this.stk.push(fr); return fr;
    }
    leave(fr) {
      const dt = now() - fr.t, i = this.stk.lastIndexOf(fr); if (i >= 0) this.stk.length = i;
      fr.r.active--; if (!fr.r.active) fr.r.total += dt; fr.r.self += dt - fr.child;
      const parent = this.stk[this.stk.length - 1]; if (parent) parent.child += dt;
    }
    line(src, s, same) {
      if (!src) return null;
      let m = this.lines.get(src); if (!m) { m = new Map(); this.lines.set(src, m); }
      let r = m.get(s.line); if (!r) { r = { count: 0, time: 0 }; m.set(s.line, r); }
      if (!same) r.count++; return COMPOUND.has(s.t) ? null : { r, t: now() };
    }
    report() {
      const total = this.elapsed + (this.on ? now() - this.t0 : 0);
      const functions = [...this.fns.values()].map(({ name, type, file, calls, total: tt, self }) => ({ name, type, file, calls, total: tt / 1000, self: self / 1000 })).sort((a, b) => b.total - a.total || b.calls - a.calls);
      const lines = {}; this.lines.forEach((m, f) => { lines[f] = [...m].map(([l, r]) => [l, r.count, r.time / 1000]).sort((a, b) => a[0] - b[0]); });
      return { total: total / 1000, functions, lines, on: this.on };
    }
    text() {
      const r = this.report(), f = x => x.toFixed(4).padStart(10);
      let s = `Profile summary — ${r.functions.length} function${r.functions.length === 1 ? '' : 's'}, ${(r.total).toFixed(3)} s profiled${r.on ? ' (still on)' : ''}\n\n`;
      s += `  ${'Function'.padEnd(28)}${'Calls'.padStart(9)}${'Total s'.padStart(10)}${'Self s'.padStart(10)}  Type\n`;
      for (const x of r.functions.slice(0, 40)) s += `  ${x.name.slice(0, 27).padEnd(28)}${String(x.calls).padStart(9)}${f(x.total)}${f(x.self)}  ${x.type}\n`;
      const hot = []; for (const file in r.lines) for (const [l, c, t] of r.lines[file]) hot.push({ file, l, c, t });
      hot.sort((a, b) => b.t - a.t || b.c - a.c);
      if (hot.length) { s += `\n  Busiest lines\n`; for (const h of hot.slice(0, 10)) s += `  ${(h.file + ':' + h.l).padEnd(28)}${String(h.c).padStart(9)}${f(h.t)}\n`; }
      return s + '\n';
    }
  }

  const D = In => In.dbg || (In.dbg = new Debugger(In));
  const P = In => In.prof || (In.prof = new Profiler());
  function refresh(In) {
    const d = In.dbg, p = In.prof, dbgOn = d && d.active, profOn = p && p.on;
    In.hook = dbgOn || profOn ? hookFor(In) : null;
    In.hookEnd = tok => { tok.r.time += now() - tok.t; };
    In.onError = d && d.stopOnError ? (e) => { if (!In.host || !In.host.debugRead || d.evaluating || !In.frame.src) return; /* only errors inside files, as MATLAB */ In.out((e.message || String(e)) + '\n', 'err'); e.shown = true; d.pause('error'); } : null;
  }
  function hookFor(In) {
    return (s, same) => {
      const d = In.dbg; if (d && d.active) d.check(s, same);
      const p = In.prof; if (p && p.on) return p.line(In.frame.src, s, same);
      return null;
    };
  }

  // ---------- builtins ----------
  const words = a => a.map(x => isStr(x) ? Str(x) : String(x.re ? x.re[0] : ''));
  function fileText(In, name) { const t = In.files.get(name + '.m'); return t === undefined ? null : t; }
  L.dbstop = (a, nout, In) => {
    const d = D(In), w = words(a);
    if (w[0] === 'if') { if (!/^(error|caught)/.test(w[1] || '')) fail("dbstop: use 'dbstop if error'."); d.stopOnError = true; d.changed = true; refresh(In); return; }
    let file, line = 0, cond = '';
    if (w[0] === 'in') { file = w[1]; const k = w.indexOf('at'); if (k > 0) line = +w[k + 1]; const c = w.indexOf('if'); if (c > 0) cond = w.slice(c + 1).join(' '); }
    else { file = w[0]; line = w.length > 1 ? +w[1] : 0; }
    file = String(file || '').replace(/\.m$/, '');
    if (!/^[A-Za-z]\w*$/.test(file) || !(line >= 0) || !Number.isInteger(line)) fail('Use dbstop in FILE at LINE (or dbstop if error).');
    const text = fileText(In, file);
    if (text === null) fail(`dbstop: ${file}.m is not in the Current Folder.`);
    if (line > 0) { const l = snapLine(text, line); if (l === null) fail(`Breakpoint not set: line ${line} of ${file}.m has no code after it.`); line = l; }
    if (cond) { try { Lang.parse(cond); } catch (e) { fail(`dbstop: the condition "${cond}" is not a valid expression.`); } }
    if (!d.bps.has(file)) d.bps.set(file, new Map());
    d.bps.get(file).set(line, cond); d.changed = true; refresh(In);
  };
  L.dbclear = (a, nout, In) => {
    const d = D(In), w = words(a);
    if (!w.length || w[0] === 'all') { d.bps.clear(); d.stopOnError = false; }
    else if (w[0] === 'if') d.stopOnError = false;
    else { const file = (w[0] === 'in' ? w[1] : w[0] || '').replace(/\.m$/, ''), k = w.indexOf('at'), line = k > 0 ? +w[k + 1] : w[0] !== 'in' && w.length > 1 ? +w[1] : null; const m = d.bps.get(file); if (m) { if (line === null) d.bps.delete(file); else { m.delete(line); if (!m.size) d.bps.delete(file); } } }
    d.changed = true; refresh(In);
  };
  L.dbstatus = (a, nout, In) => {
    const d = D(In), rows = [];
    d.bps.forEach((m, f) => [...m].sort((x, y) => x[0] - y[0]).forEach(([l, c]) => rows.push({ f, l, c })));
    if (nout > 0) { const s = new Struct(); s.f.set('name', new Cell(rows.length, 1, rows.map(r => str(r.f)))); s.f.set('line', M.colVec(rows.map(r => r.l))); s.f.set('cond', new Cell(rows.length, 1, rows.map(r => str(r.c)))); s.f.set('stopOnError', M.bool(d.stopOnError)); return s; }
    let out = rows.map(r => r.l ? `Breakpoint in ${r.f} at line ${r.l}${r.c ? ` if ${r.c}` : ''}.` : `Breakpoint on entry to ${r.f}.`).join('\n');
    if (d.stopOnError) out += (out ? '\n' : '') + 'Stop if error.';
    In.print((out || 'No breakpoints are set.') + '\n');
  };
  const needPause = (In, name) => { const d = D(In); if (!d.paused) fail(`${name} can only be used while stopped in the debugger (K>> prompt).`); return d; };
  L.dbcont = (a, nout, In) => { needPause(In, 'dbcont').resume = { mode: null }; };
  L.dbstep = (a, nout, In) => { const w = words(a)[0]; needPause(In, 'dbstep').resume = { mode: w === 'in' ? 'in' : w === 'out' ? 'out' : 'step' }; };
  L.dbquit = (a, nout, In) => { needPause(In, 'dbquit').resume = { quit: true }; };
  L.dbup = (a, nout, In) => { const d = needPause(In, 'dbup'); if (d.view > 0) d.view--; else return In.print('Already at the base of the stack.\n'); const f = In.frames[d.view]; In.print(`In workspace belonging to ${f.name === 'base' ? 'the base workspace' : f.name}${f.line ? ` (line ${f.line})` : ''}.\n`); };
  L.dbdown = (a, nout, In) => { const d = needPause(In, 'dbdown'); if (d.view < In.frames.length - 1) d.view++; else return In.print('Already at the top of the stack.\n'); const f = In.frames[d.view]; In.print(`In workspace belonging to ${f.name}${f.line ? ` (line ${f.line})` : ''}.\n`); };
  L.dbstack = (a, nout, In) => {
    const d = In.dbg, frames = d && d.fullStack ? d.fullStack : In.frames, cur = d && d.fullStack ? frames[d.view] : In.frame;
    const ln = f => f.dbgLine || f.line || 0, st = frames.slice(1).reverse();
    if (nout > 0) { const s = new Struct(); s.f.set('name', new Cell(st.length, 1, st.map(f => str(f.name)))); s.f.set('file', new Cell(st.length, 1, st.map(f => str(f.src ? f.src + '.m' : '')))); s.f.set('line', M.colVec(st.map(ln))); return s; }
    const base = frames[0], all = base.src ? [...st, base] : st;
    In.print(all.length ? all.map(f => `${f === cur ? '>' : ' '} In ${f.name}${f.src && f.src !== f.name ? ` (${f.src}.m)` : ''} (line ${ln(f)})`).join('\n') + '\n' : 'The call stack is empty (only the base workspace).\n');
  };
  L.keyboard = (a, nout, In) => { const d = D(In); if (d.paused || d.evaluating) return; In.print(`Stopped by keyboard${In.frame.src ? ` in ${In.frame.src} (line ${In.frame.line})` : ''}. Type dbcont to continue or dbquit to stop.\n`); d.pause('keyboard'); };
  L.profile = (a, nout, In) => {
    const p = P(In), w = (a.length ? words(a)[0] : 'status').toLowerCase();
    switch (w) {
      case 'on': p.clear(); p.on = true; p.t0 = now(); break;
      case 'resume': if (!p.on) { p.on = true; p.t0 = now(); } break;
      case 'off': if (p.on) { p.elapsed += now() - p.t0; p.on = false; } break;
      case 'clear': p.clear(); if (p.on) p.t0 = now(); break;
      case 'status': if (nout > 0) { const s = new Struct(); s.f.set('ProfilerStatus', str(p.on ? 'on' : 'off')); return s; } In.print(`The profiler is ${p.on ? 'on' : 'off'}.\n`); return;
      case 'viewer': case 'report': {
        if (p.on) { p.elapsed += now() - p.t0; p.on = false; }
        refresh(In);
        if (In.host && In.host.profileReport) { In.host.profileReport(p.report()); In.print(`Profile report opened (${p.fns.size} function${p.fns.size === 1 ? '' : 's'}).\n`); }
        else In.print(p.text());
        return;
      }
      case 'info': {
        const r = p.report(), s = new Struct(), fs = r.functions;
        s.f.set('FunctionName', new Cell(fs.length, 1, fs.map(x => str(x.name)))); s.f.set('Type', new Cell(fs.length, 1, fs.map(x => str(x.type))));
        s.f.set('NumCalls', M.colVec(fs.map(x => x.calls))); s.f.set('TotalTime', M.colVec(fs.map(x => x.total))); s.f.set('SelfTime', M.colVec(fs.map(x => x.self)));
        const lf = [], ll = [], lc = [], lt = []; for (const f in r.lines) for (const [l, c, t] of r.lines[f]) { lf.push(str(f)); ll.push(l); lc.push(c); lt.push(t); }
        s.f.set('LineFile', new Cell(lf.length, 1, lf)); s.f.set('LineNumber', M.colVec(ll)); s.f.set('LineCount', M.colVec(lc)); s.f.set('LineTime', M.colVec(lt)); s.f.set('TotalProfiled', num(r.total));
        return s;
      }
      default: fail(`profile: unknown option '${w}'. Use on, off, resume, clear, viewer, report, info or status.`);
    }
    refresh(In);
  };
  for (const k of ['dbstop', 'dbclear', 'dbstatus', 'dbcont', 'dbstep', 'dbquit', 'dbup', 'dbdown', 'dbstack', 'keyboard', 'profile']) L[k].noProfile = true;

  const api = { Debugger, Profiler, execLines, snapLine, D, P, refresh };
  if (node) module.exports = api; else root.LabDebug = api;
})(typeof self !== 'undefined' ? self : this);
