// Lumen Flow case presets. Units are SI: metres, m/s, m²/s, kg/m³.
(function (root) {
  const FLUIDS = { water: { name: 'Water, 20 °C', nu: 1.0e-6, rho: 998 }, air: { name: 'Air, 20 °C', nu: 1.5e-5, rho: 1.204 }, oil: { name: 'Light oil', nu: 1.0e-4, rho: 870 }, glycerin: { name: 'Glycerin', nu: 1.12e-3, rho: 1260 }, custom: { name: 'Custom' } };
  const CASES = {
    cylinder: { name: 'Cylinder in a stream (vortex street)', Lx: 0.44, Ly: 0.12, nx: 220, fluid: 'water', U: 0.005, obstacle: { type: 'circle', x: 0.08, y: 0.061, size: 0.02, angle: 0 },
      sides: { left: 'inlet', right: 'outlet', top: 'slip', bottom: 'slip' }, ref: 0.02, field: 'vort', note: '2 cm rod in water at 5 mm/s → Re = 100: the wake starts shedding vortices (a von Kármán street) after a few seconds of flow.' },
    airfoil: { name: 'NACA 2412 airfoil at 8°', Lx: 0.5, Ly: 0.2, nx: 250, fluid: 'air', U: 0.15, obstacle: { type: 'naca', code: '2412', x: 0.1, y: 0.1, size: 0.1, angle: 8 },
      sides: { left: 'inlet', right: 'outlet', top: 'slip', bottom: 'slip' }, ref: 0.1, field: 'p', note: '10 cm chord in air at 0.15 m/s → Re = 1000. Low pressure (blue) on top makes lift; real wings fly at Re in the millions, which needs turbulence models this app does not have.' },
    step: { name: 'Backward-facing step', Lx: 0.6, Ly: 0.05, nx: 240, fluid: 'water', U: 0.004, obstacle: { type: 'rect', x: 0, y: 0, w: 0.06, h: 0.025, angle: 0 },
      sides: { left: 'inlet', right: 'outlet', top: 'wall', bottom: 'wall' }, ref: 0.025, field: 'speed', note: 'Flow over a sudden step separates and reattaches downstream — a classic test of recirculation.' },
    cavity: { name: 'Lid-driven cavity (benchmark)', Lx: 1, Ly: 1, nx: 64, fluid: 'custom', nu: 0.01, rho: 1, U: 1, obstacle: null,
      sides: { left: 'wall', right: 'wall', bottom: 'wall', top: 'moving' }, ref: 1, field: 'speed', validation: 'ghia', note: 'Re = 100. Compare the centre-line velocity with Ghia, Ghia & Shin (1982) on the Validation tab once it settles (t ≈ 20 s).' },
    channel: { name: 'Channel flow (Poiseuille)', Lx: 12, Ly: 1, nx: 120, fluid: 'custom', nu: 0.05, rho: 1, U: 1, obstacle: null,
      sides: { left: 'inlet', right: 'outlet', top: 'wall', bottom: 'wall' }, ref: 1, field: 'speed', validation: 'poiseuille', note: 'Uniform inflow develops into the exact parabolic profile (peak 1.5 × mean). Compare on the Validation tab.' },
    blank: { name: 'Empty channel — draw your own', Lx: 0.5, Ly: 0.2, nx: 200, fluid: 'water', U: 0.004, obstacle: null,
      sides: { left: 'inlet', right: 'outlet', top: 'slip', bottom: 'slip' }, ref: 0.02, field: 'dye', note: 'Use Draw to paint obstacles (even while it runs) and Erase to remove them.' },
  };
  // obstacle predicate in domain coordinates
  function obstacleFn(o, FS) {
    if (!o) return null;
    const a = (o.angle || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    if (o.type === 'circle') return (x, y) => (x - o.x) ** 2 + (y - o.y) ** 2 <= (o.size / 2) ** 2;
    if (o.type === 'square') return (x, y) => { const X = (x - o.x) * ca + (y - o.y) * sa, Y = -(x - o.x) * sa + (y - o.y) * ca; return Math.abs(X) <= o.size / 2 && Math.abs(Y) <= o.size / 2; };
    if (o.type === 'plate') return (x, y) => { const X = (x - o.x) * ca + (y - o.y) * sa, Y = -(x - o.x) * sa + (y - o.y) * ca; return Math.abs(X) <= o.size * 0.06 && Math.abs(Y) <= o.size / 2; };
    if (o.type === 'rect') return (x, y) => x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h;
    if (o.type === 'naca') return FS.nacaInside(o.code || '0012', o.size, o.x - o.size * 0.25, o.y, o.angle || 0);
    return null;
  }
  root.FlowCases = { FLUIDS, CASES, obstacleFn };
})(typeof self !== 'undefined' ? self : this);
