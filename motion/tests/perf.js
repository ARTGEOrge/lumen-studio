// Headless test: render/encode performance on the sample (1080p).
Aero.setDirty(false); await LM.openSample(); const c = LM.comp(); const R = {};
const cv = new OffscreenCanvas(1920, 1080);
let t0 = performance.now(); for (let i = 0; i < 30; i++) { LM.renderInto(c, 3 + i / 30, cv); cv.getContext('2d').getImageData(0, 0, 1, 1); } R.render1080_ms_per_frame = Math.round((performance.now() - t0) / 30);
const half = new OffscreenCanvas(960, 540); t0 = performance.now(); for (let i = 0; i < 30; i++) { LM.renderInto(c, 3 + i / 30, half, { scale: .5 }); half.getContext('2d').getImageData(0, 0, 1, 1); } R.renderHalf_ms_per_frame = Math.round((performance.now() - t0) / 30);
R.gpu = (() => { const g = document.createElement('canvas').getContext('webgl'); const e = g && g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'n/a'; })();
c.workIn = 3; c.workOut = 4;
t0 = performance.now(); const r = await LM.encodeVideo(c, { fmt: 'mp4', scale: 1, quality: 'high', range: 'work' }, null); R.mp4_1080_ms_per_frame = Math.round((performance.now() - t0) / r.n); R.mp4bytes = r.bytes.length; R.codec = r.codec;
// sample sanity: frame at 4.2s has bright title pixels and logo
LM.renderInto(c, 4.2, cv); const d = cv.getContext('2d').getImageData(0, 0, 1920, 1080).data; let bright = 0; for (let i = 0; i < d.length; i += 16) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) bright++; R.brightSamples = bright;
LM.renderInto(c, 0, cv); const d0 = cv.getContext('2d').getImageData(0, 0, 1920, 1080).data; let b0 = 0; for (let i = 0; i < d0.length; i += 16) if (d0[i] > 200 && d0[i + 1] > 200) b0++; R.brightAt0 = b0;
return JSON.stringify(R);
