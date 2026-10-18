'use strict';
/* Lumen Slides — application core: state, undo history, editing target (slide / master / layout),
   view transform and stage rendering (slide canvas + selection overlay). */
const $ = s => document.querySelector(s);
const S = window.S = {
  doc: null, assets: {}, name: 'Untitled', path: null, hist: null,
  mode: 'slide', cur: 0, mcur: -1, view: { z: 1, ox: 0, oy: 0, fit: true },
  sel: [], inGroup: null, tool: 'select', geom: 'rect', edit: null,
  opt: { snap: true, guides: true, notes: true, loop: false },
  sorter: false, clip: null, drag: null, guides: [], hover: null, preview: null, marquee: null, ver: 0,
};
const DPR = () => window.devicePixelRatio || 1;

/* ---------------- history ---------------- */
function snapshot() { return { doc: structuredClone(S.doc), cur: S.cur, mode: S.mode, mcur: S.mcur, sel: [...S.sel] }; }
function restore(st) {
  if (!st) return;
  Editor.endEdit(false);
  S.doc = structuredClone(st.doc); S.cur = Math.min(st.cur, S.doc.slides.length - 1); S.mode = st.mode; S.mcur = Math.min(st.mcur, S.doc.layouts.length - 1);
  S.sel = st.sel.filter(id => byId(id)); S.inGroup = null;
  changed(true);
}
let lastLabel = null, lastTime = 0;
function commit(label, opts = {}) {
  // coalesce rapid repeated edits of the same kind (typing in panels, nudging)
  const now = Date.now(), top = S.hist.items[S.hist.index];
  if (opts.merge && top && lastLabel === label && now - lastTime < 1500 && S.hist.index === S.hist.items.length - 1 && S.hist.index > 0) { top.state = snapshot(); Aero.setDirty(true); }
  else S.hist.push(label, snapshot());
  lastLabel = label; lastTime = now;
  changed(opts.panels !== false);
}
function undo() { if (S.edit) { Editor.endEdit(true); } const st = S.hist.undo(); if (st) restore(st); }
function redo() { const st = S.hist.redo(); if (st) restore(st); }
function changed(panels = true) {
  S.ver++;
  if (S.cur >= S.doc.slides.length) S.cur = S.doc.slides.length - 1;
  if (S.cur < 0 && S.doc.slides.length) S.cur = 0;
  S.sel = S.sel.filter(id => byId(id));
  requestRender();
  UI.refresh(panels);
}
function setDocument(doc, assets, name, path) {
  Editor.endEdit(false);
  S.doc = doc; S.assets = assets || {}; S.name = name || 'Untitled'; S.path = path || null;
  S.cur = 0; S.mode = 'slide'; S.mcur = -1; S.sel = []; S.inGroup = null; S.sorter = false;
  S.hist.reset('Open', snapshot());
  Aero.setDoc(S.name, false);
  Render.clearMeasureCache();
  changed(true);
  requestAnimationFrame(() => View.fit());
}

/* ---------------- editing target ---------------- */
const curSlide = () => S.doc.slides[S.cur] || null;
const curLayout = () => S.mode === 'master' && S.mcur >= 0 ? S.doc.layouts[S.mcur] : null;
function target() {
  if (S.mode === 'master') {
    const lay = curLayout();
    if (lay) return { kind: 'layout', layout: lay, lists: [lay.objects], main: lay.objects, ctx: { layout: lay } };
    return { kind: 'master', lists: [S.doc.master.objects, S.doc.master.ph], main: S.doc.master.objects, ctx: { master: true } };
  }
  const s = curSlide();
  return { kind: 'slide', slide: s, lists: s ? [s.objects] : [[]], main: s ? s.objects : [], ctx: { slide: s } };
}
const topObjs = () => target().lists.flat();
function byId(id) { for (const l of target().lists) { const o = Model.findObj(l, id); if (o) return o; } return null; }
function listOf(id) { for (const l of target().lists) { const r = Model.parentList(l, id); if (r) return r; } return null; }
function parentGroup(id) { let g = null; for (const l of target().lists) Model.walk(l, (o, p) => { if (o.id === id && p) g = p; }); return g; }
const selObjs = () => S.sel.map(byId).filter(Boolean);
function select(ids, keepGroup) { S.sel = [...new Set(ids)]; if (!keepGroup) S.inGroup = null; requestRender(); UI.refresh(false); }
function slideNumOf(slide) { return S.doc.slides.indexOf(slide) + 1; }

