'use strict';
/* Lumen Aero Kit — shared app shell for every Lumen app. Plain script, exposes window.Aero.
   See kit/README.md for usage. Works in a browser and inside the Lumen desktop shell
   (which provides window.desktop for native file dialogs and window controls). */
(function () {
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const native = window.desktop || null;
  let appName = 'Lumen', iconUrl = '../kit/icons/lumen.png', docName = '', dirty = false;
  const shortcuts = [];   // {combo, fn}

  /* ---------- window chrome ---------- */
  function init(opts) {
    appName = opts.name || appName; iconUrl = opts.icon || iconUrl;
    const app = $('.aero-app'); if (!app) throw new Error('Aero: missing .aero-app');
    const tb = el('div', 'aero-titlebar',
      `<img class="aero-appicon" src="${esc(iconUrl)}" alt=""><span class="aero-wintitle"></span>
       <div class="aero-caption"><button data-c="min" title="Minimize"><svg viewBox="0 0 10 10"><rect x="1" y="6" width="8" height="2.2"/></svg></button><button data-c="max" title="Maximize"><svg viewBox="0 0 10 10"><path d="M1 1.5h8v7H1z M2.6 3.4v3.5h4.8V3.4z" fill-rule="evenodd"/></svg></button><button data-c="close" title="Close"><svg viewBox="0 0 10 10"><path d="M1.6 1.6 8.4 8.4M8.4 1.6 1.6 8.4"/></svg></button></div>`);
    const mb = el('div', 'aero-menubar');
    app.prepend(tb, mb);
    if (!$('.aero-toast')) document.body.appendChild(el('div', 'aero-toast'));
    let link = document.querySelector('link[rel=icon]'); if (!link) { link = el('link'); link.rel = 'icon'; document.head.appendChild(link); } link.href = iconUrl;
    setDoc(opts.doc || '', false);
    if (opts.menus) menus(opts.menus);
    // window controls
    const root = document.documentElement;
    const applyState = st => { root.classList.toggle('maximized', !!st.maximized); root.classList.toggle('inactive', st.focused === false); };
    if (native?.win) {
      root.classList.add('desktop');
      native.win('state').then(st => { root.classList.toggle('native-glass', !!st.glass); applyState(st); });
      native.onWinState?.(applyState);
      tb.querySelectorAll('.aero-caption button').forEach(b => b.onclick = () => native.win(b.dataset.c));
    } else {
      addEventListener('blur', () => root.classList.add('inactive'));
      addEventListener('focus', () => root.classList.remove('inactive'));
      tb.querySelectorAll('.aero-caption button').forEach(b => b.onclick = () => toast(b.dataset.c === 'close' ? 'Close the browser tab to exit' : 'Window controls work in the desktop app'));
    }
    // keyboard shortcuts from menus
    document.addEventListener('keydown', e => {
      if ($('.aero-modal:not(.aero-busy)')) return;
      const typing = e.target.matches?.('input:not([type=range]):not([type=checkbox]),textarea,select,[contenteditable=true]');
      const combo = comboOf(e);
      const s = shortcuts.find(x => x.combo === combo);
      if (!s) return;
      if (typing && !/ctrl|alt/i.test(combo)) return;
      if (typing && /^ctrl\+(a|c|v|x|z|y)$/i.test(combo)) return;
      e.preventDefault(); s.fn();
    });
    document.addEventListener('click', closeMenus);
    // drag & drop of files
    if (opts.onDropFiles) {
      const tgt = opts.dropTarget || app;
      if (!tgt.querySelector('.aero-drop')) tgt.appendChild(el('div', 'aero-drop', esc(opts.dropText || 'Drop files to open')));
      tgt.addEventListener('dragover', e => { e.preventDefault(); tgt.classList.add('drag-over'); });
      tgt.addEventListener('dragleave', e => { if (e.target === tgt || !tgt.contains(e.relatedTarget)) tgt.classList.remove('drag-over'); });
      tgt.addEventListener('drop', async e => {
        e.preventDefault(); tgt.classList.remove('drag-over');
        const files = await Promise.all([...e.dataTransfer.files].map(async f => ({ name: f.name, type: f.type, data: await f.arrayBuffer(), path: native?.pathForFile?.(f) || null })));
        if (files.length) opts.onDropFiles(files);
      });
    }
    // desktop: files opened from Explorer ("Open with", double-click) are handed to the app like dropped files
    const openHandler = opts.onOpenFiles || opts.onDropFiles;
    if (native?.launchFile && openHandler) {
      const handle = async p => {
        try { const f = await native.readFile(p); openHandler([{ name: f.name, path: f.path, data: f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) }]); }
        catch (e) { toast('Could not open ' + p); }
      };
      native.onOpenFile?.(handle);
      native.launchFile().then(p => { if (p) setTimeout(() => handle(p), 400); });
    }
    // warn before leaving with unsaved work (browser only; the desktop shell asks natively)
    addEventListener('beforeunload', e => { if (dirty && !native) { e.preventDefault(); e.returnValue = ''; } });
    window.__lumenDirty = false;
    window.lumenSaveBeforeClose = async () => { try { return opts.onSave ? !!(await opts.onSave()) : true; } catch (e) { return false; } };
  }
  function setDoc(name, isDirty) {
    if (name != null) docName = name; if (isDirty != null) dirty = isDirty;
    window.__lumenDirty = dirty;
    document.title = (docName ? `${docName}${dirty ? ' •' : ''} – ` : '') + appName;
    const t = $('.aero-wintitle'); if (t) t.textContent = document.title;
  }
  const setDirty = d => setDoc(null, d);

  /* ---------- menus ----------
     menus({ File: [ ['New', 'Ctrl+N', fn], '-', '#Header', {label, key, fn, checked:()=>bool, disabled:()=>bool}, ... ], ... }) */
  function comboOf(e) {
    let k = e.key; if (k === ' ') k = 'Space'; if (k.length === 1) k = k.toUpperCase();
    if (k === '+') k = '='; // Ctrl+= and Ctrl++ both zoom
    return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.shiftKey && k.length > 1 || e.shiftKey && /[A-Z0-9]/.test(k) ? 'Shift' : '', e.altKey ? 'Alt' : '', k].filter(Boolean).join('+').toLowerCase();
  }
  const normCombo = c => c.replace(/\s/g, '').replace(/Del$/i, 'Delete').replace(/Esc$/i, 'Escape').toLowerCase();
  function menus(def) {
    const bar = $('.aero-menubar'); bar.innerHTML = ''; shortcuts.length = 0;
    Object.entries(def).forEach(([name, items]) => {
      const m = el('div', 'aero-menu'); m.textContent = name;
      const dd = el('div', 'aero-dropdown');
      const norm = items.map(it => Array.isArray(it) ? { label: it[0], key: it[1], fn: it[2] } : it);
      norm.forEach(it => { if (it && typeof it === 'object' && it.key && it.fn && !it.noShortcut) it.key.split('/').forEach(k => shortcuts.push({ combo: normCombo(k.trim()), fn: it.fn })); });
      const build = () => {
        dd.innerHTML = '';
        norm.forEach(it => {
          if (it === '-') return dd.appendChild(el('div', 'aero-msep'));
          if (typeof it === 'string' && it[0] === '#') return dd.appendChild(el('div', 'aero-mhead', esc(it.slice(1))));
          const mi = el('div', 'aero-mi', `<span>${esc(it.label)}</span><span class="k">${esc(it.key || '')}</span>`);
          if (it.checked?.()) mi.classList.add('checked');
          if (it.disabled?.()) mi.classList.add('disabled');
          mi.onclick = e => { e.stopPropagation(); closeMenus(); it.fn?.(); };
          dd.appendChild(mi);
        });
      };
      m.appendChild(dd);
      m.onclick = e => { e.stopPropagation(); const was = m.classList.contains('open'); closeMenus(); if (!was) { build(); m.classList.add('open'); } };
      m.onmouseenter = () => { if ($('.aero-menu.open') && !m.classList.contains('open')) { closeMenus(); build(); m.classList.add('open'); } };
      bar.appendChild(m);
    });
  }
  function closeMenus() { document.querySelectorAll('.aero-menu.open').forEach(m => m.classList.remove('open')); }
  // Register extra shortcuts not shown in menus (e.g. tool keys). Single keys are ignored while typing.
  function shortcut(combo, fn) { shortcuts.push({ combo: normCombo(combo), fn }); }

  /* ---------- toolbox ---------- */
  // tools: [{id, title, icon:'<svg inner>', key}] or null for separator. Returns {set(id), get()}
  function toolbox(container, tools, onSelect) {
    let cur = null;
    tools.forEach(t => {
      if (!t) return container.appendChild(el('div', 'aero-tsep'));
      const b = el('button', 'aero-tool', `<svg viewBox="0 0 24 24">${t.icon}</svg>`);
      b.title = t.title + (t.key ? ` (${t.key})` : ''); b.dataset.tool = t.id;
      b.onclick = () => api.set(t.id);
      container.appendChild(b);
      if (t.key) shortcut(t.key, () => api.set(t.id));
    });
    const api = {
      set(id) { cur = id; container.querySelectorAll('.aero-tool').forEach(b => b.classList.toggle('on', b.dataset.tool === id)); onSelect?.(id); },
      get: () => cur
    };
    return api;
  }

  /* ---------- toast / busy ---------- */
  let toastT;
  function toast(msg, ms = 2200) { const t = $('.aero-toast'); if (!t) return; t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
  let busyEl = null;
  function busy(msg) {
    if (!msg) { busyEl?.remove(); busyEl = null; return; }
    if (!busyEl) { busyEl = el('div', 'aero-modal aero-busy'); document.body.appendChild(busyEl); }
    busyEl.innerHTML = `<div class="aero-box"><div class="aero-spin"></div>${esc(msg)}</div>`;
  }

  /* ---------- dialogs ----------
     fields: {key,label,type:'range'|'number'|'text'|'textarea'|'select'|'checkbox'|'color'|'hidden',value,min,max,step,options,fmt,mono,swatch} */
  function dialog({ title, fields = [], ok = 'OK', cancel = 'Cancel', onChange, onOK, onCancel, html, noCancel, onInput, instruction, width }) {
    const ov = el('div', 'aero-modal'), box = el('div', 'aero-box'); ov.appendChild(box);
    if (width) box.style.width = width + 'px';
    box.innerHTML = `<h3><img src="${esc(iconUrl)}" alt="">${esc(title)}</h3>`;
    const content = el('div', 'content'); box.appendChild(content);
    if (instruction) content.appendChild(el('div', 'aero-instr', esc(instruction)));
    const v = {}, inputs = {}; let closed = false, pending = false;
    const fire = () => { if (!onChange || pending) return; pending = true; requestAnimationFrame(() => { pending = false; if (!closed) onChange({ ...v }); }); };
    const set = (key, val) => { const i = inputs[key]; if (!i) { v[key] = val; return; } if (i.type === 'checkbox') i.checked = !!val; else i.value = val; i._read(); };
    fields.forEach(f => {
      v[f.key] = f.value;
      if (f.type === 'hidden') return;
      const row = el('div', 'aero-row'), lab = el('label'); lab.textContent = f.label; row.appendChild(lab);
      if (f.swatch) { const sw = el('span', 'swatch'); sw.style.background = f.swatch; lab.prepend(sw); }
      let inp;
      if (f.type === 'select') { inp = el('select'); f.options.forEach(o => { const [val, txt] = Array.isArray(o) ? o : [o, o]; inp.add(new Option(txt, val)); }); inp.value = f.value; }
      else if (f.type === 'textarea') { inp = el('textarea'); inp.rows = f.rows || (f.mono ? 9 : 3); inp.value = f.value ?? ''; if (f.mono) { inp.className = 'code'; inp.spellcheck = false; } row.classList.add('wide'); }
      else { inp = el('input'); inp.type = f.type || 'number'; ['min', 'max', 'step', 'placeholder'].forEach(a => f[a] != null && (inp[a] = f[a])); if (f.type === 'checkbox') inp.checked = !!f.value; else inp.value = f.value ?? ''; }
      if (f.type === 'checkbox' || f.type === 'color') inp.style.justifySelf = 'start';
      row.appendChild(inp);
      const out = el('span', 'val'); row.appendChild(out);
      const read = () => {
        let x = f.type === 'checkbox' ? inp.checked : (f.type === 'range' || f.type === 'number' || !f.type) ? parseFloat(inp.value) : inp.value;
        if (typeof x === 'number' && Number.isNaN(x)) x = f.value;
        v[f.key] = x; if (f.type === 'range') out.textContent = f.fmt ? f.fmt(x) : x;
      };
      inp._read = read; inputs[f.key] = inp;
      read(); inp.addEventListener('input', () => { read(); onInput?.(f.key, v, set); fire(); }); inp.addEventListener('change', () => { read(); fire(); });
      content.appendChild(row);
    });
    if (html) content.insertAdjacentHTML('beforeend', html);
    const btns = el('div', 'aero-btns');
    btns.innerHTML = (noCancel ? '' : `<button class="aero-btn" data-a="c">${esc(cancel)}</button>`) + `<button class="aero-btn pri" data-a="o">${esc(ok)}</button>`;
    box.appendChild(btns);
    const close = () => { closed = true; ov.remove(); document.removeEventListener('keydown', kh, true); };
    const okf = () => { close(); onOK && onOK({ ...v }); };
    const cancelf = () => { close(); onCancel && onCancel(); };
    const kh = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); noCancel ? okf() : cancelf(); }
      else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); e.stopPropagation(); okf(); }
    };
    btns.addEventListener('click', e => { const a = e.target.dataset.a; if (a === 'o') okf(); else if (a === 'c') cancelf(); });
    document.addEventListener('keydown', kh, true);
    document.body.appendChild(ov);
    const first = content.querySelector('textarea:not(.code),input[type=text],input[type=number]'); if (first) { first.focus(); first.select?.(); }
    if (onChange) onChange({ ...v });
    return { close, el: box, set, values: v };
  }
  const confirm = (title, message, ok = 'OK') => new Promise(res => dialog({ title, instruction: message, ok, onOK: () => res(true), onCancel: () => res(false) }));
  const alert = (title, message) => new Promise(res => dialog({ title, instruction: message, noCancel: true, onOK: () => res() }));
  const prompt = (title, label, value = '') => new Promise(res => dialog({ title, fields: [{ key: 'v', label, type: 'text', value }], onOK: v => res(v.v), onCancel: () => res(null) }));

  /* ---------- files ---------- */
  // Returns [{name, data:ArrayBuffer, path, type}] (empty if cancelled)
  async function openFile({ accept = '*/*', filters, multiple = false } = {}) {
    if (native?.openFile && !multiple) {
      const f = await native.openFile(filters || [{ name: 'All files', extensions: ['*'] }]);
      if (!f) return [];
      return [{ name: f.name, path: f.path, data: f.data.buffer.slice(f.data.byteOffset, f.data.byteOffset + f.data.byteLength) }];
    }
    return new Promise(res => {
      const i = el('input'); i.type = 'file'; i.accept = accept; i.multiple = multiple; i.style.display = 'none';
      i.onchange = async () => { const out = await Promise.all([...i.files].map(async f => ({ name: f.name, type: f.type, path: null, data: await f.arrayBuffer() }))); i.remove(); res(out); };
      i.addEventListener('cancel', () => { i.remove(); res([]); });
      document.body.appendChild(i); i.click();
    });
  }
  // data: Blob | ArrayBuffer | Uint8Array | string. path: re-save to a known desktop path without asking.
  async function saveFile({ name, data, filters, path } = {}) {
    let bytes;
    if (data instanceof Blob) bytes = new Uint8Array(await data.arrayBuffer());
    else if (typeof data === 'string') bytes = new TextEncoder().encode(data);
    else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else bytes = data;
    if (native?.saveDialog) {
      const p = path || await native.saveDialog({ defaultPath: name, filters: filters || [] });
      if (!p) return null;
      await native.writeFile(p, bytes); return p;
    }
    const a = el('a'); a.href = URL.createObjectURL(new Blob([bytes])); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
    return name;
  }
  const baseName = n => String(n).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');

  /* ---------- undo history ----------
     const h = new Aero.History({ max: 60, onChange: () => ... });
     h.push('Label', state); h.undo() → state|undefined; h.redo(); h.list(); h.index */
  class History {
    constructor({ max = 80, onChange } = {}) { this.max = max; this.onChange = onChange; this.items = []; this.index = -1; }
    reset(label, state) { this.items = [{ label, state }]; this.index = 0; this.onChange?.(); }
    push(label, state) {
      this.items = this.items.slice(0, this.index + 1); this.items.push({ label, state, time: Date.now() });
      if (this.items.length > this.max) this.items.shift();
      this.index = this.items.length - 1; setDirty(true); this.onChange?.();
    }
    get current() { return this.items[this.index]?.state; }
    undo() { if (this.index <= 0) return; this.index--; setDirty(true); this.onChange?.(); return this.items[this.index].state; }
    redo() { if (this.index >= this.items.length - 1) return; this.index++; setDirty(true); this.onChange?.(); return this.items[this.index].state; }
    go(i) { if (i < 0 || i >= this.items.length) return; this.index = i; setDirty(true); this.onChange?.(); return this.items[i].state; }
    list() { return this.items.map((x, i) => ({ label: x.label, current: i === this.index, future: i > this.index })); }
  }
  // Render a History into a .aero-list element; onPick(index)
  function renderHistory(listEl, hist, onPick) {
    listEl.innerHTML = '';
    hist.list().forEach((h, i) => {
      const d = el('div', 'aero-item' + (h.current ? ' sel' : ''), `<span class="grow"></span>`);
      d.querySelector('.grow').textContent = h.label; if (h.future) d.style.color = '#9aa5b1';
      d.onclick = () => onPick(i); listEl.appendChild(d);
    });
    listEl.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }

  /* ---------- small helpers ---------- */
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function fmtTime(s) { s = Math.max(0, s); const m = Math.floor(s / 60), r = s - m * 60; return `${m}:${r.toFixed(2).padStart(5, '0')}`; }
  function download(blob, name) { return saveFile({ name, data: blob }); }

  window.Aero = { init, setDoc, setDirty, menus, shortcut, toolbox, toast, busy, dialog, confirm, alert, prompt, openFile, saveFile, download, baseName, History, renderHistory, closeMenus, clamp, uid, fmtTime, esc, el, $, native,
    get isDesktop() { return !!native }, get dirty() { return dirty } };
})();
