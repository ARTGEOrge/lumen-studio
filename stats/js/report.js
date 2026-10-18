// Lumen Stats — output rendering: items → HTML (viewer + standalone export) and → vector PDF (pdf-lib).
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const C = isNode ? require('./charts.js') : root.LCharts;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // ---------- number formatting ----------
  function fmt(v, f) {
    if (v == null || v === '') return '';
    if (typeof v === 'string') return v;
    if (typeof v !== 'number') return String(v);
    if (Number.isNaN(v)) return '';
    if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
    const neg = s => s.replace(/^-/, '−');
    switch (f) {
      case 's': return String(v);
      case 'n': return neg(Number.isInteger(v) ? String(v) : v.toFixed(2));
      case 'd1': return neg(v.toFixed(1)); case 'd2': return neg(v.toFixed(2)); case 'd3': return neg(fixedOrExp(v, 3)); case 'd4': return neg(fixedOrExp(v, 4));
      case 'p': return v < 0.001 ? '<.001' : v > 0.9995 ? '1.000' : v.toFixed(3).replace(/^0/, '');
      case 'pct': return v.toFixed(1);
      default: return neg(Number.isInteger(v) && Math.abs(v) < 1e15 ? String(v) : fixedOrExp(v, 3));
    }
  }
  function fixedOrExp(v, d) {
    const a = Math.abs(v);
    if (a !== 0 && (a < 0.5 * 10 ** -d || a >= 1e9)) return v.toExponential(2);
    return v.toFixed(d);
  }
  const cellText = (c, f) => c != null && typeof c === 'object' ? fmt(c.v, c.f || f) : fmt(c, f);
  const cellSup = c => c != null && typeof c === 'object' && c.sup ? c.sup : '';
  const isNumCell = (c, f) => { const v = c != null && typeof c === 'object' ? c.v : c; return typeof v === 'number' && (c?.f || f) !== 's'; };

  // ---------- HTML ----------
  function tableHTML(b) {
    const cols = Array.isArray(b.cols) ? b.cols : [], rows = Array.isArray(b.rows) ? b.rows : [];
    const h = [`<div class="ot${b.cls ? ' ' + esc(b.cls).replace(/[^a-z0-9 _-]/gi, '') : ''}">`];
    if (b.title) h.push(`<div class="ot-title">${esc(b.title)}</div>`);
    h.push('<table><thead>');
    if (b.colGroup) { h.push(`<tr><th colspan="2"></th><th class="cg" colspan="${Math.max(1, cols.length - 3)}">${esc(b.colGroup)}</th><th></th></tr>`); }
    h.push('<tr>' + cols.map(c => `<th${c.f === 's' ? ' class="l"' : ''}>${esc(c.h)}</th>`).join('') + '</tr></thead><tbody>');
    const span = b.span || 0;
    rows.forEach((r, ri) => {
      if (!Array.isArray(r)) return;
      const start = span && ri > 0 && r.slice(0, span).some(c => c !== '' && c != null);
      h.push(`<tr${start ? ' class="gs"' : ''}>` + cols.map((c, j) => {
        const cell = r[j], txt = cellText(cell, c.f), sup = cellSup(cell), bold = cell && typeof cell === 'object' && cell.b;
        const num = isNumCell(cell, c.f);
        return `<td class="${num ? 'n' : 'l'}${j < span || (j === 0 && c.f === 's') ? ' rh' : ''}${bold ? ' b' : ''}">${esc(txt)}${sup ? `<sup>${esc(sup)}</sup>` : ''}</td>`;
      }).join('') + '</tr>');
    });
    h.push('</tbody></table>');
    if (Array.isArray(b.foot) && b.foot.length) h.push('<div class="ot-foot">' + b.foot.map(f => `<div>${esc(f)}</div>`).join('') + '</div>');
    h.push('</div>');
    return h.join('');
  }
  function blockHTML(b) {
    if (!b || typeof b !== 'object') return '';
    if (b.t === 'table') return tableHTML(b);
    if (b.t === 'chart') return `<div class="oc">${b.title ? `<div class="ot-title">${esc(b.title)}</div>` : ''}${C.toSVG(b.chart)}</div>`;
    if (b.t === 'note') return `<div class="onote ${b.kind === 'warn' ? 'warn' : 'info'}">${esc(b.text)}</div>`;
    if (b.t === 'text') return `<div class="ox">${esc(b.text).replace(/\n/g, '<br>')}</div>`;
    return '';
  }
  const stamp = t => { try { const d = new Date(t); return Number.isNaN(+d) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); } catch (e) { return ''; } };
  function itemHTML(it) {
    return `<section class="oi" data-id="${esc(it.id)}"><h2>${esc(it.title)}</h2>${it.sub ? `<div class="osub">${esc(it.sub)}</div>` : ''}<div class="otime">${esc(stamp(it.time))}</div>${(it.blocks || []).map(blockHTML).join('')}</section>`;
  }
  const REPORT_CSS = `
.report{font:13px/1.45 "Segoe UI",Tahoma,Arial,sans-serif;color:#1d2733}
.oi{margin:0 0 30px;padding:0 0 8px}
.oi h2{font-size:17px;font-weight:600;color:#1e395b;margin:0 0 2px}
.osub{color:#52606e;font-size:12px}.otime{color:#8a95a3;font-size:11px;margin-bottom:10px}
.ot{margin:12px 0 16px;display:table;max-width:100%}
.ot-title{font-weight:600;font-size:13px;margin:0 0 5px;color:#1d2733}
.ot table{border-collapse:collapse;font-size:12px;font-variant-numeric:tabular-nums}
.ot th{font-weight:600;color:#1e395b;padding:4px 9px;text-align:right;vertical-align:bottom;border-top:2px solid #45607f;border-bottom:1px solid #45607f;background:#f2f6fb;max-width:120px}
.ot th.l{text-align:left}.ot th.cg{text-align:center;border-bottom:1px solid #b9c7d8;border-top:2px solid #45607f}
.ot td{padding:3px 9px;border-bottom:1px solid #edf1f5;white-space:nowrap}
.ot td.n{text-align:right}.ot td.l{text-align:left}.ot td.rh{color:#1e395b;background:#fafcfe}.ot td.b{font-weight:600}
.ot tr.gs td{border-top:1px solid #c5d3e3}
.ot tbody tr:last-child td{border-bottom:2px solid #45607f}
.ot sup{color:#b0412f;font-size:9px;margin-left:1px}
.ot-foot{font-size:11px;color:#52606e;margin-top:4px;max-width:760px;white-space:normal}
.oc{margin:12px 0 18px}.oc svg{max-width:100%;height:auto;border:1px solid #e3e8ee;border-radius:3px}
.onote{margin:10px 0 14px;padding:7px 11px;border-left:3px solid #2a78d6;background:#f3f7fd;max-width:780px;font-size:12.5px}
.onote.warn{border-color:#d08a00;background:#fff8e8}
.ox{margin:8px 0;max-width:780px}`;
  function exportHTML(items, { title = 'Lumen Stats output', dataset = '' } = {}) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;background:#fff}main{max-width:1000px;margin:0 auto;padding:28px 32px}.rh1{font:600 22px "Segoe UI",Tahoma,Arial,sans-serif;color:#1e395b;margin:0}.rmeta{font:12px "Segoe UI",Tahoma,Arial,sans-serif;color:#6b7785;margin:2px 0 26px;padding-bottom:12px;border-bottom:1px solid #dde4ec}${REPORT_CSS}@media print{main{padding:0}.oi{break-inside:auto}.oc,.ot{break-inside:avoid}}</style></head>
