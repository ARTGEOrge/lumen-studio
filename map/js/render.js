// Lumen Map — map renderer. Draws a document's layers (reprojected on the fly) into any Canvas2D-like context:
// the on-screen canvas, a PNG export canvas, or SvgCtx (vector SVG, also the source for vector PDF).
(function (root) {
  'use strict';
  const P = root.MapProj, G = root.MapGeo, C = root.MapClass, X = root.MapExpr;

  // ---------- projected geometry cache ----------
  const cache = new WeakMap();
  const crsKey = d => d.code || JSON.stringify([d.proj, d.lon0, d.lat0, d.lat1, d.lat2, d.k0, d.x0, d.y0, d.a, d.f]);
  // returns {t:'pt'|'ln'|'pg', parts:[Float64Array], polys:[[Float64Array…]], bbox, pts:[[x,y]]}
  function projected(f, crs) {
    const key = crsKey(crs); let c = cache.get(f);
    if (c && c.key === key) return c.v;
    const m = P.make(crs), v = projectGeom(f.geometry, m);
    cache.set(f, { key, v }); return v;
  }
  function projectGeom(g, m) {
    const out = { pts: [], lines: [], polys: [], bbox: [Infinity, Infinity, -Infinity, -Infinity] };
    if (!g) return out;
    const b = out.bbox;
    const arr = (coords, ring) => {
      const a = new Float64Array(coords.length * 2); let bad = false;
      for (let i = 0; i < coords.length; i++) {
        const c = coords[i]; let p;
        if (!m.validLon(c[0])) bad = true;
        p = m.forward(c);
        if (!isFinite(p[0]) || !isFinite(p[1])) { bad = true; p = [NaN, NaN]; }
        a[i * 2] = p[0]; a[i * 2 + 1] = p[1];
        if (p[0] === p[0]) { if (p[0] < b[0]) b[0] = p[0]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[1] > b[3]) b[3] = p[1]; }
      }
      return ring && bad ? null : a;
    };
    const walk = g => {
      switch (g.type) {
        case 'Point': { const a = arr([g.coordinates]); if (a[0] === a[0]) out.pts.push([a[0], a[1]]); break; }
        case 'MultiPoint': g.coordinates.forEach(c => { const a = arr([c]); if (a[0] === a[0]) out.pts.push([a[0], a[1]]); }); break;
        case 'LineString': out.lines.push(arr(g.coordinates)); break;
        case 'MultiLineString': g.coordinates.forEach(l => out.lines.push(arr(l))); break;
        case 'Polygon': { const rs = g.coordinates.map(r => arr(r, true)).filter(Boolean); if (rs.length) out.polys.push(rs); break; }
        case 'MultiPolygon': g.coordinates.forEach(p => { const rs = p.map(r => arr(r, true)).filter(Boolean); if (rs.length) out.polys.push(rs); }); break;
        case 'GeometryCollection': g.geometries.forEach(walk); break;
      }
    };
    walk(g);
    return out;
  }
  const toCoords = a => { const r = []; for (let i = 0; i < a.length; i += 2) r.push([a[i], a[i + 1]]); return r; };

  // ---------- view ----------
  // view: {cx, cy, res (map units per px), w, h}
  const makeView = v => ({ ...v, sx: X0 => (X0 - v.cx) / v.res + v.w / 2, sy: Y0 => v.h / 2 - (Y0 - v.cy) / v.res, mx: x => v.cx + (x - v.w / 2) * v.res, my: y => v.cy - (y - v.h / 2) * v.res });
  const viewBox = v => [v.cx - v.w / 2 * v.res, v.cy - v.h / 2 * v.res, v.cx + v.w / 2 * v.res, v.cy + v.h / 2 * v.res];

  // ---------- styles ----------
  const DASH = { solid: [], dash: [7, 4], dot: [1.5, 3], dashdot: [7, 3, 1.5, 3] };
  function styler(L) {
    const s = L.style || {}, base = { fill: s.fill || '#6aa0d8', stroke: s.stroke || '#2b4a6b', width: s.width ?? 1, size: s.size ?? 7, shape: s.shape || 'circle', fillOpacity: s.fillOpacity ?? 0.75, dash: DASH[s.dash] || [] };
    if (s.mode === 'categorized' && s.field) {
      const map = new Map((s.categories || []).map(c => [String(c.value), c])), other = s.otherColor || null;
      return f => { const v = f.properties[s.field], c = map.get(String(v ?? '')); if (c) return c.visible === false ? null : { ...base, fill: c.color, stroke: L.geomType === 'LineString' ? c.color : base.stroke }; return other ? { ...base, fill: other, stroke: L.geomType === 'LineString' ? other : base.stroke } : null; };
    }
    if (s.mode === 'graduated' && s.field && s.classes && s.classes.length) {
      const cls = s.classes, bySize = s.gradBy === 'size', n = cls.length;
      return f => {
        const v = f.properties[s.field], i = C.classOf(cls, typeof v === 'number' ? v : v == null || v === '' ? NaN : +v);
        if (i < 0) return s.hideNoData === false ? { ...base, fill: '#cccccc' } : null;
        if (cls[i].visible === false) return null;
        if (bySize) { const sz = (s.sizeMin ?? 4) + (n > 1 ? i / (n - 1) : 1) * ((s.sizeMax ?? 22) - (s.sizeMin ?? 4)); return L.geomType === 'LineString' ? { ...base, width: sz / 3 } : { ...base, size: sz }; }
        return { ...base, fill: cls[i].color, stroke: L.geomType === 'LineString' ? cls[i].color : base.stroke };
      };
    }
    return () => base;
  }
  // symbol path for a point marker
  function marker(ctx, x, y, shape, size) {
    const r = size / 2; ctx.beginPath();
    switch (shape) {
      case 'square': ctx.rect(x - r, y - r, size, size); break;
      case 'triangle': ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x + r, y + r * 0.75); ctx.lineTo(x - r, y + r * 0.75); ctx.closePath(); break;
      case 'diamond': ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r, y); ctx.closePath(); break;
      case 'star': for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r * 1.15; i ? ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a)) : ctx.moveTo(x + rr * Math.cos(a), y + rr * Math.sin(a)); } ctx.closePath(); break;
      case 'cross': { const w = r * 0.38; ctx.moveTo(x - w, y - r); ctx.lineTo(x + w, y - r); ctx.lineTo(x + w, y - w); ctx.lineTo(x + r, y - w); ctx.lineTo(x + r, y + w); ctx.lineTo(x + w, y + w); ctx.lineTo(x + w, y + r); ctx.lineTo(x - w, y + r); ctx.lineTo(x - w, y + w); ctx.lineTo(x - r, y + w); ctx.lineTo(x - r, y - w); ctx.lineTo(x - w, y - w); ctx.closePath(); break; }
      default: ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }
  function alpha(hexc, a) { const [r, g, b] = C.hex(hexc); return `rgba(${r},${g},${b},${a})`; }

  // ---------- path tracing with pixel decimation ----------
  function trace(ctx, a, V, close) {
    let lx = NaN, ly = NaN, open = false, n = a.length / 2;
    for (let i = 0; i < n; i++) {
      const X0 = a[i * 2]; if (X0 !== X0) { open = false; continue; }
      const x = (X0 - V.cx) / V.res + V.w / 2, y = V.h / 2 - (a[i * 2 + 1] - V.cy) / V.res;
      if (!open) { ctx.moveTo(x, y); open = true; lx = x; ly = y; continue; }
      if (i < n - 1 && Math.abs(x - lx) < 0.6 && Math.abs(y - ly) < 0.6) continue;
      ctx.lineTo(x, y); lx = x; ly = y;
    }
    if (close && open) ctx.closePath();
  }
  const bboxIn = (b, vb) => b[0] <= vb[2] && b[2] >= vb[0] && b[1] <= vb[3] && b[3] >= vb[1];

  // ---------- one layer ----------
  function drawLayer(ctx, L, crs, V, opts = {}) {
    if (!L.features || !L.features.length) return;
    const vb = viewBox(V), sty = styler(L), filt = L.filter ? X.compile(L.filter) : null, scale = opts.symbolScale || 1;
    const sel = opts.selection, labels = opts.labels;
    ctx.save(); ctx.globalAlpha = (L.opacity ?? 1);
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    const selected = [];
    for (const f of L.features) {
      if (!f.geometry) continue;
      if (filt && !filt.test(f)) continue;
      const g = projected(f, crs); if (!bboxIn(g.bbox, vb)) continue;
      const st = sty(f); if (!st) continue;
      paintFeature(ctx, g, st, V, scale, L.geomType);
      if (sel && sel.has(f.id)) selected.push(g);
      if (labels) labels.push({ f, g });
    }
    if (selected.length) {
      ctx.globalAlpha = 1;
      selected.forEach(g => paintFeature(ctx, g, { fill: '#ffee00', stroke: '#00c8ff', width: 2.5, size: (L.style?.size ?? 7) + 4, shape: L.style?.shape || 'circle', fillOpacity: 0.28, dash: [], sel: true }, V, scale, L.geomType));
    }
    ctx.restore();
  }
  function paintFeature(ctx, g, st, V, scale, geomType) {
    if (g.polys.length) {
      ctx.beginPath(); g.polys.forEach(rs => rs.forEach(r => trace(ctx, r, V, true)));
      if (st.fill && st.fillOpacity > 0) { ctx.fillStyle = alpha(st.fill, st.fillOpacity); ctx.fill('evenodd'); }
      if (st.width > 0) { ctx.strokeStyle = st.stroke; ctx.lineWidth = st.width * scale; ctx.setLineDash(st.dash.map(d => d * scale * Math.max(1, st.width))); ctx.stroke(); ctx.setLineDash([]); }
    }
    if (g.lines.length) {
      ctx.beginPath(); g.lines.forEach(l => trace(ctx, l, V, false));
      if (st.sel) { ctx.strokeStyle = 'rgba(0,200,255,.9)'; ctx.lineWidth = 6 * scale; ctx.stroke(); }
      else {
        if (st.casing) { ctx.strokeStyle = st.casing; ctx.lineWidth = (st.width + 2) * scale; ctx.stroke(); }
        ctx.strokeStyle = geomType === 'LineString' ? (st.fill || st.stroke) : st.stroke; ctx.lineWidth = Math.max(0.5, st.width) * scale; ctx.setLineDash(st.dash.map(d => d * scale * Math.max(1, st.width))); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (g.pts.length) {
      for (const p of g.pts) {
        const x = (p[0] - V.cx) / V.res + V.w / 2, y = V.h / 2 - (p[1] - V.cy) / V.res;
        if (x < -40 || y < -40 || x > V.w + 40 || y > V.h + 40) continue;
        marker(ctx, x, y, st.shape, st.size * scale);
        ctx.fillStyle = st.sel ? 'rgba(255,238,0,.5)' : st.fill; ctx.fill();
        if (st.width > 0) { ctx.strokeStyle = st.sel ? '#00c8ff' : st.stroke; ctx.lineWidth = (st.sel ? 2.5 : st.width) * scale; ctx.stroke(); }
      }
    }
  }

  // ---------- labels (simple greedy collision avoidance) ----------
  function drawLabels(ctx, items, V, opts = {}) {
    const boxes = [], scale = opts.symbolScale || 1;
    const hit = b => boxes.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    items.forEach(({ L, list }) => {
      const lb = L.labels; if (!lb || !lb.on || !lb.expr) return;
      const ex = X.compile(lb.expr); if (!ex.ok) return;
      const size = (lb.size || 11) * scale, font = `${lb.italic ? 'italic ' : ''}${lb.bold ? 'bold ' : ''}${size}px "Segoe UI", Arial, sans-serif`;
      ctx.save(); ctx.font = font; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.globalAlpha = 1;
      for (const { f, g } of list) {
        let txt; try { txt = ex.eval(f); } catch (e) { continue; } if (txt == null || txt === '') continue;
        txt = typeof txt === 'number' ? C.fmt(txt) : String(txt).slice(0, 80);
        const w = ctx.measureText(txt).width, h = size * 1.2;
        let x, y, ang = 0, align = 'center';
        if (g.pts.length) { const p = g.pts[0]; x = V.sx(p[0]) + ((L.style?.size ?? 7) / 2 + 3) * scale; y = V.sy(p[1]); align = 'left'; }
        else if (g.lines.length) {
          let best = null, bl = 0; g.lines.forEach(a => { let len = 0; for (let i = 2; i < a.length; i += 2) len += Math.hypot(a[i] - a[i - 2], a[i + 1] - a[i - 1]); if (len > bl) { bl = len; best = a; } });
          if (!best || bl / V.res < w * 1.1) continue;
          let half = bl / 2, i = 2; for (; i < best.length; i += 2) { const d = Math.hypot(best[i] - best[i - 2], best[i + 1] - best[i - 1]); if (half <= d) break; half -= d; }
          if (i >= best.length) continue;
          const x0 = V.sx(best[i - 2]), y0 = V.sy(best[i - 1]), x1 = V.sx(best[i]), y1 = V.sy(best[i + 1]), d = Math.hypot(x1 - x0, y1 - y0) || 1, t = half / V.res / d;
          x = x0 + (x1 - x0) * Math.min(1, t); y = y0 + (y1 - y0) * Math.min(1, t); ang = Math.atan2(y1 - y0, x1 - x0); if (ang > Math.PI / 2) ang -= Math.PI; if (ang < -Math.PI / 2) ang += Math.PI;
        } else if (g.polys.length) {
          if (!g.lp) { let big = null, ba = -1; g.polys.forEach(rs => { const c = toCoords(rs[0]), a = Math.abs(G.ringArea(c)); if (a > ba) { ba = a; big = rs; } }); g.lp = G.pointOnSurface({ type: 'Polygon', coordinates: big.map(toCoords) }); g.la = ba; }
          if (!g.lp || g.la / (V.res * V.res) < w * h * 0.6) continue;
          x = V.sx(g.lp[0]); y = V.sy(g.lp[1]);
        } else continue;
        if (!(x > -50 && x < V.w + 50 && y > -20 && y < V.h + 20)) continue;
        const ext = Math.abs(Math.cos(ang)) * w + Math.abs(Math.sin(ang)) * h, exy = Math.abs(Math.sin(ang)) * w + Math.abs(Math.cos(ang)) * h;
        const boxAt = (px, py) => align === 'left' ? [px - 2, py - h / 2, px + w + 2, py + h / 2] : [px - ext / 2 - 2, py - exy / 2, px + ext / 2 + 2, py + exy / 2];
        let bx = boxAt(x, y);
        if (hit(bx)) {
          // polygons and points try a few alternative positions
          const alts = g.polys.length ? [[0, -h * 1.1], [0, h * 1.1], [0, -h * 2.2], [0, h * 2.2], [-w * 0.6, 0], [w * 0.6, 0], [-w * 0.6, -h * 1.1], [w * 0.6, h * 1.1], [w * 0.6, -h * 1.1], [-w * 0.6, h * 1.1], [0, -h * 3.3], [0, h * 3.3], [-w, -h * 2.2], [w, h * 2.2], [w, -h * 2.2], [-w, h * 2.2]] : g.pts.length ? [[0, -h * 0.75], [0, h * 0.75]] : [];
          const ok = alts.find(([dx, dy]) => { const b2 = boxAt(x + dx, y + dy); if (hit(b2)) return false; if (g.polys.length) { const m = [V.mx(x + dx), V.my(y + dy)]; if (!g.polys.some(rs => G.pointInPolygon(m, rs.map(toCoords)))) return false; } return true; });
          if (!ok) continue; x += ok[0]; y += ok[1]; bx = boxAt(x, y);
        }
        boxes.push(bx);
        ctx.save(); ctx.translate(x, y); if (ang) ctx.rotate(ang); ctx.textAlign = align;
        if (lb.halo !== false) { ctx.strokeStyle = lb.haloColor || '#ffffff'; ctx.lineWidth = 3 * scale; ctx.strokeText(txt, 0, 0); }
        ctx.fillStyle = lb.color || '#1d2733'; ctx.fillText(txt, 0, 0);
        ctx.restore();
      }
      ctx.restore();
    });
  }

  // ---------- graticule & projection outline ----------
  const STEPS = [90, 45, 30, 20, 15, 10, 5, 2, 1, 0.5, 0.25, 0.1, 0.05, 0.025, 0.01, 0.005, 0.0025, 0.001];
  function viewLonLat(crs, V) {
    const m = P.make(crs); let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
      const p = m.inverse([V.mx(V.w * i / 8), V.my(V.h * j / 8)]); if (!isFinite(p[0]) || !isFinite(p[1])) continue;
      if (P.make(crs).world && Math.abs(p[1]) > 89.999) continue;
      x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
    }
    return [x0, y0, x1, y1];
  }
  function graticuleStep(crs, V) {
    const m = P.make(crs), c = m.inverse([V.cx, V.cy]), d = m.inverse([V.cx + V.res * 110, V.cy]);
    let deg = Math.abs(d[0] - c[0]); if (!isFinite(deg) || deg === 0) deg = 10;
    return STEPS.find(s => s <= deg) || STEPS[STEPS.length - 1];
  }
  function drawGraticule(ctx, crs, V, opts = {}) {
    const m = P.make(crs), step = opts.step || graticuleStep(crs, V), world = m.world || m.isGeographic;
    let [lo0, la0, lo1, la1] = viewLonLat(crs, V);
    const fullLon = world && (lo1 - lo0 > 300); if (!isFinite(lo0) || fullLon || world && V.w * V.res > 3e6 && !m.isGeographic) { lo0 = -180; lo1 = 180; }
    if (!isFinite(la0)) { la0 = -90; la1 = 90; }
    // views touching a pole: show all meridians
    if (la1 > 80 || la0 < -80) { lo0 = -180; lo1 = 180; }
    lo0 = Math.max(-180, Math.floor(lo0 / step) * step - step); lo1 = Math.min(180, Math.ceil(lo1 / step) * step + step);
    la0 = Math.max(-90, Math.floor(la0 / step) * step - step); la1 = Math.min(90, Math.ceil(la1 / step) * step + step);
    if (!m.isGeographic && crs.proj === 'tmerc') { lo0 = Math.max(lo0, m.lon0 - 40); lo1 = Math.min(lo1, m.lon0 + 40); }
    const latMax = crs.proj === 'webmerc' || crs.proj === 'merc' ? 85 : 90;
    la0 = Math.max(la0, -latMax); la1 = Math.min(la1, latMax);
    const sub = Math.min(step / 8, 1), lines = [];
    const proj = (lon, lat) => { if (!m.validLon(lon)) return [NaN, NaN]; const p = m.forward([lon, lat]); return [V.sx(p[0]), V.sy(p[1])]; };
    if ((lo1 - lo0) / step > 400 || (la1 - la0) / step > 400) return;
    for (let lon = lo0; lon <= lo1 + 1e-9; lon += step) { const pts = []; for (let lat = la0; lat <= la1 + 1e-9; lat += sub) pts.push(proj(lon, Math.min(lat, la1))); lines.push({ lon: +lon.toFixed(6), pts }); }
    for (let lat = la0; lat <= la1 + 1e-9; lat += step) { const pts = []; for (let lon = lo0; lon <= lo1 + 1e-9; lon += sub) pts.push(proj(Math.min(lon, lo1), lat)); lines.push({ lat: +lat.toFixed(6), pts }); }
    ctx.save(); ctx.strokeStyle = opts.color || 'rgba(70,110,150,.35)'; ctx.lineWidth = opts.width || 0.8; ctx.setLineDash(opts.dash || []);
    lines.forEach(l => { ctx.beginPath(); let on = false; l.pts.forEach(p => { if (!(p[0] === p[0])) { on = false; return; } on ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); on = true; }); ctx.stroke(); });
    ctx.setLineDash([]);
    if (opts.labels !== false) {
      ctx.fillStyle = opts.labelColor || 'rgba(40,70,100,.85)'; ctx.font = `${opts.fontSize || 10}px "Segoe UI", Arial, sans-serif`;
      const fmt = v => { const a = Math.abs(v); return (a % 1 ? +a.toFixed(4) : a) + '°'; };
      lines.forEach(l => {
        const pts = l.pts;
        if (l.lon != null) { // where it crosses the bottom edge
          for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; if (a[0] === a[0] && b[0] === b[0] && (a[1] - (V.h - 1)) * (b[1] - (V.h - 1)) <= 0 && a[1] !== b[1]) { const x = a[0] + (b[0] - a[0]) * ((V.h - 1) - a[1]) / (b[1] - a[1]); if (x > 15 && x < V.w - 15) { ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(fmt(l.lon) + (l.lon > 0 ? 'E' : l.lon < 0 ? 'W' : ''), x, V.h - 3); } break; } }
        } else {
          for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; if (a[0] === a[0] && b[0] === b[0] && a[0] * b[0] <= 0 && a[0] !== b[0]) { const y = a[1] + (b[1] - a[1]) * (0 - a[0]) / (b[0] - a[0]); if (y > 12 && y < V.h - 18) { ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(fmt(l.lat) + (l.lat > 0 ? 'N' : l.lat < 0 ? 'S' : ''), 4, y); } break; } }
        }
      });
    }
    ctx.restore();
  }
  // the outline of the whole projected world (for world projections), used as the "sea" background
  function worldOutline(crs) {
    const m = P.make(crs); if (!(m.world || m.isGeographic)) return null;
    const lm = crs.proj === 'webmerc' || crs.proj === 'merc' ? 85.0511 : 90, ring = [];
    const L0 = m.lon0 - 180 + 1e-9, L1 = m.lon0 + 180 - 1e-9;
    for (let la = -lm; la <= lm; la += 1) ring.push(m.forward([L0, la]));
    for (let lo = L0; lo <= L1; lo += 1) ring.push(m.forward([lo, lm]));
    for (let la = lm; la >= -lm; la -= 1) ring.push(m.forward([L1, la]));
    for (let lo = L1; lo >= L0; lo -= 1) ring.push(m.forward([lo, -lm]));
    return ring;
  }

  // ---------- whole map ----------
  // opts: {doc, crs, view, selection: Map(layerId->Set), background, graticule, symbolScale, frame}
  function drawMap(ctx, opts) {
    const V = makeView(opts.view), crs = P.get(opts.crs);
    ctx.save();
    const wo = worldOutline(crs);
    ctx.fillStyle = opts.background || (wo ? '#e9eef3' : '#f3f7fb'); ctx.fillRect(0, 0, V.w, V.h);
    if (wo) { ctx.beginPath(); wo.forEach((p, i) => i ? ctx.lineTo(V.sx(p[0]), V.sy(p[1])) : ctx.moveTo(V.sx(p[0]), V.sy(p[1]))); ctx.closePath(); ctx.fillStyle = opts.sea || '#dbeaf6'; ctx.fill(); ctx.strokeStyle = 'rgba(60,100,140,.45)'; ctx.lineWidth = 1; ctx.stroke(); }
    const grat = opts.graticule || {};
    if (grat.on !== false && grat.under !== false) drawGraticule(ctx, crs, V, { ...grat, labels: false });
    const labelItems = [];
    (opts.doc.layers || []).slice().reverse().forEach(L => {
      if (!L.visible) return;
      const list = L.labels && L.labels.on ? [] : null;
      drawLayer(ctx, L, crs, V, { selection: opts.selection && opts.selection.get(L.id), labels: list, symbolScale: opts.symbolScale });
      if (list) labelItems.push({ L, list });
    });
    if (grat.on !== false) drawGraticule(ctx, crs, V, { ...grat, color: 'rgba(0,0,0,0)', labels: grat.labels !== false });
    labelItems.reverse(); drawLabels(ctx, labelItems, V, { symbolScale: opts.symbolScale });
    ctx.restore();
  }

  // ---------- hit testing (projected coordinates) ----------
  function hitTest(L, crs, X0, Y0, tol) {
    const filt = L.filter ? X.compile(L.filter) : null, sty = styler(L);
    for (let k = L.features.length - 1; k >= 0; k--) {
      const f = L.features[k]; if (!f.geometry || (filt && !filt.test(f)) || !sty(f)) continue;
      const g = projected(f, crs), b = g.bbox;
      if (X0 < b[0] - tol || X0 > b[2] + tol || Y0 < b[1] - tol || Y0 > b[3] + tol) continue;
      if (g.pts.some(p => Math.hypot(p[0] - X0, p[1] - Y0) <= tol * 1.3)) return f;
      if (g.lines.some(a => { for (let i = 2; i < a.length; i += 2) if (G.segDist2([X0, Y0], [a[i - 2], a[i - 1]], [a[i], a[i + 1]]) <= tol * tol) return true; return false; })) return f;
      if (g.polys.some(rs => G.pointInPolygon([X0, Y0], rs.map(toCoords)))) return f;
    }
    return null;
  }
  // features whose projected geometry intersects a projected rectangle
  function boxSelect(L, crs, box) {
    const filt = L.filter ? X.compile(L.filter) : null, out = [], rect = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]], [box[0], box[1]]];
    for (const f of L.features) {
      if (!f.geometry || (filt && !filt.test(f))) continue;
      const g = projected(f, crs), b = g.bbox; if (!G.bboxHit(b, box)) continue;
      const inBox = (x, y) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3];
      let hit = g.pts.some(p => inBox(p[0], p[1]));
      const arrs = [...g.lines, ...g.polys.flat()];
      if (!hit) hit = arrs.some(a => { for (let i = 0; i < a.length; i += 2) if (inBox(a[i], a[i + 1])) return true; for (let i = 2; i < a.length; i += 2) for (let k = 1; k < 5; k++) if (G.segIntersect([a[i - 2], a[i - 1]], [a[i], a[i + 1]], rect[k - 1], rect[k])) return true; return false; });
      if (!hit) hit = g.polys.some(rs => G.pointInPolygon([box[0], box[1]], rs.map(toCoords)));
      if (hit) out.push(f.id);
    }
    return out;
  }
  function layerBBox(L, crs) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    L.features.forEach(f => { if (!f.geometry) return; const x = projected(f, crs).bbox; b[0] = Math.min(b[0], x[0]); b[1] = Math.min(b[1], x[1]); b[2] = Math.max(b[2], x[2]); b[3] = Math.max(b[3], x[3]); });
    return isFinite(b[0]) ? b : null;
  }

  // ---------- SVG recording context (Canvas2D subset with full affine transform) ----------
  class SvgCtx {
    constructor(w, h) { this.width = w; this.height = h; this.out = []; this.defs = []; this.ids = 0; this.stack = []; this.d = ''; this.m = [1, 0, 0, 1, 0, 0]; this.s = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic', globalAlpha: 1, dash: [], clip: null, lineJoin: 'miter', lineCap: 'butt' }; this._mc = null; }
    get fillStyle() { return this.s.fillStyle; } set fillStyle(v) { this.s.fillStyle = v; }
    get strokeStyle() { return this.s.strokeStyle; } set strokeStyle(v) { this.s.strokeStyle = v; }
    get lineWidth() { return this.s.lineWidth; } set lineWidth(v) { this.s.lineWidth = +v; }
    get font() { return this.s.font; } set font(v) { this.s.font = v; }
    get textAlign() { return this.s.textAlign; } set textAlign(v) { this.s.textAlign = v; }
    get textBaseline() { return this.s.textBaseline; } set textBaseline(v) { this.s.textBaseline = v; }
    get globalAlpha() { return this.s.globalAlpha; } set globalAlpha(v) { this.s.globalAlpha = +v; }
    get lineJoin() { return this.s.lineJoin; } set lineJoin(v) { this.s.lineJoin = v; }
    get lineCap() { return this.s.lineCap; } set lineCap(v) { this.s.lineCap = v; }
    save() { this.stack.push({ s: { ...this.s, dash: this.s.dash.slice() }, m: this.m.slice() }); }
    restore() { const t = this.stack.pop(); if (t) { this.s = t.s; this.m = t.m; } }
    translate(x, y) { const m = this.m; m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; }
    rotate(a) { const c = Math.cos(a), s = Math.sin(a), [A, B, Cc, D] = this.m; this.m[0] = A * c + Cc * s; this.m[1] = B * c + D * s; this.m[2] = -A * s + Cc * c; this.m[3] = -B * s + D * c; }
    scale(x, y) { this.m[0] *= x; this.m[1] *= x; this.m[2] *= y; this.m[3] *= y; }
    setTransform(a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; }
    setLineDash(d) { this.s.dash = (d || []).slice(); }
    P(x, y) { const m = this.m; return [r2(m[0] * x + m[2] * y + m[4]), r2(m[1] * x + m[3] * y + m[5])]; }
    beginPath() { this.d = ''; }
    moveTo(x, y) { const p = this.P(x, y); this.d += `M${p[0]} ${p[1]}`; }
    lineTo(x, y) { const p = this.P(x, y); this.d += `L${p[0]} ${p[1]}`; }
    closePath() { this.d += 'Z'; }
    rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
    arc(x, y, r, a0, a1, ccw) {
      const sc = Math.sqrt(Math.abs(this.m[0] * this.m[3] - this.m[1] * this.m[2])), rr = r2(r * sc);
      if (Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6) { const c = this.P(x, y); this.d += `M${r2(c[0] - rr)} ${c[1]}A${rr} ${rr} 0 1 0 ${r2(c[0] + rr)} ${c[1]}A${rr} ${rr} 0 1 0 ${r2(c[0] - rr)} ${c[1]}Z`; return; }
      const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) / 0.2)); for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; (i || !this.d ? this.lineTo : this.lineTo).call(this, x + r * Math.cos(a), y + r * Math.sin(a)); }
    }
    paint(c) { c = String(c); const m = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(c); return m ? [`rgb(${+m[1]},${+m[2]},${+m[3]})`, +m[4]] : [c, 1]; }
    clipAttr() { return this.s.clip ? ` clip-path="url(#${this.s.clip})"` : ''; }
    fill(rule) { if (!this.d) return; const [c, a] = this.paint(this.s.fillStyle), o = a * this.s.globalAlpha; if (o <= 0) return; this.out.push(`<path d="${this.d}" fill="${xe(c)}"${o < 1 ? ` fill-opacity="${r3(o)}"` : ''}${rule === 'evenodd' ? ' fill-rule="evenodd"' : ''}${this.clipAttr()}/>`); }
    stroke() {
      if (!this.d) return; const [c, a] = this.paint(this.s.strokeStyle), o = a * this.s.globalAlpha; if (o <= 0) return;
      const sc = Math.sqrt(Math.abs(this.m[0] * this.m[3] - this.m[1] * this.m[2]));
      this.out.push(`<path d="${this.d}" fill="none" stroke="${xe(c)}"${o < 1 ? ` stroke-opacity="${r3(o)}"` : ''} stroke-width="${r3(this.s.lineWidth * sc)}"${this.s.lineJoin !== 'miter' ? ` stroke-linejoin="${this.s.lineJoin}"` : ''}${this.s.lineCap !== 'butt' ? ` stroke-linecap="${this.s.lineCap}"` : ''}${this.s.dash.length ? ` stroke-dasharray="${this.s.dash.map(v => r3(v * sc)).join(' ')}"` : ''}${this.clipAttr()}/>`);
    }
    fillRect(x, y, w, h) { const d = this.d; this.beginPath(); this.rect(x, y, w, h); this.fill(); this.d = d; }
    strokeRect(x, y, w, h) { const d = this.d; this.beginPath(); this.rect(x, y, w, h); this.stroke(); this.d = d; }
    clearRect() { }
    clip() { const id = 'c' + (++this.ids); this.defs.push(`<clipPath id="${id}"><path d="${this.d}"/></clipPath>`); this.s.clip = id; }
    measureText(t) { if (!this._mc && typeof document !== 'undefined') this._mc = document.createElement('canvas').getContext('2d'); if (this._mc) { this._mc.font = this.s.font; return this._mc.measureText(t); } return { width: String(t).length * parseFloat(/([\d.]+)px/.exec(this.s.font)?.[1] || 10) * 0.55 }; }
    text(t, x, y, stroke) {
      const fm = /^\s*(?:(?:bold|italic|normal)\s+)*([\d.]+)px\s+(.+)$/.exec(this.s.font) || [], size = +fm[1] || 10, fam = (fm[2] || 'sans-serif').replace(/"/g, "'"), pre = this.s.font.split(/[\d.]+px/)[0], bold = /bold/.test(pre), ital = /italic/.test(pre);
      const anchor = { center: 'middle', right: 'end', end: 'end' }[this.s.textAlign] || 'start';
      const dy = { middle: 0.35, top: 0.8, hanging: 0.8, bottom: -0.2 }[this.s.textBaseline] || 0;
      const [c, a] = this.paint(stroke ? this.s.strokeStyle : this.s.fillStyle), o = a * this.s.globalAlpha, m = this.m;
      const paint = stroke ? `fill="none" stroke="${xe(c)}" stroke-width="${r3(this.s.lineWidth)}" stroke-linejoin="round"${o < 1 ? ` stroke-opacity="${r3(o)}"` : ''}` : `fill="${xe(c)}"${o < 1 ? ` fill-opacity="${r3(o)}"` : ''}`;
      this.out.push(`<text transform="matrix(${m.map(r3).join(' ')})" x="${r2(x)}" y="${r2(y + dy * size)}" font-family="${xe(fam)}" font-size="${size}"${bold ? ' font-weight="bold"' : ''}${ital ? ' font-style="italic"' : ''} text-anchor="${anchor}" ${paint}${this.clipAttr()}>${xe(t)}</text>`);
    }
    fillText(t, x, y) { this.text(t, x, y, false); }
    strokeText(t, x, y) { this.text(t, x, y, true); }
    toString() { return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${this.width}" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}"><defs>${this.defs.join('')}</defs>\n${this.out.join('\n')}\n</svg>\n`; }
  }
  const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000;
  const xe = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  root.MapRender = { projected, projectGeom, makeView, viewBox, styler, marker, drawLayer, drawLabels, drawGraticule, graticuleStep, worldOutline, drawMap, hitTest, boxSelect, layerBBox, SvgCtx, toCoords, DASH, crsKey };
})(typeof self !== 'undefined' ? self : this);
