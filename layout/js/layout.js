'use strict';
/* Lumen Layout — text composition engine.
   Lays a story out through a chain of threaded frames (multi-column), honouring paragraph/character
   formatting, OpenType shaping (kerning, ligatures, features via fontkit), tab stops with leaders, bullets
   and numbering, text wrap (box / object shape / alpha contour / jump), drop caps, baseline grid,
   hyphenation, single-line or Knuth–Plass paragraph composition, keep options (keep with next, keep lines
   together, orphan/widow control, start in next column/frame), paragraph rules above/below, inline/above-line graphics, inline
   tables that break across frames with repeating header rows, and footnotes at the foot of the column.
   Output is pure geometry (lines with per-character x positions and drawing runs) shared by the screen
   renderer, hit-testing/caret code, the PDF exporter and the EPUB/TOC generators. */
(function () {
  let hyphenate = null;
  try { if (window.createHyphenator && window.hyphenationPatternsEnUs) hyphenate = createHyphenator(hyphenationPatternsEnUs, { hyphenChar: '­' }); } catch (e) { }
  const hyCache = new Map();
  function hyPoints(word) {
    let r = hyCache.get(word); if (r) return r;
    r = [];
    if (hyphenate && word.length >= 5) {
      const h = hyphenate(word); let k = 0;
      for (const ch of h) { if (ch === '­') r.push(k); else k++; }
    }
    hyCache.set(word, r); return r;
  }

  /* ---------- computed styles ---------- */
  const stCache = new Map();
  const OT_RE = /^[a-z0-9]{4}$/;
  const otfList = s => [...new Set(String(s || '').split(/[\s,]+/).filter(t => OT_RE.test(t) && t !== 'kern' && t !== 'liga'))].sort();
  function mkStyle(e) {
    const fk = Fonts.resolve(e.font, e.weight, e.italic);
    const otf = otfList(e.otf), kern = e.kern !== false, ligaUser = e.liga !== false, track = e.track || 0;
    const liga = ligaUser && !track;
    const fx = (liga ? '' : 'l0') + (otf.length ? '+' + otf.join('+') : '');
    const key = `${fk}|${e.size}|${e.lead}|${track}|${e.color}|${e.shift}|${e.caps}|${e.under ? 1 : 0}${e.strike ? 1 : 0}|${kern ? 'k' : ''}${fx}`;
    let s = stCache.get(key); if (s) return s;
    const m = Fonts.metrics(fk);
    const feat = { kern, liga }; otf.forEach(t => { feat[t] = true; });
    const base = { font: e.font, weight: e.weight, italic: e.italic, size: e.size, lead: e.lead, track, color: e.color, shift: e.shift || 0, caps: e.caps, under: !!e.under, strike: !!e.strike, kern, liga: ligaUser, otf: otf.join(' ') };
    s = { key, fk, size: e.size, lead: e.lead > 0 ? e.lead : e.size * 1.2, track, color: e.color, shift: e.shift || 0, caps: e.caps, under: !!e.under, strike: !!e.strike, m, font: e.font, weight: e.weight, italic: e.italic,
      kern, liga: ligaUser, otf: base.otf, feat, fx, path: (!ligaUser && !track) || otf.length > 0, base };
    if (e.caps === 'small') s.sc = mkStyle({ ...base, caps: 'none', size: +(e.size * 0.74).toFixed(3), lead: s.lead, track: track + 30 });
    stCache.set(key, s); return s;
  }
  function derive(st, o) { return mkStyle({ ...st.base, ...o }); }
  function sized(st, size) { return derive(st, { size, lead: size * 1.2, shift: 0, caps: st.caps === 'all' ? 'all' : 'none', under: false, strike: false }); }
  function supStyle(st) { if (!st.sup) st.sup = derive(st, { size: +(st.size * 0.62).toFixed(3), lead: st.lead, shift: st.shift + st.size * 0.34, caps: 'none', under: false, strike: false }); return st.sup; }

  /* ---------- list markers ---------- */
  function roman(n) { const t = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]; let s = ''; for (const [v, r] of t) while (n >= v) { s += r; n -= v; } return s || '0'; }
  function alpha(n) { let s = ''; while (n > 0) { n--; s = String.fromCharCode(97 + n % 26) + s; n = Math.floor(n / 26); } return s || 'a'; }
  function fmtNumber(n, style) {
    if (style === 'roman') return roman(n); if (style === 'ROMAN') return roman(n).toUpperCase();
    if (style === 'alpha') return alpha(n); if (style === 'ALPHA') return alpha(n).toUpperCase();
    return String(n);
  }
  function listMarker(n, fmt) {
    const m = /^(1|a|A|i|I)([.)]?)$/.exec(fmt || '1.') || ['', '1', '.'];
    const style = { 1: 'arabic', a: 'alpha', A: 'ALPHA', i: 'roman', I: 'ROMAN' }[m[1]];
    return fmtNumber(n, style) + m[2];
  }

  /* ---------- per-story precompute ---------- */
  const isBRK = c => c === ' ' || c === '\t' || c === '\n' || c === '\u2028' || c === '­' || c === '' || c === '' || c === '￼' || c === ' ';
  function prepare(doc, story, fnBase = 0) {
    const n = story.text.length, T = story.text, pe = [], pstart = [0];
    const peCache = new Map();
    for (const p of story.paras) { const k = JSON.stringify(p); let e = peCache.get(k); if (!e) { e = M.paraEff(doc, p); peCache.set(k, e); } pe.push(e); }
    for (let i = 0; i < n; i++) if (T.charCodeAt(i) === 10) pstart.push(i + 1);
    const st = new Array(n), ds = new Array(n), dsx = new Array(n);
    const adv = new Float64Array(n), kern = new Float64Array(n), kadj = new Float64Array(n), cs = new Uint8Array(n), gl = new Array(n);
    const obj = new Array(n), fn = new Array(n), tabLd = new Array(n);
    const objs = story.objs || {}, notes = story.notes || {};
    let fnN = 0;
    for (let i = 0; i < n; i++) {
      const c = T.charCodeAt(i);
      if (c === 0xFFFC || c === 0xE001) {
        const at = story.attrs[story.ca[i]] || {};
        if (c === 0xFFFC && at.obj && objs[at.obj]) obj[i] = objs[at.obj];
        if (c === 0xE001 && at.fn && notes[at.fn]) fn[i] = { id: at.fn, num: fnBase + (++fnN), note: notes[at.fn] };
      }
    }
    // bullets & numbering
    const marker = new Array(pe.length); let num = 0, prevNum = false;
    pe.forEach((e, k) => {
      if (e.list === 'number') { num = e.lstart > 0 ? e.lstart : prevNum ? num + 1 : 1; marker[k] = listMarker(num, e.lfmt); prevNum = true; }
      else { if (e.list === 'bullet') marker[k] = (e.lchar || '•').slice(0, 2); prevNum = false; }
    });
    const local = new Map(); let done = 0, pi = 0;
    const styleRange = (a, b) => {
      for (let i = a; i < b; i++) {
        const ai = story.ca[i];
        const k = pi + ':' + ai; let s = local.get(k);
        if (!s) { const e = M.charEff(doc, pe[pi], story.attrs[ai] || {}); s = { s: mkStyle(e), kadj: +e.kadj || 0 }; local.set(k, s); }
        st[i] = s.s; kadj[i] = s.kadj;
        const c = T[i];
        let d = c, dst = s.s;
        if (fn[i]) { d = String(fn[i].num); dst = supStyle(s.s); }
        else if (s.s.caps === 'all') d = c.toUpperCase();
        else if (s.s.caps === 'small' && c !== c.toUpperCase()) { d = c.toUpperCase(); dst = s.s.sc; }
        ds[i] = d; dsx[i] = dst;
        if (c === '\n') pi++;
      }
    };
    const shapeWord = (i, j) => {
      const s = dsx[i]; let str = ''; const map = [];
      for (let k = i; k < j; k++) { const d = ds[k]; for (let q = 0; q < d.length; q++) map.push(k); str += d; }
      const cl = Fonts.shape(s.fk, str, s.feat, s.fx + (s.kern ? 'k' : ''));
      if (!cl) { for (let k = i; k < j; k++) { adv[k] = Fonts.width100(s.fk, ds[k]); cs[k] = 1; if (s.path) gl[k] = null; } return; }
      let prevT = -1, pen = 0;
      for (const c of cl) {
        const t0 = map[c.s], t1 = map[c.s + c.n - 1], cnt = t1 - t0 + 1;
        if (t0 !== prevT) { cs[t0] = 1; pen = 0; if (s.path) gl[t0] = []; }
        for (let k = t0 + 1; k <= t1; k++) cs[k] = 0;
        for (let k = t0; k <= t1; k++) adv[k] += c.adv / cnt;
        kern[t1] += c.kern;
        if (s.path) for (const g of c.g) gl[t0].push({ id: g.id, x: pen + g.x, y: g.y });
        pen += c.adv + c.kern; prevT = t0;
      }
    };
    const shapeRange = (a, b) => {
      let i = a;
      while (i < b) {
        const c = T[i];
        if (isBRK(c)) {
          cs[i] = 1;
          if (c === ' ' || c === ' ') adv[i] = Fonts.width100(dsx[i].fk, c);
          else if (c === '') adv[i] = Fonts.width100(dsx[i].fk, ds[i]);
          i++; continue;
        }
        let j = i + 1; while (j < b && !isBRK(T[j]) && dsx[j] === dsx[i]) j++;
        shapeWord(i, j);
        if (j < b && !isBRK(T[j])) pairKern(j - 1, j);
        i = j;
      }
    };
    // kerning across a character-style change inside a word (same typeface on both sides)
    const pairKern = (a, c) => {
      const sa = dsx[a], sc = dsx[c];
      if (!sa || !sc || sa.fk !== sc.fk || !sa.kern || !sc.kern) return;
      const da = ds[a], dc = ds[c]; if (!da || !dc) return;
      const cl = Fonts.shape(sa.fk, da.slice(-1) + dc[0], { ...sa.feat, liga: false }, 'pk' + sa.fx);
      if (cl && cl.length === 2) kern[a] += cl[0].kern;
    };
    // styles & shaping are resolved lazily (whole words at a time) so composing the first frames of a long story stays cheap
    const fill = upto => {
      if (upto > n) upto = n;
      if (upto <= done) return;
      while (upto < n && !isBRK(T[upto])) upto++;
      styleRange(done, upto); shapeRange(done, upto);
      done = upto;
    };
    const empty = pe.map(e => mkStyle(e));
    return { n, pe, pstart, st, ds, dsx, adv, kern, kadj, cs, gl, obj, fn, tabLd, marker, empty, text: T, kp: [], fill, all() { fill(n); return this; } };
  }

  const isBlock = o => !!o && (o.kind === 'table' || (o.kind === 'graphic' && o.pos === 'above'));
  function advance(P, i, x, label, tc, pend) {
    const c = P.text[i];
    if (c === '\n' || c === '\u2028' || c === '­') return 0;
    if (c === '\t') return tabAdvance(P, i, x, label, tc, pend);
    const st = P.dsx[i];
    if (c === '') return Fonts.width100(st.fk, label) * st.size / 100 + st.track * st.size / 1000 * label.length;
    if (c === '￼') { const o = P.obj[i]; return o && o.kind === 'graphic' && o.pos !== 'above' ? Math.max(0, +o.item.w || 0) : 0; }
    return (P.adv[i] + P.kern[i]) * st.size / 100 + (st.track * P.ds[i].length + P.kadj[i]) * st.size / 1000;
  }
  // width of a tab: next tab stop (relative to the column's left edge) or the default 36 pt grid
  function tabAdvance(P, i, x, label, tc, pend) {
    const ax = x + (tc ? tc.off : 0), stops = tc && tc.stops;
    if (stops && stops.length) for (const s of stops) {
      if (!(s.x > ax + 0.01)) continue;
      let w;
      if (!s.t || s.t === 'l') w = s.x - ax;
      else {
        let W = 0, Wd = null; const ac = s.ac || '.', end = pend ?? P.n;
        P.fill(Math.min(end, i + 400));
        for (let k = i + 1; k < end; k++) { const ch = P.text[k]; if (ch === '\t' || ch === '\n' || ch === '\u2028') break; if (s.t === 'd' && Wd === null && ch === ac) Wd = W; W += advance(P, k, 0, label, null); }
        const ref = s.t === 'r' ? W : s.t === 'c' ? W / 2 : (Wd ?? W);
        w = Math.max(0, s.x - ref - ax);
      }
      P.tabLd[i] = s.ld || '';
      return w;
    }
    P.tabLd[i] = '';
    return (Math.floor(ax / 36 + 1e-6) + 1) * 36 - ax;
  }
  const BREAK_AFTER = new Set([' ', '-', '–', '—', '/', '­', '￼']);

  // Fill one line segment of width `avail` starting at char a with pen at startX. Returns break info.
  function fillLine(P, a, pend, avail, startX, label, hyph, tc) {
    const xs = []; let x = startX, lastBreak = -1, lastBreakSoft = false;
    const T = P.text;
    let i = a;
    for (; i < pend; i++) {
      const c = T[i];
      xs.push(x);
      if (c === '\n') { xs.push(x); return { b: i + 1, xs, para: true }; }
      if (c === '\u2028') { xs.push(x); return { b: i + 1, xs, forced: true }; }
      if (c === '￼' && isBlock(P.obj[i]) && i > a) return { b: i, xs, forced: true };
      const w = advance(P, i, x, label, tc, pend);
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
              if (bi <= a || bi > i || !P.cs[bi]) continue;
              if (xs[bi - a] + hw <= avail + 0.01) { xs.length = bi - a + 1; return { b: bi, xs, hy: true, hyw: hw }; }
            }
          }
        }
        if (lastBreak > a) { xs.length = lastBreak - a + 1; return { b: lastBreak, xs, hy: lastBreakSoft, hyw: lastBreakSoft ? hyw(P, lastBreak - 1) : 0 }; }
        // emergency break: never split a ligature cluster
        let bi = i; while (bi > a + 1 && !P.cs[bi]) bi--;
        xs.length = bi - a + 1; return { b: bi, xs };
      }
      x += w;
      if (BREAK_AFTER.has(c) && !(c === '-' && i === a)) { lastBreak = i + 1; lastBreakSoft = c === '­'; }
    }
    xs.push(x); return { b: pend, xs, end: true };
  }
  function hyw(P, i) { const s = P.dsx[Math.max(0, i)]; return Fonts.width100(s.fk, '-') * s.size / 100; }
  // natural positions from a to b (used for paragraph-composer lines)
  function measureTo(P, a, b, startX, label, tc, pend) {
    const xs = []; let x = startX;
    for (let k = a; k < b; k++) { xs.push(x); x += advance(P, k, x, label, tc, pend); }
    xs.push(x);
    const last = P.text[b - 1];
    return { b, xs, para: last === '\n', forced: last === '\u2028', end: b >= P.n && last !== '\n' };
  }

  /* ---------- Knuth–Plass paragraph composer ---------- */
  function makePlan(P, a, pend, wf, label, pe) {
    const T = P.text;
    P.fill(pend);
    for (let k = a; k < pend; k++) { const c = T[k]; if (c === '\t' || (c === '￼' && isBlock(P.obj[k]))) return null; }
    const just = pe.align === 'justify' || pe.align === 'justify-all';
    const items = [], INF = KP.INF;
    const hyOn = pe.hyph !== false && !!hyphenate;
    let k = a;
    while (k < pend) {
      const ch = T[k];
      if (ch === '\n') break;
      if (ch === ' ') { let w = 0, j = k; while (j < pend && T[j] === ' ') { w += advance(P, j, 0, label); j++; } items.push({ t: 'g', w, y: w * 0.5, z: just ? w * 0.25 : 0, ci: j }); k = j; continue; }
      if (ch === '\u2028') { items.push({ t: 'g', w: 0, y: 1e4, z: 0, ci: k }); items.push({ t: 'p', w: 0, p: -INF, ci: k + 1 }); k++; continue; }
      if (ch === '­') { items.push({ t: 'p', w: hyw(P, k - 1), p: 50, f: true, ci: k + 1, hy: true }); k++; continue; }
      let j = k; while (j < pend && !' \n\u2028­'.includes(T[j])) j++;
      // break opportunities inside the token: explicit hyphens / dashes and hyphenation points
      const pts = new Map();
      for (let q = k; q < j - 1; q++) if ('-–—/'.includes(T[q]) && q > k) pts.set(q + 1, { w: 0, p: T[q] === '-' ? 50 : 0, f: T[q] === '-', hy: false });
      if (hyOn) {
        const tok = T.slice(k, j), re = /[A-Za-zÀ-ɏ'’]+/g; let m;
        while ((m = re.exec(tok))) {
          if (m[0].length < 5 || !/^[A-Za-zÀ-ɏ]/.test(m[0])) continue;
          for (const p of hyPoints(m[0])) { const q = k + m.index + p; if (q > k && q < j && P.cs[q] && !pts.has(q)) pts.set(q, { w: hyw(P, q - 1), p: 50, f: true, hy: true }); }
        }
      }
      const qs = [...pts.keys()].sort((x, y) => x - y);
      let s0 = k;
      for (const q of [...qs, j]) {
        let w = 0; for (let t = s0; t < q; t++) w += advance(P, t, 0, label);
        items.push({ t: 'b', w });
        if (q < j) { const pp = pts.get(q); items.push({ t: 'p', w: pp.w, p: pp.p, f: pp.f, ci: q, hy: pp.hy }); }
        s0 = q;
      }
      k = j;
    }
    items.push({ t: 'g', w: 0, y: 1e4, z: 0, ci: pend }, { t: 'p', w: 0, p: -INF, ci: pend });
    let br = null;
    for (const tol of [1.5, 4, 30]) { br = KP.breaks(items, wf, tol); if (br) break; }
    if (!br) return null;
    return { start: a, next: a, k: 0, br, wf };
  }
  function kpLine(P, pi, a, pend, avail, startX, pe, label, dropLeft, dropW) {
    const W0 = avail - startX;
    let plan = P.kp[pi];
    if (!plan || plan.next !== a || Math.abs(plan.wf(plan.k) - W0) > 0.5) {
      const d0 = dropLeft;
      plan = makePlan(P, a, pend, k => k === 0 ? W0 : avail - (d0 - k > 0 ? dropW : 0), label, pe);
      P.kp[pi] = plan;
      if (!plan) return null;
    }
    const br = plan.br[plan.k]; if (!br || br.ci <= a) return null;
    const r = measureTo(P, a, br.ci, startX, label, null, pend);
    if (br.hy) { r.hy = true; r.hyw = hyw(P, br.ci - 1); }
    r.kp = true;
    plan.k++; plan.next = br.ci;
    return r;
  }

  /* ---------- text wrap ---------- */
  // x-extent of a polygon within the band [y0, y1] (page or frame coords)
  function polyXRange(pts, y0, y1) {
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < pts.length; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[(k + 1) % pts.length];
      if (ay >= y0 && ay <= y1) { if (ax < lo) lo = ax; if (ax > hi) hi = ax; }
      if (ay === by) continue;
      for (const yy of [y0, y1]) { const t = (yy - ay) / (by - ay); if (t >= 0 && t <= 1) { const x = ax + (bx - ax) * t; if (x < lo) lo = x; if (x > hi) hi = x; } }
    }
    return lo <= hi ? [lo, hi] : null;
  }
  // exclusions: {x0,y0,x1,y1 (extents incl. offset), off, poly?: [[x,y]…], jump?: bool}
  function intervals(L, R, top, bot, excl, minW) {
    let segs = [[L, R]];
    for (const e of excl) {
      if (e.y0 >= bot || e.y1 <= top) continue;
      let bx0, bx1;
      if (e.jump) { bx0 = -Infinity; bx1 = Infinity; }
      else if (e.poly) { const r = polyXRange(e.poly, top - e.off, bot + e.off); if (!r) continue; bx0 = r[0] - e.off; bx1 = r[1] + e.off; }
      else { bx0 = e.x0; bx1 = e.x1; }
      const out = [];
      for (const [a, b] of segs) {
        if (bx1 <= a || bx0 >= b) { out.push([a, b]); continue; }
        if (bx0 > a) out.push([a, bx0]);
        if (bx1 < b) out.push([bx1, b]);
      }
      segs = out;
    }
    return segs.filter(s => s[1] - s[0] >= minW);
  }
  function localExcl(list, it) {
    return (list || []).map(e => ({ ...e, x0: e.x0 - it.x, x1: e.x1 - it.x, y0: e.y0 - it.y, y1: e.y1 - it.y, poly: e.poly ? e.poly.map(([x, y]) => [x - it.x, y - it.y]) : null }));
  }

  /* ---------- footnotes ---------- */
  function footnoteStyle(doc) {
    const fs = doc.paraStyles.footnote;
    const e = fs ? M.paraEff(doc, { ps: 'footnote' }) : { ...M.paraEff(doc, { ps: 'basic' }), size: 7.5, lead: 9.5 };
    return mkStyle({ ...e, caps: 'none', under: false, strike: false, shift: 0 });
  }
  const FN_SEP = 9;
  function noteBlock(fst, f, w) {
    const ind = fst.size * 1.6;
    const lines = simpleLines(String(f.note.text || ''), fst.fk, fst.size, Math.max(20, w - ind));
    return { id: f.id, num: f.num, lines, h: lines.length * fst.lead + 2, ind };
  }

  /* frames: [{item, label (page number string), excl:[exclusions in page coords], grid:{start,step}}]
     Keep options (paragraph attributes keepNext / keepAll / keepStart / keepEnd / startOn) are honoured by
     column checkpoints: the composer state is saved at the top of every column; when a column ends in a way
     that breaks a keep rule (orphan, widow, heading left at the foot of a column, split "keep together"
     paragraph) the column is re-set from its checkpoint with an earlier stop position. */
  function layoutStory(doc, story, frames, opts = {}) {
    const P = prepare(doc, story, opts.fnBase || 0);
    let fnCarry = [];                                           // footnote lines continued in the next column
    const n = P.n, T = P.text;
    const out = frames.map(() => ({ lines: [], a: n, b: n, notes: [] }));
    let i = 0, pi = 0, needFinal = n === 0 || T[n - 1] === '\n', doneFinal = false;
    let pendingSp = 0, dropLeft = 0, dropW = 0;
    let tstate = null;                                        // inline table continued in the next column
    let fst = null;
    const cons = new Map(), snaps = new Map();                // keep-option stop positions / checkpoints per column
    let prevCol = null, restores = 0, fi = 0, c = 0;
    const KEY = (f, cc) => f * 1000 + cc;
    const snap = (key, fo) => snaps.set(key, { i, pi, doneFinal, pendingSp, dropLeft, dropW, tstate: tstate ? { ...tstate } : null, fnCarry: fnCarry.slice(), fst, prevCol, nl: fo.lines.length, nn: fo.notes.length, a: fo.a, kp: P.kp[pi] ? { ...P.kp[pi] } : null });
    const restore = key => {
      const s = snaps.get(key), f = Math.floor(key / 1000);
      ({ i, pi, doneFinal, pendingSp, dropLeft, dropW, fst, prevCol } = s);
      tstate = s.tstate ? { ...s.tstate } : null; fnCarry = s.fnCarry.slice();
      out[f].lines.length = s.nl; out[f].notes.length = s.nn; out[f].a = s.a;
      for (let k = f + 1; k < out.length; k++) out[k] = { lines: [], a: n, b: n, notes: [] };
      P.kp[pi] = s.kp ? { ...s.kp } : undefined;
      for (const k of [...cons.keys()]) if (k > key) cons.delete(k);
      fi = f; c = key % 1000;
    };
    const keepN = v => Math.max(0, Math.min(9, v | 0));
    // a column ended before the end of the story: earliest legal stop that satisfies the keep rules (or null)
    function keepStop(colLines, key) {
      const tl = colLines.filter(l => !l.block || l.pi != null);
      if (!tl.length) return null;
      const first = tl[0].a;
      const startsHere = p => tl.some(l => l.pi === p && l.a === P.pstart[p]);
      let at = i, q = pi;
      if (i > P.pstart[pi]) {                                  // the column ends inside paragraph pi
        if (!startsHere(pi)) return null;
        const e = P.pe[pi], m = tl.filter(l => l.pi === pi && !l.block).length;
        const prevKeep = pi > 0 && startsHere(pi - 1) ? keepN(P.pe[pi - 1].keepNext) : 0;
        if (!(e.keepAll || (keepN(e.keepStart) > m) || prevKeep > m)) return null;
        at = P.pstart[pi];
      }
      // headings (keep with next) follow the paragraph they belong to into the next column
      while (q > 0 && keepN(P.pe[q - 1].keepNext) > 0 && startsHere(q - 1)) { q--; at = P.pstart[q]; }
      // a keep chain that fills the whole column cannot be honoured: break the rule instead (as InDesign does)
      const best = at;
      if (best <= first || best >= i) return null;
      const old = cons.get(key); if (old != null && best >= old) return null;
      return { key, pos: best };
    }
    // a paragraph ended in this column after continuing from the previous one: too few lines here = widow
    function widowStop(fo, colStart, ln) {
      const p = ln.pi, e = P.pe[p], need0 = keepN(e.keepEnd);
      if (!need0 || !prevCol || fo.lines.length <= colStart) return null;
      const l0 = fo.lines[colStart]; if (l0.pi !== p || l0.a <= P.pstart[p] || l0.block) return null;
      const m2 = fo.lines.slice(colStart).filter(l => l.pi === p && !l.block).length;
      if (m2 >= need0) return null;
      const pl = prevCol.lines.filter(l => l.pi === p && !l.block); if (!pl.length) return null;
      const startedPrev = pl[0].a === P.pstart[p] || (pl[0].drop && pl[0].drop.i0 === P.pstart[p]);
      if (startedPrev && pl.some(l => l.drop)) return null;    // never split a drop cap from its lines
      const need = need0 - m2, keep = pl.length - need;
      let pos = null;
      if (keep >= Math.max(1, keepN(e.keepStart))) pos = pl[keep].a;
      else if (startedPrev) pos = P.pstart[p];
      const first = prevCol.lines[0]?.a ?? 0;
      if (pos == null || pos <= first) return null;
      const old = cons.get(prevCol.key); if (old != null && pos >= old) return null;
      return { key: prevCol.key, pos };
    }
    while (fi < frames.length) {
      const F = frames[fi], it = F.item, fo = out[fi];
      const inset = it.inset || 0, cols = Math.max(1, it.cols | 0 || 1), gut = it.gutter ?? 12;
      if (c >= cols) { fo.b = i; fi++; c = 0; continue; }
      if (c === 0) fo.a = i;
      const iw = Math.max(1, it.w - inset * 2), colW = Math.max(1, (iw - gut * (cols - 1)) / cols);
      const rotated = !!(it.rot % 360);
      const excl = rotated ? [] : localExcl(F.excl, it);
      const top = inset, bottom = it.h - inset;
      const label = F.label || '';
      const key = KEY(fi, c);
      snap(key, fo);
      const stopAt = cons.get(key);
      let viol = null, skipFrame = false;
      {
        const colL = inset + c * (colW + gut), colR = colL + colW;
        let base = null, guard = 0, lastDesc = 0, fnH = 0;
        const colStart = fo.lines.length, colNotes = [];
        // footnotes continued from the previous column take the foot of this one first
        if (fnCarry.length) {
          let room = (bottom - top) * 0.6 - FN_SEP; const left = [];
          for (const nb of fnCarry) {
            if (left.length) { left.push(nb); continue; }
            if (nb.h <= room + 0.5) { colNotes.push(nb); room -= nb.h; continue; }
            const k = Math.floor((room - 2) / fst.lead);
            if (k >= 1) { colNotes.push({ ...nb, lines: nb.lines.slice(0, k), h: k * fst.lead + 2 }); left.push({ ...nb, lines: nb.lines.slice(k), h: (nb.lines.length - k) * fst.lead + 2, cont: true }); room = 0; }
            else left.push(nb);
          }
          fnCarry = left;
          if (colNotes.length) fnH = FN_SEP + colNotes.reduce((a, x) => a + x.h, 0);
        }
        while ((i < n || (needFinal && !doneFinal)) && guard++ < 5000) {
          if (stopAt != null && i >= stopAt && i < n) break;       // keep options: column ends here
          P.fill(i + 3000);
          const pe = P.pe[pi] || P.pe[P.pe.length - 1];
          const isPS = i === P.pstart[pi];
          const colBottom = bottom - fnH;
          // start paragraph in next column / frame
          if (isPS && i < n && pe.startOn && ((pe.startOn === 'column' && base !== null) || (pe.startOn === 'frame' && fo.lines.length > 0))) { if (pe.startOn === 'frame') skipFrame = true; break; }
          /* --- block objects: inline tables and above-line graphics --- */
          if (i < n && T[i] === '￼' && isBlock(P.obj[i])) {
            const o = P.obj[i], atTop = base === null;
            const topY = atTop ? top : base + lastDesc + 3 + (isPS ? pendingSp : 0);
            const L = colL + pe.indL, R = colR - pe.indR, avH = colBottom - topY;
            const isPara = T[i + 1] === '\n', endB = i + 1 + (isPara ? 1 : 0);
            let line;
            if (o.kind === 'table') {
              const rh = Tables.rowHeights(o), nr = rh.length, hc = Math.min(o.header || 0, nr), gEnd = Tables.rowGroupEnds(o);
              const start = tstate && tstate.i === i ? tstate.row : hc;
              const rows = []; let used = 0;
              for (let r = 0; r < hc; r++) { rows.push(r); used += rh[r]; }
              let k = start;
              while (k < nr) {
                const ge = Math.max(k, gEnd[k]); let gh = 0; for (let r = k; r <= ge; r++) gh += rh[r];
                if (used + gh > avH + 0.5 && (rows.length > hc || !atTop)) break;
                for (let r = k; r <= ge; r++) rows.push(r);
                used += gh; k = ge + 1;
              }
              if (rows.length === hc && k < nr && !atTop) break;      // nothing fits here: next column
              const fin = k >= nr, tw = o.colW.reduce((x, y) => x + y, 0);
              const x0 = pe.align === 'center' ? (L + R - tw) / 2 : pe.align === 'right' ? R - tw : L;
              line = { a: i, b: fin ? endB : i, y: topY + used, xs: fin ? (isPara ? [x0, x0 + tw, x0 + tw] : [x0, x0 + tw]) : [x0], runs: [], lead: used, asc: used, desc: 0, L, R, col: c, drop: null, para: fin && isPara, pi, hy: false,
                block: { kind: 'table', obj: o, id: (story.attrs[story.ca[i]] || {}).obj, x: x0, y: topY, w: tw, rows, rh: rows.map(r => rh[r]), head: hc, cont: start > hc } };
              fo.lines.push(line); base = line.y; lastDesc = 0;
              if (!fin) { tstate = { i, row: k }; break; }
              tstate = null;
            } else {
              const w = Math.max(1, +o.item.w || 1), h = Math.max(1, +o.item.h || 1);
              if (topY + h > colBottom + 0.5 && !atTop) break;
              const x = o.align === 'center' ? (L + R - w) / 2 : o.align === 'right' ? R - w : L;
              line = { a: i, b: endB, y: topY + h, xs: isPara ? [x, x + w, x + w] : [x, x + w], runs: [], lead: h, asc: h, desc: 0, L, R, col: c, drop: null, para: isPara, pi, hy: false,
                block: { kind: 'graphic', obj: o, id: (story.attrs[story.ca[i]] || {}).obj, x, y: topY, w, h } };
              fo.lines.push(line); base = line.y; lastDesc = 0;
            }
            i = endB;
            if (isPara) { pendingSp = pe.spA + ((P.pe[pi + 1] || pe).spB || 0); pi++; dropLeft = 0; } else pendingSp = 0;
            if (i >= n && needFinal && !isPara) doneFinal = true;
            continue;
          }
          const st0 = i < n ? P.st[i] : P.empty[pi] || P.empty[0];
          let lead = st0.lead, asc = st0.m.asc * st0.size, desc = st0.m.desc * st0.size;
          let y = base === null ? top + asc : base + lead + (isPS ? pendingSp : 0);
          if (pe.grid && F.grid && !rotated) { const gs = F.grid.start, step = F.grid.step || 12; const py = it.y + y; y = gs + Math.ceil((py - gs - 0.01) / step) * step - it.y; }
          if (y + desc > colBottom + 0.5) break;               // column full
          const minW = Math.max(18, st0.size * 4);
          const segs = intervals(colL + pe.indL, colR - pe.indR, y - asc, y + desc, excl, minW);
          if (!segs.length) {
            // jump below the obstruction
            let nb = Infinity; for (const r of excl) if (r.y0 < y + desc && r.y1 > y - asc) nb = Math.min(nb, r.y1);
            if (!isFinite(nb)) break;
            base = nb + asc - lead; pendingSp = 0; if (base + lead + desc > colBottom) break; continue;
          }
          const placed = [];
          for (let si = 0; si < segs.length; si++) {
            if (!(i < n || (needFinal && !doneFinal))) break;
            if (i < n && T[i] === '￼' && isBlock(P.obj[i])) break;
            if (si > 0 && stopAt != null && i >= stopAt && i < n) break;
            const [L, R] = segs[si];
            const ps = P.pstart[pi], pend = pi + 1 < P.pstart.length ? P.pstart[pi + 1] : n;
            const firstOfPara = i === ps;
            let startX = 0, drop = null, a = i, marker = null;
            if (firstOfPara) {
              startX = pe.indF; dropLeft = 0; dropW = 0;
              const dc = Math.max(1, pe.dropC | 0);
              if (pe.dropL >= 2 && pend - ps > dc + 1 && !/[\s￼]/.test(T.slice(ps, ps + dc))) {
                const s0 = P.dsx[ps], body = P.st[ps];
                const D = ((pe.dropL - 1) * body.lead + body.m.cap * body.size) / s0.m.cap;
                const dst = sized(s0, +D.toFixed(2));
                let dx = 0; const dxs = [];
                for (let k = 0; k < dc; k++) { dxs.push(dx); dx += Fonts.width100(dst.fk, P.ds[ps + k]) * dst.size / 100; }
                dropW = dx + body.size * 0.3; dropLeft = pe.dropL;
                drop = { x: L, y: y + (pe.dropL - 1) * body.lead, text: P.ds.slice(ps, ps + dc).join(''), st: dst, i0: ps, i1: ps + dc, xs: dxs.map(v => L + v) };
                a = ps + dc; startX = dropW;
              } else if (P.marker[pi] && (pe.list === 'bullet' || pe.list === 'number')) {
                const mst = i < n && T[i] !== '\n' ? P.st[i] : P.empty[pi];
                const mt = P.marker[pi], mw = Fonts.width100(mst.fk, mt) * mst.size / 100;
                const tx = pe.indF < 0 && pe.indF + mw + 2 <= 0 ? 0 : pe.indF + mw + mst.size * 0.5;
                marker = { x: L + pe.indF, text: mt, st: mst, w: mw };
                startX = tx;
              }
            } else if (dropLeft > 0) startX = dropW;
            const avail = R - L;
            const tc = { stops: Array.isArray(pe.tabs) && pe.tabs.length ? pe.tabs : null, off: L - colL };
            let r = null;
            if (i < n && pe.composer === 'paragraph') r = kpLine(P, pi, a, pend, avail, startX, pe, label, dropLeft, dropW);
            if (!r) r = i < n ? fillLine(P, a, pend, avail, startX, label, pe.hyph !== false && !!hyphenate, tc) : { b: n, xs: [startX], end: true };
            if (i >= n) doneFinal = true;
            if (r.b === a && !r.para && i < n && !(r.forced && T[a] === '￼')) { r.b = a + 1; r.xs = [startX, startX + advance(P, a, startX, label, tc, pend)]; }
            // trim trailing invisible chars for alignment
            let e = r.b; while (e > a && /[ \n\u2028­]/.test(T[e - 1])) e--;
            const nat = r.xs[e - a] - startX + (r.hy ? r.hyw : 0);
            const free = avail - startX - nat;
            const lastLine = r.para || r.end || r.forced;
            let shift = 0, extra = 0, spaces = 0;
            const al = pe.align;
            if (al === 'center') shift = free / 2; else if (al === 'right') shift = free;
            else if ((al === 'justify' && !lastLine) || al === 'justify-all') { for (let k = a; k < e; k++) if (T[k] === ' ') spaces++; if (spaces && (free > 0 || r.kp)) extra = free / spaces; }
            const xs = new Array(r.xs.length);
            let add = 0;
            for (let k = 0; k < r.xs.length; k++) { xs[k] = L + r.xs[k] + shift + add; if (extra && a + k < e && T[a + k] === ' ') add += extra; }
            // drawing runs: contiguous glyphs at natural advance (split at kerning, spacing and style changes)
            const runs = [], objs = [], notes = []; let cur = null;
            for (let k = a; k < e; k++) {
              const ch = T[k];
              if (ch === '￼') { cur = null; const o = P.obj[k]; if (o && o.kind === 'graphic') objs.push({ k, o, id: (story.attrs[story.ca[k]] || {}).obj, x: xs[k - a] }); continue; }
              if (ch === ' ' || ch === '\t' || ch === '­' || ch === '\n' || ch === '\u2028') {
                cur = null;
                if (ch === '\t' && P.tabLd[k]) {
                  const s = P.dsx[k], ld = P.tabLd[k], wl = Fonts.width100(s.fk, ld) * s.size / 100, x0 = xs[k - a], x1 = xs[k + 1 - a];
                  if (wl > 0.1) { const st = Math.ceil((x0 + s.size * 0.2) / wl) * wl, cnt = Math.floor((x1 - s.size * 0.2 - st) / wl + 1e-6); if (cnt > 0) runs.push({ x: st, text: ld.repeat(cnt), st: s, i0: k, i1: k, end: st + cnt * wl, px: [st], parts: [ld.repeat(cnt)], leader: true }); }
                }
                continue;
              }
              const s = P.dsx[k];
              if (P.fn[k]) notes.push(P.fn[k]);
              if (ch === '') { cur = null; const x0 = xs[k - a]; runs.push({ x: x0, text: label, st: s, i0: k, i1: k + 1, end: xs[k + 1 - a], px: [x0], parts: [label] }); continue; }
              const x0 = xs[k - a];
              if (!P.cs[k] && cur && cur.st === s) { cur.text += P.ds[k]; cur.parts[cur.parts.length - 1] += P.ds[k]; cur.i1 = k + 1; cur.end = xs[k + 1 - a]; cur.nend = xs[k + 1 - a] - (P.kern[k] * s.size / 100 + P.kadj[k] * s.size / 1000); continue; }
              const d = P.ds[k];
              if (cur && cur.st === s && Math.abs(cur.nend - x0) < 0.01) { cur.text += d; cur.i1 = k + 1; cur.px.push(x0); cur.parts.push(d); if (cur.g) cur.g.push(P.gl[k] || null); }
              else { cur = { x: x0, text: d, st: s, i0: k, i1: k + 1, px: [x0], parts: [d], path: s.path, g: s.path ? [P.gl[k] || null] : null }; runs.push(cur); }
              cur.end = xs[k + 1 - a];
              cur.nend = xs[k + 1 - a] - (P.kern[k] * s.size / 100 + P.kadj[k] * s.size / 1000);
            }
            for (const rr of runs) { delete rr.nend; }
            if (r.hy && e > a) { const s = P.dsx[e - 1]; runs.push({ x: xs[e - a], text: '-', st: s, i0: e, i1: e, end: xs[e - a] + r.hyw, hy: true, px: [xs[e - a]], parts: ['-'] }); }
            if (marker) runs.unshift({ x: marker.x, text: marker.text, st: marker.st, i0: a, i1: a, end: marker.x + marker.w, px: [marker.x], parts: [marker.text], marker: true });
            // line metrics from chars actually placed
            let mLead = 0, mAsc = 0, mDesc = 0;
            for (let k = a; k < Math.max(e, a + 1) && k < n; k++) {
              const s = P.st[k]; if (s.lead > mLead) mLead = s.lead;
              let aa = s.m.asc * s.size; const dd = s.m.desc * s.size;
              if (T[k] === '￼') { const o = P.obj[k]; if (o && o.kind === 'graphic') { aa = Math.max(aa, (+o.item.h || 0) + (+o.shift || 0)); if (aa + 2 > mLead) mLead = aa + 2; } }
              if (aa > mAsc) mAsc = aa; if (dd > mDesc) mDesc = dd;
            }
            if (!mLead) { mLead = lead; mAsc = asc; mDesc = desc; }
            const fullXs = drop ? [...drop.xs, ...xs] : xs;
            const ln = { a: drop ? drop.i0 : a, b: r.b, y, xs: fullXs, runs, lead: mLead, asc: mAsc, desc: mDesc, L, R, col: c, drop, para: !!r.para, pi, hy: !!r.hy };
            if (objs.length) ln.objs = objs;
            if (notes.length) ln.notes = notes;
            // paragraph rules (above the first line / below the last line), y relative to the baseline
            if ((pe.ruleA && firstOfPara) || (pe.ruleB && (r.para || r.end))) {
              const rules = [], tx0 = runs.length ? Math.min(...runs.map(q => q.x)) : L + startX, tx1 = runs.length ? Math.max(...runs.map(q => q.end)) : tx0;
              const mk = (ru, dy) => { const w = Math.max(0.1, +ru.w || 1), x0 = ru.mode === 'text' ? (drop ? drop.x : tx0) : colL + pe.indL, x1 = ru.mode === 'text' ? tx1 : colR - pe.indR; rules.push({ x0: x0 + (ru.indL || 0), x1: x1 - (ru.indR || 0), dy, w, color: ru.color || '#1a1a1a' }); };
              if (pe.ruleA && firstOfPara) mk(pe.ruleA, -(+pe.ruleA.off || 0) - Math.max(0.1, +pe.ruleA.w || 1) / 2);
              if (pe.ruleB && (r.para || r.end)) mk(pe.ruleB, (+pe.ruleB.off || 0) + Math.max(0.1, +pe.ruleB.w || 1) / 2);
              ln.rules = rules;
            }
            placed.push(ln);
            i = r.b;
            if (dropLeft > 0) dropLeft--;
            if (r.para) { pendingSp = pe.spA + ((P.pe[pi + 1] || pe).spB || 0); pi++; dropLeft = 0; break; }
            if (r.end || r.forced) break;
          }
          if (!placed.length) break;
          // correct baseline if the line turned out taller than estimated
          const realLead = Math.max(...placed.map(l => l.lead));
          if (base !== null && realLead > lead) { const d = realLead - lead; placed.forEach(l => { l.y += d; if (l.drop) l.drop.y += d; }); }
          if (base === null) { const ra = Math.max(...placed.map(l => l.asc)); if (ra > asc) { const d = ra - asc; placed.forEach(l => { l.y += d; if (l.drop) l.drop.y += d; }); } }
          const ly = placed[0].y, ldesc = Math.max(...placed.map(l => l.desc));
          // footnotes referenced on this line need room at the foot of the column
          const newNotes = placed.flatMap(l => l.notes || []);
          let needFn = fnH;
          const blocks = [], carryOut = [];
          if (newNotes.length) {
            fst = fst || footnoteStyle(doc);
            const sep = colNotes.length ? 0 : FN_SEP;
            let room = bottom - (ly + ldesc) - fnH - sep;
            for (const f of newNotes) {
              const nb = noteBlock(fst, f, colW);
              if (carryOut.length || fnCarry.length) { carryOut.push(nb); continue; }
              if (nb.h <= room + 0.5) { blocks.push(nb); room -= nb.h; continue; }
              // split the note: the rest continues at the foot of the next column / frame
              const k = Math.floor((room - 2) / fst.lead);
              if (k >= 1) { blocks.push({ ...nb, lines: nb.lines.slice(0, k), h: k * fst.lead + 2 }); carryOut.push({ ...nb, lines: nb.lines.slice(k), h: (nb.lines.length - k) * fst.lead + 2, cont: true }); room = 0; }
              else carryOut.push(nb);
            }
            if (blocks.length) needFn = fnH + sep + blocks.reduce((a, x) => a + x.h, 0);
            if (!blocks.length && base !== null && !fnCarry.length) { i = placed[0].a; if (placed.some(l => l.para)) { pi = placed[0].pi; } doneFinal = false; break; }
          }
          if (ly + ldesc > bottom - needFn + 0.5 && base !== null) { i = placed[0].a; if (placed.some(l => l.para)) { pi = placed[0].pi; } doneFinal = false; break; }
          fo.lines.push(...placed);
          if (blocks.length) { colNotes.push(...blocks); fnH = needFn; }
          if (carryOut.length) fnCarry.push(...carryOut);
          base = ly; lastDesc = ldesc;
          // widow control: a paragraph that ended here with too few lines pulls lines over from the previous column
          if (restores < 200) for (const l of placed) if ((l.para || l.b >= n) && (viol = widowStop(fo, colStart, l))) break;
          if (viol) break;
        }
        if (!viol && i < n && restores < 200 && !skipFrame) viol = keepStop(fo.lines.slice(colStart), key);
        if (viol) { restores++; cons.set(viol.key, viol.pos); restore(viol.key); continue; }
        // vertical alignment
        if (it.valign && it.valign !== 'top' && fo.lines.length > colStart) {
          const ls = fo.lines.slice(colStart), last = ls[ls.length - 1];
          const free = bottom - fnH - (last.y + last.desc);
          const d = it.valign === 'center' ? free / 2 : it.valign === 'bottom' ? free : 0;
          if (d > 0) ls.forEach(l => { l.y += d; if (l.drop) l.drop.y += d; if (l.block) l.block.y += d; });
        }
        if (colNotes.length) fo.notes.push({ x: colL, w: colW, y: bottom - fnH, st: fst, notes: colNotes });
        prevCol = { key, lines: fo.lines.slice(colStart) };
      }
      c++;
      if (c >= cols || skipFrame) { fo.b = i; fi++; c = 0; }
    }
    return { frames: out, overset: i < n || fnCarry.length > 0, notesOverset: fnCarry.length > 0, end: i, n, P };
  }

  /* simple wrapped text for table cells and footnotes: returns lines [{text, w}] */
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

  window.Layout = { layoutStory, mkStyle, derive, simpleLines, hyPoints, polyXRange, intervals, listMarker, fmtNumber, roman, alpha, FN_SEP, footnoteStyle, isBlock, get hasHyphenation() { return !!hyphenate; } };
})();
