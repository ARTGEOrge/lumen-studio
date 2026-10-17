// node plan/tests/cpm.test.js — hand-checked answers for the scheduling engine.
const C = require('../js/cpm.js');
const assert = require('assert');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };
const seven = { workweek: [true, true, true, true, true, true, true], holidays: [] };
const P = (acts, links, extra = {}) => ({ start: '2026-01-05', calendar: seven, activities: acts, links, resources: [], ...extra });
const A = (id, dur, extra = {}) => ({ id, name: id, dur, level: 0, pct: 0, ...extra });
const FS = (from, to, lag = 0, type = 'FS') => ({ from, to, lag, type });

t('textbook network: dates, total float, free float, critical path', () => {
  const s = C.schedule(P([A('A', 3), A('B', 4), A('C', 2), A('D', 5), A('E', 3), A('F', 2)],
    [FS('A', 'B'), FS('A', 'C'), FS('B', 'D'), FS('C', 'E'), FS('D', 'F'), FS('E', 'F')]));
  const g = id => s.results.get(id);
  assert.deepStrictEqual(['A', 'B', 'C', 'D', 'E', 'F'].map(i => [g(i).es, g(i).ef]), [[0, 3], [3, 7], [3, 5], [7, 12], [5, 8], [12, 14]]);
  assert.deepStrictEqual(['A', 'B', 'C', 'D', 'E', 'F'].map(i => g(i).tf), [0, 0, 4, 0, 4, 0]);
  assert.deepStrictEqual(['A', 'B', 'C', 'D', 'E', 'F'].map(i => g(i).ff), [0, 0, 0, 0, 4, 0]);
  assert.deepStrictEqual(['A', 'B', 'C', 'D', 'E', 'F'].filter(i => g(i).critical), ['A', 'B', 'D', 'F']);
  assert.deepStrictEqual(['A', 'B', 'C', 'D', 'E', 'F'].filter(i => g(i).longest), ['A', 'B', 'D', 'F']);
  assert.strictEqual(s.finish, 14); assert.strictEqual(s.finishDate, '2026-01-18');
  assert.strictEqual(g('A').start, '2026-01-05'); assert.strictEqual(g('A').finish, '2026-01-07');
});

t('SS / FF / SF relationships with lags and leads', () => {
  const s = C.schedule(P([A('A', 10), A('B', 4), A('C', 6), A('D', 3)],
    [FS('A', 'B', 2, 'SS'), FS('A', 'C', 1, 'FF'), FS('A', 'D', -2, 'FS')]));
  const g = id => s.results.get(id);
  assert.deepStrictEqual([g('B').es, g('B').ef], [2, 6]);   // starts 2 days after A starts
  assert.deepStrictEqual([g('C').es, g('C').ef], [5, 11]);  // finishes 1 day after A finishes
  assert.deepStrictEqual([g('D').es, g('D').ef], [8, 11]);  // 2-day lead
  const s2 = C.schedule(P([A('A', 5), A('B', 3)], [FS('A', 'B', 4, 'SF')]));
  assert.deepStrictEqual([s2.results.get('B').es, s2.results.get('B').ef], [1, 4]); // finishes 4 days after A starts
});

t('Mon-Fri calendar skips weekends and holidays', () => {
  const s = C.schedule({ start: '2026-01-02', calendar: { holidays: ['2026-01-07'] }, activities: [A('A', 5), A('B', 1)], links: [FS('A', 'B')] });
  // Fri 2 Jan, Mon 5, Tue 6, (Wed 7 holiday), Thu 8, Fri 9 → B on Mon 12
  assert.strictEqual(s.results.get('A').start, '2026-01-02');
  assert.strictEqual(s.results.get('A').finish, '2026-01-09');
  assert.strictEqual(s.results.get('B').start, '2026-01-12');
});

t('milestones have zero duration', () => {
  const s = C.schedule(P([A('A', 3), A('M', 0), A('B', 2)], [FS('A', 'M'), FS('M', 'B')]));
  const m = s.results.get('M');
  assert.deepStrictEqual([m.es, m.ef, m.start, m.finish], [3, 3, '2026-01-08', '2026-01-08']);
  assert.strictEqual(s.results.get('B').es, 3);
});

