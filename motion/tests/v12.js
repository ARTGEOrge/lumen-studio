// Headless test (v1.2): Color Key, Expression Controls + property links (via the timeline context menu),
// Convert Expression to Keyframes, markers (keys, ruler, layer bars, dialog, save/load, Lottie), Sequence Layers,
// Convert Audio to Keyframes, Time-Reverse Keyframes.
const R = {}, F = LM.factory, ok = (k, c, info) => R[k] = c ? 'ok' : 'FAIL ' + JSON.stringify(info);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const errors = []; const oe = console.error; console.error = (...a) => { errors.push(a.join(' ')); oe(...a); }; addEventListener('error', e => errors.push(e.message));
const px = (cv, x, y) => Array.from(cv.getContext('2d').getImageData(x, y, 1, 1).data);
const key = (k, o = {}) => document.dispatchEvent(new KeyboardEvent('keydown', Object.assign({ key: k, bubbles: true, cancelable: true }, o)));
const fld = label => [...document.querySelectorAll('.aero-modal .aero-row')].find(r => r.querySelector('label').textContent === label)?.querySelector('input,select,textarea');
const okBtn = () => document.querySelector('.aero-modal .aero-btn.pri');
const ctxItem = text => [...document.querySelectorAll('.ctxmenu .aero-mi')].find(m => m.textContent.startsWith(text));
const P = (el, type, x, y, o = {}) => el.dispatchEvent(new PointerEvent(type, Object.assign({ clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerType: 'mouse' }, o)));
try {
Aero.setDirty(false); await LM.newProject(); await sleep(50);
const c = LM.comp(); Object.assign(c, { w: 200, h: 100, fps: 10, duration: 4, workIn: 0, workOut: 4, bg: '#000000' }); LM.commit('size');

/* ---------- Color Key ---------- */
{
  const sub = F.comp({ name: 'Green', w: 200, h: 100, fps: 10, duration: 4 });
  const g = F.solid(sub, '#00b140', 'Screen', 200, 100), red = F.solid(sub, '#ff0000', 'Red', 50, 50), sp = F.solid(sub, '#78b46e', 'Spill', 40, 40);
  red.tr.position.v = [100, 50]; sp.tr.position.v = [170, 50]; sub.layers.push(red, sp, g); LM.doc.comps.push(sub);
  const PL = F.precomp(c, sub); PL.tr.position.v = [100, 50]; c.layers.push(PL); LM.select([PL.id]); LM.addEffect('ckey', PL);
  const fx = PL.effects[0]; fx.p.spill.v = 100; LM.link(c);
  const cv = new OffscreenCanvas(200, 100); LM.renderInto(c, 0, cv);
  ok('color key removes green', px(cv, 20, 20).join() === '0,0,0,255', px(cv, 20, 20));
  ok('color key keeps red', px(cv, 100, 50).join() === '255,0,0,255', px(cv, 100, 50));
  const s = px(cv, 170, 50); ok('spill suppression', s[3] === 255 && Math.abs(s[1] - 120) <= 2 && s[0] === 120, s);
  fx.p.view.v = 'matte'; LM.renderInto(c, 0, cv); ok('matte view', px(cv, 20, 20)[0] === 0 && px(cv, 100, 50).join() === '255,255,255,255', [px(cv, 20, 20), px(cv, 100, 50)]);
  fx.p.view.v = 'final'; fx.p.tolerance.v = 100; fx.p.softness.v = 0; LM.renderInto(c, 0, cv); ok('high tolerance keys near greens', px(cv, 170, 50).join() === '0,0,0,255' && px(cv, 100, 50).join() === '255,0,0,255', [px(cv, 170, 50), px(cv, 100, 50)]);
  fx.p.tolerance.v = 25; fx.p.softness.v = 100; fx.p.spill.v = 0; LM.renderInto(c, 0, cv); const sa = px(cv, 170, 50); ok('soft edge gives partial alpha', sa[0] > 5 && sa[0] < 115, sa);
  c.layers = []; LM.doc.comps = LM.doc.comps.filter(x => x !== sub); LM.commit('clear');
}

/* ---------- Expression Controls + links through the timeline menu ---------- */
LM.newLayer.null(); const N = LM.comp().layers[0]; N.name = 'Rig'; N.tr.anchor.v = [0, 0];
LM.addEffect('slider', N); LM.addEffect('slider', N);
ok('second control gets numbered name', !N.effects[0].name && N.effects[1].name === 'Slider Control 2', N.effects.map(f => f.name));
N.effects[0].p.slider.v = 30; LM.commit('slider');
const box = F.solid(LM.comp(), '#ff0000', 'Box', 40, 40); box.tr.position.v = [100, 50]; LM.select([]); LM.addLayer(box, 'box');
// a layer whose only effect is a control renders exactly like one without (and no offscreen buffer is needed)
{ const cv = new OffscreenCanvas(200, 100); LM.renderInto(LM.comp(), 0, cv); const a = px(cv, 100, 50).join(); box.effects.push(F.effect('slider')); LM.link(LM.comp()); LM.renderInto(LM.comp(), 0, cv); ok('control effect is invisible', px(cv, 100, 50).join() === a && a === '255,0,0,255', [a, px(cv, 100, 50)]); box.effects = []; LM.commit('x'); }
N.expanded = true; LM.ui.open.add(N.id + '|effects'); LM.ui.open.add(N.id + '|fx.' + N.effects[0].id); box.expanded = true; LM.ui.open.add(box.id + '|transform'); LM.tl.rebuild(); await sleep(30);
const pname = (layerId, label) => { let cur = null; for (const row of document.querySelectorAll('#timeline .tl-row')) { if (row.classList.contains('layer')) cur = row.dataset.id; else if (cur === layerId && row.querySelector('.pname')?.textContent === label) return row.querySelector('.pname'); } return null; };
const sliderName = pname(N.id, 'Slider'); ok('slider row in timeline', !!sliderName);
sliderName.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 })); await sleep(10);
ctxItem('Copy Expression Reference').click(); await sleep(10);
ok('copy reference', LM.exprLinkClip && LM.exprLinkClip.node === 'fx.' + N.effects[0].id + '.slider', LM.exprLinkClip);
const rotName = pname(box.id, 'Rotation'); rotName.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 300 })); await sleep(10);
const li = ctxItem('Link to'); ok('link menu item names source', li && /Rig › Slider/.test(li.textContent), li?.textContent); li.click(); await sleep(10);
ok('linked expression', box.tr.rotation.x === 'thisComp.layer("Rig").effect("Slider Control")("Slider")' && LM.val(box.tr.rotation, 1) === 30, [box.tr.rotation.x, LM.val(box.tr.rotation, 1)]);
// vec2 ← scalar link wraps the value
LM.exprLinkClip = { layer: N.id, comp: LM.comp().id, node: 'fx.' + N.effects[0].id + '.slider', label: 'Rig › Slider' };
LM.linkToCopied(box, LM.findNode(box, 'tr.scale')); ok('scalar → vec2 link', JSON.stringify(LM.val(box.tr.scale, 1)) === '[30,30]', [box.tr.scale.x, LM.val(box.tr.scale, 1)]);
LM.undo(); const lay = n => LM.comp().layers.find(l => l.name === n); let Box = lay('Box'), Rig = lay('Rig'); ok('undo link', !Box.tr.scale.x && Box.tr.rotation.x, Box.tr.scale.x);
// animate the slider; the box follows on render
Rig.effects[0].p.slider.k = [{ t: 0, v: 0, i: 'linear', o: 'linear' }, { t: 2, v: 90, i: 'linear', o: 'linear' }]; LM.commit('anim slider');
ok('follows animated control', Math.abs(LM.val(Box.tr.rotation, 1) - 45) < 1e-6, LM.val(Box.tr.rotation, 1));
// rename the effect from the timeline (double-click) and reference it by its new name
{ LM.tl.rebuild(); await sleep(10); let gn = null, cur = null; for (const row of document.querySelectorAll('#timeline .tl-row')) { if (row.classList.contains('layer')) cur = row.dataset.id; else if (cur === Rig.id && row.querySelector('.gname')?.textContent === 'Slider Control 2') gn = row.querySelector('.gname'); }
  gn.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); await sleep(10); const inp = document.querySelector('#timeline input.rename, #timeline .tl-row input[type=text]') || document.activeElement;
  inp.value = 'Spin'; inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); inp.blur?.(); await sleep(20);
  Rig = lay('Rig'); Box = lay('Box'); ok('rename effect', Rig.effects[1].name === 'Spin', Rig.effects[1].name);
  Rig.effects[1].p.slider.v = 5; Box.tr.opacity.x = 'thisComp.layer("Rig").effect("Spin")("Slider") * 10'; LM.trusted.add(Box.tr.opacity.x); LM.commit('op'); ok('reference renamed effect', LM.val(Box.tr.opacity, 1) === 50, [LM.val(Box.tr.opacity, 1), LM.exprError(Box.tr.opacity)]); }

