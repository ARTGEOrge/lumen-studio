'use strict';
/* Lumen Vector — "Open Sample": a logo + poster across two artboards, built from real editable objects. */
(function () {
  const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(42);
  const grad = (type, stops, angle = 90) => ({ type, angle, stops });
  const path = (d, fill, name, x0 = 0, y0 = 0) => { const p = new P.CompoundPath({ pathData: d, insert: false }); const r = p.children.length === 1 ? p.firstChild.clone({ insert: false }) : p; r.translate([x0, y0]); r.fillColor = LV.specToColor(fill, r.bounds); r.name = name; return r; };
  const paint = (it, fill, stroke, w) => { it.fillColor = LV.specToColor(fill, it.bounds); it.strokeColor = LV.specToColor(stroke || null, it.bounds); if (w) it.strokeWidth = w; return it; };
  const text = (pt, content, st, fill, name) => { const t = LV.newPointText(pt, content, { family: st.family, weight: st.weight, size: st.size, leading: st.lead || 1.2, tracking: st.tracking || 0, align: st.align || 'center' }); t.fillColor = LV.specToColor(fill); t.name = name || content.split('\n')[0]; return t; };

  LV.buildSample = () => {
    LV.newDoc({ w: 800, h: 800, name: 'Aurora sample.lvec', boardName: 'Logo' });
    const D = LV.doc; D.artboards.push({ id: Aero.uid(), name: 'Poster', x: 900, y: 0, w: 1080, h: 1350 });
    P.project.clear();
    const Lbg = new P.Layer({ name: 'Background' }), Lart = new P.Layer({ name: 'Artwork' }), Ltype = new P.Layer({ name: 'Type' });
    const add = (L, it) => { L.addChild(it); LV.uidOf(it); return it; };

    /* ---------- Artboard 1: logo ---------- */
    add(Lbg, paint(new P.Path.Rectangle({ rectangle: [0, 0, 800, 800], insert: false, name: 'Logo backdrop' }), grad('radial', [['#1d3d63', 0], ['#0a1628', 1]])));
    const C = new P.Point(400, 330);
    const emblem = new P.Group({ insert: false, name: 'Emblem' });
    const glow = paint(new P.Path.Circle({ center: C, radius: 250, insert: false, name: 'Glow' }), grad('radial', [['rgba(255,150,100,0.45)', 0], ['rgba(255,120,90,0)', 1]]));
    const ring = new P.Path.Circle({ center: C, radius: 210, insert: false, name: 'Dotted ring' }); paint(ring, null, '#ffffff', 3); ring.dashArray = [0.5, 11]; ring.strokeCap = 'round'; ring.opacity = 0.5;
    // sun disc with a mountain silhouette and retro bars cut out (Pathfinder: Minus Front)
    let disc = new P.Path.Circle({ center: C, radius: 170, insert: false });
    const peaks = new P.Path({ segments: [[230, 600], [230, 392], [318, 300], [366, 348], [452, 246], [570, 392], [570, 600]], closed: true, insert: false });
    peaks.translate([0, 30]);
    let cut = disc.subtract(peaks, { insert: false });
    for (let i = 0; i < 3; i++) cut = cut.subtract(new P.Path.Rectangle({ rectangle: [200, 360 - i * 30 - 6 + i * 4, 400, 7 - i * 1.6], insert: false }), { insert: false });
    cut.name = 'Sun (compound)'; paint(cut, grad('linear', [['#ffe08a', 0], ['#ff8a5b', 0.55], ['#e0457b', 1]], 90));
    const mtn = peaks.intersect(new P.Path.Circle({ center: C, radius: 170, insert: false }), { insert: false }); mtn.name = 'Peaks'; paint(mtn, grad('linear', [['#5a4bb0', 0], ['#2a2357', 1]], 90));
    const snow = new P.Path({ segments: [[452, 276], [478, 307], [462, 302], [452, 316], [440, 303], [428, 308]], closed: true, insert: false, name: 'Snow cap' }); paint(snow, '#ffffff'); snow.opacity = .9;
    const spark = paint(new P.Path.Star({ center: [532, 176], points: 4, radius1: 26, radius2: 6, insert: false, name: 'Sparkle' }), '#ffffff');
    const spark2 = paint(new P.Path.Star({ center: [262, 214], points: 4, radius1: 13, radius2: 3.5, insert: false, name: 'Sparkle small' }), '#ffd9a6');
    emblem.addChildren([glow, ring, cut, mtn, snow, spark, spark2]);
    add(Lart, emblem);
    add(Ltype, text(new P.Point(400, 625), 'AURORA', { family: 'Montserrat', weight: 800, size: 94, tracking: 260 }, '#ffffff', 'Wordmark'));
    const tag = add(Ltype, text(new P.Point(400, 680), 'VECTOR  STUDIO', { family: 'Inter', weight: 600, size: 21, tracking: 520 }, '#ffd36e', 'Tagline'));
    [tag.bounds.left - 96, tag.bounds.right + 22].forEach(a => { const l = new P.Path.Line({ from: [a, 673], to: [a + 74, 673], insert: false, name: 'Rule' }); paint(l, null, 'rgba(255,211,110,0.7)', 2.5); LV.width.set(l, LV.width.PROFILES.taperBoth.pts); add(Ltype, l); });

    /* ---------- Artboard 2: poster ---------- */
    const X = 900;
    add(Lbg, paint(new P.Path.Rectangle({ rectangle: [X, 0, 1080, 1350], insert: false, name: 'Sky' }), grad('linear', [['#070d26', 0], ['#1e2160', 0.38], ['#6b3a8c', 0.62], ['#e2577a', 0.8], ['#ffb36b', 1]], 90)));
    const stars = new P.Group({ insert: false, name: 'Stars' });
    for (let i = 0; i < 70; i++) { const s = new P.Path.Circle({ center: [X + rnd() * 1080, rnd() * rnd() * 760], radius: 0.8 + rnd() * 2.2, insert: false }); paint(s, '#ffffff'); s.opacity = 0.35 + rnd() * 0.65; stars.addChild(s); }
    [[X + 160, 140, 12], [X + 860, 300, 9], [X + 420, 90, 7], [X + 990, 520, 6]].forEach(([x, y, r]) => { const s = new P.Path.Star({ center: [x, y], points: 4, radius1: r, radius2: r / 4, insert: false }); paint(s, '#ffffff'); stars.addChild(s); });
    add(Lbg, stars);
    const aur = new P.Group({ insert: false, name: 'Aurora' });
    const ribbon = (d, rot, op) => { const p = path(d, grad('linear', [['rgba(90,255,190,0)', 0], ['rgba(90,255,200,0.9)', 0.45], ['rgba(70,150,255,0)', 1]], 90), 'Aurora ribbon', X); p.rotate(rot); p.blendMode = 'screen'; p.opacity = op; aur.addChild(p); };
    ribbon('M-60 470 C 200 360 380 560 600 460 C 800 370 950 440 1140 380 L1140 520 C 950 590 800 500 600 610 C 380 720 200 520 -60 640 Z', -4, 0.75);
    ribbon('M-60 380 C 160 300 420 460 640 360 C 820 280 960 330 1140 280 L1140 360 C 960 420 820 360 640 450 C 420 550 160 400 -60 480 Z', 3, 0.45);
    ribbon('M-60 560 C 240 470 400 640 620 560 C 820 490 980 560 1140 500 L1140 560 C 980 620 820 560 620 640 C 400 720 240 560 -60 650 Z', -2, 0.35);
    const aurMask = new P.Path.Rectangle({ rectangle: [X, 0, 1080, 1350], insert: false }); const aurClip = new P.Group({ children: [aurMask, aur], insert: false, name: 'Aurora (clipped)' }); aurClip.clipped = true; add(Lart, aurClip);
    add(Lart, paint(new P.Path.Circle({ center: [X + 540, 820], radius: 300, insert: false, name: 'Sun glow' }), grad('radial', [['rgba(255,214,140,0.85)', 0], ['rgba(255,150,110,0.35)', 0.45], ['rgba(255,120,120,0)', 1]])));
    add(Lart, paint(new P.Path.Circle({ center: [X + 540, 820], radius: 125, insert: false, name: 'Sun' }), grad('linear', [['#fff4cf', 0], ['#ffc46b', 0.6], ['#ff8a5b', 1]], 90)));
    add(Lart, path('M0 1010 L0 905 C 90 865 150 770 230 750 C 300 732 340 806 400 798 C 470 788 520 700 600 690 C 690 680 730 786 820 776 C 900 768 960 708 1080 726 L1080 1010 Z', grad('linear', [['#5a4bb0', 0], ['#2a2357', 1]], 90), 'Far mountains', X, 70));
    add(Lart, path('M0 1100 L0 962 C 120 942 160 884 262 902 C 342 917 382 982 472 972 C 562 962 602 902 702 907 C 802 912 862 992 962 987 C 1012 984 1052 962 1080 957 L1080 1100 Z', '#1d1a3f', 'Near hills', X, 30));
    const lake = add(Lart, paint(new P.Path.Rectangle({ rectangle: [X, 1090, 1080, 260], insert: false, name: 'Lake' }), grad('linear', [['#241f4d', 0], ['#0b0a1f', 1]], 90)));
    // sun reflection: clipping mask (lake shape) over glinting bars
    const mask = lake.clone({ insert: false }); mask.fillColor = null;
    const bars = []; for (let i = 0; i < 7; i++) { const w = 260 - i * 30; const b = new P.Path.Rectangle({ rectangle: [X + 540 - w / 2, 1104 + i * 24, w, 7], radius: 3.5, insert: false, name: 'Glint' }); paint(b, '#ffc46b'); b.opacity = 0.8 - i * 0.1; bars.push(b); }
    const clip = new P.Group({ children: [mask, ...bars], insert: false, name: 'Reflection (clip group)' }); clip.clipped = true; add(Lart, clip);

    // type
    add(Ltype, text(new P.Point(X + 540, 250), 'NORTHERN\nLIGHTS', { family: 'Bebas Neue', weight: 400, size: 200, lead: 0.86, tracking: 40 }, '#ffffff', 'Title'));
    const sub = LV.newAreaText(new P.Rectangle(X + 190, 470, 700, 120), 'An evening of light, music and stargazing on the shore of Lake Aurora. Bring a blanket — the sky does the rest.', { family: 'Inter', weight: 400, size: 27, leading: 1.45, tracking: 0, align: 'center' });
    sub.name = 'Intro paragraph'; LV.setTextStyle(sub, { align: 'center' }); LV.paintTargets(sub)[0].fillColor = new P.Color('#efe6ff'); add(Ltype, sub);
    const arc = new P.Path.Arc({ from: [X + 360, 880], through: [X + 540, 630], to: [X + 720, 880], insert: false });
    const pt = LV.makePathText(arc, 'FESTIVAL OF LIGHT  ·  21 — 23 MARCH', { family: 'Montserrat', weight: 600, size: 22, tracking: 180, align: 'center' });
    pt.data.fill = '#ffe7b3'; LV.layoutPathText(pt); pt.name = 'Arc text'; add(Ltype, pt);
    const badge = new P.Group({ insert: false, name: 'Badge' });
    const burst = paint(new P.Path.Star({ center: [X + 930, 118], points: 18, radius1: 82, radius2: 70, insert: false, name: 'Burst' }), '#ffd36e'); burst.rotate(8);
    const bring = new P.Path.Circle({ center: [X + 930, 118], radius: 60, insert: false, name: 'Badge ring' }); paint(bring, null, '#1d1a3f', 2); bring.dashArray = [4, 4];
    badge.addChildren([burst, bring, text(new P.Point(X + 930, 110), 'FREE\nENTRY', { family: 'Bebas Neue', weight: 400, size: 36, lead: 0.9, tracking: 30 }, '#1d1a3f', 'Badge text')]);
    badge.rotate(12); add(Ltype, badge);
    const mini = emblem.clone({ insert: false }); mini.name = 'Logo mark'; mini.scale(0.2); mini.position = new P.Point(X + 92, 92); LV.reUid(mini); add(Ltype, mini);
    add(Ltype, text(new P.Point(X + 150, 104), 'AURORA STUDIO', { family: 'Montserrat', weight: 700, size: 22, tracking: 300, align: 'left' }, '#ffffff', 'Brand'));
    const rule = new P.Path.Line({ from: [X + 120, 1238], to: [X + 960, 1238], insert: false, name: 'Footer rule' }); paint(rule, null, 'rgba(255,255,255,0.55)', 1.5); rule.dashArray = [10, 6]; add(Ltype, rule);
    add(Ltype, text(new P.Point(X + 540, 1292), 'LAKESIDE PARK   ·   7 PM   ·   AURORA.STUDIO', { family: 'Inter', weight: 600, size: 20, tracking: 250 }, '#e9e4ff', 'Footer'));

    /* ---------- v1.1 showcase: live effects, symbols, a blend, live shapes ---------- */
    const fx = (it, o) => { it.data.fx = o; return it; };
    fx(LV.paintTargets(Ltype.children.find(c => c.name === 'Title'))[0] || Ltype.children.find(c => c.name === 'Title'), { outerGlow: { on: true, blur: 26, color: '#7fe6ff', opacity: 0.55 } });
    fx(badge, { shadow: { on: true, x: 6, y: 8, blur: 10, color: '#0b0a1f', opacity: 0.55 } });
    fx(cut, { innerGlow: { on: true, blur: 18, color: '#fff4cf', opacity: 0.7 }, outerGlow: { on: true, blur: 30, color: '#ff8a5b', opacity: 0.45 } });
    fx(Ltype.children.find(c => c.name === 'Wordmark'), { shadow: { on: true, x: 0, y: 6, blur: 12, color: '#000000', opacity: 0.45 } });
    // sparkle symbol, reused across the poster sky
    const spk = new P.Path.Star({ center: [0, 0], points: 4, radius1: 14, radius2: 3.2, insert: false }); spk.fillColor = '#ffffff';
    const halo = new P.Path.Circle({ center: [0, 0], radius: 5, insert: false }); halo.fillColor = 'rgba(190,240,255,0.9)';
    const symArt = new P.Group({ insert: false, children: [spk, halo] });
    const sym = { id: 'sparkle', name: 'Sparkle', art: symArt.exportJSON({ asString: false }), v: 1 }; D.symbols = [sym];
    const sg = new P.Group({ insert: false, name: 'Sparkles (symbol instances)' });
    [[X + 120, 400, 1.3, 0], [X + 980, 210, 1, 20], [X + 300, 160, 0.8, 10], [X + 760, 110, 1.5, 0], [X + 860, 650, 0.7, 15], [X + 200, 640, 0.9, 30]].forEach(([x, y, s, r]) => sg.addChild(LV.sym.makeInstance(sym, new P.Matrix().translate(x, y).rotate(r).scale(s))));
    add(Lbg, sg); sg.children.forEach(i => LV.uidOf(i));
    // lake ripples: a live blend between two glowing strokes
    const r1 = new P.Path({ segments: [[X + 330, 1150], [X + 540, 1138], [X + 750, 1150]], insert: false }); r1.smooth(); paint(r1, null, 'rgba(255,196,107,0.85)', 3); r1.strokeCap = 'round';
    const r2 = new P.Path({ segments: [[X + 160, 1320], [X + 540, 1290], [X + 920, 1320]], insert: false }); r2.smooth(); paint(r2, null, 'rgba(120,110,255,0.15)', 1); r2.strokeCap = 'round';
    const bl = new P.Group({ insert: false, name: 'Ripples (blend)', data: { kind: 'blend', blend: { mode: 'steps', steps: 9, dist: 20 } } });
    [r1, r2].forEach(k => { k.data.role = 'blendKey'; bl.addChild(k); }); add(Lart, bl); LV.blend.regen(bl, true);
    // live rounded "ticket" with a double stroke (Appearance) on the logo board
    const ticket = LV.live.rect(new P.Rectangle(250, 712, 300, 44), 22); ticket.name = 'Ticket (live shape)';
    paint(ticket, null, '#ffd36e', 1.5); ticket.data.fx = { extra: [{ kind: 'stroke', paint: 'rgba(255,211,110,0.25)', width: 9, opacity: 1, above: false, on: true }] };
    add(Ltype, ticket);
    /* ---------- v1.2 showcase: a radial Repeat of rays around the emblem, an Arc-warped wordmark ---------- */
    const ray = paint(new P.Path.Rectangle({ rectangle: [398, 86, 4, 20], radius: 2, insert: false, name: 'Ray' }), 'rgba(255,211,110,0.75)');
    add(Lart, ray); LV.repeat.make('radial', [ray]); const rays = LV.sel[0]; LV.repeat.setOptions(rays, { count: 40, radius: 234 }, null); rays.name = 'Rays (radial repeat)'; LV.repeat.last = null;
    const wm = Ltype.children.find(c => c.name === 'Wordmark'); LV.warp.make({ style: 'arc', bend: 9, dh: 0, dv: 0 }, [wm]).name = 'Wordmark (arc warp)';
    add(Ltype, text(new P.Point(400, 740), 'EST. 2026', { family: 'Inter', weight: 700, size: 16, tracking: 400 }, '#ffd36e', 'Ticket text'));

    Ltype.activate();
    D.active = 1;
    LV.setSel([]);
    LV.hist.reset('Open Sample', LV.snapshot());
    Aero.setDoc(D.name, false);
    LV.fitAll(); LV.emit('changed');
  };
})();
