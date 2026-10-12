'use strict';
/* Lumen Motion — additional effects: Levels, Curves (+ editor), Fill, Stroke, Turbulent Displace, Wave Warp, Light Rays.
   (Echo lives in render.js because it re-renders the layer at other times.) */
(function () {
  const LM = window.LM, { val, M } = LM;
  const fxv = (fx, k, t) => LM.fxv(fx, k, t);
  const I = LM.fxImpl = {};
  const clamp01 = v => Math.max(0, Math.min(1, v));
  // layer space → buffer pixels
  const bufMat = (mat, s, R) => [mat[0] * s, mat[1] * s, mat[2] * s, mat[3] * s, mat[4] * s - (R.ox || 0), mat[5] * s - (R.oy || 0)];

  /* ---------- Levels ---------- */
  I.levels = (fx, buf, L, t) => {
    const ch = fxv(fx, 'channel', t), ib = fxv(fx, 'inBlack', t), iw = fxv(fx, 'inWhite', t), g = Math.max(.01, fxv(fx, 'gamma', t)), ob = fxv(fx, 'outBlack', t), ow = fxv(fx, 'outWhite', t);
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) { const x = Math.pow(clamp01((i - ib) / ((iw - ib) || 1e-3)), 1 / g); lut[i] = Math.round(ob + (ow - ob) * x); }
    if (lut.every((v, i) => v === i)) return;
    const idx = ch === 'rgb' ? [0, 1, 2] : [{ r: 0, g: 1, b: 2 }[ch]];
    LM.pixelOp(buf, d => { for (let i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; for (const c of idx) d[i + c] = lut[d[i + c]]; } });
  };

  /* ---------- Curves ---------- */
  // monotone cubic (Fritsch–Carlson) through the control points → 256-entry LUT
  function curveLUT(pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0]), n = p.length, xs = p.map(q => q[0]), ys = p.map(q => q[1]), lut = new Uint8ClampedArray(256);
    const d = [], m = new Array(n).fill(0);
    for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / Math.max(1e-6, xs[i + 1] - xs[i]);
    m[0] = d[0]; m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], h = a * a + b * b; if (h > 9) { const k = 3 / Math.sqrt(h); m[i] = k * a * d[i]; m[i + 1] = k * b * d[i]; } }
    for (let k = 0; k < 256; k++) {
      const x = k / 255; let y;
      if (x <= xs[0]) y = ys[0]; else if (x >= xs[n - 1]) y = ys[n - 1];
      else { let i = 0; while (i < n - 2 && x > xs[i + 1]) i++; const h = xs[i + 1] - xs[i] || 1e-6, s = (x - xs[i]) / h, s2 = s * s, s3 = s2 * s; y = (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h * m[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h * m[i + 1]; }
      lut[k] = Math.round(clamp01(y) * 255);
    }
    return lut;
  }
  LM.curveLUT = curveLUT;
  I.curves = (fx, buf, L, t) => {
    const C = fxv(fx, 'curves', t), m = curveLUT(C.rgb), ch = [curveLUT(C.r), curveLUT(C.g), curveLUT(C.b)];
    const L3 = ch.map(c => { const o = new Uint8ClampedArray(256); for (let i = 0; i < 256; i++) o[i] = m[c[i]]; return o; });
    if (L3.every(l => l.every((v, i) => v === i))) return;
    LM.pixelOp(buf, d => { for (let i = 0; i < d.length; i += 4) { if (!d[i + 3]) continue; d[i] = L3[0][d[i]]; d[i + 1] = L3[1][d[i + 1]]; d[i + 2] = L3[2][d[i + 2]]; } });
  };
  // interactive curve editor (opened from the effect's “Edit Curves…” button)
  LM.curvesDialog = (fx, L) => {
    const orig = LM.clone(fx.p.curves.v); let ch = 'rgb', drag = -1;
    const COLORS = { rgb: '#1e395b', r: '#d03030', g: '#2a9a3a', b: '#2f6fd8' };
    const dlg = Aero.dialog({
      title: 'Curves', width: 340, ok: 'OK',
      html: `<div class="curves"><div class="cvtabs">${['rgb', 'r', 'g', 'b'].map(c => `<button class="aero-btn small${c === 'rgb' ? ' on' : ''}" data-c="${c}">${({ rgb: 'RGB', r: 'Red', g: 'Green', b: 'Blue' })[c]}</button>`).join('')}<button class="aero-btn small" data-reset="1" title="Reset this channel">Reset</button></div><canvas width="256" height="256"></canvas><div class="dim small">Click to add a point · drag to shape · drag a point off the graph or double-click it to remove</div></div>`,
      onOK: () => { LM.commit('Curves'); },
      onCancel: () => { fx.p.curves.v = orig; LM.touch(); },
    });
    const box = dlg.el, cv = box.querySelector('canvas'), g = cv.getContext('2d');
    const pts = () => fx.p.curves.v[ch];
    const draw = () => {
      g.clearRect(0, 0, 256, 256); g.fillStyle = '#fbfcfe'; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = '#e1e8f1'; g.lineWidth = 1; for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(i * 64 + .5, 0); g.lineTo(i * 64 + .5, 256); g.moveTo(0, i * 64 + .5); g.lineTo(256, i * 64 + .5); g.stroke(); }
      g.strokeStyle = '#c4cfdc'; g.beginPath(); g.moveTo(0, 256); g.lineTo(256, 0); g.stroke();
      ['r', 'g', 'b', 'rgb'].filter(c => c !== ch).forEach(c => { const l = curveLUT(fx.p.curves.v[c]); if (l.every((v, i) => v === i)) return; g.strokeStyle = COLORS[c] + '55'; g.beginPath(); for (let x = 0; x < 256; x++) { const y = 255 - l[x]; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); });
      const l = curveLUT(pts()); g.strokeStyle = COLORS[ch]; g.lineWidth = 2; g.beginPath(); for (let x = 0; x < 256; x++) { const y = 255 - l[x]; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
      g.fillStyle = '#fff'; g.lineWidth = 1.5; pts().forEach(p => { g.beginPath(); g.rect(p[0] * 255 - 4, (1 - p[1]) * 255 - 4, 8, 8); g.fill(); g.stroke(); });
    };
    const pos = e => { const r = cv.getBoundingClientRect(); return [clamp01((e.clientX - r.left) / r.width), clamp01(1 - (e.clientY - r.top) / r.height), (e.clientY - r.top) / r.height]; };
    const changed = () => { pts().sort((a, b) => a[0] - b[0]); LM.touch(); draw(); };
    cv.onpointerdown = e => {
      const [x, y] = pos(e), P = pts();
      drag = P.findIndex(p => Math.hypot((p[0] - x) * 256, (p[1] - y) * 256) < 9);
      if (drag < 0 && P.length < 16) { P.push([x, y]); P.sort((a, b) => a[0] - b[0]); drag = P.findIndex(p => p[0] === x && p[1] === y); changed(); }
      try { cv.setPointerCapture(e.pointerId); } catch (_) { }
    };
    cv.onpointermove = e => {
      if (drag < 0) return; const [x, y, raw] = pos(e), P = pts(), p = P[drag];
      const lo = drag > 0 ? P[drag - 1][0] + .005 : 0, hi = drag < P.length - 1 ? P[drag + 1][0] - .005 : 1;
      if ((raw < -.12 || raw > 1.12) && P.length > 2 && drag > 0 && drag < P.length - 1) { P.splice(drag, 1); drag = -1; changed(); return; }
      p[0] = drag === 0 && P.length > 1 ? Math.min(x, hi) : drag === P.length - 1 && P.length > 1 ? Math.max(x, lo) : Math.max(lo, Math.min(hi, x)); p[1] = y; LM.touch(); draw();
    };
    cv.onpointerup = () => { drag = -1; };
    cv.ondblclick = e => { const [x, y] = pos(e), P = pts(), i = P.findIndex(p => Math.hypot((p[0] - x) * 256, (p[1] - y) * 256) < 9); if (i > 0 && i < P.length - 1) { P.splice(i, 1); changed(); } };
    box.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { ch = b.dataset.c; box.querySelectorAll('[data-c]').forEach(x => x.classList.toggle('on', x === b)); draw(); });
    box.querySelector('[data-reset]').onclick = () => { fx.p.curves.v[ch] = [[0, 0], [1, 1]]; changed(); };
    draw();
    return dlg;
  };

  /* ---------- Fill ---------- */
  I.fill = (fx, buf, L, t) => {
    const op = clamp01(fxv(fx, 'opacity', t) / 100); if (op <= 0) return;
    const x = buf._ctx; x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-atop'; x.globalAlpha = op; x.fillStyle = fxv(fx, 'color', t); x.fillRect(0, 0, buf.width, buf.height); x.restore();
  };

  /* ---------- Stroke (along masks, or the shape's paths when the layer has no masks) ---------- */
  I.stroke = (fx, buf, L, t, comp, s, R, mat) => {
    const which = fxv(fx, 'path', t); let paths = [];
    if (which === 'all') { if (L.masks.length) paths = L.masks.filter(m => m.mode !== 'none').map(m => ({ path: val(m.path, t), m: M.id() })); else if (L.type === 'shape') paths = LM.shapeItems(L, t).map(it => ({ path: it.path, m: it.m })); }
    else { const mk = L.masks[+which - 1]; if (mk) paths = [{ path: val(mk.path, t), m: M.id() }]; }
    const size = fxv(fx, 'size', t), op = clamp01(fxv(fx, 'opacity', t) / 100), a = clamp01(fxv(fx, 'start', t) / 100), b = clamp01(fxv(fx, 'end', t) / 100), style = fxv(fx, 'style', t);
    const W = buf.width, H = buf.height, x = buf._ctx;
    if (!paths.length || size <= 0) { if (style !== 'on') { x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H); x.restore(); } return; }
    const tmp = LM.acquire(W, H), y = tmp._ctx, bm = bufMat(mat, s, R);
    y.strokeStyle = fxv(fx, 'color', t); y.lineCap = 'round'; y.lineJoin = 'round';
    paths.forEach(({ path, m }) => {
      const T = M.mul(bm, m); y.setTransform(T[0], T[1], T[2], T[3], T[4], T[5]); y.lineWidth = size / (M.scaleOf(m) || 1);
      if (a <= 0 && b >= 1) y.stroke(LM.toPath2D(path));
      else { const p = new Path2D(); LM.trimmed(path, a, b, 0).forEach(pc => { p.moveTo(pc[0][0], pc[0][1]); for (let i = 1; i < pc.length; i++) p.lineTo(pc[i][0], pc[i][1]); }); y.stroke(p); }
    });
    y.setTransform(1, 0, 0, 1, 0, 0);
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
    if (style === 'reveal') { x.globalCompositeOperation = 'destination-in'; x.globalAlpha = 1; x.drawImage(tmp, 0, 0); if (op < 1) { x.globalCompositeOperation = 'destination-in'; x.fillStyle = `rgba(0,0,0,${op})`; x.fillRect(0, 0, W, H); } }
    else { if (style === 'transparent') x.clearRect(0, 0, W, H); x.globalCompositeOperation = 'source-over'; x.globalAlpha = op; x.drawImage(tmp, 0, 0); }
    x.restore(); LM.release(tmp);
  };

  /* ---------- displacement helpers ---------- */
  // 3D value noise in [-1, 1]
  const h3 = (x, y, z) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177); h = Math.imul(h ^ (h >>> 13), 1103515245); return ((h ^ (h >>> 16)) >>> 0) / 4294967295 * 2 - 1; };
  const sm = v => v * v * (3 - 2 * v);
  function vnoise3(x, y, z) {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = sm(x - xi), fy = sm(y - yi), fz = sm(z - zi);
    const l = (a, b, f) => a + (b - a) * f;
    const c = (dx, dy, dz) => h3(xi + dx, yi + dy, zi + dz);
    return l(l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy), l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
  }
  LM.vnoise3 = vnoise3;
  // remap buffer pixels: dispAt(x, y) → [dx, dy] in buffer px (sampled on a grid, bilinear in between); output(x,y) = input(x - dx, y - dy)
  function displace(buf, dispAt, G = 4) {
    LM.pixelOp(buf, (d, W, H) => {
      const gw = Math.ceil(W / G) + 2, gh = Math.ceil(H / G) + 2, gx = new Float32Array(gw * gh), gy = new Float32Array(gw * gh);
      for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) { const v = dispAt(i * G, j * G); gx[j * gw + i] = v[0]; gy[j * gw + i] = v[1]; }
      const src = d.slice();
      for (let y = 0; y < H; y++) {
        const gj = y / G, j0 = gj | 0, fy = gj - j0;
        for (let x = 0; x < W; x++) {
          const gi = x / G, i0 = gi | 0, fx = gi - i0, k = j0 * gw + i0;
          const dx = (gx[k] * (1 - fx) + gx[k + 1] * fx) * (1 - fy) + (gx[k + gw] * (1 - fx) + gx[k + gw + 1] * fx) * fy;
          const dy = (gy[k] * (1 - fx) + gy[k + 1] * fx) * (1 - fy) + (gy[k + gw] * (1 - fx) + gy[k + gw + 1] * fx) * fy;
          const sx = x - dx, sy = y - dy, o = (y * W + x) * 4;
          const x0 = Math.floor(sx), y0 = Math.floor(sy), ax = sx - x0, ay = sy - y0;
          let r = 0, g = 0, b = 0, a = 0;
          for (let q = 0; q < 4; q++) {
            const px = x0 + (q & 1), py = y0 + (q >> 1); if (px < 0 || py < 0 || px >= W || py >= H) continue;
            const w = ((q & 1) ? ax : 1 - ax) * ((q >> 1) ? ay : 1 - ay), p = (py * W + px) * 4, al = src[p + 3] * w;
            r += src[p] * al; g += src[p + 1] * al; b += src[p + 2] * al; a += al;
          }
          if (a > 0.01) { d[o] = r / a; d[o + 1] = g / a; d[o + 2] = b / a; d[o + 3] = a; } else { d[o + 3] = 0; }
        }
      }
    });
  }
  LM.displace = displace;

  /* ---------- Turbulent Displace (fractal noise, attached to the layer) ---------- */
  I.turb = (fx, buf, L, t, comp, s, R, mat) => {
    const amt = fxv(fx, 'amount', t), size = Math.max(2, fxv(fx, 'size', t)), off = fxv(fx, 'offset', t), oct = Math.max(1, Math.min(6, Math.round(fxv(fx, 'complexity', t)))), evo = fxv(fx, 'evolution', t) / 360;
    if (amt <= 0) return;
    const bm = bufMat(mat, s, R), inv = M.inv(bm), mag = amt / 100 * size * 0.5;
    const fbm = (x, y, z) => { let v = 0, a = 1, f = 1, n = 0; for (let o = 0; o < oct; o++) { v += vnoise3(x * f, y * f, z + o * 7.3) * a; n += a; a *= .5; f *= 2; } return v / n; };
    displace(buf, (x, y) => {
      const p = M.apply(inv, x, y), nx = (p[0] - off[0]) / size, ny = (p[1] - off[1]) / size;
      const dlx = fbm(nx, ny, evo) * mag, dly = fbm(nx + 31.7, ny + 17.3, evo + 5.1) * mag;
      return [bm[0] * dlx + bm[2] * dly, bm[1] * dlx + bm[3] * dly];
    });
  };

  /* ---------- Wave Warp ---------- */
  const WAVES = { sine: p => Math.sin(p * Math.PI * 2), square: p => Math.sin(p * Math.PI * 2) >= 0 ? 1 : -1, triangle: p => { const f = p - Math.floor(p); return f < .25 ? f * 4 : f < .75 ? 2 - f * 4 : f * 4 - 4; }, saw: p => { const f = p - Math.floor(p); return f * 2 - 1; } };
  I.wave = (fx, buf, L, t, comp, s, R, mat) => {
    const ht = fxv(fx, 'height', t), wd = Math.max(1, fxv(fx, 'width', t)), dir = fxv(fx, 'direction', t) * Math.PI / 180, sp = fxv(fx, 'speed', t), ph = fxv(fx, 'phase', t) / 360, fn = WAVES[fxv(fx, 'type', t)] || WAVES.sine;
    if (!ht) return;
    const bm = bufMat(mat, s, R), inv = M.inv(bm), dv = [Math.sin(dir), -Math.cos(dir)], pv = [-dv[1], dv[0]];
    displace(buf, (x, y) => {
      const p = M.apply(inv, x, y), along = p[0] * dv[0] + p[1] * dv[1], w = fn(along / wd - sp * t + ph) * ht;
      const lx = pv[0] * w, ly = pv[1] * w; return [bm[0] * lx + bm[2] * ly, bm[1] * lx + bm[3] * ly];
    }, 2);
  };

  /* ---------- Light Rays (radial streaks from a center point) ---------- */
  I.rays = (fx, buf, L, t, comp, s, R, mat) => {
    const inten = Math.max(0, fxv(fx, 'intensity', t) / 100), len = Math.max(0, fxv(fx, 'radius', t) / 100), colorMode = fxv(fx, 'mode', t) === 'color';
    if (inten <= 0 || len <= 0) return;
    const W = buf.width, H = buf.height, bm = bufMat(mat, s, R), c = M.apply(bm, ...fxv(fx, 'center', t));
    const f = 2, w = Math.max(1, Math.round(W / f)), h = Math.max(1, Math.round(H / f));
    const src = LM.acquire(w, h), y = src._ctx; y.drawImage(buf, 0, 0, w, h);
    if (colorMode) { y.globalCompositeOperation = 'source-atop'; y.fillStyle = fxv(fx, 'color', t); y.fillRect(0, 0, w, h); y.globalCompositeOperation = 'source-over'; }
    const rays = LM.acquire(w, h), r = rays._ctx, N = 28, cx = c[0] / f, cy = c[1] / f;
    r.globalCompositeOperation = 'lighter';
    for (let i = 1; i <= N; i++) { const k = 1 + len * i / N; r.setTransform(k, 0, 0, k, cx * (1 - k), cy * (1 - k)); r.globalAlpha = (1 - (i - 1) / N) * 2.2 / N; r.drawImage(src, 0, 0); }
    r.setTransform(1, 0, 0, 1, 0, 0);
    const x = buf._ctx; x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'lighter';
    let left = inten; while (left > 0) { x.globalAlpha = Math.min(1, left); x.drawImage(rays, 0, 0, W, H); left -= 1; }
    x.restore(); LM.release(src); LM.release(rays);
  };
})();
