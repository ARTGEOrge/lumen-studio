// Headless UI test for Lumen Map (run through tools/shot with SHOT_JS=this file).
// Drives the real app: sample map, CRS switching, symbology dialog, selection, field calculator, geoprocessing,
// digitizing + vertex editing with synthetic pointer events, measuring, imports, exports, save/open and undo.
const A = MapApp, G = MapGeo, P = MapProj, IO = MapIO, R = MapRender, D = MapDialogs, out = {}, wait = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { throw new Error(m); };
const check = (cond, m) => { if (!cond) fail(m); };
const stage = document.getElementById('stage');
const ptr = (type, x, y, o = {}) => { const r = stage.getBoundingClientRect(); stage.dispatchEvent(new PointerEvent(type, { clientX: r.left + x, clientY: r.top + y, button: o.button ?? 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, bubbles: true, shiftKey: !!o.shift, ctrlKey: !!o.ctrl })); };
const clickAt = async (x, y, o) => { ptr('pointerdown', x, y, o); ptr('pointerup', x, y, o); await wait(15); };
const scr = ll => A.mapToScreen(A.fromLonLat(ll));
const okDialog = async () => { await wait(30); const b = document.querySelector('.aero-modal .aero-btn.pri'); check(b, 'dialog OK button'); b.click(); await wait(80); };
const waitIdle = async () => { for (let i = 0; i < 200 && document.querySelector('.aero-busy'); i++) await wait(50); await wait(50); };
const layer = n => A.doc.layers.find(l => l.name === n);
const setSel = (el, v) => { el.value = v; el.dispatchEvent(new Event('change')); };

