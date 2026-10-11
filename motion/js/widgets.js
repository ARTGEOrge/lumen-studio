'use strict';
/* Lumen Motion — shared widgets: scrubbable values, property editors, icons, context menu. */
(function () {
  const LM = window.LM, el = Aero.el, esc = Aero.esc;
  const W = LM.w = {};

  /* ---------- icons ---------- */
  W.icon = {
    eye: '<svg viewBox="0 0 16 16"><path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z" fill="#fff" stroke="#24486e"/><circle cx="8" cy="8" r="2.4" fill="url(#gBlue)" stroke="#174a85" stroke-width=".7"/></svg>',
    solo: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6" fill="url(#gGold)" stroke="#8a5a0a"/><circle cx="8" cy="8" r="2" fill="#fff"/></svg>',
    lock: '<svg viewBox="0 0 16 16"><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="#5a6a7a" stroke-width="1.6"/><rect x="3.5" y="7" width="9" height="7" rx="1.2" fill="url(#gGold)" stroke="#8a5a0a"/></svg>',
    twirl: '<svg viewBox="0 0 10 10"><path d="M3 1.5 7.5 5 3 8.5z" fill="#4a5a6c"/></svg>',
    watch: '<svg viewBox="0 0 16 16"><circle cx="8" cy="9" r="5.5" fill="#fff" stroke="#5a6a7a" stroke-width="1.2"/><path d="M8 9V5.8M8 9l2.2 1.4M6.5 2.2h3M8 2.2v1.3" stroke="#5a6a7a" stroke-width="1.2" fill="none" stroke-linecap="round"/></svg>',
    watchOn: '<svg viewBox="0 0 16 16"><circle cx="8" cy="9" r="5.5" fill="url(#gBlue)" stroke="#174a85" stroke-width="1.2"/><path d="M8 9V5.8M8 9l2.2 1.4" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round"/><path d="M6.5 2.2h3M8 2.2v1.3" stroke="#174a85" stroke-width="1.2" stroke-linecap="round"/></svg>',
    pick: '<svg viewBox="0 0 16 16"><path d="M8 8m-5.5 0a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0 -11 0M8 8m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M8 8m-.8 0a.8.8 0 1 0 1.6 0a.8.8 0 1 0-1.6 0" fill="none" stroke="#3a5a7a" stroke-width="1.1"/></svg>',
    fx: '<svg viewBox="0 0 16 16"><text x="1.5" y="12" font-size="10.5" font-style="italic" font-weight="700" font-family="Georgia" fill="#6b3fb0">fx</text></svg>',
    mb: '<svg viewBox="0 0 16 16"><circle cx="10.5" cy="8" r="3.5" fill="url(#gBlue)" stroke="#174a85" stroke-width=".8"/><path d="M1.5 6h4M1 8h4.5M1.5 10h4" stroke="#6a8aa8" stroke-width="1.2" stroke-linecap="round"/></svg>',
    trash: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.3" fill="url(#gRed)" stroke="#8a1a10"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>',
    plus: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.3" fill="url(#gGreen)" stroke="#2a6a14"/><path d="M8 4.8v6.4M4.8 8h6.4" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>',
  };
  W.typeIcon = type => ({
    solid: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="1" fill="url(#gBlue)" stroke="#174a85"/></svg>',
    shape: '<svg viewBox="0 0 16 16"><path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" fill="url(#gGold)" stroke="#8a5a0a" stroke-linejoin="round"/></svg>',
    text: '<svg viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="#fff" stroke="#5a7a9a"/><path d="M4.5 4.5h7M8 4.5v7.5" stroke="#1c4f8a" stroke-width="1.8"/></svg>',
    image: '<svg viewBox="0 0 16 16"><rect x="1.5" y="2.5" width="13" height="11" rx="1" fill="#fff" stroke="#5a7a9a"/><path d="M2.5 12.5l3.5-4 2.5 2.5 2-2 3 3.5z" fill="url(#gGreen)"/><circle cx="11" cy="5.5" r="1.4" fill="url(#gGold)"/></svg>',
    video: '<svg viewBox="0 0 16 16"><rect x="1.5" y="3" width="13" height="10" rx="1" fill="#3a4a5a" stroke="#1a2a3a"/><path d="M6.5 5.5v5l4-2.5z" fill="#fff"/></svg>',
    null: '<svg viewBox="0 0 16 16"><rect x="2.5" y="2.5" width="11" height="11" fill="none" stroke="#c03030" stroke-width="1.4"/><path d="M5 8h6M8 5v6" stroke="#c03030"/></svg>',
    adjust: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.2" fill="#fff" stroke="#1c4f8a"/><path d="M8 1.8a6.2 6.2 0 0 1 0 12.4z" fill="url(#gBlue)"/></svg>',
    precomp: '<svg viewBox="0 0 16 16"><rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="url(#gPurple)" stroke="#4a2080"/><rect x="4.5" y="5.5" width="7" height="5" fill="#fff" opacity=".85"/></svg>',
    draw: '<svg viewBox="0 0 16 16"><path d="M2.5 13.5l1-3.5 7.5-7.5 2.5 2.5L6 12.5z" fill="url(#gGold)" stroke="#8a5a0a" stroke-linejoin="round"/><path d="M2.5 13.5l1-3.5 2.5 2.5z" fill="#333"/></svg>',
    comp: '<svg viewBox="0 0 16 16"><rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="url(#gPurple)" stroke="#4a2080"/><path d="M4 6h8M4 8.5h5" stroke="#fff" stroke-width="1.3"/></svg>',
  })[type] || '';

  /* ---------- formatting ---------- */
  const f1 = v => (Math.round(v * 10) / 10).toFixed(Math.abs(v) >= 1000 ? 0 : 1);
  W.fmt = (type, v) => {
    if (type === 'angle') { const r = v < 0 ? -Math.floor(-v / 360) : Math.floor(v / 360), d = v - r * 360; return Math.abs(v) >= 360 ? `${r}x${d >= 0 ? '+' : ''}${f1(d)}°` : f1(v) + '°'; }
    if (type === 'pct') return f1(v) + '%';
    return f1(v);
  };

  /* ---------- scrubbable number ---------- */
  // opts: {get, set(v, final), step, min, max, fmt}
  W.scrub = function (o) {
    const s = el('span', 'scrub'); s.tabIndex = -1;
    const show = () => { s.textContent = o.fmt ? o.fmt(o.get()) : f1(o.get()); };
    show(); s._update = show;
    s.onpointerdown = e => {
      if (e.button !== 0) return;
      e.preventDefault(); e.stopPropagation();
      const x0 = e.clientX, v0 = o.get(); let moved = false, last = v0;
      try { s.setPointerCapture(e.pointerId); } catch (_) { }
      const mv = ev => {
        const dx = ev.clientX - x0; if (!moved && Math.abs(dx) < 3) return; moved = true;
        let v = v0 + dx * (o.step || 1) * (ev.shiftKey ? 10 : 1) * (ev.ctrlKey ? .1 : 1);
        if (o.min != null) v = Math.max(o.min, v); if (o.max != null) v = Math.min(o.max, v);
        if (o.int) v = Math.round(v);
        last = v; o.set(v, false); show();
      };
      const up = () => {
        s.removeEventListener('pointermove', mv); s.removeEventListener('pointerup', up);
        if (moved) { o.set(last, true); show(); return; }
        // click: type a value
        const inp = el('input', 'scrubin'); inp.type = 'text'; inp.value = String(Math.round(o.get() * 1000) / 1000);
        s.replaceWith(inp); inp.focus(); inp.select();
        let done = false;
        const fin = ok => { if (done) return; done = true; if (ok) { let v = parseFloat(inp.value); if (isFinite(v)) { if (o.min != null) v = Math.max(o.min, v); if (o.max != null) v = Math.min(o.max, v); o.set(v, true); } } inp.replaceWith(s); show(); };
        inp.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') fin(true); if (ev.key === 'Escape') fin(false); };
        inp.onblur = () => fin(true);
      };
      s.addEventListener('pointermove', mv); s.addEventListener('pointerup', up);
    };
    return s;
  };

  /* ---------- property value editor ----------
     returns element with ._update() to refresh from the document */
  const unlinked = new Set();
  W.propEditor = function (node, L) {
    const p = node.p, box = el('span', 'pv');
    const t = () => LM.st.time;
    const commitLabel = 'Change ' + node.label;
    const apply = (v, final) => { LM.setVal(p, t(), v); if (final) LM.commit(commitLabel, !LM.animated(p) ? false : true); else LM.touch(); };
    const ups = [];
    const blocked = () => LM.hasExpr(p);
    if (node.type === 'num' || node.type === 'pct' || node.type === 'angle') {
      const s = W.scrub({ get: () => LM.val(p, t()), set: (v, f) => apply(v, f), step: node.step || (node.type === 'pct' ? .5 : node.max != null && node.max - (node.min || 0) <= 10 ? .01 : 1), min: node.min, max: node.max, int: node.step === 1, fmt: v => W.fmt(node.type, v) });
      box.appendChild(s); ups.push(s._update);
    } else if (node.type === 'vec2' || node.type === 'vec2pct') {
      const pct = node.type === 'vec2pct';
      if (pct) { const lk = el('span', 'link' + (unlinked.has(p) ? '' : ' on'), '⛓'); lk.title = 'Constrain proportions'; lk.onclick = e => { e.stopPropagation(); unlinked.has(p) ? unlinked.delete(p) : unlinked.add(p); lk.classList.toggle('on'); }; box.appendChild(lk); }
      [0, 1].forEach(i => {
        const s = W.scrub({
          get: () => LM.val(p, t())[i], step: node.step || (pct ? .5 : 1), min: node.min,
          set: (v, f) => { const cur = LM.val(p, t()).slice(); if (pct && !unlinked.has(p) && cur[i]) { const r = v / cur[i]; cur[0] *= r; cur[1] *= r; cur[i] = v; } else cur[i] = v; apply(cur, f); },
          fmt: v => pct ? f1(v) + '%' : f1(v)
        });
        if (i) box.appendChild(el('span', 'comma', ','));
        box.appendChild(s); ups.push(s._update);
      });
    } else if (node.type === 'color') {
      const sw = el('span', 'cswatch'), inp = el('input'); inp.type = 'color'; sw.appendChild(inp);
      const up = () => { const v = LM.val(p, t()); sw.style.background = v; if (document.activeElement !== inp) inp.value = v; };
      inp.oninput = () => { apply(inp.value, false); sw.style.background = inp.value; };
      inp.onchange = () => apply(inp.value, true);
      inp.onclick = e => e.stopPropagation();
      box.appendChild(sw); ups.push(up); up();
    } else if (node.type === 'path') {
      box.appendChild(el('span', 'dim', p.k ? `${p.k.length} keyframes` : 'Edit on canvas'));
    } else if (node.type === 'drawing') {
      const sp = el('span', 'dim'); const up = () => { const v = LM.val(p, t()); sp.textContent = `${(p.k || []).length} cels · ${(v || []).length} strokes here`; }; up(); ups.push(up); box.appendChild(sp);
    }
    box._update = () => { ups.forEach(f => f()); box.classList.toggle('expr', blocked()); };
    box._update();
    return box;
  };
  W.settingEditor = function (node, L) {
    const S = node.setting, box = el('span', 'pv');
    if (S.options === 'bool') {
      const c = el('input'); c.type = 'checkbox'; c.checked = !!S.get();
      c.onchange = () => { S.set(c.checked); LM.commit(node.label); };
      c.onclick = e => e.stopPropagation();
      box.appendChild(c); box._update = () => c.checked = !!S.get();
    } else if (S.options === 'text') {
      const b = el('button', 'aero-btn small', 'Edit Text…'); b.onclick = e => { e.stopPropagation(); LM.editText(L); };
      box.appendChild(b); box._update = () => { };
    } else {
      const sel = el('select'); S.options.forEach(([v, t]) => sel.add(new Option(t, v))); sel.value = S.get();
      sel.onchange = () => { S.set(sel.value); LM.commit(node.label); };
      sel.onclick = e => e.stopPropagation(); sel.onpointerdown = e => e.stopPropagation();
      box.appendChild(sel); box._update = () => sel.value = S.get();
    }
    return box;
  };

  /* ---------- stopwatch + keyframe navigator ---------- */
  W.stopwatch = function (node) {
    const b = el('span', 'watch'); b.title = 'Time-Vary Stopwatch (animate this property)';
    const up = () => b.innerHTML = LM.animated(node.p) ? W.icon.watchOn : W.icon.watch;
    up(); b._update = up;
    b.onclick = e => { e.stopPropagation(); LM.toggleStopwatch(node.p, LM.st.time); LM.commit(LM.animated(node.p) ? 'Add Keyframe' : 'Remove Keyframes'); };
    return b;
  };
  W.kfNav = function (node, L) {
    const box = el('span', 'kfnav');
    const prev = el('span', 'kn', '◀'), mid = el('span', 'kn dia', '◆'), next = el('span', 'kn', '▶');
    const lt = () => LM.st.time - L.start;
    prev.title = 'Previous keyframe'; next.title = 'Next keyframe'; mid.title = 'Add or remove keyframe at current time';
    prev.onclick = e => { e.stopPropagation(); const k = (node.p.k || []).filter(k => k.t < lt() - 1e-6).pop(); if (k) LM.setTime(k.t + L.start); };
    next.onclick = e => { e.stopPropagation(); const k = (node.p.k || []).find(k => k.t > lt() + 1e-6); if (k) LM.setTime(k.t + L.start); };
    mid.onclick = e => {
      e.stopPropagation(); const p = node.p, t = LM.snap(lt());
      if (!LM.animated(p)) { LM.toggleStopwatch(p, LM.st.time); LM.commit('Add Keyframe'); return; }
      const k = p.k.find(k => Math.abs(k.t - t) < 1e-6);
      if (k) { p.k = p.k.filter(x => x !== k); if (!p.k.length) { p.v = k.v; delete p.k; } LM.commit('Remove Keyframe'); }
      else { LM.addKey(p, t, LM.clone(LM.val(p, LM.st.time))); LM.commit('Add Keyframe'); }
    };
    box.append(prev, mid, next);
    box._update = () => {
      const p = node.p, on = LM.animated(p); box.classList.toggle('on', on);
      const t = lt(); mid.classList.toggle('here', on && p.k.some(k => Math.abs(k.t - t) < 1e-6));
      prev.classList.toggle('dis', !on || !p.k.some(k => k.t < t - 1e-6)); next.classList.toggle('dis', !on || !p.k.some(k => k.t > t + 1e-6));
    };
    box._update();
    return box;
  };

  /* ---------- context menu ---------- */
  let ctxEl = null;
  W.closeMenu = () => { ctxEl?.remove(); ctxEl = null; };
  W.menu = function (x, y, items) {
    W.closeMenu();
    const d = el('div', 'aero-dropdown ctxmenu'); d.style.display = 'block';
    items.forEach(it => {
      if (it === '-') return d.appendChild(el('div', 'aero-msep'));
      if (typeof it === 'string') return d.appendChild(el('div', 'aero-mhead', esc(it.replace(/^#/, ''))));
      const [label, fn, o = {}] = it;
      const mi = el('div', 'aero-mi' + (o.checked ? ' checked' : '') + (o.disabled ? ' disabled' : ''), `<span>${esc(label)}</span><span class="k">${esc(o.key || '')}</span>`);
      mi.onclick = e => { e.stopPropagation(); W.closeMenu(); fn(); };
      d.appendChild(mi);
    });
    document.body.appendChild(d);
    const r = d.getBoundingClientRect();
    d.style.left = Math.min(x, innerWidth - r.width - 4) + 'px'; d.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
    ctxEl = d;
    setTimeout(() => document.addEventListener('pointerdown', function h(e) { if (!d.contains(e.target)) { W.closeMenu(); document.removeEventListener('pointerdown', h, true); } }, true), 0);
  };
})();
