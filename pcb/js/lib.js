// Lumen PCB part library: schematic symbols (grid units) and footprints (millimetres).
// Symbol pin `n` connects to the footprint pad with the same number.
(function (root) {
  'use strict';
  // ---- footprints ----
  const smd2 = (pitch, w, h, body) => ({ pads: [{ n: '1', x: -pitch / 2, y: 0, w, h, shape: 'rect' }, { n: '2', x: pitch / 2, y: 0, w, h, shape: 'rect' }],
    silk: [['line', -body, -h / 2 - 0.25, body, -h / 2 - 0.25], ['line', -body, h / 2 + 0.25, body, h / 2 + 0.25]] });
  const tht2 = (pitch, dia, drill, silk, sq = false) => ({ pads: [{ n: '1', x: -pitch / 2, y: 0, w: dia, h: dia, shape: sq ? 'rect' : 'round', drill }, { n: '2', x: pitch / 2, y: 0, w: dia, h: dia, shape: 'round', drill }], silk });
  function dip(n) {
    const h = n / 2, pads = [], y0 = -(h - 1) * 1.27;
    for (let i = 0; i < h; i++) pads.push({ n: String(i + 1), x: -3.81, y: y0 + i * 2.54, w: 1.6, h: 1.6, shape: i ? 'round' : 'rect', drill: 0.8 });
    for (let i = 0; i < h; i++) pads.push({ n: String(n - i), x: 3.81, y: y0 + i * 2.54, w: 1.6, h: 1.6, shape: 'round', drill: 0.8 });
    const L = (h - 1) * 1.27 + 1.3;
    return { pads, silk: [['rect', -2.6, -L, 2.6, L], ['arc', 0, -L, 0.8]] };
  }
  function soic(n) {
    const h = n / 2, pads = [], y0 = -(h - 1) * 0.635;
    for (let i = 0; i < h; i++) pads.push({ n: String(i + 1), x: -2.7, y: y0 + i * 1.27, w: 1.55, h: 0.6, shape: 'rect' });
    for (let i = 0; i < h; i++) pads.push({ n: String(n - i), x: 2.7, y: y0 + i * 1.27, w: 1.55, h: 0.6, shape: 'rect' });
    const L = (h - 1) * 0.635 + 0.6;
    return { pads, silk: [['rect', -1.95, -L, 1.95, L], ['circle', -1.3, -L + 0.6, 0.25]] };
  }
  function header(n) {
    const pads = []; for (let i = 0; i < n; i++) pads.push({ n: String(i + 1), x: 0, y: (i - (n - 1) / 2) * 2.54, w: 1.7, h: 1.7, shape: i ? 'round' : 'rect', drill: 1.0 });
    const L = n * 1.27; return { pads, silk: [['rect', -1.33, -L, 1.33, L]] };
  }
  const FP = {
    R_0603: smd2(1.6, 0.8, 0.95, 0.3), R_0805: smd2(1.9, 1.0, 1.3, 0.4), R_1206: smd2(3.0, 1.15, 1.8, 0.9),
    C_0603: smd2(1.6, 0.8, 0.95, 0.3), C_0805: smd2(1.9, 1.0, 1.3, 0.4), LED_0805: { ...smd2(1.9, 1.0, 1.3, 0.4), silk: [['line', -1.6, -0.9, 1.0, -0.9], ['line', -1.6, 0.9, 1.0, 0.9], ['line', -1.6, -0.9, -1.6, 0.9]] },
    R_Axial_10mm: tht2(10.16, 1.6, 0.8, [['rect', -3.2, -1.2, 3.2, 1.2], ['line', -5.08 + 0.9, 0, -3.2, 0], ['line', 3.2, 0, 5.08 - 0.9, 0]]),
    C_Disc_5mm: tht2(5.08, 1.6, 0.8, [['rect', -3.4, -1.3, 3.4, 1.3]]),
    CP_Radial_5mm: tht2(2.0, 1.6, 0.8, [['circle', 0, 0, 2.6], ['line', -2.6, -2.2, -1.8, -2.2], ['line', -2.2, -2.6, -2.2, -1.8]], true),
    D_DO35: tht2(7.62, 1.6, 0.8, [['rect', -2.0, -1.0, 2.0, 1.0], ['line', -1.4, -1.0, -1.4, 1.0]], true),
    LED_5mm: tht2(2.54, 1.8, 0.9, [['circle', 0, 0, 2.6]], true),
    TO_92: { pads: [-1.27, 0, 1.27].map((x, i) => ({ n: String(i + 1), x, y: 0, w: 1.05, h: 1.5, shape: 'oval', drill: 0.75 })), silk: [['arc', 0, 0, 2.5]] },
    SOT_23: { pads: [{ n: '1', x: -0.95, y: 1.0, w: 0.6, h: 0.7, shape: 'rect' }, { n: '2', x: 0.95, y: 1.0, w: 0.6, h: 0.7, shape: 'rect' }, { n: '3', x: 0, y: -1.0, w: 0.6, h: 0.7, shape: 'rect' }], silk: [['rect', -1.5, -0.65, 1.5, 0.65]] },
    TO_220: { pads: [-2.54, 0, 2.54].map((x, i) => ({ n: String(i + 1), x, y: 0, w: 1.8, h: 2.4, shape: i ? 'oval' : 'rect', drill: 1.1 })), silk: [['rect', -5.1, -1.9, 5.1, 2.6], ['line', -5.1, -1.2, 5.1, -1.2]] },
    DIP_8: dip(8), DIP_14: dip(14), DIP_16: dip(16), SOIC_8: soic(8), SOIC_14: soic(14),
    Header_1x2: header(2), Header_1x3: header(3), Header_1x4: header(4), Header_1x6: header(6), Header_1x8: header(8),
    SW_Tactile_6mm: tht2(6.5, 2.0, 1.1, [['rect', -3, -3, 3, 3], ['circle', 0, 0, 1.75]]),
    Crystal_HC49: tht2(4.88, 1.5, 0.8, [['rect', -5.6, -2.3, 5.6, 2.3]]),
    L_1210: smd2(2.9, 1.3, 2.7, 0.8), Fuse_1206: smd2(3.0, 1.15, 1.8, 0.9),
    L_Radial_5mm: tht2(5.0, 1.8, 1.0, [['circle', 0, 0, 3.6]]),
    Pot_Trimmer_3pin: { pads: [-2.54, 0, 2.54].map((x, i) => ({ n: String(i + 1), x, y: i === 1 ? -2.54 : 0, w: 1.8, h: 1.8, shape: i ? 'round' : 'rect', drill: 1.0 })), silk: [['rect', -4.8, -4.6, 4.8, 1.8], ['circle', 0, -1.4, 1.8]] },
    Buzzer_12mm: tht2(7.6, 2.0, 1.0, [['circle', 0, 0, 6.2]], true),
    DIP_SW_4: { pads: [0, 1, 2, 3].flatMap(i => [{ n: String(i + 1), x: -3.81, y: (i - 1.5) * 2.54, w: 1.6, h: 1.6, shape: i ? 'round' : 'rect', drill: 0.8 }, { n: String(8 - i), x: 3.81, y: (i - 1.5) * 2.54, w: 1.6, h: 1.6, shape: 'round', drill: 0.8 }]), silk: [['rect', -5.1, -5.4, 5.1, 5.4]] },
    MountingHole_3mm: { pads: [{ n: '1', x: 0, y: 0, w: 6, h: 6, shape: 'round', drill: 3.2 }], silk: [['circle', 0, 0, 3.4]] },
  };

  // ---- symbols (1 unit = one schematic grid step) ----
  const twoPin = (draw, a = -3, b = 3, names) => ({ pins: [{ n: '1', x: a, y: 0, name: names && names[0] }, { n: '2', x: b, y: 0, name: names && names[1] }], draw });
  function icSym(n, names) {
    // two grid steps between pins so labels and power ports on neighbouring pins don't collide
    const h = n / 2, pins = [], top = -(h - 1);
    for (let i = 0; i < h; i++) pins.push({ n: String(i + 1), x: -6, y: top + 2 * i, name: names && names[i] });
    for (let i = 0; i < h; i++) pins.push({ n: String(n - i), x: 6, y: top + 2 * i, name: names && names[n - i - 1] });
    return { pins, draw: [['rect', -4, top - 1, 4, -top + 1], ['circle', -3.3, top - 0.4, 0.25]], pinLen: 2 };
  }
  function headerSym(n) { const pins = []; for (let i = 0; i < n; i++) pins.push({ n: String(i + 1), x: -3, y: 2 * i }); return { pins, draw: [['rect', -1, -1, 1, 2 * n - 1]], pinLen: 2 }; }
  const PARTS = [
    { id: 'R', name: 'Resistor', prefix: 'R', value: '10k', fps: ['R_0805', 'R_0603', 'R_1206', 'R_Axial_10mm'],
      sym: twoPin([['line', -3, 0, -1.5, 0], ['rect', -1.5, -0.6, 1.5, 0.6], ['line', 1.5, 0, 3, 0]]) },
    { id: 'C', name: 'Capacitor', prefix: 'C', value: '100n', fps: ['C_0805', 'C_0603', 'C_Disc_5mm'],
      sym: twoPin([['line', -2, 0, -0.3, 0], ['line', -0.3, -1, -0.3, 1], ['line', 0.3, -1, 0.3, 1], ['line', 0.3, 0, 2, 0]], -2, 2) },
    { id: 'CP', name: 'Capacitor, polarized', prefix: 'C', value: '10u', fps: ['CP_Radial_5mm'],
      sym: twoPin([['line', -2, 0, -0.3, 0], ['line', -0.3, -1, -0.3, 1], ['arc2', 0.9, 0, 0.6], ['line', 0.3, 0, 2, 0], ['text', -1.2, -0.9, '+']], -2, 2, ['+', '−']) },
    { id: 'D', name: 'Diode', prefix: 'D', value: '1N4148', fps: ['D_DO35'],
      sym: { pins: [{ n: '1', x: 3, y: 0, name: 'K' }, { n: '2', x: -3, y: 0, name: 'A' }], draw: [['line', -3, 0, -1, 0], ['poly', [[-1, -1], [-1, 1], [1, 0]]], ['line', 1, -1, 1, 1], ['line', 1, 0, 3, 0]] } },
    { id: 'LED', name: 'LED', prefix: 'D', value: 'Red', fps: ['LED_5mm', 'LED_0805'],
      sym: { pins: [{ n: '1', x: 3, y: 0, name: 'K' }, { n: '2', x: -3, y: 0, name: 'A' }], draw: [['line', -3, 0, -1, 0], ['poly', [[-1, -1], [-1, 1], [1, 0]]], ['line', 1, -1, 1, 1], ['line', 1, 0, 3, 0], ['line', 0, -1.3, 1, -2.3], ['line', 0.8, -1.2, 1.8, -2.2]] } },
    { id: 'NPN', name: 'NPN transistor', prefix: 'Q', value: '2N3904', fps: ['TO_92', 'SOT_23'],
      sym: { pins: [{ n: '2', x: -3, y: 0, name: 'B' }, { n: '3', x: 2, y: -3, name: 'C' }, { n: '1', x: 2, y: 3, name: 'E' }],
        draw: [['line', -3, 0, -0.5, 0], ['line', -0.5, -1.5, -0.5, 1.5], ['line', -0.5, -0.6, 2, -2], ['line', 2, -2, 2, -3], ['line', -0.5, 0.6, 2, 2], ['line', 2, 2, 2, 3], ['poly', [[2, 2], [1.1, 1.9], [1.6, 1.2]]], ['circle', 0.6, 0, 2.3]] } },
    { id: 'PNP', name: 'PNP transistor', prefix: 'Q', value: '2N3906', fps: ['TO_92', 'SOT_23'],
      sym: { pins: [{ n: '2', x: -3, y: 0, name: 'B' }, { n: '1', x: 2, y: -3, name: 'E' }, { n: '3', x: 2, y: 3, name: 'C' }],
        draw: [['line', -3, 0, -0.5, 0], ['line', -0.5, -1.5, -0.5, 1.5], ['line', -0.5, -0.6, 2, -2], ['line', 2, -2, 2, -3], ['line', -0.5, 0.6, 2, 2], ['line', 2, 2, 2, 3], ['poly', [[-0.4, -0.6], [0.5, -0.5], [0.0, -1.2]]], ['circle', 0.6, 0, 2.3]] } },
    { id: 'U8', name: 'IC, 8 pins (e.g. NE555)', prefix: 'U', value: 'NE555', fps: ['DIP_8', 'SOIC_8'], sym: icSym(8, ['GND', 'TRIG', 'OUT', 'RST', 'CTRL', 'THR', 'DIS', 'VCC']) },
    { id: 'U14', name: 'IC, 14 pins', prefix: 'U', value: '74HC00', fps: ['DIP_14', 'SOIC_14'], sym: icSym(14) },
    { id: 'U16', name: 'IC, 16 pins', prefix: 'U', value: 'IC', fps: ['DIP_16'], sym: icSym(16) },
    { id: 'REG', name: 'Voltage regulator', prefix: 'U', value: '7805', fps: ['TO_220'],
      sym: { pins: [{ n: '1', x: -5, y: 0, name: 'IN' }, { n: '2', x: 0, y: 3, name: 'GND' }, { n: '3', x: 5, y: 0, name: 'OUT' }], draw: [['rect', -3, -1.5, 3, 1.5]], pinLen: 2 } },
    { id: 'J2', name: 'Connector, 2 pins', prefix: 'J', value: 'Conn', fps: ['Header_1x2'], sym: headerSym(2) },
    { id: 'J3', name: 'Connector, 3 pins', prefix: 'J', value: 'Conn', fps: ['Header_1x3'], sym: headerSym(3) },
    { id: 'J4', name: 'Connector, 4 pins', prefix: 'J', value: 'Conn', fps: ['Header_1x4'], sym: headerSym(4) },
    { id: 'J6', name: 'Connector, 6 pins', prefix: 'J', value: 'Conn', fps: ['Header_1x6'], sym: headerSym(6) },
    { id: 'J8', name: 'Connector, 8 pins', prefix: 'J', value: 'Conn', fps: ['Header_1x8'], sym: headerSym(8) },
    { id: 'SW', name: 'Push button', prefix: 'SW', value: 'Button', fps: ['SW_Tactile_6mm'],
      sym: twoPin([['line', -3, 0, -1.2, 0], ['circle', -1, 0, 0.2], ['circle', 1, 0, 0.2], ['line', -1, -0.4, 1.2, -1.1], ['line', 1.2, 0, 3, 0]]) },
    { id: 'Y', name: 'Crystal', prefix: 'Y', value: '16MHz', fps: ['Crystal_HC49'],
      sym: twoPin([['line', -3, 0, -0.8, 0], ['line', -0.8, -1, -0.8, 1], ['rect', -0.4, -1.2, 0.4, 1.2], ['line', 0.8, -1, 0.8, 1], ['line', 0.8, 0, 3, 0]]) },
    { id: 'L', name: 'Inductor', prefix: 'L', value: '10u', fps: ['L_1210', 'L_Radial_5mm'],
      sym: twoPin([['line', -3, 0, -2, 0], ['arc2', -1.5, 0, 0.5], ['arc2', -0.5, 0, 0.5], ['arc2', 0.5, 0, 0.5], ['arc2', 1.5, 0, 0.5], ['line', 2, 0, 3, 0]]) },
    { id: 'F', name: 'Fuse', prefix: 'F', value: '500mA', fps: ['Fuse_1206'], sym: twoPin([['line', -3, 0, -1.5, 0], ['rect', -1.5, -0.5, 1.5, 0.5], ['line', -1.5, 0, 1.5, 0], ['line', 1.5, 0, 3, 0]]) },
    { id: 'RV', name: 'Potentiometer / trimmer', prefix: 'RV', value: '10k', fps: ['Pot_Trimmer_3pin'],
      sym: { pins: [{ n: '1', x: -3, y: 0 }, { n: '2', x: 0, y: -3, name: 'W' }, { n: '3', x: 3, y: 0 }], draw: [['line', -3, 0, -1.5, 0], ['rect', -1.5, -0.6, 1.5, 0.6], ['line', 1.5, 0, 3, 0], ['line', 0, -3, 0, -1], ['poly', [[0, -0.6], [-0.4, -1.3], [0.4, -1.3]]]] } },
    { id: 'NMOS', name: 'N-channel MOSFET', prefix: 'Q', value: '2N7000', fps: ['TO_92', 'SOT_23'],
      sym: { pins: [{ n: '2', x: -3, y: 0, name: 'G' }, { n: '3', x: 2, y: -3, name: 'D' }, { n: '1', x: 2, y: 3, name: 'S' }],
        draw: [['line', -3, 0, -0.8, 0], ['line', -0.8, -1.4, -0.8, 1.4], ['line', -0.3, -1.6, -0.3, -0.8], ['line', -0.3, -0.4, -0.3, 0.4], ['line', -0.3, 0.8, -0.3, 1.6], ['line', -0.3, -1.2, 2, -1.2], ['line', 2, -1.2, 2, -3], ['line', -0.3, 1.2, 2, 1.2], ['line', 2, 1.2, 2, 3], ['line', -0.3, 0, 2, 0], ['line', 2, 0, 2, 1.2], ['poly', [[-0.3, 0], [0.5, -0.4], [0.5, 0.4]]], ['circle', 0.7, 0, 2.3]] } },
    { id: 'BZ', name: 'Buzzer', prefix: 'BZ', value: 'Buzzer', fps: ['Buzzer_12mm'], sym: twoPin([['line', -3, 0, -1, 0], ['circle', 0, -0.3, 1.2], ['line', 1, 0, 3, 0], ['text', 0, -0.3, '♪']], -3, 3, ['+', '−']) },
    { id: 'SW4', name: 'DIP switch, 4 ways', prefix: 'SW', value: 'DIP-4', fps: ['DIP_SW_4'], sym: icSym(8) },
    { id: 'MH', name: 'Mounting hole', prefix: 'H', value: 'M3', fps: ['MountingHole_3mm'], sym: { pins: [{ n: '1', x: 0, y: 0 }], draw: [['circle', 0, 0, 1], ['circle', 0, 0, 0.4]], nopin: true } },
    { id: 'GND', name: 'Ground', prefix: '#PWR', value: 'GND', power: true, sym: { pins: [{ n: '1', x: 0, y: 0 }], draw: [['line', 0, 0, 0, 1], ['line', -1, 1, 1, 1], ['line', -0.6, 1.4, 0.6, 1.4], ['line', -0.2, 1.8, 0.2, 1.8]] } },
    { id: 'VCC', name: 'Power rail (+5V, +3V3…)', prefix: '#PWR', value: '+5V', power: true, sym: { pins: [{ n: '1', x: 0, y: 0 }], draw: [['line', 0, 0, 0, -1], ['line', -1, -1, 1, -1], ['vtext', 0, -1.7, '']] } },
  ];
  const PART = Object.fromEntries(PARTS.map(p => [p.id, p]));
  const api = { FP, PARTS, PART };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PcbLib = api;
})(typeof self !== 'undefined' ? self : this);
