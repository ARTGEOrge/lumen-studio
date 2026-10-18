// Headless UI test part 2 — remaining commands, drag-and-drop DXF, dialogs. Run with tools/shot like ui.shot.js.
const A = window.LDApp, E = A.E, V = A.V, G = window.LDGeom, M = window.LDModel, X = window.LDDxf;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ov = document.getElementById('ov');
const res = [], fail = [];
const ok = (name, cond, info) => { (cond ? res : fail).push(name + (cond ? '' : ' — ' + JSON.stringify(info))); };
const near = (a, b, t = 1e-6) => Math.abs(a - b) <= t;
async function type(...ts) { for (const t of ts) { E.input(t); await sleep(15); } }
function at(wx, wy) { const r = ov.getBoundingClientRect(), [sx, sy] = V.w2s(wx, wy); return { clientX: r.left + sx, clientY: r.top + sy }; }
function ptr(kind, p, extra = {}) { ov.dispatchEvent(new PointerEvent(kind, { ...p, bubbles: true, pointerId: 1, button: 0, ...extra })); }
async function click(wx, wy, extra = {}) { const p = at(wx, wy); ptr('pointermove', p, extra); ptr('pointerdown', p, extra); ptr('pointerup', p, extra); await sleep(15); }
const ents = t => A.doc.ents.filter(e => !t || e.type === t);
async function fresh() { A.doc = M.newDoc(); A.selSet = new Set(); V.invalidate(); V.zoomBox([-20, -20, 140, 80]); A.osnapOn = false; A.polar = false; A.ortho = false; await sleep(10); }
const modalOK = async () => { await sleep(20); const b = document.querySelector('.aero-modal [data-a=o]'); if (b) b.click(); await sleep(30); return !!b; };