try {
// 1. sample
check(A.doc.layers.length === 5, 'sample layers'); out.sample = A.doc.layers.map(l => `${l.name}:${l.features.length}:${l.geomType}`).join(' ');
check(typeof A.doc.crs === 'string' && A.doc.crs === 'EPSG:32726', 'sample CRS');
// pixel check: a district is painted in its graduated class colour
{
  await A.renderNow(); const dist = layer('Districts'), cv = document.getElementById('map'), ctx = cv.getContext('2d'), dpr = devicePixelRatio || 1;
  let matched = 0, tried = 0;
  for (const f of dist.features) {
    const cls = dist.style.classes[MapClass.classOf(dist.style.classes, f.properties.density)], rgb = MapClass.hex(cls.color), bg = [243, 247, 251], a = dist.style.fillOpacity;
    const exp = rgb.map((v, i) => Math.round(v * a + bg[i] * (1 - a)));
    const b = G.bbox(f.geometry); let hit = false;
    for (let i = 1; i < 12 && !hit; i++) for (let j = 1; j < 12 && !hit; j++) {
      const ll = [b[0] + (b[2] - b[0]) * i / 12, b[1] + (b[3] - b[1]) * j / 12]; if (!G.pointInGeom(ll, f.geometry)) continue;
      const [x, y] = scr(ll); if (x < 5 || y < 5 || x > cv.width / dpr - 5 || y > cv.height / dpr - 5) continue; tried++;
      const px = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
      if (Math.abs(px[0] - exp[0]) <= 3 && Math.abs(px[1] - exp[1]) <= 3 && Math.abs(px[2] - exp[2]) <= 3) hit = true;
    }
    if (hit) matched++;
  }
  out.districtPixels = `${matched}/${dist.features.length} districts painted in their class colour`; check(matched === dist.features.length, 'district colours');
}

// 2. CRS switching keeps the view centre
const c0 = A.toLonLat([A.view.cx, A.view.cy]), s0 = A.getScale();
for (const code of ['EPSG:3857', 'EPSG:8857', 'ESRI:54009', 'EPSG:4326', 'EPSG:32726']) {
  A.setCRS(code); A.renderNow(); const c = A.toLonLat([A.view.cx, A.view.cy]);
  check(Math.abs(c[0] - c0[0]) < 1e-6 && Math.abs(c[1] - c0[1]) < 1e-6, 'centre kept for ' + code);
  check(Math.abs(A.getScale() / s0 - 1) < 0.02, 'scale kept for ' + code + ' ' + A.getScale() + ' vs ' + s0);
}
out.crsSwitch = 'centre and scale kept across 5 CRSs';

// 3. selection by expression + table sync
const towns = layer('Towns'); A.active = towns.id; A.refreshPanels(); MapTable.refresh();
D.selectByAttributes(); await wait(40);
{ const ta = document.querySelector('.aero-modal textarea.expr'); ta.value = '"population" > 5000 AND "port"'; ta.dispatchEvent(new Event('input')); await wait(30); out.selMsg = document.querySelector('.aero-modal .eb-msg').textContent; await okDialog(); }
out.selected = [...A.selected(towns.id)].map(id => towns.features.find(f => f.id === id).properties.name).sort().join(',');
check(out.selected === 'Brightwater,Dunmere,Port Aurel,Westhaven', 'selection by attributes: ' + out.selected);
out.tableSelRows = document.querySelectorAll('#twrap .trow.sel').length; check(out.tableSelRows === 4, 'table shows selection');
// click selection with the select tool (Shift adds)
A.setTool('select'); A.clearSelection();
{ const k = towns.features.find(f => f.properties.name === 'Kelmore'), [x, y] = scr(k.geometry.coordinates); await clickAt(x, y); }
out.clickSel = [...A.selected(towns.id)].length; check(out.clickSel === 1, 'click select');
// box select all towns of the east half
{ const b = R.layerBBox(towns, A.crs()), a = A.mapToScreen([b[0], b[3]]), z = A.mapToScreen([b[2], b[1]]); ptr('pointerdown', a[0] - 5, a[1] - 5); ptr('pointermove', z[0] + 5, z[1] + 5); ptr('pointerup', z[0] + 5, z[1] + 5); await wait(20); }
out.boxSel = A.selected(towns.id).size; check(out.boxSel === towns.features.length, 'box select ' + out.boxSel);

// 3b. attribute table: sort by population (descending) and edit a cell inline
A.active = towns.id; A.clearSelection(); MapTable.refresh(); await wait(20);
{ const hd = [...document.querySelectorAll('#twrap .head [data-k]')].find(d => d.dataset.k === 'population'); hd.click(); await wait(20); hd.click && [...document.querySelectorAll('#twrap .head [data-k]')].find(d => d.dataset.k === 'population').click(); await wait(20);
  const first = document.querySelector('#twrap .trow[data-id] [data-k="name"]').textContent; out.sortDesc = first; check(first === 'Port Aurel', 'sort desc');
  const row = document.querySelector('#twrap .trow[data-id]'), cell = row.querySelector('[data-k="population"]'); cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await wait(20);
  const inp = row.querySelector('input.cell'); check(inp, 'cell editor'); inp.value = '40000'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait(30);
  const f = layer('Towns').features.find(x => x.properties.name === 'Port Aurel'); out.cellEdit = f.properties.population; check(f.properties.population === 40000, 'cell edit'); A.undo(); check(layer('Towns').features.find(x => x.properties.name === 'Port Aurel').properties.population === 38400, 'undo cell edit'); MapTable.sort = null; MapTable.refresh(); }

// 4. select by location: towns within the Aurel district
A.clearSelection(); D.selectByLocation(); await wait(40);
{ const m = document.querySelector('.aero-modal'), sels = m.querySelectorAll('select'); sels[0].value = towns.id; sels[1].value = 'within'; sels[2].value = layer('Districts').id; sels.forEach(s => s.dispatchEvent(new Event('change'))); await okDialog(); await waitIdle(); }
const aurel = layer('Districts').features.find(f => f.properties.name === 'Aurel');
const expectWithin = towns.features.filter(t => G.pointInGeom(t.geometry.coordinates, aurel.geometry)).length;
out.withinAny = A.selected(towns.id).size; check(out.withinAny === towns.features.filter(t => layer('Districts').features.some(d => G.pointInGeom(t.geometry.coordinates, d.geometry))).length, 'select by location within');
out.inAurel = expectWithin;

// 5. symbology dialog: switch Districts to categorized, check, then undo
const dId = layer('Districts').id; MapDialogs.layerProperties(dId); await wait(50);
{ const sel = document.querySelector('#pMode'); sel.value = 'categorized'; sel.dispatchEvent(new Event('change')); await wait(30); const f = document.querySelector('#pField'); f.value = 'name'; f.dispatchEvent(new Event('change')); await wait(30); await okDialog(); }
out.categorized = `${A.layer(dId).style.mode} ${A.layer(dId).style.categories.length} categories`; check(A.layer(dId).style.mode === 'categorized' && A.layer(dId).style.categories.length === 6, 'categorized');
out.legendRows = [...document.querySelectorAll('#layers .legend-row')].length;
A.undo(); check(A.layer(dId).style.mode === 'graduated', 'undo symbology'); A.redo(); A.undo();

// 6. field calculator: area in km² via the dialog
A.active = dId; A.refreshPanels(); D.fieldCalculator(); await wait(40);
{ const m = document.querySelector('.aero-modal'); m.querySelector('#fcName').value = 'area_calc'; const ta = m.querySelector('textarea.expr'); ta.value = 'round($area / 1e6, 1)'; ta.dispatchEvent(new Event('input')); await wait(20); await okDialog(); }
{ const L = A.layer(dId); check(L.fields.some(f => f.name === 'area_calc'), 'field added'); const diffs = L.features.map(f => Math.abs(f.properties.area_calc - f.properties.area_km2)); out.fieldCalc = 'max |area_calc − area_km2| = ' + Math.max(...diffs).toFixed(2) + ' km²'; check(Math.max(...diffs) <= 0.11, 'field calc values'); }

// 7. geoprocessing through the dialogs
const runTool = async (fn, setup) => { const n = A.doc.layers.length; fn(); await wait(40); const m = document.querySelector('.aero-modal'); if (setup) setup(m); await okDialog(); await waitIdle(); check(A.doc.layers.length === n + 1, 'tool produced a layer'); return A.doc.layers[0]; };
A.active = towns.id; A.clearSelection();
const buf = await runTool(D.buffer, m => { const i = m.querySelectorAll('input[type=number]'); i[0].value = 2000; i[0].dispatchEvent(new Event('input')); });
{ const ar = buf.features.map(f => G.geomArea(f.geometry)), n = 32, exp = 4e6 * n / 2 * Math.sin(2 * Math.PI / n); out.buffer = `${buf.features.length} buffers, mean area ${(ar.reduce((a, b) => a + b) / ar.length / 1e6).toFixed(4)} km² (expected ${(exp / 1e6).toFixed(4)})`; check(buf.features.length === 12 && ar.every(a => Math.abs(a / exp - 1) < 0.003), 'buffer areas'); }
A.active = layer('Roads').id;
const clipped = await runTool(() => D.clip(false), m => setSel(m.querySelectorAll('select')[1], dId));
{ const tot = L => L.features.reduce((s, f) => s + G.geomLength(f.geometry), 0); out.clip = `roads ${(tot(layer('Roads')) / 1000).toFixed(2)} km → clipped ${(tot(clipped) / 1000).toFixed(2)} km`; check(tot(clipped) <= tot(layer('Roads')) + 1 && tot(clipped) > 0.9 * tot(layer('Roads')), 'clip lengths'); }
A.active = towns.id;
const inter = await runTool(D.intersect, m => setSel(m.querySelectorAll('select')[1], dId));
out.intersect = `${inter.features.length} towns with district fields: ${inter.fields.map(f => f.name).join(',')}`; check(inter.fields.some(f => f.name === 'name_2') && inter.features.every(f => f.properties.name_2), 'intersect attrs');
A.active = dId;
const dis = await runTool(D.dissolve);
{ const a1 = G.geomArea(dis.features[0].geometry), a0 = layer('Districts').features.reduce((s, f) => s + G.geomArea(f.geometry), 0); out.dissolve = `${dis.features.length} feature, area ${(a1 / 1e6).toFixed(2)} vs sum ${(a0 / 1e6).toFixed(2)} km², population sum ${dis.features[0].properties.sum_population}`; check(dis.features.length === 1 && Math.abs(a1 / a0 - 1) < 1e-6, 'dissolve area'); }
A.active = dId;
const cen = await runTool(D.centroids, m => setSel(m.querySelectorAll('select')[1], 'surface'));
out.centroids = `${cen.features.filter((f, i) => G.pointInGeom(f.geometry.coordinates, layer('Districts').features[i].geometry)).length}/${cen.features.length} points on surface inside their district`;
check(cen.features.every((f, i) => G.pointInGeom(f.geometry.coordinates, layer('Districts').features[i].geometry)), 'points on surface');
A.active = layer('Lakes').id;
const diff = await runTool(() => D.clip(true), m => { const s = m.querySelectorAll('select'); setSel(s[0], dId); setSel(s[1], layer('Lakes').id); });
{ const a0 = layer('Districts').features.reduce((s, f) => s + G.geomArea(f.geometry), 0), a1 = diff.features.reduce((s, f) => s + G.geomArea(f.geometry), 0), lakes = layer('Lakes').features.reduce((s, f) => s + G.geomArea(f.geometry), 0); out.difference = `districts − lakes = ${((a0 - a1) / 1e6).toFixed(3)} km² removed, lakes ${(lakes / 1e6).toFixed(3)} km²`; check(Math.abs((a0 - a1) / lakes - 1) < 1e-4, 'difference area'); }
// remove the tool outputs
[diff, cen, dis, inter, clipped, buf].forEach(L => A.removeLayer(L.id));

// 8. digitizing into a new polygon layer (synthetic clicks), then attributes
D.newLayer(); await wait(30); await okDialog();
const nl = A.activeLayer(); check(nl.geomType === 'Polygon' && A.tool === 'addpoly', 'new layer + tool');
const { w, h } = A.size(), corners = [[w * 0.40, h * 0.40], [w * 0.55, h * 0.40], [w * 0.55, h * 0.58], [w * 0.40, h * 0.58]];
for (const [i, [x, y]] of corners.entries()) { if (i) await wait(360); await clickAt(x, y); }
await clickAt(corners[3][0], corners[3][1]); // second click of a double-click finishes
await wait(40); { const m = document.querySelector('.aero-modal'); check(m, 'attribute form'); m.querySelector('input[type=text]').value = 'Survey area'; m.querySelector('input[type=text]').dispatchEvent(new Event('input')); m.querySelector('input[type=number]').value = 42; m.querySelector('input[type=number]').dispatchEvent(new Event('input')); await okDialog(); }
{ const L = A.layer(nl.id), f = L.features[0]; check(L.features.length === 1 && f.geometry.type === 'Polygon' && f.geometry.coordinates[0].length === 5, 'digitized polygon'); check(f.properties.name === 'Survey area' && f.properties.value === 42, 'attributes');
  const ring = corners.map(([x, y]) => A.screenToMap(x, y)), planar = Math.abs(G.ringArea([...ring, ring[0]])), geo = G.geomArea(f.geometry), k = 0.9996 * (1 + 0); out.digitize = `polygon ${(geo / 1e6).toFixed(3)} km² geodesic vs ${(planar / 1e6).toFixed(3)} km² planar UTM`; check(Math.abs(geo / planar - 1) < 0.002, 'digitized area'); void k; }
// vertex editing: drag the first vertex 30 px right, then undo
A.setTool('edit'); { const f = A.layer(nl.id).features[0]; A.editTarget = { layer: nl.id, fid: f.id }; A.drawOverlay(); const v = scr(f.geometry.coordinates[0][0]); ptr('pointerdown', v[0], v[1]); ptr('pointermove', v[0] + 15, v[1]); ptr('pointermove', v[0] + 30, v[1]); ptr('pointerup', v[0] + 30, v[1]); await wait(30);
  const g = A.layer(nl.id).features[0].geometry, nv = scr(g.coordinates[0][0]); out.vertexDrag = `moved ${(nv[0] - v[0]).toFixed(1)} px, ring still closed: ${JSON.stringify(g.coordinates[0][0]) === JSON.stringify(g.coordinates[0][4])}`; check(Math.abs(nv[0] - v[0] - 30) < 0.5 && JSON.stringify(g.coordinates[0][0]) === JSON.stringify(g.coordinates[0][4]), 'vertex drag');
  out.histTail = A.hist.list().slice(-4).map(x => x.label + (x.current ? '*' : '')).join(' > ');
  A.undo(); out.histAfter = A.hist.list().slice(-4).map(x => x.label + (x.current ? '*' : '')).join(' > ') + ' feats=' + A.layer(nl.id).features.length; const g2 = A.layer(nl.id).features[0].geometry; check(Math.abs(scr(g2.coordinates[0][0])[0] - v[0]) < 0.5, 'undo vertex'); }
// insert a vertex by double-clicking an edge midpoint, delete it with right-click
{ const f = A.layer(nl.id).features[0], a = scr(f.geometry.coordinates[0][0]), b = scr(f.geometry.coordinates[0][1]), cc = scr(G.centroid(f.geometry)), m0 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], dl = Math.hypot(cc[0] - m0[0], cc[1] - m0[1]), mx = m0[0] + (cc[0] - m0[0]) / dl * 2, my = m0[1] + (cc[1] - m0[1]) / dl * 2;
  A.editTarget = { layer: nl.id, fid: f.id }; ptr('pointerdown', mx, my); ptr('pointerup', mx, my); await wait(40); ptr('pointerdown', mx, my); ptr('pointerup', mx, my); await wait(30);
  out.insertVertex = A.layer(nl.id).features[0].geometry.coordinates[0].length; check(out.insertVertex === 6, 'insert vertex');
  ptr('pointerdown', mx, my, { button: 2 }); await wait(20); check(A.layer(nl.id).features[0].geometry.coordinates[0].length === 5, 'delete vertex'); }

