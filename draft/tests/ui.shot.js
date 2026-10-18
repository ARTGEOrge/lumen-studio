// Headless UI test — run with tools/shot:  SHOT_URL=http://localhost:5180/draft/ SHOT_JS=<this file>
// Drives the real command line and pointer events, then checks the resulting document.
const A = window.LDApp, E = A.E, V = A.V, G = window.LDGeom, M = window.LDModel;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ov = document.getElementById('ov');
const res = [], fail = [];
const ok = (name, cond, info) => { (cond ? res : fail).push(name + (cond ? '' : ' — ' + JSON.stringify(info))); };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
async function type(...ts) { for (const t of ts) { E.input(t); await sleep(15); } }
function at(wx, wy) { const r = ov.getBoundingClientRect(), [sx, sy] = V.w2s(wx, wy); return { clientX: r.left + sx, clientY: r.top + sy }; }
function ptr(kind, p, extra = {}) { ov.dispatchEvent(new PointerEvent(kind, { ...p, bubbles: true, pointerId: 1, button: 0, ...extra })); }
async function click(wx, wy, extra = {}) { const p = at(wx, wy); ptr('pointermove', p, extra); ptr('pointerdown', p, extra); ptr('pointerup', p, extra); await sleep(15); }
async function move(wx, wy) { ptr('pointermove', at(wx, wy)); await sleep(10); }
async function drag(a, b) { ptr('pointermove', at(...a)); ptr('pointerdown', at(...a)); await sleep(5); ptr('pointermove', at(...b)); ptr('pointerup', at(...b)); await sleep(15); }
const ents = t => A.doc.ents.filter(e => !t || e.type === t);
async function fresh() { A.doc = M.newDoc(); A.selSet = new Set(); V.invalidate(); V.zoomBox([-20, -20, 140, 80]); A.osnapOn = false; A.polar = false; A.ortho = false; await sleep(10); }
const tStart = performance.now();

// ---------- LINE with absolute, relative and polar coordinates; Close; undo/redo ----------
await fresh();
await type('LINE', '0,0', '100,0', '@0,50', '@100<180', 'C');
let L = ents('line');
ok('LINE draws 4 segments', L.length === 4, L.length);
ok('relative @0,50 → (100,50)', near(L[1].x2, 100) && near(L[1].y2, 50), L[1]);
ok('polar @100<180 → (0,50)', near(L[2].x2, 0, 1e-9) && near(L[2].y2, 50, 1e-9), L[2]);
ok('Close returns to the first point', near(L[3].x2, 0) && near(L[3].y2, 0), L[3]);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true })); await sleep(20);
ok('Ctrl+Z undoes the whole LINE command', ents('line').length === 0, ents().length);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true })); await sleep(20);
ok('Ctrl+Y redoes it', ents('line').length === 4);

// ---------- Enter repeats; direct distance with ortho ----------
await type('L', '200,0'); A.ortho = true; await move(260, 7); await type('30', '');
const dd = ents('line').at(-1);
ok('direct distance entry along ortho direction', near(dd.x2, 230) && near(dd.y2, 0), dd);
A.ortho = false;

