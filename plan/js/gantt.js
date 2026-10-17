// Lumen Plan Gantt chart: canvas drawing of bars, baselines, links, data date, plus drag interactions.
(function () {
  const RH = 24, HH = 40, DAY = 86400000;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const C = window.CPM;
  let A, wrap, cv, ctx, space, tip, drag = null, hover = null;

  const t0 = () => C.parse(A.viewStart);
  const xOf = (date) => (C.parse(date) - t0()) / DAY * A.ppd;          // left edge of a day
  const dateAt = (x) => C.iso(t0() + Math.floor(x / A.ppd) * DAY);
  const rowY = i => HH + i * RH;

  function geom(a, i) {
    const x = A.S.results.get(a.id); if (!x) return null;
    const y = rowY(i), x1 = xOf(x.start), x2 = xOf(x.finish) + A.ppd;
    const mile = !x.summary && (a.dur || 0) === 0 && x.ef === x.es;
    return { x, y, x1, x2: mile ? x1 : x2, mid: y + RH / 2, mile };
  }

  function size() {
    const w = Math.max(10, wrap.clientWidth), h = Math.max(10, wrap.clientHeight), dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
    // the sticky canvas takes up layout space; pull the scroll area back so total size equals the chart
    cv.style.marginBottom = -h + 'px';
    return { w, h, dpr };
  }

  function drawHeader(g, w, sl) {
    g.fillStyle = '#eef3f9'; g.fillRect(0, 0, w, HH);
    const grad = g.createLinearGradient(0, 0, 0, HH); grad.addColorStop(0, '#fbfdff'); grad.addColorStop(.55, '#e8f0fa'); grad.addColorStop(1, '#dbe7f5');
    g.fillStyle = grad; g.fillRect(0, 0, w, HH);
    g.strokeStyle = '#a7bcd6'; g.beginPath(); g.moveTo(0, HH - .5); g.lineTo(w, HH - .5); g.moveTo(0, 19.5); g.lineTo(w, 19.5); g.stroke();
    g.font = '11px Segoe UI, Tahoma, sans-serif'; g.fillStyle = '#1e395b'; g.textBaseline = 'middle';
    const first = t0() + Math.floor(sl / A.ppd) * DAY, last = t0() + Math.ceil((sl + w) / A.ppd) * DAY;
    const top = A.ppd >= 4 ? 'month' : 'year', bot = A.ppd >= 18 ? 'day' : A.ppd >= 4 ? 'week' : A.ppd >= 1 ? 'month' : 'quarter';
    const tick = (unit, y0, y1, label) => {
      let d = new Date(first); d.setUTCHours(0, 0, 0, 0);
      if (unit === 'month') d.setUTCDate(1); if (unit === 'year') { d.setUTCMonth(0); d.setUTCDate(1); }
      if (unit === 'quarter') { d.setUTCDate(1); d.setUTCMonth(Math.floor(d.getUTCMonth() / 3) * 3); }
      if (unit === 'week') d = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY);
      while (d.getTime() <= last) {
        const n = new Date(d);
        if (unit === 'day') n.setUTCDate(n.getUTCDate() + 1); else if (unit === 'week') n.setUTCDate(n.getUTCDate() + 7);
        else if (unit === 'month') n.setUTCMonth(n.getUTCMonth() + 1); else if (unit === 'quarter') n.setUTCMonth(n.getUTCMonth() + 3); else n.setUTCFullYear(n.getUTCFullYear() + 1);
        const xa = (d - t0()) / DAY * A.ppd - sl, xb = (n - t0()) / DAY * A.ppd - sl;
        g.strokeStyle = '#c3d2e3'; g.beginPath(); g.moveTo(Math.round(xa) + .5, y0); g.lineTo(Math.round(xa) + .5, y1); g.stroke();
        const s = label(d); const tw = g.measureText(s).width;
        if (xb - xa > tw + 4) { g.save(); g.beginPath(); g.rect(Math.max(xa, 0), y0, xb - Math.max(xa, 0), y1 - y0); g.clip(); g.fillText(s, Math.max(xa, 0) + 4, (y0 + y1) / 2); g.restore(); }
        d = n;
      }
    };
    tick(top, 0, 19, d => top === 'month' ? MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear() : String(d.getUTCFullYear()));
    tick(bot, 20, HH, d => bot === 'day' ? String(d.getUTCDate()) : bot === 'week' ? d.getUTCDate() + ' ' + MON[d.getUTCMonth()] : bot === 'month' ? MON[d.getUTCMonth()][0] + (A.ppd > 2 ? MON[d.getUTCMonth()].slice(1) : '') : 'Q' + (Math.floor(d.getUTCMonth() / 3) + 1));
  }

  function barColors(a, x) {
    if (x.summary) return ['#2f3e4e', '#2f3e4e'];
    if (x.status === 'done') return ['#7f93a8', '#5d7085'];
    if (x.critical) return ['#f06a6a', '#c81e2a'];
    return ['#78b3ea', '#2d78c4'];
  }

  function linkPath(g, l, rowOf) {
    const ia = rowOf.get(l.from), ib = rowOf.get(l.to); if (ia == null || ib == null) return;
    const pa = geom(A.rows[ia], ia), pb = geom(A.rows[ib], ib); if (!pa || !pb) return;
    const type = l.type || 'FS';
    const fromEnd = type === 'FS' || type === 'FF', toStart = type === 'FS' || type === 'SS';
    const x1 = fromEnd ? pa.x2 + (pa.mile ? 5 : 0) : pa.x1 - (pa.mile ? 5 : 0), y1 = pa.mid;
    const x2 = toStart ? pb.x1 - (pb.mile ? 5 : 0) : pb.x2 + (pb.mile ? 5 : 0), y2 = pb.mid;
    const d1 = fromEnd ? 1 : -1, din = toStart ? 1 : -1;
    const a = x1 + d1 * 6, b = x2 - din * 7;
    const pts = [[x1, y1]];
    if (type === 'FS' && b >= a - 1) { pts.push([b + 3, y1], [b + 3, y2 + (y2 > y1 ? -5 : 5)]); }
    else { const ym = ib > ia ? pb.y : pb.y + RH; pts.push([a, y1], [a, ym], [b, ym], [b, y2], [x2, y2]); }
    const crit = l._driving && A.S.results.get(l.from)?.critical && A.S.results.get(l.to)?.critical;
    g.strokeStyle = crit ? '#c81e2a' : '#4c6580'; g.fillStyle = g.strokeStyle; g.lineWidth = 1;
    g.setLineDash(l._driving ? [] : [3, 3]);
    g.beginPath(); pts.forEach(([x, y], k) => k ? g.lineTo(Math.round(x) + .5, Math.round(y) + .5) : g.moveTo(Math.round(x) + .5, Math.round(y) + .5)); g.stroke(); g.setLineDash([]);
    const [ex, ey] = pts[pts.length - 1], [px, py] = pts[pts.length - 2];
    const ang = Math.atan2(ey - py, ex - px); g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex - 6 * Math.cos(ang - .45), ey - 6 * Math.sin(ang - .45)); g.lineTo(ex - 6 * Math.cos(ang + .45), ey - 6 * Math.sin(ang + .45)); g.fill();
  }

  // Draw the chart. For export pass {g, sl:0, st:0, w, h, full:true}
  function paint(g, sl, st, w, h, full) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    g.save(); g.translate(-sl, -st);
    const first = Math.max(0, Math.floor(st / RH) - 1), lastRow = Math.min(A.rows.length, Math.ceil((st + h) / RH) + 1);
    // weekends / holidays
    if (A.ppd >= 8) {
      const d0 = Math.floor(sl / A.ppd), d1 = Math.ceil((sl + w) / A.ppd);
      g.fillStyle = '#f1f3f6';
      for (let d = d0; d <= d1; d++) { const s = C.iso(t0() + d * DAY); if (!A.S.cal.isWork(s)) g.fillRect(d * A.ppd, HH, A.ppd, Math.max(h, A.rows.length * RH) + st); }
    }
    // row selection + stripes
    for (let i = first; i < lastRow; i++) {
      const a = A.rows[i]; if (!a) continue;
      if (A.sel.has(a.id)) { g.fillStyle = 'rgba(132,172,221,.22)'; g.fillRect(sl, rowY(i), w, RH); }
      g.strokeStyle = '#f0f3f7'; g.beginPath(); g.moveTo(sl, rowY(i) + RH - .5); g.lineTo(sl + w, rowY(i) + RH - .5); g.stroke();
    }
    // data date & today
    const ddx = xOf(A.P.dataDate || A.P.start);
    g.strokeStyle = '#1f6fd0'; g.setLineDash([5, 3]); g.beginPath(); g.moveTo(Math.round(ddx) + .5, HH); g.lineTo(Math.round(ddx) + .5, st + h); g.stroke(); g.setLineDash([]);
    if (A.P.mustFinish) { const mx = xOf(A.P.mustFinish) + A.ppd; g.strokeStyle = '#c81e2a'; g.beginPath(); g.moveTo(Math.round(mx) + .5, HH); g.lineTo(Math.round(mx) + .5, st + h); g.stroke(); }
    // links (behind bars)
    if (A.view.links) { const rowOf = new Map(A.rows.map((a, i) => [a.id, i])); (A.S.links || []).forEach(l => linkPath(g, l, rowOf)); }
    // bars
    g.font = '11px Segoe UI, Tahoma, sans-serif'; g.textBaseline = 'middle';
    const bl = A.view.baseline && A.baseline();
    for (let i = first; i < lastRow; i++) {
      const a = A.rows[i]; const p = a && geom(a, i); if (!p) continue;
      const x = p.x, [c1, c2] = barColors(a, x);
      const by = p.y + (bl ? 4 : 5), bh = bl ? 11 : 14;
      if (bl && bl.acts[a.id]) {
        const b = bl.acts[a.id], bx1 = xOf(b.start), bx2 = b.dur === 0 && !x.summary ? bx1 : xOf(b.finish) + A.ppd;
        g.fillStyle = '#e8b923'; g.strokeStyle = '#a07c0c';
        if (bx2 > bx1) { g.fillRect(bx1, p.y + 17, bx2 - bx1, 4); g.strokeRect(bx1 + .5, p.y + 17.5, bx2 - bx1 - 1, 3); }
        else { g.beginPath(); g.moveTo(bx1, p.y + 15); g.lineTo(bx1 + 3, p.y + 19); g.lineTo(bx1, p.y + 23); g.lineTo(bx1 - 3, p.y + 19); g.fill(); }
      }
      if (x.summary) {
        g.fillStyle = c1; g.fillRect(p.x1, p.y + 7, p.x2 - p.x1, 5);
        [p.x1, p.x2].forEach(ex => { g.beginPath(); g.moveTo(ex - 4, p.y + 7); g.lineTo(ex + 4, p.y + 7); g.lineTo(ex, p.y + 15); g.fill(); });
      } else if (p.mile) {
        g.fillStyle = c2; g.beginPath(); g.moveTo(p.x1, p.mid - 7); g.lineTo(p.x1 + 7, p.mid); g.lineTo(p.x1, p.mid + 7); g.lineTo(p.x1 - 7, p.mid); g.closePath(); g.fill();
      } else {
        const gr = g.createLinearGradient(0, by, 0, by + bh); gr.addColorStop(0, c1); gr.addColorStop(1, c2);
        g.fillStyle = gr; g.fillRect(p.x1, by, Math.max(2, p.x2 - p.x1), bh);
        if (a.pct > 0 && a.pct < 100) { g.fillStyle = 'rgba(15,35,60,.45)'; g.fillRect(p.x1, by + bh / 2 - 2, (p.x2 - p.x1) * a.pct / 100, 4); }
        // remaining float as a thin tail
        if (A.view.float && x.tf > 0 && x.status !== 'done') { const lx = xOf(x.lateFinish) + A.ppd; g.strokeStyle = '#7f9bb8'; g.beginPath(); g.moveTo(p.x2, by + bh - .5); g.lineTo(lx, by + bh - .5); g.moveTo(lx - .5, by + bh - 4); g.lineTo(lx - .5, by + bh); g.stroke(); }
        g.strokeStyle = 'rgba(15,35,60,.55)'; g.strokeRect(p.x1 + .5, by + .5, Math.max(1, p.x2 - p.x1 - 1), bh - 1);
        if (a.leveledStart) { g.fillStyle = '#7a4fc0'; g.fillRect(p.x1, by - 2, 6, 2); }
      }
      // label
      const label = A.view.labels === 'res' ? (a.resources || []).map(r => r.res).join(', ') : a.name;
      if (label) { g.fillStyle = x.summary ? '#1e2c3a' : '#24313f'; g.fillText(label, (p.mile ? p.x1 + 10 : p.x2 + 6) + (A.sel.has(a.id) && !x.summary && !full ? 14 : 0), p.mid); }
      if (A.sel.has(a.id) && !x.summary && !full) { // link handle
        g.fillStyle = '#fff'; g.strokeStyle = '#2d78c4'; g.beginPath(); g.arc((p.mile ? p.x1 + 7 : p.x2) + 9, p.mid, 4, 0, 7); g.fill(); g.stroke();
      }
    }
    if (drag && drag.kind === 'link' && drag.cur) { g.strokeStyle = '#2d78c4'; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(drag.sx, drag.sy); g.lineTo(drag.cur[0], drag.cur[1]); g.stroke(); g.setLineDash([]); }
    if (drag && drag.ghost) { g.fillStyle = 'rgba(45,120,196,.25)'; g.strokeStyle = '#2d78c4'; g.fillRect(drag.ghost[0], drag.ghost[1], drag.ghost[2], 14); g.strokeRect(drag.ghost[0] + .5, drag.ghost[1] + .5, drag.ghost[2] - 1, 13); }
    g.restore();
    g.save(); g.translate(-sl, 0); g.restore();
    drawHeader(g, w, sl);
  }

  function draw() {
    if (!A || !A.S || A.S.error) { if (ctx) { const { w, h, dpr } = size(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); } return; }
    const total = totalWidth();
    space.style.width = total + 'px'; space.style.height = (HH + A.rows.length * RH + 40) + 'px';
    const { w, h, dpr } = size();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint(ctx, wrap.scrollLeft, wrap.scrollTop, w, h, false);
  }
  const totalWidth = () => xOf(A.viewEnd) + 200;

  // ---------- interaction ----------
  function hit(ev) {
    const r = cv.getBoundingClientRect(); const mx = ev.clientX - r.left + wrap.scrollLeft, my = ev.clientY - r.top + wrap.scrollTop;
    if (ev.clientY - r.top < HH) return { mx, my, header: true };
    const i = Math.floor((my - HH) / RH), a = A.rows[i]; if (!a) return { mx, my, i };
    const p = geom(a, i); const res = { mx, my, i, a, p };
    if (!p || p.x.summary) return res;
    const hx = (p.mile ? p.x1 + 7 : p.x2) + 9;
    if (A.sel.has(a.id) && Math.hypot(mx - hx, my - p.mid) <= 6) res.zone = 'link';
    else if (!p.mile && Math.abs(mx - p.x2) <= 4 && my >= p.y + 3 && my <= p.y + 21) res.zone = 'end';
    else if (mx >= p.x1 - (p.mile ? 7 : 0) && mx <= p.x2 + (p.mile ? 7 : 0) && my >= p.y + 3 && my <= p.y + 21) res.zone = 'bar';
    return res;
  }
  function showTip(ev, h) {
    if (!h || !h.a || !h.p || h.zone == null && !(h.p && h.mx >= h.p.x1 - 7 && h.mx <= h.p.x2 + 7)) { tip.style.display = 'none'; return; }
    const a = h.a, x = h.p.x;
    const res = (a.resources || []).map(r => `${r.res}×${r.units}`).join(', ');
    tip.innerHTML = `<b>${Aero.esc(a.id)} — ${Aero.esc(a.name)}</b><br>${x.start} → ${x.finish} · ${x.summary ? x.dur : a.dur} d` +
      (x.summary ? '' : `<br>Total float ${x.tf} d · free float ${x.ff} d${x.critical ? ' · <span style="color:#c81e2a">critical</span>' : ''}`) +
      (a.pct ? `<br>${Math.round(x.summary ? x.pct : a.pct)}% complete` : '') + (res ? `<br>${Aero.esc(res)}` : '') +
      (a.constraint && a.constraint.date ? `<br>Constraint: ${a.constraint.type} ${a.constraint.date}` : '');
    tip.style.display = 'block'; tip.style.left = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8) + 'px'; tip.style.top = (ev.clientY + 16) + 'px';
  }
  function onDown(ev) {
    if (ev.button !== 0) return;
    const h = hit(ev); if (h.header || !h.a) return;
    A.select(h.a.id, ev.ctrlKey ? 'toggle' : ev.shiftKey ? 'range' : 'one');
    if (h.zone === 'link') drag = { kind: 'link', id: h.a.id, sx: (h.p.mile ? h.p.x1 + 7 : h.p.x2) + 9, sy: h.p.mid };
    else if (h.zone === 'end') drag = { kind: 'end', id: h.a.id, p: h.p, x0: h.mx };
    else if (h.zone === 'bar' && !h.p.x.summary && h.p.x.status === 'planned') drag = { kind: 'move', id: h.a.id, p: h.p, x0: h.mx };
    else return;
    ev.preventDefault();
    const move = e => {
      const r = cv.getBoundingClientRect(), mx = e.clientX - r.left + wrap.scrollLeft, my = e.clientY - r.top + wrap.scrollTop;
      if (drag.kind === 'link') drag.cur = [mx, my];
      else if (drag.kind === 'end') { const x2 = Math.max(drag.p.x1 + A.ppd, mx); drag.ghost = [drag.p.x1, drag.p.y + 5, x2 - drag.p.x1]; drag.to = dateAt(x2 - 1); }
      else { const dx = mx - drag.x0, days = Math.round(dx / A.ppd); drag.ghost = [drag.p.x1 + days * A.ppd, drag.p.y + 5, Math.max(10, drag.p.x2 - drag.p.x1)]; drag.days = days; }
      draw();
    };
    const up = e => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      const d = drag; drag = null;
      if (d.kind === 'link') {
        const h2 = hit(e); if (h2.a && h2.a.id !== d.id) A.addLink(d.id, h2.a.id, 'FS', 0); else draw();
      } else if (d.kind === 'end' && d.to) {
        const cal = A.S.cal, x = A.S.results.get(d.id), nd = Math.max(1, cal.idxFinish(d.to) + 1 - x.es);
        A.commit('Change duration', P => { P.activities.find(a => a.id === d.id).dur = nd; });
      } else if (d.kind === 'move' && d.days) {
        const target = C.iso(C.parse(A.S.results.get(d.id).start) + d.days * DAY);
        A.commit('Constrain start', P => { const a = P.activities.find(a => a.id === d.id); a.constraint = { type: 'SNET', date: target }; });
        Aero.toast(`Start No Earlier Than ${target} set — activities in Lumen Plan are positioned by logic and constraints.`);
      } else draw();
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }

  function attach(app) {
    A = app; wrap = document.getElementById('ganttWrap'); cv = document.getElementById('gantt'); space = document.getElementById('ganttSpace'); tip = document.getElementById('tip');
    ctx = cv.getContext('2d');
    wrap.addEventListener('scroll', () => { A.onGanttScroll(wrap.scrollTop); draw(); });
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('dblclick', e => { const h = hit(e); if (h.a) A.openDetails(); });
    cv.addEventListener('pointermove', e => { if (drag) return; const h = hit(e); cv.style.cursor = h.zone === 'end' ? 'ew-resize' : h.zone === 'link' ? 'crosshair' : h.zone === 'bar' ? 'grab' : 'default'; showTip(e, h); });
    cv.addEventListener('pointerleave', () => tip.style.display = 'none');
    wrap.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); A.zoomBy(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - wrap.getBoundingClientRect().left); }, { passive: false });
    new ResizeObserver(() => draw()).observe(wrap);
  }
  function scrollToDate(date) { wrap.scrollLeft = Math.max(0, xOf(date) - 60); }

  // Full chart image with an activity column, for Export → PNG
  function exportCanvas() {
    const colW = 300, w = Math.min(16000, totalWidth()), h = HH + A.rows.length * RH + 8;
    const c = document.createElement('canvas'); c.width = colW + w; c.height = h; const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    g.save(); g.translate(colW, 0); g.beginPath(); g.rect(0, 0, w, h); g.clip(); paint(g, 0, 0, w, h, true); g.restore();
    g.fillStyle = '#e8f0fa'; g.fillRect(0, 0, colW, HH); g.fillStyle = '#1e395b'; g.font = '600 12px Segoe UI, Tahoma, sans-serif'; g.textBaseline = 'middle';
    g.fillText(A.P.name || 'Project', 8, 13); g.font = '11px Segoe UI, Tahoma, sans-serif'; g.fillText('Finish ' + A.S.finishDate + (A.P.dataDate ? ' · data date ' + A.P.dataDate : ''), 8, 30);
    A.rows.forEach((a, i) => { const x = A.S.results.get(a.id); g.font = (x.summary ? '600 ' : '') + '11.5px Segoe UI, Tahoma, sans-serif'; g.fillStyle = x.critical && !x.summary ? '#b4141e' : '#1d2733';
      g.save(); g.beginPath(); g.rect(0, rowY(i), colW - 6, RH); g.clip(); g.fillText(`${a.id}  ${a.name}`, 8 + (a.level || 0) * 12, rowY(i) + RH / 2); g.restore();
      g.strokeStyle = '#f0f3f7'; g.beginPath(); g.moveTo(0, rowY(i) + RH - .5); g.lineTo(colW, rowY(i) + RH - .5); g.stroke(); });
    g.strokeStyle = '#a7bcd6'; g.beginPath(); g.moveTo(colW - .5, 0); g.lineTo(colW - .5, h); g.stroke();
    return c;
  }

  window.Gantt = { attach, draw, scrollToDate, exportCanvas, RH, HH, xOf: d => xOf(d), scrollLeft: () => wrap.scrollLeft };
})();
