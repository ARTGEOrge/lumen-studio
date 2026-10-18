// node spice/tests/schematic.test.js — schematic connectivity, netlist generation, samples, imports.
const assert = require('assert'), fs = require('fs'), path = require('path');
const S = require('../js/schematic.js'), N = require('../js/netlist.js'), E = require('../js/engine.js'), { SAMPLES } = require('../js/sample.js');
let n = 0, fails = 0;
const t = (name, fn) => { try { fn(); n++; console.log('ok  ', name); } catch (e) { fails++; console.log('FAIL', name, '\n     ', e.stack.split('\n').slice(0, 3).join('\n      ')); } };
const near = (a, b, tol, what = '') => { if (!(Math.abs(a - b) <= tol)) throw new Error(`${what} expected ${b}, got ${a} (tol ${tol})`); };
const simDoc = doc => { const { text } = S.toSpice(S.normalize(doc)); const deck = N.parse(text); return { r: E.run(N.flatten(deck), N.analysisOf(deck)), text }; };
const mag = (v, i) => Math.hypot(v.re[i], v.im[i]);

t('connectivity: wires, T-junctions, labels, ground', () => {
  const doc = S.normalize({ parts: [
    { type: 'R', ref: 'R1', x: 0, y: 0 },            // pins (0,-3) (0,3)
    { type: 'R', ref: 'R2', x: 6, y: 0 },            // pins (6,-3) (6,3)
    { type: 'R', ref: 'R3', x: 3, y: 9, rot: 1 },    // pins (6,9) (0,9)
    { type: 'GND', x: 0, y: 3 }, { type: 'C', ref: 'C1', x: 20, y: 0 } ],
    wires: [{ x1: 0, y1: -3, x2: 6, y2: -3 }, { x1: 3, y1: -3, x2: 3, y2: -6 }, { x1: 6, y1: 3, x2: 6, y2: 9 }],
    labels: [{ x: 3, y: -6, name: 'top' }, { x: 20, y: -3, name: 'top' }] });
  const c = S.connectivity(doc);
  assert.strictEqual(c.pinNet.get('0:1'), 'top'); assert.strictEqual(c.pinNet.get('1:1'), 'top'); assert.strictEqual(c.pinNet.get('4:1'), 'top');
  assert.strictEqual(c.pinNet.get('0:2'), '0');
  assert.strictEqual(c.pinNet.get('1:2'), c.pinNet.get('2:1'));
  assert.deepStrictEqual(c.unconnected.map(u => doc.parts[u.pi].ref + '.' + u.n).sort(), ['C1.2', 'R3.2']);
  assert.deepStrictEqual(S.junctions(doc).map(String), ['3,-3']);
});

t('every sample simulates and gives sensible results', () => {
  Object.entries(SAMPLES).forEach(([id, s]) => {
    const doc = s.make(); const { r, text } = simDoc(doc);
    const c = S.connectivity(S.normalize(doc)); assert.strictEqual(c.unconnected.length, 0, id + ' has unconnected pins: ' + c.unconnected.map(u => doc.parts[u.pi].ref + '.' + u.n));
    doc.traces.forEach(tr => assert(r.vectors[tr] || r.vectors[tr.replace(/\(([^)]*)\)/, (m, a) => '(' + a.toLowerCase() + ')')], `${id}: trace ${tr} missing (have ${Object.keys(r.vectors).slice(0, 12)})\n${text}`));
    if (id === 'ce') {
      const out = r.vectors['V(out)'], vin = r.vectors['V(in)']; let a = 0, b = 0; for (let i = 0; i < r.x.length; i++) if (r.x[i] > 2e-3) { a = Math.max(a, Math.abs(out[i])); b = Math.max(b, Math.abs(vin[i])); }
      const gain = a / b; console.log('       CE gain', gain.toFixed(1), '·', r.x.length, 'points'); assert(gain > 100 && gain < 260, 'CE gain ' + gain);
    }
    if (id === 'sallen') {
      const v = r.vectors['V(out)']; near(mag(v, 0), 1, 1e-3, 'passband');
      // unity-gain Sallen-Key: H = 1 / (1 − ω²R²C1C2 + jω·2R·C2)
      for (let i = 0; i < r.x.length; i += 7) { const w = 2 * Math.PI * r.x[i], re = 1 - w * w * 1e8 * 22e-9 * 10e-9, im = w * 2e4 * 10e-9; near(20 * Math.log10(mag(v, i)), -10 * Math.log10(re * re + im * im), 0.05, 'dB @' + r.x[i].toFixed(0)); }
    }
    if (id === 'rect') { let mx = 0; r.vectors['V(out)'].forEach(x => mx = Math.max(mx, x)); near(mx, 9.25, 0.25, 'rectified peak'); }
    if (id === 'cmos') { near(r.vectors['V(out)'][0], 5, 1e-3, 'out high'); near(r.vectors['V(out)'][r.x.length - 1], 0, 1e-3, 'out low'); }
    if (id === 'rlc') { const v = r.vectors['V(cap)']; let best = 0, k = 0; for (let i = 0; i < r.x.length; i++) if (mag(v, i) > best) { best = mag(v, i); k = i; } near(r.x[k], 1591.5, 30, 'f0'); near(best, 10, 0.3, 'Q'); }
    if (id === 'led') { const i = r.vectors['I(D1)']; let mx = 0; i.forEach(x => mx = Math.max(mx, x)); near(mx, (5 - 1.85) / 150, 2.5e-3, 'LED on current'); }
  });
});

