// Lumen Spice sample schematics (built in code so they always match the part library).
(function (root) {
  'use strict';
  function builder(title, sim) {
    const doc = { title, parts: [], wires: [], labels: [], sim, directives: '', traces: [] };
    const api = {
      doc,
      P: (type, ref, x, y, value, o = {}) => { doc.parts.push({ type, ref, x, y, rot: o.rot || 0, mirror: !!o.mirror, value, extra: o.extra || '' }); return api; },
      W: (...pts) => { for (let i = 2; i < pts.length; i += 2) doc.wires.push({ x1: pts[i - 2], y1: pts[i - 1], x2: pts[i], y2: pts[i + 1] }); return api; },
      G: (x, y) => { doc.parts.push({ type: 'GND', ref: '', x, y, rot: 0, mirror: false, value: '', extra: '' }); return api; },
      L: (x, y, name) => { doc.labels.push({ x, y, name }); return api; },
      Pr: (x, y) => { doc.parts.push({ type: 'PROBE', ref: '', x, y, rot: 0, mirror: false, value: '', extra: '' }); return api; },
    };
    return api;
  }

  const SAMPLES = {
    ce: {
      name: 'Common-emitter amplifier (2N3904)',
      make() {
        const b = builder('Common-emitter amplifier', '.tran 0 5m 0 5u');
        b.P('V', 'VCC', 0, 10, '12').W(0, 7, 0, 4).L(0, 4, 'vcc').G(0, 13);
        b.P('R', 'R1', 20, 4, '47k').P('R', 'R2', 20, 16, '10k').G(20, 19).W(20, 7, 20, 13);
        b.P('R', 'RC', 30, 4, '4.7k').W(20, 1, 30, 1).L(25, 1, 'vcc').W(30, 7, 30, 10);
        b.P('NPN', 'Q1', 29, 13, '2N3904').W(27, 13, 20, 13);
        b.P('R', 'RE', 30, 19, '1k').G(30, 22).P('C', 'CE', 36, 19, '100u').W(30, 16, 36, 16).G(36, 22);
        b.P('C', 'C1', 13, 13, '10u', { rot: 1 }).W(16, 13, 20, 13);
        b.P('V', 'Vin', 6, 17, 'SIN(0 5m 1k) AC 5m').G(6, 20).W(6, 14, 6, 13, 10, 13).L(8, 13, 'in').Pr(9, 13);
        b.P('C', 'C2', 37, 10, '10u', { rot: 1 }).W(30, 10, 34, 10).W(40, 10, 46, 10);
        b.P('R', 'RL', 46, 13, '10k').G(46, 16).L(43, 10, 'out').Pr(44, 10);
        b.doc.traces = ['V(out)', 'V(in)'];
        return b.doc;
      },
    },
    sallen: {
      name: 'Sallen-Key low-pass filter (op-amp, .ac)',
      make() {
        const b = builder('Sallen-Key low-pass, 1 kHz Butterworth', '.ac dec 50 10 100k');
        b.P('V', 'Vin', 0, 6, 'DC 0 AC 1').G(0, 9).W(0, 3, 4, 3).L(2, 3, 'in');
        b.P('R', 'R1', 7, 3, '10k', { rot: 1 }).W(10, 3, 13, 3).P('R', 'R2', 16, 3, '10k', { rot: 1 });
        b.P('C', 'C1', 12, -3, '22n').W(12, 0, 12, 3).W(12, -6, 30, -6, 30, -2);
        b.P('C', 'C2', 19, 7, '10n').W(19, 3, 19, 4).G(19, 10);
        b.P('OPAMP', 'U1', 25, 2, 'Avol=1Meg GBW=10Meg Slew=10Meg').W(19, 3, 22, 3);
        b.W(22, 1, 20, 1, 20, -2, 30, -2, 30, 2).W(28, 2, 30, 2).W(30, 2, 35, 2).L(35, 2, 'out').Pr(33, 2);
        b.L(25, -1, 'vcc').L(25, 5, 'vee');
        b.P('V', 'V1', 42, 4, '15').L(42, 1, 'vcc').G(42, 7).P('V', 'V2', 48, 4, '-15').L(48, 1, 'vee').G(48, 7);
        b.doc.traces = ['V(out)'];
        return b.doc;
      },
    },
    rect: {
      name: 'Half-wave rectifier with smoothing capacitor',
      make() {
        const b = builder('Half-wave rectifier', '.tran 100m');
        b.P('V', 'V1', 0, 6, 'SIN(0 10 50)').G(0, 9).W(0, 3, 3, 3).L(1, 3, 'in').Pr(2, 3);
        b.P('D', 'D1', 6, 3, '1N4007', { rot: 3 }).W(9, 3, 20, 3);
        b.P('C', 'C1', 14, 6, '470u').G(14, 9).P('R', 'RL', 20, 6, '1k').G(20, 9).L(17, 3, 'out').Pr(18, 3);
        b.doc.traces = ['V(in)', 'V(out)'];
        return b.doc;
      },
    },
    cmos: {
      name: 'CMOS inverter transfer curve (.dc sweep)',
      make() {
        const b = builder('CMOS inverter', '.dc Vin 0 5 10m');
        b.P('V', 'VDD', -4, 6, '5').L(-4, 3, 'vdd').G(-4, 9);
        b.P('PMOS', 'MP', 17, 6, 'PMOS', { extra: 'W=30u L=1u' }).L(18, 3, 'vdd');
        b.P('NMOS', 'MN', 17, 15, 'NMOS', { extra: 'W=10u L=1u' }).G(18, 18);
        b.W(18, 9, 18, 12).W(18, 10, 24, 10).L(24, 10, 'out').Pr(22, 10);
        b.W(15, 6, 12, 6, 12, 15, 15, 15);
        b.P('V', 'Vin', 6, 14, '0').G(6, 17).W(6, 11, 6, 10, 12, 10).L(9, 10, 'in');
        b.doc.traces = ['V(out)', 'Id(MN)'];
        return b.doc;
      },
    },
    rlc: {
      name: 'Series RLC resonance (.ac)',
      make() {
        const b = builder('Series RLC resonance', '.ac dec 100 100 100k');
        b.P('V', 'V1', 0, 6, 'AC 1').G(0, 9).W(0, 3, 2, 3);
        b.P('R', 'R1', 5, 3, '10', { rot: 1 }).W(8, 3, 10, 3).P('L', 'L1', 13, 3, '10m', { rot: 1 }).W(16, 3, 19, 3);
        b.P('C', 'C1', 19, 6, '1u').G(19, 9).L(17, 3, 'cap').Pr(18, 3);
        b.doc.traces = ['V(cap)', 'I(V1)'];
        return b.doc;
      },
    },
    led: {
      name: 'MOSFET LED driver (pulse)',
      make() {
        const b = builder('MOSFET LED driver', '.tran 3m');
        b.P('V', 'V1', 0, 6, '5').L(0, 3, 'vcc').G(0, 9);
        b.P('R', 'R1', 14, 0, '150').L(14, -3, 'vcc').P('LED', 'D1', 14, 7, 'LED_RED').W(14, 3, 14, 4).W(14, 10, 14, 12).L(16, 12, 'drain').W(14, 12, 16, 12);
        b.P('NMOS', 'M1', 13, 15, '2N7000').G(14, 18).W(11, 15, 9, 15);
        b.P('R', 'RG', 6, 15, '100', { rot: 1 }).W(3, 15, 0, 15).P('V', 'Vg', 0, 18, 'PULSE(0 5 0.5m 1u 1u 0.5m 1m)').G(0, 21).L(1, 15, 'gate').Pr(2, 15);
        b.doc.traces = ['V(gate)', 'V(drain)', 'I(D1)'];
        return b.doc;
      },
    },
  };
  const api = { SAMPLES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SpiceSamples = api;
})(typeof self !== 'undefined' ? self : this);
