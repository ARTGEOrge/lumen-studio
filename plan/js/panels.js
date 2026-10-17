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
      ${inp('Duration (d)', 'dur', 'number', a.dur, 'min="0" step="1"')}${inp('% complete', 'pct', 'number', a.pct || 0, 'min="0" max="100" step="5"')}
      ${inp('Actual start', 'actualStart', 'date', a.actualStart || '')}${inp('Actual finish', 'actualFinish', 'date', a.actualFinish || '')}
      <label>Constraint</label><select data-k="ctype">${CSTR.map(([k, l]) => `<option value="${k}" ${(a.constraint?.type || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${inp('Constraint date', 'cdate', 'date', a.constraint?.date || '')}
      ${inp('Fixed cost', 'cost', 'number', a.cost || 0, 'min="0" step="100"')}${inp('Actual cost', 'actualCost', 'number', a.actualCost || 0, 'min="0" step="100"')}
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
        else if (k === 'actualFinish') { a.actualFinish = v || null; if (v) { a.pct = 100; if (!a.actualStart) a.actualStart = A.S.results.get(id).start; } }
        else a[k] = v || (k === 'name' ? a.name : null);
      });
    }));
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

  const TABS = { general: [general, bindGeneral], rel: [rel, bindRel], asg: [asg, bindAsg], usage: [usage, bindUsage], reslist: [reslist, bindRes], ev: [ev, () => requestAnimationFrame(drawEV)], bl: [bls, bindBl], log: [log, () => {}] };

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
