// node stats/tests/stats.test.js — procedures checked against published results for classic datasets.
// Reference values: R 4.x output as printed in its documentation/examples and standard textbooks (sleep, PlantGrowth,
// ToothGrowth, mtcars, Agresti 2007 party identification, Fisher's tea tasting), plus SciPy 1.18.1 (tests/stats-ref.json).
const S = require('../js/stats.js'), A = require('../js/analyses.js'), X = require('../js/samples.js'), assert = require('assert');
const ref = require('./stats-ref.json');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const near = (a, b, tol, what) => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${what}: got ${a}, expected ${b} (±${tol})`); };
const nearRel = (a, b, rel, what) => near(a, b, Math.abs(b) * rel + 1e-300, what);
const ix = (doc, name) => doc.vars.findIndex(v => v.name === name);

t('Student’s sleep data: paired t-test (R: t = −4.0621, df = 9, p = 0.002833, CI −2.4599 … −0.7001)', () => {
  const d = X.sleepDoc(), it = A.tPaired(d, { pairs: [[ix(d, 'drug1'), ix(d, 'drug2')]] }), r = it.res[0];
  near(r.t, -4.062128, 5e-6, 't'); assert.strictEqual(r.df, 9); near(r.p, 0.002832890, 5e-9, 'p');
  near(r.lo, -2.4598858, 5e-7, 'lo'); near(r.hi, -0.7001142, 5e-7, 'hi'); near(r.mean, -1.58, 1e-12, 'mean diff');
});
t('sleep data: Welch and Student two-sample t (R: Welch t = −1.8608, df = 17.776, p = 0.07939; pooled p = 0.07919)', () => {
  const { drug1, drug2 } = X.SLEEP, r = S.tInd(drug1, drug2);
  near(r.welch.t, -1.860813, 5e-6, 't'); near(r.welch.df, 17.77647, 5e-5, 'df'); near(r.welch.p, 0.07939414, 5e-8, 'p');
  near(r.welch.lo, -3.3654832, 5e-7, 'lo'); near(r.welch.hi, 0.2054832, 5e-7, 'hi');
  near(r.pooled.p, 0.07918671, 5e-8, 'pooled p'); assert.strictEqual(r.pooled.df, 18);
  const w = S.tInd(ref.ttest_ind_hp ? X.mtcars().hp.slice(0, 16) : [], X.mtcars().hp.slice(16)).welch;   // SciPy Welch on mtcars hp halves
  near(w.t, ref.ttest_ind_hp[0], 1e-9, 'scipy t'); near(w.p, ref.ttest_ind_hp[1], 1e-9, 'scipy p');
});
t('PlantGrowth one-way ANOVA (R: F(2,27) = 4.846, p = 0.01591; SS 3.76634 / 10.49209; Welch F = 5.181, df2 = 17.128, p = 0.01739)', () => {
  const d = X.plantDoc(), it = A.anova1(d, { vars: [ix(d, 'weight')], factor: ix(d, 'group') }), a = it.res[0];
  near(a.F, 4.846088, 5e-6, 'F'); near(a.p, 0.01590996, 5e-8, 'p'); near(a.ssb, 3.76634, 5e-6, 'SSB'); near(a.ssw, 10.49209, 5e-6, 'SSW');
  near(a.welch.F, 5.180972, 5e-6, 'Welch F'); near(a.welch.df2, 17.12842, 5e-5, 'Welch df'); near(a.welch.p, 0.01739282, 5e-8, 'Welch p');
  near(a.levene.F, ref.levene_plant[0], 1e-10, 'Levene F (SciPy)'); near(a.levene.p, ref.levene_plant[1], 1e-10, 'Levene p');
  assert(it.blocks.some(b => b.t === 'table' && /Tukey/.test(b.title)), 'Tukey table present');
});
t('PlantGrowth Tukey HSD (R TukeyHSD: p adj 0.3908711, 0.1979960, 0.0120064; CI half-width 0.6912161)', () => {
  const g = [X.PLANT.ctrl, X.PLANT.trt1, X.PLANT.trt2], a = S.anova1(g), ph = S.posthoc(a.stats, a.msw, a.dfW, 'tukey');
  near(ph[0].p, 0.3908711, 5e-7, 'ctrl-trt1'); near(ph[1].p, 0.1979960, 5e-7, 'ctrl-trt2'); near(ph[2].p, 0.0120064, 5e-7, 'trt1-trt2');
  near(ph[2].diff, -0.865, 1e-12, 'diff'); near(ph[2].hi - ph[2].diff, 0.6912161, 5e-7, 'half-width');
  const bf = S.posthoc(a.stats, a.msw, a.dfW, 'bonferroni');   // pairwise.t.test(p.adjust = "bonferroni"): 0.583, 0.263, 0.013
  near(bf[0].p, 0.583, 1e-3, 'bonf 1'); near(bf[1].p, 0.263, 1e-3, 'bonf 2'); near(bf[2].p, 0.013, 1e-3, 'bonf 3');
});
t('PlantGrowth Kruskal–Wallis (R: chi-squared = 7.9882, df = 2, p = 0.01842)', () => {
  const d = X.plantDoc(), r = A.kruskal(d, { vars: [ix(d, 'weight')], group: ix(d, 'group') }).res[0];
  near(r.H, 7.988229, 5e-6, 'H'); assert.strictEqual(r.df, 2); near(r.p, 0.01842376, 5e-8, 'p');
});
t('ToothGrowth two-way ANOVA, Type III (R aov: supp F = 15.572, dose F = 92.000, supp:dose F = 4.107 p = 0.02186; MSE 13.19)', () => {
  const d = X.toothDoc(), it = A.glm(d, { dep: ix(d, 'len'), factors: [ix(d, 'supp'), ix(d, 'dose')] }), r = it.res, row = nm => r.rows.find(x => x.name === nm);
  near(row('supp').ss, 205.350, 5e-4, 'SS supp'); near(row('supp').F, 15.57198, 5e-5, 'F supp'); near(row('supp').p, 0.0002311828, 5e-10, 'p supp');
  near(row('dose').ss, 2426.434, 5e-4, 'SS dose'); near(row('dose').F, 92.00000, 5e-4, 'F dose');
  near(row('supp * dose').ss, 108.319, 5e-4, 'SS int'); near(row('supp * dose').F, 4.106991, 5e-6, 'F int'); near(row('supp * dose').p, 0.02186027, 5e-8, 'p int');
  near(r.mse, 13.18715, 5e-5, 'MSE'); assert.strictEqual(r.dfE, 54);
  near(row('Corrected Model').ss, 2740.103, 5e-3, 'model SS');
});
t('Type III SS on an unbalanced design equals the drop-one-term regression comparison', () => {
  // unbalanced: drop some ToothGrowth cases; check SS(A) = SSE(model without A) − SSE(full) directly
  const d = X.toothDoc(); const keep = [...Array(60).keys()].filter(i => i % 7 !== 3);
  const y = keep.map(i => d.cols[0][i]), a = keep.map(i => d.cols[1][i] - 1), b = keep.map(i => ({ 0.5: 0, 1: 1, 2: 2 })[d.cols[2][i]]);
  const r = S.glm(y, [{ name: 'A', codes: a, levels: ['VC', 'OJ'] }, { name: 'B', codes: b, levels: ['0.5', '1', '2'] }]);
  const eff = (codes, L) => Array.from({ length: L - 1 }, (_, j) => Float64Array.from(codes, c => c === j ? 1 : c === L - 1 ? -1 : 0));
  const A1 = eff(a, 2), B1 = eff(b, 3), AB = B1.map(c => c.map((v, i) => v * A1[0][i])), one = new Float64Array(y.length).fill(1);
  const sse = cols => S.qrSolve(cols, Float64Array.from(y)).sse, full = sse([one, ...A1, ...B1, ...AB]);
  near(r.rows.find(x => x.name === 'A').ss, sse([one, ...B1, ...AB]) - full, 1e-8, 'SS A');
  near(r.rows.find(x => x.name === 'B').ss, sse([one, ...A1, ...AB]) - full, 1e-8, 'SS B');
});
t('mtcars linear regression mpg ~ wt (R: 37.2851 (1.8776), −5.3445 (0.5591), R² = 0.7528, F = 91.38, σ = 3.046)', () => {
  const d = X.mtcarsDoc(), r = A.regress(d, { dep: ix(d, 'mpg'), preds: [ix(d, 'wt')] }).res;
  near(r.coef[0].b, 37.285126, 5e-6, 'b0'); near(r.coef[0].se, 1.877627, 5e-6, 'se0'); near(r.coef[1].b, -5.344472, 5e-6, 'b1'); near(r.coef[1].se, 0.559101, 5e-6, 'se1');
  near(r.coef[1].t, -9.559044, 5e-6, 't'); near(r.coef[1].p, 1.293959e-10, 5e-16, 'p'); near(r.r2, 0.7528328, 5e-7, 'R²'); near(r.adj, 0.7445939, 5e-7, 'adj R²');
  near(r.F, 91.37533, 5e-5, 'F'); near(r.see, 3.045882, 5e-6, 'sigma'); near(r.coef[1].beta, -0.8676594, 5e-7, 'beta = r');
});
t('mtcars multiple regression mpg ~ wt + hp (R: 37.22727, −3.87783, −0.03177; R² = 0.8268, F = 69.21; VIF 1.767)', () => {
  const d = X.mtcarsDoc(), r = A.regress(d, { dep: ix(d, 'mpg'), preds: [ix(d, 'wt'), ix(d, 'hp')] }).res;
  near(r.coef[0].b, 37.22727, 5e-5, 'b0'); near(r.coef[1].b, -3.87783, 5e-5, 'wt'); near(r.coef[2].b, -0.03177295, 5e-8, 'hp');
  near(r.coef[1].se, 0.63273, 5e-5, 'se wt'); near(r.coef[2].se, 0.00903, 5e-5, 'se hp'); near(r.r2, 0.8267855, 5e-7, 'R²'); near(r.F, 69.21121, 5e-5, 'F');
  near(r.coef[1].vif, 1.766625, 5e-6, 'VIF');
});
t('regression with a categorical predictor is dummy-coded (mpg ~ cyl: 26.6636, −6.9208, −11.5636; R² = 0.7325)', () => {
  const d = X.mtcarsDoc(), r = A.regress(d, { dep: ix(d, 'mpg'), preds: [ix(d, 'cyl')] }).res;
  near(r.coef[0].b, 26.663636, 5e-6, 'b0'); near(r.coef[1].b, -6.920779, 5e-6, '6cyl'); near(r.coef[2].b, -11.563636, 5e-6, '8cyl'); near(r.r2, 0.7324601, 5e-7, 'R²');
});
t('mtcars logistic regression am ~ wt (R glm: 12.040 (4.510), −4.024 (1.436); deviance 43.230 → 19.176; AIC 23.176)', () => {
  const d = X.mtcarsDoc(), r = A.logistic(d, { dep: ix(d, 'am'), preds: [ix(d, 'wt')] }).res;
  near(r.coef[0].b, 12.04037, 5e-5, 'b0'); near(r.coef[0].se, 4.509706, 5e-4, 'se0'); near(r.coef[1].b, -4.023970, 5e-5, 'b1'); near(r.coef[1].se, 1.436416, 5e-4, 'se1');
  near(r.m2ll0, 43.22973, 5e-5, 'null deviance'); near(r.m2ll, 19.17608, 5e-5, 'residual deviance'); near(r.aic, 23.17608, 5e-5, 'AIC');
  near(r.coef[1].p, 0.005091, 5e-6, 'Wald p'); assert(r.converged);
  const r2 = A.logistic(d, { dep: ix(d, 'am'), preds: [ix(d, 'hp'), ix(d, 'wt')] }).res;    // R: 18.86630, 0.03626, −8.08348; deviance 10.059
  near(r2.coef[0].b, 18.86630, 5e-4, 'b0'); near(r2.coef[1].b, 0.03625560, 5e-7, 'hp'); near(r2.coef[2].b, -8.083475, 5e-5, 'wt'); near(r2.m2ll, 10.05911, 5e-5, 'dev');
});
t('mtcars correlations (R: Pearson r = −0.8677, CI −0.9338 … −0.7441; Spearman ρ = −0.8864; Kendall τ-b = −0.7278, z = −5.7981)', () => {
  const m = X.mtcars(), p = S.pearson(m.mpg, m.wt), s = S.spearman(m.mpg, m.wt), k = S.kendall(m.mpg, m.wt);
  near(p.r, -0.8676594, 5e-7, 'r'); near(p.lo, -0.9338264, 5e-7, 'lo'); near(p.hi, -0.7440872, 5e-7, 'hi'); near(p.p, 1.293959e-10, 5e-16, 'p');
  near(s.rho, -0.886422, 5e-6, 'rho'); near(k.tau, -0.7278321, 5e-7, 'tau'); near(k.z, -5.7981, 5e-4, 'z'); near(k.p, 6.706e-9, 5e-12, 'p');
});
t('normality tests on mtcars mpg (R: Shapiro W = 0.94756 p = 0.1229; Lilliefors D = 0.1263 p = 0.2171; Anderson–Darling A = 0.57968 p = 0.1207)', () => {
  const x = X.mtcars().mpg, sw = S.shapiroWilk(x), ks = S.lilliefors(x), ad = S.andersonDarling(x);
  near(sw.W, 0.94756, 5e-6, 'W'); near(sw.p, 0.1229, 5e-5, 'p'); near(ks.D, 0.12630, 5e-6, 'D'); near(ks.p, 0.2171, 5e-5, 'p'); near(ad.A, 0.57968, 5e-6, 'A'); near(ad.p, 0.1207, 5e-5, 'p');
});
t('Shapiro–Wilk across sample-size branches (SciPy: n = 3, 5, 8, 30, 32)', () => {
  Object.entries(ref.sw).forEach(([k, [x, W, p]]) => { const r = S.shapiroWilk(x); near(r.W, W, 2e-6, k + ' W'); near(r.p, p, Math.max(2e-5, p * 1e-4), k + ' p'); });
});
t('chi-square test of independence (Agresti party ID: X² = 30.07, df = 2, p = 2.954e-07; G² = 30.02)', () => {
  const c = S.chiSquare([[762, 327, 468], [484, 239, 477]]);
  near(c.X2, 30.0701, 5e-4, 'X2'); assert.strictEqual(c.df, 2); near(c.p, 2.953589e-7, 5e-12, 'p'); near(c.G2, 30.0167, 5e-4, 'G2');
  near(c.V, Math.sqrt(30.0701 / 2757), 1e-5, 'Cramér V');
});
t('2×2 tables: Fisher (tea tasting p = 0.4857, one-sided 0.2429) and Yates (SciPy)', () => {
  const f = S.fisher2x2(3, 1, 1, 3); near(f.p, 0.4857143, 5e-7, 'two-sided'); near(f.pGreater, 0.2428571, 5e-7, 'greater');
  const c = S.chiSquare([[12, 5], [7, 7]]); near(c.yates, ref.yates[0], 1e-10, 'Yates X²'); near(c.pYates, ref.yates[1], 1e-10, 'Yates p');
});
t('crosstabs procedure builds counts and chi-square from a dataset', () => {
  const d = X.mtcarsDoc(), it = A.crosstabs(d, { row: ix(d, 'am'), col: ix(d, 'vs'), cells: ['count'] });
  assert.deepStrictEqual(it.table, [[12, 7], [6, 7]]);   // table(mtcars$am, mtcars$vs)
  near(it.chi.fisher.p, 0.4727, 5e-4, 'Fisher p (R fisher.test: 0.4727)');
});
t('Mann–Whitney U on sleep data (U = 25.5; asymptotic p = 0.06372 (SciPy, no continuity); exact with ties = 0.06582 by enumeration)', () => {
  const r = S.mannWhitney(X.SLEEP.drug1, X.SLEEP.drug2);
  assert.strictEqual(r.U, 25.5); near(r.p, 0.06372225, 5e-8, 'asymptotic p'); near(r.pExact, 0.0658165364, 5e-9, 'exact p');
});
t('Wilcoxon signed-rank on sleep data (SciPy: p = 0.007632 asymptotic; exact 2/512 = 0.003906)', () => {
  const r = S.wilcoxon(X.SLEEP.drug2, X.SLEEP.drug1);
  assert.strictEqual(r.n, 9); assert.strictEqual(r.zeros, 1); assert.strictEqual(r.Tneg, 0); near(r.p, 0.007632442, 5e-9, 'p'); near(r.pExact, 0.00390625, 1e-12, 'exact');
});
t('descriptives match SPSS formulas (skewness/kurtosis G1, G2 vs SciPy; HAVERAGE percentiles vs NumPy “weibull”)', () => {
  const x = X.mtcars().mpg, d = S.describe(x), s = S.sorted(x);
  near(d.mean, 20.090625, 1e-12, 'mean'); near(d.sd, 6.0269480520891, 1e-11, 'sd'); near(d.skew, ref.skew[0], 1e-10, 'skew'); near(d.kurt, ref.skew[1], 1e-10, 'kurt');
  [0.25, 0.5, 0.75, 0.1, 0.9].forEach((p, k) => near(S.quantile(s, p), ref.q6[k], 1e-10, 'P' + p * 100));
  near(d.seSkew, 0.414, 5e-4, 'SE skew (SPSS: .414 for n = 32)'); near(d.seKurt, 0.809, 5e-4, 'SE kurt (SPSS: .809)');
});
t('control chart constants reproduce the ASTM table (A2, D3, D4 for n = 2…10)', () => {
  const A2 = [1.880, 1.023, 0.729, 0.577, 0.483, 0.419, 0.373, 0.337, 0.308], D3 = [0, 0, 0, 0, 0, 0.076, 0.136, 0.184, 0.223], D4 = [3.267, 2.574, 2.282, 2.114, 2.004, 1.924, 1.864, 1.816, 1.777];
  for (let k = 2; k <= 10; k++) {
    const d2 = S.CC.d2[k], d3 = S.CC.d3[k];
    near(3 / (d2 * Math.sqrt(k)), A2[k - 2], 1.5e-3, 'A2 n=' + k); near(Math.max(0, 1 - 3 * d3 / d2), D3[k - 2], 1.5e-3, 'D3 n=' + k); near(1 + 3 * d3 / d2, D4[k - 2], 1.5e-3, 'D4 n=' + k);
  }
  const r = S.chartIMR([10, 12, 11, 13, 12, 30]);   // MR = 2,1,2,1,18 → MR̄ = 4.8; limits = mean ± 2.66·MR̄
  near(r.I.ucl, 14.6666667 + 3 * 4.8 / 1.128379, 1e-4, 'UCL (x̄ + 3·MR̄/d2)'); near(r.MR.ucl, 4.8 * (1 + 3 * 0.8525 / 1.128379), 1e-4, 'MR UCL (D4·MR̄)');
  assert.deepStrictEqual(r.MR.flags[5], [1], 'MR spike flagged');
  const xr = S.chartXbarR([[1, 2, 3], [2, 3, 4], [1, 3, 5], [2, 2, 2]]);
  near(xr.X.center, 2.5, 1e-12, 'grand mean'); near(xr.sigma, (2 + 2 + 4 + 0) / 4 / 1.69257, 1e-9, 'sigma = R̄/d2');
});
t('every procedure runs on the demo dataset and produces tables', () => {
  const d = X.demoDoc(), j = n2 => ix(d, n2);
  const runs = [A.descriptives(d, { vars: [j('age'), j('bmi')] }), A.frequencies(d, { vars: [j('satisfaction')] }), A.crosstabs(d, { row: j('group'), col: j('responder') }),
    A.tOne(d, { vars: [j('change')] }), A.tInd(d, { vars: [j('change')], group: j('sex') }), A.tPaired(d, { pairs: [[j('sbp0'), j('sbp12')]] }), A.anova1(d, { vars: [j('change')], factor: j('group') }),
    A.glm(d, { dep: j('change'), factors: [j('group'), j('sex')] }), A.correlate(d, { vars: [j('age'), j('bmi'), j('sbp0')] }), A.regress(d, { dep: j('sbp12'), preds: [j('sbp0'), j('group')] }),
    A.logistic(d, { dep: j('responder'), preds: [j('adherence'), j('group')] }), A.mannWhitney(d, { vars: [j('change')], group: j('sex') }), A.wilcoxon(d, { pairs: [[j('sbp0'), j('sbp12')]] }),
    A.kruskal(d, { vars: [j('change')], group: j('group') }), A.normality(d, { vars: [j('bmi')] }), A.control(d, { type: 'xbarr', x: j('sbp0'), size: 5 })];
  runs.forEach(it => assert(it.blocks.length && it.blocks.every(b => b.t)));
  // satisfaction has user-missing code 9 (4 cases): frequencies must list it under Missing
  const fr = runs[1].blocks.find(b => b.t === 'table' && b.title.startsWith('Satisfaction'));
  assert(fr.rows.some(r => r[1] === 'No answer' && r[2] === 4), 'user-missing row');
});
console.log(`\n${n} statistics tests passed`);
