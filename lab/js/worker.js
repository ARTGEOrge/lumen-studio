// Lumen Lab — engine worker. Runs code off the UI thread so long computations never freeze the window.
// A SharedArrayBuffer carries the Stop flag, pause() sleeps and input() replies.
importScripts('mat.js', 'linalg.js', 'lang.js', 'interp.js', 'lib.js', 'numerics.js', 'graphics.js', 'help.js', 'engine.js');

let In = null, ctrl = null, inbuf = null, outBuf = '', outKind = 'out', flushT = 0, lastFig = -1, filesDirty = false;
const send = m => postMessage(m);
function flushOut() { if (outBuf) { send({ type: 'out', text: outBuf, kind: outKind }); outBuf = ''; } flushT = Date.now(); }
function out(text, kind = 'out') {
  if (kind !== outKind) flushOut();
  outKind = kind; outBuf += text;
  if (outBuf.length > 20000 || Date.now() - flushT > 60) flushOut();
}
function figs(force) { if (!In.gfx.dirty && !force) return; In.gfx.dirty = false; send({ type: 'figs', snap: In.gfx.snapshot() }); }
const host = {
  flush() { flushOut(); figs(); },
  pause(sec) { flushOut(); figs(); if (ctrl && sec > 0) Atomics.wait(ctrl, 3, 0, Math.min(sec, 3600) * 1000); else if (ctrl && sec <= 0) Atomics.wait(ctrl, 3, 0, 1); },
  clc() { flushOut(); send({ type: 'clc' }); },
  input(prompt) {
    flushOut(); figs();
    if (!ctrl) throw new LabMat.LabError('input needs a cross-origin isolated page.');
    Atomics.store(ctrl, 1, 0); send({ type: 'input', prompt });
    while (Atomics.load(ctrl, 1) === 0) { Atomics.wait(ctrl, 1, 0, 200); if (Atomics.load(ctrl, 0)) return null; }
    const len = Atomics.load(ctrl, 2); if (len < 0) return null;
    let s = ''; for (let i = 0; i < len; i++) s += String.fromCharCode(inbuf[i]); return s;
  },
  saveFigure(id, name) { flushOut(); figs(true); send({ type: 'saveFigure', id, name }); },
  filesChanged() { filesDirty = true; },
};
function make() {
  In = LabEngine.create({ out, host, interrupt: () => ctrl && Atomics.load(ctrl, 0) === 1 });
  In.lib.help = a => helpText(a.length ? LabLib.Str(a[0]) : '');
  In.lib.doc = In.lib.help;
  In.lib.lookfor = a => { const q = LabLib.Str(a[0]).toLowerCase(); out(Object.keys(LabHelp.FN).filter(k => k.includes(q) || LabHelp.FN[k][1].toLowerCase().includes(q)).map(k => `${k.padEnd(14)} ${LabHelp.FN[k][1]}`).join('\n') + '\n'); };
}
function helpText(name) {
  if (!name) { out(LabHelp.overview() + '\n'); return; }
  const h = LabHelp.FN[name];
  if (h) { out(` ${name} — ${h[1]}\n\n${h[0].split('\n').map(l => '    ' + l).join('\n')}\n\n`); return; }
  const u = In.findUser(name);
  if (u && (u.def || u.script)) {
    const text = In.files.get(name + '.m') || ''; const lines = text.split('\n'); let i = 0; while (i < lines.length && !/^\s*%/.test(lines[i])) i++;
    const doc = []; while (i < lines.length && /^\s*%/.test(lines[i])) doc.push(lines[i++].replace(/^\s*%\s?/, '  '));
    out((doc.length ? doc.join('\n') : `  ${name} is a function in the current folder (no help comments).`) + '\n\n'); return;
  }
  if (In.lib[name]) { out(`  ${name} is a built-in function.\n\n`); return; }
  out(`  ${name} not found.\n\n`);
}
const MAXPREV = 12;
function preview(v) {
  if (v.type === 'num') {
    if (v.cls === 'char' && v.r <= 1) return "'" + LabMat.toStr(v).slice(0, 60) + "'";
    if (v.n === 0) return '[]';
    if (v.n === 1) return LabMat.scalarText(v.re[0], v.im ? v.im[0] : null);
    if ((v.r === 1 || v.c === 1) && v.n <= MAXPREV && !v.im) return '[' + Array.from(v.re, x => LabMat.scalarText(x)).join(v.r === 1 ? ' ' : ';') + ']';
    return `${v.r}×${v.c} ${v.cls}${v.im ? ' (complex)' : ''}`;
  }
  return LabInterp.shortText(v);
}
function stats(v) {
  if (v.type !== 'num' || v.cls === 'char' || !v.n || v.im) return null;
  let mn = Infinity, mx = -Infinity, s = 0, c = 0; for (let k = 0; k < v.n; k++) { const x = v.re[k]; if (Number.isFinite(x)) { mn = Math.min(mn, x); mx = Math.max(mx, x); s += x; c++; } }
  return c ? { min: mn, max: mx, mean: s / c } : null;
}
function workspace() {
  return [...In.base.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })).map(([name, v]) => ({ name, size: `${v.r}×${v.c}`, cls: LabInterp.clsOf(v) + (v.im ? ' (complex)' : ''), value: preview(v), stats: stats(v), bytes: LabLib.L.__bytes([v]).re[0] }));
}
function filesObj() { const o = {}; In.files.forEach((v, k) => { o[k] = v; }); return o; }
function done(id, extra) { flushOut(); figs(); send(Object.assign({ type: 'done', id, workspace: workspace(), format: LabMat.fmt.long ? 'long' : 'short' }, filesDirty ? { files: filesObj() } : {}, extra)); filesDirty = false; }

