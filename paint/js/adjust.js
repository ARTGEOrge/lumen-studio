'use strict';
/* Adjustments on the current pixel layer (Image › Adjustments): hue/saturation/lightness, brightness/
   contrast, curves, levels, color balance, invert, gradient map. Every dialog previews live on the canvas,
   respects the selection (soft edges included) and commits as one undo step; Cancel restores the tiles. */

/* ---------- monotone cubic curve (Fritsch–Carlson) → 256-entry LUT ---------- */
function curveLUT(pts, n = 256) {
  const p = pts.slice().sort((a, b) => a[0] - b[0]), lut = new Float32Array(n), k = p.length;
  if (k === 1) { lut.fill(p[0][1]); return lut; }
  const dx = [], m = [], d = [];
  for (let i = 0; i < k - 1; i++) { dx[i] = Math.max(1e-6, p[i + 1][0] - p[i][0]); d[i] = (p[i + 1][1] - p[i][1]) / dx[i]; }
  m[0] = d[0]; m[k - 1] = d[k - 2];
  for (let i = 1; i < k - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < k - 1; i++) { if (!d[i]) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
  for (let j = 0; j < n; j++) {
    const x = j / (n - 1); let v;
    if (x <= p[0][0]) v = p[0][1]; else if (x >= p[k - 1][0]) v = p[k - 1][1];
    else {
      let i = 0; while (i < k - 2 && x > p[i + 1][0]) i++;
      const h = dx[i], t = (x - p[i][0]) / h, t2 = t * t, t3 = t2 * t;
      v = (2 * t3 - 3 * t2 + 1) * p[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1][1] + (t3 - t2) * h * m[i + 1];
    }
    lut[j] = clamp(v, 0, 1);
  }
  return lut;
}
/* small interactive curve editor (used by Curves and by the pressure-curve calibration) */
class CurveEditor {
  constructor(canvas, pts, { onChange, bg, color = '#1f3a5a', size = 256 } = {}) {
    this.cv = canvas; this.pts = pts.map(p => p.slice()); this.onChange = onChange; this.bg = bg; this.color = color; this.S = size; this.marker = null;
    canvas.width = size + 12; canvas.height = size + 12;
    const pos = e => { const r = canvas.getBoundingClientRect(); return [clamp(((e.clientX - r.left) * canvas.width / r.width - 6) / size, 0, 1), clamp(1 - ((e.clientY - r.top) * canvas.height / r.height - 6) / size, 0, 1)]; };
    canvas.addEventListener('pointerdown', e => {
      const [x, y] = pos(e); let i = this.pts.findIndex(p => Math.hypot(p[0] - x, p[1] - y) < 0.045);
      if (i < 0) { this.pts.push([x, y]); this.pts.sort((a, b) => a[0] - b[0]); i = this.pts.findIndex(p => p[0] === x && p[1] === y); }
      const end = i === 0 || i === this.pts.length - 1, P = this.pts[i];
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
      canvas.onpointermove = ev => {
        const [nx, ny] = pos(ev), prev = this.pts[i - 1], next = this.pts[i + 1];
        // dragging a middle point far outside removes it
        if (!end && (ny < -0.1 || ny > 1.1 || nx < -0.1 || nx > 1.1)) return;
        P[0] = end ? P[0] : clamp(nx, prev ? prev[0] + 0.01 : 0, next ? next[0] - 0.01 : 1); P[1] = ny;
        if (end && i === 0) P[0] = clamp(nx, 0, next ? next[0] - 0.01 : 1); if (end && i === this.pts.length - 1) P[0] = clamp(nx, prev ? prev[0] + 0.01 : 0, 1);
        this.draw(); this.onChange?.(this.pts);
      };
      canvas.onpointerup = () => { canvas.onpointermove = null; this.draw(); this.onChange?.(this.pts); };
      this.draw(); this.onChange?.(this.pts);
    });
    canvas.addEventListener('dblclick', e => { const [x, y] = pos(e), i = this.pts.findIndex(p => Math.hypot(p[0] - x, p[1] - y) < 0.045); if (i > 0 && i < this.pts.length - 1) { this.pts.splice(i, 1); this.draw(); this.onChange?.(this.pts); } });
    this.draw();
  }
  set(pts) { this.pts = pts.map(p => p.slice()); this.draw(); }
  draw() {
    const c = this.cv.getContext('2d'), S = this.S, o = 6;
    c.clearRect(0, 0, this.cv.width, this.cv.height); c.fillStyle = '#fff'; c.fillRect(o, o, S, S);
    if (this.bg) this.bg(c, o, S);
    c.strokeStyle = '#e3e9f1'; c.lineWidth = 1; c.beginPath(); for (let i = 1; i < 4; i++) { const q = o + Math.round(S * i / 4) + 0.5; c.moveTo(q, o); c.lineTo(q, o + S); c.moveTo(o, q); c.lineTo(o + S, q); } c.stroke();
    c.strokeStyle = '#c9d4e2'; c.beginPath(); c.moveTo(o, o + S); c.lineTo(o + S, o); c.stroke();
    c.strokeStyle = '#8aa0b8'; c.strokeRect(o - 0.5, o - 0.5, S + 1, S + 1);
    const lut = curveLUT(this.pts, S + 1);
    c.strokeStyle = this.color; c.lineWidth = 2; c.beginPath(); for (let i = 0; i <= S; i++) { const y = o + (1 - lut[i]) * S; i ? c.lineTo(o + i, y) : c.moveTo(o + i, y); } c.stroke();
    for (const p of this.pts) { c.fillStyle = '#fff'; c.strokeStyle = this.color; c.lineWidth = 1.5; c.beginPath(); c.rect(o + p[0] * S - 3.5, o + (1 - p[1]) * S - 3.5, 7, 7); c.fill(); c.stroke(); }
    if (this.marker) { const [mx, my] = this.marker; c.fillStyle = '#d6500a'; c.beginPath(); c.arc(o + mx * S, o + (1 - my) * S, 4.5, 0, 7); c.fill(); }
  }
}

/* ---------- running an adjustment over a layer ---------- */
function adjustTarget() {
  const A = doc.active;
  if (A && A.mask && doc.editMask) { Aero.toast('Adjustments change layer pixels — click the layer thumbnail (or use Layer › Invert Mask)'); return null; }
  if (A && A.text) { askRasterizeText(A); return null; }
  if (!A || A.type !== 'pixel') { Aero.toast('Select a pixel layer to adjust'); return null; }
  return A;
}
function adjustSession() {
  if (!prepEdit()) return null; const L = adjustTarget(); if (!L) return null;
  freezeAll();
  const sb = doc.selBox, R0 = doc.sel ? (sb ? [sb.x, sb.y, sb.x + sb.w, sb.y + sb.h] : null) : [0, 0, doc.w, doc.h];
  if (!R0) { Aero.toast('The selection is empty'); return null; }
  const idxs = [];
  for (let ty = (R0[1] / TS) | 0; ty <= ((R0[3] - 1) / TS | 0); ty++) for (let tx = (R0[0] / TS) | 0; tx <= ((R0[2] - 1) / TS | 0); tx++) { const i = ty * doc.tw + tx; if (L.tiles[i]) idxs.push(i); }
  if (!idxs.length) { Aero.toast('Nothing to adjust on this layer' + (doc.sel ? ' inside the selection' : '')); return null; }
  return { L, orig: L.tiles.slice(), idxs, R: R0, sel: doc.sel, buf: new Map() };
}
// px(src, dst, o) adjusts one straight-RGBA pixel (alpha is left alone); the selection blends the result
function adjustRun(S, px) {
  const L = S.L, sel = S.sel, W = doc.w, tw = doc.tw, R0 = S.R;
  for (const idx of S.idxs) {
    const src = S.orig[idx]; let dst = S.buf.get(idx); if (!dst) { dst = new Uint8ClampedArray(TSZ); S.buf.set(idx, dst); }
    dst.set(src);
    const ox = (idx % tw) * TS, oy = ((idx / tw) | 0) * TS;
    const x0 = Math.max(R0[0], ox), y0 = Math.max(R0[1], oy), x1 = Math.min(R0[2], ox + TS, doc.w), y1 = Math.min(R0[3], oy + TS, doc.h);
    for (let y = y0; y < y1; y++) {
      let o = ((y - oy) * TS + (x0 - ox)) * 4;
      for (let x = x0; x < x1; x++, o += 4) {
        if (!src[o + 3]) continue;
        if (sel) {
          const s = sel[y * W + x]; if (!s) continue;
          px(src, dst, o);
          if (s < 255) { const k = s / 255; dst[o] = src[o] + (dst[o] - src[o]) * k; dst[o + 1] = src[o + 1] + (dst[o + 1] - src[o + 1]) * k; dst[o + 2] = src[o + 2] + (dst[o + 2] - src[o + 2]) * k; }
        } else px(src, dst, o);
      }
    }
    L.tiles[idx] = dst; L.dirty.add(idx);
  }
  markDirty(L);
}
function adjustCancel(S) { for (const idx of S.idxs) { S.L.tiles[idx] = S.orig[idx]; S.L.dirty.add(idx); } markDirty(S.L); }
function adjustCommit(S, label) { S.L.owned.clear(); histPush(label); layerThumbDirty(S.L); }
const lutPx = (lr, lg, lb) => (s, d, o) => { d[o] = lr[s[o]]; d[o + 1] = lg[s[o + 1]]; d[o + 2] = lb[s[o + 2]]; };
const lut8 = f => { const a = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) a[i] = Math.round(f(i / 255) * 255); return a; };

