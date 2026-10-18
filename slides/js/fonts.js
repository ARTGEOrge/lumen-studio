'use strict';
/* Lumen Slides — bundled fonts (SIL OFL, from @fontsource) + list of common system fonts for the font menu. */
const Fonts = (() => {
  const BUNDLED = [
    ['Inter', 'inter', [400, 700], true], ['Montserrat', 'montserrat', [400, 700], true], ['Lora', 'lora', [400, 700], true],
    ['Playfair Display', 'playfair-display', [400, 700], true], ['Bebas Neue', 'bebas-neue', [400], false], ['Caveat', 'caveat', [400, 700], false],
  ];
  const SYSTEM = ['Arial', 'Calibri', 'Calibri Light', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Georgia', 'Impact', 'Segoe UI', 'Segoe UI Semibold', 'Segoe UI Light', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
  const here = document.currentScript && document.currentScript.src || location.href;
  const loads = [];
  for (const [fam, file, weights, italic] of BUNDLED) for (const w of weights) for (const st of italic ? ['normal', 'italic'] : ['normal']) {
    const url = new URL(`../vendor/fonts/${file}-latin-${w}-${st}.woff2`, here).href;
    try { const f = new FontFace(fam, `url(${url}) format("woff2")`, { weight: String(w), style: st, display: 'block' }); document.fonts.add(f); loads.push(f.load().catch(() => null)); } catch (e) { /* ignore */ }
  }
  const ready = Promise.all(loads).then(() => { if (window.Render) Render.clearMeasureCache(); });
  const names = () => [...BUNDLED.map(b => b[0]), ...SYSTEM];
  return { ready, names, BUNDLED: BUNDLED.map(b => b[0]), SYSTEM };
})();
