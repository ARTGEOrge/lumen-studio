// Lumen Stress — viewport: three.js scene (orthographic for 2-D, orbiting perspective for 3-D) with banded contour
// rendering through a 1-D colour-map texture, plus a 2-D overlay canvas the app draws geometry, supports, legends on.
(function () {
  const T = window.THREE;
  const V = window.StressView = { mode: '2d', s: 2, ox: 0, oy: 0, need: true };
  let renderer, scene, cam2, cam3, controls, glc, ovc, ovx, stage, root, field = null, extras = null, stl = null, lut = null, onOverlay = null;
  // Ansys-like rainbow: blue → cyan → green → yellow → red
  const RAINBOW = [[0, 0, 255], [0, 140, 255], [0, 220, 255], [0, 255, 170], [0, 255, 0], [170, 255, 0], [255, 235, 0], [255, 150, 0], [255, 0, 0]];
  V.RAINBOW = RAINBOW;
  function colorAt(t, bands, reverse) {
    t = Math.max(0, Math.min(1, t)); if (reverse) t = 1 - t;
    if (bands) { const k = Math.min(bands - 1, Math.floor(t * bands)), u = bands === 1 ? 0 : k / (bands - 1); return lerp(u); }
    return lerp(t);
  }
  function lerp(u) { const n = RAINBOW.length - 1, i = Math.min(n - 1, Math.floor(u * n)), f = u * n - i, a = RAINBOW[i], b = RAINBOW[i + 1]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; }
  V.colorAt = colorAt;
  // colour map as a 512×1 canvas texture, sampled without filtering so bands stay crisp
  function makeLUT(bands, reverse) {
    const N = 512, c = document.createElement('canvas'); c.width = N; c.height = 1; const x = c.getContext('2d'), img = x.createImageData(N, 1);
    for (let i = 0; i < N; i++) { const k = colorAt((i + 0.5) / N, bands, reverse); img.data.set([k[0], k[1], k[2], 255], i * 4); }
    x.putImageData(img, 0, 0);
    const tx = new T.CanvasTexture(c); tx.magFilter = 1003; tx.minFilter = 1003; tx.generateMipmaps = false; tx.colorSpace = T.SRGBColorSpace; tx.needsUpdate = true; return tx;   // 1003 = THREE.NearestFilter
  }
  V.init = function (stageEl, overlayDraw) {
    stage = stageEl; onOverlay = overlayDraw;
    glc = document.createElement('canvas'); glc.className = 'gl'; ovc = document.createElement('canvas'); ovc.className = 'ov';
    stage.append(glc, ovc); ovx = ovc.getContext('2d');
    renderer = new T.WebGLRenderer({ canvas: glc, antialias: true, preserveDrawingBuffer: true }); renderer.outputColorSpace = T.SRGBColorSpace; renderer.setClearColor(0x000000, 0);
    scene = new T.Scene(); root = new T.Group(); scene.add(root);
    scene.add(new T.HemisphereLight(0xffffff, 0x7d8a99, 1.5));
    const d1 = new T.DirectionalLight(0xffffff, 1.5); d1.position.set(1, -1.2, 2); scene.add(d1);
    const d2 = new T.DirectionalLight(0xffffff, 0.5); d2.position.set(-1.5, 1, -0.5); scene.add(d2);
    cam2 = new T.OrthographicCamera(-1, 1, 1, -1, -1e6, 1e6); cam2.position.set(0, 0, 1000);
    cam3 = new T.PerspectiveCamera(32, 1, 0.1, 1e6); cam3.up.set(0, 0, 1); cam3.position.set(300, -400, 250);
    controls = new T.OrbitControls(cam3, ovc); controls.enableDamping = true; controls.dampingFactor = 0.14; controls.screenSpacePanning = true; controls.enabled = false;
    controls.mouseButtons = { LEFT: 0, MIDDLE: 2, RIGHT: 2 };   // rotate, pan, pan (THREE.MOUSE is not in the vendored subset)
    controls.addEventListener('change', () => V.need = true);
    new ResizeObserver(resize).observe(stage); resize();
    const loop = () => { requestAnimationFrame(loop); const moved = V.mode === '3d' && controls.update(); if (moved || V.need) { V.need = false; render(); } };
    loop();
  };
  function resize() {
    const r = stage.getBoundingClientRect(), dpr = window.devicePixelRatio || 1; V.W = Math.max(10, r.width); V.H = Math.max(10, r.height);
    renderer.setPixelRatio(dpr); renderer.setSize(V.W, V.H, false); glc.style.width = ovc.style.width = V.W + 'px'; glc.style.height = ovc.style.height = V.H + 'px';
    ovc.width = Math.round(V.W * dpr); ovc.height = Math.round(V.H * dpr); cam3.aspect = V.W / V.H; cam3.updateProjectionMatrix(); V.need = true;
  }
  function render() {
    if (V.mode === '2d') { cam2.left = -V.ox / V.s; cam2.right = (V.W - V.ox) / V.s; cam2.top = V.oy / V.s; cam2.bottom = (V.oy - V.H) / V.s; cam2.updateProjectionMatrix(); renderer.render(scene, cam2); }
    else renderer.render(scene, cam3);
    const dpr = ovc.width / V.W; ovx.setTransform(dpr, 0, 0, dpr, 0, 0); ovx.clearRect(0, 0, V.W, V.H);
    if (onOverlay) onOverlay(ovx);
  }
  V.renderNow = () => { V.need = false; render(); };
  V.canvases = () => ({ gl: glc, ov: ovc });
  V.overlayCanvas = () => ovc;
  V.setMode = m => { V.mode = m; controls.enabled = m === '3d'; V.need = true; };
  // 2-D transforms
  V.toScreen = (x, y) => [V.ox + V.s * x, V.oy - V.s * y];
  V.toWorld = (sx, sy) => [(sx - V.ox) / V.s, (V.oy - sy) / V.s];
  V.fit2D = bb => { const pad = 60, s = Math.min((V.W - 2 * pad) / (bb.w || 1), (V.H - 2 * pad) / (bb.h || 1)); V.s = s > 0 ? s : 1; V.ox = V.W / 2 - V.s * (bb.x0 + bb.w / 2); V.oy = V.H / 2 + V.s * (bb.y0 + bb.h / 2); V.need = true; };
  V.zoomAt = (f, sx, sy) => { const [wx, wy] = V.toWorld(sx, sy); V.s = Math.max(1e-6, Math.min(1e6, V.s * f)); V.ox = sx - V.s * wx; V.oy = sy + V.s * wy; V.need = true; };
  V.pan = (dx, dy) => { V.ox += dx; V.oy += dy; V.need = true; };
  // 3-D
  V.project = p => { const v = new T.Vector3(p[0], p[1], p[2]).project(cam3); return [(v.x + 1) / 2 * V.W, (1 - v.y) / 2 * V.H, v.z]; };
  V.fit3D = (bb, dir) => {
    const c = new T.Vector3((bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2), size = bb.diag || 100;
    const d = new T.Vector3(...(dir || [1, -1.35, 0.95])).normalize().multiplyScalar(size * 2.1);
    cam3.position.copy(c.clone().add(d)); controls.target.copy(c); cam3.near = size / 500; cam3.far = size * 100; cam3.updateProjectionMatrix(); controls.update(); V.need = true;
  };
  V.camera = () => cam3; V.controls = () => controls;
  // zoom for the 3-D view (menu commands)
  V.dolly = f => { const off = cam3.position.clone().sub(controls.target).multiplyScalar(f); cam3.position.copy(controls.target.clone().add(off)); controls.update(); V.need = true; };

  function clearGroup(g) { if (!g) return; g.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { if (o.material.map && o.material.map !== lut) o.material.map.dispose(); o.material.dispose(); } }); root.remove(g); }
  V.clear = () => { clearGroup(field); clearGroup(extras); clearGroup(stl); field = extras = stl = null; V.need = true; };

  // ---- field rendering (2-D T6 or 3-D voxel surface) ----
  // opts: {u (displacement per node, dim comps), scale, values (per node) | null, range [lo, hi], bands, reverse, edges, color}
  V.showField = function (mesh, opts) {
    clearGroup(field); field = new T.Group(); root.add(field);
    const is3 = mesh.kind === 'H8', dim = is3 ? 3 : 2, P = mesh.nodes;
    let tri;   // node index triples
    if (!is3) {
      const E = mesh.elems, ne = E.length / 6; tri = new Int32Array(ne * 12);
      for (let e = 0; e < ne; e++) { const n = i => E[e * 6 + i]; tri.set([n(0), n(3), n(5), n(3), n(1), n(4), n(5), n(4), n(2), n(3), n(4), n(5)], e * 12); }
    } else {
      const Q = mesh.quads.n, nq = Q.length / 4; tri = new Int32Array(nq * 6);
      for (let q = 0; q < nq; q++) tri.set([Q[q * 4], Q[q * 4 + 1], Q[q * 4 + 2], Q[q * 4], Q[q * 4 + 2], Q[q * 4 + 3]], q * 6);
    }
    const nv = tri.length, pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
    const base = new Float32Array(nv * 3), disp = new Float32Array(nv * 3);
    const [lo, hi] = opts.range || [0, 1], span = hi - lo || 1;
    for (let k = 0; k < nv; k++) {
      const n = tri[k];
      for (let c = 0; c < dim; c++) { base[k * 3 + c] = P[n * dim + c]; if (opts.u) disp[k * 3 + c] = opts.u[n * dim + c]; }
      if (opts.values) uv[k * 2] = Math.max(0.0005, Math.min(0.9995, (opts.values[n] - lo) / span));
      uv[k * 2 + 1] = 0.5;
    }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('uv', new T.BufferAttribute(uv, 2));
    let mat;
    if (opts.values) { lut = makeLUT(opts.bands, opts.reverse); mat = is3 ? new T.MeshPhongMaterial({ shininess: 8, specular: 0x222222, map: lut, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }) : new T.MeshBasicMaterial({ map: lut, side: T.DoubleSide }); }
    else mat = is3 ? new T.MeshPhongMaterial({ color: opts.color || 0x9fb3c8, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }) : new T.MeshBasicMaterial({ color: opts.color || 0xc9d6e4, side: T.DoubleSide });
    const mesh3 = new T.Mesh(g, mat); field.add(mesh3);
    // element edges
    let eg = null, ebase = null, edisp = null;
    if (opts.edges) {
      const seen = new Set(), segs = [];
      const add = (a, b) => { const k = a < b ? a + ',' + b : b + ',' + a; if (!seen.has(k)) { seen.add(k); segs.push(a, b); } };
      if (!is3) { const E = mesh.elems; for (let e = 0; e < E.length / 6; e++) { const n = i => E[e * 6 + i]; add(n(0), n(3)); add(n(3), n(1)); add(n(1), n(4)); add(n(4), n(2)); add(n(2), n(5)); add(n(5), n(0)); } }
      else { const Q = mesh.quads.n; for (let q = 0; q < Q.length / 4; q++) for (let j = 0; j < 4; j++) add(Q[q * 4 + j], Q[q * 4 + (j + 1) % 4]); }
      ebase = new Float32Array(segs.length * 3); edisp = new Float32Array(segs.length * 3);
      segs.forEach((n, k) => { for (let c = 0; c < dim; c++) { ebase[k * 3 + c] = P[n * dim + c]; if (opts.u) edisp[k * 3 + c] = opts.u[n * dim + c]; } });
      eg = new T.BufferGeometry(); eg.setAttribute('position', new T.BufferAttribute(new Float32Array(segs.length * 3), 3));
      const lines = new T.LineSegments(eg, new T.LineBasicMaterial({ color: opts.values ? 0x1d2733 : 0x34506e, transparent: true, opacity: opts.values ? 0.35 : 0.75 }));
      lines.renderOrder = 2; field.add(lines);
    }
    field.userData = { g, eg, base, disp, ebase, edisp, tri, is3 };
    V.setDeform(opts.scale || 0);
  };
  V.setDeform = function (s) {
    if (!field) return; const d = field.userData, p = d.g.attributes.position.array;
    for (let i = 0; i < p.length; i++) p[i] = d.base[i] + s * d.disp[i];
    if (!d.is3) for (let i = 2; i < p.length; i += 3) p[i] = 0;
    d.g.attributes.position.needsUpdate = true;
    if (d.is3) { d.g.computeVertexNormals(); }   // non-indexed → flat per-triangle normals
    d.g.computeBoundingSphere();
    if (d.eg) { const q = d.eg.attributes.position.array; for (let i = 0; i < q.length; i++) q[i] = d.ebase[i] + s * d.edisp[i]; if (!d.is3) for (let i = 2; i < q.length; i += 3) q[i] = 0.01; d.eg.attributes.position.needsUpdate = true; d.eg.computeBoundingSphere(); }
    V.need = true;
  };
  V.fieldTris = () => field ? field.userData.tri : null;

  // ---- STL geometry with per-face colours (3-D setup view) ----
  V.showSTL = function (tris, faceOf, faceColor, edges) {
    clearGroup(stl); stl = new T.Group(); root.add(stl);
    const n = tris.length / 9, pos = new Float32Array(tris), col = new Float32Array(n * 9);
    for (let k = 0; k < n; k++) { const c = faceColor(faceOf[k]); for (let j = 0; j < 3; j++) col.set(c, k * 9 + j * 3); }
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('color', new T.BufferAttribute(col, 3)); g.computeVertexNormals();
    stl.add(new T.Mesh(g, new T.MeshPhongMaterial({ vertexColors: true, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })));
    if (edges && edges.length) { const eg = new T.BufferGeometry(); eg.setAttribute('position', new T.BufferAttribute(new Float32Array(edges), 3)); stl.add(new T.LineSegments(eg, new T.LineBasicMaterial({ color: 0x23303e }))); }
    stl.userData = { g, faceOf, faceColor };
    V.need = true;
  };
  V.recolorSTL = function () { if (!stl) return; const { g, faceOf, faceColor } = stl.userData, col = g.attributes.color.array; for (let k = 0; k < faceOf.length; k++) { const c = faceColor(faceOf[k]); for (let j = 0; j < 3; j++) col.set(c, k * 9 + j * 3); } g.attributes.color.needsUpdate = true; V.need = true; };
  V.setSTLVisible = (on, ghost) => { if (!stl) return; stl.visible = on; const m = stl.children[0].material; m.transparent = !!ghost; m.opacity = ghost ? 0.12 : 1; m.depthWrite = !ghost; stl.children[0].visible = !ghost || true; V.need = true; };
  // undeformed wire (3-D results): feature edges only
  V.showExtras = function (edges, color = 0x51657a, opacity = 0.5) {
    clearGroup(extras); extras = null; if (!edges || !edges.length) { V.need = true; return; }
    extras = new T.Group(); const eg = new T.BufferGeometry(); eg.setAttribute('position', new T.BufferAttribute(new Float32Array(edges), 3));
    extras.add(new T.LineSegments(eg, new T.LineBasicMaterial({ color, transparent: true, opacity, depthTest: true }))); root.add(extras); V.need = true;
  };

  // ---- picking (3-D) ----
  V.pick3D = function (ev, what) {
    const r = ovc.getBoundingClientRect(), m = new T.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const rc = new T.Raycaster(); rc.setFromCamera(m, cam3);
    const obj = what === 'stl' ? (stl && stl.visible ? stl.children[0] : null) : (field ? field.children[0] : null); if (!obj) return null;
    const hit = rc.intersectObject(obj, false)[0]; if (!hit) return null;
    return { point: [hit.point.x, hit.point.y, hit.point.z], tri: Math.floor(hit.faceIndex != null ? hit.faceIndex : hit.index / 3) };
  };
})();
