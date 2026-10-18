'use strict';
/* Lumen Sheets — number formats (Excel format codes), serial dates and typed-input parsing.
   Works in the browser (window.SheetFormat) and in Node (module.exports). */
(function (root) {
  const MS_DAY = 86400000, EPOCH = Date.UTC(1899, 11, 30);
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  /* ---------- serial dates (1900 system incl. the Lotus 29-Feb-1900 bug) ---------- */
  function dateToSerial(y, m, d) {
    const t = Date.UTC(y, m - 1, 1) + (d - 1) * MS_DAY;
    let days = Math.round((t - EPOCH) / MS_DAY);
    if (days <= 60) days -= 1;
    return days;
  }
  function serialToParts(serial) {
    let s = Math.floor(serial), frac = serial - s;
    let y, m, d, dow;
    if (s === 60) { y = 1900; m = 2; d = 29; dow = 3; }
    else {
      const t = EPOCH + (s < 60 ? s + 1 : s) * MS_DAY, dt = new Date(t);
      y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate(); dow = dt.getUTCDay();
      if (s === 0) { y = 1900; m = 1; d = 0; dow = 6; }
    }
    let ms = Math.round(frac * MS_DAY);
    if (ms >= MS_DAY) ms = MS_DAY - 1;
    const H = Math.floor(ms / 3600000), M = Math.floor(ms % 3600000 / 60000), S = Math.floor(ms % 60000 / 1000);
    return { y, m, d, dow, H, M, S, ms: ms % 1000, frac };
  }
  function nowSerial(date = new Date()) {
    return dateToSerial(date.getFullYear(), date.getMonth() + 1, date.getDate()) + (date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds() + date.getMilliseconds() / 1000) / 86400;
  }

  /* ---------- General format ---------- */
  function general(v) {
    if (typeof v !== 'number') return String(v);
    if (!isFinite(v)) return '#NUM!';
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e11 || a < 1e-9) {
      let s = v.toExponential(5).replace(/\.?0+e/, 'e');
      return s.replace(/e([+-])(\d)$/, 'E$10$2').replace('e', 'E');
    }
    let s = String(parseFloat(v.toPrecision(a >= 1 ? 11 : 10)));
    if (s.length > 11 && s.includes('.')) {
      const intLen = String(Math.trunc(a)).length + (v < 0 ? 1 : 0);
      const dec = Math.max(0, 10 - intLen);
      s = String(parseFloat(v.toFixed(dec)));
    }
    if (/e/.test(s)) s = v.toFixed(10).replace(/\.?0+$/, '');
    return s;
  }
  // number → text the way Excel concatenates it (15 significant digits)
  function numToText(v) {
    if (Number.isInteger(v) && Math.abs(v) < 1e21) return String(v);
    let s = String(parseFloat(v.toPrecision(15)));
    if (/e/.test(s)) s = s.replace(/e\+?/, 'E+').replace('E+-', 'E-');
    return s;
  }

  /* ---------- format code compiler ---------- */
  const COLORS = { black: '#000000', blue: '#0000ff', cyan: '#00ffff', green: '#008000', magenta: '#ff00ff', red: '#ff0000', white: '#ffffff', yellow: '#ffff00' };
  const cache = new Map();
  function splitSections(code) {
    const out = []; let cur = '', q = false, br = false;
    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      if (q) { cur += ch; if (ch === '"') q = false; continue; }
      if (ch === '\\') { cur += ch + (code[i + 1] ?? ''); i++; continue; }
      if (ch === '"') q = true;
      if (ch === '[') br = true; else if (ch === ']') br = false;
      if (ch === ';' && !br) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur); return out;
  }
  function tokenizeSection(src) {
    const toks = []; let color = null, cond = null, i = 0;
    const lit = t => { const last = toks[toks.length - 1]; if (last && last.t === 'lit') last.v += t; else toks.push({ t: 'lit', v: t }); };
    while (i < src.length) {
      const ch = src[i], rest = src.slice(i);
      if (ch === '"') { const j = src.indexOf('"', i + 1); lit(src.slice(i + 1, j < 0 ? src.length : j)); i = j < 0 ? src.length : j + 1; continue; }
      if (ch === '\\') { lit(src[i + 1] ?? ''); i += 2; continue; }
      if (ch === '_') { lit(' '); i += 2; continue; }
      if (ch === '*') { i += 2; continue; }
      if (ch === '[') {
        const j = src.indexOf(']', i), inner = src.slice(i + 1, j < 0 ? src.length : j); i = j < 0 ? src.length : j + 1;
        const lo = inner.toLowerCase();
        if (COLORS[lo]) color = COLORS[lo];
        else if (/^color\s*\d+$/.test(lo)) color = '#000000';
        else if (/^(<=|>=|<>|<|>|=)\s*-?[\d.]+$/.test(inner)) { const m = inner.match(/^(<=|>=|<>|<|>|=)\s*(-?[\d.]+)$/); cond = { op: m[1], v: parseFloat(m[2]) }; }
        else if (/^h+$|^m+$|^s+$/i.test(inner)) toks.push({ t: 'elapsed', v: lo[0], n: inner.length });
        else if (inner[0] === '$') { const sym = inner.slice(1).split('-')[0]; lit(sym); }
        continue;
      }
      let m;
      if ((m = rest.match(/^(am\/pm|a\/p)/i))) { toks.push({ t: 'ampm', v: m[1] }); i += m[1].length; continue; }
      if ((m = rest.match(/^(y+|m+|d+|h+|s+)/i))) { toks.push({ t: 'date', v: m[1].toLowerCase()[0], n: m[1].length }); i += m[1].length; continue; }
      if (ch === '0' || ch === '#' || ch === '?') { toks.push({ t: 'dig', v: ch }); i++; continue; }
      if (ch === '.') { toks.push({ t: 'point' }); i++; continue; }
      if (ch === ',') { toks.push({ t: 'comma' }); i++; continue; }
      if (ch === '%') { toks.push({ t: 'pct' }); i++; continue; }
      if ((m = rest.match(/^[eE]([+-])/))) { toks.push({ t: 'exp', v: m[1] }); i += 2; continue; }
      if (ch === '/') { toks.push({ t: 'slash' }); i++; continue; }
      if (ch === '@') { toks.push({ t: 'at' }); i++; continue; }
      lit(ch); i++;
    }
    return { toks, color, cond };
  }
  function compileSection(src) {
    if (/^\s*general\s*$/i.test(src)) return { kind: 'general', toks: [], color: null, cond: null };
    const sec = tokenizeSection(src.replace(/general/i, '0.##########'));
    const { toks } = sec;
    // minutes vs months: 'm' right after an hour token or right before a seconds token is minutes
    const dts = toks.filter(t => t.t === 'date' || t.t === 'elapsed');
    dts.forEach((t, k) => {
      if (t.t !== 'date' || t.v !== 'm') return;
      const prev = dts[k - 1], next = dts[k + 1];
      if ((prev && (prev.v === 'h')) || (next && next.v === 's')) t.v = 'M';
    });
    // fractional seconds: point followed by zeros after a seconds token
    for (let k = 0; k < toks.length; k++) if (toks[k].t === 'point' && dts.length && toks[k - 1] && toks[k - 1].t === 'date' && toks[k - 1].v === 's') {
      let n = 0; while (toks[k + 1 + n] && toks[k + 1 + n].t === 'dig' && toks[k + 1 + n].v === '0') n++;
      toks.splice(k, 1 + n, { t: 'fsec', n });
    }
    sec.kind = dts.length ? 'date' : toks.some(t => t.t === 'at') ? 'text' : 'number';
    if (sec.kind === 'date') { sec.ampm = toks.some(t => t.t === 'ampm'); toks.forEach(t => { if (t.t === 'dig' || t.t === 'comma' || t.t === 'pct') { t.v = t.t === 'comma' ? ',' : t.t === 'pct' ? '%' : t.v; t.t = 'lit'; } }); }
    if (sec.kind === 'number') analyseNumber(sec);
    return sec;
  }
  function analyseNumber(sec) {
    const toks = sec.toks;
    // percent and scaling commas
    sec.pct = toks.filter(t => t.t === 'pct').length;
    const digIdx = toks.map((t, k) => t.t === 'dig' ? k : -1).filter(k => k >= 0);
    const firstDig = digIdx[0] ?? -1, lastDig = digIdx[digIdx.length - 1] ?? -1;
    const pointIdx = toks.findIndex(t => t.t === 'point');
    const expIdx = toks.findIndex(t => t.t === 'exp');
    const slashIdx = toks.findIndex(t => t.t === 'slash');
    sec.scale = 0; sec.group = false;
    toks.forEach((t, k) => {
      if (t.t !== 'comma') return;
      const intEnd = pointIdx >= 0 ? pointIdx : (expIdx >= 0 ? expIdx : lastDig + 1);
      if (k > firstDig && k < intEnd && toks.slice(k + 1, intEnd).some(x => x.t === 'dig')) { sec.group = true; t.t = 'skip'; }
      else if (k > firstDig && (k >= intEnd || !toks.slice(k + 1, intEnd).some(x => x.t === 'dig')) && firstDig >= 0) { sec.scale++; t.t = 'skip'; }
      else { t.t = 'lit'; t.v = ','; }
    });
    if (slashIdx >= 0 && firstDig >= 0 && firstDig < slashIdx) {
      sec.frac = true;
      // denominator: digits (or a fixed number) after the slash
      let k = slashIdx + 1, den = '';
      while (toks[k] && (toks[k].t === 'dig' || (toks[k].t === 'lit' && /^\d+$/.test(toks[k].v)))) { den += toks[k].v; k++; }
      sec.denFixed = /^\d+$/.test(den) ? parseInt(den, 10) : 0;
      sec.denDigits = den.length || 1;
      // numerator digits: contiguous dig run before slash
      let j = slashIdx - 1; while (j >= 0 && toks[j].t === 'dig') j--;
      sec.numStart = j + 1; sec.denEnd = k;
      // integer part: any digit tokens before numStart (separated by a literal, usually a space)
      sec.hasInt = toks.slice(0, sec.numStart).some(t => t.t === 'dig');
    }
    sec.pointIdx = pointIdx; sec.expIdx = expIdx;
  }
  function compile(code) {
    let c = cache.get(code); if (c) return c;
    const secs = splitSections(code).map(compileSection);
    c = { secs, isDate: secs[0].kind === 'date' };
    cache.set(code, c); return c;
  }

  /* ---------- rendering ---------- */
  function pad(n, w) { let s = String(n); while (s.length < w) s = '0' + s; return s; }
  function renderDate(sec, v) {
    if (v < 0 || v > 2958465.99999) return { text: '#'.repeat(10) };
    const sv = sec.toks.some(t => t.t === 'fsec') ? v : Math.round(v * 86400) / 86400;
    const p = serialToParts(sv);
    let out = '';
    for (const t of sec.toks) {
      if (t.t === 'lit') out += t.v;
      else if (t.t === 'date') {
        const n = t.n;
        switch (t.v) {
          case 'y': out += n <= 2 ? pad(p.y % 100, 2) : pad(p.y, 4); break;
          case 'm': out += n === 1 ? p.m : n === 2 ? pad(p.m, 2) : n === 3 ? MONTHS[p.m - 1].slice(0, 3) : n === 5 ? MONTHS[p.m - 1][0] : MONTHS[p.m - 1]; break;
          case 'M': out += n === 1 ? p.M : pad(p.M, 2); break;
          case 'd': out += n === 1 ? p.d : n === 2 ? pad(p.d, 2) : n === 3 ? DAYS[p.dow].slice(0, 3) : DAYS[p.dow]; break;
          case 'h': { let h = p.H; if (sec.ampm) { h = h % 12; if (h === 0) h = 12; } out += n === 1 ? h : pad(h, 2); break; }
          case 's': out += n === 1 ? p.S : pad(p.S, 2); break;
        }
      } else if (t.t === 'elapsed') {
        const tot = v * 86400;
        const val = t.v === 'h' ? Math.floor(tot / 3600) : t.v === 'm' ? Math.floor(tot / 60) : Math.floor(tot);
        out += pad(val, t.n);
      } else if (t.t === 'fsec') { if (t.n) out += '.' + pad(Math.floor(p.ms / Math.pow(10, 3 - t.n)), t.n); }
      else if (t.t === 'ampm') { const pm = p.H >= 12; out += t.v.toLowerCase() === 'a/p' ? (pm ? 'P' : 'A') : (pm ? 'PM' : 'AM'); }
      else if (t.t === 'point') out += '.';
      else if (t.t === 'slash') out += '/';
      else if (t.v != null && t.t !== 'skip') out += t.v;
    }
    return { text: out };
  }
  function groupDigits(s) { return s.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function fillInt(places, digits, group) {
    // places: array of placeholder chars; digits: string of integer digits ('' for zero)
    const need0 = places.length;
    const out = new Array(places.length).fill('');
    let di = digits.length - 1;
    for (let k = places.length - 1; k >= 0; k--) {
      if (di >= 0) { out[k] = digits[di--]; }
      else out[k] = places[k] === '0' ? '0' : places[k] === '?' ? ' ' : '';
    }
    if (di >= 0 && places.length) out[0] = digits.slice(0, di + 1) + out[0];
    if (group) {
      // regroup the leading digit run
      const joined = out.join(''); const m = joined.match(/^(\s*)(\d+)$/);
      if (m) return [m[1] + groupDigits(m[2])];
    }
    void need0; return out;
  }
  function renderNumber(sec, v, signed) {
    const toks = sec.toks;
    let x = Math.abs(v) * Math.pow(100, sec.pct) / Math.pow(1000, sec.scale);
    const neg = signed && v < 0;
    if (sec.frac) return renderFraction(sec, x, neg);
    const digs = toks.filter(t => t.t === 'dig');
    const intPl = [], decPl = [], expPl = [];
    let part = 'int';
    for (const t of toks) {
      if (t.t === 'point' && part === 'int') part = 'dec';
      else if (t.t === 'exp') part = 'exp';
      else if (t.t === 'dig') (part === 'int' ? intPl : part === 'dec' ? decPl : expPl).push(t.v);
    }
    void digs;
    let expVal = 0;
    if (sec.expIdx >= 0 && x !== 0) {
      const ipl = Math.max(1, intPl.length);
      expVal = Math.floor(Math.log10(x));
      // engineering style when several int placeholders (e.g. ##0.0E+0)
      if (intPl.length > 1) expVal = Math.floor(expVal / ipl) * ipl;
      x = x / Math.pow(10, expVal);
      const r = +x.toFixed(decPl.length);
      if (r >= Math.pow(10, intPl.length > 1 ? ipl : 1)) { x /= intPl.length > 1 ? Math.pow(10, ipl) : 10; expVal += intPl.length > 1 ? ipl : 1; }
    }
    let fixed = x.toFixed(Math.min(decPl.length, 20));
    if (/e/.test(fixed)) fixed = BigInt(Math.round(x)).toString();
    let [ip, dp = ''] = fixed.split('.');
    if (ip === '0') ip = '';
    const intOut = fillInt(intPl, ip, sec.group);
    // decimals: trailing zeros removed for '#', spaced for '?'
    const decOut = decPl.map((p, k) => dp[k] || '0');
    for (let k = decPl.length - 1; k >= 0; k--) {
      if (decOut[k] !== '0') break;
      if (decPl[k] === '#') decOut[k] = ''; else if (decPl[k] === '?') decOut[k] = ' '; else break;
    }
    let es = String(Math.abs(expVal)); while (es.length < expPl.length) es = '0' + es;
    let out = '', ii = 0, di = 0; part = 'int';
    const isZero = !+fixed && expVal === 0;
    for (const t of toks) {
      if (t.t === 'lit') out += t.v;
      else if (t.t === 'pct') out += '%';
      else if (t.t === 'point') { if (part === 'int') { part = 'dec'; out += '.'; } }
      else if (t.t === 'exp') { part = 'exp'; out += 'E' + (expVal < 0 ? '-' : t.v === '+' ? '+' : ''); }
      else if (t.t === 'dig') {
        if (part === 'int') { if (ii < intOut.length) out += intOut[ii]; ii++; }
        else if (part === 'dec') out += decOut[di++] ?? '';
        else if (part === 'exp') { out += es; part = 'expdone'; }
      }
    }
    if (neg && !isZero) out = '-' + out;
    return { text: out };
  }
  function bestFrac(x, maxDen) {
    let bestN = 0, bestD = 1, bestE = Infinity;
    for (let d = 1; d <= maxDen; d++) { const n = Math.round(x * d), e = Math.abs(x - n / d); if (e < bestE - 1e-12) { bestE = e; bestN = n; bestD = d; } if (e < 1e-12) break; }
    return [bestN, bestD];
  }
  function renderFraction(sec, x, neg) {
    let ip = sec.hasInt ? Math.floor(x) : 0, f = x - ip;
    let n, d;
    if (sec.denFixed) { d = sec.denFixed; n = Math.round(f * d); }
    else[n, d] = bestFrac(f, Math.pow(10, sec.denDigits) - 1);
    if (n === d && sec.hasInt) { ip++; n = 0; }
    const toks = sec.toks;
    let out = '';
    const intToks = toks.slice(0, sec.numStart);
    const hasIntDigits = intToks.some(t => t.t === 'dig');
    let intDone = false;
    for (const t of intToks) {
      if (t.t === 'lit') { if (!(n === 0 && !ip)) out += t.v; else out += t.v.replace(/\S/g, ''); }
      else if (t.t === 'dig' && !intDone) { intDone = true; out += ip ? String(ip) : (n === 0 ? '0' : ''); }
    }
    void hasIntDigits;
    if (n === 0 && sec.hasInt) { out = out.replace(/\s+$/, ''); if (!ip) out = '0'; return { text: (neg ? '-' : '') + out }; }
    let ns = String(n), ds = String(d);
    const numDigs = toks.slice(sec.numStart).findIndex(t => t.t === 'slash');
    while (ns.length < numDigs) ns = ' ' + ns;
    if (!sec.denFixed) while (ds.length < sec.denDigits) ds = ds + ' ';
    out += ns + '/' + ds;
    for (const t of toks.slice(sec.denEnd)) if (t.t === 'lit') out += t.v; else if (t.t === 'pct') out += '%';
    return { text: (neg ? '-' : '') + out };
  }
  function condOK(c, v) {
    switch (c.op) { case '<': return v < c.v; case '>': return v > c.v; case '<=': return v <= c.v; case '>=': return v >= c.v; case '=': return v === c.v; case '<>': return v !== c.v; }
    return false;
  }
  // format(value, code) → {text, color}. value: number|string|boolean|null|{code} (error)
  function format(value, code) {
    if (value == null) return { text: '' };
    if (typeof value === 'object') return { text: value.code || String(value) };
    if (typeof value === 'boolean') return { text: value ? 'TRUE' : 'FALSE' };
    if (!code || /^general$/i.test(code)) return { text: typeof value === 'number' ? general(value) : String(value) };
    const c = compile(code), secs = c.secs;
    if (typeof value === 'string') {
      const ts = secs.length >= 4 ? secs[3] : secs.find(s => s.kind === 'text');
      if (!ts) return { text: value };
      let out = ''; for (const t of ts.toks) out += t.t === 'at' ? value : t.t === 'lit' ? t.v : '';
      return { text: out, color: ts.color };
    }
    if (!isFinite(value)) return { text: '#NUM!' };
    let sec, signed = true;
    const conds = secs.filter(s => s.cond);
    if (conds.length) {
      sec = secs.slice(0, 3).find(s => s.cond && condOK(s.cond, value));
      if (!sec) sec = secs.slice(0, 3).find(s => !s.cond) || secs[0];
      signed = !(sec.cond && sec.cond.op === '<' && value < 0 && secs.indexOf(sec) > 0) && !(sec !== secs[0] && value < 0);
      if (secs.indexOf(sec) > 0 && value < 0) signed = false;
    } else {
      const nonText = secs.filter(s => s.kind !== 'text' || secs.length === 1);
      if (value > 0 || nonText.length === 1) sec = nonText[0];
      else if (value < 0) { sec = nonText[1]; signed = false; }
      else sec = nonText[2] || nonText[0];
      if (!sec) sec = secs[0];
      if (sec === secs[0] && value < 0) signed = true;
    }
    let r;
    if (sec.kind === 'general') r = { text: signed ? general(value) : general(Math.abs(value)) };
    else if (sec.kind === 'date') r = renderDate(sec, value);
    else if (sec.kind === 'text') { let out = ''; for (const t of sec.toks) out += t.t === 'at' ? general(value) : t.t === 'lit' ? t.v : ''; r = { text: out }; }
    else r = renderNumber(sec, value, signed);
    r.color = sec.color;
    return r;
  }
  const isDateFormat = code => !!code && !/^general$/i.test(code) && compile(code).isDate;

  /* ---------- typed-input parsing ---------- */
  const MON3 = MONTHS.map(m => m.slice(0, 3).toLowerCase());
  const monthIdx = s => { const i = MON3.indexOf(s.slice(0, 3).toLowerCase()); return i < 0 || (s.length > 3 && !MONTHS[i].toLowerCase().startsWith(s.toLowerCase())) ? -1 : i + 1; };
  function parseTime(s) {
    const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(am|pm|a|p)?$/i);
    if (!m) return null;
    let h = +m[1]; const mi = +m[2], se = m[3] ? +m[3] : 0;
    if (m[4]) { if (h > 12) return null; const pm = /^p/i.test(m[4]); if (h === 12) h = 0; if (pm) h += 12; }
    if (mi > 59 || se >= 60) return null;
    return { v: (h * 3600 + mi * 60 + se) / 86400, fmt: m[4] ? (m[3] ? 'h:mm:ss AM/PM' : 'h:mm AM/PM') : (m[3] ? 'h:mm:ss' : 'h:mm'), long: h >= 24 };
  }
  function validDate(y, m, d) { return m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function fixYear(y, s) { return s.length <= 2 ? (y < 30 ? 2000 + y : 1900 + y) : y; }
  function parseDate(s) {
    let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) { const y = +m[1], mo = +m[2], d = +m[3]; return validDate(y, mo, d) ? { v: dateToSerial(y, mo, d), fmt: 'yyyy-mm-dd' } : null; }
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/))) { const y = fixYear(+m[3], m[3]), mo = +m[1], d = +m[2]; return validDate(y, mo, d) ? { v: dateToSerial(y, mo, d), fmt: 'm/d/yyyy' } : null; }
    if ((m = s.match(/^(\d{1,2})\/(\d{1,2})$/))) { const y = new Date().getFullYear(), mo = +m[1], d = +m[2]; return validDate(y, mo, d) ? { v: dateToSerial(y, mo, d), fmt: 'd-mmm' } : null; }
    if ((m = s.match(/^(\d{1,2})[- ]([a-z]{3,9})\.?[- ,]*(\d{2}|\d{4})?$/i))) { const mo = monthIdx(m[2]); if (mo < 0) return null; const y = m[3] ? fixYear(+m[3], m[3]) : new Date().getFullYear(), d = +m[1]; return validDate(y, mo, d) ? { v: dateToSerial(y, mo, d), fmt: m[3] ? 'd-mmm-yy' : 'd-mmm' } : null; }
    if ((m = s.match(/^([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/i))) { const mo = monthIdx(m[1]); if (mo < 0) return null; const y = +m[3], d = +m[2]; return validDate(y, mo, d) ? { v: dateToSerial(y, mo, d), fmt: 'mmm d, yyyy' } : null; }
    if ((m = s.match(/^([a-z]{3,9})[- ](\d{4})$/i))) { const mo = monthIdx(m[1]); if (mo < 0) return null; return { v: dateToSerial(+m[2], mo, 1), fmt: 'mmm-yy' }; }
    return null;
  }
  const NUM_RE = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
  // parseInput("12%") → {v:0.12, fmt:'0%'}; returns {v} with v a number/boolean/string; null for empty.
  function parseInput(raw) {
    if (raw == null) return { v: null };
    const s = String(raw).trim();
    if (s === '') return { v: null };
    if (/^true$/i.test(s)) return { v: true };
    if (/^false$/i.test(s)) return { v: false };
    let t = s, neg = false, cur = null, pct = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
    if (/^-/.test(t) && /^-\s*[$€£¥]/.test(t)) { neg = !neg; t = t.slice(1).trim(); }
    const cm = t.match(/^([$€£¥])\s*(.*)$/); if (cm) { cur = cm[1]; t = cm[2]; }
    if (/%$/.test(t)) { pct = true; t = t.slice(0, -1).trim(); }
    if (t !== '' && /\d/.test(t) && NUM_RE.test(t)) {
      let v = parseFloat(t.replace(/,/g, ''));
      if (neg) v = -v;
      if (pct) v /= 100;
      const decs = (t.split('.')[1] || '').replace(/[eE].*/, '').length;
      let fmt;
      if (pct) fmt = decs ? '0.' + '0'.repeat(Math.min(decs, 10)) + '%' : '0%';
      else if (cur) fmt = cur + '#,##0' + (decs ? '.00' : '') + (neg ? '' : '');
      else if (/,/.test(t)) fmt = '#,##0' + (decs ? '.' + '0'.repeat(Math.min(decs, 10)) : '');
      else if (/e/i.test(t)) fmt = '0.00E+00';
      if (cur && neg) fmt = cur + '#,##0' + (decs ? '.00' : '') + ';(' + cur + '#,##0' + (decs ? '.00' : '') + ')';
      return fmt ? { v, fmt } : { v };
    }
    if (cur || pct || neg) return { v: s };
    const tm = parseTime(s); if (tm) return tm;
    const dt = parseDate(s); if (dt) return dt;
    const dtm = s.match(/^(.+?)[ T](\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m?)?)$/i);
    if (dtm) { const d = parseDate(dtm[1]), t2 = parseTime(dtm[2]); if (d && t2) return { v: d.v + t2.v, fmt: (d.fmt === 'yyyy-mm-dd' ? 'yyyy-mm-dd' : 'm/d/yyyy') + ' h:mm' }; }
    return { v: s };
  }

  const API = { format, general, numToText, compile, isDateFormat, dateToSerial, serialToParts, nowSerial, parseInput, parseDate, parseTime, MONTHS, DAYS };
  if (typeof module !== 'undefined' && module.exports) module.exports = API; else root.SheetFormat = API;
})(typeof self !== 'undefined' ? self : this);
