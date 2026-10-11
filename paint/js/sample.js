'use strict';
/* Open Sample: “Lakeside Evening” — painted procedurally with Lumen Paint's own brush engine:
   pencil sketch → watercolor sky / mountains / lake / hills (real wet simulation) → ink linework →
   crayon grass → oil sun, shimmer and flowers. Every stroke goes through the same engine as the user's. */
async function openSample(initial) {
  if (!initial && !(await confirmDiscard())) return;
  // painted live in front of the user; input is blocked meanwhile
  const blk = el('div', 'aero-modal lp-block', '<div class="aero-pill lp-pill"><div class="aero-spin"></div><span>Painting the sample with Lumen Paint’s own brushes…</span></div>');
  document.body.appendChild(blk);
  const t0 = performance.now();
  try { await buildSample(); }
  catch (e) { console.error(e); blk.remove(); Aero.alert('Sample failed', String(e.message || e)); return; }
  blk.remove();
  window.__sampleMs = Math.round(performance.now() - t0);
}
async function buildSample() {
  const W = 2400, H = 1600, T0 = performance.now(), mark = n => { (window.__sampleT = window.__sampleT || {})[n] = Math.round(performance.now() - T0); };
  installDoc(newDoc(W, H, 'Lakeside Evening')); fitView(true);
  doc.paper = 'cold'; doc.paperScale = 1; layerSeq = 1; tlReset();
  const rnd = mulberry32(20261010), nz = makeValueNoise(77, 256), R1 = (a, b) => a + (b - a) * rnd();
  const paper = new Layer('fill', 'Paper', W, H); paper.color = [0.985, 0.972, 0.947];
  const sketch = new Layer('pixel', 'Pencil sketch', W, H); sketch.blend = 'multiply'; sketch.opacity = 0.55;
  const sky = new Layer('pixel', 'Sky — watercolor', W, H);
  const mts = new Layer('pixel', 'Mountains — watercolor', W, H);
  const land = new Layer('pixel', 'Lake & hills — watercolor', W, H);
  const ink = new Layer('pixel', 'Ink linework', W, H);
  const grass = new Layer('pixel', 'Grass — crayon', W, H); grass.opacity = 0.9;
  const oil = new Layer('pixel', 'Oil highlights', W, H);
  const treesL = new Layer('pixel', 'Trees — watercolor', W, H);
  const gw = new Layer('group', 'Watercolor', W, H); gw.children = [sky, mts, land, treesL];
  doc.root = [paper, sketch, gw, ink, grass, oil]; doc.active = oil;
  const B = id => brushById(id);
  const P = (L, id, col, pts, over = {}) => paintPath(pts, { ...B(id), ...over }, typeof col === 'string' ? hexRgb(col) : col, { layer: L });
  const ticks = (L, n) => { const s = wetSims.get(L); if (s) for (let i = 0; i < n; i++) s.tick(); };
  const dry = (L, ms = 900) => { const s = wetSims.get(L); if (s) { s.painting = false; s.evap = 0.02; s.finish(ms); } };
  const frame = async () => { try { if (TL.on && TL.supported) tlGrab(); } catch (e) { } refreshLayersSoon(); await nextFrame(); };
  const line = (x0, y0, x1, y1, n = 24, pf = t => 1) => { const a = []; for (let i = 0; i <= n; i++) { const t = i / n; a.push({ x: lerp(x0, x1, t), y: lerp(y0, y1, t), p: pf(t) }); } return a; };
  const taper = t => Math.pow(Math.sin(Math.PI * clamp(t, 0.02, 0.98)), 0.6);
  const ridge = (seed, base, amp, sc) => x => base - amp * (fbm(nz, x / sc + seed, seed * 3.1, 4) - 0.35) * 2.2;
  const farR = ridge(3, 690, 150, 520), nearR = ridge(9, 790, 120, 380), hillL = x => 1030 + 160 * Math.pow(x / 1100, 1.6) + 30 * Math.sin(x / 140), hillR = x => 1120 - 180 * Math.pow((x - 1500) / 900, 1.3) * (x > 1500 ? 1 : 0) + 25 * Math.sin(x / 120);
  const lakeTop = 860;
  const sampleRidge = (f, x0, x1, step = 30) => { const a = []; for (let x = x0; x <= x1; x += step) a.push({ x, y: f(x), p: 0.55 + 0.45 * fbm(nz, x / 90, 5, 2) }); return a; };
  const maskOf = draw => { const m = maskFromPath(draw); return m; };
  const withSel = (m, fn) => { doc.sel = m; doc.selV++; doc.selBox = selBounds(m); try { fn(); } finally { doc.sel = null; doc.selV++; doc.selBox = null; } };

  mark('setup');
  /* 1. pencil sketch */
  doc.active = sketch;
  P(sketch, 'pencil-hb', '#55595f', line(0, lakeTop, W, lakeTop, 40, () => 0.5), { size: 4 });
  for (const f of [farR, nearR]) P(sketch, 'pencil-hb', '#55595f', sampleRidge(f, 0, W, 40).map(p => ({ ...p, y: p.y + R1(-6, 6), p: 0.45 })), { size: 4 });
  for (let i = 0; i < 9; i++) { const x = 140 + i * 95 + R1(-30, 30), b = hillL(x) + 10; P(sketch, 'pencil-hb', '#55595f', line(x, b, x + R1(-8, 8), b - R1(220, 340), 12, () => 0.4), { size: 3 }); }
  P(sketch, 'pencil-6b', '#4a4d52', line(1450, 1010, 1640, 1010, 10, taper), { size: 7 });
  mark('sketchStrokes');
  await frame();

  mark('sketch');
  /* 2. watercolor sky: graded wash, wet-on-wet */
  doc.active = sky;
  const skyCols = ['#2c63ad', '#3a77bf', '#4f8dcc', '#6aa3d6', '#8db9df', '#b9cfe0', '#f0c8a8', '#f4b48c'];
  // clouds are left as untouched paper (negative painting): the wash goes around soft cloud shapes
  const clouds = [[520, 250, 1], [1020, 165, 0.75], [1900, 285, 1.1], [1390, 405, 0.6]];
  const cloudPuffs = []; for (const [cx, cy, s] of clouds) for (let k = 0; k < 7; k++) cloudPuffs.push([cx + R1(-150, 150) * s, cy + R1(-18, 22) * s - Math.abs(k - 3) * 4 * s, R1(45, 75) * s, R1(26, 40) * s]);
  const skyM = maskOf(x => {
    x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'destination-out';
    for (const [px, py, rx, ry] of cloudPuffs) { x.save(); x.translate(px, py); x.scale(1, ry / rx); const g = x.createRadialGradient(0, 0, rx * 0.55, 0, 0, rx * 1.15); g.addColorStop(0, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.beginPath(); x.arc(0, 0, rx * 1.15, 0, 7); x.fill(); x.restore(); }
  });
  mark('skyMask');
  withSel(skyM, () => {
    for (let i = 0; i < 9; i++) {
      const y = 50 + i * 82, c = hexRgb(skyCols[Math.min(skyCols.length - 1, i)]);
      const pts = []; for (let x = -80; x <= W + 80; x += 60) pts.push({ x, y: y + Math.sin(x / 260 + i) * 16, p: 0.8 + 0.2 * Math.sin(x / 300) });
      P(sky, 'wc-wash', c, i % 2 ? pts.reverse() : pts, { size: 230, pigment: 0.3 + (i < 3 ? 0.08 : 0) });
      ticks(sky, 3);
    }
  });
  mark('skyWash'); ticks(sky, 10); await frame(); mark('skyTick');
  // soft lavender shadows on the cloud bellies, dropped into the damp sky
  for (const [cx, cy, s] of clouds) {
    const pts = []; for (let x = -150 * s; x <= 150 * s; x += 20) pts.push({ x: cx + x, y: cy + 26 * s + Math.sin(x / 50) * 5 * s, p: 0.7 });
    P(sky, 'wc-bloom', '#b0a3c8', pts, { size: 46 * s, pigment: 0.12 });
  }
  mark('skyBlooms'); ticks(sky, 18); mark('skyTick2'); dry(sky); mark('skyDry'); await frame();

  mark('sky');
  /* 3. mountains: two ranges, crisp ridge from a selection, soft wet bottoms */
  doc.active = mts;
  const range = (f, base, cols, size) => {
    const m = maskOf(x => { x.beginPath(); x.moveTo(0, H); for (let X = 0; X <= W; X += 8) x.lineTo(X, f(X)); x.lineTo(W, base); x.lineTo(0, base); x.closePath(); x.fill(); });
    withSel(m, () => {
      let top = 1e9; for (let X = 0; X <= W; X += 20) top = Math.min(top, f(X));
      for (let y = top - 20, i = 0; y < base + 40; y += 70, i++) {
        const pts = []; for (let x = -60; x <= W + 60; x += 55) pts.push({ x, y: y + R1(-12, 12), p: 0.85 });
        P(mts, 'wc-wash', cols[Math.min(cols.length - 1, i)], i % 2 ? pts.reverse() : pts, { size: size, pigment: 0.42 });
        ticks(mts, 3);
      }
    });
  };
  range(farR, lakeTop + 10, ['#7d86bd', '#8a93c4', '#9aa3cc', '#a9b2d2'], 170);
  ticks(mts, 12); dry(mts); await frame();
  range(nearR, lakeTop + 10, ['#4f6f9b', '#5b7ea6', '#6d8fb0', '#7f9fba'], 150);
  ticks(mts, 15); dry(mts); await frame();

  mark('mts');
  /* 4. lake + reflections + hills */
  doc.active = land;
  const lakeM = maskOf(x => x.fillRect(0, lakeTop, W, 400));
  withSel(lakeM, () => {
    const lc = ['#9fbfdc', '#86afd6', '#6f9fcf', '#5b8fc4', '#4c80b8'];
    for (let i = 0; i < 6; i++) { const y = lakeTop + 20 + i * 62, pts = []; for (let x = -60; x <= W + 60; x += 55) pts.push({ x, y: y + R1(-5, 5), p: 0.8 }); P(land, 'wc-wash', lc[Math.min(4, i)], i % 2 ? pts.reverse() : pts, { size: 150, pigment: 0.34 }); ticks(land, 2); }
    // reflections: broken horizontal streaks of the mountain colour near the far shore
    for (let k = 0; k < 46; k++) { const y = lakeTop + 8 + Math.pow(rnd(), 1.6) * 170, x = R1(-40, W), w = R1(60, 240); P(land, 'wc-round', k % 3 ? '#5f7ca6' : '#7088b4', line(x, y, x + w, y + R1(-3, 3), 8, taper), { size: R1(14, 30), pigment: 0.3, water: 0.6 }); }
    ticks(land, 4);
  });
  ticks(land, 12); dry(land); await frame();
  // hills left and right with wet-in-wet greens
  const hillM = maskOf(x => { x.beginPath(); x.moveTo(0, H); for (let X = 0; X <= 1300; X += 10) x.lineTo(X, hillL(X)); x.lineTo(1328, 1250); x.lineTo(1328, H); x.closePath(); x.fill(); x.beginPath(); x.moveTo(1322, H); x.lineTo(1322, 1250); for (let X = 1350; X <= W; X += 10) x.lineTo(X, X < 1500 ? 1120 + (1500 - X) * 0.9 : hillR(X)); x.lineTo(W, H); x.closePath(); x.fill(); });
  withSel(hillM, () => {
    const hc = ['#9cbf62', '#7ea950', '#669545', '#4f803c', '#3d6b33', '#2f5a2c', '#2a4d29'];
    for (let i = 0; i < 9; i++) { const y = 980 + i * 75, pts = []; for (let x = -60; x <= W + 60; x += 50) pts.push({ x, y: y + Math.sin(x / 180 + i) * 25, p: 0.85 }); P(land, 'wc-wash', hc[Math.min(hc.length - 1, i)], i % 2 ? pts.reverse() : pts, { size: 170, pigment: 0.45 }); ticks(land, 3); }
    ticks(land, 6);
  });
  ticks(land, 15); dry(land); await frame();
  // second glaze once dry: deeper greens in the foreground for depth
  withSel(hillM, () => {
    for (let i = 0; i < 3; i++) { const y = 1400 + i * 85, pts = []; for (let x = -60; x <= W + 60; x += 60) pts.push({ x, y: y + Math.sin(x / 210 + i) * 30, p: 0.9 }); P(land, 'wc-wash', ['#4a7a3c', '#33602f', '#284d27'][i], i % 2 ? pts.reverse() : pts, { size: 180, pigment: 0.3 }); ticks(land, 3); }
  });
  ticks(land, 12); dry(land); await frame();

  // tree bodies: dark green wet washes zig-zagged into each pine silhouette
  doc.active = treesL;
  const trees = [];
  for (let i = 0; i < 9; i++) { const x = 140 + i * 95 + R1(-20, 20); trees.push([x, hillL(x) + 30, R1(230, 330)]); }
  for (let i = 0; i < 5; i++) { const x = 1880 + i * 105 + R1(-15, 15); trees.push([x, hillR(x) + 40, R1(170, 260)]); }
  for (const [x, b, h] of trees) {
    const pts = [], n = Math.round(h / 14);
    for (let i = 0; i <= n; i++) { const t = i / n, y = b - h * t, w = (1 - t) * h * 0.27 + 4; pts.push({ x: x + (i % 2 ? w : -w), y, p: 0.9 }); }
    P(treesL, 'wc-round', rnd() < 0.5 ? '#2f4f3f' : '#3c5c3a', pts, { size: 30, pigment: 0.62, water: 0.75 });
  }
  ticks(treesL, 14); dry(treesL); await frame();
  mark('land');
  /* 5. ink linework */
  doc.active = ink;
  const inkC = '#1d2433';
  P(ink, 'ink-pen', inkC, sampleRidge(nearR, 0, W, 24).map(p => ({ ...p, p: 0.35 + 0.5 * p.p })), { size: 6, smoothing: 0 });
  P(ink, 'ink-pen', inkC, sampleRidge(farR, 0, W, 30).map(p => ({ ...p, p: 0.15 + 0.3 * p.p })), { size: 4, smoothing: 0 });
  P(ink, 'ink-pen', inkC, sampleRidge(hillL, 0, 1300, 26).map(p => ({ ...p, p: 0.5 + 0.4 * p.p })), { size: 7, smoothing: 0 });
  await frame();
  // pine trees
  const pine = (x, base, h) => {
    P(ink, 'ink-pen', inkC, line(x, base, x + R1(-3, 3), base - h, 14, t => 0.8 - t * 0.6), { size: 6, smoothing: 0 });
    const n = Math.round(h / 21);
    for (let i = 1; i < n; i++) {
      const y = base - h * (i / n) + R1(-4, 4), w = ((1 - i / n) * h * 0.3 + 8) * R1(0.75, 1.2);
      for (const sd of [-1, 1]) {
        if (rnd() < 0.12) continue;
        const droop = R1(8, 20) * (1 - i / n * 0.5);
        P(ink, 'brush-pen', inkC, [{ x: x + sd * 2, y: y - 4, p: 0.8 }, { x: x + sd * w * 0.45, y: y + droop * 0.2, p: 0.6 }, { x: x + sd * w * 0.8, y: y + droop * 0.7, p: 0.35 }, { x: x + sd * w, y: y + droop, p: 0.04 }], { size: 9, smoothing: 0 });
      }
    }
  };
  for (const [x, b, h] of trees) { pine(x, b, h); }
  // boat
  P(ink, 'ink-pen', inkC, [{ x: 1440, y: 1000, p: 0.3 }, { x: 1480, y: 1022, p: 0.8 }, { x: 1600, y: 1022, p: 0.8 }, { x: 1650, y: 998, p: 0.3 }], { size: 6, smoothing: 0 });
  P(ink, 'tech-pen', inkC, line(1545, 1018, 1545, 860, 10), { size: 4 });
  P(ink, 'ink-pen', inkC, [{ x: 1548, y: 870, p: 0.3 }, { x: 1610, y: 985, p: 0.8 }, { x: 1552, y: 985, p: 0.6 }], { size: 4, smoothing: 0 });
  // birds
  for (const [bx, by, s] of [[700, 300, 1], [760, 340, 0.8], [640, 350, 0.7], [1180, 250, 0.6], [1240, 280, 0.5]]) {
    P(ink, 'ink-pen', inkC, [{ x: bx - 30 * s, y: by - 8 * s, p: 0.1 }, { x: bx - 14 * s, y: by - 14 * s, p: 0.6 }, { x: bx, y: by, p: 0.9 }, { x: bx + 14 * s, y: by - 15 * s, p: 0.6 }, { x: bx + 32 * s, y: by - 6 * s, p: 0.1 }], { size: 6, smoothing: 0 });
  }
  await frame();

  mark('ink');
  /* 6. crayon grass texture on the foreground */
  doc.active = grass;
  for (let k = 0; k < 160; k++) {
    const x = R1(0, W), base = Math.max(x < 1300 ? hillL(x) : hillR(x), 1150) + R1(60, 480); if (base > H + 20) continue;
    const h = R1(30, 90), lean = R1(-25, 25), c = ['#2f5a2c', '#3f6f33', '#6b8f3a', '#8aa64a'][k % 4];
    P(grass, 'crayon', c, line(x, base, x + lean, base - h, 8, t => 1 - t * 0.7), { size: R1(8, 14) });
  }
  await frame();

  mark('grass');
  /* 7. oil: sun, glow, lake shimmer, flowers */
  doc.active = oil;
  const sx = 1640, sy = 560;
  // warm glow (airbrush) then a thick oil sun
  P(oil, 'airbrush', '#ffd9a0', [{ x: sx - 60, y: sy, p: 1 }, { x: sx + 60, y: sy, p: 1 }, { x: sx, y: sy + 20, p: 1 }], { size: 420, flow: 0.07 });
  for (let r = 54; r > 0; r -= 13) { const pts = []; for (let a = 0; a <= Math.PI * 2 + 0.4; a += 0.3) pts.push({ x: sx + Math.cos(a) * r, y: sy + Math.sin(a) * r, p: 0.9 }); P(oil, 'oil-round', r > 30 ? '#ffd27a' : '#fff3cf', pts, { size: 30, impasto: 0.06, mix: 0.15 }); }
  // shimmer on the water: short broken strokes, widest just under the sun
  for (let i = 0; i < 34; i++) {
    const f = i / 34, y = lakeTop + 14 + f * 300 + R1(-4, 4), spread = 30 + f * 120, x = sx + R1(-spread, spread), w = R1(18, 70) * (1 - f * 0.5);
    P(oil, 'oil-round', i % 4 ? '#ffe7b0' : '#fffaf0', line(x - w / 2, y, x + w / 2, y + R1(-2, 2), 6, taper), { size: R1(6, 12), load: 0.9, impasto: 0.05 });
  }
  await frame();
  // flowers
  for (let k = 0; k < 70; k++) {
    const x = R1(30, W - 30), y = R1(1380, 1580), c = ['#d9483b', '#f0a030', '#fff4e0', '#e86a8a'][k % 4], r = R1(6, 12);
    const pts = []; for (let a = 0; a < Math.PI * 2; a += 0.9) pts.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r * 0.8, p: 0.8 });
    P(oil, 'oil-round', c, pts, { size: R1(14, 22) });
  }
  P(oil, 'knife', '#fff6dc', line(1460, 1012, 1630, 1012, 8, taper), { size: 18 });
  await frame();
  mark('oil');
  // done
  doc.active = oil;
  guides.sym = 'off';
  finishDocLoad('Open Sample');
  await frame();
}