/* ---------- Convert Expression to Keyframes ---------- */
{
  Box = lay('Box'); const before = [0, .5, 1.3, 3.9].map(t => LM.val(Box.tr.rotation, t));
  LM.st.selProps.clear(); LM.st.selProps.add(Box.id + '|tr.rotation'); LM.bakeSelected();
  const p = Box.tr.rotation, after = [0, .5, 1.3, 3.9].map(t => LM.val(p, t));
  ok('bake keyframes', p.k && p.k.length === 40 && p.xe === false && p.x, [p.k?.length, p.xe]);
  ok('bake keeps values', after.every((v, i) => Math.abs(v - before[i]) < 1e-6), [before, after]);
  Rig = lay('Rig'); Rig.effects[0].p.slider.v = 999; delete Rig.effects[0].p.slider.k; LM.commit('x'); ok('baked no longer follows', Math.abs(LM.val(p, 1) - 45) < 1e-6, LM.val(p, 1));
  LM.undo(); LM.undo(); ok('undo bake', !LM.comp().layers.find(l => l.name === 'Box').tr.rotation.k, 'still keyed');
}

/* ---------- markers ---------- */
{
  LM.select([]); LM.setTime(1); key('*'); await sleep(10);
  ok('* adds comp marker', LM.comp().markers.length === 1 && Math.abs(LM.comp().markers[0].t - 1) < 1e-9, LM.comp().markers);
  const B = LM.comp().layers.find(l => l.name === 'Box'); LM.select([B.id]); LM.setTime(2.5); key('*'); await sleep(10);
  ok('* adds layer marker', B.markers.length === 1 && Math.abs(B.markers[0].t - 2.5) < 1e-9, B.markers);
  ok('layer marker drawn on bar', !!document.querySelector(`#timeline .tl-row.layer[data-id="${B.id}"] .lmk`));
  LM.select([]); LM.setTime(0); key('K', { altKey: true }); ok('Alt+K next marker', Math.abs(LM.st.time - 1) < 1e-9, LM.st.time);
  LM.select([B.id]); key('K', { altKey: true }); ok('next marker includes layer markers', Math.abs(LM.st.time - 2.5) < 1e-9, LM.st.time);
  key('J', { altKey: true }); ok('Alt+J previous marker', Math.abs(LM.st.time - 1) < 1e-9, LM.st.time);
  // ruler: marker is drawn, double-click edits it, drag moves it
  const ruler = document.querySelector('.tl-ruler canvas'), rr = ruler.getBoundingClientRect(), mx = rr.left + LM.tl.x(1), my = rr.top + 20;
  const rp = ruler.getContext('2d').getImageData(Math.round(LM.tl.x(1) * devicePixelRatio), Math.round(17 * devicePixelRatio), 1, 1).data;
  ok('ruler draws marker', rp[0] > 180 && rp[2] < 120, Array.from(rp));
  ruler.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, clientX: mx, clientY: my })); await sleep(20);
  ok('marker dialog', !!fld('Comment')); fld('Comment').value = 'Hit'; fld('Comment').dispatchEvent(new Event('input')); fld('Duration (seconds)').value = '0.5'; fld('Duration (seconds)').dispatchEvent(new Event('input')); okBtn().click(); await sleep(20);
  const m = LM.comp().markers[0]; ok('edit marker', m.name === 'Hit' && m.dur === .5, m);
  P(ruler, 'pointerdown', mx, my); for (let i = 1; i <= 4; i++) { P(ruler, 'pointermove', mx + i * LM.tl.x(.5) / 4, my); await sleep(5); } P(ruler, 'pointerup', mx + LM.tl.x(.5), my); await sleep(20);
  ok('drag marker', Math.abs(LM.comp().markers[0].t - 1.5) < 1e-6, LM.comp().markers[0].t);
  LM.undo(); ok('undo marker move', Math.abs(LM.comp().markers[0].t - 1) < 1e-6, LM.comp().markers[0].t);
  // expressions read markers
  const B2 = LM.comp().layers.find(l => l.name === 'Box'); B2.tr.opacity.x = 'thisComp.marker.key(1).duration * 100 + marker.key(1).time'; LM.trusted.add(B2.tr.opacity.x); LM.commit('mx');
  ok('marker expression', Math.abs(LM.val(B2.tr.opacity, 0) - 52.5) < 1e-6, [LM.val(B2.tr.opacity, 0), LM.exprError(B2.tr.opacity)]);
  // save / load keeps markers + effect names; bad marker data is cleaned
  const json = JSON.parse(LM.serialize()); ok('format v3', json.version === 3);
  json.comps[0].markers.push({ t: 'x' }, { t: 99, name: 7, dur: -4, label: 99 }, null);
  Aero.setDirty(false); await LM.loadProject(JSON.stringify(json), 'mk.lmot'); await sleep(30); document.querySelector('.aero-modal .aero-btn.pri')?.click(); await sleep(20);
  const c2 = LM.comp(), B3 = c2.layers.find(l => l.name === 'Box'), N3 = c2.layers.find(l => l.name === 'Rig');
  ok('markers roundtrip', c2.markers.length === 2 && c2.markers[0].name === 'Hit' && c2.markers[1].t === 4 && c2.markers[1].name === '' && c2.markers[1].dur === 0 && c2.markers[1].label === 10 && B3.markers.length === 1, c2.markers);
  ok('effect name roundtrip', N3.effects[1].name === 'Spin');
  // a v2 file (no markers) still opens
  const old = JSON.parse(LM.serialize()); old.version = 2; delete old.comps[0].markers; old.comps[0].layers.forEach(l => delete l.markers);
  Aero.setDirty(false); await LM.loadProject(JSON.stringify(old), 'old.lmot'); await sleep(20); document.querySelector('.aero-modal .aero-btn.pri')?.click(); await sleep(20);
  ok('v2 file loads', Array.isArray(LM.comp().markers) && LM.comp().markers.length === 0 && LM.comp().layers.every(l => Array.isArray(l.markers)));
  // Lottie export carries comp markers, and skips expression controls silently
  await LM.loadProject(JSON.stringify(json), 'mk.lmot'); await sleep(20); document.querySelector('.aero-modal .aero-btn.pri')?.click(); await sleep(20);
  const { json: lj, warnings } = LM.exportLottie(LM.comp(), {}); const lo = typeof lj === 'string' ? JSON.parse(lj) : lj;
  ok('lottie markers', lo.markers.length >= 1 && lo.markers[0].cm === 'Hit' && lo.markers[0].tm === 10 && lo.markers[0].dr === 5, lo.markers);
  ok('lottie ignores controls', !warnings.some(w => /Slider/.test(w)), warnings);
}

