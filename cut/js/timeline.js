'use strict';
/* Lumen Cut — timeline panel: canvas-drawn tracks, ruler, clips (filmstrips, waveforms), transitions, markers;
   selection, move/trim/ripple/slip/razor, snapping, zoom & scroll, drag-and-drop from the bin and Effects. */
(function () {
  const DIV = 8, EDGE = 6;
  const tl = LC.tl = { pps: 60, sx: 0, tool: 'select', snap: true, ripple: false, linkedSel: true, sel: new Set(), selTr: null, op: null, dropGhost: null, snapT: null, marquee: null, rowsCache: [] };
  const $ = Aero.$;
  let ruler, can, scroller, hscroll, spacer, heads;

  tl.init = () => {
    ruler = $('#ruler'); can = $('#tracks'); scroller = $('#tlscroll'); hscroll = $('#hscroll'); spacer = $('#hspacer'); heads = $('#theads');
    hscroll.addEventListener('scroll', () => { tl.sx = hscroll.scrollLeft; tl.draw(); });
    scroller.addEventListener('scroll', () => tl.draw());
    new ResizeObserver(() => tl.draw()).observe(scroller);
    can.addEventListener('pointerdown', onDown); can.addEventListener('pointermove', onHover);
    can.addEventListener('dblclick', onDbl);
    can.addEventListener('contextmenu', e => e.preventDefault());
    ruler.addEventListener('pointerdown', onRulerDown); ruler.addEventListener('dblclick', onRulerDbl);
    const wheel = e => {
      if (e.ctrlKey || e.altKey) { e.preventDefault(); const r = can.getBoundingClientRect(); tl.zoomAt(tl.pps * Math.pow(1.0015, -e.deltaY), e.clientX - r.left); return; }
      const canV = scroller.scrollHeight > scroller.clientHeight + 1;
      if (e.shiftKey || !canV || Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.currentTarget === ruler) { e.preventDefault(); hscroll.scrollLeft += (e.shiftKey ? e.deltaY : (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY)); }
    };
    can.addEventListener('wheel', wheel, { passive: false }); ruler.addEventListener('wheel', wheel, { passive: false });
    // drag & drop from bin / effects / desktop
    can.addEventListener('dragover', e => {
      e.preventDefault();
      if (!LC.drag) { e.dataTransfer.dropEffect = 'copy'; return; }
      const p = pos(e); const row = rowAt(p.y); const t = Math.max(0, snapTime(xToT(p.x), null, true));
      if (LC.drag.kind === 'media') tl.dropGhost = planMedia(LC.drag.ids, t, row?.t);
      else if (LC.drag.kind === 'fx') tl.dropGhost = planFx(LC.drag.fx, p, row);
      tl.draw();
    });
    can.addEventListener('dragleave', () => { tl.dropGhost = null; tl.snapT = null; tl.draw(); });
    can.addEventListener('drop', e => {
      e.preventDefault(); const g = tl.dropGhost; tl.dropGhost = null; tl.snapT = null;
      if (!LC.drag) {  // files from the desktop dropped on the timeline: import then place at the drop point
        const files = [...e.dataTransfer.files]; if (!files.length) return;
        const p = pos(e), row = rowAt(p.y), t = Math.max(0, xToT(p.x));
        e.stopPropagation(); $('.aero-app').classList.remove('drag-over');
        LC.importBlobs(files.map(f => ({ name: f.name, blob: f, path: Aero.native?.pathForFile?.(f) || null }))).then(ms => { if (ms.length) { LC.placeMedia(ms.map(m => m.id), t, row?.t, e.ctrlKey ? 'insert' : 'overwrite'); } });
        return;
      }
      e.stopPropagation();
      const p = pos(e), row = rowAt(p.y);
      if (LC.drag.kind === 'media' && g) LC.placeMedia(LC.drag.ids, g.t, row?.t, e.ctrlKey ? 'insert' : 'overwrite');
      else if (LC.drag.kind === 'fx') applyFx(LC.drag.fx, p, row);
      LC.drag = null; tl.draw();
    });
  };

  /* ---------- geometry ---------- */
  const tToX = t => t * tl.pps - tl.sx, xToT = x => (x + tl.sx) / tl.pps;
  tl.tToX = tToX; tl.xToT = xToT;
  function rows() {
    const out = []; let y = 0;
    LC.videoTracks().slice().reverse().forEach(t => { out.push({ t, y, h: t.h }); y += t.h; });
    tl.divY = y; y += DIV;
    LC.audioTracks().forEach(t => { out.push({ t, y, h: t.h }); y += t.h; });
    tl.totalH = y; tl.rowsCache = out; return out;
  }
  tl.rows = rows;
  const rowAt = y => tl.rowsCache.find(r => y >= r.y && y < r.y + r.h);
  const rowOf = tid => tl.rowsCache.find(r => r.t.id === tid);
  function pos(e) { const r = can.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }

  function trBand(row) { return { y0: row.y + row.h * .28, y1: row.y + row.h * .78 }; }
  function hit(p) {
    const row = rowAt(p.y); if (!row) return { row: null, t: xToT(p.x) };
    const t = xToT(p.x), out = { row, t };
    const band = trBand(row);
    for (const x of LC.project.transitions.filter(x => x.track === row.t.id)) {
      const r = LC.trRegion(x), x0 = tToX(r.s), x1 = tToX(r.e);
      if (p.x >= x0 - 3 && p.x <= x1 + 3 && p.y >= band.y0 && p.y <= band.y1) { out.tr = x; out.trEdge = p.x < x0 + 5 ? 'l' : p.x > x1 - 5 ? 'r' : null; if (x1 - x0 < 14) out.trEdge = null; return out; }
    }
    for (const c of LC.clipsOn(row.t.id)) {
      const x0 = tToX(c.start), x1 = tToX(c.start + c.dur);
      if (p.x >= x0 && p.x < x1) {
        out.clip = c; const w = x1 - x0, e = Math.min(EDGE, w / 4);
        out.edge = p.x < x0 + e ? 'l' : p.x >= x1 - e ? 'r' : null;
        return out;
      }
    }
    return out;
  }

  /* ---------- snapping ---------- */
  function snapCandidates(exclude) {
    const P = LC.project, s = [0, LC.playhead];
    P.markers.forEach(m => s.push(m.t)); if (P.inPoint != null) s.push(P.inPoint); if (P.outPoint != null) s.push(P.outPoint);
    P.clips.forEach(c => { if (!exclude || !exclude.has(c.id)) s.push(c.start, c.start + c.dur); });
    return s;
  }
  function snapTime(t, exclude, show) {
    if (!tl.snap) { if (show) tl.snapT = null; return LC.fr(t); }
    const th = 8 / tl.pps; let best = null, bd = th;
    for (const c of snapCandidates(exclude)) { const d = Math.abs(c - t); if (d < bd) { bd = d; best = c; } }
    if (show) tl.snapT = best;
    return best != null ? best : LC.fr(t);
  }
  // snap a moving group: try offsets so that any of `edges` hits a candidate
  function snapDelta(dt, edges, exclude) {
    if (!tl.snap) { tl.snapT = null; return LC.fr(dt); }
    const th = 8 / tl.pps, cands = snapCandidates(exclude); let best = null, bd = th, bt = null;
    for (const e of edges) for (const c of cands) { const d = Math.abs(e + dt - c); if (d < bd) { bd = d; best = c - e; bt = c; } }
    tl.snapT = bt;
    return best != null ? best : LC.fr(dt);
  }

  /* ---------- selection ---------- */
  tl.select = (ids, add) => {
    if (!add) tl.sel.clear();
    for (const id of ids) { const c = LC.clip(id); if (!c) continue; tl.sel.add(id); if (tl.linkedSel) LC.linked(c).forEach(l => tl.sel.add(l.id)); }
    tl.selTr = null; LC.onSelection();
  };
  tl.clearSel = () => { tl.sel.clear(); tl.selTr = null; LC.onSelection(); };
  tl.selected = () => LC.project.clips.filter(c => tl.sel.has(c.id));
  tl.primary = () => { const ids = [...tl.sel]; for (let i = ids.length - 1; i >= 0; i--) { const c = LC.clip(ids[i]); if (c && c.type !== 'audio') return c; } return LC.clip(ids[ids.length - 1]) || null; };

  /* ---------- pointer ---------- */
  function onHover(e) {
    if (tl.op) return;
    const p = pos(e), h = hit(p); let cur = 'default';
    if (tl.tool === 'razor') cur = 'crosshair'; else if (tl.tool === 'hand') cur = 'grab'; else if (tl.tool === 'zoom') cur = e.altKey ? 'zoom-out' : 'zoom-in';
    else if (tl.tool === 'text') cur = 'text'; else if (tl.tool === 'slip' && h.clip) cur = 'ew-resize';
    else if (h.tr && h.trEdge || h.clip && h.edge) cur = (tl.tool === 'ripple' || tl.ripple) ? 'col-resize' : 'ew-resize';
    can.style.cursor = cur;
    if (tl.tool === 'razor') { tl.razorX = h.clip ? tToX(snapTime(h.t, null, false)) : null; tl.draw(); }
  }
  function onDbl(e) {
    const h = hit(pos(e));
    if (h.clip) { tl.select([h.clip.id]); LC.props.focus(); }
  }
  function onDown(e) {
    if (e.button === 1) return startPan(e);
    const p = pos(e), h = hit(p), P = LC.project;
    try { can.setPointerCapture(e.pointerId); } catch (_) { }
    if (e.button === 2) { if (h.clip && !tl.sel.has(h.clip.id)) tl.select([h.clip.id]); else if (h.tr) { tl.selTr = h.tr.id; tl.sel.clear(); LC.onSelection(); } return clipMenu(e, h); }
    if (tl.tool === 'hand') return startPan(e);
    if (tl.tool === 'zoom') { tl.zoomAt(tl.pps * (e.altKey ? .5 : 2), p.x); return; }
    if (tl.tool === 'razor') {
      if (!h.clip) return; const t = snapTime(h.t, null, false);
      if (e.shiftKey) LC.splitAt(t, null); else { const ids = [h.clip.id, ...(e.altKey ? [] : LC.linked(h.clip).map(c => c.id))]; LC.splitAt(t, ids); }
      return;
    }
    if (tl.tool === 'text') {
      const tr = h.row && h.row.t.kind === 'video' ? h.row.t : LC.videoTracks()[1] || LC.videoTracks()[0];
      LC.addTitle({ track: tr.id, start: Math.max(0, snapTime(h.t, null, false)) }); return;
    }
    if (h.tr) {
      tl.sel.clear(); tl.selTr = h.tr.id; LC.onSelection(); tl.draw();
      if (h.trEdge) { const r = LC.trRegion(h.tr); tl.op = { kind: 'trdur', tr: h.tr, d0: h.tr.dur, x0: p.x, edge: h.trEdge, two: !!(h.tr.a && h.tr.b), moved: false }; }
      return;
    }
    if (h.clip) {
      const c = h.clip, tr = LC.track(c.track);
      if (tr.lock) { Aero.toast(`Track ${tr.name} is locked`); return; }
      if (tl.tool === 'trackfwd') {
        const ids = P.clips.filter(x => x.start >= c.start - 1e-6 && (!e.shiftKey || x.track === c.track) && !LC.track(x.track).lock).map(x => x.id);
        tl.select(ids); return startMove(e, p, c);
      }
      if (!tl.sel.has(c.id) || e.ctrlKey || e.shiftKey) {
        if (e.ctrlKey || e.shiftKey) { if (tl.sel.has(c.id)) { tl.sel.delete(c.id); if (tl.linkedSel && !e.altKey) LC.linked(c).forEach(l => tl.sel.delete(l.id)); LC.onSelection(); tl.draw(); return; } tl.select([c.id], true); }
        else { if (e.altKey) { tl.sel = new Set([c.id]); tl.selTr = null; LC.onSelection(); } else tl.select([c.id]); }
      }
      if (tl.tool === 'slip' && LC.isTimeBased(c)) return startSlip(e, p, c);
      if (h.edge) return startTrim(e, p, c, h.edge, tl.tool === 'ripple' || tl.ripple);
      return startMove(e, p, c);
    }
    // empty area → marquee
    if (!e.shiftKey && !e.ctrlKey) tl.clearSel();
    tl.op = { kind: 'marquee', x0: p.x + tl.sx, y0: p.y, base: new Set(tl.sel) };
    tl.marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  }
  function startPan(e) { const x0 = e.clientX, s0 = hscroll.scrollLeft, y0 = e.clientY, v0 = scroller.scrollTop; can.style.cursor = 'grabbing'; tl.op = { kind: 'pan', x0, s0, y0, v0 }; try { can.setPointerCapture(e.pointerId); } catch (_) { } }
  function startMove(e, p, c) {
    const P = LC.project; let ids = [...tl.sel].filter(id => { const x = LC.clip(id); return x && !LC.track(x.track).lock; });
    const orig = new Map(ids.map(id => { const x = LC.clip(id); return [id, { start: x.start, track: x.track }]; }));
    tl.op = { kind: 'move', x0: p.x, y0: p.y, prim: c, ids, orig, moved: false, row0: rowOf(c.track) };
  }
  function startTrim(e, p, c, edge, ripple) {
    const ids = [c.id, ...(e.altKey ? [] : LC.linked(c).map(l => l.id))].filter(id => !LC.track(LC.clip(id).track).lock);
    const snap = JSON.parse(JSON.stringify(LC.project.clips));
    tl.op = { kind: 'trim', x0: p.x, c, edge, ripple, ids, snap, moved: false };
  }
  function startSlip(e, p, c) { tl.op = { kind: 'slip', x0: p.x, c, in0: c.in, ids: [c.id, ...LC.linked(c).map(l => l.id)].map(id => [id, LC.clip(id).in]), moved: false }; }

  document.addEventListener('pointermove', e => {
    const op = tl.op; if (!op) return;
    const p = pos(e);
    if (op.kind === 'pan') { hscroll.scrollLeft = op.s0 - (e.clientX - op.x0); scroller.scrollTop = op.v0 - (e.clientY - op.y0); return; }
    if (op.kind === 'marquee') {
      tl.marquee.x1 = p.x; tl.marquee.y1 = p.y;
      const t0 = Math.min(op.x0, p.x + tl.sx) / tl.pps, t1 = Math.max(op.x0, p.x + tl.sx) / tl.pps, y0 = Math.min(op.y0, p.y), y1 = Math.max(op.y0, p.y);
      const ids = new Set(op.base);
      for (const r of tl.rowsCache) { if (r.y + r.h < y0 || r.y > y1) continue; for (const c of LC.clipsOn(r.t.id)) if (c.start < t1 && c.start + c.dur > t0) { ids.add(c.id); if (tl.linkedSel) LC.linked(c).forEach(l => ids.add(l.id)); } }
      tl.sel = ids; tl.draw(); return;
    }
    const dx = p.x - op.x0;
    if (!op.moved && Math.abs(dx) < 3 && Math.abs(p.y - (op.y0 ?? p.y)) < 4) return;
    op.moved = true;
    if (op.kind === 'move') doMove(op, p, e);
    else if (op.kind === 'trim') doTrim(op, dx, e);
    else if (op.kind === 'slip') {
      const c = op.c, m = LC.mediaOf(c); const d = -dx / tl.pps;
      for (const [id, in0] of op.ids) { const x = LC.clip(id), mm = LC.mediaOf(x); x.in = Math.max(0, Math.min(in0 + d * x.props.speed, mm.duration - x.dur * x.props.speed)); }
      LC.statusMsg(`Slip: in ${LC.tc(c.in)}  out ${LC.tc(c.in + c.dur * c.props.speed)}`); LC.requestRender();
    } else if (op.kind === 'trdur') {
      const d = (op.edge === 'l' ? -dx : dx) / tl.pps * (op.two ? 2 : 1);
      op.tr.dur = Math.max(1 / LC.fps(), LC.fr(op.d0 + d)); LC.cleanTransitions(); LC.statusMsg('Transition duration ' + LC.tc(op.tr.dur)); LC.props.render();
    }
    tl.draw(); LC.requestRender();
  });
  document.addEventListener('pointerup', e => {
    const op = tl.op; if (!op) return; tl.op = null; tl.snapT = null;
    if (op.kind === 'pan') { can.style.cursor = ''; return; }
    if (op.kind === 'marquee') { tl.marquee = null; LC.onSelection(); tl.draw(); return; }
    if (!op.moved) { if (op.kind === 'move' && !e.ctrlKey && !e.shiftKey && tl.sel.size > 1 && !e.altKey) tl.select([op.prim.id]); tl.draw(); return; }
    if (op.kind === 'move') finishMove(op, e);
    else if (op.kind === 'trim') { LC.cleanTransitions(); LC.commit(op.ripple ? 'Ripple trim' : 'Trim clip'); }
    else if (op.kind === 'slip') LC.commit('Slip clip');
    else if (op.kind === 'trdur') LC.commit('Transition duration');
    LC.refresh();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && tl.op) { cancelOp(); } }, true);
  function cancelOp() {
    const op = tl.op; tl.op = null; tl.marquee = null; tl.snapT = null;
    if (op?.kind === 'move') for (const [id, o] of op.orig) { const c = LC.clip(id); if (c) { c.start = o.start; c.track = o.track; } }
    if (op?.kind === 'trim') LC.project.clips = op.snap;
    if (op?.kind === 'slip') for (const [id, in0] of op.ids) LC.clip(id).in = in0;
    if (op?.kind === 'trdur') op.tr.dur = op.d0;
    LC.refresh();
  }

  function doMove(op, p, e) {
    const P = LC.project;
    const exclude = new Set(op.ids);
    const edges = []; for (const id of op.ids) { const o = op.orig.get(id), c = LC.clip(id); edges.push(o.start, o.start + c.dur); }
    let dt = (p.x - op.x0) / tl.pps;
    const minStart = Math.min(...op.ids.map(id => op.orig.get(id).start));
    dt = snapDelta(dt, edges, exclude); dt = Math.max(dt, -minStart);
    // vertical: move by track index delta within each kind
    const row = rowAt(p.y), prim = op.prim, kind = LC.track(op.orig.get(prim.id).track).kind;
    let di = 0;
    if (row && row.t.kind === kind && !e.altKey) {
      const list = kind === 'video' ? LC.videoTracks() : LC.audioTracks();
      di = list.indexOf(row.t) - list.findIndex(t => t.id === op.orig.get(prim.id).track);
    }
    for (const id of op.ids) {
      const c = LC.clip(id), o = op.orig.get(id); c.start = LC.fr(o.start + dt);
      const otr = LC.track(o.track);
      if (otr.kind === kind && di) { const list = kind === 'video' ? LC.videoTracks() : LC.audioTracks(); const ni = list.indexOf(otr) + di; c.track = ni >= 0 && ni < list.length && !list[ni].lock ? list[ni].id : o.track; }
      else c.track = o.track;
    }
    LC.statusMsg(`Move ${dt >= 0 ? '+' : '-'}${LC.tc(Math.abs(dt))}${e.ctrlKey ? '  (insert)' : ''}`);
  }
  function finishMove(op, e) {
    const moving = new Set(op.ids), clips = op.ids.map(LC.clip);
    if (e.ctrlKey) {   // insert: push later clips on target tracks to the right
      const byTrack = new Map(); clips.forEach(c => { const r = byTrack.get(c.track) || [Infinity, 0]; r[0] = Math.min(r[0], c.start); r[1] = Math.max(r[1], c.start + c.dur); byTrack.set(c.track, r); });
      for (const [tid, [a, b]] of byTrack) { const inside = LC.clipsOn(tid).filter(c => !moving.has(c.id) && c.start < a && c.start + c.dur > a); inside.forEach(c => LC.splitClip(c, a)); LC.rippleShift(tid, a, b - a, moving); }
    } else clips.forEach(c => LC.overwriteRange(c.track, c.start, c.start + c.dur, moving));
    LC.cleanTransitions(); LC.commit(e.ctrlKey ? 'Insert clips' : 'Move clips');
  }
  function doTrim(op, dx, e) {
    LC.project.clips = JSON.parse(JSON.stringify(op.snap));             // recompute from the original state each move
    const P = LC.project, fps = LC.fps(), one = 1 / fps, c = LC.clip(op.c.id);
    let d = dx / tl.pps; const excl = new Set(op.ids);
    const edgeT = op.edge === 'l' ? c.start : c.start + c.dur;
    d = snapTime(edgeT + d, excl, true) - edgeT;
    // constraints across all trimmed clips
    for (const id of op.ids) {
      const x = LC.clip(id), m = LC.mediaOf(x), tb = LC.isTimeBased(x);
      const neighbours = LC.clipsOn(x.track).filter(o => !excl.has(o.id));
      if (op.edge === 'l') {
        d = Math.min(d, x.dur - one);
        if (tb) d = Math.max(d, -x.in / x.props.speed);
        if (!op.ripple) { const prev = neighbours.filter(o => o.start + o.dur <= x.start + 1e-6).pop(); d = Math.max(d, (prev ? prev.start + prev.dur : 0) - x.start); }
      } else {
        d = Math.max(d, one - x.dur);
        if (tb && m) d = Math.min(d, (m.duration - x.in) / x.props.speed - x.dur);
        if (!op.ripple) { const next = neighbours.find(o => o.start >= x.start + x.dur - 1e-6); if (next) d = Math.min(d, next.start - (x.start + x.dur)); }
      }
    }
    d = LC.fr(d);
    const tracks = new Set();
    for (const id of op.ids) {
      const x = LC.clip(id), end0 = x.start + x.dur; tracks.add(x.track);
      if (op.edge === 'l') {
        if (op.ripple) { x.in += d * x.props.speed; x.dur -= d; for (const k of Object.keys(x.kf || {})) x.kf[k].forEach(q => q.t -= d); LC.rippleShift(x.track, end0 - 1e-6, -d, excl); }
        else LC.trimStart(x, x.start + d);
      } else { x.dur += d; if (op.ripple) LC.rippleShift(x.track, end0 - 1e-6, d, excl); }
    }
    LC.statusMsg(`${op.ripple ? 'Ripple trim' : 'Trim'} ${d >= 0 ? '+' : '-'}${LC.tc(Math.abs(d))}  ·  duration ${LC.tc(c.dur)}`);
    if (op.edge === 'r') LC.previewAt?.(c.start + c.dur - one); else LC.previewAt?.(c.start);
  }

  /* ---------- ruler ---------- */
  function markerAt(x) { return LC.project.markers.find(m => Math.abs(tToX(m.t) - x) < 6); }
  function onRulerDown(e) {
    const r = ruler.getBoundingClientRect(), x = e.clientX - r.left; try { ruler.setPointerCapture(e.pointerId); } catch (_) { }
    const mk = markerAt(x);
    if (mk && e.button === 0) {
      const t0 = mk.t; let moved = false;
      const mv = ev => { const nx = ev.clientX - r.left; if (Math.abs(nx - x) > 3) moved = true; if (moved) { mk.t = Math.max(0, LC.fr(xToT(nx))); tl.draw(); } };
      const up = () => { ruler.removeEventListener('pointermove', mv); ruler.removeEventListener('pointerup', up); if (moved) LC.commit('Move marker'); else LC.setPlayhead(mk.t); };
      ruler.addEventListener('pointermove', mv); ruler.addEventListener('pointerup', up); return;
    }
    LC.stop?.();
    const go = ev => { const t = xToT(ev.clientX - r.left); LC.setPlayhead(Math.max(0, ev.shiftKey ? snapTime(t, null, false) : LC.fr(t))); };
    go(e);
    const mv = ev => go(ev); const up = () => { ruler.removeEventListener('pointermove', mv); ruler.removeEventListener('pointerup', up); };
    ruler.addEventListener('pointermove', mv); ruler.addEventListener('pointerup', up);
  }
  function onRulerDbl(e) { const r = ruler.getBoundingClientRect(); const mk = markerAt(e.clientX - r.left); if (mk) LC.editMarker(mk); }

  /* ---------- zoom ---------- */
  tl.zoomAt = (pps, x) => {
    const t = xToT(x); tl.pps = Math.max(1.5, Math.min(900, pps));
    updateSpacer(); hscroll.scrollLeft = Math.max(0, t * tl.pps - x); tl.sx = hscroll.scrollLeft; tl.draw();
    const zs = $('#tlzoom'); if (zs) zs.value = Math.log(tl.pps);
  };
  tl.zoomFit = () => { const d = Math.max(5, LC.seqDuration()); tl.pps = Math.max(1.5, (can.clientWidth - 40) / d); updateSpacer(); hscroll.scrollLeft = 0; tl.sx = 0; tl.draw(); const zs = $('#tlzoom'); if (zs) zs.value = Math.log(tl.pps); };
  function updateSpacer() { const w = Math.max(LC.seqDuration() + 60, xToT(can.clientWidth) + 10) * tl.pps; spacer.style.width = w + 'px'; }
  tl.ensureVisible = t => { const x = tToX(t), W = can.clientWidth; if (x > W - 30 || x < 0) { hscroll.scrollLeft = Math.max(0, t * tl.pps - (x > W - 30 ? W * .1 : W * .5)); tl.sx = hscroll.scrollLeft; } };

  /* ---------- drop planning ---------- */
  function targetTracks(kind, rowTrack) {
    const V = LC.videoTracks(), A = LC.audioTracks();
    let v = rowTrack && rowTrack.kind === 'video' ? rowTrack : V[0];
    let a = rowTrack && rowTrack.kind === 'audio' ? rowTrack : (A[Math.max(0, V.indexOf(v))] || A[0]);
    if (v && v.lock) v = V.find(t => !t.lock); if (a && a.lock) a = A.find(t => !t.lock);
    return { v, a };
  }
  function planMedia(ids, t, rowTrack) {
    const items = []; let cur = t;
    for (const id of ids) {
      const m = LC.project.media.find(x => x.id === id); if (!m) continue;
      const rt = LC.rt.media.get(id); if (!rt || rt.status !== 'ok') continue;
      const dur = m.kind === 'image' ? 5 : LC.fr(m.duration) || 1 / LC.fps();
      const { v, a } = targetTracks(m.kind, rowTrack);
      if (m.kind === 'video' || m.kind === 'image') { if (v) items.push({ track: v.id, start: cur, dur, type: m.kind, media: m }); if (m.kind === 'video' && m.hasAudio && a) items.push({ track: a.id, start: cur, dur, type: 'audio', media: m, linked: true }); }
      else if (a) items.push({ track: a.id, start: cur, dur, type: 'audio', media: m });
      cur += dur;
    }
    return { t, items };
  }
  LC.placeMedia = (ids, t, rowTrack, mode = 'overwrite') => {
    rows();
    const plan = planMedia(ids, LC.fr(t), rowTrack && LC.track(rowTrack.id || rowTrack));
    if (!plan.items.length) return [];
    const made = []; let link = null, lastMedia = null;
    if (mode === 'insert') {
      const total = plan.items.reduce((m, i) => Math.max(m, i.start + i.dur), 0) - plan.t;
      const tids = new Set(plan.items.map(i => i.track));
      for (const tid of tids) { LC.clipsOn(tid).filter(c => c.start < plan.t && c.start + c.dur > plan.t).forEach(c => LC.splitClip(c, plan.t)); LC.rippleShift(tid, plan.t, total); }
    }
    for (const it of plan.items) {
      if (it.media !== lastMedia) { link = it.media.kind === 'video' && it.media.hasAudio ? 'l' + Aero.uid() : null; lastMedia = it.media; }
      if (mode !== 'insert') LC.overwriteRange(it.track, it.start, it.start + it.dur);
      const c = LC.makeClip({ track: it.track, type: it.type, media: it.media.id, start: it.start, in: 0, dur: it.dur, link: (it.type === 'audio' && !it.linked) ? null : (it.media.kind === 'video' ? link : null), name: it.media.name });
      LC.project.clips.push(c); made.push(c);
    }
    LC.cleanTransitions();
    tl.select(made.map(c => c.id));
    LC.commit(`${mode === 'insert' ? 'Insert' : 'Overwrite'} ${made.length > 1 ? made.length + ' clips' : made[0].name}`);
    LC.refresh(); return made;
  };
  function planFx(fx, p, row) {
    if (!row) return null;
    const [kind, type] = fx.split(':');
    if (kind === 'title') { if (row.t.kind !== 'video') return null; const t = Math.max(0, snapTime(xToT(p.x), null, true)); return { t, items: [{ track: row.t.id, start: t, dur: 5, type: 'title' }] }; }
    const h = hit(p); if (!h.clip || h.clip.type === 'audio') return null;
    const c = h.clip, side = h.t < c.start + c.dur / 2 ? 'in' : 'out';
    const others = LC.clipsOn(c.track), eps = 1e-4;
    const nb = side === 'in' ? others.find(o => Math.abs(o.start + o.dur - c.start) < eps) : others.find(o => Math.abs(o.start - c.start - c.dur) < eps);
    const d = 1, cut = side === 'in' ? c.start : c.start + c.dur;
    const s = nb ? cut - d / 2 : side === 'in' ? cut : cut - d;
    return { tr: true, track: c.track, s, e: s + d };
  }
  function applyFx(fx, p, row) {
    const [kind, type] = fx.split(':');
    if (kind === 'title') { if (!row || row.t.kind !== 'video') return Aero.toast('Drop titles on a video track'); LC.addTitle({ track: row.t.id, start: Math.max(0, snapTime(xToT(p.x), null, false)), preset: type }); return; }
    const h = hit(p); if (!h.clip || h.clip.type === 'audio') return Aero.toast('Drop transitions on the start or end of a video clip');
    const side = h.t < h.clip.start + h.clip.dur / 2 ? 'in' : 'out';
    const tr = LC.addTransition(h.clip, side, type, 1);
    if (tr) { tl.sel.clear(); tl.selTr = tr.id; LC.commit('Add ' + LC.TRANSITIONS.find(x => x.id === type).name); LC.onSelection(); LC.refresh(); }
  }

  /* ---------- context menu ---------- */
  function clipMenu(e, h) {
    const items = [];
    if (h.tr) items.push(['Transition Settings…', () => LC.props.focus()], ['Delete Transition', () => LC.deleteSelection()]);
    else if (h.clip) {
      items.push(['Split at Playhead', () => LC.splitSelected()], ['Ripple Delete', () => LC.rippleDelete()], ['Delete', () => LC.deleteSelection()], '-',
        ['Copy', () => LC.copy()], ['Cut', () => LC.cut()], '-', ['Speed/Duration…', () => LC.speedDialog()], [h.clip.disabled ? 'Enable' : 'Disable', () => LC.toggleEnable()],
        [h.clip.link ? 'Unlink' : 'Link', () => LC.toggleLink()], ['Reset Effects', () => LC.resetEffects()]);
      if (h.clip.type !== 'audio') items.push('-', ['Add Cross Dissolve at Start', () => { LC.addTransition(h.clip, 'in', 'dissolve', 1); LC.commit('Add transition'); LC.refresh(); }], ['Add Cross Dissolve at End', () => { LC.addTransition(h.clip, 'out', 'dissolve', 1); LC.commit('Add transition'); LC.refresh(); }]);
    } else { items.push(['Paste', () => LC.paste()], ['Add Marker', () => LC.addMarker()], ['Zoom to Sequence', () => tl.zoomFit()]); }
    LC.ctxMenu(e.clientX, e.clientY, items);
  }

  /* ---------- track headers ---------- */
  const svg = {
    eye: '<svg viewBox="0 0 16 16"><path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="#fff" stroke="#2a4f78"/><circle cx="8" cy="8" r="2.3" fill="#2a6fc0"/></svg>',
    lock: '<svg viewBox="0 0 16 16"><rect x="3.5" y="7" width="9" height="7" rx="1" fill="#e3a21a" stroke="#8a5a0a"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="#6a6a6a" stroke-width="1.4"/></svg>'
  };
  tl.renderHeads = () => {
    const R = rows(); heads.innerHTML = ''; heads.style.height = tl.totalH + 'px';
    const solo = LC.project.tracks.some(t => t.kind === 'audio' && t.solo);
    R.forEach((r, i) => {
      const t = r.t, d = Aero.el('div', 'thead ' + t.kind + (t.lock ? ' locked' : ''));
      d.style.top = r.y + 'px'; d.style.height = r.h + 'px';
      const btns = t.kind === 'video'
        ? `<button class="tbtn ${t.mute ? '' : 'on'}" data-a="mute" title="Toggle track output">${svg.eye}</button>`
        : `<button class="tbtn txt ${t.mute ? 'on red' : ''}" data-a="mute" title="Mute track">M</button><button class="tbtn txt ${t.solo ? 'on yel' : ''}" data-a="solo" title="Solo track">S</button>`;
      d.innerHTML = `<span class="tname" title="Double-click to rename"></span>${btns}<button class="tbtn ${t.lock ? 'on' : ''}" data-a="lock" title="Lock track">${svg.lock}</button><div class="threz" title="Drag to resize track"></div>`;
      d.querySelector('.tname').textContent = t.name;
      if (t.kind === 'audio' && solo && !t.solo) d.classList.add('dimmed');
      d.querySelectorAll('.tbtn').forEach(b => b.onclick = () => { const a = b.dataset.a; t[a] = !t[a]; LC.commit(`${a[0].toUpperCase() + a.slice(1)} ${t.name}`); LC.refresh(); if (LC.playing) LC.restartPlayback(); });
      d.querySelector('.tname').ondblclick = async () => { const n = await Aero.prompt('Rename track', 'Name', t.name); if (n) { t.name = n.slice(0, 20); LC.commit('Rename track'); LC.refresh(); } };
      d.querySelector('.threz').onpointerdown = ev => {
        ev.preventDefault(); const y0 = ev.clientY, h0 = t.h; const el = ev.target; try { el.setPointerCapture(ev.pointerId); } catch (_) { }
        const mv = e2 => { t.h = Math.max(34, Math.min(180, h0 + (e2.clientY - y0))); tl.renderHeads(); tl.draw(); };
        const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); if (t.h !== h0) LC.commit('Track height'); };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
      };
      heads.appendChild(d);
    });
    const dv = Aero.el('div', 'tdiv'); dv.style.top = tl.divY + 'px'; dv.style.height = DIV + 'px'; heads.appendChild(dv);
  };

  /* ---------- drawing ---------- */
  let pending = false;
  tl.draw = () => { if (pending) return; pending = true; requestAnimationFrame(() => { pending = false; drawNow(); }); };
  tl.drawNow = () => drawNow();
  const COL = {
    video: ['#7fb0ea', '#4a7fc4', '#2c5c99'], audio: ['#86d68f', '#45a656', '#2a7238'], image: ['#f0c27a', '#d39b3f', '#9a6a1c'], title: ['#d6a4ec', '#a965c9', '#743a96']
  };
  function niceStep(pps) {
    const fps = LC.fps(), cands = [1 / fps, 2 / fps, 5 / fps, 10 / fps, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
    return cands.find(s => s * pps >= 70) || 3600;
  }
  function drawNow() {
    if (!can || !LC.project) return;
    const R = rows(); const dpr = devicePixelRatio || 1;
    const W = scroller.clientWidth - heads.offsetWidth, H = Math.max(tl.totalH, scroller.clientHeight - 2);
    can.style.width = W + 'px'; can.style.height = H + 'px';
    if (can.width !== Math.round(W * dpr) || can.height !== Math.round(H * dpr)) { can.width = Math.round(W * dpr); can.height = Math.round(H * dpr); }
    const rw = ruler.clientWidth, rh = ruler.clientHeight;
    if (ruler.width !== Math.round(rw * dpr) || ruler.height !== Math.round(rh * dpr)) { ruler.width = Math.round(rw * dpr); ruler.height = Math.round(rh * dpr); }
    updateSpacer();
    drawRuler(ruler.getContext('2d'), rw, rh, dpr);
    const x = can.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, W, H);
    const P = LC.project, vt0 = xToT(0), vt1 = xToT(W);
    // rows
    for (const r of R) {
      const g = x.createLinearGradient(0, r.y, 0, r.y + r.h);
      if (r.t.kind === 'video') { g.addColorStop(0, '#eef3f9'); g.addColorStop(1, '#e3ebf4'); } else { g.addColorStop(0, '#eef6ef'); g.addColorStop(1, '#e2eee4'); }
      x.fillStyle = g; x.fillRect(0, r.y, W, r.h);
      x.fillStyle = '#c9d6e4'; x.fillRect(0, r.y + r.h - 1, W, 1);
      if (r.t.lock) { x.save(); x.beginPath(); x.rect(0, r.y, W, r.h - 1); x.clip(); x.strokeStyle = 'rgba(80,100,130,.13)'; x.lineWidth = 6; for (let i = -r.h; i < W; i += 16) { x.beginPath(); x.moveTo(i, r.y + r.h); x.lineTo(i + r.h, r.y); x.stroke(); } x.restore(); }
    }
    const dg = x.createLinearGradient(0, tl.divY, 0, tl.divY + DIV); dg.addColorStop(0, '#9fb3c9'); dg.addColorStop(.5, '#c7d5e4'); dg.addColorStop(1, '#9fb3c9');
    x.fillStyle = dg; x.fillRect(0, tl.divY, W, DIV);
    // in/out range
    if (P.inPoint != null || P.outPoint != null) {
      const a = tToX(P.inPoint ?? 0), b = tToX(P.outPoint ?? LC.seqDuration());
      x.fillStyle = 'rgba(60,127,177,.07)'; x.fillRect(a, 0, b - a, H);
    }
    // markers (faint lines)
    P.markers.forEach(m => { const mx = Math.round(tToX(m.t)) + .5; if (mx < 0 || mx > W) return; x.strokeStyle = m.color + '55'; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(mx, 0); x.lineTo(mx, H); x.stroke(); x.setLineDash([]); });
    // clips
    for (const r of R) {
      for (const c of LC.clipsOn(r.t.id)) {
        if (c.start + c.dur < vt0 || c.start > vt1) continue;
        drawClip(x, c, r, W);
      }
      // transitions
      for (const tr of P.transitions.filter(q => q.track === r.t.id)) drawTransition(x, tr, r);
    }
    // drop ghost
    const g = tl.dropGhost;
    if (g) {
      x.save();
      if (g.items) g.items.forEach(it => { const rr = rowOf(it.track); if (!rr) return; const gx = tToX(it.start), gw = it.dur * tl.pps; x.fillStyle = 'rgba(60,127,177,.25)'; x.strokeStyle = '#2a6fc0'; x.setLineDash([4, 3]); x.lineWidth = 1.5; x.fillRect(gx, rr.y + 2, gw, rr.h - 5); x.strokeRect(gx + .5, rr.y + 2.5, gw - 1, rr.h - 6); x.setLineDash([]); x.fillStyle = '#123'; x.font = '11px Segoe UI'; x.fillText(it.type === 'title' ? 'Title' : it.media.name, gx + 6, rr.y + 16); });
      if (g.tr) { const rr = rowOf(g.track); const band = trBand(rr); x.fillStyle = 'rgba(255,190,40,.55)'; x.strokeStyle = '#b07800'; const gx = tToX(g.s), gw = (g.e - g.s) * tl.pps; x.fillRect(gx, band.y0, gw, band.y1 - band.y0); x.strokeRect(gx + .5, band.y0 + .5, gw - 1, band.y1 - band.y0 - 1); }
      x.restore();
    }
    // marquee
    if (tl.marquee) { const m = tl.marquee; x.fillStyle = 'rgba(51,153,255,.15)'; x.strokeStyle = '#3399ff'; x.lineWidth = 1; x.fillRect(Math.min(m.x0, m.x1), Math.min(m.y0, m.y1), Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0)); x.strokeRect(Math.min(m.x0, m.x1) + .5, Math.min(m.y0, m.y1) + .5, Math.abs(m.x1 - m.x0), Math.abs(m.y1 - m.y0)); }
    // snap line
    if (tl.snapT != null) { const sx = Math.round(tToX(tl.snapT)) + .5; x.strokeStyle = '#ffb000'; x.lineWidth = 1; x.setLineDash([5, 3]); x.beginPath(); x.moveTo(sx, 0); x.lineTo(sx, H); x.stroke(); x.setLineDash([]); }
    // razor guide
    if (tl.tool === 'razor' && tl.razorX != null) { x.strokeStyle = '#e8382a'; x.beginPath(); x.moveTo(tl.razorX + .5, 0); x.lineTo(tl.razorX + .5, H); x.stroke(); }
    // playhead
    const px = Math.round(tToX(LC.playhead)) + .5;
    if (px >= 0 && px <= W) { x.strokeStyle = '#d9342b'; x.lineWidth = 1; x.beginPath(); x.moveTo(px, 0); x.lineTo(px, H); x.stroke(); }
  }
  function drawClip(x, c, r, W) {
    const P = LC.project, sel = tl.sel.has(c.id), m = LC.mediaOf(c), rt = m && LC.rt.media.get(m.id);
    const cx = tToX(c.start), cw = Math.max(2, c.dur * tl.pps), y = r.y + 2, h = r.h - 5;
    const col = COL[c.type] || COL.video, off = rt && (rt.status === 'offline' || rt.status === 'error');
    x.save(); x.beginPath(); x.roundRect(cx, y, cw, h, 3); x.clip();
    if (c.disabled) x.globalAlpha = .45;
    const g = x.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, off ? '#f08a80' : col[0]); g.addColorStop(1, off ? '#c0392b' : col[1]);
    x.fillStyle = g; x.fillRect(cx, y, cw, h);
    const hh = Math.min(16, h * .4), by = y + hh, bh = h - hh;
    // content
    if (!off && rt) {
      if (c.type === 'video' && rt.strip && rt.strip.length && bh > 10) {
        const s0 = rt.strip[0].c, th = bh, tw = th * s0.width / s0.height;
        const x0 = Math.max(cx, 0) - ((Math.max(cx, 0) - cx) % tw);
        for (let tx = x0; tx < Math.min(cx + cw, W); tx += tw) {
          const st = LC.srcTime(c, c.start + (tx - cx + tw / 2) / tl.pps);
          let best = rt.strip[0]; for (const f of rt.strip) if (Math.abs(f.t - st) < Math.abs(best.t - st)) best = f;
          x.drawImage(best.c, tx, by, tw, th);
        }
        x.fillStyle = 'rgba(255,255,255,.08)'; x.fillRect(cx, by, cw, bh);
      } else if (c.type === 'image' && rt.thumb && bh > 10) {
        const tw = bh * 16 / 9; for (let tx = Math.max(cx, cx + Math.floor(-cx / tw) * tw); tx < Math.min(cx + cw, W); tx += tw) x.drawImage(rt.thumb, tx, by, tw, bh);
      } else if (c.type === 'audio' && rt.peaks) {
        const mid = by + bh / 2, amp = bh / 2 - 2; x.fillStyle = 'rgba(16,60,26,.85)';
        const a0 = Math.max(cx, 0) | 0, a1 = Math.min(cx + cw, W) | 0;
        for (let px = a0; px < a1; px++) {
          const s0 = LC.srcTime(c, c.start + (px - cx) / tl.pps), s1 = LC.srcTime(c, c.start + (px + 1 - cx) / tl.pps);
          const i0 = Math.max(0, Math.floor(s0 * 100)), i1 = Math.min(rt.peaks.length, Math.max(i0 + 1, Math.ceil(s1 * 100)));
          let mm = 0; for (let i = i0; i < i1; i++) if (rt.peaks[i] > mm) mm = rt.peaks[i];
          const gain = LC.clipGain(c, (px - cx) / tl.pps), v = Math.min(1, mm * gain) * amp;
          x.fillRect(px, mid - v, 1, Math.max(1, v * 2));
        }
      }
    }
    if (c.type === 'title') {
      x.fillStyle = 'rgba(255,255,255,.9)'; x.font = `${c.title.italic ? 'italic ' : ''}700 ${Math.min(22, Math.max(10, bh * .5))}px "${c.title.font}"`;
      x.fillText(c.title.text.replace(/\n/g, ' '), cx + 8, by + bh / 2 + 6);
    }
    // header strip
    const hg = x.createLinearGradient(0, y, 0, by); hg.addColorStop(0, 'rgba(255,255,255,.55)'); hg.addColorStop(1, 'rgba(255,255,255,.18)');
    x.fillStyle = col[2]; x.globalAlpha = c.disabled ? .45 : .9; x.fillRect(cx, y, cw, hh); x.globalAlpha = c.disabled ? .45 : 1; x.fillStyle = hg; x.fillRect(cx, y, cw, hh / 2);
    x.font = '11px Segoe UI'; x.fillStyle = '#fff'; x.textBaseline = 'middle';
    const tags = [];
    if (c.props.speed !== 1) tags.push(Math.round(c.props.speed * 100) + '%');
    const pr = c.props, fx = pr.exposure || pr.brightness || pr.contrast || pr.saturation !== 100 || pr.temperature || pr.blur || pr.crop.some(v => v) || Object.keys(c.kf || {}).length;
    let label = (c.link ? '' : '') + LC.clipName(c) + (tags.length ? '  [' + tags.join(' ') + ']' : '');
    if (off) label = '⚠ ' + label + ' — offline';
    x.save(); x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 2; x.fillText(label, Math.max(cx, 0) + 5, y + hh / 2 + .5, Math.max(0, cw - 26)); x.restore();
    if (fx && cw > 40) { const bx = cx + cw - 20; x.fillStyle = '#ffd34a'; x.beginPath(); x.roundRect(bx, y + 2, 16, hh - 4, 2); x.fill(); x.fillStyle = '#5a3a00'; x.font = 'italic 700 9px Segoe UI'; x.fillText('fx', bx + 3.5, y + hh / 2 + .5); }
    x.textBaseline = 'alphabetic';
    // fades
    if (pr.fadeIn > 0 || pr.fadeOut > 0) {
      x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 1.2; x.beginPath();
      if (pr.fadeIn > 0) { x.moveTo(cx, y + h); x.lineTo(cx + pr.fadeIn * tl.pps, by + 1); }
      if (pr.fadeOut > 0) { x.moveTo(cx + cw - pr.fadeOut * tl.pps, by + 1); x.lineTo(cx + cw, y + h); }
      x.stroke();
    }
    // keyframes
    if (sel) {
      const kts = LC.keyTimes(c); x.fillStyle = '#fff'; x.strokeStyle = '#333';
      kts.forEach(t => { const kx = cx + t * tl.pps, ky = y + h - 6; x.beginPath(); x.moveTo(kx, ky - 4); x.lineTo(kx + 4, ky); x.lineTo(kx, ky + 4); x.lineTo(kx - 4, ky); x.closePath(); x.fill(); x.stroke(); });
    }
    x.restore();
    // border
    x.lineWidth = sel ? 2 : 1; x.strokeStyle = sel ? '#ffb000' : 'rgba(10,30,60,.55)';
    x.beginPath(); x.roundRect(cx + (sel ? 1 : .5), y + (sel ? 1 : .5), cw - (sel ? 2 : 1), h - (sel ? 2 : 1), 3); x.stroke();
    if (sel) { x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = 1; x.beginPath(); x.roundRect(cx + 2.5, y + 2.5, cw - 5, h - 5, 2); x.stroke(); }
  }
  function drawTransition(x, tr, r) {
    const R = LC.trRegion(tr), x0 = tToX(R.s), w = (R.e - R.s) * tl.pps, band = trBand(r), sel = tl.selTr === tr.id;
    const g = x.createLinearGradient(0, band.y0, 0, band.y1); g.addColorStop(0, sel ? '#fff3c4' : '#f4f0ff'); g.addColorStop(.5, sel ? '#ffd86a' : '#d5c8f2'); g.addColorStop(1, sel ? '#f0b830' : '#a993dc');
    x.fillStyle = g; x.beginPath(); x.roundRect(x0, band.y0, w, band.y1 - band.y0, 3); x.fill();
    x.strokeStyle = sel ? '#a06a00' : '#5a4a8a'; x.lineWidth = sel ? 1.5 : 1; x.stroke();
    x.beginPath(); x.moveTo(x0 + 2, band.y1 - 2); x.lineTo(x0 + w - 2, band.y0 + 2); x.strokeStyle = 'rgba(60,40,110,.45)'; x.lineWidth = 1; x.stroke();
    if (w > 50) { x.fillStyle = '#2a1f4a'; x.font = '10px Segoe UI'; x.textBaseline = 'middle'; x.fillText(LC.TRANSITIONS.find(t => t.id === tr.type).name, x0 + 5, (band.y0 + band.y1) / 2, w - 10); x.textBaseline = 'alphabetic'; }
  }
  function drawRuler(x, W, H, dpr) {
    const P = LC.project; x.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#fdfeff'); g.addColorStop(1, '#dde7f3'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = '#a7bcd6'; x.fillRect(0, H - 1, W, 1);
    // in/out
    if (P.inPoint != null || P.outPoint != null) {
      const a = tToX(P.inPoint ?? 0), b = tToX(P.outPoint ?? LC.seqDuration());
      x.fillStyle = 'rgba(60,127,177,.28)'; x.fillRect(a, H - 9, b - a, 8);
      x.fillStyle = '#2a5f8c'; if (P.inPoint != null) x.fillRect(a, H - 12, 2, 11); if (P.outPoint != null) x.fillRect(b - 2, H - 12, 2, 11);
    }
    const step = niceStep(tl.pps), fps = LC.fps(), minor = step >= 1 ? step / (step >= 10 ? 5 : step === 15 ? 3 : 2) : step / (Math.round(step * fps) % 5 === 0 ? 5 : Math.round(step * fps) % 2 === 0 ? 2 : 1);
    const t0 = Math.floor(xToT(0) / minor) * minor, t1 = xToT(W);
    x.fillStyle = '#5a6f88'; x.font = '10px Segoe UI'; x.textBaseline = 'top';
    for (let t = t0; t <= t1; t += minor) {
      const px = Math.round(tToX(t)) + .5, major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      x.fillStyle = major ? '#5a6f88' : '#9bb0c6'; x.fillRect(px - .5, major ? H - 11 : H - 6, 1, major ? 10 : 5);
      if (major && t >= 0) { x.fillStyle = '#3a4f68'; x.fillText(LC.tc(t), px + 3, 3); }
    }
    x.textBaseline = 'alphabetic';
    // markers
    P.markers.forEach(m => { const mx = tToX(m.t); if (mx < -10 || mx > W + 10) return; x.fillStyle = m.color; x.strokeStyle = 'rgba(0,0,0,.45)'; x.beginPath(); x.moveTo(mx - 5, 14); x.lineTo(mx + 5, 14); x.lineTo(mx + 5, 20); x.lineTo(mx, 25); x.lineTo(mx - 5, 20); x.closePath(); x.fill(); x.stroke(); });
    // playhead cap
    const px = Math.round(tToX(LC.playhead)) + .5;
    if (px > -8 && px < W + 8) {
      x.fillStyle = '#d9342b'; x.strokeStyle = '#7a1510'; x.beginPath(); x.moveTo(px - 6, 2); x.lineTo(px + 6, 2); x.lineTo(px + 6, H - 10); x.lineTo(px, H - 2); x.lineTo(px - 6, H - 10); x.closePath(); x.fill(); x.stroke();
      x.fillStyle = 'rgba(255,255,255,.5)'; x.fillRect(px - 5, 3, 10, 3);
    }
  }
})();
