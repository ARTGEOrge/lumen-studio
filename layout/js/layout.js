'use strict';
/* Lumen Layout — text composition engine.
   Lays a story out through a chain of threaded frames (multi-column), honouring paragraph/character
   formatting, text wrap exclusions, drop caps, baseline grid, hyphenation and justification.
   Output is pure geometry (lines with per-character x positions and glyph runs) shared by the
   screen renderer, hit-testing/caret code and the PDF exporter. */
(function () {
  let hyphenate = null;
  try { if (window.createHyphenator && window.hyphenationPatternsEnUs) hyphenate = createHyphenator(hyphenationPatternsEnUs, { hyphenChar: '\u00AD' }); } catch (e) { }
  const hyCache = new Map();
  function hyPoints(word) {
    let r = hyCache.get(word); if (r) return r;
    r = [];
    if (hyphenate && word.length >= 5) {
      const h = hyphenate(word); let k = 0;
      for (const ch of h) { if (ch === '\u00AD') r.push(k); else k++; }
    }
    hyCache.set(word, r); return r;
  }

  const stCache = new Map();
  // Computed style object (interned) for effective attributes
  function mkStyle(e) {
    const fk = Fonts.resolve(e.font, e.weight, e.italic);
    const key = `${fk}|${e.size}|${e.lead}|${e.track}|${e.color}|${e.shift}|${e.caps}|${e.under ? 1 : 0}${e.strike ? 1 : 0}`;
    let s = stCache.get(key); if (s) return s;
    const m = Fonts.metrics(fk);
    s = { key, fk, size: e.size, lead: e.lead > 0 ? e.lead : e.size * 1.2, track: e.track || 0, color: e.color, shift: e.shift || 0, caps: e.caps, under: !!e.under, strike: !!e.strike, m, font: e.font, weight: e.weight, italic: e.italic };
    if (e.caps === 'small') s.sc = mkStyle({ ...e, caps: 'none', size: +(e.size * 0.74).toFixed(3), lead: s.lead, track: (e.track || 0) + 30 });
    stCache.set(key, s); return s;
  }
  function sized(st, size) { return mkStyle({ font: st.font, weight: st.weight, italic: st.italic, size, lead: size * 1.2, track: st.track, color: st.color, shift: 0, caps: st.caps === 'all' ? 'all' : 'none', under: false, strike: false }); }

  // Per-story precompute: effective para attrs + per-char style/display
  function prepare(doc, story) {
    const n = story.text.length, pe = [], pstart = [0];
    const peCache = new Map();
    for (const p of story.paras) { const k = JSON.stringify(p); let e = peCache.get(k); if (!e) { e = M.paraEff(doc, p); peCache.set(k, e); } pe.push(e); }
    for (let i = 0; i < n; i++) if (story.text.charCodeAt(i) === 10) pstart.push(i + 1);
    const st = new Array(n), ds = new Array(n), dsx = new Array(n);
    const local = new Map(); let done = 0, pi = 0;
    // per-character styles are resolved lazily, so composing the first frames of a long story stays cheap
    const fill = upto => {
      if (upto > n) upto = n;
      for (let i = done; i < upto; i++) {
        const ai = story.ca[i];
        const k = pi + ':' + ai; let s = local.get(k);
        if (!s) { s = mkStyle(M.charEff(doc, pe[pi], story.attrs[ai] || {})); local.set(k, s); }
        st[i] = s;
        const c = story.text[i];
        let d = c, dst = s;
        if (s.caps === 'all') d = c.toUpperCase();
        else if (s.caps === 'small' && c !== c.toUpperCase()) { d = c.toUpperCase(); dst = s.sc; }
        ds[i] = d; dsx[i] = dst;
        if (c === '\n') pi++;
      }
      if (upto > done) done = upto;
    };
    const empty = pe.map(e => mkStyle(e));
    return { n, pe, pstart, st, ds, dsx, empty, text: story.text, fill, all() { fill(n); return this; } };
  }

  function advance(P, i, x, label) {
    const c = P.text[i];
    if (c === '\n' || c === '\u2028' || c === '\u00AD') return 0;
    if (c === '\t') return (Math.floor(x / 36 + 1e-6) + 1) * 36 - x;
    const st = P.dsx[i];
    const s = c === '\uE000' ? label : P.ds[i];
    return Fonts.width100(st.fk, s) * st.size / 100 + st.track * st.size / 1000 * s.length;
  }
  const BREAK_AFTER = new Set([' ', '-', '–', '—', '/', '\u00AD']);

  // Fill one line segment of width `avail` starting at char a with pen at startX. Returns break info.
  function fillLine(P, a, pend, avail, startX, label, hyph) {
    const xs = []; let x = startX, lastBreak = -1, lastBreakSoft = false;
    const T = P.text;
    let i = a;
    for (; i < pend; i++) {
      const c = T[i];
      xs.push(x);
      if (c === '\n') { xs.push(x); return { b: i + 1, xs, para: true }; }
      if (c === '\u2028') { xs.push(x); return { b: i + 1, xs, forced: true }; }
      const w = advance(P, i, x, label);
      if (x + w > avail + 0.01 && c !== ' ' && i > a) {
        // overflow: try to hyphenate the word being broken
        const ws = lastBreak > a ? lastBreak : a;
        let we = i; while (we < pend && /[A-Za-zÀ-ɏ'’]/.test(T[we])) we++;
        if (hyph && ws < i) {
          let k0 = ws; while (k0 < i && !/[A-Za-zÀ-ɏ]/.test(T[k0])) k0++;
          const word = T.slice(k0, we);
          if (word.length >= 5 && /^[A-Za-zÀ-ɏ'’]+$/.test(word)) {
            const hst = P.dsx[Math.max(k0, i - 1)], hw = Fonts.width100(hst.fk, '-') * hst.size / 100;
            const pts = hyPoints(word);
            for (let q = pts.length - 1; q >= 0; q--) {
              const bi = k0 + pts[q];
              if (bi <= a || bi > i) continue;
              if (xs[bi - a] + hw <= avail + 0.01) { xs.length = bi - a + 1; return { b: bi, xs, hy: true, hyw: hw }; }
            }
          }
        }
        if (lastBreak > a) { xs.length = lastBreak - a + 1; return { b: lastBreak, xs, hy: lastBreakSoft, hyw: lastBreakSoft ? hyw(P, lastBreak - 1) : 0 }; }
        xs.length = i - a + 1; return { b: i, xs };
      }
      x += w;
      if (BREAK_AFTER.has(c) && !(c === '-' && i === a)) { lastBreak = i + 1; lastBreakSoft = c === '\u00AD'; }
    }
    xs.push(x); return { b: pend, xs, end: true };
  }
  function hyw(P, i) { const s = P.dsx[i]; return Fonts.width100(s.fk, '-') * s.size / 100; }

  function intervals(L, R, top, bot, excl, minW) {
    let segs = [[L, R]];
    for (const r of excl) {
      if (r[1] >= bot || r[3] <= top) continue;
      const out = [];
      for (const [a, b] of segs) {
        if (r[2] <= a || r[0] >= b) { out.push([a, b]); continue; }
        if (r[0] > a) out.push([a, r[0]]);
        if (r[2] < b) out.push([r[2], b]);
      }
      segs = out;
    }
    return segs.filter(s => s[1] - s[0] >= minW);
  }

  /* frames: [{item, label (page number string), excl:[[x0,y0,x1,y1] in page coords], grid:{start,step}}] */
  function layoutStory(doc, story, frames) {
    const P = prepare(doc, story);
    const n = P.n, T = P.text;
    const out = frames.map(() => ({ lines: [], a: n, b: n }));
    let i = 0, pi = 0, needFinal = n === 0 || T[n - 1] === '\n', doneFinal = false;
    let paraFirst = true, pendingSp = 0, dropLeft = 0, dropW = 0;
    for (let fi = 0; fi < frames.length; fi++) {
      const F = frames[fi], it = F.item, fo = out[fi];
      fo.a = i;
      const inset = it.inset || 0, cols = Math.max(1, it.cols | 0 || 1), gut = it.gutter ?? 12;
      const iw = Math.max(1, it.w - inset * 2), colW = Math.max(1, (iw - gut * (cols - 1)) / cols);
      const rotated = !!(it.rot % 360);
      const excl = rotated ? [] : (F.excl || []).map(r => [r[0] - it.x, r[1] - it.y, r[2] - it.x, r[3] - it.y]);
      const top = inset, bottom = it.h - inset;
      for (let c = 0; c < cols; c++) {
        const colL = inset + c * (colW + gut), colR = colL + colW;
        let base = null, guard = 0;
        const colStart = fo.lines.length;
        while ((i < n || (needFinal && !doneFinal)) && guard++ < 5000) {
          P.fill(i + 3000);
          const pe = P.pe[pi] || P.pe[P.pe.length - 1];
          const isPS = i === P.pstart[pi];
          const st0 = i < n ? P.st[i] : P.empty[pi] || P.empty[0];
          let lead = st0.lead, asc = st0.m.asc * st0.size, desc = st0.m.desc * st0.size;
          let y = base === null ? top + asc : base + lead + (isPS ? pendingSp : 0);
          if (base === null && isPS) { /* space before ignored at top of column */ }
          if (pe.grid && F.grid && !rotated) { const gs = F.grid.start, step = F.grid.step || 12; const py = it.y + y; y = gs + Math.ceil((py - gs - 0.01) / step) * step - it.y; }
          if (y + desc > bottom + 0.5) break;               // column full
          const minW = Math.max(18, st0.size * 4);
          const segs = intervals(colL + pe.indL, colR - pe.indR, y - asc, y + desc, excl, minW);
          if (!segs.length) {
            // jump below the obstruction
            let nb = Infinity; for (const r of excl) if (r[1] < y + desc && r[3] > y - asc) nb = Math.min(nb, r[3]);
            if (!isFinite(nb)) break;
            base = nb + asc - lead; pendingSp = 0; if (base + lead + desc > bottom) break; continue;
          }
          const placed = [];
          for (let si = 0; si < segs.length; si++) {
            if (!(i < n || (needFinal && !doneFinal))) break;
            const [L, R] = segs[si];
            const ps = P.pstart[pi], pend = pi + 1 < P.pstart.length ? P.pstart[pi + 1] : n;
            const firstOfPara = i === ps;
            let startX = 0, drop = null, a = i;
            if (firstOfPara) {
              startX = pe.indF; dropLeft = 0; dropW = 0;
              const dc = Math.max(1, pe.dropC | 0);
              if (pe.dropL >= 2 && pend - ps > dc + 1 && !/\s/.test(T.slice(ps, ps + dc))) {
                const s0 = P.dsx[ps], body = P.st[ps];
                const D = ((pe.dropL - 1) * body.lead + body.m.cap * body.size) / s0.m.cap;
                const dst = sized(s0, +D.toFixed(2));
                let dx = 0; const dxs = [];
                for (let k = 0; k < dc; k++) { dxs.push(dx); dx += Fonts.width100(dst.fk, P.ds[ps + k]) * dst.size / 100; }
                dropW = dx + body.size * 0.3; dropLeft = pe.dropL;
                drop = { x: L, y: y + (pe.dropL - 1) * body.lead, text: P.ds.slice(ps, ps + dc).join(''), st: dst, i0: ps, i1: ps + dc, xs: dxs.map(v => L + v) };
                a = ps + dc; startX = dropW;
              }
            } else if (dropLeft > 0) startX = dropW;
            const avail = R - L;
            const r = i < n ? fillLine(P, a, pend, avail, startX, F.label || '', pe.hyph !== false && !!hyphenate) : { b: n, xs: [startX], end: true };
            if (i >= n) doneFinal = true;
            if (r.b === a && !r.para && i < n) { r.b = a + 1; r.xs = [startX, startX + advance(P, a, startX, F.label)]; }
            // trim trailing invisible chars for alignment
            let e = r.b; while (e > a && /[ \n\u2028\u00AD]/.test(T[e - 1])) e--;
            const nat = r.xs[e - a] - startX + (r.hy ? r.hyw : 0);
            const free = avail - startX - nat;
            const lastLine = r.para || r.end || r.forced;
            let shift = 0, extra = 0, spaces = 0;
            const al = pe.align;
            if (al === 'center') shift = free / 2; else if (al === 'right') shift = free;
            else if ((al === 'justify' && !lastLine) || al === 'justify-all') { for (let k = a; k < e; k++) if (T[k] === ' ') spaces++; if (spaces && free > 0) extra = free / spaces; }
            const xs = new Array(r.xs.length);
            let add = 0;
            for (let k = 0; k < r.xs.length; k++) { xs[k] = L + r.xs[k] + shift + add; if (extra && a + k < e && T[a + k] === ' ') add += extra; }
            // glyph runs
            const runs = []; let cur = null;
            for (let k = a; k < e; k++) {
              const ch = T[k];
              if (ch === ' ' || ch === '\t' || ch === '\u00AD' || ch === '\n' || ch === '\u2028') { cur = null; continue; }
              const s = P.dsx[k], d = ch === '\uE000' ? (F.label || '') : P.ds[k];
              const x0 = xs[k - a];
              if (cur && cur.st === s && Math.abs(cur.end - x0) < 0.01) { cur.text += d; cur.i1 = k + 1; cur.end = xs[k + 1 - a]; cur.px.push(x0); cur.parts.push(d); }
              else { cur = { x: x0, text: d, st: s, i0: k, i1: k + 1, end: xs[k + 1 - a], px: [x0], parts: [d] }; runs.push(cur); }
            }
            if (r.hy && e > a) { const s = P.dsx[e - 1]; runs.push({ x: xs[e - a], text: '-', st: s, i0: e, i1: e, end: xs[e - a] + r.hyw, hy: true }); }
            // line metrics from chars actually placed
            let mLead = 0, mAsc = 0, mDesc = 0;
            for (let k = a; k < Math.max(e, a + 1) && k < n; k++) { const s = P.st[k]; if (s.lead > mLead) mLead = s.lead; const aa = s.m.asc * s.size; if (aa > mAsc) mAsc = aa; const dd = s.m.desc * s.size; if (dd > mDesc) mDesc = dd; }
            if (!mLead) { mLead = lead; mAsc = asc; mDesc = desc; }
            const fullXs = drop ? [...drop.xs, ...xs] : xs;
            placed.push({ a: drop ? drop.i0 : a, b: r.b, y, xs: fullXs, runs, lead: mLead, asc: mAsc, desc: mDesc, L, R, col: c, drop, para: !!r.para, pi, hy: !!r.hy });
            i = r.b;
            if (dropLeft > 0) dropLeft--;
            if (r.para) { pendingSp = pe.spA + ((P.pe[pi + 1] || pe).spB || 0); pi++; dropLeft = 0; break; }
            if (r.end) break;
          }
          if (!placed.length) break;
          // correct baseline if the line turned out taller than estimated
          const realLead = Math.max(...placed.map(l => l.lead));
          if (base !== null && realLead > lead) { const d = realLead - lead; placed.forEach(l => { l.y += d; if (l.drop) l.drop.y += d; }); }
          if (base === null) { const ra = Math.max(...placed.map(l => l.asc)); if (ra > asc) { const d = ra - asc; placed.forEach(l => { l.y += d; if (l.drop) l.drop.y += d; }); } }
          const ly = placed[0].y;
          if (ly + Math.max(...placed.map(l => l.desc)) > bottom + 0.5 && base !== null) { i = placed[0].a; if (placed.some(l => l.para)) { pi = placed[0].pi; } doneFinal = false; break; }
          fo.lines.push(...placed);
          base = ly;
        }
        // vertical alignment
        if (it.valign && it.valign !== 'top' && fo.lines.length > colStart) {
          const ls = fo.lines.slice(colStart), last = ls[ls.length - 1];
          const free = bottom - (last.y + last.desc);
          const d = it.valign === 'center' ? free / 2 : it.valign === 'bottom' ? free : 0;
          if (d > 0) ls.forEach(l => { l.y += d; if (l.drop) l.drop.y += d; });
        }
      }
      fo.b = i;
    }
    return { frames: out, overset: i < n, end: i, n, P };
  }

  /* simple wrapped text for table cells: returns lines [{text, w, x}] */
  function simpleLines(text, fk, size, width) {
    const out = [];
    for (const para of String(text).split('\n')) {
      const words = para.split(/(\s+)/); let line = '', lw = 0;
      const W = s => Fonts.width100(fk, s) * size / 100;
      for (const w of words) {
        if (!w) continue; const ww = W(w);
        if (lw + ww > width && line.trim()) { out.push(line.trimEnd()); line = /^\s+$/.test(w) ? '' : w; lw = W(line); }
        else { line += w; lw += ww; }
      }
      out.push(line.trimEnd());
    }
    return out.map(t => ({ text: t, w: Fonts.width100(fk, t) * size / 100 }));
  }

  window.Layout = { layoutStory, mkStyle, simpleLines, hyPoints, get hasHyphenation() { return !!hyphenate; } };
})();
