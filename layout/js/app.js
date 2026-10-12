'use strict';
/* Lumen Layout — application core: state, history, page placement, view transform, stage rendering
   (page content canvas + overlay canvas for guides, selection, caret, threads). */
const S = window.S = {
  doc: null, images: {}, eng: null, hist: null, name: 'Untitled', path: null,
  view: { z: 1, ox: 0, oy: 0 }, mode: { kind: 'doc' }, placed: [], sepPlate: null, swTarget: 'fill',
  sel: [], edit: null, content: null, cell: null, tool: 'select', curPage: 0, activeLayer: null,
  opt: { rulers: true, guides: true, baseline: false, frames: true, threads: true, snap: true, smart: true, preview: false, hidden: false, lockGuides: false },
  drag: null, smart: [], hover: null, loadedThread: null, clip: null, dirtyBase: true, mouse: { x: 0, y: 0 },
};
const $ = s => document.querySelector(s);
const DPR = () => window.devicePixelRatio || 1;

/* ---------------- document lifecycle & history ---------------- */
function snapshot() { return { doc: structuredClone(S.doc), sel: [...S.sel], edit: S.edit ? { ...S.edit } : null, mode: { ...S.mode }, curPage: S.curPage }; }
function restore(st) {
  S.doc = structuredClone(st.doc); S.sel = st.sel.filter(Boolean); S.edit = st.edit ? { ...st.edit } : null; S.mode = { ...st.mode }; S.content = null; S.cell = null;
  if (S.mode.kind === 'master' && !S.doc.masters.find(m => m.id === S.mode.id)) S.mode = { kind: 'doc' };
  S.curPage = Math.min(st.curPage || 0, S.doc.pages.length - 1);
  docChanged(true);
  if (S.edit) { const s = S.doc.stories[S.edit.sid]; if (!s) S.edit = null; else { S.edit.a = Math.min(S.edit.a, s.text.length); S.edit.f = Math.min(S.edit.f, s.text.length); } }
  UI.syncEditor?.();
}
let typingTimer = null, typingBurst = false;
function commit(label) {
  flushTyping();
  S.hist.push(label, snapshot());
  docChanged();
}
// Typing is coalesced: the first keystroke of a burst pushes a 'Typing' state, later keystrokes update it in place.
function commitTyping() {
  const top = S.hist.items[S.hist.index];
  if (typingBurst && top && top.label === 'Typing') { top.state = snapshot(); Aero.setDirty(true); }
  else { S.hist.push('Typing', snapshot()); typingBurst = true; }
  clearTimeout(typingTimer); typingTimer = setTimeout(() => { typingBurst = false; }, 1200);
  // fast path: recompose only the edited story, and only up to a couple of frames past the caret
  let hint = null;
  if (S.edit && S.eng) { const st = S.doc.stories[S.edit.sid]; const k = st ? st.frames.indexOf(S.edit.fid) : -1; hint = { sid: S.edit.sid, upto: Math.max(0, k) + 3 }; }
  docChanged(false, hint);
}
let fullTimer = null;
function flushTyping() { clearTimeout(typingTimer); typingBurst = false; }
function docChanged(rebuildPanels, hint) {
  const prev = S.eng;
  Color.use(S.doc); Color.invalidate(); Engine.images = S.images;
  S.eng = hint && prev && prev.doc === S.doc ? new Engine(S.doc, prev, hint) : new Engine(S.doc);
  clearTimeout(fullTimer);
  if (hint) fullTimer = setTimeout(() => { if (S.eng.partial) { S.eng = new Engine(S.doc); requestRender(true); UI.refresh(); } }, 350);
  S.sel = S.sel.filter(id => S.eng.idx.has(id));
  if (S.content && !S.eng.idx.has(S.content)) S.content = null;
  if (S.cell && !S.eng.idx.has(S.cell.id)) S.cell = null;
  if (!S.doc.layers.find(l => l.id === S.activeLayer)) S.activeLayer = S.doc.layers[0].id;
  placePages();
  requestRender(true);
  UI.refresh(rebuildPanels);
}
function setDocument(doc, images, name, path) {
  S.doc = doc; S.images = images || {}; S.name = name || 'Untitled'; S.path = path || null;
  S.sel = []; S.edit = null; S.content = null; S.cell = null; S.mode = { kind: 'doc' }; S.curPage = 0; S.activeLayer = doc.layers[0].id;
  for (const [id, im] of Object.entries(S.images)) loadImageEl(id, im);
  S.hist.reset('Open', snapshot());
  docChanged(true);
  Aero.setDoc(S.name, false);
  requestAnimationFrame(() => View.fitPage());
}
function loadImageEl(id, im) {
  if (im.el) return;
  const el = new Image(); el.decoding = 'async'; im.el = el;
  el.onload = () => { if (S.doc) { Engine.images = S.images; S.eng = new Engine(S.doc); } requestRender(true); UI.thumbsSoon(); };
  el.src = im.data;
}
// add an image asset from bytes; resolves to id
async function addImage(name, mime, data) {
  const u8 = new Uint8Array(data);
  let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  if (!mime) mime = /\.svg$/i.test(name) ? 'image/svg+xml' : /\.png$/i.test(name) ? 'image/png' : /\.(jpe?g)$/i.test(name) ? 'image/jpeg' : /\.webp$/i.test(name) ? 'image/webp' : /\.gif$/i.test(name) ? 'image/gif' : '';
  if (!/^image\/(png|jpeg|svg\+xml|webp|gif)$/.test(mime)) throw new Error('Unsupported image type');
  const url = `data:${mime};base64,` + btoa(s);
  let w = 0, h = 0;
  if (mime === 'image/svg+xml') {
    const txt = new TextDecoder().decode(u8);
    const svg = (txt.match(/<svg[^>]*>/i) || [''])[0];
    const num = a => { const m = new RegExp(`\\s${a}\\s*=\\s*["']\\s*([\\d.]+)\\s*(px|pt|mm|in)?`, 'i').exec(svg); if (!m) return 0; const f = { pt: 4 / 3, mm: 96 / 25.4, in: 96 }[m[2]?.toLowerCase()] || 1; return +m[1] * f; };
    w = num('width'); h = num('height');
    const vb = /viewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(svg);
    if ((!w || !h) && vb) { const vw = +vb[3], vh = +vb[4]; if (w && !h) h = w * vh / vw; else if (h && !w) w = h * vw / vh; else { w = vw; h = vh; } }
    if (!w || !h) { w = 300; h = 150; }
  }
  const el = new Image(); el.src = url;
  await el.decode().catch(() => { throw new Error('Could not decode ' + name); });
  if (!w) { w = el.naturalWidth; h = el.naturalHeight; }
  const id = 'G' + M.uid();
  S.images[id] = { name, mime, data: url, w, h, el };
  return id;
}

