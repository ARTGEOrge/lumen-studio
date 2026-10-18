'use strict';
/* Lumen Write — document model.
   The editor holds the flow as clean HTML; every file format goes through an intermediate AST:
     doc  = { page, header, footer, hfFirst, styles:{para,char}, notes:{id:text}, comments:{id:{author,date,text}},
              meta:{title,author}, assets:{id:{mime,data:Uint8Array,w,h}}, blocks:[Block] }
     Block = {t:'p', style, align?, ind?, fi?, list?:{kind:'ul'|'ol', level, fmt?}, runs:[Run]}
           | {t:'table', rows:[{h?, cells:[{blocks, cs?, rs?, bg?, w?}]}], widths?:[pct]} | {t:'pagebreak'} | {t:'toc'} | {t:'hr'}
     Run  = {t:'text', text, b?,i?,u?,s?,sup?,sub?, color?, bg?, font?, size?(pt), cs?, link?, ins?:{au,dt}, del?:{au,dt}, cm?:[ids]}
          | {t:'br'} | {t:'tab'} | {t:'img', asset, w?, h? (pt), wrap:'inline'|'left'|'right'|'center', alt} | {t:'fn', id}
   astToHtml is pure (also used by the Node tests); htmlToAst needs a DOM. */
(function (root) {
  const PAGE_SIZES = { A4: [595.28, 841.89], Letter: [612, 792], Legal: [612, 1008], A5: [419.53, 595.28], Executive: [522, 756] };
  const LIST_FMTS = { ul: ['disc', 'circle', 'square'], ol: ['decimal', 'lower-alpha', 'lower-roman', 'upper-alpha', 'upper-roman'] };

  function defaultStyles() {
    return {
      para: {
        Normal: { name: 'Normal', font: 'Source Serif 4', size: 11, color: '#1f2328', lh: 1.35, sb: 0, sa: 8 },
        Title: { name: 'Title', font: 'Montserrat', size: 28, b: true, color: '#16324f', lh: 1.1, sb: 0, sa: 6, next: 'Normal' },
        Subtitle: { name: 'Subtitle', font: 'Montserrat', size: 13, color: '#5b6b7c', lh: 1.25, sb: 0, sa: 16, next: 'Normal' },
        Heading1: { name: 'Heading 1', font: 'Montserrat', size: 17, b: true, color: '#1f4e79', lh: 1.2, sb: 18, sa: 6, keep: true, next: 'Normal' },
        Heading2: { name: 'Heading 2', font: 'Montserrat', size: 13.5, b: true, color: '#2e74b5', lh: 1.2, sb: 14, sa: 4, keep: true, next: 'Normal' },
        Heading3: { name: 'Heading 3', font: 'Montserrat', size: 11.5, b: true, color: '#1f4e79', lh: 1.2, sb: 12, sa: 3, keep: true, next: 'Normal' },
        Heading4: { name: 'Heading 4', font: 'Source Serif 4', size: 11, b: true, i: true, color: '#1f4e79', lh: 1.25, sb: 10, sa: 2, keep: true, next: 'Normal' },
        Heading5: { name: 'Heading 5', font: 'Liberation Sans', size: 10.5, b: true, color: '#2e74b5', lh: 1.25, sb: 8, sa: 2, keep: true, next: 'Normal' },
        Heading6: { name: 'Heading 6', font: 'Liberation Sans', size: 10, i: true, color: '#5b6b7c', lh: 1.25, sb: 8, sa: 2, keep: true, next: 'Normal' },
        Quote: { name: 'Quote', font: 'Source Serif 4', size: 11.5, i: true, color: '#44546a', lh: 1.4, sb: 6, sa: 12, ind: 24, bar: '#2e74b5' },
        Caption: { name: 'Caption', font: 'Liberation Sans', size: 8.5, i: true, color: '#5b6b7c', lh: 1.25, sb: 2, sa: 10, align: 'center' },
        Code: { name: 'Code', font: 'DejaVu Sans Mono', size: 9, color: '#24292f', lh: 1.35, sb: 0, sa: 8, bg: '#f2f4f7' },
      },
      char: {
        Emphasis: { name: 'Emphasis', i: true },
        Strong: { name: 'Strong', b: true },
        InlineCode: { name: 'Inline Code', font: 'DejaVu Sans Mono', size: 9.5, bg: '#eef1f5', color: '#9a2d59' },
        Subtle: { name: 'Subtle Emphasis', i: true, color: '#5b6b7c' },
        SmallCaps: { name: 'Small Caps', caps: true },
      },
    };
  }
  function newDoc() {
    return {
      page: { size: 'A4', w: PAGE_SIZES.A4[0], h: PAGE_SIZES.A4[1], mt: 72, mb: 72, ml: 72, mr: 72, hd: 36, fd: 36, start: 1 },
      header: { l: '', c: '', r: '' }, footer: { l: '', c: '{page}', r: '' }, hfFirst: false,
      styles: defaultStyles(), notes: {}, comments: {}, meta: { title: '', author: '' }, assets: {},
      blocks: [{ t: 'p', style: 'Normal', runs: [] }],
    };
  }
  const HEADING = /^Heading([1-6])$/;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const num = v => Math.round(v * 100) / 100;
  const safeColor = c => /^#[0-9a-f]{3,8}$/i.test(c || '') ? c : null;
  const safeHref = h => { h = String(h || '').trim(); return /^(https?:|mailto:|#)/i.test(h) ? h : null; };

  /* ---------------- styles -> CSS ---------------- */
  function styleCss(st, sel, ptPx) {
    const p = [];
    if (st.font) p.push(`font-family:${root.Fonts ? Fonts.css(st.font) : `"${st.font}"`}`);
    if (st.size) p.push(`font-size:${num(st.size)}pt`);
    if (st.b != null) p.push(`font-weight:${st.b ? 700 : 400}`);
    if (st.i != null) p.push(`font-style:${st.i ? 'italic' : 'normal'}`);
    if (st.color) p.push(`color:${st.color}`);
    if (st.u) p.push('text-decoration:underline');
    if (st.caps) p.push('font-variant:small-caps');
    if (st.bg) p.push(`background:${st.bg}`);
    if (st.lh) p.push(`line-height:${st.lh}`);
    if (st.sb != null) p.push(`margin-top:${num(st.sb)}pt`);
    if (st.sa != null) p.push(`margin-bottom:${num(st.sa)}pt`);
    if (st.align) p.push(`text-align:${st.align}`);
    if (st.ind) p.push(`margin-left:${num(st.ind)}pt`);
    if (st.fi) p.push(`text-indent:${num(st.fi)}pt`);
    if (st.bar) p.push(`border-left:3pt solid ${st.bar};padding-left:9pt`);
    if (st.bg && !st.bar) p.push('padding:2pt 5pt');
    return `${sel}{${p.join(';')}}`;
  }
  function stylesCss(styles, scope = '#ed') {
    const out = [];
    const N = styles.para.Normal || {};
    out.push(styleCss(N, `${scope}`));
    out.push(`${scope} p,${scope} h1,${scope} h2,${scope} h3,${scope} h4,${scope} h5,${scope} h6{margin:0 0 ${num(N.sa ?? 8)}pt}`);
    out.push(`${scope} ul,${scope} ol{margin:0 0 ${num(N.sa ?? 8)}pt}`);
    for (const [id, st] of Object.entries(styles.para)) {
      if (id === 'Normal') continue;
      const m = HEADING.exec(id);
      const sel = (m ? `${scope} h${m[1]},` : '') + `${scope} [data-s="${id}"]`;
      out.push(styleCss(st, sel));
    }
    for (const [id, st] of Object.entries(styles.char)) out.push(styleCss({ ...st, sb: null, sa: null, lh: null }, `${scope} [data-cs="${id}"]`));
    return out.join('\n');
  }

  /* ---------------- AST -> HTML (pure) ---------------- */
  function runInner(r, o) {
    if (r.t === 'br') return '<br>';
    if (r.t === 'tab') return '<span class="tab">\t</span>';
    if (r.t === 'fn') return `<sup class="fn" contenteditable="false" data-fn="${esc(r.id)}">*</sup>`;
    if (r.t === 'img') {
      const src = o.src ? o.src(r.asset) : '';
      const st = [r.w ? `width:${num(r.w)}pt` : '', r.h ? `height:${num(r.h)}pt` : ''].filter(Boolean).join(';');
      return `<img data-a="${esc(r.asset)}" src="${esc(src || '')}" alt="${esc(r.alt || '')}"${r.wrap && r.wrap !== 'inline' ? ` data-wrap="${esc(r.wrap)}"` : ''}${st ? ` style="${st}"` : ''}>`;
    }
    let h = esc(r.text || '');
    if (r.sup) h = `<sup>${h}</sup>`; if (r.sub) h = `<sub>${h}</sub>`;
    if (r.s) h = `<s>${h}</s>`; if (r.u) h = `<u>${h}</u>`; if (r.i) h = `<i>${h}</i>`; if (r.b) h = `<b>${h}</b>`;
    const st = [];
    if (safeColor(r.color)) st.push(`color:${r.color}`);
    if (safeColor(r.bg)) st.push(`background-color:${r.bg}`);
    if (r.font) st.push(`font-family:${esc(root.Fonts ? Fonts.css(r.font) : `"${r.font}"`).replace(/&quot;/g, "'")}`);
    if (r.size) st.push(`font-size:${num(r.size)}pt`);
    if (st.length || r.cs) h = `<span${r.cs ? ` data-cs="${esc(r.cs)}"` : ''}${st.length ? ` data-f="1" style="${st.join(';')}"` : ''}>${h}</span>`;
    return h;
  }
  const chgKey = c => c ? `${c.au || ''}|${c.dt || ''}` : '';
  function runsHtml(runs, o) {
    // group consecutive runs that share the same link / change / comment wrapper
    let out = '', i = 0;
    while (i < runs.length) {
      const r = runs[i];
      const key = [r.link || '', r.ins ? 'i' + chgKey(r.ins) : '', r.del ? 'd' + chgKey(r.del) : '', (r.cm || []).join(' ')].join('\u0001');
      let inner = '', j = i;
      while (j < runs.length) {
        const q = runs[j];
        const k2 = [q.link || '', q.ins ? 'i' + chgKey(q.ins) : '', q.del ? 'd' + chgKey(q.del) : '', (q.cm || []).join(' ')].join('\u0001');
        if (k2 !== key) break;
        inner += runInner(q, o); j++;
      }
      if (r.cm && r.cm.length) inner = `<span class="cm" data-c="${esc(r.cm.join(' '))}">${inner}</span>`;
      if (r.del) inner = `<del data-au="${esc(r.del.au || '')}" data-dt="${esc(r.del.dt || '')}">${inner}</del>`;
      if (r.ins) inner = `<ins data-au="${esc(r.ins.au || '')}" data-dt="${esc(r.ins.dt || '')}">${inner}</ins>`;
      const href = safeHref(r.link); if (href) inner = `<a href="${esc(href)}">${inner}</a>`;
      out += inner; i = j;
    }
    return out || '<br>';
  }
  function paraAttrs(b) {
    const st = [];
    if (b.align && b.align !== 'left') st.push(`text-align:${b.align}`);
    if (b.ind) st.push(`margin-left:${num(b.ind)}pt`);
    if (b.fi) st.push(`text-indent:${num(b.fi)}pt`);
    return st.length ? ` style="${st.join(';')}"` : '';
  }
  function paraHtml(b, o) {
    const m = HEADING.exec(b.style || '');
    const tag = m && !b.list ? 'h' + m[1] : 'p';
    const ds = b.style && b.style !== 'Normal' && !(m && !b.list) ? ` data-s="${esc(b.style)}"` : '';
    return `<${tag}${ds}${paraAttrs(b)}>${runsHtml(b.runs || [], o)}</${tag}>`;
  }
  function blocksHtml(blocks, o) {
    let h = '', i = 0;
    while (i < blocks.length) {
      const b = blocks[i];
      if (b.t === 'p' && b.list) { // gather a run of list paragraphs
        let j = i; while (j < blocks.length && blocks[j].t === 'p' && blocks[j].list) j++;
        h += listHtml(blocks.slice(i, j), o); i = j; continue;
      }
      if (b.t === 'p') h += paraHtml(b, o);
      else if (b.t === 'pagebreak') h += '<div class="pbreak" contenteditable="false"></div>';
      else if (b.t === 'toc') h += '<div class="toc" contenteditable="false" data-toc="1"></div>';
      else if (b.t === 'hr') h += '<hr>';
      else if (b.t === 'table') h += tableHtml(b, o);
      i++;
    }
    return h;
  }
  function listTag(it) { const k = it.list.kind === 'ol' ? 'ol' : 'ul'; const fmt = it.list.fmt; const lst = fmt && LIST_FMTS[k].includes(fmt) ? fmt : null; return { k, open: `<${k}${lst ? ` style="list-style-type:${lst}"` : ''}>` }; }
  function listHtml(items, o) {
    // nested lists: a deeper item opens a sub list inside the current <li>
    let h = '';
    const stack = []; // {k, sig, level}
    const top = () => stack[stack.length - 1];
    for (const it of items) {
      const lv = Math.max(0, Math.min(8, it.list.level | 0));
      const { k, open } = listTag(it);
      while (stack.length && top().level > lv) h += `</li></${stack.pop().k}>`;
      if (stack.length && top().level === lv) { if (top().sig !== open) h += `</li></${stack.pop().k}>`; else h += '</li>'; }
      while (!stack.length || top().level < lv) {
        const L = stack.length ? top().level + 1 : 0;
        const sig = L === lv ? open : `<${k}>`;
        h += sig; stack.push({ k, sig, level: L });
        if (L < lv) h += '<li class="nest">';
      }
      const ds = it.style && it.style !== 'Normal' ? ` data-s="${esc(it.style)}"` : '';
      h += `<li${ds}${paraAttrs({ ...it, ind: 0 })}>${runsHtml(it.runs || [], o)}`;
    }
    while (stack.length) h += `</li></${stack.pop().k}>`;
    return h;
  }
  function tableHtml(b, o) {
    let h = `<table${b.widths ? ` data-w="${b.widths.map(num).join(',')}"` : ''}>`;
    if (b.widths) h += `<colgroup>${b.widths.map(w => `<col style="width:${num(w)}%">`).join('')}</colgroup>`;
    h += '<tbody>';
    for (const r of b.rows) {
      h += `<tr${r.h ? ' data-h="1"' : ''}>`;
      for (const c of r.cells) {
        const st = [safeColor(c.bg) ? `background-color:${c.bg}` : ''].filter(Boolean).join(';');
        h += `<td${c.cs > 1 ? ` colspan="${c.cs | 0}"` : ''}${c.rs > 1 ? ` rowspan="${c.rs | 0}"` : ''}${st ? ` style="${st}"` : ''}>${blocksHtml(c.blocks && c.blocks.length ? c.blocks : [{ t: 'p', style: 'Normal', runs: [] }], o)}</td>`;
      }
      h += '</tr>';
    }
    return h + '</tbody></table>';
  }
  function astToHtml(doc, o = {}) { return blocksHtml(doc.blocks || [], o); }

  /* ---------------- HTML -> AST (DOM) ---------------- */
  const BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'PRE', 'BLOCKQUOTE', 'DIV', 'UL', 'OL', 'LI', 'TABLE', 'HR', 'FIGURE', 'FIGCAPTION', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'DL', 'DT', 'DD', 'ADDRESS', 'CENTER', 'BODY', 'THEAD', 'TBODY', 'TR', 'TD', 'TH']);
  function toHex(c) {
    if (!c) return null; c = String(c).trim();
    if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map(x => x + x).join('').toLowerCase();
    const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+))?/i.exec(c);
    if (m) { if (m[4] != null && +m[4] === 0) return null; return '#' + [m[1], m[2], m[3]].map(v => (+v).toString(16).padStart(2, '0')).join(''); }
    const named = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080', navy: '#000080', teal: '#008080', maroon: '#800000' };
    return named[c.toLowerCase()] || null;
  }
  function lenPt(v, base = 11) {
    if (!v) return null; const m = /^(-?[\d.]+)\s*(px|pt|em|rem|cm|mm|in|%)?$/i.exec(String(v).trim()); if (!m) return null;
    const n = +m[1], u = (m[2] || 'px').toLowerCase();
    return u === 'pt' ? n : u === 'px' ? n * 0.75 : u === 'em' || u === 'rem' ? n * base : u === 'cm' ? n * 72 / 2.54 : u === 'mm' ? n * 72 / 25.4 : u === 'in' ? n * 72 : u === '%' ? n / 100 * base : null;
  }
  function htmlToAst(container, o = {}) {
    const collapse = !!o.collapse, blocks = [];
    const isGap = n => n.nodeType === 1 && n.classList && n.classList.contains('pg-gap');
    const newPara = (extra) => ({ t: 'p', style: 'Normal', runs: [], ...extra });
    let cur = null; // implicit paragraph for stray inline content
    const flush = () => { if (cur) { finishPara(cur); if (cur.runs.length || !cur._implicit) blocks.push(cur); cur = null; } };
    function finishPara(p) {
      // trim collapsed whitespace at paragraph edges and merge adjacent compatible text runs
      if (collapse) {
        const f = p.runs.find(r => r.t === 'text'); if (f && p.runs[0] === f) f.text = f.text.replace(/^\s+/, '');
        const l = [...p.runs].reverse().find(r => r.t === 'text'); if (l && p.runs[p.runs.length - 1] === l) l.text = l.text.replace(/\s+$/, '');
        // drop a trailing <br> that only exists to give an empty paragraph height
      }
      if (p.runs.length && p.runs[p.runs.length - 1].t === 'br') p.runs.pop();
      const out = [];
      for (const r of p.runs) {
        if (r.t === 'text' && !r.text) continue;
        const prev = out[out.length - 1];
        if (prev && prev.t === 'text' && r.t === 'text' && sameFmt(prev, r)) prev.text += r.text; else out.push(r);
      }
      p.runs = out; delete p._implicit; delete p._srcEl;
    }
    function paraFromEl(el, extra) {
      const p = newPara(extra);
      const ds = el.getAttribute && el.getAttribute('data-s');
      const m = /^H([1-6])$/.exec(el.nodeName);
      if (ds && (o.styles ? o.styles.para[ds] : true)) p.style = ds; else if (m) p.style = 'Heading' + m[1];
      const al = (el.style && el.style.textAlign) || (el.getAttribute && el.getAttribute('align')) || '';
      if (/^(center|right|justify)$/i.test(al)) p.align = al.toLowerCase();
      const ind = el.style && lenPt(el.style.marginLeft); if (ind && ind > 0 && el.nodeName !== 'LI') p.ind = Math.round(ind * 10) / 10;
      const fi = el.style && lenPt(el.style.textIndent); if (fi) p.fi = Math.round(fi * 10) / 10;
      if (el.hasAttribute && el.hasAttribute('data-selmark')) p.sel = true;
      return p;
    }
    function inline(node, fmt, p) {
      if (node.nodeType === 3) {
        let t = node.nodeValue;
        if (collapse) t = t.replace(/[\s ]+/g, m => m.includes(' ') && !/[ \t\r\n]/.test(m) ? m : ' ');
        if (!t) return;
        const parts = collapse || fmt.pre === false ? [t] : t.split('\n');
        parts.forEach((s, k) => { if (k) p.runs.push({ t: 'br' }); if (s) pushText(p, s, fmt); });
        return;
      }
      if (node.nodeType !== 1 || isGap(node)) return;
      const n = node.nodeName, f = { ...fmt };
      if (n === 'BR') { p.runs.push(wrapRun({ t: 'br' }, f)); return; }
      if (n === 'IMG') {
        let id = node.getAttribute('data-a');
        if (!id || (o.hasAsset && !o.hasAsset(id))) id = o.asset ? o.asset(node.getAttribute('src') || '') : null;
        if (!id) { const alt = node.getAttribute('alt'); if (alt) pushText(p, `[${alt}]`, f); return; }
        const r = { t: 'img', asset: id, alt: node.getAttribute('alt') || '', wrap: 'inline' };
        const wr = node.getAttribute('data-wrap'); if (/^(left|right|center)$/.test(wr || '')) r.wrap = wr;
        const w = lenPt(node.style.width) || (node.getAttribute('width') ? +node.getAttribute('width') * 0.75 : null);
        const h = lenPt(node.style.height) || (node.getAttribute('height') ? +node.getAttribute('height') * 0.75 : null);
        if (w) r.w = Math.round(w * 10) / 10; if (h) r.h = Math.round(h * 10) / 10;
        p.runs.push(wrapRun(r, f)); return;
      }
      if (n === 'SUP' && node.classList.contains('fn')) { const id = node.getAttribute('data-fn'); if (id) p.runs.push(wrapRun({ t: 'fn', id }, f)); return; }
      if (n === 'SPAN' && node.classList.contains('tab')) { p.runs.push(wrapRun({ t: 'tab' }, f)); return; }
      if (n === 'SCRIPT' || n === 'STYLE' || n === 'TEMPLATE' || n === 'TITLE' || n === 'META' || n === 'LINK') return;
      if (n === 'B' || n === 'STRONG') f.b = true;
      else if (n === 'I' || n === 'EM' || n === 'CITE' || n === 'VAR' || n === 'DFN') f.i = true;
      else if (n === 'U') f.u = true;
      else if (n === 'S' || n === 'STRIKE') f.s = true;
      else if (n === 'SUP') { f.sup = true; f.sub = false; } else if (n === 'SUB') { f.sub = true; f.sup = false; }
      else if (n === 'CODE' || n === 'KBD' || n === 'TT' || n === 'SAMP') f.cs = 'InlineCode';
      else if (n === 'MARK') f.bg = '#fff59d';
      else if (n === 'A') { const href = safeHref(node.getAttribute('href')); if (href) f.link = href; }
      else if (n === 'INS') { if (node.hasAttribute('data-au')) f.ins = { au: node.getAttribute('data-au') || '', dt: node.getAttribute('data-dt') || '' }; else f.u = true; }
      else if (n === 'DEL') { if (node.hasAttribute('data-au')) f.del = { au: node.getAttribute('data-au') || '', dt: node.getAttribute('data-dt') || '' }; else f.s = true; }
      if (n === 'SPAN' && node.classList.contains('cm')) f.cm = [...(f.cm || []), ...String(node.getAttribute('data-c') || '').split(/\s+/).filter(Boolean)];
      const cs = node.getAttribute('data-cs'); if (cs && (!o.styles || o.styles.char[cs])) f.cs = cs;
      const st = node.style;
      if (st) {
        const c = toHex(st.color || node.getAttribute('color')); if (c) f.color = c;
        const bg = toHex(st.backgroundColor); if (bg && bg !== '#ffffff') f.bg = bg;
        const ff = st.fontFamily || node.getAttribute('face'); if (ff) f.font = root.Fonts ? Fonts.map(ff) : ff.split(',')[0].replace(/["']/g, '').trim();
        const fs = lenPt(st.fontSize); if (fs && fs > 3 && fs < 200) f.size = Math.round(fs * 2) / 2;
        const fw = st.fontWeight; if (fw === 'bold' || +fw >= 600) f.b = true; else if (fw === 'normal' || (+fw && +fw < 600)) f.b = false;
        if (st.fontStyle === 'italic') f.i = true; else if (st.fontStyle === 'normal') f.i = false;
        const td = st.textDecorationLine || st.textDecoration || '';
        if (/underline/.test(td)) f.u = true; if (/line-through/.test(td)) f.s = true;
        if (st.verticalAlign === 'super') f.sup = true; if (st.verticalAlign === 'sub') f.sub = true;
      }
      for (const ch of [...node.childNodes]) {
        if (ch.nodeType === 1 && BLOCKS.has(ch.nodeName) && !isGap(ch)) { o._nested && o._nested(ch); continue; }
        inline(ch, f, p);
      }
    }
    function wrapRun(r, f) { if (f.link) r.link = f.link; if (f.ins) r.ins = f.ins; if (f.del) r.del = f.del; if (f.cm && f.cm.length) r.cm = [...new Set(f.cm)]; return r; }
    function pushText(p, s, f) {
      const r = { t: 'text', text: s };
      for (const k of ['b', 'i', 'u', 's', 'sup', 'sub']) if (f[k]) r[k] = true;
      for (const k of ['color', 'bg', 'font', 'size', 'cs']) if (f[k] != null) r[k] = f[k];
      p.runs.push(wrapRun(r, f));
    }
    function containerBlocks(el, ctx, out) {
      const save = blocks.length;
      walkBlocks(el.childNodes, ctx);
      flush();
      return blocks.splice(save);
    }
    function walkBlocks(nodes, ctx) {
      for (const node of [...nodes]) block(node, ctx);
    }
    function block(node, ctx) {
      if (node.nodeType === 3) { if (!collapse || node.nodeValue.trim()) { if (!cur) cur = newPara({ _implicit: true, ...(ctx.style ? { style: ctx.style } : {}) }); inline(node, ctx.fmt || {}, cur); } return; }
      if (node.nodeType !== 1 || isGap(node)) return;
      const n = node.nodeName;
      if (!BLOCKS.has(n)) { if (!cur) cur = newPara({ _implicit: true, ...(ctx.style ? { style: ctx.style } : {}) }); inline(node, ctx.fmt || {}, cur); return; }
      flush();
      if (n === 'DIV' && node.classList.contains('pbreak')) { blocks.push({ t: 'pagebreak' }); return; }
      if (n === 'DIV' && node.classList.contains('toc')) { blocks.push({ t: 'toc' }); return; }
      if (n === 'HR') { blocks.push({ t: 'hr' }); return; }
      if (n === 'TABLE') { blocks.push(tableFrom(node, ctx)); return; }
      if (n === 'UL' || n === 'OL') { listFrom(node, ctx, 0); return; }
      if (n === 'LI') { listItem(node, ctx, { kind: 'ul', level: 0 }); return; }
      if (n === 'BLOCKQUOTE') { walkBlocks(node.childNodes, { ...ctx, style: 'Quote' }); flush(); return; }
      if (n === 'FIGCAPTION') { const p = paraFromEl(node, { style: 'Caption' }); p.style = 'Caption'; paraContent(node, p, ctx); return; }
      if (n === 'PRE') { const p = paraFromEl(node, { style: 'Code' }); p.style = node.getAttribute('data-s') || 'Code'; paraContent(node, p, { ...ctx, pre: true }); return; }
      if (n === 'P' || /^H[1-6]$/.test(n) || n === 'DT' || n === 'ADDRESS') {
        const p = paraFromEl(node); if (ctx.style && p.style === 'Normal') p.style = ctx.style;
        paraContent(node, p, ctx); return;
      }
      if (n === 'DD') { walkBlocks(node.childNodes, { ...ctx }); flush(); return; }
      if (n === 'CENTER') { const save = blocks.length; walkBlocks(node.childNodes, ctx); flush(); for (let k = save; k < blocks.length; k++) if (blocks[k].t === 'p') blocks[k].align = 'center'; return; }
      // generic containers (div, section, figure, td handled elsewhere): paragraphs inside
      if (n === 'DIV' && ![...node.childNodes].some(c => c.nodeType === 1 && BLOCKS.has(c.nodeName) && !isGap(c))) { const p = paraFromEl(node); if (ctx.style && p.style === 'Normal') p.style = ctx.style; paraContent(node, p, ctx); return; }
      walkBlocks(node.childNodes, ctx); flush();
    }
    function paraContent(el, p, ctx) {
      const nested = [];
      const prev = o._nested; o._nested = ch => nested.push(ch);
      inline(el, { ...(ctx.fmt || {}), pre: ctx.pre }, p);
      o._nested = prev;
      finishPara(p); blocks.push(p);
      for (const ch of nested) block(ch, ctx);
      flush();
    }
    function listFrom(el, ctx, level) {
      const kind = el.nodeName === 'OL' ? 'ol' : 'ul';
      let fmt = el.style && el.style.listStyleType || (el.getAttribute('type') ? ({ a: 'lower-alpha', A: 'upper-alpha', i: 'lower-roman', I: 'upper-roman', 1: 'decimal' })[el.getAttribute('type')] : '');
      const L = { kind, level: Math.min(level, 8) }; if (fmt && LIST_FMTS[kind].includes(fmt)) L.fmt = fmt;
      for (const ch of [...el.childNodes]) {
        if (ch.nodeType === 1 && ch.nodeName === 'LI') listItem(ch, ctx, L);
        else if (ch.nodeType === 1 && (ch.nodeName === 'UL' || ch.nodeName === 'OL')) listFrom(ch, ctx, level + 1);
        else if (ch.nodeType === 1 && !isGap(ch)) { const p = newPara({ list: { ...L } }); inline(ch, ctx.fmt || {}, p); finishPara(p); if (p.runs.length) blocks.push(p); }
      }
    }
    function listItem(li, ctx, L) {
      const p = paraFromEl(li, { list: { ...L } }); delete p.ind;
      const sub = [];
      let used = false;
      const nestedEl = [];
      for (const ch of [...li.childNodes]) {
        if (ch.nodeType === 1 && (ch.nodeName === 'UL' || ch.nodeName === 'OL')) { nestedEl.push(ch); continue; }
        if (ch.nodeType === 1 && BLOCKS.has(ch.nodeName) && !isGap(ch)) {
          if (!used && (ch.nodeName === 'P' || ch.nodeName === 'DIV' || /^H[1-6]$/.test(ch.nodeName))) { inline(ch, ctx.fmt || {}, p); used = true; }
          else nestedEl.push(ch);
          continue;
        }
        if (nestedEl.length) { nestedEl.push(ch); continue; }
        inline(ch, ctx.fmt || {}, p);
      }
      const skip = li.classList && li.classList.contains('nest') && !p.runs.some(r => r.t !== 'br' && (r.t !== 'text' || r.text.trim()));
      finishPara(p); if (!skip) blocks.push(p);
      for (const ch of nestedEl) {
        if (ch.nodeName === 'UL' || ch.nodeName === 'OL') listFrom(ch, ctx, L.level + 1);
        else if (ch.nodeType === 1) { const q = paraFromEl(ch, { list: { ...L, level: L.level } }); inline(ch, ctx.fmt || {}, q); finishPara(q); blocks.push(q); }
      }
    }
    function tableFrom(tbl, ctx) {
      const rows = [];
      const trs = [...tbl.querySelectorAll('tr')].filter(tr => tr.closest('table') === tbl && !isGap(tr));
      for (const tr of trs) {
        const cells = [];
        for (const td of [...tr.children]) {
          if (td.nodeName !== 'TD' && td.nodeName !== 'TH') continue;
          const save = blocks.length; const savedCur = cur; cur = null;
          walkBlocks(td.childNodes, { ...ctx, fmt: td.nodeName === 'TH' ? { b: true } : ctx.fmt, style: null }); flush();
          const cb = blocks.splice(save); cur = savedCur;
          const c = { blocks: cb.length ? cb : [newPara()] };
          if (td.colSpan > 1) c.cs = td.colSpan; if (td.rowSpan > 1) c.rs = td.rowSpan;
          const bg = toHex(td.style.backgroundColor || td.getAttribute('bgcolor')); if (bg && bg !== '#ffffff') c.bg = bg;
          cells.push(c);
        }
        if (!cells.length) continue;
        const r = { cells }; if (tr.getAttribute('data-h') || tr.parentNode.nodeName === 'THEAD' || [...tr.children].every(c => c.nodeName === 'TH')) r.h = true;
        rows.push(r);
      }
      const t = { t: 'table', rows: rows.length ? rows : [{ cells: [{ blocks: [newPara()] }] }] };
      const dw = tbl.getAttribute('data-w');
      if (dw) { const w = dw.split(',').map(Number).filter(x => x > 0); if (w.length) t.widths = w; }
      else { const cols = [...tbl.querySelectorAll('col')].map(c => parseFloat(c.style.width)).filter(x => x > 0); if (cols.length && /%/.test(tbl.querySelector('col').style.width)) t.widths = cols; }
      return t;
    }
    walkBlocks(container.childNodes, {});
    flush();
    if (!blocks.length) blocks.push(newPara());
    return blocks;
  }
  function sameFmt(a, b) {
    for (const k of ['b', 'i', 'u', 's', 'sup', 'sub', 'color', 'bg', 'font', 'size', 'cs', 'link']) if ((a[k] || null) !== (b[k] || null)) return false;
    if (chgKey(a.ins) !== chgKey(b.ins) || chgKey(a.del) !== chgKey(b.del) || !!a.ins !== !!b.ins || !!a.del !== !!b.del) return false;
    return (a.cm || []).join(' ') === (b.cm || []).join(' ');
  }
  // plain text of runs (deleted text excluded unless keepDel)
  function runsText(runs, keepDel) { return (runs || []).map(r => r.t === 'text' ? (r.del && !keepDel ? '' : r.text) : r.t === 'br' ? '\n' : r.t === 'tab' ? '\t' : '').join(''); }
  // iterate every paragraph in a doc (including table cells)
  function eachPara(blocks, fn) { for (const b of blocks) { if (b.t === 'p') fn(b); else if (b.t === 'table') for (const r of b.rows) for (const c of r.cells) eachPara(c.blocks, fn); } }
  function fmtNumber(n, fmt) {
    if (fmt === 'lower-alpha' || fmt === 'upper-alpha') { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + n % 26) + s; n = Math.floor(n / 26); } return fmt === 'upper-alpha' ? s.toUpperCase() : s; }
    if (fmt === 'lower-roman' || fmt === 'upper-roman') { const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v; } return fmt === 'upper-roman' ? s.toUpperCase() : s; }
    return String(n);
  }
  const defaultListFmt = (kind, level) => LIST_FMTS[kind][level % (kind === 'ul' ? 3 : 3)];

  const Model = { PAGE_SIZES, LIST_FMTS, defaultStyles, newDoc, stylesCss, astToHtml, blocksHtml, htmlToAst, runsText, eachPara, toHex, lenPt, esc, fmtNumber, defaultListFmt, sameFmt, safeHref, HEADING };
  root.Model = Model;
  if (typeof module !== 'undefined') module.exports = Model;
})(typeof window !== 'undefined' ? window : globalThis);
