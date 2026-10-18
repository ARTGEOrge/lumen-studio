'use strict';
/* Lumen Slides — document model: themes, colours, masters/layouts, object factories, style inheritance,
   validation of opened files. Pure data (no DOM) so it also runs in Node for tests. */
(function (root) {
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const num = (v, d, a = -1e7, b = 1e7) => { v = +v; return Number.isFinite(v) ? clamp(v, a, b) : d; };

  /* ---------------- colours ---------------- */
  // A colour is '#rrggbb', a scheme name ('accent1','dk1','lt2','tx1','bg1',…) optionally with a luminance
  // modifier ':+40' (40 % lighter, PowerPoint lumMod/lumOff) or ':-25' (25 % darker).
  const SCHEME = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  const hex2rgb = h => { h = String(h).replace('#', ''); if (h.length === 3) h = h.replace(/./g, c => c + c); const v = parseInt(h.slice(0, 6), 16); return Number.isFinite(v) ? [(v >> 16) & 255, (v >> 8) & 255, v & 255] : [0, 0, 0]; };
  const rgb2hex = (r, g, b) => '#' + [r, g, b].map(x => clamp(Math.round(x), 0, 255).toString(16).padStart(2, '0')).join('');
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
    if (mx !== mn) { const d = mx - mn; s = l > .5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h /= 6; }
    return [h, s, l];
  }
  function hsl2rgb(h, s, l) {
    if (s === 0) return [l * 255, l * 255, l * 255];
    const q = l < .5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = t => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
  }
  // lumMod/lumOff as fractions
  function lum(hex, mod, off) { const [h, s, l] = rgb2hsl(...hex2rgb(hex)); return rgb2hex(...hsl2rgb(h, s, clamp(l * mod + off, 0, 1))); }
  function modify(hex, m) { if (!m) return hex; const v = m / 100; return v > 0 ? lum(hex, 1 - v, v) : lum(hex, 1 + v, 0); }
  function schemeHex(theme, name) {
    const map = theme.map || {};
    if (name === 'tx1') name = map.tx1 || 'dk1'; else if (name === 'bg1') name = map.bg1 || 'lt1';
    else if (name === 'tx2') name = map.tx2 || 'dk2'; else if (name === 'bg2') name = map.bg2 || 'lt2';
    return theme.colors[name] || '#000000';
  }
  function color(c, theme) {
    if (!c) return null;
    c = String(c);
    if (c[0] === '#') return c.length === 4 || c.length === 7 ? c.toLowerCase() : '#000000';
    const [name, m] = c.split(':');
    return modify(schemeHex(theme, name), m ? parseFloat(m) : 0);
  }
  const isScheme = c => typeof c === 'string' && c[0] !== '#';
  const font = (f, theme) => !f ? theme.fonts.minor : f === '+mj' ? theme.fonts.major : f === '+mn' ? theme.fonts.minor : f;

  /* ---------------- themes ---------------- */
  const P = (dk1, lt1, dk2, lt2, a) => ({ dk1, lt1, dk2, lt2, accent1: a[0], accent2: a[1], accent3: a[2], accent4: a[3], accent5: a[4], accent6: a[5], hlink: a[6] || '#2563eb', folHlink: a[7] || '#7c3aed' });
  const DARK = { tx1: 'lt1', bg1: 'dk1', tx2: 'lt2', bg2: 'dk2' };
  const PALETTES = [
    { id: 'lumen', name: 'Lumen', colors: P('#16243a', '#ffffff', '#1f4e8c', '#e9f0f8', ['#2f7de1', '#14b8a6', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b']) },
    { id: 'aurora', name: 'Aurora', colors: P('#0b1530', '#f4f7ff', '#16224a', '#c9d6ff', ['#38bdf8', '#a78bfa', '#34d399', '#f472b6', '#fbbf24', '#94a3b8']) },
    { id: 'paper', name: 'Paper', colors: P('#2b2420', '#fbf7f0', '#5a3e2b', '#efe6d8', ['#c0532f', '#3f7d6e', '#d9a441', '#6b5ca5', '#8a6a4f', '#7a8a99']) },
    { id: 'slate', name: 'Slate', colors: P('#15181d', '#f3f4f6', '#262b33', '#d1d5db', ['#f97316', '#22d3ee', '#a3e635', '#e11d48', '#facc15', '#9ca3af']) },
    { id: 'meadow', name: 'Meadow', colors: P('#1d2b22', '#f7fbf4', '#2f5d3a', '#e3efdc', ['#4f9d52', '#e0a526', '#2f7f9a', '#c2573a', '#7b6bb0', '#7d8b7a']) },
    { id: 'office', name: 'Classic', colors: P('#000000', '#ffffff', '#44546a', '#e7e6e6', ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47'], ['#0563c1', '#954f72']) },
    { id: 'sunset', name: 'Sunset', colors: P('#2a1020', '#fff7f2', '#5b1f3a', '#ffe3d6', ['#ff6b4a', '#ffb347', '#d6336c', '#7048e8', '#2b8a8a', '#a07c88']) },
    { id: 'chalk', name: 'Chalk', colors: P('#10261c', '#f2f5ee', '#1d3b2c', '#cfe0d2', ['#f6e27a', '#8fd3f4', '#f7a1c4', '#b8e986', '#ffb870', '#d0d7cf']) },
    { id: 'mono', name: 'Mono', colors: P('#111111', '#ffffff', '#333333', '#f0f0f0', ['#111111', '#555555', '#888888', '#bbbbbb', '#e5484d', '#0090ff']) },
    { id: 'ocean', name: 'Ocean', colors: P('#071a2b', '#f0f8ff', '#0b3954', '#d4ecf7', ['#00a6d6', '#2ec4b6', '#ffbf69', '#ff6b6b', '#5e60ce', '#8aa1b1']) },
  ];
  const FONT_PAIRS = [
    { id: 'mont-inter', name: 'Montserrat · Inter', major: 'Montserrat', minor: 'Inter' },
    { id: 'playfair-lora', name: 'Playfair Display · Lora', major: 'Playfair Display', minor: 'Lora' },
    { id: 'bebas-inter', name: 'Bebas Neue · Inter', major: 'Bebas Neue', minor: 'Inter' },
    { id: 'lora-inter', name: 'Lora · Inter', major: 'Lora', minor: 'Inter' },
    { id: 'inter', name: 'Inter', major: 'Inter', minor: 'Inter' },
    { id: 'caveat-inter', name: 'Caveat · Inter', major: 'Caveat', minor: 'Inter' },
    { id: 'office', name: 'Calibri Light · Calibri', major: 'Calibri Light', minor: 'Calibri' },
    { id: 'segoe', name: 'Segoe UI', major: 'Segoe UI Semibold', minor: 'Segoe UI' },
    { id: 'georgia', name: 'Georgia · Arial', major: 'Georgia', minor: 'Arial' },
  ];
  // Themes = palette + fonts + background + master decoration
  const THEMES = [
    { id: 'lumen', name: 'Lumen', pal: 'lumen', fonts: 'mont-inter', bg: { color: 'bg1' }, deco: 'bar' },
    { id: 'aurora', name: 'Aurora', pal: 'aurora', fonts: 'mont-inter', dark: true, bg: { grad: [[0, '#0b1530'], [0.6, '#16224a'], [1, '#2a1f5c']], ang: 135 }, deco: 'glow' },
    { id: 'paper', name: 'Paper', pal: 'paper', fonts: 'playfair-lora', bg: { color: 'bg1' }, deco: 'rule' },
    { id: 'slate', name: 'Slate', pal: 'slate', fonts: 'bebas-inter', dark: true, bg: { color: 'bg1' }, deco: 'corner' },
    { id: 'meadow', name: 'Meadow', pal: 'meadow', fonts: 'lora-inter', bg: { grad: [[0, '#f7fbf4'], [1, '#e3efdc']], ang: 90 }, deco: 'wave' },
    { id: 'office', name: 'Classic', pal: 'office', fonts: 'office', bg: { color: 'bg1' }, deco: null },
    { id: 'sunset', name: 'Sunset', pal: 'sunset', fonts: 'playfair-lora', dark: true, bg: { grad: [[0, '#5b1f3a'], [0.55, '#a8324f'], [1, '#ff7a4d']], ang: 120 }, deco: 'circle' },
    { id: 'chalk', name: 'Chalkboard', pal: 'chalk', fonts: 'caveat-inter', dark: true, bg: { color: 'bg1' }, deco: 'frame' },
    { id: 'mono', name: 'Mono', pal: 'mono', fonts: 'inter', bg: { color: 'bg1' }, deco: 'underline' },
    { id: 'ocean', name: 'Ocean', pal: 'ocean', fonts: 'mont-inter', dark: true, bg: { grad: [[0, '#071a2b'], [1, '#0b3954']], ang: 90 }, deco: 'band' },
  ];
  function makeTheme(themeId, palId, fontId) {
    const t = THEMES.find(x => x.id === themeId) || THEMES[0];
    const pal = PALETTES.find(p => p.id === (palId || t.pal)) || PALETTES[0];
    const fp = FONT_PAIRS.find(f => f.id === (fontId || t.fonts)) || FONT_PAIRS[0];
    return { id: t.id, name: t.name, colors: { ...pal.colors }, fonts: { major: fp.major, minor: fp.minor }, map: t.dark ? { ...DARK } : {} };
  }
  function themeDeco(kind, W, H) {
    const s = (o) => ({ id: uid(), type: 'shape', rot: 0, line: null, ...o });
    switch (kind) {
      case 'bar': return [s({ name: 'Accent bar', geom: 'rect', x: 0, y: 0, w: 14, h: H, fill: { color: 'accent1' } })];
      case 'glow': return [s({ name: 'Glow', geom: 'ellipse', x: W * .62, y: -H * .35, w: W * .6, h: H * .9, fill: { color: 'accent2', alpha: .16 } }), s({ name: 'Glow 2', geom: 'ellipse', x: -W * .15, y: H * .65, w: W * .4, h: H * .6, fill: { color: 'accent1', alpha: .12 } })];
      case 'rule': return [s({ name: 'Rule', geom: 'rect', x: W * .0625, y: H - 34, w: W * .875, h: 2, fill: { color: 'accent1' } })];
      case 'corner': return [s({ name: 'Corner', geom: 'rtTriangle', x: W - 180, y: H - 180, w: 180, h: 180, flipH: true, fill: { color: 'accent1' } })];
      case 'wave': return [s({ name: 'Leaf', geom: 'ellipse', x: W - 220, y: -120, w: 360, h: 300, fill: { color: 'accent1', alpha: .18 } })];
      case 'circle': return [s({ name: 'Sun', geom: 'ellipse', x: W * .72, y: H * .5, w: W * .42, h: W * .42, fill: { color: 'accent2', alpha: .22 } })];
      case 'frame': return [s({ name: 'Frame', geom: 'rect', x: 18, y: 18, w: W - 36, h: H - 36, fill: null, line: { color: 'tx1:-25', w: 2.5, dash: 'dash' } })];
      case 'underline': return [s({ name: 'Line', geom: 'rect', x: W * .0625, y: 150, w: 90, h: 6, fill: { color: 'accent5' } })];
      case 'band': return [s({ name: 'Band', geom: 'rect', x: 0, y: H - 12, w: W, h: 12, fill: { grad: [[0, 'accent1'], [1, 'accent2']], ang: 0 } })];
      default: return [];
    }
  }

  /* ---------------- text ---------------- */
  const para = (text, o = {}) => ({ runs: text === '' || text == null ? [] : [{ t: String(text), ...(o.run || {}) }], ...(o.p || {}) });
  const textBody = (paras, o = {}) => ({ paras: paras.length ? paras : [para('')], ...o });
  const plainText = tb => tb ? tb.paras.map(p => p.runs.map(r => r.t).join('')).join('\n') : '';

  /* ---------------- masters & layouts ---------------- */
  function defaultStyles() {
    return {
      title: { font: '+mj', size: 40, color: 'tx1', b: true, align: 'l', anchor: 'ctr', lnSp: 0.9 },
      body: { font: '+mn', color: 'tx1', align: 'l', anchor: 't', lv: [{ size: 26, bullet: '•' }, { size: 22, bullet: '–' }, { size: 20, bullet: '•' }, { size: 18, bullet: '–' }, { size: 18, bullet: '•' }], spB: 10 },
      other: { font: '+mn', size: 18, color: 'tx1', align: 'l', anchor: 't' },
    };
  }
  const ph = (type, idx, x, y, w, h, def) => ({ id: uid(), type: 'shape', geom: 'rect', fill: null, line: null, rot: 0, x, y, w, h, ph: { type, idx: idx || 0 }, text: textBody([para('')], def ? { def } : {}) });
  function defaultMaster(W, H, themeId) {
    const k = W / 1280, t = THEMES.find(x => x.id === themeId) || THEMES[0];
    return {
      bg: { ...t.bg }, objects: themeDeco(t.deco, W, H), styles: defaultStyles(),
      ph: [ph('title', 0, 80 * k, 40, 1120 * k, 110), ph('body', 1, 80 * k, 176, 1120 * k, 470), ph('dt', 10, 80 * k, 668, 280 * k, 32, { size: 12, color: 'tx1:+50' }),
        ph('ftr', 11, 420 * k, 668, 440 * k, 32, { size: 12, color: 'tx1:+50', align: 'c' }), ph('sldNum', 12, 920 * k, 668, 280 * k, 32, { size: 12, color: 'tx1:+50', align: 'r' })],
    };
  }
  function defaultLayouts(W) {
    const k = W / 1280, X = v => v * k;
    const L = (name, kind, objs) => ({ id: uid(), name, kind, objects: objs });
    return [
      L('Title Slide', 'title', [ph('ctrTitle', 0, X(140), 170, X(1000), 230, { size: 56, align: 'c', anchor: 'b' }), ph('subTitle', 1, X(140), 418, X(1000), 130, { size: 24, align: 'c', bullet: 'none', color: 'tx1:+25' })]),
      L('Title and Content', 'obj', [ph('title', 0, X(80), 40, X(1120), 110), ph('body', 1, X(80), 176, X(1120), 470)]),
      L('Section Header', 'secHead', [ph('title', 0, X(80), 230, X(1120), 190, { size: 50, anchor: 'b' }), ph('body', 1, X(80), 436, X(1120), 100, { size: 22, bullet: 'none', color: 'tx1:+25' })]),
      L('Two Content', 'twoObj', [ph('title', 0, X(80), 40, X(1120), 110), ph('body', 1, X(80), 176, X(545), 470), ph('body', 2, X(655), 176, X(545), 470)]),
      L('Comparison', 'twoTxTwoObj', [ph('title', 0, X(80), 40, X(1120), 110), ph('body', 1, X(80), 168, X(545), 56, { size: 24, b: true, bullet: 'none', anchor: 'b' }), ph('body', 2, X(80), 232, X(545), 420), ph('body', 3, X(655), 168, X(545), 56, { size: 24, b: true, bullet: 'none', anchor: 'b' }), ph('body', 4, X(655), 232, X(545), 420)]),
      L('Title Only', 'titleOnly', [ph('title', 0, X(80), 40, X(1120), 110)]),
      L('Blank', 'blank', []),
      L('Picture with Caption', 'picTx', [ph('title', 0, X(80), 90, X(430), 150, { size: 32, anchor: 'b' }), ph('pic', 1, X(560), 60, X(640), 600), ph('body', 2, X(80), 256, X(430), 380, { size: 18, bullet: 'none' })]),
      L('Big Statement', 'cust', [ph('title', 0, X(120), 160, X(1040), 400, { size: 60, align: 'c', anchor: 'ctr' })]),
    ];
  }
  function newDoc(opts = {}) {
    const W = opts.w || 1280, H = opts.h || 720, themeId = opts.theme || 'lumen';
    const doc = { app: 'lumen-slides', version: 1, w: W, h: H, theme: makeTheme(themeId), master: defaultMaster(W, H, themeId), layouts: defaultLayouts(W), slides: [], footer: { num: false, text: '', date: false, skipTitle: true } };
    if (opts.empty !== true) doc.slides.push(newSlide(doc, doc.layouts[0].id));
    return doc;
  }
  function newSlide(doc, layoutId) {
    const lay = doc.layouts.find(l => l.id === layoutId) || doc.layouts[1] || doc.layouts[0];
    return { id: uid(), layout: lay ? lay.id : null, bg: null, objects: lay ? lay.objects.filter(o => o.ph && phCat(o.ph) !== 'other').map(o => fromPh(o)) : [], notes: '', transition: { type: 'none', dur: 0.7 }, anims: [], hidden: false };
  }
  const fromPh = o => ({ id: uid(), type: 'shape', geom: 'rect', fill: null, line: null, rot: 0, x: o.x, y: o.y, w: o.w, h: o.h, ph: { ...o.ph }, text: textBody([para('')]) });
  // Re-map a slide's placeholders onto another layout (keeps content).
  function applyLayout(doc, slide, layoutId) {
    const lay = doc.layouts.find(l => l.id === layoutId); if (!lay) return;
    slide.layout = lay.id;
    const lph = lay.objects.filter(o => o.ph), used = new Set(), out = [];
    const cat = o => phCat(o.ph);
    for (const o of slide.objects) {
      if (!o.ph) { out.push(o); continue; }
      let m = lph.find(l => !used.has(l) && l.ph.type === o.ph.type && l.ph.idx === o.ph.idx) || lph.find(l => !used.has(l) && cat(l) === cat(o) && (cat(o) !== 'body' || l.ph.type === o.ph.type || l.ph.type === 'body' || l.ph.type === 'subTitle'));
      if (!m && o.type === 'image') m = lph.find(l => !used.has(l) && l.ph.type === 'pic');
      if (m) { used.add(m); o.ph = { ...m.ph }; if (!o.ownGeo) { o.x = m.x; o.y = m.y; o.w = m.w; o.h = m.h; } out.push(o); }
      else if (hasContent(o)) { delete o.ph; out.push(o); }
    }
    for (const l of lph) if (!used.has(l)) out.splice(out.filter(o => o.ph).length, 0, fromPh(l));
    slide.objects = out;
  }
  const hasContent = o => o.type !== 'shape' || (o.text && plainText(o.text).trim() !== '') || o.fill;
  function phCat(p) { if (!p) return null; const t = p.type; return t === 'title' || t === 'ctrTitle' ? 'title' : t === 'dt' || t === 'ftr' || t === 'sldNum' ? 'other' : 'body'; }
  const layoutOf = (doc, slide) => slide && doc.layouts.find(l => l.id === slide.layout) || null;
  function layoutPh(doc, slide, o) {
    if (!o.ph) return null;
    const lay = layoutOf(doc, slide); if (!lay) return null;
    const lp = lay.objects.filter(x => x.ph);
    return lp.find(x => x.ph.type === o.ph.type && x.ph.idx === o.ph.idx) || lp.find(x => x.ph.idx === o.ph.idx && o.ph.idx) || lp.find(x => x.ph.type === o.ph.type) || null;
  }
  const masterPh = (doc, type) => doc.master.ph.find(p => p.ph.type === type) || null;

  /* Base text style for an object: master category style ← layout placeholder defaults ← object defaults.
     Returns {font,size,color,b,i,align,anchor,lnSp,spB,spA,lv:[{size,bullet}],bulletOn}. ctx = {slide} or {layout} or {master:true}. */
  function baseStyle(doc, ctx, o) {
    const st = doc.master.styles; let cat = phCat(o.ph);
    let s;
    if (cat === 'title') s = { ...st.title };
    else if (cat === 'body') s = { ...st.body, lv: st.body.lv.map(l => ({ ...l })) };
    else if (cat === 'other') s = { ...st.other };
    else if (o.tb || o.type === 'table') s = { ...st.other, anchor: 't', align: 'l' };
    else s = { ...st.other, color: 'bg1', align: 'c', anchor: 'ctr' }; // text inside shapes
    if (!s.lv) s.lv = [0, 1, 2, 3, 4].map(i => ({ size: s.size || 18, bullet: 'none' }));
    if (cat === 'body') s.lv.forEach((l, i) => { if (l.size == null) l.size = s.size || 20; });
    else s.lv.forEach(l => { l.size = s.size || 18; l.bullet = 'none'; });
    const mergeDef = d => { if (!d) return; for (const k of Object.keys(d)) { if (k === 'size') s.lv.forEach((l, i) => l.size = i === 0 ? d.size : Math.max(8, d.size - 2 * i)); else if (k === 'bullet') s.lv.forEach(l => l.bullet = d.bullet); else s[k] = d[k]; } };
    if (o.ph) {
      if (ctx.slide) { const lp = layoutPh(doc, ctx.slide, o); if (lp && lp.text) mergeDef(lp.text.def); }
      if (ctx.master || (cat === 'other')) { const mp = masterPh(doc, o.ph.type); if (mp && mp.text && mp !== o) mergeDef(mp.text.def); }
    }
    if (o.text) mergeDef(o.text.def);
    return s;
  }
  const NUMFMT = ['arabicPeriod', 'arabicParenR', 'alphaLcPeriod', 'alphaUcPeriod', 'romanUcPeriod', 'romanLcPeriod', 'alphaLcParenR'];
  function numLabel(type, n) {
    const roman = v => { const m = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [k, r] of m) while (v >= k) { s += r; v -= k; } return s; };
    const alpha = v => { let s = ''; while (v > 0) { v--; s = String.fromCharCode(97 + v % 26) + s; v = Math.floor(v / 26); } return s; };
    switch (type) {
      case 'arabicParenR': return n + ')'; case 'alphaLcPeriod': return alpha(n) + '.'; case 'alphaUcPeriod': return alpha(n).toUpperCase() + '.';
      case 'alphaLcParenR': return alpha(n) + ')'; case 'romanUcPeriod': return roman(n).toUpperCase() + '.'; case 'romanLcPeriod': return roman(n) + '.';
      default: return n + '.';
    }
  }

  /* ---------------- object factories ---------------- */
  function textBox(x, y, w, h, text, o = {}) { return { id: uid(), type: 'shape', geom: 'rect', tb: true, x, y, w, h, rot: 0, fill: null, line: null, text: textBody(String(text).split('\n').map(t => para(t)), { autofit: 'grow', ...o }) }; }
  function shape(geom, x, y, w, h, o = {}) { return { id: uid(), type: 'shape', geom, x, y, w, h, rot: 0, fill: geom === 'line' ? null : { color: 'accent1' }, line: geom === 'line' ? { color: 'tx1', w: 3 } : null, ...o }; }
  function image(asset, x, y, w, h) { return { id: uid(), type: 'image', asset, x, y, w, h, rot: 0, crop: null, line: null }; }
  function table(x, y, w, rows, cols, data) {
    const cw = w / cols, rh = 44;
    return { id: uid(), type: 'table', x, y, w, h: rh * rows, rot: 0, cols: Array.from({ length: cols }, () => cw),
      rows: Array.from({ length: rows }, (_, r) => ({ h: rh, cells: Array.from({ length: cols }, (_, c) => ({ text: textBody([para(data && data[r] && data[r][c] != null ? data[r][c] : '')]) })) })),
      style: { first: true, band: true, color: 'accent1' } };
  }
  function chart(kind, x, y, w, h, data) {
    return { id: uid(), type: 'chart', x, y, w, h, rot: 0, kind: kind || 'col', title: data?.title ?? 'Chart title', legend: true, labels: false,
      cats: data?.cats || ['Q1', 'Q2', 'Q3', 'Q4'], series: data?.series || [{ name: 'Series 1', vals: [4.3, 2.5, 3.5, 4.5] }, { name: 'Series 2', vals: [2.4, 4.4, 1.8, 2.8] }, { name: 'Series 3', vals: [2, 2, 3, 5] }] };
  }
  const GEOMS = [['rect', 'Rectangle'], ['roundRect', 'Rounded rectangle'], ['ellipse', 'Oval'], ['triangle', 'Triangle'], ['rtTriangle', 'Right triangle'], ['diamond', 'Diamond'], ['parallelogram', 'Parallelogram'], ['trapezoid', 'Trapezoid'], ['pentagon', 'Pentagon'], ['hexagon', 'Hexagon'], ['octagon', 'Octagon'], ['star5', '5-point star'], ['star4', '4-point star'], ['plus', 'Plus'], ['heart', 'Heart'], ['donut', 'Donut'], ['rightArrow', 'Right arrow'], ['leftArrow', 'Left arrow'], ['upArrow', 'Up arrow'], ['downArrow', 'Down arrow'], ['leftRightArrow', 'Left-right arrow'], ['chevron', 'Chevron'], ['homePlate', 'Pentagon arrow'], ['wedgeRectCallout', 'Speech bubble'], ['wedgeEllipseCallout', 'Oval callout'], ['line', 'Line']];

  /* ---------------- tree helpers ---------------- */
  function walk(objs, fn, parent) { for (const o of objs) { fn(o, parent); if (o.type === 'group' && o.children) walk(o.children, fn, o); } }
  function findObj(objs, id) { let r = null; walk(objs, o => { if (o.id === id) r = o; }); return r; }
  function parentList(objs, id) { for (const o of objs) { if (o.id === id) return objs; if (o.type === 'group') { const r = parentList(o.children, id); if (r) return r; } } return null; }
  function groupBounds(children) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of children) { const b = aabb(c); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }
  function aabb(o) {
    const r = (o.rot || 0) * Math.PI / 180; if (!r) return { x: o.x, y: o.y, w: o.w, h: o.h };
    const c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r)), w = o.w * c + o.h * s, h = o.w * s + o.h * c;
    return { x: o.x + o.w / 2 - w / 2, y: o.y + o.h / 2 - h / 2, w, h };
  }
  // move / scale an object (and group children) into a new rect
  function setRect(o, x, y, w, h) {
    if (o.type === 'group') {
      const sx = o.w ? w / o.w : 1, sy = o.h ? h / o.h : 1;
      for (const c of o.children) setRect(c, x + (c.x - o.x) * sx, y + (c.y - o.y) * sy, c.w * sx, c.h * sy);
    } else if (o.type === 'table') {
      const sx = o.w ? w / o.w : 1, sy = o.h ? h / o.h : 1; o.cols = o.cols.map(c => c * sx); o.rows.forEach(r => r.h *= sy);
    }
    o.x = x; o.y = y; o.w = w; o.h = h;
  }
  function translate(o, dx, dy) { o.x += dx; o.y += dy; if (o.type === 'group') o.children.forEach(c => translate(c, dx, dy)); }
  function cloneObj(o) { const c = JSON.parse(JSON.stringify(o)); walk([c], x => { x.id = uid(); }); return c; }
  function usedAssets(doc) {
    const s = new Set(); const add = objs => walk(objs, o => { if (o.type === 'image' && o.asset) s.add(o.asset); if (o.fill && o.fill.img) s.add(o.fill.img); });
    const bg = b => { if (b && b.img) s.add(b.img); };
    add(doc.master.objects); bg(doc.master.bg); doc.layouts.forEach(l => { add(l.objects); bg(l.bg); }); doc.slides.forEach(sl => { add(sl.objects); bg(sl.bg); });
    return s;
  }

  /* ---------------- validation of untrusted documents ---------------- */
  const str = (v, max = 100000) => typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max);
  const okColor = c => typeof c === 'string' && (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(c) || /^(dk1|lt1|dk2|lt2|accent[1-6]|hlink|folHlink|tx1|tx2|bg1|bg2)(:[-+]?\d{1,3}(\.\d+)?)?$/.test(c)) ? c : null;
  const okFont = f => typeof f === 'string' && f.length < 80 ? f.replace(/[<>"';{}\\]/g, '') : undefined;
  function cleanFill(f) {
    if (!f || typeof f !== 'object') return null;
    if (Array.isArray(f.grad)) { const g = f.grad.slice(0, 10).map(s => [clamp(num(s && s[0], 0), 0, 1), okColor(s && s[1]) || '#000000']); return g.length >= 2 ? { grad: g, ang: num(f.ang, 90, -360, 360), alpha: f.alpha != null ? clamp(num(f.alpha, 1), 0, 1) : undefined } : null; }
    if (typeof f.img === 'string') return { img: str(f.img, 64) };
    const c = okColor(f.color); return c ? { color: c, alpha: f.alpha != null ? clamp(num(f.alpha, 1), 0, 1) : undefined } : null;
  }
  function cleanLine(l) { if (!l || typeof l !== 'object') return null; const c = okColor(l.color); if (!c) return null; return { color: c, w: num(l.w, 1, 0, 200), dash: ['solid', 'dash', 'dot', 'dashDot', 'lgDash'].includes(l.dash) ? l.dash : undefined, head: l.head === 'arrow' ? 'arrow' : undefined, tail: l.tail === 'arrow' ? 'arrow' : undefined, alpha: l.alpha != null ? clamp(num(l.alpha, 1), 0, 1) : undefined }; }
  function cleanRun(r) {
    const o = { t: str(r && r.t, 20000) };
    if (r.b != null) o.b = !!r.b; if (r.i != null) o.i = !!r.i; if (r.u != null) o.u = !!r.u; if (r.s != null) o.s = !!r.s;
    if (r.size != null) o.size = num(r.size, 18, 1, 4000); if (r.color) o.color = okColor(r.color) || undefined; if (r.font) o.font = okFont(r.font);
    if (r.fld === 'slidenum' || r.fld === 'date') o.fld = r.fld; if (r.br) o.br = true; if (r.sup != null) o.sup = num(r.sup, 0, -100, 100);
    return o;
  }
  function cleanDef(d) {
    if (!d || typeof d !== 'object') return undefined; const o = {};
    if (d.size != null) o.size = num(d.size, 18, 1, 4000); if (d.color) o.color = okColor(d.color) || undefined; if (d.font) o.font = okFont(d.font);
    if (d.b != null) o.b = !!d.b; if (d.i != null) o.i = !!d.i; if (['l', 'c', 'r', 'j'].includes(d.align)) o.align = d.align; if (['t', 'ctr', 'b'].includes(d.anchor)) o.anchor = d.anchor;
    if (d.bullet != null) o.bullet = cleanBullet(d.bullet); if (d.lnSp != null) o.lnSp = num(d.lnSp, 1, 0.3, 5);
    return o;
  }
  function cleanBullet(b) { if (b === 'none') return 'none'; if (typeof b === 'string') return b.slice(0, 2) || 'none'; if (b && typeof b === 'object' && NUMFMT.includes(b.num)) return { num: b.num, start: num(b.start, 1, 1, 9999) }; return undefined; }
  function cleanText(tb) {
    if (!tb || typeof tb !== 'object' || !Array.isArray(tb.paras)) return undefined;
    const o = { paras: tb.paras.slice(0, 2000).map(p => {
      const q = { runs: Array.isArray(p && p.runs) ? p.runs.slice(0, 2000).map(cleanRun) : [] };
      if (['l', 'c', 'r', 'j'].includes(p.align)) q.align = p.align; if (p.lvl) q.lvl = clamp(num(p.lvl, 0) | 0, 0, 8);
      if (p.bullet != null) q.bullet = cleanBullet(p.bullet); if (p.lnSp != null) q.lnSp = num(p.lnSp, 1, 0.3, 5);
      if (p.spB != null) q.spB = num(p.spB, 0, 0, 500); if (p.spA != null) q.spA = num(p.spA, 0, 0, 500);
      if (p.marL != null) q.marL = num(p.marL, 0, 0, 2000); if (p.indent != null) q.indent = num(p.indent, 0, -2000, 2000);
      if (p.endSize != null) q.endSize = num(p.endSize, 18, 1, 4000);
      return q;
    }) };
    if (!o.paras.length) o.paras.push({ runs: [] });
    if (['t', 'ctr', 'b'].includes(tb.anchor)) o.anchor = tb.anchor; if (['none', 'shrink', 'grow'].includes(tb.autofit)) o.autofit = tb.autofit;
    if (tb.scale != null) o.scale = num(tb.scale, 1, 0.1, 1);
    if (Array.isArray(tb.ins)) o.ins = tb.ins.slice(0, 4).map(v => num(v, 7, 0, 500)); if (tb.wrap === false) o.wrap = false;
    if (tb.vert === 'vert' || tb.vert === 'vert270') o.vert = tb.vert;
    const d = cleanDef(tb.def); if (d) o.def = d;
    return o;
  }
  const ANIM_FX = ['appear', 'fade', 'fly', 'zoom', 'wipe', 'float', 'split', 'pulse', 'spin', 'grow', 'teeter'];
  function cleanObj(o, depth = 0) {
    if (!o || typeof o !== 'object' || depth > 20) return null;
    const type = ['shape', 'image', 'table', 'chart', 'group'].includes(o.type) ? o.type : null; if (!type) return null;
    const c = { id: str(o.id, 40) || uid(), type, name: o.name ? str(o.name, 200) : undefined, x: num(o.x, 0), y: num(o.y, 0), w: num(o.w, 100, 0, 1e6), h: num(o.h, 100, 0, 1e6), rot: num(o.rot, 0, -3600, 3600) };
    if (o.flipH) c.flipH = true; if (o.flipV) c.flipV = true; if (o.ownGeo) c.ownGeo = true; if (o.hidden) c.hidden = true; if (o.locked) c.locked = true;
    if (o.ph && typeof o.ph === 'object') c.ph = { type: /^[a-zA-Z]{2,12}$/.test(o.ph.type) ? o.ph.type : 'body', idx: clamp(num(o.ph.idx, 0) | 0, 0, 99999) };
    if (o.shadow) c.shadow = true;
    if (o.alpha != null) c.alpha = clamp(num(o.alpha, 1), 0, 1);
    c.fill = cleanFill(o.fill); c.line = cleanLine(o.line);
    if (type === 'shape') {
      c.geom = /^[a-zA-Z0-9]{2,40}$/.test(o.geom) ? o.geom : 'rect'; if (o.tb) c.tb = true;
      if (o.adj != null && Number.isFinite(+o.adj)) c.adj = num(o.adj, 0, -1e6, 1e6);
      if (c.geom === 'cust' && Array.isArray(o.path)) c.path = o.path.slice(0, 50).map(sp => ({ w: num(sp.w, 1, 0, 1e9), h: num(sp.h, 1, 0, 1e9), fill: sp.fill !== false, stroke: sp.stroke !== false, cmds: Array.isArray(sp.cmds) ? sp.cmds.slice(0, 20000).map(k => [['M', 'L', 'C', 'Q', 'Z'].includes(k[0]) ? k[0] : 'Z', ...k.slice(1, 7).map(v => num(v, 0))]) : [] }));
      const t = cleanText(o.text); if (t) c.text = t;
    } else if (type === 'image') {
      c.asset = str(o.asset, 64);
      if (o.crop) c.crop = { l: clamp(num(o.crop.l, 0), -5, 1), t: clamp(num(o.crop.t, 0), -5, 1), r: clamp(num(o.crop.r, 0), -5, 1), b: clamp(num(o.crop.b, 0), -5, 1) };
      if (o.geom && /^[a-zA-Z0-9]{2,40}$/.test(o.geom)) c.geom = o.geom;
    } else if (type === 'table') {
      c.cols = (Array.isArray(o.cols) ? o.cols : [100]).slice(0, 100).map(v => num(v, 100, 1, 1e5));
      c.rows = (Array.isArray(o.rows) ? o.rows : []).slice(0, 500).map(r => ({ h: num(r && r.h, 40, 1, 1e5), cells: c.cols.map((_, i) => { const cell = r && Array.isArray(r.cells) ? r.cells[i] : null; const out = { text: cleanText(cell && cell.text) || textBody([para('')]) }; if (cell && cell.fill) out.fill = cleanFill(cell.fill); if (cell && cell.b != null) out.b = !!cell.b; return out; }) }));
      if (!c.rows.length) c.rows.push({ h: 40, cells: c.cols.map(() => ({ text: textBody([para('')]) })) });
      const s = o.style || {}; c.style = { first: s.first !== false, band: s.band !== false, color: okColor(s.color) || 'accent1', none: !!s.none };
      c.w = c.cols.reduce((a, b) => a + b, 0); c.h = c.rows.reduce((a, r) => a + r.h, 0);
    } else if (type === 'chart') {
      c.kind = ['col', 'bar', 'line', 'pie', 'area', 'doughnut', 'stacked'].includes(o.kind) ? o.kind : 'col';
      c.title = str(o.title, 300); c.legend = o.legend !== false; c.labels = !!o.labels;
      c.cats = (Array.isArray(o.cats) ? o.cats : []).slice(0, 200).map(v => str(v, 100));
      c.series = (Array.isArray(o.series) ? o.series : []).slice(0, 30).map(s => ({ name: str(s && s.name, 100), vals: c.cats.map((_, i) => num(s && s.vals && s.vals[i], 0, -1e15, 1e15)), color: okColor(s && s.color) || undefined }));
    } else if (type === 'group') {
      c.children = (Array.isArray(o.children) ? o.children : []).map(k => cleanObj(k, depth + 1)).filter(Boolean);
      if (!c.children.length) return null;
    }
    return c;
  }
  function cleanBg(b) {
    if (!b || typeof b !== 'object') return null;
    if (typeof b.img === 'string') return { img: str(b.img, 64) };
    if (Array.isArray(b.grad)) return cleanFill(b);
    const c = okColor(b.color); return c ? { color: c } : null;
  }
  const TRANS = ['none', 'fade', 'push', 'wipe', 'cover', 'uncover', 'zoom', 'split', 'flash'];
  function cleanSlide(s) {
    const o = { id: str(s && s.id, 40) || uid(), layout: s && s.layout ? str(s.layout, 40) : null, bg: cleanBg(s && s.bg), objects: (Array.isArray(s && s.objects) ? s.objects : []).map(x => cleanObj(x)).filter(Boolean), notes: str(s && s.notes, 200000), hidden: !!(s && s.hidden) };
    const t = (s && s.transition) || {}; o.transition = { type: TRANS.includes(t.type) ? t.type : 'none', dur: num(t.dur, 0.7, 0.05, 30), dir: ['l', 'r', 'u', 'd', 'in', 'out', 'h', 'v'].includes(t.dir) ? t.dir : undefined, after: t.after != null ? num(t.after, 0, 0, 86400) : undefined, noClick: !!t.noClick || undefined };
    const ids = new Set(); walk(o.objects, x => ids.add(x.id));
    o.anims = (Array.isArray(s && s.anims) ? s.anims : []).slice(0, 500).map(a => ({ id: str(a.id, 40) || uid(), target: str(a.target, 40), cls: ['entr', 'exit', 'emph'].includes(a.cls) ? a.cls : 'entr', fx: ANIM_FX.includes(a.fx) ? a.fx : 'fade', dir: ['l', 'r', 't', 'b'].includes(a.dir) ? a.dir : 'b', dur: num(a.dur, 0.5, 0.01, 60), delay: num(a.delay, 0, 0, 600), trig: ['click', 'with', 'after'].includes(a.trig) ? a.trig : 'click', byPara: !!a.byPara || undefined })).filter(a => ids.has(a.target));
    return o;
  }
  function sanitize(d) {
    if (!d || typeof d !== 'object') throw new Error('Not a Lumen Slides document');
    const W = num(d.w, 1280, 100, 20000), H = num(d.h, 720, 100, 20000);
    const th = d.theme || {}, base = makeTheme('lumen');
    const theme = { id: str(th.id, 40) || 'custom', name: str(th.name, 80) || 'Custom', colors: {}, fonts: { major: okFont(th.fonts && th.fonts.major) || base.fonts.major, minor: okFont(th.fonts && th.fonts.minor) || base.fonts.minor }, map: {} };
    for (const k of SCHEME) theme.colors[k] = (th.colors && typeof th.colors[k] === 'string' && /^#[0-9a-fA-F]{6}$/.test(th.colors[k])) ? th.colors[k].toLowerCase() : base.colors[k];
    if (th.map) for (const k of ['tx1', 'bg1', 'tx2', 'bg2']) if (SCHEME.includes(th.map[k])) theme.map[k] = th.map[k];
    const m = d.master || {}, ds = defaultStyles(), ms = m.styles || {};
    const sty = (s, def) => { const o = { ...def }; if (!s) return o; const cd = cleanDef(s) || {}; Object.assign(o, cd); if (s.spB != null) o.spB = num(s.spB, 0, 0, 500); if (Array.isArray(s.lv)) o.lv = s.lv.slice(0, 9).map((l, i) => ({ size: num(l && l.size, 18, 1, 4000), bullet: cleanBullet(l && l.bullet) || 'none' })); return o; };
    const master = { bg: cleanBg(m.bg) || { color: 'bg1' }, objects: (Array.isArray(m.objects) ? m.objects : []).map(x => cleanObj(x)).filter(Boolean), styles: { title: sty(ms.title, ds.title), body: sty(ms.body, ds.body), other: sty(ms.other, ds.other) }, ph: (Array.isArray(m.ph) ? m.ph : []).map(x => cleanObj(x)).filter(x => x && x.ph) };
    if (!master.ph.length) master.ph = defaultMaster(W, H).ph;
    const layouts = (Array.isArray(d.layouts) ? d.layouts : []).slice(0, 200).map(l => ({ id: str(l && l.id, 40) || uid(), name: str(l && l.name, 100) || 'Layout', kind: str(l && l.kind, 20) || 'obj', bg: cleanBg(l && l.bg), hideMaster: !!(l && l.hideMaster), objects: (Array.isArray(l && l.objects) ? l.objects : []).map(x => cleanObj(x)).filter(Boolean) }));
    if (!layouts.length) layouts.push(...defaultLayouts(W));
    const slides = (Array.isArray(d.slides) ? d.slides : []).slice(0, 5000).map(cleanSlide);
    for (const s of slides) if (!layouts.find(l => l.id === s.layout)) s.layout = layouts[0].id;
    const f = d.footer || {};
    return { app: 'lumen-slides', version: 1, w: W, h: H, theme, master, layouts, slides, footer: { num: !!f.num, text: str(f.text, 500), date: !!f.date, skipTitle: f.skipTitle !== false } };
  }
  function sanitizeAssets(a) {
    const out = {}; if (!a || typeof a !== 'object') return out;
    for (const [k, v] of Object.entries(a)) {
      if (!/^[\w-]{1,64}$/.test(k) || !v || typeof v.data !== 'string') continue;
      const m = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml|bmp));base64,/.exec(v.data);
      if (!m || /[^A-Za-z0-9+/=]/.test(v.data.slice(m[0].length))) continue;
      out[k] = { mime: m[1], data: v.data, w: num(v.w, 0, 0, 1e5), h: num(v.h, 0, 0, 1e5), name: str(v.name, 200) };
    }
    return out;
  }

  const Model = { uid, clamp, color, isScheme, font, modify, lum, hex2rgb, rgb2hex, rgb2hsl, hsl2rgb, SCHEME, PALETTES, FONT_PAIRS, THEMES, makeTheme, themeDeco,
    para, textBody, plainText, defaultStyles, defaultMaster, defaultLayouts, newDoc, newSlide, applyLayout, phCat, layoutOf, layoutPh, masterPh, baseStyle, NUMFMT, numLabel,
    textBox, shape, image, table, chart, GEOMS, walk, findObj, parentList, groupBounds, aabb, setRect, translate, cloneObj, usedAssets, sanitize, sanitizeAssets, okColor, cleanObj, TRANS, ANIM_FX };
  if (typeof module !== 'undefined' && module.exports) module.exports = Model; else root.Model = Model;
})(typeof self !== 'undefined' ? self : this);
