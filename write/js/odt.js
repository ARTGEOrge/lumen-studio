'use strict';
/* Lumen Write — OpenDocument Text (.odt) writer and reader (subset: styles, lists, tables, images,
   footnotes, comments, page setup, header/footer, page breaks, table of contents). Tracked changes are
   exported in their accepted form. Pure functions over the AST; zip via fflate. */
(function (root) {
  const NS = {
    office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0', style: 'urn:oasis:names:tc:opendocument:xmlns:style:1.0',
    text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0', table: 'urn:oasis:names:tc:opendocument:xmlns:table:1.0',
    draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0', fo: 'urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0',
    xlink: 'http://www.w3.org/1999/xlink', dc: 'http://purl.org/dc/elements/1.1/', meta: 'urn:oasis:names:tc:opendocument:xmlns:meta:1.0',
    svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  };
  const NSDECL = Object.entries(NS).map(([k, v]) => `xmlns:${k}="${v}"`).join(' ');
  const x = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const pt = v => `${Math.round(v * 100) / 100}pt`;
  const HEADING = /^Heading([1-6])$/;
  const odfName = id => { const m = HEADING.exec(id); return m ? `Heading_20_${m[1]}` : id === 'Normal' ? 'Standard' : id; };
  const NUMF = { decimal: '1', 'lower-alpha': 'a', 'upper-alpha': 'A', 'lower-roman': 'i', 'upper-roman': 'I' };
  const NUMF_R = Object.fromEntries(Object.entries(NUMF).map(([a, b]) => [b, a]));
  const BUL = ['•', '◦', '▪'];

  function textProps(st) {
    const p = [];
    if (st.font) p.push(`style:font-name="${x(st.font)}"`);
    if (st.size) p.push(`fo:font-size="${pt(st.size)}"`);
    if (st.b != null) p.push(`fo:font-weight="${st.b ? 'bold' : 'normal'}"`);
    if (st.i != null) p.push(`fo:font-style="${st.i ? 'italic' : 'normal'}"`);
    if (st.color) p.push(`fo:color="${x(st.color)}"`);
    if (st.u) p.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"');
    if (st.s) p.push('style:text-line-through-style="solid"');
    if (st.caps) p.push('fo:font-variant="small-caps"');
    if (st.bg) p.push(`fo:background-color="${x(st.bg)}"`);
    if (st.sup) p.push('style:text-position="super 58%"'); else if (st.sub) p.push('style:text-position="sub 58%"');
    return p.length ? `<style:text-properties ${p.join(' ')}/>` : '';
  }
  function paraProps(st, extra = '') {
    const p = [];
    if (st.sb != null) p.push(`fo:margin-top="${pt(st.sb)}"`);
    if (st.sa != null) p.push(`fo:margin-bottom="${pt(st.sa)}"`);
    if (st.lh) p.push(`fo:line-height="${Math.round(st.lh * 100)}%"`);
    if (st.align && st.align !== 'left') p.push(`fo:text-align="${st.align === 'right' ? 'end' : st.align}"`);
    if (st.ind) p.push(`fo:margin-left="${pt(st.ind)}"`);
    if (st.fi) p.push(`fo:text-indent="${pt(st.fi)}"`);
    if (st.bg) p.push(`fo:background-color="${x(st.bg)}" fo:padding="2pt"`);
    if (st.bar) p.push(`fo:border-left="3pt solid ${x(st.bar)}" fo:padding-left="9pt"`);
    if (st.keep) p.push('fo:keep-with-next="always"');
    if (extra) p.push(extra);
    return p.length ? `<style:paragraph-properties ${p.join(' ')}/>` : '';
  }

  function writeOdt(doc, opts = {}) {
    const fflate = opts.fflate || root.fflate;
    const files = {}; const pictures = {}; let picN = 0;
    const auto = { text: new Map(), para: new Map(), list: [], graphic: new Set(), table: [] };
    const contentW = doc.page.w - doc.page.ml - doc.page.mr;
    const fonts = new Set(['Liberation Sans']);
    Object.values(doc.styles.para).forEach(s => s.font && fonts.add(s.font));
    Object.values(doc.styles.char).forEach(s => s.font && fonts.add(s.font));
    function textStyle(r) {
      const st = { b: r.b || null, i: r.i || null, u: r.u, s: r.s, color: r.color, bg: r.bg, font: r.font, size: r.size, sup: r.sup, sub: r.sub };
      for (const k of Object.keys(st)) if (st[k] == null || st[k] === false) delete st[k];
      if (r.link && !r.color) { st.color = '#1f5faf'; st.u = true; }
      if (!Object.keys(st).length) return r.cs || null;
      if (st.font) fonts.add(st.font);
      const key = JSON.stringify([st, r.cs || '']);
      if (!auto.text.has(key)) auto.text.set(key, { name: 'T' + (auto.text.size + 1), st, parent: r.cs });
      return auto.text.get(key).name;
    }
    function paraStyle(b, extra) {
      const st = {}; if (b.align && b.align !== 'left') st.align = b.align; if (b.ind) st.ind = b.ind; if (b.fi) st.fi = b.fi;
      if (!Object.keys(st).length && !extra) return odfName(b.style || 'Normal');
      const key = JSON.stringify([b.style || 'Normal', st, extra || '']);
      if (!auto.para.has(key)) auto.para.set(key, { name: 'P' + (auto.para.size + 1), parent: odfName(b.style || 'Normal'), st, extra });
      return auto.para.get(key).name;
    }
    const spaces = t => x(t).replace(/\t/g, '<text:tab/>').replace(/ {2,}/g, m => ` <text:s text:c="${m.length - 1}"/>`).replace(/^ /, '<text:s/>');
    const cmOpen = new Set();
    function runsXml(runs) {
      let s = '';
      const live = runs.filter(r => !r.del);
      for (let i = 0; i < live.length; i++) {
        const r = live[i];
        // comments: annotation at the first run, annotation-end after the last
        for (const c of r.cm || []) if (!cmOpen.has(c) && doc.comments[c]) {
          cmOpen.add(c); const cm = doc.comments[c];
          s += `<office:annotation office:name="${x(c)}"><dc:creator>${x(cm.author || '')}</dc:creator><dc:date>${x(cm.date || '')}</dc:date>${String(cm.text || '').split('\n').map(l => `<text:p>${x(l)}</text:p>`).join('')}</office:annotation>`;
        }
        let inner = '';
        if (r.t === 'text') { const ts = textStyle(r); inner = ts ? `<text:span text:style-name="${x(ts)}">${spaces(r.text)}</text:span>` : spaces(r.text); }
        else if (r.t === 'br') inner = '<text:line-break/>';
        else if (r.t === 'tab') inner = '<text:tab/>';
        else if (r.t === 'fn') { const n = Object.keys(doc.notes).indexOf(r.id) + 1; inner = `<text:note text:id="ftn${n}" text:note-class="footnote"><text:note-citation>${n}</text:note-citation><text:note-body><text:p text:style-name="Footnote">${x(doc.notes[r.id] || '')}</text:p></text:note-body></text:note>`; }
        else if (r.t === 'img') inner = imageXml(r);
        if (r.link && r.t === 'text') inner = `<text:a xlink:type="simple" xlink:href="${x(r.link)}">${inner}</text:a>`;
        s += inner;
        for (const c of r.cm || []) {
          const later = live.slice(i + 1).some(q => (q.cm || []).includes(c));
          if (!later && cmOpen.has(c) && !opts._cmContinues?.(c)) { s += `<office:annotation-end office:name="${x(c)}"/>`; cmOpen.delete(c); }
        }
      }
      return s;
    }
    function imageXml(r) {
      const a = doc.assets[r.asset]; if (!a) return '';
      if (!pictures[r.asset]) { const ext = /png/.test(a.mime) ? 'png' : /jpe?g/.test(a.mime) ? 'jpg' : /gif/.test(a.mime) ? 'gif' : /svg/.test(a.mime) ? 'svg' : 'bin'; pictures[r.asset] = { path: `Pictures/img${++picN}.${ext}`, mime: a.mime }; files[pictures[r.asset].path] = a.data; }
      const w = r.w || 150, h = r.h || 100;
      const wrap = r.wrap || 'inline'; auto.graphic.add(wrap);
      return `<draw:frame draw:style-name="fr-${wrap}" draw:name="Image${picN}_${Math.random().toString(36).slice(2, 6)}" text:anchor-type="${wrap === 'inline' ? 'as-char' : 'paragraph'}" svg:width="${pt(w)}" svg:height="${pt(h)}" draw:z-index="0"><draw:image xlink:href="${pictures[r.asset].path}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>${r.alt ? `<svg:desc>${x(r.alt)}</svg:desc>` : ''}</draw:frame>`;
    }
    function paraXml(b) {
      const m = HEADING.exec(b.style || '');
      curPara++;
      const sn = paraStyle(b);
      if (m && !b.list) return `<text:h text:style-name="${x(sn)}" text:outline-level="${m[1]}">${runsXml(b.runs || [])}</text:h>`;
      return `<text:p text:style-name="${x(sn)}">${runsXml(b.runs || [])}</text:p>`;
    }
    function listXml(items) {
      const name = 'L' + (auto.list.length + 1);
      const levels = []; for (const p of items) if (!levels[p.list.level]) levels[p.list.level] = { kind: p.list.kind, fmt: p.list.fmt };
      auto.list.push({ name, levels });
      let s = `<text:list text:style-name="${name}">`; let depth = 0; let open = false;
      for (const it of items) {
        const lv = it.list.level | 0;
        if (open && lv <= depth) { s += '</text:list-item>'; open = false; }
        while (depth > lv) { s += '</text:list></text:list-item>'; depth--; }
        while (depth < lv) { if (!open) s += '<text:list-item>'; s += '<text:list>'; depth++; open = false; }
        s += `<text:list-item>${paraXml({ ...it, list: null })}`; open = true;
      }
      if (open) s += '</text:list-item>';
      while (depth > 0) { s += '</text:list></text:list-item>'; depth--; }
      return s + '</text:list>';
    }
    function tableXml(t) {
      const ncol = Math.max(1, ...t.rows.map(r => r.cells.reduce((a, c) => a + (c.cs || 1), 0)));
      const pct = t.widths && t.widths.length === ncol ? t.widths : Array(ncol).fill(100 / ncol);
      const total = pct.reduce((a, b) => a + b, 0) || 100;
      const name = 'Table' + (auto.table.length + 1);
      const cols = pct.map(p => contentW * p / total);
      const cellStyles = new Map();
      auto.table.push({ name, cols, cellStyles, width: contentW });
      const cellStyle = bg => { const k = bg || ''; if (!cellStyles.has(k)) cellStyles.set(k, `${name}.C${cellStyles.size + 1}`); return cellStyles.get(k); };
      let s = `<table:table table:name="${name}" table:style-name="${name}">`;
      cols.forEach((c, i) => { s += `<table:table-column table:style-name="${name}.col${i + 1}"/>`; });
      const cover = Array(ncol).fill(0); const coverSpan = Array(ncol).fill(1);
      const rowXml = r => {
        let o = '<table:table-row>', col = 0, ci = 0;
        while (col < ncol) {
          if (cover[col] > 0) { for (let k = 0; k < coverSpan[col]; k++) o += '<table:covered-table-cell/>'; cover[col]--; col += coverSpan[col]; continue; }
          const c = r.cells[ci++];
          if (!c) { o += `<table:table-cell table:style-name="${cellStyle('')}" office:value-type="string"><text:p/></table:table-cell>`; col++; continue; }
          const span = Math.min(c.cs || 1, ncol - col);
          o += `<table:table-cell table:style-name="${cellStyle(c.bg)}" office:value-type="string"${span > 1 ? ` table:number-columns-spanned="${span}"` : ''}${c.rs > 1 ? ` table:number-rows-spanned="${c.rs}"` : ''}>${blocksXml(c.blocks && c.blocks.length ? c.blocks : [{ t: 'p', runs: [] }])}</table:table-cell>`;
          for (let k = 1; k < span; k++) o += '<table:covered-table-cell/>';
          if (c.rs > 1) { cover[col] = c.rs - 1; coverSpan[col] = span; }
          col += span;
        }
        return o + '</table:table-row>';
      };
      const hdr = t.rows.filter(r => r.h), body = t.rows.filter(r => !r.h);
      if (hdr.length) s += `<table:table-header-rows>${hdr.map(rowXml).join('')}</table:table-header-rows>`;
      s += body.map(rowXml).join('');
      return s + '</table:table>';
    }
    function tocXml() {
      const entries = opts.toc || [];
      let s = `<text:table-of-content text:name="Table of Contents1" text:protected="true"><text:table-of-content-source text:outline-level="3"><text:index-title-template>${x(opts.tocTitle || 'Contents')}</text:index-title-template></text:table-of-content-source><text:index-body><text:index-title text:name="Table of Contents1_Head"><text:p text:style-name="Contents_20_Heading">${x(opts.tocTitle || 'Contents')}</text:p></text:index-title>`;
      for (const e of entries) s += `<text:p text:style-name="Contents_20_${Math.min(3, e.level)}">${x(e.text)}<text:tab/>${x(e.page || '')}</text:p>`;
      return s + '</text:index-body></text:table-of-content>';
    }
    function blocksXml(blocks) {
      let s = '', i = 0;
      while (i < blocks.length) {
        const b = blocks[i];
        if (b.t === 'p' && b.list) { let j = i; while (j < blocks.length && blocks[j].t === 'p' && blocks[j].list) j++; s += listXml(blocks.slice(i, j)); i = j; continue; }
        if (b.t === 'p') s += paraXml(b);
        else if (b.t === 'pagebreak') s += '<text:p text:style-name="PageBreak"/>';
        else if (b.t === 'hr') s += '<text:p text:style-name="HorizontalLine"/>';
        else if (b.t === 'toc') s += tocXml();
        else if (b.t === 'table') s += tableXml(b);
        i++;
      }
      return s;
    }
    // comments may span paragraphs: keep them open while later paragraphs still reference them
    const lastPara = {}; let pi = 0;
    root.Model.eachPara(doc.blocks, p => { pi++; for (const r of p.runs) for (const c of r.cm || []) lastPara[c] = pi; });
    let curPara = 0;
    opts = { ...opts, _cmContinues: c => lastPara[c] > curPara };
    const body = blocksXml(doc.blocks);
    // ---- automatic styles (content.xml) ----
    let autoXml = '';
    for (const { name, parent, st, extra } of auto.para.values()) autoXml += `<style:style style:name="${name}" style:family="paragraph" style:parent-style-name="${x(parent)}">${paraProps(st, extra)}</style:style>`;
    for (const { name, st, parent } of auto.text.values()) autoXml += `<style:style style:name="${name}" style:family="text"${parent ? ` style:parent-style-name="${x(parent)}"` : ''}>${textProps(st)}</style:style>`;
    for (const { name, levels } of auto.list) {
      autoXml += `<text:list-style style:name="${name}">`;
      for (let i = 0; i < 10; i++) {
        const d = levels[i] || levels.find(Boolean) || { kind: 'ul' };
        const geo = `<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="${pt(36 + i * 18)}" fo:text-indent="-18pt" fo:margin-left="${pt(36 + i * 18)}"/></style:list-level-properties>`;
        if (d.kind === 'ul') autoXml += `<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char="${BUL[i % 3]}">${geo}</text:list-level-style-bullet>`;
        else autoXml += `<text:list-level-style-number text:level="${i + 1}" style:num-suffix="." style:num-format="${NUMF[d.fmt || root.Model.defaultListFmt('ol', i)] || '1'}">${geo}</text:list-level-style-number>`;
      }
      autoXml += '</text:list-style>';
    }
    for (const t of auto.table) {
      autoXml += `<style:style style:name="${t.name}" style:family="table"><style:table-properties style:width="${pt(t.width)}" table:align="left" fo:margin-top="4pt" fo:margin-bottom="8pt"/></style:style>`;
      t.cols.forEach((c, i) => { autoXml += `<style:style style:name="${t.name}.col${i + 1}" style:family="table-column"><style:table-column-properties style:column-width="${pt(c)}"/></style:style>`; });
      for (const [bg, n] of t.cellStyles) autoXml += `<style:style style:name="${n}" style:family="table-cell"><style:table-cell-properties fo:padding="3pt" fo:border="0.5pt solid #a9b7c8"${bg ? ` fo:background-color="${x(bg)}"` : ''}/></style:style>`;
    }
    const gwrap = { inline: 'style:vertical-pos="top" style:vertical-rel="baseline"', left: 'style:wrap="right" style:horizontal-pos="left" style:horizontal-rel="paragraph" fo:margin-right="9pt" fo:margin-bottom="4pt"', right: 'style:wrap="left" style:horizontal-pos="right" style:horizontal-rel="paragraph" fo:margin-left="9pt" fo:margin-bottom="4pt"', center: 'style:wrap="none" style:horizontal-pos="center" style:horizontal-rel="paragraph" fo:margin-bottom="4pt"' };
    for (const w of auto.graphic) autoXml += `<style:style style:name="fr-${w}" style:family="graphic"><style:graphic-properties ${gwrap[w]} style:run-through="foreground"/></style:style>`;
    const fontDecls = `<office:font-face-decls>${[...fonts].map(f => `<style:font-face style:name="${x(f)}" svg:font-family="&apos;${x(f)}&apos;"/>`).join('')}</office:font-face-decls>`;
    files['content.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ${NSDECL} office:version="1.3">${fontDecls}<office:automatic-styles>${autoXml}</office:automatic-styles><office:body><office:text>${body}</office:text></office:body></office:document-content>`;
    // ---- styles.xml ----
    let st = '';
    const N = doc.styles.para.Normal || {};
    st += `<style:default-style style:family="paragraph"><style:paragraph-properties fo:orphans="2" fo:widows="2"/>${textProps({ font: N.font, size: N.size })}</style:default-style>`;
    for (const [id, s] of Object.entries(doc.styles.para)) {
      const m = HEADING.exec(id);
      st += `<style:style style:name="${x(odfName(id))}" style:display-name="${x(s.name || id)}" style:family="paragraph"${id !== 'Normal' ? ' style:parent-style-name="Standard"' : ''}${s.next ? ` style:next-style-name="${x(odfName(s.next))}"` : ''}${m ? ` style:default-outline-level="${m[1]}"` : ''}>${paraProps(s)}${textProps({ font: s.font, size: s.size, b: s.b, i: s.i, color: s.color, u: s.u, caps: s.caps })}</style:style>`;
    }
    for (const [id, s] of Object.entries(doc.styles.char)) st += `<style:style style:name="${x(id)}" style:display-name="${x(s.name || id)}" style:family="text">${textProps(s)}</style:style>`;
    st += `<style:style style:name="Footnote" style:display-name="Footnote" style:family="paragraph" style:parent-style-name="Standard">${paraProps({ sa: 2 })}${textProps({ size: 8.5 })}</style:style>`;
    st += `<style:style style:name="Header" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties><style:tab-stops><style:tab-stop style:position="${pt(contentW / 2)}" style:type="center"/><style:tab-stop style:position="${pt(contentW)}" style:type="right"/></style:tab-stops></style:paragraph-properties>${textProps({ font: 'Liberation Sans', size: 8.5, color: '#5b6b7c' })}</style:style>`;
    st += `<style:style style:name="Footer" style:family="paragraph" style:parent-style-name="Header"/>`;
    st += `<style:style style:name="PageBreak" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:break-before="page" fo:margin-top="0pt" fo:margin-bottom="0pt"/></style:style>`;
    st += `<style:style style:name="HorizontalLine" style:display-name="Horizontal Line" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:border-bottom="0.75pt solid #a9b7c8" fo:padding="0pt" fo:margin-bottom="8pt"/></style:style>`;
    st += `<style:style style:name="Contents_20_Heading" style:display-name="Contents Heading" style:family="paragraph" style:parent-style-name="Heading_20_1"/>`;
    for (let i = 1; i <= 3; i++) st += `<style:style style:name="Contents_20_${i}" style:display-name="Contents ${i}" style:family="paragraph" style:parent-style-name="Standard"><style:paragraph-properties fo:margin-left="${pt((i - 1) * 11)}" fo:margin-bottom="3pt"><style:tab-stops><style:tab-stop style:position="${pt(contentW - (i - 1) * 11)}" style:type="right" style:leader-style="dotted" style:leader-text="."/></style:tab-stops></style:paragraph-properties></style:style>`;
    const pg = doc.page;
    const hfXml = (tag, p) => {
      const seg = t => x(t).replace(/\{page\}/g, '<text:page-number text:select-page="current">1</text:page-number>').replace(/\{pages\}/g, '<text:page-count>1</text:page-count>').replace(/\{title\}/g, '<text:title/>').replace(/\{date\}/g, '<text:date/>').replace(/\{author\}/g, '<text:initial-creator/>');
      return p && (p.l || p.c || p.r) ? `<style:${tag}><text:p text:style-name="${tag === 'header' ? 'Header' : 'Footer'}">${seg(p.l || '')}<text:tab/>${seg(p.c || '')}<text:tab/>${seg(p.r || '')}</text:p></style:${tag}>` : '';
    };
    const hfProps = (tag, dist) => `<style:${tag}-style><style:header-footer-properties fo:min-height="0pt" ${tag === 'header' ? 'fo:margin-bottom' : 'fo:margin-top'}="${pt(Math.max(4, (tag === 'header' ? pg.mt - pg.hd : pg.mb - pg.fd) - 14))}"/></style:${tag}-style>`;
    const hasH = doc.header && (doc.header.l || doc.header.c || doc.header.r), hasF = doc.footer && (doc.footer.l || doc.footer.c || doc.footer.r);
    const layout = `<style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${pt(pg.w)}" fo:page-height="${pt(pg.h)}" style:print-orientation="${pg.w > pg.h ? 'landscape' : 'portrait'}" fo:margin-top="${pt(hasH ? pg.hd : pg.mt)}" fo:margin-bottom="${pt(hasF ? pg.fd : pg.mb)}" fo:margin-left="${pt(pg.ml)}" fo:margin-right="${pt(pg.mr)}"${pg.start && pg.start !== 1 ? ` style:first-page-number="${pg.start | 0}"` : ''}/>${hasH ? hfProps('header', pg.hd) : ''}${hasF ? hfProps('footer', pg.fd) : ''}</style:page-layout>`;
    files['styles.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles ${NSDECL} office:version="1.3">${fontDecls}<office:styles>${st}</office:styles><office:automatic-styles>${layout}</office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1">${hfXml('header', doc.header)}${hfXml('footer', doc.footer)}</style:master-page></office:master-styles></office:document-styles>`;
    files['meta.xml'] = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-meta ${NSDECL} office:version="1.3"><office:meta><meta:generator>Lumen Write</meta:generator><dc:title>${x(doc.meta.title || '')}</dc:title><meta:initial-creator>${x(doc.meta.author || '')}</meta:initial-creator><dc:creator>${x(doc.meta.author || '')}</dc:creator></office:meta></office:document-meta>`;
    let man = `<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/>`;
    for (const f of ['content.xml', 'styles.xml', 'meta.xml']) man += `<manifest:file-entry manifest:full-path="${f}" manifest:media-type="text/xml"/>`;
    for (const p of Object.values(pictures)) man += `<manifest:file-entry manifest:full-path="${p.path}" manifest:media-type="${x(p.mime)}"/>`;
    files['META-INF/manifest.xml'] = man + '</manifest:manifest>';
    const zipIn = { mimetype: [fflate.strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }] };
    for (const [k, v] of Object.entries(files)) zipIn[k] = typeof v === 'string' ? fflate.strToU8(v) : [v, { level: 0 }];
    return fflate.zipSync(zipIn, { level: 6 });
  }

  /* ======================= READER ======================= */
  const kids = el => { const out = []; for (let n = el ? el.firstChild : null; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n); return out; };
  const ln = el => el.localName || String(el.nodeName).replace(/^.*:/, '');
  const qn = el => String(el.nodeName);
  const at = (el, q) => { if (!el) return null; const [p, n] = q.split(':'); const v = el.getAttributeNS ? el.getAttributeNS(NS[p], n) : null; return v != null && v !== '' ? v : el.getAttribute(q); };
  const desc = (el, name) => { const out = []; (function walk(e) { for (const k of kids(e)) { if (ln(k) === name) out.push(k); walk(k); } })(el); return out; };

  function readOdt(bytes, opts = {}) {
    const fflate = opts.fflate || root.fflate;
    const DP = opts.DOMParser || root.DOMParser;
    const Model = root.Model;
    const lenPt = Model.lenPt;
    const files = fflate.unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    const parse = p => files[p] ? new DP().parseFromString(fflate.strFromU8(files[p]), 'application/xml') : null;
    const content = parse('content.xml'); if (!content || !content.documentElement) throw new Error('Not an OpenDocument text file');
    const stylesDoc = parse('styles.xml');
    const mapFont = f => f && root.Fonts ? root.Fonts.map(f) : f;
    const doc = Model.newDoc(); doc.blocks = []; doc.notes = {}; doc.comments = {};
    // ---- style table ----
    const S = {};  // name -> {family, parent, display, p:{}, t:{}, raw}
    const fontFaces = {};
    const collect = rootEl => {
      if (!rootEl) return;
      for (const ff of desc(rootEl, 'font-face')) fontFaces[at(ff, 'style:name')] = (at(ff, 'svg:font-family') || at(ff, 'style:name') || '').replace(/['"]/g, '');
      for (const s of [...desc(rootEl, 'style'), ...desc(rootEl, 'default-style')]) {
        if (qn(s) !== 'style:style' && ln(s) !== 'style') continue;
        const name = at(s, 'style:name'); if (!name) continue;
        const def = { family: at(s, 'style:family'), parent: at(s, 'style:parent-style-name'), display: at(s, 'style:display-name') || name.replace(/_20_/g, ' '), outline: at(s, 'style:default-outline-level'), p: {}, t: {}, g: {}, c: {}, raw: s };
        const tp = kids(s).find(k => ln(k) === 'text-properties');
        if (tp) {
          const fn = at(tp, 'style:font-name') || at(tp, 'fo:font-family'); if (fn) def.t.font = fontFaces[fn] || fn.replace(/['"]/g, '');
          const fs = at(tp, 'fo:font-size'); if (fs && !/%/.test(fs)) def.t.size = lenPt(fs);
          const fw = at(tp, 'fo:font-weight'); if (fw) def.t.b = fw === 'bold' || +fw >= 600;
          const fst = at(tp, 'fo:font-style'); if (fst) def.t.i = fst === 'italic' || fst === 'oblique';
          const c = at(tp, 'fo:color'); if (c && /^#[0-9a-f]{6}$/i.test(c)) def.t.color = c.toLowerCase();
          const u = at(tp, 'style:text-underline-style'); if (u) def.t.u = u !== 'none';
          const lt = at(tp, 'style:text-line-through-style'); if (lt) def.t.s = lt !== 'none';
          const bg = at(tp, 'fo:background-color'); if (bg && /^#[0-9a-f]{6}$/i.test(bg) && bg.toLowerCase() !== '#ffffff') def.t.bg = bg.toLowerCase();
          const pos = at(tp, 'style:text-position'); if (pos) { if (/^super|^\d/.test(pos) && !/^0/.test(pos)) def.t.sup = true; if (/^sub|^-/.test(pos)) def.t.sub = true; }
          const fv = at(tp, 'fo:font-variant'); if (fv === 'small-caps') def.t.caps = true;
        }
        const pp = kids(s).find(k => ln(k) === 'paragraph-properties');
        if (pp) {
          const v = k => at(pp, k);
          if (v('fo:margin-top')) def.p.sb = lenPt(v('fo:margin-top')); if (v('fo:margin-bottom')) def.p.sa = lenPt(v('fo:margin-bottom'));
          const lh = v('fo:line-height'); if (lh && /%$/.test(lh)) def.p.lh = parseFloat(lh) / 100;
          const ta = v('fo:text-align'); if (ta) def.p.align = ta === 'center' ? 'center' : ta === 'end' || ta === 'right' ? 'right' : ta === 'justify' ? 'justify' : 'left';
          if (v('fo:margin-left')) def.p.ind = lenPt(v('fo:margin-left')); if (v('fo:text-indent')) def.p.fi = lenPt(v('fo:text-indent'));
          const bg = v('fo:background-color'); if (bg && /^#[0-9a-f]{6}$/i.test(bg) && bg.toLowerCase() !== '#ffffff') def.p.bg = bg.toLowerCase();
          const bl = v('fo:border-left'); if (bl && bl !== 'none') { const m = /#[0-9a-f]{6}/i.exec(bl); def.p.bar = m ? m[0].toLowerCase() : '#888888'; }
          const bb = v('fo:border-bottom') || ''; if (bb && bb !== 'none') def.p.hr = true;
          if (v('fo:break-before') === 'page') def.p.pageBreak = true;
          if (v('fo:keep-with-next') === 'always') def.p.keep = true;
        }
        const gp = kids(s).find(k => ln(k) === 'graphic-properties');
        if (gp) def.g = { wrap: at(gp, 'style:wrap'), hpos: at(gp, 'style:horizontal-pos') };
        const cp = kids(s).find(k => ln(k) === 'table-cell-properties');
        if (cp) { const bg = at(cp, 'fo:background-color'); if (bg && /^#[0-9a-f]{6}$/i.test(bg) && bg.toLowerCase() !== '#ffffff') def.c.bg = bg.toLowerCase(); }
        const colp = kids(s).find(k => ln(k) === 'table-column-properties');
        if (colp) def.colW = lenPt(at(colp, 'style:column-width')) || null;
        S[name] = def;
      }
    };
    collect(stylesDoc && stylesDoc.documentElement); collect(content.documentElement);
    const listStyles = {};
    for (const d of [stylesDoc, content]) if (d) for (const ls of desc(d.documentElement, 'list-style')) {
      const lv = {};
      for (const l of kids(ls)) { const n = +at(l, 'text:level') || 1; lv[n - 1] = ln(l) === 'list-level-style-number' ? { kind: 'ol', fmt: NUMF_R[at(l, 'style:num-format') || '1'] || 'decimal' } : { kind: 'ul' }; }
      listStyles[at(ls, 'style:name')] = lv;
    }
    const chain = name => { const out = []; let n = name, g = 0; while (n && S[n] && g++ < 20) { out.push(S[n]); n = S[n].parent; } return out; };
    const merged = (name, key) => { const c = chain(name).reverse(); return Object.assign({}, ...c.map(s => s[key])); };
    function ourParaStyle(name, isH, level) {
      for (const s of chain(name)) {
        const raw = s.raw ? at(s.raw, 'style:name') : '';
        const disp = String(s.display || '').toLowerCase();
        let m = /^heading[_ ](?:20_)?([1-6])$/i.exec(raw) || /^heading ([1-6])$/.exec(disp); if (m) return 'Heading' + m[1];
        if (doc.styles.para[raw]) return raw;
        if (raw === 'Standard' || disp === 'default paragraph style' || disp === 'text body' || raw === 'Text_20_body') return 'Normal';
        if (disp === 'title') return 'Title'; if (disp === 'subtitle') return 'Subtitle';
        if (disp === 'quotations' || disp === 'quote') return 'Quote';
        if (disp === 'caption' || disp === 'illustration' || disp === 'figure') return 'Caption';
        if (/preformatted|code|source/.test(disp)) return 'Code';
        if (/^s_/i.test(raw)) { const st = { ...merged(raw, 't'), ...merged(raw, 'p'), name: s.display || raw }; delete st.hr; delete st.pageBreak; if (st.font) st.font = mapFont(st.font); doc.styles.para[raw] = st; return raw; }
        if (s.outline) return 'Heading' + Math.min(6, +s.outline);
      }
      return isH ? 'Heading' + Math.min(6, level || 1) : 'Normal';
    }
    // import definitions of our named styles from the file
    for (const [name, s] of Object.entries(S)) {
      if (s.family !== 'paragraph' || !s.raw || ln(s.raw) !== 'style') continue;
      const our = (() => { const m = /^Heading_20_([1-6])$/.exec(name); if (m) return 'Heading' + m[1]; if (name === 'Standard') return 'Normal'; return doc.styles.para[name] && !/^P\d+$/.test(name) ? name : null; })();
      if (!our) continue;
      const st = { ...doc.styles.para[our] };
      const T = merged(name, 't'), P = merged(name, 'p');
      for (const k of ['font', 'size', 'b', 'i', 'color', 'u', 'caps']) if (T[k] != null) st[k] = k === 'font' ? mapFont(T[k]) : T[k];
      for (const k of ['sb', 'sa', 'lh', 'align', 'ind', 'fi', 'bg', 'bar', 'keep']) if (P[k] != null) st[k] = P[k];
      doc.styles.para[our] = st;
    }
    // ---- body ----
    const officeText = desc(content.documentElement, 'text')[0] && desc(content.documentElement, 'body')[0] ? kids(desc(content.documentElement, 'body')[0]).find(k => ln(k) === 'text') : null;
    if (!officeText) throw new Error('No text body');
    let imgN = 0, noteN = 0;
    const assetByPath = {};
    function asset(href) {
      if (!href || /^https?:/i.test(href)) return null;
      const p = href.replace(/^\.\//, ''); if (assetByPath[p]) return assetByPath[p];
      const data = files[p]; if (!data) return null;
      const ext = p.split('.').pop().toLowerCase();
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp', bmp: 'image/bmp' }[ext];
      if (!mime) return null;
      const id = 'im' + (++imgN); doc.assets[id] = { mime, data }; return (assetByPath[p] = id);
    }
    const openCm = new Set();
    function inline(el, fmt, para, out) {
      for (let n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) { const t = n.nodeValue.replace(/[\s]+/g, ' '); if (t) push(out, t, fmt); continue; }
        if (n.nodeType !== 1) continue;
        const name = ln(n);
        if (name === 's') { push(out, ' '.repeat(+at(n, 'text:c') || 1), fmt, true); }
        else if (name === 'tab') out.push(w({ t: 'tab' }, fmt));
        else if (name === 'line-break') out.push(w({ t: 'br' }, fmt));
        else if (name === 'span') { const T = merged(at(n, 'text:style-name'), 't'); const f = { ...fmt }; const sn = at(n, 'text:style-name'); const csn = chain(sn).map(s => s.raw && at(s.raw, 'style:name')).find(nm => doc.styles.char[nm]); if (csn) f.cs = csn; for (const k of ['b', 'i', 'u', 's', 'sup', 'sub', 'color', 'bg', 'size', 'font']) if (T[k] != null && !(csn && doc.styles.char[csn][k] === T[k])) f[k] = k === 'font' ? mapFont(T[k]) : T[k]; if (T.caps && !f.cs) f.cs = 'SmallCaps'; inline(n, f, para, out); }
        else if (name === 'a') { const href = Model.safeHref(at(n, 'xlink:href')); const f = { ...fmt, link: href || fmt.link }; inline(n, f, para, out); }
        else if (name === 'note') { const body = kids(n).find(k => ln(k) === 'note-body'); const id = 'n' + (++noteN); doc.notes[id] = body ? body.textContent.replace(/\s+/g, ' ').trim() : ''; out.push(w({ t: 'fn', id }, fmt)); }
        else if (name === 'annotation') {
          const nm = at(n, 'office:name') || ('pt' + Math.random().toString(36).slice(2, 7)); const id = 'c' + nm.replace(/[^A-Za-z0-9_-]/g, '');
          const cr = kids(n).find(k => ln(k) === 'creator'), dt = kids(n).find(k => ln(k) === 'date');
          doc.comments[id] = { author: cr ? cr.textContent : '', date: dt ? dt.textContent : '', text: kids(n).filter(k => ln(k) === 'p').map(p => p.textContent).join('\n') };
          if (at(n, 'office:name')) openCm.add(id); else { const prev = out[out.length - 1]; if (prev) prev.cm = [...(prev.cm || []), id]; }
        }
        else if (name === 'annotation-end') openCm.delete('c' + String(at(n, 'office:name') || '').replace(/[^A-Za-z0-9_-]/g, ''));
        else if (name === 'frame') {
          const im = kids(n).find(k => ln(k) === 'image'); if (!im) { const tb = kids(n).find(k => ln(k) === 'text-box'); if (tb) inline(tb, fmt, para, out); continue; }
          const id = asset(at(im, 'xlink:href')); if (!id) continue;
          const g = merged(at(n, 'draw:style-name'), 'g');
          const anchor = at(n, 'text:anchor-type');
          let wrap = 'inline';
          if (anchor && anchor !== 'as-char') wrap = g.hpos === 'right' ? 'right' : g.hpos === 'center' || g.wrap === 'none' ? 'center' : 'left';
          const r = { t: 'img', asset: id, wrap, alt: '' };
          const wv = lenPt(at(n, 'svg:width')), hv = lenPt(at(n, 'svg:height')); if (wv) r.w = Math.round(wv * 10) / 10; if (hv) r.h = Math.round(hv * 10) / 10;
          const d = kids(n).find(k => ln(k) === 'desc'); if (d) r.alt = d.textContent;
          out.push(w(r, fmt));
        }
        else if (name === 'soft-page-break' || name === 'bookmark' || name === 'bookmark-start' || name === 'bookmark-end' || name === 'reference-mark' || name === 'change' || name === 'change-start' || name === 'change-end' || name === 'sequence-decls') { }
        else inline(n, fmt, para, out);
      }
    }
    const w = (r, f) => { if (f.link) r.link = f.link; if (openCm.size) r.cm = [...openCm]; return r; };
    function push(out, t, f, keep) {
      const r = { t: 'text', text: t };
      for (const k of ['b', 'i', 'u', 's', 'sup', 'sub']) if (f[k]) r[k] = true;
      for (const k of ['color', 'bg', 'font', 'size', 'cs']) if (f[k] != null) r[k] = f[k];
      out.push(w(r, f));
    }
    function para(el, list, outBlocks) {
      const sn = at(el, 'text:style-name');
      const isH = ln(el) === 'h';
      const style = ourParaStyle(sn, isH, +at(el, 'text:outline-level') || 1);
      const P = S[sn] && /^P\d+$|^[A-Z]{1,2}\d+$/.test(sn) ? S[sn].p : {};
      const ps = doc.styles.para[style] || {};
      const Pall = merged(sn, 'p');
      if (Pall.pageBreak) outBlocks.push({ t: 'pagebreak' });
      const runs = []; inline(el, {}, null, runs);
      // trim collapsed edge whitespace, merge
      if (runs[0] && runs[0].t === 'text') runs[0].text = runs[0].text.replace(/^ (?! )/, m => m);
      const merged2 = [];
      for (const r of runs) {
        // drop formatting equal to the paragraph style
        if (r.t === 'text') { for (const k of ['b', 'i', 'u']) if (r[k] && ps[k]) delete r[k]; if (r.color && r.color === ps.color) delete r.color; if (r.font && r.font === ps.font) delete r.font; if (r.size && r.size === ps.size) delete r.size; }
        const prev = merged2[merged2.length - 1];
        if (prev && prev.t === 'text' && r.t === 'text' && Model.sameFmt(prev, r)) prev.text += r.text; else merged2.push(r);
      }
      const hasContent = merged2.some(r => r.t !== 'text' || r.text.trim());
      if (Pall.hr && !hasContent) { outBlocks.push({ t: 'hr' }); return; }
      if (Pall.pageBreak && !hasContent && !list) return;
      const b = { t: 'p', style, runs: merged2 };
      if (list) b.list = list;
      if (P.align && P.align !== (ps.align || 'left')) b.align = P.align;
      if (!list && P.ind && Math.abs(P.ind - (ps.ind || 0)) > 0.5) b.ind = Math.round(P.ind * 10) / 10;
      if (P.fi && Math.abs(P.fi - (ps.fi || 0)) > 0.5) b.fi = Math.round(P.fi * 10) / 10;
      outBlocks.push(b);
    }
    function list(el, depth, styleName, outBlocks) {
      const sn = at(el, 'text:style-name') || styleName;
      for (const item of kids(el)) {
        if (ln(item) !== 'list-item' && ln(item) !== 'list-header') continue;
        for (const c of kids(item)) {
          if (ln(c) === 'p' || ln(c) === 'h') { const L = (listStyles[sn] || {})[Math.min(depth, 9)] || { kind: 'ul' }; const li = { kind: L.kind, level: Math.min(depth, 8) }; if (L.kind === 'ol' && L.fmt && L.fmt !== Model.defaultListFmt('ol', depth)) li.fmt = L.fmt; para(c, li, outBlocks); }
          else if (ln(c) === 'list') list(c, depth + 1, sn, outBlocks);
          else blocks(c, outBlocks);
        }
      }
    }
    function table(el) {
      const colsW = [];
      const cols = desc(el, 'table-column').filter(c => c.parentNode === el || ln(c.parentNode) === 'table-columns');
      for (const c of cols) { const rep = +at(c, 'table:number-columns-repeated') || 1; const s = S[at(c, 'table:style-name')]; for (let i = 0; i < Math.min(rep, 64); i++) colsW.push(s && s.colW || 0); }
      const t = { t: 'table', rows: [] };
      const total = colsW.reduce((a, b) => a + b, 0);
      if (total > 0 && colsW.every(Boolean)) { const wv = colsW.map(c => Math.round(c / total * 1000) / 10); if (!wv.every(v => Math.abs(v - wv[0]) < 0.6)) t.widths = wv; }
      const rowsOf = (container, hdr) => {
        for (const r of kids(container)) {
          const n = ln(r);
          if (n === 'table-header-rows') rowsOf(r, true);
          else if (n === 'table-rows' || n === 'table-row-group') rowsOf(r, hdr);
          else if (n === 'table-row') {
            const row = { cells: [] }; if (hdr) row.h = true;
            for (const c of kids(r)) {
              if (ln(c) !== 'table-cell') continue;
              const cell = { blocks: [] };
              const cs = +at(c, 'table:number-columns-spanned') || 1, rs = +at(c, 'table:number-rows-spanned') || 1;
              if (cs > 1) cell.cs = cs; if (rs > 1) cell.rs = rs;
              const bg = (S[at(c, 'table:style-name')] || { c: {} }).c.bg; if (bg) cell.bg = bg;
              blocks(c, cell.blocks);
              if (!cell.blocks.length) cell.blocks.push({ t: 'p', style: 'Normal', runs: [] });
              const rep = Math.min(+at(c, 'table:number-columns-repeated') || 1, 64);
              for (let i = 0; i < rep; i++) row.cells.push(i ? JSON.parse(JSON.stringify(cell)) : cell);
            }
            const repR = Math.min(+at(r, 'table:number-rows-repeated') || 1, 200);
            for (let i = 0; i < repR; i++) t.rows.push(i ? JSON.parse(JSON.stringify(row)) : row);
          }
        }
      };
      rowsOf(el, false);
      // trim trailing empty repeated rows/cols that spreadsheets-converted files carry
      while (t.rows.length > 1 && t.rows[t.rows.length - 1].cells.every(c => !c.blocks.some(b => b.t !== 'p' || b.runs.length))) t.rows.pop();
      return t.rows.length ? t : null;
    }
    function blocks(container, out) {
      for (const el of kids(container)) {
        const n = ln(el);
        if (n === 'p' || n === 'h') para(el, null, out);
        else if (n === 'list') list(el, 0, null, out);
        else if (n === 'table') { const t = table(el); if (t) out.push(t); }
        else if (n === 'table-of-content') out.push({ t: 'toc' });
        else if (n === 'section' || n === 'index-body' || n === 'deletion' || n === 'illustration-index' || n === 'user-index' || n === 'object-index' || n === 'table-index' || n === 'bibliography') { if (n !== 'deletion') blocks(el, out); }
        else if (n === 'tracked-changes' || n === 'sequence-decls' || n === 'variable-decls' || n === 'user-field-decls' || n === 'forms' || n === 'soft-page-break') { }
      }
    }
    blocks(officeText, doc.blocks);
    if (!doc.blocks.length) doc.blocks.push({ t: 'p', style: 'Normal', runs: [] });
    // ---- page layout, header/footer ----
    if (stylesDoc) {
      const mp = desc(stylesDoc.documentElement, 'master-page')[0];
      const pl = mp ? desc(stylesDoc.documentElement, 'page-layout').find(l => at(l, 'style:name') === at(mp, 'style:page-layout-name')) : desc(stylesDoc.documentElement, 'page-layout')[0];
      if (pl) {
        const pp = kids(pl).find(k => ln(k) === 'page-layout-properties');
        if (pp) {
          const g = k => lenPt(at(pp, k));
          if (g('fo:page-width')) doc.page.w = Math.round(g('fo:page-width') * 100) / 100;
          if (g('fo:page-height')) doc.page.h = Math.round(g('fo:page-height') * 100) / 100;
          if (g('fo:margin-left') != null) doc.page.ml = g('fo:margin-left'); if (g('fo:margin-right') != null) doc.page.mr = g('fo:margin-right');
          if (g('fo:margin-top') != null) doc.page.mt = g('fo:margin-top'); if (g('fo:margin-bottom') != null) doc.page.mb = g('fo:margin-bottom');
          const fp = at(pp, 'style:first-page-number'); if (fp && +fp > 0) doc.page.start = +fp;
        }
        // with a header the ODF top margin is the header distance; content starts below header + spacing
        const hs = kids(pl).find(k => ln(k) === 'header-style'), fs = kids(pl).find(k => ln(k) === 'footer-style');
        const hHas = mp && kids(mp).some(k => ln(k) === 'header'), fHas = mp && kids(mp).some(k => ln(k) === 'footer');
        if (hs && hHas) { const hp = kids(hs).find(k => ln(k) === 'header-footer-properties'); const mb = hp ? lenPt(at(hp, 'fo:margin-bottom')) || 0 : 0; doc.page.hd = doc.page.mt; doc.page.mt = Math.round((doc.page.mt + mb + 14) * 100) / 100; }
        if (fs && fHas) { const fp2 = kids(fs).find(k => ln(k) === 'header-footer-properties'); const mt = fp2 ? lenPt(at(fp2, 'fo:margin-top')) || 0 : 0; doc.page.fd = doc.page.mb; doc.page.mb = Math.round((doc.page.mb + mt + 14) * 100) / 100; }
      }
      doc.page.size = 'Custom';
      for (const [name, [wv, hv]] of Object.entries(Model.PAGE_SIZES)) if ((Math.abs(doc.page.w - wv) < 2 && Math.abs(doc.page.h - hv) < 2) || (Math.abs(doc.page.w - hv) < 2 && Math.abs(doc.page.h - wv) < 2)) doc.page.size = name;
      const hf = el => {
        if (!el) return { l: '', c: '', r: '' };
        const p = desc(el, 'p').find(q => q.textContent.trim() || desc(q, 'page-number').length) || desc(el, 'p')[0]; if (!p) return { l: '', c: '', r: '' };
        const segs = [''];
        (function walk(e) { for (let n = e.firstChild; n; n = n.nextSibling) { if (n.nodeType === 3) segs[segs.length - 1] += n.nodeValue; else if (n.nodeType === 1) { const k = ln(n); if (k === 'tab') segs.push(''); else if (k === 'page-number') segs[segs.length - 1] += '{page}'; else if (k === 'page-count') segs[segs.length - 1] += '{pages}'; else if (k === 'title') segs[segs.length - 1] += '{title}'; else if (k === 'date') segs[segs.length - 1] += '{date}'; else if (k === 'initial-creator' || k === 'author-name') segs[segs.length - 1] += '{author}'; else if (k === 's') segs[segs.length - 1] += ' '; else walk(n); } } })(p);
        const s = segs.map(v => v.replace(/\s+/g, ' ').trim());
        if (s.length >= 3) return { l: s[0], c: s[1], r: s.slice(2).join(' ').trim() };
        if (s.length === 2) return { l: s[0], c: '', r: s[1] };
        const al = merged(at(p, 'text:style-name'), 'p').align;
        return al === 'center' ? { l: '', c: s[0], r: '' } : al === 'right' ? { l: '', c: '', r: s[0] } : { l: s[0], c: '', r: '' };
      };
      if (mp) { doc.header = hf(kids(mp).find(k => ln(k) === 'header')); doc.footer = hf(kids(mp).find(k => ln(k) === 'footer')); }
    }
    const meta = parse('meta.xml');
    if (meta) { const t = desc(meta.documentElement, 'title')[0]; if (t) doc.meta.title = t.textContent.trim(); const c = desc(meta.documentElement, 'initial-creator')[0] || desc(meta.documentElement, 'creator')[0]; if (c) doc.meta.author = c.textContent.trim(); }
    return doc;
  }

  const Odt = { writeOdt, readOdt };
  root.Odt = Odt;
  if (typeof module !== 'undefined') module.exports = Odt;
})(typeof window !== 'undefined' ? window : globalThis);
