// Lumen PCB schematic editor: place parts, draw wires, labels and power ports.
(function () {
  const Core = window.PcbCore, LIB = window.PcbLib;
  let A, view, cv, mouse = [0, 0], wire = null, drag = null, hover = null;
  const snap = v => Math.round(v);
  const COL = { bg: '#fbfbf6', grid: '#d6d6cc', part: '#8b1d1d', body: '#fff9e0', pin: '#8b1d1d', wire: '#127a2c', label: '#1846a3', text: '#2e3b4a', sel: '#2d78c4', junc: '#127a2c', err: '#d0202a' };

  function partBox(p) {
    const def = LIB.PART[p.lib]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { const [a, b] = Core.xform(p, x, y); x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); };
    def.sym.pins.forEach(q => add(q.x, q.y));
    def.sym.draw.forEach(d => { if (d[0] === 'line' || d[0] === 'rect') { add(d[1], d[2]); add(d[3], d[4]); } else if (d[0] === 'circle' || d[0] === 'arc2') { add(d[1] - d[3], d[2] - d[3]); add(d[1] + d[3], d[2] + d[3]); } else if (d[0] === 'poly') d[1].forEach(([x, y]) => add(x, y)); });
    return [x0 - 0.3, y0 - 0.3, x1 + 0.3, y1 + 0.3];
  }

  function drawPart(g, p, ghost) {
    const def = LIB.PART[p.lib]; if (!def) return;
    const T = (x, y) => Core.xform(p, x, y);
    const sel = !ghost && A.sel && A.sel.kind === 'part' && A.doc.sch.parts[A.sel.i] === p;
    g.lineWidth = 0.15; g.strokeStyle = ghost ? 'rgba(45,120,196,.7)' : sel ? COL.sel : COL.part; g.fillStyle = COL.body;
    def.sym.draw.forEach(d => {
      g.beginPath();
      if (d[0] === 'line') { g.moveTo(...T(d[1], d[2])); g.lineTo(...T(d[3], d[4])); g.stroke(); }
      else if (d[0] === 'rect') { const c = [T(d[1], d[2]), T(d[3], d[2]), T(d[3], d[4]), T(d[1], d[4])]; g.moveTo(...c[0]); c.slice(1).forEach(q => g.lineTo(...q)); g.closePath(); if (!ghost) g.fill(); g.stroke(); }
      else if (d[0] === 'circle') { g.arc(...T(d[1], d[2]), d[3], 0, 7); g.stroke(); }
      else if (d[0] === 'arc2') { const [cx, cy] = T(d[1], d[2]); const a = ((p.rot || 0) % 4) * Math.PI / 2 + (p.mirror ? 0 : Math.PI); g.arc(cx, cy, d[3], a - 1.1, a + 1.1); g.stroke(); }
      else if (d[0] === 'poly') { d[1].forEach(([x, y], i) => i ? g.lineTo(...T(x, y)) : g.moveTo(...T(x, y))); g.closePath(); g.fillStyle = g.strokeStyle; g.fill(); g.fillStyle = COL.body; }
      else if (d[0] === 'text') { g.fillStyle = g.strokeStyle; g.font = '1px Segoe UI'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(d[3], ...T(d[1], d[2])); g.fillStyle = COL.body; }
      else if (d[0] === 'vtext') { g.fillStyle = g.strokeStyle; g.font = '0.9px Segoe UI'; g.textAlign = 'center'; g.textBaseline = 'bottom'; const [x, y] = T(d[1], d[2]); g.fillText(p.value || '', x, y + 0.4); g.fillStyle = COL.body; }
    });
    // pins: stubs for boxed symbols, numbers for everything with more than two pins
    const pins = def.sym.pins;
    pins.forEach(q => {
      const [x, y] = T(q.x, q.y);
      if (def.sym.pinLen) { const ix = Math.sign(-q.x) * (Math.abs(q.x) > Math.abs(q.y) ? def.sym.pinLen : 0), iy = Math.abs(q.x) > Math.abs(q.y) ? 0 : Math.sign(-q.y) * def.sym.pinLen; g.beginPath(); g.moveTo(x, y); g.lineTo(...T(q.x + ix, q.y + iy)); g.stroke(); }
      if (!def.power && !def.sym.nopin && (pins.length > 2 || def.sym.pinLen)) {
        g.fillStyle = COL.text; g.font = '0.7px Segoe UI'; g.textAlign = 'center'; g.textBaseline = 'bottom';
        const [mx, my] = T(q.x * 0.82, q.y * 0.82 - 0.05); g.fillText(q.n, mx, my);
        if (q.name && def.sym.pinLen) { const [nx, ny] = T(q.x - Math.sign(q.x) * (def.sym.pinLen + 0.3), q.y); g.font = '0.75px Segoe UI'; g.textAlign = nx < p.x ? 'left' : 'right'; g.textBaseline = 'middle'; g.fillText(q.name, nx, ny); }
      }
      if (!ghost && A.showPinDots) { g.fillStyle = COL.pin; g.beginPath(); g.arc(x, y, 0.12, 0, 7); g.fill(); }
    });
    if (!def.power || def.id === 'GND') {
      const b = partBox(p); g.fillStyle = sel ? COL.sel : COL.text; g.font = '0.95px Segoe UI'; g.textBaseline = 'alphabetic';
      if (!def.power && def.sym.pinLen && def.sym.pins.length > 1) { g.textAlign = 'center'; g.fillText(p.ref, (b[0] + b[2]) / 2, b[1] - 0.25); g.fillStyle = COL.text; g.font = '0.85px Segoe UI'; g.textBaseline = 'top'; g.fillText(p.value || '', (b[0] + b[2]) / 2, b[3] + 0.25); }
      else if (!def.power) { g.textAlign = 'left'; g.fillText(p.ref, b[2] + 0.2, (b[1] + b[3]) / 2 - 0.15); g.fillStyle = COL.text; g.font = '0.85px Segoe UI'; g.fillText(p.value || '', b[2] + 0.2, (b[1] + b[3]) / 2 + 0.85); }
      else if (def.id === 'GND') { g.textAlign = 'center'; g.font = '0.8px Segoe UI'; g.fillText(p.value === 'GND' ? '' : p.value, p.x, b[3] + 0.9); }
    }
  }

  function junctions(sch) {
    const deg = new Map(), k = (x, y) => x + ',' + y;
    const segs = []; sch.wires.forEach(w => { for (let i = 1; i < w.pts.length; i++) segs.push([w.pts[i - 1], w.pts[i]]); });
    const pts = [];
    sch.wires.forEach(w => [w.pts[0], w.pts[w.pts.length - 1]].forEach(p => { deg.set(k(...p), (deg.get(k(...p)) || 0) + 1); pts.push(p); }));
    sch.parts.forEach(p => Core.pinsOf(p).forEach(q => { const kk = k(q.x, q.y); if (deg.has(kk)) deg.set(kk, deg.get(kk) + 1); }));
    const out = [];
    pts.forEach(p => { let d = deg.get(k(...p)); segs.forEach(([a, b]) => { const inner = !(a[0] === p[0] && a[1] === p[1]) && !(b[0] === p[0] && b[1] === p[1]) && ((a[0] === b[0] && a[0] === p[0] && p[1] > Math.min(a[1], b[1]) && p[1] < Math.max(a[1], b[1])) || (a[1] === b[1] && a[1] === p[1] && p[0] > Math.min(a[0], b[0]) && p[0] < Math.max(a[0], b[0]))); if (inner) d += 2; }); if (d >= 3) out.push(p); });
    return out;
  }

  function draw() {
    const g = view.begin(); g.fillStyle = COL.bg; g.fillRect(0, 0, view.w, view.h);
    // grid
    if (view.scale >= 6) { const [x0, y0] = view.toWorld(0, 0), [x1, y1] = view.toWorld(view.w, view.h); g.fillStyle = COL.grid; const step = view.scale < 10 ? 2 : 1;
      for (let x = Math.floor(x0 / step) * step; x <= x1; x += step) for (let y = Math.floor(y0 / step) * step; y <= y1; y += step) { const [sx, sy] = view.toScreen(x, y); g.fillRect(sx - 0.75, sy - 0.75, 1.5, 1.5); } }
    view.world(); g.lineCap = 'round'; g.lineJoin = 'round';
    const sch = A.doc.sch;
    // wires
    sch.wires.forEach((w, i) => { const sel = A.sel && A.sel.kind === 'wire' && A.sel.i === i; g.strokeStyle = sel ? COL.sel : COL.wire; g.lineWidth = sel ? 0.22 : 0.15; g.beginPath(); w.pts.forEach((p, k) => k ? g.lineTo(...p) : g.moveTo(...p)); g.stroke(); });
    g.fillStyle = COL.junc; junctions(sch).forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 0.3, 0, 7); g.fill(); });
    sch.parts.forEach(p => drawPart(g, p));
    // labels
    sch.labels.forEach((l, i) => {
      const sel = A.sel && A.sel.kind === 'label' && A.sel.i === i; g.fillStyle = sel ? COL.sel : COL.label; g.font = '600 0.95px Segoe UI'; g.textBaseline = 'bottom';
      const left = labelLeft(sch, l), w = g.measureText(l.name).width + 0.15;   // text runs away from the wire it names
      g.textAlign = left ? 'right' : 'left'; g.fillText(l.name, l.x + (left ? -0.15 : 0.15), l.y - 0.1);
      g.beginPath(); g.moveTo(l.x, l.y); g.lineTo(l.x + (left ? -w : w), l.y); g.strokeStyle = g.fillStyle; g.lineWidth = 0.08; g.stroke();
    });
    // ERC markers
    if (A.mode === 'sch') A.messages.filter(m => m.x != null).forEach(m => { g.strokeStyle = COL.err; g.lineWidth = 0.15; g.beginPath(); g.moveTo(m.x - 0.4, m.y - 0.4); g.lineTo(m.x + 0.4, m.y + 0.4); g.moveTo(m.x + 0.4, m.y - 0.4); g.lineTo(m.x - 0.4, m.y + 0.4); g.stroke(); });
    // tool previews
    const [mx, my] = mouse.map(snap);
    if (A.tool === 'wire' && wire) { const pts = previewPts(); g.strokeStyle = COL.wire; g.lineWidth = 0.15; g.setLineDash([0.4, 0.3]); g.beginPath(); pts.forEach((p, k) => k ? g.lineTo(...p) : g.moveTo(...p)); g.stroke(); g.setLineDash([]); }
    if (A.tool === 'place' && A.placing) drawPart(g, { ...A.placing, x: mx, y: my, ref: '', value: A.placing.value }, true);
    if (A.tool === 'wire' || A.tool === 'label' || A.tool === 'place') { g.strokeStyle = 'rgba(45,120,196,.6)'; g.lineWidth = 0.06; g.beginPath(); g.moveTo(mx - 0.6, my); g.lineTo(mx + 0.6, my); g.moveTo(mx, my - 0.6); g.lineTo(mx, my + 0.6); g.stroke(); }
    if (hover && A.tool === 'select') { g.strokeStyle = 'rgba(45,120,196,.45)'; g.lineWidth = 0.08; const b = hover; g.strokeRect(b[0], b[1], b[2] - b[0], b[3] - b[1]); }
    A.status(`x ${mx}  y ${my}`);
  }
  // a label whose wire arrives from the right reads leftward
  function labelLeft(sch, l) { for (const w of sch.wires) { const n = w.pts.length; if (w.pts[0][0] === l.x && w.pts[0][1] === l.y && n > 1) return w.pts[1][0] > l.x; if (w.pts[n - 1][0] === l.x && w.pts[n - 1][1] === l.y && n > 1) return w.pts[n - 2][0] > l.x; } return false; }
  function previewPts() {
    const last = wire.pts[wire.pts.length - 1], [mx, my] = mouse.map(snap);
    const corner = wire.vfirst ? [last[0], my] : [mx, last[1]];
    return [...wire.pts, corner, [mx, my]];
  }

  // ---------- hit testing ----------
  function hit(x, y) {
    const sch = A.doc.sch;
    for (let i = sch.labels.length - 1; i >= 0; i--) { const l = sch.labels[i], w = 0.4 + l.name.length * 0.6, left = labelLeft(sch, l); if (x >= (left ? l.x - w : l.x - 0.3) && x <= (left ? l.x + 0.3 : l.x + w) && y >= l.y - 1.2 && y <= l.y + 0.3) return { kind: 'label', i }; }
    for (let i = sch.parts.length - 1; i >= 0; i--) { const b = partBox(sch.parts[i]); if (x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]) return { kind: 'part', i, box: b }; }
    for (let i = sch.wires.length - 1; i >= 0; i--) { const w = sch.wires[i]; for (let k = 1; k < w.pts.length; k++) if (distSeg(x, y, w.pts[k - 1], w.pts[k]) < 0.4) return { kind: 'wire', i, seg: k }; }
    return null;
  }
  const distSeg = (x, y, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy; let t = L ? ((x - a[0]) * dx + (y - a[1]) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); };
  // a wire point that lands on a pin, a wire, or a label ends the wire there
  function connects(x, y) {
    const sch = A.doc.sch;
    if (sch.parts.some(p => Core.pinsOf(p).some(q => q.x === x && q.y === y))) return true;
    if (sch.labels.some(l => l.x === x && l.y === y)) return true;
    return sch.wires.some(w => w.pts.some((p, k) => k && distSeg(x, y, w.pts[k - 1], p) < 1e-6));
  }

  function finishWire() {
    if (!wire) return; const pts = wire.pts;
    // drop zero-length and collinear points
    const clean = []; pts.forEach(p => { if (clean.length && clean[clean.length - 1][0] === p[0] && clean[clean.length - 1][1] === p[1]) return; clean.push(p); });
    for (let i = clean.length - 2; i > 0; i--) { const a = clean[i - 1], b = clean[i], c = clean[i + 1]; if ((a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1])) clean.splice(i, 1); }
    wire = null; if (clean.length >= 2) A.commit('Draw wire', d => d.sch.wires.push({ pts: clean })); else draw();
  }

  function onDown(e) {
    if (e.button !== 0 || view.space) return;
    const [x, y] = view.eventWorld(e); mouse = [x, y]; const sx = snap(x), sy = snap(y);
    if (A.tool === 'wire') {
      if (!wire) { wire = { pts: [[sx, sy]], vfirst: false }; draw(); return; }
      const pts = previewPts(); wire.pts = pts.slice(0, -0); // includes corner + end
      if (connects(sx, sy) && wire.pts.length > 2) finishWire(); else draw();
      return;
    }
    if (A.tool === 'label') { Aero.prompt('Net label', 'Net name', A.lastLabel || 'NET1').then(name => { if (!name) return; A.lastLabel = name.replace(/\d+$/, m => String(+m + 1)); A.commit('Add label', d => d.sch.labels.push({ x: sx, y: sy, name: name.trim() })); }); return; }
    if (A.tool === 'place' && A.placing) {
      const pl = A.placing;
      A.commit('Place ' + LIB.PART[pl.lib].name, d => { d.sch.parts.push({ ref: LIB.PART[pl.lib].power ? '#PWR?' : LIB.PART[pl.lib].prefix + '?', lib: pl.lib, value: pl.value, fp: pl.fp, x: sx, y: sy, rot: pl.rot || 0, mirror: !!pl.mirror }); Core.annotate(d.sch); });
      if (!e.shiftKey && !LIB.PART[pl.lib].power) { /* keep placing more of the same, like KiCad */ }
      return;
    }
    // select / move
    const h = hit(x, y); A.select(h ? { kind: h.kind, i: h.i } : null);
    if (h && (h.kind === 'part' || h.kind === 'label')) {
      const sch = A.doc.sch, obj = h.kind === 'part' ? sch.parts[h.i] : sch.labels[h.i];
      const pins = h.kind === 'part' ? Core.pinsOf(obj).map(q => [q.x, q.y]) : [[obj.x, obj.y]];
      const ends = []; sch.wires.forEach((w, wi) => w.pts.forEach((p, pi) => { if (pins.some(q => q[0] === p[0] && q[1] === p[1])) ends.push([wi, pi]); }));
      drag = { h, sx, sy, ox: obj.x, oy: obj.y, ends, moved: false, before: JSON.stringify(A.doc) };
    }
  }
  function onMove(e) {
    const [x, y] = view.eventWorld(e); mouse = [x, y];
    if (drag) {
      const dx = snap(x) - drag.sx, dy = snap(y) - drag.sy, sch = A.doc.sch, obj = drag.h.kind === 'part' ? sch.parts[drag.h.i] : sch.labels[drag.h.i];
      if (dx || dy || drag.moved) {
        const px = obj.x, py = obj.y; obj.x = drag.ox + dx; obj.y = drag.oy + dy; drag.moved = true;
        drag.ends.forEach(([wi, pi]) => { const p = sch.wires[wi].pts[pi]; p[0] += obj.x - px; p[1] += obj.y - py; });
      }
    }
    if (A.tool === 'select' && !drag) { const h = hit(x, y); hover = h && h.box ? h.box : null; }
    draw();
  }
  function onUp() { if (drag) { const d = drag; drag = null; if (d.moved) A.commitMoved('Move', d.before); } }

  function rotateSel(dir = 1) {
    if (A.tool === 'place' && A.placing) { A.placing.rot = ((A.placing.rot || 0) + dir + 4) % 4; draw(); return; }
    if (!A.sel || A.sel.kind !== 'part') return;
    A.commit('Rotate', d => { const p = d.sch.parts[A.sel.i]; p.rot = ((p.rot || 0) + dir + 4) % 4; });
  }
  function mirrorSel() {
    if (A.tool === 'place' && A.placing) { A.placing.mirror = !A.placing.mirror; draw(); return; }
    if (!A.sel || A.sel.kind !== 'part') return; A.commit('Mirror', d => { const p = d.sch.parts[A.sel.i]; p.mirror = !p.mirror; });
  }
  function cancel() { if (wire) { finishWire(); return true; } if (A.tool !== 'select') { A.setTool('select'); return true; } return false; }

  function fit() {
    const sch = A.doc.sch; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const add = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    sch.parts.forEach(p => { const b = partBox(p); add(b[0], b[1]); add(b[2] + 4, b[3] + 1); }); sch.wires.forEach(w => w.pts.forEach(p => add(...p))); sch.labels.forEach(l => add(l.x, l.y));
    if (x0 === Infinity) { x0 = -20; y0 = -15; x1 = 20; y1 = 15; }
    view.fit(x0 - 2, y0 - 2, x1 + 2, y1 + 2);
  }

  function attach(app, canvas) {
    A = app; cv = canvas;
    view = new window.PcbView(canvas, { scale: 18, min: 3, max: 120, onChange: () => A.mode === 'sch' && draw() });
    canvas.addEventListener('pointerdown', e => A.mode === 'sch' && onDown(e));
    canvas.addEventListener('pointermove', e => A.mode === 'sch' && onMove(e));
    addEventListener('pointerup', e => A.mode === 'sch' && onUp(e));
    canvas.addEventListener('dblclick', e => { if (A.mode !== 'sch') return; if (A.tool === 'wire') finishWire(); else if (A.sel && A.sel.kind === 'part') A.editPart(); else if (A.sel && A.sel.kind === 'label') A.editLabel(); });
  }
  window.SchEditor = { attach, draw, fit, rotateSel, mirrorSel, cancel, toggleBend: () => { if (wire) { wire.vfirst = !wire.vfirst; draw(); } }, get view() { return view; }, junctions, partBox };
})();
