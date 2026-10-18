// Lumen Spice part library: schematic symbols in grid units (y grows down), pin order, defaults and the
// SPICE card each part emits. Rotation = quarter turns clockwise, mirror flips x before rotating.
(function (root) {
  'use strict';
  const zig = [[0, -3, 0, -2]]; const zz = [[0, -2], [0.6, -1.67], [-0.6, -1], [0.6, -0.33], [-0.6, 0.33], [0.6, 1], [-0.6, 1.67], [0, 2]];
  for (let i = 1; i < zz.length; i++) zig.push([zz[i - 1][0], zz[i - 1][1], zz[i][0], zz[i][1]]);
  zig.push([0, 2, 0, 3]);
  const L = a => a.map(s => ['line', ...s]);
  const two = [{ n: '1', x: 0, y: -3 }, { n: '2', x: 0, y: 3 }];
  const diodeBody = [['line', 0, -3, 0, -0.8], ['poly', [[-1, -0.8], [1, -0.8], [0, 0.8]], true], ['line', 0, 0.8, 0, 3]];
  const ctlPins = [{ n: '1', x: 0, y: -3, name: '+' }, { n: '2', x: 0, y: 3, name: '−' }, { n: '3', x: -3, y: -1, name: 'c+' }, { n: '4', x: -3, y: 1, name: 'c−' }];
  const diamond = [['line', 0, -3, 0, -1.4], ['line', 0, 1.4, 0, 3], ['poly', [[0, -1.4], [1.4, 0], [0, 1.4], [-1.4, 0]], false], ['line', -3, -1, -1.6, -1], ['line', -3, 1, -1.6, 1], ['text', -2.4, -1.5, '+', 0.8], ['text', -2.4, 0.5, '−', 0.8]];

  const PARTS = [
    { id: 'R', name: 'Resistor', prefix: 'R', key: 'R', value: '1k', pins: two, draw: L(zig), hint: 'Resistance, e.g. 4.7k or 4k7' },
    { id: 'C', name: 'Capacitor', prefix: 'C', key: 'C', value: '1u', pins: two, draw: L([[0, -3, 0, -0.35], [-1.3, -0.35, 1.3, -0.35], [-1.3, 0.35, 1.3, 0.35], [0, 0.35, 0, 3]]), hint: 'Capacitance; add IC=… in Extra for an initial voltage' },
    { id: 'L', name: 'Inductor', prefix: 'L', key: 'L', value: '1m', pins: two, draw: [['line', 0, -3, 0, -2], ['arc', 0, -1.5, 0.5, -90, 90], ['arc', 0, -0.5, 0.5, -90, 90], ['arc', 0, 0.5, 0.5, -90, 90], ['arc', 0, 1.5, 0.5, -90, 90], ['line', 0, 2, 0, 3]], hint: 'Inductance' },
    { id: 'D', name: 'Diode', prefix: 'D', key: 'D', value: '1N4148', model: 'd', pins: [{ n: '1', x: 0, y: -3, name: 'A' }, { n: '2', x: 0, y: 3, name: 'K' }], draw: [...diodeBody, ['line', -1, 0.8, 1, 0.8]] },
    { id: 'DZ', name: 'Zener diode', prefix: 'D', value: '1N750', model: 'd', pins: [{ n: '1', x: 0, y: -3, name: 'A' }, { n: '2', x: 0, y: 3, name: 'K' }], draw: [...diodeBody, ['line', -1, 0.8, 1, 0.8], ['line', -1, 0.8, -1.3, 0.4], ['line', 1, 0.8, 1.3, 1.2]] },
    { id: 'LED', name: 'LED', prefix: 'D', value: 'LED_RED', model: 'd', pins: [{ n: '1', x: 0, y: -3, name: 'A' }, { n: '2', x: 0, y: 3, name: 'K' }], draw: [...diodeBody, ['line', -1, 0.8, 1, 0.8], ['line', 1.2, -0.4, 2.1, -1.1], ['poly', [[2.1, -1.1], [1.55, -1.05], [1.85, -0.7]], true], ['line', 1.3, 0.4, 2.2, -0.3], ['poly', [[2.2, -0.3], [1.65, -0.25], [1.95, 0.1]], true]] },
    { id: 'V', name: 'Voltage source', prefix: 'V', key: 'V', value: '5', pins: [{ n: '1', x: 0, y: -3, name: '+' }, { n: '2', x: 0, y: 3, name: '−' }], draw: [['line', 0, -3, 0, -1.6], ['circle', 0, 0, 1.6], ['line', 0, 1.6, 0, 3]], source: true, hint: 'DC value, or PULSE(…), SIN(…), PWL(…), EXP(…); add AC 1 for .ac' },
    { id: 'I', name: 'Current source', prefix: 'I', key: 'I', value: '1m', pins: [{ n: '1', x: 0, y: -3 }, { n: '2', x: 0, y: 3 }], draw: [['line', 0, -3, 0, -1.6], ['circle', 0, 0, 1.6], ['line', 0, 1.6, 0, 3], ['line', 0, -0.9, 0, 0.6], ['poly', [[0, 1], [-0.45, 0.25], [0.45, 0.25]], true]], source: true, hint: 'Current flows from the top pin through the source and out of the bottom pin' },
    { id: 'NPN', name: 'NPN transistor', prefix: 'Q', key: 'Q', value: '2N3904', model: 'npn', pins: [{ n: 'C', x: 1, y: -3, name: 'C' }, { n: 'B', x: -2, y: 0, name: 'B' }, { n: 'E', x: 1, y: 3, name: 'E' }],
      draw: L([[-2, 0, -0.6, 0], [-0.6, -1.2, -0.6, 1.2], [-0.6, -0.5, 1, -1.5], [1, -1.5, 1, -3], [-0.6, 0.5, 1, 1.5], [1, 1.5, 1, 3]]).concat([['poly', [[1, 1.5], [0.25, 1.35], [0.6, 0.8]], true], ['circle', 0.2, 0, 1.9, true]]) },
    { id: 'PNP', name: 'PNP transistor', prefix: 'Q', value: '2N3906', model: 'pnp', pins: [{ n: 'C', x: 1, y: 3, name: 'C' }, { n: 'B', x: -2, y: 0, name: 'B' }, { n: 'E', x: 1, y: -3, name: 'E' }],
      draw: L([[-2, 0, -0.6, 0], [-0.6, -1.2, -0.6, 1.2], [-0.6, -0.5, 1, -1.5], [1, -1.5, 1, -3], [-0.6, 0.5, 1, 1.5], [1, 1.5, 1, 3]]).concat([['poly', [[-0.6, -0.5], [0.15, -0.6], [-0.2, -1.15]], true], ['circle', 0.2, 0, 1.9, true]]) },
    { id: 'NMOS', name: 'N-channel MOSFET', prefix: 'M', key: 'M', value: '2N7000', model: 'nmos', pins: [{ n: 'D', x: 1, y: -3, name: 'D' }, { n: 'G', x: -2, y: 0, name: 'G' }, { n: 'S', x: 1, y: 3, name: 'S' }],
      draw: L([[-2, 0, -0.9, 0], [-0.9, -1.2, -0.9, 1.2], [-0.4, -1.4, -0.4, -0.6], [-0.4, -0.4, -0.4, 0.4], [-0.4, 0.6, -0.4, 1.4], [-0.4, -1, 1, -1], [1, -1, 1, -3], [-0.4, 1, 1, 1], [1, 1, 1, 3], [1, 1, 1, 0], [1, 0, -0.4, 0]]).concat([['poly', [[-0.4, 0], [0.3, -0.35], [0.3, 0.35]], true]]) },
    { id: 'PMOS', name: 'P-channel MOSFET', prefix: 'M', value: 'BS250', model: 'pmos', pins: [{ n: 'D', x: 1, y: 3, name: 'D' }, { n: 'G', x: -2, y: 0, name: 'G' }, { n: 'S', x: 1, y: -3, name: 'S' }],
      draw: L([[-2, 0, -0.9, 0], [-0.9, -1.2, -0.9, 1.2], [-0.4, -1.4, -0.4, -0.6], [-0.4, -0.4, -0.4, 0.4], [-0.4, 0.6, -0.4, 1.4], [-0.4, -1, 1, -1], [1, -1, 1, -3], [-0.4, 1, 1, 1], [1, 1, 1, 3], [1, -1, 1, 0], [1, 0, -0.4, 0]]).concat([['poly', [[1, 0], [0.3, -0.35], [0.3, 0.35]], true]]) },
    { id: 'OPAMP', name: 'Op-amp', prefix: 'U', key: 'A', value: 'Avol=1Meg GBW=10Meg Slew=10Meg', pins: [{ n: '-', x: -3, y: -1, name: 'in−' }, { n: '+', x: -3, y: 1, name: 'in+' }, { n: 'O', x: 3, y: 0, name: 'out' }, { n: 'V+', x: 0, y: -3, name: 'V+' }, { n: 'V-', x: 0, y: 3, name: 'V−' }],
      draw: [['poly', [[-2, -2.2], [-2, 2.2], [2.4, 0]], false], ['line', -3, -1, -2, -1], ['line', -3, 1, -2, 1], ['line', 2.4, 0, 3, 0], ['line', 0, -3, 0, -1.2], ['line', 0, 1.2, 0, 3], ['text', -1.45, -1, '−', 0.9], ['text', -1.45, 1, '+', 0.9]],
      hint: 'Macro model parameters. Leave V+ and V− unconnected for an ideal op-amp without rails' },
    { id: 'SW', name: 'Switch (manual)', prefix: 'S', value: 'open', pins: two, draw: L([[0, -3, 0, -1.2], [0, 1.2, 0, 3]]).concat([['circle', 0, -1.2, 0.18], ['circle', 0, 1.2, 0.18]]), hint: 'open or closed (Space toggles the selected switch)' },
    { id: 'VSW', name: 'Voltage-controlled switch', prefix: 'S', value: 'SW', model: 'sw', pins: [{ n: '1', x: 0, y: -3 }, { n: '2', x: 0, y: 3 }, { n: '3', x: -3, y: -1, name: 'c+' }, { n: '4', x: -3, y: 1, name: 'c−' }],
      draw: L([[0, -3, 0, -1.2], [0, 1.2, 0, 3], [0, 1.2, 0.9, -1.1], [-3, -1, -1.6, -1], [-3, 1, -1.6, 1]]).concat([['circle', 0, -1.2, 0.18], ['rect', -1.6, -1.5, -0.9, 1.5], ['text', -2.4, -1.5, '+', 0.8], ['text', -2.4, 0.5, '−', 0.8]]), hint: 'SW model name (VT threshold, RON/ROFF); define your own with .model' },
    { id: 'E', name: 'Voltage-controlled voltage source (E)', prefix: 'E', value: '10', pins: ctlPins, draw: diamond.concat([['text', 0, -0.55, '+', 0.8], ['text', 0, 0.55, '−', 0.8]]), hint: 'Gain V(out)/V(ctrl)' },
    { id: 'G', name: 'Voltage-controlled current source (G)', prefix: 'G', value: '1m', pins: ctlPins, draw: diamond.concat([['line', 0, -0.8, 0, 0.5], ['poly', [[0, 0.85], [-0.35, 0.3], [0.35, 0.3]], true]]), hint: 'Transconductance in siemens' },
    { id: 'F', name: 'Current-controlled current source (F)', prefix: 'F', value: 'V1 1', pins: two, draw: L([[0, -3, 0, -1.4], [0, 1.4, 0, 3]]).concat([['poly', [[0, -1.4], [1.4, 0], [0, 1.4], [-1.4, 0]], false], ['line', 0, -0.8, 0, 0.5], ['poly', [[0, 0.85], [-0.35, 0.3], [0.35, 0.3]], true]]), hint: 'Controlling voltage source name and gain, e.g. V1 2' },
    { id: 'H', name: 'Current-controlled voltage source (H)', prefix: 'H', value: 'V1 1k', pins: two, draw: L([[0, -3, 0, -1.4], [0, 1.4, 0, 3]]).concat([['poly', [[0, -1.4], [1.4, 0], [0, 1.4], [-1.4, 0]], false], ['text', 0, -0.55, '+', 0.8], ['text', 0, 0.55, '−', 0.8]]), hint: 'Controlling voltage source name and transresistance, e.g. V1 1k' },
    { id: 'GND', name: 'Ground', prefix: '#', key: 'G', value: '', pins: [{ n: '1', x: 0, y: 0 }], draw: L([[0, 0, 0, 0.8], [-1.1, 0.8, 1.1, 0.8], [-0.7, 1.25, 0.7, 1.25], [-0.3, 1.7, 0.3, 1.7]]), power: true },
    { id: 'PROBE', name: 'Probe marker', prefix: '#P', key: 'P', value: '', pins: [{ n: '1', x: 0, y: 0 }], draw: [['line', 0, 0, 0.9, -0.9], ['circle', 1.3, -1.3, 0.55, 'fill']], power: true, hint: 'Plots this net automatically after every run' },
    { id: 'SUBX', name: 'Subcircuit block (X)', prefix: 'X', value: 'MYSUB', pins: [], draw: [], dyn: true, hint: 'Name of a .subckt defined in the SPICE directives' },
  ];
  const PART = Object.fromEntries(PARTS.map(p => [p.id, p]));

  // pins of a SUBX block come from its .subckt definition (count and names); laid out on two sides
  function subxPins(n, names) {
    const left = Math.ceil(n / 2), right = n - left, pins = [];
    for (let i = 0; i < left; i++) pins.push({ n: String(i + 1), x: -4, y: -(left - 1) + 2 * i, name: names && names[i] });
    for (let i = 0; i < right; i++) pins.push({ n: String(left + i + 1), x: 4, y: -(right - 1) + 2 * i, name: names && names[left + i] });
    return pins;
  }
  function defOf(part) {
    const d = PART[part.type]; if (!d) return null;
    if (d.dyn) {
      const n = Math.max(1, Math.min(40, part.pinCount || 2)), pins = subxPins(n, part.pinNames), h = Math.max(Math.ceil(n / 2), 1);
      const draw = [['rect', -3, -h, 3, h]]; pins.forEach(p => draw.push(['line', p.x, p.y, p.x < 0 ? -3 : 3, p.y]));
      return { ...d, pins, draw };
    }
    return d;
  }
  function xform(p, x, y) {
    if (p.mirror) x = -x;
    for (let k = 0; k < ((p.rot || 0) % 4 + 4) % 4; k++) [x, y] = [-y, x];
    return [p.x + x, p.y + y];
  }
  function pinsOf(part) {
    const d = defOf(part); if (!d) return [];
    return d.pins.map(q => { const [x, y] = xform(part, q.x, q.y); return { n: q.n, name: q.name, x, y }; });
  }
  function bbox(part) {
    const d = defOf(part); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { const [a, b] = xform(part, x, y); x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); };
    d.pins.forEach(q => add(q.x, q.y));
    d.draw.forEach(s => {
      if (s[0] === 'line' || s[0] === 'rect') { add(s[1], s[2]); add(s[3], s[4]); }
      else if (s[0] === 'circle' || s[0] === 'arc') { add(s[1] - s[3], s[2] - s[3]); add(s[1] + s[3], s[2] + s[3]); }
      else if (s[0] === 'poly') s[1].forEach(([x, y]) => add(x, y));
    });
    if (part.type === 'V' || part.type === 'I') { add(-1.6, -1.6); add(1.6, 1.6); }
    return [x0, y0, x1, y1];
  }

  const api = { PARTS, PART, defOf, pinsOf, xform, bbox, subxPins };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SpiceParts = api;
})(typeof self !== 'undefined' ? self : this);