<body><main class="report"><h1 class="rh1">${esc(title)}</h1><div class="rmeta">${dataset ? 'Dataset: ' + esc(dataset) + ' · ' : ''}Generated by Lumen Stats · ${esc(new Date().toLocaleString())}</div>
${items.map(itemHTML).join('\n')}</main></body></html>`;
  }

  // ---------- PDF ----------
  const WIN = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');
  const REPL = { '−': '-', 'χ': 'chi', 'η': 'eta', 'ω': 'omega', 'ρ': 'rho', 'τ': 'tau', 'ε': 'epsilon', 'σ': 'sigma', 'α': 'alpha', 'β': 'beta', 'μ': 'µ', '≥': '>=', '≤': '<=', '≠': '!=', '→': '->', '○': 'o', '∞': 'inf', '₀': '0', 'ᵢ': 'i', '√': 'sqrt', '…': '…', ' ': ' ', ' ': ' ' };
  function winAnsi(s) {
    let o = ''; for (const ch of String(s ?? '').normalize('NFC')) {
      const c = ch.codePointAt(0);
      if (c >= 0x300 && c <= 0x36f) continue;   // combining marks (X̄)
      if ((c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WIN.has(ch)) o += ch;
      else if (REPL[ch] != null) o += REPL[ch];
      else if (c === 9) o += ' ';
      else o += '?';
    }
    return o;
  }
  function hexRGB(PDFLib, c) {
    const m = /^#([0-9a-f]{3,8})$/i.exec(c || ''); if (!m) return null;
    let h = m[1]; if (h.length <= 4) h = h.split('').map(x => x + x).join('');
    const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255, a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
    return { c: PDFLib.rgb(r, g, b), a };
  }
  async function exportPDF(items, { title = 'Lumen Stats output', dataset = '', PDFLib } = {}) {
    PDFLib = PDFLib || (isNode ? require('../vendor/pdf-lib.min.js') : root.PDFLib);
    const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib;
    const pdf = await PDFDocument.create();
    pdf.setTitle(winAnsi(title)); pdf.setProducer('Lumen Stats'); pdf.setCreator('Lumen Stats');
    const F = await pdf.embedFont(StandardFonts.Helvetica), FB = await pdf.embedFont(StandardFonts.HelveticaBold);
    const PW = 595.28, PH = 841.89, M = 42, AW = PW - 2 * M;
    const INK = rgb(0.11, 0.15, 0.2), NAVY = rgb(0.12, 0.22, 0.36), DIM = rgb(0.38, 0.43, 0.49), RULE = rgb(0.27, 0.38, 0.5), LIGHT = rgb(0.9, 0.93, 0.96);
    let page, y, pageNo = 0;
    const newPage = () => {
      page = pdf.addPage([PW, PH]); pageNo++; y = PH - M;
      page.drawText(winAnsi(`${title}${dataset ? ' — ' + dataset : ''}`), { x: M, y: PH - 24, size: 7.5, font: F, color: DIM });
      page.drawText(String(pageNo), { x: PW - M - F.widthOfTextAtSize(String(pageNo), 7.5), y: 22, size: 7.5, font: F, color: DIM });
    };
    const ensure = h => { if (y - h < M) newPage(); };
    const W = (s, sz, f = F) => f.widthOfTextAtSize(winAnsi(s), sz);
    const text = (s, x, yy, sz, f = F, color = INK) => page.drawText(winAnsi(s), { x, y: yy, size: sz, font: f, color });
    const wrap = (s, sz, width, f = F) => {
      const words = winAnsi(s).split(/\s+/), lines = []; let cur = '';
      words.forEach(w => { const t = cur ? cur + ' ' + w : w; if (f.widthOfTextAtSize(t, sz) > width && cur) { lines.push(cur); cur = w; } else cur = t; });
      if (cur) lines.push(cur); return lines.length ? lines : [''];
    };
    newPage();
    text(title, M, y - 16, 17, FB, NAVY); y -= 24;
    text(`${dataset ? 'Dataset: ' + dataset + ' · ' : ''}Generated by Lumen Stats · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, M, y - 9, 8, F, DIM); y -= 22;
    page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.6, color: LIGHT }); y -= 12;

    const drawTable = b => {
      const cols = b.cols || [], rows = (b.rows || []).filter(Array.isArray), span = b.span || 0;
      let sz = 7.6;
      const measure = s => {
        const cw = cols.map((c, j) => Math.max(0, ...rows.map(r => W(cellText(r[j], c.f) + (cellSup(r[j]) ? ' ' + cellSup(r[j]) : ''), s, r[j] && r[j].b ? FB : F))));
        return cols.map((c, j) => Math.max(cw[j], Math.min(W(c.h, s, FB), Math.max(cw[j], 58))) + 10);
      };
      let widths = measure(sz), total = widths.reduce((a, c) => a + c, 0);
      while (total > AW && sz > 5.2) { sz -= 0.3; widths = measure(sz); total = widths.reduce((a, c) => a + c, 0); }
      if (total > AW) { const k = AW / total; widths = widths.map(w => w * k); total = AW; }
      const lh = sz + 4.2;
      const hdrLines = cols.map((c, j) => wrap(c.h, sz, widths[j] - 8, FB));
      const hh = Math.max(1, ...hdrLines.map(l => l.length)) * (sz + 1.5) + 5 + (b.colGroup ? lh : 0);
      const xs = []; widths.reduce((x, w, j) => { xs[j] = x; return x + w; }, M);
      const drawHeader = () => {
        page.drawRectangle({ x: M, y: y - hh, width: total, height: hh, color: rgb(0.95, 0.965, 0.985) });
        page.drawLine({ start: { x: M, y }, end: { x: M + total, y }, thickness: 1.1, color: RULE });
        let top = y;
        if (b.colGroup) { const x0 = xs[2] || M, x1 = M + total - (widths[widths.length - 1] || 0); text(b.colGroup, (x0 + x1) / 2 - W(b.colGroup, sz, FB) / 2, y - sz - 1.5, sz, FB, NAVY); top -= lh; page.drawLine({ start: { x: x0, y: top }, end: { x: x1, y: top }, thickness: 0.4, color: RULE }); }
        cols.forEach((c, j) => hdrLines[j].forEach((ln, k, L) => text(ln, c.f === 's' ? xs[j] + 4 : xs[j] + widths[j] - 4 - FB.widthOfTextAtSize(ln, sz), y - hh + 4 + (L.length - 1 - k) * (sz + 1.5), sz, FB, NAVY)));
        y -= hh; page.drawLine({ start: { x: M, y }, end: { x: M + total, y }, thickness: 0.6, color: RULE });
      };
      ensure((b.title ? 14 : 0) + hh + lh * Math.min(rows.length, 3));
      if (b.title) { text(b.title, M, y - 9, 9, FB); y -= 14; }
      drawHeader();
      rows.forEach((r, ri) => {
        if (y - lh < M) { newPage(); drawHeader(); }
        const gs = span && ri > 0 && r.slice(0, span).some(c => c !== '' && c != null);
        if (gs) page.drawLine({ start: { x: M, y }, end: { x: M + total, y }, thickness: 0.35, color: rgb(0.77, 0.83, 0.89) });
        cols.forEach((c, j) => {
          const cell = r[j], s = cellText(cell, c.f), sup = cellSup(cell), f = cell && typeof cell === 'object' && cell.b ? FB : F;
          if (!s && !sup) return;
          const tw = W(s, sz, f) + (sup ? W(sup, sz * 0.75) + 1 : 0), num = isNumCell(cell, c.f);
          let x = num ? xs[j] + widths[j] - 4 - tw : xs[j] + 4;
          const maxw = widths[j] - 6; let str = winAnsi(s);
          while (!num && str.length > 2 && f.widthOfTextAtSize(str, sz) > maxw) str = str.slice(0, -2) + '…';
          page.drawText(str, { x, y: y - sz - 1.2, size: sz, font: f, color: j < span || (j === 0 && c.f === 's') ? NAVY : INK });
          if (sup) page.drawText(winAnsi(sup), { x: x + f.widthOfTextAtSize(str, sz) + 1, y: y - sz * 0.55, size: sz * 0.75, font: F, color: rgb(0.69, 0.25, 0.18) });
        });
        y -= lh;
      });
      page.drawLine({ start: { x: M, y }, end: { x: M + total, y }, thickness: 1.1, color: RULE });
      y -= 4;
      (b.foot || []).forEach(fl => wrap(fl, 6.8, AW).forEach(ln => { ensure(9); text(ln, M, y - 7, 6.8, F, DIM); y -= 8.6; }));
      y -= 10;
    };
    const drawChart = b => {
      const ch = b.chart; if (!ch || !Array.isArray(ch.ops)) return;
      const s = Math.min(AW / ch.w, 0.72, 520 / ch.h), h = ch.h * s;
      ensure(h + 10 + (b.title ? 14 : 0));
      if (b.title) { text(b.title, M, y - 9, 9, FB); y -= 14; }
      const x0 = M, y0 = y;   // top-left in PDF coords
      const X = v => x0 + (+v || 0) * s, Y = v => y0 - (+v || 0) * s;
      page.drawRectangle({ x: x0, y: y0 - h, width: ch.w * s, height: h, borderColor: rgb(0.89, 0.91, 0.93), borderWidth: 0.5 });
      for (const o of ch.ops) {
        if (!Array.isArray(o)) continue;
        try {
          if (o[0] === 'l') { const c = hexRGB(PDFLib, o[5]) || { c: INK, a: 1 }; page.drawLine({ start: { x: X(o[1]), y: Y(o[2]) }, end: { x: X(o[3]), y: Y(o[4]) }, thickness: (+o[6] || 1) * s, color: c.c, opacity: c.a, dashArray: o[7] ? [o[7] * s, o[7] * s] : undefined }); }
          else if (o[0] === 'r') { const f = hexRGB(PDFLib, o[5]), st = hexRGB(PDFLib, o[6]); page.drawRectangle({ x: X(o[1]), y: Y(+o[2] + +o[4]), width: Math.max(0, o[3] * s), height: Math.max(0, o[4] * s), color: f ? f.c : undefined, opacity: f ? f.a : undefined, borderColor: st ? st.c : undefined, borderWidth: st ? (+o[7] || 0) * s : 0, borderOpacity: st ? st.a : undefined }); }
          else if (o[0] === 'c') { const f = hexRGB(PDFLib, o[4]), st = hexRGB(PDFLib, o[5]); page.drawCircle({ x: X(o[1]), y: Y(o[2]), size: (+o[3] || 1) * s, color: f ? f.c : undefined, opacity: f ? f.a : undefined, borderColor: st ? st.c : undefined, borderWidth: st ? (+o[6] || 0) * s : 0, borderOpacity: st ? st.a : undefined }); }
          else if (o[0] === 'p') {
            const p = o[1] || []; if (p.length < 4) continue; let d = ''; for (let i = 0; i + 1 < p.length; i += 2) d += (i ? 'L' : 'M') + (+p[i]).toFixed(2) + ' ' + (+p[i + 1]).toFixed(2) + ' ';
            if (o[5]) d += 'Z';
            const st = hexRGB(PDFLib, o[2]), f = hexRGB(PDFLib, o[4]);
            page.drawSvgPath(d, { x: x0, y: y0, scale: s, borderColor: st ? st.c : undefined, borderWidth: st ? (+o[3] || 1) * s : 0, color: f ? f.c : undefined, borderOpacity: st ? st.a : undefined, borderDashArray: o[6] ? [o[6] * s, o[6] * s] : undefined, borderLineCap: PDFLib.LineCapStyle ? PDFLib.LineCapStyle.Round : undefined });
          } else if (o[0] === 't') {
            const sz = (+o[4] || 11) * s, f = o[7] ? FB : F, str = winAnsi(o[3]), w = f.widthOfTextAtSize(str, sz), c = hexRGB(PDFLib, o[5]) || { c: INK, a: 1 };
            const th = -(+o[8] || 0) * Math.PI / 180, off = o[6] === 'm' ? -w / 2 : o[6] === 'e' ? -w : 0;
            page.drawText(str, { x: X(o[1]) + off * Math.cos(th), y: Y(o[2]) + off * Math.sin(th), size: sz, font: f, color: c.c, rotate: degrees(th * 180 / Math.PI) });
          }
        } catch (e) { /* skip a malformed op */ }
      }
      y -= h + 14;
    };
    const drawNote = b => {
      const lines = wrap(b.text, 8.3, AW - 16), h = lines.length * 11 + 8;
      ensure(h + 6);
      page.drawRectangle({ x: M, y: y - h, width: AW, height: h, color: b.kind === 'warn' ? rgb(1, 0.973, 0.91) : rgb(0.953, 0.969, 0.992) });
      page.drawRectangle({ x: M, y: y - h, width: 2.2, height: h, color: b.kind === 'warn' ? rgb(0.82, 0.54, 0) : rgb(0.16, 0.47, 0.84) });
      lines.forEach((ln, k) => text(ln, M + 9, y - 12 - k * 11, 8.3)); y -= h + 10;
    };
    items.forEach((it, k) => {
      const fb = (it.blocks || [])[0];
      ensure(fb && fb.t === 'chart' && fb.chart ? Math.min(AW / fb.chart.w, 0.72, 520 / fb.chart.h) * fb.chart.h + 50 : 90);
      if (k) y -= 6;
      text(it.title || 'Output', M, y - 13, 13, FB, NAVY); y -= 18;
      if (it.sub) wrap(it.sub, 8, AW).forEach(ln => { text(ln, M, y - 8, 8, F, DIM); y -= 10; });
      y -= 6;
      (it.blocks || []).forEach(b => { if (b.t === 'table') drawTable(b); else if (b.t === 'chart') drawChart(b); else if (b.t === 'note' || b.t === 'text') drawNote(b); });
      y -= 8;
    });
    return pdf.save();
  }

  const api = { fmt, cellText, tableHTML, blockHTML, itemHTML, REPORT_CSS, exportHTML, exportPDF, winAnsi, esc };
  if (isNode) module.exports = api; else root.LReport = api;
})(typeof self !== 'undefined' ? self : this);