// ---------- CIRCLE, OFFSET (picking with the mouse) ----------
await type('C', '50,25', '10');
const c0 = ents('circle')[0]; ok('CIRCLE centre/radius', c0 && near(c0.r, 10) && near(c0.cx, 50));
await type('O', '5'); await click(60, 25); await click(80, 25); await type('');
const cs = ents('circle'); ok('OFFSET outward makes r=15', cs.length === 2 && near(cs[1].r, 15), cs.map(c => c.r));
// ---------- TRIM inside the circle ----------
await type('L', '-20,25', '120,25', '');
const hl = ents('line').at(-1);
await type('TR'); await click(50, 25); await type('');
const pieces = ents('line').filter(l => near(l.y1, 25) && near(l.y2, 25));
ok('TRIM removes the piece between the nearest cutting edges (inner r=10 circle)', pieces.length === 2 && pieces.some(p => near(Math.max(p.x1, p.x2), 40, 1e-6)) && pieces.some(p => near(Math.min(p.x1, p.x2), 60, 1e-6)), pieces.map(p => [p.x1, p.x2]));
// trim the outer stubs against the rectangle sides
await type('TR'); await click(-10, 25); await type('');
ok('TRIM removes the end beyond x=0', ents('line').filter(l => near(l.y1, 25)).every(l => Math.min(l.x1, l.x2) >= -1e-9));
// ---------- EXTEND: short line up to the top edge ----------
await type('L', '20,5', '20,20', ''); await type('EX'); await click(20, 18); await type('');
const ex = ents('line').find(l => near(l.x1, 20) && near(l.x2, 20));
ok('EXTEND reaches the next boundary (y=25 line)', ex && near(Math.max(ex.y1, ex.y2), 25), ex);
// ---------- FILLET two lines at the rectangle corner ----------
await type('F', 'R', '5'); await click(30, 0); await click(0, 30);
const arcs = ents('arc'); ok('FILLET r=5 adds a tangent arc', arcs.length === 1 && near(arcs[0].r, 5) && near(arcs[0].cx, 5) && near(arcs[0].cy, 5), arcs);
// ---------- CHAMFER the opposite corner ----------
await type('CHA', 'D', '4', '6'); await click(90, 0); await click(100, 10);
const ch = ents('line').find(l => near(Math.min(l.x1, l.x2), 96) && near(Math.max(l.y1, l.y2), 6));
ok('CHAMFER 4 × 6', !!ch, ents('line').map(l => [l.x1, l.y1, l.x2, l.y2].map(v => +v.toFixed(2))));

// ---------- object snaps ----------
A.osnapOn = true; await type('L'); await move(100.6, 49.4);
ok('endpoint snap', A.snapHit && A.snapHit.k === 'end' && near(A.snapHit.x, 100) && near(A.snapHit.y, 50), A.snapHit);
await move(50.4, 50.3); ok('midpoint snap', A.snapHit && A.snapHit.k === 'mid' && near(A.snapHit.x, 50), A.snapHit);
await move(50, 40.2); ok('quadrant snap', A.snapHit && A.snapHit.k === 'quad' && near(A.snapHit.y, 40), A.snapHit);
await type('-40,60'); { const tp = G.tangentPts(G.A(50, 25, 15, 0, G.TAU), -40, 60).sort((a, b) => b[1] - a[1])[0]; await move(tp[0] + 0.15, tp[1] - 0.1);
ok('tangent snap from the base point', A.snapHit && A.snapHit.k === 'tan' && near(A.snapHit.x, tp[0], 1e-6), [A.snapHit, tp]); }
E.cancel(); await sleep(20);
await type('L', '30,80'); await move(30.2, 50.3);
ok('perpendicular snap from the base point', A.snapHit && A.snapHit.k === 'perp' && near(A.snapHit.x, 30) && near(A.snapHit.y, 50), A.snapHit);
E.cancel(); await sleep(20);
await type('L'); await move(65.2, 25.3); ok('intersection snap (circle × line)', A.snapHit && A.snapHit.k === 'int' && near(A.snapHit.x, 65, 1e-6), A.snapHit);
E.cancel(); await sleep(20);
A.osnapOn = false;
// polar tracking
A.polar = true; A.polarInc = 30; await type('L', '300,0'); await move(343, 25.5);
ok('polar tracking locks to 30°', A.track && near(A.track[1], Math.PI / 6, 1e-9), A.trackTip);
await type('50'); await type('');
const pl30 = ents('line').at(-1); ok('typed distance along polar 30°', near(pl30.x2, 300 + 50 * Math.cos(Math.PI / 6)) && near(pl30.y2, 25), pl30);
A.polar = false;

