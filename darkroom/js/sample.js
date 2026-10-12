'use strict';
/* Lumen Darkroom — procedurally generated sample photos (with real EXIF blocks) for the sample catalog */
const Sample = (() => {
  const W = 1800, H = 1200;
  const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const canvas = (w = W, h = H) => { const c = Decode.mkCanvas(w, h); return [c, c.getContext('2d')]; };
  function vgrad(x, y0, y1, stops) { const g = x.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }
  function ridge(r, w, y, amp, rough = .55, seg = 512) {
    let pts = [y + (r() - .5) * amp, y + (r() - .5) * amp], a = amp;
    while (pts.length < seg) { const n = []; for (let i = 0; i < pts.length - 1; i++) n.push(pts[i], (pts[i] + pts[i + 1]) / 2 + (r() - .5) * a); n.push(pts[pts.length - 1]); pts = n; a *= rough; }
    return pts.map((v, i) => [i / (pts.length - 1) * w, v]);
  }
  function fillRidge(x, pts, bottom, fill) { x.beginPath(); x.moveTo(0, bottom); pts.forEach(([px, py]) => x.lineTo(px, py)); x.lineTo(pts[pts.length - 1][0], bottom); x.closePath(); x.fillStyle = fill; x.fill(); }
  function noise(x, w, h, amt, r, chroma = .25) {
    const im = x.getImageData(0, 0, w, h), d = im.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = ((r() + r() + r()) / 1.5 - 1) * amt;
      d[i] += n + (r() - .5) * amt * chroma; d[i + 1] += n + (r() - .5) * amt * chroma; d[i + 2] += n + (r() - .5) * amt * chroma;
    }
    x.putImageData(im, 0, 0);
  }
  function glow(x, cx, cy, r, color) { const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2); }
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

  /* ---------- scenes ---------- */
  function alpine() {
    const [c, x] = canvas(), r = rng(11);
    x.fillStyle = vgrad(x, 0, H * .7, [[0, '#1c2752'], [.35, '#5a4a86'], [.68, '#e98a6a'], [1, '#ffd9a0']]); x.fillRect(0, 0, W, H);
    glow(x, W * .66, H * .6, 520, 'rgba(255,214,150,.75)'); glow(x, W * .66, H * .6, 120, 'rgba(255,248,225,1)');
    for (let i = 0; i < 14; i++) { x.fillStyle = `rgba(255,${180 + r() * 50},${150 + r() * 40},${.08 + r() * .1})`; x.beginPath(); x.ellipse(r() * W, H * (.12 + r() * .35), 160 + r() * 260, 10 + r() * 18, 0, 0, Math.PI * 2); x.fill(); }
    const haze = [255, 200, 170], layers = [[.52, 260, [120, 110, 160]], [.6, 230, [90, 80, 130]], [.7, 200, [60, 58, 100]], [.8, 150, [32, 34, 62]], [.9, 100, [18, 22, 38]]];
    layers.forEach(([y, amp, col], i) => { fillRidge(x, ridge(r, W, H * y, amp, .6), H, rgb(mix(col, haze, .38 - i * .08))); if (i < 3) { x.fillStyle = vgrad(x, H * y - 30, H * y + 120, [[0, 'rgba(255,225,200,0)'], [.5, 'rgba(255,225,205,.35)'], [1, 'rgba(255,225,205,0)']]); x.fillRect(0, H * y - 30, W, 150); } });
    // snow highlights on the second range
    noise(x, W, H, 7, r); return c;
  }
  function coast() {
    const [c, x] = canvas(), r = rng(23), hy = H * .58;
    x.fillStyle = vgrad(x, 0, hy, [[0, '#2a3a6e'], [.45, '#b86a84'], [.8, '#f6a35c'], [1, '#ffd38a']]); x.fillRect(0, 0, W, hy);
    for (let i = 0; i < 26; i++) { x.fillStyle = `rgba(${90 + r() * 60},${50 + r() * 40},${90 + r() * 50},${.25 + r() * .25})`; x.beginPath(); x.ellipse(r() * W, hy * (.15 + r() * .6), 200 + r() * 360, 6 + r() * 16, 0, 0, Math.PI * 2); x.fill(); }
    glow(x, W * .42, hy, 420, 'rgba(255,200,120,.7)'); x.fillStyle = '#fff1c8'; x.beginPath(); x.arc(W * .42, hy - 8, 46, Math.PI, 0); x.fill();
    x.fillStyle = vgrad(x, hy, H, [[0, '#b0607a'], [.25, '#3d3c6c'], [1, '#101a34']]); x.fillRect(0, hy, W, H - hy);
    for (let i = 0; i < 900; i++) { const y = hy + Math.pow(r(), 1.6) * (H - hy), spread = 30 + (y - hy) * .9, px = W * .42 + (r() - .5) * spread * 2; x.fillStyle = `rgba(255,${190 + r() * 50},${120 + r() * 60},${.15 + r() * .5 * (1 - (y - hy) / (H - hy))})`; x.fillRect(px, y, 10 + r() * 50 * (y - hy) / 400, 1.5 + (y - hy) / 260); }
    fillRidge(x, ridge(r, W * .45, H * .86, 120, .6), H, '#0b0f1a'); x.save(); x.translate(W, 0); x.scale(-1, 1); fillRidge(x, ridge(r, W * .3, H * .9, 90, .6), H, '#0b0f1a'); x.restore();
    noise(x, W, H, 6, r); return c;
  }
  function forest() {
    const [c, x] = canvas(), r = rng(37);
    x.fillStyle = vgrad(x, 0, H, [[0, '#c9d2d4'], [.55, '#aab8b4'], [1, '#6f7f74']]); x.fillRect(0, 0, W, H);
    const rows = 6;
    for (let k = 0; k < rows; k++) {
      const t = k / (rows - 1), base = H * (.45 + t * .5), col = mix([170, 184, 180], [20, 38, 30], Math.pow(t, .8));
      const sz = 60 + t * 220;
      for (let i = 0; i < 26 - k * 2; i++) {
        const px = r() * W, h = sz * (.7 + r() * .6), w = h * .34; x.fillStyle = rgb(col);
        x.beginPath(); for (let j = 0; j < 5; j++) { const yy = base - h * j / 5, ww = w * (1 - j / 5.6); x.moveTo(px - ww, yy); x.lineTo(px, yy - h * .35); x.lineTo(px + ww, yy); } x.fill();
        x.fillRect(px - w * .06, base - 4, w * .12, h * .12 + 8);
      }
      x.fillStyle = rgb(col); x.fillRect(0, base, W, H - base);
      x.fillStyle = vgrad(x, base - sz, base + 40, [[0, 'rgba(205,214,214,0)'], [.7, 'rgba(205,214,214,.45)'], [1, 'rgba(205,214,214,.2)']]); x.fillRect(0, base - sz, W, sz + 40);
    }
    glow(x, W * .25, H * .2, 700, 'rgba(255,248,230,.35)');
    noise(x, W, H, 8, r); return c;
  }
  function portrait() {
    const w = 1200, h = 1600; const [c, x] = canvas(w, h), r = rng(53);
    x.fillStyle = vgrad(x, 0, h, [[0, '#26303f'], [.6, '#3e3238'], [1, '#221c20']]); x.fillRect(0, 0, w, h);
    x.filter = 'blur(22px)';
    for (let i = 0; i < 50; i++) { const warm = r() > .35; x.fillStyle = warm ? `rgba(255,${170 + r() * 60},${90 + r() * 60},${.22 + r() * .35})` : `rgba(${120 + r() * 60},${170 + r() * 50},255,${.18 + r() * .3})`; x.beginPath(); x.arc(r() * w, r() * h * .85, 28 + r() * 80, 0, Math.PI * 2); x.fill(); }
    x.filter = 'none';
    const cx = w * .5, fy = h * .42;
    // hair, back layer
    const hg = x.createLinearGradient(cx - 260, 0, cx + 260, 0); hg.addColorStop(0, '#5a3a26'); hg.addColorStop(.5, '#2e1d14'); hg.addColorStop(1, '#1c120c');
    x.fillStyle = hg; x.beginPath(); x.moveTo(cx - 225, fy - 60); x.bezierCurveTo(cx - 260, fy - 330, cx + 260, fy - 330, cx + 225, fy - 60);
    x.bezierCurveTo(cx + 250, fy + 160, cx + 270, fy + 360, cx + 210, fy + 470); x.lineTo(cx - 210, fy + 470); x.bezierCurveTo(cx - 270, fy + 360, cx - 250, fy + 160, cx - 225, fy - 60); x.fill();
    x.lineCap = 'round';
    for (let i = 0; i < 260; i++) {
      const side = r() < .5 ? -1 : 1, t = r(), sx = cx + side * (120 + r() * 100), sy = fy - 260 + t * 120;
      x.strokeStyle = `rgba(${70 + r() * 70},${45 + r() * 40},${25 + r() * 25},${.25 + r() * .35})`; x.lineWidth = .8 + r() * 1.6;
      x.beginPath(); x.moveTo(cx + side * (60 + r() * 120), fy - 245 + r() * 40); x.bezierCurveTo(sx - side * 30, sy, sx + side * 30, fy + 100 + r() * 200, cx + side * (175 + r() * 80), fy + 300 + r() * 170); x.stroke();
    }
    // shoulders / sweater with soft folds
    x.fillStyle = vgrad(x, h * .62, h, [[0, '#3a8a90'], [1, '#174a50']]);
    x.beginPath(); x.moveTo(cx - 500, h); x.bezierCurveTo(cx - 480, h * .76, cx - 280, h * .69, cx - 130, h * .665); x.lineTo(cx + 130, h * .665); x.bezierCurveTo(cx + 280, h * .69, cx + 480, h * .76, cx + 500, h); x.fill();
    x.globalAlpha = .25; x.strokeStyle = '#0c2e33'; x.lineWidth = 10; x.filter = 'blur(6px)';
    for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(cx - 380 + i * 150, h); x.quadraticCurveTo(cx - 300 + i * 120, h * .82, cx - 200 + i * 80, h * .7); x.stroke(); }
    x.globalAlpha = 1; x.filter = 'none';
    // neck with chin shadow
    x.fillStyle = vgrad(x, fy + 150, h * .67, [[0, '#8e5a46'], [.35, '#b67c62'], [1, '#c98f74']]); x.beginPath(); x.moveTo(cx - 62, fy + 150); x.lineTo(cx + 62, fy + 150); x.lineTo(cx + 80, h * .668); x.quadraticCurveTo(cx, h * .69, cx - 80, h * .668); x.fill();
    // face: lit from the upper left
    x.save(); x.beginPath(); x.moveTo(cx, fy - 215); x.bezierCurveTo(cx + 120, fy - 215, cx + 175, fy - 120, cx + 172, fy); x.bezierCurveTo(cx + 168, fy + 130, cx + 90, fy + 228, cx, fy + 236); x.bezierCurveTo(cx - 90, fy + 228, cx - 168, fy + 130, cx - 172, fy); x.bezierCurveTo(cx - 175, fy - 120, cx - 120, fy - 215, cx, fy - 215); x.closePath(); x.clip();
    const fg = x.createRadialGradient(cx - 60, fy - 50, 20, cx - 10, fy, 260); fg.addColorStop(0, '#f4ccb0'); fg.addColorStop(.5, '#dca487'); fg.addColorStop(1, '#a86e57'); x.fillStyle = fg; x.fillRect(cx - 200, fy - 240, 400, 500);
    x.fillStyle = 'rgba(90,45,35,.28)'; x.filter = 'blur(30px)'; x.beginPath(); x.ellipse(cx + 150, fy + 40, 70, 220, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = 'rgba(200,110,100,.16)'; x.filter = 'blur(25px)'; [-1, 1].forEach(s => { x.beginPath(); x.ellipse(cx + s * 95, fy + 55, 45, 30, 0, 0, Math.PI * 2); x.fill(); });
    x.filter = 'blur(2.2px)';
    x.strokeStyle = 'rgba(55,32,22,.75)'; x.lineCap = 'round';
    [-1, 1].forEach(s => { x.lineWidth = 7; x.beginPath(); x.moveTo(cx + s * 28, fy - 58); x.quadraticCurveTo(cx + s * 68, fy - 74, cx + s * 108, fy - 58); x.stroke(); });
    [-1, 1].forEach(s => {
      const ex = cx + s * 66, ey = fy - 18;
      x.fillStyle = 'rgba(120,70,55,.25)'; x.beginPath(); x.ellipse(ex, ey - 4, 42, 22, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(248,240,234,.95)'; x.beginPath(); x.moveTo(ex - 28, ey); x.quadraticCurveTo(ex, ey - 18, ex + 28, ey); x.quadraticCurveTo(ex, ey + 12, ex - 28, ey); x.fill();
      const ig = x.createRadialGradient(ex - 2, ey - 3, 1, ex, ey - 2, 11); ig.addColorStop(0, '#6a4a2a'); ig.addColorStop(.7, '#3b2616'); ig.addColorStop(1, '#1d120a');
      x.fillStyle = ig; x.beginPath(); x.arc(ex, ey - 2, 10.5, 0, Math.PI * 2); x.fill();
      x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.arc(ex - 4, ey - 6, 2.6, 0, Math.PI * 2); x.fill();
      x.strokeStyle = 'rgba(50,28,20,.85)'; x.lineWidth = 3.5; x.beginPath(); x.moveTo(ex - 30, ey + 1); x.quadraticCurveTo(ex, ey - 20, ex + 30, ey - 1); x.stroke();
    });
    x.strokeStyle = 'rgba(120,70,55,.45)'; x.lineWidth = 5; x.beginPath(); x.moveTo(cx + 10, fy - 20); x.quadraticCurveTo(cx + 22, fy + 40, cx + 20, fy + 58); x.stroke();
    x.fillStyle = 'rgba(110,60,45,.45)'; [-1, 1].forEach(s => { x.beginPath(); x.ellipse(cx + s * 15, fy + 66, 9, 5, 0, 0, Math.PI * 2); x.fill(); });
    x.fillStyle = 'rgba(255,235,220,.35)'; x.beginPath(); x.ellipse(cx - 4, fy + 30, 6, 26, 0, 0, Math.PI * 2); x.fill();
    const lg = x.createLinearGradient(0, fy + 98, 0, fy + 135); lg.addColorStop(0, '#a5524d'); lg.addColorStop(1, '#c46e66');
    x.fillStyle = lg; x.beginPath(); x.moveTo(cx - 46, fy + 112); x.quadraticCurveTo(cx - 20, fy + 96, cx, fy + 103); x.quadraticCurveTo(cx + 20, fy + 96, cx + 46, fy + 112); x.quadraticCurveTo(cx, fy + 138, cx - 46, fy + 112); x.fill();
    x.strokeStyle = 'rgba(90,40,35,.6)'; x.lineWidth = 2.5; x.beginPath(); x.moveTo(cx - 44, fy + 112); x.quadraticCurveTo(cx, fy + 116, cx + 44, fy + 112); x.stroke();
    x.filter = 'none'; x.restore();
    // fringe + strands
    x.fillStyle = hg; x.beginPath(); x.moveTo(cx - 205, fy - 10); x.bezierCurveTo(cx - 230, fy - 270, cx + 200, fy - 300, cx + 210, fy - 40);
    x.bezierCurveTo(cx + 170, fy - 150, cx + 60, fy - 150, cx - 40, fy - 120); x.bezierCurveTo(cx - 120, fy - 100, cx - 170, fy - 70, cx - 205, fy - 10); x.fill();
    x.lineCap = 'round';
    for (let i = 0; i < 90; i++) { const t = r(); x.strokeStyle = `rgba(${80 + r() * 60},${50 + r() * 35},${28 + r() * 20},${.3 + r() * .3})`; x.lineWidth = .8 + r() * 1.4; x.beginPath(); x.moveTo(cx - 150 + t * 200, fy - 250 + r() * 20); x.quadraticCurveTo(cx - 60 + t * 220, fy - 190, cx - 200 + t * 400, fy - 120 + (1 - Math.abs(t - .5) * 2) * -10 + r() * 30); x.stroke(); }
    x.globalCompositeOperation = 'screen'; glow(x, cx + 360, fy - 160, 460, 'rgba(255,170,90,.32)'); x.globalCompositeOperation = 'source-over';
    noise(x, w, h, 6, r); return c;
  }
  function dunes() {
    const [c, x] = canvas(), r = rng(71);
    x.fillStyle = vgrad(x, 0, H * .5, [[0, '#5d8fc4'], [1, '#d9e6ee']]); x.fillRect(0, 0, W, H);
    const cols = [[226, 160, 104], [214, 138, 82], [198, 118, 64], [180, 98, 50], [160, 82, 40]];
    cols.forEach((col, i) => {
      const y = H * (.45 + i * .11), pts = ridge(r, W, y, 160 - i * 10, .42, 256);
      fillRidge(x, pts, H, vgrad(x, y - 80, y + 200, [[0, rgb(mix(col, [255, 220, 170], .3))], [1, rgb(mix(col, [90, 40, 20], .35))]]));
      x.save(); x.beginPath(); x.moveTo(0, H); pts.forEach(([px, py]) => x.lineTo(px, py)); x.lineTo(W, H); x.clip();
      for (let k = 0; k < 3; k++) { const sx = r() * W, sw = 200 + r() * 300; x.fillStyle = `rgba(80,35,20,${.18 + r() * .12})`; x.beginPath(); x.moveTo(sx, y - 60); x.quadraticCurveTo(sx + sw * .6, y + 40, sx + sw, y + 240); x.lineTo(sx + sw * 1.4, y + 240); x.quadraticCurveTo(sx + sw * .9, y + 20, sx, y - 60); x.fill(); }
      x.restore();
    });
    noise(x, W, H, 6, r); return c;
  }
  function city() {
    const [c, x] = canvas(), r = rng(89);
    x.fillStyle = vgrad(x, 0, H, [[0, '#070b1c'], [.6, '#1a2148'], [1, '#2a2440']]); x.fillRect(0, 0, W, H);
    for (let i = 0; i < 120; i++) { x.fillStyle = `rgba(255,255,255,${r() * .6})`; x.fillRect(r() * W, r() * H * .4, 1.5, 1.5); }
    for (let layer = 0; layer < 3; layer++) {
      let px = -20; const base = H * (.82 + layer * .06), shade = 18 + layer * 6;
      while (px < W) {
        const bw = 60 + r() * 140, bh = (220 + r() * 480) * (1 - layer * .25);
        x.fillStyle = `rgb(${shade},${shade + 4},${shade + 18})`; x.fillRect(px, base - bh, bw, bh + 300);
        for (let wy = base - bh + 14; wy < base - 10; wy += 18) for (let wx = px + 8; wx < px + bw - 10; wx += 14) if (r() < .32) { const warm = r() > .3; x.fillStyle = warm ? `rgba(255,${200 + r() * 40},${110 + r() * 60},${.55 + r() * .4})` : `rgba(170,210,255,${.4 + r() * .4})`; x.fillRect(wx, wy, 7, 9); }
        px += bw + r() * 12;
      }
    }
    x.filter = 'blur(14px)';
    for (let i = 0; i < 40; i++) { const hue = [[255, 190, 90], [255, 90, 70], [120, 200, 255], [255, 230, 160]][Math.floor(r() * 4)]; x.fillStyle = `rgba(${hue},${.35 + r() * .4})`; x.beginPath(); x.arc(r() * W, H * (.86 + r() * .14), 20 + r() * 50, 0, Math.PI * 2); x.fill(); }
    x.filter = 'none';
    noise(x, W, H, 22, r, .9); return c;
  }
  function lavender() {
    const [c, x] = canvas(), r = rng(97), hy = H * .44;
    x.fillStyle = vgrad(x, 0, hy, [[0, '#3f7cc8'], [1, '#cfe3f3']]); x.fillRect(0, 0, W, hy);
    x.filter = 'blur(10px)'; for (let i = 0; i < 10; i++) { x.fillStyle = 'rgba(255,255,255,.75)'; const cx = r() * W, cy = hy * (.2 + r() * .5); for (let k = 0; k < 6; k++) { x.beginPath(); x.arc(cx + (r() - .5) * 220, cy + (r() - .5) * 40, 40 + r() * 60, 0, Math.PI * 2); x.fill(); } } x.filter = 'none';
    fillRidge(x, ridge(r, W, hy - 20, 30, .6), hy + 10, '#3c5a3a');
    x.fillStyle = '#5a7a3a'; x.fillRect(0, hy, W, H - hy);
    const vx = W * .55;
    for (let i = -40; i <= 40; i++) {
      const bx = vx + i * 110;
      const g = x.createLinearGradient(0, hy, 0, H); g.addColorStop(0, '#8a78c0'); g.addColorStop(1, '#5b2f9a');
      x.fillStyle = g; x.beginPath(); x.moveTo(vx + i * 3, hy); x.lineTo(vx + i * 4.2, hy); x.lineTo(bx + (bx - vx) * 1.2 + 70, H); x.lineTo(bx + (bx - vx) * 1.2 - 20, H); x.fill();
    }
    for (let i = 0; i < 9000; i++) { const y = hy + Math.pow(r(), .7) * (H - hy), s = 1 + (y - hy) / 120; x.fillStyle = `rgba(${150 + r() * 60},${90 + r() * 50},${200 + r() * 55},${.5})`; x.fillRect(r() * W, y, s, s * 2.2); }
    noise(x, W, H, 7, r); return c;
  }
  function winter() {
    const [c, x] = canvas(), r = rng(131), hy = H * .6;
    // deliberately flat, "straight out of camera" look — a good Auto tone candidate
    x.fillStyle = vgrad(x, 0, hy, [[0, '#8fa6bd'], [1, '#c7d2dc']]); x.fillRect(0, 0, W, hy);
    const m = ridge(r, W, H * .4, 260, .55);
    fillRidge(x, m, hy, vgrad(x, H * .25, hy, [[0, '#d9dee4'], [1, '#9eabb9']]));
    x.save(); x.beginPath(); x.moveTo(0, hy); m.forEach(([px, py]) => x.lineTo(px, py)); x.lineTo(W, hy); x.clip();
    for (let i = 0; i < 40; i++) { x.fillStyle = `rgba(110,128,150,${.2 + r() * .2})`; const sx = r() * W; x.beginPath(); x.moveTo(sx, H * .3); x.lineTo(sx + 40 + r() * 80, hy); x.lineTo(sx - 20, hy); x.fill(); }
    x.restore();
    fillRidge(x, ridge(r, W, hy - 10, 30, .5), hy + 4, '#59636e');
    x.fillStyle = vgrad(x, hy, H, [[0, '#a9b8c6'], [1, '#c5d0d8']]); x.fillRect(0, hy, W, H - hy);
    for (let i = 0; i < 160; i++) { x.strokeStyle = `rgba(255,255,255,${.1 + r() * .25})`; x.lineWidth = 1 + r() * 2; const y = hy + r() * (H - hy); x.beginPath(); x.moveTo(r() * W, y); x.lineTo(r() * W, y + (r() - .5) * 8); x.stroke(); }
    noise(x, W, H, 5, r); return c;
  }

  /* ---------- EXIF writer (minimal TIFF/EXIF APP1 so samples carry real camera metadata) ---------- */
  function exifAPP1(e) {
    const enc = new TextEncoder();
    const dt = d => { const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
    const ascii = s => { const b = enc.encode(s); const o = new Uint8Array(b.length + 1); o.set(b); return { type: 2, count: o.length, bytes: o }; };
    const rat = (n, d) => { const b = new Uint8Array(8), v = new DataView(b.buffer); v.setUint32(0, n, true); v.setUint32(4, d, true); return { type: 5, count: 1, bytes: b }; };
    const short = n => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return { type: 3, count: 1, bytes: b }; };
    const long = n => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return { type: 4, count: 1, bytes: b }; };
    const ifd0 = [[0x010F, ascii(e.make)], [0x0110, ascii(e.model)], [0x0112, short(1)], [0x0131, ascii('Lumen Darkroom sample generator')], [0x8769, long(0)]];
    const exif = [[0x829A, rat(1, Math.round(1 / e.shutter))], [0x829D, rat(Math.round(e.f * 10), 10)], [0x8827, short(e.iso)], [0x9003, ascii(dt(e.date))], [0x9004, ascii(dt(e.date))], [0x920A, rat(Math.round(e.focal * 10), 10)], [0xA434, ascii(e.lens)]];
    const size = list => 2 + list.length * 12 + 4 + list.reduce((a, [, v]) => a + (v.bytes.length > 4 ? v.bytes.length + (v.bytes.length & 1) : 0), 0);
    const ifd0Off = 8, exifOff = ifd0Off + size(ifd0), total = exifOff + size(exif);
    const buf = new Uint8Array(total), dv = new DataView(buf.buffer);
    buf.set([0x49, 0x49, 0x2A, 0x00]); dv.setUint32(4, ifd0Off, true);
    ifd0[4][1] = long(exifOff);
    const write = (list, off) => {
      dv.setUint16(off, list.length, true); let data = off + 2 + list.length * 12 + 4;
      list.forEach(([tag, v], i) => {
        const p = off + 2 + i * 12; dv.setUint16(p, tag, true); dv.setUint16(p + 2, v.type, true); dv.setUint32(p + 4, v.count, true);
        if (v.bytes.length <= 4) buf.set(v.bytes, p + 8); else { dv.setUint32(p + 8, data, true); buf.set(v.bytes, data); data += v.bytes.length + (v.bytes.length & 1); }
      });
      dv.setUint32(off + 2 + list.length * 12, 0, true);
    };
    write(ifd0, ifd0Off); write(exif, exifOff);
    const hdr = enc.encode('Exif\0\0'), seg = new Uint8Array(4 + hdr.length + buf.length);
    seg[0] = 0xFF; seg[1] = 0xE1; const len = 2 + hdr.length + buf.length; seg[2] = len >> 8; seg[3] = len & 255;
    seg.set(hdr, 4); seg.set(buf, 4 + hdr.length);
    return seg;
  }
  async function jpegWithExif(canvas, exif, q = .92) {
    const jpg = new Uint8Array(await (await Decode.toBlob(canvas, 'image/jpeg', q)).arrayBuffer());
    const app1 = exifAPP1(exif), out = new Uint8Array(jpg.length + app1.length);
    out.set(jpg.subarray(0, 2)); out.set(app1, 2); out.set(jpg.subarray(2), 2 + app1.length);
    return out.buffer;
  }

  /* ---------- the sample catalog ---------- */
  function specs() {
    const B = name => Model.BUILTIN.find(p => p.name === name);
    const withPreset = (name, tweak) => { const s = Model.presetApply(Model.defaults(), B(name)); tweak?.(s); return s; };
    const cam = { make: 'Lumen Optics', model: 'LX-1 Mark II' }, cam2 = { make: 'Lumen Optics', model: 'LX-R' };
    const d = (m, day, h) => new Date(2026, m - 1, day, h, 12 + day, 30);
    return [
      { file: 'DSC_0412.jpg', make: alpine, exif: { ...cam, lens: 'Lumen 24-70mm F2.8', iso: 100, shutter: 1 / 125, f: 8, focal: 35, date: d(6, 14, 5) }, meta: { rating: 5, flag: 1, label: 'green', keywords: ['landscape', 'mountains', 'sunrise'], historyLabel: 'Preset: Punchy landscape', settings: withPreset('Punchy landscape', s => { s.exposure = .15; s.wb.temp = 6; s.vignette.amount = -12;
        const sky = Model.newMask('linear'); sky.name = 'Sky'; sky.lin = { x0: .5, y0: 0, x1: .5, y1: .46 }; Object.assign(sky.adj, { exposure: -.3, dehaze: 18, saturation: 15, temp: -8 });
        const sun = Model.newMask('radial'); sun.name = 'Sun glow'; sun.rad = { cx: .66, cy: .6, rx: .2, ry: .13, angle: 0, feather: 85 }; Object.assign(sun.adj, { exposure: .35, temp: 22, clarity: -10 });
        s.masks = [sky, sun]; }) } },
      { file: 'DSC_0533.jpg', make: coast, exif: { ...cam, lens: 'Lumen 24-70mm F2.8', iso: 200, shutter: 1 / 250, f: 11, focal: 50, date: d(7, 3, 20) }, meta: { rating: 4, label: 'yellow', keywords: ['sea', 'sunset', 'travel'], historyLabel: 'Preset: Warm sunset', settings: withPreset('Warm sunset', s => { s.crop = { x: 0, y: .06, w: 1, h: .84, angle: 0, rot: 0, flipH: false, flipV: false, aspect: 'free' }; }) } },
      { file: 'DSC_0610.jpg', make: forest, exif: { ...cam2, lens: 'Lumen 70-200mm F4', iso: 400, shutter: 1 / 60, f: 5.6, focal: 135, date: d(9, 22, 7) }, meta: { rating: 3, label: 'blue', keywords: ['forest', 'fog', 'moody'], historyLabel: 'Dehaze & mood', settings: withPreset('Moody', s => { s.dehaze = 38; s.clarity = 18; s.exposure = -.1; }) } },
      { file: 'PORTRAIT_0087.jpg', make: portrait, exif: { ...cam, lens: 'Lumen 85mm F1.4', iso: 320, shutter: 1 / 200, f: 1.8, focal: 85, date: d(5, 9, 18) }, meta: { rating: 5, flag: 1, label: 'red', keywords: ['portrait', 'people', 'bokeh'], historyLabel: 'Portrait look', settings: (() => { const s = Model.defaults(); s.exposure = .2; s.shadows = 15; s.highlights = -10; s.texture = -12; s.vibrance = 12; s.grade.hi = { h: 38, s: 18, l: 0 }; s.grade.sh = { h: 215, s: 14, l: 0 }; s.vignette = { amount: -22, mid: 45, round: 20, feather: 70 }; s.hsl.sat[1] = -8; s.hsl.lum[1] = 8;
        const face = Model.newMask('radial'); face.name = 'Face'; face.rad = { cx: .5, cy: .42, rx: .13, ry: .16, angle: 0, feather: 75 }; Object.assign(face.adj, { exposure: .25, clarity: -12, shadows: 15 }); s.masks = [face]; return s; })() } },
      { file: 'DSC_0701.jpg', make: dunes, exif: { ...cam2, lens: 'Lumen 16-35mm F4', iso: 100, shutter: 1 / 500, f: 9, focal: 24, date: d(3, 18, 16) }, meta: { rating: 2, keywords: ['desert', 'travel'] } },
      { file: 'DSC_0844.jpg', make: city, exif: { ...cam, lens: 'Lumen 35mm F1.8', iso: 6400, shutter: 1 / 30, f: 1.8, focal: 35, date: d(11, 2, 22) }, meta: { rating: 3, label: 'purple', keywords: ['city', 'night', 'travel'], historyLabel: 'Night noise reduction', settings: (() => { const s = Model.defaults(); s.nr = { lum: 45, color: 50 }; s.contrast = 15; s.vibrance = 18; s.blacks = -10; s.wb.temp = -8; return s; })() } },
      { file: 'DSC_0912.jpg', make: lavender, exif: { ...cam2, lens: 'Lumen 24-70mm F2.8', iso: 100, shutter: 1 / 320, f: 8, focal: 28, date: d(7, 11, 10) }, meta: { rating: 0, keywords: ['flowers', 'summer', 'travel'] } },
      { file: 'DSC_1003.jpg', make: winter, exif: { ...cam, lens: 'Lumen 16-35mm F4', iso: 100, shutter: 1 / 800, f: 10, focal: 18, date: d(1, 27, 12) }, meta: { rating: 1, flag: -1, keywords: ['winter', 'lake', 'mountains'] } }
    ];
  }

  async function open() {
    if (Cat.photos.size && !await Aero.confirm('Open Sample Catalog', `Add 8 generated sample photos to your catalog (${Cat.photos.size} photos)?`, 'Add samples')) return;
    const list = specs(), files = [], metas = [];
    for (let i = 0; i < list.length; i++) {
      Aero.busy(`Generating sample photos… ${i + 1} / ${list.length}`); await new Promise(r => setTimeout(r, 0));
      const s = list[i]; files.push({ name: s.file, data: await jpegWithExif(s.make(), s.exif) }); metas.push(s.meta);
    }
    const added = await Cat.importFiles(files, { meta: metas, quiet: true });
    if (!added.length) return;
    const byName = n => added.find(p => p.name === n)?.id;
    // a black & white virtual copy of the mountains
    const [vc] = await Cat.virtualCopy([byName('DSC_0412.jpg')]);
    if (vc) { const p = Cat.photos.get(vc); Cat.setSettings(p, Model.presetApply(p.settings, Model.BUILTIN.find(b => b.name === 'B&W high contrast')), 'Preset: B&W high contrast'); p.rating = 4; DB.savePhoto(p); }
    Cat.newCollection('Portfolio', [byName('DSC_0412.jpg'), byName('PORTRAIT_0087.jpg'), byName('DSC_0533.jpg'), vc].filter(Boolean));
    Cat.newCollection('Travel 2026', ['DSC_0533.jpg', 'DSC_0701.jpg', 'DSC_0844.jpg', 'DSC_0912.jpg'].map(byName).filter(Boolean));
    S.lastImport = added[0].importId; S.source = { type: 'all' }; S.sort = { key: 'date', dir: 1 }; $('#sort').value = 'date';
    S.sel = new Set([byName('DSC_0412.jpg')]); S.active = byName('DSC_0412.jpg');
    if (S.module !== 'library') setModule('library');
    refreshList(false); renderLeft();
    Aero.setDoc('Sample Catalog', DB.isPending());
    Aero.toast('Sample catalog ready — double-click a photo, or press D to develop it');
  }
  return { open, exifAPP1, jpegWithExif, scenes: { alpine, coast, forest, portrait, dunes, city, lavender, winter } };
})();
