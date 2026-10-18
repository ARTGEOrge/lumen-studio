'use strict';
/* Lumen Write — editing commands. Formatting is applied as a pure transformation of the document AST:
   the selection is marked with two private-use characters, the affected blocks are converted to the AST,
   runs between the markers are changed, and the blocks are rendered back. This keeps the HTML canonical. */
const Ed = (() => {
  const MS = '', ME = '';
  const BLOCK_SEL = 'p,h1,h2,h3,h4,h5,h6,li,pre';
  const ed = () => S.ed;
  const topOf = n => { if (!n) return null; while (n.parentNode && n.parentNode !== S.ed) n = n.parentNode; return n.parentNode === S.ed ? n : null; };
  const blockOf = n => { const e = n && (n.nodeType === 1 ? n : n.parentNode); return e && e.closest ? e.closest(BLOCK_SEL) : null; };

  /* ---------------- structure normalisation ---------------- */
  function normalize() {
    const e = ed();
    // stray inline content at the top level goes into paragraphs
    let pend = null;
    for (const n of [...e.childNodes]) {
      const isBlock = n.nodeType === 1 && /^(P|H[1-6]|UL|OL|TABLE|HR|PRE|BLOCKQUOTE)$/.test(n.nodeName) || (n.nodeType === 1 && n.nodeName === 'DIV' && (n.classList.contains('pbreak') || n.classList.contains('toc') || n.classList.contains('pg-gap')));
      if (isBlock) { pend = null; continue; }
      if (n.nodeType === 1 && n.nodeName === 'DIV') {
        // Chrome sometimes creates <div> paragraphs
        const p = document.createElement('p'); for (const a of ['style', 'data-s']) if (n.hasAttribute(a)) p.setAttribute(a, n.getAttribute(a));
        while (n.firstChild) p.appendChild(n.firstChild); n.replaceWith(p); pend = null; continue;
      }
      if (n.nodeType === 3 && !n.nodeValue.length) { n.remove(); continue; }
      if (n.nodeType === 1 && n.nodeName === 'BR' && !pend) { n.remove(); continue; }
      if (!pend) { pend = document.createElement('p'); e.insertBefore(pend, n); }
      pend.appendChild(n);
    }
    if (!e.firstChild) e.innerHTML = '<p><br></p>';
    const lastBlock = [...e.children].filter(c => !c.classList.contains('pg-gap')).pop();
    if (lastBlock && /^(TABLE|HR)$/.test(lastBlock.nodeName) || (lastBlock && lastBlock.nodeName === 'DIV')) e.appendChild(Object.assign(document.createElement('p'), { innerHTML: '<br>' }));
    // spans Chrome invents when merging blocks carry computed styles: drop them (ours are marked data-f)
    e.querySelectorAll('span[style]:not([data-f]):not(.pg-gap)').forEach(sp => { sp.replaceWith(...sp.childNodes); });
    e.querySelectorAll('font').forEach(f => f.replaceWith(...f.childNodes));
    e.querySelectorAll('strike').forEach(f => { const s = document.createElement('s'); while (f.firstChild) s.appendChild(f.firstChild); f.replaceWith(s); });
    e.querySelectorAll('[style*="font-weight"],[style*="line-height"]').forEach(x => { if (x.dataset.f) return; x.style.removeProperty('font-weight'); x.style.removeProperty('line-height'); x.style.removeProperty('font-size'); x.style.removeProperty('color'); x.style.removeProperty('font-family'); if (!x.getAttribute('style')) x.removeAttribute('style'); });
    // table cells hold paragraphs
    e.querySelectorAll('td').forEach(td => { if (td.closest('tr.pg-gap')) return; if (![...td.children].some(c => /^(P|H[1-6]|UL|OL|TABLE|PRE)$/.test(c.nodeName))) { const p = document.createElement('p'); while (td.firstChild) p.appendChild(td.firstChild); if (!p.firstChild) p.innerHTML = '<br>'; td.appendChild(p); } });
    // empty paragraphs need a <br> to keep their height
    e.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li').forEach(p => { if (!p.firstChild) p.innerHTML = '<br>'; });
  }

  /* ---------------- AST transformation of the selection ---------------- */
  function markSelection(r) {
    const a = document.createTextNode(MS), b = document.createTextNode(ME);
    const end = r.cloneRange(); end.collapse(false); end.insertNode(b);
    const st = r.cloneRange(); st.collapse(true); st.insertNode(a);
    return [a, b];
  }
  function cellOrRoot(n) { const td = n.parentNode && n.parentNode.closest ? n.parentNode.closest('td') : null; return td && S.ed.contains(td) ? td : S.ed; }
  // run fnRun(run) on every run inside the selection and fnPara(p) on every paragraph touched; re-render
  function transform({ fnRun, fnPara, label, collapsedWord, keepSel = true, blocksFn }) {
    let r = Sel.range(); if (!r) { S.ed.focus(); r = Sel.range(); if (!r) return false; }
    if (r.collapsed && collapsedWord && fnRun) { const w = wordRange(r); if (w) r = w; }
    App.flushTyping();
    Pager.removeGaps();
    r = Sel.range() || r;
    if (r.collapsed && collapsedWord && fnRun) { const w = wordRange(r); if (w) r = w; }
    const [ma, mb] = markSelection(r);
    const posA = Sel.posOf(ma, 0), posB = Sel.posOf(mb, 0) - 1;
    const ta = topOf(ma), tb = topOf(mb);
    const kids = [...S.ed.childNodes]; const i0 = kids.indexOf(ta), i1 = kids.indexOf(tb);
    if (i0 < 0 || i1 < 0) { ma.remove(); mb.remove(); return false; }
    const nodes = kids.slice(i0, i1 + 1);
    const blocks = Model.htmlToAst({ childNodes: nodes }, { styles: S.doc.styles, hasAsset: id => !!S.assets[id] });
    let inSel = false;
    const touched = [];
    function doRuns(p) {
      const out = []; let touchedP = inSel;
      for (const run of p.runs) {
        if (run.t !== 'text') { if (inSel && fnRun) fnRun(run); out.push(run); continue; }
        // split around markers
        let t = run.text, buf = '';
        const flush = () => { if (buf) { const q = { ...run, text: buf }; if (inSel && fnRun) fnRun(q); out.push(q); buf = ''; } };
        for (const ch of t) {
          if (ch === MS) { flush(); inSel = true; touchedP = true; }
          else if (ch === ME) { flush(); inSel = false; touchedP = true; }
          else buf += ch;
        }
        flush();
      }
      p.runs = out.filter(q => q.t !== 'text' || q.text.length || false);
      if (touchedP) touched.push(p);
    }
    (function walk(bs) { for (const b of bs) { if (b.t === 'p') doRuns(b); else if (b.t === 'table') for (const row of b.rows) for (const c of row.cells) walk(c.blocks); } })(blocks);
    if (fnPara) touched.forEach(fnPara);
    let outBlocks = blocks;
    if (blocksFn) outBlocks = blocksFn(blocks, touched) || blocks;
    // merge runs again
    Model.eachPara(outBlocks, p => { const o = []; for (const q of p.runs) { const prev = o[o.length - 1]; if (prev && prev.t === 'text' && q.t === 'text' && Model.sameFmt(prev, q)) prev.text += q.text; else o.push(q); } p.runs = o; });
    const html = Model.blocksHtml(outBlocks, { src: App.src });
    const tpl = document.createElement('template'); tpl.innerHTML = html;
    const first = nodes[0];
    S.ed.insertBefore(tpl.content, first);
    nodes.forEach(n => n.remove());
    normalize();
    Pager.run();
    if (keepSel) Sel.restore({ a: posA, f: posB });
    if (label) App.commit(label);
    UI.refresh();
    return true;
  }
  function wordRange(r) {
    const n = r.startContainer; if (n.nodeType !== 3) return null;
    const t = n.nodeValue; let a = r.startOffset, b = r.startOffset;
    const W = /[\p{L}\p{N}_'’-]/u;
    while (a > 0 && W.test(t[a - 1])) a--; while (b < t.length && W.test(t[b])) b++;
    if (a === b) return null;
    const w = document.createRange(); w.setStart(n, a); w.setEnd(n, b); return w;
  }

  /* ---------------- character formatting ---------------- */
  const NATIVE = { b: 'bold', i: 'italic', u: 'underline', s: 'strikeThrough', sup: 'superscript', sub: 'subscript' };
  function stateOf(key) {
    const r = Sel.range(); if (!r) return false;
    // all text in the selection has the property?
    const test = el => {
      if (!el || el.nodeType !== 1) return false;
      const cs = getComputedStyle(el);
      if (key === 'b') return +cs.fontWeight >= 600;
      if (key === 'i') return cs.fontStyle === 'italic';
      if (key === 'u') return !!el.closest('u') || /underline/.test(cs.textDecorationLine);
      if (key === 's') return !!el.closest('s,strike');
      if (key === 'sup') return !!el.closest('sup:not(.fn)');
      if (key === 'sub') return !!el.closest('sub');
      return false;
    };
    if (r.collapsed) { try { if (NATIVE[key] && document.queryCommandState(NATIVE[key])) return true; } catch (e) { } return test(r.startContainer.nodeType === 3 ? r.startContainer.parentNode : r.startContainer); }
    const texts = textNodesIn(r); if (!texts.length) return false;
    return texts.every(t => test(t.parentNode));
  }
  function textNodesIn(r) {
    const out = []; const root = r.commonAncestorContainer.nodeType === 3 ? r.commonAncestorContainer.parentNode : r.commonAncestorContainer;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.currentNode.nodeType === 3 ? w.currentNode : w.nextNode(); n; n = w.nextNode()) { if (!n.nodeValue.trim()) continue; if (r.intersectsNode(n) && !(n === r.endContainer && r.endOffset === 0) && !(n === r.startContainer && r.startOffset === n.nodeValue.length)) out.push(n); }
    return out;
  }
  function toggle(key) {
    const r = Sel.range(); if (!r) return;
    if (r.collapsed) { document.execCommand(NATIVE[key]); return; }
    const on = !stateOf(key);
    const names = { b: 'Bold', i: 'Italic', u: 'Underline', s: 'Strikethrough', sup: 'Superscript', sub: 'Subscript' };
    transform({ label: names[key], fnRun: run => { if (run.t !== 'text') return; if (on) { run[key] = true; if (key === 'sup') delete run.sub; if (key === 'sub') delete run.sup; } else delete run[key]; } });
  }
  function setRunProp(prop, value, label) {
    transform({ label, collapsedWord: true, fnRun: run => { if (run.t !== 'text') return; if (value == null || value === '') delete run[prop]; else run[prop] = value; } });
  }
  function charStyle(id) { transform({ label: 'Character Style', collapsedWord: true, fnRun: run => { if (run.t !== 'text') return; if (!id) delete run.cs; else run.cs = id; } }); }
  function clearFormatting() {
    transform({ label: 'Clear Formatting', fnRun: run => { for (const k of ['b', 'i', 'u', 's', 'sup', 'sub', 'color', 'bg', 'font', 'size', 'cs']) delete run[k]; }, fnPara: p => { if (!p.list) p.style = 'Normal'; delete p.align; delete p.ind; delete p.fi; } });
  }
  function link(href) {
    const h = Model.safeHref(href);
    transform({ label: h ? 'Insert Link' : 'Remove Link', collapsedWord: true, fnRun: run => { if (h) run.link = h; else delete run.link; } });
  }

  /* ---------------- paragraph formatting ---------------- */
  function paraStyle(id) {
    const st = S.doc.styles.para[id]; if (!st) return;
    transform({ label: 'Style: ' + st.name, fnPara: p => { p.style = id; } });
  }
  function align(a) { transform({ label: 'Align ' + a, fnPara: p => { if (a === 'left') delete p.align; else p.align = a; } }); }
  function toggleList(kind, fmt) {
    let all = true;
    transform({
      label: kind === 'ul' ? 'Bullets' : 'Numbering',
      blocksFn: (blocks, touched) => {
        all = touched.length && touched.every(p => p.list && p.list.kind === kind && (!fmt || p.list.fmt === fmt));
        for (const p of touched) {
          if (all) delete p.list;
          else { const lv = p.list ? p.list.level : 0; p.list = { kind, level: lv }; if (fmt && fmt !== Model.defaultListFmt(kind, lv)) p.list.fmt = fmt; if (/^Heading|Title|Subtitle/.test(p.style)) p.style = 'Normal'; }
        }
        return blocks;
      },
    });
  }
  function indent(dir) {
    transform({
      label: dir > 0 ? 'Increase Indent' : 'Decrease Indent',
      fnPara: p => {
        if (p.list) { const lv = (p.list.level | 0) + dir; if (lv < 0) delete p.list; else { p.list.level = Math.min(8, lv); if (p.list.fmt) delete p.list.fmt; } }
        else { const v = Math.max(0, (p.ind || 0) + dir * 36); if (v) p.ind = v; else delete p.ind; }
      },
    });
  }
  function paraProps(v) {
    transform({ label: 'Paragraph', fnPara: p => { if (v.align && v.align !== 'left') p.align = v.align; else delete p.align; if (!p.list) { if (v.ind > 0) p.ind = v.ind; else delete p.ind; } if (v.fi) p.fi = v.fi; else delete p.fi; } });
  }

  /* ---------------- insertion ---------------- */
  // insert an HTML fragment (our canonical HTML) at the caret; block-level content splits the paragraph
  function insertHtml(html, label, opts = {}) {
    let r = Sel.range(); if (!r) { placeCaretEnd(); r = Sel.range(); }
    App.flushTyping();
    Pager.removeGaps();
    r = Sel.range();
    if (!r.collapsed) { if (S.track) Review.markDeleted(r); else r.deleteContents(); r = Sel.range(); r.collapse(!S.track); }
    const tpl = document.createElement('template'); tpl.innerHTML = html;
    const frag = tpl.content;
    const blockish = [...frag.childNodes].some(n => n.nodeType === 1 && /^(P|H[1-6]|UL|OL|TABLE|HR|DIV|PRE)$/.test(n.nodeName));
    const blocks = [...frag.childNodes];
    if (!blockish) {
      const last = frag.lastChild;
      r.insertNode(frag);
      if (last) { const s = getSelection(); const after = document.createRange(); after.setStartAfter(last); after.collapse(true); s.removeAllRanges(); s.addRange(after); }
    } else {
      // a single paragraph pastes inline
      if (blocks.length === 1 && /^(P|H[1-6])$/.test(blocks[0].nodeName) && !opts.asBlock) { const inner = blocks[0]; const last = inner.lastChild; const f2 = document.createDocumentFragment(); while (inner.firstChild) f2.appendChild(inner.firstChild); if (f2.lastChild && f2.lastChild.nodeName === 'BR') f2.lastChild.remove(); const l2 = f2.lastChild; r.insertNode(f2); if (l2) { const a = document.createRange(); a.setStartAfter(l2); a.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(a); } }
      else {
        const B = blockOf(r.startContainer) || topOf(r.startContainer);
        const inLi = B && B.nodeName === 'LI';
        const host = inLi ? B.closest('ul,ol') : (B && B.parentNode && B.parentNode.nodeName === 'TD' ? B : topOf(B) || B);
        // split host at caret
        let tail = null;
        if (host && host !== S.ed) {
          const rr = document.createRange(); rr.setStart(r.startContainer, r.startOffset); rr.setEnd(host, host.childNodes.length);
          const ex = rr.extractContents();
          const clone = host.cloneNode(false); clone.appendChild(ex);
          if (clone.textContent.length || clone.querySelector('img,table,sup.fn')) { host.after(clone); tail = clone; }
          if (!host.textContent.length && !host.querySelector('img,table,sup.fn,br')) { /* keep empty */ }
        }
        const anchor = tail || (host && host !== S.ed ? host.nextSibling : null);
        const parent = host && host !== S.ed ? host.parentNode : S.ed;
        let lastIns = null;
        for (const n of blocks) { parent.insertBefore(n, anchor); lastIns = n; }
        // remove an emptied host paragraph
        if (host && host !== S.ed && /^(P|H[1-6])$/.test(host.nodeName) && !host.textContent.length && !host.querySelector('img,sup.fn')) host.remove();
        if (lastIns) { const target = tail || lastIns.nextSibling || lastIns; placeCaretIn(target, tail ? 'start' : 'end'); }
      }
    }
    if (S.track && opts.track !== false) Review.markInsertedNodes(blocks);
    normalize();
    Pager.run();
    if (label) App.commit(label);
    UI.refresh();
  }
  function placeCaretIn(el, where) {
    const s = getSelection(); const r = document.createRange();
    const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let t = null, n; while ((n = tw.nextNode())) { if (!n.parentNode.closest('.pg-gap,.toc,sup.fn')) { t = n; if (where === 'start') break; } }
    if (t) r.setStart(t, where === 'start' ? 0 : t.nodeValue.length); else { const b = el.matches && el.matches(BLOCK_SEL) ? el : el.querySelector ? el.querySelector(BLOCK_SEL) : null; r.setStart(b || el, 0); }
    r.collapse(true); s.removeAllRanges(); s.addRange(r);
  }
  function placeCaretEnd() { S.ed.focus(); placeCaretIn(S.ed.lastElementChild || S.ed, 'end'); }
  function insertText(t) {
    if (S.track) { Review.insertTracked(t); afterChange('Typing'); return; }
    document.execCommand('insertText', false, t);
  }
  function afterChange(label) { normalize(); Pager.run(); if (label === 'Typing') App.typing(); else if (label) App.commit(label); UI.refresh(); }
  function pageBreak() {
    const r = Sel.range(); const b = r && blockOf(r.startContainer); const t = b && topOf(b);
    if (r && r.collapsed && b && t === b) {
      const pb = () => Object.assign(document.createElement('div'), { className: 'pbreak', contentEditable: 'false' });
      if (atStart(r, b) && b.textContent.length) { Pager.removeGaps(); b.before(pb()); placeCaretIn(b, 'start'); afterChange('Page Break'); return; }
      const rr = document.createRange(); rr.setStart(r.startContainer, r.startOffset); rr.setEnd(b, b.childNodes.length);
      if (!rr.toString().length && !rr.cloneContents().querySelector('img,sup.fn')) { Pager.removeGaps(); const p = document.createElement('p'); p.innerHTML = '<br>'; b.after(pb(), p); placeCaretIn(p, 'start'); afterChange('Page Break'); return; }
    }
    insertHtml('<div class="pbreak" contenteditable="false"></div>', 'Page Break', { asBlock: true, track: false });
  }
  function hr() { insertHtml('<hr><p><br></p>', 'Horizontal Line', { asBlock: true, track: false }); }
  function toc() {
    if (S.ed.querySelector('div.toc')) { Aero.toast('The document already has a table of contents — it updates automatically'); return; }
    insertHtml('<div class="toc" contenteditable="false" data-toc="1"></div><p><br></p>', 'Table of Contents', { asBlock: true, track: false });
  }
  function table(rows, cols) {
    const cell = '<td><p><br></p></td>';
    const html = `<table><tbody><tr data-h="1">${cell.repeat(cols)}</tr>${(`<tr>${cell.repeat(cols)}</tr>`).repeat(Math.max(0, rows - 1))}</tbody></table><p><br></p>`;
    insertHtml(html, 'Insert Table', { asBlock: true, track: false });
    // caret into the first cell
    const prev = Sel.range() && topOf(Sel.range().startContainer);
    const t = prev && prev.previousElementSibling && prev.previousElementSibling.nodeName === 'TABLE' ? prev.previousElementSibling : [...S.ed.querySelectorAll('table')].pop();
    if (t) placeCaretIn(t.rows[0].cells[0], 'start');
  }
  async function image(file) {
    const mime = file.type && file.type.startsWith('image/') ? file.type : /\.png$/i.test(file.name) ? 'image/png' : /\.jpe?g$/i.test(file.name) ? 'image/jpeg' : /\.gif$/i.test(file.name) ? 'image/gif' : /\.webp$/i.test(file.name) ? 'image/webp' : /\.svg$/i.test(file.name) ? 'image/svg+xml' : /\.bmp$/i.test(file.name) ? 'image/bmp' : '';
    if (!mime) { Aero.alert('Insert Picture', `“${file.name}” is not a supported image (PNG, JPEG, GIF, WebP, SVG, BMP).`); return; }
    let id;
    try { id = await App.addAssetBytes(file.data, mime); } catch (e) { Aero.alert('Insert Picture', 'Could not read the image.'); return; }
    const a = S.assets[id];
    const cw = S.doc.page.w - S.doc.page.ml - S.doc.page.mr;
    const w = Math.min(cw, (a.w || 300) * 0.75), h = w * (a.h || 200) / (a.w || 300);
    const html = Model.blocksHtml([{ t: 'p', style: 'Normal', runs: [{ t: 'img', asset: id, w: Math.round(w), h: Math.round(h), wrap: 'inline', alt: file.name.replace(/\.[^.]+$/, '') }] }], { src: App.src });
    insertHtml(html.replace(/^<p>|<\/p>$/g, ''), 'Insert Picture');
  }
  function footnote() {
    const id = 'n' + Aero.uid();
    Aero.prompt('Insert Footnote', 'Footnote text', '').then(t => {
      if (t == null) return;
      S.doc.notes[id] = t;
      S.ed.focus();
      insertHtml(`<sup class="fn" contenteditable="false" data-fn="${id}">*</sup>`, 'Insert Footnote');
    });
  }
  function symbol(ch) { S.ed.focus(); insertText(ch); }

  /* ---------------- tables ---------------- */
  function cellCtx() {
    const r = Sel.range(); if (!r) return null;
    const td = (r.startContainer.nodeType === 1 ? r.startContainer : r.startContainer.parentNode).closest('td');
    if (!td || !S.ed.contains(td)) return null;
    const tr = td.parentNode, table = tr.closest('table');
    const rows = [...table.rows].filter(x => !x.classList.contains('pg-gap'));
    // grid map with spans
    const grid = []; rows.forEach((row, ri) => { grid[ri] = grid[ri] || []; let c = 0; for (const cell of row.cells) { while (grid[ri][c]) c++; for (let a = 0; a < cell.rowSpan; a++) for (let b = 0; b < cell.colSpan; b++) { grid[ri + a] = grid[ri + a] || []; grid[ri + a][c + b] = cell; } c += cell.colSpan; } });
    const ri = rows.indexOf(tr); const ci = grid[ri].indexOf(td);
    return { td, tr, table, rows, grid, ri, ci, ncol: Math.max(...grid.map(g => g.length)) };
  }
  const emptyCell = () => { const td = document.createElement('td'); td.innerHTML = '<p><br></p>'; return td; };
  function tableOp(op) {
    const c = cellCtx(); if (!c) { Aero.toast('Place the cursor in a table first'); return; }
    App.flushTyping(); Pager.removeGaps();
    const { table, rows, grid, ri, ci, ncol } = c;
    if (op === 'rowAbove' || op === 'rowBelow') {
      const at = op === 'rowAbove' ? ri : ri + (c.td.rowSpan - 1);
      const tr = document.createElement('tr');
      for (let k = 0; k < ncol;) { const cell = grid[at][k]; const spanning = op === 'rowBelow' ? (grid[at + 1] && grid[at + 1][k] === cell) : (grid[at - 1] && grid[at - 1][k] === cell); if (cell && spanning) { cell.rowSpan += 1; k += cell.colSpan; } else { tr.appendChild(emptyCell()); k++; } }
      if (op === 'rowAbove') rows[at].before(tr); else rows[at].after(tr);
    } else if (op === 'colLeft' || op === 'colRight') {
      const at = op === 'colLeft' ? ci : ci + c.td.colSpan - 1;
      const done = new Set();
      rows.forEach((row, r) => {
        const cell = grid[r][at]; if (!cell) { row.appendChild(emptyCell()); return; }
        if (done.has(cell)) return;
        const startCol = grid[r].indexOf(cell);
        const inside = op === 'colLeft' ? startCol < at : startCol + cell.colSpan - 1 > at;
        if (inside) { cell.colSpan += 1; done.add(cell); return; }
        if (grid[r - 1] && grid[r - 1][at] === cell) return;  // covered by rowspan
        const n = emptyCell(); if (cell.rowSpan > 1) n.rowSpan = cell.rowSpan;
        if (op === 'colLeft') cell.before(n); else cell.after(n);
        done.add(cell);
      });
      const w = table.getAttribute('data-w'); if (w) table.removeAttribute('data-w'), table.querySelector('colgroup')?.remove();
    } else if (op === 'delRow') {
      if (rows.length <= 1) return tableOp('delTable');
      const tr = rows[ri];
      for (let k = 0; k < ncol; k++) { const cell = grid[ri][k]; if (cell && cell.rowSpan > 1) { if (cell.parentNode === tr) { const n = emptyCell(); n.colSpan = cell.colSpan; n.rowSpan = cell.rowSpan - 1; n.innerHTML = cell.innerHTML; const nextRow = rows[ri + 1]; const ref = [...nextRow.cells].find(x => grid[ri + 1].indexOf(x) > k); nextRow.insertBefore(n, ref || null); } else cell.rowSpan -= 1; k += cell.colSpan - 1; } }
      tr.remove();
    } else if (op === 'delCol') {
      if (ncol <= 1) return tableOp('delTable');
      const done = new Set();
      rows.forEach((row, r) => { const cell = grid[r][ci]; if (!cell || done.has(cell)) return; done.add(cell); if (cell.colSpan > 1) cell.colSpan -= 1; else cell.remove(); });
      table.removeAttribute('data-w'); table.querySelector('colgroup')?.remove();
    } else if (op === 'delTable') {
      const p = document.createElement('p'); p.innerHTML = '<br>'; table.replaceWith(p); placeCaretIn(p, 'start');
    } else if (op === 'mergeRight') {
      const cell = c.td; const k = ci + cell.colSpan; const nb = grid[ri][k];
      if (!nb || nb.rowSpan !== cell.rowSpan || grid[ri].indexOf(nb) !== k || nb.parentNode !== cell.parentNode) { Aero.toast('Cannot merge: the cell to the right has a different height'); return; }
      for (const ch of [...nb.childNodes]) if (ch.textContent.trim() || ch.querySelector?.('img')) cell.appendChild(ch);
      cell.colSpan += nb.colSpan; nb.remove();
    } else if (op === 'mergeDown') {
      const cell = c.td; const rr = ri + cell.rowSpan; const nb = grid[rr] && grid[rr][ci];
      if (!nb || nb.colSpan !== cell.colSpan || grid[rr].indexOf(nb) !== ci) { Aero.toast('Cannot merge: the cell below has a different width'); return; }
      for (const ch of [...nb.childNodes]) if (ch.textContent.trim() || ch.querySelector?.('img')) cell.appendChild(ch);
      cell.rowSpan += nb.rowSpan; nb.remove();
    } else if (op === 'split') {
      const cell = c.td; if (cell.colSpan === 1 && cell.rowSpan === 1) { Aero.toast('The cell is not merged'); return; }
      const cs = cell.colSpan, rs = cell.rowSpan; cell.colSpan = 1; cell.rowSpan = 1;
      for (let b = 1; b < cs; b++) cell.after(emptyCell());
      for (let a = 1; a < rs; a++) { const row = rows[ri + a]; const ref = [...row.cells].find(x => grid[ri + a].indexOf(x) > ci); for (let b = 0; b < cs; b++) row.insertBefore(emptyCell(), ref || null); }
    } else if (op === 'header') {
      const first = rows[0]; if (first.dataset.h) delete first.dataset.h; else first.dataset.h = '1';
    }
    normalize(); Pager.run(); App.commit('Table: ' + op); UI.refresh();
  }
  function cellShade(color) { const c = cellCtx(); if (!c) return; Pager.removeGaps(); if (color) c.td.style.backgroundColor = color; else c.td.style.removeProperty('background-color'); if (!c.td.getAttribute('style')) c.td.removeAttribute('style'); Pager.run(); App.commit('Cell Shading'); }
  function tableWidths(pcts) { const c = cellCtx(); if (!c) return; Pager.removeGaps(); const t = c.table; t.querySelector('colgroup')?.remove(); if (pcts) { t.setAttribute('data-w', pcts.join(',')); const cg = document.createElement('colgroup'); cg.innerHTML = pcts.map(p => `<col style="width:${p}%">`).join(''); t.prepend(cg); } else t.removeAttribute('data-w'); Pager.run(); App.commit('Column Widths'); }
  function tabInTable(back) {
    const c = cellCtx(); if (!c) return false;
    const cells = [...c.table.querySelectorAll('td')].filter(td => td.closest('table') === c.table && !td.closest('tr.pg-gap'));
    let i = cells.indexOf(c.td) + (back ? -1 : 1);
    if (i >= cells.length) { tableOp('rowBelow'); const c2 = cellCtx(); const cs = [...c2.table.querySelectorAll('td')].filter(td => td.closest('table') === c2.table && !td.closest('tr.pg-gap')); i = cs.indexOf(c2.td) + 1; if (cs[i]) placeCaretIn(cs[i], 'start'); return true; }
    if (i < 0) return true;
    const target = cells[i]; const r = document.createRange(); r.selectNodeContents(target.querySelector(BLOCK_SEL) || target); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    return true;
  }

  /* ---------------- images ---------------- */
  function setImage(img, v) {
    Pager.removeGaps();
    if (v.w) { img.style.width = Math.round(v.w * 10) / 10 + 'pt'; img.style.height = Math.round(v.h * 10) / 10 + 'pt'; }
    if (v.wrap && v.wrap !== 'inline') img.dataset.wrap = v.wrap; else delete img.dataset.wrap;
    if (v.alt != null) img.alt = v.alt;
    img.setAttribute('data-f', '1');
    Pager.run(); App.commit('Picture'); UI.refresh();
  }

  /* ---------------- events ---------------- */
  function init(el) {
    S.ed = el;
    try { document.execCommand('defaultParagraphSeparator', false, 'p'); document.execCommand('styleWithCSS', false, false); } catch (e) { }
    el.addEventListener('beforeinput', e => {
      if (e.inputType === 'historyUndo') { e.preventDefault(); App.undo(); return; }
      if (e.inputType === 'historyRedo') { e.preventDefault(); App.redo(); return; }
      if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromDrop' && S.track) { /* handled by paste/drop */ }
      if (S.track && Review.beforeInput(e)) return;
      // never type inside a deleted span when not tracking
    });
    el.addEventListener('input', e => {
      normalize();
      // after Enter, the new paragraph takes the style's "next" style
      if (e.inputType === 'insertParagraph') nextStyle();
      if (/^insert(Text|CompositionText|ReplacementText)$|^delete(ContentBackward|ContentForward)$/.test(e.inputType)) Pager.typed(); else Pager.run();
      App.typing();
      UI.refresh();
    });
    el.addEventListener('keydown', e => {
      const k = e.key, ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && !e.altKey && k.toLowerCase() === 'z') { e.preventDefault(); App.undo(); return; }
      if (ctrl && (k.toLowerCase() === 'y' || (e.shiftKey && k.toLowerCase() === 'z'))) { e.preventDefault(); App.redo(); return; }
      if (ctrl && k === 'Enter') { e.preventDefault(); pageBreak(); return; }
      if (k === 'Tab' && !ctrl && !e.altKey) {
        e.preventDefault();
        if (tabInTable(e.shiftKey)) return;
        const r = Sel.range(); const b = r && blockOf(r.startContainer);
        if (b && b.nodeName === 'LI') { indent(e.shiftKey ? -1 : 1); return; }
        if (!e.shiftKey) insertHtml('<span class="tab">\t</span>', null), App.typing();
        return;
      }
      if (k === 'Backspace' || k === 'Delete' || k === 'Enter') {
        // gaps inside the current block would confuse the browser's editing: drop them first
        const r = Sel.range(); const t = r && topOf(r.startContainer);
        if (t && t.querySelector('.pg-gap')) { t.querySelectorAll('.pg-gap').forEach(g => { const p = g.parentNode; g.remove(); p.normalize(); }); }
        if (r && t && k !== 'Enter') { const t2 = topOf(r.endContainer); if (t2 && t2 !== t) t2.querySelectorAll('.pg-gap').forEach(g => { const p = g.parentNode; g.remove(); p.normalize(); }); }
        // delete a page break / TOC / rule as a whole when the caret is right after it
        if (k === 'Backspace' && r && r.collapsed && t) {
          const b = blockOf(r.startContainer);
          if (b && b === t && atStart(r, b)) { let prev = b.previousElementSibling; while (prev && prev.classList.contains('pg-gap')) prev = prev.previousElementSibling; if (prev && (prev.matches('div.pbreak,div.toc,hr'))) { e.preventDefault(); prev.remove(); afterChange('Delete'); return; } }
        }
      }
    });
    el.addEventListener('paste', e => { e.preventDefault(); paste(e.clipboardData); });
    el.addEventListener('copy', e => copy(e, false));
    el.addEventListener('cut', e => { copy(e, true); });
    el.addEventListener('drop', e => {
      if (!e.dataTransfer || [...e.dataTransfer.types].includes('Files')) return; // files: handled by the app drop handler
      e.stopPropagation();
      if (S.track) { e.preventDefault(); Aero.toast('Drag and drop is off while tracking changes — use Cut and Paste'); return; }
      setTimeout(() => afterChange('Move'), 0);
    });
    el.addEventListener('dragover', e => { if (e.dataTransfer && ![...e.dataTransfer.types].includes('Files')) e.stopPropagation(); });
  }
  function atStart(r, b) { const rr = document.createRange(); rr.setStart(b, 0); rr.setEnd(r.startContainer, r.startOffset); return !rr.toString().length && !rr.cloneContents().querySelector('img,sup.fn'); }
  function nextStyle() {
    const r = Sel.range(); const b = r && blockOf(r.startContainer); if (!b || b.nodeName === 'LI') return;
    const prev = b.previousElementSibling; if (!prev) return;
    const ps = S.doc.styles.para[Styles.idOf(prev)];
    if (ps && ps.next && b.textContent === '' && Styles.idOf(b) !== ps.next) {
      const nx = ps.next; const m = Model.HEADING.exec(nx);
      const tag = m ? 'h' + m[1] : 'p';
      const nb = document.createElement(tag); nb.innerHTML = '<br>';
      if (!m && nx !== 'Normal') nb.dataset.s = nx;
      b.replaceWith(nb); placeCaretIn(nb, 'start');
    } else if (b.textContent === '' && b.dataset.s && b.dataset.s === Styles.idOf(prev) && ps && ps.next) { }
  }
  function selectionHtml() {
    const r = Sel.range(); if (!r || r.collapsed) return null;
    const frag = r.cloneContents(); const div = document.createElement('div'); div.appendChild(frag);
    div.querySelectorAll('.pg-gap').forEach(g => g.remove());
    return div;
  }
  function copy(e, cut) {
    const div = selectionHtml(); if (!div) return;
    e.preventDefault();
    // export clean HTML (images as data URLs so other apps can paste them)
    const ast = Model.htmlToAst(div, { styles: S.doc.styles, hasAsset: id => !!S.assets[id] });
    const html = Model.blocksHtml(ast, { src: id => IO.dataUrl(id) });
    const text = IO.astText(ast);
    e.clipboardData.setData('text/html', html);
    e.clipboardData.setData('text/plain', text);
    e.clipboardData.setData('application/x-lumen-write', JSON.stringify({ blocks: ast, notes: S.doc.notes }));
    if (cut) {
      const r = Sel.range();
      if (S.track) { Review.markDeleted(r); afterChange('Cut'); }
      else { document.execCommand('delete'); }
    }
  }
  async function paste(dt, plain) {
    if (!dt) return;
    const files = [...dt.files || []].filter(f => f.type.startsWith('image/'));
    if (files.length) { for (const f of files) await image({ name: f.name || 'pasted.png', type: f.type, data: await f.arrayBuffer() }); return; }
    const own = !plain && dt.getData('application/x-lumen-write');
    if (own) {
      try { const o = JSON.parse(own); Object.assign(S.doc.notes, Object.fromEntries(Object.entries(o.notes || {}).filter(([k]) => !S.doc.notes[k]))); insertHtml(Model.blocksHtml(o.blocks, { src: App.src }), 'Paste'); return; } catch (e) { }
    }
    const html = !plain && dt.getData('text/html');
    if (html) {
      const blocks = await IO.htmlToBlocks(html);
      insertHtml(Model.blocksHtml(blocks, { src: App.src }), 'Paste');
      return;
    }
    const text = dt.getData('text/plain'); if (!text) return;
    const paras = text.replace(/\r\n?/g, '\n').split('\n');
    if (paras.length === 1) { insertText(paras[0]); App.commit('Paste'); return; }
    insertHtml(paras.map(t => `<p>${t ? Aero.esc(t).replace(/\t/g, '<span class="tab">\t</span>') : '<br>'}</p>`).join(''), 'Paste');
  }
  // current paragraph / selection formatting, for the command bar
  function formatInfo() {
    const r = Sel.range(); if (!r) return null;
    const n = r.startContainer.nodeType === 3 ? r.startContainer.parentNode : r.startContainer.childNodes[r.startOffset] && r.startContainer.childNodes[r.startOffset].nodeType === 1 ? r.startContainer.childNodes[r.startOffset] : r.startContainer;
    const el = n && n.nodeType === 1 ? n : n && n.parentNode;
    if (!el || !S.ed.contains(el)) return null;
    const b = blockOf(el);
    const cs = getComputedStyle(el);
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    const al = b ? getComputedStyle(b).textAlign : 'left';
    const cse = el.closest('[data-cs]');
    return { style: b ? Styles.idOf(b) : 'Normal', font: fam, size: Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2, b: stateOf('b'), i: stateOf('i'), u: stateOf('u'), s: stateOf('s'), sup: stateOf('sup'), sub: stateOf('sub'), align: al === 'start' ? 'left' : al === 'end' ? 'right' : al, list: b && b.nodeName === 'LI' ? b.parentNode.nodeName.toLowerCase() : null, cs: cse ? cse.dataset.cs : '', inTable: !!el.closest('td'), link: el.closest('a') ? el.closest('a').getAttribute('href') : null, img: null };
  }
  return { init, normalize, transform, toggle, setRunProp, charStyle, clearFormatting, link, paraStyle, align, toggleList, indent, paraProps, insertHtml, insertText, pageBreak, hr, toc, table, image, footnote, symbol, tableOp, cellShade, tableWidths, cellCtx, setImage, formatInfo, paste, placeCaretIn, topOf, blockOf, afterChange, stateOf, wordRange, MS, ME };
})();
