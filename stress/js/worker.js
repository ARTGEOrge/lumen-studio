// Lumen Stress — solver worker: runs StressFem.solve off the main thread and streams progress messages.
/* global StressFem */
importScripts('sparse.js', 'fem.js');
onmessage = e => {
  const { id, model } = e.data;
  try {
    let last = 0;
    const res = StressFem.solve(model, msg => { const t = Date.now(); if (t - last > 120) { last = t; postMessage({ id, type: 'progress', msg }); } });
    const bufs = [];
    for (const k of Object.keys(res)) if (res[k] && res[k].buffer instanceof ArrayBuffer) bufs.push(res[k].buffer);
    if (res.modes) res.modes.forEach(m => bufs.push(m.u.buffer));
    postMessage({ id, type: 'done', res }, [...new Set(bufs)]);
  } catch (err) { postMessage({ id, type: 'error', message: err.message || String(err) }); }
};
