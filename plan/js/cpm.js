// Lumen Plan scheduling engine: working-day calendar, critical path (CPM), float, constraints,
// progress against a data date, resource loading/leveling and earned value. No DOM — also runs in Node for tests.
(function (root) {
  'use strict';
  const DAY = 86400000;
  const parse = s => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const iso = t => new Date(t).toISOString().slice(0, 10);
  const addDays = (s, n) => iso(parse(s) + n * DAY);

  // ---------- calendar ----------
  // cal = { workweek:[Sun..Sat booleans], holidays:['YYYY-MM-DD',...] }. Day index 0 = first working day on/after `start`.
  class Calendar {
    constructor(start, cal = {}) {
      this.start = start;
      this.week = cal.workweek || [false, true, true, true, true, true, false];
      if (!this.week.some(Boolean)) this.week = [false, true, true, true, true, true, false];
      this.hol = new Set(cal.holidays || []);
      this.dates = []; this.index = new Map(); this.t = parse(start);
    }
    isWork(s) { return this.week[new Date(parse(s)).getUTCDay()] && !this.hol.has(s); }
    grow(n) { while (this.dates.length <= n) { const s = iso(this.t); this.t += DAY; if (this.isWork(s)) { this.index.set(s, this.dates.length); this.dates.push(s); } } }
    date(i) { if (i < 0) { let s = this.start, k = 0; while (k > i) { s = addDays(s, -1); if (this.isWork(s)) k--; } return s; } this.grow(i); return this.dates[i]; }
    // index of the first working day on/after date s (negative if before project start)
    idx(s) {
      if (!s) return null;
      if (parse(s) < parse(this.start)) { let k = 0, d = this.start; while (parse(d) > parse(s)) { d = addDays(d, -1); if (this.isWork(d)) k--; } return k; }
      let guard = 0; while (!this.index.has(s) && guard++ < 4000) { if (this.dates.length && parse(this.dates[this.dates.length - 1]) >= parse(s)) { s = addDays(s, 1); continue; } this.grow(this.dates.length + 64); }
      return this.index.get(s);
    }
    // index of the last working day on/before s (for finish dates)
    idxFinish(s) { const i = this.idx(s); return this.date(i) === s ? i : i - 1; }
  }

  // ---------- helpers ----------
  const isSummary = (acts, i) => i + 1 < acts.length && (acts[i + 1].level || 0) > (acts[i].level || 0);
  // remaining duration: "duration" % complete type derives it from %; "physical" type keeps the entered remaining duration
  const remainingOf = a => a.pct >= 100 ? 0 : Math.max(0, Math.ceil((a.remaining != null && a.pctType !== 'duration' ? +a.remaining : a.dur * (1 - (a.pct || 0) / 100)) - 1e-9));

  // ---------- CPM ----------
  // project = { start, dataDate?, calendar, activities:[{id,name,dur,level,pct,actualStart,actualFinish,constraint:{type,date},leveledStart,resources:[{res,units}]}], links:[{from,to,type:'FS'|'SS'|'FF'|'SF',lag}] }
  function schedule(project) {
    const cal = new Calendar(project.start, project.calendar);
    const acts = project.activities;
    const summary = acts.map((a, i) => isSummary(acts, i));
    const work = acts.filter((a, i) => !summary[i]);
    const byId = new Map(work.map(a => [a.id, a]));
    const links = (project.links || []).filter(l => byId.has(l.from) && byId.has(l.to) && l.from !== l.to);
    const succ = new Map(work.map(a => [a.id, []])), pred = new Map(work.map(a => [a.id, []]));
    links.forEach(l => { succ.get(l.from).push(l); pred.get(l.to).push(l); });
    const dd = project.dataDate ? cal.idx(project.dataDate) : 0;
    const warnings = [];

    // topological order (Kahn); leftovers form a loop
    const indeg = new Map(work.map(a => [a.id, pred.get(a.id).length]));
    const order = [], q = work.filter(a => !indeg.get(a.id)).map(a => a.id);
    while (q.length) { const id = q.shift(); order.push(id); succ.get(id).forEach(l => { indeg.set(l.to, indeg.get(l.to) - 1); if (!indeg.get(l.to)) q.push(l.to); }); }
    if (order.length < work.length) {
      const loop = work.filter(a => indeg.get(a.id) > 0).map(a => a.id);
      return { error: 'Relationship loop between: ' + loop.join(', '), loop, cal };
    }

    const r = new Map();
    work.forEach(a => r.set(a.id, { id: a.id, dur: Math.max(0, Math.round(a.dur || 0)), rem: remainingOf(a) }));
    const status = a => a.pct >= 100 && a.actualStart ? 'done' : a.actualStart ? 'active' : 'planned';

    // forward pass
    for (const id of order) {
      const a = byId.get(id), x = r.get(id), st = status(a);
      x.status = st;
      if (st === 'done') {
        x.es = cal.idx(a.actualStart); x.ef = a.actualFinish ? cal.idxFinish(a.actualFinish) + 1 : x.es + x.dur; if (x.dur === 0) x.ef = x.es;
        continue;
      }
      if (st === 'active') { x.es = cal.idx(a.actualStart); x.ef = Math.max(dd, x.es) + x.rem; if (x.ef < x.es) x.ef = x.es; continue; }
      let es = dd;
      for (const l of pred.get(id)) {
        const p = r.get(l.from), lag = Math.round(l.lag || 0);
        let need;
        switch (l.type || 'FS') {
          case 'SS': need = p.es + lag; break;
          case 'FF': need = p.ef + lag - x.dur; break;
          case 'SF': need = p.es + lag - x.dur; break;
          default: need = p.ef + lag;
        }
        es = Math.max(es, need);
      }
      const c = a.constraint;
      if (c && c.date) {
        const ci = cal.idx(c.date);
        if (c.type === 'SNET' || c.type === 'MSO') es = Math.max(es, ci);
        if (c.type === 'FNET') es = Math.max(es, cal.idxFinish(c.date) + 1 - x.dur);
        if (c.type === 'MSO' && es > ci) warnings.push(`${id}: Must Start On ${c.date} can't be met`);
      }
      if (a.leveledStart) es = Math.max(es, cal.idx(a.leveledStart));
      x.es = es; x.ef = es + x.dur;
    }
    const finish = work.length ? Math.max(...work.map(a => r.get(a.id).ef)) : 0;
    const mustFinish = project.mustFinish ? cal.idxFinish(project.mustFinish) + 1 : finish;

    // backward pass
    for (let k = order.length - 1; k >= 0; k--) {
      const id = order[k], a = byId.get(id), x = r.get(id);
      const d = x.status === 'active' ? x.ef - Math.max(dd, x.es) : x.dur;
      let lf = mustFinish;
      for (const l of succ.get(id)) {
        const s = r.get(l.to), lag = Math.round(l.lag || 0);
        if (s.status === 'done') continue;
        let lim;
        switch (l.type || 'FS') {
          case 'SS': lim = s.ls - lag + d; break;
          case 'FF': lim = s.lf - lag; break;
          case 'SF': lim = s.lf - lag + d; break;
          default: lim = s.ls - lag;
        }
        lf = Math.min(lf, lim);
      }
      const c = a.constraint;
      if (c && c.date) {
        if (c.type === 'FNLT') lf = Math.min(lf, cal.idxFinish(c.date) + 1);
        if (c.type === 'SNLT') lf = Math.min(lf, cal.idx(c.date) + d);
        if (c.type === 'MSO') lf = Math.min(lf, cal.idx(c.date) + d);
      }
      x.lf = lf; x.ls = lf - d;
      if (x.status === 'done') { x.lf = x.ef; x.ls = x.es; }
    }

    // floats
    for (const id of order) {
      const x = r.get(id);
      x.tf = x.status === 'done' ? 0 : x.lf - x.ef;
      let ff = mustFinish - x.ef;
      for (const l of succ.get(id)) {
        const s = r.get(l.to), lag = Math.round(l.lag || 0);
        let slack;
        switch (l.type || 'FS') {
          case 'SS': slack = s.es - (x.es + lag); break;
          case 'FF': slack = s.ef - (x.ef + lag); break;
          case 'SF': slack = s.ef - (x.es + lag); break;
          default: slack = s.es - (x.ef + lag);
        }
        ff = Math.min(ff, slack);
      }
      x.ff = x.status === 'done' ? 0 : Math.max(0, Math.min(ff, x.tf));
      x.critical = x.status !== 'done' && x.tf <= (project.criticalFloat || 0);
      x.start = cal.date(x.es);
      x.finish = x.ef > x.es ? cal.date(x.ef - 1) : x.start;
      x.lateStart = cal.date(x.ls);
      x.lateFinish = x.lf > x.ls ? cal.date(x.lf - 1) : x.lateStart;
    }

    // longest path: walk back from the activity finishing last through driving relationships
    const driving = new Set();
    const isDriving = (l) => {
      const p = r.get(l.from), s = r.get(l.to), lag = Math.round(l.lag || 0);
      switch (l.type || 'FS') { case 'SS': return s.es === p.es + lag; case 'FF': return s.ef === p.ef + lag; case 'SF': return s.ef === p.es + lag; default: return s.es === p.ef + lag; }
    };
    links.forEach(l => { l._driving = isDriving(l); });
    const stack = work.filter(a => r.get(a.id).ef === finish).map(a => a.id);
    while (stack.length) { const id = stack.pop(); if (driving.has(id)) continue; driving.add(id); pred.get(id).forEach(l => { if (l._driving) stack.push(l.from); }); }
    driving.forEach(id => r.get(id).longest = true);

    // summaries (WBS rollups): span of children
    const sums = new Map();
    acts.forEach((a, i) => {
      if (!summary[i]) return;
      const lv = a.level || 0; let es = Infinity, ef = -Infinity, tf = Infinity, w = 0, wp = 0;
      for (let j = i + 1; j < acts.length && (acts[j].level || 0) > lv; j++) {
        const x = r.get(acts[j].id); if (!x) continue;
        es = Math.min(es, x.es); ef = Math.max(ef, x.ef); tf = Math.min(tf, x.tf);
        const wt = Math.max(1, x.dur); w += wt; wp += wt * (acts[j].pct || 0);
      }
      if (es === Infinity) { es = ef = dd; tf = 0; }
      sums.set(a.id, { id: a.id, summary: true, es, ef, dur: ef - es, tf, pct: w ? wp / w : 0, start: cal.date(es), finish: ef > es ? cal.date(ef - 1) : cal.date(es) });
    });
    sums.forEach((v, k) => r.set(k, v));

    return { cal, results: r, order, finish, finishDate: finish > 0 ? cal.date(finish - 1) : project.start, dataIdx: dd, links, warnings, summary };
  }

  // ---------- resources ----------
  // daily usage per resource: Map(resId -> Float64Array over [0, finish))
  function resourceUsage(project, sched) {
    const out = new Map(); const n = Math.max(1, sched.finish);
    (project.resources || []).forEach(res => out.set(res.id, new Float64Array(n)));
    project.activities.forEach(a => {
      const x = sched.results.get(a.id); if (!x || x.summary) return;
      (a.resources || []).forEach(as => {
        const arr = out.get(as.res); if (!arr) return;
        for (let d = x.es; d < x.ef && d < n; d++) if (d >= 0) arr[d] += +as.units || 0;
      });
    });
    return out;
  }
  function overallocations(project, sched) {
    const use = resourceUsage(project, sched), out = [];
    (project.resources || []).forEach(res => { const u = use.get(res.id); let days = 0, peak = 0; for (const v of u) { if (v > (res.max ?? Infinity) + 1e-9) days++; peak = Math.max(peak, v); } if (days) out.push({ res: res.id, days, peak, max: res.max }); });
    return out;
  }

  // Serial resource leveling: delay activities (lowest total float first) until every resource
  // stays within its max units/day. Returns { leveled: Map(actId -> start date) } — feed back as leveledStart.
  function level(project, opts = {}) {
    const clean = JSON.parse(JSON.stringify(project)); clean.activities.forEach(a => delete a.leveledStart);
    const base = schedule(clean); if (base.error) return base;
    const resMax = new Map((project.resources || []).map(r => [r.id, r.max ?? Infinity]));
    const load = new Map([...resMax.keys()].map(k => [k, []]));
    const fits = (a, es, dur) => (a.resources || []).every(as => { const arr = load.get(as.res); if (!arr) return true; for (let d = es; d < es + Math.max(dur, 0); d++) if ((arr[d] || 0) + (+as.units || 0) > resMax.get(as.res) + 1e-9) return false; return true; });
    const book = (a, es, dur) => (a.resources || []).forEach(as => { const arr = load.get(as.res); if (!arr) return; for (let d = es; d < es + dur; d++) arr[d] = (arr[d] || 0) + (+as.units || 0); });
    const work = project.activities.filter(a => base.results.get(a.id) && !base.results.get(a.id).summary);
    const byId = new Map(work.map(a => [a.id, a]));
    const pred = new Map(work.map(a => [a.id, []]));
    base.links.forEach(l => pred.get(l.to).push(l));
    const placed = new Map(), leveled = new Map();
    // in-progress and finished work keeps its dates
    work.forEach(a => { const x = base.results.get(a.id); if (x.status !== 'planned') { placed.set(a.id, { es: x.es, ef: x.ef }); book(a, Math.max(x.es, base.dataIdx), x.ef - Math.max(x.es, base.dataIdx)); } });
    const pending = new Set(work.filter(a => !placed.has(a.id)).map(a => a.id));
    // priority: least total float, then most work waiting behind it, then earliest start
    const nSucc = new Map(work.map(a => [a.id, 0])); base.links.forEach(l => nSucc.set(l.from, nSucc.get(l.from) + 1));
    const R = id => base.results.get(id);
    const prio = opts.priority || ((a, b) => R(a).tf - R(b).tf || R(a).ls - R(b).ls || nSucc.get(b) - nSucc.get(a) || R(a).es - R(b).es);
    let guard = 0;
    while (pending.size && guard++ < 100000) {
      const ready = [...pending].filter(id => pred.get(id).every(l => placed.has(l.from))).sort(prio);
      if (!ready.length) break;
      const id = ready[0], a = byId.get(id), x = base.results.get(id);
      let es = x.es;
      pred.get(id).forEach(l => { const p = placed.get(l.from), lag = Math.round(l.lag || 0);
        const need = { SS: p.es + lag, FF: p.ef + lag - x.dur, SF: p.es + lag - x.dur }[l.type] ?? p.ef + lag; es = Math.max(es, need); });
      const logicEs = es;
      let tries = 0; while (!fits(a, es, x.dur) && tries++ < 5000) es++;
      book(a, es, x.dur); placed.set(id, { es, ef: es + x.dur }); pending.delete(id);
      if (es > logicEs) leveled.set(id, base.cal.date(es)); // only delays caused by resources; logic moves the rest
    }
    return { leveled, base };
  }

  // ---------- earned value ----------
  // Budget = sum(units/day × days × resource rate) + activity fixed cost. PV from baseline (or current) dates at the data date,
  // EV = budget × % complete, AC = activity actual cost (entered) — gives SV, CV, SPI, CPI, EAC, and S-curves.
  function budgetOf(project, a) {
    const rates = new Map((project.resources || []).map(r => [r.id, +r.rate || 0]));
    return (+a.cost || 0) + (a.resources || []).reduce((s, as) => s + (+as.units || 0) * (Math.round(a.dur || 0)) * (rates.get(as.res) || 0), 0);
  }
  function earnedValue(project, sched, baseline) {
    const cal = sched.cal, dd = sched.dataIdx;
    let BAC = 0, PV = 0, EV = 0, AC = 0;
    const end = Math.max(sched.finish, dd + 1, ...(baseline ? Object.values(baseline.acts).map(b => cal.idxFinish(b.finish) + 1) : [0]));
    const pvCurve = new Float64Array(end + 1), evDaily = new Float64Array(end + 1);
    project.activities.forEach(a => {
      const x = sched.results.get(a.id); if (!x || x.summary) return;
      const bud = baseline && baseline.acts[a.id] ? baseline.acts[a.id].budget ?? budgetOf(project, a) : budgetOf(project, a);
      BAC += bud; EV += bud * (a.pct || 0) / 100; AC += +a.actualCost || 0;
      let bs = x.es, bf = x.ef;
      if (baseline && baseline.acts[a.id]) { bs = cal.idx(baseline.acts[a.id].start); bf = baseline.acts[a.id].dur === 0 ? bs : cal.idxFinish(baseline.acts[a.id].finish) + 1; }
      const span = Math.max(1, bf - bs);
      for (let d = Math.max(0, bs); d < Math.max(bs + 1, bf) && d <= end; d++) pvCurve[d] += bud / span;
    });
    for (let d = 1; d <= end; d++) pvCurve[d] += pvCurve[d - 1];
    PV = dd > 0 ? pvCurve[Math.min(dd - 1, end)] : 0;
    const SV = EV - PV, CV = EV - AC, SPI = PV ? EV / PV : null, CPI = AC ? EV / AC : null;
    const EAC = CPI ? BAC / CPI : BAC, ETC = EAC - AC, VAC = BAC - EAC;
    return { BAC, PV, EV, AC, SV, CV, SPI, CPI, EAC, ETC, VAC, pvCurve: Array.from(pvCurve), dataIdx: dd };
  }

  // ---------- baselines ----------
  function makeBaseline(project, sched, name) {
    const acts = {};
    project.activities.forEach(a => { const x = sched.results.get(a.id); if (x) acts[a.id] = { start: x.start, finish: x.finish, dur: x.summary ? x.dur : Math.round(a.dur || 0), budget: x.summary ? undefined : budgetOf(project, a) }; });
    return { name, created: new Date().toISOString(), finish: sched.finishDate, acts };
  }
  function variance(sched, baseline, id) {
    const x = sched.results.get(id), b = baseline && baseline.acts[id]; if (!x || !b) return null;
    const cal = sched.cal;
    return { start: cal.idx(b.start) - x.es, finish: (cal.idxFinish(b.finish) + 1) - x.ef, dur: b.dur - (x.ef - x.es) }; // positive = ahead
  }

  // ---------- activity steps (physical % complete) ----------
  // steps = [{name, weight, pct}] → weighted physical % complete (P6 "Physical" percent complete type with steps)
  function stepsPct(steps) {
    if (!steps || !steps.length) return null;
    let w = 0, wp = 0; steps.forEach(s => { const wt = Math.max(0, +s.weight || 0); w += wt; wp += wt * Math.max(0, Math.min(100, +s.pct || 0)); });
    if (!w) { w = steps.length; wp = steps.reduce((t, s) => t + Math.max(0, Math.min(100, +s.pct || 0)), 0); }
    return Math.round(wp / w * 10) / 10;
  }

  // ---------- driving path / multiple float paths ----------
  // Float of every (unfinished) predecessor chain relative to one target activity: a backward pass that starts at the
  // target's early finish and ignores everything that does not lead to it. Relative float 0 = on the driving path.
  // Paths are numbered by ascending relative float (path 1 = driving path), like P6's multiple float path analysis.
  const remDur = (x, dd) => x.status === 'active' ? x.ef - Math.max(dd, x.es) : x.ef - x.es;
  function floatPaths(project, sched, targetId, opts = {}) {
    const R = sched.results, tgt = R.get(targetId);
    if (!tgt || tgt.summary || sched.error) return null;
    const maxPaths = opts.maxPaths || 10, dd = sched.dataIdx;
    const pred = new Map(), succ = new Map(), push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
    sched.links.forEach(l => { push(pred, l.to, l); push(succ, l.from, l); });
    const anc = new Set([targetId]), stack = [targetId];
    while (stack.length) { const id = stack.pop(); (pred.get(id) || []).forEach(l => { const p = R.get(l.from); if (anc.has(l.from) || !p || p.status === 'done') return; anc.add(l.from); stack.push(l.from); }); }
    const late = new Map([[targetId, { lf: tgt.ef, ls: tgt.ef - remDur(tgt, dd) }]]);
    for (let k = sched.order.length - 1; k >= 0; k--) {
      const id = sched.order[k]; if (!anc.has(id) || id === targetId) continue;
      const x = R.get(id), d = remDur(x, dd); let lf = Infinity;
      (succ.get(id) || []).forEach(l => {
        const s = late.get(l.to); if (!s) return; const lag = Math.round(l.lag || 0);
        const lim = { SS: s.ls - lag + d, FF: s.lf - lag, SF: s.lf - lag + d }[l.type] ?? s.ls - lag;
        lf = Math.min(lf, lim);
      });
      if (lf === Infinity) continue;
      late.set(id, { lf, ls: lf - d });
    }
    const info = new Map();
    late.forEach((v, id) => info.set(id, { rf: Math.max(0, v.lf - R.get(id).ef) }));
    const values = [...new Set([...info.values()].map(v => v.rf))].sort((a, b) => a - b);
    info.forEach(v => { const k = values.indexOf(v.rf); v.path = k < maxPaths ? k + 1 : null; v.driving = v.rf === 0; });
    const ids = [...info.keys()].sort((a, b) => (info.get(a).path ?? 1e9) - (info.get(b).path ?? 1e9) || R.get(a).es - R.get(b).es || R.get(a).ef - R.get(b).ef);
    const drivingLinks = sched.links.filter(l => info.has(l.from) && info.has(l.to) && info.get(l.from).driving && info.get(l.to).driving && l._driving);
    return { target: targetId, info, ids, paths: Math.min(values.length, maxPaths), drivingLinks };
  }

  // ---------- activity codes ----------
  // project.codes = [{id, name, values:[{v, d}]}], activity.codes = {codeId: value}. Groups activities by one code with roll-ups.
  function groupByCode(project, sched, codeId) {
    const code = (project.codes || []).find(c => c.id === codeId); if (!code) return null;
    const R = sched.results, groups = new Map();
    (code.values || []).forEach(v => groups.set(v.v, { key: v.v, label: v.v + (v.d ? ' — ' + v.d : ''), ids: [] }));
    const none = { key: '', label: '(no ' + code.name + ')', ids: [] };
    const pos = new Map();
    project.activities.forEach((a, i) => {
      if (sched.summary[i] || !R.get(a.id)) return; pos.set(a.id, i);
      const v = a.codes && a.codes[codeId]; (groups.has(v) ? groups.get(v) : none).ids.push(a.id);
    });
    const byId = new Map(project.activities.map(a => [a.id, a]));
    return [...groups.values(), none].filter(g => g.ids.length).map(g => {
      g.ids.sort((a, b) => R.get(a).es - R.get(b).es || pos.get(a) - pos.get(b));
      let es = Infinity, ef = -Infinity, tf = Infinity, w = 0, wp = 0;
      g.ids.forEach(id => { const x = R.get(id); es = Math.min(es, x.es); ef = Math.max(ef, x.ef); tf = Math.min(tf, x.tf); const wt = Math.max(1, x.dur); w += wt; wp += wt * (byId.get(id).pct || 0); });
      return { ...g, es, ef, dur: ef - es, tf, pct: w ? wp / w : 0, start: sched.cal.date(es), finish: ef > es ? sched.cal.date(ef - 1) : sched.cal.date(es), summary: true };
    });
  }

  // ---------- schedule quality: DCMA 14-point assessment ----------
  const HARD = new Set(['MSO', 'SNLT', 'FNLT']);
  function dcma(project, sched, baseline) {
    if (sched.error) return null;
    const R = sched.results, dd = sched.dataIdx, out = [];
    const work = project.activities.filter((a, i) => !sched.summary[i] && R.get(a.id));
    const open = work.filter(a => R.get(a.id).status !== 'done');
    const tasks = open.filter(a => (a.dur || 0) > 0);              // incomplete tasks; milestones excluded
    const openSet = new Set(open.map(a => a.id));
    const links = sched.links.filter(l => openSet.has(l.to));
    const pct = (n, d) => d ? 100 * n / d : 0;
    const add = (n, key, name, value, unit, threshold, pass, ids, note) => out.push({ n, key, name, value, unit, threshold, pass, ids: [...new Set(ids || [])], note });
    const ratioCheck = (n, key, name, bad, total, limit, note) => add(n, key, name, pct(bad.length, total), '%', '≤ ' + limit + '%', pct(bad.length, total) <= limit, bad, note + ` (${bad.length} of ${total})`);

    // 1 logic: everything needs a predecessor and a successor, except one open start and one open finish
    const hasP = new Set(sched.links.map(l => l.to)), hasS = new Set(sched.links.map(l => l.from));
    const noP = open.filter(a => !hasP.has(a.id)), noS = open.filter(a => !hasS.has(a.id));
    const startOk = noP.slice().sort((a, b) => R.get(a.id).es - R.get(b.id).es)[0], finOk = noS.slice().sort((a, b) => R.get(b.id).ef - R.get(a.id).ef)[0];
    const dangling = [...noP.filter(a => a !== startOk && R.get(a.id).status === 'planned'), ...noS.filter(a => a !== finOk)].map(a => a.id);
    ratioCheck(1, 'logic', 'Logic (missing predecessor or successor)', dangling, open.length, 5, 'Open ends besides the project start and finish');
    const leads = links.filter(l => (l.lag || 0) < 0);
    add(2, 'leads', 'Leads (negative lag)', leads.length, '', '0', leads.length === 0, leads.map(l => l.to), 'Relationships with a negative lag');
    const lags = links.filter(l => (l.lag || 0) > 0);
    ratioCheck(3, 'lags', 'Lags', lags.map(l => l.to), links.length, 5, 'Relationships with a positive lag');
    const nonFS = links.filter(l => (l.type || 'FS') !== 'FS'), fsPct = links.length ? 100 - pct(nonFS.length, links.length) : 100;
    add(4, 'reltypes', 'Relationship types (finish-to-start)', fsPct, '%', '≥ 90%', fsPct >= 90, nonFS.map(l => l.to), `${links.length - nonFS.length} of ${links.length} relationships are FS`);
    const hard = open.filter(a => a.constraint && a.constraint.date && HARD.has(a.constraint.type));
    ratioCheck(5, 'hard', 'Hard constraints', hard.map(a => a.id), open.length, 5, 'Must-start-on and start/finish-on-or-before constraints');
    const hiF = tasks.filter(a => R.get(a.id).tf > 44);
    ratioCheck(6, 'highfloat', 'High float (> 44 working days)', hiF.map(a => a.id), tasks.length, 5, 'Incomplete tasks with too much total float');
    const negF = open.filter(a => R.get(a.id).tf < 0);
    add(7, 'negfloat', 'Negative float', negF.length, '', '0', negF.length === 0, negF.map(a => a.id), 'Activities that cannot meet a constraint or the must-finish date');
    const hiD = tasks.filter(a => (a.dur || 0) > 44);
    ratioCheck(8, 'highdur', 'High duration (> 44 working days)', hiD.map(a => a.id), tasks.length, 5, 'Long tasks should be broken down');
    const ddDate = project.dataDate || null;
    const invalid = work.filter(a => (ddDate && ((a.actualStart && a.actualStart > ddDate) || (a.actualFinish && a.actualFinish > ddDate))) || (a.actualStart && a.actualFinish && a.actualFinish < a.actualStart) || (!a.actualStart && R.get(a.id).es < dd));
    add(9, 'invalid', 'Invalid dates', invalid.length, '', '0', invalid.length === 0, invalid.map(a => a.id), 'Actual dates after the data date, or forecast dates before it');
    const noRes = tasks.filter(a => !(a.resources || []).length && !(+a.cost > 0));
    add(10, 'resources', 'Resources (cost or resource loaded)', noRes.length, '', '0', noRes.length === 0, noRes.map(a => a.id), `Incomplete tasks without resources or cost (${noRes.length} of ${tasks.length})`);
    // 11 missed tasks & 14 BEI need a baseline
    const blDue = baseline ? work.filter(a => baseline.acts[a.id] && (a.dur || 0) > 0 && sched.cal.idxFinish(baseline.acts[a.id].finish) + 1 <= dd) : [];
    if (!baseline) add(11, 'missed', 'Missed tasks', null, '%', '≤ 5%', null, [], 'Needs a baseline');
    else if (!blDue.length) add(11, 'missed', 'Missed tasks', 0, '%', '≤ 5%', null, [], 'No baselined task was due by the data date');
    else { const missed = blDue.filter(a => !(R.get(a.id).status === 'done' && a.actualFinish && a.actualFinish <= baseline.acts[a.id].finish)); ratioCheck(11, 'missed', 'Missed tasks', missed.map(a => a.id), blDue.length, 5, 'Tasks due by the data date that finished late or not at all'); }
    // 12 critical path test: delay one critical activity by 600 days and the project finish must move by exactly 600
    const cand = open.filter(a => R.get(a.id).longest).sort((a, b) => R.get(a.id).es - R.get(b.id).es);
    const probe = cand.find(a => (a.dur || 0) > 0) || cand[0];
    if (!probe) add(12, 'cpt', 'Critical path test', null, '', 'pass', null, [], 'No unfinished activity on the longest path');
    else {
      const clone = JSON.parse(JSON.stringify(project)), t = clone.activities.find(a => a.id === probe.id);
      t.dur = (t.dur || 0) + 600; if (R.get(t.id).status === 'active') { t.remaining = remDur(R.get(t.id), dd) + 600; t.pctType = 'physical'; }
      const s2 = schedule(clone), moved = s2.error ? null : s2.finish - sched.finish;
      add(12, 'cpt', 'Critical path test', moved, ' d', '+600 d', moved === 600, moved === 600 ? [] : [probe.id], `Delaying ${probe.id} by 600 days moved the finish by ${moved ?? '—'} days`);
    }
    // 13 CPLI = (critical path length + total float) / critical path length
    const cpl = sched.finish - dd, endFloat = Math.min(...open.filter(a => R.get(a.id).longest).map(a => R.get(a.id).tf), Infinity);
    const cpli = cpl > 0 && isFinite(endFloat) ? (cpl + endFloat) / cpl : null;
    add(13, 'cpli', 'Critical path length index (CPLI)', cpli, '', '≥ 0.95', cpli == null ? null : cpli >= 0.95 - 1e-9, [], cpl > 0 ? `${cpl} working days to go, project float ${isFinite(endFloat) ? endFloat : '—'} d` : 'Nothing left to do');
    if (!baseline) add(14, 'bei', 'Baseline execution index (BEI)', null, '', '≥ 0.95', null, [], 'Needs a baseline');
    else if (!blDue.length) add(14, 'bei', 'Baseline execution index (BEI)', null, '', '≥ 0.95', null, [], 'No baselined task was due by the data date');
    else { const done = work.filter(a => (a.dur || 0) > 0 && baseline.acts[a.id] && R.get(a.id).status === 'done').length, bei = done / blDue.length;
      add(14, 'bei', 'Baseline execution index (BEI)', bei, '', '≥ 0.95', bei >= 0.95 - 1e-9, blDue.filter(a => R.get(a.id).status !== 'done').map(a => a.id), `${done} tasks completed vs ${blDue.length} planned by the data date`); }
    return { checks: out, passed: out.filter(c => c.pass === true).length, failed: out.filter(c => c.pass === false).length, na: out.filter(c => c.pass == null).length };
  }

  const api = { Calendar, schedule, resourceUsage, overallocations, level, earnedValue, makeBaseline, variance, budgetOf, isSummary, parse, iso, addDays, stepsPct, floatPaths, groupByCode, dcma };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.CPM = api;
})(typeof self !== 'undefined' ? self : this);
