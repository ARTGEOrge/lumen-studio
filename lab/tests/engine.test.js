// node lab/tests/engine.test.js — hand-checked answers for the Lumen Lab language and function library.
const E = require('../js/engine.js');
const M = require('../js/mat.js');
const { errorText } = require('../js/interp.js');
const assert = require('assert');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

// run code in a fresh engine; returns { In, out, v(name) → JS value }
function lab(src, files) {
  let out = '';
  const In = E.create({ out: s => { out += s; } });
  if (files) for (const k in files) In.files.set(k, files[k]);
  In.run(src);
  const v = name => { const x = In.getVar(name); if (x === undefined) throw new Error('no variable ' + name); return js(x); };
  return { In, out: () => out, v };
}
// numeric value → number, or array of rows (row/column vectors become flat arrays)
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
const throwsLab = (src, re) => { let msg = null; try { lab(src); } catch (e) { msg = errorText(e); } assert.ok(msg && re.test(msg), `expected error ${re} from: ${src}\n got: ${msg}`); };

t('operator precedence, unary minus and power', () => {
  const { v } = lab('a = -2^2; b = 2^-1; c = 1:3+1; d = 2*3^2; e = -[1 2].^2; f = ~0 + 1; g = 2^3^2;');
  near(v('a'), -4); near(v('b'), 0.5); near(v('c'), [1, 2, 3, 4]); near(v('d'), 18); near(v('e'), [-1, -4]); near(v('f'), 2); near(v('g'), 64);
});

t('matrix literals: whitespace, signs, transposes, rows', () => {
  const { v } = lab("x = [1 -2]; y = [1 - 2]; z = [1 , 2\n 3 4]; a = [1 2]; b = [a' a']; c = [a, 3]; d = [a -a]; e = [ (1) (2) ];");
  near(v('x'), [1, -2]); near(v('y'), -1); near(v('z'), [[1, 2], [3, 4]]); near(v('b'), [[1, 1], [2, 2]]); near(v('c'), [1, 2, 3]); near(v('d'), [1, 2, -1, -2]); near(v('e'), [1, 2]);
});

t('indexing: (i,j), linear, end, colon, logical masks', () => {
  const { v } = lab('A = magic(4); a = A(2,3); b = A(end,end); c = A(:,2)\'; d = A(5); e = A(A>12)\'; f = A(end-1:end, 1)\'; g = A([1 end], [1 end]); h = A(:)\'; k = A(2,:);');
  near(v('a'), 10); near(v('b'), 1); near(v('c'), [2, 11, 7, 14]); near(v('d'), 2);
  near(v('e'), [16, 14, 15, 13]); near(v('f'), [9, 4]); near(v('g'), [[16, 13], [4, 1]]);
  near(v('h'), [16, 5, 9, 4, 2, 11, 7, 14, 3, 10, 6, 15, 13, 8, 12, 1]); near(v('k'), [5, 11, 10, 8]);
});

t('indexed assignment: growth, scalar broadcast, deletion, copy-on-write', () => {
  const { v } = lab('x = 1:5; x(2) = []; y = zeros(2); y(3,3) = 7; z = []; for i = 1:4, z(end+1) = i^2; end; M = magic(3); M(:,1) = []; w = 1:3; u = w; u(1) = 99; m = ones(2,3); m(:, 2) = [5; 6]; q = 1:6; q(q > 3) = 0; s = []; s(2,3) = 1;');
  near(v('x'), [1, 3, 4, 5]); near(v('y'), [[0, 0, 0], [0, 0, 0], [0, 0, 7]]); near(v('z'), [1, 4, 9, 16]);
  near(v('M'), [[1, 6], [5, 7], [9, 2]]); near(v('w'), [1, 2, 3]); near(v('u'), [99, 2, 3]);
  near(v('m'), [[1, 5, 1], [1, 6, 1]]); near(v('q'), [1, 2, 3, 0, 0, 0]); near(v('s'), [[0, 0, 0], [0, 0, 1]]);
});

