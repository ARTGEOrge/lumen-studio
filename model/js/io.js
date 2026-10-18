// Lumen 3D — file formats: OBJ (+MTL), STL (binary/ASCII), glTF 2.0 (.gltf with embedded buffers, .glb).
// Own reader/writers (the vendored three.js subset has no loaders/exporters). Scene space is Z-up;
// OBJ and glTF are written Y-up like Blender does. Browser (window.LIO) and Node.
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const M = node ? require('./mesh.js') : root.LMesh, S = node ? require('./scene.js') : root.LScene;
  const te = new TextEncoder(), td = new TextDecoder();

  // ---------- base64 ----------
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64enc(u8) {
    let s = ''; for (let i = 0; i < u8.length; i += 3) { const a = u8[i], b = u8[i + 1], c = u8[i + 2], n = (a << 16) | ((b || 0) << 8) | (c || 0); s += B64[n >> 18 & 63] + B64[n >> 12 & 63] + (b === undefined ? '=' : B64[n >> 6 & 63]) + (c === undefined ? '=' : B64[n & 63]); }
    return s;
  }
  const B64I = new Int16Array(256).fill(-1); for (let i = 0; i < 64; i++) B64I[B64.charCodeAt(i)] = i;
  function b64dec(s) {
    s = s.replace(/[^A-Za-z0-9+/]/g, ''); const out = new Uint8Array(Math.floor(s.length * 3 / 4)); let o = 0;
    for (let i = 0; i < s.length; i += 4) { const n = (B64I[s.charCodeAt(i)] << 18) | (B64I[s.charCodeAt(i + 1)] << 12) | ((B64I[s.charCodeAt(i + 2)] & 63) << 6) | (B64I[s.charCodeAt(i + 3)] & 63); out[o++] = n >> 16 & 255; if (i + 2 < s.length) out[o++] = n >> 8 & 255; if (i + 3 < s.length) out[o++] = n & 255; }
    return out.subarray(0, o);
  }
  const dataUrlBytes = u => { const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(u || ''); if (!m) return null; return { mime: m[1] || 'application/octet-stream', bytes: m[2] ? b64dec(m[3]) : te.encode(decodeURIComponent(m[3])) }; };
  const bytesToDataUrl = (bytes, mime) => 'data:' + mime + ';base64,' + b64enc(bytes);

  const zToY = p => [p[0], p[2], -p[1]], yToZ = p => [p[0], -p[2], p[1]];
  const fmt = x => { const r = Math.round(x * 1e6) / 1e6; return Object.is(r, -0) ? '0' : String(r); };

  // items: [{name, mesh (local, evaluated), matrix (world, column-major), material, smooth}]
  // ---------- OBJ ----------
  function exportOBJ(items, { mtlName = 'scene.mtl' } = {}) {
    const L = ['# Lumen 3D OBJ export', 'mtllib ' + mtlName]; let vo = 1, to = 1; const mats = new Map();
    items.forEach(it => {
      L.push('o ' + (it.name || 'Object').replace(/\s+/g, '_'));
      it.mesh.v.forEach(p => { const q = zToY(S.xform(it.matrix, p)); L.push(`v ${fmt(q[0])} ${fmt(q[1])} ${fmt(q[2])}`); });
      const hasUV = it.mesh.uv && it.mesh.uv.some(Boolean), uvBase = to;
      if (hasUV) it.mesh.f.forEach((f, fi) => { const u = it.mesh.uv[fi]; f.forEach((_, k) => { const q = u ? u[k] : [0, 0]; L.push(`vt ${fmt(q[0])} ${fmt(q[1])}`); to++; }); });
      if (it.material) { mats.set(it.material.id, it.material); L.push('usemtl ' + it.material.name.replace(/\s+/g, '_')); }
      L.push('s ' + (it.smooth ? '1' : 'off'));
      const det = S.normalMatrix(it.matrix); void det;
      const flip = detOf(it.matrix) < 0; let c = uvBase;
      it.mesh.f.forEach(f => {
        let idx = f.map((v, k) => hasUV ? `${v + vo}/${c + k}` : `${v + vo}`); c += f.length;
        if (flip) idx = idx.reverse(); L.push('f ' + idx.join(' '));
      });
      vo += it.mesh.v.length;
    });
    const ML = ['# Lumen 3D MTL export'];
    mats.forEach(m => {
      const c = S.hexToRgb(m.color), e = S.hexToRgb(m.emit).map(x => x * Math.min(1, m.emitStrength || 0));
      ML.push('newmtl ' + m.name.replace(/\s+/g, '_'), `Kd ${c.map(fmt).join(' ')}`, `Ks ${[0.5, 0.5, 0.5].map(x => fmt(x * (1 - m.rough))).join(' ')}`, `Ns ${fmt((1 - m.rough) * (1 - m.rough) * 1000)}`, `Ke ${e.map(fmt).join(' ')}`, `Pm ${fmt(m.metal)}`, `Pr ${fmt(m.rough)}`, `d ${fmt(1 - (m.transmission || 0) * 0.9)}`, 'illum 2', '');
    });
    return { obj: L.join('\n') + '\n', mtl: ML.join('\n') + '\n' };
  }
  const detOf = m => m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  function parseMTL(text) {
    const mats = {}; let cur = null;
    text.split(/\r?\n/).forEach(line => {
      const t = line.trim().split(/\s+/); if (!t[0] || t[0][0] === '#') return;
      if (t[0] === 'newmtl') { cur = mats[t.slice(1).join(' ')] = { name: t.slice(1).join(' ') }; return; }
      if (!cur) return; const n = t.slice(1).map(Number);
      if (t[0] === 'Kd') cur.Kd = n; else if (t[0] === 'Ke') cur.Ke = n; else if (t[0] === 'Ns') cur.Ns = n[0]; else if (t[0] === 'Pr') cur.Pr = n[0]; else if (t[0] === 'Pm') cur.Pm = n[0]; else if (t[0] === 'd') cur.d = n[0]; else if (t[0] === 'map_Kd') cur.map_Kd = t.slice(1).join(' ');
    });
    return mats;
  }
  // returns [{name, mesh, mtl}] in Z-up space
  function importOBJ(text, mtlText) {
    const mtls = mtlText ? parseMTL(mtlText) : {};
    const V = [], T = []; const objs = []; let cur = null, curMtl = null;
    const start = name => { cur = { name, faces: [], uvs: [], mtl: curMtl }; objs.push(cur); };
    const lines = text.split(/\r?\n/);
    for (let li = 0; li < lines.length; li++) {
      let line = lines[li]; while (line.endsWith('\\') && li + 1 < lines.length) line = line.slice(0, -1) + ' ' + lines[++li];
      const t = line.trim().split(/\s+/), k = t[0]; if (!k || k[0] === '#') continue;
      if (k === 'v') { const p = [+t[1], +t[2], +t[3]]; if (p.every(isFinite)) V.push(yToZ(p)); else V.push([0, 0, 0]); }
      else if (k === 'vt') T.push([+t[1] || 0, +t[2] || 0]);
      else if (k === 'o' || k === 'g') { const nm = t.slice(1).join(' ') || 'Object'; if (!cur || cur.faces.length) start(nm); else cur.name = nm; }
      else if (k === 'usemtl') { curMtl = mtls[t.slice(1).join(' ')] || { name: t.slice(1).join(' ') }; if (cur && !cur.faces.length) cur.mtl = curMtl; else if (cur && cur.mtl && cur.mtl.name !== curMtl.name) { const n = cur.name; start(n + '.' + curMtl.name); } else if (cur) cur.mtl = curMtl; }
      else if (k === 'f') {
        if (!cur) start('Object');
        const f = [], u = []; let okUV = true;
        for (let i = 1; i < t.length; i++) {
          const p = t[i].split('/'); let vi = parseInt(p[0], 10); if (!isFinite(vi)) continue; vi = vi < 0 ? V.length + vi : vi - 1;
          let ti = p[1] ? parseInt(p[1], 10) : NaN; if (isFinite(ti)) { ti = ti < 0 ? T.length + ti : ti - 1; u.push(T[ti] || [0, 0]); } else okUV = false;
          if (vi >= 0 && vi < V.length) f.push(vi);
        }
        if (f.length >= 3) { cur.faces.push(f); cur.uvs.push(okUV && u.length === f.length ? u : null); }
      }
    }
    // split shared vertex pool into per-object meshes
    return objs.filter(o => o.faces.length).map(o => {
      const map = new Map(), v = [];
      const f = o.faces.map(face => face.map(i => { if (!map.has(i)) { map.set(i, v.length); v.push(V[i].slice()); } return map.get(i); }));
      return { name: o.name, mesh: M.compact({ v, f, uv: o.uvs }).mesh, mtl: o.mtl };
    });
  }

  // ---------- STL ----------
  function exportSTL(items) {
    const tris = []; items.forEach(it => { const t = M.toTriangles(it.mesh, false), flip = detOf(it.matrix) < 0; for (let i = 0; i < t.count; i++) { const p = [0, 1, 2].map(k => S.xform(it.matrix, [t.pos[i * 9 + k * 3], t.pos[i * 9 + k * 3 + 1], t.pos[i * 9 + k * 3 + 2]])); tris.push(flip ? [p[0], p[2], p[1]] : p); } });
    const buf = new ArrayBuffer(84 + tris.length * 50), dv = new DataView(buf), hdr = te.encode('Lumen 3D binary STL');
    new Uint8Array(buf).set(hdr.subarray(0, 80)); dv.setUint32(80, tris.length, true);
    tris.forEach((t, i) => {
      const o = 84 + i * 50, n = M.vec.norm(M.vec.cross(M.vec.sub(t[1], t[0]), M.vec.sub(t[2], t[0])));
      [n, ...t].forEach((p, k) => { dv.setFloat32(o + k * 12, p[0], true); dv.setFloat32(o + k * 12 + 4, p[1], true); dv.setFloat32(o + k * 12 + 8, p[2], true); });
    });
    return new Uint8Array(buf);
  }
  function importSTL(ab) {
    const u8 = new Uint8Array(ab), dv = new DataView(ab instanceof ArrayBuffer ? ab : u8.buffer, u8.byteOffset, u8.byteLength);
    const tris = [];
    const nBin = u8.length >= 84 ? dv.getUint32(80, true) : -1;
    if (nBin >= 0 && 84 + nBin * 50 === u8.length) {
      for (let i = 0; i < nBin; i++) { const o = 84 + i * 50 + 12, t = []; for (let k = 0; k < 3; k++) t.push([dv.getFloat32(o + k * 12, true), dv.getFloat32(o + k * 12 + 4, true), dv.getFloat32(o + k * 12 + 8, true)]); tris.push(t); }
    } else {
      const s = td.decode(u8), re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g; let m, cur = [];
      while ((m = re.exec(s))) { cur.push([+m[1], +m[2], +m[3]]); if (cur.length === 3) { tris.push(cur); cur = []; } }
      if (!tris.length) throw new Error('No triangles found in STL');
    }
    // weld identical positions
    const map = new Map(), v = [], f = [];
    const id = p => { const k = p.map(x => Math.round(x * 1e5)).join(','); if (!map.has(k)) { map.set(k, v.length); v.push(p); } return map.get(k); };
    tris.forEach(t => { if (!t.every(p => p.every(isFinite))) return; f.push(t.map(id)); });
    return M.compact({ v, f, uv: f.map(() => null) }).mesh;
  }

  // ---------- glTF / GLB export ----------
  const ROOT_Q = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]; // Z-up scene under a Y-up root
  function exportGLTF(doc, items, { binary = true, frames = null, images = {} } = {}) {
    const J = { asset: { version: '2.0', generator: 'Lumen 3D' }, scene: 0, scenes: [{ name: 'Scene', nodes: [0] }], nodes: [{ name: 'Z-up', rotation: ROOT_Q, children: [] }], meshes: [], materials: [], accessors: [], bufferViews: [], buffers: [] };
    const chunks = []; let off = 0;
    const pushView = (u8, target) => { const pad = (4 - (off % 4)) % 4; if (pad) { chunks.push(new Uint8Array(pad)); off += pad; } const bv = { buffer: 0, byteOffset: off, byteLength: u8.byteLength }; if (target) bv.target = target; J.bufferViews.push(bv); chunks.push(new Uint8Array(u8.buffer, u8.byteOffset, u8.byteLength)); off += u8.byteLength; return J.bufferViews.length - 1; };
    const accessor = (arr, type, comp, target, minmax) => { const a = { bufferView: pushView(arr, target), componentType: comp, count: arr.length / ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 })[type], type }; if (minmax) Object.assign(a, minmax); J.accessors.push(a); return J.accessors.length - 1; };
    const exts = new Set(), matMap = new Map(), texMap = new Map();
    const texIndex = imgId => {
      if (texMap.has(imgId)) return texMap.get(imgId);
      const im = doc.images.find(i => i.id === imgId), d = im && dataUrlBytes(im.data); if (!d) return -1;
      J.images = J.images || []; J.textures = J.textures || []; J.samplers = J.samplers || [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }];
      const imgDef = { name: im.name, mimeType: d.mime };
      if (binary) imgDef.bufferView = pushView(d.bytes); else imgDef.uri = im.data;
      J.images.push(imgDef); J.textures.push({ source: J.images.length - 1, sampler: 0 }); texMap.set(imgId, J.textures.length - 1); return J.textures.length - 1;
    };
    const matIndex = m => {
      if (!m) return undefined; if (matMap.has(m.id)) return matMap.get(m.id);
      const c = S.hexToLinear(m.color), e = S.hexToLinear(m.emit), es = +m.emitStrength || 0;
      const g = { name: m.name, pbrMetallicRoughness: { baseColorFactor: [...c, 1], metallicFactor: +m.metal, roughnessFactor: +m.rough }, doubleSided: false };
      if (es > 0 && e.some(x => x > 0)) { g.emissiveFactor = e.map(x => x * Math.min(1, es)); if (es > 1) { g.extensions = { KHR_materials_emissive_strength: { emissiveStrength: es } }; exts.add('KHR_materials_emissive_strength'); } }
      if (m.transmission > 0) { g.extensions = { ...(g.extensions || {}), KHR_materials_transmission: { transmissionFactor: +m.transmission }, KHR_materials_ior: { ior: +m.ior || 1.45 } }; exts.add('KHR_materials_transmission'); exts.add('KHR_materials_ior'); }
      if (m.tex) { const ti = texIndex(m.tex); if (ti >= 0) g.pbrMetallicRoughness.baseColorTexture = { index: ti }; }
      J.materials.push(g); matMap.set(m.id, J.materials.length - 1); return J.materials.length - 1;
    };
    const nodeOf = new Map();
    items.forEach(it => {
      const t = it.trs || S.decompose(it.matrix), nd = { name: it.name, translation: t.loc, rotation: S.quatFromEuler(t.rot), scale: t.scale };
      if (it.kind === 'camera') {
        J.cameras = J.cameras || []; J.cameras.push({ type: 'perspective', perspective: { yfov: (it.camera.fov || 40) * Math.PI / 180, znear: 0.05, zfar: 1000, aspectRatio: (doc.render.width / doc.render.height) } }); nd.camera = J.cameras.length - 1;
      } else if (it.kind === 'light') {
        exts.add('KHR_lights_punctual'); J.extensions = J.extensions || {}; const LP = J.extensions.KHR_lights_punctual = J.extensions.KHR_lights_punctual || { lights: [] };
        const L = it.light; LP.lights.push(L.kind === 'sun' ? { type: 'directional', color: S.hexToLinear(L.color), intensity: +L.strength } : { type: 'point', color: S.hexToLinear(L.color), intensity: (+L.power) / (4 * Math.PI) });
        nd.extensions = { KHR_lights_punctual: { light: LP.lights.length - 1 } };
      } else {
        // indexed triangles with unique (position, normal, uv) vertices
        const tri = M.toTriangles(it.mesh, !!it.smooth, it.autoSmooth ?? 180), key = new Map(), P = [], N = [], U = [], I = [];
        for (let i = 0; i < tri.count * 3; i++) {
          const p = [tri.pos[i * 3], tri.pos[i * 3 + 1], tri.pos[i * 3 + 2]], n = [tri.nor[i * 3], tri.nor[i * 3 + 1], tri.nor[i * 3 + 2]], u = [tri.uv[i * 2], 1 - tri.uv[i * 2 + 1]];
          const k = [...p, ...n, ...u].map(x => Math.round(x * 1e5)).join(',');
          let idx = key.get(k); if (idx === undefined) { idx = P.length / 3; key.set(k, idx); P.push(...p); N.push(...n); U.push(...u); } I.push(idx);
        }
        if (!I.length) return;
        const pa = new Float32Array(P), mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
        for (let i = 0; i < pa.length; i += 3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], pa[i + k]); mx[k] = Math.max(mx[k], pa[i + k]); }
        const prim = { attributes: { POSITION: accessor(pa, 'VEC3', 5126, 34962, { min: mn, max: mx }), NORMAL: accessor(new Float32Array(N), 'VEC3', 5126, 34962), TEXCOORD_0: accessor(new Float32Array(U), 'VEC2', 5126, 34962) }, indices: accessor(new Uint32Array(I), 'SCALAR', 5125, 34963), mode: 4 };
        const mi = matIndex(it.material); if (mi !== undefined) prim.material = mi;
        J.meshes.push({ name: it.name, primitives: [prim] }); nd.mesh = J.meshes.length - 1;
      }
      J.nodes.push(nd); J.nodes[0].children.push(J.nodes.length - 1); nodeOf.set(it, J.nodes.length - 1);
    });
    // animation: sample every frame of animated objects
    if (frames) {
      const anim = { name: 'Action', channels: [], samplers: [] };
      items.forEach(it => {
        if (!it.obj || !S.isAnimated(it.obj)) return;
        const times = [], T = [], R = [], Sc = [];
        for (let f = frames.start; f <= frames.end; f++) { const trs = S.trsAt(it.obj, f); times.push((f - frames.start) / frames.fps); T.push(...trs.loc); R.push(...S.quatFromEuler(trs.rot)); Sc.push(...trs.scale); }
        // keep quaternions on the same hemisphere for smooth slerp
        for (let i = 4; i < R.length; i += 4) { const d = R[i] * R[i - 4] + R[i + 1] * R[i - 3] + R[i + 2] * R[i - 2] + R[i + 3] * R[i - 1]; if (d < 0) for (let k = 0; k < 4; k++) R[i + k] = -R[i + k]; }
        const tin = accessor(new Float32Array(times), 'SCALAR', 5126, undefined, { min: [times[0]], max: [times[times.length - 1]] }), nodeI = nodeOf.get(it);
        [['translation', T, 'VEC3'], ['rotation', R, 'VEC4'], ['scale', Sc, 'VEC3']].forEach(([path, data, type]) => {
          anim.samplers.push({ input: tin, output: accessor(new Float32Array(data), type, 5126), interpolation: 'LINEAR' });
          anim.channels.push({ sampler: anim.samplers.length - 1, target: { node: nodeI, path } });
        });
      });
      if (anim.channels.length) J.animations = [anim];
    }
    if (exts.size) J.extensionsUsed = [...exts];
    const bin = new Uint8Array(off); let p = 0; chunks.forEach(c => { bin.set(c, p); p += c.byteLength; });
    if (!J.meshes.length) delete J.meshes; if (!J.materials.length) delete J.materials;
    if (!binary) {
      J.buffers = [{ byteLength: bin.byteLength, uri: 'data:application/octet-stream;base64,' + b64enc(bin) }];
      return JSON.stringify(J, null, 1);
    }
    J.buffers = [{ byteLength: bin.byteLength }];
    let js = te.encode(JSON.stringify(J)); const jpad = (4 - js.length % 4) % 4; const jsonC = new Uint8Array(js.length + jpad); jsonC.set(js); jsonC.fill(0x20, js.length);
    const bpad = (4 - bin.length % 4) % 4, binC = new Uint8Array(bin.length + bpad); binC.set(bin);
    const total = 12 + 8 + jsonC.length + 8 + binC.length, out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
    dv.setUint32(12, jsonC.length, true); dv.setUint32(16, 0x4E4F534A, true); out.set(jsonC, 20);
    dv.setUint32(20 + jsonC.length, binC.length, true); dv.setUint32(24 + jsonC.length, 0x004E4942, true); out.set(binC, 28 + jsonC.length);
    return out;
  }

  // ---------- glTF / GLB import ----------
  // returns { objects:[{name,type,mesh,matrix,material?,light?,camera?,keys?}], materials:[{key, name, color, metal, rough, emit, emitStrength, transmission, ior, image?}], images:[{key,name,data(dataURL)}] }
  function importGLTF(ab, { resolve, fps = 24, start = 1 } = {}) {
    const u8 = new Uint8Array(ab); let J, bin = null;
    if (u8.length >= 12 && new DataView(u8.buffer, u8.byteOffset).getUint32(0, true) === 0x46546C67) {
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); let o = 12;
      while (o + 8 <= u8.length) { const L = dv.getUint32(o, true), T = dv.getUint32(o + 4, true), c = u8.subarray(o + 8, o + 8 + L); if (T === 0x4E4F534A) J = JSON.parse(td.decode(c)); else if (T === 0x004E4942) bin = c; o += 8 + L; }
    } else J = JSON.parse(td.decode(u8));
    if (!J || !J.asset) throw new Error('Not a glTF file');
    const buffers = (J.buffers || []).map((b, i) => {
      if (b.uri === undefined) return i === 0 ? bin : null;
      if (/^data:/.test(b.uri)) return dataUrlBytes(b.uri).bytes;
      const r = resolve && resolve(b.uri); return r ? new Uint8Array(r) : null;
    });
    const viewBytes = vi => { const bv = J.bufferViews[vi], b = buffers[bv.buffer || 0]; if (!b) throw new Error('Missing glTF buffer (external .bin files must be dropped together with the .gltf)'); return { b, off: bv.byteOffset || 0, len: bv.byteLength, stride: bv.byteStride || 0 }; };
    const NC = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }, CS = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
    const readAcc = ai => {
      const a = J.accessors[ai], nc = NC[a.type], out = new Float32Array(a.count * nc); if (a.bufferView === undefined) return out;
      const { b, off, stride } = viewBytes(a.bufferView), cs = CS[a.componentType], st = stride || cs * nc, base = off + (a.byteOffset || 0), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
      const rd = { 5126: o => dv.getFloat32(o, true), 5125: o => dv.getUint32(o, true), 5123: o => dv.getUint16(o, true), 5121: o => dv.getUint8(o), 5122: o => dv.getInt16(o, true), 5120: o => dv.getInt8(o) }[a.componentType];
      const nrm = a.normalized ? { 5121: 255, 5123: 65535, 5120: 127, 5122: 32767 }[a.componentType] || 1 : 1;
      for (let i = 0; i < a.count; i++) for (let k = 0; k < nc; k++) out[i * nc + k] = rd(base + i * st + k * cs) / nrm;
      return out;
    };
    const images = (J.images || []).map((im, i) => {
      let bytes = null, mime = im.mimeType || 'image/png';
      if (im.bufferView !== undefined) { const v = viewBytes(im.bufferView); bytes = v.b.subarray(v.off, v.off + v.len); }
      else if (im.uri && /^data:/.test(im.uri)) { const d = dataUrlBytes(im.uri); bytes = d.bytes; mime = d.mime; }
      else if (im.uri && resolve) { const r = resolve(im.uri); if (r) { bytes = new Uint8Array(r); if (/\.jpe?g$/i.test(im.uri)) mime = 'image/jpeg'; } }
      if (!bytes || !/^image\/(png|jpeg|webp)$/.test(mime)) return null;
      return { key: 'img' + i, name: im.name || 'Texture ' + (i + 1), data: bytesToDataUrl(bytes, mime) };
    });
    const materials = (J.materials || []).map((m, i) => {
      const pb = m.pbrMetallicRoughness || {}, c = pb.baseColorFactor || [1, 1, 1, 1], e = m.emissiveFactor || [0, 0, 0], ex = m.extensions || {};
      const es = ex.KHR_materials_emissive_strength ? +ex.KHR_materials_emissive_strength.emissiveStrength : 1, emax = Math.max(...e);
      const tex = pb.baseColorTexture && J.textures && J.textures[pb.baseColorTexture.index], img = tex && images[tex.source];
      return { key: 'mat' + i, name: m.name || 'Material ' + (i + 1), color: S.linToHex(c.slice(0, 3)), metal: pb.metallicFactor ?? 1, rough: pb.roughnessFactor ?? 1,
        emit: emax > 0 ? S.linToHex(e.map(x => x / emax)) : '#000000', emitStrength: emax > 0 ? emax * es : 0, transmission: ex.KHR_materials_transmission ? +ex.KHR_materials_transmission.transmissionFactor || 0 : 0, ior: ex.KHR_materials_ior ? +ex.KHR_materials_ior.ior || 1.45 : 1.45, image: img ? img.key : null };
    });
    const C = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1]; // Rx(+90): Y-up -> Z-up
    const localOf = (n, trs) => {
      if (!trs && n.matrix) return n.matrix.slice();
      const t = (trs && trs.t) || n.translation || [0, 0, 0], r = (trs && trs.r) || n.rotation || [0, 0, 0, 1], s = (trs && trs.s) || n.scale || [1, 1, 1];
      return S.matFromQuat(r, t, s);
    };
    const parent = new Map(); (J.nodes || []).forEach((n, i) => (n.children || []).forEach(c => parent.set(c, i)));
    const worldOf = (i, override) => { let m = localOf(J.nodes[i], override && override.get(i)); let p = parent.get(i); while (p !== undefined) { m = S.matMul(localOf(J.nodes[p], override && override.get(p)), m); p = parent.get(p); } return S.matMul(C, m); };
    // animation: sample node TRS at every key time
    const animKeys = new Map(); // node -> [{time, trs}]
    const anims = J.animations || [];
    if (anims.length) {
      const a = anims[0], perNode = new Map();
      a.channels.forEach(ch => {
        const smp = a.samplers[ch.sampler], nodeI = ch.target.node; if (nodeI === undefined || !['translation', 'rotation', 'scale'].includes(ch.target.path)) return;
        const tin = readAcc(smp.input), out = readAcc(smp.output), nc = ch.target.path === 'rotation' ? 4 : 3, cubic = smp.interpolation === 'CUBICSPLINE';
        if (!perNode.has(nodeI)) perNode.set(nodeI, {}); perNode.get(nodeI)[ch.target.path] = { tin, out, nc, cubic };
      });
      perNode.forEach((chs, nodeI) => {
        const times = new Set(); Object.values(chs).forEach(c => c.tin.forEach(t => times.add(Math.round(t * fps))));
        const val = (c, t) => { const n = c.tin.length, stride = c.cubic ? 3 : 1, at = i => Array.from(c.out.subarray((i * stride + (c.cubic ? 1 : 0)) * c.nc, (i * stride + (c.cubic ? 1 : 0)) * c.nc + c.nc)); if (t <= c.tin[0]) return at(0); if (t >= c.tin[n - 1]) return at(n - 1); let i = 0; while (c.tin[i + 1] < t) i++; const u = (t - c.tin[i]) / (c.tin[i + 1] - c.tin[i]), A = at(i), B = at(i + 1); if (c.nc === 4) { const d = A.reduce((s, x, k) => s + x * B[k], 0); if (d < 0) B.forEach((x, k) => B[k] = -x); const r = A.map((x, k) => x + (B[k] - x) * u), l = Math.hypot(...r) || 1; return r.map(x => x / l); } return A.map((x, k) => x + (B[k] - x) * u); };
        animKeys.set(nodeI, [...times].sort((x, y) => x - y).map(fr => ({ frame: fr, trs: { t: chs.translation && val(chs.translation, fr / fps), r: chs.rotation && val(chs.rotation, fr / fps), s: chs.scale && val(chs.scale, fr / fps) } })));
      });
    }
    const objects = [], sceneNodes = J.scenes && J.scenes[J.scene || 0] ? J.scenes[J.scene || 0].nodes : (J.nodes || []).map((_, i) => i).filter(i => !parent.has(i));
    const visit = i => {
      const n = J.nodes[i]; if (!n) return; const mw = worldOf(i), name = n.name || 'Node ' + i;
      let keys = null;
      if (animKeys.has(i)) {
        keys = { loc: [], rot: [], scale: [] };
        animKeys.get(i).forEach(({ frame, trs }) => { const ov = new Map([[i, { t: trs.t || n.translation, r: trs.r || n.rotation, s: trs.s || n.scale }]]); const d = S.decompose(worldOf(i, ov)); ['loc', 'rot', 'scale'].forEach(ch => keys[ch].push({ f: start + frame, v: ch === 'loc' ? d.loc : ch === 'rot' ? d.rot : d.scale, ease: 'linear' })); });
        // unwrap euler angles between keys
        for (let k = 1; k < keys.rot.length; k++) for (let c = 0; c < 3; c++) { let d = keys.rot[k].v[c] - keys.rot[k - 1].v[c]; while (d > Math.PI) { keys.rot[k].v[c] -= 2 * Math.PI; d -= 2 * Math.PI; } while (d < -Math.PI) { keys.rot[k].v[c] += 2 * Math.PI; d += 2 * Math.PI; } }
      }
      if (n.mesh !== undefined && J.meshes[n.mesh]) {
        const gm = J.meshes[n.mesh];
        gm.primitives.forEach((pr, pi) => {
          if ((pr.mode ?? 4) !== 4 || pr.attributes.POSITION === undefined) return;
          const P = readAcc(pr.attributes.POSITION), UV = pr.attributes.TEXCOORD_0 !== undefined ? readAcc(pr.attributes.TEXCOORD_0) : null;
          const I = pr.indices !== undefined ? readAcc(pr.indices) : Float32Array.from({ length: P.length / 3 }, (_, k) => k);
          const map = new Map(), v = [], f = [], uv = [], vid = new Int32Array(P.length / 3);
          for (let k = 0; k < P.length / 3; k++) { const key = Math.round(P[k * 3] * 1e5) + ',' + Math.round(P[k * 3 + 1] * 1e5) + ',' + Math.round(P[k * 3 + 2] * 1e5); if (!map.has(key)) { map.set(key, v.length); v.push([P[k * 3], P[k * 3 + 1], P[k * 3 + 2]]); } vid[k] = map.get(key); }
          for (let k = 0; k + 2 < I.length; k += 3) { const a = I[k], b = I[k + 1], c = I[k + 2]; f.push([vid[a], vid[b], vid[c]]); uv.push(UV ? [[UV[a * 2], 1 - UV[a * 2 + 1]], [UV[b * 2], 1 - UV[b * 2 + 1]], [UV[c * 2], 1 - UV[c * 2 + 1]]] : null); }
          const mesh = M.compact({ v, f, uv }).mesh;
          objects.push({ name: gm.primitives.length > 1 ? name + '.' + pi : name, type: 'mesh', mesh, matrix: mw, material: pr.material !== undefined ? 'mat' + pr.material : null, keys, smooth: pr.attributes.NORMAL !== undefined && isSmooth(mesh, readAcc(pr.attributes.NORMAL), vid) });
        });
      }
      if (n.camera !== undefined && J.cameras && J.cameras[n.camera] && J.cameras[n.camera].perspective) objects.push({ name, type: 'camera', matrix: mw, camera: { fov: J.cameras[n.camera].perspective.yfov * 180 / Math.PI }, keys });
      const le = n.extensions && n.extensions.KHR_lights_punctual, LP = J.extensions && J.extensions.KHR_lights_punctual;
      if (le && LP && LP.lights[le.light]) { const L = LP.lights[le.light], col = S.linToHex(L.color || [1, 1, 1]); objects.push({ name, type: 'light', matrix: mw, keys, light: L.type === 'directional' ? { kind: 'sun', color: col, strength: L.intensity ?? 1 } : { kind: 'point', color: col, power: (L.intensity ?? 1) * 4 * Math.PI } }); }
      (n.children || []).forEach(visit);
    };
    sceneNodes.forEach(visit);
    return { objects, materials, images: images.filter(Boolean) };
  }
  // were the stored normals smooth (shared at welded vertices)?
  function isSmooth(mesh, N, vid) {
    const first = new Map(); let diff = 0, same = 0;
    for (let k = 0; k < vid.length; k++) { const v = vid[k], n = [N[k * 3], N[k * 3 + 1], N[k * 3 + 2]]; if (!first.has(v)) first.set(v, n); else { const a = first.get(v); if (Math.abs(a[0] - n[0]) + Math.abs(a[1] - n[1]) + Math.abs(a[2] - n[2]) < 1e-3) same++; else diff++; } }
    return same > diff;
  }

  const api = { exportOBJ, importOBJ, parseMTL, exportSTL, importSTL, exportGLTF, importGLTF, b64enc, b64dec, dataUrlBytes, bytesToDataUrl };
  if (node) module.exports = api; else root.LIO = api;
})(typeof self !== 'undefined' ? self : this);