// ---------- HATCH by picking inside the rectangle (with the circle island) ----------
A.hatch = { pat: 'ANSI31', sc: 1, ang: 0 };
await type('H'); await click(80, 40); await type('');
const h = ents('hatch')[0];
ok('HATCH finds the enclosed region', !!h && h.loops.length >= 1, h && h.loops.length);
// ---------- window selection + ERASE ----------
await fresh(); await type('REC', '0,0', '50,30'); await type('C', '100,15', '10'); await type('C', '200,15', '10');
await drag([-5, -5], [120, 40]);
ok('window (left→right) selects fully enclosed objects', A.selSet.size === 2, A.selSet.size);
A.selSet = new Set(); await drag([190, 40], [150, 10]);
ok('crossing (right→left) selects touched objects', A.selSet.size === 1, A.selSet.size);
await type('E'); ok('ERASE removes the pre-selection', ents().length === 2);

// ---------- MOVE / COPY / ROTATE / SCALE / MIRROR / ARRAY ----------
await fresh(); await type('L', '0,0', '10,0', '');
A.selSet = new Set([ents()[0].id]); await type('M', '0,0', '5,5');
let ln = ents()[0]; ok('MOVE by base/second point', near(ln.x1, 5) && near(ln.y1, 5) && near(ln.x2, 15));
A.selSet = new Set([ln.id]); await type('CO', '5,5', '5,15', '5,25', '');
ok('COPY multiple', ents('line').length === 3);
A.selSet = new Set([ents()[0].id]); await type('RO', '5,5', '90');
ln = ents()[0]; ok('ROTATE 90°', near(ln.x2, 5) && near(ln.y2, 15), ln);
A.selSet = new Set([ents()[0].id]); await type('SC', '5,5', '2');
ln = ents()[0]; ok('SCALE ×2', near(ln.y2, 25), ln);
A.selSet = new Set([ents()[1].id]); await type('MI', '0,0', '0,10', 'N');
const mi = ents().at(-1); ok('MIRROR copy about the Y axis', near(mi.x1, -5) && near(mi.x2, -15) && ents().length === 4, mi);
await type('C', '50,0', '2'); A.selSet = new Set([ents().at(-1).id]); await type('AR', 'P', '0,0', '6', '360', 'Y');
ok('polar ARRAY of 6', ents('circle').length === 6);
const cAng = ents('circle').map(c => Math.atan2(c.cy, c.cx) * 180 / Math.PI).map(a => Math.round((a + 360) % 360)).sort((a, b) => a - b);
ok('polar ARRAY positions every 60°', JSON.stringify(cAng) === '[0,60,120,180,240,300]', cAng);
A.selSet = new Set([ents('circle')[0].id]); await type('AR', 'R', '2', '3', '10', '20');
ok('rectangular ARRAY 2×3', ents('circle').length === 6 + 5);

// ---------- PLINE with arc segment, EXPLODE, JOIN ----------
await fresh(); await type('PL', '0,0', '20,0', 'A', '20,20', 'L', '0,20', 'C');
const pl = ents('pline')[0]; ok('PLINE line+arc+close', pl && pl.closed && pl.pts.length === 4 && near(pl.pts[1][2], 1, 1e-9), pl && pl.pts);
ok('PLINE tangent arc area', pl && near(Math.abs(G.loopArea(pl.pts)), 400 + Math.PI * 50, 1e-6), pl && G.loopArea(pl.pts));
A.selSet = new Set([pl.id]); await type('X');
ok('EXPLODE polyline → 3 lines + 1 arc', ents('line').length === 3 && ents('arc').length === 1, ents().map(e => e.type));
await type('J', 'ALL', '');
const jp = ents('pline')[0]; ok('JOIN chains them back into one closed polyline', ents().length === 1 && jp && jp.closed && near(Math.abs(G.loopArea(jp.pts)), 400 + Math.PI * 50, 1e-6), ents().map(e => e.type));
// FILLET Polyline option on a rectangle
await fresh(); await type('REC', '0,0', '100,50'); await type('F', 'R', '10', 'P'); await click(50, 0);
const rf = ents('pline')[0]; ok('FILLET Polyline rounds 4 corners', rf.pts.length === 8 && near(G.loopArea(rf.pts), 5000 - 4 * (100 - 25 * Math.PI), 1e-6));

