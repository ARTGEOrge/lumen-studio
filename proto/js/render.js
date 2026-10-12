'use strict';
/* Lumen Proto — canvas renderer for scene nodes (editor, preview, exported prototype, PNG/PDF export). */
(function () {
  const LP = window.LP, M = LP.M;

  /* ---------- images ---------- */
  const imgCache = new Map();
  LP.onImageLoad = null;
  LP.getImage = (doc, id) => {
    const src = doc.images?.[id]; if (!src) return null;
    let im = imgCache.get(src);
    if (!im) { im = new Image(); im.onload = () => { im._ok = true; LP.onImageLoad?.(); }; im.src = src; imgCache.set(src, im); }
    return im._ok || (im.complete && im.naturalWidth) ? im : null;
  };
  LP.imagesReady = doc => Promise.all(Object.keys(doc.images || {}).map(id => new Promise(res => { LP.getImage(doc, id); const im = imgCache.get(doc.images[id]); if (!im || im.complete) res(); else { im.addEventListener('load', res); im.addEventListener('error', res); } })));

  /* ---------- geometry ---------- */
  const clampR = (r, w, h) => { const m = Math.max(0, Math.min(w, h) / 2); return (r || [0, 0, 0, 0]).map(x => Math.max(0, Math.min(x || 0, m))); };
  LP.clampR = clampR;
  // shape outline in local coords; grow = outward offset (shadow spread)
  LP.shapePath = function (v, w, h, grow = 0) {
    const p = new Path2D(), t = v.mainType || v.type;
    const x = -grow, y = -grow, W = Math.max(0, w + 2 * grow), H = Math.max(0, h + 2 * grow);
    if (t === 'ellipse') { p.ellipse(w / 2, h / 2, W / 2, H / 2, 0, 0, Math.PI * 2); return p; }
    if (t === 'path') {
      if (v.d) { try { p.addPath(new Path2D(v.d), new DOMMatrix([v.bw ? w / v.bw : 1, 0, 0, v.bh ? h / v.bh : 1, 0, 0])); } catch (e) { } }
      else p.addPath(LP.pathFromPts(v, w, h));
      p._rule = v.rule === 'evenodd' ? 'evenodd' : 'nonzero'; return p;
    }
    if (t === 'bool') { if (v.bd) { try { p.addPath(new Path2D(v.bd)); } catch (e) { } } p._rule = 'nonzero'; return p; }
    if (t === 'icon' || t === 'text' || t === 'group') { p.rect(x, y, W, H); return p; }
    const r = clampR((v.radius || [0, 0, 0, 0]).map(q => q > 0 ? q + grow : 0), W, H);
    if (r.some(q => q > 0)) p.roundRect(x, y, W, H, r); else p.rect(x, y, W, H);
    return p;
  };
  LP.pathFromPts = function (v, w, h) {
    const p = new Path2D();
    const sx = v.bw ? w / v.bw : 1, sy = v.bh ? h / v.bh : 1;
    const P = (x, y) => [x * sx, y * sy];
    LP.contoursOf(v).forEach(c => {
      const pts = c.pts || []; if (!pts.length) return;
      p.moveTo(...P(pts[0].x, pts[0].y));
      const seg = (a, b) => {
        const c1 = a.ox != null ? P(a.ox, a.oy) : P(a.x, a.y), c2 = b.ix != null ? P(b.ix, b.iy) : P(b.x, b.y);
        if (a.ox == null && b.ix == null) p.lineTo(...P(b.x, b.y)); else p.bezierCurveTo(...c1, ...c2, ...P(b.x, b.y));
      };
      for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
      if (c.closed && pts.length > 2) { seg(pts[pts.length - 1], pts[0]); p.closePath(); }
    });
    return p;
  };
  const iconPaths = new Map();
  LP.iconPath = name => { let p = iconPaths.get(name); if (!p) { p = new Path2D((window.LP_ICONS || {})[name] || 'M4 4h16v16H4z'); iconPaths.set(name, p); } return p; };

  /* ---------- paints ---------- */
  LP.gradPoints = (angle, w, h) => {
    const a = (angle ?? 180) * Math.PI / 180, sx = Math.sin(a), sy = -Math.cos(a);
    const len = Math.abs(w * sx) + Math.abs(h * sy);
    return [w / 2 - sx * len / 2, h / 2 - sy * len / 2, w / 2 + sx * len / 2, h / 2 + sy * len / 2];
  };
  function gradient(ctx, f, w, h, doc) {
    let g;
    if (f.type === 'linear') g = ctx.createLinearGradient(...LP.gradPoints(f.angle, w, h));
    else { g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1); }
    (f.stops || []).slice().sort((a, b) => a.p - b.p).forEach(s => g.addColorStop(Math.max(0, Math.min(1, s.p)), LP.rgba(s.color, (s.a ?? 1) * (f.a ?? 1))));
    return g;
  }
  // fill a path / silhouette with paint f
  function fillWith(ctx, f, w, h, doc, path, drawFn) {
    if (f.on === false) return;
    if (f.type === 'solid') { const c = LP.fillColor(f, doc); ctx.fillStyle = LP.rgba(c.color, c.a); drawFn ? drawFn() : ctx.fill(path, path._rule || 'nonzero'); return; }
    if (f.type === 'linear') { ctx.fillStyle = gradient(ctx, f, w, h, doc); drawFn ? drawFn() : ctx.fill(path, path._rule || 'nonzero'); return; }
    if (f.type === 'radial') {
      ctx.save(); const g = gradient(ctx, f, w, h, doc);
      if (drawFn) { const pat = radialAsPattern(ctx, f, w, h, doc); ctx.fillStyle = pat; drawFn(); ctx.restore(); return; }
      ctx.clip(path); ctx.translate(w * (f.cx ?? .5), h * (f.cy ?? .5)); ctx.scale(w / 2 || 1, h / 2 || 1); ctx.fillStyle = g; ctx.fillRect(-4, -4, 8, 8); ctx.restore(); return;
    }
    if (f.type === 'image') {
      const im = LP.getImage(doc, f.img); if (!im) { ctx.fillStyle = '#d6dde6'; drawFn ? drawFn() : ctx.fill(path); return; }
      ctx.save(); if (path) ctx.clip(path); else ctx.beginPath();
      ctx.globalAlpha *= f.a ?? 1;
      const iw = im.naturalWidth, ih = im.naturalHeight; const mode = f.mode || 'fill';
      if (mode === 'tile') { const pat = ctx.createPattern(im, 'repeat'); const s = f.sc || 1; pat.setTransform(new DOMMatrix([s, 0, 0, s, 0, 0])); ctx.fillStyle = pat; ctx.fillRect(0, 0, w, h); }
      else {
        let s = mode === 'fit' ? Math.min(w / iw, h / ih) : Math.max(w / iw, h / ih);
        if (mode === 'crop') s *= f.sc || 1;
        const dw = iw * s, dh = ih * s;
        let dx = (w - dw) / 2, dy = (h - dh) / 2;
        if (mode === 'crop') { dx = (w - dw) * (f.ox ?? .5); dy = (h - dh) * (f.oy ?? .5); }
        ctx.drawImage(im, dx, dy, dw, dh);
      }
      ctx.restore();
    }
  }
  function radialAsPattern(ctx, f, w, h, doc) {
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
    const x = c.getContext('2d'); x.translate(w * (f.cx ?? .5), h * (f.cy ?? .5)); x.scale(w / 2 || 1, h / 2 || 1); x.fillStyle = gradient(x, f, w, h, doc); x.fillRect(-4, -4, 8, 8);
    return ctx.createPattern(c, 'no-repeat');
  }
  LP.fillWith = fillWith;

  /* ---------- effects ---------- */
  const OFF = 100000;
  function dropShadow(ctx, s, sil) {
    if (s.on === false || s.inner) return;
    const t = ctx.getTransform(), sc = Math.hypot(t.a, t.b);
    ctx.save();
    ctx.setTransform(t.a, t.b, t.c, t.d, t.e + OFF, t.f);
    ctx.shadowColor = LP.rgba(s.color || '#000', s.a ?? .25);
    ctx.shadowBlur = (s.blur || 0) * sc; ctx.shadowOffsetX = (s.x || 0) * sc - OFF; ctx.shadowOffsetY = (s.y || 0) * sc;
    ctx.fillStyle = '#000'; ctx.strokeStyle = '#000';
    sil(ctx, s.spread || 0);
    ctx.restore();
  }
  function innerShadow(ctx, s, path, w, h) {
    if (s.on === false || !s.inner) return;
    const t = ctx.getTransform(), sc = Math.hypot(t.a, t.b);
    ctx.save(); ctx.clip(path);
    const ring = new Path2D(); ring.rect(-w * 3 - 1000, -h * 3 - 1000, w * 7 + 2000, h * 7 + 2000);
    const sp = s.spread || 0;
    ring.addPath(sp ? LP.shapePath(path._v, w, h, -sp) : path);
    ctx.setTransform(t.a, t.b, t.c, t.d, t.e + OFF, t.f);
    ctx.shadowColor = LP.rgba(s.color || '#000', s.a ?? .25);
    ctx.shadowBlur = (s.blur || 0) * sc; ctx.shadowOffsetX = (s.x || 0) * sc - OFF; ctx.shadowOffsetY = (s.y || 0) * sc;
    ctx.fillStyle = '#000'; ctx.fill(ring, 'evenodd');
    ctx.restore();
  }
  // device-space bounding box of the local rect (0,0,w,h) grown by `m` device px, clamped to the canvas
  function devBox(ctx, w, h, m) {
    const t = ctx.getTransform(); const xs = [], ys = [];
    [[0, 0], [w, 0], [w, h], [0, h]].forEach(([x, y]) => { xs.push(t.a * x + t.c * y + t.e); ys.push(t.b * x + t.d * y + t.f); });
    const x0 = Math.max(0, Math.floor(Math.min(...xs) - m)), y0 = Math.max(0, Math.floor(Math.min(...ys) - m));
    const x1 = Math.min(ctx.canvas.width, Math.ceil(Math.max(...xs) + m)), y1 = Math.min(ctx.canvas.height, Math.ceil(Math.max(...ys) + m));
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }
  LP.devBox = devBox;
  function backgroundBlur(ctx, v, path, base, w, h) {
    const b = v.blur; if (!b || b.on === false || b.type !== 'bg' || !(b.r > 0) || !base) return;
    const t = ctx.getTransform(), sc = Math.hypot(t.a, t.b), r = b.r * sc;
    const box = devBox(ctx, w, h, 0); if (!box) return;
    const src = { x: Math.max(0, box.x - r * 3 | 0), y: Math.max(0, box.y - r * 3 | 0) };
    src.w = Math.min(base.width, box.x + box.w + r * 3 | 0) - src.x; src.h = Math.min(base.height, box.y + box.h + r * 3 | 0) - src.y;
    if (src.w <= 0 || src.h <= 0) return;
    const tmp = acquire(src.w, src.h); tmp.ctx.setTransform(1, 0, 0, 1, 0, 0); tmp.ctx.clearRect(0, 0, src.w, src.h); tmp.ctx.drawImage(base, src.x, src.y, src.w, src.h, 0, 0, src.w, src.h);
    ctx.save(); ctx.clip(path); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = `blur(${r}px)`; ctx.drawImage(tmp.c, src.x, src.y); ctx.restore();
    release(tmp);
  }
  function strokeShape(ctx, v, path, w, h, doc, open) {
    (v.strokes || []).forEach(s => {
      if (s.on === false || !(s.w > 0)) return;
      const c = LP.fillColor(s, doc);
      ctx.save();
      ctx.strokeStyle = LP.rgba(c.color, c.a);
      ctx.lineJoin = s.join || 'miter'; ctx.lineCap = s.cap || 'butt';
      if (s.dash && s.dash[0]) ctx.setLineDash(s.dash);
      const al = open ? 'center' : s.align || 'inside';
      if (al === 'center') { ctx.lineWidth = s.w; ctx.stroke(path); }
      else if (al === 'inside') { ctx.clip(path); ctx.lineWidth = s.w * 2; ctx.stroke(path); }
      else { const out = new Path2D(); out.rect(-1e5, -1e5, 2e5, 2e5); out.addPath(path); ctx.clip(out, 'evenodd'); ctx.lineWidth = s.w * 2; ctx.stroke(path); }
      ctx.restore();
    });
  }

  /* ---------- layer canvases ---------- */
  const pool = [];
  function acquire(w, h) {
    let L = pool.find(p => !p.used && p.c.width === w && p.c.height === h);
    if (!L) { const c = document.createElement('canvas'); c.width = w; c.height = h; L = { c, ctx: c.getContext('2d'), used: false }; pool.push(L); if (pool.length > 12) { const i = pool.findIndex(p => !p.used && p !== L); if (i >= 0) pool.splice(i, 1); } }
    L.used = true; return L;
  }
  function release(L) { L.used = false; }

  /* ---------- text ---------- */
  // rich (mixed-style) text: lines of styled pieces positioned in the layer box
  function richLines(scene, n, v) {
    const doc = scene.doc, t = LP.textProps(v, doc);
    let r = scene.text.get(n); if (!r || !r.rich) r = LP.layoutFor(t, (v.auto || 'width') === 'width' ? null : n.w, doc, scene.vars);
    const total = r.h;
    let y = v.valign === 'middle' ? (n.h - total) / 2 : v.valign === 'bottom' ? n.h - total : 0;
    const out = r.lines.map((ln, i) => {
      const base = y + (ln.lh - (ln.asc + ln.desc)) / 2 + ln.asc;
      let x = 0;
      const lastLs = ln.pieces.length ? (ln.pieces[ln.pieces.length - 1].st.ls || 0) : 0;
      if (v.align === 'center') x = (n.w - ln.w) / 2; else if (v.align === 'right') x = n.w - ln.w + lastLs;
      const L = { t: ln.t, x, y: base, w: ln.w, top: y, lh: ln.lh, s: ln.s, e: ln.e, last: i === r.lines.length - 1, pieces: ln.pieces };
      y += ln.lh; return L;
    });
    return { lines: out, t, rich: true };
  }
  LP.richLines = richLines;
  function drawRichText(ctx, scene, n, v) {
    const doc = scene.doc, R = richLines(scene, n, v), just = v.align === 'justify';
    const spaceW = (c, p) => c.measureText(' ').width;
    // draw pieces; filter(piece) chooses which pieces to draw; colorOf(piece) overrides fill style
    const put = (c, filter, colorOf) => R.lines.forEach(l => {
      const nsp = just && !l.last ? (l.t.match(/ /g) || []).length : 0;
      const extra = nsp ? (n.w - l.w) / nsp : 0;
      let x = l.x;
      l.pieces.forEach(p => {
        c.font = p.font; try { c.letterSpacing = (p.st.ls || 0) + 'px'; } catch (e) { }
        const draw = filter(p);
        if (draw && colorOf) { const col = colorOf(p); if (col) c.fillStyle = col; }
        const x0 = x;
        if (extra) { const words = p.t.split(' '); words.forEach((wd, i) => { if (draw) c.fillText(wd, x, l.y); x += c.measureText(wd).width; if (i < words.length - 1) x += spaceW(c, p) + extra; }); }
        else { if (draw) c.fillText(p.t, x, l.y); x += p.w; }
        const deco = p.st.deco;
        if (draw && (deco === 'underline' || deco === 'strike')) { const th = Math.max(1, p.st.size / 14), yy = deco === 'underline' ? l.y + p.st.size * .12 : l.y - p.st.size * .3; c.fillRect(x0, yy, x - x0, th); }
      });
    });
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    (v.shadows || []).forEach(s => dropShadow(ctx, s, c => put(c, () => true)));
    // pieces without their own color use the layer fills; colored pieces are painted once in their color
    (v.fills || []).forEach(f => fillWith(ctx, f, n.w, n.h, doc, null, () => put(ctx, p => !p.st.color)));
    ctx.save(); put(ctx, p => !!p.st.color, p => LP.rgba(p.st.color, p.st.a ?? 1)); ctx.restore();
    (v.strokes || []).forEach(s => {
      if (s.on === false || !(s.w > 0)) return; const c = LP.fillColor(s, doc); ctx.save(); ctx.strokeStyle = LP.rgba(c.color, c.a); ctx.lineWidth = s.w; ctx.lineJoin = 'round';
      R.lines.forEach(l => { let x = l.x; l.pieces.forEach(p => { ctx.font = p.font; try { ctx.letterSpacing = (p.st.ls || 0) + 'px'; } catch (e) { } ctx.strokeText(p.t, x, l.y); x += p.w; }); }); ctx.restore();
    });
  }
  function drawTextLines(ctx, scene, n, v, fillStyleFn) {
    const doc = scene.doc;
    const t = LP.textProps(v, doc);
    let r = scene.text.get(n); if (!r) r = LP.layoutFor(t, (v.auto || 'width') === 'width' ? null : n.w, doc, scene.vars);
    if (r.rich) return richLines(scene, n, v);
    const lh = LP.lineHeight(t), { asc, desc } = LP.fontMetrics(t);
    ctx.font = LP.fontString(t); try { ctx.letterSpacing = (t.ls || 0) + 'px'; } catch (e) { }
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    const total = r.lines.length * lh;
    let y0 = v.valign === 'middle' ? (n.h - total) / 2 : v.valign === 'bottom' ? n.h - total : 0;
    const out = [];
    r.lines.forEach((ln, i) => {
      const base = y0 + i * lh + (lh - (asc + desc)) / 2 + asc;
      let x = 0; const lw = ln.w;
      if (v.align === 'center') x = (n.w - lw) / 2; else if (v.align === 'right') x = n.w - lw + (t.ls || 0);
      out.push({ t: ln.t, x, y: base, w: lw, last: i === r.lines.length - 1 });
    });
    return { lines: out, t, lh };
  }
  function drawText(ctx, scene, n, v, o) {
    const doc = scene.doc;
    const L = drawTextLines(ctx, scene, n, v);
    if (L.rich) return drawRichText(ctx, scene, n, v);
    const just = v.align === 'justify';
    const put = (c) => L.lines.forEach(l => {
      if (just && !l.last && l.t.includes(' ')) {
        const words = l.t.split(' '); const ww = words.map(wd => c.measureText(wd).width); const sp = (n.w - ww.reduce((a, b) => a + b, 0)) / (words.length - 1);
        let x = 0; words.forEach((wd, i) => { c.fillText(wd, x, l.y); x += ww[i] + sp; });
      } else c.fillText(l.t, l.x, l.y);
      if (v.deco === 'underline' || v.deco === 'strike') {
        const th = Math.max(1, L.t.size / 14), yy = v.deco === 'underline' ? l.y + L.t.size * .12 : l.y - L.t.size * .3;
        c.fillRect(just && !l.last ? 0 : l.x, yy, just && !l.last ? n.w : l.w, th);
      }
    });
    (v.shadows || []).forEach(s => dropShadow(ctx, s, c => put(c)));
    (v.fills || []).forEach(f => fillWith(ctx, f, n.w, n.h, doc, null, () => put(ctx)));
    (v.strokes || []).forEach(s => { if (s.on === false || !(s.w > 0)) return; const c = LP.fillColor(s, doc); ctx.save(); ctx.strokeStyle = LP.rgba(c.color, c.a); ctx.lineWidth = s.w; ctx.lineJoin = 'round'; L.lines.forEach(l => ctx.strokeText(l.t, l.x, l.y)); ctx.restore(); });
  }
  LP.textLines = (ctx, scene, n) => drawTextLines(ctx, scene, n, scene.view(n));

  /* ---------- nodes ---------- */
  LP.drawNode = function (ctx, scene, n, o = {}) {
    const v = scene.view(n);
    if (scene.isVis ? !scene.isVis(n) : v.visible === false) return;
    if (o.hide && o.hide.has(n.id)) return;
    if (o.stopAt) { if (o.stopAt.done) return; if (n === o.stopAt.node) { o.stopAt.done = true; return; } }
    const op = (v.opacity ?? 1) * (o.alpha ? o.alpha(n) : 1);
    if (op <= 0.001) return;
    ctx.save();
    const m = o.matrix ? o.matrix(n) : LP.localMatrix(n);
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    const kids = scene.kids(n);
    const blend = v.blend && v.blend !== 'normal' ? v.blend : null;
    const lblur = v.blur && v.blur.on !== false && v.blur.type === 'layer' && v.blur.r > 0;
    const t = ctx.getTransform(), sc = Math.hypot(t.a, t.b);
    if ((op < 1 && kids.length) || lblur || (blend && kids.length)) {
      // effects margin: shadows + blur
      let m = lblur ? v.blur.r * sc * 3 : 0;
      (v.shadows || []).forEach(s2 => { if (s2.on !== false && !s2.inner) m = Math.max(m, (Math.abs(s2.x) + Math.abs(s2.y) + s2.blur * 1.5 + Math.abs(s2.spread || 0)) * sc); });
      const box = v.clip || !kids.length ? devBox(ctx, n.w, n.h, m + 2) : { x: 0, y: 0, w: ctx.canvas.width, h: ctx.canvas.height };
      if (box) {
        const L = acquire(ctx.canvas.width, ctx.canvas.height);
        L.ctx.setTransform(1, 0, 0, 1, 0, 0); L.ctx.clearRect(box.x, box.y, box.w, box.h);
        L.ctx.save(); L.ctx.beginPath(); L.ctx.rect(box.x, box.y, box.w, box.h); L.ctx.clip();
        L.ctx.setTransform(t); L.ctx.globalAlpha = 1;
        paint(L.ctx, scene, n, v, Object.assign({}, o, { base: o.base || ctx.canvas }));
        L.ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= op; if (blend) ctx.globalCompositeOperation = blend;
        if (lblur) ctx.filter = `blur(${v.blur.r * sc}px)`;
        ctx.drawImage(L.c, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h);
        release(L);
      }
    } else {
      ctx.globalAlpha *= op; if (blend) ctx.globalCompositeOperation = blend;
      paint(ctx, scene, n, v, o);
    }
    ctx.restore();
  };
  function paint(ctx, scene, n, v, o) {
    const doc = scene.doc, w = n.w, h = n.h, type = v.mainType || n.type;
    if (type === 'text') return drawText(ctx, scene, n, v, o);
    if (type === 'icon') {
      const p = LP.iconPath(v.icon);
      ctx.save(); ctx.scale(w / 24, h / 24);
      const sw = (v.sw || 2);
      (v.shadows || []).forEach(s => dropShadow(ctx, s, c => { c.lineWidth = sw; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke(p); }));
      ctx.strokeStyle = LP.rgba(v.color || '#000', 1); ctx.lineWidth = sw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(p);
      ctx.restore(); return;
    }
    const isGroup = type === 'group';
    const path = LP.shapePath(v, w, h); path._v = v;
    const open = type === 'path' && (v.d ? !v.closed : !LP.contoursOf(v).every(c => c.closed));
    if (!isGroup) {
      (v.shadows || []).forEach(s => dropShadow(ctx, s, (c, sp) => c.fill(sp && type !== 'path' && type !== 'bool' ? LP.shapePath(v, w, h, sp) : path, path._rule || 'nonzero')));
      backgroundBlur(ctx, v, path, o.base || ctx.canvas, w, h);
      (v.fills || []).forEach(f => fillWith(ctx, f, w, h, doc, path));
    }
    const kids = type === 'bool' ? [] : scene.kids(n);
    if (kids.length) {
      ctx.save();
      if (v.clip && !isGroup) ctx.clip(path);
      const so = o.scrollOf && o.scrollOf(n);
      if (so && (so.x || so.y)) ctx.translate(-so.x, -so.y);
      LP.drawKids(ctx, scene, kids, o);
      ctx.restore();
    }
    if (!isGroup) {
      (v.shadows || []).forEach(s => innerShadow(ctx, s, path, w, h));
      strokeShape(ctx, v, path, w, h, doc, open);
    }
  }

  // mask kind: 'alpha' (default: mask layer's alpha incl. opacity, soft edges, text glyphs), 'luminance', or 'vector' (outline clip)
  LP.maskKind = (scene, k) => { const v = scene.view(k), t = v.mainType || k.type, mt = k.maskType || 'alpha'; return mt === 'vector' && t === 'text' ? 'alpha' : mt; };
  // draw a list of sibling nodes; a sibling with .mask masks every sibling above it (until the end of the list)
  LP.drawKids = function (ctx, scene, kids, o = {}) {
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (!k.mask) { LP.drawNode(ctx, scene, k, o); continue; }
      if (!(scene.isVis ? scene.isVis(k) : k.visible !== false)) continue;
      const rest = kids.slice(i + 1), kind = LP.maskKind(scene, k);
      const t = ctx.getTransform();
      const m = o.matrix ? o.matrix(k) : LP.localMatrix(k);
      if (kind === 'vector') {
        ctx.save();
        ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        const mp = LP.maskPath(scene, k); ctx.clip(mp, mp._rule || 'nonzero');
        ctx.setTransform(t);
        LP.drawKids(ctx, scene, rest, o);
        ctx.restore(); return;
      }
      // alpha / luminance: render the masked layers and the mask into offscreen layers, keep content where the mask is opaque
      const v = scene.view(k), sc = Math.hypot(t.a, t.b);
      let marg = v.blur && v.blur.on !== false && v.blur.r > 0 ? v.blur.r * 3 * sc : 0;
      (v.shadows || []).forEach(s => { if (s.on !== false && !s.inner) marg = Math.max(marg, (Math.abs(s.x) + Math.abs(s.y) + s.blur * 1.5 + Math.abs(s.spread || 0)) * sc); });
      ctx.save(); ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]); const box = devBox(ctx, k.w, k.h, marg + 2); ctx.restore();
      if (!box) return;
      const W = ctx.canvas.width, H = ctx.canvas.height;
      const L = acquire(W, H), Mk = acquire(W, H);
      [L, Mk].forEach(X => { X.ctx.setTransform(1, 0, 0, 1, 0, 0); X.ctx.globalAlpha = 1; X.ctx.globalCompositeOperation = 'source-over'; X.ctx.filter = 'none'; X.ctx.clearRect(box.x, box.y, box.w, box.h); X.ctx.save(); X.ctx.beginPath(); X.ctx.rect(box.x, box.y, box.w, box.h); X.ctx.clip(); X.ctx.setTransform(t); });
      LP.drawKids(L.ctx, scene, rest, Object.assign({}, o, { base: o.base || ctx.canvas }));
      LP.drawNode(Mk.ctx, scene, k, Object.assign({}, o, { base: o.base || ctx.canvas }));
      L.ctx.restore(); Mk.ctx.restore();
      if (kind === 'luminance') {
        const id = Mk.ctx.getImageData(box.x, box.y, box.w, box.h), d = id.data;
        for (let j = 0; j < d.length; j += 4) { const a = d[j + 3]; d[j + 3] = a ? Math.round((0.2126 * d[j] + 0.7152 * d[j + 1] + 0.0722 * d[j + 2]) * a / 255) : 0; }
        Mk.ctx.putImageData(id, box.x, box.y);
      }
      L.ctx.save(); L.ctx.setTransform(1, 0, 0, 1, 0, 0); L.ctx.globalCompositeOperation = 'destination-in';
      L.ctx.drawImage(Mk.c, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h); L.ctx.restore();
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(L.c, box.x, box.y, box.w, box.h, box.x, box.y, box.w, box.h); ctx.restore();
      release(L); release(Mk);
      return;
    }
  };
  // alpha (0..1) of a mask layer at point (x,y) given in the mask's parent space — exact for glyphs, gradients, opacity
  const mpx = document.createElement('canvas'); mpx.width = mpx.height = 1; const mpc = mpx.getContext('2d', { willReadFrequently: true });
  LP.maskAlphaAt = (scene, k, x, y, matrix) => {
    const kind = LP.maskKind(scene, k);
    mpc.setTransform(1, 0, 0, 1, 0, 0); mpc.clearRect(0, 0, 1, 1); mpc.globalAlpha = 1;
    mpc.setTransform(1, 0, 0, 1, -x + .5, -y + .5);
    LP.drawNode(mpc, scene, k, matrix ? { matrix } : {});
    const d = mpc.getImageData(0, 0, 1, 1).data;
    return kind === 'luminance' ? (0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]) / 255 * d[3] / 255 : d[3] / 255;
  };
  // clip outline of a mask layer (local coords)
  LP.maskPath = (scene, k) => {
    const v = scene.view(k), t = v.mainType || k.type;
    if (t === 'group') { const p = new Path2D(); scene.kids(k).forEach(c => { const cp = LP.maskPath(scene, c); const m = LP.localMatrix(c); p.addPath(cp, new DOMMatrix(m)); }); return p; }
    return LP.shapePath(v, k.w, k.h);
  };
  LP.maskOf = (kids, i) => { for (let j = i - 1; j >= 0; j--) if (kids[j].mask && kids[j].visible !== false) return kids[j]; return null; };

  // color mode (light / dark) a node renders in: its artboard's mode
  LP.modeOf = (scene, n) => { let t = n; try { t = scene.top(n) || n; } catch (e) { } return LP.nodeMode(scene.doc, t); };
  // render one node (in its own box) to a new canvas at scale
  LP.renderNodeCanvas = function (scene, n, scale = 1, opts = {}) {
    const pad = opts.pad || 0;
    const b = LP.aabb(n);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round((b.w + pad * 2) * scale)); c.height = Math.max(1, Math.round((b.h + pad * 2) * scale));
    const ctx = c.getContext('2d');
    if (opts.bg) { ctx.fillStyle = opts.bg; ctx.fillRect(0, 0, c.width, c.height); }
    scene.doc._mode = opts.mode || LP.modeOf(scene, n);
    ctx.scale(scale, scale); ctx.translate(pad - b.x, pad - b.y);
    LP.drawNode(ctx, scene, n, { base: c, stopAt: opts.stopAt });
    return c;
  };
})();
