'use strict';
/* Lumen Layout — Knuth–Plass optimal ("paragraph composer") line breaking.
   items: boxes {t:'b', w}, glue {t:'g', w, y (stretch), z (shrink), ci}, penalties {t:'p', w, p, f (flagged), ci, hy}.
   lineWidth(k) gives the measure of line k. Returns the chosen breakpoints [{ci, hy}] (ci = index where the
   next line starts) or null when no feasible set of breaks exists within the tolerance. */
(function () {
  const INF = 10000;
  function breaks(items, lineWidth, tolerance = 2) {
    const n = items.length, sumW = new Float64Array(n + 1), sumY = new Float64Array(n + 1), sumZ = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const it = items[i];
      sumW[i + 1] = sumW[i] + (it.t === 'p' ? 0 : it.w); sumY[i + 1] = sumY[i] + (it.t === 'g' ? it.y : 0); sumZ[i + 1] = sumZ[i] + (it.t === 'g' ? it.z : 0);
    }
    let active = [{ pos: -1, line: 0, fit: 1, tw: 0, ty: 0, tz: 0, dem: 0, prev: null, flagged: false }];
    for (let b = 0; b < n; b++) {
      const it = items[b];
      const legal = it.t === 'p' ? it.p < INF : it.t === 'g' ? b > 0 && items[b - 1].t === 'b' : false;
      if (!legal) continue;
      const cands = [null, null, null, null];
      for (let ai = 0; ai < active.length; ai++) {
        const a = active[ai];
        let L = sumW[b] - a.tw; if (it.t === 'p') L += it.w;
        const W = lineWidth(a.line);
        let r;
        if (L < W) { const Y = sumY[b] - a.ty; r = Y > 0 ? (W - L) / Y : INF; }
        else if (L > W) { const Z = sumZ[b] - a.tz; r = Z > 0 ? (W - L) / Z : -INF; }
        else r = 0;
        const forced = it.t === 'p' && it.p <= -INF;
        if (r < -1 || forced) { active.splice(ai, 1); ai--; }
        if (r >= -1 && r <= tolerance) {
          const bad = 100 * Math.pow(Math.abs(r), 3);
          let d = Math.pow(10 + bad, 2);
          if (it.t === 'p') { if (it.p >= 0) d += it.p * it.p; else if (it.p > -INF) d -= it.p * it.p; }
          if (it.t === 'p' && it.f && a.flagged) d += 3000;
          const fit = r < -0.5 ? 0 : r <= 0.5 ? 1 : r <= 1 ? 2 : 3;
          if (a.pos >= 0 && Math.abs(fit - a.fit) > 1) d += 3000;
          d += a.dem;
          if (!cands[fit] || d < cands[fit].d) cands[fit] = { d, a };
        }
      }
      if (cands.some(Boolean)) {
        let tw = sumW[b], ty = sumY[b], tz = sumZ[b];
        for (let k = b; k < n; k++) { const x = items[k]; if (x.t === 'b') break; if (x.t === 'g') { tw += x.w; ty += x.y; tz += x.z; } else if (x.p <= -INF && k > b) break; }
        cands.forEach((c, fit) => { if (c) active.push({ pos: b, line: c.a.line + 1, fit, tw, ty, tz, dem: c.d, prev: c.a, flagged: it.t === 'p' && !!it.f }); });
      }
      if (!active.length) return null;
    }
    let best = null;
    for (const a of active) if (a.pos === n - 1 && (!best || a.dem < best.dem)) best = a;
    if (!best) return null;
    const out = [];
    for (let a = best; a && a.pos >= 0; a = a.prev) { const it = items[a.pos]; out.push({ ci: it.ci, hy: !!it.hy }); }
    return out.reverse();
  }
  window.KP = { breaks, INF };
})();
