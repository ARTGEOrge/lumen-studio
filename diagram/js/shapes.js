'use strict';
/* Lumen Diagram — shape definitions and libraries.
   Each shape: { id, name, w, h, path(w,h,cell) → outline (M L C Q Z only), deco(w,h,cell) → [{d, s, f, sw, dash}],
   box(w,h,cell) → text rect {x,y,w,h,rot}, perimeter 'outline'|'rect'|'lifeline', ports [[px,py]], container {side,size},
   label 'below', obstacle false, style {...}, text '' }.  Colour keys in deco: 'S' stroke, 'F' fill, 'W' white, 'T' font colour. */
(function (root) {
  const G = typeof module !== 'undefined' && module.exports ? require('./geom.js') : root.DiaGeom;
  const { rect, rrect, ellipse, poly, arc } = G;
  const PI = Math.PI;
  const defs = {}, order = [];
  const def = (id, o) => { defs[id] = Object.assign({ id, w: 120, h: 60 }, o); order.push(id); return defs[id]; };
  // unit helper: coordinates in a 100×100 space scaled to w×h
  const U = (w, h) => {
    const X = v => v * w / 100, Y = v => v * h / 100;
    return {
      X, Y,
      r: (x, y, ww, hh, rad = 0) => rrect(X(x), Y(y), X(ww), Y(hh), rad * Math.min(w, h) / 100),
      e: (cx, cy, rx, ry) => ellipse(X(cx), Y(cy), X(rx), Y(ry ?? rx)),
      p: (pts, close = true) => poly(pts.map(([x, y]) => [X(x), Y(y)]), close),
      a: (cx, cy, rx, ry, a0, a1, move = true) => arc(X(cx), Y(cy), X(rx), Y(ry), a0 * PI / 180, a1 * PI / 180, move),
    };
  };
  const BOX = (w, h) => ({ x: 4, y: 4, w: w - 8, h: h - 8 });
  const inset = (fx, fy) => (w, h) => ({ x: w * fx, y: h * fy, w: w * (1 - 2 * fx), h: h * (1 - 2 * fy) });
  const below = (w, h) => ({ x: -40, y: h + 3, w: w + 80, h: 34, valign: 'top' });
  const R = (w, h) => rect(0, 0, w, h);

  /* ======================= Basic ======================= */
  def('rect', { name: 'Rectangle', path: (w, h, c) => c && c.style && c.style.rounded ? rrect(0, 0, w, h, Math.min(w, h) * 0.15) : R(w, h) });
  def('roundRect', { name: 'Rounded rectangle', path: (w, h) => rrect(0, 0, w, h, Math.min(w, h) * 0.18) });
  def('ellipse', { name: 'Ellipse', path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), box: inset(0.14, 0.14) });
  def('circle', { name: 'Circle', w: 80, h: 80, path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), box: inset(0.14, 0.14) });
  def('triangle', { name: 'Triangle', w: 90, h: 80, path: (w, h) => poly([[w / 2, 0], [w, h], [0, h]]), box: (w, h) => ({ x: w * 0.22, y: h * 0.4, w: w * 0.56, h: h * 0.56 }) });
  def('rightTriangle', { name: 'Right triangle', w: 80, h: 80, path: (w, h) => poly([[0, 0], [w, h], [0, h]]), box: (w, h) => ({ x: 4, y: h * 0.45, w: w * 0.55, h: h * 0.5 }) });
  def('diamond', { name: 'Diamond', w: 100, h: 80, path: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]), box: inset(0.2, 0.2) });
  def('pentagon', { name: 'Pentagon', w: 90, h: 86, path: (w, h) => poly([[w / 2, 0], [w, h * 0.38], [w * 0.81, h], [w * 0.19, h], [0, h * 0.38]]), box: inset(0.16, 0.2) });
  def('hexagon', { name: 'Hexagon', w: 120, h: 70, path: (w, h) => { const d = Math.min(w * 0.25, h * 0.5); return poly([[d, 0], [w - d, 0], [w, h / 2], [w - d, h], [d, h], [0, h / 2]]); }, box: inset(0.14, 0.08) });
  def('octagon', { name: 'Octagon', w: 80, h: 80, path: (w, h) => { const a = w * 0.29, b = h * 0.29; return poly([[a, 0], [w - a, 0], [w, b], [w, h - b], [w - a, h], [a, h], [0, h - b], [0, b]]); }, box: inset(0.1, 0.1) });
  def('star', { name: 'Star', w: 90, h: 86, path: (w, h) => { const pts = []; for (let i = 0; i < 10; i++) { const a = -PI / 2 + i * PI / 5, r = i % 2 ? 0.4 : 1; pts.push([w / 2 + Math.cos(a) * r * w / 2, h * 0.53 + Math.sin(a) * r * h * 0.53]); } return poly(pts); }, box: inset(0.3, 0.32) });
  def('parallelogram', { name: 'Parallelogram', path: (w, h) => { const d = Math.min(w * 0.2, h * 0.5); return poly([[d, 0], [w, 0], [w - d, h], [0, h]]); }, box: inset(0.18, 0.08) });
  def('trapezoid', { name: 'Trapezoid', path: (w, h) => { const d = Math.min(w * 0.2, h * 0.6); return poly([[d, 0], [w - d, 0], [w, h], [0, h]]); }, box: inset(0.15, 0.08) });
  def('cross', { name: 'Cross', w: 80, h: 80, path: (w, h) => { const a = w * 0.32, b = h * 0.32; return poly([[a, 0], [w - a, 0], [w - a, b], [w, b], [w, h - b], [w - a, h - b], [w - a, h], [a, h], [a, h - b], [0, h - b], [0, b], [a, b]]); }, box: inset(0.3, 0.3) });
  def('arrowRight', { name: 'Block arrow', w: 120, h: 60, path: (w, h) => { const hx = Math.min(w * 0.4, h * 0.8); return poly([[0, h * 0.25], [w - hx, h * 0.25], [w - hx, 0], [w, h / 2], [w - hx, h], [w - hx, h * 0.75], [0, h * 0.75]]); }, box: (w, h) => ({ x: 4, y: h * 0.25, w: w * 0.75, h: h * 0.5 }) });
  def('arrowDouble', { name: 'Double arrow', w: 140, h: 60, path: (w, h) => { const hx = Math.min(w * 0.3, h * 0.8); return poly([[0, h / 2], [hx, 0], [hx, h * 0.25], [w - hx, h * 0.25], [w - hx, 0], [w, h / 2], [w - hx, h], [w - hx, h * 0.75], [hx, h * 0.75], [hx, h]]); }, box: (w, h) => ({ x: w * 0.18, y: h * 0.25, w: w * 0.64, h: h * 0.5 }) });
  def('chevron', { name: 'Chevron', w: 120, h: 60, path: (w, h) => { const d = Math.min(w * 0.3, h * 0.5); return poly([[0, 0], [w - d, 0], [w, h / 2], [w - d, h], [0, h], [d, h / 2]]); }, box: inset(0.22, 0.08) });
  def('callout', { name: 'Callout', w: 130, h: 80, path: (w, h) => { const b = h * 0.72, r = Math.min(10, w * 0.1, b * 0.2); return `M${r} 0 L${w - r} 0 Q${w} 0 ${w} ${r} L${w} ${b - r} Q${w} ${b} ${w - r} ${b} L${w * 0.45} ${b} L${w * 0.22} ${h} L${w * 0.28} ${b} L${r} ${b} Q0 ${b} 0 ${b - r} L0 ${r} Q0 0 ${r} 0 Z`; }, box: (w, h) => ({ x: 6, y: 4, w: w - 12, h: h * 0.72 - 8 }) });
  const cloudPath = (w, h) => { const u = U(w, h); return `M${u.X(25)} ${u.Y(88)} C${u.X(5)} ${u.Y(88)} ${u.X(0)} ${u.Y(62)} ${u.X(15)} ${u.Y(55)} C${u.X(5)} ${u.Y(35)} ${u.X(25)} ${u.Y(18)} ${u.X(40)} ${u.Y(28)} C${u.X(45)} ${u.Y(8)} ${u.X(75)} ${u.Y(8)} ${u.X(78)} ${u.Y(30)} C${u.X(95)} ${u.Y(28)} ${u.X(102)} ${u.Y(50)} ${u.X(90)} ${u.Y(60)} C${u.X(102)} ${u.Y(75)} ${u.X(90)} ${u.Y(92)} ${u.X(75)} ${u.Y(88)} Z`; };
  def('cloud', { name: 'Cloud', w: 130, h: 80, path: cloudPath, box: (w, h) => ({ x: w * 0.18, y: h * 0.3, w: w * 0.66, h: h * 0.5 }) });
  const cylPath = (w, h) => { const e = Math.min(h * 0.15, 14); return `M0 ${e} C0 ${-e / 3} ${w} ${-e / 3} ${w} ${e} L${w} ${h - e} C${w} ${h + e / 3} 0 ${h + e / 3} 0 ${h - e} Z`; };
  const cylDeco = (w, h) => { const e = Math.min(h * 0.15, 14); return [{ d: `M0 ${e} C0 ${e * 7 / 3} ${w} ${e * 7 / 3} ${w} ${e}` }]; };
  def('cylinder', { name: 'Cylinder', w: 80, h: 100, path: cylPath, deco: cylDeco, box: (w, h) => ({ x: 4, y: Math.min(h * 0.15, 14) * 2, w: w - 8, h: h - Math.min(h * 0.15, 14) * 3 }) });
  def('cube', { name: 'Cube', w: 100, h: 90, path: (w, h) => { const d = Math.min(w, h) * 0.2; return poly([[d, 0], [w, 0], [w, h - d], [w - d, h], [0, h], [0, d]]); }, deco: (w, h) => { const d = Math.min(w, h) * 0.2; return [{ d: `M0 ${d} L${w - d} ${d} L${w} 0 M${w - d} ${d} L${w - d} ${h}` }]; }, box: (w, h) => { const d = Math.min(w, h) * 0.2; return { x: 4, y: d + 4, w: w - d - 8, h: h - d - 8 }; } });
  def('note', { name: 'Note', w: 110, h: 80, style: { fill: '#fff8c4', stroke: '#b5a642' }, path: (w, h) => { const d = Math.min(w, h) * 0.2; return poly([[0, 0], [w - d, 0], [w, d], [w, h], [0, h]]); }, deco: (w, h) => { const d = Math.min(w, h) * 0.2; return [{ d: `M${w - d} 0 L${w - d} ${d} L${w} ${d}` }]; } });
  def('text', { name: 'Text', w: 120, h: 30, text: 'Text', obstacle: false, perimeter: 'rect', style: { fill: 'none', stroke: 'none' }, path: R });
  def('heading', { name: 'Heading', w: 220, h: 36, text: 'Heading', obstacle: false, perimeter: 'rect', style: { fill: 'none', stroke: 'none', fontSize: 20, bold: true }, path: R });
  def('image', { name: 'Image', w: 120, h: 90, perimeter: 'rect', style: { fill: 'none', stroke: 'none' }, path: R, label: 'below', box: below });

  /* ======================= Flowchart ======================= */
  def('process', { name: 'Process', path: R });
  def('terminator', { name: 'Terminator', w: 120, h: 50, path: (w, h) => rrect(0, 0, w, h, h / 2), box: inset(0.12, 0.08) });
  def('decision', { name: 'Decision', w: 110, h: 80, path: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]), box: inset(0.2, 0.2) });
  def('data', { name: 'Data (I/O)', path: (w, h) => { const d = Math.min(w * 0.2, h * 0.5); return poly([[d, 0], [w, 0], [w - d, h], [0, h]]); }, box: inset(0.18, 0.08) });
  def('predefined', { name: 'Predefined process', path: R, deco: (w, h) => { const d = Math.min(12, w * 0.1); return [{ d: `M${d} 0 L${d} ${h} M${w - d} 0 L${w - d} ${h}` }]; }, box: (w, h) => { const d = Math.min(12, w * 0.1); return { x: d + 3, y: 4, w: w - 2 * d - 6, h: h - 8 }; } });
  const docPath = (w, h) => `M0 0 L${w} 0 L${w} ${h * 0.85} C${w * 0.75} ${h * 0.68} ${w * 0.5} ${h * 0.75} ${w * 0.5} ${h * 0.85} C${w * 0.5} ${h * 0.95} ${w * 0.25} ${h * 1.02} 0 ${h * 0.85} Z`;
  def('document', { name: 'Document', w: 120, h: 70, path: docPath, box: (w, h) => ({ x: 4, y: 4, w: w - 8, h: h * 0.75 - 6 }) });
  def('multiDocument', { name: 'Multiple documents', w: 120, h: 75, path: (w, h) => { const o = 6; return G.transform(docPath(w - 2 * o, h - 2 * o), (x, y) => [x, y + 2 * o]) + ` M${o} ${2 * o} L${o} ${o} L${w - o} ${o} L${w - o} ${h * 0.75} L${w - 2 * o} ${h * 0.77} M${2 * o} ${o} L${2 * o} 0 L${w} 0 L${w} ${h * 0.68} L${w - o} ${h * 0.7}`; }, box: (w, h) => ({ x: 4, y: 16, w: w - 20, h: h * 0.62 - 8 }) });
  def('manualInput', { name: 'Manual input', path: (w, h) => poly([[0, h * 0.3], [w, 0], [w, h], [0, h]]), box: (w, h) => ({ x: 4, y: h * 0.3, w: w - 8, h: h * 0.66 }) });
  def('manualOperation', { name: 'Manual operation', path: (w, h) => { const d = Math.min(w * 0.18, h * 0.6); return poly([[0, 0], [w, 0], [w - d, h], [d, h]]); }, box: inset(0.18, 0.08) });
  def('preparation', { name: 'Preparation', path: (w, h) => { const d = Math.min(w * 0.2, h * 0.5); return poly([[d, 0], [w - d, 0], [w, h / 2], [w - d, h], [d, h], [0, h / 2]]); }, box: inset(0.16, 0.08) });
  def('delay', { name: 'Delay', path: (w, h) => { const r = Math.min(h / 2, w / 2); return `M0 0 L${w - r} 0 C${w - r + r * G.K} 0 ${w} ${h / 2 - h / 2 * G.K} ${w} ${h / 2} C${w} ${h / 2 + h / 2 * G.K} ${w - r + r * G.K} ${h} ${w - r} ${h} L0 ${h} Z`; }, box: (w, h) => ({ x: 4, y: 4, w: w - Math.min(h / 2, w / 2) * 0.6 - 8, h: h - 8 }) });
  def('display', { name: 'Display', path: (w, h) => { const d = Math.min(w * 0.18, h * 0.5), r = Math.min(w * 0.15, h / 2); return `M0 ${h / 2} L${d} 0 L${w - r} 0 C${w - r + r * G.K} 0 ${w} ${h / 2 - h / 2 * G.K} ${w} ${h / 2} C${w} ${h / 2 + h / 2 * G.K} ${w - r + r * G.K} ${h} ${w - r} ${h} L${d} ${h} Z`; }, box: inset(0.16, 0.08) });
  def('storedData', { name: 'Stored data', path: (w, h) => { const r = Math.min(w * 0.15, h / 2); return `M${r} 0 L${w} 0 C${w - r * G.K * 1.4} 0 ${w - r} ${h / 2 - h / 2 * G.K} ${w - r} ${h / 2} C${w - r} ${h / 2 + h / 2 * G.K} ${w - r * G.K * 1.4} ${h} ${w} ${h} L${r} ${h} C${r - r * G.K * 1.4} ${h} 0 ${h / 2 + h / 2 * G.K} 0 ${h / 2} C0 ${h / 2 - h / 2 * G.K} ${r - r * G.K * 1.4} 0 ${r} 0 Z`; }, box: inset(0.14, 0.08) });
  def('database', { name: 'Database', w: 80, h: 90, path: cylPath, deco: cylDeco, box: (w, h) => ({ x: 4, y: Math.min(h * 0.15, 14) * 2, w: w - 8, h: h - Math.min(h * 0.15, 14) * 3 }) });
  def('internalStorage', { name: 'Internal storage', w: 100, h: 80, path: R, deco: (w, h) => [{ d: `M${Math.min(14, w * 0.15)} 0 L${Math.min(14, w * 0.15)} ${h} M0 ${Math.min(14, h * 0.18)} L${w} ${Math.min(14, h * 0.18)}` }], box: (w, h) => ({ x: Math.min(14, w * 0.15) + 3, y: Math.min(14, h * 0.18) + 3, w: w - Math.min(14, w * 0.15) - 6, h: h - Math.min(14, h * 0.18) - 6 }) });
  def('offPage', { name: 'Off-page connector', w: 70, h: 70, path: (w, h) => poly([[0, 0], [w, 0], [w, h * 0.65], [w / 2, h], [0, h * 0.65]]), box: (w, h) => ({ x: 4, y: 4, w: w - 8, h: h * 0.62 }) });
  def('connector', { name: 'On-page connector', w: 50, h: 50, path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), box: inset(0.12, 0.12) });
  def('merge', { name: 'Merge', w: 80, h: 70, path: (w, h) => poly([[0, 0], [w, 0], [w / 2, h]]), box: (w, h) => ({ x: w * 0.2, y: 3, w: w * 0.6, h: h * 0.45 }) });
  def('extract', { name: 'Extract', w: 80, h: 70, path: (w, h) => poly([[w / 2, 0], [w, h], [0, h]]), box: (w, h) => ({ x: w * 0.2, y: h * 0.48, w: w * 0.6, h: h * 0.48 }) });
  def('summingJunction', { name: 'Summing junction', w: 60, h: 60, path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), deco: (w, h) => { const a = 0.3536; return [{ d: `M${w * (0.5 - a)} ${h * (0.5 - a)} L${w * (0.5 + a)} ${h * (0.5 + a)} M${w * (0.5 + a)} ${h * (0.5 - a)} L${w * (0.5 - a)} ${h * (0.5 + a)}` }]; }, box: below, label: 'below' });
  def('or', { name: 'Or', w: 60, h: 60, path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), deco: (w, h) => [{ d: `M${w / 2} 0 L${w / 2} ${h} M0 ${h / 2} L${w} ${h / 2}` }], box: below, label: 'below' });
  def('card', { name: 'Card', path: (w, h) => { const d = Math.min(w, h) * 0.25; return poly([[d, 0], [w, 0], [w, h], [0, h], [0, d]]); } });
  def('tape', { name: 'Punched tape', w: 120, h: 70, path: (w, h) => { const a = h * 0.12; return `M0 ${a} C${w * 0.25} ${a * 3} ${w * 0.25} ${-a} ${w / 2} ${a} C${w * 0.75} ${a * 3} ${w * 0.75} ${-a} ${w} ${a} L${w} ${h - a} C${w * 0.75} ${h - 3 * a} ${w * 0.75} ${h + a} ${w / 2} ${h - a} C${w * 0.25} ${h - 3 * a} ${w * 0.25} ${h + a} 0 ${h - a} Z`; }, box: inset(0.04, 0.2) });
  def('annotation', { name: 'Annotation', w: 120, h: 60, obstacle: false, style: { fill: 'none' }, perimeter: 'rect', path: R, strokePath: (w, h) => `M${Math.min(16, w * 0.2)} 0 L0 0 L0 ${h} L${Math.min(16, w * 0.2)} ${h}`, box: (w, h) => ({ x: 8, y: 2, w: w - 10, h: h - 4 }), style2: { align: 'left' } });

  /* ======================= Containers ======================= */
  const laneTop = (w, h, c) => { const s = c && c.style && c.style.header || 30; return [{ d: `M0 ${s} L${w} ${s}` }]; };
  const laneLeft = (w, h, c) => { const s = c && c.style && c.style.header || 30; return [{ d: `M${s} 0 L${s} ${h}` }]; };
  def('swimlane', { name: 'Swimlane', w: 220, h: 300, container: { side: 'top' }, obstacle: false, perimeter: 'rect', style: { fill: '#dae8fc', stroke: '#6c8ebf', bold: true, header: 30, bodyFill: '#ffffff' }, path: R, deco: laneTop, box: (w, h, c) => ({ x: 4, y: 0, w: w - 8, h: (c && c.style && c.style.header) || 30 }) });
  def('lane', { name: 'Swimlane (horizontal)', w: 640, h: 160, container: { side: 'left' }, obstacle: false, perimeter: 'rect', style: { fill: '#dae8fc', stroke: '#6c8ebf', bold: true, header: 30, bodyFill: '#ffffff' }, path: R, deco: laneLeft, box: (w, h, c) => { const s = (c && c.style && c.style.header) || 30; return { x: 0, y: 4, w: s, h: h - 8, rot: -90 }; } });
  def('container', { name: 'Container', w: 260, h: 180, container: { side: 'top' }, obstacle: false, perimeter: 'rect', style: { fill: '#f5f7fa', stroke: '#8a9bb0', valign: 'top', bold: true, dash: 'dash', header: 0 }, path: (w, h) => rrect(0, 0, w, h, 8), box: (w, h) => ({ x: 8, y: 4, w: w - 16, h: 22, valign: 'top' }) });
  def('group', { name: 'Group frame', w: 260, h: 180, container: { side: 'top' }, obstacle: false, perimeter: 'rect', style: { fill: 'none', stroke: '#7a8796', dash: 'dash', valign: 'top', align: 'left' }, path: (w, h) => rrect(0, 0, w, h, 10), box: (w, h) => ({ x: 10, y: 4, w: w - 20, h: 22, valign: 'top' }) });

  /* ======================= UML ======================= */
  def('umlClass', { name: 'Class', w: 170, h: 120, perimeter: 'rect', text: 'ClassName\n--\n- field: Type\n--\n+ method(): Type', style: { fill: '#ffffff', stroke: '#3c5a80', align: 'left' }, sections: true, path: R });
  def('umlInterface', { name: 'Interface', w: 170, h: 90, perimeter: 'rect', text: '«interface»\nName\n--\n+ operation(): void', style: { fill: '#ffffff', stroke: '#3c5a80', align: 'left' }, sections: true, path: R });
  def('umlEnum', { name: 'Enumeration', w: 150, h: 110, perimeter: 'rect', text: '«enumeration»\nStatus\n--\nNEW\nPAID\nSHIPPED', style: { fill: '#ffffff', stroke: '#3c5a80', align: 'left' }, sections: true, path: R });
  def('umlObject', { name: 'Object', w: 150, h: 60, text: 'order : Order', style: { underline: true }, path: R });
  def('package', { name: 'Package', w: 160, h: 110, container: { side: 'top' }, obstacle: false, perimeter: 'rect', style: { valign: 'top', bold: true, header: 0 }, path: (w, h) => { const tw = Math.min(w * 0.45, 80), th = 18; return `M0 0 L${tw} 0 L${tw} ${th} L${w} ${th} L${w} ${h} L0 ${h} Z`; }, deco: (w) => [{ d: `M0 18 L${Math.min(w * 0.45, 80)} 18` }], box: (w) => ({ x: 6, y: 20, w: w - 12, h: 22, valign: 'top' }) });
  def('component', { name: 'Component', w: 150, h: 70, path: R, deco: (w) => [{ d: rect(w - 26, 8, 16, 18) + ' ' + rect(w - 30, 11, 8, 4) + ' ' + rect(w - 30, 19, 8, 4), f: 'F' }], box: (w, h) => ({ x: 6, y: 4, w: w - 40, h: h - 8 }) });
  def('umlNode', { name: 'Node', w: 140, h: 90, path: (w, h) => { const d = 12; return poly([[0, d], [d, 0], [w, 0], [w, h - d], [w - d, h], [0, h]]); }, deco: (w, h) => [{ d: `M0 12 L${w - 12} 12 L${w} 0 M${w - 12} 12 L${w - 12} ${h}` }], box: (w, h) => ({ x: 4, y: 16, w: w - 20, h: h - 20 }) });
  const actorPath = (w, h) => { const u = U(w, h); return u.e(50, 11, 11, 11) + ' ' + `M${u.X(50)} ${u.Y(22)} L${u.X(50)} ${u.Y(60)} M${u.X(15)} ${u.Y(34)} L${u.X(85)} ${u.Y(34)} M${u.X(50)} ${u.Y(60)} L${u.X(18)} ${u.Y(98)} M${u.X(50)} ${u.Y(60)} L${u.X(82)} ${u.Y(98)}`; };
  def('actor', { name: 'Actor', w: 40, h: 76, label: 'below', perimeter: 'rect', text: 'Actor', path: R, invisible: true, deco: (w, h) => [{ d: actorPath(w, h), f: 'F' }], box: below });
  def('useCase', { name: 'Use case', w: 140, h: 70, path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), box: inset(0.14, 0.14) });
  def('boundary', { name: 'System boundary', w: 280, h: 320, container: { side: 'top' }, obstacle: false, perimeter: 'rect', style: { valign: 'top', bold: true, header: 0 }, path: R, box: (w) => ({ x: 6, y: 6, w: w - 12, h: 22, valign: 'top' }) });
  def('lifeline', { name: 'Lifeline', w: 110, h: 320, perimeter: 'lifeline', obstacle: false, text: ':Object', ports: [[0.5, 0]], path: (w) => rect(0, 0, w, 40), deco: (w, h) => [{ d: `M${w / 2} 40 L${w / 2} ${h}`, dash: 'dash' }], box: (w) => ({ x: 3, y: 3, w: w - 6, h: 34 }) });
  def('actorLifeline', { name: 'Actor lifeline', w: 110, h: 320, perimeter: 'lifeline', obstacle: false, text: 'User', ports: [[0.5, 0]], path: (w) => rect(w / 2 - 15, 0, 30, 56), invisible: true, deco: (w, h) => [{ d: G.transform(actorPath(30, 56), (x, y) => [x + w / 2 - 15, y]), f: 'F' }, { d: `M${w / 2} 74 L${w / 2} ${h}`, dash: 'dash' }], box: (w) => ({ x: 0, y: 56, w, h: 18 }) });
  def('activation', { name: 'Activation', w: 14, h: 80, perimeter: 'rect', obstacle: false, path: R, style: { fill: '#f2f2f2' } });
  def('fragment', { name: 'Combined fragment', w: 300, h: 140, container: { side: 'top' }, obstacle: false, perimeter: 'rect', text: 'alt', style: { fill: 'none', align: 'left', valign: 'top', bold: true, header: 0 }, path: R, deco: (w) => [{ d: `M0 20 L${Math.min(60, w * 0.4)} 20 L${Math.min(60, w * 0.4) + 8} 12 L${Math.min(60, w * 0.4) + 8} 0` }], box: (w) => ({ x: 6, y: 2, w: Math.min(60, w * 0.4), h: 18 }) });
  def('destroy', { name: 'Destruction', w: 24, h: 24, perimeter: 'rect', obstacle: false, path: R, invisible: true, deco: (w, h) => [{ d: `M0 0 L${w} ${h} M${w} 0 L0 ${h}`, sw: 2.5 }] });
  def('initial', { name: 'Initial state', w: 30, h: 30, path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), style: { fill: '#1f2933', stroke: '#1f2933' }, label: 'below', box: below });
  def('final', { name: 'Final state', w: 32, h: 32, path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), deco: (w, h) => [{ d: ellipse(w / 2, h / 2, w * 0.3, h * 0.3), f: 'S' }], label: 'below', box: below });
  def('state', { name: 'State', w: 130, h: 56, path: (w, h) => rrect(0, 0, w, h, 14) });
  def('forkBar', { name: 'Fork / join', w: 140, h: 8, path: R, style: { fill: '#1f2933', stroke: '#1f2933' }, label: 'below', box: below });

  /* ======================= Org chart ======================= */
  def('orgCard', { name: 'Manager card', w: 170, h: 64, text: 'Name\nTitle', firstBold: true, style: { fill: '#ffffff', stroke: '#2f6db5', sw: 1.2, accent: '#2f6db5' }, path: (w, h) => rrect(0, 0, w, h, 6), deco: (w, h, c) => [{ d: `M0 6 C0 2 2 0 6 0 L${w - 6} 0 C${w - 2} 0 ${w} 2 ${w} 6 L${w} 8 L0 8 Z`, f: (c && c.style && c.style.accent) || 'S', s: null }], box: (w, h) => ({ x: 6, y: 10, w: w - 12, h: h - 14 }) });
  def('orgPerson', { name: 'Employee card', w: 170, h: 60, text: 'Name\nTitle', firstBold: true, style: { fill: '#ffffff', stroke: '#8aa4c4', sw: 1.2, accent: '#4a90d9', align: 'left' }, path: (w, h) => rrect(0, 0, w, h, 6), deco: (w, h, c) => { const ac = (c && c.style && c.style.accent) || 'S', r = Math.min(16, h * 0.3); return [{ d: ellipse(10 + r, h / 2, r, r), f: ac, s: null }, { d: ellipse(10 + r, h / 2 - r * 0.25, r * 0.36, r * 0.36) + ' ' + `M${10 + r * 0.35} ${h / 2 + r * 0.75} C${10 + r * 0.5} ${h / 2 + r * 0.05} ${10 + r * 1.5} ${h / 2 + r * 0.05} ${10 + r * 1.65} ${h / 2 + r * 0.75} Z`, f: 'W', s: null }]; }, box: (w, h) => { const r = Math.min(16, h * 0.3); return { x: 18 + 2 * r, y: 4, w: w - 24 - 2 * r, h: h - 8 }; } });
  def('orgAssistant', { name: 'Assistant card', w: 150, h: 54, text: 'Name\nAssistant', firstBold: true, style: { fill: '#f7f9fc', stroke: '#8aa4c4', sw: 1.2, dash: 'dash' }, path: (w, h) => rrect(0, 0, w, h, 6) });

  /* ======================= BPMN ======================= */
  def('bpmnTask', { name: 'Task', w: 120, h: 70, path: (w, h) => rrect(0, 0, w, h, 10) });
  def('bpmnSubprocess', { name: 'Sub-process', w: 130, h: 80, path: (w, h) => rrect(0, 0, w, h, 10), deco: (w, h) => [{ d: rect(w / 2 - 7, h - 16, 14, 14) + ` M${w / 2 - 4} ${h - 9} L${w / 2 + 4} ${h - 9} M${w / 2} ${h - 13} L${w / 2} ${h - 5}`, sw: 1 }], box: (w, h) => ({ x: 4, y: 4, w: w - 8, h: h - 22 }) });
  def('bpmnCall', { name: 'Call activity', w: 120, h: 70, style: { sw: 3.5 }, path: (w, h) => rrect(0, 0, w, h, 10) });
  def('bpmnStart', { name: 'Start event', w: 40, h: 40, style: { fill: '#e3f5e1', stroke: '#3f8f3a', sw: 1.5 }, label: 'below', box: below, path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2) });
  def('bpmnIntermediate', { name: 'Intermediate event', w: 40, h: 40, style: { fill: '#fff6e0', stroke: '#b07d18' }, label: 'below', box: below, path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), deco: (w, h) => [{ d: ellipse(w / 2, h / 2, w / 2 - 3.5, h / 2 - 3.5) }] });
  def('bpmnTimer', { name: 'Timer event', w: 40, h: 40, style: { fill: '#fff6e0', stroke: '#b07d18' }, label: 'below', box: below, path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), deco: (w, h) => { let ticks = ''; for (let i = 0; i < 12; i++) { const a = i * PI / 6, r1 = w / 2 - 9, r2 = w / 2 - 6.5; ticks += ` M${w / 2 + Math.cos(a) * r1} ${h / 2 + Math.sin(a) * r1} L${w / 2 + Math.cos(a) * r2} ${h / 2 + Math.sin(a) * r2}`; } return [{ d: ellipse(w / 2, h / 2, w / 2 - 3.5, h / 2 - 3.5) }, { d: ellipse(w / 2, h / 2, w / 2 - 6, h / 2 - 6) + ticks + ` M${w / 2} ${h / 2} L${w / 2} ${h / 2 - w * 0.22} M${w / 2} ${h / 2} L${w / 2 + w * 0.16} ${h / 2}`, sw: 1 }]; } });
  def('bpmnMessage', { name: 'Message event', w: 40, h: 40, style: { fill: '#fff6e0', stroke: '#b07d18' }, label: 'below', box: below, path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), deco: (w, h) => [{ d: ellipse(w / 2, h / 2, w / 2 - 3.5, h / 2 - 3.5) }, { d: rect(w * 0.27, h * 0.34, w * 0.46, h * 0.32) + ` M${w * 0.27} ${h * 0.34} L${w / 2} ${h * 0.52} L${w * 0.73} ${h * 0.34}`, sw: 1.2 }] });
  def('bpmnEnd', { name: 'End event', w: 40, h: 40, style: { fill: '#fbe3e3', stroke: '#b23b3b', sw: 4 }, label: 'below', box: below, path: (w, h) => ellipse(w / 2, h / 2, w / 2 - 1, h / 2 - 1) });
  def('bpmnGateway', { name: 'Gateway', w: 50, h: 50, style: { fill: '#fffbe6', stroke: '#b59a1c' }, label: 'below', box: below, path: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]) });
  def('bpmnExclusive', { name: 'Exclusive gateway', w: 50, h: 50, style: { fill: '#fffbe6', stroke: '#b59a1c' }, label: 'below', box: below, path: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]), deco: (w, h) => [{ d: `M${w * 0.35} ${h * 0.35} L${w * 0.65} ${h * 0.65} M${w * 0.65} ${h * 0.35} L${w * 0.35} ${h * 0.65}`, sw: 3 }] });
  def('bpmnParallel', { name: 'Parallel gateway', w: 50, h: 50, style: { fill: '#fffbe6', stroke: '#b59a1c' }, label: 'below', box: below, path: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]), deco: (w, h) => [{ d: `M${w / 2} ${h * 0.28} L${w / 2} ${h * 0.72} M${w * 0.28} ${h / 2} L${w * 0.72} ${h / 2}`, sw: 3 }] });
  def('bpmnInclusive', { name: 'Inclusive gateway', w: 50, h: 50, style: { fill: '#fffbe6', stroke: '#b59a1c' }, label: 'below', box: below, path: (w, h) => poly([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]]), deco: (w, h) => [{ d: ellipse(w / 2, h / 2, w * 0.2, h * 0.2), sw: 2.5 }] });
  def('bpmnData', { name: 'Data object', w: 40, h: 54, label: 'below', box: below, path: (w, h) => { const d = Math.min(w, h) * 0.3; return poly([[0, 0], [w - d, 0], [w, d], [w, h], [0, h]]); }, deco: (w, h) => { const d = Math.min(w, h) * 0.3; return [{ d: `M${w - d} 0 L${w - d} ${d} L${w} ${d}` }]; } });
  def('bpmnStore', { name: 'Data store', w: 60, h: 56, label: 'below', box: below, path: cylPath, deco: cylDeco });
  def('pool', { name: 'Pool', w: 700, h: 300, container: { side: 'left' }, obstacle: false, perimeter: 'rect', style: { fill: '#eef3f9', stroke: '#5a7090', bold: true, header: 30, bodyFill: '#ffffff' }, path: R, deco: laneLeft, box: (w, h, c) => { const s = (c && c.style && c.style.header) || 30; return { x: 0, y: 4, w: s, h: h - 8, rot: -90 }; } });

  /* ======================= Network ======================= */
  const NET = { fill: '#3b7dd8', stroke: '#1d4f91', fontColor: '#1f2933', sw: 1.2 };
  const netDef = (id, name, w, h, path, deco) => def(id, { name, w, h, label: 'below', perimeter: 'rect', box: below, style: { ...NET }, path, deco });
  netDef('server', 'Server', 50, 70, (w, h) => U(w, h).r(15, 0, 70, 100, 8), (w, h) => { const u = U(w, h); return [{ d: [16, 30, 44].map(y => u.r(25, y, 50, 9, 2)).join(' '), f: 'W', s: null, op: 0.9 }, { d: u.e(35, 80, 4.5, 3.2) + ' ' + u.e(50, 80, 4.5, 3.2), f: '#7ee07e', s: null }]; });
  netDef('desktop', 'Workstation', 70, 62, (w, h) => { const u = U(w, h); return u.r(0, 0, 100, 74, 5) + ' ' + u.p([[40, 74], [60, 74], [64, 90], [36, 90]]) + ' ' + u.r(22, 90, 56, 10, 3); }, (w, h) => [{ d: U(w, h).r(6, 7, 88, 60, 2), f: '#cfe5ff', s: null }]);
  netDef('laptop', 'Laptop', 76, 52, (w, h) => { const u = U(w, h); return u.r(12, 0, 76, 76, 5) + ' ' + u.p([[0, 82], [100, 82], [94, 100], [6, 100]]); }, (w, h) => [{ d: U(w, h).r(17, 8, 66, 60, 2), f: '#cfe5ff', s: null }]);
  netDef('router', 'Router', 70, 50, (w, h) => `M0 ${h * 0.3} C0 ${-h * 0.08} ${w} ${-h * 0.08} ${w} ${h * 0.3} L${w} ${h * 0.7} C${w} ${h * 1.08} 0 ${h * 1.08} 0 ${h * 0.7} Z`, (w, h) => { const u = U(w, h); return [{ d: `M0 ${h * 0.3} C0 ${h * 0.68} ${w} ${h * 0.68} ${w} ${h * 0.3}` }, { d: u.p([[30, 18], [44, 26], [40, 28], [52, 34], [48, 36], [36, 30], [32, 32]]) + ' ' + u.p([[70, 42], [56, 34], [60, 32], [48, 26], [52, 24], [64, 30], [68, 28]]), f: 'W', s: null }]; });
  netDef('switch', 'Switch', 90, 36, (w, h) => U(w, h).r(0, 0, 100, 100, 8), (w, h) => { const u = U(w, h); let d = ''; for (let i = 0; i < 6; i++) d += u.r(8 + i * 14.5, 52, 10, 26, 2) + ' '; return [{ d, f: 'W', s: null, op: 0.9 }, { d: u.p([[10, 22], [36, 22], [36, 16], [46, 28], [36, 40], [36, 34], [10, 34]]) + ' ' + u.p([[90, 22], [64, 22], [64, 16], [54, 28], [64, 40], [64, 34], [90, 34]]), f: 'W', s: null }]; });
  netDef('firewall', 'Firewall', 70, 56, (w, h) => U(w, h).r(0, 0, 100, 100, 3), (w, h) => { const u = U(w, h); let d = ''; for (let r = 1; r < 4; r++) d += ` M0 ${u.Y(r * 25)} L${w} ${u.Y(r * 25)}`; for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) { const x = u.X((r % 2 ? 16.6 : 33.3) + c * 33.3); if (x < w - 1) d += ` M${x} ${u.Y(r * 25)} L${x} ${u.Y(r * 25 + 25)}`; } return [{ d, s: 'W', sw: 1.5 }]; });
  def('internet', { name: 'Internet', w: 100, h: 64, label: 'below', perimeter: 'rect', box: below, style: { fill: '#e7f1fd', stroke: '#3b7dd8', sw: 1.5 }, path: cloudPath, deco: (w, h) => { const u = U(w, h); return [{ d: u.e(52, 54, 18, 22) + ` M${u.X(34)} ${u.Y(54)} L${u.X(70)} ${u.Y(54)} M${u.X(52)} ${u.Y(32)} C${u.X(42)} ${u.Y(44)} ${u.X(42)} ${u.Y(64)} ${u.X(52)} ${u.Y(76)} C${u.X(62)} ${u.Y(64)} ${u.X(62)} ${u.Y(44)} ${u.X(52)} ${u.Y(32)}`, sw: 1.2 }]; } });
  netDef('netDatabase', 'Database server', 54, 64, cylPath, (w, h) => { const e = Math.min(h * 0.15, 14); return [{ d: `M0 ${e} C0 ${e * 7 / 3} ${w} ${e * 7 / 3} ${w} ${e} M0 ${h * 0.42} C0 ${h * 0.42 + e * 4 / 3} ${w} ${h * 0.42 + e * 4 / 3} ${w} ${h * 0.42} M0 ${h * 0.68} C0 ${h * 0.68 + e * 4 / 3} ${w} ${h * 0.68 + e * 4 / 3} ${w} ${h * 0.68}`, s: 'W', sw: 1.4 }]; });
  netDef('mobile', 'Phone', 34, 60, (w, h) => U(w, h).r(0, 0, 100, 100, 18), (w, h) => { const u = U(w, h); return [{ d: u.r(10, 10, 80, 74, 3), f: '#cfe5ff', s: null }, { d: u.e(50, 92, 7, 4), f: 'W', s: null }]; });
  netDef('printer', 'Printer', 64, 54, (w, h) => { const u = U(w, h); return u.r(0, 32, 100, 48, 6) + ' ' + u.p([[20, 32], [20, 0], [80, 0], [80, 32]]); }, (w, h) => { const u = U(w, h); return [{ d: u.r(18, 68, 64, 32, 2), f: 'W', s: 'S' }, { d: u.e(86, 46, 4, 5), f: '#7ee07e', s: null }]; });
  netDef('wireless', 'Wireless AP', 60, 50, (w, h) => { const u = U(w, h); return `M${u.X(10)} ${u.Y(100)} L${u.X(10)} ${u.Y(80)} C${u.X(10)} ${u.Y(62)} ${u.X(90)} ${u.Y(62)} ${u.X(90)} ${u.Y(80)} L${u.X(90)} ${u.Y(100)} Z`; }, (w, h) => { const u = U(w, h); return [{ d: u.a(50, 58, 16, 18, 215, 325) + ' ' + u.a(50, 58, 30, 34, 215, 325) + ' ' + u.a(50, 58, 44, 50, 215, 325), s: 'F', sw: 3 }, { d: u.e(85, 89, 2.8, 3.4), f: '#7ee07e', s: null }]; });
  netDef('user', 'User', 44, 54, (w, h) => { const u = U(w, h); return u.e(50, 26, 24, 24) + ' ' + `M0 ${h} C0 ${u.Y(62)} ${u.X(20)} ${u.Y(55)} ${u.X(50)} ${u.Y(55)} C${u.X(80)} ${u.Y(55)} ${w} ${u.Y(62)} ${w} ${h} Z`; });
  netDef('loadBalancer', 'Load balancer', 70, 40, (w, h) => U(w, h).r(0, 0, 100, 100, 50), (w, h) => { const u = U(w, h); return [{ d: `M${u.X(18)} ${u.Y(50)} L${u.X(46)} ${u.Y(50)} M${u.X(46)} ${u.Y(50)} L${u.X(74)} ${u.Y(24)} M${u.X(46)} ${u.Y(50)} L${u.X(78)} ${u.Y(50)} M${u.X(46)} ${u.Y(50)} L${u.X(74)} ${u.Y(76)}`, s: 'W', sw: 2.2 }, { d: u.e(80, 24, 5, 9) + ' ' + u.e(84, 50, 5, 9) + ' ' + u.e(80, 76, 5, 9), f: 'W', s: null }]; });

  /* ======================= Floor plan ======================= */
  const FP = { fill: '#ffffff', stroke: '#4a4a4a', sw: 1.2, fontSize: 10, fontColor: '#4a4a4a' };
  def('room', { name: 'Room', w: 240, h: 180, obstacle: false, perimeter: 'rect', text: 'Room', style: { fill: '#fbf8f1', stroke: '#6b6b6b', sw: 1, fontColor: '#6b6b6b', fontSize: 12, italic: true }, path: R });
  def('wall', { name: 'Wall', w: 200, h: 10, perimeter: 'rect', style: { fill: '#4a4a4a', stroke: '#2b2b2b', sw: 1 }, path: R, box: below, label: 'below' });
  def('door', { name: 'Door', w: 80, h: 80, perimeter: 'rect', obstacle: false, style: { ...FP, fill: 'none' }, path: R, invisible: true, deco: (w, h) => [{ d: rect(0, 0, 4, h), f: 'S' }, { d: arc(0, h, w, h, -PI / 2, 0, true), dash: 'dash', sw: 1 }], box: below, label: 'below' });
  def('doubleDoor', { name: 'Double door', w: 140, h: 70, perimeter: 'rect', obstacle: false, style: { ...FP, fill: 'none' }, path: R, invisible: true, deco: (w, h) => [{ d: rect(0, 0, 4, h) + ' ' + rect(w - 4, 0, 4, h), f: 'S' }, { d: arc(0, h, w / 2, h, -PI / 2, 0, true) + ' ' + arc(w, h, w / 2, h, -PI / 2, -PI, true), dash: 'dash', sw: 1 }], box: below, label: 'below' });
  def('window', { name: 'Window', w: 100, h: 10, perimeter: 'rect', style: { ...FP, fill: '#e4f1fb' }, path: R, deco: (w, h) => [{ d: `M0 ${h / 2} L${w} ${h / 2}`, sw: 1 }], box: below, label: 'below' });
  def('stairs', { name: 'Stairs', w: 80, h: 200, perimeter: 'rect', style: { ...FP }, path: R, deco: (w, h) => { let d = ''; const n = Math.max(3, Math.round(h / 18)); for (let i = 1; i < n; i++) d += ` M0 ${h * i / n} L${w} ${h * i / n}`; return [{ d, sw: 0.8 }, { d: `M${w / 2} ${h - 8} L${w / 2} 14 M${w / 2 - 6} 24 L${w / 2} 12 L${w / 2 + 6} 24`, sw: 1.2 }]; }, box: below, label: 'below' });
  def('bed', { name: 'Bed', w: 100, h: 140, perimeter: 'rect', style: { ...FP }, path: (w, h) => rrect(0, 0, w, h, 4), deco: (w, h) => [{ d: rrect(w * 0.08, h * 0.05, w * 0.38, h * 0.14, 4) + ' ' + rrect(w * 0.54, h * 0.05, w * 0.38, h * 0.14, 4) }, { d: `M0 ${h * 0.27} L${w} ${h * 0.27} M0 ${h * 0.4} C${w * 0.3} ${h * 0.36} ${w * 0.7} ${h * 0.44} ${w} ${h * 0.4}`, sw: 1 }], box: (w, h) => ({ x: 4, y: h * 0.45, w: w - 8, h: h * 0.5 }) });
  def('table', { name: 'Table', w: 120, h: 70, perimeter: 'rect', style: { ...FP, fill: '#f1e7d6' }, path: (w, h) => rrect(0, 0, w, h, 3) });
  def('roundTable', { name: 'Round table', w: 80, h: 80, style: { ...FP, fill: '#f1e7d6' }, path: (w, h) => ellipse(w / 2, h / 2, w / 2, h / 2), box: inset(0.15, 0.15) });
  def('chair', { name: 'Chair', w: 36, h: 36, perimeter: 'rect', style: { ...FP }, path: (w, h) => rrect(0, h * 0.18, w, h * 0.82, 4), deco: (w, h) => [{ d: rrect(w * 0.08, 0, w * 0.84, h * 0.22, 3), f: 'F' }], box: below, label: 'below' });
  def('sofa', { name: 'Sofa', w: 180, h: 80, perimeter: 'rect', style: { ...FP, fill: '#e8eef7' }, path: (w, h) => rrect(0, 0, w, h, 8), deco: (w, h) => [{ d: rrect(w * 0.1, h * 0.28, w * 0.8, h * 0.66, 4) + ` M${w / 2} ${h * 0.28} L${w / 2} ${h * 0.94}`, sw: 1 }], box: below, label: 'below' });
  def('toilet', { name: 'Toilet', w: 40, h: 60, perimeter: 'rect', style: { ...FP }, path: (w, h) => rrect(0, 0, w, h * 0.28, 3) + ' ' + `M${w * 0.15} ${h * 0.28} L${w * 0.85} ${h * 0.28} C${w * 0.98} ${h * 0.7} ${w * 0.8} ${h} ${w / 2} ${h} C${w * 0.2} ${h} ${w * 0.02} ${h * 0.7} ${w * 0.15} ${h * 0.28} Z`, box: below, label: 'below' });
  def('sink', { name: 'Sink', w: 56, h: 44, perimeter: 'rect', style: { ...FP }, path: (w, h) => rrect(0, 0, w, h, 4), deco: (w, h) => [{ d: ellipse(w / 2, h * 0.56, w * 0.36, h * 0.32), sw: 1 }, { d: ellipse(w / 2, h * 0.14, 2.5, 2.5), f: 'S', s: null }], box: below, label: 'below' });
  def('bathtub', { name: 'Bathtub', w: 160, h: 76, perimeter: 'rect', style: { ...FP }, path: (w, h) => rrect(0, 0, w, h, 6), deco: (w, h) => [{ d: rrect(8, 8, w - 16, h - 16, Math.min(h, w) * 0.3), sw: 1 }, { d: ellipse(w - 22, h / 2, 3, 3), f: 'S', s: null }], box: below, label: 'below' });
  def('plant', { name: 'Plant', w: 44, h: 44, style: { ...FP, fill: '#dff0d8', stroke: '#5b8c51' }, path: (w, h) => { const u = U(w, h); let d = ''; for (let i = 0; i < 6; i++) { const a = i * PI / 3; d += u.e(50 + Math.cos(a) * 24, 50 + Math.sin(a) * 24, 22, 22) + ' '; } return d; }, box: below, label: 'below' });

  /* ======================= Libraries ======================= */
  // edge presets: style for connector creation / applying to edges
  const EP = {
    line: { name: 'Line', style: { route: 'straight', endArrow: 'none' } },
    arrow: { name: 'Arrow', style: { route: 'straight', endArrow: 'classic' } },
    elbow: { name: 'Elbow connector', style: { route: 'orthogonal', endArrow: 'classic' } },
    curved: { name: 'Curved connector', style: { route: 'curved', endArrow: 'classic' } },
    dashed: { name: 'Dashed arrow', style: { route: 'orthogonal', dash: 'dash', endArrow: 'open' } },
    bidir: { name: 'Bidirectional', style: { route: 'orthogonal', startArrow: 'classic', endArrow: 'classic' } },
    association: { name: 'Association', style: { route: 'orthogonal', endArrow: 'none' } },
    directed: { name: 'Directed association', style: { route: 'orthogonal', endArrow: 'open' } },
    inheritance: { name: 'Inheritance', style: { route: 'orthogonal', endArrow: 'blockOpen', arrowSize: 12 } },
    realization: { name: 'Realization', style: { route: 'orthogonal', endArrow: 'blockOpen', dash: 'dash', arrowSize: 12 } },
    dependency: { name: 'Dependency', style: { route: 'orthogonal', endArrow: 'open', dash: 'dash' } },
    aggregation: { name: 'Aggregation', style: { route: 'orthogonal', startArrow: 'diamondOpen', endArrow: 'none', arrowSize: 12 } },
    composition: { name: 'Composition', style: { route: 'orthogonal', startArrow: 'diamond', endArrow: 'none', arrowSize: 12 } },
    message: { name: 'Message', style: { route: 'straight', endArrow: 'block' } },
    asyncMessage: { name: 'Async message', style: { route: 'straight', endArrow: 'open' } },
    returnMessage: { name: 'Return', style: { route: 'straight', endArrow: 'open', dash: 'dash' } },
    transition: { name: 'Transition', style: { route: 'curved', endArrow: 'open' } },
    reports: { name: 'Reports to', style: { route: 'orthogonal', endArrow: 'none', rounded: false, stroke: '#7a8ea8' } },
    sequenceFlow: { name: 'Sequence flow', style: { route: 'orthogonal', endArrow: 'block' } },
    messageFlow: { name: 'Message flow', style: { route: 'orthogonal', dash: 'dash', startArrow: 'ovalOpen', endArrow: 'blockOpen' } },
    bpmnAssoc: { name: 'Association', style: { route: 'straight', dash: 'dot', endArrow: 'none' } },
    link: { name: 'Network link', style: { route: 'straight', endArrow: 'none', sw: 2, stroke: '#5b6b7c' } },
    wifi: { name: 'Wireless link', style: { route: 'straight', endArrow: 'none', dash: 'dash', sw: 1.5, stroke: '#3b7dd8' } },
    erOneMany: { name: 'One to many', style: { route: 'orthogonal', startArrow: 'erMandOne', endArrow: 'erMany', arrowSize: 12 } },
  };
  // templates (multi-cell items)
  const TPL = {
    pool2: { name: 'Pool with 2 lanes', icon: 'pool', make: (x, y) => {
      const p = { shape: 'pool', x, y, w: 700, h: 300, text: 'Pool' };
      return [p, { shape: 'lane', x: x + 30, y, w: 670, h: 150, text: 'Lane 1', style: { fill: '#f3f7fc', header: 26, bold: false }, parentIdx: 0 }, { shape: 'lane', x: x + 30, y: y + 150, w: 670, h: 150, text: 'Lane 2', style: { fill: '#f3f7fc', header: 26, bold: false }, parentIdx: 0 }];
    } },
    lanes3: { name: '3 vertical swimlanes', icon: 'swimlane', make: (x, y) => [0, 1, 2].map(i => ({ shape: 'swimlane', x: x + i * 220, y, w: 220, h: 360, text: 'Lane ' + (i + 1) })) },
  };
  const libs = [
    { id: 'basic', name: 'Basic', items: ['rect', 'roundRect', 'ellipse', 'circle', 'triangle', 'rightTriangle', 'diamond', 'pentagon', 'hexagon', 'octagon', 'star', 'parallelogram', 'trapezoid', 'cross', 'arrowRight', 'arrowDouble', 'chevron', 'callout', 'cloud', 'cylinder', 'cube', 'note', 'text', 'heading', 'e:line', 'e:arrow', 'e:elbow', 'e:curved', 'e:dashed', 'e:bidir'] },
    { id: 'flowchart', name: 'Flowchart', items: ['process', 'terminator', 'decision', 'data', 'predefined', 'document', 'multiDocument', 'manualInput', 'manualOperation', 'preparation', 'delay', 'display', 'storedData', 'database', 'internalStorage', 'offPage', 'connector', 'merge', 'extract', 'summingJunction', 'or', 'card', 'tape', 'annotation'] },
    { id: 'containers', name: 'Containers & swimlanes', items: ['swimlane', 'lane', 't:lanes3', 'container', 'group', 'boundary'] },
    { id: 'umlClass', name: 'UML class & structure', items: ['umlClass', 'umlInterface', 'umlEnum', 'umlObject', 'package', 'component', 'umlNode', 'note', 'e:association', 'e:directed', 'e:inheritance', 'e:realization', 'e:dependency', 'e:aggregation', 'e:composition', 'e:erOneMany'] },
    { id: 'umlBehavior', name: 'UML use case, sequence & state', items: ['actor', 'useCase', 'boundary', 'lifeline', 'actorLifeline', 'activation', 'fragment', 'destroy', 'initial', 'final', 'state', 'forkBar', 'decision', 'e:message', 'e:asyncMessage', 'e:returnMessage', 'e:transition'] },
    { id: 'org', name: 'Org chart', items: ['orgCard', 'orgPerson', 'orgAssistant', 'group', 'e:reports'] },
    { id: 'bpmn', name: 'BPMN', items: ['bpmnTask', 'bpmnSubprocess', 'bpmnCall', 'bpmnStart', 'bpmnIntermediate', 'bpmnTimer', 'bpmnMessage', 'bpmnEnd', 'bpmnGateway', 'bpmnExclusive', 'bpmnParallel', 'bpmnInclusive', 'bpmnData', 'bpmnStore', 'pool', 'lane', 't:pool2', 'group', 'annotation', 'e:sequenceFlow', 'e:messageFlow', 'e:bpmnAssoc'] },
    { id: 'network', name: 'Network', items: ['server', 'desktop', 'laptop', 'mobile', 'router', 'switch', 'firewall', 'loadBalancer', 'wireless', 'netDatabase', 'printer', 'internet', 'user', 'e:link', 'e:wifi'] },
    { id: 'floor', name: 'Floor plan', items: ['room', 'wall', 'door', 'doubleDoor', 'window', 'stairs', 'bed', 'sofa', 'table', 'roundTable', 'chair', 'toilet', 'sink', 'bathtub', 'plant'] },
  ];

  const get = id => defs[id] || defs.rect;
  const has = id => !!defs[id];
  const SHAPE_DEFAULTS = { fill: '#ffffff', fill2: '', stroke: '#333333', sw: 1.5, dash: '', op: 1, shadow: false, font: 'sans', fontSize: 12, fontColor: '#1f2933', bold: false, italic: false, underline: false, align: 'center', valign: 'middle', textBg: '' };
  const EDGE_DEFAULTS = { stroke: '#4a5568', sw: 1.5, dash: '', op: 1, route: 'orthogonal', rounded: true, startArrow: 'none', endArrow: 'classic', arrowSize: 10, font: 'sans', fontSize: 11, fontColor: '#1f2933', bold: false, italic: false, underline: false, labelBg: '#ffffff', jettySize: 18 };
  function styleOf(cell) {
    if (cell.kind === 'edge') return Object.assign({}, EDGE_DEFAULTS, cell.style);
    const d = get(cell.shape);
    return Object.assign({}, SHAPE_DEFAULTS, d.style, d.style2, cell.style);
  }
  function textBox(cell) {
    const d = get(cell.shape); return (d.box || BOX)(cell.w, cell.h, cell);
  }

  const api = { defs, order, get, has, libs, EP, TPL, styleOf, textBox, SHAPE_DEFAULTS, EDGE_DEFAULTS, BOX };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DiaShapes = api;
})(typeof self !== 'undefined' ? self : this);