// move a whole feature by dragging inside it, then undo
await wait(350); { const f = A.layer(nl.id).features[0], c = scr(G.centroid(f.geometry)); A.setTool('edit'); A.editTarget = { layer: nl.id, fid: f.id }; ptr('pointerdown', c[0], c[1]); ptr('pointermove', c[0] + 20, c[1] + 10); ptr('pointermove', c[0] + 40, c[1] + 20); ptr('pointerup', c[0] + 40, c[1] + 20); await wait(30);
  const c2 = scr(G.centroid(A.layer(nl.id).features[0].geometry)); out.moveFeature = `moved ${(c2[0] - c[0]).toFixed(1)}, ${(c2[1] - c[1]).toFixed(1)} px`; check(Math.abs(c2[0] - c[0] - 40) < 0.6 && Math.abs(c2[1] - c[1] - 20) < 0.6, 'move feature'); A.undo(); }

// 9. measuring distance between two towns (geodesic)
A.setTool('measure');
{ const t1 = towns.features[0].geometry.coordinates, t2 = towns.features[1].geometry.coordinates, p1 = scr(t1), p2 = scr(t2);
  await clickAt(p1[0], p1[1]); await wait(360); await clickAt(p2[0], p2[1]); await clickAt(p2[0], p2[1]);
  const shown = document.querySelector('#info .big').textContent, exp = G.distance(A.toLonLat(A.screenToMap(p1[0], p1[1])), A.toLonLat(A.screenToMap(p2[0], p2[1])));
  out.measure = `${shown} (Vincenty ${(exp / 1000).toFixed(3)} km)`; check(shown === G.fmtDist(exp), 'measure readout'); }
