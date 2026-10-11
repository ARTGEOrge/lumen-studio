// Headless test: real viewer playback frame rate (uncached) and RAM preview.
Aero.setDirty(false); await LM.openSample(); const R = {}; const sleep = ms => new Promise(r => setTimeout(r, ms));
let fps = []; LM.on('fps', f => { if (f) fps.push(f); });
for (const [res, bud] of [[1, 0], [1, 6e8], [.5, 6e8]]) {
  LM.cacheBudget = bud; LM.st.res = res; LM.cacheReset(); fps = [];
  LM.setTime(2.5); LM.play(); await sleep(3000); LM.stop();
  R['play_fps_res' + res + '_b' + bud] = Math.round(Math.max(...fps.slice(1), 0) * 10) / 10 + ' avg ' + Math.round(fps.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, fps.length - 1) * 10) / 10;
}
// RAM preview of a 2 s work area at half res
const c = LM.comp(); c.workIn = 3; c.workOut = 5; LM.cacheReset(); fps = [];
const t0 = performance.now(); LM.ramPreview(); while (LM.st.rendering) await sleep(50); R.ram_render_s = Math.round((performance.now() - t0) / 100) / 10; R.cached = LM.cachedFrames().size;
await sleep(2500); R.ram_play_fps = Math.round(Math.max(...fps, 0)); LM.stop();
R.poolMisses = LM.poolMisses; return JSON.stringify(R);
