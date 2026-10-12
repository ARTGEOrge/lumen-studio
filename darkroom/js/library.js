'use strict';
/* Lumen Darkroom — Library extras: smart collections (rules) and the Dates (calendar) view. */
const Smart = (() => {
  const dayMs = 864e5;
  const fileType = p => p.raw ? 'raw' : /^(jpe?g|jfif)$/.test(p.ext) ? 'jpeg' : p.ext === 'png' ? 'png' : 'other';
  const parseDay = s => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, (m || 1) - 1, d || 1).getTime(); };
  function test(p, r) {
    const e = p.exif, v = r.v, lc = x => String(x || '').toLowerCase(), has = (hay, t) => lc(hay).includes(lc(t));
    switch (r.f) {
      case 'rating': return r.op === '>=' ? p.rating >= v : r.op === '<=' ? p.rating <= v : p.rating === v;
      case 'flag': { const f = p.flag === 1 ? 'pick' : p.flag === -1 ? 'reject' : 'none'; return (f === v) === (r.op === 'is'); }
      case 'label': return ((p.label || '') === v) === (r.op === 'is');
      case 'keyword': return r.op === 'is' ? p.keywords.some(k => lc(k) === lc(v)) : (p.keywords.some(k => has(k, v))) === (r.op === 'contains');
      case 'text': { const hay = [p.name, p.copyName, ...p.keywords, e.make, e.model, e.lens].join(' '); return has(hay, v) === (r.op === 'contains'); }
      case 'camera': return has([e.make, e.model].join(' '), v) === (r.op === 'contains');
      case 'lens': return has(e.lens, v) === (r.op === 'contains');
      case 'iso': case 'focal': case 'aperture': { const x = e[r.f]; if (!x) return false; return r.op === '>=' ? x >= v : x <= v; }
      case 'date': { const t = e.date || p.added; if (r.op === 'is after') return t >= parseDay(v) + dayMs; if (r.op === 'is before') return t < parseDay(v); return t >= Date.now() - v * dayMs; }
      case 'edited': return !!p.edited === (v === 'yes');
      case 'local': return (p.settings.masks.length + p.settings.spots.length > 0) === (v === 'yes');
      case 'filetype': return (fileType(p) === v) === (r.op === 'is');
      case 'copy': return !!p.copyName === (v === 'yes');
    }
    return false;
  }
  function matches(p, smart) { if (!smart.rules.length) return true; return smart.match === 'any' ? smart.rules.some(r => test(p, r)) : smart.rules.every(r => test(p, r)); }
  const count = c => { let n = 0; Cat.photos.forEach(p => { if (matches(p, c.smart)) n++; }); return n; };

  /* ---------- editor ---------- */
  function ruleRow(r) {
    const d = Model.SMART[r.f];
    const fsel = `<select class="sr-f">${Object.entries(Model.SMART).map(([k, x]) => `<option value="${k}"${k === r.f ? ' selected' : ''}>${esc(x.label)}</option>`).join('')}</select>`;
    const osel = `<select class="sr-op">${d.ops.map(o => `<option${o === r.op ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    let val;
    if (d.type === 'enum') val = `<select class="sr-v">${d.values.map(([k, n]) => `<option value="${k}"${k === r.v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
    else if (d.type === 'num' || (d.type === 'date' && r.op === 'in the last (days)')) val = `<input class="sr-v" type="number" value="${esc(r.v)}" min="0" step="any">`;
    else if (d.type === 'date') val = `<input class="sr-v" type="date" value="${esc(r.v)}">`;
    else val = `<input class="sr-v" type="text" value="${esc(r.v)}" spellcheck="false">`;
    return `<div class="srule">${fsel}${osel}${val}<button class="aero-btn small sr-x" title="Remove rule">✕</button></div>`;
  }
  function defaults(f) { const d = Model.SMART[f]; return { f, op: d.ops[0], v: d.type === 'enum' ? d.values[0][0] : d.type === 'num' ? (f === 'rating' ? 3 : 0) : d.type === 'date' ? new Date().toISOString().slice(0, 10) : '' }; }
  function readRules(box) {
    return [...box.querySelectorAll('.srule')].map(row => {
      const f = row.querySelector('.sr-f').value, op = row.querySelector('.sr-op').value, inp = row.querySelector('.sr-v');
      return Model.sanitizeCollection({ smart: { rules: [{ f, op, v: inp.type === 'number' ? +inp.value : inp.value }] } }).smart.rules[0];
    }).filter(Boolean);
  }
  function dialog(existing) {
    const c = existing || { name: 'Smart collection', smart: { match: 'all', rules: [{ f: 'rating', op: '>=', v: 4 }] } };
    const dlg = Aero.dialog({
      title: existing ? 'Edit Smart Collection' : 'New Smart Collection', ok: existing ? 'Save' : 'Create', width: 560,
      instruction: 'A smart collection always contains the photos that match its rules.',
      fields: [{ key: 'name', label: 'Name', type: 'text', value: c.name }, { key: 'match', label: 'Match', type: 'select', value: c.smart.match, options: [['all', 'All of the following rules'], ['any', 'Any of the following rules']] }],
      html: `<div class="srules">${c.smart.rules.map(ruleRow).join('')}</div><div class="btnrow"><button class="aero-btn small" id="sr-add">+ Add rule</button><span class="dim" id="sr-count" style="align-self:center;margin-left:auto"></span></div>`,
      onOK: v => {
        const smart = { match: v.match, rules: readRules(box) }, name = (v.name || 'Smart collection').trim().slice(0, 80);
        if (existing) Cat.updateSmartCollection(existing.id, name, smart); else { const n = Cat.newSmartCollection(name, smart); setSource({ type: 'coll', id: n.id }); }
      }
    });
    const box = dlg.el.querySelector('.srules');
    const live = () => { const sm = { match: dlg.values.match, rules: readRules(box) }; let n = 0; Cat.photos.forEach(p => { if (matches(p, sm)) n++; }); dlg.el.querySelector('#sr-count').textContent = `${n} matching photo${n === 1 ? '' : 's'}`; };
    box.addEventListener('change', e => {
      const row = e.target.closest('.srule'); if (!row) return;
      if (e.target.matches('.sr-f')) { row.outerHTML = ruleRow(defaults(e.target.value)); }
      else if (e.target.matches('.sr-op')) { const f = row.querySelector('.sr-f').value, op = e.target.value; if (Model.SMART[f].type === 'date') row.outerHTML = ruleRow({ f, op, v: op === 'in the last (days)' ? 30 : new Date().toISOString().slice(0, 10) }); }
      live();
    });
    box.addEventListener('input', live);
    box.addEventListener('click', e => { if (e.target.closest('.sr-x')) { e.target.closest('.srule').remove(); live(); } });
    dlg.el.querySelector('#sr-add').onclick = () => { if (box.children.length >= 20) return; box.insertAdjacentHTML('beforeend', ruleRow(defaults('keyword'))); live(); };
    dlg.el.querySelector('select').addEventListener('change', live);
    dlg.el.addEventListener('change', e => { if (e.target.closest('.aero-row')) live(); });
    live();
    return dlg;
  }
  return { matches, count, dialog, test };
})();

