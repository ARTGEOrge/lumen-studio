// node pcb/tests/core.test.js — netlist, geometry, DRC and fabrication output checks.
const Core = require('../js/core.js'), { samplePcb } = require('../js/sample.js');
const assert = require('assert');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const pad = (board, ref, num) => Core.padsOf(board.parts.find(p => p.ref === ref)).find(p => p.n === num);

t('netlist: wires, T-junctions, labels and power symbols', () => {
  const sch = { parts: [
    { ref: 'R1', lib: 'R', x: 0, y: 0, rot: 0 },          // pins at (-3,0) (3,0)
    { ref: 'R2', lib: 'R', x: 10, y: 0, rot: 0 },         // pins at (7,0) (13,0)
    { ref: 'R3', lib: 'R', x: 5, y: 6, rot: 1 },          // rotated: pins at (5,3) (5,9)
    { ref: '#P1', lib: 'GND', value: 'GND', x: 13, y: 0 },
    { ref: '#P2', lib: 'GND', value: 'GND', x: 20, y: 20 },
    { ref: 'C1', lib: 'C', x: 20, y: 18, rot: 1 },        // pins (20,16) (20,20)
  ], wires: [{ pts: [[3, 0], [7, 0]] }, { pts: [[5, 0], [5, 3]] }], labels: [{ x: -3, y: 0, name: 'IN' }, { x: 20, y: 16, name: 'IN' }] };
  assert.deepStrictEqual(Core.pinsOf(sch.parts[2]).map(p => [p.x, p.y]), [[5, 3], [5, 9]]);
  const nl = Core.netlist(sch);
  const net = name => nl.nets.find(x => x.name === name).nodes.map(n => n.ref + '.' + n.pin).sort();
  assert.deepStrictEqual(net('IN'), ['C1.1', 'R1.1']);
  assert.deepStrictEqual(net('GND'), ['C1.2', 'R2.2']);
  const mid = nl.nets.find(x => x.name.startsWith('N$'));
  assert.deepStrictEqual(mid.nodes.map(n => n.ref + '.' + n.pin).sort(), ['R1.2', 'R2.1', 'R3.1']); // T-junction joins R3
  assert.deepStrictEqual(nl.unconnected.map(p => p.ref + '.' + p.n), ['R3.2']);
});

t('sample 555 schematic has the right nets and passes ERC', () => {
  const p = samplePcb(), nl = Core.netlist(p.sch);
  const net = name => (nl.nets.find(x => x.name === name) || { nodes: [] }).nodes.map(n => n.ref + '.' + n.pin).sort();
  assert.deepStrictEqual(net('+5V'), ['J1.1', 'R1.1', 'U1.4', 'U1.8']);
  assert.deepStrictEqual(net('GND'), ['C1.2', 'C2.2', 'D1.1', 'J1.2', 'U1.1']);
  assert.deepStrictEqual(net('THR'), ['C1.1', 'R2.2', 'U1.2', 'U1.6']);
  assert.deepStrictEqual(net('LED_A'), ['D1.2', 'R3.2']);
  assert.deepStrictEqual(Core.erc(p.sch, nl), []);
});

t('footprints: DIP-8 pin order and rotation', () => {
  const b = { parts: [{ ref: 'U1', fp: 'DIP_8', x: 10, y: 10, rot: 0 }] };
  assert.deepStrictEqual(['1', '4', '5', '8'].map(k => { const p = pad(b, 'U1', k); return [+p.x.toFixed(2), +p.y.toFixed(2)]; }), [[6.19, 6.19], [6.19, 13.81], [13.81, 13.81], [13.81, 6.19]]);
  b.parts[0].rot = 90; const p1 = pad(b, 'U1', '1'); assert.deepStrictEqual([+p1.x.toFixed(2), +p1.y.toFixed(2)], [13.81, 6.19]);
  const r = { parts: [{ ref: 'R1', fp: 'R_0805', x: 0, y: 0, rot: 90 }] }; const q = pad(r, 'R1', '1'); assert.deepStrictEqual([q.w, q.h], [1.3, 1.0]);
});

