// Lumen Flow post-processing & geometry helpers (no DOM — runs in Node for the tests):
// spectra of monitor-point signals, surface pressure coefficients, point sampling, and polygon / SVG obstacles.
(function (root) {
  'use strict';

  // ---------- signals ----------
  // in-place radix-2 FFT (re, im have power-of-two length)
  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) {
      const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const p = i + k, q = p + len / 2, tr = re[q] * cr - im[q] * ci, ti = re[q] * ci + im[q] * cr;
          re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  // amplitude spectrum of a signal sampled at (possibly uneven) times: linear resampling onto an even grid,
  // mean removed, Hann window, zero-padded FFT. The peak is refined by parabolic interpolation of the log-amplitude.
  function spectrum(times, values) {
    const m = Math.min(times.length, values.length); if (m < 8) return null;
    const t0 = times[0], t1 = times[m - 1]; if (!(t1 > t0)) return null;
    const ns = Math.min(8192, Math.max(16, m)), dt = (t1 - t0) / (ns - 1), s = new Float64Array(ns);
    for (let i = 0, k = 0; i < ns; i++) { const t = t0 + i * dt; while (k < m - 2 && times[k + 1] < t) k++; const a = (t - times[k]) / ((times[k + 1] - times[k]) || 1); s[i] = values[k] + (values[k + 1] - values[k]) * Math.max(0, Math.min(1, a)); }
    let mean = 0; for (let i = 0; i < ns; i++) mean += s[i]; mean /= ns;
    let N = 1; while (N < ns * 4) N <<= 1;
    const re = new Float64Array(N), im = new Float64Array(N); let wsum = 0;
    for (let i = 0; i < ns; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (ns - 1)); re[i] = (s[i] - mean) * w; wsum += w; }
    fft(re, im);
    const half = N / 2, freq = new Float64Array(half), amp = new Float64Array(half);
    for (let k = 0; k < half; k++) { freq[k] = k / (N * dt); amp[k] = 2 * Math.hypot(re[k], im[k]) / wsum; }
    let pk = 1; for (let k = 2; k < half - 1; k++) if (amp[k] > amp[pk]) pk = k;
    let peak = freq[pk];
    if (pk > 0 && pk < half - 1 && amp[pk - 1] > 0 && amp[pk + 1] > 0) { const a = Math.log(amp[pk - 1]), b = Math.log(amp[pk]), c = Math.log(amp[pk + 1]), d = a - 2 * b + c; if (d < 0) peak = (pk + 0.5 * (a - c) / d) / (N * dt); }
    return { freq, amp, peak, peakAmp: amp[pk], mean, dt, duration: t1 - t0 };
  }

  // ---------- sampling ----------
  // bilinear sample of a cell-centred field (solid cells are skipped when they are neighbours of fluid)
  function sampleCentre(f, arr, x, y) {
    const { nx, ny, dx, dy, W } = f, fi = Math.min(nx - 1e-9, Math.max(0, x / dx - 0.5)) + 1, fj = Math.min(ny - 1e-9, Math.max(0, y / dy - 0.5)) + 1;
    const i = Math.max(1, Math.min(nx - 1, Math.floor(fi))), j = Math.max(1, Math.min(ny - 1, Math.floor(fj))), a = Math.max(0, Math.min(1, fi - i)), b = Math.max(0, Math.min(1, fj - j)), k = j * W + i;
    const ks = [k, k + 1, k + W, k + W + 1], ws = [(1 - a) * (1 - b), a * (1 - b), (1 - a) * b, a * b]; let s = 0, w = 0;
    for (let q = 0; q < 4; q++) if (!f.solid[ks[q]] && ws[q] > 0) { s += arr[ks[q]] * ws[q]; w += ws[q]; }
    return w > 0 ? s / w : arr[k];
  }
  // everything a monitor point records: velocity, speed, gauge pressure (Pa) and temperature
  function probe(f, x, y) {
    const [u, v] = f.velAt(x, y);
    return { u, v, speed: Math.hypot(u, v), p: sampleCentre(f, f.p, x, y) * f.rho, T: f.heat ? sampleCentre(f, f.T, x, y) : NaN };
  }

  // ---------- surface pressure ----------
  // free-stream reference pressure: mean over the first fluid column when the left side is an inlet,
  // otherwise the mean over all fluid cells (kinematic, p/ρ)
  function refPressure(f) {
    const { nx, ny, W } = f; let s = 0, n = 0;
    if (f.sides.left.type === 'inlet') { for (let j = 1; j <= ny; j++) if (!f.solid[j * W + 1]) { s += f.p[j * W + 1]; n++; } }
    else for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) if (!f.solid[j * W + i]) { s += f.p[j * W + i]; n++; }
    return n ? s / n : 0;
  }
  // pressure coefficient on every body face that touches fluid: Cp = (p − p∞) / (½ U²), with the outward unit
  // normal, face length and a position along the body: angle from the front stagnation point (circles) or x/c.
  function surfaceCp(f, U, opts = {}) {
    const { nx, ny, W, dx, dy, p } = f, s = f.solid, pinf = opts.pinf != null ? opts.pinf : refPressure(f), q = 0.5 * U * U || 1, faces = [];
    let x0 = Infinity, x1 = -Infinity;
    const colLo = new Int32Array(nx + 2).fill(1e9), colHi = new Int32Array(nx + 2).fill(-1);
    for (let j = 1; j <= ny; j++) for (let i = 1; i <= nx; i++) { const k = j * W + i; if (!s[k]) continue; const fx = i - 0.5;
      if (j < colLo[i]) colLo[i] = j; if (j > colHi[i]) colHi[i] = j;
      const add = (fi, fj, nX, nY, len, px, py) => { if (!f.isFluid(fi, fj)) return; faces.push({ x: px, y: py, nx: nX, ny: nY, ds: len, i, j, Cp: (p[fj * W + fi] - pinf) / q }); };
      add(i + 1, j, 1, 0, dy, i * dx, (j - 0.5) * dy); add(i - 1, j, -1, 0, dy, (i - 1) * dx, (j - 0.5) * dy);
      add(i, j + 1, 0, 1, dx, (i - 0.5) * dx, j * dy); add(i, j - 1, 0, -1, dx, (i - 0.5) * dx, (j - 1) * dy);
      void fx;
    }
    for (const fc of faces) { x0 = Math.min(x0, fc.x); x1 = Math.max(x1, fc.x); }
    const c = x1 - x0 || 1, circ = opts.circle;
    for (const fc of faces) {
      const mid = (colLo[fc.i] + colHi[fc.i] - 1) / 2 * dy;   // centre of the solid span in this column
      fc.upper = fc.ny > 0 || (fc.ny === 0 && fc.y >= mid);
      fc.xc = (fc.x - x0) / c;
      if (circ) { const a = Math.atan2(fc.y - circ.y, -(fc.x - circ.x)) * 180 / Math.PI; fc.theta = Math.abs(a); fc.upper = a >= 0; }
    }
    return { faces, pinf, chord: c, x0 };
  }
  // pressure force from a Cp distribution (per unit depth, N/m): F = −∮ (p − p∞) n ds
  function cpForce(faces, rho, U) { const q = 0.5 * rho * U * U; let fx = 0, fy = 0; for (const fc of faces) { fx -= fc.Cp * q * fc.nx * fc.ds; fy -= fc.Cp * q * fc.ny * fc.ds; } return [fx, fy]; }

  // ---------- polygons ----------
  function pointInPolys(polys, x, y) {   // even–odd rule over all rings (holes work)
    let inside = false;
    for (const P of polys) for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside; }
    return inside;
  }
  const MAXPTS = 20000;
  // validate polygons from an untrusted source: arrays of ≥3 finite [x, y] pairs, bounded total size
  function sanitizePolys(polys) {
    if (!Array.isArray(polys)) return null; const out = []; let total = 0;
    for (const P of polys) { if (!Array.isArray(P)) continue; const R = []; for (const q of P) { if (!Array.isArray(q) || q.length < 2) continue; const x = +q[0], y = +q[1]; if (isFinite(x) && isFinite(y)) R.push([x, y]); } if (R.length >= 3) { total += R.length; if (total > MAXPTS) break; out.push(R); } }
    return out.length ? out : null;
  }
  // centre the shape on its bounding box and scale it so its width (x extent) is 1; aspect = height / width
  function normalizePolys(polys) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const P of polys) for (const [x, y] of P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const w = x1 - x0, h = y1 - y0, s = Math.max(w, 1e-12), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (!(w > 0) || !(h > 0)) return null;
    return { polys: polys.map(P => P.map(([x, y]) => [+((x - cx) / s).toFixed(6), +((y - cy) / s).toFixed(6)])), width: w, height: h, cx, cy, aspect: h / w };
  }
  // obstacle predicate for { polys (normalised), x, y (centre, m), size (width, m), angle (deg, nose up) }
  function polygonInside(o) {
    const a = (o.angle || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), s = o.size || 1, polys = o.polys || [];
    const bb = polys.flat(); let r = 0; for (const [x, y] of bb) r = Math.max(r, Math.hypot(x, y)); r *= s;
    return (x, y) => { const X = x - o.x, Y = y - o.y; if (X * X + Y * Y > r * r) return false; return pointInPolys(polys, (X * ca - Y * sa) / s, (X * sa + Y * ca) / s); };
  }
  // plain text: one "x, y" (or "x y") pair per line; a blank line or a line with text starts a new polygon
  function parsePolygonText(text) {
    const polys = []; let cur = [];
    for (const line of String(text).split(/\r?\n/)) {
      const m = line.trim().match(/^(-?[\d.]+(?:e[-+]?\d+)?)[\s,;\t]+(-?[\d.]+(?:e[-+]?\d+)?)/i);
      if (m && isFinite(+m[1]) && isFinite(+m[2])) cur.push([+m[1], +m[2]]); else if (cur.length) { polys.push(cur); cur = []; }
    }
    if (cur.length) polys.push(cur);
    return sanitizePolys(polys);
  }

  // ---------- SVG ----------
  const mul = (A, B) => [A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1], A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3], A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5]];
  const ID = [1, 0, 0, 1, 0, 0];
  function parseTransform(str) {
    let M = ID; const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g; let m;
    while ((m = re.exec(str || ''))) {
      const a = (m[2].match(/-?[\d.]+(?:e[-+]?\d+)?/gi) || []).map(Number); let T = ID;
      if (m[1] === 'matrix' && a.length >= 6) T = a.slice(0, 6);
      else if (m[1] === 'translate') T = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
      else if (m[1] === 'scale') T = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
      else if (m[1] === 'rotate') { const r = (a[0] || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), cx = a[1] || 0, cy = a[2] || 0; T = mul(mul([1, 0, 0, 1, cx, cy], [c, s, -s, c, 0, 0]), [1, 0, 0, 1, -cx, -cy]); }
      else if (m[1] === 'skewX') T = [1, 0, Math.tan((a[0] || 0) * Math.PI / 180), 1, 0, 0];
      else if (m[1] === 'skewY') T = [1, Math.tan((a[0] || 0) * Math.PI / 180), 0, 1, 0, 0];
      if (T.some(v => !isFinite(v))) continue; M = mul(M, T);
    }
    return M;
  }
  const attr = (s, name) => { const m = s.match(new RegExp('(?:^|\\s)' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\')')); return m ? (m[2] ?? m[3]) : null; };
  const num = (s, name, d = 0) => { const v = parseFloat(attr(s, name)); return isFinite(v) ? v : d; };
  // flatten an SVG path "d" string into closed rings (curves become 16 segments, arcs follow the SVG spec)
  function pathRings(d) {
    const tok = String(d).match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []; let i = 0, cmd = '';
    const rings = []; let ring = [], x = 0, y = 0, sx = 0, sy = 0, cpx = 0, cpy = 0, prev = '';
    const N = () => { const v = +tok[i++]; return isFinite(v) ? v : 0; }, isNum = () => i < tok.length && !/[a-zA-Z]/.test(tok[i]);
    const flush = () => { if (ring.length >= 3) rings.push(ring); ring = []; };
    const curve = (pts, fn) => { for (let k = 1; k <= 16; k++) ring.push(fn(k / 16)); void pts; };
    while (i < tok.length) {
      if (/[a-zA-Z]/.test(tok[i])) cmd = tok[i++]; else if (!cmd) { i++; continue; }
      const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase(), ox = rel ? x : 0, oy = rel ? y : 0;
      if (C === 'Z') { x = sx; y = sy; flush(); prev = 'Z'; continue; }
      if (!isNum()) { cmd = ''; continue; }
      if (C === 'M') { flush(); x = ox + N(); y = oy + N(); sx = x; sy = y; ring.push([x, y]); cmd = rel ? 'l' : 'L'; }
      else if (C === 'L') { x = ox + N(); y = oy + N(); ring.push([x, y]); }
      else if (C === 'H') { x = ox + N(); ring.push([x, y]); }
      else if (C === 'V') { y = oy + N(); ring.push([x, y]); }
      else if (C === 'C' || C === 'S') {
        let x1, y1; if (C === 'C') { x1 = ox + N(); y1 = oy + N(); } else { x1 = /[CS]/.test(prev) ? 2 * x - cpx : x; y1 = /[CS]/.test(prev) ? 2 * y - cpy : y; }
        const x2 = ox + N(), y2 = oy + N(), x3 = ox + N(), y3 = oy + N(), X = x, Y = y;
        curve(0, t => { const u = 1 - t; return [u * u * u * X + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3, u * u * u * Y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3]; });
        cpx = x2; cpy = y2; x = x3; y = y3;
      } else if (C === 'Q' || C === 'T') {
        let x1, y1; if (C === 'Q') { x1 = ox + N(); y1 = oy + N(); } else { x1 = /[QT]/.test(prev) ? 2 * x - cpx : x; y1 = /[QT]/.test(prev) ? 2 * y - cpy : y; }
        const x2 = ox + N(), y2 = oy + N(), X = x, Y = y;
        curve(0, t => { const u = 1 - t; return [u * u * X + 2 * u * t * x1 + t * t * x2, u * u * Y + 2 * u * t * y1 + t * t * y2]; });
        cpx = x1; cpy = y1; x = x2; y = y2;
      } else if (C === 'A') {
        let rx = Math.abs(N()), ry = Math.abs(N()); const phi = N() * Math.PI / 180, fa = N(), fs = N(), x2 = ox + N(), y2 = oy + N();
        if (!rx || !ry) { ring.push([x2, y2]); } else {
          const c = Math.cos(phi), s = Math.sin(phi), dx2 = (x - x2) / 2, dy2 = (y - y2) / 2, x1p = c * dx2 + s * dy2, y1p = -s * dx2 + c * dy2;
          const lam = x1p * x1p / (rx * rx) + y1p * y1p / (ry * ry); if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
          const num2 = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p, den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
          const co = (fa === fs ? -1 : 1) * Math.sqrt(Math.max(0, num2 / (den || 1))), cxp = co * rx * y1p / ry, cyp = -co * ry * x1p / rx;
          const cx = c * cxp - s * cyp + (x + x2) / 2, cy = s * cxp + c * cyp + (y + y2) / 2;
          const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
          const t1 = ang(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry); let dt = ang((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
          if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
          const n = Math.max(4, Math.ceil(Math.abs(dt) / (Math.PI / 16)));
          for (let k = 1; k <= n; k++) { const a = t1 + dt * k / n; ring.push([cx + rx * Math.cos(a) * c - ry * Math.sin(a) * s, cy + rx * Math.cos(a) * s + ry * Math.sin(a) * c]); }
        }
        x = x2; y = y2;
      } else { i++; }
      prev = C;
      if (ring.length > MAXPTS) break;
    }
    flush();
    return rings;
  }
  // every closed shape in an SVG document (path, polygon, rect, circle, ellipse; closed polylines), with group and
  // element transforms applied and the y axis flipped to point up. Text is only scanned — nothing in it is executed.
  function parseSVG(text) {
    const src = String(text).replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
    const re = /<\s*(\/)?\s*([a-zA-Z][\w:-]*)([^>]*?)(\/)?\s*>/g; const stack = [ID], polys = []; let m, skip = 0;
    while ((m = re.exec(src))) {
      const close = !!m[1], tag = m[2].toLowerCase(), a = m[3] || '', self = !!m[4] || /\/\s*$/.test(a);
      if (/^(defs|clippath|mask|pattern|symbol|marker|style|script|metadata|title|desc)$/.test(tag)) { if (close) skip = Math.max(0, skip - 1); else if (!self) skip++; continue; }
      if (close) { if (tag === 'g' || tag === 'svg' || tag === 'a') stack.length > 1 && stack.pop(); continue; }
      const M = mul(stack[stack.length - 1], parseTransform(attr(a, 'transform')));
      if (tag === 'g' || tag === 'svg' || tag === 'a') { if (!self) stack.push(M); continue; }
      if (skip) continue;
      let rings = [];
      if (tag === 'path') rings = pathRings(attr(a, 'd') || '');
      else if (tag === 'polygon' || tag === 'polyline') { const v = (attr(a, 'points') || '').match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []; const R = []; for (let k = 0; k + 1 < v.length; k += 2) R.push([+v[k], +v[k + 1]]); if (R.length >= 3) rings = [R]; }
      else if (tag === 'rect') { const x = num(a, 'x'), y = num(a, 'y'), w = num(a, 'width'), h = num(a, 'height'); if (w > 0 && h > 0) rings = [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]]; }
      else if (tag === 'circle' || tag === 'ellipse') { const cx = num(a, 'cx'), cy = num(a, 'cy'), rx = tag === 'circle' ? num(a, 'r') : num(a, 'rx'), ry = tag === 'circle' ? rx : num(a, 'ry'); if (rx > 0 && ry > 0) { const R = []; for (let k = 0; k < 64; k++) { const t = k / 64 * 2 * Math.PI; R.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); } rings = [R]; } }
      for (const R of rings) polys.push(R.map(([x, y]) => [M[0] * x + M[2] * y + M[4], -(M[1] * x + M[3] * y + M[5])]));
      if (polys.reduce((s, P) => s + P.length, 0) > MAXPTS) break;
    }
    return sanitizePolys(polys);
  }

  const api = { fft, spectrum, sampleCentre, probe, refPressure, surfaceCp, cpForce, pointInPolys, sanitizePolys, normalizePolys, polygonInside, parsePolygonText, parseSVG, pathRings, parseTransform };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FlowAnalysis = api;
})(typeof self !== 'undefined' ? self : this);
