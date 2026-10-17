// Lumen Flow — 2D incompressible CFD you can watch, in the spirit of Ansys Fluent (for learning, not certification).
(function () {
  const FS = window.FlowSolver, FC = window.FlowCases, $ = id => document.getElementById(id), esc = s => Aero.esc(String(s ?? ''));
  const A = window.FlowApp = { cfg: null, f: null, running: false, hist: [], chartTab: 'forces', tool: null, probe: null, docName: 'Untitled' };
  const fmt = (v, d = 3) => !isFinite(v) ? '—' : Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : (+v.toFixed(d)).toString();

  // ---------- colour maps ----------
  const lerpStops = stops => t => { t = Math.max(0, Math.min(1, t)); const n = stops.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i, a = stops[i], b = stops[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
  const VIRIDIS = lerpStops([[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37]]);
  const COOLWARM = lerpStops([[59, 76, 192], [98, 130, 234], [141, 176, 254], [184, 208, 249], [221, 221, 221], [245, 196, 173], [244, 154, 123], [222, 96, 77], [180, 4, 38]]);
  const DYE = lerpStops([[18, 24, 34], [40, 70, 120], [240, 240, 255]]);

  // ---------- setup ----------
  function fluidProps(c) { const fl = FC.FLUIDS[c.fluid] || FC.FLUIDS.custom; return { nu: c.fluid === 'custom' ? c.nu : fl.nu, rho: c.fluid === 'custom' ? c.rho : fl.rho, Pr: c.fluid === 'custom' ? (c.Pr || 1) : fl.Pr, cp: c.fluid === 'custom' ? (c.cp || 1000) : fl.cp }; }
  function build() {
    const c = A.cfg, { nu, rho, Pr, cp } = fluidProps(c), ny = Math.max(8, Math.round(c.nx * c.Ly / c.Lx)), H = c.heat && c.heat.on ? c.heat : null;
    const side = (t, k) => ({ type: t, u: t === 'inlet' || t === 'moving' ? c.U : 0, v: 0, T: H && H.sideT && H.sideT[k] != null && H.sideT[k] !== '' ? +H.sideT[k] : null });
    A.f = new FS.Flow({ nx: c.nx, ny, Lx: c.Lx, Ly: c.Ly, nu, rho, sides: { left: side(c.sides.left, 'left'), right: side(c.sides.right, 'right'), top: side(c.sides.top, 'top'), bottom: side(c.sides.bottom, 'bottom') }, heat: H ? { Pr, cp, Tin: +H.Tin, Tbody: +H.Tbody } : null });
    if (c.painted) { const s = c.painted; A.f.setObstacles((x, y) => { const i = Math.min(c.nx, Math.max(1, Math.floor(x / A.f.dx) + 1)), j = Math.min(ny, Math.max(1, Math.floor(y / A.f.dy) + 1)); return s[(j - 1) * c.nx + (i - 1)] === 1; }); }
    else A.f.setObstacles(FC.obstacleFn(c.obstacle, FS));
    // start the interior at the inflow speed so the first seconds aren't spent accelerating
    if (c.sides.left === 'inlet') for (let j = 1; j <= ny; j++) for (let i = 0; i <= c.nx; i++) { const k = j * A.f.W + i; if (!A.f.solid[k] && !A.f.solid[k + 1]) A.f.u[k] = c.U; }
    // a small one-sided cross-flow nudge behind bluff bodies: real flows are never perfectly symmetric, and without it
    // the wake can sit symmetric for a very long time before shedding starts
    const o = c.obstacle; if (o && !c.painted && o.type !== 'rect') for (let j = 1; j < ny; j++) for (let i = 1; i <= c.nx; i++) {
      const x = (i - 0.5) * A.f.dx, y = j * A.f.dy, k = j * A.f.W + i; if (A.f.solid[k] || A.f.solid[k + A.f.W]) continue;
      const dxo = (x - o.x) / o.size, dyo = (y - o.y) / o.size; if (dxo > 0.5 && dxo < 4) A.f.v[k] = 0.15 * c.U * Math.exp(-dyo * dyo) * Math.exp(-((dxo - 1.5) ** 2));
    }
    A.hist = []; A.shed = []; renderResults(); draw();
  }
  function loadCase(id) {
    const base = FC.CASES[id]; A.cfg = JSON.parse(JSON.stringify(base)); A.cfg.id = id; A.docName = base.name;
    $('field').value = base.field || 'speed'; setRun(false); renderSetup(); build(); Aero.setDoc(A.docName, false);
  }
  function renderSetup() {
    const c = A.cfg, { nu } = fluidProps(c), Re = c.U * c.ref / nu, ny = Math.round(c.nx * c.Ly / c.Lx), cellRe = c.U * (c.Lx / c.nx) / nu;
    const sideSel = k => `<select data-k="sides.${k}">${['inlet', 'outlet', 'wall', 'slip', 'moving'].map(t => `<option ${c.sides[k] === t ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    const o = c.obstacle;
    $('setup').innerHTML = `<div class="pform">
      <span class="note">${esc(c.note || '')}</span>
      <h4>Domain</h4><label>Length (m)</label><input data-k="Lx" type="number" step="any" value="${c.Lx}"><label>Height (m)</label><input data-k="Ly" type="number" step="any" value="${c.Ly}">
      <label>Grid cells</label><select data-k="nx">${[40, 64, 80, 120, 160, 200, 220, 250, 300, 400].map(n => `<option ${n === c.nx ? 'selected' : ''} value="${n}">${n} × ${Math.round(n * c.Ly / c.Lx)}</option>`).join('')}</select>
      <h4>Fluid &amp; inflow</h4><label>Fluid</label><select data-k="fluid">${Object.entries(FC.FLUIDS).map(([k, f]) => `<option value="${k}" ${c.fluid === k ? 'selected' : ''}>${f.name}</option>`).join('')}</select>
      ${c.fluid === 'custom' ? `<label>ν (m²/s)</label><input data-k="nu" type="number" step="any" value="${c.nu}"><label>ρ (kg/m³)</label><input data-k="rho" type="number" step="any" value="${c.rho}">` : ''}
      <label>Velocity (m/s)</label><input data-k="U" type="number" step="any" value="${c.U}">
      <label>Reynolds</label><span><b>${fmt(Re, 1)}</b> <span class="dim">(based on ${c.ref} m)</span></span>
      ${cellRe > 20 ? `<span class="note warn">Cell Reynolds number ${fmt(cellRe, 1)} is high: use more cells, a slower flow or a thicker fluid for trustworthy results.</span>` : ''}
      <h4>Boundaries</h4><label>Left</label>${sideSel('left')}<label>Right</label>${sideSel('right')}<label>Top</label>${sideSel('top')}<label>Bottom</label>${sideSel('bottom')}
      ${o && !c.painted ? `<h4>Obstacle</h4><label>Shape</label><select data-k="obstacle.type">${['circle', 'square', 'plate', 'naca', 'rect'].map(t => `<option ${o.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        ${o.type === 'naca' ? `<label>NACA code</label><input data-k="obstacle.code" value="${esc(o.code || '0012')}">` : ''}
        ${o.type === 'rect' ? `<label>x, y (m)</label><span style="display:flex;gap:4px"><input data-k="obstacle.x" type="number" step="any" value="${o.x}"><input data-k="obstacle.y" type="number" step="any" value="${o.y}"></span><label>w, h (m)</label><span style="display:flex;gap:4px"><input data-k="obstacle.w" type="number" step="any" value="${o.w}"><input data-k="obstacle.h" type="number" step="any" value="${o.h}"></span>`
          : `<label>Centre x, y (m)</label><span style="display:flex;gap:4px"><input data-k="obstacle.x" type="number" step="any" value="${o.x}"><input data-k="obstacle.y" type="number" step="any" value="${o.y}"></span><label>${o.type === 'naca' ? 'Chord' : 'Size'} (m)</label><input data-k="obstacle.size" type="number" step="any" value="${o.size}"><label>Angle (°)</label><input data-k="obstacle.angle" type="number" step="any" value="${o.angle || 0}">`}` : ''}
      <h4>Heat transfer</h4><label>Simulate heat</label><input type="checkbox" data-k="heat.on" ${c.heat && c.heat.on ? 'checked' : ''} style="width:auto">
      ${c.heat && c.heat.on ? `<label>Inflow / start (°C)</label><input data-k="heat.Tin" type="number" step="any" value="${c.heat.Tin}"><label>Bodies (°C)</label><input data-k="heat.Tbody" type="number" step="any" value="${c.heat.Tbody}">${['top', 'bottom', 'left', 'right'].filter(k => c.sides[k] === 'wall' || c.sides[k] === 'slip').map(k => `<label>${k[0].toUpperCase() + k.slice(1)} wall (°C)</label><input data-k="heat.sideT.${k}" type="number" step="any" placeholder="insulated" value="${c.heat.sideT && c.heat.sideT[k] != null ? c.heat.sideT[k] : ''}">`).join('')}<span class="note">Prandtl number ${fluidProps(c).Pr} for this fluid.</span>` : ''}
      ${c.painted ? `<h4>Obstacle</h4><span class="note">Hand-drawn. <button class="aero-btn small" id="clearPaint">Clear drawing</button></span>` : ''}
    </div>`;
    $('setup').querySelectorAll('[data-k]').forEach(el => el.onchange = () => {
      const ks = el.dataset.k.split('.'); if (ks[0] === 'heat' && !A.cfg.heat) A.cfg.heat = { on: false, Tin: 20, Tbody: 60, sideT: {} }; if (ks[1] === 'sideT' && !A.cfg.heat.sideT) A.cfg.heat.sideT = {};
      let o2 = A.cfg; for (let i = 0; i < ks.length - 1; i++) o2 = o2[ks[i]];
      const v = el.type === 'checkbox' ? el.checked : ks[1] === 'sideT' && el.value === '' ? null : el.type === 'number' || ks[0] === 'nx' ? +el.value : el.value; if (el.type === 'number' && v !== null && !(isFinite(v))) return; o2[ks[ks.length - 1]] = v;
      if (ks.join('.') === 'heat.on' && v) $('field').value = 'T';
      if (ks[0] === 'fluid' && v === 'custom') { const fp = FC.FLUIDS[A.cfg.fluid] || {}; A.cfg.nu = A.cfg.nu || 1e-6; A.cfg.rho = A.cfg.rho || 1000; }
      if (ks[0] === 'Lx' || ks[0] === 'Ly' || ks[0] === 'nx') A.cfg.painted = null;
      if (ks[1] === 'size' && A.cfg.obstacle) A.cfg.ref = v;
      Aero.setDirty(true); renderSetup(); build();
    });
    const cp = $('clearPaint'); if (cp) cp.onclick = () => { A.cfg.painted = null; A.cfg.obstacle = null; renderSetup(); build(); };
  }

  // ---------- run loop ----------
  function setRun(on) { A.running = on; $('bRun').textContent = on ? '❚❚ Pause' : '▶ Run'; if (on) requestAnimationFrame(loop); else if (A.f) { draw(); renderResults(); } }
  let lastDraw = 0;
  function loop(ts) {
    if (!A.running) return;
    const t0 = performance.now(); let n = 0;
    try { while (performance.now() - t0 < 14 && n < 400) { A.f.step(); n++; record(); if (!isFinite(A.f.umax) || A.f.umax > 1e3 * (A.cfg.U || 1)) throw new Error('The solution blew up (velocities grew without bound). Try more cells or a lower velocity.'); } }
    catch (e) { setRun(false); Aero.alert('Simulation stopped', e.message); }
    if (ts - lastDraw > 90) { draw(); renderResults(); lastDraw = ts; }   // drawing is costlier than a step; ~11 fps is plenty
    requestAnimationFrame(loop);
  }
  function record() {
    const f = A.f; if (f.steps % 4) return;
    const [fx, fy] = f.forces(), q = 0.5 * f.rho * A.cfg.U ** 2 * A.cfg.ref, Cd = q ? fx / q : 0, Cl = q ? fy / q : 0;
    A.hist.push({ t: f.t, Cd, Cl, div: f.divergence(), cg: f.cgIters }); if (A.hist.length > 4000) A.hist.splice(0, A.hist.length - 4000);
    // Strouhal from upward zero crossings of Cl (after the start-up)
    const h = A.hist; if (h.length > 2) { const a = h[h.length - 2], b = h[h.length - 1]; if (a.Cl < 0 && b.Cl >= 0 && f.t > 4 * A.cfg.Lx / Math.max(1e-9, A.cfg.U) * 0.3) A.shed.push(a.t + (b.t - a.t) * (-a.Cl) / (b.Cl - a.Cl)); }
  }

  // ---------- drawing ----------
  let off = document.createElement('canvas');
  function layout() {
    const cv = $('cv'), r = $('stage').getBoundingClientRect(), dpr = devicePixelRatio || 1;
    if (cv.width !== Math.round(r.width * dpr) || cv.height !== Math.round(r.height * dpr)) { cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr); cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; }
    const pad = 46, s = Math.min((r.width - 2 * pad - 60) / A.cfg.Lx, (r.height - 2 * pad) / A.cfg.Ly);
    return { w: r.width, h: r.height, s, ox: (r.width - 60 - A.cfg.Lx * s) / 2, oy: (r.height + A.cfg.Ly * s) / 2, dpr };
  }
  const toScr = (L, x, y) => [L.ox + x * L.s, L.oy - y * L.s];
  const toDom = (L, sx, sy) => [(sx - L.ox) / L.s, (L.oy - sy) / L.s];
  function fieldValue(kind, i, j) {
    const f = A.f, k = j * f.W + i;
    switch (kind) { case 'T': return f.heat ? f.T[k] : 0; case 'p': return f.p[k] * f.rho; case 'vort': return f.vorticity(i, j); case 'dye': return f.dye[k]; case 'u': return f.cellVel(i, j)[0]; case 'v': return f.cellVel(i, j)[1]; default: { const [u, v] = f.cellVel(i, j); return Math.hypot(u, v); } }
  }
  function draw() {
    if (!A.f) return;
    const f = A.f, cv = $('cv'), g = cv.getContext('2d'), L = layout(), kind = $('field').value; A.L = L;
    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0); g.fillStyle = '#1a1f27'; g.fillRect(0, 0, L.w, L.h);
    // field → image
    off.width = f.nx; off.height = f.ny; const og = off.getContext('2d'), img = og.createImageData(f.nx, f.ny), vals = new Float32Array(f.nx * f.ny);
    let lo = Infinity, hi = -Infinity;
    for (let j = 1; j <= f.ny; j++) for (let i = 1; i <= f.nx; i++) { const v = f.solid[j * f.W + i] ? NaN : fieldValue(kind, i, j); vals[(j - 1) * f.nx + i - 1] = v; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } }
    const sym = kind === 'vort' || kind === 'u' || kind === 'v' || kind === 'p';
    if (kind === 'vort') { const s = [...vals].filter(v => v === v).map(Math.abs).sort((a, b) => a - b); const m = s[Math.floor(s.length * 0.98)] || 1; lo = -m; hi = m; }
    else if (sym) { const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1; if (kind === 'p') { /* pressure: centre on the median so small gauge offsets don't wash out */ const s = [...vals].filter(v => v === v).sort((a, b) => a - b); const med = s[Math.floor(s.length / 2)] || 0, mm = Math.max(hi - med, med - lo) || 1; lo = med - mm; hi = med + mm; } else { lo = -m; hi = m; } }
    if (kind === 'dye') { lo = 0; hi = 1; }
    if (kind === 'T' && f.heat) { const ts = [f.heat.Tin, f.heat.Tbody, ...['left', 'right', 'top', 'bottom'].map(k => f.sides[k].T).filter(x => x != null)]; lo = Math.min(...ts); hi = Math.max(...ts); }
    const cmap = kind === 'dye' ? DYE : sym || kind === 'T' ? COOLWARM : VIRIDIS, span = hi - lo || 1;
    for (let j = 0; j < f.ny; j++) for (let i = 0; i < f.nx; i++) { const v = vals[j * f.nx + i], o = ((f.ny - 1 - j) * f.nx + i) * 4; if (v !== v) { img.data[o] = 120; img.data[o + 1] = 124; img.data[o + 2] = 130; img.data[o + 3] = 255; continue; } const c = cmap((v - lo) / span); img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255; }
    og.putImageData(img, 0, 0);
    const [x0, y0] = toScr(L, 0, A.cfg.Ly); g.imageSmoothingEnabled = true; g.drawImage(off, x0, y0, A.cfg.Lx * L.s, A.cfg.Ly * L.s);
    // obstacles crisp on top
    g.fillStyle = '#9aa3ad'; const cw = f.dx * L.s, ch = f.dy * L.s;
    for (let j = 1; j <= f.ny; j++) for (let i = 1; i <= f.nx; i++) if (f.solid[j * f.W + i]) { const [sx, sy] = toScr(L, (i - 1) * f.dx, j * f.dy); g.fillRect(sx - 0.2, sy - 0.2, cw + 0.4, ch + 0.4); }
    if ($('stream').checked) drawStreamlines(g, L);
    if ($('vecs').checked) drawArrows(g, L);
    // boundary labels
    const side = (k, x, y, rot) => { const t = A.cfg.sides[k]; g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = t === 'inlet' ? '#7fd3ff' : t === 'outlet' ? '#ffd27f' : '#c7cfd8'; g.font = '11px Segoe UI'; g.textAlign = 'center'; g.fillText(t === 'moving' ? 'moving wall →' : t, 0, 0); g.restore(); };
    const [ax, ay] = toScr(L, 0, 0), [bx, by] = toScr(L, A.cfg.Lx, A.cfg.Ly);
    g.strokeStyle = '#c7cfd8'; g.lineWidth = 1; g.strokeRect(ax, by, bx - ax, ay - by);
    side('left', ax - 10, (ay + by) / 2, -Math.PI / 2); side('right', bx + 14, (ay + by) / 2, Math.PI / 2); side('top', (ax + bx) / 2, by - 8, 0); side('bottom', (ax + bx) / 2, ay + 16, 0);
    // colour bar
    const cbx = L.w - 44, cby = 40, cbh = L.h - 100; for (let k = 0; k < cbh; k++) { const c = cmap(1 - k / cbh); g.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; g.fillRect(cbx, cby + k, 12, 1.5); }
    g.fillStyle = '#dfe6ee'; g.font = '11px Segoe UI'; g.textAlign = 'right';
    const unit = { speed: 'm/s', u: 'm/s', v: 'm/s', p: 'Pa', vort: '1/s', dye: '', T: '°C' }[kind];
    g.save(); g.translate(cbx - 4, cby + cbh / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText($('field').selectedOptions[0].text + (unit ? ` (${unit})` : ''), 0, 0); g.restore();
    g.textAlign = 'left'; g.fillText(fmt(hi), cbx - 2, cby - 6); g.fillText(fmt(lo), cbx - 2, cby + cbh + 14);
    // scale bar & probe
    g.fillStyle = '#c7cfd8'; g.textAlign = 'left'; g.fillText(`${A.cfg.Lx} m × ${A.cfg.Ly} m · ${f.nx}×${f.ny} cells`, ax, ay + 32);
    if (A.probe) { const [px, py] = toScr(L, A.probe[0], A.probe[1]); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(px, py, 6, 0, 7); g.moveTo(px - 9, py); g.lineTo(px + 9, py); g.moveTo(px, py - 9); g.lineTo(px, py + 9); g.stroke(); }
    $('clock').textContent = `t = ${fmt(f.t, 2)} s`;
  }
  function drawStreamlines(g, L) {
    const f = A.f, c = A.cfg, seeds = [], n = 18;
    if (c.sides.left === 'inlet') for (let k = 0; k < n; k++) seeds.push([f.dx * 0.6, (k + 0.5) * c.Ly / n]);
    else for (let b = 0; b < 12; b++) seeds.push([c.Lx / 2, (b + 0.5) * c.Ly / 12]);   // closed recirculation: seed a centre line
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 1;
    const h = Math.min(f.dx, f.dy) * 0.7, solidAt = (x, y) => { const i = Math.floor(x / f.dx) + 1, j = Math.floor(y / f.dy) + 1; return i < 1 || j < 1 || i > f.nx || j > f.ny || f.solid[j * f.W + i]; };
    seeds.forEach(s0 => { [1, c.sides.left === 'inlet' ? 0 : -1].forEach(dir => { if (!dir) return; let [x, y] = s0; g.beginPath(); g.moveTo(...toScr(L, x, y));
      for (let k = 0; k < 1500; k++) { const [u, v] = f.velAt(x, y), sp = Math.hypot(u, v); if (sp < 1e-12) break; if (k > 20 && Math.hypot(x - s0[0], y - s0[1]) < h * 0.8) break; /* loop closed */ const mx = x + dir * u / sp * h / 2, my = y + dir * v / sp * h / 2; const [u2, v2] = f.velAt(mx, my), s2 = Math.hypot(u2, v2) || 1; x += dir * u2 / s2 * h; y += dir * v2 / s2 * h; if (solidAt(x, y)) break; g.lineTo(...toScr(L, x, y)); }
      g.stroke(); }); });
  }
  function drawArrows(g, L) {
    const f = A.f, step = Math.max(2, Math.round(f.nx / 32)), sc = (step * f.dx * L.s * 0.9) / Math.max(1e-12, A.f.umax || 1);
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.fillStyle = g.strokeStyle; g.lineWidth = 1;
    for (let j = Math.ceil(step / 2); j <= f.ny; j += step) for (let i = Math.ceil(step / 2); i <= f.nx; i += step) {
      if (f.solid[j * f.W + i]) continue; const [u, v] = f.cellVel(i, j); const [x, y] = toScr(L, (i - 0.5) * f.dx, (j - 0.5) * f.dy), ex = x + u * sc, ey = y - v * sc;
      g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke(); const a = Math.atan2(ey - y, ex - x); g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex - 4 * Math.cos(a - 0.5), ey - 4 * Math.sin(a - 0.5)); g.lineTo(ex - 4 * Math.cos(a + 0.5), ey - 4 * Math.sin(a + 0.5)); g.fill();
    }
  }

  // ---------- results & charts ----------
  function renderResults() {
    if (!A.f) return;
    const f = A.f, c = A.cfg, h = A.hist, last = h[h.length - 1], { nu } = fluidProps(c);
    const tail = h.slice(Math.floor(h.length * 0.6)), mean = k => tail.length ? tail.reduce((s, x) => s + x[k], 0) / tail.length : NaN;
    const sh = A.shed.slice(-6); let St = NaN; if (sh.length >= 3) { const T = (sh[sh.length - 1] - sh[0]) / (sh.length - 1); St = c.ref / (T * c.U); }
    let probe = ''; if (A.probe) { const i = Math.min(f.nx, Math.max(1, Math.floor(A.probe[0] / f.dx) + 1)), j = Math.min(f.ny, Math.max(1, Math.floor(A.probe[1] / f.dy) + 1)); const [u, v] = f.cellVel(i, j); probe = `<b>Probe</b><span>(${fmt(A.probe[0])}, ${fmt(A.probe[1])}) m: u ${fmt(u)} · v ${fmt(v)} m/s · p ${fmt(f.p[j * f.W + i] * f.rho)} Pa</span>`; }
    const hasBody = f.solid.some(Boolean);
    $('results').innerHTML = `<div class="kv"><b>Reynolds</b><span>${fmt(c.U * c.ref / nu, 1)}</span><b>Time step</b><span>${fmt(f.dt)} s · ${f.steps.toLocaleString()} steps</span>
      ${hasBody ? `<b>Drag Cd</b><span>${last ? fmt(last.Cd) : '—'} <span class="dim">(mean ${fmt(mean('Cd'))})</span></span><b>Lift Cl</b><span>${last ? fmt(last.Cl) : '—'} <span class="dim">(mean ${fmt(mean('Cl'))})</span></span><b>Strouhal</b><span>${isFinite(St) ? fmt(St) : '<span class="dim">— (needs a few shed vortices)</span>'}</span>` : ''}
      ${f.heat && hasBody ? (() => { const hb = f.heatFromBodies(), dT = f.heat.Tbody - f.heat.Tin, o = c.obstacle; const Nu = o && o.type === 'circle' && !c.painted && dT ? hb.Q / (Math.PI * hb.k * dT) : NaN; return `<b>Heat from body</b><span>${fmt(hb.Q, 2)} W per m of depth</span>${isFinite(Nu) ? `<b>Nusselt</b><span>${fmt(Nu, 2)} <span class="dim">(h = ${fmt(Nu * hb.k / c.ref, 1)} W/m²K)</span></span>` : ''}`; })() : ''}
      <b>Max speed</b><span>${fmt(maxSpeed())} m/s</span><b>Continuity</b><span>max |∇·u| ${fmt(f.divergence())} 1/s · ${f.cgIters} CG iterations</span>${probe}</div>`;
    $('st1').textContent = A.running ? 'Running…' : 'Paused'; $('st2').textContent = `${f.nx}×${f.ny} grid · dx ${fmt(f.dx)} m`; $('st3').textContent = A.tool ? (A.tool === 'paint' ? 'Drawing obstacles' : 'Erasing obstacles') : 'Click the flow to place a probe';
    drawChart();
  }
  function maxSpeed() { const f = A.f; let m = 0; for (let j = 1; j <= f.ny; j++) for (let i = 1; i <= f.nx; i++) { if (f.solid[j * f.W + i]) continue; const [u, v] = f.cellVel(i, j); m = Math.max(m, Math.hypot(u, v)); } return m; }
  function drawChart() {
    const cv = $('chart'), w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1; if (!w || !h) return; cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.font = '11px Segoe UI';
    const L = 46, R = w - 10, T = 12, B = h - 22;
    const axes = (x0, x1, y0, y1, xl, yl) => { g.strokeStyle = '#c5d5e8'; g.strokeRect(L, T, R - L, B - T); g.fillStyle = '#5b6b7c'; g.textAlign = 'right'; g.fillText(fmt(y1, 2), L - 4, T + 8); g.fillText(fmt(y0, 2), L - 4, B); g.textAlign = 'center'; g.fillText(xl, (L + R) / 2, h - 6); g.textAlign = 'left'; g.fillText(fmt(x0, 2), L, h - 6); g.textAlign = 'right'; g.fillText(fmt(x1, 2), R, h - 6); g.save(); g.translate(10, (T + B) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(yl, 0, 0); g.restore(); };
    const line = (pts, x0, x1, y0, y1, col) => { g.strokeStyle = col; g.lineWidth = 1.5; g.beginPath(); pts.forEach(([x, y], i) => { const X = L + (R - L) * (x - x0) / (x1 - x0 || 1), Y = B - (B - T) * (y - y0) / (y1 - y0 || 1); i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke(); };
    const hst = A.hist;
    if (A.chartTab === 'forces' || A.chartTab === 'conv') {
      if (hst.length < 2) { g.fillStyle = '#5b6b7c'; g.textAlign = 'center'; g.fillText('Press Run — history appears here', w / 2, h / 2); return; }
      const t0 = hst[0].t, t1 = hst[hst.length - 1].t;
      if (A.chartTab === 'forces') {
        const ys = hst.flatMap(p => [p.Cd, p.Cl]).filter(isFinite), y0 = Math.min(0, ...ys), y1 = Math.max(...ys, 0.1);
        axes(t0, t1, y0, y1, 'time (s)', 'coefficient'); line(hst.map(p => [p.t, p.Cd]), t0, t1, y0, y1, '#c81e2a'); line(hst.map(p => [p.t, p.Cl]), t0, t1, y0, y1, '#2d78c4');
        g.fillStyle = '#c81e2a'; g.textAlign = 'left'; g.fillText('Cd', L + 6, T + 12); g.fillStyle = '#2d78c4'; g.fillText('Cl', L + 30, T + 12);
      } else {
        const ys = hst.map(p => Math.log10(Math.max(1e-12, p.div))), y0 = Math.min(...ys), y1 = Math.max(...ys) + 0.1;
        axes(t0, t1, y0, y1, 'time (s)', 'log₁₀ max |∇·u|'); line(hst.map((p, i) => [p.t, ys[i]]), t0, t1, y0, y1, '#3c7fb1');
      }
      return;
    }
    // validation
    const f = A.f, c = A.cfg;
    if (c.validation === 'ghia') {
      const prof = [[0, 0], ...FS.centrelineU(f).map(([y, u]) => [y / c.Ly, u / c.U]), [1, 1]];
      axes(-0.4, 1, 0, 1, 'u / U on the vertical centre line', 'y / H');
      g.strokeStyle = '#3c7fb1'; g.lineWidth = 1.5; g.beginPath(); prof.forEach(([y, u], i) => { const X = L + (R - L) * (u + 0.4) / 1.4, Y = B - (B - T) * y; i ? g.lineTo(X, Y) : g.moveTo(X, Y); }); g.stroke();
      g.fillStyle = '#c81e2a'; FS.GHIA_RE100.forEach(([y, u]) => { g.beginPath(); g.arc(L + (R - L) * (u + 0.4) / 1.4, B - (B - T) * y, 3, 0, 7); g.fill(); });
      g.textAlign = 'left'; g.fillStyle = '#3c7fb1'; g.fillText('Lumen Flow', L + 6, T + 12); g.fillStyle = '#c81e2a'; g.fillText('● Ghia et al. 1982', L + 6, T + 26);
    } else if (c.validation === 'poiseuille') {
      const i = Math.round(f.nx * 0.85), pts = []; for (let j = 1; j <= f.ny; j++) pts.push([(j - 0.5) * f.dy / c.Ly, f.u[j * f.W + i] / c.U]);
      axes(0, 1.6, 0, 1, 'u / U near the outlet', 'y / H');
      g.strokeStyle = '#c81e2a'; g.lineWidth = 1.5; g.setLineDash([5, 3]); g.beginPath(); for (let k = 0; k <= 50; k++) { const y = k / 50, u = 6 * y * (1 - y); const X = L + (R - L) * u / 1.6, Y = B - (B - T) * y; k ? g.lineTo(X, Y) : g.moveTo(X, Y); } g.stroke(); g.setLineDash([]);
      g.fillStyle = '#3c7fb1'; pts.forEach(([y, u]) => { g.beginPath(); g.arc(L + (R - L) * u / 1.6, B - (B - T) * y, 2.5, 0, 7); g.fill(); });
      g.textAlign = 'left'; g.fillStyle = '#3c7fb1'; g.fillText('● Lumen Flow', L + 6, T + 12); g.fillStyle = '#c81e2a'; g.fillText('— exact: 6·y(1−y)', L + 6, T + 26);
    } else { g.fillStyle = '#5b6b7c'; g.textAlign = 'center'; g.fillText('Open the Lid-driven cavity or Channel case', w / 2, h / 2 - 8); g.fillText('to compare against published / exact results.', w / 2, h / 2 + 8); }
  }

  // ---------- interaction: probe & painting ----------
  function setTool(t) { A.tool = A.tool === t ? null : t; $('bPaint').classList.toggle('on', A.tool === 'paint'); $('bErase').classList.toggle('on', A.tool === 'erase'); $('hint').textContent = A.tool ? 'Drag on the flow to ' + (A.tool === 'paint' ? 'draw solid obstacles' : 'erase obstacles') : 'Click the flow to place a probe'; renderResults(); }
  function paintAt(e) {
    const r = $('cv').getBoundingClientRect(), [x, y] = toDom(A.L, e.clientX - r.left, e.clientY - r.top);
    if (x < 0 || y < 0 || x > A.cfg.Lx || y > A.cfg.Ly) return;
    A.f.paint(x, y, Math.max(A.f.dx, A.f.dy) * 2.2, A.tool === 'paint');
    const f = A.f, s = new Uint8Array(f.nx * f.ny); for (let j = 1; j <= f.ny; j++) for (let i = 1; i <= f.nx; i++) s[(j - 1) * f.nx + i - 1] = f.solid[j * f.W + i];
    A.cfg.painted = Array.from(s); A.cfg.obstacle = null; draw();
  }
  $('cv').addEventListener('pointerdown', e => {
    if (A.tool) { $('cv').setPointerCapture(e.pointerId); paintAt(e); const mv = ev => paintAt(ev); const up = () => { $('cv').removeEventListener('pointermove', mv); $('cv').removeEventListener('pointerup', up); renderSetup(); Aero.setDirty(true); }; $('cv').addEventListener('pointermove', mv); $('cv').addEventListener('pointerup', up); return; }
    const r = $('cv').getBoundingClientRect(), [x, y] = toDom(A.L, e.clientX - r.left, e.clientY - r.top);
    if (x >= 0 && y >= 0 && x <= A.cfg.Lx && y <= A.cfg.Ly) { A.probe = [x, y]; draw(); renderResults(); }
  });

  // ---------- files ----------
  function fieldsCSV() {
    const f = A.f, rows = ['x_m,y_m,solid,u_m_s,v_m_s,speed_m_s,p_Pa,vorticity_1_s' + (A.f.heat ? ',T_C' : '')];
    for (let j = 1; j <= f.ny; j++) for (let i = 1; i <= f.nx; i++) { const k = j * f.W + i, [u, v] = f.cellVel(i, j); rows.push([((i - 0.5) * f.dx).toFixed(6), ((j - 0.5) * f.dy).toFixed(6), f.solid[k], u.toExponential(5), v.toExponential(5), Math.hypot(u, v).toExponential(5), (f.p[k] * f.rho).toExponential(5), f.vorticity(i, j).toExponential(5)].concat(f.heat ? [f.T[k].toFixed(4)] : []).join(',')); }
    return rows.join('\n') + '\n';
  }
  function vtk() { // legacy VTK structured points — opens in ParaView
    const f = A.f, n = f.nx * f.ny, L = ['# vtk DataFile Version 3.0', 'Lumen Flow ' + A.docName, 'ASCII', 'DATASET STRUCTURED_POINTS', `DIMENSIONS ${f.nx} ${f.ny} 1`, `ORIGIN ${f.dx / 2} ${f.dy / 2} 0`, `SPACING ${f.dx} ${f.dy} 1`, `POINT_DATA ${n}`, 'VECTORS velocity float'];
    const each = fn => { const o = []; for (let j = 1; j <= f.ny; j++) for (let i = 1; i <= f.nx; i++) o.push(fn(i, j, j * f.W + i)); return o; };
    L.push(...each((i, j) => { const [u, v] = f.cellVel(i, j); return `${u} ${v} 0`; }));
    L.push('SCALARS pressure float 1', 'LOOKUP_TABLE default', ...each((i, j, k) => f.p[k] * f.rho), 'SCALARS vorticity float 1', 'LOOKUP_TABLE default', ...each((i, j) => f.vorticity(i, j)), 'SCALARS solid int 1', 'LOOKUP_TABLE default', ...each((i, j, k) => f.solid[k]));
    if (f.heat) L.push('SCALARS temperature float 1', 'LOOKUP_TABLE default', ...each((i, j, k) => f.T[k]));
    return L.join('\n') + '\n';
  }
  const histCSV = () => 't_s,Cd,Cl,max_div,cg_iterations\n' + A.hist.map(p => [p.t, p.Cd, p.Cl, p.div, p.cg].join(',')).join('\n') + '\n';
  async function save() { const p = await Aero.saveFile({ name: A.docName + '.lflow', data: JSON.stringify({ format: 'lumen-flow', version: 1, cfg: A.cfg }), filters: [{ name: 'Lumen Flow case', extensions: ['lflow'] }] }); if (p) { Aero.setDoc(A.docName, false); return true; } return false; }
  async function openFiles(files) { const f = files[0]; if (!f) return; try { const j = JSON.parse(typeof f.data === 'string' ? f.data : new TextDecoder().decode(f.data)); if (!j.cfg) throw new Error('Not a Lumen Flow case.'); A.cfg = j.cfg; A.docName = f.name.replace(/\.[^.]+$/, ''); setRun(false); renderSetup(); build(); Aero.setDoc(A.docName, false); } catch (e) { Aero.alert('Couldn’t open ' + f.name, e.message); } }

  // ---------- wiring ----------
  Aero.init({ name: 'Lumen Flow', icon: '../kit/icons/flow.png', doc: 'Untitled', onDropFiles: openFiles, dropText: 'Drop a .lflow case', onSave: save,
    menus: {
      File: [['Open case…', 'Ctrl+O', async () => openFiles(await Aero.openFile({ accept: '.lflow,.json', filters: [{ name: 'Lumen Flow case', extensions: ['lflow'] }] }))], ['Save case…', 'Ctrl+S', save], '-', '#Export results',
        ['Fields (.csv)…', '', () => Aero.saveFile({ name: A.docName + '-fields.csv', data: fieldsCSV(), filters: [{ name: 'CSV', extensions: ['csv'] }] })], ['ParaView (.vtk)…', '', () => Aero.saveFile({ name: A.docName + '.vtk', data: vtk(), filters: [{ name: 'VTK', extensions: ['vtk'] }] })],
        ['Force history (.csv)…', '', () => Aero.saveFile({ name: A.docName + '-history.csv', data: histCSV(), filters: [{ name: 'CSV', extensions: ['csv'] }] })], ['Picture (.png)…', '', async () => { const b = await new Promise(r => $('cv').toBlob(r, 'image/png')); Aero.saveFile({ name: A.docName + '.png', data: b, filters: [{ name: 'PNG', extensions: ['png'] }] }); }]],
      Run: [['Run / pause', 'Space', () => setRun(!A.running)], ['One step', 'S', () => { A.f.step(); record(); draw(); renderResults(); }], ['Reset', 'Ctrl+R', () => { setRun(false); build(); }]],
      Cases: Object.entries(FC.CASES).map(([k, c]) => [c.name, '', () => { $('caseSel').value = k; loadCase(k); }]),
      Help: [['About the solver', '', () => Aero.alert('About Lumen Flow',
        'Lumen Flow solves the 2D incompressible Navier–Stokes equations on a staggered grid with the projection method of Griebel et al. (NaSt2D): blended central/upwind advection, explicit viscosity, and a pressure Poisson equation solved by conjugate gradients with an incomplete-Cholesky preconditioner.\n\nIt is checked against the lid-driven cavity benchmark of Ghia, Ghia & Shin (1982) at Re = 100 (RMS error 0.0025 on the centre line) and the exact Poiseuille channel profile — see the Validation tab.\n\nHeat: temperature is carried by the flow and diffuses with α = ν/Pr; bodies and walls can be held at fixed temperatures. A heated cylinder at Re = 40 matches the Churchill–Bernstein Nusselt correlation.\n\nLimits: 2D, laminar, constant density (no buoyancy), uniform grid with stair-stepped bodies. There is no turbulence model, compressibility or 3D, so results at high Reynolds numbers are qualitative. Use it to learn and explore — use OpenFOAM, SU2 or Fluent for engineering sign-off.')]],
    } });
  Object.entries(FC.CASES).forEach(([k, c]) => $('caseSel').add(new Option(c.name, k)));
  $('caseSel').onchange = () => loadCase($('caseSel').value);
  $('bRun').onclick = () => setRun(!A.running); $('bStep').onclick = () => { A.f.step(); record(); draw(); renderResults(); }; $('bReset').onclick = () => { setRun(false); build(); };
  $('field').onchange = draw; $('stream').onchange = draw; $('vecs').onchange = draw;
  $('bPaint').onclick = () => setTool('paint'); $('bErase').onclick = () => setTool('erase');
  document.querySelectorAll('#ctabs .aero-tab').forEach(t => t.onclick = () => { A.chartTab = t.dataset.c; document.querySelectorAll('#ctabs .aero-tab').forEach(x => x.classList.toggle('on', x === t)); drawChart(); });
  new ResizeObserver(() => { if (A.f) { draw(); drawChart(); } }).observe($('stage'));
  setTool(null);
  loadCase('cylinder');
})();