// generic dialog wrapper: build(v) → pixel fn; extra(dlg, S, refresh) adds custom UI
function adjustDialog(title, fields, build, extra, instruction) {
  const S = adjustSession(); if (!S) return;
  let lastV = null, dlg = null;
  const refresh = v => { lastV = v || (dlg ? { ...dlg.values } : lastV); adjustRun(S, build(lastV, S)); };
  dlg = Aero.dialog({ title, instruction, fields, width: extra ? 380 : undefined, ok: 'Apply',
    onChange: v => refresh(v),
    onOK: v => { adjustRun(S, build(v, S)); adjustCommit(S, title); },
    onCancel: () => adjustCancel(S) });
  if (extra) extra(dlg, S, () => refresh());
  return dlg;
}

/* ---------- color math ---------- */
function rgb2hsl(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; } return [h, s, l]; }
function hue2c(p, q, t) { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; }
function hsl2rgb(h, s, l) { if (!s) return [l, l, l]; const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q; return [hue2c(p, q, h + 1 / 3), hue2c(p, q, h), hue2c(p, q, h - 1 / 3)]; }

/* ---------- the adjustments ---------- */
function adjHSL() {
  adjustDialog('Hue / Saturation', [
    { key: 'h', label: 'Hue', type: 'range', min: -180, max: 180, value: 0, fmt: v => (v > 0 ? '+' : '') + v + '°' },
    { key: 's', label: 'Saturation', type: 'range', min: -100, max: 100, value: 0, fmt: v => (v > 0 ? '+' : '') + v },
    { key: 'l', label: 'Lightness', type: 'range', min: -100, max: 100, value: 0, fmt: v => (v > 0 ? '+' : '') + v },
    { key: 'c', label: 'Colorize', type: 'checkbox', value: false }],
  v => {
    const dh = v.h / 360, ds = v.s / 100, dl = v.l / 100, col = v.c;
    return (s, d, o) => {
      let [h, sa, l] = rgb2hsl(s[o] / 255, s[o + 1] / 255, s[o + 2] / 255);
      if (col) { h = ((v.h + 360) % 360) / 360; sa = clamp(0.25 + ds * 0.75 + (ds < 0 ? ds * 0.25 : 0), 0, 1); }
      else { h = (h + dh + 1) % 1; sa = ds >= 0 ? sa + (1 - sa) * ds * sa : sa * (1 + ds); }
      l = dl >= 0 ? l + (1 - l) * dl : l * (1 + dl);
      const c = hsl2rgb(h, clamp(sa, 0, 1), clamp(l, 0, 1)); d[o] = c[0] * 255 + 0.5; d[o + 1] = c[1] * 255 + 0.5; d[o + 2] = c[2] * 255 + 0.5;
    };
  });
}
function adjBrightnessContrast() {
  adjustDialog('Brightness / Contrast', [
    { key: 'b', label: 'Brightness', type: 'range', min: -150, max: 150, value: 0 },
    { key: 'c', label: 'Contrast', type: 'range', min: -100, max: 100, value: 0 }],
  v => {
    const C = v.c * 2.55, f = (259 * (C + 255)) / (255 * (259 - C)), B = v.b / 255;
    const l = lut8(x => { x = B >= 0 ? x + (1 - x) * B * 0.66 + B * 0.34 * x : x * (1 + B); return (x - 0.5) * f + 0.5; });
    return lutPx(l, l, l);
  });
}
function adjInvert() {
  const S = adjustSession(); if (!S) return;
  adjustRun(S, (s, d, o) => { d[o] = 255 - s[o]; d[o + 1] = 255 - s[o + 1]; d[o + 2] = 255 - s[o + 2]; });
  adjustCommit(S, 'Invert');
}
function histogramOf(S) { // alpha-weighted luminance + per-channel histograms of the region
  const h = [new Float64Array(256), new Float64Array(256), new Float64Array(256), new Float64Array(256)], sel = S.sel, W = doc.w, tw = doc.tw, R0 = S.R;
  for (const idx of S.idxs) {
    const t = S.orig[idx], ox = (idx % tw) * TS, oy = ((idx / tw) | 0) * TS;
    const x0 = Math.max(R0[0], ox), y0 = Math.max(R0[1], oy), x1 = Math.min(R0[2], ox + TS, doc.w), y1 = Math.min(R0[3], oy + TS, doc.h);
    for (let y = y0; y < y1; y += 2) { let o = ((y - oy) * TS + (x0 - ox)) * 4; for (let x = x0; x < x1; x += 2, o += 8) { let a = t[o + 3]; if (!a) continue; if (sel) a *= sel[y * W + x] / 255; h[0][Math.round(0.299 * t[o] + 0.587 * t[o + 1] + 0.114 * t[o + 2])] += a; h[1][t[o]] += a; h[2][t[o + 1]] += a; h[3][t[o + 2]] += a; } }
  }
  return h;
}
function drawHist(c, o, S, hist, color = 'rgba(40,60,90,.22)') {
  let mx = 0; for (let i = 2; i < 254; i++) mx = Math.max(mx, hist[i]); mx = mx || 1;
  c.fillStyle = color; c.beginPath(); c.moveTo(o, o + S);
  for (let i = 0; i < 256; i++) c.lineTo(o + i / 255 * S, o + S - Math.min(1, hist[i] / mx) * S * 0.95);
  c.lineTo(o + S, o + S); c.closePath(); c.fill();
}
const CH_NAMES = [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']];
function adjCurves() {
  const curves = { rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] };
  let ch = 'rgb', ed = null, hist = null;
  const presets = { linear: [[0, 0], [1, 1]], contrast: [[0, 0], [0.25, 0.18], [0.75, 0.82], [1, 1]], strong: [[0, 0], [0.25, 0.12], [0.75, 0.88], [1, 1]], lighter: [[0, 0], [0.5, 0.62], [1, 1]], darker: [[0, 0], [0.5, 0.38], [1, 1]], negative: [[0, 1], [1, 0]] };
  const build = () => {
    const m = curveLUT(curves.rgb), r = curveLUT(curves.r), g = curveLUT(curves.g), b = curveLUT(curves.b);
    const f = (c, i) => lut8(x => m[Math.round(c[Math.round(x * 255)] * 255)]);
    return lutPx(f(r), f(g), f(b));
  };
  adjustDialog('Curves', [
    { key: 'ch', label: 'Channel', type: 'select', options: CH_NAMES, value: 'rgb' },
    { key: 'pre', label: 'Preset', type: 'select', options: [['', 'Custom'], ['linear', 'Linear (reset)'], ['contrast', 'Medium contrast'], ['strong', 'Strong contrast'], ['lighter', 'Lighter'], ['darker', 'Darker'], ['negative', 'Negative']], value: '' }],
  (v, S) => { if (v.ch !== ch) { ch = v.ch; ed?.set(curves[ch]); ed && (ed.color = { rgb: '#1f3a5a', r: '#c0281a', g: '#2a7f14', b: '#1c5fb4' }[ch]); ed?.draw(); } if (v.pre && presets[v.pre]) { curves[ch] = presets[v.pre].map(p => p.slice()); ed?.set(curves[ch]); } return build(); },
  (dlg, S, refresh) => {
    hist = histogramOf(S);
    const wrap = el('div', 'adj-curve'), cv = el('canvas'); wrap.appendChild(cv); wrap.appendChild(el('div', 'dim', 'Click to add a point · drag to shape · double-click a point to remove'));
    dlg.el.querySelector('.content').appendChild(wrap);
    ed = new CurveEditor(cv, curves[ch], { bg: (c, o, Sz) => drawHist(c, o, Sz, hist[{ rgb: 0, r: 1, g: 2, b: 3 }[ch]]), onChange: pts => { curves[ch] = pts.map(p => p.slice()); dlg.set('pre', ''); refresh(); } });
  });
}
function adjLevels() {
  const st = {}; for (const [k] of CH_NAMES) st[k] = { ib: 0, g: 1, iw: 255, ob: 0, ow: 255 };
  let hist = null, cv = null, ch = 'rgb';
  const lev = s => lut8(x => { const v = clamp((x * 255 - s.ib) / Math.max(1, s.iw - s.ib), 0, 1); return (s.ob + Math.pow(v, 1 / s.g) * (s.ow - s.ob)) / 255; });
  const drawH = () => { if (!cv) return; const c = cv.getContext('2d'), S = 256; c.clearRect(0, 0, cv.width, cv.height); c.fillStyle = '#fff'; c.fillRect(0, 0, S, 70); const hh = hist[{ rgb: 0, r: 1, g: 2, b: 3 }[ch]]; let mx = 0; for (let i = 2; i < 254; i++) mx = Math.max(mx, hh[i]); c.fillStyle = '#3a4a5e'; for (let i = 0; i < 256; i++) { const v = Math.min(1, hh[i] / (mx || 1)) * 66; c.fillRect(i, 70 - v, 1, v); } const s = st[ch]; c.fillStyle = '#d6500a'; for (const x of [s.ib, s.iw, s.ib + (s.iw - s.ib) * Math.pow(0.5, s.g)]) c.fillRect(x - 1, 0, 2, 70); };
  adjustDialog('Levels', [
    { key: 'ch', label: 'Channel', type: 'select', options: CH_NAMES, value: 'rgb' },
    { key: 'ib', label: 'Input black', type: 'range', min: 0, max: 253, value: 0 },
    { key: 'g', label: 'Gamma (midtones)', type: 'range', min: 0.1, max: 5, step: 0.01, value: 1, fmt: v => v.toFixed(2) },
    { key: 'iw', label: 'Input white', type: 'range', min: 2, max: 255, value: 255 },
    { key: 'ob', label: 'Output black', type: 'range', min: 0, max: 255, value: 0 },
    { key: 'ow', label: 'Output white', type: 'range', min: 0, max: 255, value: 255 }],
  v => {
    if (v.ch === ch) st[ch] = { ib: Math.min(v.ib, v.iw - 2), g: v.g, iw: Math.max(v.iw, v.ib + 2), ob: v.ob, ow: v.ow };
    drawH();
    const m = lev(st.rgb), f = c => { const l = lev(c); return lut8(x => m[l[Math.round(x * 255)]] / 255); };
    return lutPx(f(st.r), f(st.g), f(st.b));
  },
  (dlg, S) => {
    hist = histogramOf(S); cv = el('canvas', 'adj-hist'); cv.width = 256; cv.height = 70;
    const content = dlg.el.querySelector('.content'); content.insertBefore(cv, content.children[1] || null); drawH();
    dlg.el.querySelector('select').addEventListener('change', e => { ch = e.target.value; const s = st[ch]; for (const k of ['ib', 'g', 'iw', 'ob', 'ow']) dlg.set(k, s[k]); drawH(); });
    const auto = el('button', 'aero-btn small', 'Auto'); auto.title = 'Stretch the darkest / lightest 0.1% to black / white';
    auto.onclick = () => { const h = hist[{ rgb: 0, r: 1, g: 2, b: 3 }[ch]], tot = h.reduce((a, b) => a + b, 0); let acc = 0, lo = 0, hi = 255; for (let i = 0; i < 256; i++) { acc += h[i]; if (acc > tot * 0.001) { lo = i; break; } } acc = 0; for (let i = 255; i >= 0; i--) { acc += h[i]; if (acc > tot * 0.001) { hi = i; break; } } dlg.set('ib', lo); dlg.set('iw', Math.max(lo + 2, hi)); st[ch].ib = lo; st[ch].iw = Math.max(lo + 2, hi); dlg.el.querySelector('input[type=range]').dispatchEvent(new Event('change')); };
    dlg.el.querySelector('.aero-btns').prepend(auto);
  });
}
function adjColorBalance() {
  // weights of shadows / midtones / highlights by the pixel's lightness
  const wts = l => [(1 - l) * (1 - l), 4 * l * (1 - l), l * l];
  const f = s => (s > 0 ? '+' : '') + s, st = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]; let t = 1;
  adjustDialog('Color Balance', [
    { key: 't', label: 'Tones', type: 'select', options: [['1', 'Midtones'], ['0', 'Shadows'], ['2', 'Highlights']], value: '1' },
    { key: 'cr', label: 'Cyan ↔ Red', type: 'range', min: -100, max: 100, value: 0, fmt: f },
    { key: 'mg', label: 'Magenta ↔ Green', type: 'range', min: -100, max: 100, value: 0, fmt: f },
    { key: 'yb', label: 'Yellow ↔ Blue', type: 'range', min: -100, max: 100, value: 0, fmt: f },
    { key: 'pl', label: 'Preserve luminosity', type: 'checkbox', value: true }],
  v => {
    if (+v.t === t) st[t] = [v.cr, v.mg, v.yb];
    const pl = v.pl;
    return (s, d, o) => {
      const r0 = s[o] / 255, g0 = s[o + 1] / 255, b0 = s[o + 2] / 255, mx = Math.max(r0, g0, b0), mn = Math.min(r0, g0, b0), l0 = (mx + mn) / 2, w = wts(l0);
      const dl = c => (st[0][c] * w[0] + st[1][c] * w[1] + st[2][c] * w[2]) / 100 * 0.4;
      let r = clamp(r0 + dl(0), 0, 1), g = clamp(g0 + dl(1), 0, 1), b = clamp(b0 + dl(2), 0, 1);
      if (pl) { const [h, sa] = rgb2hsl(r, g, b); [r, g, b] = hsl2rgb(h, sa, l0); }
      d[o] = r * 255 + 0.5; d[o + 1] = g * 255 + 0.5; d[o + 2] = b * 255 + 0.5;
    };
  },
  dlg => dlg.el.querySelector('select').addEventListener('change', e => { t = +e.target.value; dlg.set('cr', st[t][0]); dlg.set('mg', st[t][1]); dlg.set('yb', st[t][2]); }));
}
const GMAP_PRESETS = { fgbg: null, noir: ['#0b0b10', '#f3f1ea'], sepia: ['#2b1a0e', '#9c6b3c', '#f6e7c8'], sunset: ['#1a1036', '#8c2b5a', '#f0703a', '#ffe08a'], ocean: ['#04142a', '#0f5e8a', '#5fc3d6', '#eafcff'], infrared: ['#000000', '#5a0c8a', '#e0285a', '#ffd23f', '#ffffff'], forest: ['#0e1a10', '#2f5a2c', '#9cbf62', '#f2f0d6'], duotone: ['#1d2b6b', '#ff8a5c'] };
function gradientLUT(stops) { const cols = stops.map(s => hexRgb(s) || [0, 0, 0]), n = cols.length - 1, out = []; for (let i = 0; i < 256; i++) { const t = i / 255 * n, k = Math.min(n - 1, Math.floor(t)), f = t - k; out.push([0, 1, 2].map(c => Math.round(lerp(cols[k][c], cols[k + 1][c], f) * 255))); } return out; }
function adjGradientMap() {
  adjustDialog('Gradient Map', [
    { key: 'p', label: 'Gradient', type: 'select', options: [['fgbg', 'Foreground → Background'], ['noir', 'Noir'], ['sepia', 'Sepia'], ['sunset', 'Sunset'], ['ocean', 'Ocean'], ['infrared', 'Infrared'], ['forest', 'Forest'], ['duotone', 'Duotone']], value: 'fgbg' },
    { key: 'rev', label: 'Reverse', type: 'checkbox', value: false },
    { key: 'amt', label: 'Strength', type: 'range', min: 0, max: 100, value: 100, fmt: v => v + '%' }],
  v => {
    let stops = GMAP_PRESETS[v.p] || [rgbHex(FG), rgbHex(BG)]; if (v.rev) stops = stops.slice().reverse();
    const lut = gradientLUT(stops), k = v.amt / 100;
    return (s, d, o) => { const c = lut[Math.round(0.299 * s[o] + 0.587 * s[o + 1] + 0.114 * s[o + 2])]; d[o] = s[o] + (c[0] - s[o]) * k; d[o + 1] = s[o + 1] + (c[1] - s[o + 1]) * k; d[o + 2] = s[o + 2] + (c[2] - s[o + 2]) * k; };
  }, null, 'Maps the layer’s brightness onto a gradient (dark → light)');
}
