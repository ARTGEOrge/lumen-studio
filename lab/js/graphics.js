// Lumen Lab — graphics model. Plot commands build plain-data figures (figures → axes → series) that
// the UI renders on canvas; nothing here touches the DOM, so it runs in the worker and in Node tests.
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const M = node ? require('./mat.js') : root.LabMat;
  const I = node ? require('./interp.js') : root.LabInterp;
  const Lib = node ? require('./lib.js') : root.LabLib;
  const { Mat, fail, num } = M;
  const { N, S, Str, isStr, vec } = Lib;

  const ORDER = [[0, 0.447, 0.741], [0.85, 0.325, 0.098], [0.929, 0.694, 0.125], [0.494, 0.184, 0.556], [0.466, 0.674, 0.188], [0.301, 0.745, 0.933], [0.635, 0.078, 0.184]];
  const LETTER = { b: [0, 0, 1], g: [0, 1, 0], r: [1, 0, 0], c: [0, 1, 1], m: [1, 0, 1], y: [1, 1, 0], k: [0, 0, 0], w: [1, 1, 1] };
  const NAMED = { blue: 'b', green: 'g', red: 'r', cyan: 'c', magenta: 'm', yellow: 'y', black: 'k', white: 'w' };
  const MARKERS = { o: 'o', '+': '+', '*': '*', '.': '.', x: 'x', s: 's', d: 'd', '^': '^', v: 'v', '<': '<', '>': '>', p: 'p', h: 'h', square: 's', diamond: 'd', pentagram: 'p', hexagram: 'h', none: 'none', '_': '_', '|': '|' };
  const COLORMAPS = ['parula', 'jet', 'viridis', 'hot', 'cool', 'gray', 'turbo', 'hsv', 'spring', 'summer', 'autumn', 'winter', 'bone', 'copper', 'pink', 'lines'];

  function parseSpec(s) {
    const out = {}; let i = 0;
    while (i < s.length) {
      const two = s.substr(i, 2);
      if (two === '--' || two === '-.') { if (out.style) return null; out.style = two; i += 2; continue; }
      const c = s[i];
      if (c === '-' || c === ':') { if (out.style) return null; out.style = c; i++; continue; }
      if (LETTER[c] && !(c === 'h' || c === 'd' || c === 's' || c === 'p')) { if (out.color) return null; out.color = LETTER[c]; i++; continue; }
      if ('o+*.xsd^v<>ph'.includes(c)) { if (out.marker) return null; out.marker = c; i++; continue; }
      return null;
    }
    return out;
  }
  function colorOf(v) {
    if (!v) return null;
    if (isStr(v)) {
      const s = Str(v).toLowerCase(); if (s === 'none') return 'none'; if (s === 'flat' || s === 'interp' || s === 'auto') return s;
      if (LETTER[s]) return LETTER[s]; if (NAMED[s]) return LETTER[NAMED[s]];
      const m = s.match(/^#?([0-9a-f]{6})$/); if (m) return [0, 2, 4].map(k => parseInt(m[1].substr(k, 2), 16) / 255);
      fail(`Invalid color '${s}'. Use a letter (r g b c m y k w), a name like 'red', '#ff8800' or an [R G B] triplet.`);
    }
    const a = vec(v); if (a.length !== 3) fail('A color must be an RGB triplet [r g b] with values between 0 and 1.');
    return a.map(x => x > 1 ? x / 255 : x);
  }
  const F64 = a => Float64Array.from(a);

  function attach(In) {
    const G = { figs: [], cur: null, dirty: true, nextAx: 1, nextObj: 1, version: 0 };
    const L = In.lib;
    const touch = () => { G.dirty = true; G.version++; };
    function newFig(id) {
      const f = { id, name: '', axes: [], cur: -1, colormap: 'parula', visible: true };
      G.figs.push(f); G.figs.sort((a, b) => a.id - b.id); G.cur = f; touch(); return f;
    }
    function gcf() { return G.cur || newFig(G.figs.length ? Math.max(...G.figs.map(f => f.id)) + 1 : 1); }
    function newAxes(f, sub) {
      const ax = { id: 1e4 + G.nextAx++, sub: sub || null, hold: false, series: [], colorIdx: 0, title: '', subtitle: '', xlabel: '', ylabel: '', zlabel: '', legend: null, grid: false, minor: false, box: true, xlim: null, ylim: null, zlim: null, clim: null, view: null, axis: [], xscale: 'linear', yscale: 'linear', colorbar: false, colormap: null, shading: 'faceted', polar: false, ydir: 'normal' };
      f.axes.push(ax); f.cur = f.axes.length - 1; touch(); return ax;
    }
    function gca() { const f = gcf(); if (f.cur < 0 || !f.axes[f.cur]) return newAxes(f); return f.axes[f.cur]; }
    // start a new plot in the current axes (clears it unless hold is on)
    function newplot() {
      const ax = gca();
      if (ax.yy && !ax.hold) { ax.series = ax.series.filter(s => s.yside !== ax.yySide); touch(); return ax; }
      if (!ax.hold) {
        const keep = { id: ax.id, sub: ax.sub, hold: false };
        Object.assign(ax, { series: [], colorIdx: 0, title: '', subtitle: '', xlabel: '', ylabel: '', zlabel: '', legend: null, grid: ax.grid, minor: ax.minor, xlim: null, ylim: null, zlim: null, clim: null, view: null, axis: [], xscale: 'linear', yscale: 'linear', colorbar: false, shading: 'faceted', polar: false, ydir: 'normal' }, keep);
      }
      touch(); return ax;
    }
    const nextColor = ax => { if (ax.yy) return ORDER[ax.yySide === 'right' ? 1 : 0]; const c = ORDER[ax.colorIdx % ORDER.length]; ax.colorIdx++; return c; };
    const add = (ax, s) => { s.h = G.nextObj++; if (ax.yy) s.yside = ax.yySide; ax.series.push(s); touch(); return num(s.h); };
    // name/value pairs → props
    function nvProps(a, start) {
      const p = {};
      for (let k = start; k < a.length; k++) {
        if (!isStr(a[k])) continue;
        const name = Str(a[k]).toLowerCase(), v = a[k + 1];
        if (name === 'filled') { p.filled = true; continue; }
        if (name === 'stacked' || name === 'grouped') { p.barLayout = name; continue; }
        if (v === undefined) { const sp = parseSpec(Str(a[k])); if (sp) Object.assign(p, { spec: sp }); continue; }
        k++;
        switch (name) {
          case 'linewidth': p.lw = S(v); break;
          case 'color': p.color = colorOf(v); break;
          case 'markersize': p.ms = S(v); break;
          case 'marker': p.marker = MARKERS[Str(v).toLowerCase()] || Str(v); break;
          case 'linestyle': p.style = Str(v); break;
          case 'markerfacecolor': p.mfc = colorOf(v); break;
          case 'markeredgecolor': p.mec = colorOf(v); break;
          case 'displayname': p.label = Str(v); break;
          case 'facecolor': p.faceColor = colorOf(v); break;
          case 'edgecolor': p.edgeColor = colorOf(v); break;
          case 'facealpha': p.alpha = S(v); break;
          case 'barwidth': p.width = S(v); break;
          case 'levellist': p.levels = vec(v); break;
          case 'fontsize': p.fontSize = S(v); break;
          case 'horizontalalignment': p.halign = Str(v); break;
          case 'numbins': p.nbins = S(v); break;
          case 'binedges': p.edges = vec(v); break;
          case 'normalization': p.norm = Str(v).toLowerCase(); break;
          default: /* ignore unknown properties (MATLAB has hundreds) */
        }
      }
      return p;
    }
    const isSpecArg = v => isStr(v) && !!parseSpec(Str(v));

    // ----- line plots -----
    function linePlot(a, nout, opts = {}) {
      const groups = []; let i = 0;
      const dims3 = opts.three;
      while (i < a.length && !isStr(a[i])) {
        if (dims3) {
          if (i + 2 >= a.length || isStr(a[i + 1]) || isStr(a[i + 2])) fail('plot3 needs x, y and z data.');
          const g = { X: N(a[i]), Y: N(a[i + 1]), Z: N(a[i + 2]) }; i += 3;
          if (i < a.length && isSpecArg(a[i])) g.spec = parseSpec(Str(a[i++])); groups.push(g); continue;
        }
        let X = N(a[i]), Y; if (i + 1 < a.length && !isStr(a[i + 1])) { Y = N(a[i + 1]); i += 2; } else { Y = X; X = null; i += 1; }
        const g = { X, Y }; if (i < a.length && isSpecArg(a[i])) g.spec = parseSpec(Str(a[i++]));
        groups.push(g);
      }
      if (!groups.length) fail('Not enough input arguments. Use plot(y) or plot(x, y).');
      const p = nvProps(a, i), ax = opts.noNew ? gca() : newplot();
      if (opts.xscale) { ax.xscale = opts.xscale; } if (opts.yscale) ax.yscale = opts.yscale;
      if (dims3 && !ax.view) ax.view = [-37.5, 30];
      const hs = [];
      for (const g of groups) {
        const pairs = [];
        if (dims3) { const n = Math.max(g.X.n, g.Y.n, g.Z.n); const ex = v => v.n === n ? Array.from(v.re) : new Array(n).fill(v.re[0]); pairs.push([ex(g.X), ex(g.Y), ex(g.Z)]); }
        else if (!g.X) {
          if (g.Y.im) pairs.push([Array.from(g.Y.re), Array.from(g.Y.im)]);
          else if (g.Y.r === 1 || g.Y.c === 1) pairs.push([g.Y.n ? Array.from({ length: g.Y.n }, (_, k) => k + 1) : [], Array.from(g.Y.re)]);
          else for (let j = 0; j < g.Y.c; j++) pairs.push([Array.from({ length: g.Y.r }, (_, k) => k + 1), Array.from(g.Y.re.subarray(j * g.Y.r, (j + 1) * g.Y.r))]);
        } else {
          const X = g.X, Y = g.Y, xv = X.r === 1 || X.c === 1, yv = Y.r === 1 || Y.c === 1;
          if (xv && yv) { if (X.n !== Y.n && X.n !== 1 && Y.n !== 1) fail('Vectors must be the same length.'); const n = Math.max(X.n, Y.n); pairs.push([X.n === 1 ? new Array(n).fill(X.re[0]) : Array.from(X.re), Y.n === 1 ? new Array(n).fill(Y.re[0]) : Array.from(Y.re)]); }
          else if (xv) { const n = X.n; if (Y.r === n) for (let j = 0; j < Y.c; j++) pairs.push([Array.from(X.re), Array.from(Y.re.subarray(j * Y.r, (j + 1) * Y.r))]); else if (Y.c === n) for (let r = 0; r < Y.r; r++) pairs.push([Array.from(X.re), Array.from({ length: n }, (_, j) => Y.re[r + j * Y.r])]); else fail('Vectors must be the same length.'); }
          else if (yv) { const n = Y.n; if (X.r === n) for (let j = 0; j < X.c; j++) pairs.push([Array.from(X.re.subarray(j * X.r, (j + 1) * X.r)), Array.from(Y.re)]); else fail('Vectors must be the same length.'); }
          else { if (X.r !== Y.r || X.c !== Y.c) fail('Data must have the same size.'); for (let j = 0; j < Y.c; j++) pairs.push([Array.from(X.re.subarray(j * X.r, (j + 1) * X.r)), Array.from(Y.re.subarray(j * Y.r, (j + 1) * Y.r))]); }
        }
        for (const pr of pairs) {
          const sp = g.spec || {};
          const color = p.color || sp.color || nextColor(ax);
          const style = p.style || sp.style || (sp.marker && !sp.style ? 'none' : '-');
          const s = { kind: 'line', x: F64(pr[0]), y: F64(pr[1]), color, style: style === 'none' ? 'none' : style, marker: p.marker || sp.marker || 'none', lw: p.lw || 1, ms: p.ms || 6, mfc: p.mfc || null, label: p.label || null };
          if (pr[2]) s.z = F64(pr[2]);
          if (opts.stairs) { const xs = [], ys = []; for (let k = 0; k < s.x.length; k++) { if (k) { xs.push(s.x[k]); ys.push(s.y[k - 1]); } xs.push(s.x[k]); ys.push(s.y[k]); } s.x = F64(xs); s.y = F64(ys); }
          if (opts.stem) { s.kind = 'stem'; if (s.marker === 'none') s.marker = 'o'; s.mfc = p.filled ? color : s.mfc; }
          if (opts.area) { s.kind = 'area'; s.faceColor = p.faceColor || color; s.alpha = p.alpha != null ? p.alpha : 1; }
          if (opts.errors) Object.assign(s, opts.errors);
          hs.push(add(ax, s));
        }
      }
      return nout > 0 ? M.vcat(hs) : undefined;
    }
    L.plot = (a, n) => linePlot(a, n);
    L.plot3 = (a, n) => linePlot(a, n, { three: true });
    L.semilogx = (a, n) => linePlot(a, n, { xscale: 'log' });
    L.semilogy = (a, n) => linePlot(a, n, { yscale: 'log' });
    L.loglog = (a, n) => linePlot(a, n, { xscale: 'log', yscale: 'log' });
    L.stairs = (a, n) => linePlot(a, n, { stairs: true });
    L.stem = (a, n) => linePlot(a, n, { stem: true });
    L.area = (a, n) => linePlot(a, n, { area: true });
    L.line = (a, n) => { const ax = gca(); const h = linePlot(a, n, { noNew: true }); void ax; return h; };
    L.errorbar = (a, n) => {
      const nums = a.filter(x => !isStr(x)); let x, y, lo, hi;
      if (nums.length === 2) { y = vec(nums[0]); x = y.map((_, k) => k + 1); lo = hi = vec(nums[1]); }
      else if (nums.length === 3) { x = vec(nums[0]); y = vec(nums[1]); lo = hi = vec(nums[2]); }
      else { x = vec(nums[0]); y = vec(nums[1]); lo = vec(nums[2]); hi = vec(nums[3]); }
      const rest = a.filter(isStr);
      return linePlot([M.rowVec(x), M.rowVec(y), ...rest], n, { errors: { elo: F64(lo), ehi: F64(hi) } });
    };
    L.fplot = (a, n, In2) => {
      const f = a[0]; let lim = [-5, 5], k = 1; if (a.length > 1 && !isStr(a[1])) { lim = vec(a[1]); k = 2; }
      const xs = Array.from({ length: 400 }, (_, i) => lim[0] + (lim[1] - lim[0]) * i / 399);
      let ys; const r = In.fcall(f, [M.rowVec(xs)]);
      if (r.type === 'num' && r.n === xs.length) ys = Array.from(r.re); else ys = xs.map(x => In.fcall(f, [num(x)]).re[0]);
      const h = linePlot([M.rowVec(xs), M.rowVec(ys), ...a.slice(k)], n); gca().xlim = lim; void In2; return h;
    };

    // ----- scatter -----
    function scatterPlot(a, nout, three) {
      const nums = []; let i = 0; while (i < a.length && !isStr(a[i])) nums.push(a[i++]);
      const need = three ? 3 : 2; if (nums.length < need) fail(`scatter${three ? '3' : ''} needs x${three ? ', y and z' : ' and y'} data.`);
      const p = nvProps(a, i); let marker = 'o'; for (let k = i; k < a.length; k++) if (isStr(a[k])) { const sp = parseSpec(Str(a[k])); if (sp && sp.marker) marker = sp.marker; if (sp && sp.color) p.color = sp.color; }
      if (p.marker) marker = p.marker;
      const ax = newplot(); if (three && !ax.view) ax.view = [-37.5, 30];
      const x = vec(nums[0]), y = vec(nums[1]), z = three ? vec(nums[2]) : null;
      const sz = nums[need] && nums[need].n ? vec(nums[need]) : [36], cArg = nums[need + 1];
      const s = { kind: 'scatter', x: F64(x), y: F64(y), sizes: F64(sz), marker, filled: !!p.filled, label: p.label || null, lw: p.lw || 0.5 };
      if (z) s.z = F64(z);
      if (cArg && cArg.n === x.length && (cArg.r === 1 || cArg.c === 1) && x.length !== 3) s.cdata = F64(vec(cArg));
      else if (cArg && cArg.c === 3 && cArg.r === x.length && x.length > 1) { s.colors = []; for (let k = 0; k < x.length; k++) s.colors.push([cArg.re[k], cArg.re[k + x.length], cArg.re[k + 2 * x.length]]); }
      else if (cArg) s.color = colorOf(cArg);
      if (!s.color && !s.cdata && !s.colors) s.color = p.color || p.mfc || nextColor(ax);
      if (p.mfc && p.mfc !== 'none') { s.filled = true; s.faceColor = p.mfc; }
      return nout > 0 ? add(ax, s) : (add(ax, s), undefined);
    }
    L.scatter = (a, n) => scatterPlot(a, n, false);
    L.scatter3 = (a, n) => scatterPlot(a, n, true);

    // ----- bar & histogram -----
    function barPlot(a, nout, horizontal) {
      const nums = []; let i = 0; while (i < a.length && !isStr(a[i])) nums.push(a[i++]);
      const p = nvProps(a, i); let color = p.faceColor || p.color || null; for (let k = i; k < a.length; k++) if (isStr(a[k])) { const sp = parseSpec(Str(a[k])); if (sp && sp.color) color = sp.color; }
      let X, Y; if (nums.length >= 2 && nums[1].n > 1 || (nums.length >= 2 && nums[0].n === nums[1].n)) { X = vec(nums[0]); Y = N(nums[1]); if (nums[2]) p.width = S(nums[2]); } else { Y = N(nums[0]); if (nums[1]) p.width = S(nums[1]); }
      let rows; // groups × series
      if (Y.r === 1 || Y.c === 1) rows = Array.from(Y.re, v => [v]);
      else { rows = []; for (let r = 0; r < Y.r; r++) { const row = []; for (let c = 0; c < Y.c; c++) row.push(Y.re[r + c * Y.r]); rows.push(row); } }
      if (!X) X = rows.map((_, k) => k + 1);
      const ax = newplot(), ns = rows[0] ? rows[0].length : 1;
      const colors = Array.from({ length: ns }, () => color && ns === 1 ? color : nextColor(ax));
      return add(ax, { kind: 'bar', x: F64(X), rows, width: p.width || 0.8, stacked: p.barLayout === 'stacked', horizontal: !!horizontal, colors, edge: p.edgeColor || null, label: p.label || null });
    }
    L.bar = (a, n) => { const h = barPlot(a, n, false); return n > 0 ? h : undefined; };
    L.barh = (a, n) => { const h = barPlot(a, n, true); return n > 0 ? h : undefined; };
    L.histogram = (a, nout) => {
      const x = N(a[0]); let k = 1; const args = [x];
      if (a.length > 1 && !isStr(a[1])) { args.push(a[1]); k = 2; }
      const p = nvProps(a, k); if (p.edges) args[1] = M.rowVec(p.edges); else if (p.nbins) args[1] = num(p.nbins);
      const [counts, edges] = L.histcounts(args, 2);
      let vals = Array.from(counts.re); const e = Array.from(edges.re), tot = vals.reduce((s, v) => s + v, 0);
      if (p.norm === 'probability') vals = vals.map(v => v / tot); else if (p.norm === 'pdf') vals = vals.map((v, i) => v / tot / (e[i + 1] - e[i])); else if (p.norm === 'cdf') { let s = 0; vals = vals.map(v => (s += v) / tot); }
      const ax = newplot();
      const h = add(ax, { kind: 'hist', edges: F64(e), counts: F64(vals), color: p.faceColor || p.color || nextColor(ax), alpha: p.alpha != null ? p.alpha : 0.6, label: p.label || null });
      return nout > 0 ? h : undefined;
    };
    L.hist = (a, nout) => {
      const x = N(a[0]); let nb = 10, centers = null;
      if (a.length > 1) { if (a[1].n > 1) centers = vec(a[1]); else nb = S(a[1]); }
      const v = Array.from(x.re).filter(isFinite), lo = Math.min(...v), hi = Math.max(...v);
      if (!centers) { const w = (hi - lo) / nb || 1; centers = Array.from({ length: nb }, (_, i) => lo + w * (i + 0.5)); }
      const edges = [-Infinity]; for (let i = 0; i < centers.length - 1; i++) edges.push((centers[i] + centers[i + 1]) / 2); edges.push(Infinity);
      const counts = new Array(centers.length).fill(0); for (const val of v) for (let i = 0; i < centers.length; i++) if (val >= edges[i] && (val < edges[i + 1] || i === centers.length - 1)) { counts[i]++; break; }
      if (nout > 0) return [M.rowVec(counts), M.rowVec(centers)];
      const ax = newplot(); add(ax, { kind: 'bar', x: F64(centers), rows: counts.map(c => [c]), width: 1, stacked: false, horizontal: false, colors: [nextColor(ax)], label: null });
    };
    L.pie = (a) => {
      const v = vec(a[0]), tot = v.reduce((s, x) => s + x, 0), ax = newplot(); ax.axis = ['equal', 'off'];
      let labels = null; if (a[1] && a[1].type === 'cell') labels = a[1].data.map(x => Str(x));
      add(ax, { kind: 'pie', values: F64(v.map(x => x / tot)), labels, colors: v.map((_, k) => ORDER[k % ORDER.length]) });
    };

    // ----- surfaces, contours, images -----
    function gridArgs(a, fn) {
      const nums = []; let i = 0; while (i < a.length && !isStr(a[i])) nums.push(a[i++]);
      let X, Y, Z, C;
      if (nums.length === 1 || (nums.length === 2 && fn === 'contour')) { Z = N(nums[0]); X = Y = null; }
      else if (nums.length >= 3) { X = N(nums[0]); Y = N(nums[1]); Z = N(nums[2]); C = nums[3] && nums[3].n > 1 ? N(nums[3]) : null; }
      else fail(`${fn} needs Z, or X, Y and Z.`);
      const r = Z.r, c = Z.c;
      if (r < 2 || c < 2) fail(`${fn}: Z must be a matrix with at least 2 rows and 2 columns.`);
      const gx = new Float64Array(r * c), gy = new Float64Array(r * c);
      for (let j = 0; j < c; j++) for (let k = 0; k < r; k++) {
        const idx = k + j * r;
        gx[idx] = !X ? j + 1 : (X.r === 1 || X.c === 1) ? X.re[j] : X.re[idx];
        gy[idx] = !Y ? k + 1 : (Y.r === 1 || Y.c === 1) ? Y.re[k] : Y.re[idx];
      }
      const levelsArg = (fn === 'contour' && nums.length === 2) ? nums[1] : (nums.length === 4 && fn === 'contour') ? nums[3] : null;
      return { r, c, X: gx, Y: gy, Z: F64(Z.re), C: C ? F64(C.re) : null, levelsArg, p: nvProps(a, i), strs: a.slice(i).filter(isStr).map(Str) };
    }
    function surfPlot(a, nout, kind) {
      const g = gridArgs(a, kind), ax = newplot();
      if (kind !== 'pcolor' && !ax.view) ax.view = [-37.5, 30];
      if (kind === 'pcolor') { ax.view = null; }
      const s = { kind: 'surf', r: g.r, c: g.c, X: g.X, Y: g.Y, Z: kind === 'pcolor' ? new Float64Array(g.r * g.c) : g.Z, C: g.C || (kind === 'pcolor' ? g.Z : null), mesh: kind === 'mesh', faceColor: g.p.faceColor || (kind === 'mesh' ? 'none' : 'flat'), edgeColor: g.p.edgeColor || (kind === 'mesh' ? 'flat' : [0, 0, 0]), alpha: g.p.alpha != null ? g.p.alpha : 1, lw: g.p.lw || 0.5 };
      if (kind === 'surfc' || kind === 'meshc') { add(ax, s); return add(ax, { kind: 'contour', r: g.r, c: g.c, X: g.X, Y: g.Y, Z: g.Z, n: 10, filled: false, base: true }); }
      return add(ax, s);
    }
    L.surf = (a, n) => { const h = surfPlot(a, n, 'surf'); return n ? h : undefined; };
    L.mesh = (a, n) => { const h = surfPlot(a, n, 'mesh'); return n ? h : undefined; };
    L.surfc = (a, n) => { const h = surfPlot(a, n, 'surfc'); return n ? h : undefined; };
    L.meshc = (a, n) => { const h = surfPlot(a, n, 'meshc'); return n ? h : undefined; };
    L.pcolor = (a, n) => { const h = surfPlot(a, n, 'pcolor'); return n ? h : undefined; };
    L.waterfall = L.mesh;
    function contourPlot(a, nout, filled, three) {
      const g = gridArgs(a, 'contour'), ax = newplot(); if (three && !ax.view) ax.view = [-37.5, 30];
      let levels = null, n = 10; if (g.levelsArg) { if (g.levelsArg.n === 1) n = S(g.levelsArg); else levels = vec(g.levelsArg); }
      if (g.p.levels) levels = g.p.levels;
      const sp = g.strs.map(parseSpec).find(Boolean);
      return add(ax, { kind: 'contour', r: g.r, c: g.c, X: g.X, Y: g.Y, Z: g.Z, n, levels: levels ? F64(levels) : null, filled, three: !!three, color: (sp && sp.color) || g.p.color || null, lw: g.p.lw || 0.5, labels: g.strs.some(s => /showtext/i.test(s)) });
    }
    L.contour = (a, n) => { const h = contourPlot(a, n, false); return n ? h : undefined; };
    L.contourf = (a, n) => { const h = contourPlot(a, n, true); return n ? h : undefined; };
    L.contour3 = (a, n) => { const h = contourPlot(a, n, false, true); return n ? h : undefined; };
    L.imagesc = (a, n) => {
      const nums = a.filter(x => !isStr(x)); let Cm, xr = null, yr = null;
      if (nums.length >= 3) { xr = vec(nums[0]); yr = vec(nums[1]); Cm = N(nums[2]); } else Cm = N(nums[0]);
      const ax = newplot(); ax.ydir = 'reverse'; ax.axis = ['tight'];
      const x = xr ? [xr[0], xr[xr.length - 1]] : [1, Cm.c], y = yr ? [yr[0], yr[yr.length - 1]] : [1, Cm.r];
      if (nums.length === 2 && nums[1].n === 2) ax.clim = vec(nums[1]);
      const h = add(ax, { kind: 'image', r: Cm.r, c: Cm.c, C: F64(Cm.re), x, y });
      return n ? h : undefined;
    };
    L.image = L.imagesc;
    L.fill = (a, nout) => {
      const ax = newplot(); let i = 0, h;
      while (i + 2 < a.length + 1 && i < a.length && !isStr(a[i])) {
        const x = vec(a[i]), y = vec(a[i + 1]), c = a[i + 2]; i += 3;
        h = add(ax, { kind: 'fill', x: F64(x), y: F64(y), color: c ? colorOf(c) : nextColor(ax), alpha: 1 });
      }
      const p = nvProps(a, i); if (h) { const s = ax.series[ax.series.length - 1]; if (p.alpha != null) s.alpha = p.alpha; if (p.edgeColor) s.edge = p.edgeColor; if (p.faceColor) s.color = p.faceColor; }
      return nout ? h : undefined;
    };
    L.patch = L.fill;
    L.polarplot = (a, nout) => {
      const th = vec(a[0]), rho = a.length > 1 && !isStr(a[1]) ? vec(a[1]) : null;
      const r = rho || th, t = rho ? th : th.map((_, k) => k);
      const h = linePlot([M.rowVec(r.map((v, k) => v * Math.cos(t[k]))), M.rowVec(r.map((v, k) => v * Math.sin(t[k]))), ...a.slice(rho ? 2 : 1)], nout);
      const ax = gca(); ax.polar = true; ax.axis = ['equal']; return h;
    };
    L.polar = L.polarplot;
    L.quiver = (a, nout) => {
      const nums = a.filter(x => !isStr(x)); let X, Y, U, V;
      if (nums.length >= 4) { [X, Y, U, V] = nums.slice(0, 4).map(vec); } else { U = vec(nums[0]); V = vec(nums[1]); const m = N(nums[0]); X = U.map((_, k) => Math.floor(k / m.r) + 1); Y = U.map((_, k) => (k % m.r) + 1); }
      let mx = 0; for (let k = 0; k < U.length; k++) mx = Math.max(mx, Math.hypot(U[k], V[k]));
      const span = Math.max(Math.max(...X) - Math.min(...X), Math.max(...Y) - Math.min(...Y)) || 1, sc = mx ? 0.9 * span / Math.sqrt(U.length) / mx : 1;
      const ax = newplot(); return add(ax, { kind: 'quiver', x: F64(X), y: F64(Y), u: F64(U.map(v => v * sc)), v: F64(V.map(v => v * sc)), color: nextColor(ax) });
    };
    L.text = (a, nout) => {
      const ax = gca(), three = a.length >= 4 && !isStr(a[2]);
      const x = vec(a[0]), y = vec(a[1]), z = three ? vec(a[2]) : null, sv = a[three ? 3 : 2];
      const strs = sv.type === 'cell' ? sv.data.map(v => Str(v)) : [Str(sv)];
      const p = nvProps(a, three ? 4 : 3);
      x.forEach((xv, k) => add(ax, { kind: 'text', x: xv, y: y[k], z: z ? z[k] : null, str: strs[Math.min(k, strs.length - 1)], color: p.color || [0, 0, 0], fontSize: p.fontSize || 10, halign: p.halign || 'left' }));
    };
    const refLine = kind => (a) => { const ax = gca(); const p = nvProps(a, 1); let style = '-', color = p.color || [0.15, 0.15, 0.15]; for (let k = 1; k < a.length; k++) if (isStr(a[k])) { const sp = parseSpec(Str(a[k])); if (sp) { style = sp.style || style; color = sp.color || color; } else if (k === 1 || !isStr(a[k - 1])) { /* label */ } } let label = null; if (a[1] && isStr(a[1]) && !parseSpec(Str(a[1]))) label = Str(a[1]); if (a[2] && isStr(a[2]) && !parseSpec(Str(a[2])) && !/^(color|linewidth|linestyle|displayname)$/i.test(Str(a[2]))) label = Str(a[2]); vec(a[0]).forEach(v => add(ax, { kind, v, style, color, lw: p.lw || 0.5, label: p.label || label })); };
    L.xline = refLine('xline'); L.yline = refLine('yline');

    // ----- figure & axes management -----
    L.figure = (a, nout) => {
      let f;
      if (a.length && !isStr(a[0])) { const id = S(a[0]); f = G.figs.find(x => x.id === id) || newFig(id); G.cur = f; }
      else f = newFig(G.figs.length ? Math.max(...G.figs.map(x => x.id)) + 1 : 1);
      for (let k = a.length && !isStr(a[0]) ? 1 : 0; k + 1 < a.length; k += 2) if (isStr(a[k]) && /^name$/i.test(Str(a[k]))) f.name = Str(a[k + 1]);
      touch(); return nout ? num(f.id) : undefined;
    };
    L.gcf = () => num(gcf().id);
    L.gca = () => num(gca().id);
    L.clf = () => { const f = gcf(); f.axes = []; f.cur = -1; touch(); };
    L.cla = () => { const ax = gca(); ax.series = []; ax.colorIdx = 0; touch(); };
    L.close = a => {
      if (!a.length) { if (G.cur) { G.figs = G.figs.filter(f => f !== G.cur); G.cur = G.figs[G.figs.length - 1] || null; } }
      else if (isStr(a[0]) && Str(a[0]) === 'all') { G.figs = []; G.cur = null; }
      else { const ids = vec(a[0]); G.figs = G.figs.filter(f => !ids.includes(f.id)); if (G.cur && ids.includes(G.cur.id)) G.cur = G.figs[G.figs.length - 1] || null; }
      touch();
    };
    L.subplot = (a, nout) => {
      let m, n, p;
      if (a.length === 1) { const v = Math.floor(S(a[0])); m = Math.floor(v / 100); n = Math.floor(v / 10) % 10; p = [v % 10]; }
      else { m = S(a[0]); n = S(a[1]); p = vec(a[2]); }
      if (p.some(x => x < 1 || x > m * n)) fail(`Index exceeds number of subplots (${m * n}).`);
      const f = gcf(), key = `${m},${n},${p.join(' ')}`;
      let k = f.axes.findIndex(ax => ax.sub && ax.sub.key === key);
      if (k < 0) {
        // remove axes that overlap the new one
        const cells = new Set(cellsOf(m, n, p));
        f.axes = f.axes.filter(ax => ax.sub && !(ax.sub.m === m && ax.sub.n === n && cellsOf(ax.sub.m, ax.sub.n, ax.sub.p).some(c => cells.has(c))) && !(ax.sub.m !== m || ax.sub.n !== n ? overlapFrac(ax.sub, { m, n, p }) : false));
        newAxes(f, { m, n, p, key }); k = f.axes.length - 1;
      }
      f.cur = k; touch(); return nout ? num(f.axes[k].id) : undefined;
    };
    const cellsOf = (m, n, p) => { const rs = p.map(x => Math.floor((x - 1) / n)), cs = p.map(x => (x - 1) % n), out = []; for (let r = Math.min(...rs); r <= Math.max(...rs); r++) for (let c = Math.min(...cs); c <= Math.max(...cs); c++) out.push(r * n + c + 1); return out; };
    const rectOf = s => { const cs = cellsOf(s.m, s.n, s.p), rs = cs.map(x => Math.floor((x - 1) / s.n)), cl = cs.map(x => (x - 1) % s.n); return [Math.min(...cl) / s.n, Math.min(...rs) / s.m, (Math.max(...cl) + 1) / s.n, (Math.max(...rs) + 1) / s.m]; };
    const overlapFrac = (s1, s2) => { const a = rectOf(s1), b = rectOf(s2); const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); return w > 1e-9 && h > 1e-9; };
    L.tiledlayout = a => { const f = gcf(); f.axes = []; f.cur = -1; f.tiles = { m: S(a[0]), n: a.length > 1 && !isStr(a[1]) ? S(a[1]) : 1, next: 1 }; touch(); };
    L.nexttile = (a, nout) => { const f = gcf(); const t = f.tiles || { m: 1, n: 1, next: 1 }; const p = a.length ? S(a[0]) : t.next; t.next = p + 1; f.tiles = t; return L.subplot([num(t.m), num(t.n), num(p)], nout); };
    L.hold = a => {
      const ax = gca(); if (!a.length) { ax.hold = !ax.hold; return; }
      const s = Str(a[0]).toLowerCase(); ax.hold = s === 'on' || s === 'all'; touch();
    };
    L.ishold = () => M.bool(gca().hold);
    const label = key => (a) => { const ax = gca(); if (!a.length) return; const v = a[0], t = v.type === 'cell' ? v.data.map(x => Str(x)).join('\n') : Str(v); if (key === 'ylabel' && ax.yy && ax.yySide === 'right') ax.yy.ylabel = t; else ax[key] = t; touch(); };
    L.yyaxis = a => {
      const ax = gca(), side = a.length ? Str(a[a.length - 1]).toLowerCase() : 'left';
      if (side !== 'left' && side !== 'right') fail("yyaxis: use yyaxis left or yyaxis right.");
      if (!ax.yy) { ax.yy = { ylabel: '', ylim: null }; ax.series.forEach(s => { s.yside = 'left'; }); }
      ax.yySide = side; touch();
    };
    L.title = label('title'); L.subtitle = label('subtitle'); L.xlabel = label('xlabel'); L.ylabel = label('ylabel'); L.zlabel = label('zlabel');
    L.sgtitle = a => { gcf().title = Str(a[0]); touch(); };
    L.legend = a => {
      const ax = gca();
      if (a.length && isStr(a[0]) && /^(off|hide)$/i.test(Str(a[0]))) { ax.legend = null; touch(); return; }
      let labels = [], loc = 'northeast', k = 0;
      if (a.length && a[0].type === 'cell') { labels = a[0].data.map(x => Str(x)); k = 1; }
      else while (k < a.length && isStr(a[k]) && !/^(location|orientation|box|fontsize|numcolumns|autoupdate|textcolor)$/i.test(Str(a[k]))) { const s = Str(a[k]); if (!/^(show|boxoff|boxon)$/i.test(s)) labels.push(s); k++; }
      for (; k + 1 < a.length; k += 2) if (isStr(a[k]) && /^location$/i.test(Str(a[k]))) loc = Str(a[k + 1]).toLowerCase();
      ax.legend = { labels: labels.length ? labels : null, loc }; touch();
    };
    L.grid = a => { const ax = gca(); const s = a.length ? Str(a[0]).toLowerCase() : null; if (s === 'minor') { ax.minor = !ax.minor; ax.grid = true; } else ax.grid = s === null ? !ax.grid : s === 'on'; if (s === 'off') ax.minor = false; touch(); };
    L.box = a => { const ax = gca(); ax.box = !a.length || Str(a[0]).toLowerCase() === 'on'; touch(); };
    L.axis = (a, nout) => {
      const ax = gca();
      if (!a.length) { const lim = ax.xlim && ax.ylim ? [...ax.xlim, ...ax.ylim] : [0, 1, 0, 1]; return M.rowVec(lim); }
      for (const v of a) {
        if (isStr(v)) {
          const s = Str(v).toLowerCase();
          if (s === 'auto') { ax.xlim = ax.ylim = ax.zlim = null; ax.axis = ax.axis.filter(x => x !== 'tight'); }
          else if (s === 'on') ax.axis = ax.axis.filter(x => x !== 'off');
          else if (s === 'ij') ax.ydir = 'reverse'; else if (s === 'xy') ax.ydir = 'normal';
          else if (s === 'normal') ax.axis = ax.axis.filter(x => x === 'off');
          else if (['equal', 'tight', 'square', 'off', 'image', 'vis3d', 'padded'].includes(s)) { ax.axis = ax.axis.filter(x => !(x === s || (s === 'equal' && x === 'square') || (s === 'square' && x === 'equal'))); ax.axis.push(s); if (s === 'image') ax.axis.push('equal', 'tight'); }
          else fail(`Unknown axis option '${s}'.`);
        } else { const l = vec(v); if (l.length < 4) fail('axis limits must be [xmin xmax ymin ymax].'); ax.xlim = [l[0], l[1]]; ax.ylim = [l[2], l[3]]; if (l.length >= 6) ax.zlim = [l[4], l[5]]; }
      }
      touch();
    };
    const limFn = key => (a, nout) => { const ax = gca(), tgt = key === 'ylim' && ax.yy && ax.yySide === 'right' ? ax.yy : ax; const k = key === 'ylim' && tgt === ax.yy ? 'ylim' : key; if (!a.length) return M.rowVec(tgt[k] || [0, 1]); if (isStr(a[0])) { if (/auto/i.test(Str(a[0]))) tgt[k] = null; } else { const l = vec(a[0]); if (l.length !== 2 || !(l[1] > l[0])) fail('Limits must be a 2-element vector of increasing numeric values.'); tgt[k] = l; } touch(); };
    L.xlim = limFn('xlim'); L.ylim = limFn('ylim'); L.zlim = limFn('zlim');
    L.caxis = (a) => { const ax = gca(); if (a.length && !isStr(a[0])) ax.clim = vec(a[0]); else ax.clim = null; touch(); };
    L.clim = L.caxis;
    L.view = (a, nout) => {
      const ax = gca();
      if (!a.length) return M.rowVec(ax.view || [0, 90]);
      if (a.length === 1) { const v = vec(a[0]); if (v.length === 1) ax.view = v[0] === 2 ? null : [-37.5, 30]; else ax.view = v[1] === 90 && v[0] === 0 ? null : [v[0], v[1]]; }
      else { const az = S(a[0]), el = S(a[1]); ax.view = (az === 0 && el === 90) ? null : [az, el]; }
      touch();
    };
    L.rotate3d = () => {};
    L.colorbar = a => { const ax = gca(); ax.colorbar = !(a.length && isStr(a[0]) && /off/i.test(Str(a[0]))); touch(); };
    L.colormap = (a, nout) => {
      const f = gcf();
      if (!a.length) return M.str(f.colormap);
      let v = a[a.length - 1];
      if (v.type === 'num' && v.cls !== 'char') { if (v.c !== 3) fail('Colormap must be an m-by-3 matrix.'); const rows = []; for (let i = 0; i < v.r; i++) rows.push([v.re[i], v.re[i + v.r], v.re[i + 2 * v.r]]); f.colormap = rows; }
      else { const s = Str(v).toLowerCase(); if (!COLORMAPS.includes(s)) fail(`Unknown colormap '${s}'. Try ${COLORMAPS.slice(0, 8).join(', ')}.`); f.colormap = s; }
      touch();
    };
    COLORMAPS.forEach(name => { if (!L[name]) L[name] = (a) => { const n = a.length ? S(a[0]) : 256; const rows = []; for (let i = 0; i < n; i++) rows.push(cmapColor(name, n === 1 ? 0 : i / (n - 1))); return M.fromRows(rows); }; });
    L.shading = a => { const ax = gca(); ax.shading = Str(a[0]).toLowerCase(); for (const s of ax.series) if (s.kind === 'surf') { if (ax.shading === 'interp') { s.faceColor = 'interp'; s.edgeColor = 'none'; } else if (ax.shading === 'flat') { s.faceColor = 'flat'; s.edgeColor = 'none'; } else { s.faceColor = 'flat'; s.edgeColor = [0, 0, 0]; } } touch(); };
    L.lighting = () => {}; L.camlight = () => {}; L.material = () => {}; L.light = () => {};
    L.set = a => {
      const ids = vec(a[0]);
      for (const id of ids) {
        let target = null, ax = null;
        for (const f of G.figs) { if (f.id === id) target = f; for (const x of f.axes) { if (x.id === id) target = ax = x; for (const s of x.series) if (s.h === id) target = s; } }
        if (!target) fail('Invalid or deleted object.');
        for (let k = 1; k + 1 < a.length; k += 2) {
          const prop = Str(a[k]).toLowerCase(), v = a[k + 1];
          if (ax) {
            if (prop === 'xscale' || prop === 'yscale') ax[prop] = Str(v).toLowerCase();
            else if (prop === 'xlim' || prop === 'ylim' || prop === 'zlim') ax[prop] = vec(v);
            else if (prop === 'xgrid' || prop === 'ygrid') ax.grid = Str(v) === 'on';
            else if (prop === 'ydir') ax.ydir = Str(v);
            else if (prop === 'clim') ax.clim = vec(v);
            else if (prop === 'title') ax.title = Str(v);
          } else if (target.kind) {
            const p = nvProps([a[k], v], 0);
            if (p.lw != null) target.lw = p.lw; if (p.color) { target.color = p.color; target.faceColor = target.faceColor && p.color; } if (p.style) target.style = p.style; if (p.marker) target.marker = p.marker; if (p.ms) target.ms = p.ms; if (p.label) target.label = p.label; if (p.mfc) target.mfc = p.mfc;
            if (prop === 'xdata') target.x = F64(vec(v)); if (prop === 'ydata') target.y = F64(vec(v)); if (prop === 'zdata') target.z = F64(vec(v));
            if (prop === 'facecolor') target.faceColor = colorOf(v); if (prop === 'edgecolor') target.edgeColor = colorOf(v); if (prop === 'facealpha') target.alpha = S(v);
          } else if (prop === 'name') target.name = Str(v);
        }
      }
      touch();
    };
    L.get = a => {
      const id = S(a[0]), prop = a.length > 1 ? Str(a[1]).toLowerCase() : '';
      for (const f of G.figs) for (const x of f.axes) { if (x.id === id) { if (prop === 'xlim') return M.rowVec(x.xlim || [0, 1]); if (prop === 'ylim') return M.rowVec(x.ylim || [0, 1]); if (prop === 'title') return M.str(x.title); } for (const s of x.series) if (s.h === id) { if (prop === 'xdata') return M.rowVec(Array.from(s.x || [])); if (prop === 'ydata') return M.rowVec(Array.from(s.y || [])); if (prop === 'color') return M.rowVec(s.color || [0, 0, 0]); if (prop === 'linewidth') return num(s.lw || 0.5); } }
      fail('get: unsupported object or property.');
    };
    L.ishandle = a => M.bool(G.figs.some(f => f.id === S(a[0]) || f.axes.some(x => x.id === S(a[0]) || x.series.some(s => s.h === S(a[0])))));
    L.isgraphics = L.ishandle;
    L.delete = ((orig) => (a, n, In2) => { if (!isStr(a[0])) { const ids = vec(a[0]); for (const f of G.figs) for (const x of f.axes) x.series = x.series.filter(s => !ids.includes(s.h)); touch(); return; } return orig(a, n, In2); })(L.delete);
    L.saveas = (a) => { const id = S(a[0]) || (G.cur && G.cur.id); const name = Str(a[1]); if (In.host && In.host.saveFigure) In.host.saveFigure(id >= 1e4 ? G.cur.id : id, name); else In.warn('saveas: figures can only be saved in the app.'); };
    L.exportgraphics = (a) => L.saveas([num(G.cur ? G.cur.id : 1), a[1]]);
    L.print = (a) => { const name = a.find(x => isStr(x) && !Str(x).startsWith('-')); L.saveas([num(G.cur ? G.cur.id : 1), name || M.str('figure.png')]); };

    G.snapshot = () => ({ figs: G.figs, cur: G.cur ? G.cur.id : null, version: G.version });
    return G;
  }

  // ---------- colormaps (shared with the renderer) ----------
  const CM = {
    parula: [[0.2422, 0.1504, 0.6603], [0.2810, 0.3228, 0.9579], [0.1786, 0.5289, 0.9682], [0.0689, 0.6948, 0.8394], [0.2161, 0.7843, 0.5923], [0.6720, 0.7793, 0.2227], [0.9970, 0.7659, 0.2199], [0.9769, 0.9839, 0.0805]],
    viridis: [[0.267, 0.005, 0.329], [0.283, 0.141, 0.458], [0.254, 0.265, 0.530], [0.207, 0.372, 0.553], [0.164, 0.471, 0.558], [0.128, 0.567, 0.551], [0.135, 0.659, 0.518], [0.267, 0.749, 0.441], [0.478, 0.821, 0.318], [0.741, 0.873, 0.150], [0.993, 0.906, 0.144]],
    turbo: [[0.190, 0.072, 0.232], [0.276, 0.384, 0.856], [0.165, 0.654, 0.966], [0.106, 0.879, 0.722], [0.442, 0.995, 0.374], [0.785, 0.938, 0.204], [0.996, 0.703, 0.192], [0.948, 0.375, 0.094], [0.729, 0.106, 0.017], [0.480, 0.016, 0.011]],
    hot: [[0.0416, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
    cool: [[0, 1, 1], [1, 0, 1]],
    gray: [[0, 0, 0], [1, 1, 1]],
    bone: [[0, 0, 0.0052], [0.3194, 0.3194, 0.4444], [0.6528, 0.7778, 0.7778], [1, 1, 1]],
    copper: [[0, 0, 0], [1, 0.7812, 0.4975]],
    pink: [[0.1178, 0, 0], [0.7, 0.53, 0.53], [0.9, 0.9, 0.7], [1, 1, 1]],
    spring: [[1, 0, 1], [1, 1, 0]], summer: [[0, 0.5, 0.4], [1, 1, 0.4]], autumn: [[1, 0, 0], [1, 1, 0]], winter: [[0, 0, 1], [0, 1, 0.5]],
    jet: [[0, 0, 0.5], [0, 0, 1], [0, 0.5, 1], [0, 1, 1], [0.5, 1, 0.5], [1, 1, 0], [1, 0.5, 0], [1, 0, 0], [0.5, 0, 0]],
  };
  function cmapColor(name, t) {
    if (Array.isArray(name)) { const k = Math.min(name.length - 1, Math.max(0, Math.round(t * (name.length - 1)))); return name[k]; }
    t = Math.min(1, Math.max(0, Number.isNaN(t) ? 0 : t));
    if (name === 'hsv') { const h = t * 6, i = Math.floor(h) % 6, f = h - Math.floor(h); return [[1, f, 0], [1 - f, 1, 0], [0, 1, f], [0, 1 - f, 1], [f, 0, 1], [1, 0, 1 - f]][i]; }
    if (name === 'lines') return ORDER[Math.min(ORDER.length - 1, Math.floor(t * ORDER.length))];
    if (name === 'hot') { return [Math.min(1, t * 8 / 3), Math.min(1, Math.max(0, t * 8 / 3 - 1)), Math.min(1, Math.max(0, t * 4 - 3))]; }
    const stops = CM[name] || CM.parula, x = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
    return [0, 1, 2].map(k => stops[i][k] + (stops[i + 1][k] - stops[i][k]) * f);
  }

  const api = { attach, cmapColor, ORDER, parseSpec, COLORMAPS };
  if (node) module.exports = api; else root.LabGraphics = api;
})(typeof self !== 'undefined' ? self : this);
