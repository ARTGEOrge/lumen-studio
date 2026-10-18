// Lumen Spice simulation worker: parse → flatten → run, results posted back with transferable arrays.
/* global SpiceNetlist, SpiceEngine */
importScripts('expr.js', 'models.js', 'netlist.js', 'engine.js');
self.onmessage = e => {
  const { id, text } = e.data;
  try {
    const deck = SpiceNetlist.parse(text), an = SpiceNetlist.analysisOf(deck);
    if (!an) throw new Error('No analysis command — add .tran, .ac, .dc or .op');
    const flat = SpiceNetlist.flatten(deck);
    let last = 0;
    const r = SpiceEngine.run(flat, an, { onProgress: p => { const now = Date.now(); if (now - last > 120) { last = now; self.postMessage({ id, progress: p }); } } });
    r.warnings = flat.warnings; r.elements = flat.elements.length;
    const transfer = [r.x.buffer];
    Object.values(r.vectors).forEach(v => { if (v.re) transfer.push(v.re.buffer, v.im.buffer); else transfer.push(v.buffer); });
    self.postMessage({ id, result: r }, transfer);
  } catch (err) { self.postMessage({ id, error: err && err.message ? err.message : String(err) }); }
};