A.setTool('area'); { const pts = [[200, 200], [400, 200], [400, 350]]; for (const [i, [x, y]] of pts.entries()) { if (i) await wait(360); await clickAt(x, y); } await clickAt(400, 350); out.area = document.querySelector('#info .big').textContent; }
A.setTool('identify'); { const p = scr(towns.features[0].geometry.coordinates); await clickAt(p[0], p[1]); out.identify = document.querySelector('#info h4').textContent; check(/Towns/.test(out.identify), 'identify'); }
A.setTool('pan');

// 10. imports: zipped shapefile (projected), KML, GPX, CSV
const before = A.doc.layers.length;
{
  const shpFiles = IO.writeShapefile({ name: 'roads_utm', fields: layer('Roads').fields, features: layer('Roads').features }, { crs: 'EPSG:32726' });
  const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Folder><name>Sites</name><Placemark><name>Lookout</name><ExtendedData><Data name="height"><value>312</value></Data></ExtendedData><Point><coordinates>-26.15,-38.55,0</coordinates></Point></Placemark><Placemark><name>Park</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-26.3,-38.6 -26.25,-38.6 -26.25,-38.56 -26.3,-38.6</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Folder></Document></kml>`;
  const gpx = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><wpt lat="-38.6" lon="-26.2"><name>Camp</name><ele>12</ele></wpt><trk><name>Hike</name><trkseg><trkpt lat="-38.6" lon="-26.2"/><trkpt lat="-38.58" lon="-26.18"/><trkpt lat="-38.57" lon="-26.15"/></trkseg></trk></gpx>`;
  const csv = 'site;lat;lon;depth\nA;-38,62;-26,05;4,5\nB;-38,64;-26,01;7\n';
  const enc = s => new TextEncoder().encode(s).buffer;
  await MapMain.handleFiles([{ name: 'roads_utm.zip', data: IO.zip(shpFiles).buffer }, { name: 'sites.kml', data: enc(kml) }, { name: 'trip.gpx', data: enc(gpx) }, { name: 'soundings.csv', data: enc(csv) }]);
  await waitIdle(); const modal = document.querySelector('.aero-modal'); if (modal) { out.importNote = modal.textContent.slice(0, 200); await okDialog(); }
  out.imported = A.doc.layers.slice(0, A.doc.layers.length - before).map(l => `${l.name}:${l.features.length}`).join(' ');
  check(A.doc.layers.length - before === 6, 'imported layers: ' + out.imported);
  const ru = layer('roads_utm'), r0 = layer('Roads'); const d = Math.abs(ru.features[0].geometry.coordinates[3][0] - r0.features[0].geometry.coordinates[3][0]); out.shpRoundTrip = 'shapefile (UTM .prj) vertex error ' + (d * 111e6 * Math.cos(38.6 * Math.PI / 180)).toFixed(3) + ' mm'; check(d < 1e-8, 'shp reprojection');
  check(layer('soundings').features[1].properties.depth === 7 && Math.abs(layer('soundings').features[0].geometry.coordinates[0] + 26.05) < 1e-12, 'csv');
  check(layer('sites (points)').features[0].properties.height === 312 && layer('sites (points)').features[0].properties.folder === 'Sites', 'kml data');
  check(layer('trip tracks').features[0].geometry.coordinates.length === 3, 'gpx track');
}

