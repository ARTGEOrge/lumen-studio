// Lumen Map — menus, file handling (open / save / import / export) and start-up.
(function () {
  'use strict';
  const A = MapApp, D = MapDialogs, IO = MapIO, P = MapProj, R = MapRender, G = MapGeo, X = MapExpr;
  const esc = s => Aero.esc(String(s ?? ''));
  const DATA_EXT = ['geojson', 'json', 'shp', 'dbf', 'prj', 'cpg', 'shx', 'zip', 'kml', 'kmz', 'gpx', 'csv', 'tsv', 'txt'];
  const base = () => (A.docName || 'map').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_') || 'map';

  // ---------- open / import ----------
  async function handleFiles(files) {
    const proj = files.find(f => /\.lmap$/i.test(f.name));
    if (proj) return openProject(proj);
    const data = files.filter(f => DATA_EXT.includes(IO.ext(f.name)));
    if (!data.length) { Aero.toast('Unsupported file type — use GeoJSON, Shapefile, KML/KMZ, GPX, CSV or a .lmap project'); return; }
    Aero.busy('Reading ' + (data.length === 1 ? data[0].name : data.length + ' files') + '…');
    await new Promise(r => setTimeout(r, 20));
    let res;
    try { res = IO.readFiles(data); } catch (e) { Aero.busy(); Aero.alert('Could not read the data', e.message); return; } finally { Aero.busy(); }
    // CSVs without recognisable coordinate columns: ask
    const errs = [];
    for (const e of res.errors) errs.push(e);
    const csvRetry = data.filter(f => /\.(csv|tsv|txt)$/i.test(f.name) && res.errors.some(e => e.startsWith(f.name + ':') && /No latitude/.test(e)));
    for (const f of csvRetry) {
      const rows = IO.parseCSV(f.data), header = rows[0] || [];
      const pick = await new Promise(r => D.csvColumns(f.name, header, r)); errs.splice(errs.findIndex(e => e.startsWith(f.name + ':')), 1);
      if (pick) { try { res.layers.push(...IO.readCSV(f.data, IO.base(f.name), { lon: pick.lon, lat: pick.lat, crs: pick.crs })); } catch (e) { errs.push(f.name + ': ' + e.message); } }
    }
    // data in unknown projected coordinates
    for (const L of res.layers) {
      if (!L.needsCrs) continue;
      const def = await new Promise(r => D.askCrs(L.name, r));
      if (def) { L.features = IO.reprojectFeatures(L.features, def); L.sourceCrs = def.code || def.name; }
      else L.skip = true;
    }
    const add = res.layers.filter(l => !l.skip);
    const warnings = add.filter(l => l.warning).map(l => `${l.name}: ${l.warning}`);
    if (add.length) { A.addLayers(add); Aero.toast(`Added ${add.length} layer${add.length > 1 ? 's' : ''} (${add.reduce((s, l) => s + l.features.length, 0).toLocaleString('en-US')} features)`); }
    if (errs.length || warnings.length) Aero.alert(errs.length ? 'Some files could not be read' : 'Note', [...errs, ...warnings].join('\n\n'));
  }
  A.openData = async () => { const files = await Aero.openFile({ accept: DATA_EXT.map(e => '.' + e).join(',') + ',.lmap', multiple: true, filters: [{ name: 'Vector data', extensions: DATA_EXT }] }); if (files.length) handleFiles(files); };
  async function openProject(f) {
    if (!(await confirmDiscard())) return;
    try {
      const j = JSON.parse(new TextDecoder().decode(new Uint8Array(f.data)));
      const { doc, view } = A.deserialize(j);
      A.load(doc, f.name.replace(/\.lmap$/i, ''), f.path, view);
      Aero.toast(`Opened ${f.name} — ${doc.layers.length} layers`);
    } catch (e) { Aero.alert('Could not open the project', e.message); }
  }
  async function openDialog() { const files = await Aero.openFile({ accept: '.lmap', filters: [{ name: 'Lumen Map project', extensions: ['lmap'] }] }); if (files[0]) openProject(files[0]); }
  async function confirmDiscard() { return !window.__lumenDirty || await Aero.confirm('Discard changes?', 'The current map has unsaved changes. Continue without saving?', 'Discard'); }
  async function save(as) {
    const data = JSON.stringify(A.serialize());
    const p = await Aero.saveFile({ name: base() + '.lmap', data, filters: [{ name: 'Lumen Map project', extensions: ['lmap'] }], path: as ? null : A.filePath });
    if (!p) return false;
    if (typeof p === 'string' && /[\\/]/.test(p)) A.filePath = p;
    A.docName = String(p).replace(/^.*[\\/]/, '').replace(/\.lmap$/i, ''); Aero.setDoc(A.docName, false); Aero.toast('Saved ' + A.docName + '.lmap'); return true;
  }
  A.save = save;
  A.openSample = async () => {
    if (!(await confirmDiscard())) return;
    Aero.busy('Building the sample map…'); await new Promise(r => setTimeout(r, 20));
    try {
      const s = MapSample.build(); A.doc = A.newDoc(s.crs); const doc = A.doc; doc.title = s.title;
      s.layers.forEach((l, i) => doc.layers.push(A.normLayer(l, i)));
      A.load(doc, s.title); A.zoomFull(); A.active = doc.layers.find(l => l.name === 'Districts').id; A.renderAll();
    } finally { Aero.busy(); }
  };
  async function newMap() { if (!(await confirmDiscard())) return; A.load(A.newDoc('EPSG:3857'), 'Untitled'); }

  // ---------- export ----------
  function exportLayer(kind) {
    const L = A.activeLayer(); if (!L) { Aero.toast('Select a layer to export'); return; }
    const fields = [{ key: 'w', label: 'Features', type: 'select', value: 'all', options: [['all', `All (${L.features.length})`], ['sel', `Selected only (${A.selected(L.id).size})`], ['filter', 'Matching the layer filter']] }];
    if (kind === 'shp' || kind === 'csv') fields.push({ key: 'c', label: 'Coordinates in', type: 'select', value: kind === 'csv' ? 'EPSG:4326' : (typeof L.sourceCrs === 'string' && P.get(L.sourceCrs) ? L.sourceCrs : 'EPSG:4326'), options: P.list().map(([k, n]) => [k, `${k} — ${n}`]) });
    Aero.dialog({ title: `Export “${L.name}” as ${{ geojson: 'GeoJSON', csv: 'CSV', kml: 'KML', shp: 'Shapefile' }[kind]}`, fields, ok: 'Export…',
      onOK: async v => {
        const s = A.selected(L.id), ex = L.filter ? X.compile(L.filter) : null;
        const feats = L.features.filter(f => v.w === 'sel' ? s.has(f.id) : v.w === 'filter' ? (!ex || ex.test(f)) : true);
        const out = { ...L, features: feats }, nm = L.name.replace(/[^\w\-]+/g, '_') || 'layer';
        try {
          if (kind === 'geojson') await Aero.saveFile({ name: nm + '.geojson', data: IO.writeGeoJSON(out), filters: [{ name: 'GeoJSON', extensions: ['geojson', 'json'] }] });
          if (kind === 'csv') await Aero.saveFile({ name: nm + '.csv', data: '﻿' + IO.writeCSV(out, { crs: v.c }), filters: [{ name: 'CSV', extensions: ['csv'] }] });
          if (kind === 'kml') await Aero.saveFile({ name: nm + '.kml', data: IO.writeKML(out), filters: [{ name: 'KML', extensions: ['kml'] }] });
          if (kind === 'shp') { const files = IO.writeShapefile(out, { crs: v.c, name: nm }); await Aero.saveFile({ name: nm + '.zip', data: IO.zip(files), filters: [{ name: 'Zipped shapefile', extensions: ['zip'] }] }); }
        } catch (e) { Aero.alert('Export failed', e.message); }
      } });
  }
  async function exportMap(kind) {
    const { w, h } = A.size();
    if (kind === 'svg') { const ctx = new R.SvgCtx(w, h); R.drawMap(ctx, { doc: A.doc, crs: A.crs(), view: { ...A.view, w, h }, graticule: { on: A.settings.graticule, labels: A.settings.gratLabels } }); await Aero.saveFile({ name: base() + '.svg', data: ctx.toString(), filters: [{ name: 'SVG', extensions: ['svg'] }] }); return; }
    const k = 2, c = document.createElement('canvas'); c.width = w * k; c.height = h * k; const ctx = c.getContext('2d'); ctx.scale(k, k);
    R.drawMap(ctx, { doc: A.doc, crs: A.crs(), view: { ...A.view, w, h }, graticule: { on: A.settings.graticule, labels: A.settings.gratLabels } });
    await Aero.saveFile({ name: base() + '.png', data: await new Promise(r => c.toBlob(r, 'image/png')), filters: [{ name: 'PNG image', extensions: ['png'] }] });
  }
  A.exportMapSVG = () => { const { w, h } = A.size(); const ctx = new R.SvgCtx(w, h); R.drawMap(ctx, { doc: A.doc, crs: A.crs(), view: { ...A.view, w, h }, graticule: { on: A.settings.graticule, labels: A.settings.gratLabels } }); return ctx.toString(); };

  // ---------- help ----------
  const shortcuts = () => Aero.alert('Keyboard shortcuts', [
    'Tools: H pan · Z zoom box · S select · I identify · M measure distance · A measure area', 'P add point · L add line · G add polygon · E edit vertices',
    'Mouse wheel — zoom at the cursor · middle-drag or Space+drag — pan · arrow keys — pan',
    'Digitizing / measuring: click to add vertices, double-click or Enter to finish, Backspace removes the last vertex, Esc cancels',
    'Vertex editing: drag a vertex, double-click an edge to insert one, right-click a vertex to delete it, drag inside the feature to move it',
    'Select tool: click or drag a box · Shift adds · Ctrl toggles',
    'Ctrl+Z / Ctrl+Y — undo / redo · Ctrl+S — save · Ctrl+O — open project · Ctrl+Shift+A — add data',
    'Ctrl+A — select all · Ctrl+I — invert selection · Ctrl+Shift+N — clear selection · Delete — delete selected features',
    'Ctrl+F3 — select by attributes · Ctrl+J — zoom to selection · Ctrl+Shift+F — full extent · F6 — attribute table · Ctrl+P — print layout',
  ].join('\n'));
  const exprHelp = () => Aero.alert('Expressions', 'Used for filters, labels, selection and the field calculator. Expressions are interpreted by Lumen Map (never run as code), so expressions inside opened projects are safe.\n\n"field" or [field] — a field value · \'text\' — a string · 12.5 — a number\n+ - * / % ^  — arithmetic · || — join text\n= != <> < <= > >= · AND OR NOT · LIKE / ILIKE with % and _ · IN (a, b) · IS NULL · BETWEEN a AND b\nCASE WHEN cond THEN x ELSE y END\n$area $perimeter $length — geodesic m² / m · $x $y — centroid lon/lat · $id · $geomtype\n\nFunctions: ' + X.FUNCTIONS.join(', ') + '\n\nExamples:\n"pop" > 10000 AND "type" = \'Town\'\nround($area / 1e6, 2)\nupper("name") || \' (\' || format_number("pop") || \')\'');
  const about = () => Aero.dialog({ title: 'About Lumen Map', noCancel: true, html: `<div style="display:flex;gap:16px;align-items:center;margin:6px 0 4px"><img src="../kit/icons/map.png" width="64" height="64" alt="" onerror="this.style.display='none'"><div><div style="font-size:18px;color:#003399">Lumen Map</div><div class="dnote">Free desktop GIS for Lumen Studio — GeoJSON, Shapefile, KML, GPX and CSV layers; on-the-fly reprojection (UTM, Web Mercator, equal-area and conic projections, .prj WKT); categorized and graduated symbology with natural breaks; labels; attribute table with expressions and field calculator; select by attributes and location; geodesic measuring; digitizing and vertex editing; buffer, clip, intersect, difference, dissolve and centroids; print layouts to PDF, PNG and SVG.<br>Works fully offline — there is no online basemap.<br>Built with paper.js (polygon booleans), fflate (zip), jsPDF and svg2pdf.js (PDF) — all MIT.</div></div></div>` });

  // ---------- menus ----------
  const tog = (label, get, set) => ({ label, checked: get, fn: () => { set(!get()); A.render(); } });
  Aero.init({ name: 'Lumen Map', icon: '../kit/icons/map.png', doc: 'Untitled',
    onDropFiles: handleFiles, dropText: 'Drop GeoJSON, Shapefile (.zip or .shp+.dbf+.prj), KML/KMZ, GPX, CSV or a .lmap project', onSave: () => save(false),
    menus: {
      File: [['New map', 'Ctrl+N', newMap], ['Open project…', 'Ctrl+O', openDialog], ['Open sample map', '', () => A.openSample()], '-',
        ['Save', 'Ctrl+S', () => save(false)], ['Save as…', 'Ctrl+Shift+S', () => save(true)], '-',
        ['Add data…', 'Ctrl+Shift+A', () => A.openData()], '-', '#Export active layer',
        ['GeoJSON…', '', () => exportLayer('geojson')], ['Shapefile (.zip)…', '', () => exportLayer('shp')], ['CSV…', '', () => exportLayer('csv')], ['KML…', '', () => exportLayer('kml')], '-', '#Export map view',
        ['Map as SVG…', '', () => exportMap('svg')], ['Map as PNG…', '', () => exportMap('png')], '-', ['Print layout…', 'Ctrl+P', () => MapLayout.open()]],
      Edit: [['Undo', 'Ctrl+Z', A.undo], ['Redo', 'Ctrl+Y', A.redo], '-',
        ['Delete selected features', 'Delete', () => A.deleteSelected()], ['Edit vertices', 'E', () => A.setTool('edit')], '-',
        ['Add point', 'P', () => A.setTool('addpt')], ['Add line', 'L', () => A.setTool('addline')], ['Add polygon', 'G', () => A.setTool('addpoly')],
        { label: 'Snap to vertices', key: 'Ctrl+Shift+V', checked: () => !!A.settings.snap, fn: () => { A.settings.snap = !A.settings.snap; Aero.toast('Snapping ' + (A.settings.snap ? 'on' : 'off')); A.setTool(A.tool); } }],
      View: [['Zoom in', 'Ctrl+=', () => A.zoomBy(1.6)], ['Zoom out', 'Ctrl+-', () => A.zoomBy(1 / 1.6)], ['Full extent', 'Ctrl+Shift+F', () => A.zoomFull()], ['Zoom to layer', '', () => A.zoomToLayer()], ['Zoom to selection', 'Ctrl+J', () => A.zoomToSelection()], ['Set scale…', '', async () => { const v = await Aero.prompt('Map scale', '1 :', Math.round(A.getScale())); if (v) A.setScale(+String(v).replace(/[^\d.]/g, '')); }], '-',
        tog('Graticule', () => A.settings.graticule, v => A.settings.graticule = v), tog('Graticule labels', () => A.settings.gratLabels, v => A.settings.gratLabels = v),
        tog('Scale bar', () => A.settings.scaleBar !== false, v => A.settings.scaleBar = v), tog('North arrow', () => A.settings.north !== false, v => A.settings.north = v),
        tog('Degrees as D°M′S″', () => !!A.settings.dms, v => A.settings.dms = v), '-',
        { label: 'Metric units', checked: () => A.settings.units === 'metric', fn: () => { A.settings.units = 'metric'; A.render(); } }, { label: 'Imperial units', checked: () => A.settings.units === 'imperial', fn: () => { A.settings.units = 'imperial'; A.render(); } }, { label: 'Nautical units', checked: () => A.settings.units === 'nautical', fn: () => { A.settings.units = 'nautical'; A.render(); } }, '-',
        { label: 'Attribute table', key: 'F6', checked: () => MapTable.visible, fn: () => MapTable.show() }],
      Layer: [['Add data…', '', () => A.openData()], ['New layer…', 'Ctrl+Shift+L', () => D.newLayer()], ['Duplicate layer', '', () => D.duplicateLayer()], ['Rename layer…', 'F2', () => D.renameLayer()], ['Remove layer', '', () => A.active && A.removeLayer(A.active)], '-',
        ['Properties & symbology…', 'Ctrl+L', () => A.active && D.layerProperties(A.active)], ['Labels…', '', () => A.active && D.layerProperties(A.active, 'lab')], ['Filter (definition query)…', '', () => A.active && D.layerProperties(A.active, 'src')], '-',
        ['Move up', 'Ctrl+Up', () => A.active && A.moveLayer(A.active, -1)], ['Move down', 'Ctrl+Down', () => A.active && A.moveLayer(A.active, 1)], ['Zoom to layer', '', () => A.zoomToLayer()], ['Attribute table', '', () => MapTable.show(true)], '-',
        ['Show all layers', '', () => A.change('Show all layers', () => A.doc.layers.forEach(L => A.putLayer({ ...L, visible: true })))], ['Hide all layers', '', () => A.change('Hide all layers', () => A.doc.layers.forEach(L => A.putLayer({ ...L, visible: false })))]],
      Selection: [['Select by attributes…', 'Ctrl+F3', () => D.selectByAttributes()], ['Select by location…', '', () => D.selectByLocation()], '-', ['Select all', 'Ctrl+A', () => A.selectAll()], ['Invert selection', 'Ctrl+I', () => A.invertSelection()], ['Clear selection', 'Ctrl+Shift+N', () => A.clearSelection()], '-',
        ['Zoom to selection', '', () => A.zoomToSelection()], ['Selected features to new layer', '', () => D.selectionToLayer()]],
      Analysis: [['Buffer…', '', () => D.buffer()], ['Clip…', '', () => D.clip(false)], ['Intersect…', '', () => D.intersect()], ['Difference (erase)…', '', () => D.clip(true)], ['Dissolve…', '', () => D.dissolve()], ['Centroids…', '', () => D.centroids()], '-',
        ['Field calculator…', 'Ctrl+Shift+I', () => D.fieldCalculator()], ['Add field…', '', () => D.addField()], ['Statistics…', '', () => D.statistics()], '-',
        ['Measure distance', 'M', () => A.setTool('measure')], ['Measure area', 'A', () => A.setTool('area')]],
      Map: [['Map CRS…', '', () => D.mapCRS()], ['Use the active layer’s source CRS', '', () => { const L = A.activeLayer(); if (L && P.get(L.sourceCrs)) A.change('Change map CRS', () => A.setCRS(L.sourceCrs)); else Aero.toast('The active layer has no known source CRS'); }], ['UTM zone of the map centre', '', () => { const c = A.toLonLat([A.view.cx, A.view.cy]); A.change('Change map CRS', () => A.setCRS(P.utmZoneFor(c[0], c[1]))); }], '-',
        ['Map title…', '', async () => { const v = await Aero.prompt('Map title', 'Title', A.doc.title); if (v != null) A.change('Map title', () => A.doc.title = v); }], ['Print layout…', '', () => MapLayout.open()]],
      Help: [['Keyboard shortcuts', 'F1', shortcuts], ['Expression reference', '', exprHelp], '-', ['About Lumen Map', '', about]],
    } });
  ['pan', 'zoom', 'select', 'identify', 'measure', 'area', 'addpt', 'addline', 'addpoly', 'edit'].forEach((t, i) => Aero.shortcut('HZSIMAPLGE'[i], () => A.setTool(t)));

  // ---------- command bar ----------
  const $ = id => document.getElementById(id);
  $('bAdd').onclick = () => A.openData(); $('bFull').onclick = () => A.zoomFull(); $('bZoomLayer').onclick = () => A.zoomToLayer(); $('bZoomSel').onclick = () => A.zoomToSelection();
  $('bSelAttr').onclick = () => D.selectByAttributes(); $('bClearSel').onclick = () => A.clearSelection(); $('bTable').onclick = () => MapTable.show();

  // ---------- start ----------
  A.doc = A.newDoc('EPSG:3857');
  A.init();
  let start = null;
  try { const j = JSON.parse(localStorage.getItem('lumen-map-autosave') || 'null'); if (j && j.doc) start = j; } catch (e) { }
  if (start) { try { const { doc, view } = A.deserialize(start.doc); A.load(doc, start.name, null, view); Aero.setDirty(true); } catch (e) { start = null; } }
  if (!start) A.openSample().then(() => Aero.setDirty(false));
  A.showInfo(null);
  window.MapMain = { handleFiles, save, exportLayer, exportMap };
})();
