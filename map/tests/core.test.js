// Lumen Map — Node tests for the GIS core: projections (known coordinates), WKT, geodesy, polygon ops,
// shapefile parsing (hand-built binaries following the ESRI spec), I/O, expressions and classification.
// Run: node --test C:/code/lumen-studio/map/tests/
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
globalThis.paper = require('C:/code/lumen-studio/tools/deps/vector/node_modules/paper/dist/paper-core.js');
const P = require('../js/proj.js'), G = require('../js/geo.js'), O = require('../js/ops.js'), IO = require('../js/io.js'), X = require('../js/expr.js'), C = require('../js/classify.js');
const fflate = require('../vendor/fflate.min.js');
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ± ${tol}, got ${a}`);
const dms = (d, m, s) => d + m / 60 + s / 3600;

// ---------------- projections ----------------
test('UTM: White House in zone 18N (published 323394 E, 4307396 N)', () => {
  const [e, n] = P.make(P.get('EPSG:32618')).forward([-77.0365, 38.8977]);
  near(e, 323394.3, 1); near(n, 4307395.6, 1);
});
test('UTM: zone origin and southern false northing', () => {
  const [e, n] = P.make(P.get('EPSG:32631')).forward([3, 0]); near(e, 500000, 1e-6); near(n, 0, 1e-6);
  const [e2, n2] = P.make(P.get('EPSG:32733')).forward([15, -1e-9]); near(e2, 500000, 1e-6); near(n2, 10000000, 1e-3);
});
test('Transverse Mercator: Ordnance Survey worked example (Airy 1830, OSGB36)', () => {
  const tm = P.make({ proj: 'tmerc', lat0: 49, lon0: -2, k0: 0.9996012717, x0: 400000, y0: -100000, a: 6377563.396, f: 1 / 299.3249646 });
  const [e, n] = tm.forward([dms(1, 43, 4.5177), dms(52, 39, 27.2531)]);
  near(e, 651409.903, 0.002, 'E'); near(n, 313177.270, 0.002, 'N');
  const [lon, lat] = tm.inverse([651409.903, 313177.270]); near(lon, dms(1, 43, 4.5177), 1e-8); near(lat, dms(52, 39, 27.2531), 1e-8);
});
test('British National Grid with 7-parameter Helmert: OS example (Caister water tower)', () => {
  // ETRS89 (≈WGS84) 52°39′28.8282″N 1°42′57.8663″E is OSGB36 E 651409.9, N 313177.3 (OSTN); the single
  // 7-parameter Helmert transformation is documented by OS as good to about 5 m — check that level.
  const [e, n] = P.make(P.get('EPSG:27700')).forward([dms(1, 42, 57.8663), dms(52, 39, 28.8282)]);
  near(e, 651409.9, 5, 'E'); near(n, 313177.3, 5, 'N');
});
test('LAEA Europe (EPSG:3035): EPSG Guidance Note 7-2 example', () => {
  const [e, n] = P.make(P.get('EPSG:3035')).forward([5, 50]); near(e, 3962799.45, 0.01); near(n, 2999718.85, 0.01);
  const [lon, lat] = P.make(P.get('EPSG:3035')).inverse([3962799.45, 2999718.85]); near(lon, 5, 1e-6); near(lat, 50, 1e-6); // input rounded to cm
});
test('Albers equal-area: Snyder (1987) numerical example, Clarke 1866', () => {
  const p = P.make({ proj: 'aea', lat0: 23, lon0: -96, lat1: 29.5, lat2: 45.5, a: 6378206.4, f: 1 / 294.978698214 });
  const [x, y] = p.forward([-75, 35]); near(x, 1885472.7, 0.1); near(y, 1535925.0, 0.1);
  const [lon, lat] = p.inverse([x, y]); near(lon, -75, 1e-9); near(lat, 35, 1e-9);
});
test('Lambert conformal conic 2SP: Snyder (1987) numerical example, Clarke 1866', () => {
  const p = P.make({ proj: 'lcc', lat0: 23, lon0: -96, lat1: 33, lat2: 45, a: 6378206.4, f: 1 / 294.978698214 });
  const [x, y] = p.forward([-75, 35]); near(x, 1894410.9, 0.1); near(y, 1564649.5, 0.1);
});
test('Web Mercator: square world extent', () => {
  const m = P.make(P.get('EPSG:3857'));
  const [x, y] = m.forward([180, 85.0511287798066]); near(x, 20037508.342789244, 1e-6); near(y, 20037508.342789244, 1e-3);
  const [lon, lat] = m.inverse([-8238310.24, 4970071.58]); near(lon, -74.006, 1e-4); near(lat, 40.7128, 1e-4); // New York
});
test('Mollweide: extent of the ellipse (2√2·R by √2·R)', () => {
  const m = P.make(P.get('ESRI:54009')), R = 6378137;
  near(m.forward([180, 0])[0], 2 * Math.SQRT2 * R, 1e-3); near(m.forward([0, 90])[1], Math.SQRT2 * R, 1e-3);
});
test('equal-area projections preserve area (numerical Jacobian vs authalic sphere)', () => {
  for (const code of ['EPSG:8857', 'ESRI:54009', 'EPSG:6933', 'EPSG:3035', 'EPSG:5070']) {
    const m = P.make(P.get(code));
    for (const [lon, lat] of [[10, 52], [-90, 38], [40, -20], [5, 60]]) {
      const h = 1e-4, a = m.forward([lon, lat]), b = m.forward([lon + h, lat]), c = m.forward([lon, lat + h]);
      const proj = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
      const ring = [[lon, lat], [lon + h, lat], [lon + h, lat + h], [lon, lat + h], [lon, lat]];
      const D2R = Math.PI / 180;
      // Mollweide (as in PROJ) is spherical on R = a: compare with the sphere; the others are ellipsoidal (authalic)
      const sph = code === 'ESRI:54009' ? 6378137 ** 2 * h * D2R * (Math.sin((lat + h) * D2R) - Math.sin(lat * D2R)) : Math.abs(G.ringAreaGeo(ring));
      near(proj / sph, 1, 2e-4, code + ' at ' + lon + ',' + lat);
    }
  }
});
test('round trip forward/inverse for every registered CRS', () => {
  for (const [code] of P.list().filter((x, i) => i < 30 || /32633|32756/.test(x[0]))) {
    const m = P.make(P.get(code)), d = P.get(code);
    const pts = d.proj === 'stere' ? (d.lat0 > 0 ? [[-45, 75], [100, 60]] : [[30, -75], [-120, -65]]) : d.proj === 'tmerc' ? [[d.lon0 + 2, 45], [d.lon0 - 2.5, -30]] : d.proj === 'laea' || d.proj === 'aea' || d.proj === 'lcc' ? [[d.lon0 + 5, (d.lat0 || 45) + 3], [d.lon0 - 8, (d.lat0 || 45) - 5]] : [[12.5, 47.25], [-120.3, -33.9]];
    const tol = d.towgs84 ? 1e-6 : 1e-8; // a datum shift drops the ellipsoidal height, costing a few cm
    for (const p of pts) { const q = m.inverse(m.forward(p)); near(q[0], p[0], tol, code + ' lon'); near(q[1], p[1], tol, code + ' lat'); }
  }
});
test('WKT: ESRI .prj for UTM 33N', () => {
  const wkt = 'PROJCS["WGS_1984_UTM_Zone_33N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",15.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';
  const d = P.fromWkt(wkt); assert.equal(d.proj, 'tmerc'); assert.equal(d.lon0, 15); assert.equal(d.k0, 0.9996); assert.ok(!d.datumWarning);
  const a = P.make(d).forward([16.3738, 48.2082]), b = P.make(P.get('EPSG:32633')).forward([16.3738, 48.2082]);
  near(a[0], b[0], 1e-6); near(a[1], b[1], 1e-6);
});
test('WKT: OGC WKT1 with AUTHORITY, US survey feet LCC (state plane style)', () => {
  const wkt = `PROJCS["NAD83 / Example (ftUS)",GEOGCS["NAD83",DATUM["North_American_Datum_1983",SPHEROID["GRS 1980",6378137,298.257222101,AUTHORITY["EPSG","7019"]],TOWGS84[0,0,0,0,0,0,0]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic_2SP"],PARAMETER["standard_parallel_1",33],PARAMETER["standard_parallel_2",45],PARAMETER["latitude_of_origin",23],PARAMETER["central_meridian",-96],PARAMETER["false_easting",0],PARAMETER["false_northing",0],UNIT["US survey foot",0.3048006096012192]]`;
  const d = P.fromWkt(wkt); assert.equal(d.proj, 'lcc'); near(d.units, 0.3048006096012192, 1e-15);
  const m = P.make(d), mm = P.make({ ...d, units: 1 }), [x, y] = m.forward([-75, 35]), [xm, ym] = mm.forward([-75, 35]);
  near(x * 0.3048006096012192, xm, 1e-6); near(y * 0.3048006096012192, ym, 1e-6);
  const back = m.inverse([x, y]); near(back[0], -75, 1e-9); near(back[1], 35, 1e-9);
});
test('WKT: Web Mercator auxiliary sphere, geographic, WKT2 and EPSG ids', () => {
  assert.equal(P.fromWkt('PROJCS["WGS_1984_Web_Mercator_Auxiliary_Sphere",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Mercator_Auxiliary_Sphere"],PARAMETER["False_Easting",0.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",0.0],PARAMETER["Standard_Parallel_1",0.0],PARAMETER["Auxiliary_Sphere_Type",0.0],UNIT["Meter",1.0]]').proj, 'webmerc');
  assert.equal(P.fromWkt('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]').proj, 'longlat');
  const w2 = `PROJCRS["ETRS89-extended / LAEA Europe",BASEGEOGCRS["ETRS89",DATUM["European Terrestrial Reference System 1989",ELLIPSOID["GRS 1980",6378137,298.257222101,LENGTHUNIT["metre",1]]],PRIMEM["Greenwich",0,ANGLEUNIT["degree",0.0174532925199433]]],CONVERSION["Europe Equal Area 2001",METHOD["Lambert Azimuthal Equal Area",ID["EPSG",9820]],PARAMETER["Latitude of natural origin",52,ANGLEUNIT["degree",0.0174532925199433]],PARAMETER["Longitude of natural origin",10,ANGLEUNIT["degree",0.0174532925199433]],PARAMETER["False easting",4321000,LENGTHUNIT["metre",1]],PARAMETER["False northing",3210000,LENGTHUNIT["metre",1]]],CS[Cartesian,2],AXIS["northing (Y)",north],AXIS["easting (X)",east],LENGTHUNIT["metre",1],ID["EPSG",3035]]`;
  const d = P.fromWkt(w2); assert.equal(d.proj, 'laea'); assert.equal(d.code, 'EPSG:3035');
  const [e, n] = P.make(d).forward([5, 50]); near(e, 3962799.45, 0.01); near(n, 2999718.85, 0.01);
  const d2 = P.fromWkt('GEOGCS["Tokyo",DATUM["Tokyo",SPHEROID["Bessel 1841",6377397.155,299.1528128]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]');
  assert.equal(d2.datumWarning, 'Tokyo');
});
test('WKT export round trip (toWkt → fromWkt)', () => {
  for (const code of ['EPSG:32633', 'EPSG:3035', 'EPSG:5070', 'EPSG:2154', 'EPSG:8857', 'ESRI:54009', 'EPSG:3857']) {
    const d = P.fromWkt(P.toWkt(code)), a = P.make(d).forward([8.5, 47.4]), b = P.make(P.get(code)).forward([8.5, 47.4]);
    near(a[0], b[0], 1e-6, code); near(a[1], b[1], 1e-6, code);
  }
});

// ---------------- geodesy ----------------
test('Vincenty: Flinders Peak → Buninyong (54 972.271 m, 306°52′05.37″)', () => {
  const r = G.inverse([dms(144, 25, 29.5244), -dms(37, 57, 3.7203)], [dms(143, 55, 35.3839), -dms(37, 39, 10.1561)]);
  near(r.s, 54972.271, 0.001); near(r.az1, dms(306, 52, 5.37), 1e-5);
});
test('geodesic distance: equator degree and quarter meridian of WGS84', () => {
  near(G.distance([0, 0], [1, 0]), 111319.4908, 1e-3);
  near(G.distance([0, 0], [0, 90]), 10001965.729, 1e-3);
  const d = G.distance([2.3522, 48.8566], [-0.1276, 51.5072]); near(d, 343923, 300); // Paris–London ≈ 344 km
});
test('Vincenty direct is the inverse of inverse', () => {
  const p = [10, 50], q = G.direct(p, 37.5, 250000), r = G.inverse(p, q); near(r.s, 250000, 1e-4); near(r.az1, 37.5, 1e-8);
});
test('geodesic area: total ellipsoid surface and a lat/lon cell', () => {
  near(4 * Math.PI * G.RQ * G.RQ / 1e6, 510065621.7, 1); // km²
  // 1°×1° cell at the equator with dense edges ≈ analytic authalic band area
  const ring = []; for (let i = 0; i <= 100; i++) ring.push([i / 100, 0]); for (let i = 0; i <= 100; i++) ring.push([1, i / 100]); for (let i = 100; i >= 0; i--) ring.push([i / 100, 1]); for (let i = 100; i >= 0; i--) ring.push([0, i / 100]);
  const exact = G.RQ * G.RQ * (Math.PI / 180) * (Math.sin(G.authLat(Math.PI / 180)) - Math.sin(G.authLat(0)));
  near(Math.abs(G.ringAreaGeo(ring)) / exact, 1, 1e-5);
  near(exact / 1e6, 12308.778, 0.5); // well-known value for the 1° equatorial cell on WGS84
});
test('geodesic area of a 1 km UTM square equals 1 km² / k0²', () => {
  const m = P.make(P.get('EPSG:32633')), c = m.forward([15, 45]);
  const sq = [[0, 0], [1000, 0], [1000, 1000], [0, 1000], [0, 0]].map(p => m.inverse([c[0] + p[0], c[1] + p[1]]));
  near(G.geomArea({ type: 'Polygon', coordinates: [sq] }), 1e6 / (0.9996 * 0.9996), 2);
});

// ---------------- polygon ops ----------------
const sq = (x, y, s) => ({ type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });
const area = g => G.polygonsOf(g).reduce((s, p) => s + p.reduce((t, r, i) => t + (i ? -1 : 1) * Math.abs(G.ringArea(r)), 0), 0);
test('union of adjacent squares dissolves the shared edge', () => {
  const u = O.union([sq(0, 0, 1), sq(1, 0, 1)]); assert.equal(u.type, 'Polygon'); near(area(u), 2, 1e-9);
  assert.equal(u.coordinates[0].length, 5); // 4 corners + closing point
  const disj = O.union([sq(0, 0, 1), sq(5, 0, 1)]); assert.equal(disj.type, 'MultiPolygon'); near(area(disj), 2, 1e-9);
});
test('intersection and difference (hole creation, RFC 7946 orientation)', () => {
  near(area(O.intersection(sq(0, 0, 2), sq(1, 1, 2))), 1, 1e-9);
  assert.equal(O.intersection(sq(0, 0, 1), sq(3, 3, 1)), null);
  const d = O.difference(sq(0, 0, 4), sq(1, 1, 2)); assert.equal(d.coordinates.length, 2); near(area(d), 12, 1e-9);
  assert.ok(G.ringArea(d.coordinates[0]) > 0 && G.ringArea(d.coordinates[1]) < 0, 'outer CCW, hole CW');
  const island = O.union([d, sq(1.5, 1.5, 1)]); assert.equal(island.type, 'MultiPolygon'); near(area(island), 13, 1e-9);
});
test('ring nesting: island inside a hole becomes its own polygon', () => {
  const g = O.ringsToGeom([sq(0, 0, 10).coordinates[0], sq(2, 2, 6).coordinates[0], sq(4, 4, 2).coordinates[0]]);
  assert.equal(g.type, 'MultiPolygon'); assert.equal(g.coordinates[0].length, 2); near(area(g), 100 - 36 + 4, 1e-9);
});
test('line clipping inside/outside a polygon', () => {
  const l = { type: 'LineString', coordinates: [[-1, 0.5], [3, 0.5]] };
  assert.deepEqual(O.clipLines(l, sq(0, 0, 1)).coordinates, [[0, 0.5], [1, 0.5]]);
  const out = O.clipLines(l, sq(0, 0, 1), false); assert.equal(out.type, 'MultiLineString'); near(G.length ? out.coordinates.reduce((s, c) => s + Math.abs(c[1][0] - c[0][0]), 0) : 0, 3, 1e-12);
});
test('planar buffers: point, polygon outward and inward', () => {
  const n = 32, polyCircle = n / 2 * Math.sin(2 * Math.PI / n);
  near(area(O.buffer({ type: 'Point', coordinates: [0, 0] }, 10, 8)), 100 * polyCircle, 1e-6);
  const out = O.buffer(sq(0, 0, 10), 1, 8); near(area(out), 100 + 40 + polyCircle, 0.02);
  const inn = O.buffer(sq(0, 0, 10), -1, 8); near(area(inn), 64, 1e-6);
  const lb = O.buffer({ type: 'LineString', coordinates: [[0, 0], [10, 0], [10, 10]] }, 1, 8); near(area(lb), 2 * 20 + polyCircle - (Math.PI / 4 - 0) * 0 + 0, 0.6);
});
test('geodesic buffer: 1 km around a point has ≈ π km² area', () => {
  const g = O.geoBuffer({ type: 'Point', coordinates: [10, 50] }, 1000, 16), n = 64;
  near(G.geomArea(g) / (1e6 * n / 2 * Math.sin(2 * Math.PI / n)), 1, 2e-3);
});
test('lon/lat overlay wrappers keep precision', () => {
  const a = { type: 'Polygon', coordinates: [[[10, 50], [10.001, 50], [10.001, 50.001], [10, 50.001], [10, 50]]] }, b = { type: 'Polygon', coordinates: [[[10.0005, 50], [10.002, 50], [10.002, 50.001], [10.0005, 50.001], [10.0005, 50]]] };
  const i = O.geoIntersection(a, b), bb = G.bbox(i); near(bb[0], 10.0005, 1e-12); near(bb[2], 10.001, 1e-12);
  near(G.geomArea(i) / G.geomArea(a), 0.5, 1e-6);
});
test('spatial predicates', () => {
  assert.ok(O.intersects(sq(0, 0, 2), sq(1, 1, 2))); assert.ok(!O.intersects(sq(0, 0, 1), sq(2, 2, 1)));
  assert.ok(O.intersects({ type: 'Point', coordinates: [0.5, 0.5] }, sq(0, 0, 1)));
  assert.ok(O.intersects({ type: 'LineString', coordinates: [[-1, 0.5], [3, 0.5]] }, sq(0, 0, 1)));
  assert.ok(O.within(sq(1, 1, 1), sq(0, 0, 4))); assert.ok(!O.within(sq(3, 3, 2), sq(0, 0, 4)));
  near(O.distance(sq(0, 0, 1), sq(4, 0, 1)), 3, 1e-12);
  near(O.geoDistance({ type: 'Point', coordinates: [0, 0] }, { type: 'Point', coordinates: [0.01, 0] }), 1113.19, 1);
});
test('planar centroid and point on surface', () => {
  const L = { type: 'Polygon', coordinates: [[[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2], [0, 0]]] };
  const c = G.centroid(L); near(c[0], 5 / 6, 1e-12); near(c[1], 5 / 6, 1e-12);
  const U = { type: 'Polygon', coordinates: [[[0, 0], [3, 0], [3, 3], [2, 3], [2, 1], [1, 1], [1, 3], [0, 3], [0, 0]]] };
  assert.ok(G.pointInGeom(G.pointOnSurface(U), U));
});

// ---------------- shapefile parsing (bytes built by hand from the ESRI whitepaper) ----------------
function shpFile(type, records) {
  const content = records.map(r => r.bytes), len = 100 + content.reduce((s, c) => s + 8 + c.length, 0), b = new Uint8Array(len), dv = new DataView(b.buffer);
  dv.setInt32(0, 9994, false); dv.setInt32(24, len / 2, false); dv.setInt32(28, 1000, true); dv.setInt32(32, type, true);
  let o = 100; content.forEach((c, i) => { dv.setInt32(o, i + 1, false); dv.setInt32(o + 4, c.length / 2, false); b.set(c, o + 8); o += 8 + c.length; });
  return b;
}
function polyRec(type, parts, z) { // parts: arrays of [x,y]
  const pts = parts.flat(), hasZ = type > 10, n = pts.length, size = 44 + parts.length * 4 + n * 16 + (hasZ ? 16 + n * 8 + 16 + n * 8 : 0);
  const b = new Uint8Array(size), dv = new DataView(b.buffer); dv.setInt32(0, type, true);
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]); [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, i) => dv.setFloat64(4 + i * 8, v, true));
  dv.setInt32(36, parts.length, true); dv.setInt32(40, n, true); let k = 0; parts.forEach((p, i) => { dv.setInt32(44 + i * 4, k, true); k += p.length; });
  const p0 = 44 + parts.length * 4; pts.forEach((p, i) => { dv.setFloat64(p0 + i * 16, p[0], true); dv.setFloat64(p0 + 8 + i * 16, p[1], true); });
  if (hasZ) { const z0 = p0 + n * 16; dv.setFloat64(z0, Math.min(...z), true); dv.setFloat64(z0 + 8, Math.max(...z), true); z.forEach((v, i) => dv.setFloat64(z0 + 16 + i * 8, v, true)); }
  return { bytes: b };
}
const nullRec = () => { const b = new Uint8Array(4); return { bytes: b }; };
function dbfFile(fields, rows, ldid, enc) {
  const hlen = 32 + fields.length * 32 + 1, rlen = 1 + fields.reduce((s, f) => s + f.len, 0), b = new Uint8Array(hlen + rows.length * rlen + 1), dv = new DataView(b.buffer);
  b[0] = 3; dv.setUint32(4, rows.length, true); dv.setUint16(8, hlen, true); dv.setUint16(10, rlen, true); b[29] = ldid;
  fields.forEach((f, i) => { const o = 32 + i * 32; [...f.name].forEach((c, k) => b[o + k] = c.charCodeAt(0)); b[o + 11] = f.type.charCodeAt(0); b[o + 16] = f.len; b[o + 17] = f.dec || 0; });
  b[hlen - 1] = 0x0d;
  rows.forEach((r, ri) => { let o = hlen + ri * rlen; b[o++] = r.deleted ? 0x2a : 0x20; fields.forEach(f => { const s = String(r[f.name] ?? '').padEnd(f.len).slice(0, f.len); for (let k = 0; k < f.len; k++) b[o + k] = enc(s[k]); o += f.len; }); });
  b[b.length - 1] = 0x1a; return b;
}
const cp1252 = ch => ch === 'é' ? 0xe9 : ch === 'ü' ? 0xfc : ch.charCodeAt(0);
test('shapefile: polygon with hole, null shape, attributes (Windows-1252), deleted record', () => {
  const outerCW = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]], holeCCW = [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]], second = [[20, 0], [20, 5], [25, 5], [25, 0], [20, 0]];
  const shp = shpFile(5, [polyRec(5, [outerCW, holeCCW]), nullRec(), polyRec(5, [second]), polyRec(5, [second])]);
  const fields = [{ name: 'NAME', type: 'C', len: 12 }, { name: 'POP', type: 'N', len: 10, dec: 2 }, { name: 'OK', type: 'L', len: 1 }, { name: 'WHEN', type: 'D', len: 8 }];
  const dbf = dbfFile(fields, [{ NAME: 'Genève', POP: '1234.50', OK: 'T', WHEN: '20240229' }, { NAME: 'nothing', POP: '', OK: '?', WHEN: '' }, { NAME: 'Zürich', POP: '7', OK: 'F', WHEN: '19991231' }, { NAME: 'gone', POP: '1', OK: 'T', WHEN: '', deleted: true }], 0x57, cp1252);
  const [L] = IO.readShapefile({ shp, dbf }, 'test');
  assert.equal(L.features.length, 3);
  const [a, b, c] = L.features;
  assert.equal(a.geometry.type, 'Polygon'); assert.equal(a.geometry.coordinates.length, 2);
  assert.ok(G.ringArea(a.geometry.coordinates[0]) > 0, 'outer ring re-oriented CCW'); near(Math.abs(G.ringArea(a.geometry.coordinates[1])), 4, 1e-12);
  assert.deepEqual(a.properties, { NAME: 'Genève', POP: 1234.5, OK: true, WHEN: '2024-02-29' });
  assert.equal(b.geometry, null); assert.deepEqual(b.properties, { NAME: 'nothing', POP: null, OK: null, WHEN: null });
  assert.equal(c.properties.NAME, 'Zürich'); assert.equal(c.properties.OK, false);
  assert.deepEqual(L.fields.map(f => f.type), ['string', 'number', 'boolean', 'date']);
});
test('shapefile: PolyLineZ keeps Z, PointZ and MultiPoint records', () => {
  const shp = shpFile(13, [polyRec(13, [[[0, 0], [1, 1], [2, 0]]], [5, 6, 7]), polyRec(13, [[[0, 0], [1, 0]], [[5, 5], [6, 6]]], [0, 0, 1, 1])]);
  const r = IO.readShp(shp); assert.equal(r.type, 13);
  assert.deepEqual(r.geoms[0], { type: 'LineString', coordinates: [[0, 0, 5], [1, 1, 6], [2, 0, 7]] });
  assert.equal(r.geoms[1].type, 'MultiLineString');
  const pz = new Uint8Array(36), dv = new DataView(pz.buffer); dv.setInt32(0, 11, true); dv.setFloat64(4, 7.5, true); dv.setFloat64(12, -3.25, true); dv.setFloat64(20, 99, true); dv.setFloat64(28, 0, true);
  assert.deepEqual(IO.readShp(shpFile(11, [{ bytes: pz }])).geoms[0], { type: 'Point', coordinates: [7.5, -3.25, 99] });
  const mp = new Uint8Array(40 + 32), mv = new DataView(mp.buffer); mv.setInt32(0, 8, true); mv.setInt32(36, 2, true); [1, 2, 3, 4].forEach((v, i) => mv.setFloat64(40 + i * 8, v, true));
  assert.deepEqual(IO.readShp(shpFile(8, [{ bytes: mp }])).geoms[0], { type: 'MultiPoint', coordinates: [[1, 2], [3, 4]] });
});
test('shapefile: projected .prj is reprojected to lon/lat; zipped set is read', () => {
  const utm = P.make(P.get('EPSG:32633')), p = utm.forward([16.3738, 48.2082]);
  const pt = new Uint8Array(20), dv = new DataView(pt.buffer); dv.setInt32(0, 1, true); dv.setFloat64(4, p[0], true); dv.setFloat64(12, p[1], true);
  const shp = shpFile(1, [{ bytes: pt }]), dbf = dbfFile([{ name: 'CITY', type: 'C', len: 6 }], [{ CITY: 'Vienna' }], 0, ch => ch.charCodeAt(0));
  const prj = new TextEncoder().encode(P.toWkt('EPSG:32633'));
  const zip = fflate.zipSync({ 'data/vienna.shp': shp, 'data/vienna.dbf': dbf, 'data/vienna.prj': prj, '__MACOSX/._vienna.shp': new Uint8Array(4) });
  const r = IO.readFiles([{ name: 'vienna.zip', data: zip }]);
  assert.deepEqual(r.errors, []); assert.equal(r.layers.length, 1);
  const c = r.layers[0].features[0].geometry.coordinates; near(c[0], 16.3738, 1e-9); near(c[1], 48.2082, 1e-9);
  assert.equal(r.layers[0].features[0].properties.CITY, 'Vienna');
});
test('shapefile writer → reader round trip (UTF-8 .cpg, holes, multipolygons, projected .prj)', () => {
  const L = { name: 'rt', fields: [{ name: 'name', type: 'string' }, { name: 'v', type: 'number' }, { name: 'b', type: 'boolean' }], features: [
    { id: 1, geometry: { type: 'Polygon', coordinates: [[[10, 50], [10.1, 50], [10.1, 50.1], [10, 50.1], [10, 50]], [[10.02, 50.02], [10.02, 50.04], [10.04, 50.04], [10.04, 50.02], [10.02, 50.02]]] }, properties: { name: 'Ærø ✓', v: 1.25, b: true } },
    { id: 2, geometry: { type: 'MultiPolygon', coordinates: [[[[11, 50], [11.1, 50], [11.1, 50.1], [11, 50]]], [[[12, 50], [12.1, 50], [12.1, 50.1], [12, 50]]]] }, properties: { name: null, v: -3, b: false } }] };
  const files = IO.writeShapefile(L, { crs: 'EPSG:32632' });
  const r = IO.readFiles(Object.entries(files).map(([name, data]) => ({ name, data })));
  assert.deepEqual(r.errors, []); const F = r.layers[0].features;
  assert.equal(F[0].properties.name, 'Ærø ✓'); assert.equal(F[0].properties.v, 1.25); assert.equal(F[0].properties.b, true); assert.equal(F[1].properties.name, '');
  assert.equal(F[0].geometry.coordinates.length, 2); assert.equal(F[1].geometry.type, 'MultiPolygon');
  near(F[0].geometry.coordinates[0][1][0], 10.1, 1e-9); near(G.geomArea(F[0].geometry), G.geomArea(L.features[0].geometry), 1e-3);
});

