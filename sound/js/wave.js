'use strict';
/* Lumen Sound — waveform / spectral editor view (canvas). Reads and writes App.doc / App.sel / App.view. */
window.Wave = (() => {
  const SCALE_W = 46, GAP = 3;
  let root, cOver, cRuler, cMain, cOv, scrollEl, thumb, lanesEl;
  let dpr = 1, W = 0, H = 0, needMain = true, needOver = true, laneCache = [];
  const $ = s => root.querySelector(s);

  /* ---------- peak pyramid (min/max/sum² per block) ---------- */
  const pyr = new WeakMap();
  function pyramid(x) {
    let p = pyr.get(x); if (p) return p;
    p = []; let bs = 64, n = Math.ceil(x.length / bs);
    let mn = new Float32Array(n), mx = new Float32Array(n), sq = new Float32Array(n);
    for (let b = 0; b < n; b++) {
      let lo = Infinity, hi = -Infinity, s = 0; const e = Math.min(x.length, (b + 1) * bs);
      for (let i = b * bs; i < e; i++) { const v = x[i]; if (v < lo) lo = v; if (v > hi) hi = v; s += v * v; }
      mn[b] = lo; mx[b] = hi; sq[b] = s;
    }
    p.push({ bs, mn, mx, sq });
    while (n > 1) {
      const m = Math.ceil(n / 4), a = new Float32Array(m), b2 = new Float32Array(m), c = new Float32Array(m);
      for (let j = 0; j < m; j++) { let lo = Infinity, hi = -Infinity, s = 0; for (let k = j * 4; k < Math.min(n, j * 4 + 4); k++) { if (mn[k] < lo) lo = mn[k]; if (mx[k] > hi) hi = mx[k]; s += sq[k]; } a[j] = lo; b2[j] = hi; c[j] = s; }
      bs *= 4; n = m; mn = a; mx = b2; sq = c; p.push({ bs, mn, mx, sq });
    }
    pyr.set(x, p); return p;
  }
  // stats of x over [s0, s1) → writes into o {min,max,rms}
  function stats(x, s0, s1, o) {
    s0 = Math.max(0, Math.floor(s0)); s1 = Math.min(x.length, Math.ceil(s1));
    if (s1 <= s0) { o.min = o.max = o.rms = 0; o.empty = true; return o; }
    o.empty = false;
    let lo = Infinity, hi = -Infinity, s = 0;
    if (s1 - s0 < 512) { for (let i = s0; i < s1; i++) { const v = x[i]; if (v < lo) lo = v; if (v > hi) hi = v; s += v * v; } }
    else {
      const P = pyramid(x); let L = P[0]; for (const l of P) { if (l.bs * 4 <= s1 - s0) L = l; else break; }
      const b0 = Math.floor(s0 / L.bs), b1 = Math.max(b0 + 1, Math.floor(s1 / L.bs));
      for (let b = b0; b < Math.min(b1, L.mn.length); b++) { if (L.mn[b] < lo) lo = L.mn[b]; if (L.mx[b] > hi) hi = L.mx[b]; s += L.sq[b]; }
      s1 = Math.min(x.length, b1 * L.bs); s0 = b0 * L.bs;
    }
    o.min = lo; o.max = hi; o.rms = Math.sqrt(s / (s1 - s0)); return o;
  }

  /* ---------- colour maps ---------- */
  const CMAPS = {
    aurora: [[0, 0, 0, 8], [0.18, 16, 18, 90], [0.38, 100, 20, 150], [0.55, 205, 30, 90], [0.72, 250, 120, 20], [0.88, 255, 220, 60], [1, 255, 255, 235]],
    viridis: [[0, 68, 1, 84], [0.25, 59, 82, 139], [0.5, 33, 145, 140], [0.75, 94, 201, 98], [1, 253, 231, 37]],
    magma: [[0, 0, 0, 4], [0.25, 81, 18, 124], [0.5, 183, 55, 121], [0.75, 252, 137, 97], [1, 252, 253, 191]],
    ice: [[0, 2, 8, 20], [0.35, 10, 60, 120], [0.65, 60, 160, 220], [0.85, 170, 230, 255], [1, 255, 255, 255]],
    gray: [[0, 0, 0, 0], [1, 255, 255, 255]]
  };
  const luts = {};
  function lut(name) {
    if (luts[name]) return luts[name];
    const st = CMAPS[name] || CMAPS.aurora, l = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255; let k = 0; while (k < st.length - 2 && t > st[k + 1][0]) k++;
      const a = st[k], b = st[k + 1], f = (t - a[0]) / (b[0] - a[0] || 1);
      for (let c = 0; c < 3; c++) l[i * 3 + c] = Math.round(a[c + 1] + (b[c + 1] - a[c + 1]) * f);
    }
    return luts[name] = l;
  }

  /* ---------- geometry ---------- */
  const A = () => window.App;
  const doc = () => A().doc;
  const len = () => doc() ? doc().chs[0].length : 0;
  function lanes() {
    const d = doc(); if (!d) return [];
    const n = d.chs.length, mode = A().settings.viewMode, out = [];
    const mk = (kind, y0, hh) => { const lh = (hh - GAP * (n - 1)) / n; for (let c = 0; c < n; c++) out.push({ kind, ch: c, y: y0 + c * (lh + GAP), h: lh }); };
    if (mode === 'both') { const h1 = Math.floor(H * 0.5); mk('wave', 0, h1 - 3); mk('spec', h1 + 3, H - h1 - 3); }
    else mk(mode === 'spec' ? 'spec' : 'wave', 0, H);
    return out;
  }
  const xOf = s => (s - A().view.start) / A().view.spp;
  const sOf = x => A().view.start + x * A().view.spp;
  const waveW = () => Math.max(10, W - SCALE_W);

  /* ---------- init ---------- */
  function init(el) {
    root = el;
    root.innerHTML = `
      <canvas class="wv-over"></canvas>
      <div class="wv-mainwrap">
        <canvas class="wv-ruler"></canvas>
        <div class="wv-lanes"><canvas class="wv-c"></canvas><canvas class="wv-o"></canvas><div class="wv-empty" hidden></div></div>
        <div class="wv-scroll"><div class="wv-thumb"></div></div>
      </div>`;
    cOver = $('.wv-over'); cRuler = $('.wv-ruler'); cMain = $('.wv-c'); cOv = $('.wv-o'); lanesEl = $('.wv-lanes'); scrollEl = $('.wv-scroll'); thumb = $('.wv-thumb');
    new ResizeObserver(() => { resize(); }).observe(lanesEl);
    bindLanes(); bindRuler(); bindOverview(); bindScroll();
    resize();
  }
  function sizeCanvas(c, w, h) { c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr)); c.style.width = w + 'px'; c.style.height = h + 'px'; const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return g; }
  function resize() {
    if (!root || !root.offsetParent) return;
    dpr = window.devicePixelRatio || 1;
    const r = lanesEl.getBoundingClientRect(); W = Math.floor(r.width); H = Math.floor(r.height);
    sizeCanvas(cMain, W, H); sizeCanvas(cOv, W, H);
    sizeCanvas(cRuler, W, 26); sizeCanvas(cOver, cOver.getBoundingClientRect().width || W, 40);
    clampView(); invalidate(true);
  }
  function clampView() {
    const v = A().view, n = len(); if (!n) return;
    const minSpp = 1 / 64, maxSpp = Math.max(minSpp, n / waveW());
    v.spp = Math.max(minSpp, Math.min(maxSpp * 1.0001, v.spp || maxSpp));
    v.start = Math.max(0, Math.min(v.start, n - waveW() * v.spp));
    if (v.start < 0 || !isFinite(v.start)) v.start = 0;
  }
  let raf = 0;
  function invalidate(all = true) { if (all) { needMain = true; needOver = true; } if (!raf) raf = requestAnimationFrame(frame); }
  function frame() { raf = 0; draw(); }

  /* ---------- drawing ---------- */
  function draw() {
    if (!root || !root.offsetParent || !W) return;
    const d = doc();
    $('.wv-empty').hidden = !!d;
    if (!d) { [cMain, cOv, cRuler, cOver].forEach(c => c.getContext('2d').clearRect(0, 0, c.width, c.height)); return; }
    clampView();
    if (needMain) { drawMain(); needMain = false; }
    if (needOver) { drawOverview(); needOver = false; }
    drawRuler(); drawOverlay(); updateScroll();
  }
  function timeStep(spp, sr) {
    const pxPerSec = sr / spp, steps = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
    for (const s of steps) if (s * pxPerSec >= 90) return s; return 3600;
  }
  function fmtT(t, step) {
    const m = Math.floor(t / 60), s = t - m * 60;
    const dec = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : step >= 0.001 ? 3 : 4;
    return `${m}:${s.toFixed(dec).padStart(dec ? 3 + dec : 2, '0')}`;
  }
  function drawMain() {
    const g = cMain.getContext('2d'), d = doc(), v = A().view, ww = waveW();
    g.clearRect(0, 0, W, H);
    const step = timeStep(v.spp, d.sr), t0 = v.start / d.sr, t1 = sOf(ww) / d.sr;
    laneCache = lanes();
    for (const L of laneCache) {
      const on = A().chOn[L.ch] !== false;
      if (L.kind === 'wave') drawWaveLane(g, d.chs[L.ch], L, on);
      else drawSpecLane(g, d.chs[L.ch], L, d.sr, on);
      // vertical grid
      g.strokeStyle = L.kind === 'wave' ? 'rgba(120,170,220,.10)' : 'rgba(255,255,255,.07)'; g.lineWidth = 1; g.beginPath();
      for (let t = Math.ceil(t0 / step) * step; t < t1; t += step) { const x = Math.round(xOf(t * d.sr)) + 0.5; g.moveTo(x, L.y); g.lineTo(x, L.y + L.h); }
      g.stroke();
      drawScale(g, L, d.sr);
      // channel badge
      const name = chName(L.ch, d.chs.length);
      g.font = '600 10.5px Segoe UI, sans-serif';
      const bw = g.measureText(name).width + 12;
      g.fillStyle = on ? 'rgba(80,200,255,.22)' : 'rgba(0,0,0,.45)'; g.strokeStyle = on ? 'rgba(130,220,255,.75)' : 'rgba(150,150,150,.6)';
      roundRect(g, 6, L.y + 5, bw, 16, 3); g.fill(); g.stroke();
      g.fillStyle = on ? '#dff6ff' : '#888'; g.fillText(name, 12, L.y + 16.5);
      L.badge = { x: 6, y: L.y + 5, w: bw, h: 16 };
    }
  }
  function chName(c, n) { if (n === 1) return 'Mono'; if (n === 2) return ['L', 'R'][c]; if (n === 6) return ['L', 'R', 'C', 'LFE', 'Ls', 'Rs'][c]; return 'Ch ' + (c + 1); }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function drawWaveLane(g, x, L, on) {
    const v = A().view, ww = waveW(), vz = v.vzoom || 1, mid = L.y + L.h / 2, amp = L.h / 2 * vz;
    const bg = g.createLinearGradient(0, L.y, 0, L.y + L.h);
    bg.addColorStop(0, '#0d2238'); bg.addColorStop(0.5, '#0a1b2e'); bg.addColorStop(1, '#0d2238');
    g.fillStyle = bg; g.fillRect(0, L.y, ww, L.h);
    // level guides
    g.strokeStyle = 'rgba(120,170,220,.16)'; g.beginPath();
    for (const db of [-6, -12]) { const a = Math.pow(10, db / 20) * amp; if (a < L.h / 2) { g.moveTo(0, Math.round(mid - a) + 0.5); g.lineTo(ww, Math.round(mid - a) + 0.5); g.moveTo(0, Math.round(mid + a) + 0.5); g.lineTo(ww, Math.round(mid + a) + 0.5); } }
    g.stroke();
    g.strokeStyle = 'rgba(140,200,255,.35)'; g.beginPath(); g.moveTo(0, Math.round(mid) + 0.5); g.lineTo(ww, Math.round(mid) + 0.5); g.stroke();
    g.save(); g.beginPath(); g.rect(0, L.y, ww, L.h); g.clip();
    const col = on ? '#4ee0a0' : '#4b6a60', colR = on ? '#b9ffd9' : '#6c8a80';
    if (v.spp >= 1) {
      const o = {}, n = x.length;
      const grad = g.createLinearGradient(0, L.y, 0, L.y + L.h);
      grad.addColorStop(0, on ? '#7af0c0' : col); grad.addColorStop(0.5, col); grad.addColorStop(1, on ? '#7af0c0' : col);
      g.fillStyle = grad;
      const rmsBars = [];
      for (let px = 0; px < ww; px++) {
        const s0 = v.start + px * v.spp, s1 = s0 + v.spp; if (s0 >= n) break;
        stats(x, s0, s1, o); if (o.empty) continue;
        const y0 = mid - Math.min(1e3, o.max * amp), y1 = mid - Math.max(-1e3, o.min * amp);
        g.fillRect(px, y0, 1, Math.max(1, y1 - y0));
        rmsBars.push(px, Math.min(o.rms, Math.max(o.max, -o.min)) * amp);
      }
      g.fillStyle = on ? 'rgba(200,255,225,.38)' : 'rgba(150,180,170,.25)';
      for (let i = 0; i < rmsBars.length; i += 2) { const r = rmsBars[i + 1]; g.fillRect(rmsBars[i], mid - r, 1, Math.max(1, r * 2)); }
    } else {
      const s0 = Math.max(0, Math.floor(v.start) - 1), s1 = Math.min(x.length, Math.ceil(sOf(ww)) + 2), pps = 1 / v.spp;
      g.strokeStyle = col; g.lineWidth = 1.4; g.beginPath();
      for (let s = s0; s < s1; s++) { const px = xOf(s), py = mid - x[s] * amp; s === s0 ? g.moveTo(px, py) : g.lineTo(px, py); }
      g.stroke();
      if (pps >= 6) {
        g.fillStyle = colR; g.strokeStyle = 'rgba(78,224,160,.35)'; g.lineWidth = 1;
        for (let s = s0; s < s1; s++) { const px = xOf(s), py = mid - x[s] * amp; g.beginPath(); g.moveTo(px, mid); g.lineTo(px, py); g.stroke(); g.beginPath(); g.arc(px, py, pps > 14 ? 3 : 2.2, 0, Math.PI * 2); g.fill(); }
      }
    }
    g.restore();
  }
  function drawScale(g, L, sr) {
    const ww = waveW(), x0 = ww;
    const bg = g.createLinearGradient(x0, 0, W, 0); bg.addColorStop(0, '#e9f0f8'); bg.addColorStop(1, '#d5e1ee');
    g.fillStyle = bg; g.fillRect(x0, L.y, SCALE_W, L.h);
    g.fillStyle = '#9fb3c8'; g.fillRect(x0, L.y, 1, L.h);
    g.font = '9.5px Segoe UI, sans-serif'; g.fillStyle = '#2b4a6b'; g.strokeStyle = '#7f97b0'; g.textAlign = 'left';
    if (L.kind === 'wave') {
      const vz = A().view.vzoom || 1, mid = L.y + L.h / 2, amp = L.h / 2 * vz;
      const marks = [0, -1, -2, -3, -6, -9, -12, -18, -24, -36].map(db => ({ db, a: Math.pow(10, db / 20) * amp })).filter(m => m.a <= L.h / 2 - 4);
      let last = -99;
      g.beginPath(); g.moveTo(x0, mid + 0.5); g.lineTo(x0 + 6, mid + 0.5); g.stroke(); g.fillText('-∞', x0 + 9, mid + 3.5);
      for (const m of marks) {
        if (Math.abs(m.a - last) < 13 || m.a < 12) continue; last = m.a;
        for (const sg of [-1, 1]) { const y = Math.round(mid + sg * m.a) + 0.5; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + 6, y); g.stroke(); g.fillText(String(m.db), x0 + 9, y + 3.5); }
      }
    } else {
      const ny = sr / 2, logF = A().settings.logFreq;
      const fs = logF ? [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000] : [1000, 2000, 5000, 10000, 15000, 20000, 30000, 40000].filter(f => f < ny);
      const lin = !logF ? niceLin(ny, L.h) : null;
      for (const f of (lin || fs)) { if (f >= ny) continue; const y = Math.round(L.y + freqToY(f, L.h, sr)) + 0.5; if (y < L.y + 6 || y > L.y + L.h - 3) continue; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + 6, y); g.stroke(); g.fillText(f >= 1000 ? (f / 1000) + 'k' : String(f), x0 + 9, y + 3.5); }
    }
  }
  function niceLin(ny, h) { const n = Math.max(2, Math.floor(h / 28)), raw = ny / n, p = Math.pow(10, Math.floor(Math.log10(raw))), st = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw) || raw; const o = []; for (let f = st; f < ny; f += st) o.push(Math.round(f)); return o; }
  const FMIN = 20;
  function freqToY(f, h, sr) { const ny = sr / 2; if (A().settings.logFreq) return h * (1 - Math.log(Math.max(FMIN, f) / FMIN) / Math.log(ny / FMIN)); return h * (1 - f / ny); }
  function yToFreq(y, h, sr) { const ny = sr / 2; if (A().settings.logFreq) return FMIN * Math.pow(ny / FMIN, 1 - y / h); return ny * (1 - y / h); }

  // spectrogram
  function drawSpecLane(g, x, L, sr, on) {
    const v = A().view, ww = waveW(), h = Math.max(1, Math.round(L.h)), N = A().settings.fft || 2048;
    const img = g.createImageData(ww, h), data = img.data, cm = lut(A().settings.cmap || 'aurora');
    const fr = new Float64Array(N), re = new Float64Array(N / 2 + 1), im = new Float64Array(N / 2 + 1), w = DSP.hann(N); let wsum = 0; for (let i = 0; i < N; i++) wsum += w[i];
    const H2 = N / 2, rowB0 = new Int32Array(h), rowB1 = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      const fa = yToFreq(y + 1, h, sr), fb = yToFreq(y, h, sr);
      rowB0[y] = Math.max(0, Math.min(H2, Math.floor(fa / sr * N))); rowB1[y] = Math.max(rowB0[y], Math.min(H2, Math.ceil(fb / sr * N)));
    }
    const floorDb = A().settings.specFloor ?? -110, range = -floorDb, mags = new Float32Array(H2 + 1), norm2 = (2 / wsum) ** 2;
    const n = x.length, colsPerFrame = Math.max(1, Math.floor((N / 4) / v.spp)); // reuse FFT for adjacent columns when zoomed in
    let lastFrame = -1;
    for (let px = 0; px < ww; px++) {
      const c = Math.round(v.start + (px + 0.5) * v.spp); if (c - N / 2 >= n) break;
      const fi = Math.floor(px / colsPerFrame);
      if (fi !== lastFrame) {
        lastFrame = fi;
        const cc = Math.round(v.start + (fi * colsPerFrame + colsPerFrame / 2) * v.spp), s0 = cc - N / 2;
        for (let i = 0; i < N; i++) { const k = s0 + i; fr[i] = k >= 0 && k < n ? x[k] * w[i] : 0; }
        DSP.rfft(fr, re, im);
        for (let k = 0; k <= H2; k++) mags[k] = 10 * Math.log10((re[k] * re[k] + im[k] * im[k]) * norm2 + 1e-24);
      }
      for (let y = 0; y < h; y++) {
        let m = -300; for (let k = rowB0[y]; k <= rowB1[y]; k++) if (mags[k] > m) m = mags[k];
        let t = (m - floorDb) / range; t = t < 0 ? 0 : t > 1 ? 1 : t; const li = Math.round(t * 255) * 3, o = (y * ww + px) * 4;
        const dim = on ? 1 : 0.4;
        data[o] = cm[li] * dim; data[o + 1] = cm[li + 1] * dim; data[o + 2] = cm[li + 2] * dim; data[o + 3] = 255;
      }
    }
    // put at device resolution
    const tmp = document.createElement('canvas'); tmp.width = ww; tmp.height = h; tmp.getContext('2d').putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true; g.drawImage(tmp, 0, L.y, ww, L.h);
  }

  function drawRuler() {
    const g = cRuler.getContext('2d'), d = doc(), v = A().view, ww = waveW();
    const bg = g.createLinearGradient(0, 0, 0, 26); bg.addColorStop(0, '#fbfdff'); bg.addColorStop(1, '#dbe6f2');
    g.fillStyle = bg; g.fillRect(0, 0, W, 26);
    g.fillStyle = '#a8bbd0'; g.fillRect(0, 25, W, 1);
    // selection band
    const S = A().sel;
    if (S.b > S.a) { const xa = Math.max(0, xOf(S.a)), xb = Math.min(ww, xOf(S.b)); if (xb > xa) { g.fillStyle = 'rgba(60,140,220,.28)'; g.fillRect(xa, 0, xb - xa, 25); } }
    const step = timeStep(v.spp, d.sr), sub = step / 5, t0 = v.start / d.sr, t1 = sOf(ww) / d.sr;
    g.strokeStyle = '#6f88a3'; g.fillStyle = '#1e395b'; g.font = '10px Segoe UI, sans-serif'; g.lineWidth = 1; g.beginPath();
    for (let t = Math.ceil(t0 / sub) * sub; t < t1; t += sub) {
      const x = Math.round(xOf(t * d.sr)) + 0.5, major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      g.moveTo(x, major ? 12 : 19); g.lineTo(x, 25);
      if (major) g.fillText(fmtT(t, step), x + 3, 11);
    }
    g.stroke();
    // markers
    for (const m of d.markers) {
      const x = Math.round(xOf(m.time * d.sr)); if (x < -80 || x > ww) continue;
      g.font = '10px Segoe UI, sans-serif'; const tw = Math.min(110, g.measureText(m.label).width + 10);
      g.fillStyle = m.id === A().selMarker ? '#ffb43a' : '#f0a020'; g.strokeStyle = '#9a5a00';
      g.beginPath(); g.moveTo(x + 0.5, 25); g.lineTo(x + 0.5, 13); g.lineTo(x + tw, 13); g.lineTo(x + tw, 24); g.lineTo(x + 5, 24); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#2a1600'; g.save(); g.beginPath(); g.rect(x, 13, tw - 2, 12); g.clip(); g.fillText(m.label, x + 4, 22); g.restore();
    }
    // playhead
    const pp = A().playheadSample();
    if (pp != null) { const x = Math.round(xOf(pp)) + 0.5; if (x >= 0 && x <= ww) { g.fillStyle = '#e8401c'; g.beginPath(); g.moveTo(x - 5, 0); g.lineTo(x + 5, 0); g.lineTo(x, 7); g.closePath(); g.fill(); } }
    // scale corner
    g.fillStyle = '#e3ebf5'; g.fillRect(ww, 0, SCALE_W, 26); g.fillStyle = '#9fb3c8'; g.fillRect(ww, 0, 1, 26);
    g.fillStyle = '#4a6585'; g.font = '9.5px Segoe UI, sans-serif'; g.fillText(A().settings.viewMode === 'spec' ? 'Hz' : 'dB', ww + 14, 17);
  }
  function drawOverlay() {
    const g = cOv.getContext('2d'), d = doc(), S = A().sel, ww = waveW();
    g.clearRect(0, 0, W, H);
    g.save(); g.beginPath(); g.rect(0, 0, ww, H); g.clip();
    for (const m of d.markers) { const x = Math.round(xOf(m.time * d.sr)) + 0.5; if (x < 0 || x > ww) continue; g.strokeStyle = 'rgba(255,180,50,.75)'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.setLineDash([]); }
    if (S.b > S.a) {
      const xa = xOf(S.a), xb = xOf(S.b);
      for (const L of lanes()) {
        const on = A().chOn[L.ch] !== false;
        g.fillStyle = on ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.06)'; g.fillRect(xa, L.y, xb - xa, L.h);
      }
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(xa) + 0.5, 0); g.lineTo(Math.round(xa) + 0.5, H); g.moveTo(Math.round(xb) + 0.5, 0); g.lineTo(Math.round(xb) + 0.5, H); g.stroke();
    } else {
      const x = Math.round(xOf(S.a)) + 0.5; g.strokeStyle = '#ffe14a'; g.lineWidth = 1; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke();
    }
    const pp = A().playheadSample();
    if (pp != null) { const x = Math.round(xOf(pp)) + 0.5; g.strokeStyle = '#ff5a36'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    if (dragRect) { g.strokeStyle = '#fff'; g.setLineDash([3, 3]); g.strokeRect(Math.min(dragRect.x0, dragRect.x1) + 0.5, 0.5, Math.abs(dragRect.x1 - dragRect.x0), H - 1); g.setLineDash([]); }
    g.restore();
  }
  function drawOverview() {
    const g = cOver.getContext('2d'), d = doc(), w = cOver.width / dpr, h = 40;
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#173451'); bg.addColorStop(1, '#0c2034');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const n = len(), spp = n / w, o = {}, mid = h / 2;
    g.fillStyle = 'rgba(110,220,170,.75)';
    for (let px = 0; px < w; px++) {
      let lo = 0, hi = 0;
      for (const x of d.chs) { stats(x, px * spp, (px + 1) * spp, o); if (!o.empty) { lo = Math.min(lo, o.min); hi = Math.max(hi, o.max); } }
      g.fillRect(px, mid - hi * (mid - 3), 1, Math.max(1, (hi - lo) * (mid - 3)));
    }
    overviewImg = document.createElement('canvas'); overviewImg.width = cOver.width; overviewImg.height = cOver.height; overviewImg.getContext('2d').drawImage(cOver, 0, 0);
  }
  let overviewImg = null;
  function drawOverviewWindow() {
    if (!overviewImg) return;
    const g = cOver.getContext('2d'), w = cOver.width / dpr, n = len(), v = A().view;
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(overviewImg, 0, 0); g.restore();
    const a = v.start / n * w, b = Math.min(w, sOf(waveW()) / n * w);
    g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, a, 40); g.fillRect(b, 0, w - b, 40);
    g.strokeStyle = 'rgba(190,230,255,.95)'; g.lineWidth = 1; g.strokeRect(Math.round(a) + 0.5, 0.5, Math.max(3, b - a - 1), 39);
    const S = A().sel; if (S.b > S.a) { g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(S.a / n * w, 0, Math.max(1, (S.b - S.a) / n * w), 40); }
    const pp = A().playheadSample(); if (pp != null) { g.fillStyle = '#ff5a36'; g.fillRect(pp / n * w, 0, 1.5, 40); }
  }
  function updateScroll() {
    drawOverviewWindow();
    const n = len(), v = A().view, tw = scrollEl.clientWidth;
    if (!n) return;
    const vis = waveW() * v.spp, w = Math.max(24, tw * Math.min(1, vis / n)), x = (tw - w) * (n - vis > 0 ? v.start / (n - vis) : 0);
    thumb.style.width = w + 'px'; thumb.style.left = x + 'px';
  }

  /* ---------- interaction ---------- */
  let drag = null, dragRect = null;
  const localX = e => e.clientX - lanesEl.getBoundingClientRect().left;
  const localY = e => e.clientY - lanesEl.getBoundingClientRect().top;
  function snapSample(s, px = 7) {
    const d = doc(), n = len(); s = Math.max(0, Math.min(n, s));
    // snap to markers / cursor
    const lim = px * A().view.spp;
    for (const m of d.markers) { const ms = m.time * d.sr; if (Math.abs(ms - s) <= lim) return Math.round(ms); }
    if (A().settings.snapZero) s = zeroCross(s);
    return Math.round(s);
  }
  function zeroCross(s) {
    const d = doc(), x = d.chs, n = len(), R = Math.max(32, Math.round(d.sr * 0.01)); s = Math.round(s);
    const mono = i => { let v = 0; for (const c of x) v += c[i]; return v; };
    for (let r = 0; r < R; r++) {
      for (const i of [s - r, s + r]) { if (i <= 0 || i >= n) continue; const a = mono(i - 1), b = mono(i); if (a === 0 || b === 0 || (a < 0) !== (b < 0)) return Math.abs(a) < Math.abs(b) ? i - 1 : i; }
    }
    return s;
  }
  function hitLane(y) { return laneCache.find(L => y >= L.y && y <= L.y + L.h); }
  function bindLanes() {
    cOv.addEventListener('contextmenu', e => e.preventDefault());
    cOv.addEventListener('pointerdown', e => {
      const d = doc(); if (!d) return;
      const x = localX(e), y = localY(e), tool = A().tool();
      if (x > waveW()) return;
      // channel toggle badges
      const L = hitLane(y);
      if (L && L.badge && x >= L.badge.x && x <= L.badge.x + L.badge.w && y >= L.badge.y && y <= L.badge.y + L.badge.h) { A().toggleChannel(L.ch); return; }
      try { cOv.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ };
      if (tool === 'hand' || e.button === 1) { drag = { mode: 'pan', x0: x, start0: A().view.start }; cOv.style.cursor = 'grabbing'; return; }
      if (tool === 'zoom') { drag = { mode: 'zoom', x0: x, alt: e.altKey || e.button === 2 }; dragRect = { x0: x, x1: x }; return; }
      if (e.button === 2) return;
      const S = A().sel, s = sOf(x), edgeTol = 5;
      if (S.b > S.a && Math.abs(xOf(S.a) - x) < edgeTol) drag = { mode: 'sel', anchor: S.b };
      else if (S.b > S.a && Math.abs(xOf(S.b) - x) < edgeTol) drag = { mode: 'sel', anchor: S.a };
      else if (e.shiftKey) drag = { mode: 'sel', anchor: Math.abs(s - S.a) > Math.abs(s - S.b) ? S.a : S.b };
      else drag = { mode: 'sel', anchor: snapSample(s), fresh: true, x0: x };
      drag.moved = false; onSelMove(x);
    });
    cOv.addEventListener('pointermove', e => {
      const x = localX(e);
      if (!drag) {
        const S = A().sel, tool = A().tool();
        cOv.style.cursor = tool === 'hand' ? 'grab' : tool === 'zoom' ? 'zoom-in' : (S.b > S.a && (Math.abs(xOf(S.a) - x) < 5 || Math.abs(xOf(S.b) - x) < 5)) ? 'ew-resize' : 'text';
        A().hover(sOf(x), hitLane(localY(e)), localY(e));
        return;
      }
      if (drag.mode === 'pan') { A().view.start = drag.start0 - (x - drag.x0) * A().view.spp; clampView(); invalidate(); A().viewChanged(); return; }
      if (drag.mode === 'zoom') { dragRect.x1 = x; invalidate(false); return; }
      onSelMove(x);
      autoScroll(x);
    });
    const end = e => {
      if (!drag) return;
      const x = localX(e);
      if (drag.mode === 'zoom') {
        const a = Math.min(dragRect.x0, dragRect.x1), b = Math.max(dragRect.x0, dragRect.x1); dragRect = null;
        if (b - a > 6) zoomRange(sOf(a), sOf(b)); else zoomAt(sOf(x), drag.alt ? 2 : 0.5);
      } else if (drag.mode === 'sel') {
        if (drag.fresh && !drag.moved) { const s = snapSample(sOf(drag.x0)); A().setSel(s, s, true); }
        else { const S = A().sel; A().setSel(snapSample(S.a, 0), snapSample(S.b, 0), true); }
      }
      cOv.style.cursor = ''; drag = null; clearInterval(asTimer); asTimer = null; invalidate(false);
    };
    cOv.addEventListener('pointerup', end); cOv.addEventListener('pointercancel', end);
    cOv.addEventListener('dblclick', e => { if (!doc() || A().tool() !== 'select') return; const v = A().view; A().setSel(Math.max(0, v.start), Math.min(len(), sOf(waveW())), true); });
    lanesEl.addEventListener('wheel', onWheel, { passive: false });
  }
  let asTimer = null, lastX = 0;
  function autoScroll(x) {
    lastX = x;
    if (x < 0 || x > waveW()) {
      if (!asTimer) asTimer = setInterval(() => { const dx = lastX < 0 ? lastX : lastX - waveW(); A().view.start += dx * A().view.spp * 0.5; clampView(); onSelMove(lastX); invalidate(); A().viewChanged(); }, 30);
    } else if (asTimer) { clearInterval(asTimer); asTimer = null; }
  }
  function onSelMove(x) {
    if (!drag || drag.mode !== 'sel') return;
    if (drag.fresh && Math.abs(x - drag.x0) < 3 && !drag.moved) return;
    drag.moved = true;
    const s = Math.max(0, Math.min(len(), sOf(x)));
    const snapped = A().settings.snapZero ? s : snapSample(s);
    A().setSel(Math.min(drag.anchor, snapped), Math.max(drag.anchor, snapped), false);
  }
  function onWheel(e) {
    if (!doc()) return; e.preventDefault();
    const x = Math.min(waveW(), Math.max(0, localX(e)));
    if (e.altKey) { const v = A().view; v.vzoom = Math.max(0.25, Math.min(64, (v.vzoom || 1) * (e.deltaY < 0 ? 1.25 : 0.8))); invalidate(); return; }
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) { const dlt = (e.shiftKey ? e.deltaY : e.deltaX) || e.deltaY; A().view.start += dlt * A().view.spp * 1.2; clampView(); invalidate(); A().viewChanged(); return; }
    zoomAt(sOf(x), e.deltaY < 0 ? 0.8 : 1.25, x);
  }
  function zoomAt(s, f, px) {
    const v = A().view; px = px ?? xOf(s);
    v.spp *= f; clampView(); v.start = s - px * v.spp; clampView(); invalidate(); A().viewChanged();
  }
  function zoomRange(a, b) {
    const v = A().view; if (b - a < 2) return; v.spp = (b - a) / waveW(); clampView(); v.start = a; clampView(); invalidate(); A().viewChanged();
  }
  function zoomFit() { const v = A().view; v.spp = len() / waveW(); v.start = 0; clampView(); invalidate(); A().viewChanged(); }
  function zoomIn(f = 0.5) { const S = A().sel, v = A().view; const c = A().playheadSample() ?? (S.b > S.a ? (S.a + S.b) / 2 : S.a); const inView = c >= v.start && c <= sOf(waveW()); zoomAt(inView ? c : v.start + waveW() * v.spp / 2, f, inView ? xOf(c) : waveW() / 2); }
  function zoomSel() { const S = A().sel; if (S.b > S.a) { const pad = (S.b - S.a) * 0.04; zoomRange(Math.max(0, S.a - pad), Math.min(len(), S.b + pad)); } }
  function zoomSamples() { const S = A().sel; const c = S.a; const v = A().view; v.spp = 1 / 16; clampView(); v.start = c - waveW() * v.spp / 2; clampView(); invalidate(); A().viewChanged(); }
  function scrollTo(s, center = false) { const v = A().view, vis = waveW() * v.spp; v.start = center ? s - vis / 2 : s; clampView(); invalidate(); A().viewChanged(); }
  function ensureVisible(s, page = true) {
    const v = A().view, vis = waveW() * v.spp;
    if (s < v.start || s > v.start + vis) { v.start = page ? s - vis * 0.05 : s - vis / 2; clampView(); invalidate(); A().viewChanged(); }
  }

  function bindRuler() {
    let rd = null;
    cRuler.addEventListener('pointerdown', e => {
      const d = doc(); if (!d) return;
      const x = e.offsetX; if (x > waveW()) return;
      // marker hit
      const g = cRuler.getContext('2d'); g.font = '10px Segoe UI, sans-serif';
      const hit = d.markers.slice().reverse().find(m => { const mx = xOf(m.time * d.sr), tw = Math.min(110, g.measureText(m.label).width + 10); return x >= mx - 2 && x <= mx + tw && e.offsetY >= 12; });
      try { cRuler.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ };
      if (hit) { A().selectMarker(hit.id); rd = { marker: hit, x0: x, t0: hit.time, moved: false }; return; }
      rd = { scrub: true }; A().seek(Math.max(0, Math.min(len(), sOf(x))));
    });
    cRuler.addEventListener('pointermove', e => {
      if (!rd) { cRuler.style.cursor = 'default'; return; }
      const d = doc(), x = e.offsetX;
      if (rd.marker) { if (Math.abs(x - rd.x0) > 2) rd.moved = true; if (rd.moved) { rd.marker.time = Math.max(0, Math.min(len(), snapSample(sOf(x), 0))) / d.sr; invalidate(false); } }
      else if (rd.scrub) A().seek(Math.max(0, Math.min(len(), sOf(x))), true);
    });
    cRuler.addEventListener('pointerup', () => { if (rd?.marker && rd.moved) A().markersChanged('Move Marker'); rd = null; });
    cRuler.addEventListener('dblclick', e => {
      const d = doc(); if (!d) return; const x = e.offsetX;
      const m = d.markers.find(m => Math.abs(xOf(m.time * d.sr) - x) < 40 && x >= xOf(m.time * d.sr) - 2); if (m) A().renameMarker(m.id);
    });
    cRuler.addEventListener('wheel', onWheel, { passive: false });
  }
  function bindOverview() {
    let od = false;
    const go = e => { const w = cOver.width / dpr, n = len(), v = A().view; const s = e.offsetX / w * n; v.start = s - waveW() * v.spp / 2; clampView(); invalidate(false); A().viewChanged(); };
    cOver.addEventListener('pointerdown', e => { if (!doc()) return; od = true; try { cOver.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }; go(e); });
    cOver.addEventListener('pointermove', e => { if (od) go(e); });
    cOver.addEventListener('pointerup', () => od = false);
  }
  function bindScroll() {
    let sd = null;
    thumb.addEventListener('pointerdown', e => { e.stopPropagation(); sd = { x0: e.clientX, l0: thumb.offsetLeft }; try { thumb.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }; });
    thumb.addEventListener('pointermove', e => {
      if (!sd) return; const tw = scrollEl.clientWidth - thumb.offsetWidth, n = len(), v = A().view, vis = waveW() * v.spp;
      const l = Math.max(0, Math.min(tw, sd.l0 + e.clientX - sd.x0)); v.start = tw > 0 ? l / tw * (n - vis) : 0; clampView(); invalidate(false); A().viewChanged();
    });
    thumb.addEventListener('pointerup', () => sd = null);
    scrollEl.addEventListener('pointerdown', e => { if (e.target !== scrollEl || !doc()) return; const v = A().view, vis = waveW() * v.spp; v.start += (e.offsetX < thumb.offsetLeft ? -1 : 1) * vis * 0.9; clampView(); invalidate(false); A().viewChanged(); });
  }

  return { init, resize, invalidate, draw, zoomAt, zoomIn, zoomFit, zoomSel, zoomSamples, zoomRange, scrollTo, ensureVisible, clampView, waveW, pyramid, stats, lut, CMAPS, chName, xOf, sOf,
    get width() { return W; } };
})();