t('copper distance: pads, tracks and vias', () => {
  const g = (a, b) => +Core.gap(a, b).toFixed(4);
  const seg = (x1, y1, x2, y2, w) => ({ core: [[x1, y1], [x2, y2]], r: w / 2 });
  assert.strictEqual(g(seg(0, 0, 10, 0, 0.25), seg(0, 1, 10, 1, 0.25)), 0.75);
  assert.strictEqual(g(seg(0, 0, 10, 0, 0.2), seg(5, -5, 5, 5, 0.2)), -0.2);           // crossing: overlap by both half-widths
  assert.strictEqual(g(Core.padShape({ x: 0, y: 0, w: 2, h: 1, shape: 'rect' }), { core: [[3, 0]], r: 0.5 }), 1.5);
  assert.strictEqual(g(Core.padShape({ x: 0, y: 0, w: 1.6, h: 1.6, shape: 'round' }), Core.padShape({ x: 2.54, y: 0, w: 1.6, h: 1.6, shape: 'round' })), 0.94);
  assert.strictEqual(g(Core.padShape({ x: 0, y: 0, w: 2, h: 2, shape: 'rect' }), { core: [[0.2, 0.2]], r: 0.1 }), -0.1); // inside
});

t('ratsnest, routing and DRC on the sample board', () => {
  const p = samplePcb(), nl = Core.netlist(p.sch), b = p.board;
  const r0 = Core.ratsnest(b, nl.pinNet);
  assert.strictEqual(r0.totalNets, 7); assert.strictEqual(r0.unroutedNets, 7);
  // +5V needs 3 lines for 4 pads (U1.4 & U1.8 + R1.1 + J1.1)
  assert.strictEqual(r0.lines.filter(l => l.net === '+5V').length, 3);
  // route R3.2 → D1.2 (LED_A) with an L-shaped track
  const a = pad(b, 'R3', '2'), d = pad(b, 'D1', '2');
  b.tracks.push({ layer: 'top', w: 0.4, net: 'LED_A', pts: [[a.x, a.y], [d.x + 3, a.y], [d.x + 3, d.y], [d.x, d.y]] }); // around the cathode pad
  const r1 = Core.ratsnest(b, nl.pinNet);
  assert.strictEqual(r1.unroutedNets, 6); assert.ok(!r1.lines.some(l => l.net === 'LED_A'));
  const errs = Core.drc(b, nl.pinNet);
  assert.ok(!errs.some(e => e.type === 'Clearance' || e.type === 'Short'), JSON.stringify(errs.filter(e => e.type !== 'Unrouted')));
  assert.strictEqual(errs.filter(e => e.type === 'Unrouted').length, r1.lines.length);
  // a track straight through U1 from pin 1 to pin 8 shorts GND to +5V across pins and violates clearance
  const p1 = pad(b, 'U1', '1'), p8 = pad(b, 'U1', '8');
  b.tracks.push({ layer: 'top', w: 0.3, net: null, pts: [[p1.x, p1.y], [p8.x, p8.y]] });
  const e2 = Core.drc(b, nl.pinNet);
  assert.ok(e2.some(e => e.type === 'Short' && /GND/.test(e.msg) && /\+5V/.test(e.msg)));
  b.tracks.pop();
  // too close: a 0.25 track 0.1 mm from a pad of another net
  const p2 = pad(b, 'U1', '2');
  b.tracks.push({ layer: 'bottom', w: 0.25, net: 'OUT', pts: [[p2.x + 0.8 + 0.1 + 0.125, p2.y - 3], [p2.x + 0.8 + 0.1 + 0.125, p2.y + 3]] });
  const e3 = Core.drc(b, nl.pinNet).filter(e => e.type === 'Clearance');
  assert.ok(e3.length >= 1 && /0\.100 mm/.test(e3[0].msg), JSON.stringify(e3));
});