t('relationship loops are reported, not hung on', () => {
  const s = C.schedule(P([A('A', 1), A('B', 1), A('C', 1)], [FS('A', 'B'), FS('B', 'C'), FS('C', 'B')]));
  assert.ok(s.error && /B/.test(s.error) && /C/.test(s.error) && !s.loop.includes('A'));
});

t('constraints: SNET pushes start, FNLT creates negative float', () => {
  const s = C.schedule(P([A('A', 3, { constraint: { type: 'SNET', date: '2026-01-10' } }), A('B', 4, { constraint: { type: 'FNLT', date: '2026-01-14' } })], [FS('A', 'B')]));
  assert.strictEqual(s.results.get('A').es, 5);
  assert.strictEqual(s.results.get('B').ef, 12);
  assert.strictEqual(s.results.get('B').tf, -2); // needs to finish by day 10 (14 Jan) but finishes day 12
  assert.strictEqual(s.results.get('A').tf, -2);
  assert.ok(s.results.get('A').critical);
});

t('progress: finished, in-progress and future work against a data date', () => {
  const s = C.schedule(P([
    A('A', 4, { pct: 100, actualStart: '2026-01-05', actualFinish: '2026-01-09' }), // took 5 days
    A('B', 6, { pct: 50, actualStart: '2026-01-10' }), A('C', 2)],
    [FS('A', 'B'), FS('B', 'C')], { dataDate: '2026-01-13' }));
  const g = id => s.results.get(id);
  assert.deepStrictEqual([g('A').es, g('A').ef], [0, 5]);
  assert.deepStrictEqual([g('B').es, g('B').ef], [5, 11]);   // 3 days remaining from data date (day 8)
  assert.deepStrictEqual([g('C').es, g('C').ef], [11, 13]);
  assert.strictEqual(g('A').tf, 0); assert.ok(!g('A').critical);
});

t('WBS summary rows roll up their children and are not scheduled', () => {
  const s = C.schedule(P([A('W1', 0, { level: 0 }), A('A', 3, { level: 1, pct: 100, actualStart: '2026-01-05' }), A('B', 2, { level: 1 }), A('C', 4, { level: 0 })], [FS('A', 'B'), FS('B', 'C')]));
  const w = s.results.get('W1');
  assert.ok(w.summary); assert.deepStrictEqual([w.es, w.ef], [0, 5]); assert.strictEqual(Math.round(w.pct), 60);
  assert.strictEqual(s.results.get('C').es, 5);
});

t('resource loading and leveling removes overallocation', () => {
  const proj = P([A('A', 3, { resources: [{ res: 'R', units: 1 }] }), A('B', 2, { resources: [{ res: 'R', units: 1 }] }), A('C', 1)],
    [FS('B', 'C')], { resources: [{ id: 'R', name: 'Crew', max: 1, rate: 100 }] });
  const s = C.schedule(proj);
  assert.deepStrictEqual(Array.from(C.resourceUsage(proj, s).get('R')), [2, 2, 1]);
  assert.strictEqual(C.overallocations(proj, s).length, 1);
  const { leveled } = C.level(proj);
  // B and C are the critical chain (TF 0) so B goes first; A (TF 0 too, longer) — whichever, overload must be gone
  leveled.forEach((d, id) => proj.activities.find(a => a.id === id).leveledStart = d);
  const s2 = C.schedule(proj);
  assert.strictEqual(C.overallocations(proj, s2).length, 0);
  assert.strictEqual(s2.finish, 5);
});

t('earned value against a baseline', () => {
  const proj = P([A('A', 10, { cost: 1000, pct: 30, actualStart: '2026-01-05', actualCost: 500 })], [], { dataDate: '2026-01-10' });
  const s0 = C.schedule({ ...proj, activities: [A('A', 10, { cost: 1000 })], dataDate: null });
  const base = C.makeBaseline(proj, s0, 'BL1');
  const s = C.schedule(proj);
  const ev = C.earnedValue(proj, s, base);
  assert.strictEqual(ev.BAC, 1000); assert.strictEqual(Math.round(ev.PV), 500); assert.strictEqual(ev.EV, 300); assert.strictEqual(ev.AC, 500);
  assert.strictEqual(+ev.SPI.toFixed(2), 0.6); assert.strictEqual(+ev.CPI.toFixed(2), 0.6); assert.strictEqual(Math.round(ev.EAC), 1667);
  const v = C.variance(s, base, 'A'); assert.strictEqual(v.finish, -2); // 30% done after 5 of 10 days → 7 remaining → 2 days late
});

