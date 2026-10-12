'use strict';
/* Lumen Convert — data & text tools (live two-pane converters): CSV ⇄ JSON, JSON ⇄ YAML, JSON ⇄ XML, YAML ⇄ CSV,
   TSV ⇄ CSV, Markdown → HTML, HTML → Markdown, Base64 text, URL encode, HTML entities, text case. */
(() => {
  const { register, alias, util: U } = LC;
  const { esc, el, fmtSize, baseName } = U;

  /* ---------------- CSV ---------------- */
  function detectDelim(text) {
    const lines = []; let q = false, cur = '';
    for (let i = 0; i < text.length && lines.length < 8; i++) { const c = text[i]; if (c === '"') q = !q; if (!q && (c === '\n' || c === '\r')) { if (cur) lines.push(cur); cur = ''; } else if (!q) cur += c; }
    if (cur && lines.length < 8) lines.push(cur);
    let best = ',', bs = -1;
    for (const d of [',', ';', '\t', '|']) {
      const counts = lines.map(l => l.split(d).length - 1); if (!counts.length || !counts[0]) continue;
      const same = counts.filter(c => c === counts[0]).length, score = same * 100 + counts[0];
      if (score > bs) { bs = score; best = d; }
    }
    return best;
  }
  function parseCsv(text, { delim = 'auto' } = {}) {
    text = text.replace(/^﻿/, '');
    const d = delim === 'auto' ? detectDelim(text) : delim, rows = []; let row = [], f = '', q = false, i = 0, quoted = false;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; } f += c; i++; continue; }
      if (c === '"' && f === '' && !quoted) { q = true; quoted = true; i++; continue; }
      if (c === d) { row.push(f); f = ''; quoted = false; i++; continue; }
      if (c === '\r' || c === '\n') { row.push(f); rows.push(row); row = []; f = ''; quoted = false; i += c === '\r' && text[i + 1] === '\n' ? 2 : 1; continue; }
      f += c; i++;
    }
    if (q) throw new Error('A quoted field is never closed (unbalanced ")');
    if (f !== '' || row.length || quoted) { row.push(f); rows.push(row); }
    return { rows: rows.filter(r => !(r.length === 1 && r[0] === '')), delim: d };
  }
  function toCsv(rows, d = ',', protect = false) {
    const cell = v => {
      if (v == null) return '';
      let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
      if (protect && typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return s.includes(d) || /["\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return rows.map(r => r.map(cell).join(d)).join('\r\n') + (rows.length ? '\r\n' : '');
  }
  const NUM = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
  const typed = v => { if (typeof v !== 'string') return v; const t = v.trim(); if (t === '') return null; if (NUM.test(t) && t.length < 16) return Number(t); if (/^(true|false)$/i.test(t)) return t.toLowerCase() === 'true'; if (/^null$/i.test(t)) return null; return v; };
  function flatten(o, pre = '', out = {}) {
    if (o === null || typeof o !== 'object') { out[pre || 'value'] = o; return out; }
    const keys = Array.isArray(o) ? o.map((_, i) => i) : Object.keys(o);
    if (!keys.length && pre) { out[pre] = Array.isArray(o) ? '' : ''; return out; }
    for (const k of keys) { const v = o[k], p = pre ? pre + '.' + k : String(k); if (v !== null && typeof v === 'object') flatten(v, p, out); else out[p] = v; }
    return out;
  }
  function unflatten(obj) {
    const root = {};
    for (const [k, v] of Object.entries(obj)) {
      const parts = k.split('.'); let cur = root;
      for (let i = 0; i < parts.length - 1; i++) { const p = parts[i]; if (p === '__proto__' || p === 'constructor' || p === 'prototype') { cur = null; break; } if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = /^\d+$/.test(parts[i + 1]) ? [] : {}; cur = cur[p]; }
      const last = parts[parts.length - 1]; if (cur && last !== '__proto__') cur[last] = v;
    }
    return root;
  }
  function rowsToObjects(rows, o) {
    if (!rows.length) return [];
    if (!o.header) return rows.map(r => o.typed ? r.map(typed) : r);
    const head = rows[0].map((h, i) => h.trim() || 'column' + (i + 1)); const seen = {};
    const keys = head.map(h => { seen[h] = (seen[h] || 0) + 1; return seen[h] > 1 ? `${h}_${seen[h]}` : h; });
    return rows.slice(1).map(r => { const ob = {}; keys.forEach((k, i) => { const v = r[i] ?? ''; ob[k] = o.typed ? typed(v) : v; }); return o.nest ? unflatten(ob) : ob; });
  }
  function dataToRows(data) {
    if (data && !Array.isArray(data) && typeof data === 'object') { const arrs = Object.values(data).filter(Array.isArray); data = Object.keys(data).length === 1 && arrs.length === 1 ? arrs[0] : [data]; }
    if (!Array.isArray(data)) data = [data];
    if (data.every(Array.isArray)) return data;
    const flat = data.map(r => r !== null && typeof r === 'object' ? flatten(r) : { value: r });
    const keys = []; const ks = new Set(); for (const r of flat) for (const k of Object.keys(r)) if (!ks.has(k)) { ks.add(k); keys.push(k); }
    return [keys, ...flat.map(r => keys.map(k => r[k] ?? ''))];
  }
  // JSON.stringify with a node budget (guards against YAML alias "billion laughs" expansion)
  function safeJson(v, indent) { let n = 0; return JSON.stringify(v, (k, x) => { if (++n > 3e6) throw new Error('The data expands to more than 3 million values'); return x; }, indent); }
  const parseJson = s => { try { return JSON.parse(s); } catch (e) { throw new Error('Invalid JSON: ' + e.message); } };
  const ind = o => o.indent === 'tab' ? '\t' : +o.indent;

  /* ---------------- generic live text tool ---------------- */
  function textTool(def) {
    register({ ...def, render(root, preset) {
      let mode = (preset && preset.mode) || def.modes[0].id;
      const opts = {}; for (const f of def.options || []) opts[f.key] = f.value; Object.assign(opts, preset || {}); delete opts.mode;
      const M = () => def.modes.find(m => m.id === mode);
      const top = el('div', 'intro'); let seg = null;
      if (def.modes.length > 1) { seg = el('div', 'seg'); for (const m of def.modes) { const b = el('button', null, esc(m.label)); b.type = 'button'; b.dataset.m = m.id; b.onclick = () => setMode(m.id); seg.append(b); } top.append(seg); }
      const swap = el('button', null, '⇄ Swap'); swap.type = 'button'; swap.title = 'Use the output as the new input and reverse the direction'; if (def.modes.length === 2) top.append(swap);
      const optBar = el('div', 'checks'); optBar.style.marginLeft = 'auto'; top.append(optBar);
      const io = el('div', 'io'), L = el('div'), R = el('div'); io.append(L, R);
      const tbL = el('div', 'tb'), inLab = el('b'), openB = el('button', 'mini', 'Open file…'), sampleB = el('button', 'mini', 'Sample'), clearB = el('button', 'mini', 'Clear');
      [openB, sampleB, clearB].forEach(b => b.type = 'button');
      const pick = el('input'); pick.type = 'file'; pick.className = 'vh';
      tbL.append(inLab, el('span', 'sp'), openB, sampleB, clearB, pick);
      const inp = el('textarea'); inp.spellcheck = false; inp.setAttribute('aria-label', 'Input');
      L.append(tbL, inp);
      const tbR = el('div', 'tb'), outLab = el('b'), copyB = el('button', 'go mini', 'Copy'), dlB = el('button', 'mini', 'Download'); copyB.type = dlB.type = 'button';
      let viewSeg = null, view = 'code';
      tbR.append(outLab, el('span', 'sp'));
      if (def.preview) { viewSeg = el('div', 'seg'); for (const [v, l] of [['code', 'Code'], ['preview', 'Preview']]) { const b = el('button', 'mini', l); b.type = 'button'; b.dataset.v = v; b.onclick = () => { view = v; showView(); }; viewSeg.append(b); } tbR.append(viewSeg); }
      tbR.append(copyB, dlB);
      const out = el('textarea'); out.readOnly = true; out.spellcheck = false; out.setAttribute('aria-label', 'Output');
      const prev = el('div', 'mdprev'); prev.hidden = true;
      prev.addEventListener('click', e => { const a = e.target.closest('a'); if (a) { e.preventDefault(); U.toast('Links are disabled in the preview'); } });
      R.append(tbR, out, prev);
      const status = el('div', 'status');
      root.append(top, io, status);
      function showView() { if (!viewSeg) return; [...viewSeg.children].forEach(b => b.classList.toggle('on', b.dataset.v === view)); out.hidden = view !== 'code'; prev.hidden = view === 'code'; }
      function renderOpts() {
        optBar.innerHTML = '';
        for (const f of def.options || []) {
          if (f.modes && !f.modes.includes(mode)) continue; if (f.show && !f.show(opts, mode)) continue;
          const lab = el('label');
          if (f.type === 'checkbox') { const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!opts[f.key]; cb.onchange = () => { opts[f.key] = cb.checked; run(); }; lab.append(cb, document.createTextNode(f.label)); }
          else if (f.type === 'text') { const t = el('input'); t.type = 'text'; t.value = opts[f.key]; t.style.width = (f.width || 90) + 'px'; t.oninput = () => { opts[f.key] = t.value; run(); }; lab.append(document.createTextNode(f.label + ' '), t); }
          else { const s = el('select'); for (const [v, l] of f.options) { const op = el('option', null, esc(l)); op.value = v; s.append(op); } s.value = opts[f.key]; s.onchange = () => { opts[f.key] = s.value; run(); }; lab.append(document.createTextNode(f.label + ' '), s); }
          optBar.append(lab);
        }
      }
      function setMode(m) {
        mode = m; const md = M();
        if (seg) [...seg.children].forEach(b => b.classList.toggle('on', b.dataset.m === m));
        inLab.textContent = md.inLabel; outLab.textContent = md.outLabel; inp.placeholder = md.placeholder || ('Paste ' + md.inLabel + ' here, or drop a file'); pick.accept = md.accept || '';
        if (viewSeg) { viewSeg.hidden = !md.preview; if (!md.preview) view = 'code'; }
        showView(); renderOpts(); run();
      }
      let lastOut = '', tmr;
      function run() {
        const md = M(), text = inp.value;
        if (!text.trim()) { out.value = lastOut = ''; prev.innerHTML = ''; status.className = 'status'; status.textContent = md.hint || 'Type, paste or drop a file on the left. The result updates as you type.'; return ''; }
        try {
          const r = md.convert(text, opts); const s = typeof r === 'string' ? r : r.text;
          out.value = lastOut = s; status.className = 'status';
          status.textContent = (r.status ? r.status + ' · ' : '') + `${fmtSize(new Blob([text]).size)} → ${fmtSize(new Blob([s]).size)}`;
          if (md.preview && def.preview) def.preview(s, prev, opts);
          return s;
        } catch (e) { out.value = lastOut = ''; prev.innerHTML = ''; status.className = 'status err'; status.textContent = e.message || String(e); return null; }
      }
      inp.oninput = () => { clearTimeout(tmr); tmr = setTimeout(run, inp.value.length > 500000 ? 500 : 120); };
      async function loadFile(f) { if (f.size > 50 * 1048576) { status.className = 'status err'; status.textContent = 'File is over 50 MB'; return; } inp.value = await LC.pdfInternals.readText(f); srcName = baseName(f.name); run(); }
      let srcName = null;
      openB.onclick = () => pick.click(); pick.onchange = () => { if (pick.files[0]) loadFile(pick.files[0]); pick.value = ''; };
      inp.ondragover = e => { e.preventDefault(); inp.style.background = '#eef7ff'; }; inp.ondragleave = () => inp.style.background = '';
      inp.ondrop = e => { e.preventDefault(); inp.style.background = ''; if (e.dataTransfer.files[0]) loadFile(e.dataTransfer.files[0]); else { inp.value = e.dataTransfer.getData('text'); run(); } };
      sampleB.onclick = () => { inp.value = M().sample || ''; srcName = null; run(); };
      clearB.onclick = () => { inp.value = ''; srcName = null; run(); inp.focus(); };
      copyB.onclick = () => lastOut && U.copyText(lastOut);
      dlB.onclick = () => { if (!lastOut) return; const md = M(); U.download(new Blob([lastOut], { type: (md.mime || 'text/plain') + ';charset=utf-8' }), (srcName || def.fileBase || 'converted') + '.' + (typeof md.ext === 'function' ? md.ext(opts) : md.ext || 'txt')); };
      swap.onclick = () => { if (!lastOut) return; const other = def.modes.find(m => m.id !== mode); inp.value = lastOut; setMode(other.id); };
      setMode(mode);
      return { setMode, set(k, v) { opts[k] = v; renderOpts(); return run(); }, input(s) { inp.value = s; return run(); }, get output() { return lastOut; }, get error() { return status.classList.contains('err') ? status.textContent : null }, get previewHtml() { return prev.innerHTML; } };
    } });
  }

  const SAMPLE_CSV = 'id,name,email,city,score,active\n1,Ada Lovelace,ada@example.com,London,98.5,true\n2,"Grace Hopper",grace@example.com,"Arlington, VA",95,true\n3,Alan Turing,alan@example.com,Wilmslow,,false\n';
  const SAMPLE_JSON = '[\n  { "id": 1, "name": "Ada Lovelace", "skills": ["math", "poetry"], "address": { "city": "London", "zip": "W1" } },\n  { "id": 2, "name": "Grace Hopper", "skills": ["COBOL"], "address": { "city": "Arlington", "zip": "22201" } }\n]\n';
  const SAMPLE_YAML = '# Site settings\ntitle: Lumen Convert\nversion: 2\nfeatures:\n  - offline\n  - private\n  - free\nauthor:\n  name: ARTGEOrge\n  url: https://example.com\n';
  const SAMPLE_XML = '<?xml version="1.0" encoding="UTF-8"?>\n<library name="City">\n  <book id="1" lang="en">\n    <title>Dune</title>\n    <year>1965</year>\n  </book>\n  <book id="2">\n    <title>Neuromancer</title>\n    <year>1984</year>\n  </book>\n</library>\n';

  /* 16 ─ CSV ⇄ JSON */
  textTool({
    id: 'csv-json', cat: 'data', glyph: 'csv', name: 'CSV ⇄ JSON', keywords: 'csv json convert table spreadsheet array objects', desc: 'Convert spreadsheets to JSON and back, with type detection.', fileBase: 'data',
    options: [
      { key: 'delim', label: 'Delimiter', type: 'select', value: 'auto', options: [['auto', 'Auto'], [',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab'], ['|', 'Pipe']] },
      { key: 'header', label: 'First row is headers', type: 'checkbox', value: true, modes: ['c2j'] },
      { key: 'typed', label: 'Detect numbers', type: 'checkbox', value: true, modes: ['c2j'] },
      { key: 'nest', label: 'a.b headers → nested', type: 'checkbox', value: false, modes: ['c2j'] },
      { key: 'indent', label: 'Indent', type: 'select', value: '2', options: [['2', '2'], ['4', '4'], ['tab', 'Tab'], ['0', 'Minified']], modes: ['c2j'] },
      { key: 'protect', label: 'Guard against formulas', type: 'checkbox', value: false, modes: ['j2c'] }],
    modes: [
      { id: 'c2j', label: 'CSV → JSON', inLabel: 'CSV', outLabel: 'JSON', ext: 'json', mime: 'application/json', accept: '.csv,.tsv,.txt', sample: SAMPLE_CSV,
        convert(t, o) { const p = parseCsv(t, { delim: o.delim }); const data = rowsToObjects(p.rows, o); return { text: safeJson(data, ind(o)) + '\n', status: `${data.length} rows · delimiter ${p.delim === '\t' ? 'tab' : `“${p.delim}”`}` }; } },
      { id: 'j2c', label: 'JSON → CSV', inLabel: 'JSON', outLabel: 'CSV', ext: 'csv', mime: 'text/csv', accept: '.json', sample: SAMPLE_JSON,
        convert(t, o) { const rows = dataToRows(parseJson(t)); return { text: toCsv(rows, o.delim === 'auto' ? ',' : o.delim, o.protect), status: `${Math.max(0, rows.length - 1)} rows · ${rows[0] ? rows[0].length : 0} columns (nested fields flattened with dots)` }; } }]
  });
  alias('csv-to-json', 'csv-json', { mode: 'c2j' }); alias('json-to-csv', 'csv-json', { mode: 'j2c' });

  /* 17 ─ JSON ⇄ YAML */
  const Y = () => { if (!window.jsyaml) throw new Error('YAML library still loading, try again'); return window.jsyaml; };
  function yamlLoad(t) { try { const docs = Y().loadAll(t); return docs.length === 1 ? docs[0] : docs; } catch (e) { throw new Error('Invalid YAML: ' + (e.reason || e.message) + (e.mark ? ` (line ${e.mark.line + 1}, column ${e.mark.column + 1})` : '')); } }
  const yamlDump = (v, o) => Y().dump(JSON.parse(safeJson(v)), { indent: +o.yindent || 2, lineWidth: -1, noRefs: true, sortKeys: !!o.sort });
  textTool({
    id: 'json-yaml', needs: ['yaml'], cat: 'data', glyph: 'yaml', name: 'JSON ⇄ YAML', keywords: 'json yaml yml convert config kubernetes docker compose', desc: 'Convert configs between JSON and YAML (multi-document aware).', fileBase: 'config',
    options: [{ key: 'yindent', label: 'Indent', type: 'select', value: '2', options: [['2', '2'], ['4', '4']] }, { key: 'sort', label: 'Sort keys', type: 'checkbox', value: false }],
    modes: [
      { id: 'j2y', label: 'JSON → YAML', inLabel: 'JSON', outLabel: 'YAML', ext: 'yaml', mime: 'application/yaml', accept: '.json', sample: SAMPLE_JSON, convert: (t, o) => yamlDump(parseJson(t), o) },
      { id: 'y2j', label: 'YAML → JSON', inLabel: 'YAML', outLabel: 'JSON', ext: 'json', mime: 'application/json', accept: '.yaml,.yml', sample: SAMPLE_YAML, convert: (t, o) => { const v = yamlLoad(t); let s = safeJson(v, +o.yindent || 2); if (o.sort) s = safeJson(sortKeys(v), +o.yindent || 2); return s + '\n'; } }]
  });
  function sortKeys(v) { if (Array.isArray(v)) return v.map(sortKeys); if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])])); return v; }
  alias('yaml-to-json', 'json-yaml', { mode: 'y2j' }); alias('json-to-yaml', 'json-yaml', { mode: 'j2y' });

  /* JSON ⇄ XML */
  const xmlName = k => { let s = String(k).replace(/[^\p{L}\p{N}_.-]/gu, '_'); if (!/^[\p{L}_]/u.test(s)) s = '_' + s; if (/^xml/i.test(s)) s = '_' + s; return s; };
  const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  function toXml(v, name, pad, step, out) {
    const nl = step ? '\n' : '';
    if (Array.isArray(v)) { for (const x of v) toXml(x, name, pad, step, out); return; }
    const tag = xmlName(name);
    if (v === null || v === undefined) { out.push(`${pad}<${tag}/>${nl}`); return; }
    if (typeof v !== 'object') { out.push(`${pad}<${tag}>${xmlEsc(v)}</${tag}>${nl}`); return; }
    const attrs = Object.keys(v).filter(k => k.startsWith('@')).map(k => ` ${xmlName(k.slice(1))}="${xmlEsc(v[k])}"`).join('');
    const kids = Object.keys(v).filter(k => !k.startsWith('@') && k !== '#text');
    const text = v['#text'] != null ? xmlEsc(v['#text']) : '';
    if (!kids.length) { out.push(text ? `${pad}<${tag}${attrs}>${text}</${tag}>${nl}` : `${pad}<${tag}${attrs}/>${nl}`); return; }
    out.push(`${pad}<${tag}${attrs}>${nl}`); if (text) out.push(pad + step + text + nl);
    for (const k of kids) toXml(v[k], k, pad + step, step, out);
    out.push(`${pad}</${tag}>${nl}`);
  }
  function fromXml(t, o) {
    if (/<!ENTITY/i.test(t)) throw new Error('XML entity declarations (<!ENTITY>) are not allowed, for safety');
    const d = new DOMParser().parseFromString(t, 'application/xml'), pe = d.querySelector('parsererror');
    if (pe) throw new Error('Invalid XML: ' + (pe.textContent || '').replace(/\s+/g, ' ').replace(/^.*?error[^:]*:\s*/i, '').slice(0, 200));
    const conv = e => {
      const ob = {}; for (const a of e.attributes) ob['@' + a.name] = o.typed ? typed(a.value) : a.value;
      let text = '', hasEl = false;
      for (const c of e.childNodes) {
        if (c.nodeType === 1) { hasEl = true; const v = conv(c), k = c.nodeName; if (k in ob) { if (!Array.isArray(ob[k]) || !ob[k].__multi) { ob[k] = [ob[k]]; Object.defineProperty(ob[k], '__multi', { value: true }); } ob[k].push(v); } else ob[k] = v; }
        else if (c.nodeType === 3 || c.nodeType === 4) text += c.nodeValue;
      }
      text = text.trim();
      if (!hasEl && !e.attributes.length) return text === '' ? null : o.typed ? typed(text) : text;
      if (text) ob['#text'] = o.typed ? typed(text) : text;
      return ob;
    };
    const r = d.documentElement; return { [r.nodeName]: conv(r) };
  }
  textTool({
    id: 'json-xml', cat: 'data', glyph: 'xml', name: 'JSON ⇄ XML', keywords: 'json xml convert soap feed', desc: 'Attributes become "@name" keys, repeated elements become arrays.', fileBase: 'data',
    options: [{ key: 'root', label: 'Root', type: 'text', value: 'root', width: 80, modes: ['j2x'] }, { key: 'decl', label: 'XML declaration', type: 'checkbox', value: true, modes: ['j2x'] }, { key: 'typed', label: 'Detect numbers', type: 'checkbox', value: true, modes: ['x2j'] }],
    modes: [
      { id: 'j2x', label: 'JSON → XML', inLabel: 'JSON', outLabel: 'XML', ext: 'xml', mime: 'application/xml', accept: '.json', sample: SAMPLE_JSON, convert(t, o) {
        let v = parseJson(t), name = o.root || 'root';
        if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && !Array.isArray(Object.values(v)[0])) { name = Object.keys(v)[0]; v = v[name]; }
        else if (Array.isArray(v)) v = { item: v };
        const out = []; toXml(v, name, '', '  ', out); return (o.decl ? '<?xml version="1.0" encoding="UTF-8"?>\n' : '') + out.join(''); } },
      { id: 'x2j', label: 'XML → JSON', inLabel: 'XML', outLabel: 'JSON', ext: 'json', mime: 'application/json', accept: '.xml,.svg,.rss,.atom', sample: SAMPLE_XML, convert: (t, o) => safeJson(fromXml(t, o), 2) + '\n' }]
  });
  alias('xml-to-json', 'json-xml', { mode: 'x2j' }); alias('json-to-xml', 'json-xml', { mode: 'j2x' });

  /* YAML ⇄ CSV */
  textTool({
    id: 'yaml-csv', needs: ['yaml'], cat: 'data', glyph: 'csv', name: 'YAML ⇄ CSV', keywords: 'yaml yml csv table convert list', desc: 'A YAML list of records to a CSV table, and back.', fileBase: 'data',
    options: [{ key: 'delim', label: 'Delimiter', type: 'select', value: ',', options: [[',', 'Comma'], [';', 'Semicolon'], ['\t', 'Tab']] }, { key: 'typed', label: 'Detect numbers', type: 'checkbox', value: true, modes: ['c2y'] }],
    modes: [
      { id: 'y2c', label: 'YAML → CSV', inLabel: 'YAML', outLabel: 'CSV', ext: 'csv', mime: 'text/csv', accept: '.yaml,.yml', sample: '- name: Ada\n  role: Engineer\n  tags: [math, poetry]\n- name: Grace\n  role: Admiral\n', convert: (t, o) => { const rows = dataToRows(JSON.parse(safeJson(yamlLoad(t)))); return { text: toCsv(rows, o.delim), status: `${rows.length - 1} rows` }; } },
      { id: 'c2y', label: 'CSV → YAML', inLabel: 'CSV', outLabel: 'YAML', ext: 'yaml', mime: 'application/yaml', accept: '.csv', sample: SAMPLE_CSV, convert: (t, o) => { const data = rowsToObjects(parseCsv(t, { delim: 'auto' }).rows, { header: true, typed: o.typed, nest: true }); return { text: Y().dump(data, { lineWidth: -1, noRefs: true }), status: `${data.length} rows` }; } }]
  });

  /* TSV ⇄ CSV */
  textTool({
    id: 'tsv-csv', cat: 'data', glyph: 'csv', name: 'TSV ⇄ CSV', keywords: 'tsv tab separated csv comma convert paste excel', desc: 'Tab-separated (what Excel copies) to comma-separated, and back.', fileBase: 'table',
    options: [{ key: 'delim', label: 'CSV delimiter', type: 'select', value: ',', options: [[',', 'Comma'], [';', 'Semicolon']] }],
    modes: [
      { id: 't2c', label: 'TSV → CSV', inLabel: 'TSV', outLabel: 'CSV', ext: 'csv', mime: 'text/csv', accept: '.tsv,.tab,.txt', sample: 'Name\tCity\tAmount\nAda\tLondon, UK\t12.5\nGrace\tNew York\t7\n', convert: (t, o) => { const r = parseCsv(t, { delim: '\t' }).rows; return { text: toCsv(r, o.delim), status: `${r.length} rows` }; } },
      { id: 'c2t', label: 'CSV → TSV', inLabel: 'CSV', outLabel: 'TSV', ext: 'tsv', mime: 'text/tab-separated-values', accept: '.csv', sample: SAMPLE_CSV, convert: (t, o) => { const r = parseCsv(t, { delim: 'auto' }).rows; return { text: toCsv(r, '\t'), status: `${r.length} rows` }; } }]
  });

  /* 18 ─ Markdown → HTML (marked + DOMPurify) */
  const sanitize = html => window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  function safePreview(html, box) {
    // preview never fetches anything: remote images are replaced by their alt text
    const clean = window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'video', 'audio', 'source', 'picture'], RETURN_DOM_FRAGMENT: true });
    for (const img of clean.querySelectorAll('img')) { const s = img.getAttribute('src') || ''; if (!/^data:image\//i.test(s)) { const sp = document.createElement('span'); sp.className = 'dim'; sp.textContent = `[image: ${img.getAttribute('alt') || s}]`; img.replaceWith(sp); } }
    for (const n of clean.querySelectorAll('[srcset],[background],[poster]')) { n.removeAttribute('srcset'); n.removeAttribute('background'); n.removeAttribute('poster'); }
    box.replaceChildren(clean);
  }
  const SAMPLE_MD = '# Lumen Convert\n\nConvert **anything** locally. Nothing is *uploaded*.\n\n## Features\n\n- Fast\n- Private\n- [Free](https://example.com)\n\n| Format | Works |\n|---|---|\n| CSV | yes |\n| YAML | yes |\n\n```js\nconsole.log("hello");\n```\n\n> Your files never leave your device.\n';
  textTool({
    id: 'markdown-html', needs: ['marked', 'purify'], cat: 'data', glyph: 'md', name: 'Markdown → HTML', keywords: 'markdown md to html convert readme render', desc: 'GitHub-flavoured Markdown to clean, sanitised HTML with a live preview.', fileBase: 'document',
    options: [{ key: 'full', label: 'Full HTML page', type: 'checkbox', value: false }, { key: 'breaks', label: 'Line breaks → <br>', type: 'checkbox', value: false }],
    preview: (s, box) => safePreview(s, box),
    modes: [{ id: 'm2h', label: 'Markdown → HTML', inLabel: 'Markdown', outLabel: 'HTML', ext: 'html', mime: 'text/html', accept: '.md,.markdown,.txt', sample: SAMPLE_MD, preview: true,
      hint: 'Raw HTML inside the Markdown is sanitised: scripts, event handlers and javascript: links are removed.',
      convert(t, o) {
        if (!window.marked || !window.DOMPurify) throw new Error('Markdown library still loading, try again');
        const body = sanitize(window.marked.parse(t, { gfm: true, breaks: !!o.breaks, async: false }));
        if (!o.full) return body;
        const title = (t.match(/^#\s+(.+)$/m) || [, 'Document'])[1].trim();
        return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${esc(title)}</title>\n<style>body{max-width:46em;margin:2em auto;padding:0 1em;font:16px/1.6 system-ui,sans-serif;color:#222}pre{background:#f4f6f8;padding:10px;overflow:auto}code{font-family:Consolas,monospace}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}img{max-width:100%}blockquote{border-left:4px solid #ccd;margin-left:0;padding-left:1em;color:#555}</style>\n</head>\n<body>\n${body}</body>\n</html>\n`;
      } }]
  });
  alias('md-to-html', 'markdown-html');

  /* HTML → Markdown (turndown) */
  let td = null;
  function turndown(html, o) {
    if (!window.TurndownService) throw new Error('Turndown still loading, try again');
    const doc = new DOMParser().parseFromString(html, 'text/html'); // inert: nothing runs or loads
    doc.querySelectorAll('script,style,noscript,iframe,object,embed,template,head').forEach(n => n.remove());
    const key = JSON.stringify(o);
    if (!td || td.key !== key) {
      td = new window.TurndownService({ headingStyle: o.heading, bulletListMarker: o.bullet, codeBlockStyle: 'fenced', emDelimiter: '*' }); td.key = key;
      td.addRule('table', { filter: 'table', replacement(_, node) {
        const rows = [...node.querySelectorAll('tr')].map(tr => [...tr.children].map(c => c.textContent.replace(/\s+/g, ' ').trim().replace(/\|/g, '\\|')));
        if (!rows.length) return ''; const n = Math.max(...rows.map(r => r.length)); rows.forEach(r => { while (r.length < n) r.push(''); });
        return '\n\n' + [rows[0], rows[0].map(() => '---'), ...rows.slice(1)].map(r => '| ' + r.join(' | ') + ' |').join('\n') + '\n\n';
      } });
      td.addRule('strike', { filter: ['del', 's', 'strike'], replacement: c => '~~' + c + '~~' });
    }
    return td.turndown(doc.body) + '\n';
  }
  textTool({
    id: 'html-markdown', needs: ['turndown'], cat: 'data', glyph: 'md', name: 'HTML → Markdown', keywords: 'html to markdown md convert web page clean', desc: 'Web pages and HTML snippets to tidy Markdown (tables included).', fileBase: 'document',
    options: [{ key: 'heading', label: 'Headings', type: 'select', value: 'atx', options: [['atx', '# ATX'], ['setext', 'Underlined']] }, { key: 'bullet', label: 'Bullets', type: 'select', value: '-', options: [['-', '-'], ['*', '*'], ['+', '+']] }],
    modes: [{ id: 'h2m', label: 'HTML → Markdown', inLabel: 'HTML', outLabel: 'Markdown', ext: 'md', mime: 'text/markdown', accept: '.html,.htm,.xhtml', sample: '<h1>Hello</h1>\n<p>This is <strong>bold</strong>, <em>italic</em> and <a href="https://example.com">a link</a>.</p>\n<ul><li>One</li><li>Two</li></ul>\n<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>\n<script>alert(1)</script>',
      hint: 'Scripts, styles and frames are dropped. Nothing in the HTML is loaded or run.', convert: (t, o) => turndown(t, o) }]
  });
  alias('html-to-md', 'html-markdown');

  /* Base64 text */
  const utf8b64 = (s, url) => { const b = new TextEncoder().encode(s); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); let r = btoa(bin); if (url) r = r.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); return r; };
  textTool({
    id: 'base64-text', cat: 'text', glyph: 'b64', name: 'Base64 encode / decode', keywords: 'base64 encode decode text string utf-8 url-safe', desc: 'Text to Base64 and back, UTF-8 safe, with URL-safe variant.', fileBase: 'base64',
    options: [{ key: 'url', label: 'URL-safe (- _ no padding)', type: 'checkbox', value: false, modes: ['enc'] }, { key: 'wrap', label: 'Wrap at 76', type: 'checkbox', value: false, modes: ['enc'] }],
    modes: [
      { id: 'enc', label: 'Encode', inLabel: 'Text', outLabel: 'Base64', ext: 'txt', sample: 'Hello, wörld! 👋 Lumen Convert', convert: (t, o) => { const r = utf8b64(t, o.url); return o.wrap ? r.replace(/(.{76})/g, '$1\n').trim() : r; } },
      { id: 'dec', label: 'Decode', inLabel: 'Base64', outLabel: 'Text', ext: 'txt', sample: 'SGVsbG8sIHfDtnJsZCEg8J+RiyBMdW1lbiBDb252ZXJ0', convert: t => {
        const { bytes } = LC.imageInternals.parseDataInput(t);
        try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { return { text: new TextDecoder('windows-1252').decode(bytes), status: 'Not valid UTF-8, shown as Windows-1252 (this may be binary data: use Base64 → Image to save it as a file)' }; } } }]
  });

  /* URL encode / decode */
  textTool({
    id: 'url-encode', cat: 'text', glyph: 'link', name: 'URL encode / decode', keywords: 'url encode decode percent encoding uri query string escape', desc: 'Percent-encode text for URLs and query strings, or decode it.', fileBase: 'url',
    options: [{ key: 'how', label: 'Mode', type: 'select', value: 'component', options: [['component', 'Query value (encode everything)'], ['uri', 'Whole URL (keep :/?#&=)'], ['form', 'Form (spaces as +)']] }],
    modes: [
      { id: 'enc', label: 'Encode', inLabel: 'Text', outLabel: 'Encoded', ext: 'txt', sample: 'https://example.com/search?q=café & crème&page=2', convert: (t, o) => o.how === 'uri' ? encodeURI(t) : o.how === 'form' ? encodeURIComponent(t).replace(/%20/g, '+') : encodeURIComponent(t) },
      { id: 'dec', label: 'Decode', inLabel: 'Encoded', outLabel: 'Text', ext: 'txt', sample: 'q%3Dcaf%C3%A9%20%26%20cr%C3%A8me', convert: (t, o) => { const s = o.how === 'form' ? t.replace(/\+/g, ' ') : t; try { return o.how === 'uri' ? decodeURI(s) : decodeURIComponent(s); } catch (e) { const m = s.match(/%(?![0-9a-fA-F]{2})|%[0-9a-fA-F]{2}/g); throw new Error('Malformed percent-encoding: “%” must be followed by two hex digits that form valid UTF-8'); } } }]
  });

  /* HTML entities */
  const NAMED = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', ' ': '&nbsp;', '©': '&copy;', '®': '&reg;', '™': '&trade;', '€': '&euro;', '£': '&pound;', '—': '&mdash;', '–': '&ndash;', '…': '&hellip;' };
  textTool({
    id: 'html-entities', cat: 'text', glyph: 'amp', name: 'HTML entities encode / decode', keywords: 'html entities escape unescape encode decode amp lt gt', desc: 'Escape text for HTML (&amp;, &lt;, &#x…;) or turn entities back into text.', fileBase: 'text',
    options: [{ key: 'all', label: 'Also encode non-ASCII', type: 'checkbox', value: false, modes: ['enc'] }],
    modes: [
      { id: 'enc', label: 'Encode', inLabel: 'Text', outLabel: 'HTML', ext: 'txt', sample: '<a href="x">Tom & Jerry’s “café” © 2026</a>', convert: (t, o) => { let s = t.replace(/[&<>"']/g, c => NAMED[c]); if (o.all) s = s.replace(/[^\x00-\x7F]/gu, c => NAMED[c] || '&#x' + c.codePointAt(0).toString(16).toUpperCase() + ';'); return s; } },
      { id: 'dec', label: 'Decode', inLabel: 'HTML', outLabel: 'Text', ext: 'txt', sample: '&lt;p&gt;Caf&eacute; &amp; cr&#232;me &#x1F600; &copy;&lt;/p&gt;', convert: t => { const d = document.implementation.createHTMLDocument(''), ta = d.createElement('textarea'); ta.innerHTML = t; return ta.value; } }]
  });

  /* Text case */
  const words = s => s.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2').replace(/(\p{Lu})(\p{Lu}\p{Ll})/gu, '$1 $2').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const cap = w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const SMALL = /^(a|an|and|as|at|but|by|for|in|nor|of|on|or|the|to|vs|via|with)$/i;
  const CASES = {
    upper: s => s.toUpperCase(), lower: s => s.toLowerCase(),
    title: s => s.toLowerCase().replace(/[\p{L}\p{N}][\p{L}\p{N}'’]*/gu, (w, i) => i > 0 && SMALL.test(w) ? w : cap(w)),
    sentence: s => s.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (m, a, b) => a + b.toUpperCase()),
    camel: s => words(s).map((w, i) => i ? cap(w) : w.toLowerCase()).join(''), pascal: s => words(s).map(cap).join(''),
    snake: s => words(s).map(w => w.toLowerCase()).join('_'), constant: s => words(s).map(w => w.toUpperCase()).join('_'),
    kebab: s => words(s).map(w => w.toLowerCase()).join('-'), dot: s => words(s).map(w => w.toLowerCase()).join('.'),
    alternating: s => { let i = 0; return s.replace(/\p{L}/gu, c => i++ % 2 ? c.toUpperCase() : c.toLowerCase()); },
    inverse: s => s.replace(/\p{L}/gu, c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase())
  };
  textTool({
    id: 'text-case', cat: 'text', glyph: 'case', name: 'Text case converter', keywords: 'text case upper lower title sentence camelcase snake_case kebab-case pascal constant', desc: 'UPPER, lower, Title, Sentence, camelCase, snake_case, kebab-case and more.', fileBase: 'text',
    options: [{ key: 'case', label: 'Case', type: 'select', value: 'title', options: [['upper', 'UPPER CASE'], ['lower', 'lower case'], ['title', 'Title Case'], ['sentence', 'Sentence case'], ['camel', 'camelCase'], ['pascal', 'PascalCase'], ['snake', 'snake_case'], ['constant', 'CONSTANT_CASE'], ['kebab', 'kebab-case'], ['dot', 'dot.case'], ['alternating', 'aLtErNaTiNg'], ['inverse', 'iNVERSE']] }],
    modes: [{ id: 'case', label: 'Convert', inLabel: 'Text', outLabel: 'Result', ext: 'txt', sample: 'the quick brown fox jumps over the lazy dog\nXMLHttpRequest userId parse_html_file', hint: 'Code cases (camelCase, snake_case…) are applied to each line separately.',
      convert: (t, o) => /^(camel|pascal|snake|constant|kebab|dot)$/.test(o.case) ? t.split('\n').map(CASES[o.case]).join('\n') : CASES[o.case](t) }]
  });

  LC.dataInternals = { parseCsv, toCsv, typed, flatten, unflatten, rowsToObjects, dataToRows, fromXml, toXml, CASES, words };
})();