t('Gerber and Excellon output are well-formed', () => {
  const p = samplePcb(), b = p.board, nl = Core.netlist(p.sch);
  b.tracks.push({ layer: 'top', w: 0.4, net: 'X', pts: [[10, 10], [20, 10]] }); b.vias.push({ x: 20, y: 10, dia: 0.8, drill: 0.4, net: 'X' });
  const g = Core.gerber(b, 'top');
  assert.ok(g.includes('%FSLAX46Y46*%') && g.includes('%MOMM*%') && g.trim().endsWith('M02*'));
  const defined = new Set([...g.matchAll(/%ADD(\d+)/g)].map(m => m[1]));
  const used = new Set([...g.matchAll(/^D(\d+)\*$/gm)].map(m => m[1]));
  assert.ok([...used].every(u => defined.has(u)), 'apertures defined before use');
  const flashes = (g.match(/D03\*/g) || []).length;
  const padCount = b.parts.reduce((s, fp) => s + Core.padsOf(fp).filter(x => x.layers.includes('top')).length, 0);
  assert.strictEqual(flashes, padCount + 1);  // every top pad + the via
  assert.ok(/X10000000Y30000000D02\*\nX20000000Y30000000D01\*/.test(g)); // y flipped: 40 − 10 = 30 mm
  const drl = Core.drill(b);
  const holes = drl.split('\n').filter(l => /^X/.test(l)).length;
  assert.strictEqual(holes, b.parts.reduce((s, fp) => s + Core.padsOf(fp).filter(x => x.drill).length, 0) + 1);
  assert.ok(drl.startsWith('M48') && /METRIC/.test(drl) && drl.trim().endsWith('M30'));
  const files = Core.fabFiles(b, 'blink'); assert.strictEqual(files.length, 7);
  const z = Core.zip(files); assert.strictEqual(new DataView(z.buffer).getUint32(0, true), 0x04034b50);
  assert.strictEqual(Core.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const bom = Core.bom(p.sch); assert.ok(/^Qty,References/.test(bom) && /1,R2,47k,R_Axial_10mm/.test(bom));
});

t('syncBoard places new footprints and drops deleted ones', () => {
  const p = samplePcb(); p.board.parts = p.board.parts.filter(x => x.ref !== 'R3');
  p.sch.parts.push({ ref: 'R9', lib: 'R', value: '1k', fp: 'R_0805', x: 0, y: 0 }); p.board.parts.push({ ref: 'X9', fp: 'R_0805', x: 1, y: 1 });
  const added = Core.syncBoard(p.sch, p.board);
  assert.deepStrictEqual(added.sort(), ['R3', 'R9']); assert.ok(!p.board.parts.some(x => x.ref === 'X9'));
  p.board.parts.forEach(fp => Core.padsOf(fp).forEach(q => assert.ok(q.x > 0 && q.y > 0)));
});

console.log(`\n${n} tests passed`);
// (appended) copper pour
t('copper pour joins its net, keeps clearance, and is exported as Gerber regions', () => {
  const p = samplePcb(), nl = Core.netlist(p.sch), b = p.board;
  b.zones = [{ net: 'GND', layer: 'bottom', clearance: 0.4 }];
  const f = Core.fillZone(b, b.zones[0], nl.pinNet);
  assert.ok(f.area > 0.6 * b.w * b.h, 'mostly filled: ' + f.area);
  // no filled cell may sit within the clearance of copper on another net
  const others = Core.copper(b, nl.pinNet).filter(it => it.layers.includes('bottom') && it.net !== 'GND');
  let worst = Infinity;
  for (let j = 0; j < f.ny; j += 2) for (let i = 0; i < f.nx; i += 2) { if (f.grid[j * f.nx + i] <= 0) continue; const c = { core: [[(i + 0.5) * f.res, (j + 0.5) * f.res]], r: 0 }; others.forEach(o => { worst = Math.min(worst, Core.gap(o, c)); }); }
  assert.ok(worst >= 0.4 - 1e-9, 'clearance kept: ' + worst);
  const rn = Core.ratsnest(b, nl.pinNet);
  assert.ok(!rn.lines.some(l => l.net === 'GND'), 'GND fully joined by the pour');
  assert.strictEqual(rn.unroutedNets, 6);
  const g = Core.gerber(b, 'bottom', nl.pinNet); assert.ok(/G36\*/.test(g) && /G37\*/.test(g));
  assert.ok(!Core.drc(b, nl.pinNet).some(e => e.type === 'Short' || e.type === 'Clearance'));
});
console.log('(copper pour test appended)');

// ---------- v1.2: autorouter, net classes, length report, pick-and-place, IPC-D-356 ----------
const Route = require('../js/autoroute.js');
const hardErrors = errs => errs.filter(e => e.type !== 'Unrouted');
t('autorouter routes every net of the sample board with a clean DRC', () => {
  const p = samplePcb(), nl = Core.netlist(p.sch), b = p.board;
  const r = Route.autoroute(b, nl.pinNet, { width: 0.3 });
  assert.strictEqual(r.failed.length, 0); assert.strictEqual(r.routed.length, r.connections);
  assert.ok(r.tracks.length > 5 && r.tracks.every(t => t.auto && t.w === 0.3 && t.pts.length >= 2 && (t.layer === 'top' || t.layer === 'bottom')));
  // every via sits where tracks of the same net on both layers meet
  r.vias.forEach(v => ['top', 'bottom'].forEach(l => assert.ok(r.tracks.some(t => t.net === v.net && t.layer === l && t.pts.slice(1).some((q, i) => Core.gap({ core: [t.pts[i], q], r: 0 }, { core: [[v.x, v.y]], r: 0 }) < 1e-6)), 'via joins ' + l)));
  // all moves are horizontal, vertical or 45° (apart from tiny jogs onto pad centres)
  r.tracks.forEach(t => t.pts.slice(1).forEach((q, i) => { const dx = Math.abs(q[0] - t.pts[i][0]), dy = Math.abs(q[1] - t.pts[i][1]); assert.ok(dx < 1e-6 || dy < 1e-6 || Math.abs(dx - dy) < 1e-6 || Math.hypot(dx, dy) < 0.2, `segment angle ${dx},${dy}`); }));
  b.tracks.push(...r.tracks); b.vias.push(...r.vias);
  assert.strictEqual(Core.ratsnest(b, nl.pinNet).unroutedNets, 0);
  assert.deepStrictEqual(hardErrors(Core.drc(b, nl.pinNet)), []);
  assert.strictEqual(Route.unroute(b, { nets: ['GND'], autoOnly: true }) > 0, true);
  assert.ok(!b.tracks.some(t => t.net === 'GND') && Core.ratsnest(b, nl.pinNet).unroutedNets === 1);
});

t('autorouter on one layer without vias goes around obstacles, and reports what it cannot route', () => {
  const b = { w: 30, h: 20, rules: { clearance: 0.2, track: 0.2, drill: 0.3, edge: 0.3, viaDia: 0.8, viaDrill: 0.4 }, tracks: [], vias: [], parts: [
    { ref: 'J1', fp: 'Header_1x2', x: 5, y: 10, rot: 0, side: 'top' }, { ref: 'J2', fp: 'Header_1x2', x: 25, y: 10, rot: 0, side: 'top' }] };
  const pinNet = new Map([['J1.1', 'A'], ['J2.1', 'A'], ['J1.2', 'B'], ['J2.2', 'B']]);
  // a wall of foreign copper across the board on top, with a gap at the bottom edge
  b.tracks.push({ layer: 'top', w: 1, net: 'WALL', pts: [[15, 1], [15, 16]] });
  const r = Route.autoroute(b, pinNet, { layers: ['top'], width: 0.25 });
  assert.strictEqual(r.failed.length, 0); assert.strictEqual(r.vias.length, 0);
  assert.ok(r.tracks.every(t => t.layer === 'top'));
  b.tracks.push(...r.tracks);
  assert.deepStrictEqual(hardErrors(Core.drc(b, pinNet)), []);
  assert.ok(r.tracks.some(t => t.pts.some(q => q[1] > 16)), 'detours below the wall');
  // close the gap completely: now nothing can get through on one layer
  const b2 = JSON.parse(JSON.stringify(b)); b2.tracks = [{ layer: 'top', w: 1, net: 'WALL', pts: [[15, 1], [15, 19]] }];
  const r2 = Route.autoroute(b2, pinNet, { layers: ['top'], passes: 1 });
  assert.strictEqual(r2.failed.length, 2); assert.strictEqual(r2.tracks.length, 0);
  // with both layers it gets past the wall on the bottom
  const r3 = Route.autoroute(b2, pinNet, {}); assert.strictEqual(r3.failed.length, 0);
  b2.tracks.push(...r3.tracks); b2.vias.push(...r3.vias); assert.deepStrictEqual(hardErrors(Core.drc(b2, pinNet)), []);
  // SMD pads (top only) behind a full-height wall on both layers' top: needs vias
  const b3 = { w: 30, h: 20, rules: b.rules, tracks: [{ layer: 'top', w: 1, net: 'WALL', pts: [[15, 1], [15, 19]] }], vias: [], parts: [
    { ref: 'R1', fp: 'R_0805', x: 5, y: 10, rot: 0, side: 'top' }, { ref: 'R2', fp: 'R_0805', x: 25, y: 10, rot: 0, side: 'top' }] };
  const pn3 = new Map([['R1.2', 'S'], ['R2.1', 'S']]);
  const r4 = Route.autoroute(b3, pn3, {}); assert.strictEqual(r4.failed.length, 0); assert.ok(r4.vias.length >= 2, 'down and back up');
  b3.tracks.push(...r4.tracks); b3.vias.push(...r4.vias); assert.deepStrictEqual(hardErrors(Core.drc(b3, pn3)), []);
  assert.strictEqual(Route.autoroute(b3, pn3, { vias: false }).failed.length, 0, 'nothing left to route');
  b3.tracks = b3.tracks.slice(0, 1); b3.vias = [];
  assert.strictEqual(Route.autoroute(b3, pn3, { vias: false, passes: 1 }).failed.length, 1, 'no vias allowed → blocked');
});

t('autorouter: larger board with 30 DIP-14s and multi-pin nets routes completely and DRC-clean', () => {
  const b = { w: 100, h: 125, rules: { clearance: 0.2, track: 0.2, drill: 0.3, edge: 0.3, viaDia: 0.8, viaDrill: 0.4 }, tracks: [], vias: [], parts: [] }, pn = new Map();
  let k = 0; for (let i = 0; i < 5; i++) for (let j = 0; j < 6; j++) b.parts.push({ ref: 'U' + ++k, fp: 'DIP_14', x: 10 + i * 19, y: 12 + j * 20, rot: 0, side: 'top' });
  let s = 7; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 10; n++) for (let q = 0; q < 3; q++) { const key = 'U' + (1 + Math.floor(rnd() * 30)) + '.' + (1 + Math.floor(rnd() * 14)); if (!pn.has(key)) pn.set(key, 'N' + n); }
  const r = Route.autoroute(b, pn, {});
  assert.strictEqual(r.failed.length, 0, r.failed.length + ' failed'); assert.ok(r.connections >= 15, r.connections + " connections");
  b.tracks.push(...r.tracks); b.vias.push(...r.vias);
  assert.strictEqual(Core.ratsnest(b, pn).unroutedNets, 0); assert.deepStrictEqual(hardErrors(Core.drc(b, pn)), []);
});

