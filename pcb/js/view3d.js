// Lumen PCB 3-D board preview: orthographic orbit view of the finished board — soldermask, copper, gold pads,
// silkscreen and drilled holes as a texture on a 1.6 mm FR-4 slab, plus simple 3-D bodies for every footprint.
// Pure Canvas 2D: with an orthographic camera every flat face maps affinely, so no WebGL is needed.
(function () {
  const Core = window.PcbCore;
  const T = 1.6;                                   // board thickness (mm)
  let A, cv, g, cam = null, showParts = true, drag = null, tex = { key: null, top: null, bottom: null, s: 1 }, texDirty = true;
  const home = () => ({ yaw: -28, el: 42, zoom: 1, px: 0, py: 0 });
  const COL = { mask: '#1d6a3a', maskCu: '#2c8a4e', gold: '#d9b25c', silk: '#f4f4ee', edge: '#b9b07a', bg0: '#26303b', bg1: '#0e1319' };

  // ---------- component bodies (footprint-local mm, z up from the board surface) ----------
  const box = (x, y, w, l, z0, h, col) => ({ t: 'box', x, y, w, l, z0, h, col });
  const cyl = (x, y, r, z0, h, col, axis = 'z') => ({ t: 'cyl', x, y, r, z0, h, col, axis });   // axis x/y: (x,y) = centre, z0 = axis height, h = length
  function bodies(fp) {
    const name = fp.fp, def = window.PcbLib.FP[name]; if (!def) return [];
    const pads = def.pads, out = [], leads = (h = 1.2, col = '#c8ccd0') => pads.filter(p => p.drill).forEach(p => out.push(box(p.x, p.y, 0.5, 0.5, 0, h, col)));
    let m;
    if ((m = /^DIP_(\d+)$/.exec(name)) || name === 'DIP_SW_4') {
      const n = m ? +m[1] : 8, L = (n / 2 - 1) * 2.54 + 2.6; leads(0.9);
      pads.forEach(p => out.push(box(p.x * 0.86, p.y, 1.1, 0.5, 0.6, 0.35, '#c8ccd0')));
      out.push(box(0, 0, name === 'DIP_SW_4' ? 9.8 : 6.35, name === 'DIP_SW_4' ? 10.4 : L, 0.5, name === 'DIP_SW_4' ? 3.6 : 3.3, name === 'DIP_SW_4' ? '#c0282a' : '#1e1e22'));
      if (name === 'DIP_SW_4') [0, 1, 2, 3].forEach(i => out.push(box(0, (i - 1.5) * 2.54, 3, 1.1, 4.1, 0.6, '#f2f2f2')));
      else out.push(cyl(0, -L / 2 + 0.9, 0.45, 3.8, 0.04, '#0b0b0d'));
    } else if ((m = /^SOIC_(\d+)$/.exec(name))) {
      const n = +m[1], L = (n / 2 - 1) * 1.27 + 1.0;
      pads.forEach(p => out.push(box(p.x * 0.85, p.y, 1.3, 0.42, 0.05, 0.45, '#c8ccd0')));
      out.push(box(0, 0, 3.9, L, 0.15, 1.5, '#1e1e22'));
    } else if (name === 'R_Axial_10mm' || name === 'D_DO35') {
      const res = name[0] === 'R', len = res ? 6.4 : 3.8, r = res ? 1.2 : 0.9, zc = r + 0.4;
      pads.forEach(p => { out.push(box(p.x, 0, 0.5, 0.5, 0, zc, '#c8ccd0')); out.push(box(p.x / 2 + Math.sign(p.x) * len / 4, 0, Math.abs(p.x) - len / 2 + 0.2, 0.5, zc - 0.25, 0.5, '#c8ccd0')); });
      out.push(cyl(0, 0, r, zc, len, res ? '#d9c39a' : '#c4541f', 'x'));
      if (res) [['#6b3b1a', -2.1], ['#1d1d1d', -1.3], ['#c0392b', -0.5], ['#c9a227', 2.0]].forEach(([c, x]) => out.push({ ...cyl(x, 0, r + 0.04, zc, 0.45, c, 'x'), on: true }));
      else out.push({ ...cyl(-1.3, 0, r + 0.04, zc, 0.5, '#1d1d1d', 'x'), on: true });
    } else if (name === 'CP_Radial_5mm') { leads(0.4); out.push(cyl(0, 0, 2.5, 0.4, 10.6, '#1f3f93'), cyl(0, 0, 2.3, 11, 0.05, '#c3cad2'), { ...box(-2.3, 0, 0.5, 1.5, 0.45, 10.5, '#b8c4dd'), on: true }); }
    else if (name === 'C_Disc_5mm') { pads.forEach(p => out.push(box(p.x * 0.6, 0, 0.5, 0.5, 0, 2.4, '#c8ccd0'))); out.push(cyl(0, 0, 2.7, 4.6, 1.8, '#e0a032', 'y')); }
    else if (name === 'LED_5mm') { leads(1); out.push(cyl(0, 0, 2.9, 1, 1, '#d92c22'), cyl(0, 0, 2.5, 2, 5.2, '#ef3b2c'), cyl(0, 0, 2.1, 7.2, 0.6, '#f0533e'), cyl(0, 0, 1.4, 7.8, 0.45, '#f36a55')); }
    else if (name === 'L_Radial_5mm') { leads(0.4); out.push(cyl(0, 0, 3.5, 0.4, 6, '#3b3b3b')); }
    else if (name === 'TO_92') { leads(2); out.push(cyl(0, 0.3, 2.3, 2, 4.6, '#1e1e22')); }
    else if (name === 'TO_220') { leads(3); out.push(box(0, 0.4, 10, 4.4, 3, 9, '#1e1e22'), box(0, 2.0, 10, 1.3, 3, 15.5, '#c4c9ce')); }
    else if (name === 'SOT_23') { pads.forEach(p => out.push(box(p.x, p.y * 0.8, 0.4, 0.6, 0.05, 0.4, '#c8ccd0'))); out.push(box(0, 0, 2.9, 1.3, 0.1, 1.0, '#1e1e22')); }
    else if ((m = /^Header_1x(\d+)$/.exec(name))) { const n = +m[1]; out.push(box(0, 0, 2.54, n * 2.54, 0, 2.5, '#1b1b1b')); pads.forEach(p => out.push(box(p.x, p.y, 0.64, 0.64, 2.5, 6, '#e3c055'))); }
    else if (name === 'SW_Tactile_6mm') { leads(0.6); out.push(box(0, 0, 6, 6, 0.3, 3.4, '#3a3d42'), cyl(0, 0, 1.75, 3.7, 1.5, '#121212')); }
    else if (name === 'Crystal_HC49') { leads(0.4); out.push(box(0, 0, 11, 4.6, 0.4, 3.6, '#c9ced3')); }
    else if (name === 'Pot_Trimmer_3pin') { leads(0.6); out.push(box(0, -1.4, 9.5, 6.4, 0.6, 4.2, '#2a5db0'), cyl(0, -1.4, 1.6, 4.8, 0.6, '#f2f2f2')); }
    else if (name === 'Buzzer_12mm') { leads(0.4); out.push(cyl(0, 0, 6, 0.4, 9.5, '#1b1b1b'), cyl(0, 0, 1, 9.9, 0.05, '#555')); }
    else if (name === 'MountingHole_3mm') { /* just the plated hole */ }
    else if (pads.length === 2 && !pads[0].drill) {   // two-terminal SMD chips
      const p = pads[1], L = p.x * 2 + p.w * 0.5, W = p.h * 0.85, h = /^C_/.test(name) ? 0.8 : 0.5;
      const body = /^C_/.test(name) ? '#c8a26a' : /^LED/.test(name) ? '#f4f0e6' : /^L_|^Fuse/.test(name) ? '#5d5f63' : '#1e1e22';
      out.push(box(0, 0, L - 0.5, W, 0.05, h, body), box(-L / 2 + 0.25, 0, 0.5, W, 0.05, h, '#cfd3d6'), box(L / 2 - 0.25, 0, 0.5, W, 0.05, h, '#cfd3d6'));
      if (/^LED/.test(name)) out.push(box(0, 0, 0.8, W * 0.6, 0.05 + h, 0.05, '#e53a2c'));
    } else {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; pads.forEach(p => { x0 = Math.min(x0, p.x - p.w / 2); x1 = Math.max(x1, p.x + p.w / 2); y0 = Math.min(y0, p.y - p.h / 2); y1 = Math.max(y1, p.y + p.h / 2); });
      out.push(box((x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, 0.2, 1.5, '#5a5f66'));
    }
    return out;
  }

  // ---------- projection ----------
  let P = null;   // per-frame camera constants
  function setup() {
    const r = cv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1, w = Math.max(10, r.width), h = Math.max(10, r.height);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
    const b = A.doc.board, yaw = cam.yaw * Math.PI / 180, el = cam.el * Math.PI / 180;
    const diag = Math.hypot(b.w, b.h, 14), s = Math.min(w, h) / diag * 0.95 * cam.zoom;
    P = { w, h, dpr, cy: Math.cos(yaw), sy: Math.sin(yaw), ce: Math.cos(el), se: Math.sin(el), s, bw: b.w, bh: b.h };
  }
  // board coordinates (x right, y down, z up from the bottom face) → [screen x, screen y, depth (bigger = nearer)]
  function proj(x, y, z) {
    const cx = x - P.bw / 2, cyy = -(y - P.bh / 2), cz = z - T / 2;
    const X1 = cx * P.cy - cyy * P.sy, Y1 = cx * P.sy + cyy * P.cy;
    return [P.w / 2 + cam.px + X1 * P.s, P.h / 2 + cam.py - (Y1 * P.se + cz * P.ce) * P.s, -Y1 * P.ce + cz * P.se];
  }
  const facing = (nx, ny, nz) => { const cyy = -ny, Y1 = nx * P.sy + cyy * P.cy; return -Y1 * P.ce + nz * P.se; };
  const LIGHT = (() => { const v = [-0.45, -0.55, 0.75], l = Math.hypot(...v); return v.map(c => c / l); })();
  function shade(col, nx, ny, nz) {
    const k = 0.42 + 0.58 * Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
    const n = parseInt(col.slice(1), 16); return `rgb(${Math.round(((n >> 16) & 255) * k)},${Math.round(((n >> 8) & 255) * k)},${Math.round((n & 255) * k)})`;
  }

  // ---------- board artwork textures ----------
  function buildTextures() {
    const b = A.doc.board, key = JSON.stringify([b, [...A.pinNet]]);
    if (tex.key === key) return; tex.key = key;
    const s = Math.max(4, Math.min(16, 2600 / Math.max(b.w, b.h))); tex.s = s;
    const make = side => {
      const c = document.createElement('canvas'); c.width = Math.ceil(b.w * s); c.height = Math.ceil(b.h * s); const t = c.getContext('2d');
      t.scale(s, s); t.lineCap = 'round'; t.lineJoin = 'round';
      t.fillStyle = COL.mask; t.fillRect(0, 0, b.w, b.h);
      t.fillStyle = COL.maskCu; (b.zones || []).filter(z => z.layer === side).forEach(z => { t.beginPath(); Core.zoneRects(Core.fillZone(b, z, A.pinNet)).forEach(([x0, y0, x1, y1]) => t.rect(x0, y0 - 0.01, x1 - x0, y1 - y0 + 0.02)); t.fill(); });
      t.strokeStyle = COL.maskCu; b.tracks.filter(tr => tr.layer === side).forEach(tr => { t.lineWidth = tr.w; t.beginPath(); tr.pts.forEach((p, k) => k ? t.lineTo(...p) : t.moveTo(...p)); t.stroke(); });
      t.fillStyle = COL.maskCu; b.vias.forEach(v => { t.beginPath(); t.arc(v.x, v.y, v.dia / 2, 0, 7); t.fill(); });
      t.fillStyle = COL.gold;
      b.parts.forEach(fp => Core.padsOf(fp).forEach(p => {
        if (!p.layers.includes(side)) return; t.beginPath();
        if (p.shape === 'round') t.arc(p.x, p.y, p.w / 2, 0, 7); else if (p.shape === 'oval') t.roundRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, Math.min(p.w, p.h) / 2); else t.rect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h);
        t.fill();
      }));
      // silkscreen: outlines for parts on this side, reference text on the top side
      t.strokeStyle = COL.silk; t.lineWidth = 0.15;
      b.parts.filter(fp => (fp.side === 'bottom') === (side === 'bottom')).forEach(fp => {
        t.beginPath(); Core.silkOf(fp).forEach(([p, q]) => { t.moveTo(...p); t.lineTo(...q); }); t.stroke();
        if (side === 'top') { const pads = Core.padsOf(fp); let y0 = Infinity, x0 = Infinity, x1 = -Infinity; Core.silkOf(fp).forEach(([p, q]) => { y0 = Math.min(y0, p[1], q[1]); x0 = Math.min(x0, p[0], q[0]); x1 = Math.max(x1, p[0], q[0]); }); pads.forEach(p => { y0 = Math.min(y0, p.y - p.h / 2); });
          t.fillStyle = COL.silk; t.font = '1.1px Segoe UI, sans-serif'; t.textAlign = 'center'; t.textBaseline = 'bottom'; t.fillText(fp.ref, (x0 + x1) / 2, y0 - 0.25); }
      });
      // drilled holes go right through
      t.globalCompositeOperation = 'destination-out';
      const holes = []; b.parts.forEach(fp => Core.padsOf(fp).forEach(p => p.drill && holes.push([p.x, p.y, p.drill]))); b.vias.forEach(v => holes.push([v.x, v.y, v.drill]));
      holes.forEach(([x, y, d]) => { t.beginPath(); t.arc(x, y, d / 2, 0, 7); t.fill(); });
      return c;
    };
    tex.top = make('top'); tex.bottom = make('bottom');
  }

  // ---------- drawing ----------
  function poly(pts, fill, stroke) { g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])); g.closePath(); g.fillStyle = fill; g.fill(); if (stroke) { g.strokeStyle = stroke; g.lineWidth = 0.6; g.stroke(); } }
  function faces(prim, X) {   // world faces of one convex primitive: [{pts:[[x,y,z]…], n:[nx,ny,nz]}]
    const F = [];
    if (prim.t === 'box') {
      const { x, y, w, l, z0, h } = prim, cs = [[x - w / 2, y - l / 2], [x + w / 2, y - l / 2], [x + w / 2, y + l / 2], [x - w / 2, y + l / 2]].map(([a, c]) => X(a, c));
      F.push({ pts: cs.map(([a, c]) => [a, c, X.z(z0 + h)]), up: 1 }, { pts: cs.map(([a, c]) => [a, c, X.z(z0)]).reverse(), up: -1 });
      for (let i = 0; i < 4; i++) { const p = cs[i], q = cs[(i + 1) % 4]; F.push({ pts: [[p[0], p[1], X.z(z0)], [q[0], q[1], X.z(z0)], [q[0], q[1], X.z(z0 + h)], [p[0], p[1], X.z(z0 + h)]] }); }
    } else {
      const n = 22, { x, y, r, z0, h } = prim, ring = [];
      if (prim.axis === 'z') {
        for (let i = 0; i < n; i++) { const a = i / n * 2 * Math.PI; ring.push(X(x + r * Math.cos(a), y + r * Math.sin(a))); }
        F.push({ pts: ring.map(([a, c]) => [a, c, X.z(z0 + h)]), up: 1 }, { pts: ring.map(([a, c]) => [a, c, X.z(z0)]).reverse(), up: -1 });
        for (let i = 0; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; F.push({ pts: [[p[0], p[1], X.z(z0)], [q[0], q[1], X.z(z0)], [q[0], q[1], X.z(z0 + h)], [p[0], p[1], X.z(z0 + h)]] }); }
      } else {   // lying cylinder along local x or y, axis at height z0
        const ax = prim.axis === 'x', e0 = [], e1 = [];
        for (let i = 0; i < n; i++) {
          const a = i / n * 2 * Math.PI, u = r * Math.cos(a), v = z0 + r * Math.sin(a);
          const [p0, p1] = ax ? [X(x - h / 2, y + u), X(x + h / 2, y + u)] : [X(x + u, y - h / 2), X(x + u, y + h / 2)];
          e0.push([p0[0], p0[1], X.z(v)]); e1.push([p1[0], p1[1], X.z(v)]);
        }
        F.push({ pts: e0.slice() }, { pts: e1.slice().reverse() });
        for (let i = 0; i < n; i++) { const j = (i + 1) % n; F.push({ pts: [e0[i], e0[j], e1[j], e1[i]] }); }
      }
    }
    // outward normals from the geometry (Newell), oriented away from the primitive centre
    const c = [0, 0, 0], all = F.flatMap(f => f.pts); all.forEach(p => { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; }); c.forEach((v, i) => c[i] = v / all.length);
    F.forEach(f => {
      let nx = 0, ny = 0, nz = 0; const ps = f.pts;
      for (let i = 0; i < ps.length; i++) { const p = ps[i], q = ps[(i + 1) % ps.length]; nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]); }
      const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
      const m = ps.reduce((s, p) => [s[0] + p[0] / ps.length, s[1] + p[1] / ps.length, s[2] + p[2] / ps.length], [0, 0, 0]);
      if ((m[0] - c[0]) * nx + (m[1] - c[1]) * ny + (m[2] - c[2]) * nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      f.n = [nx, ny, nz];
    });
    return F;
  }
  function drawTexture(img, z) {
    const p0 = proj(0, 0, z), px = proj(P.bw, 0, z), py = proj(0, P.bh, z), tw = img.width, th = img.height, d = P.dpr;
    g.save(); g.setTransform((px[0] - p0[0]) / tw * d, (px[1] - p0[1]) / tw * d, (py[0] - p0[0]) / th * d, (py[1] - p0[1]) / th * d, p0[0] * d, p0[1] * d);
    g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0); g.restore();
  }
  function redraw() {
    if (!A || A.mode !== '3d') return;
    if (!cam) cam = home();
    setup(); if (texDirty) { buildTextures(); texDirty = false; }
    g.setTransform(P.dpr, 0, 0, P.dpr, 0, 0);
    const grd = g.createLinearGradient(0, 0, 0, P.h); grd.addColorStop(0, COL.bg0); grd.addColorStop(1, COL.bg1); g.fillStyle = grd; g.fillRect(0, 0, P.w, P.h);
    const b = A.doc.board, fromTop = P.se >= 0;
    // board slab: visible edges, then the visible face with its artwork
    const corners = [[0, 0], [b.w, 0], [b.w, b.h], [0, b.h]];
    for (let i = 0; i < 4; i++) {
      const [x0, y0] = corners[i], [x1, y1] = corners[(i + 1) % 4];
      const on = [(y1 - y0) === 0 ? 0 : Math.sign(y1 - y0), (x1 - x0) === 0 ? 0 : -Math.sign(x1 - x0)];   // edge normal pointing out of the board
      if (facing(on[0], on[1], 0) <= 0) continue;
      poly([proj(x0, y0, 0), proj(x1, y1, 0), proj(x1, y1, T), proj(x0, y0, T)], shade(COL.edge, on[0], -on[1], 0));
    }
    drawTexture(fromTop ? tex.top : tex.bottom, fromTop ? T : 0);
    if (showParts) {
      const prims = [];
      b.parts.forEach(fp => {
        const bottom = fp.side === 'bottom'; if (bottom === fromTop) return;   // hidden behind the board
        const X = (x, y) => { const [a, c] = Core.rot2(bottom ? -x : x, y, fp.rot || 0); return [fp.x + a, fp.y + c]; };
        X.z = z => bottom ? -z : T + z;
        let base = 0;   // decorations (bands, stripes) are drawn just after the body they sit on
        bodies(fp).forEach(pr => { const F = faces(pr, X); let d = 0, n = 0; F.forEach(f => f.pts.forEach(p => { d += proj(p[0], p[1], p[2])[2]; n++; })); d /= n; if (pr.on) d = base + 1e-3; else base = d; prims.push({ F, d, col: pr.col, round: pr.t === 'cyl' }); });
      });
      prims.sort((a, c) => a.d - c.d);
      prims.forEach(pr => pr.F.forEach(f => { const [nx, ny, nz] = f.n; if (facing(nx, ny, nz) <= 1e-4) return; const c = shade(pr.col, nx, -ny, nz); poly(f.pts.map(p => proj(p[0], p[1], p[2])), c, pr.round && f.pts.length === 4 ? c : 'rgba(0,0,0,.22)'); }));
    }
    // compass / hint
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '12px Segoe UI, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'bottom';
    g.fillText(`${fromTop ? 'Top' : 'Bottom'} side · ${b.w} × ${b.h} × ${T} mm · ${b.parts.length} parts`, 12, P.h - 10);
    A.status('Drag to orbit · Shift-drag pans · wheel zooms · double-click resets the view');
  }
  function draw() { texDirty = true; redraw(); }
  function setView(v) {
    cam = { ...home(), ...(v === 'top' ? { yaw: 0, el: 90 } : v === 'bottom' ? { yaw: 0, el: -90 } : v === 'front' ? { yaw: 0, el: 20 } : {}) };
    redraw();
  }
  function attach(app, canvas) {
    A = app; cv = canvas; g = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', e => { if (A.mode !== '3d' || e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, cam: { ...cam }, pan: e.shiftKey || e.ctrlKey }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', e => {
      if (A.mode !== '3d' || !drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.pan) { cam.px = drag.cam.px + dx; cam.py = drag.cam.py + dy; }
      else { cam.yaw = drag.cam.yaw - dx * 0.45; cam.el = Math.max(-90, Math.min(90, drag.cam.el + dy * 0.45)); }
      redraw();
    });
    addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('wheel', e => { if (A.mode !== '3d') return; e.preventDefault(); cam.zoom = Math.max(0.3, Math.min(12, cam.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); redraw(); }, { passive: false });
    canvas.addEventListener('dblclick', () => { if (A.mode === '3d') setView('iso'); });
  }
  window.View3D = {
    attach, draw, fit: () => setView('iso'), setView, cancel: () => false, toggleBend() { },
    get showParts() { return showParts; }, set showParts(v) { showParts = !!v; redraw(); },
    get camera() { return { ...cam }; }, bodies, textures: () => tex,
  };
})();