t('element-wise vs matrix operators and implicit expansion', () => {
  const { v } = lab('A = [1 2; 3 4]; a = A*[5;6]; b = A.*[5 6; 7 8]; c = [1;2] + [10 20]; d = A.^2; e = A^2; f = A./2; g = 2./[1 2 4]; h = A\'; k = [1 2 3]*[4;5;6];');
  near(v('a'), [17, 39]); near(v('b'), [[5, 12], [21, 32]]); near(v('c'), [[11, 21], [12, 22]]);
  near(v('d'), [[1, 4], [9, 16]]); near(v('e'), [[7, 10], [15, 22]]); near(v('f'), [[0.5, 1], [1.5, 2]]);
  near(v('g'), [2, 1, 0.5]); near(v('h'), [[1, 3], [2, 4]]); near(v('k'), 32);
});

t('linear algebra: inv, det, backslash, least squares', () => {
  const { v } = lab('a = inv([4 7; 2 6]); b = det(magic(3)); c = [2 1; 1 3] \\ [3; 5]; d = [1 0; 1 1; 1 2] \\ [1; 2; 4]; e = [1 2] / [3 4; 5 6]; f = rank(magic(4)); g = trace(magic(3)); h = norm([3 4]); k = norm([1 2; 3 4], 1); m = det([1 2; 2 4]);');
  near(v('a'), [[0.6, -0.7], [-0.2, 0.4]]); near(v('b'), -360); near(v('c'), [0.8, 1.4]);
  near(v('d'), [5 / 6, 1.5]); near(v('e'), [2, -1]); // x*[3 4;5 6] = [1 2]: 3a+5b = 1, 4a+6b = 2 → a = 2, b = -1
  near(v('f'), 3); near(v('g'), 15); near(v('h'), 5); near(v('k'), 6); near(v('m'), 0);
});

t('eigenvalues and vectors (symmetric, general, complex)', () => {
  const { v, In } = lab('a = eig([2 1; 1 2]); b = sort(eig([0 1; -2 -3])); c = eig([0 -1; 1 0]); A = [1 2; 3 4]; [V, D] = eig(A); r = norm(A*V - V*D); s = sort(eig(magic(4)));');
  near(v('a'), [1, 3]); near(v('b'), [-2, -1]);
  const c = v('c'); near(c[0], [0, 1]); near(c[1], [0, -1]);
  assert.ok(v('r') < 1e-12, 'A*V = V*D');
  near(v('s'), [-8.94427190999916, -2.48e-15, 8.94427190999916, 34], 1e-9); // magic(4): 34, ±√80, 0
  void In;
});

t('eig on larger matrices: A*V = V*D for random, symmetric and complex-spectrum cases', () => {
  const { v } = lab(`rng(3); A = rand(40) - 0.5; [V, D] = eig(A); r1 = max(abs(A*V - V*D), [], 'all') / norm(A, 1);
S = A + A'; [W, E] = eig(S); r2 = max(abs(S*W - W*E), [], 'all') / norm(S, 1); o = max(abs(W'*W - eye(40)), [], 'all');
nc = sum(imag(diag(D)) ~= 0) > 0; d = issorted(diag(E)); B = magic(6); [P, Q] = eig(B); r3 = max(abs(B*P - P*Q), [], 'all') / norm(B, 1);
tr = abs(sum(diag(D)) - trace(A));`);
  assert.ok(v('r1') < 1e-10, 'random nonsymmetric residual ' + v('r1')); assert.ok(v('r2') < 1e-12, 'symmetric residual ' + v('r2'));
  assert.ok(v('o') < 1e-12, 'orthonormal eigenvectors'); near(v('nc'), 1); near(v('d'), 1); assert.ok(v('r3') < 1e-10, 'magic(6) residual ' + v('r3'));
  assert.ok(v('tr') < 1e-10, 'eigenvalues sum to the trace');
});