t('driving path and multiple float paths to a chosen activity', () => {
  const proj = P([A('A', 3), A('B', 4), A('C', 2), A('D', 5), A('E', 3), A('F', 2), A('X', 1)],
    [FS('A', 'B'), FS('A', 'C'), FS('B', 'D'), FS('C', 'E'), FS('D', 'F'), FS('E', 'F')]);
  const s = C.schedule(proj);
  const fpE = C.floatPaths(proj, s, 'E');           // E is not critical for the project, but A→C→E drives it
  assert.deepStrictEqual([...fpE.info.keys()].sort(), ['A', 'C', 'E']);
  assert.ok(['A', 'C', 'E'].every(id => fpE.info.get(id).driving && fpE.info.get(id).path === 1));
  const fpF = C.floatPaths(proj, s, 'F');
  const rf = id => fpF.info.get(id).rf, path = id => fpF.info.get(id).path;
  assert.deepStrictEqual(['A', 'B', 'C', 'D', 'E', 'F'].map(rf), [0, 0, 4, 0, 4, 0]);
  assert.deepStrictEqual(['A', 'B', 'C', 'D', 'E', 'F'].map(path), [1, 1, 2, 1, 2, 1]);
  assert.ok(!fpF.info.has('X')); assert.strictEqual(fpF.paths, 2);
  assert.deepStrictEqual(fpF.ids.slice(0, 4), ['A', 'B', 'D', 'F']);    // driving path first, in date order
  assert.deepStrictEqual(fpF.drivingLinks.map(l => l.from + l.to), ['AB', 'BD', 'DF']);
  // SS lag: B starts 2 after A starts; C (3 d) only has to finish before T starts at day 6
  const p2 = P([A('A', 10), A('B', 4), A('C', 3), A('T', 1)], [FS('A', 'B', 2, 'SS'), FS('B', 'T'), FS('C', 'T')]);
  const s2 = C.schedule(p2), f2 = C.floatPaths(p2, s2, 'T');
  assert.deepStrictEqual(['A', 'B', 'C', 'T'].map(id => f2.info.get(id).rf), [0, 0, 3, 0]);
  // completed predecessors are not part of any path
  const p3 = P([A('A', 2, { pct: 100, actualStart: '2026-01-05', actualFinish: '2026-01-06' }), A('B', 2)], [FS('A', 'B')], { dataDate: '2026-01-07' });
  assert.ok(!C.floatPaths(p3, C.schedule(p3), 'B').info.has('A'));
});

t('activity codes group activities with roll-up bars', () => {
  const proj = P([A('W', 0), A('A', 3, { level: 1, codes: { RESP: 'GC' } }), A('B', 4, { level: 1, codes: { RESP: 'SUB' } }), A('C', 2, { level: 1, codes: { RESP: 'GC' } }), A('D', 1, { level: 1 })],
    [FS('A', 'B'), FS('B', 'C'), FS('C', 'D')], { codes: [{ id: 'RESP', name: 'Responsibility', values: [{ v: 'GC', d: 'General contractor' }, { v: 'SUB', d: 'Subcontractor' }, { v: 'OWN', d: 'Owner' }] }] });
  const s = C.schedule(proj), g = C.groupByCode(proj, s, 'RESP');
  assert.deepStrictEqual(g.map(x => [x.key, x.ids]), [['GC', ['A', 'C']], ['SUB', ['B']], ['', ['D']]]);   // empty values dropped, unassigned last
  assert.deepStrictEqual([g[0].es, g[0].ef, g[0].dur, g[0].tf], [0, 9, 9, 0]);
  assert.strictEqual(g[0].label, 'GC — General contractor'); assert.strictEqual(g[2].label, '(no Responsibility)');
  assert.strictEqual(C.groupByCode(proj, s, 'NOPE'), null);
});