// ---------------- other formats ----------------
test('GeoJSON with a legacy crs member is reprojected; invalid geometry is dropped', () => {
  const m = P.make(P.get('EPSG:3857')), p = m.forward([2.35, 48.85]);
  const [L] = IO.readGeoJSON(JSON.stringify({ type: 'FeatureCollection', crs: { type: 'name', properties: { name: 'urn:ogc:def:crs:EPSG::3857' } }, features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { a: 1 } }, { type: 'Feature', geometry: { type: 'Bogus' }, properties: {} }] }), 'x');
  near(L.features[0].geometry.coordinates[0], 2.35, 1e-9); assert.equal(L.features[1].geometry, null);
  const [U] = IO.readGeoJSON('{"type":"Point","coordinates":[500000,4649776]}', 'u'); assert.equal(U.needsCrs, true);
});
test('CSV: delimiter, quotes, decimal comma, coordinate detection, WKT column', () => {
  const [L] = IO.readCSV('name;Latitude;Longitude;pop\n"Big ""A"" town";50,5;4,25;12\nB;51;5;\n', 'c');
  assert.equal(L.features.length, 2); assert.deepEqual(L.features[0].geometry.coordinates, [4.25, 50.5]); assert.equal(L.features[0].properties.name, 'Big "A" town');
  assert.equal(L.features[1].properties.pop, null); assert.deepEqual(L.fields, [{ name: 'name', type: 'string' }, { name: 'pop', type: 'number' }]);
  const [W] = IO.readCSV('id,wkt\n1,"POLYGON ((0 0, 1 0, 1 1, 0 0))"\n2,"LINESTRING (0 0, 3 4)"', 'w'); assert.equal(W.features[0].geometry.type, 'Polygon'); assert.equal(W.features[1].geometry.type, 'LineString');
  assert.throws(() => IO.readCSV('a,b\n1,2', 'n'), /No latitude/);
  const out = IO.writeCSV({ name: 'x', fields: [{ name: 'n', type: 'string' }], features: [{ id: 1, geometry: { type: 'Point', coordinates: [1, 2] }, properties: { n: 'a,b' } }] });
  assert.equal(out, 'longitude,latitude,n\r\n1,2,"a,b"\r\n');
});
test('WKT geometry round trip', () => {
  for (const s of ['POINT (1 2)', 'LINESTRING (0 0, 1 1, 2 0)', 'POLYGON ((0 0, 4 0, 4 4, 0 0), (1 1, 2 1, 2 2, 1 1))', 'MULTIPOINT ((1 2), (3 4))', 'MULTILINESTRING ((0 0, 1 1), (2 2, 3 3))', 'MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5)))'])
    assert.equal(IO.toWKT(IO.parseWKT(s)), s);
  assert.deepEqual(IO.parseWKT('POINT Z (1 2 3)'), { type: 'Point', coordinates: [1, 2] });
  assert.equal(IO.parseWKT('POINT EMPTY'), null);
});