const Dates = (() => {
  let year = new Date().getFullYear();
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const keyOf = t => { const d = new Date(t); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); };
  function counts() {
    const m = new Map(), years = new Map();
    Cat.photos.forEach(p => { const t = p.exif.date || p.added, k = keyOf(t); m.set(k, (m.get(k) || 0) + 1); const y = Math.floor(k / 10000); years.set(y, (years.get(y) || 0) + 1); });
    return { m, years };
  }
  function render() {
    const box = $('#dates'); if (!box || box.hidden) return;
    const { m, years } = counts(), ys = [...years.keys()].sort((a, b) => a - b);
    if (ys.length && !years.has(year)) year = ys[ys.length - 1];
    let maxDay = 1, yearTotal = 0, days = 0; m.forEach((n, k) => { if (Math.floor(k / 10000) === year) { maxDay = Math.max(maxDay, n); yearTotal += n; days++; } });
    const sel = S.source.type === 'date' ? S.source : null;
    const heat = n => { const t = Math.log(1 + n) / Math.log(1 + maxDay); return `hsl(${212 - t * 12},${55 + t * 30}%,${88 - t * 46}%)`; };
    let html = `<div class="dt-head"><button class="aero-btn small" data-y="${year - 1}" title="Previous year">◀</button><span class="dt-year">${year}</span><button class="aero-btn small" data-y="${year + 1}" title="Next year">▶</button>
      <span class="dim">${yearTotal} photo${yearTotal === 1 ? '' : 's'} on ${days} day${days === 1 ? '' : 's'}</span><span class="dt-years">${ys.map(y => `<button class="aero-btn small${y === year ? ' on' : ''}" data-y="${y}">${y} <span class="dim">${years.get(y)}</span></button>`).join('')}</span></div><div class="dt-months">`;
    for (let mo = 0; mo < 12; mo++) {
      const first = new Date(year, mo, 1), nd = new Date(year, mo + 1, 0).getDate(), off = (first.getDay() + 6) % 7;
      let mc = 0; for (let d = 1; d <= nd; d++) mc += m.get(year * 10000 + (mo + 1) * 100 + d) || 0;
      html += `<div class="dt-month${mc ? '' : ' empty'}"><div class="dt-mh" data-mo="${mo}" title="Show ${MONTHS[mo]} ${year}">${MONTHS[mo]}<span>${mc || ''}</span></div><div class="dt-grid">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<i>${d}</i>`).join('')}${'<b></b>'.repeat(off)}`;
      for (let d = 1; d <= nd; d++) {
        const k = year * 10000 + (mo + 1) * 100 + d, n = m.get(k) || 0, on = sel && sel.key === k;
        html += n ? `<b class="has${on ? ' on' : ''}" data-k="${k}" style="background:${heat(n)}" title="${new Date(year, mo, d).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} — ${n} photo${n === 1 ? '' : 's'}">${d}<em>${n}</em></b>` : `<b>${d}</b>`;
      }
      html += '</div></div>';
    }
    box.innerHTML = html + '</div>' + (ys.length ? '' : '<div class="dim" style="padding:20px">No photos yet.</div>');
  }
  function showDay(k) {
    const y = Math.floor(k / 10000), mo = Math.floor(k / 100) % 100 - 1, d = k % 100, from = new Date(y, mo, d).getTime();
    setSource({ type: 'date', key: k, from, to: new Date(y, mo, d + 1).getTime(), label: new Date(y, mo, d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) });
    setView('grid');
  }
  function showMonth(mo) { setSource({ type: 'date', key: null, from: new Date(year, mo, 1).getTime(), to: new Date(year, mo + 1, 1).getTime(), label: `${MONTHS[mo]} ${year}` }); setView('grid'); }
  function wire() {
    $('#dates').addEventListener('click', e => {
      const y = e.target.closest('[data-y]'); if (y) { year = +y.dataset.y; render(); return; }
      const k = e.target.closest('[data-k]'); if (k) { showDay(+k.dataset.k); return; }
      const mo = e.target.closest('[data-mo]'); if (mo) showMonth(+mo.dataset.mo);
    });
  }
  return { render, wire, showDay, showMonth, get year() { return year; }, set year(v) { year = v; render(); } };
})();
