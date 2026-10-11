'use strict';
/* Lumen Motion — Graph Editor (value & speed graphs with draggable keyframes and bezier tangents),
   keyframe velocity dialog and auto-bezier motion paths. */
(function () {
  const LM = window.LM, st = LM.st, TL = LM.tl;
  const cv = TL.graphCanvas, G = LM.graph = {};
  const DIMC = ['#e0433a', '#3aa845', '#2f7fe0'];
  let dpr = 1, Wd = 0, Hd = 0, items = [], range = [0, 1], hits = [];
  const NUM = new Set(['num', 'pct', 'angle', 'vec2', 'vec2pct']);

  G.resize = () => {
    if (!TL.graph) return;
    const head = document.querySelector('.tl-colhead'), main = document.querySelector('.tl-main');
    const top = head.offsetHeight, left = TL.LW;
    Object.assign(cv.style, { left: left + 'px', top: top + 'px', width: `calc(100% - ${left}px)`, height: `calc(100% - ${top}px)` });
    dpr = devicePixelRatio || 1; Wd = main.clientWidth - left; Hd = main.clientHeight - top;
    cv.width = Math.max(1, Math.round(Wd * dpr)); cv.height = Math.max(1, Math.round(Hd * dpr));
    G.draw();
  };
  function collect() {
    const c = LM.comp(); if (!c) return [];
    let out = [];
    c.layers.forEach(L => LM.leaves(L).forEach(n => { if (NUM.has(n.type) && LM.animated(n.p) && st.selProps.has(L.id + '|' + n.id)) out.push({ L, n }); }));
    if (!out.length) LM.selLayers().forEach(L => LM.leaves(L).forEach(n => { if (NUM.has(n.type) && LM.animated(n.p)) out.push({ L, n }); }));
    return out;
  }
  const dims = v => Array.isArray(v) ? v.length : 1;
  const comp = (v, d) => Array.isArray(v) ? v[d] : v;
  const mag = (a, b) => Array.isArray(a) ? Math.hypot(...a.map((x, i) => b[i] - x)) : Math.abs(b - a);
  function speedAt(it, t) { const h = 1 / 240, a = LM.rawValue(it.n.p, t - it.L.start - h), b = LM.rawValue(it.n.p, t - it.L.start + h); return mag(a, b) / (2 * h); }
  const X = t => TL.x(t);
  const Y = v => Hd - 18 - (v - range[0]) / ((range[1] - range[0]) || 1) * (Hd - 36);
  const Vof = y => range[0] + (Hd - 18 - y) / (Hd - 36) * (range[1] - range[0]);

  G.draw = () => {
    if (!TL.graph || !Wd) return;
    const x = cv.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, Wd, Hd);
    x.fillStyle = '#fbfcfe'; x.fillRect(0, 0, Wd, Hd);
    items = collect(); hits = [];
    if (!items.length) { x.fillStyle = '#5b6b7c'; x.font = '13px "Segoe UI"'; x.textAlign = 'center'; x.fillText('Select an animated property (click its name in the timeline) to see its curves here.', Wd / 2, Hd / 2); x.textAlign = 'left'; return; }
    const speed = TL.graphMode === 'speed', c = LM.comp();
    // vertical range
    let lo = Infinity, hi = -Infinity; const N = Math.max(40, Math.round(Wd / 3));
    items.forEach(it => {
      const k = it.n.p.k;
      for (let i = 0; i <= N; i++) { const t = TL.v0 + (TL.v1 - TL.v0) * i / N; if (speed) { const s = speedAt(it, t); lo = Math.min(lo, 0); hi = Math.max(hi, s); } else { const v = LM.rawValue(it.n.p, t - it.L.start); for (let d = 0; d < dims(v); d++) { lo = Math.min(lo, comp(v, d)); hi = Math.max(hi, comp(v, d)); } } }
      if (!speed) k.forEach(q => { for (let d = 0; d < dims(q.v); d++) { lo = Math.min(lo, comp(q.v, d)); hi = Math.max(hi, comp(q.v, d)); } });
    });
    if (!(hi - lo > 1e-6)) { hi += 1; lo -= 1; }
    const pad = (hi - lo) * .08; range = [lo - pad, hi + pad];
    // grid
    x.strokeStyle = '#e3eaf3'; x.lineWidth = 1; x.fillStyle = '#7b8da3'; x.font = '10px "Segoe UI"';
    const span = range[1] - range[0], step = Math.pow(10, Math.floor(Math.log10(span / 4))) * ([1, 2, 5].find(m => span / (Math.pow(10, Math.floor(Math.log10(span / 4))) * m) <= 8) || 10);
    for (let v = Math.ceil(range[0] / step) * step; v <= range[1]; v += step) { const y = Math.round(Y(v)) + .5; x.beginPath(); x.moveTo(0, y); x.lineTo(Wd, y); x.stroke(); x.fillText((Math.round(v * 100) / 100) + (speed ? '/s' : ''), 4, y - 2); }
    const fs = 1 / c.fps, pxs = TL.trackW() / (TL.v1 - TL.v0); if (pxs * fs > 6) { x.strokeStyle = '#f0f4f9'; for (let t = Math.ceil(TL.v0 / fs) * fs; t < TL.v1; t += fs) { const px = Math.round(X(t)) + .5; x.beginPath(); x.moveTo(px, 0); x.lineTo(px, Hd); x.stroke(); } }
    // curves
    items.forEach((it, ii) => {
      const p = it.n.p, L = it.L, nd = speed ? 1 : dims(p.k[0].v);
      for (let d = 0; d < nd; d++) {
        x.strokeStyle = nd === 1 && !speed ? ['#2f7fe0', '#d0782a', '#7b3fd0', '#2a9a6a'][ii % 4] : speed ? ['#2f7fe0', '#d0782a', '#7b3fd0'][ii % 3] : DIMC[d]; x.lineWidth = 1.6;
        x.beginPath();
        for (let i = 0; i <= N * 2; i++) { const t = TL.v0 + (TL.v1 - TL.v0) * i / (N * 2); const v = speed ? speedAt(it, t) : comp(LM.rawValue(p, t - L.start), d); const px = X(t), py = Y(v); i ? x.lineTo(px, py) : x.moveTo(px, py); }
        x.stroke();
      }
      // label
      x.fillStyle = '#1e395b'; x.font = '11px "Segoe UI"'; x.fillText(`${L.name} › ${it.n.label}`, 40, 14 + ii * 14);
      // keyframes + handles
      p.k.forEach((k, ki) => {
        const sel = st.selKeys.has(k), next = p.k[ki + 1], prev = p.k[ki - 1];
        for (let d = 0; d < nd; d++) {
          const kv = speed ? null : comp(k.v, d);
          const kx = X(k.t + L.start);
          const kyIn = speed ? Y(prev ? speedAt(it, k.t + L.start - 1e-3) : 0) : Y(kv), kyOut = speed ? Y(next ? speedAt(it, k.t + L.start + 1e-3) : 0) : Y(kv);
          // handles
          if (sel) {
            const hs = [];
            if (next && k.o !== 'hold') hs.push({ side: 'o', a: k, b: next });
            if (prev && prev.o !== 'hold') hs.push({ side: 'i', a: prev, b: k });
            hs.forEach(h => {
              const cc = LM.segCtrl(h.a, h.b), dt = h.b.t - h.a.t;
              let hx, hy, ky;
              if (speed) {
                const dv = mag(h.a.v, h.b.v);
                if (h.side === 'o') { hx = X(h.a.t + L.start + cc[0] * dt); hy = Y(cc[0] > 1e-6 ? cc[1] / cc[0] * dv / dt : 0); ky = kyOut; }
                else { const inf = 1 - cc[2]; hx = X(h.b.t + L.start - inf * dt); hy = Y(inf > 1e-6 ? (1 - cc[3]) / inf * dv / dt : 0); ky = kyIn; }
              } else {
                const av = comp(h.a.v, d), bv = comp(h.b.v, d), dv = bv - av;
                if (h.side === 'o') { hx = X(h.a.t + L.start + cc[0] * dt); hy = Y(av + cc[1] * dv); } else { hx = X(h.a.t + L.start + cc[2] * dt); hy = Y(av + cc[3] * dv); }
                ky = Y(kv);
              }
              x.strokeStyle = '#e0a020'; x.lineWidth = 1; x.beginPath(); x.moveTo(kx, ky); x.lineTo(hx, hy); x.stroke();
              x.fillStyle = '#ffd24a'; x.beginPath(); x.arc(hx, hy, 4, 0, 7); x.fill(); x.stroke();
              hits.push({ kind: 'handle', x: hx, y: hy, it, h, d, L });
            });
          }
          const ky = speed ? (kyIn + kyOut) / 2 : Y(kv);
          x.fillStyle = sel ? '#ffd24a' : '#fff'; x.strokeStyle = '#1e395b'; x.lineWidth = 1.2;
          if (speed) { x.fillRect(kx - 3.5, kyIn - 3.5, 7, 7); x.strokeRect(kx - 3.5, kyIn - 3.5, 7, 7); if (Math.abs(kyIn - kyOut) > 1) { x.fillRect(kx - 3.5, kyOut - 3.5, 7, 7); x.strokeRect(kx - 3.5, kyOut - 3.5, 7, 7); } }
          else { x.fillRect(kx - 4, ky - 4, 8, 8); x.strokeRect(kx - 4, ky - 4, 8, 8); }
          hits.push({ kind: 'key', x: kx, y: speed ? kyOut : ky, it, k, d, L });
        }
      });
    });
  };
  G.drawCTI = () => { };
  G.hitList = () => hits;

  cv.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    const hit = hits.slice().reverse().find(h => Math.hypot(h.x - px, h.y - py) < 7);
    try { cv.setPointerCapture(e.pointerId); } catch (_) { }
    const speed = TL.graphMode === 'speed', c = LM.comp();
    if (!hit) { // marquee or deselect
      const box = document.querySelector('.tl-marquee'), mr = document.querySelector('.tl-main').getBoundingClientRect(); let moved = false;
      const mv = ev => { moved = true; const x1 = Math.min(e.clientX, ev.clientX), x2 = Math.max(e.clientX, ev.clientX), y1 = Math.min(e.clientY, ev.clientY), y2 = Math.max(e.clientY, ev.clientY); Object.assign(box.style, { left: x1 - mr.left + 'px', top: y1 - mr.top + 'px', width: x2 - x1 + 'px', height: y2 - y1 + 'px' }); box.hidden = false; st.selKeys.clear(); hits.forEach(h => { if (h.kind === 'key' && h.x + r.left >= x1 && h.x + r.left <= x2 && h.y + r.top >= y1 && h.y + r.top <= y2) st.selKeys.add(h.k); }); G.draw(); };
      const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); box.hidden = true; if (!moved) { st.selKeys.clear(); } TL.markKeys(); };
      cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); return;
    }
    if (hit.kind === 'key') {
      if (e.shiftKey) st.selKeys.has(hit.k) ? st.selKeys.delete(hit.k) : st.selKeys.add(hit.k); else if (!st.selKeys.has(hit.k)) { st.selKeys.clear(); st.selKeys.add(hit.k); }
      TL.markKeys();
      const { k, it, d, L } = hit, t0 = k.t, v0 = LM.clone(k.v), y0 = py, x0 = px; let moved = false;
      const mv = ev => {
        const qx = ev.clientX - r.left, qy = ev.clientY - r.top; if (!moved && Math.hypot(qx - x0, qy - y0) < 3) return; moved = true;
        const lockT = ev.shiftKey && Math.abs(qy - y0) > Math.abs(qx - x0), lockV = ev.shiftKey && !lockT;
        if (!lockT) { k.t = Math.round((t0 + (TL.t(qx) - TL.t(x0))) * c.fps) / c.fps; it.n.p.k.sort((a, b) => a.t - b.t); }
        if (!speed && !lockV) { const nv = Vof(qy) - Vof(y0); if (Array.isArray(v0)) { const v = v0.slice(); v[d] = v0[d] + nv; k.v = v; } else k.v = v0 + nv; }
        LM.touch(); G.draw(); TL.layoutTracks();
      };
      const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); if (moved) LM.commit('Edit Keyframe'); };
      cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up); return;
    }
    // handle drag
    const { h, d, L, it } = hit, dt = h.b.t - h.a.t;
    const mv = ev => {
      const qx = ev.clientX - r.left, qy = ev.clientY - r.top, t = TL.t(qx) - L.start;
      if (h.side === 'o') { h.a.o = 'bezier'; if (!h.a.eo) h.a.eo = [.333333, 0]; } else { h.b.i = 'bezier'; if (!h.b.ei) h.b.ei = [.333333, 0]; }
      if (speed) {
        const dv = mag(h.a.v, h.b.v), sp = Math.max(0, Vof(qy));
        if (h.side === 'o') { const inf = Math.max(.01, Math.min(1, (t - h.a.t) / dt)); h.a.eo = [inf, dv > 1e-9 ? sp * inf * dt / dv : 0]; }
        else { const inf = Math.max(.01, Math.min(1, (h.b.t - t) / dt)); h.b.ei = [inf, dv > 1e-9 ? sp * inf * dt / dv : 0]; }
      } else {
        const av = comp(h.a.v, d), bv = comp(h.b.v, d), dv = bv - av, v = Vof(qy);
        if (h.side === 'o') { const inf = Math.max(.01, Math.min(1, (t - h.a.t) / dt)); h.a.eo = [inf, Math.abs(dv) > 1e-9 ? (v - av) / dv : h.a.eo[1]]; }
        else { const inf = Math.max(.01, Math.min(1, (h.b.t - t) / dt)); h.b.ei = [inf, Math.abs(dv) > 1e-9 ? (bv - v) / dv : h.b.ei[1]]; }
      }
      // keep the opposite handle of a bezier key continuous unless Alt is held
      void it; LM.touch(); G.draw();
    };
    const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); LM.commit('Edit Bezier Handle'); };
    cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
  });
  cv.addEventListener('wheel', e => { /* let timeline handle zoom/scroll */ }, { passive: true });
  LM.on('structure', () => G.draw()); LM.on('values', () => G.draw()); LM.on('selkeys', () => G.draw());
  LM.on('select', () => G.draw());

  /* ---------- keyframe velocity dialog ---------- */
  LM.keyVelocityDialog = () => {
    const refs = LM.selectedKeyRefs(); if (!refs.length) return Aero.toast('Select keyframes first');
    const k0 = refs[0].k;
    Aero.dialog({
      title: 'Keyframe Velocity', instruction: 'Influence controls how far the curve “reaches”; speed 0 gives a smooth ease.',
      fields: [{ key: 'inInf', label: 'Incoming influence %', type: 'number', value: Math.round((k0.ei?.[0] ?? .333) * 1000) / 10, min: .1, max: 100 }, { key: 'inSp', label: 'Incoming speed (units/s)', type: 'number', value: 0 },
        { key: 'outInf', label: 'Outgoing influence %', type: 'number', value: Math.round((k0.eo?.[0] ?? .333) * 1000) / 10, min: .1, max: 100 }, { key: 'outSp', label: 'Outgoing speed (units/s)', type: 'number', value: 0 }],
      onOK: v => {
        refs.forEach(({ n, k }) => {
          const ks = n.p.k, i = ks.indexOf(k), prev = ks[i - 1], next = ks[i + 1];
          if (prev) { const dt = k.t - prev.t, dv = mag(prev.v, k.v), inf = v.inInf / 100; k.i = 'bezier'; k.ei = [inf, dv > 1e-9 ? v.inSp * inf * dt / dv : 0]; }
          if (next) { const dt = next.t - k.t, dv = mag(k.v, next.v), inf = v.outInf / 100; k.o = 'bezier'; k.eo = [inf, dv > 1e-9 ? v.outSp * inf * dt / dv : 0]; }
        });
        LM.commit('Keyframe Velocity');
      }
    });
  };
  /* ---------- auto-bezier spatial tangents (smooth motion path through position keyframes) ---------- */
  LM.autoBezierPath = () => {
    const layers = new Set(LM.selectedKeyRefs().filter(r => r.n.id === 'tr.position').map(r => r.L));
    if (!layers.size) LM.selLayers().forEach(L => LM.animated(L.tr.position) && layers.add(L));
    if (!layers.size) return Aero.toast('Select a layer with animated Position');
    layers.forEach(L => { const k = L.tr.position.k; k.forEach((q, i) => { const a = k[i - 1] || q, b = k[i + 1] || q; const tx = (b.v[0] - a.v[0]) / 6, ty = (b.v[1] - a.v[1]) / 6; q.so = i < k.length - 1 ? [tx, ty] : [0, 0]; q.si = i > 0 ? [-tx, -ty] : [0, 0]; }); });
    LM.commit('Auto-Bezier Motion Path');
  };
  LM.linearPath = () => { LM.selLayers().forEach(L => (L.tr.position.k || []).forEach(q => { delete q.si; delete q.so; })); LM.commit('Linear Motion Path'); };
})();
