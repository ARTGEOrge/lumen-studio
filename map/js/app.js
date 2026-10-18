// Lumen Map — application core: document & undo, layers, the map view (pan/zoom/reprojection), tools
// (select, identify, measure, digitize, vertex editing) and the layer / results panels.
(function () {
  'use strict';
  const P = MapProj, G = MapGeo, R = MapRender, C = MapClass, X = MapExpr, IO = MapIO;
  const $ = id => document.getElementById(id), esc = s => Aero.esc(String(s ?? ''));
  const PALETTE = ['#4e79a7', '#e15759', '#59a14f', '#f28e2b', '#b07aa1', '#76b7b2', '#edc948', '#9c755f', '#ff9da7', '#5c6bc0'];

  const A = window.MapApp = {
    doc: null, sel: new Map(), active: null, tool: 'pan', view: { cx: 0, cy: 0, res: 1000 }, docName: 'Untitled', filePath: null,
    settings: { graticule: true, gratLabels: true, units: 'metric' }, expanded: new Set(), info: null,
  };
  const hist = A.hist = new Aero.History({ max: 100 });

  // ---------- document ----------
  A.crs = () => P.get(A.doc.crs) || P.get('EPSG:4326');
  A.layer = id => A.doc.layers.find(l => l.id === id) || null;
  A.activeLayer = () => A.layer(A.active);
  A.selected = id => A.sel.get(id) || new Set();
  const snapshot = () => ({ crs: A.doc.crs, title: A.doc.title, layers: A.doc.layers.slice() });
  function restore(st) {
    if (!st) return;
    if (JSON.stringify(st.crs) !== JSON.stringify(A.doc.crs)) A.setCRS(st.crs, false);
    A.doc.crs = st.crs; A.doc.title = st.title; A.doc.layers = st.layers.slice();
    A.sel.forEach((s, id) => { const L = A.layer(id); if (!L) return A.sel.delete(id); const ids = new Set(L.features.map(f => f.id)); [...s].forEach(f => !ids.has(f) && s.delete(f)); });
    if (!A.layer(A.active)) A.active = A.doc.layers[0] ? A.doc.layers[0].id : null;
    A.editTarget = null; syncCrsSel(); A.renderAll();
  }
  A.undo = () => restore(hist.undo());
  A.redo = () => restore(hist.redo());
  // run fn (which replaces layer objects via putLayer / mutLayer) and record one undo step
  A.change = (label, fn) => { fn(); hist.push(label, snapshot()); A.renderAll(); autosave(); };
  A.putLayer = L => { A.doc.layers = A.doc.layers.map(l => l.id === L.id ? L : l); return L; };
  A.mutLayer = id => { const L = A.layer(id); const c = { ...L, features: L.features.slice(), fields: L.fields.slice() }; A.putLayer(c); return c; };
  A.pushHistory = label => { hist.push(label, snapshot()); autosave(); };
  let saveT; function autosave() { clearTimeout(saveT); saveT = setTimeout(() => { try { const s = JSON.stringify(A.serialize()); if (s.length < 4e6) localStorage.setItem('lumen-map-autosave', JSON.stringify({ name: A.docName, doc: JSON.parse(s) })); else localStorage.removeItem('lumen-map-autosave'); } catch (e) { } }, 600); }

  let nextLayerId = 1;
  function detectGeomType(features) {
    const c = {}; features.forEach(f => { if (f.geometry) { const t = f.geometry.type === 'GeometryCollection' ? 'Mixed' : G.baseType(f.geometry.type); c[t] = (c[t] || 0) + 1; } });
    const k = Object.keys(c); return k.length === 1 ? k[0] : k.length ? (k.includes('Mixed') || k.length > 1 ? 'Mixed' : k[0]) : 'Point';
  }
  A.defaultStyle = (geomType, i) => {
    const col = PALETTE[i % PALETTE.length];
    if (geomType === 'LineString') return { mode: 'single', fill: col, stroke: col, width: 1.8, size: 7, shape: 'circle', fillOpacity: 0.7 };
    if (geomType === 'Point') return { mode: 'single', fill: col, stroke: '#ffffff', width: 1, size: 8, shape: 'circle', fillOpacity: 1 };
    return { mode: 'single', fill: col, stroke: C.toHex(C.hex(col).map(v => v * 0.6)), width: 1, size: 7, shape: 'circle', fillOpacity: 0.55 };
  };
  // normalise a layer (from a reader, a geoprocessing result or an opened project — untrusted)
  A.normLayer = (L, i = A.doc ? A.doc.layers.length : 0) => {
    const feats = (Array.isArray(L.features) ? L.features : []).filter(f => f && typeof f === 'object');
    let maxId = 0; const used = new Set();
    const features = feats.map(f => { let id = Number.isInteger(f.id) && f.id > 0 && !used.has(f.id) ? f.id : 0; if (id) used.add(id); return { id, geometry: f.geometry || null, properties: f.properties && typeof f.properties === 'object' ? f.properties : {} }; });
    features.forEach(f => { if (f.id > maxId) maxId = f.id; });
    features.forEach(f => { if (!f.id) { f.id = ++maxId; } });
    const fields = Array.isArray(L.fields) && L.fields.length ? L.fields.filter(f => f && f.name != null).map(f => ({ name: String(f.name).slice(0, 100), type: ['number', 'string', 'boolean', 'date'].includes(f.type) ? f.type : 'string' })) : IO.inferFields(features);
    const geomType = ['Point', 'LineString', 'Polygon', 'Mixed'].includes(L.geomType) ? L.geomType : detectGeomType(features);
    const st = L.style && typeof L.style === 'object' ? { ...A.defaultStyle(geomType, i), ...L.style } : A.defaultStyle(geomType, i);
    const lb = L.labels && typeof L.labels === 'object' ? { on: !!L.labels.on, expr: String(L.labels.expr || ''), size: +L.labels.size || 11, color: L.labels.color || '#1d2733', halo: L.labels.halo !== false, bold: !!L.labels.bold, italic: !!L.labels.italic } : { on: false, expr: fields.find(f => /^name$/i.test(f.name)) ? X.quoteField(fields.find(f => /^name$/i.test(f.name)).name) : fields[0] ? X.quoteField(fields[0].name) : '', size: 11, color: '#1d2733', halo: true };
    return { id: L.id && !A.doc?.layers.some(l => l.id === L.id) ? L.id : 'L' + (nextLayerId++), name: String(L.name || 'Layer').slice(0, 200), geomType, features, fields, style: st, labels: lb, visible: L.visible !== false, opacity: Math.max(0, Math.min(1, L.opacity ?? 1)), filter: typeof L.filter === 'string' ? L.filter : '', sourceCrs: typeof L.sourceCrs === 'string' ? L.sourceCrs : (L.sourceCrs && L.sourceCrs.name ? P.label(L.sourceCrs) : 'EPSG:4326') };
  };
  A.uniqueName = n => { let s = n, k = 2; while (A.doc.layers.some(l => l.name === s)) s = `${n} (${k++})`; return s; };
  A.nextFid = L => L.features.reduce((m, f) => Math.max(m, f.id), 0) + 1;

  // ---------- load / new ----------
  A.newDoc = (crs = 'EPSG:3857') => ({ title: 'Untitled map', crs, layers: [], layout: null });
  A.load = (doc, name, path, view) => {
    A.doc = doc; A.docName = name || doc.title || 'Untitled'; A.filePath = path || null; A.sel.clear(); A.editTarget = null; clearSketch();
    A.active = doc.layers[0] ? doc.layers[0].id : null;
    hist.reset('Open', snapshot()); Aero.setDoc(A.docName, false); syncCrsSel();
    resize(true);
    if (view && isFinite(view.cx) && isFinite(view.res) && view.res > 0) { A.view = { cx: view.cx, cy: view.cy, res: view.res }; } else A.zoomFull(true);
    A.renderAll();
  };
  A.serialize = () => ({ format: 'lumen-map', version: 1, title: A.doc.title, crs: A.doc.crs, view: { ...A.view }, layout: A.doc.layout || null,
    layers: A.doc.layers.map(L => ({ id: L.id, name: L.name, geomType: L.geomType, visible: L.visible, opacity: L.opacity, filter: L.filter, sourceCrs: L.sourceCrs, style: L.style, labels: L.labels, fields: L.fields, features: L.features })) });
  A.deserialize = j => {
    if (!j || typeof j !== 'object' || j.format !== 'lumen-map') throw new Error('Not a Lumen Map project (.lmap)');
    let crs = j.crs; if (crs && typeof crs === 'object') { try { crs = crs.wkt ? P.fromWkt(crs.wkt) : null; } catch (e) { crs = null; } } else if (!P.get(crs)) crs = 'EPSG:3857';
    const doc = { title: String(j.title || 'Untitled map').slice(0, 200), crs: crs || 'EPSG:3857', layers: [], layout: j.layout && typeof j.layout === 'object' ? j.layout : null };
    const prev = A.doc; A.doc = doc;
    try {
      (Array.isArray(j.layers) ? j.layers : []).forEach((l, i) => {
        if (!l || typeof l !== 'object') return;
        const srcF = (Array.isArray(l.features) ? l.features : []).filter(f => f && typeof f === 'object');
        const gj = IO.readGeoJSON({ type: 'FeatureCollection', features: srcF.map(f => ({ type: 'Feature', geometry: f.geometry, properties: f.properties })) }, 'x')[0];
        gj.features.forEach((f, k) => { const src = srcF[k]; if (Number.isInteger(src.id)) f.id = src.id; });
        doc.layers.push(A.normLayer({ ...l, features: gj.features, style: sanitizeStyle(l.style) }, i));
      });
    } finally { A.doc = prev; }
    return { doc, view: j.view };
  };
  function sanitizeStyle(s) {
    if (!s || typeof s !== 'object') return null;
    const col = v => typeof v === 'string' && /^#[0-9a-f]{3,8}$/i.test(v) ? v : undefined, numb = (v, lo, hi) => isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : undefined;
    const o = { mode: ['single', 'categorized', 'graduated'].includes(s.mode) ? s.mode : 'single', fill: col(s.fill), stroke: col(s.stroke), width: numb(s.width, 0, 30), size: numb(s.size, 1, 80), shape: ['circle', 'square', 'triangle', 'diamond', 'star', 'cross'].includes(s.shape) ? s.shape : undefined, fillOpacity: numb(s.fillOpacity, 0, 1), dash: ['solid', 'dash', 'dot', 'dashdot'].includes(s.dash) ? s.dash : undefined, field: typeof s.field === 'string' ? s.field : undefined, method: s.method, nClasses: numb(s.nClasses, 1, 12), ramp: typeof s.ramp === 'string' ? s.ramp : undefined, invert: !!s.invert, gradBy: s.gradBy === 'size' ? 'size' : 'color', sizeMin: numb(s.sizeMin, 1, 80), sizeMax: numb(s.sizeMax, 1, 120), otherColor: col(s.otherColor) };
    if (Array.isArray(s.categories)) o.categories = s.categories.slice(0, 1000).map(c => ({ value: c && c.value != null ? String(c.value) : '', color: col(c && c.color) || '#999999', label: String(c && c.label != null ? c.label : c && c.value).slice(0, 200), visible: !(c && c.visible === false) }));
    if (Array.isArray(s.classes)) o.classes = s.classes.slice(0, 50).filter(c => c && isFinite(+c.min) && isFinite(+c.max)).map(c => ({ min: +c.min, max: +c.max, color: col(c.color) || '#999999', label: String(c.label ?? '').slice(0, 200), visible: c.visible !== false }));
    Object.keys(o).forEach(k => o[k] === undefined && delete o[k]);
    return o;
  }

  // ---------- adding layers ----------
  A.addLayers = (list, { zoom = true, label = 'Add layer' } = {}) => {
    if (!list.length) return [];
    const added = [];
    A.change(label + (list.length > 1 ? 's' : ''), () => {
      list.forEach(raw => { const L = A.normLayer({ ...raw, name: A.uniqueName(raw.name || 'Layer') }); A.doc.layers = [L, ...A.doc.layers]; added.push(L); });
      A.active = added[added.length - 1].id;
    });
    if (zoom) { const wasEmpty = A.doc.layers.length === added.length; if (wasEmpty) autoCrs(added); const b = unionBBox(added); if (b) A.zoomToBBox(b); }
    A.renderAll(); return added;
  };
  // first data on an empty map: if the data is local, use its source CRS or a UTM zone
  function autoCrs(layers) {
    const src = layers.map(l => l.sourceCrs).find(c => c && c !== 'EPSG:4326' && P.get(c));
    if (src) { A.setCRS(src, false); return; }
    let b = [Infinity, Infinity, -Infinity, -Infinity]; layers.forEach(L => L.features.forEach(f => { if (!f.geometry) return; const x = G.bbox(f.geometry); b = [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])]; }));
    if (!isFinite(b[0])) return;
    if (b[2] - b[0] < 5 && b[3] - b[1] < 5 && Math.abs(b[1]) < 80) A.setCRS(P.utmZoneFor((b[0] + b[2]) / 2, (b[1] + b[3]) / 2), false);
    else if (b[2] - b[0] > 90) A.setCRS('EPSG:8857', false);
  }
  function unionBBox(layers) {
    let b = null; layers.forEach(L => { const x = R.layerBBox(L, A.crs()); if (x) b = b ? [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])] : x; }); return b;
  }
  A.removeLayer = id => { const L = A.layer(id); if (!L) return; A.change('Remove layer', () => { A.doc.layers = A.doc.layers.filter(l => l.id !== id); A.sel.delete(id); if (A.active === id) A.active = A.doc.layers[0] ? A.doc.layers[0].id : null; if (A.editTarget && A.editTarget.layer === id) A.editTarget = null; }); };
  A.moveLayer = (id, delta) => { const i = A.doc.layers.findIndex(l => l.id === id), j = i + delta; if (i < 0 || j < 0 || j >= A.doc.layers.length) return; A.change('Reorder layers', () => { const a = A.doc.layers.slice(); const [l] = a.splice(i, 1); a.splice(j, 0, l); A.doc.layers = a; }); };
  A.setLayerProps = (id, props, label = 'Layer properties') => A.change(label, () => { A.putLayer({ ...A.layer(id), ...props }); });

  // ---------- selection ----------
  A.setSelection = (id, ids, mode = 'new') => {
    const cur = A.selected(id), next = mode === 'new' ? new Set(ids) : mode === 'add' ? new Set([...cur, ...ids]) : mode === 'remove' ? new Set([...cur].filter(x => !ids.includes(x))) : mode === 'subset' ? new Set(ids.filter(x => cur.has(x))) : mode === 'toggle' ? new Set(cur) : new Set(ids);
    if (mode === 'toggle') ids.forEach(x => next.has(x) ? next.delete(x) : next.add(x));
    if (next.size) A.sel.set(id, next); else A.sel.delete(id);
    if (A.editTarget && (A.editTarget.layer !== id || !next.has(A.editTarget.fid))) A.editTarget = null;
    A.render(); A.refreshPanels(); MapTable.refresh();
  };
  A.clearSelection = () => { A.sel.clear(); A.editTarget = null; A.render(); A.refreshPanels(); MapTable.refresh(); };
  A.selectedFeatures = id => { const s = A.selected(id), L = A.layer(id); return L ? L.features.filter(f => s.has(f.id)) : []; };

  // ---------- view ----------
  const cv = $('map'), ov = $('overlay'), stage = $('stage'); let W = 800, H = 600, DPR = 1;
  function resize(silent) {
    const r = stage.getBoundingClientRect(); DPR = window.devicePixelRatio || 1; W = Math.max(50, Math.round(r.width)); H = Math.max(50, Math.round(r.height));
    [cv, ov].forEach(c => { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); });
    if (!silent) { A.render(); drawOverlay(); }
  }
  A.size = () => ({ w: W, h: H });
  A.viewObj = () => R.makeView({ ...A.view, w: W, h: H });
  A.screenToMap = (x, y) => [A.view.cx + (x - W / 2) * A.view.res, A.view.cy - (y - H / 2) * A.view.res];
  A.mapToScreen = p => [(p[0] - A.view.cx) / A.view.res + W / 2, H / 2 - (p[1] - A.view.cy) / A.view.res];
  A.toLonLat = p => P.make(A.crs()).inverse(p);
  A.fromLonLat = c => P.make(A.crs()).forward(c);
  A.zoomToBBox = (b, pad = 0.08) => {
    if (!b || !isFinite(b[0])) return;
    let w = b[2] - b[0], h = b[3] - b[1]; if (w <= 0 && h <= 0) { const r = A.crs().proj === 'longlat' ? 0.01 : 1000; w = h = r; }
    A.view = { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, res: Math.max(w / W, h / H) * (1 + pad * 2) || A.view.res };
    A.render(); updateScale();
  };
  A.zoomFull = silent => {
    const b = unionBBox(A.doc.layers.filter(l => l.visible));
    if (b) A.zoomToBBox(b);
    else { const wo = R.worldOutline(A.crs()); if (wo) { const bb = G.bbox({ type: 'LineString', coordinates: wo }); A.zoomToBBox(bb, 0.02); } else { const c = A.fromLonLat([P.make(A.crs()).lon0, 0]); A.view = { cx: c[0], cy: c[1] + 3e6, res: 8000 }; } }
    if (!silent) A.render();
  };
  A.zoomToLayer = id => { const L = A.layer(id || A.active); if (L) A.zoomToBBox(R.layerBBox(L, A.crs())); };
  A.zoomToSelection = () => {
    let b = null; A.sel.forEach((s, id) => { const L = A.layer(id); if (!L) return; L.features.forEach(f => { if (!s.has(f.id) || !f.geometry) return; const x = R.projected(f, A.crs()).bbox; b = b ? [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])] : x; }); });
    if (b) A.zoomToBBox(b, 0.25); else Aero.toast('Nothing is selected');
  };
  A.zoomBy = (f, x = W / 2, y = H / 2) => {
    const m = A.screenToMap(x, y); A.view.res = Math.max(1e-9, A.view.res / f);
    A.view.cx = m[0] - (x - W / 2) * A.view.res; A.view.cy = m[1] + (y - H / 2) * A.view.res; A.render(); updateScale();
  };
  // metres per pixel at the view centre (geodesic)
  // metres per pixel at the view centre (geodesic, east-west direction)
  A.unitMeters = (cx = A.view.cx, cy = A.view.cy) => {
    const d = A.crs().proj === 'longlat' ? 1e-5 : 1, a = A.toLonLat([cx - d / 2, cy]), b = A.toLonLat([cx + d / 2, cy]), m = G.distance(a, b) / d;
    return isFinite(m) && m > 0 ? m : (A.crs().proj === 'longlat' ? 111319.49 : A.crs().units || 1);
  };
  A.metersPerPixel = () => A.unitMeters() * A.view.res;
  A.getScale = () => A.metersPerPixel() / 0.0254 * 96;
  A.setScale = n => { if (!(n > 0)) return; A.view.res *= n / A.getScale(); A.render(); updateScale(); };
  A.setCRS = (code, render = true) => {
    const def = typeof code === 'object' ? code : P.get(code); if (!def) { Aero.toast('Unknown CRS ' + code); return; }
    const c = A.doc && A.view.res ? A.toLonLat([A.view.cx, A.view.cy]) : null, mpp = c ? A.metersPerPixel() : null;
    A.doc.crs = def.code || def;
    if (c && isFinite(c[0])) { const p = A.fromLonLat(c); if (isFinite(p[0]) && isFinite(p[1])) { A.view.cx = p[0]; A.view.cy = p[1]; if (mpp) A.view.res = mpp / A.unitMeters(); } }
    syncCrsSel(); if (render) { A.render(); A.refreshPanels(); }
  };
  function syncCrsSel() {
    const s = $('crsSel'), cur = typeof A.doc.crs === 'string' ? A.doc.crs : 'custom';
    if (!s.options.length || s.dataset.built !== '1') {
      s.innerHTML = ''; const groups = { World: [], Regional: [], 'UTM zones': [] };
      P.list().forEach(([k, n]) => { const d = P.get(k); (d.zone ? groups['UTM zones'] : d.proj === 'longlat' || /World|Equal Earth|Mollweide|Web Mercator|EASE/.test(n) ? groups.World : groups.Regional).push([k, n]); });
      Object.entries(groups).forEach(([g, items]) => { const og = document.createElement('optgroup'); og.label = g; items.forEach(([k, n]) => og.appendChild(new Option(`${k} — ${n}`, k))); s.appendChild(og); });
      s.dataset.built = '1';
    }
    [...s.querySelectorAll('option.custom')].forEach(o => o.remove());
    if (cur === 'custom' || !P.get(cur) || ![...s.options].some(o => o.value === cur)) { const o = new Option('Custom — ' + (P.get(A.doc.crs)?.name || 'CRS'), 'custom'); o.className = 'custom'; s.insertBefore(o, s.firstChild); s.value = 'custom'; }
    else s.value = cur;
  }
  A.syncCrsSel = syncCrsSel;

  // ---------- rendering ----------
  let raf = 0, panImg = null;
  A.render = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawBase(); drawOverlay(); updateScale(); }); };
  A.renderNow = () => { cancelAnimationFrame(raf); raf = 0; drawBase(); drawOverlay(); updateScale(); };
  function drawBase() {
    const ctx = cv.getContext('2d'); ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    try { R.drawMap(ctx, { doc: A.doc, crs: A.crs(), view: { ...A.view, w: W, h: H }, selection: A.sel, graticule: { on: A.settings.graticule, labels: A.settings.gratLabels } }); }
    catch (e) { console.error(e); }
    $('empty').classList.toggle('show', !A.doc.layers.length);
  }
  function updateScale() {
    const n = A.getScale(); if (document.activeElement !== $('scaleIn')) $('scaleIn').value = isFinite(n) ? Math.round(n).toLocaleString('en-US') : '';
    // scale bar
    const mpp = A.metersPerPixel(), target = mpp * 110, pow = Math.pow(10, Math.floor(Math.log10(target))), nice = [1, 2, 5, 10].map(x => x * pow).filter(x => x <= target).pop() || pow;
    const px = nice / mpp; $('scalebar').innerHTML = `${nice >= 1000 ? nice / 1000 + ' km' : nice + ' m'}<div class="bar" style="width:${Math.round(px)}px"></div>`;
    $('scalebar').style.display = A.settings.scaleBar === false ? 'none' : '';
    // north arrow follows grid convergence
    const c = A.toLonLat([A.view.cx, A.view.cy]), p0 = A.fromLonLat(c), p1 = A.fromLonLat([c[0], Math.min(89.9, c[1] + 0.05)]), ang = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]) * 180 / Math.PI;
    $('north').style.transform = isFinite(ang) && Math.abs(ang) > 0.05 ? `rotate(${ang}deg)` : ''; $('north').style.display = A.settings.north === false ? 'none' : '';
    $('st3').textContent = P.label(A.crs());
  }

  // ---------- overlay (sketches, measure, rubber band, vertex handles) ----------
  const sketch = A.sketch = { pts: [], kind: null, hover: null };
  function clearSketch() { sketch.pts = []; sketch.kind = null; sketch.hover = null; }
  A.clearSketch = () => { clearSketch(); drawOverlay(); A.showInfo(null); };
  let rubber = null, snapPt = null;
  function drawOverlay() {
    const ctx = ov.getContext('2d'); ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
    if (rubber) { ctx.fillStyle = 'rgba(60,127,177,.15)'; ctx.strokeStyle = '#3c7fb1'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]); const [x0, y0, x1, y1] = rubber; ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)); ctx.strokeRect(Math.min(x0, x1) + .5, Math.min(y0, y1) + .5, Math.abs(x1 - x0), Math.abs(y1 - y0)); ctx.setLineDash([]); }
    if (sketch.pts.length) {
      const pts = sketch.pts.map(A.mapToScreen); if (sketch.hover) pts.push(A.mapToScreen(sketch.hover));
      const measure = sketch.kind === 'measure' || sketch.kind === 'area', poly = sketch.kind === 'area' || sketch.kind === 'addpoly';
      ctx.lineJoin = 'round';
      if (poly && pts.length > 2) { ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath(); ctx.fillStyle = measure ? 'rgba(255,140,0,.18)' : 'rgba(60,127,177,.2)'; ctx.fill(); }
      ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); if (poly && pts.length > 2) ctx.closePath();
      ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 4; ctx.stroke(); ctx.strokeStyle = measure ? '#e46b00' : '#1f6fd0'; ctx.lineWidth = 2; if (measure) ctx.setLineDash([6, 3]); ctx.stroke(); ctx.setLineDash([]);
      pts.forEach((p, i) => { if (i === pts.length - 1 && sketch.hover) return; ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, 7); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = measure ? '#e46b00' : '#1f6fd0'; ctx.lineWidth = 1.5; ctx.stroke(); });
    }
    if (snapPt) { const p = A.mapToScreen(snapPt); ctx.strokeStyle = '#e000a0'; ctx.lineWidth = 1.5; ctx.strokeRect(p[0] - 6, p[1] - 6, 12, 12); }
    const et = editGeom();
    if (et) {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#c05800'; ctx.lineWidth = 1.4;
      et.verts.forEach(v => { const p = A.mapToScreen(A.fromLonLat(v.c)); ctx.beginPath(); ctx.rect(p[0] - 4, p[1] - 4, 8, 8); ctx.fillStyle = v === dragV ? '#ffb070' : '#fff'; ctx.fill(); ctx.stroke(); });
    }
  }
  A.drawOverlay = drawOverlay;

  // ---------- results panel ----------
  A.showInfo = (html, title = 'Results', right = '') => { $('info').innerHTML = html || `<div class="muted">${A.tool === 'identify' ? 'Click a feature on the map to see its attributes.' : A.tool === 'measure' || A.tool === 'area' ? 'Click on the map to start measuring; double-click to finish.' : 'Identify, measurement and selection results appear here.'}</div>`; $('infoTitle').textContent = title; $('infoRight').textContent = right; };
  function measureInfo() {
    const ll = sketch.pts.map(A.toLonLat), hov = sketch.hover ? A.toLonLat(sketch.hover) : null, all = hov ? [...ll, hov] : ll, u = A.settings.units;
    if (sketch.kind === 'measure') {
      const total = G.length(all), segs = []; for (let i = 1; i < all.length; i++) segs.push(G.inverse(all[i - 1], all[i]));
      const last = segs[segs.length - 1];
      return `<div class="muted">Geodesic distance (WGS 84 ellipsoid)</div><div class="big">${G.fmtDist(total, u)}</div>` + (last ? `<table><tr><td>Segment</td><td>${G.fmtDist(last.s, u)}</td></tr><tr><td>Azimuth</td><td>${last.az1.toFixed(2)}°</td></tr><tr><td>Vertices</td><td>${all.length}</td></tr><tr><td>Planar (map CRS)</td><td>${G.fmtDist(planarLen(), u)}</td></tr></table>` : '') + '<div class="muted" style="margin-top:6px">Double-click or Enter to finish · Esc to clear · Backspace removes the last point</div>';
    }
    const area = all.length > 2 ? Math.abs(G.ringAreaGeo(all)) : 0, per = all.length > 1 ? G.length([...all, all[0]]) : 0;
    return `<div class="muted">Geodesic area (WGS 84 ellipsoid)</div><div class="big">${G.fmtArea(area, u)}</div><table><tr><td>Perimeter</td><td>${G.fmtDist(per, u)}</td></tr><tr><td>Vertices</td><td>${all.length}</td></tr></table><div class="muted" style="margin-top:6px">Double-click or Enter to finish · Esc to clear</div>`;
  }
  function planarLen() { const pts = sketch.hover ? [...sketch.pts, sketch.hover] : sketch.pts; let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s * (A.crs().units || 1) * (A.crs().proj === 'longlat' ? 111319.49 : 1); }
  A.identifyHTML = (L, f) => {
    const g = f.geometry, rows = (L.fields.length ? L.fields.map(x => x.name) : Object.keys(f.properties)).map(k => `<tr><td>${esc(k)}</td><td>${f.properties[k] == null ? '<span class="muted">NULL</span>' : esc(f.properties[k])}</td></tr>`).join('');
    let derived = '';
    if (g) {
      const bt = G.baseType(g.type), u = A.settings.units;
      if (bt === 'Polygon') derived = `<tr><td>Area</td><td>${G.fmtArea(G.geomArea(g), u)}</td></tr><tr><td>Perimeter</td><td>${G.fmtDist(G.geomLength(g), u)}</td></tr>`;
      else if (bt === 'LineString') derived = `<tr><td>Length</td><td>${G.fmtDist(G.geomLength(g), u)}</td></tr>`;
      else if (g.type === 'Point') { const c = g.coordinates, p = A.fromLonLat(c); derived = `<tr><td>Lon, Lat</td><td>${c[0].toFixed(6)}, ${c[1].toFixed(6)}</td></tr><tr><td></td><td>${G.fmtDMS(c[1], 'N', 'S')} ${G.fmtDMS(c[0], 'E', 'W')}</td></tr>` + (A.crs().proj !== 'longlat' ? `<tr><td>Map X, Y</td><td>${p[0].toFixed(2)}, ${p[1].toFixed(2)}</td></tr>` : ''); }
    }
    return `<h4>${esc(L.name)} · feature ${f.id}</h4><table>${rows}${derived ? `<tr><td colspan="2" style="padding-top:5px;color:#003399;font-weight:600">Derived (geodesic)</td></tr>${derived}` : ''}</table>`;
  };

  // ---------- vertex editing ----------
  let dragV = null;
  function editFeature() { const t = A.editTarget; if (!t) return null; const L = A.layer(t.layer); const f = L && L.features.find(x => x.id === t.fid); return f ? { L, f } : null; }
  // vertex list of a feature: {arr (coordinate array in a cloned geometry), i, c, closed}
  function vertexList(g) {
    const verts = [], arrays = [];
    const add = (arr, closed) => { arrays.push({ arr, closed }); const n = closed && arr.length > 1 && arr[0][0] === arr[arr.length - 1][0] && arr[0][1] === arr[arr.length - 1][1] ? arr.length - 1 : arr.length; for (let i = 0; i < n; i++) verts.push({ arr, i, c: arr[i], closed }); };
    switch (g.type) {
      case 'Point': add([g.coordinates], false); break;
      case 'MultiPoint': add(g.coordinates, false); break;
      case 'LineString': add(g.coordinates, false); break;
      case 'MultiLineString': g.coordinates.forEach(l => add(l, false)); break;
      case 'Polygon': g.coordinates.forEach(r => add(r, true)); break;
      case 'MultiPolygon': g.coordinates.forEach(p => p.forEach(r => add(r, true))); break;
    }
    return { verts, arrays };
  }
  function editGeom() { const e = editFeature(); if (!e || !e.f.geometry) return null; return vertexList(e.f.geometry); }
  const cloneGeom = g => JSON.parse(JSON.stringify(g));
  function replaceFeatureLive(L, f) { const nl = { ...L, features: L.features.map(x => x.id === f.id ? f : x) }; A.putLayer(nl); return nl; }

  // ---------- snapping ----------
  function snap(x, y) {
    if (!A.settings.snap) return null;
    const tol = 9 * A.view.res, m = A.screenToMap(x, y); let best = null, bd = tol;
    A.doc.layers.forEach(L => { if (!L.visible) return; L.features.forEach(f => { if (!f.geometry) return; const g = R.projected(f, A.crs()), b = g.bbox; if (m[0] < b[0] - tol || m[0] > b[2] + tol || m[1] < b[1] - tol || m[1] > b[3] + tol) return;
      g.pts.forEach(p => { const d = Math.hypot(p[0] - m[0], p[1] - m[1]); if (d < bd) { bd = d; best = [p[0], p[1]]; } });
      [...g.lines, ...g.polys.flat()].forEach(a => { for (let i = 0; i < a.length; i += 2) { const d = Math.hypot(a[i] - m[0], a[i + 1] - m[1]); if (d < bd) { bd = d; best = [a[i], a[i + 1]]; } } }); }); });
    return best;
  }

  // ---------- tools ----------
  const TOOLS = [
    { id: 'pan', title: 'Pan (H)', key: 'H', name: 'Pan', icon: '<path d="M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>' },
    { id: 'zoom', title: 'Zoom in — drag a box or click (Z)', key: 'Z', name: 'Zoom', icon: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5 20.5 20.5M10 7.5v5M7.5 10h5"/>' },
    null,
    { id: 'select', title: 'Select features in the active layer — click or drag a box; Shift adds, Ctrl toggles (S)', key: 'S', name: 'Select', icon: '<rect x="3" y="3" width="12" height="12" stroke-dasharray="2.5 2"/><path d="M11 11l9 3.2-3.6 1.6L14.8 19.5z"/>' },
    { id: 'identify', title: 'Identify features (I)', key: 'I', name: 'Identify', icon: '<circle cx="12" cy="12" r="9"/><path d="M12 10.5v6.5M12 7v.6"/>' },
    null,
    { id: 'measure', title: 'Measure distance — geodesic (M)', key: 'M', name: 'Measure distance', icon: '<path d="M3 17 17 3l4 4L7 21z"/><path d="M7.5 12.5l2 2M10.5 9.5l2 2M13.5 6.5l2 2"/>' },
    { id: 'area', title: 'Measure area — geodesic (A)', key: 'A', name: 'Measure area', icon: '<path d="M4 18 7.5 5l12 3.5-3 11z"/><path d="M9 13h6M12 10v6"/>' },
    null,
    { id: 'addpt', title: 'Add point feature to the active layer (P)', key: 'P', name: 'Add point', icon: '<path d="M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/>' },
    { id: 'addline', title: 'Add line feature — double-click to finish (L)', key: 'L', name: 'Add line', icon: '<path d="M3.5 18.5 9 9l6 6 5.5-10"/><circle cx="3.5" cy="18.5" r="1.6"/><circle cx="9" cy="9" r="1.6"/><circle cx="15" cy="15" r="1.6"/><circle cx="20.5" cy="5" r="1.6"/>' },
    { id: 'addpoly', title: 'Add polygon feature — double-click to finish (G)', key: 'G', name: 'Add polygon', icon: '<path d="M5 19.5 3 9l9-6 9 6-3 10.5z"/><circle cx="12" cy="3" r="1.5"/><circle cx="3" cy="9" r="1.5"/><circle cx="21" cy="9" r="1.5"/>' },
    { id: 'edit', title: 'Edit vertices of the selected feature — drag vertices, double-click an edge to add, right-click to delete, drag inside to move (E)', key: 'E', name: 'Edit vertices', icon: '<path d="M4.5 19.5 10 6l9.5 8z"/><rect x="2.5" y="17.5" width="4" height="4"/><rect x="8" y="4" width="4" height="4"/><rect x="17.5" y="12" width="4" height="4"/>' },
  ];
  let toolbox;
  A.setTool = id => {
    if (A.tool !== id) { clearSketch(); snapPt = null; lastClick = 0; }
    A.tool = id; toolbox && toolbox.get() !== id && toolbox.set(id);
    stage.className = 'aero-stage map-stage t-' + id;
    $('toolName').textContent = (TOOLS.find(t => t && t.id === id) || {}).name || id;
    const L = A.activeLayer();
    if ((id === 'addpt' || id === 'addline' || id === 'addpoly') && L) {
      const need = { addpt: 'Point', addline: 'LineString', addpoly: 'Polygon' }[id];
      $('hint').textContent = L.geomType === need ? `Digitizing into “${L.name}” · snapping ${A.settings.snap ? 'on' : 'off'} (Ctrl+Shift+S)` : `The active layer “${L.name}” is not a ${need === 'LineString' ? 'line' : need.toLowerCase()} layer — choose or create one (Layer ▸ New layer…)`;
    } else if (id === 'edit') $('hint').textContent = A.editTarget ? 'Drag vertices · double-click an edge to insert · right-click deletes · drag inside to move' : 'Click a feature of the active layer to edit its vertices';
    else $('hint').textContent = '';
    if (id === 'edit' && !A.editTarget) { const L2 = A.activeLayer(), s = L2 && A.selected(L2.id); if (s && s.size === 1) A.editTarget = { layer: L2.id, fid: [...s][0] }; }
    if (id !== 'edit') A.editTarget = null;
    A.showInfo(null); drawOverlay();
  };
  function setupTools() { toolbox = Aero.toolbox($('tools'), TOOLS, id => A.setTool(id)); toolbox.set('pan'); }

  // pointer handling
  let drag = null, lastClick = 0;
  function hitAnyLayer(x, y, onlyActive) {
    const m = A.screenToMap(x, y), tol = 5 * A.view.res;
    for (const L of A.doc.layers) { if (!L.visible || (onlyActive && L.id !== A.active)) continue; const f = R.hitTest(L, A.crs(), m[0], m[1], tol); if (f) return { L, f }; }
    return null;
  }
  function onDown(e) {
    if (e.button === 1 || (e.button === 0 && (A.tool === 'pan' || spaceDown))) { startPan(e); return; }
    const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (e.button === 2) { if (A.tool === 'edit') editRightClick(x, y); return; }
    if (e.button !== 0) return;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { }
    const t = A.tool;
    if (t === 'zoom' || t === 'select') { drag = { kind: 'rubber', x0: x, y0: y, e }; rubber = [x, y, x, y]; return; }
    if (t === 'edit') { editDown(x, y, e); return; }
  }
  function startPan(e) {
    try { stage.setPointerCapture(e.pointerId); } catch (err) { } stage.classList.add('dragging');
    panImg = document.createElement('canvas'); panImg.width = cv.width; panImg.height = cv.height; panImg.getContext('2d').drawImage(cv, 0, 0);
    drag = { kind: 'pan', x0: e.clientX, y0: e.clientY, cx: A.view.cx, cy: A.view.cy };
  }
  function onMove(e) {
    const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, m = A.screenToMap(x, y);
    // status: coordinates
    const ll = A.toLonLat(m);
    if (isFinite(ll[0]) && isFinite(ll[1])) $('st1').textContent = (A.settings.dms ? `${G.fmtDMS(ll[1], 'N', 'S')}  ${G.fmtDMS(ll[0], 'E', 'W')}` : `${ll[1].toFixed(5)}°, ${ll[0].toFixed(5)}°`) + (A.crs().proj !== 'longlat' ? `   ·   X ${m[0].toFixed(1)}  Y ${m[1].toFixed(1)}` : '');
    if (drag && drag.kind === 'pan') {
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0; A.view.cx = drag.cx - dx * A.view.res; A.view.cy = drag.cy + dy * A.view.res;
      const ctx = cv.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#e9eef3'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(panImg, dx * DPR, dy * DPR); drawOverlay(); return;
    }
    if (drag && drag.kind === 'rubber') { rubber = [drag.x0, drag.y0, x, y]; drawOverlay(); return; }
    if (drag && (drag.kind === 'vertex' || drag.kind === 'move')) { editMove(x, y, e); return; }
    if (sketch.kind) { const s = snap(x, y); snapPt = s; sketch.hover = s || m; drawOverlay(); if (sketch.kind === 'measure' || sketch.kind === 'area') A.showInfo(measureInfo(), sketch.kind === 'measure' ? 'Measure distance' : 'Measure area'); return; }
    if (['addpt', 'addline', 'addpoly'].includes(A.tool)) { const s = snap(x, y); if (String(s) !== String(snapPt)) { snapPt = s; drawOverlay(); } }
  }
  function onUp(e) {
    const r = stage.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (!drag) { if (e.button === 0) click(x, y, e); return; }
    const d = drag; drag = null; stage.classList.remove('dragging');
    if (d.kind === 'pan') { panImg = null; A.renderNow(); if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 3 && A.tool !== 'pan') click(x, y, e); return; }
    if (d.kind === 'rubber') {
      rubber = null; const small = Math.abs(x - d.x0) < 4 && Math.abs(y - d.y0) < 4;
      if (A.tool === 'zoom') { if (small) A.zoomBy(2, x, y); else { const a = A.screenToMap(d.x0, d.y0), b = A.screenToMap(x, y); A.zoomToBBox([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])], 0); } drawOverlay(); return; }
      const L = A.activeLayer(); if (!L) { Aero.toast('Add a layer first'); drawOverlay(); return; }
      const mode = e.shiftKey ? 'add' : e.ctrlKey ? 'toggle' : 'new';
      if (small) { const tol = 5 * A.view.res, m = A.screenToMap(x, y), f = L.visible && R.hitTest(L, A.crs(), m[0], m[1], tol); A.setSelection(L.id, f ? [f.id] : [], mode); }
      else { const a = A.screenToMap(d.x0, d.y0), b = A.screenToMap(x, y); A.setSelection(L.id, L.visible ? R.boxSelect(L, A.crs(), [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]) : [], mode); }
      drawOverlay(); return;
    }
    if (d.kind === 'vertex' || d.kind === 'move') { editUp(d); return; }
  }
  function click(x, y, e) {
    const now = performance.now(), dbl = now - lastClick < 320; lastClick = now;
    const t = A.tool, s = snap(x, y), m = s || A.screenToMap(x, y);
    if (t === 'identify') {
      const h = hitAnyLayer(x, y);
      if (h) { A.showInfo(A.identifyHTML(h.L, h.f), 'Identify', h.L.name); A.flash = { L: h.L, f: h.f }; }
      else A.showInfo('<div class="muted">No feature here.</div>', 'Identify');
      return;
    }
    if (t === 'measure' || t === 'area') {
      if (sketch.kind !== t) { clearSketch(); sketch.kind = t; }
      if (dbl && sketch.pts.length) { finishSketch(); return; }
      sketch.pts.push(m); drawOverlay(); A.showInfo(measureInfo(), t === 'measure' ? 'Measure distance' : 'Measure area'); return;
    }
    if (t === 'addpt' || t === 'addline' || t === 'addpoly') {
      const L = A.activeLayer(), need = { addpt: 'Point', addline: 'LineString', addpoly: 'Polygon' }[t];
      if (!L || L.geomType !== need) { Aero.toast(L ? `“${L.name}” is not a ${need === 'LineString' ? 'line' : need.toLowerCase()} layer.` : 'Create a layer first (Layer ▸ New layer…)'); return; }
      if (t === 'addpt') { createFeature(L, { type: 'Point', coordinates: A.toLonLat(m) }); return; }
      if (sketch.kind !== t) { clearSketch(); sketch.kind = t; }
      if (dbl && sketch.pts.length) { finishSketch(); return; }
      sketch.pts.push(m); drawOverlay(); return;
    }
  }
  function finishSketch() {
    const k = sketch.kind; if (!k) return;
    // a double-click adds the same point twice — drop exact duplicates
    const pts = sketch.pts.filter((p, i, a) => !i || p[0] !== a[i - 1][0] || p[1] !== a[i - 1][1]);
    if (k === 'measure' || k === 'area') { sketch.pts = pts; sketch.hover = null; A.showInfo(measureInfo(), k === 'measure' ? 'Distance' : 'Area'); sketch.kind = null; sketch.done = true; drawOverlay(); return; }
    const L = A.activeLayer(); const ll = pts.map(A.toLonLat);
    if (k === 'addline') { if (ll.length < 2) { Aero.toast('A line needs at least 2 vertices'); return; } clearSketch(); createFeature(L, { type: 'LineString', coordinates: ll }); }
    if (k === 'addpoly') { if (ll.length < 3) { Aero.toast('A polygon needs at least 3 vertices'); return; } clearSketch(); const ring = [...ll, ll[0]]; createFeature(L, { type: 'Polygon', coordinates: [G.ringArea(ring) > 0 ? ring : ring.reverse()] }); }
    drawOverlay();
  }
  A.finishSketch = finishSketch;
  function createFeature(L, geometry) {
    const props = {}; L.fields.forEach(f => props[f.name] = null);
    const fid = A.nextFid(L);
    const commit = vals => { A.change('Add feature', () => { const nl = A.mutLayer(L.id); nl.features.push({ id: fid, geometry, properties: { ...props, ...vals } }); }); A.setSelection(L.id, [fid]); };
    if (!L.fields.length) { commit({}); return; }
    Aero.dialog({ title: `New feature — ${L.name}`, instruction: 'Attributes for the new feature', fields: L.fields.slice(0, 14).map(f => ({ key: f.name, label: f.name, type: f.type === 'number' ? 'number' : f.type === 'boolean' ? 'checkbox' : 'text', value: f.type === 'boolean' ? false : '' })),
      onOK: v => { const o = {}; L.fields.forEach(f => { if (!(f.name in v)) return; let x = v[f.name]; if (f.type === 'number') x = x === '' || x == null || !isFinite(x) ? null : +x; else if (f.type === 'string') x = x === '' ? null : String(x); o[f.name] = x; }); commit(o); },
      onCancel: () => Aero.toast('Feature discarded') });
  }
  // ---- vertex edit handlers ----
  function editDown(x, y, e) {
    const L = A.activeLayer(); if (!L) return;
    const et = editGeom(), tol = 7;
    if (et) {
      const v = et.verts.find(v => { const p = A.mapToScreen(A.fromLonLat(v.c)); return Math.abs(p[0] - x) <= tol && Math.abs(p[1] - y) <= tol; });
      const ef = editFeature();
      if (v) { const g = cloneGeom(ef.f.geometry), vl = vertexList(g), cv2 = vl.verts[et.verts.indexOf(v)]; drag = { kind: 'vertex', g, v: cv2, base: ef }; dragV = v; return; }
      // double-click on an edge inserts a vertex
      const now = performance.now(), dbl = now - lastClick < 320; lastClick = now;
      if (dbl) { insertVertex(x, y); return; }
      const m = A.screenToMap(x, y), hit = R.hitTest(ef.L, A.crs(), m[0], m[1], 5 * A.view.res);
      if (hit && hit.id === ef.f.id) { drag = { kind: 'move', g0: ef.f.geometry, start: m, base: ef }; return; }
    }
    const m = A.screenToMap(x, y), f = L.visible && R.hitTest(L, A.crs(), m[0], m[1], 5 * A.view.res);
    if (f) { A.editTarget = { layer: L.id, fid: f.id }; A.setSelection(L.id, [f.id]); $('hint').textContent = 'Drag vertices · double-click an edge to insert · right-click deletes · drag inside to move'; }
    else { A.editTarget = null; A.setSelection(L.id, []); }
    drawOverlay();
  }
  function editMove(x, y, e) {
    const d = drag, s = d.kind === 'vertex' ? snap(x, y) : null, m = s || A.screenToMap(x, y);
    if (d.kind === 'vertex') {
      const ll = A.toLonLat(m), v = d.v; v.arr[v.i] = [ll[0], ll[1]];
      if (v.closed && v.i === 0) v.arr[v.arr.length - 1] = [ll[0], ll[1]];
      d.moved = true; liveSet(d.base, cloneGeom(d.g));
    } else {
      const a = A.toLonLat(d.start), b = A.toLonLat(m), dx = b[0] - a[0], dy = b[1] - a[1];
      // move in map coordinates so shapes keep their projected form
      const ddx = m[0] - d.start[0], ddy = m[1] - d.start[1];
      d.moved = true; liveSet(d.base, G.mapCoords(d.g0, c => { const p = A.fromLonLat(c); return A.toLonLat([p[0] + ddx, p[1] + ddy]); }));
      void dx; void dy;
    }
  }
  function liveSet(base, geometry) { const L = A.layer(base.L.id), f = L.features.find(x => x.id === base.f.id); replaceFeatureLive(L, { ...f, geometry }); A.renderNow(); }
  function editUp(d) { dragV = null; if (d && d.moved) A.pushHistory(d.kind === 'vertex' ? 'Move vertex' : 'Move feature'); A.renderAll(); }
  function insertVertex(x, y) {
    const ef = editFeature(); if (!ef) return; const g = cloneGeom(ef.f.geometry), vl = vertexList(g), m = A.screenToMap(x, y);
    let best = null, bd = 8 * A.view.res;
    vl.arrays.forEach(({ arr }) => { for (let i = 1; i < arr.length; i++) { const a = A.fromLonLat(arr[i - 1]), b = A.fromLonLat(arr[i]), d = Math.sqrt(G.segDist2(m, a, b)); if (d < bd) { bd = d; best = { arr, i }; } } });
    if (!best) return;
    best.arr.splice(best.i, 0, A.toLonLat(m));
    A.change('Insert vertex', () => replaceFeatureLive(A.layer(ef.L.id), { ...ef.f, geometry: g }));
  }
  function editRightClick(x, y) {
    const ef = editFeature(), et = editGeom(); if (!ef || !et) return;
    const idx = et.verts.findIndex(v => { const p = A.mapToScreen(A.fromLonLat(v.c)); return Math.abs(p[0] - x) <= 7 && Math.abs(p[1] - y) <= 7; }); if (idx < 0) return;
    const g = cloneGeom(ef.f.geometry), vl = vertexList(g), v = vl.verts[idx];
    const min = v.closed ? 4 : g.type === 'Point' || g.type === 'MultiPoint' ? 99 : 2;
    if (v.arr.length - 1 < min) { Aero.toast(v.closed ? 'A ring needs at least 3 vertices' : 'Cannot delete this vertex'); return; }
    v.arr.splice(v.i, 1); if (v.closed && v.i === 0) v.arr[v.arr.length - 1] = v.arr[0].slice();
    A.change('Delete vertex', () => replaceFeatureLive(A.layer(ef.L.id), { ...ef.f, geometry: g }));
  }
  A.deleteSelected = () => {
    const L = A.activeLayer(), s = L && A.selected(L.id); if (!L || !s.size) { Aero.toast('Select features in the active layer first'); return; }
    const n = s.size; A.change(`Delete ${n} feature${n > 1 ? 's' : ''}`, () => { const nl = A.mutLayer(L.id); nl.features = nl.features.filter(f => !s.has(f.id)); A.sel.delete(L.id); A.editTarget = null; });
    Aero.toast(`Deleted ${n} feature${n > 1 ? 's' : ''}`);
  };

  // ---------- layers panel ----------
  A.symSVG = (L, override) => {
    const s = { ...L.style, ...(override || {}) }, gt = L.geomType;
    if (!override && s.mode !== 'single') { const list = s.mode === 'categorized' ? s.categories : s.gradBy === 'size' ? null : s.classes; if (list && list.length) s.fill = list[Math.floor(list.length / 2)].color; if (gt === 'LineString' && list && list.length) s.stroke = s.fill; }
    const fill = s.fill || '#888', stroke = s.stroke || '#333';
    if (gt === 'LineString') return `<svg class="sym" viewBox="0 0 20 14"><path d="M1 11 C6 2, 12 13, 19 3" fill="none" stroke="${esc(fill)}" stroke-width="${Math.min(4, Math.max(1.2, s.width || 1.5))}" stroke-linecap="round"/></svg>`;
    if (gt === 'Point') { return `<svg class="sym" viewBox="0 0 20 14">${pointSvg(s.shape, 10, 7, Math.min(12, Math.max(6, s.size || 8)), fill, stroke)}</svg>`; }
    return `<svg class="sym" viewBox="0 0 20 14"><rect x="1.5" y="1.5" width="17" height="11" rx="1" fill="${esc(fill)}" fill-opacity="${s.fillOpacity ?? 0.6}" stroke="${esc(stroke)}" stroke-width="${Math.min(2.5, Math.max(0.6, s.width ?? 1))}"/></svg>`;
  };
  function pointSvg(shape, x, y, size, fill, stroke) {
    const ctx = { d: '', beginPath() { this.d = ''; }, moveTo(a, b) { this.d += `M${a.toFixed(2)} ${b.toFixed(2)}`; }, lineTo(a, b) { this.d += `L${a.toFixed(2)} ${b.toFixed(2)}`; }, closePath() { this.d += 'Z'; }, rect(a, b, w, h) { this.d += `M${a} ${b}h${w}v${h}h${-w}Z`; }, arc(a, b, r) { this.d += `M${a - r} ${b}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`; } };
    R.marker(ctx, x, y, shape || 'circle', size); return `<path d="${ctx.d}" fill="${esc(fill)}" stroke="${esc(stroke)}" stroke-width="1"/>`;
  }
  function legendRows(L) {
    const s = L.style; if (!s || s.mode === 'single') return '';
    const items = s.mode === 'categorized' ? (s.categories || []).map(c => ({ label: c.label || c.value || '(empty)', color: c.color, off: c.visible === false })) : (s.classes || []).map((c, i, a) => ({ label: c.label, color: s.gradBy === 'size' ? s.fill : c.color, size: s.gradBy === 'size' ? (s.sizeMin ?? 4) + (a.length > 1 ? i / (a.length - 1) : 1) * ((s.sizeMax ?? 22) - (s.sizeMin ?? 4)) : null, off: c.visible === false }));
    const shown = items.slice(0, 40);
    return shown.map(it => `<div class="legend-row${it.off ? ' off' : ''}"><span></span>${A.symSVG(L, { fill: it.color, stroke: L.geomType === 'LineString' ? it.color : s.stroke, size: it.size ? Math.min(12, it.size / 1.8) : s.size })}<span class="grow">${esc(it.label)}</span></div>`).join('') + (items.length > 40 ? `<div class="legend-row"><span></span><span></span><span class="muted">… ${items.length - 40} more</span></div>` : '');
  }
  function renderLayers() {
    const box = $('layers');
    box.innerHTML = A.doc.layers.map(L => {
      const s = A.selected(L.id).size, open = A.expanded.has(L.id) || !A.expanded.has('!' + L.id);
      const hasLegend = L.style && L.style.mode !== 'single';
      return `<div class="aero-item lyr${L.id === A.active ? ' sel' : ''}${L.visible ? '' : ' hidden'}" data-id="${esc(L.id)}" draggable="true" title="${esc(L.name)} — ${L.features.length} features · ${esc(L.geomType)}${L.filter ? ' · filter: ' + esc(L.filter) : ''}">
        <span class="twist" ${hasLegend ? 'data-tw' : ''}>${hasLegend ? (open ? '▼' : '▶') : ''}</span><input type="checkbox" data-vis ${L.visible ? 'checked' : ''} title="Show / hide">${A.symSVG(L)}
        <span class="nm">${esc(L.name)}${L.filter ? ' <span class="dim">⧩</span>' : ''}${A.editTarget && A.editTarget.layer === L.id ? '<span class="edit">✎</span>' : ''}</span><span class="cnt">${s ? s + '/' : ''}${L.features.length}</span></div>` + (hasLegend && open ? legendRows(L) : '');
    }).join('') || '<div class="muted" style="padding:10px;color:var(--dim)">No layers yet. Use <b>Add data</b> or drop GeoJSON, Shapefile (.zip or .shp+.dbf+.prj), KML, GPX or CSV files on the map.</div>';
    $('layerCount').textContent = A.doc.layers.length ? A.doc.layers.length + (A.doc.layers.length === 1 ? ' layer' : ' layers') : '';
    renderQuick();
  }
  function renderQuick() {
    const L = A.activeLayer(), q = $('layerQuick');
    if (!L) { q.innerHTML = ''; q.style.display = 'none'; return; }
    q.style.display = '';
    q.innerHTML = `<span>Opacity</span><input type="range" id="qOpacity" min="0" max="100" value="${Math.round(L.opacity * 100)}"><span id="qOpV">${Math.round(L.opacity * 100)}%</span>
      <span class="full" title="${esc(String(L.sourceCrs))}">${esc(L.geomType === 'LineString' ? 'Lines' : L.geomType === 'Point' ? 'Points' : L.geomType === 'Polygon' ? 'Polygons' : 'Mixed')} · source ${esc(typeof L.sourceCrs === 'string' ? L.sourceCrs : 'custom CRS')} · ${L.fields.length} fields</span>`;
    const r = $('qOpacity'); let base = null;
    r.oninput = () => { const v = +r.value / 100; $('qOpV').textContent = r.value + '%'; if (!base) base = A.activeLayer(); A.putLayer({ ...A.activeLayer(), opacity: v }); A.render(); };
    r.onchange = () => { A.pushHistory('Layer opacity'); base = null; };
  }
  function wireLayers() {
    const box = $('layers'); let dragId = null;
    box.addEventListener('click', e => {
      const it = e.target.closest('.lyr'); if (!it) return; const id = it.dataset.id;
      if (e.target.matches('[data-vis]')) { const L = A.layer(id); A.setLayerProps(id, { visible: e.target.checked }, e.target.checked ? 'Show layer' : 'Hide layer'); void L; return; }
      if (e.target.closest('[data-tw]')) { if (A.expanded.has('!' + id)) A.expanded.delete('!' + id); else A.expanded.add('!' + id); renderLayers(); return; }
      if (A.active !== id) { A.active = id; if (A.editTarget && A.editTarget.layer !== id) A.editTarget = null; A.refreshPanels(); MapTable.refresh(); A.setTool(A.tool); }
    });
    box.addEventListener('dblclick', e => { const it = e.target.closest('.lyr'); if (it && !e.target.matches('[data-vis]')) { A.active = it.dataset.id; MapDialogs.layerProperties(it.dataset.id); } });
    box.addEventListener('dragstart', e => { const it = e.target.closest('.lyr'); if (!it) return; dragId = it.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/x-lumen-layer', dragId); });
    box.addEventListener('dragover', e => { if (!dragId) return; e.preventDefault(); e.stopPropagation(); box.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); const it = e.target.closest('.lyr'); if (!it) return; const r = it.getBoundingClientRect(); it.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after'); });
    box.addEventListener('drop', e => {
      if (!dragId) return; e.preventDefault(); e.stopPropagation();
      const it = e.target.closest('.lyr'); const src = dragId; dragId = null; if (!it || it.dataset.id === src) { renderLayers(); return; }
      const after = it.classList.contains('drop-after'); A.change('Reorder layers', () => { const a = A.doc.layers.filter(l => l.id !== src); let j = a.findIndex(l => l.id === it.dataset.id); if (after) j++; a.splice(j, 0, A.layer(src)); A.doc.layers = a; });
    });
    box.addEventListener('dragend', () => { dragId = null; box.querySelectorAll('.drop-before,.drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); });
    const bar = $('layerBar'), btn = (t, svg, fn) => { const b = document.createElement('button'); b.className = 'aero-iconbtn'; b.title = t; b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#1e395b" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${svg}</svg>`; b.onclick = fn; bar.appendChild(b); };
    btn('Add data…', '<path d="M12 5v14M5 12h14"/>', () => A.openData());
    btn('New empty layer…', '<path d="M4 7l8-4 8 4-8 4z"/><path d="M4 12l8 4 8-4M17 17h5M19.5 14.5v5"/>', () => MapDialogs.newLayer());
    btn('Remove layer', '<path d="M5 12h14"/>', () => A.active && A.removeLayer(A.active));
    btn('Move up', '<path d="M12 19V5M6 11l6-6 6 6"/>', () => A.active && A.moveLayer(A.active, -1));
    btn('Move down', '<path d="M12 5v14M6 13l6 6 6-6"/>', () => A.active && A.moveLayer(A.active, 1));
    btn('Zoom to layer', '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5 20 20"/><rect x="8" y="8" width="6" height="6"/>', () => A.zoomToLayer());
    btn('Layer properties (symbology, labels, filter)…', '<circle cx="8" cy="8" r="3.5"/><path d="M14 6h7M14 11h7M3 16h18M3 20h12"/>', () => A.active && MapDialogs.layerProperties(A.active));
    btn('Open attribute table', '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M3 9h18M3 14h18M9 4v16"/>', () => MapTable.show(true));
  }
  A.refreshPanels = () => { renderLayers(); statusSel(); };
  function statusSel() {
    let n = 0; A.sel.forEach(s => n += s.size);
    $('st2').textContent = n ? `${n} selected` : '';
    const L = A.activeLayer(); $('st4').textContent = L ? `Active: ${L.name}` : '';
  }
  A.renderAll = () => { A.render(); A.refreshPanels(); MapTable.refresh(); };

  // ---------- empty state ----------
  function renderEmpty() {
    $('empty').innerHTML = `<div class="card"><h2>Start a map</h2>Lumen Map works offline: there is no basemap, just a graticule and your own data.<br>Drop <b>GeoJSON</b>, <b>Shapefiles</b> (.zip, or .shp + .dbf + .prj together), <b>KML/KMZ</b>, <b>GPX</b> or <b>CSV</b> with latitude/longitude columns anywhere on this window.<div class="row"><button class="aero-btn pri" id="eAdd">Add data…</button><button class="aero-btn" id="eSample">Open sample map</button><button class="aero-btn" id="eNew">New empty layer…</button></div></div>`;
    $('eAdd').onclick = () => A.openData(); $('eSample').onclick = () => A.openSample(); $('eNew').onclick = () => MapDialogs.newLayer();
  }

  // ---------- wiring ----------
  let spaceDown = false;
  A.init = () => {
    setupTools(); wireLayers(); renderEmpty();
    stage.addEventListener('pointerdown', onDown);
    stage.addEventListener('pointermove', onMove);
    stage.addEventListener('pointerup', onUp);
    stage.addEventListener('pointercancel', () => { drag = null; rubber = null; panImg = null; A.renderNow(); });
    stage.addEventListener('contextmenu', e => e.preventDefault());
    stage.addEventListener('dblclick', e => e.preventDefault());
    stage.addEventListener('pointerleave', () => { if (sketch.hover) { sketch.hover = null; drawOverlay(); } });
    let wheelT = null;
    stage.addEventListener('wheel', e => {
      e.preventDefault(); const r = stage.getBoundingClientRect(), f = Math.pow(1.0018, -e.deltaY * (e.deltaMode ? 30 : 1));
      A.zoomBy(f, e.clientX - r.left, e.clientY - r.top); clearTimeout(wheelT);
    }, { passive: false });
    new ResizeObserver(() => resize()).observe(stage);
    document.addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('input,textarea,select') || document.querySelector('.aero-modal,.pl-modal')) return;
      if (e.key === ' ' && !spaceDown) { spaceDown = true; stage.style.cursor = 'grab'; }
      if (e.key === 'Escape') { if (sketch.pts.length || sketch.done) { clearSketch(); sketch.done = false; snapPt = null; drawOverlay(); A.showInfo(null); } else if (A.editTarget) { A.editTarget = null; drawOverlay(); renderLayers(); } }
      if (e.key === 'Enter' && sketch.kind) finishSketch();
      if (e.key === 'Backspace' && sketch.pts.length) { e.preventDefault(); sketch.pts.pop(); drawOverlay(); if (sketch.kind === 'measure' || sketch.kind === 'area') A.showInfo(measureInfo(), 'Measure'); }
      const pan = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
      if (pan && !e.ctrlKey && !e.altKey) { e.preventDefault(); A.view.cx += pan[0] * W * 0.2 * A.view.res; A.view.cy += pan[1] * H * 0.2 * A.view.res; A.render(); }
    });
    document.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; stage.style.cursor = ''; } });
    $('crsSel').onchange = () => { const v = $('crsSel').value; if (v === 'custom') return; const old = A.doc.crs; A.change('Change map CRS', () => A.setCRS(v)); void old; };
    $('scaleIn').addEventListener('keydown', e => { if (e.key === 'Enter') { const n = +String($('scaleIn').value).replace(/[^\d.]/g, ''); if (n > 0) A.setScale(n); $('scaleIn').blur(); } e.stopPropagation(); });
    $('scaleIn').addEventListener('blur', updateScale);
    // splitters
    const dragSplit = (el, fn) => el.addEventListener('pointerdown', e => { e.preventDefault(); const mv = ev => fn(ev); const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); resize(); MapTable.refresh(); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); });
    dragSplit($('vsplit'), e => { const r = $('work').getBoundingClientRect(); $('work').style.setProperty('--side-w', Aero.clamp(e.clientX - r.left, 180, 480) + 'px'); });
    dragSplit($('hsplit'), e => { const r = $('main').getBoundingClientRect(); $('main').style.setProperty('--table-h', Aero.clamp(r.bottom - e.clientY, 80, r.height - 120) + 'px'); });
    resize(true);
  };
})();
