// Headless test (v1.1): audio import, mixer (levels keyframes, time remap, mute, precomp nesting), waveform,
// preview playback, MP4/WebM export with audio (decoded back), WAV export, video-with-audio import, save/load.
const R = {}, F = LM.factory, ok = (k, c, info) => R[k] = c ? 'ok' : 'FAIL ' + JSON.stringify(info);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = []; addEventListener('error', e => errors.push(e.message));
try {
// a 1.5 s WAV: 440 Hz sine at amplitude 0.5
function wav(freq, secs, amp, sr = 44100) {
  const n = Math.round(secs * sr), b = new ArrayBuffer(44 + n * 2), d = new DataView(b), s = (o, t) => [...t].forEach((c, i) => d.setUint8(o + i, c.charCodeAt(0)));
  s(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, sr, true); d.setUint32(28, sr * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); s(36, 'data'); d.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) d.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * freq * i / sr) * amp * 32767), true);
  return b;
}
const rms = (a, i0, i1) => { i0 = Math.round(i0); i1 = Math.round(i1); let s = 0; for (let i = i0; i < i1; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, i1 - i0)); };
const zc = (a, i0, i1) => { i0 = Math.round(i0); i1 = Math.round(i1); let n = 0; for (let i = i0 + 1; i < i1; i++) if ((a[i - 1] < 0) !== (a[i] < 0)) n++; return n; };
Aero.setDirty(false); await LM.newProject(); const c = LM.comp(); Object.assign(c, { w: 320, h: 180, fps: 30, duration: 3, workIn: 0, workOut: 3 });
await LM.importFiles([{ name: 'tone.wav', type: 'audio/wav', data: wav(440, 1.5, .5) }]);
const A = LM.comp().layers[0], SR = LM.audio.SR;
ok('audio layer', A && A.type === 'audio' && Math.abs(A.out - 1.5) < .02 && LM.assets.get(A.asset).type === 'audio', A && [A.type, A.out]);
let m = LM.audio.mix(c, 0, 2);
const r0 = rms(m[0], 4800, 9600), z0 = zc(m[0], 0, SR);
ok('mix tone', Math.abs(r0 - .5 / Math.SQRT2) < .02 && Math.abs(z0 - 880) < 6 && rms(m[0], SR * 1.6, SR * 1.9) < 1e-4, [r0, z0]);
// Audio Levels keyframes: 0 dB → -96 dB (silence) at 1 s
A.au.level.k = [{ t: .5, v: 0, i: 'linear', o: 'linear' }, { t: 1, v: -96, i: 'hold', o: 'hold' }]; LM.commit('lvl');
m = LM.audio.mix(c, 0, 1.5); const rA = rms(m[0], 0, SR * .4), rB = rms(m[0], SR * 1.1, SR * 1.4);
ok('levels keyframes', rA > .3 && rB < 1e-4, [rA, rB]);
A.au.level.k = undefined; delete A.au.level.k; A.au.level.v = -6.0206; LM.commit('lvl2');
m = LM.audio.mix(c, 0, 1); ok('level -6 dB halves', Math.abs(rms(m[0], 0, SR) - .25 / Math.SQRT2) < .01, rms(m[0], 0, SR)); A.au.level.v = 0;
// mute switch
A.au.on = false; LM.commit('mute'); ok('mute', rms(LM.audio.mix(c, 0, 1)[0], 0, SR) === 0); A.au.on = true; LM.commit('unmute');
// time remap: half speed → 220 Hz
LM.select([A.id]); LM.toggleTimeRemap([A]); A.tm.p.k[1].v = A.tm.p.k[1].t / 2; LM.commit('slow');
m = LM.audio.mix(c, 0, 1); ok('time remap half speed', Math.abs(zc(m[0], 0, SR) - 440) < 6, zc(m[0], 0, SR));
LM.toggleTimeRemap([A]); ok('time remap off', !A.tm.on && Math.abs(zc(LM.audio.mix(c, 0, 1)[0], 0, SR) - 880) < 6);
// layer offset in time
A.start = .5; A.in = .5; A.out = 2; LM.commit('shift'); m = LM.audio.mix(c, 0, 1);
ok('layer start offset', rms(m[0], 0, SR * .45) === 0 && rms(m[0], SR * .55, SR) > .3);
// nested precomp audio
LM.select([A.id]); { const p = LM.precompose(); await sleep(50); document.querySelector('.aero-modal .aero-btn.pri').click(); await p; }
const PL = LM.comp().layers[0]; ok('precomp carries audio', PL.type === 'precomp' && LM.layerHasAudio(PL, LM.comp()) && rms(LM.audio.mix(LM.comp(), 0, 1)[0], SR * .55, SR) > .3);
PL.au.level.v = -96; ok('precomp audio level', rms(LM.audio.mix(LM.comp(), 0, 1)[0], 0, SR) === 0); PL.au.level.v = 0; LM.commit('pl');
// timeline: audio switch, waveform drawn
await sleep(50);
LM.undo(); LM.undo(); await sleep(50); // back to the audio layer in the main comp
const AL = LM.comp().layers.find(l => l.type === 'audio'); AL.expanded = false; LM.tl.rebuild(); await sleep(50);
const row = [...document.querySelectorAll('.tl-row.layer')].find(r => r.dataset.id === AL.id), wv = row?.querySelector('canvas.wave');
let inked = 0; if (wv) { const d = wv.getContext('2d').getImageData(0, 0, wv.width, wv.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) inked++; }
ok('waveform drawn', wv && wv.width > 20 && inked > 200, [wv?.width, inked]);
row.querySelector('.sw.aud').click(); await sleep(20); ok('audio switch mutes', LM.comp().layers.find(l => l.type === 'audio').au.on === false);
LM.undo(); await sleep(20); ok('undo audio switch', LM.comp().layers.find(l => l.type === 'audio').au.on === true);
// properties: Audio Levels in the tree
const AL2 = LM.comp().layers.find(l => l.type === 'audio'); ok('audio levels prop', !!LM.findNode(AL2, 'au.level'));
// preview playback
LM.setTime(0.6); LM.play(); await sleep(300); ok('preview audio playing', LM.audio.playing()); LM.stop(); ok('preview audio stops', !LM.audio.playing());
LM.audio.toggle(); LM.play(); await sleep(100); ok('audio preview toggle', !LM.audio.playing()); LM.stop(); LM.audio.toggle();
// export MP4 with AAC and decode the audio track back
const dec = async bytes => { const ctx = new OfflineAudioContext(2, 1, SR); return ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); };
const mp4 = await LM.encodeVideo(LM.comp(), { fmt: 'mp4', scale: 1, quality: 'med', range: 'all' }, null);
ok('mp4 has audio track', mp4.audio === 'aac' || mp4.audio === 'opus', mp4.audio);
try { const b = await dec(mp4.bytes), ch = b.getChannelData(0); const ra = rms(ch, SR * .7, SR * 1.3), rs = rms(ch, SR * .05, SR * .4), zz = zc(ch, SR * .7, SR * 1.7);
  ok('mp4 audio decodes', Math.abs(b.duration - 3) < .15 && ra > .3 && rs < .02 && Math.abs(zz - 880) < 20, [b.duration, ra, rs, zz]); } catch (e) { ok('mp4 audio decodes', false, String(e)); }