/* ---------- Sequence Layers ---------- */
{
  Aero.setDirty(false); await LM.newProject(); const c3 = LM.comp(); Object.assign(c3, { w: 200, h: 100, fps: 10, duration: 8, workIn: 0, workOut: 8 }); LM.commit('c');
  const ls = ['A', 'B', 'C'].map(n => { const s = F.solid(c3, '#ffffff', n, 50, 50); s.out = 2; return s; }); c3.layers.push(...ls); LM.commit('3');
  LM.select(ls.map(l => l.id)); LM.sequenceLayers(); await sleep(20);
  fld('Overlap').checked = true; fld('Overlap').dispatchEvent(new Event('change')); fld('Overlap duration (seconds)').value = '0.5'; fld('Overlap duration (seconds)').dispatchEvent(new Event('input'));
  fld('Transition').value = 'cross'; fld('Transition').dispatchEvent(new Event('change')); okBtn().click(); await sleep(20);
  ok('sequence times', ls[0].in === 0 && Math.abs(ls[1].in - 1.5) < 1e-9 && Math.abs(ls[2].in - 3) < 1e-9 && Math.abs(ls[2].out - 5) < 1e-9, ls.map(l => [l.in, l.out]));
  ok('cross dissolve keys', Math.abs(LM.val(ls[0].tr.opacity, 1.75) - 50) < 1e-6 && Math.abs(LM.val(ls[1].tr.opacity, 1.75) - 50) < 1e-6 && LM.val(ls[1].tr.opacity, 2.5) === 100 && LM.val(ls[2].tr.opacity, 3) === 0, [LM.val(ls[0].tr.opacity, 1.75), LM.val(ls[1].tr.opacity, 1.75), LM.val(ls[1].tr.opacity, 2.5), LM.val(ls[2].tr.opacity, 3)]);
  LM.undo(); ok('undo sequence', LM.comp().layers[1].in === 0);
}

