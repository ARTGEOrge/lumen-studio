// Lumen 3D — progressive CPU path tracer (BVH, GGX metal/rough, glass, emission, point/sun lights,
// emissive-triangle light sampling with MIS, textures, depth of field). Runs in Web Workers and in Node.
(function (root) {
  'use strict';
  const PI = Math.PI, INV_PI = 1 / Math.PI, EPS = 1e-4, AUX = 8, ALB_MIN = 0.08; // aux per pixel: albedo rgb, normal xyz, depth, luminance^2

  // ---------- BVH ----------
  function buildBVH(P, nTri) { // P: Float32Array 9*nTri
    const cen = new Float32Array(nTri * 3), bmin = new Float32Array(nTri * 3), bmax = new Float32Array(nTri * 3);
    for (let i = 0; i < nTri; i++) for (let k = 0; k < 3; k++) {
      const a = P[i * 9 + k], b = P[i * 9 + 3 + k], c = P[i * 9 + 6 + k];
      bmin[i * 3 + k] = Math.min(a, b, c); bmax[i * 3 + k] = Math.max(a, b, c); cen[i * 3 + k] = (a + b + c) / 3;
    }
    const idx = new Uint32Array(nTri); for (let i = 0; i < nTri; i++) idx[i] = i;
    const maxNodes = Math.max(1, 2 * nTri), nb = new Float32Array(maxNodes * 6), ni = new Int32Array(maxNodes * 2); // [leftChild|first, count]
    let nNodes = 0;
    const BINS = 12, bc = new Int32Array(BINS), bbx = new Float32Array(BINS * 6);
    const stack = [[0, nTri, nNodes++]];
    while (stack.length) {
      const [start, end, node] = stack.pop();
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity, cx0 = Infinity, cy0 = Infinity, cz0 = Infinity, cx1 = -Infinity, cy1 = -Infinity, cz1 = -Infinity;
      for (let i = start; i < end; i++) {
        const t = idx[i] * 3;
        if (bmin[t] < x0) x0 = bmin[t]; if (bmin[t + 1] < y0) y0 = bmin[t + 1]; if (bmin[t + 2] < z0) z0 = bmin[t + 2];
        if (bmax[t] > x1) x1 = bmax[t]; if (bmax[t + 1] > y1) y1 = bmax[t + 1]; if (bmax[t + 2] > z1) z1 = bmax[t + 2];
        if (cen[t] < cx0) cx0 = cen[t]; if (cen[t + 1] < cy0) cy0 = cen[t + 1]; if (cen[t + 2] < cz0) cz0 = cen[t + 2];
        if (cen[t] > cx1) cx1 = cen[t]; if (cen[t + 1] > cy1) cy1 = cen[t + 1]; if (cen[t + 2] > cz1) cz1 = cen[t + 2];
      }
      nb.set([x0, y0, z0, x1, y1, z1], node * 6);
      const n = end - start;
      if (n <= 4) { ni[node * 2] = start; ni[node * 2 + 1] = n; continue; }
      const ext = [cx1 - cx0, cy1 - cy0, cz1 - cz0], lo = [cx0, cy0, cz0];
      const axis = ext[0] >= ext[1] && ext[0] >= ext[2] ? 0 : ext[1] >= ext[2] ? 1 : 2;
      let mid = -1;
      if (ext[axis] > 1e-12) {
        // binned SAH
        bc.fill(0); for (let b = 0; b < BINS; b++) bbx.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], b * 6);
        const sc = BINS / ext[axis];
        for (let i = start; i < end; i++) {
          const t = idx[i] * 3; let b = Math.min(BINS - 1, ((cen[t + axis] - lo[axis]) * sc) | 0); bc[b]++;
          for (let k = 0; k < 3; k++) { if (bmin[t + k] < bbx[b * 6 + k]) bbx[b * 6 + k] = bmin[t + k]; if (bmax[t + k] > bbx[b * 6 + 3 + k]) bbx[b * 6 + 3 + k] = bmax[t + k]; }
        }
        const area = (b) => { const dx = b[3] - b[0], dy = b[4] - b[1], dz = b[5] - b[2]; return dx < 0 ? 0 : dx * dy + dy * dz + dz * dx; };
        let best = Infinity, bestB = -1;
        const leftA = [], leftN = [];
        let acc = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], cnt = 0;
        for (let b = 0; b < BINS - 1; b++) { cnt += bc[b]; for (let k = 0; k < 3; k++) { acc[k] = Math.min(acc[k], bbx[b * 6 + k]); acc[3 + k] = Math.max(acc[3 + k], bbx[b * 6 + 3 + k]); } leftA[b] = area(acc); leftN[b] = cnt; }
        acc = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; cnt = 0;
        for (let b = BINS - 1; b > 0; b--) {
          cnt += bc[b]; for (let k = 0; k < 3; k++) { acc[k] = Math.min(acc[k], bbx[b * 6 + k]); acc[3 + k] = Math.max(acc[3 + k], bbx[b * 6 + 3 + k]); }
          const cost = leftA[b - 1] * leftN[b - 1] + area(acc) * cnt; if (leftN[b - 1] && cnt && cost < best) { best = cost; bestB = b; }
        }
        if (bestB > 0) {
          const split = lo[axis] + bestB / sc; let i = start, j = end - 1;
          while (i <= j) { if (cen[idx[i] * 3 + axis] < split) i++; else { const t = idx[i]; idx[i] = idx[j]; idx[j] = t; j--; } }
          mid = i;
        }
      }
      if (mid <= start || mid >= end) mid = (start + end) >> 1;
      const l = nNodes++, r = nNodes++; ni[node * 2] = l; ni[node * 2 + 1] = 0;
      stack.push([start, mid, l], [mid, end, r]);
    }
    return { nb: nb.subarray(0, nNodes * 6), ni: ni.subarray(0, nNodes * 2), idx, nNodes };
  }

  // ---------- scene ----------
  // input: { pos: Float32Array 9n, nor: 9n, uv: 6n, mat: Int32Array n, materials:[{color,metal,rough,emit,emitStrength,transmission,ior,tex}],
  //          lights:[{type:'point'|'sun', pos, dir, color, power|strength, radius}], world:{color, strength, horizon, zenith, sky},
  //          camera:{pos, dir, up, fov(deg vertical), aperture, focus}, width, height, bounces }
  function srgbToLin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  const LUT = new Float32Array(256); for (let i = 0; i < 256; i++) LUT[i] = srgbToLin(i / 255);
  function prepare(sc) {
    const n = sc.mat.length, bvh = buildBVH(sc.pos, n);
    // reorder triangle data in BVH order for locality
    const P = new Float32Array(n * 9), N = new Float32Array(n * 9), U = new Float32Array(n * 6), Mt = new Int32Array(n);
    for (let i = 0; i < n; i++) { const s = bvh.idx[i]; P.set(sc.pos.subarray(s * 9, s * 9 + 9), i * 9); N.set(sc.nor.subarray(s * 9, s * 9 + 9), i * 9); U.set(sc.uv.subarray(s * 6, s * 6 + 6), i * 6); Mt[i] = sc.mat[s]; }
    const mats = sc.materials.map(m => ({ color: m.color || [0.8, 0.8, 0.8], metal: m.metal || 0, rough: Math.max(0.03, Math.min(1, m.rough ?? 0.5)), emit: (m.emit || [0, 0, 0]).map(x => x * (m.emitStrength ?? 1)), transmission: m.transmission || 0, ior: m.ior || 1.45, tex: m.tex || null }));
    // emissive triangles for light sampling
    const em = [], ew = []; let W = 0;
    for (let i = 0; i < n; i++) {
      const m = mats[Mt[i]], e = m.emit, l = 0.2126 * e[0] + 0.7152 * e[1] + 0.0722 * e[2]; if (l <= 0) continue;
      const a = triArea(P, i); if (a <= 0) continue; W += a * l; em.push(i); ew.push(W);
    }
    // emissive surfaces (softboxes, lamps) do not block light from point and sun lights
    const noShadow = new Uint8Array(n); for (let i = 0; i < n; i++) { const e = mats[Mt[i]].emit; if (e[0] + e[1] + e[2] > 0) noShadow[i] = 1; }
    const emWeight = new Float32Array(n); em.forEach((t, k) => { const m = mats[Mt[t]].emit; emWeight[t] = (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / W; void k; });
    const cam = sc.camera, f = norm3(cam.dir), r = norm3(cross3(f, cam.up || [0, 0, 1])), u = cross3(r, f);
    return { ...sc, P, N, U, Mt, bvh, mats, em, ew: Float32Array.from(ew), W, emWeight, noShadow, cam: { pos: cam.pos, f, r, u, tanH: Math.tan((cam.fov || 40) * PI / 360), aperture: cam.aperture || 0, focus: cam.focus || 5 }, bounces: sc.bounces ?? 6 };
  }
  function triArea(P, i) { const o = i * 9, ax = P[o + 3] - P[o], ay = P[o + 4] - P[o + 1], az = P[o + 5] - P[o + 2], bx = P[o + 6] - P[o], by = P[o + 7] - P[o + 1], bz = P[o + 8] - P[o + 2]; return 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx); }
  const norm3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  // ---------- traversal ----------
  const STACK = new Int32Array(256), TST = new Float64Array(256);
  const hit = { t: 0, u: 0, v: 0, tri: -1 };
  // ordered BVH traversal: nearer child first, subtrees beyond the current hit are skipped
  function boxT(nb, b, ox, oy, oz, ix, iy, iz, tmax) {
    let t0 = ((ix >= 0 ? nb[b] : nb[b + 3]) - ox) * ix, t1 = ((ix >= 0 ? nb[b + 3] : nb[b]) - ox) * ix;
    const ty0 = ((iy >= 0 ? nb[b + 1] : nb[b + 4]) - oy) * iy, ty1 = ((iy >= 0 ? nb[b + 4] : nb[b + 1]) - oy) * iy;
    if (ty0 > t0) t0 = ty0; if (ty1 < t1) t1 = ty1;
    const tz0 = ((iz >= 0 ? nb[b + 2] : nb[b + 5]) - oz) * iz, tz1 = ((iz >= 0 ? nb[b + 5] : nb[b + 2]) - oz) * iz;
    if (tz0 > t0) t0 = tz0; if (tz1 < t1) t1 = tz1;
    if (t0 > t1 || t1 < 0 || t0 > tmax) return Infinity;
    return t0 < 0 ? 0 : t0;
  }
  function intersect(S, ox, oy, oz, dx, dy, dz, tmax, any) {
    const nb = S.bvh.nb, ni = S.bvh.ni, P = S.P; const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz;
    hit.tri = -1; hit.t = tmax;
    const r0 = boxT(nb, 0, ox, oy, oz, ix, iy, iz, tmax); if (r0 === Infinity) return false;
    let sp = 0; STACK[sp] = 0; TST[sp++] = r0;
    while (sp) {
      sp--; const node = STACK[sp]; if (TST[sp] > hit.t) continue;
      const cnt = ni[node * 2 + 1];
      if (cnt) {
        const first = ni[node * 2];
        for (let i = first; i < first + cnt; i++) {
          const o = i * 9, e1x = P[o + 3] - P[o], e1y = P[o + 4] - P[o + 1], e1z = P[o + 5] - P[o + 2], e2x = P[o + 6] - P[o], e2y = P[o + 7] - P[o + 1], e2z = P[o + 8] - P[o + 2];
          const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x, det = e1x * px + e1y * py + e1z * pz;
          if (det > -1e-12 && det < 1e-12) continue;
          const id = 1 / det, tx = ox - P[o], ty = oy - P[o + 1], tz = oz - P[o + 2], u = (tx * px + ty * py + tz * pz) * id; if (u < 0 || u > 1) continue;
          const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, v = (dx * qx + dy * qy + dz * qz) * id; if (v < 0 || u + v > 1) continue;
          const t = (e2x * qx + e2y * qy + e2z * qz) * id;
          if (t > EPS && t < hit.t) { if (any && S.noShadow && S.noShadow[i]) continue; hit.t = t; hit.u = u; hit.v = v; hit.tri = i; if (any) return true; }
        }
      } else {
        const l = ni[node * 2], r = l + 1, tl = boxT(nb, l * 6, ox, oy, oz, ix, iy, iz, hit.t), tr = boxT(nb, r * 6, ox, oy, oz, ix, iy, iz, hit.t);
        if (tl <= tr) { if (tr !== Infinity) { STACK[sp] = r; TST[sp++] = tr; } if (tl !== Infinity) { STACK[sp] = l; TST[sp++] = tl; } }
        else { if (tl !== Infinity) { STACK[sp] = l; TST[sp++] = tl; } STACK[sp] = r; TST[sp++] = tr; }
      }
    }
    return hit.tri >= 0;
  }

  // ---------- sampling helpers ----------
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
  function onb(n) { const s = n[2] >= 0 ? 1 : -1, a = -1 / (s + n[2]), b = n[0] * n[1] * a; return [[1 + s * n[0] * n[0] * a, s * b, -s * n[0]], [b, s + n[1] * n[1] * a, -n[1]]]; }
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  function texSample(tex, u, v) {
    const w = tex.w, h = tex.h; u = u - Math.floor(u); v = v - Math.floor(v);
    const x = u * w - 0.5, y = (1 - v) * h - 0.5, x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const px = (xx, yy) => { xx = ((xx % w) + w) % w; yy = ((yy % h) + h) % h; return (yy * w + xx) * 4; };
    const d = tex.data, a = px(x0, y0), b = px(x0 + 1, y0), c = px(x0, y0 + 1), e = px(x0 + 1, y0 + 1), out = [0, 0, 0];
    for (let k = 0; k < 3; k++) out[k] = (LUT[d[a + k]] * (1 - fx) + LUT[d[b + k]] * fx) * (1 - fy) + (LUT[d[c + k]] * (1 - fx) + LUT[d[e + k]] * fx) * fy;
    return out;
  }
  function envColor(S, d) {
    const w = S.world || {}, s = w.strength ?? 1;
    if (w.sky) { const t = Math.max(0, d[2]), h = w.horizon || [0.8, 0.85, 0.9], z = w.zenith || [0.25, 0.45, 0.8], g = w.ground || [0.25, 0.23, 0.2]; const c = d[2] >= 0 ? [h[0] + (z[0] - h[0]) * Math.sqrt(t), h[1] + (z[1] - h[1]) * Math.sqrt(t), h[2] + (z[2] - h[2]) * Math.sqrt(t)] : [g[0], g[1], g[2]]; return [c[0] * s, c[1] * s, c[2] * s]; }
    const c = w.color || [0.05, 0.05, 0.05]; return [c[0] * s, c[1] * s, c[2] * s];
  }
  // GGX
  function D_ggx(NoH, a2) { const d = NoH * NoH * (a2 - 1) + 1; return a2 / (PI * d * d); }
  function G1(NoX, a2) { return 2 * NoX / (NoX + Math.sqrt(a2 + (1 - a2) * NoX * NoX)); }
  // evaluate BSDF (no transmission lobe) for wi; returns [f*cos (rgb), pdf]
  function evalBSDF(m, base, n, wo, wi, outF) {
    const NoL = n[0] * wi[0] + n[1] * wi[1] + n[2] * wi[2], NoV = n[0] * wo[0] + n[1] * wo[1] + n[2] * wo[2];
    if (NoL <= 0 || NoV <= 0) { outF[0] = outF[1] = outF[2] = 0; return 0; }
    const hx = wi[0] + wo[0], hy = wi[1] + wo[1], hz = wi[2] + wo[2], hl = Math.hypot(hx, hy, hz) || 1, h = [hx / hl, hy / hl, hz / hl];
    const NoH = Math.max(0, n[0] * h[0] + n[1] * h[1] + n[2] * h[2]), VoH = Math.max(1e-6, wo[0] * h[0] + wo[1] * h[1] + wo[2] * h[2]);
    const a = m.rough * m.rough, a2 = Math.max(1e-6, a * a), D = D_ggx(NoH, a2), G = G1(NoL, a2) * G1(NoV, a2);
    const fw = Math.pow(1 - VoH, 5), spec = D * G / (4 * NoL * NoV);
    const dw = 1 - m.metal;
    for (let k = 0; k < 3; k++) {
      const F0 = 0.04 * (1 - m.metal) + base[k] * m.metal, F = F0 + (1 - F0) * fw;
      outF[k] = (dw * (1 - F) * base[k] * INV_PI + spec * F) * NoL;
    }
    const ps = specProb(m), pdfS = D * NoH / (4 * VoH), pdfD = NoL * INV_PI;
    return ps * pdfS + (1 - ps) * pdfD;
  }
  const specProb = m => m.metal > 0.99 ? 1 : Math.min(0.9, Math.max(0.1, 0.5 * (1 - m.rough) + m.metal * 0.5));

  // ---------- one path ----------
  function trace(S, ox, oy, oz, dx, dy, dz, rnd, out, aux) {
    let tr = 1, tg = 1, tb = 1, r = 0, g = 0, b = 0, lastPdf = 0, lastSpecular = true;
    const f3 = [0, 0, 0];
    for (let depth = 0; depth <= S.bounces; depth++) {
      if (!intersect(S, ox, oy, oz, dx, dy, dz, 1e30, false)) {
        if (depth === 0 && aux) { aux[0] = aux[1] = aux[2] = 1; aux[3] = -dx; aux[4] = -dy; aux[5] = -dz; aux[6] = 1e4; }
        const e = envColor(S, [dx, dy, dz]); r += tr * e[0]; g += tg * e[1]; b += tb * e[2]; break;
      }
      const tri = hit.tri, t = hit.t, hu = hit.u, hv = hit.v, hw = 1 - hu - hv, o = tri * 9, m = S.mats[S.Mt[tri]];
      const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
      // geometric + shading normals
      const P = S.P, e1 = [P[o + 3] - P[o], P[o + 4] - P[o + 1], P[o + 5] - P[o + 2]], e2 = [P[o + 6] - P[o], P[o + 7] - P[o + 1], P[o + 8] - P[o + 2]];
      let ng = norm3(cross3(e1, e2)); const N = S.N;
      let ns = norm3([N[o] * hw + N[o + 3] * hu + N[o + 6] * hv, N[o + 1] * hw + N[o + 4] * hu + N[o + 7] * hv, N[o + 2] * hw + N[o + 5] * hu + N[o + 8] * hv]);
      const front = ng[0] * dx + ng[1] * dy + ng[2] * dz < 0;
      if (!front) { ng = [-ng[0], -ng[1], -ng[2]]; ns = [-ns[0], -ns[1], -ns[2]]; }
      if (ns[0] * ng[0] + ns[1] * ng[1] + ns[2] * ng[2] < 0.05) ns = ng;
      // emission (MIS against light sampling of emissive triangles)
      if (m.emit[0] + m.emit[1] + m.emit[2] > 0 && front) {
        let w = 1;
        if (!lastSpecular && S.em.length) { const cosL = -(ng[0] * dx + ng[1] * dy + ng[2] * dz), pl = S.emWeight[tri] * t * t / Math.max(1e-8, cosL); w = lastPdf * lastPdf / (lastPdf * lastPdf + pl * pl); }
        r += tr * m.emit[0] * w; g += tg * m.emit[1] * w; b += tb * m.emit[2] * w;
      }
      if (depth === S.bounces) break;
      let base = m.color;
      if (m.tex) { const U = S.U, uo = tri * 6, tu = U[uo] * hw + U[uo + 2] * hu + U[uo + 4] * hv, tv = U[uo + 1] * hw + U[uo + 3] * hu + U[uo + 5] * hv, c = texSample(m.tex, tu, tv); base = [c[0] * m.color[0], c[1] * m.color[1], c[2] * m.color[2]]; }
      if (depth === 0 && aux) { // first-hit guides for the denoiser
        const flat = m.transmission > 0.5 || m.metal > 0.5 || m.emit[0] + m.emit[1] + m.emit[2] > 0;
        aux[0] = flat ? 1 : base[0]; aux[1] = flat ? 1 : base[1]; aux[2] = flat ? 1 : base[2]; aux[3] = ns[0]; aux[4] = ns[1]; aux[5] = ns[2]; aux[6] = t;
      }
      const wo = [-dx, -dy, -dz], n = ns;
      const sx = px + ng[0] * EPS * 4, sy = py + ng[1] * EPS * 4, sz = pz + ng[2] * EPS * 4;
      // glass: smooth dielectric
      if (m.transmission > 0 && rnd() < m.transmission * (1 - m.metal)) {
        const eta = front ? 1 / m.ior : m.ior, cosi = Math.max(0, n[0] * wo[0] + n[1] * wo[1] + n[2] * wo[2]), k = 1 - eta * eta * (1 - cosi * cosi);
        const F0 = ((1 - m.ior) / (1 + m.ior)) ** 2, F = k < 0 ? 1 : F0 + (1 - F0) * Math.pow(1 - cosi, 5);
        if (rnd() < F) { dx = 2 * cosi * n[0] - wo[0]; dy = 2 * cosi * n[1] - wo[1]; dz = 2 * cosi * n[2] - wo[2]; ox = sx; oy = sy; oz = sz; }
        else { const c2 = Math.sqrt(k); dx = -eta * wo[0] + (eta * cosi - c2) * n[0]; dy = -eta * wo[1] + (eta * cosi - c2) * n[1]; dz = -eta * wo[2] + (eta * cosi - c2) * n[2]; ox = px - ng[0] * EPS * 4; oy = py - ng[1] * EPS * 4; oz = pz - ng[2] * EPS * 4; tr *= base[0]; tg *= base[1]; tb *= base[2]; }
        lastSpecular = true; continue;
      }
      // direct light: point and sun lights
      for (const L of S.lights) {
        let lx, ly, lz, dist, er, eg, eb;
        if (L.type === 'sun') { const d = norm3(L.dir); lx = -d[0]; ly = -d[1]; lz = -d[2]; if (L.angle) { const jitter = jitterDir([lx, ly, lz], L.angle, rnd); lx = jitter[0]; ly = jitter[1]; lz = jitter[2]; } dist = 1e30; const s = L.strength ?? 3; er = L.color[0] * s; eg = L.color[1] * s; eb = L.color[2] * s; }
        else {
          let qx = L.pos[0], qy = L.pos[1], qz = L.pos[2];
          if (L.radius) { const u1 = rnd() * 2 - 1, ph = rnd() * 2 * PI, sr = Math.sqrt(1 - u1 * u1); qx += L.radius * sr * Math.cos(ph); qy += L.radius * sr * Math.sin(ph); qz += L.radius * u1; }
          lx = qx - px; ly = qy - py; lz = qz - pz; const d2 = lx * lx + ly * ly + lz * lz; dist = Math.sqrt(d2); lx /= dist; ly /= dist; lz /= dist;
          const s = (L.power ?? 1000) / (4 * PI * PI * Math.max(1e-6, d2)); er = L.color[0] * s; eg = L.color[1] * s; eb = L.color[2] * s;
        }
        if (lx * ng[0] + ly * ng[1] + lz * ng[2] <= 0) continue;
        evalBSDF(m, base, n, wo, [lx, ly, lz], f3); if (f3[0] + f3[1] + f3[2] <= 0) continue;
        if (intersect(S, sx, sy, sz, lx, ly, lz, dist - EPS * 8, true)) continue;
        r += tr * f3[0] * er; g += tg * f3[1] * eg; b += tb * f3[2] * eb;
      }
      // direct light: emissive triangles
      if (S.em.length) {
        const xi = rnd() * S.W; let lo = 0, hi = S.ew.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (S.ew[mid] < xi) lo = mid + 1; else hi = mid; }
        const lt = S.em[lo], lo9 = lt * 9; let a1 = rnd(), a2 = rnd(); if (a1 + a2 > 1) { a1 = 1 - a1; a2 = 1 - a2; }
        const qx = P[lo9] + (P[lo9 + 3] - P[lo9]) * a1 + (P[lo9 + 6] - P[lo9]) * a2, qy = P[lo9 + 1] + (P[lo9 + 4] - P[lo9 + 1]) * a1 + (P[lo9 + 7] - P[lo9 + 1]) * a2, qz = P[lo9 + 2] + (P[lo9 + 5] - P[lo9 + 2]) * a1 + (P[lo9 + 8] - P[lo9 + 2]) * a2;
        let lx = qx - px, ly = qy - py, lz = qz - pz; const d2 = lx * lx + ly * ly + lz * lz, dist = Math.sqrt(d2); lx /= dist; ly /= dist; lz /= dist;
        const ln = norm3(cross3([P[lo9 + 3] - P[lo9], P[lo9 + 4] - P[lo9 + 1], P[lo9 + 5] - P[lo9 + 2]], [P[lo9 + 6] - P[lo9], P[lo9 + 7] - P[lo9 + 1], P[lo9 + 8] - P[lo9 + 2]]));
        const cosL = -(ln[0] * lx + ln[1] * ly + ln[2] * lz);
        if (cosL > 1e-4 && lx * ng[0] + ly * ng[1] + lz * ng[2] > 0) {
          const pdfL = S.emWeight[lt] * d2 / cosL, pdfB = evalBSDF(m, base, n, wo, [lx, ly, lz], f3);
          if (f3[0] + f3[1] + f3[2] > 0 && !intersect(S, sx, sy, sz, lx, ly, lz, dist - EPS * 8, true)) {
            const em = S.mats[S.Mt[lt]].emit, w = pdfL * pdfL / (pdfL * pdfL + pdfB * pdfB) / pdfL;
            r += tr * f3[0] * em[0] * w; g += tg * f3[1] * em[1] * w; b += tb * f3[2] * em[2] * w;
          }
        }
      }
      // sample BSDF
      const ps = specProb(m), [T1, T2] = onb(n); let wi;
      if (rnd() < ps) {
        const a = m.rough * m.rough, u1 = rnd(), u2 = rnd(), th = Math.atan(a * Math.sqrt(u1 / Math.max(1e-9, 1 - u1))), ph = 2 * PI * u2;
        const st = Math.sin(th), lh = [st * Math.cos(ph), st * Math.sin(ph), Math.cos(th)];
        const h = [T1[0] * lh[0] + T2[0] * lh[1] + n[0] * lh[2], T1[1] * lh[0] + T2[1] * lh[1] + n[1] * lh[2], T1[2] * lh[0] + T2[2] * lh[1] + n[2] * lh[2]];
        const VoH = wo[0] * h[0] + wo[1] * h[1] + wo[2] * h[2]; wi = [2 * VoH * h[0] - wo[0], 2 * VoH * h[1] - wo[1], 2 * VoH * h[2] - wo[2]];
      } else {
        const u1 = rnd(), u2 = rnd(), rr = Math.sqrt(u1), ph = 2 * PI * u2, z = Math.sqrt(1 - u1);
        wi = [T1[0] * rr * Math.cos(ph) + T2[0] * rr * Math.sin(ph) + n[0] * z, T1[1] * rr * Math.cos(ph) + T2[1] * rr * Math.sin(ph) + n[1] * z, T1[2] * rr * Math.cos(ph) + T2[2] * rr * Math.sin(ph) + n[2] * z];
      }
      if (wi[0] * ng[0] + wi[1] * ng[1] + wi[2] * ng[2] <= 0) break;
      const pdf = evalBSDF(m, base, n, wo, wi, f3); if (pdf <= 1e-8 || f3[0] + f3[1] + f3[2] <= 0) break;
      tr *= f3[0] / pdf; tg *= f3[1] / pdf; tb *= f3[2] / pdf;
      lastPdf = pdf; lastSpecular = false;
      // Russian roulette
      if (depth >= 3) { const q = Math.min(0.95, Math.max(tr, tg, tb)); if (rnd() > q) break; tr /= q; tg /= q; tb /= q; }
      ox = sx; oy = sy; oz = sz; dx = wi[0]; dy = wi[1]; dz = wi[2];
    }
    // clamp fireflies
    const mx = Math.max(r, g, b), cl = S.clamp || 10; if (mx > cl) { r *= cl / mx; g *= cl / mx; b *= cl / mx; }
    out[0] = r; out[1] = g; out[2] = b;
  }
  function jitterDir(d, angle, rnd) { const [t1, t2] = onb(d), a = Math.tan(angle / 2) * Math.sqrt(rnd()), ph = 2 * PI * rnd(); return norm3([d[0] + (t1[0] * Math.cos(ph) + t2[0] * Math.sin(ph)) * a, d[1] + (t1[1] * Math.cos(ph) + t2[1] * Math.sin(ph)) * a, d[2] + (t1[2] * Math.cos(ph) + t2[2] * Math.sin(ph)) * a]); }

  // render rows [y0,y1) with one sample per pixel for pass `pass`; returns Float32Array rgb
  function renderRows(S, y0, y1, pass) {
    const W = S.width, H = S.height, out = new Float32Array((y1 - y0) * W * 3), ax = new Float32Array((y1 - y0) * W * AUX), c = S.cam, col = [0, 0, 0], asp = W / H, a7 = new Float32Array(AUX);
    for (let y = y0; y < y1; y++) {
      for (let x = 0; x < W; x++) {
        const rnd = rng((x * 1973 + y * 9277 + pass * 26699) ^ (pass * 0x9e3779b1) ^ 0x5bd1e995);
        rnd(); rnd();
        const sxp = ((x + rnd()) / W * 2 - 1) * c.tanH * asp, syp = (1 - (y + rnd()) / H * 2) * c.tanH;
        let dx = c.f[0] + c.r[0] * sxp + c.u[0] * syp, dy = c.f[1] + c.r[1] * sxp + c.u[1] * syp, dz = c.f[2] + c.r[2] * sxp + c.u[2] * syp;
        const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
        let ox = c.pos[0], oy = c.pos[1], oz = c.pos[2];
        if (c.aperture > 0) {
          const fp = [ox + dx * c.focus / (dx * c.f[0] + dy * c.f[1] + dz * c.f[2]), oy + dy * c.focus / (dx * c.f[0] + dy * c.f[1] + dz * c.f[2]), oz + dz * c.focus / (dx * c.f[0] + dy * c.f[1] + dz * c.f[2])];
          const rr = c.aperture * Math.sqrt(rnd()), ph = 2 * PI * rnd(), ax = rr * Math.cos(ph), ay = rr * Math.sin(ph);
          ox += c.r[0] * ax + c.u[0] * ay; oy += c.r[1] * ax + c.u[1] * ay; oz += c.r[2] * ax + c.u[2] * ay;
          const d = norm3([fp[0] - ox, fp[1] - oy, fp[2] - oz]); dx = d[0]; dy = d[1]; dz = d[2];
        }
        a7.fill(0); a7[6] = 1e4; trace(S, ox, oy, oz, dx, dy, dz, rnd, col, a7);
        const i = ((y - y0) * W + x) * 3; out[i] = col[0]; out[i + 1] = col[1]; out[i + 2] = col[2]; const L = 0.2126 * col[0] / Math.max(ALB_MIN, a7[0]) + 0.7152 * col[1] / Math.max(ALB_MIN, a7[1]) + 0.0722 * col[2] / Math.max(ALB_MIN, a7[2]); a7[7] = L * L; ax.set(a7, ((y - y0) * W + x) * AUX); // a7[7]: demodulated luminance^2
      }
    }
    out.aux = ax; return out;
  }
  // accumulated linear rgb (sum) -> 8-bit RGBA with exposure and filmic-ish tone map
  function tonemap(acc, n, W, H, exposure = 0, look = 'filmic') {
    const out = new Uint8ClampedArray(W * H * 4), k = Math.pow(2, exposure) / Math.max(1, n);
    const aces = x => { const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14; return Math.max(0, Math.min(1, (x * (a * x + b)) / (x * (c * x + d) + e))); };
    const srgb = x => x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
    for (let i = 0; i < W * H; i++) {
      for (let c = 0; c < 3; c++) { let v = acc[i * 3 + c] * k; v = look === 'standard' ? Math.min(1, v) : aces(v * 0.8); out[i * 4 + c] = Math.round(srgb(Math.max(0, v)) * 255); }
      out[i * 4 + 3] = 255;
    }
    return out;
  }

  // SVGF-style edge-avoiding a-trous denoiser (Schied et al. 2017, spatial part): guided by first-hit albedo,
  // normal and depth; luminance edge-stopping uses the per-pixel sample variance, which is filtered each pass.
  // acc: summed rgb, aux: summed guides (AUX floats per pixel), n: samples. Returns averaged, filtered linear rgb.
  function denoise(acc, aux, n, W, H) {
    const N = W * H, inv = 1 / Math.max(1, n), alb = new Float32Array(N * 3), nor = new Float32Array(N * 3), dep = new Float32Array(N);
    let irr = new Float32Array(N * 3), vr = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      for (let k = 0; k < 3; k++) { const a = Math.max(ALB_MIN, aux[i * AUX + k] * inv); alb[i * 3 + k] = a; irr[i * 3 + k] = acc[i * 3 + k] * inv / a; }
      const nx = aux[i * AUX + 3], ny = aux[i * AUX + 4], nz = aux[i * AUX + 5], l = Math.hypot(nx, ny, nz) || 1; nor[i * 3] = nx / l; nor[i * 3 + 1] = ny / l; nor[i * 3 + 2] = nz / l;
      dep[i] = aux[i * AUX + 6] * inv;
      const m1 = 0.2126 * irr[i * 3] + 0.7152 * irr[i * 3 + 1] + 0.0722 * irr[i * 3 + 2], m2 = aux[i * AUX + 7] * inv;
      vr[i] = Math.max(0, m2 - m1 * m1) / Math.max(1, n - 1); // variance of the mean (demodulated luminance)
    }
    const h = [1 / 16, 1 / 4, 3 / 8, 1 / 4, 1 / 16], SIG_L = 3;
    for (let it = 0; it < 4; it++) {
      const step = 1 << it, out = new Float32Array(N * 3), vo = new Float32Array(N);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = y * W + x, cr = irr[p * 3], cg = irr[p * 3 + 1], cb = irr[p * 3 + 2], lp = 0.2126 * cr + 0.7152 * cg + 0.0722 * cb;
        // 3x3 blurred variance for a stable edge-stopping scale
        let vs = 0, vw = 0; for (let j = -1; j <= 1; j++) { const yy = y + j; if (yy < 0 || yy >= H) continue; for (let i = -1; i <= 1; i++) { const xx = x + i; if (xx < 0 || xx >= W) continue; const k = (i === 0 ? 2 : 1) * (j === 0 ? 2 : 1); vs += vr[yy * W + xx] * k; vw += k; } }
        const sl = 1 / (SIG_L * Math.sqrt(vs / vw) + 1e-4);
        const pnx = nor[p * 3], pny = nor[p * 3 + 1], pnz = nor[p * 3 + 2], pd = dep[p], dScale = 1 / (0.015 * pd * step + 1e-4);
        let sr = 0, sg = 0, sb = 0, sw = 0, sv = 0;
        for (let j = -2; j <= 2; j++) {
          const yy = y + j * step; if (yy < 0 || yy >= H) continue;
          for (let i = -2; i <= 2; i++) {
            const xx = x + i * step; if (xx < 0 || xx >= W) continue;
            const q = yy * W + xx, qr = irr[q * 3], qg = irr[q * 3 + 1], qb = irr[q * 3 + 2], lq = 0.2126 * qr + 0.7152 * qg + 0.0722 * qb;
            const nd = pnx * nor[q * 3] + pny * nor[q * 3 + 1] + pnz * nor[q * 3 + 2]; if (nd <= 0) continue;
            const w = h[i + 2] * h[j + 2] * Math.pow(nd, 64) * Math.exp(-Math.abs(lp - lq) * sl - Math.abs(pd - dep[q]) * dScale);
            sr += qr * w; sg += qg * w; sb += qb * w; sw += w; sv += w * w * vr[q];
          }
        }
        if (sw > 1e-12) { out[p * 3] = sr / sw; out[p * 3 + 1] = sg / sw; out[p * 3 + 2] = sb / sw; vo[p] = sv / (sw * sw); } else { out[p * 3] = cr; out[p * 3 + 1] = cg; out[p * 3 + 2] = cb; vo[p] = vr[p]; }
      }
      irr = out; vr = vo;
    }
    for (let i = 0; i < N * 3; i++) irr[i] *= alb[i];
    return irr;
  }

  const api = { buildBVH, prepare, intersect, renderRows, tonemap, trace, hit, srgbToLin, denoise, AUX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LPT = api;
})(typeof self !== 'undefined' ? self : this);
