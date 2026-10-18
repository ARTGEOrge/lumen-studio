// node stats/tests/dist.test.js — distribution functions against published table values and SciPy 1.18.1
// (tests/scipy-ref.json was generated with scipy.stats; the table values below are from standard statistical tables / R).
const D = require('../js/dist.js'), assert = require('assert'), ref = require('./scipy-ref.json');
let n = 0, worst = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };
// relative-or-absolute closeness
const close = (a, b, rel = 1e-9, abs = 1e-14, what = '') => {
  const err = Math.abs(a - b), tol = Math.max(abs, rel * Math.abs(b));
  if (!(err <= tol)) throw new Error(`${what}: got ${a}, expected ${b} (err ${err.toExponential(2)})`);
  if (b !== 0 && rel > 0 && rel <= 1e-6) worst = Math.max(worst, err / Math.abs(b));
};

t('normal cdf, deep tails and quantiles (SciPy)', () => {
  ref.pnorm.forEach(([z, p]) => close(D.pnorm(z), p, 1e-11, 1e-300, `pnorm(${z})`));
  ref.norm_sf.forEach(([z, p]) => close(D.pnormUpper(z), p, 1e-10, 1e-300, `P(Z>${z})`));
  ref.qnorm.forEach(([p, z]) => close(D.qnorm(p), z, 1e-11, 1e-12, `qnorm(${p})`));
  close(D.qnorm(0.975), 1.959963984540054, 1e-14, 0, 'z.975');
});
t('Student t: tails and quantiles (SciPy) + table values', () => {
  ref.pt.forEach(([x, df, p]) => close(D.ptUpper(x, df), p, 1e-10, 1e-300, `P(T>${x}; ${df})`));
  ref.qt.forEach(([p, df, x]) => close(D.qt(p, df), x, 1e-10, 1e-12, `qt(${p}, ${df})`));
  // classic t-table
  [[0.975, 1, 12.706], [0.975, 5, 2.571], [0.975, 10, 2.228], [0.975, 30, 2.042], [0.995, 20, 2.845], [0.95, 15, 1.753]].forEach(([p, df, x]) => close(D.qt(p, df), x, 0, 5e-4, `t-table ${p},${df}`));
  close(D.pt2(2.228138851986, 10), 0.05, 1e-9, 0, 'two-sided');
});
t('F distribution (SciPy) + F-table', () => {
  ref.pf.forEach(([f, a, b, p]) => close(D.pfUpper(f, a, b), p, 1e-9, 1e-300, `P(F>${f}; ${a},${b})`));
  ref.qf.forEach(([p, a, b, f]) => close(D.qf(p, a, b), f, 1e-9, 1e-12, `qf(${p}; ${a},${b})`));
  [[0.95, 1, 10, 4.96], [0.95, 3, 20, 3.10], [0.99, 2, 30, 5.39], [0.95, 5, 60, 2.37]].forEach(([p, a, b, f]) => close(D.qf(p, a, b), f, 0, 6e-3, `F-table ${a},${b}`));
});
t('chi-square (SciPy) + table', () => {
  ref.pchisq.forEach(([x, k, p]) => close(D.pchisqUpper(x, k), p, 1e-10, 1e-300, `P(X²>${x}; ${k})`));
  ref.qchisq.forEach(([p, k, x]) => close(D.qchisq(p, k), x, 1e-10, 1e-12, `qchisq(${p}; ${k})`));
  [[0.95, 1, 3.841], [0.95, 2, 5.991], [0.99, 4, 13.277], [0.95, 20, 31.410]].forEach(([p, k, x]) => close(D.qchisq(p, k), x, 0, 6e-4, `chi-table ${k}`));
});
t('studentized range (Tukey): SciPy and the q-table', () => {
  ref.ptukey.forEach(([q, k, df, p]) => close(D.ptukey(q, k, df), p, 1e-7, 1e-9, `ptukey(${q}; ${k}, ${df})`));
  ref.qtukey.forEach(([p, k, df, q]) => close(D.qtukey(p, k, df), q, 1e-7, 1e-9, `qtukey(${p}; ${k}, ${df})`));
  // Harter (1960) q-table, alpha = .05
  [[3, 10, 3.877], [4, 20, 3.958], [5, 30, 4.102], [3, 60, 3.399], [6, 120, 4.096]].forEach(([k, df, q]) => close(D.qtukey(0.95, k, df), q, 0, 6e-4, `q-table k=${k} df=${df}`));
});
t('gamma / beta functions', () => {
  close(D.lgamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-14, 0, 'lgamma(.5)');
  close(D.lgamma(10), Math.log(362880), 1e-14, 0, 'lgamma(10)');
  close(D.lgamma(100), 359.1342053695754, 1e-13, 0, 'lgamma(100)');
  close(D.ibeta(0.5, 2, 3), 0.6875, 1e-13, 0, 'I_.5(2,3)');
  close(D.gammaP(1, 2), 1 - Math.exp(-2), 1e-13, 0, 'P(1,2)');
});
t('exact rank distributions sum to one and match small cases', () => {
  const d = D.rankSumDist([2, 4, 6, 8], 2); // ranks 1..4 doubled, choose 2: sums 3..7 -> counts 1,1,2,1,1 of 6
  assert.strictEqual(+d.reduce((a, b) => a + b, 0).toFixed(12), 1);
  close(d[2 * 5], 2 / 6, 1e-12, 0, 'W=5');
  const s = D.signedRankDist([2, 4, 6]);   // signed-rank n=3: T+ in 0..6, 8 subsets
  close(s[0], 1 / 8, 1e-12, 0, 'T+=0'); close(s[2 * 3], 2 / 8, 1e-12, 0, 'T+=3');
});
console.log(`\n${n} distribution tests passed · worst relative error vs SciPy/exact references ${worst.toExponential(1)}`);
