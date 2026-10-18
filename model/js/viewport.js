// Lumen 3D — WebGL viewport (three.js subset): object display with modifiers, shading modes, selection outline,
// edit-mode overlays, light/camera helpers, transform gizmo, picking (BVH for edit mode), view navigation.
(function () {
  'use strict';
  const T = window.THREE, M = window.LMesh, S = window.LScene, PT = window.LPT;
  const V = window.LView = {};
  let renderer, scene, gscene, persp, ortho, camera, controls, cv, grid, axesX, axesY, need = true, app;
  const cache = new Map(); // object id -> {key, group, mesh, wire, outline, helper, evaluated}
  const ORANGE = 0xff8a1f, ACTIVE = 0xffc04a, EDGE = 0x1b1b1b;
  let studio, sceneLights, hemi;
  const texCache = new Map(); // image id -> THREE texture
  const studioMat = new T.MeshStandardMaterial({ color: 0xc4c4c4, roughness: 0.55, metalness: 0, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const wireMat = new T.LineBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.55 });
  const wireOnlyMat = new T.LineBasicMaterial({ color: 0x101820 });
  const wireSelMat = new T.LineBasicMaterial({ color: ORANGE }), wireActMat = new T.LineBasicMaterial({ color: ACTIVE });

  V.init = function (canvas, appRef) {
    cv = canvas; app = appRef;
    renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
    renderer.outputColorSpace = T.SRGBColorSpace; renderer.autoClear = false; renderer.shadowMap.enabled = true;
    renderer.setClearColor(0x000000, 0);
    scene = new T.Scene(); gscene = new T.Scene();
    persp = new T.PerspectiveCamera(40, 1, 0.05, 2000); persp.up.set(0, 0, 1); persp.position.set(9, -11, 7);
    ortho = new T.OrthographicCamera(-5, 5, 5, -5, -1000, 1000); ortho.up.set(0, 0, 1);
    camera = persp;
    studio = new T.Group();
    studio.add(new T.HemisphereLight(0xffffff, 0x5a6270, 1.5));
    const d1 = new T.DirectionalLight(0xffffff, 1.7); d1.position.set(2, -3, 4); studio.add(d1);
    const d2 = new T.DirectionalLight(0xffffff, 0.55); d2.position.set(-3, 2, 1); studio.add(d2);
    scene.add(studio);
    sceneLights = new T.Group(); scene.add(sceneLights);
    grid = new T.GridHelper(40, 40, 0x8d97a3, 0xa9b2bd); grid.rotation.x = Math.PI / 2; grid.material.transparent = true; grid.material.opacity = 0.5; grid.material.depthWrite = false; scene.add(grid);
    const axis = (a, b, c) => { const g = new T.BufferGeometry().setFromPoints([new T.Vector3(...a), new T.Vector3(...b)]); const l = new T.Line(g, new T.LineBasicMaterial({ color: c, transparent: true, opacity: 0.8 })); l.renderOrder = 1; scene.add(l); return l; };
    axesX = axis([-20, 0, 0.0005], [20, 0, 0.0005], 0xd1424f); axesY = axis([0, -20, 0.0005], [0, 20, 0.0005], 0x6aa63c);
    controls = new T.OrbitControls(camera, canvas);
    controls.enableDamping = false; controls.screenSpacePanning = true; controls.zoomToCursor = true;
    controls.mouseButtons = { LEFT: null, MIDDLE: 0, RIGHT: 2 }; // left mouse is selection; middle orbits, right pans
    controls.addEventListener('change', () => { need = true; app.onViewChange && app.onViewChange(); });
    // Alt+left drag (or Shift+middle) for laptops
    canvas.addEventListener('pointerdown', e => {
      if (e.button === 0 && e.altKey && !e.ctrlKey) controls.mouseButtons.LEFT = 0; else controls.mouseButtons.LEFT = null;
      if (e.button === 1 && e.shiftKey) controls.mouseButtons.MIDDLE = 2; else controls.mouseButtons.MIDDLE = 0;
    }, true);
    new ResizeObserver(resize).observe(canvas.parentElement); resize();
    const loop = () => { requestAnimationFrame(loop); if (need) draw(); };
    loop();
  };
  function resize() {
    const r = cv.parentElement.getBoundingClientRect(), w = Math.max(10, r.width), h = Math.max(10, r.height);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.setSize(w, h, false); cv.style.width = w + 'px'; cv.style.height = h + 'px';
    persp.aspect = w / h; persp.updateProjectionMatrix(); updateOrtho(); need = true;
  }
  function updateOrtho() {
    const r = cv.getBoundingClientRect(), asp = r.width / Math.max(1, r.height), d = persp.position.distanceTo(controls ? controls.target : new T.Vector3()) * Math.tan(persp.fov * Math.PI / 360);
    ortho.left = -d * asp; ortho.right = d * asp; ortho.top = d; ortho.bottom = -d; ortho.updateProjectionMatrix();
  }
  V.redraw = () => { need = true; };
  V.camera = () => camera;
  V.canvas = () => cv;
  V.renderer = () => renderer;

  // ---------- object display ----------
  function geomFromMesh(m, smooth, angle) {
    const t = M.toTriangles(m, smooth, angle), g = new T.BufferGeometry();
    g.setAttribute('position', new T.BufferAttribute(t.pos, 3)); g.setAttribute('normal', new T.BufferAttribute(t.nor, 3)); g.setAttribute('uv', new T.BufferAttribute(t.uv, 2));
    g.computeBoundingBox(); g.computeBoundingSphere(); g.userData.tface = t.tface; return g;
  }
  function edgeGeom(m) {
    const es = M.edges(m), p = new Float32Array(es.length * 6);
    es.forEach(([a, b], i) => { p.set(m.v[a], i * 6); p.set(m.v[b], i * 6 + 3); });
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(p, 3)); return g;
  }
  function hullGeom(m) { // smooth-normal indexed geometry for the outline hull
    const vn = M.vertexNormals(m), p = new Float32Array(m.v.length * 3), n = new Float32Array(m.v.length * 3), idx = [];
    m.v.forEach((q, i) => { p.set(q, i * 3); n.set(vn[i], i * 3); });
    m.f.forEach(f => M.triFace(m.v, f).forEach(t => idx.push(f[t[0]], f[t[1]], f[t[2]])));
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(p, 3)); g.setAttribute('normal', new T.BufferAttribute(n, 3)); g.setIndex(idx); return g;
  }
  function outlineMaterial(color) {
    const u = { ow: { value: 0.02 } };
    const mat = new T.MeshBasicMaterial({ color, side: T.BackSide, depthWrite: true });
    mat.onBeforeCompile = sh => { sh.uniforms.ow = u.ow; sh.vertexShader = 'uniform float ow;\n' + sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normalize(normal) * ow;'); };
    mat.userData.u = u; return mat;
  }
  function textureFor(imgId) {
    if (!imgId) return null; if (texCache.has(imgId)) return texCache.get(imgId);
    const im = app.doc.images.find(i => i.id === imgId); if (!im) return null;
    const img = new Image(); const tex = new T.CanvasTexture(img); tex.colorSpace = T.SRGBColorSpace; tex.wrapS = tex.wrapT = 1000; tex.anisotropy = 4;
    img.onload = () => { tex.needsUpdate = true; need = true; }; img.src = im.data;
    texCache.set(imgId, tex); return tex;
  }
  const matCache = new Map();
  function materialFor(o) {
    const m = app.doc.materials.find(x => x.id === o.mat);
    const key = m ? JSON.stringify([m.color, m.metal, m.rough, m.emit, m.emitStrength, m.transmission, m.tex]) : 'none';
    const ck = (m ? m.id : 'none') + key;
    if (matCache.has(ck)) return matCache.get(ck);
    let mat;
    if (!m) mat = new T.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.5, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    else {
      mat = new T.MeshStandardMaterial({ color: new T.Color(m.color), metalness: +m.metal, roughness: +m.rough, emissive: new T.Color(m.emit), emissiveIntensity: +m.emitStrength || 0, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
      if (m.transmission > 0) { mat.transparent = true; mat.opacity = 1 - 0.75 * m.transmission; mat.depthWrite = false; }
      const tx = textureFor(m.tex); if (tx) mat.map = tx;
    }
    matCache.set(ck, mat); return mat;
  }
  V.clearMaterialCache = () => { matCache.forEach(m => m.dispose()); matCache.clear(); };
  V.clearTextures = () => { texCache.forEach(t => t.dispose()); texCache.clear(); };

  function lightHelper(o) {
    const g = new T.Group(), col = new T.Color(o.light.color);
    const ring = []; for (let i = 0; i <= 24; i++) { const a = i / 24 * Math.PI * 2; ring.push(new T.Vector3(Math.cos(a) * 0.18, Math.sin(a) * 0.18, 0)); }
    const mat = new T.LineBasicMaterial({ color: 0x1d1d1d });
    const circ = new T.Line(new T.BufferGeometry().setFromPoints(ring), mat); g.add(circ);
    const circ2 = circ.clone(); circ2.rotation.x = Math.PI / 2; g.add(circ2);
    const dot = new T.Mesh(new T.SphereGeometry(0.07, 12, 8), new T.MeshBasicMaterial({ color: col })); g.add(dot);
    if (o.light.kind === 'sun') { const l = new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0, 0), new T.Vector3(0, 0, -1.6)]), new T.LineDashedMaterial({ color: 0x1d1d1d, dashSize: 0.1, gapSize: 0.06 })); l.computeLineDistances(); g.add(l);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; g.add(new T.Line(new T.BufferGeometry().setFromPoints([new T.Vector3(Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0), new T.Vector3(Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0)]), mat)); } }
    g.userData.lineMat = mat; return g;
  }
  function cameraHelper(o) {
    const g = new T.Group(), f = o.camera.fov * Math.PI / 360, asp = app.doc.render.width / app.doc.render.height, d = 1.2, h = Math.tan(f) * d, w = h * asp;
    const P = [[0, 0, 0], [-w, -h, -d], [w, -h, -d], [w, h, -d], [-w, h, -d]].map(p => new T.Vector3(...p));
    const seg = [0, 1, 0, 2, 0, 3, 0, 4, 1, 2, 2, 3, 3, 4, 4, 1].map(i => P[i]);
    seg.push(new T.Vector3(-w * 0.5, h * 1.1, -d), new T.Vector3(0, h * 1.6, -d), new T.Vector3(0, h * 1.6, -d), new T.Vector3(w * 0.5, h * 1.1, -d), new T.Vector3(w * 0.5, h * 1.1, -d), new T.Vector3(-w * 0.5, h * 1.1, -d));
    const mat = new T.LineBasicMaterial({ color: 0x1d1d1d }); g.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(seg), mat)); g.userData.lineMat = mat; return g;
  }

  // rebuild what changed
  V.sync = function () {
    const doc = app.doc, frame = doc.anim.frame, seen = new Set(), shading = app.shading;
    doc.objects.forEach(o => {
      seen.add(o.id);
      let c = cache.get(o.id);
      const key = o.type === 'mesh' ? [o.mesh, JSON.stringify(o.mods), o.smooth, o.autoSmooth] : JSON.stringify(o.light || o.camera) + (o.type === 'camera' ? doc.render.width / doc.render.height : '');
      const same = c && (o.type === 'mesh' ? c.key[0] === key[0] && c.key[1] === key[1] && c.key[2] === key[2] && c.key[3] === key[3] : c.key === key);
      if (!same) {
        if (c) dispose(c);
        c = { key, group: new T.Group() }; c.group.matrixAutoUpdate = false; c.group.userData.id = o.id;
        if (o.type === 'mesh') {
          const ev = app.editing === o.id && app.liveMesh ? app.liveMesh : S.evalMesh(o);
          c.evaluated = ev; c.geom = geomFromMesh(ev, !!o.smooth, o.autoSmooth ?? 180);
          c.mesh = new T.Mesh(c.geom, studioMat); c.mesh.userData.id = o.id; c.mesh.castShadow = true; c.mesh.receiveShadow = true; c.group.add(c.mesh);
          c.edges = edgeGeom(ev); c.wire = new T.LineSegments(c.edges, wireMat); c.group.add(c.wire);
          c.hull = null;
        } else if (o.type === 'light') { c.helper = lightHelper(o); c.group.add(c.helper); }
        else { c.helper = cameraHelper(o); c.group.add(c.helper); }
        scene.add(c.group); cache.set(o.id, c);
      }
      const mw = S.worldMatrix(o, frame); c.group.matrix.fromArray(mw); c.group.matrixWorldNeedsUpdate = true; c.group.visible = o.visible !== false;
      c.mw = mw;
      if (o.type === 'mesh') {
        const sel = app.sel.has(o.id), act = app.active === o.id, inEdit = app.mode === 'edit' && app.editing === o.id;
        c.mesh.material = shading === 'material' ? materialFor(o) : studioMat;
        const om = app.doc.materials.find(x => x.id === o.mat); c.mesh.castShadow = !(om && om.emitStrength > 0 && om.emit !== '#000000'); c.mesh.visible = shading !== 'wire';
        c.wire.visible = shading === 'wire' || app.showWire || (sel && shading === 'wire');
        c.wire.material = shading === 'wire' ? (act ? wireActMat : sel ? wireSelMat : wireOnlyMat) : wireMat;
        // outline hull for selected objects in object mode
        const wantHull = sel && !inEdit && shading !== 'wire';
        if (wantHull && !c.hull) { c.hullGeom = hullGeom(c.evaluated); c.hull = new T.Mesh(c.hullGeom, outlineMaterial(act ? ACTIVE : ORANGE)); c.hull.onBeforeRender = hullUpdate; c.group.add(c.hull); }
        if (c.hull) { c.hull.visible = wantHull; c.hull.material.color.setHex(act ? ACTIVE : ORANGE); }
      } else if (c.helper) {
        const sel = app.sel.has(o.id), act = app.active === o.id; c.helper.userData.lineMat.color.setHex(act ? ACTIVE : sel ? ORANGE : 0x1d1d1d);
        c.helper.visible = !app.rendering;
      }
    });
    cache.forEach((c, id) => { if (!seen.has(id)) { dispose(c); cache.delete(id); } });
    syncLights(); need = true;
  };
  function hullUpdate(r, s, cam) {
    const wp = new T.Vector3().setFromMatrixPosition(this.matrixWorld), sc = new T.Vector3().setFromMatrixScale(this.matrixWorld), avg = (Math.abs(sc.x) + Math.abs(sc.y) + Math.abs(sc.z)) / 3 || 1;
    const px = cam.isOrthographicCamera ? (cam.top - cam.bottom) / cam.zoom / cv.clientHeight : 2 * cam.position.distanceTo(wp) * Math.tan(cam.fov * Math.PI / 360) / cv.clientHeight;
    this.material.userData.u.ow.value = px * 1.6 / avg;
  }
  function dispose(c) {
    scene.remove(c.group);
    c.group.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material && x.material !== studioMat && x.material !== wireMat && !matCacheHas(x.material) && x.material !== wireOnlyMat && x.material !== wireSelMat && x.material !== wireActMat) x.material.dispose && x.material.dispose(); });
  }
  const matCacheHas = m => { for (const v of matCache.values()) if (v === m) return true; return false; };
  // forget a cached object so it is rebuilt (used for live edit previews)
  V.invalidate = id => { const c = cache.get(id); if (c) { dispose(c); cache.delete(id); } };

  function syncLights() {
    sceneLights.clear();
    const material = app.shading === 'material', doc = app.doc, frame = doc.anim.frame;
    const lights = doc.objects.filter(o => o.type === 'light' && o.visible);
    studio.visible = !material || !lights.length;
    scene.environment = material ? envTexture(doc, lights, frame) : null;
    if (material) {
      const w = doc.world, s = +w.strength || 0; scene.environmentIntensity = 1;
      if (w.mode !== 'sky') sceneLights.add(new T.AmbientLight(new T.Color(w.color), 0.4 * s));
      const bb = sceneBox();
      lights.forEach(o => {
        const m = S.worldMatrix(o, frame), col = new T.Color(o.light.color);
        if (o.light.kind === 'sun') {
          const d = new T.DirectionalLight(col, +o.light.strength || 0), dir = S.xdir(m, [0, 0, -1]), c = bb.getCenter(new T.Vector3()), r = Math.max(2, bb.getSize(new T.Vector3()).length() / 2);
          d.position.set(c.x - dir[0] * r * 2, c.y - dir[1] * r * 2, c.z - dir[2] * r * 2); d.target.position.copy(c); sceneLights.add(d.target);
          d.castShadow = true; d.shadow.mapSize.set(2048, 2048); const sc = d.shadow.camera; sc.left = -r; sc.right = r; sc.top = r; sc.bottom = -r; sc.near = 0.1; sc.far = r * 5; sc.updateProjectionMatrix(); d.shadow.bias = -0.0005; d.shadow.normalBias = 0.02;
          sceneLights.add(d);
        } else sceneLights.add(pointLight(col, (+o.light.power || 0) / (4 * Math.PI * Math.PI), [m[12], m[13], m[14]]));
      });
    }
  }
  // equirectangular environment from the world settings (plus bright spots for lights) so metals reflect something
  let envTex = null, envKey = '';
  function envTexture(doc, lights, frame) {
    const w = doc.world, key = JSON.stringify([w, lights.map(o => [o.light, S.worldMatrix(o, frame)])]);
    if (envTex && envKey === key) return envTex;
    const W = 256, H = 128, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), s = Math.min(1.5, +w.strength || 0);
    const col = h => { const [r, gg, b] = S.hexToRgb(h); return `rgb(${Math.round(r * 255 * s)},${Math.round(gg * 255 * s)},${Math.round(b * 255 * s)})`; };
    if (w.mode === 'sky') { const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, col(w.zenith)); gr.addColorStop(0.48, col(w.horizon)); gr.addColorStop(0.52, col(w.ground)); gr.addColorStop(1, col(w.ground)); g.fillStyle = gr; }
    else g.fillStyle = col(w.color);
    g.fillRect(0, 0, W, H);
    // lights as soft spots; three's equirect u runs with atan2(dir.z, dir.x) in its Y-up frame
    lights.forEach(o => {
      const m = S.worldMatrix(o, frame); let d = o.light.kind === 'sun' ? S.xdir(m, [0, 0, -1]).map(x => -x) : [m[12], m[13], m[14]];
      const l = Math.hypot(...d) || 1; d = d.map(x => x / l); const yup = [d[0], d[2], -d[1]];
      const u = 0.5 + Math.atan2(yup[2], yup[0]) / (2 * Math.PI), v = Math.acos(Math.max(-1, Math.min(1, yup[1]))) / Math.PI;
      const px = (1 - u) * W, py = v * H, r = o.light.kind === 'sun' ? 10 : 7, rg = g.createRadialGradient(px, py, 0, px, py, r);
      rg.addColorStop(0, 'rgba(255,255,255,1)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = rg; g.fillRect(px - r, py - r, 2 * r, 2 * r);
    });
    if (envTex) envTex.dispose();
    envTex = new T.CanvasTexture(c); envTex.mapping = 303; envTex.colorSpace = T.SRGBColorSpace; envKey = key; return envTex;
  }
  // the vendored three.js subset has no PointLight class; the renderer supports point lights, so build a compatible object
  function pointLight(color, intensity, pos) {
    const l = new T.Group(); l.isLight = true; l.isPointLight = true; l.type = 'PointLight'; l.color = color; l.intensity = intensity; l.distance = 0; l.decay = 2; l.castShadow = false;
    l.shadow = { camera: new T.PerspectiveCamera(90, 1, 0.5, 500), bias: 0, normalBias: 0, radius: 1, mapSize: new T.Vector2(512, 512), map: null, matrix: new T.Matrix4(), updateMatrices() {}, getFrustum() {}, autoUpdate: false, needsUpdate: false };
    l.position.set(...pos); return l;
  }
  function sceneBox() {
    const bb = new T.Box3(); cache.forEach(c => { if (c.mesh && c.group.visible) { c.group.updateMatrixWorld(true); const b = c.geom.boundingBox.clone().applyMatrix4(c.group.matrixWorld); bb.union(b); } });
    if (bb.isEmpty()) bb.set(new T.Vector3(-2, -2, -1), new T.Vector3(2, 2, 2)); return bb;
  }
  V.sceneBox = sceneBox;
  V.objectBox = id => { const c = cache.get(id); if (!c) return null; c.group.updateMatrixWorld(true); if (c.mesh) return c.geom.boundingBox.clone().applyMatrix4(c.group.matrixWorld); const p = new T.Vector3().setFromMatrixPosition(c.group.matrixWorld); return new T.Box3(p.clone().subScalar(0.5), p.clone().addScalar(0.5)); };

  // ---------- edit-mode overlay ----------
  let editGroup = null, cageBVH = null, cageFaceOf = null, editState = null;
  V.setEdit = function (o, mesh, sel, selMode) {
    if (editGroup) { scene.remove(editGroup); editGroup.traverse(x => { if (x.geometry) x.geometry.dispose(); if (x.material) x.material.dispose(); }); editGroup = null; }
    cageBVH = null; editState = null;
    if (!o || !mesh) { need = true; return; }
    editState = { o, mesh, sel, selMode };
    editGroup = new T.Group(); editGroup.matrixAutoUpdate = false; editGroup.matrix.fromArray(S.worldMatrix(o, app.doc.anim.frame));
    // edges
    const es = M.edges(mesh), ep = new Float32Array(es.length * 6), ec = new Float32Array(es.length * 6);
    const cs = [0.1, 0.1, 0.1], co = [1, 0.54, 0.12];
    es.forEach(([a, b], i) => { ep.set(mesh.v[a], i * 6); ep.set(mesh.v[b], i * 6 + 3); const s = sel.E.has(M.ekey(a, b)), c = s ? co : cs, ca = selMode === 'vert' && sel.V.has(a) ? co : c, cb = selMode === 'vert' && sel.V.has(b) ? co : c; ec.set(ca, i * 6); ec.set(cb, i * 6 + 3); });
    const eg = new T.BufferGeometry(); eg.setAttribute('position', new T.BufferAttribute(ep, 3)); eg.setAttribute('color', new T.BufferAttribute(ec, 3));
    const lines = new T.LineSegments(eg, new T.LineBasicMaterial({ vertexColors: true, depthTest: !app.xray, transparent: true, opacity: 0.95 })); lines.renderOrder = 3; editGroup.add(lines);
    // vertices
    if (selMode === 'vert') {
      const vp = new Float32Array(mesh.v.length * 3), vc = new Float32Array(mesh.v.length * 3);
      mesh.v.forEach((p, i) => { vp.set(p, i * 3); vc.set(sel.V.has(i) ? co : [0.05, 0.05, 0.05], i * 3); });
      const vg = new T.BufferGeometry(); vg.setAttribute('position', new T.BufferAttribute(vp, 3)); vg.setAttribute('color', new T.BufferAttribute(vc, 3));
      const pts = new T.Points(vg, new T.PointsMaterial({ size: 6, sizeAttenuation: false, vertexColors: true, depthTest: !app.xray })); pts.renderOrder = 4; editGroup.add(pts);
    }
    // selected faces tint
    if (sel.F.size) {
      const fm = { v: mesh.v, f: [...sel.F].map(i => mesh.f[i]).filter(Boolean), uv: null }; fm.uv = fm.f.map(() => null);
      const g = geomFromMesh(fm, false, 180); const fmesh = new T.Mesh(g, new T.MeshBasicMaterial({ color: ORANGE, transparent: true, opacity: 0.28, side: T.DoubleSide, depthWrite: false, depthTest: !app.xray, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 })); fmesh.renderOrder = 2; editGroup.add(fmesh);
    }
    // face dots in face mode
    if (selMode === 'face') {
      const fp = new Float32Array(mesh.f.length * 3), fc = new Float32Array(mesh.f.length * 3);
      mesh.f.forEach((f, i) => { fp.set(M.faceCenter(mesh, f), i * 3); fc.set(sel.F.has(i) ? co : [0.1, 0.1, 0.1], i * 3); });
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(fp, 3)); g.setAttribute('color', new T.BufferAttribute(fc, 3));
      const pts = new T.Points(g, new T.PointsMaterial({ size: 4, sizeAttenuation: false, vertexColors: true, depthTest: !app.xray })); pts.renderOrder = 4; editGroup.add(pts);
    }
    scene.add(editGroup); need = true;
  };
  V.updateEditMatrix = () => { if (editGroup && editState) { editGroup.matrix.fromArray(S.worldMatrix(editState.o, app.doc.anim.frame)); editGroup.matrixWorldNeedsUpdate = true; need = true; } };
  function ensureBVH() {
    if (cageBVH || !editState) return;
    const t = M.toTriangles(editState.mesh, false), b = PT.buildBVH(t.pos, t.count), P = new Float32Array(t.count * 9), F = new Int32Array(t.count);
    for (let i = 0; i < t.count; i++) { const s = b.idx[i]; P.set(t.pos.subarray(s * 9, s * 9 + 9), i * 9); F[i] = t.tface[s]; }
    cageBVH = { bvh: b, P }; cageFaceOf = F;
  }
  V.dropBVH = () => { cageBVH = null; };

  // ---------- picking ----------
  function ndc(ev) { const r = cv.getBoundingClientRect(); return new T.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1); }
  V.ray = ev => { const rc = new T.Raycaster(); rc.setFromCamera(ndc(ev), camera); return rc.ray; };
  V.project = p => { const r = cv.getBoundingClientRect(); const v = new T.Vector3(...p).project(camera); return [(v.x + 1) / 2 * r.width, (1 - v.y) / 2 * r.height, v.z]; };
  V.mouse = ev => { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  V.pickObject = function (ev) {
    const rc = new T.Raycaster(); rc.setFromCamera(ndc(ev), camera); rc.params.Line.threshold = 0.05;
    const meshes = []; cache.forEach(c => { if (c.mesh && c.group.visible) meshes.push(c.mesh); });
    scene.updateMatrixWorld(true);
    const hit = rc.intersectObjects(meshes, false)[0];
    // lights and cameras by screen distance to their origin
    const [mx, my] = V.mouse(ev); let best = null, bd = 14;
    app.doc.objects.forEach(o => { if (o.type === 'mesh' || !o.visible) return; const c = cache.get(o.id); if (!c) return; const p = V.project([c.mw[12], c.mw[13], c.mw[14]]); if (p[2] > 1) return; const d = Math.hypot(p[0] - mx, p[1] - my); if (d < bd) { bd = d; best = o.id; } });
    if (best) return best;
    return hit ? hit.object.userData.id : null;
  };
  // world matrix of the edited object as THREE.Matrix4
  const editMW = () => new T.Matrix4().fromArray(S.worldMatrix(editState.o, app.doc.anim.frame));
  function rayLocal(ev) { const ray = V.ray(ev).clone(), inv = editMW().invert(); ray.applyMatrix4(inv); return ray; }
  function occluded(pLocal, mw, inv) {
    if (app.xray) return false; ensureBVH();
    const camLocal = (camera.isOrthographicCamera ? new T.Vector3(...pLocal).applyMatrix4(mw).add(camera.getWorldDirection(new T.Vector3()).multiplyScalar(-1000)) : camera.position.clone()).applyMatrix4(inv);
    const d = new T.Vector3(...pLocal).sub(camLocal), L = d.length(); d.normalize();
    if (!PT.intersect(cageBVH, camLocal.x, camLocal.y, camLocal.z, d.x, d.y, d.z, L * (1 - 1e-4) - 1e-4, true)) return false;
    return PT.hit.t < L - Math.max(1e-4, L * 1e-3);
  }
  V.pickEdit = function (ev, selMode) {
    if (!editState) return null; const mesh = editState.mesh, [mx, my] = V.mouse(ev), mw = editMW(), inv = mw.clone().invert();
    const scr = p => { const v = new T.Vector3(...p).applyMatrix4(mw).project(camera); const r = cv.getBoundingClientRect(); return [(v.x + 1) / 2 * r.width, (1 - v.y) / 2 * r.height, v.z]; };
    if (selMode === 'vert') {
      const cand = [];
      mesh.v.forEach((p, i) => { const s = scr(p); if (s[2] > 1) return; const d = Math.hypot(s[0] - mx, s[1] - my); if (d < 12) cand.push([d, i]); });
      cand.sort((a, b) => a[0] - b[0]);
      for (const [, i] of cand.slice(0, 12)) if (!occluded(mesh.v[i], mw, inv)) return { v: i };
      return null;
    }
    if (selMode === 'edge') {
      const es = M.edges(mesh), cand = [];
      es.forEach(([a, b]) => {
        const A = scr(mesh.v[a]), B = scr(mesh.v[b]); if (A[2] > 1 || B[2] > 1) return;
        const dx = B[0] - A[0], dy = B[1] - A[1], L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, ((mx - A[0]) * dx + (my - A[1]) * dy) / L2)) : 0;
        const d = Math.hypot(mx - A[0] - t * dx, my - A[1] - t * dy); if (d < 10) cand.push([d, a, b, t]);
      });
      cand.sort((x, y) => x[0] - y[0]);
      for (const [, a, b, t] of cand.slice(0, 12)) { const mid = M.vec.lerp(mesh.v[a], mesh.v[b], Math.max(0.05, Math.min(0.95, t))); if (!occluded(mid, mw, inv)) return { e: M.ekey(a, b), a, b, t }; }
      return null;
    }
    ensureBVH(); const r = rayLocal(ev);
    if (PT.intersect(cageBVH, r.origin.x, r.origin.y, r.origin.z, r.direction.x, r.direction.y, r.direction.z, 1e30, false)) return { f: cageFaceOf[PT.hit.tri], t: PT.hit.t };
    return null;
  };
  // hit position on the edited cage (local space) for loop cut preview etc.
  V.box = function (x0, y0, x1, y1, selMode) {
    if (!editState) return []; const mesh = editState.mesh, mw = editMW(), inv = mw.clone().invert(), r = cv.getBoundingClientRect();
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1);
    const inside = p => { const v = new T.Vector3(...p).applyMatrix4(mw).project(camera); if (v.z > 1) return false; const sx = (v.x + 1) / 2 * r.width, sy = (1 - v.y) / 2 * r.height; return sx >= lx && sx <= hx && sy >= ly && sy <= hy; };
    if (selMode === 'face') return mesh.f.map((f, i) => i).filter(i => { const c = M.faceCenter(mesh, mesh.f[i]); return inside(c) && !occluded(c, mw, inv); });
    const vin = mesh.v.map((p, i) => inside(p) && !occluded(p, mw, inv));
    if (selMode === 'vert') return mesh.v.map((_, i) => i).filter(i => vin[i]);
    return M.edges(mesh).filter(([a, b]) => vin[a] && vin[b]).map(([a, b]) => M.ekey(a, b));
  };
  V.boxObjects = function (x0, y0, x1, y1) {
    const lx = Math.min(x0, x1), hx = Math.max(x0, x1), ly = Math.min(y0, y1), hy = Math.max(y0, y1), out = [];
    app.doc.objects.forEach(o => {
      if (!o.visible) return; const c = cache.get(o.id); if (!c) return;
      let pts;
      if (c.mesh) { const ev = c.evaluated; const step = Math.max(1, Math.floor(ev.v.length / 400)); pts = []; for (let i = 0; i < ev.v.length; i += step) pts.push(S.xform(c.mw, ev.v[i])); }
      else pts = [[c.mw[12], c.mw[13], c.mw[14]]];
      if (pts.some(p => { const s = V.project(p); return s[2] <= 1 && s[0] >= lx && s[0] <= hx && s[1] >= ly && s[1] <= hy; })) out.push(o.id);
    });
    return out;
  };

  // ---------- overlays: box rectangle, loop-cut preview ----------
  let preview = null;
  V.setPreview = function (segsWorld, color = 0xffe14a) {
    if (preview) { scene.remove(preview); preview.geometry.dispose(); preview.material.dispose(); preview = null; }
    if (segsWorld && segsWorld.length) { const p = new Float32Array(segsWorld.length * 3); segsWorld.forEach((q, i) => p.set(q, i * 3)); const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(p, 3)); preview = new T.LineSegments(g, new T.LineBasicMaterial({ color, depthTest: false })); preview.renderOrder = 9; scene.add(preview); }
    need = true;
  };

  // ---------- gizmo ----------
  const gizmo = new T.Group(); let gizmoMode = null; const handles = [];
  const AX = [[1, 0, 0], [0, 1, 0], [0, 0, 1]], AXC = [0xe8414f, 0x6cc644, 0x3d8cf0];
  function solid(mesh, color, opacity = 1) { const g = geomFromMesh(mesh, true, 60); return new T.Mesh(g, new T.MeshBasicMaterial({ color, depthTest: false, depthWrite: false, transparent: true, opacity, side: T.DoubleSide })); }
  function along(meshData, axis, offset) { // orient a +Z primitive along axis and move it
    const rot = axis === 0 ? (p => [p[2], p[1], -p[0]]) : axis === 1 ? (p => [p[0], p[2], -p[1]]) : (p => p);
    return { v: meshData.v.map(p => { const q = rot(p); return [q[0] + AX[axis][0] * offset, q[1] + AX[axis][1] * offset, q[2] + AX[axis][2] * offset]; }), f: meshData.f, uv: meshData.uv };
  }
  function buildGizmo(mode) {
    gizmo.clear(); handles.length = 0; gizmoMode = mode;
    const add = (obj, id, axis, color) => { obj.userData = { id, axis, color }; obj.renderOrder = 10; gizmo.add(obj); handles.push(obj); return obj; };
    if (mode === 'move' || mode === 'scale') {
      for (let a = 0; a < 3; a++) {
        add(solid(along(M.cylinder(8, 0.018, 0.8), a, 0.5), AXC[a]), (mode === 'move' ? 'm' : 's') + a, a, AXC[a]);
        add(mode === 'move' ? solid(along(M.cone(16, 0.07, 0, 0.24), a, 1.0), AXC[a]) : solid(along(M.cube(0.07), a, 0.98), AXC[a]), (mode === 'move' ? 'm' : 's') + a, a, AXC[a]);
        // hit helper (invisible fat shaft)
        const hitm = solid(along(M.cylinder(6, 0.09, 1.0), a, 0.64), 0xffffff, 0); hitm.material.visible = false; add(hitm, (mode === 'move' ? 'm' : 's') + a, a, AXC[a]);
        // plane handles
        const b = (a + 1) % 3, c = (a + 2) % 3, q = 0.28, s = 0.12;
        const pl = M.make([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]].map((p, i) => { const r = [0, 0, 0]; r[b] = q + (i === 1 || i === 2 ? s : 0); r[c] = q + (i >= 2 ? s : 0); return r; }), [[0, 1, 2, 3]]);
        add(solid(pl, AXC[a], 0.6), (mode === 'move' ? 'mp' : 'sp') + a, a, AXC[a]);
      }
      add(solid(mode === 'move' ? M.uvSphere(12, 8, 0.07) : M.cube(0.06), 0xf2f2f2, 0.85), mode === 'move' ? 'mv' : 'su', -1, 0xf2f2f2);
    } else if (mode === 'rotate') {
      for (let a = 0; a < 3; a++) {
        const tor = M.torus(0.9, 0.014, 64, 6), ring = along(tor, a, 0); add(solid(ring, AXC[a]), 'r' + a, a, AXC[a]);
        const hit = solid(along(M.torus(0.9, 0.07, 48, 6), a, 0), 0xffffff, 0); hit.material.visible = false; add(hit, 'r' + a, a, AXC[a]);
      }
      const view = solid(M.torus(1.08, 0.012, 64, 6), 0xf2f2f2, 0.8); view.userData.billboard = true; add(view, 'rv', -1, 0xf2f2f2);
      const vh = solid(M.torus(1.08, 0.06, 48, 6), 0xffffff, 0); vh.material.visible = false; vh.userData.billboard = true; add(vh, 'rv', -1, 0xf2f2f2);
      const ball = solid(M.uvSphere(24, 12, 0.86), 0x8090a0, 0.06); ball.userData = {}; gizmo.add(ball);
    }
    gscene.add(gizmo);
  }
  V.setGizmo = function (mode, pos, quat) {
    if (!mode || !pos) { gizmo.visible = false; need = true; return; }
    if (mode !== gizmoMode) buildGizmo(mode);
    gizmo.visible = true; gizmo.position.set(...pos); gizmo.quaternion.set(...(quat || [0, 0, 0, 1])); need = true;
  };
  V.gizmoHighlight = function (id) { handles.forEach(h => { if (h.material.visible === false) return; h.material.color.setHex(h.userData.id === id ? 0xffe14a : h.userData.color); }); need = true; };
  function gizmoScale() { if (!gizmo.visible) return 1; if (camera.isOrthographicCamera) return (camera.top - camera.bottom) / camera.zoom * 0.11; return camera.position.distanceTo(gizmo.position) * Math.tan(camera.fov * Math.PI / 360) * 0.26; }
  V.hitGizmo = function (ev) {
    if (!gizmo.visible) return null; updateGizmoTransform(); gizmo.updateMatrixWorld(true);
    const rc = new T.Raycaster(); rc.setFromCamera(ndc(ev), camera);
    const vis = handles.filter(h => h.visible); const prev = vis.map(h => h.material.visible); vis.forEach(h => h.material.visible = true);
    const hit = rc.intersectObjects(vis, false)[0]; vis.forEach((h, i) => h.material.visible = prev[i]);
    return hit ? hit.object.userData.id : null;
  };
  function updateGizmoTransform() {
    const s = gizmoScale(); gizmo.scale.setScalar(s);
    // hide axis handles pointing straight at the viewer
    const dir = camera.isOrthographicCamera ? camera.getWorldDirection(new T.Vector3()).negate() : camera.position.clone().sub(gizmo.position).normalize();
    handles.forEach(h => {
      if (h.userData.billboard) { h.quaternion.copy(gizmo.quaternion.clone().invert().multiply(camera.quaternion)); return; }
      if (h.userData.axis >= 0 && gizmoMode !== 'rotate') { const a = new T.Vector3(...AX[h.userData.axis]).applyQuaternion(gizmo.quaternion); const d = Math.abs(a.dot(dir)); h.visible = /p/.test(h.userData.id) ? d > 0.2 : d < 0.985; }
    });
  }
  V.gizmoScale = () => gizmoScale();
  V.gizmoAxis = a => new T.Vector3(...AX[a]).applyQuaternion(gizmo.quaternion);
  V.viewDir = () => camera.getWorldDirection(new T.Vector3());

  // ---------- views ----------
  V.target = () => controls.target;
  V.isOrtho = () => camera === ortho;
  V.setView = function (name, bb) {
    bb = bb || sceneBox(); const c = bb.getCenter(new T.Vector3()), size = Math.max(2, bb.getSize(new T.Vector3()).length());
    const dist = camera === ortho ? size * 2 : size * 1.9;
    const dirs = { front: [0, -1, 0], back: [0, 1, 0], right: [1, 0, 0], left: [-1, 0, 0], top: [0, 0, 1], bottom: [0, 0, -1], persp: [0.62, -0.76, 0.48] };
    const dv = new T.Vector3(...(dirs[name] || dirs.persp)).normalize().multiplyScalar(dist);
    controls.target.copy(c); persp.position.copy(c).add(dv); ortho.position.copy(persp.position);
    if (name === 'top' || name === 'bottom') { persp.up.set(0, 1, 0); ortho.up.set(0, 1, 0); } else { persp.up.set(0, 0, 1); ortho.up.set(0, 0, 1); }
    persp.lookAt(c); ortho.lookAt(c); updateOrtho(); ortho.zoom = 1; ortho.updateProjectionMatrix(); controls.update();
    persp.up.set(0, 0, 1); ortho.up.set(0, 0, 1); need = true;
  };
  V.frame = function (bb) { // keep direction, fit box
    if (!bb || bb.isEmpty()) return; const c = bb.getCenter(new T.Vector3()), size = Math.max(0.5, bb.getSize(new T.Vector3()).length());
    const dir = camera.position.clone().sub(controls.target).normalize(), dist = size / 2 / Math.tan(persp.fov * Math.PI / 360) * 1.15;
    controls.target.copy(c); persp.position.copy(c).add(dir.multiplyScalar(dist)); ortho.position.copy(persp.position); updateOrtho(); ortho.zoom = 1; ortho.updateProjectionMatrix(); controls.update(); need = true;
  };
  V.toggleOrtho = function () {
    if (camera === persp) { ortho.position.copy(persp.position); ortho.quaternion.copy(persp.quaternion); updateOrtho(); ortho.zoom = 1; ortho.updateProjectionMatrix(); camera = ortho; }
    else { persp.position.copy(ortho.position); persp.quaternion.copy(ortho.quaternion); const d = persp.position.distanceTo(controls.target) / ortho.zoom; persp.position.copy(controls.target).add(persp.position.clone().sub(controls.target).normalize().multiplyScalar(d)); camera = persp; }
    controls.object = camera; controls.update(); need = true; return camera === ortho;
  };
  V.lookThrough = function (cam) { // align the viewport with a camera {pos, dir, up, fov}
    if (camera === ortho) V.toggleOrtho();
    persp.position.set(...cam.pos); persp.fov = cam.fov; persp.updateProjectionMatrix();
    const t = new T.Vector3(...cam.pos).add(new T.Vector3(...cam.dir).multiplyScalar(cam.focus || 8));
    controls.target.copy(t); persp.up.set(...cam.up); persp.lookAt(t); persp.up.set(0, 0, 1); need = true;
  };
  V.viewCamera = () => ({ pos: camera.position.toArray(), dir: camera.getWorldDirection(new T.Vector3()).toArray(), up: new T.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).toArray(), fov: persp.fov, aperture: 0, focus: camera.position.distanceTo(controls.target) });
  V.resetFov = () => { persp.fov = 40; persp.updateProjectionMatrix(); need = true; };
  V.setGrid = on => { grid.visible = axesX.visible = axesY.visible = on; need = true; };

  function draw() {
    need = false; if (camera === ortho) { /* keep ortho frustum with zoom */ }
    updateGizmoTransform();
    renderer.clear(); renderer.render(scene, camera); renderer.clearDepth(); if (gizmo.visible) renderer.render(gscene, camera);
  }
  V.snapshot = () => { draw(); return cv; };
})();