/* ---------------- page placement (world coordinates in pt) ---------------- */
function placePages() {
  const d = S.doc, W = d.w, H = d.h, gap = 40, out = [];
  if (S.mode.kind === 'master') {
    const m = d.masters.find(x => x.id === S.mode.id);
    m.pages.forEach((p, side) => out.push({ page: p, kind: 'master', master: m, side, index: null, x: m.pages.length > 1 ? (side === 0 ? -W : 0) : -W / 2, y: 0, w: W, h: H, row: 0 }));
  } else if (d.facing) {
    let y = 0, row = 0;
    for (let i = 0; i < d.pages.length;) {
      if (i === 0) { out.push({ page: d.pages[0], kind: 'doc', index: 0, x: 0, y, w: W, h: H, row }); i = 1; }
      else { out.push({ page: d.pages[i], kind: 'doc', index: i, x: -W, y, w: W, h: H, row }); if (i + 1 < d.pages.length) out.push({ page: d.pages[i + 1], kind: 'doc', index: i + 1, x: 0, y, w: W, h: H, row }); i += 2; }
      y += H + gap; row++;
    }
  } else d.pages.forEach((p, i) => out.push({ page: p, kind: 'doc', index: i, x: -W / 2, y: i * (H + gap), w: W, h: H, row: i }));
  S.placed = out;
}
const placedOf = page => S.placed.find(p => p.page === page);
function placedById(pageId) { return S.placed.find(p => p.page.id === pageId); }
function itemPlaced(id) { const inf = S.eng.idx.get(id); return inf ? placedOf(inf.page) : null; }
function pageAt(wx, wy, near) {
  for (const p of S.placed) if (wx >= p.x && wx <= p.x + p.w && wy >= p.y && wy <= p.y + p.h) return p;
  if (!near) return null;
  let best = null, bd = Infinity;
  for (const p of S.placed) { const dx = Math.max(p.x - wx, 0, wx - p.x - p.w), dy = Math.max(p.y - wy, 0, wy - p.y - p.h), dd = dx * dx + dy * dy; if (dd < bd) { bd = dd; best = p; } }
  return best;
}
function labelFor(pp) { return pp.kind === 'doc' ? S.eng.label(pp.index) : pp.master.prefix; }
function curPlaced() { return S.mode.kind === 'master' ? S.placed[0] : S.placed.find(p => p.index === S.curPage) || S.placed[0]; }

