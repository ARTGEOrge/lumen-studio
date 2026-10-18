'use strict';
/* Lumen Slides — PowerPoint (.pptx, OOXML PresentationML) writer. Pure JS; needs fflate (zipSync) and Model.
   PPTXWriter.write(doc, assets, {fitScale(o, slide)?, title?}) → Uint8Array */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const Model = isNode ? require('./model.js') : root.Model;
  const XML = isNode ? require('./xml.js') : root.XML;
  const getFflate = () => isNode ? require('../vendor/fflate.js') : root.fflate;
  const esc = XML.esc;
  const EMU = 9525, E = v => Math.round((+v || 0) * EMU), PTS = v => Math.round((+v || 0) * 100);
  const NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main', NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
  const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
  const RT = n => 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/' + n;
  const CT = { pres: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml', slide: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml', layout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml', master: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml', notesMaster: 'application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml', notes: 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml', theme: 'application/vnd.openxmlformats-officedocument.theme+xml', presProps: 'application/vnd.openxmlformats-officedocument.presentationml.presProps+xml', viewProps: 'application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml', tableStyles: 'application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml', chart: 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml', core: 'application/vnd.openxmlformats-package.core-properties+xml', app: 'application/vnd.openxmlformats-officedocument.extended-properties+xml' };
  const HDR = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NSDECL = `xmlns:a="${NS_A}" xmlns:r="${NS_R}" xmlns:p="${NS_P}"`;

  /* ---------- colours, fills, lines ---------- */
  function clr(c, alpha) {
    const al = alpha != null && alpha < 1 ? `<a:alpha val="${Math.round(Math.max(0, alpha) * 100000)}"/>` : '';
    if (!c) c = '#000000';
    if (c[0] === '#') { let h = c.slice(1); if (h.length === 3) h = h.replace(/./g, x => x + x); return al ? `<a:srgbClr val="${h.toUpperCase()}">${al}</a:srgbClr>` : `<a:srgbClr val="${h.toUpperCase()}"/>`; }
    const [name, m] = c.split(':'); const v = m ? parseFloat(m) / 100 : 0;
    const mod = v > 0 ? `<a:lumMod val="${Math.round((1 - v) * 100000)}"/><a:lumOff val="${Math.round(v * 100000)}"/>` : v < 0 ? `<a:lumMod val="${Math.round((1 + v) * 100000)}"/>` : '';
    const inner = mod + al;
    return inner ? `<a:schemeClr val="${name}">${inner}</a:schemeClr>` : `<a:schemeClr val="${name}"/>`;
  }
  const solid = (c, a) => `<a:solidFill>${clr(c, a)}</a:solidFill>`;
  function fillXml(f, ctx) {
    if (!f) return '<a:noFill/>';
    if (f.grad) return `<a:gradFill rotWithShape="1"><a:gsLst>${f.grad.map(([p, c]) => `<a:gs pos="${Math.round(p * 100000)}">${clr(c, f.alpha)}</a:gs>`).join('')}</a:gsLst><a:lin ang="${Math.round((((f.ang || 0) % 360) + 360) % 360 * 60000)}" scaled="0"/></a:gradFill>`;
    if (f.img && ctx) { const rid = ctx.img(f.img); return rid ? `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${rid}"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill>` : '<a:noFill/>'; }
    if (f.color) return solid(f.color, f.alpha);
    return '<a:noFill/>';
  }
  const DASH = { dash: 'dash', dot: 'sysDot', dashDot: 'dashDot', lgDash: 'lgDash' };
  function lineXml(l) {
    if (!l || !(l.w > 0)) return '<a:ln><a:noFill/></a:ln>';
    return `<a:ln w="${E(l.w)}">${solid(l.color, l.alpha)}${l.dash && DASH[l.dash] ? `<a:prstDash val="${DASH[l.dash]}"/>` : ''}<a:round/>${l.head ? '<a:headEnd type="triangle"/>' : ''}${l.tail ? '<a:tailEnd type="triangle"/>' : ''}</a:ln>`;
  }
  const xfrm = (o, tag = 'a:xfrm', extra = '') => `<${tag}${o.rot ? ` rot="${Math.round((((o.rot % 360) + 360) % 360) * 60000)}"` : ''}${o.flipH ? ' flipH="1"' : ''}${o.flipV ? ' flipV="1"' : ''}><a:off x="${E(o.x)}" y="${E(o.y)}"/><a:ext cx="${Math.max(0, E(o.w))}" cy="${Math.max(0, E(o.h))}"/>${extra}</${tag}>`;
  const shadowXml = o => o.shadow ? '<a:effectLst><a:outerShdw blurRad="133350" dist="47625" dir="5400000" algn="t" rotWithShape="0"><a:prstClr val="black"><a:alpha val="32000"/></a:prstClr></a:outerShdw></a:effectLst>' : '';
  const PRST = new Set(['rect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'octagon', 'star4', 'star5', 'star6', 'star8', 'plus', 'heart', 'donut', 'rightArrow', 'leftArrow', 'upArrow', 'downArrow', 'leftRightArrow', 'chevron', 'homePlate', 'wedgeRectCallout', 'wedgeEllipseCallout', 'line']);
  function geomXml(o) {
    if (o.geom === 'cust' && o.path) {
      const f = v => Math.round(v);
      const paths = o.path.map(sp => `<a:path w="${f(sp.w)}" h="${f(sp.h)}"${sp.fill === false ? ' fill="none"' : ''}${sp.stroke === false ? ' stroke="0"' : ''}>${sp.cmds.map(k => k[0] === 'M' ? `<a:moveTo><a:pt x="${f(k[1])}" y="${f(k[2])}"/></a:moveTo>` : k[0] === 'L' ? `<a:lnTo><a:pt x="${f(k[1])}" y="${f(k[2])}"/></a:lnTo>` : k[0] === 'C' ? `<a:cubicBezTo><a:pt x="${f(k[1])}" y="${f(k[2])}"/><a:pt x="${f(k[3])}" y="${f(k[4])}"/><a:pt x="${f(k[5])}" y="${f(k[6])}"/></a:cubicBezTo>` : k[0] === 'Q' ? `<a:quadBezTo><a:pt x="${f(k[1])}" y="${f(k[2])}"/><a:pt x="${f(k[3])}" y="${f(k[4])}"/></a:quadBezTo>` : '<a:close/>').join('')}</a:path>`).join('');
      return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst>${paths}</a:pathLst></a:custGeom>`;
    }
    const g = PRST.has(o.geom) ? o.geom : 'rect';
    const av = g === 'roundRect' && o.adj != null ? `<a:gd name="adj" fmla="val ${Math.round(o.adj * 100000)}"/>` : '';
    return `<a:prstGeom prst="${g}"><a:avLst>${av}</a:avLst></a:prstGeom>`;
  }

  /* ---------- text ---------- */
  const font = f => f === '+mj' ? '+mj-lt' : f === '+mn' ? '+mn-lt' : f;
  const ALGN = { l: 'l', c: 'ctr', r: 'r', j: 'just' };
  function rPr(r, tag = 'a:rPr', extra = '') {
    let a = ' lang="en-US"';
    if (r.size != null) a += ` sz="${Math.round(Math.max(1, Math.min(4000, r.size)) * 100)}"`;
    if (r.b != null) a += ` b="${r.b ? 1 : 0}"`; if (r.i != null) a += ` i="${r.i ? 1 : 0}"`;
    if (r.u != null) a += ` u="${r.u ? 'sng' : 'none'}"`; if (r.s) a += ' strike="sngStrike"';
    if (r.sup) a += ` baseline="${Math.round(r.sup * 1000)}"`;
    a += ' dirty="0"' + extra;
    const kids = (r.color ? solid(r.color) : '') + (r.font ? `<a:latin typeface="${esc(font(r.font))}"/>` : '');
    return kids ? `<${tag}${a}>${kids}</${tag}>` : `<${tag}${a}/>`;
  }
  function bulletXml(b) {
    if (b == null) return '';
    if (b === 'none') return '<a:buNone/>';
    if (typeof b === 'object') return `<a:buFont typeface="+mj-lt"/><a:buAutoNum type="${b.num}"${b.start && b.start !== 1 ? ` startAt="${b.start}"` : ''}/>`;
    return `<a:buFont typeface="Arial" panose="020B0604020202020204" pitchFamily="34" charset="0"/><a:buChar char="${esc(b)}"/>`;
  }
  // p: paragraph; eff: explicit props to write ({align,lvl,marL,indent,lnSp,spB,spA,bullet}); runsEff(run) → run props to write
  function paraXml(p, eff, runProps, endProps) {
    let a = '';
    if (eff.marL != null) a += ` marL="${E(eff.marL)}"`; if (eff.lvl) a += ` lvl="${eff.lvl}"`; if (eff.indent != null) a += ` indent="${E(eff.indent)}"`;
    if (eff.align) a += ` algn="${ALGN[eff.align] || 'l'}"`;
    const kids = (eff.lnSp != null ? `<a:lnSpc><a:spcPct val="${Math.round(eff.lnSp * 100000)}"/></a:lnSpc>` : '') + (eff.spB != null ? `<a:spcBef><a:spcPts val="${PTS(eff.spB)}"/></a:spcBef>` : '') + (eff.spA != null ? `<a:spcAft><a:spcPts val="${PTS(eff.spA)}"/></a:spcAft>` : '') + bulletXml(eff.bullet);
    const ppr = a || kids ? (kids ? `<a:pPr${a}>${kids}</a:pPr>` : `<a:pPr${a}/>`) : '';
    let runs = '';
    for (const r of p.runs) {
      const rp = runProps(r);
      if (r.br) { runs += `<a:br>${rPr(rp)}</a:br>`; continue; }
      if (r.fld) { runs += `<a:fld id="{${guid()}}" type="${r.fld === 'slidenum' ? 'slidenum' : 'datetime1'}">${rPr(rp)}<a:t>${r.fld === 'slidenum' ? '‹#›' : esc(r.t || new Date().toLocaleDateString('en-US'))}</a:t></a:fld>`; continue; }
      if (!r.t) continue;
      runs += `<a:r>${rPr(rp)}<a:t>${esc(r.t)}</a:t></a:r>`;
    }
    return `<a:p>${ppr}${runs}${rPr(endProps || {}, 'a:endParaRPr')}</a:p>`;
  }
  let guidN = 0;
  function guid() { guidN++; const h = n => (Math.floor(Math.random() * 16 ** n) + 16 ** n).toString(16).slice(1).toUpperCase(); return `${h(8)}-${h(4)}-4${h(3)}-A${h(3)}-${h(12)}`; }

  function bodyPrXml(tb, o, full, scale) {
    let a = ''; const ins = tb && tb.ins;
    if (full || ins) { const i = ins || [9.6, 4.8, 9.6, 4.8]; a += ` wrap="${tb && tb.wrap === false ? 'none' : 'square'}" lIns="${E(i[0])}" tIns="${E(i[1])}" rIns="${E(i[2])}" bIns="${E(i[3])}"`; }
    else if (tb && tb.wrap === false) a += ' wrap="none"';
    const anchor = tb && tb.anchor || (full ? full.anchor : null);
    if (anchor) a += ` anchor="${anchor}"`;
    if (tb && tb.vert) a += ` vert="${tb.vert}"`;
    a += ' rtlCol="0"';
    const af = tb && tb.autofit;
    const fit = af === 'shrink' ? (scale && scale < 0.999 ? `<a:normAutofit fontScale="${Math.round(scale * 100000)}"/>` : '<a:normAutofit/>') : af === 'grow' ? '<a:spAutoFit/>' : af === 'none' ? '<a:noAutofit/>' : '';
    return fit ? `<a:bodyPr${a}>${fit}</a:bodyPr>` : `<a:bodyPr${a}/>`;
  }
  /* Text body for an object. For placeholders only explicit overrides are written (the rest is inherited from the
     layout/master styles we also write). For everything else the effective style is written explicitly. */
  function txBodyXml(doc, ctx, o, tb, tag, opts) {
    tb = tb || { paras: [{ runs: [] }] };
    const isPh = !!o.ph;
    const base = Model.baseStyle(doc, ctx, o);
    const scale = opts.fitScale ? opts.fitScale(o, ctx.slide) : null;
    let paras = '';
    for (const p of tb.paras) {
      const lvl = Math.min(p.lvl || 0, base.lv.length - 1), lv = base.lv[lvl] || base.lv[0];
      let bullet = p.bullet != null ? p.bullet : lv.bullet != null ? lv.bullet : 'none';
      if (base.bullet != null && p.bullet == null) bullet = base.bullet;
      const on = bullet && bullet !== 'none';
      const marL = p.marL != null ? p.marL : (p.lvl || 0) * 48 + (on ? 36 : 0), indent = p.indent != null ? p.indent : on ? -36 : 0;
      let eff;
      if (isPh) eff = { lvl: p.lvl || 0, align: p.align, lnSp: p.lnSp, spB: p.spB, spA: p.spA, bullet: p.bullet, marL: p.marL != null || p.bullet != null ? marL : undefined, indent: p.indent != null || p.bullet != null ? indent : undefined };
      else eff = { lvl: p.lvl || 0, align: p.align || base.align || 'l', lnSp: p.lnSp != null ? p.lnSp : base.lnSp && base.lnSp !== 1 ? base.lnSp : undefined, spB: p.spB != null ? p.spB : undefined, spA: p.spA, bullet: on ? bullet : 'none', marL, indent };
      const runProps = r => isPh ? { size: r.size, b: r.b, i: r.i, u: r.u, s: r.s, color: r.color, font: r.font, sup: r.sup }
        : { size: r.size != null ? r.size : lv.size, b: r.b != null ? r.b : !!base.b, i: r.i != null ? r.i : base.i ? true : undefined, u: r.u, s: r.s, color: r.color || base.color, font: r.font || base.font, sup: r.sup };
      const endProps = isPh ? { size: p.endSize } : { size: p.endSize || lv.size, color: base.color, font: base.font };
      paras += paraXml(p, eff, runProps, endProps);
    }
    return `<${tag}>${bodyPrXml(tb, o, isPh ? null : { anchor: base.anchor || 't' }, scale)}<a:lstStyle/>${paras}</${tag}>`;
  }

  /* ---------- shapes ---------- */
  const PHNAME = { title: 'Title', ctrTitle: 'Title', subTitle: 'Subtitle', body: 'Content Placeholder', pic: 'Picture Placeholder', dt: 'Date Placeholder', ftr: 'Footer Placeholder', sldNum: 'Slide Number Placeholder' };
  function phXml(ph) {
    const t = ph.type;
    const typeAttr = t === 'body' && ph.idx ? ` type="body"` : t === 'obj' ? '' : ` type="${t}"`;
    const sz = t === 'dt' || t === 'ftr' || t === 'sldNum' ? ' sz="quarter"' : '';
    const idx = ph.idx && t !== 'title' && t !== 'ctrTitle' ? ` idx="${ph.idx}"` : '';
    return `<p:ph${typeAttr}${sz}${idx}/>`;
  }
  // ctx: {slide|layout|master, ids:{next, map}, img(assetId)→rId, chart(o)→rId, inherit:bool (slide placeholders may omit geometry)}
  function shapeXml(doc, ctx, o, opts) {
    const id = ctx.nid(o), name = esc(o.name || (o.ph ? PHNAME[o.ph.type] || 'Placeholder' : o.tb ? 'TextBox' : o.type === 'image' ? 'Picture' : o.type === 'table' ? 'Table' : o.type === 'chart' ? 'Chart' : o.type === 'group' ? 'Group' : (Model.GEOMS.find(g => g[0] === o.geom) || ['', 'Shape'])[1]) + ' ' + (o.name ? '' : id - 1)).trim();
    if (o.type === 'group') {
      const kids = o.children.map(k => shapeXml(doc, ctx, k, opts)).join('');
      const ext = `<a:chOff x="${E(o.x)}" y="${E(o.y)}"/><a:chExt cx="${Math.max(0, E(o.w))}" cy="${Math.max(0, E(o.h))}"/>`;
      return `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>${xfrm(o, 'a:xfrm', ext)}</p:grpSpPr>${kids}</p:grpSp>`;
    }
    if (o.type === 'image') {
      const rid = ctx.img(o.asset);
      if (!rid) return '';
      const cr = o.crop, src = cr && (cr.l || cr.t || cr.r || cr.b) ? `<a:srcRect${['l', 't', 'r', 'b'].map(k => cr[k] ? ` ${k}="${Math.round(cr[k] * 100000)}"` : '').join('')}/>` : '';
      const nv = o.ph ? `<p:nvPr>${phXml(o.ph)}</p:nvPr>` : '<p:nvPr/>';
      return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${name}" descr="${esc(o.alt || '')}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr>${nv}</p:nvPicPr><p:blipFill><a:blip r:embed="${rid}"/>${src}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>${xfrm(o)}${geomXml({ geom: o.geom || 'rect' })}${o.line ? lineXml(o.line) : ''}${shadowXml(o)}</p:spPr></p:pic>`;
    }
    if (o.type === 'table') return tableXml(doc, ctx, o, id, name, opts);
    if (o.type === 'chart') {
      const rid = ctx.chart(o);
      return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>${xfrm(o, 'p:xfrm')}<a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" r:id="${rid}"/></a:graphicData></a:graphic></p:graphicFrame>`;
    }
    // shape / text box / placeholder
    const inherit = o.ph && ctx.slide && !o.ownGeo && Model.layoutPh(doc, ctx.slide, o);
    const sp = inherit && !o.fill && !o.line && !o.rot ? '<p:spPr/>' : `<p:spPr>${inherit && !o.rot ? '' : xfrm(o)}${inherit ? '' : geomXml(o)}${o.ph && !o.fill ? '' : fillXml(o.fill, ctx)}${o.ph && !o.line ? '' : lineXml(o.line)}${shadowXml(o)}</p:spPr>`;
    const nvsp = o.ph ? '<p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>' : o.tb ? '<p:cNvSpPr txBox="1"/>' : '<p:cNvSpPr/>';
    const nvpr = o.ph ? `<p:nvPr>${phXml(o.ph)}</p:nvPr>` : '<p:nvPr/>';
    const txt = o.text || o.ph ? txBodyXml(doc, ctx, o, o.text, 'p:txBody', opts) : (o.geom !== 'line' ? `<p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="en-US" dirty="0"/></a:p></p:txBody>` : '');
    return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/>${nvsp}${nvpr}</p:nvSpPr>${sp}${txt}</p:sp>`;
  }
  function tableXml(doc, ctx, o, id, name, opts) {
    const st = o.style || {}, tot = o.cols.reduce((a, b) => a + b, 0) || 1, kx = o.w / tot;
    const grid = o.cols.map(w => `<a:gridCol w="${E(w * kx)}"/>`).join('');
    const border = st.none ? '<a:solidFill><a:schemeClr val="tx1"><a:lumMod val="50000"/><a:lumOff val="50000"/></a:schemeClr></a:solidFill>' : '<a:solidFill><a:schemeClr val="bg1"/></a:solidFill>';
    const bw = st.none ? 12700 : 19050;
    const ln = t => `<a:${t} w="${bw}" cap="flat" cmpd="sng" algn="ctr">${border}<a:prstDash val="solid"/><a:round/><a:headEnd type="none" w="med" len="med"/><a:tailEnd type="none" w="med" len="med"/></a:${t}>`;
    const rows = o.rows.map((r, ri) => `<a:tr h="${E(r.h)}">${r.cells.map((cell, ci) => {
      const hdr = st.first && ri === 0 && !st.none;
      const pseudo = { type: 'table', text: { ...cell.text, def: { ...(cell.text.def || {}), ...(hdr ? { b: cell.b != null ? cell.b : true, color: (cell.text.def && cell.text.def.color) || 'bg1' } : {}) } } };
      let f = cell.fill;
      if (!f && !st.none) { const col = st.color || 'accent1'; if (st.first && ri === 0) f = { color: col }; else { const k = st.first ? ri - 1 : ri; f = { color: st.band && k % 2 === 0 ? col + ':+60' : col + ':+80' }; } }
      const tx = txBodyXml(doc, ctx, pseudo, pseudo.text, 'a:txBody', {}).replace(/<a:bodyPr[^>]*\/>|<a:bodyPr[^>]*>.*?<\/a:bodyPr>/, '<a:bodyPr/>');
      const ins = cell.text.ins || [9.6, 4.8, 9.6, 4.8];
      const anchor = cell.text.anchor && cell.text.anchor !== 't' ? ` anchor="${cell.text.anchor}"` : '';
      return `<a:tc>${tx}<a:tcPr marL="${E(ins[0])}" marR="${E(ins[2])}" marT="${E(ins[1])}" marB="${E(ins[3])}"${anchor}>${ln('lnL')}${ln('lnR')}${ln('lnT')}${ln('lnB')}${f ? fillXml(f) : '<a:noFill/>'}</a:tcPr></a:tc>`;
    }).join('')}</a:tr>`).join('');
    return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/><p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>${xfrm(o, 'p:xfrm')}<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr firstRow="${st.first ? 1 : 0}" bandRow="${st.band ? 1 : 0}"/><a:tblGrid>${grid}</a:tblGrid>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
  }

  /* ---------- charts ---------- */
  function colLetter(n) { let s = ''; n++; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function chartXml(doc, o) {
    const n = o.cats.length, pie = o.kind === 'pie' || o.kind === 'doughnut';
    const strCache = arr => `<c:strCache><c:ptCount val="${arr.length}"/>${arr.map((v, i) => `<c:pt idx="${i}"><c:v>${esc(v)}</c:v></c:pt>`).join('')}</c:strCache>`;
    const numCache = arr => `<c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${arr.length}"/>${arr.map((v, i) => `<c:pt idx="${i}"><c:v>${+v || 0}</c:v></c:pt>`).join('')}</c:numCache>`;
    const series = (pie ? o.series.slice(0, 1) : o.series).map((s, si) => {
      const col = colLetter(si + 1), color = s.color || ('accent' + (si % 6 + 1));
      const tx = `<c:tx><c:strRef><c:f>Sheet1!$${col}$1</c:f>${strCache([s.name])}</c:strRef></c:tx>`;
      const sp = o.kind === 'line' ? `<c:spPr><a:ln w="28575" cap="rnd">${solid(color)}<a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr>${solid(color)}<a:ln w="9525">${solid('bg1')}</a:ln></c:spPr></c:marker>` : pie ? '' : `<c:spPr>${solid(color)}<a:ln><a:noFill/></a:ln></c:spPr>${o.kind === 'area' ? '' : '<c:invertIfNegative val="0"/>'}`;
      const dpt = pie ? s.vals.map((_, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr>${solid('accent' + (i % 6 + 1) + (i >= 6 ? ':-25' : ''))}<a:ln w="19050">${solid('bg1')}</a:ln></c:spPr></c:dPt>`).join('') : '';
      const dl = o.labels ? `<c:dLbls><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:showLegendKey val="0"/><c:showVal val="${pie ? 0 : 1}"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="${pie ? 1 : 0}"/><c:showBubbleSize val="0"/>${pie ? '<c:showLeaderLines val="1"/>' : ''}</c:dLbls>` : '';
      const cat = `<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$${n + 1}</c:f>${strCache(o.cats)}</c:strRef></c:cat>`;
      const val = `<c:val><c:numRef><c:f>Sheet1!$${col}$2:$${col}$${n + 1}</c:f>${numCache(s.vals)}</c:numRef></c:val>`;
      return `<c:ser><c:idx val="${si}"/><c:order val="${si}"/>${tx}${sp}${dpt}${dl}${cat}${val}${o.kind === 'line' ? '<c:smooth val="0"/>' : ''}</c:ser>`;
    }).join('');
    const ax = `<c:axId val="50010001"/><c:axId val="50010002"/>`;
    let plot;
    if (o.kind === 'pie') plot = `<c:pieChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/></c:pieChart>`;
    else if (o.kind === 'doughnut') plot = `<c:doughnutChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/><c:holeSize val="55"/></c:doughnutChart>`;
    else if (o.kind === 'line') plot = `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/>${ax}</c:lineChart>`;
    else if (o.kind === 'area') plot = `<c:areaChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}${ax}</c:areaChart>`;
    else plot = `<c:barChart><c:barDir val="${o.kind === 'bar' ? 'bar' : 'col'}"/><c:grouping val="${o.kind === 'stacked' ? 'stacked' : 'clustered'}"/><c:varyColors val="0"/>${series}<c:gapWidth val="${o.kind === 'stacked' ? 60 : 100}"/>${o.kind === 'stacked' ? '<c:overlap val="100"/>' : ''}${ax}</c:barChart>`;
    const txGray = '<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200">' + solid('tx1:+25') + '</a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>';
    const grid = `<c:majorGridlines><c:spPr><a:ln w="9525">${solid('tx1:+85')}</a:ln></c:spPr></c:majorGridlines>`;
    const axes = pie ? '' : `<c:catAx><c:axId val="50010001"/><c:scaling><c:orientation val="${o.kind === 'bar' ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${o.kind === 'bar' ? 'l' : 'b'}"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln w="9525">${solid('tx1:+50')}</a:ln></c:spPr>${txGray}<c:crossAx val="50010002"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>` +
      `<c:valAx><c:axId val="50010002"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${o.kind === 'bar' ? 'b' : 'l'}"/>${grid}<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:spPr><a:ln><a:noFill/></a:ln></c:spPr>${txGray}<c:crossAx val="50010001"/><c:crosses val="${o.kind === 'bar' ? 'max' : 'autoZero'}"/><c:crossBetween val="between"/></c:valAx>`;
    const title = o.title ? `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1800" b="1">${solid('tx1')}</a:defRPr></a:pPr><a:r><a:rPr lang="en-US" sz="1800" b="1">${solid('tx1')}</a:rPr><a:t>${esc(o.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>` : '<c:autoTitleDeleted val="1"/>';
    const legend = o.legend ? `<c:legend><c:legendPos val="b"/><c:overlay val="0"/>${txGray}</c:legend>` : '';
    return HDR + `<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/><c:chart>${title}<c:plotArea><c:layout/>${plot}${axes}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea>${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200"><a:latin typeface="+mn-lt"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr></c:chartSpace>`;
  }

  /* ---------- transitions & animations ---------- */
  function transitionXml(t) {
    if (!t || !t.type || t.type === 'none') { if (t && (t.after != null || t.noClick)) return `<p:transition${t.noClick ? ' advClick="0"' : ''}${t.after != null ? ` advTm="${Math.round(t.after * 1000)}"` : ''}/>`; return ''; }
    const dur = t.dur || 0.7, spd = dur <= 0.5 ? 'fast' : dur <= 0.8 ? 'med' : 'slow';
    const dir = t.dir;
    const side = { l: 'l', r: 'r', u: 'u', d: 'd' }[dir] || null;
    const child = { fade: '<p:fade/>', flash: '<p:fade thruBlk="1"/>', push: `<p:push${side ? ` dir="${side}"` : ''}/>`, wipe: `<p:wipe${side ? ` dir="${side}"` : ''}/>`, cover: `<p:cover${side ? ` dir="${side}"` : ''}/>`, uncover: `<p:pull${side ? ` dir="${side}"` : ''}/>`, zoom: '<p:zoom/>', split: `<p:split orient="${dir === 'h' ? 'horz' : 'vert'}" dir="out"/>` }[t.type] || '<p:fade/>';
    const attrs = `${t.noClick ? ' advClick="0"' : ''}${t.after != null ? ` advTm="${Math.round(t.after * 1000)}"` : ''}`;
    return `<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" Requires="p14"><p:transition spd="${spd}" p14:dur="${Math.round(dur * 1000)}"${attrs}>${child}</p:transition></mc:Choice><mc:Fallback><p:transition spd="${spd}"${attrs}>${child}</p:transition></mc:Fallback></mc:AlternateContent>`;
  }
  const PRESET = { entr: { appear: 1, fly: 2, fade: 10, split: 16, wipe: 22, grow: 23, float: 42, zoom: 53 }, exit: { appear: 1, fly: 2, fade: 10, split: 16, wipe: 22, grow: 23, float: 42, zoom: 53 }, emph: { grow: 6, spin: 8, pulse: 26, teeter: 32 } };
  const SUB = { b: 4, l: 8, r: 2, t: 1 };
  function timingXml(slide, spid, hasText) {
    const anims = (slide.anims || []).filter(a => spid(a.target));
    if (!anims.length) return '';
    let id = 3; const nid = () => id++;
    const tgt = a => `<p:tgtEl><p:spTgt spid="${spid(a.target)}"/></p:tgtEl>`;
    const setVis = (a, val, delay) => `<p:set><p:cBhvr><p:cTn id="${nid()}" dur="1" fill="hold"><p:stCondLst><p:cond delay="${delay}"/></p:stCondLst></p:cTn>${tgt(a)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${val}"/></p:to></p:set>`;
    const tav = (attr, a, from, to, dur) => `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${nid()}" dur="${dur}" fill="hold"/>${tgt(a)}<p:attrNameLst><p:attrName>${attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;
    const effect = (a, name, dur) => `<p:animEffect transition="${a.cls === 'exit' ? 'out' : 'in'}" filter="${name}"><p:cBhvr><p:cTn id="${nid()}" dur="${dur}"/>${tgt(a)}</p:cBhvr></p:animEffect>`;
    const wipeDir = { b: 'up', t: 'down', l: 'right', r: 'left' };
    function behaviours(a) {
      const dur = Math.max(1, Math.round(a.dur * 1000));
      if (a.cls === 'emph') {
        if (a.fx === 'spin') return `<p:animRot by="21600000"><p:cBhvr><p:cTn id="${nid()}" dur="${dur}" fill="hold"/>${tgt(a)}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>`;
        if (a.fx === 'teeter') return `<p:animRot by="420000"><p:cBhvr><p:cTn id="${nid()}" dur="${Math.round(dur / 4)}" autoRev="1" repeatCount="2000" fill="hold"/>${tgt(a)}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>`;
        const by = a.fx === 'grow' ? 125000 : 112000;
        return `<p:animScale><p:cBhvr><p:cTn id="${nid()}" dur="${a.fx === 'grow' ? dur : Math.round(dur / 2)}"${a.fx === 'grow' ? '' : ' autoRev="1"'} fill="hold"/>${tgt(a)}</p:cBhvr><p:by x="${by}" y="${by}"/></p:animScale>`;
      }
      const ent = a.cls === 'entr';
      let b = ent ? setVis(a, 'visible', 0) : '';
      const d = a.dir || 'b';
      const off = { l: ['0-#ppt_w/2', '#ppt_y'], r: ['1+#ppt_w/2', '#ppt_y'], t: ['#ppt_x', '0-#ppt_h/2'], b: ['#ppt_x', '1+#ppt_h/2'] }[d];
      switch (a.fx) {
        case 'appear': break;
        case 'fly': b += ent ? tav('ppt_x', a, off[0], '#ppt_x', dur) + tav('ppt_y', a, off[1], '#ppt_y', dur) : tav('ppt_x', a, '#ppt_x', off[0], dur) + tav('ppt_y', a, '#ppt_y', off[1], dur); break;
        case 'wipe': b += effect(a, `wipe(${wipeDir[d] || 'up'})`, dur); break;
        case 'split': b += effect(a, ent ? 'barn(outVertical)' : 'barn(inVertical)', dur); break;
        case 'zoom': case 'grow': { const f = a.fx === 'zoom' ? '0' : '#ppt_w*0.6', g = a.fx === 'zoom' ? '0' : '#ppt_h*0.6'; b += ent ? tav('ppt_w', a, f, '#ppt_w', dur) + tav('ppt_h', a, g, '#ppt_h', dur) : tav('ppt_w', a, '#ppt_w', f, dur) + tav('ppt_h', a, '#ppt_h', g, dur); b += effect(a, 'fade', dur); break; }
        case 'float': b += effect(a, 'fade', dur) + (ent ? tav('ppt_y', a, '#ppt_y+0.1', '#ppt_y', dur) : tav('ppt_y', a, '#ppt_y', '#ppt_y+0.1', dur)); break;
        default: b += effect(a, 'fade', dur);
      }
      if (!ent) b += setVis(a, 'hidden', a.fx === 'appear' ? 0 : dur - 1);
      return b;
    }
    // group into click steps → after-chains → effects
    const steps = []; let st = null, grp = null;
    for (const a of anims) {
      if (!st || a.trig === 'click') { st = { auto: !steps.length && a.trig !== 'click', groups: [] }; steps.push(st); grp = null; }
      if (!grp || a.trig === 'after') { grp = { items: [], start: 0 }; st.groups.push(grp); }
      grp.items.push(a);
    }
    for (const s of steps) { let t = 0; for (const g of s.groups) { g.start = t; let end = t; for (const a of g.items) end = Math.max(end, t + a.delay + (a.fx === 'appear' ? 0 : a.dur)); t = end; } }
    let xml = '';
    for (const s of steps) {
      const cond = s.auto ? '<p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond>' : '<p:cond delay="indefinite"/>';
      let inner = '';
      for (const g of s.groups) {
        let effs = '';
        for (const a of g.items) {
          const node = a.trig === 'with' ? 'withEffect' : a.trig === 'after' ? 'afterEffect' : 'clickEffect';
          const pid = (PRESET[a.cls] || PRESET.entr)[a.fx] || 10;
          const sub = a.fx === 'fly' || a.fx === 'wipe' ? SUB[a.dir || 'b'] : a.fx === 'zoom' ? 16 : 0;
          const eid = nid();
          const beh = behaviours(a);
          effs += `<p:par><p:cTn id="${eid}" presetID="${pid}" presetClass="${a.cls}" presetSubtype="${sub}" fill="hold"${hasText(a.target) ? ' grpId="0"' : ''} nodeType="${node}"><p:stCondLst><p:cond delay="${Math.round(a.delay * 1000)}"/></p:stCondLst><p:childTnLst>${beh}</p:childTnLst></p:cTn></p:par>`;
        }
        inner += `<p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst><p:cond delay="${Math.round(g.start * 1000)}"/></p:stCondLst><p:childTnLst>${effs}</p:childTnLst></p:cTn></p:par>`;
      }
      xml += `<p:par><p:cTn id="${nid()}" fill="hold"><p:stCondLst>${cond}</p:stCondLst><p:childTnLst>${inner}</p:childTnLst></p:cTn></p:par>`;
    }
    // cTn ids must be unique; our ids were allocated in nesting order which is fine (they need not be sequential in document order)
    const bld = [...new Set(anims.map(a => a.target))].filter(hasText).map(t => `<p:bldP spid="${spid(t)}" grpId="0"${hasText(t) === 2 ? ' animBg="1"' : ''}/>`).join('');
    let k = 1; xml = xml.replace(/<p:cTn id="\d+"/g, () => `<p:cTn id="${++k + 1}"`);
    return `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${xml}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>${bld ? `<p:bldLst>${bld}</p:bldLst>` : ''}</p:timing>`;
  }

  /* ---------- theme / master / layouts ---------- */
  function themeXml(t, name) {
    const c = t.colors, sc = k => `<a:${k}><a:srgbClr val="${(c[k] || '#000000').slice(1).toUpperCase()}"/></a:${k}>`;
    const dk1 = `<a:dk1><a:srgbClr val="${c.dk1.slice(1).toUpperCase()}"/></a:dk1>`, lt1 = `<a:lt1><a:srgbClr val="${c.lt1.slice(1).toUpperCase()}"/></a:lt1>`;
    const fnt = f => `<a:latin typeface="${esc(f)}"/><a:ea typeface=""/><a:cs typeface=""/>`;
    const ph = (inner) => `<a:solidFill><a:schemeClr val="phClr">${inner}</a:schemeClr></a:solidFill>`;
    const grad = (a, b, c2) => `<a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr">${a}</a:schemeClr></a:gs><a:gs pos="50000"><a:schemeClr val="phClr">${b}</a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr">${c2}</a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>`;
    const g1 = grad('<a:lumMod val="110000"/><a:satMod val="105000"/><a:tint val="67000"/>', '<a:lumMod val="105000"/><a:satMod val="103000"/><a:tint val="73000"/>', '<a:lumMod val="105000"/><a:satMod val="109000"/><a:tint val="81000"/>');
    const g2 = grad('<a:satMod val="103000"/><a:lumMod val="102000"/><a:tint val="94000"/>', '<a:satMod val="110000"/><a:lumMod val="100000"/><a:shade val="100000"/>', '<a:lumMod val="99000"/><a:satMod val="120000"/><a:shade val="78000"/>');
    const ln = w => `<a:ln w="${w}" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:prstDash val="solid"/><a:miter lim="800000"/></a:ln>`;
    return HDR + `<a:theme xmlns:a="${NS_A}" name="${esc(name)}"><a:themeElements><a:clrScheme name="${esc(name)}">${dk1}${lt1}${sc('dk2')}${sc('lt2')}${sc('accent1')}${sc('accent2')}${sc('accent3')}${sc('accent4')}${sc('accent5')}${sc('accent6')}${sc('hlink')}${sc('folHlink')}</a:clrScheme>` +
      `<a:fontScheme name="${esc(name)}"><a:majorFont>${fnt(t.fonts.major)}</a:majorFont><a:minorFont>${fnt(t.fonts.minor)}</a:minorFont></a:fontScheme>` +
      `<a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>${g1}${g2}</a:fillStyleLst><a:lnStyleLst>${ln(6350)}${ln(12700)}${ln(19050)}</a:lnStyleLst>` +
      `<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000" algn="ctr" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="63000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst>` +
      `<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>${ph('<a:tint val="95000"/><a:satMod val="170000"/>')}${g2}</a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
  }
  function defRPrXml(s, size) {
    const kids = (s.color ? solid(s.color) : '') + (s.font ? `<a:latin typeface="${esc(font(s.font))}"/>` : '');
    return `<a:defRPr${size != null ? ` sz="${Math.round(size * 100)}"` : ''}${s.b != null ? ` b="${s.b ? 1 : 0}"` : ''}${s.i != null ? ` i="${s.i ? 1 : 0}"` : ''} kern="1200">${kids}</a:defRPr>`;
  }
  // list style levels from a style object {font,size,color,b,align,bullet,lnSp,spB, lv:[{size,bullet}]}
  function lvlsXml(s, n, isList) {
    let x = '';
    for (let i = 0; i < n; i++) {
      const lv = s.lv && s.lv[i] || null;
      const size = lv && lv.size != null ? lv.size : s.size != null ? (i === 0 ? s.size : Math.max(8, s.size - 2 * i)) : null;
      const bullet = lv && lv.bullet != null ? lv.bullet : s.bullet != null ? s.bullet : isList ? null : 'none';
      const on = bullet && bullet !== 'none';
      const marL = bullet != null ? i * 48 + (on ? 36 : 0) : null, ind = bullet != null ? (on ? -36 : 0) : null;
      const attrs = `${marL != null ? ` marL="${E(marL)}" indent="${E(ind)}"` : ''}${s.align ? ` algn="${ALGN[s.align]}"` : ''}`;
      const kids = (s.lnSp != null && s.lnSp !== 1 ? `<a:lnSpc><a:spcPct val="${Math.round(s.lnSp * 100000)}"/></a:lnSpc>` : '') + (s.spB ? `<a:spcBef><a:spcPts val="${PTS(s.spB)}"/></a:spcBef>` : '') + (bullet != null ? bulletXml(bullet) : '') + defRPrXml(s, size);
      x += `<a:lvl${i + 1}pPr${attrs}>${kids}</a:lvl${i + 1}pPr>`;
    }
    return x;
  }
  function masterXml(doc, ctx, opts) {
    const m = doc.master, st = m.styles, map = doc.theme.map || {};
    ctx.ids = 1;
    const tree = m.objects.map(o => shapeXml(doc, ctx, o, opts)).join('') + m.ph.map(o => {
      const id = ctx.nid(o), cat = Model.phCat(o.ph), d = (o.text && o.text.def) || {};
      const lst = cat === 'other' ? `<a:lstStyle>${lvlsXml({ ...d, bullet: 'none' }, 1, false)}</a:lstStyle>` : '<a:lstStyle/>';
      const anchor = cat === 'title' ? (st.title.anchor || 'ctr') : cat === 'body' ? (st.body.anchor || 't') : 'ctr';
      const fit = cat === 'body' ? '<a:normAutofit/>' : '';
      const runs = cat === 'other' && o.ph.type === 'sldNum' ? `<a:fld id="{${guid()}}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld>` : '';
      const txt = cat === 'title' ? '<a:r><a:rPr lang="en-US"/><a:t>Click to edit Master title style</a:t></a:r>' : cat === 'body' ? '<a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r>' : runs;
      return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${PHNAME[o.ph.type] || 'Placeholder'} ${id - 1}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${phXml(o.ph)}</p:nvPr></p:nvSpPr><p:spPr>${xfrm(o)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="${anchor}">${fit}</a:bodyPr>${lst}<a:p>${txt}<a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
    }).join('');
    const clrMap = `<p:clrMap bg1="${map.bg1 || 'lt1'}" tx1="${map.tx1 || 'dk1'}" bg2="${map.bg2 || 'lt2'}" tx2="${map.tx2 || 'dk2'}" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`;
    const lids = doc.layouts.map((l, i) => `<p:sldLayoutId id="${2147483649 + i}" r:id="rId${i + 1}"/>`).join('');
    const tStyle = `<p:titleStyle>${lvlsXml({ ...st.title, bullet: 'none' }, 1, false)}</p:titleStyle>`;
    const bStyle = `<p:bodyStyle>${lvlsXml({ ...st.body }, 9, true)}</p:bodyStyle>`;
    const oStyle = `<p:otherStyle>${lvlsXml({ ...st.other, bullet: 'none', align: undefined }, 1, false)}</p:otherStyle>`;
    return HDR + `<p:sldMaster ${NSDECL}><p:cSld>${bgXml(m.bg, ctx) || '<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>'}<p:spTree>${treeHead()}${tree}</p:spTree></p:cSld>${clrMap}<p:sldLayoutIdLst>${lids}</p:sldLayoutIdLst><p:txStyles>${tStyle}${bStyle}${oStyle}</p:txStyles></p:sldMaster>`;
  }
  const treeHead = () => '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
  function bgXml(bg, ctx) {
    if (!bg) return '';
    return `<p:bg><p:bgPr>${fillXml(bg, ctx)}<a:effectLst/></p:bgPr></p:bg>`;
  }
  const LTYPES = new Set(['title', 'obj', 'secHead', 'twoObj', 'twoTxTwoObj', 'titleOnly', 'blank', 'picTx', 'tx', 'objTx', 'vertTx', 'cust', 'twoColTx', 'objOnly']);
  function layoutXml(doc, lay, ctx, opts, usedTypes) {
    ctx.ids = 1;
    let type = LTYPES.has(lay.kind) ? lay.kind : 'cust';
    if (usedTypes.has(type) && type !== 'cust') type = 'cust'; usedTypes.add(type);
    const tree = lay.objects.map(o => {
      if (!o.ph) return shapeXml(doc, ctx, o, opts);
      const id = ctx.nid(o), d = (o.text && o.text.def) || {}, cat = Model.phCat(o.ph);
      const hasDef = Object.keys(d).length > 0;
      const lst = hasDef ? `<a:lstStyle>${lvlsXml({ ...d }, cat === 'body' ? 5 : 1, cat === 'body' && d.bullet == null)}</a:lstStyle>` : '<a:lstStyle/>';
      const anchor = d.anchor ? ` anchor="${d.anchor}"` : '';
      const prompt = cat === 'title' ? 'Click to edit Master title style' : o.ph.type === 'subTitle' ? 'Click to edit Master subtitle style' : o.ph.type === 'pic' ? '' : 'Click to edit Master text styles';
      const body = o.ph.type === 'pic' ? `<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>` : `<p:txBody><a:bodyPr${anchor}${cat === 'body' && d.size ? '><a:normAutofit/></a:bodyPr>' : '/>'}${lst}<a:p><a:r><a:rPr lang="en-US"/><a:t>${prompt}</a:t></a:r><a:endParaRPr lang="en-US"/></a:p></p:txBody>`;
      return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${PHNAME[o.ph.type] || 'Placeholder'} ${id - 1}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${phXml(o.ph)}</p:nvPr></p:nvSpPr><p:spPr>${xfrm(o)}</p:spPr>${body}</p:sp>`;
    }).join('') + ['dt', 'ftr', 'sldNum'].filter(t => !lay.objects.some(o => o.ph && o.ph.type === t)).map(t => Model.masterPh(doc, t)).filter(Boolean).map(o => {
      const id = ctx.nid(o);
      const run = o.ph.type === 'sldNum' ? `<a:fld id="{${guid()}}" type="slidenum"><a:rPr lang="en-US"/><a:t>‹#›</a:t></a:fld>` : '';
      return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${PHNAME[o.ph.type]} ${id - 1}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr>${phXml(o.ph)}</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p>${run}<a:endParaRPr lang="en-US"/></a:p></p:txBody></p:sp>`;
    }).join('');
    return HDR + `<p:sldLayout ${NSDECL} type="${type}" preserve="1"${lay.hideMaster ? ' showMasterSp="0"' : ''}><p:cSld name="${esc(lay.name)}">${bgXml(lay.bg, ctx)}<p:spTree>${treeHead()}${tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
  }

  /* ---------- package ---------- */
  function relsXml(rels) { return HDR + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${esc(r.target)}"/>`).join('')}</Relationships>`; }
  const EXT = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/gif': 'gif', 'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/webp': 'webp' };
  function b64bytes(dataUrl) {
    const i = dataUrl.indexOf(','); const s = dataUrl.slice(i + 1);
    if (isNode) return new Uint8Array(Buffer.from(s, 'base64'));
    const bin = atob(s); const u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k); return u;
  }
  function write(doc, assets, opts = {}) {
    const { zipSync, strToU8 } = getFflate();
    const files = {}, ct = [];
    const put = (path, str, type) => { files[path] = strToU8(str); if (type) ct.push([path, type]); };
    const W = E(doc.w), H = E(doc.h);
    // media
    const media = new Map(); let mediaN = 0;
    const mediaFor = id => {
      const a = assets && assets[id]; if (!a || !a.data) return null;
      if (media.has(id)) return media.get(id);
      const ext = EXT[a.mime] || 'png'; const path = `ppt/media/image${++mediaN}.${ext}`;
      files[path] = b64bytes(a.data); media.set(id, path); return path;
    };
    const mkCtx = (relsArr, baseIdx) => {
      const imgRel = new Map(); const ids = new Map();
      const ctx = {
        ids: 1, rels: relsArr,
        nid(o) { ctx.ids++; if (o && o.id) ids.set(o.id, ctx.ids); return ctx.ids; },
        spid: oid => ids.get(oid),
        img(assetId) { if (imgRel.has(assetId)) return imgRel.get(assetId); const p = mediaFor(assetId); if (!p) return null; const rid = 'rId' + (relsArr.length + 1); relsArr.push({ id: rid, type: RT('image'), target: '../media/' + p.split('/').pop() }); imgRel.set(assetId, rid); return rid; },
        chart() { return null; },
      };
      return ctx;
    };
    // theme
    put('ppt/theme/theme1.xml', themeXml(doc.theme, doc.theme.name || 'Lumen'), CT.theme);
    // master
    const mRels = doc.layouts.map((l, i) => ({ id: 'rId' + (i + 1), type: RT('slideLayout'), target: `../slideLayouts/slideLayout${i + 1}.xml` }));
    mRels.push({ id: 'rId' + (mRels.length + 1), type: RT('theme'), target: '../theme/theme1.xml' });
    const mctx = mkCtx(mRels); mctx.master = true;
    put('ppt/slideMasters/slideMaster1.xml', masterXml(doc, mctx, opts), CT.master);
    put('ppt/slideMasters/_rels/slideMaster1.xml.rels', relsXml(mRels));
    // layouts
    const usedTypes = new Set();
    doc.layouts.forEach((lay, i) => {
      const rels = [{ id: 'rId1', type: RT('slideMaster'), target: '../slideMasters/slideMaster1.xml' }];
      const ctx = mkCtx(rels); ctx.layout = lay;
      put(`ppt/slideLayouts/slideLayout${i + 1}.xml`, layoutXml(doc, lay, ctx, opts, usedTypes), CT.layout);
      put(`ppt/slideLayouts/_rels/slideLayout${i + 1}.xml.rels`, relsXml(rels));
    });
    // notes master
    const hasNotes = doc.slides.some(s => s.notes && s.notes.trim());
    if (hasNotes) {
      put('ppt/theme/theme2.xml', themeXml(doc.theme, 'Notes'), CT.theme);
      put('ppt/notesMasters/notesMaster1.xml', HDR + `<p:notesMaster ${NSDECL}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${treeHead()}` +
        `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="1143000"/><a:ext cx="5486400" cy="${Math.round(5486400 * doc.h / doc.w)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>` +
        `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="685800" y="4400550"/><a:ext cx="5486400" cy="3600450"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr lang="en-US"/><a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp>` +
        `</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1200" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`, CT.notesMaster);
      put('ppt/notesMasters/_rels/notesMaster1.xml.rels', relsXml([{ id: 'rId1', type: RT('theme'), target: '../theme/theme2.xml' }]));
    }
    // slides
    let chartN = 0;
    doc.slides.forEach((slide, i) => {
      const n = i + 1, li = Math.max(0, doc.layouts.findIndex(l => l.id === slide.layout));
      const rels = [{ id: 'rId1', type: RT('slideLayout'), target: `../slideLayouts/slideLayout${li + 1}.xml` }];
      const ctx = mkCtx(rels); ctx.slide = slide;
      ctx.chart = o => { chartN++; put(`ppt/charts/chart${chartN}.xml`, chartXml(doc, o), CT.chart); const rid = 'rId' + (rels.length + 1); rels.push({ id: rid, type: RT('chart'), target: `../charts/chart${chartN}.xml` }); return rid; };
      let tree = slide.objects.map(o => shapeXml(doc, ctx, o, opts)).join('');
      const f = doc.footer || {}, lay = doc.layouts[li];
      if ((f.num || f.text || f.date) && !(f.skipTitle && lay && lay.kind === 'title')) {
        for (const [t, on, runs] of [['dt', f.date, [{ t: '', fld: 'date' }]], ['ftr', !!f.text, [{ t: f.text }]], ['sldNum', f.num, [{ t: '', fld: 'slidenum' }]]]) {
          const mp = on && Model.masterPh(doc, t); if (!mp) continue;
          tree += shapeXml(doc, ctx, { id: Model.uid(), type: 'shape', geom: 'rect', x: mp.x, y: mp.y, w: mp.w, h: mp.h, rot: 0, ownGeo: true, fill: null, line: null, ph: { ...mp.ph }, text: { paras: [{ runs }] } }, opts);
        }
      }
      const hasText = id => { const o = Model.findObj(slide.objects, id); return o && o.type === 'shape' && (o.text || o.ph) ? (o.fill ? 2 : 1) : 0; };
      const timing = timingXml(slide, ctx.spid, hasText);
      const bg = bgXml(slide.bg, ctx);
      put(`ppt/slides/slide${n}.xml`, HDR + `<p:sld ${NSDECL}${slide.hidden ? ' show="0"' : ''}><p:cSld>${bg}<p:spTree>${treeHead()}${tree}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>${transitionXml(slide.transition)}${timing}</p:sld>`, CT.slide);
      if (hasNotes && slide.notes && slide.notes.trim()) {
        rels.push({ id: 'rId' + (rels.length + 1), type: RT('notesSlide'), target: `../notesSlides/notesSlide${n}.xml` });
        const paras = slide.notes.split('\n').map(l => l ? `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${esc(l)}</a:t></a:r></a:p>` : '<a:p><a:endParaRPr lang="en-US" dirty="0"/></a:p>').join('');
        put(`ppt/notesSlides/notesSlide${n}.xml`, HDR + `<p:notes ${NSDECL}><p:cSld><p:spTree>${treeHead()}<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`, CT.notes);
        put(`ppt/notesSlides/_rels/notesSlide${n}.xml.rels`, relsXml([{ id: 'rId1', type: RT('notesMaster'), target: '../notesMasters/notesMaster1.xml' }, { id: 'rId2', type: RT('slide'), target: `../slides/slide${n}.xml` }]));
      }
      put(`ppt/slides/_rels/slide${n}.xml.rels`, relsXml(rels));
    });
    // presentation
    const pRels = [{ id: 'rId1', type: RT('slideMaster'), target: 'slideMasters/slideMaster1.xml' }];
    doc.slides.forEach((s, i) => pRels.push({ id: 'rId' + (pRels.length + 1), type: RT('slide'), target: `slides/slide${i + 1}.xml` }));
    let nmRel = '';
    if (hasNotes) { nmRel = 'rId' + (pRels.length + 1); pRels.push({ id: nmRel, type: RT('notesMaster'), target: 'notesMasters/notesMaster1.xml' }); }
    pRels.push({ id: 'rId' + (pRels.length + 1), type: RT('presProps'), target: 'presProps.xml' });
    pRels.push({ id: 'rId' + (pRels.length + 1), type: RT('viewProps'), target: 'viewProps.xml' });
    pRels.push({ id: 'rId' + (pRels.length + 1), type: RT('theme'), target: 'theme/theme1.xml' });
    pRels.push({ id: 'rId' + (pRels.length + 1), type: RT('tableStyles'), target: 'tableStyles.xml' });
    const sldIds = doc.slides.map((s, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
    const sizeType = W === 9144000 && H === 6858000 ? ' type="screen4x3"' : '';
    const dts = `<p:defaultTextStyle><a:defPPr><a:defRPr lang="en-US"/></a:defPPr>${[0, 1, 2, 3, 4].map(i => `<a:lvl${i + 1}pPr marL="${i * 457200}" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="1800" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl${i + 1}pPr>`).join('')}</p:defaultTextStyle>`;
    put('ppt/presentation.xml', HDR + `<p:presentation ${NSDECL} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>${hasNotes ? `<p:notesMasterIdLst><p:notesMasterId r:id="${nmRel}"/></p:notesMasterIdLst>` : ''}${sldIds ? `<p:sldIdLst>${sldIds}</p:sldIdLst>` : ''}<p:sldSz cx="${W}" cy="${H}"${sizeType}/><p:notesSz cx="6858000" cy="9144000"/>${dts}</p:presentation>`, CT.pres);
    put('ppt/_rels/presentation.xml.rels', relsXml(pRels));
    put('ppt/presProps.xml', HDR + `<p:presentationPr ${NSDECL}/>`, CT.presProps);
    put('ppt/viewProps.xml', HDR + `<p:viewPr ${NSDECL}><p:normalViewPr><p:restoredLeft sz="15620"/><p:restoredTop sz="94660"/></p:normalViewPr><p:gridSpacing cx="76200" cy="76200"/></p:viewPr>`, CT.viewProps);
    put('ppt/tableStyles.xml', HDR + `<a:tblStyleLst xmlns:a="${NS_A}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>`, CT.tableStyles);
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    put('docProps/core.xml', HDR + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(opts.title || 'Presentation')}</dc:title><dc:creator>Lumen Slides</dc:creator><cp:lastModifiedBy>Lumen Slides</cp:lastModifiedBy><cp:revision>1</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`, CT.core);
    put('docProps/app.xml', HDR + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><TotalTime>0</TotalTime><Words>0</Words><Application>Lumen Slides</Application><PresentationFormat>${doc.w / doc.h > 1.5 ? 'Widescreen' : 'On-screen Show (4:3)'}</PresentationFormat><Paragraphs>0</Paragraphs><Slides>${doc.slides.length}</Slides><Notes>${doc.slides.filter(s => s.notes && s.notes.trim()).length}</Notes><HiddenSlides>${doc.slides.filter(s => s.hidden).length}</HiddenSlides><MMClips>0</MMClips><ScaleCrop>false</ScaleCrop><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>16.0000</AppVersion></Properties>`, CT.app);
    put('_rels/.rels', relsXml([{ id: 'rId1', type: RT('officeDocument'), target: 'ppt/presentation.xml' }, { id: 'rId2', type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', target: 'docProps/core.xml' }, { id: 'rId3', type: RT('extended-properties'), target: 'docProps/app.xml' }]));
    // content types
    const exts = new Set(Object.keys(files).filter(p => p.startsWith('ppt/media/')).map(p => p.split('.').pop()));
    const MIME = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', svg: 'image/svg+xml', webp: 'image/webp' };
    const ctx = HDR + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[...exts].map(e => `<Default Extension="${e}" ContentType="${MIME[e]}"/>`).join('')}${ct.map(([p, t]) => `<Override PartName="/${p}" ContentType="${t}"/>`).join('')}</Types>`;
    files['[Content_Types].xml'] = strToU8(ctx);
    // order: content types first
    const ordered = { '[Content_Types].xml': files['[Content_Types].xml'] };
    for (const k of Object.keys(files)) if (k !== '[Content_Types].xml') ordered[k] = files[k];
    return zipSync(ordered, { level: 6 });
  }
  const PPTXWriter = { write, chartXml, timingXml, transitionXml, themeXml, clr };
  if (isNode) module.exports = PPTXWriter; else root.PPTXWriter = PPTXWriter;
})(typeof self !== 'undefined' ? self : this);
