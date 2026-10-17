// Lumen Lab — engine factory: an interpreter with the whole function library (math, numerics, graphics).
(function (root) {
  'use strict';
  const node = typeof module === 'object' && module.exports;
  const I = node ? require('./interp.js') : root.LabInterp;
  const Lib = node ? require('./lib.js') : root.LabLib;
  if (node) { require('./numerics.js'); }
  const G = node ? require('./graphics.js') : root.LabGraphics;
  function create(opts = {}) {
    const In = new I.Interp(opts);
    Object.assign(In.lib, Lib.L);
    for (const k of Object.keys(In.lib)) if (!In.lib[k]) delete In.lib[k];
    In.gfx = G.attach(In);
    In.host = opts.host || null;
    return In;
  }
  const api = { create };
  if (node) module.exports = api; else root.LabEngine = api;
})(typeof self !== 'undefined' ? self : this);