/* ---------- Time-Reverse Keyframes ---------- */
{
  const L = LM.comp().layers[0], p = L.tr.position; p.k = [{ t: 0, v: [0, 0], i: 'linear', o: 'ease', eo: [.333333, 0] }, { t: 1, v: [100, 0], i: 'linear', o: 'linear' }, { t: 2, v: [100, 100], i: 'hold', o: 'hold' }]; LM.commit('k');
  LM.st.selKeys.clear(); p.k.forEach(k => LM.st.selKeys.add(k)); LM.reverseKeys();
  const q = LM.comp().layers[0].tr.position.k; ok('time-reverse keyframes', q[0].t === 0 && q[0].v.join() === '100,100' && q[2].v.join() === '0,0' && q[2].i === 'ease' && q[1].t === 1, q);
}

/* ---------- Convert Audio to Keyframes ---------- */
{
  const wav = (secs, amp, sr = 44100) => { const n = Math.round(secs * sr), b = new ArrayBuffer(44 + n * 2), d = new DataView(b), s = (o, t) => [...t].forEach((ch, i) => d.setUint8(o + i, ch.charCodeAt(0)));
    s(0, 'RIFF'); d.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt '); d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, sr, true); d.setUint32(28, sr * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); s(36, 'data'); d.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) d.setInt16(44 + i * 2, Math.round(Math.sin(2 * Math.PI * 440 * i / sr) * amp * 32767), true); return b; };
  const c4 = LM.comp(); c4.workIn = 0; c4.workOut = 2; LM.commit('wa');
  await LM.importFiles([{ name: 'tone.wav', type: 'audio/wav', data: wav(1, .5) }]); await sleep(50);
  const N4 = LM.audioToKeys(), both = N4?.effects.find(f => f.name === 'Both Channels');
  const k = both?.p.slider.k || [];
  ok('audio → keyframes', N4 && N4.type === 'null' && N4.effects.length === 3 && k.length === 20, [N4?.effects.length, k.length]);
  ok('amplitude values', Math.abs(LM.val(both.p.slider, .5) - 50 / Math.SQRT2) < 1.5 && LM.val(both.p.slider, 1.5) < .01, [LM.val(both.p.slider, .5), LM.val(both.p.slider, 1.5)]);
  const T = LM.comp().layers.find(l => l.type === 'solid'); T.tr.scale.x = 'var a = thisComp.layer("Audio Amplitude").effect("Both Channels")("Slider"); [100 + a, 100 + a]'; LM.trusted.add(T.tr.scale.x); LM.commit('pulse');
  ok('drive with amplitude', LM.val(T.tr.scale, .5)[0] > 130 && LM.val(T.tr.scale, 1.5)[0] < 100.1, [LM.val(T.tr.scale, .5), LM.val(T.tr.scale, 1.5), LM.exprError(T.tr.scale)]);
}

/* ---------- sample uses the new features ---------- */
{
  Aero.setDirty(false); await LM.openSample(); await sleep(50);
  const s = LM.comp(), cp = s.layers.find(l => l.name === 'Camera Push'), b1 = s.layers.find(l => l.name === 'Bokeh 1');
  ok('sample markers', s.markers.length === 3);
  const v1 = LM.val(b1.tr.position, 3); cp.effects[0].p.slider.v = 0; const v0 = LM.val(b1.tr.position, 3); cp.effects[0].p.slider.v = 70;
  ok('sample control drives bokeh', !LM.exprError(b1.tr.position) && (v1[0] !== v0[0]) && Math.abs(v0[0] - 380) < 1e-6, [v1, v0, LM.exprError(b1.tr.position)]);
}
} catch (e) { R.exception = e.stack; }
ok('no errors', !errors.length, errors);
const fails = Object.entries(R).filter(([, v]) => typeof v === 'string' && v.startsWith('FAIL')).length;
R.summary = fails ? `${fails} FAILED` : 'all ok';
return JSON.stringify(R);