t('net classes: per-class width and clearance in DRC, pours and the autorouter', () => {
  const p = samplePcb(), nl = Core.netlist(p.sch), b = p.board;
  b.netClasses = Core.sanitizeClasses([{ name: 'Power', nets: ['+5V', 'GND', 'GND'], width: 0.6, clearance: 0.35 }, { name: 'Default', nets: ['OUT'] }, { name: '', nets: [] }, { name: 'Bad', width: 'x', clearance: -1, nets: [5, 'GND'] }]);
  assert.deepStrictEqual(b.netClasses.map(c => c.name), ['Power', 'Bad']);
  assert.deepStrictEqual(b.netClasses[1].nets, []); assert.strictEqual(b.netClasses[1].width, undefined);
  assert.strictEqual(Core.classOf(b, 'GND').width, 0.6); assert.strictEqual(Core.classOf(b, 'OUT').clearance, 0.2); assert.strictEqual(Core.classOf(b, null).name, 'Default');
  // a 0.3 mm GND track breaks the class width rule; a THR track 0.3 mm from a GND pad breaks the class clearance (0.35)
  const g1 = pad(b, 'U1', '1');
  b.tracks.push({ layer: 'top', w: 0.3, net: 'GND', pts: [[g1.x, g1.y], [g1.x - 3, g1.y]] });
  assert.ok(Core.drc(b, nl.pinNet).some(e => e.type === 'Track width' && /class Power/.test(e.msg)));
  b.tracks[0].w = 0.6;
  const off = 0.8 + 0.3 + 0.125; b.tracks.push({ layer: 'bottom', w: 0.25, net: 'THR', pts: [[g1.x - 2, g1.y + off], [g1.x + 2, g1.y + off]] });
  const cl = Core.drc(b, nl.pinNet).filter(e => e.type === 'Clearance');
  assert.ok(cl.length && /min 0\.35/.test(cl[0].msg), JSON.stringify(cl));
  b.netClasses = []; assert.ok(!Core.drc(b, nl.pinNet).some(e => e.type === 'Clearance'), 'fine under the default 0.2 mm');
  // autorouter uses the class width for power nets and still produces a clean board
  const q = samplePcb(), qb = q.board; qb.netClasses = [{ name: 'Power', nets: ['+5V', 'GND'], width: 0.5, clearance: 0.3 }];
  const r = Route.autoroute(qb, nl.pinNet, { width: 0.25 }); assert.strictEqual(r.failed.length, 0);
  assert.ok(r.tracks.filter(t => t.net === 'GND' || t.net === '+5V').every(t => t.w === 0.5) && r.tracks.filter(t => t.net === 'OUT').every(t => t.w === 0.25));
  qb.tracks.push(...r.tracks); qb.vias.push(...r.vias); assert.deepStrictEqual(hardErrors(Core.drc(qb, nl.pinNet)), []);
  // a pour keeps the larger class clearance from Power-class copper of other nets
  qb.zones = [{ net: 'THR', layer: 'bottom', clearance: 0.2 }];
  const f = Core.fillZone(qb, qb.zones[0], nl.pinNet), others = Core.copper(qb, nl.pinNet).filter(it => it.layers.includes('bottom') && (it.net === 'GND' || it.net === '+5V'));
  let worst = Infinity; for (let j = 0; j < f.ny; j += 2) for (let i = 0; i < f.nx; i += 2) { if (f.grid[j * f.nx + i] <= 0) continue; const c = { core: [[(i + 0.5) * f.res, (j + 0.5) * f.res]], r: 0 }; others.forEach(o => { worst = Math.min(worst, Core.gap(o, c)); }); }
  assert.ok(worst >= 0.3 - 1e-9, 'pour keeps 0.3 from Power copper: ' + worst);
});