/* ---------------- view ---------------- */
const View = {
  w2s(x, y) { return [x * S.view.z + S.view.ox, y * S.view.z + S.view.oy]; },
  s2w(x, y) { return [(x - S.view.ox) / S.view.z, (y - S.view.oy) / S.view.z]; },
  size() { const c = $('#cv'); return [c.clientWidth, c.clientHeight]; },
  zoomAt(z, sx, sy) {
    z = Aero.clamp(z, 0.05, 40);
    const [wx, wy] = this.s2w(sx, sy); S.view.z = z; S.view.ox = sx - wx * z; S.view.oy = sy - wy * z; requestRender(true); UI.status();
  },
  zoomBy(f) { const [w, h] = this.size(); this.zoomAt(S.view.z * f, w / 2, h / 2); },
  fitRect(x, y, w, h, pad = 36) { const [cw, ch] = this.size(); const z = Math.min((cw - pad * 2) / w, (ch - pad * 2) / h); S.view.z = Aero.clamp(z, 0.05, 40); S.view.ox = cw / 2 - (x + w / 2) * S.view.z; S.view.oy = ch / 2 - (y + h / 2) * S.view.z; requestRender(true); UI.status(); },
  fitPage() { const p = curPlaced(); if (p) this.fitRect(p.x, p.y, p.w, p.h); },
  fitSpread() { const p = curPlaced(); if (!p) return; const row = S.placed.filter(q => q.row === p.row); const x0 = Math.min(...row.map(q => q.x)), x1 = Math.max(...row.map(q => q.x + q.w)); this.fitRect(x0, p.y, x1 - x0, p.h); },
  actual() { const p = curPlaced(); const [cw, ch] = this.size(); S.view.z = 1; S.view.ox = cw / 2 - (p.x + p.w / 2); S.view.oy = 30 - p.y; requestRender(true); UI.status(); },
  goPage(i) { S.curPage = Aero.clamp(i, 0, S.doc.pages.length - 1); if (S.mode.kind !== 'doc') { S.mode = { kind: 'doc' }; S.sel = []; S.edit = null; placePages(); } const p = curPlaced(); const [cw, ch] = this.size(); const z = S.view.z; if (z < 0.08 || p.h * z < 100) return this.fitPage(); S.view.ox = cw / 2 - (p.x + p.w / 2) * z; S.view.oy = 24 - p.y * z; requestRender(true); UI.refresh(); },
};

/* ---------------- rendering ---------------- */
let rafId = 0, baseDirty = true;
function requestRender(base) { if (base) baseDirty = true; if (!rafId) rafId = requestAnimationFrame(renderAll); }
function renderAll() {
  rafId = 0;
  if (!S.doc || !S.eng) return;
  const cv = $('#cv'), ov = $('#ov'), dpr = DPR();
  const cw = cv.clientWidth, ch = cv.clientHeight;
  for (const c of [cv, ov]) if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) { c.width = Math.round(cw * dpr); c.height = Math.round(ch * dpr); baseDirty = true; }
  if (baseDirty) { renderBase(cv.getContext('2d'), cw, ch, dpr); baseDirty = false; }
  renderOverlay(ov.getContext('2d'), cw, ch, dpr);
  Rulers.draw();
  if (window.Typo && Typo.isOpen) Typo.place();
}
function renderBase(ctx, cw, ch, dpr) {
  const { z, ox, oy } = S.view, pv = S.opt.preview, d = S.doc;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = pv ? '#7d8a98' : '#d3dce6'; ctx.fillRect(0, 0, cw, ch);
  const env = { engine: S.eng, images: S.images, hidden: S.opt.hidden && !pv, opPreview: !!S.opt.opPreview };
  const vis = p => { const [sx, sy] = View.w2s(p.x, p.y); const pad = 400 * z; return sx + p.w * z > -pad && sx < cw + pad && sy + p.h * z > -pad && sy < ch + pad; };
  // page shadows + paper
  for (const p of S.placed) {
    if (!vis(p)) continue;
    const [sx, sy] = View.w2s(p.x, p.y);
    ctx.save(); ctx.shadowColor = 'rgba(20,40,70,.35)'; ctx.shadowBlur = 10; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#fff'; ctx.fillRect(sx, sy, p.w * z, p.h * z); ctx.restore();
  }
  for (const p of S.placed) {
    if (!vis(p)) continue;
    ctx.save();
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (ox + p.x * z), dpr * (oy + p.y * z));
    if (pv) { ctx.beginPath(); ctx.rect(0, 0, p.w, p.h); ctx.clip(); }
    env.label = labelFor(p);
    Color.withPlate(S.sepPlate, () => Render.drawPage(ctx, env, p.page, p.kind === 'doc' ? p.index : null));
    ctx.restore();
  }
  // in preview, repaint a hairline between facing pages
  if (!pv) for (const p of S.placed) if (d.facing && p.kind === 'doc' && p.x < 0) { const [sx, sy] = View.w2s(0, p.y); ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(Math.round(sx), sy, 1, p.h * z); }
}

