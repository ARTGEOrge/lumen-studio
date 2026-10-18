'use strict';
/* Lumen Write — find & replace (match case, whole words, regular expressions). Matches are highlighted
   with the CSS Custom Highlight API, so searching never touches the document. */
const Find = (() => {
  let matches = [], cur = -1, bar, q, r;
  const hl = window.CSS && CSS.highlights;
  function paragraphs() {
    // leaf paragraphs and their text nodes (gaps, footnote marks, TOC and deleted text excluded)
    const out = [];
    S.ed.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,pre').forEach(b => {
      if (b.closest('.toc')) return;
      const nodes = []; let text = '';
      (function walk(e) { for (let n = e.firstChild; n; n = n.nextSibling) { if (n.nodeType === 3) { nodes.push({ n, at: text.length }); text += n.nodeValue; } else if (n.nodeType === 1 && !n.classList.contains('pg-gap') && !(n.nodeName === 'SUP' && n.classList.contains('fn')) && n.nodeName !== 'DEL' && !/^(UL|OL|P|LI|TABLE)$/.test(n.nodeName)) walk(n); } })(b);
      if (text) out.push({ b, nodes, text });
    });
    return out;
  }
  function regex(src, flags) {
    const o = { cs: $('#f-case').checked, word: $('#f-word').checked, re: $('#f-re').checked };
    let s = o.re ? src : src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (o.word) s = `(?<![\\p{L}\\p{N}_])(?:${s})(?![\\p{L}\\p{N}_])`;
    try { return new RegExp(s, 'gu' + (o.cs ? '' : 'i') + (flags || '')); } catch (e) { return null; }
  }
  function pos(p, i) { let k = p.nodes.length - 1; while (k > 0 && p.nodes[k].at > i) k--; const t = p.nodes[k]; return [t.n, Math.min(i - t.at, t.n.nodeValue.length)]; }
  function search(keepCur) {
    matches = []; const src = q.value;
    if (src) {
      const re = regex(src);
      if (re) for (const p of paragraphs()) { re.lastIndex = 0; let m; while ((m = re.exec(p.text))) { if (!m[0].length) { re.lastIndex++; continue; } const rg = document.createRange(); const [a, ao] = pos(p, m.index); const [b, bo] = pos(p, m.index + m[0].length); try { rg.setStart(a, ao); rg.setEnd(b, bo); matches.push({ rg, m: [...m] }); } catch (e) { } if (matches.length > 5000) break; } }
    }
    if (!keepCur) { const sel = Sel.range(); cur = -1; if (sel) cur = matches.findIndex(x => x.rg.compareBoundaryPoints(Range.START_TO_START, sel) >= 0); }
    if (cur >= matches.length) cur = matches.length - 1;
    paint();
  }
  function paint() {
    if (hl) { hl.delete('find'); hl.delete('find-cur'); if (matches.length) { hl.set('find', new Highlight(...matches.map(x => x.rg))); if (cur >= 0 && matches[cur]) hl.set('find-cur', new Highlight(matches[cur].rg)); } }
    $('#f-count').textContent = matches.length ? `${cur >= 0 ? cur + 1 : 0} / ${matches.length}` : (q.value ? 'No results' : '0 / 0');
  }
  function go(dir) {
    if (!bar.hidden) search(true);
    if (!matches.length) { search(); if (!matches.length) return; }
    cur = cur < 0 ? (dir > 0 ? 0 : matches.length - 1) : (cur + dir + matches.length) % matches.length;
    const m = matches[cur];
    const s = getSelection(); s.removeAllRanges(); s.addRange(m.rg.cloneRange());
    const rect = m.rg.getBoundingClientRect(); const sc = $('#scroller'); const sr = sc.getBoundingClientRect();
    if (rect.top < sr.top + 40 || rect.bottom > sr.bottom - 40) sc.scrollTop += rect.top - sr.top - sr.height / 3;
    paint();
  }
  function replacement(m) {
    if (!$('#f-re').checked) return r.value;
    return r.value.replace(/\$(\d|&)/g, (x, g) => g === '&' ? m[0] : (m[+g] ?? ''));
  }
  function replaceRange(rg, text) {
    if (S.track) { Review.markDeleted(rg); const s = getSelection(); const c = document.createRange(); c.setStart(rg.endContainer, rg.endOffset); s.removeAllRanges(); s.addRange(c); if (text) Review.insertTracked(text); return; }
    // keep the formatting of the first matched character
    rg.deleteContents();
    if (text) { const t = document.createTextNode(text); rg.insertNode(t); const s = getSelection(); const c = document.createRange(); c.setStartAfter(t); s.removeAllRanges(); s.addRange(c); }
  }
  function replaceOne() {
    search(true);
    const sel = Sel.range();
    const m = matches[cur];
    if (!m || !sel || m.rg.compareBoundaryPoints(Range.START_TO_START, sel) !== 0 || m.rg.compareBoundaryPoints(Range.END_TO_END, sel) !== 0) { go(1); return; }
    Pager.removeGaps(); search(true);
    replaceRange(matches[cur].rg, replacement(matches[cur].m));
    Ed.normalize(); Pager.run(); App.commit('Replace');
    search(true); if (cur >= matches.length) cur = 0; if (matches.length) go(0); else paint();
    UI.refresh();
  }
  function replaceAll() {
    Pager.removeGaps(); search(true);
    const n = matches.length; if (!n) { Aero.toast('Nothing to replace'); Pager.run(); return; }
    for (let i = matches.length - 1; i >= 0; i--) replaceRange(matches[i].rg, replacement(matches[i].m));
    S.ed.normalize(); Ed.normalize(); Pager.run(); App.commit('Replace All');
    search(); UI.refresh();
    Aero.toast(`Replaced ${n} occurrence${n === 1 ? '' : 's'}`);
  }
  function open(withReplace) {
    bar.hidden = false; bar.classList.toggle('rep', !!withReplace);
    const s = getSelection(); const t = s.rangeCount && !s.isCollapsed ? s.toString() : '';
    if (t && t.length < 120 && !t.includes('\n')) q.value = t;
    q.focus(); q.select(); search();
  }
  function close() { bar.hidden = true; matches = []; cur = -1; if (hl) { hl.delete('find'); hl.delete('find-cur'); } S.ed.focus(); }
  function init() {
    bar = $('#findbar'); q = $('#f-q'); r = $('#f-r');
    q.addEventListener('input', () => search());
    ['#f-case', '#f-word', '#f-re'].forEach(s => $(s).addEventListener('change', () => search()));
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); } else if (e.key === 'Escape') { e.preventDefault(); close(); } });
    r.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); replaceOne(); } else if (e.key === 'Escape') { e.preventDefault(); close(); } });
    $('#f-next').onclick = () => go(1); $('#f-prev').onclick = () => go(-1);
    $('#f-one').onclick = replaceOne; $('#f-all').onclick = replaceAll; $('#f-close').onclick = close;
  }
  return { init, open, close, go, search, replaceAll, replaceOne, get count() { return matches.length; }, get isOpen() { return bar && !bar.hidden; } };
})();
