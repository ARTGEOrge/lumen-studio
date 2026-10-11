'use strict';
/* Lumen Layout — bundled font registry. Every family is a local OFL TTF set (vendor/fonts),
   registered as a FontFace for screen rendering and embedded byte-for-byte into exported PDFs,
   so measurement, screen and PDF all use exactly the same glyph advances. */
(function () {
  const F = 'vendor/fonts/';
  const FAMILIES = {
    'Source Serif 4': { cat: 'Serif', file: 'SourceSerif4', w: { 400: 'Regular', 600: 'SemiBold', 700: 'Bold' }, it: [400, 600, 700] },
    'Playfair Display': { cat: 'Display', file: 'PlayfairDisplay', w: { 400: 'Regular', 700: 'Bold', 900: 'Black' }, it: [400, 700, 900] },
    'Lora': { cat: 'Serif', file: 'Lora', w: { 400: 'Regular', 700: 'Bold' }, it: [400, 700] },
    'Montserrat': { cat: 'Sans', file: 'Montserrat', w: { 400: 'Regular', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold' }, it: [400, 600, 700] },
    'Oswald': { cat: 'Condensed', file: 'Oswald', w: { 300: 'Light', 400: 'Regular', 500: 'Medium', 700: 'Bold' }, it: [] },
  };
  const WNAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
  const bytes = {};          // faceKey -> ArrayBuffer
  const faces = {};          // faceKey -> {family, weight, italic, file}
  const widthCache = {};     // fontKey -> Map(char -> width at 100)
  const metricCache = {};
  let mctx = null;

  function fileName(fam, w, it) { const d = FAMILIES[fam]; return `${d.file}_${w}${d.w[w]}${it ? '_Italic' : ''}.ttf`; }
  function nearestWeight(list, w) { let best = list[0]; for (const x of list) if (Math.abs(x - w) < Math.abs(best - w) || (Math.abs(x - w) === Math.abs(best - w) && x > best)) best = x; return best; }

  // Resolve a (family, weight, italic) request to a real face. Returns a stable "font key".
  function resolve(family, weight = 400, italic = false) {
    const d = FAMILIES[family] || FAMILIES['Source Serif 4'];
    if (!FAMILIES[family]) family = 'Source Serif 4';
    const weights = Object.keys(d.w).map(Number);
    let w = nearestWeight(weights, weight), it = false, synth = false;
    if (italic) {
      if (d.it.length) { w = nearestWeight(d.it, weight); it = true; } else synth = true;
    }
    return `${family}|${w}|${it ? 'i' : 'n'}${synth ? 's' : ''}`;
  }
  function parse(key) { const [family, w, s] = key.split('|'); return { family, weight: +w, italic: s[0] === 'i', synthItalic: s.includes('s') }; }
  function faceKey(key) { const p = parse(key); return `${p.family}|${p.weight}|${p.italic ? 'i' : 'n'}`; }
  function css(key, size) { const p = parse(key); return `${p.italic || p.synthItalic ? 'italic ' : ''}${p.weight} ${size}px "LL ${p.family}"`; }

  async function load() {
    const jobs = [];
    for (const [fam, d] of Object.entries(FAMILIES)) {
      for (const w of Object.keys(d.w).map(Number)) {
        for (const it of [false, true]) {
          if (it && !d.it.includes(w)) continue;
          const k = `${fam}|${w}|${it ? 'i' : 'n'}`, file = fileName(fam, w, it);
          faces[k] = { family: fam, weight: w, italic: it, file };
          jobs.push(fetch(F + file).then(r => { if (!r.ok) throw new Error('font ' + file); return r.arrayBuffer(); }).then(async buf => {
            bytes[k] = buf;
            const ff = new FontFace('LL ' + fam, buf.slice(0), { weight: String(w), style: it ? 'italic' : 'normal' });
            await ff.load(); document.fonts.add(ff);
          }));
        }
      }
    }
    await Promise.all(jobs);
    mctx = document.createElement('canvas').getContext('2d');
    try { mctx.fontKerning = 'none'; } catch (e) { }
  }

  // advance width of a string at size 100 (cached per char for single chars)
  function width100(key, s) {
    let m = widthCache[key]; if (!m) { m = widthCache[key] = new Map(); }
    let v = m.get(s); if (v !== undefined) return v;
    mctx.font = css(key, 100); v = mctx.measureText(s).width; m.set(s, v); return v;
  }
  function metrics(key) {
    let m = metricCache[key]; if (m) return m;
    mctx.font = css(key, 100);
    const a = mctx.measureText('dhklbfH'), g = mctx.measureText('gjpqy'), h = mctx.measureText('H'), x = mctx.measureText('x');
    m = metricCache[key] = { asc: (a.actualBoundingBoxAscent || 75) / 100, desc: (g.actualBoundingBoxDescent || 22) / 100, cap: (h.actualBoundingBoxAscent || 70) / 100, xh: (x.actualBoundingBoxAscent || 50) / 100 };
    return m;
  }
  function styleOptions(family) {
    const d = FAMILIES[family]; if (!d) return [];
    const out = [];
    Object.keys(d.w).map(Number).forEach(w => {
      out.push({ weight: w, italic: false, label: WNAMES[w] });
      out.push({ weight: w, italic: true, label: (w === 400 ? '' : WNAMES[w] + ' ') + 'Italic' + (d.it.includes(w) ? '' : ' (oblique)') });
    });
    return out;
  }

  window.Fonts = { FAMILIES, families: Object.keys(FAMILIES), load, resolve, parse, css, width100, metrics, styleOptions, faceKey,
    bytesFor: key => bytes[faceKey(key)], WNAMES };
})();
