'use strict';
/* Lumen Beats — Playlist (arrangement): pattern clips on tracks, loop region, song position, automation lanes. */
(function () {
  const C = Core, $ = s => document.querySelector(s), esc = Aero.esc;
  const main = $('#pl-main'), picker = $('#picker');
  const HEADW = 150, RULH = 22, TRH = 30, AUH = 48;
  const S = { pxt: 0.12, scrollX: 0, scrollY: 0, marquee: null, fitted: false };
  main.innerHTML = `<div class="pl-grid"><div class="pl-corner" id="pl-corner"></div><canvas id="pl-ruler"></canvas><canvas id="pl-heads"></canvas><canvas id="pl-tl" tabindex="0"></canvas></div>`;
  const cvR = $('#pl-ruler'), cvH = $('#pl-heads'), cvT = $('#pl-tl');
  App.songPos = 0;

  const X = t => (t - S.scrollX) * S.pxt, T = x => x / S.pxt + S.scrollX;
  const rows = () => { const p = App.prj, r = []; let y = 0; for (const t of p.playlist.tracks) { r.push({ kind: 'track', obj: t, y, h: TRH }); y += TRH; } for (const a of p.automation) { r.push({ kind: 'auto', obj: a, y, h: AUH }); y += AUH; } return r; };
  const rowAt = y => rows().find(r => y + S.scrollY >= r.y && y + S.scrollY < r.y + r.h);
  const gridT = () => Math.max(App.snapTicks(), C.STEP);
  const snapT = t => { const g = gridT(); return Math.max(0, Math.floor(t / g) * g); };
  const roundT = t => { const g = gridT(); return Math.max(0, Math.round(t / g) * g); };

  function fit() { const w = cvT.clientWidth || 900, end = Math.max(C.songEnd(App.prj), C.barTicks(App.prj) * 8); S.pxt = Math.max(0.005, (w - 30) / (end + C.barTicks(App.prj) * 2)); S.scrollX = 0; draw(); }
  function render() {
    renderPicker();
    if (!S.fitted && cvT.clientWidth) { S.fitted = true; fit(); }
    const lp = App.prj.playlist.loop; $('#pl-loop').textContent = lp ? `Loop ${C.fmtPos(App.prj, lp.a).split(':')[0]}–${Math.ceil(lp.b / C.barTicks(App.prj)) + 1}` : 'Loop off';
    $('#pl-loop').classList.toggle('on', !!lp);
    $('#pl-info').textContent = `${App.prj.playlist.clips.length} clips · ${C.fmtPos(App.prj, C.songEnd(App.prj)).split(':')[0] - 1} bars`;
    draw();
  }
  function renderPicker() {
    picker.innerHTML = '';
    App.prj.patterns.forEach((p, i) => {
      const d = Aero.el('div', 'aero-item' + (p.id === App.sel.pat ? ' sel' : ''), `<span class="pat-dot" style="background:${p.color}"></span><span class="grow">${esc(p.name)}</span><span class="dim">${p.bars}</span>`);
      d.title = 'Click to select · drag onto the playlist · double-click to rename · right-click for more';
      d.onpointerdown = e => { if (e.button !== 0) return; App.selectPattern(p.id); dragPattern(e, p); };
      d.ondblclick = () => Aero.prompt('Rename pattern', 'Name', p.name).then(n => { if (n) { p.name = n.slice(0, 40); App.commit('Rename pattern'); } });
      d.oncontextmenu = e => { e.preventDefault(); App.ctxMenu(e.clientX, e.clientY, patternMenu(p, i)); };
      picker.appendChild(d);
    });
  }
  function patternMenu(p, i) {
    const prj = App.prj;
    return [{ label: 'Rename…', fn: () => Aero.prompt('Rename pattern', 'Name', p.name).then(n => { if (n) { p.name = n.slice(0, 40); App.commit('Rename pattern'); } }) },
      { label: 'Colour…', fn: () => App.views.rack.colorDialog(p) },
      { label: 'Clone', fn: () => App.clonePattern(p) },
      '-', { label: 'Delete pattern', disabled: prj.patterns.length < 2, fn: () => { prj.patterns.splice(i, 1); prj.playlist.clips = prj.playlist.clips.filter(c => c.pat !== p.id); App.fixSel(); App.commit('Delete pattern'); } }];
  }
  function dragPattern(e, p) {
    let ghost = null;
    App.drag(e, ev => {
      const r = cvT.getBoundingClientRect(); const inside = ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom;
      if (inside && !ghost) { ghost = Aero.el('div', 'drag-ghost', esc(p.name)); ghost.style.background = p.color; document.body.appendChild(ghost); }
      if (ghost) { ghost.style.left = ev.clientX + 8 + 'px'; ghost.style.top = ev.clientY + 6 + 'px'; }
    }, ev => {
      ghost?.remove(); const r = cvT.getBoundingClientRect();
      if (ev.clientX > r.left && ev.clientX < r.right && ev.clientY > r.top && ev.clientY < r.bottom) {
        const row = rowAt(ev.clientY - r.top); if (row?.kind !== 'track') return;
        addClip(p, row.obj, snapT(T(ev.clientX - r.left))); App.commit('Add clip', ['pl']);
      }
    });
  }
  function addClip(p, track, start) { const c = { id: C.uid(), pat: p.id, track: track.id, start, len: C.patLen(App.prj, p), off: 0 }; App.prj.playlist.clips.push(c); return c; }

  function draw() {
    if (!App.prj) return;
    const prj = App.prj, bar = C.barTicks(prj), beat = C.beatTicks(prj);
    const [g, w, h] = App.fitCanvas(cvT), rs = rows(), total = rs.length ? rs[rs.length - 1].y + rs[rs.length - 1].h : 0;
    S.scrollY = C.clamp(S.scrollY, 0, Math.max(0, total - h + 10));
    g.fillStyle = '#16212c'; g.fillRect(0, 0, w, h);
    const lp = prj.playlist.loop;
    for (const r of rs) {
      const y = r.y - S.scrollY; if (y > h || y + r.h < 0) continue;
      g.fillStyle = r.kind === 'auto' ? '#1b2a22' : (rs.indexOf(r) % 2 ? '#1c2935' : '#1f2d3a'); g.fillRect(0, y, w, r.h);
      g.fillStyle = '#121a22'; g.fillRect(0, y + r.h - 1, w, 1);
    }
    const step = beat * S.pxt > 10 ? beat : bar * S.pxt > 6 ? bar : bar * 4;
    for (let t = Math.floor(S.scrollX / step) * step; X(t) < w; t += step) { const x = Math.round(X(t)) + 0.5; g.fillStyle = t % bar === 0 ? 'rgba(160,190,220,.28)' : 'rgba(160,190,220,.09)'; g.fillRect(x - 0.5, 0, 1, Math.min(h, total - S.scrollY)); }
    if (lp) { g.fillStyle = 'rgba(255,211,74,.07)'; g.fillRect(X(lp.a), 0, (lp.b - lp.a) * S.pxt, h); }
    // clips
    const muted = new Set(prj.playlist.tracks.filter(t => t.mute).map(t => t.id));
    for (const c of prj.playlist.clips) {
      const r = rs.find(x => x.obj.id === c.track); if (!r) continue;
      const x = X(c.start), cw = c.len * S.pxt, y = r.y - S.scrollY + 1; if (x > w || x + cw < 0 || y > h || y + r.h < 0) continue;
      const pat = C.findPat(prj, c.pat); if (!pat) continue;
      const sel = App.sel.clips.has(c), m = muted.has(c.track);
      g.save(); g.globalAlpha = m ? 0.4 : 1;
      App.rrect(g, x + 0.5, y + 0.5, Math.max(3, cw - 1), r.h - 3, 3); g.fillStyle = App.shade(pat.color, -0.35); g.fill();
      g.save(); g.clip();
      g.fillStyle = App.shade(pat.color, 0.15); g.fillRect(x, y, cw, 12);
      g.fillStyle = '#fff'; g.font = '10px Segoe UI'; g.fillText(pat.name, x + 4, y + 9.5);
      drawClipNotes(g, prj, pat, c, x, y + 13, r.h - 17);
      g.restore();
      g.strokeStyle = sel ? '#fff' : App.shade(pat.color, -0.6); g.lineWidth = sel ? 1.6 : 1; App.rrect(g, x + 0.5, y + 0.5, Math.max(3, cw - 1), r.h - 3, 3); g.stroke();
      g.restore();
    }
    // automation lanes
    for (const r of rs) if (r.kind === 'auto') {
      const a = r.obj, y0 = r.y - S.scrollY, ih = r.h - 10; if (y0 > h || y0 + r.h < 0) continue;
      const vy = v => y0 + 5 + (1 - v) * ih, on = a.on !== false;
      g.strokeStyle = on ? '#7fe08a' : '#6a7a70'; g.lineWidth = 1.5; g.beginPath();
      if (a.points.length) { g.moveTo(0, vy(C.laneAt(a, T(0)))); for (const p of a.points) { const x = X(p.t); if (x > -50 && x < w + 50) g.lineTo(x, vy(p.v)); } g.lineTo(w, vy(C.laneAt(a, T(w)))); }
      g.stroke();
      g.fillStyle = on ? 'rgba(127,224,138,.10)' : 'rgba(120,130,125,.08)'; g.lineTo(w, y0 + r.h - 5); g.lineTo(0, y0 + r.h - 5); g.fill();
      for (const p of a.points) { const x = X(p.t); if (x < -6 || x > w + 6) continue; g.fillStyle = App.sel.point === p ? '#fff' : '#bff5c4'; g.fillRect(x - 3, vy(p.v) - 3, 6, 6); g.strokeStyle = '#1d4a24'; g.lineWidth = 1; g.strokeRect(x - 3.5, vy(p.v) - 3.5, 7, 7); }
      if (!a.points.length) { g.fillStyle = 'rgba(200,240,205,.5)'; g.font = '11px Segoe UI'; g.fillText('Click to add automation points', 10, y0 + r.h / 2 + 4); }
    }
    if (S.marquee) { const m = S.marquee; g.fillStyle = 'rgba(120,180,255,.15)'; g.strokeStyle = '#8cc4ff'; g.fillRect(m.x, m.y, m.w, m.h); g.strokeRect(m.x + 0.5, m.y + 0.5, m.w, m.h); }
    // playhead / song position
    const pos = Engine.mode === 'song' ? Engine.position() : null;
    const px = X(pos ?? App.songPos); g.fillStyle = pos != null ? '#ffd34a' : 'rgba(255,211,74,.55)'; g.fillRect(px, 0, 1.5, h);
    drawRuler(pos); drawHeads();
  }
  function drawClipNotes(g, prj, pat, c, x, y, h) {
    const L = C.patLen(prj, pat); let lo = 127, hi = 0, any = false;
    for (const k in pat.notes) for (const n of pat.notes[k]) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); any = true; }
    if (!any || h < 4) return; lo--; hi++;
    const rh = Math.max(1, h / (hi - lo + 1));
    g.fillStyle = 'rgba(255,255,255,.75)';
    const off = c.off || 0;
    for (let k = Math.floor(off / L); (k * L - off) < c.len; k++) for (const ch in pat.notes) for (const n of pat.notes[ch]) {
      const rel = k * L + n.t - off; if (rel < 0 || rel >= c.len || n.t >= L) continue;
      const nx = x + rel * S.pxt; g.fillRect(nx, y + h - (n.p - lo + 1) * rh, Math.max(1, Math.min(n.d, c.len - rel) * S.pxt - 0.5), Math.max(1, rh - 0.5));
    }
  }
  function drawRuler(pos) {
    const [g, w, h] = App.fitCanvas(cvR), prj = App.prj, bar = C.barTicks(prj);
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#f6f9fc'); grd.addColorStop(1, '#d8e3ef'); g.fillStyle = grd; g.fillRect(0, 0, w, h);
    const lp = prj.playlist.loop; if (lp) { g.fillStyle = 'rgba(240,170,30,.55)'; g.fillRect(X(lp.a), 0, (lp.b - lp.a) * S.pxt, 6); }
    const every = Math.max(1, Math.ceil(40 / (bar * S.pxt)));
    g.fillStyle = '#34506c'; g.font = '10px Segoe UI';
    for (let b = Math.floor(S.scrollX / bar); X(b * bar) < w; b++) { const x = Math.round(X(b * bar)) + 0.5; g.fillRect(x - 0.5, h - (b % every ? 4 : 9), 1, b % every ? 4 : 9); if (b % every === 0) g.fillText(String(b + 1), x + 3, h - 8); }
    g.fillStyle = '#7f95ab'; g.fillRect(0, h - 1, w, 1);
    const px = X(pos ?? App.songPos); g.fillStyle = '#e8a010'; g.beginPath(); g.moveTo(px - 5, 7); g.lineTo(px + 5, 7); g.lineTo(px, 14); g.fill();
  }
  function drawHeads() {
    const [g, w, h] = App.fitCanvas(cvH), prj = App.prj;
    g.fillStyle = '#eef3f8'; g.fillRect(0, 0, w, h);
    for (const r of rows()) {
      const y = r.y - S.scrollY; if (y > h || y + r.h < 0) continue;
      const grd = g.createLinearGradient(0, y, 0, y + r.h); grd.addColorStop(0, r.kind === 'auto' ? '#f2fbf3' : '#fbfdff'); grd.addColorStop(1, r.kind === 'auto' ? '#dcefdf' : '#e3ecf6'); g.fillStyle = grd; g.fillRect(0, y, w, r.h);
      g.fillStyle = '#b6c9e0'; g.fillRect(0, y + r.h - 1, w, 1);
      if (r.kind === 'track') {
        const t = r.obj; g.fillStyle = t.mute ? '#9aa8b5' : '#47c35a'; g.beginPath(); g.arc(13, y + r.h / 2, 5, 0, 7); g.fill(); g.strokeStyle = '#2b5a32'; g.stroke();
        g.fillStyle = t.mute ? '#8a96a2' : '#1e395b'; g.font = '12px Segoe UI'; g.fillText(t.name, 26, y + r.h / 2 + 4);
      } else {
        const a = r.obj, sp = C.targetSpec(prj, a.target);
        g.fillStyle = a.on !== false ? '#2a8f3a' : '#9aa8b5'; g.fillRect(7, y + 8, 9, 9); g.strokeStyle = '#1d4a24'; g.strokeRect(7.5, y + 8.5, 9, 9);
        g.fillStyle = '#1e3a24'; g.font = '11px Segoe UI'; wrap(g, sp ? sp.label : '(missing target)', 22, y + 16, w - 40, 12);
        g.fillStyle = '#a03020'; g.font = 'bold 12px Segoe UI'; g.fillText('×', w - 14, y + 16);
      }
    }
  }
  function wrap(g, s, x, y, mw, lh) { const words = s.split(' '); let line = ''; let n = 0; for (const wd of words) { const t = line ? line + ' ' + wd : wd; if (g.measureText(t).width > mw && line) { g.fillText(line, x, y + n * lh); line = wd; if (++n > 1) return; } else line = t; } g.fillText(line, x, y + n * lh); }

  /* ---------- interaction ---------- */
  const local = (e, cv) => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function clipHit(x, y) {
    const r = rowAt(y); if (!r || r.kind !== 'track') return null;
    const t = T(x), cs = App.prj.playlist.clips;
    for (let i = cs.length - 1; i >= 0; i--) { const c = cs[i]; if (c.track === r.obj.id && t >= c.start && t < c.start + c.len) return { c, edge: X(c.start + c.len) - x < Math.min(8, c.len * S.pxt / 3), row: r }; }
    return { row: r };
  }
  function pointHit(a, r, x, y) { const y0 = r.y - S.scrollY, ih = r.h - 10; return a.points.find(p => Math.abs(X(p.t) - x) <= 5 && Math.abs(y0 + 5 + (1 - p.v) * ih - y) <= 5); }
  cvT.addEventListener('contextmenu', e => e.preventDefault());
  cvT.addEventListener('pointerdown', e => {
    App.focus = 'pl'; cvT.focus();
    const [x, y] = local(e, cvT), r = rowAt(y), tool = App.tool, prj = App.prj;
    if (e.button === 1) { const sx = S.scrollX, sy = S.scrollY, x0 = e.clientX, y0 = e.clientY; return App.drag(e, ev => { S.scrollX = Math.max(0, sx - (ev.clientX - x0) / S.pxt); S.scrollY = sy - (ev.clientY - y0); draw(); }); }
    if (r?.kind === 'auto') return autoDown(e, r, x, y);
    const h = clipHit(x, y);
    if (e.button === 2 || tool === 'erase') {
      const del = ev => { const [a, b] = local(ev, cvT), k = clipHit(a, b); if (k?.c) { prj.playlist.clips.splice(prj.playlist.clips.indexOf(k.c), 1); App.sel.clips.delete(k.c); Engine.setProject(prj); draw(); } };
      del(e); return App.drag(e, del, () => App.commit('Delete clips', ['pl']));
    }
    if (tool === 'slice') {
      if (!h?.c) return; const c = h.c, t = roundT(T(x)); if (t <= c.start || t >= c.start + c.len) return;
      const b = { ...c, id: C.uid(), start: t, len: c.start + c.len - t, off: (c.off || 0) + (t - c.start) }; c.len = t - c.start; prj.playlist.clips.push(b); return App.commit('Slice clip', ['pl']);
    }
    if (h?.c) {
      const c = h.c;
      if (e.detail === 2) { App.selectPattern(c.pat); const pat = C.findPat(prj, c.pat); App.showView(Object.keys(pat.notes).some(k => App.prj.channels.find(ch => ch.id === k && ch.type !== 'drum')) ? 'roll' : 'rack'); return; }
      if (!App.sel.clips.has(c)) { if (!e.ctrlKey) App.sel.clips.clear(); App.sel.clips.add(c); } else if (e.ctrlKey) { App.sel.clips.delete(c); draw(); return; }
      App.selectPattern(c.pat, true);
      let group = [...App.sel.clips], an = c;
      if (e.shiftKey && !h.edge) { const idx = group.indexOf(c), copies = group.map(k => ({ ...k, id: C.uid() })); prj.playlist.clips.push(...copies); App.sel.clips = new Set(copies); group = copies; an = copies[idx]; }
      const orig = group.map(k => ({ k, start: k.start, len: k.len, ti: prj.playlist.tracks.findIndex(t => t.id === k.track) })), t0 = T(x), ti0 = prj.playlist.tracks.indexOf(h.row.obj);
      const a0 = orig.find(o => o.k === an) || orig[0];
      App.drag(e, ev => {
        const [a, b] = local(ev, cvT), dt = T(a) - t0;
        if (h.edge) { for (const o of orig) o.k.len = Math.max(gridT(), roundT(o.start + o.len + dt) - o.start); }
        else {
          const sh = roundT(a0.start + dt) - a0.start, rr = rowAt(b), dti = rr?.kind === 'track' ? prj.playlist.tracks.indexOf(rr.obj) - ti0 : 0;
          for (const o of orig) { o.k.start = Math.max(0, o.start + sh); const ni = C.clamp(o.ti + dti, 0, prj.playlist.tracks.length - 1); o.k.track = prj.playlist.tracks[ni].id; }
        }
        Engine.setProject(prj); draw();
      }, () => App.commit(h.edge ? 'Resize clips' : e.shiftKey ? 'Duplicate clips' : 'Move clips', ['pl']));
      return;
    }
    if (tool === 'select') {
      const x0 = x, y0 = y; if (!e.ctrlKey) App.sel.clips.clear(); const before = new Set(App.sel.clips);
      App.drag(e, ev => {
        const [a, b] = local(ev, cvT); S.marquee = { x: Math.min(a, x0), y: Math.min(b, y0), w: Math.abs(a - x0), h: Math.abs(b - y0) };
        const ta = T(S.marquee.x), tb = T(S.marquee.x + S.marquee.w), rs = rows().filter(q => q.kind === 'track' && q.y - S.scrollY < S.marquee.y + S.marquee.h && q.y - S.scrollY + q.h > S.marquee.y).map(q => q.obj.id);
        App.sel.clips = new Set([...before, ...prj.playlist.clips.filter(c => rs.includes(c.track) && c.start < tb && c.start + c.len > ta)]); draw();
      }, () => { S.marquee = null; draw(); });
      return;
    }
    if (!h?.row) return;
    // draw / paint: place the selected pattern
    const pat = App.pat, track = h.row.obj; const c = addClip(pat, track, snapT(T(x))); App.sel.clips = new Set([c]); Engine.setProject(prj); draw();
    if (tool === 'paint') {
      App.drag(e, ev => { const [a] = local(ev, cvT), t = T(a); const last = [...App.sel.clips].pop(); if (t >= last.start + last.len) { const n = addClip(pat, track, last.start + last.len); App.sel.clips.add(n); Engine.setProject(prj); draw(); } }, () => App.commit('Paint clips', ['pl']));
    } else {
      const s0 = c.start, t0 = T(x);
      App.drag(e, ev => { const [a, b] = local(ev, cvT); c.start = roundT(s0 + T(a) - t0); const rr = rowAt(b); if (rr?.kind === 'track') c.track = rr.obj.id; Engine.setProject(prj); draw(); }, () => App.commit('Add clip', ['pl']));
    }
  });
  function autoDown(e, r, x, y) {
    const a = r.obj, y0 = r.y - S.scrollY, ih = r.h - 10, vOf = yy => C.clamp(1 - (yy - y0 - 5) / ih, 0, 1);
    let p = pointHit(a, r, x, y);
    if (e.button === 2 || App.tool === 'erase') { if (p) { a.points.splice(a.points.indexOf(p), 1); App.commit('Delete automation point', ['pl']); } return; }
    if (!p) { p = { t: e.altKey ? Math.max(0, Math.round(T(x))) : roundT(T(x)), v: vOf(y) }; a.points.push(p); a.points.sort((m, n) => m.t - n.t); }
    App.sel.point = p; showVal(a, p); draw();
    App.drag(e, ev => { const [mx, my] = local(ev, cvT); p.t = ev.altKey ? Math.max(0, Math.round(T(mx))) : roundT(T(mx)); p.v = vOf(my); a.points.sort((m, n) => m.t - n.t); showVal(a, p); Engine.setProject(App.prj); draw(); },
      () => App.commit('Edit automation', ['pl']));
  }
  function showVal(a, p) { const sp = C.targetSpec(App.prj, a.target); if (sp) App.hover(`${sp.label}: ${(sp.spec.fmt || (v => v.toFixed(2)))(C.denorm(sp.spec, p.v))} at ${C.fmtPos(App.prj, p.t)}`); }
  cvT.addEventListener('pointermove', e => {
    if (e.buttons) return; const [x, y] = local(e, cvT), h = clipHit(x, y);
    cvT.style.cursor = h?.edge ? 'ew-resize' : h?.c ? 'move' : App.tool === 'erase' ? 'not-allowed' : App.tool === 'slice' ? 'col-resize' : 'default';
    App.hover(C.fmtPos(App.prj, T(x)) + (h?.c ? ' · ' + (C.findPat(App.prj, h.c.pat)?.name || '') : ''));
  });
  function wheel(e) {
    e.preventDefault();
    if (e.ctrlKey) { const r = cvT.getBoundingClientRect(), ax = e.clientX - r.left, t = T(ax); S.pxt = C.clamp(S.pxt * (e.deltaY < 0 ? 1.15 : 1 / 1.15), 0.004, 2); S.scrollX = Math.max(0, t - ax / S.pxt); }
    else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) S.scrollX = Math.max(0, S.scrollX + (e.deltaX || e.deltaY) / S.pxt * 0.8);
    else S.scrollY += e.deltaY * 0.5;
    draw();
  }
  [cvT, cvH, cvR].forEach(c => c.addEventListener('wheel', wheel, { passive: false }));
  // ruler: set song position (left), loop region (shift / right drag), double-click clears loop
  cvR.addEventListener('contextmenu', e => e.preventDefault());
  cvR.addEventListener('pointerdown', e => {
    const [x] = local(e, cvR), prj = App.prj, bt = C.beatTicks(prj);
    if (e.detail === 2) { prj.playlist.loop = null; App.commit('Clear loop', ['pl']); return; }
    if (e.shiftKey || e.button === 2) {
      const a = Math.round(T(x) / bt) * bt;
      App.drag(e, ev => { const [mx] = local(ev, cvR), b = Math.round(T(mx) / bt) * bt; prj.playlist.loop = b !== a ? { a: Math.min(a, b), b: Math.max(a, b) } : null; Engine.setProject(prj); render(); },
        () => App.commit(prj.playlist.loop ? 'Set loop' : 'Clear loop', ['pl']));
      return;
    }
    const set = ev => { const [mx] = local(ev, cvR); App.songPos = Math.max(0, Math.round(T(mx) / bt) * bt); App.updatePos(App.songPos); draw(); };
    set(e); App.drag(e, set, () => { if (Engine.playing && Engine.mode === 'song') Engine.play(App.songPos); });
  });
  cvH.addEventListener('contextmenu', e => e.preventDefault());
  cvH.addEventListener('pointerdown', e => {
    const [x, y] = local(e, cvH), r = rowAt(y), prj = App.prj; if (!r) return;
    if (r.kind === 'track') {
      const t = r.obj, i = prj.playlist.tracks.indexOf(t);
      if (e.button === 2) return App.ctxMenu(e.clientX, e.clientY, [{ label: 'Rename…', fn: () => Aero.prompt('Rename track', 'Name', t.name).then(n => { if (n) { t.name = n.slice(0, 40); App.commit('Rename track', ['pl']); } }) },
        { label: t.mute ? 'Unmute' : 'Mute', fn: () => { t.mute = !t.mute; App.commit('Mute track', ['pl']); } },
        { label: 'Insert track above', fn: () => { prj.playlist.tracks.splice(i, 0, { id: C.uid(), name: 'Track ' + (prj.playlist.tracks.length + 1), mute: false }); App.commit('Insert track', ['pl']); } },
        { label: 'Delete track', disabled: prj.playlist.tracks.length < 2, fn: () => { prj.playlist.tracks.splice(i, 1); prj.playlist.clips = prj.playlist.clips.filter(c => c.track !== t.id); App.fixSel(); App.commit('Delete track', ['pl']); } }]);
      if (x < 22) { t.mute = !t.mute; App.commit(t.mute ? 'Mute track' : 'Unmute track', ['pl']); }
      else if (e.detail === 2) Aero.prompt('Rename track', 'Name', t.name).then(n => { if (n) { t.name = n.slice(0, 40); App.commit('Rename track', ['pl']); } });
    } else {
      const a = r.obj, w = cvH.clientWidth;
      if (x > w - 20) { prj.automation.splice(prj.automation.indexOf(a), 1); App.commit('Delete automation lane', ['pl']); }
      else if (x < 20) { a.on = a.on === false; App.commit(a.on ? 'Enable automation' : 'Disable automation', ['pl']); }
    }
  });
  new ResizeObserver(() => draw()).observe(main);
  const cmd = {
    selectAll() { App.sel.clips = new Set(App.prj.playlist.clips); draw(); },
    del() { if (!App.sel.clips.size) return; App.prj.playlist.clips = App.prj.playlist.clips.filter(c => !App.sel.clips.has(c)); App.sel.clips.clear(); App.commit('Delete clips', ['pl']); },
    duplicate() { const s = [...App.sel.clips]; if (!s.length) return; const a = Math.min(...s.map(c => c.start)), b = Math.max(...s.map(c => c.start + c.len)); const copies = s.map(c => ({ ...c, id: C.uid(), start: c.start + (b - a) })); App.prj.playlist.clips.push(...copies); App.sel.clips = new Set(copies); App.commit('Duplicate clips', ['pl']); },
    zoom(k) { S.pxt = C.clamp(S.pxt * k, 0.004, 2); draw(); }, fit
  };
  App.views.pl = { render, draw, cmd, get state() { return S; } };
})();
