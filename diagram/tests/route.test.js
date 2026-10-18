// node diagram/tests/route.test.js — connector routing: glue, ports, orthogonal obstacle avoidance, curves, waypoints.
const assert = require('assert');
const M = require('../js/model.js'), R = require('../js/route.js'), G = require('../js/geom.js'), Rn = require('../js/render.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

const page = () => M.newPage();
const shape = (p, s, x, y, w, h, o = {}) => { const c = M.makeShape(s, x, y, { w, h, ...o }); p.cells.push(c); return c; };
const edge = (p, a, b, style = {}, o = {}) => { const e = M.makeEdge(a.id ? { id: a.id, port: o.sp || null } : a, b.id ? { id: b.id, port: o.tp || null } : b, { style, pts: o.pts }); p.cells.push(e); return e; };
const strictInside = (pt, b) => pt.x > b.x + 0.01 && pt.x < b.x + b.w - 0.01 && pt.y > b.y + 0.01 && pt.y < b.y + b.h - 0.01;
// does segment a→b (axis aligned) pass through the interior of box?
function segHitsBox(a, b, box) {
  if (Math.abs(a.y - b.y) < 0.01) { const y = a.y, x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x); return y > box.y + 0.01 && y < box.y + box.h - 0.01 && x1 > box.x + 0.01 && x0 < box.x + box.w - 0.01; }
  if (Math.abs(a.x - b.x) < 0.01) { const x = a.x, y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y); return x > box.x + 0.01 && x < box.x + box.w - 0.01 && y1 > box.y + 0.01 && y0 < box.y + box.h - 0.01; }
  // diagonal: sample
  for (let i = 1; i < 50; i++) { const q = { x: a.x + (b.x - a.x) * i / 50, y: a.y + (b.y - a.y) * i / 50 }; if (strictInside(q, box)) return true; }
  return false;
}
const orthogonal = pts => pts.every((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) < 0.01 || Math.abs(p.y - pts[i - 1].y) < 0.01);
const onBoxEdge = (p, b) => (Math.abs(p.x - b.x) < 0.6 || Math.abs(p.x - b.x - b.w) < 0.6) && p.y >= b.y - 0.6 && p.y <= b.y + b.h + 0.6 || (Math.abs(p.y - b.y) < 0.6 || Math.abs(p.y - b.y - b.h) < 0.6) && p.x >= b.x - 0.6 && p.x <= b.x + b.w + 0.6;

t('orthogonal route goes around a blocking shape', () => {
  const p = page(); const a = shape(p, 'rect', 0, 0, 120, 60), b = shape(p, 'rect', 420, 0, 120, 60), o = shape(p, 'rect', 200, -60, 100, 180);
  const e = edge(p, a, b); const r = R.routePage(p).get(e.id);
  assert.ok(orthogonal(r.pts), 'axis aligned');
  for (let i = 1; i < r.pts.length; i++) assert.ok(!segHitsBox(r.pts[i - 1], r.pts[i], o), 'crosses obstacle at segment ' + i);
  assert.ok(onBoxEdge(r.pts[0], a) && onBoxEdge(r.pts[r.pts.length - 1], b), 'ends on the shapes');
  console.log('   route', r.pts.map(q => `${q.x},${q.y}`).join(' → '));
});

t('connector stays glued when shapes move (floating ends)', () => {
  const p = page(); const a = shape(p, 'rect', 0, 0, 100, 60), b = shape(p, 'ellipse', 300, 200, 100, 60);
  const e = edge(p, a, b, { route: 'straight' });
  const r1 = R.routePage(p).get(e.id);
  b.x += 150; b.y -= 120; a.y += 30;
  const r2 = R.routePage(p).get(e.id);
  assert.notDeepStrictEqual(r1.pts, r2.pts);
  const end = r2.pts[r2.pts.length - 1], c = M.center(b);
  const norm = ((end.x - c.x) / 50) ** 2 + ((end.y - c.y) / 30) ** 2;
  assert.ok(Math.abs(norm - 1) < 0.03, 'end on ellipse perimeter, got ' + norm);
  assert.ok(onBoxEdge(r2.pts[0], a), 'start on rectangle');
});

t('fixed connection points: exact location and exit direction', () => {
  const p = page(); const a = shape(p, 'rect', 0, 0, 100, 60), b = shape(p, 'rect', 300, 200, 100, 60);
  const e = edge(p, a, b, {}, { sp: [0.5, 1], tp: [0, 0.5] });
  const r = R.routePage(p).get(e.id);
  assert.deepStrictEqual(r.pts[0], { x: 50, y: 60 });
  assert.deepStrictEqual(r.pts[r.pts.length - 1], { x: 300, y: 230 });
  assert.ok(r.pts[1].x === 50 && r.pts[1].y > 60, 'leaves downward');
  const pe = r.pts[r.pts.length - 2]; assert.ok(pe.y === 230 && pe.x < 300, 'enters from the left');
  assert.ok(orthogonal(r.pts));
});

t('rotated shape: glue point lies on the rotated outline', () => {
  const p = page(); const a = shape(p, 'diamond', 0, 0, 120, 80, { rot: 30 }), b = shape(p, 'rect', 400, 0, 80, 60);
  const e = edge(p, a, b, { route: 'straight' });
  const r = R.routePage(p).get(e.id), s = r.pts[0];
  const ring = M.outline(a)[0].pts; let d = Infinity; for (let i = 0; i < ring.length; i++) d = Math.min(d, G.distToSeg(s, ring[i], ring[(i + 1) % ring.length]));
  assert.ok(d < 0.5, 'distance to outline ' + d);
});

