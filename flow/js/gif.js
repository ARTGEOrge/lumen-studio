// Animated GIF encoding for Lumen Flow: one shared median-cut palette (≤ 256 colours, 15-bit colour histogram) built
// from all frames, then LZW-compressed by omggif's GifWriter (vendor/omggif.js, MIT). No DOM — testable in Node.
(function (root) {
  'use strict';
  const GW = () => (typeof GifWriter !== 'undefined' ? GifWriter : require('../vendor/omggif.js').GifWriter);   // eslint-disable-line no-undef
  const key = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

  // median cut over a 32×32×32 histogram → palette (array of 0xRRGGBB, padded to a power of two ≥ 2)
  function buildPalette(frames, maxColors = 256) {
    const hist = new Uint32Array(32768);
    for (const fr of frames) { const d = fr.data, step = Math.max(1, Math.floor(d.length / 4 / 200000)) * 4; for (let o = 0; o < d.length; o += step) hist[key(d[o], d[o + 1], d[o + 2])]++; }
    const cols = []; for (let k = 0; k < 32768; k++) if (hist[k]) cols.push(k);
    const comp = (k, c) => c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31;
    const boxes = [cols];
    while (boxes.length < maxColors) {
      // split the box with the widest channel range (weighted by pixel count)
      let bi = -1, best = 0, bc = 0;
      boxes.forEach((B, i) => { if (B.length < 2) return; for (let c = 0; c < 3; c++) { let lo = 31, hi = 0; for (const k of B) { const v = comp(k, c); if (v < lo) lo = v; if (v > hi) hi = v; } let n = 0; for (const k of B) n += hist[k]; const score = (hi - lo) * Math.sqrt(n); if (score > best) { best = score; bi = i; bc = c; } } });
      if (bi < 0) break;
      const B = boxes[bi].sort((a, b) => comp(a, bc) - comp(b, bc)); let tot = 0; for (const k of B) tot += hist[k]; let acc = 0, cut = 1;
      for (let i = 0; i < B.length - 1; i++) { acc += hist[B[i]]; if (acc >= tot / 2) { cut = i + 1; break; } }
      boxes.splice(bi, 1, B.slice(0, cut), B.slice(cut));
    }
    const pal = boxes.filter(B => B.length).map(B => { let r = 0, g = 0, b = 0, n = 0; for (const k of B) { const w = hist[k]; r += ((k >> 10) * 8 + 4) * w; g += (((k >> 5) & 31) * 8 + 4) * w; b += ((k & 31) * 8 + 4) * w; n += w; } return (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n); });
    if (!pal.length) pal.push(0);
    let size = 2; while (size < pal.length) size <<= 1; while (pal.length < size) pal.push(0);
    return pal;
  }
  function indexer(pal) {
    const cache = new Int16Array(32768).fill(-1), P = pal.map(c => [c >> 16, (c >> 8) & 255, c & 255]);
    return (r, g, b) => { const k = key(r, g, b); let ix = cache[k]; if (ix >= 0) return ix; let bd = Infinity; ix = 0; const R = (k >> 10) * 8 + 4, G = ((k >> 5) & 31) * 8 + 4, Bl = (k & 31) * 8 + 4; for (let i = 0; i < P.length; i++) { const d = (P[i][0] - R) ** 2 * 3 + (P[i][1] - G) ** 2 * 4 + (P[i][2] - Bl) ** 2 * 2; if (d < bd) { bd = d; ix = i; } } cache[k] = ix; return ix; };
  }
  // frames: [{ width, height, data: RGBA Uint8(Clamped)Array }], delay in 1/100 s → Uint8Array (GIF89a, loops forever)
  function encodeGIF(frames, { delay = 6, loop = 0 } = {}) {
    if (!frames.length) throw new Error('No frames');
    const w = frames[0].width, h = frames[0].height, pal = buildPalette(frames), ix = indexer(pal);
    const buf = new Uint8Array(1024 + frames.length * (w * h * 2 + 1024)), gw = new (GW())(buf, w, h, { palette: pal, loop });
    const idx = new Uint8Array(w * h);
    for (const fr of frames) { const d = fr.data; for (let p = 0, o = 0; p < w * h; p++, o += 4) idx[p] = ix(d[o], d[o + 1], d[o + 2]); gw.addFrame(0, 0, w, h, idx, { delay }); }
    return buf.slice(0, gw.end());
  }
  const api = { buildPalette, encodeGIF };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FlowGIF = api;
})(typeof self !== 'undefined' ? self : this);
