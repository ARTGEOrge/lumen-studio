// Lumen Map — data classification (equal interval, quantile, natural breaks (Jenks), standard deviation, pretty)
// and colour ramps for graduated / categorized symbology.
(function (root) {
  'use strict';
  const RAMPS = {
    Blues: ['#eff5fb', '#c6dbef', '#6baed6', '#2171b5', '#08306b'], Greens: ['#f2faf0', '#c7e9c0', '#74c476', '#238b45', '#00441b'],
    Oranges: ['#fff3e6', '#fdd0a2', '#fd8d3c', '#d94801', '#7f2704'], Reds: ['#fff0eb', '#fcbba1', '#fb6a4a', '#cb181d', '#67000d'],
    Purples: ['#f8f6fb', '#dadaeb', '#9e9ac8', '#6a51a3', '#3f007d'], 'Yellow-Red': ['#ffffcc', '#fed976', '#fd8d3c', '#e31a1c', '#800026'],
    'Yellow-Blue': ['#ffffd9', '#c7e9b4', '#41b6c4', '#225ea8', '#081d58'], Viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
    Magma: ['#000004', '#51127c', '#b73779', '#fc8961', '#fcfdbf'], Terrain: ['#2b83ba', '#abdda4', '#ffffbf', '#c9a26b', '#ffffff'],
    'Red-Blue': ['#b2182b', '#ef8a62', '#f7f7f7', '#67a9cf', '#2166ac'], Spectral: ['#d7191c', '#fdae61', '#ffffbf', '#abdda4', '#2b83ba'],
    'Brown-Teal': ['#8c510a', '#d8b365', '#f5f5f5', '#5ab4ac', '#01665e'], Greys: ['#f7f7f7', '#cccccc', '#969696', '#525252', '#141414'],
  };
  const QUAL = {
    Vivid: ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'],
    Pastel: ['#8dd3c7', '#ffffb3', '#bebada', '#fb8072', '#80b1d3', '#fdb462', '#b3de69', '#fccde5', '#d9d9d9', '#bc80bd', '#ccebc5', '#ffed6f'],
    Earth: ['#a6611a', '#dfc27d', '#80cdc1', '#018571', '#8c6d31', '#bd9e39', '#637939', '#8ca252', '#b5cf6b', '#cedb9c'],
    Bold: ['#1b9e77', '#d95f02', '#7570b3', '#e7298a', '#66a61e', '#e6ab02', '#a6761d', '#666666'],
  };
  const hex = c => { c = String(c).replace('#', ''); if (c.length === 3) c = c.split('').map(x => x + x).join(''); const n = parseInt(c.slice(0, 6), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const toHex = rgb => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  function rampColor(name, t, invert) {
    const st = RAMPS[name] || RAMPS.Blues; if (invert) t = 1 - t; t = Math.max(0, Math.min(1, t));
    const x = t * (st.length - 1), i = Math.min(st.length - 2, Math.floor(x)), f = x - i, a = hex(st[i]), b = hex(st[i + 1]);
    return toHex(a.map((v, k) => v + (b[k] - v) * f));
  }
  function rampColors(name, n, invert) { if (n <= 1) return [rampColor(name, 0.6, invert)]; return Array.from({ length: n }, (_, i) => rampColor(name, i / (n - 1), invert)); }
  function qualColors(name, n) { const p = QUAL[name] || QUAL.Vivid, out = []; for (let i = 0; i < n; i++) { const c = p[i % p.length]; if (i < p.length) out.push(c); else { const k = Math.floor(i / p.length); out.push(toHex(hex(c).map(v => v * (1 - 0.18 * k) + 255 * 0.0))); } } return out; }
  const randomColor = (seed) => { let h = 0; for (const c of String(seed)) h = (h * 31 + c.charCodeAt(0)) >>> 0; const hue = h % 360; return hsl(hue, 55, 62); };
  function hsl(h, s, l) { s /= 100; l /= 100; const k = n => (n + h / 30) % 12, a = s * Math.min(l, 1 - l), f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return toHex([f(0) * 255, f(8) * 255, f(4) * 255]); }

  // ---------- breaks: returns k+1 boundaries [min, b1, …, max] ----------
  function equal(v, k) { const lo = v[0], hi = v[v.length - 1]; return Array.from({ length: k + 1 }, (_, i) => lo + (hi - lo) * i / k); }
  function quantile(v, k) {
    const out = [v[0]];
    for (let i = 1; i < k; i++) { const p = i / k * (v.length - 1), lo = Math.floor(p), f = p - lo; out.push(v[lo] + (v[Math.min(v.length - 1, lo + 1)] - v[lo]) * f); }
    out.push(v[v.length - 1]); return out;
  }
  // Jenks natural breaks (Fisher's exact dynamic programme on the sorted values; samples large inputs)
  function jenks(v, k) {
    let data = v; if (data.length > 2000) { const step = data.length / 2000; data = Array.from({ length: 2000 }, (_, i) => v[Math.floor(i * step)]); data[data.length - 1] = v[v.length - 1]; }
    const n = data.length; k = Math.min(k, n);
    const lower = Array.from({ length: n + 1 }, () => new Int32Array(k + 1)), vari = Array.from({ length: n + 1 }, () => new Float64Array(k + 1).fill(Infinity));
    for (let j = 1; j <= k; j++) { lower[1][j] = 1; vari[1][j] = 0; }
    for (let l = 2; l <= n; l++) {
      let s1 = 0, s2 = 0, w = 0;
      for (let m = 1; m <= l; m++) {
        const i3 = l - m + 1, val = data[i3 - 1]; s2 += val * val; s1 += val; w++;
        const variance = s2 - s1 * s1 / w, i4 = i3 - 1;
        if (i4 !== 0) for (let j = 2; j <= k; j++) if (vari[l][j] >= variance + vari[i4][j - 1]) { lower[l][j] = i3; vari[l][j] = variance + vari[i4][j - 1]; }
      }
      lower[l][1] = 1; vari[l][1] = s2 - s1 * s1 / w;
    }
    const br = new Array(k + 1); br[k] = data[n - 1]; br[0] = data[0];
    let kk = n; for (let j = k; j >= 2; j--) { const id = lower[kk][j] - 2; br[j - 1] = data[Math.max(0, id)]; kk = lower[kk][j] - 1; }
    return br;
  }
  function stddev(v, k) {
    const mean = v.reduce((s, x) => s + x, 0) / v.length, sd = Math.sqrt(v.reduce((s, x) => s + (x - mean) ** 2, 0) / v.length) || 1;
    const out = [v[0]]; const half = (k - 2) / 2;
    for (let i = 1; i < k; i++) { const b = mean + (i - k / 2) * sd; if (b > v[0] && b < v[v.length - 1]) out.push(b); }
    out.push(v[v.length - 1]); return [...new Set(out)].sort((a, b) => a - b);
  }
  function pretty(v, k) {
    const lo = v[0], hi = v[v.length - 1], raw = (hi - lo) / k || 1, mag = Math.pow(10, Math.floor(Math.log10(raw))), nice = [1, 2, 2.5, 5, 10].map(x => x * mag).find(x => x >= raw);
    const out = []; for (let b = Math.floor(lo / nice) * nice; b < hi + nice * 0.999; b += nice) out.push(+b.toFixed(10));
    out[0] = Math.min(out[0], lo); return out;
  }
  const METHODS = { equal: 'Equal interval', quantile: 'Quantile (equal count)', jenks: 'Natural breaks (Jenks)', stddev: 'Standard deviation', pretty: 'Pretty breaks' };
  function breaks(values, k, method) {
    const v = values.filter(x => typeof x === 'number' && isFinite(x)).sort((a, b) => a - b);
    if (!v.length) return [];
    if (v[0] === v[v.length - 1]) return [v[0], v[0]];
    const f = { equal, quantile, jenks, stddev, pretty }[method] || equal;
    const b = f(v, Math.max(1, k));
    // keep strictly increasing upper bounds (a first class may hold just the minimum: [min, min, …])
    return b.filter((x, i) => i === 0 || x > b[i - 1] || (i === 1 && b.length > 2 && b[2] > x));
  }
  function fmt(x) { if (x == null || !isFinite(x)) return ''; const a = Math.abs(x); return a >= 1e6 ? (x / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M' : a >= 1000 ? Math.round(x).toLocaleString('en-US') : a >= 10 ? x.toFixed(1).replace(/\.0$/, '') : +x.toPrecision(3) + ''; }
  // classes from breaks: [{min,max,color,label}]
  function makeClasses(br, ramp, invert) {
    const n = br.length - 1; if (n < 1) return br.length ? [{ min: br[0], max: br[0], color: rampColor(ramp, 0.6, invert), label: fmt(br[0]) }] : [];
    const cols = rampColors(ramp, n, invert);
    return Array.from({ length: n }, (_, i) => ({ min: br[i], max: br[i + 1], color: cols[i], label: br[i] === br[i + 1] ? fmt(br[i]) : `${fmt(br[i])} – ${fmt(br[i + 1])}` }));
  }
  const classOf = (classes, x) => { if (typeof x !== 'number' || !isFinite(x)) return -1; for (let i = 0; i < classes.length; i++) if (x <= classes[i].max || i === classes.length - 1 && x <= classes[i].max * (1 + 1e-12) + 1e-12) return x >= classes[0].min - 1e-12 ? i : -1; return -1; };
  const api = { RAMPS, QUAL, METHODS, rampColor, rampColors, qualColors, randomColor, breaks, makeClasses, classOf, fmt, hex, toHex, hsl };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MapClass = api;
})(typeof self !== 'undefined' ? self : this);
