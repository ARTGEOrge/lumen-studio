// node lab/tests/toolbox.test.js — hand-checked answers for the toolbox functions (statistics, signal
// processing, optimization, stiff ODEs, file handles, yyaxis).
const E = require('../js/engine.js');
const M = require('../js/mat.js');
const assert = require('assert');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
function lab(src, files) {
  let out = ''; const In = E.create({ out: s => { out += s; } });
  if (files) for (const k in files) In.files.set(k, files[k]);
  In.run(src);
  const v = name => { const x = In.getVar(name); if (x === undefined) throw new Error('no variable ' + name); return js(x); };
  return { In, out: () => out, v };
}
function js(x) {
  if (x.type !== 'num') return x;
  if (x.cls === 'char') return M.charRows(x).join('\n');
  const val = k => x.im && x.im[k] !== 0 ? [x.re[k], x.im[k]] : x.re[k];
  if (x.n === 1) return val(0);
  if (x.r === 1 || x.c === 1) return Array.from({ length: x.n }, (_, k) => val(k));
  return M.toRows(x);
}
const near = (a, b, tol = 1e-9, path = '') => {
  if (Array.isArray(b)) { assert.ok(Array.isArray(a), `${path}: expected array, got ${JSON.stringify(a)}`); assert.strictEqual(a.length, b.length, `${path}: length ${a.length} ≠ ${b.length}`); b.forEach((x, i) => near(a[i], x, tol, `${path}[${i}]`)); return; }
  if (Number.isNaN(b)) return assert.ok(Number.isNaN(a), `${path}: expected NaN, got ${a}`);
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${path}: ${a} ≠ ${b}`);
};

t('prctile, quantile, iqr (MATLAB interpolation rule)', () => {
  const { v } = lab('x = [1 2 3 4]; a = prctile(x, 50); b = prctile(x, [25 0 100]); c = quantile(x, 0.75); d = iqr(x); m = prctile([1 2; 3 4; 5 6], 50);');
  near(v('a'), 2.5); near(v('b'), [1.5, 1, 4]); near(v('c'), 3.5); near(v('d'), 2); near(v('m'), [3, 4]);
});

t('zscore, normalize, rescale, skewness, kurtosis, mad, corr', () => {
  const { v } = lab("z = zscore([1 2 3]); r = normalize([2 4 6], 'range'); s = rescale([2 4 6], -1, 1); k0 = skewness([1 2 3]); k1 = skewness([1 2 10]); ku = kurtosis([1 2 3 4]); m1 = mad([1 2 3 4]); m2 = mad([1 2 3 4 100], 1); c = corr([1 2 3], [2 4 7]); [zz, mu, sg] = zscore([2 4 6]);");
  near(v('z'), [-1, 0, 1]); near(v('r'), [0, 0.5, 1]); near(v('s'), [-1, 0, 1]); near(v('k0'), 0);
  const d = [1, 2, 10].map(x => x - 13 / 3), m2 = d.reduce((s, x) => s + x * x, 0) / 3, m3 = d.reduce((s, x) => s + x ** 3, 0) / 3;
  near(v('k1'), m3 / m2 ** 1.5); near(v('ku'), 2.5625 / 1.5625); near(v('m1'), 1); near(v('m2'), 1);
  near(v('c'), 5 / Math.sqrt(2 * (38 / 3))); near(v('mu'), 4); near(v('sg'), 2);
});

t('moving-window statistics shrink at the ends', () => {
  const { v } = lab('a = movmean(1:5, 3); b = movsum(1:5, 3); c = movmax([1 3 2 5 4], 2); d = movmedian([1 9 2 8 3], 3); e = movmean([1 2 3 4 5], [1 0]); f = movmean((1:4)\', 3);');
  near(v('a'), [1.5, 2, 3, 4, 4.5]); near(v('b'), [3, 6, 9, 12, 9]); near(v('c'), [1, 3, 3, 5, 5]); near(v('d'), [5, 2, 8, 3, 5.5]);
  near(v('e'), [1, 1.5, 2.5, 3.5, 4.5]); near(v('f'), [1.5, 2, 3, 3.5]);
});

t('normal distribution: normpdf, normcdf, norminv', () => {
  const { v } = lab('a = normpdf(0); b = normcdf(1.96); c = norminv(0.975); d = normcdf(1, 1, 2); e = norminv([0.5 0.1]); f = normpdf(2, 1, 0.5);');
  near(v('a'), 1 / Math.sqrt(2 * Math.PI)); near(v('b'), 0.9750021048517795, 1e-12); near(v('c'), 1.959963984540054, 1e-10); near(v('d'), 0.5);
  near(v('e'), [0, -1.2815515655446004], 1e-10); near(v('f'), Math.exp(-2) / (0.5 * Math.sqrt(2 * Math.PI)));
});

t("'omitnan' flags and nan* helpers", () => {
  const { v } = lab("x = [1 NaN 3]; a = sum(x, 'omitnan'); b = mean(x, 'omitnan'); c = nanmax(x); d = median([NaN 1 2 3], 'omitnan'); e = mean([1 NaN; 3 5], 'omitnan'); f = mean(x); g = nansum(x); h = std([2 NaN 4], 'omitnan');");
  near(v('a'), 4); near(v('b'), 2); near(v('c'), 3); near(v('d'), 2); near(v('e'), [2, 5]); near(v('f'), NaN); near(v('g'), 4); near(v('h'), Math.SQRT2);
});

t('butter: low, high, band-pass and band-stop designs', () => {
  const { v } = lab("[b, a] = butter(2, 0.5); [bh, ah] = butter(2, 0.5, 'high'); [b1, a1] = butter(1, 0.5); [bp, ap] = butter(2, [0.2 0.6], 'bandpass'); [bs, as] = butter(2, [0.2 0.6], 'stop');");
  near(v('b'), [0.2928932188134524, 0.5857864376269049, 0.2928932188134524], 1e-12); near(v('a'), [1, 0, 0.1715728752538099], 1e-12);
  near(v('bh'), [0.2928932188134524, -0.5857864376269049, 0.2928932188134524], 1e-12); near(v('ah'), [1, 0, 0.1715728752538099], 1e-12);
  near(v('b1'), [0.5, 0.5]); near(v('a1'), [1, 0]);
  // band filters: response from the coefficients at DC, Nyquist and the (warped) centre frequency
  const H = (b, a, w) => { const ev = c => c.reduce((s, x, k) => [s[0] + x * Math.cos(-w * k), s[1] + x * Math.sin(-w * k)], [0, 0]); const p = ev(b), q = ev(a); return Math.hypot(...p) / Math.hypot(...q); };
  const wc = 2 * Math.atan(Math.sqrt(Math.tan(0.1 * Math.PI) * Math.tan(0.3 * Math.PI)));
  near(H(v('bp'), v('ap'), 0), 0, 1e-12); near(H(v('bp'), v('ap'), Math.PI), 0, 1e-12); near(H(v('bp'), v('ap'), wc), 1, 1e-9);
  near(H(v('bs'), v('as'), 0), 1, 1e-9); near(H(v('bs'), v('as'), Math.PI), 1, 1e-9); near(H(v('bs'), v('as'), wc), 0, 1e-9);
  near(H(v('bp'), v('ap'), 0.2 * Math.PI), Math.SQRT1_2, 1e-9); // −3 dB at the band edges
});

t('filtfilt: zero phase, no start-up transient', () => {
  const { v } = lab('[b, a] = butter(2, 0.2); c = filtfilt(b, a, 5 * ones(1, 40)); n = 0:199; x = sin(2*pi*0.02*n); [b4, a4] = butter(4, 0.2); y = filtfilt(b4, a4, x); err = max(abs(y(20:180) - x(20:180))); [~, ix] = max(x(1:80)); [~, iy] = max(y(1:80));');
  near(v('c'), new Array(40).fill(5), 1e-9); assert.ok(v('err') < 1e-3, 'passband preserved: ' + v('err')); near(v('iy'), v('ix'));
});

t('freqz returns the frequency response', () => {
  const { v } = lab('[h, w] = freqz([1 1]/2, 1, 4); m = abs(h)\'; w = w\';');
  near(v('w'), [0, Math.PI / 4, Math.PI / 2, 3 * Math.PI / 4]); near(v('m'), [1, Math.cos(Math.PI / 8), Math.SQRT1_2, Math.cos(3 * Math.PI / 8)], 1e-12);
});

t('findpeaks: heights, locations, prominences, MinPeakHeight/Distance/Prominence', () => {
  const { v } = lab("y = [0 2 1 3 1 5 0]; [p, l, w, pr] = findpeaks(y); [p2, l2] = findpeaks(y, 'MinPeakHeight', 2.5); [~, l3] = findpeaks(y, 'MinPeakDistance', 3); [~, l4] = findpeaks(y, 'MinPeakProminence', 1.5); [p5, l5] = findpeaks([0 2 2 0]); [~, l6] = findpeaks(y, 10:10:70); [p7] = findpeaks(y, 'SortStr', 'descend', 'NPeaks', 2);");
  near(v('p'), [2, 3, 5]); near(v('l'), [2, 4, 6]); near(v('pr'), [1, 2, 5]); near(v('p2'), [3, 5]); near(v('l2'), [4, 6]);
  near(v('l3'), [2, 6]); near(v('l4'), [4, 6]); near(v('p5'), 2); near(v('l5'), 2); near(v('l6'), [20, 40, 60]); near(v('p7'), [5, 3]);
});

t('xcorr, windows, detrend, sinc, unwrap', () => {
  const { v } = lab("[r, lags] = xcorr([1 2 3]); c = xcorr([1 2 3], [0 1 0]); q = xcorr([1 2 3], 'normalized'); h = hann(5)'; m = hamming(3)'; d = detrend([1 3 3]); s = sinc([0 0.5]); u = unwrap([0 3 -3]);");
  near(v('r'), [3, 8, 14, 8, 3], 1e-12); near(v('lags'), [-2, -1, 0, 1, 2]); near(v('c'), [0, 1, 2, 3, 0], 1e-12); near(v('q')[2], 1, 1e-12);
  near(v('h'), [0, 0.5, 1, 0.5, 0], 1e-15); near(v('m'), [0.08, 1, 0.08], 1e-15); near(v('d'), [-1 / 3, 2 / 3, -1 / 3], 1e-12);
  near(v('s'), [1, 2 / Math.PI]); near(v('u'), [0, 3, 2 * Math.PI - 3]);
});

t('fsolve, lsqcurvefit, lsqnonlin, fminunc', () => {
  const { v } = lab('x = fsolve(@(x) [x(1)^2 + x(2)^2 - 4; x(1) - x(2)], [1; 1]); xd = 0:4; p = lsqcurvefit(@(p, x) p(1)*exp(p(2)*x), [1 0], xd, 2*exp(-0.5*xd)); q = lsqnonlin(@(p) [p(1) - 1; 10*(p(2) - p(1)^2)], [-1.2 1]); m = fminunc(@(x) (x(1) - 3)^2 + 2*(x(2) + 1)^2, [0 0]); [r, fv] = fminunc(@(x) (x - 2)^2 + 7, 0);');
  near(v('x'), [Math.SQRT2, Math.SQRT2], 1e-8); near(v('p'), [2, -0.5], 1e-6); near(v('q'), [1, 1], 1e-6); near(v('m'), [3, -1], 1e-5);
  near(v('r'), 2, 1e-5); near(v('fv'), 7, 1e-9);
});

t('ode23s / ode15s solve a stiff problem in few steps', () => {
  const { v } = lab('f = @(t, y) -1000*(y - cos(t)); [t, y] = ode23s(f, [0 1], 0); a = y(end); n = numel(t); [t2, y2] = ode15s(f, [0 0.5 1], 0); b = y2\';');
  const exact = t => (1e6 * Math.cos(t) + 1e3 * Math.sin(t)) / (1e6 + 1) - 1e6 / (1e6 + 1) * Math.exp(-1000 * t);
  near(v('a'), exact(1), 1e-3); assert.ok(v('n') < 300, 'stiff solver took ' + v('n') + ' steps');
  near(v('b'), [0, exact(0.5), exact(1)], 1e-3);
});

t('file handles: fopen/fprintf/fclose write files, fgetl/fscanf read them', () => {
  const r = lab("fid = fopen('out.txt', 'w'); fprintf(fid, '%d,%d\\n', [1 2; 3 4]); fclose(fid); fid = fopen('out.txt'); l1 = fgetl(fid); l2 = fgetl(fid); e = fgetl(fid); done = feof(fid); fclose(fid); fid = fopen('out.txt', 'r'); v = fscanf(fid, '%f')'; fclose(fid); bad = fopen('missing.txt'); fid = fopen('out.txt', 'a'); fprintf(fid, 'end\\n'); fclose(fid);");
  assert.strictEqual(r.v('l1'), '1,3'); assert.strictEqual(r.v('l2'), '2,4'); near(r.v('e'), -1); near(r.v('done'), 1); near(r.v('v'), [1, 3, 2, 4]); near(r.v('bad'), -1);
  assert.strictEqual(r.In.files.get('out.txt'), '1,3\n2,4\nend\n');
});

t('yyaxis keeps two y axes with their own labels, limits and colors', () => {
  const { In } = lab("yyaxis left; plot(1:3, [1 2 3]); ylabel('Left'); yyaxis right; plot(1:3, [10 20 30]); ylabel('Right'); ylim([0 40]); yyaxis right; plot(1:3, [30 20 10]);");
  const ax = In.gfx.figs[0].axes[0];
  assert.strictEqual(ax.ylabel, 'Left'); assert.strictEqual(ax.yy.ylabel, 'Right'); assert.deepStrictEqual(ax.yy.ylim, [0, 40]);
  assert.deepStrictEqual(ax.series.map(s => s.yside), ['left', 'right'], 'replotting the right side replaces only its lines');
  assert.deepStrictEqual(ax.series[0].color, [0, 0.447, 0.741]); assert.deepStrictEqual(ax.series[1].color, [0.85, 0.325, 0.098]); near(Array.from(ax.series[1].y), [30, 20, 10]);
});

console.log(`\n${n} tests passed`);
