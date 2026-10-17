// Lumen CAD sketcher: draw a closed profile, then pin it down with geometric and dimensional constraints
// (solved by CadKernel.solveSketch) and round its corners. Dimensions accept parameter expressions.
(function () {
  const K = window.CadKernel, esc = s => Aero.esc(String(s ?? ''));
  const AX = { XY: ['X', 'Y'], XZ: ['X', 'Z'], YZ: ['Y', 'Z'] };
  const LABEL = { h: 'Horizontal', v: 'Vertical', len: 'Length', par: 'Parallel', perp: 'Perpendicular', eq: 'Equal length', ang: 'Angle', x: 'Horizontal position', y: 'Vertical position', dist: 'Distance', dx: 'Horizontal distance', dy: 'Vertical distance' };
  const GLYPH = { h: 'H', v: 'V', par: '∥', perp: '⊥', eq: '=' };
  const r2 = x => Math.round(x * 100) / 100;

  function open({ shape = {}, ev, plane = 'XY', title = 'Sketch', onOK, onCancel }) {
    let S = { pts: (shape.pts || []).map(p => [+p[0], +p[1]]), cons: JSON.parse(JSON.stringify(shape.cons || [])), fil: (shape.fil || []).slice(), hole: !!shape.hole };
    while (S.fil.length < S.pts.length) S.fil.push(null); S.fil.length = S.pts.length;
    let closed = S.pts.length >= 3, mode = closed ? 'select' : 'draw', sel = [], hover = null, info = { ok: true, dof: 0 }, cursor = null, drag = null;
    const undo = [], redo = [], snap = () => JSON.stringify({ S, closed });
    const [U, Vn] = AX[plane] || AX.XY;
    const W = 610, H = 440;
    const html = `<div class="skw"><div class="skmain"><div class="sktools" id="skTools">
        <button class="aero-btn small" data-act="draw" title="Draw a new closed profile (click points, click the first point or press Enter to close)">✎ Draw</button>
        <button class="aero-btn small" data-act="select" title="Select and drag points and lines">⬚ Select</button><span class="sep"></span>
        <button class="aero-btn small" data-act="h" title="Horizontal (H)">H</button><button class="aero-btn small" data-act="v" title="Vertical (V)">V</button>
        <button class="aero-btn small" data-act="par" title="Parallel — select two lines">∥</button><button class="aero-btn small" data-act="perp" title="Perpendicular — select two lines">⊥</button>
        <button class="aero-btn small" data-act="eq" title="Equal length — select two lines">=</button><span class="sep"></span>
        <button class="aero-btn small" data-act="len" title="Length of a line (D)">↔ Length</button><button class="aero-btn small" data-act="ang" title="Angle between two lines">∠ Angle</button>
        <button class="aero-btn small" data-act="dist" title="Distance between two points">⟷ Dist</button><button class="aero-btn small" data-act="dx" title="Horizontal distance between two points">dx</button><button class="aero-btn small" data-act="dy" title="Vertical distance between two points">dy</button>
        <button class="aero-btn small" data-act="fix" title="Lock the selected points at their position (from the origin)">⌖ Fix</button><button class="aero-btn small" data-act="fil" title="Round the selected corners">◜ Round</button><span class="sep"></span>
        <button class="aero-btn small" data-act="del" title="Delete selected points (Delete)">✕</button><button class="aero-btn small" data-act="undo" title="Undo (Ctrl+Z)">↶</button><button class="aero-btn small" data-act="redo" title="Redo (Ctrl+Y)">↷</button><button class="aero-btn small" data-act="fit" title="Fit view">⤢</button>
      </div><canvas id="skCv" width="${W}" height="${H}" style="width:${W}px;height:${H}px"></canvas>
      <div class="skstat"><span id="skDof"></span><span id="skPos" class="dim"></span></div></div>
      <div class="skside"><div class="skhint" id="skHint"></div><label class="skhole"><input type="checkbox" id="skHole" ${S.hole ? 'checked' : ''}> Cut this profile out (hole)</label>
      <div class="aero-ph" style="margin:6px -8px 0"><span class="phi"></span>Constraints<span class="right" id="skCount"></span></div><div class="skcons" id="skCons"></div></div></div>`;
    let keyH;
    const finish = ok => { window.removeEventListener('keydown', keyH, true); if (!ok) { onCancel && onCancel(); return; }
      if (!closed && S.pts.length >= 3) closed = true;
      if (S.pts.length < 3) { Aero.toast('Sketch discarded — a profile needs at least 3 points'); onCancel && onCancel(); return; }
      onOK && onOK({ type: 'sketch', hole: !!S.hole, pts: S.pts.map(p => p.map(x => Math.round(x * 1e6) / 1e6)), cons: S.cons, fil: S.fil.some(f => f != null && f !== '' && f !== 0) ? S.fil : undefined });
    };
    const dlg = Aero.dialog({ title, html, width: 960, ok: 'Finish sketch', onOK: () => finish(true), onCancel: () => finish(false) });
    const box = dlg.el; box.classList.add('skbox'); const cv = box.querySelector('#skCv'), g = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr; g.scale(dpr, dpr);
    const $ = id => box.querySelector('#' + id);
    let vw = { cx: 0, cy: 0, sc: 4 };
    const X = u => W / 2 + (u - vw.cx) * vw.sc, Y = v => H / 2 - (v - vw.cy) * vw.sc, toW = (x, y) => [(x - W / 2) / vw.sc + vw.cx, -(y - H / 2) / vw.sc + vw.cy];
    function fit() {
      const P = S.pts.length ? S.pts : [[-40, -30], [40, 30]]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      P.concat([[0, 0]]).forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
      const w = Math.max(10, x1 - x0), h = Math.max(10, y1 - y0); vw = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, sc: Math.min((W - 80) / w, (H - 80) / h) };
    }
    const gridStep = () => { const target = 14 / vw.sc, p = Math.pow(10, Math.floor(Math.log10(target))); return [1, 2, 5, 10].map(k => k * p).find(s => s >= target); };
    const N = () => S.pts.length, segPts = i => [S.pts[i], S.pts[(i + 1) % N()]], nSeg = () => closed ? N() : Math.max(0, N() - 1);
    const evalOr = (e, d = NaN) => { try { return ev(e); } catch (x) { return d; } };

    // ---------- solving ----------
    function solveWith(st, extra) { try { return K.solveSketch(st.pts, st.cons.concat(extra || []), ev); } catch (e) { return { ok: false, err: e.message }; } }
    function resolve() {
      if (!closed || N() < 3) { info = { ok: true, dof: 2 * N(), open: true }; return true; }
      const r = solveWith(S); info = r; if (r.ok) S.pts = r.pts; return r.ok;
    }
    function change(fn, label) {   // apply fn to a copy; keep it only if the sketch still solves
      const before = snap(), keepSel = sel.slice(); fn();
      if (!resolve()) { const msg = info.err || 'That conflicts with the existing constraints'; const o = JSON.parse(before); S = o.S; closed = o.closed; sel = keepSel; resolve(); Aero.toast(msg); render(); return false; }
      undo.push(before); redo.length = 0; render(); return true;
    }

    // ---------- geometry helpers ----------
    const segLen = i => { const [a, b] = segPts(i); return Math.hypot(b[0] - a[0], b[1] - a[1]); };
    function hit(x, y) {
      for (let i = 0; i < N(); i++) if (Math.hypot(X(S.pts[i][0]) - x, Y(S.pts[i][1]) - y) < 7) return { k: 'p', i };
      for (let i = 0; i < nSeg(); i++) { const [a, b] = segPts(i), ax = X(a[0]), ay = Y(a[1]), bx = X(b[0]), by = Y(b[1]), dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)); if (Math.hypot(x - ax - t * dx, y - ay - t * dy) < 6) return { k: 's', i }; }
      return null;
    }
    const isSel = it => sel.some(s => s.k === it.k && s.i === it.i);
    const selP = () => sel.filter(s => s.k === 'p').map(s => s.i), selS = () => sel.filter(s => s.k === 's').map(s => s.i);
    function deletePoints(ids) {
      if (N() - ids.length < 3 && closed) { Aero.toast('A closed profile needs at least 3 points'); return; }
      change(() => {
        const n = N(), drop = new Set(ids), newIdx = []; let k = 0; for (let i = 0; i < n; i++) newIdx.push(drop.has(i) ? -1 : k++);
        // constraints on a removed point, or on a line touching one, go away
        S.cons = S.cons.filter(c => (c.p || []).every(i => !drop.has(i)) && (c.s || []).every(i => !drop.has(i) && !drop.has((i + 1) % n)));
        S.cons.forEach(c => { if (c.p) c.p = c.p.map(i => newIdx[i]); if (c.s) c.s = c.s.map(i => newIdx[i]); });
        S.pts = S.pts.filter((_, i) => !drop.has(i)); S.fil = S.fil.filter((_, i) => !drop.has(i)); sel = [];
      });
    }
    function splitSeg(i, at) {
      change(() => {
        const n = N(); S.cons = S.cons.filter(c => !(c.s || []).includes(i));
        S.cons.forEach(c => { if (c.p) c.p = c.p.map(q => q > i ? q + 1 : q); if (c.s) c.s = c.s.map(q => q > i ? q + 1 : q); });
        S.pts.splice(i + 1, 0, at); S.fil.splice(i + 1, 0, null); sel = [{ k: 'p', i: i + 1 }]; void n;
      });
    }

    // ---------- constraint commands ----------
    function addCons(t) {
      const P = selP(), Sg = selS();
      const need = { h: [0, 1], v: [0, 1], len: [0, 1], par: [0, 2], perp: [0, 2], eq: [0, 2], ang: [0, 2], dist: [2, 0], dx: [2, 0], dy: [2, 0] }[t];
      if (t === 'h' || t === 'v') {
        if (Sg.length >= 1 && !P.length) return change(() => Sg.forEach(i => S.cons.push({ t, s: [i] })));
        if (P.length === 2 && !Sg.length) return change(() => S.cons.push({ t: t === 'h' ? 'dy' : 'dx', p: P, v: 0, sg: 1 }));   // two points level / plumb
        return Aero.toast(`Select one or more lines (or two points) for ${LABEL[t]}`);
      }
      if (t === 'fix') { if (!P.length) return Aero.toast('Select one or more points to fix'); return change(() => P.forEach(i => { S.cons.push({ t: 'x', p: [i], v: r2(S.pts[i][0]) }, { t: 'y', p: [i], v: r2(S.pts[i][1]) }); })); }
      if (t === 'fil') { if (!P.length) return Aero.toast('Select the corner points to round'); return change(() => P.forEach(i => S.fil[i] = S.fil[i] || 2)); }
      if (!need || P.length !== need[0] || Sg.length !== need[1]) return Aero.toast(`${LABEL[t]}: select ${need[0] ? need[0] + ' point' + (need[0] > 1 ? 's' : '') : need[1] + ' line' + (need[1] > 1 ? 's' : '')}`);
      change(() => {
        if (t === 'len') S.cons.push({ t, s: Sg, v: r2(segLen(Sg[0])) });
        else if (t === 'par' || t === 'perp' || t === 'eq') S.cons.push({ t, s: Sg });
        else if (t === 'ang') {
          const [s0, s1] = Sg, n = N(), c = { t, s: [s0, s1] }; if (s1 === (s0 + 1) % n) c.ra = true; else if (s0 === (s1 + 1) % n) c.rb = true;
          const d = i => { const [a, b] = segPts(i); return [b[0] - a[0], b[1] - a[1]]; }, a = d(s0).map(x => c.ra ? -x : x), b = d(s1).map(x => c.rb ? -x : x);
          const ang = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) * 180 / Math.PI; c.sg = ang < 0 ? -1 : 1; c.v = r2(Math.abs(ang)); S.cons.push(c);
        } else {
          const [a, b] = P.map(i => S.pts[i]);
          if (t === 'dist') S.cons.push({ t, p: P, v: r2(Math.hypot(b[0] - a[0], b[1] - a[1])) });
          else { const d = t === 'dx' ? b[0] - a[0] : b[1] - a[1]; S.cons.push({ t, p: P, v: r2(Math.abs(d)), sg: d < 0 ? -1 : 1 }); }
        }
      }) && focusLast();
    }
    function focusLast() { const ins = box.querySelectorAll('#skCons input[data-ci]'); const last = ins[ins.length - 1]; if (last) { last.focus(); last.select(); } }
    function act(a) {
      if (a === 'draw') { if (N()) { change(() => { S = { pts: [], cons: [], fil: [], hole: S.hole }; closed = false; sel = []; }); Aero.toast('Profile cleared — draw a new one (Ctrl+Z brings the old one back)'); } mode = 'draw'; render(); return; }
      if (a === 'select') { if (mode === 'draw' && N() >= 3) closeLoop(); mode = 'select'; render(); return; }
      if (a === 'del') { const P = selP(); if (P.length) deletePoints(P); else Aero.toast('Select points to delete (delete a constraint with its ✕)'); return; }
      if (a === 'undo') return doUndo(); if (a === 'redo') return doRedo(); if (a === 'fit') { fit(); render(); return; }
      addCons(a);
    }
    function doUndo() { if (!undo.length) return; redo.push(snap()); const o = JSON.parse(undo.pop()); S = o.S; closed = o.closed; mode = closed ? 'select' : 'draw'; sel = []; resolve(); render(); }
    function doRedo() { if (!redo.length) return; undo.push(snap()); const o = JSON.parse(redo.pop()); S = o.S; closed = o.closed; mode = closed ? 'select' : 'draw'; sel = []; resolve(); render(); }

    // ---------- drawing a profile ----------
    function snapPoint(x, y, alt) {
      for (let i = 0; i < N(); i++) if (Math.hypot(X(S.pts[i][0]) - x, Y(S.pts[i][1]) - y) < 8) return { p: S.pts[i].slice(), onPoint: i };
      let [u, v] = toW(x, y); if (!alt) { const st = gridStep(); u = Math.round(u / st) * st; v = Math.round(v / st) * st; }
      let hv = null; const last = S.pts[N() - 1];
      if (last) { const dx = u - last[0], dy = v - last[1], a = Math.abs(Math.atan2(dy, dx)) * 180 / Math.PI; if (Math.hypot(dx, dy) > 1e-9) { if (a < 4 || a > 176) { v = last[1]; hv = 'h'; } else if (Math.abs(a - 90) < 4) { u = last[0]; hv = 'v'; } } }
      return { p: [r2(u), r2(v)], hv };
    }
    function addDrawPoint(sp) {
      if (sp.onPoint === 0 && N() >= 3) return closeLoop();
      if (sp.onPoint != null) return;
      const before = snap(); S.pts.push(sp.p); S.fil.push(null);
      if (sp.hv && N() >= 2) S.cons.push({ t: sp.hv, s: [N() - 2] });
      if (N() === 1 && Math.abs(sp.p[0]) < 1e-9 && Math.abs(sp.p[1]) < 1e-9) S.cons.push({ t: 'x', p: [0], v: 0 }, { t: 'y', p: [0], v: 0 });   // started on the origin: anchor it
      undo.push(before); redo.length = 0; render();
    }
    function closeLoop() {
      if (N() < 3) { Aero.toast('Click at least 3 points first'); return; }
      change(() => { const a = S.pts[N() - 1], b = S.pts[0]; if (Math.abs(a[1] - b[1]) < 1e-9) S.cons.push({ t: 'h', s: [N() - 1] }); else if (Math.abs(a[0] - b[0]) < 1e-9) S.cons.push({ t: 'v', s: [N() - 1] }); closed = true; });
      mode = 'select'; render();
    }

    // ---------- rendering ----------
    const outSign = () => closed && K.area2(S.pts) > 0 ? -1 : 1;   // left normal points inside a CCW profile
    function consAnchor(c) {   // where to draw a constraint's label
      const o = outSign(), mid = i => { const [a, b] = segPts(i), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, -o * (b[1] - a[1]) / L, o * (b[0] - a[0]) / L]; };
      if (c.s) return c.s.map(mid);
      return c.p.length === 1 ? [[S.pts[c.p[0]][0], S.pts[c.p[0]][1], 0, 0]] : [[(S.pts[c.p[0]][0] + S.pts[c.p[1]][0]) / 2, (S.pts[c.p[0]][1] + S.pts[c.p[1]][1]) / 2, 0, 0]];
    }
    function render() {
      g.clearRect(0, 0, W, H); g.fillStyle = '#fbfdff'; g.fillRect(0, 0, W, H);
      const st = gridStep(), [u0, v1] = toW(0, 0), [u1, v0] = toW(W, H);
      g.lineWidth = 1;
      for (let k = Math.ceil(u0 / st); k * st <= u1; k++) { g.strokeStyle = k % 5 ? '#eef3f8' : '#dbe5ef'; g.beginPath(); g.moveTo(Math.round(X(k * st)) + .5, 0); g.lineTo(Math.round(X(k * st)) + .5, H); g.stroke(); }
      for (let k = Math.ceil(v0 / st); k * st <= v1; k++) { g.strokeStyle = k % 5 ? '#eef3f8' : '#dbe5ef'; g.beginPath(); g.moveTo(0, Math.round(Y(k * st)) + .5); g.lineTo(W, Math.round(Y(k * st)) + .5); g.stroke(); }
      g.strokeStyle = 'rgba(208,32,42,.55)'; g.beginPath(); g.moveTo(0, Y(0)); g.lineTo(W, Y(0)); g.stroke(); g.strokeStyle = 'rgba(30,150,60,.6)'; g.beginPath(); g.moveTo(X(0), 0); g.lineTo(X(0), H); g.stroke();
      g.fillStyle = '#7b8a9a'; g.font = '11px Segoe UI'; g.fillText(U, W - 14, Y(0) - 4); g.fillText(Vn, X(0) + 4, 12);
      // filled (rounded) profile
      let rounded = false;
      if (closed && N() >= 3) {
        let L = S.pts; try { L = K.roundCorners(S.pts, S.fil.map(f => f == null || f === '' ? 0 : evalOr(f, 0))); } catch (e) { }
        g.beginPath(); L.forEach(([u, v], i) => i ? g.lineTo(X(u), Y(v)) : g.moveTo(X(u), Y(v))); g.closePath(); g.fillStyle = S.hole ? 'rgba(208,32,42,.08)' : 'rgba(60,127,177,.16)'; g.fill();
        rounded = L.length !== S.pts.length; if (rounded) { g.strokeStyle = !info.ok ? '#c4161c' : info.dof === 0 ? '#14202c' : '#1e5aa8'; g.lineWidth = 1.8; g.stroke(); }
      }
      const full = closed && info.ok && info.dof === 0, lineCol = !info.ok ? '#c4161c' : full ? '#14202c' : '#1e5aa8';
      for (let i = 0; i < nSeg(); i++) {
        const [a, b] = segPts(i), s = isSel({ k: 's', i }), hv = hover && hover.k === 's' && hover.i === i;
        g.strokeStyle = s ? '#f07800' : hv ? '#3d9be9' : lineCol; g.lineWidth = s || hv ? 3 : rounded ? 1 : 1.8; if (rounded && !s && !hv) g.setLineDash([4, 3]); g.beginPath(); g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(b[0]), Y(b[1])); g.stroke(); g.setLineDash([]);
      }
      if (mode === 'draw' && cursor && N()) { const a = S.pts[N() - 1]; g.setLineDash([5, 4]); g.strokeStyle = '#1e5aa8'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(X(a[0]), Y(a[1])); g.lineTo(X(cursor.p[0]), Y(cursor.p[1])); g.stroke(); g.setLineDash([]);
        if (cursor.hv) { g.fillStyle = '#1e5aa8'; g.font = 'bold 11px Segoe UI'; g.fillText(cursor.hv.toUpperCase(), X(cursor.p[0]) + 8, Y(cursor.p[1]) - 8); } }
      // constraint glyphs and dimensions
      g.font = '11px Segoe UI'; g.textAlign = 'center'; g.textBaseline = 'middle';
      S.cons.forEach((c, ci) => {
        const hl = hoverCon === ci, an = consAnchor(c);
        if (GLYPH[c.t]) an.forEach(([u, v, nx, ny]) => badge(X(u) + nx * 13, Y(v) - ny * 13, GLYPH[c.t], hl));
        else if (c.t === 'len' || c.t === 'dist' || c.t === 'dx' || c.t === 'dy') {
          const [a, b] = c.t === 'len' ? segPts(c.s[0]) : c.p.map(i => S.pts[i]);
          let A = a, B = b; if (c.t === 'dx') B = [b[0], a[1]]; if (c.t === 'dy') B = [a[0], b[1]];
          const sgo = c.t === 'len' ? outSign() : 1, L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1, nx = -sgo * (B[1] - A[1]) / L, ny = sgo * (B[0] - A[0]) / L, o = (c.t === 'len' ? 30 : 16) / vw.sc;
          const p = [A[0] + nx * o, A[1] + ny * o], q = [B[0] + nx * o, B[1] + ny * o];
          g.strokeStyle = hl ? '#f07800' : '#6a7d92'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(A[0]), Y(A[1])); g.lineTo(X(p[0]), Y(p[1])); g.moveTo(X(B[0]), Y(B[1])); g.lineTo(X(q[0]), Y(q[1])); g.moveTo(X(p[0]), Y(p[1])); g.lineTo(X(q[0]), Y(q[1])); g.stroke();
          dimText(X((p[0] + q[0]) / 2), Y((p[1] + q[1]) / 2), c, hl);
        } else if (c.t === 'ang') { const [u, v] = an[c.ra ? 1 : 0]; const P = c.ra ? S.pts[c.s[1]] : c.rb ? S.pts[c.s[0]] : [u, v]; dimText(X(P[0]) + 18, Y(P[1]) - 14, c, hl, '°'); }
        else if (c.t === 'x' || c.t === 'y') { const P = S.pts[c.p[0]], other = S.cons.find(o => o !== c && o.p && o.p[0] === c.p[0] && (o.t === 'x' || o.t === 'y')); if (c.t === 'y' && other) return; badge(X(P[0]) - 12, Y(P[1]) + 13, other ? '⌖' : c.t === 'x' ? '↔' : '↕', hl); }
      });
      S.fil.forEach((f, i) => { if (f == null || f === '' || !S.pts[i]) return; g.fillStyle = '#7a3fb0'; g.font = '11px Segoe UI'; g.fillText('R' + r2(evalOr(f, 0)), X(S.pts[i][0]) + 14, Y(S.pts[i][1]) + 14); });
      g.textAlign = 'start'; g.textBaseline = 'alphabetic';
      // points
      S.pts.forEach(([u, v], i) => { const s = isSel({ k: 'p', i }), hv = hover && hover.k === 'p' && hover.i === i; g.fillStyle = s ? '#f07800' : hv ? '#3d9be9' : (mode === 'draw' && i === 0 && N() >= 3 ? '#16a34a' : '#fff'); g.strokeStyle = lineCol; g.lineWidth = 1.4; g.beginPath(); g.rect(X(u) - 3.5, Y(v) - 3.5, 7, 7); g.fill(); g.stroke(); });
      if (mode === 'draw' && cursor) { g.strokeStyle = '#1e5aa8'; g.beginPath(); g.arc(X(cursor.p[0]), Y(cursor.p[1]), 4, 0, 7); g.stroke(); }
      // status
      const dof = $('skDof');
      if (!closed) { dof.textContent = N() ? `Drawing — ${N()} point${N() > 1 ? 's' : ''}` : 'Click to place the first point'; dof.className = ''; }
      else if (!info.ok) { dof.textContent = '⚠ Constraints conflict'; dof.className = 'bad'; }
      else if (info.dof === 0) { dof.textContent = '✔ Fully constrained'; dof.className = 'good'; }
      else { dof.textContent = `${info.dof} degree${info.dof > 1 ? 's' : ''} of freedom left`; dof.className = ''; }
      $('skHint').innerHTML = mode === 'draw' ? '<b>Draw:</b> click points (they snap to the grid, Alt = free). Lines within 4° of level or plumb get H / V automatically. Click the <span style="color:#16a34a">green</span> first point or press Enter to close.'
        : '<b>Select:</b> click points / lines (Shift adds), drag points to move them. Then add a constraint from the toolbar. Double-click a line to insert a point. Dimensions take parameters, e.g. <span class="mono">w/2</span>.';
      box.querySelectorAll('#skTools [data-act]').forEach(b => b.classList.toggle('on', b.dataset.act === mode));
      renderList();
    }
    function badge(x, y, txt, hl) { g.font = 'bold 10px Segoe UI'; const w = Math.max(14, g.measureText(txt).width + 6); g.fillStyle = hl ? '#ffe2c2' : '#e8f0fa'; g.strokeStyle = hl ? '#f07800' : '#8aa4c3'; g.lineWidth = 1; g.beginPath(); g.rect(x - w / 2, y - 7, w, 14); g.fill(); g.stroke(); g.fillStyle = '#1e395b'; g.fillText(txt, x, y + 0.5); }
    function dimText(x, y, c, hl, unit = '') {
      const val = evalOr(c.v), txt = (typeof c.v === 'string' && !/^-?\d+(\.\d+)?$/.test(c.v.trim()) ? c.v + ' = ' : '') + (isFinite(val) ? r2(val) : '?') + unit;
      g.font = '11px Segoe UI'; const w = g.measureText(txt).width + 6; g.fillStyle = 'rgba(255,255,255,.92)'; g.fillRect(x - w / 2, y - 7, w, 14); g.fillStyle = hl ? '#f07800' : '#203a5c'; g.fillText(txt, x, y + 0.5);
    }
    let hoverCon = -1;
    function renderList() {
      const el = $('skCons'), rows = [];
      const nm = c => (c.s || []).map(i => 'L' + (i + 1)).concat((c.p || []).map(i => 'P' + (i + 1))).join(', ');
      S.cons.forEach((c, i) => {
        const hasV = K.CON[c.t] && K.CON[c.t][2], bad = hasV && !isFinite(evalOr(c.v));
        rows.push(`<div class="skrow" data-hc="${i}"><span class="skt">${LABEL[c.t] || c.t}</span><span class="dim">${nm(c)}</span>${hasV ? `<input data-ci="${i}" value="${esc(c.v)}" class="${bad ? 'bad' : ''}" title="Value or expression">` : '<span></span>'}<button class="aero-btn small" data-cdel="${i}" title="Remove">✕</button></div>`);
      });
      S.fil.forEach((f, i) => { if (f == null || f === '') return; rows.push(`<div class="skrow"><span class="skt">Corner radius</span><span class="dim">P${i + 1}</span><input data-fi="${i}" value="${esc(f)}"><button class="aero-btn small" data-fdel="${i}" title="Remove">✕</button></div>`); });
      $('skCount').textContent = rows.length;
      const focused = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset : null;
      el.innerHTML = rows.join('') || '<div class="dim" style="padding:6px">No constraints yet. Select geometry, then pick a constraint above.</div>';
      if (focused) { const q = focused.ci != null ? `[data-ci="${focused.ci}"]` : focused.fi != null ? `[data-fi="${focused.fi}"]` : null; const e2 = q && el.querySelector(q); if (e2) e2.focus(); }
      el.querySelectorAll('[data-ci]').forEach(inp => inp.addEventListener('change', () => { const i = +inp.dataset.ci, raw = inp.value.trim(); const v = /^-?\d+(\.\d+)?$/.test(raw) ? +raw : raw; if (!isFinite(evalOr(v))) { Aero.toast('Not a valid value: ' + raw); render(); return; } change(() => { S.cons[i].v = v; }); }));
      el.querySelectorAll('[data-fi]').forEach(inp => inp.addEventListener('change', () => { const i = +inp.dataset.fi, raw = inp.value.trim(); const v = /^-?\d+(\.\d+)?$/.test(raw) ? +raw : raw; if (!(evalOr(v) >= 0)) { Aero.toast('Not a valid radius: ' + raw); render(); return; } change(() => { S.fil[i] = v || null; }); }));
      el.querySelectorAll('[data-cdel]').forEach(b => b.onclick = () => { hoverCon = -1; change(() => S.cons.splice(+b.dataset.cdel, 1)); });
      el.querySelectorAll('[data-fdel]').forEach(b => b.onclick = () => change(() => { S.fil[+b.dataset.fdel] = null; }));
      el.querySelectorAll('[data-hc]').forEach(r => { r.onmouseenter = () => { hoverCon = +r.dataset.hc; render0(); }; r.onmouseleave = () => { hoverCon = -1; render0(); };
        r.onclick = e => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return; const c = S.cons[+r.dataset.hc]; sel = (c.s || []).map(i => ({ k: 's', i })).concat((c.p || []).map(i => ({ k: 'p', i }))); render(); }; });
    }
    let r0 = false; function render0() { if (r0) return; r0 = true; requestAnimationFrame(() => { r0 = false; const keep = renderList; renderList = () => { }; try { render(); } finally { renderList = keep; } }); }

    // ---------- pointer ----------
    const pos = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    let pan = null;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => {
      const [x, y] = pos(e); try { cv.setPointerCapture(e.pointerId); } catch (_) { }
      if (e.button === 2 || e.button === 1) { pan = { x, y, cx: vw.cx, cy: vw.cy }; return; }
      if (mode === 'draw') { addDrawPoint(snapPoint(x, y, e.altKey)); return; }
      const h = hit(x, y);
      if (!h) { if (!e.shiftKey) sel = []; render(); return; }
      if (e.shiftKey) { sel = isSel(h) ? sel.filter(s => !(s.k === h.k && s.i === h.i)) : sel.concat([h]); }
      else if (!isSel(h)) sel = [h];
      if (h.k === 'p') drag = { i: h.i, before: snap(), moved: false };
      render();
    });
    cv.addEventListener('pointermove', e => {
      const [x, y] = pos(e), [u, v] = toW(x, y); $('skPos').textContent = `${U} ${r2(u)}  ${Vn} ${r2(v)}`;
      if (pan) { vw.cx = pan.cx - (x - pan.x) / vw.sc; vw.cy = pan.cy + (y - pan.y) / vw.sc; render0(); return; }
      if (mode === 'draw') { cursor = snapPoint(x, y, e.altKey); render0(); return; }
      if (drag) {
        let [tu, tv] = [u, v]; if (!e.altKey) { const st = gridStep() / 2; tu = Math.round(tu / st) * st; tv = Math.round(tv / st) * st; }
        const i = drag.i, tries = [[{ t: 'x', p: [i], v: tu }, { t: 'y', p: [i], v: tv }], [{ t: 'x', p: [i], v: tu }], [{ t: 'y', p: [i], v: tv }]];
        if (!closed) { S.pts[i] = [tu, tv]; drag.moved = true; render0(); return; }
        for (const ex of tries) { const r = solveWith(S, ex); if (r.ok) { S.pts = r.pts; info = solveWith(S); drag.moved = true; break; } }
        render0(); return;
      }
      const h = hit(x, y); if (JSON.stringify(h) !== JSON.stringify(hover)) { hover = h; render0(); }
    });
    cv.addEventListener('pointerup', () => { pan = null; if (drag && drag.moved) { undo.push(drag.before); redo.length = 0; resolve(); render(); } drag = null; });
    cv.addEventListener('dblclick', e => { if (mode !== 'select') return; const [x, y] = pos(e), h = hit(x, y); if (h && h.k === 's') { const [a, b] = segPts(h.i); splitSeg(h.i, [r2((a[0] + b[0]) / 2), r2((a[1] + b[1]) / 2)]); } });
    cv.addEventListener('wheel', e => { e.preventDefault(); const [x, y] = pos(e), [u, v] = toW(x, y), f = Math.exp(-e.deltaY * 0.0015); vw.sc = Math.max(0.05, Math.min(500, vw.sc * f)); const [u2, v2] = toW(x, y); vw.cx += u - u2; vw.cy += v - v2; render0(); }, { passive: false });
    box.querySelectorAll('#skTools [data-act]').forEach(b => b.onclick = () => act(b.dataset.act));
    $('skHole').onchange = () => { S.hole = $('skHole').checked; render(); };
    keyH = e => {
      if (!document.body.contains(box)) { window.removeEventListener('keydown', keyH, true); return; }
      const inInput = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT'), k = e.key, ctrl = e.ctrlKey || e.metaKey;
      if (k === 'Enter') { if (inInput && e.target.dataset && (e.target.dataset.ci != null || e.target.dataset.fi != null)) { e.target.blur(); e.preventDefault(); e.stopPropagation(); return; } if (mode === 'draw') { e.preventDefault(); e.stopPropagation(); closeLoop(); } return; }
      if (k === 'Escape') { if (mode === 'draw' && N()) { e.preventDefault(); e.stopPropagation(); if (N() >= 3) closeLoop(); else { S.pts = []; S.fil = []; S.cons = []; render(); } } else if (sel.length) { e.preventDefault(); e.stopPropagation(); sel = []; render(); } return; }
      e.stopPropagation();   // keep the app's own shortcuts quiet while sketching
      if (inInput) return;
      if (ctrl && k.toLowerCase() === 'z') { e.preventDefault(); doUndo(); }
      else if (ctrl && k.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
      else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); act('del'); }
      else if (!ctrl && (k === 'h' || k === 'H')) addCons('h');
      else if (!ctrl && (k === 'v' || k === 'V')) addCons('v');
      else if (!ctrl && (k === 'd' || k === 'D')) addCons(selS().length === 1 ? 'len' : 'dist');
    };
    window.addEventListener('keydown', keyH, true);
    fit(); resolve(); render();
    return { el: box, state: () => JSON.parse(JSON.stringify({ S, closed, mode, info: { ok: info.ok, dof: info.dof } })), act, addCons, select: s => { sel = s; render(); }, toScreen: (u, v) => { const r = cv.getBoundingClientRect(); return [r.left + X(u), r.top + Y(v)]; }, finish: () => dlg.el.querySelector('[data-a="o"]').click() };
  }
  window.CadSketcher = { open };
})();
