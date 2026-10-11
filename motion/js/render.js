'use strict';
/* Lumen Motion — frame renderer (Canvas 2D). Renders a composition at time t into a canvas, with
   precomps, masks, track mattes, blend modes, effects, adjustment layers and multi-sample motion blur. */
(function () {
  const LM = window.LM, { val, M } = LM;
  const isArr = Array.isArray;
  LM.media = new Map();   // assetId → {img} | {video}

  /* ---------- canvas pool ---------- */
  const pool = [];
  function acquire(w, h) {
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    let i = pool.findIndex(c => c.width === w && c.height === h);
    let c = i >= 0 ? pool.splice(i, 1)[0] : null;
    if (!c) { c = new OffscreenCanvas(w, h); c._ctx = c.getContext('2d'); LM.poolMisses = (LM.poolMisses || 0) + 1; }
    const x = c._ctx; x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; x.filter = 'none'; x.clearRect(0, 0, w, h);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    return c;
  }
  function release(c) { if (!c || pool.includes(c)) return; pool.push(c); if (pool.length > 40) pool.shift(); }
  LM.acquire = acquire; LM.release = release;

  /* ---------- shape geometry (layer space, bezier vertices [x,y,ix,iy,ox,oy]) ---------- */
  const K = 0.5522847498;
  function shapePath(L, t) { return shapeDefPath(L.shape, t); }
  function shapeDefPath(S, t) {
    if (S.kind === 'path') return val(S.path, t);
    if (S.kind === 'rect') {
      const [w, h] = val(S.size, t), x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2, r = Math.max(0, Math.min(val(S.roundness, t), Math.abs(w) / 2, Math.abs(h) / 2));
      if (r <= 0) return { c: true, pts: [[x0, y0, 0, 0, 0, 0], [x1, y0, 0, 0, 0, 0], [x1, y1, 0, 0, 0, 0], [x0, y1, 0, 0, 0, 0]] };
      const k = r * K;
      return { c: true, pts: [[x0 + r, y0, -k, 0, 0, 0], [x1 - r, y0, 0, 0, k, 0], [x1, y0 + r, 0, -k, 0, 0], [x1, y1 - r, 0, 0, 0, k], [x1 - r, y1, k, 0, 0, 0], [x0 + r, y1, 0, 0, -k, 0], [x0, y1 - r, 0, k, 0, 0], [x0, y0 + r, 0, 0, 0, -k]] };
    }
    if (S.kind === 'ellipse') {
      const [w, h] = val(S.size, t), rx = w / 2, ry = h / 2, kx = rx * K, ky = ry * K;
      return { c: true, pts: [[0, -ry, -kx, 0, kx, 0], [rx, 0, 0, -ky, 0, ky], [0, ry, kx, 0, -kx, 0], [-rx, 0, 0, ky, 0, -ky]] };
    }
    // polygon / star
    const n = Math.max(3, Math.round(val(S.points, t))), R = val(S.outer, t), star = S.kind === 'star', Ri = star ? val(S.inner, t) : R, rnd = Math.max(0, Math.min(100, val(S.roundness, t))) / 100;
    const cnt = star ? n * 2 : n, pts = [];
    for (let i = 0; i < cnt; i++) {
      const a = -Math.PI / 2 + i * 2 * Math.PI / cnt, rr = star && i % 2 ? Ri : R;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr, hl = rnd * rr * 4 / 3 * Math.tan(Math.PI / (2 * cnt));
      const tx = -Math.sin(a) * hl, ty = Math.cos(a) * hl;
      pts.push([x, y, -tx, -ty, tx, ty]);
    }
    return { c: true, pts };
  }
  LM.shapePath = shapePath;
  function tracePath(ctx, path) {
    const p = path.pts; if (!p || !p.length) return;
    ctx.moveTo(p[0][0], p[0][1]);
    const seg = (a, b) => { if (!a[4] && !a[5] && !b[2] && !b[3]) ctx.lineTo(b[0], b[1]); else ctx.bezierCurveTo(a[0] + a[4], a[1] + a[5], b[0] + b[2], b[1] + b[3], b[0], b[1]); };
    for (let i = 1; i < p.length; i++) seg(p[i - 1], p[i]);
    if (path.c && p.length > 1) { seg(p[p.length - 1], p[0]); ctx.closePath(); }
  }
  LM.tracePath = tracePath;
  function toPath2D(path) { const p = new Path2D(); tracePath(p, path); return p; }
  LM.toPath2D = toPath2D;
  function flatten(path, steps = 20) {
    const p = path.pts, out = []; if (!p || !p.length) return out;
    out.push([p[0][0], p[0][1]]);
    const seg = (a, b) => {
      if (!a[4] && !a[5] && !b[2] && !b[3]) { out.push([b[0], b[1]]); return; }
      const c1x = a[0] + a[4], c1y = a[1] + a[5], c2x = b[0] + b[2], c2y = b[1] + b[3];
      for (let i = 1; i <= steps; i++) { const u = i / steps, m = 1 - u; out.push([m * m * m * a[0] + 3 * m * m * u * c1x + 3 * m * u * u * c2x + u * u * u * b[0], m * m * m * a[1] + 3 * m * m * u * c1y + 3 * m * u * u * c2y + u * u * u * b[1]]); }
    };
    for (let i = 1; i < p.length; i++) seg(p[i - 1], p[i]);
    if (path.c && p.length > 1) seg(p[p.length - 1], p[0]);
    return out;
  }
  LM.flatten = flatten;
  // trimmed polyline(s) for trim paths
  function trimmed(path, s, e, off) {
    const pl = flatten(path, 24), len = [0];
    for (let i = 1; i < pl.length; i++) len.push(len[i - 1] + Math.hypot(pl[i][0] - pl[i - 1][0], pl[i][1] - pl[i - 1][1]));
    const total = len[len.length - 1]; if (!total) return [];
    if (s > e) [s, e] = [e, s];
    if (e - s >= 1 - 1e-9) return [pl];
    if (e - s <= 1e-9) return [];
    let a = s + off, b = e + off; const sh = Math.floor(a); a -= sh; b -= sh;
    const pieces = b > 1 ? [[a, 1], [0, b - 1]] : [[a, b]];
    const sub = (fa, fb) => {
      const la = fa * total, lb = fb * total, out = [];
      const at = l => { let i = 1; while (i < len.length - 1 && len[i] < l) i++; const f = (l - len[i - 1]) / ((len[i] - len[i - 1]) || 1); return [[pl[i - 1][0] + (pl[i][0] - pl[i - 1][0]) * f, pl[i - 1][1] + (pl[i][1] - pl[i - 1][1]) * f], i]; };
      const [p0, i0] = at(la), [p1, i1] = at(lb);
      out.push(p0); for (let i = i0; i < i1; i++) out.push(pl[i]); out.push(p1);
      return out;
    };
    return pieces.map(([x, y]) => sub(x, y));
  }
  function drawShape(ctx, L, t) {
    const S = L.shape, path = shapePath(L, t);
    const ts = val(S.trim.start, t) / 100, te = val(S.trim.end, t) / 100, to = val(S.trim.offset, t) / 360;
    const full = Math.abs(te - ts) >= 1 - 1e-9 || (ts <= 0 && te >= 1);
    const p2 = toPath2D(path);
    if (S.fill.on) {
      ctx.save(); ctx.globalAlpha *= val(S.fill.opacity, t) / 100; ctx.fillStyle = val(S.fill.color, t);
      if (full) ctx.fill(p2); else { const pcs = trimmed(path, ts, te, to); const fp = new Path2D(); pcs.forEach(pc => { fp.moveTo(pc[0][0], pc[0][1]); pc.forEach(q => fp.lineTo(q[0], q[1])); }); ctx.fill(fp); }
      ctx.restore();
    }
    if (S.stroke.on) {
      const w = val(S.stroke.width, t); if (w <= 0) return;
      ctx.save(); ctx.globalAlpha *= val(S.stroke.opacity, t) / 100; ctx.strokeStyle = val(S.stroke.color, t); ctx.lineWidth = w; ctx.lineCap = S.stroke.cap || 'round'; ctx.lineJoin = S.stroke.join || 'round';
      if (full) ctx.stroke(p2);
      else { const pcs = trimmed(path, ts, te, to); const sp = new Path2D(); pcs.forEach(pc => { sp.moveTo(pc[0][0], pc[0][1]); for (let i = 1; i < pc.length; i++) sp.lineTo(pc[i][0], pc[i][1]); }); ctx.stroke(sp); }
      ctx.restore();
    }
  }

  /* ---------- text ---------- */
  const mctx = new OffscreenCanvas(4, 4).getContext('2d');
  function fontOf(T, size) { return `${T.italic ? 'italic ' : ''}${T.weight || 400} ${size}px "${T.font}", "Segoe UI", sans-serif`; }
  function textLayout(L, t) {
    const T = L.text, size = Math.max(1, val(T.size, t)), track = val(T.tracking, t) * size / 1000, lead = val(T.leading, t) * size;
    mctx.font = fontOf(T, size); mctx.letterSpacing = '0px';
    const lines = String(T.str).split('\n'), chars = []; let maxW = 0;
    const asc = size * .78, desc = size * .24;
    lines.forEach((ln, j) => {
      const cs = [...ln], xs = []; let acc = '';
      cs.forEach((c, i) => { xs.push(mctx.measureText(acc).width + i * track); acc += c; });
      const w = mctx.measureText(ln).width + Math.max(0, cs.length - 1) * track; maxW = Math.max(maxW, w);
      const x0 = T.align === 'left' ? 0 : T.align === 'right' ? -w : -w / 2;
      cs.forEach((c, i) => chars.push({ c, x: x0 + xs[i], w: mctx.measureText(c).width, y: j * lead, line: j }));
    });
    const x0 = T.align === 'left' ? 0 : T.align === 'right' ? -maxW : -maxW / 2;
    return { size, track, lead, lines, chars, bounds: [x0, -asc, x0 + maxW, (lines.length - 1) * lead + desc] };
  }
  LM.textLayout = textLayout;
  function selAmount(A, i, n, t) {
    const sel = A.sel; let s = val(sel.start, t) / 100, e = val(sel.end, t) / 100; const o = val(sel.offset, t) / 100;
    s += o; e += o; if (s > e) [s, e] = [e, s];
    const a = i / n, b = (i + 1) / n, c = (i + .5) / n;
    const shape = sel.shape || 'square';
    if (shape === 'square') { if (!sel.smooth) return c >= s && c < e ? 1 : 0; return Math.max(0, Math.min(b, e) - Math.max(a, s)) * n; }
    const span = e - s || 1e-9, x = (c - s) / span;
    if (shape === 'rampUp') return c <= s ? 0 : c >= e ? 1 : x;
    if (shape === 'rampDown') return c <= s ? 1 : c >= e ? 0 : 1 - x;
    if (c < s || c > e) return 0;
    const u = 2 * x - 1;
    if (shape === 'triangle') return 1 - Math.abs(u);
    if (shape === 'round') return Math.sqrt(Math.max(0, 1 - u * u));
    return (1 + Math.cos(Math.PI * u)) / 2; // smooth
  }
  function drawText(ctx, L, t) {
    const T = L.text, lay = textLayout(L, t), fill = val(T.fill, t), anims = T.animators;
    const strokeW = T.strokeOn ? val(T.strokeWidth, t) : 0, strokeC = T.strokeOn ? val(T.stroke, t) : null;
    ctx.font = fontOf(T, lay.size); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    if (!anims.length) {
      ctx.letterSpacing = lay.track + 'px'; ctx.fillStyle = fill;
      lay.lines.forEach((ln, j) => {
        const first = lay.chars.find(c => c.line === j); if (!first) return;
        if (strokeW > 0) { ctx.strokeStyle = strokeC; ctx.lineWidth = strokeW; ctx.strokeText(ln, first.x, first.y); }
        ctx.fillText(ln, first.x, first.y);
      });
      ctx.letterSpacing = '0px';
      return;
    }
    ctx.letterSpacing = '0px';
    const n = lay.chars.length, vals = anims.map(A => ({ A, op: val(A.opacity, t), pos: val(A.position, t), sc: val(A.scale, t), rot: val(A.rotation, t), fill: A.fillOn ? val(A.fill, t) : null, blur: val(A.blur, t) }));
    const baseA = ctx.globalAlpha;
    lay.chars.forEach((ch, i) => {
      if (ch.c === ' ') return;
      let op = 1, px = 0, py = 0, sc = 1, rot = 0, col = fill, blur = 0;
      vals.forEach(v => {
        const amt = selAmount(v.A, i, n, t); if (amt <= 0) return;
        op *= 1 + (v.op / 100 - 1) * amt; px += v.pos[0] * amt; py += v.pos[1] * amt; sc *= 1 + (v.sc / 100 - 1) * amt; rot += v.rot * amt;
        if (v.fill) col = LM.lerp(col, v.fill, amt); blur += v.blur * amt;
      });
      if (op <= 0.002) return;
      ctx.save(); ctx.globalAlpha = baseA * Math.min(1, op);
      ctx.translate(ch.x + ch.w / 2 + px, ch.y + py); if (rot) ctx.rotate(rot * Math.PI / 180);
      if (blur > .3) { const m = ctx.getTransform(); ctx.filter = `blur(${blur * Math.sqrt(Math.abs(m.a * m.d - m.b * m.c))}px)`; }
      if (sc !== 1) ctx.scale(sc, sc);
      if (strokeW > 0) { ctx.strokeStyle = strokeC; ctx.lineWidth = strokeW; ctx.strokeText(ch.c, -ch.w / 2, 0); }
      ctx.fillStyle = col; ctx.fillText(ch.c, -ch.w / 2, 0);
      ctx.restore();
    });
  }

  /* ---------- drawing (cel) layers ---------- */
  function drawStrokes(ctx, strokes) {
    if (!isArr(strokes)) return;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    strokes.forEach(s => {
      const p = s.pts; if (!p || p.length < 3) return;
      ctx.save(); ctx.globalCompositeOperation = s.e ? 'destination-out' : 'source-over'; ctx.strokeStyle = s.c || '#000'; ctx.fillStyle = s.c || '#000';
      if (p.length === 3) { ctx.beginPath(); ctx.arc(p[0], p[1], s.w * Math.max(.15, p[2]) / 2, 0, 7); ctx.fill(); ctx.restore(); return; }
      const uniform = p.every((v, i) => i % 3 !== 2 || Math.abs(v - p[2]) < .02);
      if (uniform) { ctx.lineWidth = s.w * Math.max(.15, p[2]); ctx.beginPath(); ctx.moveTo(p[0], p[1]); for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i], p[i + 1]); ctx.stroke(); }
      else for (let i = 3; i < p.length; i += 3) { ctx.lineWidth = s.w * Math.max(.15, (p[i - 1] + p[i + 2]) / 2); ctx.beginPath(); ctx.moveTo(p[i - 3], p[i - 2]); ctx.lineTo(p[i], p[i + 1]); ctx.stroke(); }
      ctx.restore();
    });
  }
  LM.drawStrokes = drawStrokes;

  /* ---------- per-layer helpers ---------- */
  function layerSize(L) {
    const C = L._c;
    switch (L.type) {
      case 'solid': return [L.solid.w, L.solid.h];
      case 'image': case 'video': { const a = LM.assets.get(L.asset); return a ? [a.w, a.h] : [100, 100]; }
      case 'precomp': { const c = LM.doc?.comps.find(c => c.id === L.comp); return c ? [c.w, c.h] : [100, 100]; }
      case 'null': return [100, 100];
      default: return C ? [C.w, C.h] : [1920, 1080];
    }
  }
  LM.layerSize = layerSize;
  function layerBounds(L, t) {
    if (L.type === 'shape') {
      const p = shapePath(L, t), sw = L.shape.stroke.on ? val(L.shape.stroke.width, t) / 2 : 0; let b = [Infinity, Infinity, -Infinity, -Infinity];
      flatten(p, 8).forEach(([x, y]) => { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); });
      if (!isFinite(b[0])) b = [-10, -10, 10, 10];
      return [b[0] - sw, b[1] - sw, b[2] + sw, b[3] + sw];
    }
    if (L.type === 'text') return textLayout(L, t).bounds;
    const [w, h] = layerSize(L); return [0, 0, w, h];
  }
  LM.layerBounds = layerBounds;
  const BLEND = { normal: 'source-over', add: 'lighter', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color-dodge': 'color-dodge', 'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity' };
  LM.BLENDS = [['normal', 'Normal'], ['add', 'Add'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['darken', 'Darken'], ['lighten', 'Lighten'], ['color-dodge', 'Color Dodge'], ['color-burn', 'Color Burn'], ['hard-light', 'Hard Light'], ['soft-light', 'Soft Light'], ['difference', 'Difference'], ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']];

  // draw layer content in layer space. ctx transform already set to (scale * layer matrix).
  function drawContent(ctx, L, t, R) {
    const lt = t - L.start;
    switch (L.type) {
      case 'solid': ctx.fillStyle = val(L.solid.color, t); ctx.fillRect(0, 0, L.solid.w, L.solid.h); break;
      case 'shape': drawShape(ctx, L, t); break;
      case 'text': drawText(ctx, L, t); break;
      case 'draw': drawStrokes(ctx, val(L.draw.cels, t)); break;
      case 'image': { const m = LM.media.get(L.asset); if (m?.img) ctx.drawImage(m.img, 0, 0); break; }
      case 'video': { const m = LM.media.get(L.asset), a = LM.assets.get(L.asset); if (m?.video && m.video.readyState >= 2) ctx.drawImage(m.video, 0, 0, a.w, a.h); break; }
      case 'precomp': {
        const sub = LM.doc.comps.find(c => c.id === L.comp); if (!sub || R.depth > 12) break;
        const tf = ctx.getTransform(), sf = Math.min(4, Math.max(R.scale, Math.sqrt(Math.abs(tf.a * tf.d - tf.b * tf.c))));
        const c = acquire(sub.w * sf, sub.h * sf);
        renderInto(sub, lt, c, { scale: sf, bg: false, depth: R.depth + 1, preview: R.preview, draft: R.draft, mb: R.mb });
        ctx.drawImage(c, 0, 0, sub.w, sub.h); release(c); break;
      }
    }
  }
  function setLayerTransform(ctx, L, t, comp, s, ox = 0, oy = 0) { const m = LM.layerMatrix(L, t, comp); ctx.setTransform(m[0] * s, m[1] * s, m[2] * s, m[3] * s, m[4] * s - ox, m[5] * s - oy); return m; }

  function maskCanvas(L, t, comp, s, W, H, includeBounds, ox = 0, oy = 0) {
    const masks = L.masks.filter(m => m.mode !== 'none');
    if (!masks.length && !includeBounds) return null;
    const mat = LM.layerMatrix(L, t, comp), sc = M.scaleOf(mat) * s;
    const setT = c => c.setTransform(mat[0] * s, mat[1] * s, mat[2] * s, mat[3] * s, mat[4] * s - ox, mat[5] * s - oy);
    let mc = null;
    if (masks.length) {
      mc = acquire(W, H); const x = mc._ctx;
      masks.forEach((m, i) => {
        const op = Math.max(0, Math.min(1, val(m.opacity, t) / 100)), fe = val(m.feather, t), ex = val(m.expansion, t), path = toPath2D(val(m.path, t));
        const tmp = acquire(W, H), y = tmp._ctx;
        if (m.inv) { y.fillStyle = '#fff'; y.fillRect(0, 0, W, H); y.globalCompositeOperation = 'destination-out'; }
        setT(y); y.fillStyle = '#fff'; y.strokeStyle = '#fff'; y.lineJoin = 'round';
        if (fe > 0) y.filter = `blur(${fe * sc / 2}px)`;
        y.fill(path);
        if (ex > 0) { y.lineWidth = ex * 2; y.stroke(path); }
        if (ex < 0) { y.globalCompositeOperation = m.inv ? 'source-over' : 'destination-out'; y.lineWidth = -ex * 2; y.stroke(path); }
        y.setTransform(1, 0, 0, 1, 0, 0); y.filter = 'none'; y.globalCompositeOperation = 'source-over';
        if (i === 0 && m.mode === 'subtract') { x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); }
        x.globalCompositeOperation = i === 0 ? (m.mode === 'subtract' ? 'destination-out' : 'source-over') : (m.mode === 'subtract' ? 'destination-out' : m.mode === 'intersect' ? 'destination-in' : 'source-over');
        x.globalAlpha = op; x.drawImage(tmp, 0, 0); release(tmp);
        x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
      });
    }
    if (includeBounds) {
      const b = acquire(W, H), x = b._ctx; setT(x); const [w, h] = layerSize(L); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.setTransform(1, 0, 0, 1, 0, 0);
      if (mc) { x.globalCompositeOperation = 'destination-in'; x.drawImage(mc, 0, 0); x.globalCompositeOperation = 'source-over'; release(mc); }
      return b;
    }
    return mc;
  }

  /* ---------- effects ---------- */
  const fxv = (fx, k, t) => { const p = fx.p[k]; return p.s ? p.v : val(p, t); };
  // separable box blur (3 passes ≈ gaussian) along one axis, on premultiplied pixels
  function boxBlur1D(d, w, h, r, horiz) {
    r = Math.max(1, Math.round(r)); const n = horiz ? w : h, lines = horiz ? h : w, tmp = new Float32Array(n * 4);
    for (let pass = 0; pass < 3; pass++) for (let l = 0; l < lines; l++) {
      const idx = i => (horiz ? l * w + i : i * w + l) * 4;
      for (let i = 0; i < n; i++) { const o = idx(i), a = d[o + 3] / 255; tmp[i * 4] = d[o] * a; tmp[i * 4 + 1] = d[o + 1] * a; tmp[i * 4 + 2] = d[o + 2] * a; tmp[i * 4 + 3] = d[o + 3]; }
      let s0 = 0, s1 = 0, s2 = 0, s3 = 0; const k = 2 * r + 1;
      for (let i = -r; i <= r; i++) { const j = Math.min(n - 1, Math.max(0, i)); if (i < 0 || i >= n) continue; s0 += tmp[j * 4]; s1 += tmp[j * 4 + 1]; s2 += tmp[j * 4 + 2]; s3 += tmp[j * 4 + 3]; }
      for (let i = 0; i < n; i++) {
        const o = idx(i), A = s3 / k;
        if (A > 0.01) { d[o] = s0 / k / (A / 255); d[o + 1] = s1 / k / (A / 255); d[o + 2] = s2 / k / (A / 255); } d[o + 3] = A;
        const out = i - r, inn = i + r + 1;
        if (out >= 0) { s0 -= tmp[out * 4]; s1 -= tmp[out * 4 + 1]; s2 -= tmp[out * 4 + 2]; s3 -= tmp[out * 4 + 3]; }
        if (inn < n) { s0 += tmp[inn * 4]; s1 += tmp[inn * 4 + 1]; s2 += tmp[inn * 4 + 2]; s3 += tmp[inn * 4 + 3]; }
      }
    }
  }
  function blurInto(src, radius, W, H, dir = 'both') {
    // returns a canvas (possibly downscaled) holding src blurred; caller draws it stretched to W×H
    if (dir === 'h' || dir === 'v') { const c = acquire(W, H); c._ctx.drawImage(src, 0, 0, W, H); pixelOp(c, (d, w, h) => boxBlur1D(d, w, h, radius * 0.9, dir === 'h')); return c; }
    const f = radius > 6 ? [1.5, 2, 3, 4, 6].filter(q => q <= radius / 3).pop() || 1 : 1;
    const c = acquire(W / f, H / f); c._ctx.filter = `blur(${radius / f}px)`; c._ctx.drawImage(src, 0, 0, c.width, c.height); return c;
  }
  // CPU pixel ops go through a dedicated willReadFrequently canvas so pooled (GPU) canvases are never read back
  let cpu = null;
  function pixelOp(buf, fn) {
    const w = buf.width, h = buf.height;
    if (!cpu || cpu.width !== w || cpu.height !== h) { cpu = new OffscreenCanvas(w, h); cpu._ctx = cpu.getContext('2d', { willReadFrequently: true }); }
    const y = cpu._ctx; y.clearRect(0, 0, w, h); y.drawImage(buf, 0, 0);
    const d = y.getImageData(0, 0, w, h); fn(d.data, w, h); y.putImageData(d, 0, 0);
    const x = buf._ctx; x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.filter = 'none'; x.globalCompositeOperation = 'copy'; x.drawImage(cpu, 0, 0); x.restore();
  }
  LM.pixelOp = pixelOp;
  // noise tiles (GPU noise via overlay blending of a random pattern)
  const noiseTiles = {};
  function noiseTile(color, k) {
    const key = (color ? 'c' : 'g') + k; if (noiseTiles[key]) return noiseTiles[key];
    const c = new OffscreenCanvas(256, 256), x = c.getContext('2d'), d = x.createImageData(256, 256);
    let sd = 1234567 + k * 7919 + (color ? 99 : 0); const r = () => { sd ^= sd << 13; sd >>>= 0; sd ^= sd >>> 17; sd ^= sd << 5; sd >>>= 0; return sd / 4294967296; };
    for (let i = 0; i < d.data.length; i += 4) { const g = r() * 255; d.data[i] = color ? r() * 255 : g; d.data[i + 1] = color ? r() * 255 : g; d.data[i + 2] = color ? r() * 255 : g; d.data[i + 3] = 255; }
    x.putImageData(d, 0, 0); return noiseTiles[key] = c;
  }
  function applyEffect(fx, buf, L, t, comp, s, R) {
    const x = buf._ctx, W = buf.width, H = buf.height, mat = LM.layerMatrix(L, t, comp), sc = s;
    switch (fx.type) {
      case 'blur': {
        const r = fxv(fx, 'amount', t) * sc; if (r <= 0.2) return;
        const b = blurInto(buf, r, W, H, fxv(fx, 'dir', t));
        x.clearRect(0, 0, W, H); x.drawImage(b, 0, 0, W, H); release(b); return;
      }
      case 'glow': {
        const T = Math.max(.03, fxv(fx, 'threshold', t) / 100), r = fxv(fx, 'radius', t) * sc, inten = fxv(fx, 'intensity', t), tint = fxv(fx, 'tint', t) === 'color', col = fxv(fx, 'color', t);
        if (inten <= 0) return;
        const f = [1, 2, 4].filter(q => q <= r / 6).pop() || 1, sm = acquire(W / f, H / f), y = sm._ctx;
        y.filter = `brightness(${0.5 / T}) contrast(3)`; y.drawImage(buf, 0, 0, sm.width, sm.height); y.filter = 'none';
        if (tint) { y.globalCompositeOperation = 'saturation'; y.fillStyle = '#808080'; y.fillRect(0, 0, sm.width, sm.height); y.globalCompositeOperation = 'multiply'; y.fillStyle = col; y.fillRect(0, 0, sm.width, sm.height); }
        y.globalCompositeOperation = 'destination-in'; y.drawImage(buf, 0, 0, sm.width, sm.height); y.globalCompositeOperation = 'source-over';
        const b = blurInto(sm, r / f, sm.width, sm.height);
        x.save(); x.globalCompositeOperation = 'lighter';
        let left = inten; while (left > 0) { x.globalAlpha = Math.min(1, left); x.drawImage(b, 0, 0, W, H); left -= 1; }
        x.restore(); release(b); release(sm); return;
      }
      case 'shadow': {
        const col = fxv(fx, 'color', t), op = fxv(fx, 'opacity', t) / 100, dir = (fxv(fx, 'direction', t) - 90) * Math.PI / 180, dist = fxv(fx, 'distance', t) * sc, soft = fxv(fx, 'softness', t) * sc;
        const sh = acquire(W, H); sh._ctx.drawImage(buf, 0, 0); sh._ctx.globalCompositeOperation = 'source-in'; sh._ctx.fillStyle = col; sh._ctx.fillRect(0, 0, W, H);
        const b = soft > .3 ? blurInto(sh, soft, W, H) : sh;
        x.save(); x.globalCompositeOperation = 'destination-over'; x.globalAlpha = op; x.drawImage(b, Math.cos(dir) * dist, Math.sin(dir) * dist, W, H); x.restore();
        if (b !== sh) release(b); release(sh); return;
      }
      case 'bc': case 'hs': {
        let f;
        if (fx.type === 'bc') { const b = fxv(fx, 'brightness', t), c = fxv(fx, 'contrast', t); f = `brightness(${Math.max(0, 1 + b / 100)}) contrast(${Math.max(0, 1 + c / 100)})`; }
        else { const h = fxv(fx, 'hue', t), sa = fxv(fx, 'sat', t), l = fxv(fx, 'light', t); f = `hue-rotate(${h}deg) saturate(${Math.max(0, 1 + sa / 100)}) brightness(${Math.max(0, 1 + l / 100)})`; }
        const c = acquire(W, H); c._ctx.drawImage(buf, 0, 0); x.clearRect(0, 0, W, H); x.filter = f; x.drawImage(c, 0, 0); x.filter = 'none'; release(c); return;
      }
      case 'tint': {
        const a = LM.hex2rgb(fxv(fx, 'black', t)), b = LM.hex2rgb(fxv(fx, 'white', t)), amt = fxv(fx, 'amount', t) / 100; if (amt <= 0) return;
        pixelOp(buf, d => { for (let i = 0; i < d.length; i += 4) { const al = d[i + 3]; if (!al) continue; const l = (d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114) / 255; for (let c = 0; c < 3; c++) { const tc = a[c] + (b[c] - a[c]) * l; d[i + c] += (tc - d[i + c]) * amt; } } });
        return;
      }
      case 'ramp': {
        const ox = R.ox || 0, oy = R.oy || 0, p0 = M.apply(mat, ...fxv(fx, 'p0', t)).map((v, i) => v - (i ? oy : ox) / sc), p1 = M.apply(mat, ...fxv(fx, 'p1', t)).map((v, i) => v - (i ? oy : ox) / sc), bl = fxv(fx, 'blend', t) / 100;
        let g;
        if (fxv(fx, 'shape', t) === 'radial') g = x.createRadialGradient(p0[0] * sc, p0[1] * sc, 0, p0[0] * sc, p0[1] * sc, Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * sc || 1);
        else g = x.createLinearGradient(p0[0] * sc, p0[1] * sc, p1[0] * sc, p1[1] * sc);
        g.addColorStop(0, fxv(fx, 'c0', t)); g.addColorStop(1, fxv(fx, 'c1', t));
        x.save(); x.globalCompositeOperation = 'source-atop'; x.globalAlpha = 1 - bl; x.fillStyle = g; x.fillRect(0, 0, W, H); x.restore(); return;
      }
      case 'noise': {
        const amt = fxv(fx, 'amount', t) / 100 * 255, colr = fxv(fx, 'colored', t), anim = fxv(fx, 'animated', t); if (amt <= 0) return;
        const fr = anim ? Math.round(t * comp.fps) : 0, tile = noiseTile(colr, fr % 4), pat = x.createPattern(tile, 'repeat');
        pat.setTransform(new DOMMatrix().translate((LM.expr.hash(fr * 3 + 1) * 256) | 0, (LM.expr.hash(fr * 3 + 2) * 256) | 0));
        const tmp = acquire(W, H), y = tmp._ctx; y.drawImage(buf, 0, 0);
        y.globalCompositeOperation = 'hard-light'; y.globalAlpha = Math.min(1, amt / 255); y.fillStyle = pat; y.fillRect(0, 0, W, H);
        y.globalAlpha = 1; y.globalCompositeOperation = 'destination-in'; y.drawImage(buf, 0, 0);
        x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'copy'; x.drawImage(tmp, 0, 0); x.restore(); release(tmp);
        return;
      }
    }
  }
  LM.applyEffect = applyEffect;

  /* ---------- layer rendering ---------- */
  function needsBuffer(L) { return L.masks.some(m => m.mode !== 'none') || L.effects.some(f => f.on && f.type !== 'mblur') || L.matte || L.type === 'draw'; }
  // render layer (content + masks + effects) into a fresh comp-sized buffer; includes opacity if withOpacity
  function layerBuffer(L, t, comp, R, withOpacity) {
    const s = R.scale, W = R.W, H = R.H, buf = acquire(W, H), x = buf._ctx;
    setLayerTransform(x, L, t, comp, s, R.ox || 0, R.oy || 0);
    drawContent(x, L, t, R);
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over';
    const mc = maskCanvas(L, t, comp, s, W, H, false, R.ox || 0, R.oy || 0);
    if (mc) { x.globalCompositeOperation = 'destination-in'; x.drawImage(mc, 0, 0); x.globalCompositeOperation = 'source-over'; release(mc); }
    L.effects.forEach(fx => { if (fx.on && fx.type !== 'mblur') { x.save(); applyEffect(fx, buf, L, t, comp, s, R); x.restore(); x.setTransform(1, 0, 0, 1, 0, 0); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over'; } });
    if (withOpacity) { const op = Math.max(0, Math.min(1, val(L.tr.opacity, t) / 100)); if (op < 1) { x.globalCompositeOperation = 'destination-in'; x.fillStyle = `rgba(0,0,0,${op})`; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'source-over'; } }
    return buf;
  }
  function mbSettings(L, comp, t) {
    const fx = L.effects.find(f => f.type === 'mblur' && f.on);
    if (fx) return { angle: fxv(fx, 'angle', t), samples: Math.round(fxv(fx, 'samples', t)), phase: fxv(fx, 'phase', t) };
    if (L.mb && comp.mbOn) return { angle: comp.mb.angle, samples: comp.mb.samples, phase: comp.mb.phase };
    return null;
  }
  function sampleTimes(mb, t, fps) {
    const n = Math.max(2, Math.min(64, mb.samples)), dur = mb.angle / 360 / fps, st = t + mb.phase / 360 / fps;
    const out = []; for (let i = 0; i < n; i++) out.push(st + dur * (i + .5) / n); return out;
  }
  // AE semantics: a layer with a track matte uses the layer directly above it as the matte.
  function matteLayerOf(comp, i) { return i > 0 ? comp.layers[i - 1] : null; }
  // region of the output a layer can touch (buffer placement), padded for effects; quantised so pooled canvases get reused
  function effectPad(L, t) {
    let p = 0;
    L.effects.forEach(fx => { if (!fx.on) return; if (fx.type === 'blur') p += fxv(fx, 'amount', t) * 3; if (fx.type === 'glow') p += fxv(fx, 'radius', t) * 2.5; if (fx.type === 'shadow') p += fxv(fx, 'distance', t) + fxv(fx, 'softness', t) * 2.5; });
    return p;
  }
  function layerRegion(L, t, comp, R, times, i) {
    const full = { ...R, ox: 0, oy: 0 };
    if (L.type === 'draw' || L.type === 'adjust' || (L.matte && L.matte.endsWith('Inv'))) return full;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (Ly, tt) => {
      let b = layerBounds(Ly, tt);
      if (Ly.type === 'text' && Ly.text.animators.length) { const sz = val(Ly.text.size, tt); let mp = 0; Ly.text.animators.forEach(A => { const p = val(A.position, tt); mp = Math.max(mp, Math.abs(p[0]), Math.abs(p[1])) + val(A.blur, tt) * 3; const sc2 = val(A.scale, tt); if (sc2 > 100) mp += sz * (sc2 / 100 - 1); if (val(A.rotation, tt)) mp += sz; }); b = [b[0] - mp, b[1] - mp, b[2] + mp, b[3] + mp]; }
      const m = LM.layerMatrix(Ly, tt, comp), pad = effectPad(Ly, tt) * M.scaleOf(m);
      [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].forEach(([u, v]) => { const [px, py] = M.apply(m, u, v); x0 = Math.min(x0, px - pad); y0 = Math.min(y0, py - pad); x1 = Math.max(x1, px + pad); y1 = Math.max(y1, py + pad); });
    };
    try { (times || [t]).forEach(tt => add(L, tt)); } catch (e) { return full; }
    if (!isFinite(x0)) return full;
    const s = R.scale, Q = 32;
    let ox = Math.max(0, Math.floor(x0 * s / Q) * Q - Q), oy = Math.max(0, Math.floor(y0 * s / Q) * Q - Q);
    let ex = Math.min(R.W, Math.ceil(x1 * s / Q) * Q + Q), ey = Math.min(R.H, Math.ceil(y1 * s / Q) * Q + Q);
    if (ex <= ox || ey <= oy) return null;
    let W = Math.ceil((ex - ox) / 64) * 64, H = Math.ceil((ey - oy) / 64) * 64;
    if (W * H >= R.W * R.H * .8) return full;
    return { ...R, ox, oy, W, H };
  }
  function renderLayer(ctx, comp, i, t, R) {
    const L = comp.layers[i], blend = BLEND[L.blend] || 'source-over';
    const mb = R.mb !== false ? mbSettings(L, comp, t) : null;
    let times = mb && mb.angle > 0 ? sampleTimes(R.draft ? { ...mb, samples: Math.min(mb.samples, 4) } : mb, t, comp.fps) : null;
    if (times) { // skip samples if nothing moves
      const m0 = JSON.stringify(LM.layerMatrix(L, times[0], comp)), m1 = JSON.stringify(LM.layerMatrix(L, times[times.length - 1], comp));
      if (m0 === m1 && !LM.layerHasAnim(L) && L.type !== 'precomp') times = null;
    }
    if (!times && !needsBuffer(L)) {
      ctx.save(); ctx.globalAlpha = Math.max(0, Math.min(1, val(L.tr.opacity, t) / 100)); ctx.globalCompositeOperation = blend;
      if (ctx.globalAlpha > 0) { setLayerTransform(ctx, L, t, comp, R.scale); drawContent(ctx, L, t, R); }
      ctx.restore(); return;
    }
    const Rl = layerRegion(L, t, comp, R, times, i);
    if (!Rl) return;
    let buf;
    if (times) {
      buf = acquire(Rl.W, Rl.H); const bx = buf._ctx; bx.globalCompositeOperation = 'lighter'; bx.globalAlpha = 1 / times.length;
      times.forEach(ts => { const b = layerBuffer(L, ts, comp, Rl, true); bx.drawImage(b, 0, 0); release(b); });
      bx.globalCompositeOperation = 'source-over'; bx.globalAlpha = 1;
    } else buf = layerBuffer(L, t, comp, Rl, true);
    if (L.matte) {
      const ML = matteLayerOf(comp, i);
      if (ML && t >= ML.in && t < ML.out) {
        const mbuf = layerBuffer(ML, t, comp, Rl, true);
        if (L.matte === 'luma' || L.matte === 'lumaInv') pixelOp(mbuf, d => { for (let j = 0; j < d.length; j += 4) { d[j + 3] = (d[j] * .299 + d[j + 1] * .587 + d[j + 2] * .114) * d[j + 3] / 255; d[j] = d[j + 1] = d[j + 2] = 255; } });
        const bx = buf._ctx; bx.globalCompositeOperation = L.matte === 'alpha' || L.matte === 'luma' ? 'destination-in' : 'destination-out'; bx.drawImage(mbuf, 0, 0); bx.globalCompositeOperation = 'source-over'; release(mbuf);
      } else if (L.matte === 'alpha' || L.matte === 'luma') buf._ctx.clearRect(0, 0, Rl.W, Rl.H);
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = blend; ctx.drawImage(buf, Rl.ox, Rl.oy); ctx.restore();
    release(buf);
  }
  function renderAdjustment(out, comp, L, t, R) {
    const fxs = L.effects.filter(f => f.on && f.type !== 'mblur'); if (!fxs.length) return;
    const op = Math.max(0, Math.min(1, val(L.tr.opacity, t) / 100)); if (op <= 0) return;
    const ctx = out.getContext ? out.getContext('2d') : out._ctx;
    const copy = acquire(R.W, R.H); copy._ctx.drawImage(out, 0, 0);
    fxs.forEach(fx => { copy._ctx.save(); applyEffect(fx, copy, L, t, comp, R.scale, R); copy._ctx.restore(); copy._ctx.setTransform(1, 0, 0, 1, 0, 0); });
    const mc = maskCanvas(L, t, comp, R.scale, R.W, R.H, true);
    if (op < 1) { mc._ctx.globalCompositeOperation = 'destination-in'; mc._ctx.fillStyle = `rgba(0,0,0,${op})`; mc._ctx.fillRect(0, 0, R.W, R.H); mc._ctx.globalCompositeOperation = 'source-over'; }
    copy._ctx.globalCompositeOperation = 'destination-in'; copy._ctx.drawImage(mc, 0, 0);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'destination-out'; ctx.drawImage(mc, 0, 0); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(copy, 0, 0); ctx.restore();
    release(mc); release(copy);
  }
  LM.isVisibleAt = (L, t) => t >= L.in && t < L.out;
  // Render comp at comp-time t into canvas `out` (HTMLCanvas/OffscreenCanvas sized comp*scale).
  function renderInto(comp, t, out, o = {}) {
    const s = o.scale || 1, W = out.width, H = out.height;
    const ctx = out._ctx || out.getContext('2d');
    const R = { scale: s, W, H, depth: o.depth || 0, preview: o.preview, mb: o.mb, draft: o.draft };
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (o.bg === false) ctx.clearRect(0, 0, W, H); else if (o.bg === 'transparent') ctx.clearRect(0, 0, W, H); else { ctx.fillStyle = comp.bg; ctx.fillRect(0, 0, W, H); }
    const Ls = comp.layers, solo = Ls.some(l => l.solo && l.visible && l.type !== 'null');
    for (let i = Ls.length - 1; i >= 0; i--) {
      const L = Ls[i];
      if (Ls[i + 1] && Ls[i + 1].matte && L !== Ls[i + 1]) continue;   // used as a track matte
      if (!L.visible || L.type === 'null') continue;
      if (solo && !L.solo) continue;
      if (t < L.in || t >= L.out) continue;
      try {
        if (L.type === 'adjust') renderAdjustment(out, comp, L, t, R);
        else renderLayer(ctx, comp, i, t, R);
      } catch (e) { console.warn('Render error in layer', L.name, e); }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  LM.renderInto = renderInto;

  /* ---------- video sync ---------- */
  // visit video layers that are visible at t (recursing into precomps) → [{L, lt}]
  function videosAt(comp, t, out = [], depth = 0) {
    if (depth > 12) return out;
    comp.layers.forEach(L => {
      if (!L.visible || t < L.in || t >= L.out) return;
      if (L.type === 'video') out.push({ L, lt: t - L.start });
      if (L.type === 'precomp') { const sub = LM.doc.comps.find(c => c.id === L.comp); if (sub) videosAt(sub, t - L.start, out, depth + 1); }
    });
    return out;
  }
  LM.videosAt = videosAt;
  // precise seek of every visible video so the next render is frame-accurate
  LM.seekVideos = async function (comp, t) {
    const vids = videosAt(comp, t);
    await Promise.all(vids.map(({ L, lt }) => new Promise(res => {
      const m = LM.media.get(L.asset); if (!m?.video) return res();
      const v = m.video, target = Math.max(0, Math.min(lt, (v.duration || 1e9) - 0.001));
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) < 1e-4 && v.readyState >= 2) return res();
      const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); if (v.requestVideoFrameCallback) { let fin = false; const f = () => { if (!fin) { fin = true; res(); } }; v.requestVideoFrameCallback(f); setTimeout(f, 150); } else res(); };
      const to = setTimeout(done, 3000);
      v.addEventListener('seeked', done); v.currentTime = target;
    })));
  };
})();