t('SVD, QR, LU, Cholesky reconstruct their input', () => {
  const { v } = lab('s = svd([3 0; 4 5]); A = [1 2; 3 4; 5 6]; [U, S, W] = svd(A); e1 = norm(U*S*W\' - A); e2 = norm(U\'*U - eye(3)); [Q, R] = qr(A); e3 = norm(Q*R - A); e4 = norm(Q\'*Q - eye(3)); B = [4 3; 6 3]; [L, Uu, P] = lu(B); e5 = norm(L*Uu - P*B); C = chol([4 2; 2 3]); p = pinv([1 2; 2 4]);');
  near(v('s'), [3 * Math.sqrt(5), Math.sqrt(5)]);
  ['e1', 'e2', 'e3', 'e4', 'e5'].forEach(k => assert.ok(v(k) < 1e-12, k + ' = ' + v(k)));
  near(v('C'), [[2, 1], [0, Math.SQRT2]]);
  near(v('p'), [[0.04, 0.08], [0.08, 0.16]]); // pinv of rank-1 [1 2;2 4] = A/25
  near(v('L'), [[1, 0], [2 / 3, 1]]); near(v('Uu'), [[6, 3], [0, 1]]);
});

t('magic squares match MATLAB (odd, doubly even, singly even)', () => {
  const { v } = lab('a = magic(3); b = magic(4); c = magic(6); s = [sum(c), sum(c, 2)\', trace(c), trace(fliplr(c))];');
  near(v('a'), [[8, 1, 6], [3, 5, 7], [4, 9, 2]]);
  near(v('b'), [[16, 2, 3, 13], [5, 11, 10, 8], [9, 7, 6, 12], [4, 14, 15, 1]]);
  near(v('c'), [[35, 1, 6, 26, 19, 24], [3, 32, 7, 21, 23, 25], [31, 9, 2, 22, 27, 20], [8, 28, 33, 17, 10, 15], [30, 5, 34, 12, 14, 16], [4, 36, 29, 13, 18, 11]]);
  near(v('s'), new Array(14).fill(111));
});

t('statistics and reductions', () => {
  const { v } = lab('a = mean([1 2 3 4]); b = median([3 1 4 1 5]); c = std([2 4 4 4 5 5 7 9]); d = var([2 4 4 4 5 5 7 9]); e = mode([1 2 2 3 3 3]); [m, i] = max([3 7 2]); f = sum(magic(3)); g = cumsum(1:4); h = sort([3 1 2], \'descend\'); [s, k] = sort([30 10 20]); p = prod([1 2 3 4]); q = mean([1 2; 3 4]); r = mean([1 2; 3 4], 2); u = min([4 2 8; 1 9 3]); w = any([0 0 1]); x = all([1 1 0]); y = sum([1 2; 3 4], \'all\'); z = cumprod([1 2 3]);');
  near(v('a'), 2.5); near(v('b'), 3); near(v('c'), Math.sqrt(32 / 7)); near(v('d'), 32 / 7); near(v('e'), 3);
  near(v('m'), 7); near(v('i'), 2); near(v('f'), [15, 15, 15]); near(v('g'), [1, 3, 6, 10]); near(v('h'), [3, 2, 1]);
  near(v('s'), [10, 20, 30]); near(v('k'), [2, 3, 1]); near(v('p'), 24); near(v('q'), [2, 3]); near(v('r'), [1.5, 3.5]);
  near(v('u'), [1, 2, 3]); near(v('w'), 1); near(v('x'), 0); near(v('y'), 10); near(v('z'), [1, 2, 6]);
});

t('FFT (radix-2 and any length) and inverse', () => {
  const { v } = lab('a = fft([1 2 3 4]); b = fft([1 2 3]); x = [0.5 -1 2 7 3]; c = ifft(fft(x)); d = isreal(c); e = abs(fft(ones(1,8))); f = fftshift([1 2 3 4 5]);');
  const a = v('a'); near(a[0], 10); near(a[1], [-2, 2]); near(a[2], -2); near(a[3], [-2, -2]);
  const b = v('b'); near(b[0], 6); near(b[1], [-1.5, Math.sqrt(3) / 2]); near(b[2], [-1.5, -Math.sqrt(3) / 2]);
  near(v('c'), [0.5, -1, 2, 7, 3], 1e-12); near(v('d'), 1); near(v('e'), [8, 0, 0, 0, 0, 0, 0, 0], 1e-12); near(v('f'), [4, 5, 1, 2, 3]);
});

