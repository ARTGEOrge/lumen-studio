// Node tests for the path tracer: renders a small scene from a Lumen 3D document and checks pixels.
// Run: node model/tests/render.test.js [out.png]
const M = require('../js/mesh.js'), S = require('../js/scene.js'), PT = require('../js/pt.js');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };

// BVH sanity: every triangle reachable, ray hits the closest one
{
  const tri = M.toTriangles(M.icoSphere(3)); const bvh = PT.buildBVH(tri.pos, tri.count);
  const seen = new Set(); for (let n = 0; n < bvh.nNodes; n++) { const c = bvh.ni[n * 2 + 1]; if (c) for (let i = 0; i < c; i++) seen.add(bvh.ni[n * 2] + i); }
  ok(seen.size === tri.count, 'bvh leaves cover all triangles');
  const sc = PT.prepare({ pos: tri.pos, nor: tri.nor, uv: tri.uv, mat: new Int32Array(tri.count), materials: [{}], lights: [], camera: { pos: [0, -5, 0], dir: [0, 1, 0], up: [0, 0, 1] }, width: 4, height: 4 });
  ok(PT.intersect(sc, 0, -5, 0, 0, 1, 0, 1e30, false) && Math.abs(PT.hit.t - 4) < 0.02, 'ray hits sphere front at t~4: ' + PT.hit.t);
  ok(!PT.intersect(sc, 0, -5, 3, 0, 1, 0, 1e30, false), 'ray misses above sphere');
}

