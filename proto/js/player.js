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
          let masked = false; for (let j = 0; j < i; j++) if (kids[j].mask && scene.isVis(kids[j]) && !inMask(scene, kids[j], qx, qy, o)) { masked = true; break; }
          if (masked) continue;
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
    if (LP.maskKind(scene, mk) !== 'vector') return LP.maskAlphaAt(scene, mk, x, y, o.matrix) > .02;
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
  // scrollable extent of a frame with overflow scrolling (content beyond its box)
  LP.scrollRange = (scene, n) => {
    let r = 0, b = 0;
    scene.kids(n).forEach(k => { if (!scene.isVis(k)) return; const q = LP.aabb(k); r = Math.max(r, q.x + q.w); b = Math.max(b, q.y + q.h); });
    const s = scene.view(n).scroll;
    return { x: s === 'h' || s === 'both' ? Math.max(0, r - n.w) : 0, y: s === 'v' || s === 'both' ? Math.max(0, b - n.h) : 0 };
  };
  LP.SWIPE_DIRS = ['left', 'right', 'up', 'down'];

  /* ---------- player ---------- */
  class Player {
    constructor(host, doc, opts = {}) {
      this.host = host; this.opts = opts;
      this.doc = JSON.parse(JSON.stringify(Object.assign({}, doc, { images: {}, _varVals: undefined, _mode: undefined }))); this.doc.images = doc.images || {};
      this.vars = this.doc._varVals = LP.varValues(this.doc);
      this.scene = new LP.Scene(this.doc).update();
      this.canvas = document.createElement('canvas'); this.canvas.className = 'lp-player-canvas';
      this.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;touch-action:none;outline:none';
      this.canvas.tabIndex = 0;
      host.appendChild(this.canvas);
      this.ctx = this.canvas.getContext('2d');
      this.stack = []; this.overlays = []; this.scroll = {}; this.scrollX = {}; this.fs = {}; this.timers = []; this.anim = null; this.hoverState = null; this.pressState = null; this.flash = 0;
      const starts = LP.flowStarts(this.doc);
      const startId = opts.start || starts[0]?.id || artboards(this.doc)[0]?.id;
      this.startId = startId;
      this.bind();
      this.ro = new ResizeObserver(() => this.draw()); this.ro.observe(host);
      LP.onImageLoad = () => this.draw();
      this.show(startId, null, true);
    }
    destroy() { this.timers.forEach(clearTimeout); this.ro.disconnect(); cancelAnimationFrame(this.raf); this.canvas.remove(); removeEventListener('keydown', this.kh); this.dead = true; }
    get cur() { return this.scene.get(this.curId); }
    restart() {
      this.stack = []; this.overlays = []; this.scroll = {}; this.scrollX = {}; this.fs = {}; this.restoreStates();
      this.vars = this.doc._varVals = LP.varValues(Object.assign({}, this.doc, { _varVals: null })); this.doc._forceMode = null; this.scene.update();
      this.show(this.startId, null, true);
    }
    // current value of a variable (by id or name) — handy for embedding / tests
    getVar(k) { const d = (this.doc.vars || []).find(x => x.id === k || x.name === k); return d ? this.vars[d.id] : undefined; }
    get mode() { return this.doc._forceMode || LP.nodeMode(this.doc, this.cur); }

    /* ----- geometry ----- */
    viewSize(root) { const vh = root.viewportH && root.viewportH < root.h ? root.viewportH : root.h, vw = root.viewportW && root.viewportW < root.w ? root.viewportW : root.w; return { w: vw, h: vh }; }
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
    maxScrollX(root) { const vs = this.viewSize(root); return Math.max(0, root.w - vs.w); }
    scrollOfFn(fs) { const sc = this.scene; return n => { const v = (n.scroll ? n : null); if (!v) return null; const o = fs[n.id]; return o || null; }; }

    /* ----- drawing ----- */
    drawScreen(ctx, scene, root, scrollY, extra = {}) {
      ctx.save();
      const sx = extra.sx ?? (scene === this.scene ? (this.scrollX[root.id] || 0) : 0);
      const fs = extra.fs || this.fs;
      scene.doc._mode = scene.doc._forceMode || LP.nodeMode(scene.doc, root);
      const fixedM = n => { const m = LP.localMatrix(n); return n.fixed && scene.parentOf(n) === root ? M.mul(M.tr(sx, scrollY), m) : m; };
      const o = Object.assign({ matrix: fixedM, base: ctx.canvas, scrollOf: this.scrollOfFn(fs) }, extra);
      delete o.sx; delete o.fs;
      // root background (not scrolled), then content
      const v = scene.view(root), vs = this.viewSize(root);
      const path = LP.shapePath(v, vs.w, vs.h);
      ctx.save(); ctx.clip(path);
      (v.fills || []).forEach(f => LP.fillWith(ctx, f, vs.w, vs.h, scene.doc, path));
      ctx.translate(-sx, -scrollY);
      const kids = scene.kids(root);
      const order = kids.filter(k => !k.fixed).concat(kids.filter(k => k.fixed));
      LP.drawKids(ctx, scene, order, o);
      ctx.restore();
      ctx.restore();
    }
    renderScreenCanvas(scene, root, scrollY, s, extra) {
      const vs = this.viewSize(root), dpr = devicePixelRatio || 1;
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(vs.w * s * dpr)); c.height = Math.max(1, Math.round(vs.h * s * dpr));
      const x = c.getContext('2d'); x.scale(s * dpr, s * dpr); this.drawScreen(x, scene, root, scrollY, extra);
      return c;
    }
    draw() {
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(() => this.paint());
    }
    paint() {
      if (this.dead) return;
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
      // scroll indicators
      if (!this.anim) {
        const vs = this.viewSize(root);
        const ms = this.maxScroll(root);
        if (ms > 0) { const sy = this.scroll[root.id] || 0; const th = vs.h * vs.h / root.h; ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.roundRect(vs.w - 6, sy / ms * (vs.h - th), 3, th, 2); ctx.fill(); }
        const mx = this.maxScrollX(root);
        if (mx > 0) { const sx = this.scrollX[root.id] || 0; const tw = vs.w * vs.w / root.w; ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.roundRect(sx / mx * (vs.w - tw), vs.h - 6, tw, 3, 2); ctx.fill(); }
      }
      // hotspot flash
      if (this.flash > performance.now()) {
        ctx.fillStyle = 'rgba(48,140,255,.22)'; ctx.strokeStyle = 'rgba(48,140,255,.8)'; ctx.lineWidth = 1.5 / B.s;
        this.hotspots().forEach(b => { ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 4); ctx.fill(); ctx.stroke(); });
        this.draw();
      }
      ctx.restore();
      this.opts.onPaint?.(this, B);
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
      const root = this.cur, out = [], sy = this.scroll[root.id] || 0, sx = this.scrollX[root.id] || 0;
      const HOT = { tap: 1, hover: 1, press: 1, drag: 1, swipe: 1 };
      const walk = (n, ox, oy) => {
        const so = n.scroll ? this.fs[n.id] : null;
        this.scene.kids(n).forEach(k => {
          if (!this.scene.isVis(k)) return;
          const v = this.scene.view(k);
          const fixed = k.fixed && n === root;
          const x = ox + k.x - (so ? so.x : 0) + (fixed ? sx : 0), y = oy + k.y - (so ? so.y : 0) + (fixed ? sy : 0);
          if ((v.proto || []).some(p => HOT[p.trigger])) out.push({ x: x - sx, y: y - sy, w: k.w, h: k.h });
          walk(k, x, y);
        });
      };
      walk(root, 0, 0); return out;
    }

    /* ----- input ----- */
    bind() {
      const c = this.canvas;
      const pt = e => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      c.addEventListener('pointermove', e => { if (this.drag) { this.dragMove(e, pt(e)); return; } this.onHover(pt(e)); });
      c.addEventListener('pointerleave', () => { if (!this.drag) this.onHover(null); });
      c.addEventListener('pointerdown', e => {
        if (e.button !== 0 && e.pointerType === 'mouse') return;
        c.focus(); const p = pt(e); this.downAt = p; this.downT = performance.now();
        this.drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: false, mode: null, chain: this.chainAt(p).chain, pt: p };
        this.onPress(p, true); try { c.setPointerCapture(e.pointerId); } catch (err) { }
      });
      c.addEventListener('pointerup', e => {
        const d = this.drag; this.drag = null; this.onPress(null, false);
        if (d && d.moved) { if (d.mode === 'gesture') this.endGesture(d, e); return; }
        this.onTap(pt(e));
      });
      c.addEventListener('pointercancel', () => { this.drag = null; this.onPress(null, false); });
      c.addEventListener('wheel', e => { e.preventDefault(); const p = pt(e); let dx = e.deltaX, dy = e.deltaY; if (e.shiftKey && !dx) { dx = dy; dy = 0; } this.wheelAt(p, dx, dy); }, { passive: false });
      this.kh = e => { if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return; this.onKey(e); };
      if (this.opts.ownKeys !== false) addEventListener('keydown', this.kh);
    }
    // the screen (current or top overlay) that receives scrolling
    topRoot() { return this.overlays.length ? this.scene.get(this.overlays[this.overlays.length - 1].id) : this.cur; }
    // scrollable frames in a hit chain (deepest first) that can move along (dx, dy)
    scrollTargets(chain, dx, dy) {
      const out = [];
      (chain || []).forEach(n => {
        if (!n.scroll || n === this.cur) return;
        const R = LP.scrollRange(this.scene, n), o = this.fs[n.id] || { x: 0, y: 0 };
        const canX = R.x > 0 && (dx > 0 ? o.x < R.x : dx < 0 ? o.x > 0 : false), canY = R.y > 0 && (dy > 0 ? o.y < R.y : dy < 0 ? o.y > 0 : false);
        if (canX || canY) out.push({ n, R });
      });
      return out;
    }
    scrollFrame(n, dx, dy) {
      const R = LP.scrollRange(this.scene, n), o = this.fs[n.id] || { x: 0, y: 0 };
      const nx = Math.max(0, Math.min(R.x, o.x + dx)), ny = Math.max(0, Math.min(R.y, o.y + dy));
      const moved = nx !== o.x || ny !== o.y;
      this.fs[n.id] = { x: nx, y: ny }; if (moved) this.draw(); return moved;
    }
    wheelAt(p, dx, dy) {
      if (this.anim) return;
      const { chain } = this.chainAt(p);
      const t = this.scrollTargets(chain, dx, dy)[0];
      if (t) { this.scrollFrame(t.n, dx, dy); return; }
      this.scrollBy(dy, dx);
    }
    dragMove(e, p) {
      const d = this.drag; const dx = e.clientX - d.x, dy = e.clientY - d.y;
      const s = this.layoutBox().s;
      if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > 6) {
        d.moved = true;
        const tx = d.x0 - e.clientX, ty = d.y0 - e.clientY;
        if (this.findInteraction(d.chain, 'drag') || this.findInteraction(d.chain, 'swipe', null, true)) {
          d.mode = 'gesture';
          const hit = this.findInteraction(d.chain, 'drag');
          if (hit) { d.fired = true; this.runAll(hit); }
        } else {
          const H = Math.abs(tx) > Math.abs(ty);
          const t = this.scrollTargets(d.chain, H ? tx : 0, H ? 0 : ty)[0] || this.scrollTargets(d.chain, tx, ty)[0];
          if (t) d.mode = { frame: t.n };
          else if (this.maxScroll(this.topRoot()) > 0 || this.maxScrollX(this.topRoot()) > 0) d.mode = 'root';
          else d.mode = 'none';
        }
        if (this.pressState) { const st = this.pressState; this.pressState = null; this.endTemp(st); }
      }
      if (!d.moved) return;
      d.x = e.clientX; d.y = e.clientY;
      if (d.mode === 'root') this.scrollBy(-dy / s, -dx / s);
      else if (d.mode && d.mode.frame) this.scrollFrame(d.mode.frame, -dx / s, -dy / s);
    }
    endGesture(d, e) {
      if (d.fired) return;
      const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
      const dist = Math.hypot(dx, dy); if (dist < 24) return;
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
      const hit = this.findInteraction(d.chain, 'swipe', dir);
      if (hit) this.runAll(hit);
    }
    scrollBy(dy, dx = 0) {
      if (this.anim) return;
      const top = this.topRoot();
      if (!top) return;
      const ms = this.maxScroll(top), mx = this.maxScrollX(top);
      let moved = false;
      if (ms && dy) { const v = Math.max(0, Math.min(ms, (this.scroll[top.id] || 0) + dy)); moved = moved || v !== (this.scroll[top.id] || 0); this.scroll[top.id] = v; }
      if (mx && dx) { const v = Math.max(0, Math.min(mx, (this.scrollX[top.id] || 0) + dx)); moved = moved || v !== (this.scrollX[top.id] || 0); this.scrollX[top.id] = v; }
      if (moved) this.draw();
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
        if (lx >= q.x && ly >= q.y && lx <= q.x + q.w && ly <= q.y + q.h) return { root: n, x: lx - q.x + (this.scrollX[n.id] || 0), y: ly - q.y + (this.scroll[n.id] || 0), ov, vx: lx - q.x, vy: ly - q.y };
        return { outside: ov };
      }
      if (lx < 0 || ly < 0 || lx > vs.w || ly > vs.h) return null;
      return { root, x: lx + (this.scrollX[root.id] || 0), y: ly + (this.scroll[root.id] || 0), vx: lx, vy: ly };
    }
    chainAt(p) {
      const L = this.locate(p); if (!L || !L.root) return { L, chain: null };
      const root = L.root, sy = this.scroll[root.id] || 0, sx = this.scrollX[root.id] || 0;
      const chain = LP.hitTest(this.scene, this.scene.kids(root), L.x, L.y, { matrix: n => n.fixed && this.scene.parentOf(n) === root ? M.mul(M.tr(sx, sy), LP.localMatrix(n)) : LP.localMatrix(n), scrollOf: this.scrollOfFn(this.fs) });
      return { L, chain: chain ? chain.concat([root]) : [root] };
    }
    // all interactions of the deepest layer in the chain that reacts to `trig` (conditions applied)
    findInteraction(chain, trig, key, anyDir) {
      if (!chain) return null;
      for (const n of chain) {
        const ps = (this.scene.view(n).proto || []).filter(q => q.trigger === trig && (trig !== 'key' || keyMatch(q.key, key)) && (trig !== 'swipe' || anyDir || !q.dir || q.dir === 'any' || q.dir === key));
        if (ps.length) { const ok = ps.filter(q => !q.cond || LP.evalCond(q.cond, this.vars, this.doc)); return { n, p: ok[0] || null, ps: ok }; }
      }
      return null;
    }
    runAll(hit) { if (!hit) return; hit.ps.forEach(p => this.run(hit.n, p)); }
    onHover(pt) {
      if (this.anim && this.anim.nav) return;
      const { chain } = this.chainAt(pt);
      const hit = this.findInteraction(chain, 'hover');
      const tap = this.findInteraction(chain, 'tap') || this.findInteraction(chain, 'press') || this.findInteraction(chain, 'drag') || this.findInteraction(chain, 'swipe', null, true);
      this.canvas.style.cursor = (hit || tap) ? 'pointer' : 'default';
      const cur = this.hoverState;
      if (cur && !(chain && chain.some(n => n.id === cur.id))) { this.hoverState = null; this.endTemp(cur); }
      if (hit && hit.ps.length && (!cur || hit.n.id !== cur.id) && !this.hoverState) {
        this.hoverState = { id: hit.n.id };
        this.beginInteractions(this.hoverState, hit);
      }
    }
    beginInteractions(state, hit) {
      let temp = false;
      hit.ps.forEach(p => { if (p.action === 'changeTo' && !temp) { temp = true; this.beginTemp(state, hit.n, p); } else this.run(hit.n, p); });
    }
    onPress(pt, down) {
      if (this.anim && this.anim.nav && down) return;
      if (down) {
        const { chain } = this.chainAt(pt);
        const hit = this.findInteraction(chain, 'press');
        if (hit && hit.ps.length) { this.pressState = { id: hit.n.id }; this.beginInteractions(this.pressState, hit); }
      } else if (this.pressState) { const s = this.pressState; this.pressState = null; this.endTemp(s); }
    }
    onTap(pt) {
      if (this.anim && this.anim.nav) return;
      const { L, chain } = this.chainAt(pt);
      if (L && L.outside) { this.closeOverlay(L.outside.trans || 'dissolve'); return; }
      const hit = this.findInteraction(chain, 'tap');
      if (hit) { this.runAll(hit); return; }
      if (!this.findInteraction(chain, 'press') && !this.findInteraction(chain, 'hover') && !this.findInteraction(chain, 'drag') && !this.findInteraction(chain, 'swipe', null, true)) { this.flash = performance.now() + 450; this.draw(); this.opts.onMiss?.(L); }
    }
    onKey(e) {
      if (this.anim) return;
      const root = this.topRoot();
      if (!root) return;
      let found = null;
      const walk = n => { if (found || !this.scene.isVis(n)) return; const ps = (this.scene.view(n).proto || []).filter(q => q.trigger === 'key' && keyMatch(q.key, e)); if (ps.length) { found = { n, ps: ps.filter(q => !q.cond || LP.evalCond(q.cond, this.vars, this.doc)) }; return; } this.scene.kids(n).forEach(walk); };
      walk(root);
      if (found) { e.preventDefault(); this.runAll(found); return; }
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
      if (!p) return;
      switch (p.action) {
        case 'navigate': if (p.target && this.scene.get(p.target)) this.navigate(p.target, p); break;
        case 'overlay': if (p.target && this.scene.get(p.target)) this.openOverlay(p.target, p); break;
        case 'back': this.back(p); break;
        case 'scrollTo': this.scrollTo(p.target, p); break;
        case 'changeTo': if (n.type === 'instance' && p.target && this.scene.get(p.target)) { const ref = this.instRef(n); this.transitionState(() => ref.set(p.target), p); } break;
        case 'setVar': this.setVar(p); break;
        case 'setMode': this.setMode(p); break;
        case 'url': break; // not supported offline
      }
    }
    setVar(p) {
      const def = (this.doc.vars || []).find(x => x.id === p.v); if (!def) return;
      const cur = this.vars[def.id], val = LP.coerceVar(def.type, p.val);
      let nv;
      switch (p.vop || 'set') {
        case 'toggle': nv = !cur; break;
        case 'add': nv = def.type === 'num' ? cur + (Number(p.val) || 0) : def.type === 'str' ? cur + String(p.val ?? '') : !cur; break;
        case 'sub': nv = def.type === 'num' ? cur - (Number(p.val) || 0) : cur; break;
        default: nv = val;
      }
      nv = LP.coerceVar(def.type, nv);
      if (nv === cur) return;
      this.transitionState(() => { this.vars[def.id] = nv; }, p);
      this.opts.onVar?.(def, nv);
    }
    setMode(p) {
      const curm = this.mode;
      const ms = LP.modesOf(this.doc), ci = ms.findIndex(x => x.id === curm);
      const m = p.mode === 'toggle' || !p.mode ? ms[(ci + 1) % ms.length].id : (ms.some(x => x.id === p.mode) ? p.mode : curm);
      if (m === curm) return;
      this.transitionState(() => { this.doc._forceMode = m; }, Object.assign({}, p, { trans: p.trans === 'smart' ? 'dissolve' : p.trans }));
    }
    freeze() { // snapshot of current state for transitions
      const doc = Object.assign({}, this.doc, { children: JSON.parse(JSON.stringify(this.doc.children)), _varVals: Object.assign({}, this.vars), _forceMode: this.doc._forceMode });
      const sc = new LP.Scene(doc).update();
      return { scene: sc, root: sc.get(this.curId), scroll: this.scroll[this.curId] || 0, sx: this.scrollX[this.curId] || 0, fs: JSON.parse(JSON.stringify(this.fs)), overlays: this.overlays.map(o => Object.assign({}, o)) };
    }
    transitionState(change, p) {
      const trans = p.trans || 'instant';
      const A = trans === 'instant' ? null : this.freeze();
      change(); this.scene.update();
      if (!A) { this.draw(); return; }
      this.animate(A, { scene: this.scene, root: this.cur, scroll: this.scroll[this.curId] || 0, sx: this.scrollX[this.curId] || 0, fs: this.fs }, trans === 'smart' ? 'smart' : 'dissolve', Object.assign({}, p, { _state: true }));
    }
    show(id, p, initial) {
      this.timers.forEach(clearTimeout); this.timers = [];
      this.curId = id;
      if (initial) this.draw();
      this.armTimers();
    }
    armTimers() {
      const roots = [this.cur, ...this.overlays.map(o => this.scene.get(o.id))].filter(Boolean);
      const walk = n => { (this.scene.view(n).proto || []).forEach(p => { if (p.trigger === 'delay') this.timers.push(setTimeout(() => { if (p.cond && !LP.evalCond(p.cond, this.vars, this.doc)) return; if (!this.anim) this.run(n, p); else this.timers.push(setTimeout(() => this.run(n, p), (p.dur || 300) + 50)); }, p.delay ?? 1000)); }); this.scene.kids(n).forEach(walk); };
      roots.forEach(walk);
    }
    navigate(id, p) {
      if (id === this.curId && !this.overlays.length) return;
      const A = this.freeze();
      this.restoreStates();
      this.stack.push({ id: this.curId, overlays: this.overlays, trans: p.trans });
      this.overlays = []; this.scroll[id] = 0; this.scrollX[id] = 0;
      this.show(id, p);
      this.animate(A, { scene: this.scene, root: this.cur, scroll: 0, sx: 0, fs: this.fs }, p.trans || 'instant', p);
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
      this.animate(A, { scene: this.scene, root: this.cur, scroll: this.scroll[this.curId] || 0, sx: this.scrollX[this.curId] || 0, fs: this.fs }, t, Object.assign({}, p, { dur: p.dur || 300 }));
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
      const root = this.topRoot();
      const n = this.scene.get(id); if (!n || !root) return;
      const dur = p.trans === 'instant' ? 0 : (p.dur || 400), ease = LP.EASE[p.ease || 'ease-in-out'] || LP.EASE['ease-in-out'], t0 = performance.now();
      // inside a frame with overflow scrolling: scroll that frame
      let fr = null, q = this.scene.parentOf(n), ox = n.x, oy = n.y;
      while (q && q !== root) { if (q.scroll) { fr = q; break; } ox += q.x; oy += q.y; q = this.scene.parentOf(q); }
      if (fr) {
        const R = LP.scrollRange(this.scene, fr), from = Object.assign({ x: 0, y: 0 }, this.fs[fr.id]);
        const to = { x: Math.max(0, Math.min(R.x, ox - (p.offset || 0))), y: Math.max(0, Math.min(R.y, oy - (p.offset || 0))) };
        const step = () => { const k = dur ? Math.min(1, (performance.now() - t0) / dur) : 1, e = ease(k); this.fs[fr.id] = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }; this.draw(); if (k < 1) requestAnimationFrame(step); };
        step(); return;
      }
      const ap = absPos(this.scene, root, n);
      const ms = this.maxScroll(root), mx = this.maxScrollX(root);
      const target = Math.max(0, Math.min(ms, ap.y - (p.offset || 0))), targetX = Math.max(0, Math.min(mx, ap.x - (p.offsetX || 0)));
      const from = this.scroll[root.id] || 0, fromX = this.scrollX[root.id] || 0;
      const step = () => { const k = dur ? Math.min(1, (performance.now() - t0) / dur) : 1, e = ease(k); this.scroll[root.id] = from + (target - from) * e; if (mx) this.scrollX[root.id] = fromX + (targetX - fromX) * e; this.draw(); if (k < 1) requestAnimationFrame(step); };
      step();
    }

    /* ----- transitions ----- */
    animate(A, Bst, trans, p) {
      if (!trans || trans === 'instant') { this.anim = null; this.draw(); return; }
      const dur = Math.max(1, p.dur || 300), ease = LP.EASE[p.ease || 'ease-out'] || LP.EASE['ease-out'];
      const Bx = this.layoutBox();
      const vsB = this.viewSize(Bst.root);
      let imgA = null, imgB = null;
      if (trans !== 'smart') {
        imgA = this.renderScreenCanvas(A.scene, A.root, A.scroll, Bx.s, { sx: A.sx || 0, fs: A.fs });
        const xa = imgA.getContext('2d');
        if (A.overlays.length) { xa.save(); xa.setTransform(Bx.s * (devicePixelRatio || 1), 0, 0, Bx.s * (devicePixelRatio || 1), 0, 0); const save = this.overlays; this.overlays = A.overlays; const sc = this.scene; this.scene = A.scene; const cid = this.curId; this.curId = A.root.id; this.drawOverlays(xa, Bx, 1); this.curId = cid; this.scene = sc; this.overlays = save; xa.restore(); }
        imgB = this.renderScreenCanvas(Bst.scene, Bst.root, Bst.scroll, Bx.s, { sx: Bst.sx || 0, fs: Bst.fs });
        if (this.overlays.length) { const xb = imgB.getContext('2d'); xb.save(); xb.setTransform(Bx.s * (devicePixelRatio || 1), 0, 0, Bx.s * (devicePixelRatio || 1), 0, 0); this.drawOverlays(xb, Bx, 1); xb.restore(); }
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
    mapB.forEach((nb, key) => { const na = mapA.get(key); if (na && A.scene.isVis(na) && B.scene.isVis(nb)) pairs.push([na, nb]); });
    const matchedA = new Set(pairs.map(p => p[0])), matchedB = new Set(pairs.map(p => p[1]));
    const props = ['x', 'y', 'w', 'h', 'r', 'opacity'];
    const fillsOf = (sc, n) => sc.view(n).fills;
    return {
      draw(ctx, e, player) {
        // 0. destination background, 1. layers that only exist in A fade out
        player.drawScreenSmart(ctx, B.scene, B.root, 0, null, true, false, B);
        player.drawScreenSmart(ctx, A.scene, A.root, lerp(A.scroll, B.scroll, e), n => matchedA.has(n) ? 0 : 1 - e, false, true, A, lerp(A.sx || 0, B.sx || 0, e));
        // 2. B with interpolated geometry; B-only layers fade in
        const saved = pairs.map(([a, b]) => { const s = {}; props.forEach(k => s[k] = b[k]); const vb = B.scene.view(b); const f = vb.fills; s.fills = f; return s; });
        pairs.forEach(([a, b]) => {
          props.forEach(k => { const av = a[k] ?? (k === 'opacity' ? 1 : 0), bv = b[k] ?? (k === 'opacity' ? 1 : 0); b[k] = lerp(av, bv, e); });
          const fa = fillsOf(A.scene, a), fb = fillsOf(B.scene, b);
          if (fa && fb && fa[0]?.type === 'solid' && fb[0]?.type === 'solid') {
            A.scene.doc._mode = A.scene.doc._forceMode || LP.nodeMode(A.scene.doc, A.root);
            const ca = LP.fillColor(fa[0], A.scene.doc);
            B.scene.doc._mode = B.scene.doc._forceMode || LP.nodeMode(B.scene.doc, B.root);
            const cb = LP.fillColor(fb[0], B.scene.doc);
            if (ca.color !== cb.color || ca.a !== cb.a) { const vb = B.scene.view(b); vb.fills = [Object.assign({}, fb[0], { style: null, color: LP.toHex(LP.mixColor(ca.color, cb.color, e)), a: lerp(ca.a, cb.a, e) })].concat(fb.slice(1)); }
          }
        });
        player.drawScreenSmart(ctx, B.scene, B.root, lerp(A.scroll, B.scroll, e), n => matchedB.has(n) ? 1 : e, false, true, B, lerp(A.sx || 0, B.sx || 0, e));
        pairs.forEach(([a, b], i) => { props.forEach(k => b[k] = saved[i][k]); B.scene.view(b).fills = saved[i].fills; });
      }
    };
  }
  Player.prototype.drawScreenSmart = function (ctx, scene, root, scrollY, alpha, withBg, withKids = true, st, scrollX = 0) {
    ctx.save();
    const vs = this.viewSize(root);
    const v = scene.view(root);
    scene.doc._mode = scene.doc._forceMode || LP.nodeMode(scene.doc, root);
    const path = LP.shapePath(v, vs.w, vs.h);
    ctx.clip(path);
    if (withBg) (v.fills || []).forEach(f => LP.fillWith(ctx, f, vs.w, vs.h, scene.doc, path));
    if (!withKids) { ctx.restore(); return; }
    ctx.translate(-scrollX, -scrollY);
    const fixedM = n => { const m = LP.localMatrix(n); return n.fixed && scene.parentOf(n) === root ? M.mul(M.tr(scrollX, scrollY), m) : m; };
    LP.drawKids(ctx, scene, scene.kids(root), { matrix: fixedM, alpha, base: ctx.canvas, scrollOf: this.scrollOfFn((st && st.fs) || this.fs) });
    ctx.restore();
  };
  LP.Player = Player;
})();