t('net length report and length matching per class', () => {
  const p = samplePcb(), nl = Core.netlist(p.sch), b = p.board;
  const a = pad(b, 'R3', '2'), d = pad(b, 'D1', '2');
  b.tracks.push({ layer: 'top', w: 0.4, net: 'LED_A', pts: [[a.x, a.y], [a.x + 3, a.y]] }, { layer: 'bottom', w: 0.4, net: null, pts: [[a.x + 3, a.y], [a.x + 3, d.y], [d.x, d.y]] });
  b.vias.push({ x: a.x + 3, y: a.y, dia: 0.8, drill: 0.4, net: 'LED_A' });
  const rows = Core.netLengths(b, nl.pinNet), led = rows.find(r => r.net === 'LED_A');
  assert.strictEqual(+led.top.toFixed(4), 3); assert.strictEqual(+led.bottom.toFixed(4), +(Math.abs(d.x - a.x - 3) + Math.abs(d.y - a.y)).toFixed(4));
  assert.strictEqual(led.vias, 1); assert.strictEqual(led.open, 0); assert.strictEqual(led.pads, 2);
  const gnd = rows.find(r => r.net === 'GND'); assert.strictEqual(gnd.length, 0); assert.strictEqual(gnd.open, 4);
  assert.strictEqual(+gnd.delta.toFixed(4), +led.length.toFixed(4));     // all Default class: delta to the longest
  assert.strictEqual(led.delta, 0);
});

