// Lumen Draft — sample drawing: a mounting plate with a section view, dimensions, hatch, blocks and notes.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(require('./model.js')); else root.LDSample = factory(root.LDModel); })(typeof self !== 'undefined' ? self : this, function (M) {
  'use strict';
  const D = Math.PI / 180, B90 = Math.tan(Math.PI / 8);
  function sampleDoc() {
    const d = M.newDoc();
    d.layers = [
      { name: '0', color: 7, lt: 'CONTINUOUS', lw: -3 },
      { name: 'OUTLINE', color: 7, lt: 'CONTINUOUS', lw: 50 },
      { name: 'CENTER', color: 1, lt: 'CENTER2', lw: 18 },
      { name: 'HIDDEN', color: 6, lt: 'HIDDEN2', lw: 25 },
      { name: 'HATCH', color: 8, lt: 'CONTINUOUS', lw: 13 },
      { name: 'DIMS', color: 4, lt: 'CONTINUOUS', lw: 18 },
      { name: 'TEXT', color: 3, lt: 'CONTINUOUS', lw: 25 },
      { name: 'CUTLINE', color: 2, lt: 'PHANTOM', lw: 35 },
    ];
    d.cur = 'OUTLINE'; d.ltscale = 0.5;
    d.blocks.HOLE10 = { base: [0, 0], ents: [
      { type: 'circle', layer: '0', cx: 0, cy: 0, r: 5 },
      { type: 'line', layer: 'CENTER', x1: -8, y1: 0, x2: 8, y2: 0 },
      { type: 'line', layer: 'CENTER', x1: 0, y1: -8, x2: 0, y2: 8 },
    ] };
    const E = [], add = e => E.push(e);
    const L = (layer, x1, y1, x2, y2) => add({ type: 'line', layer, x1, y1, x2, y2 });
    // front view profile
    add({ type: 'pline', layer: 'OUTLINE', closed: true, pts: [[10, 0, 0], [150, 0, B90], [160, 10, 0], [160, 80, 0], [140, 100, 0], [10, 100, B90], [0, 90, 0], [0, 10, B90]] });
    for (const [x, y] of [[15, 15], [145, 15], [15, 85]]) add({ type: 'insert', layer: 'OUTLINE', name: 'HOLE10', x, y, sx: 1, sy: 1, rot: 0 });
    add({ type: 'circle', layer: 'OUTLINE', cx: 80, cy: 50, r: 20 });
    L('CENTER', 54, 50, 106, 50); L('CENTER', 80, 24, 80, 76);
    add({ type: 'pline', layer: 'OUTLINE', closed: true, pts: [[65, 80, 0], [95, 80, 1], [95, 90, 0], [65, 90, 1]] });
    L('CENTER', 54, 85, 106, 85);
    // section cut line A–A
    L('CUTLINE', 80, -8, 80, 108);
    add({ type: 'pline', layer: 'CUTLINE', closed: false, pts: [[86, 108, 0], [80, 108, 0]] });
    add({ type: 'pline', layer: 'CUTLINE', closed: false, pts: [[86, -8, 0], [80, -8, 0]] });
    add({ type: 'text', layer: 'TEXT', x: 89, y: 108, h: 5, rot: 0, s: 'A', align: 0, valign: 2 });
    add({ type: 'text', layer: 'TEXT', x: 89, y: -8, h: 5, rot: 0, s: 'A', align: 0, valign: 2 });
    // section A–A (plate is 15 thick)
    const sx0 = 200, sx1 = 215;
    for (const [y0, y1] of [[0, 30], [70, 80], [90, 100]]) {
      add({ type: 'pline', layer: 'OUTLINE', closed: true, pts: [[sx0, y0, 0], [sx1, y0, 0], [sx1, y1, 0], [sx0, y1, 0]] });
      add({ type: 'hatch', layer: 'HATCH', pat: 'ANSI31', sc: 1, ang: 0, loops: [{ pts: [[sx0, y0, 0], [sx1, y0, 0], [sx1, y1, 0], [sx0, y1, 0]] }] });
    }
    L('CENTER', sx0 - 5, 50, sx1 + 5, 50); L('CENTER', sx0 - 5, 85, sx1 + 5, 85);
    L('HIDDEN', sx0, 30, sx0, 70); L('HIDDEN', sx1, 30, sx1, 70);
    // dimensions
    const dim = (o) => add({ type: 'dim', layer: 'DIMS', ...o });
    dim({ dt: 'lin', p1: [0, 10], p2: [160, 10], p: [80, -18], ang: 0 });
    dim({ dt: 'lin', p1: [10, 0], p2: [10, 100], p: [-16, 50], ang: Math.PI / 2 });
    dim({ dt: 'lin', p1: [0, 90], p2: [140, 100], p: [70, 114], ang: 0 });
    dim({ dt: 'lin', p1: [145, 15], p2: [145, 85], p: [176, 50], ang: Math.PI / 2, txt: '<>' });
    dim({ dt: 'dia', c: [80, 50], p1: [80 + 20 * Math.cos(45 * D), 50 + 20 * Math.sin(45 * D)], p: [80 + 34 * Math.cos(45 * D), 50 + 34 * Math.sin(45 * D)] });
    dim({ dt: 'rad', c: [10, 10], p1: [10 - 10 * Math.cos(45 * D), 10 - 10 * Math.sin(45 * D)], p: [-12, -12] });
    dim({ dt: 'lin', p1: [65, 90], p2: [95, 90], p: [80, 96], ang: 0 });
    dim({ dt: 'ang', c: [160, 80], p1: [160, 60], p2: [140, 100], p: [160 + 14 * Math.cos(200 * D), 80 + 14 * Math.sin(200 * D)] });
    dim({ dt: 'lin', p1: [sx0, 100], p2: [sx1, 100], p: [207.5, 110], ang: 0 });
    dim({ dt: 'dia', c: [145, 15], p1: [145 + 5 * Math.cos(-50 * D), 15 + 5 * Math.sin(-50 * D)], p: [168, -8], txt: '3× <> THRU' });
    // labels and notes
    add({ type: 'text', layer: 'TEXT', x: 80, y: -34, h: 4, rot: 0, s: 'FRONT VIEW', align: 1, valign: 0 });
    add({ type: 'text', layer: 'TEXT', x: 207.5, y: -34, h: 4, rot: 0, s: 'SECTION A–A', align: 1, valign: 0 });
    add({ type: 'mtext', layer: 'TEXT', x: 232, y: 100, h: 2.5, w: 80, rot: 0, attach: 1, s: 'NOTES:\n1. MATERIAL: AL 6061-T6, 15 THK.\n2. BREAK ALL SHARP EDGES 0.5 × 45°.\n3. UNTOLERANCED DIMENSIONS ±0.2.\n4. ANODISE CLEAR AFTER MACHINING.' });
    d.ents = E.map((e, i) => ({ ...e, id: i + 1 })); d.nextId = E.length + 1;
    d.layout = { paper: 'A3', scale: [1, 1], cx: null, cy: null, tb: true, title: 'MOUNTING PLATE', number: 'LD-1042', by: 'J. Law', checked: 'A. Reyes', date: '2026-10-17', rev: 'B', company: 'Lumen Works', sheet: '1 of 1' };
    return M.normalize(d);
  }
  return { sampleDoc };
});
