// Lumen Draft — ASCII DXF reader (R12 … R2018 entities) and writer (R2000 / AC1015 and R12 / AC1009).
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(require('./geom.js'), require('./model.js')); else root.LDDxf = factory(root.LDGeom, root.LDModel); })(typeof self !== 'undefined' ? self : this, function (G, M) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI, TAU = Math.PI * 2;

  /* ======================= reading ======================= */
  function pairsOf(text) {
    if (/^AutoCAD Binary DXF/.test(text)) throw new Error('Binary DXF is not supported — save as ASCII DXF.');
    const lines = text.split(/\r\n|\r|\n/), out = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const c = parseInt(lines[i].trim(), 10);
      if (!Number.isFinite(c)) { i--; continue; }   // tolerate stray blank lines
      out.push([c, lines[i + 1]]);
    }
    return out;
  }
  // group into objects: [{type, tags:[[c,v],...]}] per section
  function sectionsOf(pairs) {
    const secs = {}; let i = 0;
    while (i < pairs.length) {
      if (pairs[i][0] === 0 && pairs[i][1].trim() === 'SECTION') {
        const name = (pairs[i + 1] && pairs[i + 1][1] || '').trim(); i += 2; const objs = []; let cur = null;
        while (i < pairs.length && !(pairs[i][0] === 0 && pairs[i][1].trim() === 'ENDSEC')) {
          const [c, v] = pairs[i];
          if (c === 0) { cur = { type: v.trim(), tags: [] }; objs.push(cur); } else if (cur) cur.tags.push([c, v]); else if (name === 'HEADER') { cur = { type: '', tags: [[c, v]] }; objs.push(cur); }
          i++;
        }
        secs[name] = objs; i++;
      } else if (pairs[i][0] === 0 && pairs[i][1].trim() === 'EOF') break; else i++;
    }
    return secs;
  }
  const num = v => { const x = parseFloat(v); return Number.isFinite(x) ? x : 0; };
  const get = (o, c, def) => { for (const [k, v] of o.tags) if (k === c) return v; return def; };
  const getN = (o, c, def = 0) => { const v = get(o, c); return v == null ? def : num(v); };
  const getS = (o, c, def = '') => { const v = get(o, c); return v == null ? def : v.trim(); };
  function decodeText(s) {
    return String(s).replace(/%%[dD]/g, '°').replace(/%%[cC]/g, 'Ø').replace(/%%[pP]/g, '±').replace(/%%[uUoOkK]/g, '').replace(/%%%/g, '%')
      .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  function decodeMText(s) {
    let t = decodeText(s);
    t = t.replace(/\\P/g, '\n').replace(/\\~/g, ' ').replace(/\\S([^;]*?)[\^#/]([^;]*?);/g, '$1/$2')
      .replace(/\\[ACFHQTWfcHpX][^;\\]*;/g, '').replace(/\\[LlOoKkNX]/g, '');
    t = t.replace(/\\\\/g, '\u0001').replace(/\\\{/g, '\u0002').replace(/\\\}/g, '\u0003').replace(/[{}]/g, '').replace(/\u0001/g, '\\').replace(/\u0002/g, '{').replace(/\u0003/g, '}');
    return t;
  }
  function bspline(deg, knots, ctrl, closed) {
    const n = ctrl.length; if (n < 2) return ctrl.slice();
    if (!knots || knots.length !== n + deg + 1) { knots = []; for (let i = 0; i < n + deg + 1; i++) knots.push(i <= deg ? 0 : i >= n ? n - deg : i - deg); }
    const lo = knots[deg], hi = knots[n], out = [], steps = Math.max(16, n * 8);
    for (let s = 0; s <= steps; s++) {
      let u = lo + (hi - lo) * s / steps; if (s === steps) u = hi - 1e-12;
      let k = deg; while (k < n - 1 && u >= knots[k + 1]) k++;
      const d = []; for (let j = 0; j <= deg; j++) d.push(ctrl[Math.max(0, Math.min(n - 1, k - deg + j))].slice());
      for (let r = 1; r <= deg; r++) for (let j = deg; j >= r; j--) {
        const i = k - deg + j, den = knots[i + deg - r + 1] - knots[i], a = den ? (u - knots[i]) / den : 0;
        d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1]];
      }
      out.push(d[deg]);
    }
    return out;
  }
  function ellipsePts(cx, cy, mx, my, ratio, t0, t1) {
    let sw = t1 - t0; while (sw <= 1e-9) sw += TAU; const n = Math.max(8, Math.ceil(sw / (Math.PI / 32))), out = [];
    const nx = -my * ratio, ny = mx * ratio;
    for (let i = 0; i <= n; i++) { const t = t0 + sw * i / n; out.push([cx + mx * Math.cos(t) + nx * Math.sin(t), cy + my * Math.cos(t) + ny * Math.sin(t)]); }
    return out;
  }

  function readDXF(text) {
    const pairs = pairsOf(text), secs = sectionsOf(pairs), d = M.newDoc(), warn = {};
    d.layers = []; d.ltypes = {};
    const W = k => { warn[k] = (warn[k] || 0) + 1; };
    // header
    const H = {}; let curVar = null;
    for (const o of secs.HEADER || []) for (const [c, v] of o.tags) { if (c === 9) { curVar = v.trim(); H[curVar] = H[curVar] || {}; } else if (curVar) H[curVar][c] = v; }
    const hv = (name, c, def) => H[name] && H[name][c] != null ? H[name][c] : def;
    d.dxfVersion = String(hv('$ACADVER', 1, 'AC1009')).trim();
    const ins = parseInt(hv('$INSUNITS', 70, '4'), 10); d.units = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm' }[ins] || (String(hv('$MEASUREMENT', 70, '1')).trim() === '0' ? 'in' : 'mm');
    d.ltscale = num(hv('$LTSCALE', 40, '1')) || 1;
    const ds = d.dimstyle; ds.scale = num(hv('$DIMSCALE', 40, '1')) || 1;
    for (const [k, key] of [['$DIMTXT', 'txt'], ['$DIMASZ', 'asz'], ['$DIMEXO', 'exo'], ['$DIMEXE', 'exe'], ['$DIMGAP', 'gap']]) if (hv(k, 40) != null) ds[key] = Math.abs(num(hv(k, 40))) || ds[key];
    if (hv('$DIMDEC', 70) != null) ds.dec = Math.max(0, Math.min(8, parseInt(hv('$DIMDEC', 70), 10) || 0));
    if (hv('$TEXTSIZE', 40) != null) d.textH = num(hv('$TEXTSIZE', 40)) || 2.5;
    const curLayer = String(hv('$CLAYER', 8, '0')).trim();
    // tables
    let table = '';
    for (const o of secs.TABLES || []) {
      if (o.type === 'TABLE') { table = getS(o, 2); continue; }
      if (o.type === 'ENDTAB') { table = ''; continue; }
      if (o.type === 'LTYPE') {
        const name = getS(o, 2).toUpperCase(); if (!name || name === 'BYLAYER' || name === 'BYBLOCK' || M.LTYPES[name]) continue;
        const pat = o.tags.filter(t => t[0] === 49).map(t => num(t[1])); if (pat.length) d.ltypes[name] = { desc: getS(o, 3), pat };
      }
      if (o.type === 'LAYER') {
        const name = getS(o, 2); if (!name || d.layers.some(l => l.name === name)) continue;
        const c = parseInt(getS(o, 62, '7'), 10) || 7, fl = parseInt(getS(o, 70, '0'), 10) || 0, lw = parseInt(getS(o, 370, '-3'), 10);
        d.layers.push({ name, color: Math.min(255, Math.abs(c)) || 7, on: c >= 0, frozen: !!(fl & 1), locked: !!(fl & 4), lt: getS(o, 6, 'CONTINUOUS').toUpperCase(), lw: M.LWEIGHTS.includes(lw) ? lw : -3, plot: getS(o, 290, '1') !== '0' });
      }
    }
    // entity conversion
    const ocsFlip = o => getN(o, 230, 1) < 0;
    function common(o, e) {
      e.layer = getS(o, 8, '0') || '0';
      const c = get(o, 62); if (c != null) { const ci = parseInt(c, 10); if (ci >= 0 && ci <= 255) e.color = ci; }
      const lt = get(o, 6); if (lt != null) { const n = lt.trim().toUpperCase(); if (n === 'BYBLOCK') e.lt = 'BYBLOCK'; else if (n !== 'BYLAYER') e.lt = n; }
      const lw = get(o, 370); if (lw != null) { const n = parseInt(lw, 10); if (n === -2 || n === -3 || M.LWEIGHTS.includes(n)) e.lw = n; }
      const tc = get(o, 420); if (tc != null) { const v = parseInt(tc, 10); e.rgb = [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
      const lts = get(o, 48); if (lts != null && num(lts) > 0 && num(lts) !== 1) e.lts = num(lts);
      return e;
    }
    function flipX(e) { return G.transform(e, [-1, 0, 0, 1, 0, 0]); }
    function textAlign(o) {
      const h = parseInt(getS(o, 72, '0'), 10) || 0, v = parseInt(getS(o, 73, '0'), 10) || 0;
      return { align: h === 4 ? 1 : h === 3 || h === 5 ? 0 : h, valign: h === 4 ? 2 : v };
    }
    function convert(objs, i, out, inBlock) {   // returns next index
      const o = objs[i], t = o.type;
      if (getN(o, 67, 0) === 1 && !inBlock) { W('paper-space entities skipped'); return skipSeq(objs, i); }
      if (getN(o, 60, 0) === 1) return skipSeq(objs, i);
      const flip = ocsFlip(o);
      const push = e => { if (flip) e = M.xform(e, [-1, 0, 0, 1, 0, 0]); out.push(e); };
      switch (t) {
        case 'LINE': out.push(common(o, { type: 'line', x1: getN(o, 10), y1: getN(o, 20), x2: getN(o, 11), y2: getN(o, 21) })); break;
        case 'POINT': out.push(common(o, { type: 'point', x: getN(o, 10), y: getN(o, 20) })); break;
        case 'CIRCLE': push(common(o, { type: 'circle', cx: getN(o, 10), cy: getN(o, 20), r: Math.abs(getN(o, 40)) })); break;
        case 'ARC': push(common(o, { type: 'arc', cx: getN(o, 10), cy: getN(o, 20), r: Math.abs(getN(o, 40)), a1: G.normA(getN(o, 50) * D2R), a2: G.normA(getN(o, 51) * D2R) })); break;
        case 'LWPOLYLINE': {
          const pts = []; let cur = null;
          for (const [c, v] of o.tags) { if (c === 10) { cur = [num(v), 0, 0]; pts.push(cur); } else if (c === 20 && cur) cur[1] = num(v); else if (c === 42 && cur) cur[2] = num(v); }
          const fl = getN(o, 70, 0); if (pts.length < 2) break;
          const e = common(o, { type: 'pline', pts, closed: !!(fl & 1) }); const w = getN(o, 43, 0); if (w > 0) e.w = w; push(e); break;
        }
        case 'POLYLINE': {
          const fl = getN(o, 70, 0), pts = []; let j = i + 1;
          for (; j < objs.length && objs[j].type === 'VERTEX'; j++) { const v = objs[j], vf = getN(v, 70, 0); if (vf & 16) continue; pts.push([getN(v, 10), getN(v, 20), getN(v, 42, 0)]); }
          if (j < objs.length && objs[j].type === 'SEQEND') j++;
          if (fl & (16 | 64)) { W('3-D meshes skipped'); return j; }
          if (pts.length >= 2) { const e = common(o, { type: 'pline', pts, closed: !!(fl & 1) }); const w = getN(o, 40, 0); if (w > 0 && w === getN(o, 41, 0)) e.w = w; push(e); }
          return j;
        }
        case 'SOLID': case 'TRACE': {
          const p = [[getN(o, 10), getN(o, 20)], [getN(o, 11), getN(o, 21)], [getN(o, 13), getN(o, 23)], [getN(o, 12), getN(o, 22)]];
          const pts = G.dist(p[2], p[3]) < 1e-12 ? [p[0], p[1], p[3]] : p; push(common(o, { type: 'solid', pts })); break;
        }
        case 'TEXT': case 'ATTRIB': {
          if (t === 'ATTRIB' && (getN(o, 70, 0) & 1)) break;
          const a = textAlign(o), useB = (a.align || a.valign) && get(o, 11) != null;
          const e = common(o, { type: 'text', x: useB ? getN(o, 11) : getN(o, 10), y: useB ? getN(o, 21) : getN(o, 20), h: Math.abs(getN(o, 40, 2.5)) || 2.5, rot: G.normA(getN(o, 50) * D2R), s: decodeText(get(o, 1, '')), align: a.align, valign: a.valign });
          if (e.s.trim()) push(e); break;
        }
        case 'MTEXT': {
          const s = o.tags.filter(x => x[0] === 3).map(x => x[1]).join('') + get(o, 1, '');
          let rot = getN(o, 50, 0) * D2R; if (get(o, 11) != null) rot = Math.atan2(getN(o, 21), getN(o, 11));
          const e = common(o, { type: 'mtext', x: getN(o, 10), y: getN(o, 20), h: Math.abs(getN(o, 40, 2.5)) || 2.5, w: Math.abs(getN(o, 41, 0)), rot: G.normA(rot), attach: Math.max(1, Math.min(9, getN(o, 71, 1))), s: decodeMText(s) });
          if (e.s.trim()) push(e); break;
        }
        case 'INSERT': {
          const name = getS(o, 2), cols = Math.max(1, getN(o, 70, 1)), rows = Math.max(1, getN(o, 71, 1)), cs = getN(o, 44, 0), rs = getN(o, 45, 0);
          const rot = getN(o, 50) * D2R, base = { type: 'insert', name, x: getN(o, 10), y: getN(o, 20), sx: getN(o, 41, 1) || 1, sy: getN(o, 42, 1) || 1, rot: G.normA(rot) };
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
            const dx = c * cs, dy = r * rs, e = common(o, { ...base, x: base.x + dx * Math.cos(rot) - dy * Math.sin(rot), y: base.y + dx * Math.sin(rot) + dy * Math.cos(rot) });
            if (flip) { e.x = -e.x; e.rot = G.normA(-e.rot); e.sx = -e.sx; }
            out.push(e);
          }
          let j = i + 1;
          if (getN(o, 66, 0) === 1) { for (; j < objs.length && objs[j].type !== 'SEQEND' && objs[j].type === 'ATTRIB'; j++) convert(objs, j, out, inBlock); if (j < objs.length && objs[j].type === 'SEQEND') j++; }
          return j;
        }
        case 'DIMENSION': {
          const dim = readDim(o); if (dim) out.push(common(o, dim));
          else { const bn = getS(o, 2); if (bn) out.push(common(o, { type: 'insert', name: bn, x: 0, y: 0, sx: 1, sy: 1, rot: 0, _dimGeom: true })); W('dimensions kept as geometry'); }
          break;
        }
        case 'HATCH': { const h = readHatch(o); if (h) push(common(o, h)); else W('hatches skipped'); break; }
        case 'ELLIPSE': {
          const pts = ellipsePts(getN(o, 10), getN(o, 20), getN(o, 11), getN(o, 21), getN(o, 40, 1), getN(o, 41, 0), getN(o, 42, TAU));
          const full = Math.abs(getN(o, 42, TAU) - getN(o, 41, 0) - TAU) < 1e-6; if (full) pts.pop();
          push(common(o, { type: 'pline', pts: pts.map(p => [p[0], p[1], 0]), closed: full })); break;
        }
        case 'SPLINE': {
          const deg = getN(o, 71, 3), fl = getN(o, 70, 0), knots = o.tags.filter(x => x[0] === 40).map(x => num(x[1]));
          const ctrl = [], fit = []; let cp = null, fp = null;
          for (const [c, v] of o.tags) { if (c === 10) { cp = [num(v), 0]; ctrl.push(cp); } else if (c === 20 && cp) cp[1] = num(v); else if (c === 11) { fp = [num(v), 0]; fit.push(fp); } else if (c === 21 && fp) fp[1] = num(v); }
          const pts = ctrl.length >= 2 ? bspline(deg, knots, ctrl) : fit;
          if (pts.length >= 2) push(common(o, { type: 'pline', pts: pts.map(p => [p[0], p[1], 0]), closed: !!(fl & 1) && ctrl.length < 2 }));
          W('splines approximated by polylines'); break;
        }
        case 'LEADER': {
          const pts = []; let cur = null; for (const [c, v] of o.tags) { if (c === 10) { cur = [num(v), 0, 0]; pts.push(cur); } else if (c === 20 && cur) cur[1] = num(v); }
          if (pts.length >= 2) out.push(common(o, { type: 'pline', pts, closed: false })); break;
        }
        case 'SEQEND': case 'VERTEX': case 'ATTDEF': case 'VIEWPORT': break;
        default: W(t + ' not supported');
      }
      return i + 1;
    }
    function skipSeq(objs, i) { let j = i + 1; if (objs[i].type === 'POLYLINE' || (objs[i].type === 'INSERT' && getN(objs[i], 66, 0) === 1)) { while (j < objs.length && objs[j].type !== 'SEQEND') j++; j++; } return j; }
    function readDim(o) {
      const P = (cx, cy) => get(o, cx) == null ? null : [getN(o, cx), getN(o, cy)];
      const ty = getN(o, 70, 0) & 7, txt0 = get(o, 1, ''), txt = !txt0 || txt0.trim() === '<>' ? null : decodeMText(txt0);
      const tp = (getN(o, 70, 0) & 128) ? P(11, 21) : null;
      let d0 = null;
      if (ty === 0 || ty === 1) { const p1 = P(13, 23), p2 = P(14, 24), p = P(10, 20); if (p1 && p2 && p) d0 = ty === 0 ? { type: 'dim', dt: 'lin', p1, p2, p, ang: G.normA(getN(o, 50, 0) * D2R) } : { type: 'dim', dt: 'ali', p1, p2, p }; }
      else if (ty === 3) { const a = P(10, 20), b = P(15, 25), m = P(11, 21); if (a && b) { const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; d0 = { type: 'dim', dt: 'dia', c, p1: b, p: m || b }; } }
      else if (ty === 4) { const c = P(10, 20), q = P(15, 25), m = P(11, 21); if (c && q) d0 = { type: 'dim', dt: 'rad', c, p1: q, p: m || q }; }
      else if (ty === 5) { const p1 = P(13, 23), p2 = P(14, 24), c = P(15, 25), p = P(10, 20); if (p1 && p2 && c && p) d0 = { type: 'dim', dt: 'ang', c, p1, p2, p }; }
      else if (ty === 2) {
        const a1 = P(13, 23), a2 = P(14, 24), b1 = P(15, 25), b2 = P(10, 20), p = P(16, 26);
        if (a1 && a2 && b1 && b2 && p) { const x = G.interPrims(G.L(a1[0], a1[1], a2[0], a2[1]), G.L(b1[0], b1[1], b2[0], b2[1]), true, true)[0]; if (x) d0 = { type: 'dim', dt: 'ang', c: x, p1: G.dist(x, a2) > G.dist(x, a1) ? a2 : a1, p2: G.dist(x, b2) > G.dist(x, b1) ? b2 : b1, p }; }
      }
      if (!d0) return null;
      if (txt != null) d0.txt = txt; if (tp && d0.dt !== 'rad' && d0.dt !== 'dia') d0.tp = tp;
      return d0;
    }
    function readHatch(o) {
      const tg = o.tags; let k = tg.findIndex(x => x[0] === 91); if (k < 0) return null;
      const pat = getS(o, 2, 'SOLID').toUpperCase(), solid = getN(o, 70, 0) === 1;
      const nLoops = num(tg[k][1]); k++;
      const loops = [];
      const nextVal = code => { while (k < tg.length && tg[k][0] !== code) k++; return k < tg.length ? num(tg[k++][1]) : 0; };
      for (let L = 0; L < nLoops && k < tg.length; L++) {
        const flags = nextVal(92), pts = [];
        if (flags & 2) {
          const hasB = nextVal(72); nextVal(73); const n = nextVal(93);
          for (let q = 0; q < n && k < tg.length; q++) { const x = nextVal(10), y = nextVal(20); pts.push([x, y, hasB ? nextVal(42) : 0]); }
        } else {
          const ne = nextVal(93);
          for (let ei = 0; ei < ne && k < tg.length; ei++) {
            const et = nextVal(72);
            if (et === 1) { const x1 = nextVal(10), y1 = nextVal(20), x2 = nextVal(11), y2 = nextVal(21); pts.push([x1, y1, 0]); void x2; void y2; }
            else if (et === 2) {
              const cx = nextVal(10), cy = nextVal(20), r = nextVal(40); let s = nextVal(50) * D2R, e = nextVal(51) * D2R; const isCcw = nextVal(73);
              if (isCcw) { const sw = G.arcSweep(s, e); pts.push([cx + r * Math.cos(s), cy + r * Math.sin(s), G.bulgeOf(sw)]); }
              else { s = -s; e = -e; const sw = G.arcSweep(e, s); pts.push([cx + r * Math.cos(s), cy + r * Math.sin(s), -G.bulgeOf(sw)]); }
            } else if (et === 3) {
              const cx = nextVal(10), cy = nextVal(20), mx = nextVal(11), my = nextVal(21), ratio = nextVal(40); let s = nextVal(50) * D2R, e = nextVal(51) * D2R; const isCcw = nextVal(73);
              let ep = isCcw ? ellipsePts(cx, cy, mx, my, ratio, s, e) : ellipsePts(cx, cy, mx, my, ratio, -e, -s).reverse();
              ep.slice(0, -1).forEach(p => pts.push([p[0], p[1], 0]));
            } else if (et === 4) {
              const deg = nextVal(94); nextVal(73); nextVal(74); const nk = nextVal(95), nc = nextVal(96); const knots = [], ctrl = [];
              for (let q = 0; q < nk; q++) knots.push(nextVal(40));
              for (let q = 0; q < nc; q++) ctrl.push([nextVal(10), nextVal(20)]);
              bspline(deg, knots, ctrl).slice(0, -1).forEach(p => pts.push([p[0], p[1], 0]));
            }
          }
        }
        if (pts.length >= 2) loops.push({ pts });
      }
      if (!loops.length) return null;
      const e = { type: 'hatch', pat: solid ? 'SOLID' : (M.PATTERNS[pat] ? pat : 'ANSI31'), loops, sc: 1, ang: 0 };
      if (!solid) { const sc = tg.find(x => x[0] === 41), an = tg.find(x => x[0] === 52); if (sc) e.sc = Math.abs(num(sc[1])) || 1; if (an) e.ang = G.normA(num(an[1]) * D2R); }
      if (!solid && !M.PATTERNS[pat]) W('unknown hatch patterns shown as ANSI31');
      return e;
    }
    // blocks
    let blk = null;
    const blocksObjs = secs.BLOCKS || [];
    for (let i = 0; i < blocksObjs.length;) {
      const o = blocksObjs[i];
      if (o.type === 'BLOCK') { const name = getS(o, 2), fl = getN(o, 70, 0); blk = { name, base: [getN(o, 10), getN(o, 20)], ents: [], skip: /^\*(model|paper)_space/i.test(name) || !!(fl & 4) }; i++; continue; }
      if (o.type === 'ENDBLK') { if (blk && !blk.skip && blk.name) d.blocks[blk.name] = { base: blk.base, ents: blk.ents }; blk = null; i++; continue; }
      if (blk && !blk.skip) i = convert(blocksObjs, i, blk.ents, true); else i++;
    }
    // entities
    const ents = [], eo = secs.ENTITIES || [];
    for (let i = 0; i < eo.length;) i = convert(eo, i, ents, false);
    // dimension fallbacks reference anonymous blocks; other anonymous blocks are only used through inserts
    d.ents = ents.map(e => { delete e._dimGeom; return e; });
    // drop dimension geometry blocks that are no longer referenced
    const used = new Set(); const mark = list => list.forEach(e => { if (e.type === 'insert' && !used.has(e.name)) { used.add(e.name); if (d.blocks[e.name]) mark(d.blocks[e.name].ents); } });
    mark(d.ents);
    for (const k of Object.keys(d.blocks)) if (k.startsWith('*') && !used.has(k)) delete d.blocks[k];
    // missing blocks
    d.ents = d.ents.filter(e => e.type !== 'insert' || d.blocks[e.name] || (W('missing block definitions'), false));
    // layers referenced but not in table get created by normalize
    for (const l of d.layers) if (!M.LTYPES[l.lt] && !d.ltypes[l.lt]) l.lt = 'CONTINUOUS';
    d.cur = d.layers.some(l => l.name === curLayer) ? curLayer : '0';
    M.normalize(d);
    for (const l of d.layers) if (!M.LTYPES[l.lt] && !(d.ltypes && d.ltypes[l.lt])) l.lt = 'CONTINUOUS';
    d.ents.forEach(e => { if (e.lt && e.lt !== 'BYBLOCK' && !M.LTYPES[e.lt] && !d.ltypes[e.lt]) delete e.lt; });
    return { doc: d, warnings: Object.entries(warn).map(([k, n]) => `${n} ${k}`) };
  }

  /* ======================= writing ======================= */
  const fmt = v => { if (!Number.isFinite(v)) return '0'; let s = (Math.abs(v) < 1e-10 ? 0 : v).toFixed(10); s = s.replace(/0+$/, '').replace(/\.$/, '.0'); return s === '-0.0' ? '0.0' : s; };
  const encText = s => String(s).replace(/°/g, '%%d').replace(/[Ø⌀]/g, '%%c').replace(/±/g, '%%p').replace(/[^\x00-\x7f]/g, ch => '\\U+' + ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'));
  const encMText = s => encText(String(s).replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}')).replace(/\n/g, '\\P');
  const unitCode = u => ({ in: 1, ft: 2, mm: 4, cm: 5, m: 6 })[u] || 4;
  // SOLID fill → trapezoids (even-odd scanline), for R12 hatches and dimension arrows
  function trapezoids(loops) {
    const polys = loops.map(l => G.flatten(l.pts)), edges = [];
    for (const p of polys) for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; if (Math.abs(a[1] - b[1]) > 1e-12) edges.push(a[1] < b[1] ? [a, b] : [b, a]); }
    const ys = [...new Set(polys.flat().map(p => +p[1].toFixed(9)))].sort((a, b) => a - b), out = [];
    const xAt = (e, y) => e[0][0] + (e[1][0] - e[0][0]) * (y - e[0][1]) / (e[1][1] - e[0][1]);
    for (let i = 0; i + 1 < ys.length; i++) {
      const y0 = ys[i], y1 = ys[i + 1], ym = (y0 + y1) / 2;
      const act = edges.filter(e => e[0][1] <= ym && e[1][1] > ym).sort((a, b) => xAt(a, ym) - xAt(b, ym));
      for (let k = 0; k + 1 < act.length; k += 2) out.push([[xAt(act[k], y0), y0], [xAt(act[k + 1], y0), y0], [xAt(act[k + 1], y1), y1], [xAt(act[k], y1), y1]]);
    }
    return out;
  }

  function writeDXF(doc, opts = {}) {
    const R12 = opts.version === 'R12', L = [];
    const g = (c, v) => { L.push(String(c).padStart(3, ' '), typeof v === 'number' ? fmt(v) : String(v)); };
    const gi = (c, v) => { L.push(String(c).padStart(3, ' '), String(Math.round(v))); };
    let hseq = 0x100; const H = () => (hseq++).toString(16).toUpperCase();
    const ltOf = name => M.LTYPES[name] || (doc.ltypes && doc.ltypes[name]);
    // collect linetypes in use
    const lts = new Set(['CONTINUOUS']);
    const scanLt = list => list.forEach(e => { if (e.lt && e.lt !== 'BYBLOCK' && ltOf(e.lt)) lts.add(e.lt); });
    doc.layers.forEach(l => lts.add(ltOf(l.lt) ? l.lt : 'CONTINUOUS')); scanLt(doc.ents); Object.values(doc.blocks).forEach(b => scanLt(b.ents));
    // dimension blocks
    const dimBlocks = []; let dn = 1;
    const dimName = new Map();
    doc.ents.forEach(e => { if (e.type === 'dim') { const name = '*D' + dn++; dimName.set(e, name); dimBlocks.push({ name, base: [0, 0], ents: M.dimGeom(e, doc.dimstyle).map(x => ({ ...x, layer: '0', color: 0 })) }); } });
    let hn = 1; const hatchBlocks = [], hatchName = new Map();
    if (R12) doc.ents.forEach(e => { if (e.type === 'hatch') { const name = '*X' + hn++; hatchName.set(e, name); hatchBlocks.push({ name, base: [0, 0], ents: hatchGeom(e).map(x => ({ ...x, layer: '0', color: 0 })) }); } });
    const userBlocks = Object.entries(doc.blocks).map(([name, b]) => ({ name, base: b.base, ents: b.ents }));
    const allBlocks = [...userBlocks, ...dimBlocks, ...hatchBlocks];
    // fixed handles (R2000)
    const h = { vport: 'A', ltype: '5', layer: '2', style: '3', view: '6', ucs: '7', appid: '9', dimstyle: 'A0', br: '1', dict: 'C', groupDict: 'D', layoutDict: '1A' };
    const brH = {}, layoutH = { model: '22', paper: '1E' };
    brH['*Model_Space'] = '1F'; brH['*Paper_Space'] = '1B';
    allBlocks.forEach(b => { brH[b.name] = H(); });
    const ext = M.extents(doc) || [0, 0, 100, 100];

    // ---- HEADER
    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, R12 ? 'AC1009' : 'AC1015');
    if (!R12) { g(9, '$DWGCODEPAGE'); g(3, 'ANSI_1252'); }
    g(9, '$INSBASE'); g(10, 0); g(20, 0); g(30, 0);
    g(9, '$EXTMIN'); g(10, ext[0]); g(20, ext[1]); g(30, 0);
    g(9, '$EXTMAX'); g(10, ext[2]); g(20, ext[3]); g(30, 0);
    g(9, '$LTSCALE'); g(40, doc.ltscale || 1);
    g(9, '$CLAYER'); g(8, doc.cur || '0');
    g(9, '$TEXTSIZE'); g(40, doc.textH || 2.5);
    const ds = doc.dimstyle;
    g(9, '$DIMSCALE'); g(40, ds.scale); g(9, '$DIMASZ'); g(40, ds.asz); g(9, '$DIMEXO'); g(40, ds.exo); g(9, '$DIMEXE'); g(40, ds.exe); g(9, '$DIMTXT'); g(40, ds.txt); g(9, '$DIMGAP'); g(40, ds.gap);
    if (!R12) { g(9, '$DIMDEC'); gi(70, ds.dec); g(9, '$INSUNITS'); gi(70, unitCode(doc.units)); g(9, '$MEASUREMENT'); gi(70, doc.units === 'in' || doc.units === 'ft' ? 0 : 1); g(9, '$HANDSEED'); g(5, 'FFFFF'); }
    g(0, 'ENDSEC');
    const hsIdx = L.indexOf('FFFFF');
    if (!R12) { g(0, 'SECTION'); g(2, 'CLASSES'); g(0, 'ENDSEC'); }

    // ---- TABLES
    g(0, 'SECTION'); g(2, 'TABLES');
    const table = (name, handle, count, fn, extra) => {
      g(0, 'TABLE'); g(2, name); if (!R12) { g(5, handle); g(330, '0'); g(100, 'AcDbSymbolTable'); } gi(70, count); if (!R12 && extra) extra(); fn(); g(0, 'ENDTAB');
    };
    const rec = (type, tblH, sub, hcode = 5) => { g(0, type); if (!R12) { g(hcode, H()); g(330, tblH); g(100, 'AcDbSymbolTableRecord'); g(100, sub); } };
    table('VPORT', h.vport, 1, () => {
      rec('VPORT', h.vport, 'AcDbViewportTableRecord'); g(2, '*ACTIVE'); gi(70, 0); g(10, 0); g(20, 0); g(11, 1); g(21, 1);
      g(12, (ext[0] + ext[2]) / 2); g(22, (ext[1] + ext[3]) / 2); g(13, 0); g(23, 0); g(14, 10); g(24, 10); g(15, 10); g(25, 10); g(16, 0); g(26, 0); g(36, 1); g(17, 0); g(27, 0); g(37, 0);
      g(40, Math.max(ext[3] - ext[1], (ext[2] - ext[0]) / 1.6) * 1.1 || 100); g(41, 1.6); g(42, 50); g(43, 0); g(44, 0); g(50, 0); g(51, 0); gi(71, 0); gi(72, 100); gi(73, 1); gi(74, 3); gi(75, 0); gi(76, 0); gi(77, 0); gi(78, 0);
    });
    const ltList = [...lts];
    const ltRecs = R12 ? ltList : ['BYBLOCK', 'BYLAYER', ...ltList];
    table('LTYPE', h.ltype, ltRecs.length, () => {
      for (const name of ltRecs) {
        rec('LTYPE', h.ltype, 'AcDbLinetypeTableRecord'); g(2, name); gi(70, 0);
        const def = ltOf(name) || { desc: '', pat: [] }; g(3, name === 'CONTINUOUS' ? 'Solid line' : def.desc || ''); gi(72, 65); gi(73, def.pat.length);
        g(40, def.pat.reduce((s, x) => s + Math.abs(x), 0)); for (const x of def.pat) { g(49, x); if (!R12) gi(74, 0); }
      }
    });
    table('LAYER', h.layer, doc.layers.length, () => {
      for (const l of doc.layers) {
        rec('LAYER', h.layer, 'AcDbLayerTableRecord'); g(2, l.name); gi(70, (l.frozen ? 1 : 0) | (l.locked ? 4 : 0)); gi(62, l.on ? l.color : -l.color); g(6, ltOf(l.lt) ? l.lt : 'CONTINUOUS');
        if (!R12) { gi(290, l.plot === false ? 0 : 1); gi(370, l.lw); g(390, 'F'); }
      }
    });
    table('STYLE', h.style, 1, () => { rec('STYLE', h.style, 'AcDbTextStyleTableRecord'); g(2, 'STANDARD'); gi(70, 0); g(40, 0); g(41, 1); g(50, 0); gi(71, 0); g(42, 2.5); g(3, 'arial.ttf'); g(4, ''); });
    table('VIEW', h.view, 0, () => { });
    table('UCS', h.ucs, 0, () => { });
    table('APPID', h.appid, 1, () => { rec('APPID', h.appid, 'AcDbRegAppTableRecord'); g(2, 'ACAD'); gi(70, 0); });
    table('DIMSTYLE', h.dimstyle, 1, () => {
      rec('DIMSTYLE', h.dimstyle, 'AcDbDimStyleTableRecord', R12 ? 5 : 105); g(2, 'STANDARD'); gi(70, 0);
      g(40, ds.scale); g(41, ds.asz); g(42, ds.exo); g(44, ds.exe); g(140, ds.txt); g(147, ds.gap); gi(77, 1); gi(73, 0); gi(74, 0); if (!R12) gi(271, ds.dec);
    }, () => { g(100, 'AcDbDimStyleTable'); gi(71, 0); });
    if (!R12) table('BLOCK_RECORD', h.br, 2 + allBlocks.length, () => {
      const br = (name, hh, lay) => { g(0, 'BLOCK_RECORD'); g(5, hh); g(330, h.br); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbBlockTableRecord'); g(2, name); g(340, lay || '0'); };
      br('*Model_Space', brH['*Model_Space'], layoutH.model); br('*Paper_Space', brH['*Paper_Space'], layoutH.paper);
      allBlocks.forEach(b => br(b.name, brH[b.name]));
    });
    g(0, 'ENDSEC');

    // ---- entities
    function ent(type, e, owner, sub) {
      g(0, type); if (!R12) { g(5, H()); g(330, owner); g(100, 'AcDbEntity'); }
      g(8, e.layer || '0');
      if (e.lt) g(6, e.lt === 'BYBLOCK' ? 'BYBLOCK' : e.lt);
      if (e.color != null && e.color !== 256) gi(62, e.color);
      if (!R12 && e.lw != null && e.lw !== -1) gi(370, e.lw);
      if (e.lts && e.lts !== 1) g(48, e.lts);
      if (!R12 && sub) g(100, sub);
    }
    function textEnt(t, owner) {
      ent('TEXT', t, owner, 'AcDbText');
      const al = t.align || 0, va = t.valign || 0;
      g(10, t.x); g(20, t.y); g(30, 0); g(40, t.h); g(1, encText(t.s)); if (t.rot) g(50, t.rot * R2D); g(7, 'STANDARD');
      if (al) gi(72, al);
      if (al || va) { g(11, t.x); g(21, t.y); g(31, 0); }
      if (!R12) g(100, 'AcDbText');
      if (va) gi(73, va);
    }
    function writeEnt(e, owner) {
      switch (e.type) {
        case 'line': ent('LINE', e, owner, 'AcDbLine'); g(10, e.x1); g(20, e.y1); g(30, 0); g(11, e.x2); g(21, e.y2); g(31, 0); break;
        case 'point': ent('POINT', e, owner, 'AcDbPoint'); g(10, e.x); g(20, e.y); g(30, 0); break;
        case 'circle': ent('CIRCLE', e, owner, 'AcDbCircle'); g(10, e.cx); g(20, e.cy); g(30, 0); g(40, e.r); break;
        case 'arc': ent('ARC', e, owner, 'AcDbCircle'); g(10, e.cx); g(20, e.cy); g(30, 0); g(40, e.r); if (!R12) g(100, 'AcDbArc'); g(50, G.normA(e.a1) * R2D); g(51, G.normA(e.a2) * R2D); break;
        case 'pline':
          if (R12) {
            ent('POLYLINE', e, owner); gi(66, 1); g(10, 0); g(20, 0); g(30, 0); gi(70, e.closed ? 1 : 0); if (e.w) { g(40, e.w); g(41, e.w); }
            for (const p of e.pts) { g(0, 'VERTEX'); g(8, e.layer || '0'); g(10, p[0]); g(20, p[1]); g(30, 0); if (p[2]) g(42, p[2]); }
            g(0, 'SEQEND'); g(8, e.layer || '0');
          } else {
            ent('LWPOLYLINE', e, owner, 'AcDbPolyline'); gi(90, e.pts.length); gi(70, e.closed ? 1 : 0); g(43, e.w || 0);
            for (const p of e.pts) { g(10, p[0]); g(20, p[1]); if (p[2]) g(42, p[2]); }
          }
          break;
        case 'solid': {
          ent('SOLID', e, owner, 'AcDbTrace'); const p = e.pts, q = p.length === 3 ? [p[0], p[1], p[2], p[2]] : [p[0], p[1], p[3], p[2]];
          q.forEach((pt, i) => { g(10 + i, pt[0]); g(20 + i, pt[1]); g(30 + i, 0); }); break;
        }
        case 'text': textEnt(e, owner); break;
        case 'mtext':
          if (R12) { for (const t of M.mtextLines(e)) textEnt({ ...G.strip(e), ...t }, owner); break; }
          ent('MTEXT', e, owner, 'AcDbMText'); g(10, e.x); g(20, e.y); g(30, 0); g(40, e.h); g(41, e.w || 0); gi(71, e.attach || 1); gi(72, 1);
          { const s = encMText(e.s); for (let i = 0; i + 250 < s.length; i += 250) g(3, s.slice(i, i + 250)); g(1, s.slice(Math.floor(Math.max(0, s.length - 1) / 250) * 250)); }
          g(7, 'STANDARD'); if (e.rot) g(50, e.rot * R2D); break;
        case 'insert':
          ent('INSERT', e, owner, 'AcDbBlockReference'); g(2, e.name); g(10, e.x); g(20, e.y); g(30, 0);
          if ((e.sx ?? 1) !== 1) g(41, e.sx); if ((e.sy ?? 1) !== 1) g(42, e.sy); if ((e.sx ?? 1) !== 1 || (e.sy ?? 1) !== 1) g(43, 1); if (e.rot) g(50, e.rot * R2D); break;
        case 'dim': writeDim(e, owner); break;
        case 'hatch':
          if (R12) { ent('INSERT', e, owner); g(2, hatchName.get(e)); g(10, 0); g(20, 0); g(30, 0); break; }
          writeHatch(e, owner); break;
      }
    }
    function writeDim(e, owner) {
      const name = dimName.get(e); if (!name) return;
      const code = { lin: 0, ali: 1, ang: 5, dia: 3, rad: 4 }[e.dt];
      ent('DIMENSION', e, owner, 'AcDbDimension'); g(2, name);
      const geo = M.dimGeom(e, doc.dimstyle), t = geo.find(x => x.type === 'text') || { x: 0, y: 0 };
      const P = (c, p) => { g(c, p[0]); g(c + 10, p[1]); g(c + 20, 0); };
      let def;
      if (e.dt === 'lin' || e.dt === 'ali') {
        const a = e.dt === 'lin' ? (e.ang || 0) : G.ang(e.p2[0] - e.p1[0], e.p2[1] - e.p1[1]), nx = -Math.sin(a), ny = Math.cos(a), o2 = (e.p[0] - e.p2[0]) * nx + (e.p[1] - e.p2[1]) * ny;
        def = [e.p2[0] + nx * o2, e.p2[1] + ny * o2];
      } else if (e.dt === 'dia') { const r = G.dist(e.c, e.p1); def = [2 * e.c[0] - e.p1[0], 2 * e.c[1] - e.p1[1]]; void r; }
      else if (e.dt === 'rad') def = e.c; else def = e.p;
      P(10, def); P(11, e.tp || [t.x, t.y]); gi(70, code | 32 | (e.tp ? 128 : 0)); g(1, e.txt != null ? encMText(e.txt) : ''); g(3, 'STANDARD');
      if (e.dt === 'lin' || e.dt === 'ali') { if (!R12) g(100, 'AcDbAlignedDimension'); P(13, e.p1); P(14, e.p2); if (e.dt === 'lin') { g(50, (e.ang || 0) * R2D); if (!R12) g(100, 'AcDbRotatedDimension'); } }
      else if (e.dt === 'rad' || e.dt === 'dia') { if (!R12) g(100, e.dt === 'rad' ? 'AcDbRadialDimension' : 'AcDbDiametricDimension'); P(15, e.p1); g(40, 0); }
      else if (e.dt === 'ang') { if (!R12) g(100, 'AcDb3PointAngularDimension'); P(13, e.p1); P(14, e.p2); P(15, e.c); }
    }
    function writeHatch(e, owner) {
      const pat = M.PATTERNS[e.pat] || M.PATTERNS.ANSI31, solid = !pat.fams.length;
      ent('HATCH', e, owner, 'AcDbHatch'); g(10, 0); g(20, 0); g(30, 0); g(210, 0); g(220, 0); g(230, 1);
      g(2, solid ? 'SOLID' : e.pat); gi(70, solid ? 1 : 0); gi(71, 0); gi(91, e.loops.length);
      e.loops.forEach((l, i) => {
        gi(92, 2 | (i === 0 ? 1 : 0)); const hasB = l.pts.some(p => p[2]); gi(72, hasB ? 1 : 0); gi(73, 1); gi(93, l.pts.length);
        for (const p of l.pts) { g(10, p[0]); g(20, p[1]); if (hasB) g(42, p[2] || 0); }
        gi(97, 0);
      });
      gi(75, 0); gi(76, 1);
      if (!solid) {
        const ang = e.ang || 0, sc = e.sc || 1; g(52, ang * R2D); g(41, sc); gi(77, 0); gi(78, pat.fams.length);
        for (const f of pat.fams) {
          const la = f.a * D2R + ang, c = Math.cos(ang), s = Math.sin(ang), bx = f.x * sc, by = f.y * sc;
          g(53, G.normA(la) * R2D); g(43, bx * c - by * s); g(44, bx * s + by * c);
          const ox = f.dx * sc, oy = f.dy * sc; g(45, ox * Math.cos(la) - oy * Math.sin(la)); g(46, ox * Math.sin(la) + oy * Math.cos(la));
          gi(79, (f.dash || []).length); for (const d0 of f.dash || []) g(49, d0 * sc);
        }
      }
      gi(98, 0);
    }
    function hatchGeom(e) {
      const pat = M.PATTERNS[e.pat] || M.PATTERNS.ANSI31;
      if (!pat.fams.length) return trapezoids(e.loops).map(q => ({ type: 'solid', pts: q }));
      return G.hatchLines(e.loops, pat.fams, e.sc || 1, e.ang || 0).map(s => ({ type: 'line', x1: s[0], y1: s[1], x2: s[2], y2: s[3] }));
    }

    // ---- BLOCKS
    g(0, 'SECTION'); g(2, 'BLOCKS');
    const blockHdr = (name, base, flags, ps) => {
      g(0, 'BLOCK'); if (!R12) { g(5, H()); g(330, brH[name]); g(100, 'AcDbEntity'); if (ps) gi(67, 1); } g(8, '0'); if (!R12) g(100, 'AcDbBlockBegin');
      g(2, name); gi(70, flags); g(10, base[0]); g(20, base[1]); g(30, 0); g(3, name); g(1, '');
    };
    const blockEnd = (name, ps) => { g(0, 'ENDBLK'); if (!R12) { g(5, H()); g(330, brH[name]); g(100, 'AcDbEntity'); if (ps) gi(67, 1); } g(8, '0'); if (!R12) g(100, 'AcDbBlockEnd'); };
    if (!R12) { blockHdr('*Model_Space', [0, 0], 0); blockEnd('*Model_Space'); blockHdr('*Paper_Space', [0, 0], 0, true); blockEnd('*Paper_Space', true); }
    for (const b of allBlocks) {
      blockHdr(b.name, b.base, b.name.startsWith('*') ? 1 : 0);
      for (const e of b.ents) writeEnt(e, brH[b.name]);
      blockEnd(b.name);
    }
    g(0, 'ENDSEC');
    // ---- ENTITIES
    g(0, 'SECTION'); g(2, 'ENTITIES');
    for (const e of doc.ents) writeEnt(e, brH['*Model_Space']);
    g(0, 'ENDSEC');
    // ---- OBJECTS
    if (!R12) {
      g(0, 'SECTION'); g(2, 'OBJECTS');
      g(0, 'DICTIONARY'); g(5, h.dict); g(330, '0'); g(100, 'AcDbDictionary'); gi(281, 1); g(3, 'ACAD_GROUP'); g(350, h.groupDict); g(3, 'ACAD_LAYOUT'); g(350, h.layoutDict); g(3, 'ACAD_PLOTSTYLENAME'); g(350, 'E');
      g(0, 'DICTIONARY'); g(5, h.groupDict); g(330, h.dict); g(100, 'AcDbDictionary'); gi(281, 1);
      g(0, 'ACDBDICTIONARYWDFLT'); g(5, 'E'); g(330, h.dict); g(100, 'AcDbDictionary'); gi(281, 1); g(3, 'Normal'); g(350, 'F'); g(100, 'AcDbDictionaryWithDefault'); g(340, 'F');
      g(0, 'ACDBPLACEHOLDER'); g(5, 'F'); g(330, 'E');
      g(0, 'DICTIONARY'); g(5, h.layoutDict); g(330, h.dict); g(100, 'AcDbDictionary'); gi(281, 1); g(3, 'Model'); g(350, layoutH.model); g(3, 'Layout1'); g(350, layoutH.paper);
      const paper = M.PAPERS[doc.layout && doc.layout.paper] || M.PAPERS.A3;
      const layout = (hh, name, flags, order, brh) => {
        g(0, 'LAYOUT'); g(5, hh); g(330, h.layoutDict);
        g(100, 'AcDbPlotSettings'); g(1, ''); g(2, 'none_device'); g(4, ''); g(6, ''); g(40, 0); g(41, 0); g(42, 0); g(43, 0); g(44, paper[0]); g(45, paper[1]); g(46, 0); g(47, 0); g(48, 0); g(49, 0); g(140, 0); g(141, 0); g(142, 1); g(143, 1);
        gi(70, flags ? 1024 : 688); gi(72, 1); gi(73, 0); gi(74, 5); g(7, ''); gi(75, 16); g(147, 1); g(148, 0); g(149, 0);
        g(100, 'AcDbLayout'); g(1, name); gi(70, 1); gi(71, order); g(10, 0); g(20, 0); g(11, paper[0]); g(21, paper[1]); g(12, 0); g(22, 0); g(32, 0);
        g(14, ext[0]); g(24, ext[1]); g(34, 0); g(15, ext[2]); g(25, ext[3]); g(35, 0); g(146, 0); g(13, 0); g(23, 0); g(33, 0); g(16, 1); g(26, 0); g(36, 0); g(17, 0); g(27, 1); g(37, 0); gi(76, 0); g(330, brh);
      };
      layout(layoutH.model, 'Model', true, 0, brH['*Model_Space']);
      layout(layoutH.paper, 'Layout1', false, 1, brH['*Paper_Space']);
      g(0, 'ENDSEC');
    }
    g(0, 'EOF');
    if (!R12) L[hsIdx] = (hseq + 1).toString(16).toUpperCase();
    return L.join('\n') + '\n';
  }

  return { readDXF, writeDXF, pairsOf, decodeText, decodeMText, encText, trapezoids, bspline };
});