t('pick-and-place centroid file', () => {
  const p = samplePcb(), b = p.board;
  b.parts.push({ ref: 'R10', fp: 'R_0805', x: 20, y: 5, rot: 90, side: 'bottom' });
  const csv = Core.placement(p.sch, b).trim().split('\r\n');
  assert.strictEqual(csv[0], 'Designator,Value,Package,Mid X,Mid Y,Rotation,Layer');
  assert.strictEqual(csv.length, b.parts.length + 1);
  assert.ok(csv.findIndex(l => l.startsWith('R10,')) > csv.findIndex(l => l.startsWith('R3,')), 'natural sort');
  const u1 = csv.find(l => l.startsWith('U1,')).split(','); assert.deepStrictEqual(u1, ['U1', 'NE555', 'DIP_8', '30.0000', '20.0000', '0.0', 'Top']);
  const r10 = csv.find(l => l.startsWith('R10,')).split(','); assert.deepStrictEqual(r10.slice(3), ['20.0000', '35.0000', '270.0', 'Bottom']);
  const d1 = csv.find(l => l.startsWith('D1,')).split(','); assert.strictEqual(d1[5], '270.0');   // 90° clockwise on screen = 270° CCW
});

t('IPC-D-356A netlist has fixed-column records for every pad and via', () => {
  const p = samplePcb(), nl = Core.netlist(p.sch), b = p.board;
  b.parts.push({ ref: 'R10', fp: 'R_0805', x: 20, y: 5, rot: 0, side: 'top' });
  b.vias.push({ x: 10, y: 10, dia: 0.8, drill: 0.4, net: 'A_VERY_LONG_NET_NAME_X' });
  const txt = Core.ipc356(b, nl.pinNet, 'blink'), L = txt.trim().split('\n');
  assert.ok(L.includes('P  UNITS CUST 0') && L[L.length - 1] === '999');
  const recs = L.filter(l => /^3[12]7/.test(l));
  const padCount = b.parts.reduce((s, fp) => s + Core.padsOf(fp).length, 0); assert.strictEqual(recs.length, padCount + 1);
  recs.forEach(l => assert.ok(l.length <= 80, l));
  const u1 = recs.find(l => l.slice(20, 26).trim() === 'U1' && l.slice(27, 31).trim() === '8');
  assert.strictEqual(u1.slice(0, 3), '317'); assert.strictEqual(u1.slice(3, 17).trim(), '+5V');
  assert.strictEqual(u1[26], '-'); assert.strictEqual(u1.slice(32, 38), 'D0315P');   // 0.8 mm = 0.0315 in, plated
  assert.strictEqual(u1.slice(38, 41), 'A00');
  const pu = pad(b, 'U1', '8'); assert.strictEqual(u1.slice(41, 57), 'X+' + String(Math.round(pu.x / 0.00254)).padStart(6, '0') + 'Y+' + String(Math.round((b.h - pu.y) / 0.00254)).padStart(6, '0'));
  const smd = recs.find(l => l.slice(20, 26).trim() === 'R10'); assert.ok(smd.startsWith('327N/C') && smd.slice(38, 41) === 'A01');
  const via = recs.find(l => l.slice(20, 26).trim() === 'VIA'); assert.ok(/^317NNAME1/.test(via) && L.includes('P  NNAME1 A_VERY_LONG_NET_NAME_X'));
  // the fab zip now carries both files
  const files = Core.fabFiles(b, 'blink', nl.pinNet, p.sch).map(f => f.name);
  assert.ok(files.includes('blink-netlist.ipc') && files.includes('blink-pos.csv') && files.length === 9);
});
console.log(`\nall ${n} tests passed`);
