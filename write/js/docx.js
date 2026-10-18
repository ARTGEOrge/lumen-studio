'use strict';
/* Lumen Write — Office Open XML (.docx) writer and reader, written from scratch.
   Pure functions over the document AST (see model.js); zip via fflate; XML parsing via a DOMParser
   (native in the browser, @xmldom/xmldom in the Node tests). */
(function (root) {
  const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const CT = 'application/vnd.openxmlformats-officedocument.wordprocessingml';
  const x = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const tw = pt => Math.round(pt * 20);
  const emu = pt => Math.round(pt * 12700);
  const hex = c => (c || '').replace('#', '').toUpperCase();
  const HEADING = /^Heading([1-6])$/;
  const BUILTIN_NAMES = { Normal: 'Normal', Title: 'Title', Subtitle: 'Subtitle', Quote: 'Quote', Caption: 'caption', Heading1: 'heading 1', Heading2: 'heading 2', Heading3: 'heading 3', Heading4: 'heading 4', Heading5: 'heading 5', Heading6: 'heading 6', Emphasis: 'Emphasis', Strong: 'Strong' };
  const NUMFMT = { decimal: 'decimal', 'lower-alpha': 'lowerLetter', 'upper-alpha': 'upperLetter', 'lower-roman': 'lowerRoman', 'upper-roman': 'upperRoman' };
  const NUMFMT_R = Object.fromEntries(Object.entries(NUMFMT).map(([a, b]) => [b, a]));
  const BULLETS = ['•', '◦', '▪'];
  const fmtNum = (n, fmt) => root.Model.fmtNumber(n, fmt);

  /* ======================= WRITER ======================= */
  function rPrXml(p, extra = '') {
    let s = '';
    if (p.cs) s += `<w:rStyle w:val="${x(p.cs)}"/>`;
    if (p.font) s += `<w:rFonts w:ascii="${x(p.font)}" w:hAnsi="${x(p.font)}" w:cs="${x(p.font)}" w:eastAsia="${x(p.font)}"/>`;
    if (p.b != null) s += p.b ? '<w:b/><w:bCs/>' : '<w:b w:val="0"/><w:bCs w:val="0"/>';
    if (p.i != null) s += p.i ? '<w:i/><w:iCs/>' : '<w:i w:val="0"/><w:iCs w:val="0"/>';
    if (p.caps) s += '<w:smallCaps/>';
    if (p.s) s += '<w:strike/>';
    if (p.color) s += `<w:color w:val="${hex(p.color)}"/>`;
    if (p.size) s += `<w:sz w:val="${Math.round(p.size * 2)}"/><w:szCs w:val="${Math.round(p.size * 2)}"/>`;
    if (p.u) s += '<w:u w:val="single"/>';
    if (p.bg) s += `<w:shd w:val="clear" w:color="auto" w:fill="${hex(p.bg)}"/>`;
    if (p.sup) s += '<w:vertAlign w:val="superscript"/>'; else if (p.sub) s += '<w:vertAlign w:val="subscript"/>';
    s += extra;
    return s ? `<w:rPr>${s}</w:rPr>` : '';
  }
  function pPrStyleXml(st, isHeading, lvl) {
    let s = '';
    if (st.keep || isHeading) s += '<w:keepNext/><w:keepLines/>';
    if (st.bar) s += `<w:pBdr><w:left w:val="single" w:sz="24" w:space="9" w:color="${hex(st.bar)}"/></w:pBdr>`;
    if (st.bg) s += `<w:shd w:val="clear" w:color="auto" w:fill="${hex(st.bg)}"/>`;
    const sp = [];
    if (st.sb != null) sp.push(`w:before="${tw(st.sb)}"`); if (st.sa != null) sp.push(`w:after="${tw(st.sa)}"`);
    if (st.lh) sp.push(`w:line="${Math.round(st.lh * (st.size || 11) * 20)}" w:lineRule="atLeast"`);
    if (sp.length) s += `<w:spacing ${sp.join(' ')}/>`;
    if (st.ind || st.fi) s += `<w:ind w:left="${tw(st.ind || 0)}"${st.fi ? (st.fi > 0 ? ` w:firstLine="${tw(st.fi)}"` : ` w:hanging="${tw(-st.fi)}"`) : ''}/>`;
    if (st.align && st.align !== 'left') s += `<w:jc w:val="${st.align === 'justify' ? 'both' : st.align}"/>`;
    if (isHeading) s += `<w:outlineLvl w:val="${lvl - 1}"/>`;
    return s ? `<w:pPr>${s}</w:pPr>` : '';
  }
  function stylesXml(doc) {
    const P = doc.styles.para, C = doc.styles.char, N = P.Normal || {};
    let s = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="${W_NS}">`;
    s += `<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${x(N.font || 'Liberation Sans')}" w:hAnsi="${x(N.font || 'Liberation Sans')}" w:cs="${x(N.font || 'Liberation Sans')}" w:eastAsia="${x(N.font || 'Liberation Sans')}"/><w:sz w:val="${Math.round((N.size || 11) * 2)}"/><w:szCs w:val="${Math.round((N.size || 11) * 2)}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`;
    for (const [id, st] of Object.entries(P)) {
      const m = HEADING.exec(id);
      const name = BUILTIN_NAMES[id] || st.name || id;
      s += `<w:style w:type="paragraph"${id === 'Normal' ? ' w:default="1"' : ''} w:styleId="${x(id)}"><w:name w:val="${x(name)}"/>`;
      if (id !== 'Normal') s += '<w:basedOn w:val="Normal"/>';
      if (st.next) s += `<w:next w:val="${x(st.next)}"/>`;
      if (m) s += `<w:uiPriority w:val="9"/>`;
      s += '<w:qFormat/>';
      s += pPrStyleXml(st, !!m, m ? +m[1] : 0);
      s += rPrXml({ font: st.font, b: st.b, i: st.i, color: st.color, size: st.size, u: st.u, caps: st.caps });
      s += '</w:style>';
    }
    for (const [id, st] of Object.entries(C)) {
      s += `<w:style w:type="character" w:styleId="${x(id)}"><w:name w:val="${x(BUILTIN_NAMES[id] || st.name || id)}"/><w:basedOn w:val="DefaultParagraphFont"/><w:qFormat/>`;
      s += rPrXml({ font: st.font, b: st.b, i: st.i, color: st.color, size: st.size, u: st.u, caps: st.caps, bg: st.bg });
      s += '</w:style>';
    }
    s += `<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/></w:style>`;
    s += `<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:color w:val="1F5FAF"/><w:u w:val="single"/></w:rPr></w:style>`;
    s += `<w:style w:type="paragraph" w:styleId="FootnoteText"><w:name w:val="footnote text"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="40" w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr></w:style>`;
    s += `<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>`;
    s += `<w:style w:type="paragraph" w:styleId="CommentText"><w:name w:val="annotation text"/><w:basedOn w:val="Normal"/><w:rPr><w:sz w:val="20"/></w:rPr></w:style>`;
    s += `<w:style w:type="character" w:styleId="CommentReference"><w:name w:val="annotation reference"/><w:basedOn w:val="DefaultParagraphFont"/><w:rPr><w:sz w:val="16"/></w:rPr></w:style>`;
    s += `<w:style w:type="paragraph" w:styleId="Header"><w:name w:val="header"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans"/><w:color w:val="5B6B7C"/><w:sz w:val="17"/></w:rPr></w:style>`;
    s += `<w:style w:type="paragraph" w:styleId="Footer"><w:name w:val="footer"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans"/><w:color w:val="5B6B7C"/><w:sz w:val="17"/></w:rPr></w:style>`;
    s += `<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/><w:next w:val="Normal"/></w:style>`;
    for (let i = 1; i <= 3; i++) s += `<w:style w:type="paragraph" w:styleId="TOC${i}"><w:name w:val="toc ${i}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:ind w:left="${(i - 1) * 220}"/></w:pPr>${i === 1 ? '<w:rPr><w:b/></w:rPr>' : ''}</w:style>`;
    s += `<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>`;
    s += `<w:style w:type="table" w:styleId="LumenTable"><w:name w:val="Lumen Table"/><w:basedOn w:val="TableNormal"/><w:pPr><w:spacing w:before="40" w:after="40"/></w:pPr><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="A9B7C8"/><w:left w:val="single" w:sz="4" w:space="0" w:color="A9B7C8"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="A9B7C8"/><w:right w:val="single" w:sz="4" w:space="0" w:color="A9B7C8"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="A9B7C8"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="A9B7C8"/></w:tblBorders><w:tblCellMar><w:top w:w="57" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="57" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblStylePr w:type="firstRow"><w:rPr><w:b/><w:bCs/></w:rPr><w:tcPr><w:shd w:val="clear" w:color="auto" w:fill="E8EFF7"/></w:tcPr></w:tblStylePr></w:style>`;
    return s + '</w:styles>';
  }

  function makeWriter(doc, opts) {
    const rels = [];   // {id, type, target, ext}
    let relN = 1, changeId = 1000, docPrId = 1;
    const addRel = (type, target, external) => { const id = 'rId' + (relN++); rels.push({ id, type, target, external }); return id; };
    const media = {};  // assetId -> {rid, path}
    const files = {};
    const noteIds = {}; let noteN = 1; const noteOrder = [];
    const cmIds = {}; let cmN = 0;
    const contentW = doc.page.w - doc.page.ml - doc.page.mr;
    const numbering = { abstracts: [], nums: [] };
    const date = opts.date || new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    // pre-scan comment ranges: first/last run (in document order) of every comment id
    const cmFirst = {}, cmLast = {};
    let seq = 0; const SEQ = new WeakMap();
    (function scan(blocks) { for (const b of blocks) { if (b.t === 'p') for (const r of b.runs) { SEQ.set(r, seq++); for (const c of r.cm || []) { if (!(c in cmFirst)) cmFirst[c] = SEQ.get(r); cmLast[c] = SEQ.get(r); } } else if (b.t === 'table') for (const row of b.rows) for (const c of row.cells) scan(c.blocks); } })(doc.blocks);
    const cmUsed = Object.keys(cmFirst).filter(id => doc.comments[id]);
    cmUsed.forEach(id => { cmIds[id] = cmN++; });

    function imageXml(r) {
      const a = doc.assets[r.asset]; if (!a) return '';
      let m = media[r.asset];
      if (!m) {
        const ext = /png/.test(a.mime) ? 'png' : /jpe?g/.test(a.mime) ? 'jpeg' : /gif/.test(a.mime) ? 'gif' : /bmp/.test(a.mime) ? 'bmp' : null;
        if (!ext) return '';
        const path = `media/image${Object.keys(media).length + 1}.${ext}`;
        files['word/' + path] = a.data;
        m = media[r.asset] = { rid: addRel(REL + '/image', path), path, ext };
      }
      const wpt = r.w || a.w * 0.75 || 200, hpt = r.h || (a.w && a.h ? wpt * a.h / a.w : 150);
      const cx = emu(wpt), cy = emu(hpt), id = docPrId++;
      const graphic = `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.${m.ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${m.rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>`;
      const docPr = `<wp:docPr id="${id}" name="Picture ${id}" descr="${x(r.alt || '')}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr>`;
      if (!r.wrap || r.wrap === 'inline') return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${docPr}${graphic}</wp:inline></w:drawing>`;
      const align = r.wrap === 'center' ? 'center' : r.wrap;
      const wrap = r.wrap === 'center' ? '<wp:wrapTopAndBottom/>' : '<wp:wrapSquare wrapText="bothSides"/>';
      return `<w:drawing><wp:anchor distT="57150" distB="57150" distL="114300" distR="114300" simplePos="0" relativeHeight="${251658240 + id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="column"><wp:align>${align}</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>${wrap}${docPr}${graphic}</wp:anchor></w:drawing>`;
    }
    function runXml(r) {
      const del = !!r.del;
      if (r.t === 'br') return '<w:r><w:br/></w:r>';
      if (r.t === 'tab') return '<w:r><w:tab/></w:r>';
      if (r.t === 'fn') {
        if (!(r.id in noteIds)) { noteIds[r.id] = noteN++; noteOrder.push(r.id); }
        return `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${noteIds[r.id]}"/></w:r>`;
      }
      if (r.t === 'img') { const d = imageXml(r); return d ? `<w:r>${d}</w:r>` : ''; }
      const props = { ...r }; if (r.link && !r.cs) props.cs = 'Hyperlink';
      const text = String(r.text || '');
      const tag = del ? 'w:delText' : 'w:t';
      return `<w:r>${rPrXml(props)}<${tag} xml:space="preserve">${x(text)}</${tag}></w:r>`;
    }
    function runsXml(runs) {
      let s = '', i = 0;
      while (i < runs.length) {
        const r = runs[i];
        // comment range starts before this run
        for (const c of r.cm || []) if (c in cmIds && cmFirst[c] === SEQ.get(r)) s += `<w:commentRangeStart w:id="${cmIds[c]}"/>`;
        // group by link + change for wrapper elements
        const key = (q) => [q.link || '', q.ins ? 'i' + q.ins.au + q.ins.dt : '', q.del ? 'd' + q.del.au + q.del.dt : ''].join('|');
        const k = key(r); let j = i, inner = '';
        const ends = [];
        while (j < runs.length && key(runs[j]) === k) {
          if (j > i) for (const c of runs[j].cm || []) if (c in cmIds && cmFirst[c] === SEQ.get(runs[j])) inner += `<w:commentRangeStart w:id="${cmIds[c]}"/>`;
          inner += runXml(runs[j]);
          for (const c of runs[j].cm || []) if (c in cmIds && cmLast[c] === SEQ.get(runs[j])) { if (r.link || r.ins || r.del) ends.push(c); else inner += commentEnd(c); }
          j++;
        }
        if (r.ins) inner = `<w:ins w:id="${changeId++}" w:author="${x(r.ins.au || 'Author')}" w:date="${x(r.ins.dt || date)}">${inner}</w:ins>`;
        if (r.del) inner = `<w:del w:id="${changeId++}" w:author="${x(r.del.au || 'Author')}" w:date="${x(r.del.dt || date)}">${inner}</w:del>`;
        if (r.link) {
          const href = r.link;
          if (href.startsWith('#')) inner = `<w:hyperlink w:anchor="${x(href.slice(1))}" w:history="1">${inner}</w:hyperlink>`;
          else inner = `<w:hyperlink r:id="${addRel(REL + '/hyperlink', href, true)}" w:history="1">${inner}</w:hyperlink>`;
        }
        s += inner + ends.map(commentEnd).join('');
        i = j;
      }
      return s;
    }
    const commentEnd = c => `<w:commentRangeEnd w:id="${cmIds[c]}"/><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="${cmIds[c]}"/></w:r>`;
    // list instances: consecutive list paragraphs in the same container share one w:num
    function listNum(group) {
      const levels = [];
      for (const p of group) { const L = p.list; if (!levels[L.level]) levels[L.level] = { kind: L.kind, fmt: L.fmt }; }
      const absId = numbering.abstracts.length;
      let lv = '';
      for (let i = 0; i < 9; i++) {
        const d = levels[i] || { kind: levels.find(Boolean)?.kind || 'ul' };
        const ind = 720 + i * 360;
        if (d.kind === 'ul') lv += `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${BULLETS[i % 3]}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${ind}" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans"/></w:rPr></w:lvl>`;
        else { const f = d.fmt || root.Model.defaultListFmt('ol', i); lv += `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${NUMFMT[f] || 'decimal'}"/><w:lvlText w:val="%${i + 1}."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${ind}" w:hanging="360"/></w:pPr></w:lvl>`; }
      }
      numbering.abstracts.push(`<w:abstractNum w:abstractNumId="${absId}"><w:multiLevelType w:val="hybridMultilevel"/>${lv}</w:abstractNum>`);
      const numId = numbering.nums.length + 1;
      numbering.nums.push(`<w:num w:numId="${numId}"><w:abstractNumId w:val="${absId}"/></w:num>`);
      return numId;
    }
    function paraXml(b, numId) {
      let pp = '';
      if (b.style && b.style !== 'Normal') pp += `<w:pStyle w:val="${x(b.style)}"/>`;
      if (b.list && numId) pp += `<w:numPr><w:ilvl w:val="${b.list.level | 0}"/><w:numId w:val="${numId}"/></w:numPr>`;
      if (!b.list && (b.ind || b.fi)) pp += `<w:ind w:left="${tw(b.ind || 0)}"${b.fi ? (b.fi > 0 ? ` w:firstLine="${tw(b.fi)}"` : ` w:hanging="${tw(-b.fi)}"`) : ''}/>`;
      else if (b.list && b.fi) pp += `<w:ind w:firstLine="${tw(Math.max(0, b.fi))}"/>`;
      if (b.align && b.align !== 'left') pp += `<w:jc w:val="${b.align === 'justify' ? 'both' : b.align}"/>`;
      return `<w:p>${pp ? `<w:pPr>${pp}</w:pPr>` : ''}${runsXml(b.runs || [])}</w:p>`;
    }
    function tocXml() {
      const entries = opts.toc || [];
      let s = `<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>`;
      s += `<w:p><w:pPr><w:pStyle w:val="TOCHeading"/></w:pPr><w:r><w:t>${x(opts.tocTitle || 'Contents')}</w:t></w:r></w:p>`;
      const tabs = `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="${tw(contentW)}"/></w:tabs>`;
      const begin = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
      if (!entries.length) s += `<w:p><w:pPr><w:pStyle w:val="TOC1"/>${tabs}</w:pPr>${begin}<w:r><w:t>No headings</w:t></w:r></w:p>`;
      entries.forEach((e, i) => { s += `<w:p><w:pPr><w:pStyle w:val="TOC${Math.min(3, e.level)}"/>${tabs}</w:pPr>${i === 0 ? begin : ''}<w:r><w:t xml:space="preserve">${x(e.text)}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>${x(e.page || '')}</w:t></w:r></w:p>`; });
      s += `<w:p><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:sdtContent></w:sdt>`;
      return s;
    }
    function tableXml(t, width) {
      const ncol = Math.max(1, ...t.rows.map(r => r.cells.reduce((a, c) => a + (c.cs || 1), 0)));
      const pct = t.widths && t.widths.length === ncol ? t.widths : Array(ncol).fill(100 / ncol);
      const total = pct.reduce((a, b) => a + b, 0) || 100;
      const colW = pct.map(p => Math.round(tw(width) * p / total));
      const hasHdr = t.rows.some(r => r.h);
      let s = `<w:tbl><w:tblPr><w:tblStyle w:val="LumenTable"/><w:tblW w:w="${colW.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblLook w:val="${hasHdr ? '0420' : '0400'}" w:firstRow="${hasHdr ? 1 : 0}" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="1" w:noVBand="1"/></w:tblPr><w:tblGrid>${colW.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
      // occupancy grid for row spans
      const pending = Array(ncol).fill(0); // remaining rows covered by a vMerge from above
      const pendingSpan = Array(ncol).fill(1);
      for (const r of t.rows) {
        s += `<w:tr>${r.h ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}`;
        let col = 0, ci = 0;
        const emitCont = () => { const span = pendingSpan[col]; s += `<w:tc><w:tcPr><w:tcW w:w="${colW.slice(col, col + span).reduce((a, b) => a + b, 0)}" w:type="dxa"/>${span > 1 ? `<w:gridSpan w:val="${span}"/>` : ''}<w:vMerge/></w:tcPr><w:p/></w:tc>`; pending[col]--; col += span; };
        while (col < ncol) {
          if (pending[col] > 0) { emitCont(); continue; }
          const c = r.cells[ci++]; if (!c) break;
          const span = Math.min(c.cs || 1, ncol - col);
          let pr = `<w:tcW w:w="${colW.slice(col, col + span).reduce((a, b) => a + b, 0)}" w:type="dxa"/>`;
          if (span > 1) pr += `<w:gridSpan w:val="${span}"/>`;
          if (c.rs > 1) { pr += '<w:vMerge w:val="restart"/>'; pending[col] = c.rs - 1; pendingSpan[col] = span; }
          if (c.bg) pr += `<w:shd w:val="clear" w:color="auto" w:fill="${hex(c.bg)}"/>`;
          const inner = blocksXml(c.blocks && c.blocks.length ? c.blocks : [{ t: 'p', runs: [] }], colW.slice(col, col + span).reduce((a, b) => a + b, 0) / 20 - 11);
          s += `<w:tc><w:tcPr>${pr}</w:tcPr>${/<\/w:p>$|<w:p\/>$/.test(inner) ? inner : inner + '<w:p/>'}</w:tc>`;
          col += span;
        }
        s += '</w:tr>';
      }
      return s + '</w:tbl>';
    }
    function blocksXml(blocks, width) {
      let s = '', i = 0;
      while (i < blocks.length) {
        const b = blocks[i];
        if (b.t === 'p' && b.list) {
          let j = i; while (j < blocks.length && blocks[j].t === 'p' && blocks[j].list && !(j > i && blocks[j].list.level === 0 && blocks[j].list.kind !== blocks[j - 1].list.kind && blocks[j - 1].list.level === 0)) j++;
          const group = blocks.slice(i, j); const numId = listNum(group);
          for (const p of group) s += paraXml(p, numId);
          i = j; continue;
        }
        if (b.t === 'p') s += paraXml(b);
        else if (b.t === 'pagebreak') s += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
        else if (b.t === 'hr') s += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="A9B7C8"/></w:pBdr></w:pPr></w:p>';
        else if (b.t === 'toc') s += tocXml();
        else if (b.t === 'table') s += tableXml(b, width);
        i++;
      }
      return s;
    }
    function hfXml(kind, parts) {
      const root = kind === 'hdr' ? 'w:hdr' : 'w:ftr';
      const style = kind === 'hdr' ? 'Header' : 'Footer';
      const seg = t => {
        let out = ''; const re = /\{(page|pages|date|title|author)\}/g; let last = 0, m;
        const txt = s => s ? `<w:r><w:t xml:space="preserve">${x(s)}</w:t></w:r>` : '';
        while ((m = re.exec(t))) {
          out += txt(t.slice(last, m.index)); last = re.lastIndex;
          const f = m[1];
          if (f === 'page') out += '<w:fldSimple w:instr=" PAGE "><w:r><w:t>1</w:t></w:r></w:fldSimple>';
          else if (f === 'pages') out += '<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>1</w:t></w:r></w:fldSimple>';
          else if (f === 'date') out += `<w:fldSimple w:instr=" DATE \\@ &quot;d MMMM yyyy&quot; "><w:r><w:t>${x(new Date().toDateString())}</w:t></w:r></w:fldSimple>`;
          else if (f === 'title') out += `<w:fldSimple w:instr=" TITLE "><w:r><w:t>${x(doc.meta.title || '')}</w:t></w:r></w:fldSimple>`;
          else if (f === 'author') out += `<w:fldSimple w:instr=" AUTHOR "><w:r><w:t>${x(doc.meta.author || '')}</w:t></w:r></w:fldSimple>`;
        }
        return out + txt(t.slice(last));
      };
      const p = parts || { l: '', c: '', r: '' };
      const body = `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:tabs><w:tab w:val="center" w:pos="${tw(contentW / 2)}"/><w:tab w:val="right" w:pos="${tw(contentW)}"/></w:tabs></w:pPr>${seg(p.l || '')}<w:r><w:tab/></w:r>${seg(p.c || '')}<w:r><w:tab/></w:r>${seg(p.r || '')}</w:p>`;
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<${root} xmlns:w="${W_NS}" xmlns:r="${R_NS}">${parts ? body : '<w:p><w:pPr><w:pStyle w:val="' + style + '"/></w:pPr></w:p>'}</${root}>`;
    }
    return { addRel, files, blocksXml, hfXml, noteIds, noteOrder, cmIds, cmUsed, numbering, rels, contentW, date };
  }

  function writeDocx(doc, opts = {}) {
    const fflate = opts.fflate || root.fflate;
    const w = makeWriter(doc, opts);
    const pg = doc.page;
    const body = w.blocksXml(doc.blocks, w.contentW);
    const hasHF = h => h && (h.l || h.c || h.r);
    const hdrs = [];
    if (hasHF(doc.header)) { w.files['word/header1.xml'] = w.hfXml('hdr', doc.header); hdrs.push(`<w:headerReference w:type="default" r:id="${w.addRel(REL + '/header', 'header1.xml')}"/>`); }
    if (hasHF(doc.footer)) { w.files['word/footer1.xml'] = w.hfXml('ftr', doc.footer); hdrs.push(`<w:footerReference w:type="default" r:id="${w.addRel(REL + '/footer', 'footer1.xml')}"/>`); }
    if (doc.hfFirst) {
      w.files['word/header2.xml'] = w.hfXml('hdr', null); hdrs.push(`<w:headerReference w:type="first" r:id="${w.addRel(REL + '/header', 'header2.xml')}"/>`);
      w.files['word/footer2.xml'] = w.hfXml('ftr', null); hdrs.push(`<w:footerReference w:type="first" r:id="${w.addRel(REL + '/footer', 'footer2.xml')}"/>`);
    }
    hdrs.sort((a, b) => (a.includes('header') ? 0 : 1) - (b.includes('header') ? 0 : 1));
    const land = pg.w > pg.h;
    const sect = `<w:sectPr>${hdrs.join('')}<w:pgSz w:w="${tw(pg.w)}" w:h="${tw(pg.h)}"${land ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="${tw(pg.mt)}" w:right="${tw(pg.mr)}" w:bottom="${tw(pg.mb)}" w:left="${tw(pg.ml)}" w:header="${tw(pg.hd || 36)}" w:footer="${tw(pg.fd || 36)}" w:gutter="0"/>${pg.start && pg.start !== 1 ? `<w:pgNumType w:start="${pg.start | 0}"/>` : ''}<w:cols w:space="720"/>${doc.hfFirst ? '<w:titlePg/>' : ''}</w:sectPr>`;
    const NS = `xmlns:w="${W_NS}" xmlns:r="${R_NS}" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`;
    w.files['word/document.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
    w.files['word/styles.xml'] = stylesXml(doc);
    w.addRel(REL + '/styles', 'styles.xml');
    w.files['word/settings.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="${W_NS}"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>${w.noteOrder.length ? '<w:footnotePr><w:footnote w:id="-1"/><w:footnote w:id="0"/></w:footnotePr>' : ''}<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
    w.addRel(REL + '/settings', 'settings.xml');
    if (w.numbering.nums.length) {
      w.files['word/numbering.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="${W_NS}">${w.numbering.abstracts.join('')}${w.numbering.nums.join('')}</w:numbering>`;
      w.addRel(REL + '/numbering', 'numbering.xml');
    }
    if (w.noteOrder.length) {
      let f = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:footnotes xmlns:w="${W_NS}" xmlns:r="${R_NS}"><w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>`;
      for (const id of w.noteOrder) f += `<w:footnote w:id="${w.noteIds[id]}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> ${x(doc.notes[id] || '')}</w:t></w:r></w:p></w:footnote>`;
      w.files['word/footnotes.xml'] = f + '</w:footnotes>';
      w.addRel(REL + '/footnotes', 'footnotes.xml');
    }
    if (w.cmUsed.length) {
      let c = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:comments xmlns:w="${W_NS}">`;
      for (const id of w.cmUsed) {
        const cm = doc.comments[id];
        const ini = (cm.author || 'A').split(/\s+/).map(s => s[0]).join('').slice(0, 3);
        c += `<w:comment w:id="${w.cmIds[id]}" w:author="${x(cm.author || 'Author')}" w:date="${x(cm.date || w.date)}" w:initials="${x(ini)}">`;
        String(cm.text || '').split('\n').forEach((line, k) => { c += `<w:p><w:pPr><w:pStyle w:val="CommentText"/></w:pPr>${k === 0 ? '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r>' : ''}<w:r><w:t xml:space="preserve">${x(line)}</w:t></w:r></w:p>`; });
        c += '</w:comment>';
      }
      w.files['word/comments.xml'] = c + '</w:comments>';
      w.addRel(REL + '/comments', 'comments.xml');
    }
    w.files['word/_rels/document.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${w.rels.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${x(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;
    const ov = (p, t) => `<Override PartName="/${p}" ContentType="${t}"/>`;
    let ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Default Extension="bmp" ContentType="image/bmp"/>`;
    ct += ov('word/document.xml', CT + '.document.main+xml') + ov('word/styles.xml', CT + '.styles+xml') + ov('word/settings.xml', CT + '.settings+xml');
    if (w.files['word/numbering.xml']) ct += ov('word/numbering.xml', CT + '.numbering+xml');
    if (w.files['word/footnotes.xml']) ct += ov('word/footnotes.xml', CT + '.footnotes+xml');
    if (w.files['word/comments.xml']) ct += ov('word/comments.xml', CT + '.comments+xml');
    for (const f of Object.keys(w.files)) { const m = /^word\/(header|footer)\d+\.xml$/.exec(f); if (m) ct += ov(f, CT + '.' + m[1] + '+xml'); }
    ct += ov('docProps/core.xml', 'application/vnd.openxmlformats-package.core-properties+xml') + ov('docProps/app.xml', 'application/vnd.openxmlformats-officedocument.extended-properties+xml');
    w.files['[Content_Types].xml'] = ct + '</Types>';
    w.files['_rels/.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`;
    w.files['docProps/core.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(doc.meta.title || '')}</dc:title><dc:creator>${x(doc.meta.author || '')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${w.date}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${w.date}</dcterms:modified></cp:coreProperties>`;
    w.files['docProps/app.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Lumen Write</Application></Properties>`;
    const zipIn = {};
    // [Content_Types].xml first, like Word does
    const order = ['[Content_Types].xml', '_rels/.rels', ...Object.keys(w.files).filter(k => k !== '[Content_Types].xml' && k !== '_rels/.rels')];
    for (const k of order) { const v = w.files[k]; zipIn[k] = typeof v === 'string' ? fflate.strToU8(v) : [v, { level: 0 }]; }
    return fflate.zipSync(zipIn, { level: 6 });
  }

  /* ======================= READER ======================= */
  const kids = el => { const out = []; for (let n = el ? el.firstChild : null; n; n = n.nextSibling) if (n.nodeType === 1) out.push(n); return out; };
  const ln = el => el.localName || String(el.nodeName).replace(/^.*:/, '');
  const kid = (el, name) => kids(el).find(k => ln(k) === name) || null;
  const A = (el, name) => { if (!el) return null; const v = el.getAttributeNS ? el.getAttributeNS(W_NS, name) : null; if (v != null && v !== '') return v; const v2 = el.getAttribute('w:' + name); return v2 != null && v2 !== '' ? v2 : (el.getAttribute(name) || null); };
  const RA = (el, name) => { const v = el.getAttributeNS ? el.getAttributeNS(R_NS, name) : null; return v || el.getAttribute('r:' + name) || null; };
  const desc = (el, name) => { const out = []; (function walk(e) { for (const k of kids(e)) { if (ln(k) === name) out.push(k); walk(k); } })(el); return out; };
  const onOff = el => { if (!el) return null; const v = A(el, 'val'); return !(v === '0' || v === 'false' || v === 'off'); };
  const HL = { yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000' };

  let THEME = {};
  function readRPr(rPr, out = {}) {
    if (!rPr) return out;
    for (const k of kids(rPr)) {
      const n = ln(k);
      if (n === 'rStyle') out.rStyle = A(k, 'val');
      else if (n === 'rFonts') { const f = A(k, 'ascii') || A(k, 'hAnsi') || A(k, 'cs'); const th = A(k, 'asciiTheme') || A(k, 'hAnsiTheme'); if (f) out.font = f; else if (th && THEME[/major/i.test(th) ? 'major' : 'minor']) out.font = THEME[/major/i.test(th) ? 'major' : 'minor']; }
      else if (n === 'b') out.b = onOff(k);
      else if (n === 'i') out.i = onOff(k);
      else if (n === 'strike' || n === 'dstrike') out.s = onOff(k);
      else if (n === 'u') { const v = A(k, 'val'); out.u = !!v && v !== 'none'; }
      else if (n === 'color') { const v = A(k, 'val'); out.color = v && v !== 'auto' && /^[0-9a-f]{6}$/i.test(v) ? '#' + v.toLowerCase() : null; }
      else if (n === 'sz') out.size = +A(k, 'val') / 2;
      else if (n === 'highlight') { const v = A(k, 'val'); out.bg = HL[v] || null; }
      else if (n === 'shd') { const v = A(k, 'fill'); if (v && v !== 'auto' && /^[0-9a-f]{6}$/i.test(v)) out.bg = '#' + v.toLowerCase(); }
      else if (n === 'vertAlign') { const v = A(k, 'val'); out.sup = v === 'superscript'; out.sub = v === 'subscript'; }
      else if (n === 'smallCaps' || n === 'caps') out.caps = onOff(k);
      else if (n === 'vanish') out.hidden = onOff(k);
    }
    return out;
  }
  function readPPr(pPr, out = {}) {
    if (!pPr) return out;
    for (const k of kids(pPr)) {
      const n = ln(k);
      if (n === 'pStyle') out.pStyle = A(k, 'val');
      else if (n === 'jc') { const v = A(k, 'val'); out.align = v === 'center' ? 'center' : v === 'right' || v === 'end' ? 'right' : v === 'both' || v === 'distribute' ? 'justify' : 'left'; }
      else if (n === 'ind') { const l = A(k, 'left') || A(k, 'start'); if (l != null) out.ind = +l / 20; const f = A(k, 'firstLine'), h = A(k, 'hanging'); if (f != null) out.fi = +f / 20; if (h != null) out.fi = -h / 20; }
      else if (n === 'spacing') { const b = A(k, 'before'), a = A(k, 'after'), l = A(k, 'line'), r = A(k, 'lineRule'); if (b != null) out.sb = +b / 20; if (a != null) out.sa = +a / 20; if (l != null) out.line = { v: +l, rule: r || 'auto' }; }
      else if (n === 'numPr') { const il = kid(k, 'ilvl'), ni = kid(k, 'numId'); out.numPr = { ilvl: il ? +A(il, 'val') : 0, numId: ni ? A(ni, 'val') : null }; }
      else if (n === 'keepNext') out.keep = onOff(k);
      else if (n === 'shd') { const v = A(k, 'fill'); if (v && v !== 'auto' && /^[0-9a-f]{6}$/i.test(v)) out.bg = '#' + v.toLowerCase(); }
      else if (n === 'pBdr') { const bt = kid(k, 'bottom'); if (bt && A(bt, 'val') !== 'nil' && A(bt, 'val') !== 'none') out.hr = true; const l = kid(k, 'left'); if (l && A(l, 'val') !== 'nil' && A(l, 'val') !== 'none') { const c = A(l, 'color'); out.bar = c && c !== 'auto' ? '#' + c.toLowerCase() : '#888888'; } }
      else if (n === 'pageBreakBefore') out.pageBreakBefore = onOff(k);
      else if (n === 'outlineLvl') out.outline = +A(k, 'val');
      else if (n === 'rPr') out.rPr = readRPr(k);
    }
    return out;
  }
  function mapParaStyleId(id, name) {
    const n = String(name || id || '').toLowerCase().replace(/\s+/g, ' ').trim();
    let m = /^heading ?([1-6])$/.exec(n) || /^heading([1-6])$/i.exec(id || ''); if (m) return 'Heading' + m[1];
    if (n === 'normal' || n === 'list paragraph' || n === 'body text' || n === 'default' || n === 'text body' || n === 'no spacing' || n === 'normal (web)') return 'Normal';
    if (n === 'title') return 'Title'; if (n === 'subtitle') return 'Subtitle';
    if (n === 'quote' || n === 'intense quote' || n === 'block text' || n === 'quotations') return 'Quote';
    if (n === 'caption') return 'Caption';
    if (/code|preformatted|plain text|source/.test(n)) return 'Code';
    return null;
  }
  function mapCharStyleId(id, name) {
    const n = String(name || id || '').toLowerCase();
    if (n === 'emphasis') return 'Emphasis'; if (n === 'strong') return 'Strong';
    if (n === 'subtle emphasis') return 'Subtle'; if (/code|source|html/.test(n)) return 'InlineCode';
    if (n === 'small caps') return 'SmallCaps';
    return null;
  }

  function readDocx(bytes, opts = {}) {
    const fflate = opts.fflate || root.fflate;
    const DP = opts.DOMParser || root.DOMParser;
    const Model = root.Model;
    const files = fflate.unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    const text = p => files[p] ? fflate.strFromU8(files[p]) : null;
    const parse = p => { const t = text(p); if (t == null) return null; return new DP().parseFromString(t, 'application/xml'); };
    const mapFont = f => f && root.Fonts ? root.Fonts.map(f) : f;
    // locate main document via package rels
    let mainPath = 'word/document.xml';
    const pk = parse('_rels/.rels');
    if (pk) for (const r of kids(pk.documentElement)) if (/officeDocument$/.test(r.getAttribute('Type') || '')) mainPath = (r.getAttribute('Target') || '').replace(/^\//, '');
    const dir = mainPath.replace(/[^/]*$/, '');
    const relsOf = part => {
      const d = parse(part.replace(/([^/]*)$/, '_rels/$1.rels')); const out = {};
      if (d) for (const r of kids(d.documentElement)) out[r.getAttribute('Id')] = { type: r.getAttribute('Type') || '', target: r.getAttribute('Target') || '', external: r.getAttribute('TargetMode') === 'External' };
      return out;
    };
    const rels = relsOf(mainPath);
    const relPath = (t, base = dir) => { if (t.startsWith('/')) return t.slice(1); const parts = (base + t).split('/'); const out = []; for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); } return out.join('/'); };
    const relOfType = re => Object.values(rels).find(r => re.test(r.type));
    const docXml = parse(mainPath);
    if (!docXml || !docXml.documentElement || ln(docXml.documentElement) !== 'document') throw new Error('Not a Word document');
    const body = kid(docXml.documentElement, 'body');
    if (!body) throw new Error('Document has no body');

    THEME = {};
    const thRel = relOfType(/\/theme$/); const th = thRel ? parse(relPath(thRel.target)) : null;
    if (th) for (const [k, tag] of [['major', 'majorFont'], ['minor', 'minorFont']]) { const e = desc(th.documentElement, tag)[0]; const l = e ? kid(e, 'latin') : null; if (l && l.getAttribute('typeface')) THEME[k] = l.getAttribute('typeface'); }
    const doc = Model.newDoc();
    doc.blocks = [];
    const warnings = [];
    /* ---- styles ---- */
    const styleDefs = {}; let defR = {}, defP = {};
    const stDoc = relOfType(/\/styles$/) ? parse(relPath(relOfType(/\/styles$/).target)) : parse('word/styles.xml');
    if (stDoc) {
      const dd = kid(stDoc.documentElement, 'docDefaults');
      if (dd) { const rd = kid(dd, 'rPrDefault'); if (rd) defR = readRPr(kid(rd, 'rPr')); const pd = kid(dd, 'pPrDefault'); if (pd) defP = readPPr(kid(pd, 'pPr')); }
      for (const s of kids(stDoc.documentElement)) {
        if (ln(s) !== 'style') continue;
        const id = A(s, 'styleId'); const nm = kid(s, 'name'); const based = kid(s, 'basedOn');
        styleDefs[id] = { id, type: A(s, 'type'), name: nm ? A(nm, 'val') : id, basedOn: based ? A(based, 'val') : null, def: A(s, 'default') === '1', p: readPPr(kid(s, 'pPr')), r: readRPr(kid(s, 'rPr')) };
      }
    }
    const resolved = {};
    function resolve(id, depth = 0) {
      if (!id || !styleDefs[id] || depth > 12) return { p: {}, r: {} };
      if (resolved[id]) return resolved[id];
      const s = styleDefs[id]; const base = s.basedOn ? resolve(s.basedOn, depth + 1) : { p: {}, r: {} };
      return (resolved[id] = { p: { ...base.p, ...s.p }, r: { ...base.r, ...s.r } });
    }
    const defaultPara = Object.values(styleDefs).find(s => s.type === 'paragraph' && s.def);
    const styleMap = {}; // docx styleId -> our id
    const toOurStyle = (rp, pp, name) => {
      const sizeV = rp.size || defR.size || 11;
      const st = { name };
      const font = rp.font || defR.font; if (font) st.font = mapFont(font);
      st.size = sizeV;
      if (rp.b != null) st.b = !!rp.b; if (rp.i != null) st.i = !!rp.i;
      if (rp.color) st.color = rp.color; if (rp.u) st.u = true; if (rp.caps) st.caps = true;
      const P = { ...defP, ...pp };
      if (P.sb != null) st.sb = P.sb; if (P.sa != null) st.sa = P.sa;
      if (P.line) st.lh = P.line.rule === 'auto' ? Math.round(P.line.v / 240 * 1.17 * 100) / 100 : Math.round(P.line.v / 20 / sizeV * 100) / 100;
      if (P.align && P.align !== 'left') st.align = P.align;
      if (P.ind) st.ind = P.ind; if (P.fi) st.fi = P.fi;
      if (P.bg) st.bg = P.bg; if (P.bar) st.bar = P.bar; if (P.keep) st.keep = true;
      return st;
    };
    for (const s of Object.values(styleDefs)) {
      if (s.type === 'paragraph') {
        const our = (defaultPara && s.id === defaultPara.id) ? 'Normal' : mapParaStyleId(s.id, s.name);
        if (our) styleMap[s.id] = our;
      }
    }
    // import definitions of the styles the document maps onto ours (so Word's look carries over)
    const importStyle = (sid, our, name) => {
      const R = resolve(sid);
      const st = toOurStyle(R.r, R.p, name);
      const cur = doc.styles.para[our] || {};
      doc.styles.para[our] = { ...cur, ...st, name: cur.name || name };
      if (cur.next) doc.styles.para[our].next = cur.next;
    };
    // pick one docx style per target: the default paragraph style for Normal, else an exact id/name match first
    const picked = {};
    for (const [sid, our] of Object.entries(styleMap)) {
      if (our === 'Normal' && !(defaultPara && sid === defaultPara.id)) continue;
      const exact = sid === our || String(styleDefs[sid].name || '').replace(/\s+/g, '').toLowerCase() === our.toLowerCase();
      if (!picked[our] || (exact && !picked[our].exact)) picked[our] = { sid, exact };
    }
    for (const [our, { sid }] of Object.entries(picked)) importStyle(sid, our, doc.styles.para[our]?.name || styleDefs[sid].name);
    if (!defaultPara && (defR.font || defR.size)) Object.assign(doc.styles.para.Normal, { font: mapFont(defR.font) || doc.styles.para.Normal.font, size: defR.size || doc.styles.para.Normal.size });
    for (const s of Object.values(styleDefs)) if (s.type === 'character') { const c = mapCharStyleId(s.id, s.name); if (c) { const R = resolve(s.id).r; const cur = doc.styles.char[c]; const st = { name: cur.name }; if (R.font) st.font = mapFont(R.font); if (R.size) st.size = R.size; if (R.b != null) st.b = R.b; if (R.i != null) st.i = R.i; if (R.color) st.color = R.color; if (R.bg) st.bg = R.bg; if (R.caps) st.caps = true; if (R.u) st.u = true; doc.styles.char[c] = st; } }
    const customUsed = new Set();
    function paraStyleFor(sid) {
      if (!sid) return 'Normal';
      if (styleMap[sid]) return styleMap[sid];
      const s = styleDefs[sid]; if (!s) return 'Normal';
      // a heading by outline level?
      const R = resolve(sid);
      if (R.p.outline != null && R.p.outline < 6) return 'Heading' + (R.p.outline + 1);
      // custom style: import it
      const our = /^S_/.test(sid) ? String(sid).replace(/[^A-Za-z0-9_]/g, '') : 'S_' + String(sid).replace(/[^A-Za-z0-9_]/g, '');
      if (!doc.styles.para[our]) { doc.styles.para[our] = toOurStyle(R.r, R.p, s.name || sid); customUsed.add(our); }
      styleMap[sid] = our; return our;
    }
    /* ---- numbering ---- */
    const nums = {}; const abstracts = {};
    const numRel = relOfType(/\/numbering$/);
    const nDoc = numRel ? parse(relPath(numRel.target)) : null;
    if (nDoc) {
      for (const a of kids(nDoc.documentElement)) {
        if (ln(a) === 'abstractNum') { const lv = {}; for (const l of kids(a)) if (ln(l) === 'lvl') { const f = kid(l, 'numFmt'); const t = kid(l, 'lvlText'); const st = kid(l, 'start'); lv[+A(l, 'ilvl')] = { fmt: f ? A(f, 'val') : 'decimal', text: t ? A(t, 'val') : '', start: st ? +A(st, 'val') : 1 }; } abstracts[A(a, 'abstractNumId')] = lv; }
      }
      for (const n of kids(nDoc.documentElement)) if (ln(n) === 'num') { const an = kid(n, 'abstractNumId'); nums[A(n, 'numId')] = an ? A(an, 'val') : null; }
    }
    function listFor(numPr) {
      if (!numPr || numPr.numId == null || numPr.numId === '0') return null;
      const abs = abstracts[nums[numPr.numId]]; const lvl = Math.min(8, numPr.ilvl || 0);
      const L = abs && abs[lvl]; if (!abs) return { kind: 'ul', level: lvl };
      const f = L ? L.fmt : 'bullet';
      if (f === 'bullet' || f === 'none') return { kind: 'ul', level: lvl };
      const fmt = NUMFMT_R[f] || 'decimal';
      const out = { kind: 'ol', level: lvl };
      if (fmt !== Model.defaultListFmt('ol', lvl)) out.fmt = fmt;
      return out;
    }
    /* ---- footnotes / endnotes ---- */
    const noteMap = {};
    const plainOf = el => { let s = ''; (function walk(e) { for (const k of kids(e)) { const n = ln(k); if (n === 't' || n === 'delText') s += k.textContent; else if (n === 'tab') s += '\t'; else if (n === 'br') s += ' '; else if (n === 'footnoteRef' || n === 'endnoteRef' || n === 'instrText') { } else if (n === 'p') { if (s && !/\s$/.test(s)) s += ' '; walk(k); } else walk(k); } })(el); return s.replace(/\s+/g, ' ').trim(); };
    for (const [kind, re] of [['fn', /\/footnotes$/], ['en', /\/endnotes$/]]) {
      const rr = relOfType(re); const d = rr ? parse(relPath(rr.target)) : null;
      if (!d) continue;
      for (const f of kids(d.documentElement)) { const t = A(f, 'type'); if (t === 'separator' || t === 'continuationSeparator' || t === 'continuationNotice') continue; const id = A(f, 'id'); const our = kind + id; noteMap[kind + ':' + id] = our; doc.notes[our] = plainOf(f); }
    }
    /* ---- comments ---- */
    const cmRel = relOfType(/\/comments$/);
    const cDoc = cmRel ? parse(relPath(cmRel.target)) : null;
    if (cDoc) for (const c of kids(cDoc.documentElement)) if (ln(c) === 'comment') {
      const id = 'c' + A(c, 'id');
      const paras = kids(c).filter(k => ln(k) === 'p').map(plainOf);
      doc.comments[id] = { author: A(c, 'author') || 'Author', date: A(c, 'date') || '', text: paras.join('\n') };
    }
    /* ---- images ---- */
    const assetByPath = {}; let imgN = 0;
    function assetFor(rid, relsMap) {
      const r = relsMap[rid]; if (!r || r.external) return null;
      const p = relPath(r.target); if (assetByPath[p]) return assetByPath[p];
      const data = files[p]; if (!data) return null;
      const ext = (p.split('.').pop() || '').toLowerCase();
      const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp', tif: 'image/tiff', tiff: 'image/tiff', emf: 'image/emf', wmf: 'image/wmf' }[ext] || 'application/octet-stream';
      if (!/^image\/(png|jpeg|gif|bmp|svg\+xml|webp)$/.test(mime)) { warnings.push(`Skipped an unsupported ${ext.toUpperCase()} image`); return null; }
      const id = 'im' + (++imgN); doc.assets[id] = { mime, data }; assetByPath[p] = id; return id;
    }
    function drawingRun(dr, relsMap) {
      const inl = kids(dr).find(k => ln(k) === 'inline' || ln(k) === 'anchor'); if (!inl) return null;
      const blip = desc(inl, 'blip')[0]; if (!blip) return null;
      const rid = RA(blip, 'embed'); const asset = rid ? assetFor(rid, relsMap) : null; if (!asset) return null;
      const ext = kid(inl, 'extent');
      const r = { t: 'img', asset, wrap: 'inline', alt: '' };
      if (ext) { r.w = Math.round(+ext.getAttribute('cx') / 12700 * 10) / 10; r.h = Math.round(+ext.getAttribute('cy') / 12700 * 10) / 10; }
      const dp = kid(inl, 'docPr'); if (dp) r.alt = dp.getAttribute('descr') || '';
      if (ln(inl) === 'anchor') {
        const wrapEl = kids(inl).find(k => /^wrap/.test(ln(k)));
        const ph = kid(inl, 'positionH'); const al = ph ? kid(ph, 'align') : null; const off = ph ? kid(ph, 'posOffset') : null;
        let side = al ? al.textContent.trim() : null;
        if (!side && off) side = +off.textContent / 12700 > (doc.page.w - doc.page.ml - doc.page.mr) / 3 ? 'right' : 'left';
        if (!wrapEl || ln(wrapEl) === 'wrapTopAndBottom' || ln(wrapEl) === 'wrapNone' || side === 'center') r.wrap = 'center';
        else r.wrap = side === 'right' || side === 'outside' ? 'right' : 'left';
      }
      return r;
    }
    /* ---- body ---- */
    let tocOpen = false;   // inside a TOC field result
    function runsOf(pEl, ctx, relsMap, para, out) {
      // ctx: {link, ins, del, fields:[{instr, phase}], cm:Set}
      for (const k of kids(pEl)) {
        const n = ln(k);
        if (n === 'pPr' || n === 'bookmarkStart' || n === 'bookmarkEnd' || n === 'proofErr' || n === 'permStart' || n === 'permEnd') continue;
        if (n === 'r') runOf(k, ctx, relsMap, para, out);
        else if (n === 'hyperlink') {
          const rid = RA(k, 'id'); const anchor = A(k, 'anchor');
          let href = null; if (rid && relsMap[rid]) href = relsMap[rid].target; else if (anchor) href = '#' + anchor;
          runsOf(k, { ...ctx, link: Model.safeHref(href) || ctx.link }, relsMap, para, out);
        }
        else if (n === 'ins' || n === 'moveTo') runsOf(k, { ...ctx, ins: { au: A(k, 'author') || '', dt: A(k, 'date') || '' } }, relsMap, para, out);
        else if (n === 'del' || n === 'moveFrom') runsOf(k, { ...ctx, del: { au: A(k, 'author') || '', dt: A(k, 'date') || '' } }, relsMap, para, out);
        else if (n === 'commentRangeStart') { const id = 'c' + A(k, 'id'); if (doc.comments[id]) ctx.cm.add(id); }
        else if (n === 'commentRangeEnd') ctx.cm.delete('c' + A(k, 'id'));
        else if (n === 'fldSimple') {
          const instr = (A(k, 'instr') || '').trim();
          const hm = /^HYPERLINK\s+"([^"]+)"/i.exec(instr);
          runsOf(k, { ...ctx, link: hm ? Model.safeHref(hm[1]) || ctx.link : ctx.link }, relsMap, para, out);
        }
        else if (n === 'smartTag' || n === 'customXml' || n === 'sdt' || n === 'sdtContent' || n === 'dir' || n === 'bdo') runsOf(n === 'sdt' ? (kid(k, 'sdtContent') || k) : k, ctx, relsMap, para, out);
        else if (n === 'AlternateContent') { const ch = kid(k, 'Choice'); const fb = kid(k, 'Fallback'); const use = ch && desc(ch, 'blip').length ? ch : fb || ch; if (use) runsOf(use, ctx, relsMap, para, out); }
        else if (n === 'oMath' || n === 'oMathPara') { const t = plainOf(k); if (t) out.push(mkText(t, {}, ctx, para)); }
      }
    }
    function mkText(t, rp, ctx, para) {
      const r = { t: 'text', text: t };
      applyR(r, rp, para);
      return wrap(r, ctx);
    }
    function wrap(r, ctx) { if (ctx.link) r.link = ctx.link; if (ctx.ins) r.ins = { ...ctx.ins }; if (ctx.del) r.del = { ...ctx.del }; if (ctx.cm.size) r.cm = [...ctx.cm]; return r; }
    function applyR(r, rp, para) {
      // effective run props, minus whatever the paragraph style already gives
      const ps = para._styleProps || {};
      let eff = { ...rp };
      if (rp.rStyle) {
        const cs = styleDefs[rp.rStyle] ? mapCharStyleId(rp.rStyle, styleDefs[rp.rStyle].name) : null;
        if (cs) r.cs = cs;
        else if (rp.rStyle !== 'Hyperlink' && rp.rStyle !== 'FootnoteReference' && styleDefs[rp.rStyle]) eff = { ...resolve(rp.rStyle).r, ...rp };
      }
      const font = mapFont(eff.font); if (font && font !== ps.font) r.font = font;
      if (eff.size && Math.abs(eff.size - (ps.size || 11)) > 0.01) r.size = eff.size;
      if (eff.b != null && !!eff.b !== !!ps.b && !(r.cs === 'Strong' && eff.b)) { if (eff.b) r.b = true; }
      if (eff.i != null && !!eff.i !== !!ps.i && !(r.cs === 'Emphasis' && eff.i)) { if (eff.i) r.i = true; }
      if (eff.u && !ps.u && rp.rStyle !== 'Hyperlink') r.u = true;
      if (eff.s) r.s = true;
      if (eff.color && eff.color !== ps.color && rp.rStyle !== 'Hyperlink' && !(r.cs && doc.styles.char[r.cs] && doc.styles.char[r.cs].color === eff.color)) r.color = eff.color;
      if (eff.bg && !(r.cs && doc.styles.char[r.cs] && doc.styles.char[r.cs].bg === eff.bg)) r.bg = eff.bg;
      if (eff.sup && rp.rStyle !== 'FootnoteReference') r.sup = true; if (eff.sub) r.sub = true;
      if (eff.caps && !r.cs) r.cs = 'SmallCaps';
      // if the run turned bold off in a bold style we cannot express it; ignore
    }
    function runOf(rEl, ctx, relsMap, para, out) {
      const rp = readRPr(kid(rEl, 'rPr'));
      if (rp.hidden) return;
      const fields = ctx.fields;
      for (const k of kids(rEl)) {
        const n = ln(k);
        if (n === 'rPr') continue;
        if (n === 'fldChar') {
          const t = A(k, 'fldCharType');
          if (t === 'begin') fields.push({ instr: '', phase: 'instr' });
          else if (t === 'separate') { const f = fields[fields.length - 1]; if (f) { f.phase = 'result'; if (/^\s*TOC\b/.test(f.instr)) { f.toc = true; para._tocStart = true; } } }
          else if (t === 'end') { const f = fields.pop(); if (f && f.toc) para._tocEnd = true; }
          continue;
        }
        const top = fields[fields.length - 1];
        if (n === 'instrText') { if (top) top.instr += k.textContent; continue; }
        if (top && top.phase === 'instr') continue;
        if (fields.some(f => f.toc)) continue;
        const link = (() => { for (let i = fields.length - 1; i >= 0; i--) { const m = /^\s*HYPERLINK\s+(?:\\l\s+)?"([^"]+)"/i.exec(fields[i].instr); if (m) return Model.safeHref(/\\l/.test(fields[i].instr) ? '#' + m[1] : m[1]); } return null; })();
        const c2 = link ? { ...ctx, link } : ctx;
        if (n === 't' || n === 'delText') { const t = k.textContent; if (t) out.push(mkText(t, rp, c2, para)); }
        else if (n === 'tab' || n === 'ptab') out.push(wrap({ t: 'tab' }, c2));
        else if (n === 'br') { const bt = A(k, 'type'); if (bt === 'page') out.push({ t: '_pagebreak' }); else out.push(wrap({ t: 'br' }, c2)); }
        else if (n === 'cr') out.push(wrap({ t: 'br' }, c2));
        else if (n === 'noBreakHyphen') out.push(mkText('‑', rp, c2, para));
        else if (n === 'sym') { const ch = parseInt(A(k, 'char') || '', 16); if (ch && ch < 0xf000) out.push(mkText(String.fromCodePoint(ch), rp, c2, para)); }
        else if (n === 'drawing') { const im = drawingRun(k, relsMap); if (im) out.push(wrap(im, c2)); }
        else if (n === 'pict' || n === 'object') { const idat = desc(k, 'imagedata')[0]; if (idat) { const rid = RA(idat, 'id'); const asset = rid ? assetFor(rid, relsMap) : null; if (asset) { const shape = desc(k, 'shape')[0]; const st = shape ? shape.getAttribute('style') || '' : ''; const w = /width:([\d.]+)pt/.exec(st), h = /height:([\d.]+)pt/.exec(st); out.push(wrap({ t: 'img', asset, wrap: 'inline', alt: '', ...(w ? { w: +w[1] } : {}), ...(h ? { h: +h[1] } : {}) }, c2)); } } }
        else if (n === 'footnoteReference' || n === 'endnoteReference') { const id = noteMap[(n === 'footnoteReference' ? 'fn' : 'en') + ':' + A(k, 'id')]; if (id) out.push(wrap({ t: 'fn', id }, c2)); }
        else if (n === 'AlternateContent') { const ch = kid(k, 'Choice'); const fb = kid(k, 'Fallback'); const use = ch && desc(ch, 'blip').length ? ch : fb || ch; if (use) { const fake = { ...ctx }; for (const d of desc(use, 'drawing')) { const im = drawingRun(d, relsMap); if (im) out.push(wrap(im, fake)); } } }
      }
    }
    const fieldStack = [];
    function paraOf(pEl, relsMap, outBlocks) {
      const pp = readPPr(kid(pEl, 'pPr'));
      const style = paraStyleFor(pp.pStyle || (defaultPara && defaultPara.id));
      const p = { t: 'p', style: style || 'Normal', runs: [] };
      p._styleProps = doc.styles.para[p.style] || doc.styles.para.Normal;
      // pStyle's own numbering (e.g. List Bullet style)
      const sNum = pp.numPr || (pp.pStyle ? resolve(pp.pStyle).p.numPr : null);
      const L = listFor(sNum); if (L) p.list = L;
      if (pp.align && pp.align !== (p._styleProps.align || 'left')) p.align = pp.align;
      if (!p.list) { if (pp.ind != null && Math.abs(pp.ind - (p._styleProps.ind || 0)) > 0.5 && pp.ind > 0) p.ind = Math.round(pp.ind * 10) / 10; if (pp.fi && Math.abs(pp.fi - (p._styleProps.fi || 0)) > 0.5) p.fi = Math.round(pp.fi * 10) / 10; }
      const wasToc = tocOpen || fieldStack.some(f => f.toc);
      const ctx = { link: null, ins: null, del: null, fields: fieldStack, cm: paraOf.cm };
      const out = [];
      runsOf(pEl, ctx, relsMap, p, out);
      if (p._tocStart && !wasToc) { outBlocks.push({ t: 'toc' }); }
      if (wasToc || p._tocStart || fieldStack.some(f => f.toc)) { delete p._styleProps; return; }
      if (pp.pageBreakBefore) outBlocks.push({ t: 'pagebreak' });
      if (pp.hr && !out.some(r => r.t !== 'text' || r.text.trim())) { outBlocks.push({ t: 'hr' }); return; }
      // split at page breaks
      let curRuns = [];
      const emit = (runs, force) => { const q = { ...p, runs: mergeRuns(runs) }; if (q.list) q.list = { ...q.list }; delete q._styleProps; delete q._tocStart; delete q._tocEnd; if (q.runs.length || force) outBlocks.push(q); };
      let broke = false;
      for (const r of out) { if (r.t === '_pagebreak') { emit(curRuns, false); outBlocks.push({ t: 'pagebreak' }); curRuns = []; broke = true; } else curRuns.push(r); }
      emit(curRuns, !broke);
      // a paragraph with only a page break should not leave an empty paragraph behind
    }
    paraOf.cm = new Set();
    function mergeRuns(runs) {
      const out = [];
      for (const r of runs) { const prev = out[out.length - 1]; if (prev && prev.t === 'text' && r.t === 'text' && Model.sameFmt(prev, r)) prev.text += r.text; else out.push(r); }
      return out;
    }
    function tableOf(tbl, relsMap) {
      const grid = kid(tbl, 'tblGrid'); const cols = grid ? kids(grid).filter(k => ln(k) === 'gridCol').map(g => +A(g, 'w') || 0) : [];
      const total = cols.reduce((a, b) => a + b, 0);
      const t = { t: 'table', rows: [] };
      if (cols.length && total > 0) { const w = cols.map(c => Math.round(c / total * 1000) / 10); if (!w.every(v => Math.abs(v - w[0]) < 0.6)) t.widths = w; }
      const colOwner = []; // grid col -> cell object starting a vertical merge
      for (const tr of kids(tbl).filter(k => ln(k) === 'tr')) {
        const row = { cells: [] };
        const trPr = kid(tr, 'trPr'); if (trPr && kid(trPr, 'tblHeader') && onOff(kid(trPr, 'tblHeader'))) row.h = true;
        let col = 0;
        if (trPr) { const gb = kid(trPr, 'gridBefore'); if (gb) col += +A(gb, 'val') || 0; }
        const tcs = [];
        for (const k of kids(tr)) { if (ln(k) === 'tc') tcs.push(k); else if (ln(k) === 'sdt') for (const c of desc(k, 'tc')) tcs.push(c); }
        for (const tc of tcs) {
          const pr = kid(tc, 'tcPr');
          const gs = pr && kid(pr, 'gridSpan') ? +A(kid(pr, 'gridSpan'), 'val') || 1 : 1;
          const vm = pr ? kid(pr, 'vMerge') : null; const vmv = vm ? (A(vm, 'val') || 'continue') : null;
          if (vmv === 'continue' && colOwner[col]) { colOwner[col].rs = (colOwner[col].rs || 1) + 1; col += gs; continue; }
          const cell = { blocks: [] };
          if (gs > 1) cell.cs = gs;
          const shd = pr ? kid(pr, 'shd') : null; if (shd) { const f = A(shd, 'fill'); if (f && f !== 'auto' && /^[0-9a-f]{6}$/i.test(f) && f.toLowerCase() !== 'ffffff') cell.bg = '#' + f.toLowerCase(); }
          blocksOf(tc, relsMap, cell.blocks);
          if (!cell.blocks.length) cell.blocks.push({ t: 'p', style: 'Normal', runs: [] });
          for (let c = col; c < col + gs; c++) colOwner[c] = vmv === 'restart' ? cell : null;
          row.cells.push(cell); col += gs;
        }
        if (row.cells.length) t.rows.push(row);
      }
      if (!t.rows.length) return null;
      return t;
    }
    function blocksOf(container, relsMap, out) {
      for (const k of kids(container)) {
        const n = ln(k);
        if (n === 'p') paraOf(k, relsMap, out);
        else if (n === 'tbl') { const t = tableOf(k, relsMap); if (t) out.push(t); }
        else if (n === 'sdt') {
          const pr = kid(k, 'sdtPr'); const gal = pr ? desc(pr, 'docPartGallery')[0] : null;
          if (gal && /table of contents/i.test(A(gal, 'val') || '')) { out.push({ t: 'toc' }); continue; }
          const c = kid(k, 'sdtContent'); if (c) blocksOf(c, relsMap, out);
        }
        else if (n === 'customXml' || n === 'smartTag') blocksOf(k, relsMap, out);
        else if (n === 'AlternateContent') { const fb = kid(k, 'Fallback') || kid(k, 'Choice'); if (fb) blocksOf(fb, relsMap, out); }
      }
    }
    blocksOf(body, rels, doc.blocks);
    // drop TOC title paragraph emitted inside an sdt (we render our own) and collapse duplicates
    doc.blocks = doc.blocks.filter((b, i, a) => !(b.t === 'toc' && a[i - 1] && a[i - 1].t === 'toc'));
    if (!doc.blocks.length) doc.blocks.push({ t: 'p', style: 'Normal', runs: [] });
    /* ---- section ---- */
    const sect = kid(body, 'sectPr') || desc(body, 'sectPr').pop();
    if (sect) {
      const sz = kid(sect, 'pgSz'), mg = kid(sect, 'pgMar');
      if (sz) { doc.page.w = +A(sz, 'w') / 20 || doc.page.w; doc.page.h = +A(sz, 'h') / 20 || doc.page.h; }
      if (mg) for (const [k, a] of [['mt', 'top'], ['mb', 'bottom'], ['ml', 'left'], ['mr', 'right'], ['hd', 'header'], ['fd', 'footer']]) { const v = A(mg, a); if (v != null) doc.page[k] = Math.abs(+v) / 20; }
      const pn = kid(sect, 'pgNumType'); if (pn && A(pn, 'start')) doc.page.start = +A(pn, 'start');
      doc.hfFirst = !!(kid(sect, 'titlePg') && onOff(kid(sect, 'titlePg')));
      doc.page.size = 'Custom';
      for (const [name, [w, h]] of Object.entries(Model.PAGE_SIZES)) if ((Math.abs(doc.page.w - w) < 2 && Math.abs(doc.page.h - h) < 2) || (Math.abs(doc.page.w - h) < 2 && Math.abs(doc.page.h - w) < 2)) doc.page.size = name;
      doc.header = { l: '', c: '', r: '' }; doc.footer = { l: '', c: '', r: '' };
      for (const ref of kids(sect)) {
        const n = ln(ref); if (n !== 'headerReference' && n !== 'footerReference') continue;
        if ((A(ref, 'type') || 'default') !== 'default') continue;
        const r = rels[RA(ref, 'id')]; if (!r) continue;
        const d = parse(relPath(r.target)); if (!d) continue;
        doc[n === 'headerReference' ? 'header' : 'footer'] = hfOf(d.documentElement);
      }
    }
    function hfOf(rootEl) {
      // flatten the first paragraph with content into l / c / r segments
      const paras = desc(rootEl, 'p');
      for (const p of paras) {
        const segs = ['']; const fields = [];
        const pp = readPPr(kid(p, 'pPr'));
        (function walk(e) {
          for (const k of kids(e)) {
            const n = ln(k);
            if (n === 'fldSimple') { const tok = fieldTok(A(k, 'instr') || ''); if (tok) segs[segs.length - 1] += tok; else walk(k); continue; }
            if (n === 'fldChar') { const t = A(k, 'fldCharType'); if (t === 'begin') fields.push({ instr: '', phase: 'instr' }); else if (t === 'separate') { const f = fields[fields.length - 1]; if (f) { f.phase = 'result'; const tok = fieldTok(f.instr); if (tok) { segs[segs.length - 1] += tok; f.skip = true; } } } else if (t === 'end') fields.pop(); continue; }
            if (n === 'instrText') { const f = fields[fields.length - 1]; if (f) f.instr += k.textContent; continue; }
            const top = fields[fields.length - 1];
            if (top && (top.phase === 'instr' || top.skip)) { if (n === 'r' || n === 'hyperlink') walk(k); continue; }
            if (n === 't') segs[segs.length - 1] += k.textContent;
            else if (n === 'tab' || n === 'ptab') segs.push('');
            else if (n === 'pPr' || n === 'rPr') continue;
            else walk(k);
          }
        })(p);
        const s = segs.map(v => v.replace(/\s+/g, ' ').trim());
        if (!s.some(Boolean)) continue;
        if (s.length >= 3) return { l: s[0], c: s[1], r: s.slice(2).filter(Boolean).join(' ') };
        if (s.length === 2) return { l: s[0], c: '', r: s[1] };
        return pp.align === 'center' ? { l: '', c: s[0], r: '' } : pp.align === 'right' ? { l: '', c: '', r: s[0] } : { l: s[0], c: '', r: '' };
      }
      return { l: '', c: '', r: '' };
    }
    function fieldTok(instr) { const f = instr.trim().split(/\s+/)[0].toUpperCase(); return f === 'PAGE' ? '{page}' : f === 'NUMPAGES' || f === 'SECTIONPAGES' ? '{pages}' : f === 'DATE' || f === 'CREATEDATE' || f === 'SAVEDATE' ? '{date}' : f === 'TITLE' ? '{title}' : f === 'AUTHOR' ? '{author}' : null; }
    /* ---- properties ---- */
    const core = parse('docProps/core.xml');
    if (core) { for (const e of desc(core.documentElement, 'title')) doc.meta.title = e.textContent.trim(); for (const e of desc(core.documentElement, 'creator')) doc.meta.author = e.textContent.trim(); }
    // forget comments / notes that are never referenced
    const usedC = new Set(), usedN = new Set();
    Model.eachPara(doc.blocks, p => { for (const r of p.runs) { (r.cm || []).forEach(c => usedC.add(c)); if (r.t === 'fn') usedN.add(r.id); } });
    for (const k of Object.keys(doc.comments)) if (!usedC.has(k)) delete doc.comments[k];
    for (const k of Object.keys(doc.notes)) if (!usedN.has(k)) delete doc.notes[k];
    doc.warnings = [...new Set(warnings)];
    return doc;
  }

  const Docx = { writeDocx, readDocx };
  root.Docx = Docx;
  if (typeof module !== 'undefined') module.exports = Docx;
})(typeof window !== 'undefined' ? window : globalThis);