t('polynomials: polyfit, polyval, roots, conv, deconv, polyder', () => {
  const { v } = lab('x = 0:4; y = 2*x.^2 - 3*x + 1; p = polyfit(x, y, 2); a = polyval([1 2 3], 2); r = sort(roots([1 -6 11 -6])); c = conv([1 1], [1 -1]); [q, rem] = deconv([1 0 -1], [1 1]); d = polyder([1 2 3]); z = roots([1 0 1]); k = poly([2 3]);');
  near(v('p'), [2, -3, 1], 1e-10); near(v('a'), 11); near(v('r'), [1, 2, 3], 1e-10); near(v('c'), [1, 0, -1]);
  near(v('q'), [1, -1]); near(v('rem'), [0, 0, 0]); near(v('d'), [2, 2]); near(v('k'), [1, -5, 6]);
  const z = v('z'); near(z[0], [0, 1], 1e-12); near(z[1], [0, -1], 1e-12);
});

t('interpolation: linear, nearest, spline (exact on cubics), pchip', () => {
  const { v } = lab("a = interp1([1 2 3], [10 20 30], 2.5); b = interp1([1 2 3], [10 20 30], 4); c = interp1([1 2 3], [10 20 30], 4, 'linear', 'extrap'); d = interp1([1 2 3], [10 20 30], [1.4 2.6], 'nearest'); x = 0:4; e = spline(x, x.^3, [2.5 3.7]); f = interp1(x, x.^3, 0.5, 'spline'); g = pchip([0 1 2 3], [0 1 1 0], [0.5 1.5]); h = interp1([0 1 2 3], [0 1 1 0], 1.5, 'pchip');");
  near(v('a'), 25); near(v('b'), NaN); near(v('c'), 40); near(v('d'), [10, 30]);
  near(v('e'), [15.625, 50.653], 1e-12); near(v('f'), 0.125, 1e-12);
  const g = v('g'); assert.strictEqual(g[1], 1, 'pchip keeps the flat segment flat'); assert.ok(g[0] > 0.5 && g[0] < 1, 'pchip is shape preserving');
  near(v('h'), 1);
});

t('ode45 / ode23 accuracy', () => {
  const { v } = lab('[t, y] = ode45(@(t,y) -2*y, [0 1], 1); a = y(end); b = t(end); [t2, Y] = ode45(@(t,y) [y(2); -y(1)], [0 2*pi], [1; 0]); c = Y(end,:); [t3, y3] = ode45(@(t,y) -y, [0 0.5 1], 1); d = y3\'; [t4, y4] = ode23(@(t,y) y, [0 1], 1); e = y4(end); n = numel(t) > 4;');
  near(v('a'), Math.exp(-2), 1e-4); near(v('b'), 1); near(v('c'), [1, 0], 2e-3);
  near(v('d'), [1, Math.exp(-0.5), Math.exp(-1)], 1e-4); near(v('e'), Math.E, 1e-3); near(v('n'), 1);
});

t('fzero, fminsearch, fminbnd, integral', () => {
  const { v } = lab('a = fzero(@(x) cos(x) - x, 1); b = fzero(@(x) x.^2 - 2, [0 2]); c = fminsearch(@(p) 100*(p(2)-p(1)^2)^2 + (1-p(1))^2, [-1.2 1]); d = fminbnd(@(x) (x-2).^2 + 1, 0, 5); e = integral(@(x) sin(x), 0, pi); f = integral(@(x) exp(-x.^2), -Inf, Inf); g = trapz(0:0.5:2, (0:0.5:2).^2); h = integral(@(x) 1./x.^2, 1, Inf);');
  near(v('a'), 0.7390851332151607, 1e-9); near(v('b'), Math.SQRT2, 1e-12); near(v('c'), [1, 1], 1e-3); near(v('d'), 2, 1e-4);
  near(v('e'), 2, 1e-10); near(v('f'), Math.sqrt(Math.PI), 1e-8); near(v('g'), 2.75); near(v('h'), 1, 1e-8);
});

