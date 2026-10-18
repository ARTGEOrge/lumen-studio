// Lumen Map — "Open Sample": a fictional island (Isle of Lumen, in open South Atlantic water) generated
// procedurally — coastline, districts (Voronoi cells clipped by the overlay engine), lakes, rivers, roads, towns.
(function (root) {
  'use strict';
  const P = root.MapProj, G = root.MapGeo, O = root.MapOps, C = root.MapClass;
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const LON0 = -26.2, LAT0 = -38.6;
  function build() {
    const rnd = rng(20261017), tm = P.localTM(LON0, LAT0), ll = c => tm.inverse(c), close = r => [...r, r[0]];
    // blob: radius with a few harmonics
    const blob = (cx, cy, rx, ry, n, amp, seedOff) => { const ph = Array.from({ length: 6 }, () => rnd() * 6.283), out = []; for (let i = 0; i < n; i++) { const a = i / n * 6.283; let r = 1; for (let k = 2; k < 8; k++) r += amp / k * Math.sin(k * a + ph[k - 2]) * (k === 3 ? 1.6 : 1); r += amp * 0.25 * Math.sin(17 * a + seedOff); out.push([cx + rx * r * Math.cos(a), cy + ry * r * Math.sin(a)]); } return close(out); };
    const coast = blob(0, 0, 52000, 34000, 220, 0.22, 1.3);
    const islandM = { type: 'Polygon', coordinates: [coast] };
    const islets = [blob(61000, -21000, 5200, 3300, 48, 0.25, 2), blob(-57000, 19000, 3800, 2900, 40, 0.3, 4), blob(48000, 30000, 2600, 2000, 36, 0.3, 7)];
    // districts: Voronoi cells of seeds, clipped to the island by the overlay engine
    const seeds = [['Aurel', 9000, -6000, 61200], ['Westmarch', -32000, 6000, 18400], ['Highfell', -8000, 17000, 7300], ['Eastreach', 31000, 10000, 23900], ['Southmoor', -14000, -20000, 15600], ['Kelmore Vale', 30000, -19000, 11800]];
    const big = 200000, cells = seeds.map(([name, x, y]) => {
      let poly = [[-big, -big], [big, -big], [big, big], [-big, big]];
      seeds.forEach(([n2, x2, y2]) => { if (n2 === name) return; const mx = (x + x2) / 2, my = (y + y2) / 2, nx = x2 - x, ny = y2 - y; poly = clipHalf(poly, mx, my, nx, ny); });
      return close(poly);
    });
    const districts = seeds.map(([name, , , pop], i) => {
      let g = O.intersection({ type: 'Polygon', coordinates: [cells[i]] }, islandM);
      const isl = islets.map(r => O.intersection({ type: 'Polygon', coordinates: [cells[i]] }, { type: 'Polygon', coordinates: [r] })).filter(Boolean);
      if (isl.length) g = O.union([g, ...isl]);
      const geom = G.mapCoords(g, ll), area = G.geomArea(geom) / 1e6;
      return { geometry: geom, properties: { name, population: pop, area_km2: +area.toFixed(1), density: +(pop / area).toFixed(1), seat: ['Port Aurel', 'Westhaven', 'Hollin', 'Brightwater', 'Dunmere', 'Kelmore'][i] } };
    });
    // lakes
    const lakes = [{ name: 'Lake Merrow', c: [-12000, 9000], r: [3600, 2100] }, { name: 'Tarn Eske', c: [14000, 15000], r: [1500, 1100] }, { name: 'Saltmere', c: [-34000, -4000], r: [2200, 1400] }]
      .map(l => ({ geometry: G.mapCoords({ type: 'Polygon', coordinates: [blob(l.c[0], l.c[1], l.r[0], l.r[1], 44, 0.2, 3)] }, ll), properties: { name: l.name, kind: 'Lake' } }));
    // rivers: meander from the highlands towards the coast, clipped to the island
    const riverSpec = [['Ebb', -8000, 16000, -1.9], ['Aurel Water', -2000, 10000, -0.55], ['Fell Burn', -6000, 18000, 1.35], ['Easter Run', 12000, 15000, 0.15], ['Mere Water', -12000, 7000, 2.7], ['Southflow', -6000, 4000, -1.45]];
    const rivers = riverSpec.map(([name, x, y, dir]) => {
      const pts = [[x, y]]; let a = dir; for (let i = 0; i < 80; i++) { a += (rnd() - 0.5) * 0.5; x += Math.cos(a) * 900; y += Math.sin(a) * 900; pts.push([x, y]); }
      const clipped = O.clipLines({ type: 'LineString', coordinates: pts }, islandM);
      const line = clipped && (clipped.type === 'LineString' ? clipped.coordinates : clipped.coordinates[0]);
      return line && { geometry: G.mapCoords({ type: 'LineString', coordinates: line }, ll), properties: { name, length_km: 0 } };
    }).filter(Boolean);
    rivers.forEach(r => r.properties.length_km = +(G.geomLength(r.geometry) / 1000).toFixed(1));
    // towns
    const T = [['Port Aurel', 18000, -9500, 38400, 'Capital', true], ['Westhaven', -40000, 7000, 12100, 'Town', true], ['Hollin', -7000, 21000, 2900, 'Town', false], ['Brightwater', 37000, 13000, 15800, 'Town', true],
      ['Dunmere', -15000, -24500, 8800, 'Town', true], ['Kelmore', 27000, -21000, 6400, 'Town', false], ['Saltcliff', -45000, -6000, 1900, 'Village', true], ['Ravensby', 2000, 25500, 1300, 'Village', true],
      ['Ebbford', -21000, 12000, 2400, 'Village', false], ['Lowcross', 4000, -2000, 3700, 'Village', false], ['Eskdale', 15000, 9000, 1100, 'Village', false], ['Northcape Light', 45500, 25500, 40, 'Hamlet', true]];
    const towns = T.map(([name, x, y, pop, type, port]) => ({ geometry: { type: 'Point', coordinates: ll([x, y]) }, properties: { name, population: pop, type, port } }));
    // roads: a minimum spanning tree of the towns (plus a ring road segment), gently curved
    const idx = T.slice(0, 11).map((t, i) => i), inT = new Set([0]), edges = [];
    while (inT.size < idx.length) { let best = null; inT.forEach(i => idx.forEach(j => { if (inT.has(j)) return; const d = Math.hypot(T[i][1] - T[j][1], T[i][2] - T[j][2]); if (!best || d < best[2]) best = [i, j, d]; })); edges.push(best); inT.add(best[1]); }
    edges.push([1, 4, 0], [3, 5, 0]);
    const roads = edges.map(([i, j], k) => {
      const a = [T[i][1], T[i][2]], b = [T[j][1], T[j][2]], n = 24, nx = -(b[1] - a[1]), ny = b[0] - a[0], bend = (rnd() - 0.5) * 0.25, pts = [];
      for (let s = 0; s <= n; s++) { const t = s / n, w = Math.sin(Math.PI * t) * bend + Math.sin(3 * Math.PI * t) * 0.02; pts.push([a[0] + (b[0] - a[0]) * t + nx * w, a[1] + (b[1] - a[1]) * t + ny * w]); }
      const cls = T[i][4] === 'Capital' || T[j][4] === 'Capital' || (T[i][4] === 'Town' && T[j][4] === 'Town') ? 'Primary' : 'Secondary';
      return { geometry: G.mapCoords({ type: 'LineString', coordinates: pts }, ll), properties: { name: `${cls === 'Primary' ? 'A' : 'B'}${k + 1}`, class: cls, from: T[i][0], to: T[j][0] } };
    });
    const IO = root.MapIO, lyr = (name, geomType, feats, style, labels) => ({ name, geomType, features: feats.map((f, i) => ({ id: i + 1, ...f })), fields: IO.inferFields(feats), style, labels, visible: true, opacity: 1, sourceCrs: 'EPSG:4326' });
    const dens = districts.map(d => d.properties.density), br = C.breaks(dens, 4, "jenks");
    const layers = [
      lyr('Towns', 'Point', towns, { mode: 'categorized', field: 'type', size: 9, width: 1, stroke: '#ffffff', shape: 'circle', categories: [{ value: 'Capital', color: '#c0262d', label: 'Capital' }, { value: 'Town', color: '#1e395b', label: 'Town' }, { value: 'Village', color: '#5a7fa8', label: 'Village' }, { value: 'Hamlet', color: '#9db3cc', label: 'Hamlet' }] }, { on: true, expr: '"name"', size: 11.5, color: '#1a2533', halo: true, bold: false }),
      lyr('Roads', 'LineString', roads, { mode: 'categorized', field: 'class', width: 2.2, categories: [{ value: 'Primary', color: '#d9622b', label: 'Primary road' }, { value: 'Secondary', color: '#b08a5a', label: 'Secondary road' }] }, { on: false, expr: '"name"', size: 9, color: '#7a3b10', halo: true }),
      lyr('Rivers', 'LineString', rivers, { mode: 'single', fill: '#3d85c6', stroke: '#3d85c6', width: 1.6 }, { on: true, expr: '"name"', size: 9.5, color: '#1f5c99', halo: true, italic: true }),
      lyr('Lakes', 'Polygon', lakes, { mode: 'single', fill: '#9cc8ec', stroke: '#3d85c6', width: 0.8, fillOpacity: 1 }, { on: false, expr: '"name"', size: 9, color: '#1f5c99', halo: true }),
      lyr('Districts', 'Polygon', districts, { mode: 'graduated', field: 'density', method: 'jenks', nClasses: 4, ramp: "Yellow-Red", invert: false, classes: C.makeClasses(br, "Yellow-Red"), stroke: '#ffffff', width: 1.4, fillOpacity: 0.82 }, { on: true, expr: 'upper("name")', size: 10.5, color: '#203040', halo: true, bold: true }),
    ];
    return { title: 'Isle of Lumen', crs: 'EPSG:32726', layers, center: [LON0, LAT0] };
  }
  // Sutherland–Hodgman: keep the half-plane on the side of (mx,my) away from direction (nx,ny)
  function clipHalf(poly, mx, my, nx, ny) {
    const out = [], side = p => (p[0] - mx) * nx + (p[1] - my) * ny;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], sa = side(a), sb = side(b);
      if (sa <= 0) out.push(a);
      if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) { const t = sa / (sa - sb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    return out;
  }
  root.MapSample = { build };
})(typeof self !== 'undefined' ? self : this);
