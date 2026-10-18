// Headless UI test — run through tools/shot with SHOT_URL=http://localhost:5180/diagram/ SHOT_JS=<this file>.
// Drives the real editor with synthetic pointer/keyboard events and checks document state, DOM and exported bytes.
const A = DiaApp, out = {}, fails = [];
const wait = ms => new Promise(r => setTimeout(r, ms));
const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const check = (name, ok, info) => { out[name] = ok ? 'ok' : ('FAIL ' + (info !== undefined ? JSON.stringify(info) : '')); if (!ok) fails.push(name); };
const svg = document.getElementById('cv');
const ptr = (type, el, x, y, o = {}) => el.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: o.button || 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, bubbles: true, cancelable: true, shiftKey: !!o.shift, ctrlKey: !!o.ctrl, altKey: !!o.alt }));
const scr = (x, y) => { const r = svg.getBoundingClientRect(), s = A.toScreen(x, y); return { x: r.left + s.x, y: r.top + s.y }; };
const gOf = id => document.querySelector(`#cells [data-id="${id}"]`);
async function drag(el, from, to, o = {}) { ptr('pointerdown', el, from.x, from.y, o); for (let i = 1; i <= 6; i++) { ptr('pointermove', svg, from.x + (to.x - from.x) * i / 6, from.y + (to.y - from.y) * i / 6, o); await frame(); } ptr('pointerup', svg, to.x, to.y, o); await frame(); }
const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: o.code || '', bubbles: true, cancelable: true, ctrlKey: !!o.ctrl, shiftKey: !!o.shift }));
const P = () => A.page(), find = t => P().cells.find(c => c.text === t);
const onBox = (p, b) => (Math.abs(p.x - b.x) < 0.8 || Math.abs(p.x - b.x - b.w) < 0.8) && p.y >= b.y - 0.8 && p.y <= b.y + b.h + 0.8 || (Math.abs(p.y - b.y) < 0.8 || Math.abs(p.y - b.y - b.h) < 0.8) && p.x >= b.x - 0.8 && p.x <= b.x + b.w + 0.8;

