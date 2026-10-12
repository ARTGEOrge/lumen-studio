'use strict';
/* Lumen Motion — "Open Sample": an ~8 second animated title / logo reveal built from native layers. */
(function () {
  const LM = window.LM, F = LM.factory;
  const E = { i: 'ease', o: 'ease', ei: [.333333, 0], eo: [.333333, 0] };
  const OUT = { i: 'bezier', o: 'bezier', ei: [.8, 0], eo: [.1, .1] };   // strong deceleration into the key
  function K(p, list) { p.k = list.map(([t, v, o]) => Object.assign({ t, v, i: 'linear', o: 'linear' }, o || E)); p.k.sort((a, b) => a.t - b.t); }
  function X(p, src) { p.x = src; LM.trusted.add(src); }

  LM.buildSample = () => {
    const main = F.comp({ name: 'Title Reveal', w: 1920, h: 1080, fps: 30, duration: 8 }); main.bg = '#05070f'; main.mbOn = true;
    const logo = F.comp({ name: 'Logo Mark', w: 640, h: 640, fps: 30, duration: 8 }); logo.bg = '#000000'; logo.mbOn = true;

    /* ----- precomp: logo mark ----- */
    const ring = F.shape(logo, 'ellipse', { name: 'Ring', size: [380, 380], fillOn: false, strokeOn: true, stroke: '#5cc8ff', strokeWidth: 14, pos: [320, 320] });
    K(ring.shape.trim.end, [[.2, 0], [1.5, 100]]); K(ring.shape.trim.offset, [[.2, -120], [1.8, 0]]);
    const ring2 = F.shape(logo, 'ellipse', { name: 'Outer Ring', size: [470, 470], fillOn: false, strokeOn: true, stroke: '#2f6fd8', strokeWidth: 4, pos: [320, 320] });
    ring2.shape.stroke.opacity.v = 70; K(ring2.shape.trim.start, [[.5, 50], [1.9, 0]]); K(ring2.shape.trim.end, [[.5, 50], [1.9, 100]]);
    const hex = F.shape(logo, 'polygon', { name: 'Hexagon', points: 6, outer: 120, fill: '#e9f6ff', pos: [320, 320] });
    hex.shape.roundness.v = 18;
    K(hex.tr.scale, [[.9, [0, 0], { o: 'bezier', eo: [.2, .4], i: 'linear' }], [1.25, [116, 116]], [1.45, [94, 94]], [1.65, [100, 100]]]);
    K(hex.tr.rotation, [[.9, -120, { o: 'bezier', eo: [.1, .1], i: 'linear' }], [1.65, 0, OUT]]);
    hex.effects.push(Object.assign(F.effect('ramp'), {})); const hr = hex.effects[0]; hr.p.p0.v = [0, -120]; hr.p.p1.v = [0, 120]; hr.p.c0.v = '#ffffff'; hr.p.c1.v = '#7fd2ff';
    const play = F.shape(logo, 'polygon', { name: 'Play Glyph', points: 3, outer: 52, fill: '#1d3f86', pos: [328, 320] });
    play.tr.rotation.v = 90; play.shape.roundness.v = 12;
    K(play.tr.opacity, [[1.3, 0], [1.6, 100]]); K(play.tr.scale, [[1.3, [40, 40]], [1.7, [100, 100], OUT]]);
    const orbit = F.nul(logo); orbit.name = 'Orbit Null'; orbit.tr.position.v = [320, 320]; X(orbit.tr.rotation, 'time * 140');
    const dot = F.shape(logo, 'ellipse', { name: 'Orbit Dot', size: [26, 26], fill: '#ffd24a' }); dot.tr.position.v = [50 + 235, 50]; dot.parent = orbit.id; dot.mb = true;
    K(dot.tr.scale, [[1.6, [0, 0]], [2, [100, 100]]]);
    const spark = F.shape(logo, 'star', { name: 'Sparkle', points: 4, outer: 34, inner: 8, fill: '#ffffff', pos: [470, 160] });
    K(spark.tr.scale, [[1.8, [0, 0], { o: 'bezier', eo: [.2, .5], i: 'linear' }], [2.1, [130, 130]], [2.4, [100, 100]]]); X(spark.tr.rotation, 'value + time * 90');
    logo.layers = [spark, dot, orbit, play, hex, ring, ring2];

    /* ----- main comp ----- */
    const bg = F.solid(main, '#0b1430', 'Background'); bg.label = 7;
    const ramp = F.effect('ramp'); ramp.p.shape.v = 'radial'; ramp.p.p0.v = [960, 470]; ramp.p.p1.v = [960, 1500]; ramp.p.c0.v = '#1c3f7a'; ramp.p.c1.v = '#03050c';
    K(ramp.p.p0, [[0, [700, 420]], [8, [1220, 520]]]);
    const noise = F.effect('noise'); noise.p.amount.v = 3; noise.p.colored.v = false;
    bg.effects.push(ramp, noise);

    const bokeh = [[380, 260, 160, '#2f7fe0'], [1580, 300, 220, '#7b3fd0'], [1460, 860, 140, '#20a0a0'], [300, 860, 120, '#2f6fd8']].map(([x, y, s, c], i) => {
      const b = F.shape(main, 'ellipse', { name: 'Bokeh ' + (i + 1), size: [s, s], fill: c, pos: [x, y] });
      b.tr.opacity.v = 38; b.blend = 'screen'; b.label = 4;
      const bl = F.effect('blur'); bl.p.amount.v = 40 + i * 6; b.effects.push(bl);
      X(b.tr.position, `wiggle(0.35, ${70 + i * 15})`);
      K(b.tr.opacity, [[0, 0], [1.5, 38]]);
      return b;
    });

    const master = F.nul(main); master.name = 'Camera Push'; master.tr.anchor.v = [50, 50]; master.tr.position.v = [960, 540]; K(master.tr.scale, [[0, [96, 96], { i: 'linear', o: 'linear' }], [8, [104, 104], { i: 'linear', o: 'linear' }]]);

    const logoL = F.precomp(main, logo); logoL.name = 'Logo Mark'; logoL.label = 1; logoL.parent = master.id;
    logoL.tr.position.v = [50, 50 - 190]; K(logoL.tr.position, [[0, [50, -80]], [1.6, [50, -150], OUT], [7.4, [50, -165]]]);
    logoL.tr.scale.v = [72, 72];
    const glow = F.effect('glow'); glow.p.threshold.v = 35; glow.p.radius.v = 40; glow.p.intensity.v = 1.1; logoL.effects.push(glow);

    const title = F.text(main, 'LUMEN MOTION', { font: 'Segoe UI', weight: '900', size: 150, fill: '#ffffff', pos: [50, 50 + 115] });
    title.name = 'Title'; title.parent = master.id; title.label = 0; title.tr.anchor.v = [0, -52];
    K(title.text.tracking, [[1.5, 520, { o: 'bezier', eo: [.08, .2], i: 'linear' }], [3.4, 60, OUT]]);
    const rise = F.animator('Rise In'); rise.opacity.v = 0; rise.position.v = [0, 110]; rise.blur.v = 14; rise.sel.shape = 'rampUp'; rise.sel.end.v = 35;
    K(rise.sel.offset, [[1.5, -35], [3.0, 100]]);
    title.text.animators.push(rise);
    const tr = F.effect('ramp'); tr.p.p0.v = [0, -150]; tr.p.p1.v = [0, 10]; tr.p.c0.v = '#ffffff'; tr.p.c1.v = '#8fd3ff'; title.effects.push(tr);
    const sh = F.effect('shadow'); sh.p.opacity.v = 55; sh.p.distance.v = 10; sh.p.softness.v = 24; sh.p.color.v = '#000814'; title.effects.push(sh);

    // light sweep through the title, using a duplicate of the title as alpha track matte
    const matteT = LM.clone(title); matteT.id = LM.uid(); matteT.name = 'Title Matte'; matteT.effects = []; matteT.text.animators = [LM.clone(rise)]; matteT.text.animators[0].id = LM.uid(); matteT.label = 7;
    const sweep = F.shape(main, 'rect', { name: 'Light Sweep', size: [230, 900], fill: '#ffffff', pos: [-200, 650] });
    sweep.tr.rotation.v = 22; sweep.matte = 'alpha'; sweep.label = 3; sweep.tr.opacity.v = 100; sweep.mb = true;
    const sb = F.effect('blur'); sb.p.amount.v = 26; sweep.effects.push(sb);
    K(sweep.tr.position, [[3.5, [300, 640], { i: 'linear', o: 'bezier', eo: [.3, .1] }], [4.7, [1640, 640], { i: 'bezier', ei: [.3, .1], o: 'linear' }]]);
    sweep.in = 3.4; sweep.out = 4.9;

    const line = F.shape(main, 'path', { name: 'Underline', path: { c: false, pts: [[-470, 0, 0, 0, 0, 0], [470, 0, 0, 0, 0, 0]] }, fillOn: false, strokeOn: true, stroke: '#5cc8ff', strokeWidth: 4, pos: [960, 742] });
    K(line.shape.trim.start, [[2.6, 50], [3.8, 0]]); K(line.shape.trim.end, [[2.6, 50], [3.8, 100]]);
    const lg = F.effect('glow'); lg.p.threshold.v = 20; lg.p.radius.v = 18; lg.p.intensity.v = 1.4; lg.p.tint.v = 'color'; lg.p.color.v = '#3aa0ff'; line.effects.push(lg);

    const sub = F.text(main, 'MOTION GRAPHICS  ·  ANIMATION  ·  TITLES', { font: 'Segoe UI', weight: '600', size: 38, fill: '#a9dcff', tracking: 260, pos: [960, 812] });
    sub.name = 'Subtitle'; sub.label = 0;
    const tw = F.animator('Typewriter'); tw.opacity.v = 0; tw.sel.smooth = false; K(tw.sel.start, [[3.3, 0, { i: 'linear', o: 'linear' }], [4.9, 100, { i: 'linear', o: 'linear' }]]);
    sub.text.animators.push(tw);

    const fade = F.solid(main, '#000000', 'Fade to Black'); fade.label = 7; K(fade.tr.opacity, [[7.2, 0], [8, 100]]); fade.in = 7;

    // light burst behind the logo: one rounded bar + a 24-copy repeater, radial gradient, scaling in
    const burst = F.shape(main, 'rect', { name: 'Light Burst', size: [10, 120], roundness: 5, fill: '#bfe6ff' });
    burst.parent = master.id; burst.tr.position.v = [50, -150]; burst.blend = 'add'; burst.label = 4;
    const S = burst.shape; S.fill.gtype = 'linear'; S.fill.gs.v = [0, -60]; S.fill.ge.v = [0, 60]; S.fill.c2.v = '#1d3f86';
    S.size.v = [10, 120]; burst.tr.anchor.v = [0, 0];
    const rp = S.rep; rp.on = true; rp.copies.v = 24; rp.position.v = [0, 0]; rp.anchor.v = [0, 330]; rp.rotation.v = 15; rp.so.v = 100; rp.eo.v = 100;
    // place the bar so the repeater anchor sits on the logo centre
    burst.tr.anchor.v = [0, 330]; burst.tr.position.v = [50, -150];
    K(burst.tr.scale, [[1.0, [0, 0], { o: 'bezier', eo: [.2, .5], i: 'linear' }], [1.7, [100, 100], OUT]]);
    K(burst.tr.opacity, [[1.0, 0], [1.5, 55], [3.2, 22], [7, 14]]);
    X(burst.tr.rotation, 'time * 6');
    burst.out = 8;

    main.layers = [fade, sub, line, matteT, sweep, title, logoL, burst, master, ...bokeh, bg];
    return { comps: [main, logo], active: main.id };
  };

  // a synthesized 8 s soundtrack: warm pad, a whoosh into the logo hit, a chime, and a soft tail
  function soundtrack() {
    const sr = 22050, n = sr * 8, out = new Float32Array(n);
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
    const notes = [110, 164.81, 220, 261.63, 329.63];
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, env = Math.min(1, t / 1.4) * Math.min(1, Math.max(0, (8 - t) / 1.2));
      let v = 0; notes.forEach((f, k) => { v += Math.sin(2 * Math.PI * f * t + k) * (k ? .6 : 1) + .25 * Math.sin(2 * Math.PI * f * 2.003 * t); });
      v *= .14 * env * (1 + .15 * Math.sin(t * 2.1));
      const w = Math.exp(-Math.pow((t - 1.45) / .32, 2)); lp += (rnd() - lp) * (.05 + .25 * w); v += lp * w * .45;   // whoosh
      if (t > 1.62) { const d = t - 1.62; v += (Math.sin(2 * Math.PI * 880 * d) + .4 * Math.sin(2 * Math.PI * 1320 * d)) * Math.exp(-d * 2.4) * .3; }   // chime
      if (t > 3.45) { const d = t - 3.45; v += Math.sin(2 * Math.PI * 1760 * d) * Math.exp(-d * 5) * .07; }   // sweep sparkle
      out[i] = Math.max(-1, Math.min(1, v));
    }
    const b = new ArrayBuffer(44 + n * 2), dv = new DataView(b), s = (o, x) => { for (let i = 0; i < x.length; i++) dv.setUint8(o + i, x.charCodeAt(i)); };
    s(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); s(8, 'WAVE'); s(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); s(36, 'data'); dv.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) dv.setInt16(44 + i * 2, Math.round(out[i] * 32767), true);
    const u = new Uint8Array(b); let str = ''; for (let i = 0; i < u.length; i += 0x8000) str += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return 'data:audio/wav;base64,' + btoa(str);
  }

  LM.openSample = async () => {
    if (Aero.dirty && !(await Aero.confirm('Open Sample', 'Discard unsaved changes to the current project?', 'Discard'))) return;
    LM.stop?.();
    const s = LM.buildSample();
    LM.media.clear(); LM.assets.clear();
    try {
      const a = { id: LM.uid(), name: 'Soundtrack.wav', type: 'audio', mime: 'audio/wav', data: soundtrack() };
      await LM.loadMedia(a); LM.assets.set(a.id, a);
      const main = s.comps.find(c => c.id === s.active), L = F.audio(main, a); L.name = 'Soundtrack'; L.au.level.v = -3;
      main.layers.unshift(L);
    } catch (e) { console.warn('sample audio', e); }
    LM.doc.comps = s.comps; LM.doc.active = s.active; LM.doc.name = 'Sample – Title Reveal'; LM.doc.path = null;
    const c = LM.comp(); LM.st.sel = []; LM.st.selKeys.clear(); LM.st.selProps.clear(); LM.ui.open.clear(); LM.tl.openTabs.clear();
    LM.resetHistory('Open Sample'); LM.setActiveComp(c.id);
    const t = c.layers.find(l => l.name === 'Title'); LM.select([t.id]);
    LM.setTime(4.2);
    Aero.toast('Sample loaded — press Space to play, or RAM ▶ for a cached real-time preview');
  };
})();
