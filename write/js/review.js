'use strict';
/* Lumen Write — review: tracked changes (insertions / deletions with author and time, accept / reject)
   and comments (anchored to text, shown as balloons in the margin and in the Review panel). */
const Review = (() => {
  const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const closest = (n, sel) => { const e = n && (n.nodeType === 1 ? n : n.parentNode); const c = e && e.closest ? e.closest(sel) : null; return c && S.ed.contains(c) ? c : null; };
  const mk = tag => { const e = document.createElement(tag); e.dataset.au = S.author; e.dataset.dt = now(); return e; };

  /* ---------------- tracked typing ---------------- */
  function beforeInput(e) {
    const t = e.inputType;
    if (t === 'insertText' || t === 'insertReplacementText' || t === 'insertCompositionText' && false) {
      e.preventDefault();
      const text = e.data != null ? e.data : (e.dataTransfer ? e.dataTransfer.getData('text/plain') : '');
      Pager.removeGaps();
      let r = Sel.range(); if (!r) return true;
      if (t === 'insertReplacementText' && e.getTargetRanges && e.getTargetRanges()[0]) { const tr = e.getTargetRanges()[0]; r = document.createRange(); r.setStart(tr.startContainer, tr.startOffset); r.setEnd(tr.endContainer, tr.endOffset); }
      if (!r.collapsed) { markDeleted(r); const s = getSelection(); const c = document.createRange(); c.setStart(r.endContainer, r.endOffset); c.collapse(true); s.removeAllRanges(); s.addRange(c); }
      insertTracked(text || '');
      Ed.afterChange('Typing');
      return true;
    }
    if (/^delete/.test(t) && t !== 'deleteByDrag') {
      e.preventDefault();
      Pager.removeGaps();
      const s = getSelection();
      const back = /Backward/.test(t);
      if (s.isCollapsed) {
        const gran = /Word/.test(t) ? 'word' : /Line/.test(t) ? 'lineboundary' : 'character';
        // step over text that is already deleted
        for (let guard = 0; guard < 400; guard++) {
          const before = s.isCollapsed ? null : s.toString();
          s.modify('extend', back ? 'backward' : 'forward', gran);
          const r = s.getRangeAt(0);
          if (r.collapsed) break;
          if (!allDeleted(r)) break;
          if (before === s.toString()) break;
        }
      }
      const r = Sel.range(); if (!r || r.collapsed) return true;
      const keep = back ? [r.startContainer, r.startOffset] : [r.endContainer, r.endOffset];
      const res = markDeleted(r);
      const c = document.createRange();
      try { if (back) { if (res.first) c.setStartBefore(res.first); else c.setStart(keep[0], keep[1]); } else { if (res.last) c.setStartAfter(res.last); else c.setStart(keep[0], keep[1]); } } catch (er) { c.setStart(S.ed, 0); }
      c.collapse(true); s.removeAllRanges(); s.addRange(c);
      Ed.afterChange('Typing');
      return true;
    }
    if (t === 'insertParagraph' || t === 'insertLineBreak') {
      const r = Sel.range();
      if (r && !r.collapsed) { e.preventDefault(); markDeleted(r); const s = getSelection(); const c = document.createRange(); c.setStart(r.endContainer, r.endOffset); s.removeAllRanges(); s.addRange(c); document.execCommand(t); }
      return false;
    }
    if (t === 'insertFromDrop' || t === 'deleteByDrag') { e.preventDefault(); return true; }
    return false;
  }
  function allDeleted(r) {
    const txt = r.toString(); if (!txt) return false;
    const nodes = textNodesIn(r);
    return nodes.length > 0 && nodes.every(n => closest(n, 'del'));
  }
  function textNodesIn(r) {
    const out = []; const root = r.commonAncestorContainer;
    if (root.nodeType === 3) return [root];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (n.nodeType === 1) { if (n.nodeName === 'IMG' || (n.nodeName === 'SUP' && n.classList.contains('fn')) || (n.nodeName === 'SPAN' && n.classList.contains('tab'))) { if (r.intersectsNode(n) && r.comparePoint(n, 0) >= 0 && r.comparePoint(n.parentNode, [...n.parentNode.childNodes].indexOf(n) + 1) <= 0) out.push(n); } continue; }
      if (!n.nodeValue.length || closest(n, '.pg-gap,sup.fn,span.tab')) continue;
      if (r.comparePoint(n, 0) >= 0 && r.comparePoint(n, n.nodeValue.length) <= 0) out.push(n);
    }
    return out;
  }
  function splitBounds(r) {
    if (r.endContainer.nodeType === 3 && r.endOffset > 0 && r.endOffset < r.endContainer.nodeValue.length) r.endContainer.splitText(r.endOffset);
    if (r.startContainer.nodeType === 3 && r.startOffset > 0 && r.startOffset < r.startContainer.nodeValue.length) { const rest = r.startContainer.splitText(r.startOffset); r.setStart(rest, 0); }
    else if (r.startContainer.nodeType === 3 && r.startOffset === r.startContainer.nodeValue.length && r.startContainer.nextSibling) r.setStartAfter(r.startContainer);
  }
  // mark the range as deleted: text inserted by tracking is really removed, other text is wrapped in <del>
  function markDeleted(range) {
    const r = range.cloneRange();
    splitBounds(r);
    const nodes = textNodesIn(r);
    let first = null, last = null;
    for (const n of nodes) {
      if (closest(n, 'del')) { first = first || closest(n, 'del'); last = closest(n, 'del'); continue; }
      const ins = closest(n, 'ins');
      if (ins) { const prev = n.previousSibling; n.remove(); if (!ins.textContent.length && !ins.querySelector('img,sup.fn')) { ins.remove(); } continue; }
      // merge with an adjacent <del> by the same author
      const prev = n.previousSibling;
      let d;
      if (prev && prev.nodeName === 'DEL' && prev.dataset.au === S.author) { d = prev; d.appendChild(n); }
      else { d = mk('del'); n.parentNode.insertBefore(d, n); d.appendChild(n); }
      const next = d.nextSibling; if (next && next.nodeName === 'DEL' && next.dataset.au === S.author) { while (next.firstChild) d.appendChild(next.firstChild); next.remove(); }
      first = first || d; last = d;
    }
    // tidy: empty inline wrappers
    S.ed.querySelectorAll('ins:empty,del:empty').forEach(x => x.remove());
    return { first: first && first.isConnected ? first : null, last: last && last.isConnected ? last : null };
  }
  function insertTracked(text) {
    const s = getSelection(); if (!s.rangeCount) return;
    let r = s.getRangeAt(0).cloneRange(); r.collapse(true);
    // never insert inside deleted text
    const dl = closest(r.startContainer, 'del'); if (dl) { r.setStartAfter(dl); r.collapse(true); }
    const ins = closest(r.startContainer, 'ins');
    const place = (node, off) => { const c = document.createRange(); c.setStart(node, off); c.collapse(true); s.removeAllRanges(); s.addRange(c); };
    if (ins && ins.dataset.au === S.author && r.startContainer.nodeType === 3) { r.startContainer.insertData(r.startOffset, text); place(r.startContainer, r.startOffset + text.length); return; }
    // right after one of our insertions?
    let prev = null;
    if (r.startContainer.nodeType === 3 && r.startOffset === 0) prev = r.startContainer.previousSibling;
    else if (r.startContainer.nodeType === 1) prev = r.startContainer.childNodes[r.startOffset - 1];
    else if (r.startContainer.nodeType === 3 && r.startOffset === r.startContainer.nodeValue.length) prev = null;
    if (prev && prev.nodeName === 'INS' && prev.dataset.au === S.author && prev.lastChild && prev.lastChild.nodeType === 3) { prev.lastChild.appendData(text); place(prev.lastChild, prev.lastChild.nodeValue.length); return; }
    if (ins && r.startContainer.nodeType === 3) { // someone else's insertion: split it
      const rest = r.startContainer.splitText(r.startOffset); const after = ins.cloneNode(false); let n = rest; while (n) { const nx = n.nextSibling; after.appendChild(n); n = nx; } ins.after(after); r.setStartAfter(ins); r.collapse(true);
    }
    const el = mk('ins'); el.textContent = text;
    // empty paragraph: drop the placeholder <br>
    const blk = Ed.blockOf(r.startContainer);
    if (blk && blk.childNodes.length === 1 && blk.firstChild.nodeName === 'BR') blk.firstChild.remove(), r.setStart(blk, 0);
    r.insertNode(el);
    place(el.firstChild, text.length);
  }
  // after an insertHtml while tracking: wrap new text in <ins>
  function markInsertedNodes(nodes) {
    for (const top of nodes) {
      if (!top.isConnected) continue;
      const w = document.createTreeWalker(top, NodeFilter.SHOW_TEXT); const list = []; for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.length && !closest(n, 'ins,del,.toc')) list.push(n);
      if (top.nodeType === 3 && !closest(top, 'ins,del')) list.push(top);
      for (const n of list) { const el = mk('ins'); n.parentNode.insertBefore(el, n); el.appendChild(n); }
      if (top.nodeType === 1 && top.nodeName === 'IMG' && !closest(top, 'ins')) { const el = mk('ins'); top.parentNode.insertBefore(el, top); el.appendChild(top); }
    }
  }

  /* ---------------- accept / reject ---------------- */
  const all = () => [...S.ed.querySelectorAll('ins,del')].filter(e => !e.parentNode.closest('ins,del'));
  function unwrap(el) { el.replaceWith(...el.childNodes); }
  function acceptEl(el) { if (el.nodeName === 'INS') unwrap(el); else el.remove(); }
  function rejectEl(el) { if (el.nodeName === 'INS') el.remove(); else unwrap(el); }
  function atSelection() {
    const r = Sel.range(); if (!r) return [];
    const list = all();
    if (r.collapsed) { const c = closest(r.startContainer, 'ins,del'); if (c) return [c]; const n = r.startContainer.nodeType === 1 ? r.startContainer.childNodes[r.startOffset] : null; return n && /^(INS|DEL)$/.test(n.nodeName) ? [n] : []; }
    return list.filter(el => r.intersectsNode(el));
  }
  function act(accept, scope) {
    App.flushTyping(); Pager.removeGaps();
    const els = scope === 'all' ? all() : atSelection();
    if (!els.length) { Aero.toast(scope === 'all' ? 'There are no tracked changes' : 'No tracked change at the cursor'); Pager.run(); return; }
    const pos = Sel.save();
    for (const el of els) (accept ? acceptEl : rejectEl)(el);
    S.ed.normalize();
    Ed.normalize(); Pager.run();
    if (pos) Sel.restore({ a: Math.min(pos.a, pos.f), f: Math.min(pos.a, pos.f) });
    App.commit(`${accept ? 'Accept' : 'Reject'} ${scope === 'all' ? 'All Changes' : 'Change'}`);
    UI.refresh(true);
    if (scope !== 'all') next(1, true);
  }
  function next(dir, quiet) {
    const list = all(); if (!list.length) { if (!quiet) Aero.toast('There are no tracked changes'); return; }
    const r = Sel.range();
    let target = null;
    if (r) {
      if (dir > 0) target = list.find(el => r.comparePoint(el, 0) > 0 && !el.contains(r.startContainer)) || null;
      else target = [...list].reverse().find(el => r.comparePoint(el, 0) < 0 && !el.contains(r.startContainer)) || null;
    }
    if (!target) { if (quiet) return; target = dir > 0 ? list[0] : list[list.length - 1]; }
    select(target);
  }
  function select(el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); el.scrollIntoView({ block: 'center' }); UI.refresh(); }
  function changes() {
    return all().map(el => ({ el, kind: el.nodeName === 'INS' ? 'Inserted' : 'Deleted', author: el.dataset.au || 'Unknown', date: el.dataset.dt || '', text: el.textContent || (el.querySelector('img') ? '[picture]' : '') }));
  }

  /* ---------------- comments ---------------- */
  function addComment() {
    const r = Sel.range(); if (!r) { Aero.toast('Click in the text first'); return; }
    let rr = r; if (r.collapsed) { rr = Ed.wordRange(r); if (!rr) { Aero.toast('Select the text to comment on'); return; } const s = getSelection(); s.removeAllRanges(); s.addRange(rr); }
    const id = 'c' + Aero.uid();
    commentDialog('New Comment', '', text => {
      if (!text.trim()) return;
      S.doc.comments[id] = { author: S.author, date: now(), text };
      Ed.transform({ label: 'New Comment', fnRun: run => { run.cm = [...new Set([...(run.cm || []), id])]; } });
      UI.showTab('review');
    });
  }
  function commentDialog(title, value, ok) {
    Aero.dialog({ title, fields: [{ key: 't', label: 'Comment', type: 'textarea', value, rows: 5 }], ok: 'Save', onOK: v => ok(v.t || '') });
  }
  function editComment(id) {
    const c = S.doc.comments[id]; if (!c) return;
    commentDialog('Edit Comment', c.text, text => { c.text = text; c.date = c.date || now(); App.commit('Edit Comment'); renderBalloons(); UI.refresh(true); });
  }
  function deleteComment(id) {
    Pager.removeGaps();
    S.ed.querySelectorAll('span.cm').forEach(sp => {
      const ids = (sp.dataset.c || '').split(/\s+/).filter(x => x && x !== id);
      if (ids.length) sp.dataset.c = ids.join(' '); else sp.replaceWith(...sp.childNodes);
    });
    delete S.doc.comments[id];
    S.ed.normalize(); Pager.run(); App.commit('Delete Comment'); UI.refresh(true);
  }
  function commentAnchors() {
    const out = new Map();
    S.ed.querySelectorAll('span.cm').forEach(sp => { for (const id of (sp.dataset.c || '').split(/\s+/)) if (id && S.doc.comments[id] && !out.has(id)) out.set(id, sp); });
    return out;
  }
  function selectComment(id) {
    const spans = [...S.ed.querySelectorAll('span.cm')].filter(sp => (sp.dataset.c || '').split(/\s+/).includes(id));
    if (!spans.length) return;
    const r = document.createRange(); r.setStartBefore(spans[0]); r.setEndAfter(spans[spans.length - 1]);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    spans[0].scrollIntoView({ block: 'center' });
    S.ed.querySelectorAll('span.cm.hot').forEach(x => x.classList.remove('hot')); spans.forEach(x => x.classList.add('hot'));
    document.querySelectorAll('.balloon.hot').forEach(b => b.classList.remove('hot')); document.querySelector(`.balloon[data-id="${CSS.escape(id)}"]`)?.classList.add('hot');
  }
  const fmtDate = d => { if (!d) return ''; const t = new Date(d); return isNaN(t) ? d : t.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
  // margin balloons next to the pages
  function renderBalloons() {
    const host = document.getElementById('balloons'); if (!host) return;
    const anchors = commentAnchors();
    document.getElementById('pages').classList.toggle('with-balloons', anchors.size > 0 && S.markup !== 'final');
    if (!anchors.size || S.markup === 'final') { host.innerHTML = ''; return; }
    const pr = document.getElementById('pages').getBoundingClientRect();
    let html = '', y0 = -Infinity;
    const items = [...anchors].map(([id, sp]) => ({ id, y: (sp.getBoundingClientRect().top - pr.top) / S.zoom })).sort((a, b) => a.y - b.y);
    for (const it of items) {
      const c = S.doc.comments[it.id];
      const y = Math.max(it.y - 6, y0 + 8);
      const lines = Math.ceil((c.text || '').length / 30) + (c.text || '').split('\n').length;
      const h = 34 + Math.min(10, lines) * 15;
      html += `<div class="balloon" data-id="${Aero.esc(it.id)}" style="top:${y}px"><div class="bh"><b>${Aero.esc(c.author || 'Author')}</b><span>${Aero.esc(fmtDate(c.date))}</span></div><div class="bt">${Aero.esc(c.text || '')}</div><div class="bb"><button data-a="edit" title="Edit comment">Edit</button><button data-a="del" title="Delete comment">Delete</button></div></div>`;
      y0 = y + h;
    }
    host.innerHTML = html;
    // measure real heights and restack
    let prevB = -Infinity;
    [...host.children].forEach(b => { const top = Math.max(parseFloat(b.style.top), prevB + 8); b.style.top = top + 'px'; prevB = top + b.offsetHeight; });
  }
  function initBalloons() {
    const host = document.getElementById('balloons');
    host.addEventListener('mousedown', e => e.preventDefault());
    host.addEventListener('click', e => {
      const b = e.target.closest('.balloon'); if (!b) return;
      const id = b.dataset.id, a = e.target.dataset.a;
      if (a === 'edit') editComment(id); else if (a === 'del') deleteComment(id); else selectComment(id);
    });
  }
  return { beforeInput, markDeleted, insertTracked, markInsertedNodes, act, next, changes, select, addComment, editComment, deleteComment, selectComment, commentAnchors, renderBalloons, initBalloons, fmtDate, all };
})();