/* ---------------- view ---------------- */
const View = {
  w2s(x, y) { return [x * S.view.z + S.view.ox, y * S.view.z + S.view.oy]; },
  s2w(x, y) { return [(x - S.view.ox) / S.view.z, (y - S.view.oy) / S.view.z]; },
  size() { const c = $('#cv'); return [c.clientWidth, c.clientHeight]; },
  fit() { const [cw, ch] = this.size(); if (!cw || !S.doc) return; const pad = 36; const z = Math.min((cw - pad * 2) / S.doc.w, (ch - pad * 2) / S.doc.h); S.view.z = Math.max(0.05, z); S.view.ox = (cw - S.doc.w * S.view.z) / 2; S.view.oy = (ch - S.doc.h * S.view.z) / 2; S.view.fit = true; requestRender(); UI.status(); },
  zoomAt(z, sx, sy) { z = Aero.clamp(z, 0.1, 8); const [wx, wy] = this.s2w(sx, sy); S.view.z = z; S.view.ox = sx - wx * z; S.view.oy = sy - wy * z; S.view.fit = false; requestRender(); UI.status(); Editor.placeEditor(); },
  zoomBy(f) { const [w, h] = this.size(); this.zoomAt(S.view.z * f, w / 2, h / 2); },
  actual() { const [w, h] = this.size(); S.view.z = 1; S.view.ox = (w - S.doc.w) / 2; S.view.oy = (h - S.doc.h) / 2; S.view.fit = false; requestRender(); UI.status(); Editor.placeEditor(); },
};

/* ---------------- stage rendering ---------------- */
let raf = 0;
function requestRender() { if (!raf) raf = requestAnimationFrame(renderStage); }
const COL = { sel: '#1f6fd6', guide: '#e0179c', hover: 'rgba(31,111,214,.55)', grp: '#7aa7e0' };
function renderStage() {
  raf = 0;
  if (!S.doc) return;
  if (S.sorter) return UI.renderSorter();
  const cv = $('#cv'), dpr = DPR(), cw = cv.clientWidth, ch = cv.clientHeight;
  if (!cw || !ch) return;
  if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); if (S.view.fit) { View.fit(); return; } }
  const c = cv.getContext('2d'), { z, ox, oy } = S.view, d = S.doc;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#c9d4e1'; c.fillRect(0, 0, cw, ch);
  // slide shadow + slide
  c.save(); c.shadowColor = 'rgba(20,40,70,.35)'; c.shadowBlur = 14; c.shadowOffsetY = 3; c.fillStyle = '#fff'; c.fillRect(ox, oy, d.w * z, d.h * z); c.restore();
  c.save(); c.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
  const opts = { scale: dpr * z, prompts: true, editing: S.edit && S.edit.id, editCell: S.edit && S.edit.cell, anim: S.preview, showHidden: true };
  if (S.mode === 'master') Render.drawLayout(c, d, curLayout(), S.assets, opts);
  else if (curSlide()) Render.drawSlide(c, d, curSlide(), S.assets, { ...opts, slideNum: S.cur + 1 });
  c.restore();
  if (!S.preview) drawOverlay(c);
}
function objCorners(o) {
  const cx = o.x + o.w / 2, cy = o.y + o.h / 2, r = (o.rot || 0) * Math.PI / 180, cs = Math.cos(r), sn = Math.sin(r);
  return [[-o.w / 2, -o.h / 2], [o.w / 2, -o.h / 2], [o.w / 2, o.h / 2], [-o.w / 2, o.h / 2]].map(([x, y]) => [cx + x * cs - y * sn, cy + x * sn + y * cs]);
}
function drawPoly(c, pts) { c.beginPath(); pts.forEach(([x, y], i) => { const [sx, sy] = View.w2s(x, y); i ? c.lineTo(sx, sy) : c.moveTo(sx, sy); }); c.closePath(); }
function drawOverlay(c) {
  const sel = selObjs();
  // hover outline
  if (S.hover && !S.sel.includes(S.hover) && !S.drag) { const o = byId(S.hover); if (o) { c.strokeStyle = COL.hover; c.lineWidth = 1; drawPoly(c, objCorners(o)); c.stroke(); } }
  // group being edited
  if (S.inGroup) { const g = byId(S.inGroup); if (g) { c.save(); c.setLineDash([4, 3]); c.strokeStyle = COL.grp; drawPoly(c, objCorners(g)); c.stroke(); c.restore(); } }
  // selection
  c.lineWidth = 1;
  for (const o of sel) {
    c.strokeStyle = COL.sel;
    if (o.type === 'shape' && o.geom === 'line') { const [a, b] = Editor.lineEnds(o); const [x0, y0] = View.w2s(...a), [x1, y1] = View.w2s(...b); c.save(); c.setLineDash([3, 3]); c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.restore(); }
    else { drawPoly(c, objCorners(o)); c.stroke(); }
  }
  if (!S.edit || S.edit.cell) {
    const hs = Editor.handles();
    for (const h of hs) {
      const [sx, sy] = View.w2s(h.x, h.y);
      c.beginPath();
      if (h.k === 'rot') { c.arc(sx, sy, 5, 0, Math.PI * 2); c.fillStyle = '#7fe08a'; c.fill(); c.strokeStyle = '#1d6b2a'; c.stroke(); }
      else { c.rect(Math.round(sx) - 3.5, Math.round(sy) - 3.5, 7, 7); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = COL.sel; c.stroke(); }
    }
  }
  // table cell highlight
  if (S.edit && S.edit.cell) { const o = byId(S.edit.id); if (o) { const r = Editor.cellRect(o, S.edit.cell.r, S.edit.cell.c); c.strokeStyle = COL.sel; c.lineWidth = 2; drawPoly(c, [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]]); c.stroke(); c.lineWidth = 1; } }
  // smart guides
  if (S.guides.length) {
    c.save(); c.strokeStyle = COL.guide; c.lineWidth = 1; c.setLineDash([]);
    for (const g of S.guides) { c.beginPath(); if (g.v != null) { const [sx, sy0] = View.w2s(g.v, g.a), [, sy1] = View.w2s(g.v, g.b); c.moveTo(Math.round(sx) + .5, sy0); c.lineTo(Math.round(sx) + .5, sy1); } else { const [sx0, sy] = View.w2s(g.a, g.h), [sx1] = View.w2s(g.b, g.h); c.moveTo(sx0, Math.round(sy) + .5); c.lineTo(sx1, Math.round(sy) + .5); } c.stroke(); }
    c.restore();
  }
  // marquee / draw preview
  if (S.marquee) { const m = S.marquee; const [x0, y0] = View.w2s(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1)), [x1, y1] = View.w2s(Math.max(m.x0, m.x1), Math.max(m.y0, m.y1)); c.fillStyle = 'rgba(60,127,177,.12)'; c.fillRect(x0, y0, x1 - x0, y1 - y0); c.strokeStyle = '#3c7fb1'; c.strokeRect(x0 + .5, y0 + .5, x1 - x0, y1 - y0); }
}