// ---------------- expressions & classification ----------------
test('expressions: operators, functions, null logic, geometry variables, safety', () => {
  const f = { id: 7, properties: { name: 'Oslo', pop: 700000, kind: null, 'two words': 3 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } };
  const ev = s => X.compile(s).eval(f);
  assert.equal(ev('"pop" > 5e5 AND name LIKE \'O%\''), true); assert.equal(ev('upper(name) || \'-\' || round(pop / 1000)'), 'OSLO-700');
  assert.equal(ev('kind IS NULL'), true); assert.equal(ev('kind = 1'), null); assert.equal(ev('kind = 1 OR TRUE'), true);
  assert.equal(ev('CASE WHEN pop > 1e6 THEN \'big\' WHEN pop > 1e5 THEN \'mid\' ELSE \'small\' END'), 'mid');
  assert.equal(ev('[two words] * 2'), 6); assert.equal(ev('name IN (\'Rome\', \'Oslo\')'), true); assert.equal(ev('pop BETWEEN 1 AND 10'), false); assert.equal(ev('2 ^ 3 ^ 2'), 512);
  near(ev('$area'), 12308778000, 2e7); assert.equal(ev('$id'), 7); assert.equal(ev('coalesce(kind, \'none\')'), 'none'); assert.equal(ev('10 / 0'), null);
  assert.equal(X.compile('constructor').ok, true); assert.throws(() => X.compile('constructor').eval(f), /Unknown field/);
  assert.equal(X.compile('alert(1)').ok, false); assert.equal(X.compile('"a" = ').ok, false);
  assert.equal(X.compile('nofield > 1', [{ name: 'pop' }]).ok, false);
});
test('classification: Jenks finds natural groups; quantile, equal, pretty', () => {
  const v = [1, 2, 3, 10, 11, 12, 20, 21, 22];
  assert.deepEqual(C.breaks(v, 3, 'jenks'), [1, 3, 12, 22]); assert.deepEqual(C.breaks(v, 3, 'equal'), [1, 8, 15, 22]);
  assert.deepEqual(C.breaks([0, 10, 20, 30, 40], 4, 'quantile'), [0, 10, 20, 30, 40]); assert.deepEqual(C.breaks([3, 47], 5, 'pretty'), [0, 10, 20, 30, 40, 50]);
  const cls = C.makeClasses([0, 10, 20], 'Blues'); assert.equal(C.classOf(cls, 10), 0); assert.equal(C.classOf(cls, 15), 1); assert.equal(C.classOf(cls, 25), -1); assert.equal(C.classOf(cls, 20), 1);
});
