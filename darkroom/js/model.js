'use strict';
/* Lumen Darkroom — edit settings model, built-in presets, sanitising of untrusted data */
const Model = (() => {
  const BANDS = ['Red', 'Orange', 'Yellow', 'Green', 'Aqua', 'Blue', 'Purple', 'Magenta'];
  const BAND_COLORS = ['#e8433a', '#f08a24', '#e9cf2a', '#4cbb3a', '#2bbfc0', '#3a6fe0', '#8a4ad8', '#d63fae'];
  const LABELS = { red: '#e04a3f', yellow: '#e8c22a', green: '#4bae3a', blue: '#3a7fe0', purple: '#9a52d0' };

  function defaults() {
    return {
      v: 2,
      wb: { temp: 0, tint: 0 }, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0,
      texture: 0, clarity: 0, dehaze: 0, vibrance: 0, saturation: 0, bw: false,
      curve: { rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] },
      hsl: { hue: [0, 0, 0, 0, 0, 0, 0, 0], sat: [0, 0, 0, 0, 0, 0, 0, 0], lum: [0, 0, 0, 0, 0, 0, 0, 0] },
      grade: { sh: { h: 220, s: 0, l: 0 }, mid: { h: 40, s: 0, l: 0 }, hi: { h: 45, s: 0, l: 0 }, blend: 50, bal: 0 },
      sharpen: { amount: 25, radius: 1, detail: 25, mask: 0 }, nr: { lum: 0, color: 20 },
      vignette: { amount: 0, mid: 50, round: 0, feather: 50 }, grain: { amount: 0, size: 25, rough: 50 },
      crop: { x: 0, y: 0, w: 1, h: 1, angle: 0, rot: 0, flipH: false, flipV: false, aspect: 'original' },
      lens: { dist: 0, vig: 0, vigMid: 50, caR: 0, caB: 0, fringeP: 0, fringeG: 0 },
      upright: { vert: 0, horiz: 0, rotate: 0, aspect: 0, scale: 100, x: 0, y: 0, f: 1, constrain: true },
      spots: [], masks: []
    };
  }
  /* ---------- local adjustments (masks) & spots ---------- */
  // key, label, min, max — the per-mask adjustment sliders
  const LOCAL = [['exposure', 'Exposure', -4, 4], ['contrast', 'Contrast', -100, 100], ['highlights', 'Highlights', -100, 100], ['shadows', 'Shadows', -100, 100],
    ['temp', 'Temp', -100, 100], ['tint', 'Tint', -100, 100], ['saturation', 'Saturation', -100, 100], ['clarity', 'Clarity', -100, 100],
    ['dehaze', 'Dehaze', -100, 100], ['sharpness', 'Sharpness', -100, 100], ['noise', 'Noise', 0, 100]];
  const MAX_MASKS = 32, MAX_SPOTS = 64, MAX_STROKES = 400, MAX_PTS = 3000;
  function newMask(type, n) {
    return { id: Aero.uid(), name: (type === 'linear' ? 'Linear gradient' : type === 'radial' ? 'Radial gradient' : 'Brush') + (n ? ' ' + n : ''), type, on: true, invert: false, amount: 100,
      lin: { x0: .5, y0: .25, x1: .5, y1: .6 }, rad: { cx: .5, cy: .5, rx: .25, ry: .18, angle: 0, feather: 50 }, strokes: [],
      range: { mode: 'none', lo: 0, hi: 100, smooth: 20, L: .6, a: 0, b: 0, tol: 30 },
      adj: Object.fromEntries(LOCAL.map(([k]) => [k, 0])) };
  }
  const q4 = v => Math.round(v * 1e4) / 1e4;
  const clone = o => JSON.parse(JSON.stringify(o));
  const isDefault = s => JSON.stringify(stripCrop(s)) === JSON.stringify(stripCrop(defaults())) && isCropDefault(s.crop);
  const stripCrop = s => { const c = { ...s }; delete c.crop; return c; };
  const isCropDefault = c => c.x === 0 && c.y === 0 && c.w === 1 && c.h === 1 && !c.angle && !c.rot && !c.flipH && !c.flipV;

  // settings groups — used by copy/paste/sync, presets and per-panel reset
  const GROUPS = {
    wb: { label: 'White balance', keys: ['wb'] },
    tone: { label: 'Exposure & tone', keys: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'] },
    presence: { label: 'Presence', keys: ['texture', 'clarity', 'dehaze', 'vibrance', 'saturation'] },
    treatment: { label: 'Treatment (B&W)', keys: ['bw'] },
    curve: { label: 'Tone curve', keys: ['curve'] },
    hsl: { label: 'HSL / Color', keys: ['hsl'] },
    grade: { label: 'Color grading', keys: ['grade'] },
    detail: { label: 'Detail (sharpen, noise)', keys: ['sharpen', 'nr'] },
    effects: { label: 'Effects (vignette, grain)', keys: ['vignette', 'grain'] },
    crop: { label: 'Crop & geometry', keys: ['crop'] },
    lens: { label: 'Lens corrections', keys: ['lens'] },
    transform: { label: 'Transform (upright)', keys: ['upright'] },
    spots: { label: 'Spot removal', keys: ['spots'] },
    masks: { label: 'Masks (local adjustments)', keys: ['masks'] }
  };
  function pick(s, groups) { const o = {}; groups.forEach(g => GROUPS[g].keys.forEach(k => o[k] = clone(s[k]))); return o; }
  function applyPartial(s, part) { const o = clone(s); Object.keys(part).forEach(k => { if (k in o) o[k] = clone(part[k]); }); return sanitizeSettings(o); }

  /* ---------- built-in presets ---------- */
  const D = defaults;
  const P = (name, group, fn) => { const s = D(); fn(s); return { id: 'b-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, group, builtin: true, part: pick(s, ['tone', 'presence', 'treatment', 'curve', 'hsl', 'grade', 'effects'].filter(g => g !== 'tone').concat([])), tone: { contrast: s.contrast, highlights: s.highlights, shadows: s.shadows, whites: s.whites, blacks: s.blacks } }; };
  const BUILTIN = [
    P('Natural', 'Color', s => { s.contrast = 8; s.highlights = -20; s.shadows = 18; s.whites = 6; s.blacks = -4; s.vibrance = 14; s.clarity = 6; s.curve.rgb = [[0, 0], [.25, .23], [.75, .78], [1, 1]]; }),
    P('Vivid', 'Color', s => { s.contrast = 28; s.highlights = -30; s.shadows = 22; s.whites = 12; s.blacks = -14; s.vibrance = 38; s.saturation = 10; s.clarity = 14; s.dehaze = 8; s.curve.rgb = [[0, 0], [.25, .2], [.75, .82], [1, 1]]; }),
    P('Matte film', 'Film', s => { s.contrast = -10; s.highlights = -25; s.shadows = 20; s.saturation = -12; s.vibrance = 6; s.curve.rgb = [[0, .09], [.3, .3], [.75, .76], [1, .94]]; s.grade.sh = { h: 205, s: 18, l: 0 }; s.grade.hi = { h: 42, s: 14, l: 0 }; s.grain = { amount: 18, size: 25, rough: 50 }; }),
    P('Vintage fade', 'Film', s => { s.contrast = -18; s.highlights = -15; s.shadows = 10; s.saturation = -25; s.vibrance = -5; s.curve.rgb = [[0, .12], [.5, .52], [1, .9]]; s.curve.b = [[0, .1], [1, .88]]; s.curve.r = [[0, .02], [1, 1]]; s.grade.mid = { h: 38, s: 22, l: 0 }; s.vignette = { amount: -22, mid: 45, round: 0, feather: 70 }; s.grain = { amount: 28, size: 35, rough: 60 }; s.hsl.sat[3] = -30; s.hsl.hue[3] = -20; }),
    P('Warm sunset', 'Color', s => { s.contrast = 12; s.highlights = -22; s.shadows = 12; s.vibrance = 22; s.grade.hi = { h: 38, s: 35, l: 0 }; s.grade.mid = { h: 25, s: 18, l: 0 }; s.grade.sh = { h: 280, s: 10, l: 0 }; s.hsl.sat[1] = 18; s.hsl.lum[1] = 6; s.vignette = { amount: -14, mid: 50, round: 0, feather: 60 }; }),
    P('Cool teal-orange', 'Color', s => { s.contrast = 22; s.highlights = -18; s.shadows = 10; s.vibrance = 18; s.hsl.hue[4] = -15; s.hsl.hue[5] = -22; s.hsl.sat[5] = -10; s.hsl.hue[1] = -6; s.hsl.sat[1] = 15; s.hsl.hue[3] = 40; s.hsl.sat[3] = -35; s.grade.sh = { h: 190, s: 40, l: -4 }; s.grade.hi = { h: 32, s: 32, l: 0 }; s.grade.bal = -10; }),
    P('B&W classic', 'Black & white', s => { s.bw = true; s.contrast = 18; s.highlights = -15; s.shadows = 12; s.clarity = 12; s.hsl.lum[5] = -20; s.hsl.lum[1] = 12; s.curve.rgb = [[0, 0], [.25, .22], [.75, .79], [1, 1]]; }),
    P('B&W high contrast', 'Black & white', s => { s.bw = true; s.contrast = 55; s.highlights = -10; s.shadows = -12; s.whites = 22; s.blacks = -30; s.clarity = 30; s.texture = 15; s.hsl.lum[5] = -45; s.hsl.lum[4] = -25; s.hsl.lum[2] = 20; s.vignette = { amount: -25, mid: 45, round: 0, feather: 55 }; s.grain = { amount: 15, size: 20, rough: 60 }; }),
    P('B&W selenium', 'Black & white', s => { s.bw = true; s.contrast = 24; s.shadows = 8; s.grade.sh = { h: 285, s: 22, l: 0 }; s.grade.hi = { h: 45, s: 10, l: 0 }; s.curve.rgb = [[0, .03], [.5, .5], [1, .98]]; }),
    P('Soft pastel', 'Color', s => { s.contrast = -20; s.highlights = -30; s.shadows = 30; s.whites = 10; s.saturation = -10; s.vibrance = 10; s.clarity = -12; s.dehaze = -8; s.grade.hi = { h: 330, s: 12, l: 0 }; s.curve.rgb = [[0, .06], [.5, .55], [1, 1]]; }),
    P('Moody', 'Film', s => { s.contrast = 15; s.highlights = -40; s.shadows = -10; s.blacks = -10; s.saturation = -20; s.clarity = 10; s.dehaze = 10; s.grade.sh = { h: 200, s: 25, l: -5 }; s.grade.mid = { h: 180, s: 8, l: 0 }; s.vignette = { amount: -30, mid: 40, round: 0, feather: 60 }; s.hsl.sat[3] = -40; s.hsl.lum[3] = -20; }),
    P('Punchy landscape', 'Color', s => { s.contrast = 20; s.highlights = -45; s.shadows = 35; s.whites = 15; s.blacks = -15; s.clarity = 22; s.dehaze = 18; s.vibrance = 30; s.hsl.sat[5] = 12; s.hsl.lum[5] = -12; s.hsl.sat[3] = 10; })
  ];
  // the settings a built-in preset applies (groups it owns are reset first)
  function presetApply(s, preset) {
    let o = clone(s);
    if (preset.builtin) {
      ['tone', 'presence', 'treatment', 'curve', 'hsl', 'grade', 'effects'].forEach(g => GROUPS[g].keys.forEach(k => { if (k !== 'exposure') o[k] = clone(D()[k]); }));
      Object.assign(o, clone(preset.part)); Object.assign(o, clone(preset.tone));
    } else {
      (preset.groups || []).forEach(g => GROUPS[g]?.keys.forEach(k => o[k] = clone(D()[k])));
      Object.keys(preset.part || {}).forEach(k => { if (k in o) o[k] = clone(preset.part[k]); });
    }
    return sanitizeSettings(o);
  }

  /* ---------- sanitising (everything from files / IndexedDB goes through this) ---------- */
  const num = (v, lo, hi, d) => { v = +v; return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const pts = (a, d) => Array.isArray(a) && a.length >= 2 && a.length <= 16 ? a.map(p => [num(p?.[0], 0, 1, 0), num(p?.[1], 0, 1, 0)]).sort((x, y) => x[0] - y[0]) : clone(d);
  const arr8 = a => Array.from({ length: 8 }, (_, i) => num(a?.[i], -100, 100, 0));
  function sanitizeSettings(s) {
    const d = defaults(); s = s && typeof s === 'object' ? s : {};
    const r = d;
    r.wb = { temp: num(s.wb?.temp, -100, 100, 0), tint: num(s.wb?.tint, -100, 100, 0) };
    r.exposure = num(s.exposure, -5, 5, 0);
    ['contrast', 'highlights', 'shadows', 'whites', 'blacks', 'texture', 'clarity', 'dehaze', 'vibrance', 'saturation'].forEach(k => r[k] = num(s[k], -100, 100, 0));
    r.bw = !!s.bw;
    ['rgb', 'r', 'g', 'b'].forEach(k => r.curve[k] = pts(s.curve?.[k], d.curve[k]));
    r.hsl = { hue: arr8(s.hsl?.hue), sat: arr8(s.hsl?.sat), lum: arr8(s.hsl?.lum) };
    ['sh', 'mid', 'hi'].forEach(k => r.grade[k] = { h: num(s.grade?.[k]?.h, 0, 360, d.grade[k].h), s: num(s.grade?.[k]?.s, 0, 100, 0), l: num(s.grade?.[k]?.l, -100, 100, 0) });
    r.grade.blend = num(s.grade?.blend, 0, 100, 50); r.grade.bal = num(s.grade?.bal, -100, 100, 0);
    r.sharpen = { amount: num(s.sharpen?.amount, 0, 150, 25), radius: num(s.sharpen?.radius, .5, 3, 1), detail: num(s.sharpen?.detail, 0, 100, 25), mask: num(s.sharpen?.mask, 0, 100, 0) };
    r.nr = { lum: num(s.nr?.lum, 0, 100, 0), color: num(s.nr?.color, 0, 100, 20) };
    r.vignette = { amount: num(s.vignette?.amount, -100, 100, 0), mid: num(s.vignette?.mid, 0, 100, 50), round: num(s.vignette?.round, -100, 100, 0), feather: num(s.vignette?.feather, 0, 100, 50) };
    r.grain = { amount: num(s.grain?.amount, 0, 100, 0), size: num(s.grain?.size, 0, 100, 25), rough: num(s.grain?.rough, 0, 100, 50) };
    const c = s.crop || {};
    r.crop = { x: num(c.x, 0, 1, 0), y: num(c.y, 0, 1, 0), w: num(c.w, .01, 1, 1), h: num(c.h, .01, 1, 1), angle: num(c.angle, -45, 45, 0), rot: Math.round(num(c.rot, 0, 3, 0)), flipH: !!c.flipH, flipV: !!c.flipV, aspect: typeof c.aspect === 'string' ? c.aspect.slice(0, 12) : 'original' };
    if (r.crop.x + r.crop.w > 1) r.crop.x = 1 - r.crop.w; if (r.crop.y + r.crop.h > 1) r.crop.y = 1 - r.crop.h;
    const L = s.lens || {};
    r.lens = { dist: num(L.dist, -100, 100, 0), vig: num(L.vig, -100, 100, 0), vigMid: num(L.vigMid, 0, 100, 50), caR: num(L.caR, -100, 100, 0), caB: num(L.caB, -100, 100, 0), fringeP: num(L.fringeP, 0, 20, 0), fringeG: num(L.fringeG, 0, 20, 0) };
    const U = s.upright || {};
    r.upright = { vert: num(U.vert, -100, 100, 0), horiz: num(U.horiz, -100, 100, 0), rotate: num(U.rotate, -10, 10, 0), aspect: num(U.aspect, -100, 100, 0), scale: num(U.scale, 50, 150, 100), x: num(U.x, -100, 100, 0), y: num(U.y, -100, 100, 0), f: num(U.f, .3, 4, 1), constrain: U.constrain !== false };
    r.spots = Array.isArray(s.spots) ? s.spots.slice(0, MAX_SPOTS).map(sanitizeSpot).filter(Boolean) : [];
    r.masks = Array.isArray(s.masks) ? s.masks.slice(0, MAX_MASKS).map(sanitizeMask).filter(Boolean) : [];
    return r;
  }
  const sid = v => typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : Aero.uid();
  function sanitizeSpot(o) {
    if (!o || typeof o !== 'object') return null;
    return { id: sid(o.id), mode: o.mode === 'clone' ? 'clone' : 'heal', x: q4(num(o.x, 0, 1, .5)), y: q4(num(o.y, 0, 1, .5)), sx: q4(num(o.sx, -1, 2, .6)), sy: q4(num(o.sy, -1, 2, .5)),
      r: num(o.r, .002, .25, .02), feather: num(o.feather, 0, 100, 50), opacity: num(o.opacity, 0, 100, 100),
      ...(Array.isArray(o.pts) && o.pts.length > 1 ? { pts: o.pts.slice(0, 300).map(p => [q4(num(p?.[0], -1, 2, 0)), q4(num(p?.[1], -1, 2, 0))]) } : {}) };
  }
  function sanitizeStroke(o) {
    if (!o || typeof o !== 'object' || !Array.isArray(o.pts) || !o.pts.length) return null;
    return { id: sid(o.id), erase: !!o.erase, size: num(o.size, .001, .3, .03), feather: num(o.feather, 0, 100, 50), flow: num(o.flow, 1, 100, 100), auto: !!o.auto,
      pts: o.pts.slice(0, MAX_PTS).map(p => [q4(num(p?.[0], -1, 2, 0)), q4(num(p?.[1], -1, 2, 0))]) };
  }
  function sanitizeMask(o) {
    if (!o || typeof o !== 'object') return null;
    const type = ['linear', 'radial', 'brush'].includes(o.type) ? o.type : null; if (!type) return null;
    const d = newMask(type), li = o.lin || {}, ra = o.rad || {}, rg = o.range || {}, a = o.adj || {};
    d.id = sid(o.id); d.name = str(o.name, 60) || d.name; d.on = o.on !== false; d.invert = !!o.invert; d.amount = num(o.amount, 0, 100, 100);
    d.lin = { x0: num(li.x0, -2, 3, .5), y0: num(li.y0, -2, 3, .25), x1: num(li.x1, -2, 3, .5), y1: num(li.y1, -2, 3, .6) };
    d.rad = { cx: num(ra.cx, -2, 3, .5), cy: num(ra.cy, -2, 3, .5), rx: num(ra.rx, .002, 3, .25), ry: num(ra.ry, .002, 3, .18), angle: num(ra.angle, -360, 360, 0), feather: num(ra.feather, 0, 100, 50) };
    d.strokes = Array.isArray(o.strokes) ? o.strokes.slice(0, MAX_STROKES).map(sanitizeStroke).filter(Boolean) : [];
    d.range = { mode: ['none', 'lum', 'color'].includes(rg.mode) ? rg.mode : 'none', lo: num(rg.lo, 0, 100, 0), hi: num(rg.hi, 0, 100, 100), smooth: num(rg.smooth, 0, 100, 20),
      L: num(rg.L, 0, 1, .6), a: num(rg.a, -.5, .5, 0), b: num(rg.b, -.5, .5, 0), tol: num(rg.tol, 0, 100, 30) };
    LOCAL.forEach(([k, , lo, hi]) => d.adj[k] = num(a[k], lo, hi, 0));
    return d;
  }
  const str = (v, n = 300) => typeof v === 'string' ? v.slice(0, n) : '';
  function sanitizeExif(e) {
    e = e && typeof e === 'object' ? e : {};
    return { make: str(e.make, 80), model: str(e.model, 80), lens: str(e.lens, 120), iso: num(e.iso, 0, 1e7, 0) || null, shutter: num(e.shutter, 0, 1e5, 0) || null,
      aperture: num(e.aperture, 0, 1000, 0) || null, focal: num(e.focal, 0, 1e5, 0) || null, date: num(e.date, 0, 1e14, 0) || null };
  }
  function sanitizePhoto(p) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string') return null;
    const flag = num(p.flag, -1, 1, 0);
    const o = {
      id: str(p.id, 40), fileId: str(p.fileId || p.id, 40), name: str(p.name, 260) || 'Untitled', ext: str(p.ext, 10).toLowerCase(), mime: str(p.mime, 60), size: num(p.size, 0, 1e12, 0),
      w: Math.round(num(p.w, 1, 1e6, 1)), h: Math.round(num(p.h, 1, 1e6, 1)), raw: !!p.raw, added: num(p.added, 0, 1e14, Date.now()), seq: num(p.seq, 0, 1e9, 0),
      importId: str(p.importId, 40), rating: Math.round(num(p.rating, 0, 5, 0)), flag: Math.round(flag), label: typeof p.label === 'string' && Object.hasOwn(LABELS, p.label) ? p.label : '',
      keywords: Array.isArray(p.keywords) ? [...new Set(p.keywords.map(k => str(k, 60).trim()).filter(Boolean))].slice(0, 100) : [],
      exif: sanitizeExif(p.exif), copyName: str(p.copyName, 60), settings: sanitizeSettings(p.settings), edited: num(p.edited, 0, 1e14, 0),
      history: [], hi: 0
    };
    if (Array.isArray(p.history)) o.history = p.history.slice(-100).map(h => ({ label: str(h?.label, 80) || 'Edit', s: sanitizeSettings(h?.s), t: num(h?.t, 0, 1e14, 0) }));
    if (!o.history.length) o.history = [{ label: 'Import', s: clone(o.settings), t: o.added }];
    o.hi = Math.round(num(p.hi, 0, o.history.length - 1, o.history.length - 1));
    return o;
  }
  function sanitizePreset(p) {
    if (!p || typeof p !== 'object') return null;
    const groups = Array.isArray(p.groups) ? p.groups.filter(g => typeof g === 'string' && Object.hasOwn(GROUPS, g)) : [];
    const part = {}; const full = sanitizeSettings(p.part || {});
    groups.forEach(g => GROUPS[g].keys.forEach(k => part[k] = full[k]));
    return { id: str(p.id, 40) || Aero.uid(), name: str(p.name, 80) || 'Preset', group: 'User', groups, part };
  }
  // smart collection rules: field → allowed operators (values are validated per field type)
  const SMART = {
    rating: { label: 'Rating', ops: ['>=', '<=', '='], type: 'num', min: 0, max: 5 },
    flag: { label: 'Flag', ops: ['is', 'is not'], type: 'enum', values: [['pick', 'Picked'], ['none', 'Unflagged'], ['reject', 'Rejected']] },
    label: { label: 'Color label', ops: ['is', 'is not'], type: 'enum', values: [['red', 'Red'], ['yellow', 'Yellow'], ['green', 'Green'], ['blue', 'Blue'], ['purple', 'Purple'], ['', 'None']] },
    keyword: { label: 'Keyword', ops: ['contains', 'is', 'does not contain'], type: 'text' },
    text: { label: 'Any text', ops: ['contains', 'does not contain'], type: 'text' },
    camera: { label: 'Camera', ops: ['contains', 'does not contain'], type: 'text' },
    lens: { label: 'Lens', ops: ['contains', 'does not contain'], type: 'text' },
    iso: { label: 'ISO', ops: ['>=', '<='], type: 'num', min: 0, max: 1e7 },
    focal: { label: 'Focal length (mm)', ops: ['>=', '<='], type: 'num', min: 0, max: 1e5 },
    aperture: { label: 'Aperture (ƒ)', ops: ['>=', '<='], type: 'num', min: 0, max: 1000 },
    date: { label: 'Capture date', ops: ['is after', 'is before', 'in the last (days)'], type: 'date' },
    edited: { label: 'Edited', ops: ['is'], type: 'enum', values: [['yes', 'Yes'], ['no', 'No']] },
    local: { label: 'Has masks or spots', ops: ['is'], type: 'enum', values: [['yes', 'Yes'], ['no', 'No']] },
    filetype: { label: 'File type', ops: ['is', 'is not'], type: 'enum', values: [['raw', 'Camera RAW'], ['jpeg', 'JPEG'], ['png', 'PNG'], ['other', 'Other']] },
    copy: { label: 'Virtual copy', ops: ['is'], type: 'enum', values: [['yes', 'Yes'], ['no', 'No']] }
  };
  function sanitizeRule(r) {
    if (!r || typeof r !== 'object' || typeof r.f !== 'string' || !Object.hasOwn(SMART, r.f)) return null;
    const d = SMART[r.f], op = d.ops.includes(r.op) ? r.op : d.ops[0];
    let v = r.v;
    if (d.type === 'num' || (d.type === 'date' && op === 'in the last (days)')) v = num(v, 0, d.max ?? 1e5, 0);
    else if (d.type === 'enum') v = d.values.some(x => x[0] === v) ? v : d.values[0][0];
    else if (d.type === 'date') v = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '2000-01-01';
    else v = str(v, 80);
    return { f: r.f, op, v };
  }
  function sanitizeCollection(c) {
    if (!c || typeof c !== 'object') return null;
    const o = { id: str(c.id, 40) || Aero.uid(), name: str(c.name, 80) || 'Collection', ids: Array.isArray(c.ids) ? [...new Set(c.ids.filter(x => typeof x === 'string').map(x => x.slice(0, 40)))] : [], created: num(c.created, 0, 1e14, Date.now()) };
    if (c.smart && typeof c.smart === 'object') { o.ids = []; o.smart = { match: c.smart.match === 'any' ? 'any' : 'all', rules: (Array.isArray(c.smart.rules) ? c.smart.rules : []).slice(0, 20).map(sanitizeRule).filter(Boolean) }; }
    return o;
  }

  // a human label for what changed between two settings objects (history entries)
  const NAMES = { exposure: 'Exposure', contrast: 'Contrast', highlights: 'Highlights', shadows: 'Shadows', whites: 'Whites', blacks: 'Blacks', texture: 'Texture', clarity: 'Clarity', dehaze: 'Dehaze', vibrance: 'Vibrance', saturation: 'Saturation', bw: 'Treatment', wb: 'White balance', curve: 'Tone curve', hsl: 'Color mixer', grade: 'Color grading', sharpen: 'Sharpening', nr: 'Noise reduction', vignette: 'Vignette', grain: 'Grain', crop: 'Crop', lens: 'Lens corrections', upright: 'Transform', spots: 'Spot removal', masks: 'Masks' };
  function diffLabel(a, b) {
    const ch = Object.keys(NAMES).filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    if (!ch.length) return null;
    if (ch.length > 2) return 'Multiple settings';
    return ch.map(k => { const v = b[k]; return typeof v === 'number' ? `${NAMES[k]} ${v > 0 ? '+' : ''}${k === 'exposure' ? v.toFixed(2) : Math.round(v)}` : NAMES[k]; }).join(', ');
  }

  return { SMART, LOCAL, MAX_MASKS, MAX_SPOTS, newMask, sanitizeMask, sanitizeSpot, BANDS, BAND_COLORS, LABELS, GROUPS, BUILTIN, defaults, clone, isDefault, isCropDefault, pick, applyPartial, presetApply, sanitizeSettings, sanitizePhoto, sanitizePreset, sanitizeCollection, sanitizeExif, diffLabel };
})();
