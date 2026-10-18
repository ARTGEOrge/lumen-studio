'use strict';
/* Lumen Write — bundled font registry. Every family is a local TTF set (vendor/fonts) registered as a
   FontFace for the editor and embedded byte-for-byte into exported PDFs, so screen and PDF match. */
const Fonts = (() => {
  const F = 'vendor/fonts/';
  const FAMILIES = {
    'Source Serif 4': { cat: 'serif', r: 'SourceSerif4_400Regular.ttf', i: 'SourceSerif4_400Regular_Italic.ttf', b: 'SourceSerif4_700Bold.ttf', bi: 'SourceSerif4_700Bold_Italic.ttf' },
    'Liberation Sans': { cat: 'sans-serif', r: 'LiberationSans-Regular.ttf', i: 'LiberationSans-Italic.ttf', b: 'LiberationSans-Bold.ttf', bi: 'LiberationSans-BoldItalic.ttf' },
    'Lora': { cat: 'serif', r: 'Lora_400Regular.ttf', i: 'Lora_400Regular_Italic.ttf', b: 'Lora_700Bold.ttf', bi: 'Lora_700Bold_Italic.ttf' },
    'Montserrat': { cat: 'sans-serif', r: 'Montserrat_400Regular.ttf', i: 'Montserrat_400Regular_Italic.ttf', b: 'Montserrat_700Bold.ttf', bi: 'Montserrat_700Bold_Italic.ttf' },
    'DejaVu Sans Mono': { cat: 'monospace', r: 'DejaVuSansMono.ttf', b: 'DejaVuSansMono-Bold.ttf' },
  };
  const FALLBACK = 'DejaVuSans.ttf';   // wide Unicode coverage for PDF glyph fallback
  const names = Object.keys(FAMILIES);
  // Map a foreign font name (from .docx/.odt/.html) to one of the bundled families.
  function map(name) {
    if (!name) return null;
    const n = String(name).split(',')[0].replace(/["']/g, '').trim();
    const hit = names.find(f => f.toLowerCase() === n.toLowerCase()); if (hit) return hit;
    const l = n.toLowerCase();
    if (/mono|courier|consolas|menlo|code|typewriter/.test(l)) return 'DejaVu Sans Mono';
    if (/lora/.test(l)) return 'Lora';
    if (/montserrat|gotham|futura|century gothic|avenir/.test(l)) return 'Montserrat';
    if (/times|cambria|georgia|garamond|serif|book|minion|palatino|baskerville|caslon|constantia|charter/.test(l) && !/sans/.test(l)) return 'Source Serif 4';
    return 'Liberation Sans';
  }
  const css = name => { const f = FAMILIES[name] ? name : map(name) || 'Liberation Sans'; return `"${f}", ${FAMILIES[f].cat}`; };
  let loaded = null;
  function load() {
    if (loaded) return loaded;
    const jobs = [];
    for (const [fam, d] of Object.entries(FAMILIES)) {
      const add = (file, weight, style) => { if (!file) return; const ff = new FontFace(fam, `url(${F}${file})`, { weight, style }); document.fonts.add(ff); jobs.push(ff.load().catch(() => null)); };
      add(d.r, '400', 'normal'); add(d.i, '400', 'italic'); add(d.b, '700', 'normal'); add(d.bi, '700', 'italic');
    }
    loaded = Promise.all(jobs);
    return loaded;
  }
  const bytes = {};
  async function fileBytes(file) { if (!bytes[file]) bytes[file] = fetch(F + file).then(r => { if (!r.ok) throw new Error('font ' + file); return r.arrayBuffer(); }); return bytes[file]; }
  // face file for a PDF run: family + bold + italic (falls back to regular weight/upright when missing)
  function faceFile(fam, bold, italic) {
    const d = FAMILIES[fam] || FAMILIES[map(fam)] || FAMILIES['Liberation Sans'];
    if (bold && italic && d.bi) return d.bi;
    if (bold && d.b) return d.b;
    if (italic && d.i) return d.i;
    return d.r;
  }
  return { FAMILIES, names, map, css, load, fileBytes, faceFile, FALLBACK };
})();