// mp4 video still plays: video element reports a duration and dimensions
{ const v = document.createElement('video'); v.src = URL.createObjectURL(new Blob([mp4.bytes], { type: 'video/mp4' })); await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = rej; }); ok('mp4 video+audio loads', v.videoWidth === 320 && Math.abs(v.duration - 3) < .15, [v.videoWidth, v.duration]); }
const webm = await LM.encodeVideo(LM.comp(), { fmt: 'webm', scale: .5, quality: 'low', range: 'all' }, null);
try { const b = await dec(webm.bytes), ch = b.getChannelData(0); ok('webm opus audio decodes', webm.audio === 'opus' && rms(ch, SR * .7, SR * 1.3) > .3, [webm.audio, rms(ch, SR * .7, SR * 1.3)]); } catch (e) { ok('webm opus audio decodes', false, String(e)); }
const noa = await LM.encodeVideo(LM.comp(), { fmt: 'mp4', scale: .5, quality: 'low', range: 'all', audio: false }, null); ok('export without audio', noa.audio === null);
// WAV export
const w = LM.audio.wav(LM.comp(), 0, 2); ok('wav export', String.fromCharCode(...w.slice(0, 4)) === 'RIFF' && w.length === 44 + 2 * SR * 4);
// video with sound: import the MP4 we just made → video layer audio
LM.comp().layers.forEach(l => l.visible = l.type !== 'audio');
await LM.importFiles([{ name: 'withsound.mp4', type: 'video/mp4', data: mp4.bytes.buffer.slice(mp4.bytes.byteOffset, mp4.bytes.byteOffset + mp4.bytes.byteLength) }]);
const VL = LM.comp().layers.find(l => l.type === 'video'); LM.comp().layers.find(l => l.type === 'audio').au.on = false; LM.commit('x');
ok('video layer audio', !!LM.media.get(VL.asset).audio && LM.layerHasAudio(VL, LM.comp()) && rms(LM.audio.mix(LM.comp(), 0, 2)[0], SR * .7, SR * 1.3) > .3);
ok('video layer has Audio Levels', !!LM.findNode(VL, 'au.level'));
// save / load round trip keeps audio
const json = LM.serialize(); ok('serialize audio', json.includes('data:audio/wav;base64,') && JSON.parse(json).version >= 2);
await LM.loadProject(json, 'a.lmot'); await sleep(100); document.querySelectorAll('.aero-modal').forEach(x => x.remove());
const A3 = LM.comp().layers.find(l => l.type === 'audio'); ok('reload audio', !!A3 && !!LM.media.get(A3.asset)?.audio && A3.au.on === false && !!LM.media.get(LM.comp().layers.find(l => l.type === 'video').asset).audio);
ok('no errors', errors.length === 0, errors.slice(0, 5));
} catch (e) { R.ERROR = e.message + ' | ' + (e.stack || '').split('\n').slice(1, 3).join(' '); }
return JSON.stringify(R);
