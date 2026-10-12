'use strict';
/* Lumen Cut — Program monitor and playback engine.
   Preview frames come from pooled <video> elements kept in sync with the playhead; the master clock is the AudioContext
   so picture and WebAudio mix stay locked. Paused scrubbing seeks the elements and re-renders when they land. */
(function () {
  const $ = Aero.$;
  const mon = LC.mon = { zoom: 'fit', res: 1, safe: false, loop: false };
  LC.playhead = 0; LC.playing = null;

  /* ---------- <video> pool, one element per clip that is (about to be) on screen ---------- */
  const pool = new Map();   // clipId → {v, media, used, want}
  LC.vpool = {
    get(c, key = c.id) {           // key = nest path + clip id (the same nested clip can appear more than once)
      let e = pool.get(key); const rt = LC.rt.media.get(c.media);
      if (e && e.media !== c.media) { this.kill(key); e = null; }
      if (!e) {
        if (!rt || rt.status !== 'ok') return null;
        const v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = rt.url;
        e = { v, media: c.media, used: 0, want: null };
        v.addEventListener('seeked', () => { if (e.want != null && Math.abs(v.currentTime - e.want) > 1e-3 && !LC.playing) { const w = e.want; e.want = null; v.currentTime = w; } else e.want = null; LC.requestRender(); });
        v.addEventListener('loadeddata', () => LC.requestRender());
        pool.set(key, e);
      }
      e.used = performance.now(); return e;
    },
    kill(id) { const e = pool.get(id); if (!e) return; e.v.pause(); e.v.removeAttribute('src'); e.v.load(); pool.delete(id); },
    drop(mediaId) { for (const [id, e] of pool) if (e.media === mediaId) this.kill(id); },
    gc(keep) { const now = performance.now(); for (const [id, e] of pool) if (!keep.has(id)) { e.v.pause(); if (now - e.used > 8000 || !LC.clip(id)) this.kill(id); } },
    size: () => pool.size
  };
  function seekEl(e, t) {
    const v = e.v;
    if (v.seeking) { e.want = t; return; }
    if (Math.abs(v.currentTime - t) > 1e-3) v.currentTime = t;
  }

  /* source provider for the compositor (preview) */
  function getSrc(c, st) {
    const m = LC.mediaOf(c); if (!m) return null; const rt = LC.rt.media.get(m.id);
    if (!rt || rt.status === 'offline' || rt.status === 'error') return 'offline';
    if (c.type === 'image') return rt.img ? { src: rt.img, w: m.w, h: m.h, key: 'img:' + m.id, version: 1 } : null;
    const e = pool.get((LC._nestPath || '') + c.id); if (!e || e.v.readyState < 2) return null;
    return { src: e.v, w: e.v.videoWidth || m.w, h: e.v.videoHeight || m.h, key: 'v:' + c.id };
  }
  LC.previewSrc = getSrc;

  // which video clips must show a frame at t (including transition handles)
  function visibleVideoClips(t) {           // [{c, t (time in the clip's own sequence), key}] including nested sequences
    const out = [];
    LC.walkVideo(t, (c, tt, path) => { if (c.type === 'video') out.push({ c, t: tt, key: path + c.id }); });
    return out;
  }
  function clampSrc(c, t) { const m = LC.mediaOf(c); let s = LC.srcTime(c, t); return Math.min(Math.max(s, 0), Math.max(0, (m?.duration || 0) - .02)); }
  function syncVideos(t, playing, rate) {
    const keep = new Set();
    const vis = visibleVideoClips(t), T = t;
    for (const { c, t, key } of vis) {
      const e = LC.vpool.get(c, key); if (!e) continue; keep.add(key);
      const st = clampSrc(c, t), v = e.v;
      if (c.hold != null) { if (!v.paused) v.pause(); if (Math.abs(v.currentTime - st) > .25 / LC.fps()) seekEl(e, st + 1e-3); continue; }
      if (playing && rate > 0 && rate <= 8) {
        const pr = Math.min(16, Math.max(.0625, LC.speedAt(c, Math.min(c.dur, Math.max(0, t - c.start))) * rate));
        if (v.playbackRate !== pr) v.playbackRate = pr;
        const atEnd = LC.srcTime(c, t) >= (LC.mediaOf(c).duration - .03);
        if (atEnd) { if (!v.paused) v.pause(); continue; }
        if (v.paused) { seekEl(e, st); v.play().catch(() => { }); }
        else if (Math.abs(v.currentTime - st) > .2 * Math.max(1, rate)) seekEl(e, st);
      } else {
        if (!v.paused) v.pause();
        if (Math.abs(v.currentTime - st) > .25 / LC.fps()) seekEl(e, st + 1e-3);
      }
    }
    if (playing) {   // pre-roll clips that start within the next 1.5 s so they are ready on the cut
      const look = T + 1.5 * Math.max(1, Math.abs(rate)); t = T;
      for (const c of LC.project.clips) {
        if (c.type !== 'video' || keep.has(c.id) || c.disabled || LC.track(c.track).mute) continue;
        if (c.start > t && c.start < look) { const e = LC.vpool.get(c); if (!e) continue; keep.add(c.id); if (!e.v.paused) e.v.pause(); const st = clampSrc(c, c.start); if (Math.abs(e.v.currentTime - st) > .05) seekEl(e, st); }
      }
    }
    LC.vpool.gc(keep);
  }

  /* ---------- render ---------- */
  let comp = null, rq = false;
  mon.init = () => {
    const can = $('#mcanvas');
    try { comp = mon.comp = new LC.Compositor(can); } catch (e) { Aero.alert('WebGL2 unavailable', 'Lumen Cut needs WebGL2 for its compositor: ' + e.message); return; }
    new ResizeObserver(() => mon.layout()).observe($('#mview'));
    // direct manipulation of the selected clip in the monitor
    $('#mover').addEventListener('pointerdown', onMonDown);
    $('#mview').addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); const z = mon.zoomVal(); mon.setZoom(Math.max(.1, Math.min(4, z * (e.deltaY < 0 ? 1.25 : .8)))); }, { passive: false });
    const sc = $('#mscrub');
    sc.addEventListener('pointerdown', e => { try { sc.setPointerCapture(e.pointerId); } catch (_) { } LC.stop(); const go = ev => { const r = sc.getBoundingClientRect(); const d = Math.max(1, LC.seqDuration()); LC.setPlayhead(LC.fr(Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * d)); }; go(e); sc.onpointermove = ev => { if (ev.buttons) go(ev); }; });
  };
  mon.zoomVal = () => { const S = LC.project.settings, view = $('#mview'); if (mon.zoom === 'fit') return Math.min((view.clientWidth - 24) / S.w, (view.clientHeight - 24) / S.h); return mon.zoom; };
  mon.setZoom = z => { mon.zoom = z; const sel = $('#mzoom'); if (sel) sel.value = z === 'fit' ? 'fit' : String(z); mon.layout(); };
  mon.layout = () => {
    if (!comp || !LC.project) return;
    const S = LC.project.settings, z = mon.zoomVal(), view = $('#mview');
    const rw = Math.max(16, Math.round(S.w / mon.res / 2) * 2), rh = Math.max(16, Math.round(S.h / mon.res / 2) * 2);
    comp.resize(rw, rh);
    const cw = Math.round(S.w * z), ch = Math.round(S.h * z);
    const box = $('#mbox'); box.style.width = cw + 'px'; box.style.height = ch + 'px';
    box.style.margin = `${Math.max(12, (view.clientHeight - ch) / 2)}px ${Math.max(12, (view.clientWidth - cw) / 2)}px`;
    const ov = $('#mover'), dpr = devicePixelRatio || 1; ov.width = cw * dpr; ov.height = ch * dpr;
    $('#mzoomlbl') && ($('#mzoomlbl').textContent = Math.round(z * 100) + '%');
    LC.requestRender();
  };
  LC.requestRender = () => { if (rq) return; rq = true; requestAnimationFrame(() => { rq = false; renderNow(); }); };
  function renderNow() {
    if (!comp || !LC.project) return;
    if (!LC.playing) syncVideos(LC.playhead, false, 0);
    comp.render(LC.playhead, getSrc);
    drawOverlay(); updateTimecodes();
  }
  mon.renderNow = renderNow;
  LC.previewAt = t => { const keep = LC.playhead; LC.playhead = t; syncVideos(t, false, 0); comp.render(t, getSrc); LC.playhead = keep; drawOverlay(); };

  /* ---------- overlay: safe margins + selected clip bounds ---------- */
  function clipQuad(c, t) {
    const S = LC.project.settings, tl = Math.min(Math.max(t - c.start, 0), c.dur), m = LC.mediaOf(c);
    const sw = c.type === 'title' ? S.w : (m?.w || S.w), sh = c.type === 'title' ? S.h : (m?.h || S.h);
    const fit = c.type === 'title' ? 1 : Math.min(S.w / sw, S.h / sh), sc = LC.valueAt(c, 'scale', tl) / 100, pos = LC.valueAt(c, 'pos', tl), rot = LC.valueAt(c, 'rot', tl) * Math.PI / 180;
    const qw = sw * fit * sc, qh = sh * fit * sc, cx = pos[0] * S.w, cy = pos[1] * S.h, cs = Math.cos(rot), sn = Math.sin(rot);
    if (c.type === 'adjust') return [[0, 0], [S.w, 0], [S.w, S.h], [0, S.h]];
    let [l, tp, r, b] = LC.valueAt(c, 'crop', tl).map(v => v / 100);
    if (c.type === 'title') { const box = titleBox(c, tl); if (box) [l, tp, r, b] = box; }
    return [[l, tp], [1 - r, tp], [1 - r, 1 - b], [l, 1 - b]].map(([u, v]) => { const px = (u - .5) * qw, py = (v - .5) * qh; return [cx + px * cs - py * sn, cy + px * sn + py * cs]; });
  }
  let measureCtx = null;
  function titleBox(c, tl) {   // approximate text block in uv for the selection outline
    const T = c.title, S = LC.project.settings; measureCtx = measureCtx || document.createElement('canvas').getContext('2d');
    measureCtx.font = `${T.italic ? 'italic ' : ''}${T.bold ? 700 : 400} ${T.size}px "${T.font}"`;
    const lines = T.text.split('\n'), bw = Math.max(...lines.map(l => measureCtx.measureText(l).width)), bh = lines.length * T.size * 1.18;
    const pad = T.box ? T.boxPad : 6, x = T.x * S.w, left = T.align === 'left' ? x : T.align === 'right' ? x - bw : x - bw / 2, y = T.y * S.h;
    return [(left - pad) / S.w, (y - bh / 2 - pad) / S.h, 1 - (left + bw + pad) / S.w, 1 - (y + bh / 2 + pad) / S.h];
  }
  function drawOverlay() {
    const ov = $('#mover'); if (!ov) return; const x = ov.getContext('2d'), S = LC.project.settings;
    const dpr = devicePixelRatio || 1, k = ov.width / S.w; x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, ov.width, ov.height);
    x.setTransform(k, 0, 0, k, 0, 0);
    if (mon.safe) {
      x.strokeStyle = 'rgba(255,255,255,.75)'; x.lineWidth = 1.2 / k; x.setLineDash([]);
      [[.05, .05], [.1, .1]].forEach(([mx, my]) => x.strokeRect(S.w * mx, S.h * my, S.w * (1 - 2 * mx), S.h * (1 - 2 * my)));
      const cx = S.w / 2, cy = S.h / 2, l = Math.min(S.w, S.h) * .03; x.beginPath(); x.moveTo(cx - l, cy); x.lineTo(cx + l, cy); x.moveTo(cx, cy - l); x.lineTo(cx, cy + l); x.stroke();
      x.fillStyle = 'rgba(255,255,255,.75)'; x.font = `${11 / k}px Segoe UI`; x.fillText('Action safe', S.w * .05 + 4 / k, S.h * .05 + 13 / k); x.fillText('Title safe', S.w * .1 + 4 / k, S.h * .1 + 13 / k);
    }
    const c = LC.tl.primary();
    if (c && c.type !== 'audio' && LC.playhead >= c.start && LC.playhead < c.start + c.dur && !LC.playing) {
      const q = clipQuad(c, LC.playhead);
      x.strokeStyle = '#ffffff'; x.lineWidth = 2.5 / k; x.beginPath(); q.forEach((p, i) => i ? x.lineTo(...p) : x.moveTo(...p)); x.closePath(); x.stroke();
      x.strokeStyle = '#2a8fe8'; x.lineWidth = 1.2 / k; x.stroke();
      q.forEach(p => { x.fillStyle = '#fff'; x.strokeStyle = '#1d5fa8'; const s = 5 / k; x.fillRect(p[0] - s, p[1] - s, 2 * s, 2 * s); x.strokeRect(p[0] - s, p[1] - s, 2 * s, 2 * s); });
      const cp = LC.valueAt(c, 'pos', Math.min(Math.max(LC.playhead - c.start, 0), c.dur)); const cx = cp[0] * S.w, cy = cp[1] * S.h, r = 7 / k;
      x.beginPath(); x.arc(cx, cy, r, 0, 7); x.moveTo(cx - r * 1.6, cy); x.lineTo(cx + r * 1.6, cy); x.moveTo(cx, cy - r * 1.6); x.lineTo(cx, cy + r * 1.6); x.strokeStyle = '#fff'; x.lineWidth = 1.5 / k; x.stroke();
    }
  }
  /* eyedropper for the chroma key colour: samples the clip's own (un-keyed, un-graded) pixels */
  mon.pickKey = c => new Promise(res => {
    const ov = $('#mover'); LC.stop(); ov.style.cursor = 'crosshair'; LC.statusMsg('Click the background colour in the Program monitor (Esc cancels)');
    $('#mbox').classList.add('picking');
    const done = v => { ov.removeEventListener('pointerdown', down, true); document.removeEventListener('keydown', key, true); ov.style.cursor = ''; $('#mbox').classList.remove('picking'); res(v); };
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); done(null); } };
    const down = e => {
      e.stopPropagation(); e.preventDefault();
      const r = ov.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * comp.w, y = (e.clientY - r.top) / r.height * comp.h;
      done(mon.sampleRaw(c, x, y));
    };
    ov.addEventListener('pointerdown', down, true); document.addEventListener('keydown', key, true);
  });
  mon.sampleRaw = (c, x, y) => {          // x,y in compositor pixels
    comp.view.raw = c.id; let px;
    try { syncVideos(LC.playhead, false, 0); comp.render(LC.playhead, getSrc, { gc: false }); px = comp.readPixel(x, y); }
    finally { comp.view.raw = null; LC.requestRender(); }
    return '#' + px.map(v => v.toString(16).padStart(2, '0')).join('');
  };
  mon.setMatte = id => { comp.view.matte = id || null; LC.requestRender(); };
  mon.matteId = () => comp?.view.matte || null;
  function onMonDown(e) {
    const c = LC.tl.primary(); const ov = $('#mover'), S = LC.project.settings;
    if (!c || c.type === 'audio' || c.type === 'adjust' || LC.playhead < c.start || LC.playhead >= c.start + c.dur || LC.track(c.track).lock) return;
    LC.stop();
    const r = ov.getBoundingClientRect(), k = r.width / S.w, P0 = [(e.clientX - r.left) / k, (e.clientY - r.top) / k];
    const tl = LC.playhead - c.start, q = clipQuad(c, LC.playhead);
    const corner = q.findIndex(p => Math.hypot(p[0] - P0[0], p[1] - P0[1]) < 10 / k);
    const inside = pointInQuad(P0, q);
    if (corner < 0 && !inside) return;
    try { ov.setPointerCapture(e.pointerId); } catch (_) { }
    const pos0 = LC.valueAt(c, 'pos', tl), sc0 = LC.valueAt(c, 'scale', tl), cpx = [pos0[0] * S.w, pos0[1] * S.h], d0 = Math.hypot(P0[0] - cpx[0], P0[1] - cpx[1]);
    if (c.type === 'title' && corner < 0) {   // titles: drag moves the text anchor itself
      const t0 = [c.title.x, c.title.y];
      ov.onpointermove = ev => { if (!ev.buttons) return; const p = [(ev.clientX - r.left) / k, (ev.clientY - r.top) / k]; c.title.x = +(t0[0] + (p[0] - P0[0]) / S.w).toFixed(4); c.title.y = +(t0[1] + (p[1] - P0[1]) / S.h).toFixed(4); c.title.preset = 'custom'; LC.requestRender(); LC.props.render(); };
    } else ov.onpointermove = ev => {
      if (!ev.buttons) return; const p = [(ev.clientX - r.left) / k, (ev.clientY - r.top) / k];
      if (corner >= 0) { const d = Math.hypot(p[0] - cpx[0], p[1] - cpx[1]); LC.setParam(c, 'scale', Math.max(1, +(sc0 * d / Math.max(1, d0)).toFixed(1)), false); }
      else LC.setParam(c, 'pos', [+(pos0[0] + (p[0] - P0[0]) / S.w).toFixed(4), +(pos0[1] + (p[1] - P0[1]) / S.h).toFixed(4)], false);
    };
    ov.onpointerup = () => { ov.onpointermove = null; ov.onpointerup = null; LC.commit(corner >= 0 ? 'Scale' : 'Position'); LC.props.render(); };
  }
  function pointInQuad(p, q) { let s = 0; for (let i = 0; i < 4; i++) { const a = q[i], b = q[(i + 1) % 4]; const cr = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); if (cr !== 0) { if (s === 0) s = Math.sign(cr); else if (Math.sign(cr) !== s) return false; } } return true; }

  /* ---------- timecodes ---------- */
  function updateTimecodes() {
    const t = LC.playhead, d = LC.seqDuration();
    $('#mtc').textContent = LC.tc(t); $('#tltc').textContent = LC.tc(t);
    $('#mdur').textContent = LC.tc(d);
    const P = LC.project, sc = $('#mscrubbar'), w = Math.max(1, d);
    $('#mscrubhead').style.left = (Math.min(1, t / w) * 100) + '%';
    const io = $('#mscrubio');
    if (P.inPoint != null || P.outPoint != null) { io.hidden = false; const a = (P.inPoint ?? 0) / w, b = (P.outPoint ?? d) / w; io.style.left = a * 100 + '%'; io.style.width = Math.max(0, b - a) * 100 + '%'; } else io.hidden = true;
    LC.status?.();
  }

  /* ---------- transport ---------- */
  LC.setPlayhead = (t, keepPlaying) => {
    t = Math.max(0, t); LC.playhead = t;
    if (LC.playing && !keepPlaying) LC.stop();
    LC.tl.ensureVisible(t); LC.tl.draw(); LC.requestRender(); LC.props?.syncTime();
  };
  const clockNow = () => (LC.playing?.audio ? LC.audio.ctx.currentTime : performance.now() / 1000);
  LC.play = (rate = 1) => {
    if (LC.playing) LC.stop(true);
    LC.src?.pause?.(); LC.focusMon = 'program';
    const P = LC.project; let end = LC.seqDuration();
    const rangeIn = P.inPoint ?? 0, rangeOut = P.outPoint ?? end;
    if (rate > 0 && LC.playhead >= (mon.loop ? rangeOut : end) - 1e-3) LC.playhead = mon.loop ? rangeIn : 0;
    if (rate < 0 && LC.playhead <= 0) return;
    const pl = LC.playing = { rate, t0: LC.playhead, audio: false };
    if (rate > 0 && rate <= 4) {
      try { const ctx = LC.audio.ensure(); if (ctx.state !== 'running') ctx.resume(); if (ctx.state === 'running') { pl.c0 = LC.audio.startLive(LC.playhead, rate); pl.audio = true; } } catch (e) { }
    }
    if (!pl.audio) pl.c0 = performance.now() / 1000;
    $('#bplay')?.classList.add('on'); $('#bplay') && ($('#bplay').innerHTML = ICON.pause);
    tick();
  };
  LC.restartPlayback = () => { if (LC.playing) { const r = LC.playing.rate; LC.play(r); } };
  LC.stop = (internal) => {
    if (!LC.playing) return;
    LC.playing = null; LC.audio.stopLive();
    LC.playhead = LC.fr(LC.playhead);
    syncVideos(LC.playhead, false, 0);
    $('#bplay') && ($('#bplay').innerHTML = ICON.play); $('#bplay')?.classList.remove('on');
    if (!internal) { LC.tl.draw(); LC.requestRender(); LC.props?.syncTime(); }
  };
  LC.togglePlay = () => { if (LC.playing) LC.stop(); else LC.play(1); };
  LC.shuttle = dir => {
    const r = LC.playing?.rate || 0;
    if (dir === 0) return LC.stop();
    let nr = dir > 0 ? (r > 0 ? Math.min(8, r * 2) : 1) : (r < 0 ? Math.max(-8, r * 2) : -1);
    LC.play(nr); LC.statusMsg(`Shuttle ${nr > 0 ? '▶' : '◀'} ${Math.abs(nr)}×`);
  };
  function tick() {
    const pl = LC.playing; if (!pl) return;
    let now = pl.audio ? LC.audio.ctx.currentTime : performance.now() / 1000;
    if (pl.audio) {   // no audio device / stalled clock → fall back to the wall clock
      const wall = performance.now();
      if (now !== pl.lastCtx) { pl.lastCtx = now; pl.lastWall = wall; }
      else if (pl.lastWall && wall - pl.lastWall > 300) { pl.audio = false; pl.t0 = LC.playhead; pl.c0 = performance.now() / 1000; now = pl.c0; }
      else if (!pl.lastWall) pl.lastWall = wall;
    }
    let t = pl.t0 + Math.max(0, now - pl.c0) * pl.rate;
    const P = LC.project, end = LC.seqDuration(), rIn = P.inPoint ?? 0, rOut = P.outPoint ?? end;
    if (mon.loop && pl.rate > 0 && t >= rOut) { LC.playhead = rIn; LC.play(pl.rate); return; }
    if (pl.rate > 0 && t >= end) { LC.playhead = end; LC.stop(); return; }
    if (pl.rate < 0 && t <= 0) { LC.playhead = 0; LC.stop(); return; }
    LC.playhead = t;
    syncVideos(t, true, pl.rate);
    comp.render(t, getSrc); drawOverlay(); updateTimecodes();
    LC.tl.ensureVisible(t); LC.tl.drawNow();
    requestAnimationFrame(tick);
  }
  // meter animation runs all the time (cheap) so peaks decay after stopping
  function meterLoop() { LC.audio.drawMeter($('#meter')); LC.mixer?.tick(); requestAnimationFrame(meterLoop); }
  mon.startMeter = () => requestAnimationFrame(meterLoop);

  LC.step = n => { LC.stop(); LC.setPlayhead(LC.fr(LC.playhead + n / LC.fps())); };
  LC.editPoints = () => { const s = new Set([0]); LC.project.clips.forEach(c => { s.add(LC.fr(c.start)); s.add(LC.fr(c.start + c.dur)); }); return [...s].sort((a, b) => a - b); };
  LC.nextEdit = dir => { const t = LC.playhead, e = LC.editPoints(); const n = dir > 0 ? e.find(x => x > t + 1e-6) : e.reverse().find(x => x < t - 1e-6); if (n != null) LC.setPlayhead(n); };

  const ICON = LC.ICON = {
    play: '<svg viewBox="0 0 16 16"><path d="M4 2.5v11l9.5-5.5z" fill="url(#gB)" stroke="#123f70" stroke-linejoin="round"/></svg>',
    pause: '<svg viewBox="0 0 16 16"><rect x="3.5" y="2.5" width="3.4" height="11" rx=".6" fill="url(#gB)" stroke="#123f70"/><rect x="9.1" y="2.5" width="3.4" height="11" rx=".6" fill="url(#gB)" stroke="#123f70"/></svg>'
  };
})();
