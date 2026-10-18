'use strict';
/* Lumen Sheets — import/export.
   .xlsx read: SheetJS for values/formulas + our own reader for styles, column widths, row heights, freeze panes,
   conditional formats and merges. .xlsx write: our own writer (styles, formulas with cached values, merges, freeze
   panes, filters, conditional formats) zipped with fflate. .ods via SheetJS. CSV/TSV and HTML tables for paste.
   PDF (pdf-lib) and PNG export render through the same painter as the screen.
   Everything read from a file is treated as data: formulas are only ever parsed by our formula engine. */
(function (root) {
  const F = root.Formula, M = root.SheetModel, Fmt = root.SheetFormat;
  const { K } = M;
  const MAXR = F.MAXR, MAXC = F.MAXC;
  const DEF_W = 72, DEF_H = 20;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  const enc = new TextEncoder(), dec = new TextDecoder();

  /* =================== CSV / TSV =================== */
  function parseDelimited(text, delim) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (!delim) {
      const sample = text.slice(0, 20000).split(/\r?\n/).slice(0, 20);
      const score = d => { const counts = sample.filter(l => l).map(l => l.split(d).length - 1); return counts.length && counts.every(c => c === counts[0]) ? counts[0] * 2 : counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length); };
      delim = ['\t', ',', ';', '|'].map(d => [d, score(d)]).sort((a, b) => b[1] - a[1])[0][0];
    }
    const rows = []; let row = [], cur = '', q = false, i = 0;
    const n = text.length;
    while (i < n) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i += 2; continue; } q = false; i++; continue; }
        cur += ch; i++; continue;
      }
      if (ch === '"' && cur === '') { q = true; i++; continue; }
      if (ch === delim) { row.push(cur); cur = ''; i++; continue; }
      if (ch === '\r' || ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; if (ch === '\r' && text[i + 1] === '\n') i++; i++; continue; }
      cur += ch; i++;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return { rows, delim };
  }
  function readCSV(buf, name) {
    const text = typeof buf === 'string' ? buf : decodeText(buf);
    const { rows } = parseDelimited(text, /\.tsv$/i.test(name || '') ? '\t' : null);
    const wb = M.Workbook.blank(1); const sh = wb.sheets[0];
    sh.name = (name || 'Sheet1').replace(/\.[^.]+$/, '').replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Sheet1';
    wb.begin('Import');
    rows.forEach((row, r) => row.forEach((v, c) => { if (v !== '' && r < MAXR && c < MAXC) wb.input(sh, r, c, v.startsWith('=') ? "'" + v : v); }));
    wb.tx = null; wb.recalc(); wb.undoStack = [];
    autoWidths(sh, wb, 40);
    return wb;
  }
  function decodeText(buf) {
    const u = new Uint8Array(buf);
    if (u[0] === 0xff && u[1] === 0xfe) return new TextDecoder('utf-16le').decode(u);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u); } catch (e) { return new TextDecoder('windows-1252').decode(u); }
  }
  function csvField(s, delim) { return /["\r\n]/.test(s) || s.includes(delim) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function writeCSV(wb, sheet, delim = ',', range) {
    const g = range || wb.usedRange(sheet); if (!g) return '';
    const lines = [];
    for (let r = g.r1; r <= g.r2; r++) {
      const out = [];
      for (let c = g.c1; c <= g.c2; c++) { const v = sheet.value(r, c); out.push(csvField(v == null ? '' : wb.display(sheet, r, c).text, delim)); }
      lines.push(out.join(delim));
    }
    return lines.join('\r\n') + '\r\n';
  }

  /* =================== HTML tables (clipboard) =================== */
  function rangeHTML(wb, sheet, g) {
    let h = '<table style="border-collapse:collapse">';
    for (let r = g.r1; r <= g.r2; r++) {
      if (sheet.rowHidden(r)) continue;
      h += '<tr>';
      for (let c = g.c1; c <= g.c2; c++) {
        if (sheet.hiddenCols.has(c)) continue;
        const cell = sheet.get(r, c), s = cell && cell.s || {}, d = wb.display(sheet, r, c);
        const st = [s.b && 'font-weight:bold', s.i && 'font-style:italic', s.u && 'text-decoration:underline', (d.color || s.color) && 'color:' + (d.color || s.color), s.fill && 'background:' + s.fill, s.ha && 'text-align:' + s.ha, typeof d.v === 'number' && !s.ha && 'text-align:right'].filter(Boolean).join(';');
        h += `<td${st ? ` style="${st}"` : ''}>${esc(d.text).replace(/\n/g, '<br>')}</td>`;
      }
      h += '</tr>';
    }
    return h + '</table>';
  }
  function rangeTSV(wb, sheet, g) {
    const lines = [];
    for (let r = g.r1; r <= g.r2; r++) {
      if (sheet.rowHidden(r)) continue;
      const out = []; for (let c = g.c1; c <= g.c2; c++) { if (sheet.hiddenCols.has(c)) continue; const t = sheet.value(r, c) == null ? '' : wb.display(sheet, r, c).text; out.push(/[\t\n"]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t); }
      lines.push(out.join('\t'));
    }
    return lines.join('\r\n');
  }
  // → [[{text, style}]] from clipboard HTML (DOMParser: scripts never run)
  function parseHTMLTable(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('table'); if (!table) return null;
    const rows = [], spans = [];
    [...table.querySelectorAll('tr')].forEach((tr, ri) => {
      const row = rows[ri] || (rows[ri] = []);
      let ci = 0;
      for (const td of tr.children) {
        if (!/^(TD|TH)$/.test(td.tagName)) continue;
        while (row[ci] !== undefined) ci++;
        td.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
        const text = td.textContent.replace(/ /g, ' ').replace(/^\s*\n|\n\s*$/g, '');
        const css = td.getAttribute('style') || '', s = {};
        const prop = p => { const m = new RegExp('(?:^|;)\\s*' + p + '\\s*:\\s*([^;]+)', 'i').exec(css); return m ? m[1].trim() : null; };
        const fw = prop('font-weight'); if (fw && (/bold/i.test(fw) || +fw >= 600) || td.querySelector('b,strong') || td.tagName === 'TH') s.b = 1;
        if (/italic/i.test(prop('font-style') || '') || td.querySelector('i,em')) s.i = 1;
        const col = toHex(prop('color')); if (col && col !== '#000000') s.color = col;
        const bg = toHex(prop('background-color') || prop('background')); if (bg && bg !== '#ffffff') s.fill = bg;
        const ta = prop('text-align'); if (/^(left|center|right)$/.test(ta || '')) s.ha = ta;
        row[ci] = { text, style: Object.keys(s).length ? s : null };
        const cs = Math.min(50, +td.getAttribute('colspan') || 1), rs = Math.min(500, +td.getAttribute('rowspan') || 1);
        if (cs > 1 || rs > 1) spans.push({ r1: ri, c1: ci, r2: ri + rs - 1, c2: ci + cs - 1 });
        for (let a = 0; a < rs; a++) for (let b = 0; b < cs; b++) { if (!a && !b) continue; const rr = rows[ri + a] || (rows[ri + a] = []); rr[ci + b] = null; }
        ci += cs;
      }
    });
    return { rows: rows.map(r => Array.from(r, x => x === undefined ? null : x)), merges: spans };
  }
  function toHex(c) {
    if (!c) return null; c = c.trim();
    let m = /^#([0-9a-f]{6})$/i.exec(c); if (m) return '#' + m[1].toLowerCase();
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c); if (m) return ('#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toLowerCase();
    m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/i.exec(c); if (m) { if (m[4] != null && +m[4] === 0) return null; return '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join(''); }
    const named = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', gray: '#808080', grey: '#808080', orange: '#ffa500', purple: '#800080' };
    return named[c.toLowerCase()] || null;
  }

  /* =================== XLSX write (own writer) =================== */
  const XLFN = new Set('XLOOKUP XMATCH IFS SWITCH CONCAT TEXTJOIN MAXIFS MINIFS SEQUENCE RANDARRAY LET IFNA STDEV.S STDEV.P VAR.S VAR.P MODE.SNGL MODE.MULT PERCENTILE.INC PERCENTILE.EXC QUARTILE.INC QUARTILE.EXC RANK.EQ RANK.AVG NORM.DIST NORM.S.DIST NORM.INV NORM.S.INV CEILING.MATH FLOOR.MATH ISOWEEKNUM DAYS NUMBERVALUE UNICHAR UNICODE TEXTBEFORE TEXTAFTER TEXTSPLIT VSTACK HSTACK TAKE DROP COVARIANCE.P COVARIANCE.S FORECAST.LINEAR XOR BASE DECIMAL ARABIC COMBINA SHEET SHEETS FORMULATEXT ISFORMULA RRI PDURATION GAMMA EXPON.DIST BINOM.DIST POISSON.DIST GAMMALN.PRECISE CEILING.PRECISE FLOOR.PRECISE MUNIT ERF.PRECISE'.split(' '));
  const XLWS = new Set(['FILTER', 'SORT', 'SORTBY', 'UNIQUE']);
  function toXlsxFormula(f) {
    let toks; try { toks = F.tokenize(f); } catch (e) { return f; }
    let out = '', pos = 0;
    for (const t of toks) {
      if (t.t !== 'fn') continue;
      const pre = XLWS.has(t.v) ? '_xlfn._xlws.' : XLFN.has(t.v) ? '_xlfn.' : '';
      if (!pre) continue;
      out += f.slice(pos, t.s) + pre + t.v; pos = t.s + f.slice(t.s).match(/^[A-Za-z0-9_.\\]+/)[0].length;
    }
    return out + f.slice(pos);
  }
  const BUILTIN_NF = { 'General': 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '0%': 9, '0.00%': 10, '0.00E+00': 11, '# ?/?': 12, '# ??/??': 13, 'm/d/yyyy': 14, 'd-mmm-yy': 15, 'd-mmm': 16, 'mmm-yy': 17, 'h:mm AM/PM': 18, 'h:mm:ss AM/PM': 19, 'h:mm': 20, 'h:mm:ss': 21, 'm/d/yyyy h:mm': 22, '#,##0 ;(#,##0)': 37, '#,##0.00;(#,##0.00)': 39, 'mm:ss': 45, '[h]:mm:ss': 46, '@': 49 };
  const argb = c => 'FF' + c.slice(1).toUpperCase();
  function writeXlsx(wb) {
    const files = {};
    const sst = [], sstIdx = new Map();
    const si = s => { let i = sstIdx.get(s); if (i == null) { i = sst.length; sst.push(s); sstIdx.set(s, i); } return i; };
    // style tables
    const fonts = ['<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'], fontIdx = new Map([['', 0]]);
    const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'], fillIdx = new Map([['', 0]]);
    const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'], borderIdx = new Map([['', 0]]);
    const numFmts = [], nfIdx = new Map();
    const xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'], xfIdx = new Map([['', 0]]);
    const dxfs = [];
    const getIdx = (map, list, key, xml) => { let i = map.get(key); if (i == null) { i = list.length; list.push(xml); map.set(key, i); } return i; };
    const fontXml = s => `<font>${s.b ? '<b/>' : ''}${s.i ? '<i/>' : ''}${s.st ? '<strike/>' : ''}${s.u ? '<u/>' : ''}<sz val="${s.sz || 11}"/>${s.color ? `<color rgb="${argb(s.color)}"/>` : '<color theme="1"/>'}<name val="${esc(s.font || 'Calibri')}"/><family val="2"/></font>`;
    const bXml = (tag, b) => b ? `<${tag} style="${b.style}"><color rgb="${argb(b.color || '#000000')}"/></${tag}>` : `<${tag}/>`;
    function xfOf(s) {
      if (!s) return 0;
      const key = JSON.stringify(s); if (xfIdx.has(key)) return xfIdx.get(key);
      const fk = JSON.stringify([s.b, s.i, s.u, s.st, s.sz, s.color, s.font]);
      const fontId = (s.b || s.i || s.u || s.st || s.sz || s.color || s.font) ? getIdx(fontIdx, fonts, fk, fontXml(s)) : 0;
      const fillId = s.fill ? getIdx(fillIdx, fills, s.fill, `<fill><patternFill patternType="solid"><fgColor rgb="${argb(s.fill)}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
      const bk = JSON.stringify([s.bl, s.br, s.bt, s.bb]);
      const borderId = (s.bl || s.br || s.bt || s.bb) ? getIdx(borderIdx, borders, bk, `<border>${bXml('left', s.bl)}${bXml('right', s.br)}${bXml('top', s.bt)}${bXml('bottom', s.bb)}<diagonal/></border>`) : 0;
      let numFmtId = 0;
      if (s.nf) { if (BUILTIN_NF[s.nf] != null) numFmtId = BUILTIN_NF[s.nf]; else { numFmtId = nfIdx.get(s.nf); if (numFmtId == null) { numFmtId = 164 + numFmts.length; numFmts.push(s.nf); nfIdx.set(s.nf, numFmtId); } } }
      const al = (s.ha || s.va || s.wrap || s.indent) ? `<alignment${s.ha ? ` horizontal="${s.ha}"` : ''}${s.va ? ` vertical="${s.va === 'middle' ? 'center' : s.va}"` : ''}${s.wrap ? ' wrapText="1"' : ''}${s.indent ? ` indent="${s.indent}"` : ''}/>` : '';
      const xml = `<xf numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${numFmtId ? ' applyNumberFormat="1"' : ''}${fontId ? ' applyFont="1"' : ''}${fillId ? ' applyFill="1"' : ''}${borderId ? ' applyBorder="1"' : ''}${al ? ' applyAlignment="1">' + al + '</xf>' : '/>'}`;
      const i = xfs.length; xfs.push(xml); xfIdx.set(key, i); return i;
    }
    const dxfOf = st => { st = st || {}; dxfs.push(`<dxf>${st.b || st.i || st.color ? `<font>${st.b ? '<b/>' : ''}${st.i ? '<i/>' : ''}${st.color ? `<color rgb="${argb(st.color)}"/>` : ''}</font>` : ''}${st.fill ? `<fill><patternFill><bgColor rgb="${argb(st.fill)}"/></patternFill></fill>` : ''}</dxf>`); return dxfs.length - 1; };
    const sheetNames = wb.sheets.map(s => s.name);
    const sheetXml = wb.sheets.map((sh, si_) => {
      const b = sh.bounds();
      const rowsXml = [];
      // spilled values are written as legacy array formulas (anchor + cached values)
      const spillAnchors = new Map();
      for (const [k, cell] of sh.cells) if (cell.spill) spillAnchors.set(k, cell.spill);
      const keys = new Set([...sh.cells.keys(), ...sh.spill.keys()]);
      const byRow = new Map();
      for (const k of keys) { const r = Math.floor(k / MAXC); let a = byRow.get(r); if (!a) byRow.set(r, a = []); a.push(k); }
      const allRows = new Set([...byRow.keys(), ...sh.rowH.keys(), ...sh.hiddenRows, ...sh.filtered]);
      for (const r of [...allRows].sort((a, c) => a - c)) {
        if (r > MAXR - 1) continue;
        const ks = (byRow.get(r) || []).sort((a, c) => a - c);
        let cx = '';
        for (const k of ks) {
          const c = k % MAXC, ref = F.addr(r, c), cell = sh.cells.get(k);
          const s = xfOf(cell && cell.s); const sAttr = s ? ` s="${s}"` : '';
          if (cell && cell.f != null) {
            const v = sh.value(r, c);
            const sp = spillAnchors.get(k);
            const fx = `<f${sp ? ` t="array" ref="${F.rangeText({ r1: r, c1: c, r2: r + sp.rows - 1, c2: c + sp.cols - 1 })}"` : ''}>${esc(toXlsxFormula(cell.f))}</f>`;
            if (typeof v === 'number') cx += `<c r="${ref}"${sAttr}>${fx}<v>${v}</v></c>`;
            else if (typeof v === 'boolean') cx += `<c r="${ref}"${sAttr} t="b">${fx}<v>${v ? 1 : 0}</v></c>`;
            else if (v instanceof F.FErr) cx += `<c r="${ref}"${sAttr} t="e">${fx}<v>${['#CIRC!', '#SPILL!', '#CALC!'].includes(v.code) ? '#VALUE!' : esc(v.code)}</v></c>`;
            else cx += `<c r="${ref}"${sAttr} t="str">${fx}<v>${esc(v == null ? '' : v)}</v></c>`;
            continue;
          }
          const v = cell ? cell.v : sh.value(r, c);
          if (v == null) { if (s) cx += `<c r="${ref}"${sAttr}/>`; continue; }
          if (typeof v === 'number') cx += `<c r="${ref}"${sAttr}><v>${v}</v></c>`;
          else if (typeof v === 'boolean') cx += `<c r="${ref}"${sAttr} t="b"><v>${v ? 1 : 0}</v></c>`;
          else if (v instanceof F.FErr) cx += `<c r="${ref}"${sAttr} t="e"><v>${esc(v.code)}</v></c>`;
          else cx += `<c r="${ref}"${sAttr} t="s"><v>${si(String(v))}</v></c>`;
        }
        const ht = sh.rowH.get(r), hid = sh.hiddenRows.has(r) || sh.filtered.has(r);
        rowsXml.push(`<row r="${r + 1}"${ht != null ? ` ht="${(ht * 0.75).toFixed(2)}" customHeight="1"` : ''}${hid ? ' hidden="1"' : ''}>${cx}</row>`);
      }
      const dim = b.r >= 0 ? F.rangeText({ r1: 0, c1: 0, r2: b.r, c2: Math.max(0, b.c) }) : 'A1';
      const fz = sh.freeze; let pane = '';
      if (fz.r || fz.c) { const ap = fz.r && fz.c ? 'bottomRight' : fz.r ? 'bottomLeft' : 'topRight'; pane = `<pane${fz.c ? ` xSplit="${fz.c}"` : ''}${fz.r ? ` ySplit="${fz.r}"` : ''} topLeftCell="${F.addr(fz.r, fz.c)}" activePane="${ap}" state="frozen"/><selection pane="${ap}"/>`; }
      const view = `<sheetViews><sheetView workbookViewId="0"${si_ === wb.active ? ' tabSelected="1"' : ''}${sh.showGrid ? '' : ' showGridLines="0"'}${sh.zoom && sh.zoom !== 1 ? ` zoomScale="${Math.round(sh.zoom * 100)}"` : ''}>${pane}</sheetView></sheetViews>`;
      const colIdx = [...new Set([...sh.colW.keys(), ...sh.hiddenCols])].sort((a, c) => a - c);
      const cols = colIdx.length ? '<cols>' + colIdx.map(c => { const w = sh.colW.has(c) ? sh.colW.get(c) : DEF_W; return `<col min="${c + 1}" max="${c + 1}" width="${Math.max(0, (w - 5) / 7).toFixed(2)}" customWidth="1"${sh.hiddenCols.has(c) ? ' hidden="1"' : ''}/>`; }).join('') + '</cols>' : '';
      const af = sh.filter ? `<autoFilter ref="${F.rangeText(sh.filter.range)}"/>` : '';
      const merges = sh.merges.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map(m => `<mergeCell ref="${F.rangeText(m)}"/>`).join('')}</mergeCells>` : '';
      let prio = 1;
      const cfXml = sh.cf.map(rule => {
        const sq = F.rangeText(rule.range), tl = F.addr(rule.range.r1, rule.range.c1);
        const fv = v => { const p = Fmt.parseInput(String(v ?? '')); return typeof p.v === 'number' ? String(p.v) : '"' + String(v ?? '').replace(/"/g, '""') + '"'; };
        let x = '';
        const P = prio++;
        switch (rule.type) {
          case 'cell': { const op = { '>': 'greaterThan', '<': 'lessThan', '>=': 'greaterThanOrEqual', '<=': 'lessThanOrEqual', '=': 'equal', '<>': 'notEqual', between: 'between', notBetween: 'notBetween' }[rule.op]; if (!op) return ''; x = `<cfRule type="cellIs" dxfId="${dxfOf(rule.style)}" priority="${P}" operator="${op}"><formula>${esc(fv(rule.v1))}</formula>${/etween/.test(op) ? `<formula>${esc(fv(rule.v2))}</formula>` : ''}</cfRule>`; break; }
          case 'text': { const q = '"' + String(rule.v1 || '').replace(/"/g, '""') + '"'; const m = { contains: ['containsText', 'containsText', `NOT(ISERROR(SEARCH(${q},${tl})))`], notContains: ['notContainsText', 'notContains', `ISERROR(SEARCH(${q},${tl}))`], begins: ['beginsWith', 'beginsWith', `LEFT(${tl},LEN(${q}))=${q}`], ends: ['endsWith', 'endsWith', `RIGHT(${tl},LEN(${q}))=${q}`] }[rule.op || 'contains']; x = `<cfRule type="${m[0]}" dxfId="${dxfOf(rule.style)}" priority="${P}" operator="${m[1]}" text="${esc(rule.v1 || '')}"><formula>${esc(m[2])}</formula></cfRule>`; break; }
          case 'blank': x = `<cfRule type="${rule.op === 'notBlank' ? 'notContainsBlanks' : 'containsBlanks'}" dxfId="${dxfOf(rule.style)}" priority="${P}"><formula>${rule.op === 'notBlank' ? 'LEN(TRIM(' + tl + '))&gt;0' : 'LEN(TRIM(' + tl + '))=0'}</formula></cfRule>`; break;
          case 'error': x = `<cfRule type="containsErrors" dxfId="${dxfOf(rule.style)}" priority="${P}"><formula>ISERROR(${tl})</formula></cfRule>`; break;
          case 'top': x = `<cfRule type="top10" dxfId="${dxfOf(rule.style)}" priority="${P}" rank="${Math.round(+rule.v1 || 10)}"${rule.pct ? ' percent="1"' : ''}${rule.bottom ? ' bottom="1"' : ''}/>`; break;
          case 'avg': x = `<cfRule type="aboveAverage" dxfId="${dxfOf(rule.style)}" priority="${P}"${rule.op === 'below' ? ' aboveAverage="0"' : ''}/>`; break;
          case 'dup': x = `<cfRule type="${rule.op === 'unique' ? 'uniqueValues' : 'duplicateValues'}" dxfId="${dxfOf(rule.style)}" priority="${P}"/>`; break;
          case 'formula': x = `<cfRule type="expression" dxfId="${dxfOf(rule.style)}" priority="${P}"><formula>${esc(toXlsxFormula(String(rule.v1 || '').replace(/^=/, '')))}</formula></cfRule>`; break;
          case 'scale': { const cs = rule.colors || ['#f8696b', '#63be7b']; x = `<cfRule type="colorScale" priority="${P}"><colorScale><cfvo type="min"/>${cs.length === 3 ? '<cfvo type="percentile" val="50"/>' : ''}<cfvo type="max"/>${cs.map(c => `<color rgb="${argb(c)}"/>`).join('')}</colorScale></cfRule>`; break; }
          case 'bar': x = `<cfRule type="dataBar" priority="${P}"><dataBar><cfvo type="min"/><cfvo type="max"/><color rgb="${argb(rule.color || '#638ec6')}"/></dataBar></cfRule>`; break;
          case 'icons': x = `<cfRule type="iconSet" priority="${P}"><iconSet iconSet="${{ arrows: '3Arrows', traffic: '3TrafficLights1', flags: '3Flags' }[rule.set || 'arrows']}"><cfvo type="percent" val="0"/><cfvo type="percent" val="33"/><cfvo type="percent" val="67"/></iconSet></cfRule>`; break;
        }
        return x ? `<conditionalFormatting sqref="${sq}">${x}</conditionalFormatting>` : '';
      }).join('');
      const tab = sh.tabColor ? `<sheetPr><tabColor rgb="${argb(sh.tabColor)}"/></sheetPr>` : '';
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${tab}<dimension ref="${dim}"/>${view}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowsXml.join('')}</sheetData>${af}${merges}${cfXml}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>`;
    });
    const n = wb.sheets.length;
    sheetXml.forEach((x, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = x; });
    const absRef = t => F.mapRefs(t, x => ({ ...x, ar1: true, ac1: true, ar2: true, ac2: true }));
    const names = [...wb.names.values()].map(d => `<definedName name="${esc(d.name)}">${esc(absRef(d.ref))}</definedName>`)
      .concat(wb.sheets.map((s, i) => s.filter ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(absRef(F.rangeText(s.filter.range, s.name)))}</definedName>` : '').filter(Boolean));
    files['xl/workbook.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="${wb.active}"/></bookViews><sheets>${sheetNames.map((nm, i) => `<sheet name="${esc(nm)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>${names.length ? '<definedNames>' + names.join('') + '</definedNames>' : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
    files['xl/_rels/workbook.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheetNames.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
    files['xl/styles.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts.length ? `<numFmts count="${numFmts.length}">${numFmts.map((f, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(f)}"/>`).join('')}</numFmts>` : ''}<fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="${borders.length}">${borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="${dxfs.length}">${dxfs.join('')}</dxfs></styleSheet>`;
    files['xl/sharedStrings.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sst.length}" uniqueCount="${sst.length}">${sst.map(s => `<si><t${/^\s|\s$|\n/.test(s) ? ' xml:space="preserve"' : ''}>${esc(s)}</t></si>`).join('')}</sst>`;
    files['_rels/.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    files['docProps/core.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Lumen Sheets</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
    files['docProps/app.xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Lumen Sheets</Application></Properties>`;
    files['[Content_Types].xml'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetNames.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
    const z = {}; for (const [k, v] of Object.entries(files)) z[k] = enc.encode(v);
    return root.fflate.zipSync(z, { level: 6 });
  }

  /* =================== XLSX / ODS read =================== */
  const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '800000', '008000', '000080', '808000', '800080', '008080', 'C0C0C0', '808080', '9999FF', '993366', 'FFFFCC', 'CCFFFF', '660066', 'FF8080', '0066CC', 'CCCCFF', '000080', 'FF00FF', 'FFFF00', '00FFFF', '800080', '800000', '008080', '0000FF', '00CCFF', 'CCFFFF', 'CCFFCC', 'FFFF99', '99CCFF', 'FF99CC', 'CC99FF', 'FFCC99', '3366FF', '33CCCC', '99CC00', 'FFCC00', 'FF9900', 'FF6600', '666699', '969696', '003366', '339966', '003300', '333300', '993300', '993366', '333399', '333333'];
  function tintHex(hex, tint) {
    if (!tint) return hex;
    let [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint;
    const hue = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    if (s === 0) r = g = b = l; else { const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; r = hue(p, q, h + 1 / 3); g = hue(p, q, h); b = hue(p, q, h - 1 / 3); }
    return '#' + [r, g, b].map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
  }
  function colorOf(el, theme) {
    if (!el) return null;
    const rgb = el.getAttribute('rgb'), th = el.getAttribute('theme'), ix = el.getAttribute('indexed'), tint = parseFloat(el.getAttribute('tint') || '0');
    let hex = null;
    if (rgb && /^[0-9a-f]{6,8}$/i.test(rgb)) hex = '#' + rgb.slice(-6).toLowerCase();
    else if (th != null && theme[+th]) hex = theme[+th];
    else if (ix != null && INDEXED[+ix]) hex = '#' + INDEXED[+ix].toLowerCase();
    return hex ? tintHex(hex, tint) : null;
  }
  const xmlDoc = s => new DOMParser().parseFromString(s, 'application/xml');
  const kids = (el, tag) => el ? [...el.children].filter(c => c.localName === tag) : [];
  const kid = (el, tag) => kids(el, tag)[0] || null;
  function parseStyles(zipFiles) {
    const txt = zipFiles['xl/styles.xml']; if (!txt) return { xf: [], dxf: [] };
    const thx = zipFiles['xl/theme/theme1.xml'];
    let theme = [];
    if (thx) {
      const d = xmlDoc(dec.decode(thx)), cs = d.getElementsByTagNameNS('*', 'clrScheme')[0];
      if (cs) {
        const get = n => { const e = kid(cs, n); if (!e) return null; const c = e.firstElementChild; const v = c && (c.getAttribute('lastClr') || c.getAttribute('val')); return v ? '#' + v.toLowerCase() : null; };
        theme = [get('lt1'), get('dk1'), get('lt2'), get('dk2'), get('accent1'), get('accent2'), get('accent3'), get('accent4'), get('accent5'), get('accent6'), get('hlink'), get('folHlink')];
      }
    }
    const d = xmlDoc(dec.decode(txt)), ss = d.documentElement;
    const nfMap = new Map(Object.entries(BUILTIN_NF).map(([k, v]) => [v, k]));
    kids(kid(ss, 'numFmts'), 'numFmt').forEach(n => nfMap.set(+n.getAttribute('numFmtId'), n.getAttribute('formatCode')));
    const fontOf = f => { const o = {}; if (kid(f, 'b') && kid(f, 'b').getAttribute('val') !== '0') o.b = 1; if (kid(f, 'i') && kid(f, 'i').getAttribute('val') !== '0') o.i = 1; if (kid(f, 'u')) o.u = 1; if (kid(f, 'strike')) o.st = 1; const sz = kid(f, 'sz'); if (sz && +sz.getAttribute('val') !== 11) o.sz = +sz.getAttribute('val'); const nm = kid(f, 'name'); if (nm && nm.getAttribute('val') !== 'Calibri') o.font = nm.getAttribute('val'); const c = colorOf(kid(f, 'color'), theme); if (c && c !== '#000000') o.color = c; return o; };
    const fillOf = f => { const p = kid(f, 'patternFill'); if (!p) return null; const t = p.getAttribute('patternType'); if (!t || t === 'none' || t === 'gray125') { const bg = colorOf(kid(p, 'bgColor'), theme); return t ? null : bg; } return colorOf(kid(p, 'fgColor'), theme) || colorOf(kid(p, 'bgColor'), theme); };
    const borderOf = b => { const o = {}; [['left', 'bl'], ['right', 'br'], ['top', 'bt'], ['bottom', 'bb']].forEach(([t, k]) => { const e = kid(b, t); const st = e && e.getAttribute('style'); if (st) o[k] = { style: ['thin', 'medium', 'thick', 'dashed', 'dotted', 'double', 'hair'].includes(st) ? st : /dash/i.test(st) ? 'dashed' : /dot/i.test(st) ? 'dotted' : 'thin', color: colorOf(kid(e, 'color'), theme) || '#000000' }; }); return o; };
    const fonts = kids(kid(ss, 'fonts'), 'font').map(fontOf), fills = kids(kid(ss, 'fills'), 'fill').map(fillOf), borders = kids(kid(ss, 'borders'), 'border').map(borderOf);
    const xf = kids(kid(ss, 'cellXfs'), 'xf').map(x => {
      const s = Object.assign({}, fonts[+x.getAttribute('fontId') || 0] || {}, borders[+x.getAttribute('borderId') || 0] || {});
      const fl = fills[+x.getAttribute('fillId') || 0]; if (fl) s.fill = fl;
      const nf = nfMap.get(+x.getAttribute('numFmtId') || 0); if (nf && nf !== 'General') s.nf = nf;
      if (+x.getAttribute('numFmtId') === 14) s.nf = 'm/d/yyyy';
      const al = kid(x, 'alignment');
      if (al) { const h = al.getAttribute('horizontal'), v = al.getAttribute('vertical'); if (['left', 'center', 'right'].includes(h)) s.ha = h; if (h === 'centerContinuous') s.ha = 'center'; if (v === 'top') s.va = 'top'; if (v === 'center') s.va = 'middle'; if (al.getAttribute('wrapText') === '1') s.wrap = 1; const ind = +al.getAttribute('indent'); if (ind) s.indent = ind; }
      return M.sanitizeStyle(s);
    });
    const dxf = kids(kid(ss, 'dxfs'), 'dxf').map(x => { const s = {}; const f = kid(x, 'font'); if (f) Object.assign(s, fontOf(f)); delete s.sz; delete s.font; const fl = kid(x, 'fill'); if (fl) { const p = kid(fl, 'patternFill'); const c = p && (colorOf(kid(p, 'bgColor'), theme) || colorOf(kid(p, 'fgColor'), theme)); if (c) s.fill = c; } return M.sanitizeStyle(s) || {}; });
    return { xf, dxf };
  }
  function sheetPaths(zipFiles) {
    const wbx = zipFiles['xl/workbook.xml'], rels = zipFiles['xl/_rels/workbook.xml.rels']; if (!wbx || !rels) return [];
    const rd = xmlDoc(dec.decode(rels)), map = new Map();
    [...rd.getElementsByTagNameNS('*', 'Relationship')].forEach(r => map.set(r.getAttribute('Id'), r.getAttribute('Target')));
    const wd = xmlDoc(dec.decode(wbx));
    return [...wd.getElementsByTagNameNS('*', 'sheet')].map(s => {
      const id = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || s.getAttribute('r:id');
      let t = map.get(id) || ''; t = t.replace(/^\//, ''); if (!t.startsWith('xl/')) t = 'xl/' + t;
      return { name: s.getAttribute('name'), path: t };
    });
  }
  function readXlsxExtras(sh, xml, styles) {
    // cell style indices (regex: fast on big sheets)
    const cellRe = /<c r="([A-Z]{1,3})(\d+)"([^>]*?)\/?>/g; let m;
    while ((m = cellRe.exec(xml))) {
      const sm = / s="(\d+)"/.exec(m[3]); if (!sm) continue;
      const st = styles.xf[+sm[1]]; if (!st) continue;
      const r = +m[2] - 1, c = F.colIndex(m[1]); if (r >= MAXR || c >= MAXC) continue;
      const k = K(r, c), cell = sh.cells.get(k);
      if (cell) cell.s = st; else sh.cells.set(k, { v: null, s: st });
      sh.grow(r, c);
    }
    const rowRe = /<row ([^>]*)>/g;
    while ((m = rowRe.exec(xml))) {
      const a = m[1], r = +((/\br="(\d+)"/.exec(a) || [])[1]) - 1; if (!(r >= 0)) continue;
      const ht = /\bht="([\d.]+)"/.exec(a), custom = /customHeight="(1|true)"/.test(a);
      if (ht && custom) sh.rowH.set(r, Math.round(+ht[1] / 0.75));
      if (/hidden="(1|true)"/.test(a)) sh.hiddenRows.add(r);
    }
    const sdStart = xml.indexOf('<sheetData'), sdEnd = xml.lastIndexOf('</sheetData>');
    const head = sdStart >= 0 ? xml.slice(0, sdStart) : xml, tail = sdEnd >= 0 ? xml.slice(sdEnd + 12) : '';
    const tag = /<worksheet[^>]*>/.exec(xml); const open = tag ? tag[0] : '<worksheet>';
    const hd = xmlDoc(head + '</worksheet>'.replace(/^/, head.includes('<worksheet') ? '' : open));
    const pane = hd.getElementsByTagNameNS('*', 'pane')[0];
    if (pane && /frozen/.test(pane.getAttribute('state') || '')) sh.freeze = { r: Math.min(1000, +pane.getAttribute('ySplit') || 0), c: Math.min(200, +pane.getAttribute('xSplit') || 0) };
    const sv = hd.getElementsByTagNameNS('*', 'sheetView')[0];
    if (sv) { if (sv.getAttribute('showGridLines') === '0') sh.showGrid = false; const zs = +sv.getAttribute('zoomScale'); if (zs >= 25 && zs <= 400) sh.zoom = zs / 100; }
    const tc = hd.getElementsByTagNameNS('*', 'tabColor')[0]; if (tc && /^[0-9a-f]{8}$/i.test(tc.getAttribute('rgb') || '')) sh.tabColor = '#' + tc.getAttribute('rgb').slice(2).toLowerCase();
    [...hd.getElementsByTagNameNS('*', 'col')].forEach(c => {
      const a = +c.getAttribute('min') - 1, b = Math.min(+c.getAttribute('max') - 1, a + 300), w = parseFloat(c.getAttribute('width'));
      for (let i = a; i <= b && i < MAXC; i++) { if (c.getAttribute('customWidth') === '1' || Math.abs(w - 8.43) > 0.3) if (w > 0) sh.colW.set(i, Math.round(w * 7 + 5)); if (c.getAttribute('hidden') === '1') sh.hiddenCols.add(i); }
    });
    if (tail) {
      const td = xmlDoc(open + tail.replace(/<\/worksheet>\s*$/, '') + '</worksheet>');
      [...td.getElementsByTagNameNS('*', 'mergeCell')].forEach(mc => { const p = F.parseRange(mc.getAttribute('ref')); if (p) sh.merges.push({ r1: p.r1, c1: p.c1, r2: p.r2, c2: p.c2 }); });
      const af = td.getElementsByTagNameNS('*', 'autoFilter')[0]; if (af) { const p = F.parseRange(af.getAttribute('ref') || ''); if (p) sh.filter = { range: { r1: p.r1, c1: p.c1, r2: p.r2, c2: p.c2 }, crit: {} }; }
      const cfs = [];
      [...td.getElementsByTagNameNS('*', 'conditionalFormatting')].forEach(cf => {
        const ranges = (cf.getAttribute('sqref') || '').split(/\s+/).map(F.parseRange).filter(Boolean);
        for (const rule of kids(cf, 'cfRule').sort((a, b) => (+a.getAttribute('priority') || 0) - (+b.getAttribute('priority') || 0))) {
          const t = rule.getAttribute('type'), st = styles.dxf[+rule.getAttribute('dxfId')] || {}, fs = kids(rule, 'formula').map(f => f.textContent);
          const unq = s => /^".*"$/.test(s || '') ? s.slice(1, -1).replace(/""/g, '"') : s;
          let o = null;
          if (t === 'cellIs') { const op = { greaterThan: '>', lessThan: '<', greaterThanOrEqual: '>=', lessThanOrEqual: '<=', equal: '=', notEqual: '<>', between: 'between', notBetween: 'notBetween' }[rule.getAttribute('operator')]; if (op) o = { type: 'cell', op, v1: unq(fs[0]), v2: unq(fs[1]), style: st }; }
          else if (t === 'containsText' || t === 'notContainsText' || t === 'beginsWith' || t === 'endsWith') o = { type: 'text', op: { containsText: 'contains', notContainsText: 'notContains', beginsWith: 'begins', endsWith: 'ends' }[t], v1: rule.getAttribute('text') || '', style: st };
          else if (t === 'containsBlanks' || t === 'notContainsBlanks') o = { type: 'blank', op: t === 'notContainsBlanks' ? 'notBlank' : 'blank', style: st };
          else if (t === 'containsErrors') o = { type: 'error', style: st };
          else if (t === 'top10') o = { type: 'top', v1: rule.getAttribute('rank') || '10', pct: rule.getAttribute('percent') === '1', bottom: rule.getAttribute('bottom') === '1', style: st };
          else if (t === 'aboveAverage') o = { type: 'avg', op: rule.getAttribute('aboveAverage') === '0' ? 'below' : 'above', style: st };
          else if (t === 'duplicateValues' || t === 'uniqueValues') o = { type: 'dup', op: t === 'uniqueValues' ? 'unique' : 'dup', style: st };
          else if (t === 'expression') o = { type: 'formula', v1: (fs[0] || '').replace(/_xlfn\.(_xlws\.)?/g, ''), style: st };
          else if (t === 'colorScale') { const cols = [...rule.getElementsByTagNameNS('*', 'color')].map(c => colorOf(c, [])).filter(Boolean); if (cols.length >= 2) o = { type: 'scale', colors: cols.slice(0, 3) }; }
          else if (t === 'dataBar') { const c = rule.getElementsByTagNameNS('*', 'color')[0]; o = { type: 'bar', color: colorOf(c, []) || '#638ec6' }; }
          else if (t === 'iconSet') { const s = (rule.getElementsByTagNameNS('*', 'iconSet')[0] || { getAttribute: () => '' }).getAttribute('iconSet') || '3TrafficLights1'; o = { type: 'icons', set: /Arrow/.test(s) ? 'arrows' : /Flag/.test(s) ? 'flags' : 'traffic' }; }
          if (o) for (const g of ranges) cfs.push(Object.assign({}, o, { range: { r1: g.r1, c1: g.c1, r2: g.r2, c2: g.c2 } }));
        }
      });
      sh.cf = M.sanitizeCF(cfs);
    }
  }
  function readSpreadsheet(buf, name) {
    const X = root.XLSX;
    const isZip = new Uint8Array(buf, 0, 2)[0] === 0x50 && new Uint8Array(buf, 0, 2)[1] === 0x4b;
    const xwb = X.read(new Uint8Array(buf), { type: 'array', cellFormula: true, cellNF: true, cellStyles: false, cellDates: false, sheetStubs: false, dense: false, WTF: false });
    const wb = new M.Workbook();
    let zipFiles = null, styles = null, paths = [];
    if (isZip && /\.xls[xm]$/i.test(name || '.xlsx')) {
      try { zipFiles = root.fflate.unzipSync(new Uint8Array(buf), { filter: f => /^xl\/(styles|workbook)\.xml$|^xl\/_rels\/|^xl\/theme\/theme1\.xml$|^xl\/worksheets\/[^/]+\.xml$/.test(f.name) }); styles = parseStyles(zipFiles); paths = sheetPaths(zipFiles); }
      catch (e) { console.warn('style import skipped', e); zipFiles = null; }
    }
    xwb.SheetNames.forEach((nm, si) => {
      const ws = xwb.Sheets[nm]; const sh = wb.addSheetRaw(wb.uniqueName(String(nm).slice(0, 31) || 'Sheet' + (si + 1)));
      if (!ws) return;
      const arrayCovered = new Set();
      for (const key of Object.keys(ws)) {
        if (key[0] === '!') continue;
        const p = F.parseAddr(key); if (!p) continue;
        const c = ws[key];
        if (c.F && c.f) { const g = F.parseRange(c.F); if (g) for (let r = g.r1; r <= g.r2; r++) for (let cc = g.c1; cc <= g.c2; cc++) if (r !== p.r || cc !== p.c) arrayCovered.add(K(r, cc)); }
      }
      for (const key of Object.keys(ws)) {
        if (key[0] === '!') continue;
        const p = F.parseAddr(key); if (!p || arrayCovered.has(K(p.r, p.c))) continue;
        const c = ws[key];
        const cell = { v: null, s: null };
        if (c.f) cell.f = String(c.f).replace(/_xlfn\.(_xlws\.)?|_xlws\./g, '').replace(/^=/, '');
        else if (c.t === 'n') cell.v = typeof c.v === 'number' && isFinite(c.v) ? c.v : null;
        else if (c.t === 'b') cell.v = !!c.v;
        else if (c.t === 'e') cell.v = F.errOf(c.w || '') || F.ERR.NA;
        else if (c.t === 'd') cell.v = c.v instanceof Date ? Fmt.dateToSerial(c.v.getFullYear(), c.v.getMonth() + 1, c.v.getDate()) : null;
        else if (c.v != null) cell.v = String(c.v);
        if (c.z && c.z !== 'General' && typeof c.z === 'string') cell.s = { nf: c.z };
        if (cell.v == null && cell.f == null && !cell.s) continue;
        sh.cells.set(K(p.r, p.c), cell); sh.grow(p.r, p.c);
      }
      const path = paths[si] && paths[si].path;
      if (zipFiles && styles && path && zipFiles[path]) {
        try { readXlsxExtras(sh, dec.decode(zipFiles[path]), styles); } catch (e) { console.warn('sheet extras skipped', e); }
        // number formats from SheetJS win where our style has none
        for (const cell of sh.cells.values()) if (cell.s) cell.s = M.sanitizeStyle(cell.s);
      } else {
        (ws['!merges'] || []).forEach(mg => sh.merges.push({ r1: mg.s.r, c1: mg.s.c, r2: mg.e.r, c2: mg.e.c }));
        (ws['!cols'] || []).forEach((col, i) => { if (col && col.wpx) sh.colW.set(i, Math.round(col.wpx)); else if (col && col.wch) sh.colW.set(i, Math.round(col.wch * 7 + 5)); if (col && col.hidden) sh.hiddenCols.add(i); });
        (ws['!rows'] || []).forEach((row, i) => { if (row && row.hpx) sh.rowH.set(i, Math.round(row.hpx)); if (row && row.hidden) sh.hiddenRows.add(i); });
        for (const cell of sh.cells.values()) if (cell.s) cell.s = M.sanitizeStyle(cell.s);
      }
      if (!sh.colW.size) autoWidths(sh, wb, 30);
    });
    if (!wb.sheets.length) wb.addSheetRaw('Sheet1');
    (xwb.Workbook && xwb.Workbook.Names || []).forEach(n => { if (n && n.Name && !/^_xlnm\./.test(n.Name) && n.Sheet == null && typeof n.Ref === 'string' && /^[A-Za-z_][A-Za-z0-9_.]*$/.test(n.Name)) wb.names.set(n.Name.toUpperCase(), { name: n.Name, ref: n.Ref.replace(/^=/, '') }); });
    const act = xwb.Workbook && xwb.Workbook.WBView && xwb.Workbook.WBView[0] && xwb.Workbook.WBView[0].activeTab; if (act != null) wb.active = Math.min(wb.sheets.length - 1, act | 0);
    wb.rebuildGraph(); wb.recalc(); wb.undoStack = []; wb.redoStack = [];
    for (const sh of wb.sheets) if (sh.filter) wb.applyFilter(sh);
    wb.undoStack = [];
    return wb;
  }
  function writeODS(wb) {
    const X = root.XLSX, out = X.utils.book_new();
    wb.sheets.forEach(sh => {
      const ws = {}; const b = sh.bounds();
      for (const [k, cell] of sh.cells) {
        const r = Math.floor(k / MAXC), c = k % MAXC, a = F.addr(r, c), v = sh.value(r, c);
        const o = {};
        if (typeof v === 'number') { o.t = 'n'; o.v = v; } else if (typeof v === 'boolean') { o.t = 'b'; o.v = v; } else if (v instanceof F.FErr) { o.t = 'e'; o.v = 0x2a; o.w = v.code; } else if (v != null) { o.t = 's'; o.v = String(v); } else if (cell.f == null) continue; else { o.t = 's'; o.v = ''; }
        if (cell.f != null) o.f = cell.f;
        // SheetJS' ODS number-style writer only copes with plain numeric codes; dates are written as real dates
        const nf = cell.s && cell.s.nf;
        if (nf && o.t === 'n' && Fmt.isDateFormat(nf) && v >= 1) { const p = Fmt.serialToParts(v); o.t = 'd'; o.v = new Date(Date.UTC(p.y, p.m - 1, p.d, p.H, p.M, p.S)); }
        else if (nf && /^[$#0.,%]+$/.test(nf)) o.z = nf;
        ws[a] = o;
      }
      for (const k of sh.spill.keys()) { const r = Math.floor(k / MAXC), c = k % MAXC, v = sh.value(r, c); if (v != null && !(v instanceof F.FErr)) ws[F.addr(r, c)] = typeof v === 'number' ? { t: 'n', v } : typeof v === 'boolean' ? { t: 'b', v } : { t: 's', v: String(v) }; }
      ws['!ref'] = b.r >= 0 ? F.rangeText({ r1: 0, c1: 0, r2: b.r, c2: Math.max(0, b.c) }) : 'A1';
      if (sh.merges.length) ws['!merges'] = sh.merges.map(m => ({ s: { r: m.r1, c: m.c1 }, e: { r: m.r2, c: m.c2 } }));
      const cols = []; for (const [c, w] of sh.colW) cols[c] = { wpx: w }; if (cols.length) ws['!cols'] = cols;
      X.utils.book_append_sheet(out, ws, sh.name);
    });
    return new Uint8Array(X.write(out, { bookType: 'ods', type: 'array' }));
  }
  function autoWidths(sh, wb, maxRows) {
    const b = sh.bounds(); if (b.r < 0) return;
    const cv = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null; if (!cv) return;
    for (let c = 0; c <= Math.min(b.c, 200); c++) {
      let w = 0;
      for (let r = 0; r <= Math.min(b.r, maxRows); r++) { const v = sh.value(r, c); if (v == null) continue; const cell = sh.get(r, c); if (cell && cell.s && cell.s.wrap) continue; if (sh.mergeAt(r, c)) continue; w = Math.max(w, root.SheetPaint.textW(cv, root.SheetPaint.fontOf(cell && cell.s, 1), wb.display(sh, r, c).text)); }
      if (w + 12 > DEF_W) sh.colW.set(c, Math.min(320, Math.ceil(w + 12)));
    }
  }

  /* =================== render to images (PNG / PDF) =================== */
  function layout(sheet, g) {
    const cols = [], rows = []; let x = 0, y = 0;
    for (let c = g.c1; c <= g.c2; c++) { if (sheet.hiddenCols.has(c)) continue; const w = sheet.colW.has(c) ? sheet.colW.get(c) : DEF_W; if (w <= 0) continue; cols.push({ i: c, x, w }); x += w; }
    for (let r = g.r1; r <= g.r2; r++) { if (sheet.rowHidden(r)) continue; const h = sheet.rowH.has(r) ? sheet.rowH.get(r) : DEF_H; if (h <= 0) continue; rows.push({ i: r, y, h }); y += h; }
    return { cols, rows, W: x, H: y };
  }
  function printRange(wb, sheet) {
    const g = wb.usedRange(sheet); if (!g) return null;
    // include charts in the area
    const L = layout(sheet, { r1: 0, c1: 0, r2: g.r2 + 60, c2: g.c2 + 30 });
    let maxX = 0, maxY = 0; for (const ch of sheet.charts) { maxX = Math.max(maxX, ch.x + ch.w); maxY = Math.max(maxY, ch.y + ch.h); }
    let r2 = g.r2, c2 = g.c2;
    for (const col of L.cols) if (col.x < maxX) c2 = Math.max(c2, col.i);
    for (const row of L.rows) if (row.y < maxY) r2 = Math.max(r2, row.i);
    return { r1: 0, c1: 0, r2, c2 };
  }
  // paint a block of rows/cols (already positioned relative to the block) into ctx at scale s
  function paintBlock(ctx, wb, sheet, rows, cols, s, opts) {
    const rr = rows.map(r => ({ i: r.i, y: r.y * s, h: r.h * s })), cc = cols.map(c => ({ i: c.i, x: c.x * s, w: c.w * s }));
    const px = new Map(cc.map(c => [c.i, c.x])), py = new Map(rr.map(r => [r.i, r.y]));
    const posX = c => { if (px.has(c)) return px.get(c); const last = cc[cc.length - 1]; return c > last.i ? last.x + last.w : cc[0].x; };
    const posY = r => { if (py.has(r)) return py.get(r); const last = rr[rr.length - 1]; return r > last.i ? last.y + last.h : rr[0].y; };
    root.SheetPaint.paintCells(ctx, wb, sheet, rr, cc, { z: s, grid: opts.grid, filterBtns: false, posX, posY });
    if (opts.charts !== false && sheet.charts.length) {
      // chart positions are in sheet px from A1; block offset = position of its first row/col in the sheet
      const full = layout(sheet, { r1: 0, c1: 0, r2: rows[rows.length - 1].i, c2: cols[cols.length - 1].i });
      const ox = (full.cols.find(c => c.i === cols[0].i) || { x: 0 }).x, oy = (full.rows.find(r => r.i === rows[0].i) || { y: 0 }).y;
      for (const ch of sheet.charts) {
        const x = (ch.x - ox) * s, y = (ch.y - oy) * s;
        if (x > (cols[cols.length - 1].x + cols[cols.length - 1].w) * s || y > (rows[rows.length - 1].y + rows[rows.length - 1].h) * s || x + ch.w * s < 0 || y + ch.h * s < 0) continue;
        ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
        ctx.beginPath(); ctx.rect(0, 0, ch.w, ch.h); ctx.clip();
        root.SheetCharts.draw(ctx, ch.w, ch.h, ch, root.SheetCharts.chartData(wb, sheet, ch));
        ctx.strokeStyle = '#c3ccd6'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, ch.w - 1, ch.h - 1);
        ctx.restore();
      }
    }
  }
  function renderPNG(wb, sheet, g, scale = 2, opts = {}) {
    const L = layout(sheet, g); if (!L.cols.length || !L.rows.length) return null;
    const s = Math.min(scale, 16000 / Math.max(L.W, L.H));
    const cv = document.createElement('canvas'); cv.width = Math.ceil(L.W * s); cv.height = Math.ceil(L.H * s);
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    paintBlock(ctx, wb, sheet, L.rows, L.cols, s, Object.assign({ grid: true }, opts));
    return cv;
  }
  // PDF: paginate sheets into pages; each page is a high-resolution image of its block
  async function exportPDF(wb, sheets, opt = {}) {
    const PL = root.PDFLib, doc = await PL.PDFDocument.create();
    const font = await doc.embedFont(PL.StandardFonts.Helvetica);
    const paper = opt.paper === 'a4' ? [595.28, 841.89] : [612, 792];
    const [PW, PH] = opt.landscape ? [paper[1], paper[0]] : paper;
    const margin = 36, headH = 14, usableW = PW - margin * 2, usableH = PH - margin * 2 - headH * 2;
    const pxPerPt = 96 / 72;
    doc.setTitle(opt.title || 'Lumen Sheets'); doc.setCreator('Lumen Sheets'); doc.setProducer('Lumen Sheets');
    const ascii = s => String(s).replace(/[^\x20-\x7e]/g, '?');
    let pageNo = 0; const pages = [];
    for (const { sheet, range } of sheets) {
      const g = range || printRange(wb, sheet); if (!g) continue;
      const L = layout(sheet, g); if (!L.cols.length) continue;
      const fit = opt.fitWidth ? Math.min(1, usableW * pxPerPt / L.W) : 1; // scale sheet px → page px
      const pageWpx = usableW * pxPerPt / fit, pageHpx = usableH * pxPerPt / fit;
      // column groups
      const colGroups = []; let cur = [], start = 0;
      for (const c of L.cols) { if (cur.length && c.x + c.w - start > pageWpx) { colGroups.push(cur); cur = []; start = c.x; } cur.push(c); }
      if (cur.length) colGroups.push(cur);
      const rowGroups = []; cur = []; start = 0;
      for (const r of L.rows) { if (cur.length && r.y + r.h - start > pageHpx) { rowGroups.push(cur); cur = []; start = r.y; } cur.push(r); }
      if (cur.length) rowGroups.push(cur);
      for (const rg of rowGroups) for (const cg of colGroups) pages.push({ sheet, rg, cg, fit });
    }
    const S = 2.2; // render scale (device px per CSS px)
    for (const pg of pages) {
      pageNo++;
      const x0 = pg.cg[0].x, y0 = pg.rg[0].y;
      const cols = pg.cg.map(c => ({ i: c.i, x: c.x - x0, w: c.w })), rows = pg.rg.map(r => ({ i: r.i, y: r.y - y0, h: r.h }));
      const W = cols[cols.length - 1].x + cols[cols.length - 1].w, H = rows[rows.length - 1].y + rows[rows.length - 1].h;
      const cv = document.createElement('canvas'); cv.width = Math.ceil(W * S); cv.height = Math.ceil(H * S);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
      paintBlock(ctx, wb, pg.sheet, rows, cols, S, { grid: !!opt.grid });
      const png = await new Promise(res => cv.toBlob(res, 'image/png'));
      const img = await doc.embedPng(new Uint8Array(await png.arrayBuffer()));
      const page = doc.addPage([PW, PH]);
      const w = W / pxPerPt * pg.fit, h = H / pxPerPt * pg.fit;
      page.drawImage(img, { x: margin, y: PH - margin - headH - h, width: w, height: h });
      page.drawText(ascii(pg.sheet.name), { x: margin, y: PH - margin - 9, size: 9, font, color: PL.rgb(0.35, 0.4, 0.45) });
      const foot = `Page ${pageNo} of ${pages.length}`;
      page.drawText(foot, { x: PW / 2 - font.widthOfTextAtSize(foot, 8) / 2, y: margin - 14, size: 8, font, color: PL.rgb(0.45, 0.45, 0.45) });
    }
    if (!pages.length) { const page = doc.addPage([PW, PH]); page.drawText('(empty)', { x: margin, y: PH - margin - 20, size: 11, font }); }
    return { bytes: await doc.save(), pages: pages.length };
  }

  root.SheetIO = { parseDelimited, readCSV, writeCSV, rangeHTML, rangeTSV, parseHTMLTable, writeXlsx, readSpreadsheet, writeODS, toXlsxFormula, autoWidths, renderPNG, exportPDF, printRange, layout, decodeText };
})(typeof self !== 'undefined' ? self : this);
