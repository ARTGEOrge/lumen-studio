// Lumen Lab — sample folder: scripts that show the language, the library and the plots.
(function () {
  'use strict';
  const welcome = `%% Welcome to Lumen Lab
% Press F5 to run this whole script, or click in a section and press
% Ctrl+Enter to run just that section. Variables appear in the Workspace,
% plots in the Figures panel (drag a 3-D plot to rotate it).

%% Matrices and linear algebra
A = magic(4)
x = A(1:3, 1:3) \\ [1; 2; 3]      % solve a linear system
lambda = eig(A)'                  % eigenvalues
[U, S, V] = svd(A(1:3, 1:3));
sigma = diag(S)'

%% A noisy signal, its spectrum and a fitted envelope
fs = 500;                          % sample rate (Hz)
t = (0:999) / fs;
y = exp(-1.2*t) .* sin(2*pi*12*t) + 0.35*sin(2*pi*40*t);
Y = abs(fft(y)) / numel(y);
f = (0:numel(y)-1) * fs / numel(y);
[~, k] = max(Y(1:500));
fprintf('Strongest component: %.1f Hz\\n', f(k));

%% Plots: a surface and the signal
figure(1); clf
subplot(2, 1, 1)
[X, Yg, Z] = peaks(40);
surf(X, Yg, Z); shading interp; colorbar
title('peaks(40)'); xlabel('x'); ylabel('y'); zlabel('z')

subplot(2, 1, 2)
plot(t, y, 'LineWidth', 1.1); hold on
plot(t, exp(-1.2*t), 'r--', t, -exp(-1.2*t), 'r--'); hold off
grid on; xlim([0 1.2])
title('Damped 12 Hz signal with a 40 Hz ripple')
xlabel('Time (s)'); ylabel('Amplitude')
legend('signal', 'envelope')
`;
  const lorenz = `%% Lorenz attractor — ode45 on a chaotic system
sigma = 10; beta = 8/3; rho = 28;
f = @(t, u) [sigma*(u(2) - u(1));
             u(1)*(rho - u(3)) - u(2);
             u(1)*u(2) - beta*u(3)];
[t, u] = ode45(f, [0 40], [1; 1; 1]);
fprintf('%d steps, final state [%.3f %.3f %.3f]\\n', numel(t), u(end, :));

figure(2); clf
plot3(u(:,1), u(:,2), u(:,3), 'LineWidth', 0.8)
grid on; view(-35, 22)
title('Lorenz attractor'); xlabel('x'); ylabel('y'); zlabel('z')
`;
  const curvefit = `%% Curve fitting with polyfit and interp1
% measurements.csv has a header row (time, value) and 21 noisy samples.
data = readmatrix('measurements.csv');
t = data(:, 1);  v = data(:, 2);

p = polyfit(t, v, 2);                 % quadratic least-squares fit
tt = linspace(0, 10, 200);
fitted = polyval(p, tt);
resid = v - polyval(p, t);
fprintf('v(t) = %.3f t^2 %+.3f t %+.3f   (rms residual %.3f)\\n', p, sqrt(mean(resid.^2)));

vs = interp1(t, v, tt, 'spline');     % smooth interpolant through the data

figure(3); clf
subplot(2, 1, 1)
plot(t, v, 'ko', 'MarkerFaceColor', [0.3 0.6 0.9]); hold on
plot(tt, fitted, 'LineWidth', 1.6)
plot(tt, vs, ':', 'LineWidth', 1.2); hold off
grid on; legend('data', 'quadratic fit', 'spline', 'Location', 'northwest')
title('Measurements'); xlabel('t'); ylabel('v')
subplot(2, 1, 2)
stem(t, resid, 'filled'); grid on
title('Residuals'); xlabel('t')
`;
  const contours = `%% Contours, gradients and a filled map
[x, y] = meshgrid(linspace(-2, 2, 80));
z = x .* exp(-x.^2 - y.^2) + 0.2*(x.^2 + y.^2);

figure(4); clf
subplot(1, 2, 1)
contourf(x, y, z, 14); colorbar; axis equal tight
title('contourf'); xlabel('x'); ylabel('y')
subplot(1, 2, 2)
contour(x, y, z, 20); hold on
[xs, ys] = meshgrid(linspace(-2, 2, 15));
zs = xs .* exp(-xs.^2 - ys.^2) + 0.2*(xs.^2 + ys.^2);
[gx, gy] = deal(zeros(size(zs)));
h = xs(1, 2) - xs(1, 1);
gx(:, 2:end-1) = (zs(:, 3:end) - zs(:, 1:end-2)) / (2*h);
gy(2:end-1, :) = (zs(3:end, :) - zs(1:end-2, :)) / (2*h);
quiver(xs, ys, -gx, -gy); hold off; axis equal tight
title('Downhill directions')

[zmin, k] = min(z(:));
fprintf('Minimum %.4f at (%.3f, %.3f)\\n', zmin, x(k), y(k));
`;
  const projectile = `%% Functions: a projectile with drag
% Local functions live at the end of a script. Lumen Lab also finds
% functions saved as their own .m files in the Current Folder.
v0 = 40;  angles = 20:5:70;
range = zeros(size(angles));
for k = 1:numel(angles)
    range(k) = flightRange(v0, angles(k), 0.02);
end
[best, i] = max(range);
fprintf('Best launch angle with drag: %d degrees (%.1f m)\\n', angles(i), best);

figure(5); clf
bar(angles, range, 0.6); grid on
title(sprintf('Range for v_0 = %d m/s', v0)); xlabel('Launch angle (deg)'); ylabel('Range (m)')

function R = flightRange(v0, deg, k)
    % Integrate until the projectile lands, then find the landing time with fzero.
    f = @(t, s) [s(3); s(4); -k*s(3)*hypot(s(3), s(4)); -9.81 - k*s(4)*hypot(s(3), s(4))];
    s0 = [0; 0; v0*cosd(deg); v0*sind(deg)];
    [t, s] = ode45(f, [0 10], s0);
    land = find(s(2:end, 2) < 0, 1) + 1;
    if isempty(land), R = s(end, 1); return; end
    yfun = @(tt) interp1(t, s(:, 2), tt, 'spline');
    tl = fzero(yfun, [t(land-1) t(land)]);
    R = interp1(t, s(:, 1), tl);
end
`;
  const stats = `%% Random numbers and statistics
rng(42)
samples = 2 + 0.8*randn(1, 2000);
fprintf('mean %.3f, std %.3f, median %.3f\\n', mean(samples), std(samples), median(samples));

figure(6); clf
subplot(2, 1, 1)
histogram(samples, 30); hold on
xline(mean(samples), 'r--', 'mean'); hold off
title('2000 normal samples'); grid on
subplot(2, 1, 2)
scores = [72 85 90; 64 78 88; 80 82 95];
bar(scores); legend('Q1', 'Q2', 'Q3', 'Location', 'northwest'); grid on
title('Grouped bars'); xlabel('Team')
`;
  const signals = `%% Signal processing: filter design, zero-phase filtering and peak finding
fs = 200;  t = (0:599) / fs;
rng(7)
x = sin(2*pi*3*t) + 0.5*sin(2*pi*9*t) + 0.4*randn(size(t));

[b, a] = butter(4, 12 / (fs/2));       % 12 Hz low-pass
y = filtfilt(b, a, x);                 % no phase lag
[pks, locs] = findpeaks(y, t, 'MinPeakProminence', 0.8);
fprintf('%d peaks in 3 s (the main tone is 3 Hz)\\n', numel(pks));

figure(7); clf
subplot(2, 1, 1)
plot(t, x, 'Color', [0.7 0.7 0.7]); hold on
plot(t, y, 'LineWidth', 1.4)
plot(locs, pks, 'rv', 'MarkerFaceColor', 'r'); hold off
grid on; legend('noisy', 'filtfilt', 'peaks'); title('Butterworth low-pass + findpeaks'); xlabel('Time (s)')

subplot(2, 1, 2)
[h, w] = freqz(b, a, 256, fs);
yyaxis left;  plot(w, 20*log10(abs(h))); ylabel('Magnitude (dB)'); ylim([-80 5])
yyaxis right; plot(w, unwrap(angle(h)) * 180/pi); ylabel('Phase (deg)')
grid on; title('Filter response'); xlabel('Frequency (Hz)')
`;
  // deterministic "noisy" data for the curve-fitting sample
  function measurements() {
    let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const rows = ['time,value'];
    for (let i = 0; i <= 20; i++) { const t = i / 2, noise = (rnd() + rnd() + rnd() - 1.5) * 1.2; rows.push(`${t},${(0.5 * t * t - 2 * t + 3 + noise).toFixed(3)}`); }
    return rows.join('\n') + '\n';
  }
  window.LabSamples = {
    files: () => ({ 'welcome.m': welcome, 'lorenz.m': lorenz, 'curvefit.m': curvefit, 'contours.m': contours, 'projectile.m': projectile, 'statistics.m': stats, 'signals.m': signals, 'measurements.csv': measurements() }),
    first: 'welcome.m',
  };
})();
