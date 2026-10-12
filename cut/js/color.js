'use strict';
/* Lumen Cut — colour helpers: .cube LUT parsing + validation + storage, curve tables (monotone cubic),
   colour-wheel offsets. Pure functions shared by the compositor, the Effect Controls panel and the tests. */
(function () {
  LC.rt = LC.rt || { media: new Map() };
  LC.rt.luts = LC.rt.luts || new Map();           // lut id → {size, data: Float32Array(size³·3), dmin, dmax}

  /* ---------- .cube parser (Adobe/Resolve format). Throws an Error with a line number on invalid files ---------- */
  LC.parseCube = (text) => {
    if (typeof text !== 'string') throw new Error('Not a text file');
    if (text.length > 60e6) throw new Error('File is too large for a LUT');
    if (/\u0000/.test(text.slice(0, 4096))) throw new Error('This is a binary file, not a .cube LUT');
    const lines = text.split(/\r\n|\n|\r/);
    let size3 = 0, size1 = 0, title = '', dmin = [0, 0, 0], dmax = [1, 1, 1];
    const vals = [];
    const nums = (parts, n, i, kw) => {
      if (parts.length !== n) throw new Error(`Line ${i + 1}: ${kw} needs ${n} number${n > 1 ? 's' : ''}`);
      const v = parts.map(Number); if (v.some(x => !isFinite(x))) throw new Error(`Line ${i + 1}: invalid number in ${kw}`); return v;
    };
    for (let i = 0; i < lines.length; i++) {
      let ln = lines[i]; const h = ln.indexOf('#'); if (h >= 0) ln = ln.slice(0, h); ln = ln.trim(); if (!ln) continue;
      const parts = ln.split(/\s+/), kw = parts[0].toUpperCase();
      if (/^[-+.\d]/.test(kw)) {
        if (parts.length !== 3) throw new Error(`Line ${i + 1}: expected 3 values (R G B), found ${parts.length}`);
        const a = +parts[0], b = +parts[1], c = +parts[2];
        if (!isFinite(a) || !isFinite(b) || !isFinite(c)) throw new Error(`Line ${i + 1}: invalid number`);
        vals.push(a, b, c); continue;
      }
      if (vals.length) throw new Error(`Line ${i + 1}: keyword "${kw.slice(0, 24)}" after table data`);
      if (kw === 'TITLE') { title = ln.slice(5).trim().replace(/^"|"$/g, '').slice(0, 120); continue; }
      if (kw === 'LUT_3D_SIZE') { const [n] = nums(parts.slice(1), 1, i, kw); if (!(Number.isInteger(n) && n >= 2 && n <= 65)) throw new Error(`Line ${i + 1}: LUT_3D_SIZE must be an integer from 2 to 65`); size3 = n; continue; }
      if (kw === 'LUT_1D_SIZE') { const [n] = nums(parts.slice(1), 1, i, kw); if (!(Number.isInteger(n) && n >= 2 && n <= 65536)) throw new Error(`Line ${i + 1}: LUT_1D_SIZE must be an integer from 2 to 65536`); size1 = n; continue; }
      if (kw === 'DOMAIN_MIN') { dmin = nums(parts.slice(1), 3, i, kw); continue; }
      if (kw === 'DOMAIN_MAX') { dmax = nums(parts.slice(1), 3, i, kw); continue; }
      if (kw === 'LUT_3D_INPUT_RANGE' || kw === 'LUT_1D_INPUT_RANGE') { const [a, b] = nums(parts.slice(1), 2, i, kw); dmin = [a, a, a]; dmax = [b, b, b]; continue; }
      throw new Error(`Line ${i + 1}: unknown keyword "${kw.slice(0, 24)}"`);
    }
    if (!size3 && !size1) throw new Error('Missing LUT_3D_SIZE (or LUT_1D_SIZE) — not a .cube LUT');
    if (size3 && size1) throw new Error('File declares both LUT_1D_SIZE and LUT_3D_SIZE');
    if (dmax.some((x, k) => !(x > dmin[k]))) throw new Error('DOMAIN_MAX must be greater than DOMAIN_MIN');
    const need = size3 ? size3 ** 3 : size1;
    if (vals.length / 3 !== need) throw new Error(`Expected ${need} table entries for this size, found ${vals.length / 3}`);
    // normalise to a 3D table on [0,1] input (red fastest); domain is baked in
    const N = size3 || 33, out = new Float32Array(N * N * N * 3);
    const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
    if (size3) {
      const ident = dmin.every(x => x === 0) && dmax.every(x => x === 1);
      if (ident) for (let i = 0; i < out.length; i++) out[i] = clamp01(vals[i]);
      else {   // resample: grid point x∈[0,1] → domain coordinate, trilinear lookup
        const at = (r, g, b, ch) => vals[((b * N + g) * N + r) * 3 + ch];
        for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
          const p = [r, g, b].map((q, k) => Math.min(N - 1, Math.max(0, ((q / (N - 1)) - dmin[k]) / (dmax[k] - dmin[k]) * (N - 1))));
          const i0 = p.map(Math.floor), f = p.map((x, k) => x - i0[k]), i1 = i0.map(x => Math.min(N - 1, x + 1));
          for (let ch = 0; ch < 3; ch++) {
            let v = 0;
            for (let c = 0; c < 8; c++) { const ir = c & 1 ? i1[0] : i0[0], ig = c & 2 ? i1[1] : i0[1], ib = c & 4 ? i1[2] : i0[2]; const w = (c & 1 ? f[0] : 1 - f[0]) * (c & 2 ? f[1] : 1 - f[1]) * (c & 4 ? f[2] : 1 - f[2]); v += w * at(ir, ig, ib, ch); }
            out[((b * N + g) * N + r) * 3 + ch] = clamp01(v);
          }
        }
      }
    } else {
      const one = (x, ch) => { const p = Math.min(size1 - 1, Math.max(0, (x - dmin[ch]) / (dmax[ch] - dmin[ch]) * (size1 - 1))); const i = Math.floor(p), j = Math.min(size1 - 1, i + 1), f = p - i; return vals[i * 3 + ch] * (1 - f) + vals[j * 3 + ch] * f; };
      for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
        const o = ((b * N + g) * N + r) * 3; out[o] = clamp01(one(r / (N - 1), 0)); out[o + 1] = clamp01(one(g / (N - 1), 1)); out[o + 2] = clamp01(one(b / (N - 1), 2));
      }
    }
    return { title, size: N, data: out, source: size3 ? '3D' : '1D' };
  };

  /* ---------- project storage: Uint16 little-endian, base64 ---------- */
  const b64enc = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const b64dec = s => { const bin = atob(s), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8; };
  LC.lutToProject = (parsed, name) => {
    const n = parsed.data.length, u16 = new Uint16Array(n);
    for (let i = 0; i < n; i++) u16[i] = Math.round(parsed.data[i] * 65535);
    const u8 = new Uint8Array(u16.buffer);   // little-endian on every platform we run on; decoder reads LE explicitly
    return { id: 'u' + Aero.uid(), name: String(name || parsed.title || 'LUT').slice(0, 120), size: parsed.size, data: b64enc(u8) };
  };
  LC.sanitizeLut = l => {
    if (!l || typeof l !== 'object') return null;
    const id = typeof l.id === 'string' && /^[\w-]{1,40}$/.test(l.id) ? l.id : null;
    const size = Number.isInteger(l.size) && l.size >= 2 && l.size <= 65 ? l.size : null;
    if (!id || !size || typeof l.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(l.data)) return null;
    const bytes = size ** 3 * 3 * 2; if (Math.floor(l.data.length * 3 / 4) - (l.data.match(/=*$/)[0].length) !== bytes) return null;
    return { id, name: typeof l.name === 'string' ? l.name.slice(0, 120) : 'LUT', size, data: l.data };
  };
  LC.lutData = lut => {               // decoded Float32 table (cached per id)
    LC.rt.luts = LC.rt.luts || new Map(); let e = LC.rt.luts.get(lut.id);
    if (e && e.src === lut.data) return e;
    const u8 = b64dec(lut.data), dv = new DataView(u8.buffer), n = u8.length / 2, f = new Float32Array(n);
    for (let i = 0; i < n; i++) f[i] = dv.getUint16(i * 2, true) / 65535;
    e = { size: lut.size, data: f, src: lut.data }; LC.rt.luts.set(lut.id, e); return e;
  };
  LC.lutById = id => LC.project?.luts?.find(l => l.id === id) || null;
  /* CPU reference lookup (trilinear) — used by tests and the LUT preview */
  LC.lutApply = (lut, rgb) => {
    const { size: N, data } = LC.lutData(lut), p = rgb.map(v => Math.min(1, Math.max(0, v)) * (N - 1));
    const i0 = p.map(Math.floor), f = p.map((x, k) => x - i0[k]), i1 = i0.map(x => Math.min(N - 1, x + 1));
    return [0, 1, 2].map(ch => { let v = 0; for (let c = 0; c < 8; c++) { const w = (c & 1 ? f[0] : 1 - f[0]) * (c & 2 ? f[1] : 1 - f[1]) * (c & 4 ? f[2] : 1 - f[2]); v += w * data[(((c & 4 ? i1[2] : i0[2]) * N + (c & 2 ? i1[1] : i0[1])) * N + (c & 1 ? i1[0] : i0[0])) * 3 + ch]; } return v; });
  };
  /* generate a .cube text from a function (sample LUT, tests) */
  LC.makeCube = (title, N, fn) => {
    const out = [`TITLE "${title}"`, `LUT_3D_SIZE ${N}`];
    for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) out.push(fn(r / (N - 1), g / (N - 1), b / (N - 1)).map(v => Math.min(1, Math.max(0, v)).toFixed(6)).join(' '));
    return out.join('\n') + '\n';
  };

  /* ---------- curves: monotone cubic (Fritsch–Carlson) through the points → 256-entry table ---------- */
  LC.curveTable = (pts, n = 256) => {
    const P = pts.slice().sort((a, b) => a[0] - b[0]), out = new Float32Array(n);
    if (P.length < 2) { for (let i = 0; i < n; i++) out[i] = i / (n - 1); return out; }
    const k = P.length, d = [], m = new Array(k).fill(0);
    for (let i = 0; i < k - 1; i++) d.push((P[i + 1][1] - P[i][1]) / Math.max(1e-6, P[i + 1][0] - P[i][0]));
    m[0] = d[0]; m[k - 1] = d[k - 2];
    for (let i = 1; i < k - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < k - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; } const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } }
    for (let j = 0; j < n; j++) {
      const x = j / (n - 1); let y;
      if (x <= P[0][0]) y = P[0][1]; else if (x >= P[k - 1][0]) y = P[k - 1][1];
      else {
        let i = 0; while (i < k - 2 && x > P[i + 1][0]) i++;
        const h = P[i + 1][0] - P[i][0], t = (x - P[i][0]) / h, t2 = t * t, t3 = t2 * t;
        y = (2 * t3 - 3 * t2 + 1) * P[i][1] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * P[i + 1][1] + (t3 - t2) * h * m[i + 1];
      }
      out[j] = Math.min(1, Math.max(0, y));
    }
    return out;
  };
  const isIdent = pts => !pts || pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1;
  LC.curvesActive = cv => !!cv && !(isIdent(cv.rgb) && isIdent(cv.r) && isIdent(cv.g) && isIdent(cv.b));
  /* combined RGBA float table: channel(master(x)) */
  LC.curvesTexData = cv => {
    const M = LC.curveTable(cv.rgb), R = LC.curveTable(cv.r), G = LC.curveTable(cv.g), B = LC.curveTable(cv.b), out = new Float32Array(256 * 4);
    const look = (T, v) => { const p = v * 255, i = Math.floor(p), j = Math.min(255, i + 1); return T[i] + (T[j] - T[i]) * (p - i); };
    for (let i = 0; i < 256; i++) { const m = M[i]; out[i * 4] = look(R, m); out[i * 4 + 1] = look(G, m); out[i * 4 + 2] = look(B, m); out[i * 4 + 3] = 1; }
    return out;
  };

  /* ---------- colour wheels: [x, y, luma] (x,y inside the unit disc) → rgb offset vector ---------- */
  LC.wheelVec = (w, strength) => {
    const [x, y, l] = w || [0, 0, 0], amt = Math.min(1, Math.hypot(x, y));
    let r = 0, g = 0, b = 0;
    if (amt > 1e-4) {
      const h = ((Math.atan2(y, x) / (2 * Math.PI)) + 1) % 1, f = k => { const q = (k + h * 6) % 6; return 1 - Math.max(0, Math.min(q, 4 - q, 1)); };
      r = f(5); g = f(3); b = f(1); const L = .2126 * r + .7152 * g + .0722 * b; r = (r - L) * amt; g = (g - L) * amt; b = (b - L) * amt;
    }
    return [r * strength, g * strength, b * strength, (l || 0) * strength];
  };
})();
