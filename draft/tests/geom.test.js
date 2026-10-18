// node draft/tests/geom.test.js — geometry kernel: intersections, trim, extend, offset, fillet, chamfer, transforms, hatch.
const G = require('../js/geom.js'), M = require('../js/model.js');
const assert = require('assert');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const near = (a, b, tol = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} expected ${b}, got ${a}`);
const nearPt = (p, q, tol = 1e-6, msg = '') => { near(p[0], q[0], tol, msg + ' x'); near(p[1], q[1], tol, msg + ' y'); };
const line = (x1, y1, x2, y2) => ({ type: 'line', layer: '0', x1, y1, x2, y2 });
const circle = (cx, cy, r) => ({ type: 'circle', layer: '0', cx, cy, r });
const arcD = (cx, cy, r, d1, d2) => ({ type: 'arc', layer: '0', cx, cy, r, a1: d1 * Math.PI / 180, a2: d2 * Math.PI / 180 });
const rectPl = (x0, y0, x1, y1) => ({ type: 'pline', layer: '0', pts: [[x0, y0, 0], [x1, y0, 0], [x1, y1, 0], [x0, y1, 0]], closed: true });
const sortPts = ps => ps.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);

t('intersections: line/line, line/circle, circle/circle, arc range', () => {
  nearPt(G.interEnts(line(0, 0, 10, 10), line(0, 10, 10, 0))[0], [5, 5]);
  assert.strictEqual(G.interEnts(line(0, 0, 4, 4), line(0, 10, 10, 0)).length, 0, 'segments do not reach');
  assert.strictEqual(G.interEnts(line(0, 0, 10, 0), line(0, 1, 10, 1)).length, 0, 'parallel');
  const lc = sortPts(G.interEnts(line(-10, 0, 10, 0), circle(0, 0, 5))); nearPt(lc[0], [-5, 0]); nearPt(lc[1], [5, 0]);
  const tan = G.interEnts(line(-10, 5, 10, 5), circle(0, 0, 5)); assert.strictEqual(tan.length, 1); nearPt(tan[0], [0, 5]);
  const cc = sortPts(G.interEnts(circle(0, 0, 5), circle(8, 0, 5))); nearPt(cc[0], [4, -3]); nearPt(cc[1], [4, 3]);
  const la = G.interEnts(line(-10, 0, 10, 0), arcD(0, 0, 5, 0, 90)); assert.strictEqual(la.length, 1); nearPt(la[0], [5, 0]);
  const pl = G.interEnts(rectPl(0, 0, 10, 10), line(5, -5, 5, 15)); assert.strictEqual(pl.length, 2);
  // bulge arc segment in a polyline: half circle from (0,0) to (10,0) bulging downward (b=1 → CCW)
  const half = { type: 'pline', layer: '0', pts: [[0, 0, 1], [10, 0, 0]], closed: false };
  const hi = G.interEnts(half, line(5, -20, 5, 20)); assert.strictEqual(hi.length, 1); nearPt(hi[0], [5, -5]);
});

t('trim: line between two cutting edges, circle to arc, closed polyline', () => {
  const h = line(0, 0, 100, 0), v1 = line(30, -10, 30, 10), v2 = line(70, -10, 70, 10);
  const r = G.trim(h, [v1, v2], [50, 0]);
  assert.strictEqual(r.length, 2);
  nearPt([r[0].x1, r[0].y1], [0, 0]); nearPt([r[0].x2, r[0].y2], [30, 0]); nearPt([r[1].x1, r[1].y1], [70, 0]); nearPt([r[1].x2, r[1].y2], [100, 0]);
  const end = G.trim(h, [v1, v2], [90, 0]); assert.strictEqual(end.length, 1); nearPt([end[0].x2, end[0].y2], [70, 0]);
  assert.deepStrictEqual(G.trim(h, [], [50, 0]), [], 'no cutting edge → removed (quick trim)');
  // circle cut by a horizontal line, pick the top: keep the lower half as an arc
  const c = G.trim(circle(0, 0, 10), [line(-20, 0, 20, 0)], [0, 10]);
  assert.strictEqual(c.length, 1); assert.strictEqual(c[0].type, 'arc');
  near(G.normA(c[0].a1), Math.PI); near(G.normA(c[0].a2), 0, 1e-9); near(G.entLength(c[0]), Math.PI * 10);
  // closed rectangle cut by a vertical line, pick the right edge: open polyline remains with the left part
  const pr = G.trim(rectPl(0, 0, 10, 10), [line(5, -5, 5, 15)], [10, 5]);
  assert.strictEqual(pr.length, 1); assert.strictEqual(pr[0].type, 'pline'); assert.strictEqual(pr[0].closed, false);
  near(G.entLength(pr[0]), 5 + 10 + 5);
  // arc trimmed by a line
  const a = G.trim(arcD(0, 0, 10, 0, 180), [line(0, -20, 0, 20)], [-8, 6]);
  assert.strictEqual(a.length, 1); near(a[0].a2, Math.PI / 2); near(a[0].a1, 0);
});

t('extend: line to boundary line, arc to boundary, polyline end', () => {
  const b = line(50, -10, 50, 10);
  const e = G.extend(line(0, 0, 20, 0), [b], [18, 0]); nearPt([e.x2, e.y2], [50, 0]); nearPt([e.x1, e.y1], [0, 0]);
  assert.strictEqual(G.extend(line(0, 0, 20, 0), [b], [2, 0]), null, 'wrong end has no boundary');
  const ar = G.extend(arcD(0, 0, 10, 0, 45), [line(0, 0, 0, 20)], [7, 7]);
  near(ar.a2, Math.PI / 2);
  const pl = G.extend({ type: 'pline', layer: '0', pts: [[0, 0, 0], [10, 0, 0], [10, 10, 0]], closed: false }, [line(-5, 30, 20, 30)], [10, 9]);
  nearPt(pl.pts[2], [10, 30]);
});

t('offset: line, circle, closed and open polylines (with arcs)', () => {
  const o = G.offset(line(0, 0, 10, 0), 2, [5, 5]); nearPt([o.x1, o.y1], [0, 2]); nearPt([o.x2, o.y2], [10, 2]);
  const o2 = G.offset(line(0, 0, 10, 0), 2, [5, -5]); near(o2.y1, -2);
  near(G.offset(circle(0, 0, 10), 3, [0, 0]).r, 7); near(G.offset(circle(0, 0, 10), 3, [20, 0]).r, 13);
  assert.strictEqual(G.offset(circle(0, 0, 2), 3, [0, 0]), null);
  const inner = G.offset(rectPl(0, 0, 100, 50), 5, [50, 25]);
  assert.strictEqual(inner.pts.length, 4); near(Math.abs(G.loopArea(inner.pts)), 90 * 40);
  sortPts(inner.pts).forEach((p, i) => nearPt(p, sortPts([[5, 5], [95, 5], [95, 45], [5, 45]])[i]));
  const outer = G.offset(rectPl(0, 0, 100, 50), 5, [-20, 25]); near(Math.abs(G.loopArea(outer.pts)), 110 * 60);
  // slot: two lines + two semicircles (closed); offset outward by 2 keeps the shape
  const slot = { type: 'pline', layer: '0', closed: true, pts: [[0, 0, 0], [20, 0, 1], [20, 10, 0], [0, 10, 1]] };
  near(G.loopArea(slot.pts), 200 + Math.PI * 25);
  const so = G.offset(slot, 2, [10, -10]); near(Math.abs(G.loopArea(so.pts)), 20 * 14 + Math.PI * 49, 1e-6);
  // open L-shaped polyline: mitred corner
  const L = G.offset({ type: 'pline', layer: '0', closed: false, pts: [[0, 0, 0], [10, 0, 0], [10, 10, 0]] }, 1, [0, 5]);
  nearPt(L.pts[0], [0, 1]); nearPt(L.pts[1], [9, 1]); nearPt(L.pts[2], [9, 10]);
  const thr = G.offsetThrough(line(0, 0, 10, 0), [3, 4]); near(thr.y1, 4);
});

t('fillet and chamfer of two lines', () => {
  const r = G.filletLines(line(0, 0, 50, 0), [40, 0], line(0, 0, 0, 50), [0, 40], 10);
  nearPt([r.a.x1, r.a.y1], [50, 0]); nearPt([r.a.x2, r.a.y2], [10, 0]);
  nearPt([r.b.x1, r.b.y1], [0, 50]); nearPt([r.b.x2, r.b.y2], [0, 10]);
  nearPt([r.arc.cx, r.arc.cy], [10, 10]); near(r.arc.r, 10); near(G.arcSweep(r.arc.a1, r.arc.a2), Math.PI / 2);
  // lines that do not meet are extended; crossing lines are trimmed on the picked side
  const r2 = G.filletLines(line(5, 0, 50, 0), [40, 0], line(-10, -10, -10, 50), [-10, 40], 0);
  nearPt([r2.a.x2, r2.a.y2], [-10, 0]); nearPt([r2.b.x2, r2.b.y2], [-10, 0]); assert.strictEqual(r2.arc, null);
  const cr = G.filletLines(line(-20, 0, 50, 0), [40, 0], line(0, -20, 0, 50), [0, 40], 5);
  nearPt([cr.a.x2, cr.a.y2], [5, 0]); nearPt([cr.a.x1, cr.a.y1], [50, 0]);
  // 60° corner
  const a60 = G.filletLines(line(0, 0, 100, 0), [50, 0], line(0, 0, 50, 50 * Math.sqrt(3)), [25, 43], 10);
  const tt = 10 / Math.tan(Math.PI / 6); near(a60.a.x2, tt); near(G.dist([a60.arc.cx, a60.arc.cy], [0, 0]), 10 / Math.sin(Math.PI / 6));
  assert.ok(G.filletLines(line(0, 0, 10, 0), [5, 0], line(0, 1, 10, 1), [5, 1], 2).error);
  assert.ok(G.filletLines(line(0, 0, 5, 0), [4, 0], line(0, 0, 0, 5), [0, 4], 50).error, 'radius too large');
  const ch = G.chamferLines(line(0, 0, 50, 0), [40, 0], line(0, 0, 0, 50), [0, 40], 5, 8);
  nearPt([ch.line.x1, ch.line.y1], [5, 0]); nearPt([ch.line.x2, ch.line.y2], [0, 8]);
});

t('polyline fillet / chamfer of all corners', () => {
  const { ent, count } = G.cornerPline(rectPl(0, 0, 100, 50), 10);
  assert.strictEqual(count, 4); assert.strictEqual(ent.pts.length, 8);
  near(G.loopArea(ent.pts), 5000 - 4 * (100 - 25 * Math.PI));
  near(G.loopLength(ent.pts), 2 * (80 + 30) + 2 * Math.PI * 10);
  const c = G.cornerPline(rectPl(0, 0, 100, 50), 5, true, 5); near(G.loopArea(c.ent.pts), 5000 - 4 * 12.5);
  assert.strictEqual(G.cornerPline(rectPl(0, 0, 10, 10), 20).count, 0, 'radius too large is skipped');
});

t('transforms: move, rotate, scale, mirror (arcs keep their orientation)', () => {
  const a = arcD(10, 0, 5, 0, 90);
  const m = G.transform(a, G.Tmirror(0, 0, 0, 1));   // mirror about the Y axis
  nearPt([m.cx, m.cy], [-10, 0]); near(m.a1, Math.PI / 2); near(m.a2, Math.PI);
  const r = G.transform(line(0, 0, 10, 0), G.Trot(0, 0, Math.PI / 2)); nearPt([r.x2, r.y2], [0, 10]);
  const s = G.transform(circle(1, 1, 2), G.Tscale(0, 0, 3)); nearPt([s.cx, s.cy], [3, 3]); near(s.r, 6);
  const p = G.transform({ type: 'pline', layer: '0', pts: [[0, 0, 0.5], [10, 0, 0]], closed: false }, G.Tmirror(0, 0, 1, 0));
  near(p.pts[0][2], -0.5);
  const ins = G.transform({ type: 'insert', name: 'B', x: 5, y: 0, sx: 1, sy: 1, rot: 0, layer: '0' }, G.Tmirror(0, 0, 0, 1));
  near(ins.x, -5); near(ins.sy, -1); near(ins.rot, Math.PI);
  const tx = G.transform({ type: 'text', x: 10, y: 0, h: 2.5, rot: 0, s: 'AB', layer: '0' }, G.Tmirror(0, 0, 0, 1));
  near(tx.rot, 0, 1e-9, 'mirrored text stays readable'); assert.ok(tx.x < -10 + 1e-9);
});

t('areas and lengths with bulges', () => {
  const circ = [[-5, 0, 1], [5, 0, 1]];
  near(G.loopArea(circ), Math.PI * 25); near(G.loopLength(circ), Math.PI * 10);
  near(G.loopArea([[0, 0], [10, 0], [10, 10], [0, 10]]), 100); near(G.loopArea([[0, 0], [0, 10], [10, 10], [10, 0]]), -100);
});

t('hatch boundary detection: picks the smallest enclosing region with islands', () => {
  const prims = [...G.primsOf(rectPl(0, 0, 100, 100)), ...G.primsOf(circle(50, 50, 20))];
  const loops = G.findBoundary(prims, 10, 10);
  assert.strictEqual(loops.length, 2, 'square + circle island');
  near(Math.abs(G.loopArea(loops[0].pts)) - Math.abs(G.loopArea(loops[1].pts)), 10000 - Math.PI * 400, 1e-6);
  const inC = G.findBoundary(prims, 50, 50); assert.strictEqual(inC.length, 1); near(Math.abs(G.loopArea(inC[0].pts)), Math.PI * 400, 1e-6);
  // a tic-tac-toe grid of loose lines with overhangs: centre cell
  const grid = [line(-10, 0, 40, 0), line(-10, 10, 40, 10), line(-10, 20, 40, 20), line(-10, 30, 40, 30), line(0, -10, 0, 40), line(10, -10, 10, 40), line(20, -10, 20, 40), line(30, -10, 30, 40)].flatMap(G.primsOf);
  const cell = G.findBoundary(grid, 15, 15); assert.strictEqual(cell.length, 1); near(G.loopArea(cell[0].pts), 100);
  assert.strictEqual(G.findBoundary(grid, 100, 100), null, 'outside → no boundary');
  // region bounded by a line and an arc (D shape)
  const D = [G.L(0, -10, 0, 10), ...G.primsOf(arcD(0, 0, 10, -90, 90))];
  const dl = G.findBoundary(D, 5, 0); near(Math.abs(G.loopArea(dl[0].pts)), Math.PI * 50, 1e-6);
  assert.ok(G.pointInLoops(loops, 10, 10) && !G.pointInLoops(loops, 50, 50));
});

t('hatch pattern lines stay inside the boundary', () => {
  const loops = [{ pts: [[0, 0, 0], [50, 0, 0], [50, 30, 0], [0, 30, 0]] }, { pts: [[20, 10, 1], [30, 10, 1]] }];
  const segs = G.hatchLines(loops, M.PATTERNS.ANSI31.fams, 1, 0);
  assert.ok(segs.length > 20);
  for (const s of segs) { const mx = (s[0] + s[2]) / 2, my = (s[1] + s[3]) / 2; assert.ok(G.pointInLoops(loops, mx, my), 'segment midpoint inside'); }
  // spacing: ANSI31 lines are 3.175 apart
  const total = segs.reduce((a, s) => a + Math.hypot(s[2] - s[0], s[3] - s[1]), 0);
  near(total, (1500 - Math.PI * 25) / 3.175, 25);
  const dashed = G.hatchLines([loops[0]], M.PATTERNS.DASH.fams, 1, 0);
  const dl = dashed.reduce((a, s) => a + Math.hypot(s[2] - s[0], s[3] - s[1]), 0); near(dl, 1500 / 3.175 / 2, 30);
});

t('dimension values and geometry', () => {
  const ds = M.newDoc().dimstyle;
  const lin = { type: 'dim', dt: 'lin', p1: [0, 0], p2: [30, 40], p: [15, -10], ang: 0 };
  assert.strictEqual(M.dimText(lin, ds), '30');
  assert.strictEqual(M.dimText({ ...lin, ang: Math.PI / 2 }, ds), '40');
  assert.strictEqual(M.dimText({ type: 'dim', dt: 'ali', p1: [0, 0], p2: [30, 40], p: [0, 10] }, ds), '50');
  assert.strictEqual(M.dimText({ type: 'dim', dt: 'rad', c: [0, 0], p1: [12.5, 0], p: [20, 0] }, ds), 'R12.5');
  assert.strictEqual(M.dimText({ type: 'dim', dt: 'dia', c: [0, 0], p1: [12.5, 0], p: [20, 0] }, ds), 'Ø25');
  assert.strictEqual(M.dimText({ type: 'dim', dt: 'ang', c: [0, 0], p1: [10, 0], p2: [10, 10], p: [8, 3] }, ds), '45°');
  assert.strictEqual(M.dimText({ type: 'dim', dt: 'ang', c: [0, 0], p1: [10, 0], p2: [10, 10], p: [-8, -3] }, ds), '315°');
  const g = M.dimGeom(lin, ds);
  assert.strictEqual(g.filter(x => x.type === 'solid').length, 2); assert.strictEqual(g.filter(x => x.type === 'text').length, 1);
  const dl = g.filter(x => x.type === 'line').find(l => Math.abs(l.y1 + 10) < 1e-9 && Math.abs(l.y2 + 10) < 1e-9); assert.ok(dl, 'dimension line at y=-10');
  near(Math.abs(dl.x2 - dl.x1), 30);
});

console.log(`\n${n} geometry tests passed`);
