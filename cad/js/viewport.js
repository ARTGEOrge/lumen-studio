// Lumen CAD 3D viewport (three.js): shaded body with edges, tool preview, section plane, picking.
(function () {
  const T = window.THREE;
  let renderer, scene, camera, controls, body, edges, ghost, grid, axes, cv, clip, markers;
  const mat = new T.MeshStandardMaterial({ color: 0xb9c6d4, metalness: 0.25, roughness: 0.45, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const edgeMat = new T.LineBasicMaterial({ color: 0x24313f });
  const ghostMat = new T.MeshBasicMaterial({ color: 0xff8a1f, transparent: true, opacity: 0.28, depthWrite: false, side: T.DoubleSide });
  let need = true;

  function geomOf(tris) {
    const pos = new Float32Array(tris.length * 9), nor = new Float32Array(tris.length * 9);
    tris.forEach((t, i) => {
      const [a, b, c] = t, ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 3; k++) { pos.set(t[k], i * 9 + k * 3); nor.set([nx, ny, nz], i * 9 + k * 3); }
    });
    const g = new T.BufferGeometry(); g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('normal', new T.BufferAttribute(nor, 3)); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
  function init(canvas) {
    cv = canvas;
    renderer = new T.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true }); renderer.outputColorSpace = T.SRGBColorSpace; renderer.localClippingEnabled = true;
    renderer.setClearColor(0x000000, 0);
    scene = new T.Scene();
    camera = new T.PerspectiveCamera(35, 1, 0.5, 20000); camera.up.set(0, 0, 1); camera.position.set(160, -200, 140);
    scene.add(new T.HemisphereLight(0xffffff, 0x6d7d90, 1.6));
    const d1 = new T.DirectionalLight(0xffffff, 1.6); d1.position.set(1, -1.4, 2); scene.add(d1);
    const d2 = new T.DirectionalLight(0xffffff, 0.6); d2.position.set(-1.5, 1, 0.5); scene.add(d2);
    grid = new T.GridHelper(400, 40, 0x7f93ab, 0xa9b9cc); grid.rotation.x = Math.PI / 2; grid.material.transparent = true; grid.material.opacity = 0.55; scene.add(grid);
    markers = new T.Group(); scene.add(markers);
    controls = new T.OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = 0.12; controls.screenSpacePanning = true;
    controls.addEventListener('change', () => need = true);
    new ResizeObserver(resize).observe(canvas.parentElement); resize();
    const loop = () => { requestAnimationFrame(loop); if (controls.update() || need) { renderer.render(scene, camera); need = false; } };
    loop();
  }
  function resize() { const r = cv.parentElement.getBoundingClientRect(); renderer.setPixelRatio(window.devicePixelRatio || 1); renderer.setSize(Math.max(10, r.width), Math.max(10, r.height), false); cv.style.width = r.width + 'px'; cv.style.height = r.height + 'px'; camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); need = true; }

  function setBody(solid, showEdges) {
    if (body) { scene.remove(body); body.geometry.dispose(); } if (edges) { scene.remove(edges); edges.geometry.dispose(); }
    const g = geomOf(solid.triangles()); body = new T.Mesh(g, mat); scene.add(body);
    const fe = window.CadKernel.featureEdges(solid, 28), ep = new Float32Array(fe.length * 6); fe.forEach((e, i) => { ep.set(e[0], i * 6); ep.set(e[1], i * 6 + 3); });
    const eg = new T.BufferGeometry(); eg.setAttribute('position', new T.BufferAttribute(ep, 3));
    edges = new T.LineSegments(eg, edgeMat); edges.visible = showEdges; scene.add(edges);
    need = true; return g.boundingBox;
  }
  function setGhost(solid) {
    if (ghost) { scene.remove(ghost); ghost.geometry.dispose(); ghost = null; }
    if (solid && solid.polys.length) { ghost = new T.Mesh(geomOf(solid.triangles()), ghostMat); ghost.renderOrder = 2; scene.add(ghost); }
    need = true;
  }
  function setEdges(on) { if (edges) edges.visible = on; need = true; }
  function setSection(on, axis, t) {
    if (!on || !body) { mat.clippingPlanes = []; edgeMat.clippingPlanes = []; need = true; return; }
    const bb = body.geometry.boundingBox, k = { X: 'x', Y: 'y', Z: 'z' }[axis], v = bb.min[k] + (bb.max[k] - bb.min[k]) * t;
    const n = new T.Vector3(axis === 'X' ? -1 : 0, axis === 'Y' ? -1 : 0, axis === 'Z' ? -1 : 0);
    clip = new T.Plane(n, v); mat.clippingPlanes = [clip]; edgeMat.clippingPlanes = [clip]; mat.needsUpdate = true; edgeMat.needsUpdate = true; need = true;
  }
  function view(name, bb) {
    bb = bb || (body && body.geometry.boundingBox); if (!bb) return;
    const c = new T.Vector3(); bb.getCenter(c); const size = bb.getSize(new T.Vector3()).length() || 100, dist = size * 1.9;
    const dir = { iso: [1, -1.25, 0.9], front: [0, -1, 0.0001], top: [0, -0.0001, 1], right: [1, 0, 0.0001] }[name] || [1, -1.25, 0.9];
    const v = new T.Vector3(...dir).normalize().multiplyScalar(dist);
    camera.position.copy(c.clone().add(v)); controls.target.copy(c); camera.near = size / 200; camera.far = size * 50; camera.updateProjectionMatrix(); controls.update();
    grid.position.set(Math.round(c.x / 10) * 10, Math.round(c.y / 10) * 10, bb.min.z - 0.01); need = true;
  }
  function pick(ev) {
    if (!body) return null; const r = cv.getBoundingClientRect();
    const m = new T.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    const rc = new T.Raycaster(); rc.setFromCamera(m, camera); const hit = rc.intersectObject(body, false)[0];
    return hit ? [hit.point.x, hit.point.y, hit.point.z] : null;
  }
  function mark(points) {
    markers.clear(); const bb = body && body.geometry.boundingSphere, s = bb ? bb.radius / 90 : 1;
    points.forEach(p => { const m = new T.Mesh(new T.SphereGeometry(s, 12, 8), new T.MeshBasicMaterial({ color: 0xd0202a, depthTest: false })); m.position.set(...p); m.renderOrder = 5; markers.add(m); });
    if (points.length === 2) { const g = new T.BufferGeometry().setFromPoints(points.map(p => new T.Vector3(...p))); const l = new T.Line(g, new T.LineBasicMaterial({ color: 0xd0202a, depthTest: false })); l.renderOrder = 5; markers.add(l); }
    need = true;
  }
  function snapshot() { renderer.render(scene, camera); return cv; }
  window.CadView = { init, setBody, setGhost, setEdges, setSection, view, pick, mark, snapshot, redraw: () => need = true };
})();
