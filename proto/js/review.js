'use strict';
/* Lumen Proto — review comments inside the exported HTML prototype. Shows the designer's comment pins (saved in the
   file) and lets viewers add / reply / resolve comments; viewer changes are stored locally (localStorage) in their
   browser. Plain DOM; no editor dependencies. */
(function () {
  const LP = window.LP;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const when = ts => { if (!ts) return ''; const d = new Date(ts); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }); };
  const store = {
    get(k, def) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };
  const CSS = `
.lpr-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.lpr-layer.adding{pointer-events:auto;cursor:crosshair}
.lpr-pin{position:absolute;width:26px;height:26px;margin:-26px 0 0 0;border-radius:13px 13px 13px 2px;background:#7b3fe4;color:#fff;font:600 12px/26px "Inter","Segoe UI",sans-serif;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.35);pointer-events:auto;cursor:pointer;border:2px solid #fff;box-sizing:content-box}
.lpr-pin.local{background:#1f8bff}.lpr-pin.res{background:#8a93a0;opacity:.8}
.lpr-pop{position:absolute;width:260px;background:#fff;color:#1b1f26;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);font:13px/1.4 "Inter","Segoe UI",sans-serif;pointer-events:auto;padding:10px 12px;z-index:5}
.lpr-pop .c{border-bottom:1px solid #eef0f3;padding:4px 0 6px}.lpr-pop .c:last-of-type{border:0}
.lpr-pop b{font-weight:600}.lpr-pop .t{color:#8a93a0;font-size:11px;margin-left:6px}
.lpr-pop textarea,.lpr-pop input{width:100%;box-sizing:border-box;border:1px solid #d5dae1;border-radius:6px;padding:5px 7px;font:inherit;margin-top:6px;color:#1b1f26;background:#fff}
.lpr-pop textarea{height:56px;resize:vertical}
.lpr-pop .row{display:flex;gap:6px;justify-content:flex-end;margin-top:8px}
.lpr-pop button{background:#eef1f5;border:1px solid #d5dae1;border-radius:6px;padding:3px 9px;font:inherit;cursor:pointer;color:#1b1f26}
.lpr-pop button.pri{background:#7b3fe4;border-color:#6a32cf;color:#fff}
.lpr-pop .x{position:absolute;right:8px;top:4px;border:0;background:none;font-size:16px;color:#8a93a0;padding:0 4px}`;
  window.LPReview = {
    // player: LP.Player, doc: document data, host: element over the player canvas, button: toggle button (optional)
    attach(player, doc, host, button) {
      if (!document.getElementById('lpr-css')) { const st = document.createElement('style'); st.id = 'lpr-css'; st.textContent = CSS; document.head.appendChild(st); }
      const key = 'lproto-comments:' + (doc.uid || doc.name || 'doc');
      const local = store.get(key, { added: [], state: {}, replies: {} });
      const save = () => store.set(key, local);
      const layer = document.createElement('div'); layer.className = 'lpr-layer'; host.appendChild(layer);
      let visible = true, adding = false, open = null, showResolved = false;
      const all = () => {
        const fromDoc = (doc.comments || []).map(c => Object.assign({}, c, { local: false, replies: (c.replies || []).concat(local.replies[c.id] || []), resolved: local.state[c.id] != null ? local.state[c.id] : !!c.resolved }));
        const mine = local.added.map(c => Object.assign({}, c, { local: true, replies: (c.replies || []).concat(local.replies[c.id] || []), resolved: local.state[c.id] != null ? local.state[c.id] : !!c.resolved }));
        return fromDoc.concat(mine);
      };
      const toScreen = (c, B) => {
        const root = player.cur; if (!root || c.ab !== root.id) return null;
        const sx = player.scrollX[root.id] || 0, sy = player.scroll[root.id] || 0;
        const x = B.x + (c.x - sx) * B.s, y = B.y + (c.y - sy) * B.s;
        if (x < B.x - 4 || y < B.y - 4 || x > B.x + B.w + 4 || y > B.y + B.h + 4) return null;
        return { x, y };
      };
      const author = () => store.get('lproto-author', '') || '';
      function render() {
        layer.querySelectorAll('.lpr-pin').forEach(e => e.remove());
        if (!visible) { closePop(); return; }
        const B = player.layoutBox();
        all().forEach((c, i) => {
          if (c.resolved && !showResolved && (!open || open.id !== c.id)) return;
          const p = toScreen(c, B); if (!p) return;
          const pin = document.createElement('div'); pin.className = 'lpr-pin' + (c.local ? ' local' : '') + (c.resolved ? ' res' : '');
          pin.style.left = p.x + 'px'; pin.style.top = p.y + 'px'; pin.textContent = (c.author || '?').trim().charAt(0).toUpperCase() || (i + 1);
          pin.title = `${c.author}: ${c.text}`;
          pin.onclick = e => { e.stopPropagation(); openPop(c, p); };
          layer.appendChild(pin);
        });
      }
      function closePop() { layer.querySelector('.lpr-pop')?.remove(); open = null; }
      function popAt(p) { const d = document.createElement('div'); d.className = 'lpr-pop'; const r = host.getBoundingClientRect(); d.style.left = Math.max(8, Math.min(r.width - 270, p.x + 16)) + 'px'; d.style.top = Math.max(8, Math.min(r.height - 220, p.y - 20)) + 'px'; d.onpointerdown = e => e.stopPropagation(); d.onclick = e => e.stopPropagation(); d.onkeydown = e => e.stopPropagation(); layer.appendChild(d); return d; }
      function openPop(c, p) {
        closePop(); open = c; const d = popAt(p);
        d.innerHTML = `<button class="x" title="Close">×</button>` + [c].concat(c.replies || []).map(r => `<div class="c"><b>${esc(r.author)}</b><span class="t">${esc(when(r.ts))}</span><div>${esc(r.text)}</div></div>`).join('') +
          `<input class="nm" placeholder="Your name" value="${esc(author())}"><textarea placeholder="Reply…"></textarea><div class="row"><button class="res">${c.resolved ? 'Reopen' : 'Resolve'}</button>${c.local ? '<button class="del">Delete</button>' : ''}<button class="pri rep">Reply</button></div>`;
        d.querySelector('.x').onclick = () => { closePop(); render(); };
        d.querySelector('.res').onclick = () => { local.state[c.id] = !c.resolved; save(); closePop(); render(); };
        if (c.local) d.querySelector('.del').onclick = () => { local.added = local.added.filter(x => x.id !== c.id); save(); closePop(); render(); };
        d.querySelector('.rep').onclick = () => {
          const t = d.querySelector('textarea').value.trim(), nm = d.querySelector('.nm').value.trim() || 'Viewer'; if (!t) return;
          store.set('lproto-author', nm); (local.replies[c.id] = local.replies[c.id] || []).push({ author: nm, text: t, ts: Date.now() }); save();
          const again = all().find(x => x.id === c.id); openPop(again, p); render();
        };
      }
      function newAt(p, root, cx, cy) {
        closePop(); const d = popAt(p); open = { id: '_new' };
        d.innerHTML = `<button class="x" title="Close">×</button><b>New comment</b><input class="nm" placeholder="Your name" value="${esc(author())}"><textarea placeholder="Add a comment…"></textarea><div class="row"><button class="cc">Cancel</button><button class="pri ok">Post</button></div>`;
        const ta = d.querySelector('textarea'); setTimeout(() => ta.focus(), 0);
        d.querySelector('.x').onclick = d.querySelector('.cc').onclick = () => { closePop(); render(); };
        d.querySelector('.ok').onclick = () => {
          const t = ta.value.trim(), nm = d.querySelector('.nm').value.trim() || 'Viewer'; if (!t) { ta.focus(); return; }
          store.set('lproto-author', nm);
          local.added.push({ id: 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ab: root.id, x: Math.round(cx), y: Math.round(cy), author: nm, text: t, ts: Date.now(), resolved: false, replies: [] });
          const okSaved = save(); closePop(); setAdding(false); render();
          if (!okSaved) alert('Comments could not be stored in this browser (storage is blocked).');
        };
      }
      layer.addEventListener('pointerdown', e => {
        if (!adding) return; e.preventDefault(); e.stopPropagation();
        const r = player.canvas.getBoundingClientRect(), p = { x: e.clientX - r.left, y: e.clientY - r.top };
        const L = player.locate(p); if (!L || !L.root || L.root !== player.cur) return;
        newAt(p, L.root, L.x, L.y);
      });
      function setAdding(v) { adding = v; layer.classList.toggle('adding', v); if (button) button.classList.toggle('on', v); }
      const api = {
        toggleAdd() { visible = true; setAdding(!adding); render(); },
        setVisible(v) { visible = v; render(); },
        setShowResolved(v) { showResolved = v; render(); },
        count: () => all().filter(c => !c.resolved).length,
        list: all, render, local,
        // viewer's own additions (new comments, replies, resolved state) as a small JSON file for the designer
        exportData() { return JSON.stringify({ format: 'lproto-comments', version: 1, doc: doc.uid || null, name: doc.name || '', exported: Date.now(), added: local.added, replies: local.replies, state: local.state }, null, 1); },
        download() { const blob = new Blob([api.exportData()], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (String(doc.name || 'prototype').replace(/[\/:*?"<>|]+/g, '_')) + ' comments.json'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); },
        addAt(cx, cy, text, name) { const root = player.cur; local.added.push({ id: 'v' + Date.now().toString(36), ab: root.id, x: cx, y: cy, author: name || 'Viewer', text, ts: Date.now(), resolved: false, replies: [] }); save(); render(); }
      };
      const prev = player.opts.onPaint; player.opts.onPaint = (pl, B) => { prev?.(pl, B); render(); };
      if (button) button.onclick = () => api.toggleAdd();
      addEventListener('keydown', e => { if (e.key === 'Escape' && (adding || open)) { setAdding(false); closePop(); render(); } });
      render();
      return api;
    }
  };
})();
