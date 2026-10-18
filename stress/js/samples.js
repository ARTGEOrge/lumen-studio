// Lumen Stress — sample studies (each is a plain project document).
(function () {
  const S = window.StressStudy, G = window.StressGeom, M2 = window.StressMesh2D, mat = id => Object.assign({}, S.MATERIALS.find(m => m.id === id));
  const q = Math.tan(Math.PI / 8);   // bulge of a quarter circle
  // lug outline: straight flanks rising from a 140 mm base into a half-circle head (R40) around the pin
  const lugShapes = () => [
    { id: 'lug', name: 'Lug plate', kind: 'poly', pts: [[0, 0, 0], [140, 0, 0], [140, 15, 0], [128, 15, -q], [113, 30, 0], [110, 110, 1], [30, 110, 0], [27, 30, -q], [12, 15, 0], [0, 15, 0]] },
    { id: 'pin', name: 'Pin hole', kind: 'circle', cx: 70, cy: 110, r: 20 }
  ];
  function lug2D() {
    const d = S.newDoc('2d'); d.name = 'Lifting lug'; d.study.thickness = 20; d.material = mat('s355'); d.shapes = lugShapes();
    d.mesh.size = 6; d.mesh.refine = { 'pin:0': 2, 'lug:3': 1.5, 'lug:7': 1.5 };
    d.bcs = [{ id: 'b1', kind: 'fixed', name: 'Fixed support', targets: ['lug:0'] }, { id: 'b2', kind: 'bearing', name: 'Pin load (60 kN)', targets: ['pin:0'], x: 12000, y: 60000, z: 0 }, { id: 'b3', kind: 'gravity', name: 'Standard earth gravity', x: 0, y: -9.80665, z: 0 }];
    return d;
  }
  function plateHole() {
    const d = S.newDoc('2d'); d.name = 'Plate with a hole (quarter model)'; d.study.thickness = 10; d.material = mat('steel');
    d.shapes = [{ id: 'q', name: 'Quarter plate', kind: 'poly', pts: [[10, 0, 0], [200, 0, 0], [200, 100, 0], [0, 100, 0], [0, 10, -q]] }];
    d.mesh.size = 10; d.mesh.refine = { 'q:4': 0.6 };
    d.bcs = [{ id: 'b1', kind: 'roller', name: 'Symmetry (x)', targets: ['q:3'] }, { id: 'b2', kind: 'roller', name: 'Symmetry (y)', targets: ['q:0'] }, { id: 'b3', kind: 'pressure', name: 'Tension 100 MPa', targets: ['q:1'], p: -100 }];
    return d;
  }
  function cylinder() {
    const d = S.newDoc('2d'); d.name = 'Thick cylinder (Lamé)'; d.study.model = 'axi'; d.material = mat('steel');
    d.shapes = [{ id: 'c', name: 'Wall section', kind: 'rect', x: 50, y: 0, w: 50, h: 40, r: 0 }]; d.mesh.size = 3;
    d.bcs = [{ id: 'b1', kind: 'roller', name: 'End constraint', targets: ['c:0', 'c:2'] }, { id: 'b2', kind: 'pressure', name: 'Internal pressure 100 MPa', targets: ['c:3'], p: 100 }];
    return d;
  }
  function beamModal() {
    const d = S.newDoc('2d'); d.name = 'Cantilever beam (modal)'; d.study.thickness = 10; d.material = mat('al6061');
    d.shapes = [{ id: 'b', name: 'Beam', kind: 'rect', x: 0, y: 0, w: 300, h: 15, r: 0 }]; d.mesh.size = 3;
    d.bcs = [{ id: 'b1', kind: 'fixed', name: 'Fixed support', targets: ['b:3'] }]; d.analysis = { type: 'modal', modes: 6 };
    return d;
  }
  function disc() {
    const d = S.newDoc('2d'); d.name = 'Flywheel (axisymmetric, 6000 rpm)'; d.study.model = 'axi'; d.material = mat('c45');
    d.shapes = [{ id: 'f', name: 'Flywheel section', kind: 'poly', pts: [[20, -30, 0], [45, -30, 0], [45, -8, 0], [160, -8, 0], [160, -25, 0], [200, -25, 0], [200, 25, 0], [160, 25, 0], [160, 8, 0], [45, 8, 0], [45, 30, 0], [20, 30, 0]] }];
    d.mesh.size = 4;
    d.bcs = [{ id: 'b1', kind: 'fixed', name: 'Shaft (fixed)', targets: ['f:11'] }, { id: 'b2', kind: 'rotation', name: 'Rotational velocity 6000 rpm', rpm: 6000 }];
    return d;
  }
  function lug3D() {
    const d = S.newDoc('3d'); d.name = 'Lifting lug (3-D)'; d.material = mat('s355');
    const shapes = lugShapes(), m = M2.mesh(shapes, { size: 8, quadratic: false });
    const tris = new Float32Array(G.extrude(m.tri2d, 20).flat(2)); d.solid = { name: 'Lifting lug', tris };
    const VX = window.StressVoxel, seg = VX.segmentFaces(tris); d._seg = seg;
    const base = seg.faces.find(f => f.normal[2] < -0.99), hole = seg.faces.filter(f => !f.planar && Math.hypot(f.centroid[0] - 70, f.centroid[2] - 110) < 5);
    d.mesh.target = 14000;
    d.bcs = [{ id: 'b1', kind: 'fixed', name: 'Fixed support', targets: ['f' + base.id] }, { id: 'b2', kind: 'bearing', name: 'Pin load (60 kN)', targets: hole.map(f => 'f' + f.id), x: 12000, y: 0, z: 60000 }];
    return d;
  }
  window.StressSamples = [
    { id: 'lug', name: 'Lifting lug (2-D plane stress)', make: lug2D },
    { id: 'hole', name: 'Plate with a hole — Kt (quarter model)', make: plateHole },
    { id: 'cyl', name: 'Thick cylinder under pressure (axisymmetric)', make: cylinder },
    { id: 'disc', name: 'Flywheel at 6000 rpm (axisymmetric)', make: disc },
    { id: 'beam', name: 'Cantilever beam — natural frequencies', make: beamModal },
    { id: 'lug3d', name: 'Lifting lug (3-D voxel solid)', make: lug3D }
  ];
})();
