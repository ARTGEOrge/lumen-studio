'use strict';
/* Lumen Motion — 2.5D: 3D layers (Z position, X/Y/Z rotation), camera layers (zoom, point of interest),
   perspective projection and depth sorting. Each 3D layer is rendered flat in its own layer space (content,
   masks, effects) and then mapped onto the output with a perspective-correct quad drawn by WebGL2. */
(function () {
  const LM = window.LM, { val, M4 } = LM;
  const S = LM.space = {};
  const NEAR = 1, FAR = 1e6;
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]); return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : null; };
  S.defaultZoom = comp => comp.w * 1.3889;   // ≈ a 50 mm lens

  /* ---------- camera ---------- */
  S.cameraLayer = (comp, t) => comp.layers.find(L => L.type === 'camera' && L.visible && t >= L.in && t < L.out) || null;
  // camera at time t → {pos, X, Y, Z (camera axes in world space), zoom, w, h}
  S.camera = (comp, t) => {
    const L = S.cameraLayer(comp, t), w = comp.w, h = comp.h;
    if (!L) { const zoom = S.defaultZoom(comp); return { pos: [w / 2, h / 2, -zoom], X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1], zoom, w, h }; }
    const W = LM.world4(L, t, comp), pos = [W[3], W[7], W[11]], poi = val(L.cam.poi, t);
    const f = norm([poi[0] - pos[0], poi[1] - pos[1], (poi[2] || 0) - pos[2]]) || [0, 0, 1];
    const r = norm(cross([0, 1, 0], f)) || [1, 0, 0], d = cross(f, r);
    // the camera's own X/Y/Z rotation, applied in camera space
    const D = Math.PI / 180, Rc = M4.mul(M4.RX(val(L.tr.rotX, t) * D), M4.mul(M4.RY(val(L.tr.rotY, t) * D), M4.RZ(val(L.tr.rotation, t) * D)));
    const col = j => [r[0] * Rc[j] + d[0] * Rc[4 + j] + f[0] * Rc[8 + j], r[1] * Rc[j] + d[1] * Rc[4 + j] + f[1] * Rc[8 + j], r[2] * Rc[j] + d[2] * Rc[4 + j] + f[2] * Rc[8 + j]];
    return { pos, X: col(0), Y: col(1), Z: col(2), zoom: Math.max(1, val(L.cam.zoom, t)), w, h };
  };
  S.toCam = (cam, p) => { const x = p[0] - cam.pos[0], y = p[1] - cam.pos[1], z = p[2] - cam.pos[2]; return [x * cam.X[0] + y * cam.X[1] + z * cam.X[2], x * cam.Y[0] + y * cam.Y[1] + z * cam.Y[2], x * cam.Z[0] + y * cam.Z[1] + z * cam.Z[2]]; };
  // world point → comp pixel coords [x, y, depth] (null when behind the camera)
  S.project = (cam, p) => { const c = S.toCam(cam, p); if (c[2] < NEAR) return null; return [cam.w / 2 + cam.zoom * c[0] / c[2], cam.h / 2 + cam.zoom * c[1] / c[2], c[2]]; };
  S.projector = (L, t, comp) => { const W = LM.world4(L, t, comp), cam = S.camera(comp, t); return (u, v) => S.project(cam, M4.apply(W, u, v, 0)); };
  // comp point → layer-space point on the layer's plane (ray from the camera through the pixel); null if parallel/behind
  S.unprojector = (L, t, comp) => {
    const W = LM.world4(L, t, comp), cam = S.camera(comp, t);
    const O = [W[3], W[7], W[11]], U = [W[0], W[4], W[8]], V = [W[1], W[5], W[9]];
    return (x, y) => {
      const dx = (x - cam.w / 2) / cam.zoom, dy = (y - cam.h / 2) / cam.zoom;
      const d = [cam.X[0] * dx + cam.Y[0] * dy + cam.Z[0], cam.X[1] * dx + cam.Y[1] * dy + cam.Z[1], cam.X[2] * dx + cam.Y[2] * dy + cam.Z[2]];
      const r = [cam.pos[0] - O[0], cam.pos[1] - O[1], cam.pos[2] - O[2]], nd = [-d[0], -d[1], -d[2]];
      // solve u·U + v·V + s·(−d) = r (Cramer's rule)
      const det3 = (a, b, c) => a[0] * (b[1] * c[2] - b[2] * c[1]) - b[0] * (a[1] * c[2] - a[2] * c[1]) + c[0] * (a[1] * b[2] - a[2] * b[1]);
      const D = det3(U, V, nd); if (Math.abs(D) < 1e-9) return null;
      const u = det3(r, V, nd) / D, v = det3(U, r, nd) / D, s = det3(U, V, r) / D;
      return s > 0 ? [u, v] : null;
    };
  };
  // comp-pixel → world-unit factor at the layer's anchor depth (for dragging 3D layers in the viewer)
  S.depthScale = (L, t, comp) => { const cam = S.camera(comp, t), a = val(L.tr.anchor, t), c = S.toCam(cam, M4.apply(LM.world4(L, t, comp), a[0], a[1], 0)); return c[2] > NEAR ? c[2] / cam.zoom : 1; };
  S.cameraMoves = (comp, times) => { if (!S.cameraLayer(comp, times[0])) return false; const a = S.camera(comp, times[0]), b = S.camera(comp, times[times.length - 1]); return JSON.stringify([a.pos, a.Z, a.zoom]) !== JSON.stringify([b.pos, b.Z, b.zoom]); };

  /* ---------- depth sorting: runs of consecutive 3D layers are drawn back to front ---------- */
  S.depth = (L, t, comp, cam) => { const b = LM.layerBounds(L, t), W = LM.world4(L, t, comp); return S.toCam(cam, M4.apply(W, (b[0] + b[2]) / 2, (b[1] + b[3]) / 2, 0))[2]; };
  S.depthSort = (comp, order, t) => {
    const Ls = comp.layers, cam = S.camera(comp, t), out = [];
    let run = [];
    const flush = () => { if (run.length > 1) { const d = new Map(run.map(i => [i, S.depth(Ls[i], t, comp, cam)])); run.sort((a, b) => (d.get(b) - d.get(a)) || (b - a)); } out.push(...run); run = []; };
    order.forEach(i => { if (LM.is3D(Ls[i]) && Ls[i].type !== 'adjust') run.push(i); else { flush(); out.push(i); } });
    flush();
    return out;
  };

  /* ---------- WebGL2 quad renderer ---------- */
  let G = null;
  function gl() {
    if (G !== null) return G;
    try {
      const cv = new OffscreenCanvas(16, 16), g = cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: true, antialias: true });
      if (!g) return G = false;
      const sh = (type, src) => { const s = g.createShader(type); g.shaderSource(s, src); g.compileShader(s); if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s)); return s; };
      const prog = g.createProgram();
      g.attachShader(prog, sh(g.VERTEX_SHADER, '#version 300 es\nin vec4 a_pos; in vec2 a_uv; out vec2 v_uv; void main(){ gl_Position = a_pos; v_uv = a_uv; }'));
      g.attachShader(prog, sh(g.FRAGMENT_SHADER, '#version 300 es\nprecision highp float; in vec2 v_uv; uniform sampler2D u_tex; out vec4 o; void main(){ o = texture(u_tex, v_uv); }'));
      g.linkProgram(prog); if (!g.getProgramParameter(prog, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(prog));
      const buf = g.createBuffer(), tex = g.createTexture(), aniso = g.getExtension('EXT_texture_filter_anisotropic');
      G = { cv, g, prog, buf, tex, aniso, aPos: g.getAttribLocation(prog, 'a_pos'), aUv: g.getAttribLocation(prog, 'a_uv') };
    } catch (e) { console.warn('WebGL2 unavailable for 3D layers', e); G = false; }
    return G;
  }
  // draw `src` (layer-space buffer covering bounds b) projected through world matrix W into a W×H canvas
  function drawQuad(src, b, W4, cam, R) {
    const C = gl(), corners = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]], uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const cs = corners.map(([u, v]) => S.toCam(cam, M4.apply(W4, u, v, 0)));
    if (cs.every(c => c[2] < NEAR)) return null;
    if (!C) { // fallback: affine fit through three projected corners (no perspective)
      const p = cs.map(c => c[2] >= NEAR ? [cam.w / 2 + cam.zoom * c[0] / c[2], cam.h / 2 + cam.zoom * c[1] / c[2]] : null); if (!p[0] || !p[1] || !p[3]) return null;
      const out = LM.acquire(R.W, R.H), x = out._ctx, s = R.scale;
      x.setTransform((p[1][0] - p[0][0]) / src.width * s, (p[1][1] - p[0][1]) / src.width * s, (p[3][0] - p[0][0]) / src.height * s, (p[3][1] - p[0][1]) / src.height * s, p[0][0] * s, p[0][1] * s);
      x.drawImage(src, 0, 0); x.setTransform(1, 0, 0, 1, 0, 0); return out;
    }
    const { cv, g } = C;
    if (cv.width !== R.W || cv.height !== R.H) { cv.width = R.W; cv.height = R.H; }
    g.viewport(0, 0, R.W, R.H); g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
    const s = R.scale, a = (FAR + NEAR) / (FAR - NEAR), bb = -2 * FAR * NEAR / (FAR - NEAR), data = [];
    const vert = i => { const [x, y, z] = cs[i]; data.push((2 * s / R.W) * (cam.zoom * x + cam.w / 2 * z) - z, z - (2 * s / R.H) * (cam.zoom * y + cam.h / 2 * z), a * z + bb, z, uv[i][0], uv[i][1]); };
    [0, 1, 2, 0, 2, 3].forEach(vert);
    g.useProgram(C.prog);
    g.bindBuffer(g.ARRAY_BUFFER, C.buf); g.bufferData(g.ARRAY_BUFFER, new Float32Array(data), g.STREAM_DRAW);
    g.enableVertexAttribArray(C.aPos); g.vertexAttribPointer(C.aPos, 4, g.FLOAT, false, 24, 0);
    g.enableVertexAttribArray(C.aUv); g.vertexAttribPointer(C.aUv, 2, g.FLOAT, false, 24, 16);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, C.tex);
    g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, src);
    g.generateMipmap(g.TEXTURE_2D);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR_MIPMAP_LINEAR); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE); g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    if (C.aniso) g.texParameterf(g.TEXTURE_2D, C.aniso.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    g.drawArrays(g.TRIANGLES, 0, 6);
    const out = LM.acquire(R.W, R.H); out._ctx.drawImage(cv, 0, 0); return out;
  }
  // render a 3D layer (with motion-blur samples) into a full output-size buffer
  S.render = (L, t, comp, R, times) => {
    const ts = times || [t], out = LM.acquire(R.W, R.H), ox = out._ctx; let any = false;
    ox.globalCompositeOperation = 'lighter';
    for (const tt of ts) {
      const cam = S.camera(comp, tt), W4 = LM.world4(L, tt, comp), b = LM.contentBounds(L, tt);
      const bw = Math.max(1, b[2] - b[0]), bh = Math.max(1, b[3] - b[1]);
      // pick the content resolution from how large the layer appears on screen
      const cs = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(([u, v]) => S.toCam(cam, M4.apply(W4, u, v, 0)));
      if (cs.every(c => c[2] < NEAR)) continue;
      let k = 0; const P = c => [cam.zoom * c[0] / c[2], cam.zoom * c[1] / c[2]];
      for (let i = 0; i < 4; i++) { const p = cs[i], q = cs[(i + 1) % 4]; if (p[2] < NEAR || q[2] < NEAR) { k = Math.max(k, 2); continue; } const A = P(p), B = P(q); k = Math.max(k, Math.hypot(A[0] - B[0], A[1] - B[1]) / (i % 2 ? bh : bw)); }
      let sl = Math.min(4, Math.max(0.02, k * R.scale * 1.05));
      sl = Math.min(sl, 4096 / bw, 4096 / bh);
      const Rc = { scale: sl, W: Math.max(1, Math.ceil(bw * sl)), H: Math.max(1, Math.ceil(bh * sl)), ox: 0, oy: 0, depth: R.depth, preview: R.preview, draft: R.draft, mb: false, matOf: () => [1, 0, 0, 1, -b[0], -b[1]] };
      const buf = LM.layerBuffer(L, tt, comp, Rc, true);
      const q = drawQuad(buf, [b[0], b[1], b[0] + Rc.W / sl, b[1] + Rc.H / sl], W4, cam, R);
      LM.release(buf);
      if (q) { ox.globalAlpha = 1 / ts.length; ox.drawImage(q, 0, 0); LM.release(q); any = true; }
    }
    ox.globalAlpha = 1; ox.globalCompositeOperation = 'source-over';
    if (!any) { LM.release(out); return null; }
    return out;
  };
})();