t('lifeline messages are horizontal at the fixed y', () => {
  const p = page(); const l1 = shape(p, 'lifeline', 0, 0, 100, 300), l2 = shape(p, 'lifeline', 250, 0, 100, 300);
  const e = edge(p, l1, l2, { route: 'straight' }, { sp: [0.5, 0.5], tp: [0.5, 0.5] });
  const r = R.routePage(p).get(e.id);
  assert.deepStrictEqual(r.pts, [{ x: 50, y: 150 }, { x: 300, y: 150 }]);
});

t('waypoints are honoured (orthogonal elbows through them, straight polyline)', () => {
  const p = page(); const a = shape(p, 'rect', 0, 0, 100, 60), b = shape(p, 'rect', 400, 0, 100, 60);
  const e = edge(p, a, b, {}, { pts: [{ x: 250, y: 200 }] });
  const r = R.routePage(p).get(e.id);
  assert.ok(r.pts.some(q => q.x === 250 && q.y === 200), 'passes through the waypoint');
  assert.ok(orthogonal(r.pts));
  const e2 = edge(p, a, b, { route: 'straight' }, { pts: [{ x: 250, y: -150 }] });
  const r2 = R.routePage(p).get(e2.id);
  assert.strictEqual(r2.pts.length, 3); assert.deepStrictEqual(r2.pts[1], { x: 250, y: -150 });
});

t('curved connectors become quadratic curves; self-loops get a loop', () => {
  const p = page(); const a = shape(p, 'rect', 0, 0, 100, 60), b = shape(p, 'rect', 300, 200, 100, 60);
  const e = edge(p, a, b, { route: 'curved' }), self = edge(p, a, a);
  const rs = R.routePage(p);
  const g = Rn.edgeGeom(e, rs.get(e.id));
  assert.ok(/Q/.test(g.prims[0].d), 'curve path');
  assert.ok(rs.get(self.id).pts.length >= 4);
});

t('free (unglued) endpoints and arrowheads', () => {
  const p = page();
  const e = edge(p, { x: 0, y: 0 }, { x: 200, y: 100 }, { route: 'straight', endArrow: 'block', startArrow: 'diamondOpen' });
  const r = R.routePage(p).get(e.id), g = Rn.edgeGeom(e, r);
  assert.deepStrictEqual(r.pts, [{ x: 0, y: 0 }, { x: 200, y: 100 }]);
  assert.strictEqual(g.prims.length, 3, 'line + 2 arrowheads');
  // the line is shortened so the filled arrow tip ends exactly at the endpoint
  assert.ok(!/200 100/.test(g.prims[0].d) && /200 100/.test(g.prims[1].d));
});

t('random scenes: orthogonal routes never cut through other shapes', () => {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let total = 0, worst = 0, routes = 0, fails = 0;
  for (let scene = 0; scene < 6; scene++) {
    const p = page(), shapes = [];
    for (let k = 0; shapes.length < 40 && k < 2000; k++) {
      const w = 60 + Math.round(rnd() * 80), h = 40 + Math.round(rnd() * 50), x = Math.round(rnd() * 1400), y = Math.round(rnd() * 900);
      const b = { x: x - 30, y: y - 30, w: w + 60, h: h + 60 };
      if (shapes.some(s => G.boxHit(b, M.shapeBox(s)))) continue;
      shapes.push(shape(p, 'rect', x, y, w, h));
    }
    const edges = [];
    for (let k = 0; k < 25; k++) { const a = shapes[Math.floor(rnd() * shapes.length)], b = shapes[Math.floor(rnd() * shapes.length)]; if (a !== b) edges.push(edge(p, a, b)); }
    const t0 = Date.now(); const rs = R.routePage(p); const dt = Date.now() - t0; total += dt; worst = Math.max(worst, dt / edges.length);
    for (const e of edges) {
      const r = rs.get(e.id); routes++;
      assert.ok(orthogonal(r.pts), 'orthogonal');
      for (const s of shapes) for (let i = 1; i < r.pts.length; i++) if (segHitsBox(r.pts[i - 1], r.pts[i], M.shapeBox(s))) { fails++; break; }
    }
  }
  assert.strictEqual(fails, 0, `${fails} routes cut a shape`);
  console.log(`   ${routes} routes in ${total} ms (worst ${worst.toFixed(1)} ms per edge)`);
});

t('page with 300 shapes and 300 connectors routes in reasonable time', () => {
  const p = page(), shapes = [];
  for (let i = 0; i < 300; i++) shapes.push(shape(p, 'rect', (i % 20) * 200, Math.floor(i / 20) * 140, 120, 60));
  for (let i = 0; i < 300; i++) edge(p, shapes[i], shapes[(i * 7 + 3) % 300]);
  const t0 = Date.now(); const rs = R.routePage(p); const dt = Date.now() - t0;
  assert.strictEqual(rs.size, 300); console.log(`   300 connectors routed in ${dt} ms`);
  assert.ok(dt < 15000);
});

console.log(`\n${n} routing tests passed`);