function sceneDoc() {
  const d = S.newDoc();
  const grey = S.newMaterial('Floor', '#b0b0b0', { rough: 0.8 }), red = S.newMaterial('Red', '#e01010', { rough: 0.4 }), lamp = S.newMaterial('Panel', '#ffffff', { emit: '#ffffff', emitStrength: 8 }), chrome = S.newMaterial('Chrome', '#ffffff', { metal: 1, rough: 0.05 });
  d.materials.push(grey, red, lamp, chrome);
  d.objects.push(S.newObject('mesh', 'Floor', { mesh: M.plane(6), mat: grey.id }));
  d.objects.push(S.newObject('mesh', 'Ball', { mesh: M.uvSphere(32, 16, 1), smooth: true, loc: [-1.2, 0, 1], mat: red.id }));
  d.objects.push(S.newObject('mesh', 'Chrome', { mesh: M.uvSphere(32, 16, 0.8), smooth: true, loc: [1.3, 0.3, 0.8], mat: chrome.id }));
  d.objects.push(S.newObject('mesh', 'Panel', { mesh: M.plane(0.8), loc: [0, 2.5, 3.2], rot: [2.4, 0, 0], mat: lamp.id }));
  d.objects.push(S.newObject('light', 'Sun', { rot: [0.5, 0.3, 0], light: { kind: 'sun', strength: 2.5, angle: 0.05 } }));
  d.objects.push(S.newObject('camera', 'Camera', { loc: [0, -7, 2.6], rot: [1.25, 0, 0], camera: { fov: 45 } }));
  return d;
}
const W = 96, H = 64;
const d = sceneDoc(), sc = S.renderScene(d, { width: W, height: H }), P = PT.prepare(sc);
ok(P.em.length === 2, 'emissive panel found as light (2 tris)');
const acc = new Float64Array(W * H * 3), N = 48, t0 = Date.now();
for (let s = 0; s < N; s++) { const rows = PT.renderRows(P, 0, H, s); for (let i = 0; i < rows.length; i++) acc[i] += rows[i]; }
const ms = Date.now() - t0;
const img = PT.tonemap(acc, N, W, H, 0);
// project a world point to pixel coordinates using the same camera
const cam = P.cam; const proj = p => { const v = [p[0] - cam.pos[0], p[1] - cam.pos[1], p[2] - cam.pos[2]], z = v[0] * cam.f[0] + v[1] * cam.f[1] + v[2] * cam.f[2], x = (v[0] * cam.r[0] + v[1] * cam.r[1] + v[2] * cam.r[2]) / z / cam.tanH / (W / H), y = (v[0] * cam.u[0] + v[1] * cam.u[1] + v[2] * cam.u[2]) / z / cam.tanH; return [Math.round((x + 1) / 2 * W), Math.round((1 - y) / 2 * H)]; };
const px = (x, y) => { let r = 0, g = 0, b = 0, n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const i = ((y + dy) * W + (x + dx)) * 4; r += img[i]; g += img[i + 1]; b += img[i + 2]; n++; } return [r / n, g / n, b / n]; };
const red = px(...proj([-1.2, -0.6, 1.1])); ok(red[0] > 90 && red[0] > red[1] * 2 && red[0] > red[2] * 2, 'red ball is red ' + red.map(Math.round));
const sky = px(4, 2); ok(sky[2] > sky[0] && sky[2] > 60, 'sky is blue-ish ' + sky.map(Math.round));
const panel = px(...proj([0, 2.5, 3.2])); ok(Math.min(...panel) > 200, 'emissive panel is bright ' + panel.map(Math.round));
const floorLit = px(...proj([0.2, -2.5, 0])), lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
// shadow of the red ball: sun dir from rot [0.5,0.3,0]
const sun = P.lights[0].dir, tShadow = 1 / -sun[2], shadowPt = [-1.2 + sun[0] * tShadow, 0 + sun[1] * tShadow, 0];
const floorShadow = px(...proj(shadowPt)); ok(lum(floorShadow) < lum(floorLit) * 0.8, `ball casts a shadow (${Math.round(lum(floorShadow))} vs lit ${Math.round(lum(floorLit))})`);
const chrome = px(...proj([1.3, -0.5, 0.8])); ok(lum(chrome) > 20, 'chrome ball reflects ' + chrome.map(Math.round));
// convergence: noise drops with samples (compare two independent halves)
{
  const a = new Float64Array(W * H * 3), b = new Float64Array(W * H * 3);
  for (let s = 0; s < 8; s++) { const r1 = PT.renderRows(P, 0, H, 1000 + s), r2 = PT.renderRows(P, 0, H, 2000 + s); for (let i = 0; i < r1.length; i++) { a[i] += r1[i]; b[i] += r2[i]; } }
  let d8 = 0; for (let i = 0; i < a.length; i++) d8 += Math.abs(a[i] / 8 - b[i] / 8);
  let d1 = 0; const r1 = PT.renderRows(P, 0, H, 3000), r2 = PT.renderRows(P, 0, H, 4000); for (let i = 0; i < r1.length; i++) d1 += Math.abs(r1[i] - r2[i]);
  ok(d8 < d1 * 0.6, `progressive refinement reduces noise (8spp diff ${d8.toFixed(1)} < 1spp diff ${d1.toFixed(1)})`);
}
// denoiser: 4 spp denoised must be closer to a 160 spp reference than 4 spp raw
{
  const lo = new Float64Array(W * H * 3), aux = new Float64Array(W * H * PT.AUX), n = 4;
  for (let s = 0; s < n; s++) { const r = PT.renderRows(P, 0, H, 5000 + s); for (let i = 0; i < r.length; i++) lo[i] += r[i]; for (let i = 0; i < r.aux.length; i++) aux[i] += r.aux[i]; }
  const refAcc = Float64Array.from(acc); for (let s = 0; s < 112; s++) { const r = PT.renderRows(P, 0, H, 9000 + s); for (let i = 0; i < r.length; i++) refAcc[i] += r[i]; }
  const ref = PT.tonemap(refAcc, N + 112, W, H, 0), raw = PT.tonemap(lo, n, W, H, 0), dn = PT.tonemap(PT.denoise(lo, aux, n, W, H), 1, W, H, 0);
  const err = img2 => { let e = 0; for (let i = 0; i < img2.length; i += 4) for (let k = 0; k < 3; k++) e += (img2[i + k] - ref[i + k]) ** 2; return Math.sqrt(e / (W * H * 3)); };
  const eRaw = err(raw), eDn = err(dn); ok(eDn < eRaw, `denoiser reduces error vs reference (raw ${eRaw.toFixed(1)} -> denoised ${eDn.toFixed(1)})`);
  // flat floor patch in front of the balls: noise must drop a lot while the mean brightness is preserved
  const patch = (img2) => { const c = proj([0, -3.2, 0]), v = []; for (let y = c[1] - 3; y <= c[1] + 3; y++) for (let x = c[0] - 6; x <= c[0] + 6; x++) { const i = (y * W + x) * 4; v.push((img2[i] + img2[i + 1] + img2[i + 2]) / 3); } const m = v.reduce((a, b) => a + b, 0) / v.length; return { m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) }; };
  const pr = patch(raw), pd = patch(dn), pf = patch(ref);
  ok(pd.sd < pr.sd * 0.5, `denoiser smooths a flat region (sd ${pr.sd.toFixed(2)} -> ${pd.sd.toFixed(2)})`);
  ok(Math.abs(pd.m - pf.m) < Math.max(4, pf.m * 0.05), `denoiser keeps brightness (ref ${pf.m.toFixed(1)}, denoised ${pd.m.toFixed(1)})`);
  if (process.argv[3]) { global.__dn = dn; }
}
console.log(`render: ${W}x${H} ${N}spp in ${ms} ms`);
if (process.argv[2]) { // write PNG for a visual check
  const zlib = require('zlib'), raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; Buffer.from(img.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1); }
  const crc = b => { let c, t = []; for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  require('fs').writeFileSync(process.argv[2], Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
console.log(`render tests: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
