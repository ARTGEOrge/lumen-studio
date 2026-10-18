// Lumen Stress — finite elements: 6-node quadratic triangles (plane stress, plane strain, axisymmetric) and
// 8-node voxel hexahedra with Wilson–Taylor incompatible modes (3-D). Assembly, static solve (PCG), modal (LOBPCG),
// stress recovery, reactions. Units are consistent mm · N · MPa · tonne (density in t/mm³, accelerations in mm/s²).
(function (root, factory) {
  const m = factory(typeof module === 'object' && module.exports ? require('./sparse.js') : root.StressSparse);
  if (typeof module === 'object' && module.exports) module.exports = m; else root.StressFem = m;
})(typeof self !== 'undefined' ? self : this, function (SP) {
  'use strict';

  // ---------- constitutive matrices ----------
  // 2-D strain vector order [εx, εy, γxy, εzz]; for axisymmetric x = r, y = z, and the 4th entry is the hoop strain u/r.
  function D2(form, E, nu) {
    const D = new Float64Array(16);
    if (form === 'stress') { const c = E / (1 - nu * nu); D[0] = c; D[1] = c * nu; D[4] = c * nu; D[5] = c; D[10] = c * (1 - nu) / 2; }
    else {   // plane strain & axisymmetric share the 3-D isotropic coefficients
      const c = E / ((1 + nu) * (1 - 2 * nu));
      D[0] = D[5] = D[15] = c * (1 - nu); D[1] = D[4] = D[3] = D[12] = D[7] = D[13] = c * nu; D[10] = c * (1 - 2 * nu) / 2;
    }
    return D;
  }
  function D3(E, nu) {
    const D = new Float64Array(36), c = E / ((1 + nu) * (1 - 2 * nu));
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) D[i * 6 + j] = c * (i === j ? 1 - nu : nu);
    for (let i = 3; i < 6; i++) D[i * 6 + i] = c * (1 - 2 * nu) / 2;
    return D;
  }

  // ---------- T6 ----------
  const G6 = (() => { const a = 0.445948490915965, wa = 0.223381589678011, b = 0.091576213509771, wb = 0.109951743655322; return [[a, a, wa], [1 - 2 * a, a, wa], [a, 1 - 2 * a, wa], [b, b, wb], [1 - 2 * b, b, wb], [b, 1 - 2 * b, wb]]; })();
  const G3 = [[1 / 6, 1 / 6, 1 / 3], [2 / 3, 1 / 6, 1 / 3], [1 / 6, 2 / 3, 1 / 3]];
  // extrapolation from the 3 Gauss points to the 6 nodes (stress varies linearly in a T6)
  const EXT6 = [[5 / 3, -1 / 3, -1 / 3], [-1 / 3, 5 / 3, -1 / 3], [-1 / 3, -1 / 3, 5 / 3], [2 / 3, 2 / 3, -1 / 3], [-1 / 3, 2 / 3, 2 / 3], [2 / 3, -1 / 3, 2 / 3]];
  function t6Shape(xi, eta, N, dNx, dNe) {
    const L = 1 - xi - eta;
    N[0] = L * (2 * L - 1); N[1] = xi * (2 * xi - 1); N[2] = eta * (2 * eta - 1); N[3] = 4 * xi * L; N[4] = 4 * xi * eta; N[5] = 4 * eta * L;
    dNx[0] = 1 - 4 * L; dNx[1] = 4 * xi - 1; dNx[2] = 0; dNx[3] = 4 * (L - xi); dNx[4] = 4 * eta; dNx[5] = -4 * eta;
    dNe[0] = 1 - 4 * L; dNe[1] = 0; dNe[2] = 4 * eta - 1; dNe[3] = -4 * xi; dNe[4] = 4 * xi; dNe[5] = 4 * (L - eta);
  }
  // evaluate at (xi,eta): fills dNdx, dNdy; returns {detJ, x, y}
  const _N = new Float64Array(6), _dx = new Float64Array(6), _de = new Float64Array(6);
  function t6At(X, Y, xi, eta, N, dNdx, dNdy) {
    t6Shape(xi, eta, N, _dx, _de);
    let j11 = 0, j12 = 0, j21 = 0, j22 = 0, x = 0, y = 0;
    for (let k = 0; k < 6; k++) { j11 += _dx[k] * X[k]; j12 += _dx[k] * Y[k]; j21 += _de[k] * X[k]; j22 += _de[k] * Y[k]; x += N[k] * X[k]; y += N[k] * Y[k]; }
    const det = j11 * j22 - j12 * j21, i11 = j22 / det, i12 = -j12 / det, i21 = -j21 / det, i22 = j11 / det;
    for (let k = 0; k < 6; k++) { dNdx[k] = i11 * _dx[k] + i12 * _de[k]; dNdy[k] = i21 * _dx[k] + i22 * _de[k]; }
    return { detJ: det, x, y };
  }
  // B matrix (4 × 12), row-major
  function t6B(N, dNdx, dNdy, r, axi, B) {
    B.fill(0);
    for (let k = 0; k < 6; k++) {
      B[0 * 12 + 2 * k] = dNdx[k]; B[1 * 12 + 2 * k + 1] = dNdy[k];
      B[2 * 12 + 2 * k] = dNdy[k]; B[2 * 12 + 2 * k + 1] = dNdx[k];
      if (axi) B[3 * 12 + 2 * k] = N[k] / r;
    }
  }
  // element stiffness, consistent mass (unit density) and body load (per unit density) for one T6
  function t6Element(X, Y, D, form, t, body, omega2, wantMass) {
    const axi = form === 'axi', K = new Float64Array(144), fb = new Float64Array(12), Me = wantMass ? new Float64Array(144) : null;
    const N = new Float64Array(6), dNdx = new Float64Array(6), dNdy = new Float64Array(6), B = new Float64Array(48), DB = new Float64Array(48);
    for (const [xi, eta, w] of G6) {
      const g = t6At(X, Y, xi, eta, N, dNdx, dNdy), wt = w * 0.5 * g.detJ * (axi ? 2 * Math.PI * g.x : t);
      t6B(N, dNdx, dNdy, g.x, axi, B);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 12; j++) { let s = 0; for (let k = 0; k < 4; k++) s += D[i * 4 + k] * B[k * 12 + j]; DB[i * 12 + j] = s; }
      for (let i = 0; i < 12; i++) for (let j = i; j < 12; j++) { let s = 0; for (let k = 0; k < 4; k++) s += B[k * 12 + i] * DB[k * 12 + j]; K[i * 12 + j] += s * wt; }
      // body force per unit density: acceleration field + centrifugal ω²·(x, y) (axisymmetric: ω²·r radially)
      const bx = body[0] + omega2 * g.x, by = body[1] + (axi ? 0 : omega2 * g.y);
      for (let k = 0; k < 6; k++) { fb[2 * k] += N[k] * bx * wt; fb[2 * k + 1] += N[k] * by * wt; }
      if (Me) for (let a = 0; a < 6; a++) for (let b = 0; b < 6; b++) { const v = N[a] * N[b] * wt; Me[(2 * a) * 12 + 2 * b] += v; Me[(2 * a + 1) * 12 + 2 * b + 1] += v; }
    }
    for (let i = 0; i < 12; i++) for (let j = 0; j < i; j++) K[i * 12 + j] = K[j * 12 + i];
    return { K, fb, M: Me };
  }
  // nodal stresses (6 nodes × 4 comps) of one element from its displacements ue (12)
  function t6Stress(X, Y, D, form, ue) {
    const axi = form === 'axi', N = new Float64Array(6), dNdx = new Float64Array(6), dNdy = new Float64Array(6), B = new Float64Array(48), gs = [];
    for (const [xi, eta] of G3) {
      const g = t6At(X, Y, xi, eta, N, dNdx, dNdy); t6B(N, dNdx, dNdy, g.x, axi, B);
      const eps = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) { let s = 0; for (let j = 0; j < 12; j++) s += B[i * 12 + j] * ue[j]; eps[i] = s; }
      const sig = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) { let s = 0; for (let k = 0; k < 4; k++) s += D[i * 4 + k] * eps[k]; sig[i] = s; }
      if (form === 'strain') sig[3] = D[1] * (eps[0] + eps[1]);   // σz = ν(σx+σy) for plane strain
      if (form === 'stress') sig[3] = 0;
      gs.push(sig);
    }
    const out = new Float64Array(24);
    for (let n = 0; n < 6; n++) for (let c = 0; c < 4; c++) out[n * 4 + c] = EXT6[n][0] * gs[0][c] + EXT6[n][1] * gs[1][c] + EXT6[n][2] * gs[2][c];
    return out;
  }

  // ---------- H8 voxel with incompatible modes (cube of side h; all voxels share the same matrices) ----------
  const HN = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]];
  function h8Matrices(hx, hy, hz, D) {
    const g = 1 / Math.sqrt(3), gp = []; for (const p of HN) gp.push([p[0] * g, p[1] * g, p[2] * g]);
    const sx = 2 / hx, sy = 2 / hy, sz = 2 / hz, detJ = hx * hy * hz / 8;
    const Kuu = new Float64Array(576), Kua = new Float64Array(24 * 9), Kaa = new Float64Array(81), Me = new Float64Array(576);
    const Bs = [], Gs = [];
    for (const [xi, et, ze] of gp) {
      const B = new Float64Array(6 * 24), G = new Float64Array(6 * 9), N = [];
      for (let k = 0; k < 8; k++) {
        const [a, b, c] = HN[k]; N.push((1 + a * xi) * (1 + b * et) * (1 + c * ze) / 8);
        const dx = a * (1 + b * et) * (1 + c * ze) / 8 * sx, dy = b * (1 + a * xi) * (1 + c * ze) / 8 * sy, dz = c * (1 + a * xi) * (1 + b * et) / 8 * sz;
        B[0 * 24 + 3 * k] = dx; B[1 * 24 + 3 * k + 1] = dy; B[2 * 24 + 3 * k + 2] = dz;
        B[3 * 24 + 3 * k] = dy; B[3 * 24 + 3 * k + 1] = dx;
        B[4 * 24 + 3 * k + 1] = dz; B[4 * 24 + 3 * k + 2] = dy;
        B[5 * 24 + 3 * k] = dz; B[5 * 24 + 3 * k + 2] = dx;
      }
      // incompatible modes P1 = 1−ξ², P2 = 1−η², P3 = 1−ζ² for each displacement component (a = [u1 u2 u3 v1 v2 v3 w1 w2 w3])
      const dP = [[-2 * xi * sx, 0, 0], [0, -2 * et * sy, 0], [0, 0, -2 * ze * sz]];
      for (let m = 0; m < 3; m++) {
        const [px, py, pz] = dP[m];
        G[0 * 9 + m] = px; G[3 * 9 + m] = py; G[5 * 9 + m] = pz;              // u modes
        G[1 * 9 + 3 + m] = py; G[3 * 9 + 3 + m] = px; G[4 * 9 + 3 + m] = pz;  // v modes
        G[2 * 9 + 6 + m] = pz; G[4 * 9 + 6 + m] = py; G[5 * 9 + 6 + m] = px;  // w modes
      }
      const mul = (Ain, ca, Bin, cb) => { const out = new Float64Array(ca * cb); for (let i = 0; i < ca; i++) for (let j = 0; j < cb; j++) { let t = 0; for (let k = 0; k < 6; k++) { let dk = 0; for (let l = 0; l < 6; l++) dk += D[k * 6 + l] * Bin[l * cb + j]; t += Ain[k * ca + i] * dk; } out[i * cb + j] = t; } return out; };
      const kuu = mul(B, 24, B, 24), kua = mul(B, 24, G, 9), kaa = mul(G, 9, G, 9);
      for (let i = 0; i < 576; i++) Kuu[i] += kuu[i] * detJ; for (let i = 0; i < 216; i++) Kua[i] += kua[i] * detJ; for (let i = 0; i < 81; i++) Kaa[i] += kaa[i] * detJ;
      for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) { const v = N[a] * N[b] * detJ; for (let c = 0; c < 3; c++) Me[(3 * a + c) * 24 + 3 * b + c] += v; }
      Bs.push(B); Gs.push(G);
    }
    // static condensation: K = Kuu − Kua Kaa⁻¹ Kau ; a = −Kaa⁻¹ Kau u
    const Ki = SP.inv(Kaa, 9), A = new Float64Array(9 * 24);   // A = Kaa⁻¹ Kau
    for (let i = 0; i < 9; i++) for (let j = 0; j < 24; j++) { let t = 0; for (let k = 0; k < 9; k++) t += Ki[i * 9 + k] * Kua[j * 9 + k]; A[i * 24 + j] = t; }
    const K = new Float64Array(576);
    for (let i = 0; i < 24; i++) for (let j = 0; j < 24; j++) { let t = 0; for (let k = 0; k < 9; k++) t += Kua[i * 9 + k] * A[k * 24 + j]; K[i * 24 + j] = Kuu[i * 24 + j] - t; }
    for (let i = 0; i < 24; i++) for (let j = 0; j < i; j++) { const v = (K[i * 24 + j] + K[j * 24 + i]) / 2; K[i * 24 + j] = K[j * 24 + i] = v; }
    // stress at Gauss points: σ = D (B − G A) u, extrapolated to the nodes with trilinear functions at √3·ξ
    const Sg = gp.map((_, q) => { const B = Bs[q], G = Gs[q], E = new Float64Array(6 * 24); for (let i = 0; i < 6; i++) for (let j = 0; j < 24; j++) { let t = B[i * 24 + j]; for (let k = 0; k < 9; k++) t -= G[i * 9 + k] * A[k * 24 + j]; E[i * 24 + j] = t; } const S = new Float64Array(6 * 24); for (let i = 0; i < 6; i++) for (let j = 0; j < 24; j++) { let t = 0; for (let k = 0; k < 6; k++) t += D[i * 6 + k] * E[k * 24 + j]; S[i * 24 + j] = t; } return S; });
    const Sn = new Float64Array(8 * 6 * 24), r3 = Math.sqrt(3);
    for (let n = 0; n < 8; n++) for (let q = 0; q < 8; q++) {
      const [a, b, c] = HN[q], w = (1 + a * HN[n][0] * r3) * (1 + b * HN[n][1] * r3) * (1 + c * HN[n][2] * r3) / 8;
      for (let i = 0; i < 144; i++) Sn[n * 144 + i] += w * Sg[q][i];
    }
    return { K, M: Me, Sn, vol: hx * hy * hz };
  }

  // element matrices for every distinct brick size in a rectilinear voxel grid
  function h8Cache(P, E, D) {
    const cache = new Map();
    return e => {
      const a = E[e * 8] * 3, g = E[e * 8 + 6] * 3, hx = P[g] - P[a], hy = P[g + 1] - P[a + 1], hz = P[g + 2] - P[a + 2], key = hx.toPrecision(9) + ',' + hy.toPrecision(9) + ',' + hz.toPrecision(9);
      let H = cache.get(key); if (!H) { H = h8Matrices(hx, hy, hz, D); cache.set(key, H); } return H;
    };
  }

  // ---------- stress invariants ----------
  function principal3(sx, sy, sz, txy, tyz, tzx) {
    const I1 = sx + sy + sz, m = I1 / 3, a = sx - m, b = sy - m, c = sz - m;
    const J2 = (a * a + b * b + c * c) / 2 + txy * txy + tyz * tyz + tzx * tzx;
    if (J2 < 1e-30) return [m, m, m];
    const J3 = a * (b * c - tyz * tyz) - txy * (txy * c - tyz * tzx) + tzx * (txy * tyz - b * tzx);
    const r = Math.sqrt(J2 / 3), cos3 = Math.max(-1, Math.min(1, J3 / (2 * r * r * r))), th = Math.acos(cos3) / 3;
    const s1 = m + 2 * r * Math.cos(th), s3 = m + 2 * r * Math.cos(th + 2 * Math.PI / 3), s2 = I1 - s1 - s3;
    return [s1, s2, s3];
  }
  // derived nodal fields from nodal stress (2-D: 4 comps, 3-D: 6 comps)
  function derived(stress, nn, dim) {
    const vm = new Float64Array(nn), s1 = new Float64Array(nn), s2 = new Float64Array(nn), s3 = new Float64Array(nn), tau = new Float64Array(nn);
    for (let i = 0; i < nn; i++) {
      let p;
      if (dim === 2) {
        const sx = stress[i * 4], sy = stress[i * 4 + 1], t = stress[i * 4 + 2], sz = stress[i * 4 + 3], c = (sx + sy) / 2, R = Math.hypot((sx - sy) / 2, t);
        p = [c + R, c - R, sz].sort((a, b) => b - a);
      } else p = principal3(stress[i * 6], stress[i * 6 + 1], stress[i * 6 + 2], stress[i * 6 + 3], stress[i * 6 + 4], stress[i * 6 + 5]);
      s1[i] = p[0]; s2[i] = p[1]; s3[i] = p[2];
      vm[i] = Math.sqrt(((p[0] - p[1]) ** 2 + (p[1] - p[2]) ** 2 + (p[2] - p[0]) ** 2) / 2); tau[i] = (p[0] - p[2]) / 2;
    }
    return { vm, s1, s2, s3, tau };
  }

  // ---------- solve ----------
  // model: {kind:'T6'|'H8', nodes, elems, form, thickness, h, mat:{E,nu,rho}, fixed:Int32Array dofs, fixedVal, springs:[{node,n,k?}],
  //         F (nodal loads, length nn*dim), body:[ax,ay,az] (mm/s², multiplied by ρ), omega (rad/s), analysis:'static'|'modal', modes}
  function solve(model, progress = () => { }) {
    const t0 = Date.now(), T6 = model.kind === 'T6', dim = T6 ? 2 : 3, npe = T6 ? 6 : 8, nd = dim * npe;
    const nodes = model.nodes, elems = model.elems, nn = nodes.length / dim, ne = elems.length / npe, ndof = nn * dim;
    const { E, nu } = model.mat, rho = model.mat.rho || 0, form = model.form || 'stress', t = model.thickness || 1;
    const D = T6 ? D2(form, E, nu) : D3(E, nu), Hof = T6 ? null : h8Cache(nodes, elems, D);
    const body = model.body || [0, 0, 0], omega2 = (model.omega || 0) ** 2, modal = model.analysis === 'modal';
    // constraints
    const fixedVal = new Float64Array(ndof), isFixed = new Uint8Array(ndof);
    (model.fixed || []).forEach((d, i) => { isFixed[d] = 1; fixedVal[d] = model.fixedVal ? model.fixedVal[i] || 0 : 0; });
    progress('Ordering ' + nn.toLocaleString() + ' nodes…');
    const g = SP.nodeGraph(nn, elems, npe), order = SP.rcm(g), eq = new Int32Array(ndof).fill(-1); let neq = 0;
    for (const n of order) for (let c = 0; c < dim; c++) if (!isFixed[n * dim + c]) eq[n * dim + c] = neq++;
    if (!neq) throw new Error('Every degree of freedom is fixed — nothing to solve.');
    const K = SP.buildCSR(g, dim, eq, neq), Mm = modal ? { n: K.n, ptr: K.ptr, col: K.col, val: new Float64Array(K.col.length) } : null;
    const Fext = new Float64Array(ndof); if (model.F) Fext.set(model.F);
    const rhs = new Float64Array(neq), eqs = new Int32Array(nd), X = new Float64Array(npe), Y = new Float64Array(npe);
    progress('Assembling ' + ne.toLocaleString() + ' elements…');
    const elMat = e => {
      if (!T6) return null;
      for (let k = 0; k < 6; k++) { const n = elems[e * 6 + k]; X[k] = nodes[n * 2]; Y[k] = nodes[n * 2 + 1]; }
      return t6Element(X, Y, D, form, t, body, omega2, modal);
    };
    for (let e = 0; e < ne; e++) {
      const em = elMat(e), H = T6 ? null : Hof(e), Ke = T6 ? em.K : H.K;
      for (let k = 0; k < npe; k++) { const n = elems[e * npe + k]; for (let c = 0; c < dim; c++) eqs[k * dim + c] = eq[n * dim + c]; }
      SP.addElement(K, eqs, Ke, nd);
      if (modal) SP.addElement(Mm, eqs, T6 ? em.M : H.M, nd, rho);
      // body loads
      if (rho && (body[0] || body[1] || body[2] || omega2)) {
        if (T6) for (let k = 0; k < 6; k++) { const n = elems[e * 6 + k]; Fext[n * 2] += rho * em.fb[2 * k]; Fext[n * 2 + 1] += rho * em.fb[2 * k + 1]; }
        else for (let k = 0; k < 8; k++) { const n = elems[e * 8 + k], w = rho * H.vol / 8, x = nodes[n * 3], y = nodes[n * 3 + 1]; Fext[n * 3] += w * (body[0] + omega2 * x); Fext[n * 3 + 1] += w * (body[1] + omega2 * y); Fext[n * 3 + 2] += w * body[2]; }
      }
      // prescribed non-zero displacements move to the right-hand side
      for (let j = 0; j < nd; j++) {
        const n = elems[e * npe + (j / dim | 0)], d = n * dim + j % dim; if (!isFixed[d] || !fixedVal[d]) continue;
        for (let i = 0; i < nd; i++) if (eqs[i] >= 0) rhs[eqs[i]] -= Ke[i * nd + j] * fixedVal[d];
      }
    }
    // penalty springs for supports whose direction is not along an axis (rollers on inclined faces)
    const dK = SP.diagOf(K); let kref = 0; for (let i = 0; i < neq; i++) kref = Math.max(kref, dK[i]);
    const springs = (model.springs || []).map(s => ({ node: s.node, n: s.n, k: (s.k || 1e4) * kref }));
    for (const s of springs) for (let a = 0; a < dim; a++) for (let b = 0; b < dim; b++) {
      const ra = eq[s.node * dim + a], cb = eq[s.node * dim + b]; if (ra < 0 || cb < 0) continue; K.val[SP.find(K, ra, cb)] += s.k * s.n[a] * s.n[b];
    }
    for (let d = 0; d < ndof; d++) if (eq[d] >= 0) rhs[eq[d]] += Fext[d];
    const info = { nodes: nn, elements: ne, equations: neq, nnz: K.col.length, assemble: (Date.now() - t0) / 1000 };
    const u = new Float64Array(ndof);
    const unpack = (x, out) => { for (let d = 0; d < ndof; d++) out[d] = eq[d] >= 0 ? x[eq[d]] : fixedVal[d]; return out; };
    let res = { info };
    if (!modal) {
      const t1 = Date.now(), P = factor(K, model.solver, progress); info.precond = P.kind + (P.shift ? ` (shift ${P.shift})` : '');
      let sol;
      if (P.exact) { const x = P.apply(rhs, new Float64Array(neq)), q = SP.matvec(K, x, new Float64Array(neq)); let a = 0, b = 0; for (let i = 0; i < neq; i++) { a += (q[i] - rhs[i]) ** 2; b += rhs[i] ** 2; } sol = { x, it: 1, rel: Math.sqrt(a / (b || 1)), ok: true }; }
      else sol = SP.pcg(K, rhs, { M: P, tol: model.tol || 1e-9, onProgress: (it, rel) => progress(`Solving (PCG): iteration ${it}, residual ${rel.toExponential(1)}`) });
      info.iterations = sol.it; info.residual = sol.rel; info.solve = (Date.now() - t1) / 1000;
      if (!sol.ok || !sol.x.every(Number.isFinite)) throw new Error('The solver did not converge' + (sol.reason ? ': ' + sol.reason : '') + '. Check that the supports stop the part from moving or rotating freely.');
      unpack(sol.x, u);
      progress('Recovering stresses…');
      Object.assign(res, { u }, recover(model, u, D, Hof, Fext, springs));
      let W = 0; for (let d = 0; d < ndof; d++) W += Fext[d] * u[d]; res.energy = W / 2;
    } else {
      const m = Math.max(1, Math.min(20, model.modes || 6));
      // free–free models: shift so K + σM is definite (rigid-body modes come out at ≈ 0 Hz)
      let sigma = 0; if (!model.fixed || !model.fixed.length) { const dM = SP.diagOf(Mm); let a = 0, b = 0; for (let i = 0; i < neq; i++) { a += dK[i]; b += dM[i]; } sigma = 1e-3 * a / b; for (let i = 0; i < K.val.length; i++) K.val[i] += sigma * Mm.val[i]; }
      const t1 = Date.now(), P0 = factor(K, model.solver, progress, true); info.precond = P0.kind;
      // without an exact factor, a few inner PCG iterations make a much stronger preconditioner for LOBPCG
      const P = P0.exact ? P0 : { apply: (r, z) => { z.set(SP.pcg(K, r, { M: P0, tol: 1e-2, maxIt: 40 }).x); return z; } };
      const ev = SP.lobpcg(K, Mm, m, P, { tol: 1e-5, maxIt: 500, onProgress: (it, r) => progress(`Modal: iteration ${it}, residual ${r.toExponential(1)}`) });
      info.iterations = ev.it; info.solve = (Date.now() - t1) / 1000;
      res.modes = ev.lambda.map((lam, j) => {
        const l = Math.max(0, lam - sigma), um = unpack(ev.X[j], new Float64Array(ndof)); let mx = 0;
        for (let i = 0; i < nn; i++) { let s = 0; for (let c = 0; c < dim; c++) s += um[i * dim + c] ** 2; mx = Math.max(mx, Math.sqrt(s)); }
        for (let d = 0; d < ndof; d++) um[d] = (um[d] / (mx || 1)) * (fixedVal[d] ? 0 : 1);
        return { f: Math.sqrt(l) / (2 * Math.PI), omega: Math.sqrt(l), u: um, resid: ev.resid[j] };
      });
      res.u = res.modes[0].u;
    }
    info.total = (Date.now() - t0) / 1000;
    return res;
  }

  // choose the linear solver: exact envelope Cholesky when the RCM profile is small, otherwise IC(0)-preconditioned CG
  function factor(K, choice = 'auto', progress = () => { }, modal = false) {
    // modal analysis re-uses the factor dozens of times, so a bigger one is worth it there
    const st = SP.envelopeStats(K), small = modal ? st.profile <= 20e6 && st.flops <= 4e9 : st.profile <= 8e6 && st.flops <= 4e8;
    if (choice === 'direct' || (choice !== 'pcg' && small)) {
      if (choice === 'direct' && st.profile > 40e6) throw new Error(`The direct solver would need ${(st.profile * 8 / 1e6).toFixed(0)} MB for this model — use the iterative (PCG) solver.`);
      progress('Factorising (direct)…'); const P = SP.skyline(K); if (P) return P;
    }
    progress('Factorising preconditioner…'); return SP.ic0(K);
  }

  // nodal-averaged stresses, derived fields, reactions (internal force − external load at supported dofs)
  function recover(model, u, D, Hof, Fext, springs) {
    const T6 = model.kind === 'T6', dim = T6 ? 2 : 3, npe = T6 ? 6 : 8, nd = dim * npe, ns = T6 ? 4 : 6;
    const nodes = model.nodes, elems = model.elems, nn = nodes.length / dim, ne = elems.length / npe;
    const S = new Float64Array(nn * ns), cnt = new Float64Array(nn), fint = new Float64Array(nn * dim), ue = new Float64Array(nd), X = new Float64Array(6), Y = new Float64Array(6);
    let elemMax = 0;
    for (let e = 0; e < ne; e++) {
      for (let k = 0; k < npe; k++) { const n = elems[e * npe + k]; for (let c = 0; c < dim; c++) ue[k * dim + c] = u[n * dim + c]; }
      let Ke, sn;
      if (T6) {
        for (let k = 0; k < 6; k++) { const n = elems[e * 6 + k]; X[k] = nodes[n * 2]; Y[k] = nodes[n * 2 + 1]; }
        Ke = t6Element(X, Y, D, model.form, model.thickness || 1, [0, 0, 0], 0, false).K; sn = t6Stress(X, Y, D, model.form, ue);
      } else {
        const H = Hof(e); Ke = H.K; sn = new Float64Array(48);
        for (let n = 0; n < 8; n++) for (let i = 0; i < 6; i++) { let s = 0; const o = n * 144 + i * 24; for (let j = 0; j < 24; j++) s += H.Sn[o + j] * ue[j]; sn[n * 6 + i] = s; }
      }
      for (let k = 0; k < npe; k++) {
        const n = elems[e * npe + k]; cnt[n]++;
        for (let c = 0; c < ns; c++) S[n * ns + c] += sn[k * ns + c];
        for (let c = 0; c < dim; c++) { let s = 0; const r = k * dim + c; for (let j = 0; j < nd; j++) s += Ke[r * nd + j] * ue[j]; fint[n * dim + c] += s; }
      }
    }
    for (let n = 0; n < nn; n++) if (cnt[n]) for (let c = 0; c < ns; c++) S[n * ns + c] /= cnt[n];
    const R = new Float64Array(nn * dim);
    for (const d of model.fixed || []) R[d] = fint[d] - Fext[d];
    // a penalty spring pushes on the part with −k (n·u) n: that is the support reaction
    for (const s of springs) { let un = 0; for (let c = 0; c < dim; c++) un += s.n[c] * u[s.node * dim + c]; for (let c = 0; c < dim; c++) R[s.node * dim + c] += -s.k * un * s.n[c]; }
    const der = derived(S, nn, dim);
    return Object.assign({ stress: S, ns, react: R }, der);
  }

  // ---------- loads on boundary edges (2-D, quadratic edges a–m–b) ----------
  // traction(x, y, nx, ny) → [tx, ty] force per unit area; returns nodal forces added into F
  function edgeLoads2D(nodes, edges, form, t, traction, F) {
    const gp = [[-Math.sqrt(0.6), 5 / 9], [0, 8 / 9], [Math.sqrt(0.6), 5 / 9]], axi = form === 'axi';
    for (const ed of edges) {
      const [a, m, b] = ed, P = [a, m, b].map(n => [nodes[2 * n], nodes[2 * n + 1]]);
      for (const [s, w] of gp) {
        const N = [s * (s - 1) / 2, 1 - s * s, s * (s + 1) / 2], dN = [s - 0.5, -2 * s, s + 0.5];
        let x = 0, y = 0, dx = 0, dy = 0; for (let k = 0; k < 3; k++) { x += N[k] * P[k][0]; y += N[k] * P[k][1]; dx += dN[k] * P[k][0]; dy += dN[k] * P[k][1]; }
        const J = Math.hypot(dx, dy); if (!J) continue;
        const nx = dy / J, ny = -dx / J;   // outward normal for counter-clockwise boundary orientation
        const [tx, ty] = traction(x, y, nx, ny), wt = w * J * (axi ? 2 * Math.PI * x : t);
        [a, m, b].forEach((n, k) => { F[2 * n] += N[k] * tx * wt; F[2 * n + 1] += N[k] * ty * wt; });
      }
    }
    return F;
  }
  // measure of a set of boundary edges: length-weighted area (thickness or 2πr)
  function edgeArea2D(nodes, edges, form, t) {
    const F = new Float64Array(nodes.length); let A = 0;
    edgeLoads2D(nodes, edges, form, t, () => [1, 0], F); for (let i = 0; i < F.length; i += 2) A += F[i]; return A;
  }

  // interpolation inside a T6 at (xi, eta)
  function t6Interp(xi, eta) { const N = new Float64Array(6); t6Shape(xi, eta, N, _dx, _de); return N; }

  return { h8Cache, factor, D2, D3, t6Element, t6Stress, t6At, t6Interp, h8Matrices, principal3, derived, solve, recover, edgeLoads2D, edgeArea2D, G6 };
});