// 11. exports: layer formats, map SVG, layout PDF/PNG/SVG
{
  const L = layer('Districts');
  const gj = JSON.parse(IO.writeGeoJSON(L)); check(gj.features.length === 6 && gj.features[0].properties.name === 'Aurel', 'geojson export');
  const csv = IO.writeCSV(L); check(csv.split('\r\n')[0].startsWith('wkt,name,population'), 'csv export header');
  const kml = IO.writeKML(L); check((kml.match(/<Placemark>/g) || []).length === 6, 'kml export');
  const svg = A.exportMapSVG(); out.mapSvg = `${(svg.length / 1024).toFixed(0)} KB, ${(svg.match(/<path/g) || []).length} paths, ${(svg.match(/<text/g) || []).length} texts`; check(/<svg/.test(svg) && (svg.match(/<path/g) || []).length > 50, 'map svg');
  const s = MapLayout.settings();
  const lsvg = MapLayout.toSVG(s); check(/Legend/.test(lsvg) && /Isle of Lumen/.test(lsvg), 'layout svg');
  const pdf = new Uint8Array(await MapLayout.toPDF(s)); out.pdf = `${(pdf.length / 1024).toFixed(0)} KB, header ${String.fromCharCode(...pdf.slice(0, 5))}`; check(String.fromCharCode(...pdf.slice(0, 5)) === '%PDF-', 'pdf');
  const png = await MapLayout.toPNG({ ...s, dpi: 96 }); const bmp = await createImageBitmap(png); out.png = `${bmp.width}×${bmp.height}`; check(bmp.width === 1123 && bmp.height === 794, 'png size A4 landscape @96dpi');
  MapLayout.open(); await wait(150); out.layoutInfo = document.getElementById('plInfo').textContent; document.getElementById('plClose').click();
}

