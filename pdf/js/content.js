// Content-stream lexer and interpreter: tracks graphics + text state so text runs can be located
// (with exact byte offsets of their operators), measured with the font's real widths, decoded to
// Unicode and edited; also collects vector paths (lines, rectangles) for form-field detection.
const L = window.PDFLib;
const { PDFName, PDFDict, PDFArray, PDFRef, PDFNumber, PDFRawStream, PDFStream, PDFString, PDFHexString } = L;

/* ---------- bytes <-> latin1 strings ---------- */
export function bytesToStr(b) { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return s; }
export function strToBytes(s) { const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 255; return b; }

/* ---------- matrices: [a b c d e f], p' = p x M ---------- */
export const mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
export const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export const ID = [1, 0, 0, 1, 0, 0];
export function invert(m) { const det = m[0] * m[3] - m[1] * m[2] || 1e-12; return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det]; }

/* ---------- lexer ---------- */
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([40, 41, 60, 62, 91, 93, 123, 125, 47, 37]);
export class Name { constructor(n) { this.n = n; } toString() { return '/' + this.n; } }
export class Str { constructor(s, hex) { this.s = s; this.hex = hex; } } // s = raw byte string (latin1)

export function lex(src) {
  const ops = []; let i = 0; const n = src.length; let stack = [];
  const c = k => src.charCodeAt(k);
  const skipWs = () => { for (;;) { while (i < n && WS.has(c(i))) i++; if (i < n && c(i) === 37) { while (i < n && c(i) !== 10 && c(i) !== 13) i++; continue; } break; } };
  let opStart = -1;
  function readObj() {
    skipWs(); if (i >= n) return undefined;
    const ch = c(i);
    if (ch === 40) { // literal string
      i++; let depth = 1, out = '';
      while (i < n) {
        const x = src[i++];
        if (x === '\\') {
          const y = src[i++];
          if (y === 'n') out += '\n'; else if (y === 'r') out += '\r'; else if (y === 't') out += '\t'; else if (y === 'b') out += '\b'; else if (y === 'f') out += '\f';
          else if (y === '\r') { if (src[i] === '\n') i++; } else if (y === '\n') { /* line continuation */ }
          else if (y >= '0' && y <= '7') { let o = y; for (let k = 0; k < 2 && src[i] >= '0' && src[i] <= '7'; k++) o += src[i++]; out += String.fromCharCode(parseInt(o, 8) & 255); }
          else if (y !== undefined) out += y;
        } else if (x === '(') { depth++; out += x; } else if (x === ')') { if (--depth === 0) break; out += x; } else out += x;
      }
      return new Str(out, false);
    }
    if (ch === 60) {
      if (c(i + 1) === 60) { // dict
        i += 2; const d = {};
        for (;;) { skipWs(); if (i >= n) break; if (c(i) === 62 && c(i + 1) === 62) { i += 2; break; } const k = readObj(); if (!(k instanceof Name)) { if (k === undefined) break; continue; } d[k.n] = readObj(); }
        return d;
      }
      i++; let h = ''; while (i < n && c(i) !== 62) { const x = src[i++]; if (/[0-9a-fA-F]/.test(x)) h += x; } i++;
      if (h.length % 2) h += '0'; let out = ''; for (let k = 0; k < h.length; k += 2) out += String.fromCharCode(parseInt(h.substr(k, 2), 16));
      return new Str(out, true);
    }
    if (ch === 91) { i++; const a = []; for (;;) { skipWs(); if (i >= n) break; if (c(i) === 93) { i++; break; } const v = readObj(); if (v === undefined) break; if (v && v.op) { continue; } a.push(v); } return a; }
    if (ch === 47) { i++; let s = ''; while (i < n && !WS.has(c(i)) && !DELIM.has(c(i))) s += src[i++]; return new Name(s.replace(/#([0-9a-fA-F]{2})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))); }
    if ((ch >= 48 && ch <= 57) || ch === 43 || ch === 45 || ch === 46) { let s = ''; while (i < n) { const x = c(i); if ((x >= 48 && x <= 57) || x === 43 || x === 45 || x === 46) s += src[i++]; else break; } const v = parseFloat(s); return isNaN(v) ? 0 : v; }
    if (ch === 41 || ch === 62 || ch === 93 || ch === 125 || ch === 123) { i++; return readObj(); }
    // keyword / operator
    let s = ''; while (i < n && !WS.has(c(i)) && !DELIM.has(c(i))) s += src[i++];
    if (!s) { i++; return readObj(); }
    if (s === 'true') return true; if (s === 'false') return false; if (s === 'null') return null;
    return { op: s };
  }
  for (;;) {
    skipWs(); if (i >= n) break;
    if (opStart < 0) opStart = i;
    const v = readObj(); if (v === undefined) break;
    if (v && v.op) {
      if (v.op === 'BI') { // inline image: dict up to ID, then binary up to EI
        const d = {}; for (;;) { skipWs(); if (i >= n) break; const k = readObj(); if (k && k.op === 'ID') break; if (k instanceof Name) d[k.n] = readObj(); else if (k === undefined) break; }
        i++; // single whitespace after ID
        let j = i; for (;;) { j = src.indexOf('EI', j); if (j < 0) { j = n; break; } const before = c(j - 1), after = c(j + 2); if (WS.has(before) && (j + 2 >= n || WS.has(after) || DELIM.has(after))) break; j += 2; }
        i = Math.min(n, j + 2);
        ops.push({ op: 'BI', args: [d], start: opStart, end: i });
      } else ops.push({ op: v.op, args: stack, start: opStart, end: i });
      stack = []; opStart = -1;
    } else stack.push(v);
  }
  return ops;
}

/* ---------- fonts ---------- */
const CP1252 = { 0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178 };
const winUni = code => CP1252[code] || code;
let GLYPHS = null; // glyph name -> unicode, from pdf-lib's WinAnsi table plus a few extras
function glyphUni(name) {
  if (!GLYPHS) {
    GLYPHS = new Map();
    try { const enc = L.StandardFontEmbedder.for(L.StandardFonts.Helvetica).encoding; for (const [cp, v] of Object.entries(enc.unicodeMappings)) GLYPHS.set(v[1], +cp); } catch (e) { /* ignore */ }
    for (const [k, v] of Object.entries({ fi: 0xFB01, fl: 0xFB02, ff: 0xFB00, ffi: 0xFB03, ffl: 0xFB04, minus: 0x2212, dotlessi: 0x131, nbspace: 0xA0, sfthyphen: 0xAD, Delta: 0x394, Omega: 0x3A9, mu: 0xB5, pi: 0x3C0, fraction: 0x2044, bullet: 0x2022 })) GLYPHS.set(k, v);
  }
  if (GLYPHS.has(name)) return GLYPHS.get(name);
  let m = /^uni([0-9A-Fa-f]{4})/.exec(name); if (m) return parseInt(m[1], 16);
  m = /^u([0-9A-Fa-f]{4,6})$/.exec(name); if (m) return parseInt(m[1], 16);
  if (name.length === 1) return name.charCodeAt(0);
  m = /^([A-Za-z])\.\w+$/.exec(name); if (m) return m[1].charCodeAt(0);
  return null;
}
function hexToUnicode(h) { // UTF-16BE hex -> string
  let s = ''; for (let k = 0; k + 3 < h.length; k += 4) s += String.fromCharCode(parseInt(h.substr(k, 4), 16));
  return s;
}
export function parseToUnicode(text) {
  const map = new Map(); let bytes = 1;
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/g; let m;
  while ((m = cs.exec(text))) { const r = /<([0-9a-fA-F]+)>/.exec(m[1]); if (r) bytes = Math.max(1, r[1].length / 2); }
  const bfc = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((m = bfc.exec(text))) { const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g; let p; while ((p = re.exec(m[1]))) { map.set(parseInt(p[1], 16), hexToUnicode(p[2])); bytes = Math.max(bytes, Math.min(2, p[1].length / 2)); } }
  const bfr = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = bfr.exec(text))) {
    const re = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]*)>|\[([^\]]*)\])/g; let p;
    while ((p = re.exec(m[1]))) {
      const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16); if (hi - lo > 65535) continue;
      bytes = Math.max(bytes, Math.min(2, p[1].length / 2));
      if (p[4] !== undefined) { const base = p[4]; const last = parseInt(base.slice(-4) || '0', 16); for (let k = lo; k <= hi; k++) map.set(k, hexToUnicode(base.slice(0, -4) + (last + k - lo).toString(16).padStart(4, '0'))); }
      else { const items = [...p[5].matchAll(/<([0-9a-fA-F]*)>/g)].map(x => x[1]); items.forEach((h, k) => { if (lo + k <= hi) map.set(lo + k, hexToUnicode(h)); }); }
    }
  }
  return { map, bytes };
}
const num = v => (v instanceof PDFNumber ? v.asNumber() : typeof v === 'number' ? v : 0);
function decodeStream(obj) {
  if (obj instanceof PDFRawStream) return L.decodePDFRawStream(obj).decode();
  if (obj && obj.getUnencodedContents) return obj.getUnencodedContents();
  if (obj && obj.getContents) return obj.getContents();
  return new Uint8Array(0);
}
export { decodeStream };
const STD14 = /^(Helvetica|Arial|Times|Courier|Symbol|ZapfDingbats)/;
export function fontInfo(ctx, dict) {
  const look = k => dict.lookup(PDFName.of(k));
  const subtype = look('Subtype')?.decodeText?.() || 'Type1';
  const base = (look('BaseFont')?.decodeText?.() || '').replace(/^[A-Z]{6}\+/, '');
  const subset = /^[A-Z]{6}\+/.test(look('BaseFont')?.decodeText?.() || '');
  const fi = { subtype, base, subset, twoByte: false, unsupported: null, widths: new Map(), dw: 1000, scale: 0.001, toUni: null, encMap: new Map(), embedded: false, flags: 0, weight: 400, italicAngle: 0, std: null };
  let desc = look('FontDescriptor');
  if (subtype === 'Type0') {
    const enc = look('Encoding');
    const encName = enc instanceof PDFName ? enc.decodeText() : null;
    if (encName === 'Identity-H' || encName === 'Identity-V') fi.twoByte = true;
    else fi.unsupported = 'CID font with encoding ' + (encName || 'embedded CMap');
    if (encName === 'Identity-V') fi.unsupported = 'vertical text';
    const df = look('DescendantFonts'); const cid = df instanceof PDFArray ? ctx.lookup(df.get(0)) : null;
    if (cid instanceof PDFDict) {
      desc = cid.lookup(PDFName.of('FontDescriptor'));
      const dw = cid.lookup(PDFName.of('DW')); if (dw) fi.dw = num(dw);
      const W = cid.lookup(PDFName.of('W'));
      if (W instanceof PDFArray) {
        const a = W.asArray().map(x => x instanceof PDFRef ? ctx.lookup(x) : x);
        for (let k = 0; k < a.length;) {
          const first = num(a[k]); const nx = a[k + 1];
          if (nx instanceof PDFArray) { nx.asArray().forEach((w, j) => fi.widths.set(first + j, num(w instanceof PDFRef ? ctx.lookup(w) : w))); k += 2; }
          else { const last = num(nx), w = num(a[k + 2]); for (let c = first; c <= last && c - first < 65536; c++) fi.widths.set(c, w); k += 3; }
        }
      }
    }
  } else {
    if (subtype === 'Type3') { const fm = look('FontMatrix'); if (fm instanceof PDFArray) fi.scale = num(fm.get(0)) || 0.001; }
    const first = num(look('FirstChar')); const W = look('Widths');
    if (W instanceof PDFArray) W.asArray().forEach((w, j) => fi.widths.set(first + j, num(w instanceof PDFRef ? ctx.lookup(w) : w)));
    // encoding -> unicode (fallback when there's no ToUnicode)
    let baseEnc = 'WinAnsiEncoding'; let diffs = null;
    const enc = look('Encoding');
    if (enc instanceof PDFName) baseEnc = enc.decodeText();
    else if (enc instanceof PDFDict) { const be = enc.lookup(PDFName.of('BaseEncoding')); if (be instanceof PDFName) baseEnc = be.decodeText(); diffs = enc.lookup(PDFName.of('Differences')); }
    fi.encName = enc instanceof PDFName ? baseEnc : (enc instanceof PDFDict ? 'custom' : 'builtin');
    if (/Symbol|Dingbats/.test(base)) fi.symbolic = true;
    for (let code = 32; code < 256; code++) if (!fi.symbolic || code < 128) fi.encMap.set(code, String.fromCharCode(winUni(code)));
    if (diffs instanceof PDFArray) {
      let code = 0;
      for (const x of diffs.asArray()) {
        if (x instanceof PDFNumber) code = x.asNumber();
        else if (x instanceof PDFName) { const u = glyphUni(x.decodeText()); if (u != null) fi.encMap.set(code, String.fromCodePoint(u)); else fi.encMap.delete(code); code++; }
      }
    }
    if (!W && STD14.test(base)) fi.std = stdName(base);
  }
  if (desc instanceof PDFDict) {
    const d = k => desc.lookup(PDFName.of(k));
    fi.flags = num(d('Flags')); fi.weight = num(d('FontWeight')) || 400; fi.italicAngle = num(d('ItalicAngle'));
    fi.embedded = !!(d('FontFile') || d('FontFile2') || d('FontFile3'));
    const mw = d('MissingWidth'); if (mw) fi.missing = num(mw);
  }
  const tu = look('ToUnicode');
  if (tu instanceof PDFStream || tu instanceof PDFRawStream) { try { const t = parseToUnicode(bytesToStr(decodeStream(tu))); fi.toUni = t.map; } catch (e) { /* ignore */ } }
  if (subtype === 'Type3') fi.unsupported = fi.unsupported || null;
  return fi;
}
let stdEmb = new Map();
function stdName(base) {
  const b = /Bold/i.test(base), it = /Italic|Oblique/i.test(base);
  if (/^Courier/i.test(base)) return b && it ? 'Courier-BoldOblique' : b ? 'Courier-Bold' : it ? 'Courier-Oblique' : 'Courier';
  if (/^(Times|TimesNewRoman)/i.test(base)) return b && it ? 'Times-BoldItalic' : b ? 'Times-Bold' : it ? 'Times-Italic' : 'Times-Roman';
  if (/^Symbol/i.test(base)) return 'Symbol';
  if (/^ZapfDingbats/i.test(base)) return 'ZapfDingbats';
  return b && it ? 'Helvetica-BoldOblique' : b ? 'Helvetica-Bold' : it ? 'Helvetica-Oblique' : 'Helvetica';
}
function stdWidth(name, code, fi) {
  if (!stdEmb.has(name)) { try { stdEmb.set(name, L.StandardFontEmbedder.for(name)); } catch (e) { stdEmb.set(name, null); } }
  const e = stdEmb.get(name); if (!e) return 500;
  const ch = fi.encMap.get(code); if (!ch) return 0;
  try { const m = e.encoding.unicodeMappings?.[ch.codePointAt(0)]; const g = m ? m[1] : null; return g ? e.font.getWidthOfGlyph(g) || 0 : 0; } catch (err) { return 500; }
}
export function glyphWidth(fi, code) {
  if (fi.twoByte) return (fi.widths.has(code) ? fi.widths.get(code) : fi.dw) * 0.001;
  if (fi.widths.has(code)) return fi.widths.get(code) * fi.scale;
  if (fi.std) return stdWidth(fi.std, code, fi) * 0.001;
  return (fi.missing ?? 0) * fi.scale;
}
export function codeUnicode(fi, code) {
  if (fi.toUni && fi.toUni.has(code)) return fi.toUni.get(code);
  if (fi.twoByte) return null;
  return fi.encMap.get(code) ?? null;
}
export function splitCodes(fi, s) {
  const out = [];
  if (fi.twoByte) { for (let k = 0; k + 1 < s.length; k += 2) out.push((s.charCodeAt(k) << 8) | s.charCodeAt(k + 1)); }
  else for (let k = 0; k < s.length; k++) out.push(s.charCodeAt(k));
  return out;
}