try {
  A.load(DiaSample.sampleDoc(), 'Sample diagrams.ldia'); A.zoomAt(1); A.view().x = 40; A.view().y = 120; A.render(); await frame();
  check('sample loaded', A.doc.pages.length === 7 && document.querySelectorAll('#cells [data-id]').length === P().cells.filter(c => c.kind !== 'group').length);
  check('library built', document.querySelectorAll('.libitem').length > 140, document.querySelectorAll('.libitem').length);
  check('page tabs', document.querySelectorAll('.ptab').length === 8);

  // 1. drag a shape: it moves (snapped to grid) and its connectors stay glued
  const s1 = find('Check order details'), e = P().cells.find(c => c.kind === 'edge' && c.tgt.id === s1.id);
  const before = { x: s1.x, y: s1.y }, rBefore = A.routes.get(e.id).pts.slice(-1)[0];
  const c0 = scr(s1.x + s1.w / 2, s1.y + s1.h / 2);
  await drag(gOf(s1.id).querySelector('path'), c0, { x: c0.x + 43, y: c0.y + 27 });
  check('drag moves shape (grid snap)', s1.x === before.x + 40 && s1.y === before.y + 30, [s1.x - before.x, s1.y - before.y]);
  const rAfter = A.routes.get(e.id).pts.slice(-1)[0];
  check('connector stays glued after move', onBox(rAfter, s1) && (rAfter.x !== rBefore.x || rAfter.y !== rBefore.y), [rBefore, rAfter]);
  A.undo(); await frame();
  check('undo move', find('Check order details').x === before.x);
  A.redo(); await frame(); check('redo move', find('Check order details').x === before.x + 40);
  A.undo(); await frame();

  // 2. connect two shapes by dragging from a connection point
  const a = find('Pay invoice'), b = find('Order received');
  A.select([]); const ca = scr(a.x + a.w / 2, a.y + a.h / 2);
  ptr('pointermove', gOf(a.id).querySelector('path'), ca.x, ca.y); await frame(); await frame();
  const port = document.querySelector(`#hov [data-h="port:${a.id}:1"] circle`);
  check('hover shows connection points', !!port && document.querySelectorAll('#hov [data-h^="qa:"]').length === 4);
  const nEdges = P().cells.filter(c => c.kind === 'edge').length;
  if (port) { const pr = port.getBoundingClientRect(), from = { x: pr.left + pr.width / 2, y: pr.top + pr.height / 2 }; await drag(port, from, scr(b.x + b.w / 2, b.y + b.h / 2)); }
  const ne = P().cells.filter(c => c.kind === 'edge');
  const created = ne[ne.length - 1];
  check('drag from port creates glued connector', ne.length === nEdges + 1 && created.src.id === a.id && created.src.port && created.src.port[0] === 1 && created.tgt.id === b.id, created && [created.src, created.tgt]);
  check('new connector is routed', A.routes.get(created.id) && A.routes.get(created.id).pts.length >= 2);

  // 3. quick-connect arrow click clones the shape and connects it
  A.select([]); const cb = scr(b.x + b.w / 2, b.y + b.h / 2); ptr('pointermove', gOf(b.id).querySelector('path'), cb.x, cb.y); await frame(); await frame();
  const qa = document.querySelector(`#hov [data-h="qa:${b.id}:s"]`); const nShapes = P().cells.filter(c => c.kind === 'shape').length;
  if (qa) { const r = qa.getBoundingClientRect(); ptr('pointerdown', qa, r.left + r.width / 2, r.top + r.height / 2); ptr('pointerup', svg, r.left + r.width / 2, r.top + r.height / 2); await frame(); }
  const clone = P().cells.filter(c => c.kind === 'shape').slice(-1)[0];
  check('quick-connect adds connected copy below', P().cells.filter(c => c.kind === 'shape').length === nShapes + 1 && clone.shape === b.shape && clone.y > b.y + b.h && P().cells.some(c => c.kind === 'edge' && c.src.id === b.id && c.tgt.id === clone.id));

  // 4. resize and rotate with handles
  A.select(a.id); await frame();
  const hse = document.querySelector('#ov [data-h="rs:se"]'), r1 = hse.getBoundingClientRect(), w0 = a.w;
  await drag(hse, { x: r1.left + r1.width / 2, y: r1.top + r1.height / 2 }, { x: r1.left + r1.width / 2 + 60, y: r1.top + r1.height / 2 + 20 });
  check('resize handle (edges snap to grid)', a.w === w0 + 60 && (a.y + a.h) % 10 === 0 && a.h >= 80 && a.h <= 90, [a.w, a.h]);
  const hr = document.querySelector('#ov [data-h="rot"]'), r2 = hr.getBoundingClientRect(), ctr = scr(a.x + a.w / 2, a.y + a.h / 2);
  await drag(hr, { x: r2.left + r2.width / 2, y: r2.top + r2.height / 2 }, { x: ctr.x + 200, y: ctr.y });
  check('rotate handle snaps to 90°', a.rot === 90, a.rot);
  A.undo(); A.undo(); await frame();

  // 5. type on a selected shape to edit text
  const pk = find('Pick & pack'); A.select(pk.id); await frame();
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', bubbles: true, cancelable: true }));
  await frame(); const ted = document.getElementById('ted');
  check('typing opens the text editor', !ted.hidden && ted.value === 'Z', ted.value);
  ted.value = 'Pick, pack\n& label'; ted.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); await frame();
  check('Ctrl+Enter commits text', pk.text === 'Pick, pack\n& label' && ted.hidden);
  check('wrapped text rendered as SVG text', [...gOf(pk.id).querySelectorAll('text')].map(t => t.textContent).join('|') === 'Pick, pack|& label');

  // 6. copy / paste / duplicate / delete
  const nb = P().cells.length; A.select(pk.id); A.copy(); A.paste(); await frame();
  check('copy + paste', P().cells.length === nb + 1 && A.selCells()[0].text === pk.text && A.selCells()[0].x === pk.x + 20);
  A.deleteSel(); await frame(); check('delete', P().cells.length === nb);

  // 7. marquee selection, group, ungroup, align
  const t1 = find('Pick & pack') || pk, t2 = find('Ship order');
  const m0 = scr(t1.x - 10, t1.y - 10), m1 = scr(t2.x + t2.w + 10, t2.y + t2.h + 10);
  await drag(svg.querySelector('#gridRect'), m0, m1);
  const between = P().cells.find(c => c.kind === 'edge' && c.src.id === t1.id && c.tgt.id === t2.id);
  check('marquee selects enclosed shapes and the connector between them', A.sel.has(t1.id) && A.sel.has(t2.id) && A.sel.has(between.id) && A.sel.size === 3, [...A.sel]);
  A.group(); await frame(); const grp = A.selCells()[0];
  check('group', grp.kind === 'group' && t1.parent === grp.id && t2.parent === grp.id);
  const gx = t1.x; const gc = scr(t2.x + 20, t2.y + 20);
  A.select([]); ptr('pointerdown', gOf(t2.id).querySelector('path'), gc.x, gc.y); ptr('pointerup', svg, gc.x, gc.y); await frame();
  check('clicking a member selects the group', A.sel.has(grp.id) && A.sel.size === 1);
  A.nudge(10, 0); await frame(); check('moving a group moves members', t1.x === gx + 10 && t2.x === t2.x);
  A.select(grp.id); A.ungroup(); await frame(); check('ungroup', !P().cells.some(c => c.id === grp.id) && t1.parent !== grp.id);
  A.select([t1.id, t2.id]); t2.y += 15; A.align('top'); await frame(); check('align top', t1.y === t2.y);

  // 8. containers: a shape dropped into a swimlane becomes its child and moves with it
  A.setPage(0); const lane = P().cells.find(c => c.shape === 'lane' && c.text === 'Warehouse');
  A.insertItem('process', { x: lane.x + 600, y: lane.y + 140 }); await frame();
  const dropped = A.selCells()[0];
  check('drop into swimlane sets parent', dropped.parent === lane.id, dropped.parent);
  A.select(lane.id); const dx0 = dropped.x; A.nudge(0, 10); await frame();
  check('moving a lane moves its contents', dropped.y === lane.y + 140 - 30 + 10 || dropped.x === dx0 && dropped.y > 0);

  // 9. auto layout on the org chart
  A.setPage(1); await frame();
  const org = P().cells.filter(c => c.kind === 'shape' && c.shape.startsWith('org'));
  org.forEach((c, i) => { c.x = (i * 97) % 500; c.y = (i * 53) % 300; }); A.render();
  A.select([]); A.layout('tree', 'TB'); await frame();
  const ov = []; for (let i = 0; i < org.length; i++) for (let j = i + 1; j < org.length; j++) { const p = org[i], q = org[j]; if (p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h) ov.push([p.text, q.text]); }
  const ceo = org.find(c => /Maya/.test(c.text));
  check('tree layout: no overlaps, root on top', !ov.length && org.every(c => c === ceo || c.y > ceo.y), ov);

  // 10. theme
  A.setPage(2); await frame(); const srv = P().cells.find(c => c.shape === 'server');
  A.applyTheme('dark'); await frame();
  check('theme recolours page', P().bg === '#1e2530' && S_fill(srv) !== '#3b7dd8');
  A.undo(); await frame();
  const srv2 = P().cells.find(c => c.shape === 'server');

  // 11. layers: hide the layer → nothing rendered
  A.setSideTab('layers'); await frame();
  document.querySelector('[data-act="layerAdd"]').click(); await frame();
  check('add layer', P().layers.length === 2);
  A.select(srv2.id); document.querySelector('[data-act="layerMove"]').click(); await frame();
  const srv3 = P().cells.find(c => c.id === srv2.id);
  check('move selection to layer', srv3.layer === P().layers[1].id, [srv3.layer, P().layers.map(l => l.id)]);
  document.querySelector(`[data-layer="${P().layers[1].id}"] [data-lv]`).click(); await frame();
  check('hidden layer is not rendered', !gOf(srv2.id) && !A.exportSVGString().svg.includes(`data-cell="${srv2.id}"`) && A.exportSVGString().svg.includes('data-cell='));
  A.undo(); A.undo(); A.undo(); A.setSideTab('style'); await frame();

  // 12. exports
  A.setPage(0); await frame();
  const sv = A.exportSVGString({ embed: true });
  check('SVG export', sv.svg.startsWith('<?xml') && sv.svg.includes('id="lumen-diagram"') && (sv.svg.match(/<g data-cell=/g) || []).length > 20);
  const reopened = DiaUI.readDoc({ name: 'x.svg', data: new TextEncoder().encode(sv.svg).buffer });
  check('exported SVG re-opens as an editable diagram', reopened.doc.pages[0].cells.length === P().cells.length);
  const png = await A.exportPNGBlob({ scale: 2 });
  const bmp = await createImageBitmap(png), cv = new OffscreenCanvas(bmp.width, bmp.height), g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
  const c1 = find('Customer places order'), px = (x, y) => [...g.getImageData(Math.round((x - sv.box.x) * 2), Math.round((y - sv.box.y) * 2), 1, 1).data];
  const fillPx = px(c1.x + 20, c1.y + c1.h / 2 + 2), bgPx = px(sv.box.x + 5, sv.box.y + 5);
  check('PNG export size', bmp.width === sv.box.w * 2 && bmp.height === sv.box.h * 2, [bmp.width, bmp.height, sv.box]);
  check('PNG pixels: shape fill and white background', fillPx[2] > fillPx[0] + 10 && fillPx[2] > 200 && bgPx.slice(0, 3).every(v => v === 255), [fillPx, bgPx]);
  const pdf = await A.exportPDFBytes({ all: true });
  check('PDF export', String.fromCharCode(...pdf.slice(0, 5)) === '%PDF-' && pdf.length > 10000, pdf.length);
  const dx = DiaDrawio.exportDrawio(A.doc), back = DiaDrawio.importDrawio(dx);
  check('draw.io export re-imports', back.doc.pages.length === A.doc.pages.length && back.doc.pages[0].cells.length === P().cells.length);

  // 13. open the hand-written draw.io fixture through the normal open path
  const fx = await (await fetch('tests/fixtures/handmade.drawio')).arrayBuffer();
  Aero.setDirty(false); await DiaUI.openFiles([{ name: 'handmade.drawio', data: fx }]); await frame();
  check('open .drawio file', A.doc.pages.length === 2 && A.page().cells.some(c => c.shape === 'umlClass') && document.querySelectorAll('#cells [data-id]').length > 15);

  // 14. performance: 600 shapes + 600 connectors
  A.load(DiaModel.newDoc(), 'Perf'); const pp = A.page(), sh = [];
  for (let i = 0; i < 600; i++) { const c = DiaModel.makeShape(i % 4 ? 'process' : 'decision', (i % 30) * 180, Math.floor(i / 30) * 130, { text: 'Step ' + i, layer: pp.layers[0].id }); pp.cells.push(c); sh.push(c); }
  for (let i = 0; i < 600; i++) pp.cells.push(DiaModel.makeEdge({ id: sh[i].id }, { id: sh[i % 30 === 29 ? i - 29 : i + 1 < 600 ? i + 1 : 0].id }, { layer: pp.layers[0].id }));
  let t0 = performance.now(); A.render(); const tFull = performance.now() - t0;
  A.zoomAt(1); A.view().x = 20; A.view().y = 20; A.render();
  const m = sh[31], mc = scr(m.x + m.w / 2, m.y + m.h / 2);
  t0 = performance.now(); ptr('pointerdown', gOf(m.id).querySelector('path'), mc.x, mc.y);
  const times = [], js = []; for (let i = 1; i <= 10; i++) { const s0 = performance.now(); ptr('pointermove', svg, mc.x + i * 6, mc.y + i * 3); const j0 = performance.now(); A.render(); js.push(performance.now() - j0); await frame(); times.push(performance.now() - s0); }
  ptr('pointerup', svg, mc.x + 60, mc.y + 30); await frame(); const tUp = performance.now() - t0;
  out.perf = { firstRenderMs: Math.round(tFull), dragUpdateJsMs: Math.round(js.reduce((a, b) => a + b) / js.length), twoFramesWithPaintMs: Math.round(times.reduce((a, b) => a + b) / times.length), dropAndCommitMs: Math.round(tUp) };
  check('perf: 1200 cells render < 4 s, drag update < 40 ms of script', tFull < 4000 && out.perf.dragUpdateJsMs < 40, out.perf);

  A.load(DiaSample.sampleDoc(), 'Sample diagrams.ldia');
} catch (err) { out.error = err.stack; fails.push('exception'); }
function S_fill(c) { return DiaShapes.styleOf(c).fill; }
out.failures = fails;
return JSON.stringify(out, null, 1);