const COL = { margin: '#d64fd1', column: '#8a4fd6', guide: '#14b8d8', bleed: '#e0453a', slug: '#3a8be0', frame: '#7aa7e0', sel: '#1f6fd6', thread: '#1f6fd6', smart: '#e0179c', base: 'rgba(80,160,230,.35)' };
function renderOverlay(ctx, cw, ch, dpr) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cw, ch);
  const { z } = S.view, d = S.doc, pv = S.opt.preview;
  const line = (x0, y0, x1, y1) => { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); };
  const px = v => Math.round(v) + 0.5;
  for (const p of S.placed) {
    const [sx, sy] = View.w2s(p.x, p.y), sw = p.w * z, sh = p.h * z;
    if (sx > cw || sy > ch || sx + sw < 0 || sy + sh < 0) continue;
    if (pv) continue;
    ctx.lineWidth = 1;
    // bleed & slug
    if (d.bleed > 0) { const b = d.bleed * z; ctx.strokeStyle = COL.bleed; ctx.globalAlpha = .8; ctx.strokeRect(px(sx - b), px(sy - b), Math.round(sw + 2 * b), Math.round(sh + 2 * b)); ctx.globalAlpha = 1; }
    if (d.slug > 0) { const b = (d.bleed + d.slug) * z; ctx.strokeStyle = COL.slug; ctx.setLineDash([4, 3]); ctx.strokeRect(px(sx - b), px(sy - b), Math.round(sw + 2 * b), Math.round(sh + 2 * b)); ctx.setLineDash([]); }
    if (S.opt.guides) {
      const m = S.eng.marginsFor(p.kind, p.kind === 'doc' ? p.index : p.side);
      // baseline grid
      if (S.opt.baseline && d.grid.step * z >= 3) {
        ctx.beginPath(); ctx.strokeStyle = COL.base;
        for (let y = d.grid.start; y <= p.h; y += d.grid.step) { const yy = px(sy + y * z); line(sx + m.l * z, yy, sx + (p.w - m.r) * z, yy); }
        ctx.stroke();
      }
      ctx.beginPath(); ctx.strokeStyle = COL.margin;
      ctx.rect(px(sx + m.l * z), px(sy + m.t * z), Math.round((p.w - m.l - m.r) * z), Math.round((p.h - m.t - m.b) * z)); ctx.stroke();
      if (d.cols > 1) {
        ctx.beginPath(); ctx.strokeStyle = COL.column;
        const cwid = (p.w - m.l - m.r - d.gutter * (d.cols - 1)) / d.cols;
        for (let c = 1; c < d.cols; c++) { const x1 = m.l + c * cwid + (c - 1) * d.gutter, x2 = x1 + d.gutter; for (const x of [x1, x2]) line(px(sx + x * z), sy + m.t * z, px(sx + x * z), sy + (p.h - m.b) * z); }
        ctx.stroke();
      }
      // ruler guides (page + master)
      const gl = [...(p.page.guides || [])];
      if (p.kind === 'doc') { const mp = S.eng.masterPage(p.page, p.index); if (mp) gl.push(...mp.guides.map(g => ({ ...g, master: true }))); }
      for (const g of gl) {
        ctx.beginPath(); ctx.strokeStyle = S.drag?.guide === g ? '#0a5fd8' : COL.guide; ctx.globalAlpha = g.master ? .55 : 1;
        if (g.o === 'v') line(px(sx + g.pos * z), sy - 20, px(sx + g.pos * z), sy + sh + 20); else line(sx - 20, px(sy + g.pos * z), sx + sw + 20, px(sy + g.pos * z));
        ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
    // frame edges
    if (S.opt.frames) {
      const items = [];
      if (p.kind === 'doc') { const mp = S.eng.masterPage(p.page, p.index); if (mp) M.walkItems(mp.items, it => { if (it.type !== 'group' && !(p.page.overrides || []).includes(it.id)) items.push([it, true]); }); }
      M.walkItems(p.page.items, it => { if (it.type !== 'group') items.push([it, false]); });
      for (const [it, fromMaster] of items) {
        if (it.type === 'line' || it.type === 'table' || !S.eng.layerVisible(it)) continue;
        const lay = S.eng.layerById.get(it.layer);
        ctx.strokeStyle = fromMaster ? 'rgba(120,140,170,.55)' : (lay?.color || COL.frame); ctx.globalAlpha = fromMaster ? 1 : .7;
        ctx.setLineDash(fromMaster ? [2, 2] : []);
        polyItem(ctx, p, it); ctx.stroke(); ctx.setLineDash([]);
        if (it.type === 'image' && !it.img) { const c = cornersS(p, it); ctx.beginPath(); line(c[0][0], c[0][1], c[2][0], c[2][1]); line(c[1][0], c[1][1], c[3][0], c[3][1]); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
    }
  }
  if (S.mode.kind === 'master' || !pv) {
    // threads & ports for selected text frames / edited story
    const stories = new Set();
    for (const id of S.sel) { const it = S.eng.idx.get(id)?.item; if (it?.type === 'text') stories.add(it.story); }
    if (S.edit) stories.add(S.edit.sid);
    for (const sid of stories) drawThreads(ctx, sid);
  }
  // overset markers on any frame (even unselected)
  if (!pv) for (const p of S.placed) M.walkItems(p.page.items, it => { if (it.type === 'text') { const L = S.eng.frameLayout(it, labelFor(p)); if (L && L.last && L.overset) { const c = cornersS(p, it)[2]; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#d42020'; ctx.lineWidth = 1; ctx.fillRect(c[0] - 13, c[1] - 6, 9, 9); ctx.strokeRect(c[0] - 12.5, c[1] - 5.5, 8, 8); ctx.fillStyle = '#d42020'; ctx.fillRect(c[0] - 11, c[1] - 2, 5, 1.6); ctx.fillRect(c[0] - 9.3, c[1] - 3.8, 1.6, 5.2); } } });
  Tools.drawOverlay(ctx, cw, ch);
}
function cornersS(p, it) {
  const r = (it.rot || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), cx = it.x + it.w / 2, cy = it.y + it.h / 2;
  return [[-it.w / 2, -it.h / 2], [it.w / 2, -it.h / 2], [it.w / 2, it.h / 2], [-it.w / 2, it.h / 2]].map(([x, y]) => View.w2s(p.x + cx + x * c - y * s, p.y + cy + x * s + y * c));
}
function polyItem(ctx, p, it) { const c = cornersS(p, it); ctx.beginPath(); ctx.moveTo(c[0][0], c[0][1]); for (let k = 1; k < 4; k++) ctx.lineTo(c[k][0], c[k][1]); ctx.closePath(); }
function portRects(p, it) { const c = cornersS(p, it); return { inP: [c[0][0] + 6, c[0][1] + 6], outP: [c[2][0] - 6, c[2][1] - 6] }; }
function drawThreads(ctx, sid) {
  const s = S.doc.stories[sid]; if (!s) return;
  const fr = s.frames.map(id => S.eng.idx.get(id)).filter(Boolean);
  const pts = [];
  fr.forEach((f, k) => {
    const p = placedOf(f.page); if (!p) return;
    const L = S.eng.frameLayout(f.item, labelFor(p));
    const { inP, outP } = portRects(p, f.item);
    pts.push({ inP, outP });
    const box = (x, y, kind) => {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = kind === 'over' ? '#d42020' : COL.thread; ctx.lineWidth = 1;
      ctx.fillRect(x - 4.5, y - 4.5, 9, 9); ctx.strokeRect(x - 4, y - 4, 8, 8);
      ctx.fillStyle = kind === 'over' ? '#d42020' : COL.thread;
      if (kind === 'over') { ctx.fillRect(x - 2.5, y - 0.8, 5, 1.6); ctx.fillRect(x - 0.8, y - 2.5, 1.6, 5); }
      if (kind === 'link') { ctx.beginPath(); ctx.moveTo(x - 2, y - 2.5); ctx.lineTo(x + 2.5, y); ctx.lineTo(x - 2, y + 2.5); ctx.fill(); }
    };
    box(inP[0], inP[1], k > 0 ? 'link' : 'empty');
    box(outP[0], outP[1], k < fr.length - 1 ? 'link' : (L && L.overset ? 'over' : 'empty'));
  });
  if (S.opt.threads && pts.length > 1) {
    ctx.strokeStyle = COL.thread; ctx.lineWidth = 1.2; ctx.setLineDash([]);
    for (let k = 0; k + 1 < pts.length; k++) { const a = pts[k].outP, b = pts[k + 1].inP; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.bezierCurveTo(a[0] + 50, a[1], b[0] - 50, b[1], b[0], b[1]); ctx.stroke(); }
  }
}

/* ---------------- rulers ---------------- */
const Rulers = {
  draw() {
    const show = S.opt.rulers;
    $('#stage').classList.toggle('norulers', !show);
    if (!show) return;
    const u = S.doc.units, z = S.view.z;
    const origin = curPlaced() || { x: 0, y: 0 };
    for (const [id, horiz] of [['#rh', true], ['#rv', false]]) {
      const c = $(id), dpr = DPR(), w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const g = ctx.createLinearGradient(0, 0, horiz ? 0 : w, horiz ? h : 0); g.addColorStop(0, '#fbfdff'); g.addColorStop(1, '#e3ebf5');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#9fb2c8'; ctx.beginPath(); if (horiz) { ctx.moveTo(0, h - .5); ctx.lineTo(w, h - .5); } else { ctx.moveTo(w - .5, 0); ctx.lineTo(w - .5, h); } ctx.stroke();
      const unitPt = M.UNITS[u];
      // choose major step in units so labels are >= 50px apart
      const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000];
      let major = steps.find(s => s * unitPt * z >= 52) || 1000;
      const mpx = major * unitPt * z, div = mpx / 10 >= 5 ? 10 : mpx / 5 >= 5 ? 5 : 2;
      const minor = major / div;
      const o = horiz ? origin.x : origin.y;
      const len = horiz ? w : h;
      const toS = v => (o + v * unitPt) * z + (horiz ? S.view.ox : S.view.oy);
      const v0 = Math.floor(((horiz ? -S.view.ox : -S.view.oy) / z - o) / unitPt / minor) * minor;
      ctx.fillStyle = '#3a4d63'; ctx.font = '9px "Segoe UI",sans-serif'; ctx.strokeStyle = '#7c8fa6'; ctx.beginPath();
      for (let v = v0, k = 0; k < 2000; v += minor, k++) {
        const s = Math.round(toS(v)) + .5; if (s > len) break;
        const isMaj = Math.abs(v / major - Math.round(v / major)) < 1e-6;
        const tl = isMaj ? 17 : (div === 10 && Math.abs((v * 2) / major - Math.round((v * 2) / major)) < 1e-6 ? 8 : 4);
        if (horiz) { ctx.moveTo(s, h); ctx.lineTo(s, h - tl); } else { ctx.moveTo(w, s); ctx.lineTo(w - tl, s); }
        if (isMaj) {
          const t = String(+v.toFixed(2));
          if (horiz) ctx.fillText(t, s + 2, 9); else { ctx.save(); ctx.translate(9, s + 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(t, 0, 0); ctx.restore(); }
        }
      }
      ctx.stroke();
      // mouse marker
      const m = horiz ? S.mouse.x : S.mouse.y;
      if (m > 0) { ctx.strokeStyle = '#d42020'; ctx.beginPath(); if (horiz) { ctx.moveTo(m + .5, 0); ctx.lineTo(m + .5, h); } else { ctx.moveTo(0, m + .5); ctx.lineTo(w, m + .5); } ctx.stroke(); }
    }
  },
};

/* ---------------- boot ---------------- */
async function boot() {
  S.hist = new Aero.History({ max: 120, onChange: () => UI.historyList() });
  UI.build();
  Aero.busy('Loading fonts…');
  try { await Fonts.load(); } catch (e) { console.error(e); Aero.toast('Some fonts could not be loaded'); }
  Aero.busy();
  const d = M.newDoc({ units: 'mm', w: 595.28, h: 841.89, pages: 1, margins: { t: 42.52, b: 42.52, i: 42.52, o: 42.52 }, cols: 2, gutter: 14.17 }); IO.defaultStyles(d);
  setDocument(d, {}, 'Untitled');
  new ResizeObserver(() => requestRender(true)).observe($('#cv'));
  if (/[?&]sample/.test(location.search)) IO.openSample();
  window.__layoutReady = true;
}
window.addEventListener('DOMContentLoaded', boot);