/* ---------- interpreter ---------- */
function colorOf(cs, v) {
  if (cs === 'DeviceRGB' || cs === 'CalRGB') return { op: 'rg', v: v.slice(0, 3) };
  if (cs === 'DeviceCMYK') return { op: 'k', v: v.slice(0, 4) };
  if (cs === 'DeviceGray' || cs === 'CalGray') return { op: 'g', v: v.slice(0, 1) };
  if (v.length === 3) return { op: 'rg', v }; if (v.length === 4) return { op: 'k', v }; if (v.length === 1) return { op: 'g', v };
  return { op: 'g', v: [0] };
}
export function colorHex(c) {
  if (!c) return '#000000';
  let r, g, b;
  if (c.op === 'rg') [r, g, b] = c.v; else if (c.op === 'g') r = g = b = c.v[0]; else { const [C, M, Y, K] = c.v; r = (1 - C) * (1 - K); g = (1 - M) * (1 - K); b = (1 - Y) * (1 - K); }
  return '#' + [r, g, b].map(x => Math.round(Math.max(0, Math.min(1, +x || 0)) * 255).toString(16).padStart(2, '0')).join('');
}

// Interpret a page's content. resources: PDFDict. Returns {ops, shows, paths, endState}
export function interpret(ctx, src, resources, { paths: wantPaths = false } = {}) {
  const ops = lex(src);
  const fontRes = resources?.lookup(PDFName.of('Font'));
  const csRes = resources?.lookup(PDFName.of('ColorSpace'));
  const fontCache = new Map();
  const byRef = new Map();
  const getFont = name => {
    if (fontCache.has(name)) return fontCache.get(name);
    let fi = null;
    try {
      const raw = fontRes instanceof PDFDict ? fontRes.get(PDFName.of(name)) : null;
      const key = raw instanceof PDFRef ? raw.tag : null;
      if (key && byRef.has(key)) fi = byRef.get(key);
      else { const d = fontRes instanceof PDFDict ? fontRes.lookup(PDFName.of(name)) : null; if (d instanceof PDFDict) { fi = fontInfo(ctx, d); fi.key = key || ('n:' + name); if (key) byRef.set(key, fi); } }
    } catch (e) { fi = null; }
    fontCache.set(name, fi); return fi;
  };
  const csFamily = name => {
    if (/^Device|^Cal|^Pattern|^Indexed|^Lab/.test(name)) return name;
    try { const v = csRes instanceof PDFDict ? csRes.lookup(PDFName.of(name)) : null; if (v instanceof PDFArray) { const f = v.get(0)?.decodeText?.(); if (f === 'ICCBased') { const s = ctx.lookup(v.get(1)); const N = num(s?.dict?.lookup(PDFName.of('N'))); return N === 4 ? 'DeviceCMYK' : N === 1 ? 'DeviceGray' : 'DeviceRGB'; } return f || 'DeviceRGB'; } if (v instanceof PDFName) return v.decodeText(); } catch (e) { /* ignore */ }
    return 'DeviceRGB';
  };
  let gs = { ctm: ID.slice(), fillCS: 'DeviceGray', fill: { op: 'g', v: [0] }, strokeCS: 'DeviceGray', stroke: { op: 'g', v: [0] }, Tc: 0, Tw: 0, Th: 1, TL: 0, font: null, size: 0, Tr: 0, Ts: 0, lw: 1, clip: false, clipBox: null };
  const stack = []; let tm = ID.slice(), tlm = ID.slice(), bt = -1, btCount = 0;
  const shows = [], paths = [], xobjs = []; let path = [], cur = null, start = null;
  const newLine = (tx, ty) => { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm.slice(); };
  const showText = (op, items) => {
    const fi = gs.font ? getFont(gs.font) : null;
    const rec = { op: op.op, start: op.start, end: op.end, fontName: gs.font, fontKey: fi ? fi.key : null, fi, size: gs.size, tm: tm.slice(), ctm: gs.ctm.slice(), Tc: gs.Tc, Tw: gs.Tw, Th: gs.Th, Ts: gs.Ts, Tr: gs.Tr, fill: gs.fill, stroke: gs.stroke, clipBox: gs.clipBox, bt, glyphs: [], text: '', adv: 0, unknown: 0 };
    let x = 0;
    for (const it of items) {
      if (typeof it === 'number') { x -= it / 1000 * gs.size * gs.Th; continue; }
      if (!(it instanceof Str) || !fi) continue;
      for (const code of splitCodes(fi, it.s)) {
        const w0 = glyphWidth(fi, code);
        const tw = (!fi.twoByte && code === 32) ? gs.Tw : 0;
        const adv = (w0 * gs.size + gs.Tc + tw) * gs.Th;
        let u = codeUnicode(fi, code); if (u == null) { rec.unknown++; u = '�'; }
        rec.glyphs.push({ code, x, adv, w: w0 * gs.size * gs.Th, u });
        rec.text += u; x += adv;
      }
    }
    rec.adv = x; tm = mul([1, 0, 0, 1, x, 0], tm);
    // geometry
    const M = mul(rec.tm, rec.ctm); rec.m = M;
    const lo = rec.Ts - 0.22 * rec.size, hi = rec.Ts + 0.80 * rec.size;
    const pts = [[0, lo], [x, lo], [0, hi], [x, hi]].map(([a, b]) => apply(M, a, b));
    rec.bbox = [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))];
    rec.p0 = apply(M, 0, rec.Ts); rec.p1 = apply(M, x, rec.Ts);
    const ux = apply(M, 1, 0), o = apply(M, 0, 0); const ul = Math.hypot(ux[0] - o[0], ux[1] - o[1]) || 1; rec.u = [(ux[0] - o[0]) / ul, (ux[1] - o[1]) / ul];
    const vy = apply(M, 0, 1); rec.hUser = Math.hypot(vy[0] - o[0], vy[1] - o[1]) * Math.abs(rec.size); // font height in user units
    shows.push(rec);
  };
  const tp = (x, y) => apply(gs.ctm, x, y);
  let pathStart = -1, pathClip = false;
  for (const op of ops) {
    const a = op.args;
    if (wantPaths && pathStart < 0 && /^(m|re)$/.test(op.op)) pathStart = op.start;
    switch (op.op) {
      case 'q': stack.push({ ...gs, ctm: gs.ctm.slice() }); break;
      case 'Q': if (stack.length) gs = stack.pop(); break;
      case 'cm': if (a.length >= 6) gs.ctm = mul(a.slice(0, 6).map(Number), gs.ctm); break;
      case 'w': gs.lw = +a[0] || 0; break;
      case 'g': gs.fillCS = 'DeviceGray'; gs.fill = colorOf('DeviceGray', a.map(Number)); break;
      case 'rg': gs.fillCS = 'DeviceRGB'; gs.fill = colorOf('DeviceRGB', a.map(Number)); break;
      case 'k': gs.fillCS = 'DeviceCMYK'; gs.fill = colorOf('DeviceCMYK', a.map(Number)); break;
      case 'G': gs.stroke = colorOf('DeviceGray', a.map(Number)); break;
      case 'RG': gs.stroke = colorOf('DeviceRGB', a.map(Number)); break;
      case 'K': gs.stroke = colorOf('DeviceCMYK', a.map(Number)); break;
      case 'cs': gs.fillCS = a[0] instanceof Name ? csFamily(a[0].n) : 'DeviceRGB'; gs.fill = colorOf(gs.fillCS, gs.fillCS === 'DeviceCMYK' ? [0, 0, 0, 1] : gs.fillCS === 'DeviceRGB' ? [0, 0, 0] : [0]); break;
      case 'CS': gs.strokeCS = a[0] instanceof Name ? csFamily(a[0].n) : 'DeviceRGB'; break;
      case 'sc': case 'scn': { const v = a.filter(x => typeof x === 'number'); if (v.length) gs.fill = colorOf(gs.fillCS, v); break; }
      case 'SC': case 'SCN': { const v = a.filter(x => typeof x === 'number'); if (v.length) gs.stroke = colorOf(gs.strokeCS, v); break; }
      case 'BT': tm = ID.slice(); tlm = ID.slice(); bt = btCount++; break;
      case 'ET': bt = -1; break;
      case 'Tc': gs.Tc = +a[0] || 0; break;
      case 'Tw': gs.Tw = +a[0] || 0; break;
      case 'Tz': gs.Th = (+a[0] || 0) / 100; break;
      case 'TL': gs.TL = +a[0] || 0; break;
      case 'Ts': gs.Ts = +a[0] || 0; break;
      case 'Tr': gs.Tr = +a[0] || 0; break;
      case 'Tf': gs.font = a[0] instanceof Name ? a[0].n : null; gs.size = +a[1] || 0; break;
      case 'Td': newLine(+a[0] || 0, +a[1] || 0); break;
      case 'TD': gs.TL = -(+a[1] || 0); newLine(+a[0] || 0, +a[1] || 0); break;
      case 'Tm': if (a.length >= 6) { tlm = a.slice(0, 6).map(Number); tm = tlm.slice(); } break;
      case 'T*': newLine(0, -gs.TL); break;
      case 'Tj': showText(op, [a[0]]); break;
      case 'TJ': showText(op, Array.isArray(a[0]) ? a[0] : []); break;
      case "'": newLine(0, -gs.TL); showText(op, [a[0]]); break;
      case '"': gs.Tw = +a[0] || 0; gs.Tc = +a[1] || 0; newLine(0, -gs.TL); showText(op, [a[2]]); break;
      // paths
      case 'm': if (wantPaths) { cur = tp(+a[0], +a[1]); start = cur; path.push({ t: 'm', p: cur }); } break;
      case 'l': if (wantPaths) { const p = tp(+a[0], +a[1]); path.push({ t: 'l', a: cur, p }); cur = p; } break;
      case 'c': case 'v': case 'y': if (wantPaths) { const k = a.length; const p = tp(+a[k - 2], +a[k - 1]); path.push({ t: 'c', a: cur, p }); cur = p; } break;
      case 'h': if (wantPaths && cur && start) { path.push({ t: 'l', a: cur, p: start, close: true }); cur = start; } break;
      case 're': if (wantPaths) { const [x, y, w, h] = a.map(Number); const pts = [tp(x, y), tp(x + w, y), tp(x + w, y + h), tp(x, y + h)]; path.push({ t: 're', pts, rect: [Math.min(...pts.map(p => p[0])), Math.min(...pts.map(p => p[1])), Math.max(...pts.map(p => p[0])), Math.max(...pts.map(p => p[1]))] }); cur = pts[0]; start = cur; } break;
      case 'S': case 's': case 'f': case 'F': case 'f*': case 'B': case 'B*': case 'b': case 'b*': case 'n':
        if (wantPaths && path.length && op.op !== 'n') {
          const sc = Math.sqrt(Math.abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2])) || 1;
          paths.push({ segs: path, paint: op.op, lw: gs.lw * sc, stroke: gs.stroke, fill: gs.fill, start: pathStart, end: op.end, clip: pathClip, inText: bt >= 0, ctm: gs.ctm.slice(), clipBox: gs.clipBox });
        }
        if (wantPaths && pathClip && path.length) { // the clip applies after this paint operator
          const pts = path.flatMap(sg => sg.t === 're' ? sg.pts : [sg.p, ...(sg.a ? [sg.a] : [])]).filter(Boolean);
          if (pts.length) { const b = [Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))]; const c = gs.clipBox; gs.clipBox = c ? [Math.max(c[0], b[0]), Math.max(c[1], b[1]), Math.min(c[2], b[2]), Math.min(c[3], b[3])] : b; }
        }
        path = []; cur = null; pathStart = -1; pathClip = false; break;
      case 'W': case 'W*': pathClip = true; if (stack.length === 0) gs.clip = true; break;
      case 'Do': case 'BI': { const q = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => tp(x, y)); xobjs.push({ op: op.op, start: op.start, end: op.end, ctm: gs.ctm.slice(), inText: bt >= 0, clipBox: gs.clipBox, name: op.args[0] instanceof Name ? op.args[0].n : null, bbox: [Math.min(...q.map(p => p[0])), Math.min(...q.map(p => p[1])), Math.max(...q.map(p => p[0])), Math.max(...q.map(p => p[1]))] }); break; }
    }
  }
  return { ops, shows, paths, xobjs, endDepth: stack.length, endCtm: gs.ctm, endClip: gs.clip || stack.some(s => s.clip) };
}

