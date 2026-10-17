// Lumen Lab — MATLAB-style numeric computing desktop: editor, command window, workspace, figures.
(function () {
  'use strict';
  const $ = id => document.getElementById(id), esc = s => Aero.esc(String(s ?? ''));
  const AUTOSAVE = 'lumen-lab-autosave';
  const TEXT_EXT = /\.(m|txt|csv|dat|tsv|json)$/i;
  const S = {
    files: new Map(),      // virtual Current Folder: name → { text, saved, path }
    tabs: [],              // [{ kind: 'file'|'var', name }]
    active: -1, eds: new Map(),
    hist: [], hpos: null, hprefix: '',
    busy: false, ws: [], snap: null, curFig: null, selFile: null, selVar: null,
    fontSize: 13, inputMode: false, names: [], lastRunName: null,
  };
  const ext = n => (n.match(/\.([^.]+)$/) || [, ''])[1].toLowerCase();
  // next frame, or a short timer when the window is hidden (requestAnimationFrame does not run then)
  const frame = fn => { let done = false; const go = () => { if (!done) { done = true; fn(); } }; requestAnimationFrame(go); setTimeout(go, 50); return 1; };
  const stem = n => n.replace(/\.[^.]+$/, '');

  // ---------- engine worker ----------
  let W = null, ctrl = null, inbuf = null, sab = null, runSeq = 0, waiters = new Map(), stopTimer = 0, ready = null, readyResolve;
  function startWorker() {
    try { sab = new SharedArrayBuffer(32 + 2 * 65536); ctrl = new Int32Array(sab, 0, 8); inbuf = new Uint16Array(sab, 32); } catch (e) { sab = null; ctrl = null; }
    ready = new Promise(r => { readyResolve = r; });
    W = new Worker('js/worker.js');
    W.onmessage = onMsg;
    W.onerror = e => { cwPrint('Engine error: ' + (e.message || e) + '\n', 'err'); };
    W.postMessage({ type: 'init', sab });
  }
  function restartWorker(msg) {
    if (W) W.terminate();
    waiters.forEach(w => w({ ok: false, interrupted: true })); waiters.clear();
    setBusy(false); leaveInputMode(); clearTimeout(stopTimer);
    startWorker(); S.ws = []; renderWs(); S.snap = null; renderFigs();
    if (msg) cwPrint(msg + '\n', 'info');
  }
  function onMsg(e) {
    const m = e.data;
    switch (m.type) {
      case 'ready': S.names = m.names; readyResolve(); break;
      case 'out': cwPrint(m.text, m.kind); break;
      case 'figs': S.snap = m.snap; if (m.snap.cur != null) S.curFig = m.snap.cur; renderFigs(); break;
      case 'clc': $('cwOut').innerHTML = ''; break;
      case 'input': enterInputMode(m.prompt); break;
      case 'saveFigure': exportFigure(m.id, m.name); break;
      case 'value': case 'complete': case 'wsjson': { const w = waiters.get(m.req); if (w) { waiters.delete(m.req); w(m); } break; }
      case 'done': {
        clearTimeout(stopTimer); setBusy(false); leaveInputMode();
        S.ws = m.workspace || []; renderWs(); refreshVarTabs();
        if (m.files) mergeFiles(m.files);
        $('st4').textContent = `format ${m.format || 'short'} · ${S.ws.length} variable${S.ws.length === 1 ? '' : 's'}`;
        if (m.ok === false && m.line && m.file) markError(m.file, m.line);
        if (m.ms != null) $('st1').textContent = `Ran in ${m.ms < 1000 ? Math.round(m.ms) + ' ms' : (m.ms / 1000).toFixed(2) + ' s'}`;
        else if (m.interrupted) $('st1').textContent = 'Stopped';
        else if (m.ok === false) $('st1').textContent = 'Error';
        const w = waiters.get(m.id); if (w) { waiters.delete(m.id); w(m); }
        break;
      }
    }
  }
  const ask = (msg) => new Promise(res => { const req = ++runSeq; waiters.set(req, res); W.postMessage({ ...msg, req }); });
  function filesObj() { const o = {}; S.files.forEach((f, k) => { o[k] = f.text; }); return o; }
  // run code in the base workspace; resolves with the 'done' message
  async function run(code, { name = null, echo = null, quiet = false } = {}) {
    await ready;
    if (S.busy) { Aero.toast('Lumen Lab is busy — press Stop first.'); return { ok: false }; }
    if (echo != null) cwPrint(echo + '\n', 'echo');
    const id = ++runSeq; setBusy(true, name);
    S.lastRunName = name;
    clearErrors();
    return new Promise(res => { waiters.set(id, res); W.postMessage({ type: 'run', id, code, name, files: filesObj(), width: cwColumns(), quiet }); });
  }
  function stop() {
    if (!S.busy) return;
    if (ctrl) {
      Atomics.store(ctrl, 0, 1); Atomics.notify(ctrl, 3); if (S.inputMode) { Atomics.store(ctrl, 2, -1); Atomics.store(ctrl, 1, 1); Atomics.notify(ctrl, 1); }
      stopTimer = setTimeout(() => restartWorker('The engine did not stop in time and was restarted. The workspace was cleared.'), 2500);
    } else restartWorker('Stopped. The workspace was cleared (stopping needs a cross-origin isolated page).');
  }
  function setBusy(on, name) {
    S.busy = on; $('bStop').disabled = !on; $('bRun').disabled = on; $('bSection').disabled = on;
    $('busy').textContent = on ? 'Busy' : ''; $('cmdwin').classList.toggle('busy', on);
    if (on) $('st1').textContent = name ? `Running ${name}…` : 'Busy…';
  }

  // ---------- command window ----------
  const cwOut = $('cwOut'), cwIn = $('cwIn');
  let pendingText = '', pendingKind = null, cwRaf = 0;
  function cwPrint(text, kind = 'out') {
    if (pendingKind !== null && pendingKind !== kind) flushCw();
    pendingKind = kind; pendingText += text;
    if (!cwRaf) cwRaf = frame(flushCw);
  }
  function flushCw() {
    cwRaf = 0; if (!pendingText) { pendingKind = null; return; }
    const kind = pendingKind, text = pendingText; pendingText = ''; pendingKind = null;
    const last = cwOut.lastElementChild;
    if (kind === 'out' && last && last.dataset.k === 'out' && last.textContent.length < 50000) last.textContent += text;
    else {
      const span = document.createElement('span'); span.dataset.k = kind; span.className = kind;
      if (kind === 'err') span.innerHTML = esc(text).replace(/Error in ([\w.]+) \(line (\d+)\)/g, (m0, f, l) => `Error in <a data-f="${f}" data-l="${l}">${f} (line ${l})</a>`);
      else span.textContent = text;
      cwOut.appendChild(span);
    }
    while (cwOut.childNodes.length > 1500 || (cwOut.textContent.length > 400000 && cwOut.childNodes.length > 1)) cwOut.firstChild.remove();
    const cw = $('cmdwin'); cw.scrollTop = cw.scrollHeight;
  }
  function cwColumns() { const w = $('cmdwin').clientWidth - 30, cw = S.fontSize * 0.55; return Math.max(40, Math.floor(w / cw)); }
  function autosize() { cwIn.style.height = 'auto'; cwIn.style.height = cwIn.scrollHeight + 'px'; }
  function incomplete(code) {
    try { LabLang.parse(code); return false; } catch (e) { return /Missing END|Missing '\]'|Missing '\}'/.test(e.message) && !/\n\s*$/.test(code); }
  }
  async function submit() {
    const code = cwIn.value;
    if (S.inputMode) { replyInput(code); return; }
    if (S.busy) { Aero.toast('Still running — press Stop (Ctrl+C) to interrupt.'); return; }
    if (code.trim() && incomplete(code)) { insertAtCursor(cwIn, '\n'); autosize(); return; }
    cwIn.value = ''; autosize(); hideComplete();
    if (code.trim()) { if (S.hist[S.hist.length - 1] !== code) S.hist.push(code); if (S.hist.length > 300) S.hist.shift(); saveLater(); }
    S.hpos = null;
    cwPrint(code + '\n', 'echo');
    if (!code.trim()) return;
    await run(code);
  }
  function insertAtCursor(t, text) { t.focus(); if (!document.execCommand('insertText', false, text)) t.setRangeText(text, t.selectionStart, t.selectionEnd, 'end'); }
  function histNav(dir) {
    if (S.hpos === null) { S.hprefix = cwIn.value; S.hpos = S.hist.length; }
    let i = S.hpos;
    for (; ;) { i += dir; if (i < 0) return; if (i >= S.hist.length) { S.hpos = S.hist.length; cwIn.value = S.hprefix; autosize(); return; } if (S.hist[i].startsWith(S.hprefix)) break; }
    S.hpos = i; cwIn.value = S.hist[i]; autosize(); cwIn.setSelectionRange(cwIn.value.length, cwIn.value.length);
  }
  function enterInputMode(prompt) {
    flushCw(); S.inputMode = true; $('prompt').textContent = ''; $('cmdwin').querySelector('.cw-line').classList.add('input');
    cwPrint(prompt, 'out'); flushCw(); cwIn.value = ''; cwIn.focus();
  }
  function leaveInputMode() { if (!S.inputMode) return; S.inputMode = false; $('prompt').textContent = '>>'; $('cmdwin').querySelector('.cw-line').classList.remove('input'); }
  function replyInput(text) {
    if (!ctrl) return;
    cwPrint(text + '\n', 'out'); cwIn.value = ''; autosize();
    const n = Math.min(text.length, 65535); for (let i = 0; i < n; i++) inbuf[i] = text.charCodeAt(i);
    Atomics.store(ctrl, 2, n); Atomics.store(ctrl, 1, 1); Atomics.notify(ctrl, 1);
    leaveInputMode(); $('st1').textContent = 'Busy…';
  }
  // tab completion
  let compList = [], compSel = 0;
  async function complete() {
    const v = cwIn.value, p = cwIn.selectionStart, m = v.slice(0, p).match(/[A-Za-z_]\w*$/); if (!m) return;
    const res = await ask({ type: 'complete', prefix: m[0] });
    const list = res.list || []; if (!list.length) return;
    if (list.length === 1) { applyCompletion(list[0], m[0]); return; }
    let common = list[0]; for (const w of list) while (!w.startsWith(common)) common = common.slice(0, -1);
    if (common.length > m[0].length) { applyCompletion(common, m[0]); }
    compList = list; compSel = 0; showComplete(m[0]);
  }
  function applyCompletion(word, prefix) { cwIn.setSelectionRange(cwIn.selectionStart - prefix.length, cwIn.selectionStart); insertAtCursor(cwIn, word); hideComplete(); }
  function showComplete(prefix) {
    const box = $('complete'); box.hidden = false; box.dataset.prefix = prefix;
    box.innerHTML = compList.map((w, i) => `<div class="${i === compSel ? 'sel' : ''}" data-w="${esc(w)}">${esc(w)}</div>`).join('');
    const r = cwIn.getBoundingClientRect(), pr = $('cmdwin').parentElement.getBoundingClientRect();
    box.style.left = (r.left - pr.left) + 'px'; const top = r.top - pr.top; box.style.top = (top > 200 ? top - Math.min(180, compList.length * 17 + 4) - 2 : top + r.height + 2) + 'px';
  }
  function hideComplete() { $('complete').hidden = true; compList = []; }
  $('complete').addEventListener('mousedown', e => { const d = e.target.closest('[data-w]'); if (d) { e.preventDefault(); const live = cwIn.value.slice(0, cwIn.selectionStart).match(/[A-Za-z_]\w*$/); applyCompletion(d.dataset.w, live ? live[0] : ''); } });

  cwIn.addEventListener('keydown', e => {
    if (!$('complete').hidden) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); compSel = (compSel + (e.key === 'ArrowDown' ? 1 : -1) + compList.length) % compList.length; showComplete($('complete').dataset.prefix); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); const live = cwIn.value.slice(0, cwIn.selectionStart).match(/[A-Za-z_]\w*$/); applyCompletion(compList[compSel], live ? live[0] : ''); return; }
      if (e.key === 'Escape') { e.preventDefault(); hideComplete(); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); submit(); }
    else if (e.key === 'ArrowUp' && !cwIn.value.slice(0, cwIn.selectionStart).includes('\n') && !S.inputMode) { e.preventDefault(); histNav(-1); }
    else if (e.key === 'ArrowDown' && !cwIn.value.slice(cwIn.selectionEnd).includes('\n') && !S.inputMode) { e.preventDefault(); histNav(1); }
    else if (e.key === 'Tab') { e.preventDefault(); complete(); }
    else if (e.key === 'Escape') { cwIn.value = ''; S.hpos = null; autosize(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && cwIn.selectionStart === cwIn.selectionEnd && S.busy) { e.preventDefault(); stop(); }
    else if (e.key === 'F5' || e.key === 'F9') { /* handled globally */ }
  });
  cwIn.addEventListener('input', () => { autosize(); if (!$('complete').hidden) hideComplete(); });
  $('cmdwin').addEventListener('mouseup', () => { if (!getSelection().toString()) cwIn.focus(); });
  cwOut.addEventListener('click', e => { const a = e.target.closest('a[data-f]'); if (a) { const f = a.dataset.f + '.m'; if (S.files.has(f)) { openTab(f); const ed = S.eds.get(f); ed && ed.setError(+a.dataset.l); } } });

  // ---------- files (Current Folder) ----------
  function addFile(name, text, path = null, saved = text) { S.files.set(name, { text, saved, path }); renderFiles(); saveLater(); }
  function mergeFiles(obj) {
    for (const k in obj) { const f = S.files.get(k); if (!f) S.files.set(k, { text: obj[k], saved: '', path: null }); else if (f.text !== obj[k]) { f.text = obj[k]; const ed = S.eds.get(k); if (ed) ed.set(obj[k]); } }
    for (const k of [...S.files.keys()]) if (!(k in obj)) { closeTabsFor(k); S.files.delete(k); }
    renderFiles(); saveLater();
  }
  function fileKind(name) { const e = ext(name); return e === 'm' ? 'm' : e === 'csv' ? 'csv' : e === 'lmat' ? 'lmat' : 'txt'; }
  function renderFiles() {
    const names = [...S.files.keys()].sort((a, b) => (ext(a) === 'm' ? 0 : 1) - (ext(b) === 'm' ? 0 : 1) || a.localeCompare(b));
    $('files').innerHTML = names.map(n => {
      const f = S.files.get(n), k = fileKind(n), isFn = k === 'm' && /^\s*(%[^\n]*\n\s*)*function\b/.test(f.text);
      const meta = k === 'm' ? (isFn ? 'function' : 'script') : k === 'lmat' ? 'workspace' : `${(f.text.length / 1024).toFixed(1)} KB`;
      return `<div class="aero-item${n === S.selFile ? ' sel' : ''}" data-f="${esc(n)}" title="${esc(n)}"><span class="fi ${k}">${k === 'm' ? 'M' : k === 'csv' ? '⊞' : k === 'lmat' ? 'W' : 'T'}</span><span class="grow ${f.text !== f.saved ? 'dirty' : ''}">${esc(n)}</span><span class="meta">${meta}</span></div>`;
    }).join('') || '<div class="dim" style="padding:10px">The folder is empty. Create a script or open files.</div>';
    $('nFiles').textContent = names.length ? `${names.length} file${names.length > 1 ? 's' : ''}` : '';
  }
  $('files').addEventListener('click', e => { const it = e.target.closest('[data-f]'); if (!it) return; S.selFile = it.dataset.f; renderFiles(); });
  $('files').addEventListener('dblclick', e => { const it = e.target.closest('[data-f]'); if (it) openFromFolder(it.dataset.f); });
  function openFromFolder(n) {
    const k = fileKind(n);
    if (k === 'lmat') { run(`load('${n.replace(/'/g, "''")}')`, { echo: `load('${n}')` }); return; }
    if (k === 'csv') { importDialog(n, S.files.get(n).text); return; }
    openTab(n);
  }
  async function newScript(fn) {
    let base = fn ? 'myfunction' : 'untitled', k = 1, name = base + '.m'; while (S.files.has(name)) name = base + (++k) + '.m';
    let nm = await Aero.prompt(fn ? 'New function' : 'New script', fn ? 'Function name' : 'File name', stem(name)); if (!nm) return;
    nm = nm.trim().replace(/\.m$/i, ''); if (!/^[A-Za-z]\w*$/.test(nm)) return Aero.alert('Name', 'Use a valid name: letters, digits and underscores, starting with a letter.');
    if (S.files.has(nm + '.m')) return Aero.alert('Name', `${nm}.m already exists.`);
    const text = fn ? `function out = ${nm}(in)\n%${nm.toUpperCase()}  One-line description.\n%   out = ${nm.toUpperCase()}(in) explains what the function returns.\n\n    out = in;\nend\n` : `%% ${nm}\n\n`;
    addFile(nm + '.m', text, null, ''); openTab(nm + '.m');
    const ed = S.eds.get(nm + '.m'); if (ed) { ed.focus(); ed.ta.setSelectionRange(text.length, text.length); }
  }
  async function renameFile() {
    const n = S.selFile || (S.tabs[S.active] && S.tabs[S.active].kind === 'file' ? S.tabs[S.active].name : null); if (!n) return Aero.toast('Select a file in the Current Folder first.');
    let nn = await Aero.prompt('Rename', 'New name', n); if (!nn || nn === n) return; nn = nn.trim();
    if (!/\.\w+$/.test(nn)) nn += '.' + ext(n);
    if (S.files.has(nn)) return Aero.alert('Rename', `${nn} already exists.`);
    const f = S.files.get(n); S.files.delete(n); S.files.set(nn, f); f.path = null;
    if (S.eds.has(n)) { S.eds.set(nn, S.eds.get(n)); S.eds.delete(n); }
    S.tabs.forEach(t => { if (t.kind === 'file' && t.name === n) t.name = nn; }); S.selFile = nn;
    renderFiles(); renderTabs(); saveLater();
  }
  async function deleteFile() {
    const n = S.selFile; if (!n) return Aero.toast('Select a file in the Current Folder first.');
    if (!await Aero.confirm('Delete file', `Remove ${n} from the Current Folder? (Copies saved on disk are not touched.)`)) return;
    closeTabsFor(n); S.files.delete(n); S.selFile = null; renderFiles(); saveLater();
  }

  // ---------- editor tabs ----------
  function openTab(name) {
    let i = S.tabs.findIndex(t => t.kind === 'file' && t.name === name);
    if (i < 0) {
      const f = S.files.get(name); if (!f) return;
      const ed = LabEditor.create($('editors'), { onChange: text => { const ff = S.files.get(currentName()); if (ff) { ff.text = text; tabDirty(); saveLater(); } }, onCursor: (l, c) => { $('st2').textContent = `Ln ${l}, Col ${c}`; }, onKey: editorKey });
      ed.set(f.text); S.eds.set(name, ed);
      S.tabs.push({ kind: 'file', name }); i = S.tabs.length - 1;
    }
    activate(i);
  }
  function currentName() { const t = S.tabs[S.active]; return t && t.kind === 'file' ? t.name : null; }
  function activate(i) {
    S.active = i; const t = S.tabs[i];
    S.eds.forEach((ed, n) => ed.show(t && t.kind === 'file' && n === t.name));
    $('varEd').hidden = !(t && t.kind === 'var'); $('editors').style.display = t && t.kind === 'var' ? 'none' : '';
    if (t && t.kind === 'var') renderVarTab(t);
    if (t && t.kind === 'file') setTimeout(() => S.eds.get(t.name).focus());
    renderTabs(); updateTitle(); saveLater();
    const on = document.querySelector('#edTabs .aero-tab.on'); if (on) on.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function closeTab(i) {
    const t = S.tabs[i]; if (!t) return;
    if (t.kind === 'file' && !S.tabs.some((x, k) => k !== i && x.kind === 'file' && x.name === t.name)) { const ed = S.eds.get(t.name); if (ed) ed.destroy(); S.eds.delete(t.name); }
    S.tabs.splice(i, 1);
    activate(Math.min(S.active > i ? S.active - 1 : S.active, S.tabs.length - 1));
  }
  function closeTabsFor(name) { for (let i = S.tabs.length - 1; i >= 0; i--) if (S.tabs[i].kind === 'file' && S.tabs[i].name === name) closeTab(i); }
  function renderTabs() {
    $('edTabs').innerHTML = S.tabs.map((t, i) => {
      const dirty = t.kind === 'file' && S.files.get(t.name) && S.files.get(t.name).text !== S.files.get(t.name).saved;
      return `<span class="aero-tab${i === S.active ? ' on' : ''}${dirty ? ' dirty' : ''}" data-i="${i}" title="${esc(t.name)}">${t.kind === 'var' ? '<span class="fi lmat" style="width:13px;height:13px">x</span>' : ''}<span class="nm">${esc(t.name)}</span><span class="x" data-x="${i}">×</span></span>`;
    }).join('') || '<span class="aero-tab dim" style="pointer-events:none">No open files — double-click a script in the Current Folder</span>';
    const empty = !S.tabs.length; $('editors').style.background = empty ? 'repeating-linear-gradient(45deg,#fbfcfe 0 10px,#f5f8fb 10px 20px)' : '';
  }
  function tabDirty() { renderTabs(); renderFiles(); updateTitle(); }
  function updateTitle() {
    const n = currentName(), f = n && S.files.get(n), t = S.tabs[S.active];
    Aero.setDoc(n || (t ? t.name : 'Lumen Lab'), !!(f && f.text !== f.saved));
    $('st3').textContent = n ? `${n} · ${/^\s*(%[^\n]*\n\s*)*function\b/.test(f.text) ? 'function' : 'script'}` : t ? `variable ${t.name}` : '';
  }
  $('edTabs').addEventListener('mousedown', e => {
    const x = e.target.closest('[data-x]'); if (x) { e.preventDefault(); closeTab(+x.dataset.x); return; }
    const tab = e.target.closest('[data-i]'); if (tab) { if (e.button === 1) { e.preventDefault(); closeTab(+tab.dataset.i); } else activate(+tab.dataset.i); }
  });
  function editorKey(e) {
    if (e.key === 'F5') { e.stopPropagation(); runFile(); return true; }
    if (e.key === 'F9') { e.stopPropagation(); runSelection(); return true; }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.stopPropagation(); runSection(e.shiftKey); return true; }
    return false;
  }
  function clearErrors() { S.eds.forEach(ed => ed.setError(null)); }
  function markError(file, line) {
    const name = file + '.m';
    if (S.files.has(name)) { const i = S.tabs.findIndex(t => t.kind === 'file' && t.name === name); if (i >= 0 || file === S.lastRunName) { openTab(name); S.eds.get(name).setError(line); } }
  }

  // ---------- running ----------
  function isFunctionFile(text) { return /^\s*(%[^\n]*\n\s*)*function\b/.test(text); }
  async function runFile() {
    const n = currentName(); if (!n) return Aero.toast('Open a script to run it — or type commands in the Command Window.');
    if (ext(n) !== 'm') return Aero.toast('Only .m files can be run.');
    const name = stem(n), text = S.files.get(n).text;
    if (!/^[A-Za-z]\w*$/.test(name)) return Aero.alert('Run', `“${n}” isn't a valid script name. Rename it to letters, digits and underscores.`);
    if (isFunctionFile(text)) {
      const m = text.match(/function\s+(?:\[[^\]]*\]\s*=\s*|\w+\s*=\s*)?\w+\s*\(([^)]*)\)/), params = m && m[1].trim();
      if (params) { const args = await Aero.prompt('Run function', `Arguments for ${name}(${params})`, ''); if (args === null) return; return run(`${name}(${args})`, { echo: `${name}(${args})` }); }
      return run(name, { echo: name });
    }
    return run(text, { name, echo: name });
  }
  async function runSection(advance) {
    const n = currentName(); if (!n) return;
    const ed = S.eds.get(n), sec = ed.section();
    cwPrint(`${stem(n)} — section at line ${sec.start}\n`, 'info');
    // pad with blank lines so error line numbers match the file
    const r = await run('\n'.repeat(sec.start - 1) + sec.text, { name: stem(n) });
    if (advance && r.ok && sec.next) ed.gotoLine(sec.next.start, true);
  }
  function runSelection() {
    const n = currentName(); if (!n) return; const t = S.eds.get(n).selection(); if (!t.trim()) return Aero.toast('Select some code first.');
    run(t, { echo: t.length > 200 ? t.slice(0, 200) + '…' : t });
  }

  // ---------- workspace ----------
  function renderWs() {
    const rows = S.ws;
    const wide = $('ws').clientWidth > 330;
    $('ws').innerHTML = rows.length ? `<table><colgroup><col style="width:${wide ? 26 : 34}%"><col>${wide ? '<col style="width:16%"><col style="width:16%">' : ''}</colgroup><thead><tr><th>Name</th><th>Value</th>${wide ? '<th>Size</th><th>Class</th>' : ''}</tr></thead><tbody>${rows.map(v => `<tr data-v="${esc(v.name)}" class="${v.name === S.selVar ? 'sel' : ''}" title="${esc(v.name)} — ${esc(v.size)} ${esc(v.cls)}${v.stats ? `\nmin ${fmt(v.stats.min)} · max ${fmt(v.stats.max)} · mean ${fmt(v.stats.mean)}` : ''}"><td>${esc(v.name)}</td><td class="v">${esc(v.value)}</td>${wide ? `<td>${esc(v.size)}</td><td>${esc(v.cls)}</td>` : ''}</tr>`).join('')}</tbody></table>` : '<div class="empty">No variables yet.<br>Try <b>x = linspace(0, 1, 5)</b></div>';
    $('nVars').textContent = rows.length ? rows.length + '' : '';
  }
  const fmt = v => Math.abs(v) >= 1e5 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(3) : +v.toFixed(4) + '';
  $('ws').addEventListener('click', e => { const r = e.target.closest('[data-v]'); if (!r) return; S.selVar = r.dataset.v; renderWs(); });
  $('ws').addEventListener('dblclick', e => { const r = e.target.closest('[data-v]'); if (r) openVar(r.dataset.v); });
  function openVar(name) {
    if (!name) return Aero.toast('Select a variable first.');
    let i = S.tabs.findIndex(t => t.kind === 'var' && t.name === name);
    if (i < 0) { S.tabs.push({ kind: 'var', name }); i = S.tabs.length - 1; }
    activate(i);
  }
  async function renderVarTab(t) {
    const box = $('varEd'); const res = await ask({ type: 'value', name: t.name });
    if (S.tabs[S.active] !== t) return;
    if (!res.json) { box.innerHTML = `<div class="vhead">${esc(t.name)} no longer exists in the workspace.</div>`; return; }
    const j = res.json;
    if (j.t === 'num' && j.cls !== 'char') {
      const R = Math.min(j.r, 1000), Cc = Math.min(j.c, 200), num = x => typeof x === 'string' ? Number(x) : x;
      const cell = (i, k) => { const re = num(j.re[i + k * j.r]), im = j.im ? num(j.im[i + k * j.r]) : 0; const f = x => Number.isInteger(x) ? String(x) : Math.abs(x) >= 1e5 || (x !== 0 && Math.abs(x) < 1e-4) ? x.toExponential(4) : (+x.toFixed(4)).toString(); return j.im ? `${f(re)}${im < 0 ? '-' : '+'}${f(Math.abs(im))}i` : (j.cls === 'logical' ? String(re) : f(re)); };
      let h = `<div class="vhead"><b>${esc(t.name)}</b> — ${j.r}×${j.c} ${j.cls}${j.im ? ' (complex)' : ''}${j.r > R || j.c > Cc ? ` · showing ${R}×${Cc}` : ''}${!j.im && j.cls === 'double' ? ' · double-click a cell to edit' : ''}</div><table><thead><tr><th class="rh"></th>${Array.from({ length: Cc }, (_, k) => `<th>${k + 1}</th>`).join('')}</tr></thead><tbody>`;
      for (let i = 0; i < R; i++) { h += `<tr><td class="rh">${i + 1}</td>`; for (let k = 0; k < Cc; k++) h += `<td class="${!j.im && j.cls === 'double' ? 'ed' : ''}" data-i="${i + 1}" data-k="${k + 1}">${cell(i, k)}</td>`; h += '</tr>'; }
      box.innerHTML = h + '</tbody></table>';
    } else box.innerHTML = `<div class="vhead"><b>${esc(t.name)}</b> — ${esc(j.t === 'num' ? `${j.r}×${j.c} char` : j.t)}</div><pre>${esc(res.text || '')}</pre>`;
  }
  $('varEd').addEventListener('dblclick', e => {
    const td = e.target.closest('td.ed'); if (!td || S.busy) return; const t = S.tabs[S.active]; if (!t || t.kind !== 'var') return;
    const inp = document.createElement('input'); inp.value = td.textContent; td.textContent = ''; td.appendChild(inp); inp.focus(); inp.select();
    let done = false; const finish = ok => { if (done) return; done = true; if (ok && inp.value.trim() !== '') run(`${t.name}(${td.dataset.i}, ${td.dataset.k}) = ${inp.value};`).then(() => renderVarTab(t)); else renderVarTab(t); };
    inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') finish(true); else if (ev.key === 'Escape') finish(false); };
    inp.onblur = () => finish(true);
  });
  function refreshVarTabs() { const t = S.tabs[S.active]; if (t && t.kind === 'var') renderVarTab(t); }

  // ---------- figures ----------
  const cv = $('figCanvas'); let layouts = [];
  function figList() { return S.snap ? S.snap.figs : []; }
  function curFigure() { const f = figList(); return f.find(x => x.id === S.curFig) || f[f.length - 1] || null; }
  function renderFigs() {
    const figs = figList(), cur = curFigure();
    $('figTabs').innerHTML = figs.map(f => `<span class="aero-tab${cur && f.id === cur.id ? ' on' : ''}" data-fig="${f.id}">Figure ${f.id}${f.name ? ': ' + esc(f.name) : ''}</span>`).join('');
    $('figEmpty').hidden = !!cur; cv.style.visibility = cur ? 'visible' : 'hidden';
    $('figInfo').textContent = cur ? `${cur.axes.length} ax${cur.axes.length === 1 ? 'is' : 'es'}` : '';
    drawFig();
  }
  let figRaf = 0;
  function drawFig() { if (figRaf) return; figRaf = frame(() => { figRaf = 0; const f = curFigure(); if (!f) { layouts = []; return; } layouts = LabPlot.draw(cv, f, { fontScale: 1 }); const any3d = layouts.some(l => l.kind === '3d'); $('figStage').classList.toggle('rot', any3d); }); }
  $('figTabs').addEventListener('click', e => { const t = e.target.closest('[data-fig]'); if (!t) return; S.curFig = +t.dataset.fig; renderFigs(); });
  new ResizeObserver(() => drawFig()).observe($('figStage'));
  const layoutAt = (x, y) => layouts.find(l => x >= l.P.x - 30 && x <= l.P.x + l.P.w + 30 && y >= l.P.y - 20 && y <= l.P.y + l.P.h + 30);
  let drag = null;
  cv.addEventListener('pointerdown', e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, L = layoutAt(x, y); if (!L) return;
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic events */ } $('figStage').classList.add('dragging');
    const v = LabPlot.views.get(L.ax.id) || {};
    drag = { L, x, y, view: L.view ? L.view.slice() : null, xl: L.xl ? L.xl.slice() : null, yl: L.yl ? L.yl.slice() : null, v };
  });
  cv.addEventListener('pointermove', e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, tip = $('ftip');
    if (drag) {
      const L = drag.L, v = LabPlot.views.get(L.ax.id) || {};
      if (L.kind === '3d') { const az = drag.view[0] - (x - drag.x) * 0.45, el = Math.max(-90, Math.min(90, drag.view[1] + (y - drag.y) * 0.45)); v.view = [Math.round(az * 10) / 10, Math.round(el * 10) / 10]; tip.style.display = 'block'; tip.textContent = `Az ${v.view[0].toFixed(1)}  El ${v.view[1].toFixed(1)}`; tip.style.left = (x + 14) + 'px'; tip.style.top = (y + 10) + 'px'; }
      else if (L.kind === '2d') {
        const fx = (x - drag.x) / L.P.w, fy = (y - drag.y) / L.P.h;
        const shift = (l, f, isLog) => isLog ? l.map(q => Math.pow(10, Math.log10(q) - f * (Math.log10(l[1]) - Math.log10(l[0])))) : l.map(q => q - f * (l[1] - l[0]));
        v.xlim = shift(drag.xl, fx, L.logx); v.ylim = shift(drag.yl, L.rev ? fy : -fy, L.logy);
      }
      LabPlot.views.set(L.ax.id, v); drawFig(); return;
    }
    const L = layoutAt(x, y), hit = L && L.kind === '2d' && LabPlot.pick(L, x, y);
    if (hit) { tip.style.display = 'block'; tip.textContent = `X ${fmtTip(hit.X)}\nY ${fmtTip(hit.Y)}`; tip.style.left = Math.min(x + 14, cv.clientWidth - 120) + 'px'; tip.style.top = (y + 12) + 'px'; }
    else tip.style.display = 'none';
  });
  const fmtTip = v => Number.isInteger(v) ? String(v) : Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3 && v !== 0 ? v.toExponential(4) : (+v.toPrecision(6)).toString();
  const endDrag = () => { if (drag) { drag = null; $('figStage').classList.remove('dragging'); $('ftip').style.display = 'none'; } };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag); cv.addEventListener('pointerleave', () => { if (!drag) $('ftip').style.display = 'none'; });
  cv.addEventListener('wheel', e => {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, L = layoutAt(x, y); if (!L || L.kind !== '2d') return;
    e.preventDefault(); const f = Math.exp(e.deltaY * 0.0015), v = LabPlot.views.get(L.ax.id) || {};
    const zoom = (l, c, isLog) => isLog ? l.map(q => Math.pow(10, Math.log10(c) + (Math.log10(q) - Math.log10(c)) * f)) : l.map(q => c + (q - c) * f);
    v.xlim = zoom(L.xl, L.inv.x(x), L.logx); v.ylim = zoom(L.yl, L.inv.y(y), L.logy); LabPlot.views.set(L.ax.id, v); drawFig();
  }, { passive: false });
  cv.addEventListener('dblclick', e => { const r = cv.getBoundingClientRect(), L = layoutAt(e.clientX - r.left, e.clientY - r.top); if (L) { LabPlot.views.delete(L.ax.id); drawFig(); } });
  function resetView() { const f = curFigure(); if (f) f.axes.forEach(a => LabPlot.views.delete(a.id)); drawFig(); }
  function renderPng(fig, scale = 2) {
    const st = $('figStage'), w = Math.max(560, st.clientWidth), h = Math.max(420, st.clientHeight);
    const c = document.createElement('canvas'); LabPlot.draw(c, fig, { w, h, dpr: scale }); return new Promise(r => c.toBlob(r, 'image/png'));
  }
  async function exportFigure(id, name) {
    const fig = figList().find(f => f.id === id) || curFigure(); if (!fig) return Aero.toast('There is no figure to save.');
    let nm = name || `Figure ${fig.id}.png`; if (!/\.png$/i.test(nm)) nm = nm.replace(/\.(jpe?g|pdf|svg|fig|eps|bmp|tiff?)$/i, '') + '.png';
    const blob = await renderPng(fig); const p = await Aero.saveFile({ name: nm, data: blob, filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (p) Aero.toast('Saved ' + Aero.baseName(String(p)) + '.png');
  }
  async function copyFigure() {
    const fig = curFigure(); if (!fig) return;
    try { const blob = await renderPng(fig); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); Aero.toast('Figure copied to the clipboard.'); } catch (e) { Aero.toast('Copy is not available here — use Save PNG.'); }
  }
  function closeFigure(all) { if (S.busy) return Aero.toast('Wait for the code to finish.'); const f = curFigure(); if (all) run('close all'); else if (f) W.postMessage({ type: 'rmfig', fig: f.id }); }

  // ---------- open / save / import ----------
  async function openFiles(files) {
    for (const f of files) {
      const name = f.name.replace(/^.*[\\/]/, ''), e = ext(name);
      const text = typeof f.data === 'string' ? f.data : new TextDecoder().decode(f.data);
      if (!TEXT_EXT.test(name) && e !== 'lmat') { Aero.alert('Open', `Lumen Lab opens .m scripts, .csv/.txt data and .lmat workspaces — not “${name}”.`); continue; }
      let target = name;
      if (S.files.has(name) && S.files.get(name).text !== text) {
        if (!await Aero.confirm('Replace file', `${name} is already in the Current Folder with different contents. Replace it?`)) continue;
        const ed = S.eds.get(name); if (ed) ed.set(text);
      }
      S.files.set(target, { text, saved: text, path: f.path || null }); renderFiles();
      if (e === 'm') openTab(target);
      else if (e === 'lmat') run(`load('${target.replace(/'/g, "''")}')`, { echo: `load('${target}')` });
      else if (e === 'csv' || e === 'txt' || e === 'dat' || e === 'tsv') importDialog(target, text);
    }
    saveLater();
  }
  async function openDialog() { openFiles(await Aero.openFile({ accept: '.m,.csv,.txt,.dat,.tsv,.lmat', filters: [{ name: 'Lumen Lab files', extensions: ['m', 'csv', 'txt', 'dat', 'lmat'] }, { name: 'All files', extensions: ['*'] }], multiple: !Aero.isDesktop })); }
  async function save(as, name) {
    name = name || currentName(); if (!name) return Aero.toast('Open a script to save it.');
    const f = S.files.get(name);
    const p = await Aero.saveFile({ name, data: f.text, filters: [{ name: ext(name) === 'm' ? 'MATLAB code' : 'Text', extensions: [ext(name) || 'txt'] }], path: as ? null : f.path });
    if (!p) return false;
    const saved = Aero.baseName(String(p)) + '.' + ext(name);
    f.saved = f.text; if (typeof p === 'string' && /[\\/]/.test(p)) f.path = p;
    if (as && saved !== name && /^[\w.-]+$/.test(saved) && !S.files.has(saved)) { S.selFile = name; await renameTo(name, saved); }
    tabDirty(); saveLater(); Aero.toast('Saved ' + saved); return true;
  }
  async function renameTo(n, nn) { const f = S.files.get(n); S.files.delete(n); S.files.set(nn, f); if (S.eds.has(n)) { S.eds.set(nn, S.eds.get(n)); S.eds.delete(n); } S.tabs.forEach(t => { if (t.kind === 'file' && t.name === n) t.name = nn; }); renderFiles(); renderTabs(); }
  async function saveAll() { for (const [n, f] of S.files) if (f.text !== f.saved && ext(n) === 'm') { if (!await save(false, n)) return false; } return true; }
  function importDialog(fileName, text) {
    const parsed = LabLib.parseDelimited(text), rows = parsed.data;
    if (!rows.length) return Aero.alert('Import data', `No numeric rows found in ${fileName}.`);
    let vname = stem(fileName).replace(/\W/g, '_').replace(/^(\d)/, 'X$1') || 'data';
    const hdr = parsed.header ? `<tr>${parsed.header.map(h => `<th>${esc(h)}</th>`).join('')}</tr>` : '';
    const html = `<div class="preview"><table>${hdr}${rows.slice(0, 8).map(r => `<tr>${r.map(v => `<td>${Number.isNaN(v) ? '<span class="dim">NaN</span>' : v}</td>`).join('')}</tr>`).join('')}</table></div><p class="dim" style="margin:6px 0 0">${rows.length} rows × ${rows[0].length} columns${parsed.header ? ' · header row skipped' : ''}</p>`;
    Aero.dialog({ title: 'Import data', instruction: `Create a matrix from ${fileName}`, html, fields: [{ key: 'name', label: 'Variable name', type: 'text', value: vname }, { key: 'cols', label: 'Also make one column vector per named column', type: 'checkbox', value: false }], ok: 'Import',
      onOK: v => {
        const nm = String(v.name || '').trim(); if (!/^[A-Za-z]\w*$/.test(nm)) return Aero.alert('Import data', 'Use a valid variable name.');
        let code = `${nm} = readmatrix('${fileName.replace(/'/g, "''")}');`;
        if (v.cols && parsed.header) parsed.header.forEach((h, k) => { const c = h.trim().replace(/\W+/g, '_').replace(/^(\d)/, 'X$1').replace(/^_+|_+$/g, ''); if (/^[A-Za-z]\w*$/.test(c)) code += `\n${c} = ${nm}(:, ${k + 1});`; });
        run(code, { echo: code });
      } });
  }
  async function importData() { const f = await Aero.openFile({ accept: '.csv,.txt,.dat,.tsv', filters: [{ name: 'Delimited text', extensions: ['csv', 'txt', 'dat', 'tsv'] }] }); if (f[0]) openFiles(f); }
  async function saveWorkspace() {
    if (!S.ws.length) return Aero.toast('The workspace is empty.');
    const r = await ask({ type: 'exportws' });
    await Aero.saveFile({ name: 'workspace.lmat', data: r.text, filters: [{ name: 'Lumen Lab workspace', extensions: ['lmat'] }] });
  }
  async function exportVarCsv() {
    const name = S.selVar || (S.tabs[S.active] && S.tabs[S.active].kind === 'var' ? S.tabs[S.active].name : null); if (!name) return Aero.toast('Select a variable first.');
    const res = await ask({ type: 'value', name }); const j = res.json;
    if (!j || j.t !== 'num' || j.cls === 'char') return Aero.alert('Export', 'Only numeric variables can be exported as CSV.');
    const n = x => typeof x === 'string' ? x : String(x), rows = []; for (let i = 0; i < j.r; i++) { const r = []; for (let k = 0; k < j.c; k++) r.push(n(j.re[i + k * j.r])); rows.push(r.join(',')); }
    Aero.saveFile({ name: name + '.csv', data: rows.join('\n') + '\n', filters: [{ name: 'CSV', extensions: ['csv'] }] });
  }
  async function loadSample() {
    if (S.files.size && !await Aero.confirm('Open sample', 'Add the sample scripts to the Current Folder and run welcome.m? Files with the same names are replaced.')) return;
    const files = LabSamples.files();
    for (const k in files) { S.files.set(k, { text: files[k], saved: files[k], path: null }); const ed = S.eds.get(k); if (ed) ed.set(files[k]); }
    renderFiles(); openTab(LabSamples.first); saveLater();
    await ready; run(files[LabSamples.first], { name: stem(LabSamples.first), echo: stem(LabSamples.first) });
  }

  // ---------- help ----------
  function functionBrowser() {
    const cats = LabHelp.CATS;
    const list = q => Object.keys(cats).map(c => { const items = Object.keys(cats[c]).filter(k => cats[c][k] && (!q || k.includes(q) || cats[c][k][1].toLowerCase().includes(q))); return items.length ? `<h4>${esc(c)}</h4>` + items.map(k => `<div data-fn="${k}" title="Double-click to insert"><b>${k}</b><span>${esc(cats[c][k][1])}</span><pre>${esc(cats[c][k][0])}</pre></div>`).join('') : ''; }).join('') || '<p class="dim" style="padding:8px">No matches.</p>';
    const d = Aero.dialog({ title: 'Function reference', instruction: `${Object.keys(LabHelp.FN).length} documented functions. Type “help name” in the Command Window for any of them.`, html: `<input type="search" id="fnq" placeholder="Search functions…" style="width:100%;margin-bottom:6px"><div class="help-list" id="fnl">${list('')}</div>`, noCancel: true, ok: 'Close' });
    const box = d.el; const q = box.querySelector('#fnq'), l = box.querySelector('#fnl');
    q.oninput = () => { l.innerHTML = list(q.value.trim().toLowerCase()); }; setTimeout(() => q.focus(), 50);
    l.ondblclick = e => { const it = e.target.closest('[data-fn]'); if (it) { cwIn.value += it.dataset.fn + '('; autosize(); cwIn.focus(); } };
  }
  const SHORTCUTS = 'F5 — run the script · Ctrl+Enter — run the current %% section (Ctrl+Shift+Enter: and advance)\nF9 — run the selected code · Ctrl+Break or Ctrl+C in the Command Window — stop\nCtrl+N / Ctrl+O / Ctrl+S — new, open, save · Ctrl+W — close tab\nCtrl+R / Ctrl+T — comment / uncomment · Ctrl+/ — toggle comment · Tab / Shift+Tab — indent\nCtrl+F, F3 — find · Ctrl+G — go to line\nCommand Window: ↑/↓ — history (filtered by what you typed) · Tab — complete · Esc — clear · Shift+Enter — new line\nFigures: drag a 3-D plot to rotate · drag a 2-D plot to pan · wheel to zoom · double-click to reset';

  // ---------- find ----------
  let lastFind = '';
  async function find() { const n = currentName(); if (!n) return; const sel = S.eds.get(n).selection(); const q = await Aero.prompt('Find', 'Find text', sel && !sel.includes('\n') ? sel : lastFind); if (!q) return; lastFind = q; if (!S.eds.get(n).find(q)) Aero.toast(`“${q}” not found.`); }
  function findNext(back) { const n = currentName(); if (!n || !lastFind) return find(); if (!S.eds.get(n).find(lastFind, back)) Aero.toast(`“${lastFind}” not found.`); }
  async function gotoLine() { const n = currentName(); if (!n) return; const v = await Aero.prompt('Go to line', 'Line number', String(S.eds.get(n).cursorLine())); if (v && +v > 0) S.eds.get(n).gotoLine(+v); }

  // ---------- layout splitters & zoom ----------
  function splitter(el, fn) { el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture(e.pointerId); const mv = ev => fn(ev); const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); saveLater(); drawFig(); }; el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); }); }
  const work = $('work');
  splitter($('split1'), e => { const r = work.getBoundingClientRect(); work.style.setProperty('--left-w', Aero.clamp(e.clientX - r.left, 150, 460) + 'px'); renderWs(); });
  splitter($('split3'), e => { const r = work.getBoundingClientRect(); work.style.setProperty('--fig-w', Aero.clamp(r.right - e.clientX, 220, r.width - 520) + 'px'); });
  splitter($('split2'), e => { const c = $('center').getBoundingClientRect(); $('center').style.setProperty('--cmd-h', Aero.clamp(c.bottom - e.clientY, 80, c.height - 90) + 'px'); });
  splitter($('splitL'), e => { const l = $('left').getBoundingClientRect(); $('left').style.setProperty('--files-h', Aero.clamp(e.clientY - l.top - 28, 60, l.height - 160) + 'px'); });
  function zoom(d) { S.fontSize = d === 0 ? 13 : Aero.clamp(S.fontSize + d, 9, 24); document.documentElement.style.setProperty('--code-size', S.fontSize + 'px'); S.eds.forEach(ed => ed.render()); saveLater(); }

  // ---------- autosave ----------
  let saveT = 0;
  function saveLater() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(AUTOSAVE, JSON.stringify({ v: 1, files: [...S.files].map(([k, f]) => [k, f.text, f.saved, f.path]), tabs: S.tabs, active: S.active, hist: S.hist.slice(-200), font: S.fontSize, layout: { left: work.style.getPropertyValue('--left-w'), fig: work.style.getPropertyValue('--fig-w'), cmd: $('center').style.getPropertyValue('--cmd-h'), files: $('left').style.getPropertyValue('--files-h') } })); } catch (e) { } }, 500); }
  function restore() {
    let st = null; try { st = JSON.parse(localStorage.getItem(AUTOSAVE) || 'null'); } catch (e) { }
    if (!st || !st.files) return false;
    st.files.forEach(([k, text, saved, path]) => S.files.set(k, { text, saved: saved ?? text, path: path || null }));
    S.hist = st.hist || []; if (st.font) { S.fontSize = st.font; document.documentElement.style.setProperty('--code-size', S.fontSize + 'px'); }
    const L = st.layout || {}; if (L.left) work.style.setProperty('--left-w', L.left); if (L.fig) work.style.setProperty('--fig-w', L.fig); if (L.cmd) $('center').style.setProperty('--cmd-h', L.cmd); if (L.files) $('left').style.setProperty('--files-h', L.files);
    renderFiles();
    (st.tabs || []).forEach(t => { if (t.kind === 'file' && S.files.has(t.name)) openTab(t.name); else if (t.kind === 'var') S.tabs.push(t); });
    if (S.tabs.length) activate(Math.max(0, Math.min(st.active, S.tabs.length - 1)));
    return true;
  }

  // ---------- wiring ----------
  $('bRun').onclick = runFile; $('bSection').onclick = () => runSection(false); $('bStop').onclick = stop;
  $('bNew').onclick = () => newScript(false); $('bOpen').onclick = openDialog; $('bSave').onclick = () => save(false); $('bImport').onclick = importData;
  $('bClearWs').onclick = () => run('clear', { echo: 'clear' }); $('bCloseFigs').onclick = () => closeFigure(true);
  $('fNew').onclick = () => newScript(false); $('fFunc').onclick = () => newScript(true); $('fRename').onclick = renameFile; $('fDel').onclick = deleteFile;
  $('wOpen').onclick = () => openVar(S.selVar); $('wPlot').onclick = () => { if (!S.selVar) return Aero.toast('Select a variable first.'); const c = `figure; plot(${S.selVar}); title('${S.selVar}'); grid on`; run(c, { echo: c }); };
  $('wCsv').onclick = exportVarCsv; $('wDel').onclick = () => { if (S.selVar) { const c = `clear ${S.selVar}`; S.selVar = null; run(c, { echo: c }); } };
  $('gPng').onclick = () => exportFigure(); $('gCopy').onclick = copyFigure; $('gReset').onclick = resetView; $('gClose').onclick = () => closeFigure(false);
  document.addEventListener('keydown', e => {
    if (document.querySelector('.aero-modal:not(.aero-busy)')) return;
    // F-keys outside text fields come from the menu shortcuts; inside the Command Window handle them here
    const typing = e.target.matches && e.target.matches('input,textarea');
    if (!typing && /^F\d$/.test(e.key)) return;
    if (e.key === 'F5') { e.preventDefault(); runFile(); }
    else if (e.key === 'F9') { e.preventDefault(); runSelection(); }
    else if (e.key === 'F3') { e.preventDefault(); findNext(e.shiftKey); }
    else if (e.key === 'Pause' || e.key === 'Cancel') { e.preventDefault(); stop(); }
    else if (e.key === 'Delete' && document.activeElement === document.body && S.selFile && !S.busy) deleteFile();
  });
  window.addEventListener('beforeunload', () => { try { localStorage.setItem(AUTOSAVE + '-touch', Date.now()); } catch (e) { } });

  Aero.init({
    name: 'Lumen Lab', icon: '../kit/icons/lab.png', doc: 'welcome.m',
    onDropFiles: openFiles, dropText: 'Drop .m scripts, .csv data or .lmat workspaces', onSave: saveAll,
    menus: {
      File: [['New script', 'Ctrl+N', () => newScript(false)], ['New function', '', () => newScript(true)], ['Open…', 'Ctrl+O', openDialog], ['Open sample scripts', '', loadSample], '-',
        ['Save', 'Ctrl+S', () => save(false)], ['Save as…', 'Ctrl+Shift+S', () => save(true)], ['Save all', '', saveAll], ['Close tab', 'Ctrl+W', () => S.active >= 0 && closeTab(S.active)], '-', '#Data',
        ['Import data (CSV)…', '', importData], ['Save workspace (.lmat)…', '', saveWorkspace], ['Export variable as CSV…', '', exportVarCsv], '-', ['Save figure as PNG…', '', () => exportFigure()]],
      Edit: [['Find…', 'Ctrl+F', find], ['Find next', 'F3', () => findNext(false)], ['Go to line…', 'Ctrl+G', gotoLine], '-',
        { label: 'Comment', key: 'Ctrl+R', fn: () => { const n = currentName(); n && S.eds.get(n).comment(true); } }, { label: 'Uncomment', key: 'Ctrl+T', fn: () => { const n = currentName(); n && S.eds.get(n).comment(false); } }, '-',
        ['Clear Command Window', '', () => { $('cwOut').innerHTML = ''; }], ['Clear workspace', '', () => run('clear', { echo: 'clear' })], ['Clear command history', '', () => { S.hist = []; saveLater(); Aero.toast('History cleared.'); }]],
      Run: [['Run script', 'F5', runFile], ['Run section', 'Ctrl+Enter', () => runSection(false)], ['Run section and advance', 'Ctrl+Shift+Enter', () => runSection(true)], ['Run selection', 'F9', runSelection], '-',
        ['Stop', 'Ctrl+Pause', stop], ['Restart engine (clears the workspace)', '', () => restartWorker('Engine restarted. The workspace was cleared.')]],
      View: [['Larger text', 'Ctrl+=', () => zoom(1)], ['Smaller text', 'Ctrl+-', () => zoom(-1)], ['Default text size', 'Ctrl+0', () => zoom(0)], '-',
        { label: 'Long number format', checked: () => /long/.test($('st4').textContent), fn: () => run(/long/.test($('st4').textContent) ? 'format short' : 'format long') }, '-',
        ['Reset figure view', '', resetView], ['Close all figures', '', () => closeFigure(true)], '-', ['Focus Command Window', 'Ctrl+Shift+C', () => cwIn.focus()], ['Focus editor', 'Ctrl+Shift+E', () => { const n = currentName(); n && S.eds.get(n).focus(); }]],
      Help: [['Function reference', 'F1', functionBrowser], ['Keyboard shortcuts', '', () => Aero.alert('Keyboard shortcuts', SHORTCUTS)],
        ['About Lumen Lab', '', () => Aero.alert('About Lumen Lab', 'Lumen Lab 1.0 — free numeric computing in the spirit of MATLAB.\n\nA MATLAB-compatible language (matrices, indexing with end and logical masks, element-wise and matrix operators, if/for/while/switch/try, functions in .m files and anonymous functions), linear algebra (inv, det, \\, eig, svd, qr, lu, chol), statistics, FFT, polynomials, interpolation, ode45/ode23, fzero, fminsearch, integral and 2-D/3-D plotting.\n\nEverything runs on your computer; nothing is sent anywhere.')]],
    },
  });

  // ---------- start ----------
  renderTabs(); renderFiles(); renderWs(); renderFigs();
  startWorker();
  const restored = restore();
  cwPrint('Lumen Lab 1.0 — type commands here, e.g.  A = magic(4), plot(sin(0:0.1:10)) or help.\n', 'info');
  if (!restored) loadSample();
  ready.then(() => { $('st1').textContent = 'Ready'; $('st4').textContent = 'format short · 0 variables'; if (!sab) cwPrint('Note: Stop and input() need a cross-origin isolated page; here Stop restarts the engine.\n', 'warn'); });
  setTimeout(() => cwIn.focus(), 100);
})();
