'use strict';
/* Lumen Cut — rolling edit, slide and rate-stretch edit primitives (pure data, no DOM).
   Each primitive is split into a "limits" function (the legal range of the drag delta, in seconds)
   and an "apply" function, so the timeline tools, the menu commands and the tests share the same code. */
(function () {
  const EPS = 1e-4;
  const one = () => 1 / LC.fps();
  // clip on the same track that ends exactly where `c` starts / starts exactly where `c` ends
  LC.prevAdjacent = c => LC.clipsOn(c.track).find(o => o.id !== c.id && Math.abs(o.start + o.dur - c.start) < EPS) || null;
  LC.nextAdjacent = c => LC.clipsOn(c.track).find(o => o.id !== c.id && Math.abs(o.start - (c.start + c.dur)) < EPS) || null;
  const prevEnd = (c, excl) => { let e = 0; for (const o of LC.clipsOn(c.track)) if (!excl.has(o.id) && o.id !== c.id && o.start + o.dur <= c.start + EPS) e = Math.max(e, o.start + o.dur); return e; };
  const nextStart = (c, excl) => { let s = Infinity; for (const o of LC.clipsOn(c.track)) if (!excl.has(o.id) && o.id !== c.id && o.start >= c.start + c.dur - EPS) s = Math.min(s, o.start); return s; };
  // how far the clip's left edge may move left (≤ 0) before running out of source material
  const headRoom = x => (LC.isTimeBased(x) ? -x.in / Math.max(.05, LC.speedAt(x, 0)) : -Infinity);
  // how far the right edge may move right before running out of source material
  const tailRoom = x => (LC.isTimeBased(x) ? LC.maxDur(x) - x.dur : Infinity);

  /* ---------- rolling edit: move the cut between a (left) and b (right); total length is unchanged ----------
     A pair may have a or b null (edit point next to a gap): then that side behaves like a plain trim limited by the gap. */
  LC.rollPairs = (c, edge, withLinked = true) => {
    const mk = x => edge === 'r' ? { a: x, b: LC.nextAdjacent(x) } : { a: LC.prevAdjacent(x), b: x };
    const pairs = [mk(c)];
    if (withLinked) for (const l of LC.linked(c)) { if (!LC.track(l.track)?.lock) pairs.push(mk(l)); }
    return pairs;
  };
  LC.rollLimits = pairs => {
    let lo = -Infinity, hi = Infinity; const o = one(), excl = new Set();
    pairs.forEach(p => { if (p.a) excl.add(p.a.id); if (p.b) excl.add(p.b.id); });
    for (const { a, b } of pairs) {
      if (a) { lo = Math.max(lo, o - a.dur); hi = Math.min(hi, tailRoom(a)); if (!b) hi = Math.min(hi, nextStart(a, excl) - (a.start + a.dur)); }
      if (b) { hi = Math.min(hi, b.dur - o); lo = Math.max(lo, headRoom(b)); if (!a) lo = Math.max(lo, prevEnd(b, excl) - b.start); }
    }
    return [Math.min(0, lo), Math.max(0, hi)];
  };
  LC.rollEdit = (pairs, d) => {
    const [lo, hi] = LC.rollLimits(pairs); d = LC.fr(Math.max(lo, Math.min(hi, d)));
    if (Math.abs(d) < 1e-9) return 0;
    for (const { a, b } of pairs) {
      if (a) a.dur = LC.fr(a.dur + d);
      if (b) { LC.trimStart(b, LC.fr(b.start + d)); b.dur = LC.fr(b.dur); }
    }
    return d;
  };

  /* ---------- slide: move clip c in time; its left neighbour's out point and right neighbour's in point follow,
     so the clip keeps its content and duration and the overall sequence length is unchanged ---------- */
  LC.slideGroup = (c, withLinked = true) => [c, ...(withLinked ? LC.linked(c).filter(l => !LC.track(l.track)?.lock) : [])]
    .map(x => ({ c: x, prev: LC.prevAdjacent(x), next: LC.nextAdjacent(x) }));
  LC.slideLimits = group => {
    let lo = -Infinity, hi = Infinity; const o = one(), excl = new Set(group.map(g => g.c.id));
    for (const { c, prev, next } of group) {
      if (prev) { lo = Math.max(lo, o - prev.dur); hi = Math.min(hi, tailRoom(prev)); }
      else lo = Math.max(lo, prevEnd(c, excl) - c.start);
      if (next) { hi = Math.min(hi, next.dur - o); lo = Math.max(lo, headRoom(next)); }
      else hi = Math.min(hi, nextStart(c, excl) - (c.start + c.dur));
    }
    return [Math.min(0, lo), Math.max(0, hi)];
  };
  LC.slideClip = (group, d) => {
    const [lo, hi] = LC.slideLimits(group); d = LC.fr(Math.max(lo, Math.min(hi, d)));
    if (Math.abs(d) < 1e-9) return 0;
    for (const { c, prev, next } of group) {
      if (prev) prev.dur = LC.fr(prev.dur + d);
      if (next) { LC.trimStart(next, LC.fr(next.start + d)); next.dur = LC.fr(next.dur); }
      c.start = LC.fr(c.start + d);
    }
    return d;
  };

  /* ---------- rate stretch: change a clip's duration by changing its speed, keeping the same source range ---------- */
  LC.SPEED_MIN = .1; LC.SPEED_MAX = 10;
  LC.canStretch = c => LC.isTimeBased(c) && c.type !== 'nest' ? !LC.ramped(c) : false;
  LC.stretchGroup = (c, withLinked = true) => [c, ...(withLinked ? LC.linked(c).filter(l => !LC.track(l.track)?.lock && LC.canStretch(l)) : [])];
  // legal new durations [min, max] when dragging edge 'l' or 'r'
  LC.stretchLimits = (group, edge) => {
    const c = group[0], span = c.dur * c.props.speed, excl = new Set(group.map(x => x.id));
    let lo = Math.max(one(), span / LC.SPEED_MAX), hi = span / LC.SPEED_MIN;
    for (const x of group) {
      if (edge === 'r') hi = Math.min(hi, nextStart(x, excl) - x.start);
      else hi = Math.min(hi, x.start + x.dur - prevEnd(x, excl));
    }
    return [Math.min(lo, c.dur), Math.max(hi, c.dur)];
  };
  LC.rateStretch = (group, edge, newDur) => {
    const c = group[0]; if (!LC.canStretch(c)) return null;
    const [lo, hi] = LC.stretchLimits(group, edge); newDur = LC.fr(Math.max(lo, Math.min(hi, newDur)));
    const k = newDur / c.dur; if (Math.abs(k - 1) < 1e-9) return c.props.speed;
    for (const x of group) {
      const end = x.start + x.dur, nd = LC.fr(x.dur * k);
      x.props.speed = Math.max(LC.SPEED_MIN, Math.min(LC.SPEED_MAX, x.props.speed / k));
      for (const key of Object.keys(x.kf || {})) x.kf[key].forEach(q => q.t = q.t * k);
      x.props.fadeIn = Math.min(x.props.fadeIn || 0, nd); x.props.fadeOut = Math.min(x.props.fadeOut || 0, nd);
      if (edge === 'l') x.start = LC.fr(end - nd);
      x.dur = nd;
    }
    return c.props.speed;
  };
})();
