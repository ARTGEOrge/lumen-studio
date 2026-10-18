// Lumen Type font model + outline geometry. No DOM: runs in the browser (window.TM) and in Node tests.
// Outlines use the UFO point model: a contour is a list of points {x,y,t,s}; t is the type of an on-curve point
// ('l' line, 'c' cubic curve, 'q' quadratic curve — the segment that ENDS at this point) or 'o' for an off-curve point.
// s = smooth flag. Closed contours are stored with an on-curve point first; their closing segment ends at points[0].
// Open contours (only while drawing with the pen) have open:true. Outer contours run counter-clockwise (PostScript).
(function (root) {
  'use strict';
  const UD = root.UniData || (typeof require === 'function' ? require('./unidata.js') : null);

  // ---------- Unicode data ----------
  const UNI = (() => {
    const names = new Map(), agl = new Map(), aglRev = new Map(), decomp = new Map();
    if (UD) {
      const nm = UD.names.split('|'); let cp = 0;
      UD.cps.forEach((d, i) => { cp += d; names.set(cp, nm[i]); });
      Object.entries(UD.agl).forEach(([k, v]) => { agl.set(parseInt(k, 16), v); aglRev.set(v, parseInt(k, 16)); });
      Object.entries(UD.decomp).forEach(([k, v]) => decomp.set(parseInt(k, 16), v.map(x => parseInt(x, 16))));
    }
    return { names, agl, aglRev, decomp, blocks: UD ? UD.blocks : [] };
  })();
  const hex = (cp, n = 4) => cp.toString(16).toUpperCase().padStart(n, '0');
  const uniName = cp => UNI.names.get(cp) || '';
  function glyphNameFor(cp) {
    const a = UNI.agl.get(cp); if (a) return a;
    return cp > 0xFFFF ? 'u' + hex(cp, 5) : 'uni' + hex(cp);
  }
  // best-effort Unicode for a glyph name (AGL, uniXXXX, uXXXXX)
  function unicodeForName(name) {
    if (UNI.aglRev.has(name)) return UNI.aglRev.get(name);
    let m = /^uni([0-9A-F]{4})$/.exec(name); if (m) return parseInt(m[1], 16);
    m = /^u([0-9A-F]{4,6})$/.exec(name); if (m) return parseInt(m[1], 16);
    return null;
  }
  function category(cp) {
    if (cp == null) return 'other';
    const ch = String.fromCodePoint(cp);
    if (/\p{Lu}|\p{Lt}/u.test(ch)) return 'upper';
    if (/\p{Ll}|\p{Lm}|\p{Lo}/u.test(ch)) return 'lower';
    if (/\p{N}/u.test(ch)) return 'figure';
    if (/\p{M}/u.test(ch)) return 'mark';
    if (/\p{P}/u.test(ch)) return 'punct';
    if (/\p{Z}|\p{Cc}|\p{Cf}/u.test(ch)) return 'space';
    return 'symbol';
  }

  // ---------- font / glyph construction ----------
  const DEFAULT_INFO = {
    familyName: 'Untitled', styleName: 'Regular', versionMajor: 1, versionMinor: 0,
    copyright: '', trademark: '', designer: '', designerURL: '', manufacturer: '', manufacturerURL: '',
    license: '', licenseURL: '', description: '', vendorID: 'NONE', weightClass: 400, widthClass: 5, italicAngle: 0,
    unitsPerEm: 1000, ascender: 800, descender: -200, xHeight: 500, capHeight: 700, lineGap: 200,
    underlinePosition: -100, underlineThickness: 50, winAscent: null, winDescent: null, useTypoMetrics: true, fsType: 0,
  };
  function newGlyph(name, unicodes = [], advance = 500) {
    return { name, unicodes: unicodes.slice(), advance, contours: [], components: [] };
  }
  function rectContour(x0, y0, x1, y1, cw = false) {
    const p = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    if (cw) p.reverse();
    return { points: p.map(([x, y]) => ({ x, y, t: 'l' })) };
  }
  function ellipseContour(cx, cy, rx, ry) {
    const k = 0.5523;
    const P = (x, y, t, s) => ({ x: Math.round(x), y: Math.round(y), t, ...(s ? { s: true } : {}) });
    return { points: [
      P(cx + rx, cy, 'c', 1), P(cx + rx, cy + ry * k, 'o'), P(cx + rx * k, cy + ry, 'o'), P(cx, cy + ry, 'c', 1),
      P(cx - rx * k, cy + ry, 'o'), P(cx - rx, cy + ry * k, 'o'), P(cx - rx, cy, 'c', 1),
      P(cx - rx, cy - ry * k, 'o'), P(cx - rx * k, cy - ry, 'o'), P(cx, cy - ry, 'c', 1),
      P(cx + rx * k, cy - ry, 'o'), P(cx + rx, cy - ry * k, 'o')] };
  }
  function notdefGlyph(info) {
    const w = Math.round(info.unitsPerEm * 0.5), h = Math.round(info.capHeight || info.unitsPerEm * 0.7), t = Math.max(10, Math.round(info.unitsPerEm * 0.05)), m = Math.round(info.unitsPerEm * 0.05);
    const g = newGlyph('.notdef', [], w + 2 * m);
    g.contours.push(rectContour(m, 0, m + w, h), rectContour(m + t, t, m + w - t, h - t, true));
    return g;
  }
  function newFont(over = {}) {
    const info = Object.assign({}, DEFAULT_INFO, over);
    const sp = newGlyph('space', [32], Math.round(info.unitsPerEm * 0.25));
    return { info, order: ['.notdef', 'space'], glyphs: { '.notdef': notdefGlyph(info), space: sp }, groups: {}, kerning: {} };
  }
  const clone = o => JSON.parse(JSON.stringify(o));
  function cloneGlyph(g) {
    const n = { name: g.name, unicodes: g.unicodes.slice(), advance: g.advance, contours: g.contours.map(c => { const o = { points: c.points.map(p => ({ ...p })) }; if (c.open) o.open = true; return o; }), components: g.components.map(c => ({ base: c.base, m: c.m.slice() })) };
    if (g.mark != null) n.mark = g.mark; if (g.note) n.note = g.note;
    return n;
  }

  // ---------- segments ----------
  // iterate segments of a contour: {a, b, offs:[indices], t}
  function segments(c) {
    const P = c.points, n = P.length, out = [];
    if (!n) return out;
    if (!P.some(p => p.t !== 'o')) return out;   // all off-curve: handled by contourCommands
    if (c.open) {
      let offs = [], a = 0;
      for (let i = 1; i < n; i++) { if (P[i].t === 'o') { offs.push(i); continue; } out.push({ a, b: i, offs, t: P[i].t }); offs = []; a = i; }
      return out;
    }
    let s = P.findIndex(p => p.t !== 'o'), a = s, offs = [];
    for (let k = 1; k <= n; k++) {
      const i = (s + k) % n;
      if (P[i].t === 'o') { offs.push(i); continue; }
      out.push({ a, b: i, offs, t: P[i].t }); offs = []; a = i;
    }
    return out;
  }
  const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  // commands in a simple array form: ['M',x,y] ['L',x,y] ['C',x1,y1,x2,y2,x,y] ['Q',x1,y1,x,y] ['Z']
  function contourCommands(c, out, tf) {
    const P = c.points; if (!P.length) return out;
    const T = tf ? (p => tfPt(tf, p)) : (p => p);
    if (!P.some(p => p.t !== 'o')) {          // TrueType all-off-curve contour
      const n = P.length; let st = T(mid(P[n - 1], P[0]));
      out.push(['M', st.x, st.y]);
      for (let i = 0; i < n; i++) { const q = T(P[i]), e = T(mid(P[i], P[(i + 1) % n])); out.push(['Q', q.x, q.y, e.x, e.y]); }
      out.push(['Z']); return out;
    }
    const segs = segments(c);
    const s0 = c.open ? P[0] : P[segs.length ? segs[0].a : 0], m = T(s0);
    out.push(['M', m.x, m.y]);
    for (const sg of segs) {
      const e = T(P[sg.b]), O = sg.offs.map(i => T(P[i]));
      if (!O.length) out.push(['L', e.x, e.y]);
      else if (sg.t === 'c' && O.length >= 2) out.push(['C', O[0].x, O[0].y, O[O.length - 1].x, O[O.length - 1].y, e.x, e.y]);
      else {
        for (let j = 0; j < O.length - 1; j++) { const im = mid(O[j], O[j + 1]); out.push(['Q', O[j].x, O[j].y, im.x, im.y]); }
        const q = O[O.length - 1]; out.push(['Q', q.x, q.y, e.x, e.y]);
      }
    }
    if (!c.open) out.push(['Z']);
    return out;
  }
  // affine [xx, xy, yx, yy, dx, dy]: x' = xx*x + yx*y + dx, y' = xy*x + yy*y + dy (fontTools order)
  const tfPt = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
  const tfMul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
  const ID = [1, 0, 0, 1, 0, 0];
  function glyphCommands(font, g, tf, out = [], depth = 0) {
    if (!g || depth > 12) return out;
    g.contours.forEach(c => contourCommands(c, out, tf));
    g.components.forEach(cm => { const b = font.glyphs[cm.base]; if (b && b !== g) glyphCommands(font, b, tf ? tfMul(tf, cm.m) : cm.m, out, depth + 1); });
    return out;
  }
  // ---------- bounds ----------
  function cubicExtrema(p0, p1, p2, p3, acc) {
    const ts = [];
    for (const k of ['x', 'y']) {
      const a = -p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k], b = 2 * (p0[k] - 2 * p1[k] + p2[k]), c = p1[k] - p0[k];
      if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) ts.push(-c / b); }
      else { const d = b * b - 4 * a * c; if (d >= 0) { const r = Math.sqrt(d); ts.push((-b + r) / (2 * a), (-b - r) / (2 * a)); } }
    }
    ts.forEach(t => { if (t > 0 && t < 1) { const u = 1 - t; acc(u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x, u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y); } });
  }
  function commandsBounds(cmds) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, cx = 0, cy = 0;
    const acc = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
    for (const c of cmds) {
      if (c[0] === 'M' || c[0] === 'L') { acc(c[1], c[2]); cx = c[1]; cy = c[2]; }
      else if (c[0] === 'C') { acc(c[5], c[6]); cubicExtrema({ x: cx, y: cy }, { x: c[1], y: c[2] }, { x: c[3], y: c[4] }, { x: c[5], y: c[6] }, acc); cx = c[5]; cy = c[6]; }
      else if (c[0] === 'Q') { const p0 = { x: cx, y: cy }, q = { x: c[1], y: c[2] }, p = { x: c[3], y: c[4] }; acc(p.x, p.y); cubicExtrema(p0, { x: p0.x + 2 / 3 * (q.x - p0.x), y: p0.y + 2 / 3 * (q.y - p0.y) }, { x: p.x + 2 / 3 * (q.x - p.x), y: p.y + 2 / 3 * (q.y - p.y) }, p, acc); cx = p.x; cy = p.y; }
    }
    return x0 === Infinity ? null : { xMin: x0, yMin: y0, xMax: x1, yMax: y1 };
  }
  const glyphBounds = (font, g) => commandsBounds(glyphCommands(font, g));
  function sidebearings(font, g) {
    const b = glyphBounds(font, g);
    return b ? { lsb: Math.round(b.xMin), rsb: Math.round(g.advance - b.xMax), bounds: b } : { lsb: 0, rsb: g.advance, bounds: null };
  }

  // ---------- transforms ----------
  function transformGlyph(g, m, opts = {}) {
    g.contours.forEach(c => c.points.forEach(p => { const q = tfPt(m, p); p.x = q.x; p.y = q.y; }));
    if (opts.components !== false) g.components.forEach(cm => { cm.m = tfMul(m, cm.m); });
    if (m[0] * m[3] - m[1] * m[2] < 0) g.contours.forEach(c => { const r = reverseContour(c); c.points = r.points; });
    return g;
  }
  function roundGlyph(g) {
    g.contours.forEach(c => c.points.forEach(p => { p.x = Math.round(p.x); p.y = Math.round(p.y); }));
    g.components.forEach(c => { c.m[4] = Math.round(c.m[4]); c.m[5] = Math.round(c.m[5]); });
    g.advance = Math.round(g.advance); return g;
  }
  function shiftGlyph(g, dx, dy = 0) {
    g.contours.forEach(c => c.points.forEach(p => { p.x += dx; p.y += dy; }));
    g.components.forEach(c => { c.m[4] += dx; c.m[5] += dy; });
  }
  function setLSB(font, g, v) { const sb = sidebearings(font, g); if (!sb.bounds) return; const d = Math.round(v - sb.lsb); shiftGlyph(g, d); g.advance += d; }
  function setRSB(font, g, v) { const sb = sidebearings(font, g); if (!sb.bounds) { g.advance = Math.max(0, Math.round(v)); return; } g.advance = Math.max(0, Math.round(sb.bounds.xMax + v)); }

  // ---------- direction ----------
  function flatten(c, steps = 8) {
    const cmds = contourCommands({ points: c.points }, []), pts = []; let cx = 0, cy = 0;
    for (const k of cmds) {
      if (k[0] === 'M' || k[0] === 'L') { pts.push([k[1], k[2]]); cx = k[1]; cy = k[2]; }
      else if (k[0] === 'C') { for (let i = 1; i <= steps; i++) { const t = i / steps, u = 1 - t; pts.push([u * u * u * cx + 3 * u * u * t * k[1] + 3 * u * t * t * k[3] + t * t * t * k[5], u * u * u * cy + 3 * u * u * t * k[2] + 3 * u * t * t * k[4] + t * t * t * k[6]]); } cx = k[5]; cy = k[6]; }
      else if (k[0] === 'Q') { for (let i = 1; i <= steps; i++) { const t = i / steps, u = 1 - t; pts.push([u * u * cx + 2 * u * t * k[1] + t * t * k[3], u * u * cy + 2 * u * t * k[2] + t * t * k[4]]); } cx = k[3]; cy = k[4]; }
    }
    return pts;
  }
  function polyArea(pts) { let a = 0; for (let i = 0, n = pts.length; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
  const contourArea = c => polyArea(flatten(c));
  function pointInPoly(x, y, pts) {
    let w = 0;
    for (let i = 0, n = pts.length; i < n; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % n];
      if (y0 <= y) { if (y1 > y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) > 0) w++; }
      else if (y1 <= y && (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0) < 0) w--;
    }
    return w !== 0;
  }
  function canonical(c) {
    if (c.open) return c;
    const i = c.points.findIndex(p => p.t !== 'o');
    if (i > 0) c.points = c.points.slice(i).concat(c.points.slice(0, i));
    return c;
  }
  // make segment types consistent with their off-curve points (a 'line' with handles is quadratic, a curve without any is a line)
  function fixTypes(c) {
    segments(c).forEach(sg => { const p = c.points[sg.b]; if (!sg.offs.length) { if (p.t !== 'l') p.t = 'l'; } else if (p.t === 'l') p.t = 'q'; });
    return c;
  }
  function reverseContour(c) {
    const P = c.points, n = P.length;
    if (c.open) {
      // open: the first point becomes the last; segment types move to the other end of each segment
      const on = P.map((p, i) => p.t !== 'o' ? i : -1).filter(i => i >= 0);
      const nt = new Map(); on.forEach((i, k) => { nt.set(i, k + 1 < on.length ? P[on[k + 1]].t : 'l'); });
      const r = P.map((p, i) => ({ ...p, t: p.t === 'o' ? 'o' : nt.get(i) })).reverse();
      return { points: r, open: true };
    }
    const on = P.map((p, i) => p.t !== 'o' ? i : -1).filter(i => i >= 0);
    if (!on.length) return { points: P.map(p => ({ ...p })).reverse() };
    const nt = new Map(); on.forEach((i, k) => nt.set(i, P[on[(k + 1) % on.length]].t));
    const r = P.map((p, i) => ({ ...p, t: p.t === 'o' ? 'o' : nt.get(i) })).reverse();
    // keep the same start point
    const s = n - 1 - on[0];
    return { points: r.slice(s).concat(r.slice(0, s)) };
  }
  // is polygon P (mostly) inside polygon Q?
  function insidePoly(P, Q) {
    const step = Math.max(1, Math.floor(P.length / 24)); let n = 0, k = 0;
    for (let i = 0; i < P.length; i += step) { n++; if (pointInPoly(P[i][0], P[i][1], Q)) k++; }
    return n > 0 && k / n > 0.8;
  }
  // Make outer contours counter-clockwise and counters clockwise (nesting depth by containment).
  function correctDirections(g) {
    const polys = g.contours.map(c => flatten(c, 6)), areas = polys.map(p => Math.abs(polyArea(p)));
    const boxes = polys.map(P => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of P) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; } return [a, b, c, d]; });
    let changed = 0;
    g.contours = g.contours.map((c, i) => {
      const P = polys[i]; if (c.points.length < 2 || P.length < 3 || areas[i] < 1e-9) return c;
      let depth = 0; const bi = boxes[i];
      for (let j = 0; j < polys.length; j++) {
        if (j === i || areas[j] <= areas[i] || polys[j].length < 3) continue;
        const bj = boxes[j];
        if (bi[0] < bj[0] - 1 || bi[1] < bj[1] - 1 || bi[2] > bj[2] + 1 || bi[3] > bj[3] + 1) continue;
        if (insidePoly(P, polys[j])) depth++;
      }
      const wantCCW = depth % 2 === 0, isCCW = polyArea(P) > 0;
      if (wantCCW !== isCCW) { changed++; return reverseContour(c); }
      return c;
    });
    return changed;
  }

  // ---------- conversions ----------
  function contourToCubic(c) {
    const segs = segments(c), P = c.points;
    if (!segs.length) {
      if (!P.length) return c;
      // all-off-curve TT contour: build explicit on-curve midpoints first
      const pts = []; P.forEach((p, i) => { const m = mid(P[(i + P.length - 1) % P.length], p); pts.push({ x: m.x, y: m.y, t: 'q', s: true }, { ...p, t: 'o' }); });
      return contourToCubic({ points: pts });
    }
    const out = []; const push = p => out.push(p);
    const first = c.open ? 0 : segs[0].a;
    push({ ...P[first] });
    segs.forEach(sg => {
      const a = P[sg.a], b = P[sg.b];
      if (!sg.offs.length || (sg.t === 'c' && sg.offs.length >= 2)) { sg.offs.forEach(i => push({ ...P[i] })); push({ ...b }); return; }
      const O = sg.offs.map(i => P[i]); let s = a;
      O.forEach((q, j) => {
        const e = j < O.length - 1 ? mid(q, O[j + 1]) : b;
        push({ x: s.x + 2 / 3 * (q.x - s.x), y: s.y + 2 / 3 * (q.y - s.y), t: 'o' });
        push({ x: e.x + 2 / 3 * (q.x - e.x), y: e.y + 2 / 3 * (q.y - e.y), t: 'o' });
        if (j < O.length - 1) push({ x: e.x, y: e.y, t: 'c', s: true }); else push({ ...b, t: 'c' });
        s = e;
      });
    });
    if (!c.open) { const last = out.pop(); out[0] = { ...out[0], t: last.t, ...(last.s ? { s: true } : {}) }; if (last.s == null) delete out[0].s; }
    const r = { points: out }; if (c.open) r.open = true; return r;
  }
  // cubic → quadratic spline within tol font units
  function cubicToQuads(p0, p1, p2, p3, tol = 1) {
    const at = (t, a, b, c, d) => { const u = 1 - t; return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d; };
    const split = (t0, t1) => {
      // sub-cubic between t0..t1
      const P = t => ({ x: at(t, p0.x, p1.x, p2.x, p3.x), y: at(t, p0.y, p1.y, p2.y, p3.y) });
      const D = t => { const u = 1 - t; return { x: 3 * (u * u * (p1.x - p0.x) + 2 * u * t * (p2.x - p1.x) + t * t * (p3.x - p2.x)), y: 3 * (u * u * (p1.y - p0.y) + 2 * u * t * (p2.y - p1.y) + t * t * (p3.y - p2.y)) }; };
      const h = t1 - t0, a = P(t0), d = P(t1), da = D(t0), dd = D(t1);
      return [a, { x: a.x + da.x * h / 3, y: a.y + da.y * h / 3 }, { x: d.x - dd.x * h / 3, y: d.y - dd.y * h / 3 }, d];
    };
    for (let n = 1; n <= 16; n++) {
      const res = []; let ok = true;
      for (let i = 0; i < n && ok; i++) {
        const [a, b, c, d] = split(i / n, (i + 1) / n);
        const q = { x: (3 * (b.x + c.x) - a.x - d.x) / 4, y: (3 * (b.y + c.y) - a.y - d.y) / 4 };
        for (let k = 1; k < 8; k++) {
          const t = k / 8, u = 1 - t;
          const cx = at(t, a.x, b.x, c.x, d.x), cy = at(t, a.y, b.y, c.y, d.y);
          const qx = u * u * a.x + 2 * u * t * q.x + t * t * d.x, qy = u * u * a.y + 2 * u * t * q.y + t * t * d.y;
          if (Math.hypot(cx - qx, cy - qy) > tol) { ok = false; break; }
        }
        res.push({ q, e: d });
      }
      if (ok) return res;
    }
    // fall back to fine subdivision
    const res = [], n = 24; for (let i = 0; i < n; i++) { const [a, b, c, d] = split(i / n, (i + 1) / n); res.push({ q: { x: (3 * (b.x + c.x) - a.x - d.x) / 4, y: (3 * (b.y + c.y) - a.y - d.y) / 4 }, e: d }); }
    return res;
  }
  function contourToQuadratic(c, tol = 1) {
    const segs = segments(c), P = c.points;
    if (!segs.length || !segs.some(s => s.t === 'c' && s.offs.length)) return c;
    const out = [];
    const first = c.open ? 0 : segs[0].a;
    out.push({ ...P[first] });
    segs.forEach(sg => {
      const a = P[sg.a], b = P[sg.b];
      if (sg.t !== 'c' || !sg.offs.length) { sg.offs.forEach(i => out.push({ ...P[i] })); out.push({ ...b }); return; }
      const O = sg.offs.map(i => P[i]);
      const c1 = O[0], c2 = O[O.length - 1];
      const qs = cubicToQuads(a, O.length === 1 ? c1 : c1, c2, b, tol);
      qs.forEach((s, j) => {
        out.push({ x: s.q.x, y: s.q.y, t: 'o' });
        if (j < qs.length - 1) out.push({ x: s.e.x, y: s.e.y, t: 'q', s: true }); else out.push({ ...b, t: 'q' });
      });
    });
    if (!c.open) { const last = out.pop(); out[0] = { ...out[0], t: last.t }; if (last.s) out[0].s = true; }
    const r = { points: out }; if (c.open) r.open = true; return r;
  }
  const glyphIsQuadratic = g => g.contours.some(c => c.points.some(p => p.t === 'q'));
  const glyphIsCubic = g => g.contours.some(c => c.points.some(p => p.t === 'c'));

  // ---------- editing ops ----------
  // split the segment ending at on-curve index b at parameter t; returns index of the new on-curve point
  function splitSegment(c, segB, t) {
    const sg = segments(c).find(s => s.b === segB); if (!sg) return -1;
    const P = c.points, a = P[sg.a], b = P[sg.b];
    const lerp = (p, q, u) => ({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u });
    let ins;   // points to insert before b (replacing the old offcurves)
    if (!sg.offs.length) { const m = lerp(a, b, t); ins = [{ x: m.x, y: m.y, t: 'l' }]; }
    else if (sg.t === 'c' && sg.offs.length >= 2) {
      const c1 = P[sg.offs[0]], c2 = P[sg.offs[sg.offs.length - 1]];
      const ab = lerp(a, c1, t), bc = lerp(c1, c2, t), cd = lerp(c2, b, t), abc = lerp(ab, bc, t), bcd = lerp(bc, cd, t), m = lerp(abc, bcd, t);
      ins = [{ ...ab, t: 'o' }, { ...abc, t: 'o' }, { ...m, t: 'c', s: true }, { ...bcd, t: 'o' }, { ...cd, t: 'o' }];
    } else {
      if (sg.offs.length > 1) {   // split at the implied on-curve point nearest t
        const k = Math.min(sg.offs.length - 2, Math.max(0, Math.round(t * sg.offs.length) - 1));
        const m = mid(P[sg.offs[k]], P[sg.offs[k + 1]]);
        const offs = sg.offs.map(i => ({ ...P[i] }));
        ins = [...offs.slice(0, k + 1), { ...m, t: 'q', s: true }, ...offs.slice(k + 1)];
      } else {
        const q = P[sg.offs[0]], aq = lerp(a, q, t), qb = lerp(q, b, t), m = lerp(aq, qb, t);
        ins = [{ ...aq, t: 'o' }, { ...m, t: 'q', s: true }, { ...qb, t: 'o' }];
      }
    }
    ins.forEach(p => { p.x = Math.round(p.x); p.y = Math.round(p.y); });
    // rebuild point list: replace offs of this segment
    const drop = new Set(sg.offs);
    const out = []; let newIdx = -1;
    P.forEach((p, i) => {
      if (drop.has(i)) return;
      if (i === sg.b) { ins.forEach(q => { if (q.t !== 'o' && newIdx < 0) newIdx = out.length; out.push(q); }); }
      out.push(p);
    });
    // if b === 0 (closing segment) the inserted points went before index 0; rotate keeps canonical form
    c.points = out;
    if (!c.open && sg.b === 0) { canonical(c); newIdx = c.points.findIndex(p => p === ins.find(q => q.t !== 'o')); }
    return newIdx;
  }
  // nearest point on the outline: {c, b (segment end index), t, d}
  function nearestOnContour(c, x, y) {
    let best = null;
    const P = c.points;
    segments(c).forEach(sg => {
      const a = P[sg.a], b = P[sg.b], O = sg.offs.map(i => P[i]);
      const f = t => {
        const u = 1 - t;
        if (!O.length) return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (sg.t === 'c' && O.length >= 2) { const c1 = O[0], c2 = O[O.length - 1]; return { x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x, y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y }; }
        // quadratic spline: evaluate piecewise
        const n = O.length, s = Math.min(n - 1, Math.floor(t * n)), lt = t * n - s;
        const s0 = s === 0 ? a : mid(O[s - 1], O[s]), s1 = s === n - 1 ? b : mid(O[s], O[s + 1]), q = O[s], v = 1 - lt;
        return { x: v * v * s0.x + 2 * v * lt * q.x + lt * lt * s1.x, y: v * v * s0.y + 2 * v * lt * q.y + lt * lt * s1.y };
      };
      for (let i = 0; i <= 64; i++) { const t = i / 64, p = f(t), d = Math.hypot(p.x - x, p.y - y); if (!best || d < best.d) best = { b: sg.b, t, d, x: p.x, y: p.y }; }
    });
    return best;
  }
  // delete points (indices) from a contour, keeping the outline closed and curves where possible.
  // Returns the contour, or null when too few points remain.
  function deletePoints(c, idx) {
    const pts = c.points.map(p => ({ ...p }));
    const del = new Set(idx.map(i => pts[i]).filter(Boolean));
    for (const sg of segments({ points: pts, open: c.open })) {
      const hit = sg.offs.filter(i => del.has(pts[i])); if (!hit.length) continue;
      if (sg.t === 'c' || hit.length === sg.offs.length) { sg.offs.forEach(i => del.add(pts[i])); pts[sg.b].t = 'l'; }
    }
    let arr = pts.filter(p => !(p.t === 'o' && del.has(p)));
    const open = !!c.open;
    for (const p of del) {
      if (p.t === 'o') continue;
      const i = arr.indexOf(p); if (i < 0) continue;
      let segs = segments({ points: arr, open });
      let sin = segs.find(s => s.b === i), sout = segs.find(s => s.a === i);
      if (open && (!sin || !sout)) { const s = sin || sout, rm = new Set([i, ...(s ? s.offs : [])]); arr = arr.filter((q, k) => !rm.has(k)); continue; }
      if (!sin || !sout) { arr.splice(i, 1); continue; }
      if (!open && sin.a !== 0) { arr = arr.slice(sin.a).concat(arr.slice(0, sin.a)); segs = segments({ points: arr }); const j = arr.indexOf(p); sin = segs.find(s => s.b === j); sout = segs.find(s => s.a === j); }
      const A = arr, inO = sin.offs.map(k => A[k]), outO = sout.offs.map(k => A[k]), B = A[sout.b], Pa = A[sin.a];
      let midPts, type;
      const inC = sin.t === 'c' && inO.length, outC = sout.t === 'c' && outO.length;
      if (inC || outC) { midPts = [inC ? inO[0] : { x: Pa.x, y: Pa.y, t: 'o' }, outC ? outO[outO.length - 1] : { x: B.x, y: B.y, t: 'o' }]; type = 'c'; }
      else if (inO.length || outO.length) { midPts = [...inO, ...outO]; type = 'q'; }
      else { midPts = []; type = 'l'; }
      B.t = type;
      if (open) arr = [...A.slice(0, sin.a + 1), ...midPts, ...A.slice(sout.b)];
      else arr = sout.b === 0 ? [A[0], ...midPts] : [A[0], ...midPts, ...A.slice(sout.b)];
    }
    const onCount = arr.filter(p => p.t !== 'o').length;
    if (onCount < (open ? 1 : 2)) return null;
    const r = { points: arr }; if (open) r.open = true;
    return canonical(r);
  }

  // ---------- components ----------
  function decompose(font, g) {
    const out = [];
    const walk = (gg, m, d) => {
      if (!gg || d > 12) return;
      gg.contours.forEach(c => { const n = { points: c.points.map(p => ({ ...p, ...tfPt(m, p) })) }; if (m[0] * m[3] - m[1] * m[2] < 0) out.push(reverseContour(n)); else out.push(n); });
      gg.components.forEach(cm => walk(font.glyphs[cm.base], tfMul(m, cm.m), d + 1));
    };
    g.components.forEach(cm => walk(font.glyphs[cm.base], cm.m, 1));
    g.contours = g.contours.concat(out.map(c => { c.points.forEach(p => { p.x = Math.round(p.x * 1000) / 1000; p.y = Math.round(p.y * 1000) / 1000; }); return c; }));
    g.components = [];
    return g;
  }
  // does `name` (directly or indirectly) use `target` as a component?
  function usesComponent(font, name, target, depth = 0) {
    const g = font.glyphs[name]; if (!g || depth > 12) return false;
    return g.components.some(c => c.base === target || usesComponent(font, c.base, target, depth + 1));
  }
  // map of base → [glyphs using it]
  function componentUsers(font) {
    const m = new Map();
    font.order.forEach(n => font.glyphs[n].components.forEach(c => { if (!m.has(c.base)) m.set(c.base, []); m.get(c.base).push(n); }));
    return m;
  }
  // Build a composite for a precomposed letter (e.g. Aacute = A + acute), based on Unicode decomposition.
  const MARK_SPACING = { 0x300: [0x60, 'grave'], 0x301: [0xB4, 'acute'], 0x302: [0x2C6, 'circumflex'], 0x303: [0x2DC, 'tilde'], 0x304: [0xAF, 'macron'], 0x306: [0x2D8, 'breve'], 0x307: [0x2D9, 'dotaccent'], 0x308: [0xA8, 'dieresis'], 0x30A: [0x2DA, 'ring'], 0x30B: [0x2DD, 'hungarumlaut'], 0x30C: [0x2C7, 'caron'], 0x327: [0xB8, 'cedilla'], 0x328: [0x2DB, 'ogonek'], 0x326: [null, 'commaaccent'] };
  const BELOW = new Set([0x327, 0x328, 0x326, 0x323, 0x331]);
  function findGlyphForCp(font, cp) {
    for (const n of font.order) if (font.glyphs[n].unicodes.includes(cp)) return n;
    return null;
  }
  function compositeRecipe(font, cp) {
    const d = UNI.decomp.get(cp); if (!d || d.length < 2) return null;
    let base = findGlyphForCp(font, d[0]);
    if (!base && d[0] === 0x69) base = font.glyphs.dotlessi ? 'dotlessi' : null;
    if (d[0] === 0x69 && font.glyphs.dotlessi && d.slice(1).some(m => !BELOW.has(m))) base = 'dotlessi';
    if (d[0] === 0x6A && font.glyphs.dotlessj && d.slice(1).some(m => !BELOW.has(m))) base = 'dotlessj';
    if (!base) return null;
    const marks = [];
    for (const m of d.slice(1)) {
      let n = findGlyphForCp(font, m);
      const alt = MARK_SPACING[m];
      if (!n && alt) n = (alt[0] && findGlyphForCp(font, alt[0])) || (font.glyphs[alt[1]] ? alt[1] : null) || (font.glyphs[alt[1] + 'comb'] ? alt[1] + 'comb' : null);
      if (!n) return null;
      marks.push({ name: n, below: BELOW.has(m) });
    }
    return { base, marks };
  }
  function buildComposite(font, name, cp) {
    const r = compositeRecipe(font, cp); if (!r) return null;
    const bg = font.glyphs[r.base], bb = glyphBounds(font, bg) || { xMin: 0, xMax: bg.advance, yMin: 0, yMax: font.info.xHeight };
    const g = newGlyph(name, [cp], bg.advance);
    g.components.push({ base: r.base, m: ID.slice() });
    let top = bb.yMax, bottom = bb.yMin;
    const isUpper = bb.yMax > font.info.xHeight * 1.12;
    r.marks.forEach(mk => {
      let mname = mk.name, caseMark = false;
      if (isUpper && !mk.below && font.glyphs[mname + '.case']) { mname += '.case'; caseMark = true; }
      const mg = font.glyphs[mname], mb = glyphBounds(font, mg); if (!mb) return;
      const dx = Math.round((bb.xMin + bb.xMax) / 2 - (mb.xMin + mb.xMax) / 2);
      let dy = 0;
      if (mk.below) { if (mb.yMax > 0) dy = Math.round(bottom - mb.yMax + Math.min(0, mb.yMax)); bottom += Math.min(0, dy + mb.yMin); }
      else {
        // marks are drawn for lowercase; raise them for capitals / stacked marks
        const gap = Math.max(0, mb.yMin - font.info.xHeight);
        const want = top + gap;
        dy = Math.round(want - mb.yMin);
        if (!isUpper && Math.abs(top - font.info.xHeight) < font.info.xHeight * 0.12 && top <= font.info.xHeight * 1.12) dy = Math.round(Math.max(0, top - font.info.xHeight));
        if (caseMark && top <= font.info.capHeight * 1.05) dy = 0;   // .case marks are already drawn for capitals
        top = mb.yMax + dy;
      }
      g.components.push({ base: mname, m: [1, 0, 0, 1, dx, dy] });
    });
    return g;
  }

  // ---------- kerning ----------
  const GCACHE = new WeakMap();
  function groupIndex(font) {
    let ix = GCACHE.get(font.groups);
    if (ix) return ix;
    const k1 = new Map(), k2 = new Map();
    Object.entries(font.groups || {}).forEach(([g, mem]) => {
      if (g.startsWith('public.kern1.')) mem.forEach(n => { if (!k1.has(n)) k1.set(n, g); });
      else if (g.startsWith('public.kern2.')) mem.forEach(n => { if (!k2.has(n)) k2.set(n, g); });
    });
    ix = { k1, k2 }; GCACHE.set(font.groups, ix); return ix;
  }
  // UFO kerning lookup with precedence glyph-glyph > glyph-group > group-glyph > group-group
  function kernValue(font, l, r) {
    const K = font.kerning; if (!K) return 0;
    const ix = groupIndex(font), gl = ix.k1.get(l), gr = ix.k2.get(r);
    let v;
    if (K[l] && (v = K[l][r]) != null) return v;
    if (gr && K[l] && (v = K[l][gr]) != null) return v;
    if (gl && K[gl] && (v = K[gl][r]) != null) return v;
    if (gl && gr && K[gl] && (v = K[gl][gr]) != null) return v;
    return 0;
  }
  // which kerning entry decides the pair: returns {left, right} keys (glyph or group names) or null
  function kernSource(font, l, r) {
    const K = font.kerning || {}, ix = groupIndex(font), gl = ix.k1.get(l), gr = ix.k2.get(r);
    if (K[l] && K[l][r] != null) return { left: l, right: r };
    if (gr && K[l] && K[l][gr] != null) return { left: l, right: gr };
    if (gl && K[gl] && K[gl][r] != null) return { left: gl, right: r };
    if (gl && gr && K[gl] && K[gl][gr] != null) return { left: gl, right: gr };
    return null;
  }
  const isGroup = k => /^public\.kern[12]\./.test(k);
  const groupLabel = k => isGroup(k) ? '@' + k.replace(/^public\.kern[12]\./, '') : k;
  function kernPairs(font) {
    const out = [];
    Object.keys(font.kerning || {}).forEach(l => Object.keys(font.kerning[l]).forEach(r => out.push([l, r, font.kerning[l][r]])));
    return out;
  }
  // expand to glyph pairs (precedence applied); only glyphs in the font
  function flattenKerning(font) {
    const exists = n => !!font.glyphs[n];
    const mem = k => isGroup(k) ? (font.groups[k] || []).filter(exists) : exists(k) ? [k] : [];
    const out = new Map(); // "l\u0000r" → v
    const rank = (l, r) => (isGroup(l) ? 2 : 0) + (isGroup(r) ? 1 : 0);
    const pairs = kernPairs(font).sort((a, b) => rank(b[0], b[1]) - rank(a[0], a[1]));   // group-group first, exceptions overwrite
    for (const [l, r, v] of pairs) for (const a of mem(l)) for (const b of mem(r)) out.set(a + '\u0000' + b, v);
    // remove pairs whose value is 0 only if no lower-precedence entry would apply (keep zeros as exceptions)
    return [...out].map(([k, v]) => { const [a, b] = k.split('\u0000'); return [a, b, v]; });
  }

  // ---------- text layout ----------
  function cmapOf(font) {
    const m = new Map();
    font.order.forEach(n => font.glyphs[n].unicodes.forEach(u => { if (!m.has(u)) m.set(u, n); }));
    return m;
  }
  // "/name " syntax selects a glyph by name (Glyphs-style)
  function textToGlyphs(font, text, cmap = cmapOf(font)) {
    const out = [];
    for (let i = 0; i < text.length;) {
      if (text[i] === '/' && text[i + 1] && text[i + 1] !== '/') {
        const m = /^\/([A-Za-z0-9._\-]+)\s?/.exec(text.slice(i));
        if (m && font.glyphs[m[1]]) { out.push(m[1]); i += m[0].length; continue; }
      }
      if (text[i] === '/' && text[i + 1] === '/') { const n = cmap.get(47); if (n) out.push(n); i += 2; continue; }
      const cp = text.codePointAt(i); i += cp > 0xFFFF ? 2 : 1;
      if (cp === 10) { out.push('\n'); continue; }
      out.push(cmap.get(cp) || '.notdef');
    }
    return out;
  }
  function layout(font, names, kern = true) {
    const pos = []; let x = 0, y = 0;
    names.forEach((n, i) => {
      if (n === '\n') { x = 0; y -= 1; pos.push(null); return; }
      const g = font.glyphs[n]; if (!g) { pos.push(null); return; }
      let k = 0; const prev = names[i - 1];
      if (kern && prev && prev !== '\n' && font.glyphs[prev]) k = kernValue(font, prev, n);
      x += k; pos.push({ name: n, x, line: -y, kern: k }); x += g.advance;
    });
    return pos;
  }

  // ---------- validation of untrusted project data ----------
  const num = (v, d = 0) => (typeof v === 'number' && isFinite(v)) ? v : (typeof v === 'string' && v.trim() !== '' && isFinite(+v)) ? +v : d;
  const str = (v, max = 4000) => typeof v === 'string' ? v.slice(0, max) : v == null ? '' : String(v).slice(0, max);
  const validName = n => typeof n === 'string' && /^[A-Za-z0-9._\-]{1,63}$/.test(n) && n !== '';
  function sanitizeGlyph(name, g) {
    const o = newGlyph(name, [], 0);
    if (!g || typeof g !== 'object') return o;
    o.unicodes = (Array.isArray(g.unicodes) ? g.unicodes : []).map(u => Math.round(num(u, -1))).filter(u => u >= 0 && u <= 0x10FFFF).slice(0, 16);
    o.advance = Math.max(0, Math.min(65535, Math.round(num(g.advance, 500))));
    o.contours = (Array.isArray(g.contours) ? g.contours : []).slice(0, 5000).map(c => {
      const pts = (Array.isArray(c && c.points) ? c.points : []).slice(0, 20000).map(p => {
        const q = { x: num(p && p.x), y: num(p && p.y), t: ['l', 'c', 'q', 'o'].includes(p && p.t) ? p.t : 'l' }; if (p && p.s) q.s = true; return q;
      });
      const r = { points: pts }; if (c && c.open) r.open = true; return fixTypes(canonical(r));
    }).filter(c => c.points.length);
    o.components = (Array.isArray(g.components) ? g.components : []).slice(0, 200).filter(c => c && validName(c.base)).map(c => ({ base: c.base, m: (Array.isArray(c.m) && c.m.length === 6 ? c.m : ID).map((v, i) => num(v, ID[i])) }));
    if (g.mark != null && isFinite(+g.mark)) o.mark = Math.max(0, Math.min(11, Math.round(+g.mark)));
    if (g.note) o.note = str(g.note, 2000);
    return o;
  }
  function sanitizeFont(d) {
    if (!d || typeof d !== 'object') throw new Error('Not a Lumen Type project');
    const info = Object.assign({}, DEFAULT_INFO);
    const di = d.info && typeof d.info === 'object' ? d.info : {};
    Object.keys(DEFAULT_INFO).forEach(k => {
      if (!(k in di)) return;
      const dv = DEFAULT_INFO[k];
      if (typeof dv === 'number') info[k] = num(di[k], dv);
      else if (typeof dv === 'boolean') info[k] = !!di[k];
      else if (dv === null) info[k] = di[k] == null || di[k] === '' ? null : num(di[k], null);
      else info[k] = str(di[k]);
    });
    info.unitsPerEm = Math.max(16, Math.min(16384, Math.round(info.unitsPerEm)));
    info.weightClass = Math.max(1, Math.min(1000, Math.round(info.weightClass)));
    info.widthClass = Math.max(1, Math.min(9, Math.round(info.widthClass)));
    info.vendorID = (info.vendorID || 'NONE').replace(/[^\x20-\x7E]/g, '').slice(0, 4);
    const glyphs = {}, order = [];
    const src = d.glyphs && typeof d.glyphs === 'object' ? d.glyphs : {};
    const ord = Array.isArray(d.order) ? d.order : Object.keys(src);
    ord.forEach(n => { if (validName(n) && !glyphs[n] && Object.prototype.hasOwnProperty.call(src, n) && order.length < 65000) { glyphs[n] = sanitizeGlyph(n, src[n]); order.push(n); } });
    const groups = {};
    if (d.groups && typeof d.groups === 'object') Object.entries(d.groups).forEach(([k, v]) => { if (/^public\.kern[12]\.[^\s]{1,60}$/.test(k) && Array.isArray(v)) groups[k] = v.filter(n => validName(n)).slice(0, 5000); });
    const kerning = {};
    if (d.kerning && typeof d.kerning === 'object') Object.entries(d.kerning).forEach(([l, row]) => {
      if (!(validName(l) || groups[l]) || !row || typeof row !== 'object') return;
      Object.entries(row).forEach(([r, v]) => { if ((validName(r) || groups[r]) && isFinite(+v)) (kerning[l] = kerning[l] || {})[r] = Math.round(+v); });
    });
    const f = { info, order, glyphs, groups, kerning };
    if (!glyphs['.notdef']) { glyphs['.notdef'] = notdefGlyph(info); order.unshift('.notdef'); }
    return f;
  }
  function toProject(font) {
    return { format: 'lumen-type', version: 1, info: font.info, order: font.order, glyphs: Object.fromEntries(font.order.map(n => [n, font.glyphs[n]])), groups: font.groups, kerning: font.kerning };
  }
  function uniqueName(font, base) { if (!font.glyphs[base]) return base; let i = 1; while (font.glyphs[base + '.' + String(i).padStart(3, '0')]) i++; return base + '.' + String(i).padStart(3, '0'); }

  const TM = {
    UNI, hex, uniName, glyphNameFor, unicodeForName, category, DEFAULT_INFO, newGlyph, newFont, notdefGlyph, rectContour, ellipseContour, clone, cloneGlyph,
    segments, contourCommands, glyphCommands, commandsBounds, glyphBounds, sidebearings, tfPt, tfMul, ID,
    transformGlyph, roundGlyph, shiftGlyph, setLSB, setRSB, flatten, polyArea, contourArea, pointInPoly, canonical, fixTypes, reverseContour, correctDirections,
    contourToCubic, contourToQuadratic, cubicToQuads, glyphIsQuadratic, glyphIsCubic, splitSegment, nearestOnContour, deletePoints,
    decompose, usesComponent, componentUsers, compositeRecipe, buildComposite, findGlyphForCp,
    groupIndex, kernValue, kernSource, isGroup, groupLabel, kernPairs, flattenKerning, cmapOf, textToGlyphs, layout,
    sanitizeFont, toProject, validName, uniqueName,
  };
  if (typeof module === 'object' && module.exports) module.exports = TM; else root.TM = TM;
})(typeof window !== 'undefined' ? window : globalThis);