/* ---------- page helpers ---------- */
export function pageContentString(page) {
  const ctx = page.doc.context;
  const c = page.node.Contents(); const parts = [];
  const add = o => { o = o instanceof PDFRef ? ctx.lookup(o) : o; if (o instanceof PDFStream || o instanceof PDFRawStream) parts.push(bytesToStr(decodeStream(o))); };
  if (c instanceof PDFArray) c.asArray().forEach(add); else if (c) add(c);
  return parts.join('\n');
}
export function pageResources(page) {
  const r = page.node.Resources?.() || page.node.getInheritableAttribute?.(PDFName.of('Resources'));
  return r instanceof PDFRef ? page.doc.context.lookup(r) : r;
}
export function setPageContent(page, str) {
  const ctx = page.doc.context;
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(strToBytes(str))));
}
// Ops appended after a page's content need a clean graphics state: wrap the original content
// in q … Q (closing any unbalanced q) when it leaves the CTM, clip or nesting changed.
export function appendToPage(page, ops) {
  const src = pageContentString(page);
  let res; try { res = interpret(page.doc.context, src, pageResources(page)); } catch (e) { res = null; }
  const clean = res && res.endDepth === 0 && !res.endClip && res.endCtm.every((v, k) => Math.abs(v - ID[k]) < 1e-9);
  const body = clean ? src + '\n' : 'q\n' + src + '\n' + 'Q\n'.repeat((res ? res.endDepth : 0) + 1);
  setPageContent(page, body + ops);
}
