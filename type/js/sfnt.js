// Lumen Type font compiler: TrueType (glyf) and OpenType-CFF (via opentype.js' CFF writer) with our own
// head/hhea/maxp/OS/2/hmtx/cmap/name/post/kern/GPOS tables, plus a WOFF 1.0 wrapper. No DOM — runs in Node tests.
(function (root) {
  'use strict';
  const TM = root.TM || require('./model.js');

  class W {
    constructor() { this.a = []; }
    u8(v) { this.a.push(v & 255); } u16(v) { this.a.push((v >> 8) & 255, v & 255); } i16(v) { v = Math.round(v); this.u16(v < 0 ? v + 65536 : v); }
    u32(v) { this.a.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); } i32(v) { this.u32(v >>> 0); }
    fixed(v) { this.i32(Math.round(v * 65536)); } f2dot14(v) { this.i16(Math.round(v * 16384)); }
    tag(s) { for (let i = 0; i < 4; i++) this.u8(i < s.length ? s.charCodeAt(i) : 32); }
    bytes(b) { for (let i = 0; i < b.length; i++) this.a.push(b[i]); }
    pad(n = 4) { while (this.a.length % n) this.a.push(0); }
    at(o, v) { this.a[o] = (v >> 8) & 255; this.a[o + 1] = v & 255; }   // patch u16
    get length() { return this.a.length; }
    out() { return Uint8Array.from(this.a); }
  }
  const MAC_NAMES = [".notdef",".null","nonmarkingreturn","space","exclam","quotedbl","numbersign","dollar","percent","ampersand","quotesingle","parenleft","parenright","asterisk","plus","comma","hyphen","period","slash","zero","one","two","three","four","five","six","seven","eight","nine","colon","semicolon","less","equal","greater","question","at","A","B","C","D","E","F","G","H","I","J","K","L","M","N","O","P","Q","R","S","T","U","V","W","X","Y","Z","bracketleft","backslash","bracketright","asciicircum","underscore","grave","a","b","c","d","e","f","g","h","i","j","k","l","m","n","o","p","q","r","s","t","u","v","w","x","y","z","braceleft","bar","braceright","asciitilde","Adieresis","Aring","Ccedilla","Eacute","Ntilde","Odieresis","Udieresis","aacute","agrave","acircumflex","adieresis","atilde","aring","ccedilla","eacute","egrave","ecircumflex","edieresis","iacute","igrave","icircumflex","idieresis","ntilde","oacute","ograve","ocircumflex","odieresis","otilde","uacute","ugrave","ucircumflex","udieresis","dagger","degree","cent","sterling","section","bullet","paragraph","germandbls","registered","copyright","trademark","acute","dieresis","notequal","AE","Oslash","infinity","plusminus","lessequal","greaterequal","yen","mu","partialdiff","summation","product","pi","integral","ordfeminine","ordmasculine","Omega","ae","oslash","questiondown","exclamdown","logicalnot","radical","florin","approxequal","Delta","guillemotleft","guillemotright","ellipsis","nonbreakingspace","Agrave","Atilde","Otilde","OE","oe","endash","emdash","quotedblleft","quotedblright","quoteleft","quoteright","divide","lozenge","ydieresis","Ydieresis","fraction","currency","guilsinglleft","guilsinglright","fi","fl","daggerdbl","periodcentered","quotesinglbase","quotedblbase","perthousand","Acircumflex","Ecircumflex","Aacute","Edieresis","Egrave","Iacute","Icircumflex","Idieresis","Igrave","Oacute","Ocircumflex","apple","Ograve","Uacute","Ucircumflex","Ugrave","dotlessi","circumflex","tilde","macron","breve","dotaccent","ring","cedilla","hungarumlaut","ogonek","caron","Lslash","lslash","Scaron","scaron","Zcaron","zcaron","brokenbar","Eth","eth","Yacute","yacute","Thorn","thorn","minus","multiply","onesuperior","twosuperior","threesuperior","onehalf","onequarter","threequarters","franc","Gbreve","gbreve","Idotaccent","Scedilla","scedilla","Cacute","cacute","Ccaron","ccaron","dcroat"];
  const MAC_INDEX = new Map(MAC_NAMES.map((n, i) => [n, i]));

  // ---------- naming / style ----------
  function styleInfo(info) {
    const style = (info.styleName || 'Regular').trim() || 'Regular', low = style.toLowerCase().replace(/\s+/g, ' ');
    const ribbi = ['regular', 'italic', 'bold', 'bold italic'].includes(low);
    const italic = /italic|oblique/.test(low), bold = ribbi && low.startsWith('bold');
    const fam = (info.familyName || 'Untitled').trim() || 'Untitled';
    let fam1 = fam, sub2 = style;
    if (!ribbi) { const base = style.replace(/\s*(italic|oblique)\s*/ig, ' ').trim(); fam1 = fam + (base ? ' ' + base : ''); sub2 = italic ? 'Italic' : 'Regular'; }
    else sub2 = low.split(' ').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    const ps = (fam.replace(/[^A-Za-z0-9]/g, '') || 'Untitled') + '-' + (style.replace(/[^A-Za-z0-9]/g, '') || 'Regular');
    return { fam, style, ribbi, italic, bold, regular: ribbi && !bold && !italic, fam1, sub2, full: fam + ' ' + style, ps: ps.slice(0, 63) };
  }
  const versionString = info => `Version ${Math.max(0, Math.round(info.versionMajor))}.${String(Math.max(0, Math.round(info.versionMinor))).padStart(3, '0')}`;

  // ---------- glyph preparation ----------
  function prepare(font, opts = {}) {
    const order = font.order.filter(n => font.glyphs[n]);
    const nd = order.indexOf('.notdef'); if (nd > 0) { order.splice(nd, 1); order.unshift('.notdef'); }
    const glyphs = Object.assign({}, font.glyphs);
    if (nd < 0) { glyphs['.notdef'] = TM.notdefGlyph(font.info); order.unshift('.notdef'); }
    const out = {};
    order.forEach(n => {
      const g = TM.cloneGlyph(glyphs[n]);
      g.contours.forEach(c => { delete c.open; TM.canonical(c); TM.fixTypes(c); });
      g.contours = g.contours.filter(c => c.points.some(p => p.t !== 'o') ? c.points.length >= 2 : c.points.length >= 2);
      g.components = g.components.filter(c => glyphs[c.base] && c.base !== n);
      if (opts.overlap && g.contours.length) { try { opts.overlap(g); } catch (e) { /* keep original outline */ } }
      if (opts.correctDirection !== false && g.contours.length > 0) TM.correctDirections(g);
      out[n] = g;
    });
    // break component cycles
    const F = { info: font.info, order, glyphs: out };
    order.forEach(n => { out[n].components = out[n].components.filter(c => !TM.usesComponent(F, c.base, n) && out[c.base]); });
    return F;
  }
  function cmapEntries(F, gid) {
    const m = new Map();
    F.order.forEach(n => F.glyphs[n].unicodes.forEach(u => { if (!m.has(u) && u >= 0 && u <= 0x10FFFF) m.set(u, gid.get(n)); }));
    return [...m].sort((a, b) => a[0] - b[0]);
  }

  // ---------- tables ----------
  function cmapTable(entries) {
    const bmp = entries.filter(e => e[0] <= 0xFFFF), full = entries.some(e => e[0] > 0xFFFF);
    // format 4: segments of consecutive codes with constant delta
    const segs = [];
    bmp.forEach(([c, g]) => { const s = segs[segs.length - 1]; if (s && c === s.end + 1 && g - c === s.delta) s.end = c; else segs.push({ start: c, end: c, delta: g - c }); });
    if (!segs.length || segs[segs.length - 1].end !== 0xFFFF) segs.push({ start: 0xFFFF, end: 0xFFFF, delta: 1 });
    const n = segs.length, f4 = new W();
    const sr = 2 * Math.pow(2, Math.floor(Math.log2(n)));
    f4.u16(4); f4.u16(16 + 8 * n); f4.u16(0); f4.u16(n * 2); f4.u16(sr); f4.u16(Math.floor(Math.log2(n))); f4.u16(n * 2 - sr);
    segs.forEach(s => f4.u16(s.end)); f4.u16(0); segs.forEach(s => f4.u16(s.start)); segs.forEach(s => f4.u16(((s.delta % 65536) + 65536) % 65536)); segs.forEach(() => f4.u16(0));
    let f12 = null;
    if (full) {
      const groups = [];
      entries.forEach(([c, g]) => { const s = groups[groups.length - 1]; if (s && c === s.end + 1 && g === s.g + (c - s.start)) s.end = c; else groups.push({ start: c, end: c, g }); });
      f12 = new W(); f12.u16(12); f12.u16(0); f12.u32(16 + 12 * groups.length); f12.u32(0); f12.u32(groups.length);
      groups.forEach(s => { f12.u32(s.start); f12.u32(s.end); f12.u32(s.g); });
    }
    const recs = full ? [[0, 3, 4], [0, 4, 12], [3, 1, 4], [3, 10, 12]] : [[0, 3, 4], [3, 1, 4]];
    const w = new W(); w.u16(0); w.u16(recs.length);
    const hdr = 4 + recs.length * 8, o4 = hdr, o12 = hdr + f4.length;
    recs.forEach(([p, e, f]) => { w.u16(p); w.u16(e); w.u32(f === 4 ? o4 : o12); });
    w.bytes(f4.a); if (f12) w.bytes(f12.a);
    return w.out();
  }
  function nameTable(info, st) {
    const recs = [];
    const add = (id, s) => { if (s != null && String(s) !== '') recs.push([id, String(s)]); };
    add(0, info.copyright); add(1, st.fam1); add(2, st.sub2); add(3, `${Math.round(info.versionMajor)}.${String(Math.round(info.versionMinor)).padStart(3, '0')};${(info.vendorID || 'NONE').trim() || 'NONE'};${st.ps}`);
    add(4, st.full); add(5, versionString(info)); add(6, st.ps); add(7, info.trademark); add(8, info.manufacturer); add(9, info.designer); add(10, info.description);
    add(11, info.manufacturerURL); add(12, info.designerURL); add(13, info.license); add(14, info.licenseURL);
    if (!st.ribbi) { add(16, st.fam); add(17, st.style); }
    recs.sort((a, b) => a[0] - b[0]);
    const strs = new W(), w = new W();
    w.u16(0); w.u16(recs.length); w.u16(6 + recs.length * 12);
    recs.forEach(([id, s]) => {
      const off = strs.length; for (const ch of s) { const cp = ch.codePointAt(0); if (cp > 0xFFFF) { const v = cp - 0x10000; strs.u16(0xD800 + (v >> 10)); strs.u16(0xDC00 + (v & 1023)); } else strs.u16(cp); }
      w.u16(3); w.u16(1); w.u16(0x409); w.u16(id); w.u16(strs.length - off); w.u16(off);
    });
    w.bytes(strs.a); return w.out();
  }
  const RANGES = [[0, 0x0, 0x7F], [1, 0x80, 0xFF], [2, 0x100, 0x17F], [3, 0x180, 0x24F], [4, 0x250, 0x2AF], [5, 0x2B0, 0x2FF], [6, 0x300, 0x36F], [7, 0x370, 0x3FF], [9, 0x400, 0x4FF], [29, 0x1E00, 0x1EFF], [31, 0x2000, 0x206F], [32, 0x2070, 0x209F], [33, 0x20A0, 0x20CF], [35, 0x2100, 0x214F], [36, 0x2150, 0x218F], [37, 0x2190, 0x21FF], [38, 0x2200, 0x22FF], [43, 0x2500, 0x257F], [45, 0x25A0, 0x25FF], [60, 0xE000, 0xF8FF], [62, 0xFB00, 0xFB4F], [69, 0xFE70, 0xFEFF]];
  function os2Table(F, st, m, cps, kern) {
    const I = F.info, upm = I.unitsPerEm, w = new W();
    const adv = F.order.map(n => F.glyphs[n].advance).filter(a => a > 0);
    const ur = [0, 0, 0, 0];
    cps.forEach(c => { if (c > 0xFFFF) ur[1] |= 1 << (57 - 32); RANGES.forEach(([b, a, z]) => { if (c >= a && c <= z) ur[b >> 5] |= 1 << (b & 31); }); });
    let cp1 = 0; if (cps.some(c => c >= 0x20 && c < 0x100)) cp1 |= 1; if (cps.some(c => c >= 0x100 && c < 0x180)) cp1 |= 2; if (cps.some(c => c >= 0x400 && c < 0x500)) cp1 |= 4; if (cps.some(c => c >= 0x370 && c < 0x400)) cp1 |= 8;
    let fsSel = 0; if (st.italic) fsSel |= 1; if (st.bold) fsSel |= 32; if (st.regular) fsSel |= 64; if (I.useTypoMetrics) fsSel |= 128;
    const bmpCps = cps.filter(c => c <= 0xFFFF);
    w.u16(4); w.i16(adv.length ? Math.round(adv.reduce((a, b) => a + b, 0) / adv.length) : 0); w.u16(I.weightClass); w.u16(I.widthClass); w.u16(I.fsType || 0);
    const s = v => Math.round(v * upm / 1000);
    w.i16(s(650)); w.i16(s(600)); w.i16(0); w.i16(s(75)); w.i16(s(650)); w.i16(s(600)); w.i16(0); w.i16(s(350));
    w.i16(Math.max(1, I.underlineThickness || s(50))); w.i16(Math.round((I.xHeight || s(500)) * 0.52)); w.i16(0);
    for (let i = 0; i < 10; i++) w.u8(i === 0 ? 2 : 0);   // PANOSE: Latin text
    ur.forEach(v => w.u32(v >>> 0)); w.tag(((I.vendorID || 'NONE') + '    ').slice(0, 4)); w.u16(fsSel);
    w.u16(bmpCps.length ? bmpCps[0] : 0); w.u16(bmpCps.length ? Math.min(0xFFFF, cps[cps.length - 1]) : 0);
    w.i16(I.ascender); w.i16(I.descender); w.i16(I.lineGap); w.u16(m.winAscent); w.u16(m.winDescent);
    w.u32(cp1 >>> 0); w.u32(0); w.i16(I.xHeight); w.i16(I.capHeight); w.u16(0); w.u16(cps.includes(32) ? 32 : 0); w.u16(kern ? 2 : 1);
    return w.out();
  }
  function headTable(F, m, st, locLong, ts) {
    const w = new W(), I = F.info;
    w.u32(0x00010000); w.fixed(Math.max(0, I.versionMajor) + Math.max(0, I.versionMinor) / 1000); w.u32(0); w.u32(0x5F0F3CF5);
    w.u16(m.tt ? 0x0003 : 0x0003); w.u16(I.unitsPerEm);
    const secs = Math.floor((ts != null ? ts : Date.now()) / 1000) + 2082844800;
    for (let k = 0; k < 2; k++) { w.u32(Math.floor(secs / 4294967296)); w.u32(secs >>> 0); }
    w.i16(m.xMin); w.i16(m.yMin); w.i16(m.xMax); w.i16(m.yMax);
    w.u16((st.bold ? 1 : 0) | (st.italic ? 2 : 0)); w.u16(8); w.i16(2); w.i16(locLong ? 1 : 0); w.i16(0);
    return w.out();
  }
  function hheaTable(F, m, n) {
    const w = new W(), I = F.info;
    w.u32(0x00010000); w.i16(I.ascender); w.i16(I.descender); w.i16(I.lineGap); w.u16(m.advMax); w.i16(m.minL); w.i16(m.minR); w.i16(m.xMaxExtent);
    const ang = (I.italicAngle || 0) * Math.PI / 180;
    if (ang) { w.i16(1000); w.i16(Math.round(-Math.tan(ang) * 1000)); } else { w.i16(1); w.i16(0); }
    w.i16(0); for (let i = 0; i < 4; i++) w.i16(0); w.i16(0); w.u16(n);
    return w.out();
  }
  function hmtxTable(F, lsbs) { const w = new W(); F.order.forEach((n, i) => { w.u16(Math.max(0, Math.round(F.glyphs[n].advance))); w.i16(lsbs[i]); }); return w.out(); }
  function postTable(F, v2) {
    const I = F.info, w = new W();
    w.u32(v2 ? 0x00020000 : 0x00030000); w.fixed(I.italicAngle || 0); w.i16(I.underlinePosition); w.i16(I.underlineThickness);
    w.u32(0); w.u32(0); w.u32(0); w.u32(0); w.u32(0);
    if (v2) {
      const extra = [];
      w.u16(F.order.length);
      F.order.forEach(n => { if (MAC_INDEX.has(n)) w.u16(MAC_INDEX.get(n)); else { w.u16(258 + extra.length); extra.push(n); } });
      extra.forEach(n => { w.u8(n.length); for (const ch of n) w.u8(ch.charCodeAt(0)); });
    }
    return w.out();
  }

  // ---------- kerning ----------
  // returns {f1: Map(leftGid → [[rightGid, v]]), classes: {left:[gids per class], right:[...], vals}, legacy: [[l,r,v]]}
  function kerningData(F, font, gid) {
    const K = font.kerning || {}, groups = font.groups || {};
    const KF = { glyphs: F.glyphs, groups, kerning: K };
    const exists = n => gid.has(n);
    const mem = k => TM.isGroup(k) ? (groups[k] || []).filter(exists) : exists(k) ? [k] : [];
    const f1 = new Map();
    const seen = new Set();
    // glyph-level pairs (including expanded glyph-group / group-glyph exceptions)
    Object.keys(K).forEach(l => Object.keys(K[l]).forEach(r => {
      if (TM.isGroup(l) && TM.isGroup(r)) return;
      for (const a of mem(l)) for (const b of mem(r)) {
        const key = a + '\u0000' + b; if (seen.has(key)) continue; seen.add(key);
        const v = TM.kernValue(KF, a, b); const ga = gid.get(a);
        if (!f1.has(ga)) f1.set(ga, []); f1.get(ga).push([gid.get(b), v]);
      }
    }));
    // group-group pairs → class kerning
    const lg = [], rg = [], li = new Map(), ri = new Map(), cell = [];
    Object.keys(K).forEach(l => { if (!TM.isGroup(l) || !l.startsWith('public.kern1.')) return; Object.keys(K[l]).forEach(r => {
      if (!r.startsWith('public.kern2.')) return;
      const L = mem(l), R = mem(r); if (!L.length || !R.length || !K[l][r]) return;
      if (!li.has(l)) { li.set(l, lg.length + 1); lg.push(L); } if (!ri.has(r)) { ri.set(r, rg.length + 1); rg.push(R); }
      cell.push([li.get(l), ri.get(r), K[l][r]]);
    }); });
    // a glyph may only be in one class: keep first membership
    const dedupe = arr => { const s = new Set(); return arr.map(g => g.filter(n => !s.has(n) && s.add(n))); };
    const L2 = dedupe(lg), R2 = dedupe(rg);
    const legacy = TM.flattenKerning({ glyphs: F.glyphs, groups, kerning: K }).filter(p => p[2] && exists(p[0]) && exists(p[1])).map(([a, b, v]) => [gid.get(a), gid.get(b), v]);
    return { f1, L: L2.map(g => g.map(n => gid.get(n))), R: R2.map(g => g.map(n => gid.get(n))), cell, legacy };
  }
  function coverageBytes(gids) {
    const w = new W(); w.u16(1); w.u16(gids.length); gids.forEach(g => w.u16(g)); return w.a;
  }
  function classDefBytes(map /* gid → class */) {
    const items = [...map].filter(e => e[1]).sort((a, b) => a[0] - b[0]), ranges = [];
    items.forEach(([g, c]) => { const r = ranges[ranges.length - 1]; if (r && g === r.e + 1 && c === r.c) r.e = g; else ranges.push({ s: g, e: g, c }); });
    const w = new W(); w.u16(2); w.u16(ranges.length); ranges.forEach(r => { w.u16(r.s); w.u16(r.e); w.u16(r.c); }); return w.a;
  }
  function pairPos1(entries /* [[leftGid, [[r,v]...]]] sorted */) {
    const w = new W(); const n = entries.length;
    const covOff = 10 + 2 * n;
    w.u16(1); w.u16(0); w.u16(4); w.u16(0); w.u16(n);
    for (let i = 0; i < n; i++) w.u16(0);
    const cov = coverageBytes(entries.map(e => e[0]));
    w.at(2, covOff); w.bytes(cov);
    entries.forEach(([, pairs], i) => {
      w.at(10 + 2 * i, w.length);
      const ps = pairs.slice().sort((a, b) => a[0] - b[0]);
      w.u16(ps.length); ps.forEach(([r, v]) => { w.u16(r); w.i16(v); });
    });
    return w.a;
  }
  function pairPos2(L, R, cells, leftIdx) {
    // L: [[gids]] classes 1..n (only the ones in leftIdx order), R: [[gids]] classes 1..m
    const cd1 = new Map(), cd2 = new Map(), cov = [];
    leftIdx.forEach((li, k) => L[li].forEach(g => { cd1.set(g, k + 1); cov.push(g); }));
    R.forEach((gs, k) => gs.forEach(g => cd2.set(g, k + 1)));
    cov.sort((a, b) => a - b);
    const c1 = leftIdx.length + 1, c2 = R.length + 1;
    const vals = Array.from({ length: c1 }, () => new Array(c2).fill(0));
    const pos = new Map(leftIdx.map((li, k) => [li + 1, k + 1]));
    cells.forEach(([l, r, v]) => { if (pos.has(l)) vals[pos.get(l)][r] = v; });
    const w = new W();
    w.u16(2); w.u16(0); w.u16(4); w.u16(0); w.u16(0); w.u16(0); w.u16(c1); w.u16(c2);
    vals.forEach(row => row.forEach(v => w.i16(v)));
    w.at(2, w.length); w.bytes(coverageBytes(cov));
    w.at(8, w.length); w.bytes(classDefBytes(cd1));
    w.at(10, w.length); w.bytes(classDefBytes(cd2));
    return w.a;
  }
  function gposTable(kd) {
    const subs = [];
    // format 1 chunks (keep each subtable well under 64 KB)
    const ents = [...kd.f1].sort((a, b) => a[0] - b[0]);
    let chunk = [], size = 0;
    ents.forEach(e => { const s = 6 + 4 * e[1].length; if (chunk.length && size + s > 50000) { subs.push(pairPos1(chunk)); chunk = []; size = 0; } chunk.push(e); size += s; });
    if (chunk.length) subs.push(pairPos1(chunk));
    // class kerning, split by left classes if the matrix gets large
    if (kd.cell.length) {
      const perSub = Math.max(1, Math.floor(40000 / ((kd.R.length + 1) * 2)));
      const all = kd.L.map((g, i) => i).filter(i => kd.L[i].length);
      for (let i = 0; i < all.length; i += perSub) subs.push(pairPos2(kd.L, kd.R, kd.cell, all.slice(i, i + perSub)));
    }
    if (!subs.length) return null;
    const w = new W();
    w.u16(1); w.u16(0); w.u16(10); w.u16(0); w.u16(0);
    // ScriptList: DFLT + latn, each with a default LangSys using feature 0
    const sl = w.length; w.u16(2);
    ['DFLT', 'latn'].forEach(() => { w.tag('    '); w.u16(0); });
    ['DFLT', 'latn'].forEach((t, i) => {
      const so = w.length; const r = sl + 2 + i * 6; for (let k = 0; k < 4; k++) w.a[r + k] = t.charCodeAt(k); w.at(r + 4, so - sl);
      w.u16(4); w.u16(0); w.u16(0); w.u16(0xFFFF); w.u16(1); w.u16(0);
    });
    const fl = w.length; w.at(6, fl);
    w.u16(1); w.tag('kern'); w.u16(8); w.u16(0); w.u16(1); w.u16(0);
    const ll = w.length; w.at(8, ll);
    w.u16(1); w.u16(4);
    const lo = w.length;
    const total = subs.reduce((a, s) => a + s.length, 0);
    const ext = 6 + 2 * subs.length + total > 65000;
    w.u16(ext ? 9 : 2); w.u16(0); w.u16(subs.length); subs.forEach(() => w.u16(0));
    if (!ext) subs.forEach((s, i) => { w.at(lo + 6 + 2 * i, w.length - lo); w.bytes(s); });
    else {
      const eo = []; subs.forEach((s, i) => { eo.push(w.length); w.at(lo + 6 + 2 * i, w.length - lo); w.u16(1); w.u16(2); w.u32(0); });
      subs.forEach((s, i) => { const off = w.length - eo[i]; w.a[eo[i] + 4] = (off >>> 24) & 255; w.a[eo[i] + 5] = (off >>> 16) & 255; w.a[eo[i] + 6] = (off >>> 8) & 255; w.a[eo[i] + 7] = off & 255; w.bytes(s); });
    }
    return w.out();
  }
  function kernTable(legacy) {
    if (!legacy.length || legacy.length > 10920) return null;
    const ps = legacy.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), n = ps.length;
    const w = new W(); w.u16(0); w.u16(1); w.u16(0); w.u16(14 + 6 * n); w.u16(1);
    const sr = Math.pow(2, Math.floor(Math.log2(n)));
    w.u16(n); w.u16(sr * 6); w.u16(Math.floor(Math.log2(n))); w.u16((n - sr) * 6);
    ps.forEach(([a, b, v]) => { w.u16(a); w.u16(b); w.i16(v); });
    return w.out();
  }

  // ---------- assembly ----------
  function checksum(b) {
    let s = 0; const n = b.length;
    for (let i = 0; i < n; i += 4) s = (s + ((b[i] << 24) >>> 0) + ((i + 1 < n ? b[i + 1] : 0) << 16) + ((i + 2 < n ? b[i + 2] : 0) << 8) + (i + 3 < n ? b[i + 3] : 0)) >>> 0;
    return s;
  }
  function assemble(tables, flavor) {
    const tags = Object.keys(tables).filter(t => tables[t]).sort();
    const n = tags.length, hdr = 12 + 16 * n;
    let size = hdr; tags.forEach(t => { size += (tables[t].length + 3) & ~3; });
    const out = new Uint8Array(size), dv = new DataView(out.buffer);
    dv.setUint32(0, flavor); dv.setUint16(4, n);
    const sr = Math.pow(2, Math.floor(Math.log2(n)));
    dv.setUint16(6, sr * 16); dv.setUint16(8, Math.floor(Math.log2(n))); dv.setUint16(10, n * 16 - sr * 16);
    let off = hdr, headOff = -1;
    tags.forEach((t, i) => {
      const b = tables[t], r = 12 + 16 * i;
      for (let k = 0; k < 4; k++) out[r + k] = t.charCodeAt(k);
      if (t === 'head') { headOff = off; b[8] = b[9] = b[10] = b[11] = 0; }
      dv.setUint32(r + 4, checksum(b)); dv.setUint32(r + 8, off); dv.setUint32(r + 12, b.length);
      out.set(b, off); off += (b.length + 3) & ~3;
    });
    if (headOff >= 0) dv.setUint32(headOff + 8, (0xB1B0AFBA - checksum(out)) >>> 0);
    return out;
  }
  function tableDir(bytes) {
    const d = bytes, dv = new DataView(d.buffer, d.byteOffset, d.byteLength), n = dv.getUint16(4), t = {};
    for (let i = 0; i < n; i++) { const r = 12 + 16 * i; const tg = String.fromCharCode(d[r], d[r + 1], d[r + 2], d[r + 3]); t[tg] = d.slice(dv.getUint32(r + 8), dv.getUint32(r + 8) + dv.getUint32(r + 12)); }
    return t;
  }

  function metricsFrom(F, boxes) {
    let xMin = 0, yMin = 0, xMax = 0, yMax = 0, any = false, advMax = 0, minL = 0, minR = 0, ext = 0, first = true;
    F.order.forEach((n, i) => {
      const g = F.glyphs[n], b = boxes[i]; advMax = Math.max(advMax, g.advance);
      if (!b) return;
      if (!any) { xMin = b.xMin; yMin = b.yMin; xMax = b.xMax; yMax = b.yMax; any = true; } else { xMin = Math.min(xMin, b.xMin); yMin = Math.min(yMin, b.yMin); xMax = Math.max(xMax, b.xMax); yMax = Math.max(yMax, b.yMax); }
      const l = b.xMin, r = g.advance - b.xMax, e = b.xMax;
      if (first) { minL = l; minR = r; ext = e; first = false; } else { minL = Math.min(minL, l); minR = Math.min(minR, r); ext = Math.max(ext, e); }
    });
    const I = F.info;
    return { xMin, yMin, xMax, yMax, advMax, minL, minR, xMaxExtent: ext,
      winAscent: Math.max(0, Math.round(I.winAscent != null ? I.winAscent : Math.max(I.ascender, yMax))), winDescent: Math.max(0, Math.round(I.winDescent != null ? I.winDescent : Math.max(-I.descender, -yMin))) };
  }

  // ---------- TrueType ----------
  function ttContours(g, tol) {
    return g.contours.map(c => {
      let q = TM.contourToQuadratic(c, tol);
      q = TM.reverseContour(q);   // TrueType: outer contours clockwise
      return q.points.map(p => ({ x: Math.round(p.x), y: Math.round(p.y), on: p.t !== 'o' }));
    }).filter(c => c.length);
  }
  function encodeSimple(cs) {
    const pts = cs.flat(), w = new W();
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
    pts.forEach(p => { xMin = Math.min(xMin, p.x); yMin = Math.min(yMin, p.y); xMax = Math.max(xMax, p.x); yMax = Math.max(yMax, p.y); });
    w.i16(cs.length); w.i16(xMin); w.i16(yMin); w.i16(xMax); w.i16(yMax);
    let e = -1; cs.forEach(c => { e += c.length; w.u16(e); });
    w.u16(0);
    const flags = [], xs = new W(), ys = new W(); let px = 0, py = 0;
    pts.forEach(p => {
      let f = p.on ? 1 : 0; const dx = p.x - px, dy = p.y - py; px = p.x; py = p.y;
      if (dx === 0) f |= 0x10; else if (Math.abs(dx) < 256) { f |= 0x02; if (dx > 0) f |= 0x10; xs.u8(Math.abs(dx)); } else xs.i16(dx);
      if (dy === 0) f |= 0x20; else if (Math.abs(dy) < 256) { f |= 0x04; if (dy > 0) f |= 0x20; ys.u8(Math.abs(dy)); } else ys.i16(dy);
      flags.push(f);
    });
    for (let i = 0; i < flags.length;) {
      let r = 0; while (i + r + 1 < flags.length && flags[i + r + 1] === flags[i] && r < 255) r++;
      if (r > 1) { w.u8(flags[i] | 0x08); w.u8(r); i += r + 1; } else { w.u8(flags[i]); i++; }
    }
    w.bytes(xs.a); w.bytes(ys.a);
    return { bytes: w.a, box: { xMin, yMin, xMax, yMax }, points: pts.length, contours: cs.length };
  }
  const f2ok = v => v >= -2 && v < 2;
  function buildTTF(font, opts = {}) {
    const F = prepare(font, opts), gid = new Map(F.order.map((n, i) => [n, i])), tol = opts.tolerance || 1;
    const N = F.order.length;
    // decide which glyphs stay composite
    const composite = new Map();
    F.order.forEach(n => {
      const g = F.glyphs[n];
      const ok = g.components.length && !g.contours.length && !opts.decompose && g.components.every(c => f2ok(c.m[0]) && f2ok(c.m[1]) && f2ok(c.m[2]) && f2ok(c.m[3]));
      composite.set(n, !!ok);
    });
    // decomposed simple outlines (also needed for composite bboxes / stats)
    const simple = new Map();
    const getSimple = n => {
      if (simple.has(n)) return simple.get(n);
      const g = TM.cloneGlyph(F.glyphs[n]);
      if (g.components.length) { TM.decompose(F, g); if (opts.correctDirection !== false) TM.correctDirections(g); }
      const r = encodeSimple(ttContours(g, tol)); simple.set(n, r); return r;
    };
    const depth = (n, d = 0) => { const g = F.glyphs[n]; if (!composite.get(n) || d > 10) return 0; return 1 + Math.max(0, ...g.components.map(c => depth(c.base, d + 1))); };
    const glyf = new W(), loca = [], boxes = [], lsbs = [];
    let maxP = 0, maxC = 0, maxCP = 0, maxCC = 0, maxCE = 0, maxCD = 0;
    F.order.forEach((n, i) => {
      loca.push(glyf.length);
      const g = F.glyphs[n];
      if (!g.contours.length && !g.components.length) { boxes.push(null); lsbs.push(0); return; }
      const s = getSimple(n);
      if (!s.points) { boxes.push(null); lsbs.push(0); return; }
      if (composite.get(n)) {
        const w = new W(); w.i16(-1); w.i16(s.box.xMin); w.i16(s.box.yMin); w.i16(s.box.xMax); w.i16(s.box.yMax);
        g.components.forEach((c, k) => {
          const [a, b, cc, d, dx, dy] = c.m;
          let fl = 0x0001 | 0x0002 | 0x0004; if (k < g.components.length - 1) fl |= 0x0020;
          if (b || cc) fl |= 0x0080; else if (a !== d) fl |= 0x0040; else if (a !== 1) fl |= 0x0008;
          if (k === 0 && a === 1 && d === 1 && !b && !cc && !dx && !dy && F.glyphs[c.base].advance === g.advance) fl |= 0x0200;
          w.u16(fl); w.u16(gid.get(c.base)); w.i16(dx); w.i16(dy);
          if (fl & 0x0080) { w.f2dot14(a); w.f2dot14(b); w.f2dot14(cc); w.f2dot14(d); } else if (fl & 0x0040) { w.f2dot14(a); w.f2dot14(d); } else if (fl & 0x0008) w.f2dot14(a);
        });
        glyf.bytes(w.a);
        maxCP = Math.max(maxCP, s.points); maxCC = Math.max(maxCC, s.contours); maxCE = Math.max(maxCE, g.components.length); maxCD = Math.max(maxCD, depth(n));
      } else {
        glyf.bytes(s.bytes); maxP = Math.max(maxP, s.points); maxC = Math.max(maxC, s.contours);
      }
      glyf.pad(4);
      boxes.push(s.box); lsbs.push(s.box.xMin);
    });
    loca.push(glyf.length);
    const locLong = glyf.length > 0x1FFFE;
    const lw = new W(); loca.forEach(o => locLong ? lw.u32(o) : lw.u16(o / 2));
    const m = metricsFrom(F, boxes); m.tt = true;
    const st = styleInfo(F.info), ent = cmapEntries(F, gid), cps = ent.map(e => e[0]);
    const kd = kerningData(F, font, gid), gpos = opts.kerning === false ? null : gposTable(kd);
    const mx = new W(); mx.u32(0x00010000); mx.u16(N); mx.u16(maxP); mx.u16(maxC); mx.u16(maxCP); mx.u16(maxCC); mx.u16(2); mx.u16(0); mx.u16(0); mx.u16(0); mx.u16(0); mx.u16(0); mx.u16(0); mx.u16(maxCE); mx.u16(maxCD);
    const tables = {
      head: headTable(F, m, st, locLong, opts.timestamp), hhea: hheaTable(F, m, N), maxp: mx.out(), 'OS/2': os2Table(F, st, m, cps, !!gpos),
      hmtx: hmtxTable(F, lsbs), cmap: cmapTable(ent), loca: lw.out(), glyf: glyf.out(), name: nameTable(F.info, st), post: postTable(F, true),
      GPOS: gpos, kern: opts.kerning === false || opts.legacyKern === false ? null : kernTable(kd.legacy),
    };
    return assemble(tables, 0x00010000);
  }

  // ---------- CFF (Type 2 charstrings) ----------
  const CFF_STD = [".notdef", "space", "exclam", "quotedbl", "numbersign", "dollar", "percent", "ampersand", "quoteright", "parenleft", "parenright", "asterisk", "plus", "comma", "hyphen", "period", "slash", "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "colon", "semicolon", "less", "equal", "greater", "question", "at", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "bracketleft", "backslash", "bracketright", "asciicircum", "underscore", "quoteleft", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o", "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "braceleft", "bar", "braceright", "asciitilde", "exclamdown", "cent", "sterling", "fraction", "yen", "florin", "section", "currency", "quotesingle", "quotedblleft", "guillemotleft", "guilsinglleft", "guilsinglright", "fi", "fl", "endash", "dagger", "daggerdbl", "periodcentered", "paragraph", "bullet", "quotesinglbase", "quotedblbase", "quotedblright", "guillemotright", "ellipsis", "perthousand", "questiondown", "grave", "acute", "circumflex", "tilde", "macron", "breve", "dotaccent", "dieresis", "ring", "cedilla", "hungarumlaut", "ogonek", "caron", "emdash", "AE", "ordfeminine", "Lslash", "Oslash", "OE", "ordmasculine", "ae", "dotlessi", "lslash", "oslash", "oe", "germandbls", "onesuperior", "logicalnot", "mu", "trademark", "Eth", "onehalf", "plusminus", "Thorn", "onequarter", "divide", "brokenbar", "degree", "thorn", "threequarters", "twosuperior", "registered", "minus", "eth", "multiply", "threesuperior", "copyright", "Aacute", "Acircumflex", "Adieresis", "Agrave", "Aring", "Atilde", "Ccedilla", "Eacute", "Ecircumflex", "Edieresis", "Egrave", "Iacute", "Icircumflex", "Idieresis", "Igrave", "Ntilde", "Oacute", "Ocircumflex", "Odieresis", "Ograve", "Otilde", "Scaron", "Uacute", "Ucircumflex", "Udieresis", "Ugrave", "Yacute", "Ydieresis", "Zcaron", "aacute", "acircumflex", "adieresis", "agrave", "aring", "atilde", "ccedilla", "eacute", "ecircumflex", "edieresis", "egrave", "iacute", "icircumflex", "idieresis", "igrave", "ntilde", "oacute", "ocircumflex", "odieresis", "ograve", "otilde", "scaron", "uacute", "ucircumflex", "udieresis", "ugrave", "yacute", "ydieresis", "zcaron", "exclamsmall", "Hungarumlautsmall", "dollaroldstyle", "dollarsuperior", "ampersandsmall", "Acutesmall", "parenleftsuperior", "parenrightsuperior", "266 ff", "onedotenleader", "zerooldstyle", "oneoldstyle", "twooldstyle", "threeoldstyle", "fouroldstyle", "fiveoldstyle", "sixoldstyle", "sevenoldstyle", "eightoldstyle", "nineoldstyle", "commasuperior", "threequartersemdash", "periodsuperior", "questionsmall", "asuperior", "bsuperior", "centsuperior", "dsuperior", "esuperior", "isuperior", "lsuperior", "msuperior", "nsuperior", "osuperior", "rsuperior", "ssuperior", "tsuperior", "ff", "ffi", "ffl", "parenleftinferior", "parenrightinferior", "Circumflexsmall", "hyphensuperior", "Gravesmall", "Asmall", "Bsmall", "Csmall", "Dsmall", "Esmall", "Fsmall", "Gsmall", "Hsmall", "Ismall", "Jsmall", "Ksmall", "Lsmall", "Msmall", "Nsmall", "Osmall", "Psmall", "Qsmall", "Rsmall", "Ssmall", "Tsmall", "Usmall", "Vsmall", "Wsmall", "Xsmall", "Ysmall", "Zsmall", "colonmonetary", "onefitted", "rupiah", "Tildesmall", "exclamdownsmall", "centoldstyle", "Lslashsmall", "Scaronsmall", "Zcaronsmall", "Dieresissmall", "Brevesmall", "Caronsmall", "Dotaccentsmall", "Macronsmall", "figuredash", "hypheninferior", "Ogoneksmall", "Ringsmall", "Cedillasmall", "questiondownsmall", "oneeighth", "threeeighths", "fiveeighths", "seveneighths", "onethird", "twothirds", "zerosuperior", "foursuperior", "fivesuperior", "sixsuperior", "sevensuperior", "eightsuperior", "ninesuperior", "zeroinferior", "oneinferior", "twoinferior", "threeinferior", "fourinferior", "fiveinferior", "sixinferior", "seveninferior", "eightinferior", "nineinferior", "centinferior", "dollarinferior", "periodinferior", "commainferior", "Agravesmall", "Aacutesmall", "Acircumflexsmall", "Atildesmall", "Adieresissmall", "Aringsmall", "AEsmall", "Ccedillasmall", "Egravesmall", "Eacutesmall", "Ecircumflexsmall", "Edieresissmall", "Igravesmall", "Iacutesmall", "Icircumflexsmall", "Idieresissmall", "Ethsmall", "Ntildesmall", "Ogravesmall", "Oacutesmall", "Ocircumflexsmall", "Otildesmall", "Odieresissmall", "OEsmall", "Oslashsmall", "Ugravesmall", "Uacutesmall", "Ucircumflexsmall", "Udieresissmall", "Yacutesmall", "Thornsmall", "Ydieresissmall", "001.000", "001.001", "001.002", "001.003", "Black", "Bold", "Book", "Light", "Medium", "Regular", "Roman", "Semibold"];
  const CFF_SID = new Map(CFF_STD.map((n, i) => [n, i]));
  function cffNum(v, out) {   // DICT / charstring integer
    v = Math.round(v);
    if (v >= -107 && v <= 107) out.push(v + 139);
    else if (v >= 108 && v <= 1131) { v -= 108; out.push((v >> 8) + 247, v & 255); }
    else if (v >= -1131 && v <= -108) { v = -v - 108; out.push((v >> 8) + 251, v & 255); }
    else if (v >= -32768 && v <= 32767) out.push(28, (v >> 8) & 255, v & 255);
    else out.push(29, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  }
  const cffInt32 = (v, out) => out.push(29, (v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  function cffReal(v, out) {   // DICT real number (nibble encoded)
    let s = String(+v.toPrecision(10)).replace(/^0\./, '.').replace(/^-0\./, '-.');
    s = s.replace(/e\+?/i, 'E'); const nib = [];
    for (let i = 0; i < s.length; i++) { const c = s[i]; if (c >= '0' && c <= '9') nib.push(+c); else if (c === '.') nib.push(0xa); else if (c === '-') nib.push(0xe); else if (c === 'E') { if (s[i + 1] === '-') { nib.push(0xc); i++; } else nib.push(0xb); } }
    nib.push(0xf); if (nib.length % 2) nib.push(0xf);
    out.push(30); for (let i = 0; i < nib.length; i += 2) out.push((nib[i] << 4) | nib[i + 1]);
  }
  function cffIndex(items) {
    const out = [], n = items.length;
    out.push((n >> 8) & 255, n & 255); if (!n) return out;
    let total = 1; items.forEach(b => { total += b.length; });
    const os = total < 0x100 ? 1 : total < 0x10000 ? 2 : total < 0x1000000 ? 3 : 4;
    out.push(os);
    let off = 1; const wr = v => { for (let k = os - 1; k >= 0; k--) out.push((v >>> (8 * k)) & 255); };
    wr(off); items.forEach(b => { off += b.length; wr(off); });
    items.forEach(b => { for (let i = 0; i < b.length; i++) out.push(b[i]); });
    return out;
  }
  // cmds: line / cubic path commands in font units (rounded) → Type 2 charstring (width always written, nominalWidthX 0)
  function charstring(cmds, width) {
    const o = []; let x = 0, y = 0, first = true;
    const op = (args, code) => { if (first) { cffNum(width, o); first = false; } args.forEach(a => cffNum(a, o)); o.push(code); };
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i];
      if (c[0] === 'M') { op([c[1] - x, c[2] - y], 21); x = c[1]; y = c[2]; }
      else if (c[0] === 'L') { if (c[1] === x && c[2] === y) continue; op([c[1] - x, c[2] - y], 5); x = c[1]; y = c[2]; }
      else if (c[0] === 'C') { op([c[1] - x, c[2] - y, c[3] - c[1], c[4] - c[2], c[5] - c[3], c[6] - c[4]], 8); x = c[5]; y = c[6]; }
      // 'Z': CFF closes every contour implicitly
    }
    if (first) cffNum(width, o);
    o.push(14);
    return o;
  }
  function buildCFF(F, glyphCmds, boxes, st) {
    const I = F.info, strings = [];
    const sid = s => { if (CFF_SID.has(s)) return CFF_SID.get(s); let k = strings.indexOf(s); if (k < 0) { strings.push(s); k = strings.length - 1; } return 391 + k; };
    const te = s => Array.from(s, ch => ch.charCodeAt(0) & 255);
    const ascii = s => String(s || '').replace(/©/g, '(c)').replace(/[^\x20-\x7E]/g, '');
    const sVersion = sid(`${Math.round(I.versionMajor)}.${String(Math.round(I.versionMinor)).padStart(3, '0')}`), sNotice = I.copyright ? sid(ascii(I.copyright).slice(0, 400)) : null;
    const sFull = sid(ascii(st.full)), sFam = sid(ascii(st.fam1)), sWeight = sid(st.bold ? 'Bold' : 'Regular');
    const nameSIDs = F.order.slice(1).map(n => sid(n));
    let xMin = 0, yMin = 0, xMax = 0, yMax = 0; boxes.forEach(b => { if (!b) return; xMin = Math.min(xMin, b.xMin); yMin = Math.min(yMin, b.yMin); xMax = Math.max(xMax, b.xMax); yMax = Math.max(yMax, b.yMax); });
    const charstrings = F.order.map((n, i) => charstring(glyphCmds[i], F.glyphs[n].advance));
    const priv = []; cffNum(0, priv); priv.push(20); cffNum(0, priv); priv.push(21);
    const topDict = (charsetOff, csOff, privOff) => {
      const d = [];
      cffNum(sVersion, d); d.push(0); if (sNotice != null) { cffNum(sNotice, d); d.push(1); }
      cffNum(sFull, d); d.push(2); cffNum(sFam, d); d.push(3); cffNum(sWeight, d); d.push(4);
      if (I.italicAngle) { (Number.isInteger(I.italicAngle) ? cffNum : cffReal)(I.italicAngle, d); d.push(12, 2); }
      cffNum(I.underlinePosition, d); d.push(12, 3); cffNum(I.underlineThickness, d); d.push(12, 4);
      if (I.unitsPerEm !== 1000) { [1 / I.unitsPerEm, 0, 0, 1 / I.unitsPerEm, 0, 0].forEach(v => v ? cffReal(v, d) : cffNum(0, d)); d.push(12, 7); }
      [xMin, yMin, xMax, yMax].forEach(v => cffNum(v, d)); d.push(5);
      cffInt32(charsetOff, d); d.push(15); cffInt32(csOff, d); d.push(17);
      cffInt32(priv.length, d); cffInt32(privOff, d); d.push(18);
      return d;
    };
    const header = [1, 0, 4, 4];
    const nameIdx = cffIndex([te(st.ps)]), strIdx = cffIndex(strings.map(te)), gsubr = cffIndex([]);
    const charset = [0]; nameSIDs.forEach(s => charset.push((s >> 8) & 255, s & 255));
    const csIdx = cffIndex(charstrings);
    const topLen = cffIndex([topDict(0, 0, 0)]).length;   // fixed size: offsets use 5-byte integers
    const charsetOff = header.length + nameIdx.length + topLen + strIdx.length + gsubr.length, csOff = charsetOff + charset.length, privOff = csOff + csIdx.length;
    const top = cffIndex([topDict(charsetOff, csOff, privOff)]);
    const out = new Uint8Array(privOff + priv.length); let o = 0;
    [header, nameIdx, top, strIdx, gsubr].forEach(b => { out.set(b, o); o += b.length; });
    out.set(charset, charsetOff); out.set(csIdx, csOff); out.set(priv, privOff);
    return out;
  }

  // ---------- OpenType CFF ----------
  // opentype.js is no longer needed for writing (its encoder is quadratic in the glyph count); the argument is accepted for compatibility
  function buildOTF(font, opentypeOrOpts, opts) {
    if (opts == null) opts = opentypeOrOpts && !opentypeOrOpts.Font ? opentypeOrOpts : {};
    const F = prepare(font, opts), gid = new Map(F.order.map((n, i) => [n, i])), st = styleInfo(F.info);
    const boxes = [], lsbs = [], cmdsAll = [];
    F.order.forEach(n => {
      const g = TM.cloneGlyph(F.glyphs[n]);
      if (g.components.length) { TM.decompose(F, g); if (opts.correctDirection !== false) TM.correctDirections(g); }
      g.contours = g.contours.map(c => TM.contourToCubic(c));
      TM.roundGlyph(g);
      const cmds = TM.glyphCommands(F, g);
      const b = TM.commandsBounds(cmds);
      const box = b ? { xMin: Math.floor(b.xMin), yMin: Math.floor(b.yMin), xMax: Math.ceil(b.xMax), yMax: Math.ceil(b.yMax) } : null;
      boxes.push(box); lsbs.push(box ? box.xMin : 0); cmdsAll.push(cmds);
    });
    const m = metricsFrom(F, boxes);
    const ent = cmapEntries(F, gid), cps = ent.map(e => e[0]);
    const kd = kerningData(F, font, gid), gpos = opts.kerning === false ? null : gposTable(kd);
    const mx = new W(); mx.u32(0x00005000); mx.u16(F.order.length);
    const tables = {
      'CFF ': buildCFF(F, cmdsAll, boxes, st), head: headTable(F, m, st, false, opts.timestamp), hhea: hheaTable(F, m, F.order.length), maxp: mx.out(), 'OS/2': os2Table(F, st, m, cps, !!gpos),
      hmtx: hmtxTable(F, lsbs), cmap: cmapTable(ent), name: nameTable(F.info, st), post: postTable(F, false),
      GPOS: gpos, kern: opts.kerning === false || opts.legacyKern === false ? null : kernTable(kd.legacy),
    };
    return assemble(tables, 0x4F54544F);
  }

  // ---------- WOFF 1.0 ----------
  function buildWOFF(sfnt, zlib) {
    const d = sfnt, dv = new DataView(d.buffer, d.byteOffset, d.byteLength), n = dv.getUint16(4);
    const ents = [];
    for (let i = 0; i < n; i++) {
      const r = 12 + 16 * i, tg = d.subarray(r, r + 4), cs = dv.getUint32(r + 4), off = dv.getUint32(r + 8), len = dv.getUint32(r + 12);
      const raw = d.subarray(off, off + len); let comp = zlib(raw); if (comp.length >= raw.length) comp = raw;
      ents.push({ tg, cs, len, comp });
    }
    let size = 44 + 20 * n; ents.forEach(e => { e.off = size; size += (e.comp.length + 3) & ~3; });
    const out = new Uint8Array(size), ov = new DataView(out.buffer);
    out.set([0x77, 0x4F, 0x46, 0x46]); ov.setUint32(4, dv.getUint32(0)); ov.setUint32(8, size); ov.setUint16(12, n);
    let total = 12 + 16 * n; ents.forEach(e => { total += (e.len + 3) & ~3; });
    ov.setUint32(16, total); ov.setUint16(20, 1); ov.setUint16(22, 0);
    ents.forEach((e, i) => { const r = 44 + 20 * i; out.set(e.tg, r); ov.setUint32(r + 4, e.off); ov.setUint32(r + 8, e.comp.length); ov.setUint32(r + 12, e.len); ov.setUint32(r + 16, e.cs); out.set(e.comp, e.off); });
    return out;
  }

  const SF = { styleInfo, prepare, buildTTF, buildOTF, buildWOFF, assemble, tableDir, checksum, kerningData, gposTable };
  if (typeof module === 'object' && module.exports) module.exports = SF; else root.SFNT = SF;
})(typeof window !== 'undefined' ? window : globalThis);