t('netlist export round-trips through the parser and back into a schematic', () => {
  const doc = SAMPLES.ce.make(); const { text } = S.toSpice(S.normalize(doc));
  assert(/^Q1 /m.test(text) && /\.model 2N3904 NPN/.test(text) && /\.tran 0 5m 0 5u/.test(text), text);
  const back = S.fromNetlist(text);
  assert.strictEqual(back.skipped.length, 0, back.skipped.join());
  assert.strictEqual(back.doc.parts.filter(p => p.type !== 'GND').length, doc.parts.filter(p => p.type !== 'GND' && p.type !== 'PROBE').length);
  const r1 = simDoc(doc).r, r2 = simDoc(back.doc).r;
  near(r2.vectors['V(out)'][200], r1.vectors['V(out)'][200], 1e-6, 'same waveform after round-trip');
});

t('netlist import: op-amp X line maps to the op-amp symbol', () => {
  const text = 'inv\nV1 in 0 1\nVP vp 0 15\nVN vn 0 -15\nR1 in m 1k\nR2 m out 10k\nXU1 0 m out vp vn LUMEN_OPAMP Avol=1Meg\n.op\n';
  const { doc } = S.fromNetlist(text); const u = doc.parts.find(p => p.type === 'OPAMP'); assert(u, 'op-amp placed'); assert.strictEqual(u.ref, 'U1');
  const { r } = simDoc(doc); near(r.op['V(out)'], -10, 1e-3, 'gain after import');
});

t('Lumen PCB schematic import: the 555 sample maps passives, rails and LED', () => {
  const { samplePcb } = require('../../pcb/js/sample.js');
  const lp = { format: 'lumen-pcb', version: 2, doc: samplePcb() };
  const { doc, skipped } = S.fromLpcb(JSON.stringify(lp));
  assert(skipped.some(s => /U1/.test(s)) && skipped.some(s => /J1/.test(s)), 'IC and connector skipped: ' + skipped);
  const refs = doc.parts.filter(p => p.type !== 'GND').map(p => p.ref).sort();
  assert.deepStrictEqual(refs, ['C1', 'C2', 'D1', 'R1', 'R2', 'R3', 'V_5V']);
  const c = S.connectivity(doc), pin = (ref, n) => c.pinNet.get(doc.parts.findIndex(p => p.ref === ref) + ':' + n);
  assert.strictEqual(pin('R2', '2'), 'THR'); assert.strictEqual(pin('C1', '1'), 'THR'); assert.strictEqual(pin('D1', '2'), '0'); assert.strictEqual(pin('V_5V', '1'), '+5V');
  assert.strictEqual(doc.parts.find(p => p.ref === 'D1').type, 'LED');
  doc.sim = '.op'; const { r } = simDoc(doc); near(r.op['V(+5v)'], 5, 1e-9, 'rail source');
});

t('untrusted documents are sanitised', () => {
  const d = S.normalize({ parts: [{ type: 'R', ref: 'R1', x: 'NaN', y: 1e400, value: 5 }, { type: 'evil' }, null], wires: [{ x1: 0, y1: 0, x2: 0, y2: 0 }, 'x'], labels: [{ name: 'a b(c)', x: 1, y: 1 }], sim: 42, traces: [1, 'V(a)'] });
  assert.strictEqual(d.parts.length, 1); assert.strictEqual(d.parts[0].x, 0); assert.strictEqual(d.wires.length, 0); assert.strictEqual(d.labels[0].name, 'a_b_c_'); assert.deepStrictEqual(d.traces, ['V(a)']);
});

console.log(`\n${n} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
