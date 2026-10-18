// Lumen Stats — procedures: turn a dataset + options into an output item {proc, title, sub, blocks:[table|chart|note]}.
// Tables: {t:'table', title, cols:[{h, f}], rows:[[cell]], foot:[...], span:k}. Cell = number|string|null|{v,f,b(bold)}.
// Formats f: 'n' integer, 'd1'..'d4' fixed, 'a' auto (3 dp unless integer), 'p' p-value, 'pct' percent, 's' text.
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const S = isNode ? require('./stats.js') : root.LStat;
  const Dt = isNode ? require('./data.js') : root.LData;
  const C = isNode ? require('./charts.js') : root.LCharts;
  const Dist = isNode ? require('./dist.js') : root.LDist;

  const vl = m => m.label ? `${m.label}` : m.name;              // display name of a variable
  const vlFull = m => m.label ? `${m.label} [${m.name}]` : m.name;
  const table = (title, cols, rows, extra = {}) => ({ t: 'table', title, cols: cols.map(c => typeof c === 'string' ? { h: c, f: 'a' } : c), rows, ...extra });
  const note = (text, kind = 'info') => ({ t: 'note', text, kind });
  const chart = (ch, title) => ({ t: 'chart', chart: ch, title });
  const pct = (a, b) => b ? 100 * a / b : null;
  const sig = p => p < 0.001 ? 'p < .001' : `p = ${p.toFixed(3).replace(/^0/, '')}`;
  const fmt3 = v => Number.isFinite(v) ? (Number.isInteger(v) ? String(v) : v.toFixed(3)) : '—';
  const confPct = c => `${Math.round(c * 1000) / 10}%`;

  class Ctx {
    constructor(doc) { this.doc = doc; this.mask = Dt.filterMask(doc); }
    meta(j) { return this.doc.vars[j]; }
    cases(js) { return Dt.validCases(this.doc, js, this.mask); }
    nSelected() { if (!this.mask) return this.doc.n; let c = 0; for (const m of this.mask) c += m; return c; }
    nums(j, cases) { const c = this.doc.cols[j]; return cases.map(i => +c[i]); }
    vals(j, cases) { const c = this.doc.cols[j]; return cases.map(i => c[i]); }
    // ordered levels of a grouping variable among the cases: [{v, label}]
    levels(j, cases) {
      const m = this.meta(j), col = this.doc.cols[j], seen = new Map();
      cases.forEach(i => { const v = col[i]; if (!seen.has(v)) seen.set(v, true); });
      const vs = [...seen.keys()];
      vs.sort((a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true }));
      return vs.map(v => ({ v, label: this.valueLabel(j, v) }));
    }
    valueLabel(j, v) { const m = this.meta(j), l = Dt.labelOf(v, m); return l != null ? l : Dt.fmtValue(v, m, false); }
    sub(extra) {
      const s = []; if (extra) s.push(extra);
      if (this.mask) s.push(`Filter: ${this.doc.filter.expr} (${this.nSelected()} of ${this.doc.n} cases)`);
      return s.join(' · ');
    }
  }
  const item = (proc, title, ctx, blocks, sub) => ({ id: 'o' + Math.random().toString(36).slice(2, 10), proc, title, sub: ctx.sub(sub), time: new Date().toISOString(), blocks });
  const need = (cond, msg) => { if (!cond) throw new Error(msg); };

  // ---------- Descriptives ----------
  const DESC_STATS = [['n', 'N', 'n'], ['missing', 'Missing', 'n'], ['mean', 'Mean', 'a'], ['se', 'SE mean', 'a'], ['sd', 'Std. deviation', 'a'], ['variance', 'Variance', 'a'],
    ['min', 'Minimum', 'a'], ['q1', 'Q1', 'a'], ['median', 'Median', 'a'], ['q3', 'Q3', 'a'], ['max', 'Maximum', 'a'], ['range', 'Range', 'a'], ['iqr', 'IQR', 'a'], ['sum', 'Sum', 'a'],
    ['skew', 'Skewness', 'a'], ['seSkew', 'SE skewness', 'a'], ['kurt', 'Kurtosis', 'a'], ['seKurt', 'SE kurtosis', 'a'], ['cv', 'CV %', 'd2']];
  const DESC_DEFAULT = ['n', 'missing', 'mean', 'sd', 'min', 'median', 'max'];
  function descriptives(doc, { vars, stats = DESC_DEFAULT, by = null, saveZ = false }) {
    const ctx = new Ctx(doc); need(vars && vars.length, 'Choose at least one variable.');
    const st = DESC_STATS.filter(s => stats.includes(s[0]));
    const cols = [{ h: '', f: 's' }, ...(by != null ? [{ h: vl(ctx.meta(by)), f: 's' }] : []), ...st.map(s => ({ h: s[1], f: s[2] }))];
    const rows = [], newCols = [];
    const base = by != null ? ctx.cases([by]) : ctx.cases([]);
    vars.forEach(j => {
      const groups = by != null ? ctx.levels(by, base).map(l => ({ label: l.label, cases: base.filter(i => doc.cols[by][i] === l.v) })) : [{ label: null, cases: base }];
      groups.forEach((g, gi) => {
        const valid = g.cases.filter(i => !Dt.isMissing(doc.cols[j][i], ctx.meta(j))), x = ctx.nums(j, valid), d = S.describe(x);
        d.missing = g.cases.length - valid.length; d.cv = d.mean ? 100 * d.sd / Math.abs(d.mean) : null;
        rows.push([gi === 0 ? vl(ctx.meta(j)) : '', ...(by != null ? [g.label] : []), ...st.map(s => d.n || s[0] === 'n' || s[0] === 'missing' ? d[s[0]] : null)]);
      });
      if (saveZ) {
        const valid = base.filter(i => !Dt.isMissing(doc.cols[j][i], ctx.meta(j))), x = ctx.nums(j, valid), d = S.describe(x);
        const z = new Array(doc.n).fill(null); valid.forEach((i, k) => z[i] = d.sd > 0 ? (x[k] - d.mean) / d.sd : null);
        newCols.push({ name: 'Z' + ctx.meta(j).name, label: `Zscore: ${vl(ctx.meta(j))}`, col: z, decimals: 3 });
      }
    });
    const listwise = ctx.cases(vars).length;
    const foot = by == null && vars.length > 1 ? [`Valid N (listwise) = ${listwise}`] : [];
    const blocks = [table('Descriptive statistics', cols, rows, { foot, span: 1 })];
    if (newCols.length) blocks.push(note(`Saved standardized values as ${newCols.map(c => c.name).join(', ')}.`));
    const it = item('descriptives', 'Descriptives', ctx, blocks); it.newCols = newCols; return it;
  }

  // ---------- Frequencies ----------
  function frequencies(doc, { vars, stats = true, chart: ch = 'bar', sortBy = 'value' }) {
    const ctx = new Ctx(doc); need(vars && vars.length, 'Choose at least one variable.');
    const blocks = [], all = ctx.cases([]);
    if (stats) {
      const numVars = vars.filter(j => ctx.meta(j).type !== 'string');
      if (numVars.length) {
        const rows = [['N valid'], ['N missing'], ['Mean'], ['Median'], ['Mode'], ['Std. deviation'], ['Minimum'], ['Maximum'], ['Percentile 25'], ['Percentile 50'], ['Percentile 75']];
        numVars.forEach(j => {
          const m = ctx.meta(j), valid = all.filter(i => !Dt.isMissing(doc.cols[j][i], m)), d = S.describe(ctx.nums(j, valid));
          const nominal = m.measure === 'nominal';
          [d.n, all.length - valid.length, nominal ? null : d.mean, nominal ? null : d.median, d.n ? (d.multiMode ? { v: d.mode, f: 'a', sup: 'a' } : d.mode) : null, nominal ? null : d.sd, d.min, d.max, nominal ? null : d.q1, nominal ? null : d.median, nominal ? null : d.q3].forEach((v, r) => rows[r].push(v));
        });
        const anyMulti = rows[4].some(c => c && c.sup);
        blocks.push(table('Statistics', [{ h: '', f: 's' }, ...numVars.map(j => ({ h: vl(ctx.meta(j)), f: 'a' }))], rows, { foot: anyMulti ? ['a. Multiple modes exist; the smallest is shown.'] : [] }));
      }
    }
    vars.forEach(j => {
      const m = ctx.meta(j), col = doc.cols[j], counts = new Map(); let miss = 0, sys = 0; const missCounts = new Map();
      all.forEach(i => { const v = col[i]; if (v == null || v === '') { sys++; return; } if (Dt.isMissing(v, m)) { missCounts.set(v, (missCounts.get(v) || 0) + 1); miss++; return; } counts.set(v, (counts.get(v) || 0) + 1); });
      const N = all.length, valid = N - miss - sys;
      let keys = [...counts.keys()];
      if (sortBy === 'count') keys.sort((a, b) => counts.get(b) - counts.get(a));
      else keys.sort((a, b) => typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true }));
      let cum = 0; const rows = [];
      keys.forEach((k, r) => { const c = counts.get(k); cum += c; rows.push([r === 0 ? 'Valid' : '', ctx.valueLabel(j, k), c, pct(c, N), pct(c, valid), pct(cum, valid)]); });
      rows.push(['', { v: 'Total', b: 1 }, { v: valid, f: 'n', b: 1 }, { v: pct(valid, N), f: 'pct', b: 1 }, { v: valid ? 100 : null, f: 'pct', b: 1 }, null]);
      if (miss + sys) {
        let first = true;
        [...missCounts.keys()].sort((a, b) => a - b).forEach(k => { rows.push([first ? 'Missing' : '', ctx.valueLabel(j, k), missCounts.get(k), pct(missCounts.get(k), N), null, null]); first = false; });
        if (sys) { rows.push([first ? 'Missing' : '', 'System missing', sys, pct(sys, N), null, null]); first = false; }
        rows.push(['', { v: 'Total', b: 1 }, { v: miss + sys, f: 'n', b: 1 }, { v: pct(miss + sys, N), f: 'pct', b: 1 }, null, null]);
      }
      rows.push([{ v: 'Total', b: 1 }, '', { v: N, f: 'n', b: 1 }, { v: N ? 100 : null, f: 'pct', b: 1 }, null, null]);
      const tooMany = keys.length > 60;
      blocks.push(table(vl(m), [{ h: '', f: 's' }, { h: '', f: 's' }, { h: 'Frequency', f: 'n' }, { h: 'Percent', f: 'pct' }, { h: 'Valid percent', f: 'pct' }, { h: 'Cumulative percent', f: 'pct' }], tooMany ? rows.slice(0, 60).concat([['', `… ${keys.length - 60} more values`, null, null, null, null]], rows.slice(keys.length)) : rows, { span: 1, cls: 'freq' }));
      if (ch === 'bar' && keys.length <= 40 && keys.length) blocks.push(chart(C.bar({ cats: keys.map(k => ctx.valueLabel(j, k)), series: [{ name: 'Count', values: keys.map(k => counts.get(k)) }], title: vl(m), yLabel: 'Frequency' })));
      if (ch === 'pct' && keys.length <= 40 && keys.length) blocks.push(chart(C.bar({ cats: keys.map(k => ctx.valueLabel(j, k)), series: [{ name: 'Percent', values: keys.map(k => pct(counts.get(k), valid)) }], title: vl(m), yLabel: 'Percent', percent: true })));
      if (ch === 'hist' && m.type !== 'string' && valid > 1) { const v = all.filter(i => !Dt.isMissing(col[i], m)); blocks.push(chart(C.histogram({ values: ctx.nums(j, v), title: vl(m), xLabel: vl(m) }))); }
    });
    return item('frequencies', 'Frequencies', ctx, blocks);
  }

  // ---------- Crosstabs ----------
  function crosstabs(doc, { row, col, cells = ['count'], chi = true, measures = true, chartOn = true }) {
    const ctx = new Ctx(doc); need(row != null && col != null, 'Choose a row and a column variable.'); need(row !== col, 'Row and column variables must differ.');
    const cases = ctx.cases([row, col]), rl = ctx.levels(row, cases), cl = ctx.levels(col, cases);
    need(cases.length, 'No cases have valid values for both variables.');
    need(rl.length <= 60 && cl.length <= 60, 'Too many categories (more than 60) for a crosstab — recode the variable first.');
    const ri = new Map(rl.map((l, i) => [l.v, i])), ci = new Map(cl.map((l, i) => [l.v, i]));
    const T = rl.map(() => cl.map(() => 0));
    cases.forEach(i => T[ri.get(doc.cols[row][i])][ci.get(doc.cols[col][i])]++);
    const N = cases.length, excluded = ctx.nSelected() - N;
    const blocks = [table('Case processing summary', [{ h: '', f: 's' }, { h: 'Valid N', f: 'n' }, { h: 'Valid %', f: 'pct' }, { h: 'Missing N', f: 'n' }, { h: 'Missing %', f: 'pct' }, { h: 'Total N', f: 'n' }],
      [[`${vl(ctx.meta(row))} × ${vl(ctx.meta(col))}`, N, pct(N, N + excluded), excluded, pct(excluded, N + excluded), N + excluded]])];
    const cs = rl.length > 1 && cl.length > 1 ? S.chiSquare(T, numScores(rl), numScores(cl)) : null;
    const rt = T.map(r => r.reduce((a, b) => a + b, 0)), ct = cl.map((_, j) => T.reduce((s, r) => s + r[j], 0));
    const CELL = { count: ['Count', 'n'], expected: ['Expected count', 'd1'], row: [`% within ${vl(ctx.meta(row))}`, 'pct'], col: [`% within ${vl(ctx.meta(col))}`, 'pct'], total: ['% of total', 'pct'], resid: ['Standardized residual', 'd2'], adjres: ['Adjusted residual', 'd2'] };
    const cellKinds = cells.filter(k => CELL[k] && (cs || !['expected', 'resid', 'adjres'].includes(k)));
    const rows = [];
    const cellVal = (k, i, j) => {
      if (k === 'count') return T[i][j]; if (k === 'expected') return cs.E[i][j]; if (k === 'row') return pct(T[i][j], rt[i]); if (k === 'col') return pct(T[i][j], ct[j]);
      if (k === 'total') return pct(T[i][j], N); if (k === 'resid') return cs.stdRes[i][j]; return cs.adjRes[i][j];
    };
    const margin = (k, i, j) => {  // i or j null = margin
      if (i == null && j == null) return k === 'count' ? N : k === 'expected' ? N : ['row', 'col', 'total'].includes(k) ? 100 : null;
      if (j == null) return k === 'count' || k === 'expected' ? rt[i] : k === 'row' ? 100 : k === 'col' ? pct(rt[i], N) : k === 'total' ? pct(rt[i], N) : null;
      return k === 'count' || k === 'expected' ? ct[j] : k === 'row' ? pct(ct[j], N) : k === 'col' ? 100 : k === 'total' ? pct(ct[j], N) : null;
    };
    const fcell = (k, v) => v == null ? null : { v, f: CELL[k][1] };
    rl.forEach((l, i) => cellKinds.forEach((k, kk) => rows.push([kk === 0 ? l.label : '', cellKinds.length > 1 ? CELL[k][0] : '', ...cl.map((_, j) => fcell(k, cellVal(k, i, j))), fcell(k, margin(k, i, null))])));
    cellKinds.forEach((k, kk) => rows.push([kk === 0 ? { v: 'Total', b: 1 } : '', cellKinds.length > 1 ? CELL[k][0] : '', ...cl.map((_, j) => fcell(k, margin(k, null, j))), fcell(k, margin(k, null, null))]));
    blocks.push(table(`${vl(ctx.meta(row))} × ${vl(ctx.meta(col))} crosstabulation`, [{ h: vl(ctx.meta(row)), f: 's' }, { h: '', f: 's' }, ...cl.map(l => ({ h: l.label, f: 'a' })), { h: 'Total', f: 'a' }], rows, { span: 1, colGroup: vl(ctx.meta(col)), cls: 'xtab' }));
    if (cs && chi) {
      const tr = [['Pearson chi-square', cs.X2, cs.df, cs.p, null, null]];
      if (cs.yates != null) tr.push(['Continuity correction (Yates)', cs.yates, 1, cs.pYates, null, null]);
      tr.push(['Likelihood ratio', cs.G2, cs.df, cs.pG2, null, null]);
      if (cs.fisher) tr.push(['Fisher’s exact test', null, null, null, cs.fisher.p, Math.min(cs.fisher.pLess, cs.fisher.pGreater)]);
      if (cs.LL != null) tr.push(['Linear-by-linear association', cs.LL, 1, cs.pLL, null, null]);
      tr.push(['N of valid cases', { v: N, f: 'n' }, null, null, null, null]);
      const foot = [`${cs.small} cells (${(100 * cs.small / cs.cells).toFixed(1)}%) have expected count less than 5. The minimum expected count is ${cs.minE.toFixed(2)}.`];
      blocks.push(table('Chi-square tests', [{ h: '', f: 's' }, { h: 'Value', f: 'd3' }, { h: 'df', f: 'n' }, { h: 'Asymptotic sig. (2-sided)', f: 'p' }, { h: 'Exact sig. (2-sided)', f: 'p' }, { h: 'Exact sig. (1-sided)', f: 'p' }], tr, { foot }));
      if (cs.small / cs.cells > 0.2) blocks.push(note('More than 20% of cells have expected counts below 5, so the chi-square approximation may be unreliable' + (cs.fisher ? ' — use Fisher’s exact test.' : '; consider merging categories.'), 'warn'));
    }
    if (cs && measures) {
      const mr = [['Phi', cs.phi, cs.p], ['Cramér’s V', cs.V, cs.p], ['Contingency coefficient', cs.CC, cs.p]];
      blocks.push(table('Symmetric measures', [{ h: 'Nominal by nominal', f: 's' }, { h: 'Value', f: 'd3' }, { h: 'Approx. sig.', f: 'p' }], mr, { foot: [`N of valid cases = ${N}`] }));
    }
    if (chartOn && cl.length <= 12 && rl.length <= 20) blocks.push(chart(C.bar({ cats: rl.map(l => l.label), series: cl.map((l, j) => ({ name: l.label, values: rl.map((_, i) => T[i][j]) })), title: `${vl(ctx.meta(row))} by ${vl(ctx.meta(col))}`, xLabel: vl(ctx.meta(row)), yLabel: 'Count' })));
    const it = item('crosstabs', 'Crosstabs', ctx, blocks); it.table = T; it.chi = cs; return it;
  }
  const numScores = lv => lv.every(l => typeof l.v === 'number') ? lv.map(l => l.v) : null;

  // ---------- t-tests ----------
  function tOne(doc, { vars, mu = 0, conf = 0.95 }) {
    const ctx = new Ctx(doc); need(vars && vars.length, 'Choose at least one test variable.');
    const res = vars.map(j => { const cs = ctx.cases([j]), x = ctx.nums(j, cs); need(x.length > 1, `${vl(ctx.meta(j))} needs at least 2 valid values.`); return { j, r: S.tOne(x, mu, conf) }; });
    const blocks = [
      table('One-sample statistics', [{ h: '', f: 's' }, { h: 'N', f: 'n' }, 'Mean', 'Std. deviation', 'Std. error mean'], res.map(({ j, r }) => [vl(ctx.meta(j)), r.n, r.mean, r.sd, r.se])),
      table(`One-sample test (test value = ${mu})`, [{ h: '', f: 's' }, { h: 't', f: 'd3' }, { h: 'df', f: 'a' }, { h: 'Sig. (2-tailed)', f: 'p' }, 'Mean difference', `${confPct(conf)} CI lower`, `${confPct(conf)} CI upper`, { h: 'Cohen’s d', f: 'd3' }],
        res.map(({ j, r }) => [vl(ctx.meta(j)), r.t, r.df, r.p, r.md, r.lo, r.hi, r.cohenD])),
    ];
    res.forEach(({ j, r }) => blocks.push(note(`${vl(ctx.meta(j))}: the mean (${fmt3(r.mean)}) ${r.p < 1 - conf ? 'differs significantly' : 'does not differ significantly'} from ${mu}, t(${r.df}) = ${r.t.toFixed(2)}, ${sig(r.p)}, d = ${r.cohenD.toFixed(2)}.`)));
    const it = item('ttest1', 'One-sample t-test', ctx, blocks); it.res = res.map(x => x.r); return it;
  }
  // groups by two values of a grouping variable, or by a cut point on a numeric grouping variable
  function twoGroups(ctx, j, group, g1, g2, cut) {
    const cs = ctx.cases([j, group]), col = ctx.doc.cols[group];
    let A, B, la, lb;
    if (cut != null && cut !== '') { A = cs.filter(i => col[i] >= cut); B = cs.filter(i => col[i] < cut); la = `≥ ${cut}`; lb = `< ${cut}`; }
    else {
      if (g1 == null || g2 == null) { const lv = ctx.levels(group, cs); need(lv.length === 2, `${vl(ctx.meta(group))} has ${lv.length} groups — choose which two to compare.`); g1 = lv[0].v; g2 = lv[1].v; }
      const eq = (v, g) => v === g || (typeof v === 'number' && +g === v) || String(v) === String(g);
      A = cs.filter(i => eq(col[i], g1)); B = cs.filter(i => eq(col[i], g2)); la = ctx.valueLabel(group, g1); lb = ctx.valueLabel(group, g2);
    }
    return { A, B, la, lb };
  }
  function tInd(doc, { vars, group, g1, g2, cut, conf = 0.95 }) {
    const ctx = new Ctx(doc); need(vars && vars.length, 'Choose at least one test variable.'); need(group != null, 'Choose a grouping variable.');
    const res = vars.map(j => { const { A, B, la, lb } = twoGroups(ctx, j, group, g1, g2, cut); need(A.length > 1 && B.length > 1, `Each group needs at least 2 valid values of ${vl(ctx.meta(j))}.`); return { j, la, lb, r: S.tInd(ctx.nums(j, A), ctx.nums(j, B), conf) }; });
    const gs = [], tt = [];
    res.forEach(({ j, la, lb, r }) => {
      gs.push([vl(ctx.meta(j)), la, r.a.n, r.a.mean, r.a.sd, r.a.se], ['', lb, r.b.n, r.b.mean, r.b.sd, r.b.se]);
      tt.push([vl(ctx.meta(j)), 'Equal variances assumed', r.levene.F, r.levene.p, r.pooled.t, r.pooled.df, r.pooled.p, r.md, r.pooled.se, r.pooled.lo, r.pooled.hi],
        ['', 'Equal variances not assumed', null, null, r.welch.t, r.welch.df, r.welch.p, r.md, r.welch.se, r.welch.lo, r.welch.hi]);
    });
    const blocks = [table('Group statistics', [{ h: '', f: 's' }, { h: vl(ctx.meta(group)), f: 's' }, { h: 'N', f: 'n' }, 'Mean', 'Std. deviation', 'Std. error mean'], gs, { span: 1 }),
      table('Independent samples test', [{ h: '', f: 's' }, { h: '', f: 's' }, { h: 'Levene’s F', f: 'd3' }, { h: 'Levene sig.', f: 'p' }, { h: 't', f: 'd3' }, { h: 'df', f: 'a' }, { h: 'Sig. (2-tailed)', f: 'p' }, 'Mean difference', 'Std. error difference', `${confPct(conf)} CI lower`, `${confPct(conf)} CI upper`], tt, { span: 1 }),
      table('Effect sizes', [{ h: '', f: 's' }, { h: 'Cohen’s d', f: 'd3' }, { h: 'Hedges’ g', f: 'd3' }, { h: 'Pooled SD', f: 'a' }], res.map(({ j, r }) => [vl(ctx.meta(j)), r.cohenD, r.hedgesG, r.sp]))];
    res.forEach(({ j, la, lb, r }) => {
      const useW = r.levene.p < 0.05, t = useW ? r.welch : r.pooled;
      blocks.push(note(`${vl(ctx.meta(j))}: ${la} (M = ${fmt3(r.a.mean)}, SD = ${fmt3(r.a.sd)}) vs ${lb} (M = ${fmt3(r.b.mean)}, SD = ${fmt3(r.b.sd)}); t(${t.df.toFixed(Number.isInteger(t.df) ? 0 : 2)}) = ${t.t.toFixed(2)}, ${sig(t.p)}, d = ${r.cohenD.toFixed(2)}${useW ? ' — Levene’s test is significant, so the Welch row (equal variances not assumed) is reported' : ''}.`));
    });
    if (res.length === 1) { const { j, la, lb } = res[0]; const { A, B } = twoGroups(ctx, j, group, g1, g2, cut); blocks.push(chart(C.boxplot({ groups: [{ name: la, values: ctx.nums(j, A) }, { name: lb, values: ctx.nums(j, B) }], title: `${vl(ctx.meta(j))} by ${vl(ctx.meta(group))}`, yLabel: vl(ctx.meta(j)), xLabel: vl(ctx.meta(group)) }))); }
    const it = item('ttest2', 'Independent-samples t-test', ctx, blocks); it.res = res.map(x => x.r); return it;
  }
  function tPaired(doc, { pairs, conf = 0.95 }) {
    const ctx = new Ctx(doc); need(pairs && pairs.length, 'Choose at least one pair of variables.');
    const res = pairs.map(([a, b]) => { const cs = ctx.cases([a, b]); need(cs.length > 1, 'Each pair needs at least 2 cases with both values.'); return { a, b, r: S.tPaired(ctx.nums(a, cs), ctx.nums(b, cs), conf) }; });
    const nm = ({ a, b }) => `${vl(ctx.meta(a))} – ${vl(ctx.meta(b))}`;
    const blocks = [
      table('Paired samples statistics', [{ h: '', f: 's' }, { h: '', f: 's' }, 'Mean', { h: 'N', f: 'n' }, 'Std. deviation', 'Std. error mean'], res.flatMap((x, k) => [[`Pair ${k + 1}`, vl(ctx.meta(x.a)), x.r.a.mean, x.r.n, x.r.a.sd, x.r.a.se], ['', vl(ctx.meta(x.b)), x.r.b.mean, x.r.n, x.r.b.sd, x.r.b.se]]), { span: 1 }),
      table('Paired samples correlations', [{ h: '', f: 's' }, { h: '', f: 's' }, { h: 'N', f: 'n' }, { h: 'Correlation', f: 'd3' }, { h: 'Sig.', f: 'p' }], res.map((x, k) => [`Pair ${k + 1}`, nm(x), x.r.n, x.r.r, x.r.pr])),
      table('Paired samples test', [{ h: '', f: 's' }, { h: '', f: 's' }, 'Mean', 'Std. deviation', 'Std. error mean', `${confPct(conf)} CI lower`, `${confPct(conf)} CI upper`, { h: 't', f: 'd3' }, { h: 'df', f: 'n' }, { h: 'Sig. (2-tailed)', f: 'p' }, { h: 'Cohen’s d', f: 'd3' }],
        res.map((x, k) => [`Pair ${k + 1}`, nm(x), x.r.mean, x.r.sd, x.r.se, x.r.lo, x.r.hi, x.r.t, x.r.df, x.r.p, x.r.cohenD]))];
    res.forEach(x => blocks.push(note(`${nm(x)}: mean difference ${fmt3(x.r.mean)}, t(${x.r.df}) = ${x.r.t.toFixed(2)}, ${sig(x.r.p)}, d = ${x.r.cohenD.toFixed(2)}.`)));
    const it = item('ttestp', 'Paired-samples t-test', ctx, blocks); it.res = res.map(x => x.r); return it;
  }

  // ---------- One-way ANOVA ----------
  function groupsOf(ctx, j, factor) {
    const cs = ctx.cases([j, factor]), lv = ctx.levels(factor, cs), col = ctx.doc.cols[factor];
    const by = new Map(lv.map(l => [l.v, []])); cs.forEach(i => by.get(col[i]).push(+ctx.doc.cols[j][i]));
    return { lv, groups: lv.map(l => by.get(l.v)), n: cs.length };
  }
  function anova1(doc, { vars, factor, posthoc = ['tukey'], welch = true, desc = true, plot = true, conf = 0.95 }) {
    const ctx = new Ctx(doc); need(vars && vars.length, 'Choose at least one dependent variable.'); need(factor != null, 'Choose a factor.');
    const blocks = [], results = [];
    vars.forEach(j => {
      const { lv, groups } = groupsOf(ctx, j, factor);
      need(lv.length >= 2, `${vl(ctx.meta(factor))} needs at least two groups with data.`);
      need(lv.length <= 100, 'The factor has more than 100 levels.');
      const keep = groups.map((g, i) => ({ g, l: lv[i] })).filter(x => x.g.length > 0);
      need(keep.reduce((s, x) => s + x.g.length, 0) > keep.length, 'Not enough cases for ANOVA (need more cases than groups).');
      const a = S.anova1(keep.map(x => x.g), conf); results.push(a);
      const name = vl(ctx.meta(j));
      if (desc) {
        const N = a.stats.reduce((s, x) => s + x.n, 0), all = S.describe(keep.flatMap(x => x.g)), tc = Dist.qt(1 - (1 - conf) / 2, N - 1);
        blocks.push(table(`Descriptives — ${name}`, [{ h: vl(ctx.meta(factor)), f: 's' }, { h: 'N', f: 'n' }, 'Mean', 'Std. deviation', 'Std. error', `${confPct(conf)} CI lower`, `${confPct(conf)} CI upper`, 'Minimum', 'Maximum'],
          [...a.stats.map((s, i) => [keep[i].l.label, s.n, s.mean, s.sd, s.se, s.lo, s.hi, s.min, s.max]), [{ v: 'Total', b: 1 }, all.n, all.mean, all.sd, all.se, all.mean - tc * all.se, all.mean + tc * all.se, all.min, all.max]]));
      }
      if (a.levene) blocks.push(table('Test of homogeneity of variances (Levene, mean-based)', [{ h: '', f: 's' }, { h: 'Levene statistic', f: 'd3' }, { h: 'df1', f: 'n' }, { h: 'df2', f: 'n' }, { h: 'Sig.', f: 'p' }], [[name, a.levene.F, a.levene.df1, a.levene.df2, a.levene.p]]));
      blocks.push(table(`ANOVA — ${name}`, [{ h: '', f: 's' }, { h: 'Sum of squares', f: 'd3' }, { h: 'df', f: 'n' }, { h: 'Mean square', f: 'd3' }, { h: 'F', f: 'd3' }, { h: 'Sig.', f: 'p' }, { h: 'η²', f: 'd3' }],
        [['Between groups', a.ssb, a.dfB, a.msb, a.F, a.p, a.eta2], ['Within groups', a.ssw, a.dfW, a.msw, null, null, null], [{ v: 'Total', b: 1 }, a.sst, a.dfB + a.dfW, null, null, null, null]], { foot: [`ω² = ${a.omega2.toFixed(3)}`] }));
      if (welch && a.welch) blocks.push(table('Robust test of equality of means', [{ h: '', f: 's' }, { h: 'Statistic', f: 'd3' }, { h: 'df1', f: 'n' }, { h: 'df2', f: 'd3' }, { h: 'Sig.', f: 'p' }], [['Welch', a.welch.F, a.welch.df1, a.welch.df2, a.welch.p]], { foot: ['Asymptotically F distributed.'] }));
      posthoc.forEach(m => {
        if (keep.length < 3) return;
        const ph = S.posthoc(a.stats, a.msw, a.dfW, m, conf);
        blocks.push(table(`Multiple comparisons — ${m === 'tukey' ? 'Tukey HSD' : 'Bonferroni'} (${name})`, [{ h: '(I) ' + vl(ctx.meta(factor)), f: 's' }, { h: '(J)', f: 's' }, 'Mean difference (I−J)', 'Std. error', { h: 'Sig.', f: 'p' }, `${confPct(conf)} CI lower`, `${confPct(conf)} CI upper`],
          ph.map(r => [keep[r.i].l.label, keep[r.j].l.label, r.p < 1 - conf ? { v: r.diff, f: 'a', sup: '*' } : r.diff, r.se, r.p, r.lo, r.hi]), { span: 1, foot: [`* The mean difference is significant at the ${(1 - conf).toFixed(2).replace(/^0/, '')} level.${m === 'tukey' && new Set(a.stats.map(s => s.n)).size > 1 ? ' Unequal group sizes: Tukey–Kramer.' : ''}`] }));
      });
      blocks.push(note(`${name} ${a.p < 1 - conf ? 'differs significantly' : 'does not differ significantly'} between ${vl(ctx.meta(factor))} groups, F(${a.dfB}, ${a.dfW}) = ${a.F.toFixed(2)}, ${sig(a.p)}, η² = ${a.eta2.toFixed(3)}.${a.levene && a.levene.p < 0.05 ? ' Variances are unequal (Levene ' + sig(a.levene.p) + ') — the Welch test is more trustworthy here.' : ''}`));
      if (plot) blocks.push(chart(C.bar({ cats: keep.map(x => x.l.label), series: [{ name: 'Mean', values: a.stats.map(s => s.mean), err: a.stats.map(s => [s.lo, s.hi]) }], title: `Mean ${name} by ${vl(ctx.meta(factor))} (${confPct(conf)} CI)`, xLabel: vl(ctx.meta(factor)), yLabel: `Mean ${name}` })));
    });
    const it = item('anova1', 'One-way ANOVA', ctx, blocks); it.res = results; return it;
  }

  // ---------- Univariate GLM (factorial ANOVA / ANCOVA) ----------
  function glm(doc, { dep, factors, covariates = [], posthoc = true, plot = true, desc = true, conf = 0.95 }) {
    const ctx = new Ctx(doc); need(dep != null, 'Choose a dependent variable.'); need(factors && factors.length, 'Choose at least one fixed factor.');
    need(factors.length <= 3, 'Up to three fixed factors are supported.');
    const cs = ctx.cases([dep, ...factors, ...covariates]);
    const fs = factors.map(f => { const lv = ctx.levels(f, cs), idx = new Map(lv.map((l, i) => [l.v, i])); return { j: f, name: ctx.meta(f).name, label: vl(ctx.meta(f)), levels: lv.map(l => l.label), codes: Int32Array.from(cs, i => idx.get(doc.cols[f][i])) }; });
    fs.forEach(f => need(f.levels.length >= 2, `${f.label} needs at least two levels with data.`));
    const y = ctx.nums(dep, cs);
    const r = S.glm(y, fs, covariates.map(c => ({ name: ctx.meta(c).name, x: ctx.nums(c, cs) })), conf);
    if (r.error) throw new Error(r.error);
    const name = vl(ctx.meta(dep)), blocks = [];
    blocks.push(table('Between-subjects factors', [{ h: '', f: 's' }, { h: 'Level', f: 's' }, { h: 'N', f: 'n' }], fs.flatMap(f => f.levels.map((l, k) => [k ? '' : f.label, l, f.codes.filter(c => c === k).length])), { span: 1 }));
    if (desc) {
      const cells = r.cellStats.slice().sort((a, b) => { for (let k = 0; k < a.key.length; k++) if (a.key[k] !== b.key[k]) return a.key[k] - b.key[k]; return 0; });
      blocks.push(table(`Descriptive statistics — ${name}`, [...fs.map(f => ({ h: f.label, f: 's' })), 'Mean', 'Std. deviation', { h: 'N', f: 'n' }], cells.map(c => [...c.key.map((k, i) => fs[i].levels[k]), c.mean, c.sd, c.n]), { span: fs.length - 1 }));
    }
    if (r.levene && Number.isFinite(r.levene.F)) blocks.push(table('Levene’s test of equality of error variances', [{ h: 'F', f: 'd3' }, { h: 'df1', f: 'n' }, { h: 'df2', f: 'n' }, { h: 'Sig.', f: 'p' }], [[r.levene.F, r.levene.df1, r.levene.df2, r.levene.p]], { foot: ['Tests that the error variance of the dependent variable is equal across groups (cells).'] }));
    const tr = r.rows.map(x => [x.name, x.ss, x.df, x.ms, x.F, x.p, x.pEta2]);
    tr.push(['Error', r.sse, r.dfE, r.mse, null, null, null], ['Total', r.ssTot, r.n, null, null, null, null], ['Corrected total', r.sst, r.n - 1, null, null, null, null]);
    blocks.push(table(`Tests of between-subjects effects — ${name}`, [{ h: 'Source', f: 's' }, { h: 'Type III sum of squares', f: 'd3' }, { h: 'df', f: 'n' }, { h: 'Mean square', f: 'd3' }, { h: 'F', f: 'd3' }, { h: 'Sig.', f: 'p' }, { h: 'Partial η²', f: 'd3' }], tr,
      { foot: [`R² = ${r.r2.toFixed(3)} (adjusted R² = ${r.adjR2.toFixed(3)})`] }));
    if (posthoc) fs.forEach(f => {
      if (f.levels.length < 3) return;
      const st = f.levels.map((_, k) => { const v = y.filter((_, i) => f.codes[i] === k); return { n: v.length, mean: S.mean(v) }; });
      const ph = S.posthoc(st, r.mse, r.dfE, 'tukey', conf);
      blocks.push(table(`Tukey HSD — ${f.label}`, [{ h: '(I) ' + f.label, f: 's' }, { h: '(J)', f: 's' }, 'Mean difference (I−J)', 'Std. error', { h: 'Sig.', f: 'p' }, `${confPct(conf)} CI lower`, `${confPct(conf)} CI upper`],
        ph.map(p => [f.levels[p.i], f.levels[p.j], p.p < 1 - conf ? { v: p.diff, f: 'a', sup: '*' } : p.diff, p.se, p.p, p.lo, p.hi]), { span: 1, foot: ['Based on observed means; the error term is the mean square (error) = ' + r.mse.toFixed(3) + '.'] }));
    });
    const eff = r.rows.filter(x => !x.corrected && x.name !== 'Intercept');
    blocks.push(note(eff.map(x => `${x.name}: F(${x.df}, ${r.dfE}) = ${x.F.toFixed(2)}, ${sig(x.p)}, partial η² = ${x.pEta2.toFixed(3)}`).join('; ') + '.'));
    if (plot && fs.length >= 2) {
      const A = fs[0], B = fs[1], series = B.levels.map((bl, kb) => ({ name: bl, values: A.levels.map((_, ka) => { const v = y.filter((_, i) => A.codes[i] === ka && B.codes[i] === kb); return v.length ? S.mean(v) : NaN; }) }));
      blocks.push(chart(C.lines({ cats: A.levels, series, title: `Estimated means of ${name}`, xLabel: A.label, yLabel: `Mean ${name}` })));
    } else if (plot) {
      const A = fs[0]; blocks.push(chart(C.lines({ cats: A.levels, series: [{ name: 'Mean', values: A.levels.map((_, k) => S.mean(y.filter((_, i) => A.codes[i] === k))) }], title: `Means of ${name}`, xLabel: A.label, yLabel: `Mean ${name}` })));
    }
    const it = item('glm', 'Univariate analysis of variance', ctx, blocks, `${name} by ${fs.map(f => f.label).join(', ')}${covariates.length ? ' with ' + covariates.map(c => ctx.meta(c).name).join(', ') : ''}`); it.res = r; return it;
  }

  // ---------- Correlation ----------
  function correlate(doc, { vars, method = 'pearson', listwise = false, matrixChart = true }) {
    const ctx = new Ctx(doc); need(vars && vars.length >= 2, 'Choose at least two variables.');
    const fn = method === 'spearman' ? S.spearman : method === 'kendall' ? S.kendall : S.pearson, key = method === 'kendall' ? 'tau' : 'r';
    const lw = listwise ? ctx.cases(vars) : null, R = vars.map(() => vars.map(() => null));
    const rows = [];
    vars.forEach((a, i) => {
      const rr = [], pp = [], nn = [];
      vars.forEach((b, k) => {
        const cs = lw || ctx.cases([a, b]);
        if (i === k) { rr.push(1); pp.push(null); nn.push(cs.length); R[i][k] = 1; return; }
        if (cs.length < 3) { rr.push(null); pp.push(null); nn.push(cs.length); return; }
        const o = fn(ctx.nums(a, cs), ctx.nums(b, cs)); R[i][k] = o[key];
        rr.push(o.p < 0.01 ? { v: o[key], f: 'd3', sup: '**' } : o.p < 0.05 ? { v: o[key], f: 'd3', sup: '*' } : { v: o[key], f: 'd3' }); pp.push(o.p); nn.push(o.n);
      });
      rows.push([vl(ctx.meta(a)), method === 'pearson' ? 'Pearson r' : method === 'spearman' ? 'Spearman ρ' : 'Kendall τ-b', ...rr], ['', 'Sig. (2-tailed)', ...pp.map(p => p == null ? null : { v: p, f: 'p' })], ['', 'N', ...nn.map(n => ({ v: n, f: 'n' }))]);
    });
    const blocks = [table(method === 'pearson' ? 'Correlations (Pearson)' : method === 'spearman' ? 'Correlations (Spearman’s rho)' : 'Correlations (Kendall’s tau-b)', [{ h: '', f: 's' }, { h: '', f: 's' }, ...vars.map(j => ({ h: vl(ctx.meta(j)), f: 'd3' }))], rows,
      { span: 1, foot: ['** Correlation is significant at the 0.01 level (2-tailed).', '* Correlation is significant at the 0.05 level (2-tailed).', listwise ? 'Listwise deletion of missing values.' : 'Pairwise deletion of missing values.'] })];
    if (vars.length === 2 && matrixChart) { const cs = ctx.cases(vars); blocks.push(chart(C.scatter({ x: ctx.nums(vars[0], cs), y: ctx.nums(vars[1], cs), fit: 'linear', title: `${vl(ctx.meta(vars[1]))} vs ${vl(ctx.meta(vars[0]))}`, xLabel: vl(ctx.meta(vars[0])), yLabel: vl(ctx.meta(vars[1])) }))); }
    const it = item('correlate', 'Bivariate correlations', ctx, blocks); it.R = R; return it;
  }

  // ---------- design matrix with dummy coding for categorical predictors ----------
  function design(ctx, preds, cases) {
    const X = [], names = [], codings = [];
    preds.forEach(j => {
      const m = ctx.meta(j);
      if (m.type === 'categorical' || m.type === 'string') {
        const lv = ctx.levels(j, cases); need(lv.length >= 2, `${vl(m)} has only one category among the cases used.`);
        need(lv.length <= 50, `${vl(m)} has too many categories to dummy-code.`);
        const col = ctx.doc.cols[j];
        lv.slice(1).forEach(l => { X.push(Float64Array.from(cases, i => col[i] === l.v ? 1 : 0)); names.push(`${m.name}(${l.label})`); });
        codings.push({ name: vl(m), levels: lv.map(l => l.label) });
      } else { X.push(Float64Array.from(cases, i => +ctx.doc.cols[j][i])); names.push(m.name); }
    });
    return { X, names, codings };
  }

  // ---------- Linear regression ----------
  function regress(doc, { dep, preds, conf = 0.95, plots = true, savePred = false, saveRes = false, collin = true }) {
    const ctx = new Ctx(doc); need(dep != null, 'Choose a dependent variable.'); need(preds && preds.length, 'Choose at least one independent variable.');
    need(!preds.includes(dep), 'The dependent variable cannot also be a predictor.');
    const cs = ctx.cases([dep, ...preds]), y = ctx.nums(dep, cs), { X, names, codings } = design(ctx, preds, cs);
    need(cs.length > X.length + 1, `Not enough cases (${cs.length}) for ${X.length} predictors.`);
    const r = S.linreg(y, X, names, conf); if (r.error) throw new Error(r.error);
    const name = vl(ctx.meta(dep)), blocks = [];
    if (codings.length) blocks.push(note('Categorical predictors are dummy-coded against their first category: ' + codings.map(c => `${c.name} (reference: ${c.levels[0]})`).join('; ') + '.'));
    blocks.push(table('Model summary', [{ h: 'R', f: 'd3' }, { h: 'R²', f: 'd3' }, { h: 'Adjusted R²', f: 'd3' }, 'Std. error of the estimate', { h: 'Durbin–Watson', f: 'd3' }, { h: 'N', f: 'n' }], [[r.r, r.r2, r.adj, r.see, r.dw, r.n]], { foot: [`Predictors: (Constant), ${names.join(', ')}. Dependent variable: ${name}.`] }));
    blocks.push(table('ANOVA', [{ h: '', f: 's' }, { h: 'Sum of squares', f: 'd3' }, { h: 'df', f: 'n' }, { h: 'Mean square', f: 'd3' }, { h: 'F', f: 'd3' }, { h: 'Sig.', f: 'p' }],
      [['Regression', r.ssr, r.dfR, r.msr, r.F, r.pF], ['Residual', r.sse, r.dfE, r.mse, null, null], [{ v: 'Total', b: 1 }, r.sst, r.n - 1, null, null, null]]));
    const cc = [{ h: '', f: 's' }, { h: 'B', f: 'a' }, { h: 'Std. error', f: 'a' }, { h: 'Beta', f: 'd3' }, { h: 't', f: 'd3' }, { h: 'Sig.', f: 'p' }, { h: `${confPct(conf)} CI lower`, f: 'a' }, { h: `${confPct(conf)} CI upper`, f: 'a' }];
    if (collin && X.length > 1) cc.push({ h: 'Tolerance', f: 'd3' }, { h: 'VIF', f: 'd3' });
    blocks.push(table('Coefficients', cc, r.coef.map(c => [c.name, c.b, c.se, c.beta, c.t, c.p, c.lo, c.hi, ...(collin && X.length > 1 ? [c.tol, c.vif] : [])]), { foot: [`Dependent variable: ${name}`] }));
    if (collin && r.coef.some(c => c.vif > 10)) blocks.push(note('Some VIF values exceed 10 — the predictors are strongly collinear, so individual coefficients are unstable.', 'warn'));
    const rs = (a, b) => [a, ...[Math.min(...b), Math.max(...b), S.mean(b), S.sd(b)], b.length];
    blocks.push(table('Residuals statistics', [{ h: '', f: 's' }, 'Minimum', 'Maximum', 'Mean', 'Std. deviation', { h: 'N', f: 'n' }], [rs('Predicted value', Array.from(r.fit)), rs('Residual', Array.from(r.res)), rs('Std. residual', Array.from(r.zres)), rs('Cook’s distance', Array.from(r.cook))]));
    const outl = Array.from(r.zres).map((z, k) => ({ z, k })).filter(o => Math.abs(o.z) >= 3);
    if (outl.length) blocks.push(table('Casewise diagnostics (|std. residual| ≥ 3)', [{ h: 'Case', f: 'n' }, { h: 'Std. residual', f: 'd3' }, { h: name, f: 'a' }, 'Predicted value', 'Residual'], outl.slice(0, 50).map(o => [cs[o.k] + 1, o.z, y[o.k], r.fit[o.k], r.res[o.k]])));
    const eq = `${name} = ${fmt3(r.coef[0].b)}${r.coef.slice(1).map(c => ` ${c.b < 0 ? '−' : '+'} ${fmt3(Math.abs(c.b))}·${c.name}`).join('')}`;
    blocks.push(note(`${eq}. The model explains ${(100 * r.r2).toFixed(1)}% of the variance, F(${r.dfR}, ${r.dfE}) = ${r.F.toFixed(2)}, ${sig(r.pF)}.`));
    if (plots) {
      blocks.push(chart(C.scatter({ x: Array.from(r.fit), y: Array.from(r.zres), hline: 0, title: 'Standardized residuals vs predicted values', xLabel: 'Predicted value', yLabel: 'Standardized residual' })));
      blocks.push(chart(C.qq({ values: Array.from(r.zres), title: 'Normal Q-Q plot of standardized residuals', yLabel: 'Standardized residual' })));
      if (X.length === 1 && !codings.length) blocks.push(chart(C.scatter({ x: Array.from(X[0]), y, fit: 'linear', title: `${name} vs ${vl(ctx.meta(preds[0]))}`, xLabel: vl(ctx.meta(preds[0])), yLabel: name })));
    }
    const newCols = [];
    const spread = arr => { const out = new Array(doc.n).fill(null); cs.forEach((i, k) => out[i] = arr[k]); return out; };
    if (savePred) newCols.push({ name: 'PRE_' + ctx.meta(dep).name, label: `Predicted value: ${name}`, col: spread(Array.from(r.fit)), decimals: 3 });
    if (saveRes) newCols.push({ name: 'RES_' + ctx.meta(dep).name, label: `Residual: ${name}`, col: spread(Array.from(r.res)), decimals: 3 }, { name: 'ZRE_' + ctx.meta(dep).name, label: `Standardized residual: ${name}`, col: spread(Array.from(r.zres)), decimals: 3 });
    if (newCols.length) blocks.push(note(`Saved ${newCols.map(c => c.name).join(', ')} as new variables.`));
    const it = item('regress', 'Linear regression', ctx, blocks, `${name} on ${names.join(', ')}`); it.res = r; it.newCols = newCols; return it;
  }

  // ---------- Binary logistic regression ----------
  function logistic(doc, { dep, preds, conf = 0.95, cutoff = 0.5, savePred = false }) {
    const ctx = new Ctx(doc); need(dep != null, 'Choose a dependent variable.'); need(preds && preds.length, 'Choose at least one covariate.');
    need(!preds.includes(dep), 'The dependent variable cannot also be a covariate.');
    const cs = ctx.cases([dep, ...preds]), lv = ctx.levels(dep, cs);
    need(lv.length === 2, `The dependent variable must have exactly two values among the cases used (it has ${lv.length}).`);
    const yc = doc.cols[dep], y = Float64Array.from(cs, i => yc[i] === lv[1].v ? 1 : 0);
    const { X, names, codings } = design(ctx, preds, cs);
    const r = S.logreg(y, X, names, conf); if (r.error) throw new Error(r.error);
    const name = vl(ctx.meta(dep)), blocks = [];
    blocks.push(table('Dependent variable encoding', [{ h: 'Original value', f: 's' }, { h: 'Internal value', f: 'n' }], [[lv[0].label, 0], [lv[1].label, 1]]));
    codings.forEach(c => blocks.push(table(`Categorical coding — ${c.name}`, [{ h: 'Category', f: 's' }, ...c.levels.slice(1).map((_, k) => ({ h: `(${k + 1})`, f: 'n' }))], c.levels.map((l, i) => [l, ...c.levels.slice(1).map((_, k) => i === k + 1 ? 1 : 0)]), { foot: [`Reference category: ${c.levels[0]}`] })));
    blocks.push(table('Omnibus test of model coefficients', [{ h: '', f: 's' }, { h: 'Chi-square', f: 'd3' }, { h: 'df', f: 'n' }, { h: 'Sig.', f: 'p' }], [['Model', r.chi, r.df, r.pChi]]));
    blocks.push(table('Model summary', [{ h: '−2 log likelihood', f: 'd3' }, { h: 'Cox & Snell R²', f: 'd3' }, { h: 'Nagelkerke R²', f: 'd3' }, { h: 'AIC', f: 'd3' }, { h: 'N', f: 'n' }], [[r.m2ll, r.cs, r.nag, r.aic, r.n]], { foot: [`Estimation terminated at iteration ${r.iterations}${r.converged ? ' because parameter estimates changed by less than .000001' : ''}.`] }));
    if (r.hl && r.hl.df > 0) blocks.push(table('Hosmer–Lemeshow test', [{ h: 'Chi-square', f: 'd3' }, { h: 'df', f: 'n' }, { h: 'Sig.', f: 'p' }], [[r.hl.chi, r.hl.df, r.hl.p]], { foot: ['A non-significant result means the model fits the data adequately.'] }));
    // classification at cutoff
    const cls = [[0, 0], [0, 0]]; for (let i = 0; i < r.n; i++) cls[y[i]][r.prob[i] >= cutoff ? 1 : 0]++;
    const c0 = cls[0][0] + cls[0][1], c1 = cls[1][0] + cls[1][1];
    blocks.push(table('Classification table', [{ h: 'Observed', f: 's' }, { h: `Predicted ${lv[0].label}`, f: 'n' }, { h: `Predicted ${lv[1].label}`, f: 'n' }, { h: 'Percentage correct', f: 'pct' }],
      [[lv[0].label, cls[0][0], cls[0][1], pct(cls[0][0], c0)], [lv[1].label, cls[1][0], cls[1][1], pct(cls[1][1], c1)], [{ v: 'Overall percentage', b: 1 }, null, null, pct(cls[0][0] + cls[1][1], r.n)]], { foot: [`The cut value is ${cutoff}.`] }));
    blocks.push(table('Variables in the equation', [{ h: '', f: 's' }, { h: 'B', f: 'd3' }, { h: 'S.E.', f: 'd3' }, { h: 'Wald', f: 'd3' }, { h: 'df', f: 'n' }, { h: 'Sig.', f: 'p' }, { h: 'Exp(B)', f: 'd3' }, { h: `${confPct(conf)} CI for Exp(B) lower`, f: 'd3' }, { h: 'upper', f: 'd3' }],
      r.coef.map(c => [c.name, c.b, c.se, c.wald, c.df, c.p, c.or, c.name === 'Constant' ? null : c.lo, c.name === 'Constant' ? null : c.hi])));
    if (r.warn) blocks.push(note(r.warn, 'warn'));
    blocks.push(note(`The model predicts ${name} = “${lv[1].label}”; χ²(${r.df}) = ${r.chi.toFixed(2)}, ${sig(r.pChi)}, Nagelkerke R² = ${r.nag.toFixed(3)}, ${pct(cls[0][0] + cls[1][1], r.n).toFixed(1)}% of cases classified correctly.`));
    const newCols = [];
    if (savePred) { const out = new Array(doc.n).fill(null); cs.forEach((i, k) => out[i] = r.prob[k]); newCols.push({ name: 'PRE_' + ctx.meta(dep).name, label: `Predicted probability of ${lv[1].label}`, col: out, decimals: 4 }); }
    const it = item('logistic', 'Binary logistic regression', ctx, blocks, `${name} on ${names.join(', ')}`); it.res = r; it.newCols = newCols; return it;
  }

  // ---------- Non-parametric tests ----------
  function mannWhitney(doc, { vars, group, g1, g2 }) {
    const ctx = new Ctx(doc); need(vars && vars.length, 'Choose at least one test variable.'); need(group != null, 'Choose a grouping variable.');
    const res = vars.map(j => { const { A, B, la, lb } = twoGroups(ctx, j, group, g1, g2); need(A.length && B.length, 'Both groups need data.'); return { j, la, lb, r: S.mannWhitney(ctx.nums(j, A), ctx.nums(j, B)) }; });
    const blocks = [table('Ranks', [{ h: '', f: 's' }, { h: vl(ctx.meta(group)), f: 's' }, { h: 'N', f: 'n' }, { h: 'Mean rank', f: 'd2' }, { h: 'Sum of ranks', f: 'd2' }], res.flatMap(({ j, la, lb, r }) => [[vl(ctx.meta(j)), la, r.n1, r.mr1, r.R1], ['', lb, r.n2, r.mr2, r.R2], ['', { v: 'Total', b: 1 }, r.n1 + r.n2, null, null]]), { span: 1 }),
      table('Test statistics (Mann–Whitney U)', [{ h: '', f: 's' }, { h: 'Mann–Whitney U', f: 'd3' }, { h: 'Wilcoxon W', f: 'd3' }, { h: 'Z', f: 'd3' }, { h: 'Asymp. sig. (2-tailed)', f: 'p' }, { h: 'Exact sig. (2-tailed)', f: 'p' }, { h: 'Effect size r', f: 'd3' }], res.map(({ j, r }) => [vl(ctx.meta(j)), r.U, r.W, r.z, r.p, r.pExact ?? null, r.r]),
        { foot: ['Asymptotic p uses the normal approximation with a correction for ties (no continuity correction). Exact p is the permutation distribution of the rank sum, ties included.'] })];
    res.forEach(({ j, la, lb, r }) => blocks.push(note(`${vl(ctx.meta(j))}: mean rank ${r.mr1.toFixed(2)} (${la}) vs ${r.mr2.toFixed(2)} (${lb}); U = ${fmt3(r.U)}, z = ${r.z.toFixed(2)}, ${sig(r.pExact ?? r.p)}.`)));
    const it = item('mannwhitney', 'Mann–Whitney U test', ctx, blocks); it.res = res.map(x => x.r); return it;
  }
  function wilcoxonTest(doc, { pairs }) {
    const ctx = new Ctx(doc); need(pairs && pairs.length, 'Choose at least one pair of variables.');
    const res = pairs.map(([a, b]) => { const cs = ctx.cases([a, b]); need(cs.length, 'No cases have both values.'); return { a, b, r: S.wilcoxon(ctx.nums(b, cs), ctx.nums(a, cs)) }; });
    const nm = ({ a, b }) => `${vl(ctx.meta(b))} – ${vl(ctx.meta(a))}`;
    const blocks = [table('Ranks', [{ h: '', f: 's' }, { h: '', f: 's' }, { h: 'N', f: 'n' }, { h: 'Mean rank', f: 'd2' }, { h: 'Sum of ranks', f: 'd2' }],
      res.flatMap(x => [[nm(x), 'Negative ranks', x.r.nneg, x.r.mrNeg, x.r.Tneg], ['', 'Positive ranks', x.r.npos, x.r.mrPos, x.r.Tpos], ['', 'Ties', x.r.zeros, null, null], ['', { v: 'Total', b: 1 }, x.r.n + x.r.zeros, null, null]]), { span: 1 }),
    table('Test statistics (Wilcoxon signed-rank)', [{ h: '', f: 's' }, { h: 'Z', f: 'd3' }, { h: 'Asymp. sig. (2-tailed)', f: 'p' }, { h: 'Exact sig. (2-tailed)', f: 'p' }, { h: 'Effect size r', f: 'd3' }], res.map(x => [nm(x), x.r.z, x.r.p, x.r.pExact ?? null, x.r.r]),
      { foot: ['Z is based on the smaller rank sum. Zero differences are excluded; ties use average ranks.'] })];
    res.forEach(x => blocks.push(note(`${nm(x)}: ${x.r.npos} positive and ${x.r.nneg} negative differences, z = ${Number.isFinite(x.r.z) ? x.r.z.toFixed(2) : '—'}, ${sig(x.r.pExact ?? x.r.p)}.`)));
    const it = item('wilcoxon', 'Wilcoxon signed-rank test', ctx, blocks); it.res = res.map(x => x.r); return it;
  }
  function kruskal(doc, { vars, group }) {
    const ctx = new Ctx(doc); need(vars && vars.length, 'Choose at least one test variable.'); need(group != null, 'Choose a grouping variable.');
    const res = vars.map(j => { const { lv, groups } = groupsOf(ctx, j, group); need(lv.length >= 2, 'Need at least two groups.'); return { j, lv, r: S.kruskal(groups) }; });
    const blocks = [table('Ranks', [{ h: '', f: 's' }, { h: vl(ctx.meta(group)), f: 's' }, { h: 'N', f: 'n' }, { h: 'Mean rank', f: 'd2' }], res.flatMap(({ j, lv, r }) => [...lv.map((l, k) => [k ? '' : vl(ctx.meta(j)), l.label, r.n[k], r.meanRanks[k]]), ['', { v: 'Total', b: 1 }, r.N, null]]), { span: 1 }),
      table('Test statistics (Kruskal–Wallis H)', [{ h: '', f: 's' }, { h: 'Kruskal–Wallis H', f: 'd3' }, { h: 'df', f: 'n' }, { h: 'Asymp. sig.', f: 'p' }, { h: 'ε²', f: 'd3' }], res.map(({ j, r }) => [vl(ctx.meta(j)), r.H, r.df, r.p, r.epsilon2]), { foot: ['H is corrected for ties.'] })];
    res.forEach(({ j, r }) => blocks.push(note(`${vl(ctx.meta(j))}: H(${r.df}) = ${r.H.toFixed(2)}, ${sig(r.p)}.`)));
    const it = item('kruskal', 'Kruskal–Wallis test', ctx, blocks); it.res = res.map(x => x.r); return it;
  }

  // ---------- Normality ----------
  function normality(doc, { vars, by = null, tests = ['sw', 'ks', 'ad'], qq = true, hist = false }) {
    const ctx = new Ctx(doc); need(vars && vars.length, 'Choose at least one variable.');
    const rows = [], charts = [];
    vars.forEach(j => {
      const base = ctx.cases(by != null ? [j, by] : [j]);
      const groups = by != null ? ctx.levels(by, base).map(l => ({ label: l.label, cs: base.filter(i => doc.cols[by][i] === l.v) })) : [{ label: null, cs: base }];
      groups.forEach((g, gi) => {
        const x = ctx.nums(j, g.cs), sw = tests.includes('sw') ? S.shapiroWilk(x) : null, ks = tests.includes('ks') ? S.lilliefors(x) : null, ad = tests.includes('ad') ? S.andersonDarling(x) : null;
        const r = [gi ? '' : vl(ctx.meta(j)), ...(by != null ? [g.label] : []), x.length];
        if (sw) r.push(sw.error ? null : sw.W, sw.error ? null : sw.p);
        if (ks) r.push(ks.error ? null : ks.D, ks.error ? null : ks.p);
        if (ad) r.push(ad.error ? null : ad.A, ad.error ? null : ad.p);
        rows.push(r);
        const t = `${vl(ctx.meta(j))}${g.label != null ? ' — ' + g.label : ''}`;
        if (qq && x.length >= 3) charts.push(chart(C.qq({ values: x, title: `Normal Q-Q plot: ${t}`, yLabel: vl(ctx.meta(j)) })));
        if (hist && x.length >= 3) charts.push(chart(C.histogram({ values: x, title: t, xLabel: vl(ctx.meta(j)) })));
      });
    });
    const cols = [{ h: '', f: 's' }, ...(by != null ? [{ h: vl(ctx.meta(by)), f: 's' }] : []), { h: 'N', f: 'n' }];
    if (tests.includes('sw')) cols.push({ h: 'Shapiro–Wilk W', f: 'd3' }, { h: 'Sig.', f: 'p' });
    if (tests.includes('ks')) cols.push({ h: 'Kolmogorov–Smirnov D (Lilliefors)', f: 'd3' }, { h: 'Sig.', f: 'p' });
    if (tests.includes('ad')) cols.push({ h: 'Anderson–Darling A²', f: 'd3' }, { h: 'Sig.', f: 'p' });
    const blocks = [table('Tests of normality', cols, rows, { span: 1, foot: ['H₀: the data come from a normal distribution. Small p-values (< .05) indicate departure from normality.', 'Shapiro–Wilk: Royston (1995). Lilliefors: Dallal–Wilkinson approximation. Anderson–Darling: D’Agostino & Stephens (1986).'] }), ...charts];
    return item('normality', 'Tests of normality', ctx, blocks);
  }

  // ---------- Charts ----------
  function chartProc(doc, o) {
    const ctx = new Ctx(doc), kind = o.kind, blocks = [];
    const T = o.title || '';
    if (kind === 'histogram') {
      need(o.x != null, 'Choose a variable.');
      if (o.by != null) { const cs = ctx.cases([o.x, o.by]); ctx.levels(o.by, cs).forEach(l => { const g = cs.filter(i => doc.cols[o.by][i] === l.v); if (g.length > 1) blocks.push(chart(C.histogram({ values: ctx.nums(o.x, g), title: `${T || vl(ctx.meta(o.x))} — ${l.label}`, xLabel: vl(ctx.meta(o.x)), normal: o.normal !== false, bins: o.bins || undefined }))); }); }
      else { const cs = ctx.cases([o.x]); need(cs.length > 1, 'Need at least 2 values.'); blocks.push(chart(C.histogram({ values: ctx.nums(o.x, cs), title: T || vl(ctx.meta(o.x)), xLabel: vl(ctx.meta(o.x)), normal: o.normal !== false, bins: o.bins || undefined }))); }
    } else if (kind === 'box') {
      need(o.vars && o.vars.length, 'Choose at least one variable.');
      if (o.by != null) {
        o.vars.forEach(j => { const cs = ctx.cases([j, o.by]); const groups = ctx.levels(o.by, cs).map(l => ({ name: l.label, values: ctx.nums(j, cs.filter(i => doc.cols[o.by][i] === l.v)) })); blocks.push(chart(C.boxplot({ groups, title: T || `${vl(ctx.meta(j))} by ${vl(ctx.meta(o.by))}`, yLabel: vl(ctx.meta(j)), xLabel: vl(ctx.meta(o.by)) }))); });
      } else { const groups = o.vars.map(j => ({ name: vl(ctx.meta(j)), values: ctx.nums(j, ctx.cases([j])) })); groups.colorBy = false; blocks.push(chart(C.boxplot({ groups, title: T || 'Box plot' }))); }
      blocks.push(note('Box: Q1–Q3 with the median line; + marks the mean; whiskers reach the furthest values within 1.5 × IQR; ○ outliers beyond 1.5 × IQR, * extremes beyond 3 × IQR.'));
    } else if (kind === 'scatter') {
      need(o.x != null && o.y != null, 'Choose X and Y variables.');
      const cs = ctx.cases([o.x, o.y, ...(o.by != null ? [o.by] : [])]); need(cs.length > 1, 'Need at least 2 cases with both values.');
      let groups = null, names = null;
      if (o.by != null) { const lv = ctx.levels(o.by, cs); need(lv.length <= 8, 'Color-by supports up to 8 groups (recode to fewer).'); const m = new Map(lv.map((l, i) => [l.v, i])); groups = cs.map(i => m.get(doc.cols[o.by][i])); names = lv.map(l => l.label); }
      const lab = o.labelBy != null ? cs.map(i => Dt.fmtValue(doc.cols[o.labelBy][i], ctx.meta(o.labelBy), true)) : null;
      blocks.push(chart(C.scatter({ x: ctx.nums(o.x, cs), y: ctx.nums(o.y, cs), groups, groupNames: names, fit: o.fit ? (groups && o.fitGroups ? 'group' : 'linear') : null, title: T || `${vl(ctx.meta(o.y))} vs ${vl(ctx.meta(o.x))}`, xLabel: vl(ctx.meta(o.x)), yLabel: vl(ctx.meta(o.y)), pointLabels: lab })));
    } else if (kind === 'bar') {
      need(o.cat != null, 'Choose a category variable.');
      const js = [o.cat, ...(o.cluster != null ? [o.cluster] : []), ...(o.stat === 'mean' ? [o.y] : [])];
      need(o.stat !== 'mean' || o.y != null, 'Choose the variable to average.');
      const cs = ctx.cases(js), lv = ctx.levels(o.cat, cs), cl = o.cluster != null ? ctx.levels(o.cluster, cs) : [{ v: Symbol('all'), label: o.stat === 'mean' ? 'Mean' : 'Count' }];
      need(lv.length <= 60, 'Too many categories for a bar chart.');
      const series = cl.map(c => {
        const values = [], err = [];
        lv.forEach(l => {
          const g = cs.filter(i => doc.cols[o.cat][i] === l.v && (o.cluster == null || doc.cols[o.cluster][i] === c.v));
          if (o.stat === 'mean') { const x = ctx.nums(o.y, g), d = S.describe(x); values.push(d.n ? d.mean : null); const tc = d.n > 1 ? Dist.qt(0.975, d.n - 1) : NaN; err.push(o.err && d.n > 1 ? [d.mean - tc * d.se, d.mean + tc * d.se] : null); }
          else if (o.stat === 'pct') values.push(pct(g.length, cs.length)); else values.push(g.length);
        });
        return { name: c.label, values, err: o.stat === 'mean' && o.err ? err : null };
      });
      const yl = o.stat === 'mean' ? `Mean ${vl(ctx.meta(o.y))}` : o.stat === 'pct' ? 'Percent' : 'Count';
      blocks.push(chart(C.bar({ cats: lv.map(l => l.label), series, title: T || `${yl} by ${vl(ctx.meta(o.cat))}`, xLabel: vl(ctx.meta(o.cat)), yLabel: yl, percent: o.stat === 'pct' })));
      if (o.stat === 'mean' && o.err) blocks.push(note('Error bars: 95% confidence interval of the mean.'));
    } else if (kind === 'qq') {
      need(o.x != null, 'Choose a variable.'); const cs = ctx.cases([o.x]); need(cs.length > 2, 'Need at least 3 values.');
      blocks.push(chart(C.qq({ values: ctx.nums(o.x, cs), title: T || `Normal Q-Q plot of ${vl(ctx.meta(o.x))}`, yLabel: vl(ctx.meta(o.x)) })));
    } else if (kind === 'line') {
      need(o.x != null && o.y != null, 'Choose X (categories) and Y.');
      const cs = ctx.cases([o.x, o.y]), lv = ctx.levels(o.x, cs);
      blocks.push(chart(C.lines({ cats: lv.map(l => l.label), series: [{ name: 'Mean', values: lv.map(l => S.mean(ctx.nums(o.y, cs.filter(i => doc.cols[o.x][i] === l.v)))) }], title: T || `Mean ${vl(ctx.meta(o.y))} by ${vl(ctx.meta(o.x))}`, xLabel: vl(ctx.meta(o.x)), yLabel: `Mean ${vl(ctx.meta(o.y))}` })));
    } else throw new Error('Unknown chart type');
    return item('chart', o.kindName || 'Chart', ctx, blocks);
  }

  // ---------- Control charts ----------
  function control(doc, { type = 'imr', x, size = 5, subgroup = null, n = null }) {
    const ctx = new Ctx(doc); need(x != null, 'Choose the measurement variable.');
    const blocks = [], name = vl(ctx.meta(x));
    const fail = (flags) => flags.map((f, i) => f.length ? i : -1).filter(i => i >= 0);
    const failTable = (rows) => rows.length ? table('Tests for special causes', [{ h: 'Chart', f: 's' }, { h: 'Test', f: 's' }, { h: 'Points', f: 's' }], rows, { foot: ['Test 1: one point more than 3σ from the center line. Test 2: nine points in a row on the same side of the center line.'] }) : note('No points fail the tests for special causes (1 point beyond 3σ; 9 points in a row on one side).');
    const describeFails = (chartName, flags, label) => { const rows = []; [1, 2].forEach(t => { const pts = flags.map((f, i) => f.includes(t) ? label(i) : null).filter(v => v != null); if (pts.length) rows.push([chartName, t === 1 ? '1 point > 3σ from center' : '9 points same side', pts.slice(0, 40).join(', ') + (pts.length > 40 ? ' …' : '')]); }); return rows; };
    if (type === 'imr') {
      const cs = ctx.cases([x]); need(cs.length >= 3, 'Need at least 3 observations.');
      const v = ctx.nums(x, cs), r = S.chartIMR(v);
      blocks.push(chart(C.control({ title: `I-MR chart of ${name}`, panels: [{ name: 'Individual value', values: v, center: r.I.center, centerName: 'X̄', ucl: r.I.ucl, lcl: r.I.lcl, flags: r.I.flags }, { name: 'Moving range', values: r.MR.values, center: r.MR.center, centerName: 'MR̄', ucl: r.MR.ucl, lcl: 0, flags: r.MR.flags }] })));
      blocks.push(table('Control limits', [{ h: 'Chart', f: 's' }, 'Center line', 'LCL', 'UCL', { h: 'σ (within)', f: 'a' }], [['Individuals', r.I.center, r.I.lcl, r.I.ucl, r.sigma], ['Moving range', r.MR.center, 0, r.MR.ucl, null]], { foot: ['σ(within) = MR̄ / d2, d2 = 1.128.'] }));
      blocks.push(failTable([...describeFails('Individuals', r.I.flags, i => i + 1), ...describeFails('Moving range', r.MR.flags, i => i + 1)]));
      const it = item('control', 'Control chart (I-MR)', ctx, blocks); it.res = r; return it;
    }
    if (type === 'xbarr') {
      const cs = ctx.cases(subgroup != null ? [x, subgroup] : [x]); const groups = [], keys = [];
      if (subgroup != null) { const m = new Map(); cs.forEach(i => { const k = doc.cols[subgroup][i]; if (!m.has(k)) { m.set(k, []); keys.push(ctx.valueLabel(subgroup, k)); } m.get(k).push(+doc.cols[x][i]); }); groups.push(...m.values()); }
      else { need(size >= 2 && size <= 25, 'Subgroup size must be 2–25.'); for (let k = 0; k + size <= cs.length; k += size) { groups.push(cs.slice(k, k + size).map(i => +doc.cols[x][i])); keys.push(String(groups.length)); } }
      need(groups.length >= 2, 'Need at least 2 subgroups.');
      const r = S.chartXbarR(groups); if (r.error) throw new Error(r.error);
      blocks.push(chart(C.control({ title: `Xbar-R chart of ${name}`, xLabel: 'Subgroup', panels: [{ name: 'Sample mean', values: r.X.values, center: r.X.center, centerName: 'X̿', ucl: r.X.ucl, lcl: r.X.lcl, flags: r.X.flags }, { name: 'Sample range', values: r.R.values, center: r.R.center, centerName: 'R̄', ucl: r.R.ucl, lcl: r.R.lcl, flags: r.R.flags }] })));
      const eqn = new Set(r.ns).size === 1;
      blocks.push(table('Control limits', [{ h: 'Chart', f: 's' }, 'Center line', 'LCL', 'UCL', { h: 'σ (within)', f: 'a' }], [['Xbar', r.X.center, eqn ? r.X.lcl[0] : null, eqn ? r.X.ucl[0] : null, r.sigma], ['R', r.R.center, eqn ? r.R.lcl[0] : null, eqn ? r.R.ucl[0] : null, null]],
        { foot: [eqn ? `Subgroup size n = ${r.ns[0]} (A2 = ${(3 / (S.CC.d2[r.ns[0]] * Math.sqrt(r.ns[0]))).toFixed(3)}, D3 = ${Math.max(0, 1 - 3 * S.CC.d3[r.ns[0]] / S.CC.d2[r.ns[0]]).toFixed(3)}, D4 = ${(1 + 3 * S.CC.d3[r.ns[0]] / S.CC.d2[r.ns[0]]).toFixed(3)}).` : 'Unequal subgroup sizes: limits vary by subgroup.', 'σ(within) = mean of Rᵢ / d2(nᵢ).'] }));
      blocks.push(failTable([...describeFails('Xbar', r.X.flags, i => keys[i]), ...describeFails('R', r.R.flags, i => keys[i])]));
      const it = item('control', 'Control chart (Xbar-R)', ctx, blocks); it.res = r; return it;
    }
    if (type === 'p') {
      need(n != null, 'Choose the variable with sample sizes.');
      const cs = ctx.cases([x, n]), d = ctx.nums(x, cs), sz = ctx.nums(n, cs); need(sz.every(v => v > 0) && d.every((v, i) => v >= 0 && v <= sz[i]), 'Defectives must be between 0 and the sample size.');
      const r = S.chartP(d, sz);
      blocks.push(chart(C.control({ title: `P chart of ${name}`, xLabel: 'Sample', panels: [{ name: 'Proportion', values: r.P.values, center: r.P.center, centerName: 'P̄', ucl: r.P.ucl, lcl: r.P.lcl, flags: r.P.flags }] })));
      blocks.push(failTable(describeFails('P', r.P.flags, i => i + 1)));
      const it = item('control', 'Control chart (P)', ctx, blocks); it.res = r; return it;
    }
    throw new Error('Unknown control chart');
  }

  const api = { Ctx, descriptives, DESC_STATS, DESC_DEFAULT, frequencies, crosstabs, tOne, tInd, tPaired, anova1, glm, correlate, regress, logistic, mannWhitney, wilcoxon: wilcoxonTest, kruskal, normality, chartProc, control, vl, vlFull };
  if (isNode) module.exports = api; else root.LAnalyses = api;
})(typeof self !== 'undefined' ? self : this);
