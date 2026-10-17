// Lumen Plan file formats: Primavera P6 XER, Microsoft Project XML (also read by ProjectLibre/GanttProject), CSV.
// Pure string in/out so it runs in Node tests too.
(function (root) {
  'use strict';
  const d10 = s => s ? String(s).slice(0, 10) : null;
  const HRS = 8;

  // ---------------- XER ----------------
  function parseXerTables(text) {
    const tables = {}; let cur = null;
    text.split(/\r?\n/).forEach(line => {
      const p = line.split('\t');
      if (p[0] === '%T') { cur = { fields: [], rows: [] }; tables[p[1]] = cur; }
      else if (p[0] === '%F' && cur) cur.fields = p.slice(1);
      else if (p[0] === '%R' && cur) { const o = {}; cur.fields.forEach((f, i) => o[f] = p[i + 1] ?? ''); cur.rows.push(o); }
    });
    return tables;
  }
  const XER_CSTR = { CS_MSOA: 'SNET', CS_MSOB: 'SNLT', CS_MSO: 'MSO', CS_MEOA: 'FNET', CS_MEOB: 'FNLT', CS_MEO: 'FNLT' };
  const XER_CSTR_OUT = { SNET: 'CS_MSOA', SNLT: 'CS_MSOB', MSO: 'CS_MSO', FNET: 'CS_MEOA', FNLT: 'CS_MEOB' };


  // P6 keeps work weeks and holidays in CALENDAR.clndr_data: "(0||CalendarData()( (0||DaysOfWeek()(…)) (0||Exceptions()(…)) ))",
  // days 1 = Sunday … 7 = Saturday, exception dates as serial day numbers counted from 1899-12-30
  const XER_EPOCH = Date.UTC(1899, 11, 30);
  const serialOf = d => Math.round((Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) - XER_EPOCH) / 86400000);
  const dateOfSerial = n => new Date(XER_EPOCH + n * 86400000).toISOString().slice(0, 10);
  function clndrData(cal) {
    const wk = (cal && cal.workweek) || [false, true, true, true, true, true, false];
    const days = wk.map((w, i) => w ? `(0||${i + 1}()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))` : `(0||${i + 1}()())`).join('');
    const ex = ((cal && cal.holidays) || []).map((h, i) => `(0||${i}(d|${serialOf(h)})())`).join('');
    return `(0||CalendarData()((0||DaysOfWeek()(${days}))(0||VIEW(ShowTotal|Y)())(0||Exceptions()(${ex}))))`;
  }
  function parseClndrData(txt) {
    if (!txt || !/DaysOfWeek/.test(txt)) return null;
    const wk = [false, false, false, false, false, false, false];
    const dw = txt.slice(txt.indexOf('DaysOfWeek'), txt.indexOf('Exceptions') > 0 ? txt.indexOf('Exceptions') : undefined);
    for (let d = 1; d <= 7; d++) { const m = new RegExp('\\(0\\|\\|' + d + '\\(\\)\\(([\\s\\S]*?)\\)\\)(?=\\s*\\(0\\|\\|' + (d + 1) + '\\(\\)|\\s*\\)|\\s*$)').exec(dw); wk[d - 1] = !!(m && /s\|/.test(m[1])); }
    if (!wk.some(Boolean)) return null;
    const holidays = [], exi = txt.indexOf('Exceptions');
    if (exi >= 0) { const re = /\(0\|\|\d+\(d\|(\d+)\)\(\s*\)\)/g; let m; while ((m = re.exec(txt.slice(exi)))) holidays.push(dateOfSerial(+m[1])); }
    return { workweek: wk, holidays: [...new Set(holidays)].sort() };
  }

  function importXER(text) {
    const T = parseXerTables(text);
    if (!T.TASK) throw new Error('No TASK table found — is this a Primavera P6 .xer export?');
    const proj = (T.PROJECT && T.PROJECT.rows[0]) || {};
    const hrsDay = +((T.CALENDAR && T.CALENDAR.rows[0] && T.CALENDAR.rows[0].day_hr_cnt) || HRS) || HRS;
    // WBS tree → outline rows
    const wbs = T.PROJWBS ? T.PROJWBS.rows : [];
    const kids = new Map(); wbs.forEach(w => { const k = w.parent_wbs_id || ''; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(w); });
    kids.forEach(l => l.sort((a, b) => (+a.seq_num || 0) - (+b.seq_num || 0)));
    const root = wbs.find(w => w.proj_node_flag === 'Y');
    const tasksByWbs = new Map(); T.TASK.rows.forEach(t => { if (!tasksByWbs.has(t.wbs_id)) tasksByWbs.set(t.wbs_id, []); tasksByWbs.get(t.wbs_id).push(t); });
    const acts = [], idOf = new Map(); const used = new Set();
    const uniq = id => { let s = id || 'A', k = 2; while (used.has(s)) s = id + '-' + k++; used.add(s); return s; };
    const addTask = (t, level) => {
      const id = uniq(t.task_code || t.task_id); idOf.set(t.task_id, id);
      const mile = /Mile/.test(t.task_type || '');
      const a = { id, name: t.task_name || id, level, dur: mile ? 0 : Math.round((+t.target_drtn_hr_cnt || 0) / hrsDay), pct: Math.round(+t.phys_complete_pct || 0),
        actualStart: d10(t.act_start_date), actualFinish: d10(t.act_end_date), resources: [], notes: '' };
      if (a.actualFinish && !a.actualStart) a.actualStart = a.actualFinish;
      if (a.actualFinish) a.pct = 100;
      if (t.cstr_type && XER_CSTR[t.cstr_type] && t.cstr_date) a.constraint = { type: XER_CSTR[t.cstr_type], date: d10(t.cstr_date) };
      if (t.complete_pct_type === 'CP_Phys') { a.pctType = 'physical'; if (a.actualStart && !a.actualFinish && t.remain_drtn_hr_cnt !== '' && t.remain_drtn_hr_cnt != null && isFinite(+t.remain_drtn_hr_cnt)) a.remaining = Math.max(0, Math.round(+t.remain_drtn_hr_cnt / hrsDay)); }
      acts.push(a);
    };
    const walk = (w, level) => {
      acts.push({ id: uniq('WBS-' + (w.wbs_short_name || w.wbs_id)), name: w.wbs_name || w.wbs_short_name, level, dur: 0, pct: 0, resources: [] });
      (tasksByWbs.get(w.wbs_id) || []).forEach(t => addTask(t, level + 1));
      (kids.get(w.wbs_id) || []).forEach(k => walk(k, level + 1));
    };
    if (root) { (tasksByWbs.get(root.wbs_id) || []).forEach(t => addTask(t, 0)); (kids.get(root.wbs_id) || []).forEach(k => walk(k, 0)); }
    else wbs.filter(w => !wbs.some(p => p.wbs_id === w.parent_wbs_id)).forEach(w => walk(w, 0));
    T.TASK.rows.forEach(t => { if (!idOf.has(t.task_id)) addTask(t, 0); }); // tasks without a known WBS
    // drop empty trailing WBS rows' fake children issue: a WBS with no children is shown as a plain zero-length row; fine
    const links = (T.TASKPRED ? T.TASKPRED.rows : []).filter(r => idOf.has(r.task_id) && idOf.has(r.pred_task_id))
      .map(r => ({ from: idOf.get(r.pred_task_id), to: idOf.get(r.task_id), type: (r.pred_type || 'PR_FS').replace('PR_', ''), lag: Math.round((+r.lag_hr_cnt || 0) / hrsDay) }));
    const resources = (T.RSRC ? T.RSRC.rows : []).map(r => ({ id: r.rsrc_short_name || r.rsrc_id, name: r.rsrc_name || r.rsrc_short_name, max: 1, rate: 0, _xid: r.rsrc_id }));
    const resOf = new Map(resources.map(r => [r._xid, r.id])); resources.forEach(r => delete r._xid);
    (T.TASKRSRC ? T.TASKRSRC.rows : []).forEach(tr => {
      const a = acts.find(x => x.id === idOf.get(tr.task_id)); if (!a || !resOf.has(tr.rsrc_id)) return;
      const u = tr.target_qty_per_hr ? +tr.target_qty_per_hr : (+tr.target_qty || 0) / Math.max(1, a.dur * hrsDay);
      a.resources.push({ res: resOf.get(tr.rsrc_id), units: Math.round(u * 100) / 100 || 1 });
    });
    // activity steps (TASKPROC)
    const actOf = xid => acts.find(x => x.id === idOf.get(xid));
    (T.TASKPROC ? T.TASKPROC.rows : []).slice().sort((a, b) => (+a.seq_num || 0) - (+b.seq_num || 0)).forEach(r => {
      const a = actOf(r.task_id); if (!a) return;
      (a.steps = a.steps || []).push({ name: String(r.proc_name || 'Step').slice(0, 200), weight: Math.max(0, +r.proc_wt || 0), pct: r.complete_flag === 'Y' ? 100 : Math.max(0, Math.min(100, +r.complete_pct || 0)) });
    });
    // activity codes (ACTVTYPE / ACTVCODE / TASKACTV)
    const codes = [], typeOf = new Map(), valOf = new Map(), cids = new Set();
    (T.ACTVTYPE ? T.ACTVTYPE.rows : []).slice().sort((a, b) => (+a.seq_num || 0) - (+b.seq_num || 0)).forEach(r => {
      const name = String(r.actv_code_type || 'Code ' + r.actv_code_type_id).slice(0, 60);
      let id = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 12) || 'CODE', k = 2; const b = id; while (cids.has(id)) id = b + k++; cids.add(id);
      const c = { id, name, values: [] }; codes.push(c); typeOf.set(r.actv_code_type_id, c);
    });
    (T.ACTVCODE ? T.ACTVCODE.rows : []).slice().sort((a, b) => (+a.seq_num || 0) - (+b.seq_num || 0)).forEach(r => {
      const c = typeOf.get(r.actv_code_type_id); if (!c) return;
      const v = String(r.short_name || r.actv_code_name || r.actv_code_id).slice(0, 40); if (c.values.some(x => x.v === v)) { valOf.set(r.actv_code_id, [c, v]); return; }
      c.values.push({ v, d: String(r.actv_code_name || '').slice(0, 120) }); valOf.set(r.actv_code_id, [c, v]);
    });
    (T.TASKACTV ? T.TASKACTV.rows : []).forEach(r => { const a = actOf(r.task_id), cv = valOf.get(r.actv_code_id); if (!a || !cv) return; (a.codes = a.codes || {})[cv[0].id] = cv[1]; });
    const firstStart = T.TASK.rows.map(t => d10(t.act_start_date || t.target_start_date || t.early_start_date)).filter(Boolean).sort()[0];
    const calRow = T.CALENDAR && (T.CALENDAR.rows.find(r => r.clndr_id === proj.clndr_id) || T.CALENDAR.rows.find(r => r.default_flag === 'Y') || T.CALENDAR.rows[0]);
    const calendar = calRow ? parseClndrData(calRow.clndr_data) : null;
    return { name: proj.proj_short_name || 'Imported P6 project', start: d10(proj.plan_start_date) || firstStart || new Date().toISOString().slice(0, 10),
      dataDate: d10(proj.last_recalc_date) || null, activities: acts, links, resources, ...(calendar ? { calendar } : {}), ...(codes.length ? { codes } : {}) };
  }

  function exportXER(p, sched) {
    const L = []; const row = a => L.push('%R\t' + a.map(v => String(v ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t'));
    const tbl = (name, fields) => { L.push('%T\t' + name); L.push('%F\t' + fields.join('\t')); };
    const dt = s => s ? s + ' 08:00' : '';
    L.push(['ERMHDR', '19.12', new Date().toISOString().slice(0, 10), 'Project', 'admin', 'Lumen Plan', 'dbxDatabaseNoName', 'Project Management', 'USD'].join('\t'));
    tbl('CALENDAR', ['clndr_id', 'default_flag', 'clndr_name', 'proj_id', 'base_clndr_id', 'last_chng_date', 'clndr_type', 'day_hr_cnt', 'week_hr_cnt', 'month_hr_cnt', 'year_hr_cnt', 'clndr_data']);
    const wd = (p.calendar && p.calendar.workweek || [0, 1, 1, 1, 1, 1, 0]).filter(Boolean).length;
    row([1, 'Y', 'Standard', '', '', '', 'CA_Base', HRS, HRS * wd, HRS * wd * 4, HRS * wd * 52, clndrData(p.calendar)]);
    tbl('PROJECT', ['proj_id', 'proj_short_name', 'plan_start_date', 'last_recalc_date', 'clndr_id']);
    row([1, p.name || 'Project', dt(p.start), dt(p.dataDate || p.start), 1]);
    tbl('PROJWBS', ['wbs_id', 'proj_id', 'obs_id', 'seq_num', 'proj_node_flag', 'status_code', 'wbs_short_name', 'wbs_name', 'parent_wbs_id']);
    row([1, 1, '', 0, 'Y', 'WS_Open', p.name || 'Project', p.name || 'Project', '']);
    const acts = p.activities, wbsId = new Map(), taskWbs = new Map(); const stack = [{ level: -1, id: 1 }]; let next = 2;
    acts.forEach((a, i) => {
      while (stack.length > 1 && stack[stack.length - 1].level >= (a.level || 0)) stack.pop();
      if (sched.summary[i]) { const id = next++; wbsId.set(a.id, id); row([id, 1, '', i, 'N', 'WS_Open', a.id.replace(/^WBS-/, ''), a.name, stack[stack.length - 1].id]); stack.push({ level: a.level || 0, id }); }
      else taskWbs.set(a.id, stack[stack.length - 1].id);
    });
    tbl('RSRC', ['rsrc_id', 'rsrc_name', 'rsrc_short_name', 'rsrc_type', 'clndr_id']);
    const rid = new Map(); (p.resources || []).forEach((r, i) => { rid.set(r.id, i + 1); row([i + 1, r.name, r.id, 'RT_Labor', 1]); });
    tbl('TASK', ['task_id', 'proj_id', 'wbs_id', 'clndr_id', 'phys_complete_pct', 'task_type', 'status_code', 'task_code', 'task_name', 'remain_drtn_hr_cnt', 'target_drtn_hr_cnt', 'cstr_date', 'act_start_date', 'act_end_date', 'early_start_date', 'early_end_date', 'late_start_date', 'late_end_date', 'target_start_date', 'target_end_date', 'cstr_type', 'total_float_hr_cnt', 'free_float_hr_cnt', 'driving_path_flag', 'complete_pct_type']);
    const tid = new Map(); let k = 1;
    acts.forEach((a, i) => {
      if (sched.summary[i]) return; const x = sched.results.get(a.id); const id = k++; tid.set(a.id, id);
      const st = a.pct >= 100 ? 'TK_Complete' : a.actualStart ? 'TK_Active' : 'TK_NotStart';
      row([id, 1, taskWbs.get(a.id), 1, a.pct || 0, a.dur ? 'TT_Task' : 'TT_Mile', st, a.id, a.name, (x.ef - Math.max(x.es, sched.dataIdx)) * HRS, a.dur * HRS,
        a.constraint ? dt(a.constraint.date) : '', dt(a.actualStart), dt(a.actualFinish), dt(x.start), dt(x.finish), dt(x.lateStart), dt(x.lateFinish), dt(x.start), dt(x.finish),
        a.constraint ? XER_CSTR_OUT[a.constraint.type] || '' : '', x.tf * HRS, x.ff * HRS, x.longest ? 'Y' : 'N', a.pctType === 'physical' ? 'CP_Phys' : 'CP_Drtn']);
    });
    tbl('TASKPRED', ['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt']);
    (p.links || []).forEach((l, i) => tid.has(l.from) && tid.has(l.to) && row([i + 1, tid.get(l.to), tid.get(l.from), 1, 1, 'PR_' + (l.type || 'FS'), (l.lag || 0) * HRS]));
    tbl('TASKRSRC', ['taskrsrc_id', 'task_id', 'proj_id', 'rsrc_id', 'target_qty_per_hr', 'target_qty']);
    let q = 1; acts.forEach(a => tid.has(a.id) && (a.resources || []).forEach(as => rid.has(as.res) && row([q++, tid.get(a.id), 1, rid.get(as.res), as.units, as.units * a.dur * HRS])));
    tbl('TASKPROC', ['proc_id', 'task_id', 'proj_id', 'seq_num', 'proc_name', 'complete_flag', 'proc_wt', 'complete_pct']);
    let pid = 1; acts.forEach(a => tid.has(a.id) && (a.steps || []).forEach((st, i) => row([pid++, tid.get(a.id), 1, (i + 1) * 10, st.name, (+st.pct || 0) >= 100 ? 'Y' : 'N', +st.weight || 0, +st.pct || 0])));
    const codes = p.codes || [];
    if (codes.length) {
      tbl('ACTVTYPE', ['actv_code_type_id', 'actv_short_len', 'seq_num', 'actv_code_type', 'proj_id', 'actv_code_type_scope']);
      codes.forEach((c, i) => row([i + 1, 20, (i + 1) * 10, c.name || c.id, 1, 'AS_Project']));
      tbl('ACTVCODE', ['actv_code_id', 'parent_actv_code_id', 'actv_code_type_id', 'actv_code_name', 'short_name', 'seq_num']);
      const vid = new Map(); let v = 1;
      codes.forEach((c, i) => (c.values || []).forEach((x, j) => { vid.set(c.id + '\u0000' + x.v, v); row([v++, '', i + 1, x.d || x.v, x.v, (j + 1) * 10]); }));
      tbl('TASKACTV', ['task_id', 'actv_code_type_id', 'actv_code_id', 'proj_id']);
      acts.forEach(a => tid.has(a.id) && a.codes && codes.forEach((c, i) => { const id = vid.get(c.id + '\u0000' + a.codes[c.id]); if (id) row([tid.get(a.id), i + 1, id, 1]); }));
    }
    L.push('%E');
    return L.join('\r\n') + '\r\n';
  }

  // ---------------- MS Project XML ----------------
  const xesc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xun = s => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const blocks = (xml, tag) => { const out = [], re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'); let m; while ((m = re.exec(xml))) out.push(m[1]); return out; };
  const val = (xml, tag) => { const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml); return m ? xun(m[1].trim()) : null; };
  const isoHours = s => { const m = /PT(\d+(?:\.\d+)?)H(\d+(?:\.\d+)?)M/.exec(s || ''); return m ? +m[1] + +m[2] / 60 : 0; };
  const MSP_LINK = { 0: 'FF', 1: 'FS', 2: 'SF', 3: 'SS' }, MSP_LINK_OUT = { FF: 0, FS: 1, SF: 2, SS: 3 };
  const MSP_CSTR = { 2: 'MSO', 4: 'SNET', 5: 'SNLT', 6: 'FNET', 7: 'FNLT', 3: 'FNLT' }, MSP_CSTR_OUT = { MSO: 2, SNET: 4, SNLT: 5, FNET: 6, FNLT: 7 };

  function importMSPXML(xml) {
    if (!/<Project[\s>]/.test(xml)) throw new Error('Not a Microsoft Project XML file');
    const tasksXml = blocks(blocks(xml, 'Tasks')[0] || '', 'Task');
    const hrsDay = (+val(xml, 'MinutesPerDay') || 480) / 60;
    const acts = [], idOf = new Map(), links = [];
    tasksXml.forEach(t => {
      const uid = val(t, 'UID'); if (uid === '0' || val(t, 'IsNull') === '1') return;
      const lvl = Math.max(0, (+val(t, 'OutlineLevel') || 1) - 1);
      const id = val(t, 'WBS') || val(t, 'ID') || uid; idOf.set(uid, id);
      const a = { id, name: val(t, 'Name') || id, level: lvl, dur: val(t, 'Milestone') === '1' ? 0 : Math.round(isoHours(val(t, 'Duration')) / hrsDay), pct: +val(t, 'PercentComplete') || 0,
        actualStart: d10(val(t, 'ActualStart')), actualFinish: d10(val(t, 'ActualFinish')), resources: [], notes: val(t, 'Notes') || '' };
      const ct = val(t, 'ConstraintType'); if (MSP_CSTR[ct] && val(t, 'ConstraintDate')) a.constraint = { type: MSP_CSTR[ct], date: d10(val(t, 'ConstraintDate')) };
      acts.push(a);
      blocks(t, 'PredecessorLink').forEach(pl => links.push({ _from: val(pl, 'PredecessorUID'), to: id, type: MSP_LINK[val(pl, 'Type') ?? '1'] || 'FS', lag: Math.round((+val(pl, 'LinkLag') || 0) / 10 / 60 / hrsDay) }));
    });
    // make ids unique (WBS codes can repeat in hand-made files)
    const seen = new Set(); acts.forEach(a => { let s = a.id, k = 2; while (seen.has(s)) s = a.id + '-' + k++; if (s !== a.id) { idOf.forEach((v, kk) => v === a.id && idOf.set(kk, s)); links.forEach(l => l.to === a.id && (l.to = s)); a.id = s; } seen.add(s); });
    const L = links.filter(l => idOf.has(l._from)).map(l => ({ from: idOf.get(l._from), to: l.to, type: l.type, lag: l.lag }));
    const resources = [], resOf = new Map();
    blocks(blocks(xml, 'Resources')[0] || '', 'Resource').forEach(r => { const uid = val(r, 'UID'); const name = val(r, 'Name'); if (!name || uid === '0') return; const id = name.replace(/\s+/g, '').slice(0, 12).toUpperCase() || 'R' + uid; resOf.set(uid, id); resources.push({ id, name, max: +val(r, 'MaxUnits') || 1, rate: parseFloat(val(r, 'StandardRate')) || 0 }); });
    blocks(blocks(xml, 'Assignments')[0] || '', 'Assignment').forEach(as => { const a = acts.find(x => x.id === idOf.get(val(as, 'TaskUID'))); const r = resOf.get(val(as, 'ResourceUID')); if (a && r) a.resources.push({ res: r, units: +val(as, 'Units') || 1 }); });
    return { name: val(xml, 'Title') || val(xml, 'Name') || 'Imported project', start: d10(val(xml, 'StartDate')) || new Date().toISOString().slice(0, 10), dataDate: d10(val(xml, 'StatusDate')), activities: acts, links: L, resources };
  }

  function exportMSPXML(p, sched) {
    const dur = d => `PT${d * HRS}H0M0S`, dt = (s, h = '08:00:00') => s ? `${s}T${h}` : '';
    const uid = new Map(p.activities.map((a, i) => [a.id, i + 1]));
    const o = [`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`, `<Project xmlns="http://schemas.microsoft.com/project">`,
      `<Name>${xesc(p.name)}</Name><Title>${xesc(p.name)}</Title><ScheduleFromStart>1</ScheduleFromStart><StartDate>${dt(p.start)}</StartDate>`,
      p.dataDate ? `<StatusDate>${dt(p.dataDate)}</StatusDate>` : '', `<MinutesPerDay>${HRS * 60}</MinutesPerDay><MinutesPerWeek>${HRS * 300}</MinutesPerWeek><DaysPerMonth>20</DaysPerMonth>`,
      `<CalendarUID>1</CalendarUID><Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>`];
    const wk = p.calendar && p.calendar.workweek || [false, true, true, true, true, true, false];
    wk.forEach((w, i) => o.push(`<WeekDay><DayType>${i + 1}</DayType><DayWorking>${w ? 1 : 0}</DayWorking>${w ? '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>' : ''}</WeekDay>`));
    (p.calendar && p.calendar.holidays || []).forEach(h => o.push(`<WeekDay><DayType>0</DayType><DayWorking>0</DayWorking><TimePeriod><FromDate>${h}T00:00:00</FromDate><ToDate>${h}T23:59:00</ToDate></TimePeriod></WeekDay>`));
    o.push('</WeekDays></Calendar></Calendars><Tasks>');
    p.activities.forEach((a, i) => {
      const x = sched.results.get(a.id), sum = sched.summary[i];
      o.push(`<Task><UID>${uid.get(a.id)}</UID><ID>${i + 1}</ID><Name>${xesc(a.name)}</Name><WBS>${xesc(a.id)}</WBS><OutlineLevel>${(a.level || 0) + 1}</OutlineLevel>`,
        `<Start>${dt(x.start)}</Start><Finish>${dt(x.finish, '17:00:00')}</Finish><Duration>${dur(sum ? x.dur : a.dur)}</Duration><DurationFormat>7</DurationFormat>`,
        `<Milestone>${!sum && !a.dur ? 1 : 0}</Milestone><Summary>${sum ? 1 : 0}</Summary><Critical>${x.critical ? 1 : 0}</Critical><PercentComplete>${Math.round(sum ? x.pct : a.pct || 0)}</PercentComplete>`,
        a.actualStart ? `<ActualStart>${dt(a.actualStart)}</ActualStart>` : '', a.actualFinish ? `<ActualFinish>${dt(a.actualFinish, '17:00:00')}</ActualFinish>` : '',
        `<ConstraintType>${a.constraint ? MSP_CSTR_OUT[a.constraint.type] ?? 0 : 0}</ConstraintType>`, a.constraint ? `<ConstraintDate>${dt(a.constraint.date)}</ConstraintDate>` : '',
        a.notes ? `<Notes>${xesc(a.notes)}</Notes>` : '');
      (p.links || []).filter(l => l.to === a.id && uid.has(l.from)).forEach(l => o.push(`<PredecessorLink><PredecessorUID>${uid.get(l.from)}</PredecessorUID><Type>${MSP_LINK_OUT[l.type || 'FS']}</Type><LinkLag>${(l.lag || 0) * HRS * 600}</LinkLag><LagFormat>7</LagFormat></PredecessorLink>`));
      o.push('</Task>');
    });
    o.push('</Tasks><Resources>');
    const ruid = new Map(); (p.resources || []).forEach((r, i) => { ruid.set(r.id, i + 1); o.push(`<Resource><UID>${i + 1}</UID><ID>${i + 1}</ID><Name>${xesc(r.name)}</Name><Type>1</Type><MaxUnits>${r.max ?? 1}</MaxUnits><StandardRate>${(r.rate || 0) / HRS}</StandardRate></Resource>`); });
    o.push('</Resources><Assignments>'); let k = 1;
    p.activities.forEach(a => (a.resources || []).forEach(as => ruid.has(as.res) && o.push(`<Assignment><UID>${k++}</UID><TaskUID>${uid.get(a.id)}</TaskUID><ResourceUID>${ruid.get(as.res)}</ResourceUID><Units>${as.units}</Units></Assignment>`)));
    o.push('</Assignments></Project>');
    return o.filter(Boolean).join('\n');
  }

  // ---------------- CSV ----------------
  const csvCell = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  function exportCSV(p, sched, baseline) {
    const codes = p.codes || [];
    const head = ['ID', 'Name', 'Level', 'Duration', 'Start', 'Finish', 'Late Start', 'Late Finish', 'Total Float', 'Free Float', 'Critical', '% Complete', 'Predecessors', 'Resources', 'BL Start', 'BL Finish', ...codes.map(c => c.name || c.id)];
    const rows = [head];
    p.activities.forEach((a, i) => {
      const x = sched.results.get(a.id), sum = sched.summary[i], b = baseline && baseline.acts[a.id];
      const preds = (p.links || []).filter(l => l.to === a.id).map(l => l.from + (l.type && l.type !== 'FS' || l.lag ? ' ' + (l.type || 'FS') + (l.lag ? (l.lag > 0 ? '+' : '') + l.lag : '') : '')).join('; ');
      rows.push([a.id, a.name, a.level || 0, sum ? x.dur : a.dur, x.start, x.finish, sum ? '' : x.lateStart, sum ? '' : x.lateFinish, x.tf, sum ? '' : x.ff, x.critical ? 'Yes' : '', Math.round(sum ? x.pct : a.pct || 0),
        preds, (a.resources || []).map(r => `${r.res}×${r.units}`).join('; '), b ? b.start : '', b ? b.finish : '', ...codes.map(c => sum ? '' : (a.codes && a.codes[c.id]) || '')]);
    });
    return rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }
  function parseCSV(text) {
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim()));
  }
  // CSV import: needs ID, Name, Duration; optional Level, Predecessors ("A; B SS+2"), % Complete
  function importCSV(text) {
    const rows = parseCSV(text); if (!rows.length) throw new Error('Empty CSV');
    const h = rows[0].map(s => s.trim().toLowerCase());
    const col = (...names) => h.findIndex(x => names.includes(x));
    const ci = col('id', 'activity id', 'task id', 'wbs'), cn = col('name', 'activity name', 'task name'), cd = col('duration', 'original duration', 'dur'),
      cl = col('level', 'outline level'), cp = col('predecessors', 'preds'), cc = col('% complete', 'percent complete', 'pct');
    if (cn < 0) throw new Error('CSV needs at least a Name column');
    const acts = [], links = [];
    rows.slice(1).forEach((r, i) => {
      const id = (ci >= 0 && r[ci].trim()) || 'A' + (i + 1) * 10;
      acts.push({ id, name: r[cn] || id, level: cl >= 0 ? +r[cl] || 0 : 0, dur: cd >= 0 ? Math.round(parseFloat(r[cd]) || 0) : 1, pct: cc >= 0 ? parseFloat(r[cc]) || 0 : 0, resources: [] });
      if (cp >= 0) (r[cp] || '').split(/[;|]/).map(s => s.trim()).filter(Boolean).forEach(s => {
        const m = /^(.+?)(?:\s+(FS|SS|FF|SF))?\s*([+-]\s*\d+)?\s*d?$/i.exec(s); if (m) links.push({ from: m[1].trim(), to: id, type: (m[2] || 'FS').toUpperCase(), lag: m[3] ? parseInt(m[3].replace(/\s/g, '')) : 0 });
      });
    });
    return { name: 'Imported CSV', start: new Date().toISOString().slice(0, 10), activities: acts, links, resources: [] };
  }

  const api = { clndrData, parseClndrData, importXER, exportXER, importMSPXML, exportMSPXML, exportCSV, importCSV, parseCSV, parseXerTables };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PlanIO = api;
})(typeof self !== 'undefined' ? self : this);
