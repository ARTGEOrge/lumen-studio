'use strict';
/* Lumen Diagram — document model: pages, layers, cells; geometry of cells in world space; file normalisation. */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const G = isNode ? require('./geom.js') : root.DiaGeom;
  const S = isNode ? require('./shapes.js') : root.DiaShapes;

  let seq = 0;
  const uid = (p = 'c') => p + Date.now().toString(36).slice(-4) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

  const THEMES = {
    lumen: { name: 'Lumen blue', bg: '#ffffff', edge: '#4a5568', font: '#1f2933', palette: [['#dae8fc', '#6c8ebf'], ['#d5e8d4', '#82b366'], ['#ffe6cc', '#d79b00'], ['#fff2cc', '#d6b656'], ['#f8cecc', '#b85450'], ['#e1d5e7', '#9673a6'], ['#f5f5f5', '#666666']] },
    pastel: { name: 'Pastel', bg: '#fdfcf9', edge: '#6b6f80', font: '#2d3142', palette: [['#cde7f0', '#7fb3c8'], ['#f6d6e0', '#c98ea2'], ['#e3f0cf', '#97b56d'], ['#fbe7c6', '#d0a45c'], ['#e5dcf3', '#9b88c4'], ['#d7efe9', '#6fae9f'], ['#eeeeee', '#9a9a9a']] },
    vivid: { name: 'Vivid', bg: '#ffffff', edge: '#2d3748', font: '#ffffff', palette: [['#2b7de9', '#1a5bb0'], ['#22a06b', '#16784f'], ['#f5821f', '#c4620c'], ['#e34960', '#b02a3f'], ['#8d5cd5', '#6a3eae'], ['#0fa3b1', '#0a7883'], ['#5b6b7c', '#3c4a59']] },
    dark: { name: 'Dark', bg: '#1e2530', edge: '#a8b3c2', font: '#e8edf3', palette: [['#2c3e57', '#6d9bd8'], ['#2b4a3c', '#6fbf8f'], ['#544028', '#e0a458'], ['#4f2f3a', '#e07a8f'], ['#3f3555', '#a990dd'], ['#24474b', '#5fc4c9'], ['#353c47', '#8f9aa8']] },
    blueprint: { name: 'Blueprint', bg: '#0f3d6e', edge: '#d6e6f7', font: '#ffffff', palette: [['#174f8a', '#d6e6f7'], ['#1a5a98', '#d6e6f7'], ['#14467d', '#d6e6f7'], ['#1d63a6', '#d6e6f7'], ['#113e6f', '#d6e6f7'], ['#1a5590', '#d6e6f7'], ['#0f3d6e', '#d6e6f7']] },
    mono: { name: 'Monochrome', bg: '#ffffff', edge: '#333333', font: '#111111', palette: [['#ffffff', '#222222'], ['#f2f2f2', '#222222'], ['#e0e0e0', '#222222'], ['#ffffff', '#555555'], ['#d0d0d0', '#222222'], ['#f7f7f7', '#444444'], ['#bdbdbd', '#222222']] },
  };

  function newPage(name = 'Page-1') {
    const L = uid('L');
    return { id: uid('p'), name, bg: '#ffffff', grid: 10, showGrid: true, layers: [{ id: L, name: 'Background', visible: true, locked: false }], cells: [] };
  }
  function newDoc() { return { format: 'lumen-diagram', version: 1, theme: 'lumen', pages: [newPage('Page-1')] }; }

  function makeShape(shape, x, y, o = {}) {
    const d = S.get(shape);
    return { id: o.id || uid('s'), kind: 'shape', shape: S.has(shape) ? shape : 'rect', x, y, w: o.w || d.w, h: o.h || d.h, rot: o.rot || 0, flipH: !!o.flipH, flipV: !!o.flipV, text: o.text != null ? o.text : (d.text || ''), style: Object.assign({}, o.style), layer: o.layer || null, parent: o.parent || null, ...(o.image ? { image: o.image } : {}) };
  }
  function makeEdge(src, tgt, o = {}) {
    return { id: o.id || uid('e'), kind: 'edge', src, tgt, pts: o.pts || [], text: o.text || '', labelT: o.labelT ?? 0.5, labelDx: o.labelDx || 0, labelDy: o.labelDy || 0, style: Object.assign({}, o.style), layer: o.layer || null, parent: o.parent || null };
  }

  // ---- indexes ----
  function index(page) { const m = new Map(); for (const c of page.cells) m.set(c.id, c); return m; }
  function children(page, id) { return page.cells.filter(c => c.parent === id); }
  function descendants(page, id, out = []) { for (const c of page.cells) if (c.parent === id) { out.push(c); descendants(page, c.id, out); } return out; }
  function topAncestor(byId, c) { let x = c, guard = 0; while (x && x.parent && byId.get(x.parent) && byId.get(x.parent).kind === 'group' && guard++ < 50) x = byId.get(x.parent); return x; }

  // ---- shape geometry ----
  // local → world transform for a shape (flip, rotate about centre, translate)
  function xf(c) {
    const cx = c.w / 2, cy = c.h / 2, rot = c.rot || 0;
    return (lx, ly) => { const fx = c.flipH ? c.w - lx : lx, fy = c.flipV ? c.h - ly : ly; const r = G.rotPt(fx, fy, cx, cy, rot); return [r[0] + c.x, r[1] + c.y]; };
  }
  const outlineCache = new Map();
  function outline(c) {
    const d = S.get(c.shape);
    const key = c.shape + '|' + c.x + '|' + c.y + '|' + c.w + '|' + c.h + '|' + (c.rot || 0) + '|' + !!c.flipH + !!c.flipV + '|' + (d.perimeter || '') + (c.style && c.style.rounded ? 'r' : '');
    let o = outlineCache.get(c.id);
    if (o && o.key === key) return o.rings;
    const local = d.perimeter === 'rect' || d.perimeter === 'lifeline' ? G.rect(0, 0, c.w, c.h) : d.path(c.w, c.h, c);
    const rings = G.flatten(G.transform(local, xf(c)), 8);
    if (outlineCache.size > 5000) outlineCache.clear();
    outlineCache.set(c.id, { key, rings });
    return rings;
  }
  function shapeBox(c) {
    if (!c.rot) return { x: c.x, y: c.y, w: c.w, h: c.h };
    const t = xf(c), pts = [[0, 0], [c.w, 0], [c.w, c.h], [0, c.h]].map(([a, b]) => { const p = t(a, b); return { x: p[0], y: p[1] }; });
    return G.bboxPts(pts);
  }
  const center = c => ({ x: c.x + c.w / 2, y: c.y + c.h / 2 });
  // bounding box of any cell (groups: union of children)
  function cellBox(page, c, byId, routes) {
    if (c.kind === 'shape') {
      const b = shapeBox(c); const d = S.get(c.shape);
      return d.label === 'below' && c.text ? G.unionBox(b, { x: c.x - 20, y: c.y + c.h, w: c.w + 40, h: 30 }) : b;
    }
    if (c.kind === 'group') { let b = null; for (const k of children(page, c.id)) b = G.unionBox(b, cellBox(page, k, byId, routes)); return b || { x: 0, y: 0, w: 0, h: 0 }; }
    if (c.kind === 'edge') { const r = routes && routes.get(c.id); return r ? G.bboxPts(r.pts) : null; }
    return null;
  }
  function pageBounds(page, routes, cells) {
    let b = null; const byId = index(page);
    const vis = new Set(page.layers.filter(l => l.visible !== false).map(l => l.id));
    for (const c of cells || page.cells) { if (c.kind === 'group') continue; if (c.layer && !vis.has(c.layer)) continue; const x = cellBox(page, c, byId, routes); if (x) b = G.unionBox(b, x); }
    return b;
  }

  // ---- untrusted file normalisation ----
  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v) ? +v : d));
  const str = (v, d = '') => (typeof v === 'string' ? v : v == null ? d : String(v));
  const COLOR = /^(#[0-9a-f]{3,8}|none|transparent|rgba?\([\d\s.,%]+\)|[a-z]{3,20})$/i;
  function cleanStyle(s) {
    const o = {}; if (!s || typeof s !== 'object') return o;
    for (const [k, v] of Object.entries(s)) {
      if (!/^[a-zA-Z0-9]{1,24}$/.test(k)) continue;
      if (typeof v === 'number' && isFinite(v)) o[k] = v;
      else if (typeof v === 'boolean') o[k] = v;
      else if (typeof v === 'string' && v.length < 64) { if (/(fill|stroke|color|bg|accent)/i.test(k) && v && !COLOR.test(v)) continue; o[k] = v; }
    }
    return o;
  }
  const cleanEnd = e => { if (!e || typeof e !== 'object') return null; if (typeof e.id === 'string') return { id: e.id, port: Array.isArray(e.port) && e.port.length === 2 ? [num(e.port[0], 0.5), num(e.port[1], 0.5)] : null }; return { x: num(e.x), y: num(e.y) }; };
  function normalize(doc) {
    if (!doc || typeof doc !== 'object' || !Array.isArray(doc.pages)) throw new Error('Not a Lumen Diagram file');
    const out = { format: 'lumen-diagram', version: 1, theme: THEMES[doc.theme] ? doc.theme : 'lumen', pages: [] };
    for (const p of doc.pages.slice(0, 500)) {
      const pg = { id: str(p.id) || uid('p'), name: str(p.name, 'Page').slice(0, 120), bg: COLOR.test(str(p.bg)) ? p.bg : '#ffffff', grid: Math.max(2, Math.min(200, num(p.grid, 10))), showGrid: p.showGrid !== false, layers: [], cells: [] };
      for (const l of (Array.isArray(p.layers) ? p.layers : [])) pg.layers.push({ id: str(l.id) || uid('L'), name: str(l.name, 'Layer').slice(0, 80), visible: l.visible !== false, locked: !!l.locked });
      if (!pg.layers.length) pg.layers.push({ id: uid('L'), name: 'Background', visible: true, locked: false });
      const layerIds = new Set(pg.layers.map(l => l.id)), ids = new Set();
      for (const c of (Array.isArray(p.cells) ? p.cells : []).slice(0, 50000)) {
        if (!c || typeof c !== 'object') continue;
        let id = str(c.id) || uid('c'); if (ids.has(id)) id = uid('c'); ids.add(id);
        const layer = layerIds.has(c.layer) ? c.layer : pg.layers[0].id, parent = typeof c.parent === 'string' ? c.parent : null;
        if (c.kind === 'edge') pg.cells.push({ id, kind: 'edge', src: cleanEnd(c.src) || { x: 0, y: 0 }, tgt: cleanEnd(c.tgt) || { x: 100, y: 0 }, pts: (Array.isArray(c.pts) ? c.pts : []).slice(0, 200).map(q => ({ x: num(q && q.x), y: num(q && q.y) })), text: str(c.text).slice(0, 20000), labelT: Math.max(0, Math.min(1, num(c.labelT, 0.5))), labelDx: num(c.labelDx), labelDy: num(c.labelDy), style: cleanStyle(c.style), layer, parent });
        else if (c.kind === 'group') pg.cells.push({ id, kind: 'group', layer, parent });
        else {
          const img = typeof c.image === 'string' && /^data:image\/(png|jpeg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(c.image) ? c.image : undefined;
          pg.cells.push({ id, kind: 'shape', shape: S.has(c.shape) ? c.shape : 'rect', x: num(c.x), y: num(c.y), w: Math.max(1, num(c.w, 120)), h: Math.max(1, num(c.h, 60)), rot: num(c.rot), flipH: !!c.flipH, flipV: !!c.flipV, text: str(c.text).slice(0, 20000), style: cleanStyle(c.style), layer, parent, ...(img ? { image: img } : {}) });
        }
      }
      // drop dangling parents / edge refs
      const all = new Set(pg.cells.map(c => c.id));
      for (const c of pg.cells) {
        if (c.parent && (!all.has(c.parent) || c.parent === c.id)) c.parent = null;
        if (c.kind === 'edge') for (const k of ['src', 'tgt']) if (c[k] && c[k].id && !all.has(c[k].id)) c[k] = { x: 0, y: 0 };
      }
      // break parent cycles
      const byId = index(pg);
      for (const c of pg.cells) { const seen = new Set([c.id]); let x = c; while (x.parent) { if (seen.has(x.parent)) { c.parent = null; break; } seen.add(x.parent); x = byId.get(x.parent); if (!x) break; } }
      out.pages.push(pg);
    }
    if (!out.pages.length) out.pages.push(newPage());
    return out;
  }
  function serialize(doc) { return JSON.stringify({ format: 'lumen-diagram', version: 1, generator: 'Lumen Diagram', theme: doc.theme, pages: doc.pages }, null, 1); }

  // apply a theme: recolour by mapping each distinct fill to the palette in order of first appearance
  function applyTheme(page, themeId) {
    const T = THEMES[themeId]; if (!T) return;
    page.bg = T.bg; const map = new Map(); let i = 0;
    for (const c of page.cells) {
      if (c.kind === 'edge') { c.style.stroke = T.edge; c.style.fontColor = T.font === '#ffffff' ? '#1f2933' : T.font; c.style.labelBg = T.bg; continue; }
      if (c.kind !== 'shape') continue;
      const st = S.styleOf(c); const d = S.get(c.shape);
      if (d.id === 'text' || d.id === 'heading') { c.style.fontColor = T.bg === '#ffffff' || T.bg === '#fdfcf9' ? '#1f2933' : T.font; continue; }
      if (st.fill === 'none' && st.stroke === 'none') continue;
      const key = st.fill === 'none' ? 'stroke:' + st.stroke : st.fill;
      if (!map.has(key)) map.set(key, T.palette[i++ % T.palette.length]);
      const [f, s] = map.get(key);
      if (st.fill !== 'none') c.style.fill = d.container && st.bodyFill ? f : f;
      if (st.stroke !== 'none') c.style.stroke = s;
      if (st.accent) c.style.accent = s;
      if (st.bodyFill) c.style.bodyFill = T.bg;
      c.style.fill2 = '';
      c.style.fontColor = d.label === 'below' ? (T.bg === '#ffffff' || T.bg === '#fdfcf9' ? '#1f2933' : T.font) : T.font;
    }
  }

  const clone = o => JSON.parse(JSON.stringify(o));
  const api = { uid, THEMES, newPage, newDoc, makeShape, makeEdge, index, children, descendants, topAncestor, xf, outline, shapeBox, center, cellBox, pageBounds, normalize, serialize, applyTheme, clone, cleanStyle };
  if (isNode) module.exports = api; else root.DiaModel = api;
})(typeof self !== 'undefined' ? self : this);
