// Headless test (v1.1 follow-up): video frame blending in live preview, Trim + Merge Paths (incl. >48 paths),
// own-shape draw order, editing on 3D layers (scale handles, mask vertices, text), audio master clock + scrub audio,
// Lottie effects / 3D / camera / warnings (verified with lottie-web's SVG and HTML renderers).
const R = {}, F = LM.factory, ok = (k, c, info) => R[k] = c ? 'ok' : 'FAIL ' + JSON.stringify(info);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = []; addEventListener('error', e => errors.push(e.message)); const oe = console.error; console.error = (...a) => { errors.push(a.join(' ')); oe(...a); };
const view = document.querySelector('#view'), vr = () => view.getBoundingClientRect();
const P = (el, type, x, y, o = {}) => el.dispatchEvent(new PointerEvent(type, Object.assign({ clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerType: 'mouse' }, o)));
const scr = (cx, cy) => { const [x, y] = LM.viewer.toScreen(cx, cy), r = vr(); return [x + r.left, y + r.top]; };
const drag = async (el, a, b, n = 6) => { P(el, 'pointerdown', ...a); for (let i = 1; i <= n; i++) { P(el, 'pointermove', a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n); await sleep(5); } P(el, 'pointerup', ...b); await sleep(20); };
const main = async () => { try {
Aero.setDirty(false); await LM.newProject();
/* ---------- 1. video frame blending in live preview ---------- */
R.step = 'fb';
const src = LM.comp(); Object.assign(src, { w: 160, h: 90, fps: 30, duration: 1, workIn: 0, workOut: 1 });
const so = F.solid(src, '#ff0000', 'S', 160, 90); so.out = 1; so.solid.color.k = [{ t: 0, v: '#ff0000', i: 'hold', o: 'hold' }, { t: .5, v: '#0000ff', i: 'hold', o: 'hold' }]; LM.addLayer(so, 'x');
const mp4 = await LM.encodeVideo(src, { fmt: 'mp4', scale: 1, quality: 'high', range: 'all', audio: false }, null);
await LM.importFiles([{ name: 'rb.mp4', type: 'video/mp4', data: mp4.bytes.buffer.slice(mp4.bytes.byteOffset, mp4.bytes.byteOffset + mp4.bytes.byteLength) }]);
const V = LM.comp().layers.find(l => l.type === 'video'); so.visible = false; V.tr.scale.v = [100, 100]; V.tr.position.v = [80, 45];
V.tm.on = true; V.tm.p.k = [{ t: 0, v: 0, i: 'linear', o: 'linear' }, { t: 2, v: 1, i: 'linear', o: 'linear' }]; LM.comp().duration = 2; V.out = 2; LM.commit('remap');
const frameAt = async t => { LM.cacheReset(); LM.setTime(t); for (let i = 0; i < 80; i++) { LM.draw(); await sleep(40); if (!LM.viewer.videoPending()) break; } LM.cacheReset(); LM.draw(); await sleep(30); const b = LM.viewer.getFrame(LM.comp(), LM.st.time), c = new OffscreenCanvas(b.width, b.height), x = c.getContext('2d'); x.drawImage(b, 0, 0); return Array.from(x.getImageData(Math.round(b.width / 2), Math.round(b.height / 2), 1, 1).data); };
const nofb = await frameAt(29 / 30); V.fb = true; LM.commit('fb'); const yesfb = await frameAt(29 / 30);
ok('preview frame blending', nofb[0] > 200 && nofb[2] < 60 && Math.abs(yesfb[0] - 128) < 30 && Math.abs(yesfb[2] - 128) < 30, [nofb, yesfb]);
const whole = await frameAt(28 / 30); ok('preview fb on whole source frame', whole[0] > 200 && whole[2] < 60, whole);
LM.setTime(.8); LM.play(); await sleep(500); LM.stop(); ok('fb during playback', !!LM.media.get(V.asset).video2);
/* ---------- 2. Trim + Merge Paths, many paths ---------- */
R.step = 'merge';
const c = F.comp({ w: 200, h: 100, fps: 10, duration: 2 }); c.bg = '#000000'; LM.doc.comps.push(c); LM.doc.active = c.id;
const cv = new OffscreenCanvas(200, 100), cx = cv.getContext('2d', { willReadFrequently: true }), px = (x, y) => Array.from(cx.getImageData(x, y, 1, 1).data);
const draw = (t = 0) => { LM.link(c); LM.renderInto(c, t, cv); };
const sh = F.shape(c, 'rect', { size: [60, 60], fill: '#ff0000', pos: [60, 50] }); const g = F.shapeGroup('rect', { size: [60, 60], fill: '#00ff00', pos: [40, 0] }); sh.shape.groups.push(g); c.layers = [sh];
sh.shape.merge = 'add'; draw(); const full = px(95, 50);
sh.shape.groups[0].trim.end.v = 50; draw(); const trimmedPx = [px(95, 25), px(95, 74)];
ok('trim applies inside merge', full[0] === 255 && (trimmedPx[0][0] === 255) !== (trimmedPx[1][0] === 255), [full, trimmedPx]);
sh.shape.groups[0].trim.end.v = 100;
// 60 overlapping circles (repeater) merged: stroke only on the outer outline
const cap = F.shape(c, 'ellipse', { size: [40, 40], fill: '#ff0000', strokeOn: true, stroke: '#0000ff', strokeWidth: 4, pos: [40, 50] }); cap.shape.rep.on = true; cap.shape.rep.copies.v = 60; cap.shape.rep.position.v = [2, 0]; c.layers = [cap];
draw(); const noMerge = px(100, 50); cap.shape.merge = 'add'; draw(); const merged = px(100, 50), edge = px(100, 31), edgeOut = px(100, 29);
ok('merge stroke cleanup with 60 paths', noMerge[2] > 150 && merged[0] === 255 && merged[2] === 0 && edge[2] > 150 && edgeOut[2] > 150, [noMerge, merged, edge, edgeOut]);
cap.shape.merge = 'subtract'; draw(); ok('merge subtract with 60 paths', px(40, 50).join() === '0,0,0,255' && px(100, 50).join() === '0,0,0,255' && px(20, 50)[2] > 100, [px(40, 50), px(100, 50), px(20, 50)]);
/* ---------- 3. own shape draw order ---------- */
R.step = 'order';
const o1 = F.shape(c, 'rect', { size: [40, 40], fill: '#ff0000', pos: [100, 50] }); o1.shape.groups.push(F.shapeGroup('rect', { size: [40, 40], fill: '#00ff00' }), F.shapeGroup('rect', { size: [40, 40], fill: '#0000ff' })); c.layers = [o1];
draw(); const top = px(100, 50); o1.shape.order = 1; draw(); const mid = px(100, 50); o1.shape.order = 2; draw(); const bot = px(100, 50);
ok('own shape order top/middle/bottom', top[0] === 255 && mid[1] === 255 && bot[1] === 255 && (o1.shape.groups.reverse(), draw(), px(100, 50)[2] === 255), [top, mid, bot]);
o1.shape.groups.reverse(); LM.link(c); ok('order setting in tree', LM.leaves(o1).length >= 0 && !!(o1._tree.find(n => n.id === 'contents').items.find(n => n.id === 'shape.order')));
o1.shape.order = 1; const lj = LM.exportLottie(c).json; ok('lottie keeps order', lj.layers[0].shapes.map(s => s.nm).join() === [o1.shape.groups[0].name, 'Shape 1', o1.shape.groups[1].name].join(), lj.layers[0].shapes.map(s => s.nm));
/* ---------- 4. editing on 3D layers ---------- */
R.step = '3d edit';
const c3 = LM.comp(); c3.layers.forEach(l => l.visible = false);
const q = F.solid(c3, '#ffffff', 'Q', 400, 300); q.threeD = true; q.tr.rotY.v = 40; q.tr.position.v = [c3.w / 2, c3.h / 2]; LM.addLayer(q, 'q'); LM.doc.active = c3.id; LM.setActiveComp(c3.id); LM.select([q.id]); LM.tools.set('select'); LM.setTime(0); await sleep(50);
const mpq = LM.viewer.mapper(q, 0, c3), rt = mpq.fwd(...mpq.inv(900, 500)); ok('unproject round trip', Math.hypot(rt[0] - 900, rt[1] - 500) < .01, rt);
const corner = mpq.fwd(400, 300), s0 = q.tr.scale.v.slice(); await drag(view, scr(...corner), scr(corner[0] + 60, corner[1] + 40));
ok('3D scale handle', q.tr.scale.v[0] > s0[0] + 5, q.tr.scale.v);
LM.undo(); const q2 = LM.comp().layers.find(l => l.id === q.id); LM.select([q2.id]); LM.addMask(q2, 'rect'); await sleep(20);
const mk = q2.masks[0], v0 = mk.path.v.pts[0].slice(), mpq2 = LM.viewer.mapper(q2, 0, LM.comp()), vs = mpq2.fwd(v0[0], v0[1]), target = [vs[0] - 50, vs[1] - 30];
await drag(view, scr(...vs), scr(...target));
const v1 = q2.masks[0].path.v.pts[0], back = LM.viewer.mapper(q2, 0, LM.comp()).fwd(v1[0], v1[1]);
ok('3D mask vertex drag', Math.hypot(back[0] - target[0], back[1] - target[1]) < 1.5 && (v1[0] !== v0[0]), [back, target]);
const t3 = F.text(LM.comp(), 'Tilt', { size: 120, pos: [960, 300] }); t3.threeD = true; t3.tr.rotX.v = -35; LM.addLayer(t3, 't'); await sleep(20);
const b3 = LM.layerBounds(t3, 0), m3 = LM.viewer.mapper(t3, 0, LM.comp()), ctr = m3.fwd((b3[0] + b3[2]) / 2, (b3[1] + b3[3]) / 2);
view.dispatchEvent(new MouseEvent('dblclick', { clientX: scr(...ctr)[0], clientY: scr(...ctr)[1], bubbles: true })); await sleep(30);
ok('3D text edits on canvas', !!LM.st.textEdit && !document.querySelector('.aero-modal'));
const endP = m3.fwd(b3[2] - 3, (b3[1] + b3[3]) / 2); { const [x, y] = scr(...endP); P(view, 'pointerdown', x, y); P(view, 'pointerup', x, y); } await sleep(20);
const ti = document.querySelector('#textinput'); ok('3D text caret from click', ti.selectionStart === 4, ti.selectionStart);
ti.setRangeText('ed', 4, 4, 'end'); ti.dispatchEvent(new Event('input')); ti.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(20);
ok('3D text edit commits', t3.text.str === 'Tilted' && !LM.st.textEdit, t3.text.str);
/* ---------- 5. audio master clock + scrub audio ---------- */
R.step = 'audio';
const wav = (() => { const sr = 44100, n = sr * 3, b = new ArrayBuffer(44 + n * 2), d = new DataView(b), s = (o, t) => [...t].forEach((ch, i) => d.setUint8(o + i, ch.charCodeAt(0))); s(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, sr, true); d.setUint32(28, sr * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); s(36, 'data'); d.setUint32(40, n * 2, true); for (let i = 0; i < n; i++) d.setInt16(44 + i * 2, Math.round(Math.sin(i / 20) * 9000), true); return b; })();
await LM.importFiles([{ name: 'hum.wav', type: 'audio/wav', data: wav }]); const cc = LM.comp(); cc.workIn = 0; cc.workOut = cc.duration;
LM.setTime(0); LM.play(); await sleep(900);
const steady = LM.audio.driftLog.slice(-10).map(Math.abs), r0 = LM.audio.resyncs; LM.viewer._nudgeClock(300); await sleep(300);
const after = LM.audio.driftLog.slice(-6).map(Math.abs), picked = LM.audio.driftLog.slice(-40).some(d => Math.abs(d) > .25);
ok('audio master clock', LM.audio.clock() != null && steady.sort((a, b) => a - b)[5] < .02 && picked && LM.audio.resyncs > r0 && Math.max(...after) < .02, [steady.slice(4, 6), after.slice(0, 2), LM.audio.resyncs - r0, picked, LM.audio.clock() - LM.st.time]);
LM.stop();
const ruler = document.querySelector('.tl-ruler canvas'), rr = ruler.getBoundingClientRect(), n0 = LM.audio.scrubCount;
P(ruler, 'pointerdown', rr.left + rr.width * .1, rr.top + 25); for (let i = 1; i <= 5; i++) { P(ruler, 'pointermove', rr.left + rr.width * (.1 + i * .04), rr.top + 25); await sleep(50); } P(ruler, 'pointerup', rr.left + rr.width * .3, rr.top + 25);
ok('scrub audio while dragging', LM.audio.scrubCount - n0 >= 3, LM.audio.scrubCount - n0);
LM.audio.scrubOn = false; const n1 = LM.audio.scrubCount; LM.audio.scrub(.5); ok('scrub audio toggle', LM.audio.scrubCount === n1); LM.audio.scrubOn = true;
/* ---------- 6. Lottie effects, 3D, camera, warnings ---------- */
R.step = 'lottie';
await new Promise((res, rej) => { const s = document.createElement('script'); s.src = '/tools/deps/motion/node_modules/lottie-web/build/player/lottie.min.js'; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
const lc = F.comp({ name: 'LFX', w: 200, h: 100, fps: 30, duration: 1 }); lc.bg = '#000000'; LM.doc.comps.push(lc);
const r1 = F.shape(lc, 'rect', { size: [60, 60], fill: '#ff0000', pos: [50, 50] }); const ff = F.effect('fill'); ff.p.color.v = '#00ff00'; r1.effects.push(ff);
const r2 = F.shape(lc, 'rect', { size: [60, 60], fill: '#ffffff', pos: [150, 50] }); const bl = F.effect('blur'); bl.p.amount.v = 20; r2.effects.push(bl, F.effect('glow'));
const r3 = F.shape(lc, 'rect', { size: [20, 20], fill: '#ffffff', pos: [100, 20] }); r3.effects.push(F.effect('shadow'), F.effect('tint'));
lc.layers = [r1, r2, r3]; LM.link(lc);
const { json, warnings } = LM.exportLottie(lc);
ok('lottie effect data', json.layers[0].ef[0].ty === 21 && json.layers[1].ef[0].ty === 29 && json.layers[2].ef.map(e => e.ty).join() === '25,20', json.layers.map(l => (l.ef || []).map(e => e.ty)));
ok('lottie warns unsupported effect', warnings.some(w => /Glow/.test(w)) && warnings.some(w => /SVG renderer/.test(w)), warnings);
const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:100px;background:#000'; document.body.appendChild(host);
const an = lottie.loadAnimation({ container: host, renderer: 'svg', loop: false, autoplay: false, animationData: JSON.parse(JSON.stringify(json)) });
await new Promise(r => an.addEventListener('DOMLoaded', r)); an.goToAndStop(0, true); await sleep(80);
const svg = host.querySelector('svg'); svg.setAttribute('width', 200); svg.setAttribute('height', 100);
const img = new Image(); img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' })); await img.decode();
const rc = document.createElement('canvas'); rc.width = 200; rc.height = 100; const rx = rc.getContext('2d', { willReadFrequently: true }); rx.fillStyle = '#000'; rx.fillRect(0, 0, 200, 100); rx.drawImage(img, 0, 0);
const lp = (x, y) => Array.from(rx.getImageData(x, y, 1, 1).data);
ok('lottie-web renders Fill effect', lp(50, 50)[1] > 200 && lp(50, 50)[0] < 60, lp(50, 50));
ok('lottie-web renders Gaussian Blur', lp(150, 50)[0] > 200 && lp(150, 21)[0] > 20 && lp(150, 21)[0] < 235, [lp(150, 50), lp(150, 21)]);
an.destroy(); host.remove();
// 3D + camera
const dc = F.comp({ name: 'L3D', w: 200, h: 100, fps: 30, duration: 1 }); LM.doc.comps.push(dc);
const s3 = F.solid(dc, '#ffffff', 'S', 80, 60); s3.threeD = true; s3.tr.rotY.v = 45; s3.tr.posZ.k = [{ t: 0, v: 0, i: 'linear', o: 'linear' }, { t: 1, v: 200, i: 'linear', o: 'linear' }];
const cam = F.camera(dc); dc.layers = [cam, s3]; LM.link(dc);
const j3 = LM.exportLottie(dc);
const L3 = j3.json.layers.find(l => l.ty === 1), C3 = j3.json.layers.find(l => l.ty === 13);
ok('lottie 3D layer', j3.json.ddd === 1 && L3.ddd === 1 && L3.ks.ry.k === 45 && L3.ks.p.a === 1 && L3.ks.p.k[1].s[2] === 200 && !L3.ks.r, L3 && L3.ks);
ok('lottie camera', C3 && C3.pe.k > 100 && C3.ks.p.k[2] < 0 && C3.ks.a.k.length === 3 && j3.warnings.some(w => /HTML renderer/.test(w)), C3);
const h2 = document.createElement('div'); h2.style.cssText = 'position:fixed;left:0;top:0;width:200px;height:100px'; document.body.appendChild(h2);
const an2 = lottie.loadAnimation({ container: h2, renderer: 'html', loop: false, autoplay: false, animationData: JSON.parse(JSON.stringify(j3.json)) });
await new Promise(r => an2.addEventListener('DOMLoaded', r)); an2.goToAndStop(10, true); await sleep(50);
ok('lottie-web HTML renderer builds 3D', [...h2.querySelectorAll('*')].some(e => /matrix3d|perspective/.test(e.style.transform + e.style.perspective)), h2.innerHTML.slice(0, 200));
an2.destroy(); h2.remove();
ok('no errors', errors.length === 0, errors.slice(0, 5));
} catch (e) { R.ERROR = e.message + ' | ' + (e.stack || '').split('\n').slice(1, 3).join(' '); } };
await Promise.race([main(), sleep(150000).then(() => R.WATCHDOG = 'timed out')]);
return JSON.stringify(R);