t('control flow: if/elseif, for over columns, while/break/continue, switch, try/catch', () => {
  const { v } = lab(`
s = 0;
for k = 1:10
  if mod(k, 2) == 0, continue; end
  if k > 7, break; end
  s = s + k;      % 1 + 3 + 5 + 7
end
n = 0; while true, n = n + 1; if n >= 5, break; end, end
cols = 0; for c = [1 2; 3 4], cols = cols + c(2); end
switch 'abc'
  case {'x', 'abc'}, w = 1;
  otherwise, w = 2;
end
switch 3, case 1, z = 'one'; case 3, z = 'three'; end
try
  error('myid:sub', 'Value %d too big', 42);
catch err
  msg = err.message; id = err.identifier;
end
if 0, q = 1; elseif [], q = 2; else, q = 3; end
`);
  near(v('s'), 16); near(v('n'), 5); near(v('cols'), 7); near(v('w'), 1); assert.strictEqual(v('z'), 'three');
  assert.strictEqual(v('msg'), 'Value 42 too big'); assert.strictEqual(v('id'), 'myid:sub'); near(v('q'), 3);
});

t('functions: local functions, multiple outputs, nargin, recursion, closures, handles', () => {
  const { v } = lab(`
[mn, mx] = range2([4 9 1]);
f5 = fact(5);
a = 2; g = @(x) a*x; a = 5; h = g(3);
k = applyTwice(@(x) x + 3, 1);
d1 = withDefault(); d2 = withDefault(7);
sq = @sqrt; r = sq(16);
c = cellfun(@numel, {'a', 'bcd', ''});
u = arrayfun(@(x) x^2, [1 2 3]);
uu = arrayfun(@(x) 1:x, 1:3, 'UniformOutput', false);
function [lo, hi] = range2(v)
  lo = min(v); hi = max(v);
end
function r = fact(n)
  if n <= 1, r = 1; else, r = n * fact(n - 1); end
end
function y = applyTwice(f, x)
  y = f(f(x));
end
function y = withDefault(x)
  if nargin < 1, x = 10; end
  y = x * 2;
end
`);
  near(v('mn'), 1); near(v('mx'), 9); near(v('f5'), 120); near(v('h'), 6); near(v('k'), 7); near(v('d1'), 20); near(v('d2'), 14);
  near(v('r'), 4); near(v('c'), [1, 3, 0]); near(v('u'), [1, 4, 9]);
});

t('function files in the current folder are callable, scripts run in the caller workspace', () => {
  const { v } = lab('y = hyp(3, 4); setx; z = x + 1;', { 'hyp.m': 'function c = hyp(a, b)\n% hypotenuse\nc = sqrt(a^2 + b^2);\nend\n', 'setx.m': 'x = 41;\n' });
  near(v('y'), 5); near(v('z'), 42);
});

t('strings, sprintf and number formatting', () => {
  const { v } = lab(`a = sprintf('%d-%s', 5, 'ab'); b = num2str(3.14159, 4); c = upper('abc'); d = strrep('a.b.c', '.', '/'); e = strcmp('x', 'x'); p = strsplit('a,b,,c', ','); f = numel(p); g = strjoin({'x','y','z'}, '+');
h = sprintf('%6.2f|', [1.234 5.678]); k = num2str([1 2 3]); m = mat2str([1 2; 3 4.5]); n = str2double('2.5e3'); o = sprintf('%05.1f', 3.14159); q = ['ab', 'cd']; r = length('hello'); s = strtrim('  hi  '); u = sprintf('%g', 0.0001); w = sprintf('%x', 255); x = num2str(pi); y = int2str(2.7); z = strfind('abcabc', 'bc');`);
  assert.strictEqual(v('a'), '5-ab'); assert.strictEqual(v('b'), '3.142'); assert.strictEqual(v('c'), 'ABC'); assert.strictEqual(v('d'), 'a/b/c');
  near(v('e'), 1); near(v('f'), 4); assert.strictEqual(v('g'), 'x+y+z'); assert.strictEqual(v('h'), '  1.23|  5.68|');
  assert.strictEqual(v('k'), '1  2  3'); assert.strictEqual(v('m'), '[1 2;3 4.5]'); near(v('n'), 2500); assert.strictEqual(v('o'), '003.1');
  assert.strictEqual(v('q'), 'abcd'); near(v('r'), 5); assert.strictEqual(v('s'), 'hi'); assert.strictEqual(v('u'), '0.0001'); assert.strictEqual(v('w'), 'ff');
  assert.strictEqual(v('x'), '3.1416'); assert.strictEqual(v('y'), '3'); near(v('z'), [2, 5]);
});

