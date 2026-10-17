// Lumen Lab — figure renderer: draws the figure model (see graphics.js) on a canvas.
// 2-D axes (linear/log, grids, legends, colorbars), 3-D axes (orthographic view like MATLAB's
// view(az, el), painter's-sorted surfaces), contours (marching squares), images, bars, pies.
(function () {
  'use strict';
  const G = window.LabGraphics;
  const FONT = '"Segoe UI", Helvetica, Arial, sans-serif';
  const AXC = '#262626', GRID = 'rgba(0,0,0,.13)', MINOR = 'rgba(0,0,0,.06)';
  const PV = { views: new Map() };   // per-axes UI overrides: { xlim, ylim, view }

  const rgb = (c, a = 1) => Array.isArray(c) ? `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})` : c;
  const finite = Number.isFinite;

  // ---------- ticks ----------
  function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
  function ticks(lo, hi, count) {
    if (!(hi > lo)) return { step: 1, list: [lo] };
    const step = niceStep((hi - lo) / Math.max(1, count)), list = [];
    for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) list.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { step, list };
  }
  function stepTicks(lo, hi, step) { const list = []; for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) list.push(Math.abs(v) < step * 1e-9 ? 0 : v); return { step, list }; }
  function niceLimits(lo, hi, count) {
    if (!finite(lo) || !finite(hi)) return [0, 1];
    if (lo === hi) { const d = lo === 0 ? 1 : Math.abs(lo) * 0.1; return [lo - d, hi + d]; }
    const step = niceStep((hi - lo) / Math.max(1, count));
    return [Math.floor(lo / step + 1e-9) * step, Math.ceil(hi / step - 1e-9) * step];
  }
  function tickFormatter(list, step) {
    const mx = Math.max(...list.map(Math.abs));
    let exp = 0; if (mx >= 1e5 || (mx > 0 && mx < 1e-3)) exp = Math.floor(Math.log10(mx));
    const sc = Math.pow(10, exp), st = step / sc;
    let dec = Math.max(0, Math.ceil(-Math.log10(st) - 1e-9)); if (Math.abs(st * Math.pow(10, dec) - Math.round(st * Math.pow(10, dec))) > 1e-6) dec++;
    dec = Math.min(dec, 6);
    return { exp, f: v => { const s = (v / sc).toFixed(dec); return s === '-0' || /^-0\.0*$/.test(s) ? s.slice(1) : s; } };
  }
  function logTicks(lo, hi) { const out = []; for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) { const v = Math.pow(10, e); if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v); } return out; }

  // ---------- colors ----------
  function cmap(fig, ax) { return (ax && ax.colormap) || fig.colormap || 'parula'; }
  const colorAt = (name, t) => G.cmapColor(name, t);

  // ---------- data bounds ----------
  function seriesBounds(s, is3d) {
    const b = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity], c: [Infinity, -Infinity] };
    const acc = (k, v) => { if (finite(v)) { if (v < b[k][0]) b[k][0] = v; if (v > b[k][1]) b[k][1] = v; } };
    const arr = (k, a) => { if (a) for (let i = 0; i < a.length; i++) acc(k, a[i]); };
    switch (s.kind) {
      case 'line': case 'stem': case 'area': arr('x', s.x); arr('y', s.y); arr('z', s.z); if (s.kind !== 'line') acc('y', 0); if (s.elo) { for (let i = 0; i < s.y.length; i++) { acc('y', s.y[i] - s.elo[i]); acc('y', s.y[i] + s.ehi[i]); } } break;
      case 'scatter': arr('x', s.x); arr('y', s.y); arr('z', s.z); arr('c', s.cdata); break;
      case 'bar': {
        const n = s.x.length, w = n > 1 ? Math.min(...Array.from(s.x).slice(1).map((v, i) => v - s.x[i])) : 1;
        for (let i = 0; i < n; i++) { acc('x', s.x[i] - w * 0.5); acc('x', s.x[i] + w * 0.5); const row = s.rows[i]; if (s.stacked) { let p = 0, q = 0; for (const v of row) { if (v >= 0) p += v; else q += v; } acc('y', p); acc('y', q); } else row.forEach(v => acc('y', v)); }
        acc('y', 0); if (s.horizontal) { const t = b.x; b.x = b.y; b.y = t; } break;
      }
      case 'hist': arr('x', s.edges); arr('y', s.counts); acc('y', 0); break;
      case 'surf': arr('x', s.X); arr('y', s.Y); arr('z', s.Z); arr('c', s.C || s.Z); break;
      case 'contour': arr('x', s.X); arr('y', s.Y); if (s.three || s.base) arr('z', s.Z); arr('c', s.Z); break;
      case 'image': { const dx = s.c > 1 ? (s.x[1] - s.x[0]) / (s.c - 1) : 1, dy = s.r > 1 ? (s.y[1] - s.y[0]) / (s.r - 1) : 1; acc('x', s.x[0] - dx / 2); acc('x', s.x[1] + dx / 2); acc('y', s.y[0] - dy / 2); acc('y', s.y[1] + dy / 2); arr('c', s.C); break; }
      case 'fill': arr('x', s.x); arr('y', s.y); break;
      case 'quiver': for (let i = 0; i < s.x.length; i++) { acc('x', s.x[i]); acc('x', s.x[i] + s.u[i]); acc('y', s.y[i]); acc('y', s.y[i] + s.v[i]); } break;
      case 'text': acc('x', s.x); acc('y', s.y); if (s.z != null) acc('z', s.z); break;
    }
    void is3d; return b;
  }
  function axesBounds(ax, is3d) {
    const B = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity], c: [Infinity, -Infinity] };
    for (const s of ax.series) { const b = seriesBounds(s, is3d); for (const k in B) { B[k][0] = Math.min(B[k][0], b[k][0]); B[k][1] = Math.max(B[k][1], b[k][1]); } }
    for (const s of ax.series) if (s.kind === 'xline' && !finite(B.x[0])) B.x = [s.v - 1, s.v + 1];
    for (const s of ax.series) if (s.kind === 'yline' && !finite(B.y[0])) B.y = [s.v - 1, s.v + 1];
    return B;
  }
  const hasKind = (ax, ...k) => ax.series.some(s => k.includes(s.kind));

  // ---------- layout ----------
  function outerRect(ax, W, H, top) {
    if (!ax.sub) return { x: 0, y: top, w: W, h: H - top };
    const { m, n, p } = ax.sub;
    const rows = p.map(q => Math.floor((q - 1) / n)), cols = p.map(q => (q - 1) % n);
    const r0 = Math.min(...rows), r1 = Math.max(...rows) + 1, c0 = Math.min(...cols), c1 = Math.max(...cols) + 1;
    const h = H - top;
    return { x: W * c0 / n, y: top + h * r0 / m, w: W * (c1 - c0) / n, h: h * (r1 - r0) / m };
  }

  function draw(cv, fig, o = {}) {
    const W = o.w || cv.clientWidth || 560, H = o.h || cv.clientHeight || 420, dpr = o.dpr || window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const fs = o.fontScale || 1;
    let top = 0;
    if (fig.title) { ctx.fillStyle = AXC; ctx.font = `600 ${13 * fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillText(fig.title, W / 2, 6); top = 24 * fs; }
    const layouts = [];
    for (const ax of fig.axes) {
      const R = outerRect(ax, W, H, top);
      try { layouts.push(drawAxes(ctx, fig, ax, R, fs)); }
      catch (e) { ctx.fillStyle = '#c00'; ctx.font = `12px ${FONT}`; ctx.fillText('Could not draw: ' + e.message, R.x + 10, R.y + 20); console.warn(e); }
    }
    return layouts;
  }

  function drawAxes(ctx, fig, ax, R, fs) {
    const ov = PV.views.get(ax.id) || {};
    const view = ov.view || ax.view;
    if (hasKind(ax, 'pie')) return drawPie(ctx, ax, R, fs);
    return view ? draw3D(ctx, fig, ax, R, fs, view, ov) : draw2D(ctx, fig, ax, R, fs, ov);
  }

  // ---------- 2-D ----------
  function draw2D(ctx, fig, ax, R, fs, ov) {
    const off = ax.axis.includes('off');
    const small = R.h < 260 || R.w < 300;
    const ml = off ? 10 : (small ? 46 : 58) * fs, mb = off ? 10 : ((ax.xlabel ? 40 : 26) + (small ? -4 : 0)) * fs;
    const mt = (ax.title ? (ax.subtitle ? 44 : 30) : 14) * fs;
    const showCb = ax.colorbar && !off;
    const yy = ax.yy && !off ? ax.yy : null;   // yyaxis: a second y axis on the right
    const mr = (showCb ? 70 : 20) * fs + (yy ? (yy.ylabel ? 58 : 44) * fs : 0);
    let P = { x: R.x + ml + (ax.ylabel ? 14 * fs : 0), y: R.y + mt, w: 0, h: 0 }; P.w = Math.max(20, R.x + R.w - mr - P.x); P.h = Math.max(20, R.y + R.h - mb - P.y);
    if (ax.axis.includes('square') || ax.polar) { const s = Math.min(P.w, P.h); P.x += (P.w - s) / 2; P.y += (P.h - s) / 2; P.w = P.h = s; }
    const B = axesBounds(yy ? { ...ax, series: ax.series.filter(s => s.yside !== 'right') } : ax, false);
    const BR = yy ? axesBounds({ ...ax, series: ax.series.filter(s => s.yside === 'right') }, false) : null;
    if (BR) { B.x = [Math.min(B.x[0], BR.x[0]), Math.max(B.x[1], BR.x[1])]; if (!finite(B.y[0])) B.y = [0, 1]; }
    const tight = ax.axis.includes('tight') || hasKind(ax, 'image', 'surf', 'contour');
    const logx = ax.xscale === 'log', logy = ax.yscale === 'log';
    const lim = (k, isLog, count, given) => {
      if (given) return given.slice();
      let [lo, hi] = (k === 'yR' ? BR.y : B[k]); if (!finite(lo)) { lo = 0; hi = 1; }
      if (isLog) { if (lo <= 0) { lo = Math.min(...ax.series.flatMap(s => Array.from(s[k] || [])).filter(v => v > 0)); if (!finite(lo)) lo = 1; } return [Math.pow(10, Math.floor(Math.log10(lo))), Math.pow(10, Math.ceil(Math.log10(Math.max(hi, lo * 10))))]; }
      if (tight && lo < hi) return [lo, hi];
      const l = niceLimits(lo, hi, count); l.step = niceStep((hi - lo || Math.abs(lo) || 1) / Math.max(1, count)); return l;
    };
    const xCount = Math.max(2, Math.min(10, Math.floor(P.w / (70 * fs)))), yCount = Math.max(2, Math.min(10, Math.floor(P.h / (45 * fs))));
    let xl = ov.xlim || lim('x', logx, xCount, ax.xlim), yl = ov.ylim || lim('y', logy, yCount, ax.ylim);
    if (ax.axis.includes('equal') && !logx && !logy) { // equal data units per pixel: shrink the plot box, as MATLAB does
      const ux = (xl[1] - xl[0]) / P.w, uy = (yl[1] - yl[0]) / P.h;
      if (ux > uy) { const h = (yl[1] - yl[0]) / ux; P.y += (P.h - h) / 2; P.h = h; } else { const w = (xl[1] - xl[0]) / uy; P.x += (P.w - w) / 2; P.w = w; }
    }
    const tx = v => logx ? Math.log10(v) : v, ty = v => logy ? Math.log10(v) : v;
    const X = v => P.x + (tx(v) - tx(xl[0])) / (tx(xl[1]) - tx(xl[0])) * P.w;
    const rev = ax.ydir === 'reverse';
    const Y = v => rev ? P.y + (ty(v) - ty(yl[0])) / (ty(yl[1]) - ty(yl[0])) * P.h : P.y + P.h - (ty(v) - ty(yl[0])) / (ty(yl[1]) - ty(yl[0])) * P.h;
    const clim = ax.clim || (finite(B.c[0]) ? (B.c[0] === B.c[1] ? [B.c[0] - 1, B.c[1] + 1] : B.c) : [0, 1]);
    const cm = cmap(fig, ax);
    const T = { X, Y, P, xl, yl, clim, cm, fs, logx, logy };
    let TR = null, ylR = null, YR = null;
    if (yy) { ylR = yy.ylim ? yy.ylim.slice() : lim('yR', false, yCount, null); YR = v => P.y + P.h - (v - ylR[0]) / (ylR[1] - ylR[0]) * P.h; TR = { ...T, Y: YR, yl: ylR }; }
    const tk = (l, count) => l.step && !ov.xlim && !ov.ylim ? stepTicks(l[0], l[1], l.step) : ticks(l[0], l[1], count);
    let xt = logx ? { list: logTicks(xl[0], xl[1]) } : tk(xl, xCount), yt = logy ? { list: logTicks(yl[0], yl[1]) } : tk(yl, yCount);
    // bar charts label their categories
    const bars = ax.series.find(s => s.kind === 'bar');
    if (bars && bars.x.length <= 25 && Array.from(bars.x).every(Number.isInteger)) { const cat = { step: 1, list: Array.from(bars.x) }; if (bars.horizontal) yt = cat; else xt = cat; }

    if (ax.polar) { drawPolarGrid(ctx, T, ax); }
    else if (!off && (ax.grid || ax.minor)) {
      ctx.lineWidth = 1;
      if (ax.minor && !logx) { ctx.strokeStyle = MINOR; const st = (xt.step || 1) / 5; ctx.beginPath(); for (let v = Math.ceil(xl[0] / st) * st; v <= xl[1]; v += st) { const x = Math.round(X(v)) + 0.5; ctx.moveTo(x, P.y); ctx.lineTo(x, P.y + P.h); } const st2 = (yt.step || 1) / 5; for (let v = Math.ceil(yl[0] / st2) * st2; v <= yl[1]; v += st2) { const y = Math.round(Y(v)) + 0.5; ctx.moveTo(P.x, y); ctx.lineTo(P.x + P.w, y); } ctx.stroke(); }
      if (ax.grid) { ctx.strokeStyle = GRID; ctx.beginPath(); xt.list.forEach(v => { const x = Math.round(X(v)) + 0.5; ctx.moveTo(x, P.y); ctx.lineTo(x, P.y + P.h); }); yt.list.forEach(v => { const y = Math.round(Y(v)) + 0.5; ctx.moveTo(P.x, y); ctx.lineTo(P.x + P.w, y); }); ctx.stroke(); }
    }
    ctx.save(); ctx.beginPath(); ctx.rect(P.x, P.y, P.w, P.h); ctx.clip();
    for (const s of ax.series) drawSeries2D(ctx, s, s.yside === 'right' && TR ? TR : T, ax);
    ctx.restore();
    // unclipped labels and markers on top
    for (const s of ax.series) if (s.kind === 'text') { ctx.fillStyle = rgb(s.color || [0, 0, 0]); ctx.font = `${(s.fontSize || 10) * 1.2 * fs}px ${FONT}`; ctx.textAlign = s.halign === 'center' ? 'center' : s.halign === 'right' ? 'right' : 'left'; ctx.textBaseline = 'middle'; ctx.fillText(s.str, X(s.x), Y(s.y)); }
    if (!off && !ax.polar) {
      ctx.strokeStyle = AXC; ctx.lineWidth = 1; ctx.fillStyle = AXC; ctx.font = `${10.5 * fs}px ${FONT}`;
      const x0 = Math.round(P.x) + 0.5, y0 = Math.round(P.y) + 0.5, x1 = Math.round(P.x + P.w) - 0.5, y1 = Math.round(P.y + P.h) - 0.5;
      ctx.beginPath();
      if (ax.box) ctx.rect(x0, y0, x1 - x0, y1 - y0); else { ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.lineTo(x1, y1); }
      const tl = 5;
      xt.list.forEach(v => { const x = Math.round(X(v)) + 0.5; if (x < x0 - 1 || x > x1 + 1) return; ctx.moveTo(x, y1); ctx.lineTo(x, y1 - tl); if (ax.box) { ctx.moveTo(x, y0); ctx.lineTo(x, y0 + tl); } });
      yt.list.forEach(v => { const y = Math.round(Y(v)) + 0.5; if (y < y0 - 1 || y > y1 + 1) return; ctx.moveTo(x0, y); ctx.lineTo(x0 + tl, y); if (ax.box && !yy) { ctx.moveTo(x1, y); ctx.lineTo(x1 - tl, y); } });
      ctx.stroke();
      if (yy) { // right-hand axis in the second color
        const yt2 = ylR.step ? stepTicks(ylR[0], ylR[1], ylR.step) : ticks(ylR[0], ylR[1], yCount), f2 = tickFormatter(yt2.list, yt2.step), col = rgb(G.ORDER[1]);
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x1, y0); ctx.lineTo(x1, y1);
        yt2.list.forEach(v => { const y = Math.round(YR(v)) + 0.5; if (y < y0 - 1 || y > y1 + 1) return; ctx.moveTo(x1, y); ctx.lineTo(x1 - tl, y); }); ctx.stroke();
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; yt2.list.forEach(v => { const y = YR(v); if (y >= P.y - 2 && y <= P.y + P.h + 2) ctx.fillText(f2.f(v), x1 + 6 * fs, y); });
        if (yy.ylabel) { const w2 = Math.max(...yt2.list.map(v => ctx.measureText(f2.f(v)).width)); ctx.save(); ctx.font = `${11.5 * fs}px ${FONT}`; ctx.translate(x1 + w2 + 14 * fs, P.y + P.h / 2); ctx.rotate(Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(yy.ylabel, 0, 0); ctx.restore(); }
        ctx.strokeStyle = AXC; ctx.fillStyle = rgb(G.ORDER[0]);
      }
      const xf = logx ? null : tickFormatter(xt.list, xt.step), yf = logy ? null : tickFormatter(yt.list, yt.step);
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      let lastX = -Infinity;
      xt.list.forEach(v => { const x = X(v); if (x < P.x - 2 || x > P.x + P.w + 2) return; const s = logx ? '' : xf.f(v); const w = logx ? 30 : ctx.measureText(s).width; if (x - w / 2 < lastX + 4) return; lastX = x + w / 2; if (logx) powLabel(ctx, v, x, y1 + 5, 'center', fs); else ctx.fillText(s, x, y1 + 5 * fs); });
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; if (yy) ctx.fillStyle = rgb(G.ORDER[0]);
      yt.list.forEach(v => { const y = Y(v); if (y < P.y - 2 || y > P.y + P.h + 2) return; if (logy) powLabel(ctx, v, x0 - 6, y, 'right', fs); else ctx.fillText(yf.f(v), x0 - 6 * fs, y); });
      if (xf && xf.exp) { ctx.textAlign = 'right'; ctx.textBaseline = 'top'; powText(ctx, '×10', xf.exp, x1, y1 + 20 * fs, fs); }
      if (yf && yf.exp) { ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; powText(ctx, '×10', yf.exp, x0, y0 - 3, fs); }
      // labels
      ctx.font = `${11.5 * fs}px ${FONT}`; ctx.fillStyle = AXC;
      if (ax.xlabel) { ctx.textAlign = 'center'; ctx.textBaseline = 'top'; multi(ctx, ax.xlabel, P.x + P.w / 2, y1 + 21 * fs, 14 * fs); }
      if (ax.ylabel) { ctx.save(); const yw = Math.max(...yt.list.map(v => logy ? 30 : ctx.measureText(yf.f(v)).width)); ctx.translate(x0 - yw - 16 * fs, P.y + P.h / 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; if (yy) ctx.fillStyle = rgb(G.ORDER[0]); ctx.fillText(ax.ylabel, 0, 0); ctx.restore(); }
    }
    drawTitle(ctx, ax, P, fs);
    if (ax.legend) drawLegend(ctx, ax, P, fs);
    if (showCb) drawColorbar(ctx, P, clim, cm, fs);
    return { ax, P, kind: '2d', X, Y, YR, xl, yl, logx, logy, rev, inv: { x: px => fromPx(px, P.x, P.w, xl, logx, false), y: py => fromPx(py, P.y, P.h, yl, logy, !rev) } };
  }
  function fromPx(p, o, len, l, isLog, flip) { let f = (p - o) / len; if (flip) f = 1 - f; if (isLog) return Math.pow(10, Math.log10(l[0]) + f * (Math.log10(l[1]) - Math.log10(l[0]))); return l[0] + f * (l[1] - l[0]); }
  function multi(ctx, text, x, y, lh) { String(text).split('\n').forEach((t, i) => ctx.fillText(t, x, y + i * lh)); }
  function powLabel(ctx, v, x, y, align, fs) { const e = Math.round(Math.log10(v)); ctx.save(); ctx.textAlign = 'left'; ctx.textBaseline = 'top'; const base = '10', w1 = ctx.measureText(base).width; ctx.font = `${8.5 * fs}px ${FONT}`; const w2 = ctx.measureText(String(e)).width; ctx.font = `${10.5 * fs}px ${FONT}`; const w = w1 + w2; const sx = align === 'center' ? x - w / 2 : x - w; const sy = align === 'center' ? y : y - 6 * fs; ctx.fillText(base, sx, sy + 3 * fs); ctx.font = `${8.5 * fs}px ${FONT}`; ctx.fillText(String(e), sx + w1, sy); ctx.restore(); }
  function powText(ctx, base, e, x, y, fs) { ctx.save(); ctx.font = `${10.5 * fs}px ${FONT}`; const w1 = ctx.measureText(base).width; ctx.font = `${8.5 * fs}px ${FONT}`; const w2 = ctx.measureText(String(e)).width; const sx = ctx.textAlign === 'right' ? x - w1 - w2 : x; ctx.textAlign = 'left'; ctx.font = `${10.5 * fs}px ${FONT}`; ctx.fillText(base, sx, y); ctx.font = `${8.5 * fs}px ${FONT}`; ctx.fillText(String(e), sx + w1, y - 5 * fs); ctx.restore(); }
  function drawTitle(ctx, ax, P, fs) {
    if (!ax.title) return;
    ctx.fillStyle = AXC; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.font = `600 ${12.5 * fs}px ${FONT}`;
    const lines = ax.title.split('\n'), base = P.y - (ax.subtitle ? 22 : 7) * fs;
    lines.forEach((t, i) => ctx.fillText(t, P.x + P.w / 2, base - (lines.length - 1 - i) * 16 * fs));
    if (ax.subtitle) { ctx.font = `${11 * fs}px ${FONT}`; ctx.fillStyle = '#555'; ctx.fillText(ax.subtitle, P.x + P.w / 2, P.y - 6 * fs); }
  }
  function dash(ctx, style, lw) { const u = Math.max(1, lw); ctx.setLineDash(style === '--' ? [6 * u, 4 * u] : style === ':' ? [1.2 * u, 3 * u] : style === '-.' ? [6 * u, 3 * u, 1.2 * u, 3 * u] : []); }
  function marker(ctx, m, x, y, size, stroke, fill) {
    const r = size / 2; ctx.beginPath();
    switch (m) {
      case 'o': ctx.arc(x, y, r, 0, 2 * Math.PI); break;
      case '.': ctx.arc(x, y, Math.max(1.2, r / 3), 0, 2 * Math.PI); fill = fill || stroke; break;
      case 's': ctx.rect(x - r, y - r, 2 * r, 2 * r); break;
      case 'd': ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r, y); ctx.closePath(); break;
      case '^': ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.8); ctx.lineTo(x - r, y + r * 0.8); ctx.closePath(); break;
      case 'v': ctx.moveTo(x, y + r); ctx.lineTo(x + r, y - r * 0.8); ctx.lineTo(x - r, y - r * 0.8); ctx.closePath(); break;
      case '<': ctx.moveTo(x - r, y); ctx.lineTo(x + r * 0.8, y - r); ctx.lineTo(x + r * 0.8, y + r); ctx.closePath(); break;
      case '>': ctx.moveTo(x + r, y); ctx.lineTo(x - r * 0.8, y - r); ctx.lineTo(x - r * 0.8, y + r); ctx.closePath(); break;
      case '+': ctx.moveTo(x - r, y); ctx.lineTo(x + r, y); ctx.moveTo(x, y - r); ctx.lineTo(x, y + r); fill = null; break;
      case 'x': ctx.moveTo(x - r * .75, y - r * .75); ctx.lineTo(x + r * .75, y + r * .75); ctx.moveTo(x + r * .75, y - r * .75); ctx.lineTo(x - r * .75, y + r * .75); fill = null; break;
      case '*': for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3 + Math.PI / 2; ctx.moveTo(x - r * Math.cos(a), y - r * Math.sin(a)); ctx.lineTo(x + r * Math.cos(a), y + r * Math.sin(a)); } fill = null; break;
      case 'p': case 'h': { const k = m === 'p' ? 5 : 6; for (let i = 0; i < 2 * k; i++) { const a = -Math.PI / 2 + i * Math.PI / k, rr = i % 2 ? r * 0.45 : r * 1.15; i ? ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)) : ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); } ctx.closePath(); break; }
      default: return;
    }
    if (fill && fill !== 'none') { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = stroke; ctx.stroke();
  }
  function drawSeries2D(ctx, s, T, ax) {
    const { X, Y, P } = T;
    ctx.setLineDash([]);
    switch (s.kind) {
      case 'line': case 'stem': case 'area': {
        const n = s.x.length, lw = (s.lw || 1) * 1.15 * T.fs, col = rgb(s.color);
        if (s.kind === 'area') {
          ctx.fillStyle = rgb(s.faceColor || s.color, s.alpha != null ? s.alpha : 1); ctx.beginPath(); let started = false, first = 0;
          for (let i = 0; i < n; i++) { if (!finite(s.y[i])) continue; if (!started) { ctx.moveTo(X(s.x[i]), Y(0)); first = i; started = true; } ctx.lineTo(X(s.x[i]), Y(s.y[i])); }
          if (started) { ctx.lineTo(X(s.x[n - 1]), Y(0)); ctx.lineTo(X(s.x[first]), Y(0)); ctx.fill(); }
        }
        if (s.kind === 'stem') { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); for (let i = 0; i < n; i++) if (finite(s.y[i])) { ctx.moveTo(X(s.x[i]), Y(0)); ctx.lineTo(X(s.x[i]), Y(s.y[i])); } ctx.stroke(); }
        else if (s.style !== 'none') {
          ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.lineJoin = 'round'; dash(ctx, s.style, lw); ctx.beginPath();
          let pen = false; for (let i = 0; i < n; i++) { const x = s.x[i], y = s.y[i]; if (!finite(x) || !finite(y) || (T.logx && x <= 0) || (T.logy && y <= 0)) { pen = false; continue; } const px = X(x), py = Y(y); if (pen) ctx.lineTo(px, py); else { ctx.moveTo(px, py); pen = true; } }
          ctx.stroke(); ctx.setLineDash([]);
        }
        if (s.elo) { ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); for (let i = 0; i < n; i++) { const x = X(s.x[i]), a = Y(s.y[i] - s.elo[i]), b = Y(s.y[i] + s.ehi[i]); ctx.moveTo(x, a); ctx.lineTo(x, b); ctx.moveTo(x - 3, a); ctx.lineTo(x + 3, a); ctx.moveTo(x - 3, b); ctx.lineTo(x + 3, b); } ctx.stroke(); }
        if (s.marker && s.marker !== 'none' && n < 20000) { ctx.lineWidth = Math.max(1, lw * 0.8); const mf = s.mfc ? rgb(s.mfc) : null; for (let i = 0; i < n; i++) if (finite(s.y[i]) && finite(s.x[i])) marker(ctx, s.marker, X(s.x[i]), Y(s.y[i]), (s.ms || 6) * 1.1 * T.fs, col, mf); }
        if (s.kind === 'stem') { ctx.strokeStyle = AXC; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(P.x, Y(0)); ctx.lineTo(P.x + P.w, Y(0)); ctx.stroke(); }
        break;
      }
      case 'scatter': {
        const n = s.x.length, sizes = s.sizes;
        for (let i = 0; i < n; i++) {
          if (!finite(s.x[i]) || !finite(s.y[i])) continue;
          const d = Math.sqrt(sizes.length === 1 ? sizes[0] : sizes[i]) * 1.15 * T.fs;
          const c = s.cdata ? rgb(colorAt(T.cm, (s.cdata[i] - T.clim[0]) / (T.clim[1] - T.clim[0]))) : s.colors ? rgb(s.colors[i]) : rgb(s.color);
          ctx.lineWidth = Math.max(1, (s.lw || 0.5) * 1.6);
          marker(ctx, s.marker || 'o', X(s.x[i]), Y(s.y[i]), d, c, s.filled ? (s.faceColor ? rgb(s.faceColor) : c) : null);
        }
        break;
      }
      case 'bar': {
        const n = s.x.length, ns = s.rows[0] ? s.rows[0].length : 1;
        const gap = n > 1 ? Math.min(...Array.from(s.x).slice(1).map((v, i) => v - s.x[i])) : 1, gw = gap * s.width;
        for (let i = 0; i < n; i++) {
          let pos = 0, neg = 0;
          for (let k = 0; k < ns; k++) {
            const v = s.rows[i][k]; if (!finite(v)) continue;
            let a0, a1, b0, b1;
            if (s.stacked) { a0 = s.x[i] - gw / 2; a1 = s.x[i] + gw / 2; if (v >= 0) { b0 = pos; b1 = pos + v; pos += v; } else { b0 = neg + v; b1 = neg; neg += v; } }
            else { const w = ns > 1 ? gw / ns : gw; a0 = s.x[i] - gw / 2 + k * w + (ns > 1 ? w * 0.06 : 0); a1 = a0 + w - (ns > 1 ? w * 0.12 : 0); b0 = Math.min(0, v); b1 = Math.max(0, v); }
            let rx, ry, rw, rh; if (s.horizontal) { rx = X(b0); rw = X(b1) - rx; ry = Y(a1); rh = Y(a0) - ry; } else { rx = X(a0); rw = X(a1) - rx; ry = Y(b1); rh = Y(b0) - ry; }
            if (rh < 0) { ry += rh; rh = -rh; }
            ctx.fillStyle = rgb(s.colors[k] || s.colors[0]); ctx.fillRect(rx, ry, rw, rh);
            ctx.strokeStyle = rgb(s.edge && s.edge !== 'none' ? s.edge : [0.15, 0.15, 0.15], 0.85); ctx.lineWidth = 0.6; ctx.strokeRect(rx + 0.3, ry + 0.3, rw - 0.6, rh - 0.6);
          }
        }
        break;
      }
      case 'hist': {
        for (let i = 0; i < s.counts.length; i++) { const x0 = X(s.edges[i]), x1 = X(s.edges[i + 1]), y = Y(s.counts[i]), y0 = Y(0); ctx.fillStyle = rgb(s.color, s.alpha); ctx.fillRect(x0, Math.min(y, y0), x1 - x0, Math.abs(y0 - y)); ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.lineWidth = 0.6; ctx.strokeRect(x0, Math.min(y, y0), x1 - x0, Math.abs(y0 - y)); }
        break;
      }
      case 'fill': {
        ctx.beginPath(); for (let i = 0; i < s.x.length; i++) { const x = X(s.x[i]), y = Y(s.y[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath();
        ctx.fillStyle = rgb(s.color, s.alpha != null ? s.alpha : 1); ctx.fill(); if (s.edge !== 'none') { ctx.strokeStyle = rgb(s.edge && Array.isArray(s.edge) ? s.edge : [0, 0, 0]); ctx.lineWidth = 0.8; ctx.stroke(); }
        break;
      }
      case 'image': {
        const off = document.createElement('canvas'); off.width = s.c; off.height = s.r; const o = off.getContext('2d'), img = o.createImageData(s.c, s.r);
        for (let i = 0; i < s.r; i++) for (let j = 0; j < s.c; j++) { const v = s.C[i + j * s.r], c = colorAt(T.cm, (v - T.clim[0]) / (T.clim[1] - T.clim[0])), p = 4 * (i * s.c + j); img.data[p] = c[0] * 255; img.data[p + 1] = c[1] * 255; img.data[p + 2] = c[2] * 255; img.data[p + 3] = finite(v) ? 255 : 0; }
        o.putImageData(img, 0, 0);
        const dx = s.c > 1 ? (s.x[1] - s.x[0]) / (s.c - 1) : 1, dy = s.r > 1 ? (s.y[1] - s.y[0]) / (s.r - 1) : 1;
        const x0 = X(s.x[0] - dx / 2), x1 = X(s.x[1] + dx / 2), y0 = Y(s.y[0] - dy / 2), y1 = Y(s.y[1] + dy / 2);
        ctx.imageSmoothingEnabled = false; ctx.save(); ctx.translate(x0, y0); ctx.scale((x1 - x0) / s.c, (y1 - y0) / s.r); ctx.drawImage(off, 0, 0); ctx.restore(); ctx.imageSmoothingEnabled = true;
        break;
      }
      case 'surf': { // flat view of a surface: pcolor-like quads
        const { r, c } = s, Cv = s.C || s.Z;
        for (let i = 0; i < r - 1; i++) for (let j = 0; j < c - 1; j++) {
          const k = [i + j * r, i + 1 + j * r, i + 1 + (j + 1) * r, i + (j + 1) * r], cv = s.faceColor === 'interp' ? (Cv[k[0]] + Cv[k[1]] + Cv[k[2]] + Cv[k[3]]) / 4 : Cv[k[0]];
          ctx.beginPath(); k.forEach((q, t) => { const x = X(s.X[q]), y = Y(s.Y[q]); t ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath();
          if (s.faceColor !== 'none') { ctx.fillStyle = rgb(colorAt(T.cm, (cv - T.clim[0]) / (T.clim[1] - T.clim[0]))); ctx.fill(); }
          if (s.edgeColor && s.edgeColor !== 'none') { ctx.strokeStyle = s.edgeColor === 'flat' ? rgb(colorAt(T.cm, (cv - T.clim[0]) / (T.clim[1] - T.clim[0]))) : rgb(s.edgeColor, 0.55); ctx.lineWidth = 0.5; ctx.stroke(); } else if (s.faceColor !== 'none') { ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6; ctx.stroke(); }
        }
        break;
      }
      case 'contour': drawContour2D(ctx, s, T); break;
      case 'quiver': {
        ctx.strokeStyle = rgb(s.color); ctx.lineWidth = 1; ctx.beginPath();
        for (let i = 0; i < s.x.length; i++) { const x0 = X(s.x[i]), y0 = Y(s.y[i]), x1 = X(s.x[i] + s.u[i]), y1 = Y(s.y[i] + s.v[i]), a = Math.atan2(y1 - y0, x1 - x0), L = Math.hypot(x1 - x0, y1 - y0), hl = Math.min(8, L * 0.3); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.moveTo(x1, y1); ctx.lineTo(x1 - hl * Math.cos(a - 0.4), y1 - hl * Math.sin(a - 0.4)); ctx.moveTo(x1, y1); ctx.lineTo(x1 - hl * Math.cos(a + 0.4), y1 - hl * Math.sin(a + 0.4)); }
        ctx.stroke(); break;
      }
      case 'xline': case 'yline': {
        ctx.strokeStyle = rgb(s.color); ctx.lineWidth = (s.lw || 0.5) * 1.6; dash(ctx, s.style, 1); ctx.beginPath();
        if (s.kind === 'xline') { const x = X(s.v); ctx.moveTo(x, P.y); ctx.lineTo(x, P.y + P.h); } else { const y = Y(s.v); ctx.moveTo(P.x, y); ctx.lineTo(P.x + P.w, y); }
        ctx.stroke(); ctx.setLineDash([]);
        if (s.label) { ctx.fillStyle = rgb(s.color); ctx.font = `${10.5 * T.fs}px ${FONT}`; if (s.kind === 'xline') { ctx.save(); ctx.translate(X(s.v) - 4, P.y + 6); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(s.label, 0, 0); ctx.restore(); } else { ctx.textAlign = 'right'; ctx.textBaseline = 'bottom'; ctx.fillText(s.label, P.x + P.w - 6, Y(s.v) - 3); } }
        break;
      }
    }
  }

  // ---------- contours ----------
  function contourLevels(s, zr) {
    if (s.levels && s.levels.length) return Array.from(s.levels);
    const [lo, hi] = zr; if (!(hi > lo)) return [lo];
    const t = ticks(lo, hi, s.n || 10).list.filter(v => v > lo && v < hi);
    return t.length ? t : [(lo + hi) / 2];
  }
  function zRange(Z) { let lo = Infinity, hi = -Infinity; for (const v of Z) if (finite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } return [lo, hi]; }
  // marching squares → list of segments per level: [[x1,y1,x2,y2], …] in data coordinates
  function isolines(s, L) {
    const { r, c, X, Y, Z } = s, out = [];
    const P = (i, j) => i + j * r;
    const edge = (p, q) => { const z1 = Z[p] - L, z2 = Z[q] - L, t = z1 / (z1 - z2); return [X[p] + t * (X[q] - X[p]), Y[p] + t * (Y[q] - Y[p])]; };
    for (let i = 0; i < r - 1; i++) for (let j = 0; j < c - 1; j++) {
      const a = P(i, j), b = P(i, j + 1), cc = P(i + 1, j + 1), d = P(i + 1, j);
      const za = Z[a], zb = Z[b], zc = Z[cc], zd = Z[d];
      if (!(finite(za) && finite(zb) && finite(zc) && finite(zd))) continue;
      const A = za > L, Bb = zb > L, Cc = zc > L, D = zd > L;
      const pts = {};
      if (A !== Bb) pts.ab = edge(a, b); if (Bb !== Cc) pts.bc = edge(b, cc); if (Cc !== D) pts.cd = edge(cc, d); if (D !== A) pts.da = edge(d, a);
      const k = Object.keys(pts);
      if (k.length === 2) out.push([...pts[k[0]], ...pts[k[1]]]);
      else if (k.length === 4) {
        const center = (za + zb + zc + zd) / 4 > L;
        if (A === center) { out.push([...pts.ab, ...pts.bc], [...pts.cd, ...pts.da]); } else { out.push([...pts.da, ...pts.ab], [...pts.bc, ...pts.cd]); }
      }
    }
    return out;
  }
  function meshAxes(s) { // X varies along columns and Y along rows (meshgrid) → 1-D axes for fast lookup
    const { r, c, X, Y } = s, xs = [], ys = [];
    for (let j = 0; j < c; j++) xs.push(X[j * r]); for (let i = 0; i < r; i++) ys.push(Y[i]);
    for (let j = 0; j < c; j++) for (let i = 0; i < r; i++) if (X[i + j * r] !== xs[j] || Y[i + j * r] !== ys[i]) return null;
    const mono = a => a.every((v, k) => !k || v > a[k - 1]) || a.every((v, k) => !k || v < a[k - 1]);
    return mono(xs) && mono(ys) ? { xs, ys } : null;
  }
  function fracIndex(a, v) { const inc = a[a.length - 1] > a[0]; let lo = 0, hi = a.length - 1; if (inc ? (v < a[0] || v > a[hi]) : (v > a[0] || v < a[hi])) return -1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (inc ? a[m] <= v : a[m] >= v) lo = m; else hi = m; } return lo + (v - a[lo]) / (a[hi] - a[lo]); }
  function drawContour2D(ctx, s, T) {
    const zr = zRange(s.Z), levels = contourLevels(s, zr), cl = T.clim;
    if (s.filled) {
      const bands = [zr[0], ...levels, zr[1]];
      const bandColor = v => { let k = 0; while (k < levels.length && v > levels[k]) k++; const mid = (bands[k] + bands[k + 1]) / 2; return colorAt(T.cm, (mid - cl[0]) / (cl[1] - cl[0])); };
      const ma = meshAxes(s);
      if (ma) {
        const { P } = T, step = 2, W = Math.ceil(P.w / step), H = Math.ceil(P.h / step), off = document.createElement('canvas'); off.width = W; off.height = H;
        const o = off.getContext('2d'), img = o.createImageData(W, H);
        for (let py = 0; py < H; py++) {
          const yv = T.inv ? 0 : 0; void yv;
          const dy = T.yl[0] + (1 - (py + 0.5) / H) * (T.yl[1] - T.yl[0]), fi = fracIndex(ma.ys, dy);
          for (let px = 0; px < W; px++) {
            const dx = T.xl[0] + (px + 0.5) / W * (T.xl[1] - T.xl[0]), fj = fracIndex(ma.xs, dx);
            if (fi < 0 || fj < 0) continue;
            const i = Math.min(s.r - 2, Math.floor(fi)), j = Math.min(s.c - 2, Math.floor(fj)), ti = fi - i, tj = fj - j, Z = s.Z, r = s.r;
            const z = (1 - ti) * (1 - tj) * Z[i + j * r] + ti * (1 - tj) * Z[i + 1 + j * r] + (1 - ti) * tj * Z[i + (j + 1) * r] + ti * tj * Z[i + 1 + (j + 1) * r];
            if (!finite(z)) continue;
            const c = bandColor(z), p = 4 * (py * W + px); img.data[p] = c[0] * 255; img.data[p + 1] = c[1] * 255; img.data[p + 2] = c[2] * 255; img.data[p + 3] = 255;
          }
        }
        o.putImageData(img, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(off, T.P.x, T.P.y, T.P.w, T.P.h);
      } else {
        const { r, c } = s; for (let i = 0; i < r - 1; i++) for (let j = 0; j < c - 1; j++) { const k = [i + j * r, i + 1 + j * r, i + 1 + (j + 1) * r, i + (j + 1) * r]; const z = (s.Z[k[0]] + s.Z[k[1]] + s.Z[k[2]] + s.Z[k[3]]) / 4; ctx.beginPath(); k.forEach((q, t) => t ? ctx.lineTo(T.X(s.X[q]), T.Y(s.Y[q])) : ctx.moveTo(T.X(s.X[q]), T.Y(s.Y[q]))); ctx.closePath(); ctx.fillStyle = ctx.strokeStyle = rgb(bandColor(z)); ctx.fill(); ctx.lineWidth = 0.7; ctx.stroke(); }
      }
    }
    ctx.lineWidth = (s.lw || 0.5) * 1.6;
    for (const L of levels) {
      const segs = isolines(s, L);
      ctx.strokeStyle = s.filled ? 'rgba(0,0,0,.7)' : s.color ? rgb(s.color) : rgb(colorAt(T.cm, (L - cl[0]) / (cl[1] - cl[0])));
      ctx.beginPath(); for (const g of segs) { ctx.moveTo(T.X(g[0]), T.Y(g[1])); ctx.lineTo(T.X(g[2]), T.Y(g[3])); } ctx.stroke();
      if (s.labels && segs.length) { const g = segs[Math.floor(segs.length / 2)]; ctx.fillStyle = AXC; ctx.font = `${9.5 * T.fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; const tx = T.X(g[0]), ty = T.Y(g[1]); const label = +L.toPrecision(4) + ''; ctx.fillStyle = '#fff'; const w = ctx.measureText(label).width; ctx.fillRect(tx - w / 2 - 2, ty - 6, w + 4, 12); ctx.fillStyle = AXC; ctx.fillText(label, tx, ty); }
    }
  }

  // ---------- legend & colorbar ----------
  function legendItems(ax) {
    const items = []; let k = 0;
    for (const s of ax.series) {
      if (['text', 'xline', 'yline', 'quiver', 'image', 'pie'].includes(s.kind) && !(s.kind === 'xline' || s.kind === 'yline') ) continue;
      if ((s.kind === 'xline' || s.kind === 'yline') && !s.label) continue;
      if (s.kind === 'bar') { (s.rows[0] || [0]).forEach((_, j) => items.push({ s, sub: j, idx: k++ })); continue; }
      items.push({ s, idx: k++ });
    }
    const labels = ax.legend.labels;
    return items.map((it, i) => ({ ...it, label: labels ? labels[i] : (it.s.label || `data${i + 1}`) })).filter(it => it.label !== undefined && it.label !== null);
  }
  function drawLegend(ctx, ax, P, fs) {
    const items = legendItems(ax); if (!items.length) return;
    ctx.font = `${10.5 * fs}px ${FONT}`;
    const lh = 17 * fs, sw = 26 * fs, w = Math.max(...items.map(i => ctx.measureText(i.label).width)) + sw + 18 * fs, h = items.length * lh + 8 * fs;
    const loc = ax.legend.loc || 'northeast', m = 8 * fs;
    let x = P.x + P.w - w - m, y = P.y + m;
    if (/west/.test(loc)) x = P.x + m; if (/south/.test(loc)) y = P.y + P.h - h - m;
    if (/outside/.test(loc)) { if (/east/.test(loc)) x = P.x + P.w - w; }
    if (loc === 'best') { /* northeast unless data is crowded there: pick the emptiest corner */ }
    ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fillRect(x, y, w, h); ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 0.8; ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    items.forEach((it, i) => {
      const cy = y + 4 * fs + lh * i + lh / 2, s = it.s, x0 = x + 6 * fs;
      ctx.setLineDash([]);
      if (s.kind === 'bar' || s.kind === 'hist' || s.kind === 'area' || s.kind === 'fill' || s.kind === 'surf' || (s.kind === 'contour' && s.filled)) {
        ctx.fillStyle = s.kind === 'bar' ? rgb(s.colors[it.sub] || s.colors[0]) : s.kind === 'surf' || s.kind === 'contour' ? rgb(G.cmapColor('parula', 0.5)) : rgb(s.faceColor || s.color, s.alpha || 1);
        ctx.fillRect(x0, cy - 5 * fs, sw - 4, 10 * fs); ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeRect(x0, cy - 5 * fs, sw - 4, 10 * fs);
      } else if (s.kind === 'scatter') { marker(ctx, s.marker || 'o', x0 + sw / 2 - 2, cy, 7 * fs, rgb(s.color || [0, 0.447, 0.741]), s.filled ? rgb(s.color || [0, 0.447, 0.741]) : null); }
      else {
        const col = rgb(s.color || [0, 0, 0]);
        if (s.style !== 'none') { ctx.strokeStyle = col; ctx.lineWidth = (s.lw || 1) * 1.15; dash(ctx, s.style, ctx.lineWidth); ctx.beginPath(); ctx.moveTo(x0, cy); ctx.lineTo(x0 + sw - 4, cy); ctx.stroke(); ctx.setLineDash([]); }
        if (s.marker && s.marker !== 'none') { ctx.lineWidth = 1; marker(ctx, s.marker, x0 + sw / 2 - 2, cy, (s.ms || 6) * fs, col, s.mfc ? rgb(s.mfc) : null); }
      }
      ctx.fillStyle = AXC; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(it.label, x0 + sw + 2, cy);
    });
  }
  function drawColorbar(ctx, P, clim, cm, fs) {
    const x = P.x + P.w + 14 * fs, w = 13 * fs, y = P.y, h = P.h;
    for (let i = 0; i < h; i++) { ctx.fillStyle = rgb(colorAt(cm, 1 - i / h)); ctx.fillRect(x, y + i, w, 1.5); }
    ctx.strokeStyle = AXC; ctx.lineWidth = 0.8; ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    const t = ticks(clim[0], clim[1], Math.max(2, Math.floor(h / 40))), f = tickFormatter(t.list, t.step);
    ctx.fillStyle = AXC; ctx.font = `${10 * fs}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    t.list.forEach(v => { const yy = y + h - (v - clim[0]) / (clim[1] - clim[0]) * h; ctx.beginPath(); ctx.moveTo(x + w - 3, yy); ctx.lineTo(x + w, yy); ctx.stroke(); ctx.fillText(f.f(v), x + w + 4, yy); });
  }
  function drawPolarGrid(ctx, T, ax) {
    const { X, Y, xl, yl } = T, R = Math.max(Math.abs(xl[0]), Math.abs(xl[1]), Math.abs(yl[0]), Math.abs(yl[1]));
    const t = ticks(0, R, 4); ctx.strokeStyle = GRID; ctx.lineWidth = 1; ctx.fillStyle = '#666'; ctx.font = `${10 * T.fs}px ${FONT}`;
    const cx = X(0), cy = Y(0), sc = Math.abs(X(1) - X(0));
    t.list.forEach(r => { if (!r) return; ctx.beginPath(); ctx.arc(cx, cy, r * sc, 0, 2 * Math.PI); ctx.stroke(); ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(+r.toPrecision(3) + '', cx + r * sc * Math.cos(-1.3) + 2, cy + r * sc * Math.sin(-1.3)); });
    const rmax = t.list[t.list.length - 1] * sc;
    for (let a = 0; a < 360; a += 30) { const rad = a * Math.PI / 180; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + rmax * Math.cos(rad), cy - rmax * Math.sin(rad)); ctx.stroke(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(a + '°', cx + (rmax + 14) * Math.cos(rad), cy - (rmax + 14) * Math.sin(rad)); }
    void ax;
  }

  // ---------- pie ----------
  function drawPie(ctx, ax, R, fs) {
    const s = ax.series.find(x => x.kind === 'pie'), cx = R.x + R.w / 2, cy = R.y + R.h / 2 + (ax.title ? 10 : 0), rad = Math.min(R.w, R.h) * 0.34;
    let a = -Math.PI / 2;
    s.values.forEach((v, i) => {
      const a1 = a + v * 2 * Math.PI; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, rad, a, a1); ctx.closePath(); ctx.fillStyle = rgb(s.colors[i]); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
      const m = (a + a1) / 2, label = s.labels ? s.labels[i] : `${Math.round(v * 100)}%`;
      ctx.fillStyle = AXC; ctx.font = `${10.5 * fs}px ${FONT}`; ctx.textAlign = Math.cos(m) >= 0 ? 'left' : 'right'; ctx.textBaseline = 'middle'; ctx.fillText(label, cx + (rad + 8) * Math.cos(m), cy + (rad + 8) * Math.sin(m));
      a = a1;
    });
    drawTitle(ctx, ax, { x: R.x, y: cy - rad - 14, w: R.w, h: 0 }, fs);
    return { ax, P: R, kind: 'pie' };
  }

  // ---------- 3-D ----------
  function viewMatrix(az, el) {
    const a = az * Math.PI / 180, e = el * Math.PI / 180;
    return [[Math.cos(a), Math.sin(a), 0], [-Math.sin(e) * Math.sin(a), Math.sin(e) * Math.cos(a), Math.cos(e)], [Math.cos(e) * Math.sin(a), -Math.cos(e) * Math.cos(a), Math.sin(e)]];
  }
  function draw3D(ctx, fig, ax, R, fs, view, ov) {
    const off = ax.axis.includes('off');
    const B = axesBounds(ax, true);
    const tight = ax.axis.includes('tight');
    const lim = (k, given) => { if (given) return given.slice(); let [lo, hi] = B[k]; if (!finite(lo)) { lo = 0; hi = 1; } if (tight && hi > lo) return [lo, hi]; return niceLimits(lo, hi, 5); };
    const xl = ov.xlim || lim('x', ax.xlim), yl = ov.ylim || lim('y', ax.ylim), zl = lim('z', ax.zlim);
    const clim = ax.clim || (finite(B.c[0]) ? (B.c[0] === B.c[1] ? [B.c[0] - 1, B.c[1] + 1] : B.c) : zl);
    const cm = cmap(fig, ax);
    const aspect = ax.axis.includes('equal') ? (() => { const dx = xl[1] - xl[0], dy = yl[1] - yl[0], dz = zl[1] - zl[0], m = Math.max(dx, dy, dz); return [dx / m, dy / m, dz / m]; })() : [1, 1, 0.78];
    const M3 = viewMatrix(view[0], view[1]);
    const norm = (x, y, z) => [((x - xl[0]) / (xl[1] - xl[0]) - 0.5) * aspect[0], ((y - yl[0]) / (yl[1] - yl[0]) - 0.5) * aspect[1], ((z - zl[0]) / (zl[1] - zl[0]) - 0.5) * aspect[2]];
    const proj = p => [M3[0][0] * p[0] + M3[0][1] * p[1] + M3[0][2] * p[2], M3[1][0] * p[0] + M3[1][1] * p[1] + M3[1][2] * p[2], M3[2][0] * p[0] + M3[2][1] * p[1] + M3[2][2] * p[2]];
    const hx = aspect[0] / 2, hy = aspect[1] / 2, hz = aspect[2] / 2;
    const corners = []; for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) corners.push(proj([sx * hx, sy * hy, sz * hz]));
    const mt = (ax.title ? 30 : 12) * fs, mb = 34 * fs, ml = 46 * fs, mr = (ax.colorbar ? 76 : 26) * fs;
    const area = { x: R.x + ml, y: R.y + mt, w: Math.max(20, R.w - ml - mr), h: Math.max(20, R.h - mt - mb) };
    const minX = Math.min(...corners.map(c => c[0])), maxX = Math.max(...corners.map(c => c[0])), minY = Math.min(...corners.map(c => c[1])), maxY = Math.max(...corners.map(c => c[1]));
    const sc = Math.min(area.w / (maxX - minX), area.h / (maxY - minY)) * 0.92;
    const cx = area.x + area.w / 2 - (minX + maxX) / 2 * sc, cy = area.y + area.h / 2 + (minY + maxY) / 2 * sc;
    const S = (x, y, z) => { const q = proj(norm(x, y, z)); return [cx + q[0] * sc, cy - q[1] * sc, q[2]]; };
    const SN = q => [cx + q[0] * sc, cy - q[1] * sc];
    const dir = M3[2]; // toward the viewer
    const backX = dir[0] < 0 ? xl[1] : xl[0], backY = dir[1] < 0 ? yl[1] : yl[0], backZ = dir[2] > 0 ? zl[0] : zl[1];
    const frontX = backX === xl[0] ? xl[1] : xl[0], frontY = backY === yl[0] ? yl[1] : yl[0];
    const xt = ticks(xl[0], xl[1], 5), yt = ticks(yl[0], yl[1], 5), zt = ticks(zl[0], zl[1], 5);
    if (!off) {
      // back planes with grid
      const line = (a, b) => { const p = S(...a), q = S(...b); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); };
      ctx.lineWidth = 1;
      if (ax.grid) {
        ctx.strokeStyle = GRID; ctx.beginPath();
        xt.list.forEach(v => { line([v, yl[0], backZ], [v, yl[1], backZ]); line([v, backY, zl[0]], [v, backY, zl[1]]); });
        yt.list.forEach(v => { line([xl[0], v, backZ], [xl[1], v, backZ]); line([backX, v, zl[0]], [backX, v, zl[1]]); });
        zt.list.forEach(v => { line([xl[0], backY, v], [xl[1], backY, v]); line([backX, yl[0], v], [backX, yl[1], v]); });
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(38,38,38,.75)'; ctx.beginPath();
      // floor (or ceiling) rectangle, two back walls' vertical edges
      line([xl[0], yl[0], backZ], [xl[1], yl[0], backZ]); line([xl[1], yl[0], backZ], [xl[1], yl[1], backZ]); line([xl[1], yl[1], backZ], [xl[0], yl[1], backZ]); line([xl[0], yl[1], backZ], [xl[0], yl[0], backZ]);
      line([backX, backY, zl[0]], [backX, backY, zl[1]]);
      line([backX, frontY, zl[0]], [backX, frontY, zl[1]]); line([frontX, backY, zl[0]], [frontX, backY, zl[1]]);
      if (ax.box) { line([xl[0], yl[0], zl[0] === backZ ? zl[1] : zl[0]], [xl[1], yl[0], zl[0] === backZ ? zl[1] : zl[0]]); }
      ctx.stroke();
    }
    // ----- data -----
    ctx.save(); ctx.beginPath(); ctx.rect(R.x, R.y, R.w, R.h); ctx.clip();
    const cnorm = v => (v - clim[0]) / (clim[1] - clim[0]);
    for (const s of ax.series) {
      if (s.kind === 'surf') drawSurf3D(ctx, s, S, cm, cnorm);
      else if (s.kind === 'line' || s.kind === 'stem') {
        const n = s.x.length, z = s.z || new Float64Array(n);
        ctx.strokeStyle = rgb(s.color); ctx.lineWidth = (s.lw || 1) * 1.15 * fs; dash(ctx, s.style, ctx.lineWidth); ctx.beginPath(); let pen = false;
        if (s.style !== 'none') for (let i = 0; i < n; i++) { if (!finite(s.x[i]) || !finite(s.y[i]) || !finite(z[i])) { pen = false; continue; } const p = S(s.x[i], s.y[i], z[i]); pen ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); pen = true; }
        ctx.stroke(); ctx.setLineDash([]);
        if (s.marker && s.marker !== 'none') for (let i = 0; i < n; i++) { const p = S(s.x[i], s.y[i], z[i]); ctx.lineWidth = 1; marker(ctx, s.marker, p[0], p[1], (s.ms || 6) * fs, rgb(s.color), s.mfc ? rgb(s.mfc) : null); }
      } else if (s.kind === 'scatter') {
        const n = s.x.length, z = s.z || new Float64Array(n), pts = [];
        for (let i = 0; i < n; i++) { if (!finite(s.x[i]) || !finite(s.y[i]) || !finite(z[i])) continue; const p = S(s.x[i], s.y[i], z[i]); pts.push([p, i]); }
        pts.sort((a, b) => a[0][2] - b[0][2]);
        for (const [p, i] of pts) { const c = s.cdata ? rgb(colorAt(cm, cnorm(s.cdata[i]))) : s.colors ? rgb(s.colors[i]) : rgb(s.color); ctx.lineWidth = 1; marker(ctx, s.marker || 'o', p[0], p[1], Math.sqrt(s.sizes.length === 1 ? s.sizes[0] : s.sizes[i]) * 1.15 * fs, c, s.filled ? c : null); }
      } else if (s.kind === 'contour') {
        const zr = zRange(s.Z), levels = contourLevels(s, zr);
        ctx.lineWidth = 1.1;
        for (const L of levels) { const segs = isolines(s, L), zz = s.base ? zl[0] : L; ctx.strokeStyle = rgb(colorAt(cm, cnorm(L))); ctx.beginPath(); for (const g of segs) { const p = S(g[0], g[1], zz), q = S(g[2], g[3], zz); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); } ctx.stroke(); }
      } else if (s.kind === 'text') { const p = S(s.x, s.y, s.z || 0); ctx.fillStyle = rgb(s.color || [0, 0, 0]); ctx.font = `${(s.fontSize || 10) * 1.2 * fs}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(s.str, p[0], p[1]); }
    }
    ctx.restore();
    // ----- tick labels -----
    if (!off) {
      ctx.fillStyle = AXC; ctx.font = `${10 * fs}px ${FONT}`;
      const center = SN(proj([0, 0, 0]));
      const label = (pt, text, push = 14) => { const dx = pt[0] - center[0], dy = pt[1] - center[1], d = Math.hypot(dx, dy) || 1; ctx.textAlign = Math.abs(dx / d) < 0.3 ? 'center' : dx > 0 ? 'left' : 'right'; ctx.textBaseline = Math.abs(dy / d) < 0.3 ? 'middle' : dy > 0 ? 'top' : 'bottom'; ctx.fillText(text, pt[0] + dx / d * push * 0.5, pt[1] + dy / d * push * 0.5); };
      const xf = tickFormatter(xt.list, xt.step), yf = tickFormatter(yt.list, yt.step), zf = tickFormatter(zt.list, zt.step);
      const zEdgeZ = backZ === zl[0] ? zl[0] : zl[1];
      xt.list.forEach(v => label(S(v, frontY, zEdgeZ), xf.f(v)));
      yt.list.forEach(v => { if (Math.abs(v - frontY) > 1e-9 * (yl[1] - yl[0])) label(S(frontX, v, zEdgeZ), yf.f(v)); });
      // z axis: the vertical edge that projects furthest left
      const cands = [[xl[0], yl[0]], [xl[1], yl[0]], [xl[0], yl[1]], [xl[1], yl[1]]].filter(([x, y]) => !(x === frontX && y === frontY));
      const zc = cands.reduce((b, c) => S(c[0], c[1], zl[0])[0] < S(b[0], b[1], zl[0])[0] ? c : b);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      zt.list.forEach(v => { const p = S(zc[0], zc[1], v); ctx.fillText(zf.f(v), p[0] - 6, p[1]); });
      ctx.font = `${11.5 * fs}px ${FONT}`;
      if (ax.xlabel) label(S((xl[0] + xl[1]) / 2, frontY, zEdgeZ), ax.xlabel, 52);
      if (ax.ylabel) label(S(frontX, (yl[0] + yl[1]) / 2, zEdgeZ), ax.ylabel, 52);
      if (ax.zlabel) { const p = S(zc[0], zc[1], (zl[0] + zl[1]) / 2); ctx.save(); ctx.translate(p[0] - 36 * fs, p[1]); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(ax.zlabel, 0, 0); ctx.restore(); }
    }
    drawTitle(ctx, ax, { x: area.x, y: R.y + mt, w: area.w, h: 0 }, fs);
    if (ax.legend) drawLegend(ctx, ax, area, fs);
    if (ax.colorbar) drawColorbar(ctx, { x: R.x + R.w - mr + 10 * fs, y: area.y + area.h * 0.1, w: 0, h: area.h * 0.8 }, clim, cm, fs);
    return { ax, P: area, kind: '3d', view: view.slice() };
  }
  function drawSurf3D(ctx, s, S, cm, cnorm) {
    const { r, c } = s, Cv = s.C || s.Z;
    const interp = s.faceColor === 'interp', sub = interp && r * c < 1600 ? 3 : 1;
    const P = new Array(r * c); for (let k = 0; k < r * c; k++) P[k] = finite(s.Z[k]) ? S(s.X[k], s.Y[k], s.Z[k]) : null;
    const quads = [];
    for (let i = 0; i < r - 1; i++) for (let j = 0; j < c - 1; j++) {
      const k = [i + j * r, i + 1 + j * r, i + 1 + (j + 1) * r, i + (j + 1) * r];
      if (k.some(q => !P[q])) continue;
      if (sub === 1) { const depth = (P[k[0]][2] + P[k[1]][2] + P[k[2]][2] + P[k[3]][2]) / 4, cval = interp ? (Cv[k[0]] + Cv[k[1]] + Cv[k[2]] + Cv[k[3]]) / 4 : Cv[k[0]]; quads.push([depth, [P[k[0]], P[k[1]], P[k[2]], P[k[3]]], cval]); continue; }
      // subdivide for smoother interpolated shading on coarse grids
      const bil = (arr, u, v) => (1 - u) * (1 - v) * arr[k[0]] + u * (1 - v) * arr[k[1]] + u * v * arr[k[2]] + (1 - u) * v * arr[k[3]];
      for (let a = 0; a < sub; a++) for (let b = 0; b < sub; b++) {
        const pts = [[a, b], [a + 1, b], [a + 1, b + 1], [a, b + 1]].map(([u, v]) => S(bil(s.X, u / sub, v / sub), bil(s.Y, u / sub, v / sub), bil(s.Z, u / sub, v / sub)));
        quads.push([(pts[0][2] + pts[1][2] + pts[2][2] + pts[3][2]) / 4, pts, bil(Cv, (a + 0.5) / sub, (b + 0.5) / sub), true]);
      }
    }
    quads.sort((a, b) => a[0] - b[0]);
    const edge = s.edgeColor, alpha = s.alpha != null ? s.alpha : 1;
    for (const [, pts, cval, inner] of quads) {
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let t = 1; t < 4; t++) ctx.lineTo(pts[t][0], pts[t][1]); ctx.closePath();
      const col = rgb(colorAt(cm, cnorm(cval)), alpha);
      if (s.faceColor === 'none' || s.mesh) { ctx.fillStyle = '#fff'; ctx.fill(); } else if (Array.isArray(s.faceColor)) { ctx.fillStyle = rgb(s.faceColor, alpha); ctx.fill(); } else { ctx.fillStyle = col; ctx.fill(); }
      if (edge && edge !== 'none' && !inner) { ctx.strokeStyle = edge === 'flat' || edge === 'interp' ? col : rgb(edge, 0.5); ctx.lineWidth = (s.lw || 0.5) * (s.mesh ? 1.6 : 1); ctx.stroke(); }
      else if (s.faceColor !== 'none' && !s.mesh) { ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6; ctx.stroke(); }
    }
  }

  // nearest data point for hover tips (2-D lines and scatters)
  function pick(layout, px, py) {
    if (!layout || layout.kind !== '2d') return null;
    let best = null, bd = 144;
    for (const s of layout.ax.series) {
      if (!(s.kind === 'line' || s.kind === 'scatter' || s.kind === 'stem')) continue;
      const Yf = s.yside === 'right' && layout.YR ? layout.YR : layout.Y;
      for (let i = 0; i < s.x.length; i++) { const x = layout.X(s.x[i]), y = Yf(s.y[i]); const d = (x - px) ** 2 + (y - py) ** 2; if (d < bd) { bd = d; best = { s, i, x, y, X: s.x[i], Y: s.y[i] }; } }
    }
    return best;
  }

  Object.assign(PV, { draw, pick, ticks, niceLimits, isolines, viewMatrix });
  window.LabPlot = PV;
})();
