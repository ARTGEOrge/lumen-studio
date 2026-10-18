'use strict';
/* Lumen Slides — slide show: full-screen show, presenter view (current slide, next build, notes, timer) and an
   optional audience window (show.html) kept in sync over a BroadcastChannel. */
const Present = (() => {
  let player = null, mode = null, chan = null, sid = null, aud = null, keybuf = '', hideT = 0, clockT = 0, notesPx = 18;
  const timer = { t0: 0, acc: 0, paused: false };
  const elapsed = () => timer.acc + (timer.paused ? 0 : (performance.now() - timer.t0) / 1000);
  const fmt = s => { s = Math.floor(s); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  function start(index = 0, presenter = false) {
    Editor.endEdit(true);
    if (S.mode !== 'slide') UI.setMode('slide');
    if (!S.doc.slides.length) return;
    if (!S.doc.slides.some(s => !s.hidden) && !S.doc.slides[index]) { Aero.toast('All slides are hidden'); return; }
    stopPlayer();
    mode = presenter ? 'pres' : 'show';
    const box = presenter ? $('#pres') : $('#show');
    box.hidden = false;
    const canvas = presenter ? $('#pcur') : $('#showcv');
    player = new Player({ canvas, getDoc: () => S.doc, getAssets: () => S.assets, loop: S.opt.loop, onChange: onState, onEnd: end });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    if (!timer.t0 || !presenter) { timer.t0 = performance.now(); timer.acc = 0; timer.paused = false; }
    Fonts.ready.then(() => Render.imagesReady(S.assets)).then(() => { if (!player) return; player.start(index); });
    if (!presenter) { try { box.requestFullscreen && box.requestFullscreen().catch(() => { }); } catch (_) { } }
    if (presenter) { wirePresenter(); clockT = setInterval(tickClock, 500); tickClock(); }
    wireShow();
  }
  function stopPlayer() { if (player) player.stop(); player = null; }
  function end() {
    stopPlayer(); window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize);
    clearInterval(clockT); clearTimeout(hideT);
    const lastSlide = mode && S.doc ? S.cur : 0; void lastSlide;
    $('#show').hidden = true; $('#pres').hidden = true; mode = null;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => { });
    if (chan) { chan.postMessage({ t: 'end' }); chan.close(); chan = null; }
    timer.t0 = 0;
    requestRender(); UI.refresh(true);
  }
  function onResize() { if (player) { player.cacheA = player.cacheB = null; player.draw(); } if (mode === 'pres') drawNext(); }
  function cmd(c, arg) {
    if (!player) return;
    if (c === 'next') player.next(); else if (c === 'prev') player.prev();
    else if (c === 'goto') player.gotoSlide(arg, false);
    else if (c === 'first') player.gotoSlide(0, false); else if (c === 'last') player.gotoSlide(player.list().length - 1, false);
    else if (c === 'black') player.setBlank('#000'); else if (c === 'white') player.setBlank('#fff');
    if (chan) chan.postMessage({ t: 'cmd', c, arg });
  }
  function onState(st) {
    if (st.slide != null && !st.ended) S.cur = st.slide;
    const n = st.count, label = st.ended ? 'End' : `Slide ${st.si + 1} of ${n}`;
    $('#shownum').textContent = label;
    if (mode === 'pres') { $('#pnum').textContent = label + (st.steps ? ` · build ${st.step}/${st.steps}` : ''); drawNext(); const s = S.doc.slides[st.slide]; $('#pnotes').textContent = st.ended ? '' : (s && s.notes) || '(No notes for this slide)'; $('#pnotes').style.fontSize = notesPx + 'px'; }
    if (chan) chan.postMessage({ t: 'sync', si: st.si, step: st.step, blank: st.blank, ended: st.ended });
  }
  function drawNext() {
    if (!player) return;
    const cv = $('#pnext'), list = player.list(), steps = player.steps();
    let slide = null, step = 0;
    if (player.step < steps.length) { slide = player.slide(); step = player.step + 1; }
    else if (player.si + 1 < list.length) { slide = S.doc.slides[list[player.si + 1]]; step = 0; }
    Player.renderStatic(cv, S.doc, S.assets, slide, step);
    if (!slide) { const c = cv.getContext('2d'); c.fillStyle = '#9fb0c3'; c.font = `${14 * (window.devicePixelRatio || 1)}px "Segoe UI"`; c.textAlign = 'center'; c.fillText('End of slide show', cv.width / 2, cv.height / 2); c.textAlign = 'left'; }
  }
  function tickClock() { $('#ptimer').textContent = fmt(elapsed()); $('#pclock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  function onKey(e) {
    if (!player) return;
    const k = e.key;
    e.stopImmediatePropagation();
    if (/^[0-9]$/.test(k)) { keybuf += k; e.preventDefault(); return; }
    if (k === 'Enter' && keybuf) { cmd('goto', Math.max(0, +keybuf - 1)); keybuf = ''; e.preventDefault(); return; }
    keybuf = '';
    const map = { ArrowRight: 'next', ArrowDown: 'next', PageDown: 'next', ' ': 'next', Enter: 'next', n: 'next', N: 'next', ArrowLeft: 'prev', ArrowUp: 'prev', PageUp: 'prev', Backspace: 'prev', p: 'prev', P: 'prev', Home: 'first', End: 'last', b: 'black', B: 'black', '.': 'black', w: 'white', W: 'white', ',': 'white' };
    if (k === 'Escape') { e.preventDefault(); end(); return; }
    if (map[k]) { e.preventDefault(); cmd(map[k]); return; }
    if (k === 'F5' || k === 'F11') { e.preventDefault(); }
  }
  function wireShow() {
    const box = $('#show'), cv = $('#showcv');
    cv.onclick = () => cmd('next');
    cv.oncontextmenu = e => { e.preventDefault(); cmd('prev'); };
    cv.onwheel = e => { e.preventDefault(); const now = performance.now(); if (now - (cv._w || 0) < 250) return; cv._w = now; cmd(e.deltaY > 0 ? 'next' : 'prev'); };
    box.onmousemove = () => { box.classList.add('cursor'); clearTimeout(hideT); hideT = setTimeout(() => box.classList.remove('cursor'), 2000); };
    $('#showbar').onclick = e => { const c = e.target.dataset.c; if (!c) return; e.stopPropagation(); if (c === 'end') end(); else if (c === 'pres') { const st = player && { si: player.index(), step: player.step }; end(); start(st ? st.si : S.cur, true); } else cmd(c); };
  }
  function wirePresenter() {
    $('#p-next').onclick = () => cmd('next'); $('#p-prev').onclick = () => cmd('prev'); $('#p-black').onclick = () => cmd('black');
    $('#p-end').onclick = end;
    $('#pcur').onclick = () => cmd('next');
    $('#p-pause').onclick = () => { if (timer.paused) { timer.t0 = performance.now(); timer.paused = false; $('#p-pause').textContent = 'Pause'; } else { timer.acc = elapsed(); timer.paused = true; $('#p-pause').textContent = 'Resume'; } };
    $('#p-reset').onclick = () => { timer.t0 = performance.now(); timer.acc = 0; tickClock(); };
    $('#p-fplus').onclick = () => { notesPx = Math.min(48, notesPx + 2); $('#pnotes').style.fontSize = notesPx + 'px'; };
    $('#p-fminus').onclick = () => { notesPx = Math.max(10, notesPx - 2); $('#pnotes').style.fontSize = notesPx + 'px'; };
    $('#p-swap').onclick = () => { const si = player ? player.index() : S.cur; end(); start(si, false); };
    $('#p-aud').onclick = openAudience;
  }
  function openAudience() {
    if (!chan) {
      sid = Math.random().toString(36).slice(2, 10);
      chan = new BroadcastChannel('lumen-slides-show-' + sid);
      chan.onmessage = e => {
        const m = e.data || {};
        if (m.t === 'hello' && player) chan.postMessage({ t: 'doc', doc: S.doc, assets: S.assets, slide: player.index(), step: player.step, loop: S.opt.loop });
        else if (m.t === 'key') cmd(m.c, m.arg);
        else if (m.t === 'closed') { aud = null; }
      };
    }
    aud = window.open('show.html#' + sid, 'lumen-slides-audience-' + sid, 'popup=yes,width=1280,height=760');
    if (!aud) { Aero.toast('The audience window was blocked. Use “Full-screen show” instead.'); return; }
    Aero.toast('Audience window opened: drag it to the projector screen and press F for full screen');
  }
  const active = () => !!mode;
  return { start, end, active, cmd };
})();