// circles & arcs
await fresh();
await type('C', '3P', '0,0', '10,0', '5,5'); let c = ents('circle')[0]; ok('CIRCLE 3P', c && near(c.cx, 5) && near(c.cy, 0) && near(c.r, 5), c);
await type('C', '2P', '20,0', '30,0'); c = ents('circle')[1]; ok('CIRCLE 2P', near(c.cx, 25) && near(c.r, 5));
await type('C', '50,0', 'D', '8'); c = ents('circle')[2]; ok('CIRCLE Diameter', near(c.r, 4));
await type('L', '-50,-10', '50,-10', ''); await type('L', '-50,-10', '-50,40', '');
await type('C', 'T'); await click(-20, -10); await click(-50, 10); await type('6');
c = ents('circle')[3]; ok('CIRCLE TTR tangent to two lines', c && near(c.cx, -44) && near(c.cy, -4) && near(c.r, 6), c);
await type('A', '0,20', '10,30', '20,20'); let a = ents('arc')[0]; ok('ARC 3 points', a && near(a.cx, 10) && near(a.cy, 20) && near(a.r, 10) && near(a.a1, 0, 1e-9) && near(a.a2, Math.PI), a);
await type('A', 'C', '40,20', '50,20', '40,30'); a = ents('arc')[1]; ok('ARC centre/start/end', near(a.r, 10) && near(a.a2, Math.PI / 2));
await type('POL', '6', '100,0', 'I', '110,0'); const pg = ents('pline')[0]; ok('POLYGON hexagon', pg && pg.pts.length === 6 && near(Math.abs(G.loopArea(pg.pts)), 3 * Math.sqrt(3) / 2 * 100, 1e-6));
await type('REC', '0,50', 'D', '30', '20', '40,80'); const rc = ents('pline')[1]; ok('RECTANG Dimensions', rc && near(Math.abs(G.loopArea(rc.pts)), 600), rc && rc.pts);
// BREAK
await fresh(); await type('L', '0,0', '100,0', ''); await type('BR'); await click(30, 0); await type('60,0');
ok('BREAK removes the span between two points', ents('line').length === 2 && ents('line').some(l => near(l.x2, 30)) && ents('line').some(l => near(l.x1, 60)), ents('line'));
// MATCHPROP
await fresh(); A.doc.layers.push({ name: 'RED', color: 1, lt: 'HIDDEN', lw: 35, on: true, frozen: false, locked: false, plot: true });
await type('L', '0,0', '10,0', ''); A.doc.ents[0] = { ...A.doc.ents[0], layer: 'RED', color: 3 }; V.invalidate();
await type('L', '0,10', '10,10', ''); await type('MA'); await click(5, 0); await click(5, 10); await type('');
ok('MATCHPROP copies layer and colour', ents()[1].layer === 'RED' && ents()[1].color === 3, ents()[1]);
// LIST / ID
await type('ID', '12.5,7'); ok('ID echoes the coordinates', document.getElementById('st1').textContent.includes('12.5000'));
A.selSet = new Set([ents()[0].id]); await type('LI'); ok('LIST describes the object', [...document.querySelectorAll('#cmdhist div')].some(d => d.textContent.includes('Length = 10.0000')));
// COPYCLIP / PASTECLIP
A.selSet = new Set(ents().map(e => e.id)); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true })); await sleep(20);
await type('PASTECLIP', '100,100'); ok('copy/paste with base point', ents().length === 4 && ents().some(e => e.type === 'line' && near(e.y1, 110)), ents().map(e => [e.x1, e.y1]));
// ZOOM window
await type('Z', 'W', '0,0', '10,10'); ok('ZOOM Window', V.scale() > 30, V.scale());
await type('Z', 'E'); ok('ZOOM Extents', V.scale() < 30);
// hatch with Select objects + pattern option
await fresh(); await type('C', '0,0', '10'); await type('H', 'S', 'ALL', '', ''); const h = ents('hatch')[0];
ok('HATCH Select objects (circle)', h && near(Math.abs(G.loopArea(h.loops[0].pts)), Math.PI * 100, 1e-6), h);
await type('H', 'P', 'SOLID', '5,0', ''); ok('HATCH Pattern option → SOLID', ents('hatch').some(x => x.pat === 'SOLID'));
// DIMDIAMETER
await type('DDI'); await click(10, 0); await type('20,5'); ok('DIMDIAMETER Ø20', ents('dim').length === 1 && M.dimText(ents('dim')[0], A.doc.dimstyle) === 'Ø20');
// TEXTEDIT through the edit dialog
await type('DT', '30,30', '3', '0', 'Old', ''); await type('ED'); await click(31, 31); await sleep(20);
const ta = document.querySelector('.aero-modal input[type=text], .aero-modal textarea'); if (ta) { ta.value = 'New text'; ta.dispatchEvent(new Event('input')); }
await modalOK(); await type(''); ok('TEXTEDIT changes the text', ents('text')[0].s === 'New text', ents('text')[0]);
// dialogs open and close cleanly
for (const cmd of ['LA', 'OS', 'UN', 'D', 'PAGESETUP']) { await type(cmd); const opened = await modalOK(); ok('dialog ' + cmd, opened); }
await type('PLOT'); await sleep(20); const cancel = document.querySelector('.aero-modal [data-a=c]'); ok('PLOT dialog opens', !!cancel); cancel && cancel.click(); await sleep(20);
// layer panel: freeze a layer hides its objects
await fresh(); A.doc.layers.push({ name: 'TMP', color: 2, lt: 'CONTINUOUS', lw: -3, on: true, frozen: false, locked: false, plot: true });
A.doc.ents.push({ id: A.doc.nextId++, type: 'line', layer: 'TMP', x1: 0, y1: 0, x2: 10, y2: 10 }); V.invalidate(); A.refresh(); await sleep(10);
const row = [...document.querySelectorAll('#layers .lrow')].find(r => r.textContent.includes('TMP'));
row.querySelector('[data-t=frozen]').click(); await sleep(20);
ok('freezing a layer from the panel', M.layerOf(A.doc, 'TMP').frozen && M.extents(A.doc) === null);
// cmdbar: change current colour then draw
const csel = document.getElementById('colorSel'); csel.value = '5'; csel.dispatchEvent(new Event('change')); await sleep(10);
await type('L', '0,0', '5,5', ''); ok('current colour applies to new objects', ents('line').at(-1).color === 5);
csel.value = '256'; csel.dispatchEvent(new Event('change'));
// keyword click in the prompt
await type('L', '0,0', '10,0', '10,10'); const kw = [...document.querySelectorAll('#prompt .kw')].find(k => k.dataset.k === 'Close'); kw && kw.click(); await sleep(20);
ok('clicking a prompt keyword (Close)', !E.pending && near(ents('line').at(-1).x2, 0) && near(ents('line').at(-1).y2, 0), ents('line').at(-1));
// command suggestions
const inp = document.getElementById('cmdIn'); inp.focus(); inp.value = 'DIM'; inp.dispatchEvent(new Event('input')); await sleep(10);
ok('command line autocomplete lists DIM commands', !document.getElementById('suggest').hidden && document.getElementById('suggest').textContent.includes('DIMLINEAR'));
inp.value = ''; inp.dispatchEvent(new Event('input')); inp.blur();
// drag and drop a DXF file
const dxf = X.writeDXF(window.LDSample.sampleDoc(), { version: 'R12' });
A.welcomeDismissed = true; Aero.setDirty(false);
const dt = new DataTransfer(); dt.items.add(new File([dxf], 'plate-r12.dxf', { type: 'application/dxf' }));
document.getElementById('stage').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
await sleep(400);
ok('dropping a DXF opens it', A.docName === 'plate-r12.dxf' && ents().length > 30 && A.fmt === 'dxf12', [A.docName, ents().length, A.fmt]);
// layout tab + fit
document.querySelector('.stab[data-s=layout]').click(); await sleep(50);
document.getElementById('bFit').click(); await sleep(30);
ok('layout Fit picks a standard scale', Array.isArray(A.doc.layout.scale) && A.doc.layout.scale[0] >= 1);
document.querySelector('.stab[data-s=model]').click(); await sleep(20);
// Escape cancels, Enter repeats the last command
await type('C', '0,0'); document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(20);
ok('Esc cancels a command', !E.running());
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await sleep(20);
ok('Enter repeats the last command', E.running() && document.getElementById('prompt').textContent.startsWith('Specify center')); E.cancel(); await sleep(20);
return JSON.stringify({ passed: res.length, failed: fail.length, fail });
