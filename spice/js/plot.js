// Lumen Spice waveform viewer: multiple traces, voltage axis left / current axis right (or dB / phase for .ac),
// log frequency axis, box/wheel zoom, pan, two draggable cursors with readouts, min/max decimation.
(function () {
  'use strict';
  const Ex = window.SpiceExpr;
  const FONT = '"Segoe UI", Tahoma, sans-serif';
  const M = { l: 64, r: 64, t: 24, b: 30 };
  let A, cv, g, dpr = 1, W = 1, H = 1;
  const st = { data: null, traces: [], xlim: null, ylim: null, cursors: [null, null], active: 0, drag: null, mouse: null, hover: -1 };

  function niceStep(raw) { const p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; }
  function ticks(lo, hi, n) { if (!(hi > lo)) return [lo]; const s = niceStep((hi - lo) / n), out = []; for (let v = Math.ceil(lo / s - 1e-9) * s; v <= hi + s * 1e-9; v += s) out.push(Math.abs(v) < s * 1e-9 ? 0 : v); return out; }
  function nice(lo, hi) { if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [-1, 1]; if (hi - lo < 1e-15 * Math.max(1, Math.abs(hi))) { const d = Math.abs(lo) * 0.1 || 1; return [lo - d, hi + d]; } const pad = (hi - lo) * 0.06; return [lo - pad, hi + pad]; }
  const isAC = () => st.data && st.data.complex;
  const plotW = () => W - M.l - (rightAxis() ? M.r : 16), plotH = () => H - M.t - M.b;
  function rightAxis() { return isAC() ? st.traces.length > 0 : st.traces.some(t => t.unit === 'A') && st.traces.some(t => t.unit !== 'A'); }
  function onRight(t) { return !isAC() && rightAxis() && t.unit === 'A'; }
  const X = x => { const [a, b] = st.xlim; if (isAC()) return M.l + (Math.log10(x) - Math.log10(a)) / (Math.log10(b) - Math.log10(a)) * plotW(); return M.l + (x - a) / (b - a) * plotW(); };
  const Xinv = px => { const [a, b] = st.xlim, f = (px - M.l) / plotW(); if (isAC()) return Math.pow(10, Math.log10(a) + f * (Math.log10(b) - Math.log10(a))); return a + f * (b - a); };
  const Y = (y, lim) => M.t + (1 - (y - lim[0]) / (lim[1] - lim[0])) * plotH();
  const Yinv = (py, lim) => lim[0] + (1 - (py - M.t) / plotH()) * (lim[1] - lim[0]);

  function lower(x, v) { let lo = 0, hi = x.length - 1; if (v <= x[0]) return 0; if (v >= x[hi]) return hi; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (x[m] <= v) lo = m; else hi = m; } return lo; }
  function interp(t, which, xv) {
    if (!st.data) return NaN; const x = st.data.x, ys = which === 'ph' ? t.ph : t.y; if (!ys || !x.length) return NaN;
    const i = lower(x, xv); if (i >= x.length - 1) return ys[x.length - 1];
    const f = isAC() ? (Math.log(xv) - Math.log(x[i])) / (Math.log(x[i + 1]) - Math.log(x[i])) : (xv - x[i]) / (x[i + 1] - x[i]);
    return ys[i] + (ys[i + 1] - ys[i]) * Math.max(0, Math.min(1, f));
  }
  function rangeOf(sel) {
    const x = st.data.x; let lo = Infinity, hi = -Infinity; const [a, b] = st.xlim;
    st.traces.filter(sel).forEach(t => [t.y, isAC() ? null : null].forEach(ys => { if (!ys) return; for (let i = 0; i < x.length; i++) { if (x[i] < a || x[i] > b) continue; const v = ys[i]; if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; } } }));
    return [lo, hi];
  }
  function limits() {
    if (isAC()) {
      const [lo, hi] = rangeOf(() => true); let pl = Infinity, ph = -Infinity; const x = st.data.x, [a, b] = st.xlim;
      st.traces.forEach(t => { if (!t.ph) return; for (let i = 0; i < x.length; i++) if (x[i] >= a && x[i] <= b) { pl = Math.min(pl, t.ph[i]); ph = Math.max(ph, t.ph[i]); } });
      const step = 45; const pr = Number.isFinite(pl) ? [Math.floor(pl / step) * step, Math.ceil(ph / step) * step] : [-180, 0]; if (pr[0] === pr[1]) { pr[0] -= 45; pr[1] += 45; }
      return { left: st.ylim || nice(lo, hi), right: pr };
    }
    const left = st.ylim || nice(...rangeOf(t => !onRight(t)));
    const right = rightAxis() ? nice(...rangeOf(t => onRight(t))) : null;
    return { left, right };
  }

  function resize() {
    const r = cv.parentElement.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
    W = Math.max(50, r.width); H = Math.max(50, r.height);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
  }
  function unitOf(t) { return isAC() ? 'dB' : t.unit; }
  function draw() {
    if (!cv) return;
    resize(); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);
    if (!st.data) {
      g.fillStyle = '#6a7a8c'; g.font = `14px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(A.running ? 'Simulating…' : A.result && A.result.analysis === 'op' ? 'Operating point: node voltages are on the schematic, all values in the Output tab' : 'Run a simulation (F5), then click nets or parts on the schematic to plot them', W / 2, H / 2);
      return;
    }
    if (!st.data.x.length) return;
    const lim = limits(), pw = plotW(), ph = plotH();
    // grid + axes
    g.strokeStyle = '#e3e8ee'; g.lineWidth = 1; g.font = `11px ${FONT}`; g.fillStyle = '#44505c';
    // x ticks
    g.textAlign = 'center'; g.textBaseline = 'top';
    if (isAC()) {
      const [a, b] = st.xlim;
      for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) for (let m = 1; m < 10; m++) {
        const v = m * Math.pow(10, e); if (v < a * 0.999 || v > b * 1.001) continue; const px = Math.round(X(v)) + 0.5;
        g.strokeStyle = m === 1 ? '#d5dde6' : '#eef1f5'; g.beginPath(); g.moveTo(px, M.t); g.lineTo(px, M.t + ph); g.stroke();
        if (m === 1 || (b / a < 30 && (m === 2 || m === 5))) g.fillText(Ex.fmtEng(v, 3, 'Hz'), px, M.t + ph + 6);
      }
    } else {
      ticks(st.xlim[0], st.xlim[1], Math.max(2, Math.floor(pw / 90))).forEach(v => { const px = Math.round(X(v)) + 0.5; g.strokeStyle = '#e3e8ee'; g.beginPath(); g.moveTo(px, M.t); g.lineTo(px, M.t + ph); g.stroke(); g.fillText(Ex.fmtEng(v, 4, st.data.analysis === 'tran' ? 's' : st.data.analysis === 'dc' ? (/^i/i.test(st.data.xname) ? 'A' : 'V') : ''), px, M.t + ph + 6); });
    }
    // left y ticks
    const lu = isAC() ? 'dB' : (st.traces.find(t => !onRight(t)) || {}).unit || '';
    g.textAlign = 'right'; g.textBaseline = 'middle';
    ticks(lim.left[0], lim.left[1], Math.max(2, Math.floor(ph / 40))).forEach(v => { const py = Math.round(Y(v, lim.left)) + 0.5; g.strokeStyle = '#e3e8ee'; g.beginPath(); g.moveTo(M.l, py); g.lineTo(M.l + pw, py); g.stroke(); g.fillStyle = '#44505c'; g.fillText(isAC() ? (+v.toFixed(1)) + ' dB' : Ex.fmtEng(v, 4, lu), M.l - 6, py); });
    if (lim.right) {
      g.textAlign = 'left';
      const n = Math.max(2, Math.floor(ph / 40)), list = isAC() ? (() => { const out = [], s = niceStep((lim.right[1] - lim.right[0]) / n) < 45 ? niceStep((lim.right[1] - lim.right[0]) / n) : 45; for (let v = lim.right[0]; v <= lim.right[1] + 1e-9; v += s) out.push(v); return out; })() : ticks(lim.right[0], lim.right[1], n);
      list.forEach(v => { const py = Y(v, lim.right); g.fillStyle = '#6b5a2b'; g.fillText(isAC() ? Math.round(v) + '°' : Ex.fmtEng(v, 4, 'A'), M.l + pw + 6, py); });
    }
    g.strokeStyle = '#9aa8b6'; g.strokeRect(M.l + 0.5, M.t + 0.5, pw, ph);
    // traces
    g.save(); g.beginPath(); g.rect(M.l, M.t, pw, ph); g.clip();
    st.traces.forEach((t, ti) => {
      g.strokeStyle = t.color; g.lineWidth = ti === st.active ? 2 : 1.4;
      plotLine(t.y, onRight(t) ? lim.right : lim.left);
      if (isAC() && t.ph) { g.setLineDash([5, 4]); g.lineWidth = 1.1; plotLine(t.ph, lim.right); g.setLineDash([]); }
    });
    // cursors
    st.cursors.forEach((c, k) => {
      if (c == null) return; const px = Math.round(X(c)) + 0.5;
      g.strokeStyle = k ? '#7a3cc4' : '#d2691e'; g.lineWidth = 1; g.setLineDash([6, 3]); g.beginPath(); g.moveTo(px, M.t); g.lineTo(px, M.t + ph); g.stroke(); g.setLineDash([]);
      st.traces.forEach(t => { const v = interp(t, 'y', c); if (!Number.isFinite(v)) return; const lim2 = onRight(t) ? lim.right : lim.left; g.fillStyle = t.color; g.beginPath(); g.arc(px, Y(v, lim2), 3.5, 0, 7); g.fill(); });
    });
    g.restore();
    st.cursors.forEach((c, k) => { if (c == null) return; const px = X(c); g.fillStyle = k ? '#7a3cc4' : '#d2691e'; g.font = `600 11px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'bottom'; g.fillText(k ? '2' : '1', px, M.t - 2); });
    // legend
    let lx = M.l + 4; g.font = `600 12px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left'; st.legend = [];
    st.traces.forEach((t, ti) => {
      const label = t.name + (onRight(t) ? ' →' : ''), w = g.measureText(label).width;
      g.fillStyle = t.color; g.fillRect(lx, 9, 14, 3); g.fillText(label, lx + 18, 11);
      if (ti === st.active) { g.fillRect(lx + 18, 18, w, 1.5); }
      st.legend.push([lx, lx + 18 + w, ti]); lx += w + 34;
    });
    if (isAC()) { g.fillStyle = '#6b5a2b'; g.font = `11px ${FONT}`; g.textAlign = 'right'; g.fillText('solid: magnitude · dashed: phase', W - 8, 11); }
    // box zoom rubber band
    if (st.drag && st.drag.kind === 'box' && st.mouse) { g.strokeStyle = '#2d78c4'; g.fillStyle = 'rgba(45,120,196,.12)'; const x = Math.min(st.drag.x, st.mouse.x), y = Math.min(st.drag.y, st.mouse.y), w = Math.abs(st.mouse.x - st.drag.x), h = Math.abs(st.mouse.y - st.drag.y); g.fillRect(x, y, w, h); g.strokeRect(x + 0.5, y + 0.5, w, h); }
  }
  function plotLine(ys, lim) {
    if (!ys) return;
    const x = st.data.x, [a, b] = st.xlim, n = x.length; let i0 = Math.max(0, lower(x, a) - 1), i1 = Math.min(n - 1, lower(x, b) + 2);
    g.beginPath(); let started = false;
    const cols = Math.max(1, plotW());
    if (i1 - i0 > cols * 4) {
      // min/max per pixel column
      let col = -1, mn = 0, mx = 0, first = 0, last = 0;
      const flush = () => { if (col < 0) return; const px = M.l + col; if (!started) { g.moveTo(px, Y(first, lim)); started = true; } else g.lineTo(px, Y(first, lim)); g.lineTo(px, Y(mn, lim)); g.lineTo(px, Y(mx, lim)); g.lineTo(px, Y(last, lim)); };
      for (let i = i0; i <= i1; i++) {
        const v = ys[i]; if (!Number.isFinite(v)) continue; const c = Math.floor(X(x[i]) - M.l);
        if (c !== col) { flush(); col = c; mn = mx = first = last = v; } else { if (v < mn) mn = v; if (v > mx) mx = v; last = v; }
      }
      flush();
    } else {
      for (let i = i0; i <= i1; i++) { const v = ys[i]; if (!Number.isFinite(v)) { started = false; continue; } const px = X(x[i]), py = Y(v, lim); if (!started) { g.moveTo(px, py); started = true; } else g.lineTo(px, py); }
    }
    g.stroke();
  }

  // ---------- interaction ----------
  const inPlot = (x, y) => x >= M.l && x <= M.l + plotW() && y >= M.t && y <= M.t + plotH();
  function cursorAt(x) { for (let k = 0; k < 2; k++) if (st.cursors[k] != null && Math.abs(X(st.cursors[k]) - x) < 6) return k; return -1; }
  function onDown(e) {
    if (!st.data) return;
    const x = e.offsetX, y = e.offsetY; cv.setPointerCapture(e.pointerId);
    if (y < M.t && st.legend) { const L = st.legend.find(([a, b]) => x >= a && x <= b); if (L) { st.active = L[2]; A.onTracesChanged(true); draw(); } return; }
    if (e.button === 2 || e.button === 1) { st.drag = { kind: 'pan', x, y, xlim: st.xlim.slice(), ylim: limits().left.slice() }; return; }
    const k = cursorAt(x); if (k >= 0) { st.drag = { kind: 'cursor', k }; return; }
    if (inPlot(x, y)) st.drag = { kind: 'box', x, y };
  }
  function onMove(e) {
    if (!st.data) return;
    const x = e.offsetX, y = e.offsetY; st.mouse = { x, y };
    cv.style.cursor = cursorAt(x) >= 0 ? 'ew-resize' : inPlot(x, y) ? 'crosshair' : y < M.t ? 'pointer' : 'default';
    if (inPlot(x, y) && st.xlim) { const lim = limits(); A.status(`${Ex.fmtEng(Xinv(x), 5, isAC() ? 'Hz' : st.data.analysis === 'tran' ? 's' : '')}   ${isAC() ? (+Yinv(y, lim.left).toFixed(2)) + ' dB' : Ex.fmtEng(Yinv(y, lim.left), 4)}`); }
    if (!st.drag) return;
    if (st.drag.kind === 'cursor') { st.cursors[st.drag.k] = clampX(Xinv(x)); A.onCursor(); draw(); return; }
    if (st.drag.kind === 'pan') {
      const d = st.drag, dx = x - d.x, dy = y - d.y;
      if (isAC()) { const r = Math.log10(d.xlim[1] / d.xlim[0]) * dx / plotW(); st.xlim = [d.xlim[0] / Math.pow(10, r), d.xlim[1] / Math.pow(10, r)]; }
      else { const r = (d.xlim[1] - d.xlim[0]) * dx / plotW(); st.xlim = [d.xlim[0] - r, d.xlim[1] - r]; }
      const ry = (d.ylim[1] - d.ylim[0]) * dy / plotH(); st.ylim = [d.ylim[0] + ry, d.ylim[1] + ry]; draw(); return;
    }
    if (st.drag.kind === 'box') draw();
  }
  function onUp(e) {
    const d = st.drag; st.drag = null; if (!d || !st.data) return;
    if (d.kind === 'box') {
      const x = e.offsetX, y = e.offsetY;
      if (Math.abs(x - d.x) > 6) {
        const lim = limits(); st.xlim = [Xinv(Math.min(x, d.x)), Xinv(Math.max(x, d.x))];
        if (Math.abs(y - d.y) > 6) st.ylim = [Yinv(Math.max(y, d.y), lim.left), Yinv(Math.min(y, d.y), lim.left)];
        A.onCursor();
      } else if (Math.abs(y - d.y) <= 6 && inPlot(x, y) && (st.cursors[0] != null || st.cursors[1] != null)) {
        // click moves the nearest enabled cursor
        const xv = clampX(Xinv(x)); const ks = [0, 1].filter(k => st.cursors[k] != null); const k = ks.sort((a, b) => Math.abs(X(st.cursors[a]) - x) - Math.abs(X(st.cursors[b]) - x))[0]; st.cursors[k] = xv; A.onCursor();
      }
      draw();
    }
  }
  function clampX(v) { const x = st.data.x; return Math.max(x[0], Math.min(x[x.length - 1], v)); }
  function onWheel(e) {
    if (!st.data) return; e.preventDefault();
    const f = e.deltaY < 0 ? 1 / 1.25 : 1.25, x = e.offsetX;
    if (e.shiftKey) { const lim = limits().left, yv = Yinv(e.offsetY, lim); st.ylim = [yv - (yv - lim[0]) * f, yv + (lim[1] - yv) * f]; draw(); return; }
    const xv = Xinv(x);
    if (isAC()) { const l0 = Math.log10(st.xlim[0]), l1 = Math.log10(st.xlim[1]), lv = Math.log10(xv); st.xlim = [Math.pow(10, lv - (lv - l0) * f), Math.pow(10, lv + (l1 - lv) * f)]; }
    else st.xlim = [xv - (xv - st.xlim[0]) * f, xv + (st.xlim[1] - xv) * f];
    const x0 = st.data.x[0], x1 = st.data.x[st.data.x.length - 1]; if (st.xlim[0] < x0) st.xlim[0] = x0; if (st.xlim[1] > x1) st.xlim[1] = x1;
    if (!(st.xlim[1] > st.xlim[0])) st.xlim = [x0, x1];
    A.onCursor(); draw();
  }

  window.PlotView = {
    attach(app, canvas) {
      A = app; cv = canvas; g = cv.getContext('2d');
      cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp);
      cv.addEventListener('wheel', onWheel, { passive: false }); cv.addEventListener('contextmenu', e => e.preventDefault());
      cv.addEventListener('dblclick', () => { PlotView.fit(); });
    },
    set(data, traces, keepView) {
      const sameKind = st.data && data && st.data.analysis === data.analysis && st.data.xname === data.xname;
      st.data = data; st.traces = traces || [];
      if (st.active >= st.traces.length) st.active = Math.max(0, st.traces.length - 1);
      if (!data || !data.x.length) { st.xlim = null; draw(); return; }
      const x0 = data.x[0], x1 = data.x[data.x.length - 1];
      if (!sameKind) st.cursors = [null, null];
      if (!(keepView && sameKind && st.xlim)) { st.xlim = [x0, x1 > x0 ? x1 : x0 + 1]; st.ylim = null; st.cursors = st.cursors.map(c => c == null ? null : Math.max(x0, Math.min(x1, c))); }
      draw();
    },
    fit() { if (!st.data || !st.data.x.length) return; const x = st.data.x; st.xlim = [x[0], x[x.length - 1] > x[0] ? x[x.length - 1] : x[0] + 1]; st.ylim = null; A.onCursor(); draw(); },
    zoom(f) { if (!st.xlim) return; const c = isAC() ? Math.sqrt(st.xlim[0] * st.xlim[1]) : (st.xlim[0] + st.xlim[1]) / 2; if (isAC()) { const r = Math.pow(st.xlim[1] / st.xlim[0], f / 2); st.xlim = [c / r, c * r]; } else { const h = (st.xlim[1] - st.xlim[0]) / 2 * f; st.xlim = [c - h, c + h]; } A.onCursor(); draw(); },
    draw,
    toggleCursor(k) {
      if (!st.data || !st.data.x.length) return;
      if (st.cursors[k] != null) st.cursors[k] = null;
      else { const [a, b] = st.xlim; st.cursors[k] = isAC() ? Math.sqrt(a * b) * (k ? 2 : 0.5) : a + (b - a) * (k ? 0.7 : 0.3); st.cursors[k] = clampX(st.cursors[k]); }
      A.onCursor(); draw();
    },
    get cursors() { return st.cursors.slice(); },
    get xlim() { return st.xlim && st.xlim.slice(); },
    get active() { return st.active; }, set active(i) { st.active = i; draw(); },
    get isAC() { return isAC(); },
    valueAt(t, x, which) { return interp(t, which || 'y', x); },
    canvas: () => cv,
  };
})();
