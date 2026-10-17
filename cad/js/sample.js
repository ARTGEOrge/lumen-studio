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
        { name: 'Mounting holes', type: 'cylinder', op: 'cut', mirror: 'X', pattern: { type: 'linear', count: 2, dx: 0, dy: 'd-t-2*edge', dz: 0 }, p: { r: 'hole/2', h: 't*3', px: 'w/2-edge', py: '-(d/2-edge)', pz: '-t' } },
        { name: 'Upright', type: 'extrude', op: 'add', p: { plane: 'XZ', offset: '-d/2', dist: 't', shapes: [{ type: 'rect', x: '-w/2', y: '0', w: 'w', h: 'H' }] } },
        { name: 'Upright slot', type: 'extrude', op: 'cut', p: { plane: 'XZ', offset: '-d/2-1', dist: 't+2', shapes: [{ type: 'slot', x: '0', y: 'H*0.62', l: 'w*0.35', r: 'hole/2+0.5' }] } },
        { name: 'Gussets', type: 'extrude', op: 'add', pattern: { type: 'linear', count: 2, dx: 'w-24', dy: 0, dz: 0 }, p: { plane: 'YZ', offset: '-(w/2-12)-2.5', dist: '5', shapes: [{ type: 'points', pts: 'd/2-t, t; d/2-t-22, t; d/2-t, t+26' }] } },
      ],
    };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { sampleCad }; else root.CadSample = { sampleCad };
})(typeof self !== 'undefined' ? self : this);
