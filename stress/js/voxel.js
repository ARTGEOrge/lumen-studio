// Lumen Stress — 3-D: STL reading, welding, face segmentation (CAD-like faces from the triangle mesh), and voxel
// meshing: the closed surface is filled with equal cubes (inside test by ray parity along three axes, majority vote),
// the largest face-connected body is kept, and every exposed voxel face is assigned to the nearest STL face so that
// supports and loads picked on the STL act on the voxel model.
(function (root, factory) { const m = factory(); if (typeof module === 'object' && module.exports) module.exports = m; else root.StressVoxel = m; })(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- STL ----------
  function parseSTL(data) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const n = u8.length >= 84 ? dv.getUint32(80, true) : 0;
    if (n > 0 && u8.length === 84 + n * 50) {
      const out = new Float32Array(n * 9);
      for (let k = 0; k < n; k++) for (let j = 0; j < 9; j++) out[k * 9 + j] = dv.getFloat32(84 + k * 50 + 12 + j * 4, true);
      return out;
    }
    const txt = new TextDecoder().decode(u8.subarray(0, Math.min(u8.length, 400e6))), re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g, v = []; let m;
    while ((m = re.exec(txt))) v.push(+m[1], +m[2], +m[3]);
    if (v.length < 9 || v.some(x => !isFinite(x))) throw new Error('No triangles found — is this an STL file?');
    return new Float32Array(v.slice(0, Math.floor(v.length / 9) * 9));
  }
  function toSTL(tris, name = 'Lumen Stress') {
    const n = tris.length / 9, buf = new ArrayBuffer(84 + n * 50), dv = new DataView(buf);
    for (let i = 0; i < Math.min(79, name.length); i++) dv.setUint8(i, name.charCodeAt(i) & 127);
    dv.setUint32(80, n, true);
    for (let k = 0; k < n; k++) {
      const o = 84 + k * 50, t = tris.subarray(k * 9, k * 9 + 9), ux = t[3] - t[0], uy = t[4] - t[1], uz = t[5] - t[2], vx = t[6] - t[0], vy = t[7] - t[1], vz = t[8] - t[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      dv.setFloat32(o, nx / l, true); dv.setFloat32(o + 4, ny / l, true); dv.setFloat32(o + 8, nz / l, true);
      for (let j = 0; j < 9; j++) dv.setFloat32(o + 12 + j * 4, t[j], true);
    }
    return new Uint8Array(buf);
  }
  function bbox(tris) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < tris.length; i += 3) for (let c = 0; c < 3; c++) { const v = tris[i + c]; if (v < mn[c]) mn[c] = v; if (v > mx[c]) mx[c] = v; }
    return { min: mn, max: mx, size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]], diag: Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) };
  }
  // signed volume (divergence theorem) and area
  function volume(tris) { let V = 0; for (let k = 0; k < tris.length; k += 9) { const a = tris.subarray(k, k + 3), b = tris.subarray(k + 3, k + 6), c = tris.subarray(k + 6, k + 9); V += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; } return V; }
  function triNormal(tris, k) {
    const o = k * 9, ux = tris[o + 3] - tris[o], uy = tris[o + 4] - tris[o + 1], uz = tris[o + 5] - tris[o + 2], vx = tris[o + 6] - tris[o], vy = tris[o + 7] - tris[o + 1], vz = tris[o + 8] - tris[o + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz); return l ? [nx / l, ny / l, nz / l, l / 2] : [0, 0, 0, 0];
  }

  // ---------- faces: region-grow triangles across edges whose normals differ by < angle ----------
  function segmentFaces(tris, angleDeg = 30) {
    const n = tris.length / 9, bb = bbox(tris), q = 1e6 / (bb.diag || 1), key = (x, y, z) => Math.round(x * q) + ',' + Math.round(y * q) + ',' + Math.round(z * q);
    const vid = new Map(), tv = new Int32Array(n * 3);
    for (let k = 0; k < n; k++) for (let j = 0; j < 3; j++) { const o = k * 9 + j * 3, s = key(tris[o], tris[o + 1], tris[o + 2]); let id = vid.get(s); if (id == null) { id = vid.size; vid.set(s, id); } tv[k * 3 + j] = id; }
    const edges = new Map(), nrm = []; for (let k = 0; k < n; k++) nrm.push(triNormal(tris, k));
    for (let k = 0; k < n; k++) for (let j = 0; j < 3; j++) { const a = tv[k * 3 + j], b = tv[k * 3 + (j + 1) % 3], s = a < b ? a + ',' + b : b + ',' + a; let l = edges.get(s); if (!l) edges.set(s, l = []); l.push(k); }
    const face = new Int32Array(n).fill(-1), cosT = Math.cos(angleDeg * Math.PI / 180), faces = [];
    let open = 0; for (const l of edges.values()) if (l.length !== 2) open++;
    for (let s = 0; s < n; s++) {
      if (face[s] >= 0 || nrm[s][3] === 0) continue;
      const id = faces.length, st = [s], tl = []; face[s] = id;
      while (st.length) {
        const k = st.pop(); tl.push(k);
        for (let j = 0; j < 3; j++) {
          const a = tv[k * 3 + j], b = tv[k * 3 + (j + 1) % 3], l = edges.get(a < b ? a + ',' + b : b + ',' + a);
          if (!l || l.length !== 2) continue;
          for (const m of l) if (m !== k && face[m] < 0 && nrm[m][3] > 0 && nrm[m][0] * nrm[k][0] + nrm[m][1] * nrm[k][1] + nrm[m][2] * nrm[k][2] >= cosT) { face[m] = id; st.push(m); }
        }
      }
      let A = 0, nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
      for (const k of tl) { const [a, b, c, ar] = nrm[k]; A += ar; nx += a * ar; ny += b * ar; nz += c * ar; for (let j = 0; j < 3; j++) { cx += tris[k * 9 + j * 3] * ar / 3; cy += tris[k * 9 + j * 3 + 1] * ar / 3; cz += tris[k * 9 + j * 3 + 2] * ar / 3; } }
      const nl = Math.hypot(nx, ny, nz) || 1;
      faces.push({ id, tris: tl, area: A, normal: [nx / nl, ny / nl, nz / nl], planar: nl / (A || 1) > 0.999, centroid: [cx / A, cy / A, cz / A] });
    }
    // feature edges: boundaries between faces (and open edges), as xyz pairs for drawing
    const fe = [];
    for (const [k, l] of edges) if (l.length !== 2 || face[l[0]] !== face[l[1]]) { const t = l[0]; for (let j = 0; j < 3; j++) { const a = tv[t * 3 + j], b = tv[t * 3 + (j + 1) % 3], kk = a < b ? a + ',' + b : b + ',' + a; if (kk === k) { const o1 = t * 9 + j * 3, o2 = t * 9 + ((j + 1) % 3) * 3; fe.push(tris[o1], tris[o1 + 1], tris[o1 + 2], tris[o2], tris[o2 + 1], tris[o2 + 2]); break; } } }
    return { face, faces, normals: nrm, openEdges: open, watertight: open === 0, featureEdges: new Float32Array(fe) };
  }

  // ---------- inside test by ray parity on a 2-D bin grid of triangles ----------
  function rayCaster(tris, axis) {
    const u = (axis + 1) % 3, v = (axis + 2) % 3, n = tris.length / 9, bb = bbox(tris), B = Math.max(8, Math.min(256, Math.ceil(Math.sqrt(n) / 2)));
    const u0 = bb.min[u], v0 = bb.min[v], du = (bb.size[u] || 1) / B, dvv = (bb.size[v] || 1) / B, bins = Array.from({ length: B * B }, () => []);
    for (let k = 0; k < n; k++) {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (let j = 0; j < 3; j++) { const x = tris[k * 9 + j * 3 + u], y = tris[k * 9 + j * 3 + v]; a0 = Math.min(a0, x); a1 = Math.max(a1, x); b0 = Math.min(b0, y); b1 = Math.max(b1, y); }
      const i0 = Math.max(0, Math.floor((a0 - u0) / du)), i1 = Math.min(B - 1, Math.floor((a1 - u0) / du)), j0 = Math.max(0, Math.floor((b0 - v0) / dvv)), j1 = Math.min(B - 1, Math.floor((b1 - v0) / dvv));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) bins[j * B + i].push(k);
    }
    // crossings of the line {u = pu, v = pv} along `axis`: sorted list of axis coordinates
    return (pu, pv) => {
      const i = Math.min(B - 1, Math.max(0, Math.floor((pu - u0) / du))), j = Math.min(B - 1, Math.max(0, Math.floor((pv - v0) / dvv))), hits = [];
      for (const k of bins[j * B + i]) {
        const o = k * 9, ax = tris[o + u], ay = tris[o + v], bx = tris[o + 3 + u], by = tris[o + 3 + v], cx = tris[o + 6 + u], cy = tris[o + 6 + v];
        const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (d === 0) continue;
        const l1 = ((by - cy) * (pu - cx) + (cx - bx) * (pv - cy)) / d, l2 = ((cy - ay) * (pu - cx) + (ax - cx) * (pv - cy)) / d, l3 = 1 - l1 - l2;
        if (l1 < 0 || l2 < 0 || l3 < 0) continue;
        hits.push(l1 * tris[o + axis] + l2 * tris[o + 3 + axis] + l3 * tris[o + 6 + axis]);
      }
      hits.sort((a, b) => a - b);
      // merge duplicates (ray through a shared edge hits two triangles at the same point)
      const out = []; for (const h of hits) if (!out.length || Math.abs(h - out[out.length - 1]) > 1e-9 * (bb.diag || 1)) out.push(h);
      return out;
    };
  }

  // ---------- voxel mesh ----------
  // Rectilinear grid: grid planes are placed on the bounding box and on every axis-aligned flat face of the part, and the
  // gaps between them are split into near-cubic cells of size ≈ h. Prismatic parts are therefore captured exactly;
  // inclined and curved faces are stair-stepped.
  // opts: {target (approx. cell count) | h}; returns {kind:'H8', h, lines:[xs,ys,zs], nodes, elems, quads:{…}, stats}
  function gridLines(tris, seg, h) {
    const bb = bbox(tris), lines = [];
    for (let c = 0; c < 3; c++) {
      const bp = [bb.min[c], bb.max[c]];
      if (seg) for (const f of seg.faces) if (f.planar && Math.abs(f.normal[c]) > 0.9995 && f.area > 0.05 * h * h) bp.push(f.centroid[c]);
      bp.sort((a, b) => a - b);
      const keep = [bp[0]]; for (const v of bp) if (v - keep[keep.length - 1] > 0.3 * h) keep.push(v);
      if (bb.max[c] - keep[keep.length - 1] > 1e-9) { if (bb.max[c] - keep[keep.length - 1] < 0.3 * h && keep.length > 1) keep[keep.length - 1] = bb.max[c]; else keep.push(bb.max[c]); }
      const L = [keep[0]];
      for (let i = 1; i < keep.length; i++) { const g = keep[i] - keep[i - 1], n = Math.max(1, Math.round(g / h)); for (let k = 1; k <= n; k++) L.push(keep[i - 1] + g * k / n); }
      if (L.length < 2) L.push(L[0] + h);
      lines.push(Float64Array.from(L));
    }
    return lines;
  }
  function voxelize(tris, opts = {}) {
    const t0 = Date.now(), bb = bbox(tris), V = Math.abs(volume(tris));
    if (!(V > 0)) throw new Error('The surface encloses no volume — the STL must be a closed solid.');
    let h = +opts.h || Math.cbrt(V / Math.max(100, +opts.target || 15000));
    const GL = gridLines(tris, opts.seg, h), [nx, ny, nz] = GL.map(l => l.length - 1), N = [nx, ny, nz];
    if (nx * ny * nz > 8e6) throw new Error('The voxel grid would be too large; choose fewer elements.');
    const solid = new Uint8Array(nx * ny * nz), idx = (i, j, k) => (k * ny + j) * nx + i, mid = (c, i) => (GL[c][i] + GL[c][i + 1]) / 2;
    // vote of three axis-aligned ray families (robust to small leaks in the surface); a tiny offset avoids hitting edges exactly
    for (let axis = 0; axis < 3; axis++) {
      const cast = rayCaster(tris, axis), u = (axis + 1) % 3, v = (axis + 2) % 3;
      for (let b = 0; b < N[v]; b++) for (let a = 0; a < N[u]; a++) {
        const pu = mid(u, a) + 1.3e-5 * (GL[u][a + 1] - GL[u][a]), pv = mid(v, b) - 2.1e-5 * (GL[v][b + 1] - GL[v][b]), hits = cast(pu, pv);
        if (!hits.length) continue;
        let p = 0;
        for (let c = 0; c < N[axis]; c++) {
          const x = mid(axis, c); while (p < hits.length && hits[p] < x) p++;
          if (p & 1) { const ijk = [0, 0, 0]; ijk[axis] = c; ijk[u] = a; ijk[v] = b; solid[idx(ijk[0], ijk[1], ijk[2])]++; }
        }
      }
    }
    for (let i = 0; i < solid.length; i++) solid[i] = solid[i] >= 2 ? 1 : 0;
    // keep the largest face-connected component
    const comp = new Int32Array(solid.length).fill(-1); let best = -1, bestN = 0, ncomp = 0;
    for (let s = 0; s < solid.length; s++) {
      if (!solid[s] || comp[s] >= 0) continue;
      const st = [s]; comp[s] = ncomp; let cnt = 0;
      while (st.length) {
        const c = st.pop(); cnt++; const i = c % nx, j = Math.floor(c / nx) % ny, k = Math.floor(c / (nx * ny));
        const nb = [i > 0 ? c - 1 : -1, i < nx - 1 ? c + 1 : -1, j > 0 ? c - nx : -1, j < ny - 1 ? c + nx : -1, k > 0 ? c - nx * ny : -1, k < nz - 1 ? c + nx * ny : -1];
        for (const d of nb) if (d >= 0 && solid[d] && comp[d] < 0) { comp[d] = ncomp; st.push(d); }
      }
      if (cnt > bestN) { bestN = cnt; best = ncomp; } ncomp++;
    }
    let dropped = 0; for (let s = 0; s < solid.length; s++) if (solid[s] && comp[s] !== best) { solid[s] = 0; dropped++; }
    if (!bestN) throw new Error('No voxels fell inside the part — try more elements.');
    // nodes and elements
    const NX = nx + 1, NY = ny + 1, nodeId = new Int32Array(NX * NY * (nz + 1)).fill(-1), nodes = [], elems = [];
    const nid = (i, j, k) => { const g = (k * NY + j) * NX + i; if (nodeId[g] < 0) { nodeId[g] = nodes.length / 3; nodes.push(GL[0][i], GL[1][j], GL[2][k]); } return nodeId[g]; };
    const corner = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
    const elemOf = new Int32Array(solid.length).fill(-1);
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (solid[idx(i, j, k)]) { elemOf[idx(i, j, k)] = elems.length / 8; for (const [a, b, c] of corner) elems.push(nid(i + a, j + b, k + c)); }
    // exposed faces (quads, counter-clockwise seen from outside)
    const FACES = [[[-1, 0, 0], [0, 4, 7, 3]], [[1, 0, 0], [1, 2, 6, 5]], [[0, -1, 0], [0, 1, 5, 4]], [[0, 1, 0], [3, 7, 6, 2]], [[0, 0, -1], [0, 3, 2, 1]], [[0, 0, 1], [4, 5, 6, 7]]];
    const qn = [], qnorm = [], qelem = [];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const e = elemOf[idx(i, j, k)]; if (e < 0) continue;
      for (const [d, f] of FACES) {
        const a = i + d[0], b = j + d[1], c = k + d[2];
        if (a >= 0 && b >= 0 && c >= 0 && a < nx && b < ny && c < nz && solid[idx(a, b, c)]) continue;
        for (const q of f) qn.push(elems[e * 8 + q]); qnorm.push(d); qelem.push(e);
      }
    }
    return {
      kind: 'H8', h, lines: GL, nodes: new Float64Array(nodes), elems: new Int32Array(elems),
      quads: { n: new Int32Array(qn), normal: qnorm, elem: new Int32Array(qelem), face: new Int32Array(qn.length / 4).fill(-1), tri: new Int32Array(qn.length / 4).fill(-1) },
      stats: { nodes: nodes.length / 3, elements: elems.length / 8, h, volume: cellVolume(nodes, elems), stlVolume: V, dropped, ms: Date.now() - t0 }
    };
  }

  function cellVolume(P, E) { let v = 0; for (let e = 0; e < E.length; e += 8) { const a = E[e] * 3, g = E[e + 6] * 3; v += (P[g] - P[a]) * (P[g + 1] - P[a + 1]) * (P[g + 2] - P[a + 2]); } return v; }
  function quadArea(vm, q) { const P = vm.nodes, n = vm.quads.n, a = n[q * 4] * 3, c = n[q * 4 + 2] * 3; let A = 1; for (let k = 0; k < 3; k++) { const d = Math.abs(P[c + k] - P[a + k]); if (d > 1e-12) A *= d; } return A; }
  // assign every exposed voxel quad to the nearest STL face whose normal agrees (spatial hash of triangles)
  function assignFaces(vm, tris, seg) {
    const h = vm.h, reach = 1.2 * h, cell = Math.max(reach, h), bb = bbox(tris), map = new Map();
    const key = (i, j, k) => i + ',' + j + ',' + k, n = tris.length / 9;
    for (let t = 0; t < n; t++) {
      if (seg.face[t] < 0) continue;
      let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
      for (let j = 0; j < 3; j++) for (let c = 0; c < 3; c++) { const v = tris[t * 9 + j * 3 + c]; mn[c] = Math.min(mn[c], v); mx[c] = Math.max(mx[c], v); }
      const a = mn.map((v, c) => Math.floor((v - reach - bb.min[c]) / cell)), b = mx.map((v, c) => Math.floor((v + reach - bb.min[c]) / cell));
      if ((b[0] - a[0] + 1) * (b[1] - a[1] + 1) * (b[2] - a[2] + 1) > 200000) continue;
      for (let i = a[0]; i <= b[0]; i++) for (let j = a[1]; j <= b[1]; j++) for (let k = a[2]; k <= b[2]; k++) { const s = key(i, j, k); let l = map.get(s); if (!l) map.set(s, l = []); l.push(t); }
    }
    const Q = vm.quads, P = vm.nodes, nq = Q.n.length / 4;
    for (let q = 0; q < nq; q++) {
      let cx = 0, cy = 0, cz = 0; for (let j = 0; j < 4; j++) { const v = Q.n[q * 4 + j]; cx += P[v * 3] / 4; cy += P[v * 3 + 1] / 4; cz += P[v * 3 + 2] / 4; }
      const l = map.get(key(Math.floor((cx - bb.min[0]) / cell), Math.floor((cy - bb.min[1]) / cell), Math.floor((cz - bb.min[2]) / cell))); if (!l) continue;
      const qn = Q.normal[q]; let best = -1, bs = Infinity;
      for (const t of l) {
        const nt = seg.normals[t], agree = nt[0] * qn[0] + nt[1] * qn[1] + nt[2] * qn[2]; if (agree < 0.25) continue;
        const d = pointTriDist(cx, cy, cz, tris, t); if (d > reach) continue;
        const score = d - 0.35 * h * agree; if (score < bs) { bs = score; best = t; }
      }
      if (best >= 0) { Q.face[q] = seg.face[best]; Q.tri[q] = best; }
    }
    return vm;
  }
  function pointTriDist(px, py, pz, T, t) {
    const o = t * 9, a = [T[o], T[o + 1], T[o + 2]], b = [T[o + 3], T[o + 4], T[o + 5]], c = [T[o + 6], T[o + 7], T[o + 8]];
    const sub = (u, v) => [u[0] - v[0], u[1] - v[1], u[2] - v[2]], dt = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2], p = [px, py, pz];
    const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a), d1 = dt(ab, ap), d2 = dt(ac, ap);
    let q;
    if (d1 <= 0 && d2 <= 0) q = a; else {
      const bp = sub(p, b), d3 = dt(ab, bp), d4 = dt(ac, bp);
      if (d3 >= 0 && d4 <= d3) q = b; else {
        const vc = d1 * d4 - d3 * d2;
        if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); q = [a[0] + v * ab[0], a[1] + v * ab[1], a[2] + v * ab[2]]; } else {
          const cp = sub(p, c), d5 = dt(ab, cp), d6 = dt(ac, cp);
          if (d6 >= 0 && d5 <= d6) q = c; else {
            const vb = d5 * d2 - d1 * d6;
            if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); q = [a[0] + w * ac[0], a[1] + w * ac[1], a[2] + w * ac[2]]; } else {
              const va = d3 * d6 - d5 * d4;
              if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); q = [b[0] + w * (c[0] - b[0]), b[1] + w * (c[1] - b[1]), b[2] + w * (c[2] - b[2])]; } else {
                const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; q = [a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w];
              }
            }
          }
        }
      }
    }
    return Math.hypot(px - q[0], py - q[1], pz - q[2]);
  }

  // simple closed solids for samples/tests
  function boxTris(x0, y0, z0, x1, y1, z1) {
    const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    const q = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]], out = [];
    for (const [a, b, c, d] of q) out.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
    return new Float32Array(out);
  }

  return { quadArea, cellVolume, gridLines, parseSTL, toSTL, bbox, volume, triNormal, segmentFaces, rayCaster, voxelize, assignFaces, pointTriDist, boxTris };
});
