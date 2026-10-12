'use strict';
/* Lumen Convert — live calculators: colour, units, number bases, Roman numerals, Unix timestamps, time zones. */
(() => {
  const { register, alias, util: U } = LC;
  const { esc, el } = U;
  const copyBtn = getText => { const b = el('button', 'mini', 'Copy'); b.type = 'button'; b.onclick = () => { const t = getText(); if (t) U.copyText(t); }; return b; };
  const round = (v, d = 0) => { const k = Math.pow(10, d); return Math.round(v * k) / k; };

  /* 19 ─ Colour converter */
  const clamp01 = v => Math.min(1, Math.max(0, v));
  function rgbToHsl(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return [h, s * 100, l * 100]; }
  function hslToRgb(h, s, l) { h = ((h % 360) + 360) % 360; s = clamp01(s / 100); l = clamp01(l / 100); const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2; const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x]; return [(r + m) * 255, (g + m) * 255, (b + m) * 255]; }
  function rgbToHsv(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60; return [h, mx ? d / mx * 100 : 0, mx * 100]; }
  function hsvToRgb(h, s, v) { s = clamp01(s / 100); v = clamp01(v / 100); const l = v * (1 - s / 2), sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l); return hslToRgb(h, sl * 100, l * 100); }
  function rgbToCmyk(r, g, b) { r /= 255; g /= 255; b /= 255; const k = 1 - Math.max(r, g, b); if (k >= 1) return [0, 0, 0, 100]; return [(1 - r - k) / (1 - k) * 100, (1 - g - k) / (1 - k) * 100, (1 - b - k) / (1 - k) * 100, k * 100]; }
  const cmykToRgb = (c, m, y, k) => [255 * (1 - c / 100) * (1 - k / 100), 255 * (1 - m / 100) * (1 - k / 100), 255 * (1 - y / 100) * (1 - k / 100)];
  const hex2 = v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  const nums = s => (s.match(/-?[\d.]+/g) || []).map(Number);
  let probe = null;
  function parseColor(s) {
    s = s.trim().toLowerCase(); if (!s) return null;
    let m;
    if ((m = s.match(/^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/))) { let h = m[1]; if (h.length <= 4) h = [...h].map(c => c + c).join(''); return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 }; }
    const n = nums(s), pct = /%/.test(s);
    if (/^rgba?\(/.test(s) && n.length >= 3) { const k = pct && /^\S*\(\s*[\d.]+%/.test(s) ? 2.55 : 1; return { r: n[0] * k, g: n[1] * k, b: n[2] * k, a: n[3] != null ? (n[3] > 1 ? n[3] / 100 : n[3]) : 1 }; }
    if (/^hsla?\(/.test(s) && n.length >= 3) { const [r, g, b] = hslToRgb(n[0], n[1], n[2]); return { r, g, b, a: n[3] != null ? (n[3] > 1 ? n[3] / 100 : n[3]) : 1 }; }
    if (/^hs[vb]a?\(/.test(s) && n.length >= 3) { const [r, g, b] = hsvToRgb(n[0], n[1], n[2]); return { r, g, b, a: 1 }; }
    if (/^cmyk\(/.test(s) && n.length >= 4) { const [r, g, b] = cmykToRgb(...n.slice(0, 4)); return { r, g, b, a: 1 }; }
    if (/^[a-z]+$/.test(s)) { probe = probe || document.createElement('canvas').getContext('2d'); probe.fillStyle = '#010203'; probe.fillStyle = s; const v = probe.fillStyle; if (v === '#010203' && s !== 'black') return null; return parseColor(v); }
    if (/^[\d.\s,]+$/.test(s) && n.length === 3) return { r: n[0], g: n[1], b: n[2], a: 1 };
    return null;
  }
  const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  function formats(c) {
    const r = Math.round(c.r), g = Math.round(c.g), b = Math.round(c.b), A = c.a < 1, a = round(c.a, 3);
    const [h, s, l] = rgbToHsl(r, g, b), [hv, sv, vv] = rgbToHsv(r, g, b), [cc, mm, yy, kk] = rgbToCmyk(r, g, b);
    return {
      hex: '#' + hex2(r) + hex2(g) + hex2(b) + (A ? hex2(c.a * 255) : ''),
      rgb: A ? `rgba(${r}, ${g}, ${b}, ${a})` : `rgb(${r}, ${g}, ${b})`,
      hsl: A ? `hsla(${round(h)}, ${round(s, 1)}%, ${round(l, 1)}%, ${a})` : `hsl(${round(h)}, ${round(s, 1)}%, ${round(l, 1)}%)`,
      hsv: `hsv(${round(hv)}, ${round(sv, 1)}%, ${round(vv, 1)}%)`,
      cmyk: `cmyk(${round(cc)}%, ${round(mm)}%, ${round(yy)}%, ${round(kk)}%)`
    };
  }
  register({
    id: 'color', cat: 'calc', glyph: 'color', name: 'Colour converter', keywords: 'color colour hex rgb hsl hsv cmyk picker convert css contrast',
    desc: 'HEX, RGB, HSL, HSV and CMYK, live, with a swatch and contrast check.',
    render(root) {
      const wrap = el('div', 'colorwrap'); root.append(wrap);
      const left = el('div'), sw = el('div', 'swatch'), pick = el('input'); pick.type = 'color'; pick.setAttribute('aria-label', 'Pick a colour'); pick.style.cssText = 'width:100%;height:34px;margin-top:10px';
      const shades = el('div', 'shades'), info = el('p', 'dim'); info.style.cssText = 'font-size:12.5px;margin:10px 0 0';
      left.append(sw, pick, shades, info);
      const right = el('div'); const any = el('input'); any.type = 'text'; any.placeholder = 'Type any colour: #1e90ff, rgb(30 144 255), hsl(210 100% 56%), cmyk(88%,44%,0%,0%), dodgerblue'; any.style.cssText = 'width:100%;font-size:15px;padding:6px 8px;margin-bottom:12px'; any.setAttribute('aria-label', 'Any colour');
      const grid = el('div', 'cfields'); right.append(any, grid); wrap.append(left, right);
      const F = {}; let cur = { r: 30, g: 57, b: 91, a: 1 };
      for (const [k, l] of [['hex', 'HEX'], ['rgb', 'RGB'], ['hsl', 'HSL'], ['hsv', 'HSV'], ['cmyk', 'CMYK']]) {
        const lab = el('label', null, l), inp = el('input'); inp.type = 'text'; inp.spellcheck = false; lab.htmlFor = inp.id = 'c-' + k;
        inp.oninput = () => { const pre = k === 'hsv' && !/^hs[vb]/i.test(inp.value) ? 'hsv(' + inp.value + ')' : k === 'cmyk' && !/^cmyk/i.test(inp.value) ? 'cmyk(' + inp.value + ')' : k === 'hsl' && !/^hsl/i.test(inp.value) ? 'hsl(' + inp.value + ')' : inp.value; const c = parseColor(pre); inp.classList.toggle('bad', !c); if (c) set(c, k); };
        F[k] = inp; grid.append(lab, inp, copyBtn(() => inp.value));
      }
      any.oninput = () => { const c = parseColor(any.value); any.classList.toggle('bad', !!any.value.trim() && !c); if (c) set(c, 'any'); };
      pick.oninput = () => set({ ...parseColor(pick.value), a: cur.a }, 'pick');
      function set(c, from) {
        cur = c; const f = formats(c);
        for (const k in F) if (k !== from) { F[k].value = f[k]; F[k].classList.remove('bad'); }
        if (from !== 'pick') pick.value = f.hex.slice(0, 7);
        sw.style.background = `linear-gradient(${f.rgb},${f.rgb}),repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/14px 14px`;
        const cw = contrast(c, { r: 255, g: 255, b: 255 }), cb = contrast(c, { r: 0, g: 0, b: 0 });
        sw.style.color = cb > cw ? '#000' : '#fff'; sw.textContent = f.hex.toUpperCase();
        info.innerHTML = `Contrast with white <b>${cw.toFixed(2)}:1</b>${cw >= 4.5 ? ' ✓ AA' : ''} · with black <b>${cb.toFixed(2)}:1</b>${cb >= 4.5 ? ' ✓ AA' : ''}`;
        shades.innerHTML = '';
        const [h, s, l] = rgbToHsl(c.r, c.g, c.b);
        for (const L of [15, 30, 45, 60, 75, 90]) { const [r, g, b] = hslToRgb(h, s, L), hx = '#' + hex2(r) + hex2(g) + hex2(b), bt = el('button'); bt.type = 'button'; bt.title = hx; bt.style.background = hx; bt.setAttribute('aria-label', 'Use ' + hx); bt.onclick = () => set({ r, g, b, a: 1 }, null); shades.append(bt); }
        return f;
      }
      set(cur, null);
      return { input(s) { any.value = s; any.oninput(); return formats(cur); }, setField(k, v) { F[k].value = v; F[k].oninput(); return formats(cur); }, get values() { return formats(cur); } };
    }
  });
  alias('hex-to-rgb', 'color'); alias('rgb-to-hex', 'color');

  /* 20 ─ Unit converter */
  const UNITS = {
    length: { name: 'Length', base: 'm', units: [['mm', 'Millimetre', 1e-3], ['cm', 'Centimetre', 1e-2], ['m', 'Metre', 1], ['km', 'Kilometre', 1e3], ['in', 'Inch', 0.0254], ['ft', 'Foot', 0.3048], ['yd', 'Yard', 0.9144], ['mi', 'Mile', 1609.344], ['nmi', 'Nautical mile', 1852], ['um', 'Micrometre', 1e-6], ['ly', 'Light-year', 9460730472580800]] },
    mass: { name: 'Mass', units: [['mg', 'Milligram', 1e-6], ['g', 'Gram', 1e-3], ['kg', 'Kilogram', 1], ['t', 'Tonne', 1000], ['oz', 'Ounce', 0.028349523125], ['lb', 'Pound', 0.45359237], ['st', 'Stone', 6.35029318], ['ust', 'US ton', 907.18474], ['ukt', 'Imperial ton', 1016.0469088], ['ct', 'Carat', 2e-4]] },
    temperature: { name: 'Temperature', units: [['C', 'Celsius °C'], ['F', 'Fahrenheit °F'], ['K', 'Kelvin K'], ['R', 'Rankine °R']] },
    volume: { name: 'Volume', units: [['ml', 'Millilitre', 1e-6], ['l', 'Litre', 1e-3], ['m3', 'Cubic metre', 1], ['tsp', 'US teaspoon', 4.92892159375e-6], ['tbsp', 'US tablespoon', 1.478676478125e-5], ['floz', 'US fluid ounce', 2.95735295625e-5], ['cup', 'US cup', 2.365882365e-4], ['pt', 'US pint', 4.73176473e-4], ['qt', 'US quart', 9.46352946e-4], ['gal', 'US gallon', 3.785411784e-3], ['ukfloz', 'Imperial fl oz', 2.84130625e-5], ['ukpt', 'Imperial pint', 5.6826125e-4], ['ukgal', 'Imperial gallon', 4.54609e-3], ['cm3', 'Cubic centimetre', 1e-6], ['in3', 'Cubic inch', 1.6387064e-5], ['ft3', 'Cubic foot', 0.028316846592]] },
    area: { name: 'Area', units: [['mm2', 'Square millimetre', 1e-6], ['cm2', 'Square centimetre', 1e-4], ['m2', 'Square metre', 1], ['ha', 'Hectare', 1e4], ['km2', 'Square kilometre', 1e6], ['in2', 'Square inch', 6.4516e-4], ['ft2', 'Square foot', 0.09290304], ['yd2', 'Square yard', 0.83612736], ['ac', 'Acre', 4046.8564224], ['mi2', 'Square mile', 2589988.110336]] },
    speed: { name: 'Speed', units: [['mps', 'Metres per second', 1], ['kph', 'Kilometres per hour', 1 / 3.6], ['mph', 'Miles per hour', 0.44704], ['kn', 'Knot', 1852 / 3600], ['fps', 'Feet per second', 0.3048], ['mach', 'Mach (sea level)', 340.29], ['c', 'Speed of light', 299792458]] },
    data: { name: 'Data size', units: [['b', 'Bit', 0.125], ['B', 'Byte', 1], ['kB', 'Kilobyte (1000)', 1e3], ['MB', 'Megabyte (1000²)', 1e6], ['GB', 'Gigabyte (1000³)', 1e9], ['TB', 'Terabyte (1000⁴)', 1e12], ['PB', 'Petabyte', 1e15], ['KiB', 'Kibibyte (1024)', 1024], ['MiB', 'Mebibyte (1024²)', 1048576], ['GiB', 'Gibibyte (1024³)', 1073741824], ['TiB', 'Tebibyte (1024⁴)', 1099511627776], ['kbit', 'Kilobit', 125], ['Mbit', 'Megabit', 125000], ['Gbit', 'Gigabit', 1.25e8]] },
    time: { name: 'Time', units: [['ns', 'Nanosecond', 1e-9], ['us', 'Microsecond', 1e-6], ['ms', 'Millisecond', 1e-3], ['s', 'Second', 1], ['min', 'Minute', 60], ['h', 'Hour', 3600], ['d', 'Day', 86400], ['wk', 'Week', 604800], ['mo', 'Month (avg)', 2629746], ['yr', 'Year (365.2425 d)', 31556952], ['dec', 'Decade', 315569520], ['cen', 'Century', 3155695200]] }
  };
  const toK = { C: v => v + 273.15, F: v => (v - 32) * 5 / 9 + 273.15, K: v => v, R: v => v * 5 / 9 };
  const fromK = { C: v => v - 273.15, F: v => (v - 273.15) * 9 / 5 + 32, K: v => v, R: v => v * 9 / 5 };
  function convertUnit(cat, v, from, to) {
    if (cat === 'temperature') return fromK[to](toK[from](v));
    const u = UNITS[cat].units, f = u.find(x => x[0] === from)[2], t = u.find(x => x[0] === to)[2];
    return v * f / t;
  }
  const fmtNum = v => { if (!isFinite(v)) return '—'; if (v === 0) return '0'; const a = Math.abs(v); if (a >= 1e15 || a < 1e-6) return v.toExponential(8).replace(/\.?0+e/, 'e'); return String(parseFloat(v.toPrecision(12))); };
  register({
    id: 'units', cat: 'calc', glyph: 'units', name: 'Unit converter', keywords: 'unit convert length mass weight temperature volume area speed data size bytes time metric imperial',
    desc: 'Length, mass, temperature, volume, area, speed, data size and time, live.',
    render(root, preset) {
      let cat = (preset && preset.cat) || 'length';
      const tabs = el('div', 'cattabs'), box = el('div', 'units'); root.append(tabs, box);
      const row = el('div', 'unitrow'), val = el('input'); val.type = 'number'; val.step = 'any'; val.value = '1'; val.setAttribute('aria-label', 'Value');
      const from = el('select'); from.setAttribute('aria-label', 'From unit');
      row.append(val, from); const table = el('table', 'utable'); box.append(row, table, el('p', 'dim', 'Click a row to copy its value.'));
      for (const k in UNITS) { const b = el('button', null, UNITS[k].name); b.type = 'button'; b.dataset.k = k; b.onclick = () => setCat(k); tabs.append(b); }
      function setCat(k) {
        cat = k; [...tabs.children].forEach(b => b.classList.toggle('on', b.dataset.k === k));
        from.innerHTML = UNITS[k].units.map(u => `<option value="${u[0]}">${esc(u[1])}</option>`).join('');
        from.value = { length: 'm', mass: 'kg', temperature: 'C', volume: 'l', area: 'm2', speed: 'kph', data: 'MB', time: 'h' }[k];
        if (k === 'temperature') val.value = '20'; update();
      }
      function update() {
        const v = parseFloat(val.value); table.innerHTML = '';
        for (const [id, name] of UNITS[cat].units) {
          const r = isFinite(v) ? convertUnit(cat, v, from.value, id) : NaN, tr = el('tr', id === from.value ? 'cur' : '');
          const s = fmtNum(r); tr.innerHTML = `<td>${esc(name)}</td><td class="v">${esc(s)}</td>`; tr.title = 'Copy ' + s; tr.style.cursor = 'pointer'; tr.onclick = () => U.copyText(s);
          table.append(tr);
        }
      }
      val.oninput = update; from.onchange = update; setCat(cat);
      return { set(k, v, f) { setCat(k); val.value = v; from.value = f; update(); return Object.fromEntries([...table.rows].map((r, i) => [UNITS[k].units[i][0], r.cells[1].textContent])); } };
    }
  });

  /* Number base converter (BigInt, any size) */
  const DIG = '0123456789abcdefghijklmnopqrstuvwxyz';
  function parseBase(s, base) {
    s = s.trim().toLowerCase().replace(/[\s_,']/g, ''); let neg = false;
    if (s.startsWith('-')) { neg = true; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
    const pre = { '0x': 16, '0b': 2, '0o': 8 }[s.slice(0, 2)]; if (pre && (pre === base || base === 'auto')) { base = pre; s = s.slice(2); }
    if (base === 'auto') base = 10;
    if (!s) throw new Error('Enter a number');
    if (s.length > 10000) throw new Error('Number is too long (over 10 000 digits)');
    let v = 0n; const B = BigInt(base);
    for (const ch of s) { const d = DIG.indexOf(ch); if (d < 0 || d >= base) throw new Error(`“${ch}” isn’t a valid digit in base ${base}`); v = v * B + BigInt(d); }
    return { v: neg ? -v : v, base };
  }
  const group = (s, n, sep) => s.replace(new RegExp(`\\B(?=(.{${n}})+$)`, 'g'), sep);
  register({
    id: 'number-base', cat: 'calc', glyph: 'num', name: 'Number base converter', keywords: 'binary octal decimal hex hexadecimal base convert radix bigint',
    desc: 'Binary, octal, decimal, hex or any base 2–36, with numbers of any size.',
    render(root) {
      const box = el('div', 'units'); root.append(box);
      const row = el('div', 'unitrow'), inp = el('input'); inp.type = 'text'; inp.value = '255'; inp.style.cssText = 'flex:1;min-width:200px;font:16px var(--mono)'; inp.setAttribute('aria-label', 'Number');
      const base = el('select'); base.innerHTML = [['auto', 'Auto (0x, 0b, 0o prefixes)'], [2, 'Binary (2)'], [8, 'Octal (8)'], [10, 'Decimal (10)'], [16, 'Hexadecimal (16)'], ...Array.from({ length: 35 }, (_, i) => i + 2).filter(b => ![2, 8, 10, 16].includes(b)).map(b => [b, 'Base ' + b])].map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
      base.setAttribute('aria-label', 'Input base');
      const grp = el('label'); const gcb = el('input'); gcb.type = 'checkbox'; gcb.checked = true; grp.append(gcb, document.createTextNode(' Group digits')); grp.style.cssText = 'display:inline-flex;gap:6px;align-items:center';
      row.append(inp, base, grp);
      const custom = el('input'); custom.type = 'number'; custom.min = 2; custom.max = 36; custom.value = 36; custom.style.width = '70px';
      const table = el('table', 'utable'), status = el('p', 'dim'); box.append(row, table, status);
      function update() {
        table.innerHTML = ''; status.textContent = ''; status.style.color = '';
        let r; try { r = parseBase(inp.value, base.value === 'auto' ? 'auto' : +base.value); } catch (e) { status.textContent = e.message; status.style.color = '#a3361c'; return null; }
        const neg = r.v < 0n, a = neg ? -r.v : r.v, out = {};
        const rows = [['Binary', 2, 4, ' '], ['Octal', 8, 3, ' '], ['Decimal', 10, 3, ','], ['Hexadecimal', 16, 4, ' '], ['custom', +custom.value || 36, 0, '']];
        for (const [name, b, g, sep] of rows) {
          let s = a.toString(b); if (b === 16) s = s.toUpperCase(); if (gcb.checked && g) s = group(s, g, sep); s = (neg ? '-' : '') + s; out[b] = s.replace(/[ ,]/g, '');
          const tr = el('tr'), td1 = el('td'), td2 = el('td', 'v'); td2.textContent = s;
          if (name === 'custom') { td1.append(document.createTextNode('Base '), custom); } else td1.textContent = `${name} (${b})`;
          const td3 = el('td'); td3.append(copyBtn(() => td2.textContent.replace(/[ ,]/g, ''))); tr.append(td1, td2, td3); table.append(tr);
        }
        const bits = a.toString(2).length;
        status.textContent = `Read as base ${r.base} · ${bits} bit${bits > 1 ? 's' : ''}${bits <= 64 && !neg ? ` · fits in ${bits <= 8 ? 8 : bits <= 16 ? 16 : bits <= 32 ? 32 : 64}-bit unsigned` : ''}`;
        return out;
      }
      inp.oninput = base.onchange = gcb.onchange = custom.oninput = update; update();
      return { input(s, b) { inp.value = s; base.value = String(b ?? 'auto'); return update(); } };
    }
  });
  alias('hex-to-decimal', 'number-base'); alias('binary-to-decimal', 'number-base');

  /* Roman numerals */
  const ROM = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  const toRoman = n => { if (!Number.isInteger(n) || n < 1 || n > 3999) throw new Error('Roman numerals go from 1 to 3999'); let s = ''; for (const [v, r] of ROM) while (n >= v) { s += r; n -= v; } return s; };
  function fromRoman(s) {
    s = s.trim().toUpperCase(); if (!/^[MDCLXVI]+$/.test(s)) throw new Error('Use only the letters I, V, X, L, C, D and M');
    const val = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }; let t = 0;
    for (let i = 0; i < s.length; i++) { const a = val[s[i]], b = val[s[i + 1]] || 0; t += a < b ? -a : a; }
    return { n: t, canonical: t >= 1 && t <= 3999 ? toRoman(t) : null };
  }
  register({
    id: 'roman', cat: 'calc', glyph: 'roman', name: 'Roman numerals', keywords: 'roman numerals number convert year mmxxvi',
    desc: 'Numbers to Roman numerals and back (1–3999), with validation.',
    render(root) {
      const box = el('div', 'units'); root.append(box);
      const inp = el('input'); inp.type = 'text'; inp.value = '2026'; inp.style.cssText = 'width:100%;max-width:420px;font-size:22px;padding:6px 10px'; inp.setAttribute('aria-label', 'Number or Roman numeral');
      const out = el('div'); out.style.cssText = 'font:600 34px var(--font);color:var(--navy);margin:14px 0 4px;word-break:break-all';
      const note = el('p', 'dim'); const row = el('div', 'actions');
      row.append(copyBtn(() => out.textContent));
      box.append(el('p', 'dim', 'Type a number (like 1987) or a Roman numeral (like MCMLXXXVII).'), inp, out, note, row);
      function update() {
        const s = inp.value.trim(); note.style.color = ''; note.textContent = '';
        if (!s) { out.textContent = ''; return ''; }
        try {
          if (/^\d+$/.test(s.replace(/[,\s]/g, ''))) { const n = +s.replace(/[,\s]/g, ''); out.textContent = toRoman(n); note.textContent = `${n.toLocaleString()} in Roman numerals`; }
          else { const r = fromRoman(s); out.textContent = String(r.n); note.textContent = r.canonical === s.toUpperCase() ? `${s.toUpperCase()} is ${r.n}` : r.canonical ? `Read as ${r.n}; the standard form is ${r.canonical}` : `Read as ${r.n} (outside the standard 1–3999 range)`; }
        } catch (e) { out.textContent = ''; note.textContent = e.message; note.style.color = '#a3361c'; }
        return out.textContent;
      }
      inp.oninput = update; update();
      return { input(s) { inp.value = s; update(); return { out: out.textContent, note: note.textContent }; } };
    }
  });

  /* time zone helpers (Intl only) */
  const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch (e) { return ['UTC', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Asia/Kolkata', 'Australia/Sydney']; } })();
  // Chromium lists some zones under their old CLDR names (Asia/Calcutta, Europe/Kiev); add the current IANA names too
  for (const z of ['UTC', 'Asia/Kolkata', 'Asia/Kathmandu', 'Europe/Kyiv', 'Asia/Ho_Chi_Minh', 'America/Argentina/Buenos_Aires', 'Asia/Yangon', 'Atlantic/Faroe', 'Pacific/Kanton']) {
    if (ZONES.includes(z)) continue; try { new Intl.DateTimeFormat('en', { timeZone: z }); ZONES.push(z); } catch (e) { /* not known to this browser */ }
  }
  ZONES.sort((a, b) => a === 'UTC' ? -1 : b === 'UTC' ? 1 : a.localeCompare(b));
  const LOCAL = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const dtf = {};
  function partsIn(ms, tz) {
    const f = dtf[tz] || (dtf[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' }));
    const p = {}; for (const x of f.formatToParts(new Date(ms))) p[x.type] = x.value; return p;
  }
  const offsetMin = (ms, tz) => { const p = partsIn(ms, tz); const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second); return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000); };
  function zonedToUtc(y, mo, d, h, mi, s, tz) { const guess = Date.UTC(y, mo - 1, d, h, mi, s); let ms = guess - offsetMin(guess, tz) * 60000; ms = guess - offsetMin(ms, tz) * 60000; return ms; }
  const fmtOff = m => `UTC${m < 0 ? '−' : '+'}${String(Math.floor(Math.abs(m) / 60)).padStart(2, '0')}:${String(Math.abs(m) % 60).padStart(2, '0')}`;
  const fmtIn = (ms, tz) => { const p = partsIn(ms, tz); return `${p.weekday} ${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`; };
  const zoneSelect = val => { const s = el('select'); s.innerHTML = ZONES.map(z => `<option value="${esc(z)}">${esc(z.replace(/_/g, ' '))}</option>`).join(''); s.value = val; return s; };
  function relative(ms) { const d = (ms - Date.now()) / 1000, a = Math.abs(d); const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' }); for (const [u, s] of [['year', 31556952], ['month', 2629746], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60], ['second', 1]]) if (a >= s || u === 'second') return rtf.format(Math.round(d / s), u); }

  /* Unix timestamp ⇄ date */
  register({
    id: 'timestamp', cat: 'calc', glyph: 'clock', name: 'Unix timestamp ⇄ date', keywords: 'unix epoch timestamp date time convert seconds milliseconds iso 8601 utc',
    desc: 'Epoch seconds or milliseconds to readable dates in any time zone, and back.',
    render(root) {
      const box = el('div', 'units'); root.append(box);
      const r1 = el('div', 'unitrow'), ts = el('input'); ts.type = 'text'; ts.style.cssText = 'width:220px;font:16px var(--mono)'; ts.setAttribute('aria-label', 'Timestamp');
      const unit = el('select'); unit.innerHTML = '<option value="auto">Auto-detect unit</option><option value="s">Seconds</option><option value="ms">Milliseconds</option><option value="us">Microseconds</option><option value="ns">Nanoseconds</option>';
      const tz = zoneSelect(LOCAL); tz.setAttribute('aria-label', 'Time zone'); const now = el('button', 'go', 'Now'); now.type = 'button';
      r1.append(ts, unit, tz, now);
      const table = el('table', 'utable');
      const r2 = el('div', 'unitrow'), dt = el('input'); dt.type = 'datetime-local'; dt.step = 1; dt.setAttribute('aria-label', 'Date and time');
      r2.append(el('b', null, 'Date → timestamp:'), dt, el('span', 'dim', 'in the time zone above'));
      const table2 = el('table', 'utable');
      box.append(el('div', 'ph', '<span class="phi"></span>Timestamp → date'), r1, table, el('div', 'ph', '<span class="phi"></span>Date → timestamp'), r2, table2);
      const row = (t, k, v) => { const tr = el('tr'); tr.innerHTML = `<td>${esc(k)}</td><td class="v">${esc(v)}</td>`; const td = el('td'); td.append(copyBtn(() => v)); tr.append(td); t.append(tr); };
      let lastMs = null;
      function update() {
        table.innerHTML = ''; const s = ts.value.trim().replace(/[_,\s]/g, '');
        if (!/^-?\d+(\.\d+)?$/.test(s)) { if (s) row(table, 'Error', 'Enter a number such as 1767225600'); return null; }
        const n = +s, a = Math.abs(n); let u = unit.value;
        if (u === 'auto') u = a < 1e11 ? 's' : a < 1e14 ? 'ms' : a < 1e17 ? 'us' : 'ns';
        const ms = n * { s: 1000, ms: 1, us: 1e-3, ns: 1e-6 }[u]; if (!isFinite(ms) || Math.abs(ms) > 8.64e15) { row(table, 'Error', 'Out of range'); return null; }
        lastMs = ms; const d = new Date(ms), z = tz.value, off = offsetMin(ms, z);
        row(table, 'Read as', { s: 'seconds', ms: 'milliseconds', us: 'microseconds', ns: 'nanoseconds' }[u]);
        row(table, 'UTC (ISO 8601)', d.toISOString());
        row(table, `${z.replace(/_/g, ' ')} (${fmtOff(off)})`, fmtIn(ms, z));
        row(table, 'RFC 2822 / HTTP', d.toUTCString());
        row(table, 'Relative', relative(ms));
        row(table, 'Seconds', String(Math.floor(ms / 1000))); row(table, 'Milliseconds', String(Math.round(ms)));
        return { iso: d.toISOString(), local: fmtIn(ms, z) };
      }
      function update2() {
        table2.innerHTML = ''; const m = dt.value.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d))?/); if (!m) return null;
        const ms = zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), tz.value);
        row(table2, 'Seconds', String(Math.floor(ms / 1000))); row(table2, 'Milliseconds', String(ms)); row(table2, 'UTC (ISO 8601)', new Date(ms).toISOString());
        return ms;
      }
      const setNow = () => { const ms = Date.now(); ts.value = String(Math.floor(ms / 1000)); const p = partsIn(ms, tz.value); dt.value = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`; update(); update2(); };
      ts.oninput = unit.onchange = update; dt.oninput = update2; tz.onchange = () => { update(); update2(); }; now.onclick = setNow; setNow();
      return { input(s, u, z) { ts.value = s; unit.value = u || 'auto'; if (z) tz.value = z; return update(); }, date(v, z) { if (z) tz.value = z; dt.value = v; return update2(); } };
    }
  });
  alias('epoch', 'timestamp');

  /* Time zone converter */
  register({
    id: 'timezone', cat: 'calc', glyph: 'globe', name: 'Time zone converter', keywords: 'time zone timezone convert meeting world clock utc gmt est pst cet ist jst',
    desc: 'See a date and time in several time zones at once (daylight saving aware).',
    render(root) {
      const box = el('div', 'units'); root.append(box);
      const r1 = el('div', 'unitrow'), dt = el('input'); dt.type = 'datetime-local'; dt.setAttribute('aria-label', 'Date and time');
      const from = zoneSelect(LOCAL); from.setAttribute('aria-label', 'From time zone'); const now = el('button', null, 'Now'); now.type = 'button';
      r1.append(dt, el('span', null, 'in'), from, now);
      const table = el('table', 'utable');
      const r2 = el('div', 'unitrow'), add = zoneSelect('Asia/Singapore'), addB = el('button', 'go', 'Add zone'); addB.type = 'button'; add.setAttribute('aria-label', 'Zone to add');
      r2.append(add, addB);
      box.append(r1, table, r2);
      let zones = [...new Set(['UTC', LOCAL, 'America/Los_Angeles', 'America/New_York', 'Europe/London', 'Europe/Berlin', 'Asia/Kolkata', 'Asia/Tokyo', 'Australia/Sydney'].filter(z => ZONES.includes(z)))];
      function update() {
        table.innerHTML = ''; const m = dt.value.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/); if (!m) return null;
        const ms = zonedToUtc(+m[1], +m[2], +m[3], +m[4], +m[5], 0, from.value), base = m[1] + m[2] + m[3], res = {};
        for (const z of zones) {
          const p = partsIn(ms, z), day = p.year + p.month + p.day, diff = day > base ? ' (next day)' : day < base ? ' (previous day)' : '';
          const tr = el('tr', z === from.value ? 'cur' : ''), v = `${p.weekday} ${p.day}/${p.month} ${p.hour}:${p.minute}`;
          res[z] = `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
          tr.innerHTML = `<td>${esc(z.replace(/_/g, ' '))} <span class="dim">${fmtOff(offsetMin(ms, z))}</span></td><td class="v">${esc(v + diff)}</td>`;
          const td = el('td'), x = el('button', 'mini', '✕'); x.type = 'button'; x.title = 'Remove'; x.onclick = () => { zones = zones.filter(q => q !== z); update(); }; td.append(x); tr.append(td); table.append(tr);
        }
        return res;
      }
      const setNow = () => { const p = partsIn(Date.now(), from.value); dt.value = `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; update(); };
      dt.oninput = from.onchange = update; now.onclick = setNow; addB.onclick = () => { if (!zones.includes(add.value)) zones.push(add.value); update(); };
      setNow();
      return { set(v, z, list) { dt.value = v; from.value = z; if (list) zones = list; return update(); } };
    }
  });

  LC.calcInternals = { parseColor, formats, convertUnit, parseBase, toRoman, fromRoman, zonedToUtc, offsetMin };
})();
