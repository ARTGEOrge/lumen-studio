// Sample part: a parametric angle bracket — change w, d, t, H or hole and every feature follows.
(function (root) {
  function sampleCad() {
    return {
      name: 'Angle bracket', density: 2.70, units: 'mm',
      params: [
        { name: 'w', expr: '80', note: 'width' }, { name: 'd', expr: '50', note: 'base depth' }, { name: 't', expr: '8', note: 'plate thickness' },
        { name: 'H', expr: '55', note: 'upright height' }, { name: 'hole', expr: '6.5', note: 'M6 clearance hole' }, { name: 'edge', expr: '9', note: 'hole distance from edges' },
      ],
      features: [
        { name: 'Base plate', type: 'box', op: 'add', p: { w: 'w', d: 'd', h: 't' } },
        { name: 'Mounting holes (M6 countersunk)', type: 'hole', op: 'cut', p: { std: 'M6', kind: 'csink', d: 6.6, cd: 11, cdep: 6.4, sd: 13.7, ang: 90, depth: '', plane: 'XY', offset: 't', flip: false, pts: 'w/2-edge, -(d/2-edge); -(w/2-edge), -(d/2-edge); 0, d/2-t-edge-4' } },
        { name: 'Upright', type: 'extrude', op: 'add', p: { plane: 'XZ', offset: '-d/2', dist: 't', shapes: [{ type: 'rect', x: '-w/2', y: '0', w: 'w', h: 'H' }] } },
        { name: 'Upright slot', type: 'extrude', op: 'cut', p: { plane: 'XZ', offset: '-d/2-1', dist: 't+2', shapes: [{ type: 'slot', x: '0', y: 'H*0.62', l: 'w*0.35', r: 'hole/2+0.5' }] } },
        { name: 'Gussets', type: 'extrude', op: 'add', pattern: { type: 'linear', count: 2, dx: 'w-24', dy: 0, dz: 0 }, p: { plane: 'YZ', offset: '-(w/2-12)-2.5', dist: '5', shapes: [{ type: 'sketch', pts: [[17, 8], [-5, 8], [17, 34]],
          cons: [{ t: 'x', p: [0], v: 'd/2-t' }, { t: 'y', p: [0], v: 't' }, { t: 'h', s: [0] }, { t: 'v', s: [2] }, { t: 'len', s: [0], v: 22 }, { t: 'len', s: [2], v: 26 }] }] } },
        { name: 'Rounded top corners', type: 'fillet', op: 'add', p: { kind: 'fillet', r: 10, edges: [{ a: [-40, 17, 55], b: [-40, 25, 55] }, { a: [40, 17, 55], b: [40, 25, 55] }] } },
        { name: 'Front chamfer', type: 'fillet', op: 'add', p: { kind: 'chamfer', r: 2, edges: [{ a: [-40, -25, 8], b: [40, -25, 8] }] } },
      ],
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { sampleCad }; else root.CadSample = { sampleCad };
})(typeof self !== 'undefined' ? self : this);
