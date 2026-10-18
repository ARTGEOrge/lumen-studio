// Lumen 3D — the "Open Sample" scene: a studio still life that shows modifiers, PBR materials, a texture,
// lights, a camera and a short keyframed animation.
(function () {
  'use strict';
  const M = window.LMesh, S = window.LScene;
  // rotation (Blender XYZ euler) that points an object's -Z axis from pos towards target (camera / sun)
  function lookRot(pos, target) {
    const d = M.vec.norm(M.vec.sub(target, pos));
    return [Math.acos(Math.max(-1, Math.min(1, -d[2]))), 0, Math.atan2(-d[0], d[1])];
  }
  function backdrop(width = 16, depth = 7, radius = 3, height = 7, seg = 12) {
    // profile in (y, z): floor from -depth to 0, quarter circle, then wall
    const prof = [];
    for (let i = 0; i <= 4; i++) prof.push([-depth + depth * i / 4, 0]);
    for (let i = 1; i <= seg; i++) { const a = i / seg * Math.PI / 2; prof.push([Math.sin(a) * radius, radius - Math.cos(a) * radius]); }
    for (let i = 1; i <= 3; i++) prof.push([radius, radius + (height - radius) * i / 3]);
    const v = [], f = [], uv = [], nx = 8;
    for (let j = 0; j < prof.length; j++) for (let i = 0; i <= nx; i++) v.push([-width / 2 + width * i / nx, prof[j][0], prof[j][1]]);
    const id = (i, j) => j * (nx + 1) + i;
    for (let j = 0; j < prof.length - 1; j++) for (let i = 0; i < nx; i++) { f.push([id(i, j), id(i + 1, j), id(i + 1, j + 1), id(i, j + 1)]); uv.push(null); }
    return M.make(v, f, uv);
  }
  function checker(n = 8, size = 256, a = '#f4f1ea', b = '#2c3e57') {
    const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d'), s = size / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? b : a; g.fillRect(x * s, y * s, s, s); }
    g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 2; g.strokeRect(1, 1, size - 2, size - 2);
    return c.toDataURL('image/png');
  }
  function build() {
    const d = S.newDoc(); d.anim = { fps: 24, start: 1, end: 96, frame: 30 };
    d.render = { width: 960, height: 540, samples: 64, bounces: 6, exposure: 0, look: 'filmic', camera: null };
    d.world = { mode: 'sky', color: '#202226', strength: 0.6, horizon: '#dfe6ef', zenith: '#7d9cc6', ground: '#59544d' };
    const img = { id: S.uid(), name: 'Checker', data: checker() }; d.images.push(img);
    const mat = (name, color, p) => { const m = S.newMaterial(name, color, p); d.materials.push(m); return m.id; };
    const mBack = mat('Backdrop', '#c9ccd2', { rough: 0.85 }), mRed = mat('Candy red', '#c8102e', { rough: 0.22 }), mGold = mat('Gold', '#ffc35a', { metal: 1, rough: 0.18 });
    const mGlass = mat('Glass', '#f2fbff', { transmission: 1, rough: 0.02, ior: 1.5 }), mChk = mat('Checker', '#ffffff', { rough: 0.4, tex: img.id }), mClay = mat('Teal clay', '#2f9e9a', { rough: 0.55 });
    const mLamp = mat('Softbox', '#ffffff', { emit: '#fff3e2', emitStrength: 6 });
    const add = (type, name, p) => { const o = S.newObject(type, name, p); d.objects.push(o); return o; };
    add('mesh', 'Backdrop', { mesh: backdrop(26, 9, 3, 8), loc: [-1.2, 2.6, 0], rot: [0, 0, 0.62], mat: mBack });
    // rounded box: bevelled cube + subdivision surface
    const cube = M.cube(0.7), allE = M.flush(cube, 'edge', { E: new Set(M.edgeMap(cube).keys()) }), bev = M.bevel(cube, allE, 0.18).mesh;
    add('mesh', 'Rounded box', { mesh: bev, loc: [-1.55, 0.35, 0.7], rot: [0, 0, 0.42], mat: mRed, smooth: true, mods: [{ id: S.uid(), type: 'subsurf', levels: 2, enabled: true }] });
    // gold ring, spinning
    const ring = add('mesh', 'Gold ring', { mesh: M.torus(0.72, 0.2, 48, 16), loc: [0.75, 0.9, 0.93], rot: [1.25, 0, 0.35], mat: mGold, smooth: true });
    S.setKey(ring, 'rot', 1, [1.25, 0, 0.35], 'linear'); S.setKey(ring, 'rot', 96, [1.25, 0, 0.35 + Math.PI * 2], 'linear');
    // bouncing glass ball
    const ball = add('mesh', 'Glass ball', { mesh: M.icoSphere(3, 0.5), loc: [1.75, -1.05, 0.5], mat: mGlass, smooth: true });
    [[1, 0.5], [24, 1.6], [48, 0.5], [72, 1.6], [96, 0.5]].forEach(([f, z]) => S.setKey(ball, 'loc', f, [1.75, -1.05, z]));
    // bowl: half sphere + solidify + subdivision
    const sph = M.uvSphere(24, 12, 0.62), top = new Set(sph.v.map((p, i) => i).filter(i => sph.v[i][2] > 1e-6));
    const bowl = M.del(sph, M.flush(sph, 'vert', { V: top }), 'verts').mesh;
    add('mesh', 'Bowl', { mesh: bowl, loc: [-0.3, -1.45, 0.62], mat: mClay, smooth: true, mods: [{ id: S.uid(), type: 'solidify', thickness: 0.07, offset: -1, rim: true, enabled: true }, { id: S.uid(), type: 'subsurf', levels: 1, enabled: true }] });
    // checker steps: one block + array modifier
    const blk = M.bevel(M.cube(0.3), M.flush(M.cube(0.3), 'edge', { E: new Set(M.edgeMap(M.cube(0.3)).keys()) }), 0.04).mesh;
    add('mesh', 'Checker blocks', { mesh: blk, loc: [-2.9, 1.9, 0.3], rot: [0, 0, 0.1], mat: mChk, mods: [{ id: S.uid(), type: 'array', count: 4, rx: 1.15, ry: 0, rz: 0, cx: 0, cy: 0, cz: 0, merge: false, enabled: true }] });
    // mirrored arch: half shape + mirror modifier
    const half = M.make([[0.9, 0, 0], [0.9, 0, 1.5], [0.72, 0, 1.82], [0.4, 0, 1.97], [0, 0, 2.02], [0, 0, 1.62], [0.25, 0, 1.57], [0.45, 0, 1.42], [0.5, 0, 0]], [[8, 0, 1, 7], [7, 1, 2, 3, 6], [6, 3, 4, 5]]);
    add('mesh', 'Arch', { mesh: half, loc: [2.75, 1.7, 0], rot: [0, 0, -0.35], scale: [0.75, 0.75, 0.75], mat: mClay, mods: [{ id: S.uid(), type: 'mirror', x: true, y: false, z: false, merge: true, threshold: 0.001, enabled: true }, { id: S.uid(), type: 'solidify', thickness: 0.35, offset: 0, rim: true, enabled: true }] });
    // softbox (emissive plane)
    const sbPos = [-4.6, -1.2, 5.2];
    add('mesh', 'Softbox', { mesh: M.plane(1), loc: sbPos, rot: lookRot(sbPos, M.vec.sub(M.vec.mul(sbPos, 2), [0, 0, 0.5])), scale: [1.4, 0.9, 1], mat: mLamp, render: true });
    add('light', 'Sun', { loc: [3, -3, 6], rot: lookRot([3, -3, 6], [0, 0, 0]), light: { kind: 'sun', color: '#fff4e6', strength: 2.2, angle: 0.08 } });
    add('light', 'Rim light', { loc: [3.5, 3, 2.6], light: { kind: 'point', color: '#9cc7ff', power: 900, radius: 0.25 } });
    const camPos = [6.4, -7.8, 3.5];
    const cam = add('camera', 'Camera', { loc: camPos, rot: lookRot(camPos, [0.25, 0.35, 0.85]), camera: { fov: 25, aperture: 0, focus: 10 } });
    d.render.camera = cam.id;
    return d;
  }
  window.L3DSample = { build, lookRot };
})();
