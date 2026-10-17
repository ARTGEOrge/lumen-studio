// Lumen Flow — 2D incompressible CFD you can watch, in the spirit of Ansys Fluent (for learning, not certification).
(function () {
  const FS = window.FlowSolver, FC = window.FlowCases, FA = window.FlowAnalysis, FG = window.FlowGIF, $ = id => document.getElementById(id), esc = s => Aero.esc(String(s ?? ''));
  const A = window.FlowApp = { cfg: null, f: null, running: false, hist: [], mon: [], chartTab: 'forces', tool: null, poly: null, monQty: 'v', monView: 'time', docName: 'Untitled' };
  const MON_COLORS = ['#e8590c', '#2b8a3e', '#7048e8', '#c2255c', '#1098ad', '#5c940d', '#d6336c', '#364fc7'], MAX_MON = 8;
  const MON_QTY = { u: ['u', 'm/s'], v: ['v', 'm/s'], speed: ['speed', 'm/s'], p: ['p', 'Pa'], T: ['T', '°C'] };
  const fmt = (v, d = 3) => !isFinite(v) ? '—' : Math.abs(v) >= 1e4 || (Math.abs(v) < 1e-3 && v !== 0) ? v.toExponential(2) : (+v.toFixed(d)).toString();

  // ---------- colour maps ----------
  const lerpStops = stops => t => { t = Math.max(0, Math.min(1, t)); const n = stops.length - 1, i = Math.min(n - 1, Math.floor(t * n)), f = t * n - i, a = stops[i], b = stops[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
  const VIRIDIS = lerpStops([[68, 1, 84], [72, 40, 120], [62, 74, 137], [49, 104, 142], [38, 130, 142], [31, 158, 137], [53, 183, 121], [109, 205, 89], [180, 222, 44], [253, 231, 37]]);
  const COOLWARM = lerpStops([[59, 76, 192], [98, 130, 234], [141, 176, 254], [184, 208, 249], [221, 221, 221], [245, 196, 173], [244, 154, 123], [222, 96, 77], [180, 4, 38]]);
  const DYE = lerpStops([[18, 24, 34], [40, 70, 120], [240, 240, 255]]);

  // ---------- setup ----------
  function fluidProps(c) { const fl = FC.FLUIDS[c.fluid] || FC.FLUIDS.custom, cu = c.fluid === 'custom'; return { nu: cu ? c.nu : fl.nu, rho: cu ? c.rho : fl.rho, Pr: cu ? (c.Pr || 1) : fl.Pr, cp: cu ? (c.cp || 1000) : fl.cp, beta: cu ? (c.beta ?? fl.beta) : fl.beta }; }
  const buoyant = c => !!(c.heat && c.heat.on && c.heat.buoy);
  // Rayleigh number on the reference length, using the largest temperature difference in the case
  function rayleigh(c) {
    if (!buoyant(c)) return NaN; const { nu, Pr, beta } = fluidProps(c), H = c.heat, ts = [+H.Tin, ...['left', 'right', 'top', 'bottom'].filter(k => c.sides[k] === 'wall' || c.sides[k] === 'slip').map(k => H.sideT && H.sideT[k]).filter(v => v != null && v !== '').map(Number)];
    if ((c.obstacle || c.painted)) ts.push(+H.Tbody); const dT = Math.max(...ts) - Math.min(...ts);
    return (+H.g || 9.81) * beta * dT * c.ref ** 3 / (nu * nu / Pr);
  }
  function build() {
    const c = A.cfg, { nu, rho, Pr, cp, beta } = fluidProps(c), ny = Math.max(8, Math.round(c.nx * c.Ly / c.Lx)), H = c.heat && c.heat.on ? c.heat : null;
    const side = (t, k) => ({ type: t, u: t === 'inlet' || t === 'moving' ? c.U : 0, v: 0, T: H && H.sideT && H.sideT[k] != null && H.sideT[k] !== '' ? +H.sideT[k] : null });
    A.f = new FS.Flow({ nx: c.nx, ny, Lx: c.Lx, Ly: c.Ly, nu, rho, sides: { left: side(c.sides.left, 'left'), right: side(c.sides.right, 'right'), top: side(c.sides.top, 'top'), bottom: side(c.sides.bottom, 'bottom') }, heat: H ? { Pr, cp, Tin: +H.Tin, Tbody: +H.Tbody, beta: H.buoy ? beta : 0, g: H.buoy ? (+H.g || 9.81) : 0 } : null });
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
    c.probes = (c.probes || []).filter(([x, y]) => x >= 0 && y >= 0 && x <= c.Lx && y <= c.Ly);
    A.hist = []; A.shed = []; A.mon = []; A.res0 = null; renderChartBar(); renderResults(); draw();
  }
  function loadCase(id) {
    const base = FC.CASES[id]; A.cfg = JSON.parse(JSON.stringify(base)); A.cfg.id = id; A.cfg.probes = A.cfg.probes || []; A.docName = base.name; if ($('caseSel').value !== id) $('caseSel').value = id;
    $('field').value = base.field || 'speed'; setRun(false); renderSetup(); build(); Aero.setDoc(A.docName, false);
  }
  function renderSetup() {
    const c = A.cfg, { nu, beta } = fluidProps(c), Re = c.U * c.ref / nu, ny = Math.round(c.nx * c.Ly / c.Lx), cellRe = c.U * (c.Lx / c.nx) / nu, Ra = rayleigh(c);
    const forced = Object.values(c.sides).some(t => t === 'inlet' || t === 'moving');
    const sideSel = k => `<select data-k="sides.${k}">${['inlet', 'outlet', 'wall', 'slip', 'moving'].map(t => `<option ${c.sides[k] === t ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
    const o = c.obstacle;
    $('setup').innerHTML = `<div class="pform">
      <span class="note">${esc(c.note || '')}</span>
      <h4>Domain</h4><label>Length (m)</label><input data-k="Lx" type="number" step="any" value="${c.Lx}"><label>Height (m)</label><input data-k="Ly" type="number" step="any" value="${c.Ly}">
      <label>Grid cells</label><select data-k="nx">${[40, 64, 80, 120, 160, 200, 220, 250, 300, 400].map(n => `<option ${n === c.nx ? 'selected' : ''} value="${n}">${n} × ${Math.round(n * c.Ly / c.Lx)}</option>`).join('')}</select>
      <h4>Fluid &amp; inflow</h4><label>Fluid</label><select data-k="fluid">${Object.entries(FC.FLUIDS).map(([k, f]) => `<option value="${k}" ${c.fluid === k ? 'selected' : ''}>${f.name}</option>`).join('')}</select>
      ${c.fluid === 'custom' ? `<label>ν (m²/s)</label><input data-k="nu" type="number" step="any" value="${c.nu}"><label>ρ (kg/m³)</label><input data-k="rho" type="number" step="any" value="${c.rho}">` : ''}
      ${forced ? `<label>Velocity (m/s)</label><input data-k="U" type="number" step="any" value="${c.U}">
      <label>Reynolds</label><span><b>${fmt(Re, 1)}</b> <span class="dim">(based on ${c.ref} m)</span></span>` : ''}
      ${forced && cellRe > 20 ? `<span class="note warn">Cell Reynolds number ${fmt(cellRe, 1)} is high: use more cells, a slower flow or a thicker fluid for trustworthy results.</span>` : ''}
      <h4>Boundaries</h4><label>Left</label>${sideSel('left')}<label>Right</label>${sideSel('right')}<label>Top</label>${sideSel('top')}<label>Bottom</label>${sideSel('bottom')}
      ${o && !c.painted ? `<h4>Obstacle</h4><label>Shape</label><select data-k="obstacle.type">${['circle', 'square', 'plate', 'naca', 'rect'].concat(o.polys ? ['polygon'] : []).map(t => `<option ${o.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        ${o.type === 'naca' ? `<label>NACA code</label><input data-k="obstacle.code" value="${esc(o.code || '0012')}">` : ''}
        ${o.type === 'rect' ? `<label>x, y (m)</label><span style="display:flex;gap:4px"><input data-k="obstacle.x" type="number" step="any" value="${o.x}"><input data-k="obstacle.y" type="number" step="any" value="${o.y}"></span><label>w, h (m)</label><span style="display:flex;gap:4px"><input data-k="obstacle.w" type="number" step="any" value="${o.w}"><input data-k="obstacle.h" type="number" step="any" value="${o.h}"></span>`
          : `<label>Centre x, y (m)</label><span style="display:flex;gap:4px"><input data-k="obstacle.x" type="number" step="any" value="${o.x}"><input data-k="obstacle.y" type="number" step="any" value="${o.y}"></span><label>${o.type === 'naca' ? 'Chord' : 'Size'} (m)</label><input data-k="obstacle.size" type="number" step="any" value="${o.size}"><label>Angle (°)</label><input data-k="obstacle.angle" type="number" step="any" value="${o.angle || 0}">`}` : ''}
      <h4>Heat transfer</h4><label>Simulate heat</label><input type="checkbox" data-k="heat.on" ${c.heat && c.heat.on ? 'checked' : ''} style="width:auto">
      ${c.heat && c.heat.on ? `<label>Inflow / start (°C)</label><input data-k="heat.Tin" type="number" step="any" value="${c.heat.Tin}"><label>Bodies (°C)</label><input data-k="heat.Tbody" type="number" step="any" value="${c.heat.Tbody}">${['top', 'bottom', 'left', 'right'].filter(k => c.sides[k] === 'wall' || c.sides[k] === 'slip').map(k => `<label>${k[0].toUpperCase() + k.slice(1)} wall (°C)</label><input data-k="heat.sideT.${k}" type="number" step="any" placeholder="insulated" value="${c.heat.sideT && c.heat.sideT[k] != null ? c.heat.sideT[k] : ''}">`).join('')}<span class="note">Prandtl number ${fluidProps(c).Pr} for this fluid.</span>
        <label title="Boussinesq approximation: warm fluid rises, cool fluid sinks">Buoyancy (gravity ↓)</label><input type="checkbox" data-k="heat.buoy" ${c.heat.buoy ? 'checked' : ''} style="width:auto">
        ${c.heat.buoy ? `<label>g (m/s²)</label><input data-k="heat.g" type="number" step="any" min="0" value="${c.heat.g ?? 9.81}">${c.fluid === 'custom' ? `<label>β (1/K)</label><input data-k="beta" type="number" step="any" value="${beta}">` : `<label>β (1/K)</label><span>${fmt(beta)}</span>`}
        <label>Rayleigh</label><span><b>${fmt(Ra, 0)}</b> <span class="dim">(ΔT over ${c.ref} m)</span></span>${Ra > 2e6 ? `<span class="note warn">Ra above ~10⁶ becomes unsteady and needs a fine grid; results will be qualitative.</span>` : ''}` : ''}` : ''}
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
  function setRun(on) { if (on && A.recording) return; A.running = on; $('bRun').textContent = on ? '❚❚ Pause' : '▶ Run'; if (on) requestAnimationFrame(loop); else if (A.f) { draw(); renderResults(); } }
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
    const r = f.res || { u: NaN, v: NaN, T: NaN, cont: NaN };
    A.hist.push({ t: f.t, Cd, Cl, div: f.divergence(), cg: f.cgIters, ru: r.u, rv: r.v, rT: r.T, rc: r.cont }); if (A.hist.length > 4000) A.hist.splice(0, A.hist.length - 4000);
    // Fluent-style scaling: each residual is divided by its largest value over the first records
    if (!A.res0 || A.hist.length <= 5) { const p = A.res0 || { ru: 0, rv: 0, rT: 0, rc: 0 }; ['ru', 'rv', 'rT', 'rc'].forEach(k => { const x = A.hist[A.hist.length - 1][k]; if (isFinite(x) && x > p[k]) p[k] = x; }); A.res0 = p; }
    // monitor points: everything at every probe, so the quantity shown can be switched afterwards
    const P = A.cfg.probes || []; if (P.length) { A.mon.push({ t: f.t, v: P.map(([x, y]) => FA.probe(f, x, y)) }); if (A.mon.length > 8000) A.mon.splice(0, A.mon.length - 8000); }
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
    (A.cfg.probes || []).forEach(([x, y], n) => { const [px, py] = toScr(L, x, y), col = MON_COLORS[n % MON_COLORS.length]; g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.55)'; g.beginPath(); g.arc(px, py, 6, 0, 7); g.stroke(); g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.arc(px, py, 6, 0, 7); g.moveTo(px - 10, py); g.lineTo(px - 3, py); g.moveTo(px + 3, py); g.lineTo(px + 10, py); g.moveTo(px, py - 10); g.lineTo(px, py - 3); g.moveTo(px, py + 3); g.lineTo(px, py + 10); g.stroke(); g.font = 'bold 11px Segoe UI'; g.textAlign = 'left'; g.fillStyle = '#000'; g.fillText(n + 1, px + 8, py - 6); g.fillStyle = col; g.fillText(n + 1, px + 7, py - 7); });
    if (A.poly && A.poly.length) { g.strokeStyle = '#ffe066'; g.fillStyle = 'rgba(255,224,102,.25)'; g.lineWidth = 1.5; g.setLineDash([5, 3]); g.beginPath(); A.poly.concat(A.polyHover ? [A.polyHover] : []).forEach(([x, y], i) => { const [sx, sy] = toScr(L, x, y); i ? g.lineTo(sx, sy) : g.moveTo(sx, sy); }); g.closePath(); g.fill(); g.stroke(); g.setLineDash([]); g.fillStyle = '#ffe066'; A.poly.forEach(([x, y]) => { const [sx, sy] = toScr(L, x, y); g.fillRect(sx - 3, sy - 3, 6, 6); }); }
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
    const probe = (c.probes || []).map(([x, y], n) => { const q = FA.probe(f, x, y); return `<b><span class="mon-dot" style="background:${MON_COLORS[n % MON_COLORS.length]}"></span>Point ${n + 1}</b><span>u ${fmt(q.u)} · v ${fmt(q.v)} m/s · p ${fmt(q.p)} Pa${f.heat ? ` · ${fmt(q.T, 2)} °C` : ''}</span>`; }).join('');
    const hasBody = f.solid.some(Boolean), forced = Object.values(c.sides).some(t => t === 'inlet' || t === 'moving');
    // heat through walls held at a fixed temperature: Nusselt number on the reference length
    let walls = ''; if (f.heat && c.heat) { const H = c.heat, Ts = ['left', 'right', 'top', 'bottom'].map(k => f.sides[k].T).filter(v => v != null), dT = Ts.length ? Math.max(...Ts, H.Tin) - Math.min(...Ts, H.Tin) : 0;
      ['left', 'right', 'bottom', 'top'].forEach(k => { if (f.sides[k].T == null || !dT) return; const gr = f.wallGradient(k), q = gr * f.alpha * f.rho * f.heat.cp; walls += `<b>${k[0].toUpperCase() + k.slice(1)} wall</b><span>Nu ${fmt(gr * c.ref / dT, 3)} <span class="dim">(${fmt(q, 1)} W/m²)</span></span>`; }); }
    $('results').innerHTML = `<div class="kv">${forced ? `<b>Reynolds</b><span>${fmt(c.U * c.ref / nu, 1)}</span>` : ''}${buoyant(c) ? `<b>Rayleigh</b><span>${fmt(rayleigh(c), 0)}</span>` : ''}${walls}<b>Time step</b><span>${fmt(f.dt)} s · ${f.steps.toLocaleString()} steps</span>
      ${hasBody ? `<b>Drag Cd</b><span>${last ? fmt(last.Cd) : '—'} <span class="dim">(mean ${fmt(mean('Cd'))})</span></span><b>Lift Cl</b><span>${last ? fmt(last.Cl) : '—'} <span class="dim">(mean ${fmt(mean('Cl'))})</span></span><b>Strouhal</b><span>${isFinite(St) ? fmt(St) : '<span class="dim">— (needs a few shed vortices)</span>'}</span>` : ''}
      ${f.heat && hasBody ? (() => { const hb = f.heatFromBodies(), dT = f.heat.Tbody - f.heat.Tin, o = c.obstacle; const Nu = o && o.type === 'circle' && !c.painted && dT ? hb.Q / (Math.PI * hb.k * dT) : NaN; return `<b>Heat from body</b><span>${fmt(hb.Q, 2)} W per m of depth</span>${isFinite(Nu) ? `<b>Nusselt</b><span>${fmt(Nu, 2)} <span class="dim">(h = ${fmt(Nu * hb.k / c.ref, 1)} W/m²K)</span></span>` : ''}`; })() : ''}
      <b>Max speed</b><span>${fmt(maxSpeed())} m/s</span><b>Continuity</b><span>max |∇·u| ${fmt(f.divergence())} 1/s · ${f.cgIters} CG iterations</span>${probe}</div>`;
    $('st1').textContent = A.running ? 'Running…' : 'Paused'; $('st2').textContent = `${f.nx}×${f.ny} grid · dx ${fmt(f.dx)} m`; $('st3').textContent = A.tool ? { paint: 'Drawing obstacles', erase: 'Erasing obstacles', poly: 'Drawing a polygon' }[A.tool] : 'Click the flow to add a monitor point';
    drawChart();
  }
  function maxSpeed() { const f = A.f; let m = 0; for (let j = 1; j <= f.ny; j++) for (let i = 1; i <= f.nx; i++) { if (f.solid[j * f.W + i]) continue; const [u, v] = f.cellVel(i, j); m = Math.max(m, Math.hypot(u, v)); } return m; }
  function drawChart() {
    const cv = $('chart'), w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1; if (!w || !h) return; cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.scale(dpr, dpr); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.font = '11px Segoe UI';
    const L = 46, R = w - 10, T = 12, B = h - 22;
    const fa = v => !isFinite(v) ? '' : v === 0 ? '0' : Math.abs(v) < 0.01 || Math.abs(v) >= 1e5 ? v.toExponential(1) : String(+v.toPrecision(3));
    const axes = (x0, x1, y0, y1, xl, yl) => { g.strokeStyle = '#c5d5e8'; g.strokeRect(L, T, R - L, B - T); g.fillStyle = '#5b6b7c'; g.textAlign = 'right'; g.fillText(fa(y1), L - 4, T + 8); g.fillText(fa(y0), L - 4, B); g.textAlign = 'center'; g.fillText(xl, (L + R) / 2, h - 6); g.textAlign = 'left'; g.fillText(fa(x0), L, h - 6); g.textAlign = 'right'; g.fillText(fa(x1), R, h - 6); g.save(); g.translate(10, (T + B) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(yl, 0, 0); g.restore(); };
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
        // scaled residuals (Fluent style): each series divided by its maximum over the first few records
        const S = [['rc', 'continuity', '#1c1c1c'], ['ru', 'x-velocity', '#c81e2a'], ['rv', 'y-velocity', '#2b8a3e'], ['rT', 'energy', '#2d78c4']].filter(([k]) => A.res0 && A.res0[k] > 0 && isFinite(hst[hst.length - 1][k]));
        const series = S.map(([k]) => hst.map(p => [p.t, Math.log10(Math.max(1e-14, p[k] / A.res0[k]))]));
        const ys = series.flat().map(p => p[1]); if (!ys.length) return;
        const y0 = Math.floor(Math.min(...ys)), y1 = Math.max(0.5, Math.ceil(Math.max(...ys)));
        axes(t0, t1, y0, y1, 'time (s)', 'log₁₀ scaled residual');
        g.strokeStyle = '#eef3f8'; for (let d = y0 + 1; d < y1; d++) { const Y = B - (B - T) * (d - y0) / (y1 - y0); g.beginPath(); g.moveTo(L + 1, Y); g.lineTo(R - 1, Y); g.stroke(); }
        series.forEach((s, n) => line(s, t0, t1, y0, y1, S[n][2]));
        let lx = L + 6; S.forEach(([, name, col]) => { g.fillStyle = col; g.textAlign = 'left'; g.fillText(name, lx, B - 6); lx += g.measureText(name).width + 10; });
      }
      return;
    }
    const f = A.f, c = A.cfg;
    const msg = (...lines) => { g.fillStyle = '#5b6b7c'; g.textAlign = 'center'; lines.forEach((s, i) => g.fillText(s, w / 2, h / 2 + (i - (lines.length - 1) / 2) * 16)); };
    if (A.chartTab === 'mon') {
      const P = c.probes || [], M = A.mon, q = A.monQty, [qn, qu] = MON_QTY[q];
      if (!P.length) return msg('Click the flow to add monitor points', `(up to ${MAX_MON}; click a point again to remove it).`);
      if (M.length < 4) return msg('Press Run — the monitor history appears here.');
      if (A.monView === 'time') {
        const t0 = M[0].t, t1 = M[M.length - 1].t, ys = M.flatMap(r => r.v.map(o => o[q])).filter(isFinite); if (!ys.length) return msg('No data for this quantity.');
        let y0 = Math.min(...ys), y1 = Math.max(...ys); if (y1 - y0 < 1e-12) { y0 -= 1e-6; y1 += 1e-6; }
        axes(t0, t1, y0, y1, 'time (s)', `${qn} (${qu})`);
        P.forEach((_, n) => line(M.map(r => [r.t, r.v[n] ? r.v[n][q] : NaN]).filter(p => isFinite(p[1])), t0, t1, y0, y1, MON_COLORS[n % MON_COLORS.length]));
      } else {
        const sp = monitorSpectra(); if (!sp.length) return msg('Not enough history for a spectrum yet.');
        const fmax = Math.min(...sp.map(s => s.freq[s.freq.length - 1])), fpk = Math.max(...sp.map(s => s.peak)), x1 = Math.min(fmax, Math.max(fpk * 4, sp[0].freq[8] || fmax)), amax = Math.max(...sp.map(s => s.peakAmp)) * 1.1 || 1;
        axes(0, x1, 0, amax, 'frequency (Hz)', `|${qn}| amplitude (${qu})`);
        sp.forEach((s, n) => { const pts = []; for (let k = 0; k < s.freq.length && s.freq[k] <= x1; k++) pts.push([s.freq[k], s.amp[k]]); line(pts, 0, x1, 0, amax, MON_COLORS[s.n % MON_COLORS.length]); void n; });
        const s0 = sp[0]; g.fillStyle = '#1c2b3a'; g.textAlign = 'right'; g.fillText(`peak ${fmt(s0.peak, 4)} Hz${f.sides.left.type === 'inlet' && c.U ? ` · St ${fmt(s0.peak * c.ref / c.U, 3)}` : ''}`, R - 6, T + 12);
      }
      return;
    }
    if (A.chartTab === 'cp') {
      const cp = cpData(); if (!cp || !cp.faces.length) return msg('No body in the flow.', 'Cp is plotted around obstacles once the flow runs.');
      if (!f.steps) return msg('Press Run — the surface pressure appears here.');
      const circ = !!cp.circle, X = fc => circ ? fc.theta : fc.xc, x1 = circ ? 180 : 1, cps = cp.faces.map(fc => fc.Cp), lo = Math.min(-1, ...cps), hi = Math.max(1, ...cps);
      // aerofoil convention: −Cp up (suction side on top); circles: Cp up
      const sg = circ ? 1 : -1, pad = 0.06 * (hi - lo), y0 = (sg > 0 ? lo : -hi) - pad, y1 = (sg > 0 ? hi : -lo) + pad;
      axes(0, x1, y0, y1, circ ? 'angle from the front stagnation point (°)' : 'x / c', circ ? 'Cp' : '−Cp');
      const Y0 = B - (B - T) * (0 - y0) / (y1 - y0); g.strokeStyle = '#dde6f0'; g.beginPath(); g.moveTo(L, Y0); g.lineTo(R, Y0); g.stroke();
      if (circ) { g.strokeStyle = '#adb5bd'; g.setLineDash([4, 3]); g.beginPath(); for (let a = 0; a <= 180; a += 3) { const X2 = L + (R - L) * a / 180, Y2 = B - (B - T) * (1 - 4 * Math.sin(a * Math.PI / 180) ** 2 - y0) / (y1 - y0); a ? g.lineTo(X2, Y2) : g.moveTo(X2, Y2); } g.stroke(); g.setLineDash([]); }
      [[true, '#c81e2a'], [false, '#2d78c4']].forEach(([up, col]) => { g.fillStyle = col; cp.faces.filter(fc => fc.upper === up).forEach(fc => { g.beginPath(); g.arc(L + (R - L) * X(fc) / x1, B - (B - T) * (sg * fc.Cp - y0) / (y1 - y0), 2.2, 0, 7); g.fill(); }); });
      g.textAlign = 'left'; g.fillStyle = '#c81e2a'; g.fillText('● upper', L + 6, T + 12); g.fillStyle = '#2d78c4'; g.fillText('● lower', L + 56, T + 12); if (circ) { g.fillStyle = '#868e96'; g.fillText('-- potential flow', L + 106, T + 12); }
      return;
    }
    // validation
    if (c.validation === 'dvd') {
      const Ra = rayleigh(c), refs = [[1e3, 1.118], [1e4, 2.243], [1e5, 4.519], [1e6, 8.8]], hot = ['left', 'right', 'bottom', 'top'].filter(k => f.sides[k].T != null), Ts = hot.map(k => f.sides[k].T);
      if (!(Ra > 0) || hot.length < 2) return msg('Keep buoyancy on with a hot and a cold wall', 'to compare with de Vahl Davis (1983).');
      const k = hot[Ts.indexOf(Math.max(...Ts))], dT = Math.max(...Ts) - Math.min(...Ts), Nu = f.wallGradient(k) * c.ref / dT;
      // reference Nu interpolated log–log between the benchmark Rayleigh numbers
      let Nref = NaN; for (let i = 0; i < refs.length - 1; i++) if (Ra >= refs[i][0] * 0.999 && Ra <= refs[i + 1][0] * 1.001) { const a = Math.log(Ra / refs[i][0]) / Math.log(refs[i + 1][0] / refs[i][0]); Nref = Math.exp(Math.log(refs[i][1]) + a * Math.log(refs[i + 1][1] / refs[i][1])); }
      // Nu vs Ra chart with the benchmark points, the current Ra highlighted
      const lx0 = 3, lx1 = 6, ly0 = 0, ly1 = 10, px = r => L + (R - L) * (Math.log10(r) - lx0) / (lx1 - lx0), py = n => B - (B - T) * (n - ly0) / (ly1 - ly0);
      axes(1e3, 1e6, ly0, ly1, 'Rayleigh number (log scale)', 'hot-wall Nu');
      g.strokeStyle = '#c81e2a'; g.setLineDash([4, 3]); g.beginPath(); refs.forEach(([r, n], i) => i ? g.lineTo(px(r), py(n)) : g.moveTo(px(r), py(n))); g.stroke(); g.setLineDash([]);
      g.fillStyle = '#c81e2a'; refs.forEach(([r, n]) => { g.beginPath(); g.arc(px(r), py(n), 3, 0, 7); g.fill(); });
      if (Ra >= 1e3 && Ra <= 1e6 && isFinite(Nu)) { g.fillStyle = '#3c7fb1'; g.beginPath(); g.arc(px(Ra), py(Nu), 5, 0, 7); g.fill(); }
      g.textAlign = 'left'; g.fillStyle = '#3c7fb1'; g.fillText(`● Lumen Flow: Nu ${fmt(Nu, 3)} at Ra ${fmt(Ra, 0)}`, L + 6, T + 12);
      g.fillStyle = '#c81e2a'; g.fillText(`● de Vahl Davis 1983${isFinite(Nref) ? `: ${fmt(Nref, 3)} (${fmt(100 * (Nu - Nref) / Nref, 1)}%)` : ''}`, L + 6, T + 26);
      if (c.sides.top !== 'wall' || c.sides.bottom !== 'wall' || Math.abs(c.Lx - c.Ly) > 1e-9 * c.Lx || f.solid.some(Boolean)) { g.fillStyle = '#a35a00'; g.fillText('Benchmark assumes a square box with insulated top & bottom.', L + 6, T + 40); }
    } else if (c.validation === 'ghia') {
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
    } else msg('Open the Lid-driven cavity, Channel or', 'Natural convection case to compare against', 'published / exact results.');
  }
  function monitorSpectra() {
    const M = A.mon, q = A.monQty, P = A.cfg.probes || []; if (M.length < 16) return [];
    const from = Math.floor(M.length * 0.4), out = [];   // skip the start-up transient
    P.forEach((_, n) => { const ts = [], vs = []; for (let i = from; i < M.length; i++) { const v = M[i].v[n] && M[i].v[n][q]; if (isFinite(v)) { ts.push(M[i].t); vs.push(v); } } const s = FA.spectrum(ts, vs); if (s) { s.n = n; out.push(s); } });
    return out;
  }
  function cpData() {
    const f = A.f, c = A.cfg; if (!f || !f.solid.some(Boolean)) return null; const o = c.obstacle, circle = o && o.type === 'circle' && !c.painted ? { x: o.x, y: o.y } : null;
    const U = c.U || 1, d = FA.surfaceCp(f, U, { circle }); d.circle = circle; return d;
  }
  function renderChartBar() {
    const bar = $('chartBar'); if (!bar) return;
    if (A.chartTab !== 'mon') { bar.innerHTML = ''; return; }
    const heat = !!(A.f && A.f.heat), qs = Object.keys(MON_QTY).filter(k => k !== 'T' || heat); if (!qs.includes(A.monQty)) A.monQty = 'v';
    bar.innerHTML = `<label>Show <select id="monQty">${qs.map(k => `<option value="${k}" ${k === A.monQty ? 'selected' : ''}>${MON_QTY[k][0]} (${MON_QTY[k][1]})</option>`).join('')}</select></label><span class="seg" id="monView"><span data-v="time" class="${A.monView === 'time' ? 'on' : ''}">Time</span><span data-v="fft" class="${A.monView === 'fft' ? 'on' : ''}">Spectrum (FFT)</span></span><span class="dim">${(A.cfg.probes || []).length}/${MAX_MON} points</span>`;
    $('monQty').onchange = e => { A.monQty = e.target.value; drawChart(); };
    bar.querySelectorAll('#monView span').forEach(s => s.onclick = () => { A.monView = s.dataset.v; renderChartBar(); drawChart(); });
  }

  // ---------- interaction: monitor points, painting, polygons ----------
  const TOOL_HINT = { paint: 'Drag on the flow to draw solid obstacles', erase: 'Drag on the flow to erase obstacles', poly: 'Click the corners of a polygon · double-click or Enter to finish · Esc cancels' };
  function setTool(t) {
    A.tool = A.tool === t ? null : t; if (A.tool !== 'poly') { A.poly = null; A.polyHover = null; }
    $('bPaint').classList.toggle('on', A.tool === 'paint'); $('bErase').classList.toggle('on', A.tool === 'erase'); $('bPoly').classList.toggle('on', A.tool === 'poly');
    $('hint').textContent = TOOL_HINT[A.tool] || 'Click the flow to add a monitor point'; if (A.f) { draw(); renderResults(); }
  }
  const evDom = e => { const r = $('cv').getBoundingClientRect(); return toDom(A.L, e.clientX - r.left, e.clientY - r.top); };
  const inDomain = ([x, y]) => x >= 0 && y >= 0 && x <= A.cfg.Lx && y <= A.cfg.Ly;
  function paintAt(e) {
    const [x, y] = evDom(e); if (!inDomain([x, y])) return;
    A.f.paint(x, y, Math.max(A.f.dx, A.f.dy) * 2.2, A.tool === 'paint');
    const f = A.f, s = new Uint8Array(f.nx * f.ny); for (let j = 1; j <= f.ny; j++) for (let i = 1; i <= f.nx; i++) s[(j - 1) * f.nx + i - 1] = f.solid[j * f.W + i];
    A.cfg.painted = Array.from(s); A.cfg.obstacle = null; draw();
  }
  // replace the body with polygons given in domain metres (drawn) or normalised and placed by the caller (imported)
  function setPolygonBody(polys, place) {
    const n = FA.normalizePolys(polys); if (!n) { Aero.alert('Polygon', 'The shape needs some width and height.'); return false; }
    const o = place ? { type: 'polygon', polys: n.polys, ...place } : { type: 'polygon', polys: n.polys, x: n.cx, y: n.cy, size: n.width, angle: 0 };
    A.cfg.obstacle = o; A.cfg.painted = null; A.cfg.ref = +o.size.toPrecision(4); setRun(false); Aero.setDirty(true); renderSetup(); build();
    if (!A.f.solid.some(Boolean)) Aero.toast('The shape is smaller than one grid cell — use more cells or a larger size.');
    return true;
  }
  function finishPoly() {
    const P = A.poly; A.poly = null; A.polyHover = null;
    if (!P || P.length < 3) { if (P) Aero.toast('A polygon needs at least 3 corners.'); draw(); return; }
    setPolygonBody([P]); Aero.toast(`Polygon body with ${P.length} corners`);
  }
  $('cv').addEventListener('pointerdown', e => {
    if (A.tool === 'poly') { const p = evDom(e); if (!inDomain(p)) return; if (e.detail >= 2) { finishPoly(); return; } (A.poly = A.poly || []).push(p); draw(); return; }
    if (A.tool) { $('cv').setPointerCapture(e.pointerId); paintAt(e); const mv = ev => paintAt(ev); const up = () => { $('cv').removeEventListener('pointermove', mv); $('cv').removeEventListener('pointerup', up); renderSetup(); Aero.setDirty(true); }; $('cv').addEventListener('pointermove', mv); $('cv').addEventListener('pointerup', up); return; }
    const [x, y] = evDom(e); if (!inDomain([x, y])) return;
    const P = A.cfg.probes || (A.cfg.probes = []), hit = P.findIndex(([px, py]) => Math.hypot((px - x) * A.L.s, (py - y) * A.L.s) < 9);
    if (hit >= 0) { P.splice(hit, 1); A.mon.forEach(r => r.v.splice(hit, 1)); Aero.toast(`Monitor point ${hit + 1} removed`); }
    else if (P.length >= MAX_MON) { Aero.toast(`At most ${MAX_MON} monitor points — click one to remove it.`); return; }
    else { P.push([+x.toPrecision(5), +y.toPrecision(5)]); A.mon.forEach(r => r.v.push({ u: NaN, v: NaN, speed: NaN, p: NaN, T: NaN })); if (A.chartTab !== 'mon') selectTab('mon'); }
    Aero.setDirty(true); renderChartBar(); draw(); renderResults();
  });
  $('cv').addEventListener('pointermove', e => { if (A.tool === 'poly' && A.poly) { A.polyHover = evDom(e); draw(); } });
  document.addEventListener('keydown', e => { if (A.tool !== 'poly' || /INPUT|SELECT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName)) return; if (e.key === 'Enter') { e.preventDefault(); finishPoly(); } else if (e.key === 'Escape') { A.poly = null; A.polyHover = null; draw(); } else if (e.key === 'Backspace' && A.poly) { e.preventDefault(); A.poly.pop(); draw(); } });
  function selectTab(id) { A.chartTab = id; document.querySelectorAll('#ctabs .aero-tab').forEach(x => x.classList.toggle('on', x.dataset.c === id)); renderChartBar(); drawChart(); }
  async function importShape() {
    const files = await Aero.openFile({ accept: '.svg,.txt,.csv,.dat', filters: [{ name: 'Shape (SVG, or x y text)', extensions: ['svg', 'txt', 'csv', 'dat'] }] }); const fl = files && files[0]; if (!fl) return;
    const text = typeof fl.data === 'string' ? fl.data : new TextDecoder().decode(fl.data);
    const polys = /<svg[\s>]/i.test(text) ? FA.parseSVG(text) : FA.parsePolygonText(text);
    if (!polys) { Aero.alert('Import shape', `No closed shapes found in ${fl.name}. Use an SVG with paths/polygons, or a text file with one “x, y” pair per line (e.g. an airfoil .dat).`); return; }
    placeShape(polys, fl.name);
  }
  function enterPolygon() {
    const c = A.cfg, P = (fx, fy) => `${+(c.Lx * fx).toPrecision(3)}, ${+(c.Ly * fy).toPrecision(3)}`, ex = [P(0.2, 0.4), P(0.3, 0.5), P(0.2, 0.6)].join('\n');
    Aero.dialog({ title: 'Polygon obstacle', instruction: 'Corner coordinates in metres, one “x, y” pair per line. A blank line starts another polygon (holes use the even–odd rule).',
      fields: [{ key: 'pts', label: 'Corners', type: 'textarea', value: ex, mono: true }],
      onOK: v => { const Q = FA.parsePolygonText(v.pts); if (!Q) { Aero.alert('Polygon', 'Enter at least three “x, y” pairs.'); return false; } setPolygonBody(Q); } });
  }
  function placeShape(polys, name) {
    const n = FA.normalizePolys(polys); if (!n) { Aero.alert('Import shape', 'The shape has no area.'); return; }
    const c = A.cfg, w = Math.min(c.Lx * 0.2, c.Ly * 0.4 / n.aspect);
    Aero.dialog({ title: 'Place ' + name, instruction: `${polys.length} closed shape${polys.length > 1 ? 's' : ''}, ${polys.reduce((s, P) => s + P.length, 0)} points, height/width ${fmt(n.aspect, 3)}. Where should it sit in the ${c.Lx} × ${c.Ly} m domain?`,
      fields: [{ key: 'x', label: 'Centre x (m)', type: 'number', value: +(c.Lx * 0.25).toPrecision(3), step: 'any' }, { key: 'y', label: 'Centre y (m)', type: 'number', value: +(c.Ly / 2).toPrecision(3), step: 'any' }, { key: 'size', label: 'Width (m)', type: 'number', value: +w.toPrecision(3), step: 'any' }, { key: 'angle', label: 'Angle (°, nose up)', type: 'number', value: 0, step: 'any' }],
      onOK: v => { const p = { x: +v.x, y: +v.y, size: +v.size, angle: +v.angle || 0 }; if (![p.x, p.y, p.size].every(isFinite) || p.size <= 0) { Aero.alert('Place shape', 'Enter a positive width and a finite position.'); return false; } setPolygonBody(polys, p); } });
  }

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
  const histCSV = () => 't_s,Cd,Cl,max_div,cg_iterations,res_continuity,res_x_velocity,res_y_velocity,res_energy\n' + A.hist.map(p => [p.t, p.Cd, p.Cl, p.div, p.cg, p.rc, p.ru, p.rv, isFinite(p.rT) ? p.rT : ''].join(',')).join('\n') + '\n';
  function monCSV() {
    const P = A.cfg.probes || [], heat = !!A.f.heat, head = ['t_s']; P.forEach((q, n) => head.push(`u${n + 1}_m_s`, `v${n + 1}_m_s`, `p${n + 1}_Pa`, ...(heat ? [`T${n + 1}_C`] : [])));
    const pos = '# monitor points (x, y in m): ' + P.map(([x, y], n) => `${n + 1}=(${x}, ${y})`).join('; ');
    return pos + '\n' + head.join(',') + '\n' + A.mon.map(r => [r.t, ...r.v.flatMap(o => [o.u, o.v, o.p, ...(heat ? [o.T] : [])])].join(',')).join('\n') + '\n';
  }
  function cpCSV() {
    const d = cpData(); if (!d) return null;
    return `# Cp = (p - p_inf) / (0.5 rho U^2), U = ${A.cfg.U} m/s, p_inf = ${fmt(d.pinf * A.f.rho, 6)} Pa (inlet mean), chord ${fmt(d.chord, 6)} m\nx_m,y_m,x_over_c,${d.circle ? 'theta_deg,' : ''}surface,normal_x,normal_y,Cp\n` +
      d.faces.slice().sort((a, b) => (a.upper === b.upper ? 0 : a.upper ? -1 : 1) || (d.circle ? a.theta - b.theta : a.xc - b.xc)).map(fc => [fc.x.toFixed(6), fc.y.toFixed(6), fc.xc.toFixed(5), ...(d.circle ? [fc.theta.toFixed(2)] : []), fc.upper ? 'upper' : 'lower', fc.nx, fc.ny, fc.Cp.toFixed(5)].join(',')).join('\n') + '\n';
  }
  const csvOut = (suffix, data) => data ? Aero.saveFile({ name: A.docName + suffix, data, filters: [{ name: 'CSV', extensions: ['csv'] }] }) : Aero.alert('Nothing to export', 'This case has no body in the flow.');
  // record an animated GIF: advance the simulation, grabbing the view every few steps
  function gifDialog() {
    Aero.dialog({ title: 'Export animation (.gif)', instruction: 'The simulation runs on from where it is now and the view is captured every few steps (what you see: field, streamlines, arrows, monitor points).',
      fields: [{ key: 'frames', label: 'Frames', type: 'number', value: 60, min: 2, max: 400, step: 1 }, { key: 'every', label: 'Steps between frames', type: 'number', value: 25, min: 1, max: 5000, step: 1 },
        { key: 'width', label: 'Width (px)', type: 'select', value: '640', options: [['400', '400'], ['640', '640'], ['800', '800'], ['1000', '1000']] }, { key: 'fps', label: 'Playback (frames/s)', type: 'select', value: '15', options: [['10', '10'], ['15', '15'], ['20', '20'], ['25', '25']] }],
      ok: 'Record', onOK: v => recordGIF({ frames: Math.round(Aero.clamp(+v.frames || 60, 2, 400)), every: Math.round(Aero.clamp(+v.every || 25, 1, 5000)), width: +v.width || 640, fps: +v.fps || 15 }) });
  }
  async function recordGIF({ frames, every, width, fps }, save = true) {
    setRun(false); const cv = $('cv'), w = Math.min(width, cv.width), h = Math.round(w * cv.height / cv.width), tmp = document.createElement('canvas'); tmp.width = w; tmp.height = h;
    const tg = tmp.getContext('2d', { willReadFrequently: true }), shots = []; A.recording = true;
    try {
      for (let n = 0; n < frames; n++) {
        if (n) for (let k = 0; k < every; k++) { A.f.step(); record(); if (!isFinite(A.f.umax)) throw new Error('The solution blew up while recording.'); }
        draw(); tg.drawImage(cv, 0, 0, w, h); shots.push(tg.getImageData(0, 0, w, h));
        Aero.busy(`Recording frame ${n + 1} of ${frames}…`); await new Promise(r => setTimeout(r, 0));
      }
      Aero.busy('Encoding GIF…'); await new Promise(r => setTimeout(r, 0));
      const bytes = FG.encodeGIF(shots, { delay: Math.round(100 / fps) }); Aero.busy(); renderResults(); A.lastGIF = bytes;
      if (save) await Aero.saveFile({ name: A.docName + '.gif', data: bytes, filters: [{ name: 'GIF animation', extensions: ['gif'] }] });
      return bytes;
    } catch (e) { Aero.busy(); Aero.alert('Animation', e.message); return null; } finally { A.recording = false; }
  }
  // ---------- case files (untrusted: every field is checked) ----------
  function sanitizeCfg(c) {
    if (!c || typeof c !== 'object') throw new Error('Not a Lumen Flow case.');
    const num = (v, lo, hi, d) => { v = +v; return isFinite(v) && v >= lo && v <= hi ? v : d; }, SIDES = ['inlet', 'outlet', 'wall', 'slip', 'moving'];
    const o = { name: String(c.name || '').slice(0, 200), note: String(c.note || '').slice(0, 2000), Lx: num(c.Lx, 1e-6, 1e6, 1), Ly: num(c.Ly, 1e-6, 1e6, 1), nx: Math.round(num(c.nx, 8, 400, 120)),
      fluid: FC.FLUIDS[c.fluid] ? c.fluid : 'water', U: num(c.U, 0, 1e6, 0.01), ref: num(c.ref, 1e-9, 1e6, 0.02), field: ['speed', 'p', 'vort', 'dye', 'T', 'u', 'v'].includes(c.field) ? c.field : 'speed',
      validation: ['ghia', 'poiseuille', 'dvd'].includes(c.validation) ? c.validation : undefined, sides: {} };
    if (o.fluid === 'custom') { o.nu = num(c.nu, 1e-12, 1e6, 1e-6); o.rho = num(c.rho, 1e-9, 1e9, 1000); o.Pr = num(c.Pr, 1e-6, 1e8, 1); o.cp = num(c.cp, 1e-6, 1e9, 1000); o.beta = num(c.beta, 0, 10, 1e-3); }
    for (const k of ['left', 'right', 'top', 'bottom']) o.sides[k] = SIDES.includes(c.sides && c.sides[k]) ? c.sides[k] : 'wall';
    const b = c.obstacle;
    if (b && typeof b === 'object' && ['circle', 'square', 'plate', 'naca', 'rect', 'polygon'].includes(b.type)) {
      o.obstacle = { type: b.type, x: num(b.x, -1e6, 1e6, 0), y: num(b.y, -1e6, 1e6, 0), size: num(b.size, 0, 1e6, 0.02), angle: num(b.angle, -360, 360, 0), w: num(b.w, 0, 1e6, 0), h: num(b.h, 0, 1e6, 0) };
      if (b.type === 'naca') o.obstacle.code = /^\d{4}$/.test(b.code) ? b.code : '0012';
      const polys = b.polys != null ? FA.sanitizePolys(b.polys) : null; if (polys) o.obstacle.polys = polys; else if (b.type === 'polygon') o.obstacle = null;
    } else o.obstacle = null;
    const ny = Math.max(8, Math.round(o.nx * o.Ly / o.Lx));
    if (Array.isArray(c.painted) && c.painted.length === o.nx * ny) o.painted = c.painted.map(v => v === 1 ? 1 : 0);
    if (c.heat && typeof c.heat === 'object') { const H = c.heat; o.heat = { on: !!H.on, Tin: num(H.Tin, -273.15, 1e5, 20), Tbody: num(H.Tbody, -273.15, 1e5, 60), buoy: !!H.buoy, g: num(H.g, 0, 1e4, 9.81), sideT: {} }; if (H.sideT && typeof H.sideT === 'object') for (const k of ['left', 'right', 'top', 'bottom']) { const v = H.sideT[k]; if (v != null && v !== '' && isFinite(+v)) o.heat.sideT[k] = +v; } }
    o.probes = Array.isArray(c.probes) ? c.probes.filter(p => Array.isArray(p) && isFinite(+p[0]) && isFinite(+p[1]) && +p[0] >= 0 && +p[1] >= 0 && +p[0] <= o.Lx && +p[1] <= o.Ly).slice(0, MAX_MON).map(p => [+p[0], +p[1]]) : [];
    return o;
  }
  async function save() { const p = await Aero.saveFile({ name: A.docName + '.lflow', data: JSON.stringify({ format: 'lumen-flow', version: 2, cfg: A.cfg }), filters: [{ name: 'Lumen Flow case', extensions: ['lflow'] }] }); if (p) { Aero.setDoc(A.docName, false); return true; } return false; }
  async function openFiles(files) {
    const f = files[0]; if (!f) return;
    if (/\.(svg|dat)$/i.test(f.name)) { const text = typeof f.data === 'string' ? f.data : new TextDecoder().decode(f.data), polys = /<svg[\s>]/i.test(text) ? FA.parseSVG(text) : FA.parsePolygonText(text); if (polys) placeShape(polys, f.name); else Aero.alert('Import shape', 'No closed shapes found in ' + f.name + '.'); return; }
    try { const j = JSON.parse(typeof f.data === 'string' ? f.data : new TextDecoder().decode(f.data)); if (!j || !j.cfg) throw new Error('Not a Lumen Flow case.'); A.cfg = sanitizeCfg(j.cfg); A.docName = f.name.replace(/\.[^.]+$/, ''); setRun(false); renderSetup(); build(); Aero.setDoc(A.docName, false); } catch (e) { Aero.alert('Couldn’t open ' + f.name, e.message); }
  }
  function shortcuts() {
    const rows = [['Space', 'Run / pause'], ['S', 'One time step'], ['Ctrl+R', 'Reset the flow'], ['Ctrl+O / Ctrl+S', 'Open / save case'], ['D / E', 'Draw / erase obstacles'], ['P', 'Polygon tool'], ['Enter / double-click', 'Finish the polygon'], ['Backspace', 'Remove the last polygon corner'], ['Esc', 'Cancel the polygon'], ['Ctrl+Shift+G', 'Export animation (.gif)'], ['Click on the flow', 'Add / remove a monitor point']];
    Aero.dialog({ title: 'Keyboard shortcuts', noCancel: true, html: `<table style="border-collapse:collapse;font-size:12px">${rows.map(([k, d]) => `<tr><td style="padding:2px 14px 2px 0;white-space:nowrap"><b>${esc(k)}</b></td><td>${esc(d)}</td></tr>`).join('')}</table>` });
  }
  const oneStep = () => { A.f.step(); record(); draw(); renderResults(); };

  // ---------- wiring ----------
  Aero.init({ name: 'Lumen Flow', icon: '../kit/icons/flow.png', doc: 'Untitled', onDropFiles: openFiles, dropText: 'Drop a .lflow case, or an .svg / .dat shape', onSave: save,
    menus: {
      File: [['Open case…', 'Ctrl+O', async () => openFiles(await Aero.openFile({ accept: '.lflow,.json', filters: [{ name: 'Lumen Flow case', extensions: ['lflow'] }] }))], ['Save case…', 'Ctrl+S', save], '-', '#Export results',
        ['Fields (.csv)…', '', () => Aero.saveFile({ name: A.docName + '-fields.csv', data: fieldsCSV(), filters: [{ name: 'CSV', extensions: ['csv'] }] })], ['ParaView (.vtk)…', '', () => Aero.saveFile({ name: A.docName + '.vtk', data: vtk(), filters: [{ name: 'VTK', extensions: ['vtk'] }] })],
        ['History: forces & residuals (.csv)…', '', () => csvOut('-history.csv', histCSV())], ['Monitor points (.csv)…', '', () => (A.cfg.probes || []).length ? csvOut('-monitors.csv', monCSV()) : Aero.alert('No monitor points', 'Click the flow to add monitor points, then run.')],
        ['Surface Cp (.csv)…', '', () => csvOut('-cp.csv', cpCSV())],
        ['Picture (.png)…', '', async () => { const b = await new Promise(r => $('cv').toBlob(r, 'image/png')); Aero.saveFile({ name: A.docName + '.png', data: b, filters: [{ name: 'PNG', extensions: ['png'] }] }); }], ['Animation (.gif)…', 'Ctrl+Shift+G', gifDialog]],
      Run: [['Run / pause', 'Space', () => setRun(!A.running)], ['One step', 'S', oneStep], ['Reset', 'Ctrl+R', () => { setRun(false); build(); }]],
      Body: [{ label: 'Draw freehand', key: 'D', fn: () => setTool('paint'), checked: () => A.tool === 'paint' }, { label: 'Erase', key: 'E', fn: () => setTool('erase'), checked: () => A.tool === 'erase' }, { label: 'Draw polygon', key: 'P', fn: () => setTool('poly'), checked: () => A.tool === 'poly' }, '-',
        ['Polygon from coordinates…', '', enterPolygon], ['Import shape (.svg, .dat)…', '', importShape], '-', ['Remove body', '', () => { A.cfg.obstacle = null; A.cfg.painted = null; setRun(false); Aero.setDirty(true); renderSetup(); build(); }]],
      Monitors: [['Show monitor chart', '', () => selectTab('mon')], ['Show surface Cp', '', () => selectTab('cp')], ['Show residuals', '', () => selectTab('conv')], '-', ['Clear monitor points', '', () => { A.cfg.probes = []; A.mon = []; Aero.setDirty(true); renderChartBar(); draw(); renderResults(); }]],
      Cases: Object.entries(FC.CASES).map(([k, c]) => [c.name, '', () => { $('caseSel').value = k; loadCase(k); }]),
      Help: [['Keyboard shortcuts', 'F1', shortcuts], ['About the solver', '', () => Aero.alert('About Lumen Flow',
        'Lumen Flow solves the 2D incompressible Navier–Stokes equations on a staggered grid with the projection method of Griebel et al. (NaSt2D): blended central/upwind advection, explicit viscosity, and a pressure Poisson equation solved by conjugate gradients with an incomplete-Cholesky preconditioner.\n\nIt is checked against the lid-driven cavity benchmark of Ghia, Ghia & Shin (1982) at Re = 100 (RMS error 0.0025 on the centre line) and the exact Poiseuille channel profile — see the Validation tab.\n\nHeat: temperature is carried by the flow and diffuses with α = ν/Pr; bodies and walls can be held at fixed temperatures. A heated cylinder at Re = 40 matches the Churchill–Bernstein Nusselt correlation. With buoyancy on, the Boussinesq approximation drives natural convection; the heated-cavity benchmark of de Vahl Davis (1983) is matched within 0.3% (Ra = 10³) and 1.2% (Ra = 10⁴) in Nusselt number.\n\nMonitor points record u, v, p and T over time with an FFT spectrum; Cp is sampled on every body face; residuals are scaled the way Fluent scales them.\n\nLimits: 2D, laminar, constant density apart from the Boussinesq buoyancy term, uniform grid with stair-stepped bodies. There is no turbulence model, compressibility or 3D, so results at high Reynolds or Rayleigh numbers are qualitative. Use it to learn and explore — use OpenFOAM, SU2 or Fluent for engineering sign-off.')]],
    } });
  Object.entries(FC.CASES).forEach(([k, c]) => $('caseSel').add(new Option(c.name, k)));
  $('caseSel').onchange = () => loadCase($('caseSel').value);
  $('bRun').onclick = () => setRun(!A.running); $('bStep').onclick = oneStep; $('bReset').onclick = () => { setRun(false); build(); };
  $('field').onchange = draw; $('stream').onchange = draw; $('vecs').onchange = draw;
  $('bPaint').onclick = () => setTool('paint'); $('bErase').onclick = () => setTool('erase'); $('bPoly').onclick = () => setTool('poly');
  document.querySelectorAll('#ctabs .aero-tab').forEach(t => t.onclick = () => selectTab(t.dataset.c));
  new ResizeObserver(() => { if (A.f) { draw(); drawChart(); } }).observe($('stage'));
  Object.assign(A, { record, recordGIF, sanitizeCfg, openFiles, setPolygonBody, placeShape, selectTab, monCSV, cpCSV, histCSV, cpData, monitorSpectra, loadCase, setTool, finishPoly });   // for scripted tests
  setTool(null);
  loadCase('cylinder');
})();
