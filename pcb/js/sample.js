// Sample project: NE555 LED blinker (astable, ~1.4 Hz with 1k / 47k / 10µF).
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const Core = isNode ? require('./core.js') : root.PcbCore;
  function samplePcb() {
    const parts = [
      { ref: 'U1', lib: 'U8', value: 'NE555', fp: 'DIP_8', x: 30, y: 20, rot: 0 },
      { ref: 'R1', lib: 'R', value: '1k', fp: 'R_Axial_10mm', x: 14, y: 12, rot: 1 },
      { ref: 'R2', lib: 'R', value: '47k', fp: 'R_Axial_10mm', x: 14, y: 24, rot: 1 },
      { ref: 'C1', lib: 'CP', value: '10u', fp: 'CP_Radial_5mm', x: 20, y: 32, rot: 1 },
      { ref: 'C2', lib: 'C', value: '10n', fp: 'C_Disc_5mm', x: 46, y: 30, rot: 1 },
      { ref: 'R3', lib: 'R', value: '470', fp: 'R_Axial_10mm', x: 48, y: 14, rot: 0 },
      { ref: 'D1', lib: 'LED', value: 'Red', fp: 'LED_5mm', x: 58, y: 20, rot: 1 },
      { ref: 'J1', lib: 'J2', value: 'Power 5V', fp: 'Header_1x2', x: 8, y: 40, rot: 0 },
    ];
    const sch = { parts: parts.slice(), wires: [], labels: [] };
    const pin = (ref, n) => Core.pinsOf(sch.parts.find(p => p.ref === ref)).find(p => p.n === n);
    let pw = 1;
    // a short stub away from the part, then a net label or power symbol at its end
    const conn = (ref, n, net) => {
      const p = pin(ref, n), part = sch.parts.find(q => q.ref === ref);
      const dx = p.x - part.x, dy = p.y - part.y, h = Math.abs(dx) >= Math.abs(dy);
      const ex = p.x + (h ? Math.sign(dx || 1) * 2 : 0), ey = p.y + (h ? 0 : Math.sign(dy || 1) * 2);
      sch.wires.push({ pts: [[p.x, p.y], [ex, ey]] });
      if (net === 'GND' || net === '+5V') sch.parts.push({ ref: '#PWR0' + pw++, lib: net === 'GND' ? 'GND' : 'VCC', value: net, x: ex, y: ey, rot: 0 });
      else sch.labels.push({ x: ex, y: ey, name: net });
    };
    conn('U1', '8', '+5V'); conn('U1', '4', '+5V'); conn('U1', '1', 'GND');
    conn('R1', '1', '+5V'); conn('R1', '2', 'DIS'); conn('U1', '7', 'DIS');
    conn('R2', '1', 'DIS'); conn('R2', '2', 'THR'); conn('U1', '6', 'THR'); conn('U1', '2', 'THR');
    conn('C1', '1', 'THR'); conn('C1', '2', 'GND');
    conn('U1', '5', 'CTRL'); conn('C2', '1', 'CTRL'); conn('C2', '2', 'GND');
    conn('U1', '3', 'OUT'); conn('R3', '1', 'OUT'); conn('R3', '2', 'LED_A'); conn('D1', '2', 'LED_A'); conn('D1', '1', 'GND');
    conn('J1', '1', '+5V'); conn('J1', '2', 'GND');
    const board = { w: 60, h: 40, rules: { clearance: 0.2, track: 0.25, drill: 0.3, edge: 0.3 }, tracks: [], vias: [], parts: [
      { ref: 'U1', fp: 'DIP_8', x: 30, y: 20, rot: 0, side: 'top' },
      { ref: 'R1', fp: 'R_Axial_10mm', x: 13, y: 12, rot: 0, side: 'top' },
      { ref: 'R2', fp: 'R_Axial_10mm', x: 13, y: 20, rot: 0, side: 'top' },
      { ref: 'C1', fp: 'CP_Radial_5mm', x: 13, y: 29, rot: 0, side: 'top' },
      { ref: 'C2', fp: 'C_Disc_5mm', x: 30, y: 33, rot: 0, side: 'top' },
      { ref: 'R3', fp: 'R_Axial_10mm', x: 46, y: 12, rot: 0, side: 'top' },
      { ref: 'D1', fp: 'LED_5mm', x: 50, y: 25, rot: 90, side: 'top' },
      { ref: 'J1', fp: 'Header_1x2', x: 4, y: 33, rot: 0, side: 'top' },
    ] };
    return { name: '555 LED blinker', sch, board, netNames: true };
  }
  if (isNode) module.exports = { samplePcb }; else root.PcbSample = { samplePcb };
})(typeof self !== 'undefined' ? self : this);
