// Lumen Lab — core function library: constructors, element-wise math, reductions, sorting/sets,
// linear algebra wrappers, strings and printf, cells/structs, workspace and file commands.
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const M = node ? require('./mat.js') : root.LabMat;
  const LA = node ? require('./linalg.js') : root.LabLinalg;
  const I = node ? require('./interp.js') : root.LabInterp;
  const { Mat, fail, num, str, bool } = M;
  const { Cell, Struct, Func, clsOf, isNum } = I;
  const L = Object.create(null);

  // ---------- argument helpers ----------
  const N = (v, fn) => { if (!v || v.type !== 'num') fail(`${fn ? fn + ': ' : ''}expected a numeric argument, got ${v ? clsOf(v) : 'nothing'}.`); return v; };
  const S = (v, fn) => { N(v, fn); if (v.n < 1) fail(`${fn ? fn + ': ' : ''}expected a scalar, got an empty array.`); return v.re[0]; };
  const isStr = v => v && v.type === 'num' && v.cls === 'char' && v.r <= 1;
  const Str = (v, fn) => { if (v && v.type === 'num' && v.cls === 'char') return M.toStr(v); if (v && v.type === 'num' && v.n === 0) return ''; fail(`${fn ? fn + ': ' : ''}expected a character vector (text in quotes).`); };
  const minArgs = (a, n, fn) => { if (a.length < n) fail(`Not enough input arguments${fn ? ' for ' + fn : ''}.`, 'MATLAB:minrhs'); };
  const vec = v => Array.from(N(v).re);
  const rowOut = a => M.rowVec(a), colOut = a => M.colVec(a);
  const like = (A, arr) => (A.r === 1 ? rowOut(arr) : colOut(arr));
  const asLogical = m => { m.cls = 'logical'; return m; };
  // size arguments: f(n) f(r,c) f([r c]) — ignoring trailing 'like'/class names
  function dims(a, fn) {
    a = a.filter(x => !isStr(x));
    if (!a.length) return [1, 1];
    if (a.length === 1) { const v = N(a[0], fn); if (v.n === 1) return [Math.max(0, Math.floor(v.re[0])), Math.max(0, Math.floor(v.re[0]))]; return [Math.max(0, Math.floor(v.re[0])), Math.max(0, Math.floor(v.re[1]))]; }
    for (let k = 2; k < a.length; k++) if (S(a[k]) !== 1) fail('Lumen Lab supports only two-dimensional arrays.');
    return [Math.max(0, Math.floor(S(a[0]))), Math.max(0, Math.floor(S(a[1])))];
  }
  const filled = (r, c, x) => { const m = new Mat(r, c); if (x !== undefined && x !== 0) m.re.fill(x); return m; };
  const def = (names, fn) => names.split(' ').forEach(n => { L[n] = fn; });
  const defDim = A => A.r !== 1 ? 1 : 2;
  function dimArg(a, k, A) {
    if (a.length > k && !isStr(a[k])) { const d = S(a[k]); if (d !== 1 && d !== 2) { if (d >= 3) return 3; fail('Dimension argument must be a positive integer scalar.'); } return d; }
    return A.r === 0 && A.c === 0 ? 1 : defDim(A);
  }
  // apply f(values[]) → number along dimension
  function reduce(A, dim, f, cls) {
    if (dim === 3) return f === null ? A : M.copy(A);
    if (A.r === 0 && A.c === 0) { const o = num(f([])); if (cls) o.cls = cls; return o; }
    if (dim === 1) { const o = new Mat(1, A.c, null, null, cls); for (let j = 0; j < A.c; j++) o.re[j] = f(A.re.subarray(j * A.r, (j + 1) * A.r)); return o; }
    const o = new Mat(A.r, 1, null, null, cls), tmp = new Float64Array(A.c);
    for (let i = 0; i < A.r; i++) { for (let j = 0; j < A.c; j++) tmp[j] = A.re[i + j * A.r]; o.re[i] = f(tmp); }
    return o;
  }
  // cumulative / shape-preserving along a dimension: f(values[]) → array
  function along(A, dim, f, keepCls) {
    const o = new Mat(A.r, A.c, null, null, keepCls ? A.cls : 'double');
    if (dim === 1) { for (let j = 0; j < A.c; j++) { const r = f(Array.from(A.re.subarray(j * A.r, (j + 1) * A.r))); for (let i = 0; i < A.r; i++) o.re[i + j * A.r] = r[i]; } }
    else { for (let i = 0; i < A.r; i++) { const row = []; for (let j = 0; j < A.c; j++) row.push(A.re[i + j * A.r]); const r = f(row); for (let j = 0; j < A.c; j++) o.re[i + j * A.r] = r[j]; } }
    return o;
  }
  const allFlag = a => a.some(x => isStr(x) && M.toStr(x).toLowerCase() === 'all');
  const flat = A => new Mat(A.n, 1, A.re, A.im, A.cls);

  // ---------- constants ----------
  L.pi = () => num(Math.PI);
  L.e = () => num(Math.E);
  def('Inf inf', a => filled(...dims(a), Infinity));
  def('NaN nan', a => filled(...dims(a), NaN));
  L.eps = a => { if (a.length && !isStr(a[0])) { const x = Math.abs(S(a[0])); if (!isFinite(x)) return num(NaN); if (x === 0) return num(5e-324); const e = Math.floor(Math.log2(x)); return num(Math.pow(2, e - 52)); } return num(LA.EPS); };
  def('i j 1i 1j', () => new Mat(1, 1, Float64Array.of(0), Float64Array.of(1)));
  L.realmax = () => num(Number.MAX_VALUE); L.realmin = () => num(2.2250738585072014e-308);
  L.intmax = () => num(2147483647); L.intmin = () => num(-2147483648); L.flintmax = () => num(9007199254740992);
  L.true = a => { const m = filled(...dims(a), 1); m.cls = 'logical'; return m; };
  L.false = a => { const m = filled(...dims(a)); m.cls = 'logical'; return m; };

  // ---------- constructors ----------
  L.zeros = a => filled(...dims(a, 'zeros'));
  L.ones = a => filled(...dims(a, 'ones'), 1);
  L.eye = a => { const [r, c] = dims(a, 'eye'), m = new Mat(r, c); for (let k = 0; k < Math.min(r, c); k++) m.re[k + k * r] = 1; return m; };
  L.rand = (a, _n, In) => { const [r, c] = dims(a), m = new Mat(r, c); for (let k = 0; k < m.n; k++) m.re[k] = In.rng(); return m; };
  L.randn = (a, _n, In) => { const [r, c] = dims(a), m = new Mat(r, c); for (let k = 0; k < m.n; k++) { let u = 0; while (u === 0) u = In.rng(); m.re[k] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * In.rng()); } return m; };
  L.randi = (a, _n, In) => {
    minArgs(a, 1, 'randi'); const lim = N(a[0]); const lo = lim.n > 1 ? lim.re[0] : 1, hi = lim.n > 1 ? lim.re[1] : lim.re[0];
    const [r, c] = dims(a.slice(1)), m = new Mat(r, c); for (let k = 0; k < m.n; k++) m.re[k] = lo + Math.floor(In.rng() * (hi - lo + 1)); return m;
  };
  L.randperm = (a, _n, In) => { const n = S(a[0]), k = a.length > 1 ? S(a[1]) : n, p = [...Array(n).keys()].map(x => x + 1); for (let i = n - 1; i > 0; i--) { const j = Math.floor(In.rng() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; } return rowOut(p.slice(0, k)); };
  L.rng = (a, _n, In) => { const s = a.length ? (isStr(a[0]) ? (Str(a[0]) === 'shuffle' ? Date.now() : 5489) : S(a[0])) : 5489; In.rng = I.mulberry32(s >>> 0 || 0); };
  L.linspace = a => { minArgs(a, 2, 'linspace'); const x0 = S(a[0]), x1 = S(a[1]), n = a.length > 2 ? Math.floor(S(a[2])) : 100; if (n < 1) return new Mat(1, 0); const o = new Mat(1, n); for (let k = 0; k < n; k++) o.re[k] = n === 1 ? x1 : x0 + (x1 - x0) * k / (n - 1); if (n > 1) { o.re[0] = x0; o.re[n - 1] = x1; } return o; };
  L.logspace = a => { const x0 = S(a[0]), x1 = S(a[1]), n = a.length > 2 ? S(a[2]) : 50, o = new Mat(1, n); for (let k = 0; k < n; k++) o.re[k] = Math.pow(10, n === 1 ? x1 : x0 + (x1 - x0) * k / (n - 1)); return o; };
  L.colon = a => I.colon(S(a[0]), a.length > 2 ? S(a[1]) : 1, S(a[a.length - 1]));
  L.magic = a => {
    const n = Math.floor(S(a[0])); if (n < 1) return M.empty(); if (n === 2) return M.fromRows([[4, 3], [1, 2]]);
    const A = Array.from({ length: n }, () => new Array(n).fill(0));
    if (n % 2 === 1) { // siamese method, MATLAB's orientation
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const ii = i + 1, jj = j + 1; A[i][j] = n * ((ii + jj - 1 + Math.floor(n / 2)) % n) + ((ii + 2 * jj - 2) % n) + 1; }
    } else if (n % 4 === 0) {
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const v = i * n + j + 1, keep = ((i % 4) % 3 === 0) === ((j % 4) % 3 === 0); A[i][j] = keep ? n * n + 1 - v : v; }
    } else { // LUX (singly even), as in MATLAB's magic.m
      const p = n / 2, B = M.toRows(L.magic([num(p)]));
      for (let i = 0; i < p; i++) for (let j = 0; j < p; j++) { const b = B[i][j]; A[i][j] = b; A[i + p][j + p] = b + p * p; A[i][j + p] = b + 2 * p * p; A[i + p][j] = b + 3 * p * p; }
      const k = (n - 2) / 4, cols = [...Array(k).keys()].concat([...Array(k - 1).keys()].map(x => n - k + 1 + x));
      for (let i = 0; i < p; i++) for (const j of cols) { [A[i][j], A[i + p][j]] = [A[i + p][j], A[i][j]]; }
      for (const j of [0, k]) { const i = k; [A[i][j], A[i + p][j]] = [A[i + p][j], A[i][j]]; }
    }
    return M.fromRows(A);
  };
  L.diag = a => {
    const A = N(a[0]), k = a.length > 1 ? S(a[1]) : 0;
    if (A.r === 1 || A.c === 1) { const n = A.n + Math.abs(k), o = new Mat(n, n, null, A.im ? new Float64Array(n * n) : null); for (let t = 0; t < A.n; t++) { const i = k >= 0 ? t : t - k, j = k >= 0 ? t + k : t; o.re[i + j * n] = A.re[t]; if (A.im) o.im[i + j * n] = A.im[t]; } return o; }
    const re = [], im = []; for (let i = Math.max(0, -k); i < A.r && i + k < A.c; i++) { re.push(A.re[i + (i + k) * A.r]); im.push(A.im ? A.im[i + (i + k) * A.r] : 0); }
    return M.narrow(new Mat(re.length, re.length ? 1 : 0, Float64Array.from(re), A.im ? Float64Array.from(im) : null));
  };
  L.repmat = a => {
    const A = a[0]; let [m, n] = a.length === 2 ? (a[1].n === 1 ? [S(a[1]), S(a[1])] : [a[1].re[0], a[1].re[1]]) : [S(a[1]), S(a[2])];
    if (A.type === 'cell') { const o = new Cell(A.r * m, A.c * n); for (let J = 0; J < o.c; J++) for (let i = 0; i < o.r; i++) o.data[i + J * o.r] = A.data[(i % A.r) + (J % A.c) * A.r]; return o; }
    N(A); const o = new Mat(A.r * m, A.c * n, null, A.im ? new Float64Array(A.n * m * n) : null, A.cls);
    for (let J = 0; J < o.c; J++) for (let i = 0; i < o.r; i++) { const s = (i % A.r) + (J % A.c) * A.r; o.re[i + J * o.r] = A.re[s]; if (A.im) o.im[i + J * o.r] = A.im[s]; }
    return o;
  };
  L.reshape = a => {
    const A = a[0]; let r, c;
    if (a.length === 2) { const d = N(a[1]); r = d.re[0]; c = d.re[1]; for (let k = 2; k < d.n; k++) if (d.re[k] !== 1) fail('Lumen Lab supports only two-dimensional arrays.'); }
    else { r = a[1].n ? S(a[1]) : null; c = a[2].n ? S(a[2]) : null; for (let k = 3; k < a.length; k++) if (S(a[k]) !== 1) fail('Lumen Lab supports only two-dimensional arrays.'); }
    if (r === null) r = A.n / c; if (c === null) c = A.n / r;
    if (r * c !== A.n || !Number.isInteger(r) || !Number.isInteger(c)) fail(`Number of elements must not change. Use [] as one of the size inputs to automatically calculate the appropriate size for that dimension.`, 'MATLAB:getReshapeDims:notSameNumel');
    if (A.type === 'cell') return new Cell(r, c, A.data.slice());
    return new Mat(r, c, A.re.slice(), A.im ? A.im.slice() : null, A.cls);
  };
  L.meshgrid = (a, nout) => {
    const x = vec(a[0]), y = a.length > 1 ? vec(a[1]) : x, X = new Mat(y.length, x.length), Y = new Mat(y.length, x.length);
    for (let j = 0; j < x.length; j++) for (let i = 0; i < y.length; i++) { X.re[i + j * y.length] = x[j]; Y.re[i + j * y.length] = y[i]; }
    return [X, Y];
  };
  L.ndgrid = (a) => { const x = vec(a[0]), y = a.length > 1 ? vec(a[1]) : x, X = new Mat(x.length, y.length), Y = new Mat(x.length, y.length); for (let j = 0; j < y.length; j++) for (let i = 0; i < x.length; i++) { X.re[i + j * x.length] = x[i]; Y.re[i + j * x.length] = y[j]; } return [X, Y]; };
  L.horzcat = a => catAny(a, 2); L.vertcat = a => catAny(a, 1);
  L.cat = a => catAny(a.slice(1), S(a[0]));
  function catAny(xs, dim) {
    if (xs.some(x => x.type === 'cell')) return I.cellCat(xs.map(x => x.type === 'cell' ? x : new Cell(1, 1, [x])), dim === 1 ? 'v' : 'h');
    return dim === 1 ? M.vcat(xs.map(x => N(x))) : M.hcat(xs.map(x => N(x)));
  }
  L.fliplr = a => { const A = a[0]; if (A.type === 'cell') return new Cell(A.r, A.c, A.data.map((_, k) => A.data[(k % A.r) + (A.c - 1 - Math.floor(k / A.r)) * A.r])); return permute(A, (i, j) => [i, A.c - 1 - j]); };
  L.flipud = a => { const A = a[0]; if (A.type === 'cell') return new Cell(A.r, A.c, A.data.map((_, k) => A.data[(A.r - 1 - k % A.r) + Math.floor(k / A.r) * A.r])); return permute(A, (i, j) => [A.r - 1 - i, j]); };
  L.flip = a => { const A = a[0], d = a.length > 1 ? S(a[1]) : defDim(A); return d === 1 ? L.flipud([A]) : L.fliplr([A]); };
  function permute(A, f, r = A.r, c = A.c) { // out(i,j) = A(f(i,j))
    N(A); const o = new Mat(r, c, null, A.im ? new Float64Array(r * c) : null, A.cls);
    for (let j = 0; j < c; j++) for (let i = 0; i < r; i++) { const [p, q] = f(i, j), s = p + q * A.r; o.re[i + j * r] = A.re[s]; if (A.im) o.im[i + j * r] = A.im[s]; }
    return o;
  }
  L.rot90 = a => { let A = a[0], k = a.length > 1 ? ((S(a[1]) % 4) + 4) % 4 : 1; for (; k > 0; k--) { const B = A; A = permute(B, (i, j) => [j, B.c - 1 - i], B.c, B.r); } return A; };
  L.circshift = a => {
    const A = N(a[0]), sh = N(a[1]); let sr, sc;
    if (a.length > 2) { const d = S(a[2]); sr = d === 1 ? sh.re[0] : 0; sc = d === 2 ? sh.re[0] : 0; }
    else if (sh.n > 1) { sr = sh.re[0]; sc = sh.re[1]; } else if (A.r === 1) { sr = 0; sc = sh.re[0]; } else { sr = sh.re[0]; sc = 0; }
    const mod = (x, m) => ((x % m) + m) % m;
    return permute(A, (i, j) => [mod(i - sr, A.r), mod(j - sc, A.c)]);
  };
  L.tril = a => { const A = N(a[0]), k = a.length > 1 ? S(a[1]) : 0, o = M.copy(A); for (let j = 0; j < A.c; j++) for (let i = 0; i < A.r; i++) if (j - i > k) { o.re[i + j * A.r] = 0; if (o.im) o.im[i + j * A.r] = 0; } return o; };
  L.triu = a => { const A = N(a[0]), k = a.length > 1 ? S(a[1]) : 0, o = M.copy(A); for (let j = 0; j < A.c; j++) for (let i = 0; i < A.r; i++) if (j - i < k) { o.re[i + j * A.r] = 0; if (o.im) o.im[i + j * A.r] = 0; } return o; };
  L.kron = a => { const A = N(a[0]), B = N(a[1]), o = new Mat(A.r * B.r, A.c * B.c); for (let i = 0; i < A.r; i++) for (let j = 0; j < A.c; j++) for (let p = 0; p < B.r; p++) for (let q = 0; q < B.c; q++) o.re[(i * B.r + p) + (j * B.c + q) * o.r] = A.re[i + j * A.r] * B.re[p + q * B.r]; return o; };
  L.hilb = a => { const n = S(a[0]), o = new Mat(n, n); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) o.re[i + j * n] = 1 / (i + j + 1); return o; };
  L.vander = a => { const v = vec(a[0]), n = v.length, o = new Mat(n, n); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) o.re[i + j * n] = Math.pow(v[i], n - 1 - j); return o; };
  L.toeplitz = a => { const c = vec(a[0]), r = a.length > 1 ? vec(a[1]) : c, o = new Mat(c.length, r.length); for (let i = 0; i < c.length; i++) for (let j = 0; j < r.length; j++) o.re[i + j * c.length] = i >= j ? c[i - j] : r[j - i]; return o; };
  L.peaks = (a, nout) => {
    let X, Y;
    if (a.length >= 2) { X = N(a[0]); Y = N(a[1]); }
    else { const v = a.length && a[0].n > 1 ? vec(a[0]) : null, n = a.length && !v ? S(a[0]) : 49, g = v || Array.from({ length: n }, (_, k) => -3 + 6 * k / (n - 1)); [X, Y] = L.meshgrid([M.rowVec(g)], 2); }
    const Z = new Mat(X.r, X.c);
    for (let k = 0; k < X.n; k++) { const x = X.re[k], y = Y.re[k]; Z.re[k] = 3 * (1 - x) ** 2 * Math.exp(-(x * x) - (y + 1) ** 2) - 10 * (x / 5 - x ** 3 - y ** 5) * Math.exp(-x * x - y * y) - 1 / 3 * Math.exp(-((x + 1) ** 2) - y * y); }
    return nout >= 3 ? [X, Y, Z] : Z;
  };
  L.cell = a => { const [r, c] = dims(a); return new Cell(r, c); };
  L.struct = a => { const s = new Struct(); for (let k = 0; k + 1 < a.length; k += 2) { let v = a[k + 1]; if (v.type === 'cell' && v.n === 1) v = v.data[0]; s.f.set(Str(a[k], 'struct'), v); } return s; };

  // ---------- size & type ----------
  L.size = (a, nout) => {
    const v = a[0], r = v.r, c = v.c;
    if (a.length > 1) { const d = S(a[1]); return num(d === 1 ? r : d === 2 ? c : 1); }
    if (nout <= 1) return rowOut([r, c]);
    const out = [num(r), num(c)]; for (let k = 2; k < nout; k++) out.push(num(1)); return out;
  };
  L.numel = a => num(a[0].n);
  L.length = a => num(a[0].n ? Math.max(a[0].r, a[0].c) : 0);
  L.ndims = () => num(2);
  L.isempty = a => bool(a[0].type === 'struct' || a[0].type === 'func' ? false : a[0].n === 0);
  L.isscalar = a => bool(a[0].n === 1);
  L.isvector = a => bool((a[0].r === 1 || a[0].c === 1) && a[0].n >= 1);
  L.isrow = a => bool(a[0].r === 1); L.iscolumn = a => bool(a[0].c === 1);
  L.ismatrix = () => bool(true); L.issquare = a => bool(a[0].r === a[0].c);
  L.class = a => str(clsOf(a[0]));
  L.isa = a => { const c = Str(a[1]), k = clsOf(a[0]); return bool(c === k || (c === 'numeric' && (k === 'double')) || (c === 'float' && k === 'double')); };
  L.isnumeric = a => bool(isNum(a[0]) && a[0].cls === 'double');
  L.isfloat = L.isnumeric;
  L.isreal = a => bool(isNum(a[0]) && !a[0].im);
  L.islogical = a => bool(isNum(a[0]) && a[0].cls === 'logical');
  L.ischar = a => bool(isNum(a[0]) && a[0].cls === 'char');
  L.isstring = a => bool(false);
  L.iscell = a => bool(a[0].type === 'cell');
  L.isstruct = a => bool(a[0].type === 'struct');
  L.iscellstr = a => bool(a[0].type === 'cell' && a[0].data.every(x => isNum(x) && x.cls === 'char'));
  L.is_function_handle = a => bool(a[0].type === 'func');
  L.isfield = a => { const s = a[0]; if (s.type !== 'struct') return bool(false); if (a[1].type === 'cell') { const o = new Mat(a[1].r, a[1].c, null, null, 'logical'); a[1].data.forEach((x, k) => { o.re[k] = s.f.has(Str(x)) ? 1 : 0; }); return o; } return bool(s.f.has(Str(a[1]))); };
  L.double = a => { const A = N(a[0]); return new Mat(A.r, A.c, A.re.slice(), A.im ? A.im.slice() : null); };
  L.single = L.double;
  def('int8 int16 int32 int64 uint8 uint16 uint32 uint64', a => { const A = N(a[0]); return M.map(A, x => Math.round(x)); });
  L.logical = a => { const A = N(a[0]); for (let k = 0; k < A.n; k++) if (Number.isNaN(A.re[k])) fail("NaN's cannot be converted to logicals."); const o = M.map(A, x => x !== 0 ? 1 : 0); o.cls = 'logical'; return o; };
  L.char = a => {
    if (a.length === 1 && isNum(a[0])) { const A = a[0], o = new Mat(A.r, A.c, A.re.map(x => Math.max(0, Math.round(x))), null, 'char'); return o; }
    const rows = []; for (const x of a) { if (x.type === 'cell') x.data.forEach(y => rows.push(M.toStr(y))); else rows.push(...M.charRows(N(x))); }
    const w = Math.max(0, ...rows.map(s => s.length)); return M.vcat(rows.map(s => str(s.padEnd(w))));
  };
  L.string = a => isNum(a[0]) && a[0].cls !== 'char' ? L.num2str(a) : a[0];

  // ---------- element-wise math ----------
  const C = M.C;
  const unary = (name, f, fc, domain) => { L[name] = a => { minArgs(a, 1, name); const A = N(a[0], name); if (domain && !A.im) { for (let k = 0; k < A.n; k++) if (!domain(A.re[k])) { const Z = new Mat(A.r, A.c, A.re, new Float64Array(A.n)); return M.map(Z, f, fc); } } return M.map(A, f, fc); }; };
  L.abs = a => { const A = N(a[0], 'abs'); if (A.im) { const o = new Mat(A.r, A.c); for (let k = 0; k < A.n; k++) o.re[k] = Math.hypot(A.re[k], A.im[k]); return o; } return M.map(A, Math.abs); };
  unary('sqrt', Math.sqrt, C.sqrt, x => x >= 0 || Number.isNaN(x));
  unary('exp', Math.exp, C.exp);
  unary('log', Math.log, C.log, x => x >= 0 || Number.isNaN(x));
  unary('log2', Math.log2, (x, y) => { const [r, i] = C.log(x, y); return [r / Math.LN2, i / Math.LN2]; }, x => x >= 0 || Number.isNaN(x));
  unary('log10', Math.log10, (x, y) => { const [r, i] = C.log(x, y); return [r / Math.LN10, i / Math.LN10]; }, x => x >= 0 || Number.isNaN(x));
  unary('log1p', Math.log1p); unary('expm1', Math.expm1);
  unary('sin', Math.sin, C.sin); unary('cos', Math.cos, C.cos);
  unary('tan', Math.tan, (x, y) => { const s = C.sin(x, y), c = C.cos(x, y); return C.div(s[0], s[1], c[0], c[1]); });
  unary('asin', Math.asin); unary('acos', Math.acos); unary('atan', Math.atan);
  unary('sinh', Math.sinh); unary('cosh', Math.cosh); unary('tanh', Math.tanh); unary('asinh', Math.asinh); unary('acosh', Math.acosh); unary('atanh', Math.atanh);
  unary('sec', x => 1 / Math.cos(x)); unary('csc', x => 1 / Math.sin(x)); unary('cot', x => 1 / Math.tan(x));
  unary('sind', x => Number.isInteger(x / 180) ? 0 * Math.sign(x) : Math.sin(x * Math.PI / 180)); unary('cosd', x => Number.isInteger((x - 90) / 180) ? 0 : Math.cos(x * Math.PI / 180)); unary('tand', x => Math.tan(x * Math.PI / 180));
  unary('asind', x => Math.asin(x) * 180 / Math.PI); unary('acosd', x => Math.acos(x) * 180 / Math.PI); unary('atand', x => Math.atan(x) * 180 / Math.PI);
  unary('deg2rad', x => x * Math.PI / 180); unary('rad2deg', x => x * 180 / Math.PI);
  unary('floor', Math.floor, (x, y) => [Math.floor(x), Math.floor(y)]); unary('ceil', Math.ceil, (x, y) => [Math.ceil(x), Math.ceil(y)]); unary('fix', Math.trunc, (x, y) => [Math.trunc(x), Math.trunc(y)]);
  const rnd = x => Math.sign(x) * Math.round(Math.abs(x));
  L.round = a => { const A = N(a[0]); if (a.length > 1) { const d = S(a[1]), p = Math.pow(10, d); return M.map(A, x => rnd(x * p) / p); } return M.map(A, rnd, (x, y) => [rnd(x), rnd(y)]); };
  L.sign = a => { const A = N(a[0]); if (A.im) return M.map(A, Math.sign, (x, y) => { const m = Math.hypot(x, y); return m ? [x / m, y / m] : [0, 0]; }); return M.map(A, x => Math.sign(x)); };
  L.real = a => { const A = N(a[0]); return new Mat(A.r, A.c, A.re.slice()); };
  L.imag = a => { const A = N(a[0]); return new Mat(A.r, A.c, A.im ? A.im.slice() : null); };
  L.conj = a => { const A = N(a[0]); return new Mat(A.r, A.c, A.re.slice(), A.im ? A.im.map(x => -x) : null, A.cls); };
  L.angle = a => { const A = N(a[0]), o = new Mat(A.r, A.c); for (let k = 0; k < A.n; k++) o.re[k] = Math.atan2(A.im ? A.im[k] : 0, A.re[k]); return o; };
  L.phase = L.angle;
  L.complex = a => { const re = N(a[0]), im = a.length > 1 ? N(a[1]) : M.zeros(re.r, re.c); const [r, c] = M.bshape(re, im), o = new Mat(r, c, null, new Float64Array(r * c)); const R = M.plus(re, M.times(im, num(0))), J = M.plus(im, M.times(re, num(0))); o.re.set(R.re); o.im.set(J.re); return o; };
  L.isnan = a => asLogical(M.map(N(a[0]), x => Number.isNaN(x) ? 1 : 0));
  L.isinf = a => asLogical(M.map(N(a[0]), x => (x === Infinity || x === -Infinity) ? 1 : 0));
  L.isfinite = a => asLogical(M.map(N(a[0]), x => isFinite(x) ? 1 : 0));
  const bin = (name, f) => { L[name] = a => { minArgs(a, 2, name); return M.ew(N(a[0]), N(a[1]), f); }; };
  bin('atan2', Math.atan2); bin('hypot', Math.hypot);
  bin('mod', (x, y) => y === 0 ? x : (x - Math.floor(x / y) * y)); bin('rem', (x, y) => y === 0 ? NaN : x - Math.trunc(x / y) * y);
  L.rem = a => M.ew(N(a[0]), N(a[1]), (x, y) => y === 0 ? NaN : x - Math.trunc(x / y) * y);
  bin('nthroot', (x, n) => (x < 0 && n % 2 === 1) ? -Math.pow(-x, 1 / n) : Math.pow(x, 1 / n));
  bin('idivide', (x, y) => Math.trunc(x / y));
  L.power = a => M.power(N(a[0]), N(a[1])); L.times = a => M.times(N(a[0]), N(a[1])); L.plus = a => M.plus(N(a[0]), N(a[1])); L.minus = a => M.minus(N(a[0]), N(a[1]));
  L.rdivide = a => M.rdivide(N(a[0]), N(a[1])); L.ldivide = a => M.ldivide(N(a[0]), N(a[1])); L.uminus = a => M.neg(N(a[0]));
  L.mtimes = a => M.mtimes(N(a[0]), N(a[1]));
  L.eq = a => M.eq(N(a[0]), N(a[1])); L.ne = a => M.ne(N(a[0]), N(a[1])); L.lt = a => M.lt(N(a[0]), N(a[1])); L.gt = a => M.gt(N(a[0]), N(a[1])); L.le = a => M.le(N(a[0]), N(a[1])); L.ge = a => M.ge(N(a[0]), N(a[1]));
  L.and = a => M.and(N(a[0]), N(a[1])); L.or = a => M.or(N(a[0]), N(a[1])); L.not = a => M.not(N(a[0]));
  L.xor = a => M.ew(N(a[0]), N(a[1]), (x, y) => ((x !== 0) !== (y !== 0)) ? 1 : 0, null, 'logical');
  L.transpose = a => M.transpose(N(a[0]), false); L.ctranspose = a => M.transpose(N(a[0]), true);
  function gammaFn(x) {
    if (Number.isInteger(x)) { if (x <= 0) return Infinity; if (x < 171) { let r = 1; for (let k = 2; k < x; k++) r *= k; return r; } return Infinity; }
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
    const g = 7, c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    x -= 1; let s = c[0]; for (let k = 1; k < g + 2; k++) s += c[k] / (x + k); const t = x + g + 0.5;
    return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * s;
  }
  unary('gamma', gammaFn);
  unary('gammaln', x => Math.log(gammaFn(x)));
  unary('factorial', x => { if (x < 0 || !Number.isInteger(x)) fail('N must be a matrix of non-negative integers.'); return gammaFn(x + 1); });
  function erf(x) { // Abramowitz–Stegun 7.1.26 is too coarse; use a series / continued fraction with ~1e-15 accuracy
    const ax = Math.abs(x); if (ax > 6) return Math.sign(x);
    if (ax < 2.5) { let s = 0, t = ax, k = 0; const x2 = ax * ax; s = t; while (Math.abs(t) > 1e-17 * Math.abs(s) && k < 200) { k++; t *= -x2 / k; s += t / (2 * k + 1); } return Math.sign(x) * 2 / Math.sqrt(Math.PI) * s; }
    return Math.sign(x) * (1 - erfcCF(ax));
  }
  function erfcCF(x) { let f = 0; for (let k = 60; k >= 1; k--) f = k / 2 / (x + f); return Math.exp(-x * x) / Math.sqrt(Math.PI) / (x + f); }
  unary('erf', erf); unary('erfc', x => x > 2.5 ? erfcCF(x) : 1 - erf(x));
  L.nchoosek = a => { const v = N(a[0]), k = S(a[1]); if (v.n === 1) { const n = v.re[0]; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return num(Math.round(r)); }
    const items = Array.from(v.re), out = []; const rec = (s, acc) => { if (acc.length === k) { out.push(acc.slice()); return; } for (let i = s; i < items.length; i++) { acc.push(items[i]); rec(i + 1, acc); acc.pop(); } }; rec(0, []); return M.fromRows(out.length ? out : [[]]); };
  L.primes = a => { const n = Math.floor(S(a[0])), sv = new Uint8Array(n + 1), out = []; for (let i = 2; i <= n; i++) { if (!sv[i]) { out.push(i); for (let j = i * i; j <= n; j += i) sv[j] = 1; } } return rowOut(out); };
  L.isprime = a => asLogical(M.map(N(a[0]), x => { if (x < 2 || !Number.isInteger(x)) return 0; for (let d = 2; d * d <= x; d++) if (x % d === 0) return 0; return 1; }));
  L.factor = a => { let n = S(a[0]); const out = []; for (let d = 2; d * d <= n; d++) while (n % d === 0) { out.push(d); n /= d; } if (n > 1) out.push(n); return rowOut(out); };
  const gcd2 = (x, y) => { x = Math.abs(x); y = Math.abs(y); while (y) [x, y] = [y, x % y]; return x; };
  bin('gcd', gcd2); bin('lcm', (x, y) => x && y ? Math.abs(x * y) / gcd2(x, y) : 0);
  L.nextpow2 = a => M.map(N(a[0]), x => x === 0 ? 0 : Math.ceil(Math.log2(Math.abs(x))));

  // ---------- reductions ----------
  const sum = v => { let s = 0; for (let k = 0; k < v.length; k++) s += v[k]; return s; };
  L.sum = a => {
    const A = N(a[0], 'sum'); if (allFlag(a)) return L.sum([flat(A)]);
    const dim = dimArg(a, 1, A);
    if (A.im) { const R = reduce(new Mat(A.r, A.c, A.re), dim, sum), J = reduce(new Mat(A.r, A.c, A.im), dim, sum); return M.narrow(new Mat(R.r, R.c, R.re, J.re)); }
    return reduce(A, dim, sum);
  };
  L.prod = a => { const A = N(a[0]); if (allFlag(a)) return L.prod([flat(A)]); return reduce(A, dimArg(a, 1, A), v => { let p = 1; for (const x of v) p *= x; return p; }); };
  L.mean = a => {
    const A = N(a[0], 'mean'); if (allFlag(a)) return L.mean([flat(A)]); const dim = dimArg(a, 1, A);
    if (A.im) { const s = L.sum([A, num(dim)]); const n = dim === 1 ? A.r : A.c; return M.rdivide(s, num(n)); }
    return reduce(A, dim, v => v.length ? sum(v) / v.length : NaN);
  };
  const sorted = v => Array.from(v).sort((x, y) => x - y);
  L.median = a => { const A = N(a[0]); if (allFlag(a)) return L.median([flat(A)]); return reduce(A, dimArg(a, 1, A), v => { if (!v.length) return NaN; if (Array.from(v).some(Number.isNaN)) return NaN; const s = sorted(v), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }); };
  L.mode = a => { const A = N(a[0]); return reduce(A, dimArg(a, 1, A), v => { if (!v.length) return NaN; const s = sorted(v); let best = s[0], bc = 0; for (let i = 0; i < s.length;) { let j = i; while (j < s.length && s[j] === s[i]) j++; if (j - i > bc) { bc = j - i; best = s[i]; } i = j; } return best; }); };
  const variance = (v, w) => { const n = v.length; if (n === 0) return NaN; if (n === 1) return 0; const m = sum(v) / n; let s = 0; for (const x of v) s += (x - m) * (x - m); return s / (w === 1 ? n : n - 1); };
  L.var = a => { const A = N(a[0]); const w = a.length > 1 && a[1].n ? S(a[1]) : 0; return reduce(A, a.length > 2 ? S(a[2]) : (A.r === 0 && A.c === 0 ? 1 : defDim(A)), v => variance(v, w)); };
  L.std = a => M.map(L.var(a), Math.sqrt);
  L.range = a => { const A = N(a[0]); return reduce(A, dimArg(a, 1, A), v => Math.max(...v) - Math.min(...v)); };
  L.cumsum = a => { const A = N(a[0]); return along(A, dimArg(a, 1, A), v => { let s = 0; return v.map(x => (s += x)); }); };
  L.cumprod = a => { const A = N(a[0]); return along(A, dimArg(a, 1, A), v => { let s = 1; return v.map(x => (s *= x)); }); };
  L.cummax = a => { const A = N(a[0]); return along(A, dimArg(a, 1, A), v => { let s = -Infinity; return v.map(x => (s = Math.max(s, x))); }); };
  L.cummin = a => { const A = N(a[0]); return along(A, dimArg(a, 1, A), v => { let s = Infinity; return v.map(x => (s = Math.min(s, x))); }); };
  L.any = a => { const A = N(a[0]); if (allFlag(a)) return L.any([flat(A)]); if (A.r === 0 && A.c === 0) return bool(false); return reduce(A, dimArg(a, 1, A), v => Array.from(v).some(x => x !== 0 && !Number.isNaN(x)) ? 1 : 0, 'logical'); };
  L.all = a => { const A = N(a[0]); if (allFlag(a)) return L.all([flat(A)]); if (A.r === 0 && A.c === 0) return bool(true); return reduce(A, dimArg(a, 1, A), v => Array.from(v).every(x => x !== 0) ? 1 : 0, 'logical'); };
  function minmax(a, nout, isMax, name) {
    const better = isMax ? (x, y) => x > y : (x, y) => x < y;
    if (a.length >= 2 && a[1].n > 0) { // elementwise with a second array
      return M.ew(N(a[0]), N(a[1]), (x, y) => Number.isNaN(x) ? y : Number.isNaN(y) ? x : (better(x, y) ? x : y));
    }
    let A = N(a[0], name); if (allFlag(a)) A = flat(A);
    const dim = a.length > 2 && !isStr(a[2]) ? S(a[2]) : (A.r === 0 && A.c === 0 ? 1 : defDim(A));
    if (A.n === 0) return [M.empty(), M.empty()];
    const vals = A.im ? Float64Array.from(A.re, (x, k) => Math.hypot(x, A.im[k])) : A.re;
    const idx = [];
    const pick = (getter, len) => { let bi = -1, bv = NaN; for (let k = 0; k < len; k++) { const x = getter(k); if (Number.isNaN(x)) continue; if (bi < 0 || better(x, bv)) { bi = k; bv = x; } } if (bi < 0) bi = 0; return bi; };
    let out;
    if (dim === 1) { out = new Mat(1, A.c, null, A.im ? new Float64Array(A.c) : null); for (let j = 0; j < A.c; j++) { const k = pick(i => vals[i + j * A.r], A.r), s = k + j * A.r; out.re[j] = A.re[s]; if (A.im) out.im[j] = A.im[s]; idx.push(k + 1); } }
    else { out = new Mat(A.r, 1, null, A.im ? new Float64Array(A.r) : null); for (let i = 0; i < A.r; i++) { const k = pick(j => vals[i + j * A.r], A.c), s = i + k * A.r; out.re[i] = A.re[s]; if (A.im) out.im[i] = A.im[s]; idx.push(k + 1); } }
    if (A.cls === 'logical' || A.cls === 'char') out.cls = A.cls === 'logical' ? 'logical' : 'double';
    return nout > 1 ? [M.narrow(out), dim === 1 ? rowOut(idx) : colOut(idx)] : M.narrow(out);
  }
  L.max = (a, n) => minmax(a, n, true, 'max'); L.min = (a, n) => minmax(a, n, false, 'min');
  L.bounds = (a) => [minmax([a[0]], 1, false), minmax([a[0]], 1, true)];
  L.dot = a => { const A = N(a[0]), B = N(a[1]); if (A.n !== B.n) fail('A and B must be the same size.'); if (isVecLike(A)) { let s = 0; for (let k = 0; k < A.n; k++) s += A.re[k] * B.re[k]; return num(s); } return L.sum([M.times(A, B)]); };
  const isVecLike = A => A.r === 1 || A.c === 1;
  L.cross = a => { const x = vec(a[0]), y = vec(a[1]); if (x.length !== 3 || y.length !== 3) fail('A and B must be of length 3.'); const r = [x[1] * y[2] - x[2] * y[1], x[2] * y[0] - x[0] * y[2], x[0] * y[1] - x[1] * y[0]]; return a[0].r === 1 ? rowOut(r) : colOut(r); };
  L.diff = a => {
    let A = N(a[0]); const n = a.length > 1 ? S(a[1]) : 1;
    for (let t = 0; t < n; t++) {
      const dim = a.length > 2 ? S(a[2]) : defDim(A);
      if (dim === 1) { const o = new Mat(Math.max(0, A.r - 1), A.c); for (let j = 0; j < A.c; j++) for (let i = 0; i < A.r - 1; i++) o.re[i + j * o.r] = A.re[i + 1 + j * A.r] - A.re[i + j * A.r]; A = o; }
      else { const o = new Mat(A.r, Math.max(0, A.c - 1)); for (let j = 0; j < A.c - 1; j++) for (let i = 0; i < A.r; i++) o.re[i + j * A.r] = A.re[i + (j + 1) * A.r] - A.re[i + j * A.r]; A = o; }
    }
    return A;
  };
  L.trapz = a => {
    let x, Y; if (a.length > 1) { x = vec(a[0]); Y = N(a[1]); } else { Y = N(a[0]); }
    const f = v => { let s = 0; for (let k = 1; k < v.length; k++) s += (x ? x[k] - x[k - 1] : 1) * (v[k] + v[k - 1]) / 2; return s; };
    return reduce(Y, defDim(Y), f);
  };
  L.cumtrapz = a => {
    let x, Y; if (a.length > 1) { x = vec(a[0]); Y = N(a[1]); } else Y = N(a[0]);
    return along(Y, defDim(Y), v => { let s = 0; return v.map((y, k) => k ? (s += (x ? x[k] - x[k - 1] : 1) * (y + v[k - 1]) / 2) : 0); });
  };
  L.gradient = a => { const y = vec(a[0]), h = a.length > 1 ? S(a[1]) : 1, n = y.length, g = y.map((_, k) => n < 2 ? 0 : k === 0 ? (y[1] - y[0]) / h : k === n - 1 ? (y[n - 1] - y[n - 2]) / h : (y[k + 1] - y[k - 1]) / (2 * h)); return like(a[0], g); };
  L.cov = a => {
    const X = a.length > 1 ? M.hcat([flat(N(a[0])), flat(N(a[1]))]) : (N(a[0]).r === 1 ? flat(a[0]) : a[0]);
    const n = X.r, p = X.c, means = []; for (let j = 0; j < p; j++) { let s = 0; for (let i = 0; i < n; i++) s += X.re[i + j * n]; means.push(s / n); }
    const o = new Mat(p, p); for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) { let s = 0; for (let i = 0; i < n; i++) s += (X.re[i + j * n] - means[j]) * (X.re[i + k * n] - means[k]); o.re[j + k * p] = s / (n - 1); }
    return o;
  };
  L.corrcoef = a => { const Cv = L.cov(a), p = Cv.r, o = new Mat(p, p); for (let j = 0; j < p; j++) for (let k = 0; k < p; k++) o.re[j + k * p] = Cv.re[j + k * p] / Math.sqrt(Cv.re[j + j * p] * Cv.re[k + k * p]); return o; };
  L.histcounts = (a, nout) => {
    const x = vec(a[0]).filter(v => isFinite(v)); let edges;
    if (a.length > 1 && a[1].n > 1) edges = vec(a[1]);
    else {
      const nb = a.length > 1 ? S(a[1]) : null, lo = Math.min(...x), hi = Math.max(...x);
      let k = nb || Math.max(1, Math.ceil(Math.sqrt(x.length)));
      if (!nb) { const w0 = 3.5 * Math.sqrt(variance(x, 0)) / Math.cbrt(x.length) || 1, p = Math.pow(10, Math.floor(Math.log10(w0))), w = [1, 2, 2.5, 5, 10].map(m => m * p).find(m => m >= w0) || w0; const s = Math.floor(lo / w) * w; k = Math.max(1, Math.ceil((hi - s) / w)); edges = Array.from({ length: k + 1 }, (_, i) => s + i * w); if (edges[k] < hi) edges.push(edges[k] + w); }
      else edges = Array.from({ length: k + 1 }, (_, i) => hi === lo ? lo - 0.5 + i / k : lo + (hi - lo) * i / k);
    }
    const counts = new Array(edges.length - 1).fill(0);
    for (const v of x) { if (v < edges[0] || v > edges[edges.length - 1]) continue; let b = edges.length - 2; for (let i = 0; i < edges.length - 1; i++) if (v < edges[i + 1]) { b = i; break; } counts[b]++; }
    return [rowOut(counts), rowOut(edges)];
  };
  L.histc = a => { const x = vec(a[0]), e = vec(a[1]), c = new Array(e.length).fill(0); for (const v of x) { for (let i = e.length - 1; i >= 0; i--) if (v >= e[i]) { if (i === e.length - 1 && v !== e[i]) break; c[i]++; break; } } return like(a[1], c); };
  L.accumarray = a => { const s = vec(a[0]), v = a[1].n === 1 ? s.map(() => a[1].re[0]) : vec(a[1]), n = Math.max(0, ...s), o = new Mat(n, 1); s.forEach((k, i) => { o.re[k - 1] += v[i]; }); return o; };

  // ---------- find, sort, sets ----------
  L.find = (a, nout) => {
    const A = N(a[0]), lim = a.length > 1 ? S(a[1]) : Infinity, last = a.length > 2 && Str(a[2]) === 'last';
    let ks = []; for (let k = 0; k < A.n; k++) if (A.re[k] !== 0 || (A.im && A.im[k] !== 0)) ks.push(k);
    if (ks.length > lim) ks = last ? ks.slice(ks.length - lim) : ks.slice(0, lim);
    const shape = arr => A.r === 1 && A.c !== 1 ? rowOut(arr) : colOut(arr);
    if (nout <= 1) return shape(ks.map(k => k + 1));
    const out = [shape(ks.map(k => k % A.r + 1)), shape(ks.map(k => Math.floor(k / A.r) + 1))];
    if (nout > 2) out.push(shape(ks.map(k => A.re[k])));
    return out;
  };
  L.issorted = a => { const v = vec(a[0]); for (let k = 1; k < v.length; k++) if (v[k] < v[k - 1]) return bool(false); return bool(true); };
  function same(x, y) {
    if (x.type !== y.type) return false;
    if (x.type === 'num') { if (x.r !== y.r || x.c !== y.c) return false; for (let k = 0; k < x.n; k++) if (x.re[k] !== y.re[k] || (x.im ? x.im[k] : 0) !== (y.im ? y.im[k] : 0)) return false; return true; }
    if (x.type === 'cell') return x.r === y.r && x.c === y.c && x.data.every((v, k) => same(v, y.data[k]));
    if (x.type === 'struct') return x.f.size === y.f.size && [...x.f].every(([k, v]) => y.f.has(k) && same(v, y.f.get(k)));
    return x.src === y.src;
  }
  L.isequal = a => { minArgs(a, 2, 'isequal'); return bool(a.slice(1).every(y => same(a[0], y))); };
  L.nnz = a => { const A = N(a[0]); let c = 0; for (let k = 0; k < A.n; k++) if (A.re[k] !== 0) c++; return num(c); };
  const cmpAsc = (x, y) => Number.isNaN(x) ? (Number.isNaN(y) ? 0 : 1) : Number.isNaN(y) ? -1 : x - y;
  L.sort = (a, nout) => {
    const A = a[0], desc = a.slice(1).some(x => isStr(x) && /^desc/i.test(Str(x)));
    if (A.type === 'cell') { const ss = A.data.map((x, k) => [Str(x), k]).sort((p, q) => p[0] < q[0] ? -1 : p[0] > q[0] ? 1 : p[1] - q[1]); if (desc) ss.reverse(); const o = new Cell(A.r, A.c, ss.map(p => A.data[p[1]])); return nout > 1 ? [o, like(A.r === 1 ? M.rowVec([0]) : M.colVec([0]), ss.map(p => p[1] + 1))] : o; }
    N(A); const dim = a.length > 1 && !isStr(a[1]) ? S(a[1]) : defDim(A);
    const I2 = new Mat(A.r, A.c), O = new Mat(A.r, A.c, null, null, A.cls);
    const doVec = (get, set, len) => { const idx = [...Array(len).keys()], v = idx.map(get); idx.sort((p, q) => { const c = desc ? -cmpAsc(v[p], v[q]) : cmpAsc(v[p], v[q]); if (desc && Number.isNaN(v[p]) !== Number.isNaN(v[q])) return Number.isNaN(v[p]) ? -1 : 1; return c || p - q; }); idx.forEach((p, k) => set(k, v[p], p + 1)); };
    if (dim === 1) for (let j = 0; j < A.c; j++) doVec(i => A.re[i + j * A.r], (k, x, p) => { O.re[k + j * A.r] = x; I2.re[k + j * A.r] = p; }, A.r);
    else for (let i = 0; i < A.r; i++) doVec(j => A.re[i + j * A.r], (k, x, p) => { O.re[i + k * A.r] = x; I2.re[i + k * A.r] = p; }, A.c);
    return nout > 1 ? [O, I2] : O;
  };
  L.sortrows = (a, nout) => {
    const A = N(a[0]); let cols = a.length > 1 ? vec(a[1]) : [...Array(A.c).keys()].map(c => c + 1);
    const rows = [...Array(A.r).keys()];
    rows.sort((p, q) => { for (const c of cols) { const j = Math.abs(c) - 1, d = A.re[p + j * A.r] - A.re[q + j * A.r]; if (d) return c < 0 ? -d : d; } return p - q; });
    const O = new Mat(A.r, A.c); rows.forEach((p, i) => { for (let j = 0; j < A.c; j++) O.re[i + j * A.r] = A.re[p + j * A.r]; });
    return nout > 1 ? [O, colOut(rows.map(p => p + 1))] : O;
  };
  L.unique = (a, nout) => {
    const A = a[0], stable = a.slice(1).some(x => isStr(x) && Str(x) === 'stable');
    if (A.type === 'cell') {
      const strs = A.data.map(x => Str(x)), firsts = new Map(); strs.forEach((s, k) => { if (!firsts.has(s)) firsts.set(s, k); });
      let keys = [...firsts.keys()]; if (!stable) keys.sort();
      const o = new Cell(A.r === 1 ? 1 : keys.length, A.r === 1 ? keys.length : 1, keys.map(s => str(s)));
      return nout > 1 ? [o, colOut(keys.map(s => firsts.get(s) + 1)), colOut(strs.map(s => keys.indexOf(s) + 1))] : o;
    }
    N(A); const firsts = new Map(); for (let k = 0; k < A.n; k++) { const v = A.re[k]; if (!firsts.has(v) || Number.isNaN(v)) firsts.set(Number.isNaN(v) ? 'nan' + k : v, k); }
    let ks = [...firsts.entries()]; if (!stable) ks.sort((p, q) => cmpAsc(A.re[p[1]], A.re[q[1]]));
    const vals = ks.map(p => A.re[p[1]]), o = A.r === 1 ? rowOut(vals) : colOut(vals); o.cls = A.cls === 'char' ? 'char' : A.cls === 'logical' ? 'logical' : 'double';
    if (nout <= 1) return o;
    const pos = new Map(ks.map((p, i) => [p[0], i + 1]));
    return [o, colOut(ks.map(p => p[1] + 1)), colOut(Array.from(A.re, v => pos.get(v) || 0))];
  };
  L.ismember = (a, nout) => {
    const A = a[0], B = a[1];
    if (B.type === 'cell') {
      const set = B.data.map(x => Str(x));
      if (A.type === 'cell') { const o = new Mat(A.r, A.c, null, null, 'logical'), loc = new Mat(A.r, A.c); A.data.forEach((x, k) => { const i = set.indexOf(Str(x)); o.re[k] = i >= 0 ? 1 : 0; loc.re[k] = i + 1; }); return nout > 1 ? [o, loc] : o; }
      const i = set.indexOf(Str(A)); return nout > 1 ? [bool(i >= 0), num(i + 1)] : bool(i >= 0);
    }
    N(A); N(B); const pos = new Map(); for (let k = B.n - 1; k >= 0; k--) pos.set(B.re[k], k + 1);
    const o = new Mat(A.r, A.c, null, null, 'logical'), loc = new Mat(A.r, A.c);
    for (let k = 0; k < A.n; k++) { const p = pos.get(A.re[k]); o.re[k] = p ? 1 : 0; loc.re[k] = p || 0; }
    return nout > 1 ? [o, loc] : o;
  };
  const setop = f => a => { const x = Array.from(N(a[0]).re), y = Array.from(N(a[1]).re); const out = [...new Set(f(x, new Set(y), new Set(x)))].sort(cmpAsc); return (a[0].c === 1 && a[0].r > 1) || (a[1].c === 1 && a[1].r > 1 && a[0].n <= 1) ? colOut(out) : rowOut(out); };
  L.intersect = setop((x, Y) => x.filter(v => Y.has(v)));
  L.union = a => { const x = Array.from(N(a[0]).re), y = Array.from(N(a[1]).re), out = [...new Set(x.concat(y))].sort(cmpAsc); return (a[0].c === 1 && a[0].r > 1) ? colOut(out) : rowOut(out); };
  L.setdiff = setop((x, Y) => x.filter(v => !Y.has(v)));

  // ---------- linear algebra ----------
  const warnIf = (In, w) => { if (w) In.warn(w); };
  L.mldivide = (a, _n, In) => { const A = N(a[0]), B = N(a[1]); if (A.n === 1) return M.ldivide(A, B); const r = LA.solve(A, B); warnIf(In, r.warn); return r.X; };
  L.mrdivide = (a, _n, In) => { const A = N(a[0]), B = N(a[1]); if (B.n === 1) return M.rdivide(A, B); const r = LA.solve(M.transpose(B), M.transpose(A)); warnIf(In, r.warn); return M.transpose(r.X); };
  L.linsolve = L.mldivide;
  L.mpower = (a, _n, In) => {
    const A = N(a[0]), B = N(a[1]);
    if (A.n === 1 && B.n === 1) return M.power(A, B);
    if (B.n === 1) {
      if (A.r !== A.c) fail('Incorrect dimensions for raising a matrix to a power. Check that the matrix is square and the power is a scalar. To operate on each element of the matrix individually, use POWER (.^) for elementwise power.');
      let p = B.re[0];
      if (!Number.isInteger(p)) { const { vals, V } = LA.eig(A, true); const D = new Mat(A.r, A.r, null, new Float64Array(A.n)); vals.re.forEach((x, k) => { const [r, i] = M.C.pow(x, vals.im ? vals.im[k] : 0, p, 0); D.re[k + k * A.r] = r; D.im[k + k * A.r] = i; }); return M.mtimes(M.mtimes(V, D), L.inv([V], 1, In)); }
      let base = A; if (p < 0) { base = L.inv([A], 1, In); p = -p; }
      let R = L.eye([num(A.r)]); while (p > 0) { if (p & 1) R = M.mtimes(R, base); base = M.mtimes(base, base); p = Math.floor(p / 2); } return R;
    }
    if (A.n === 1) { return M.mtimes(M.mtimes(...(() => { const { vals, V } = LA.eig(B, true); const D = new Mat(B.r, B.r); vals.re.forEach((x, k) => { D.re[k + k * B.r] = Math.pow(A.re[0], x); }); return [V, D]; })()), L.inv([LA.eig(B, true).V], 1, In)); }
    fail('Incorrect dimensions for raising a matrix to a power.');
  };
  L.inv = (a, _n, In) => { const A = N(a[0]); if (A.r !== A.c) fail('Matrix must be square.', 'MATLAB:square'); const r = LA.inv(A); warnIf(In, r.warn); return r.X; };
  L.det = a => num(LA.det(N(a[0])));
  L.trace = a => { const A = N(a[0]); let s = 0; for (let k = 0; k < Math.min(A.r, A.c); k++) s += A.re[k + k * A.r]; return num(s); };
  L.eig = (a, nout) => {
    const A = N(a[0], 'eig');
    if (a.length > 1 && !isStr(a[1])) { // generalized: eig(A,B) = eig(B\A)
      const r = LA.solve(N(a[1]), A); return L.eig([r.X], nout);
    }
    const { vals, V } = LA.eig(A, nout > 1);
    if (nout <= 1) return M.narrow(new Mat(vals.re.length, 1, Float64Array.from(vals.re), vals.im ? Float64Array.from(vals.im) : null));
    const n = A.r, D = new Mat(n, n, null, vals.im ? new Float64Array(n * n) : null);
    vals.re.forEach((x, k) => { D.re[k + k * n] = x; if (vals.im) D.im[k + k * n] = vals.im[k]; });
    return [V, D];
  };
  L.svd = (a, nout) => {
    const A = N(a[0], 'svd'), econ = a.length > 1;
    const { U, s, V } = LA.svd(A, !econ && nout > 1);
    if (nout <= 1) return colOut(s);
    const k = s.length, Sr = econ ? Math.min(A.r, A.c) : A.r, Sc = econ ? Math.min(A.r, A.c) : A.c, Sm = new Mat(Sr, Sc);
    for (let i = 0; i < k && i < Sr && i < Sc; i++) Sm.re[i + i * Sr] = s[i];
    let Vm = V; if (econ && V.c > k) Vm = new Mat(V.r, k, V.re.slice(0, V.r * k));
    let Um = U; if (econ && U.c > k) Um = new Mat(U.r, k, U.re.slice(0, U.r * k));
    return [Um, Sm, Vm];
  };
  L.lu = (a, nout) => { const f = LA.luFactors(N(a[0])); if (nout <= 2) return [M.mtimes(M.transpose(f.P), f.L), f.U]; return [f.L, f.U, f.P]; };
  L.qr = (a, nout) => { const econ = a.length > 1; const { Q, R } = LA.qr(N(a[0]), econ); return nout <= 1 ? R : [Q, R]; };
  L.chol = a => LA.chol(N(a[0]));
  L.expm = a => LA.expm(N(a[0]));
  const svals = A => LA.svd(A, false).s;
  L.rank = a => { const A = N(a[0]); if (!A.n) return num(0); const s = svals(A), tol = a.length > 1 ? S(a[1]) : Math.max(A.r, A.c) * (s[0] || 0) * LA.EPS; return num(s.filter(x => x > tol).length); };
  L.norm = a => {
    const A = N(a[0]); const p = a.length > 1 ? (isStr(a[1]) ? Str(a[1]) : S(a[1])) : 2;
    const absv = k => A.im ? Math.hypot(A.re[k], A.im[k]) : Math.abs(A.re[k]);
    if (A.r === 1 || A.c === 1 || A.n === 0) {
      if (p === Infinity || p === 'inf' || p === 'Inf') { let m = 0; for (let k = 0; k < A.n; k++) m = Math.max(m, absv(k)); return num(m); }
      if (p === -Infinity) { let m = Infinity; for (let k = 0; k < A.n; k++) m = Math.min(m, absv(k)); return num(m); }
      const q = p === 'fro' ? 2 : p; if (q === 1) { let s = 0; for (let k = 0; k < A.n; k++) s += absv(k); return num(s); }
      let s = 0, mx = 0; for (let k = 0; k < A.n; k++) mx = Math.max(mx, absv(k)); if (!mx) return num(0);
      for (let k = 0; k < A.n; k++) s += Math.pow(absv(k) / mx, q); return num(mx * Math.pow(s, 1 / q));
    }
    if (p === 'fro') { let s = 0; for (let k = 0; k < A.n; k++) s += absv(k) ** 2; return num(Math.sqrt(s)); }
    if (p === 1) { let m = 0; for (let j = 0; j < A.c; j++) { let s = 0; for (let i = 0; i < A.r; i++) s += absv(i + j * A.r); m = Math.max(m, s); } return num(m); }
    if (p === Infinity || p === 'inf') { let m = 0; for (let i = 0; i < A.r; i++) { let s = 0; for (let j = 0; j < A.c; j++) s += absv(i + j * A.r); m = Math.max(m, s); } return num(m); }
    return num(svals(A)[0]);
  };
  L.rcond = a => num(LA.rcond(N(a[0])));
  L.cond = a => { const s = svals(N(a[0])); return num(s[0] / s[s.length - 1]); };
  L.pinv = a => {
    const A = N(a[0]), { U, s, V } = LA.svd(A, false), tol = a.length > 1 ? S(a[1]) : Math.max(A.r, A.c) * (s[0] || 0) * LA.EPS;
    const k = s.length, Sp = new Mat(k, k); s.forEach((x, i) => { Sp.re[i + i * k] = x > tol ? 1 / x : 0; });
    const Uk = new Mat(U.r, k, U.re.slice(0, U.r * k));
    return M.mtimes(M.mtimes(V, Sp), M.transpose(Uk));
  };
  L.null = a => {
    const A = N(a[0]); const { s, V } = LA.svd(A.r < A.c ? M.vcat([A, new Mat(A.c - A.r, A.c)]) : A, false);
    const tol = Math.max(A.r, A.c) * (s[0] || 0) * LA.EPS, r = s.filter(x => x > tol).length, n = A.c;
    const o = new Mat(n, n - r); for (let j = r; j < n; j++) for (let i = 0; i < n; i++) o.re[i + (j - r) * n] = V.re[i + j * n]; return o;
  };
  L.orth = a => { const A = N(a[0]), { U, s } = LA.svd(A, false), tol = Math.max(A.r, A.c) * (s[0] || 0) * LA.EPS, r = s.filter(x => x > tol).length; return new Mat(U.r, r, U.re.slice(0, U.r * r)); };

  // ---------- strings & printf ----------
  function unescape(s) { return s.replace(/\\(n|t|r|a|b|f|v|\\|x[0-9a-fA-F]{1,2}|[0-7]{1,3})/g, (m, c) => ({ n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', '\\': '\\' })[c] || (c[0] === 'x' ? String.fromCharCode(parseInt(c.slice(1), 16)) : String.fromCharCode(parseInt(c, 8)))); }
  function fmtG(x, prec, alt, upper) {
    if (!isFinite(x)) return Number.isNaN(x) ? 'NaN' : (x > 0 ? 'Inf' : '-Inf');
    const p = prec === 0 ? 1 : prec;
    if (x === 0) return '0';
    const e = Math.floor(Math.log10(Math.abs(x)));
    let s; const ee = Number(Math.abs(x).toExponential(p - 1).split('e')[1]);
    if (ee < -4 || ee >= p) { s = x.toExponential(p - 1); if (!alt) s = s.replace(/\.?0+e/, 'e'); s = s.replace(/e([+-])(\d)$/, 'e$10$2'); }
    else { s = x.toFixed(Math.max(0, p - 1 - ee)); if (!alt && s.includes('.')) s = s.replace(/\.?0+$/, ''); }
    void e; return upper ? s.toUpperCase() : s;
  }
  function sprintf(fmtStr, args) {
    const fmt = unescape(fmtStr);
    const items = [];
    for (const v of args) {
      if (v.type === 'cell') fail('sprintf: cell array arguments are not supported; use c{:}.');
      if (v.type !== 'num') fail('sprintf: unsupported argument type ' + clsOf(v));
      if (v.cls === 'char') items.push({ s: M.toStr(v) }); else for (let k = 0; k < v.n; k++) items.push(v.re[k]);
    }
    const re = /%(%|([-+ 0#]*)(\*|\d+)?(?:\.(\*|\d+))?([diouxXfFeEgGcs]))/g;
    let out = '', pos = 0;
    const take = () => pos < items.length ? items[pos++] : undefined;
    const fmtOne = (flags, width, prec, conv) => {
      if (width === '*') width = take(); if (prec === '*') prec = take();
      let v = take(); if (v === undefined) return '';
      let s;
      if (conv === 's' || conv === 'c') {
        if (typeof v === 'object') s = prec != null && conv === 's' ? v.s.slice(0, +prec) : v.s;
        else if (Number.isInteger(v) && v >= 0) s = String.fromCharCode(v);
        else s = v.toExponential(6).replace(/e([+-])(\d)$/, 'e$10$2');
      } else {
        if (typeof v === 'object') { // text consumed by a numeric conversion: use its character codes
          const codes = [...v.s].map(ch => ch.charCodeAt(0)); items.splice(pos, 0, ...codes.slice(1)); v = codes[0]; if (v === undefined) return '';
        }
        if ('diuoxX'.includes(conv) && !Number.isInteger(v) && isFinite(v)) conv = 'e';
        const p = prec != null ? +prec : 6;
        if (!isFinite(v)) s = Number.isNaN(v) ? 'NaN' : (v > 0 ? 'Inf' : '-Inf');
        else switch (conv) {
          case 'd': case 'i': case 'u': s = String(Math.abs(v)); if (v < 0) s = '-' + s; break;
          case 'o': s = Math.abs(v).toString(8); break;
          case 'x': s = Math.abs(v).toString(16); break; case 'X': s = Math.abs(v).toString(16).toUpperCase(); break;
          case 'f': case 'F': s = v.toFixed(p); break;
          case 'e': case 'E': s = v.toExponential(p).replace(/e([+-])(\d)$/, 'e$10$2'); if (conv === 'E') s = s.toUpperCase(); break;
          case 'g': case 'G': s = fmtG(v, p, flags.includes('#'), conv === 'G'); break;
        }
        if (isFinite(v) && v >= 0 && flags.includes('+')) s = '+' + s; else if (isFinite(v) && v >= 0 && flags.includes(' ')) s = ' ' + s;
      }
      const w = width != null ? +width : 0;
      if (s.length < w) {
        if (flags.includes('-')) s = s.padEnd(w);
        else if (flags.includes('0') && conv !== 's' && conv !== 'c') { const sign = /^[+\- ]/.test(s) ? s[0] : ''; s = sign + s.slice(sign.length).padStart(w - sign.length, '0'); }
        else s = s.padStart(w);
      }
      return s;
    };
    let lastSpecEnd = 0, m; re.lastIndex = 0;
    while ((m = re.exec(fmt))) if (m[1] !== '%') lastSpecEnd = re.lastIndex;
    const hasSpec = lastSpecEnd > 0; let mark = 0;
    do {
      let last = 0; re.lastIndex = 0;
      while ((m = re.exec(fmt))) {
        out += fmt.slice(last, m.index); last = re.lastIndex;
        if (m[1] === '%') { out += '%'; continue; }
        if (items.length && pos >= items.length) { return out.slice(0, mark) + fmt.slice(lastSpecEnd).replace(/%%/g, '%'); }
        out += fmtOne(m[2], m[3], m[4], m[5]); mark = out.length;
      }
      out += fmt.slice(last);
    } while (hasSpec && pos < items.length);
    return out;
  }
  L.sprintf = a => { minArgs(a, 1, 'sprintf'); return str(sprintf(Str(a[0], 'sprintf'), a.slice(1))); };
  L.fprintf = (a, _n, In) => {
    if (!a.length) return; let args = a;
    if (isNum(args[0]) && args[0].cls !== 'char' && args[0].n === 1 && (args[0].re[0] === 1 || args[0].re[0] === 2) && args.length > 1) args = args.slice(1);
    const s = sprintf(Str(args[0], 'fprintf'), args.slice(1)); In.print(s);
  };
  L.disp = (a, _n, In) => {
    const v = a[0]; if (!v) return;
    if (isNum(v)) {
      if (v.cls === 'char') { In.print(M.charRows(v).join('\n') + '\n'); return; }
      if (v.n === 0) return;
      if (v.n === 1) { In.print(M.scalarText(v.re[0], v.im ? v.im[0] : null).replace(/^/, v.cls === 'logical' ? '   ' : '    ') + '\n'); return; }
      const t = In.displayText('x', v); In.print(t.replace(/^x =\n/, '')); return;
    }
    In.print(In.displayText('x', v).replace(/^x =\s*\n/, ''));
  };
  L.display = (a, _n, In) => In.display('ans', a[0]);
  function num2str(v, arg) {
    if (isNum(v) && v.cls === 'char') return M.toStr(v);
    N(v);
    if (arg && isStr(arg)) return M.charRows(L.sprintf([arg, v]))[0] || '';
    const one = x => {
      if (Number.isNaN(x)) return 'NaN'; if (!isFinite(x)) return x > 0 ? 'Inf' : '-Inf';
      if (arg) return fmtG(x, S(arg));
      if (Number.isInteger(x)) return String(x);
      const d = Math.max(Math.floor(Math.log10(Math.abs(x))) + 1, 1) + 4; return fmtG(x, d);
    };
    const cplx = (k) => { const r = one(v.re[k]), im = v.im ? v.im[k] : 0; return v.im ? `${r}${im < 0 ? '-' : '+'}${one(Math.abs(im))}i` : r; };
    if (v.n === 1) return cplx(0);
    const rows = []; for (let i = 0; i < v.r; i++) { const cells = []; for (let j = 0; j < v.c; j++) cells.push(cplx(i + j * v.r)); rows.push(cells); }
    const w = Math.max(...rows.flat().map(s => s.length));
    const lines = rows.map(r => r.map(s => s.padStart(w)).join('  '));
    return lines.join('\n');
  }
  L.num2str = a => { const s = num2str(a[0], a[1]); return s.includes('\n') ? M.vcat(s.split('\n').map(x => str(x))) : str(s); };
  L.int2str = a => L.num2str([M.map(N(a[0]), rnd)]);
  L.mat2str = a => {
    const A = N(a[0]), p = a.length > 1 ? S(a[1]) : 15, f = x => Number.isNaN(x) ? 'NaN' : !isFinite(x) ? (x > 0 ? 'Inf' : '-Inf') : fmtG(x, p);
    if (A.cls === 'char') return str(`'${M.toStr(A)}'`);
    const el = k => A.im ? `${f(A.re[k])}${A.im[k] < 0 ? '-' : '+'}${f(Math.abs(A.im[k]))}i` : (A.cls === 'logical' ? (A.re[k] ? 'true' : 'false') : f(A.re[k]));
    if (A.n === 1) return str(el(0));
    const rows = []; for (let i = 0; i < A.r; i++) { const r = []; for (let j = 0; j < A.c; j++) r.push(el(i + j * A.r)); rows.push(r.join(' ')); }
    return str('[' + rows.join(';') + ']');
  };
  L.str2double = a => { if (a[0].type === 'cell') { const o = new Mat(a[0].r, a[0].c); a[0].data.forEach((x, k) => { o.re[k] = parseNum(isStr(x) ? Str(x) : ''); }); return o; } return num(isNum(a[0]) && a[0].cls === 'char' ? parseNum(Str(a[0])) : NaN); };
  const parseNum = s => { s = s.trim().replace(/,/g, ''); if (/^[-+]?inf$/i.test(s)) return s[0] === '-' ? -Infinity : Infinity; if (/^nan$/i.test(s)) return NaN; return /^[-+]?(\d+\.?\d*|\.\d+)([eEdD][-+]?\d+)?$/.test(s) ? parseFloat(s.replace(/[dD]/, 'e')) : NaN; };
  L.str2num = (a, _n, In) => { const s = Str(a[0]); try { const r = In.evalString('[' + s + ']'); return r; } catch (e) { return M.empty(); } };
  L.upper = a => strMap(a[0], s => s.toUpperCase()); L.lower = a => strMap(a[0], s => s.toLowerCase());
  L.strtrim = a => strMap(a[0], s => s.replace(/^[\s\0]+|[\s\0]+$/g, ''));
  L.deblank = a => strMap(a[0], s => s.replace(/[\s\0]+$/, ''));
  function strMap(v, f) { if (v.type === 'cell') return new Cell(v.r, v.c, v.data.map(x => str(f(Str(x))))); return str(f(Str(v))); }
  L.strcat = a => {
    if (a.some(x => x.type === 'cell')) { const n = Math.max(...a.map(x => x.type === 'cell' ? x.n : 1)); const ref = a.find(x => x.type === 'cell'); return new Cell(ref.r, ref.c, Array.from({ length: n }, (_, k) => str(a.map(x => x.type === 'cell' ? Str(x.data[x.n === 1 ? 0 : k]) : Str(x)).join('')))); }
    return str(a.map(x => isNum(x) && x.cls === 'char' ? Str(x).replace(/\s+$/, '') : Str(x)).join(''));
  };
  L.strjoin = a => { const c = a[0]; if (c.type !== 'cell') fail('strjoin: first input must be a cell array of character vectors.'); return str(c.data.map(x => Str(x)).join(a.length > 1 ? unescape(Str(a[1])) : ' ')); };
  L.strsplit = a => { const s = Str(a[0]); let parts; if (a.length > 1) { const d = a[1].type === 'cell' ? a[1].data.map(x => unescape(Str(x))) : [unescape(Str(a[1]))]; parts = s.split(new RegExp(d.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'))); } else parts = s.split(/\s+/); return new Cell(1, parts.length, parts.map(p => str(p))); };
  L.strrep = a => strMap(a[0], s => s.split(Str(a[1])).join(Str(a[2])));
  const cmpStr = (a, f) => { const [x, y] = a; if (x.type === 'cell' || y.type === 'cell') { const ref = x.type === 'cell' ? x : y, o = new Mat(ref.r, ref.c, null, null, 'logical'); for (let k = 0; k < ref.n; k++) { const p = x.type === 'cell' ? x.data[x.n === 1 ? 0 : k] : x, q = y.type === 'cell' ? y.data[y.n === 1 ? 0 : k] : y; o.re[k] = isNum(p) && p.cls === 'char' && isNum(q) && q.cls === 'char' && f(Str(p), Str(q)) ? 1 : 0; } return o; } return bool(isNum(x) && x.cls === 'char' && isNum(y) && y.cls === 'char' && x.r === y.r && f(Str(x), Str(y))); };
  L.strcmp = a => cmpStr(a, (p, q) => p === q); L.strcmpi = a => cmpStr(a, (p, q) => p.toLowerCase() === q.toLowerCase());
  L.strncmp = a => { const n = S(a[2]); return cmpStr(a, (p, q) => p.length >= n && q.length >= n && p.slice(0, n) === q.slice(0, n)); };
  L.strncmpi = a => { const n = S(a[2]); return cmpStr(a, (p, q) => p.length >= n && q.length >= n && p.slice(0, n).toLowerCase() === q.slice(0, n).toLowerCase()); };
  L.strfind = a => { const s = Str(a[0]), p = Str(a[1]), out = []; if (p.length) for (let k = s.indexOf(p); k >= 0; k = s.indexOf(p, k + 1)) out.push(k + 1); return out.length ? rowOut(out) : new Mat(1, 0); };
  L.contains = a => { const p = Str(a[1]); return a[0].type === 'cell' ? asLogical(new Mat(a[0].r, a[0].c, Float64Array.from(a[0].data, x => Str(x).includes(p) ? 1 : 0))) : bool(Str(a[0]).includes(p)); };
  L.startsWith = a => bool(Str(a[0]).startsWith(Str(a[1]))); L.endsWith = a => bool(Str(a[0]).endsWith(Str(a[1])));
  L.blanks = a => str(' '.repeat(S(a[0])));
  L.newline = () => str('\n');
  L.isspace = a => asLogical(M.map(N(a[0]), c => /\s/.test(String.fromCharCode(c)) ? 1 : 0));
  L.isletter = a => asLogical(M.map(N(a[0]), c => /[A-Za-z]/.test(String.fromCharCode(c)) ? 1 : 0));
  L.isdigit = a => asLogical(M.map(N(a[0]), c => c >= 48 && c <= 57 ? 1 : 0));
  L.regexprep = a => strMap(a[0], s => s.replace(new RegExp(Str(a[1]), a.slice(3).some(x => isStr(x) && Str(x) === 'ignorecase') ? 'gi' : 'g'), Str(a[2]).replace(/\$(\d)/g, '$$$1')));
  L.regexp = (a, nout) => {
    const s = Str(a[0]), re = new RegExp(Str(a[1]), 'g'), opts = a.slice(2).filter(isStr).map(Str), once = opts.includes('once');
    const ms = [...s.matchAll(re)];
    const make = kind => {
      if (kind === 'match') return once ? str(ms[0] ? ms[0][0] : '') : new Cell(1, ms.length, ms.map(m => str(m[0])));
      if (kind === 'tokens') { const tk = m => new Cell(1, m.length - 1, m.slice(1).map(x => str(x || ''))); return once ? (ms[0] ? tk(ms[0]) : new Cell(0, 0, [])) : new Cell(1, ms.length, ms.map(tk)); }
      if (kind === 'names') { const st = new Struct(); const g = ms[0] && ms[0].groups; if (g) for (const k in g) st.f.set(k, str(g[k] || '')); return st; }
      if (kind === 'split') { const parts = s.split(new RegExp(Str(a[1]))); return new Cell(1, parts.length, parts.map(x => str(x))); }
      if (kind === 'start') return once ? (ms[0] ? num(ms[0].index + 1) : M.empty()) : rowOut(ms.map(m => m.index + 1));
      if (kind === 'end') return once ? (ms[0] ? num(ms[0].index + ms[0][0].length) : M.empty()) : rowOut(ms.map(m => m.index + m[0].length));
    };
    const kinds = opts.filter(o => ['match', 'tokens', 'names', 'split', 'start', 'end'].includes(o));
    if (kinds.length) return kinds.map(make);
    return ['start', 'end', 'tokenExtents', 'match', 'tokens', 'names', 'split'].slice(0, Math.max(1, nout)).map(k => k === 'tokenExtents' ? new Cell(0, 0, []) : make(k));
  };

  // ---------- cells & structs ----------
  L.fieldnames = a => { const s = a[0]; if (s.type !== 'struct') fail('Invalid input argument of type ' + clsOf(s) + '. Input must be a structure.'); const k = [...s.f.keys()]; return new Cell(k.length, 1, k.map(x => str(x))); };
  L.rmfield = a => { const s = a[0]; if (s.type !== 'struct') fail('rmfield: first input must be a struct.'); const o = new Struct(new Map(s.f)); (a[1].type === 'cell' ? a[1].data : [a[1]]).forEach(x => { const k = Str(x); if (!o.f.has(k)) fail(`A field named '${k}' doesn't exist.`); o.f.delete(k); }); return o; };
  L.setfield = a => { const o = new Struct(new Map(a[0].f)); o.f.set(Str(a[1]), a[2]); return o; };
  L.getfield = a => { const v = a[0].f.get(Str(a[1])); if (v === undefined) fail(`Unrecognized field name "${Str(a[1])}".`); return v; };
  L.num2cell = a => { const A = N(a[0]); return new Cell(A.r, A.c, Array.from({ length: A.n }, (_, k) => { const o = new Mat(1, 1, Float64Array.of(A.re[k]), A.im ? Float64Array.of(A.im[k]) : null, A.cls); return o; })); };
  L.cell2mat = a => { const c = a[0]; if (c.type !== 'cell') fail('cell2mat: input must be a cell array.'); if (!c.n) return M.empty(); const rows = []; for (let i = 0; i < c.r; i++) { const r = []; for (let j = 0; j < c.c; j++) r.push(N(c.data[i + j * c.r])); rows.push(M.hcat(r)); } return M.vcat(rows); };
  L.struct2cell = a => { const v = [...a[0].f.values()]; return new Cell(v.length, 1, v); };
  L.cell2struct = a => { const c = a[0], f = a[1].type === 'cell' ? a[1].data.map(x => Str(x)) : [Str(a[1])], s = new Struct(); f.forEach((k, i) => s.f.set(k, c.data[i])); return s; };
  function funArgs(a, fnName) {
    let uniform = true; const rest = [];
    for (let k = 1; k < a.length; k++) { if (isStr(a[k]) && /^uniformoutput$/i.test(Str(a[k])) && k + 1 < a.length) { uniform = a[k + 1].re[0] !== 0; k++; continue; } if (isStr(a[k]) && /^errorhandler$/i.test(Str(a[k]))) { k++; continue; } rest.push(a[k]); }
    let f = a[0]; if (isStr(f)) f = new Func({ name: Str(f) });
    if (!f || f.type !== 'func') fail(`${fnName}: first input must be a function handle.`);
    return { f, uniform, rest };
  }
  function mapApply(In, f, items, n, shape, uniform, nout) {
    const outs = Array.from({ length: Math.max(1, nout) }, () => []);
    for (let k = 0; k < n; k++) {
      In.tick();
      const r = In.callFunc(f, items.map(it => it(k)), Math.max(1, nout));
      for (let o = 0; o < outs.length; o++) {
        const v = r[o]; if (v === undefined) fail('The function returned no value.');
        if (uniform && !(isNum(v) && v.n === 1)) fail(`Non-scalar in Uniform output, at index ${k + 1}, output ${o + 1}. Set 'UniformOutput' to false.`);
        outs[o].push(v);
      }
    }
    return outs.map(list => {
      if (!uniform) return new Cell(shape[0], shape[1], list);
      const m = new Mat(shape[0], shape[1]); const lg = list.length && list.every(v => v.cls === 'logical');
      list.forEach((v, k) => { m.re[k] = v.re[0]; if (v.im) { if (!m.im) m.im = new Float64Array(m.n); m.im[k] = v.im[0]; } }); if (lg) m.cls = 'logical'; return m;
    });
  }
  L.cellfun = (a, nout, In) => {
    const { f, uniform, rest } = funArgs(a, 'cellfun');
    if (!rest.length || rest.some(c => c.type !== 'cell')) fail('cellfun: inputs must be cell arrays.');
    const c0 = rest[0], fname = f.name;
    if (fname === 'isempty' || fname === 'length' || fname === 'numel' || fname === 'ischar' || fname === 'isnumeric') { /* fast path is just the general path */ }
    const r = mapApply(In, f, rest.map(c => k => c.data[k]), c0.n, [c0.r, c0.c], uniform, nout);
    return nout > 1 ? r : r[0];
  };
  L.arrayfun = (a, nout, In) => {
    const { f, uniform, rest } = funArgs(a, 'arrayfun'), A0 = rest[0];
    const items = rest.map(A => k => A.type === 'cell' ? new Cell(1, 1, [A.data[k]]) : (A.type === 'num' ? new Mat(1, 1, Float64Array.of(A.re[k]), A.im ? Float64Array.of(A.im[k]) : null, A.cls) : A));
    const r = mapApply(In, f, items, A0.n, [A0.r, A0.c], uniform, nout);
    return nout > 1 ? r : r[0];
  };
  L.structfun = (a, nout, In) => { const { f, uniform } = funArgs(a, 'structfun'), vals = [...a[1].f.values()]; const r = mapApply(In, f, [k => vals[k]], vals.length, [vals.length, 1], uniform, nout); return nout > 1 ? r : r[0]; };

  // ---------- functions & evaluation ----------
  L.deal = (a, nout) => { const k = Math.max(1, nout); if (a.length === 1) return Array.from({ length: k }, () => a[0]); if (a.length !== k) fail('The number of outputs should match the number of inputs.'); return a.slice(); };
  L.feval = (a, nout, In) => { const f = isStr(a[0]) ? Str(a[0]) : a[0]; return In.callFunc(f, a.slice(1), nout); };
  L.func2str = a => str(a[0].src.replace(/^@(?=[A-Za-z_]\w*$)/, ''));
  L.str2func = (a, _n, In) => { const s = Str(a[0]); if (s.startsWith('@')) return In.evalString(s); return new Func({ name: s }); };
  L.eval = (a, nout, In) => {
    const code = Str(a[0], 'eval');
    try {
      if (nout > 0) return In.evalString(code);
      In.evalHere(code);
    } catch (e) { if (a.length > 1 && !e.interrupt) { In.lastErr = e; In.evalHere(Str(a[1])); } else throw e; }
  };
  L.evalin = (a, nout, In) => L.eval(a.slice(1), nout, In);
  L.assert = a => { const ok = isNum(a[0]) && a[0].n > 0 && Array.from(a[0].re).every(x => x !== 0); if (!ok) fail(a.length > 1 ? sprintf(Str(a[1]), a.slice(2)) : 'Assertion failed.', 'MATLAB:assertion:failed'); };
  L.error = a => {
    if (!a.length) return;
    if (a[0].type === 'struct') { const e = new M.LabError(Str(a[0].f.get('message') || str('')), a[0].f.get('identifier') ? Str(a[0].f.get('identifier')) : ''); throw e; }
    let id = '', args = a;
    if (a.length > 1 && isStr(a[0]) && /^[A-Za-z][\w-]*(:[\w-]+)+$/.test(Str(a[0]))) { id = Str(a[0]); args = a.slice(1); }
    const msg = args.length > 1 || id ? sprintf(Str(args[0]), args.slice(1)) : Str(args[0]);
    throw new M.LabError(msg, id);
  };
  L.warning = (a, _n, In) => {
    if (!a.length) return; const first = Str(a[0]);
    if (/^(on|off|query)$/.test(first)) { In.warnOff = first === 'off' && a.length === 1 ? true : first === 'on' && a.length === 1 ? false : In.warnOff; return; }
    let args = a; if (a.length > 1 && /^[A-Za-z][\w-]*(:[\w-]+)+$/.test(first)) args = a.slice(1);
    if (!In.warnOff) In.warn(sprintf(Str(args[0]), args.slice(1)));
  };
  L.rethrow = a => L.error([a[0]]);
  L.MException = a => { const s = new Struct(); s.f.set('identifier', a[0]); s.f.set('message', str(sprintf(Str(a[1]), a.slice(2)))); return s; };
  L.throw = a => L.error([a[0]]);
  L.lasterr = (a, _n, In) => str(In.lastErr ? In.lastErr.message : '');
  L.nargin = (a, _n, In) => { if (a.length) { const u = In.findUser(isStr(a[0]) ? Str(a[0]) : a[0].name); if (!u || !u.def) fail('nargin: function not found.'); const p = u.def.params; return num(p[p.length - 1] === 'varargin' ? -p.length : p.length); } const f = In.frame; if (f.nargin === undefined) fail('You can only call nargin from within a MATLAB function.'); return num(f.nargin); };
  L.nargout = (a, _n, In) => { const f = In.frame; if (f.nargout === undefined) fail('You can only call nargout from within a MATLAB function.'); return num(f.nargout); };
  L.narginchk = (a, _n, In) => { const n = In.frame.nargin; if (n < S(a[0])) fail('Not enough input arguments.'); if (n > S(a[1])) fail('Too many input arguments.'); };
  L.exist = (a, _n, In) => { const nm = Str(a[0]); if (In.hasVar(nm)) return num(1); if (In.files.has(nm) || In.files.has(nm + '.m')) return num(2); if (In.lib[nm]) return num(5); if (In.findUser(nm)) return num(2); return num(0); };
  L.isvarname = a => bool(/^[A-Za-z]\w{0,62}$/.test(Str(a[0])) && !require_kw(Str(a[0])));
  const require_kw = w => ['if', 'else', 'elseif', 'end', 'for', 'while', 'function', 'return', 'break', 'continue', 'switch', 'case', 'otherwise', 'try', 'catch', 'global', 'persistent'].includes(w);
  L.iskeyword = a => bool(require_kw(Str(a[0])));
  L.isdeployed = () => bool(false);
  L.ismac = () => bool(false); L.ispc = () => bool(true); L.isunix = () => bool(false);
  L.version = () => str('1.0.0 (Lumen Lab)');
  L.tic = (a, nout, In) => { In.ticT = performance.now(); if (nout > 0) return num(In.ticT); };
  L.toc = (a, nout, In) => { const t0 = a.length ? S(a[0]) : In.ticT; if (t0 === undefined) fail('You must call TIC without an output argument before calling TOC without an input argument.'); const dt = (performance.now() - t0) / 1000; if (nout > 0) return num(dt); In.print(`Elapsed time is ${dt.toFixed(6)} seconds.\n`); };
  L.clock = () => { const d = new Date(); return rowOut([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds() + d.getMilliseconds() / 1000]); };
  L.now = () => num(Date.now() / 86400000 + 719529);
  L.datestr = a => { const d = a.length ? new Date((S(a[0]) - 719529) * 86400000) : new Date(); return str(d.toISOString().replace('T', ' ').slice(0, 19)); };
  L.cputime = () => num(performance.now() / 1000);
  L.pause = (a, _n, In) => { if (In.host && In.host.pause) In.host.pause(a.length ? S(a[0]) : 0); };
  L.drawnow = (a, _n, In) => { if (In.host && In.host.flush) In.host.flush(); };
  L.beep = () => {};
  L.input = (a, _n, In) => {
    if (!In.host || !In.host.input) fail('input is not available here.');
    const text = In.host.input(a.length ? Str(a[0]) : '');
    if (text === null) { const e = new M.LabError('Operation terminated by user.'); e.interrupt = true; throw e; }
    if (a.length > 1 && /^s$/i.test(Str(a[1]))) return str(text);
    if (!text.trim()) return M.empty();
    return In.evalString(text);
  };
  L.keyboard = () => {};
  L.clc = (a, _n, In) => { if (In.host && In.host.clc) In.host.clc(); };
  L.more = () => {}; L.echo = () => {}; L.pkg = () => {};
  L.format = (a) => { const m = a.length ? Str(a[0]).toLowerCase() : 'short'; if (m === 'long') M.fmt.long = true; else if (m === 'short') M.fmt.long = false; };
  L.clear = (a, _n, In) => {
    const names = a.map(x => Str(x)); const sc = In.scope;
    if (!names.length || names.includes('all') || names.includes('-all') || names.includes('variables')) { sc.clear(); if (names.includes('all')) { In.frames[0].funcs = new Map(); In.parseCache.clear(); In.globals.clear(); } return; }
    if (names.includes('functions')) { In.frames[0].funcs = new Map(); In.parseCache.clear(); return; }
    if (names.includes('global')) { In.globals.clear(); return; }
    for (const nm of names) { if (nm.includes('*')) { const re = new RegExp('^' + nm.replace(/\*/g, '.*') + '$'); [...sc.keys()].forEach(k => re.test(k) && sc.delete(k)); } else sc.delete(nm); }
  };
  L.clearvars = L.clear;
  L.who = (a, nout, In) => { const k = [...In.scope.keys()].sort(); if (nout > 0) return new Cell(k.length, 1, k.map(x => str(x))); In.print(k.length ? 'Your variables are:\n\n' + k.join('  ') + '\n\n' : ''); };
  L.whos = (a, _n, In) => {
    const k = [...In.scope.keys()].sort(); if (!k.length) return;
    const rows = k.map(n => { const v = In.scope.get(n); return [n, `${v.r}x${v.c}`, String(bytesOf(v)), clsOf(v) + (v.im ? ' (complex)' : '')]; });
    const w = [4, 4, 5, 5].map((m, i) => Math.max(m, ...rows.map(r => r[i].length)));
    In.print(`  ${'Name'.padEnd(w[0])}    ${'Size'.padStart(w[1])}    ${'Bytes'.padStart(w[2])}  Class\n\n` + rows.map(r => `  ${r[0].padEnd(w[0])}    ${r[1].padStart(w[1])}    ${r[2].padStart(w[2])}  ${r[3]}`).join('\n') + '\n\n');
  };
  function bytesOf(v) { if (v.type === 'num') return v.n * (v.cls === 'char' ? 2 : v.cls === 'logical' ? 1 : 8) * (v.im ? 2 : 1); if (v.type === 'cell') return v.data.reduce((s, x) => s + bytesOf(x) + 104, 0); if (v.type === 'struct') { let s = 176; v.f.forEach(x => { s += bytesOf(x) + 104; }); return s; } return 32; }
  L.__bytes = a => num(bytesOf(a[0]));

  // ---------- virtual current folder: files ----------
  const fileText = (In, name) => {
    if (In.files.has(name)) return In.files.get(name);
    for (const ext of ['.csv', '.txt', '.dat', '.m']) if (In.files.has(name + ext)) return In.files.get(name + ext);
    fail(`Unable to find file or directory '${name}'.`, 'MATLAB:load:couldNotReadFile');
  };
  function parseDelimited(text, opts = {}) {
    const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim().length);
    const delim = opts.delim || (lines.some(l => l.includes(',')) ? ',' : lines.some(l => l.includes('\t')) ? '\t' : lines.some(l => l.includes(';')) ? ';' : /\s+/);
    const rows = lines.map(l => (typeof delim === 'string' ? l.split(delim) : l.trim().split(delim)).map(s => s.trim().replace(/^"(.*)"$/, '$1')));
    let header = null; if (rows.length && rows[0].some(c => c !== '' && Number.isNaN(parseNum(c)))) header = rows.shift();
    const w = Math.max(0, ...rows.map(r => r.length));
    return { header, data: rows.map(r => Array.from({ length: w }, (_, j) => r[j] === undefined || r[j] === '' ? NaN : parseNum(r[j]))) };
  }
  L.__parseDelimited = parseDelimited;
  L.readmatrix = (a, _n, In) => { const { data } = parseDelimited(fileText(In, Str(a[0]))); return data.length ? M.fromRows(data) : M.empty(); };
  L.csvread = (a, _n, In) => { // offsets count rows of the file, including a skipped header line
    const { header, data } = parseDelimited(fileText(In, Str(a[0]))); let A = data.length ? M.fromRows(data) : M.empty();
    if (a.length > 2) { const r0 = Math.max(0, S(a[1]) - (header ? 1 : 0)), c0 = S(a[2]); A = In.idxRead(A, [I.colon(r0 + 1, 1, A.r), I.colon(c0 + 1, 1, A.c)]); }
    return A;
  };
  L.dlmread = L.csvread; L.readtable = L.readmatrix;
  L.importdata = L.readmatrix;
  L.readcell = (a, _n, In) => { const lines = fileText(In, Str(a[0])).replace(/\r/g, '').split('\n').filter(l => l.trim()); const rows = lines.map(l => l.split(',')); const w = Math.max(...rows.map(r => r.length)); const c = new Cell(rows.length, w); rows.forEach((r, i) => r.forEach((x, j) => { const v = parseNum(x); c.data[i + j * rows.length] = Number.isNaN(v) && x.trim().toLowerCase() !== 'nan' ? str(x.trim()) : num(v); })); return c; };
  const toCSV = A => { const rows = []; for (let i = 0; i < A.r; i++) { const r = []; for (let j = 0; j < A.c; j++) r.push(fmtG(A.re[i + j * A.r], 15)); rows.push(r.join(',')); } return rows.join('\n') + '\n'; };
  L.writematrix = (a, _n, In) => { const name = a.length > 1 ? Str(a[1]) : 'matrix.txt'; In.files.set(name, toCSV(N(a[0]))); if (In.host && In.host.filesChanged) In.host.filesChanged(); };
  L.csvwrite = (a, _n, In) => { In.files.set(Str(a[0]), toCSV(N(a[1]))); if (In.host && In.host.filesChanged) In.host.filesChanged(); };
  L.dlmwrite = L.csvwrite;
  L.fileread = (a, _n, In) => str(fileText(In, Str(a[0])));
  L.type = (a, _n, In) => { In.print(fileText(In, Str(a[0])) + '\n'); };
  L.ls = (a, nout, In) => { const k = [...In.files.keys()].sort(); if (nout > 0) return new Cell(k.length, 1, k.map(x => str(x))); In.print(k.join('  ') + '\n'); };
  L.dir = L.ls; L.what = L.ls;
  L.pwd = () => str('Lumen Lab');
  L.cd = () => {}; L.addpath = () => {}; L.rmpath = () => {}; L.path = () => {};
  L.delete = (a, _n, In) => { const n = Str(a[0]); if (!In.files.delete(n)) In.warn(`File '${n}' not found.`); if (In.host && In.host.filesChanged) In.host.filesChanged(); };
  L.load = (a, nout, In) => {
    const name = Str(a[0]), text = fileText(In, name);
    if (/^\s*\{/.test(text)) { // workspace saved by save()
      const vars = fromJSON(JSON.parse(text).vars || {}, In);
      if (nout > 0) { const s = new Struct(); for (const k in vars) s.f.set(k, vars[k]); return s; }
      for (const k in vars) In.setVar(k, vars[k]); return;
    }
    const { data } = parseDelimited(text), A = data.length ? M.fromRows(data) : M.empty();
    if (nout > 0) return A;
    In.setVar(name.replace(/\.[^.]*$/, '').replace(/\W/g, '_').replace(/^(\d)/, 'X$1'), A);
  };
  L.save = (a, _n, In) => {
    const name0 = a.length ? Str(a[0]) : 'matlab.lmat', name = /\./.test(name0) ? name0 : name0 + '.lmat';
    const sel = a.slice(1).map(x => Str(x)).filter(x => !x.startsWith('-'));
    const vars = {}; for (const [k, v] of In.scope) if (!sel.length || sel.includes(k)) vars[k] = toJSON(v);
    In.files.set(name, JSON.stringify({ format: 'lumen-lab-workspace', version: 1, vars }));
    if (In.host && In.host.filesChanged) In.host.filesChanged();
  };
  // values ↔ JSON (workspace files, worker messages)
  function toJSON(v) {
    if (v.type === 'num') return { t: 'num', r: v.r, c: v.c, cls: v.cls, re: Array.from(v.re, x => Number.isFinite(x) ? x : String(x)), im: v.im ? Array.from(v.im, x => Number.isFinite(x) ? x : String(x)) : undefined };
    if (v.type === 'cell') return { t: 'cell', r: v.r, c: v.c, data: v.data.map(toJSON) };
    if (v.type === 'struct') { const f = {}; v.f.forEach((x, k) => { f[k] = toJSON(x); }); return { t: 'struct', f }; }
    if (v.type === 'func') return { t: 'func', src: v.src };
  }
  // function handles come back from their source text; building a handle never runs its body
  function fromJSON1(o, In) {
    const n = x => typeof x === 'string' ? Number(x) : x;
    if (o.t === 'num') return new Mat(o.r, o.c, Float64Array.from(o.re, n), o.im ? Float64Array.from(o.im, n) : null, o.cls);
    if (o.t === 'cell') return new Cell(o.r, o.c, o.data.map(x => fromJSON1(x, In)));
    if (o.t === 'struct') { const s = new Struct(); for (const k in o.f) s.f.set(k, fromJSON1(o.f[k], In)); return s; }
    if (o.t === 'func') { if (In && /^@/.test(o.src)) { try { const f = In.evalString(o.src); if (f.type === 'func') return f; } catch (e) { /* fall through */ } } return str(o.src); }
    fail('Unreadable workspace file.');
  }
  function fromJSON(vars, In) { const out = {}; for (const k in vars) out[k] = fromJSON1(vars[k], In); return out; }
  L.__toJSON = toJSON; L.__fromJSON1 = fromJSON1;
  L.__sprintf = sprintf; L.__fmtG = fmtG; L.__num2str = num2str;

  const api = { L, N, S, Str, isStr, vec, dims, reduce, along, sprintf, fmtG, toJSON, fromJSON1, parseDelimited };
  if (node) module.exports = api; else root.LabLib = api;
})(typeof self !== 'undefined' ? self : this);
