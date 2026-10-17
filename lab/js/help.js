// Lumen Lab — function reference used by `help`, the Function Browser and editor completion.
(function (root) {
  'use strict';
  // name: [syntax lines, one-line description]
  const CATS = {
    'Arrays & matrices': {
      zeros: ['Z = zeros(n)\nZ = zeros(m, n)', 'Array of zeros'], ones: ['O = ones(m, n)', 'Array of ones'], eye: ['I = eye(n)', 'Identity matrix'],
      rand: ['R = rand(m, n)', 'Uniform random numbers in (0,1)'], randn: ['R = randn(m, n)', 'Normally distributed random numbers'], randi: ['R = randi(imax, m, n)\nR = randi([a b], m, n)', 'Random integers'],
      rng: ['rng(seed)\nrng default', 'Seed the random number generator'], linspace: ['x = linspace(a, b, n)', 'Linearly spaced vector (n = 100 by default)'], logspace: ['x = logspace(a, b, n)', 'Logarithmically spaced vector'],
      magic: ['M = magic(n)', 'Magic square'], diag: ['D = diag(v)\nv = diag(A)', 'Diagonal matrix or diagonal of a matrix'], repmat: ['B = repmat(A, m, n)', 'Repeat copies of an array'],
      reshape: ['B = reshape(A, m, n)', 'Reshape (use [] for one size)'], meshgrid: ['[X, Y] = meshgrid(x, y)', '2-D grid coordinates'], cat: ['C = cat(dim, A, B)', 'Concatenate along a dimension'],
      size: ['sz = size(A)\n[m, n] = size(A)\nm = size(A, dim)', 'Array size'], numel: ['n = numel(A)', 'Number of elements'], length: ['n = length(A)', 'Length of the largest dimension'],
      isempty: ['tf = isempty(A)', 'True for an empty array'], fliplr: ['B = fliplr(A)', 'Flip left–right'], flipud: ['B = flipud(A)', 'Flip up–down'], rot90: ['B = rot90(A, k)', 'Rotate 90°'],
      circshift: ['B = circshift(A, k)', 'Circular shift'], tril: ['L = tril(A, k)', 'Lower triangle'], triu: ['U = triu(A, k)', 'Upper triangle'], kron: ['K = kron(A, B)', 'Kronecker product'],
      find: ['k = find(X)\n[r, c] = find(X)', 'Indices of nonzero elements'], sort: ['B = sort(A)\n[B, I] = sort(A, \'descend\')', 'Sort elements'], sortrows: ['B = sortrows(A, col)', 'Sort rows'],
      unique: ['[C, ia, ic] = unique(A)', 'Unique values (sorted)'], ismember: ['tf = ismember(A, S)', 'Membership test'], peaks: ['Z = peaks(n)\n[X, Y, Z] = peaks(n)', 'Sample function of two variables'],
    },
    'Math': {
      abs: ['y = abs(x)', 'Absolute value / magnitude'], sqrt: ['y = sqrt(x)', 'Square root (complex for negatives)'], exp: ['y = exp(x)', 'Exponential'], log: ['y = log(x)', 'Natural logarithm'],
      log10: ['y = log10(x)', 'Base-10 logarithm'], log2: ['y = log2(x)', 'Base-2 logarithm'], sin: ['y = sin(x)', 'Sine (radians)'], cos: ['y = cos(x)', 'Cosine (radians)'], tan: ['y = tan(x)', 'Tangent'],
      atan2: ['t = atan2(y, x)', 'Four-quadrant arctangent'], sind: ['y = sind(x)', 'Sine of degrees'], round: ['y = round(x)\ny = round(x, n)', 'Round to nearest'], floor: ['y = floor(x)', 'Round toward −∞'],
      ceil: ['y = ceil(x)', 'Round toward +∞'], fix: ['y = fix(x)', 'Round toward zero'], mod: ['m = mod(a, b)', 'Modulus (sign of b)'], rem: ['r = rem(a, b)', 'Remainder (sign of a)'],
      real: ['x = real(z)', 'Real part'], imag: ['y = imag(z)', 'Imaginary part'], conj: ['w = conj(z)', 'Complex conjugate'], angle: ['t = angle(z)', 'Phase angle'],
      gamma: ['y = gamma(x)', 'Gamma function'], factorial: ['y = factorial(n)', 'Factorial'], nchoosek: ['c = nchoosek(n, k)', 'Binomial coefficient'], erf: ['y = erf(x)', 'Error function'],
      primes: ['p = primes(n)', 'Primes up to n'], isprime: ['tf = isprime(n)', 'Prime test'], gcd: ['g = gcd(a, b)', 'Greatest common divisor'], lcm: ['l = lcm(a, b)', 'Least common multiple'],
      hypot: ['c = hypot(a, b)', 'sqrt(a.^2 + b.^2) without overflow'], sign: ['s = sign(x)', 'Sign function'],
    },
    'Linear algebra': {
      inv: ['Y = inv(A)', 'Matrix inverse'], det: ['d = det(A)', 'Determinant'], mldivide: ['x = A \\ b', 'Solve linear systems (least squares if not square)'], trace: ['t = trace(A)', 'Sum of the diagonal'],
      rank: ['r = rank(A)', 'Rank (via SVD)'], eig: ['e = eig(A)\n[V, D] = eig(A)', 'Eigenvalues and eigenvectors'], svd: ['s = svd(A)\n[U, S, V] = svd(A)\n[U, S, V] = svd(A, \'econ\')', 'Singular value decomposition'],
      lu: ['[L, U, P] = lu(A)', 'LU factorization with pivoting'], qr: ['[Q, R] = qr(A)', 'QR factorization'], chol: ['R = chol(A)', 'Cholesky factorization (R\'*R = A)'],
      pinv: ['B = pinv(A)', 'Pseudoinverse'], null: ['Z = null(A)', 'Null space basis'], orth: ['Q = orth(A)', 'Range basis'], norm: ['n = norm(v)\nn = norm(A, p)', 'Vector and matrix norms (1, 2, Inf, \'fro\')'],
      cond: ['c = cond(A)', 'Condition number'], expm: ['E = expm(A)', 'Matrix exponential'], dot: ['d = dot(a, b)', 'Dot product'], cross: ['c = cross(a, b)', 'Cross product'],
      transpose: ["B = A.'", 'Transpose'],
    },
    'Statistics & data': {
      sum: ['s = sum(A)\ns = sum(A, dim)\ns = sum(A, \'all\')', 'Sum of elements'], prod: ['p = prod(A)', 'Product of elements'], mean: ['m = mean(A, dim)', 'Average'], median: ['m = median(A)', 'Median'],
      mode: ['m = mode(A)', 'Most frequent value'], std: ['s = std(A)', 'Standard deviation'], var: ['v = var(A)', 'Variance'], max: ['m = max(A)\n[m, i] = max(A)\nC = max(A, B)', 'Maximum'],
      min: ['m = min(A)\n[m, i] = min(A)', 'Minimum'], cumsum: ['B = cumsum(A)', 'Cumulative sum'], cumprod: ['B = cumprod(A)', 'Cumulative product'], diff: ['D = diff(x, n)', 'Differences'],
      histcounts: ['[N, edges] = histcounts(x, nbins)', 'Histogram bin counts'], cov: ['C = cov(x, y)', 'Covariance'], corrcoef: ['R = corrcoef(x, y)', 'Correlation coefficients'],
      trapz: ['Q = trapz(x, y)', 'Trapezoidal integration'], cumtrapz: ['Q = cumtrapz(x, y)', 'Cumulative trapezoidal integration'], any: ['tf = any(A)', 'True if any element is nonzero'], all: ['tf = all(A)', 'True if all elements are nonzero'],
      prctile: ['p = prctile(x, [25 50 75])', 'Percentiles'], quantile: ['q = quantile(x, 0.9)', 'Quantiles'], iqr: ['r = iqr(x)', 'Interquartile range'],
      zscore: ['[z, mu, sigma] = zscore(x)', 'Standardized scores'], normalize: ["y = normalize(x)\ny = normalize(x, 'range')", 'Scale data (zscore, range, center, norm)'], rescale: ['y = rescale(x, a, b)', 'Rescale to an interval'],
      skewness: ['s = skewness(x)', 'Skewness'], kurtosis: ['k = kurtosis(x)', 'Kurtosis'], mad: ['d = mad(x)\nd = mad(x, 1)', 'Mean (or median) absolute deviation'], corr: ['r = corr(x, y)', 'Correlation of two vectors'],
      movmean: ['y = movmean(x, k)', 'Moving average (also movsum, movmedian, movmax, movmin, movstd)'], smoothdata: ["y = smoothdata(x, 'gaussian', k)", 'Smooth noisy data'],
      normpdf: ['y = normpdf(x, mu, sigma)', 'Normal density'], normcdf: ['p = normcdf(x, mu, sigma)', 'Normal cumulative probability'], norminv: ['x = norminv(p, mu, sigma)', 'Normal quantile'],
      nanmean: ["m = nanmean(x)   % = mean(x, 'omitnan')", "Statistics ignoring NaN (also nansum, nanstd, nanmedian; or pass 'omitnan')"],
    },
    'Signals & polynomials': {
      fft: ['Y = fft(x)\nY = fft(x, n)', 'Fast Fourier transform (any length)'], ifft: ['x = ifft(Y)', 'Inverse FFT'], fftshift: ['Y = fftshift(X)', 'Shift zero frequency to the center'],
      filter: ['y = filter(b, a, x)', '1-D digital filter'], conv: ['w = conv(u, v)\nw = conv(u, v, \'same\')', 'Convolution / polynomial multiplication'], deconv: ['[q, r] = deconv(b, a)', 'Polynomial division'],
      polyfit: ['p = polyfit(x, y, n)', 'Least-squares polynomial fit'], polyval: ['y = polyval(p, x)', 'Evaluate a polynomial'], roots: ['r = roots(p)', 'Polynomial roots'], poly: ['p = poly(r)', 'Polynomial from roots'],
      polyder: ['dp = polyder(p)', 'Polynomial derivative'], polyint: ['ip = polyint(p)', 'Polynomial integral'],
      interp1: ['yq = interp1(x, y, xq)\nyq = interp1(x, y, xq, method)', "1-D interpolation: 'linear', 'nearest', 'spline', 'pchip', 'previous', 'next'"], spline: ['yq = spline(x, y, xq)', 'Not-a-knot cubic spline'],
      pchip: ['yq = pchip(x, y, xq)', 'Shape-preserving cubic'], interp2: ['Zq = interp2(X, Y, Z, Xq, Yq)', 'Bilinear 2-D interpolation'],
      butter: ["[b, a] = butter(n, Wn)\n[b, a] = butter(n, Wn, 'high')\n[b, a] = butter(n, [w1 w2], 'bandpass')", 'Butterworth filter design (Wn: 1 = Nyquist)'], filtfilt: ['y = filtfilt(b, a, x)', 'Zero-phase filtering'],
      freqz: ['[h, w] = freqz(b, a, n)\nfreqz(b, a)', 'Frequency response (plots without outputs)'], findpeaks: ["[pks, locs, w, p] = findpeaks(y, x, 'MinPeakHeight', h, 'MinPeakDistance', d)", 'Find local maxima'],
      xcorr: ["[r, lags] = xcorr(x, y, 'normalized')", 'Cross-correlation'], hann: ['w = hann(n)', 'Window functions (also hamming, blackman, rectwin)'], detrend: ['y = detrend(x)', 'Remove a linear trend'], unwrap: ['p = unwrap(phase)', 'Unwrap phase angles'],
    },
    'Calculus & optimization': {
      ode45: ['[t, y] = ode45(@(t,y) f, [t0 tf], y0)\n[t, y] = ode45(f, tspan, y0, odeset(\'RelTol\', 1e-6))', 'Solve ODEs (Dormand–Prince 4/5)'], ode23: ['[t, y] = ode23(f, tspan, y0)', 'Solve ODEs (Bogacki–Shampine 2/3)'],
      odeset: ["opts = odeset('RelTol', 1e-6, 'AbsTol', 1e-9)", 'ODE solver options'], fzero: ['x = fzero(f, x0)\nx = fzero(f, [a b])', 'Root of a function of one variable'],
      fminsearch: ['x = fminsearch(f, x0)', 'Minimize without derivatives (Nelder–Mead)'], fminbnd: ['x = fminbnd(f, a, b)', 'Minimize on an interval'],
      integral: ['q = integral(f, a, b)', 'Numerical integration (infinite limits allowed)'],
      ode23s: ['[t, y] = ode23s(f, tspan, y0)', 'Stiff ODE solver (Rosenbrock); ode15s uses it too'], fsolve: ['x = fsolve(@(x) F(x), x0)', 'Solve nonlinear equations F(x) = 0'],
      lsqcurvefit: ['p = lsqcurvefit(@(p, x) model, p0, xdata, ydata)', 'Nonlinear least-squares curve fitting'], lsqnonlin: ['x = lsqnonlin(@(x) residuals, x0)', 'Nonlinear least squares'], fminunc: ['[x, fval] = fminunc(f, x0)', 'Unconstrained minimization (BFGS)'], integral2: ['q = integral2(f, xmin, xmax, ymin, ymax)', 'Double integral'], gradient: ['g = gradient(y, h)', 'Numerical gradient'],
    },
    'Plotting': {
      plot: ["plot(y)\nplot(x, y, 'r--o')\nplot(x, y, 'LineWidth', 2)", '2-D line plot'], plot3: ['plot3(x, y, z)', '3-D line plot'], scatter: ["scatter(x, y, sz, c, 'filled')", 'Scatter plot'], scatter3: ['scatter3(x, y, z)', '3-D scatter'],
      bar: ["bar(y)\nbar(x, Y, 'stacked')", 'Bar chart'], barh: ['barh(y)', 'Horizontal bars'], histogram: ['histogram(x, nbins)', 'Histogram'], stem: ['stem(x, y)', 'Stem plot'], stairs: ['stairs(x, y)', 'Stairstep plot'],
      area: ['area(x, y)', 'Filled area'], errorbar: ['errorbar(x, y, err)', 'Error bars'], pie: ['pie(x)', 'Pie chart'], fill: ['fill(x, y, c)', 'Filled polygon'], quiver: ['quiver(X, Y, U, V)', 'Vector field arrows'],
      surf: ['surf(Z)\nsurf(X, Y, Z)', '3-D shaded surface'], mesh: ['mesh(X, Y, Z)', '3-D mesh'], contour: ['contour(X, Y, Z, n)', 'Contour lines'], contourf: ['contourf(X, Y, Z, n)', 'Filled contours'],
      imagesc: ['imagesc(C)', 'Image with scaled colors'], fplot: ['fplot(@(x) f, [a b])', 'Plot a function'], semilogy: ['semilogy(x, y)', 'Log-scale y axis'], semilogx: ['semilogx(x, y)', 'Log-scale x axis'], loglog: ['loglog(x, y)', 'Log–log plot'],
      polarplot: ['polarplot(theta, rho)', 'Polar plot'], figure: ['figure\nfigure(n)', 'New or numbered figure'], subplot: ['subplot(m, n, p)', 'Tile axes in a figure'], hold: ['hold on\nhold off', 'Keep plots when adding new ones'],
      title: ["title('text')", 'Axes title'], xlabel: ["xlabel('text')", 'x-axis label'], ylabel: ["ylabel('text')", 'y-axis label'], zlabel: ["zlabel('text')", 'z-axis label'], legend: ["legend('a', 'b')\nlegend('Location', 'southwest')", 'Legend'],
      grid: ['grid on\ngrid minor', 'Grid lines'], yyaxis: ['yyaxis left\nyyaxis right', 'Two y axes in one plot'], axis: ['axis([xmin xmax ymin ymax])\naxis equal\naxis tight', 'Axis limits and aspect'], xlim: ['xlim([a b])', 'x-axis limits'], ylim: ['ylim([a b])', 'y-axis limits'],
      view: ['view(az, el)\nview(2)\nview(3)', '3-D viewpoint'], colormap: ['colormap jet\ncolormap(parula(64))', 'Color map (parula, jet, viridis, turbo, hot, cool, gray…)'], colorbar: ['colorbar', 'Color scale'],
      shading: ['shading interp', "Surface shading: 'flat', 'interp', 'faceted'"], text: ["text(x, y, 'label')", 'Text in the axes'], xline: ["xline(x, '--', 'label')", 'Vertical reference line'], yline: ['yline(y)', 'Horizontal reference line'],
      close: ['close\nclose all', 'Close figures'], clf: ['clf', 'Clear the figure'], saveas: ["saveas(gcf, 'plot.png')", 'Save a figure as PNG'], drawnow: ['drawnow', 'Update figures now (animations)'], pause: ['pause(sec)', 'Wait (figures update first)'],
    },
    'Text & output': {
      disp: ['disp(X)', 'Display a value'], fprintf: ["fprintf('%d items, %.2f each\\n', n, p)", 'Formatted output'], sprintf: ["s = sprintf('%5.2f', x)", 'Formatted text'],
      num2str: ['s = num2str(x)\ns = num2str(x, precision)', 'Number to text'], str2double: ['x = str2double(s)', 'Text to number'], mat2str: ['s = mat2str(A)', 'Matrix to text'], strcat: ['s = strcat(a, b)', 'Join text'],
      strsplit: ['c = strsplit(s, delim)', 'Split text'], strjoin: ['s = strjoin(c, delim)', 'Join a cell array of text'], strrep: ['s = strrep(s, old, new)', 'Replace text'], strcmp: ['tf = strcmp(a, b)', 'Compare text'],
      upper: ['s = upper(s)', 'Upper case'], lower: ['s = lower(s)', 'Lower case'], strtrim: ['s = strtrim(s)', 'Remove surrounding whitespace'], regexprep: ['s = regexprep(s, expr, rep)', 'Regular-expression replace'],
      format: ['format long\nformat short', 'Display precision'], input: ["x = input('Enter a value: ')", 'Ask for input in the Command Window'],
    },
    'Cells, structs & functions': {
      cell: ['c = cell(m, n)', 'Empty cell array'], cellfun: ["r = cellfun(@f, c)\nr = cellfun(@f, c, 'UniformOutput', false)", 'Apply a function to each cell'], arrayfun: ['r = arrayfun(@f, A)', 'Apply a function to each element'],
      struct: ["s = struct('a', 1, 'b', 'x')", 'Structure'], fieldnames: ['f = fieldnames(s)', 'Field names'], isfield: ["tf = isfield(s, 'a')", 'Field test'], rmfield: ["s = rmfield(s, 'a')", 'Remove a field'],
      feval: ["y = feval(@f, x)\ny = feval('sin', x)", 'Call a function'], func2str: ['s = func2str(f)', 'Function handle to text'], str2func: ["f = str2func('@(x) x.^2')", 'Text to function handle'],
      error: ["error('msg %d', n)\nerror('id:part', 'msg')", 'Throw an error'], warning: ["warning('msg')", 'Show a warning'], tic: ['tic', 'Start a stopwatch'], toc: ['t = toc', 'Elapsed time'],
      nargin: ['n = nargin', 'Number of inputs passed to a function'], exist: ["e = exist('name')", 'Is it a variable (1), file (2) or built-in (5)?'],
    },
    'Files & workspace': {
      readmatrix: ["A = readmatrix('data.csv')", 'Read a numeric table (header row skipped)'],
      fopen: ["fid = fopen('log.txt', 'w')", 'Open a file in the Current Folder (r, w, a)'], fclose: ['fclose(fid)', 'Close a file'], fgetl: ['line = fgetl(fid)', 'Read a line (-1 at the end)'], fscanf: ["v = fscanf(fid, '%f')", 'Read numbers from a file'], csvread: ["A = csvread('data.csv', r0, c0)", 'Read CSV with offsets'], writematrix: ["writematrix(A, 'out.csv')", 'Write a matrix as CSV'],
      load: ["load data.csv\nS = load('ws.lmat')", 'Load data or a saved workspace'], save: ["save('ws.lmat')\nsave('ws.lmat', 'x', 'y')", 'Save the workspace'], clear: ['clear\nclear x y', 'Remove variables'],
      who: ['who', 'List variables'], whos: ['whos', 'List variables with sizes'], clc: ['clc', 'Clear the Command Window'], ls: ['ls', 'Files in the current folder'], type: ['type name.m', 'Show a file'],
      help: ['help name', 'Help for a function'],
    },
  };
  const FN = {};
  for (const c in CATS) for (const k in CATS[c]) if (CATS[c][k]) FN[k] = CATS[c][k];
  function overview() {
    return 'Lumen Lab — a MATLAB-style numeric computing language.\n\n' + Object.keys(CATS).map(c => '  ' + c + ':\n    ' + Object.keys(CATS[c]).filter(k => CATS[c][k]).join(', ').replace(/(.{1,90})(, |$)/g, '$1,\n    ').replace(/,\n    $/, '')).join('\n\n') + '\n\nType "help name" for details on one function.';
  }
  const api = { CATS, FN, overview };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.LabHelp = api;
})(typeof self !== 'undefined' ? self : this);
