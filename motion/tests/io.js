// Headless test: export (MP4/WebM/GIF/PNG/zip) with decode verification, project round-trip, expression trust, undo, video import.
const R = {}, F = LM.factory, ok = (k, c, info) => R[k] = c ? 'ok' : 'FAIL ' + JSON.stringify(info);
const sleep = ms => new Promise(r => setTimeout(r, ms));
// test comp: red for 1s, then blue (hold keyframes on a solid color)
await LM.newProject(); const c = LM.comp(); Object.assign(c, { w: 320, h: 180, fps: 30, duration: 2, workIn: 0, workOut: 2 });
const s = F.solid(c, '#ff0000', 'S', 320, 180); s.out = 2; s.solid.color.k = [{ t: 0, v: '#ff0000', i: 'hold', o: 'hold' }, { t: 1, v: '#0000ff', i: 'hold', o: 'hold' }];
LM.addLayer(s, 'add');
async function decode(bytes, mime, times) {
  const v = document.createElement('video'); v.muted = true; v.src = URL.createObjectURL(new Blob([bytes], { type: mime }));
  await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(v.error); });
  const out = { duration: v.duration, w: v.videoWidth, h: v.videoHeight, px: [] };
  const cv = document.createElement('canvas'); cv.width = v.videoWidth; cv.height = v.videoHeight; const x = cv.getContext('2d', { willReadFrequently: true });
  for (const t of times) { await new Promise(r => { v.onseeked = r; v.currentTime = t; }); await sleep(30); x.drawImage(v, 0, 0); out.px.push(Array.from(x.getImageData(160, 90, 1, 1).data)); }
  return { out, v };
}
const isRed = p => p[0] > 200 && p[2] < 60, isBlue = p => p[2] > 200 && p[0] < 60;
// MP4
let t0 = performance.now();
const mp4 = await LM.encodeVideo(c, { fmt: 'mp4', scale: 1, quality: 'high', range: 'all' }, null);
const mp4ms = performance.now() - t0;
const box = String.fromCharCode(...mp4.bytes.slice(4, 8));
ok('mp4 container', mp4.ext === 'mp4' && box === 'ftyp', { ext: mp4.ext, box, codec: mp4.codec });
try { const d = (await decode(mp4.bytes, 'video/mp4', [0.5, 1.5])).out; ok('mp4 decodes', Math.abs(d.duration - 2) < 0.1 && d.w === 320 && isRed(d.px[0]) && isBlue(d.px[1]), d); R.mp4info = `${mp4.codec} ${mp4.bytes.length}B ${mp4.n}fr ${Math.round(mp4ms)}ms`; } catch (e) { ok('mp4 decodes', false, String(e)); }
// WebM
const webm = await LM.encodeVideo(c, { fmt: 'webm', scale: 1, quality: 'med', range: 'all' }, null);
ok('webm container', webm.bytes[0] === 0x1a && webm.bytes[1] === 0x45, Array.from(webm.bytes.slice(0, 4)));
try { const d = (await decode(webm.bytes, 'video/webm', [0.5, 1.5])).out; ok('webm decodes', d.w === 320 && isRed(d.px[0]) && isBlue(d.px[1]), d); } catch (e) { ok('webm decodes', false, String(e)); }
// GIF
t0 = performance.now(); const gif = await LM.encodeGif(c, { scale: .5, gifFps: 10, range: 'all' }, null);
R.gifms = Math.round(performance.now() - t0); ok('gif header', String.fromCharCode(...gif.bytes.slice(0, 6)) === 'GIF89a' && gif.n === 20, { n: gif.n });
try { const img = new Image(); img.src = URL.createObjectURL(new Blob([gif.bytes], { type: 'image/gif' })); await img.decode(); ok('gif decodes', img.naturalWidth === 160 && img.naturalHeight === 90, [img.naturalWidth, img.naturalHeight]); } catch (e) { ok('gif decodes', false, String(e)); }
// PNG sequence zip
const zip = await LM.encodePngSeq(c, { scale: .25, range: 'all' }, null);
const files = fflate.unzipSync(zip.bytes), names = Object.keys(files).sort();
ok('png zip', names.length === 60 && files[names[0]][1] === 0x50 && files[names[0]][2] === 0x4e, names.length);
const im2 = await createImageBitmap(new Blob([files[names[45]]], { type: 'image/png' })); const tcv = new OffscreenCanvas(im2.width, im2.height); tcv.getContext('2d').drawImage(im2, 0, 0);
ok('png frame 45 is blue', isBlue(Array.from(tcv.getContext('2d').getImageData(40, 20, 1, 1).data)) && im2.width === 80);
const fr = await LM.frameToPng(c, 0.2); ok('frame png', fr[1] === 0x50 && fr.length > 100);
// work area range
c.workIn = 1; c.workOut = 1.5; const wa = await LM.encodeGif(c, { scale: .25, gifFps: 30, range: 'work' }, null); ok('work area range', wa.n === 15, wa.n); c.workIn = 0; c.workOut = 2;
// ---- video layer from the exported MP4
await LM.importFiles([{ name: 'clip.mp4', type: 'video/mp4', data: mp4.bytes.buffer.slice(mp4.bytes.byteOffset, mp4.bytes.byteOffset + mp4.bytes.byteLength) }]);
const vl = LM.comp().layers.find(l => l.type === 'video'); ok('video layer imported', !!vl && Math.abs(LM.assets.get(vl.asset).duration - 2) < .1);
s.visible = false; LM.link(c);
const cv = new OffscreenCanvas(320, 180); LM.st.exporting = true;
await LM.seekVideos(c, 0.4); LM.renderInto(c, 0.4, cv); const vp1 = Array.from(cv.getContext('2d').getImageData(160, 90, 1, 1).data);
await LM.seekVideos(c, 1.6); LM.renderInto(c, 1.6, cv); const vp2 = Array.from(cv.getContext('2d').getImageData(160, 90, 1, 1).data);
ok('video frame-accurate render', isRed(vp1) && isBlue(vp2), [vp1, vp2]);
s.visible = true; LM.st.exporting = false;
// ---- undo / redo
const nBefore = LM.comp().layers.length; LM.newLayer.null(); ok('add layer', LM.comp().layers.length === nBefore + 1);
LM.undo(); ok('undo', LM.comp().layers.length === nBefore); LM.redo(); ok('redo', LM.comp().layers.length === nBefore + 1); LM.undo();
// ---- project round-trip with expression trust
LM.select([LM.comp().layers.find(l => l.type === 'solid').id]);
const sl = LM.selLayer(); sl.tr.rotation.x = 'time * 45'; LM.trusted.add('time * 45'); LM.commit('expr');
const json = LM.serialize(); ok('serialize embeds media', json.includes('data:video/mp4;base64,'));
LM.trusted.delete('time * 45');
await LM.loadProject(new TextEncoder().encode(json), 'round.lmot');
await sleep(200);
const dlg = document.querySelector('.aero-modal .aero-box h3')?.textContent || '';
ok('trust prompt shown', /expressions/i.test(dlg), dlg);
const L2 = LM.comp().layers.find(l => l.type === 'solid');
ok('expr not run before approval', LM.val(L2.tr.rotation, 1) === 0, LM.val(L2.tr.rotation, 1));
document.querySelector('.aero-modal .aero-btn.pri').click(); await sleep(50);
ok('expr runs after approval', LM.val(L2.tr.rotation, 1) === 45, LM.val(L2.tr.rotation, 1));
ok('roundtrip keyframes', L2.solid.color.k.length === 2 && LM.comp().w === 320 && LM.assets.size === 1);
// malicious file is sanitized
const evil = JSON.parse(json); evil.comps[0].bg = 'red;background:url(http://x)'; evil.comps[0].layers[0].name = '<img src=x onerror=alert(1)>'; evil.comps[0].layers.push({ type: 'bogus' }); evil.assets.push({ id: 'z', type: 'image', data: 'http://evil/x.png' });
await LM.loadProject(JSON.stringify(evil), 'evil.lmot'); await sleep(100);
document.querySelectorAll('.aero-modal').forEach(m => m.remove());
ok('sanitize', LM.comp().bg === '#808080' && !document.querySelector('img[src=x]') && LM.assets.size === 1 && LM.comp().layers.every(l => l.type !== 'bogus'), LM.comp().bg);
// ---- keyframe copy/paste, presets, precompose, split
Aero.setDirty(false); await LM.openSample(); await sleep(100);
const title = LM.comp().layers.find(l => l.name === 'Title'); LM.select([title.id]);
LM.st.selKeys.clear(); title.text.tracking.k.forEach(k => LM.st.selKeys.add(k)); LM.copyKeys();
const sub = LM.comp().layers.find(l => l.name === 'Subtitle'); LM.select([sub.id]); LM.setTime(5); LM.pasteKeys();
ok('paste keys', sub.text.tracking.k && sub.text.tracking.k.length === 2 && Math.abs(sub.text.tracking.k[0].t - 5) < 1e-6, sub.text.tracking.k);
LM.applyPreset('pop'); ok('preset pop', sub.tr.scale.k.length === 4);
LM.applyPreset('fadeIn'); ok('preset fade', sub.tr.opacity.k.length === 2 && sub.tr.opacity.k[0].v === 0);
LM.st.selKeys.clear(); sub.tr.opacity.k.forEach(k => LM.st.selKeys.add(k)); LM.setKeysInterp('hold'); ok('interp hold', sub.tr.opacity.k[0].o === 'hold');
LM.deleteSelectedKeys(); ok('delete keys', !sub.tr.opacity.k);
const nComps = LM.doc.comps.length; await (async () => { const p = LM.precompose(); await sleep(50); document.querySelector('.aero-modal .aero-btn.pri').click(); await p; })();
ok('precompose', LM.doc.comps.length === nComps + 1 && LM.selLayer().type === 'precomp');
LM.setTime(2); LM.splitLayer(); ok('split', LM.comp().layers.filter(l => l.type === 'precomp' && l.name.includes('Pre-comp')).length === 2);
LM.tl.toggleGraph(); LM.select([title.id]); LM.graph.draw(); LM.tl.toggleGraph();
ok('history length', LM.hist.items.length > 5);
return JSON.stringify(R);
