'use strict';
/* Lumen Write — pagination.
   The document is one continuous contenteditable flow laid over a stack of page sheets. After every change
   the pager measures the flow once, decides where each page must end (lines, table rows or whole blocks,
   with widow/orphan control, keep-with-next for headings and room for footnotes), then inserts invisible,
   non-editable "gap" elements that push the following content to the top of the next page.
   Gaps count zero in selection positions and are stripped from everything that is saved. */
const Pager = (() => {
  const GAP = 28;   // px between sheets
  let measureEl = null, noteCache = new Map(), running = false, last = { pages: 1 }, lastMs = 0, lazyT = 0;
  const G = () => {
    const p = S.doc.page;
    const g = { W: p.w * PX, H: p.h * PX, mt: p.mt * PX, mb: p.mb * PX, ml: p.ml * PX, mr: p.mr * PX, hd: (p.hd || 36) * PX, fd: (p.fd || 36) * PX };
    g.cw = g.W - g.ml - g.mr; g.ch = g.H - g.mt - g.mb; g.pitch = g.H + GAP;
    return g;
  };
  function removeGaps() {
    const parents = new Set();
    S.ed.querySelectorAll('.pg-gap').forEach(g => { const p = g.parentNode; g.remove(); if (p && p.nodeName !== 'TBODY' && p.nodeName !== 'TABLE') parents.add(p); });
    for (const p of parents) if (p.isConnected) p.normalize();
  }
  function noteHeight(id) {
    const text = S.doc.notes[id] || '';
    const key = text + '|' + G().cw;
    if (noteCache.has(key)) return noteCache.get(key);
    if (!measureEl) { measureEl = document.createElement('div'); measureEl.className = 'fnarea fnmeasure'; document.getElementById('pages').appendChild(measureEl); }
    measureEl.style.width = G().cw + 'px';
    measureEl.innerHTML = `<div class="fnote"><sup>9</sup> ${Aero.esc(text)}</div>`;
    const h = measureEl.firstChild.getBoundingClientRect().height / S.zoom + 2;
    noteCache.set(key, h); if (noteCache.size > 2000) noteCache.clear();
    return h;
  }
  const FN_SEP = 14;  // separator line + spacing above the notes

  /* ---------- measuring helpers (all in unscaled editor coordinates) ---------- */
  let edTop = 0, z = 1;
  const Y = cy => (cy - edTop) / z;
  function rectY(el) { const r = el.getBoundingClientRect(); return { top: Y(r.top), bottom: Y(r.bottom) }; }
  // visual lines of a block: [{top, bottom, pos:{node,off}|{before}, lh}]
  function linesOf(E) {
    const lines = [], rg = document.createRange();
    let cur = null;
    const add = (top, bottom, pos, el) => {
      if (bottom - top < 0.5) return;
      if (!cur || top >= cur.bottom - 1.5) { cur = { top, bottom, pos, el }; lines.push(cur); }
      else { cur.top = Math.min(cur.top, top); cur.bottom = Math.max(cur.bottom, bottom); }
    };
    const charTop = (node, o) => { rg.setStart(node, o); rg.setEnd(node, o + 1); const rs = rg.getClientRects(); return rs.length ? Y(rs[rs.length - 1].top) : -Infinity; };
    (function walk(el) {
      for (let n = el.firstChild; n; n = n.nextSibling) {
        if (n.nodeType === 3) {
          if (!n.nodeValue.length) continue;
          rg.selectNodeContents(n);
          const rs = [...rg.getClientRects()].filter(q => q.height > 0);
          for (let j = 0; j < rs.length; j++) {
            const top = Y(rs[j].top), bottom = Y(rs[j].bottom);
            if (j === 0 || (cur && top < cur.bottom - 1.5)) { add(top, bottom, { node: n, off: 0 }, n.parentNode); continue; }
            // find the first character of this line fragment
            let lo = 0, hi = n.nodeValue.length - 1;
            while (lo < hi) { const mid = (lo + hi) >> 1; if (charTop(n, mid) >= top - 1) hi = mid; else lo = mid + 1; }
            add(top, bottom, { node: n, off: lo }, n.parentNode);
          }
        } else if (n.nodeType === 1) {
          if (n.classList.contains('pg-gap')) continue;
          if (n.nodeName === 'IMG') { if (n.dataset.wrap === 'left' || n.dataset.wrap === 'right') continue; const r = rectY(n); add(r.top, r.bottom, { before: n }, n.parentNode); continue; }
          if (n.nodeName === 'SUP' && n.classList.contains('fn')) { const r = rectY(n); add(r.top, r.bottom, { before: n }, n.parentNode); continue; }
          if (n.nodeName === 'BR' || n.nodeName === 'TABLE') continue;
          walk(n);
        }
      }
    })(E);
    return lines;
  }
  function lineHeightOf(el) { const cs = getComputedStyle(el); const lh = parseFloat(cs.lineHeight); return isNaN(lh) ? parseFloat(cs.fontSize) * 1.2 : lh; }
  function atStartOf(pos, X) {
    const rg = document.createRange(); rg.setStart(X, 0);
    if (pos.before) rg.setEndBefore(pos.before); else rg.setEnd(pos.node, pos.off);
    if (rg.toString().length) return false;
    return !rg.cloneContents().querySelector('img,br,sup.fn');
  }
  const mt = el => parseFloat(getComputedStyle(el).marginTop) || 0;
  const mb = el => parseFloat(getComputedStyle(el).marginBottom) || 0;
  function prevEl(el) { let p = el.previousElementSibling; while (p && p.classList.contains('pg-gap')) p = p.previousElementSibling; return p; }

  /* ---------- the main pass ---------- */
  function run() {
    if (running || !S.ed) return; running = true;
    const t0 = performance.now();
    clearTimeout(lazyT); lazyT = 0;
    try { for (let pass = 0; pass < 3; pass++) { const again = layout(); if (!again) break; } }
    finally { running = false; lastMs = performance.now() - t0; }
  }
  function layout() {
    const g = G();
    const selBefore = getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
    removeGaps();
    const er = S.ed.getBoundingClientRect(); edTop = er.top; z = S.zoom;
    const pageTop = k => k * g.pitch;
    const pageBottom = k => k * g.pitch + g.ch;
    // pre-measure every top-level block and every footnote reference (one layout)
    const units = [...S.ed.children].filter(e => !e.classList.contains('pg-gap'));
    const R = units.map(rectY);
    const refs = [...S.ed.querySelectorAll('sup.fn')].map(el => ({ el, id: el.dataset.fn, ...rectY(el) }));
    const ops = [];
    let shift = 0, k = 0;
    const notesOn = new Map();   // page -> Set(note id)
    const fnH = set => set && set.size ? FN_SEP + [...set].reduce((a, id) => a + noteHeight(id), 0) : 0;
    const notesOf = p => notesOn.get(p) || notesOn.set(p, new Set()).get(p);
    // limit on page k given the refs (pre-coords + delta) of the material being placed
    function limitFor(kk, cand) {
      const base = new Set(notesOf(kk));
      let lim = pageBottom(kk) - fnH(base);
      for (const r of cand) {
        if (r.bottom > lim) break;
        const s2 = new Set(base); s2.add(r.id);
        const l2 = pageBottom(kk) - fnH(s2);
        if (r.bottom <= l2) { base.add(r.id); lim = l2; } else { lim = Math.min(lim, r.top - 1); break; }
      }
      return lim;
    }
    function refsIn(el, delta, from = -Infinity, to = Infinity) {
      const out = [];
      for (const r of refs) if (el.contains(r.el)) { const t = r.top + delta, b = r.bottom + delta; if (t >= from && t < to) out.push({ id: r.id, top: t, bottom: b }); }
      return out;
    }
    const assign = (kk, list, lim) => { for (const r of list) if (r.bottom <= lim + 0.5) notesOf(kk).add(r.id); };
    const placed = []; // per unit: {top, k, split}
    for (let i = 0; i < units.length; i++) {
      const E = units[i];
      let T = R[i].top + shift, B = R[i].bottom + shift;
      // the block after a page break starts a new page
      const prev = units[i - 1];
      if (prev && prev.classList.contains('pbreak') && T > pageTop(k) + 0.5) {
        const h = pageTop(k + 1) - T;
        ops.push({ target: pageTop(k + 1), kind: 'block', before: E, h }); shift += h; T += h; B += h; k++;
      }
      // content that starts below the current page (a margin pushed it) moves on
      while (T >= pageBottom(k) - 0.5 && T > pageTop(k)) {
        if (T < pageTop(k + 1)) { const h = pageTop(k + 1) - T - Math.min(prev ? mb(prev) : 0, mt(E)); ops.push({ target: pageTop(k + 1), kind: 'block', before: E, h }); shift += pageTop(k + 1) - T; B += pageTop(k + 1) - T; T = pageTop(k + 1); }
        k++;
      }
      // floats inside may hang below the block
      let ext = B;
      E.querySelectorAll('img[data-wrap="left"],img[data-wrap="right"]').forEach(im => { ext = Math.max(ext, rectY(im).bottom + shift); });
      const myRefs = refsIn(E, shift);
      let lim = limitFor(k, myRefs);
      if (ext <= lim + 0.5) { assign(k, myRefs, lim); placed.push({ top: T, k, split: false }); continue; }
      // ---- it crosses the bottom of page k ----
      const blockBreak = () => {
        // keep-with-next: pull preceding headings along when they would be stranded
        let j = i;
        while (j > 0 && placed[j - 1] && !placed[j - 1].split && placed[j - 1].k === k && placed[j - 1].top > pageTop(k) + 1 && isKeep(units[j - 1]) && j - 1 > 0) j--;
        const X = units[j], TX = j === i ? T : placed[j].top;
        const pX = prevEl(X);
        const h = pageTop(k + 1) - TX - Math.min(pX ? mb(pX) : 0, mt(X));
        // undo the notes those headings had assigned on page k (headings rarely carry notes)
        ops.push({ target: pageTop(k + 1), kind: 'block', before: X, h, idx: j });
        const d = pageTop(k + 1) - TX;
        shift += d; k++;
        for (let q = j; q < i; q++) placed[q] = { top: placed[q].top + d, k, split: false };
        return d;
      };
      const pageH = g.ch;
      const isTable = E.nodeName === 'TABLE';
      const textual = /^(P|H[1-6]|PRE|UL|OL|BLOCKQUOTE)$/.test(E.nodeName) || (E.nodeName === 'DIV' && !E.classList.contains('pbreak') && !E.classList.contains('toc'));
      const hasBigFloat = ext > B + 0.5;
      if (isTable) {
        const rows = [...E.rows].filter(r => !r.classList.contains('pg-gap'));
        const RR = rows.map(rectY);
        let localShift = 0, first = true;
        for (let ri = 0; ri < rows.length; ri++) {
          const rt = RR[ri].top + shift + localShift, rb = RR[ri].bottom + shift + localShift;
          const rRefs = refsIn(rows[ri], shift + localShift);
          lim = limitFor(k, rRefs);
          if (rb <= lim + 0.5 || rt <= pageTop(k) + 1) { assign(k, rRefs, Math.max(lim, rb)); first = false; continue; }
          if (first) { const d = blockBreak(); localShift += 0; T += d; first = false; ri--; continue; }
          const h = pageTop(k + 1) - rt;
          ops.push({ target: pageTop(k + 1), kind: 'row', before: rows[ri], h, cols: Math.max(1, ...rows.map(r => [...r.cells].reduce((a, c) => a + c.colSpan, 0))) });
          localShift += h; k++;
          ri--;  // re-check this row on the new page
        }
        shift += localShift;
        placed.push({ top: T, k, split: true });
        continue;
      }
      if (!textual || hasBigFloat) {
        if (ext - T <= pageH + 0.5) { const d = blockBreak(); assign(k, refsIn(E, shift), Infinity); placed.push({ top: T + d, k, split: false }); }
        else { // taller than a page: let it overflow, continue after it
          assign(k, myRefs, Infinity);
          placed.push({ top: T, k, split: false });
          while (B > pageBottom(k)) k++;
        }
        if (E.classList.contains('toc') || !textual) { /* nothing */ }
        continue;
      }
      // ---- split between lines ----
      const lines = linesOf(E).map(l => ({ ...l, top: l.top + shift, bottom: l.bottom + shift }));
      if (lines.length < 1) { const d = blockBreak(); placed.push({ top: T + d, k, split: false }); continue; }
      let delta = 0, startLine = 0, splitDone = false, moved = 0;
      let guard = 0;
      while (guard++ < 500) {
        const Ls = lines.map(l => ({ ...l, top: l.top + delta, bottom: l.bottom + delta }));
        const bottomAll = B + delta;
        const segRefs = refsIn(E, shift + delta, startLine > 0 ? Ls[startLine].top - 0.5 : -Infinity);
        lim = limitFor(k, segRefs);
        if (bottomAll <= lim + 0.5) { assign(k, segRefs, lim); break; }
        // boundary (line-box top) of each line
        const bound = idx => {
          const l = Ls[idx]; const lh = lineHeightOf(l.el.nodeType === 1 ? l.el : l.el.parentNode || E);
          return l.top - (lh - (l.bottom - l.top)) / 2;
        };
        // first line that does not fit
        let br = startLine;
        while (br < Ls.length && (br + 1 < Ls.length ? bound(br + 1) : bottomAll) <= lim + 0.5) br++;
        // br = index of the first line that must go to the next page
        if (br >= Ls.length) { assign(k, segRefs, lim); break; }
        const linesHere = br - startLine, linesTotalLeft = Ls.length - startLine;
        // orphan: a single first line alone at the page bottom -> move the paragraph
        if (startLine === 0 && (br === 0 || (br === 1 && Ls.length > 1 && E.nodeName !== 'UL' && E.nodeName !== 'OL'))) {
          if (T + delta > pageTop(k) + 1) { const d = blockBreak(); shift -= d; delta += d; moved += d; continue; }
          if (br === 0) br = 1;   // already at the top of a page: must split anyway
        }
        // widow: never leave a single line for the next page if the paragraph has room to give one
        if (Ls.length - br === 1 && linesHere >= 3 && E.nodeName !== 'UL' && E.nodeName !== 'OL') br--;
        if (br <= startLine) br = startLine + 1;
        if (br >= Ls.length) { assign(k, segRefs, Infinity); break; }
        const bnd = bound(br);
        assign(k, segRefs.filter(r => r.top < bnd), lim);
        // a line that starts a nested block (list item / paragraph) breaks before that block
        const pos = Ls[br].pos;
        const X = (pos.before || pos.node).parentNode.closest('li,p,h1,h2,h3,h4,h5,h6,pre');
        if (X && X !== E && E.contains(X) && atStartOf(pos, X)) {
          const XT = rectY(X).top + shift + delta; const pX = prevEl(X);
          const h = pageTop(k + 1) - XT - Math.min(pX ? mb(pX) : 0, mt(X));
          ops.push({ target: pageTop(k + 1), kind: 'block', before: X, h });
          delta += pageTop(k + 1) - XT;
        } else {
          const h = pageTop(k + 1) - bnd;
          ops.push({ target: pageTop(k + 1), kind: 'inline', pos, h });
          delta += h;
        }
        k++; startLine = br; splitDone = true;
      }
      shift += delta;
      placed.push({ top: T + moved, k, split: splitDone });
    }
    // ---- apply (in reverse document order so earlier positions stay valid) ----
    for (let q = ops.length - 1; q >= 0; q--) apply(ops[q]);
    // fix-up: table borders and rounding can leave a pixel or two; nudge each gap so the content after it
    // lands exactly on the page top (reads only re-layout after a nudge)
    const nudges = [];
    for (const op of ops) {
      if (!op.el || !op.el.isConnected) continue;
      const top = S.ed.getBoundingClientRect().top;
      const actual = op.kind === 'inline' ? (op.el.getBoundingClientRect().bottom - top) / z : (op.before.getBoundingClientRect().top - top) / z;
      const d = op.target - actual;
      if (Math.abs(d) > 0.4) { const hEl = op.kind === 'row' ? op.el.firstChild : op.el; hEl.style.height = Math.max(0, parseFloat(hEl.style.height) + d) + 'px'; nudges.push([op.kind, Math.round(d * 10) / 10, op.target, Math.round(actual)]); }
    }
    last.nudges = nudges;
    // last page index: from the end of the flow
    const endY = units.length ? R[R.length - 1].bottom + shift : 0;
    let pages = Math.max(1, Math.floor(Math.max(0, endY - 1) / g.pitch) + 1, k + 1);
    if (units.length && units[units.length - 1].classList.contains('pbreak')) pages = Math.max(pages, k + 2);
    S.pages = pages;
    // restore a caret that sat right before an inserted gap to the start of the next line
    if (selBefore) fixCaret();
    const again = finish(g, pages);
    return again;
  }
  function isKeep(el) {
    if (!el || el.nodeType !== 1) return false;
    const st = S.doc.styles.para[Styles.idOf(el)];
    return !!(st && st.keep) || /^H[1-6]$/.test(el.nodeName);
  }
  function apply(op) {
    const h = Math.max(0, op.h);
    if (op.kind === 'block') {
      const d = document.createElement(op.before.parentNode.nodeName === 'UL' || op.before.parentNode.nodeName === 'OL' ? 'div' : 'div');
      d.className = 'pg-gap'; d.contentEditable = 'false'; d.style.height = h + 'px';
      op.before.parentNode.insertBefore(d, op.before); op.el = d;
    } else if (op.kind === 'inline') {
      const s = document.createElement('span'); s.className = 'pg-gap'; s.contentEditable = 'false'; s.style.height = h + 'px';
      const p = op.pos;
      op.el = s;
      if (p.before) p.before.parentNode.insertBefore(s, p.before);
      else if (p.off === 0) p.node.parentNode.insertBefore(s, p.node);
      else { const rest = p.node.splitText(p.off); rest.parentNode.insertBefore(s, rest); }
    } else if (op.kind === 'row') {
      const tr = document.createElement('tr'); tr.className = 'pg-gap'; tr.contentEditable = 'false';
      tr.innerHTML = `<td colspan="${op.cols}" style="height:${h}px"></td>`;
      op.before.parentNode.insertBefore(tr, op.before); op.el = tr;
    }
  }
  function fixCaret() {
    const s = getSelection(); if (!s.rangeCount || !s.isCollapsed) return;
    const n = s.anchorNode;
    if (n && n.nodeType === 3 && s.anchorOffset === n.nodeValue.length && n.nextSibling && n.nextSibling.classList && n.nextSibling.classList.contains('pg-gap') && n.nextSibling.nodeName === 'SPAN') {
      const after = n.nextSibling.nextSibling;
      if (after && after.nodeType === 3) s.collapse(after, 0);
    }
  }
  /* ---------- after layout: sheets, numbering, footnotes, TOC ---------- */
  function finish(g, pages) {
    const host = document.getElementById('sheets');
    while (host.children.length < pages) host.appendChild(makeSheet());
    while (host.children.length > pages) host.lastChild.remove();
    const pg = S.doc.page;
    const er = S.ed.getBoundingClientRect(); edTop = er.top;
    const pageOfY = y => Math.max(0, Math.min(pages - 1, Math.floor((y + g.mt + GAP / 2) / g.pitch)));
    // footnotes: number in document order, collect per page
    const per = Array.from({ length: pages }, () => []);
    let n = 0;
    S.ed.querySelectorAll('sup.fn').forEach(el => {
      n++; if (el.textContent !== String(n)) el.textContent = String(n);
      const y = rectY(el).top; per[pageOfY(y)].push({ n, id: el.dataset.fn });
    });
    const total = pages;
    const fields = (t, i) => String(t || '').replace(/\{(page|pages|title|date|author)\}/g, (m, f) => f === 'page' ? String(i + (pg.start || 1)) : f === 'pages' ? String(total) : f === 'title' ? (S.doc.meta.title || S.name) : f === 'date' ? new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : (S.doc.meta.author || ''));
    [...host.children].forEach((sh, i) => {
      sh.style.cssText = `top:${i * g.pitch}px;width:${g.W}px;height:${g.H}px`;
      const show = !(S.doc.hfFirst && i === 0);
      const hd = sh.querySelector('.hdr'), fd = sh.querySelector('.ftr'), fa = sh.querySelector('.fnarea');
      hd.style.cssText = `top:${Math.max(4, g.hd - 2)}px;left:${g.ml}px;width:${g.cw}px`;
      fd.style.cssText = `bottom:${Math.max(4, g.fd - 2)}px;left:${g.ml}px;width:${g.cw}px`;
      for (const [el, part] of [[hd, S.doc.header], [fd, S.doc.footer]]) {
        const html = show ? ['l', 'c', 'r'].map(k => `<span class="${k}">${Aero.esc(fields(part[k], i))}</span>`).join('') : '';
        if (el._h !== html) { el.innerHTML = html; el._h = html; }
      }
      fa.style.cssText = `bottom:${g.mb}px;left:${g.ml}px;width:${g.cw}px`;
      const fh = per[i].length ? '<div class="fnsep"></div>' + per[i].map(f => `<div class="fnote" data-fn="${Aero.esc(f.id)}"><sup>${f.n}</sup> ${Aero.esc(S.doc.notes[f.id] || '')}</div>`).join('') : '';
      if (fa._h !== fh) { fa.innerHTML = fh; fa._h = fh; fa.classList.toggle('on', !!fh); }
    });
    const pagesEl = document.getElementById('pages');
    pagesEl.style.height = (pages * g.pitch - GAP) + 'px'; pagesEl.style.width = g.W + 'px';
    // table of contents
    let again = false;
    const tocs = S.ed.querySelectorAll('div.toc');
    if (tocs.length) {
      const heads = [...S.ed.querySelectorAll('h1,h2,h3,[data-s="Heading1"],[data-s="Heading2"],[data-s="Heading3"]')].filter(h => !h.closest('.toc'));
      const entries = heads.map(h => ({ level: +(/\d/.exec(Styles.idOf(h)) || [1])[0], text: textOf(h), page: pageOfY(rectY(h).top) + (pg.start || 1), el: h }));
      last.toc = entries;
      const html = `<p class="toc-title">Contents</p>` + (entries.length ? entries.map((e, i) => `<p class="toc-l${e.level}" data-i="${i}"><span class="t">${Aero.esc(e.text || '(untitled)')}</span><span class="dots"></span><span class="pg">${e.page}</span></p>`).join('') : '<p class="toc-l1 dim"><span class="t">Add headings (Heading 1–3) to build the contents</span><span class="pg"></span></p>');
      tocs.forEach(t => { if (t._h !== html) { const hBefore = t.offsetHeight; t.innerHTML = html; t._h = html; if (t.offsetHeight !== hBefore) again = true; } });
    } else last.toc = null;
    last.pages = pages; last.g = g;
    if (!again) { UI.afterLayout?.(); }
    return again;
  }
  function textOf(el) { let s = ''; (function w(n) { for (let c = n.firstChild; c; c = c.nextSibling) { if (c.nodeType === 3) s += c.nodeValue; else if (c.nodeType === 1 && !c.classList.contains('pg-gap') && c.nodeName !== 'DEL' && !(c.nodeName === 'SUP' && c.classList.contains('fn'))) w(c); } })(el); return s.replace(/\s+/g, ' ').trim(); }
  function makeSheet() {
    const d = document.createElement('div'); d.className = 'page';
    d.innerHTML = '<div class="hdr"></div><div class="fnarea"></div><div class="ftr"></div>';
    return d;
  }
  // page index of a client-space y coordinate / of an element
  function pageOfClientY(cy) { const g = last.g || G(); const er = S.ed.getBoundingClientRect(); const y = (cy - er.top) / S.zoom; return Math.max(0, Math.min(S.pages - 1, Math.floor((y + g.mt + GAP / 2) / g.pitch))); }
  let pend = 0;
  function soon() { if (pend) return; pend = requestAnimationFrame(() => { pend = 0; run(); }); }
  // while typing: repaginate at once for normal documents, after a short pause for very long ones
  function typed() { if (lastMs < 45) run(); else { clearTimeout(lazyT); lazyT = setTimeout(run, 380); } }
  return { run, soon, typed, G, GAP, pageOfClientY, textOf, get last() { return last; }, removeGaps, clearCache: () => noteCache.clear() };
})();