t('cells and structs', () => {
  const { v, In } = lab("c = {1, 'two', [3 4]}; a = c{3}(2); b = class(c{2}); c{5} = 9; n = numel(c); s.name = 'Ada'; s.age = 36; s.pos.x = 2; f = fieldnames(s); nf = numel(f); px = s.pos.x; t = isfield(s, 'age'); s2 = rmfield(s, 'age'); t2 = isfield(s2, 'age'); m = cell2mat({[1 2], [3]; [4 5], [6]}); [p, q] = c{1:2};");
  near(v('a'), 4); assert.strictEqual(v('b'), 'char'); near(v('n'), 5); near(v('nf'), 3); near(v('px'), 2);
  near(v('t'), 1); near(v('t2'), 0); near(v('m'), [[1, 2, 3], [4, 5, 6]]); near(v('p'), 1); assert.strictEqual(v('q'), 'two');
  void In;
});

t('CSV import: readmatrix, load, csvread with offsets, header row skipped', () => {
  const files = { 'data.csv': 'time,temp\n0,20.5\n1,21.0\n2,23.25\n', 'm.txt': '1 2 3\n4 5 6\n' };
  const { v } = lab("A = readmatrix('data.csv'); load m.txt; B = m; C = csvread('data.csv', 2, 1); s = size(A);", files);
  near(v('A'), [[0, 20.5], [1, 21], [2, 23.25]]); near(v('B'), [[1, 2, 3], [4, 5, 6]]); near(v('C'), [21, 23.25]); near(v('s'), [3, 2]);
});

t('save/load workspace round trip through the virtual folder', () => {
  const r = lab("x = [1 2; 3 4]; s = 'hi'; c = {1, 'a'}; save('ws.lmat'); clear; load('ws.lmat'); y = x(2,1); t = s;");
  near(r.v('y'), 3); assert.strictEqual(r.v('t'), 'hi'); near(r.v('c').n, 2);
});

t('command window display matches MATLAB formatting', () => {
  const r = lab('A = [1 2; 3 4]\nx = 3.14159\nz = 3 + 4i\nb = [1.5 2.25]\nB = [1000.5 2]\ne = []\nt = true\ns = \'text\'\nq = 1e-5\n');
  const out = r.out();
  assert.ok(out.includes('A =\n     1     2\n     3     4\n'), out);
  assert.ok(out.includes('x = 3.1416\n'));
  assert.ok(out.includes('z = 3.0000 + 4.0000i\n'));
  assert.ok(out.includes('b =\n    1.5000    2.2500\n'));
  assert.ok(out.includes('B =\n   1.0e+03 *\n\n    1.0005    0.0020\n'), out);
  assert.ok(out.includes('e =\n     []\n'));
  assert.ok(out.includes('t = 1\n'));
  assert.ok(out.includes("s = 'text'\n"));
  assert.ok(out.includes('q = 1.0000e-05\n'));
});

t('fprintf / disp output', () => {
  const r = lab("fprintf('%d squared is %d\\n', [1 2; 1 4]);\ndisp('hello')\ndisp(42)\nfprintf('%s: %.2f\\n', 'pi', pi)");
  assert.strictEqual(r.out(), '1 squared is 1\n2 squared is 4\nhello\n    42\npi: 3.14\n');
});

t('errors carry MATLAB-style messages and line numbers', () => {
  throwsLab('x = [1 2 3]; x(5)', /Index exceeds the number of array elements\. Index must not exceed 3\./);
  throwsLab('A = eye(2); A(3, 1)', /Index in position 1 exceeds array bounds/);
  throwsLab('y = undefinedFn(2)', /Unrecognized function or variable 'undefinedFn'/);
  throwsLab('[1 2] * [3 4]', /Incorrect dimensions for matrix multiplication/);
  throwsLab('[1 2] + [1 2 3]', /incompatible sizes/);
  throwsLab('x = [1 2', /Missing '\]'|Incomplete/);
  throwsLab('a = 1;\nb = 2;\nf(3)\nfunction f(x)\n  error(\'bad %d\', x);\nend', /bad 3\nError in f \(line 5\)/);
  throwsLab('x(0) = 1', /Index in position 1 is invalid/);
});

