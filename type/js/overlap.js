// Lumen Type: Remove Overlap using paper.js boolean operations (nonzero union of a glyph's contours).
(function (root) {
  'use strict';
  const TM = root.TM || require('./model.js');
  let scope = null;
  function getScope(paper) {
    if (scope) return scope;
    scope = new paper.PaperScope();
    scope.setup(new scope.Size(1, 1));
    return scope;
  }
  function toPaper(ps, c) {
    const cc = TM.contourToCubic(c), P = cc.points, segs = TM.segments(cc);
    if (!segs.length) return null;
    const path = new ps.Path({ insert: false });
    const first = segs[0].a;
    const pt = i => new ps.Point(P[i].x, P[i].y);
    // one paper segment per on-curve point, handles from the cubic offcurves
    const list = [], idxOf = new Map();
    segs.forEach(s => { if (!idxOf.has(s.a)) { idxOf.set(s.a, list.length); list.push({ p: s.a, hin: null, hout: null }); } });
    segs.forEach(s => {
      if (s.t === 'c' && s.offs.length >= 2) {
        const a = list[idxOf.get(s.a)], b = list[idxOf.get(s.b)];
        a.hout = { x: P[s.offs[0]].x - P[s.a].x, y: P[s.offs[0]].y - P[s.a].y };
        if (b) b.hin = { x: P[s.offs[s.offs.length - 1]].x - P[s.b].x, y: P[s.offs[s.offs.length - 1]].y - P[s.b].y };
      }
    });
    void first;
    list.forEach(s => path.add(new ps.Segment(pt(s.p), s.hin ? new ps.Point(s.hin.x, s.hin.y) : null, s.hout ? new ps.Point(s.hout.x, s.hout.y) : null)));
    path.closed = true;
    return path;
  }
  function fromPaper(path) {
    const segs = path.segments, n = segs.length, pts = [];
    if (n < 2) return null;
    for (let i = 0; i < n; i++) {
      const s = segs[i], prev = segs[(i + n - 1) % n];
      const curved = !prev.handleOut.isZero() || !s.handleIn.isZero();
      if (curved) {
        pts.push({ x: prev.point.x + prev.handleOut.x, y: prev.point.y + prev.handleOut.y, t: 'o' }, { x: s.point.x + s.handleIn.x, y: s.point.y + s.handleIn.y, t: 'o' });
      }
      pts.push({ x: s.point.x, y: s.point.y, t: curved ? 'c' : 'l' });
    }
    // rotate so the list starts with an on-curve point: the first on-curve is pts[k]
    const c = TM.canonical({ points: pts });
    c.points.forEach(p => { p.x = Math.round(p.x); p.y = Math.round(p.y); });
    return c;
  }
  // Removes overlaps between the glyph's own contours (components are left alone). Returns true if changed.
  function removeOverlap(g, paper) {
    paper = paper || root.paper;
    if (!paper || g.contours.length === 0) return false;
    const ps = getScope(paper);
    const quad = TM.glyphIsQuadratic(g) && !TM.glyphIsCubic(g);
    TM.correctDirections(g);
    const paths = g.contours.map(c => toPaper(ps, c)).filter(Boolean);
    if (!paths.length) return false;
    const cp = new ps.CompoundPath({ children: paths, insert: false }); cp.fillRule = 'nonzero';
    const res = cp.unite(new ps.Path({ insert: false }), { insert: false });
    const kids = res.className === 'CompoundPath' ? res.children : [res];
    const out = kids.map(fromPaper).filter(c => c && c.points.length > 2 && Math.abs(TM.contourArea(c)) > 0.5);
    // mark smooth points
    out.forEach(c => { const P = c.points, n = P.length; P.forEach((p, i) => { if (p.t === 'o') return; const a = P[(i + n - 1) % n], b = P[(i + 1) % n]; const v1 = [p.x - a.x, p.y - a.y], v2 = [b.x - p.x, b.y - p.y]; const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2); if (l1 && l2 && Math.abs((v1[0] * v2[1] - v1[1] * v2[0]) / (l1 * l2)) < 0.02 && v1[0] * v2[0] + v1[1] * v2[1] > 0 && (a.t === 'o' || b.t === 'o')) p.s = true; }); });
    g.contours = quad ? out.map(c => TM.contourToQuadratic(c, 1)).map(c => { c.points.forEach(p => { p.x = Math.round(p.x); p.y = Math.round(p.y); }); return c; }) : out;
    TM.correctDirections(g);
    return true;
  }
  const OV = { removeOverlap };
  if (typeof module === 'object' && module.exports) module.exports = OV; else root.Overlap = OV;
})(typeof window !== 'undefined' ? window : globalThis);
