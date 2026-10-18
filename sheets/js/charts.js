'use strict';
/* Lumen Sheets — charts (column, bar, line, area, pie, doughnut, scatter) drawn on canvas from a cell range. */
(function (root) {
  const F = root.Formula, Fmt = root.SheetFormat;
  const PALETTE = ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#264478', '#9e480e', '#636363', '#997300', '#43682b', '#698ed0'];
  const TYPES = [['column', 'Column'], ['bar', 'Bar'], ['line', 'Line'], ['area', 'Area'], ['pie', 'Pie'], ['doughnut', 'Doughnut'], ['scatter', 'Scatter (XY)']];

  // extract categories + series from the chart's range
  function chartData(wb, sheet, chart) {
    // the range may be a union like "A3:A15,F3:F15" (columns side by side) or "B3:E3,B16:E16" (rows stacked)
    const parts = [];
    for (const t of String(chart.range).split(/,(?=(?:[^']*'[^']*')*[^']*$)/)) {
      const pr = F.parseRange(t.trim()); if (!pr) return null;
      const sh = pr.sheet ? wb.sheetByName(pr.sheet) : sheet; if (!sh) return null;
      const b = sh.bounds(); const r2 = Math.min(pr.r2, Math.max(pr.r1, b.r)), c2 = Math.min(pr.c2, Math.max(pr.c1, b.c));
      const m = [], tt = [];
      for (let r = pr.r1; r <= r2; r++) { const row = [], trow = []; for (let c = pr.c1; c <= c2; c++) { row.push(sh.value(r, c)); trow.push(wb.display(sh, r, c).text); } m.push(row); tt.push(trow); }
      parts.push({ m, t: tt, sh, pr });
    }
    if (!parts.length) return null;
    let M = parts[0].m, T = parts[0].t;
    const sameRows = parts.every(p => p.m.length === M.length), sameCols = parts.every(p => p.m[0] && M[0] && p.m[0].length === M[0].length);
    if (parts.length > 1) {
      if (sameRows && (M.length > 1 || !sameCols)) { M = M.map((row, i) => parts.flatMap(p => p.m[i])); T = T.map((row, i) => parts.flatMap(p => p.t[i])); }
      else if (sameCols) { M = parts.flatMap(p => p.m); T = parts.flatMap(p => p.t); }
    }
    const sh = parts[0].sh, pr = parts[0].pr;
    if (!M.length) return null;
    if (chart.byRow) { M = M[0].map((_, j) => M.map(r => r[j])); T = T[0].map((_, j) => T.map(r => r[j])); }
    const isTxt = v => v != null && typeof v !== 'number';
    const hasHeader = M[0].slice(1).some(isTxt) || (M.length > 1 && M[0].every(v => isTxt(v) || v == null));
    const firstCol = M.slice(hasHeader ? 1 : 0).map(r => r[0]);
    const firstNf = (() => { const c = sh.get(pr.r1 + (hasHeader ? 1 : 0), pr.c1); return c && c.s && c.s.nf; })();
    const catCol = M[0].length > 1 && (firstCol.some(isTxt) || (firstNf && Fmt.isDateFormat(firstNf)) || (hasHeader && M[0][0] == null) || chart.type === 'scatter');
    const body = M.slice(hasHeader ? 1 : 0), tbody = T.slice(hasHeader ? 1 : 0);
    const categories = catCol ? tbody.map(r => r[0]) : body.map((_, i) => String(i + 1));
    const xs = catCol ? body.map(r => typeof r[0] === 'number' ? r[0] : NaN) : body.map((_, i) => i + 1);
    const start = catCol ? 1 : 0, series = [];
    for (let j = start; j < M[0].length; j++) series.push({ name: hasHeader ? String(T[0][j] || 'Series ' + (j - start + 1)) : 'Series ' + (j - start + 1), values: body.map(r => typeof r[j] === 'number' ? r[j] : null) });
    const valNf = (() => {
      let k = start, part = parts[0];
      if (parts.length > 1 && M[0].length > parts[0].m[0].length) for (const p of parts) { const w = p.m[0].length; if (k < w) { part = p; break; } k -= w; }
      const c = part.sh.get(part.pr.r1 + (hasHeader ? 1 : 0), part.pr.c1 + k); return c && c.s && c.s.nf;
    })();
    return { categories, xs, series, valNf };
  }
  function niceTicks(lo, hi, n = 5) {
    if (lo === hi) { hi = lo + 1; lo = lo - (lo ? 1 : 0); }
    const span = hi - lo, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0))), f = step0 / mag;
    const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * mag;
    const a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, out = [];
    for (let v = a; v <= b + step / 2; v += step) out.push(parseFloat(v.toPrecision(12)));
    return out;
  }
  function fmtVal(v, nf) {
    if (nf && !/^general$/i.test(nf)) return Fmt.format(v, nf).text;
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B'; if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M'; if (a >= 1e4) return (v / 1e3).toFixed(0) + 'K';
    return Fmt.general(v);
  }
  // draw chart into a 2D context at (0,0,w,h) in CSS px
  function draw(ctx, w, h, chart, data) {
    ctx.save();
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
    ctx.font = '12px "Segoe UI", sans-serif'; ctx.textBaseline = 'middle';
    if (!data || !data.series.length) { ctx.fillStyle = '#7a8796'; ctx.textAlign = 'center'; ctx.fillText('No numeric data in ' + chart.range, w / 2, h / 2); ctx.restore(); return; }
    let top = 10;
    if (chart.title) { ctx.fillStyle = '#333'; ctx.font = '600 15px "Segoe UI", sans-serif'; ctx.textAlign = 'center'; ctx.fillText(chart.title, w / 2, 18, w - 20); top = 34; }
    ctx.font = '11.5px "Segoe UI", sans-serif';
    const pie = chart.type === 'pie' || chart.type === 'doughnut';
    // legend at the bottom
    const legendItems = pie ? data.categories.map((c, i) => [c, PALETTE[i % PALETTE.length]]) : data.series.map((s, i) => [s.name, PALETTE[i % PALETTE.length]]);
    let bottom = h - 8;
    if (chart.legend !== false && (legendItems.length > 1 || pie)) {
      const items = legendItems.slice(0, 24); let lines = [[]], lw = 0;
      for (const it of items) { const tw = ctx.measureText(it[0]).width + 26; if (lw + tw > w - 20 && lines[lines.length - 1].length) { lines.push([]); lw = 0; } lines[lines.length - 1].push([...it, tw]); lw += tw; }
      lines = lines.slice(0, 3);
      bottom = h - 6 - lines.length * 17;
      lines.forEach((ln, li) => {
        const tot = ln.reduce((a, x) => a + x[2], 0); let x = (w - tot) / 2; const y = bottom + 10 + li * 17;
        for (const [name, col, tw] of ln) { ctx.fillStyle = col; ctx.fillRect(x, y - 5, 10, 10); ctx.fillStyle = '#444'; ctx.textAlign = 'left'; ctx.fillText(name, x + 14, y, tw - 18); x += tw; }
      });
      bottom -= 4;
    }
    if (pie) drawPie(ctx, w, top, bottom, chart, data);
    else drawAxes(ctx, w, top, bottom, chart, data);
    ctx.restore();
  }
  function drawPie(ctx, w, top, bottom, chart, data) {
    const vals = data.series[0].values.map(v => v > 0 ? v : 0), tot = vals.reduce((a, b) => a + b, 0);
    const cx = w / 2, cy = (top + bottom) / 2, R = Math.max(10, Math.min(w / 2 - 20, (bottom - top) / 2 - 6));
    if (!tot) return;
    let a = -Math.PI / 2;
    vals.forEach((v, i) => {
      const da = v / tot * Math.PI * 2;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a, a + da); ctx.closePath(); ctx.fillStyle = PALETTE[i % PALETTE.length]; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      if (chart.labels || da > 0.35) {
        const mid = a + da / 2, lr = chart.type === 'doughnut' ? R * 0.78 : R * 0.64;
        ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '600 11px "Segoe UI", sans-serif';
        ctx.fillText(chart.labels ? fmtVal(v, data.valNf) : Math.round(v / tot * 100) + '%', cx + Math.cos(mid) * lr, cy + Math.sin(mid) * lr);
      }
      a += da;
    });
    if (chart.type === 'doughnut') { ctx.beginPath(); ctx.arc(cx, cy, R * 0.55, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); }
  }
  function drawAxes(ctx, w, top, bottom, chart, data) {
    const horiz = chart.type === 'bar', scatter = chart.type === 'scatter', stacked = chart.stacked && (chart.type === 'column' || chart.type === 'bar' || chart.type === 'area');
    const n = data.categories.length;
    let lo = Infinity, hi = -Infinity;
    if (stacked) for (let i = 0; i < n; i++) { let p = 0, q = 0; data.series.forEach(s => { const v = s.values[i] || 0; if (v >= 0) p += v; else q += v; }); hi = Math.max(hi, p); lo = Math.min(lo, q); }
    else data.series.forEach(s => s.values.forEach(v => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); } }));
    if (!isFinite(lo)) { lo = 0; hi = 1; }
    if (!scatter || lo > 0) lo = Math.min(lo, 0); if (hi < 0) hi = 0;
    const ticks = niceTicks(lo, hi); lo = ticks[0]; hi = ticks[ticks.length - 1];
    let xlo = 0, xhi = 1, xticks = null;
    if (scatter) { const xs = data.xs.filter(x => isFinite(x)); xlo = Math.min(...xs); xhi = Math.max(...xs); if (!xs.length) { xlo = 0; xhi = 1; } xticks = niceTicks(xlo, xhi); xlo = xticks[0]; xhi = xticks[xticks.length - 1]; }
    ctx.font = '11px "Segoe UI", sans-serif';
    const valLabels = ticks.map(t => fmtVal(t, data.valNf));
    const catLabelW = horiz ? Math.min(w * 0.3, Math.max(...data.categories.map(c => ctx.measureText(c).width)) + 10) : 0;
    const left = 10 + (horiz ? catLabelW : Math.max(...valLabels.map(s => ctx.measureText(s).width)) + 8), right = w - 14;
    const plotB = bottom - (horiz ? 18 : 22), plotT = top + 4;
    const PW = right - left, PH = plotB - plotT; if (PW < 20 || PH < 20) return;
    const vy = v => plotB - (v - lo) / (hi - lo) * PH, vx = v => left + (v - lo) / (hi - lo) * PW;
    // gridlines + value labels
    ctx.strokeStyle = '#e3e7ec'; ctx.lineWidth = 1; ctx.fillStyle = '#5f6b78';
    ticks.forEach((t, i) => {
      if (horiz) { const x = Math.round(vx(t)) + 0.5; ctx.beginPath(); ctx.moveTo(x, plotT); ctx.lineTo(x, plotB); ctx.stroke(); ctx.textAlign = 'center'; ctx.fillText(valLabels[i], x, plotB + 10); }
      else { const y = Math.round(vy(t)) + 0.5; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke(); ctx.textAlign = 'right'; ctx.fillText(valLabels[i], left - 6, y); }
    });
    ctx.strokeStyle = '#9aa6b2';
    if (horiz) { ctx.beginPath(); ctx.moveTo(vx(0) + 0.5, plotT); ctx.lineTo(vx(0) + 0.5, plotB); ctx.stroke(); }
    else { ctx.beginPath(); ctx.moveTo(left, Math.round(vy(scatter ? Math.max(lo, 0) : 0)) + 0.5); ctx.lineTo(right, Math.round(vy(scatter ? Math.max(lo, 0) : 0)) + 0.5); ctx.stroke(); }
    if (scatter) {
      const sx = x => left + (x - xlo) / (xhi - xlo) * PW;
      ctx.fillStyle = '#5f6b78'; ctx.textAlign = 'center';
      xticks.forEach(t => ctx.fillText(fmtVal(t), sx(t), plotB + 11));
      data.series.forEach((s, si) => {
        const col = PALETTE[si % PALETTE.length]; ctx.fillStyle = col;
        s.values.forEach((v, i) => { const x = data.xs[i]; if (v == null || !isFinite(x)) return; ctx.beginPath(); ctx.arc(sx(x), vy(v), 3.5, 0, Math.PI * 2); ctx.fill(); });
      });
      return;
    }
    // category labels
    const band = (horiz ? PH : PW) / Math.max(1, n);
    ctx.fillStyle = '#5f6b78';
    const step = Math.max(1, Math.ceil(n / Math.max(1, Math.floor((horiz ? PH / 14 : PW / 44)))));
    data.categories.forEach((c, i) => {
      if (i % step) return;
      if (horiz) { ctx.textAlign = 'right'; ctx.fillText(c, left - 6, plotT + band * (i + 0.5), catLabelW - 6); }
      else { ctx.textAlign = 'center'; ctx.fillText(c, left + band * (i + 0.5), plotB + 11, band * step - 2); }
    });
    const ns = data.series.length;
    if (chart.type === 'column' || chart.type === 'bar') {
      const gw = band * 0.72, bw = stacked ? gw : gw / ns;
      const pos = new Array(n).fill(0), neg = new Array(n).fill(0);
      data.series.forEach((s, si) => {
        ctx.fillStyle = PALETTE[si % PALETTE.length];
        s.values.forEach((v, i) => {
          if (v == null) return;
          let a0 = 0, a1 = v;
          if (stacked) { if (v >= 0) { a0 = pos[i]; a1 = pos[i] += v; } else { a0 = neg[i]; a1 = neg[i] += v; } }
          const off = band * i + (band - gw) / 2 + (stacked ? 0 : bw * si);
          if (horiz) { const x0 = vx(Math.min(a0, a1)), x1 = vx(Math.max(a0, a1)); ctx.fillRect(x0, plotT + off, Math.max(1, x1 - x0), bw - (stacked ? 0 : 1)); }
          else { const y0 = vy(Math.max(a0, a1)), y1 = vy(Math.min(a0, a1)); ctx.fillRect(left + off, y0, bw - (stacked ? 0 : 1), Math.max(1, y1 - y0)); }
          if (chart.labels) { ctx.save(); ctx.fillStyle = '#333'; ctx.textAlign = 'center'; const t = fmtVal(v, data.valNf); if (horiz) ctx.fillText(t, vx(a1) + 14, plotT + off + bw / 2); else ctx.fillText(t, left + off + bw / 2, vy(a1) - 8); ctx.restore(); }
        });
      });
      return;
    }
    // line / area
    const base = new Array(n).fill(0);
    data.series.forEach((s, si) => {
      const col = PALETTE[si % PALETTE.length];
      const pts = s.values.map((v, i) => v == null ? null : [left + band * (i + 0.5), vy(stacked ? (base[i] += v) : v), stacked ? vy(base[i] - v) : vy(Math.max(lo, 0))]);
      if (chart.type === 'area') {
        const p = pts.filter(Boolean); if (!p.length) return;
        ctx.beginPath(); ctx.moveTo(p[0][0], p[0][2]); p.forEach(q => ctx.lineTo(q[0], q[1])); for (let i = p.length - 1; i >= 0; i--) ctx.lineTo(p[i][0], p[i][2]); ctx.closePath();
        ctx.globalAlpha = 0.55; ctx.fillStyle = col; ctx.fill(); ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = col; ctx.lineWidth = 2.25; ctx.lineJoin = 'round'; ctx.beginPath(); let started = false;
      pts.forEach((q, i) => {
        if (!q) { started = false; return; }
        if (!started) { ctx.moveTo(q[0], q[1]); started = true; }
        else if (chart.smooth && pts[i - 1]) { const p0 = pts[i - 1], mx = (p0[0] + q[0]) / 2; ctx.bezierCurveTo(mx, p0[1], mx, q[1], q[0], q[1]); }
        else ctx.lineTo(q[0], q[1]);
      });
      ctx.stroke();
      if (chart.type === 'line' && n <= 40) { ctx.fillStyle = col; pts.forEach(q => { if (q) { ctx.beginPath(); ctx.arc(q[0], q[1], 3, 0, Math.PI * 2); ctx.fill(); } }); }
      if (chart.labels) { ctx.fillStyle = '#333'; ctx.textAlign = 'center'; pts.forEach((q, i) => { if (q) ctx.fillText(fmtVal(s.values[i], data.valNf), q[0], q[1] - 10); }); }
    });
  }
  root.SheetCharts = { chartData, draw, TYPES, PALETTE, niceTicks };
})(typeof self !== 'undefined' ? self : this);