t('activity steps give a weighted physical % complete; physical type keeps remaining duration', () => {
  assert.strictEqual(C.stepsPct([{ name: 'Form', weight: 2, pct: 100 }, { name: 'Rebar', weight: 1, pct: 50 }, { name: 'Pour', weight: 1, pct: 0 }]), 62.5);
  assert.strictEqual(C.stepsPct([{ name: 'a', weight: 0, pct: 100 }, { name: 'b', weight: 0, pct: 0 }]), 50);
  assert.strictEqual(C.stepsPct([]), null);
  const base = { pct: 62.5, actualStart: '2026-01-05' };
  const dur = C.schedule(P([A('A', 8, { ...base, pctType: 'duration', remaining: 7 })], [], { dataDate: '2026-01-07' }));
  const phy = C.schedule(P([A('A', 8, { ...base, pctType: 'physical', remaining: 7 })], [], { dataDate: '2026-01-07' }));
  assert.strictEqual(dur.results.get('A').ef, 2 + 3);   // duration type: 8 × (1 − 62.5%) = 3 days left from the data date
  assert.strictEqual(phy.results.get('A').ef, 2 + 7);   // physical type: the entered remaining duration
});

t('DCMA 14-point check flags real problems and passes a clean network', () => {
  const clean = P([A('S', 0), A('A', 5, { cost: 100 }), A('B', 5, { cost: 100 }), A('F', 0)], [FS('S', 'A'), FS('A', 'B'), FS('B', 'F')]);
  const r = C.dcma(clean, C.schedule(clean), null), by = k => r.checks.find(c => c.key === k);
  assert.strictEqual(r.checks.length, 14);
  ['logic', 'leads', 'lags', 'reltypes', 'hard', 'highfloat', 'negfloat', 'highdur', 'invalid', 'resources', 'cpt', 'cpli'].forEach(k => assert.strictEqual(by(k).pass, true, k));
  assert.strictEqual(by('missed').pass, null); assert.strictEqual(by('bei').pass, null);
  assert.strictEqual(by('cpt').value, 600); assert.strictEqual(by('cpli').value, 1);
  const bad = P([A('S', 0), A('A', 50), A('B', 5, { constraint: { type: 'FNLT', date: '2026-01-20' } }), A('X', 3), A('F', 0)],
    [FS('S', 'A'), FS('A', 'B', -2), FS('B', 'F', 0, 'SS'), FS('S', 'X', 3)]);
  const s = C.schedule(bad), q = C.dcma(bad, s, null), b2 = k => q.checks.find(c => c.key === k);
  assert.deepStrictEqual(b2('logic').ids, ['X']);                      // X has no successor
  assert.strictEqual(b2('leads').value, 1); assert.deepStrictEqual(b2('leads').ids, ['B']);
  assert.strictEqual(b2('lags').pass, false);
  assert.strictEqual(b2('reltypes').value, 75); assert.strictEqual(b2('reltypes').pass, false);
  assert.deepStrictEqual(b2('hard').ids, ['B']); assert.deepStrictEqual(b2('highdur').ids, ['A']);
  assert.ok(b2('negfloat').ids.includes('B') && !b2('negfloat').pass);
  assert.strictEqual(b2('resources').value, 3);
  assert.ok(b2('cpli').value < 0.95 && b2('cpli').pass === false);     // FNLT can't be met → negative project float
  assert.ok(q.failed >= 8);
});

t('DCMA baseline checks: missed tasks and BEI', () => {
  const proj = P([A('A', 2), A('B', 2), A('C', 2)], [FS('A', 'B'), FS('B', 'C')]);
  const bl = C.makeBaseline(proj, C.schedule(proj), 'BL');
  proj.dataDate = '2026-01-09';     // A (due 6 Jan) and B (due 8 Jan) should be done
  proj.activities[0].pct = 100; proj.activities[0].actualStart = '2026-01-05'; proj.activities[0].actualFinish = '2026-01-06';
  proj.activities[1].pct = 50; proj.activities[1].actualStart = '2026-01-07';
  const r = C.dcma(proj, C.schedule(proj), bl), by = k => r.checks.find(c => c.key === k);
  assert.strictEqual(by('missed').value, 50); assert.deepStrictEqual(by('missed').ids, ['B']);
  assert.strictEqual(by('bei').value, 0.5); assert.strictEqual(by('bei').pass, false);
  assert.strictEqual(by('cpt').pass, true);    // works with an in-progress activity on the critical path
});

console.log(`\n${n} tests passed`);
