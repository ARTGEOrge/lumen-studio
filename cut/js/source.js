'use strict';
/* Lumen Cut — Source monitor: preview a bin item, mark In/Out on it (stored on the media item, so they also
   apply when dragging from the bin) and edit it into the sequence with Insert / Overwrite (3-point editing:
   source In/Out + sequence In or playhead; if the sequence has In and Out and the source has no Out,
   the sequence range sets the duration). */
(function () {
  const $ = Aero.$;
  const src = LC.src = { media: null, t: 0, raf: 0 };
  let v, img, wave;
  LC.focusMon = 'program';
  const fps = () => LC.fps();
  const media = () => src.media && LC.project.media.find(m => m.id === src.media) || null;

  src.init = () => {
    v = $('#svideo'); img = $('#simg'); wave = $('#swave');
    v.addEventListener('loadeddata', () => { v.currentTime = src.t; draw(); });
    v.addEventListener('seeked', draw); v.addEventListener('pause', () => { $('#splay').innerHTML = LC.ICON.play; $('#splay').classList.remove('on'); cancelAnimationFrame(src.raf); src.t = v.currentTime; draw(); });
    v.addEventListener('play', () => { $('#splay').innerHTML = LC.ICON.pause; $('#splay').classList.add('on'); const loop = () => { src.t = v.currentTime; draw(); src.raf = requestAnimationFrame(loop); }; loop(); });
    $('#srcmon').addEventListener('pointerdown', () => setFocus('source'), true);
    ['#monitor', '#tlpanel'].forEach(s => $(s).addEventListener('pointerdown', () => setFocus('program'), true));
    $('#splay').innerHTML = LC.ICON.play;
    $('#splay').onclick = () => src.toggle(); $('#sback').onclick = () => src.step(-1); $('#sfwd').onclick = () => src.step(1);
    $('#sin').onclick = () => src.markIn(); $('#sout').onclick = () => src.markOut(); $('#sclear').onclick = () => src.clearMarks();
    $('#sgoin').onclick = () => src.seek(media()?.srcIn ?? 0); $('#sgoout').onclick = () => { const m = media(); if (m) src.seek(m.srcOut ?? m.duration); };
    $('#sins').onclick = () => src.edit('insert'); $('#sovr').onclick = () => src.edit('overwrite');
    const bar = $('#sscrub');
    bar.addEventListener('pointerdown', e => {
      const m = media(); if (!m || m.kind === 'image') return; try { bar.setPointerCapture(e.pointerId); } catch (_) { }
      src.pause(); const go = ev => { const r = $('#sscrubbar').getBoundingClientRect(); src.seek(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * m.duration); };
      go(e); bar.onpointermove = ev => { if (ev.buttons) go(ev); };
    });
    // drag the marked range onto the timeline
    const sb = $('#sbox'); sb.draggable = true;
    sb.addEventListener('dragstart', e => { const m = media(); if (!m) { e.preventDefault(); return; } LC.drag = { kind: 'media', ids: [m.id] }; e.dataTransfer.setData('text/x-lcut', 'media'); e.dataTransfer.effectAllowed = 'copy'; });
    sb.addEventListener('dragend', () => { LC.drag = null; LC.tl.dropGhost = null; LC.tl.draw(); });
    new ResizeObserver(() => draw()).observe($('#sview'));
    draw();
  };
  function setFocus(f) { LC.focusMon = f; $('#srcmon').classList.toggle('focused', f === 'source'); $('#monitor').classList.toggle('focused', f === 'program'); }
  src.focus = setFocus;

  src.load = (id) => {
    const m = LC.project.media.find(x => x.id === id), rt = m && LC.rt.media.get(id);
    if (!m || !rt || rt.status !== 'ok') return Aero.toast('That media is offline');
    if (LC.layoutSource && !LC.layoutSource()) LC.toggleSource(true);
    src.pause(); src.media = id; src.t = m.srcIn ?? 0;
    if (m.kind === 'image') { v.removeAttribute('src'); v.load(); img.src = rt.url; }
    else { img.removeAttribute('src'); v.src = rt.url; v.muted = false; v.load(); }
    setFocus('source'); draw();
  };
  src.unloadIfGone = () => { if (src.media && !LC.project.media.some(m => m.id === src.media)) { src.pause(); src.media = null; v.removeAttribute('src'); v.load(); img.removeAttribute('src'); } draw(); };
  src.pause = () => { if (v && !v.paused) v.pause(); };
  src.toggle = () => { const m = media(); if (!m || m.kind === 'image') return; if (v.paused) { LC.stop(); if (v.currentTime >= m.duration - .05) v.currentTime = m.srcIn ?? 0; v.play().catch(() => { }); } else v.pause(); };
  src.seek = t => { const m = media(); if (!m) return; src.t = Math.max(0, Math.min(m.duration, LC.fr(t))); if (m.kind !== 'image' && v.readyState >= 1) v.currentTime = Math.min(src.t, Math.max(0, m.duration - .01)); draw(); };
  src.step = n => { src.pause(); src.seek(src.t + n / fps()); };
  src.markIn = () => { const m = media(); if (!m || m.kind === 'image') return; m.srcIn = LC.fr(src.t); if (m.srcOut != null && m.srcOut <= m.srcIn) m.srcOut = null; LC.commit('Mark source in'); draw(); };
  src.markOut = () => { const m = media(); if (!m || m.kind === 'image') return; m.srcOut = LC.fr(src.t); if (m.srcIn != null && m.srcIn >= m.srcOut) m.srcIn = null; LC.commit('Mark source out'); draw(); };
  src.clearMarks = () => { const m = media(); if (!m) return; m.srcIn = m.srcOut = null; LC.commit('Clear source in/out'); draw(); };
  src.edit = mode => {
    const m = media(); if (!m) return Aero.toast('Open a clip in the Source monitor first (double-click it in the Project panel)');
    return LC.threePointEdit(m.id, mode);
  };
  /* 3-point edit of one media item into the sequence */
  LC.threePointEdit = (id, mode) => {
    const m = LC.project.media.find(x => x.id === id); if (!m || LC.rt.media.get(id)?.status !== 'ok') return Aero.toast('That media is offline'), [];
    const P = LC.project, t = P.inPoint ?? LC.playhead, opts = {};
    if (P.inPoint != null && P.outPoint != null && P.outPoint > P.inPoint && (m.srcOut == null || m.kind === 'image')) opts.dur = LC.fr(P.outPoint - P.inPoint);
    LC.stop();
    const made = LC.placeMedia([id], t, null, mode, opts);
    if (made.length) LC.setPlayhead(Math.max(...made.map(c => c.start + c.dur)));
    return made;
  };

  function draw() {
    if (!v) return;
    const m = media(), has = !!m;
    $('#sempty').hidden = has; $('#sbox').hidden = !has;
    $('#srctitle').textContent = has ? 'Source: ' + m.name : 'Source: (no clip)';
    const tcEl = $('#stc'), durEl = $('#sdur');
    if (!m) { tcEl.textContent = LC.tc(0); durEl.textContent = LC.tc(0); $('#sscrubio').hidden = true; $('#sscrubhead').style.left = '0%'; $('#sscenes').innerHTML = ''; return; }
    const D = Math.max(1e-6, m.duration || 0), a = m.srcIn ?? 0, b = m.srcOut ?? m.duration;
    tcEl.textContent = LC.tc(src.t); durEl.textContent = m.kind === 'image' ? 'still' : LC.tc(Math.max(0, b - a));
    // fit media box
    const view = $('#sview'), sw = m.w || 16, sh = m.h || 9, isA = m.kind === 'audio';
    const bw = view.clientWidth - 16, bh = view.clientHeight - 16, s = isA ? 1 : Math.min(bw / sw, bh / sh);
    const box = $('#sbox'); box.style.width = (isA ? bw : Math.round(sw * s)) + 'px'; box.style.height = (isA ? Math.min(bh, 160) : Math.round(sh * s)) + 'px';
    v.style.display = m.kind === 'video' ? 'block' : 'none'; img.style.display = m.kind === 'image' ? 'block' : 'none'; wave.style.display = isA ? 'block' : 'none';
    if (isA) drawWave(m, a, b);
    const io = $('#sscrubio');
    if (m.kind !== 'image' && (m.srcIn != null || m.srcOut != null)) { io.hidden = false; io.style.left = a / D * 100 + '%'; io.style.width = Math.max(0, b - a) / D * 100 + '%'; } else io.hidden = true;
    $('#sscrubhead').style.left = Math.min(1, src.t / D) * 100 + '%';
    $('#sscenes').innerHTML = (m.scenes || []).map(t => `<i style="left:${t / D * 100}%"></i>`).join('');
  }
  src.draw = draw;
  function drawWave(m, a, b) {
    const rt = LC.rt.media.get(m.id), dpr = devicePixelRatio || 1, W = wave.clientWidth, H = wave.clientHeight; if (!W || !H) return;
    if (wave.width !== W * dpr) { wave.width = W * dpr; wave.height = H * dpr; }
    const x = wave.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#1f4a2a'); g.addColorStop(1, '#0f2a16'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    const pk = rt?.peaks; if (!pk) return; const D = m.duration;
    x.fillStyle = 'rgba(255,255,255,.08)'; x.fillRect(a / D * W, 0, (b - a) / D * W, H);
    x.fillStyle = '#8ef08a';
    for (let i = 0; i < W; i++) { const i0 = Math.floor(i / W * pk.length), i1 = Math.max(i0 + 1, Math.floor((i + 1) / W * pk.length)); let mm = 0; for (let j = i0; j < i1; j++) mm = Math.max(mm, pk[j]); const hh = Math.max(1, mm * H * .9); x.fillRect(i, (H - hh) / 2, 1, hh); }
    x.fillStyle = '#ff5a4a'; x.fillRect(src.t / D * W, 0, 1.5, H);
  }
})();
