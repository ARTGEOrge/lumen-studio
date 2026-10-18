// Lumen Stress — study model: document defaults & sanitising, material library, meshing, boundary conditions → FE model,
// result summaries. Shared by the app, the solver worker and the Node validation tests.
(function (root, factory) {
  const req = typeof module === 'object' && module.exports;
  const m = factory(req ? require('./geom.js') : root.StressGeom, req ? require('./mesh2d.js') : root.StressMesh2D, req ? require('./voxel.js') : root.StressVoxel, req ? require('./fem.js') : root.StressFem);
  if (req) module.exports = m; else root.StressStudy = m;
})(typeof self !== 'undefined' ? self : this, function (G, M2, VX, FEM) {
  'use strict';

  // E [MPa], nu, rho [kg/m³], Sy / Su [MPa] — typical handbook values (check your supplier's data sheet)
  const MATERIALS = [
    { id: 'steel', group: 'Steels', name: 'Structural steel (S275)', E: 200000, nu: 0.3, rho: 7850, Sy: 275, Su: 430 },
    { id: 's355', group: 'Steels', name: 'Structural steel S355', E: 210000, nu: 0.3, rho: 7850, Sy: 355, Su: 510 },
    { id: 'c45', group: 'Steels', name: 'Carbon steel C45 / 1045 (normalised)', E: 205000, nu: 0.29, rho: 7850, Sy: 340, Su: 620 },
    { id: '4140', group: 'Steels', name: 'Alloy steel 42CrMo4 / 4140 (Q&T)', E: 205000, nu: 0.29, rho: 7850, Sy: 655, Su: 1020 },
    { id: 'ss304', group: 'Steels', name: 'Stainless steel 304', E: 193000, nu: 0.29, rho: 8000, Sy: 215, Su: 505 },
    { id: 'ss316', group: 'Steels', name: 'Stainless steel 316', E: 193000, nu: 0.3, rho: 8000, Sy: 205, Su: 515 },
    { id: 'castiron', group: 'Steels', name: 'Grey cast iron EN-GJL-250', E: 110000, nu: 0.26, rho: 7200, Sy: 165, Su: 250 },
    { id: 'al6061', group: 'Aluminium', name: 'Aluminium 6061-T6', E: 68900, nu: 0.33, rho: 2700, Sy: 276, Su: 310 },
    { id: 'al6082', group: 'Aluminium', name: 'Aluminium 6082-T6', E: 70000, nu: 0.33, rho: 2700, Sy: 260, Su: 310 },
    { id: 'al7075', group: 'Aluminium', name: 'Aluminium 7075-T6', E: 71700, nu: 0.33, rho: 2810, Sy: 503, Su: 572 },
    { id: 'al5083', group: 'Aluminium', name: 'Aluminium 5083-H111', E: 71000, nu: 0.33, rho: 2660, Sy: 145, Su: 290 },
    { id: 'ti64', group: 'Titanium', name: 'Titanium Ti-6Al-4V (annealed)', E: 113800, nu: 0.342, rho: 4430, Sy: 880, Su: 950 },
    { id: 'tigr2', group: 'Titanium', name: 'Titanium grade 2', E: 105000, nu: 0.37, rho: 4510, Sy: 275, Su: 345 },
    { id: 'brass', group: 'Other metals', name: 'Brass CW614N', E: 97000, nu: 0.31, rho: 8470, Sy: 250, Su: 430 },
    { id: 'copper', group: 'Other metals', name: 'Copper C101 (half hard)', E: 117000, nu: 0.34, rho: 8940, Sy: 250, Su: 290 },
    { id: 'abs', group: 'Plastics', name: 'ABS', E: 2300, nu: 0.35, rho: 1050, Sy: 40, Su: 44 },
    { id: 'pla', group: 'Plastics', name: 'PLA (3D printed, solid)', E: 3500, nu: 0.36, rho: 1240, Sy: 50, Su: 60 },
    { id: 'petg', group: 'Plastics', name: 'PETG', E: 2100, nu: 0.38, rho: 1270, Sy: 50, Su: 53 },
    { id: 'pa66', group: 'Plastics', name: 'Nylon PA66 (dry)', E: 3000, nu: 0.39, rho: 1140, Sy: 80, Su: 85 },
    { id: 'pa6gf30', group: 'Plastics', name: 'Nylon PA6 GF30 (dry)', E: 9500, nu: 0.35, rho: 1360, Sy: 160, Su: 180 },
    { id: 'pc', group: 'Plastics', name: 'Polycarbonate', E: 2400, nu: 0.37, rho: 1200, Sy: 62, Su: 68 },
    { id: 'pom', group: 'Plastics', name: 'Acetal POM-C', E: 2800, nu: 0.35, rho: 1410, Sy: 65, Su: 67 },
    { id: 'hdpe', group: 'Plastics', name: 'HDPE', E: 1000, nu: 0.42, rho: 960, Sy: 25, Su: 30 },
    { id: 'pmma', group: 'Plastics', name: 'Acrylic PMMA', E: 3100, nu: 0.37, rho: 1190, Sy: 65, Su: 72 }
  ];
  const BC_KINDS = { fixed: 'Fixed support', roller: 'Frictionless support', disp: 'Displacement', force: 'Force', bearing: 'Bearing load', pressure: 'Pressure', gravity: 'Standard earth gravity', rotation: 'Rotational velocity' };
  const SF_CAP = 15;

  function newDoc(kind = '2d') {
    return {
      format: 'lumen-stress', version: 1, name: 'Untitled',
      study: { kind, model: 'stress', thickness: 10 },
      shapes: [], solid: null,
      material: Object.assign({}, MATERIALS[0]),
      mesh: { size: 0, grade: 0.3, minAngle: 28, refine: {}, target: 15000, solver: 'auto' },
      bcs: [], analysis: { type: 'static', modes: 6 }
    };
  }
  const fin = (v, d) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')) && isFinite(+v) ? +v : d;
  const clampN = (v, a, b, d) => Math.max(a, Math.min(b, fin(v, d)));
  // treat opened files as untrusted: rebuild every field from known keys and types
  function sanitize(j) {
    if (!j || typeof j !== 'object') throw new Error('Not a Lumen Stress project.');
    if (j.format && j.format !== 'lumen-stress') throw new Error('Not a Lumen Stress project.');
    const d = newDoc(j.study && j.study.kind === '3d' ? '3d' : '2d');
    d.name = String(j.name || 'Untitled').slice(0, 120);
    const s = j.study || {}; d.study.model = ['stress', 'strain', 'axi'].includes(s.model) ? s.model : 'stress'; d.study.thickness = clampN(s.thickness, 1e-6, 1e6, 10);
    d.shapes = (Array.isArray(j.shapes) ? j.shapes : []).slice(0, 500).map(G.sanitizeShape).filter(Boolean);
    const ids = new Set(); d.shapes.forEach((sh, i) => { while (ids.has(sh.id)) sh.id = 's' + (i + 1) + 'x'; ids.add(sh.id); });
    if (j.solid && typeof j.solid === 'object' && typeof j.solid.data === 'string') {
      const tris = b64ToF32(j.solid.data); if (tris.length >= 36 && tris.length % 9 === 0 && tris.every(Number.isFinite)) d.solid = { name: String(j.solid.name || 'Part').slice(0, 120), tris };
    }
    const m = j.material || {}; d.material = { id: String(m.id || 'custom').slice(0, 40), name: String(m.name || 'Custom material').slice(0, 80), group: String(m.group || '').slice(0, 40), E: clampN(m.E, 1e-6, 1e9, 200000), nu: clampN(m.nu, 0, 0.499, 0.3), rho: clampN(m.rho, 0, 1e6, 7850), Sy: clampN(m.Sy, 0, 1e7, 250), Su: clampN(m.Su, 0, 1e7, 400) };
    const me = j.mesh || {}; d.mesh = { size: clampN(me.size, 0, 1e9, 0), grade: clampN(me.grade, 0.05, 2, 0.3), minAngle: clampN(me.minAngle, 10, 33, 28), refine: {}, target: Math.round(clampN(me.target, 200, 200000, 15000)), solver: ['auto', 'pcg', 'direct'].includes(me.solver) ? me.solver : 'auto' };
    if (me.refine && typeof me.refine === 'object') for (const [k, v] of Object.entries(me.refine).slice(0, 2000)) if (/^[\w-]{1,24}:\d{1,4}$/.test(k) && fin(v, 0) > 0) d.mesh.refine[k] = +v;
    d.bcs = (Array.isArray(j.bcs) ? j.bcs : []).slice(0, 200).map((b, i) => {
      if (!b || !BC_KINDS[b.kind]) return null;
      const o = { id: /^[\w-]{1,24}$/.test(b.id) ? b.id : 'b' + (i + 1), kind: b.kind, name: String(b.name || BC_KINDS[b.kind]).slice(0, 60), targets: (Array.isArray(b.targets) ? b.targets : []).filter(t => typeof t === 'string' && /^[\w-]{1,24}(:\d{1,4})?$/.test(t)).slice(0, 5000), on: b.on !== false };
      const opt = v => v === null || v === '' || v === undefined || v === 'free' ? null : fin(v, null);
      if (b.kind === 'disp') { o.x = opt(b.x); o.y = opt(b.y); o.z = opt(b.z); }
      if (b.kind === 'force' || b.kind === 'bearing') { o.x = fin(b.x, 0); o.y = fin(b.y, 0); o.z = fin(b.z, 0); }
      if (b.kind === 'gravity') { o.x = fin(b.x, 0); o.y = fin(b.y, 0); o.z = fin(b.z, 0); }
      if (b.kind === 'pressure') o.p = fin(b.p, 0);
      if (b.kind === 'rotation') o.rpm = fin(b.rpm, 0);
      return o;
    }).filter(Boolean);
    const a = j.analysis || {}; d.analysis = { type: a.type === 'modal' ? 'modal' : 'static', modes: Math.round(clampN(a.modes, 1, 20, 6)) };
    return d;
  }
  function f32ToB64(f) { const u = new Uint8Array(f.buffer, f.byteOffset, f.byteLength); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return (typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64')); }
  function b64ToF32(b) { const s = typeof atob === 'function' ? atob(b) : Buffer.from(b, 'base64').toString('binary'), u = new Uint8Array(s.length & ~3); for (let i = 0; i < u.length; i++) u[i] = s.charCodeAt(i); return new Float32Array(u.buffer); }
  function serialize(doc) {
    const o = JSON.parse(JSON.stringify(Object.assign({}, doc, { solid: null })));
    if (doc.solid) o.solid = { name: doc.solid.name, data: f32ToB64(doc.solid.tris) };
    return JSON.stringify(o);
  }

  // ---------- meshing ----------
  function autoSize(doc) { const bb = G.bounds(doc.shapes); return +(Math.max(bb.w, bb.h) / 25).toPrecision(2); }
  function meshDoc(doc) {
    if (doc.study.kind === '3d') {
      if (!doc.solid) throw new Error('Import a closed STL solid (File → Import) or extrude the 2-D outline first.');
      const seg = doc._seg || (doc._seg = VX.segmentFaces(doc.solid.tris));
      const vm = VX.voxelize(doc.solid.tris, { target: doc.mesh.target, seg });
      VX.assignFaces(vm, doc.solid.tris, seg); vm.seg = seg; return vm;
    }
    if (!doc.shapes.length) throw new Error('Draw an outline (rectangle, circle or polygon) or import a DXF first.');
    if (doc.study.model === 'axi') { const bb = G.bounds(doc.shapes); if (bb.x0 < -1e-9 * Math.max(1, bb.w)) throw new Error('Axisymmetric models must lie at x ≥ 0: x is the radius and the y axis is the axis of symmetry.'); }
    return M2.mesh(doc.shapes, { size: doc.mesh.size || autoSize(doc), grade: doc.mesh.grade, minAngle: doc.mesh.minAngle, refine: doc.mesh.refine });
  }

  // ---------- boundary conditions → model ----------
  // returns {model, groups:[{bc, nodes:Int32Array}], warnings}
  function buildModel(doc, mesh) {
    const is3 = mesh.kind === 'H8', dim = is3 ? 3 : 2, nn = mesh.nodes.length / dim, P = mesh.nodes, warnings = [];
    const mat = doc.material, form = doc.study.model, t = doc.study.thickness, axi = !is3 && form === 'axi';
    const F = new Float64Array(nn * dim), fixed = new Map(), springs = [], groups = [];
    const fix = (n, c, v = 0) => fixed.set(n * dim + c, v);
    let body = [0, 0, 0], omega = 0;
    // target selection
    const sel2 = targets => { const T = new Set(targets); return mesh.boundary.filter(b => T.has(b.edge)); };
    const quadsOf = targets => { const T = new Set(targets.map(s => +String(s).replace(/^f/, ''))), Q = mesh.quads, out = []; for (let q = 0; q < Q.face.length; q++) if (T.has(Q.face[q])) out.push(q); return out; };
    const nodesOf = bc => {
      const S = new Set();
      if (is3) { for (const q of quadsOf(bc.targets)) for (let j = 0; j < 4; j++) S.add(mesh.quads.n[q * 4 + j]); }
      else for (const b of sel2(bc.targets)) b.n.forEach(n => S.add(n));
      return Int32Array.from(S);
    };
    // outward unit normal per node, averaged over the selected boundary pieces
    const nodeNormals = bc => {
      const acc = new Map(), add = (n, v) => { const a = acc.get(n) || [0, 0, 0]; a[0] += v[0]; a[1] += v[1]; a[2] += v[2]; acc.set(n, a); };
      if (is3) { for (const q of quadsOf(bc.targets)) { const tn = mesh.quads.tri && mesh.quads.tri[q] >= 0 ? VX.triNormal(doc.solid.tris, mesh.quads.tri[q]) : mesh.quads.normal[q]; for (let j = 0; j < 4; j++) add(mesh.quads.n[q * 4 + j], tn); } }
      else for (const b of sel2(bc.targets)) {
        const [a, m, c] = b.n; [[a, m], [m, c]].forEach(([u, v]) => { const dx = P[2 * v] - P[2 * u], dy = P[2 * v + 1] - P[2 * u + 1], L = Math.hypot(dx, dy) || 1, nv = [dy / L, -dx / L, 0]; add(u, nv); add(v, nv); });
      }
      for (const [n, a] of acc) { const l = Math.hypot(a[0], a[1], a[2]) || 1; acc.set(n, [a[0] / l, a[1] / l, a[2] / l]); }
      return acc;
    };
    for (const bc of doc.bcs) {
      if (bc.on === false) continue;
      if (bc.kind === 'gravity') { body = [body[0] + bc.x * 1000, body[1] + bc.y * 1000, body[2] + (is3 ? bc.z * 1000 : 0)]; groups.push({ bc, nodes: new Int32Array(0) }); continue; }
      if (bc.kind === 'rotation') { omega = bc.rpm * 2 * Math.PI / 60; groups.push({ bc, nodes: new Int32Array(0) }); continue; }
      const nodes = nodesOf(bc); groups.push({ bc, nodes });
      if (!nodes.length) { warnings.push(`${bc.name}: no ${is3 ? 'faces' : 'edges'} selected — it has no effect.`); continue; }
      if (bc.kind === 'fixed') nodes.forEach(n => { for (let c = 0; c < dim; c++) fix(n, c); });
      else if (bc.kind === 'disp') nodes.forEach(n => { ['x', 'y', 'z'].slice(0, dim).forEach((k, c) => { if (bc[k] != null) fix(n, c, bc[k]); }); });
      else if (bc.kind === 'roller') {
        for (const [n, nv] of nodeNormals(bc)) {
          const ax = nv.slice(0, dim).map(Math.abs), k = ax.indexOf(Math.max(...ax));
          if (ax[k] > 0.99999) fix(n, k); else springs.push({ node: n, n: nv.slice(0, dim) });
        }
      } else if (bc.kind === 'force' || bc.kind === 'pressure' || bc.kind === 'bearing') {
        if (is3) {
          const Q = quadsOf(bc.targets), area = Q.map(q => VX.quadArea(mesh, q)), AQ = area.reduce((x, y) => x + y, 0) || 1;
          let scale = 1;
          if (bc.kind === 'pressure') {   // scale so the total force matches the STL face area (voxel faces are stair-stepped)
            const faces = new Set(bc.targets.map(s => +String(s).replace(/^f/, ''))); let Astl = 0; for (const f of faces) if (mesh.seg.faces[f]) Astl += mesh.seg.faces[f].area;
            scale = Astl / AQ;
          }
          // bearing: only the side the pin pushes on carries load, weighted by cos(angle to the load)
          const Fm = Math.hypot(bc.x || 0, bc.y || 0, bc.z || 0) || 1, Fd = [(bc.x || 0) / Fm, (bc.y || 0) / Fm, (bc.z || 0) / Fm];
          const bw = bc.kind === 'bearing' ? Q.map((q, i) => { const tn = mesh.quads.tri[q] >= 0 ? VX.triNormal(doc.solid.tris, mesh.quads.tri[q]) : mesh.quads.normal[q]; return Math.max(0, -(tn[0] * Fd[0] + tn[1] * Fd[1] + tn[2] * Fd[2])) * area[i]; }) : null;
          const BW = bw ? bw.reduce((x, y) => x + y, 0) || 1 : 1;
          Q.forEach((q, i) => {
            let f;
            if (bc.kind === 'pressure') { const tn = mesh.quads.tri[q] >= 0 ? VX.triNormal(doc.solid.tris, mesh.quads.tri[q]) : mesh.quads.normal[q], A = area[i] * scale; f = [-bc.p * tn[0] * A, -bc.p * tn[1] * A, -bc.p * tn[2] * A]; }
            else if (bc.kind === 'bearing') { const w = bw[i] / BW; f = [bc.x * w, bc.y * w, bc.z * w]; }
            else { const w = area[i] / AQ; f = [bc.x * w, bc.y * w, bc.z * w]; }
            for (let j = 0; j < 4; j++) { const n = mesh.quads.n[q * 4 + j]; for (let c = 0; c < 3; c++) F[n * 3 + c] += f[c] / 4; }
          });
        } else {
          const E = sel2(bc.targets);
          if (bc.kind === 'force') { const A = FEM.edgeArea2D(P, E.map(b => b.n), form, t); if (A > 0) FEM.edgeLoads2D(P, E.map(b => b.n), form, t, () => [bc.x / A, bc.y / A], F); }
          else if (bc.kind === 'bearing') {
            const Fm = Math.hypot(bc.x, bc.y) || 1, dx = bc.x / Fm, dy = bc.y / Fm, wt = (nx, ny) => Math.max(0, -(nx * dx + ny * dy));
            const Wf = new Float64Array(P.length); FEM.edgeLoads2D(P, E.map(b => b.n), form, t, (x, y, nx, ny) => [wt(nx, ny), 0], Wf); let AW = 0; for (let i = 0; i < Wf.length; i += 2) AW += Wf[i];
            if (AW > 0) FEM.edgeLoads2D(P, E.map(b => b.n), form, t, (x, y, nx, ny) => { const w = wt(nx, ny) / AW; return [bc.x * w, bc.y * w]; }, F);
          }
          else FEM.edgeLoads2D(P, E.map(b => b.n), form, t, (x, y, nx, ny) => [-bc.p * nx, -bc.p * ny], F);
        }
      }
    }
    // axisymmetric: nodes on the axis cannot move radially
    if (axi) { const tol = 1e-9 * Math.max(1, ...Array.from({ length: Math.min(nn, 2000) }, (_, i) => Math.abs(P[2 * i]))); for (let n = 0; n < nn; n++) if (Math.abs(P[2 * n]) <= tol) fix(n, 0); }
    // springs on dofs that are already fixed are not needed
    const sp = springs.filter(s => !s.n.every((v, c) => Math.abs(v) < 1e-12 || fixed.has(s.node * dim + c)));
    const fx = Int32Array.from(fixed.keys()), fv = Float64Array.from(fixed.values());
    const model = { kind: mesh.kind, nodes: mesh.nodes, elems: mesh.elems, h: mesh.h, form: is3 ? null : form, thickness: t, mat: { E: mat.E, nu: mat.nu, rho: mat.rho * 1e-12 }, fixed: fx, fixedVal: fv, springs: sp, F, body, omega, analysis: doc.analysis.type, modes: doc.analysis.modes, solver: doc.mesh.solver };
    if (!fx.length && !sp.length && doc.analysis.type === 'static') warnings.push('There are no supports: add a fixed or frictionless support so the part cannot fly away.');
    return { model, groups, warnings };
  }

  // ---------- summaries ----------
  function summarize(doc, mesh, model, res, groups) {
    const dim = mesh.kind === 'H8' ? 3 : 2, nn = mesh.nodes.length / dim, out = { dim };
    const argmax = (a, sign = 1) => { let k = 0; for (let i = 1; i < a.length; i++) if (sign * a[i] > sign * a[k]) k = i; return k; };
    const um = new Float64Array(nn); for (let n = 0; n < nn; n++) { let s = 0; for (let c = 0; c < dim; c++) s += res.u[n * dim + c] ** 2; um[n] = Math.sqrt(s); }
    res.umag = um;
    if (res.modes) { out.modes = res.modes.map((m, i) => ({ mode: i + 1, f: m.f })); return out; }
    const sf = new Float64Array(nn); for (let n = 0; n < nn; n++) sf[n] = res.vm[n] > 0 ? Math.min(SF_CAP, doc.material.Sy / res.vm[n]) : SF_CAP; res.sf = sf;
    const at = n => Array.from(mesh.nodes.subarray(n * dim, n * dim + dim));
    const kd = argmax(um), kv = argmax(res.vm), k1 = argmax(res.s1), k3 = argmax(res.s3, -1), ks = argmax(sf, -1);
    Object.assign(out, { maxDisp: { v: um[kd], node: kd, at: at(kd) }, maxVM: { v: res.vm[kv], node: kv, at: at(kv) }, maxS1: { v: res.s1[k1], node: k1, at: at(k1) }, minS3: { v: res.s3[k3], node: k3, at: at(k3) }, minSF: { v: sf[ks], node: ks, at: at(ks) }, energy: res.energy });
    // reactions per support and the applied load total (for an equilibrium check)
    out.reactions = groups.filter(g => ['fixed', 'roller', 'disp'].includes(g.bc.kind)).map(g => { const r = [0, 0, 0]; for (const n of g.nodes) for (let c = 0; c < dim; c++) r[c] += res.react[n * dim + c]; return { id: g.bc.id, name: g.bc.name, r }; });
    // axis nodes (axisymmetric) carry no net axial reaction; include any reaction at dofs not in a group in the total
    const tot = [0, 0, 0]; for (let n = 0; n < nn; n++) for (let c = 0; c < dim; c++) tot[c] += res.react[n * dim + c];
    out.reactionTotal = tot;
    return out;
  }

  // one call from document to results (tests and worker-less use)
  function run(doc, progress) {
    const mesh = meshDoc(doc), b = buildModel(doc, mesh), res = FEM.solve(b.model, progress), sum = summarize(doc, mesh, b.model, res, b.groups);
    return { mesh, model: b.model, groups: b.groups, warnings: b.warnings, res, sum };
  }

  // value of a nodal field at a point (2-D): find the element and interpolate with the quadratic shape functions
  function probe2D(mesh, field, x, y, comps = 1, comp = 0) {
    const P = mesh.nodes, E = mesh.elems, ne = E.length / 6;
    for (let e = 0; e < ne; e++) {
      const a = E[6 * e], b = E[6 * e + 1], c = E[6 * e + 2];
      const x0 = P[2 * a], y0 = P[2 * a + 1], x1 = P[2 * b] - x0, y1 = P[2 * b + 1] - y0, x2 = P[2 * c] - x0, y2 = P[2 * c + 1] - y0, d = x1 * y2 - x2 * y1; if (!d) continue;
      const px = x - x0, py = y - y0, xi = (px * y2 - x2 * py) / d, eta = (x1 * py - px * y1) / d;
      if (xi < -1e-6 || eta < -1e-6 || xi + eta > 1 + 1e-6) continue;
      const N = FEM.t6Interp(xi, eta); let v = 0; for (let k = 0; k < 6; k++) v += N[k] * field[E[6 * e + k] * comps + comp];
      return { e, v };
    }
    return null;
  }

  return { MATERIALS, BC_KINDS, SF_CAP, newDoc, sanitize, serialize, f32ToB64, b64ToF32, autoSize, meshDoc, buildModel, summarize, run, probe2D };
});
