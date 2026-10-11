'use strict';
/* Lumen Layout — tools & interaction: selection/transform, frame creation, threading, guides,
   snapping + smart guides, image content panning, table cells and in-frame text editing. */
const Tools = (() => {
  const ov = () => $('#ov');
  const rad = d => d * Math.PI / 180;
  const HS = 4; // handle half size (px)

  /* ---------- geometry ---------- */
  function toLocal(it, px, py) { const r = -rad(it.rot || 0), c = Math.cos(r), s = Math.sin(r), cx = it.x + it.w / 2, cy = it.y + it.h / 2, dx = px - cx, dy = py - cy; return [dx * c - dy * s + it.w / 2, dx * s + dy * c + it.h / 2]; }
  function toPage(it, lx, ly) { const r = rad(it.rot || 0), c = Math.cos(r), s = Math.sin(r), cx = it.x + it.w / 2, cy = it.y + it.h / 2, dx = lx - it.w / 2, dy = ly - it.h / 2; return [cx + dx * c - dy * s, cy + dx * s + dy * c]; }
  function l2s(pp, it, lx, ly) { const [x, y] = toPage(it, lx, ly); return View.w2s(pp.x + x, pp.y + y); }
  function info(id) { return S.eng.idx.get(id); }
  function layerLocked(it) { const l = S.eng.layerById.get(it.layer); return l && (l.locked || l.visible === false); }
  function selectable(it) { return !it.locked && !layerLocked(it) && !it.hidden; }
  function hitTest(it, px, py, tol) {
    if (it.type === 'group') return it.children.some(c => hitTest(c, px, py, tol));
    const [lx, ly] = toLocal(it, px, py);
    if (it.type === 'line') {
      const [x0, y0, x1, y1] = (it.dir || 1) > 0 ? [0, 0, it.w, it.h] : [0, it.h, it.w, 0];
      const dx = x1 - x0, dy = y1 - y0, L2 = dx * dx + dy * dy || 1, t = Aero.clamp(((lx - x0) * dx + (ly - y0) * dy) / L2, 0, 1);
      return Math.hypot(lx - x0 - t * dx, ly - y0 - t * dy) <= tol + it.sw / 2;
    }
    return lx >= -tol && ly >= -tol && lx <= it.w + tol && ly <= it.h + tol;
  }
  // returns {item, top (top-level item), pp}
  function hitAt(wx, wy, deep) {
    const tol = 3 / S.view.z;
    const order = [...S.placed].sort((a, b) => (pointIn(b, wx, wy) ? 1 : 0) - (pointIn(a, wx, wy) ? 1 : 0));
    for (const pp of order) {
      const px = wx - pp.x, py = wy - pp.y;
      const items = S.eng.sortedItems(pp.page.items);
      for (let k = items.length - 1; k >= 0; k--) {
        const it = items[k];
        if (!selectable(it) || !S.eng.layerVisible(it)) continue;
        if (!hitTest(it, px, py, tol)) continue;
        if (it.type === 'group' && deep) { const ch = deepHit(it, px, py, tol); if (ch) return { item: ch, top: it, pp }; }
        return { item: it, top: it, pp };
      }
    }
    return null;
  }
  function deepHit(g, px, py, tol) { for (let k = g.children.length - 1; k >= 0; k--) { const c = g.children[k]; if (!hitTest(c, px, py, tol)) continue; return c.type === 'group' ? deepHit(c, px, py, tol) : c; } return null; }
  function pointIn(p, x, y) { return x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h; }
  function worldBox(id) { const inf = info(id); const pp = placedOf(inf.page); const b = Geo.bbox(inf.item); return { x: b.x + pp.x, y: b.y + pp.y, w: b.w, h: b.h, pp }; }
  function selBox() {
    if (!S.sel.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of S.sel) { const b = worldBox(id); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  const UV = [[0, 0], [.5, 0], [1, 0], [1, .5], [1, 1], [.5, 1], [0, 1], [0, .5]];
  function handles() {
    if (!S.sel.length || S.edit || S.content) return null;
    if (S.sel.length === 1) {
      const inf = info(S.sel[0]), it = inf.item, pp = placedOf(inf.page);
      if (it.type !== 'group') {
        const pts = UV.map(([u, v]) => l2s(pp, it, u * it.w, v * it.h));
        const top = l2s(pp, it, it.w / 2, 0), cen = l2s(pp, it, it.w / 2, it.h / 2);
        const dx = top[0] - cen[0], dy = top[1] - cen[1], L = Math.hypot(dx, dy) || 1;
        return { pts, knob: [top[0] + dx / L * 22, top[1] + dy / L * 22], top, single: it, pp };
      }
    }
    const b = selBox(); const [x, y] = View.w2s(b.x, b.y), w = b.w * S.view.z, h = b.h * S.view.z;
    const pts = UV.map(([u, v]) => [x + u * w, y + v * h]);
    return { pts, knob: [x + w / 2, y - 22], top: [x + w / 2, y], box: b };
  }

  /* ---------- snapping ---------- */
  function snapLines(pp, exclude) {
    const d = S.doc, W = pp.w, H = pp.h, xs = [], ys = [];
    const add = (arr, v, kind, ref) => arr.push({ v, kind, ref });
    add(xs, 0, 'page'); add(xs, W / 2, 'center'); add(xs, W, 'page'); add(ys, 0, 'page'); add(ys, H / 2, 'center'); add(ys, H, 'page');
    if (S.opt.guides) {
      const m = S.eng.marginsFor(pp.kind, pp.kind === 'doc' ? pp.index : pp.side);
      add(xs, m.l, 'margin'); add(xs, W - m.r, 'margin'); add(ys, m.t, 'margin'); add(ys, H - m.b, 'margin');
      const cw = (W - m.l - m.r - d.gutter * (d.cols - 1)) / d.cols;
      for (let c = 1; c < d.cols; c++) { const x1 = m.l + c * cw + (c - 1) * d.gutter; add(xs, x1, 'col'); add(xs, x1 + d.gutter, 'col'); }
      const gl = [...pp.page.guides]; if (pp.kind === 'doc') { const mp = S.eng.masterPage(pp.page, pp.index); if (mp) gl.push(...mp.guides); }
      for (const g of gl) add(g.o === 'v' ? xs : ys, g.pos, 'guide');
      if (S.opt.baseline) for (let y = d.grid.start; y <= H; y += d.grid.step) add(ys, y, 'grid');
    }
    if (S.opt.smart) for (const it of pp.page.items) {
      if (exclude.has(it.id) || !S.eng.layerVisible(it)) continue;
      const b = Geo.bbox(it);
      add(xs, b.x, 'item', b); add(xs, b.x + b.w / 2, 'item', b); add(xs, b.x + b.w, 'item', b);
      add(ys, b.y, 'item', b); add(ys, b.y + b.h / 2, 'item', b); add(ys, b.y + b.h, 'item', b);
    }
    return { xs, ys };
  }
  // edges: {x:[...], y:[...]} page coords; returns {dx, dy, hits}
  function snap(pp, edges, exclude) {
    S.smart = [];
    if (!S.opt.snap || !pp) return { dx: 0, dy: 0 };
    const L = snapLines(pp, exclude), tol = 6 / S.view.z;
    const best = (cands, vals) => { let b = null; for (const c of cands) for (const v of vals) { const dd = c.v - v; if (Math.abs(dd) <= tol && (!b || Math.abs(dd) < Math.abs(b.d))) b = { d: dd, c }; } return b; };
    const bx = edges.x ? best(L.xs, edges.x) : null, by = edges.y ? best(L.ys, edges.y) : null;
    const res = { dx: bx ? bx.d : 0, dy: by ? by.d : 0 };
    if (bx && (bx.c.kind === 'item' || bx.c.kind === 'center')) S.smart.push({ o: 'v', pp, v: bx.c.v, ref: bx.c.ref });
    if (by && (by.c.kind === 'item' || by.c.kind === 'center')) S.smart.push({ o: 'h', pp, v: by.c.v, ref: by.c.ref });
    return res;
  }

  /* ---------- items & stories ---------- */
  function addItem(pp, it) { it.layer = it.layer || S.activeLayer; pp.page.items.push(it); return it; }
  function newTextFrame(pp, x, y, w, h, ps) {
    const s = M.newStory(S.doc, ps || 'basic');
    const it = M.newItem('text', x, y, w, h, { story: s.id, cols: 1, gutter: S.doc.gutter });
    s.frames = [it.id]; return addItem(pp, it);
  }
  function removeItemById(id) {
    const inf = info(id); if (!inf) return;
    const arr = inf.parent ? inf.parent.children : inf.page.items;
    const k = arr.indexOf(inf.item); if (k >= 0) arr.splice(k, 1);
    M.walkItems([inf.item], it => {
      if (it.type === 'text') { const s = S.doc.stories[it.story]; if (s) { s.frames = s.frames.filter(f => f !== it.id); if (!s.frames.length) delete S.doc.stories[s.id]; } }
    });
    if (inf.parent) { if (inf.parent.children.length === 0) removeItemById(inf.parent.id); else Geo.syncGroup(inf.parent); }
  }
  function cloneItems(items, dx = 0, dy = 0) {
    const smap = new Map();
    const cl = it => {
      const c = structuredClone(it); c.id = 'I' + M.uid(); c.x += dx; c.y += dy;
      if (c.type === 'group') c.children = it.children.map(cl);
      if (c.type === 'text') {
        let ns = smap.get(it.story);
        if (!ns) { const os = S.doc.stories[it.story]; ns = structuredClone(os); ns.id = 'S' + M.uid(); ns.frames = []; S.doc.stories[ns.id] = ns; smap.set(it.story, ns); }
        ns.frames.push(c.id); c.story = ns.id;
      }
      return c;
    };
    return items.map(cl);
  }
  function linkFrames(aId, bId) {
    const A = info(aId)?.item, B = info(bId)?.item; if (!A || !B || A === B) return false;
    const sA = S.doc.stories[A.story], sB = S.doc.stories[B.story];
    if (sA === sB) return false;
    if (sB.text.length) { const end = sA.text.length; M.insertText(sA, end, '\n', sA.ca[end - 1] ?? 0); M.insertRich(sA, sA.text.length, M.sliceRich(sB, 0, sB.text.length)); }
    // B's own chain followers come along
    const follow = sB.frames.slice(sB.frames.indexOf(B.id));
    sB.frames = sB.frames.filter(f => !follow.includes(f));
    if (!sB.frames.length) delete S.doc.stories[sB.id];
    else if (sB.text.length) { /* text already moved */ sB.text = ''; sB.ca = []; sB.paras = [sB.paras[0]]; }
    const k = sA.frames.indexOf(A.id);
    sA.frames.splice(k + 1, 0, ...follow);
    follow.forEach(f => { info(f).item.story = sA.id; });
    return true;
  }
  function unlinkAfter(id) {
    const it = info(id).item, s = S.doc.stories[it.story]; const k = s.frames.indexOf(id);
    const rest = s.frames.slice(k + 1); if (!rest.length) return false;
    s.frames = s.frames.slice(0, k + 1);
    for (const f of rest) { const ns = M.newStory(S.doc, s.paras[s.paras.length - 1]?.ps || 'basic'); ns.frames = [f]; info(f).item.story = ns.id; }
    return true;
  }

  /* ---------- text editing ---------- */
  const T = {
    story() { return S.edit && S.doc.stories[S.edit.sid]; },
    range() { const e = S.edit; return [Math.min(e.a, e.f), Math.max(e.a, e.f)]; },
    frameLay(it) { const pp = placedOf(info(it.id).page); return { L: S.eng.frameLayout(it, labelFor(pp)), pp }; },
    lines(sid) {
      const s = S.doc.stories[sid], out = [];
      for (const fid of s.frames) { const inf = info(fid); if (!inf) continue; const pp = placedOf(inf.page); if (!pp) continue; const L = S.eng.frameLayout(inf.item, labelFor(pp)); if (!L) continue; for (const ln of L.lines) out.push({ ln, it: inf.item, pp }); }
      return out;
    },
    lineOf(sid, idx) {
      const ls = this.lines(sid), n = S.doc.stories[sid].text.length;
      for (let k = 0; k < ls.length; k++) { const l = ls[k].ln; if (idx >= l.a && (idx < l.b || (idx === l.b && (l.b === n && !l.para)))) return { ...ls[k], k, ls }; }
      return ls.length ? { ...ls[ls.length - 1], k: ls.length - 1, ls, over: true } : null;
    },
    caret() {
      if (!S.edit) return null;
      const r = this.lineOf(S.edit.sid, S.edit.f); if (!r) { const it = info(S.edit.fid)?.item; if (!it) return null; const pp = placedOf(info(it.id).page); const st = 12; return { it, pp, x: it.inset || 0, y0: it.inset || 0, y1: (it.inset || 0) + st }; }
      const l = r.ln; const x = r.over ? l.xs[l.xs.length - 1] : (l.xs[S.edit.f - l.a] ?? l.xs[l.xs.length - 1]);
      return { it: r.it, pp: r.pp, x, y0: l.y - l.asc, y1: l.y + l.desc, over: r.over };
    },
    indexAt(it, lx, ly) {
      const { L } = this.frameLay(it); if (!L) return 0;
      if (!L.lines.length) return L.a;
      let best = null, bd = Infinity;
      for (const l of L.lines) {
        const dy = ly < l.y - l.asc ? l.y - l.asc - ly : ly > l.y + l.desc ? ly - l.y - l.desc : 0;
        const dx = lx < l.L - 6 ? l.L - 6 - lx : lx > l.R + 6 ? lx - l.R - 6 : 0;
        const dd = dy + dx * 3; if (dd < bd) { bd = dd; best = l; }
      }
      const l = best, T = S.doc.stories[it.story].text;
      let end = l.b; if (end > l.a && /[\n\u2028]/.test(T[end - 1])) end--;
      for (let i = l.a; i < end; i++) { const x0 = l.xs[i - l.a], x1 = l.xs[i - l.a + 1]; if (lx < (x0 + x1) / 2) return i; }
      return end;
    },
    setCaret(i, extend) { const s = this.story(); i = Aero.clamp(i, 0, s.text.length); S.edit.f = i; if (!extend) S.edit.a = i; S.edit.typing = null; S.edit.gx = null; this.sync(); },
    sync() { UI.syncEditor(); requestRender(); UI.refresh(); },
    attrAt(pos) { const s = this.story(); return s.attrs[s.ca[pos - 1] ?? s.ca[pos] ?? 0] || {}; },
    insert(str) {
      const s = this.story(); if (!s) return;
      let [a, b] = this.range();
      if (a !== b) M.deleteRange(s, a, b);
      const ai = S.edit.typing ? M.attrIdx(s, S.edit.typing) : (s.ca[a - 1] !== undefined && s.text[a - 1] !== '\n' ? s.ca[a - 1] : s.ca[a] ?? s.ca[a - 1] ?? 0);
      const pi = M.paraIndexAt(s, a), atEnd = a === M.paraEnd(s, pi);
      const p = M.insertText(s, a, str, ai);
      if (str === '\n' && atEnd) { const ps = s.paras[pi].ps, nx = S.doc.paraStyles[ps]?.next; if (nx && S.doc.paraStyles[nx]) s.paras[pi + 1] = { ps: nx }; }
      S.edit.a = S.edit.f = p; S.edit.gx = null;
      commitTyping(); this.sync(); this.ensureVisible();
    },
    insertFrag(frag) { const s = this.story(); let [a, b] = this.range(); if (a !== b) M.deleteRange(s, a, b); const p = M.insertRich(s, a, frag); S.edit.a = S.edit.f = p; S.edit.typing = null; commit('Paste'); this.sync(); },
    del(dir, word) {
      const s = this.story(); let [a, b] = this.range();
      if (a === b) {
        if (dir < 0) { if (a === 0) return; a = word ? this.wordEdge(a, -1) : a - 1; }
        else { if (b >= s.text.length) return; b = word ? this.wordEdge(b, 1) : b + 1; }
      }
      M.deleteRange(s, a, b); S.edit.a = S.edit.f = a; S.edit.gx = null; commitTyping(); this.sync();
    },
    wordEdge(i, dir) {
      const t = this.story().text, isW = c => /[\p{L}\p{N}_'’]/u.test(c);
      if (dir < 0) { while (i > 0 && !isW(t[i - 1])) i--; while (i > 0 && isW(t[i - 1])) i--; return i; }
      while (i < t.length && !isW(t[i])) i++; while (i < t.length && isW(t[i])) i++; return i;
    },
    selectWord(i) { const t = this.story().text, isW = c => /[\p{L}\p{N}_'’]/u.test(c); let a = i, b = i; while (a > 0 && isW(t[a - 1])) a--; while (b < t.length && isW(t[b])) b++; if (a === b && b < t.length) b++; S.edit.a = a; S.edit.f = b; this.sync(); },
    selectPara(i) { const s = this.story(), pi = M.paraIndexAt(s, i); S.edit.a = M.paraStart(s, pi); S.edit.f = M.paraEnd(s, pi); this.sync(); },
    vertical(dir, extend) {
      const r = this.lineOf(S.edit.sid, S.edit.f); if (!r) return;
      const c = this.caret(); const gx = S.edit.gx ?? c.x;
      const t = r.ls[r.k + dir];
      if (!t) { this.setCaret(dir < 0 ? 0 : this.story().text.length, extend); return; }
      const l = t.ln, T = this.story().text; let end = l.b; if (end > l.a && /[\n\u2028]/.test(T[end - 1])) end--;
      let idx = end; for (let i = l.a; i < end; i++) { if (gx < (l.xs[i - l.a] + l.xs[i - l.a + 1]) / 2) { idx = i; break; } }
      this.setCaret(idx, extend); S.edit.gx = gx;
    },
    lineEdge(dir, extend) { const r = this.lineOf(S.edit.sid, S.edit.f); if (!r) return; const l = r.ln, T = this.story().text; let end = l.b; if (end > l.a && /[\n\u2028 ]/.test(T[end - 1]) && T[end - 1] !== ' ') end--; this.setCaret(dir < 0 ? l.a : end, extend); },
    ensureVisible() {
      const c = this.caret(); if (!c) return;
      const [sx, sy] = l2s(c.pp, c.it, c.x, c.y1); const [cw, ch] = View.size();
      if (sy > ch - 20) { S.view.oy -= sy - ch + 60; requestRender(true); } else if (sy < 20) { S.view.oy += 60 - sy; requestRender(true); }
      if (sx > cw - 10 || sx < 10) { S.view.ox += cw / 2 - sx; requestRender(true); }
    },
    selectedText() { const s = this.story(); if (!s) return ''; const [a, b] = this.range(); return s.text.slice(a, b).replace(/\uE000/g, '#').replace(/\u2028/g, '\n'); },
    enter(it, idx) {
      flushTyping(true);
      S.edit = { sid: it.story, fid: it.id, a: idx, f: idx, typing: null };
      S.sel = [it.id]; S.content = null; S.cell = null;
      if (S.tool !== 'type') UI.setTool('type', true);
      this.sync(); UI.refresh(true);
    },
    exit() { if (!S.edit) return; flushTyping(); const fid = S.edit.fid; S.edit = null; S.sel = info(fid) ? [fid] : []; $('#ta').blur(); requestRender(); UI.refresh(true); },
  };

  /* ---------- pointer handling ---------- */
  let spaceDown = false;
  function evPos(e) { const r = ov().getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
  function guideAt(wx, wy) {
    if (!S.opt.guides || S.opt.lockGuides || S.opt.preview) return null;
    const tol = 4 / S.view.z;
    for (const pp of S.placed) for (const g of pp.page.guides) {
      if (g.o === 'v' && Math.abs(wx - pp.x - g.pos) < tol && wy > pp.y - 20 / S.view.z && wy < pp.y + pp.h + 20 / S.view.z) return { g, pp };
      if (g.o === 'h' && Math.abs(wy - pp.y - g.pos) < tol && wx > pp.x - 20 / S.view.z && wx < pp.x + pp.w + 20 / S.view.z) return { g, pp };
    }
    return null;
  }
  function handleAt(sx, sy) {
    const H = handles(); if (!H) return null;
    if (Math.hypot(sx - H.knob[0], sy - H.knob[1]) <= 6) return { k: 'rot', H };
    for (let k = 0; k < 8; k++) if (Math.abs(sx - H.pts[k][0]) <= HS + 2 && Math.abs(sy - H.pts[k][1]) <= HS + 2) return { k, H };
    return null;
  }
  function portAt(sx, sy) {
    if (S.sel.length !== 1 || S.edit) return null;
    const inf = info(S.sel[0]); if (!inf || inf.item.type !== 'text') return null;
    const pp = placedOf(inf.page), { inP, outP } = portRects(pp, inf.item);
    if (Math.abs(sx - outP[0]) <= 6 && Math.abs(sy - outP[1]) <= 6) return { port: 'out', it: inf.item };
    if (Math.abs(sx - inP[0]) <= 6 && Math.abs(sy - inP[1]) <= 6) return { port: 'in', it: inf.item };
    return null;
  }
  function contentHandles() {
    if (!S.content) return null; const inf = info(S.content); if (!inf) return null; const it = inf.item, im = S.images[it.img]; if (!im) return null;
    const pp = placedOf(inf.page), w = im.w * it.cs, h = im.h * it.cs;
    return { it, pp, pts: [[it.cx, it.cy], [it.cx + w, it.cy], [it.cx + w, it.cy + h], [it.cx, it.cy + h]].map(([x, y]) => l2s(pp, it, x, y)), w, h };
  }

  function down(e) {
    if (e.button === 2) return;
    try { ov().setPointerCapture(e.pointerId); } catch (err) { }
    const [sx, sy] = evPos(e), [wx, wy] = View.s2w(sx, sy);
    const start = { sx, sy, wx, wy };
    if (e.button === 1 || spaceDown || S.tool === 'hand') { S.drag = { type: 'pan', start, ox: S.view.ox, oy: S.view.oy }; ov().style.cursor = 'grabbing'; return; }
    if (S.tool === 'zoom') { View.zoomAt(S.view.z * (e.altKey ? 1 / 1.6 : 1.6), sx, sy); return; }
    if (S.cell) UI.closeCellEditor(true);
    // loaded text cursor (threading)
    if (S.loadedThread) {
      const h = hitAt(wx, wy, true);
      if (h && h.item.type === 'text') { if (linkFrames(S.loadedThread.from, h.item.id)) { S.loadedThread = null; S.sel = [h.item.id]; commit('Thread Frames'); } else Aero.toast('That frame is already part of this story'); S.loadedThread = null; requestRender(); return; }
      S.drag = { type: 'create', kind: 'threadframe', start, pp: pageAt(wx, wy, true) }; return;
    }
    // text editing clicks
    if (S.edit && (S.tool === 'type' || S.tool === 'select')) {
      const h = hitAt(wx, wy, true);
      if (h && h.item.type === 'text' && (h.item.story === S.edit.sid || S.tool === 'type')) {
        const [lx, ly] = toLocal(h.item, wx - h.pp.x, wy - h.pp.y);
        if (h.item.story !== S.edit.sid) { T.enter(h.item, T.indexAt(h.item, lx, ly)); }
        const idx = T.indexAt(h.item, lx, ly);
        if (e.detail === 2) { T.selectWord(idx); S.drag = { type: 'textsel', start, word: true }; return; }
        if (e.detail >= 3) { T.selectPara(idx); return; }
        T.setCaret(idx, e.shiftKey); S.edit.fid = h.item.id; S.drag = { type: 'textsel', start };
        e.preventDefault(); return;
      }
      T.exit();
      if (S.tool === 'type') { S.drag = { type: 'create', kind: 'text', start, pp: pageAt(wx, wy, true) }; return; }
    }
    if (S.tool === 'type') {
      const h = hitAt(wx, wy, true);
      if (h && h.item.type === 'text') { const [lx, ly] = toLocal(h.item, wx - h.pp.x, wy - h.pp.y); T.enter(h.item, T.indexAt(h.item, lx, ly)); S.drag = { type: 'textsel', start }; return; }
      S.drag = { type: 'create', kind: 'text', start, pp: pageAt(wx, wy, true) }; return;
    }
    if (['rect', 'ellipse', 'line', 'frame'].includes(S.tool)) { S.drag = { type: 'create', kind: S.tool, start, pp: pageAt(wx, wy, true) }; return; }
    // selection / direct selection
    const ch = contentHandles();
    if (ch) {
      for (let k = 0; k < 4; k++) if (Math.abs(sx - ch.pts[k][0]) <= 6 && Math.abs(sy - ch.pts[k][1]) <= 6) { S.drag = { type: 'cscale', start, k, it: ch.it, pp: ch.pp, o: { cx: ch.it.cx, cy: ch.it.cy, cs: ch.it.cs } }; return; }
      const h = hitAt(wx, wy, true);
      if (h && h.item.id === S.content) { S.drag = { type: 'cpan', start, it: h.item, pp: h.pp, o: { cx: h.item.cx, cy: h.item.cy } }; return; }
      S.content = null;
    }
    const port = portAt(sx, sy);
    if (port) {
      if (port.port === 'out') {
        const s = S.doc.stories[port.it.story];
        if (s.frames.indexOf(port.it.id) < s.frames.length - 1) { unlinkAfter(port.it.id); commit('Unthread Frames'); return; }
        S.loadedThread = { from: port.it.id }; Aero.toast('Click a text frame to continue the story, or drag to create one'); requestRender(); return;
      }
      const s = S.doc.stories[port.it.story], k = s.frames.indexOf(port.it.id);
      if (k > 0) { unlinkAfter(s.frames[k - 1]); commit('Unthread Frames'); }
      return;
    }
    const hd = handleAt(sx, sy);
    if (hd) { startTransform(hd, start, e); return; }
    const gd = guideAt(wx, wy);
    const deep = S.tool === 'direct';
    const h = hitAt(wx, wy, deep);
    if (gd && !e.shiftKey) { S.drag = { type: 'guide', guide: gd.g, pp: gd.pp, start }; return; }
    if (h) {
      const id = h.item.id;
      if (e.detail === 2 && S.tool === 'select') {
        if (h.item.type === 'group') { const c = deepHit(h.item, wx - h.pp.x, wy - h.pp.y, 3 / S.view.z); if (c) { S.sel = [c.id]; UI.setTool('direct'); requestRender(); UI.refresh(true); } return; }
        if (h.item.type === 'text') { const [lx, ly] = toLocal(h.item, wx - h.pp.x, wy - h.pp.y); T.enter(h.item, T.indexAt(h.item, lx, ly)); return; }
        if (h.item.type === 'image' && h.item.img) { S.content = id; S.sel = [id]; requestRender(); UI.refresh(true); return; }
        if (h.item.type === 'table') { const [lx, ly] = toLocal(h.item, wx - h.pp.x, wy - h.pp.y); const rc = cellAt(h.item, lx, ly); if (rc) UI.openCellEditor(h.item, rc[0], rc[1]); return; }
      }
      if (S.tool === 'direct' && h.item.type === 'image' && h.item.img) { S.content = id; S.sel = [id]; S.drag = { type: 'cpan', start, it: h.item, pp: h.pp, o: { cx: h.item.cx, cy: h.item.cy } }; requestRender(); UI.refresh(true); return; }
      if (h.item.type === 'table' && S.sel.includes(id) && e.detail === 1 && UI.cellPanelOpen?.()) { /* keep */ }
      if (e.shiftKey) { S.sel = S.sel.includes(id) ? S.sel.filter(x => x !== id) : [...S.sel, id]; requestRender(); UI.refresh(true); return; }
      if (!S.sel.includes(id)) { S.sel = [id]; UI.refresh(true); }
      if (h.item.type !== 'group' && S.tool === 'select' && S.sel.length === 1) { const pp = h.pp; const pg = pageAt(wx, wy); if (pg && pg !== pp) { /* item on pasteboard of other page */ } }
      startMove(start, e.altKey);
      requestRender(); return;
    }
    if (gd) { S.drag = { type: 'guide', guide: gd.g, pp: gd.pp, start }; return; }
    if (!e.shiftKey) { S.sel = []; S.content = null; UI.refresh(true); }
    const pg = pageAt(wx, wy); if (pg && pg.kind === 'doc' && pg.index !== S.curPage) { S.curPage = pg.index; UI.refresh(); }
    S.drag = { type: 'marquee', start, add: e.shiftKey ? [...S.sel] : [] };
    requestRender();
  }
  function cellAt(it, lx, ly) {
    let y = 0, r = -1; for (let k = 0; k < it.rowH.length; k++) { if (ly >= y && ly < y + it.rowH[k]) { r = k; break; } y += it.rowH[k]; }
    let x = 0, c = -1; for (let k = 0; k < it.colW.length; k++) { if (lx >= x && lx < x + it.colW[k]) { c = k; break; } x += it.colW[k]; }
    return r >= 0 && c >= 0 ? [r, c] : null;
  }
  function startMove(start, dup) {
    if (dup) {
      const byPage = new Map();
      for (const id of S.sel) { const inf = info(id); if (inf.parent) continue; const arr = byPage.get(inf.page) || []; arr.push(inf.item); byPage.set(inf.page, arr); }
      const ns = [];
      for (const [page, items] of byPage) { const cl = cloneItems(items); page.items.push(...cl); ns.push(...cl.map(c => c.id)); }
      S.eng = new Engine(S.doc); S.sel = ns;
    }
    const orig = S.sel.map(id => ({ id, o: structuredClone(info(id).item) }));
    const b = selBox();
    S.drag = { type: 'move', start, orig, box: b, dup, moved: false };
  }
  function startTransform(hd, start, e) {
    const orig = S.sel.map(id => ({ id, o: structuredClone(info(id).item) }));
    if (hd.k === 'rot') {
      const H = hd.H; let c;
      if (H.single) { const it = H.single; c = View.s2w(...l2s(H.pp, it, it.w / 2, it.h / 2)); } else { const b = selBox(); c = [b.x + b.w / 2, b.y + b.h / 2]; }
      S.drag = { type: 'rotate', start, orig, c, a0: Math.atan2(start.wy - c[1], start.wx - c[0]) };
    } else S.drag = { type: 'resize', start, orig, k: hd.k, single: hd.H.single, pp: hd.H.pp, box: hd.H.box };
  }
  function move(e) {
    const [sx, sy] = evPos(e), [wx, wy] = View.s2w(sx, sy);
    S.mouse = { x: sx, y: sy };
    const D = S.drag;
    if (!D) { hover(sx, sy, wx, wy); UI.statusPos(wx, wy); Rulers.draw(); return; }
    const dx = wx - D.start.wx, dy = wy - D.start.wy;
    if (D.type === 'pan') { S.view.ox = D.ox + sx - D.start.sx; S.view.oy = D.oy + sy - D.start.sy; requestRender(true); return; }
    if (D.type === 'textsel') {
      const h = hitAt(wx, wy, true); let it = h && h.item.type === 'text' && h.item.story === S.edit.sid ? h.item : info(S.edit.fid)?.item; if (!it) return;
      const pp = placedOf(info(it.id).page); const [lx, ly] = toLocal(it, wx - pp.x, wy - pp.y);
      let i = T.indexAt(it, lx, ly);
      if (D.word) { const lo = Math.min(S.edit.a, i), hi = Math.max(S.edit.f, i); if (i < S.edit.a) { S.edit.f = T.wordEdge(i + 1, -1); } else S.edit.f = T.wordEdge(i, 1); }
      else S.edit.f = i;
      T.sync(); return;
    }
    if (D.type === 'marquee') { D.cur = { wx, wy }; requestRender(); return; }
    if (D.type === 'create') {
      let x1 = wx, y1 = wy;
      if (D.pp) { const s = snap(D.pp, { x: [x1 - D.pp.x], y: [y1 - D.pp.y] }, new Set()); x1 += s.dx; y1 += s.dy; }
      if (e.shiftKey) { if (D.kind === 'line') { const a = Math.round(Math.atan2(y1 - D.start.wy, x1 - D.start.wx) / (Math.PI / 4)) * Math.PI / 4, L = Math.hypot(x1 - D.start.wx, y1 - D.start.wy); x1 = D.start.wx + Math.cos(a) * L; y1 = D.start.wy + Math.sin(a) * L; } else { const m = Math.max(Math.abs(x1 - D.start.wx), Math.abs(y1 - D.start.wy)); x1 = D.start.wx + Math.sign(x1 - D.start.wx || 1) * m; y1 = D.start.wy + Math.sign(y1 - D.start.wy || 1) * m; } }
      D.cur = { wx: x1, wy: y1 }; requestRender(); return;
    }
    if (D.type === 'guide') { D.cur = { wx, wy, sx, sy }; const g = D.guide; g.pos = g.o === 'v' ? wx - D.pp.x : wy - D.pp.y; requestRender(); return; }
    if (D.type === 'rguide') { D.cur = { wx, wy, sx, sy }; requestRender(); return; }
    if (D.type === 'cpan') {
      const it = D.it, r = -rad(it.rot || 0); const ldx = dx * Math.cos(r) - dy * Math.sin(r), ldy = dx * Math.sin(r) + dy * Math.cos(r);
      it.cx = D.o.cx + ldx; it.cy = D.o.cy + ldy; it.fit = null; requestRender(true); return;
    }
    if (D.type === 'cscale') {
      const it = D.it, im = S.images[it.img], [lx, ly] = toLocal(it, wx - D.pp.x, wy - D.pp.y);
      const w0 = im.w * D.o.cs, h0 = im.h * D.o.cs;
      const ax = D.k === 0 || D.k === 3 ? D.o.cx + w0 : D.o.cx, ay = D.k < 2 ? D.o.cy + h0 : D.o.cy;
      const s = Math.max(0.01, Math.max(Math.abs(lx - ax) / w0, Math.abs(ly - ay) / h0)) * D.o.cs;
      it.cs = s; it.cx = D.k === 0 || D.k === 3 ? ax - im.w * s : ax; it.cy = D.k < 2 ? ay - im.h * s : ay; it.fit = null;
      requestRender(true); UI.refresh(); return;
    }
    if (D.type === 'move') {
      if (!D.moved && Math.hypot(sx - D.start.sx, sy - D.start.sy) < 3) return;
      D.moved = true;
      let mx = dx, my = dy;
      if (e.shiftKey) { if (Math.abs(mx) > Math.abs(my)) my = 0; else mx = 0; }
      const pp = pageAt(D.box.x + mx + D.box.w / 2, D.box.y + my + D.box.h / 2, true);
      if (pp) {
        const bx = D.box.x + mx - pp.x, by = D.box.y + my - pp.y;
        const s = snap(pp, { x: [bx, bx + D.box.w / 2, bx + D.box.w], y: [by, by + D.box.h / 2, by + D.box.h] }, new Set(S.sel));
        mx += s.dx; my += s.dy;
      }
      for (const { id, o } of D.orig) { const it = info(id).item; moveTo(it, o, mx, my); }
      for (const { id } of D.orig) { const p = info(id).parent; if (p) Geo.syncGroup(p); }
      D.info = `X ${M.fmtU(D.box.x + mx - (pp?.x || 0), S.doc.units)}  Y ${M.fmtU(D.box.y + my - (pp?.y || 0), S.doc.units)}`;
      relayout(); return;
    }
    if (D.type === 'resize') { doResize(D, wx, wy, e.shiftKey); relayout(); return; }
    if (D.type === 'rotate') {
      let a = Math.atan2(wy - D.c[1], wx - D.c[0]) - D.a0; let deg = a * 180 / Math.PI;
      if (e.shiftKey) deg = Math.round(deg / 15) * 15;
      for (const { id, o } of D.orig) { const inf = info(id), it = inf.item, pp = placedOf(inf.page); rotateAbout(it, o, deg, D.c[0] - pp.x, D.c[1] - pp.y); if (inf.parent) Geo.syncGroup(inf.parent); }
      D.info = `${Math.round(((D.orig[0].o.rot || 0) + deg) % 360)}°`;
      relayout(); return;
    }
  }
  function relayout() { S.eng = new Engine(S.doc); requestRender(true); UI.refresh(); }
  function moveTo(it, o, dx, dy) { it.x = o.x + dx; it.y = o.y + dy; if (it.type === 'group') it.children.forEach((c, k) => moveTo(c, o.children[k], dx, dy)); }
  function rotateAbout(it, o, deg, cx, cy) {
    const r = rad(deg), c = Math.cos(r), s = Math.sin(r);
    if (it.type === 'group') { it.children.forEach((ch, k) => rotateAbout(ch, o.children[k], deg, cx, cy)); Geo.syncGroup(it); return; }
    const ox = o.x + o.w / 2 - cx, oy = o.y + o.h / 2 - cy;
    const nx = cx + ox * c - oy * s, ny = cy + ox * s + oy * c;
    it.x = nx - o.w / 2; it.y = ny - o.h / 2; it.rot = (((o.rot || 0) + deg) % 360 + 360) % 360; if (Math.abs(it.rot) < 1e-6 || Math.abs(it.rot - 360) < 1e-6) it.rot = 0;
  }
  function scaleItem(it, o, ax, ay, sx, sy) {
    if (it.type === 'group') { it.children.forEach((c, k) => scaleItem(c, o.children[k], ax, ay, sx, sy)); Geo.syncGroup(it); return; }
    it.x = ax + (o.x - ax) * sx; it.y = ay + (o.y - ay) * sy; it.w = Math.max(it.type === 'line' ? 0 : 1, o.w * sx); it.h = Math.max(it.type === 'line' ? 0 : 1, o.h * sy);
    if (it.type === 'image') { const k = Math.sqrt(sx * sy); it.cx = o.cx * sx; it.cy = o.cy * sy; it.cs = o.cs * k; }
    if (it.type === 'table') { it.colW = o.colW.map(w => w * sx); it.rowH = o.rowH.map(h => h * sy); }
  }
  function doResize(D, wx, wy, shift) {
    const [u, v] = UV[D.k];
    if (D.single) {
      const o = D.orig[0].o, it = info(D.orig[0].id).item, pp = D.pp;
      let px = wx - pp.x, py = wy - pp.y;
      if (!o.rot) { const s = snap(pp, { x: u !== .5 ? [px] : null, y: v !== .5 ? [py] : null }, new Set([it.id])); px += s.dx; py += s.dy; }
      let [lx, ly] = toLocal(o, px, py);
      const ax = (1 - u) * o.w, ay = (1 - v) * o.h;
      let x0 = 0, x1 = o.w, y0 = 0, y1 = o.h;
      if (u !== .5) { x0 = Math.min(ax, lx); x1 = Math.max(ax, lx); }
      if (v !== .5) { y0 = Math.min(ay, ly); y1 = Math.max(ay, ly); }
      if (shift && u !== .5 && v !== .5 && o.w && o.h) {
        const k = Math.max((x1 - x0) / o.w, (y1 - y0) / o.h);
        const nw = o.w * k, nh = o.h * k;
        if (lx < ax) { x0 = ax - nw; x1 = ax; } else { x0 = ax; x1 = ax + nw; }
        if (ly < ay) { y0 = ay - nh; y1 = ay; } else { y0 = ay; y1 = ay + nh; }
      }
      const minS = o.type === 'line' ? 0 : 1;
      const w = Math.max(minS, x1 - x0), h = Math.max(minS, y1 - y0);
      const [cx, cy] = toPage(o, (x0 + x1) / 2, (y0 + y1) / 2);
      it.x = cx - w / 2; it.y = cy - h / 2; it.w = w; it.h = h;
      if (o.type === 'line') { const kx = u === .5 ? 1 : (lx - ax) / ((u * o.w - ax) || 1), ky = v === .5 ? 1 : (ly - ay) / ((v * o.h - ay) || 1); it.dir = (kx * ky < 0 ? -1 : 1) * (o.dir || 1); }
      if (o.type === 'image') { if (o.fit) { it.fit = o.fit; applyFit(it, o.fit); } else { it.cx = o.cx - x0; it.cy = o.cy - y0; } }
      if (o.type === 'table') { it.colW = o.colW.map(c => c * w / o.w); it.rowH = o.rowH.map(r => r * h / o.h); }
      if (o.type === 'group') { /* not reached */ }
      D.info = `W ${M.fmtU(w, S.doc.units)}  H ${M.fmtU(h, S.doc.units)}`;
    } else {
      const b = D.box; const ax = b.x + (1 - u) * b.w, ay = b.y + (1 - v) * b.h;
      let sx = u === .5 ? 1 : (wx - ax) / ((u - (1 - u)) * b.w || 1), sy = v === .5 ? 1 : (wy - ay) / ((v - (1 - v)) * b.h || 1);
      sx = Math.max(0.02, sx); sy = Math.max(0.02, sy);
      if (shift) { const k = Math.max(sx, sy); sx = sy = k; }
      for (const { id, o } of D.orig) { const inf = info(id), pp = placedOf(inf.page); scaleItem(inf.item, o, ax - pp.x, ay - pp.y, sx, sy); }
      D.info = `${Math.round(sx * 100)}% × ${Math.round(sy * 100)}%`;
    }
  }
  function applyFit(it, mode) {
    const im = S.images[it.img]; if (!im) return;
    if (mode === 'fit' || mode === 'fill') { const s = mode === 'fit' ? Math.min(it.w / im.w, it.h / im.h) : Math.max(it.w / im.w, it.h / im.h); it.cs = s; }
    if (mode === 'fit' || mode === 'fill' || mode === 'center') { it.cx = (it.w - im.w * it.cs) / 2; it.cy = (it.h - im.h * it.cs) / 2; }
    if (mode === 'frame') { it.w = im.w * it.cs; it.h = im.h * it.cs; it.cx = 0; it.cy = 0; }
    if (mode === 'content') { it.cs = 1; it.cx = 0; it.cy = 0; it.cs = it.w / im.w; it.cy = 0; }
  }
  function up(e) {
    const D = S.drag; S.drag = null;
    try { ov().releasePointerCapture(e.pointerId); } catch (err) { }
    if (!D) return;
    const [sx, sy] = evPos(e), [wx, wy] = View.s2w(sx, sy);
    S.smart = [];
    if (D.type === 'pan') { ov().style.cursor = ''; return; }
    if (D.type === 'textsel') { UI.syncEditor(); return; }
    if (D.type === 'marquee') {
      if (D.cur) {
        const x0 = Math.min(D.start.wx, D.cur.wx), x1 = Math.max(D.start.wx, D.cur.wx), y0 = Math.min(D.start.wy, D.cur.wy), y1 = Math.max(D.start.wy, D.cur.wy);
        const sel = new Set(D.add);
        for (const pp of S.placed) for (const it of pp.page.items) { if (!selectable(it) || !S.eng.layerVisible(it)) continue; const b = Geo.bbox(it); if (b.x + pp.x < x1 && b.x + b.w + pp.x > x0 && b.y + pp.y < y1 && b.y + b.h + pp.y > y0) sel.add(it.id); }
        S.sel = [...sel];
      }
      requestRender(); UI.refresh(true); return;
    }
    if (D.type === 'create') { finishCreate(D, e); return; }
    if (D.type === 'guide') {
      const r = ov().getBoundingClientRect();
      if (e.clientX < r.left || e.clientY < r.top) { D.pp.page.guides = D.pp.page.guides.filter(g => g !== D.guide); commit('Delete Guide'); }
      else commit('Move Guide');
      return;
    }
    if (D.type === 'cpan' || D.type === 'cscale') { commit(D.type === 'cpan' ? 'Move Content' : 'Scale Content'); return; }
    if (D.type === 'move') {
      if (!D.moved) { if (D.dup) commit('Duplicate'); return; }
      // re-home items whose centre moved onto another page
      for (const { id } of D.orig) {
        const inf = info(id); if (!inf || inf.parent) continue;
        const pp = placedOf(inf.page), b = Geo.bbox(inf.item), cx = pp.x + b.x + b.w / 2, cy = pp.y + b.y + b.h / 2;
        const np = pageAt(cx, cy);
        if (np && np !== pp && np.kind === pp.kind) {
          inf.page.items.splice(inf.page.items.indexOf(inf.item), 1);
          moveTo(inf.item, structuredClone(inf.item), pp.x - np.x, pp.y - np.y);
          np.page.items.push(inf.item);
          if (np.kind === 'doc') S.curPage = np.index;
        }
      }
      commit(D.dup ? 'Duplicate' : 'Move'); return;
    }
    if (D.type === 'resize') { commit('Resize'); return; }
    if (D.type === 'rotate') { commit('Rotate'); return; }
  }
  function finishCreate(D, e) {
    let pp = D.pp; if (!pp) return;
    const c = D.cur || D.start;
    let x0 = Math.min(D.start.wx, c.wx) - pp.x, y0 = Math.min(D.start.wy, c.wy) - pp.y, w = Math.abs(c.wx - D.start.wx), h = Math.abs(c.wy - D.start.wy);
    const tiny = w * S.view.z < 4 && h * S.view.z < 4;
    if (D.kind === 'threadframe') {
      if (tiny) {
        const m = S.eng.marginsFor(pp.kind, pp.kind === 'doc' ? pp.index : pp.side), d = S.doc;
        const cw = (pp.w - m.l - m.r - d.gutter * (d.cols - 1)) / d.cols;
        x0 = D.start.wx - pp.x; y0 = D.start.wy - pp.y; w = cw; h = Math.max(36, pp.h - m.b - y0);
      }
      const from = S.loadedThread.from; S.loadedThread = null;
      const it = newTextFrame(pp, x0, y0, w, h);
      S.eng = new Engine(S.doc); linkFrames(from, it.id); S.sel = [it.id]; commit('Thread Frames'); return;
    }
    if (tiny && D.kind !== 'line') {
      if (D.kind === 'text') return;
      // click without drag: ask size
      Aero.dialog({ title: D.kind === 'ellipse' ? 'Ellipse' : 'Rectangle', fields: [{ key: 'w', label: `Width (${S.doc.units})`, type: 'number', value: +M.fmtU(72, S.doc.units) }, { key: 'h', label: `Height (${S.doc.units})`, type: 'number', value: +M.fmtU(72, S.doc.units) }],
        onOK: v => { const it = makeShape(D.kind, x0, y0, M.fromU(v.w, S.doc.units), M.fromU(v.h, S.doc.units)); addItem(pp, it); S.sel = [it.id]; commit('New ' + D.kind); } });
      return;
    }
    if (D.kind === 'line') {
      if (tiny) return;
      const dir = (c.wx - D.start.wx) * (c.wy - D.start.wy) >= 0 ? 1 : -1;
      const it = M.newItem('line', x0, y0, w, h, { dir }); addItem(pp, it); S.sel = [it.id]; commit('New Line'); return;
    }
    if (D.kind === 'text') { const it = newTextFrame(pp, x0, y0, w, h); S.eng = new Engine(S.doc); commit('New Text Frame'); T.enter(it, 0); return; }
    const it = makeShape(D.kind, x0, y0, w, h); addItem(pp, it); S.sel = [it.id]; commit(D.kind === 'frame' ? 'New Image Frame' : 'New ' + D.kind[0].toUpperCase() + D.kind.slice(1));
  }
  function makeShape(kind, x, y, w, h) {
    if (kind === 'frame') return M.newItem('image', x, y, w, h);
    return M.newItem(kind, x, y, w, h, { fill: UI.defaultFill(), stroke: UI.defaultStroke(), sw: UI.defaultStroke() ? 1 : 1 });
  }
  function hover(sx, sy, wx, wy) {
    const c = ov(); let cur = '';
    if (spaceDown || S.tool === 'hand') cur = 'grab';
    else if (S.tool === 'zoom') cur = 'zoom-in';
    else if (S.loadedThread) cur = 'copy';
    else if (S.tool === 'type') { const h = hitAt(wx, wy, true); cur = h && h.item.type === 'text' ? 'text' : 'crosshair'; }
    else if (['rect', 'ellipse', 'line', 'frame'].includes(S.tool)) cur = 'crosshair';
    else {
      const hd = handleAt(sx, sy);
      if (hd) cur = hd.k === 'rot' ? 'alias' : ['nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize', 'ew-resize'][hd.k];
      else if (portAt(sx, sy)) cur = 'pointer';
      else if (S.edit) { const h = hitAt(wx, wy, true); if (h && h.item.story === S.edit.sid) cur = 'text'; }
      else if (S.content) { const h = hitAt(wx, wy, true); if (h && h.item.id === S.content) cur = 'move'; }
      if (!cur) { const g = guideAt(wx, wy); if (g) cur = g.g.o === 'v' ? 'col-resize' : 'row-resize'; }
      if (!cur) { const h = hitAt(wx, wy, S.tool === 'direct'); if (h) cur = 'move'; }
    }
    c.style.cursor = cur;
  }
  function wheel(e) {
    e.preventDefault();
    const [sx, sy] = evPos(e);
    if (e.ctrlKey || e.metaKey) { View.zoomAt(S.view.z * Math.pow(1.0018, -e.deltaY), sx, sy); return; }
    if (e.shiftKey) S.view.ox -= e.deltaY; else { S.view.ox -= e.deltaX; S.view.oy -= e.deltaY; }
    requestRender(true);
    // track current page by view centre
    const [cw, ch] = View.size(), [wx, wy] = View.s2w(cw / 2, ch / 2), p = pageAt(wx, wy, true);
    if (p && p.kind === 'doc' && p.index !== S.curPage) { S.curPage = p.index; UI.refresh(); }
  }
  // ruler drag creates guides
  function rulerDown(e, o) {
    const r = e.currentTarget; try { r.setPointerCapture(e.pointerId); } catch (err) { }
    const mv = ev => { const rc = ov().getBoundingClientRect(); const sx = ev.clientX - rc.left, sy = ev.clientY - rc.top, [wx, wy] = View.s2w(sx, sy); S.drag = { type: 'rguide', o, cur: { wx, wy, sx, sy } }; requestRender(); };
    const upf = ev => {
      r.removeEventListener('pointermove', mv); r.removeEventListener('pointerup', upf);
      const rc = ov().getBoundingClientRect(); const sx = ev.clientX - rc.left, sy = ev.clientY - rc.top, [wx, wy] = View.s2w(sx, sy);
      S.drag = null;
      if (sx < 0 || sy < 0 || sx > rc.width || sy > rc.height) { requestRender(); return; }
      let pp = pageAt(wx, wy, true);
      if (o === 'h') { const row = S.placed.filter(p => p.row === pp.row); pp = row.find(p => wx >= p.x && wx <= p.x + p.w) || pp; }
      let pos = o === 'v' ? wx - pp.x : wy - pp.y;
      if (S.opt.snap) { const L = snapLines(pp, new Set()); const tol = 5 / S.view.z; for (const c of (o === 'v' ? L.xs : L.ys)) if (Math.abs(c.v - pos) < tol && c.kind !== 'guide') { pos = c.v; break; } }
      pp.page.guides.push({ o, pos });
      commit('New Guide');
    };
    r.addEventListener('pointermove', mv); r.addEventListener('pointerup', upf);
  }

  /* ---------- overlay ---------- */
  function drawOverlay(ctx, cw, ch) {
    const z = S.view.z;
    // text selection & caret
    if (S.edit) {
      const s = S.doc.stories[S.edit.sid];
      if (s) {
        const [a, b] = T.range();
        if (a !== b) {
          ctx.fillStyle = 'rgba(60,130,235,.32)';
          for (const { ln, it, pp } of T.lines(S.edit.sid)) {
            const s0 = Math.max(a, ln.a), e0 = Math.min(b, ln.b); if (s0 >= e0 && !(s0 === e0 && false)) continue;
            const x0 = ln.xs[s0 - ln.a], x1 = (ln.xs[e0 - ln.a] ?? ln.xs[ln.xs.length - 1]) + (e0 === ln.b && ln.para && b > ln.b - 1 ? 4 : 0);
            const p = [[x0, ln.y - ln.asc], [x1, ln.y - ln.asc], [x1, ln.y + ln.desc], [x0, ln.y + ln.desc]].map(([x, y]) => l2s(pp, it, x, y));
            ctx.beginPath(); ctx.moveTo(...p[0]); p.slice(1).forEach(q => ctx.lineTo(...q)); ctx.fill();
          }
        } else if (caretOn) {
          const c = T.caret();
          if (c && !c.over) { const p0 = l2s(c.pp, c.it, c.x, c.y0), p1 = l2s(c.pp, c.it, c.x, c.y1); ctx.strokeStyle = '#000'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke(); }
        }
        // edited frame outline
        const inf = info(S.edit.fid); if (inf) { const pp = placedOf(inf.page); ctx.strokeStyle = 'rgba(31,111,214,.6)'; ctx.lineWidth = 1; polyItem(ctx, pp, inf.item); ctx.stroke(); }
      }
    }
    // selection
    const H = handles();
    if (S.sel.length && !S.edit) {
      ctx.lineWidth = 1;
      for (const id of S.sel) { const inf = info(id); if (!inf) continue; const pp = placedOf(inf.page); ctx.strokeStyle = COL.sel; if (inf.item.type === 'group' || S.sel.length > 1) { const b = Geo.bbox(inf.item); const [x, y] = View.w2s(pp.x + b.x, pp.y + b.y); ctx.setLineDash(inf.item.type === 'group' ? [3, 2] : []); ctx.strokeRect(Math.round(x) + .5, Math.round(y) + .5, Math.round(b.w * z), Math.round(b.h * z)); ctx.setLineDash([]); } else { polyItem(ctx, pp, inf.item); ctx.stroke(); } }
      if (H && !S.content) {
        if (!H.single || H.single.type !== 'line' || true) {
          ctx.strokeStyle = COL.sel; ctx.beginPath(); ctx.moveTo(...H.top); ctx.lineTo(...H.knob); ctx.stroke();
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(H.knob[0], H.knob[1], 4.5, 0, 7); ctx.fill(); ctx.stroke();
          for (const p of H.pts) { ctx.fillStyle = '#fff'; ctx.fillRect(Math.round(p[0]) - HS + .5, Math.round(p[1]) - HS + .5, HS * 2, HS * 2); ctx.strokeRect(Math.round(p[0]) - HS + .5, Math.round(p[1]) - HS + .5, HS * 2, HS * 2); }
        }
        if (H.single?.locked) { }
      }
    }
    // image content (direct selection)
    const chd = contentHandles();
    if (chd) {
      ctx.strokeStyle = '#c87a10'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(...chd.pts[0]); chd.pts.slice(1).forEach(p => ctx.lineTo(...p)); ctx.closePath(); ctx.stroke();
      ctx.save(); ctx.globalAlpha = .35; const inf = info(S.content); ctx.restore();
      for (const p of chd.pts) { ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p[0], p[1], 4.5, 0, 7); ctx.fill(); ctx.stroke(); }
      polyItem(ctx, chd.pp, chd.it); ctx.strokeStyle = COL.sel; ctx.stroke();
    }
    // smart guides
    if (S.smart.length) {
      ctx.strokeStyle = COL.smart; ctx.lineWidth = 1;
      for (const g of S.smart) {
        const pp = g.pp; ctx.beginPath();
        if (g.o === 'v') { const [x] = View.w2s(pp.x + g.v, 0); ctx.moveTo(Math.round(x) + .5, View.w2s(0, pp.y)[1]); ctx.lineTo(Math.round(x) + .5, View.w2s(0, pp.y + pp.h)[1]); }
        else { const [, y] = View.w2s(0, pp.y + g.v); ctx.moveTo(View.w2s(pp.x, 0)[0], Math.round(y) + .5); ctx.lineTo(View.w2s(pp.x + pp.w, 0)[0], Math.round(y) + .5); }
        ctx.stroke();
      }
    }
    const D = S.drag;
    if (D && D.type === 'marquee' && D.cur) { const [x0, y0] = View.w2s(D.start.wx, D.start.wy), [x1, y1] = View.w2s(D.cur.wx, D.cur.wy); ctx.fillStyle = 'rgba(80,150,240,.12)'; ctx.strokeStyle = '#3c7fd8'; ctx.setLineDash([3, 2]); ctx.fillRect(x0, y0, x1 - x0, y1 - y0); ctx.strokeRect(x0 + .5, y0 + .5, x1 - x0, y1 - y0); ctx.setLineDash([]); }
    if (D && D.type === 'create' && D.cur) {
      const [x0, y0] = View.w2s(D.start.wx, D.start.wy), [x1, y1] = View.w2s(D.cur.wx, D.cur.wy);
      ctx.strokeStyle = '#1f6fd6'; ctx.lineWidth = 1; ctx.beginPath();
      if (D.kind === 'ellipse') ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, 7);
      else if (D.kind === 'line') { ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); } else ctx.rect(x0 + .5, y0 + .5, x1 - x0, y1 - y0);
      ctx.stroke();
      D.info = `W ${M.fmtU(Math.abs(D.cur.wx - D.start.wx), S.doc.units)}  H ${M.fmtU(Math.abs(D.cur.wy - D.start.wy), S.doc.units)}`;
    }
    if (D && D.type === 'rguide' && D.cur) { ctx.strokeStyle = COL.guide; ctx.beginPath(); if (D.o === 'v') { ctx.moveTo(Math.round(D.cur.sx) + .5, 0); ctx.lineTo(Math.round(D.cur.sx) + .5, ch); } else { ctx.moveTo(0, Math.round(D.cur.sy) + .5); ctx.lineTo(cw, Math.round(D.cur.sy) + .5); } ctx.stroke(); }
    if (D && D.info && ['move', 'resize', 'rotate', 'create'].includes(D.type)) {
      const t = D.info; ctx.font = '11px "Segoe UI",sans-serif'; const w = ctx.measureText(t).width + 12;
      const x = S.mouse.x + 14, y = S.mouse.y + 16;
      ctx.fillStyle = 'rgba(30,57,91,.88)'; ctx.beginPath(); ctx.roundRect(x, y, w, 19, 4); ctx.fill(); ctx.fillStyle = '#fff'; ctx.fillText(t, x + 6, y + 13);
    }
    if (S.loadedThread) { ctx.fillStyle = 'rgba(31,111,214,.9)'; ctx.font = '11px "Segoe UI",sans-serif'; ctx.fillText('⤷ loaded text — click a frame or drag', S.mouse.x + 14, S.mouse.y + 4); }
  }
  let caretOn = true;
  setInterval(() => { if (S.edit && document.activeElement === $('#ta')) { caretOn = !caretOn; requestRender(); } else if (!caretOn) { caretOn = true; } }, 530);

  /* ---------- keyboard for text editing (hidden textarea) ---------- */
  function taKey(e) {
    if (!S.edit) return;
    const ctrl = e.ctrlKey || e.metaKey, sh = e.shiftKey, s = T.story(); if (!s) return;
    const done = () => { e.preventDefault(); e.stopPropagation(); caretOn = true; };
    switch (e.key) {
      case 'ArrowLeft': { const [a, b] = T.range(); if (!sh && a !== b && !ctrl) T.setCaret(a); else T.setCaret(ctrl ? T.wordEdge(S.edit.f, -1) : S.edit.f - 1, sh); return done(); }
      case 'ArrowRight': { const [a, b] = T.range(); if (!sh && a !== b && !ctrl) T.setCaret(b); else T.setCaret(ctrl ? T.wordEdge(S.edit.f, 1) : S.edit.f + 1, sh); return done(); }
      case 'ArrowUp': T.vertical(-1, sh); return done();
      case 'ArrowDown': T.vertical(1, sh); return done();
      case 'Home': if (ctrl) T.setCaret(0, sh); else T.lineEdge(-1, sh); return done();
      case 'End': if (ctrl) T.setCaret(s.text.length, sh); else T.lineEdge(1, sh); return done();
      case 'Backspace': T.del(-1, ctrl); return done();
      case 'Delete': T.del(1, ctrl); return done();
      case 'Enter': T.insert(sh ? '\u2028' : '\n'); return done();
      case 'Tab': T.insert('\t'); return done();
      case 'Escape': T.exit(); UI.setTool('select'); return done();
    }
    if (ctrl && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'a' && !sh) { S.edit.a = 0; S.edit.f = s.text.length; T.sync(); return done(); }
      if (k === 'z' && !sh) { UI.cmd.undo(); return done(); }
      if (k === 'y' || (k === 'z' && sh)) { UI.cmd.redo(); return done(); }
      if (sh && k === 'b') { UI.cmd.toggleChar('bold'); return done(); }
      if (sh && k === 'i') { UI.cmd.toggleChar('italic'); return done(); }
      if (sh && k === 'u') { UI.cmd.toggleChar('under'); return done(); }
      if (sh && (e.key === '>' || e.key === '.')) { UI.cmd.bumpSize(1); return done(); }
      if (sh && (e.key === '<' || e.key === ',')) { UI.cmd.bumpSize(-1); return done(); }
    }
  }
  function taBeforeInput(e) {
    if (!S.edit) return;
    const t = e.inputType;
    if (t === 'insertText' || t === 'insertReplacementText') { e.preventDefault(); if (e.data) T.insert(e.data); }
    else if (t === 'insertLineBreak' || t === 'insertParagraph') { e.preventDefault(); T.insert('\n'); }
    else if (t.startsWith('delete') && t !== 'deleteByCut') { e.preventDefault(); T.del(t.includes('Backward') ? -1 : 1, t.includes('Word')); }
    else if (t === 'insertFromDrop' || t === 'historyUndo' || t === 'historyRedo' || t === 'formatBold' || t === 'formatItalic') e.preventDefault();
  }
  function taCopy(e, cut) {
    if (!S.edit) return; const s = T.story(); const [a, b] = T.range(); if (a === b) { e.preventDefault(); return; }
    e.preventDefault();
    e.clipboardData.setData('text/plain', T.selectedText());
    e.clipboardData.setData('application/x-lumen-layout-text', JSON.stringify(M.sliceRich(s, a, b)));
    if (cut) { M.deleteRange(s, a, b); S.edit.a = S.edit.f = a; commit('Cut'); T.sync(); }
  }
  function taPaste(e) {
    if (!S.edit) return; e.preventDefault();
    const rich = e.clipboardData.getData('application/x-lumen-layout-text');
    if (rich) { try { const f = JSON.parse(rich); if (typeof f.text === 'string' && Array.isArray(f.attrs) && Array.isArray(f.ca)) { T.insertFrag(f); return; } } catch (err) { } }
    const txt = e.clipboardData.getData('text/plain'); if (txt) { T.insert(txt.replace(/\r\n?/g, '\n')); commit('Paste'); }
  }

  function init() {
    const o = ov();
    o.addEventListener('pointerdown', down); o.addEventListener('pointermove', move); o.addEventListener('pointerup', up); o.addEventListener('pointercancel', up);
    o.addEventListener('wheel', wheel, { passive: false });
    o.addEventListener('pointerleave', () => { S.mouse = { x: -1, y: -1 }; Rulers.draw(); });
    o.addEventListener('contextmenu', e => e.preventDefault());
    $('#rh').addEventListener('pointerdown', e => rulerDown(e, 'h'));
    $('#rv').addEventListener('pointerdown', e => rulerDown(e, 'v'));
    const ta = $('#ta');
    ta.addEventListener('keydown', taKey);
    ta.addEventListener('beforeinput', taBeforeInput);
    ta.addEventListener('compositionend', e => { if (e.data) T.insert(e.data); ta.value = ''; });
    ta.addEventListener('copy', e => taCopy(e, false)); ta.addEventListener('cut', e => taCopy(e, true)); ta.addEventListener('paste', taPaste);
    window.addEventListener('keydown', e => { if (e.code === 'Space' && !e.repeat && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)) { spaceDown = true; ov().style.cursor = 'grab'; } });
    window.addEventListener('keyup', e => { if (e.code === 'Space') { spaceDown = false; ov().style.cursor = ''; } });
  }

  return { init, drawOverlay, toLocal, toPage, l2s, hitAt, selBox, T, newTextFrame, addItem, removeItemById, cloneItems, linkFrames, unlinkAfter, applyFit, scaleItem, rotateAbout, moveTo, makeShape, cellAt, worldBox, info };
})();