t('graphics model: plot, hold, subplot, surf, labels, legend', () => {
  const { In } = lab(`
x = linspace(0, 2*pi, 50);
plot(x, sin(x), 'r--', 'LineWidth', 2); hold on
plot(x, cos(x))
title('Waves'); xlabel('t'); legend('sin', 'cos'); grid on
figure
subplot(2, 1, 1); bar([3 5 2]);
subplot(2, 1, 2); [X, Y, Z] = peaks(20); surf(X, Y, Z); colormap jet; shading interp
figure(5); scatter(1:3, [2 4 1], 40, [1 2 3], 'filled'); hist_ = histogram(randn(1, 100));
`);
  const G = In.gfx, f1 = G.figs.find(f => f.id === 1), f2 = G.figs.find(f => f.id === 2), f5 = G.figs.find(f => f.id === 5);
  assert.ok(f1 && f2 && f5, 'figures 1, 2 and 5 exist');
  const ax = f1.axes[0];
  assert.strictEqual(ax.series.length, 2); assert.deepStrictEqual(ax.series[0].color, [1, 0, 0]); assert.strictEqual(ax.series[0].style, '--'); assert.strictEqual(ax.series[0].lw, 2);
  assert.deepStrictEqual(ax.series[1].color, [0, 0.447, 0.741], 'an explicit color does not use up the color order');
  assert.strictEqual(ax.title, 'Waves'); assert.strictEqual(ax.xlabel, 't'); assert.deepStrictEqual(ax.legend.labels, ['sin', 'cos']); assert.ok(ax.grid);
  assert.strictEqual(f2.axes.length, 2); assert.strictEqual(f2.axes[0].series[0].kind, 'bar'); const s = f2.axes[1].series[0];
  assert.strictEqual(s.kind, 'surf'); assert.strictEqual(s.r, 20); assert.strictEqual(s.faceColor, 'interp'); assert.strictEqual(f2.colormap, 'jet'); assert.ok(f2.axes[1].view);
  const zmax = Math.max(...s.Z); assert.ok(zmax > 7 && zmax < 8.11, 'peaks maximum ≈ 8.1');
  assert.strictEqual(f5.axes[0].series.length, 1, 'hold is off, so histogram replaces the scatter'); assert.strictEqual(f5.axes[0].series[0].kind, 'hist');
});

t('rcond and singular-matrix warnings', () => {
  const r = lab('a = rcond([2 1; 1 3]); b = rcond(hilb(8)); x = magic(4) \\ [1; 2; 3; 4];');
  near(r.v('a'), 0.3125); // ‖A‖₁ = 4, ‖A⁻¹‖₁ = 0.8
  assert.ok(r.v('b') > 1e-11 && r.v('b') < 1e-10, 'hilb(8) is badly conditioned');
  assert.ok(/Warning: Matrix is close to singular or badly scaled/.test(r.out()), r.out());
});

t('NaN and Inf literals, NaN propagation', () => {
  const { v } = lab('a = [1 NaN 3]; b = any(isnan(a)); c = mean(a); d = max(a); e = [Inf -Inf]; f = isinf(e); g = NaN(2, 1); h = nnz(isnan(g));');
  near(v('b'), 1); near(v('c'), NaN); near(v('d'), 3); near(v('f'), [1, 1]); near(v('h'), 2);
});

t('peaks matches the formula at known points', () => {
  const { v } = lab('a = peaks(0, 0); [X, Y, Z] = peaks(3); b = Z(2,2); c = size(peaks);');
  near(v('a'), 3 * Math.exp(-1) - 1 / 3 * Math.exp(-1), 1e-12); near(v('b'), v('a'), 1e-12); near(v('c'), [49, 49]);
});

console.log(`\n${n} tests passed`);
