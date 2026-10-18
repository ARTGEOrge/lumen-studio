// Lumen Stats — probability distributions (normal, t, F, chi-square, studentized range, hypergeometric).
// Pure functions, no dependencies; runs in the browser (window.LDist) and in Node (module.exports).
// Upper tails are computed directly (never as 1 − lower) so small p-values keep full relative precision.
(function (root) {
  'use strict';
  const LOG_SQRT_2PI = 0.918938533204672741780329736406;
  const SQRT_2PI = 2.506628274631000502415765284811;
  const EPS = 1e-16, FPMIN = 1e-300;

  // ---------- gamma function ----------
  const LZ = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  function lgamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    if (x === 1 || x === 2) return 0;
    if (x > 1e7) return (x - 0.5) * Math.log(x) - x + LOG_SQRT_2PI + 1 / (12 * x);   // Stirling
    x -= 1; let a = LZ[0]; const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += LZ[i] / (x + i);
    return LOG_SQRT_2PI + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  const lchoose = (n, k) => lgamma(n + 1) - lgamma(k + 1) - lgamma(n - k + 1);
  const lbeta = (a, b) => lgamma(a) + lgamma(b) - lgamma(a + b);

  // ---------- regularized incomplete gamma P(a,x), Q(a,x) ----------
  function gser(a, x) {
    let ap = a, sum = 1 / a, del = sum;
    for (let n = 0; n < 100000; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * EPS) break; }
    return sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  function gcf(a, x) {
    let b = x + 1 - a, c = 1 / FPMIN, d = 1 / b, h = d;
    for (let i = 1; i < 100000; i++) {
      const an = -i * (i - a); b += 2;
      d = an * d + b; if (Math.abs(d) < FPMIN) d = FPMIN;
      c = b + an / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
  }
  function gammaP(a, x) { if (!(x > 0)) return 0; if (x === Infinity) return 1; return x < a + 1 ? gser(a, x) : 1 - gcf(a, x); }
  function gammaQ(a, x) { if (!(x > 0)) return 1; if (x === Infinity) return 0; return x < a + 1 ? 1 - gser(a, x) : gcf(a, x); }

  // ---------- regularized incomplete beta I_x(a,b) ----------
  function betacf(a, b, x) {
    const qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap; if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d; let h = d;
    for (let m = 1; m <= 100000; m++) {
      const m2 = 2 * m;
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN; d = 1 / d;
      const del = d * c; h *= del;
      if (Math.abs(del - 1) < EPS) break;
    }
    return h;
  }
  // I_x(a,b); y = 1 − x may be passed when it is known more precisely than 1 − x.
  function ibeta(x, a, b, y) {
    if (y == null) y = 1 - x;
    if (x <= 0) return 0; if (y <= 0) return 1;
    const lbt = -lbeta(a, b) + a * Math.log(x) + b * Math.log(y);
    if (x < (a + 1) / (a + b + 2)) return Math.exp(lbt) * betacf(a, b, x) / a;
    return 1 - Math.exp(lbt) * betacf(b, a, y) / b;
  }
  // 1 − I_x(a,b) without cancellation
  const ibetac = (x, a, b, y) => ibeta(y == null ? 1 - x : y, b, a, x);

  // ---------- normal ----------
  const dnorm = (z, m = 0, s = 1) => { const u = (z - m) / s; return Math.exp(-0.5 * u * u) / (SQRT_2PI * s); };
  // P(Z > z)
  function pnormUpper(z) {
    if (Number.isNaN(z)) return NaN;
    if (z === Infinity) return 0; if (z === -Infinity) return 1;
    const q = 0.5 * gammaQ(0.5, 0.5 * z * z);
    return z >= 0 ? q : 1 - q;
  }
  const pnorm = (z, m = 0, s = 1) => pnormUpper(-(z - m) / s);
  const AK = { a: [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00],
    b: [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01],
    c: [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00],
    d: [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00] };
  function acklam(p) {
    const { a, b, c, d } = AK, pl = 0.02425;
    if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    const q = p - 0.5, r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  // quantile of the standard normal, refined with Halley steps against the accurate cdf
  function qnorm(p, m = 0, s = 1) {
    if (!(p > 0)) return p === 0 ? -Infinity : NaN; if (!(p < 1)) return p === 1 ? Infinity : NaN;
    let x = acklam(p);
    for (let k = 0; k < 3; k++) {
      const f = p < 0.5 ? pnorm(x) - p : (1 - p) - pnormUpper(x);
      const u = f / dnorm(x); x -= u / (1 + x * u / 2);
    }
    return m + s * x;
  }

  // ---------- root finder (Brent) ----------
  function brent(f, a, b, tol = 1e-15, maxit = 200) {
    let fa = f(a), fb = f(b);
    if (fa === 0) return a; if (fb === 0) return b;
    if (fa * fb > 0) return NaN;
    let c = a, fc = fa, d = b - a, e = d;
    for (let i = 0; i < maxit; i++) {
      if (fb * fc > 0) { c = a; fc = fa; d = e = b - a; }
      if (Math.abs(fc) < Math.abs(fb)) { a = b; b = c; c = a; fa = fb; fb = fc; fc = fa; }
      const t = 2 * EPS * Math.abs(b) + 0.5 * tol * Math.max(1, Math.abs(b)) * 1e-0, m = 0.5 * (c - b);
      if (Math.abs(m) <= t || fb === 0) return b;
      if (Math.abs(e) >= t && Math.abs(fa) > Math.abs(fb)) {
        let p, q, r; const s = fb / fa;
        if (a === c) { p = 2 * m * s; q = 1 - s; }
        else { q = fa / fc; r = fb / fc; p = s * (2 * m * q * (q - r) - (b - a) * (r - 1)); q = (q - 1) * (r - 1) * (s - 1); }
        if (p > 0) q = -q; else p = -p;
        if (2 * p < Math.min(3 * m * q - Math.abs(t * q), Math.abs(e * q))) { e = d; d = p / q; } else { d = m; e = m; }
      } else { d = m; e = m; }
      a = b; fa = fb;
      b += Math.abs(d) > t ? d : (m > 0 ? t : -t);
      fb = f(b);
    }
    return b;
  }
  // find x ≥ lo with upper(x) = q, upper decreasing. Solves on a log scale of the tail for precision.
  function invUpper(upper, q, lo = 0, start = 1) {
    if (q <= 0) return Infinity; if (q >= 1) return lo;
    let hi = Math.max(start, lo + 1);
    while (upper(hi) > q && hi < 1e300) { lo = hi; hi *= 2; }
    const lq = Math.log(q);
    return brent(x => { const u = upper(x); return (u > 0 ? Math.log(u) : -800) - lq; }, lo, hi, 1e-15);
  }

  // ---------- Student t ----------
  // P(T > t)
  function ptUpper(t, df) {
    if (Number.isNaN(t)) return NaN;
    if (df === Infinity || df > 1e10) return pnormUpper(t);
    if (t === Infinity) return 0; if (t === -Infinity) return 1;
    const t2 = t * t, x = df / (df + t2), y = t2 / (df + t2);
    const half = 0.5 * ibeta(x, df / 2, 0.5, y);
    return t > 0 ? half : 1 - half;
  }
  const pt = (t, df) => ptUpper(-t, df);
  const pt2 = (t, df) => { const a = Math.abs(t); if (Number.isNaN(a)) return NaN; return Math.min(1, 2 * ptUpper(a, df)); };
  const dt = (t, df) => Math.exp(lgamma((df + 1) / 2) - lgamma(df / 2) - 0.5 * Math.log(df * Math.PI) - (df + 1) / 2 * Math.log1p(t * t / df));
  function qt(p, df) {
    if (!(p > 0 && p < 1)) return p === 0 ? -Infinity : p === 1 ? Infinity : NaN;
    if (df === Infinity || df > 1e10) return qnorm(p);
    if (p === 0.5) return 0;
    if (p < 0.5) return -qt(1 - p, df);
    return invUpper(x => ptUpper(x, df), 1 - p, 0, Math.max(1, qnorm(p)));
  }

  // ---------- chi-square ----------
  const pchisqUpper = (x, k) => x <= 0 ? 1 : gammaQ(k / 2, x / 2);
  const pchisq = (x, k) => x <= 0 ? 0 : gammaP(k / 2, x / 2);
  const dchisq = (x, k) => x < 0 ? 0 : Math.exp((k / 2 - 1) * Math.log(x) - x / 2 - (k / 2) * Math.LN2 - lgamma(k / 2));
  const qchisq = (p, k) => p <= 0 ? 0 : p >= 1 ? Infinity : invUpper(x => pchisqUpper(x, k), 1 - p, 0, Math.max(1, k));

  // ---------- F ----------
  function pfUpper(f, d1, d2) {
    if (!(f > 0)) return Number.isNaN(f) ? NaN : 1; if (f === Infinity) return 0;
    if (d2 === Infinity) return pchisqUpper(f * d1, d1);
    const s = d1 * f + d2;
    return ibeta(d2 / s, d2 / 2, d1 / 2, d1 * f / s);
  }
  const pf = (f, d1, d2) => f <= 0 ? 0 : 1 - pfUpper(f, d1, d2);
  const qf = (p, d1, d2) => p <= 0 ? 0 : p >= 1 ? Infinity : invUpper(x => pfUpper(x, d1, d2), 1 - p, 0, 2);

  // ---------- beta, binomial, hypergeometric ----------
  const pbeta = (x, a, b) => ibeta(x, a, b);
  function dhyper(x, K, N, n) { // P(X = x): x successes in n draws, K successes in population N
    if (x < Math.max(0, n - (N - K)) || x > Math.min(n, K)) return 0;
    return Math.exp(lchoose(K, x) + lchoose(N - K, n - x) - lchoose(N, n));
  }
  const dbinom = (k, n, p) => k < 0 || k > n ? 0 : Math.exp(lchoose(n, k) + k * Math.log(p) + (n - k) * Math.log1p(-p));

  // ---------- studentized range (Copenhaver & Holland 1988, as in R's ptukey) ----------
  const XL12 = [0.981560634246719250690549090149, 0.904117256370474856678465866119, 0.769902674194304687036893833213,
    0.587317954286617447296702418941, 0.367831498998180193752691536644, 0.125233408511468915472441369464];
  const AL12 = [0.047175336386511827194615961485, 0.106939325995318430960254718194, 0.160078328543346226334652529543,
    0.203167426723065921749064455810, 0.233492536538354808760849898925, 0.249147045813402785000562436043];
  const XL16 = [0.989400934991649932596154173450, 0.944575023073232576077988415535, 0.865631202387831743880467897712,
    0.755404408355003033895101194847, 0.617876244402643748446671764049, 0.458016777657227386342419442984,
    0.281603550779258913230460501460, 0.950125098376374401853193354250e-1];
  const AL16 = [0.271524594117540948517805724560e-1, 0.622535239386478928628438369944e-1, 0.951585116824927848099251076022e-1,
    0.124628971255533872052476282192, 0.149595988816576732081501730547, 0.169156519395002538189312079030,
    0.182603415044923588866763667969, 0.189450610455068496285396723208];
  // probability that the range of cc normal variates is < w (rr = number of ranges, normally 1)
  function wprob(w, rr, cc) {
    const qsqz = w * 0.5;
    if (qsqz >= 8) return 1;
    let prw = 2 * pnorm(qsqz) - 1;
    prw = prw >= Math.exp(-50 / cc) ? Math.pow(prw, cc) : 0;
    const wincr = w > 3 ? 2 : 3;
    let blb = qsqz; const binc = (8 - qsqz) / wincr; let bub = blb + binc, einsum = 0;
    const cc1 = cc - 1;
    for (let wi = 1; wi <= wincr; wi++) {
      let elsum = 0; const a = 0.5 * (bub + blb), b = 0.5 * (bub - blb);
      for (let jj = 1; jj <= 12; jj++) {
        let j, xx;
        if (6 < jj) { j = 12 - jj + 1; xx = XL12[j - 1]; } else { j = jj; xx = -XL12[j - 1]; }
        const ac = a + b * xx, qexpo = ac * ac;
        if (qexpo > 60) break;
        const pplus = 2 * pnorm(ac), pminus = 2 * pnorm(ac, w, 1);
        let rinsum = pplus * 0.5 - pminus * 0.5;
        if (rinsum >= Math.exp(-30 / cc1)) { rinsum = AL12[j - 1] * Math.exp(-0.5 * qexpo) * Math.pow(rinsum, cc1); elsum += rinsum; }
      }
      elsum *= 2 * b * cc / SQRT_2PI;
      einsum += elsum; blb = bub; bub += binc;
    }
    prw += einsum;
    if (prw <= Math.exp(-30 / rr)) return 0;
    prw = Math.pow(prw, rr);
    return prw >= 1 ? 1 : prw;
  }
  // P(Q < q) for the studentized range with nmeans means and df error degrees of freedom
  function ptukey(q, nmeans, df, nranges = 1) {
    if (!(q > 0)) return 0;
    if (q === Infinity) return 1;
    if (df > 25000 || df === Infinity) return wprob(q, nranges, nmeans);
    const f2 = df * 0.5;
    let f2lf = f2 * Math.log(df) - df * Math.LN2 - lgamma(f2);
    const f21 = f2 - 1, ff4 = df * 0.25;
    const ulen = df <= 100 ? 1 : df <= 800 ? 0.5 : df <= 5000 ? 0.25 : 0.125;
    f2lf += Math.log(ulen);
    let ans = 0, otsum = 0;
    for (let i = 1; i <= 50; i++) {
      otsum = 0; const twa1 = (2 * i - 1) * ulen;
      for (let jj = 1; jj <= 16; jj++) {
        let j, t1;
        if (8 < jj) { j = jj - 8 - 1; t1 = f2lf + f21 * Math.log(twa1 + XL16[j] * ulen) - (XL16[j] * ulen + twa1) * ff4; }
        else { j = jj - 1; t1 = f2lf + f21 * Math.log(twa1 - XL16[j] * ulen) + (XL16[j] * ulen - twa1) * ff4; }
        if (t1 >= -30) {
          const qsqz = 8 < jj ? q * Math.sqrt((XL16[j] * ulen + twa1) * 0.5) : q * Math.sqrt((-(XL16[j] * ulen) + twa1) * 0.5);
          otsum += wprob(qsqz, nranges, nmeans) * AL16[j] * Math.exp(t1);
        }
      }
      if (i * ulen >= 1 && otsum <= 1e-14) break;
      ans += otsum;
    }
    return ans > 1 ? 1 : ans;
  }
  const ptukeyUpper = (q, k, df) => Math.max(0, 1 - ptukey(q, k, df));
  function qtukey(p, nmeans, df) {
    if (!(p > 0 && p < 1)) return NaN;
    let hi = 2; while (ptukey(hi, nmeans, df) < p && hi < 1e4) hi *= 1.6;
    return brent(q => ptukey(q, nmeans, df) - p, 0.01, hi, 1e-11);
  }

  // ---------- exact rank-sum and signed-rank distributions (handle ties: scores are doubled ranks) ----------
  // scores: integer scores of all N observations; choose m of them. Returns Float64Array counts by sum (probabilities).
  function rankSumDist(scores, m) {
    const N = scores.length, maxS = scores.reduce((a, b) => a + b, 0);
    // dp[k][s] = number of ways (as probability-scaled doubles) to pick k items summing to s
    let dp = []; for (let k = 0; k <= m; k++) dp.push(new Float64Array(maxS + 1));
    dp[0][0] = 1;
    for (let i = 0; i < N; i++) {
      const v = scores[i];
      for (let k = Math.min(i + 1, m); k >= 1; k--) {
        const src = dp[k - 1], dst = dp[k];
        for (let s = maxS - v; s >= 0; s--) if (src[s]) dst[s + v] += src[s];
      }
    }
    const res = dp[m], tot = Math.exp(lchoose(N, m));
    for (let s = 0; s <= maxS; s++) res[s] /= tot;
    return res;
  }
  function signedRankDist(scores) {
    const maxS = scores.reduce((a, b) => a + b, 0);
    const dp = new Float64Array(maxS + 1); dp[0] = 1;
    scores.forEach(v => { for (let s = maxS - v; s >= 0; s--) if (dp[s]) dp[s + v] += dp[s]; });
    const tot = Math.pow(2, scores.length);
    for (let s = 0; s <= maxS; s++) dp[s] /= tot;
    return dp;
  }

  const api = { lgamma, lchoose, lbeta, gammaP, gammaQ, ibeta, ibetac, dnorm, pnorm, pnormUpper, qnorm, brent,
    pt, ptUpper, pt2, dt, qt, pchisq, pchisqUpper, dchisq, qchisq, pf, pfUpper, qf, pbeta, dhyper, dbinom,
    ptukey, ptukeyUpper, qtukey, rankSumDist, signedRankDist };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LDist = api;
})(typeof self !== 'undefined' ? self : this);