// 12. save → open round trip
{
  const json = JSON.stringify(A.serialize()), n = A.doc.layers.length;
  const { doc, view } = A.deserialize(JSON.parse(json));
  const key = L => JSON.stringify([L.name, L.geomType, L.visible, L.opacity, L.filter, L.labels.expr, L.labels.on, L.style.mode, L.style.field, L.style.fill, L.style.stroke, L.style.width, (L.style.categories || []).map(c => [c.value, c.color]), (L.style.classes || []).map(c => [c.min, c.max, c.color]), L.fields, L.features.map(f => [f.id, f.properties, f.geometry])]);
  const bad1 = doc.layers.findIndex((L, i) => key(L) !== key(A.doc.layers[i])); check(doc.layers.length === n && bad1 < 0, 'project round trip, layer ' + bad1);
  out.project = `${(json.length / 1024).toFixed(0)} KB .lmap, ${n} layers restored`;
  // malformed/untrusted project content is rejected or sanitised
  let threw = false; try { A.deserialize({ format: 'nope' }); } catch (e) { threw = true; } check(threw, 'reject non-lmap');
  const bad = A.deserialize({ format: 'lumen-map', crs: 'EPSG:999999', layers: [{ name: '<img src=x onerror=alert(1)>', style: { fill: 'url(javascript:1)', mode: 'evil' }, features: [{ geometry: { type: 'Point', coordinates: ['a', 2] } }, null, { geometry: { type: 'Point', coordinates: [1, 2] }, properties: { a: { b: 1 } } }] }] });
  check(bad.doc.crs === 'EPSG:3857' && bad.doc.layers[0].style.mode === 'single' && !/url/.test(bad.doc.layers[0].style.fill) && bad.doc.layers[0].features.length === 2 && bad.doc.layers[0].features[0].geometry === null, 'sanitise');
}
// 13. undo stack walks back to the sample
{ let n = 0; while (A.hist.index > 0 && n < 200) { A.undo(); n++; } out.undoSteps = n; check(A.doc.layers.length === 5, 'undo to sample: ' + A.doc.layers.length); for (let i = 0; i < n; i++) A.redo(); check(A.doc.layers.length === before + 6, 'redo all'); }
// restore a clean sample view for the screenshot
Aero.setDirty(false); await A.openSample(); A.active = layer('Towns').id; A.setSelection(A.active, layer('Towns').features.filter(f => f.properties.type === 'Town').map(f => f.id)); A.active = layer('Districts').id; A.refreshPanels(); MapTable.refresh();
A.setTool('identify'); { const t = layer('Towns').features.find(f => f.properties.name === 'Port Aurel'), p = scr(t.geometry.coordinates); await clickAt(p[0], p[1]); }
A.renderNow(); await wait(100);
return JSON.stringify(out, null, 1);
} catch (e) { return JSON.stringify({ FAILED: e.message, at: String(e.stack).split(String.fromCharCode(10)).slice(1, 3).join(' | '), out }, null, 1); }
