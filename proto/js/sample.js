'use strict';
/* Lumen Proto — "Wanderly" sample: a 4-screen travel app built with components, variants, color & text styles,
   auto layout and a working click-through prototype. Illustrations are generated procedurally (no assets). */
(function () {
  const LP = window.LP;
  window.SAMPLE = {};

  /* ---------- procedural illustrations ---------- */
  function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function scenic(w, h, P, seed) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const R = rng(seed);
    const sky = x.createLinearGradient(0, 0, 0, h * .75); P.sky.forEach((col, i) => sky.addColorStop(i / (P.sky.length - 1), col)); x.fillStyle = sky; x.fillRect(0, 0, w, h);
    // sun with glow
    const sx = w * P.sun[0], sy = h * P.sun[1], sr = w * .09;
    const glow = x.createRadialGradient(sx, sy, 0, sx, sy, sr * 5); glow.addColorStop(0, P.glow); glow.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = glow; x.fillRect(0, 0, w, h);
    x.fillStyle = P.sunColor; x.beginPath(); x.arc(sx, sy, sr, 0, 7); x.fill();
    // clouds
    x.fillStyle = 'rgba(255,255,255,.35)';
    for (let i = 0; i < 4; i++) { const cx = R() * w, cy = h * (.12 + R() * .25), cw = w * (.15 + R() * .2); x.beginPath(); x.ellipse(cx, cy, cw, cw * .16, 0, 0, 7); x.fill(); }
    // mountain layers
    P.layers.forEach((col, li) => {
      const base = h * (P.base + li * .085), amp = h * (P.amp - li * .045);
      x.fillStyle = col; x.beginPath(); x.moveTo(0, h);
      let y = base - R() * amp; x.lineTo(0, y);
      const steps = 3 + li * 2;
      for (let i = 1; i <= steps; i++) {
        const px = i / steps * w, peak = base - (R() * .55 + .45) * amp;
        const mx = px - w / steps / 2 + (R() - .5) * w / steps * .4;
        const sh = w / steps * .18;
        x.lineTo(mx - sh, peak + amp * .12); x.lineTo(mx - sh * .3, peak + amp * .03); x.lineTo(mx, peak); x.lineTo(mx + sh * .4, peak + amp * .06); x.lineTo(mx + sh * .7, peak + amp * .04);
        x.lineTo(px, base - (R() * .3 + .1) * amp);
      }
      x.lineTo(w, h); x.closePath(); x.fill();
      if (li === 0 && P.snow) { x.save(); x.clip(); const sg = x.createLinearGradient(0, base - amp, 0, base - amp * .45); sg.addColorStop(0, 'rgba(255,255,255,.7)'); sg.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = sg; x.fillRect(0, 0, w, base); x.restore(); }
    });
    if (P.water) { const g = x.createLinearGradient(0, h * .78, 0, h); g.addColorStop(0, P.water[0]); g.addColorStop(1, P.water[1]); x.fillStyle = g; x.fillRect(0, h * .8, w, h * .2); x.fillStyle = 'rgba(255,255,255,.25)'; for (let i = 0; i < 26; i++) { x.fillRect(R() * w, h * (.82 + R() * .16), 20 + R() * 60, 2); } }
    if (P.houses) { for (let i = 0; i < 26; i++) { const hx = R() * w, hy = h * (.6 + R() * .22), hw = 26 + R() * 30, hh = 18 + R() * 22; x.fillStyle = '#f8f6f2'; x.fillRect(hx, hy, hw, hh); x.fillStyle = 'rgba(30,60,120,.25)'; x.fillRect(hx + hw * .3, hy + hh * .4, hw * .2, hh * .4); if (R() > .7) { x.fillStyle = '#2d6cc4'; x.beginPath(); x.arc(hx + hw / 2, hy, hw / 3, Math.PI, 0); x.fill(); } } }
    // grain-free vignette
    const v = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * .3, w / 2, h / 2, Math.max(w, h) * .8); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.18)'); x.fillStyle = v; x.fillRect(0, 0, w, h);
    return c.toDataURL('image/jpeg', .86);
  }
  function avatar() {
    const c = document.createElement('canvas'); c.width = c.height = 160; const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, 160, 160); g.addColorStop(0, '#ffd3a8'); g.addColorStop(1, '#f2643d'); x.fillStyle = g; x.fillRect(0, 0, 160, 160);
    x.fillStyle = '#7a3a22'; x.beginPath(); x.ellipse(80, 64, 34, 38, 0, 0, 7); x.fill();
    x.fillStyle = '#f7c9a2'; x.beginPath(); x.ellipse(80, 72, 26, 30, 0, 0, 7); x.fill();
    x.fillStyle = '#1f8a70'; x.beginPath(); x.ellipse(80, 168, 62, 58, 0, 0, 7); x.fill();
    return c.toDataURL('image/jpeg', .9);
  }
  const PAL = {
    dolomites: { sky: ['#ffb38a', '#ff8c6b', '#c76b98', '#5b4a8b'], sun: [.68, .42], sunColor: '#fff2d6', glow: 'rgba(255,220,170,.85)', layers: ['#6d5a8f', '#4b3f72', '#2f2a52'], base: .62, amp: .38, snow: true },
    santorini: { sky: ['#bfe6ff', '#8dd0f5', '#5bb4e8'], sun: [.25, .25], sunColor: '#fffbea', glow: 'rgba(255,255,230,.8)', layers: ['#d8cbb8', '#c4b49c'], base: .68, amp: .16, water: ['#2a7fc4', '#16508a'], houses: true },
    patagonia: { sky: ['#cfeee6', '#9fd8cf', '#5fb3b3'], sun: [.78, .3], sunColor: '#ffffff', glow: 'rgba(255,255,255,.7)', layers: ['#3f7f86', '#2e636e', '#1d4651'], base: .6, amp: .42, snow: true, water: ['#4fa3a5', '#1d5b66'] },
    onboarding: { sky: ['#ffd9b8', '#ffb08a', '#f2643d', '#b8425a'], sun: [.5, .5], sunColor: '#fff4e0', glow: 'rgba(255,230,190,.9)', layers: ['#c4506a', '#8f3a62', '#5a2a55'], base: .66, amp: .36, snow: false }
  };

  /* ---------- builder helpers ---------- */
  SAMPLE.build = function () {
    const doc = LP.newDoc(); doc.name = 'Wanderly — travel app'; doc.bg = '#e4e8ee';
    const img = {}; Object.keys(PAL).forEach((k, i) => { img[k] = 'img_' + k; doc.images[img[k]] = scenic(k === 'onboarding' ? 800 : 720, k === 'onboarding' ? 1100 : 520, PAL[k], 7 + i * 31); });
    img.avatar = 'img_avatar'; doc.images.img_avatar = avatar();
    // color styles
    const C = {};
    [['primary', 'Primary', '#f2643d'], ['primaryHover', 'Primary / Hover', '#e0532d'], ['primaryPressed', 'Primary / Pressed', '#c4441f'], ['ink', 'Ink', '#16181d'], ['muted', 'Muted', '#6b7280'],
     ['sand', 'Sand', '#f6f2ec'], ['surface', 'Surface', '#ffffff'], ['line', 'Line', '#e7e2da'], ['teal', 'Teal', '#1f8a70'], ['gold', 'Gold', '#f5a524']]
      .forEach(([k, n, c]) => { C[k] = { id: 'cs_' + k, name: n, color: c, a: 1 }; doc.colorStyles.push(C[k]); });
    const fill = k => ({ type: 'solid', color: C[k].color, a: 1, style: C[k].id, on: true });
    // text styles
    const T = {};
    [['display', 'Display', 32, 700, 38, -0.6], ['title', 'Title', 22, 700, 28, -0.3], ['headline', 'Headline', 17, 600, 22, -0.1], ['body', 'Body', 15, 400, 22, 0], ['caption', 'Caption', 13, 500, 18, 0], ['button', 'Button', 16, 600, 20, 0]]
      .forEach(([k, n, size, weight, lh, ls]) => { T[k] = { id: 'ts_' + k, name: n, font: 'Inter', size, weight, italic: false, lh, ls }; doc.textStyles.push(T[k]); });
    const text = (str, st, col, p = {}) => { const s = T[st]; return LP.node('text', Object.assign({ name: p.name || str.slice(0, 24), text: str, font: s.font, size: s.size, weight: s.weight, lh: s.lh, ls: s.ls, textStyleId: s.id, fills: [fill(col)] }, p)); };
    const frame = (name, p = {}, kids = []) => LP.node('frame', Object.assign({ name, fills: [], children: kids }, p));
    const stack = (name, mode, gap, pad, p = {}, kids = []) => frame(name, Object.assign({ layout: { mode, gap, pad, align: p.align || 'start', justify: p.justify || 'start' }, sizeH: 'hug', sizeV: 'hug' }, p), kids);
    const icon = (name, col, size = 24, p = {}) => LP.node('icon', Object.assign({ name: p.name || name, icon: name, color: C[col] ? C[col].color : col, w: size, h: size, sw: p.sw || 2 }, p));
    const image = (id, w, h, p = {}) => LP.node('rect', Object.assign({ name: 'Image', w, h, fills: [{ type: 'image', img: id, mode: 'fill', a: 1, on: true }] }, p));
    const inst = (main, p = {}, ov = {}) => { const o = {}; for (const k in ov) o[k] = Object.assign({ __: ov[k].__ }, ov[k]); return LP.node('instance', Object.assign({ name: main.component.set || main.name, componentId: main.id, w: main.w, h: main.h, sizeH: main.sizeH, sizeV: main.sizeV, overrides: o }, p)); };
    const shadow = (y, blur, a) => ({ x: 0, y, blur, spread: 0, color: '#1b1f2a', a, on: true });

    /* ---------- components ---------- */
    const comps = [];
    let cx = 0; const CY = 1500;
    const place = (n, gap = 64) => { n.x = cx; n.y = CY; cx += n.w + gap; comps.push(n); return n; };
    // Button: Default / Hover / Pressed
    const btn = (variant, col, extra = {}) => stack(`Button – ${variant}`, 'h', 8, [16, 28, 16, 28], Object.assign({ id: 'btn' + variant, align: 'center', justify: 'center', fills: [fill(col)], radius: [16, 16, 16, 16], component: { set: 'Button', variant, desc: 'Primary call to action' }, w: 160, h: 52 }, extra),
      [Object.assign(text('Continue', 'button', 'surface', { name: 'Label' }), { id: 'btnLabel' + variant })]);
    const bDef = place(btn('Default', 'primary', { shadows: [{ x: 0, y: 6, blur: 16, spread: -4, color: '#f2643d', a: .45, on: true }] }), 24);
    const bHov = place(btn('Hover', 'primaryHover', { shadows: [{ x: 0, y: 10, blur: 22, spread: -4, color: '#f2643d', a: .55, on: true }] }), 24);
    const bPre = place(btn('Pressed', 'primaryPressed', { shadows: [{ x: 0, y: 2, blur: 6, spread: 0, color: '#000000', a: .25, inner: true, on: true }] }));
    bDef.proto = [{ trigger: 'hover', action: 'changeTo', target: bHov.id, trans: 'smart', ease: 'ease-out', dur: 160 }, { trigger: 'press', action: 'changeTo', target: bPre.id, trans: 'instant', dur: 100 }];
    bHov.proto = [{ trigger: 'press', action: 'changeTo', target: bPre.id, trans: 'instant', dur: 100 }];
    // Secondary button
    const bSec = place(stack('Button / Secondary', 'h', 10, [15, 24, 15, 24], { id: 'btnSec', align: 'center', justify: 'center', fills: [fill('surface')], strokes: [{ color: C.line.color, style: C.line.id, a: 1, w: 1.5, align: 'inside', on: true }], radius: [16, 16, 16, 16], component: { set: null, variant: null, desc: 'Outline button' } },
      [Object.assign(icon('user', 'ink', 20), { id: 'secIcon' }), Object.assign(text('Continue as guest', 'button', 'ink', { name: 'Label' }), { id: 'secLabel' })]));
    // Input
    const input = place(stack('Input', 'h', 12, [0, 16, 0, 16], { id: 'input', align: 'center', w: 345, h: 54, sizeH: 'fixed', sizeV: 'fixed', fills: [fill('surface')], strokes: [{ color: C.line.color, style: C.line.id, a: 1, w: 1, align: 'inside', on: true }], radius: [14, 14, 14, 14], component: { desc: 'Text field' } },
      [Object.assign(icon('mail', 'muted', 20, { name: 'Icon' }), { id: 'inIcon' }), Object.assign(text('Email address', 'body', 'muted', { name: 'Placeholder', sizeH: 'fill' }), { id: 'inText' })]));
    // Chip: Default / Selected
    const chip = (variant, sel) => stack(`Chip – ${variant}`, 'h', 6, [9, 16, 9, 16], { id: 'chip' + variant, align: 'center', fills: [fill(sel ? 'ink' : 'surface')], strokes: sel ? [] : [{ color: C.line.color, style: C.line.id, a: 1, w: 1, align: 'inside', on: true }], radius: [20, 20, 20, 20], component: { set: 'Chip', variant } },
      [Object.assign(text('Mountains', 'caption', sel ? 'surface' : 'ink', { name: 'Label' }), { id: 'chipLabel' + variant })]);
    const chipD = place(chip('Default', false), 16), chipS = place(chip('Selected', true));
    chipD.proto = [{ trigger: 'tap', action: 'changeTo', target: chipS.id, trans: 'smart', ease: 'ease-out', dur: 200 }];
    chipS.proto = [{ trigger: 'tap', action: 'changeTo', target: chipD.id, trans: 'smart', ease: 'ease-out', dur: 200 }];
    // Like button: Off / On
    const like = (variant, on) => stack(`Like – ${variant}`, 'h', 0, [9, 9, 9, 9], { id: 'like' + variant, align: 'center', justify: 'center', fills: [{ type: 'solid', color: '#ffffff', a: on ? 1 : .32, on: true }], blur: { type: 'bg', r: 14, on: true }, radius: [22, 22, 22, 22], component: { set: 'Like', variant } },
      [Object.assign(icon('heart', on ? 'primary' : '#ffffff', 24, { name: 'Heart', sw: on ? 2.6 : 2 }), { id: 'likeIcon' + variant })]);
    const likeOff = place(like('Off', false), 16), likeOn = place(like('On', true));
    likeOff.proto = [{ trigger: 'tap', action: 'changeTo', target: likeOn.id, trans: 'smart', ease: 'spring', dur: 450 }];
    likeOn.proto = [{ trigger: 'tap', action: 'changeTo', target: likeOff.id, trans: 'smart', ease: 'ease-out', dur: 200 }];
    // Destination card
    const card = place(stack('Destination card', 'v', 12, [12, 12, 16, 12], { id: 'card', w: 345, sizeH: 'fixed', sizeV: 'hug', fills: [fill('surface')], radius: [24, 24, 24, 24], shadows: [shadow(10, 28, .08), shadow(1, 3, .05)], component: { desc: 'Feed card' } }, [
      Object.assign(image(img.dolomites, 321, 190, { radius: [16, 16, 16, 16], sizeH: 'fill', name: 'Photo' }), { id: 'cardPhoto' }),
      Object.assign(stack('Title row', 'h', 8, [0, 4, 0, 4], { sizeH: 'fill', align: 'center', justify: 'between' }, [
        Object.assign(text('Dolomites, Italy', 'headline', 'ink', { name: 'Title' }), { id: 'cardTitle' }),
        stack('Rating', 'h', 4, [0, 0, 0, 0], { align: 'center' }, [icon('star', 'gold', 16, { sw: 2.4 }), Object.assign(text('4.9', 'caption', 'ink', { name: 'Score' }), { id: 'cardScore' })])
      ]), { id: 'cardRow' }),
      Object.assign(stack('Meta', 'h', 6, [0, 4, 0, 4], { align: 'center' }, [icon('map-pin', 'muted', 16), Object.assign(text('Trentino · 6 day trek', 'caption', 'muted', { name: 'Location' }), { id: 'cardLoc' })]), { id: 'cardMeta' }),
      Object.assign(inst(likeOff, { name: 'Like', absolute: true, x: 279, y: 22 }), { id: 'cardLike' })
    ]));
    // Tab bar item component is overkill; tab bar is a plain frame on the screen.

    /* ---------- screens ---------- */
    const W = 393, H = 852, GAP = 120;
    const sx = i => (i + 1) * (W + GAP);
    // 1. Onboarding
    const splash = frame('Splash', { id: 'scrSplash', x: 0, y: 0, w: W, h: H, fills: [{ type: 'linear', angle: 160, a: 1, on: true, stops: [{ p: 0, color: '#ff8a5c', a: 1 }, { p: .55, color: '#f2643d', a: 1 }, { p: 1, color: '#b8425a', a: 1 }] }], flowStart: 'Main flow',
      layout: { mode: 'v', gap: 14, pad: [0, 24, 40, 24], align: 'center', justify: 'center' }, sizeH: 'fixed', sizeV: 'fixed' }, [
      stack('Logo', 'h', 0, [22, 22, 22, 22], { fills: [{ type: 'solid', color: '#ffffff', a: .18, on: true }], strokes: [{ color: '#ffffff', a: .35, w: 1, align: 'inside', on: true }], radius: [32, 32, 32, 32], shadows: [shadow(16, 40, .18)] }, [icon('compass', '#ffffff', 56, { sw: 1.8 })]),
      text('Wanderly', 'display', 'surface', { name: 'Wordmark' }),
      text('Travel, beautifully planned', 'body', 'surface', { name: 'Tagline', opacity: .85 })
    ]);
    splash.proto = [{ trigger: 'delay', delay: 1400, action: 'navigate', target: 'scrOnboarding', trans: 'dissolve', dur: 500, ease: 'ease-in-out' }];
    const onb = frame('Onboarding', { id: 'scrOnboarding', x: sx(0), y: 0, w: W, h: H, fills: [fill('sand')] }, [
      image(img.onboarding, W, 540, { name: 'Hero', radius: [0, 0, 36, 36], cons: { h: 'lr', v: 'top' } }),
      Object.assign(stack('Skip', 'h', 0, [7, 14, 7, 14], { x: 313, y: 56, fills: [{ type: 'solid', color: '#ffffff', a: .28, on: true }], blur: { type: 'bg', r: 12, on: true }, radius: [16, 16, 16, 16] }, [text('Skip', 'caption', 'surface')]), { id: 'onbSkip' }),
      stack('Dots', 'h', 6, [0, 0, 0, 0], { x: 24, y: 574, align: 'center' }, [
        LP.node('rect', { name: 'Active', w: 24, h: 8, radius: [4, 4, 4, 4], fills: [fill('primary')] }),
        LP.node('ellipse', { name: 'Dot', w: 8, h: 8, fills: [fill('line')] }), LP.node('ellipse', { name: 'Dot', w: 8, h: 8, fills: [fill('line')] })]),
      text('Find places that\nmove you', 'display', 'ink', { x: 24, y: 602, name: 'Headline' }),
      text('Curated trips, hidden trails and local guides — planned in minutes, remembered for years.', 'body', 'muted', { x: 24, y: 690, w: 345, auto: 'height', name: 'Intro' }),
      Object.assign(inst(bDef, { x: 24, y: 760, w: 345, sizeH: 'fixed', name: 'Get started' }, { btnLabelDefault: { text: 'Get started', __: 'Label' } }), { id: 'onbCta' })
    ]);
    // 2. Login
    const login = frame('Log in', { id: 'scrLogin', x: sx(1), y: 0, w: W, h: H, fills: [fill('sand')] }, [
      Object.assign(stack('Back', 'h', 0, [11, 11, 11, 11], { x: 24, y: 56, align: 'center', justify: 'center', fills: [fill('surface')], strokes: [{ color: C.line.color, style: C.line.id, a: 1, w: 1, align: 'inside', on: true }], radius: [22, 22, 22, 22] }, [icon('arrow-left', 'ink', 20)]), { id: 'loginBack' }),
      stack('Form', 'v', 16, [0, 0, 0, 0], { x: 24, y: 128, w: 345, sizeH: 'fixed' }, [
        text('Welcome back', 'display', 'ink', { name: 'Title' }),
        text('Log in to keep planning your next escape.', 'body', 'muted', { name: 'Subtitle', sizeH: 'fill', auto: 'height' }),
        frame('Spacer', { w: 345, h: 8, sizeH: 'fill' }),
        inst(input, { name: 'Email', sizeH: 'fill' }, { inText: { text: 'alex@wanderly.app', fills: [fill('ink')], __: 'Placeholder' } }),
        inst(input, { name: 'Password', sizeH: 'fill' }, { inIcon: { icon: 'lock', __: 'Icon' }, inText: { text: '••••••••••', fills: [fill('ink')], __: 'Placeholder' } }),
        text('Forgot password?', 'caption', 'primary', { name: 'Forgot', sizeH: 'fill', auto: 'height', align: 'right' }),
        Object.assign(inst(bDef, { name: 'Log in', sizeH: 'fill' }, { btnLabelDefault: { text: 'Log in', __: 'Label' } }), { id: 'loginCta' }),
        stack('Divider', 'h', 12, [6, 0, 6, 0], { sizeH: 'fill', align: 'center' }, [
          LP.node('rect', { name: 'Line', w: 100, h: 1, sizeH: 'fill', fills: [fill('line')] }), text('or', 'caption', 'muted'), LP.node('rect', { name: 'Line', w: 100, h: 1, sizeH: 'fill', fills: [fill('line')] })]),
        Object.assign(inst(bSec, { name: 'Guest', sizeH: 'fill' }), { id: 'loginGuest' })
      ]),
      text('New here? Create an account', 'caption', 'muted', { x: 0, y: 790, w: W, auto: 'height', align: 'center', name: 'Footer' })
    ]);
    // 3. Home (scrolls)
    const feed = stack('Feed', 'v', 20, [0, 0, 0, 0], { x: 24, y: 360, w: 345, sizeH: 'fixed' }, [
      Object.assign(inst(card, { name: 'Card – Dolomites' }), { id: 'card1' }),
      Object.assign(inst(card, { name: 'Card – Santorini' }, { cardPhoto: { fills: [{ type: 'image', img: img.santorini, mode: 'fill', a: 1, on: true }], __: 'Photo' }, cardTitle: { text: 'Santorini, Greece', __: 'Title row/Title' }, cardScore: { text: '4.8', __: 'Title row/Rating/Score' }, cardLoc: { text: 'Cyclades · 4 day escape', __: 'Meta/Location' } }), { id: 'card2' }),
      Object.assign(inst(card, { name: 'Card – Patagonia' }, { cardPhoto: { fills: [{ type: 'image', img: img.patagonia, mode: 'fill', a: 1, on: true }], __: 'Photo' }, cardTitle: { text: 'Patagonia, Chile', __: 'Title row/Title' }, cardLoc: { text: 'Torres del Paine · 9 days', __: 'Meta/Location' } }), { id: 'card3' })
    ]);
    const home = frame('Home', { id: 'scrHome', x: sx(2), y: 0, w: W, h: 1380, viewportH: H, fills: [fill('sand')] }, [
      stack('Header', 'h', 12, [0, 0, 0, 0], { id: 'homeHeader', x: 24, y: 58, w: 345, sizeH: 'fixed', align: 'center', justify: 'between' }, [
        stack('Greeting', 'v', 2, [0, 0, 0, 0], {}, [text('Good morning', 'caption', 'muted'), text('Hi, Alex', 'title', 'ink')]),
        LP.node('ellipse', { name: 'Avatar', w: 44, h: 44, fills: [{ type: 'image', img: img.avatar, mode: 'fill', a: 1, on: true }], strokes: [{ color: '#ffffff', a: 1, w: 2, align: 'outside', on: true }], shadows: [shadow(4, 10, .15)] })]),
      text('Where to next?', 'display', 'ink', { x: 24, y: 128, name: 'Title' }),
      inst(input, { name: 'Search', x: 24, y: 186 }, { inIcon: { icon: 'search', __: 'Icon' }, inText: { text: 'Search destinations', __: 'Placeholder' } }),
      stack('Categories', 'h', 8, [0, 0, 0, 0], { x: 24, y: 260 }, [
        inst(chipS, { name: 'All' }, { chipLabelSelected: { text: 'All', __: 'Label' } }), inst(chipD, { name: 'Mountains' }),
        inst(chipD, { name: 'Beaches' }, { chipLabelDefault: { text: 'Beaches', __: 'Label' } }), inst(chipD, { name: 'Cities' }, { chipLabelDefault: { text: 'Cities', __: 'Label' } })]),
      stack('Section', 'h', 8, [0, 0, 0, 0], { x: 24, y: 322, w: 345, sizeH: 'fixed', align: 'center', justify: 'between' }, [text('Popular destinations', 'headline', 'ink'), text('See all', 'caption', 'primary')]),
      feed,
      Object.assign(stack('Tab bar', 'h', 0, [14, 44, 30, 44], { x: 0, y: H - 84, w: W, h: 84, sizeH: 'fixed', sizeV: 'fixed', fixed: true, justify: 'between', align: 'start', fills: [{ type: 'solid', color: '#ffffff', a: .82, on: true }], blur: { type: 'bg', r: 18, on: true }, shadows: [{ x: 0, y: -1, blur: 0, spread: 0, color: '#000000', a: .06, on: true }] }, [
        Object.assign(icon('house', 'primary', 24, { sw: 2.2 }), { id: 'tabHome' }), icon('compass', 'muted', 24), icon('heart', 'muted', 24), icon('user', 'muted', 24)]), { id: 'tabbar' })
    ]);
    // 4. Detail
    const detail = frame('Detail', { id: 'scrDetail', x: sx(3), y: 0, w: W, h: H, fills: [fill('sand')] }, [
      image(img.dolomites, W, 440, { name: 'Photo' }),
      Object.assign(stack('Back', 'h', 0, [10, 10, 10, 10], { x: 20, y: 56, fills: [{ type: 'solid', color: '#ffffff', a: .3, on: true }], blur: { type: 'bg', r: 14, on: true }, radius: [22, 22, 22, 22] }, [icon('chevron-left', '#ffffff', 24)]), { id: 'detBack' }),
      inst(likeOff, { name: 'Like', x: 329, y: 56 }),
      stack('Sheet', 'v', 14, [28, 24, 24, 24], { x: 0, y: 404, w: W, h: 360, sizeH: 'fixed', sizeV: 'fixed', fills: [fill('sand')], radius: [32, 32, 0, 0] }, [
        text('Dolomites', 'display', 'ink', { name: 'Title' }),
        stack('Meta', 'h', 6, [0, 0, 0, 0], { align: 'center' }, [icon('map-pin', 'primary', 16), text('Trentino, Italy', 'caption', 'muted')]),
        stack('Stats', 'h', 10, [4, 0, 4, 0], { sizeH: 'fill' }, [['4.9', 'Rating', 'star'], ['42 km', 'Trail', 'activity'], ['6 days', 'Trip', 'calendar']].map(([a, b, ic]) =>
          stack(b, 'v', 6, [12, 12, 12, 12], { sizeH: 'fill', fills: [fill('surface')], radius: [16, 16, 16, 16] }, [icon(ic, 'teal', 18), text(a, 'headline', 'ink'), text(b, 'caption', 'muted')]))),
        text('About', 'headline', 'ink'),
        text('Hike between jagged limestone towers, sleep in cosy rifugios and wake up to alpenglow. Guides, huts and luggage transfers included.', 'body', 'muted', { sizeH: 'fill', auto: 'height', name: 'Description' })
      ]),
      stack('Booking bar', 'h', 12, [0, 24, 8, 24], { x: 0, y: 764, w: W, h: 88, sizeH: 'fixed', sizeV: 'fixed', align: 'center', justify: 'between', fills: [fill('surface')], shadows: [shadow(-6, 20, .06)] }, [
        stack('Price', 'v', 0, [0, 0, 0, 0], {}, [text('From', 'caption', 'muted'), text('$1,240', 'title', 'ink', { name: 'Amount' })]),
        Object.assign(inst(bDef, { name: 'Book now', w: 180, sizeH: 'fixed' }, { btnLabelDefault: { text: 'Book now', __: 'Label' } }), { id: 'detBook' })])
    ]);
    // overlay: booking confirmation sheet
    const sheet = frame('Booking confirmed', { id: 'scrSheet', x: sx(4), y: 0, w: W, h: 400, fills: [fill('surface')], radius: [28, 28, 0, 0], layout: { mode: 'v', gap: 14, pad: [14, 24, 32, 24], align: 'center', justify: 'start' }, sizeH: 'fixed', sizeV: 'fixed' }, [
      LP.node('rect', { name: 'Grabber', w: 40, h: 5, radius: [3, 3, 3, 3], fills: [fill('line')] }),
      frame('Gap', { w: 10, h: 10 }),
      stack('Badge', 'h', 0, [18, 18, 18, 18], { fills: [{ type: 'solid', color: '#1f8a70', a: .12, on: true }], radius: [40, 40, 40, 40] }, [icon('circle-check', 'teal', 40, { sw: 2 })]),
      text("You're all set!", 'title', 'ink', { name: 'Title' }),
      text('Your spot on the Dolomites trek (12–18 June) is reserved. A confirmation is on its way to your inbox.', 'body', 'muted', { sizeH: 'fill', auto: 'height', align: 'center', name: 'Message' }),
      frame('Gap', { w: 10, h: 6 }),
      Object.assign(inst(bDef, { name: 'Done', sizeH: 'fill' }, { btnLabelDefault: { text: 'Done', __: 'Label' } }), { id: 'sheetDone' })
    ]);

    /* ---------- interactions ---------- */
    const I = (trigger, action, target, trans, dur = 350, ease = 'ease-out', extra = {}) => Object.assign({ trigger, action, target, trans, dur, ease }, extra);
    const find = (root, id) => { let r = null; LP.walk(root, n => { if (n.id === id) r = n; }); return r; };
    find(onb, 'onbCta').proto = [I('tap', 'navigate', login.id, 'slideLeft')];
    find(onb, 'onbSkip').proto = [I('tap', 'navigate', login.id, 'dissolve', 250)];
    find(login, 'loginBack').proto = [I('tap', 'back', null, 'slideRight')];
    find(login, 'loginCta').proto = [I('tap', 'navigate', home.id, 'dissolve', 300)];
    find(login, 'loginGuest').proto = [I('tap', 'navigate', home.id, 'pushUp', 400)];
    ['card1', 'card2', 'card3'].forEach(id => find(home, id).proto = [I('tap', 'navigate', detail.id, 'pushLeft', 380, 'ease-in-out')]);
    find(detail, 'detBack').proto = [I('tap', 'back', null, 'pushRight', 380, 'ease-in-out')];
    detail.proto = [I('key', 'back', null, 'pushRight', 380, 'ease-in-out', { key: 'ArrowLeft' })];
    find(home, 'tabHome').proto = [I('tap', 'scrollTo', 'homeHeader', 'smart', 450, 'ease-in-out', { offset: 58 })];
    find(detail, 'detBook').proto = [I('tap', 'overlay', sheet.id, 'slideUp', 320, 'ease-out', { overlayPos: 'bottom', dim: true })];
    find(sheet, 'sheetDone').proto = [I('tap', 'back', null, 'dissolve', 200)];

    // export marks (for dev handoff demo)
    onb.exports = [{ scale: 2, fmt: 'png' }]; card.exports = [{ scale: 1, fmt: 'png' }, { scale: 1, fmt: 'svg' }];
    // components label frame (a light backdrop behind main components)
    doc.children.push(...comps, splash, onb, login, home, detail, sheet);
    return doc;
  };
})();
