// Lumen Stats — charts. Each chart is recorded as a list of primitive drawing ops ({w,h,ops}) so the same chart
// renders to SVG (screen, HTML export) and to vector PDF. Ops:
//   ['l',x1,y1,x2,y2,stroke,width,dash]  ['r',x,y,w,h,fill,stroke,sw,title]  ['c',cx,cy,r,fill,stroke,sw,title]
//   ['p',[x,y,...],stroke,sw,fill,closed,dash]  ['t',x,y,text,size,color,anchor('s'|'m'|'e'),bold,rot]
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const S = isNode ? require('./stats.js') : root.LStat;
  const Dist = isNode ? require('./dist.js') : root.LDist;
  // validated categorical order (blue, orange, aqua, yellow, magenta, green, violet, red)
  const PAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const INK = '#1d2733', INK2 = '#52514e', MUTED = '#8a8f96', GRID = '#e8ebef', AXIS = '#9aa3ad', CRIT = '#d03b3b';
  const W = 600, H = 380;

  class G {
    constructor(w = W, h = H) { this.w = w; this.h = h; this.ops = []; }
    line(x1, y1, x2, y2, c = INK, w = 1, dash = 0) { this.ops.push(['l', r2(x1), r2(y1), r2(x2), r2(y2), c, w, dash]); }
    rect(x, y, w, h, fill, stroke = null, sw = 0, title = null) { this.ops.push(['r', r2(x), r2(y), r2(w), r2(h), fill, stroke, sw, title]); }
    circle(cx, cy, r, fill, stroke = null, sw = 0, title = null) { this.ops.push(['c', r2(cx), r2(cy), r, fill, stroke, sw, title]); }
    poly(pts, stroke, sw = 2, fill = null, closed = false, dash = 0) { this.ops.push(['p', pts.map(r2), stroke, sw, fill, closed, dash]); }
    text(x, y, s, size = 11, color = INK2, anchor = 's', bold = false, rot = 0) { this.ops.push(['t', r2(x), r2(y), String(s), size, color, anchor, bold, rot]); }
    done() { return { w: this.w, h: this.h, ops: this.ops }; }
  }
  const r2 = v => Math.round(v * 100) / 100;
  const tw = (s, size) => String(s).length * size * 0.55;   // approximate text width

  // ---------- axes ----------
  function niceTicks(lo, hi, count = 6) {
    if (!(hi > lo)) { const d = Math.abs(lo) * 0.1 || 1; lo -= d; hi += d; }
    const step = S.niceStep(hi - lo, count), a = Math.floor(lo / step + 1e-9) * step, b = Math.ceil(hi / step - 1e-9) * step;
    const vals = []; for (let v = a; v <= b + step * 1e-6; v += step) vals.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    let dd = Math.max(0, dec); while (dd < 8 && Math.abs(step * 10 ** dd - Math.round(step * 10 ** dd)) > 1e-6) dd++;
    return { lo: a, hi: b, step, vals, dec: dd };
  }
  const fmtTick = (v, dec) => { const s = v.toFixed(dec); return Math.abs(v) >= 1e6 || (Math.abs(v) < 1e-4 && v !== 0) ? v.toExponential(1) : s; };
  // draws the frame; x/y: {lo,hi,label,cats(optional array of category labels)}; returns scale functions
  function frame(g, { title, x, y, legend, pad = {} }) {
    const L = (pad.l ?? 64), R = g.w - (pad.r ?? (legend ? 22 + Math.min(150, Math.max(...legend.map(s => tw(s.name, 11))) + 26) : 22)), T = title ? 40 : 18, B = g.h - (x.label ? 50 : 32);
    if (title) g.text(g.w / 2, 22, title, 13.5, INK, 'm', true);
    let yt = y.ticks || niceTicks(y.lo, y.hi, 6);
    if (y.exact) yt = { ...yt, lo: y.lo, hi: y.hi };
    const sy = v => B - (v - yt.lo) / (yt.hi - yt.lo) * (B - T);
    yt.vals.forEach(v => { if (v < yt.lo - 1e-9 || v > yt.hi + 1e-9) return; const py = sy(v); g.line(L, py, R, py, GRID, 1); g.text(L - 7, py + 4, fmtTick(v, yt.dec), 10.5, INK2, 'e'); });
    let sx, xt = null;
    if (x.cats) {
      const n = x.cats.length, bw = (R - L) / n; sx = i => L + bw * (i + 0.5); sx.band = bw;
      const maxw = Math.max(...x.cats.map(c => tw(c, 10.5))), rot = maxw > bw - 4 && n > 3;
      x.cats.forEach((c, i) => {
        let s = String(c); if (!rot && tw(s, 10.5) > bw - 2) { while (s.length > 3 && tw(s + '…', 10.5) > bw - 2) s = s.slice(0, -1); s += '…'; }
        if (rot) g.text(sx(i) + 3, B + 12, s.length > 18 ? s.slice(0, 17) + '…' : s, 10, INK2, 'e', false, -35); else g.text(sx(i), B + 16, s, 10.5, INK2, 'm');
      });
    } else {
      xt = x.ticks || niceTicks(x.lo, x.hi, Math.max(4, Math.round((R - L) / 80)));
      if (x.exact) xt = { ...xt, lo: x.lo, hi: x.hi };
      sx = v => L + (v - xt.lo) / (xt.hi - xt.lo) * (R - L);
      xt.vals.forEach(v => { if (v < xt.lo - 1e-9 || v > xt.hi + 1e-9) return; const px = sx(v); if (x.grid) g.line(px, T, px, B, GRID, 1); g.line(px, B, px, B + 4, AXIS, 1); g.text(px, B + 16, x.fmt ? x.fmt(v) : fmtTick(v, xt.dec), 10.5, INK2, 'm'); });
    }
    g.line(L, B, R, B, AXIS, 1);
    if (x.label) g.text((L + R) / 2, g.h - 12, x.label, 11.5, INK, 'm');
    if (y.label) g.text(16, (T + B) / 2, y.label, 11.5, INK, 'm', false, -90);
    if (legend) legend.forEach((s, i) => {
      const lx = R + 16, ly = T + 6 + i * 18;
      if (s.line) g.line(lx, ly, lx + 14, ly, s.color, 2, s.dash || 0); else g.rect(lx, ly - 5, 11, 11, s.color);
      g.text(lx + 19, ly + 4, s.name.length > 22 ? s.name.slice(0, 21) + '…' : s.name, 11, INK2, 's');
    });
    return { sx, sy, L, R, T, B, xt, yt };
  }

  // ---------- histogram ----------
  function histogram({ values, title, xLabel, normal = true, bins, w = W, h = H }) {
    const g = new G(w, h), hb = S.histBins(values, bins), d = S.describe(values);
    const maxC = Math.max(...hb.counts);
    let peak = maxC; if (normal && d.sd > 0) peak = Math.max(peak, values.length * hb.width * Dist.dnorm(0) / d.sd);
    const f = frame(g, { title, x: { lo: hb.edges[0], hi: hb.edges[hb.edges.length - 1], label: xLabel, exact: true, ticks: niceTicks(hb.edges[0], hb.edges[hb.edges.length - 1], 7) }, y: { lo: 0, hi: peak * 1.05, label: 'Frequency' } });
    hb.counts.forEach((c, i) => {
      if (!c) return; const x0 = f.sx(hb.edges[i]) + 1, x1 = f.sx(hb.edges[i + 1]) - 1;
      g.rect(x0, f.sy(c), Math.max(1, x1 - x0), f.B - f.sy(c), PAL[0], null, 0, `${fmtTick(hb.edges[i], 4)} – ${fmtTick(hb.edges[i + 1], 4)}: ${c}`);
    });
    if (normal && d.sd > 0) {
      const pts = []; const a = hb.edges[0], b = hb.edges[hb.edges.length - 1];
      for (let k = 0; k <= 120; k++) { const xv = a + (b - a) * k / 120; pts.push(f.sx(xv), f.sy(values.length * hb.width * Dist.dnorm(xv, d.mean, d.sd))); }
      g.poly(pts, PAL[1], 2);
    }
    g.text(f.R, f.T - 4, `Mean = ${fmtTick(d.mean, 3)}   SD = ${fmtTick(d.sd, 3)}   N = ${d.n}`, 10.5, INK2, 'e');
    return g.done();
  }

  // ---------- box plot ----------
  function boxStats(v) {
    const s = S.sorted(v), q1 = S.quantile(s, 0.25), q3 = S.quantile(s, 0.75), md = S.quantile(s, 0.5), iqr = q3 - q1;
    const lf = q1 - 1.5 * iqr, uf = q3 + 1.5 * iqr, inside = Array.from(s).filter(x => x >= lf && x <= uf);
    return { q1, q3, md, lo: inside.length ? inside[0] : q1, hi: inside.length ? inside[inside.length - 1] : q3, out: Array.from(s).filter(x => x < lf || x > uf).map(x => ({ v: x, ext: x < q1 - 3 * iqr || x > q3 + 3 * iqr })), n: s.length, mean: S.mean(v) };
  }
  function boxplot({ groups, title, yLabel, xLabel, w = W, h = H }) {
    const g = new G(w, h), bs = groups.map(gr => ({ name: gr.name, ...boxStats(gr.values) }));
    const all = groups.flatMap(x => x.values), lo = Math.min(...all), hi = Math.max(...all), padv = (hi - lo) * 0.04 || 1;
    const f = frame(g, { title, x: { cats: bs.map(b => b.name), label: xLabel }, y: { lo: lo - padv, hi: hi + padv, label: yLabel } });
    bs.forEach((b, i) => {
      const cx = f.sx(i), bw = Math.min(70, f.sx.band * 0.5), col = groups.length > 1 && groups.colorBy !== false ? PAL[i % PAL.length] : PAL[0];
      g.line(cx, f.sy(b.hi), cx, f.sy(b.q3), INK2, 1.2); g.line(cx, f.sy(b.lo), cx, f.sy(b.q1), INK2, 1.2);
      g.line(cx - bw / 4, f.sy(b.hi), cx + bw / 4, f.sy(b.hi), INK2, 1.2); g.line(cx - bw / 4, f.sy(b.lo), cx + bw / 4, f.sy(b.lo), INK2, 1.2);
      g.rect(cx - bw / 2, f.sy(b.q3), bw, Math.max(1, f.sy(b.q1) - f.sy(b.q3)), col + '55', col, 1.5, `${b.name}: median ${fmtTick(b.md, 3)}, Q1 ${fmtTick(b.q1, 3)}, Q3 ${fmtTick(b.q3, 3)}, n = ${b.n}`);
      g.line(cx - bw / 2, f.sy(b.md), cx + bw / 2, f.sy(b.md), INK, 2.2);
      g.text(cx, f.sy(b.mean) + 4, '+', 13, INK, 'm', true);
      b.out.forEach(o => { if (o.ext) g.text(cx, f.sy(o.v) + 5, '*', 15, CRIT, 'm', true); else g.circle(cx, f.sy(o.v), 3.2, '#ffffff', INK2, 1.2, fmtTick(o.v, 4)); });
    });
    return g.done();
  }

  // ---------- scatter ----------
  function scatter({ x, y, groups, groupNames, fit, title, xLabel, yLabel, hline, w = W, h = H, pointLabels }) {
    const xs = x.filter(Number.isFinite), ys = y.filter(Number.isFinite);
    const xlo = Math.min(...xs), xhi = Math.max(...xs), ylo = Math.min(...ys), yhi = Math.max(...ys);
    const px = (xhi - xlo) * 0.04 || 1, py = (yhi - ylo) * 0.06 || 1;
    const ng = groupNames ? groupNames.length : 1;
    const legend = groupNames && ng > 1 ? groupNames.map((n, i) => ({ name: n, color: PAL[i % PAL.length] })) : null;
    const g = new G(w, h);
    const f = frame(g, { title, x: { lo: xlo - px, hi: xhi + px, label: xLabel, grid: true }, y: { lo: ylo - py, hi: yhi + py, label: yLabel }, legend });
    if (hline != null) g.line(f.L, f.sy(hline), f.R, f.sy(hline), MUTED, 1.2, 4);
    const n = x.length, r = n > 2000 ? 2.2 : n > 400 ? 3 : 4, tip = n <= 3000;
    for (let i = 0; i < n; i++) {
      const c = PAL[(groups ? groups[i] : 0) % PAL.length];
      g.circle(f.sx(x[i]), f.sy(y[i]), r, c + 'bb', '#ffffff', n > 2000 ? 0 : 1, tip ? (pointLabels ? pointLabels[i] + ': ' : '') + `(${fmtTick(x[i], 4)}, ${fmtTick(y[i], 4)})` : null);
    }
    if (fit) {
      const lines = groups && ng > 1 && fit === 'group' ? groupNames.map((_, k) => k) : [-1];
      lines.forEach(k => {
        const idx = []; for (let i = 0; i < n; i++) if (k < 0 || groups[i] === k) idx.push(i);
        if (idx.length < 3) return;
        const xv = idx.map(i => x[i]), yv = idx.map(i => y[i]), lr = S.linreg(yv, [xv], ['x']);
        if (lr.error) return;
        const b0 = lr.coef[0].b, b1 = lr.coef[1].b, a = Math.min(...xv), b = Math.max(...xv);
        g.line(f.sx(a), f.sy(b0 + b1 * a), f.sx(b), f.sy(b0 + b1 * b), k < 0 ? CRIT : PAL[k % PAL.length], 2);
        if (k < 0) {
          const eq = `y = ${fmtTick(b0, 3)} ${b1 < 0 ? '−' : '+'} ${fmtTick(Math.abs(b1), 4)}·x     R² = ${lr.r2.toFixed(3)}`;
          g.rect(f.L + 6, f.T + 4, tw(eq, 10.5) + 12, 18, '#ffffffdd', GRID, 1); g.text(f.L + 12, f.T + 17, eq, 10.5, INK, 's');
        }
      });
    }
    return g.done();
  }

  // ---------- bar chart (counts or means, optional error bars, optional clusters) ----------
  // series: [{name, values:[per category], err:[[lo,hi]]}]
  function bar({ cats, series, title, xLabel, yLabel, w = W, h = H, percent }) {
    const g = new G(w, h), ns = series.length;
    let hi = 0, lo = 0; series.forEach(s => s.values.forEach((v, i) => { const e = s.err && s.err[i]; hi = Math.max(hi, e ? e[1] : v); lo = Math.min(lo, e ? e[0] : v); }));
    const legend = ns > 1 ? series.map((s, i) => ({ name: s.name, color: PAL[i % PAL.length] })) : null;
    const f = frame(g, { title, x: { cats, label: xLabel }, y: { lo, hi: hi * 1.08 || 1, label: yLabel }, legend });
    const gw = Math.min(f.sx.band * 0.78, 60 * ns), bw = gw / ns;
    series.forEach((s, k) => s.values.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) return;
      const x0 = f.sx(i) - gw / 2 + k * bw + 1, y0 = f.sy(Math.max(0, v)), y1 = f.sy(Math.min(0, v));
      g.rect(x0, y0, Math.max(1, bw - 2), Math.max(0.5, y1 - y0), PAL[(ns > 1 ? k : 0) % PAL.length], null, 0, `${cats[i]}${ns > 1 ? ' · ' + s.name : ''}: ${fmtTick(v, percent ? 1 : 3)}${percent ? '%' : ''}`);
      const e = s.err && s.err[i];
      if (e && Number.isFinite(e[0])) { const cx = x0 + (bw - 2) / 2; g.line(cx, f.sy(e[0]), cx, f.sy(e[1]), INK, 1.3); g.line(cx - 5, f.sy(e[0]), cx + 5, f.sy(e[0]), INK, 1.3); g.line(cx - 5, f.sy(e[1]), cx + 5, f.sy(e[1]), INK, 1.3); }
      if (ns === 1 && cats.length <= 16 && bw > 26) g.text(x0 + (bw - 2) / 2, v < 0 ? (e ? Math.max(f.sy(e[0]), y1) : y1) + 13 : (e ? Math.min(f.sy(e[1]), y0) : y0) - 5, fmtTick(v, percent ? 1 : Number.isInteger(v) ? 0 : 2) + (percent ? '%' : ''), 10, INK2, 'm');
    }));
    if (lo < 0) g.line(f.L, f.sy(0), f.R, f.sy(0), AXIS, 1);
    return g.done();
  }

  // ---------- normal Q-Q ----------
  function qq({ values, title, xLabel = 'Theoretical normal quantile', yLabel = 'Observed value', w = W, h = H }) {
    const s = S.sorted(values), n = s.length, m = S.mean(s), sd = Math.sqrt(S.variance(s));
    const th = Array.from(s, (_, i) => Dist.qnorm((i + 1 - 0.375) / (n + 0.25)));
    const g = new G(w, h), py = (s[n - 1] - s[0]) * 0.06 || 1;
    const f = frame(g, { title, x: { lo: th[0] - 0.2, hi: th[n - 1] + 0.2, label: xLabel, grid: true }, y: { lo: s[0] - py, hi: s[n - 1] + py, label: yLabel } });
    const a = th[0] - 0.2, b = th[n - 1] + 0.2;
    g.line(f.sx(a), f.sy(m + sd * a), f.sx(b), f.sy(m + sd * b), CRIT, 1.6);
    const r = n > 1000 ? 2.2 : 3.6;
    for (let i = 0; i < n; i++) g.circle(f.sx(th[i]), f.sy(s[i]), r, PAL[0] + 'cc', '#ffffff', n > 1000 ? 0 : 1, n <= 3000 ? `${fmtTick(s[i], 4)} (expected ${fmtTick(m + sd * th[i], 4)})` : null);
    return g.done();
  }

  // ---------- line / profile plot ----------
  function lines({ cats, series, title, xLabel, yLabel, w = W, h = H, markers = true }) {
    const g = new G(w, h), all = series.flatMap(s => s.values.filter(Number.isFinite)), lo = Math.min(...all), hi = Math.max(...all), p = (hi - lo) * 0.1 || 1;
    const legend = series.length > 1 ? series.map((s, i) => ({ name: s.name, color: PAL[i % PAL.length], line: true })) : null;
    const f = frame(g, { title, x: { cats, label: xLabel }, y: { lo: lo - p, hi: hi + p, label: yLabel }, legend });
    series.forEach((s, k) => {
      const c = PAL[k % PAL.length], pts = [];
      s.values.forEach((v, i) => { if (Number.isFinite(v)) pts.push(f.sx(i), f.sy(v)); });
      g.poly(pts, c, 2);
      if (markers) s.values.forEach((v, i) => Number.isFinite(v) && g.circle(f.sx(i), f.sy(v), 4.5, c, '#ffffff', 2, `${cats[i]}${series.length > 1 ? ' · ' + s.name : ''}: ${fmtTick(v, 3)}`));
    });
    return g.done();
  }

  // ---------- control charts (one or two stacked panels) ----------
  // panels: [{name, values (null allowed), center, ucl, lcl (number or array), flags:[[rules]]}]
  function control({ panels, title, xLabel = 'Observation', w = W, h }) {
    const ph = 210, g = new G(w, h || (title ? 30 : 0) + panels.length * ph + 10);
    if (title) g.text(w / 2, 22, title, 13.5, INK, 'm', true);
    panels.forEach((P, k) => {
      const sub = new G(w, ph); const vals = P.values.filter(v => v != null);
      const arr = v => Array.isArray(v) ? v : P.values.map(() => v);
      const U = arr(P.ucl), Lw = arr(P.lcl);
      const lo = Math.min(...vals, ...Lw.filter(Number.isFinite)), hi = Math.max(...vals, ...U.filter(Number.isFinite)), pd = (hi - lo) * 0.08 || 1;
      const n = P.values.length;
      const f = frame(sub, { x: { lo: 0.5, hi: n + 0.5, label: k === panels.length - 1 ? xLabel : null, exact: true, ticks: niceTicks(1, n, 8) }, y: { lo: lo - pd, hi: hi + pd, label: P.name }, pad: { r: 92 } });
      const stepLine = (a, col, dash) => {
        if (a.every(v => v === a[0])) { sub.line(f.sx(0.5), f.sy(a[0]), f.sx(n + 0.5), f.sy(a[0]), col, 1.4, dash); return; }
        const pts = []; a.forEach((v, i) => { pts.push(f.sx(i + 0.5), f.sy(v), f.sx(i + 1.5), f.sy(v)); }); sub.poly(pts, col, 1.4, null, false, dash);
      };
      stepLine(U, CRIT, 5); stepLine(Lw, CRIT, 5); stepLine(P.values.map(() => P.center), '#1baf7a', 0);
      const lab = (v, s, col) => sub.text(f.R + 6, f.sy(v) + 4, `${s}=${fmtTick(v, 3)}`, 10, col, 's');
      lab(U[n - 1], 'UCL', CRIT); lab(P.center, P.centerName || 'CL', '#13865d'); if (Lw[n - 1] > -Infinity) lab(Lw[n - 1], 'LCL', CRIT);
      const pts = []; P.values.forEach((v, i) => { if (v != null) pts.push(f.sx(i + 1), f.sy(v)); }); sub.poly(pts, PAL[0], 1.5);
      P.values.forEach((v, i) => { if (v == null) return; const bad = P.flags && P.flags[i] && P.flags[i].length; sub.circle(f.sx(i + 1), f.sy(v), bad ? 4.5 : 3, bad ? CRIT : PAL[0], '#ffffff', 1, `#${i + 1}: ${fmtTick(v, 4)}${bad ? ' — test ' + P.flags[i].join(', ') + ' failed' : ''}`); if (bad) sub.text(f.sx(i + 1), f.sy(v) - 8, P.flags[i].join(','), 9.5, CRIT, 'm', true); });
      const dy = (title ? 30 : 0) + k * ph;
      sub.ops.forEach(o => g.ops.push(shift(o, 0, dy)));
    });
    return g.done();
  }
  function shift(o, dx, dy) {
    const c = o.slice();
    if (c[0] === 'l') { c[1] += dx; c[2] += dy; c[3] += dx; c[4] += dy; }
    else if (c[0] === 'p') c[1] = c[1].map((v, i) => i % 2 ? v + dy : v + dx);
    else { c[1] += dx; c[2] += dy; }
    return c;
  }

  // ---------- SVG rendering ----------
  const escX = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
  const col = (c, d = 'none') => c && COLOR_RE.test(c) ? c : d;
  const nm = v => Number.isFinite(+v) ? +v : 0;
  function toSVG(ch, { cls = 'lchart' } = {}) {
    if (!ch || !Array.isArray(ch.ops)) return '';
    const w = nm(ch.w) || W, h = nm(ch.h) || H, out = [`<svg class="${cls}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, Tahoma, Arial, sans-serif"><rect width="${w}" height="${h}" fill="#ffffff"/>`];
    const tt = t => t ? `<title>${escX(t)}</title>` : '';
    for (const o of ch.ops.slice(0, 200000)) {
      if (!Array.isArray(o)) continue;
      switch (o[0]) {
        case 'l': out.push(`<line x1="${nm(o[1])}" y1="${nm(o[2])}" x2="${nm(o[3])}" y2="${nm(o[4])}" stroke="${col(o[5], '#000')}" stroke-width="${nm(o[6]) || 1}"${o[7] ? ` stroke-dasharray="${nm(o[7])} ${nm(o[7])}"` : ''}/>`); break;
        case 'r': out.push(`<rect x="${nm(o[1])}" y="${nm(o[2])}" width="${Math.max(0, nm(o[3]))}" height="${Math.max(0, nm(o[4]))}" fill="${col(o[5])}"${o[6] ? ` stroke="${col(o[6])}" stroke-width="${nm(o[7])}"` : ''}${o[8] ? ' class="hv"' : ''}>${tt(o[8])}</rect>`); break;
        case 'c': out.push(`<circle cx="${nm(o[1])}" cy="${nm(o[2])}" r="${nm(o[3])}" fill="${col(o[4])}"${o[5] ? ` stroke="${col(o[5])}" stroke-width="${nm(o[6])}"` : ''}${o[7] ? ' class="hv"' : ''}>${tt(o[7])}</circle>`); break;
        case 'p': { const p = Array.isArray(o[1]) ? o[1] : []; let d = ''; for (let i = 0; i + 1 < p.length; i += 2) d += (i ? 'L' : 'M') + nm(p[i]) + ' ' + nm(p[i + 1]); if (o[5]) d += 'Z';
          out.push(`<path d="${d}" fill="${col(o[4])}" stroke="${col(o[2])}" stroke-width="${nm(o[3])}" stroke-linejoin="round" stroke-linecap="round"${o[6] ? ` stroke-dasharray="${nm(o[6])} ${nm(o[6])}"` : ''}/>`); break; }
        case 't': { const a = o[6] === 'm' ? 'middle' : o[6] === 'e' ? 'end' : 'start', rot = nm(o[8]);
          out.push(`<text x="${nm(o[1])}" y="${nm(o[2])}" font-size="${nm(o[4]) || 11}" fill="${col(o[5], '#000')}" text-anchor="${a}"${o[7] ? ' font-weight="600"' : ''}${rot ? ` transform="rotate(${rot} ${nm(o[1])} ${nm(o[2])})"` : ''}>${escX(o[3])}</text>`); break; }
      }
    }
    out.push('</svg>');
    return out.join('');
  }

  const api = { PAL, G, niceTicks, fmtTick, frame, histogram, boxplot, boxStats, scatter, bar, qq, lines, control, toSVG, COLOR_RE };
  if (isNode) module.exports = api; else root.LCharts = api;
})(typeof self !== 'undefined' ? self : this);
