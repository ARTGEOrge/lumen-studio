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
