// Lumen Stress — linear static and modal structural FEA in the spirit of Ansys Mechanical (for learning and design checks).
(function () {
  const S = window.StressStudy, G = window.StressGeom, VX = window.StressVoxel, V = window.StressView, R = window.StressReport, M2 = window.StressMesh2D;
  const $ = id => document.getElementById(id), esc = s => Aero.esc(String(s ?? ''));
  const A = window.StressApp = { doc: S.newDoc('2d'), mesh: null, meshKey: '', run: null, tree: 'geometry', sel: new Set(), hover: null, tool: 'select', result: 'vm', deform: 'auto', bands: 9, showMesh: false, modeIdx: 0, probes: [], anim: null, draft: null, filePath: null, solving: false };
  const fmt = (v, d = 4) => !Number.isFinite(v) ? '—' : v === 0 ? '0' : (Math.abs(v) >= 1e5 || Math.abs(v) < 1e-3) ? v.toExponential(3) : (+v.toPrecision(d)).toString();
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const BC_COLOR = { fixed: '#3a5fd9', roller: '#1f9fc4', disp: '#7048e8', force: '#e03131', bearing: '#d9480f', pressure: '#c2255c', gravity: '#c99a06', rotation: '#e8590c' };
  const isSupport = k => k === 'fixed' || k === 'roller' || k === 'disp';
  const is3 = () => A.doc.study.kind === '3d';
  const MODEL_NAME = { stress: 'Plane stress', strain: 'Plane strain', axi: 'Axisymmetric' };

  // ---------- history ----------
  const hist = new Aero.History({ max: 120 });
  const snapState = () => ({ json: JSON.stringify(A.doc, (k, v) => k === 'solid' || k === '_seg' ? undefined : v), solid: A.doc.solid, seg: A.doc._seg });
  function restore(st) { if (!st) return; const d = JSON.parse(st.json); d.solid = st.solid || null; d._seg = st.seg; A.doc = d; afterChange(); }
  function commit(label, fn) { fn(A.doc); hist.push(label, snapState()); afterChange(); }
  function load(doc, name, path) {
    doc.bcs.forEach(b => { if (!Array.isArray(b.targets)) b.targets = []; if (b.on === undefined) b.on = true; });
    stopAnim(); A.doc = doc; A.doc.name = name || doc.name || 'Untitled'; A.filePath = path || null; A.sel.clear(); A.probes = []; A.mesh = null; A.meshKey = ''; A.run = null; A.tree = 'geometry'; A.draft = null;
    hist.reset('Open', snapState()); Aero.setDoc(A.doc.name, false); afterChange(true);
  }
  const solidIds = new WeakMap(); let solidN = 0;
  function meshKeyOf(d) { if (d.solid && !solidIds.has(d.solid)) solidIds.set(d.solid, ++solidN); return JSON.stringify([d.study.kind, d.study.model === 'axi', d.study.kind === '3d' ? solidIds.get(d.solid) : d.shapes, d.mesh.size, d.mesh.grade, d.mesh.minAngle, d.mesh.refine, d.study.kind === '3d' ? d.mesh.target : 0]); }
  function afterChange(fit) {
    const d = A.doc;
    if (d.solid && !d._seg) d._seg = VX.segmentFaces(d.solid.tris);
    const key = meshKeyOf(d); if (key !== A.meshKey) { A.mesh = null; A.meshKey = key; }
    A.run = null; A.probes = []; stopAnim();
    if (A.tree.startsWith('shape:') && !d.shapes.some(s => 'shape:' + s.id === A.tree)) A.tree = 'geometry';
    if (A.tree.startsWith('bc:') && !d.bcs.some(b => 'bc:' + b.id === A.tree)) A.tree = 'analysis';
    V.setMode(is3() ? '3d' : '2d'); syncTools();
    renderAll(); if (fit) setTimeout(fitView, 0);
  }

  // ---------- results helpers ----------
  function fields() {
    const r = A.run; if (!r) return [];
    if (r.res.modes) return r.res.modes.map((m, i) => ({ key: 'mode' + i, label: `Mode ${i + 1} — ${fmt(m.f, 5)} Hz` }));
    const axi = !is3() && A.doc.study.model === 'axi', c3 = is3();
    const L = [['umag', 'Total deformation'], ['ux', axi ? 'Radial deformation' : 'Directional deformation X'], ['uy', axi ? 'Axial deformation' : 'Directional deformation Y']];
    if (c3) L.push(['uz', 'Directional deformation Z']);
    L.push(['vm', 'Equivalent (von Mises) stress'], ['s1', 'Maximum principal stress'], ['s3', 'Minimum principal stress'], ['tau', 'Maximum shear stress'], ['sf', 'Safety factor (yield)']);
    if (c3) L.push(['c0', 'Normal stress X'], ['c1', 'Normal stress Y'], ['c2', 'Normal stress Z'], ['c3', 'Shear stress XY'], ['c4', 'Shear stress YZ'], ['c5', 'Shear stress ZX']);
    else if (axi) L.push(['c0', 'Radial stress'], ['c1', 'Axial stress'], ['c3', 'Hoop stress'], ['c2', 'Shear stress RZ']);
    else { L.push(['c0', 'Normal stress X'], ['c1', 'Normal stress Y'], ['c2', 'Shear stress XY']); if (A.doc.study.model === 'strain') L.push(['c3', 'Normal stress Z (out of plane)']); }
    return L.map(([key, label]) => ({ key, label }));
  }
  function field(key = A.result) {
    const r = A.run; if (!r) return null; const res = r.res, dim = is3() ? 3 : 2, nn = A.mesh.nodes.length / dim;
    if (key.startsWith('mode')) { const m = res.modes[+key.slice(4)] || res.modes[0], v = new Float64Array(nn); for (let n = 0; n < nn; n++) { let s = 0; for (let c = 0; c < dim; c++) s += m.u[n * dim + c] ** 2; v[n] = Math.sqrt(s); } return { v, unit: '(normalised)', u: m.u, label: fields().find(f => f.key === key)?.label || 'Mode' }; }
    const lab = fields().find(f => f.key === key)?.label || key;
    if (key === 'umag') return { v: res.umag, unit: 'mm', label: lab };
    if (key === 'ux' || key === 'uy' || key === 'uz') { const c = { ux: 0, uy: 1, uz: 2 }[key], v = new Float64Array(nn); for (let n = 0; n < nn; n++) v[n] = res.u[n * dim + c]; return { v, unit: 'mm', label: lab }; }
    if (key === 'sf') return { v: res.sf, unit: '', label: lab, reverse: true, cap: S.SF_CAP };
    if (key[0] === 'c') { const c = +key.slice(1), v = new Float64Array(nn); for (let n = 0; n < nn; n++) v[n] = res.stress[n * res.ns + c]; return { v, unit: 'MPa', label: lab }; }
    return { v: res[key], unit: 'MPa', label: lab };
  }
  function modelSize() { if (is3()) return A.doc.solid ? VX.bbox(A.doc.solid.tris).diag : 100; const b = G.bounds(A.doc.shapes); return Math.hypot(b.w, b.h) || 100; }
  function deformScale() {
    if (!A.run || A.deform === '0') return 0; if (A.deform === '1') return 1;
    const f = field(), u = A.run.res.modes ? f.u : A.run.res.u; let mx = 0; for (let i = 0; i < u.length; i++) mx = Math.max(mx, Math.abs(u[i]));
    const auto = mx > 0 ? 0.05 * modelSize() / mx : 0; return auto * ({ half: 0.5, auto: 1, x2: 2, x5: 5 }[A.deform] || 1);
  }
  function range(f) { let lo = Infinity, hi = -Infinity, klo = 0, khi = 0; for (let i = 0; i < f.v.length; i++) { const x = f.v[i]; if (x < lo) { lo = x; klo = i; } if (x > hi) { hi = x; khi = i; } } if (lo === hi) { hi = lo + (Math.abs(lo) * 1e-6 || 1e-9); } return { lo, hi, klo, khi }; }

  // ---------- scene ----------
  let curScale = 0;
  function refreshScene() {
    const d = A.doc;
    if (is3()) {
      const seg = d._seg;
      if (A.run) {
        const f = field(), rg = range(f), sc = deformScale(); curScale = sc;
        V.showField(A.mesh, { u: A.run.res.modes ? f.u : A.run.res.u, scale: sc, values: f.v, range: [rg.lo, rg.hi], bands: A.bands, reverse: f.reverse, edges: A.showMesh });
        V.showExtras(seg ? seg.featureEdges : null); V.setSTLVisible(false);
      } else if (A.mesh && (A.tree === 'mesh' || A.showMesh)) { V.showField(A.mesh, { edges: true, color: 0xa9bccf }); V.showExtras(null); V.setSTLVisible(false); }
      else if (d.solid) { V.showField({ kind: 'H8', nodes: new Float64Array(0), quads: { n: new Int32Array(0) } }, {}); V.showExtras(null); V.showSTL(d.solid.tris, seg.face, faceColor, seg.featureEdges); V.setSTLVisible(true); }
      else V.clear();
    } else {
      V.showExtras(null); V.setSTLVisible(false);
      if (A.run) { const f = field(), rg = range(f), sc = deformScale(); curScale = sc; V.showField(A.mesh, { u: A.run.res.modes ? f.u : A.run.res.u, scale: sc, values: f.v, range: [rg.lo, rg.hi], bands: A.bands, reverse: f.reverse, edges: A.showMesh }); }
      else if (A.mesh) V.showField(A.mesh, { edges: true });
      else V.showField({ kind: 'T6', nodes: new Float64Array(0), elems: new Int32Array(0) }, {});
    }
    V.need = true;
  }
  function bcOfTarget(t) { for (let i = A.doc.bcs.length - 1; i >= 0; i--) { const b = A.doc.bcs[i]; if (b.on !== false && b.targets && b.targets.includes(t)) return b; } return null; }
  const hex = h => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
  function faceColor(fid) {
    const t = 'f' + fid;
    if (A.sel.has(t)) return [1, 0.72, 0.28];
    const cur = A.tree.startsWith('bc:') ? A.doc.bcs.find(b => 'bc:' + b.id === A.tree) : null;
    if (cur && cur.targets.includes(t)) return hex(BC_COLOR[cur.kind]);
    const b = bcOfTarget(t); if (b && !cur) return hex(BC_COLOR[b.kind]).map(c => 0.45 * c + 0.55 * 0.78);
    return [0.74, 0.79, 0.85];
  }

  // ---------- overlay ----------
  function edgeList() { return G.allEdges(A.doc.shapes); }
  function strokeEdge(x, e, n = 48) {
    const L = G.edgeLength(e), k = e.type === 'arc' ? Math.max(8, Math.ceil(Math.abs(e.da) / (Math.PI / 48))) : 1;
    for (let i = 0; i <= k; i++) { const p = G.edgePoint(e, i / k), [sx, sy] = V.toScreen(p[0], p[1]); i ? x.lineTo(sx, sy) : x.moveTo(sx, sy); }
  }
  function drawOverlay(x) {
    if (is3()) return drawOverlay3D(x);
    const d = A.doc, E = edgeList(), results = !!A.run;
    // filled region before meshing
    if (!A.mesh && !results && d.shapes.length) {
      x.beginPath(); d.shapes.forEach(s => { const P = G.shapePolyline(s, Infinity, Math.PI / 60); P.forEach((p, i) => { const q = V.toScreen(p[0], p[1]); i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]); }); x.closePath(); });
      const g = x.createLinearGradient(0, 0, 0, V.H); g.addColorStop(0, '#d5dfeb'); g.addColorStop(1, '#bccbdb'); x.fillStyle = g; x.fill('evenodd');
    }
    // axis of symmetry for axisymmetric studies
    if (d.study.model === 'axi') { const [ax] = V.toScreen(0, 0); x.save(); x.setLineDash([14, 4, 3, 4]); x.strokeStyle = '#8a5a00'; x.lineWidth = 1; x.beginPath(); x.moveTo(ax, 0); x.lineTo(ax, V.H); x.stroke(); x.restore(); x.fillStyle = '#8a5a00'; x.font = '11px Segoe UI, sans-serif'; x.fillText('axis of symmetry (r = 0)', ax + 5, V.H - 90); }
    // outlines
    const curBC = A.tree.startsWith('bc:') ? d.bcs.find(b => 'bc:' + b.id === A.tree) : null;
    for (const ed of E) {
      x.beginPath(); strokeEdge(x, ed.e);
      const sel = A.sel.has(ed.id), hov = A.hover === ed.id, inBC = curBC && curBC.targets.includes(ed.id);
      x.lineWidth = sel || inBC ? 4 : hov ? 3 : results ? 1 : 1.6;
      x.strokeStyle = sel ? '#ff9d1c' : inBC ? BC_COLOR[curBC.kind] : hov ? '#ffbf66' : results ? (curScale ? 'rgba(40,55,75,0.35)' : 'rgba(20,30,45,0.6)') : '#20344d';
      if (results && curScale && !sel && !hov) x.setLineDash([5, 4]); x.stroke(); x.setLineDash([]);
    }
    // polygon vertices of the selected shape
    const shSel = A.tree.startsWith('shape:') ? d.shapes.find(s => 'shape:' + s.id === A.tree) : null;
    if (shSel && !results) { x.fillStyle = '#fff'; x.strokeStyle = '#1f6fd1'; vertsOf(shSel).forEach(p => { const [sx, sy] = V.toScreen(p[0], p[1]); x.beginPath(); x.rect(sx - 3.5, sy - 3.5, 7, 7); x.fill(); x.stroke(); }); }
    if (!results || curBC) drawBCs2D(x, E);
    drawDraft(x);
    if (results) { drawLegend(x); drawMinMax(x); drawProbes(x); } else drawBCLegend(x);
    drawTriad2D(x); drawScaleBar(x);
  }
  function vertsOf(s) { if (s.kind === 'poly') return s.pts.map(p => [p[0], p[1]]); if (s.kind === 'rect') return [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]]; return [[s.cx, s.cy], [s.cx + s.r, s.cy]]; }
  function arrow(x, x0, y0, x1, y1, col, w = 1.6) {
    const a = Math.atan2(y1 - y0, x1 - x0), h = 7; x.strokeStyle = x.fillStyle = col; x.lineWidth = w;
    x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1 - Math.cos(a) * h * 0.8, y1 - Math.sin(a) * h * 0.8); x.stroke();
    x.beginPath(); x.moveTo(x1, y1); x.lineTo(x1 - h * Math.cos(a - 0.38), y1 - h * Math.sin(a - 0.38)); x.lineTo(x1 - h * Math.cos(a + 0.38), y1 - h * Math.sin(a + 0.38)); x.closePath(); x.fill();
  }
  function tag(x, sx, sy, letter, col, text) {
    x.font = '600 11px Segoe UI, sans-serif'; const w = 16 + (text ? x.measureText(text).width + 8 : 0);
    x.fillStyle = 'rgba(255,255,255,0.92)'; x.strokeStyle = col; x.lineWidth = 1; x.beginPath(); x.roundRect(sx, sy - 9, w, 18, 3); x.fill(); x.stroke();
    x.fillStyle = col; x.beginPath(); x.roundRect(sx, sy - 9, 16, 18, [3, 0, 0, 3]); x.fill(); x.fillStyle = '#fff'; x.fillText(letter, sx + 4, sy + 4);
    if (text) { x.fillStyle = '#16283c'; x.font = '11px Segoe UI, sans-serif'; x.fillText(text, sx + 20, sy + 4); }
  }
  function drawBCs2D(x, E) {
    const byId = new Map(E.map(e => [e.id, e])), inside = G.regionTester(A.doc.shapes);
    A.doc.bcs.forEach((b, bi) => {
      if (b.on === false) return; const col = BC_COLOR[b.kind]; let anchor = null;
      if (b.kind === 'gravity' || b.kind === 'rotation') {
        const sx = V.W - 70, sy = 70 + bi * 0;
        if (b.kind === 'gravity') { const L = Math.hypot(b.x, b.y) || 1; arrow(x, sx, sy, sx + 40 * b.x / L, sy - 40 * b.y / L, col, 2.5); x.fillStyle = col; x.font = '600 11px Segoe UI'; x.fillText('g', sx + 8, sy - 6); }
        else { const [cx, cy] = V.toScreen(0, 0); x.strokeStyle = col; x.lineWidth = 2; x.beginPath(); x.arc(cx, cy, 18, -2.4, 1.6); x.stroke(); arrow(x, cx + 18 * Math.cos(1.2), cy + 18 * Math.sin(1.2), cx + 18 * Math.cos(1.6), cy + 18 * Math.sin(1.6), col, 2); }
        return;
      }
      for (const t of b.targets) {
        const ed = byId.get(t); if (!ed) continue; const e = ed.e, n = Math.max(3, Math.min(14, Math.round(G.edgeLength(e) * V.s / 26)));
        for (let i = 0; i <= n; i++) {
          const u = (i + 0.5) / (n + 1), p = G.edgePoint(e, u), q = G.edgePoint(e, Math.min(1, u + 1e-4)), tx = q[0] - p[0], ty = q[1] - p[1], tl = Math.hypot(tx, ty) || 1;
          const [sx, sy] = V.toScreen(p[0], p[1]); let nx = ty / tl, ny = -tx / tl;   // a normal in world space
          // outward guess: test which side is outside the material
          if (inside(p[0] + nx * 1e-3 * modelSize(), p[1] + ny * 1e-3 * modelSize())) { nx = -nx; ny = -ny; }
          const snx = nx, sny = -ny;   // screen
          if (b.kind === 'fixed') { x.strokeStyle = col; x.lineWidth = 1.3; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + snx * 9 - sny * 5, sy + sny * 9 + snx * 5); x.stroke(); }
          else if (b.kind === 'roller') { x.strokeStyle = col; x.lineWidth = 1.3; x.beginPath(); x.arc(sx + snx * 5, sy + sny * 5, 4, 0, 7); x.stroke(); }
          else if (b.kind === 'disp') { x.fillStyle = col; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + snx * 9 + sny * 4, sy + sny * 9 - snx * 4); x.lineTo(sx + snx * 9 - sny * 4, sy + sny * 9 + snx * 4); x.fill(); }
          else if (b.kind === 'pressure') { const s = b.p >= 0 ? 1 : -1; if (s > 0) arrow(x, sx + snx * 26, sy + sny * 26, sx + snx * 2, sy + sny * 2, col, 1.4); else arrow(x, sx + snx * 2, sy + sny * 2, sx + snx * 26, sy + sny * 26, col, 1.4); }
          else if (b.kind === 'force' || b.kind === 'bearing') {
            const L = Math.hypot(b.x, b.y) || 1, dx = b.x / L, dy = -b.y / L;
            if (b.kind === 'bearing' && -(nx * b.x + ny * b.y) / L <= 0.05) continue;
            const len = b.kind === 'bearing' ? 26 * Math.max(0.3, -(nx * b.x + ny * b.y) / L) : 26;
            arrow(x, sx - dx * len, sy - dy * len, sx, sy, col, 1.4);
          }
          if (i === Math.floor(n / 2) && !anchor) anchor = [sx + snx * 30, sy + sny * 30];
        }
      }
      if (anchor) tag(x, anchor[0], anchor[1], LETTERS[bi % 26], col);
    });
  }
  function bcValueText(b) {
    const u = is3() ? ['x', 'y', 'z'] : ['x', 'y'];
    if (b.kind === 'force' || b.kind === 'bearing') return u.map(k => fmt(b[k] || 0)).join(', ') + ' N';
    if (b.kind === 'pressure') return fmt(b.p) + ' MPa';
    if (b.kind === 'gravity') return u.map(k => fmt(b[k] || 0)).join(', ') + ' m/s²';
    if (b.kind === 'rotation') return fmt(b.rpm) + ' rpm';
    if (b.kind === 'disp') return u.map(k => b[k] == null ? 'free' : fmt(b[k]) + ' mm').join(', ');
    return '';
  }
  function drawBCLegend(x) {
    const d = A.doc; let y = 18;
    x.font = '600 12px Segoe UI, sans-serif'; x.fillStyle = '#16283c';
    x.fillText((is3() ? '3-D solid' : MODEL_NAME[d.study.model]) + ' · ' + (d.analysis.type === 'modal' ? 'Modal' : 'Static structural'), 14, y); y += 8;
    x.font = '11px Segoe UI, sans-serif'; x.fillStyle = '#44566b'; x.fillText(d.material.name + (is3() || d.study.model === 'axi' ? '' : ` · t = ${fmt(d.study.thickness)} mm`), 14, y + 10); y += 30;
    d.bcs.forEach((b, i) => { if (b.on === false) return; if (d.analysis.type === 'modal' && !isSupport(b.kind)) return; tag(x, 14, y, LETTERS[i % 26], BC_COLOR[b.kind], b.name + (bcValueText(b) ? ': ' + bcValueText(b) : '')); y += 22; });
  }
  function drawLegend(x) {
    const f = field(), rg = range(f), nb = A.bands || 12, d = A.doc; let y = 16;
    x.font = '600 12px Segoe UI, sans-serif'; x.fillStyle = '#16283c'; x.fillText(f.label, 14, y);
    x.font = '11px Segoe UI, sans-serif'; x.fillStyle = '#44566b';
    const lines = [`Type: ${A.run.res.modes ? 'Modal' : 'Static structural'} · ${is3() ? '3-D voxel solid' : MODEL_NAME[d.study.model]}`, `Unit: ${f.unit || '—'}`];
    if (curScale) lines.push(`Deformation scale: ${fmt(curScale, 3)} ×` + (A.anim ? ' (animated)' : '')); else lines.push('Undeformed shape');
    lines.forEach((l, i) => x.fillText(l, 14, y + 16 + i * 14)); y += 16 + lines.length * 14 + 6;
    const bh = A.bands ? 22 : 18, steps = A.bands || 10, H = steps * bh;
    if (A.bands) for (let k = 0; k < steps; k++) { const c = V.colorAt((steps - 1 - k + 0.5) / steps, steps, f.reverse); x.fillStyle = `rgb(${c.map(Math.round)})`; x.fillRect(14, y + k * bh, 22, bh); }
    else { const g = x.createLinearGradient(0, y, 0, y + H); for (let i = 0; i <= 20; i++) { const c = V.colorAt(1 - i / 20, 0, f.reverse); g.addColorStop(i / 20, `rgb(${c.map(Math.round)})`); } x.fillStyle = g; x.fillRect(14, y, 22, H); }
    x.strokeStyle = '#5a6b7d'; x.strokeRect(14.5, y + 0.5, 22, H);
    x.font = '11px Segoe UI, sans-serif';
    for (let k = 0; k <= steps; k++) { let v = rg.hi - (rg.hi - rg.lo) * k / steps; if (Math.abs(v) < 1e-9 * (Math.abs(rg.hi) + Math.abs(rg.lo))) v = 0; const ly = y + k * bh; x.fillStyle = '#16283c'; x.fillText(fmt(v, 4) + (k === 0 ? '  Max' : k === steps ? '  Min' : ''), 42, ly + 4); }
    if (f.cap && rg.hi >= f.cap - 1e-9) { x.fillStyle = '#44566b'; x.fillText(`(safety factor shown up to ${f.cap})`, 14, y + H + 18); }
  }
  function nodePos(n, sc) { const dim = is3() ? 3 : 2, P = A.mesh.nodes, u = A.run.res.modes ? field().u : A.run.res.u; return Array.from({ length: dim }, (_, c) => P[n * dim + c] + sc * u[n * dim + c]); }
  function toScr(p) { return is3() ? V.project(p) : V.toScreen(p[0], p[1]); }
  function drawMinMax(x) {
    const f = field(), rg = range(f), sc = curScale;
    const one = (k, txt, col) => { const p = toScr(nodePos(k, sc)); if (p[2] > 1) return; x.strokeStyle = col; x.lineWidth = 1.5; x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(p[0] + 18, p[1] - 18); x.stroke(); x.fillStyle = col; x.beginPath(); x.arc(p[0], p[1], 3, 0, 7); x.fill(); x.font = '600 11px Segoe UI'; const w = x.measureText(txt).width + 10; x.fillRect(p[0] + 18, p[1] - 27, w, 17); x.fillStyle = '#fff'; x.fillText(txt, p[0] + 23, p[1] - 15); };
    if (A.run.res.modes) { one(rg.khi, 'Max', '#c92a2a'); return; }
    one(rg.khi, 'Max ' + fmt(rg.hi, 4), '#c92a2a'); one(rg.klo, 'Min ' + fmt(rg.lo, 4), '#1c4fb8');
  }
  function probeValue(pr) {
    const f = field(); if (!f) return null;
    if (is3()) { return { v: f.v[pr.node], at: nodePos(pr.node, curScale) }; }
    const r = S.probe2D(A.mesh, f.v, pr.x, pr.y); if (!r) return null;
    const u = A.run.res.modes ? f.u : A.run.res.u, ux = S.probe2D(A.mesh, u, pr.x, pr.y, 2, 0).v, uy = S.probe2D(A.mesh, u, pr.x, pr.y, 2, 1).v;
    return { v: r.v, at: [pr.x + curScale * ux, pr.y + curScale * uy] };
  }
  function drawProbes(x) {
    const f = field();
    A.probes.forEach((pr, i) => {
      const r = probeValue(pr); if (!r) return; const p = toScr(r.at); if (p[2] > 1) return;
      x.fillStyle = '#111'; x.beginPath(); x.arc(p[0], p[1], 3.5, 0, 7); x.fill();
      const txt = `${i + 1}: ${fmt(r.v, 5)} ${f.unit}`; x.font = '600 11px Segoe UI'; const w = x.measureText(txt).width + 10;
      x.fillStyle = 'rgba(255,255,225,0.95)'; x.strokeStyle = '#555'; x.beginPath(); x.roundRect(p[0] + 8, p[1] + 6, w, 18, 3); x.fill(); x.stroke(); x.fillStyle = '#111'; x.fillText(txt, p[0] + 13, p[1] + 19);
    });
  }
  function drawTriad2D(x) {
    const ox = 34, oy = V.H - 30, axi = A.doc.study.model === 'axi';
    arrow(x, ox, oy, ox + 34, oy, '#c92a2a', 2); arrow(x, ox, oy, ox, oy - 34, '#2b8a3e', 2);
    x.font = '600 11px Segoe UI'; x.fillStyle = '#c92a2a'; x.fillText(axi ? 'r' : 'X', ox + 38, oy + 4); x.fillStyle = '#2b8a3e'; x.fillText(axi ? 'z' : 'Y', ox - 4, oy - 40);
  }
  function drawScaleBar(x) {
    const target = 120 / V.s, p = Math.pow(10, Math.floor(Math.log10(target))), step = [1, 2, 5, 10].map(k => k * p).filter(v => v <= target).pop() || p, w = step * V.s, x0 = V.W - w - 30, y0 = V.H - 22;
    x.strokeStyle = '#2a3b4d'; x.lineWidth = 1; x.beginPath(); x.moveTo(x0, y0 - 5); x.lineTo(x0, y0); x.lineTo(x0 + w, y0); x.lineTo(x0 + w, y0 - 5); x.stroke();
    x.fillStyle = '#2a3b4d'; x.font = '11px Segoe UI'; x.textAlign = 'center'; x.fillText(fmt(step) + ' mm', x0 + w / 2, y0 - 6); x.textAlign = 'left';
  }
  function drawDraft(x) {
    const dr = A.draft; if (!dr) return;
    x.save(); x.strokeStyle = '#1f6fd1'; x.lineWidth = 1.5; x.setLineDash([6, 4]); x.fillStyle = 'rgba(31,111,209,0.08)';
    if (dr.kind === 'rect') { const [a, b] = [V.toScreen(dr.x0, dr.y0), V.toScreen(dr.x1, dr.y1)]; x.beginPath(); x.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); x.fill(); x.stroke(); dimText(x, `${fmt(Math.abs(dr.x1 - dr.x0))} × ${fmt(Math.abs(dr.y1 - dr.y0))} mm`, b); }
    if (dr.kind === 'circle') { const c = V.toScreen(dr.cx, dr.cy); x.beginPath(); x.arc(c[0], c[1], dr.r * V.s, 0, 7); x.fill(); x.stroke(); dimText(x, `R ${fmt(dr.r)} mm`, [c[0] + dr.r * V.s, c[1]]); }
    if (dr.kind === 'poly') { x.beginPath(); dr.pts.concat(dr.cur ? [dr.cur] : []).forEach((p, i) => { const q = V.toScreen(p[0], p[1]); i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]); }); x.stroke(); x.setLineDash([]); dr.pts.forEach(p => { const q = V.toScreen(p[0], p[1]); x.fillStyle = '#fff'; x.fillRect(q[0] - 3, q[1] - 3, 6, 6); x.strokeRect(q[0] - 3, q[1] - 3, 6, 6); }); }
    x.restore();
  }
  function dimText(x, t, p) { x.setLineDash([]); x.font = '11px Segoe UI'; x.fillStyle = '#1f3c66'; x.fillText(t, p[0] + 8, p[1] - 8); }
  function drawOverlay3D(x) {
    const d = A.doc, seg = d._seg;
    if (!d.solid) return;
    if (!A.run || A.tree.startsWith('bc:')) {
      d.bcs.forEach((b, bi) => {
        if (b.on === false) return; const col = BC_COLOR[b.kind];
        if (b.kind === 'gravity') { const L = Math.hypot(b.x, b.y, b.z) || 1, o = V.project([0, 0, 0]), e = V.project([b.x / L, b.y / L, b.z / L].map(v => v * modelSize() * 0.12)); arrow(x, V.W - 70, 80, V.W - 70 + (e[0] - o[0]), 80 + (e[1] - o[1]), col, 2.5); x.fillStyle = col; x.font = '600 11px Segoe UI'; x.fillText('g', V.W - 62, 74); return; }
        const fs = b.targets.map(t => seg.faces[+t.slice(1)]).filter(Boolean); if (!fs.length) return;
        if (b.kind === 'force' || b.kind === 'bearing') {
          const L = Math.hypot(b.x, b.y, b.z) || 1, len = modelSize() * 0.15;
          fs.forEach(f => { const c = f.centroid, p1 = V.project(c), p0 = V.project([c[0] - b.x / L * len, c[1] - b.y / L * len, c[2] - b.z / L * len]); arrow(x, p0[0], p0[1], p1[0], p1[1], col, 2.5); });
        }
        if (b.kind === 'pressure') fs.forEach(f => { const c = f.centroid, len = modelSize() * 0.1, s = b.p >= 0 ? 1 : -1, p1 = V.project(c), p0 = V.project([c[0] + f.normal[0] * len * s, c[1] + f.normal[1] * len * s, c[2] + f.normal[2] * len * s]); s > 0 ? arrow(x, p0[0], p0[1], p1[0], p1[1], col, 2.5) : arrow(x, p1[0], p1[1], p0[0], p0[1], col, 2.5); });
        const p = V.project(fs[0].centroid); if (p[2] < 1) tag(x, p[0] + 10, p[1] - 14, LETTERS[bi % 26], col);
      });
    }
    if (A.run) { drawLegend(x); drawMinMax(x); drawProbes(x); } else drawBCLegend(x);
    // triad
    const cam = V.camera(), o = [40, V.H - 40];
    [[1, 0, 0, '#c92a2a', 'X'], [0, 1, 0, '#2b8a3e', 'Y'], [0, 0, 1, '#1c4fb8', 'Z']].forEach(([a, b, c, col, L]) => {
      const v = new THREE.Vector3(a, b, c).applyQuaternion(cam.quaternion.clone().invert()); arrow(x, o[0], o[1], o[0] + v.x * 28, o[1] - v.y * 28, col, 2); x.fillStyle = col; x.font = '600 11px Segoe UI'; x.fillText(L, o[0] + v.x * 34 - 3, o[1] - v.y * 34 + 4);
    });
  }

  // ---------- panels ----------
  function renderAll() { refreshScene(); renderCmd(); renderTree(); renderDetails(); renderResults(); renderStatus(); welcome(); }
  function welcome() {
    const empty = !A.doc.shapes.length && !A.doc.solid; $('welcome').hidden = !empty;
  }
  function treeItem(k, html, depth = 0, cls = '') { return `<div class="aero-item tree${A.tree === k ? ' sel' : ''} ${cls}" data-k="${esc(k)}" style="padding-left:${8 + depth * 16}px">${html}</div>`; }
  const ico = (c, ch) => `<span class="ti" style="background:${c}">${ch}</span>`;
  function renderTree() {
    const d = A.doc, L = [];
    L.push(treeItem('geometry', `${ico('#5c7cfa', '▱')}Geometry <span class="dim">${is3() ? esc(d.solid ? d.solid.name : 'none') : d.shapes.length + ' outline' + (d.shapes.length === 1 ? '' : 's')}</span>`));
    if (!is3()) d.shapes.forEach(s => L.push(treeItem('shape:' + s.id, `${ico('#9aa9bb', s.kind === 'circle' ? '○' : s.kind === 'rect' ? '▭' : '⬠')}${esc(s.name || s.kind)} <span class="dim">${s.kind}</span>`, 1)));
    L.push(treeItem('material', `${ico('#868e96', 'M')}Material <span class="dim">${esc(d.material.name)}</span>`));
    L.push(treeItem('mesh', `${ico('#20c997', '⊞')}Mesh <span class="dim">${A.mesh ? A.mesh.stats.elements.toLocaleString() + (is3() ? ' voxels' : ' elements') : 'not generated'}</span>`));
    L.push(treeItem('analysis', `${ico('#fab005', d.analysis.type === 'modal' ? '∿' : '⚖')}${d.analysis.type === 'modal' ? 'Modal' : 'Static structural'} <span class="dim">${is3() ? '3-D' : MODEL_NAME[d.study.model]}</span>`));
    d.bcs.forEach((b, i) => L.push(treeItem('bc:' + b.id, `<span class="ti" style="background:${BC_COLOR[b.kind]}">${LETTERS[i % 26]}</span>${esc(b.name)}${b.on === false ? ' <span class="dim">(off)</span>' : ''}`, 1, b.on === false ? 'off' : '')));
    L.push(treeItem('solution', `${ico(A.run ? '#2f9e44' : '#adb5bd', A.run ? '✓' : '?')}Solution <span class="dim">${A.run ? (A.run.res.modes ? A.run.res.modes.length + ' modes' : 'solved') : 'not solved'}</span>`));
    $('tree').innerHTML = L.join('');
    $('tree').querySelectorAll('.tree').forEach(el => el.onclick = () => { A.tree = el.dataset.k; if (A.tree.startsWith('bc:')) { const b = d.bcs.find(x => 'bc:' + x.id === A.tree); } if (A.tree === 'mesh' && !A.mesh) { } refreshScene(); renderTree(); renderDetails(); V.need = true; });
  }
  // details form helpers
  const num = (k, label, v, unit = '', attrs = '') => `<label>${label}</label><span class="iu"><input data-f="${k}" type="number" step="any" value="${v ?? ''}" ${attrs}><i>${unit}</i></span>`;
  function renderDetails() {
    const d = A.doc, el = $('details'), t = A.tree; let h = '';
    if (t === 'geometry') {
      if (is3()) {
        const s = d.solid, seg = d._seg;
        h = s ? `<div class="kv"><span>Solid</span><b>${esc(s.name)}</b><span>Triangles</span><b>${(s.tris.length / 9).toLocaleString()}</b><span>Faces</span><b>${seg.faces.length}</b><span>Closed surface</span><b>${seg.watertight ? 'yes' : 'no — ' + seg.openEdges + ' open edges'}</b><span>Volume</span><b>${fmt(Math.abs(VX.volume(s.tris)), 5)} mm³</b><span>Mass</span><b>${fmt(Math.abs(VX.volume(s.tris)) * d.material.rho * 1e-9, 4)} kg</b></div>` : '<p class="note">No solid yet.</p>';
        h += `<p class="note">Click faces with the Select tool (Shift-click to add more), then use <b>Insert</b> to add supports and loads.</p><div class="btns"><button class="aero-btn small" data-a="importSTL">Import STL…</button><button class="aero-btn small" data-a="to2d">Back to 2-D</button></div>`;
      } else {
        h = `<div class="pform"><label>Model</label><select data-f="study.model">${Object.entries(MODEL_NAME).map(([k, v]) => `<option value="${k}" ${d.study.model === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          ${d.study.model !== 'axi' ? num('study.thickness', d.study.model === 'strain' ? 'Depth' : 'Thickness', d.study.thickness, 'mm') : ''}</div>
          <p class="note">${d.study.model === 'axi' ? 'Axisymmetric: draw the cross-section at x ≥ 0. x is the radius and the y axis is the axis of revolution; loads and reactions are totals for the full 360°.' : d.study.model === 'strain' ? 'Plane strain: a long body loaded in its cross-section (dams, tunnels, long rollers). Forces are per the given depth.' : 'Plane stress: thin plates loaded in their own plane.'}</p>
          <div class="kv"><span>Material area</span><b>${fmt(G.regionArea(d.shapes), 5)} mm²</b></div>
          <p class="note">Outlines combine by the even–odd rule: a shape drawn inside another becomes a hole. Outlines must not cross.</p>
          <div class="btns"><button class="aero-btn small" data-a="rect">Rectangle…</button><button class="aero-btn small" data-a="circle">Circle…</button><button class="aero-btn small" data-a="poly">Polygon…</button><button class="aero-btn small" data-a="importDXF">Import DXF…</button><button class="aero-btn small" data-a="extrude">Extrude to 3-D…</button></div>`;
      }
    } else if (t.startsWith('shape:')) {
      const s = d.shapes.find(x => 'shape:' + x.id === t);
      h = `<div class="pform"><label>Name</label><input data-f="name" value="${esc(s.name || '')}">`;
      if (s.kind === 'rect') h += num('x', 'Corner x', s.x, 'mm') + num('y', 'Corner y', s.y, 'mm') + num('w', 'Width', s.w, 'mm') + num('h', 'Height', s.h, 'mm') + num('r', 'Corner radius', s.r || 0, 'mm');
      if (s.kind === 'circle') h += num('cx', 'Centre x', s.cx, 'mm') + num('cy', 'Centre y', s.cy, 'mm') + num('r', 'Radius', s.r, 'mm');
      if (s.kind === 'poly') h += `<label style="align-self:start">Points</label><textarea data-f="pts" rows="7" class="mono" title="One point per line: x, y [, bulge]. A bulge makes the edge to the next point an arc (DXF convention: tan of a quarter of the swept angle, positive = counter-clockwise).">${esc(s.pts.map(p => p[2] ? `${p[0]}, ${p[1]}, ${+p[2].toFixed(6)}` : `${p[0]}, ${p[1]}`).join('\n'))}</textarea>`;
      h += `</div><p class="note">Edges: ${G.shapeEdges(s).length}. Drag the shape with the Select tool to move it${s.kind === 'poly' ? '; drag its corners to reshape' : ''}.</p><div class="btns"><button class="aero-btn small" data-a="delShape">Delete shape</button></div>`;
    } else if (t === 'material') {
      const m = d.material, groups = [...new Set(S.MATERIALS.map(x => x.group))];
      h = `<div class="pform"><label>Library</label><select data-f="matId"><option value="custom" ${S.MATERIALS.some(x => x.id === m.id) ? '' : 'selected'}>Custom…</option>${groups.map(g => `<optgroup label="${g}">${S.MATERIALS.filter(x => x.group === g).map(x => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</optgroup>`).join('')}</select>
        ${num('mat.E', 'Young’s modulus', +(m.E / 1000).toPrecision(6), 'GPa')}${num('mat.nu', 'Poisson’s ratio', m.nu, '')}${num('mat.rho', 'Density', m.rho, 'kg/m³')}${num('mat.Sy', 'Yield strength', m.Sy, 'MPa')}${num('mat.Su', 'Tensile strength', m.Su, 'MPa')}</div>
        <p class="note">Linear isotropic elastic. The safety factor result is yield strength ÷ von Mises stress (capped at ${S.SF_CAP}). Library values are typical; check your supplier's data.</p>`;
    } else if (t === 'mesh') {
      if (is3()) {
        h = `<div class="pform">${num('mesh.target', 'Target elements', d.mesh.target, 'voxels', 'min="200" max="200000" step="1000"')}</div>
          <div class="kv">${A.mesh ? `<span>Elements</span><b>${A.mesh.stats.elements.toLocaleString()}</b><span>Nodes</span><b>${A.mesh.stats.nodes.toLocaleString()}</b><span>Cell size</span><b>≈ ${fmt(A.mesh.h, 3)} mm</b><span>Voxel / STL volume</span><b>${fmt(A.mesh.stats.volume / A.mesh.stats.stlVolume * 100, 4)} %</b>${A.mesh.stats.dropped ? `<span>Loose cells removed</span><b>${A.mesh.stats.dropped}</b>` : ''}` : '<span>Status</span><b>not generated</b>'}</div>
          <p class="note"><b>How 3-D meshing works.</b> The closed STL is filled with brick elements on a rectilinear grid whose planes sit on the part's bounding box and on every flat face aligned with X, Y or Z, so prismatic parts are captured exactly. Curved and inclined faces become stair-stepped: overall stiffness, deflections, reactions and frequencies stay accurate, but peak stresses right on stepped surfaces are not reliable. Use a finer mesh, or check stress concentrations in a 2-D study. Each brick uses incompatible modes, so bending is accurate even with two or three elements through the thickness.</p>`;
      } else {
        const refs = Object.entries(d.mesh.refine);
        h = `<div class="pform">${num('mesh.size', 'Element size', d.mesh.size || '', 'mm', `placeholder="auto (${S.autoSize(d) || '—'})"`)}${num('mesh.grade', 'Growth rate', d.mesh.grade, '', 'min="0.05" max="2" step="0.05"')}${num('mesh.minAngle', 'Minimum angle', d.mesh.minAngle, '°', 'min="10" max="33"')}</div>
          <div class="kv">${A.mesh ? `<span>Elements</span><b>${A.mesh.stats.elements.toLocaleString()} (6-node)</b><span>Nodes</span><b>${A.mesh.stats.nodes.toLocaleString()}</b><span>Smallest angle</span><b>${A.mesh.stats.minAngle.toFixed(1)}°</b><span>Meshing time</span><b>${A.mesh.stats.ms} ms</b>` : '<span>Status</span><b>not generated</b>'}</div>
          <h4>Edge sizing</h4>${refs.length ? refs.map(([k, v]) => `<div class="refrow"><span>${esc(edgeName(k))}</span><b>${fmt(v)} mm</b><button class="aero-btn small" data-unref="${esc(k)}">✕</button></div>`).join('') : '<p class="note">None. Select edges and press "Refine selected" to make the mesh finer near holes and fillets.</p>'}
          <div class="btns"><button class="aero-btn small" data-a="refine">Refine selected edges…</button><button class="aero-btn small pri" data-a="mesh">Generate mesh</button></div>`;
      }
      if (is3()) h += `<div class="btns"><button class="aero-btn small pri" data-a="mesh">Generate mesh</button></div>`;
    } else if (t === 'analysis') {
      h = `<div class="pform"><label>Analysis</label><select data-f="analysis.type"><option value="static" ${d.analysis.type === 'static' ? 'selected' : ''}>Static structural</option><option value="modal" ${d.analysis.type === 'modal' ? 'selected' : ''}>Modal (natural frequencies)</option></select>
        ${d.analysis.type === 'modal' ? num('analysis.modes', 'Modes', d.analysis.modes, '', 'min="1" max="20" step="1"') : ''}
        <label>Solver</label><select data-f="mesh.solver"><option value="auto" ${d.mesh.solver === 'auto' ? 'selected' : ''}>Program controlled</option><option value="pcg" ${d.mesh.solver === 'pcg' ? 'selected' : ''}>Iterative (PCG, IC(0))</option><option value="direct" ${d.mesh.solver === 'direct' ? 'selected' : ''}>Direct (skyline Cholesky)</option></select></div>
        <p class="note">${d.analysis.type === 'modal' ? 'Modal analysis finds the lowest natural frequencies and mode shapes of the supported part (LOBPCG eigen-solver, consistent mass). Loads are ignored; supports apply. Without supports, rigid-body modes appear at ≈ 0 Hz.' : 'Linear static: small deflections, linear elastic material, loads applied all at once.'} Program controlled uses the exact direct solver for small or slender models and preconditioned conjugate gradients for large ones.</p>
        <div class="btns"><button class="aero-btn small" data-a="addFixed">+ Fixed</button><button class="aero-btn small" data-a="addRoller">+ Frictionless</button><button class="aero-btn small" data-a="addForce">+ Force</button><button class="aero-btn small" data-a="addPressure">+ Pressure</button></div>`;
    } else if (t.startsWith('bc:')) {
      const b = d.bcs.find(x => 'bc:' + x.id === t), dimK = is3() ? ['x', 'y', 'z'] : ['x', 'y'], axi = !is3() && d.study.model === 'axi', lab = k => axi ? { x: 'R', y: 'Z' }[k] : k.toUpperCase();
      h = `<div class="pform"><label>Name</label><input data-f="name" value="${esc(b.name)}"><label>Type</label><b>${S.BC_KINDS[b.kind]}</b><label>Active</label><input type="checkbox" data-f="on" ${b.on !== false ? 'checked' : ''} style="width:auto;justify-self:start">`;
      if (b.kind === 'force' || b.kind === 'bearing') h += dimK.map(k => num(k, lab(k) + ' component', b[k] || 0, 'N')).join('');
      if (b.kind === 'pressure') h += num('p', 'Pressure', b.p, 'MPa');
      if (b.kind === 'gravity') h += dimK.map(k => num(k, lab(k) + ' acceleration', b[k] || 0, 'm/s²')).join('');
      if (b.kind === 'rotation') h += num('rpm', 'Speed', b.rpm, 'rpm');
      if (b.kind === 'disp') h += dimK.map(k => `<label>${lab(k)}</label><span class="iu"><input data-f="${k}" placeholder="free" value="${b[k] ?? ''}"><i>mm</i></span>`).join('');
      h += '</div>';
      const hint = { fixed: 'All displacements of the selected ' + (is3() ? 'faces' : 'edges') + ' are zero.', roller: 'No movement normal to the surface; free to slide along it (symmetry planes, smooth contact).', disp: 'Leave a component empty to keep it free; enter 0 to hold it or a value to impose a displacement.', force: 'Total force spread uniformly over the selection.', bearing: 'Total force spread over the side of a hole the pin presses on, cosine-weighted (like a pin or shaft).', pressure: 'Positive pressure pushes into the surface; negative pulls (tension).', gravity: 'Body force from an acceleration field, scaled by density.', rotation: is3() ? 'Centrifugal load from spinning about the global Z axis.' : axi ? 'Centrifugal load from spinning about the axis of symmetry.' : 'Centrifugal load from spinning about the origin (Z axis).' }[b.kind];
      h += `<p class="note">${hint}</p>`;
      if (b.kind !== 'gravity' && b.kind !== 'rotation') h += `<div class="kv"><span>Scope</span><b>${b.targets.length} ${is3() ? 'face' : 'edge'}${b.targets.length === 1 ? '' : 's'}</b></div><div class="btns"><button class="aero-btn small" data-a="useSel">Use current selection (${A.sel.size})</button><button class="aero-btn small" data-a="selBC">Select its ${is3() ? 'faces' : 'edges'}</button></div>`;
      h += `<div class="btns"><button class="aero-btn small" data-a="delBC">Delete</button></div>`;
    } else if (t === 'solution') {
      h = A.run ? solutionHTML() : `<p class="note">Press <b>Solve</b> (F5) to mesh the part and compute results.</p><div class="btns"><button class="aero-btn pri small" data-a="solve">Solve</button></div>`;
    }
    el.innerHTML = h;
    el.querySelectorAll('[data-f]').forEach(inp => inp.onchange = () => setField(inp.dataset.f, inp.type === 'checkbox' ? inp.checked : inp.value));
    el.querySelectorAll('[data-a]').forEach(b => b.onclick = () => ACTIONS[b.dataset.a]());
    el.querySelectorAll('[data-unref]').forEach(b => b.onclick = () => commit('Remove edge sizing', d2 => { delete d2.mesh.refine[b.dataset.unref]; }));
  }
  function edgeName(id) { const [sid, i] = id.split(':'), s = A.doc.shapes.find(x => x.id === sid); return (s ? s.name || s.kind : sid) + ' · edge ' + (+i + 1); }
  function setField(k, v) {
    const t = A.tree, d = A.doc, n = parseFloat(v);
    if (t === 'geometry' || t === 'mesh' || t === 'analysis') {
      if (k === 'study.model') return commit('Model: ' + MODEL_NAME[v], d2 => { d2.study.model = v; });
      if (k === 'study.thickness' && n > 0) return commit('Thickness', d2 => { d2.study.thickness = n; });
      if (k === 'mesh.size') return commit('Element size', d2 => { d2.mesh.size = n > 0 ? n : 0; });
      if (k === 'mesh.grade' && n > 0) return commit('Mesh growth', d2 => { d2.mesh.grade = Math.min(2, Math.max(0.05, n)); });
      if (k === 'mesh.minAngle' && n > 0) return commit('Minimum angle', d2 => { d2.mesh.minAngle = Math.min(33, Math.max(10, n)); });
      if (k === 'mesh.target' && n > 0) return commit('Target elements', d2 => { d2.mesh.target = Math.round(Math.min(200000, Math.max(200, n))); });
      if (k === 'mesh.solver') return commit('Solver', d2 => { d2.mesh.solver = v; });
      if (k === 'analysis.type') return commit(v === 'modal' ? 'Modal analysis' : 'Static analysis', d2 => { d2.analysis.type = v; });
      if (k === 'analysis.modes' && n > 0) return commit('Number of modes', d2 => { d2.analysis.modes = Math.round(Math.min(20, Math.max(1, n))); });
      return renderDetails();
    }
    if (t === 'material') {
      if (k === 'matId') { const m = S.MATERIALS.find(x => x.id === v); if (m) commit('Material: ' + m.name, d2 => { d2.material = Object.assign({}, m); }); return; }
      const key = k.slice(4); if (!(n >= 0)) return renderDetails();
      return commit('Material property', d2 => { d2.material[key] = key === 'E' ? n * 1000 : key === 'nu' ? Math.min(0.499, n) : n; d2.material.id = 'custom'; if (!/\(custom\)$/.test(d2.material.name)) d2.material.name += ' (custom)'; });
    }
    if (t.startsWith('shape:')) {
      const id = t.slice(6);
      if (k === 'name') return commit('Rename', d2 => { d2.shapes.find(s => s.id === id).name = v.slice(0, 60); });
      if (k === 'pts') { const pts = v.split(/\n/).map(l => l.split(/[,;\s]+/).filter(Boolean).map(Number)).filter(p => p.length >= 2 && p.every(Number.isFinite)).map(p => [p[0], p[1], p[2] || 0]); if (pts.length < 3) { Aero.alert('Points', 'A polygon needs at least three points (x, y per line).'); return renderDetails(); } return commit('Edit points', d2 => { d2.shapes.find(s => s.id === id).pts = pts; }); }
      if (!Number.isFinite(n)) return renderDetails();
      if ((k === 'w' || k === 'h' || (k === 'r' && d.shapes.find(s => s.id === id).kind === 'circle')) && !(n > 0)) return renderDetails();
      return commit('Edit ' + k, d2 => { d2.shapes.find(s => s.id === id)[k] = k === 'r' && n < 0 ? 0 : n; });
    }
    if (t.startsWith('bc:')) {
      const id = t.slice(3);
      if (k === 'name') return commit('Rename', d2 => { d2.bcs.find(b => b.id === id).name = v.slice(0, 60); });
      if (k === 'on') return commit(v ? 'Activate' : 'Suppress', d2 => { d2.bcs.find(b => b.id === id).on = !!v; });
      const b = d.bcs.find(x => x.id === id);
      if (b.kind === 'disp') return commit('Displacement', d2 => { d2.bcs.find(x => x.id === id)[k] = String(v).trim() === '' || !Number.isFinite(n) ? null : n; });
      if (!Number.isFinite(n)) return renderDetails();
      return commit('Edit ' + S.BC_KINDS[b.kind], d2 => { d2.bcs.find(x => x.id === id)[k] = n; });
    }
  }
  function solutionHTML() {
    const r = A.run, s = r.sum, inf = r.res.info, dimK = is3() ? ['X', 'Y', 'Z'] : (A.doc.study.model === 'axi' ? ['R', 'Z'] : ['X', 'Y']);
    let h = `<div class="kv"><span>Nodes / elements</span><b>${inf.nodes.toLocaleString()} / ${inf.elements.toLocaleString()}</b><span>Equations</span><b>${inf.equations.toLocaleString()}</b><span>Solver</span><b>${esc(inf.precond)}</b><span>${r.res.modes ? 'LOBPCG iterations' : 'Iterations'}</span><b>${inf.iterations}${inf.residual != null ? ` (residual ${inf.residual.toExponential(1)})` : ''}</b><span>Solve time</span><b>${inf.total.toFixed(2)} s</b></div>`;
    if (r.res.modes) return h;
    h += '<h4>Reaction forces</h4><table class="rt"><tr><th>Support</th>' + dimK.map(k => `<th>F${k} (N)</th>`).join('') + '</tr>';
    s.reactions.forEach(x => { h += `<tr><td>${esc(x.name)}</td>${dimK.map((k, c) => `<td>${fmt(x.r[c], 5)}</td>`).join('')}</tr>`; });
    h += `<tr class="tot"><td>Total</td>${dimK.map((k, c) => `<td>${fmt(s.reactionTotal[c], 5)}</td>`).join('')}</tr></table>`;
    h += `<p class="note">The reaction total balances the applied loads (including body forces). Strain energy ${fmt(s.energy, 5)} N·mm.</p>`;
    if (r.warnings.length) h += `<p class="note warn">${r.warnings.map(esc).join('<br>')}</p>`;
    return h;
  }
  function renderResults() {
    const el = $('results'), r = A.run;
    if (!r) { el.innerHTML = `<p class="note">${A.solving ? 'Solving…' : 'No results yet — press <b>Solve</b> (F5).'}</p>`; return; }
    const s = r.sum;
    if (r.res.modes) { el.innerHTML = '<table class="rt modes"><tr><th>Mode</th><th>Frequency</th></tr>' + s.modes.map((m, i) => `<tr class="${A.result === 'mode' + i ? 'on' : ''}" data-m="${i}"><td>${m.mode}</td><td>${fmt(m.f, 6)} Hz</td></tr>`).join('') + '</table>'; el.querySelectorAll('tr[data-m]').forEach(tr => tr.onclick = () => { A.result = 'mode' + tr.dataset.m; renderCmd(); renderResults(); refreshScene(); }); return; }
    const sf = s.minSF.v, sfc = sf < 1 ? '#c92a2a' : sf < 1.5 ? '#e67700' : '#2b8a3e';
    el.innerHTML = `<div class="kv big"><span>Max deformation</span><b>${fmt(s.maxDisp.v, 4)} mm</b><span>Max von Mises</span><b>${fmt(s.maxVM.v, 4)} MPa</b><span>Max principal</span><b>${fmt(s.maxS1.v, 4)} MPa</b><span>Min principal</span><b>${fmt(s.minS3.v, 4)} MPa</b><span>Min safety factor</span><b style="color:${sfc}">${fmt(sf, 3)}${sf >= S.SF_CAP ? '+' : ''}</b></div>
      <p class="note">${sf < 1 ? 'The part yields: von Mises stress exceeds the yield strength of ' + A.doc.material.Sy + ' MPa.' : sf < 1.5 ? 'Low margin against yield.' : 'Stress is below yield everywhere.'} Click the part with the Probe tool for local values.</p>`;
  }
  function renderStatus() {
    $('st2').textContent = A.mesh ? `${A.mesh.stats.nodes.toLocaleString()} nodes · ${A.mesh.stats.elements.toLocaleString()} ${is3() ? 'voxels' : 'elements'}` : 'No mesh';
    $('st3').textContent = A.run ? `Solved in ${A.run.res.info.total.toFixed(2)} s` : A.solving ? 'Solving…' : 'Not solved';
  }
  function renderCmd() {
    $('studySel').value = is3() ? '3d' : A.doc.study.model;
    const fs = fields(), rs = $('resSel');
    rs.innerHTML = fs.length ? fs.map(f => `<option value="${f.key}">${esc(f.label)}</option>`).join('') : '<option>— solve first —</option>';
    if (fs.length && !fs.some(f => f.key === A.result)) A.result = fs[0].key;
    rs.value = A.result; rs.disabled = !fs.length; $('defSel').disabled = !fs.length; $('bAnim').disabled = !fs.length;
    $('defSel').value = A.deform; $('bandSel').value = String(A.bands); $('chkMesh').checked = A.showMesh;
    $('bAnim').classList.toggle('on', !!A.anim);
  }

  // ---------- tools & mouse ----------
  let tb;
  const HINTS = { select: () => is3() ? (A.run ? 'Drag to orbit · pick the Probe tool for values' : 'Click faces to select (Shift adds) · drag to orbit · right-drag to pan') : 'Click edges to select (Shift adds) · drag a shape to move it', pan: () => 'Drag to pan · wheel to zoom', rect: () => 'Drag a rectangle (snaps to the grid, hold Alt for free)', circle: () => 'Drag from the centre', poly: () => 'Click corners · double-click or Enter to finish', probe: () => 'Click the result to place a probe' };
  function syncTools() {
    $('hint').textContent = (HINTS[A.tool] || (() => ''))();
    document.querySelectorAll('.aero-tool').forEach(b => { const only2 = ['rect', 'circle', 'poly', 'pan'].includes(b.dataset.tool); b.disabled = only2 && is3(); b.style.opacity = b.disabled ? 0.35 : 1; });
    if (is3() && ['rect', 'circle', 'poly', 'pan'].includes(A.tool)) tb.set('select');
  }
  const snapStep = () => { const t = 12 / V.s, p = Math.pow(10, Math.floor(Math.log10(t))); return [1, 2, 5, 10].map(k => k * p).find(v => v >= t) || p; };
  const snap = (v, ev) => { if (ev && ev.altKey) return v; const s = snapStep(); return Math.round(v / s) * s; };
  function hitEdge(sx, sy) { const w = V.toWorld(sx, sy); let best = null, bd = 7; for (const ed of edgeList()) { const dd = G.edgeDistance(ed.e, w) * V.s; if (dd < bd) { bd = dd; best = ed.id; } } return best; }
  function hitVertex(sx, sy) { const s = A.tree.startsWith('shape:') ? A.doc.shapes.find(x => 'shape:' + x.id === A.tree) : null; if (!s || s.kind !== 'poly') return -1; let best = -1, bd = 8; s.pts.forEach((p, i) => { const q = V.toScreen(p[0], p[1]), dd = Math.hypot(q[0] - sx, q[1] - sy); if (dd < bd) { bd = dd; best = i; } }); return best; }
  function hitShape(wx, wy) { for (let i = A.doc.shapes.length - 1; i >= 0; i--) if (G.pointInPoly([wx, wy], G.shapePolyline(A.doc.shapes[i]))) return A.doc.shapes[i]; return null; }
  function bindMouse() {
    const cv = V.overlayCanvas(); let drag = null, down = null;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('wheel', e => { if (is3()) return; e.preventDefault(); const r = cv.getBoundingClientRect(); V.zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
    cv.addEventListener('pointerdown', e => {
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top; down = { sx, sy, t: Date.now() };
      if (is3()) return;
      cv.setPointerCapture(e.pointerId);
      const [wx, wy] = V.toWorld(sx, sy);
      if (e.button === 1 || e.button === 2 || A.tool === 'pan') { drag = { kind: 'pan', sx, sy }; return; }
      if (A.tool === 'rect' || A.tool === 'circle') { const x0 = snap(wx, e), y0 = snap(wy, e); A.draft = A.tool === 'rect' ? { kind: 'rect', x0, y0, x1: x0, y1: y0 } : { kind: 'circle', cx: x0, cy: y0, r: 0 }; drag = { kind: 'draft' }; return; }
      if (A.tool === 'poly') { const p = [snap(wx, e), snap(wy, e)]; if (!A.draft) A.draft = { kind: 'poly', pts: [] }; const f = A.draft.pts[0]; if (A.draft.pts.length >= 3 && f && Math.hypot((f[0] - p[0]) * V.s, (f[1] - p[1]) * V.s) < 8) return finishPoly(); A.draft.pts.push(p); V.need = true; return; }
      if (A.tool === 'probe') { if (A.run) { if (S.probe2D(A.mesh, A.run.res.vm || field().v, wx, wy)) { A.probes.push({ x: wx, y: wy }); V.need = true; } } else Aero.toast('Solve first, then probe results.'); return; }
      if (A.tool === 'select') {
        const vi = hitVertex(sx, sy); if (vi >= 0 && !A.run) { drag = { kind: 'vertex', i: vi, id: A.tree.slice(6), start: JSON.stringify(A.doc.shapes) }; return; }
        const ed = hitEdge(sx, sy);
        if (ed) { if (e.shiftKey || e.ctrlKey) { A.sel.has(ed) ? A.sel.delete(ed) : A.sel.add(ed); } else { A.sel.clear(); A.sel.add(ed); } selChanged(); return; }
        const s = hitShape(wx, wy);
        if (s && !A.run) { A.tree = 'shape:' + s.id; if (!e.shiftKey) A.sel.clear(); drag = { kind: 'move', id: s.id, wx, wy, start: JSON.stringify(A.doc.shapes), moved: false }; renderTree(); renderDetails(); V.need = true; return; }
        if (!e.shiftKey) { A.sel.clear(); selChanged(); }
      }
    });
    cv.addEventListener('pointermove', e => {
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (is3()) { status3D(e); return; }
      const [wx, wy] = V.toWorld(sx, sy);
      if (drag && drag.kind === 'pan') { V.pan(sx - drag.sx, sy - drag.sy); drag.sx = sx; drag.sy = sy; return; }
      if (drag && drag.kind === 'draft') { const d = A.draft; if (d.kind === 'rect') { d.x1 = snap(wx, e); d.y1 = snap(wy, e); } else d.r = Math.max(0, snap(Math.hypot(wx - d.cx, wy - d.cy), e)); V.need = true; return; }
      if (drag && drag.kind === 'move') { const dx = snap(wx - drag.wx, e), dy = snap(wy - drag.wy, e); const base = JSON.parse(drag.start).find(s => s.id === drag.id), s = A.doc.shapes.find(x => x.id === drag.id); Object.assign(s, base); G.moveShape(s, dx, dy); drag.moved = drag.moved || dx || dy; A.mesh = null; A.run = null; V.need = true; refreshScene(); return; }
      if (drag && drag.kind === 'vertex') { const s = A.doc.shapes.find(x => x.id === drag.id); s.pts[drag.i][0] = snap(wx, e); s.pts[drag.i][1] = snap(wy, e); drag.moved = true; A.mesh = null; A.run = null; refreshScene(); return; }
      if (A.draft && A.draft.kind === 'poly') { A.draft.cur = [snap(wx, e), snap(wy, e)]; V.need = true; }
      const h = A.tool === 'select' ? hitEdge(sx, sy) : null; if (h !== A.hover) { A.hover = h; V.need = true; }
      let txt = `${A.doc.study.model === 'axi' ? 'r' : 'x'} ${fmt(wx, 5)}  ${A.doc.study.model === 'axi' ? 'z' : 'y'} ${fmt(wy, 5)} mm`;
      if (A.run) { const f = field(), p = S.probe2D(A.mesh, f.v, wx, wy); if (p) txt += `   ·   ${f.label}: ${fmt(p.v, 5)} ${f.unit}`; }
      else if (h) txt += '   ·   ' + edgeName(h);
      $('st1').textContent = txt;
    });
    cv.addEventListener('pointerup', e => {
      const r = cv.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
      if (is3()) { if (down && Math.hypot(sx - down.sx, sy - down.sy) < 4 && e.button === 0) click3D(e); down = null; return; }
      if (drag && drag.kind === 'draft') {
        const d = A.draft; A.draft = null;
        if (d.kind === 'rect' && Math.abs(d.x1 - d.x0) > 0 && Math.abs(d.y1 - d.y0) > 0) addShape({ kind: 'rect', x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0), h: Math.abs(d.y1 - d.y0), r: 0 }, 'Rectangle');
        else if (d.kind === 'circle' && d.r > 0) addShape({ kind: 'circle', cx: d.cx, cy: d.cy, r: d.r }, 'Circle');
        V.need = true;
      }
      if (drag && (drag.kind === 'move' || drag.kind === 'vertex')) {
        if (drag.moved) { const after = JSON.stringify(A.doc.shapes); A.doc.shapes = JSON.parse(drag.start); commit(drag.kind === 'move' ? 'Move shape' : 'Move corner', d2 => { d2.shapes = JSON.parse(after); }); }
      }
      drag = null; down = null;
    });
    cv.addEventListener('dblclick', () => { if (A.draft && A.draft.kind === 'poly') finishPoly(); });
  }
  function status3D(e) {
    if (!A.run) { const h = V.pick3D(e, 'stl'); $('st1').textContent = h ? `Face ${A.doc._seg.face[h.tri]} · (${h.point.map(v => fmt(v, 4)).join(', ')}) mm` : 'Drag to orbit · right-drag to pan · wheel to zoom'; return; }
    const h = V.pick3D(e, 'field'); if (!h) { $('st1').textContent = ''; return; }
    const n = nearestNode(h), f = field(); $('st1').textContent = `(${Array.from(A.mesh.nodes.subarray(n * 3, n * 3 + 3)).map(v => fmt(v, 4)).join(', ')}) mm · ${f.label}: ${fmt(f.v[n], 5)} ${f.unit}`;
  }
  function nearestNode(h) { const tri = V.fieldTris(), k = h.tri * 3; let best = tri[k], bd = Infinity; for (let j = 0; j < 3; j++) { const n = tri[k + j], p = nodePos(n, curScale), dd = Math.hypot(p[0] - h.point[0], p[1] - h.point[1], p[2] - h.point[2]); if (dd < bd) { bd = dd; best = n; } } return best; }
  function click3D(e) {
    if (A.tool === 'probe') { if (!A.run) return Aero.toast('Solve first, then probe results.'); const h = V.pick3D(e, 'field'); if (h) { A.probes.push({ node: nearestNode(h) }); V.need = true; } return; }
    if (A.run) { Aero.toast('Results are shown — edit supports and loads in the tree, or pick the Probe tool.'); return; }
    const h = V.pick3D(e, 'stl'); const t = h ? 'f' + A.doc._seg.face[h.tri] : null;
    if (!t) { if (!e.shiftKey) A.sel.clear(); }
    else if (e.shiftKey || e.ctrlKey) A.sel.has(t) ? A.sel.delete(t) : A.sel.add(t); else { A.sel.clear(); A.sel.add(t); }
    selChanged();
  }
  function selChanged() { if (is3()) V.recolorSTL(); V.need = true; renderDetails(); $('st1').textContent = A.sel.size ? `${A.sel.size} ${is3() ? 'face' : 'edge'}${A.sel.size > 1 ? 's' : ''} selected — use Insert to add a support or load` : ''; }
  function finishPoly() { const d = A.draft; A.draft = null; if (d && d.pts.length >= 3) addShape({ kind: 'poly', pts: d.pts.map(p => [p[0], p[1], 0]) }, 'Polygon'); V.need = true; }
  function addShape(s, label) {
    const ids = new Set(A.doc.shapes.map(x => x.id)); let i = A.doc.shapes.length + 1; while (ids.has('s' + i)) i++;
    s.id = 's' + i; s.name = label + ' ' + i;
    commit('Add ' + label.toLowerCase(), d => { d.shapes.push(s); }); A.tree = 'shape:' + s.id; renderTree(); renderDetails();
    if (A.doc.shapes.length === 1) fitView();
  }

  // ---------- commands ----------
  function addBC(kind) {
    const needs = !['gravity', 'rotation'].includes(kind);
    if (needs && !A.sel.size) { Aero.alert(S.BC_KINDS[kind], `Select the ${is3() ? 'faces' : 'edges'} first: click them with the Select tool (Shift-click to add more), then choose ${S.BC_KINDS[kind]} again.`); return; }
    const ids = new Set(A.doc.bcs.map(b => b.id)); let i = A.doc.bcs.length + 1; while (ids.has('b' + i)) i++;
    const b = { id: 'b' + i, kind, name: S.BC_KINDS[kind], targets: needs ? [...A.sel] : [], on: true };
    if (kind === 'force' || kind === 'bearing') Object.assign(b, { x: 0, y: is3() ? 0 : -1000, z: is3() ? -1000 : 0 });
    if (kind === 'pressure') b.p = 1;
    if (kind === 'gravity') Object.assign(b, { x: 0, y: is3() ? 0 : -9.80665, z: is3() ? -9.80665 : 0 });
    if (kind === 'rotation') b.rpm = 3000;
    if (kind === 'disp') Object.assign(b, { x: 0, y: null, z: null });
    commit('Add ' + S.BC_KINDS[kind].toLowerCase(), d => d.bcs.push(b)); A.sel.clear(); A.tree = 'bc:' + b.id; renderAll();
  }
  function deleteSelected() {
    if (A.tree.startsWith('bc:')) { const id = A.tree.slice(3); commit('Delete ' + (A.doc.bcs.find(b => b.id === id) || {}).name, d => { d.bcs = d.bcs.filter(b => b.id !== id); }); A.tree = 'analysis'; renderAll(); }
    else if (A.tree.startsWith('shape:')) { const id = A.tree.slice(6); commit('Delete shape', d => { d.shapes = d.shapes.filter(s => s.id !== id); d.bcs.forEach(b => b.targets = b.targets.filter(t => !t.startsWith(id + ':'))); Object.keys(d.mesh.refine).forEach(k => { if (k.startsWith(id + ':')) delete d.mesh.refine[k]; }); }); A.tree = 'geometry'; renderAll(); }
  }
  const tick = () => new Promise(r => setTimeout(r, 30));
  function progress(msg) { $('prog').hidden = false; $('progMsg').textContent = msg; }
  function progressDone() { $('prog').hidden = true; }
  async function meshNow(show = true) {
    progress(is3() ? 'Voxelising the solid…' : 'Meshing…'); await tick();
    try { A.mesh = S.meshDoc(A.doc); A.meshKey = meshKeyOf(A.doc); }
    catch (e) { progressDone(); Aero.alert('Meshing failed', e.message); return false; }
    progressDone(); if (show) { A.tree = 'mesh'; A.run = null; } renderAll(); return true;
  }
  let worker = null, jobId = 0;
  function getWorker() { if (worker) return worker; try { worker = new Worker('js/worker.js'); } catch (e) { worker = null; } return worker; }
  function runSolver(model) {
    return new Promise((resolve, reject) => {
      const w = getWorker(), id = ++jobId;
      if (!w) { setTimeout(() => { try { resolve(window.StressFem.solve(model, progress)); } catch (e) { reject(e); } }, 30); return; }
      w.onmessage = e => { const m = e.data; if (m.id !== id) return; if (m.type === 'progress') progress(m.msg); else if (m.type === 'done') resolve(m.res); else reject(new Error(m.message)); };
      w.onerror = e => { reject(new Error(e.message || 'Solver worker failed')); };
      A.cancel = () => { w.terminate(); worker = null; reject(new Error('cancelled')); };
      w.postMessage({ id, model });
    });
  }
  async function solve() {
    if (A.solving) return;
    if (!A.doc.shapes.length && !A.doc.solid) return Aero.alert('Nothing to solve', 'Draw or import geometry first, or open a sample.');
    stopAnim();
    if (!A.mesh && !(await meshNow(false))) return;
    let b; try { b = S.buildModel(A.doc, A.mesh); } catch (e) { return Aero.alert('Setup problem', e.message); }
    if (A.doc.analysis.type === 'static' && !b.model.fixed.length && !b.model.springs.length) return Aero.alert('No supports', 'Add a fixed or frictionless support (select edges or faces, then Insert → Fixed support) so the part cannot move freely.');
    A.solving = true; renderStatus(); renderResults(); progress('Starting solver…');
    const t0 = performance.now();
    try {
      const res = await runSolver(b.model);
      const sum = S.summarize(A.doc, A.mesh, b.model, res, b.groups);
      A.run = { res, sum, groups: b.groups, warnings: b.warnings, model: b.model, ms: performance.now() - t0 };
      A.result = res.modes ? 'mode0' : (fields().some(f => f.key === A.result) && !A.result.startsWith('mode') ? A.result : 'vm');
      A.tree = 'solution'; A.probes = [];
      if (b.warnings.length) Aero.toast(b.warnings[0], 4000);
    } catch (e) { if (e.message !== 'cancelled') Aero.alert('Solver error', e.message); }
    finally { A.solving = false; progressDone(); renderAll(); }
  }
  // animation of the deformed shape or mode
  function stopAnim() { if (A.anim) { cancelAnimationFrame(A.anim.raf); A.anim = null; if (A.run) V.setDeform(curScale); } }
  function toggleAnim() {
    if (A.anim) { stopAnim(); renderCmd(); V.need = true; return; } if (!A.run) return;
    const base = deformScale() || (A.deform === '0' ? (A.deform = 'auto', deformScale()) : 0); refreshScene();
    const modal = !!A.run.res.modes, t0 = performance.now();
    A.anim = { raf: 0 };
    const step = () => { const t = (performance.now() - t0) / 1000, s = modal ? Math.sin(t * 2 * Math.PI * 0.8) : (1 - Math.cos(t * 2 * Math.PI * 0.5)) / 2; curScale = base * s; V.setDeform(curScale); A.anim.raf = requestAnimationFrame(step); };
    step(); renderCmd();
  }
  function fitView() {
    if (is3()) { if (A.doc.solid) V.fit3D(VX.bbox(A.doc.solid.tris)); return; }
    const b = A.doc.shapes.length ? G.bounds(A.doc.shapes) : { x0: 0, y0: 0, w: 200, h: 120 }; V.fit2D(b);
  }
  function view3D(name) { if (!is3() || !A.doc.solid) return; V.fit3D(VX.bbox(A.doc.solid.tris), { iso: [1, -1.35, 0.95], front: [0, -1, 0.0001], top: [0.0001, -0.0002, 1], right: [1, 0, 0.0001] }[name]); }
  function zoom(f) { if (is3()) V.dolly(1 / f); else V.zoomAt(f, V.W / 2, V.H / 2); }

  // ---------- files ----------
  async function save(as) {
    const p = await Aero.saveFile({ name: A.doc.name + '.lstress', data: S.serialize(A.doc), filters: [{ name: 'Lumen Stress study', extensions: ['lstress'] }], path: as ? null : A.filePath });
    if (p) { if (typeof p === 'string') A.filePath = p; Aero.setDoc(A.doc.name, false); return true; } return false;
  }
  const text = f => typeof f.data === 'string' ? f.data : new TextDecoder().decode(f.data);
  async function openFiles(files) {
    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      try {
        if (ext === 'dxf') importDXF(f);
        else if (ext === 'stl') importSTL(f);
        else { const j = JSON.parse(text(f)); load(S.sanitize(j), f.name.replace(/\.[^.]+$/, ''), f.path); }
      } catch (e) { Aero.alert('Couldn’t open ' + f.name, e.message); }
    }
  }
  function importDXF(f) {
    const r = G.parseDXF(text(f)); if (!r.shapes.length) throw new Error('No closed outlines (polylines, circles or chains of lines and arcs) were found.' + (r.warnings.length ? '\n\n' + r.warnings.join('\n') : ''));
    const ids = new Set(A.doc.shapes.map(s => s.id)); r.shapes.forEach((s, i) => { let k = 1; while (ids.has('d' + k)) k++; s.id = 'd' + k; ids.add(s.id); s.name = (s.name || 'Outline') + ' ' + k; });
    const wasEmpty = !A.doc.shapes.length;
    commit('Import ' + f.name, d => { if (d.study.kind === '3d') { d.study.kind = '2d'; d.bcs = d.bcs.filter(b => !b.targets.length); } d.shapes.push(...r.shapes); if (wasEmpty && d.name === 'Untitled') d.name = f.name.replace(/\.[^.]+$/, ''); });
    Aero.setDoc(A.doc.name); fitView();
    const cr = G.crossings(A.doc.shapes); Aero.toast(`Imported ${r.shapes.length} outline${r.shapes.length > 1 ? 's' : ''}` + (r.warnings.length ? ' — ' + r.warnings.join(' ') : '') + (cr.length ? ' — warning: outlines cross each other' : ''), 5000);
  }
  function importSTL(f) {
    const tris = VX.parseSTL(f.data instanceof ArrayBuffer ? new Uint8Array(f.data) : new TextEncoder().encode(f.data));
    if (tris.length / 9 > 400000) throw new Error('This STL has more than 400,000 triangles; simplify it first.');
    const seg = VX.segmentFaces(tris);
    commit('Import ' + f.name, d => { d.study.kind = '3d'; d.solid = { name: f.name.replace(/\.[^.]+$/, ''), tris }; d._seg = seg; d.bcs = d.bcs.filter(b => !b.targets.length).map(b => b.kind === 'gravity' ? Object.assign(b, { x: 0, y: 0, z: -9.80665 }) : b); if (d.name === 'Untitled') d.name = d.solid.name; });
    A.sel.clear(); Aero.setDoc(A.doc.name); fitView();
    Aero.toast(`${(tris.length / 9).toLocaleString()} triangles, ${seg.faces.length} faces` + (seg.watertight ? '' : ` — warning: ${seg.openEdges} open edges, the surface is not closed`), 5000);
  }
  async function importDialog(kind) { const fs = await Aero.openFile({ accept: kind === 'dxf' ? '.dxf' : '.stl', filters: [{ name: kind.toUpperCase(), extensions: [kind] }] }); if (fs && fs.length) openFiles(fs); }
  function saveText(name, data, ext, label) { return Aero.saveFile({ name: A.doc.name + name, data, filters: [{ name: label, extensions: [ext] }] }); }
  const needRun = () => { if (!A.run) { Aero.alert('No results', 'Solve the study first (F5).'); return false; } return true; };
  function viewCanvas() { V.renderNow(); const { gl, ov } = V.canvases(), c = document.createElement('canvas'); c.width = ov.width; c.height = ov.height; const x = c.getContext('2d'); x.fillStyle = '#f3f6fa'; x.fillRect(0, 0, c.width, c.height); x.drawImage(gl, 0, 0, c.width, c.height); x.drawImage(ov, 0, 0); return c; }
  async function exportPNG() { const c = viewCanvas(), b = await new Promise(r => c.toBlob(r, 'image/png')); Aero.saveFile({ name: A.doc.name + '.png', data: b, filters: [{ name: 'PNG image', extensions: ['png'] }] }); }
  function reportImages() {
    const keep = { result: A.result, deform: A.deform }, imgs = [];
    const keys = A.run.res.modes ? A.run.res.modes.slice(0, 2).map((m, i) => 'mode' + i) : ['vm', 'umag'];
    stopAnim();
    for (const k of keys) { A.result = k; refreshScene(); imgs.push({ title: field().label + (field().unit && !k.startsWith('mode') ? ` (${field().unit})` : ''), canvas: viewCanvas() }); }
    A.result = keep.result; A.deform = keep.deform; refreshScene(); renderCmd();
    return imgs;
  }
  function reportSections() {
    const d = A.doc, r = A.run, s = r.sum, inf = r.res.info, dimK = is3() ? ['X', 'Y', 'Z'] : d.study.model === 'axi' ? ['R', 'Z'] : ['X', 'Y'];
    const model = [['Study', (is3() ? '3-D solid (voxel bricks)' : MODEL_NAME[d.study.model]) + ' · ' + (d.analysis.type === 'modal' ? 'Modal' : 'Static structural')], ...(is3() || d.study.model === 'axi' ? [] : [['Thickness', fmt(d.study.thickness) + ' mm']]), ['Material', d.material.name], ['E · ν · ρ', `${fmt(d.material.E / 1000)} GPa · ${d.material.nu} · ${d.material.rho} kg/m³`], ['Yield / tensile', `${d.material.Sy} / ${d.material.Su} MPa`], ['Mesh', `${inf.nodes.toLocaleString()} nodes, ${inf.elements.toLocaleString()} ${is3() ? 'bricks' : '6-node triangles'}`], ['Solver', `${inf.precond}, ${inf.total.toFixed(2)} s`]];
    const bcs = d.bcs.filter(b => b.on !== false).map((b, i) => [LETTERS[d.bcs.indexOf(b) % 26] + '  ' + b.name, (b.targets.length ? `${b.targets.length} ${is3() ? 'face' : 'edge'}${b.targets.length > 1 ? 's' : ''}` : '') + (bcValueText(b) ? (b.targets.length ? ' · ' : '') + bcValueText(b) : '')]);
    if (r.res.modes) return [['Model', model], ['Supports', bcs], ['Natural frequencies', s.modes.map(m => ['Mode ' + m.mode, fmt(m.f, 6) + ' Hz'])]];
    const res = [['Max total deformation', fmt(s.maxDisp.v, 4) + ' mm'], ['Max von Mises stress', fmt(s.maxVM.v, 4) + ' MPa'], ['  at', '(' + s.maxVM.at.map(v => fmt(v, 4)).join(', ') + ') mm'], ['Max principal stress', fmt(s.maxS1.v, 4) + ' MPa'], ['Min principal stress', fmt(s.minS3.v, 4) + ' MPa'], ['Min safety factor (yield)', fmt(s.minSF.v, 3) + (s.minSF.v >= S.SF_CAP ? '+' : '')]];
    const reac = s.reactions.map(x => [x.name, x.r.slice(0, dimK.length).map((v, c) => dimK[c] + ' ' + fmt(v, 5)).join(' · ') + ' N']);
    return [['Model', model], ['Supports and loads', bcs], ['Results', res], ['Reaction forces', reac]];
  }
  async function exportReport() {
    if (!needRun()) return;
    const c = R.reportCanvas(A.doc, reportImages(), reportSections(), { footer: is3() ? 'Linear elastic, small deflections. 3-D voxel model: stresses on stair-stepped curved or inclined faces are approximate — overall stiffness, reactions and frequencies are reliable.' : undefined });
    const b = await new Promise(r => c.toBlob(r, 'image/png')); Aero.saveFile({ name: A.doc.name + ' report.png', data: b, filters: [{ name: 'PNG image', extensions: ['png'] }] });
  }
  async function extrudeDialog() {
    if (!A.doc.shapes.length) return Aero.alert('Extrude', 'Draw or import a 2-D outline first.');
    Aero.dialog({ title: 'Extrude outline to a 3-D solid', instruction: 'Turns the 2-D outline into a closed solid of the given depth for a 3-D study. The outline stands in the XZ plane (2-D y becomes Z, up) and the depth runs along −Y. Supports and loads must then be picked on faces.', fields: [{ key: 'depth', label: 'Depth (mm)', type: 'number', value: A.doc.study.thickness || 10, min: 0.001, step: 'any' }],
      onOK: v => {
        const depth = +v.depth; if (!(depth > 0)) return;
        try {
          const m = M2.mesh(A.doc.shapes, { size: S.autoSize(A.doc) * 1.5, quadratic: false, smooth: false }), tris = new Float32Array(G.extrude(m.tri2d, depth).flat(2)), seg = VX.segmentFaces(tris);
          commit('Extrude to 3-D', d => { d.study.kind = '3d'; d.solid = { name: (d.name || 'Part') + ' (extruded)', tris }; d._seg = seg; d.bcs = d.bcs.filter(b => !b.targets.length).map(b => b.kind === 'gravity' ? Object.assign(b, { x: b.x, y: 0, z: b.y }) : b); });
          A.sel.clear(); fitView();
        } catch (e) { Aero.alert('Extrude', e.message); }
      } });
  }
  function shapeDialog(kind) {
    const b = A.doc.shapes.length ? G.bounds(A.doc.shapes) : { x0: 0, y0: 0, w: 100, h: 60 };
    if (kind === 'rect') Aero.dialog({ title: 'Add rectangle', fields: [{ key: 'x', label: 'Corner x (mm)', type: 'number', value: 0 }, { key: 'y', label: 'Corner y (mm)', type: 'number', value: 0 }, { key: 'w', label: 'Width (mm)', type: 'number', value: 100 }, { key: 'h', label: 'Height (mm)', type: 'number', value: 50 }, { key: 'r', label: 'Corner radius (mm)', type: 'number', value: 0 }], onOK: v => { if (+v.w > 0 && +v.h > 0) { addShape({ kind: 'rect', x: +v.x, y: +v.y, w: +v.w, h: +v.h, r: Math.max(0, +v.r || 0) }, 'Rectangle'); fitView(); } } });
    if (kind === 'circle') Aero.dialog({ title: 'Add circle', instruction: 'A circle drawn inside another outline becomes a hole.', fields: [{ key: 'cx', label: 'Centre x (mm)', type: 'number', value: +(b.x0 + b.w / 2).toFixed(3) }, { key: 'cy', label: 'Centre y (mm)', type: 'number', value: +(b.y0 + b.h / 2).toFixed(3) }, { key: 'r', label: 'Radius (mm)', type: 'number', value: +(Math.min(b.w, b.h) / 6).toFixed(3) }], onOK: v => { if (+v.r > 0) addShape({ kind: 'circle', cx: +v.cx, cy: +v.cy, r: +v.r }, 'Circle'); } });
    if (kind === 'poly') Aero.dialog({ title: 'Polygon from coordinates', instruction: 'One point per line: x, y [, bulge]. A bulge turns the edge to the next point into an arc (tan of ¼ of the swept angle; 1 = half circle, positive = counter-clockwise).', fields: [{ key: 'pts', label: 'Points (mm)', type: 'textarea', mono: true, value: '0, 0\n120, 0\n120, 20\n20, 20\n20, 80\n0, 80' }], onOK: v => { const pts = v.pts.split(/\n/).map(l => l.split(/[,;\s]+/).filter(Boolean).map(Number)).filter(p => p.length >= 2 && p.every(Number.isFinite)).map(p => [p[0], p[1], p[2] || 0]); if (pts.length >= 3) { addShape({ kind: 'poly', pts }, 'Polygon'); fitView(); } else Aero.alert('Polygon', 'At least three points are needed.'); } });
  }
  function refineDialog() {
    if (is3()) return Aero.alert('Edge sizing', '3-D voxel meshes are uniform: set the target element count in Mesh.');
    const edges = [...A.sel].filter(t => t.includes(':')); if (!edges.length) return Aero.alert('Edge sizing', 'Select one or more edges first (Select tool, Shift-click to add).');
    const cur = A.doc.mesh.size || S.autoSize(A.doc);
    Aero.dialog({ title: 'Edge sizing', instruction: `Element size along the ${edges.length} selected edge${edges.length > 1 ? 's' : ''}. The mesh grows smoothly back to the global size (${fmt(cur)} mm) away from them.`, fields: [{ key: 's', label: 'Element size (mm)', type: 'number', value: +(cur / 5).toPrecision(2) }], onOK: v => { const s = +v.s; if (s > 0) commit('Edge sizing', d => { edges.forEach(e => d.mesh.refine[e] = s); }); A.tree = 'mesh'; renderAll(); } });
  }
  function switchStudy(v) {
    if (v === '3d' && !is3()) {
      if (!A.doc.solid) { renderCmd(); Aero.dialog({ title: '3-D solid study', instruction: 'A 3-D study needs a closed solid. Import an STL (for example one exported from Lumen CAD) or extrude the current 2-D outline.', fields: [], ok: 'Import STL…', cancel: 'Cancel', onOK: () => importDialog('stl') }); if (A.doc.shapes.length) Aero.toast('Tip: Geometry → Extrude outline to 3-D also works.', 3500); return; }
      commit('3-D study', d => { d.study.kind = '3d'; d.bcs = d.bcs.filter(b => !b.targets.length || b.targets.every(t => /^f\d+$/.test(t))); });
      fitView(); return;
    }
    if (v !== '3d') { const was3 = is3(); commit(MODEL_NAME[v], d => { if (was3) { d.study.kind = '2d'; d.bcs = d.bcs.filter(b => !b.targets.length || b.targets.every(t => t.includes(':'))); } d.study.model = v; }); if (was3) fitView(); }
  }
  function shortcuts() {
    const rows = [['F5', 'Solve'], ['Ctrl+M', 'Generate mesh'], ['V / H', 'Select / pan tool'], ['R / C / P', 'Rectangle / circle / polygon tool (2-D)'], ['X', 'Probe tool'], ['Click, Shift+click', 'Select edges or faces (add to selection)'], ['Enter / double-click', 'Finish polygon'], ['Backspace', 'Remove last polygon point'], ['Esc', 'Cancel drawing, clear selection'], ['Alt while drawing', 'Do not snap to the grid'], ['Delete', 'Delete the selected shape, support or load'], ['F', 'Fit to window'], ['Ctrl+= / Ctrl+−', 'Zoom in / out'], ['Wheel · right-drag', 'Zoom · pan (2-D)'], ['Drag · right-drag', 'Orbit · pan (3-D)'], ['Space', 'Animate deformation / mode shape'], ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+O / Ctrl+S', 'Open / save study']];
    Aero.dialog({ title: 'Keyboard shortcuts', noCancel: true, html: `<table style="border-collapse:collapse;font-size:12px">${rows.map(([k, d]) => `<tr><td style="padding:2px 16px 2px 0;white-space:nowrap"><b>${esc(k)}</b></td><td>${esc(d)}</td></tr>`).join('')}</table>` });
  }
  function about() {
    Aero.dialog({ title: 'How Lumen Stress works', noCancel: true, width: 640, html: `<div class="about">
      <p><b>Lumen Stress 1.2</b> — linear static and modal finite-element analysis, offline and free.</p>
      <p><b>2-D</b> (plane stress, plane strain, axisymmetric): outlines are meshed by a constrained Delaunay triangulator with Ruppert-style refinement (minimum angle ≈ 28°, graded edge sizing), into 6-node quadratic triangles. Midside nodes on arcs sit on the true curve. Stresses are recovered at Gauss points, extrapolated to the nodes and averaged.</p>
      <p><b>3-D</b>: closed STL solids are filled with brick elements on a rectilinear grid snapped to the bounding box and every axis-aligned flat face (so prismatic parts are exact). Bricks use Wilson–Taylor incompatible modes, which bend accurately with few elements through the thickness. Curved and inclined faces are stair-stepped, so peak stresses on them are approximate; reactions, deflections and frequencies are reliable. Supports and loads are picked on CAD-like faces found by grouping STL triangles, then mapped to the nearest voxel faces.</p>
      <p><b>Solvers</b>: preconditioned conjugate gradients with an incomplete-Cholesky IC(0) preconditioner on an RCM-ordered sparse matrix, or an exact skyline Cholesky for small/slender models. Natural frequencies come from LOBPCG with consistent mass.</p>
      <p><b>Validation</b> (run <span class="mono">node stress/tests/validate.test.js</span>): cantilever deflection (−0.18 %) and bending stress (0.0 %), plate-with-hole Kt = 3.04 vs 3.03 (+0.17 %), Lamé thick cylinder (−0.02 %), rotating disc (+0.02 %), cantilever natural frequency (−0.13 %), 3-D voxel cantilever (−0.38 % deflection, +0.05 % frequency).</p>
      <p><b>Not included</b>: contact, plasticity and other nonlinearity, large deflection, buckling, thermal stress, fatigue, bolts and beams/shells, and true tetrahedral meshing of curved 3-D surfaces. Verify critical designs independently.</p>
      <p class="dim">3-D view: three.js (MIT). Part of Lumen Studio.</p></div>` });
  }

  const ACTIONS = {
    rect: () => shapeDialog('rect'), circle: () => shapeDialog('circle'), poly: () => shapeDialog('poly'), importDXF: () => importDialog('dxf'), importSTL: () => importDialog('stl'), extrude: extrudeDialog,
    to2d: () => switchStudy(A.doc.study.model), delShape: deleteSelected, delBC: deleteSelected, refine: refineDialog, mesh: () => meshNow(true), solve,
    useSel: () => { const id = A.tree.slice(3), sel = [...A.sel]; if (!sel.length) return Aero.alert('Scope', 'Select edges or faces first.'); commit('Change scope', d => { d.bcs.find(b => b.id === id).targets = sel; }); A.sel.clear(); renderAll(); },
    selBC: () => { const b = A.doc.bcs.find(x => 'bc:' + x.id === A.tree); A.sel = new Set(b.targets); selChanged(); },
    addFixed: () => addBC('fixed'), addRoller: () => addBC('roller'), addForce: () => addBC('force'), addPressure: () => addBC('pressure')
  };

  // ---------- init ----------
  V.init($('stage'), drawOverlay);
  tb = Aero.toolbox($('tools'), [
    { id: 'select', title: 'Select edges / faces, move shapes', key: 'V', icon: '<path d="M5 3l12 8-6 1-3 6z"/>' },
    { id: 'pan', title: 'Pan (2-D)', key: 'H', icon: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>' }, null,
    { id: 'rect', title: 'Rectangle', key: 'R', icon: '<rect x="4" y="6" width="16" height="12" rx="1"/>' },
    { id: 'circle', title: 'Circle (inside a plate = hole)', key: 'C', icon: '<circle cx="12" cy="12" r="8"/>' },
    { id: 'poly', title: 'Polygon — click corners, double-click to finish', key: 'P', icon: '<path d="M4 18 6 6l8-2 6 9-7 7z"/>' }, null,
    { id: 'probe', title: 'Probe result values', key: 'X', icon: '<circle cx="9" cy="9" r="5"/><path d="M13 13l7 7"/><path d="M9 7v4M7 9h4"/>' }
  ], id => { A.tool = id; A.draft = null; const cv = V.overlayCanvas(); cv.style.cursor = { pan: 'grab', rect: 'crosshair', circle: 'crosshair', poly: 'crosshair', probe: 'help' }[id] || 'default'; syncTools(); V.need = true; });
  const samples = window.StressSamples;
  Aero.init({ name: 'Lumen Stress', icon: '../kit/icons/stress.png', doc: 'Untitled', onDropFiles: openFiles, dropText: 'Drop a .lstress study, a .dxf outline or an .stl solid', onSave: () => save(false),
    menus: {
      File: [['New study', 'Ctrl+N', async () => { if (window.__lumenDirty && !(await Aero.confirm('New study', 'Discard unsaved changes?'))) return; load(S.newDoc('2d'), 'Untitled'); }], ['Open…', 'Ctrl+O', async () => openFiles(await Aero.openFile({ accept: '.lstress,.json,.dxf,.stl', filters: [{ name: 'Studies and geometry', extensions: ['lstress', 'dxf', 'stl'] }] }))], '-',
        '#Open sample', ...samples.map(s => [s.name, '', () => openSample(s.id)]), '-',
        ['Save', 'Ctrl+S', () => save(false)], ['Save as…', 'Ctrl+Shift+S', () => save(true)], '-', '#Import',
        ['DXF outline (2-D)…', '', () => importDialog('dxf')], ['STL solid (3-D)…', '', () => importDialog('stl')], '#Export',
        ['Results table (.csv)…', '', () => needRun() && saveText('-results.csv', R.csv(A.doc, A.mesh, A.run.res), 'csv', 'CSV')],
        ['ParaView / VTK (.vtk)…', '', () => needRun() && saveText('.vtk', R.vtk(A.doc, A.mesh, A.run.res), 'vtk', 'VTK legacy')],
        ['Picture of the view (.png)…', '', exportPNG], ['Report (.png)…', 'Ctrl+P', exportReport],
        ['Geometry as STL…', '', () => { if (!A.doc.solid) return Aero.alert('Export STL', 'Only 3-D solids can be exported as STL (use Geometry → Extrude for a 2-D outline).'); Aero.saveFile({ name: A.doc.solid.name + '.stl', data: VX.toSTL(A.doc.solid.tris, A.doc.solid.name), filters: [{ name: 'STL', extensions: ['stl'] }] }); }]],
      Edit: [['Undo', 'Ctrl+Z', () => restore(hist.undo())], ['Redo', 'Ctrl+Y', () => restore(hist.redo())], '-', ['Delete', 'Delete', deleteSelected], ['Clear selection', 'Escape', () => { if (A.draft) { A.draft = null; V.need = true; return; } A.sel.clear(); selChanged(); }]],
      View: [['Zoom in', 'Ctrl+=', () => zoom(1.25)], ['Zoom out', 'Ctrl+-', () => zoom(0.8)], ['Fit to window', 'F', fitView], '-', '#3-D views', ['Isometric', '', () => view3D('iso')], ['Front', '', () => view3D('front')], ['Top', '', () => view3D('top')], ['Right', '', () => view3D('right')], '-',
        { label: 'Show mesh lines', fn: () => { A.showMesh = !A.showMesh; renderCmd(); refreshScene(); }, checked: () => A.showMesh }, { label: 'Banded contours', fn: () => { A.bands = A.bands ? 0 : 9; renderCmd(); refreshScene(); }, checked: () => !!A.bands }, ['Animate', 'Space', toggleAnim], ['Clear probes', '', () => { A.probes = []; V.need = true; }]],
      Geometry: [['Rectangle tool', '', () => tb.set('rect')], ['Circle tool', '', () => tb.set('circle')], ['Polygon tool', '', () => tb.set('poly')], '-', ['Add rectangle…', '', () => shapeDialog('rect')], ['Add circle…', '', () => shapeDialog('circle')], ['Polygon from coordinates…', '', () => shapeDialog('poly')], '-', ['Extrude outline to 3-D…', '', extrudeDialog]],
      Mesh: [['Generate mesh', 'Ctrl+M', () => meshNow(true)], ['Edge sizing for selected edges…', '', refineDialog], ['Clear edge sizing', '', () => commit('Clear edge sizing', d => { d.mesh.refine = {}; })], ['Mesh settings', '', () => { A.tree = 'mesh'; renderAll(); }]],
      Insert: ['#Supports', ['Fixed support', '', () => addBC('fixed')], ['Frictionless support', '', () => addBC('roller')], ['Displacement', '', () => addBC('disp')], '#Loads', ['Force', '', () => addBC('force')], ['Bearing load', '', () => addBC('bearing')], ['Pressure', '', () => addBC('pressure')], ['Standard earth gravity', '', () => addBC('gravity')], ['Rotational velocity', '', () => addBC('rotation')]],
      Solve: [['Solve', 'F5', solve], '-', { label: 'Static structural', fn: () => commit('Static analysis', d => { d.analysis.type = 'static'; }), checked: () => A.doc.analysis.type === 'static' }, { label: 'Modal (natural frequencies)', fn: () => commit('Modal analysis', d => { d.analysis.type = 'modal'; }), checked: () => A.doc.analysis.type === 'modal' }, '-',
        { label: 'Solver: program controlled', fn: () => commit('Solver', d => { d.mesh.solver = 'auto'; }), checked: () => A.doc.mesh.solver === 'auto' }, { label: 'Solver: iterative (PCG)', fn: () => commit('Solver', d => { d.mesh.solver = 'pcg'; }), checked: () => A.doc.mesh.solver === 'pcg' }, { label: 'Solver: direct', fn: () => commit('Solver', d => { d.mesh.solver = 'direct'; }), checked: () => A.doc.mesh.solver === 'direct' }],
      Help: [['Keyboard shortcuts', 'F1', shortcuts], ['How it works and validation', '', about], ['About Lumen Stress', '', () => Aero.alert('About Lumen Stress', 'Lumen Stress 1.2 — structural finite-element analysis: 2-D plane stress, plane strain and axisymmetric studies with an automatic quadratic triangle mesher, 3-D voxel solids from STL, static stress and natural frequencies.\n\n3-D view: three.js (MIT).\n\nPart of Lumen Studio — free and offline.')]]
    } });
  Aero.shortcut('Enter', () => { if (A.draft && A.draft.kind === 'poly') finishPoly(); });
  Aero.shortcut('Backspace', () => { if (A.draft && A.draft.kind === 'poly') { A.draft.pts.pop(); V.need = true; } });
  Aero.shortcut('Space', toggleAnim);
  $('studySel').onchange = e => switchStudy(e.target.value);
  $('bMesh').onclick = () => meshNow(true); $('bSolve').onclick = solve; $('bAnim').onclick = toggleAnim;
  $('resSel').onchange = e => { A.result = e.target.value; stopAnim(); refreshScene(); renderResults(); };
  $('defSel').onchange = e => { A.deform = e.target.value; stopAnim(); refreshScene(); renderCmd(); };
  $('bandSel').onchange = e => { A.bands = +e.target.value; refreshScene(); };
  $('chkMesh').onchange = e => { A.showMesh = e.target.checked; refreshScene(); };
  $('progCancel').onclick = () => { if (A.cancel) A.cancel(); };
  document.querySelectorAll('#welcome [data-w]').forEach(b => b.onclick = () => { const w = b.dataset.w; if (w === 'rect') tb.set('rect'); else if (w === 'dxf') importDialog('dxf'); else if (w === 'stl') importDialog('stl'); else openSample(w); });
  bindMouse(); tb.set('select');
  function openSample(id) { const s = samples.find(x => x.id === id); load(s.make(), s.name.replace(/ \(.*\)$/, '')); }
  Object.assign(A, { load, solve, meshNow, openFiles, addBC, field, fields, commit, refreshScene, renderAll, exportReport, reportCanvas: () => R.reportCanvas(A.doc, reportImages(), reportSections()), openSample, hist, restore, viewCanvas, switchStudy });
  openSample('lug');
})();
