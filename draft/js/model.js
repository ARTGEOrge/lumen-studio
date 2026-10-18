// Lumen Draft — document model: layers, ACI colours, linetypes, hatch patterns, dimensions, blocks,
// and a renderer-agnostic emitter that turns entities into drawing calls for canvas / SVG / PDF sinks.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(require('./geom.js')); else root.LDModel = factory(root.LDGeom); })(typeof self !== 'undefined' ? self : this, function (G) {
  'use strict';
  const TAU = Math.PI * 2;

  /* ---------- AutoCAD Color Index ---------- */
  const ACI = (() => {
    const t = new Array(256);
    t[0] = [0, 0, 0];
    const base = [null, [255, 0, 0], [255, 255, 0], [0, 255, 0], [0, 255, 255], [0, 0, 255], [255, 0, 255], [255, 255, 255], [128, 128, 128], [192, 192, 192]];
    for (let i = 1; i <= 9; i++) t[i] = base[i];
    const V = [255, 165, 127, 76, 38];
    for (let i = 10; i <= 249; i++) {
      const h = Math.floor((i - 10) / 10) * 15, sub = (i - 10) % 10, v = V[sub >> 1] / 255, s = sub & 1 ? 0.5 : 1;
      const f = (n) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
      t[i] = [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
    }
    const grays = [51, 80, 105, 130, 190, 255]; for (let i = 0; i < 6; i++) t[250 + i] = [grays[i], grays[i], grays[i]];
    return t;
  })();
  const COLOR_NAMES = { 1: 'Red', 2: 'Yellow', 3: 'Green', 4: 'Cyan', 5: 'Blue', 6: 'Magenta', 7: 'White', 8: 'Gray', 9: 'Light gray' };
  const colorName = c => c == null || c === 256 ? 'ByLayer' : c === 0 ? 'ByBlock' : (COLOR_NAMES[c] || 'Color ' + c);
  const rgbToAci = (r, g, b) => { let best = 7, bd = Infinity; for (let i = 1; i < 256; i++) { const c = ACI[i], d = (c[0] - r) ** 2 + (c[1] - g) ** 2 + (c[2] - b) ** 2; if (d < bd) { bd = d; best = i; } } return best; };

  /* ---------- linetypes (acadiso.lin, mm) ---------- */
  const LTYPES = {
    CONTINUOUS: { desc: 'Solid line', pat: [] },
    DASHED: { desc: '__ __ __ __', pat: [12.7, -6.35] }, DASHED2: { desc: '_ _ _ _ _ (.5x)', pat: [6.35, -3.175] },
    HIDDEN: { desc: '_ _ _ _ _ _', pat: [6.35, -3.175] }, HIDDEN2: { desc: '_ _ _ _ _ (.5x)', pat: [3.175, -1.5875] },
    CENTER: { desc: '____ _ ____ _', pat: [31.75, -6.35, 6.35, -6.35] }, CENTER2: { desc: '___ _ ___ _ (.5x)', pat: [19.05, -3.175, 3.175, -3.175] },
    PHANTOM: { desc: '_____ _ _ _____', pat: [31.75, -6.35, 6.35, -6.35, 6.35, -6.35] },
    DOT: { desc: '. . . . . . .', pat: [0, -6.35] },
    DASHDOT: { desc: '__ . __ . __', pat: [12.7, -6.35, 0, -6.35] },
    BORDER: { desc: '__ __ . __ __ .', pat: [12.7, -6.35, 12.7, -6.35, 0, -6.35] },
    DIVIDE: { desc: '__ . . __ . .', pat: [12.7, -6.35, 0, -6.35, 0, -6.35] },
  };
  const LWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
  const DEFAULT_LW = 25;

  /* ---------- hatch patterns (AutoCAD .pat: angle, x0,y0, dx,dy [,dashes]) ---------- */
  const PATTERNS = {
    SOLID: { desc: 'Solid fill', fams: [] },
    ANSI31: { desc: 'Iron, brick, stone', fams: [{ a: 45, x: 0, y: 0, dx: 0, dy: 3.175 }] },
    ANSI32: { desc: 'Steel', fams: [{ a: 45, x: 0, y: 0, dx: 0, dy: 9.525 }, { a: 45, x: 4.49013, y: 0, dx: 0, dy: 9.525 }] },
    ANSI33: { desc: 'Bronze, brass, copper', fams: [{ a: 45, x: 0, y: 0, dx: 0, dy: 6.35 }, { a: 45, x: 4.49013, y: 0, dx: 4.49013, dy: 6.35, dash: [3.175, -1.5875] }] },
    ANSI37: { desc: 'Lead, zinc, rubber', fams: [{ a: 45, x: 0, y: 0, dx: 0, dy: 3.175 }, { a: 135, x: 0, y: 0, dx: 0, dy: 3.175 }] },
    ANSI38: { desc: 'Aluminium', fams: [{ a: 45, x: 0, y: 0, dx: 0, dy: 3.175 }, { a: 135, x: 0, y: 0, dx: 6.35, dy: 3.175, dash: [7.9375, -4.7625] }] },
    NET: { desc: 'Horizontal / vertical grid', fams: [{ a: 0, x: 0, y: 0, dx: 0, dy: 3.175 }, { a: 90, x: 0, y: 0, dx: 0, dy: 3.175 }] },
    LINE: { desc: 'Parallel horizontal lines', fams: [{ a: 0, x: 0, y: 0, dx: 0, dy: 3.175 }] },
    DASH: { desc: 'Dashed lines', fams: [{ a: 0, x: 0, y: 0, dx: 3.175, dy: 3.175, dash: [3.175, -3.175] }] },
    BRICK: { desc: 'Brick or masonry', fams: [{ a: 0, x: 0, y: 0, dx: 0, dy: 6.35 }, { a: 90, x: 0, y: 0, dx: 6.35, dy: 6.35, dash: [6.35, -6.35] }, { a: 90, x: 3.175, y: 0, dx: 6.35, dy: 6.35, dash: [-6.35, 6.35] }] },
    EARTH: { desc: 'Earth or ground', fams: [{ a: 0, x: 0, y: 0, dx: 6.35, dy: 6.35, dash: [6.35, -6.35] }, { a: 0, x: 0, y: 2.38125, dx: 6.35, dy: 6.35, dash: [6.35, -6.35] }, { a: 0, x: 0, y: 4.7625, dx: 6.35, dy: 6.35, dash: [6.35, -6.35] }, { a: 90, x: 0.79375, y: 5.55625, dx: 6.35, dy: 6.35, dash: [6.35, -6.35] }, { a: 90, x: 3.175, y: 5.55625, dx: 6.35, dy: 6.35, dash: [6.35, -6.35] }, { a: 90, x: 5.55625, y: 5.55625, dx: 6.35, dy: 6.35, dash: [6.35, -6.35] }] },
    'AR-CONC': { desc: 'Concrete (dots)', fams: [{ a: 50, x: 0, y: 0, dx: 4.12, dy: -10.1, dash: [0, -10] }, { a: 355, x: 0, y: 0, dx: -2.4, dy: 7.6, dash: [0, -7.3] }, { a: 100.45, x: 0, y: 0, dx: 5.9, dy: 5.3, dash: [0, -6.5] }] },
  };

  /* ---------- paper sizes (mm, landscape) ---------- */
  const PAPERS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841], Letter: [279.4, 215.9], Tabloid: [431.8, 279.4], 'ANSI C': [558.8, 431.8], 'ANSI D': [863.6, 558.8] };
  const SCALES = [[1, 1], [1, 2], [1, 5], [1, 10], [1, 20], [1, 25], [1, 50], [1, 100], [1, 200], [1, 500], [1, 1000], [2, 1], [5, 1], [10, 1]];

  /* ---------- document ---------- */
  function newDoc() {
    return normalize({
      app: 'lumen-draft', version: 1, units: 'mm',
      layers: [{ name: '0', color: 7, lt: 'CONTINUOUS', lw: -3 }], cur: '0', ents: [], blocks: {}, nextId: 1, ltscale: 1,
      dimstyle: { txt: 2.5, asz: 2.5, exo: 0.625, exe: 1.25, gap: 0.625, dec: 2, scale: 1 }, textH: 2.5,
    });
  }
  function normalize(d) {
    d.app = 'lumen-draft'; d.version = 1; d.units = d.units || 'mm';
    d.layers = Array.isArray(d.layers) ? d.layers.filter(l => l && typeof l.name === 'string' && l.name) : [];
    if (!d.layers.some(l => l.name === '0')) d.layers.unshift({ name: '0', color: 7, lt: 'CONTINUOUS', lw: -3 });
    d.ltypes = d.ltypes && typeof d.ltypes === 'object' ? d.ltypes : {};
    for (const k of Object.keys(d.ltypes)) { const t = d.ltypes[k]; if (!t || !Array.isArray(t.pat) || !t.pat.every(Number.isFinite)) delete d.ltypes[k]; }
    d.layers.forEach(l => { l.color = clampAci(l.color, 7); l.lt = ltDef(d, String(l.lt || '').toUpperCase()) ? String(l.lt).toUpperCase() : 'CONTINUOUS'; if (!(Number.isFinite(l.lw) && (l.lw === -3 || LWEIGHTS.includes(l.lw)))) l.lw = -3; l.on = l.on !== false; l.frozen = !!l.frozen; l.locked = !!l.locked; l.plot = l.plot !== false; });
    if (!d.layers.some(l => l.name === d.cur)) d.cur = '0';
    d.blocks = d.blocks && typeof d.blocks === 'object' ? d.blocks : {};
    for (const k of Object.keys(d.blocks)) { const b = d.blocks[k]; if (!b || !Array.isArray(b.ents)) { delete d.blocks[k]; continue; } b.base = Array.isArray(b.base) ? b.base.map(Number) : [0, 0]; b.ents = b.ents.filter(validEnt); }
    d.ents = Array.isArray(d.ents) ? d.ents.filter(validEnt) : [];
    let maxId = 0; d.ents.forEach(e => { if (!Number.isFinite(e.id)) e.id = 0; maxId = Math.max(maxId, e.id); });
    d.nextId = Math.max(d.nextId || 1, maxId + 1);
    d.ents.forEach(e => { if (!e.id) e.id = d.nextId++; if (!d.layers.some(l => l.name === e.layer)) d.layers.push({ name: e.layer, color: 7, lt: 'CONTINUOUS', lw: -3, on: true, frozen: false, locked: false, plot: true }); });
    d.ltscale = +d.ltscale > 0 ? +d.ltscale : 1;
    d.dimstyle = { txt: 2.5, asz: 2.5, exo: 0.625, exe: 1.25, gap: 0.625, dec: 2, scale: 1, ...(d.dimstyle || {}) };
    d.textH = +d.textH > 0 ? +d.textH : 2.5;
    d.layout = { paper: 'A3', scale: [1, 1], cx: null, cy: null, tb: true, title: 'Untitled', number: 'D-001', by: '', checked: '', date: '', rev: 'A', company: 'Lumen Draft', sheet: '1 of 1', ...(d.layout || {}) };
    if (!PAPERS[d.layout.paper]) d.layout.paper = 'A3';
    return d;
  }
  const clampAci = (c, def) => Number.isInteger(c) && c >= 0 && c <= 256 ? c : def;
  const TYPES = new Set(['line', 'pline', 'circle', 'arc', 'point', 'text', 'mtext', 'insert', 'dim', 'hatch', 'solid']);
  const fin = (...v) => v.every(Number.isFinite);
  function validEnt(e) {
    if (!e || typeof e !== 'object' || !TYPES.has(e.type)) return false;
    if (typeof e.layer !== 'string' || !e.layer) e.layer = '0';
    switch (e.type) {
      case 'line': return fin(e.x1, e.y1, e.x2, e.y2);
      case 'circle': return fin(e.cx, e.cy, e.r) && e.r > 0;
      case 'arc': return fin(e.cx, e.cy, e.r, e.a1, e.a2) && e.r > 0;
      case 'point': return fin(e.x, e.y);
      case 'pline': return Array.isArray(e.pts) && e.pts.length >= 2 && e.pts.every(p => Array.isArray(p) && fin(p[0], p[1]));
      case 'text': case 'mtext': e.s = String(e.s ?? ''); return fin(e.x, e.y, e.h) && e.h > 0;
      case 'insert': return typeof e.name === 'string' && fin(e.x, e.y);
      case 'dim': return typeof e.dt === 'string';
      case 'hatch': return Array.isArray(e.loops) && e.loops.length > 0;
      case 'solid': return Array.isArray(e.pts) && e.pts.length >= 3;
    }
    return false;
  }
  const ltDef = (d, n) => LTYPES[n] || (d && d.ltypes && d.ltypes[n]) || null;
  const layerOf = (d, name) => d.layers.find(l => l.name === name) || d.layers[0];

  /* ---------- dimensions ---------- */
  function fmtNum(v, dec) { let s = v.toFixed(dec); if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, ''); return s === '-0' ? '0' : s; }
  function dimValue(e) {
    switch (e.dt) {
      case 'lin': { const a = e.ang || 0; return Math.abs((e.p2[0] - e.p1[0]) * Math.cos(a) + (e.p2[1] - e.p1[1]) * Math.sin(a)); }
      case 'ali': return G.dist(e.p1, e.p2);
      case 'rad': return G.dist(e.c, e.p1);
      case 'dia': return 2 * G.dist(e.c, e.p1);
      case 'ang': { const s = angSector(e); return s.sw * 180 / Math.PI; }
    }
    return 0;
  }
  function angSector(e) {
    const a1 = G.ang(e.p1[0] - e.c[0], e.p1[1] - e.c[1]), a2 = G.ang(e.p2[0] - e.c[0], e.p2[1] - e.c[1]), ap = G.ang(e.p[0] - e.c[0], e.p[1] - e.c[1]);
    if (G.ccw(a1, ap) <= G.ccw(a1, a2)) return { a: a1, sw: G.ccw(a1, a2) };
    return { a: a2, sw: G.ccw(a2, a1) };
  }
  function dimText(e, ds) {
    const v = dimValue(e), num = e.dt === 'ang' ? fmtNum(v, Math.max(0, ds.dec - 2)) + '°' : fmtNum(v, ds.dec);
    const meas = (e.dt === 'rad' ? 'R' : e.dt === 'dia' ? 'Ø' : '') + num;
    if (e.txt == null || e.txt === '' ) return meas;
    return String(e.txt).replace(/<>/g, meas);
  }
  const readable = r => { r = G.normA(r); return r > Math.PI / 2 + 1e-9 && r <= 3 * Math.PI / 2 + 1e-9 ? G.normA(r + Math.PI) : r; };
  // dimension → plain geometry entities (line, arc, solid, text)
  function dimGeom(e, dsIn) {
    const ds = { ...dsIn }, k = ds.scale || 1, txt = ds.txt * k, asz = ds.asz * k, exo = ds.exo * k, exe = ds.exe * k, gap = ds.gap * k;
    const out = [], ln = (a, b) => out.push({ type: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
    const arrow = (tip, dx, dy) => {   // arrow pointing in direction (dx,dy), tip at `tip`
      const l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l, bx = tip[0] - ux * asz, by = tip[1] - uy * asz, w = asz / 6;
      out.push({ type: 'solid', pts: [[tip[0], tip[1]], [bx - uy * w, by + ux * w], [bx + uy * w, by - ux * w]] });
    };
    const s = dimText(e, ds), tw = G.textWidth(s, txt);
    const text = (x, y, rot, valign = 1, align = 1) => out.push({ type: 'text', x, y, h: txt, rot, s, align, valign });
    try {
      if (e.dt === 'lin' || e.dt === 'ali') {
        const a = e.dt === 'lin' ? (e.ang || 0) : G.ang(e.p2[0] - e.p1[0], e.p2[1] - e.p1[1]);
        const ux = Math.cos(a), uy = Math.sin(a), nx = -uy, ny = ux, p = e.p;
        const proj = q => (p[0] - q[0]) * nx + (p[1] - q[1]) * ny;
        const o1 = proj(e.p1), o2 = proj(e.p2);
        const d1 = [e.p1[0] + nx * o1, e.p1[1] + ny * o1], d2 = [e.p2[0] + nx * o2, e.p2[1] + ny * o2];
        const ext = (q, o, d) => { const sg = Math.sign(o) || 1; if (Math.abs(o) > exo) ln([q[0] + nx * exo * sg, q[1] + ny * exo * sg], [d[0] + nx * exe * sg, d[1] + ny * exe * sg]); };
        ext(e.p1, o1, d1); ext(e.p2, o2, d2);
        const L = G.dist(d1, d2), dx = d2[0] - d1[0], dy = d2[1] - d1[1];
        const inside = L >= 2 * asz + tw + 2 * gap;
        if (L < 1e-9) return out;
        if (inside || L >= 2.2 * asz) { ln(d1, d2); arrow(d1, -dx, -dy); arrow(d2, dx, dy); }
        else { const ex = dx / L * asz * 2, ey = dy / L * asz * 2; ln([d1[0] - ex, d1[1] - ey], [d2[0] + ex, d2[1] + ey]); arrow(d1, dx, dy); arrow(d2, -dx, -dy); }
        const tr = readable(a), upx = -Math.sin(tr), upy = Math.cos(tr);
        if (e.tp) text(e.tp[0], e.tp[1], tr, 2);
        else if (inside) text((d1[0] + d2[0]) / 2 + upx * gap, (d1[1] + d2[1]) / 2 + upy * gap, tr, 1);
        else { const m = [(d1[0] + d2[0]) / 2, (d1[1] + d2[1]) / 2]; text(m[0] + upx * (gap + txt * 0.2), m[1] + upy * (gap + txt * 0.2), tr, 1); }
      } else if (e.dt === 'rad' || e.dt === 'dia') {
        const c = e.c, r = G.dist(c, e.p1), p = e.p || e.p1, dp = G.dist(c, p) || 1, ux = (p[0] - c[0]) / dp, uy = (p[1] - c[1]) / dp;
        const q = [c[0] + ux * r, c[1] + uy * r], q2 = [c[0] - ux * r, c[1] - uy * r];
        const right = ux >= 0, outside = dp > r + 1e-9;
        if (e.dt === 'rad') {
          if (outside) { ln(q, p); arrow(q, -ux, -uy); }
          else { ln(c, q); arrow(q, ux, uy); }
        } else {
          ln(q2, outside ? p : q); arrow(q, ux, uy); arrow(q2, -ux, -uy);
        }
        if (outside) { const land = [p[0] + (right ? 1 : -1) * asz, p[1]]; ln(p, land); text(land[0] + (right ? gap : -gap), land[1], 0, 2, right ? 0 : 2); }
        else { const tr = readable(G.ang(ux, uy)), upx = -Math.sin(tr), upy = Math.cos(tr), m = e.dt === 'rad' ? [(c[0] + q[0]) / 2, (c[1] + q[1]) / 2] : c; text(m[0] + upx * gap, m[1] + upy * gap, tr, 1); }
      } else if (e.dt === 'ang') {
        const c = e.c, R = G.dist(c, e.p), sec = angSector(e);
        if (R < 1e-9) return out;
        out.push({ type: 'arc', cx: c[0], cy: c[1], r: R, a1: G.normA(sec.a), a2: G.normA(sec.a + sec.sw) });
        const a1 = G.ang(e.p1[0] - c[0], e.p1[1] - c[1]), first = Math.abs(G.normA(a1 - sec.a + Math.PI) - Math.PI) < 1e-9;
        const rays = [[sec.a, G.dist(c, first ? e.p1 : e.p2)], [sec.a + sec.sw, G.dist(c, first ? e.p2 : e.p1)]];
        for (const [aa, d] of rays) {
          const ux = Math.cos(aa), uy = Math.sin(aa);
          if (R > d + exo) ln([c[0] + ux * (d + exo), c[1] + uy * (d + exo)], [c[0] + ux * (R + exe), c[1] + uy * (R + exe)]);
          else if (R < d - exo) ln([c[0] + ux * (R - exe), c[1] + uy * (R - exe)], [c[0] + ux * (d - exo), c[1] + uy * (d - exo)]);
        }
        const e1 = [c[0] + R * Math.cos(sec.a), c[1] + R * Math.sin(sec.a)], e2 = [c[0] + R * Math.cos(sec.a + sec.sw), c[1] + R * Math.sin(sec.a + sec.sw)];
        arrow(e1, Math.sin(sec.a), -Math.cos(sec.a)); arrow(e2, -Math.sin(sec.a + sec.sw), Math.cos(sec.a + sec.sw));
        const am = sec.a + sec.sw / 2, tr = readable(am - Math.PI / 2), upx = -Math.sin(tr), upy = Math.cos(tr);
        const m = [c[0] + R * Math.cos(am), c[1] + R * Math.sin(am)];
        if (e.tp) text(e.tp[0], e.tp[1], tr, 2); else text(m[0] + upx * gap, m[1] + upy * gap, tr, 1);
      }
    } catch (err) { /* malformed dimension: draw nothing */ }
    return out;
  }

  /* ---------- block expansion ---------- */
  const isSimilar = T => Math.abs(Math.hypot(T[0], T[1]) - Math.hypot(T[2], T[3])) < 1e-9 * Math.max(1, Math.hypot(T[0], T[1])) && Math.abs(T[0] * T[2] + T[1] * T[3]) < 1e-9 * Math.max(1, T[0] * T[0] + T[1] * T[1]);
  function insertT(e, blk) {
    const b = blk ? blk.base : [0, 0];
    return G.Tmul(G.Tmul(G.Tmove(e.x, e.y), G.Tmul(G.Trot(0, 0, e.rot || 0), [e.sx ?? 1, 0, 0, e.sy ?? 1, 0, 0])), G.Tmove(-b[0], -b[1]));
  }
  function xform(e, T) {
    if (isSimilar(T)) return G.transform(e, T);
    // non-uniform scale: flatten curves to polylines
    const P = (x, y) => G.Tpt(T, x, y);
    if (e.type === 'circle' || e.type === 'arc' || (e.type === 'pline' && e.pts.some(p => p[2]))) {
      let pts;
      if (e.type === 'pline') pts = G.flatten(e.pts, !!e.closed);
      else { const a1 = e.type === 'circle' ? 0 : e.a1, sw = e.type === 'circle' ? TAU : G.arcSweep(e.a1, e.a2), n = Math.max(8, Math.ceil(sw / (Math.PI / 36))); pts = []; for (let i = 0; i <= n; i++) { const a = a1 + sw * i / n; pts.push([e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a)]); } if (e.type === 'circle') pts.pop(); }
      return { ...G.strip(e), type: 'pline', pts: pts.map(p => [...P(p[0], p[1]), 0]), closed: e.type === 'circle' || !!e.closed };
    }
    return G.transform(e, T);  // lines / points / texts: positions mapped, sizes approximated
  }
  // expand an INSERT into world-space entities, resolving layer 0 / ByBlock to the insert's properties
  function expandInsert(d, e, depth = 0) {
    const blk = d.blocks[e.name]; if (!blk || depth > 8) return [];
    const T = insertT(e, blk), out = [];
    for (const be of blk.ents) {
      let w = xform(be, T);
      if (w.layer === '0' || w.layer == null) w.layer = e.layer;
      if (w.color === 0) w.color = e.color;
      if (w.lt === 'BYBLOCK') w.lt = e.lt;
      if (w.lw === -2) w.lw = e.lw;
      if (w.type === 'insert') out.push(...expandInsert(d, w, depth + 1)); else out.push(w);
    }
    return out;
  }
  // explode one entity into simpler entities (null = cannot explode)
  function explode(d, e) {
    const base = G.strip(e);
    if (e.type === 'pline') return G.plSegs(e).map(s => {
      if (!s.arc) return { ...base, type: 'line', x1: s.p[0], y1: s.p[1], x2: s.q[0], y2: s.q[1] };
      const a = s.arc, a1 = a.th > 0 ? a.a0 : a.a0 + a.th, a2 = a.th > 0 ? a.a0 + a.th : a.a0;
      return { ...base, type: 'arc', cx: a.cx, cy: a.cy, r: a.r, a1: G.normA(a1), a2: G.normA(a2) };
    });
    if (e.type === 'insert') return d.blocks[e.name] ? expandInsertOne(d, e) : null;
    if (e.type === 'dim') return dimGeom(e, d.dimstyle).map(g => ({ ...base, ...g }));
    if (e.type === 'mtext') return mtextLines(e).map(t => ({ ...base, ...t }));
    if (e.type === 'hatch') return e.loops.map(l => ({ ...base, type: 'pline', pts: l.pts.map(p => p.slice()), closed: true }));
    return null;
  }
  function expandInsertOne(d, e) {   // one level only (nested inserts stay inserts)
    const blk = d.blocks[e.name], T = insertT(e, blk);
    return blk.ents.map(be => { const w = xform(be, T); if (w.layer === '0') w.layer = e.layer; if (w.color === 0) w.color = e.color; return w; });
  }
  function mtextLines(e) {
    const lines = String(e.s).split('\n'), lh = e.h * 1.667, b = G.textBox(e), r = e.rot || 0, c = Math.cos(r), s = Math.sin(r);
    const at = e.attach || 1, col = (at - 1) % 3, align = col === 0 ? 0 : col === 1 ? 1 : 2;
    const lx = col === 0 ? b[0] : col === 1 ? (b[0] + b[2]) / 2 : b[2];
    return lines.map((l, i) => { const ly = b[3] - e.h - i * lh; return { type: 'text', x: e.x + lx * c - ly * s, y: e.y + lx * s + ly * c, h: e.h, rot: r, s: l, align, valign: 0 }; });
  }

  /* ---------- primitives for picking / snapping ---------- */
  function entPrims(d, e, forSnap = false) {
    switch (e.type) {
      case 'line': case 'arc': case 'circle': case 'pline': return G.primsOf(e);
      case 'solid': { const p = e.pts, out = []; for (let i = 0; i < p.length; i++) out.push(G.L(p[i][0], p[i][1], p[(i + 1) % p.length][0], p[(i + 1) % p.length][1])); return out; }
      case 'text': case 'mtext': { if (forSnap) return []; const c = G.textCorners(e); return c.map((p, i) => G.L(p[0], p[1], c[(i + 1) % 4][0], c[(i + 1) % 4][1])); }
      case 'hatch': { if (forSnap) return []; const out = []; for (const l of e.loops) out.push(...G.primsOf({ type: 'pline', pts: l.pts, closed: true })); return out; }
      case 'insert': { const out = []; for (const w of expandInsert(d, e)) out.push(...entPrims(d, w, forSnap)); return out; }
      case 'dim': { const out = []; for (const g of dimGeom(e, d.dimstyle)) if (g.type !== 'text' || !forSnap) out.push(...entPrims(d, g, forSnap)); return out; }
      case 'point': return [];
    }
    return [];
  }
  function entBBox(d, e) {
    let bb = [Infinity, Infinity, -Infinity, -Infinity];
    const add = (x, y) => { if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y; };
    if (e.type === 'point') { add(e.x, e.y); return bb; }
    if (e.type === 'text' || e.type === 'mtext') { for (const p of G.textCorners(e)) add(p[0], p[1]); return bb; }
    for (const p of entPrims(d, e)) bb = G.primBBox(p, bb);
    return bb;
  }
  function extents(d, ents = d.ents) {
    const bb = [Infinity, Infinity, -Infinity, -Infinity];
    for (const e of ents) { if (!isVisible(d, e)) continue; const b = entBBox(d, e); if (b[0] < bb[0]) bb[0] = b[0]; if (b[1] < bb[1]) bb[1] = b[1]; if (b[2] > bb[2]) bb[2] = b[2]; if (b[3] > bb[3]) bb[3] = b[3]; }
    return isFinite(bb[0]) ? bb : null;
  }
  function isVisible(d, e) { const l = layerOf(d, e.layer); return l.on && !l.frozen; }

  /* ---------- resolved display properties ---------- */
  function resolve(d, e) {
    const l = layerOf(d, e.layer);
    let c = e.color == null || e.color === 256 ? l.color : e.color === 0 ? 7 : e.color;
    let lt = !e.lt || e.lt === 'BYLAYER' ? l.lt : e.lt === 'BYBLOCK' ? 'CONTINUOUS' : e.lt;
    let lw = e.lw == null || e.lw === -1 ? l.lw : e.lw === -2 ? -3 : e.lw;
    if (lw === -3) lw = DEFAULT_LW;
    return { aci: c, rgb: e.rgb || ACI[c] || ACI[7], lt: ltDef(d, lt) ? lt : 'CONTINUOUS', lw: lw / 100, lts: e.lts || 1, layer: l };
  }

  /* ---------- emitter ----------
     sink: { style(st), line(x1,y1,x2,y2), poly(pts, closed), arc(cx,cy,r,a1,sw), circle(cx,cy,r), fill(loops), text(x,y,h,rot,s,align,valign), point(x,y), hatchLines(segs) }
     opts: { filter(e) → bool, hatchCache: WeakMap, plot: true to skip non-plot layers } */
  function emit(d, ents, sink, opts = {}) {
    for (const e of ents) {
      if (!isVisible(d, e)) continue;
      if (opts.plot && layerOf(d, e.layer).plot === false) continue;
      if (opts.filter && !opts.filter(e)) continue;
      emitOne(d, e, sink, opts, null);
    }
  }
  function emitOne(d, e, sink, opts, parent) {
    if (e.type === 'insert') { for (const w of expandInsert(d, e)) { if (!isVisible(d, w)) continue; emitOne(d, w, sink, opts, e); } return; }
    const st = resolve(d, e); st.ent = parent || e; st.sub = !!parent;
    if (e.type === 'dim') {
      const gs = dimGeom(e, d.dimstyle);
      sink.style({ ...st, lt: 'CONTINUOUS' });
      for (const g of gs) emitGeom(d, g, sink, opts, st);
      return;
    }
    sink.style(st);
    emitGeom(d, e, sink, opts, st);
  }
  function emitGeom(d, e, sink, opts, st) {
    switch (e.type) {
      case 'line': sink.line(e.x1, e.y1, e.x2, e.y2); break;
      case 'circle': sink.circle(e.cx, e.cy, e.r); break;
      case 'arc': sink.arc(e.cx, e.cy, e.r, e.a1, G.arcSweep(e.a1, e.a2)); break;
      case 'pline': sink.poly(e.pts, !!e.closed, e.w || 0); break;
      case 'point': sink.point(e.x, e.y); break;
      case 'solid': sink.fill([{ pts: e.pts.map(p => [p[0], p[1], 0]) }]); break;
      case 'text': sink.text(e.x, e.y, e.h, e.rot || 0, e.s, e.align || 0, e.valign || 0); break;
      case 'mtext': for (const t of mtextLines(e)) sink.text(t.x, t.y, t.h, t.rot, t.s, t.align, t.valign); break;
      case 'hatch': {
        const pat = PATTERNS[e.pat] || PATTERNS.ANSI31;
        if (!pat.fams.length) { sink.fill(e.loops); break; }
        let segs = opts.hatchCache && opts.hatchCache.get(e);
        if (!segs) { segs = G.hatchLines(e.loops, pat.fams, e.sc || 1, e.ang || 0); opts.hatchCache && opts.hatchCache.set(e, segs); }
        sink.hatchLines(segs);
        break;
      }
    }
  }
  const dashPattern = (d, st) => { const p = (ltDef(d, st.lt) || LTYPES.CONTINUOUS).pat; if (!p.length) return null; const k = d.ltscale * (st.lts || 1); return p.map(v => Math.abs(v) * k); };

  return { ACI, colorName, rgbToAci, LTYPES, LWEIGHTS, DEFAULT_LW, PATTERNS, PAPERS, SCALES, newDoc, normalize, validEnt, layerOf, fmtNum, dimValue, dimText, dimGeom, angSector, readable,
    ltDef, insertT, xform, expandInsert, explode, mtextLines, entPrims, entBBox, extents, isVisible, resolve, emit, dashPattern };
});
