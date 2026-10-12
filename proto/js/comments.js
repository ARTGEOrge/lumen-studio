'use strict';
/* Lumen Proto — review mode: comment pins on the canvas (author, text, replies, resolve), saved in the document. */
(function () {
  const LP = window.LP, ED = window.ED, P = window.PANELS, h = P.h;
  const CM = window.COMMENTS = {};
  ED.showComments = true; ED.showResolved = false;
  const list = () => (ED.doc.comments = ED.doc.comments || []);
  const store = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } } };
  CM.author = () => store.get('lproto.author', '') || 'Designer';
  const when = ts => { if (!ts) return ''; const d = new Date(ts); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };
  // world position of a comment (pins attached to an artboard move with it)
  CM.world = c => { const ab = c.ab && ED.get(c.ab); return ab ? { x: ab.x + c.x, y: ab.y + c.y } : { x: c.x, y: c.y }; };
  const shown = () => ED.showComments ? list().filter(c => (ED.showResolved || !c.resolved || (CM.open && CM.open.id === c.id)) && (!c.ab || ED.get(c.ab))) : [];
  const PIN = 13;
  CM.draw = ctx => {
    shown().forEach((c, i) => {
      const w = CM.world(c), p = ED.w2s(w.x, w.y), active = CM.open && CM.open.id === c.id;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 1;
      ctx.fillStyle = c.resolved ? '#8a93a0' : active ? '#5b22c9' : '#7b3fe4'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x, p.y - PIN); ctx.arc(p.x + PIN, p.y - PIN, PIN, Math.PI, Math.PI * 2.5); ctx.closePath(); ctx.fill(); ctx.shadowColor = 'transparent'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.font = '600 11px "Segoe UI",sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(list().indexOf(c) + 1), p.x + PIN, p.y - PIN + .5);
      ctx.restore();
    });
  };
  CM.pinAt = (sx, sy) => { const s = shown(); for (let i = s.length - 1; i >= 0; i--) { const w = CM.world(s[i]), p = ED.w2s(w.x, w.y); if (Math.hypot(sx - (p.x + PIN), sy - (p.y - PIN)) <= PIN + 2) return s[i]; } return null; };
  // pointer hook from the editor: pins are clickable in every mode; the Comment tool adds pins
  ED.commentDown = (e, sx, sy, w) => {
    const pin = CM.pinAt(sx, sy);
    if (pin) { CM.openThread(pin); return true; }
    if (ED.tool === 'comment' && e.button === 0) { CM.create(w); return true; }
    if (CM.open) CM.close();
    return false;
  };
  CM.create = (w, text, author) => {
    const ab = ED.doc.children.slice().reverse().find(n => ED.isArtboard(n) && n.visible !== false && w.x >= n.x && w.y >= n.y && w.x <= n.x + n.w && w.y <= n.y + n.h);
    const c = { id: LP.newId(), ab: ab ? ab.id : null, x: Math.round(ab ? w.x - ab.x : w.x), y: Math.round(ab ? w.y - ab.y : w.y), author: author || CM.author(), text: text || '', ts: Date.now(), resolved: false, replies: [] };
    if (text) { list().push(c); ED.commit('Add comment'); return c; }
    CM.openThread(c, true); return c;
  };
  CM.close = () => { document.querySelector('.lp-cpop')?.remove(); CM.open = null; ED.redraw(); };
  CM.openThread = (c, isNew) => {
    CM.close(); CM.open = c;
    const w = CM.world(c), p = ED.w2s(w.x, w.y), r = ED.stage.getBoundingClientRect();
    const pop = h('div', { class: 'lp-cpop aero-pane' });
    pop.style.left = Math.max(6, Math.min(r.width - 286, p.x + PIN * 2 + 8)) + 'px'; pop.style.top = Math.max(6, Math.min(r.height - 260, p.y - PIN * 2)) + 'px';
    ['pointerdown', 'keydown', 'wheel', 'dblclick'].forEach(t => pop.addEventListener(t, e => e.stopPropagation()));
    const head = h('div', { class: 'cphead' }, h('b', { text: isNew ? 'New comment' : `Comment #${list().indexOf(c) + 1}` }), h('span', { class: 'grow' }), h('button', { class: 'lbtn', title: 'Close (Esc)', html: P.ICON.x, onclick: CM.close }));
    pop.append(head);
    if (!isNew) [c].concat(c.replies || []).forEach(m => pop.append(h('div', { class: 'cmsg' }, h('div', {}, h('b', { text: m.author }), h('span', { class: 'dim small', text: '  ' + when(m.ts) })), h('div', { class: 'ctext', text: m.text }))));
    const nm = h('input', { type: 'text', class: 'cname', value: CM.author(), placeholder: 'Your name', title: 'Author name (remembered)' });
    const ta = h('textarea', { class: 'cinput', placeholder: isNew ? 'Add a comment…' : 'Reply…', rows: 3 });
    pop.append(nm, ta);
    const post = () => {
      const t = ta.value.trim(); if (!t) { ta.focus(); return; }
      const a = nm.value.trim() || 'Designer'; store.set('lproto.author', a);
      if (isNew) { c.text = t; c.author = a; c.ts = Date.now(); list().push(c); ED.commit('Add comment'); }
      else { const real = list().find(x => x.id === c.id); (real.replies = real.replies || []).push({ author: a, text: t, ts: Date.now() }); ED.commit('Reply to comment'); }
      const real = list().find(x => x.id === c.id); CM.openThread(real); CM.renderList();
    };
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); post(); } if (e.key === 'Escape') CM.close(); });
    const btns = h('div', { class: 'cpbtns' });
    if (!isNew) {
      btns.append(h('button', { class: 'aero-btn small', text: c.resolved ? 'Reopen' : '✓ Resolve', onclick: () => { const real = list().find(x => x.id === c.id); real.resolved = !real.resolved; ED.commit(real.resolved ? 'Resolve comment' : 'Reopen comment'); CM.close(); CM.renderList(); } }),
        h('button', { class: 'aero-btn small', text: 'Delete', onclick: () => { const L = list(); L.splice(L.findIndex(x => x.id === c.id), 1); ED.commit('Delete comment'); CM.close(); CM.renderList(); } }));
    }
    btns.append(h('span', { class: 'grow' }), h('button', { class: 'aero-btn small pri', text: isNew ? 'Post' : 'Reply', title: 'Ctrl+Enter', onclick: post }));
    pop.append(btns);
    ED.stage.append(pop); setTimeout(() => ta.focus(), 0); ED.redraw();
  };
  // left panel list
  let listEl = null;
  CM.initList = el => { listEl = el; ED.on('doc', () => { if (!listEl.hidden) CM.renderList(); if (CM.open && !list().some(x => x.id === CM.open.id) && document.querySelector('.lp-cpop .cmsg')) CM.close(); }); };
  CM.renderList = () => {
    if (!listEl) return;
    listEl.innerHTML = '';
    const bar = h('div', { class: 'asec' }, h('span', { class: 'grow', text: `Comments (${list().filter(c => !c.resolved).length} open)` }));
    const cb = h('input', { type: 'checkbox' }); cb.checked = ED.showResolved; cb.onchange = () => { ED.showResolved = cb.checked; CM.renderList(); ED.redraw(); };
    bar.append(h('label', { class: 'cb small', title: 'Show resolved comments' }, cb, 'resolved'));
    listEl.append(bar);
    const items = list().filter(c => ED.showResolved || !c.resolved);
    if (!items.length) listEl.append(h('div', { class: 'dim small', style: 'padding:12px', html: 'No comments. Pick the <b>Comment</b> tool (C) and click on the canvas to pin feedback. Comments are saved in the file and appear in the exported HTML prototype.' }));
    items.forEach(c => {
      const ab = c.ab && ED.get(c.ab);
      const row = h('div', { class: 'aero-item crow' + (c.resolved ? ' res' : '') }, h('span', { class: 'cnum', text: String(list().indexOf(c) + 1) }),
        h('div', { class: 'grow' }, h('div', {}, h('b', { text: c.author }), h('span', { class: 'dim small', text: (ab ? '  · ' + ab.name : '') + ((c.replies || []).length ? `  · ${c.replies.length} repl${c.replies.length > 1 ? 'ies' : 'y'}` : '') })), h('div', { class: 'ctext small', text: c.text })));
      row.onclick = () => { const w = CM.world(c); ED.zoomToBox({ x: w.x - 160, y: w.y - 120, w: 320, h: 240 }, Math.max(ED.view.z, .8)); CM.openThread(c); };
      listEl.append(row);
    });
  };
  ED.on('view', () => { const pop = document.querySelector('.lp-cpop'); if (!pop || !CM.open) return; const w = CM.world(CM.open), p = ED.w2s(w.x, w.y), r = ED.stage.getBoundingClientRect(); pop.style.left = Math.max(6, Math.min(r.width - 286, p.x + PIN * 2 + 8)) + 'px'; pop.style.top = Math.max(6, Math.min(r.height - 260, p.y - PIN * 2)) + 'px'; });
  CM.toggleVisible = () => { ED.showComments = !ED.showComments; if (!ED.showComments) CM.close(); ED.redraw(); };
})();
