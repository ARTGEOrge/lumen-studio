'use strict';
/* Lumen Beats — Piano Roll: draw / paint / select / erase / slice notes, velocity lane, ghost notes, scale highlighting. */
(function () {
  const C = Core, $ = s => document.querySelector(s), esc = Aero.esc;
  const root = $('#v-roll');
  const KEYW = 58, VELH = 74, BLACK = [1, 3, 6, 8, 10];
  const S = { pxt: 0.6, rowH: 13, scrollX: 0, scrollY: null, lastLen: 48, marquee: null, hover: null, fitted: null };
  let cvKeys, cvGrid, cvVel, tb;

  function build() {
    root.innerHTML = `<div class="pr-tb" id="pr-tb"></div>
      <div class="pr-body"><canvas class="pr-keys" id="pr-keys"></canvas><canvas class="pr-grid" id="pr-grid" tabindex="0"></canvas>
      <div class="pr-vlab">Velocity</div><canvas class="pr-vel" id="pr-vel"></canvas></div>`;
    cvKeys = $('#pr-keys'); cvGrid = $('#pr-grid'); cvVel = $('#pr-vel'); tb = $('#pr-tb');
    cvGrid.addEventListener('pointerdown', gridDown); cvGrid.addEventListener('pointermove', gridHover);
    cvGrid.addEventListener('wheel', wheel, { passive: false }); cvKeys.addEventListener('wheel', wheel, { passive: false }); cvVel.addEventListener('wheel', wheel, { passive: false });
    cvGrid.addEventListener('contextmenu', e => e.preventDefault()); cvVel.addEventListener('contextmenu', e => e.preventDefault());
    cvKeys.addEventListener('pointerdown', keyDown); cvVel.addEventListener('pointerdown', velDown);
    cvGrid.addEventListener('pointerleave', () => { S.hover = null; draw(); });
    new ResizeObserver(() => { if (!root.hidden) draw(); }).observe(root);
  }
  const notes = () => { const ch = App.ch; if (!ch) return []; const p = App.pat; return p.notes[ch.id] || (p.notes[ch.id] = []); };
  const patL = () => C.patLen(App.prj, App.pat);
  const X = t => KEYW * 0 + (t - S.scrollX) * S.pxt;
  const T = x => x / S.pxt + S.scrollX;
  const Y = p => (127 - p) * S.rowH - S.scrollY;
  const P = y => 127 - Math.floor((y + S.scrollY) / S.rowH);
  const snapT = t => { const g = App.snapTicks(); return Math.floor(t / g) * g; };
  const roundT = t => { const g = App.snapTicks(); return Math.round(t / g) * g; };
  const fixPitch = p => C.clamp(App.scaleSnap ? C.snapToScale(p, App.prj.key, App.prj.scale) : p, 0, 127);

  function toolbar() {
    const prj = App.prj, ch = App.ch;
    tb.innerHTML = `<label>Channel <select id="pr-ch">${prj.channels.map(c => `<option value="${c.id}" ${c.id === ch?.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <button class="aero-btn small" id="pr-q" title="Quantize (Ctrl+Q)">Quantize…</button>
      <button class="aero-btn small" id="pr-chord" title="Stack a chord on the selected notes (in the current scale)">Chordify</button>
      <label title="Draw and move notes only on scale degrees"><input type="checkbox" id="pr-ss" ${App.scaleSnap ? 'checked' : ''}> Snap to scale</label>
      <label title="Show the other channels' notes faintly"><input type="checkbox" id="pr-gh" ${App.ghosts ? 'checked' : ''}> Ghost notes</label>
      <span class="grow"></span>
      <button class="aero-btn small" id="pr-zo" title="Zoom out (Ctrl+wheel)">−</button><button class="aero-btn small" id="pr-zf" title="Fit pattern">Fit</button><button class="aero-btn small" id="pr-zi" title="Zoom in">+</button>`;
    tb.querySelector('#pr-ch').onchange = e => App.selectChannel(e.target.value);
    tb.querySelector('#pr-q').onclick = quantizeDialog;
    tb.querySelector('#pr-chord').onclick = chordify;
    tb.querySelector('#pr-ss').onchange = e => { App.scaleSnap = e.target.checked; };
    tb.querySelector('#pr-gh').onchange = e => { App.ghosts = e.target.checked; draw(); };
    tb.querySelector('#pr-zo').onclick = () => zoom(1 / 1.4); tb.querySelector('#pr-zi').onclick = () => zoom(1.4); tb.querySelector('#pr-zf').onclick = fit;
  }
  function fit() { const w = cvGrid.clientWidth || 800; S.pxt = Math.max(0.05, (w - 8) / patL()); S.scrollX = 0; draw(); }
  function zoom(k, atX) { const w = cvGrid.clientWidth || 800; atX ??= w / 2; const t = T(atX); S.pxt = C.clamp(S.pxt * k, 0.03, 8); S.scrollX = Math.max(0, t - atX / S.pxt); draw(); }
  function render() {
    if (!cvGrid) build();
    toolbar();
    const key = App.sel.pat + '|' + App.pat.bars;
    if (S.fitted !== key) { S.fitted = key; requestAnimationFrame(fit); }
    if (S.scrollY == null) { const h = cvGrid.clientHeight || 300; const ns = notes(); const mid = ns.length ? ns.reduce((a, n) => a + n.p, 0) / ns.length : 62; S.scrollY = Math.max(0, (127 - mid) * S.rowH - h / 2); }
    draw();
  }
  function draw() {
    if (!cvGrid || root.hidden || !App.prj) return;
    const prj = App.prj, pat = App.pat, ch = App.ch, L = patL();
    const [g, w, h] = App.fitCanvas(cvGrid);
    S.scrollY = C.clamp(S.scrollY ?? 0, 0, Math.max(0, 128 * S.rowH - h));
    // rows
    for (let p = 127; p >= 0; p--) {
      const y = Y(p); if (y > h || y + S.rowH < 0) continue;
      const pc = ((p % 12) + 12) % 12, inS = C.inScale(p, prj.key, prj.scale), root = (((p - prj.key) % 12) + 12) % 12 === 0;
      g.fillStyle = root && prj.scale !== 'chromatic' ? '#2f4b62' : inS && prj.scale !== 'chromatic' ? '#263848' : BLACK.includes(pc) ? '#1a2531' : '#212e3b';
      if (prj.scale === 'chromatic') g.fillStyle = BLACK.includes(pc) ? '#1b2632' : '#24323f';
      g.fillRect(0, y, w, S.rowH);
      g.fillStyle = pc === 0 ? '#3c5268' : '#18222c'; g.fillRect(0, y + S.rowH - 1, w, 1);
    }
    // vertical grid
    const bar = C.barTicks(prj), beat = C.beatTicks(prj), snap = App.snapTicks();
    const step = snap * S.pxt >= 6 ? snap : beat * S.pxt >= 6 ? beat : bar;
    for (let t = Math.floor(S.scrollX / step) * step; X(t) < w; t += step) {
      const x = Math.round(X(t)) + 0.5;
      g.fillStyle = t % bar === 0 ? 'rgba(170,200,230,.45)' : t % beat === 0 ? 'rgba(150,180,210,.2)' : 'rgba(150,180,210,.08)';
      g.fillRect(x - 0.5, 0, 1, h);
    }
    // outside pattern
    const xe = X(L); if (xe < w) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(Math.max(0, xe), 0, w - xe, h); }
    // ghost notes
    if (App.ghosts) for (const c of prj.channels) {
      if (c.id === ch?.id) continue; g.fillStyle = 'rgba(200,215,230,.13)';
      for (const n of pat.notes[c.id] || []) { const x = X(n.t), y = Y(n.p); if (x > w || x + n.d * S.pxt < 0) continue; g.fillRect(x, y + 1, Math.max(2, n.d * S.pxt - 1), S.rowH - 2); }
    }
    // notes
    const col = ch?.color || '#3a8fe0';
    for (const n of notes()) {
      const x = X(n.t), y = Y(n.p), nw = Math.max(3, n.d * S.pxt - 1); if (x > w || x + nw < 0 || y > h || y + S.rowH < 0) continue;
      const sel = App.sel.notes.has(n);
      App.rrect(g, x + 0.5, y + 0.5, nw, S.rowH - 1, 3);
      g.fillStyle = App.shade(col, -0.45 + 0.6 * (n.v / 127)); g.fill();
      g.strokeStyle = sel ? '#fff' : App.shade(col, -0.65); g.lineWidth = sel ? 1.6 : 1; g.stroke();
      if (nw > 26 && S.rowH >= 11) { g.fillStyle = 'rgba(255,255,255,.85)'; g.font = '9px Segoe UI'; g.fillText(C.noteName(n.p), x + 3, y + S.rowH - 3.5); }
    }
    if (S.marquee) { const m = S.marquee; g.fillStyle = 'rgba(120,180,255,.15)'; g.strokeStyle = '#8cc4ff'; g.lineWidth = 1; g.fillRect(m.x, m.y, m.w, m.h); g.strokeRect(m.x + 0.5, m.y + 0.5, m.w, m.h); }
    if (S.hover && App.tool !== 'select') { const y = Y(S.hover.p); g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(0, y, w, S.rowH); }
    // playhead
    const pos = Engine.position();
    if (pos != null && Engine.mode === 'pattern') { const x = X(pos % L); g.fillStyle = '#ffd34a'; g.fillRect(x, 0, 1.5, h); }
    else if (pos != null) { const c = clipAt(pos); if (c) { const x = X((pos - c.start + (c.off || 0)) % L); g.fillStyle = '#ffd34a'; g.fillRect(x, 0, 1.5, h); } }
    drawKeys(); drawVel();
  }
  function clipAt(pos) { return App.prj.playlist.clips.find(c => c.pat === App.sel.pat && pos >= c.start && pos < c.start + c.len); }
  function drawKeys() {
    const [g, w, h] = App.fitCanvas(cvKeys), prj = App.prj;
    g.fillStyle = '#e8edf2'; g.fillRect(0, 0, w, h);
    for (let p = 127; p >= 0; p--) {
      const y = Y(p); if (y > h || y + S.rowH < 0) continue; const pc = p % 12, blk = BLACK.includes(pc);
      g.fillStyle = blk ? '#1d232a' : (S.hover?.p === p ? '#cfe6ff' : '#fbfcfd'); g.fillRect(blk ? 0 : 0, y, blk ? w * 0.62 : w, S.rowH);
      if (!blk) { g.fillStyle = '#c3ccd6'; g.fillRect(0, y + S.rowH - 1, w, 1); }
      if (prj.scale !== 'chromatic' && C.inScale(p, prj.key, prj.scale)) { g.fillStyle = (((p - prj.key) % 12) + 12) % 12 === 0 ? '#e3a21a' : '#4c9be0'; g.fillRect(w - 4, y + 2, 3, S.rowH - 4); }
      if (pc === 0 && S.rowH >= 9) { g.fillStyle = '#334'; g.font = '9px Segoe UI'; g.fillText(C.noteName(p), w * 0.64, y + S.rowH - 3); }
    }
  }
  function drawVel() {
    const [g, w, h] = App.fitCanvas(cvVel), col = App.ch?.color || '#3a8fe0';
    g.fillStyle = '#1a2531'; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(150,180,210,.15)'; [0.25, 0.5, 0.75].forEach(f => g.fillRect(0, Math.round(h - f * (h - 6)) - 0.5, w, 1));
    for (const n of notes()) {
      const x = X(n.t); if (x < -4 || x > w) continue; const vh = n.v / 127 * (h - 6), sel = App.sel.notes.has(n);
      g.fillStyle = sel ? '#fff' : col; g.fillRect(x, h - vh, 2, vh); g.beginPath(); g.arc(x + 1, h - vh, 3, 0, 7); g.fill();
    }
  }
  /* ---------- interaction ---------- */
  function hit(x, y) {
    const t = T(x), p = P(y), ns = notes();
    for (let i = ns.length - 1; i >= 0; i--) { const n = ns[i]; if (n.p === p && t >= n.t && t < n.t + n.d) return { n, edge: X(n.t + n.d) - x < Math.min(7, n.d * S.pxt / 3) }; }
    return null;
  }
  const local = e => { const r = cvGrid.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  function gridHover(e) {
    const [x, y] = local(e), h = hit(x, y);
    cvGrid.style.cursor = h?.edge ? 'ew-resize' : h ? 'move' : App.tool === 'erase' ? 'not-allowed' : App.tool === 'slice' ? 'col-resize' : App.tool === 'select' ? 'default' : 'crosshair';
    const p = P(y); if (S.hover?.p !== p) { S.hover = { p }; draw(); }
    App.hover(`${C.noteName(p)} · ${C.fmtPos(App.prj, T(x))}` + (h ? ` · note ${C.noteName(h.n.p)} vel ${h.n.v} len ${h.n.d} ticks` : ''));
  }
  function preview(p, v = 100) { const ch = App.ch; if (ch) Engine.noteOn(ch.id, p, v, 0.18); }
  function gridDown(e) {
    if (!App.ch) return; cvGrid.focus();
    const [x, y] = local(e), h = hit(x, y), arr = notes(), tool = App.tool;
    if (e.button === 1) { // middle: pan
      const sx = S.scrollX, sy = S.scrollY, x0 = e.clientX, y0 = e.clientY;
      return App.drag(e, ev => { S.scrollX = Math.max(0, sx - (ev.clientX - x0) / S.pxt); S.scrollY = sy - (ev.clientY - y0); draw(); });
    }
    if (e.button === 2 || tool === 'erase') { // erase while dragging
      const del = ev => { const [a, b] = local(ev), k = hit(a, b); if (k) { arr.splice(arr.indexOf(k.n), 1); App.sel.notes.delete(k.n); Engine.setProject(App.prj); draw(); } };
      del(e); return App.drag(e, del, () => App.commit('Delete notes', ['rack', 'roll', 'pl']));
    }
    if (tool === 'slice') {
      if (!h) return; const t = roundT(T(x)); if (t <= h.n.t || t >= h.n.t + h.n.d) return;
      const b = { ...h.n, t, d: h.n.t + h.n.d - t }; h.n.d = t - h.n.t; arr.push(b); C.sortNotes(arr); return App.commit('Slice note', ['rack', 'roll']);
    }
    if (h) {
      if (!App.sel.notes.has(h.n)) { if (!e.ctrlKey) App.sel.notes.clear(); App.sel.notes.add(h.n); }
      else if (e.ctrlKey) { App.sel.notes.delete(h.n); draw(); return; }
      let group = [...App.sel.notes], an = h.n;
      if (e.shiftKey && !h.edge) { const idx = group.indexOf(h.n), copies = group.map(n => ({ ...n })); arr.push(...copies); App.sel.notes = new Set(copies); group = copies; an = copies[idx]; }
      const orig = group.map(n => ({ n, t: n.t, d: n.d, p: n.p })), t0 = T(x), p0 = P(y), anchor = orig.find(o => o.n === an);
      let lastP = an.p; preview(an.p, an.v);
      App.drag(e, ev => {
        const [a, b] = local(ev), dt = T(a) - t0, g = App.snapTicks();
        if (h.edge) { for (const o of orig) o.n.d = Math.max(ev.altKey ? 1 : g, (ev.altKey ? Math.round(o.t + o.d + dt) : roundT(o.t + o.d + dt)) - o.t); S.lastLen = an.d; }
        else {
          const dp = P(b) - p0, base = anchor.t + dt, snapped = ev.altKey ? Math.round(base) : roundT(base), sh = snapped - anchor.t;
          for (const o of orig) { o.n.t = Math.max(0, o.t + sh); o.n.p = fixPitch(o.p + dp); }
          if (an.p !== lastP) { lastP = an.p; preview(lastP, an.v); }
        }
        Engine.setProject(App.prj); draw();
      }, () => { C.sortNotes(arr); grow(); App.commit(h.edge ? 'Resize notes' : e.shiftKey ? 'Duplicate notes' : 'Move notes', ['rack', 'roll', 'pl']); });
      return;
    }
    if (tool === 'select') { // marquee
      const x0 = x, y0 = y; if (!e.ctrlKey) App.sel.notes.clear();
      const before = new Set(App.sel.notes);
      App.drag(e, ev => {
        const [a, b] = local(ev); S.marquee = { x: Math.min(a, x0), y: Math.min(b, y0), w: Math.abs(a - x0), h: Math.abs(b - y0) };
        const ta = T(S.marquee.x), tb2 = T(S.marquee.x + S.marquee.w), pa = P(S.marquee.y + S.marquee.h), pb = P(S.marquee.y);
        App.sel.notes = new Set([...before, ...arr.filter(n => n.p >= pa && n.p <= pb && n.t + n.d > ta && n.t < tb2)]); draw();
      }, () => { S.marquee = null; draw(); App.hover(App.sel.notes.size + ' notes selected'); });
      return;
    }
    // draw / paint: new note
    const p = fixPitch(P(y)), t = snapT(T(x)); if (t < 0) return;
    const n = { t: Math.max(0, t), d: S.lastLen, p, v: lastVel(), }; arr.push(n); App.sel.notes = new Set([n]); preview(p, n.v); Engine.setProject(App.prj); draw();
    if (tool === 'paint') {
      const made = new Set([n.t]);
      App.drag(e, ev => { const [a, b] = local(ev), tt = snapT(T(a)); if (tt >= 0 && !made.has(tt) && tt > n.t - 1e6) { made.add(tt); const m = { t: tt, d: S.lastLen, p: fixPitch(P(b)), v: n.v }; arr.push(m); App.sel.notes.add(m); Engine.setProject(App.prj); draw(); } },
        () => { C.sortNotes(arr); grow(); App.commit('Paint notes', ['rack', 'roll', 'pl']); });
    } else {
      const t1 = T(x), p1 = P(y);
      App.drag(e, ev => { const [a, b] = local(ev); n.t = Math.max(0, roundT(t + (T(a) - t1))); const np = fixPitch(p + P(b) - p1); if (np !== n.p) { n.p = np; preview(np, n.v); } Engine.setProject(App.prj); draw(); },
        () => { C.sortNotes(arr); grow(); App.commit('Add note', ['rack', 'roll', 'pl']); });
    }
  }
  function lastVel() { const s = [...App.sel.notes]; return s.length ? s[s.length - 1].v : 100; }
  function grow() { // pattern grows to fit notes (up to 64 bars)
    const pat = App.pat, bt = C.barTicks(App.prj); let end = 0; for (const k in pat.notes) for (const n of pat.notes[k]) end = Math.max(end, n.t + 1);
    const need = Math.min(64, Math.ceil(end / bt)); if (need > pat.bars) pat.bars = need;
  }
  function keyDown(e) {
    const r = cvKeys.getBoundingClientRect(), p = P(e.clientY - r.top), ch = App.ch; if (!ch) return;
    let v = Engine.noteOn(ch.id, p, 100), cur = p;
    App.drag(e, ev => { const q = P(ev.clientY - r.top); if (q !== cur) { Engine.noteOff(v); cur = q; v = Engine.noteOn(ch.id, q, 100); S.hover = { p: q }; drawKeys(); } }, () => Engine.noteOff(v));
  }
  function velDown(e) {
    const r = cvVel.getBoundingClientRect(), arr = notes();
    const set = ev => {
      const x = ev.clientX - r.left, v = C.clamp(Math.round((r.height - (ev.clientY - r.top)) / (r.height - 6) * 127), 1, 127);
      const pool = App.sel.notes.size ? arr.filter(n => App.sel.notes.has(n)) : arr;
      const near = pool.filter(n => Math.abs(X(n.t) - x) <= 5);
      if (!near.length && App.sel.notes.size && ev === e) { for (const n of pool) n.v = v; }
      for (const n of near) n.v = v;
      App.hover('Velocity ' + v); drawVel(); draw();
    };
    set(e); App.drag(e, set, () => { Engine.setProject(App.prj); App.commit('Velocity', ['rack', 'roll']); });
  }
  function wheel(e) {
    e.preventDefault();
    if (e.ctrlKey) { const r = cvGrid.getBoundingClientRect(); return zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left); }
    if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) S.scrollX = Math.max(0, S.scrollX + (e.deltaX || e.deltaY) / S.pxt * 0.8);
    else S.scrollY += e.deltaY * 0.6;
    draw();
  }
  /* ---------- commands ---------- */
  function selected() { const arr = notes(); return arr.filter(n => App.sel.notes.has(n)); }
  function quantizeDialog() {
    const arr = notes(); if (!arr.length) return Aero.toast('No notes to quantize');
    const opts = [[96, '1/4 (beat)'], [48, '1/8'], [32, '1/8 triplet'], [24, '1/16 (step)'], [16, '1/16 triplet'], [12, '1/32']];
    Aero.dialog({ title: 'Quantize', instruction: (App.sel.notes.size ? 'Quantize the selected notes' : 'Quantize every note of this channel') + ' to the grid.',
      fields: [{ key: 'g', label: 'Grid', type: 'select', options: opts, value: Math.min(96, App.snapTicks()) }, { key: 's', label: 'Strength', type: 'range', min: 0, max: 100, value: 100, fmt: v => v + '%' }, { key: 'e', label: 'Quantize note ends', type: 'checkbox', value: false }],
      onOK: v => {
        const sel = App.sel.notes.size ? selected() : arr, q = C.quantize(sel, +v.g, v.s / 100, v.e);
        sel.forEach((n, i) => { n.t = q[i].t; n.d = q[i].d; }); C.sortNotes(arr); App.commit('Quantize', ['rack', 'roll', 'pl']);
      } });
  }
  function chordify() {
    const sel = selected(); if (!sel.length) return Aero.toast('Select notes to turn into chords');
    const prj = App.prj, arr = notes();
    for (const n of sel) {
      const deg = p => { let q = p + 1; while (!C.inScale(q, prj.key, prj.scale === 'chromatic' ? 'major' : prj.scale)) q++; return q; };
      const third = deg(deg(n.p)), fifth = deg(deg(third));
      for (const p of [third, fifth]) if (p <= 127 && !arr.some(m => m.t === n.t && m.p === p)) arr.push({ t: n.t, d: n.d, p, v: n.v });
    }
    C.sortNotes(arr); App.commit('Chordify', ['rack', 'roll', 'pl']);
  }
  let clipboard = null;
  const cmd = {
    selectAll() { App.sel.notes = new Set(notes()); draw(); },
    del() { const arr = notes(), s = App.sel.notes; if (!s.size) return; App.pat.notes[App.ch.id] = arr.filter(n => !s.has(n)); s.clear(); App.commit('Delete notes', ['rack', 'roll', 'pl']); },
    copy() { const s = selected(); if (!s.length) return false; const t0 = Math.min(...s.map(n => n.t)); clipboard = { t0, notes: s.map(n => ({ ...n, t: n.t - t0 })), end: Math.max(...s.map(n => n.t + n.d)) - t0 }; return true; },
    cut() { if (cmd.copy()) cmd.del(); },
    paste() {
      if (!clipboard) return; const arr = notes(), s = selected(), g = C.barTicks(App.prj);
      const at = s.length ? Math.ceil(Math.max(...s.map(n => n.t + n.d)) / App.snapTicks()) * App.snapTicks() : Math.max(0, snapT(S.scrollX));
      const made = clipboard.notes.map(n => ({ ...n, t: n.t + at })); arr.push(...made); C.sortNotes(arr); App.sel.notes = new Set(made); grow(); App.commit('Paste notes', ['rack', 'roll', 'pl']);
    },
    duplicate() { const s = selected(); if (!s.length) return; const t0 = Math.min(...s.map(n => n.t)), t1 = Math.max(...s.map(n => n.t + n.d)), g = App.snapTicks(), len = Math.ceil((t1 - t0) / g) * g; const arr = notes(); const made = s.map(n => ({ ...n, t: n.t + len })); arr.push(...made); C.sortNotes(arr); App.sel.notes = new Set(made); grow(); App.commit('Duplicate notes', ['rack', 'roll', 'pl']); },
    transpose(d) { const s = selected(); if (!s.length) return; for (const n of s) n.p = C.clamp(n.p + d, 0, 127); preview(s[0].p, s[0].v); App.commit('Transpose', ['rack', 'roll', 'pl']); },
    nudge(d) { const s = selected(); if (!s.length) return; const g = App.snapTicks(); if (s.some(n => n.t + d * g < 0)) return; for (const n of s) n.t += d * g; C.sortNotes(notes()); App.commit('Move notes', ['rack', 'roll', 'pl']); },
    quantize: quantizeDialog, zoom, fit
  };
  App.views.roll = { render, draw, cmd, get state() { return S; } };
})();
