'use strict';
/* Lumen Layout — long documents: sections with page-number styles, automatic table of contents built
   from paragraph styles (with live page numbers and dot leaders), and reflowable EPUB 3 export. */
const LongDoc = (() => {
  const esc = Aero.esc;
  /* ---------- sections ---------- */
  function sectionDialog(i = S.curPage) {
    const d = S.doc, p = d.pages[i]; if (!p) return;
    const sec = d.sections[p.id];
    Aero.dialog({ title: 'Numbering & Section Options', instruction: `Page ${i + 1} (currently numbered “${S.eng.label(i)}”)`, fields: [
      { key: 'start', label: 'Start section on this page', type: 'checkbox', value: !!sec || i === 0 },
      { key: 'style', label: 'Page number style', type: 'select', value: sec?.style || 'arabic', options: [['arabic', '1, 2, 3, 4…'], ['roman', 'i, ii, iii, iv…'], ['ROMAN', 'I, II, III, IV…'], ['alpha', 'a, b, c, d…'], ['ALPHA', 'A, B, C, D…']] },
      { key: 'num', label: 'Start page numbering at (blank = continue)', type: 'text', value: sec?.start ? String(sec.start) : (i === 0 ? '1' : '') },
      { key: 'prefix', label: 'Section prefix', type: 'text', value: sec?.prefix || '' }],
      onOK: v => {
        if (v.start) { const n = parseInt(v.num, 10); d.sections[p.id] = { style: v.style, start: n > 0 ? n : null, prefix: String(v.prefix || '').slice(0, 12) }; }
        else delete d.sections[p.id];
        commit('Section Options');
      } });
  }

  /* ---------- table of contents ---------- */
  const clean = t => t.replace(/[￼]/g, '').replace(//g, '#').replace(/[\u2028\t]/g, ' ').replace(/­/g, '').replace(/\s+/g, ' ').trim();
  // paragraphs in the given styles, in reading order, with the page they start on
  function collect(styles, skipSid) { return collectIn(S.doc, S.eng, styles, skipSid); }
  function collectIn(doc, eng, styles, skipSid) {
    const lv = new Map(styles.map(s => [s.ps, s.level]));
    eng.ensure();
    const out = [];
    const pageIdx = new Map(doc.pages.map((p, i) => [p.id, i]));
    for (const s of Object.values(doc.stories)) {
      if (s.id === skipSid) continue;
      const fr = eng.storyFrames(s); if (!fr.length || fr[0].kind !== 'doc') continue;
      const res = eng.storyRes.get(s.id); if (!res) continue;
      const P = res.P, seen = new Set();
      fr.forEach((f, k) => {
        const L = res.frames[k]; if (!L) return;
        for (const ln of L.lines) {
          const pi = ln.pi; if (seen.has(pi) || P.pstart[pi] !== (ln.drop ? ln.drop.i0 : ln.a)) continue;
          const ps = s.paras[pi]?.ps; if (!lv.has(ps)) continue;
          seen.add(pi);
          const a = P.pstart[pi], b = pi + 1 < P.pstart.length ? P.pstart[pi + 1] - 1 : s.text.length;
          const text = clean(s.text.slice(a, b)); if (!text) continue;
          const page = pageIdx.get(f.page.id);
          out.push({ text, level: lv.get(ps), page, label: eng.label(page), sid: s.id, ci: a, y: f.item.y + ln.y + (ln.col || 0) * 10000, top: f.item.y + ln.y - ln.asc, left: f.item.x + ln.L });
        }
      });
    }
    out.sort((p, q) => p.page - q.page || (p.sid === q.sid ? p.ci - q.ci : p.y - q.y));
    return out;
  }
  // heading styles for PDF bookmarks: the table-of-contents styles, or styles that look like headings
  function headingStyles(doc) {
    if (doc.toc && doc.toc.styles && doc.toc.styles.length) return doc.toc.styles;
    const out = [];
    for (const [k, v] of Object.entries(doc.paraStyles)) {
      if (/^toc/.test(k)) continue;
      const n = (v.name + ' ' + k).toLowerCase();
      if (/subhead|\bsub\b/.test(n)) out.push({ ps: k, level: 2 });
      else if (/head|title|chapter/.test(n) && !/small|running|caption/.test(n)) out.push({ ps: k, level: 1 });
    }
    return out;
  }
  function ensureTocStyles(width) {
    const ps = S.doc.paraStyles, base = M.paraEff(S.doc, { ps: 'basic' });
    const ink = S.doc.cmyk && Color.swatch('black') ? '@black' : '#1a1a1a';
    ps.tocTitle = ps.tocTitle || { name: 'TOC Title', font: 'Playfair Display', weight: 700, size: 20, lead: 26, spA: 12, color: ink, hyph: false };
    ps.toc1 = { ...(ps.toc1 || { name: 'TOC Level 1', font: base.font, weight: 600, size: 10.5, lead: 15, spB: 6, color: ink, hyph: false }), tabs: [{ x: +width.toFixed(2), t: 'r', ld: '.' }] };
    ps.toc2 = { ...(ps.toc2 || { name: 'TOC Level 2', font: base.font, size: 9.5, lead: 13.5, indL: 14, color: ink, hyph: false }), tabs: [{ x: +width.toFixed(2), t: 'r', ld: '.' }] };
    ps.toc3 = { ...(ps.toc3 || { name: 'TOC Level 3', font: base.font, italic: true, size: 9, lead: 13, indL: 28, color: ink, hyph: false }), tabs: [{ x: +width.toFixed(2), t: 'r', ld: '.' }] };
  }
  function tocDialog() {
    const d = S.doc, prev = d.toc;
    const cand = Object.entries(d.paraStyles).filter(([k]) => !/^toc/.test(k));
    const guess = (k, v) => { const p = prev?.styles.find(x => x.ps === k); if (p) return String(p.level); if (prev) return ''; const n = (v.name + ' ' + k).toLowerCase(); return /subhead|\bsub\b/.test(n) ? '2' : /head/.test(n) && !/small/.test(n) ? '1' : ''; };
    const selFrame = UI.selItems().find(i => i.type === 'text');
    const fields = [{ key: 'title', label: 'Title', type: 'text', value: prev?.title ?? 'Contents' },
      ...cand.map(([k, v]) => ({ key: 'ps_' + k, label: v.name, type: 'select', value: guess(k, v), options: [['', '— not included'], ['1', 'Level 1'], ['2', 'Level 2'], ['3', 'Level 3']] })),
      { key: 'where', label: 'Place in', type: 'select', value: prev && d.stories[prev.sid] ? 'replace' : selFrame ? 'frame' : 'page', options: [...(prev && d.stories[prev.sid] ? [['replace', 'Replace existing table of contents']] : []), ...(selFrame ? [['frame', 'Selected text frame']] : []), ['page', 'New page at the start of the document'], ['current', 'New frame on the current page']] }];
    Aero.dialog({ title: 'Table of Contents', instruction: 'Choose the paragraph styles to include; page numbers come from the current layout', fields, width: 500, ok: 'Generate',
      onOK: v => {
        const styles = cand.filter(([k]) => v['ps_' + k]).map(([k]) => ({ ps: k, level: +v['ps_' + k] }));
        if (!styles.length) { Aero.toast('Pick at least one paragraph style'); return; }
        generate({ title: String(v.title || ''), styles }, v.where, selFrame);
      } });
  }
  function generate(cfg, where, selFrame) {
    const d = S.doc;
    let frame = null;
    if (where === 'replace' && d.toc && d.stories[d.toc.sid]) frame = S.eng.idx.get(d.stories[d.toc.sid].frames[0])?.item;
    else if (where === 'frame' && selFrame) frame = selFrame;
    else {
      let pi = S.curPage;
      if (where === 'page') { const p = M.newPage(d.pages[0]?.master ?? null); d.pages.splice(0, 0, p); pi = 0; docChanged(); }
      const pp = S.placed.find(p => p.kind === 'doc' && p.index === pi) || curPlaced();
      const m = S.eng.marginsFor('doc', pi);
      frame = Tools.newTextFrame(pp, m.l, m.t, pp.w - m.l - m.r, pp.h - m.t - m.b, 'basic');
      S.eng = new Engine(d);
    }
    if (!frame) return;
    const s = d.stories[frame.story];
    const w = Objects.columnWidth(frame);
    ensureTocStyles(w);
    // page numbers are taken after the TOC itself has been placed (it may push pages)
    const build = () => {
      const entries = collect(cfg.styles, s.id);
      const lines = [], paras = [];
      if (cfg.title) { lines.push(cfg.title); paras.push({ ps: 'tocTitle' }); }
      for (const e of entries) { lines.push(e.text + '\t' + e.label); paras.push({ ps: 'toc' + Math.min(3, e.level) }); }
      if (!lines.length) { lines.push(''); paras.push({ ps: 'toc1' }); }
      s.text = lines.join('\n'); s.ca = new Array(s.text.length).fill(0); s.attrs = [{}]; s.paras = paras; s.objs = {}; s.notes = {};
      return entries.length;
    };
    build(); S.eng = new Engine(d); const n = build();
    d.toc = { sid: s.id, title: cfg.title, styles: cfg.styles };
    S.sel = [frame.id]; S.edit = null;
    commit('Table of Contents');
    Aero.toast(`Table of contents: ${n} entr${n === 1 ? 'y' : 'ies'}`);
  }
  function updateToc() {
    const t = S.doc.toc; if (!t || !S.doc.stories[t.sid]) { tocDialog(); return; }
    generate(t, 'replace');
  }

  /* ---------- EPUB 3 (reflowable) ---------- */
  const xml = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cssName = k => 'ps-' + String(k).replace(/[^\w-]/g, '_');
  function cssColor(ref) { return Color.hex(ref) || '#000000'; }
  function epubDialog() {
    UI.closeCellEditor?.(true); flushTyping(true);
    Aero.dialog({ title: 'Export EPUB', instruction: 'Reflowable EPUB 3: stories in reading order with styles, lists, tables, images and footnotes', fields: [
      { key: 'title', label: 'Title', type: 'text', value: S.name || 'Untitled' }, { key: 'author', label: 'Author', type: 'text', value: '' },
      { key: 'cover', label: 'Use page 1 as the cover image', type: 'checkbox', value: true }, { key: 'fonts', label: 'Embed fonts', type: 'checkbox', value: true }],
      ok: 'Export', onOK: async v => {
        Aero.busy('Building EPUB…');
        try { const bytes = await buildEpub(v); Aero.busy(); const p = await Aero.saveFile({ name: S.name + '.epub', data: bytes, filters: [{ name: 'EPUB', extensions: ['epub'] }] }); if (p) Aero.toast(`Exported EPUB (${(bytes.length / 1024).toFixed(0)} KB)`); }
        catch (e) { Aero.busy(); console.error(e); Aero.alert('Export EPUB', 'Export failed: ' + e.message); }
      } });
  }
  async function buildEpub(opt = {}) {
    const d = S.doc, enc = new TextEncoder(), files = [], images = new Map(), fontsUsed = new Set();
    S.eng.ensure(); Color.use(d);
    // base font size: the most common paragraph size
    const sizes = new Map(); for (const s of Object.values(d.stories)) s.paras.forEach(p => { const z = M.paraEff(d, p).size; sizes.set(z, (sizes.get(z) || 0) + 1); });
    const base = [...sizes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
    const em = v => +(v / base).toFixed(3) + 'em';
    const levels = new Map((d.toc?.styles || []).map(s => [s.ps, s.level]));
    const headLevel = ps => levels.get(ps) || (levels.size ? 0 : (M.paraEff(d, { ps }).size >= base * 1.8 ? 1 : 0));
    const fam = f => { fontsUsed.add(f); return `"${f}", ${Fonts.FAMILIES[f]?.cat === 'Sans' || Fonts.FAMILIES[f]?.cat === 'Condensed' ? 'sans-serif' : 'serif'}`; };
    // styles
    let css = `body{margin:0 4%;font-size:100%;line-height:1.4}\np{margin:0}\nimg{max-width:100%}\nfigure{margin:1em 0;text-align:center}\nfigcaption{font-size:.8em}\ntable{border-collapse:collapse;margin:1em 0;width:100%}\ntd,th{padding:.25em .4em;vertical-align:middle}\naside.fn{font-size:.8em;margin:.3em 0}\n.cover{text-align:center;margin:0;padding:0}\n.cover img{max-height:100%}\n`;
    for (const [k] of Object.entries(d.paraStyles)) {
      const e = M.paraEff(d, { ps: k });
      css += `.${cssName(k)}{font-family:${fam(e.font)};font-size:${em(e.size)};font-weight:${e.weight};font-style:${e.italic ? 'italic' : 'normal'};color:${cssColor(e.color)};text-align:${e.align === 'justify-all' ? 'justify' : e.align};` +
        `line-height:${e.lead > 0 ? +(e.lead / e.size).toFixed(3) : 1.2};text-indent:${em(e.indF)};margin:${em(e.spB)} ${em(e.indR)} ${em(e.spA)} ${em(e.indL)};` +
        `${e.caps === 'all' ? 'text-transform:uppercase;' : e.caps === 'small' ? 'font-variant:small-caps;' : ''}${e.track ? `letter-spacing:${+(e.track / 1000).toFixed(3)}em;` : ''}${e.hyph ? '-epub-hyphens:auto;hyphens:auto;' : ''}}\n`;
    }
    async function imgFile(id) {
      if (images.has(id)) return images.get(id);
      const im = S.images[id]; if (!im) return null;
      let mime = im.mime || (im.data.match(/^data:([^;]+)/) || [])[1] || 'image/png', bytes;
      if (/jpeg|png|gif|svg/.test(mime)) { const b = atob(im.data.slice(im.data.indexOf(',') + 1)); bytes = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) bytes[i] = b.charCodeAt(i); }
      else { const c = document.createElement('canvas'); c.width = im.el?.naturalWidth || im.w; c.height = im.el?.naturalHeight || im.h; c.getContext('2d').drawImage(im.el, 0, 0); bytes = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/png'))).arrayBuffer()); mime = 'image/png'; }
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/svg+xml': 'svg' }[mime] || 'png';
      const f = { name: `images/img${images.size + 1}.${ext}`, mime, bytes, alt: im.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') };
      images.set(id, f); files.push({ name: 'OEBPS/' + f.name, data: bytes }); return f;
    }
    function tableHtml(t) {
      const own = Tables.owners(t); let h = '<table>';
      for (let r = 0; r < t.rowH.length; r++) {
        const head = r < (t.header || 0); h += '<tr>';
        for (let c = 0; c < t.colW.length; c++) {
          const [or, oc] = own[r][c]; if (or !== r || oc !== c) continue;
          const cell = t.cells[r][c], s = Tables.span(t, r, c), tag = head ? 'th' : 'td';
          const fill = cell.fill || (head ? t.hfill : (t.zebra && (r - (t.header || 0)) % 2 === 1 ? t.zebra : null));
          const st = `${fill ? `background:${cssColor(fill)};` : ''}color:${cssColor(cell.color || (head ? t.hcolor : t.tcolor))};font-family:${fam(t.tfont)};font-size:${em(t.tsize)};text-align:${cell.align || 'left'};${t.bw > 0 ? `border:${Math.max(1, t.bw)}px solid ${cssColor(t.bcolor)};` : ''}${cell.bold ? 'font-weight:700;' : ''}`;
          h += `<${tag}${s.cs > 1 ? ` colspan="${s.cs}"` : ''}${s.rs > 1 ? ` rowspan="${s.rs}"` : ''} style="${st}">${xml(cell.t || '').replace(/\n/g, '<br/>')}</${tag}>`;
        }
        h += '</tr>';
      }
      return h + '</table>';
    }
    const nav = [], notes = []; let hid = 0;
    async function storyHtml(s) {
      const P = (S.eng.storyRes.get(s.id) || {}).P; let html = '', list = null;
      const pstart = [0]; for (let i = 0; i < s.text.length; i++) if (s.text[i] === '\n') pstart.push(i + 1);
      for (let pi = 0; pi < s.paras.length; pi++) {
        const a = pstart[pi], b = pi + 1 < pstart.length ? pstart[pi + 1] - 1 : s.text.length, para = s.paras[pi], pe = M.paraEff(d, para);
        const lt = pe.list === 'bullet' ? 'ul' : pe.list === 'number' ? 'ol' : null;
        if (list && list !== lt) { html += `</${list}>\n`; list = null; }
        if (lt && !list) { html += `<${lt} class="${cssName(para.ps)}">\n`; list = lt; }
        // inline runs
        let inner = '', blocks = '';
        for (let i = a; i < b;) {
          const ch = s.text[i], at = s.attrs[s.ca[i]] || {};
          if (ch === '￼') { const o = s.objs?.[at.obj]; if (o?.kind === 'table') blocks += tableHtml(o); else if (o?.kind === 'graphic' && o.item.img) { const f = await imgFile(o.item.img); if (f) { const tag = `<img src="${f.name}" alt="${xml(f.alt)}" style="width:${Math.round(o.item.w)}px;max-width:100%"/>`; if (o.pos === 'above') blocks += `<figure>${tag}</figure>`; else inner += tag; } } i++; continue; }
          if (ch === '') { const n = s.notes?.[at.fn]; if (n) { notes.push(n.text); const k = notes.length; inner += `<sup><a epub:type="noteref" href="#fn${k}" id="fr${k}">${k}</a></sup>`; } i++; continue; }
          let j = i + 1; while (j < b && s.ca[j] === s.ca[i] && !'￼'.includes(s.text[j])) j++;
          const t = xml(s.text.slice(i, j).replace(//g, '').replace(/­/g, '')).replace(/\u2028/g, '<br/>').replace(/\t/g, ' ');
          const ce = M.charEff(d, pe, at), sty = [];
          if (ce.font !== pe.font) sty.push(`font-family:${fam(ce.font)}`); if (ce.weight !== pe.weight) sty.push(`font-weight:${ce.weight}`); if (!!ce.italic !== !!pe.italic) sty.push(`font-style:${ce.italic ? 'italic' : 'normal'}`);
          if (ce.size !== pe.size) sty.push(`font-size:${+(ce.size / pe.size).toFixed(3)}em`); if (ce.color !== pe.color) sty.push(`color:${cssColor(ce.color)}`);
          if (ce.caps !== pe.caps) sty.push(ce.caps === 'all' ? 'text-transform:uppercase' : ce.caps === 'small' ? 'font-variant:small-caps' : 'text-transform:none');
          if (ce.under) sty.push('text-decoration:underline'); if (ce.strike) sty.push('text-decoration:line-through'); if (ce.shift) sty.push(`vertical-align:${+(ce.shift / ce.size).toFixed(2)}em`);
          inner += sty.length ? `<span style="${sty.join(';')}">${t}</span>` : t; i = j;
        }
        fontsUsed.add(pe.font);
        const lvl = headLevel(para.ps);
        if (lt) html += `<li class="${cssName(para.ps)}">${inner}</li>\n` + blocks;
        else if (lvl && inner.trim()) { const id = 'h' + (++hid); nav.push({ id, level: lvl, text: clean(s.text.slice(a, b)) }); html += `<h${Math.min(6, lvl)} id="${id}" class="${cssName(para.ps)}">${inner}</h${Math.min(6, lvl)}>\n` + blocks; }
        else if (inner.trim() || !blocks) html += `<p class="${cssName(para.ps)}">${inner || '<br/>'}</p>\n` + blocks;
        else html += blocks;
      }
      if (list) html += `</${list}>\n`;
      return html;
    }
    // reading order: pages in order; on each page items top-to-bottom, left-to-right; a story is emitted at its first frame
    let body = ''; const done = new Set();
    const tocSid = d.toc?.sid;
    for (let pi = 0; pi < d.pages.length; pi++) {
      const items = []; M.walkItems(d.pages[pi].items, it => { if (it.type !== 'group' && !it.hidden && S.eng.layerVisible(it)) items.push(it); });
      items.sort((p, q) => Math.round(p.y / 6) - Math.round(q.y / 6) || p.x - q.x);
      for (const it of items) {
        if (it.type === 'text') { const s = d.stories[it.story]; if (!s || done.has(s.id) || s.id === tocSid) continue; done.add(s.id); if (!s.text.trim()) continue; body += `<section>\n${await storyHtml(s)}</section>\n`; }
        else if (it.type === 'image' && it.img && Math.min(it.w, it.h) > 24) { const f = await imgFile(it.img); if (f) body += `<figure><img src="${f.name}" alt="${xml(f.alt)}"/></figure>\n`; }
        else if (it.type === 'table') body += tableHtml(it) + '\n';
      }
    }
    if (notes.length) body += `<section epub:type="footnotes">\n${notes.map((t, k) => `<aside epub:type="footnote" class="fn" id="fn${k + 1}"><p><a href="#fr${k + 1}">${k + 1}</a> ${xml(t)}</p></aside>`).join('\n')}\n</section>\n`;
    const title = xml(opt.title || S.name || 'Untitled');
    const page = (t, b, extra = '') => `<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en" xml:lang="en">\n<head><meta charset="utf-8"/><title>${t}</title><link rel="stylesheet" type="text/css" href="style.css"/>${extra}</head>\n<body>\n${b}</body>\n</html>\n`;
    // fonts
    const manifest = [], fontFaces = [];
    if (opt.fonts !== false) for (const f of fontsUsed) {
      const D = Fonts.FAMILIES[f]; if (!D) continue;
      for (const w of Object.keys(D.w).map(Number)) for (const it of [false, true]) {
        if (it && !D.it.includes(w)) continue;
        const key = Fonts.resolve(f, w, it), bytes = Fonts.bytesFor(key); if (!bytes) continue;
        const name = `fonts/${D.file}-${w}${it ? 'i' : ''}.ttf`;
        files.push({ name: 'OEBPS/' + name, data: new Uint8Array(bytes) }); manifest.push(`<item id="f${manifest.length}" href="${name}" media-type="font/ttf"/>`);
        fontFaces.push(`@font-face{font-family:"${f}";font-weight:${w};font-style:${it ? 'italic' : 'normal'};src:url(${name})}`);
      }
    }
    css = fontFaces.join('\n') + '\n' + css;
    let coverItem = '', coverSpine = '';
    if (opt.cover !== false && d.pages.length) {
      const c = await IO.renderPageCanvas(0, 110, false);
      const bytes = new Uint8Array(await (await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85))).arrayBuffer());
      files.push({ name: 'OEBPS/images/cover.jpg', data: bytes });
      files.push({ name: 'OEBPS/cover.xhtml', data: enc.encode(page(title, `<div class="cover"><img src="images/cover.jpg" alt="${title}"/></div>\n`)) });
      coverItem = `<item id="cover-image" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/><item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>`;
      coverSpine = '<itemref idref="cover" linear="no"/>';
    }
    const navHtml = `<nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${(nav.length ? nav : [{ id: 'top', level: 1, text: opt.title || S.name }]).map(n => `<li><a href="content.xhtml#${n.id}">${xml(n.text)}</a></li>`).join('')}</ol></nav>\n`;
    files.push({ name: 'OEBPS/nav.xhtml', data: enc.encode(page('Contents', navHtml)) });
    files.push({ name: 'OEBPS/content.xhtml', data: enc.encode(page(title, `<div id="top"></div>\n${body}`)) });
    files.push({ name: 'OEBPS/style.css', data: enc.encode(css) });
    for (const f of images.values()) manifest.push(`<item id="i${manifest.length}" href="${f.name}" media-type="${f.mime}"/>`);
    const uid = 'urn:uuid:' + (crypto.randomUUID ? crypto.randomUUID() : M.uid() + M.uid());
    const opf = `<?xml version="1.0" encoding="utf-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">\n<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n<dc:identifier id="uid">${uid}</dc:identifier>\n<dc:title>${title}</dc:title>\n<dc:language>en</dc:language>\n${opt.author ? `<dc:creator>${xml(opt.author)}</dc:creator>\n` : ''}<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>\n<meta name="generator" content="Lumen Layout"/>\n</metadata>\n<manifest>\n<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n<item id="content" href="content.xhtml" media-type="application/xhtml+xml"/>\n<item id="css" href="style.css" media-type="text/css"/>\n${coverItem}\n${manifest.join('\n')}\n</manifest>\n<spine>\n${coverSpine}<itemref idref="content"/>\n</spine>\n</package>\n`;
    const container = `<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n`;
    return IO.zip([{ name: 'mimetype', data: enc.encode('application/epub+zip') }, { name: 'META-INF/container.xml', data: enc.encode(container) }, { name: 'OEBPS/content.opf', data: enc.encode(opf) }, ...files]);
  }
  return { sectionDialog, tocDialog, updateToc, generate, collect, collectIn, headingStyles, epubDialog, buildEpub };
})();
