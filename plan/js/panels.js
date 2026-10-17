// Lumen Plan bottom detail pane: activity details, relationships, assignments, resource usage, resource list,
// earned value, baselines and the schedule log.
(function () {
  const C = window.CPM, esc = s => Aero.esc(String(s ?? ''));
  const money = v => v == null || !isFinite(v) ? '—' : (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 });
  const ratio = v => v == null || !isFinite(v) ? '—' : v.toFixed(2);
  let A, body, tab = 'general';

  const CSTR = [['', 'None (as soon as possible)'], ['SNET', 'Start on or after'], ['SNLT', 'Start on or before'], ['MSO', 'Must start on'], ['FNET', 'Finish on or after'], ['FNLT', 'Finish on or before']];

  function cur() { return A.P.activities.find(a => a.id === A.cur); }

  function general() {
    const a = cur(); if (!a) return `<div class="empty">Select an activity to see its details.</div>`;
    const x = A.S.results.get(a.id) || {}, sum = x.summary;
    const bl = A.baseline(), v = bl && C.variance(A.S, bl, a.id);
    const ro = (l, val, cls = '') => `<label>${l}</label><div class="ro ${cls}">${val ?? ''}</div>`;
    const inp = (l, k, type, val, extra = '') => `<label>${l}</label><input data-k="${k}" type="${type}" value="${esc(val ?? '')}" ${extra}>`;
    if (sum) return `<div class="dgrid">${inp('WBS code', 'id', 'text', a.id)}${inp('Name', 'name', 'text', a.name, 'style="grid-column:span 5"')}
      ${ro('Start', x.start)}${ro('Finish', x.finish)}${ro('Duration', x.dur + ' d')}${ro('% complete', Math.round(x.pct) + '%')}
      ${ro('Total float', x.tf + ' d', x.tf < 0 ? 'neg' : '')}${ro('Budget', money(rollBudget(a)))}${v ? ro('BL finish var.', fmtVar(v.finish)) : ''}</div>`;
    return `<div class="dgrid">
      ${inp('Activity ID', 'id', 'text', a.id)}${inp('Name', 'name', 'text', a.name, 'style="grid-column:span 5"')}
      ${inp('Duration (d)', 'dur', 'number', a.dur, 'min="0" step="1"')}${inp('% complete', 'pct', 'number', a.pct || 0, 'min="0" max="100" step="5"' + (a.pctType === 'physical' && a.steps ? ' readonly title="Calculated from the activity’s steps"' : ''))}
      ${inp('Actual start', 'actualStart', 'date', a.actualStart || '')}${inp('Actual finish', 'actualFinish', 'date', a.actualFinish || '')}
      <label>Constraint</label><select data-k="ctype">${CSTR.map(([k, l]) => `<option value="${k}" ${(a.constraint?.type || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${inp('Constraint date', 'cdate', 'date', a.constraint?.date || '')}
      ${inp('Fixed cost', 'cost', 'number', a.cost || 0, 'min="0" step="100"')}${inp('Actual cost', 'actualCost', 'number', a.actualCost || 0, 'min="0" step="100"')}
      <label>% complete type</label><select data-k="pctType"><option value="">Duration</option><option value="physical" ${a.pctType === 'physical' ? 'selected' : ''}>Physical${a.steps ? ' (from steps)' : ''}</option></select>
      ${a.pctType === 'physical' ? inp('Remaining dur (d)', 'remaining', 'number', a.remaining ?? '', `min="0" step="1" placeholder="${Math.ceil(a.dur * (1 - (a.pct || 0) / 100))}"`) : ro('Remaining dur', (x.status === 'done' ? 0 : x.status === 'active' ? x.ef - Math.max(x.es, A.S.dataIdx) : a.dur) + ' d')}
      ${(A.P.codes || []).map(c => `<label>${esc(c.name)}</label><select data-code="${esc(c.id)}"><option value=""></option>${c.values.map(v => `<option value="${esc(v.v)}" ${(a.codes || {})[c.id] === v.v ? 'selected' : ''}>${esc(v.v)}${v.d ? ' — ' + esc(v.d) : ''}</option>`).join('')}</select>`).join('')}
      ${ro('Early start', x.start)}${ro('Early finish', x.finish)}${ro('Late start', x.lateStart)}${ro('Late finish', x.lateFinish)}
      ${ro('Total float', (x.tf ?? '') + ' d', x.tf < 0 ? 'neg' : '')}${ro('Free float', (x.ff ?? '') + ' d')}${ro('Status', { done: 'Completed', active: 'In progress', planned: 'Not started' }[x.status] + (x.critical ? ' · <span class="neg">critical</span>' : '') + (x.longest ? ' · longest path' : ''))}${ro('Budget', money(C.budgetOf(A.P, a)))}
      ${v ? ro('BL start var.', fmtVar(v.start)) + ro('BL finish var.', fmtVar(v.finish)) + ro('BL duration', bl.acts[a.id].dur + ' d') + ro('Leveling', a.leveledStart ? 'Delayed to ' + a.leveledStart : '—') : ro('Leveling', a.leveledStart ? 'Delayed to ' + a.leveledStart : '—')}
      <label>Notes</label><textarea data-k="notes" rows="2" class="wide">${esc(a.notes || '')}</textarea>
    </div>`;
  }
  const fmtVar = d => d == null ? '—' : d === 0 ? 'on baseline' : d > 0 ? `<span class="pos">${d} d ahead</span>` : `<span class="neg">${-d} d late</span>`;
  function rollBudget(s) { const i = A.P.activities.indexOf(s), lv = s.level || 0; let t = 0; for (let j = i + 1; j < A.P.activities.length && (A.P.activities[j].level || 0) > lv; j++) if (!A.S.summary[j]) t += C.budgetOf(A.P, A.P.activities[j]); return t; }

  function bindGeneral() {
    body.querySelectorAll('[data-k]').forEach(inp => inp.addEventListener('change', () => {
      const k = inp.dataset.k, v = inp.value, id = A.cur;
      if (k === 'id') { const nv = v.trim(); if (!nv || A.P.activities.some(a => a.id === nv)) { Aero.toast(nv ? 'That ID is already used.' : 'ID can’t be empty.'); render(); return; } return A.renameId(id, nv); }
      A.commit('Edit ' + k, P => {
        const a = P.activities.find(x => x.id === id); if (!a) return;
        if (k === 'dur') a.dur = Math.max(0, Math.round(+v || 0));
        else if (k === 'pct') { a.pct = Math.max(0, Math.min(100, +v || 0)); if (a.pct > 0 && !a.actualStart) a.actualStart = A.S.results.get(id).start; if (a.pct >= 100 && !a.actualFinish) a.actualFinish = A.S.results.get(id).finish; if (a.pct < 100) a.actualFinish = null; }
        else if (k === 'ctype' || k === 'cdate') { const t = k === 'ctype' ? v : a.constraint?.type || 'SNET', d = k === 'cdate' ? v : a.constraint?.date || A.S.results.get(id).start; a.constraint = t ? { type: t, date: d } : null; }
        else if (k === 'cost' || k === 'actualCost') a[k] = +v || 0;
        else if (k === 'pctType') { a.pctType = v || null; if (v === 'physical' && a.steps) syncSteps(a, id); }
        else if (k === 'remaining') a.remaining = v === '' ? null : Math.max(0, Math.round(+v || 0));
        else if (k === 'actualFinish') { a.actualFinish = v || null; if (v) { a.pct = 100; if (!a.actualStart) a.actualStart = A.S.results.get(id).start; } }
        else a[k] = v || (k === 'name' ? a.name : null);
      });
    }));
  }

  function bindCodes() {
    body.querySelectorAll('[data-code]').forEach(el => el.addEventListener('change', () => { const id = A.cur, c = el.dataset.code;
      A.commit('Set activity code', P => { const a = P.activities.find(x => x.id === id); if (!a) return; a.codes = a.codes || {}; if (el.value) a.codes[c] = el.value; else delete a.codes[c]; }); }));
  }

  // ---------- steps ----------
  // keep % complete and actual dates in step with the weighted steps of a Physical activity
  function syncSteps(a, id) {
    if (a.pctType !== 'physical' || !a.steps || !a.steps.length) return;
    const pct = C.stepsPct(a.steps), x = A.S.results.get(id) || {};
    a.pct = pct; if (pct > 0 && !a.actualStart) a.actualStart = x.start; if (pct >= 100 && !a.actualFinish) a.actualFinish = x.finish; if (pct < 100) a.actualFinish = null;
  }
  function steps() {
    const a = cur(); if (!a || A.S.summary[A.P.activities.indexOf(a)]) return `<div class="empty">Select an activity (not a WBS row) to list its steps.</div>`;
    const st = a.steps || [], phys = a.pctType === 'physical', tot = C.stepsPct(st), W = st.reduce((t, x) => t + (+x.weight || 0), 0);
    return `<div class="stepbar"><b>${esc(a.id)} — ${esc(a.name)}</b><label>% complete type <select id="spt"><option value="">Duration</option><option value="physical" ${phys ? 'selected' : ''}>Physical</option></select></label>
      ${st.length ? `<span>Steps complete: <b>${tot}%</b>${phys ? '' : ' <span class="dim">— steps set % complete only with the Physical type</span>'}</span>` : '<span class="dim">Break the work into weighted steps; with the Physical type their progress becomes the activity’s % complete.</span>'}</div>
      <table class="mini steps"><tr><th style="width:26px">#</th><th>Step</th><th style="width:70px">Weight</th><th style="width:80px">% complete</th><th style="width:44px">Done</th><th style="width:60px">Share</th><th style="width:150px"></th></tr>` +
      st.map((x, i) => `<tr><td class="num">${i + 1}</td><td><input data-si="${i}" data-f="name" value="${esc(x.name)}"></td><td><input data-si="${i}" data-f="weight" type="number" min="0" step="1" value="${x.weight}"></td>
        <td><input data-si="${i}" data-f="pct" type="number" min="0" max="100" step="5" value="${x.pct}"></td><td style="text-align:center"><input data-si="${i}" data-f="done" type="checkbox" ${x.pct >= 100 ? 'checked' : ''}></td>
        <td class="num">${W ? Math.round(100 * (+x.weight || 0) / W) : Math.round(100 / st.length)}%</td><td><button class="aero-btn small" data-smv="${i}" data-d="-1" ${i ? '' : 'disabled'}>↑</button> <button class="aero-btn small" data-smv="${i}" data-d="1" ${i < st.length - 1 ? '' : 'disabled'}>↓</button> <button class="aero-btn small" data-sdel="${i}">Remove</button></td></tr>`).join('') +
      `<tr><td colspan="7"><button class="aero-btn small" id="sadd">+ Add step</button></td></tr></table>`;
  }
  function bindSteps() {
    const id = A.cur;
    const edit = (label, fn) => A.commit(label, P => { const a = P.activities.find(x => x.id === id); if (!a) return; fn(a); syncSteps(a, id); });
    const spt = document.getElementById('spt'); if (spt) spt.onchange = () => edit('% complete type', a => { a.pctType = spt.value || null; });
    body.querySelectorAll('[data-si]').forEach(el => el.addEventListener('change', () => edit('Edit step', a => { const x = a.steps[+el.dataset.si], f = el.dataset.f;
      if (f === 'name') x.name = el.value || x.name; else if (f === 'done') x.pct = el.checked ? 100 : 0; else if (f === 'weight') x.weight = Math.max(0, +el.value || 0); else x.pct = Math.max(0, Math.min(100, +el.value || 0)); })));
    body.querySelectorAll('[data-sdel]').forEach(el => el.onclick = () => edit('Remove step', a => { a.steps.splice(+el.dataset.sdel, 1); if (!a.steps.length) delete a.steps; }));
    body.querySelectorAll('[data-smv]').forEach(el => el.onclick = () => edit('Move step', a => { const i = +el.dataset.smv, j = i + +el.dataset.d; if (j < 0 || j >= a.steps.length) return; [a.steps[i], a.steps[j]] = [a.steps[j], a.steps[i]]; }));
    const add = document.getElementById('sadd'); if (add) add.onclick = () => {
      const first = !(cur().steps || []).length && cur().pctType !== 'physical';
      edit('Add step', a => { (a.steps = a.steps || []).push({ name: 'Step ' + (a.steps.length + 1), weight: 1, pct: 0 }); if (first) a.pctType = 'physical'; });
      if (first) Aero.toast('% complete type set to Physical — progress now comes from the steps.');
      setTimeout(() => { const ins = body.querySelectorAll('[data-f="name"]'); const last = ins[ins.length - 1]; if (last) { last.focus(); last.select(); } });
    };
  }

  // ---------- activity codes dictionary ----------
  let codeSel = null;
  function codes() {
    const list = A.P.codes || [];
    if (!list.some(c => c.id === codeSel)) codeSel = list.length ? list[0].id : null;
    const c = list.find(x => x.id === codeSel);
    const sel = [...A.sel].map(id => A.P.activities.find(a => a.id === id)).filter((a, k) => a && !A.S.summary[A.P.activities.indexOf(a)]);
    const used = (cid, v) => A.P.activities.filter(a => a.codes && a.codes[cid] === v).length;
    const types = `<table class="mini"><tr><th style="width:90px">Code ID</th><th>Name</th><th style="width:50px">Values</th><th style="width:150px"></th></tr>` +
      list.map((x, i) => `<tr class="${x.id === codeSel ? 'csel' : ''}"><td><input data-ci="${i}" data-f="id" value="${esc(x.id)}"></td><td><input data-ci="${i}" data-f="name" value="${esc(x.name)}"></td><td class="num">${x.values.length}</td>
        <td><button class="aero-btn small" data-cpick="${esc(x.id)}">Values →</button> <button class="aero-btn small" data-cdel="${i}">Delete</button></td></tr>`).join('') +
      `<tr><td colspan="4"><button class="aero-btn small" id="cadd">+ Add code</button></td></tr></table>`;
    const vals = c ? `<table class="mini"><tr><th style="width:90px">${esc(c.name)} value</th><th>Description</th><th style="width:60px">Activities</th><th style="width:70px"></th></tr>` +
      c.values.map((v, j) => `<tr><td><input data-vi="${j}" data-f="v" value="${esc(v.v)}"></td><td><input data-vi="${j}" data-f="d" value="${esc(v.d)}"></td><td class="num">${used(c.id, v.v)}</td><td><button class="aero-btn small" data-vdel="${j}">Delete</button></td></tr>`).join('') +
      `<tr><td colspan="4"><button class="aero-btn small" id="vadd">+ Add value</button></td></tr></table>` : '<div class="empty">Add a code (e.g. Responsibility, Area, Phase) to tag and group activities.</div>';
    const assign = list.length ? `<div class="stepbar"><b>Assign to ${sel.length} selected activit${sel.length === 1 ? 'y' : 'ies'}</b>${list.map(x => `<label>${esc(x.name)} <select data-assign="${esc(x.id)}" ${sel.length ? '' : 'disabled'}><option value="">— keep —</option><option value="\u0000">(clear)</option>${x.values.map(v => `<option value="${esc(v.v)}">${esc(v.v)}</option>`).join('')}</select></label>`).join('')}
      <button class="aero-btn small" id="cgroup" style="margin-left:auto">Group activities by code…</button></div>` : '';
    return assign + `<div class="cols2"><div>${types}</div><div>${vals}</div></div>`;
  }
  function bindCodesTab() {
    const uniq = (base, taken) => { let k = 1; while (taken.has(base + k)) k++; return base + k; };
    body.querySelectorAll('[data-ci]').forEach(el => el.addEventListener('change', () => { const i = +el.dataset.ci, f = el.dataset.f;
      if (f === 'id') { const nv = el.value.trim().slice(0, 20), old = A.P.codes[i].id; if (!nv || A.P.codes.some((x, k) => k !== i && x.id === nv)) { Aero.toast(nv ? 'That code ID is already used.' : 'Code ID can’t be empty.'); Panels.render(); return; }
        if (codeSel === old) codeSel = nv; if (A.view.groupBy === old) A.view.groupBy = nv;
        A.commit('Rename code', P => { P.codes[i].id = nv; P.activities.forEach(a => { if (a.codes && a.codes[old] != null) { a.codes[nv] = a.codes[old]; delete a.codes[old]; } }); }); }
      else A.commit('Rename code', P => { P.codes[i].name = el.value.slice(0, 60) || P.codes[i].name; }); }));
    body.querySelectorAll('[data-cpick]').forEach(el => el.onclick = () => { codeSel = el.dataset.cpick; Panels.render(); });
    body.querySelectorAll('[data-cdel]').forEach(el => el.onclick = async () => { const c = A.P.codes[+el.dataset.cdel];
      if (!await Aero.confirm('Delete activity code', `Delete “${c.name}” and remove it from every activity?`)) return;
      A.commit('Delete code', P => { P.codes.splice(+el.dataset.cdel, 1); P.activities.forEach(a => { if (a.codes) delete a.codes[c.id]; }); }); });
    const cadd = document.getElementById('cadd'); if (cadd) cadd.onclick = () => { const id = uniq('CODE', new Set((A.P.codes || []).map(c => c.id))); codeSel = id; A.commit('Add code', P => { (P.codes = P.codes || []).push({ id, name: 'New code', values: [] }); }); };
    const ci = (A.P.codes || []).findIndex(c => c.id === codeSel);
    body.querySelectorAll('[data-vi]').forEach(el => el.addEventListener('change', () => { const j = +el.dataset.vi, f = el.dataset.f, c = A.P.codes[ci];
      if (f === 'v') { const nv = el.value.trim().slice(0, 40), old = c.values[j].v; if (!nv || c.values.some((x, k) => k !== j && x.v === nv)) { Aero.toast(nv ? 'That value already exists.' : 'Value can’t be empty.'); Panels.render(); return; }
        A.commit('Rename code value', P => { P.codes[ci].values[j].v = nv; P.activities.forEach(a => { if (a.codes && a.codes[c.id] === old) a.codes[c.id] = nv; }); }); }
      else A.commit('Edit code value', P => { P.codes[ci].values[j].d = el.value.slice(0, 120); }); }));
    body.querySelectorAll('[data-vdel]').forEach(el => el.onclick = () => { const c = A.P.codes[ci], v = c.values[+el.dataset.vdel].v;
      A.commit('Delete code value', P => { P.codes[ci].values.splice(+el.dataset.vdel, 1); P.activities.forEach(a => { if (a.codes && a.codes[c.id] === v) delete a.codes[c.id]; }); }); });
    const vadd = document.getElementById('vadd'); if (vadd) vadd.onclick = () => { const c = A.P.codes[ci]; const v = uniq('V', new Set(c.values.map(x => x.v))); A.commit('Add code value', P => P.codes[ci].values.push({ v, d: '' })); };
    body.querySelectorAll('[data-assign]').forEach(el => el.addEventListener('change', () => { if (!el.value) return; const cid = el.dataset.assign, v = el.value, ids = new Set(A.sel);
      A.commit('Assign activity code', P => P.activities.forEach((a, i) => { if (!ids.has(a.id) || A.S.summary[i]) return; a.codes = a.codes || {}; if (v === '\u0000') delete a.codes[cid]; else a.codes[cid] = v; }));
      Aero.toast(v === '\u0000' ? 'Code cleared.' : `${v} assigned to ${[...ids].length} activit${ids.size === 1 ? 'y' : 'ies'}.`); }));
    const cg = document.getElementById('cgroup'); if (cg) cg.onclick = () => A.setGroupBy(codeSel);
  }

  // ---------- schedule quality check ----------
  function check() {
    if (A.S.error) return `<div class="neg" style="padding:10px">${esc(A.S.error)}</div>`;
    const r = C.dcma(A.P, A.S, A.baseline()); if (!r) return '';
    const fmt = c => c.value == null ? '—' : c.unit === '%' ? (+c.value).toFixed(1) + '%' : (c.key === 'cpli' || c.key === 'bei') ? (+c.value).toFixed(2) : c.unit === ' d' ? (c.value > 0 ? '+' : '') + c.value + ' d' : String(c.value);
    const badge = c => c.pass === true ? '<span class="ok">✔ Pass</span>' : c.pass === false ? '<span class="bad">✖ Fail</span>' : '<span class="dim">n/a</span>';
    const chips = c => c.ids.slice(0, 10).map(id => `<a class="chip" data-goto="${esc(id)}">${esc(id)}</a>`).join('') + (c.ids.length > 10 ? `<span class="dim"> +${c.ids.length - 10} more</span>` : '');
    return `<div class="stepbar"><b>DCMA 14-point assessment</b><span><span class="ok">${r.passed} passed</span> · <span class="${r.failed ? 'bad' : 'dim'}">${r.failed} failed</span> · <span class="dim">${r.na} not applicable</span></span>
      <span class="dim">${A.baseline() ? 'Baseline: ' + esc(A.baseline().name) : 'Checks 11 and 14 need a baseline.'} · data date ${A.P.dataDate || A.P.start}</span></div>
      <table class="mini dcma"><tr><th style="width:24px">#</th><th style="width:230px">Check</th><th style="width:70px">Result</th><th style="width:66px">Target</th><th style="width:60px"></th><th>Details</th><th style="width:300px">Activities</th></tr>` +
      r.checks.map(c => `<tr class="${c.pass === false ? 'fail' : ''}"><td class="num">${c.n}</td><td>${esc(c.name)}</td><td class="num">${fmt(c)}</td><td>${esc(c.threshold)}</td><td>${badge(c)}</td><td class="dim">${esc(c.note || '')}</td><td>${chips(c)}</td></tr>`).join('') + '</table>';
  }
  function bindCheck() {
    body.querySelectorAll('[data-goto]').forEach(el => el.onclick = () => { const id = el.dataset.goto;
      if (!A.rows.some(r => r.id === id)) { A.view.filter = ''; document.getElementById('filter').value = ''; A.view.critOnly = false; document.getElementById('critOnly').checked = false; A.view.lookahead = 0; A.collapsed.clear(); A.rebuild(); }
      A.select(id); const row = document.querySelector(`.prow[data-id="${CSS.escape(id)}"]`); if (row) row.scrollIntoView({ block: 'center' }); Gantt.scrollToDate(A.S.results.get(id).start); });
  }

  function rel() {
    const a = cur(); if (!a || A.S.summary[A.P.activities.indexOf(a)]) return `<div class="empty">Select an activity (not a WBS row) to edit its relationships.</div>`;
    const opts = sel => A.P.activities.filter((x, i) => !A.S.summary[i] && x.id !== a.id).map(x => `<option value="${esc(x.id)}" ${x.id === sel ? 'selected' : ''}>${esc(x.id)} — ${esc(x.name)}</option>`).join('');
    const table = (list, side) => `<table class="mini"><tr><th>${side === 'pred' ? 'Predecessor' : 'Successor'}</th><th style="width:70px">Type</th><th style="width:60px">Lag (d)</th><th>Driving</th><th></th></tr>` +
      list.map(({ l, i }) => { const other = side === 'pred' ? l.from : l.to; const o = A.P.activities.find(x => x.id === other);
        return `<tr class="${l._driving ? 'drv' : ''}"><td>${esc(other)} — ${esc(o?.name)}</td><td><select data-li="${i}" data-f="type">${['FS', 'SS', 'FF', 'SF'].map(t => `<option ${t === (l.type || 'FS') ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><input data-li="${i}" data-f="lag" type="number" step="1" value="${l.lag || 0}"></td><td>${l._driving ? 'Yes' : ''}</td><td><button class="aero-btn small" data-del="${i}">Remove</button></td></tr>`; }).join('') +
      `<tr><td colspan="5"><select data-add="${side}" style="width:100%"><option value="">+ Add ${side === 'pred' ? 'predecessor' : 'successor'}…</option>${opts()}</select></td></tr></table>`;
    const withIdx = A.P.links.map((l, i) => ({ l: (A.S.links || []).find(s => s.from === l.from && s.to === l.to) || l, i }));
    return `<div class="cols2"><div>${table(withIdx.filter(o => o.l.to === a.id), 'pred')}</div><div>${table(withIdx.filter(o => o.l.from === a.id), 'succ')}</div></div>`;
  }
  function bindRel() {
    body.querySelectorAll('[data-li]').forEach(el => el.addEventListener('change', () => A.commit('Edit relationship', P => { const l = P.links[+el.dataset.li]; if (el.dataset.f === 'type') l.type = el.value; else l.lag = Math.round(+el.value || 0); })));
    body.querySelectorAll('[data-del]').forEach(el => el.addEventListener('click', () => A.commit('Remove relationship', P => P.links.splice(+el.dataset.del, 1))));
    body.querySelectorAll('[data-add]').forEach(el => el.addEventListener('change', () => { if (!el.value) return; el.dataset.add === 'pred' ? A.addLink(el.value, A.cur, 'FS', 0) : A.addLink(A.cur, el.value, 'FS', 0); }));
  }

  function asg() {
    const a = cur(); if (!a || A.S.summary[A.P.activities.indexOf(a)]) return `<div class="empty">Select an activity (not a WBS row) to assign resources.</div>`;
    const res = A.P.resources || [];
    if (!res.length) return `<div class="empty">No resources yet — add some on the <b>Resource list</b> tab.</div>`;
    const rate = id => (res.find(r => r.id === id) || {}).rate || 0;
    return `<table class="mini"><tr><th>Resource</th><th style="width:90px">Units / day</th><th style="width:90px">Total units</th><th style="width:110px">Budget</th><th></th></tr>` +
      (a.resources || []).map((r, i) => `<tr><td><select data-ai="${i}" data-f="res">${res.map(x => `<option value="${esc(x.id)}" ${x.id === r.res ? 'selected' : ''}>${esc(x.id)} — ${esc(x.name)}</option>`).join('')}</select></td>
        <td><input data-ai="${i}" data-f="units" type="number" min="0" step="0.25" value="${r.units}"></td><td class="num">${(r.units * a.dur).toFixed(2)}</td><td class="num">${money(r.units * a.dur * rate(r.res))}</td><td><button class="aero-btn small" data-adel="${i}">Remove</button></td></tr>`).join('') +
      `<tr><td colspan="5"><select data-aadd style="width:100%"><option value="">+ Assign resource…</option>${res.map(x => `<option value="${esc(x.id)}">${esc(x.id)} — ${esc(x.name)}</option>`).join('')}</select></td></tr></table>`;
  }
  function bindAsg() {
    const id = A.cur;
    body.querySelectorAll('[data-ai]').forEach(el => el.addEventListener('change', () => A.commit('Edit assignment', P => { const r = P.activities.find(a => a.id === id).resources[+el.dataset.ai]; if (el.dataset.f === 'res') r.res = el.value; else r.units = Math.max(0, +el.value || 0); })));
    body.querySelectorAll('[data-adel]').forEach(el => el.addEventListener('click', () => A.commit('Remove assignment', P => P.activities.find(a => a.id === id).resources.splice(+el.dataset.adel, 1))));
    const add = body.querySelector('[data-aadd]'); if (add) add.addEventListener('change', () => add.value && A.commit('Assign resource', P => { const a = P.activities.find(a => a.id === id); (a.resources = a.resources || []).push({ res: add.value, units: 1 }); }));
  }

  let usageRes = null;
  function usage() {
    const res = A.P.resources || []; if (!res.length) return `<div class="empty">No resources defined.</div>`;
    if (!res.some(r => r.id === usageRes)) usageRes = res[0].id;
    const over = C.overallocations(A.P, A.S);
    return `<div class="usage"><div class="bar"><label>Resource <select id="ures">${res.map(r => `<option value="${esc(r.id)}" ${r.id === usageRes ? 'selected' : ''}>${esc(r.id)} — ${esc(r.name)}</option>`).join('')}</select></label>
      <span class="dim">Bars = units booked per day · line = max available</span><span style="margin-left:auto">${over.length ? `<span class="neg">Overallocated: ${over.map(o => `${esc(o.res)} (${o.days} d, peak ${+o.peak.toFixed(2)})`).join(', ')}</span> <button class="aero-btn small" id="ulev">Level resources</button>` : '<span class="pos">No overallocation</span>'}</span></div><canvas id="ucv"></canvas></div>`;
  }
  function drawUsage() {
    const cv = document.getElementById('ucv'); if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1; cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    const res = (A.P.resources || []).find(r => r.id === usageRes); if (!res) return;
    const use = C.resourceUsage(A.P, A.S).get(res.id) || [];
    const left = document.getElementById('tableWrap').offsetWidth + 5 - Gantt.scrollLeft(); // align with the Gantt time scale
    const top = 8, bot = h - 18, peak = Math.max(res.max || 1, ...use, 1) * 1.15, yv = v => bot - (bot - top) * v / peak;
    g.font = '11px Segoe UI, Tahoma, sans-serif'; g.fillStyle = '#5b6b7c'; g.textBaseline = 'middle';
    for (let v = 0; v <= peak; v += Math.max(0.25, Math.ceil(peak / 4 * 4) / 16)) { g.strokeStyle = '#eef2f6'; g.beginPath(); g.moveTo(0, yv(v) + .5); g.lineTo(w, yv(v) + .5); g.stroke(); }
    const cal = A.S.cal;
    for (let d = 0; d < use.length; d++) {
      if (!use[d]) continue; const s = cal.date(d), x = left + Gantt.xOf(s); if (x > w || x + A.ppd < 0) continue;
      g.fillStyle = use[d] > (res.max ?? Infinity) + 1e-9 ? '#d23a3a' : '#4a8fd6'; g.fillRect(x + (A.ppd > 4 ? 1 : 0), yv(use[d]), Math.max(1, A.ppd - (A.ppd > 4 ? 2 : 0)), bot - yv(use[d]));
    }
    g.strokeStyle = '#c81e2a'; g.setLineDash([5, 3]); g.beginPath(); g.moveTo(0, yv(res.max) + .5); g.lineTo(w, yv(res.max) + .5); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#fff'; g.fillRect(0, 0, 150, h); g.fillStyle = '#1e395b'; g.font = '600 12px Segoe UI, Tahoma, sans-serif'; g.fillText(res.name, 10, 16);
    g.font = '11px Segoe UI, Tahoma, sans-serif'; g.fillStyle = '#5b6b7c'; g.fillText(`max ${res.max} / day`, 10, 32); g.fillText(`peak ${+Math.max(0, ...use).toFixed(2)} / day`, 10, 47);
    g.fillText(`${use.reduce((s, v) => s + v, 0).toFixed(1)} unit-days`, 10, 62);
  }
  function bindUsage() {
    const s = document.getElementById('ures'); if (s) s.onchange = () => { usageRes = s.value; drawUsage(); };
    const b = document.getElementById('ulev'); if (b) b.onclick = () => A.levelResources();
    requestAnimationFrame(drawUsage);
  }

  function reslist() {
    const res = A.P.resources || [];
    return `<table class="mini"><tr><th style="width:90px">ID</th><th>Name</th><th style="width:110px">Max units / day</th><th style="width:110px">Rate / day ($)</th><th style="width:80px">Assigned to</th><th></th></tr>` +
      res.map((r, i) => `<tr><td><input data-ri="${i}" data-f="id" value="${esc(r.id)}"></td><td><input data-ri="${i}" data-f="name" value="${esc(r.name)}"></td>
        <td><input data-ri="${i}" data-f="max" type="number" min="0" step="0.5" value="${r.max ?? 1}"></td><td><input data-ri="${i}" data-f="rate" type="number" min="0" step="10" value="${r.rate || 0}"></td>
        <td class="num">${A.P.activities.filter(a => (a.resources || []).some(x => x.res === r.id)).length}</td><td><button class="aero-btn small" data-rdel="${i}">Delete</button></td></tr>`).join('') +
      `<tr><td colspan="6"><button class="aero-btn small" id="radd">+ Add resource</button></td></tr></table>`;
  }
  function bindRes() {
    body.querySelectorAll('[data-ri]').forEach(el => el.addEventListener('change', () => {
      const i = +el.dataset.ri, f = el.dataset.f;
      A.commit('Edit resource', P => { const r = P.resources[i];
        if (f === 'id') { const nv = el.value.trim(); if (!nv || P.resources.some((x, k) => k !== i && x.id === nv)) return; P.activities.forEach(a => (a.resources || []).forEach(x => x.res === r.id && (x.res = nv))); r.id = nv; }
        else if (f === 'name') r.name = el.value; else r[f] = Math.max(0, +el.value || 0); });
    }));
    body.querySelectorAll('[data-rdel]').forEach(el => el.addEventListener('click', async () => {
      const r = A.P.resources[+el.dataset.rdel]; if (!await Aero.confirm('Delete resource', `Delete ${r.name}? Its assignments are removed too.`)) return;
      A.commit('Delete resource', P => { P.resources.splice(+el.dataset.rdel, 1); P.activities.forEach(a => a.resources = (a.resources || []).filter(x => x.res !== r.id)); });
    }));
    const add = document.getElementById('radd'); if (add) add.onclick = () => A.commit('Add resource', P => { let k = (P.resources = P.resources || []).length + 1; while (P.resources.some(r => r.id === 'R' + k)) k++; P.resources.push({ id: 'R' + k, name: 'New resource', max: 1, rate: 0 }); });
  }

  function ev() {
    const bl = A.baseline();
    const e = C.earnedValue(A.P, A.S, bl);
    if (!e.BAC) return `<div class="empty">Earned value needs costs: give resources a daily rate (Resource list) or activities a fixed cost.</div>`;
    const row = (k, v, ex, cls = '') => `<b>${k}</b><span class="num ${cls}">${v}</span><span class="ex">${ex}</span>`;
    return `<div class="evgrid"><div class="kv">
      ${row('BAC', money(e.BAC), 'budget at completion')}${row('PV', money(e.PV), 'planned value at data date')}${row('EV', money(e.EV), 'earned value (budget × % complete)')}${row('AC', money(e.AC), 'actual cost entered')}
      ${row('SV', money(e.SV), 'schedule variance', e.SV < 0 ? 'neg' : 'pos')}${row('CV', money(e.CV), 'cost variance', e.CV < 0 ? 'neg' : 'pos')}
      ${row('SPI', ratio(e.SPI), '< 1 is behind schedule', e.SPI != null && e.SPI < 1 ? 'neg' : 'pos')}${row('CPI', ratio(e.CPI), '< 1 is over budget', e.CPI != null && e.CPI < 1 ? 'neg' : 'pos')}
      ${row('EAC', money(e.EAC), 'estimate at completion')}${row('ETC', money(e.ETC), 'estimate to complete')}${row('VAC', money(e.VAC), 'variance at completion', e.VAC < 0 ? 'neg' : 'pos')}
      <span class="ex" style="grid-column:span 3;margin-top:4px">${bl ? 'Planned value from baseline “' + esc(bl.name) + '”.' : 'No baseline selected — planned value uses current dates. Save a baseline for real tracking.'} Data date: ${A.P.dataDate || A.P.start}.</span>
    </div><canvas id="evcv"></canvas></div>`;
  }
  function drawEV() {
    const cv = document.getElementById('evcv'); if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1; cv.width = w * dpr; cv.height = h * dpr;
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    const e = C.earnedValue(A.P, A.S, A.baseline()), n = e.pvCurve.length, L = 64, R = w - 12, T = 12, B = h - 22;
    const max = Math.max(e.BAC, e.EAC, e.AC) * 1.05 || 1, X = d => L + (R - L) * d / Math.max(1, n - 1), Y = v => B - (B - T) * v / max;
    g.font = '11px Segoe UI, Tahoma, sans-serif'; g.textBaseline = 'middle'; g.fillStyle = '#5b6b7c'; g.textAlign = 'right';
    for (let k = 0; k <= 4; k++) { const v = max * k / 4; g.strokeStyle = '#eef2f6'; g.beginPath(); g.moveTo(L, Y(v) + .5); g.lineTo(R, Y(v) + .5); g.stroke(); g.fillText(money(v), L - 6, Y(v)); }
    g.textAlign = 'left';
    g.strokeStyle = '#2d78c4'; g.lineWidth = 2; g.beginPath(); e.pvCurve.forEach((v, d) => d ? g.lineTo(X(d + 1), Y(v)) : g.moveTo(X(0), Y(0))); g.stroke(); g.lineWidth = 1;
    const dx = X(e.dataIdx);
    g.strokeStyle = '#1f6fd0'; g.setLineDash([5, 3]); g.beginPath(); g.moveTo(dx, T); g.lineTo(dx, B); g.stroke(); g.setLineDash([]);
    const dot = (v, c, lab, dy) => { g.fillStyle = c; g.beginPath(); g.arc(dx, Y(v), 5, 0, 7); g.fill(); g.fillText(lab, dx + 8, Y(v) + dy); };
    const near = Math.abs(Y(e.EV) - Y(e.AC)) < 13, up = e.EV >= e.AC;   // keep the two labels apart
    dot(e.EV, '#2d8a3e', 'EV ' + money(e.EV), near ? (up ? -7 : 7) : 0); dot(e.AC, '#c0141e', 'AC ' + money(e.AC), near ? (up ? 7 : -7) : 0);
    g.fillStyle = '#2d78c4'; g.fillText('PV (S-curve)', L + 6, T + 6);
    g.fillStyle = '#5b6b7c'; g.fillText(A.P.start, L, B + 12); g.textAlign = 'right'; g.fillText(A.S.cal.date(n - 2), R, B + 12); g.textAlign = 'left';
  }

  function bls() {
    const list = A.P.baselines || [];
    return `<div style="margin-bottom:8px"><button class="aero-btn" id="blnew">Save current schedule as baseline…</button> <span class="dim">Baselines freeze dates and budgets so you can compare progress (yellow bars, variance columns, earned value).</span></div>` +
      (list.length ? `<table class="mini"><tr><th>Name</th><th>Saved</th><th>Finish</th><th>Finish variance</th><th></th></tr>` + list.map((b, i) => {
        const fv = A.S.cal.idxFinish(b.finish) - A.S.cal.idxFinish(A.S.finishDate);
        return `<tr><td>${i === A.P.activeBaseline ? '★ ' : ''}${esc(b.name)}</td><td>${esc(b.created.slice(0, 16).replace('T', ' '))}</td><td>${b.finish}</td><td>${fmtVar(fv)}</td>
        <td><button class="aero-btn small" data-bact="${i}">${i === A.P.activeBaseline ? 'Active' : 'Compare'}</button> <button class="aero-btn small" data-bdel="${i}">Delete</button></td></tr>`; }).join('') + '</table>' : '<div class="empty">No baselines yet.</div>');
  }
  function bindBl() {
    document.getElementById('blnew').onclick = () => A.saveBaseline();
    body.querySelectorAll('[data-bact]').forEach(b => b.onclick = () => A.setBaseline(+b.dataset.bact));
    body.querySelectorAll('[data-bdel]').forEach(b => b.onclick = () => A.commit('Delete baseline', P => { const i = +b.dataset.bdel; P.baselines.splice(i, 1); if (P.activeBaseline === i) P.activeBaseline = null; else if (P.activeBaseline > i) P.activeBaseline--; }));
  }

  function log() {
    const S = A.S, P = A.P, lines = [];
    if (S.error) return `<div class="neg" style="padding:10px">${esc(S.error)}</div>`;
    const work = P.activities.filter((a, i) => !S.summary[i]);
    const noPred = work.filter(a => !P.links.some(l => l.to === a.id)), noSucc = work.filter(a => !P.links.some(l => l.from === a.id));
    lines.push(['Project', `${esc(P.name)} · start ${P.start} · finish <b>${S.finishDate}</b> · ${S.finish} working days`]);
    lines.push(['Data date', P.dataDate || '(project start)']);
    lines.push(['Activities', `${work.length} (${work.filter(a => S.results.get(a.id).critical).length} critical, ${work.filter(a => S.results.get(a.id).status === 'done').length} complete, ${work.filter(a => S.results.get(a.id).status === 'active').length} in progress)`]);
    lines.push(['Relationships', String(P.links.length)]);
    lines.push(['Open starts (no predecessor)', noPred.length > 1 ? `<span class="neg">${noPred.length}</span>: ${noPred.map(a => esc(a.id)).join(', ')}` : noPred.map(a => esc(a.id)).join(', ') || '—']);
    lines.push(['Open ends (no successor)', noSucc.length > 1 ? `<span class="neg">${noSucc.length}</span>: ${noSucc.map(a => esc(a.id)).join(', ')}` : noSucc.map(a => esc(a.id)).join(', ') || '—']);
    const neg = work.filter(a => S.results.get(a.id).tf < 0); lines.push(['Negative float', neg.length ? `<span class="neg">${neg.map(a => `${esc(a.id)} (${S.results.get(a.id).tf} d)`).join(', ')}</span>` : '—']);
    const cons = work.filter(a => a.constraint && a.constraint.date); lines.push(['Constraints', cons.map(a => `${esc(a.id)} ${a.constraint.type} ${a.constraint.date}`).join(', ') || '—']);
    const lev = work.filter(a => a.leveledStart); lines.push(['Leveling delays', lev.map(a => `${esc(a.id)} → ${a.leveledStart}`).join(', ') || '—']);
    const over = C.overallocations(P, S); lines.push(['Overallocated resources', over.length ? `<span class="neg">${over.map(o => `${esc(o.res)} ${o.days} d`).join(', ')}</span>` : '—']);
    const late = work.filter(a => !a.actualStart && S.results.get(a.id).es < S.dataIdx); // shouldn't happen, but flags out-of-sequence data
    if (late.length) lines.push(['Out of sequence', late.map(a => esc(a.id)).join(', ')]);
    S.warnings.forEach(w => lines.push(['Warning', `<span class="neg">${esc(w)}</span>`]));
    return `<table class="mini">${lines.map(([k, v]) => `<tr><th style="width:220px">${k}</th><td>${v}</td></tr>`).join('')}</table>`;
  }

  const TABS = { general: [general, () => { bindGeneral(); bindCodes(); }], steps: [steps, bindSteps], codes: [codes, bindCodesTab], check: [check, bindCheck], rel: [rel, bindRel], asg: [asg, bindAsg], usage: [usage, bindUsage], reslist: [reslist, bindRes], ev: [ev, () => requestAnimationFrame(drawEV)], bl: [bls, bindBl], log: [log, () => {}] };

  function render() {
    const active = document.activeElement; if (active && body.contains(active) && active.matches('input,textarea') && !render.force) return; // don't clobber typing
    const [html, bind] = TABS[tab];
    body.className = 'tabbody' + (tab === 'usage' || tab === 'ev' ? ' flush' : '');
    if (tab === 'ev') body.style.padding = '8px 10px';  else body.style.padding = '';
    body.innerHTML = html(); bind();
  }
  function setTab(t) { tab = t; document.querySelectorAll('#tabs .aero-tab').forEach(e => e.classList.toggle('on', e.dataset.t === t)); render.force = true; render(); render.force = false; }
  function attach(app) {
    A = app; body = document.getElementById('tabbody');
    document.querySelectorAll('#tabs .aero-tab').forEach(e => e.onclick = () => setTab(e.dataset.t));
    new ResizeObserver(() => { if (tab === 'usage') drawUsage(); if (tab === 'ev') drawEV(); }).observe(body);
  }
  window.Panels = { attach, render: () => { render.force = true; render(); render.force = false; }, soft: render, setTab, redrawUsage: () => tab === 'usage' && drawUsage() };
})();
