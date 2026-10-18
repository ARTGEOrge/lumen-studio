// Lumen Spice schematic editor: pan/zoom canvas, place parts, draw wires, labels, select/move with
// rubber-banding wires, probe nets and parts for plotting, operating-point annotations.
(function () {
  'use strict';
  const PL = window.SpiceParts, S = window.SpiceSchematic, Ex = window.SpiceExpr;
  const COL = { bg: '#fbfbf6', grid: '#cfd3c6', part: '#8b1d1d', body: '#fffbea', wire: '#1d7a37', label: '#1846a3', text: '#2e3b4a', sel: '#2d78c4', hover: '#ff8a00', op: '#0b5394', ghost: 'rgba(45,120,196,.75)' };
  const FONT = '"Segoe UI", Tahoma, sans-serif';
  let A, cv, g, dpr = 1, W = 1, H = 1;
  const view = { scale: 14, ox: -10, oy: -8 };
  let mouse = { x: 0, y: 0, sx: 0, sy: 0, inside: false }, drag = null, wire = null, hoverNet = null, hoverPart = -1, space = false, bendV = false;

  const toWorld = (sx, sy) => [view.ox + sx / view.scale, view.oy + sy / view.scale];
  const toScreen = (x, y) => [(x - view.ox) * view.scale, (y - view.oy) * view.scale];
  const snap = v => Math.round(v);
  const emptySel = () => ({ parts: new Set(), wires: new Set(), labels: new Set() });
  const selCount = () => A.sel.parts.size + A.sel.wires.size + A.sel.labels.size;

  // ---------- geometry ----------
  function partHit(p, x, y) { const b = PL.bbox(p); return x >= b[0] - 0.4 && x <= b[2] + 0.4 && y >= b[1] - 0.4 && y <= b[3] + 0.4; }
  function segDist(x, y, w) { const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = dx * dx + dy * dy; let t = L ? ((x - w.x1) * dx + (y - w.y1) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - w.x1 - t * dx, y - w.y1 - t * dy); }
  function labelBox(l) { const w = Math.max(1.5, l.name.length * 0.62 + 0.4), left = labelLeft(l); return left ? [l.x - w - 0.2, l.y - 1.2, l.x + 0.2, l.y + 0.2] : [l.x - 0.2, l.y - 1.2, l.x + w + 0.2, l.y + 0.2]; }
  function labelLeft(l) { return A.doc.wires.some(w => (w.x1 === l.x && w.y1 === l.y && w.x2 > l.x) || (w.x2 === l.x && w.y2 === l.y && w.x1 > l.x)); }
  function hit(x, y) {
    const d = A.doc;
    for (let i = d.labels.length - 1; i >= 0; i--) { const b = labelBox(d.labels[i]); if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) return { kind: 'label', i }; }
    for (let i = d.parts.length - 1; i >= 0; i--) {
      const p = d.parts[i];
      if (p.type === 'GND' || p.type === 'PROBE') { const b = PL.bbox(p); if (x >= b[0] - 0.3 && x <= b[2] + 0.3 && y >= b[1] - 0.3 && y <= b[3] + 0.3) return { kind: 'part', i }; continue; }
      // pins sitting on a wire should hit the wire, not the part, when the click is right on the pin
      if (partHit(p, x, y)) { const onPin = PL.pinsOf(p).some(q => Math.hypot(q.x - x, q.y - y) < 0.35); if (!onPin || !d.wires.some(w => segDist(x, y, w) < 0.35)) return { kind: 'part', i }; }
    }
    let best = null, bd = 0.45;
    d.wires.forEach((w, i) => { const dd = segDist(x, y, w); if (dd < bd) { bd = dd; best = { kind: 'wire', i }; } });
    return best;
  }
  // electrical connection points (pins, wire ends, wire interiors)
  function connectionAt(x, y) {
    const d = A.doc;
    if (d.parts.some(p => PL.pinsOf(p).some(q => q.x === x && q.y === y))) return 'pin';
    if (d.wires.some(w => (w.x1 === x && w.y1 === y) || (w.x2 === x && w.y2 === y))) return 'end';
    if (d.wires.some(w => S.onSeg(x, y, w))) return 'wire';
    if (d.labels.some(l => l.x === x && l.y === y)) return 'label';
    return null;
  }
  function netUnder(x, y) {
    const con = A.con(); if (!con) return null;
    const sx = snap(x), sy = snap(y);
    for (const p of A.doc.parts) for (const q of PL.pinsOf(p)) if (Math.hypot(q.x - x, q.y - y) < 0.5) { const n = con.netAt(q.x, q.y); if (n) return n; }
    let best = null, bd = 0.5; A.doc.wires.forEach(w => { const dd = segDist(x, y, w); if (dd < bd) { bd = dd; best = w; } });
    if (best) return con.netOfWire(best);
    const l = A.doc.labels.find(l => Math.hypot(l.x - x, l.y - y) < 0.6 || (() => { const b = labelBox(l); return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; })());
    if (l) return con.netOfLabel(l);
    return con.netAt(sx, sy);
  }

  // ---------- drawing ----------
  function resize() {
    const r = cv.parentElement.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
    W = Math.max(10, r.width); H = Math.max(10, r.height);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px'; }
  }
  function worldTf() { g.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, -view.ox * view.scale * dpr, -view.oy * view.scale * dpr); }

  function drawGlyph(p, s) {
    // waveform glyph inside V / I sources
    if (p.type !== 'V') return;
    const v = String(p.value || '').toLowerCase();
    g.beginPath(); g.lineWidth = 0.11;
    if (/sin/.test(v)) { for (let i = 0; i <= 20; i++) { const x = -0.9 + 1.8 * i / 20, y = -0.55 * Math.sin(Math.PI * 2 * i / 20); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
    else if (/pulse/.test(v)) { g.moveTo(-1, 0.5); g.lineTo(-0.5, 0.5); g.lineTo(-0.5, -0.5); g.lineTo(0.3, -0.5); g.lineTo(0.3, 0.5); g.lineTo(0.9, 0.5); g.stroke(); }
    else if (/pwl/.test(v)) { g.moveTo(-1, 0.5); g.lineTo(-0.4, -0.5); g.lineTo(0.2, -0.1); g.lineTo(0.9, 0.5); g.stroke(); }
    else { g.font = `0.95px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = s; g.fillText('+', 0, -0.75); g.fillText('−', 0, 0.8); }
  }
  function drawPart(p, mode) {
    const def = PL.defOf(p); if (!def) return;
    const col = mode === 'ghost' ? COL.ghost : mode === 'sel' ? COL.sel : mode === 'hover' ? COL.hover : p.type === 'PROBE' ? (A.probeColor(p) || '#c0392b') : COL.part;
    g.save(); g.translate(p.x, p.y); g.rotate((p.rot || 0) * Math.PI / 2); if (p.mirror) g.scale(-1, 1);
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 0.13; g.lineCap = 'round'; g.lineJoin = 'round';
    const texts = [];
    def.draw.forEach(s => {
      g.beginPath();
      switch (s[0]) {
        case 'line': g.moveTo(s[1], s[2]); g.lineTo(s[3], s[4]); g.stroke(); break;
        case 'rect': g.rect(s[1], s[2], s[3] - s[1], s[4] - s[2]); if (mode !== 'ghost') { g.fillStyle = COL.body; g.fill(); g.fillStyle = col; } g.stroke(); break;
        case 'circle': g.arc(s[1], s[2], s[3], 0, Math.PI * 2); if (s[4] === 'fill') g.fill(); else { if (s[4] !== true && mode !== 'ghost' && (p.type === 'V' || p.type === 'I')) { g.fillStyle = COL.body; g.fill(); g.fillStyle = col; } g.lineWidth = s[4] === true ? 0.08 : 0.13; g.stroke(); g.lineWidth = 0.13; } break;
        case 'arc': g.arc(s[1], s[2], s[3], s[4] * Math.PI / 180, s[5] * Math.PI / 180); g.stroke(); break;
        case 'poly': s[1].forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.closePath(); if (s[2]) g.fill(); else { if (mode !== 'ghost') { g.fillStyle = COL.body; g.fill(); g.fillStyle = col; } g.stroke(); } break;
        case 'text': texts.push(s); break;
      }
    });
    if (p.type === 'SW') { g.beginPath(); const closed = /^(closed|on|1|true)$/i.test(p.value); if (closed) { g.moveTo(0, -1.2); g.lineTo(0, 1.2); } else { g.moveTo(0, 1.2); g.lineTo(1.1, -1.0); } g.stroke(); }
    drawGlyph(p, col);
    g.restore();
    // upright texts (+/− marks) at transformed positions
    texts.forEach(s => { const [x, y] = PL.xform(p, s[1], s[2]); g.fillStyle = col; g.font = `${s[4] || 0.8}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s[3], x, y); });
    if (mode === 'ghost' || def.power) return;
    // reference and value
    const b = PL.bbox(p), vert = (b[3] - b[1]) >= (b[2] - b[0]) - 0.5;
    const val = p.type === 'OPAMP' ? (/gbw\s*=\s*(\S+)/i.exec(p.value || '') ? 'GBW ' + /gbw\s*=\s*(\S+)/i.exec(p.value)[1] : '') : p.type === 'SUBX' ? p.value : [p.value, p.extra].filter(Boolean).join(' ');
    g.fillStyle = mode === 'sel' ? COL.sel : COL.text; g.textBaseline = 'alphabetic';
    if (vert) { g.textAlign = 'left'; const x = b[2] + 0.5, y = (b[1] + b[3]) / 2; g.font = `600 0.95px ${FONT}`; g.fillText(p.ref, x, y - 0.25); g.font = `0.85px ${FONT}`; g.fillText(val, x, y + 0.85); }
    else { g.textAlign = 'center'; const x = (b[0] + b[2]) / 2; g.font = `600 0.95px ${FONT}`; g.fillText(p.ref, x, b[1] - 0.45); g.font = `0.85px ${FONT}`; g.textBaseline = 'top'; g.fillText(val, x, b[3] + 0.35); }
    if (p.type === 'SUBX' && p.pinNames && p.pinNames.length) {
      g.font = `0.7px ${FONT}`; g.fillStyle = COL.text; g.textBaseline = 'middle';
      PL.defOf(p).pins.forEach((q, i) => { const nm = p.pinNames[i]; if (!nm) return; const [x, y] = PL.xform(p, q.x + (q.x < 0 ? 1.2 : -1.2), q.y); g.textAlign = (PL.xform(p, q.x, q.y)[0] < p.x) ? 'left' : 'right'; g.fillText(nm, x, y); });
    }
  }
  function drawLabel(l, mode) {
    const left = labelLeft(l), col = mode === 'sel' ? COL.sel : mode === 'hover' ? COL.hover : COL.label;
    g.fillStyle = col; g.strokeStyle = col; g.font = `600 1px ${FONT}`; g.textBaseline = 'bottom'; g.textAlign = left ? 'right' : 'left';
    g.fillText(l.name, l.x + (left ? -0.25 : 0.25), l.y - 0.15);
    const w = g.measureText(l.name).width + 0.3; g.lineWidth = 0.08; g.beginPath(); g.moveTo(l.x, l.y); g.lineTo(l.x + (left ? -w : w), l.y); g.stroke();
    g.beginPath(); g.arc(l.x, l.y, 0.16, 0, 7); g.fill();
  }
  function draw() {
    if (!cv) return;
    resize(); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = COL.bg; g.fillRect(0, 0, W, H);
    if (A.showGrid && view.scale >= 5) {
      const [x0, y0] = toWorld(0, 0), [x1, y1] = toWorld(W, H), step = view.scale < 9 ? 2 : 1; g.fillStyle = COL.grid; const r = view.scale > 20 ? 1.4 : 1;
      for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { const [sx, sy] = toScreen(x, y); g.fillRect(sx - r / 2, sy - r / 2, r, r); }
    }
    worldTf(); g.lineCap = 'round'; g.lineJoin = 'round';
    const d = A.doc, con = A.con();
    const hoverWires = hoverNet && con ? new Set(d.wires.map((w, i) => con.netOfWire(w) === hoverNet ? i : -1).filter(i => i >= 0)) : null;
    // wires
    d.wires.forEach((w, i) => {
      const sel = A.sel.wires.has(i), hv = hoverWires && hoverWires.has(i);
      g.strokeStyle = sel ? COL.sel : hv ? COL.hover : COL.wire; g.lineWidth = sel || hv ? 0.2 : 0.13;
      g.beginPath(); g.moveTo(w.x1, w.y1); g.lineTo(w.x2, w.y2); g.stroke();
    });
    g.fillStyle = COL.wire; S.junctions(d).forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 0.3, 0, 7); g.fill(); });
    d.parts.forEach((p, i) => drawPart(p, A.sel.parts.has(i) ? 'sel' : i === hoverPart ? 'hover' : null));
    d.labels.forEach((l, i) => drawLabel(l, A.sel.labels.has(i) ? 'sel' : hoverNet && con && con.netOfLabel(l) === hoverNet ? 'hover' : null));
    // unconnected pin markers (small open squares)
    if (con) con.unconnected.forEach(u => { const p = d.parts[u.pi]; if (p.type === 'OPAMP' && (u.n === 'V+' || u.n === 'V-')) return; g.strokeStyle = '#c0392b'; g.lineWidth = 0.08; g.strokeRect(u.x - 0.3, u.y - 0.3, 0.6, 0.6); });
    // operating point annotations
    if (A.opVals && con) drawOp(con);
    // tool previews
    if (wire) {
      g.strokeStyle = COL.ghost; g.lineWidth = 0.13; g.setLineDash([0.4, 0.3]); g.beginPath();
      const pts = wirePath(wire.x, wire.y, snap(mouse.x), snap(mouse.y)); g.moveTo(pts[0][0], pts[0][1]); pts.slice(1).forEach(q => g.lineTo(q[0], q[1])); g.stroke(); g.setLineDash([]);
    }
    if (A.tool === 'place' && A.placing && mouse.inside) drawPart({ ...A.placing, x: snap(mouse.x), y: snap(mouse.y) }, 'ghost');
    if ((A.tool === 'wire' || A.tool === 'label') && mouse.inside) { const x = snap(mouse.x), y = snap(mouse.y), c = connectionAt(x, y); g.strokeStyle = c ? COL.hover : COL.ghost; g.lineWidth = 0.1; g.beginPath(); g.arc(x, y, c ? 0.45 : 0.3, 0, 7); g.stroke(); }
    if (drag && drag.kind === 'box') {
      g.strokeStyle = COL.sel; g.fillStyle = 'rgba(45,120,196,.1)'; g.lineWidth = 1 / view.scale;
      const x = Math.min(drag.x0, mouse.x), y = Math.min(drag.y0, mouse.y), w = Math.abs(mouse.x - drag.x0), h = Math.abs(mouse.y - drag.y0); g.fillRect(x, y, w, h); g.strokeRect(x, y, w, h);
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // empty-state hint
    if (!d.parts.length && !d.wires.length) {
      g.fillStyle = '#6a7a8c'; g.font = `15px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('Empty schematic — pick a part from the toolbox (R, C, L, D, V…) and click to place it,', W / 2, H / 2 - 12);
      g.fillText('draw wires with W, add a ground (G), then Run (F5). Or open a sample from the File menu.', W / 2, H / 2 + 12);
    }
  }
  function drawOp(con) {
    const done = new Set(), tag = (x, y, text) => {
      g.font = `0.85px ${FONT}`; const w = g.measureText(text).width + 0.5;
      g.fillStyle = 'rgba(255,248,196,.95)'; g.strokeStyle = '#c9a227'; g.lineWidth = 0.05; g.beginPath(); g.rect(x, y - 0.6, w, 1.1); g.fill(); g.stroke();
      g.fillStyle = COL.op; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(text, x + 0.25, y - 0.05);
    };
    const val = n => A.opVals.get(String(n).toLowerCase());
    A.doc.labels.forEach(l => { const n = con.netOfLabel(l); if (!n || done.has(n)) return; const v = val(n); if (v === undefined) return; done.add(n); const b = labelBox(l); tag(b[0], b[1] - 0.8, Ex.fmtEng(v, 4, 'V')); });
    A.doc.wires.forEach(w => {
      const n = con.netOfWire(w); if (!n || n === '0' || done.has(n)) return; const v = val(n); if (v === undefined) return; done.add(n);
      tag((w.x1 + w.x2) / 2 + 0.3, (w.y1 + w.y2) / 2 - 0.4, Ex.fmtEng(v, 4, 'V'));
    });
  }

  // ---------- wire tool ----------
  function wirePath(x0, y0, x1, y1) {
    if (x0 === x1 || y0 === y1) return [[x0, y0], [x1, y1]];
    return bendV ? [[x0, y0], [x0, y1], [x1, y1]] : [[x0, y0], [x1, y0], [x1, y1]];
  }
  function addWires(d, pts) { for (let i = 1; i < pts.length; i++) { const [a, b] = [pts[i - 1], pts[i]]; if (a[0] !== b[0] || a[1] !== b[1]) d.wires.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] }); } }

  // ---------- interaction ----------
  function onDown(e) {
    cv.focus();
    const [x, y] = toWorld(e.offsetX, e.offsetY); mouse.x = x; mouse.y = y;
    if (e.button === 1 || e.button === 2 || (e.button === 0 && space)) {
      if (e.button === 2 && wire) { wire = null; draw(); return; }
      if (e.button === 2 && A.tool === 'place') { A.setTool('select'); return; }
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy, moved: false }; cv.setPointerCapture(e.pointerId); return;
    }
    if (e.button !== 0) return;
    const sx = snap(x), sy = snap(y);
    switch (A.tool) {
      case 'place': {
        const p = { ...A.placing, x: sx, y: sy };
        A.commit('Place ' + PL.PART[p.type].name.toLowerCase(), d => { p.ref = A.nextRef(p.type); d.parts.push(p); });
        A.placing = { ...A.placing }; draw(); return;
      }
      case 'wire': {
        if (!wire) { wire = { x: sx, y: sy, start: true }; draw(); return; }
        if (sx === wire.x && sy === wire.y) { wire = null; draw(); return; }
        const pts = wirePath(wire.x, wire.y, sx, sy), endsOnSomething = connectionAt(sx, sy);
        A.commit('Draw wire', d => addWires(d, pts));
        wire = endsOnSomething && !e.shiftKey ? null : { x: sx, y: sy }; draw(); return;
      }
      case 'label': {
        const h = hit(x, y);
        if (h && h.kind === 'label') { A.renameLabel(h.i); return; }
        const sug = netUnder(x, y);
        Aero.prompt('Net label', 'Net name', sug && !/^N\d{3}$/.test(sug) && sug !== '0' ? sug : A.lastLabel || 'out').then(name => {
          if (!name || !name.trim()) return; A.lastLabel = S.cleanName(name);
          A.commit('Add net label', d => d.labels.push({ x: sx, y: sy, name: S.cleanName(name) }));
        });
        return;
      }
      case 'probe': {
        const h = hit(x, y);
        if (h && h.kind === 'part') { const p = A.doc.parts[h.i]; const net = PL.pinsOf(p).find(q => Math.hypot(q.x - x, q.y - y) < 0.5); if (!net) { const pr = S.currentProbe(p); if (pr) { A.onProbe(pr); return; } } }
        const n = netUnder(x, y);
        if (n) A.onProbe(n === '0' ? 'V(0)' : 'V(' + n + ')'); else Aero.toast('Click a wire, net label or pin to plot its voltage, or a part body to plot its current');
        return;
      }
    }
    // select tool
    const h = hit(x, y);
    if (!h) {
      if (!e.shiftKey && !e.ctrlKey) A.sel = emptySel();
      drag = { kind: 'box', x0: x, y0: y, add: e.shiftKey || e.ctrlKey }; cv.setPointerCapture(e.pointerId); A.render(); return;
    }
    const set = A.sel[h.kind + 's'];
    if (e.shiftKey || e.ctrlKey) { if (set.has(h.i)) set.delete(h.i); else set.add(h.i); A.render(); return; }
    if (!set.has(h.i)) { A.sel = emptySel(); A.sel[h.kind + 's'].add(h.i); }
    // start moving the selection; wires attached to moved pins stretch
    const d = A.doc, pinPts = new Set();
    A.sel.parts.forEach(i => PL.pinsOf(d.parts[i]).forEach(q => pinPts.add(q.x + ',' + q.y)));
    // ground symbols, probe markers and net labels sitting right on a moved pin travel with the part
    d.parts.forEach((p, i) => { if (!A.sel.parts.has(i) && PL.PART[p.type].power && pinPts.has(p.x + ',' + p.y)) A.sel.parts.add(i); });
    d.labels.forEach((l, i) => { if (pinPts.has(l.x + ',' + l.y)) A.sel.labels.add(i); });
    const stretch = [];
    d.wires.forEach((w, i) => { if (A.sel.wires.has(i)) return; const a = pinPts.has(w.x1 + ',' + w.y1), b = pinPts.has(w.x2 + ',' + w.y2); if (a || b) stretch.push({ i, a, b, w0: { ...w } }); });
    drag = { kind: 'move', x0: sx, y0: sy, dx: 0, dy: 0, before: JSON.stringify(d), orig: { parts: [...A.sel.parts].map(i => [i, d.parts[i].x, d.parts[i].y]), wires: [...A.sel.wires].map(i => [i, { ...d.wires[i] }]), labels: [...A.sel.labels].map(i => [i, d.labels[i].x, d.labels[i].y]) }, stretch };
    cv.setPointerCapture(e.pointerId); A.render();
  }
  function onMove(e) {
    const [x, y] = toWorld(e.offsetX, e.offsetY); mouse.x = x; mouse.y = y; mouse.inside = true;
    A.status(`x ${snap(x)}  y ${snap(y)}`);
    if (drag && drag.kind === 'pan') { drag.moved = true; view.ox = drag.ox - (e.clientX - drag.sx) / view.scale; view.oy = drag.oy - (e.clientY - drag.sy) / view.scale; draw(); return; }
    if (drag && drag.kind === 'move') {
      const dx = snap(x) - drag.x0, dy = snap(y) - drag.y0; if (dx === drag.dx && dy === drag.dy) return; drag.dx = dx; drag.dy = dy;
      const d = A.doc; A.invalidate();
      drag.orig.parts.forEach(([i, px, py]) => { d.parts[i].x = px + dx; d.parts[i].y = py + dy; });
      drag.orig.wires.forEach(([i, w]) => { d.wires[i] = { x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy }; });
      drag.orig.labels.forEach(([i, lx, ly]) => { d.labels[i].x = lx + dx; d.labels[i].y = ly + dy; });
      drag.stretch.forEach(s => { const w = d.wires[s.i]; if (s.a) { w.x1 = s.w0.x1 + dx; w.y1 = s.w0.y1 + dy; } if (s.b) { w.x2 = s.w0.x2 + dx; w.y2 = s.w0.y2 + dy; } });
      draw(); return;
    }
    if (drag && drag.kind === 'box') { draw(); return; }
    if (A.tool === 'probe') {
      const h = hit(x, y); let n = null, hp = -1;
      if (h && h.kind === 'part' && !PL.pinsOf(A.doc.parts[h.i]).some(q => Math.hypot(q.x - x, q.y - y) < 0.5) && S.currentProbe(A.doc.parts[h.i])) hp = h.i; else n = netUnder(x, y);
      if (n !== hoverNet || hp !== hoverPart) { hoverNet = n; hoverPart = hp; cv.style.cursor = n ? 'crosshair' : hp >= 0 ? 'pointer' : 'default'; A.status(n ? `Plot V(${n})` : hp >= 0 ? `Plot ${S.currentProbe(A.doc.parts[hp])}` : ''); draw(); }
      return;
    }
    if (A.tool === 'wire' || A.tool === 'place' || A.tool === 'label') draw();
  }
  function onUp(e) {
    if (!drag) return;
    const dr = drag; drag = null;
    if (dr.kind === 'pan') return;
    if (dr.kind === 'box') {
      const x0 = Math.min(dr.x0, mouse.x), x1 = Math.max(dr.x0, mouse.x), y0 = Math.min(dr.y0, mouse.y), y1 = Math.max(dr.y0, mouse.y);
      if (x1 - x0 > 0.3 || y1 - y0 > 0.3) {
        const d = A.doc, inside = (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
        d.parts.forEach((p, i) => { const b = PL.bbox(p); if (inside(b[0], b[1]) && inside(b[2], b[3])) A.sel.parts.add(i); });
        d.wires.forEach((w, i) => { if (inside(w.x1, w.y1) && inside(w.x2, w.y2)) A.sel.wires.add(i); });
        d.labels.forEach((l, i) => { if (inside(l.x, l.y)) A.sel.labels.add(i); });
      }
      A.render(); return;
    }
    if (dr.kind === 'move') { if (dr.dx || dr.dy) A.commitMoved('Move', dr.before); else A.render(); }
  }
  function onDbl(e) {
    const [x, y] = toWorld(e.offsetX, e.offsetY);
    if (A.tool === 'wire') { wire = null; draw(); return; }
    if (A.tool !== 'select') return;
    const h = hit(x, y); if (!h) return;
    if (h.kind === 'part') A.editPart(h.i); else if (h.kind === 'label') A.renameLabel(h.i);
  }
  function onWheel(e) {
    e.preventDefault();
    const [wx, wy] = toWorld(e.offsetX, e.offsetY), f = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    view.scale = Math.max(2, Math.min(120, view.scale * f)); view.ox = wx - e.offsetX / view.scale; view.oy = wy - e.offsetY / view.scale; draw(); A.updateZoom();
  }

  // ---------- commands ----------
  function bounds() {
    const d = A.doc; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (a, b) => { x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, a); y1 = Math.max(y1, b); };
    d.parts.forEach(p => { const b = PL.bbox(p); add(b[0] - 1, b[1] - 1.5); add(b[2] + 5, b[3] + 1.5); });
    d.wires.forEach(w => { add(w.x1, w.y1); add(w.x2, w.y2); });
    d.labels.forEach(l => { const b = labelBox(l); add(b[0], b[1]); add(b[2], b[3]); });
    return x0 === Infinity ? [-10, -8, 30, 20] : [x0, y0, x1, y1];
  }
  const E = window.SchEditor = {
    attach(app, canvas) {
      A = app; cv = canvas; g = cv.getContext('2d'); A.sel = emptySel();
      cv.tabIndex = 0;
      cv.addEventListener('pointerdown', onDown); cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerup', onUp);
      cv.addEventListener('pointerleave', () => { mouse.inside = false; if (hoverNet || hoverPart >= 0) { hoverNet = null; hoverPart = -1; } draw(); });
      cv.addEventListener('dblclick', onDbl); cv.addEventListener('wheel', onWheel, { passive: false }); cv.addEventListener('contextmenu', e => e.preventDefault());
      addEventListener('keydown', e => { if (e.code === 'Space' && !e.target.closest?.('input,textarea,select')) space = true; });
      addEventListener('keyup', e => { if (e.code === 'Space') space = false; });
    },
    draw,
    fit() { resize(); const [x0, y0, x1, y1] = bounds(); const pad = 24; const s = Math.min((W - 2 * pad) / Math.max(1, x1 - x0), (H - 2 * pad) / Math.max(1, y1 - y0)); view.scale = Math.max(2, Math.min(40, s)); view.ox = (x0 + x1) / 2 - W / 2 / view.scale; view.oy = (y0 + y1) / 2 - H / 2 / view.scale; draw(); },
    zoom(f) { resize(); const cx = view.ox + W / 2 / view.scale, cy = view.oy + H / 2 / view.scale; view.scale = Math.max(2, Math.min(120, view.scale * f)); view.ox = cx - W / 2 / view.scale; view.oy = cy - H / 2 / view.scale; draw(); },
    zoom100() { E.zoom(14 / view.scale); },
    get scale() { return view.scale / 14; },
    cancel() { if (wire) { wire = null; draw(); return true; } if (A.tool !== 'select') { A.setTool('select'); return true; } if (selCount()) { A.sel = emptySel(); A.render(); return true; } return false; },
    toggleBend() { bendV = !bendV; draw(); },
    resetTool() { wire = null; hoverNet = null; hoverPart = -1; cv.style.cursor = A.tool === 'probe' ? 'crosshair' : A.tool === 'select' ? 'default' : 'crosshair'; draw(); },
    emptySel, selCount, hit, netUnder, bounds, toScreen: (x, y) => { const [a, b] = toScreen(x, y); const r = cv.getBoundingClientRect(); return [a + r.left, b + r.top]; },
    rotateSel() {
      if (A.tool === 'place' && A.placing) { A.placing.rot = ((A.placing.rot || 0) + 1) % 4; draw(); return; }
      if (!A.sel.parts.size) return;
      A.commit('Rotate', d => rotateAround(d, 1));
    },
    mirrorSel() {
      if (A.tool === 'place' && A.placing) { A.placing.mirror = !A.placing.mirror; draw(); return; }
      if (!A.sel.parts.size) return;
      A.commit('Mirror', d => A.sel.parts.forEach(i => { d.parts[i].mirror = !d.parts[i].mirror; }));
    },
    deleteSel() {
      if (!selCount()) return;
      const sel = A.sel; A.sel = emptySel();
      A.commit('Delete', d => { d.parts = d.parts.filter((_, i) => !sel.parts.has(i)); d.wires = d.wires.filter((_, i) => !sel.wires.has(i)); d.labels = d.labels.filter((_, i) => !sel.labels.has(i)); });
    },
    selectAll() { const d = A.doc; A.sel = { parts: new Set(d.parts.map((_, i) => i)), wires: new Set(d.wires.map((_, i) => i)), labels: new Set(d.labels.map((_, i) => i)) }; A.render(); },
    copy() {
      if (!selCount()) return false; const d = A.doc;
      E.clip = JSON.stringify({ parts: [...A.sel.parts].map(i => d.parts[i]), wires: [...A.sel.wires].map(i => d.wires[i]), labels: [...A.sel.labels].map(i => d.labels[i]) }); return true;
    },
    paste() {
      if (!E.clip) return; const c = JSON.parse(E.clip), off = 4;
      A.commit('Paste', doc => {
        const sel = emptySel();
        c.parts.forEach(p => { const q = { ...p, x: p.x + off, y: p.y + off }; if (!PL.PART[q.type].power) q.ref = A.nextRef(q.type, doc); sel.parts.add(doc.parts.length); doc.parts.push(q); });
        c.wires.forEach(w => { sel.wires.add(doc.wires.length); doc.wires.push({ x1: w.x1 + off, y1: w.y1 + off, x2: w.x2 + off, y2: w.y2 + off }); });
        c.labels.forEach(l => { sel.labels.add(doc.labels.length); doc.labels.push({ ...l, x: l.x + off, y: l.y + off }); });
        A.sel = sel;
      });
    },
    image() { return cv; },
  };
  // rotate the selection 90° clockwise around its centre (parts, wires and labels together)
  function rotateAround(d, q) {
    const pts = []; A.sel.parts.forEach(i => pts.push([d.parts[i].x, d.parts[i].y])); A.sel.wires.forEach(i => { const w = d.wires[i]; pts.push([w.x1, w.y1], [w.x2, w.y2]); }); A.sel.labels.forEach(i => pts.push([d.labels[i].x, d.labels[i].y]));
    const cx = Math.round(pts.reduce((s, p) => s + p[0], 0) / pts.length), cy = Math.round(pts.reduce((s, p) => s + p[1], 0) / pts.length);
    const R = (x, y) => [cx - (y - cy), cy + (x - cx)];
    for (let k = 0; k < q; k++) {
      A.sel.parts.forEach(i => { const p = d.parts[i]; [p.x, p.y] = R(p.x, p.y); p.rot = ((p.rot || 0) + 1) % 4; });
      A.sel.wires.forEach(i => { const w = d.wires[i]; [w.x1, w.y1] = R(w.x1, w.y1); [w.x2, w.y2] = R(w.x2, w.y2); });
      A.sel.labels.forEach(i => { const l = d.labels[i]; [l.x, l.y] = R(l.x, l.y); });
    }
  }
})();
