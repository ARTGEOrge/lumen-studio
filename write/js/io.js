'use strict';
/* Lumen Write — files: .lwrite (own JSON format), .docx, .odt, .html, .md, .txt in; the same plus PDF out.
   Every file is untrusted: HTML goes through DOMPurify and then our own model (which only emits a fixed set
   of tags), style values are validated before they reach the style sheet. */
const IO = (() => {
  const FILTER = [{ name: 'Lumen Write document', extensions: ['lwrite'] }];
  const OPEN_FILTER = [{ name: 'Documents', extensions: ['lwrite', 'docx', 'odt', 'html', 'htm', 'md', 'markdown', 'txt'] }, { name: 'All files', extensions: ['*'] }];
  const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = s => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
  const dataUrl = id => { const a = S.assets[id]; return a ? `data:${a.mime};base64,${b64(a.data)}` : ''; };
  const ext = n => (String(n).match(/\.([^.]+)$/) || [])[1]?.toLowerCase() || '';

  /* ---------- validation of untrusted document data ---------- */
  const HEX = /^#[0-9a-f]{3,8}$/i;
  const num = (v, a, b) => typeof v === 'number' && isFinite(v) ? Math.min(b, Math.max(a, v)) : undefined;
  const str = (v, n = 2000) => typeof v === 'string' ? v.slice(0, n) : '';
  function cleanStyle(s, para) {
    const o = { name: str(s && s.name, 80) || 'Style' };
    if (!s || typeof s !== 'object') return o;
    if (s.font) o.font = Fonts.map(String(s.font));
    const sz = num(s.size, 4, 200); if (sz) o.size = sz;
    for (const k of ['b', 'i', 'u', 'caps', 'keep']) if (typeof s[k] === 'boolean') o[k] = s[k];
    for (const k of ['color', 'bg', 'bar']) if (HEX.test(s[k] || '')) o[k] = s[k];
    if (para) {
      for (const k of ['sb', 'sa', 'ind']) { const v = num(s[k], 0, 400); if (v != null) o[k] = v; }
      const fi = num(s.fi, -200, 200); if (fi) o.fi = fi;
      const lh = num(s.lh, 0.6, 4); if (lh) o.lh = lh;
      if (/^(left|center|right|justify)$/.test(s.align || '')) o.align = s.align;
      if (typeof s.next === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(s.next)) o.next = s.next;
    }
    return o;
  }
  function cleanDoc(d) {
    const out = Model.newDoc();
    const p = d.page || {};
    for (const k of ['w', 'h']) { const v = num(p[k], 72, 5000); if (v) out.page[k] = v; }
    for (const k of ['mt', 'mb', 'ml', 'mr', 'hd', 'fd']) { const v = num(p[k], 0, 1000); if (v != null) out.page[k] = v; }
    out.page.start = Math.round(num(p.start, 0, 99999) ?? 1) || 1;
    out.page.size = /^(A4|Letter|Legal|A5|Executive|Custom)$/.test(p.size || '') ? p.size : 'Custom';
    if (out.page.ml + out.page.mr > out.page.w - 72) out.page.ml = out.page.mr = 72;
    if (out.page.mt + out.page.mb > out.page.h - 72) out.page.mt = out.page.mb = 72;
    for (const k of ['header', 'footer']) { const h = d[k] || {}; out[k] = { l: str(h.l, 300), c: str(h.c, 300), r: str(h.r, 300) }; }
    out.hfFirst = !!d.hfFirst;
    out.meta = { title: str(d.meta && d.meta.title, 300), author: str(d.meta && d.meta.author, 200) };
    const st = d.styles || {};
    out.styles = Model.defaultStyles();
    for (const [id, s] of Object.entries(st.para || {})) if (/^[A-Za-z0-9_]{1,40}$/.test(id)) out.styles.para[id] = { ...(out.styles.para[id] || {}), ...cleanStyle(s, true) };
    for (const [id, s] of Object.entries(st.char || {})) if (/^[A-Za-z0-9_]{1,40}$/.test(id)) out.styles.char[id] = cleanStyle(s, false);
    for (const [id, t] of Object.entries(d.notes || {})) if (/^[\w-]{1,40}$/.test(id)) out.notes[id] = str(t, 20000);
    for (const [id, c] of Object.entries(d.comments || {})) if (/^[\w-]{1,40}$/.test(id) && c) out.comments[id] = { author: str(c.author, 120), date: str(c.date, 40), text: str(c.text, 20000) };
    out.assets = {};
    for (const [id, a] of Object.entries(d.assets || {})) if (/^[\w-]{1,40}$/.test(id) && a && /^image\/(png|jpeg|gif|webp|svg\+xml|bmp)$/.test(a.mime) && a.data) out.assets[id] = { mime: a.mime, data: a.data instanceof Uint8Array ? a.data : unb64(String(a.data)) };
    out.blocks = cleanBlocks(d.blocks);
    out.warnings = d.warnings;
    return out;
  }
  function cleanRun(r) {
    if (!r || typeof r !== 'object') return null;
    const o = {};
    if (r.t === 'text') { o.t = 'text'; o.text = str(r.text, 1e6); for (const k of ['b', 'i', 'u', 's', 'sup', 'sub']) if (r[k]) o[k] = true; for (const k of ['color', 'bg']) if (HEX.test(r[k] || '')) o[k] = r[k]; if (r.font) o.font = Fonts.map(String(r.font)); const sz = num(r.size, 3, 400); if (sz) o.size = sz; if (typeof r.cs === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(r.cs)) o.cs = r.cs; }
    else if (r.t === 'br' || r.t === 'tab') o.t = r.t;
    else if (r.t === 'fn' && /^[\w-]{1,40}$/.test(r.id || '')) { o.t = 'fn'; o.id = r.id; }
    else if (r.t === 'img' && /^[\w-]{1,40}$/.test(r.asset || '')) { o.t = 'img'; o.asset = r.asset; o.wrap = /^(inline|left|right|center)$/.test(r.wrap || '') ? r.wrap : 'inline'; o.alt = str(r.alt, 500); const w = num(r.w, 1, 5000), h = num(r.h, 1, 5000); if (w) o.w = w; if (h) o.h = h; }
    else return null;
    const href = r.link && Model.safeHref(r.link); if (href) o.link = href;
    for (const k of ['ins', 'del']) if (r[k] && typeof r[k] === 'object') o[k] = { au: str(r[k].au, 120), dt: str(r[k].dt, 40) };
    if (Array.isArray(r.cm)) { const c = r.cm.filter(x => /^[\w-]{1,40}$/.test(x)); if (c.length) o.cm = c; }
    return o;
  }
  function cleanBlocks(bs, depth = 0) {
    const out = [];
    for (const b of Array.isArray(bs) ? bs.slice(0, 200000) : []) {
      if (!b || typeof b !== 'object') continue;
      if (b.t === 'p') {
        const p = { t: 'p', style: typeof b.style === 'string' && /^[A-Za-z0-9_]{1,40}$/.test(b.style) ? b.style : 'Normal', runs: (Array.isArray(b.runs) ? b.runs : []).map(cleanRun).filter(Boolean) };
        if (/^(center|right|justify)$/.test(b.align || '')) p.align = b.align;
        const ind = num(b.ind, 0, 600); if (ind) p.ind = ind; const fi = num(b.fi, -300, 300); if (fi) p.fi = fi;
        if (b.list && typeof b.list === 'object') { p.list = { kind: b.list.kind === 'ol' ? 'ol' : 'ul', level: Math.round(num(b.list.level, 0, 8) || 0) }; if (Model.LIST_FMTS[p.list.kind].includes(b.list.fmt)) p.list.fmt = b.list.fmt; }
        out.push(p);
      } else if (b.t === 'pagebreak' || b.t === 'toc' || b.t === 'hr') out.push({ t: b.t });
      else if (b.t === 'table' && depth < 4 && Array.isArray(b.rows)) {
        const t = { t: 'table', rows: b.rows.slice(0, 5000).map(r => ({ ...(r && r.h ? { h: true } : {}), cells: (r && Array.isArray(r.cells) ? r.cells.slice(0, 100) : []).map(c => { const o = { blocks: cleanBlocks(c && c.blocks, depth + 1) }; if (!o.blocks.length) o.blocks.push({ t: 'p', style: 'Normal', runs: [] }); const cs = Math.round(num(c && c.cs, 1, 100) || 1), rs = Math.round(num(c && c.rs, 1, 5000) || 1); if (cs > 1) o.cs = cs; if (rs > 1) o.rs = rs; if (HEX.test(c && c.bg || '')) o.bg = c.bg; return o; }) })).filter(r => r.cells.length) };
        if (Array.isArray(b.widths)) { const w = b.widths.map(x => num(x, 0.5, 100)).filter(Boolean); if (w.length) t.widths = w; }
        if (t.rows.length) out.push(t);
      }
    }
    return out;
  }

  /* ---------- HTML / Markdown import ---------- */
  async function htmlToBlocks(html) {
    const clean = DOMPurify.sanitize(html, { FORBID_TAGS: ['style', 'script', 'form', 'input', 'button', 'select', 'textarea', 'iframe', 'object', 'embed', 'svg', 'math', 'video', 'audio', 'canvas', 'link', 'meta', 'base'], FORBID_ATTR: ['contenteditable', 'srcset'], ALLOW_DATA_ATTR: true });
    const tpl = document.createElement('template'); tpl.innerHTML = clean;
    App._pendingAssets = [];
    const blocks = Model.htmlToAst(tpl.content, { collapse: true, styles: S.doc ? S.doc.styles : Model.defaultStyles(), asset: src => App.assetFromDataUrl(src), hasAsset: id => !!S.assets[id] });
    await Promise.all(App._pendingAssets); App._pendingAssets = [];
    // drop references to images that failed to decode, size the rest
    Model.eachPara(blocks, p => { p.runs = p.runs.filter(r => r.t !== 'img' || S.assets[r.asset]); });
    if (S.doc) App.fillImageSizes(blocks);
    return blocks;
  }
  function titleOf(html) { const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html); return m ? m[1].trim() : ''; }

  /* ---------- open ---------- */
  async function confirmDiscard() { if (!Aero.dirty) return true; return Aero.confirm('Unsaved Changes', 'The current document has unsaved changes. Discard them?', 'Discard'); }
  async function open() {
    if (!(await confirmDiscard())) return;
    const f = await Aero.openFile({ accept: '.lwrite,.docx,.odt,.html,.htm,.md,.markdown,.txt', filters: OPEN_FILTER });
    if (f[0]) await openFile(f[0]);
  }
  async function readAny(f) {
    const e = ext(f.name), bytes = new Uint8Array(f.data);
    const text = () => new TextDecoder().decode(bytes).replace(/^﻿/, '');
    if (e === 'lwrite' || e === 'json') {
      const j = JSON.parse(text());
      if (!j || j.format !== 'lumen-write') throw new Error('not a Lumen Write document');
      return cleanDoc(j);
    }
    if (e === 'docx' || e === 'docm' || e === 'dotx') {
      try { return cleanDoc(Docx.readDocx(bytes, { fflate })); }
      catch (err) {
        console.warn('own docx reader failed, falling back to mammoth:', err);
        const res = await mammoth.convertToHtml({ arrayBuffer: f.data });
        const d = Model.newDoc(); S.doc = S.doc || d;
        d.blocks = await htmlToBlocks(res.value);
        d.warnings = ['Opened with simplified formatting'];
        for (const [id, a] of Object.entries(S.assets)) d.assets[id] = a;
        return cleanDoc(d);
      }
    }
    if (e === 'odt' || e === 'ott') return cleanDoc(Odt.readOdt(bytes, { fflate }));
    if (e === 'html' || e === 'htm' || e === 'xhtml') { const t = text(); const d = Model.newDoc(); S.doc = S.doc || d; d.blocks = await htmlToBlocks(t); d.meta.title = titleOf(t); for (const [id, a] of Object.entries(S.assets)) d.assets[id] = a; return cleanDoc(d); }
    if (e === 'md' || e === 'markdown' || e === 'mdown') { const d = Model.newDoc(); S.doc = S.doc || d; d.blocks = await htmlToBlocks(marked.parse(text(), { gfm: true })); for (const [id, a] of Object.entries(S.assets)) d.assets[id] = a; return cleanDoc(d); }
    if (e === 'txt' || e === 'text' || !e) { const d = Model.newDoc(); d.blocks = text().replace(/\r\n?/g, '\n').split('\n').map(l => ({ t: 'p', style: 'Normal', runs: l ? [{ t: 'text', text: l.replace(/\t/g, '    ') }] : [] })); return d; }
    throw new Error('unsupported file type .' + e);
  }
  async function openFile(f) {
    Aero.busy('Opening ' + f.name + '…');
    try {
      const keep = S.assets; S.assets = {};
      const d = await readAny(f);
      const pre = S.assets; S.assets = keep;
      // assets created while parsing HTML live in `pre`; hand them to the document
      for (const [id, a] of Object.entries(pre)) if (!d.assets[id]) d.assets[id] = { mime: a.mime, data: a.data };
      Object.values(pre).forEach(a => a.url && URL.revokeObjectURL(a.url));
      const own = ext(f.name) === 'lwrite';
      await App.setDocument(d, Aero.baseName(f.name), own ? f.path : null);
      Aero.toast('Opened ' + f.name);
    } catch (e) { console.warn(e); Aero.alert('Cannot Open', `“${f.name}” could not be opened (${e.message}).`); }
    finally { Aero.busy(); }
  }

  /* ---------- save ---------- */
  function serialize() {
    const ast = App.toAst();
    const assets = {}; for (const [id, a] of Object.entries(ast.assets)) assets[id] = { mime: a.mime, data: b64(a.data) };
    return JSON.stringify({ format: 'lumen-write', version: 1, app: 'Lumen Write 1.2', ...ast, assets });
  }
  async function save(as) {
    App.flushTyping();
    const name = (S.name || 'Untitled').replace(/\.lwrite$/i, '') + '.lwrite';
    const p = await Aero.saveFile({ name, data: serialize(), filters: FILTER, path: as ? null : S.path });
    if (!p) return null;
    S.path = Aero.isDesktop ? p : null; S.name = Aero.baseName(p) || S.name;
    Aero.setDoc(S.name, false); Aero.toast('Saved ' + S.name + '.lwrite'); return p;
  }

  /* ---------- export ---------- */
  // accepted view of the AST (tracked deletions dropped, insertions kept) for formats without change tracking
  function accepted(ast) { const a = structuredClone(ast); Model.eachPara(a.blocks, p => { p.runs = p.runs.filter(r => !r.del).map(r => { delete r.ins; return r; }); }); return a; }
  async function pngAssets(ast, allow) {
    // formats that cannot carry WebP/SVG/BMP images get PNG copies
    for (const [id, a] of Object.entries(ast.assets)) {
      if (allow.test(a.mime)) continue;
      try {
        const bm = await createImageBitmap(new Blob([a.data], { type: a.mime }));
        const c = new OffscreenCanvas(bm.width || 1, bm.height || 1); c.getContext('2d').drawImage(bm, 0, 0);
        const blob = await c.convertToBlob({ type: 'image/png' });
        ast.assets[id] = { mime: 'image/png', data: new Uint8Array(await blob.arrayBuffer()) };
      } catch (e) { delete ast.assets[id]; }
    }
    return ast;
  }
  const tocEntries = () => (Pager.last.toc || []).map(e => ({ level: e.level, text: e.text, page: String(e.page) }));
  const base = () => (S.name || 'Untitled').replace(/\.[^.]+$/, '');
  async function exportAs(kind) {
    App.flushTyping();
    try {
      Aero.busy('Exporting…');
      let data, name, filters;
      if (kind === 'docx') {
        const ast = await pngAssets(App.toAst(), /^image\/(png|jpeg|gif)$/);
        data = Docx.writeDocx(ast, { fflate, toc: tocEntries() }); name = base() + '.docx'; filters = [{ name: 'Word document', extensions: ['docx'] }];
      } else if (kind === 'odt') {
        const ast = await pngAssets(accepted(App.toAst()), /^image\/(png|jpeg|gif|svg\+xml)$/);
        data = Odt.writeOdt(ast, { fflate, toc: tocEntries() }); name = base() + '.odt'; filters = [{ name: 'OpenDocument text', extensions: ['odt'] }];
      } else if (kind === 'html') { data = htmlDoc(accepted(App.toAst())); name = base() + '.html'; filters = [{ name: 'Web page', extensions: ['html'] }]; }
      else if (kind === 'md') { data = markdown(accepted(App.toAst())); name = base() + '.md'; filters = [{ name: 'Markdown', extensions: ['md'] }]; }
      else if (kind === 'txt') { const a = accepted(App.toAst()); data = astText(a.blocks, a.notes); name = base() + '.txt'; filters = [{ name: 'Plain text', extensions: ['txt'] }]; }
      else if (kind === 'pdf') { data = await PDFX.export(); name = base() + '.pdf'; filters = [{ name: 'PDF', extensions: ['pdf'] }]; }
      Aero.busy();
      const p = await Aero.saveFile({ name, data, filters });
      if (p) Aero.toast('Exported ' + Aero.baseName(p) + '.' + kind);
      return data;
    } catch (e) { Aero.busy(); console.warn(e); Aero.alert('Export Failed', e.message || String(e)); }
  }
  // standalone HTML with the document's styles
  function htmlDoc(ast) {
    const notesOrder = []; Model.eachPara(ast.blocks, p => p.runs.forEach(r => { if (r.t === 'fn' && !notesOrder.includes(r.id)) notesOrder.push(r.id); }));
    let body = Model.blocksHtml(ast.blocks, { src: id => ast.assets[id] ? `data:${ast.assets[id].mime};base64,${b64(ast.assets[id].data)}` : '' });
    let n = 0;
    body = body.replace(/<sup class="fn" contenteditable="false" data-fn="([^"]+)">\*<\/sup>/g, (m, id) => { const k = notesOrder.indexOf(id) + 1; return `<sup class="fn"><a href="#fn${k}" id="fnref${k}">${k}</a></sup>`; });
    body = body.replace(/<div class="pbreak" contenteditable="false"><\/div>/g, '<div class="pbreak"></div>');
    body = body.replace(/<div class="toc" contenteditable="false" data-toc="1"><\/div>/g, () => `<nav class="toc"><p class="toc-title">Contents</p>${tocEntries().map(e => `<p class="toc-l${e.level}">${Aero.esc(e.text)}</p>`).join('')}</nav>`);
    body = body.replace(/ data-f="1"/g, '');
    const notes = notesOrder.length ? `<section class="footnotes"><hr><ol>${notesOrder.map((id, i) => `<li id="fn${i + 1}">${Aero.esc(ast.notes[id] || '')} <a href="#fnref${i + 1}">↩</a></li>`).join('')}</ol></section>` : '';
    void n;
    const css = Model.stylesCss(ast.styles, 'body').replace(/font-family:"([^"]+)", ([\w-]+)/g, (m, f, c) => `font-family:"${f}", ${c === 'sans-serif' ? 'Arial, Helvetica' : c === 'serif' ? 'Georgia, "Times New Roman"' : 'Consolas, "Courier New"'}, ${c}`);
    return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="Lumen Write"><title>${Aero.esc(ast.meta.title || base())}</title><style>\nbody{max-width:${Math.round((ast.page.w - ast.page.ml - ast.page.mr) * PX)}px;margin:40px auto;padding:0 20px}\n${css}\ntable{border-collapse:collapse;width:100%;margin:6pt 0 10pt}td{border:1px solid #a9b7c8;padding:3pt 6pt;vertical-align:top}td p{margin:0 0 2pt}tr[data-h] td{background:#e8eff7;font-weight:bold}\nimg[data-wrap=left]{float:left;margin:2pt 12pt 6pt 0}img[data-wrap=right]{float:right;margin:2pt 0 6pt 12pt}img[data-wrap=center]{display:block;margin:6pt auto}\n.pbreak{page-break-after:always;break-after:page}.toc p{margin:2pt 0}.toc .toc-l2{margin-left:1.5em}.toc .toc-l3{margin-left:3em}.toc-title{font-weight:bold}\nins{color:inherit;text-decoration:none}span.tab{white-space:pre}\n.footnotes{font-size:.85em;margin-top:2em}\n</style></head><body>\n${body}\n${notes}\n</body></html>\n`;
  }
  function markdown(ast) {
    const notesOrder = []; Model.eachPara(ast.blocks, p => p.runs.forEach(r => { if (r.t === 'fn' && !notesOrder.includes(r.id)) notesOrder.push(r.id); }));
    const html = Model.blocksHtml(ast.blocks, { src: id => ast.assets[id] ? `data:${ast.assets[id].mime};base64,${b64(ast.assets[id].data)}` : '' });
    const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*', strongDelimiter: '**', hr: '---' });
    td.addRule('fn', { filter: n => n.nodeName === 'SUP' && n.classList.contains('fn'), replacement: (c, n) => `[^${notesOrder.indexOf(n.dataset.fn) + 1}]` });
    td.addRule('strike', { filter: ['s', 'del', 'strike'], replacement: c => `~~${c}~~` });
    td.addRule('pbreak', { filter: n => n.nodeName === 'DIV' && n.classList.contains('pbreak'), replacement: () => '\n\n---\n\n' });
    td.addRule('toc', { filter: n => n.nodeName === 'DIV' && n.classList.contains('toc'), replacement: () => '\n\n' + tocEntries().map(e => `${'  '.repeat(e.level - 1)}- ${e.text}`).join('\n') + '\n\n' });
    td.addRule('code', { filter: n => n.nodeName === 'P' && n.dataset.s === 'Code', replacement: (c, n) => '\n\n```\n' + n.textContent + '\n```\n\n' });
    td.addRule('quote', { filter: n => n.nodeName === 'P' && n.dataset.s === 'Quote', replacement: c => '\n\n> ' + c.trim().replace(/\n/g, '\n> ') + '\n\n' });
    td.addRule('tab', { filter: n => n.nodeName === 'SPAN' && n.classList.contains('tab'), replacement: () => '    ' });
    td.addRule('inlinecode', { filter: n => n.nodeName === 'SPAN' && n.dataset.cs === 'InlineCode', replacement: c => '`' + c + '`' });
    td.addRule('table', {
      filter: 'table', replacement: (c, t) => {
        const rows = [...t.rows].map(r => [...r.cells].map(td => td.textContent.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim()));
        if (!rows.length) return '';
        const n = Math.max(...rows.map(r => r.length)); rows.forEach(r => { while (r.length < n) r.push(''); });
        return '\n\n' + [rows[0], Array(n).fill('---'), ...rows.slice(1)].map(r => '| ' + r.join(' | ') + ' |').join('\n') + '\n\n';
      },
    });
    let md = td.turndown(html);
    if (notesOrder.length) md += '\n\n' + notesOrder.map((id, i) => `[^${i + 1}]: ${ast.notes[id] || ''}`).join('\n') + '\n';
    return md.replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }
  function astText(blocks, notes) {
    const out = []; const order = [];
    const runs = rs => rs.map(r => r.t === 'text' ? (r.del ? '' : r.text) : r.t === 'br' ? '\n' : r.t === 'tab' ? '\t' : r.t === 'fn' ? `[${(order.includes(r.id) ? order : (order.push(r.id), order)).indexOf(r.id) + 1}]` : r.t === 'img' ? (r.alt ? `[${r.alt}]` : '') : '').join('');
    const counters = [];
    (function walk(bs, ind) {
      for (const b of bs) {
        if (b.t === 'p') {
          let pre = '';
          if (b.list) { const lv = b.list.level; counters.length = lv + 1; counters[lv] = (counters[lv] || 0) + 1; pre = '  '.repeat(lv) + (b.list.kind === 'ol' ? Model.fmtNumber(counters[lv], b.list.fmt || Model.defaultListFmt('ol', lv)) + '. ' : '• '); }
          else counters.length = 0;
          out.push(ind + pre + runs(b.runs));
        } else if (b.t === 'table') { for (const r of b.rows) out.push(ind + r.cells.map(c => { const sub = []; Model.eachPara(c.blocks, p => sub.push(runs(p.runs))); return sub.join(' / '); }).join('\t')); out.push(''); }
        else if (b.t === 'pagebreak') out.push('\f');
        else if (b.t === 'hr') out.push('----------------------------------------');
        else if (b.t === 'toc') for (const e of tocEntries()) out.push('  '.repeat(e.level - 1) + e.text + '  ' + e.page);
      }
    })(blocks, '');
    let s = out.join('\n');
    if (notes && order.length) s += '\n\n' + order.map((id, i) => `[${i + 1}] ${notes[id] || ''}`).join('\n');
    return s + '\n';
  }
  /* ---------- drag & drop ---------- */
  async function dropFiles(files) {
    for (const f of files) {
      const e = ext(f.name);
      if (/^(png|jpe?g|gif|webp|svg|bmp)$/.test(e)) { S.ed.focus(); await Ed.image(f); continue; }
      if (/^(lwrite|docx|odt|html?|md|markdown|txt)$/.test(e)) { if (await confirmDiscard()) await openFile(f); return; }
      Aero.toast('Cannot open ' + f.name);
    }
  }
  return { open, openFile, save, exportAs, serialize, dropFiles, htmlToBlocks, readAny, cleanDoc, dataUrl, astText, htmlDoc, markdown, accepted, b64, unb64, confirmDiscard, tocEntries };
})();
