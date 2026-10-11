'use strict';
/* Lumen Proto — prototype player (used by Preview inside the app and by the exported standalone HTML),
   plus hit testing shared with the editor. */
(function () {
  const LP = window.LP, M = LP.M;
  const hctx = document.createElement('canvas').getContext('2d');

  /* ---------- hit testing ----------
     returns chain [deepest, …, outermost] of nodes under point (x,y given in the coordinate space that contains `nodes`) */
  LP.hitTest = function (scene, nodes, x, y, o = {}) {
    for (let i = nodes.length - 1; i >= 0; i--) { const r = hitNode(scene, nodes[i], x, y, o); if (r) return r; }
    return null;
  };
  function hitNode(scene, n, x, y, o) {
    const v = scene.view(n);
    if (!scene.isVis(n) || (o.skip && o.skip(n))) return null;
    if (n.mask && !o.masks) return null;
    const m = o.matrix ? o.matrix(n) : LP.localMatrix(n);
    const p = M.ap(M.inv(m), x, y);
    const inBox = p.x >= -(o.tol || 0) && p.y >= -(o.tol || 0) && p.x <= n.w + (o.tol || 0) && p.y <= n.h + (o.tol || 0);
    const kids = scene.kids(n), t = v.mainType || n.type;
    if (t === 'bool') {
      // the boolean result is the hit area; its operands are reachable through it (deep select)
      if (!inBox) return null;
      const path = LP.shapePath(v, n.w, n.h); hctx.lineWidth = Math.max(4, o.tol || 0) * 2 + Math.max(0, ...(v.strokes || []).map(s => s.w || 0));
      if (!hctx.isPointInPath(path, p.x, p.y) && !hctx.isPointInStroke(path, p.x, p.y)) return null;
      for (let i = kids.length - 1; i >= 0; i--) { const r = hitNode(scene, kids[i], p.x, p.y, Object.assign({}, o, { tol: 0 })); if (r) { r.push(n); return r; } }
      return [n];
    }
    if (kids.length) {
      if (!(v.clip && t !== 'group') || inBox) {
        const so = o.scrollOf && o.scrollOf(n), qx = p.x + (so ? so.x : 0), qy = p.y + (so ? so.y : 0);
        for (let i = kids.length - 1; i >= 0; i--) {
          const k = kids[i]; if (k.mask) continue;
          const mk = LP.maskOf(kids, i);
          if (mk && !inMask(scene, mk, qx, qy, o)) continue;
          const r = hitNode(scene, k, qx, qy, o); if (r) { r.push(n); return r; }
        }
        if (o.masks) for (let i = kids.length - 1; i >= 0; i--) if (kids[i].mask) { const r = hitNode(scene, kids[i], qx, qy, o); if (r) { r.push(n); return r; } }
      }
    }
    if (!inBox) return null;
    if (t === 'ellipse' || t === 'path') {
      const path = LP.shapePath(v, n.w, n.h);
      const tol = Math.max(4, o.tol || 0);
      hctx.lineWidth = tol * 2 + Math.max(0, ...(v.strokes || []).map(s => s.w || 0));
      const filled = (v.fills || []).some(f => f.on !== false) || (t === 'path' && v.closed);
      if (!(filled && hctx.isPointInPath(path, p.x, p.y)) && !hctx.isPointInStroke(path, p.x, p.y)) return null;
    }
    if (t === 'group' && o.groupsByKids) return null;
    return [n];
  }

  function inMask(scene, mk, x, y, o) {
    const m = o.matrix ? o.matrix(mk) : LP.localMatrix(mk);
    const p = M.ap(M.inv(m), x, y);
    const mp = LP.maskPath(scene, mk);
    return hctx.isPointInPath(mp, p.x, p.y, mp._rule || 'nonzero');
  }

  /* ---------- helpers ---------- */
  const artboards = doc => doc.children.filter(n => n.type === 'frame' && !n.component);
  LP.artboards = artboards;
  LP.flowStarts = doc => artboards(doc).filter(n => n.flowStart);
  // matching key for smart animate: names from the screen root, with sibling index for duplicates
  function keyMap(scene, root) {
    const map = new Map();
    const walk = (n, prefix) => {
      const seen = {};
      scene.kids(n).forEach(k => {
        const nm = k.name || k.type; seen[nm] = (seen[nm] || 0) + 1;
        const key = prefix + '/' + nm + (seen[nm] > 1 ? '#' + seen[nm] : '');
        map.set(key, k); k._key = key; walk(k, key);
      });
    };
    walk(root, ''); return map;
  }
  function absPos(scene, root, n) { // position of node relative to root
    let x = 0, y = 0, p = n;
    while (p && p !== root) { x += p.x; y += p.y; p = scene.parentOf(p); }
    return { x, y };
  }
  const lerp = (a, b, t) => a + (b - a) * t;

  /* ---------- player ---------- */
  class Player {
    constructor(host, doc, opts = {}) {
      this.host = host; this.opts = opts;
      this.doc = JSON.parse(JSON.stringify(Object.assign({}, doc, { images: {} }))); this.doc.images = doc.images || {};
      this.scene = new LP.Scene(this.doc).update();
      this.canvas = document.createElement('canvas'); this.canvas.className = 'lp-player-canvas';
      this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;outline:none';
      this.canvas.tabIndex = 0;
      host.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.stack = []; this.overlays = []; this.scroll = {}; this.timers = []; this.anim = null; this.hoverState = null; this.pressState = null; this.flash = 0;
      const starts = LP.flowStarts(this.doc);
      const startId = opts.start || starts[0]?.id || artboards(this.doc)[0]?.id;
      this.startId = startId;
      this.bind();
      this.ro = new ResizeObserver(() => this.draw()); this.ro.observe(host);
      LP.onImageLoad = () => this.draw();
      this.show(startId, null, true);
    }
    destroy() { this.timers.forEach(clearTimeout); this.ro.disconnect(); cancelAnimationFrame(this.raf); this.canvas.remove(); removeEventListener('keydown', this.kh); }
    get cur() { return this.scene.get(this.curId); }
    restart() { this.stack = []; this.overlays = []; this.scroll = {}; this.restoreStates(); this.show(this.startId, null, true); }

    /* ----- geometry ----- */
    viewSize(root) { const vh = root.viewportH && root.viewportH < root.h ? root.viewportH : root.h; return { w: root.w, h: vh }; }
    layoutBox() {
      const r = this.host.getBoundingClientRect(), W = r.width, H = r.height;
      const root = this.cur; if (!root) return { W, H, s: 1, x: 0, y: 0, w: 0, h: 0 };
      const vs = this.viewSize(root);
      const pad = this.opts.pad ?? 32;
      const s = Math.min(1, (W - pad * 2) / vs.w, (H - pad * 2) / vs.h);
      const w = vs.w * s, h = vs.h * s;
      return { W, H, s, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w, h, vs };
    }
    maxScroll(root) { const vs = this.viewSize(root); return Math.max(0, root.h - vs.h); }

    /* ----- drawing ----- */
    drawScreen(ctx, scene, root, scrollY, extra = {}) {
      ctx.save();
      const fixedM = n => { const m = LP.localMatrix(n); return n.fixed && scene.parentOf(n) === root ? M.mul(M.tr(0, scrollY), m) : m; };
      const o = Object.assign({ matrix: fixedM, base: ctx.canvas }, extra);
      // root background (not scrolled), then content
      const v = scene.view(root);
      const path = LP.shapePath(v, root.w, this.viewSize(root).h);
      ctx.save(); ctx.clip(path);
      (v.fills || []).forEach(f => LP.fillWith(ctx, f, root.w, this.viewSize(root).h, scene.doc, path));
      ctx.translate(0, -scrollY);
      const kids = scene.kids(root);
      const order = kids.filter(k => !k.fixed).concat(kids.filter(k => k.fixed));
      order.forEach(k => LP.drawNode(ctx, scene, k, o));
      ctx.restore();
      ctx.restore();
    }
    renderScreenCanvas(scene, root, scrollY, s) {
      const vs = this.viewSize(root), dpr = devicePixelRatio || 1;
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(vs.w * s * dpr)); c.height = Math.max(1, Math.round(vs.h * s * dpr));
      const x = c.getContext('2d'); x.scale(s * dpr, s * dpr); this.drawScreen(x, scene, root, scrollY);
      return c;
    }
    draw() {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => this.paint());
    }
    paint() {
      const c = this.canvas, dpr = devicePixelRatio || 1, B = this.layoutBox();
      const cw = Math.round(B.W * dpr), ch = Math.round(B.H * dpr);
      if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
      const ctx = this.ctx; ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = this.opts.bg || '#1b1f26'; ctx.fillRect(0, 0, cw, ch);
      const root = this.cur; if (!root) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // device shadow
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12; ctx.fillStyle = '#000';
      const rr = B.vs.w < 500 ? 38 * B.s : 6 * B.s; ctx.beginPath(); ctx.roundRect(B.x, B.y, B.w, B.h, rr); ctx.fill(); ctx.restore();
      ctx.save(); ctx.beginPath(); ctx.roundRect(B.x, B.y, B.w, B.h, rr); ctx.clip();
      ctx.translate(B.x, B.y); ctx.scale(B.s, B.s);
      if (this.anim) this.anim.frame(ctx, B);
      else {
        this.drawScreen(ctx, this.scene, root, this.scroll[root.id] || 0);
        this.drawOverlays(ctx, B, 1);
      }
      // scroll indicator
      const ms = this.maxScroll(root);
      if (ms > 0 && !this.anim) { const vs = this.viewSize(root), sy = this.scroll[root.id] || 0; const th = vs.h * vs.h / root.h; ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.roundRect(vs.w - 6, sy / ms * (vs.h - th), 3, th, 2); ctx.fill(); }
      // hotspot flash
      if (this.flash > performance.now()) {
        ctx.fillStyle = 'rgba(48,140,255,.22)'; ctx.strokeStyle = 'rgba(48,140,255,.8)'; ctx.lineWidth = 1.5 / B.s;
        this.hotspots().forEach(b => { ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 4); ctx.fill(); ctx.stroke(); });
        this.draw();
      }
      ctx.restore();
    }
    drawOverlays(ctx, B, alpha) {
      const root = this.cur, vs = this.viewSize(root);
      this.overlays.forEach((ov, i) => {
        const n = this.scene.get(ov.id); if (!n) return;
        const a = ov.alpha ?? 1;
        if (ov.dim !== false) { ctx.fillStyle = `rgba(0,0,0,${.4 * a})`; ctx.fillRect(0, 0, vs.w, vs.h); }
        const p = this.overlayPos(ov, n, vs);
        ctx.save(); ctx.globalAlpha = a; ctx.translate(p.x, p.y + (ov.dy || 0));
        ctx.shadowColor = 'rgba(0,0,0,.3)';
        this.drawScreen(ctx, this.scene, n, this.scroll[n.id] || 0);
        ctx.restore();
      });
    }
    overlayPos(ov, n, vs) {
      const ovs = this.viewSize(n);
      const pos = ov.pos || 'center';
      const x = (vs.w - ovs.w) / 2;
      const y = pos === 'top' ? 0 : pos === 'bottom' ? vs.h - ovs.h : (vs.h - ovs.h) / 2;
      return { x, y, w: ovs.w, h: ovs.h };
    }
    hotspots() {
      const root = this.cur, out = [], sy = this.scroll[root.id] || 0;
      const walk = (n, ox, oy) => this.scene.kids(n).forEach(k => {
        const v = this.scene.view(k); if (v.visible === false) return;
        const x = ox + k.x, y = oy + k.y - (k.fixed && n === root ? -sy : 0);
        if ((v.proto || []).some(p => p.trigger === 'tap' || p.trigger === 'hover' || p.trigger === 'press')) out.push({ x, y: y - sy, w: k.w, h: k.h });
        walk(k, x, y);
      });
      walk(root, 0, 0); return out;
    }

    /* ----- input ----- */
    bind() {
      const c = this.canvas;
      const pt = e => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      c.addEventListener('pointermove', e => { if (this.drag) { this.dragMove(e); return; } this.onHover(pt(e)); });
      c.addEventListener('pointerleave', () => this.onHover(null));
      c.addEventListener('pointerdown', e => { c.focus(); this.downAt = pt(e); this.downT = performance.now(); this.onPress(pt(e), true); this.drag = { y: e.clientY, s: null, moved: false }; c.setPointerCapture(e.pointerId); });
      c.addEventListener('pointerup', e => { const d = this.drag; this.drag = null; this.onPress(null, false); if (d && d.moved) return; this.onTap(pt(e)); });
      c.addEventListener('wheel', e => { e.preventDefault(); this.scrollBy(e.deltaY); }, { passive: false });
      this.kh = e => { if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; this.onKey(e); };
      if (this.opts.ownKeys !== false) addEventListener('keydown', this.kh);
    }
    dragMove(e) {
      const d = this.drag; const dy = e.clientY - d.y;
      if (!d.moved && Math.abs(dy) > 6 && this.maxScroll(this.cur) > 0) d.moved = true;
      if (d.moved) { d.y = e.clientY; this.scrollBy(-dy / this.layoutBox().s); }
    }
    scrollBy(dy) {
      if (this.anim) return;
      const top = this.overlays.length ? this.scene.get(this.overlays[this.overlays.length - 1].id) : this.cur;
      if (!top) return;
      const ms = this.maxScroll(top); if (!ms) return;
      this.scroll[top.id] = Math.max(0, Math.min(ms, (this.scroll[top.id] || 0) + dy)); this.draw();
    }
    // map a canvas point to {root, x, y} in that screen's content coordinates
    locate(p) {
      if (!p) return null;
      const B = this.layoutBox(); const root = this.cur; if (!root) return null;
      const lx = (p.x - B.x) / B.s, ly = (p.y - B.y) / B.s;
      const vs = this.viewSize(root);
      for (let i = this.overlays.length - 1; i >= 0; i--) {
        const ov = this.overlays[i], n = this.scene.get(ov.id); if (!n) continue;
        const q = this.overlayPos(ov, n, vs);
        if (lx >= q.x && ly >= q.y && lx <= q.x + q.w && ly <= q.y + q.h) return { root: n, x: lx - q.x, y: ly - q.y + (this.scroll[n.id] || 0), ov };
        return { outside: ov };
      }
      if (lx < 0 || ly < 0 || lx > vs.w || ly > vs.h) return null;
      return { root, x: lx, y: ly + (this.scroll[root.id] || 0) };
    }
    chainAt(p) {
      const L = this.locate(p); if (!L || !L.root) return { L, chain: null };
      const root = L.root, sy = this.scroll[root.id] || 0;
      const chain = LP.hitTest(this.scene, this.scene.kids(root), L.x, L.y, { matrix: n => n.fixed && this.scene.parentOf(n) === root ? M.mul(M.tr(0, sy), LP.localMatrix(n)) : LP.localMatrix(n) });
      return { L, chain: chain ? chain.concat([root]) : [root] };
    }
    findInteraction(chain, trig, key) {
      if (!chain) return null;
      for (const n of chain) { const ps = this.scene.view(n).proto || []; const p = ps.find(q => q.trigger === trig && (trig !== 'key' || keyMatch(q.key, key))); if (p) return { n, p }; }
      return null;
    }
    onHover(pt) {
      if (this.anim && this.anim.nav) return;
      const { chain } = this.chainAt(pt);
      const hit = this.findInteraction(chain, 'hover');
      const tap = this.findInteraction(chain, 'tap') || this.findInteraction(chain, 'press');
      this.canvas.style.cursor = (hit || tap) ? 'pointer' : 'default';
      const cur = this.hoverState;
      if (cur && !(chain && chain.some(n => n.id === cur.id))) { this.hoverState = null; this.endTemp(cur); }
      if (hit && (!cur || hit.n.id !== cur.id) && !this.hoverState) {
        this.hoverState = { id: hit.n.id };
        if (hit.p.action === 'changeTo') this.beginTemp(this.hoverState, hit.n, hit.p);
        else this.run(hit.n, hit.p);
      }
    }
    onPress(pt, down) {
      if (this.anim && this.anim.nav && down) return;
      if (down) {
        const { chain } = this.chainAt(pt);
        const hit = this.findInteraction(chain, 'press');
        if (hit) { this.pressState = { id: hit.n.id }; if (hit.p.action === 'changeTo') this.beginTemp(this.pressState, hit.n, hit.p); else this.run(hit.n, hit.p); }
      } else if (this.pressState) { const s = this.pressState; this.pressState = null; this.endTemp(s); }
    }
    onTap(pt) {
      if (this.anim && this.anim.nav) return;
      const { L, chain } = this.chainAt(pt);
      if (L && L.outside) { this.closeOverlay(L.outside.trans || 'dissolve'); return; }
      const hit = this.findInteraction(chain, 'tap');
      if (hit) { this.run(hit.n, hit.p); return; }
      if (!this.findInteraction(chain, 'press') && !this.findInteraction(chain, 'hover')) { this.flash = performance.now() + 450; this.draw(); }
    }
    onKey(e) {
      if (this.anim) return;
      const root = this.overlays.length ? this.scene.get(this.overlays[this.overlays.length - 1].id) : this.cur;
      if (!root) return;
      let found = null;
      const walk = n => { if (found) return; const ps = this.scene.view(n).proto || []; const p = ps.find(q => q.trigger === 'key' && keyMatch(q.key, e)); if (p) { found = { n, p }; return; } this.scene.kids(n).forEach(walk); };
      walk(root);
      if (found) { e.preventDefault(); this.run(found.n, found.p); return; }
      if (this.opts.keys !== false) {
        if (e.key === 'Escape' && this.overlays.length) this.closeOverlay('dissolve');
        else if (e.key === 'Backspace' && (this.stack.length || this.overlays.length)) this.back({ trans: 'instant' });
        else if (e.key === 'r' || e.key === 'R') this.restart();
      }
    }

    /* ----- states (hover / press / change to) ----- */
    instRef(n) { // where to store a componentId change for instance node n (doc node or clone path)
      const id = String(n.id);
      if (!id.includes('/')) { const d = this.scene.get(id); return { get: () => d.componentId, set: v => { d.componentId = v; } }; }
      const top = this.scene.get(id.split('/')[0]); const rel = id.slice(id.indexOf('/') + 1);
      return { get: () => top.overrides?.[rel]?.componentId, set: v => { top.overrides = top.overrides || {}; if (v === undefined) { if (top.overrides[rel]) delete top.overrides[rel].componentId; } else (top.overrides[rel] = top.overrides[rel] || {}).componentId = v; } };
    }
    beginTemp(state, n, p) {
      if (n.type !== 'instance' || !p.target || !this.scene.get(p.target)) return;
      const ref = this.instRef(n); state.ref = ref; state.prev = ref.get(); state.p = p;
      this.transitionState(() => ref.set(p.target), p);
    }
    endTemp(state) { if (!state.ref) return; const s = state; this.transitionState(() => s.ref.set(s.prev), s.p); }
    restoreStates() { [this.hoverState, this.pressState].forEach(s => s?.ref && s.ref.set(s.prev)); this.hoverState = this.pressState = null; this.scene.update(); }

    /* ----- actions ----- */
    run(n, p) {
      switch (p.action) {
        case 'navigate': if (p.target && this.scene.get(p.target)) this.navigate(p.target, p); break;
        case 'overlay': if (p.target && this.scene.get(p.target)) this.openOverlay(p.target, p); break;
        case 'back': this.back(p); break;
        case 'scrollTo': this.scrollTo(p.target, p); break;
        case 'changeTo': if (n.type === 'instance' && p.target && this.scene.get(p.target)) { const ref = this.instRef(n); this.transitionState(() => ref.set(p.target), p); } break;
        case 'url': break; // not supported offline
      }
    }
    freeze() { // snapshot of current state for transitions
      const doc = Object.assign({}, this.doc, { children: JSON.parse(JSON.stringify(this.doc.children)) });
      const sc = new LP.Scene(doc).update();
      return { scene: sc, root: sc.get(this.curId), scroll: this.scroll[this.curId] || 0, overlays: this.overlays.map(o => Object.assign({}, o)) };
    }
    transitionState(change, p) {
      const trans = p.trans || 'instant';
      const A = trans === 'instant' ? null : this.freeze();
      change(); this.scene.update();
      if (!A) { this.draw(); return; }
      this.animate(A, { scene: this.scene, root: this.cur, scroll: this.scroll[this.curId] || 0 }, trans === 'smart' ? 'smart' : 'dissolve', Object.assign({}, p, { _state: true }));
    }
    show(id, p, initial) {
      this.timers.forEach(clearTimeout); this.timers = [];
      this.curId = id;
      if (initial) this.draw();
      this.armTimers();
    }
    armTimers() {
      const roots = [this.cur, ...this.overlays.map(o => this.scene.get(o.id))].filter(Boolean);
      const walk = n => { (this.scene.view(n).proto || []).forEach(p => { if (p.trigger === 'delay') this.timers.push(setTimeout(() => { if (!this.anim) this.run(n, p); else this.timers.push(setTimeout(() => this.run(n, p), (p.dur || 300) + 50)); }, p.delay ?? 1000)); }); this.scene.kids(n).forEach(walk); };
      roots.forEach(walk);
    }
    navigate(id, p) {
      if (id === this.curId && !this.overlays.length) return;
      const A = this.freeze();
      this.restoreStates();
      this.stack.push({ id: this.curId, overlays: this.overlays, trans: p.trans });
      this.overlays = []; this.scroll[id] = 0;
      this.show(id, p);
      this.animate(A, { scene: this.scene, root: this.cur, scroll: 0 }, p.trans || 'instant', p);
      this.opts.onNavigate?.(id);
    }
    back(p) {
      if (this.overlays.length) { this.closeOverlay(p.trans || 'dissolve'); return; }
      const prev = this.stack.pop(); if (!prev) return;
      const A = this.freeze(); this.restoreStates();
      this.overlays = prev.overlays || [];
      this.show(prev.id, p);
      const rev = { slideLeft: 'slideRight', slideRight: 'slideLeft', slideUp: 'slideDown', slideDown: 'slideUp', pushLeft: 'pushRight', pushRight: 'pushLeft', pushUp: 'pushDown', pushDown: 'pushUp' };
      const t = p.trans && p.trans !== 'instant' ? p.trans : rev[prev.trans] || prev.trans || 'instant';
      this.animate(A, { scene: this.scene, root: this.cur, scroll: this.scroll[this.curId] || 0 }, t, Object.assign({}, p, { dur: p.dur || 300 }));
      this.opts.onNavigate?.(prev.id);
    }
    openOverlay(id, p) {
      const ov = { id, pos: p.overlayPos || 'center', dim: p.dim !== false, trans: p.trans, alpha: 1, dy: 0 };
      this.overlays.push(ov); this.scroll[id] = 0; this.armTimers();
      const tr = p.trans || 'dissolve';
      if (tr === 'instant') { this.draw(); return; }
      const dur = p.dur || 300, ease = LP.EASE[p.ease || 'ease-out'] || LP.EASE['ease-out'], t0 = performance.now(), vs = this.viewSize(this.cur);
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / dur), e = ease(k);
        ov.alpha = tr === 'dissolve' || tr === 'smart' ? e : 1;
        ov.dy = /Up|push/.test(tr) ? (1 - e) * vs.h : /Down/.test(tr) ? -(1 - e) * vs.h : 0;
        this.draw(); if (k < 1) requestAnimationFrame(step); else { ov.alpha = 1; ov.dy = 0; }
      };
      step();
    }
    closeOverlay(tr) {
      const ov = this.overlays[this.overlays.length - 1]; if (!ov) return;
      if (tr === 'instant') { this.overlays.pop(); this.draw(); return; }
      const t0 = performance.now(), dur = 220;
      const step = () => { const k = Math.min(1, (performance.now() - t0) / dur); ov.alpha = 1 - k; this.draw(); if (k < 1) requestAnimationFrame(step); else { this.overlays = this.overlays.filter(o => o !== ov); this.draw(); } };
      step();
    }
    scrollTo(id, p) {
      const root = this.overlays.length ? this.scene.get(this.overlays[this.overlays.length - 1].id) : this.cur;
      const n = this.scene.get(id); if (!n || !root) return;
      const ms = this.maxScroll(root); const target = Math.max(0, Math.min(ms, absPos(this.scene, root, n).y - (p.offset || 0)));
      const from = this.scroll[root.id] || 0, dur = p.trans === 'instant' ? 0 : (p.dur || 400), ease = LP.EASE[p.ease || 'ease-in-out'] || LP.EASE['ease-in-out'], t0 = performance.now();
      const step = () => { const k = dur ? Math.min(1, (performance.now() - t0) / dur) : 1; this.scroll[root.id] = from + (target - from) * ease(k); this.draw(); if (k < 1) requestAnimationFrame(step); };
      step();
    }

    /* ----- transitions ----- */
    animate(A, Bst, trans, p) {
      if (!trans || trans === 'instant') { this.anim = null; this.draw(); return; }
      const dur = Math.max(1, p.dur || 300), ease = LP.EASE[p.ease || 'ease-out'] || LP.EASE['ease-out'];
      const Bx = this.layoutBox();
      const vsA = this.viewSize(A.root), vsB = this.viewSize(Bst.root);
      let imgA = null, imgB = null;
      if (trans !== 'smart') {
        imgA = this.renderScreenCanvas(A.scene, A.root, A.scroll, Bx.s);
        const tmpO = this.overlays; const xa = imgA.getContext('2d');
        if (A.overlays.length) { xa.save(); xa.setTransform(Bx.s * (devicePixelRatio || 1), 0, 0, Bx.s * (devicePixelRatio || 1), 0, 0); const save = this.overlays; this.overlays = A.overlays; const sc = this.scene; this.scene = A.scene; const cid = this.curId; this.curId = A.root.id; this.drawOverlays(xa, Bx, 1); this.curId = cid; this.scene = sc; this.overlays = save; xa.restore(); }
        imgB = this.renderScreenCanvas(Bst.scene, Bst.root, Bst.scroll, Bx.s);
        if (this.overlays.length) { const xb = imgB.getContext('2d'); xb.save(); xb.setTransform(Bx.s * (devicePixelRatio || 1), 0, 0, Bx.s * (devicePixelRatio || 1), 0, 0); this.drawOverlays(xb, Bx, 1); xb.restore(); }
        void tmpO;
      }
      const t0 = performance.now();
      const self = this;
      let smart = null;
      if (trans === 'smart') smart = prepareSmart(A, Bst);
      this.anim = {
        nav: !p._state,
        frame(ctx) {
          const k = Math.min(1, (performance.now() - t0) / dur), e = ease(k);
          const W = vsB.w, H = vsB.h;
          if (trans === 'smart') { smart.draw(ctx, e, self); }
          else {
            const dA = (img, x, y, a = 1) => { ctx.save(); ctx.globalAlpha = a; ctx.drawImage(img, x, y, img.width / (devicePixelRatio || 1) / Bx.s, img.height / (devicePixelRatio || 1) / Bx.s); ctx.restore(); };
            switch (trans) {
              case 'dissolve': dA(imgA, 0, 0); dA(imgB, 0, 0, e); break;
              case 'slideLeft': dA(imgA, 0, 0); dA(imgB, W * (1 - e), 0); break;
              case 'slideRight': dA(imgA, 0, 0); dA(imgB, -W * (1 - e), 0); break;
              case 'slideUp': dA(imgA, 0, 0); dA(imgB, 0, H * (1 - e)); break;
              case 'slideDown': dA(imgA, 0, 0); dA(imgB, 0, -H * (1 - e)); break;
              case 'pushLeft': case 'push': dA(imgA, -W * e, 0); dA(imgB, W * (1 - e), 0); break;
              case 'pushRight': dA(imgA, W * e, 0); dA(imgB, -W * (1 - e), 0); break;
              case 'pushUp': dA(imgA, 0, -H * e); dA(imgB, 0, H * (1 - e)); break;
              case 'pushDown': dA(imgA, 0, H * e); dA(imgB, 0, -H * (1 - e)); break;
              default: dA(imgB, 0, 0);
            }
          }
          if (k < 1) self.draw(); else { self.anim = null; self.draw(); }
        }
      };
      void vsA;
      this.draw();
    }
  }
  function keyMatch(k, e) {
    if (!k) return false; const key = typeof e === 'string' ? e : e.key;
    const norm = s => String(s).toLowerCase().replace(/^space$/, ' ');
    return norm(k) === norm(key);
  }

  // smart animate: interpolate matching layers (by name path) between two states
  function prepareSmart(A, B) {
    const mapA = keyMap(A.scene, A.root), mapB = keyMap(B.scene, B.root);
    const pairs = [];
    mapB.forEach((nb, key) => { const na = mapA.get(key); if (na) pairs.push([na, nb]); });
    const matchedA = new Set(pairs.map(p => p[0])), matchedB = new Set(pairs.map(p => p[1]));
    const props = ['x', 'y', 'w', 'h', 'r', 'opacity'];
    const fillsOf = (sc, n) => sc.view(n).fills;
    return {
      draw(ctx, e, player) {
        // 0. destination background, 1. layers that only exist in A fade out
        player.drawScreenSmart(ctx, B.scene, B.root, 0, null, true, false);
        player.drawScreenSmart(ctx, A.scene, A.root, lerp(A.scroll, B.scroll, e), n => matchedA.has(n) ? 0 : 1 - e, false);
        // 2. B with interpolated geometry; B-only layers fade in
        const saved = pairs.map(([a, b]) => { const s = {}; props.forEach(k => s[k] = b[k]); const vb = B.scene.view(b); const f = vb.fills; s.fills = f; return s; });
        pairs.forEach(([a, b]) => {
          props.forEach(k => { const av = a[k] ?? (k === 'opacity' ? 1 : 0), bv = b[k] ?? (k === 'opacity' ? 1 : 0); b[k] = lerp(av, bv, e); });
          const fa = fillsOf(A.scene, a), fb = fillsOf(B.scene, b);
          if (fa && fb && fa[0]?.type === 'solid' && fb[0]?.type === 'solid' && fa[0].color !== fb[0].color) {
            const ca = LP.fillColor(fa[0], A.scene.doc), cb = LP.fillColor(fb[0], B.scene.doc);
            const vb = B.scene.view(b); vb.fills = [Object.assign({}, fb[0], { style: null, color: LP.toHex(LP.mixColor(ca.color, cb.color, e)), a: lerp(ca.a, cb.a, e) })].concat(fb.slice(1));
          }
        });
        player.drawScreenSmart(ctx, B.scene, B.root, lerp(A.scroll, B.scroll, e), n => matchedB.has(n) ? 1 : e, false);
        pairs.forEach(([a, b], i) => { props.forEach(k => b[k] = saved[i][k]); B.scene.view(b).fills = saved[i].fills; });
      }
    };
  }
  Player.prototype.drawScreenSmart = function (ctx, scene, root, scrollY, alpha, withBg, withKids = true) {
    ctx.save();
    const vs = this.viewSize(root);
    const v = scene.view(root);
    const path = LP.shapePath(v, root.w, vs.h);
    ctx.clip(path);
    if (withBg) (v.fills || []).forEach(f => LP.fillWith(ctx, f, root.w, vs.h, scene.doc, path));
    if (!withKids) { ctx.restore(); return; }
    ctx.translate(0, -scrollY);
    const fixedM = n => { const m = LP.localMatrix(n); return n.fixed && scene.parentOf(n) === root ? M.mul(M.tr(0, scrollY), m) : m; };
    scene.kids(root).forEach(k => LP.drawNode(ctx, scene, k, { matrix: fixedM, alpha, base: ctx.canvas }));
    ctx.restore();
  };
  LP.Player = Player;
})();
