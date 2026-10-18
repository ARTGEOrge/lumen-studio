// Lumen 3D — document model: objects, materials, transforms, keyframe animation, .l3d (de)serialisation,
// and conversion of a document into a path-tracer scene. Browser (window.LScene) and Node.
(function (root) {
  'use strict';
  const M = typeof module !== 'undefined' && module.exports ? require('./mesh.js') : root.LMesh;
  const uid = () => Math.random().toString(36).slice(2, 10);

  // ---------- colours ----------
  const hexToRgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '')); const n = m ? parseInt(m[1], 16) : 0xcccccc; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const s2l = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const hexToLinear = h => hexToRgb(h).map(s2l);
  const rgbToHex = c => '#' + c.map(x => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('');
  const linToHex = c => rgbToHex(c.map(x => x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));

  // ---------- matrices (column-major 4x4, Blender XYZ euler: R = Rz*Ry*Rx) ----------
  function compose(loc, rot, scale) {
    const [x, y, z] = rot, cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
    const r = [cz * cy, sz * cy, -sy, cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx, cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx];
    const s = scale;
    return [r[0] * s[0], r[1] * s[0], r[2] * s[0], 0, r[3] * s[1], r[4] * s[1], r[5] * s[1], 0, r[6] * s[2], r[7] * s[2], r[8] * s[2], 0, loc[0], loc[1], loc[2], 1];
  }
  const xform = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]];
  const xdir = (m, p) => [m[0] * p[0] + m[4] * p[1] + m[8] * p[2], m[1] * p[0] + m[5] * p[1] + m[9] * p[2], m[2] * p[0] + m[6] * p[1] + m[10] * p[2]];
  function normalMatrix(m) { // inverse transpose of upper 3x3, as column-major 3x3
    const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], i = m[10];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C || 1;
    // inverse (row-major cofactors / det), then transpose
    return [A / det, B / det, C / det, -(b * i - c * h) / det, (a * i - c * g) / det, -(a * h - b * g) / det, (b * f - c * e) / det, -(a * f - c * d) / det, (a * e - b * d) / det];
  }
  const nxf = (n, v) => { const r = [n[0] * v[0] + n[3] * v[1] + n[6] * v[2], n[1] * v[0] + n[4] * v[1] + n[7] * v[2], n[2] * v[0] + n[5] * v[1] + n[8] * v[2]]; const l = Math.hypot(...r) || 1; return [r[0] / l, r[1] / l, r[2] / l]; };
  function matMul(a, b) { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
  // decompose (no shear) -> loc, Blender XYZ euler, scale
  function decompose(m) {
    const loc = [m[12], m[13], m[14]];
    let sx = Math.hypot(m[0], m[1], m[2]); const sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
    const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]); if (det < 0) sx = -sx;
    const r = [m[0] / sx, m[1] / sx, m[2] / sx, m[4] / sy, m[5] / sy, m[6] / sy, m[8] / sz, m[9] / sz, m[10] / sz];
    // r is column-major: r[2] = -sin(y)
    const y = Math.asin(Math.max(-1, Math.min(1, -r[2])));
    let x, z;
    if (Math.abs(r[2]) < 0.999999) { x = Math.atan2(r[5], r[8]); z = Math.atan2(r[1], r[0]); } else { x = Math.atan2(-r[7], r[4]); z = 0; }
    return { loc, rot: [x, y, z], scale: [sx, sy, sz] };
  }
  function quatFromEuler([x, y, z]) { // R = Rz*Ry*Rx -> q = qz*qy*qx, [x,y,z,w]
    const cx = Math.cos(x / 2), sx = Math.sin(x / 2), cy = Math.cos(y / 2), sy = Math.sin(y / 2), cz = Math.cos(z / 2), sz = Math.sin(z / 2);
    return [sx * cy * cz - cx * sy * sz, cx * sy * cz + sx * cy * sz, cx * cy * sz - sx * sy * cz, cx * cy * cz + sx * sy * sz];
  }
  function matFromQuat(q, t, s) {
    const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z, xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
    return [(1 - (yy + zz)) * s[0], (xy + wz) * s[0], (xz - wy) * s[0], 0, (xy - wz) * s[1], (1 - (xx + zz)) * s[1], (yz + wx) * s[1], 0, (xz + wy) * s[2], (yz - wx) * s[2], (1 - (xx + yy)) * s[2], 0, t[0], t[1], t[2], 1];
  }

  // ---------- animation ----------
  const CHANNELS = ['loc', 'rot', 'scale'];
  function channelAt(keys, frame) {
    if (!keys || !keys.length) return null;
    if (frame <= keys[0].f) return keys[0].v.slice();
    const n = keys.length; if (frame >= keys[n - 1].f) return keys[n - 1].v.slice();
    let i = 0; while (i < n - 2 && keys[i + 1].f <= frame) i++;
    const k0 = keys[i], k1 = keys[i + 1], h = k1.f - k0.f, t = (frame - k0.f) / h;
    if (k0.ease === 'constant') return k0.v.slice();
    if (k0.ease === 'linear') return k0.v.map((a, c) => a + (k1.v[c] - a) * t);
    // cubic Hermite with auto-clamped tangents (flat at ends and at local extremes, like Blender's default)
    const tan = (j, c) => {
      if (j <= 0 || j >= n - 1) return 0;
      const a = keys[j - 1].v[c], b = keys[j].v[c], d = keys[j + 1].v[c];
      if ((b - a) * (d - b) <= 0) return 0;
      return (d - a) / (keys[j + 1].f - keys[j - 1].f);
    };
    const h00 = 2 * t * t * t - 3 * t * t + 1, h10 = t * t * t - 2 * t * t + t, h01 = -2 * t * t * t + 3 * t * t, h11 = t * t * t - t * t;
    return k0.v.map((a, c) => h00 * a + h10 * h * tan(i, c) + h01 * k1.v[c] + h11 * h * tan(i + 1, c));
  }
  // transform of an object at a frame (keyed channels override the static values)
  function trsAt(o, frame) {
    const out = { loc: o.loc.slice(), rot: o.rot.slice(), scale: o.scale.slice() };
    if (o.keys) CHANNELS.forEach(ch => { const v = channelAt(o.keys[ch], frame); if (v) out[ch] = v; });
    return out;
  }
  function setKey(o, ch, frame, value, ease = 'bezier') {
    o.keys = o.keys || {}; const arr = o.keys[ch] = (o.keys[ch] || []).filter(k => k.f !== frame);
    arr.push({ f: frame, v: value.slice(), ease }); arr.sort((a, b) => a.f - b.f);
  }
  function delKey(o, frame, ch) { if (!o.keys) return; (ch ? [ch] : CHANNELS).forEach(c => { if (o.keys[c]) { o.keys[c] = o.keys[c].filter(k => k.f !== frame); if (!o.keys[c].length) delete o.keys[c]; } }); }
  function keyFrames(o) { const s = new Set(); if (o.keys) CHANNELS.forEach(c => (o.keys[c] || []).forEach(k => s.add(k.f))); return [...s].sort((a, b) => a - b); }
  const isAnimated = o => !!(o.keys && CHANNELS.some(c => o.keys[c] && o.keys[c].length));
  const worldMatrix = (o, frame) => { const t = trsAt(o, frame); return compose(t.loc, t.rot, t.scale); };

  // ---------- document ----------
  function newDoc() {
    return { format: 'lumen-3d', version: 1, objects: [], materials: [], images: [],
      world: { mode: 'sky', color: '#202226', strength: 1, horizon: '#d8e2ee', zenith: '#6f93c4', ground: '#4a4640' },
      render: { width: 960, height: 540, samples: 64, bounces: 6, exposure: 0, look: 'filmic', camera: null },
      anim: { fps: 24, start: 1, end: 120, frame: 1 } };
  }
  function newMaterial(name = 'Material', color = '#cccccc', props = {}) {
    return { id: uid(), name, color, metal: 0, rough: 0.5, emit: '#000000', emitStrength: 0, transmission: 0, ior: 1.45, tex: null, ...props };
  }
  function newObject(type, name, props = {}) {
    const o = { id: uid(), name, type, loc: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1], visible: true, render: true, ...props };
    if (type === 'mesh') { o.mesh = o.mesh || M.cube(1); o.smooth = o.smooth || false; o.mods = o.mods || []; o.mat = o.mat || null; }
    if (type === 'light') o.light = { kind: 'point', color: '#ffffff', power: 1000, strength: 3, radius: 0.1, angle: 0.02, ...(props.light || {}) };
    if (type === 'camera') o.camera = { fov: 40, aperture: 0, focus: 8, ...(props.camera || {}) };
    return o;
  }
  const evalMesh = (o, useMods = true) => useMods && o.mods && o.mods.length ? M.evaluate(o.mesh, o.mods) : o.mesh;

  // camera basis for a camera object (looks down local -Z, up +Y)
  function cameraFrom(o, frame) {
    const m = worldMatrix(o, frame), pos = [m[12], m[13], m[14]], dir = xdir(m, [0, 0, -1]), up = xdir(m, [0, 1, 0]);
    const nd = Math.hypot(...dir) || 1, nu = Math.hypot(...up) || 1;
    return { pos, dir: dir.map(x => x / nd), up: up.map(x => x / nu), fov: o.camera.fov, aperture: o.camera.aperture, focus: o.camera.focus };
  }

  // document -> path tracer scene. texLookup(imageId) -> {w,h,data:Uint8ClampedArray RGBA} | null
  function renderScene(doc, opts = {}) {
    const frame = opts.frame ?? doc.anim.frame, texLookup = opts.texLookup || (() => null);
    const matIndex = new Map(), materials = [];
    const matOf = id => {
      if (matIndex.has(id)) return matIndex.get(id);
      const m = doc.materials.find(x => x.id === id) || newMaterial('Default', '#cccccc');
      matIndex.set(id, materials.length);
      materials.push({ color: hexToLinear(m.color), metal: +m.metal || 0, rough: m.rough ?? 0.5, emit: hexToLinear(m.emit), emitStrength: +m.emitStrength || 0, transmission: +m.transmission || 0, ior: +m.ior || 1.45, tex: m.tex ? texLookup(m.tex) : null });
      return materials.length - 1;
    };
    const parts = []; let n = 0;
    doc.objects.forEach(o => {
      if (o.type !== 'mesh' || !o.visible || o.render === false) return;
      const mesh = opts.meshOf ? opts.meshOf(o) : evalMesh(o), tri = M.toTriangles(mesh, !!o.smooth, o.autoSmooth ?? 180);
      const mw = worldMatrix(o, frame), nm = normalMatrix(mw), mi = matOf(o.mat);
      const det = mw[0] * (mw[5] * mw[10] - mw[6] * mw[9]) - mw[4] * (mw[1] * mw[10] - mw[2] * mw[9]) + mw[8] * (mw[1] * mw[6] - mw[2] * mw[5]);
      parts.push({ tri, mw, nm, mi, flip: det < 0 }); n += tri.count;
    });
    const pos = new Float32Array(n * 9), nor = new Float32Array(n * 9), uv = new Float32Array(n * 6), mat = new Int32Array(n);
    let t = 0;
    parts.forEach(({ tri, mw, nm, mi, flip }) => {
      for (let i = 0; i < tri.count; i++, t++) {
        const order = flip ? [0, 2, 1] : [0, 1, 2];
        order.forEach((k, j) => {
          const s = i * 9 + k * 3, p = xform(mw, [tri.pos[s], tri.pos[s + 1], tri.pos[s + 2]]), q = nxf(nm, [tri.nor[s], tri.nor[s + 1], tri.nor[s + 2]]);
          pos.set(p, t * 9 + j * 3); nor.set(q, t * 9 + j * 3); uv[t * 6 + j * 2] = tri.uv[i * 6 + k * 2]; uv[t * 6 + j * 2 + 1] = tri.uv[i * 6 + k * 2 + 1];
        });
        mat[t] = mi;
      }
    });
    if (!materials.length) matOf(null);
    const lights = [];
    doc.objects.forEach(o => {
      if (o.type !== 'light' || !o.visible) return; const m = worldMatrix(o, frame), L = o.light, col = hexToLinear(L.color);
      if (L.kind === 'sun') lights.push({ type: 'sun', dir: xdir(m, [0, 0, -1]), color: col, strength: +L.strength || 0, angle: +L.angle || 0 });
      else lights.push({ type: 'point', pos: [m[12], m[13], m[14]], color: col, power: +L.power || 0, radius: +L.radius || 0 });
    });
    let camera = opts.camera;
    if (!camera) { const co = doc.objects.find(o => o.id === doc.render.camera && o.type === 'camera') || doc.objects.find(o => o.type === 'camera'); if (co) camera = cameraFrom(co, frame); }
    if (!camera) camera = { pos: [7, -7, 5], dir: [-0.6, 0.6, -0.45], up: [0, 0, 1], fov: 40 };
    const w = doc.world;
    const world = w.mode === 'sky' ? { sky: true, horizon: hexToLinear(w.horizon), zenith: hexToLinear(w.zenith), ground: hexToLinear(w.ground), strength: +w.strength } : { color: hexToLinear(w.color), strength: +w.strength };
    return { pos, nor, uv, mat, materials, lights, world, camera, width: opts.width || doc.render.width, height: opts.height || doc.render.height, bounces: doc.render.bounces ?? 6 };
  }

  // ---------- .l3d ----------
  const r6 = x => Math.round(x * 1e6) / 1e6;
  function serialize(doc) {
    const out = { ...doc, objects: doc.objects.map(o => { const c = { ...o }; if (o.mesh) c.mesh = { v: o.mesh.v.map(p => p.map(r6)), f: o.mesh.f, uv: o.mesh.uv && o.mesh.uv.some(Boolean) ? o.mesh.uv.map(u => u ? u.map(q => q.map(r6)) : null) : undefined }; return c; }) };
    return JSON.stringify(out);
  }
  const isNum = x => typeof x === 'number' && isFinite(x);
  const num = (x, d, lo = -1e9, hi = 1e9) => isNum(+x) && x !== null && x !== '' ? Math.max(lo, Math.min(hi, +x)) : d;
  const vec3 = (x, d) => Array.isArray(x) && x.length >= 3 && x.slice(0, 3).every(v => isNum(+v)) ? x.slice(0, 3).map(Number) : d.slice();
  const hex = (x, d) => /^#[0-9a-f]{6}$/i.test(String(x)) ? String(x).toLowerCase() : d;
  const str = (x, d, max = 200) => typeof x === 'string' ? x.slice(0, max) : d;
  const id = x => typeof x === 'string' && /^[\w-]{1,40}$/.test(x) ? x : uid();
  // opened files are untrusted: rebuild a clean document from known fields only (no code is ever executed)
  function parse(text) {
    let j; try { j = typeof text === 'string' ? JSON.parse(text) : text; } catch (e) { throw new Error('Not a valid Lumen 3D file (JSON error)'); }
    if (!j || j.format !== 'lumen-3d') throw new Error('Not a Lumen 3D (.l3d) file');
    const d = newDoc();
    d.images = (Array.isArray(j.images) ? j.images : []).filter(im => im && typeof im.data === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(im.data)).map(im => ({ id: id(im.id), name: str(im.name, 'Image'), data: im.data }));
    const imgIds = new Set(d.images.map(i => i.id));
    d.materials = (Array.isArray(j.materials) ? j.materials : []).filter(m => m && typeof m === 'object').map(m => ({ id: id(m.id), name: str(m.name, 'Material'), color: hex(m.color, '#cccccc'), metal: num(m.metal, 0, 0, 1), rough: num(m.rough, 0.5, 0, 1),
      emit: hex(m.emit, '#000000'), emitStrength: num(m.emitStrength, 0, 0, 1e4), transmission: num(m.transmission, 0, 0, 1), ior: num(m.ior, 1.45, 1, 3), tex: imgIds.has(m.tex) ? m.tex : null }));
    const matIds = new Set(d.materials.map(m => m.id)), CH = new Set(CHANNELS);
    (Array.isArray(j.objects) ? j.objects : []).forEach(o => {
      if (!o || !['mesh', 'light', 'camera'].includes(o.type)) return;
      const c = newObject(o.type, str(o.name, o.type), { id: id(o.id), loc: vec3(o.loc, [0, 0, 0]), rot: vec3(o.rot, [0, 0, 0]), scale: vec3(o.scale, [1, 1, 1]), visible: o.visible !== false, render: o.render !== false });
      if (o.type === 'mesh') {
        const mesh = M.sanitize(o.mesh); if (!mesh) return; c.mesh = mesh; c.smooth = !!o.smooth; c.autoSmooth = num(o.autoSmooth, 180, 0, 180);
        c.mat = matIds.has(o.mat) ? o.mat : null;
        c.mods = (Array.isArray(o.mods) ? o.mods : []).filter(md => md && ['subsurf', 'mirror', 'array', 'solidify'].includes(md.type)).slice(0, 16).map(md => {
          const b = { id: id(md.id), type: md.type, enabled: md.enabled !== false };
          if (md.type === 'subsurf') b.levels = num(md.levels, 1, 0, 4) | 0;
          if (md.type === 'mirror') Object.assign(b, { x: !!md.x, y: !!md.y, z: !!md.z, merge: md.merge !== false, threshold: num(md.threshold, 0.001, 0, 10) });
          if (md.type === 'array') Object.assign(b, { count: num(md.count, 3, 1, 200) | 0, rx: num(md.rx, 1), ry: num(md.ry, 0), rz: num(md.rz, 0), cx: num(md.cx, 0), cy: num(md.cy, 0), cz: num(md.cz, 0), merge: !!md.merge });
          if (md.type === 'solidify') Object.assign(b, { thickness: num(md.thickness, 0.1, -100, 100), offset: num(md.offset, -1, -1, 1), rim: md.rim !== false });
          return b;
        });
      }
      if (o.type === 'light' && o.light) c.light = { kind: o.light.kind === 'sun' ? 'sun' : 'point', color: hex(o.light.color, '#ffffff'), power: num(o.light.power, 1000, 0, 1e7), strength: num(o.light.strength, 3, 0, 1e4), radius: num(o.light.radius, 0.1, 0, 100), angle: num(o.light.angle, 0.02, 0, 3) };
      if (o.type === 'camera' && o.camera) c.camera = { fov: num(o.camera.fov, 40, 1, 170), aperture: num(o.camera.aperture, 0, 0, 10), focus: num(o.camera.focus, 8, 0.01, 1e5) };
      if (o.keys && typeof o.keys === 'object') {
        c.keys = {};
        Object.keys(o.keys).forEach(ch => {
          if (!CH.has(ch) || !Array.isArray(o.keys[ch])) return;
          const arr = o.keys[ch].filter(k => k && isNum(k.f)).map(k => ({ f: Math.round(k.f), v: vec3(k.v, ch === 'scale' ? [1, 1, 1] : [0, 0, 0]), ease: ['linear', 'constant'].includes(k.ease) ? k.ease : 'bezier' })).sort((a, b) => a.f - b.f);
          if (arr.length) c.keys[ch] = arr;
        });
      }
      d.objects.push(c);
    });
    const w = j.world || {};
    d.world = { mode: w.mode === 'color' ? 'color' : 'sky', color: hex(w.color, d.world.color), strength: num(w.strength, 1, 0, 1e3), horizon: hex(w.horizon, d.world.horizon), zenith: hex(w.zenith, d.world.zenith), ground: hex(w.ground, d.world.ground) };
    const r = j.render || {};
    d.render = { width: num(r.width, 960, 16, 8192) | 0, height: num(r.height, 540, 16, 8192) | 0, samples: num(r.samples, 128, 1, 100000) | 0, bounces: num(r.bounces, 6, 1, 32) | 0, exposure: num(r.exposure, 0, -10, 10), look: r.look === 'standard' ? 'standard' : 'filmic', camera: d.objects.some(o => o.id === r.camera) ? r.camera : null };
    const a = j.anim || {};
    d.anim = { fps: num(a.fps, 24, 1, 240) | 0, start: num(a.start, 1, -1e5, 1e5) | 0, end: num(a.end, 120, -1e5, 1e5) | 0, frame: num(a.frame, 1, -1e5, 1e5) | 0 };
    if (d.anim.end < d.anim.start) d.anim.end = d.anim.start;
    return d;
  }

  const api = { uid, hexToRgb, hexToLinear, rgbToHex, linToHex, compose, xform, xdir, normalMatrix, matMul, decompose, quatFromEuler, matFromQuat,
    channelAt, trsAt, setKey, delKey, keyFrames, isAnimated, worldMatrix, newDoc, newMaterial, newObject, evalMesh, cameraFrom, renderScene, serialize, parse, CHANNELS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LScene = api;
})(typeof self !== 'undefined' ? self : this);
