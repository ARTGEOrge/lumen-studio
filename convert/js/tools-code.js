'use strict';
/* Lumen Convert — Code tools: Python → JavaScript (own parser + compiler + "py" runtime, with a sandboxed Run),
   Python → runnable web page (Brython subset, or transpiled JS), Code → highlighted HTML (highlight.js), and
   Jupyter notebook → HTML. User code only ever runs inside <iframe sandbox="allow-scripts"> (opaque origin), and
   transpiled code additionally runs in a Worker inside that iframe so a runaway loop can be stopped. */
(() => {
  const { register, alias, util: U } = LC;
  const { el, esc, baseName, extOf, fmtSize } = U;
  const base = p => new URL(p, document.baseURI).href;
  const textCache = {};
  const fetchText = p => textCache[p] || (textCache[p] = fetch(base(p)).then(r => { if (!r.ok) throw new Error('Missing ' + p); return r.text(); }).catch(e => { delete textCache[p]; throw e; }));
  const loadPy = async () => { await U.loadScript('js/py/parser.js', 'PyParse'); await U.loadScript('js/py/compiler.js', 'PyCompile'); return { compile: window.PyCompile.compile, runtime: await fetchText('js/py/runtime.js') }; };
  const noScriptClose = s => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
  const SAMPLE_PY = `# Lumen Convert sample: a tiny inventory report
from math import floor

class Item:
    def __init__(self, name, price, qty=0):
        self.name, self.price, self.qty = name, price, qty

    def value(self):
        return self.price * self.qty

    def __repr__(self):
        return f"Item({self.name!r}, {self.price}, {self.qty})"

stock = [Item("pen", 1.5, 40), Item("notebook", 4.25, 12), Item("ruler", 2, 0)]
in_stock = [i for i in stock if i.qty]
total = sum(i.value() for i in in_stock)

print(f"{'Item':<10}{'Qty':>5}{'Value':>10}")
for item in sorted(in_stock, key=lambda i: -i.value()):
    print(f"{item.name:<10}{item.qty:>5}{item.value():>10.2f}")
print(f"Total: {total:.2f}  ({len(in_stock)} of {len(stock)} items in stock)")
print("Half price:", floor(total / 2), "| -7 // 2 =", -7 // 2, "| -7 % 3 =", -7 % 3)
name = input("Your name? ")
print(f"Thanks, {name}!")
`;

  /* ---------------- sandboxed runner ---------------- */
  // Runs JavaScript inside <iframe sandbox="allow-scripts">; the code itself runs in a Worker created inside that
  // iframe, so it can be terminated. Messages are only accepted from that iframe's window.
  function runSandboxed(workerSource, { onMessage, timeout = 15000 } = {}) {
    return new Promise(resolve => {
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts'); frame.style.display = 'none'; frame.title = 'Sandbox';
      const boot = `<!doctype html><meta charset="utf-8"><script>
        var src = ${noScriptClose(JSON.stringify(workerSource))};
        try {
          var w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
          w.onmessage = function (e) { parent.postMessage(e.data, '*'); };
          w.onerror = function (e) { parent.postMessage({ t: 'err', s: 'Error: ' + e.message }, '*'); parent.postMessage({ t: 'done' }, '*'); };
        } catch (err) { parent.postMessage({ t: 'err', s: 'Could not start the sandbox: ' + err.message }, '*'); parent.postMessage({ t: 'done' }, '*'); }
      <\/script>`;
      let finished = false, timer;
      const finish = (why) => { if (finished) return; finished = true; clearTimeout(timer); window.removeEventListener('message', onMsg); frame.remove(); resolve(why); };
      const onMsg = e => { if (e.source !== frame.contentWindow || !e.data || typeof e.data !== 'object') return; if (e.data.t === 'done') finish('done'); else onMessage && onMessage(e.data); };
      window.addEventListener('message', onMsg);
      timer = setTimeout(() => finish('timeout'), timeout);
      frame.srcdoc = boot; document.body.appendChild(frame);
      runSandboxed.stop = () => finish('stopped');
    });
  }
  function workerProgram(runtime, code, stdinLines) {
    return `${runtime}
py.stdout.line = function (s) { postMessage({ t: 'out', s: String(s) }); };
console.log = function () { postMessage({ t: 'out', s: Array.prototype.join.call(arguments, ' ') }); };
console.error = function () { postMessage({ t: 'err', s: Array.prototype.join.call(arguments, ' ') }); };
py.stdin.lines = ${JSON.stringify(stdinLines)};
try { (function () { ${code.replace(/^'use strict';$/m, "'use strict';")} })(); }
catch (e) { py.report(e); }
finally { py.stdout.flush(); postMessage({ t: 'done' }); }
`;
  }
  function consoleBox() {
    const box = el('div'); box.style.cssText = 'font:13px/1.45 Consolas,"Lucida Console",monospace;background:#0f1b2b;color:#dfe9f5;padding:10px 12px;min-height:140px;max-height:360px;overflow:auto;white-space:pre-wrap;word-break:break-word';
    const api = { el: box, text: '', clear() { box.textContent = ''; api.text = ''; }, add(s, kind) { const sp = document.createElement('span'); sp.textContent = s; if (kind === 'err') sp.style.color = '#ff9f8f'; if (kind === 'sys') sp.style.color = '#8fb8e8'; if (kind === 'in') sp.style.color = '#9fe39b'; box.appendChild(sp); api.text += s; box.scrollTop = box.scrollHeight; } };
    return api;
  }

  /* ---------------- Python → JavaScript ---------------- */
  register({
    id: 'python-to-js', cat: 'code', glyph: 'pyjs', name: 'Python → JavaScript', keywords: 'python to javascript js transpile transpiler convert py code compile es module',
    desc: 'Transpile Python to readable modern JavaScript with Python semantics, and run it safely.',
    render(root, preset) {
      const st = { module: false, runtime: 'inline', comments: true, name: 'program', ...(preset || {}) };
      const top = el('div', 'intro'); root.append(top);
      const opts = el('div', 'checks');
      const fmtSel = el('select'); fmtSel.innerHTML = '<option value="script">Plain script</option><option value="module">ES module</option>'; fmtSel.value = st.module ? 'module' : 'script';
      const rtSel = el('select'); rtSel.innerHTML = '<option value="inline">Runtime inlined (one file)</option><option value="omit">Runtime as a separate file</option>';
      const cm = el('input'); cm.type = 'checkbox'; cm.checked = st.comments;
      const lab = (t, c) => { const l = el('label'); l.append(document.createTextNode(t + ' '), c); return l; };
      const cmL = el('label'); cmL.append(cm, document.createTextNode(' Keep comments'));
      opts.append(lab('Output', fmtSel), lab('Runtime', rtSel), cmL); top.append(opts);
      const io = el('div', 'io'), L = el('div'), R = el('div'); io.append(L, R); root.append(io);
      const tbL = el('div', 'tb'), openB = el('button', 'mini', 'Open .py…'), sampleB = el('button', 'mini', 'Sample'), pick = el('input'); pick.type = 'file'; pick.accept = '.py,.pyw,text/x-python,text/plain'; pick.className = 'vh';
      [openB, sampleB].forEach(b => b.type = 'button'); tbL.append(el('b', null, 'Python'), el('span', 'sp'), openB, sampleB, pick);
      const inp = el('textarea'); inp.spellcheck = false; inp.placeholder = 'Paste Python here, or drop a .py file'; L.append(tbL, inp);
      const tbR = el('div', 'tb'), copyB = el('button', 'go mini', 'Copy'), dlB = el('button', 'mini', 'Download .js'), rtB = el('button', 'mini', 'Download runtime'), runB = el('button', 'go mini', '▶ Run');
      [copyB, dlB, rtB, runB].forEach(b => b.type = 'button'); rtB.hidden = true;
      tbR.append(el('b', null, 'JavaScript'), el('span', 'sp'), runB, copyB, dlB, rtB);
      const out = el('textarea'); out.readOnly = true; out.spellcheck = false; out.wrap = 'off'; R.append(tbR, out);
      const status = el('div', 'status'); root.append(status);
      const runHead = el('div', 'ph', '<span class="phi"></span>Run (sandboxed)<span class="right"></span>'); root.append(runHead);
      const runBar = el('div', 'tb'); runBar.style.cssText = 'display:flex;gap:8px;align-items:flex-start;padding:8px 12px;background:#f6f9fc;border-bottom:1px solid var(--line);flex-wrap:wrap';
      const stdin = el('textarea'); stdin.placeholder = 'Input for input(), one line per call'; stdin.rows = 2; stdin.style.cssText = 'flex:1;min-width:200px;min-height:44px;font:13px Consolas,monospace';
      const stopB = el('button', 'mini', '■ Stop'); stopB.type = 'button'; stopB.disabled = true;
      runBar.append(stdin, stopB); root.append(runBar);
      const con = consoleBox(); con.add('Press ▶ Run to execute the JavaScript in a sandbox (no access to this page or your files).', 'sys'); root.append(con.el);
      let lastCode = '', lastErrors = [], compiler = null, tmr;
      async function convert() {
        compiler = compiler || await loadPy();
        st.module = fmtSel.value === 'module'; st.runtime = rtSel.value; st.comments = cm.checked;
        rtB.hidden = st.runtime !== 'omit';
        if (!inp.value.trim()) { out.value = lastCode = ''; status.className = 'status'; status.textContent = 'Paste or open a Python program. Supported: functions, classes, comprehensions, f-strings, exceptions, generators, slicing, the math/random/time/json modules and the common built-ins.'; return null; }
        const r = compiler.compile(inp.value, { module: st.module, runtime: st.runtime, comments: st.comments, runtimeSource: compiler.runtime });
        lastErrors = r.errors;
        if (r.errors.length) {
          out.value = lastCode = ''; status.className = 'status err';
          status.textContent = `Not converted: ${r.errors.length} problem${r.errors.length > 1 ? 's' : ''}. ` + r.errors.map(e => `Line ${e.line}: ${e.msg}`).join(' · ');
          return r;
        }
        out.value = lastCode = r.code; status.className = 'status';
        { const at = r.code.split('\n').indexOf('// ---------- program ----------'); out.scrollTop = at > 0 ? at * (parseFloat(getComputedStyle(out).lineHeight) || 19) : 0; }
        status.textContent = `Converted · ${r.info.functions} function${r.info.functions === 1 ? '' : 's'}, ${r.info.classes} class${r.info.classes === 1 ? '' : 'es'} · ${fmtSize(new Blob([r.code]).size)}${st.runtime === 'inline' ? ' (runtime included)' : ''}`;
        return r;
      }
      async function run() {
        if (!compiler) await convert();
        const r = compiler.compile(inp.value, { module: false, runtime: 'omit', comments: false, runtimeSource: compiler.runtime });
        con.clear();
        if (r.errors.length) { con.add('Can’t run: ' + r.errors.map(e => `line ${e.line}: ${e.msg}`).join('; ') + '\n', 'err'); return { errors: r.errors }; }
        const code = r.code.split('\n').filter(l => !/^\/\/ Transpiled from Python|^import py from/.test(l)).join('\n');
        runB.disabled = true; stopB.disabled = false; const t0 = performance.now();
        const lines = stdin.value ? stdin.value.replace(/\r/g, '').split('\n') : [];
        const why = await runSandboxed(workerProgram(compiler.runtime, code, lines), { onMessage: m => con.add(m.s + '\n', m.t === 'err' ? 'err' : 'out'), timeout: 20000 });
        runB.disabled = false; stopB.disabled = true;
        const ms = Math.round(performance.now() - t0);
        runHead.querySelector('.right').textContent = why === 'done' ? `finished in ${ms} ms` : why === 'timeout' ? 'stopped after 20 s' : 'stopped';
        if (why !== 'done') con.add(`\n[${why === 'timeout' ? 'Stopped: the program ran for more than 20 seconds' : 'Stopped'}]\n`, 'sys');
        return { why, output: con.text };
      }
      inp.oninput = () => { clearTimeout(tmr); tmr = setTimeout(convert, 250); };
      [fmtSel, rtSel, cm].forEach(c => c.onchange = convert);
      const load = async f => { inp.value = await LC.pdfInternals.readText(f); st.name = baseName(f.name); convert(); };
      openB.onclick = () => pick.click(); pick.onchange = () => { if (pick.files[0]) load(pick.files[0]); pick.value = ''; };
      inp.ondragover = e => e.preventDefault(); inp.ondrop = e => { e.preventDefault(); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); };
      sampleB.onclick = () => { inp.value = SAMPLE_PY; st.name = 'inventory'; stdin.value = 'Ada'; convert(); };
      copyB.onclick = () => lastCode && U.copyText(lastCode);
      dlB.onclick = () => lastCode && U.download(new Blob([lastCode], { type: 'text/javascript' }), `${st.name}.${st.module ? 'mjs' : 'js'}`);
      rtB.onclick = async () => { const rt = compiler.runtime.replace(/\nif \(typeof module[^\n]*\n?$/, '\n'); U.download(new Blob([st.module ? rt + '\nexport default py;\n' : rt], { type: 'text/javascript' }), 'py-runtime.js'); };
      runB.onclick = run; stopB.onclick = () => runSandboxed.stop && runSandboxed.stop();
      convert();
      return { input(s) { inp.value = s; return convert(); }, set(k, v) { if (k === 'module') fmtSel.value = v ? 'module' : 'script'; if (k === 'runtime') rtSel.value = v; if (k === 'comments') cm.checked = v; if (k === 'stdin') stdin.value = v; return convert(); }, run, get output() { return lastCode; }, get errors() { return lastErrors; }, get console() { return con.text; } };
    }
  });
  alias('py-to-js', 'python-to-js'); alias('python-to-javascript', 'python-to-js');

  /* ---------------- Python → runnable web page ---------------- */
  const PAGE_CSS = `body{margin:0;font:15px/1.5 "Segoe UI",system-ui,sans-serif;background:#eef3f8;color:#13202e}header{background:linear-gradient(#3c7fb1,#1e395b);color:#fff;padding:14px 20px}header h1{margin:0;font-weight:400;font-size:22px}header p{margin:2px 0 0;opacity:.8;font-size:13px}main{max-width:900px;margin:18px auto;padding:0 16px}.bar{display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;margin-bottom:10px}button{font:inherit;padding:6px 18px;border-radius:4px;border:1px solid #1c5a96;color:#fff;background:linear-gradient(#8fd0ff,#4ea4ea 48%,#2a7fd4 50%,#3c95e3);cursor:pointer}textarea{flex:1;min-width:220px;min-height:46px;font:13px Consolas,monospace;padding:6px;border:1px solid #9fb3c8;border-radius:4px}#console{background:#0f1b2b;color:#dfe9f5;font:14px/1.45 Consolas,"Lucida Console",monospace;padding:12px 14px;border-radius:6px;min-height:200px;white-space:pre-wrap;word-break:break-word}#console .err{color:#ff9f8f}#console .in{color:#9fe39b}#console .sys{color:#8fb8e8}details{margin-top:14px;background:#fff;border:1px solid #c5d5e8;border-radius:6px;padding:8px 12px}pre.src{margin:8px 0 0;overflow:auto;font:13px/1.45 Consolas,monospace}footer{text-align:center;font-size:12px;color:#5b6b7c;margin:20px}`;
  function pageShell({ title, sourcePy, engineNote, scripts, runner, autorun }) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<header><h1>${esc(title)}</h1><p>${esc(engineNote)}</p></header>
<main>
<div class="bar"><button id="run" type="button">▶ Run</button><textarea id="stdin" placeholder="Input for input(): one line per call. Leave empty to be asked when the program needs it."></textarea></div>
<div id="console" role="log" aria-live="polite"></div>
<details><summary>Python source</summary><pre class="src">${esc(sourcePy)}</pre></details>
</main>
<footer>Made with Lumen Convert · runs entirely in this browser, offline</footer>
${scripts}
<script>
(function () {
  var con = document.getElementById('console');
  function write(kind, s) { var sp = document.createElement('span'); sp.className = kind; sp.textContent = s; con.appendChild(sp); con.scrollTop = con.scrollHeight; }
  window.lcWrite = write;
  ${runner}
  function go(lines) { con.textContent = ''; var box = document.getElementById('stdin'); var l = lines || (box.value ? box.value.replace(/\\r/g, '').split('\\n') : []); runProgram(l, function () { try { if (parent !== window) parent.postMessage({ t: 'lumen-page-done', text: con.textContent }, '*'); } catch (e) {} }); }
  document.getElementById('run').onclick = function () { go(); };
  window.addEventListener('message', function (e) { if (e.source === parent && e.data && e.data.t === 'lumen-page-run') go(e.data.stdin || []); });
  ${autorun ? 'go();' : ''}
})();
<\/script>
</body>
</html>
`;
  }
  const BRYTHON_PRELUDE = `import sys, builtins
from browser import window
class _LumenOut:
    def __init__(self, kind):
        self.kind = kind
    def write(self, s):
        window.lcWrite(self.kind, str(s))
        return len(str(s))
    def flush(self):
        pass
sys.stdout = _LumenOut('out')
sys.stderr = _LumenOut('err')
def _lumen_input(prompt=''):
    sys.stdout.write(str(prompt))
    line = window.lcReadLine(str(prompt))
    if line is None:
        raise EOFError('EOF when reading a line')
    window.lcWrite('in', line + '\\n')
    return line
builtins.input = _lumen_input
`;
  async function buildPage(src, o) {
    const title = o.title || 'Python program';
    if (o.engine === 'js') {
      const { compile, runtime } = await loadPy();
      const r = compile(src, { module: false, runtime: 'omit', comments: false, runtimeSource: runtime });
      if (r.errors.length) { const e = new Error('Can’t transpile: ' + r.errors.map(x => `line ${x.line}: ${x.msg}`).join('; ')); e.errors = r.errors; throw e; }
      const code = r.code.split('\n').filter(l => !/^\/\/ Transpiled from Python/.test(l)).join('\n');
      const workerSrc = `${runtime}\npy.stdout.line = function (s) { postMessage(['out', s + '\\n']); };\nconsole.error = function (s) { postMessage(['err', String(s) + '\\n']); };\nvar pyIn = py.input; py.input = function (p) { var r = pyIn(p); py.stdout.write(r + '\\n'); return r; };\nonmessage = function (e) { py.stdin.lines = e.data; try { (function () { ${code} })(); } catch (err) { py.report(err); } finally { py.stdout.flush(); postMessage(['done']); } };`;
      const runner = `var WSRC = ${noScriptClose(JSON.stringify(workerSrc))};
  function runProgram(lines, done) {
    var w = new Worker(URL.createObjectURL(new Blob([WSRC], { type: 'text/javascript' })));
    var t = setTimeout(function () { w.terminate(); write('sys', '\\n[Stopped after 30 seconds]\\n'); done(); }, 30000);
    w.onmessage = function (e) { if (e.data[0] === 'done') { clearTimeout(t); w.terminate(); done(); } else write(e.data[0], e.data[1]); };
    w.postMessage(lines);
  }`;
      return pageShell({ title, sourcePy: src, engineNote: 'Python transpiled to JavaScript by Lumen Convert (no Python runtime needed)', scripts: '', runner, autorun: o.autorun });
    }
    const [core, lib] = await Promise.all([fetchText('vendor/brython/brython.min.js'), fetchText('vendor/brython/brython_stdlib_lumen.js')]);
    const runner = `var SRC = ${noScriptClose(JSON.stringify(src))}, PRE = ${noScriptClose(JSON.stringify(BRYTHON_PRELUDE))}, queue = [];
  window.lcReadLine = function (p) { if (queue.length) return queue.shift(); try { var r = window.prompt(p); return r === null || r === undefined ? null : r; } catch (e) { return null; } };
  function runProgram(lines, done) {
    queue = lines.slice();
    try { __BRYTHON__.runPythonSource(PRE, { id: 'lumen_prelude' }); __BRYTHON__.runPythonSource(SRC, { id: '__main__' }); }
    catch (e) { if (!con.lastChild || !/Error/.test(con.lastChild.textContent)) write('err', String(e && e.message || e) + '\\n'); }
    done();
  }`;
    // brython_path is preset because an inline/srcdoc/file:// page has no script URL for Brython to derive it from (all modules come from the bundled VFS)
    const scripts = `<script>window.__BRYTHON__ = { brython_path: 'https://brython.invalid/' };<\/script>
<script>${noScriptClose(core)}<\/script>\n<script>${noScriptClose(lib)}<\/script>\n<script>__BRYTHON__.debug = 0;<\/script>`;
    return pageShell({ title, sourcePy: src, engineNote: 'Python 3 running in the browser with Brython · modules: math, random, time, json, re, datetime, collections, itertools, string, functools, heapq, bisect, copy, textwrap', scripts, runner, autorun: o.autorun });
  }
  register({
    id: 'python-to-html', cat: 'code', glyph: 'pyweb', name: 'Python → web page', keywords: 'python to html web page browser run brython share program offline',
    desc: 'Wrap a Python program in one self-contained .html file that runs it in any browser, offline.',
    render(root) {
      const st = { engine: 'brython', title: 'My Python program', autorun: true, name: 'program', url: null };
      const cols = el('div', 'cols'), L = el('div'), R = el('div'); cols.append(L, R); root.append(cols);
      L.append(el('div', 'ph', '<span class="phi"></span>Python program'));
      const tb = el('div', 'tb'); tb.style.cssText = 'display:flex;gap:6px;padding:6px 10px;background:linear-gradient(#f9fbfd,#eef3f9);border-bottom:1px solid var(--line)';
      const openB = el('button', 'mini', 'Open .py…'), sampleB = el('button', 'mini', 'Sample'), pick = el('input'); pick.type = 'file'; pick.accept = '.py,text/plain'; pick.className = 'vh'; [openB, sampleB].forEach(b => b.type = 'button'); tb.append(openB, sampleB, pick);
      const inp = el('textarea'); inp.spellcheck = false; inp.placeholder = 'Paste Python here, or drop a .py file'; inp.style.cssText = 'width:100%;min-height:300px;border:0;border-radius:0;font:13px/1.45 Consolas,monospace;padding:10px 12px';
      L.append(tb, inp);
      R.append(el('div', 'ph', '<span class="phi"></span>Page'));
      const rb = el('div', 'box'), form = el('div', 'form'); rb.append(form); R.append(rb);
      for (const f of [{ key: 'engine', label: 'Engine', type: 'select', options: [['brython', 'Python in the browser (Brython, about 1.6 MB page)'], ['js', 'Transpile to JavaScript (light page, about 50 KB)']] }, { key: 'title', label: 'Title', type: 'text' }, { key: 'autorun', label: 'Start', type: 'checkbox', text: 'Run as soon as the page opens' }])
        for (const n of LC.optionField(f, st[f.key], v => st[f.key] = v)) form.append(n);
      const acts = el('div', 'actions'), mk = el('button', 'go big', 'Make page'); mk.type = 'button'; acts.append(mk); rb.append(acts);
      rb.append(el('p', 'note', 'Brython supports most of Python 3 plus math, random, time, json, re, datetime, collections, itertools, string, functools, heapq, bisect, copy and textwrap. Not included: files, networking, numpy and other packages, turtle. The transpiled option is lighter but only supports the subset described in Python → JavaScript.'));
      const status = el('p', 'dim'); status.style.fontSize = '13px'; rb.append(status);
      const resHead = el('div', 'ph', '<span class="phi"></span>Preview (sandboxed)<span class="right"></span>'); resHead.hidden = true; root.append(resHead);
      const res = el('ul', 'res'); res.hidden = true; root.append(res);
      const frameWrap = el('div'); frameWrap.hidden = true; frameWrap.style.cssText = 'padding:0 10px 10px'; root.append(frameWrap);
      let frame = null, html = null;
      async function make() {
        status.textContent = 'Building…'; status.style.color = '';
        try { html = await buildPage(inp.value, st); }
        catch (e) { status.textContent = e.message; status.style.color = '#a3361c'; return null; }
        const blob = new Blob([html], { type: 'text/html' });
        if (st.url) URL.revokeObjectURL(st.url); st.url = URL.createObjectURL(blob);
        res.innerHTML = ''; const li = el('li'), info = el('div', 'info'), name = `${st.name}.html`;
        info.append(el('span', 'nm', esc(name)), el('small', null, `${fmtSize(blob.size)} · ${st.engine === 'brython' ? 'Brython' : 'transpiled JavaScript'} · works offline`));
        const a = el('a', 'btn go', 'Download'); a.href = st.url; a.download = name; li.append(info, a); res.append(li); res.hidden = resHead.hidden = false;
        // preview: same file in a sandboxed iframe (scripts allowed, but an opaque origin: no access to this page)
        frameWrap.innerHTML = ''; frame = el('iframe'); frame.setAttribute('sandbox', 'allow-scripts'); frame.title = 'Preview of the generated page'; frame.style.cssText = 'width:100%;height:520px;border:1px solid #c9d6e4;border-radius:4px;background:#fff';
        frame.srcdoc = html; frameWrap.append(frame); frameWrap.hidden = false; status.textContent = 'Done. The preview runs in a sandbox; download the page to share it.';
        return blob;
      }
      // test/automation hook: run the preview with given stdin lines and resolve with its console text
      function runPreview(lines, timeout = 30000) {
        return new Promise(resolve => {
          if (!frame) return resolve(null);
          const t = setTimeout(() => { window.removeEventListener('message', on); resolve(null); }, timeout);
          const on = e => { if (e.source === frame.contentWindow && e.data && e.data.t === 'lumen-page-done') { clearTimeout(t); window.removeEventListener('message', on); resolve(e.data.text); } };
          window.addEventListener('message', on);
          const send = () => frame.contentWindow.postMessage({ t: 'lumen-page-run', stdin: lines }, '*');
          if (frame.dataset.loaded) send(); else frame.addEventListener('load', () => { frame.dataset.loaded = 1; setTimeout(send, 50); }, { once: true });
        });
      }
      const load = async f => { inp.value = await LC.pdfInternals.readText(f); st.name = baseName(f.name); };
      openB.onclick = () => pick.click(); pick.onchange = () => { if (pick.files[0]) load(pick.files[0]); pick.value = ''; };
      inp.ondragover = e => e.preventDefault(); inp.ondrop = e => { e.preventDefault(); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); };
      sampleB.onclick = () => { inp.value = SAMPLE_PY; st.name = 'inventory'; };
      mk.onclick = make;
      return { input(s) { inp.value = s; }, set(k, v) { st[k] = v; }, make, runPreview, get html() { return html; }, destroy() { if (st.url) URL.revokeObjectURL(st.url); } };
    }
  });
  alias('py-to-html', 'python-to-html');

  /* ---------------- syntax highlighting ---------------- */
  let hlP = null;
  const EXTRA_LANGS = ['powershell', 'dockerfile', 'scala', 'haskell', 'matlab', 'nginx'];
  const hljsLoad = () => hlP || (hlP = (async () => { const h = await U.loadScript('vendor/highlight/highlight.min.js', 'hljs'); for (const l of EXTRA_LANGS) await U.loadScript(`vendor/highlight/${l}.min.js`); h.configure({ ignoreUnescapedHTML: true }); return h; })().catch(e => { hlP = null; throw e; }));
  const THEMES = {
    light: { bg: '#ffffff', fg: '#1f2328', gutter: '#8c959f', mark: '#fff8c5', border: '#d0d7de', head: '#f6f8fa', headFg: '#1f2328',
      t: { keyword: '#cf222e', built_in: '#8250df', type: '#953800', literal: '#0550ae', number: '#0550ae', string: '#0a3069', regexp: '#0a3069', symbol: '#0550ae', comment: '#6e7781;font-style:italic', doc: '#6e7781', meta: '#8250df', title: '#8250df', 'title.class_': '#953800', 'title.function_': '#8250df', params: '#1f2328', attr: '#0550ae', attribute: '#0550ae', variable: '#953800', 'template-variable': '#953800', tag: '#116329', name: '#116329', 'selector-tag': '#116329', 'selector-class': '#6639ba', 'selector-id': '#0550ae', property: '#0550ae', operator: '#cf222e', section: '#0550ae;font-weight:bold', bullet: '#953800', link: '#0a3069;text-decoration:underline', emphasis: 'inherit;font-style:italic', strong: 'inherit;font-weight:bold', addition: '#116329;background:#dafbe1', deletion: '#82071e;background:#ffebe9', subst: '#1f2328', 'meta keyword': '#cf222e', 'meta string': '#0a3069' } },
    dark: { bg: '#1e2228', fg: '#abb2bf', gutter: '#5c6370', mark: '#3a3f4b', border: '#3e4451', head: '#282c34', headFg: '#d7dae0',
      t: { keyword: '#c678dd', built_in: '#e6c07b', type: '#e6c07b', literal: '#56b6c2', number: '#d19a66', string: '#98c379', regexp: '#98c379', symbol: '#61aeee', comment: '#7f848e;font-style:italic', doc: '#7f848e', meta: '#61aeee', title: '#61aeee', 'title.class_': '#e6c07b', 'title.function_': '#61aeee', params: '#abb2bf', attr: '#d19a66', attribute: '#98c379', variable: '#e06c75', 'template-variable': '#e06c75', tag: '#e06c75', name: '#e06c75', 'selector-tag': '#e06c75', 'selector-class': '#d19a66', 'selector-id': '#61aeee', property: '#e06c75', operator: '#56b6c2', section: '#e06c75', bullet: '#61aeee', link: '#61aeee;text-decoration:underline', emphasis: 'inherit;font-style:italic', strong: 'inherit;font-weight:bold', addition: '#98c379', deletion: '#e06c75', subst: '#e06c75' } },
    vista: { bg: '#ffffff', fg: '#0f1c2c', gutter: '#7a8da3', mark: '#e5f1fd', border: '#84acdd', head: 'linear-gradient(#fbfdff,#dbe7f5)', headFg: '#1e395b',
      t: { keyword: '#1d5fb0;font-weight:600', built_in: '#2b7a99', type: '#2b7a99', literal: '#1d5fb0', number: '#a3361c', string: '#a3361c', regexp: '#a3361c', symbol: '#a3361c', comment: '#3a8a3a;font-style:italic', doc: '#3a8a3a', meta: '#6a3fd0', title: '#6a3fd0', 'title.class_': '#2b7a99;font-weight:600', 'title.function_': '#6a3fd0', params: '#0f1c2c', attr: '#c45f00', attribute: '#c45f00', variable: '#c45f00', 'template-variable': '#c45f00', tag: '#1d5fb0', name: '#1d5fb0', 'selector-tag': '#1d5fb0', 'selector-class': '#c45f00', 'selector-id': '#c45f00', property: '#c45f00', operator: '#0f1c2c', section: '#1e395b;font-weight:bold', bullet: '#1d5fb0', link: '#0066cc;text-decoration:underline', emphasis: 'inherit;font-style:italic', strong: 'inherit;font-weight:bold', addition: '#1f7a2a;background:#e6f6e3', deletion: '#a3361c;background:#fde9e6', subst: '#0f1c2c' } }
  };
  const tokenStyle = (theme, classes) => {
    const names = classes.split(/\s+/).map(c => c.replace(/^hljs-/, '')).filter(Boolean);
    const key = names.join(' '), first = names[0] || '';
    const v = theme.t[key] ?? theme.t[first + '.' + (names[1] || '').replace(/_$/, '') + '_'] ?? theme.t[first];
    if (!v) return '';
    const [color, ...rest] = v.split(';');
    return (color === 'inherit' ? '' : `color:${color};`) + rest.map(r => r + ';').join('');
  };
  // split highlighted HTML into lines, closing and reopening spans across line breaks
  function splitLines(html) {
    const lines = [''], open = [];
    const re = /(<span[^>]*>)|(<\/span>)|([^<]+)|(<[^>]+>)/g; let m;
    while ((m = re.exec(html))) {
      if (m[1]) { open.push(m[1]); lines[lines.length - 1] += m[1]; }
      else if (m[2]) { open.pop(); lines[lines.length - 1] += m[2]; }
      else if (m[3]) { const parts = m[3].split('\n'); parts.forEach((p, i) => { if (i > 0) { lines[lines.length - 1] += '</span>'.repeat(open.length); lines.push(open.join('')); } lines[lines.length - 1] += p; }); }
      else lines[lines.length - 1] += m[4];
    }
    return lines;
  }
  function parseLineSet(s) { const set = new Set(); for (const part of String(s || '').split(/[,\s]+/).filter(Boolean)) { const m = part.match(/^(\d+)(?:-(\d+))?$/); if (!m) continue; const a = +m[1], b = m[2] ? +m[2] : a; for (let i = Math.min(a, b); i <= Math.max(a, b) && i - a < 100000; i++) set.add(i); } return set; }
  async function highlightToHtml(code, o) {
    const h = await hljsLoad();
    code = code.replace(/\r\n?/g, '\n').replace(/\t/g, ' '.repeat(o.tab || 4)).replace(/\n$/, '');
    let res, lang = o.lang;
    if (lang === 'auto') { res = h.highlightAuto(code); lang = res.language || 'plaintext'; }
    else { if (!h.getLanguage(lang)) throw new Error('Unknown language ' + lang); res = h.highlight(code, { language: lang, ignoreIllegals: true }); }
    const theme = THEMES[o.theme] || THEMES.light, marks = parseLineSet(o.marks), start = Math.max(0, Math.round(+o.start || 1));
    const lines = splitLines(res.value).map(l => l.replace(/<span class="([^"]*)">/g, (a, c) => { const s = tokenStyle(theme, c); return s ? `<span style="${s}">` : '<span>'; }));
    const gw = String(start + lines.length - 1).length;
    const font = 'font-family:Consolas,\'Cascadia Mono\',Menlo,\'Liberation Mono\',monospace;font-size:' + (o.size || 13) + 'px;line-height:1.5';
    const body = lines.map((l, i) => {
      const n = start + i, marked = marks.has(n);
      const num = o.numbers ? `<span style="display:inline-block;min-width:${gw}ch;padding:0 12px 0 0;margin-right:12px;text-align:right;color:${theme.gutter};border-right:1px solid ${theme.border};user-select:none;-webkit-user-select:none">${n}</span>` : '';
      return `<div style="white-space:pre;padding:0 14px;${marked ? `background:${theme.mark};` : ''}">${num}${l || ' '}</div>`;
    }).join('');
    const title = o.title ? `<div style="${font};font-family:'Segoe UI',system-ui,sans-serif;font-size:13px;padding:7px 14px;background:${theme.head};color:${theme.headFg};border-bottom:1px solid ${theme.border}">${esc(o.title)}</div>` : '';
    const snippet = `<div style="background:${theme.bg};color:${theme.fg};border:1px solid ${theme.border};border-radius:6px;overflow:hidden;max-width:100%">${title}<div style="${font};overflow:auto;padding:10px 0">${body}</div></div>`;
    const docTitle = o.title || 'Code';
    const doc = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${esc(docTitle)}</title>\n</head>\n<body style="margin:0;padding:24px;background:${o.theme === 'dark' ? '#14171c' : '#eef3f8'}">\n${snippet}\n</body>\n</html>\n`;
    return { lang, snippet, doc, lines: lines.length, relevance: res.relevance };
  }
  const LANGS = [['auto', 'Auto-detect'], ['python', 'Python'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['java', 'Java'], ['c', 'C'], ['cpp', 'C++'], ['csharp', 'C#'], ['go', 'Go'], ['rust', 'Rust'], ['php', 'PHP'], ['ruby', 'Ruby'], ['kotlin', 'Kotlin'], ['swift', 'Swift'], ['scala', 'Scala'], ['haskell', 'Haskell'], ['r', 'R'], ['matlab', 'MATLAB'], ['lua', 'Lua'], ['perl', 'Perl'], ['sql', 'SQL'], ['bash', 'Bash'], ['powershell', 'PowerShell'], ['xml', 'HTML / XML'], ['css', 'CSS'], ['scss', 'SCSS'], ['json', 'JSON'], ['yaml', 'YAML'], ['ini', 'INI / TOML'], ['markdown', 'Markdown'], ['dockerfile', 'Dockerfile'], ['makefile', 'Makefile'], ['nginx', 'nginx'], ['diff', 'Diff'], ['graphql', 'GraphQL'], ['plaintext', 'Plain text']];
  const EXT_LANG = { py: 'python', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', go: 'go', rs: 'rust', php: 'php', rb: 'ruby', kt: 'kotlin', swift: 'swift', scala: 'scala', hs: 'haskell', r: 'r', m: 'matlab', lua: 'lua', pl: 'perl', sql: 'sql', sh: 'bash', bash: 'bash', ps1: 'powershell', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', json: 'json', yml: 'yaml', yaml: 'yaml', ini: 'ini', toml: 'ini', md: 'markdown', dockerfile: 'dockerfile', mk: 'makefile', conf: 'nginx', diff: 'diff', patch: 'diff', graphql: 'graphql', txt: 'plaintext' };
  async function copyRich(html, text) {
    try { await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]); U.toast('Copied with formatting'); return true; }
    catch (e) { // fallback: copy from a hidden, contenteditable-free container
      const d = document.createElement('div'); d.style.cssText = 'position:fixed;left:-9999px;top:0'; d.innerHTML = html; document.body.appendChild(d);
      const r = document.createRange(); r.selectNodeContents(d); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      let ok = false; try { ok = document.execCommand('copy'); } catch (er) { ok = false; } s.removeAllRanges(); d.remove();
      U.toast(ok ? 'Copied with formatting' : 'Copy failed: select the preview and press Ctrl+C'); return ok;
    }
  }
  register({
    id: 'code-to-html', cat: 'code', glyph: 'codehl', name: 'Code → HTML (syntax highlighted)', keywords: 'code syntax highlight html highlighter pretty print source snippet email blog line numbers',
    desc: 'Turn source code into colourful HTML for blogs, docs and email, with line numbers and highlighted lines.',
    render(root, preset) {
      const st = { lang: 'auto', theme: 'vista', numbers: true, start: 1, marks: '', title: '', size: 13, out: 'snippet', name: 'code', ...(preset || {}) };
      const io = el('div', 'io'), L = el('div'), R = el('div'); io.append(L, R); root.append(io);
      const tbL = el('div', 'tb'), openB = el('button', 'mini', 'Open file…'), sampleB = el('button', 'mini', 'Sample'), pick = el('input'); pick.type = 'file'; pick.className = 'vh'; [openB, sampleB].forEach(b => b.type = 'button');
      tbL.append(el('b', null, 'Code'), el('span', 'sp'), openB, sampleB, pick);
      const inp = el('textarea'); inp.spellcheck = false; inp.placeholder = 'Paste code here, or drop a source file'; L.append(tbL, inp);
      const form = el('div', 'form'); form.style.cssText = 'padding:10px 12px;border-top:1px solid var(--line);background:#f8fafc';
      const fields = [{ key: 'lang', label: 'Language', type: 'select', options: LANGS }, { key: 'theme', label: 'Theme', type: 'select', options: [['vista', 'Vista (Lumen)'], ['light', 'Light'], ['dark', 'Dark']] }, { key: 'numbers', label: 'Line numbers', type: 'checkbox', text: 'Show' }, { key: 'start', label: 'Start at', type: 'number', min: 0, max: 1000000, step: 1 }, { key: 'marks', label: 'Highlight lines', type: 'text', placeholder: 'Line numbers as shown, e.g. 3, 7-9' }, { key: 'title', label: 'Title', type: 'text', placeholder: 'Optional, e.g. a file name' }, { key: 'out', label: 'Output', type: 'select', options: [['snippet', 'Embeddable snippet (inline styles)'], ['doc', 'Standalone .html page']] }];
      for (const f of fields) for (const n of LC.optionField(f, st[f.key], v => { st[f.key] = v; render(); })) form.append(n);
      L.append(form);
      const tbR = el('div', 'tb'), copyB = el('button', 'go mini', 'Copy HTML'), richB = el('button', 'mini', 'Copy as rich text'), dlB = el('button', 'mini', 'Download .html'); [copyB, richB, dlB].forEach(b => b.type = 'button');
      tbR.append(el('b', null, 'Preview'), el('span', 'sp'), copyB, richB, dlB);
      const frame = el('iframe'); frame.setAttribute('sandbox', ''); frame.title = 'Highlighted preview'; frame.style.cssText = 'width:100%;min-height:320px;flex:1;border:0;background:#eef3f8';
      const src = el('textarea'); src.readOnly = true; src.spellcheck = false; src.style.minHeight = '140px';
      R.append(tbR, frame, src);
      const status = el('div', 'status'); root.append(status);
      let cur = null, tmr;
      async function render() {
        if (!inp.value.trim()) { status.textContent = 'Paste or open source code.'; status.className = 'status'; frame.srcdoc = ''; src.value = ''; cur = null; return null; }
        try { cur = await highlightToHtml(inp.value, st); } catch (e) { status.className = 'status err'; status.textContent = e.message; return null; }
        frame.srcdoc = `<!doctype html><meta charset="utf-8"><body style="margin:0;padding:14px;background:${st.theme === 'dark' ? '#14171c' : '#eef3f8'}">${cur.snippet}</body>`;
        src.value = st.out === 'doc' ? cur.doc : cur.snippet; status.className = 'status';
        status.textContent = `${LANGS.find(l => l[0] === cur.lang)?.[1] || cur.lang}${st.lang === 'auto' ? ' (detected)' : ''} · ${cur.lines} line${cur.lines === 1 ? '' : 's'} · ${fmtSize(new Blob([src.value]).size)} of HTML`;
        return cur;
      }
      inp.oninput = () => { clearTimeout(tmr); tmr = setTimeout(render, 250); };
      const load = async f => { inp.value = await LC.pdfInternals.readText(f); st.name = baseName(f.name); const l = EXT_LANG[extOf(f.name)] || (/^dockerfile$/i.test(f.name) ? 'dockerfile' : /^makefile$/i.test(f.name) ? 'makefile' : null); if (l) { st.lang = l; const s = form.querySelector('#o-lang'); if (s) s.value = l; } if (!st.title) { st.title = f.name; const t = form.querySelector('#o-title'); if (t) t.value = f.name; } render(); };
      openB.onclick = () => pick.click(); pick.onchange = () => { if (pick.files[0]) load(pick.files[0]); pick.value = ''; };
      inp.ondragover = e => e.preventDefault(); inp.ondrop = e => { e.preventDefault(); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); };
      sampleB.onclick = () => { inp.value = SAMPLE_PY; render(); };
      copyB.onclick = () => src.value && U.copyText(src.value);
      richB.onclick = () => cur && copyRich(cur.snippet, inp.value);
      dlB.onclick = () => cur && U.download(new Blob([cur.doc], { type: 'text/html' }), `${st.name}.html`);
      render();
      return { input(s) { inp.value = s; return render(); }, set(k, v) { st[k] = v; return render(); }, get result() { return cur; }, copyRich: () => cur && copyRich(cur.snippet, inp.value) };
    }
  });
  alias('highlight-code', 'code-to-html');

  /* ---------------- Jupyter notebook → HTML ---------------- */
  const stripAnsi = s => String(s).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  const joinSrc = s => Array.isArray(s) ? s.join('') : String(s || '');
  const NB_FORBID = ['style', 'link', 'meta', 'base', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'frame', 'object', 'embed', 'applet', 'audio', 'video', 'source', 'track'];
  async function notebookHtml(nb, o) {
    if (!nb || !Array.isArray(nb.cells)) throw new Error(nb && nb.worksheets ? 'This is an old (v3) notebook; save it with a current Jupyter to convert it' : 'Not a Jupyter notebook (.ipynb) file');
    const DOMPurify = await U.lib.purify(), marked = await U.lib.marked(), h = await hljsLoad();
    const clean = html => DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: NB_FORBID, FORBID_ATTR: ['style'] });
    const lang = (nb.metadata && ((nb.metadata.language_info && nb.metadata.language_info.name) || (nb.metadata.kernelspec && nb.metadata.kernelspec.language))) || 'python';
    const theme = THEMES.light, styled = html => splitLines(html).join('\n').replace(/<span class="([^"]*)">/g, (a, c) => { const s = tokenStyle(theme, c); return s ? `<span style="${s}">` : '<span>'; });
    const hl = code => { try { return styled(h.getLanguage(lang) ? h.highlight(code, { language: lang, ignoreIllegals: true }).value : esc(code)); } catch (e) { return esc(code); } };
    const parts = []; let nCode = 0, nMd = 0, nOut = 0, dropped = 0;
    for (const cell of nb.cells) {
      const src = joinSrc(cell.source);
      if (cell.cell_type === 'markdown') { nMd++; parts.push(`<section class="cell md">${clean(marked.parse(src, { gfm: true }))}</section>`); continue; }
      if (cell.cell_type === 'raw') { parts.push(`<section class="cell raw"><pre>${esc(src)}</pre></section>`); continue; }
      if (cell.cell_type !== 'code') continue;
      nCode++;
      const count = cell.execution_count == null ? ' ' : cell.execution_count;
      let html = '';
      if (!o.hideCode) html += `<div class="in">${o.prompts ? `<div class="prompt">In [${esc(String(count))}]:</div>` : ''}<pre class="code">${hl(src)}</pre></div>`;
      if (!o.hideOutputs) {
        for (const out of cell.outputs || []) {
          nOut++; let body = '';
          if (out.output_type === 'stream') body = `<pre class="stream ${out.name === 'stderr' ? 'stderr' : ''}">${esc(stripAnsi(joinSrc(out.text)))}</pre>`;
          else if (out.output_type === 'error') body = `<pre class="stream stderr">${esc(stripAnsi((out.traceback || []).join('\n') || `${out.ename}: ${out.evalue}`))}</pre>`;
          else if (out.output_type === 'execute_result' || out.output_type === 'display_data') {
            const d = out.data || {};
            if (d['image/png']) body = `<img alt="output" src="data:image/png;base64,${joinSrc(d['image/png']).replace(/[^A-Za-z0-9+/=]/g, '')}">`;
            else if (d['image/jpeg']) body = `<img alt="output" src="data:image/jpeg;base64,${joinSrc(d['image/jpeg']).replace(/[^A-Za-z0-9+/=]/g, '')}">`;
            else if (d['image/svg+xml']) body = `<img alt="output" src="data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(joinSrc(d['image/svg+xml']))))}">`;
            else if (d['text/html']) body = `<div class="html">${clean(joinSrc(d['text/html']))}</div>`;
            else if (d['text/markdown']) body = `<div class="html">${clean(marked.parse(joinSrc(d['text/markdown'])))}</div>`;
            else if (d['text/latex']) body = `<pre class="stream">${esc(joinSrc(d['text/latex']))}</pre>`;
            else if (d['text/plain']) body = `<pre class="stream">${esc(stripAnsi(joinSrc(d['text/plain'])))}</pre>`;
            else { body = '<p class="omitted">(interactive output omitted: it needs JavaScript)</p>'; dropped++; }
          }
          if (body) html += `<div class="out">${o.prompts && out.output_type === 'execute_result' ? `<div class="prompt">Out[${esc(String(out.execution_count ?? count))}]:</div>` : o.prompts ? '<div class="prompt"></div>' : ''}${body}</div>`;
        }
      }
      if (html) parts.push(`<section class="cell code">${html}</section>`);
    }
    const title = o.title || (nb.metadata && nb.metadata.title) || 'Notebook';
    const css = `body{margin:0;background:#f4f7fa;color:#1b2733;font:15px/1.6 "Segoe UI",system-ui,sans-serif}main{max-width:980px;margin:0 auto;padding:24px 18px 48px}.cell{background:#fff;border:1px solid #dbe3ec;border-radius:6px;margin:0 0 12px;padding:10px 14px;overflow:auto}.cell.md{border-color:transparent;background:transparent;padding:4px 14px}.in,.out{display:flex;gap:10px;align-items:flex-start}.out{margin-top:8px}.prompt{flex:none;width:72px;text-align:right;font:12px/1.9 Consolas,monospace;color:#3c7fb1}.out .prompt{color:#c45f00}pre{margin:0;flex:1;min-width:0;overflow:auto;font:13px/1.5 Consolas,"Cascadia Mono",Menlo,monospace}pre.code{background:#f6f8fa;border:1px solid #e3e9ef;border-radius:4px;padding:8px 10px}pre.stderr{background:#fdf0ee;color:#8a1c0e;padding:6px 8px;border-radius:4px}img{max-width:100%;height:auto}.html{flex:1;min-width:0;overflow:auto}table{border-collapse:collapse;font-size:13px}th,td{border:1px solid #d0d7de;padding:3px 8px;text-align:right}th{background:#f6f8fa}.omitted{color:#5b6b7c;font-style:italic;margin:0}h1,h2,h3{color:#1e395b;line-height:1.25}code{font-family:Consolas,monospace;background:#eef2f6;padding:0 3px;border-radius:3px}`;
    const doc = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${esc(title)}</title>\n<style>${css}</style>\n</head>\n<body>\n<main>\n${parts.join('\n')}\n</main>\n</body>\n</html>\n`;
    return { doc, stats: { code: nCode, md: nMd, outputs: nOut, dropped } };
  }
  register({
    id: 'ipynb-to-html', cat: 'code', glyph: 'notebook', name: 'Jupyter notebook → HTML', keywords: 'jupyter notebook ipynb to html export share colab python report',
    desc: 'Render .ipynb notebooks as a clean HTML page: markdown, highlighted code, text, tables and charts.',
    accept: '.ipynb,application/x-ipynb+json,application/json', acceptText: 'Jupyter notebooks (.ipynb, format 4)', acceptTest: f => /^(ipynb|json)$/.test(extOf(f.name)), multiple: true, zipName: 'notebooks',
    options: [
      { key: 'hideCode', label: 'Code', type: 'checkbox', text: 'Hide code cells (show results only)', value: false },
      { key: 'hideOutputs', label: 'Outputs', type: 'checkbox', text: 'Hide outputs', value: false },
      { key: 'prompts', label: 'Prompts', type: 'checkbox', text: 'Show In [ ] / Out[ ] prompts', value: true },
      { key: 'title', label: 'Title', type: 'text', value: '', placeholder: 'Defaults to the notebook name' }],
    note: 'HTML outputs are sanitised (scripts, event handlers and frames removed). Interactive widgets and JavaScript outputs can’t be shown; maths is shown as written.',
    async each(f, o, ctx) {
      if (f.size > 200 * 1048576) throw new Error('Notebook is too large');
      ctx.progress(0.2, 'Reading ' + f.name);
      let nb; try { nb = JSON.parse(await LC.pdfInternals.readText(f)); } catch (e) { throw new Error('Not valid JSON: ' + e.message); }
      const r = await notebookHtml(nb, { ...o, title: o.title.trim() || baseName(f.name) });
      return { name: baseName(f.name) + '.html', blob: new Blob([r.doc], { type: 'text/html;charset=utf-8' }), info: `${r.stats.code} code · ${r.stats.md} markdown cells · ${r.stats.outputs} outputs${r.stats.dropped ? ` · ${r.stats.dropped} interactive output(s) omitted` : ''}`, html: r.doc };
    }
  });
  alias('notebook-to-html', 'ipynb-to-html');

  LC.codeInternals = { loadPy, runSandboxed, workerProgram, buildPage, highlightToHtml, notebookHtml, splitLines };
})();