// ---------- TEXT, MTEXT (dialog), DIMLINEAR / DIMRADIUS / DIMANGULAR ----------
await fresh(); await type('DT', '0,0', '5', '0', 'Hello world', 'Line two', '');
const tx = ents('text'); ok('TEXT creates lines with typed spaces', tx.length === 2 && tx[0].s === 'Hello world' && near(tx[1].y, -5 * 1.667, 1e-9), tx);
await type('DLI', '0,0', '40,30', '20,-10');
let dm = ents('dim')[0]; ok('DIMLINEAR horizontal = 40', dm && M.dimText(dm, A.doc.dimstyle) === '40', dm);
await type('DLI', '0,0', '40,30', '60,15');
dm = ents('dim')[1]; ok('DIMLINEAR auto-vertical = 30', dm && M.dimText(dm, A.doc.dimstyle) === '30', dm && M.dimText(dm, A.doc.dimstyle));
await type('DAL', '0,0', '40,30', '10,20');
ok('DIMALIGNED = 50', M.dimText(ents('dim')[2], A.doc.dimstyle) === '50');
await type('C', '100,0', '12.5'); await type('DRA'); await click(112.5, 0); await type('130,10');
ok('DIMRADIUS R12.5', M.dimText(ents('dim')[3], A.doc.dimstyle) === 'R12.5', M.dimText(ents('dim')[3], A.doc.dimstyle));
await type('DAN', '', '0,0', '10,0', '10,10', '8,3');
ok('DIMANGULAR 45°', M.dimText(ents('dim')[4], A.doc.dimstyle) === '45°', ents('dim')[4]);
await type('MT', '0,50', '60,30'); await sleep(30);
let dlg = document.querySelector('.aero-modal textarea'); ok('MTEXT opens the text editor', !!dlg);
if (dlg) { dlg.value = 'Line A\nLine B'; dlg.dispatchEvent(new Event('input')); document.querySelector('.aero-modal [data-a=o]').click(); await sleep(30); }
const mt = ents('mtext')[0]; ok('MTEXT created with two lines', mt && mt.s === 'Line A\nLine B' && near(mt.w, 60));

// ---------- BLOCK / INSERT ----------
await fresh(); await type('C', '0,0', '5'); await type('L', '-8,0', '8,0', '');
await type('B'); await sleep(20);
let inp = document.querySelector('.aero-modal input'); if (inp) { inp.value = 'BOLT'; inp.dispatchEvent(new Event('input')); document.querySelector('.aero-modal [data-a=o]').click(); }
await sleep(30); await type('0,0', 'ALL', '');
ok('BLOCK replaces the objects with an insert', A.doc.blocks.BOLT && A.doc.blocks.BOLT.ents.length === 2 && ents().length === 1 && ents()[0].type === 'insert', Object.keys(A.doc.blocks));
await type('I'); await sleep(20); document.querySelector('.aero-modal [data-a=o]').click(); await sleep(20); await type('50,50');
const ins = ents('insert'); ok('INSERT places a second reference', ins.length === 2 && near(ins[1].x, 50));
A.osnapOn = true; await type('L'); await move(55.3, 0.2 + 50); ok('snaps work inside block references', A.snapHit && (A.snapHit.k === 'quad' || A.snapHit.k === 'end' || A.snapHit.k === 'int') && near(A.snapHit.x, 55), A.snapHit); E.cancel(); await sleep(20); A.osnapOn = false;

