// Lumen Type import: TTF / OTF / WOFF (via opentype.js + own table reader for kerning), WOFF2 (after decompression),
// zipped UFO folders, and UFO zip export. No DOM — runs in Node tests too.
(function (root) {
  'use strict';
  const TM = root.TM || require('./model.js');

  // ---------- binary helpers ----------
  const u16 = (d, o) => (d[o] << 8) | d[o + 1];
  const i16 = (d, o) => { const v = u16(d, o); return v & 0x8000 ? v - 0x10000 : v; };
  const u32 = (d, o) => ((d[o] << 24) >>> 0) + (d[o + 1] << 16) + (d[o + 2] << 8) + d[o + 3];
  const tag = (d, o) => String.fromCharCode(d[o], d[o + 1], d[o + 2], d[o + 3]);

  function sniff(buf) {
    const d = new Uint8Array(buf, 0, Math.min(8, buf.byteLength)); if (d.length < 4) return 'unknown';
    const t = tag(d, 0);
    if (t === 'wOFF') return 'woff'; if (t === 'wOF2') return 'woff2'; if (t === 'OTTO') return 'otf'; if (t === 'ttcf') return 'ttc';
    if (u32(d, 0) === 0x00010000 || t === 'true') return 'ttf';
    if (d[0] === 0x50 && d[1] === 0x4B) return 'zip';
    if (d[0] === 0x7B) return 'json';
    return 'unknown';
  }
  // table map {tag: Uint8Array} from an sfnt or WOFF 1.0 file
  function readTables(buf, inflate) {
    const d = new Uint8Array(buf), kind = sniff(buf), out = {};
    if (kind === 'woff') {
      const n = u16(d, 12);
      for (let i = 0; i < n; i++) {
        const o = 44 + i * 20, t = tag(d, o), off = u32(d, o + 4), comp = u32(d, o + 8), orig = u32(d, o + 12);
        const raw = d.subarray(off, off + comp);
        out[t] = comp < orig ? inflate(raw) : raw;
      }
      return out;
    }
    let base = 0;
    if (kind === 'ttc') base = u32(d, 12);
    const n = u16(d, base + 4);
    for (let i = 0; i < n; i++) { const o = base + 12 + i * 16; out[tag(d, o)] = d.subarray(u32(d, o + 8), u32(d, o + 8) + u32(d, o + 12)); }
    return out;
  }

  // ---------- GPOS pair kerning reader ----------
  function coverage(d, o) {
    const f = u16(d, o), r = [];
    if (f === 1) { const n = u16(d, o + 2); for (let i = 0; i < n; i++) r.push(u16(d, o + 4 + i * 2)); }
    else if (f === 2) { const n = u16(d, o + 2); for (let i = 0; i < n; i++) { const s = u16(d, o + 4 + i * 6), e = u16(d, o + 6 + i * 6); for (let g = s; g <= e; g++) r.push(g); } }
    return r;
  }
  function classDef(d, o) {
    const f = u16(d, o), m = new Map();
    if (f === 1) { const s = u16(d, o + 2), n = u16(d, o + 4); for (let i = 0; i < n; i++) { const c = u16(d, o + 6 + i * 2); if (c) m.set(s + i, c); } }
    else if (f === 2) { const n = u16(d, o + 2); for (let i = 0; i < n; i++) { const s = u16(d, o + 4 + i * 6), e = u16(d, o + 6 + i * 6), c = u16(d, o + 8 + i * 6); if (c) for (let g = s; g <= e; g++) m.set(g, c); } }
    return m;
  }
  const vfSize = vf => { let n = 0; for (let b = 0; b < 8; b++) if (vf & (1 << b)) n += 2; return n; };
  function xAdvance(d, o, vf) {
    let off = o, v = 0, has = false;
    for (let b = 0; b < 8; b++) if (vf & (1 << b)) { if (b === 2) { v = i16(d, off); has = true; } else if (b === 0 && !(vf & 4)) { /* XPlacement only: ignore */ } off += 2; }
    return has ? v : 0;
  }
  // returns list of subtables: {type:1, pairs:[[g1,g2,v]]} | {type:2, cov:[g], cd1:Map, cd2:Map, c1, c2, vals:[[v]]}
  function readGPOSKern(d) {
    if (!d || d.length < 10) return [];
    const scriptList = u16(d, 4), featList = u16(d, 6), lookupList = u16(d, 8);
    const nf = u16(d, featList), lk = new Set();
    for (let i = 0; i < nf; i++) {
      const r = featList + 2 + i * 6; if (tag(d, r) !== 'kern') continue;
      const fo = featList + u16(d, r + 4), n = u16(d, fo + 2);
      for (let k = 0; k < n; k++) lk.add(u16(d, fo + 4 + k * 2));
    }
    void scriptList;
    const lookups = [];
    [...lk].sort((a, b) => a - b).forEach(li => {
      const out = []; lookups.push(out);
      const lo = lookupList + u16(d, lookupList + 2 + li * 2);
      let type = u16(d, lo); const ns = u16(d, lo + 4);
      for (let s = 0; s < ns; s++) {
        let so = lo + u16(d, lo + 6 + s * 2), t = type;
        if (t === 9) { t = u16(d, so + 2); so = so + u32(d, so + 4); }
        if (t !== 2) continue;
        const fmt = u16(d, so), cov = coverage(d, so + u16(d, so + 2)), vf1 = u16(d, so + 4), vf2 = u16(d, so + 6), s1 = vfSize(vf1), s2 = vfSize(vf2);
        if (fmt === 1) {
          const n = u16(d, so + 8), pairs = [];
          for (let i = 0; i < n && i < cov.length; i++) {
            const po = so + u16(d, so + 10 + i * 2), pc = u16(d, po);
            for (let k = 0; k < pc; k++) { const r = po + 2 + k * (2 + s1 + s2); pairs.push([cov[i], u16(d, r), xAdvance(d, r + 2, vf1)]); }
          }
          out.push({ type: 1, pairs });
        } else if (fmt === 2) {
          const cd1 = classDef(d, so + u16(d, so + 8)), cd2 = classDef(d, so + u16(d, so + 10)), c1 = u16(d, so + 12), c2 = u16(d, so + 14);
          const vals = []; let r = so + 16;
          for (let i = 0; i < c1; i++) { const row = []; for (let k = 0; k < c2; k++) { row.push(xAdvance(d, r, vf1)); r += s1 + s2; } vals.push(row); }
          out.push({ type: 2, cov, cd1, cd2, c1, c2, vals });
        }
      }
    });
    return lookups.filter(l => l.length);
  }
  // OpenType evaluation of one PairPos lookup: first subtable that applies wins
  function lookupEval(subs) {
    const f1 = subs.map(st => st.type === 1 ? new Map(st.pairs.map(([a, b, v]) => [a * 65536 + b, v])) : null);
    const cov = subs.map(st => new Set(st.type === 1 ? st.pairs.map(p => p[0]) : st.cov));
    return (a, b) => {
      for (let i = 0; i < subs.length; i++) {
        const st = subs[i];
        if (st.type === 1) { const v = f1[i].get(a * 65536 + b); if (v != null) return v; continue; }
        if (!cov[i].has(a)) continue;
        const c1 = st.cd1.get(a) || 0, c2 = st.cd2.get(b) || 0;
        return st.vals[c1] ? st.vals[c1][c2] || 0 : 0;
      }
      return 0;
    };
  }
  // convert GPOS subtables into UFO groups + kerning
  function gposToUFO(lookups, names) {
    if (!lookups.length) return { groups: {}, kerning: {} };
    // the lookup with the most data becomes groups + kerning; further kern lookups (applied on top in OpenType) become exceptions
    const size = l => l.reduce((a, st) => a + (st.type === 1 ? st.pairs.length : st.cov.length * st.c2), 0);
    const order = lookups.map((l, i) => i).sort((a, b) => size(lookups[b]) - size(lookups[a]));
    const res = subsToUFO(lookups[order[0]], names);
    if (order.length > 1) {
      const evals = order.map(i => lookupEval(lookups[i])), gid = new Map(names.map((n, i) => [n, i]));
      const font = { groups: res.groups, kerning: res.kerning };
      const extra = new Map();
      order.slice(1).forEach(li => {
        lookups[li].forEach(st => {
          const cand = [];
          if (st.type === 1) st.pairs.forEach(([a, b]) => cand.push([a, b]));
          else { const R = [...st.cd2.keys()]; st.cov.forEach(a => R.forEach(b => cand.push([a, b]))); }
          cand.forEach(([a, b]) => { const k = a * 65536 + b; if (!extra.has(k)) extra.set(k, [a, b]); });
        });
      });
      extra.forEach(([a, b]) => {
        if (!names[a] || !names[b]) return;
        let tot = 0; evals.forEach(ev => { tot += ev(a, b); });
        const prim = TM.kernValue(font, names[a], names[b]);
        if (tot !== prim) { (res.kerning[names[a]] = res.kerning[names[a]] || {})[names[b]] = tot; }
      });
      void gid;
    }
    return res;
  }
  function subsToUFO(subs, names) {
    const groups = {}, kerning = {}, k1Of = new Map(), k2Of = new Map(), groupBySet = new Map();
    const set = (l, r, v) => { if (!kerning[l]) kerning[l] = {}; if (kerning[l][r] == null) kerning[l][r] = v; };
    const uniq = base => { let n = base, i = 1; while (groups[n]) n = base + '_' + (++i); return n; };
    for (const st of subs) {
      if (st.type === 1) { st.pairs.forEach(([a, b, v]) => { if (names[a] && names[b]) set(names[a], names[b], v); }); continue; }
      // left classes: coverage glyphs grouped by cd1 (class 0 = coverage glyphs without a class)
      const L = new Map();
      st.cov.forEach(g => { const c = st.cd1.get(g) || 0; if (!L.has(c)) L.set(c, []); L.get(c).push(g); });
      const R = new Map();
      st.cd2.forEach((c, g) => { if (!R.has(c)) R.set(c, []); R.get(c).push(g); });
      const leftKey = new Map(), rightKey = new Map(), rightLoose = new Map();
      L.forEach((gs, c) => {
        const mem = gs.map(g => names[g]).filter(Boolean).filter(n => !k1Of.has(n));
        if (!mem.length) return;
        if (mem.length === 1 && gs.length === 1) { leftKey.set(c, mem); return; }
        const gname = uniq('public.kern1.' + mem[0]); groups[gname] = mem; mem.forEach(n => k1Of.set(n, gname)); leftKey.set(c, [gname]);
      });
      R.forEach((gs, c) => {
        const all = gs.map(g => names[g]).filter(Boolean); if (!all.length) return;
        const sig = all.slice().sort().join(' ');
        if (groupBySet.has(sig)) { rightKey.set(c, groupBySet.get(sig)); return; }
        const free = all.filter(n => !k2Of.has(n)), taken = all.filter(n => k2Of.has(n));
        if (free.length) { const gname = uniq('public.kern2.' + free[0]); groups[gname] = free; free.forEach(n => k2Of.set(n, gname)); rightKey.set(c, gname); groupBySet.set(sig, gname); }
        if (taken.length) rightLoose.set(c, taken);
      });
      for (let a = 0; a < st.c1; a++) for (let b = 1; b < st.c2; b++) {
        const v = st.vals[a] && st.vals[a][b]; if (!v) continue;
        const lk = leftKey.get(a); if (!lk) continue;
        lk.forEach(l => { const rk = rightKey.get(b); if (rk) set(l, rk, v); (rightLoose.get(b) || []).forEach(r => set(l, r, v)); });
      }
    }
    return { groups, kerning };
  }

  // ---------- opentype.js font → model ----------
  const cleanName = (n, used, i) => {
    let s = String(n || '').replace(/[^A-Za-z0-9._\-]/g, '').slice(0, 63);
    if (!s || /^\d/.test(s) && false) s = 'glyph' + i;
    if (!s) s = 'glyph' + i;
    let r = s, k = 1; while (used.has(r)) r = s + '.' + (k++);
    used.add(r); return r;
  };
  function importOpenType(buf, opentype, inflate) {
    const ot = opentype.parse(buf);
    const tables = readTables(buf, inflate);
    const head = ot.tables.head, os2 = ot.tables.os2 || {}, hhea = ot.tables.hhea || {}, post = ot.tables.post || {}, N = ot.names || {};
    const nm = k => (N[k] && (N[k].en || Object.values(N[k])[0])) || '';
    const upm = ot.unitsPerEm;
    const rev = head.fontRevision || 1, vMaj = Math.floor(rev), vMin = Math.round((rev - vMaj) * 1000);
    const info = Object.assign({}, TM.DEFAULT_INFO, {
      familyName: nm('preferredFamily') || nm('fontFamily') || 'Imported', styleName: nm('preferredSubfamily') || nm('fontSubfamily') || 'Regular',
      versionMajor: vMaj, versionMinor: vMin, copyright: nm('copyright'), trademark: nm('trademark'), designer: nm('designer'), designerURL: nm('designerURL'),
      manufacturer: nm('manufacturer'), manufacturerURL: nm('manufacturerURL'), license: nm('license'), licenseURL: nm('licenseURL'), description: nm('description'),
      vendorID: (os2.achVendID || 'NONE').replace(/[^\x20-\x7E]/g, '').trim() || 'NONE', weightClass: os2.usWeightClass || 400, widthClass: os2.usWidthClass || 5,
      italicAngle: post.italicAngle || 0, unitsPerEm: upm,
      ascender: os2.sTypoAscender != null ? os2.sTypoAscender : hhea.ascender, descender: os2.sTypoDescender != null ? os2.sTypoDescender : hhea.descender,
      lineGap: os2.sTypoLineGap != null ? os2.sTypoLineGap : (hhea.lineGap || 0),
      xHeight: os2.sxHeight || Math.round(upm * 0.5), capHeight: os2.sCapHeight || Math.round(upm * 0.7),
      underlinePosition: post.underlinePosition || -Math.round(upm * 0.1), underlineThickness: post.underlineThickness || Math.round(upm * 0.05),
      winAscent: os2.usWinAscent || null, winDescent: os2.usWinDescent || null, useTypoMetrics: !!(os2.fsSelection & 128), fsType: 0,
    });
    const used = new Set(), names = [];
    const n = ot.glyphs.length;
    for (let i = 0; i < n; i++) {
      const g = ot.glyphs.get(i);
      let name = g.name;
      if (!name || name === 'null' && i) name = g.unicode != null ? TM.glyphNameFor(g.unicode) : 'glyph' + i;
      if (i === 0) name = '.notdef';
      names.push(cleanName(name, used, i));
    }
    const glyphs = {}, order = [];
    const tt = ot.outlinesFormat === 'truetype';
    for (let i = 0; i < n; i++) {
      const g = ot.glyphs.get(i), name = names[i];
      const path = g.path;   // triggers lazy parse (points / components)
      const G = TM.newGlyph(name, (g.unicodes || []).filter(u => u != null), g.advanceWidth || 0);
      if (tt && g.isComposite && g.components) {
        g.components.forEach(c => { if (names[c.glyphIndex]) G.components.push({ base: names[c.glyphIndex], m: [c.xScale ?? 1, c.scale01 || 0, c.scale10 || 0, c.yScale ?? 1, c.dx || 0, c.dy || 0] }); });
      } else if (tt && g.points && g.points.length) {
        let cur = [];
        g.points.forEach(p => {
          cur.push({ x: p.x, y: p.y, t: p.onCurve ? 'l' : 'o' });
          if (p.lastPointOfContour) {
            // on-curve after off-curve → quadratic
            for (let k = 0; k < cur.length; k++) if (cur[k].t !== 'o' && cur[(k + cur.length - 1) % cur.length].t === 'o') cur[k].t = 'q';
            G.contours.push(TM.canonical(TM.reverseContour({ points: cur }))); cur = [];
          }
        });
      } else if (path && path.commands.length) {
        let cur = null;
        const close = () => {
          if (!cur || cur.length < 2) { cur = null; return; }
          const f = cur[0], l = cur[cur.length - 1];
          if (l.t !== 'o' && Math.abs(f.x - l.x) < 1e-6 && Math.abs(f.y - l.y) < 1e-6) { cur.pop(); f.t = l.t; } else f.t = 'l';
          G.contours.push(TM.canonical({ points: cur })); cur = null;
        };
        path.commands.forEach(c => {
          if (c.type === 'M') { close(); cur = [{ x: c.x, y: c.y, t: 'l' }]; }
          else if (c.type === 'L') cur.push({ x: c.x, y: c.y, t: 'l' });
          else if (c.type === 'C') cur.push({ x: c.x1, y: c.y1, t: 'o' }, { x: c.x2, y: c.y2, t: 'o' }, { x: c.x, y: c.y, t: 'c' });
          else if (c.type === 'Q') cur.push({ x: c.x1, y: c.y1, t: 'o' }, { x: c.x, y: c.y, t: 'q' });
          else if (c.type === 'Z') close();
        });
        close();
      }
      markSmooth(G);
      glyphs[name] = G; order.push(name);
    }
    // kerning: GPOS first, legacy kern table as fallback
    let groups = {}, kerning = {};
    try { const r = gposToUFO(readGPOSKern(tables.GPOS), names); groups = r.groups; kerning = r.kerning; } catch (e) { /* ignore broken GPOS */ }
    if (!Object.keys(kerning).length && ot.kerningPairs) Object.entries(ot.kerningPairs).forEach(([k, v]) => { const [a, b] = k.split(',').map(Number); if (names[a] && names[b] && v) (kerning[names[a]] = kerning[names[a]] || {})[names[b]] = v; });
    return { info, order, glyphs, groups, kerning };
  }
  // flag on-curve points whose handles are collinear as smooth
  function markSmooth(g) {
    g.contours.forEach(c => {
      const P = c.points, n = P.length;
      P.forEach((p, i) => {
        if (p.t === 'o') return;
        const a = P[(i + n - 1) % n], b = P[(i + 1) % n];
        if (a.t !== 'o' && b.t !== 'o') return;
        const v1x = p.x - a.x, v1y = p.y - a.y, v2x = b.x - p.x, v2y = b.y - p.y;
        const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y); if (l1 < 1e-6 || l2 < 1e-6) return;
        const cross = (v1x * v2y - v1y * v2x) / (l1 * l2), dot = v1x * v2x + v1y * v2y;
        if (Math.abs(cross) < 0.02 && dot > 0) p.s = true;
      });
    });
  }

  // ---------- minimal XML (plist / glif) ----------
  function parseXML(s) {
    const rootN = { name: '#root', attrs: {}, children: [], text: '' }, stack = [rootN];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w.\-:]*)((?:\s+[\w.\-:]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    const ent = t => t.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]);
    let m;
    while ((m = re.exec(s))) {
      const top = stack[stack.length - 1];
      if (m[1] != null) { top.text += m[1]; continue; }
      if (m[3]) {
        if (m[2]) { if (stack.length > 1) stack.pop(); continue; }
        const attrs = {}; (m[4] || '').replace(/([\w.\-:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (x, k, a, b) => { attrs[k] = ent(a != null ? a : b); });
        const node = { name: m[3], attrs, children: [], text: '' }; top.children.push(node);
        if (!m[5]) stack.push(node);
        continue;
      }
      if (m[6] != null) top.text += ent(m[6]);
    }
    return rootN;
  }
  function plistValue(n) {
    if (!n) return null;
    switch (n.name) {
      case 'dict': { const o = {}; for (let i = 0; i < n.children.length; i += 2) { const k = n.children[i], v = n.children[i + 1]; if (k && k.name === 'key') o[k.text] = plistValue(v); } return o; }
      case 'array': return n.children.map(plistValue);
      case 'string': return n.text; case 'integer': return parseInt(n.text, 10); case 'real': return parseFloat(n.text);
      case 'true': return true; case 'false': return false; default: return n.text;
    }
  }
  function parsePlist(s) { const r = parseXML(s); const p = r.children.find(c => c.name === 'plist'); return plistValue(p ? p.children[0] : r.children[0]); }
  function parseGlif(s, name) {
    const r = parseXML(s), gl = r.children.find(c => c.name === 'glyph'); if (!gl) throw new Error('Bad .glif');
    const G = TM.newGlyph(name || gl.attrs.name, [], 0);
    gl.children.forEach(ch => {
      if (ch.name === 'advance') G.advance = Math.round(+ch.attrs.width || 0);
      else if (ch.name === 'unicode') { const u = parseInt(ch.attrs.hex, 16); if (isFinite(u)) G.unicodes.push(u); }
      else if (ch.name === 'note') G.note = ch.text.trim();
      else if (ch.name === 'outline') ch.children.forEach(o => {
        if (o.name === 'component') {
          const a = o.attrs, f = (k, d) => a[k] != null ? +a[k] : d;
          if (a.base) G.components.push({ base: a.base, m: [f('xScale', 1), f('xyScale', 0), f('yxScale', 0), f('yScale', 1), f('xOffset', 0), f('yOffset', 0)] });
        } else if (o.name === 'contour') {
          const pts = o.children.filter(p => p.name === 'point').map(p => {
            const t = p.attrs.type || 'offcurve';
            const q = { x: +p.attrs.x || 0, y: +p.attrs.y || 0, t: t === 'offcurve' ? 'o' : t === 'curve' ? 'c' : t === 'qcurve' ? 'q' : 'l' };
            if (p.attrs.smooth === 'yes') q.s = true; if (t === 'move') q.move = true; return q;
          });
          if (!pts.length) return;
          if (pts[0].move) { delete pts[0].move; pts[0].t = 'l'; if (pts.length > 1) G.contours.push({ points: pts, open: true }); }
          else G.contours.push(TM.canonical({ points: pts }));
        }
      });
    });
    return G;
  }
  // files: {path: Uint8Array}; returns model font
  function importUFO(files) {
    const td = new TextDecoder();
    const paths = Object.keys(files);
    const meta = paths.find(p => /(^|\/)metainfo\.plist$/.test(p) && !/__MACOSX/.test(p));
    if (!meta) throw new Error('No UFO found in the zip (metainfo.plist missing)');
    const rootDir = meta.replace(/metainfo\.plist$/, '');
    const read = p => files[rootDir + p] ? td.decode(files[rootDir + p]) : null;
    const pl = p => { const s = read(p); return s ? parsePlist(s) : null; };
    const fi = pl('fontinfo.plist') || {}, metaInfo = pl('metainfo.plist') || {};
    const contents = pl('glyphs/contents.plist') || {};
    const lib = pl('lib.plist') || {};
    const info = Object.assign({}, TM.DEFAULT_INFO);
    const map = { familyName: 'familyName', styleName: 'styleName', versionMajor: 'versionMajor', versionMinor: 'versionMinor', copyright: 'copyright', trademark: 'trademark', unitsPerEm: 'unitsPerEm', ascender: 'ascender', descender: 'descender', xHeight: 'xHeight', capHeight: 'capHeight', italicAngle: 'italicAngle',
      openTypeNameDesigner: 'designer', openTypeNameDesignerURL: 'designerURL', openTypeNameManufacturer: 'manufacturer', openTypeNameManufacturerURL: 'manufacturerURL', openTypeNameLicense: 'license', openTypeNameLicenseURL: 'licenseURL', openTypeNameDescription: 'description',
      openTypeOS2VendorID: 'vendorID', openTypeOS2WeightClass: 'weightClass', openTypeOS2WidthClass: 'widthClass', postscriptUnderlinePosition: 'underlinePosition', postscriptUnderlineThickness: 'underlineThickness', openTypeOS2WinAscent: 'winAscent', openTypeOS2WinDescent: 'winDescent', openTypeOS2TypoLineGap: 'lineGap' };
    Object.entries(map).forEach(([k, v]) => { if (fi[k] != null) info[v] = fi[k]; });
    if (fi.openTypeOS2TypoAscender != null) info.ascender = fi.openTypeOS2TypoAscender;
    if (fi.openTypeOS2TypoDescender != null) info.descender = fi.openTypeOS2TypoDescender;
    if (fi.openTypeOS2Selection && fi.openTypeOS2Selection.includes(7)) info.useTypoMetrics = true;
    const glyphs = {}, order = [];
    Object.entries(contents).forEach(([name, file]) => {
      const s = read('glyphs/' + file); if (s == null) return;
      try { glyphs[name] = parseGlif(s, name); } catch (e) { /* skip broken glyph */ }
    });
    const go = Array.isArray(lib['public.glyphOrder']) ? lib['public.glyphOrder'] : [];
    go.forEach(n => { if (glyphs[n] && !order.includes(n)) order.push(n); });
    Object.keys(glyphs).sort().forEach(n => { if (!order.includes(n)) order.push(n); });
    let groups = pl('groups.plist') || {}, kerning = pl('kerning.plist') || {};
    if ((metaInfo.formatVersion || 3) < 3) {   // UFO2: rename groups used in kerning to public.kern1/2
      const ren = {}, out = {};
      Object.keys(kerning).forEach(l => { if (groups[l]) ren[l] = ren[l] || { k1: 'public.kern1.' + l.replace(/^@?(MMK_L_)?/, '') }; Object.keys(kerning[l]).forEach(r => { if (groups[r]) ren[r] = Object.assign(ren[r] || {}, { k2: 'public.kern2.' + r.replace(/^@?(MMK_R_)?/, '') }); }); });
      Object.entries(ren).forEach(([g, o]) => { if (o.k1) out[o.k1] = groups[g]; if (o.k2) out[o.k2] = groups[g]; });
      const nk = {}; Object.entries(kerning).forEach(([l, row]) => { const L = ren[l] && ren[l].k1 || l; nk[L] = {}; Object.entries(row).forEach(([r, v]) => { nk[L][ren[r] && ren[r].k2 || r] = v; }); });
      groups = out; kerning = nk;
    }
    return TM.sanitizeFont({ info, order, glyphs, groups, kerning });
  }

  // ---------- UFO export (returns {path: Uint8Array}) ----------
  const xesc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function plistXML(v, ind = '') {
    const n = ind + '  ';
    if (Array.isArray(v)) return `<array>\n${v.map(x => n + plistXML(x, n)).join('\n')}\n${ind}</array>`;
    if (v && typeof v === 'object') return `<dict>\n${Object.entries(v).map(([k, x]) => `${n}<key>${xesc(k)}</key>\n${n}${plistXML(x, n)}`).join('\n')}\n${ind}</dict>`;
    if (typeof v === 'boolean') return v ? '<true/>' : '<false/>';
    if (typeof v === 'number') return Number.isInteger(v) ? `<integer>${v}</integer>` : `<real>${v}</real>`;
    return `<string>${xesc(v)}</string>`;
  }
  const plistDoc = v => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0">\n${plistXML(v)}\n</plist>\n`;
  function glifFileName(name, used) {
    // UFO user name → file name convention (uppercase letters get an underscore suffix)
    let s = name.replace(/[A-Z]/g, c => c + '_').replace(/[\x00-\x1f"*+/:<>?[\\\]|\x7f]/g, '_');
    if (s.startsWith('.')) s = '_' + s.slice(1);
    const res = /^(con|prn|aux|clock\$|nul|com\d|lpt\d)$/i;
    s = s.split('.').map(p => res.test(p) ? '_' + p : p).join('.');
    let f = s + '.glif', i = 1; while (used.has(f.toLowerCase())) f = s + String(i++).padStart(15, '0') + '.glif';
    used.add(f.toLowerCase()); return f;
  }
  function glifXML(g) {
    const pt = p => `      <point x="${+p.x.toFixed(3)}" y="${+p.y.toFixed(3)}"${p.t === 'o' ? '' : ` type="${p.t === 'l' ? 'line' : p.t === 'c' ? 'curve' : 'qcurve'}"`}${p.s && p.t !== 'o' ? ' smooth="yes"' : ''}/>`;
    const cont = g.contours.map(c => {
      let pts = c.points.map(pt);
      if (c.open) pts[0] = pts[0].replace(/ type="[^"]*"/, '').replace('/>', ' type="move"/>');
      return `    <contour>\n${pts.join('\n')}\n    </contour>`;
    });
    const comps = g.components.map(c => { const [a, b, cc, d, x, y] = c.m; const at = (k, v, def) => v !== def ? ` ${k}="${+v.toFixed(5)}"` : ''; return `    <component base="${xesc(c.base)}"${at('xScale', a, 1)}${at('xyScale', b, 0)}${at('yxScale', cc, 0)}${at('yScale', d, 1)}${at('xOffset', x, 0)}${at('yOffset', y, 0)}/>`; });
    return `<?xml version="1.0" encoding="UTF-8"?>\n<glyph name="${xesc(g.name)}" format="2">\n  <advance width="${g.advance}"/>\n${g.unicodes.map(u => `  <unicode hex="${TM.hex(u)}"/>\n`).join('')}${g.note ? `  <note>${xesc(g.note)}</note>\n` : ''}  <outline>\n${[...comps, ...cont].join('\n')}${comps.length || cont.length ? '\n' : ''}  </outline>\n</glyph>\n`;
  }
  function exportUFO(font) {
    const te = new TextEncoder(), I = font.info, dir = (I.familyName + '-' + I.styleName).replace(/[^A-Za-z0-9\-]/g, '') + '.ufo/', out = {};
    const put = (p, s) => { out[dir + p] = te.encode(s); };
    put('metainfo.plist', plistDoc({ creator: 'com.lumenstudio.type', formatVersion: 3 }));
    const fi = { familyName: I.familyName, styleName: I.styleName, versionMajor: I.versionMajor, versionMinor: I.versionMinor, unitsPerEm: I.unitsPerEm, ascender: I.ascender, descender: I.descender, xHeight: I.xHeight, capHeight: I.capHeight, italicAngle: I.italicAngle,
      copyright: I.copyright, trademark: I.trademark, openTypeNameDesigner: I.designer, openTypeNameDesignerURL: I.designerURL, openTypeNameManufacturer: I.manufacturer, openTypeNameManufacturerURL: I.manufacturerURL, openTypeNameLicense: I.license, openTypeNameLicenseURL: I.licenseURL, openTypeNameDescription: I.description,
      openTypeOS2VendorID: I.vendorID, openTypeOS2WeightClass: I.weightClass, openTypeOS2WidthClass: I.widthClass, openTypeOS2TypoAscender: I.ascender, openTypeOS2TypoDescender: I.descender, openTypeOS2TypoLineGap: I.lineGap, postscriptUnderlinePosition: I.underlinePosition, postscriptUnderlineThickness: I.underlineThickness };
    if (I.winAscent != null) fi.openTypeOS2WinAscent = I.winAscent; if (I.winDescent != null) fi.openTypeOS2WinDescent = I.winDescent;
    Object.keys(fi).forEach(k => { if (fi[k] === '' || fi[k] == null) delete fi[k]; });
    put('fontinfo.plist', plistDoc(fi));
    const used = new Set(), contents = {};
    font.order.forEach(n => { const f = glifFileName(n, used); contents[n] = f; put('glyphs/' + f, glifXML(font.glyphs[n])); });
    put('glyphs/contents.plist', plistDoc(contents));
    put('layercontents.plist', plistDoc([['public.default', 'glyphs']]));
    put('groups.plist', plistDoc(font.groups || {}));
    put('kerning.plist', plistDoc(font.kerning || {}));
    put('lib.plist', plistDoc({ 'public.glyphOrder': font.order }));
    return out;
  }

  const FIO = { sniff, readTables, readGPOSKern, gposToUFO, importOpenType, parseXML, parsePlist, parseGlif, importUFO, exportUFO, glifXML };
  if (typeof module === 'object' && module.exports) module.exports = FIO; else root.FIO = FIO;
})(typeof window !== 'undefined' ? window : globalThis);
