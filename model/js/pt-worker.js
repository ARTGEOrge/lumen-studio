// Lumen 3D render worker: builds the BVH once per scene and renders row bands on request.
/* global LPT */
importScripts('pt.js');
let S = null;
onmessage = e => {
  const d = e.data;
  try {
    if (d.type === 'scene') { S = LPT.prepare(d.scene); postMessage({ type: 'ready', job: d.job }); }
    else if (d.type === 'rows' && S) { const out = LPT.renderRows(S, d.y0, d.y1, d.pass); const aux = out.aux; postMessage({ type: 'rows', job: d.job, y0: d.y0, y1: d.y1, pass: d.pass, data: out, aux }, [out.buffer, aux.buffer]); }
  } catch (err) { postMessage({ type: 'error', job: d.job, message: String(err && err.message || err) }); }
};
