'use strict';
/* Lumen Layout — color management.
   Color references stored in the document (all plain strings, validated on load):
     '#rrggbb'            RGB
     'cmyk(c,m,y,k)'      unnamed process CMYK, each 0–100
     '@<swatchId>'        swatch reference, '@<swatchId>/<tint>' with tint 0–100
   Swatch: { id, name, model: 'cmyk' | 'rgb', v: [c,m,y,k] (0–100) | [r,g,b] (0–255), spot: bool }
   Spot swatches are named inks (e.g. "PANTONE 185 C" style names, user-defined) whose `v` is the
   alternate CMYK recipe used for screen preview and the PDF Separation tint transform.
   Screen preview of CMYK uses a multiplicative ink-on-paper model, which gives far more realistic
   colors than the naive 1-c formula. Separation preview renders one plate at a time as ink coverage. */
(function () {
  // full-coverage ink colors on coated paper (sRGB 0–1)
  const INK = { C: [0, 0.682, 0.937], M: [0.925, 0, 0.549], Y: [1, 0.949, 0], K: [0.137, 0.122, 0.125] };
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const hex2 = v => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  const toHex = rgb => '#' + rgb.map(hex2).join('');

  function cmykToRgb(c, m, y, k) {   // inputs 0–1 → rgb 0–1
    const out = [1, 1, 1], amt = [c, m, y, k], keys = ['C', 'M', 'Y', 'K'];
    for (let i = 0; i < 4; i++) { const a = clamp01(amt[i]); if (!a) continue; const ink = INK[keys[i]]; for (let ch = 0; ch < 3; ch++) out[ch] *= 1 - a * (1 - ink[ch]); }
    return out;
  }
  // naive GCR conversion used for "convert to CMYK" and for separating RGB content
  function rgbToCmyk(r, g, b) {   // 0–1
    const k = 1 - Math.max(r, g, b);
    if (k >= 1 - 1e-6) return [0, 0, 0, 1];
    return [(1 - r - k) / (1 - k), (1 - g - k) / (1 - k), (1 - b - k) / (1 - k), k];
  }
  function parseHex(s) {
    let m = /^#([0-9a-f]{3})$/i.exec(s); if (m) s = '#' + m[1].split('').map(x => x + x).join('');
    m = /^#([0-9a-f]{6})$/i.exec(s); if (!m) return null;
    const n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  }

  let doc = null, cache = new Map(), plate = null;
  function use(d) { if (d !== doc) { doc = d; cache = new Map(); } }
  function invalidate() { cache = new Map(); }
  function swatch(id, d = doc) { return d && Array.isArray(d.swatches) ? d.swatches.find(s => s && s.id === id) || null : null; }
  function swatchColor(sw) {
    if (sw.model === 'rgb') { const v = sw.v.map(x => clamp01(x / 255)); return { rgb: v, cmyk: rgbToCmyk(...v), rgbNative: true }; }
    const v = sw.v.map(x => clamp01(x / 100)); return { rgb: cmykToRgb(...v), cmyk: v, rgbNative: false };
  }

  /* parse a reference into a resolved color:
     {kind:'rgb'|'cmyk'|'spot'|'none', rgb:[0-1], cmyk:[0-1 ×4] (process equivalent incl. tint),
      spot: {name, cmyk(full strength 0-1)} | null, tint: 0-1, sw} */
  function parse(ref) {
    if (ref == null || ref === '' || ref === 'none') return { kind: 'none' };
    let r = cache.get(ref); if (r) return r;
    r = parseRaw(String(ref));
    cache.set(ref, r); return r;
  }
  function parseRaw(ref) {
    if (ref[0] === '#') { const rgb = parseHex(ref) || [0, 0, 0]; return { kind: 'rgb', rgb, cmyk: rgbToCmyk(...rgb), tint: 1, spot: null }; }
    let m = /^cmyk\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(ref);
    if (m) { const v = [m[1], m[2], m[3], m[4]].map(x => clamp01(+x / 100)); return { kind: 'cmyk', rgb: cmykToRgb(...v), cmyk: v, tint: 1, spot: null }; }
    m = /^@([\w-]+)(?:\/([\d.]+))?$/.exec(ref);
    if (m) {
      const sw = swatch(m[1]); const t = m[2] != null ? clamp01(+m[2] / 100) : 1;
      if (!sw) return { kind: 'rgb', rgb: [0, 0, 0], cmyk: [0, 0, 0, 1], tint: 1, spot: null, missing: m[1] };
      const base = swatchColor(sw);
      const tinted = base.rgb.map(v => 1 - t * (1 - v));
      if (sw.spot) return { kind: 'spot', rgb: tinted, cmyk: base.cmyk.map(v => v * t), tint: t, spot: { name: sw.name, cmyk: base.cmyk }, sw };
      if (sw.model === 'rgb') return { kind: 'rgb', rgb: tinted, cmyk: rgbToCmyk(...tinted), tint: t, spot: null, sw };
      return { kind: 'cmyk', rgb: tinted, cmyk: base.cmyk.map(v => v * t), tint: t, spot: null, sw };
    }
    m = /rgba?\(([^)]+)\)/.exec(ref);
    if (m) { const p = m[1].split(',').map(parseFloat); const rgb = [p[0] / 255, p[1] / 255, p[2] / 255].map(clamp01); return { kind: 'rgb', rgb, cmyk: rgbToCmyk(...rgb), tint: 1, spot: null }; }
    return { kind: 'rgb', rgb: [0, 0, 0], cmyk: [0, 0, 0, 1], tint: 1, spot: null };
  }
  // amount (0–1) of a plate's ink in a resolved color
  function plateAmount(c, pl) {
    if (c.kind === 'none') return 0;
    if (pl.startsWith('S:')) return c.kind === 'spot' && c.spot.name === pl.slice(2) ? c.tint : 0;
    if (c.kind === 'spot') return 0;
    return c.cmyk['CMYK'.indexOf(pl)] || 0;
  }
  // CSS color for screen rendering (honours separation preview)
  function css(ref) {
    const c = parse(ref); if (c.kind === 'none') return 'rgba(0,0,0,0)';
    if (plate) { const g = Math.round((1 - plateAmount(c, plate)) * 255); return `rgb(${g},${g},${g})`; }
    if (!c.css) c.css = toHex(c.rgb);
    return c.css;
  }
  function rgba(ref, o) {
    const c = parse(ref); if (c.kind === 'none') return 'rgba(0,0,0,0)';
    let rgb = c.rgb; if (plate) { const g = 1 - plateAmount(c, plate); rgb = [g, g, g]; }
    return `rgba(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)},${o ?? 1})`;
  }
  const hex = ref => { const c = parse(ref); return c.kind === 'none' ? null : toHex(c.rgb); };
  function withPlate(p, fn) { const old = plate; plate = p || null; try { return fn(); } finally { plate = old; } }

  // separation plate of an RGB image (grayscale ink coverage), cached per image
  function plateImage(im, pl) {
    if (!pl || !im || !im.el) return im && im.el;
    im._plates = im._plates || {};
    let c = im._plates[pl]; if (c) return c;
    const s = Math.min(1, 1600 / Math.max(im.el.naturalWidth || 1, im.el.naturalHeight || 1));
    const w = Math.max(1, Math.round((im.el.naturalWidth || 1) * s)), h = Math.max(1, Math.round((im.el.naturalHeight || 1) * s));
    c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(im.el, 0, 0, w, h);
    const id = ctx.getImageData(0, 0, w, h), d = id.data, ch = 'CMYK'.indexOf(pl);
    for (let i = 0; i < d.length; i += 4) {
      let a = 0;
      if (ch >= 0) { const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, k = 1 - Math.max(r, g, b); a = ch === 3 ? k : k >= 1 ? 0 : (1 - [r, g, b][ch] - k) / (1 - k); }
      const v = Math.round((1 - a) * 255); d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(id, 0, 0);
    // image dimensions for drawImage stay those of the original
    im._plates[pl] = c; return c;
  }

  // every color reference used in the document (items, gradients, tables, text attrs, styles)
  function refsIn(d) {
    const out = [];
    const add = (v, where) => { if (typeof v === 'string' && v) out.push({ ref: v, where }); };
    const item = (it, where) => {
      add(it.fill, where); add(it.stroke, where);
      if (it.grad) { add(it.grad.c0, where); add(it.grad.c1, where); }
      if (it.type === 'table') tableRefs(it, where);
    };
    const tableRefs = (t, where) => { ['tcolor', 'hfill', 'hcolor', 'bcolor', 'zebra'].forEach(k => add(t[k], where)); (t.cells || []).forEach(r => (r || []).forEach(c => { if (c) { add(c.fill, where); add(c.color, where); } })); };
    const pages = [...d.pages.map((p, i) => [p, i]), ...d.masters.flatMap(m => m.pages.map(p => [p, null]))];
    for (const [p, i] of pages) M.walkItems(p.items, it => item(it, { page: i, id: it.id }));
    for (const s of Object.values(d.stories)) {
      s.attrs.forEach(a => add(a.color, { story: s.id }));
      s.paras.forEach(p => { add(p.color, { story: s.id }); add(p.ruleA?.color, { story: s.id }); add(p.ruleB?.color, { story: s.id }); });
      for (const o of Object.values(s.objs || {})) { if (o.kind === 'table') tableRefs(o, { story: s.id }); else if (o.item) item(o.item, { story: s.id }); }
    }
    Object.values(d.paraStyles).forEach(st => { add(st.color, { style: true }); add(st.ruleA?.color, { style: true }); add(st.ruleB?.color, { style: true }); });
    Object.values(d.charStyles).forEach(st => add(st.color, { style: true }));
    return out;
  }
  // inks used by the document → ['C','M','Y','K', 'S:<name>', …]
  function inks(d) {
    const spots = new Set();
    use(d);
    for (const { ref } of refsIn(d)) { const c = parse(ref); if (c.kind === 'spot') spots.add(c.spot.name); }
    for (const sw of d.swatches || []) if (sw && sw.spot) spots.add(sw.name);
    return ['C', 'M', 'Y', 'K', ...[...spots].map(n => 'S:' + n)];
  }
  function describe(sw) {
    if (sw.model === 'rgb') return `R=${sw.v[0]} G=${sw.v[1]} B=${sw.v[2]}`;
    return `C=${+sw.v[0].toFixed(1)} M=${+sw.v[1].toFixed(1)} Y=${+sw.v[2].toFixed(1)} K=${+sw.v[3].toFixed(1)}`;
  }
  const DEFAULT_SWATCHES = () => [
    { id: 'paper', name: 'Paper', model: 'cmyk', v: [0, 0, 0, 0] },
    { id: 'black', name: 'Black', model: 'cmyk', v: [0, 0, 0, 100] },
    { id: 'cyan', name: 'Cyan', model: 'cmyk', v: [100, 0, 0, 0] },
    { id: 'magenta', name: 'Magenta', model: 'cmyk', v: [0, 100, 0, 0] },
    { id: 'yellow', name: 'Yellow', model: 'cmyk', v: [0, 0, 100, 0] },
    { id: 'red', name: 'C=15 M=100 Y=100 K=0', model: 'cmyk', v: [15, 100, 100, 0] },
    { id: 'green', name: 'C=75 M=5 Y=100 K=0', model: 'cmyk', v: [75, 5, 100, 0] },
    { id: 'blue', name: 'C=100 M=90 Y=10 K=0', model: 'cmyk', v: [100, 90, 10, 0] },
    { id: 'grey', name: 'Grey 50%', model: 'cmyk', v: [0, 0, 0, 50] },
  ];
  // migrate a v1 swatch list (hex strings) to swatch objects
  function migrateSwatches(list) {
    const out = [], seen = new Set();
    for (const s of Array.isArray(list) ? list : []) {
      if (typeof s === 'string') { const rgb = parseHex(s); if (!rgb) continue; const id = 'h' + s.slice(1).toLowerCase(); if (seen.has(id)) continue; seen.add(id); out.push({ id, name: s.toLowerCase(), model: 'rgb', v: rgb.map(x => Math.round(x * 255)) }); }
      else if (s && typeof s === 'object') { const v = sanitizeSwatch(s); if (v && !seen.has(v.id)) { seen.add(v.id); out.push(v); } }
    }
    return out;
  }
  function sanitizeSwatch(s) {
    if (!s || typeof s.id !== 'string' || !/^[\w-]{1,40}$/.test(s.id)) return null;
    const model = s.model === 'rgb' ? 'rgb' : 'cmyk', n = model === 'rgb' ? 3 : 4, max = model === 'rgb' ? 255 : 100;
    const v = Array.isArray(s.v) ? s.v.slice(0, n).map(x => Math.max(0, Math.min(max, Number.isFinite(+x) ? +x : 0))) : [];
    while (v.length < n) v.push(0);
    return { id: s.id, name: String(s.name ?? s.id).slice(0, 64), model, v, ...(s.spot ? { spot: true } : {}) };
  }
  // a color ref is valid data if it matches one of the allowed grammars
  const validRef = r => typeof r === 'string' && (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(r) || /^cmyk\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*\)$/i.test(r) || /^@[\w-]{1,40}(\/[\d.]+)?$/.test(r) || /^rgba?\([\d.,\s]+\)$/.test(r));
  // a color produced by a color picker: CMYK in print documents, RGB otherwise
  function fromPicker(hexStr, d = doc) {
    if (!d || !d.cmyk) return hexStr;
    const rgb = parseHex(hexStr); if (!rgb) return hexStr;
    const c = rgbToCmyk(...rgb).map(v => Math.round(v * 100));
    return `cmyk(${c.join(',')})`;
  }
  // replace swatch refs (on delete) with an equivalent unnamed color
  function detach(sw, ref) {
    const m = /^@([\w-]+)(?:\/([\d.]+))?$/.exec(ref); if (!m || m[1] !== sw.id) return ref;
    const t = m[2] != null ? +m[2] / 100 : 1, c = swatchColor(sw);
    if (sw.model === 'rgb') return toHex(c.rgb.map(v => 1 - t * (1 - v)));
    return `cmyk(${c.cmyk.map(v => +(v * t * 100).toFixed(1)).join(',')})`;
  }
  const plateLabel = p => !p ? 'Composite' : p === 'C' ? 'Cyan' : p === 'M' ? 'Magenta' : p === 'Y' ? 'Yellow' : p === 'K' ? 'Black' : p.slice(2);
  const totalInk = c => c.kind === 'cmyk' ? c.cmyk.reduce((a, b) => a + b, 0) * 100 : 0;

  window.Color = { use, invalidate, parse, css, rgba, hex, toHex, parseHex, cmykToRgb, rgbToCmyk, swatch, swatchColor, plateAmount, withPlate, plateImage, refsIn, inks, describe,
    DEFAULT_SWATCHES, migrateSwatches, sanitizeSwatch, validRef, fromPicker, detach, plateLabel, totalInk, INK,
    get plate() { return plate; } };
})();
