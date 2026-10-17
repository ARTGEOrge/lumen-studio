// Lumen Plan — CPM project scheduler in the spirit of Primavera P6.
(function () {
  const C = window.CPM, IO = window.PlanIO, esc = s => Aero.esc(String(s ?? ''));
  const $ = id => document.getElementById(id);
  const AUTOSAVE = 'lumen-plan-autosave';
  const COLS = [
    { k: 'id', t: 'Activity ID', w: 74, edit: 'text' },
    { k: 'name', t: 'Activity name', w: 230, edit: 'text' },
    { k: 'dur', t: 'Orig dur', w: 48, num: 1, edit: 'num' },
    { k: 'rem', t: 'Rem dur', w: 48, num: 1 },
    { k: 'start', t: 'Start', w: 84 },
    { k: 'finish', t: 'Finish', w: 84 },
    { k: 'tf', t: 'Total float', w: 50, num: 1 },
    { k: 'pct', t: '% done', w: 50, num: 1, edit: 'num' },
    { k: 'bvar', t: 'BL finish var', w: 58, num: 1, bl: 1 },
    { k: 'path', t: 'Float path', w: 44, num: 1, tr: 1 },
    { k: 'rf', t: 'Rel. float', w: 46, num: 1, tr: 1 },
  ];

  const A = window.PlanApp = {
    P: null, S: null, rows: [], sel: new Set(), cur: null, ppd: 14, viewStart: null, viewEnd: null, collapsed: new Set(),
    view: { links: true, baseline: true, float: true, labels: 'name', critOnly: false, filter: '', lookahead: 0, groupBy: '' },
    trace: null, fp: null,   // driving-path trace target and its float paths
    filePath: null, docName: 'Untitled',
  };
  const hist = new Aero.History({ max: 120 });

  // ---------- core ----------
  function normalize(P) {
    P.activities = P.activities || []; P.links = P.links || []; P.resources = P.resources || []; P.baselines = P.baselines || [];
    P.calendar = P.calendar || { workweek: [false, true, true, true, true, true, false], holidays: [] };
    if (P.activeBaseline == null || !P.baselines[P.activeBaseline]) P.activeBaseline = P.baselines.length ? P.baselines.length - 1 : null;
    P.activities.forEach(a => { a.level = a.level || 0; a.dur = Math.max(0, Math.round(+a.dur || 0)); a.pct = +a.pct || 0; a.resources = a.resources || []; });
    // a level may only step in by one
    P.activities.forEach((a, i) => { const prev = i ? P.activities[i - 1].level : -1; if (a.level > prev + 1) a.level = prev + 1; });
    // activity codes (validated: opened files are untrusted)
    const seen = new Set();
    P.codes = (Array.isArray(P.codes) ? P.codes : []).filter(c => c && typeof c === 'object' && c.id != null && String(c.id).trim() && !seen.has(String(c.id).trim()) && seen.add(String(c.id).trim())).map(c => {
      const vs = new Set();
      return { id: String(c.id).trim().slice(0, 20), name: String(c.name || c.id).slice(0, 60), values: (Array.isArray(c.values) ? c.values : []).filter(v => v && v.v != null && String(v.v).trim() && !vs.has(String(v.v).trim()) && vs.add(String(v.v).trim())).map(v => ({ v: String(v.v).trim().slice(0, 40), d: String(v.d || '').slice(0, 120) })) };
    });
    const codeVals = new Map(P.codes.map(c => [c.id, new Set(c.values.map(v => v.v))]));
    P.activities.forEach(a => {
      if (a.codes && typeof a.codes === 'object' && !Array.isArray(a.codes)) { const o = {}; Object.keys(a.codes).forEach(k => { if (codeVals.has(k) && codeVals.get(k).has(String(a.codes[k]))) o[k] = String(a.codes[k]); }); if (Object.keys(o).length) a.codes = o; else delete a.codes; } else delete a.codes;
      // % complete type and steps
      if (Array.isArray(a.steps)) { a.steps = a.steps.filter(st => st && typeof st === 'object').map(st => ({ name: String(st.name ?? 'Step').slice(0, 200), weight: Math.max(0, isFinite(+st.weight) ? +st.weight : 1), pct: Math.max(0, Math.min(100, +st.pct || 0)) })); if (!a.steps.length) delete a.steps; } else delete a.steps;
      if (a.pctType !== 'physical') { delete a.pctType; delete a.remaining; }
      else { if (a.remaining != null) { a.remaining = Math.max(0, Math.round(+a.remaining || 0)); } if (a.steps) a.pct = C.stepsPct(a.steps); }
      a.pct = Math.max(0, Math.min(100, a.pct));
    });
    return P;
  }
  function reschedule() {
    A.S = C.schedule(A.P);
    if (A.trace && (A.S.error || !A.S.results.get(A.trace) || A.S.results.get(A.trace).summary)) A.trace = null;
    A.fp = A.trace ? C.floatPaths(A.P, A.S, A.trace) : null;
    if (A.view.groupBy && !(A.P.codes || []).some(c => c.id === A.view.groupBy)) A.view.groupBy = '';
    if (A.S.error) { A.S.results = A.S.results || new Map(); A.S.summary = A.P.activities.map((a, i) => C.isSummary(A.P.activities, i)); }
    const starts = [A.P.start]; let end = A.P.start;
    if (!A.S.error) A.S.results.forEach(x => { if (x.start < starts[0]) starts[0] = x.start; if (x.finish > end) end = x.finish; });
    (A.P.baselines || []).forEach(b => { if (b.finish > end) end = b.finish; });
    const s0 = C.parse(starts[0]) - 7 * 86400000; const d = new Date(s0); A.viewStart = C.iso(s0 - ((d.getUTCDay() + 6) % 7) * 86400000);
    A.viewEnd = C.addDays(end, 45);
    buildRows();
  }
  // activity passes the view filters (critical only, text filter, look-ahead window)
  function passes(a) {
    const x = A.S.results.get(a.id), f = A.view.filter.trim().toLowerCase();
    if (A.view.critOnly && !(x && x.critical)) return false;
    if (A.view.lookahead && x) { const d0 = A.P.dataDate || A.P.start, d1 = C.addDays(d0, 7 * A.view.lookahead); if (x.status === 'done' || x.finish < d0 || x.start > d1) return false; }
    if (f && !(a.id.toLowerCase().includes(f) || a.name.toLowerCase().includes(f))) return false;
    return true;
  }
  // grouped views (float paths of a trace, or an activity code) show synthetic band rows "§…" followed by copies of the activities
  function buildGroupedRows() {
    A.S.results.forEach((v, k) => { if (k[0] === '§') A.S.results.delete(k); });
    let groups;
    if (A.fp) {
      const by = new Map(); A.fp.ids.forEach(id => { const v = A.fp.info.get(id); const k = v.path == null ? 'more' : v.path; if (!by.has(k)) by.set(k, { key: 'p' + k, rf: v.rf, path: v.path, ids: [] }); by.get(k).ids.push(id); });
      groups = [...by.values()].map(g => ({ ...g, label: g.path == null ? 'Other paths' : g.path === 1 ? `Path 1 — driving ${A.trace}` + (g.rf ? ` (relative float ${g.rf} d)` : '') : `Path ${g.path} — relative float ${g.rf} d` }));
    } else groups = C.groupByCode(A.P, A.S, A.view.groupBy) || [];
    const byId = new Map(A.P.activities.map(a => [a.id, a])), out = [];
    groups.forEach(g => {
      const members = g.ids.map(id => byId.get(id)).filter(a => a && passes(a)); if (!members.length) return;
      const gid = '§' + g.key;
      let es = Infinity, ef = -Infinity, tf = Infinity, w = 0, wp = 0;
      g.ids.forEach(id => { const x = A.S.results.get(id); es = Math.min(es, x.es); ef = Math.max(ef, x.ef); tf = Math.min(tf, x.tf); const wt = Math.max(1, x.dur); w += wt; wp += wt * (byId.get(id).pct || 0); });
      A.S.results.set(gid, { id: gid, summary: true, es, ef, dur: ef - es, tf, pct: w ? wp / w : 0, start: A.S.cal.date(es), finish: ef > es ? A.S.cal.date(ef - 1) : A.S.cal.date(es) });
      out.push({ id: gid, name: g.label, level: 0, _grp: true });
      if (!A.collapsed.has(gid)) members.forEach(a => out.push({ ...a, level: 1, _view: true }));
    });
    return out;
  }
  function buildRows() {
    if (A.fp || A.view.groupBy) { A.rows = buildGroupedRows(); return; }
    A.S.results.forEach((v, k) => { if (k[0] === '§') A.S.results.delete(k); });
    const acts = A.P.activities, out = []; let hideBelow = Infinity;
    const f = A.view.filter.trim().toLowerCase();
    acts.forEach((a, i) => {
      if ((a.level || 0) > hideBelow) return; hideBelow = Infinity;
      const sum = A.S.summary ? A.S.summary[i] : C.isSummary(acts, i);
      if (sum && A.collapsed.has(a.id)) hideBelow = a.level || 0;
      if (!sum) {
        const x = A.S.results.get(a.id);
        if (A.view.critOnly && !(x && x.critical)) return;
        if (A.view.lookahead && x) { const d0 = A.P.dataDate || A.P.start, d1 = C.addDays(d0, 7 * A.view.lookahead); if (x.status === 'done' || x.finish < d0 || x.start > d1) return; }
        if (f && !(a.id.toLowerCase().includes(f) || a.name.toLowerCase().includes(f))) return;
      } else if ((A.view.critOnly || f || A.view.lookahead)) {
        // show a WBS row only if something under it survives the filter
        const lv = a.level || 0; let any = false;
        for (let j = i + 1; j < acts.length && (acts[j].level || 0) > lv; j++) { const b = acts[j], x = A.S.results.get(b.id); if (A.S.summary[j]) continue; const d0 = A.P.dataDate || A.P.start, la = !A.view.lookahead || (x && x.status !== 'done' && x.finish >= d0 && x.start <= C.addDays(d0, 7 * A.view.lookahead)); if (la && (!A.view.critOnly || (x && x.critical)) && (!f || b.id.toLowerCase().includes(f) || b.name.toLowerCase().includes(f))) { any = true; break; } }
        if (!any) return;
      }
      out.push(a);
    });
    A.rows = out;
  }
  A.baseline = () => A.P.activeBaseline != null ? A.P.baselines[A.P.activeBaseline] : null;

  function snapshot() { return JSON.stringify(A.P); }
  function load(P, name, path) {
    A.P = normalize(P); A.docName = name || A.P.name || 'Untitled'; A.filePath = path || null;
    A.sel.clear(); A.cur = null; A.collapsed.clear(); A.trace = null;
    reschedule(); hist.reset('Open', snapshot());
    const first = A.rows.find(a => !a._grp && !A.S.summary[A.P.activities.findIndex(b => b.id === a.id)]); if (first) { A.cur = first.id; A.sel.add(first.id); }
    Aero.setDoc(A.docName, false); render(true); Gantt.scrollToDate(A.viewStart);
  }
  A.commit = (label, fn) => {
    const before = snapshot();
    fn(A.P); normalize(A.P);
    if (snapshot() === before) { render(); return; }
    reschedule();
    if (A.S.error) { // refuse edits that create a loop
      Aero.alert('Relationship loop', A.S.error + '\n\nThe change was undone — an activity can’t depend on itself.');
      A.P = JSON.parse(before); reschedule(); render(); return;
    }
    hist.push(label, snapshot()); autosave(); render();
  };
  function restore(state) { if (!state) return; A.P = JSON.parse(state); reschedule(); if (!A.P.activities.some(a => a.id === A.cur)) A.cur = null; [...A.sel].forEach(id => !A.P.activities.some(a => a.id === id) && A.sel.delete(id)); autosave(); render(); }
  let saveT; function autosave() { clearTimeout(saveT); saveT = setTimeout(() => { try { localStorage.setItem(AUTOSAVE, JSON.stringify({ name: A.docName, project: A.P })); } catch (e) { } }, 400); }

  // ---------- table ----------
  const cols = () => COLS.filter(c => (!c.bl || A.baseline()) && (!c.tr || A.fp));
  function cellVal(c, a, x, sum) {
    if (!x) return '';
    switch (c.k) {
      case 'id': return a._grp ? '' : esc(a.id);
      case 'name': return `<span style="padding-left:${(a.level || 0) * 14}px"></span>${sum ? `<span class="twisty" data-tw="${esc(a.id)}">${A.collapsed.has(a.id) ? '▶' : '▼'}</span>` : '<span class="twisty"></span>'}${(!sum && a.dur === 0) ? '◆ ' : ''}${esc(a.name)}`;
      case 'dur': return sum ? x.dur : a.dur;
      case 'rem': return sum ? '' : x.status === 'done' ? 0 : x.status === 'active' ? x.ef - Math.max(x.es, A.S.dataIdx) : a.dur;
      case 'start': return x.start + (a.actualStart ? ' A' : '');
      case 'finish': return x.finish + (a.actualFinish ? ' A' : '');
      case 'tf': return `<span class="${x.tf < 0 ? 'neg' : ''}">${x.tf}</span>`;
      case 'pct': return Math.round(sum ? x.pct : a.pct || 0) + '%';
      case 'bvar': { const v = !a._grp && C.variance(A.S, A.baseline(), a.id); return v ? `<span class="${v.finish < 0 ? 'neg' : v.finish > 0 ? 'pos' : ''}">${v.finish}</span>` : ''; }
      case 'path': { const v = A.fp && A.fp.info.get(a.id); return v && !a._grp ? (v.path ?? '') : ''; }
      case 'rf': { const v = A.fp && A.fp.info.get(a.id); return v && !a._grp ? `<span class="${v.driving ? 'drvtxt' : ''}">${v.rf}</span>` : ''; }
    }
  }
  function renderTable() {
    const cs = cols(); $('table').style.setProperty('--cols', cs.map(c => c.w + 'px').join(' ') + ' 1fr');
    let h = `<div class="prow phead">${cs.map(c => `<div class="${c.num ? 'num' : ''}">${c.t}</div>`).join('')}<div></div></div>`;
    const idx = new Map(A.P.activities.map((a, i) => [a.id, i]));
    A.rows.forEach(a => {
      const i = idx.get(a.id), sum = a._grp || A.S.summary[i], x = A.S.results.get(a.id);
      const drv = A.fp && !sum && A.fp.info.get(a.id) && A.fp.info.get(a.id).driving;
      const cls = ['prow', sum && 'sum', a._grp && 'band', A.sel.has(a.id) && 'sel', x && x.critical && !sum && 'crit', drv && 'drvrow', x && x.status === 'done' && 'done'].filter(Boolean).join(' ');
      h += `<div class="${cls}" data-id="${esc(a.id)}">${cs.map(c => `<div class="c-${c.k} ${c.num ? 'num' : ''}" data-c="${c.k}">${cellVal(c, a, x, sum)}</div>`).join('')}<div></div></div>`;
    });
    $('table').innerHTML = h;
  }
  function startEdit(row, cell) {
    const id = row.dataset.id, k = cell.dataset.c, col = COLS.find(c => c.k === k); if (!col || !col.edit) return;
    const a = A.P.activities.find(x => x.id === id); if (!a) return;
    const sum = A.S.summary[A.P.activities.indexOf(a)];
    if (sum && (k === 'dur' || k === 'pct')) return;
    if (k === 'pct' && a.pctType === 'physical' && a.steps) { Aero.toast('% complete comes from this activity’s steps — edit them on the Steps tab.'); Panels.setTab('steps'); return; }
    const inp = document.createElement('input'); inp.className = 'cell'; inp.value = k === 'pct' ? (a.pct || 0) : a[k];
    if (col.edit === 'num') { inp.type = 'number'; inp.min = 0; if (k === 'pct') inp.max = 100; }
    cell.innerHTML = ''; cell.appendChild(inp); inp.focus(); inp.select();
    let done = false;
    const finish = ok => {
      if (done) return; done = true;
      if (!ok) return render();
      const v = inp.value;
      if (k === 'id') { const nv = v.trim(); if (nv && nv !== id) { if (A.P.activities.some(x => x.id === nv)) { Aero.toast('That ID is already used.'); return render(); } return A.renameId(id, nv); } return render(); }
      A.commit('Edit ' + col.t.toLowerCase(), P => { const t = P.activities.find(x => x.id === id);
        if (k === 'name') t.name = v || t.name;
        else if (k === 'dur') t.dur = Math.max(0, Math.round(+v || 0));
        else if (k === 'pct') { t.pct = Math.max(0, Math.min(100, +v || 0)); const x = A.S.results.get(id); if (t.pct > 0 && !t.actualStart) t.actualStart = x.start; if (t.pct >= 100 && !t.actualFinish) t.actualFinish = x.finish; if (t.pct < 100) t.actualFinish = null; if (t.pct === 0) t.actualStart = null; } });
    };
    inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') finish(true); else if (e.key === 'Escape') finish(false);
      else if (e.key === 'Tab') { e.preventDefault(); finish(true); const order = COLS.filter(c => c.edit).map(c => c.k); const nk = order[(order.indexOf(k) + (e.shiftKey ? -1 : 1) + order.length) % order.length]; setTimeout(() => { const r = document.querySelector(`.prow[data-id="${CSS.escape(A.cur)}"] [data-c="${nk}"]`); if (r) startEdit(r.parentElement, r); }); } };
    inp.onblur = () => finish(true);
  }
  A.renameId = (old, nv) => A.commit('Rename ID', P => {
    P.activities.find(a => a.id === old).id = nv; P.links.forEach(l => { if (l.from === old) l.from = nv; if (l.to === old) l.to = nv; });
    P.baselines.forEach(b => { if (b.acts[old]) { b.acts[nv] = b.acts[old]; delete b.acts[old]; } });
    if (A.cur === old) A.cur = nv; if (A.sel.delete(old)) A.sel.add(nv);
  });

  // ---------- selection ----------
  let anchor = null;
  A.select = (id, mode = 'one') => {
    if (mode === 'toggle') { A.sel.has(id) ? A.sel.delete(id) : A.sel.add(id); }
    else if (mode === 'range' && anchor) { const ia = A.rows.findIndex(a => a.id === anchor), ib = A.rows.findIndex(a => a.id === id); A.sel.clear(); for (let i = Math.min(ia, ib); i <= Math.max(ia, ib); i++) A.sel.add(A.rows[i].id); }
    else { A.sel.clear(); A.sel.add(id); }
    if (mode !== 'range') anchor = id;
    A.cur = id; renderTable(); Gantt.draw(); Panels.render(); status();
  };
  A.openDetails = () => Panels.setTab('general');
  A.onGanttScroll = top => { if (Math.abs($('tableWrap').scrollTop - top) > 1) $('tableWrap').scrollTop = top; Panels.redrawUsage(); };

  // ---------- commands ----------
  function nextId(prefix = 'A') {
    const nums = A.P.activities.map(a => +(String(a.id).match(/^[A-Za-z]*(\d+)$/) || [])[1]).filter(n => isFinite(n));
    let n = (nums.length ? Math.max(...nums) : 990) + 10; n = Math.ceil(n / 10) * 10;
    while (A.P.activities.some(a => a.id === prefix + n)) n += 10; return prefix + n;
  }
  function insertAt() { const i = A.P.activities.findIndex(a => a.id === A.cur); if (i < 0) return { at: A.P.activities.length, level: A.P.activities.length ? A.P.activities[A.P.activities.length - 1].level : 0 };
    const sum = A.S.summary[i]; if (sum && !A.collapsed.has(A.cur)) return { at: i + 1, level: A.P.activities[i].level + 1 };
    let j = i + 1; const lv = A.P.activities[i].level; while (j < A.P.activities.length && A.P.activities[j].level > lv) j++; return { at: j, level: lv }; }
  function addActivity(kind) {
    const { at, level } = insertAt(); const id = kind === 'wbs' ? 'WBS-' + (A.P.activities.filter(a => /^WBS-/.test(a.id)).length + 1) : kind === 'mile' ? nextId('M') : nextId('A');
    let uid = id, k = 2; while (A.P.activities.some(a => a.id === uid)) uid = id + '-' + k++;
    const a = { id: uid, name: kind === 'wbs' ? 'New WBS group' : kind === 'mile' ? 'New milestone' : 'New activity', level, dur: kind === 'act' ? 5 : 0, pct: 0, resources: [], notes: '' };
    const prev = A.cur && A.S.results.get(A.cur) && !A.S.summary[A.P.activities.findIndex(x => x.id === A.cur)] ? A.cur : null;
    A.commit('Add ' + (kind === 'wbs' ? 'WBS' : kind === 'mile' ? 'milestone' : 'activity'), P => {
      P.activities.splice(at, 0, a);
      if (kind === 'wbs') { // a new group takes the next row as its first child
        if (P.activities[at + 1] && P.activities[at + 1].level === level) P.activities[at + 1].level = level + 1; else P.activities.splice(at + 1, 0, { id: nextId('A'), name: 'New activity', level: level + 1, dur: 5, pct: 0, resources: [], notes: '' });
      } else if (prev && $('autoLink').checked) P.links.push({ from: prev, to: uid, type: 'FS', lag: 0 });
    });
    A.select(uid);
    setTimeout(() => { const c = document.querySelector(`.prow[data-id="${CSS.escape(uid)}"] [data-c="name"]`); if (c) startEdit(c.parentElement, c); });
  }
  function blockOf(i) { const lv = A.P.activities[i].level; let j = i + 1; while (j < A.P.activities.length && A.P.activities[j].level > lv) j++; return [i, j]; }
  function indent(d) {
    const ids = A.rows.filter(a => A.sel.has(a.id)).map(a => a.id); if (!ids.length) return;
    A.commit(d > 0 ? 'Indent' : 'Outdent', P => {
      const done = new Set();
      ids.forEach(id => { const i = P.activities.findIndex(a => a.id === id); if (i < 0 || done.has(id)) return;
        const [s, e] = blockOf(i); const prev = s ? P.activities[s - 1].level : -1;
        if (d > 0 && P.activities[s].level > prev) return; if (d < 0 && P.activities[s].level === 0) return;
        for (let k = s; k < e; k++) { P.activities[k].level += d; done.add(P.activities[k].id); } });
    });
  }
  function moveRow(d) {
    const i = A.P.activities.findIndex(a => a.id === A.cur); if (i < 0) return;
    A.commit('Move', P => { const [s, e] = blockOf(i); const blk = P.activities.splice(s, e - s);
      let t; if (d < 0) { t = s - 1; while (t > 0 && P.activities[t].level > blk[0].level) t--; if (t < 0) t = 0; } else { t = s; if (t < P.activities.length) { const [, e2] = blockOf(t); t = e2; } }
      P.activities.splice(Math.max(0, Math.min(P.activities.length, t)), 0, ...blk); });
  }
  async function del() {
    const ids = [...A.sel]; if (!ids.length) return;
    const groups = ids.filter(id => { const i = A.P.activities.findIndex(a => a.id === id); return i >= 0 && A.S.summary[i]; });
    if (groups.length && !await Aero.confirm('Delete WBS', `Delete ${groups.length > 1 ? 'these WBS groups' : 'this WBS group'} and every activity inside?`)) return;
    A.commit('Delete', P => {
      const kill = new Set();
      ids.forEach(id => { const i = P.activities.findIndex(a => a.id === id); if (i < 0) return; const [s, e] = blockOf(i); for (let k = s; k < e; k++) kill.add(P.activities[k].id); });
      P.activities = P.activities.filter(a => !kill.has(a.id)); P.links = P.links.filter(l => !kill.has(l.from) && !kill.has(l.to));
    });
    A.sel.clear(); A.cur = null; render();
  }
  A.addLink = (from, to, type = 'FS', lag = 0) => {
    if (A.P.links.some(l => l.from === from && l.to === to)) { Aero.toast(`${from} → ${to} is already linked.`); return; }
    A.commit('Link ' + from + ' → ' + to, P => P.links.push({ from, to, type, lag }));
  };
  function linkSelected() {
    const ids = A.rows.filter(a => A.sel.has(a.id) && !a._grp && !A.S.summary[A.P.activities.findIndex(b => b.id === a.id)]).map(a => a.id);
    if (ids.length < 2) { Aero.toast('Select two or more activities (Ctrl+click), then Link — or drag from the ○ handle at a bar’s end.'); return; }
    A.commit('Link activities', P => { for (let i = 1; i < ids.length; i++) if (!P.links.some(l => l.from === ids[i - 1] && l.to === ids[i])) P.links.push({ from: ids[i - 1], to: ids[i], type: 'FS', lag: 0 }); });
  }
  function unlinkSelected() {
    const ids = new Set(A.sel); A.commit('Unlink', P => { P.links = P.links.filter(l => !(ids.has(l.from) && ids.has(l.to))); });
  }
  A.levelResources = () => {
    const r = C.level(A.P); if (r.error) return Aero.alert('Leveling', r.error);
    const before = A.S.finishDate;
    A.commit('Level resources', P => { P.activities.forEach(a => { delete a.leveledStart; if (r.leveled.has(a.id)) a.leveledStart = r.leveled.get(a.id); }); });
    const left = C.overallocations(A.P, A.S);
    Aero.toast(`Leveled: ${r.leveled.size} activit${r.leveled.size === 1 ? 'y' : 'ies'} delayed · finish ${before} → ${A.S.finishDate}${left.length ? ' · still over: ' + left.map(o => o.res).join(', ') : ''}`);
  };
  // ---------- driving path trace & grouping ----------
  A.traceTo = id => {
    id = id || A.cur;
    const a = A.P.activities.find(x => x.id === id), i = A.P.activities.indexOf(a);
    if (!a || A.S.summary[i]) { Aero.toast('Select an activity (not a WBS row) to trace the logic that drives it.'); return; }
    A.trace = id; A.collapsed.forEach(k => k[0] === '§' && A.collapsed.delete(k)); reschedule(); render();
    const n = A.fp ? A.fp.ids.length - 1 : 0, drv = A.fp ? A.fp.ids.filter(k => A.fp.info.get(k).driving).length - 1 : 0;
    Aero.toast(`${id}: ${drv} driving predecessor${drv === 1 ? '' : 's'}, ${n} in all on ${A.fp ? A.fp.paths : 0} float path${A.fp && A.fp.paths === 1 ? '' : 's'}. Shift+F8 clears the trace.`);
  };
  A.clearTrace = () => { if (!A.trace) return; A.trace = null; reschedule(); render(); };
  A.setGroupBy = code => { A.view.groupBy = code || ''; A.collapsed.forEach(k => k[0] === '§' && A.collapsed.delete(k)); if (A.trace) A.trace = null; reschedule(); render(); };
  function groupDialog() {
    const codes = A.P.codes || [];
    if (!codes.length) { Aero.toast('No activity codes yet — define some on the Activity codes tab.'); Panels.setTab('codes'); return; }
    Aero.dialog({ title: 'Group activities', instruction: 'Show activities in bands by an activity code (like P6 Group and Sort), or by the WBS outline.', fields: [
      { key: 'g', label: 'Group by', type: 'select', value: A.view.groupBy, options: [['', 'WBS outline'], ...codes.map(c => [c.id, c.name])] }],
      onOK: v => A.setGroupBy(v.g) });
  }
  function clearLeveling() { A.commit('Clear leveling', P => P.activities.forEach(a => delete a.leveledStart)); }
  A.saveBaseline = async () => {
    const name = await Aero.prompt('Save baseline', 'Baseline name', 'Baseline ' + ((A.P.baselines || []).length + 1) + ' — ' + new Date().toISOString().slice(0, 10)); if (!name) return;
    A.commit('Save baseline', P => { P.baselines.push(C.makeBaseline(P, A.S, name)); P.activeBaseline = P.baselines.length - 1; });
    Aero.toast('Baseline saved — yellow bars show it under each activity.');
  };
  A.setBaseline = i => A.commit('Compare baseline', P => { P.activeBaseline = i; });

  function projectSettings() {
    const P = A.P;
    Aero.dialog({ title: 'Project settings', instruction: 'Dates are scheduled in working days on the project calendar.', fields: [
      { key: 'name', label: 'Project name', type: 'text', value: P.name || '' },
      { key: 'start', label: 'Planned start', type: 'date', value: P.start },
      { key: 'dataDate', label: 'Data date (status date)', type: 'date', value: P.dataDate || '' },
      { key: 'mustFinish', label: 'Must finish by', type: 'date', value: P.mustFinish || '' },
      { key: 'criticalFloat', label: 'Critical if total float ≤', type: 'number', value: P.criticalFloat || 0, min: -100, max: 100, step: 1 },
    ], onOK: v => A.commit('Project settings', P => { P.name = v.name; if (v.start) P.start = v.start; P.dataDate = v.dataDate || null; P.mustFinish = v.mustFinish || null; P.criticalFloat = Math.round(+v.criticalFloat || 0); }) });
  }
  function calendarDialog() {
    const cal = A.P.calendar, names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    Aero.dialog({ title: 'Project calendar', instruction: 'Working days and holidays used for every activity.', fields: [
      ...names.map((n, i) => ({ key: 'd' + i, label: n, type: 'checkbox', value: cal.workweek[i] })),
      { key: 'hol', label: 'Holidays (one YYYY-MM-DD per line)', type: 'textarea', mono: true, value: (cal.holidays || []).join('\n') },
    ], onOK: v => {
      const wk = names.map((n, i) => !!v['d' + i]); if (!wk.some(Boolean)) return Aero.alert('Calendar', 'At least one day must be a working day.');
      const hol = String(v.hol || '').split(/[\s,;]+/).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s)).sort();
      A.commit('Edit calendar', P => { P.calendar = { workweek: wk, holidays: hol }; });
    } });
  }
  function updateProgress() {
    Aero.dialog({ title: 'Update progress', instruction: 'Move the data date forward. Activities that should have started by then can be marked as started on schedule.', fields: [
      { key: 'dd', label: 'New data date', type: 'date', value: A.P.dataDate ? C.addDays(A.P.dataDate, 7) : C.addDays(A.P.start, 7) },
      { key: 'auto', label: 'Apply planned progress to activities due by then', type: 'checkbox', value: true },
    ], onOK: v => { if (!v.dd) return; const S = A.S;
      A.commit('Update progress', P => {
        if (v.auto) { const cal = S.cal, dd = cal.idx(v.dd);
          P.activities.forEach((a, i) => { if (S.summary[i] || a.pct >= 100) return; const x = S.results.get(a.id); if (!x || x.status !== 'planned' || x.es >= dd) return;
            a.actualStart = x.start; if (x.ef <= dd) { a.pct = 100; a.actualFinish = x.finish; } else a.pct = Math.round(100 * (dd - x.es) / Math.max(1, a.dur)); });
        }
        P.dataDate = v.dd;
      }); } });
  }

  // ---------- files ----------
  const PLAN_FILTERS = [{ name: 'Lumen Plan project', extensions: ['lplan'] }];
  async function openFiles(files) {
    const f = files[0]; if (!f) return;
    const name = f.name.replace(/\.[^.]+$/, ''), ext = (f.name.split('.').pop() || '').toLowerCase();
    const text = typeof f.data === 'string' ? f.data : new TextDecoder().decode(f.data);
    try {
      let P;
      if (ext === 'lplan' || ext === 'json') { const j = JSON.parse(text); P = j.project || j; return load(P, name, ext === 'lplan' ? f.path : null); }
      if (ext === 'xer') P = IO.importXER(text);
      else if (ext === 'xml') P = IO.importMSPXML(text);
      else if (ext === 'csv') P = IO.importCSV(text);
      else throw new Error('Lumen Plan opens .lplan, Primavera .xer, Microsoft Project .xml and .csv files.');
      load(P, name, null); Aero.toast(`Imported ${P.activities.length} rows and ${P.links.length} relationships from ${f.name}`);
      if (A.S.error) Aero.alert('Import', A.S.error);
    } catch (e) { Aero.alert('Couldn’t open ' + f.name, e.message || String(e)); }
  }
  async function openDialog() { openFiles(await Aero.openFile({ accept: '.lplan,.xer,.xml,.csv,.json', filters: [{ name: 'Schedules', extensions: ['lplan', 'xer', 'xml', 'csv'] }] })); }
  async function save(as) {
    const data = JSON.stringify({ format: 'lumen-plan', version: 2, project: A.P }, null, 1);
    const p = await Aero.saveFile({ name: A.docName + '.lplan', data, filters: PLAN_FILTERS, path: as ? null : A.filePath });
    if (p) { A.filePath = typeof p === 'string' && /[\\/]/.test(p) ? p : A.filePath; A.docName = Aero.baseName ? Aero.baseName(String(p)).replace(/\.lplan$/i, '') : A.docName; Aero.setDoc(A.docName, false); return true; }
    return false;
  }
  async function exportAs(kind) {
    const base = A.docName;
    if (kind === 'xer') return Aero.saveFile({ name: base + '.xer', data: IO.exportXER(A.P, A.S), filters: [{ name: 'Primavera P6 XER', extensions: ['xer'] }] });
    if (kind === 'xml') return Aero.saveFile({ name: base + '.xml', data: IO.exportMSPXML(A.P, A.S), filters: [{ name: 'Microsoft Project XML', extensions: ['xml'] }] });
    if (kind === 'csv') return Aero.saveFile({ name: base + '.csv', data: IO.exportCSV(A.P, A.S, A.baseline()), filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (kind === 'svg') return Aero.saveFile({ name: base + ' - Gantt.svg', data: Gantt.exportSVG(), filters: [{ name: 'SVG vector image', extensions: ['svg'] }] });
    if (kind === 'png') { const c = Gantt.exportCanvas(); const blob = await new Promise(r => c.toBlob(r, 'image/png')); return Aero.saveFile({ name: base + ' - Gantt.png', data: blob, filters: [{ name: 'PNG image', extensions: ['png'] }] }); }
  }
  async function newProject(sample) {
    if (hist.items.length > 1 && !await Aero.confirm('New project', 'Start a new project? Unsaved changes are kept only in the undo history of this window.')) return;
    if (sample) return load(PlanSample.sampleProject(), 'Riverside Office Building');
    const start = C.iso(Date.now());
    load({ name: 'New project', start, activities: [{ id: 'A1000', name: 'Project start', level: 0, dur: 0, pct: 0, resources: [] }, { id: 'A1010', name: 'First activity', level: 0, dur: 5, pct: 0, resources: [] }], links: [{ from: 'A1000', to: 'A1010', type: 'FS', lag: 0 }], resources: [], baselines: [] }, 'New project');
  }

  // ---------- view ----------
  A.zoomBy = (f, atX = 0) => {
    const wrap = $('ganttWrap'), dateX = (wrap.scrollLeft + atX) / A.ppd;
    A.ppd = Math.max(0.6, Math.min(80, A.ppd * f)); $('zoom').value = [...$('zoom').options].reduce((b, o) => Math.abs(+o.value - A.ppd) < Math.abs(+b - A.ppd) ? o.value : b, $('zoom').options[0].value);
    Gantt.draw(); wrap.scrollLeft = dateX * A.ppd - atX; Gantt.draw(); Panels.redrawUsage();
  };
  function status() {
    if (A.S.error) { $('st1').innerHTML = `<span class="neg">${esc(A.S.error)}</span>`; return; }
    const work = A.P.activities.filter((a, i) => !A.S.summary[i]);
    $('st1').textContent = `${work.length} activities · ${A.P.links.length} relationships`;
    $('st2').textContent = `Finish ${A.S.finishDate}` + (A.baseline() ? ` (baseline ${A.baseline().finish})` : '');
    const crit = work.filter(a => A.S.results.get(a.id).critical).length;
    $('st3').textContent = `${crit} critical` + (A.P.mustFinish ? ` · must finish ${A.P.mustFinish}` : '');
    const over = C.overallocations(A.P, A.S);
    $('st4').innerHTML = `Data date ${A.P.dataDate || A.P.start}` + (over.length ? ` · <span class="neg">overallocated: ${over.map(o => esc(o.res)).join(', ')}</span>` : '');
  }
  function render() {
    renderTable(); Gantt.draw(); Panels.soft(); status();
    const bs = $('blSel'); bs.innerHTML = '<option value="">(none)</option>' + (A.P.baselines || []).map((b, i) => `<option value="${i}">${esc(b.name)}</option>`).join(''); bs.value = A.P.activeBaseline == null ? '' : A.P.activeBaseline;
    $('hint').textContent = A.fp ? `Tracing ${A.trace} — ${A.fp.ids.length - 1} predecessors on ${A.fp.paths} path${A.fp.paths === 1 ? '' : 's'}` : A.sel.size > 1 ? `${A.sel.size} selected` : '';
    const gs = $('groupSel'); if (gs) { gs.innerHTML = '<option value="">WBS</option>' + (A.P.codes || []).map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join(''); gs.value = A.view.groupBy; gs.disabled = !!A.fp; }
    const tb = $('bTrace'); if (tb) { tb.textContent = A.fp ? '✕ Clear trace' : '← Trace'; }
  }
  A.render = render;
  A.rebuild = () => { buildRows(); render(); };

  // ---------- wiring ----------
  function wire() {
    $('bAdd').onclick = () => addActivity('act'); $('bMile').onclick = () => addActivity('mile'); $('bWbs').onclick = () => addActivity('wbs');
    $('bIn').onclick = () => indent(1); $('bOut').onclick = () => indent(-1); $('bLink').onclick = linkSelected; $('bDel').onclick = del;
    $('zoom').onchange = () => { const wrap = $('ganttWrap'); const f = +$('zoom').value / A.ppd; A.zoomBy(f, wrap.clientWidth / 2); };
    $('blSel').onchange = () => A.setBaseline($('blSel').value === '' ? null : +$('blSel').value);
    $('critOnly').onchange = () => { A.view.critOnly = $('critOnly').checked; buildRows(); render(); };
    $('filter').oninput = () => { A.view.filter = $('filter').value; buildRows(); render(); };
    const auto = document.createElement('label'); auto.innerHTML = '<input type="checkbox" id="autoLink" checked> Auto-link new'; auto.title = 'Link each new activity finish-to-start after the selected one';
    $('critOnly').parentElement.before(auto);
    $('groupSel').onchange = () => A.setGroupBy($('groupSel').value);
    $('bTrace').onclick = () => A.fp ? A.clearTrace() : A.traceTo();
    const tw = $('tableWrap');
    tw.addEventListener('scroll', () => { const g = $('ganttWrap'); if (Math.abs(g.scrollTop - tw.scrollTop) > 1) g.scrollTop = tw.scrollTop; });
    tw.addEventListener('click', e => {
      const t = e.target.closest('[data-tw]'); if (t) { const id = t.dataset.tw; A.collapsed.has(id) ? A.collapsed.delete(id) : A.collapsed.add(id); buildRows(); render(); return; }
      const row = e.target.closest('.prow[data-id]'); if (!row || e.target.closest('input')) return;
      A.select(row.dataset.id, e.ctrlKey ? 'toggle' : e.shiftKey ? 'range' : 'one');
    });
    tw.addEventListener('dblclick', e => { const cell = e.target.closest('[data-c]'), row = e.target.closest('.prow[data-id]'); if (cell && row) startEdit(row, cell); });
    // splitters
    const drag = (el, fn) => el.addEventListener('pointerdown', e => { e.preventDefault(); const mv = ev => fn(ev); const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); Gantt.draw(); Panels.redrawUsage(); }; addEventListener('pointermove', mv); addEventListener('pointerup', up); });
    drag($('vsplit'), e => { const r = $('top').getBoundingClientRect(); $('top').style.setProperty('--table-w', Aero.clamp(e.clientX - r.left, 160, r.width - 160) + 'px'); Gantt.draw(); });
    drag($('hsplit'), e => { const r = $('work').getBoundingClientRect(); $('work').style.setProperty('--bottom-h', Aero.clamp(r.bottom - e.clientY, 60, r.height - 120) + 'px'); Gantt.draw(); });
    // keyboard
    document.addEventListener('keydown', e => {
      if ((e.target.closest && e.target.closest('input,textarea,select')) || document.querySelector('.aero-dialog, .aero-modal')) return;
      const i = A.rows.findIndex(a => a.id === A.cur);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (e.ctrlKey) { e.preventDefault(); moveRow(e.key === 'ArrowUp' ? -1 : 1); return; } if (e.altKey) return; e.preventDefault(); const n = A.rows[Aero.clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, A.rows.length - 1)]; if (n) { A.select(n.id, e.shiftKey ? 'range' : 'one'); const r = document.querySelector(`.prow[data-id="${CSS.escape(n.id)}"]`); r && r.scrollIntoView({ block: 'nearest' }); } }
      else if (e.key === 'F2' && A.cur) { e.preventDefault(); const c = document.querySelector(`.prow[data-id="${CSS.escape(A.cur)}"] [data-c="name"]`); c && startEdit(c.parentElement, c); }
      else if (e.key === 'Enter' && A.cur) { const c = document.querySelector(`.prow[data-id="${CSS.escape(A.cur)}"] [data-c="name"]`); c && startEdit(c.parentElement, c); }
    });
  }

  const zoomTo = v => { $('zoom').value = v; $('zoom').onchange(); };
  Aero.init({ name: 'Lumen Plan', icon: '../kit/icons/plan.png', doc: 'Untitled',
    onDropFiles: openFiles, dropText: 'Drop a .lplan, Primavera .xer, MS Project .xml or .csv schedule', onSave: () => save(false),
    menus: {
      File: [['New project', 'Ctrl+N', () => newProject(false)], ['New from sample', '', () => newProject(true)], ['Open…', 'Ctrl+O', openDialog], '-',
        ['Save', 'Ctrl+S', () => save(false)], ['Save as…', 'Ctrl+Shift+S', () => save(true)], '-', '#Export',
        ['Primavera P6 (.xer)…', '', () => exportAs('xer')], ['Microsoft Project XML…', '', () => exportAs('xml')], ['Spreadsheet (.csv)…', '', () => exportAs('csv')], ['Gantt chart image (.png)…', '', () => exportAs('png')], ['Gantt chart vector (.svg)…', '', () => exportAs('svg')], '-', ['Print…', 'Ctrl+P', () => print()]],
      Edit: [['Undo', 'Ctrl+Z', () => restore(hist.undo())], ['Redo', 'Ctrl+Y', () => restore(hist.redo())], '-',
        ['Add activity', 'Insert', () => addActivity('act')], ['Add milestone', 'Ctrl+M', () => addActivity('mile')], ['Add WBS group', 'Ctrl+G', () => addActivity('wbs')], '-',
        ['Indent', 'Alt+Right', () => indent(1)], ['Outdent', 'Alt+Left', () => indent(-1)], ['Move up', 'Ctrl+Up', () => moveRow(-1)], ['Move down', 'Ctrl+Down', () => moveRow(1)], '-',
        ['Link selected (finish-to-start)', 'Ctrl+L', linkSelected], ['Unlink selected', 'Ctrl+Shift+L', unlinkSelected], '-', ['Delete', 'Delete', del], ['Select all', 'Ctrl+A', () => { A.rows.forEach(a => !a._grp && A.sel.add(a.id)); render(); }], '-',
        ['Activity steps…', '', () => Panels.setTab('steps')], ['Activity codes…', '', () => Panels.setTab('codes')]],
      Schedule: [['Schedule now', 'F9', () => { reschedule(); render(); Aero.toast(A.S.error || `Scheduled — finish ${A.S.finishDate}`); }], ['Update progress…', '', updateProgress], '-',
        ['Project settings…', '', projectSettings], ['Calendar…', '', calendarDialog], '-',
        ['Level resources', 'Shift+F9', () => A.levelResources()], ['Clear leveling', '', clearLeveling], '-',
        ['Trace driving path to selected', 'F8', () => A.traceTo()], { label: 'Clear trace', key: 'Shift+F8', fn: () => A.clearTrace(), disabled: () => !A.trace }, '-',
        ['Check schedule quality (DCMA 14-point)', '', () => Panels.setTab('check')], ['Schedule log', '', () => Panels.setTab('log')]],
      Baseline: [['Save baseline…', '', () => A.saveBaseline()], ['Manage baselines', '', () => Panels.setTab('bl')], ['Earned value', '', () => Panels.setTab('ev')]],
      View: [['Zoom in', 'Ctrl+=', () => A.zoomBy(1.4, $('ganttWrap').clientWidth / 2)], ['Zoom out', 'Ctrl+-', () => A.zoomBy(1 / 1.4, $('ganttWrap').clientWidth / 2)], '-',
        { label: 'Days', fn: () => zoomTo(40) }, { label: 'Weeks', fn: () => zoomTo(14) }, { label: 'Months', fn: () => zoomTo(4) }, { label: 'Quarters', fn: () => zoomTo(1.2) }, '-',
        { label: 'Relationship lines', checked: () => A.view.links, fn: () => { A.view.links = !A.view.links; Gantt.draw(); } },
        { label: 'Baseline bars', checked: () => A.view.baseline, fn: () => { A.view.baseline = !A.view.baseline; Gantt.draw(); } },
        { label: 'Float bars', checked: () => A.view.float, fn: () => { A.view.float = !A.view.float; Gantt.draw(); } },
        { label: 'Resource labels on bars', checked: () => A.view.labels === 'res', fn: () => { A.view.labels = A.view.labels === 'res' ? 'name' : 'res'; Gantt.draw(); } }, '-',
        ...[2, 3, 6].map(w => ({ label: `${w}-week look-ahead`, checked: () => A.view.lookahead === w, fn: () => { A.view.lookahead = A.view.lookahead === w ? 0 : w; buildRows(); render(); Aero.toast(A.view.lookahead ? `Showing unfinished work from the data date to ${C.addDays(A.P.dataDate || A.P.start, 7 * w)}` : 'Showing all activities'); } })),
        ['Group by activity code…', '', groupDialog], { label: 'Group by WBS', checked: () => !A.view.groupBy, fn: () => A.setGroupBy('') },
        { label: 'Critical activities only', checked: () => A.view.critOnly, fn: () => { A.view.critOnly = !A.view.critOnly; $('critOnly').checked = A.view.critOnly; buildRows(); render(); } },
        ['Expand all', '', () => { A.collapsed.clear(); buildRows(); render(); }], ['Collapse all', '', () => { A.P.activities.forEach((a, i) => A.S.summary[i] && A.collapsed.add(a.id)); A.rows.forEach(a => a._grp && A.collapsed.add(a.id)); buildRows(); render(); }], '-',
        ['Go to project start', 'Home', () => Gantt.scrollToDate(A.P.start)], ['Go to data date', '', () => Gantt.scrollToDate(A.P.dataDate || A.P.start)]],
      Help: [['How Lumen Plan schedules', '', () => Aero.alert('How Lumen Plan schedules',
        'Lumen Plan uses the Critical Path Method, like Primavera P6.\n\n• Durations, lags and float are in working days on the project calendar.\n• Relationships: FS, SS, FF, SF with lags (negative = lead).\n• Forward pass gives early dates, backward pass gives late dates; total float = late finish − early finish.\n• Critical = total float ≤ the threshold in Project settings (0 by default). Negative float means a constraint or “must finish by” date can’t be met.\n• Progress: activities with an actual start are scheduled from the data date with their remaining duration.\n• WBS rows roll up the activities indented under them; View → Group by activity code shows the same roll-ups for any code.\n• Trace driving path (F8) ranks every predecessor of one activity by its float relative to that activity: path 1 drives it, path 2 has the next-least float, and so on.\n• Activities with the Physical % complete type take their % from weighted steps and keep their own remaining duration.\n• Schedule → Check schedule quality runs the DCMA 14-point assessment.\n• Leveling delays lower-priority work (most float first) until no resource exceeds its max units per day.\n\nDrag a bar to set a Start-No-Earlier-Than constraint, drag its right end to change duration, or drag from the ○ handle onto another bar to link them.')],
        ['Keyboard shortcuts', '', () => Aero.alert('Shortcuts', 'Insert — add activity\nCtrl+M — milestone · Ctrl+G — WBS group\nEnter / F2 — rename · double-click a cell to edit · Tab moves to the next cell\nAlt+←/→ — outdent / indent\nCtrl+↑/↓ — move row\nCtrl+L — link selected (in order) · Ctrl+Shift+L — unlink\nF9 — schedule · Shift+F9 — level resources\nF8 — trace the driving path to the selected activity · Shift+F8 — clear trace\nCtrl+wheel on the Gantt — zoom')]],
    } });

  Gantt.attach(A); Panels.attach(A); wire();
  let start = null;
  try { const j = JSON.parse(localStorage.getItem(AUTOSAVE) || 'null'); if (j && j.project && j.project.activities) start = j; } catch (e) { }
  if (start) { load(start.project, start.name); Aero.setDirty(true); } else load(PlanSample.sampleProject(), 'Riverside Office Building');
  window.addEventListener('resize', () => Gantt.draw());
})();
