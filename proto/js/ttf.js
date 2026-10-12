'use strict';
/* Lumen Proto — minimal TrueType reader + glyph subsetter, used to embed the bundled fonts in vector PDFs. */
(function () {
  const LP = window.LP;
  LP.TTF = function (buf) {
    const dv = new DataView(buf), u8 = new Uint8Array(buf);
    const u16 = o => dv.getUint16(o), i16 = o => dv.getInt16(o), u32 = o => dv.getUint32(o);
    const tables = {}; const n = u16(4);
    for (let i = 0; i < n; i++) { const o = 12 + i * 16; const tag = String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]); tables[tag] = { off: u32(o + 8), len: u32(o + 12) }; }
    ['head', 'hhea', 'maxp', 'hmtx', 'loca', 'glyf', 'cmap'].forEach(t => { if (!tables[t]) throw new Error('Font is missing table ' + t); });
    const head = tables.head.off, unitsPerEm = u16(head + 18), locFmt = i16(head + 50);
    const bbox = [i16(head + 36), i16(head + 38), i16(head + 40), i16(head + 42)];
    const numGlyphs = u16(tables.maxp.off + 4), hhea = tables.hhea.off, nhm = u16(hhea + 34);
    const ascent = i16(hhea + 4), descent = i16(hhea + 6);
    const loca = i => locFmt ? u32(tables.loca.off + i * 4) : u16(tables.loca.off + i * 2) * 2;
    const adv = g => u16(tables.hmtx.off + Math.min(g, nhm - 1) * 4);
    // cmap: prefer format 12 (full Unicode), else format 4
    const cm = tables.cmap.off, map = new Map();
    let best = null;
    for (let i = 0; i < u16(cm + 2); i++) { const pid = u16(cm + 4 + i * 8), eid = u16(cm + 6 + i * 8), off = cm + u32(cm + 8 + i * 8), fmt = u16(off); if ((pid === 3 && (eid === 10 || eid === 1)) || pid === 0) { if (fmt === 12 && (!best || best.fmt !== 12)) best = { fmt, off }; else if (fmt === 4 && !best) best = { fmt, off }; } }
    if (best && best.fmt === 12) { const groups = u32(best.off + 12); for (let g = 0; g < groups; g++) { const o = best.off + 16 + g * 12, s = u32(o), e = u32(o + 4), sg = u32(o + 8); for (let c = s; c <= e && c - s < 70000; c++) map.set(c, sg + c - s); } }
    else if (best) {
      const o = best.off, segX2 = u16(o + 6), ends = o + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ros = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const e = u16(ends + s * 2), st = u16(starts + s * 2), d = i16(deltas + s * 2), ro = u16(ros + s * 2);
        for (let c = st; c <= e && c !== 0xFFFF; c++) { let g; if (!ro) g = (c + d) & 0xFFFF; else { const ga = ros + s * 2 + ro + (c - st) * 2; g = u16(ga); if (g) g = (g + d) & 0xFFFF; } if (g) map.set(c, g); }
      }
    }
    const ps = (() => { const nm = tables.name; if (!nm) return 'Font'; const o = nm.off, cnt = u16(o + 2), so = o + u16(o + 4); for (let i = 0; i < cnt; i++) { const r = o + 6 + i * 12; if (u16(r + 6) === 6) { const len = u16(r + 8), off = so + u16(r + 10), pid = u16(r); let s = ''; if (pid === 3 || pid === 0) for (let k = 0; k < len; k += 2) s += String.fromCharCode(u16(off + k)); else for (let k = 0; k < len; k++) s += String.fromCharCode(u8[off + k]); return s.replace(/[^\w-]/g, ''); } } return 'Font'; })();
    const italicAngle = tables.post ? dv.getInt32(tables.post.off + 4) / 65536 : 0;
    const capHeight = tables['OS/2'] && u16(tables['OS/2'].off) >= 2 ? i16(tables['OS/2'].off + 88) : Math.round(ascent * .7);
    // glyph subset: keep glyph ids, empty the outlines of unused glyphs (composite components are kept)
    function subset(gids) {
      const keep = new Set([0]); const stack = [...gids];
      while (stack.length) {
        const g = stack.pop(); if (keep.has(g) && g !== 0) continue; keep.add(g);
        const a = loca(g), b = loca(g + 1); if (b <= a) continue;
        const go = tables.glyf.off + a; if (i16(go) >= 0) continue;
        let p = go + 10, flags;
        do { flags = u16(p); const comp = u16(p + 2); if (!keep.has(comp)) stack.push(comp); p += 4 + (flags & 1 ? 4 : 2) + (flags & 8 ? 2 : flags & 0x40 ? 4 : flags & 0x80 ? 8 : 0); } while (flags & 0x20);
      }
      const parts = []; let len = 0; const offs = new Uint32Array(numGlyphs + 1);
      for (let g = 0; g < numGlyphs; g++) {
        offs[g] = len;
        if (keep.has(g)) { const a = loca(g), b = loca(g + 1); if (b > a) { let d = u8.subarray(tables.glyf.off + a, tables.glyf.off + b); if (d.length % 4) { const pad = new Uint8Array(d.length + (4 - d.length % 4)); pad.set(d); d = pad; } parts.push(d); len += d.length; } }
      }
      offs[numGlyphs] = len;
      const glyf = new Uint8Array(len); let o = 0; parts.forEach(p => { glyf.set(p, o); o += p.length; });
      const locaB = new Uint8Array((numGlyphs + 1) * 4), ldv = new DataView(locaB.buffer); offs.forEach((v, i) => ldv.setUint32(i * 4, v));
      const headB = u8.slice(head, head + tables.head.len); new DataView(headB.buffer).setInt16(50, 1); new DataView(headB.buffer).setUint32(8, 0);
      const T = { head: headB, hhea: u8.slice(hhea, hhea + tables.hhea.len), maxp: u8.slice(tables.maxp.off, tables.maxp.off + tables.maxp.len), hmtx: u8.slice(tables.hmtx.off, tables.hmtx.off + tables.hmtx.len), loca: locaB, glyf };
      ['cvt ', 'fpgm', 'prep'].forEach(t => { if (tables[t]) T[t] = u8.slice(tables[t].off, tables[t].off + tables[t].len); });
      const tags = Object.keys(T).sort(), nt = tags.length;
      let total = 12 + nt * 16; tags.forEach(t => { total += (T[t].length + 3) & ~3; });
      const out = new Uint8Array(total), odv = new DataView(out.buffer);
      odv.setUint32(0, 0x00010000); odv.setUint16(4, nt); let es = 1, lg = 0; while (es * 2 <= nt) { es *= 2; lg++; } odv.setUint16(6, es * 16); odv.setUint16(8, lg); odv.setUint16(10, nt * 16 - es * 16);
      let off = 12 + nt * 16;
      tags.forEach((t, i) => {
        const d = T[t], r = 12 + i * 16; for (let k = 0; k < 4; k++) out[r + k] = t.charCodeAt(k);
        let sum = 0; const padded = new Uint8Array((d.length + 3) & ~3); padded.set(d); const pdv = new DataView(padded.buffer); for (let k = 0; k < padded.length; k += 4) sum = (sum + pdv.getUint32(k)) >>> 0;
        odv.setUint32(r + 4, sum); odv.setUint32(r + 8, off); odv.setUint32(r + 12, d.length); out.set(padded, off); off += padded.length;
      });
      return out;
    }
    return { unitsPerEm, bbox, ascent, descent, capHeight, italicAngle, numGlyphs, name: ps, gid: cp => map.get(cp) || 0, has: cp => map.has(cp), adv, subset };
  };
})();
