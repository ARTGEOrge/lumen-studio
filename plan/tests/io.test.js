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


t('XER keeps the work week and holidays (P6 clndr_data)', () => {
  const xer = IO.exportXER(p, s);
  assert.ok(/clndr_data/.test(xer) && /\(0\|\|5\(\)\(\(0\|\|0\(s\|08:00/.test(xer));
  const back = IO.importXER(xer);   // no calendar copied over this time
  assert.deepStrictEqual(back.calendar, { workweek: p.calendar.workweek, holidays: p.calendar.holidays });
  assert.deepStrictEqual(sig(back), sig(p));
  assert.strictEqual(IO.parseClndrData(IO.clndrData({ workweek: [true, false, false, false, false, false, true], holidays: ['2027-01-01'] })).holidays[0], '2027-01-01');
});

t('XER carries activity codes, steps and the % complete type both ways', () => {
  const q = sampleProject();
  const st = q.activities.find(a => a.id === 'A3000'); st.steps[0].pct = 100; st.steps[1].pct = 50;
  const xer = IO.exportXER(q, C.schedule(q));
  const T = IO.parseXerTables(xer);
  assert.strictEqual(T.ACTVTYPE.rows.length, 2); assert.strictEqual(T.ACTVCODE.rows.length, 9);
  assert.strictEqual(T.TASKACTV.rows.length, 42);                       // 21 activities × 2 codes
  assert.strictEqual(T.TASKPROC.rows.length, 7);
  assert.strictEqual(T.TASK.rows.find(r => r.task_code === 'A3000').complete_pct_type, 'CP_Phys');
  assert.strictEqual(T.TASK.rows.find(r => r.task_code === 'A2000').complete_pct_type, 'CP_Drtn');
  const back = IO.importXER(xer);
  assert.deepStrictEqual(back.codes.map(c => [c.name, c.values.map(v => v.v + '=' + v.d).join(',')]), q.codes.map(c => [c.name, c.values.map(v => v.v + '=' + v.d).join(',')]));
  const respId = back.codes[0].id;
  assert.deepStrictEqual(back.activities.filter(a => a.codes).map(a => a.id + ':' + a.codes[respId]), q.activities.filter(a => a.codes).map(a => a.id + ':' + a.codes.RESP));
  const b3 = back.activities.find(a => a.id === 'A3000');
  assert.strictEqual(b3.pctType, 'physical');
  assert.deepStrictEqual(b3.steps.map(s => [s.name, s.weight, s.pct]), st.steps.map(s => [s.name, s.weight, s.pct]));
  assert.strictEqual(C.stepsPct(b3.steps), 30);                          // (1×100 + 4×50) / 10
});

t('P6-style XER with codes and steps imports (remaining duration of a physical activity kept)', () => {
  const xer = ['ERMHDR\t20.12', '%T\tPROJECT', '%F\tproj_id\tproj_short_name\tplan_start_date\tlast_recalc_date', '%R\t1\tX\t2027-03-01 08:00\t2027-03-08 08:00',
    '%T\tTASK', '%F\ttask_id\ttask_code\ttask_name\ttask_type\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tphys_complete_pct\tcomplete_pct_type\tact_start_date\tact_end_date',
    '%R\t10\tP1\tPour\tTT_Task\t80\t56\t25\tCP_Phys\t2027-03-01 08:00\t', '%R\t11\tP2\tCure\tTT_Task\t40\t40\t0\tCP_Drtn\t\t',
    '%T\tACTVTYPE', '%F\tactv_code_type_id\tactv_code_type\tseq_num', '%R\t7\tPhase / Stage\t1',
    '%T\tACTVCODE', '%F\tactv_code_id\tactv_code_type_id\tshort_name\tactv_code_name\tseq_num', '%R\t70\t7\tCON\tConstruction\t1', '%R\t71\t7\tDES\tDesign\t0',
    '%T\tTASKACTV', '%F\ttask_id\tactv_code_type_id\tactv_code_id', '%R\t10\t7\t70', '%R\t11\t7\t99',
    '%T\tTASKPROC', '%F\tproc_id\ttask_id\tseq_num\tproc_name\tcomplete_flag\tproc_wt\tcomplete_pct', '%R\t2\t10\t20\tPour\tN\t3\t0', '%R\t1\t10\t10\tFormwork\tY\t1\t0', '%E'].join('\n');
  const q = IO.importXER(xer);
  assert.deepStrictEqual(q.codes, [{ id: 'PHASESTAGE', name: 'Phase / Stage', values: [{ v: 'DES', d: 'Design' }, { v: 'CON', d: 'Construction' }] }]);
  assert.deepStrictEqual(q.activities.map(a => a.codes || null), [{ PHASESTAGE: 'CON' }, null]);   // unknown code value 99 ignored
  const p1 = q.activities[0];
  assert.deepStrictEqual([p1.pctType, p1.remaining], ['physical', 7]);
  assert.deepStrictEqual(p1.steps, [{ name: 'Formwork', weight: 1, pct: 100 }, { name: 'Pour', weight: 3, pct: 0 }]);
  assert.strictEqual(q.activities[1].pctType, undefined);
  const r = C.schedule(q);
  assert.strictEqual(r.results.get('P1').finish, '2027-03-16');   // 7 working days from the 8 Mar data date
});

t('CSV export adds a column per activity code', () => {
  const csv = IO.exportCSV(p, s), rows = IO.parseCSV(csv);
  assert.deepStrictEqual(rows[0].slice(-2), ['Responsibility', 'Area']);
  assert.deepStrictEqual(rows.find(r => r[0] === 'A3000').slice(-2), ['STL', 'SHELL']);
});

t('SVG recorder turns canvas drawing calls into valid vector markup', () => {
  const { SvgContext } = require('../js/svgctx.js');
  const g = new SvgContext(200, 100);
  g.fillStyle = '#fff'; g.fillRect(0, 0, 200, 100);
  g.save(); g.translate(10, 5);
  const gr = g.createLinearGradient(0, 0, 0, 14); gr.addColorStop(0, '#f06a6a'); gr.addColorStop(1, 'rgba(200,30,42,.5)');
  g.fillStyle = gr; g.fillRect(20, 10, 50, 14);
  g.beginPath(); g.rect(0, 0, 40, 20); g.clip();
  g.beginPath(); g.rect(5, 5, 10, 10); g.clip();                        // nested clip intersects
  g.font = '600 12px Segoe UI, Tahoma, sans-serif'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(15,35,60,.45)'; g.fillText('A < B & "C"', 30, 17);
  g.restore();
  g.strokeStyle = '#2d78c4'; g.lineWidth = 2; g.setLineDash([4, 3]); g.beginPath(); g.moveTo(0, 50); g.lineTo(100, 50); g.stroke();
  g.setLineDash([]); g.beginPath(); g.arc(150, 50, 4, 0, 7); g.fill();
  const svg = g.toString('Test');
  assert.ok(svg.startsWith('<?xml') && svg.trim().endsWith('</svg>'));
  assert.ok(svg.includes('<rect x="30" y="15" width="50" height="14" fill="url(#g1)"/>'), 'translated gradient rect');
  assert.ok(svg.includes('x1="10" y1="5" x2="10" y2="19"') && svg.includes('stop-color="rgb(200,30,42)" stop-opacity="0.5"'));
  assert.ok(/<clipPath id="c3" clip-path="url\(#c2\)">/.test(svg), 'nested clip');
  assert.ok(svg.includes('clip-path="url(#c3)" x="40" y="22"') && svg.includes('font-weight="600"') && svg.includes('dominant-baseline="central"') && svg.includes('fill-opacity="0.45"'));
  assert.ok(svg.includes('>A &lt; B &amp; &quot;C&quot;</text>'));
  assert.ok(svg.includes('stroke-dasharray="4 3"') && svg.includes('stroke-width="2"'));
  assert.ok(/<path d="M146 50A4 4 0 1 0 154 50A4 4 0 1 0 146 50Z"/.test(svg), 'circle');
  assert.ok(!svg.slice(svg.indexOf('stroke-dasharray')).includes('clip-path'), 'clip popped by restore');
});

console.log(`\n${n} tests passed`);
