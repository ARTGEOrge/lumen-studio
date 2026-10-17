// node plan/tests/io.test.js — file format round-trips and a hand-written P6 XER sample.
const C = require('../js/cpm.js'), IO = require('../js/io.js'), { sampleProject } = require('../js/sample.js');
const assert = require('assert');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok', name); };

const p = sampleProject();
const s = C.schedule(p);
const sig = (proj) => { const r = C.schedule(proj); return proj.activities.filter((a, i) => !r.summary[i]).map(a => { const x = r.results.get(a.id); return [a.name, x.start, x.finish, x.tf, !!x.critical]; }); };

t('sample project schedules cleanly with a critical path', () => {
  assert.ok(!s.error, s.error);
  const crit = p.activities.filter(a => s.results.get(a.id).critical).map(a => a.id);
  assert.ok(crit.includes('A1000') && crit.includes('A5020'), crit.join());
  console.log('   finish', s.finishDate, 'critical:', crit.join(' '));
});

t('XER export → import keeps logic, WBS, durations and dates', () => {
  const back = IO.importXER(IO.exportXER(p, s));
  back.calendar = p.calendar;
  assert.deepStrictEqual(sig(back), sig(p));
  assert.strictEqual(back.activities.filter(a => /^WBS-/.test(a.id)).length, 5);
  assert.strictEqual(back.resources.length, 5);
  assert.strictEqual(back.activities.find(a => a.id === 'A2000').resources[0].units, 2);
});

t('MS Project XML export → import round-trips', () => {
  const xml = IO.exportMSPXML(p, s);
  assert.ok(xml.startsWith('<?xml') && xml.includes('<PredecessorLink>'));
  const back = IO.importMSPXML(xml); back.calendar = p.calendar;
  assert.deepStrictEqual(sig(back), sig(p));
  assert.strictEqual(back.resources.length, 5);
});

t('CSV export → import round-trips logic', () => {
  const csv = IO.exportCSV(p, s);
  const back = IO.importCSV(csv); back.start = p.start; back.calendar = p.calendar;
  assert.deepStrictEqual(sig(back), sig(p));
});

t('hand-written P6 XER (as exported by P6) imports', () => {
  const xer = [
    'ERMHDR\t20.12\t2026-10-01\tProject\tadmin\tadmin\tdbxDatabaseNoName\tProject Management\tUSD',
    '%T\tCALENDAR', '%F\tclndr_id\tday_hr_cnt', '%R\t597\t8',
    '%T\tPROJECT', '%F\tproj_id\tproj_short_name\tplan_start_date\tlast_recalc_date', '%R\t4421\tBRIDGE-01\t2027-03-01 08:00\t2027-03-15 08:00',
    '%T\tPROJWBS', '%F\twbs_id\tproj_id\tseq_num\tproj_node_flag\twbs_short_name\twbs_name\tparent_wbs_id', '%R\t100\t4421\t0\tY\tBRIDGE-01\tBridge\t', '%R\t101\t4421\t10\tN\tDES\tDesign\t100', '%R\t102\t4421\t20\tN\tCON\tConstruction\t100',
    '%T\tTASK', '%F\ttask_id\tproj_id\twbs_id\ttask_code\ttask_name\ttask_type\ttarget_drtn_hr_cnt\tphys_complete_pct\tact_start_date\tact_end_date\tcstr_type\tcstr_date',
    '%R\t1\t4421\t101\tD100\tConcept design\tTT_Task\t80\t100\t2027-03-01 08:00\t2027-03-12 17:00\t\t',
    '%R\t2\t4421\t101\tD110\tDetailed design\tTT_Task\t160\t25\t2027-03-15 08:00\t\t\t',
    '%R\t3\t4421\t102\tC100\tPiling\tTT_Task\t120\t0\t\t\tCS_MSOA\t2027-04-12 08:00',
    '%R\t4\t4421\t102\tC200\tDeck pour\tTT_Task\t40\t0\t\t\t\t',
    '%R\t5\t4421\t102\tM900\tOpen to traffic\tTT_FinMile\t0\t0\t\t\t\t',
    '%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
    '%R\t1\t2\t1\tPR_FS\t0', '%R\t2\t3\t2\tPR_SS\t40', '%R\t3\t4\t3\tPR_FS\t0', '%R\t4\t5\t4\tPR_FS\t16',
    '%E'].join('\r\n');
  const q = IO.importXER(xer);
  assert.strictEqual(q.name, 'BRIDGE-01'); assert.strictEqual(q.start, '2027-03-01'); assert.strictEqual(q.dataDate, '2027-03-15');
  assert.deepStrictEqual(q.activities.map(a => [a.id, a.level, a.dur]), [['WBS-DES', 0, 0], ['D100', 1, 10], ['D110', 1, 20], ['WBS-CON', 0, 0], ['C100', 1, 15], ['C200', 1, 5], ['M900', 1, 0]]);
  assert.deepStrictEqual(q.links.find(l => l.to === 'C100'), { from: 'D110', to: 'C100', type: 'SS', lag: 5 });
  const r = C.schedule(q);
  assert.ok(!r.error);
  assert.strictEqual(r.results.get('C100').start, '2027-04-12');           // SNET constraint holds
  assert.strictEqual(r.results.get('D110').finish, '2027-04-02');          // 15 working days remaining from Mon 15 Mar
  assert.strictEqual(r.results.get('M900').start, '2027-05-12');           // after deck pour + 2 days
});

t('CSV import understands "A; B SS+2" predecessors', () => {
  const q = IO.importCSV('ID,Name,Duration,Predecessors\nA,Dig,3,\nB,Pour,2,A\nC,Cure,4,"A SS+1; B"\n');
  assert.deepStrictEqual(q.links, [{ from: 'A', to: 'B', type: 'FS', lag: 0 }, { from: 'A', to: 'C', type: 'SS', lag: 1 }, { from: 'B', to: 'C', type: 'FS', lag: 0 }]);
});

console.log(`\n${n} tests passed`);
