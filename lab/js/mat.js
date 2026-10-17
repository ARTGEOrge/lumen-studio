// Lumen Lab — numeric core: column-major real/complex matrices, element-wise ops with
// implicit expansion (like MATLAB R2016b+), matrix product, concatenation and number display.
(function (root) {
  'use strict';

  class LabError extends Error { constructor(msg, id) { super(msg); this.identifier = id || ''; this.lab = true; } }
  const fail = (m, id) => { throw new LabError(m, id); };

  // cls: 'double' | 'logical' | 'char'
  class Mat {
    constructor(r, c, re, im, cls) { this.r = r; this.c = c; this.re = re || new Float64Array(r * c); this.im = im || null; this.cls = cls || 'double'; }
    get n() { return this.r * this.c; }
    get type() { return 'num'; }
  }
  const num = (x, im) => new Mat(1, 1, Float64Array.of(x), im ? Float64Array.of(im) : null);
  const zeros = (r, c) => new Mat(r, c);
  const empty = () => new Mat(0, 0);
  const bool = b => new Mat(1, 1, Float64Array.of(b ? 1 : 0), null, 'logical');
  const str = s => { const m = new Mat(s.length ? 1 : 0, s.length); for (let i = 0; i < s.length; i++) m.re[i] = s.charCodeAt(i); m.cls = 'char'; return m; };
  const fromRows = rows => { const r = rows.length, c = r ? rows[0].length : 0, m = new Mat(r, c); for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) m.re[i + j * r] = rows[i][j]; return m; };
  const rowVec = a => { const m = new Mat(a.length ? 1 : 0, a.length); m.re.set(a); return m; };
  const colVec = a => { const m = new Mat(a.length, a.length ? 1 : 0); m.re.set(a); return m; };
  const toRows = m => { const out = []; for (let i = 0; i < m.r; i++) { const row = []; for (let j = 0; j < m.c; j++) row.push(m.re[i + j * m.r]); out.push(row); } return out; };
  const toStr = m => { let s = ''; for (let i = 0; i < m.n; i++) s += String.fromCharCode(m.re[i]); return s; };   // column-major, fine for rows
  const charRows = m => { const out = []; for (let i = 0; i < m.r; i++) { let s = ''; for (let j = 0; j < m.c; j++) s += String.fromCharCode(m.re[i + j * m.r]); out.push(s); } return out; };
  const isScalar = m => m.r === 1 && m.c === 1;
  const isVector = m => (m.r === 1 || m.c === 1) && m.n > 0;
  const isEmpty = m => m.r === 0 || m.c === 0;
  const copy = m => new Mat(m.r, m.c, m.re.slice(), m.im ? m.im.slice() : null, m.cls);
  const asDouble = m => m.cls === 'double' ? m : new Mat(m.r, m.c, m.re, m.im, 'double');
  // drop an all-zero imaginary part, as MATLAB does after arithmetic
  function narrow(m) { if (m.im) { for (let i = 0; i < m.im.length; i++) if (m.im[i] !== 0) return m; m.im = null; } return m; }
  const scalarOf = m => { if (m.n < 1) fail('Value must be a scalar, not empty.'); return m.re[0]; };

  // ---------- element-wise with implicit expansion ----------
  function bshape(a, b) {
    const r = a.r === b.r ? a.r : a.r === 1 ? b.r : b.r === 1 ? a.r : -1;
    const c = a.c === b.c ? a.c : a.c === 1 ? b.c : b.c === 1 ? a.c : -1;
    if (r < 0 || c < 0) fail(`Arrays have incompatible sizes for this operation (${a.r}×${a.c} and ${b.r}×${b.c}).`, 'MATLAB:sizeDimensionsMustMatch');
    return [r, c];
  }
  // fr(x, y) → number for real data; fc(ar, ai, br, bi) → [re, im] for complex data (optional)
  function ew(a, b, fr, fc, cls) {
    if (a.n === 1 && b.n === 1 && !a.im && !b.im) return new Mat(1, 1, Float64Array.of(fr(a.re[0], b.re[0])), null, cls);
    const [r, c] = bshape(a, b), out = new Mat(r, c, null, null, cls), N = r * c;
    const sa = a.n === N && a.r === r, sb = b.n === N && b.r === r;
    if (!a.im && !b.im || !fc) {
      if (sa && sb) for (let k = 0; k < N; k++) out.re[k] = fr(a.re[k], b.re[k]);
      else if (a.n === 1) { const x = a.re[0]; for (let k = 0; k < N; k++) out.re[k] = fr(x, sb ? b.re[k] : b.re[bi(b, k, r)]); }
      else if (b.n === 1) { const y = b.re[0]; for (let k = 0; k < N; k++) out.re[k] = fr(sa ? a.re[k] : a.re[bi(a, k, r)], y); }
      else for (let k = 0; k < N; k++) out.re[k] = fr(a.re[bi(a, k, r)], b.re[bi(b, k, r)]);
      return out;
    }
    out.im = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      const ia = bi(a, k, r), ib = bi(b, k, r);
      const v = fc(a.re[ia], a.im ? a.im[ia] : 0, b.re[ib], b.im ? b.im[ib] : 0);
      out.re[k] = v[0]; out.im[k] = v[1];
    }
    return cls === 'logical' ? (out.im = null, out) : narrow(out);
  }
  function bi(m, k, r) { const i = k % r, j = (k - i) / r; return (m.r === 1 ? 0 : i) + (m.c === 1 ? 0 : j) * m.r; }
  function map(a, f, fc) {   // unary element-wise
    const out = new Mat(a.r, a.c);
    if (!a.im || !fc) { for (let k = 0; k < a.n; k++) out.re[k] = f(a.re[k]); return out; }
    out.im = new Float64Array(a.n);
    for (let k = 0; k < a.n; k++) { const v = fc(a.re[k], a.im[k]); out.re[k] = v[0]; out.im[k] = v[1]; }
    return narrow(out);
  }

  // complex scalar helpers
  const C = {
    mul: (a, b, c, d) => [a * c - b * d, a * d + b * c],
    div: (a, b, c, d) => {
      if (Math.abs(c) >= Math.abs(d)) { if (c === 0 && d === 0) return [a / 0, b === 0 ? (a === 0 ? NaN : 0) : b / 0]; const r = d / c, den = c + d * r; return [(a + b * r) / den, (b - a * r) / den]; }
      const r = c / d, den = c * r + d; return [(a * r + b) / den, (b * r - a) / den];
    },
    abs: (a, b) => Math.hypot(a, b),
    exp: (a, b) => { const e = Math.exp(a); return b === 0 ? [e, 0] : [e * Math.cos(b), e * Math.sin(b)]; },
    log: (a, b) => [Math.log(Math.hypot(a, b)), Math.atan2(b, a)],
    sqrt: (a, b) => { if (b === 0) return a >= 0 ? [Math.sqrt(a), 0] : [0, Math.sqrt(-a)]; const m = Math.hypot(a, b), re = Math.sqrt((m + a) / 2), im = Math.sign(b) * Math.sqrt((m - a) / 2); return [re, im]; },
    pow: (a, b, c, d) => {
      if (a === 0 && b === 0) return (c === 0 && d === 0) ? [1, 0] : c > 0 ? [0, 0] : [Infinity, 0];
      if (d === 0 && b === 0 && Number.isInteger(c)) return [Math.pow(a, c), 0];
      const [lr, li] = C.log(a, b), [er, ei] = C.mul(lr, li, c, d); return C.exp(er, ei);
    },
    sin: (a, b) => [Math.sin(a) * Math.cosh(b), Math.cos(a) * Math.sinh(b)],
    cos: (a, b) => [Math.cos(a) * Math.cosh(b), -Math.sin(a) * Math.sinh(b)],
  };

  const plus = (a, b) => ew(a, b, (x, y) => x + y, (a1, a2, b1, b2) => [a1 + b1, a2 + b2]);
  const minus = (a, b) => ew(a, b, (x, y) => x - y, (a1, a2, b1, b2) => [a1 - b1, a2 - b2]);
  const times = (a, b) => ew(a, b, (x, y) => x * y, C.mul);
  const rdivide = (a, b) => ew(a, b, (x, y) => x / y, C.div);
  const ldivide = (a, b) => rdivide(b, a);
  function power(a, b) {
    let needC = !!(a.im || b.im);
    if (!needC) { // negative base with fractional exponent goes complex
      const [r, c] = bshape(a, b), N = r * c;
      for (let k = 0; k < N && !needC; k++) { const x = a.re[bi(a, k, r)], y = b.re[bi(b, k, r)]; if (x < 0 && !Number.isInteger(y) && isFinite(y)) needC = true; }
    }
    if (!needC) return ew(a, b, Math.pow);
    const A = a.im ? a : new Mat(a.r, a.c, a.re, new Float64Array(a.n)); return ew(A, b, Math.pow, C.pow);
  }
  const cmp = f => (a, b) => ew(a, b, (x, y) => f(x, y) ? 1 : 0, null, 'logical');
  const lt = cmp((x, y) => x < y), gt = cmp((x, y) => x > y), le = cmp((x, y) => x <= y), ge = cmp((x, y) => x >= y);
  const eq = (a, b) => ew(a, b, (x, y) => x === y ? 1 : 0, (a1, a2, b1, b2) => [a1 === b1 && a2 === b2 ? 1 : 0, 0], 'logical');
  const ne = (a, b) => ew(a, b, (x, y) => x !== y ? 1 : 0, (a1, a2, b1, b2) => [a1 !== b1 || a2 !== b2 ? 1 : 0, 0], 'logical');
  const and = (a, b) => ew(a, b, (x, y) => (x !== 0 && y !== 0) ? 1 : 0, null, 'logical');
  const or = (a, b) => ew(a, b, (x, y) => (x !== 0 || y !== 0) ? 1 : 0, null, 'logical');
  const not = a => { const o = map(a, x => x === 0 ? 1 : 0); o.cls = 'logical'; return o; };
  const neg = a => { const o = new Mat(a.r, a.c, null, a.im ? new Float64Array(a.n) : null); for (let k = 0; k < a.n; k++) { o.re[k] = -a.re[k]; if (a.im) o.im[k] = -a.im[k]; } return o; };
  function transpose(a, conj) {
    const o = new Mat(a.c, a.r, null, a.im ? new Float64Array(a.n) : null, a.cls);
    for (let i = 0; i < a.r; i++) for (let j = 0; j < a.c; j++) { o.re[j + i * a.c] = a.re[i + j * a.r]; if (a.im) o.im[j + i * a.c] = conj ? -a.im[i + j * a.r] : a.im[i + j * a.r]; }
    return o;
  }
  function mtimes(a, b) {
    if (a.n === 1 || b.n === 1) return times(a, b);
    if (a.c !== b.r) fail(`Incorrect dimensions for matrix multiplication (${a.r}×${a.c} * ${b.r}×${b.c}). Check that the number of columns in the first matrix matches the number of rows in the second. To operate on each element, use TIMES (.*).`, 'MATLAB:innerdim');
    const r = a.r, c = b.c, n = a.c, o = new Mat(r, c);
    if (!a.im && !b.im) {
      const A = a.re, B = b.re, O = o.re;
      for (let j = 0; j < c; j++) for (let k = 0; k < n; k++) { const bkj = B[k + j * n]; if (bkj === 0) continue; const ao = k * r, oo = j * r; for (let i = 0; i < r; i++) O[i + oo] += A[i + ao] * bkj; }
      return o;
    }
    o.im = new Float64Array(r * c);
    const ai = a.im || new Float64Array(a.n), bim = b.im || new Float64Array(b.n);
    for (let j = 0; j < c; j++) for (let k = 0; k < n; k++) {
      const br = b.re[k + j * n], bc = bim[k + j * n];
      for (let i = 0; i < r; i++) { const ar = a.re[i + k * r], ac = ai[i + k * r]; o.re[i + j * r] += ar * br - ac * bc; o.im[i + j * r] += ar * bc + ac * br; }
    }
    return narrow(o);
  }

  // ---------- concatenation ----------
  function hcat(list) {
    const xs = list.filter(m => !(m.r === 0 && m.c === 0));
    if (!xs.length) return list.length && list.every(m => m.cls === 'char') ? str('') : empty();
    const r = xs[0].r; let c = 0;
    for (const m of xs) { if (m.r !== r) fail('Dimensions of arrays being concatenated are not consistent.', 'MATLAB:catenate:dimensionMismatch'); c += m.c; }
    const anyIm = xs.some(m => m.im), o = new Mat(r, c, null, anyIm ? new Float64Array(r * c) : null, catCls(xs));
    let off = 0; for (const m of xs) { o.re.set(m.re, off); if (m.im) o.im.set(m.im, off); off += m.n; }
    return o;
  }
  function vcat(list) {
    const xs = list.filter(m => !(m.r === 0 && m.c === 0));
    if (!xs.length) return list.length && list.every(m => m.cls === 'char') ? str('') : empty();
    const c = xs[0].c; let r = 0;
    for (const m of xs) { if (m.c !== c) fail(m.cls === 'char' ? 'Dimensions of arrays being concatenated are not consistent. (Rows of a char array must have the same length.)' : 'Dimensions of arrays being concatenated are not consistent.', 'MATLAB:catenate:dimensionMismatch'); r += m.r; }
    const anyIm = xs.some(m => m.im), o = new Mat(r, c, null, anyIm ? new Float64Array(r * c) : null, catCls(xs));
    let off = 0;
    for (const m of xs) { for (let j = 0; j < c; j++) for (let i = 0; i < m.r; i++) { o.re[off + i + j * r] = m.re[i + j * m.r]; if (m.im) o.im[off + i + j * r] = m.im[i + j * m.r]; } off += m.r; }
    return o;
  }
  const catCls = xs => xs.some(m => m.cls === 'char') ? 'char' : xs.every(m => m.cls === 'logical') ? 'logical' : 'double';

  // ---------- display (format short / long) ----------
  const fmt = { long: false };
  const isInt = x => Number.isInteger(x);
  function fmtReal(x, dec) {
    if (Number.isNaN(x)) return 'NaN';
    if (x === Infinity) return 'Inf'; if (x === -Infinity) return '-Inf';
    return x.toFixed(dec);
  }
  function expStr(x, d) { if (!isFinite(x)) return fmtReal(x, 0); const s = x.toExponential(d); return s.replace(/e([+-])(\d)$/, 'e$10$2'); }
  function scalarText(x, xi) {
    const dec = fmt.long ? 15 : 4;
    const one = v => {
      if (!isFinite(v) || isInt(v) && Math.abs(v) < 1e10) return fmtReal(v, 0);
      const a = Math.abs(v);
      if (a >= 1e-3 && a < 1e5) return v.toFixed(dec);
      return expStr(v, dec);
    };
    if (xi === undefined || xi === null) return one(x);
    // complex values always show decimals; both parts share one format
    const sgn = xi < 0 || Object.is(xi, -0) ? '-' : '+', mx = Math.max(Math.abs(x), Math.abs(xi));
    const fixed = (mx >= 1e-3 && mx < 1e5) || mx === 0;
    const f = v => !isFinite(v) ? fmtReal(v, 0) : fixed ? v.toFixed(dec) : expStr(v, dec);
    return `${f(x)} ${sgn} ${f(Math.abs(xi))}i`;
  }
  // returns the lines (without the "name =" header) for a numeric/logical/char matrix
  function matrixLines(m) {
    if (m.cls === 'char') return { head: null, rows: charRows(m).map(s => `    '${s}'`), cellW: 0 };
    const N = m.n; if (!N) return { head: null, rows: [], cellW: 0 };
    const re = m.re, im = m.im, dec = fmt.long ? 15 : 4;
    let allInt = true, maxA = 0;
    for (let k = 0; k < N; k++) {
      const v = re[k], w = im ? im[k] : 0;
      if (isFinite(v)) { if (!isInt(v)) allInt = false; maxA = Math.max(maxA, Math.abs(v)); }
      if (im && isFinite(w)) { if (!isInt(w)) allInt = false; maxA = Math.max(maxA, Math.abs(w)); }
    }
    let scale = 1, head = null;
    if (allInt && (maxA >= 1e10 || im)) allInt = false;
    if (!allInt && maxA > 0 && (maxA >= 1e5 || maxA < 1e-3)) {
      const e = Math.floor(Math.log10(maxA)); scale = Math.pow(10, e); head = `   1.0e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')} *`;
    } else if (!allInt && maxA >= 1e3 && maxA < 1e5) { const e = Math.floor(Math.log10(maxA)); scale = Math.pow(10, e); head = `   1.0e+${String(e).padStart(2, '0')} *`; }
    const cell = v => allInt ? fmtReal(v, 0) : (v === 0 && !im ? '0' : isFinite(v) ? (v / scale).toFixed(dec) : fmtReal(v, 0));
    const cells = []; let w = 0, wi = 0;
    for (let k = 0; k < N; k++) {
      const s = cell(re[k]); w = Math.max(w, s.length);
      if (im) { const t = cell(Math.abs(im[k])); wi = Math.max(wi, t.length); cells.push([s, t, im[k] < 0 || Object.is(im[k], -0) ? '-' : '+']); } else cells.push([s]);
    }
    let wa = 0; for (const c of cells) wa = Math.max(wa, c[0].replace('-', '').length);
    const pad = m.cls === 'logical' ? 4 : allInt ? Math.max(wa + 3, 6, w + 2) : Math.max(wa + 4, w + 2);
    const cellW = pad + (im ? wi + 4 : 0);
    const rows = [];
    for (let i = 0; i < m.r; i++) {
      let line = '';
      for (let j = 0; j < m.c; j++) { const c = cells[i + j * m.r]; line += c[0].padStart(pad) + (im ? ` ${c[2]} ${c[1].padStart(wi)}i` : ''); }
      rows.push(line);
    }
    return { head, rows, cellW };
  }

  const api = { LabError, fail, Mat, num, zeros, empty, bool, str, fromRows, rowVec, colVec, toRows, toStr, charRows, isScalar, isVector, isEmpty, copy, asDouble, narrow, scalarOf,
    bshape, ew, map, C, plus, minus, times, rdivide, ldivide, power, lt, gt, le, ge, eq, ne, and, or, not, neg, transpose, mtimes, hcat, vcat, fmt, scalarText, matrixLines, expStr };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LabMat = api;
})(typeof self !== 'undefined' ? self : this);