/* ---------------- thumbnails ---------------- */
const Thumbs = {
  keys: new WeakMap(),
  draw(canvas, slide, width) {
    const d = S.doc, k = width / d.w, dpr = DPR();
    const sig = JSON.stringify(slide) + JSON.stringify(d.master) + JSON.stringify(d.theme) + JSON.stringify(d.layouts.find(l => l.id === slide.layout) || null) + JSON.stringify(d.footer) + S.doc.slides.indexOf(slide) + width;
    if (this.keys.get(canvas) === sig) return;
    this.keys.set(canvas, sig);
    canvas.width = Math.round(d.w * k * dpr); canvas.height = Math.round(d.h * k * dpr);
    canvas.style.width = Math.round(d.w * k) + 'px'; canvas.style.height = Math.round(d.h * k) + 'px';
    const c = canvas.getContext('2d'); c.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    Render.drawSlide(c, d, slide, S.assets, { scale: k * dpr, slideNum: S.doc.slides.indexOf(slide) + 1 });
  },
  drawLayout(canvas, lay, width) {
    const d = S.doc, k = width / d.w, dpr = DPR();
    const sig = JSON.stringify(lay) + JSON.stringify(d.master) + JSON.stringify(d.theme) + width;
    if (this.keys.get(canvas) === sig) return; this.keys.set(canvas, sig);
    canvas.width = Math.round(d.w * k * dpr); canvas.height = Math.round(d.h * k * dpr);
    canvas.style.width = Math.round(d.w * k) + 'px'; canvas.style.height = Math.round(d.h * k) + 'px';
    const c = canvas.getContext('2d'); c.setTransform(k * dpr, 0, 0, k * dpr, 0, 0);
    Render.drawLayout(c, d, lay, S.assets, { scale: k * dpr, prompts: true });
  },
};
Render.onImageLoad = () => { requestRender(); UI.thumbsSoon && UI.thumbsSoon(true); };