// ---------- DIST / AREA / MEASURE ----------
await type('DI', '0,0', '30,40'); ok('DIST = 50', A.lastMeasure && near(A.lastMeasure.d, 50));
await type('AA', '0,0', '10,0', '10,10', '0,10', ''); ok('AREA of points = 100', near(A.lastArea, 100));
await fresh(); await type('L', '0,0', '100,0', ''); await type('ME'); await click(50, 0); await type('30');
ok('MEASURE places points every 30', ents('point').length === 3 && near(ents('point')[2].x, 90));
await type('DIV'); await click(50, 0); await type('4'); ok('DIVIDE into 4 → 3 more points', ents('point').length === 6);

// ---------- grips ----------
await fresh(); await type('L', '0,0', '10,0', ''); A.selSet = new Set([ents()[0].id]); V.draw();
await click(10, 0); await click(20, 5);
ln = ents()[0]; ok('grip stretch moves the endpoint', near(ln.x2, 20) && near(ln.y2, 5), ln);

// ---------- properties palette ----------
await fresh(); await type('C', '0,0', '5'); A.selSet = new Set([ents()[0].id]); A.V.draw();
const tgl = () => A.refresh(); tgl(); await sleep(20);
const rIn = [...document.querySelectorAll('#props [data-f=r]')][0];
ok('properties palette shows radius', !!rIn);
if (rIn) { rIn.value = '7.5'; rIn.dispatchEvent(new Event('change')); await sleep(20); }
ok('editing radius in the palette updates the circle', near(ents()[0].r, 7.5), ents()[0]);
const ls = document.querySelector('#props [data-g=layer]'); ok('palette has layer selector', !!ls);

// ---------- layers ----------
A.doc.layers.push({ name: 'WALLS', color: 1, lt: 'DASHED', lw: 50, on: true, frozen: false, locked: false, plot: true });
A.selSet = new Set([ents()[0].id]); tgl(); await sleep(10);
const sel = document.querySelector('#props [data-g=layer]'); if (sel) sel.value = 'WALLS'; sel && sel.dispatchEvent(new Event('change')); await sleep(20);
ok('change layer from the palette', ents()[0].layer === 'WALLS');
const rs = M.resolve(A.doc, ents()[0]); ok('ByLayer colour / linetype / lineweight resolve', rs.aci === 1 && rs.lt === 'DASHED' && near(rs.lw, 0.5), rs);
A.doc.layers.find(l => l.name === 'WALLS').locked = true; A.selSet = new Set(); V.invalidate();
await drag([-20, -20], [20, 20]); ok('locked layer objects are not selectable', A.selSet.size === 0);

// ---------- DXF save/open through the page code ----------
document.getElementById('wSample') && 0;
const X = window.LDDxf, S = window.LDSample.sampleDoc();
const r2 = X.readDXF(X.writeDXF(S)).doc; ok('sample DXF round trip in the browser', r2.ents.length === S.ents.length);

// ---------- performance: 20 000 lines ----------
await fresh();
for (let i = 0; i < 20000; i++) A.doc.ents.push({ id: A.doc.nextId++, type: 'line', layer: '0', x1: (i % 200) * 5, y1: Math.floor(i / 200) * 5, x2: (i % 200) * 5 + 4, y2: Math.floor(i / 200) * 5 + 3 });
V.invalidate(); V.zoomExtents(); const t0 = performance.now(); V.draw(); const dt = performance.now() - t0;
A.osnapOn = true; await type('L'); await move(500.2, 250.1);
const t1 = performance.now(); for (let k = 0; k < 10; k++) { const [sx, sy] = V.w2s(500.2 + k * 0.01, 250.1); V.snap(sx, sy, [0, 0], A.osnap); V.pick(sx, sy); V.overlay(); } const st = (performance.now() - t1) / 10; E.cancel(); await sleep(10);
ok('20k lines redraw < 250 ms', dt < 250, dt); ok('snap + pick + overlay per mouse move on 20k lines < 30 ms', st < 30, st);

return JSON.stringify({ passed: res.length, failed: fail.length, fail, ms: Math.round(performance.now() - tStart), drawMs: +dt.toFixed(1), snapMs: +st.toFixed(1) });