onmessage = e => {
  const m = e.data;
  try {
    switch (m.type) {
      case 'init':
        if (m.sab) { ctrl = new Int32Array(m.sab, 0, 8); inbuf = new Uint16Array(m.sab, 32); }
        make(); send({ type: 'ready', names: Object.keys(In.lib).filter(k => !k.startsWith('__')).sort(), keywords: [...LabLang.KW] });
        break;
      case 'files': In.files = new Map(Object.entries(m.files)); In.parseCache.clear(); break;
      case 'run': {
        if (m.files) { In.files = new Map(Object.entries(m.files)); }
        if (ctrl) Atomics.store(ctrl, 0, 0);
        In.width = m.width || 100;
        const t0 = performance.now();
        try {
          if (m.echo) out(m.echo, 'echo');
          In.run(m.code, m.name || null);
          done(m.id, { ok: true, ms: performance.now() - t0 });
        } catch (err) {
          flushOut();
          const text = err.interrupt ? 'Operation terminated by user.' : LabInterp.errorText(err);
          let line = null; if (err.where && err.where.length) { const w = err.where.find(x => x.name === (m.name || 'base')) || err.where[err.where.length - 1]; line = w.line; } else if (err.line) line = err.line;
          const file = err.where && err.where.length ? err.where[0].name : m.name;
          out(text + '\n', 'err');
          done(m.id, { ok: false, error: text, line, file, interrupted: !!err.interrupt });
          In.frames.length = 1; In.depth = 0;
        }
        break;
      }
      case 'value': { // full value for the variable editor
        const v = In.base.get(m.name);
        send({ type: 'value', name: m.name, req: m.req, json: v ? LabLib.toJSON(v) : null, text: v && !(v.type === 'num' && v.cls !== 'char') ? In.displayText(m.name, v) : '' });
        break;
      }
      case 'setvar': { In.base.set(m.name, LabLib.fromJSON1(m.json)); done(m.id, { ok: true }); break; }
      case 'exportws': { const vars = {}; In.base.forEach((v, k) => { vars[k] = LabLib.toJSON(v); }); send({ type: 'wsjson', req: m.req, text: JSON.stringify({ format: 'lumen-lab-workspace', version: 1, vars }) }); break; }
      case 'clearvars': In.base.clear(); done(m.id, { ok: true }); break;
      case 'closeall': In.lib.close([LabMat.str('all')]); done(m.id, { ok: true }); break;
      case 'figs': figs(true); break;
      case 'rmfig': In.lib.close([LabMat.num(m.fig)]); figs(); break;
      case 'complete': { const p = m.prefix; const names = new Set([...In.base.keys(), ...Object.keys(In.lib).filter(k => !k.startsWith('__')), ...[...In.files.keys()].filter(k => k.endsWith('.m')).map(k => k.slice(0, -2))]); send({ type: 'complete', req: m.req, list: [...names].filter(n => n.startsWith(p)).sort().slice(0, 60) }); break; }
    }
  } catch (err) { send({ type: 'out', text: 'Internal error: ' + (err && err.message || err) + '\n', kind: 'err' }); send({ type: 'done', id: m.id, ok: false, workspace: In ? workspace() : [] }); }
};
