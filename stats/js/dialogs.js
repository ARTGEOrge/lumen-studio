// Lumen Stats — dialogs: SPSS-style variable picker (source list → target boxes + options) and the custom dialogs
// (Compute, Recode, Select cases, Sort, Value labels, Missing values). Every dialog remembers its last settings.
(function (root) {
  'use strict';
  const D = root.LData, A = root.LAnalyses, esc = s => Aero.esc(String(s ?? ''));
  const TY = { numeric: '#', string: 'A', date: 'D', categorical: 'C' };
  const memo = {};
  const isNum = m => m.type !== 'string';
  const anyVar = () => true;
  const vlabel = m => m.label ? `${m.name} — ${m.label}` : m.name;

  // block Enter/OK while invalid: returns a function that installs the guard
  function guard(box, check) {
    const okBtn = box.querySelector('.aero-btns [data-a=o]'), err = box.querySelector('.dlg-err');
    const fail = e => { const msg = check(); if (msg) { e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation(); if (err) err.textContent = msg; else Aero.toast(msg); return true; } return false; };
    okBtn.addEventListener('click', fail, true);
    const kh = e => { if (!box.isConnected) { removeEventListener('keydown', kh, true); return; } if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && !e.target.closest?.('.aero-list')) fail(e); };
    addEventListener('keydown', kh, true);
  }

  /* ---------- generic variable picker ----------
     spec: {id, title, instruction, targets:[{key,label,multi,pairs,accept(meta),min,max,sub(tgtEl, state, app)}],
            options:[{title, items:[{key,label,type:'check'|'select'|'number'|'text',value,options,step,min,max,width}]}],
            validate(v, app) → msg|null, run(v, app), width, help} */
  function pick(app, spec) {
    const doc = app.doc, vars = doc.vars;
    const prev = memo[spec.id] || {};
    const state = { targets: {}, opts: {} };
    spec.targets.forEach(t => {
      const names = prev.targets?.[t.key] || [];
      state.targets[t.key] = t.pairs ? names.map(p => p.map(n => vars.findIndex(v => v.name === n))).filter(p => p.every(j => j >= 0))
        : names.map(n => vars.findIndex(v => v.name === n)).filter(j => j >= 0 && t.accept(vars[j]));
    });
    if (spec.init && !prev.targets) spec.init(state, app);
    (spec.options || []).forEach(g => g.items.forEach(it => state.opts[it.key] = prev.opts && it.key in prev.opts ? prev.opts[it.key] : it.value));
    const optHTML = (spec.options || []).length ? `<div class="opts">${spec.options.map(g => `<div class="og">${g.title ? `<b>${esc(g.title)}</b>` : ''}${g.items.map(it => {
      const v = state.opts[it.key];
      if (it.type === 'check') return `<label><input type="checkbox" data-o="${it.key}"${v ? ' checked' : ''}> ${esc(it.label)}</label>`;
      if (it.type === 'select') return `<label>${esc(it.label)} <select data-o="${it.key}">${it.options.map(o => { const [a, b] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(a)}"${String(a) === String(v) ? ' selected' : ''}>${esc(b)}</option>`; }).join('')}</select></label>`;
      return `<label>${esc(it.label)} <input type="${it.type === 'number' ? 'number' : 'text'}" data-o="${it.key}" value="${esc(v ?? '')}"${it.step ? ` step="${it.step}"` : ''}${it.min != null ? ` min="${it.min}"` : ''}${it.max != null ? ` max="${it.max}"` : ''}${it.width ? ` style="width:${it.width}px"` : ''}></label>`;
    }).join('')}</div>`).join('')}</div>` : '';
    const html = `<div class="vp"><div class="src"><input type="search" placeholder="Filter variables…" class="vf"><div class="aero-list sl"></div></div>
      ${spec.targets.map((t, i) => `<button class="mv" data-t="${i}" title="Move the selected variables">▶</button><div class="tgt ${t.multi || t.pairs ? 'multi' : 'single'}" data-t="${i}"><label>${esc(t.label)}</label><div class="aero-list tl" tabindex="0"></div><div class="sub"></div></div>`).join('')}</div>
      ${optHTML}<div class="dlg-err"></div>${spec.help ? `<div class="dnote">${esc(spec.help)}</div>` : ''}`;
    const dlg = Aero.dialog({ title: spec.title, instruction: spec.instruction, html, ok: spec.ok || 'OK', width: spec.width || 640,
      onOK: () => {
        readOpts();
        memo[spec.id] = { targets: Object.fromEntries(spec.targets.map(t => [t.key, t.pairs ? state.targets[t.key].map(p => p.map(j => vars[j].name)) : state.targets[t.key].map(j => vars[j].name)])), opts: { ...state.opts } };
        const v = { ...state.opts }; spec.targets.forEach(t => v[t.key] = t.multi || t.pairs ? state.targets[t.key].slice() : state.targets[t.key][0] ?? null);
        spec.run(v, app);
      } });
    const box = dlg.el; box.classList.add('wide');
    const srcEl = box.querySelector('.sl'), filt = box.querySelector('.vf');
    let srcSel = new Set(), lastClick = -1, pendingPair = null;
    const tEls = [...box.querySelectorAll('.tgt')], tSel = spec.targets.map(() => new Set());
    function readOpts() { box.querySelectorAll('[data-o]').forEach(i => { const k = i.dataset.o, it = spec.options.flatMap(g => g.items).find(x => x.key === k); state.opts[k] = i.type === 'checkbox' ? i.checked : it.type === 'number' ? (i.value === '' ? null : +i.value) : i.value; }); }
    const item = (j, extra = '') => { const m = vars[j]; return `<div class="aero-item${extra}" data-j="${j}" title="${esc(vlabel(m))}"><span class="ty ${m.type}">${TY[m.type]}</span><span class="grow">${esc(m.label ? `${m.label} [${m.name}]` : m.name)}</span></div>`; };
    function renderSrc() {
      const q = filt.value.trim().toLowerCase();
      srcEl.innerHTML = vars.map((m, j) => (!q || m.name.toLowerCase().includes(q) || (m.label || '').toLowerCase().includes(q)) ? item(j, (srcSel.has(j) ? ' sel' : '') + (spec.targets.every(t => !t.accept(m)) ? ' dis' : '')) : '').join('');
    }
    function renderT(i) {
      const t = spec.targets[i], el = tEls[i].querySelector('.tl');
      if (t.pairs) el.innerHTML = state.targets[t.key].map((p, k) => `<div class="aero-item${tSel[i].has(k) ? ' sel' : ''}" data-k="${k}"><span class="grow">${esc(vars[p[0]].name)} – ${esc(vars[p[1]].name)}</span></div>`).join('') + (pendingPair != null && i === spec.targets.findIndex(x => x.pairs) ? `<div class="aero-item" style="color:#888"><span class="grow">${esc(vars[pendingPair].name)} – …</span></div>` : '');
      else el.innerHTML = state.targets[t.key].map((j, k) => item(j, tSel[i].has(k) ? ' sel' : '').replace('data-j', `data-k="${k}" data-j`)).join('');
      const btn = box.querySelectorAll('.mv')[i]; btn.textContent = tSel[i].size ? '◀' : '▶';
      if (t.sub) t.sub(tEls[i].querySelector('.sub'), state, app);
    }
    const renderAll = () => { renderSrc(); spec.targets.forEach((_, i) => renderT(i)); };
    function add(i, js) {
      const t = spec.targets[i], arr = state.targets[t.key];
      if (t.pairs) {
        js.forEach(j => { if (!t.accept(vars[j])) return; if (pendingPair == null) pendingPair = j; else if (pendingPair !== j) { arr.push([pendingPair, j]); pendingPair = null; } });
      } else {
        const ok = js.filter(j => t.accept(vars[j]) && !arr.includes(j));
        if (!ok.length) { const bad = js.find(j => !t.accept(vars[j])); if (bad != null) Aero.toast(`${vars[bad].name} (${vars[bad].type}) can’t be used as “${t.label.replace(/:$/, '')}”.`); return false; }
        if (t.multi) arr.push(...ok); else arr.splice(0, arr.length, ok[0]);
      }
      return true;
    }
    function moveBtn(i) {
      const t = spec.targets[i];
      if (tSel[i].size) { const arr = state.targets[t.key]; [...tSel[i]].sort((a, b) => b - a).forEach(k => arr.splice(k, 1)); tSel[i].clear(); }
      else if (srcSel.size) { add(i, [...srcSel]); srcSel.clear(); }
      renderAll();
    }
    box.querySelectorAll('.mv').forEach(b => b.onclick = () => moveBtn(+b.dataset.t));
    filt.oninput = renderSrc;
    srcEl.addEventListener('mousedown', e => {
      const it = e.target.closest('.aero-item'); if (!it) return; const j = +it.dataset.j;
      spec.targets.forEach((_, i) => tSel[i].clear());
      if (e.shiftKey && lastClick >= 0) { const ids = [...srcEl.querySelectorAll('.aero-item')].map(x => +x.dataset.j), a = ids.indexOf(lastClick), b = ids.indexOf(j); ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(x => srcSel.add(x)); }
      else if (e.ctrlKey) { srcSel.has(j) ? srcSel.delete(j) : srcSel.add(j); lastClick = j; }
      else { srcSel = new Set([j]); lastClick = j; }
      renderAll();
    });
    srcEl.addEventListener('dblclick', e => {
      const it = e.target.closest('.aero-item'); if (!it) return; const j = +it.dataset.j;
      const i = spec.targets.findIndex(t => t.accept(vars[j]) && (t.multi || t.pairs || !state.targets[t.key].length));
      const i2 = i >= 0 ? i : spec.targets.findIndex(t => t.accept(vars[j]));
      if (i2 >= 0) add(i2, [j]); srcSel.clear(); renderAll();
    });
    tEls.forEach((el, i) => {
      const tl = el.querySelector('.tl');
      tl.addEventListener('mousedown', e => { const it = e.target.closest('.aero-item'); if (!it || it.dataset.k == null) return; const k = +it.dataset.k; srcSel.clear(); if (!e.ctrlKey) tSel[i].clear(); tSel[i].has(k) ? tSel[i].delete(k) : tSel[i].add(k); renderAll(); });
      tl.addEventListener('dblclick', e => { const it = e.target.closest('.aero-item'); if (!it || it.dataset.k == null) return; state.targets[spec.targets[i].key].splice(+it.dataset.k, 1); tSel[i].clear(); renderAll(); });
    });
    renderAll();
    guard(box, () => {
      readOpts();
      for (const t of spec.targets) { const n = state.targets[t.key].length; if ((t.min ?? 1) > n) return `Choose ${t.multi || t.pairs ? 'at least ' + (t.min ?? 1) : 'a'} ${t.pairs ? 'pair' + ((t.min ?? 1) > 1 ? 's' : '') : 'variable'} for “${t.label.replace(/:$/, '')}”.`; if (t.max && n > t.max) return `At most ${t.max} variables for “${t.label.replace(/:$/, '')}”.`; }
      if (spec.validate) { const v = { ...state.opts }; spec.targets.forEach(t => v[t.key] = t.multi || t.pairs ? state.targets[t.key] : state.targets[t.key][0] ?? null); return spec.validate(v, app); }
      return null;
    });
    return dlg;
  }

  // level picker for grouping variables (two groups)
  function groupSub(el, state, app, key = 'group') {
    const j = state.targets[key][0];
    if (j == null) { el.innerHTML = ''; return; }
    const lv = app.levels(j);
    if (el.dataset.j === String(j) && el.querySelector('select')) return;
    el.dataset.j = String(j);
    const m = app.doc.vars[j], opts = lv.map((l, k) => `<option value="${k}">${esc(l.label)}</option>`).join('');
    const numeric = m.type !== 'string' && m.type !== 'categorical' && lv.length > 2;
    el.innerHTML = `<span>Group 1</span><select class="g1">${opts}</select><span>Group 2</span><select class="g2">${opts}</select>${numeric ? '<label><input type="checkbox" class="cutOn"> or cut point</label><input type="number" class="cut" style="width:70px">' : ''}`;
    const g1 = el.querySelector('.g1'), g2 = el.querySelector('.g2'); g2.selectedIndex = Math.min(1, lv.length - 1);
    const sync = () => { state.opts.g1 = lv[+g1.value]?.v; state.opts.g2 = lv[+g2.value]?.v; const c = el.querySelector('.cutOn'); state.opts.cut = c && c.checked ? +el.querySelector('.cut').value : null; };
    el.querySelectorAll('select,input').forEach(i => i.onchange = sync); sync();
    state.opts.__groupCheck = () => { sync(); if (state.opts.cut == null && state.opts.g1 === state.opts.g2) return 'Choose two different groups.'; return null; };
  }

  /* ---------- procedure dialogs ---------- */
  const T = {
    num: { accept: isNum }, any: { accept: anyVar },
  };
  const confOpt = { key: 'conf', label: 'Confidence level', type: 'select', value: '0.95', options: [['0.9', '90%'], ['0.95', '95%'], ['0.99', '99%']] };
  const P = {
    descriptives: app => pick(app, { id: 'desc', title: 'Descriptives', instruction: 'Summary statistics for numeric variables',
      targets: [{ key: 'vars', label: 'Variables:', multi: true, ...T.num }, { key: 'by', label: 'Split by (optional):', min: 0, ...T.any }],
      options: [{ title: 'Statistics', items: A.DESC_STATS.slice(0, 10).map(s => ({ key: 's_' + s[0], label: s[1], type: 'check', value: A.DESC_DEFAULT.includes(s[0]) })) },
        { title: '', items: A.DESC_STATS.slice(10).map(s => ({ key: 's_' + s[0], label: s[1], type: 'check', value: A.DESC_DEFAULT.includes(s[0]) })).concat([{ key: 'saveZ', label: 'Save standardized values as variables', type: 'check', value: false }]) }],
      run: v => app.run(d => A.descriptives(d, { vars: v.vars, by: v.by, stats: A.DESC_STATS.map(s => s[0]).filter(k => v['s_' + k]), saveZ: v.saveZ })) }),
    frequencies: app => pick(app, { id: 'freq', title: 'Frequencies', instruction: 'Frequency tables and charts',
      targets: [{ key: 'vars', label: 'Variables:', multi: true, ...T.any }],
      options: [{ items: [{ key: 'stats', label: 'Statistics table', type: 'check', value: true }, { key: 'chart', label: 'Chart', type: 'select', value: 'bar', options: [['none', 'None'], ['bar', 'Bar chart (counts)'], ['pct', 'Bar chart (percent)'], ['hist', 'Histogram']] }, { key: 'sortBy', label: 'Order by', type: 'select', value: 'value', options: [['value', 'Value'], ['count', 'Descending count']] }] }],
      run: v => app.run(d => A.frequencies(d, v)) }),
    crosstabs: app => pick(app, { id: 'xtab', title: 'Crosstabs', instruction: 'Two-way table with chi-square tests',
      targets: [{ key: 'row', label: 'Row variable:', ...T.any }, { key: 'col', label: 'Column variable:', ...T.any }],
      options: [{ title: 'Cells', items: [['count', 'Observed counts', true], ['expected', 'Expected counts', false], ['row', 'Row percentages', true], ['col', 'Column percentages', false], ['total', 'Total percentages', false], ['adjres', 'Adjusted residuals', false]].map(([k, l, v]) => ({ key: 'c_' + k, label: l, type: 'check', value: v })) },
        { title: 'Statistics', items: [{ key: 'chi', label: 'Chi-square tests', type: 'check', value: true }, { key: 'measures', label: 'Phi, Cramér’s V', type: 'check', value: true }, { key: 'chartOn', label: 'Clustered bar chart', type: 'check', value: true }] }],
      validate: v => v.row === v.col ? 'Row and column variables must differ.' : null,
      run: v => app.run(d => A.crosstabs(d, { row: v.row, col: v.col, chi: v.chi, measures: v.measures, chartOn: v.chartOn, cells: ['count', 'expected', 'row', 'col', 'total', 'adjres'].filter(k => v['c_' + k]) })) }),
    tOne: app => pick(app, { id: 't1', title: 'One-sample t-test', instruction: 'Compare a mean with a known value',
      targets: [{ key: 'vars', label: 'Test variables:', multi: true, ...T.num }],
      options: [{ items: [{ key: 'mu', label: 'Test value', type: 'number', value: 0, step: 'any' }, confOpt] }],
      run: v => app.run(d => A.tOne(d, { vars: v.vars, mu: +v.mu || 0, conf: +v.conf })) }),
    tInd: app => pick(app, { id: 't2', title: 'Independent-samples t-test', instruction: 'Compare the means of two groups (Student and Welch)',
      targets: [{ key: 'vars', label: 'Test variables:', multi: true, ...T.num }, { key: 'group', label: 'Grouping variable:', ...T.any, sub: (el, s, a) => groupSub(el, s, a) }],
      options: [{ items: [confOpt] }], validate: (v, a) => v.__groupCheck ? v.__groupCheck() : null,
      run: v => app.run(d => A.tInd(d, { vars: v.vars, group: v.group, g1: v.g1, g2: v.g2, cut: v.cut, conf: +v.conf })) }),
    tPaired: app => pick(app, { id: 'tp', title: 'Paired-samples t-test', instruction: 'Compare two measurements on the same cases',
      targets: [{ key: 'pairs', label: 'Paired variables (pick two at a time):', pairs: true, ...T.num }], options: [{ items: [confOpt] }],
      run: v => app.run(d => A.tPaired(d, { pairs: v.pairs, conf: +v.conf })) }),
    anova1: app => pick(app, { id: 'an1', title: 'One-way ANOVA', instruction: 'Compare means of three or more groups',
      targets: [{ key: 'vars', label: 'Dependent list:', multi: true, ...T.num }, { key: 'factor', label: 'Factor:', ...T.any }],
      options: [{ title: 'Post hoc', items: [{ key: 'tukey', label: 'Tukey HSD', type: 'check', value: true }, { key: 'bonf', label: 'Bonferroni', type: 'check', value: false }] },
        { title: 'Options', items: [{ key: 'desc', label: 'Descriptives', type: 'check', value: true }, { key: 'welch', label: 'Welch test', type: 'check', value: true }, { key: 'plot', label: 'Means plot', type: 'check', value: true }, confOpt] }],
      run: v => app.run(d => A.anova1(d, { vars: v.vars, factor: v.factor, posthoc: [v.tukey && 'tukey', v.bonf && 'bonferroni'].filter(Boolean), desc: v.desc, welch: v.welch, plot: v.plot, conf: +v.conf })) }),
    glm: app => pick(app, { id: 'glm', title: 'Univariate (factorial ANOVA)', instruction: 'Two-way (or three-way) ANOVA with Type III sums of squares',
      targets: [{ key: 'dep', label: 'Dependent variable:', ...T.num }, { key: 'factors', label: 'Fixed factors (1–3):', multi: true, max: 3, ...T.any }, { key: 'covariates', label: 'Covariates (optional):', multi: true, min: 0, ...T.num }],
      options: [{ items: [{ key: 'desc', label: 'Descriptive statistics', type: 'check', value: true }, { key: 'posthoc', label: 'Tukey post hoc for main effects', type: 'check', value: true }, { key: 'plot', label: 'Profile plot', type: 'check', value: true }, confOpt] }],
      validate: v => v.factors.includes(v.dep) ? 'The dependent variable cannot also be a factor.' : null,
      run: v => app.run(d => A.glm(d, { dep: v.dep, factors: v.factors, covariates: v.covariates, desc: v.desc, posthoc: v.posthoc, plot: v.plot, conf: +v.conf })) }),
    correlate: app => pick(app, { id: 'cor', title: 'Bivariate correlations', instruction: 'Correlation matrix with significance tests',
      targets: [{ key: 'vars', label: 'Variables:', multi: true, min: 2, ...T.num }],
      options: [{ items: [{ key: 'method', label: 'Coefficient', type: 'select', value: 'pearson', options: [['pearson', 'Pearson'], ['spearman', 'Spearman'], ['kendall', 'Kendall’s tau-b']] }, { key: 'listwise', label: 'Exclude cases listwise', type: 'check', value: false }] }],
      run: v => app.run(d => A.correlate(d, v)) }),
    regress: app => pick(app, { id: 'reg', title: 'Linear regression', instruction: 'Ordinary least squares with full output tables',
      targets: [{ key: 'dep', label: 'Dependent:', ...T.num }, { key: 'preds', label: 'Independent(s):', multi: true, ...T.any }],
      options: [{ items: [{ key: 'collin', label: 'Collinearity (VIF)', type: 'check', value: true }, { key: 'plots', label: 'Residual plots', type: 'check', value: true }, confOpt] },
        { title: 'Save', items: [{ key: 'savePred', label: 'Predicted values', type: 'check', value: false }, { key: 'saveRes', label: 'Residuals', type: 'check', value: false }] }],
      help: 'Categorical and string predictors are dummy-coded automatically (first category = reference).',
      validate: v => v.preds.includes(v.dep) ? 'The dependent variable cannot also be a predictor.' : null,
      run: v => app.run(d => A.regress(d, { ...v, conf: +v.conf })) }),
    logistic: app => pick(app, { id: 'log', title: 'Binary logistic regression', instruction: 'Model a two-category outcome',
      targets: [{ key: 'dep', label: 'Dependent (two values):', ...T.any }, { key: 'preds', label: 'Covariates:', multi: true, ...T.any }],
      options: [{ items: [{ key: 'cutoff', label: 'Classification cutoff', type: 'number', value: 0.5, step: 0.05, min: 0.01, max: 0.99 }, confOpt, { key: 'savePred', label: 'Save predicted probabilities', type: 'check', value: false }] }],
      help: 'The higher of the two outcome values is modelled as “1”. Categorical covariates are indicator-coded against their first category.',
      validate: (v, a) => { if (v.preds.includes(v.dep)) return 'The dependent variable cannot also be a covariate.'; if (v.dep != null) { const n = a.levels(v.dep).length; if (n !== 2) return `The dependent variable must have exactly two values (it has ${n}).`; } return null; },
      run: v => app.run(d => A.logistic(d, { ...v, conf: +v.conf, cutoff: +v.cutoff || 0.5 })) }),
    mannWhitney: app => pick(app, { id: 'mw', title: 'Mann–Whitney U test', instruction: 'Two independent samples (non-parametric)',
      targets: [{ key: 'vars', label: 'Test variables:', multi: true, ...T.num }, { key: 'group', label: 'Grouping variable:', ...T.any, sub: (el, s, a) => groupSub(el, s, a) }],
      validate: v => v.__groupCheck ? v.__groupCheck() : null,
      run: v => app.run(d => A.mannWhitney(d, { vars: v.vars, group: v.group, g1: v.g1, g2: v.g2 })) }),
    wilcoxon: app => pick(app, { id: 'wil', title: 'Wilcoxon signed-rank test', instruction: 'Two related samples (non-parametric)',
      targets: [{ key: 'pairs', label: 'Test pairs (pick two at a time):', pairs: true, ...T.num }],
      run: v => app.run(d => A.wilcoxon(d, { pairs: v.pairs })) }),
    kruskal: app => pick(app, { id: 'kw', title: 'Kruskal–Wallis H test', instruction: 'K independent samples (non-parametric)',
      targets: [{ key: 'vars', label: 'Test variables:', multi: true, ...T.num }, { key: 'group', label: 'Grouping variable:', ...T.any }],
      run: v => app.run(d => A.kruskal(d, v)) }),
    normality: app => pick(app, { id: 'norm', title: 'Normality tests', instruction: 'Shapiro–Wilk, Kolmogorov–Smirnov (Lilliefors) and Anderson–Darling',
      targets: [{ key: 'vars', label: 'Variables:', multi: true, ...T.num }, { key: 'by', label: 'Split by (optional):', min: 0, ...T.any }],
      options: [{ items: [{ key: 'sw', label: 'Shapiro–Wilk', type: 'check', value: true }, { key: 'ks', label: 'Kolmogorov–Smirnov', type: 'check', value: true }, { key: 'ad', label: 'Anderson–Darling', type: 'check', value: true }] }, { items: [{ key: 'qq', label: 'Normal Q-Q plots', type: 'check', value: true }, { key: 'hist', label: 'Histograms', type: 'check', value: false }] }],
      validate: v => !v.sw && !v.ks && !v.ad ? 'Choose at least one test.' : null,
      run: v => app.run(d => A.normality(d, { vars: v.vars, by: v.by, tests: ['sw', 'ks', 'ad'].filter(k => v[k]), qq: v.qq, hist: v.hist })) }),
    // ----- charts -----
    histogram: app => pick(app, { id: 'g_hist', title: 'Histogram', targets: [{ key: 'x', label: 'Variable:', ...T.num }, { key: 'by', label: 'Panels by (optional):', min: 0, ...T.any }],
      options: [{ items: [{ key: 'normal', label: 'Show normal curve', type: 'check', value: true }, { key: 'bins', label: 'Bins (0 = auto)', type: 'number', value: 0, min: 0, max: 200 }, { key: 'title', label: 'Title', type: 'text', value: '', width: 220 }] }],
      run: v => app.run(d => A.chartProc(d, { kind: 'histogram', kindName: 'Histogram', ...v, bins: +v.bins || 0 })) }),
    box: app => pick(app, { id: 'g_box', title: 'Box plot', targets: [{ key: 'vars', label: 'Variables:', multi: true, ...T.num }, { key: 'by', label: 'Category axis (optional):', min: 0, ...T.any }],
      options: [{ items: [{ key: 'title', label: 'Title', type: 'text', value: '', width: 220 }] }],
      run: v => app.run(d => A.chartProc(d, { kind: 'box', kindName: 'Box plot', ...v })) }),
    scatter: app => pick(app, { id: 'g_sc', title: 'Scatter plot', targets: [{ key: 'x', label: 'X axis:', ...T.num }, { key: 'y', label: 'Y axis:', ...T.num }, { key: 'by', label: 'Color by (optional):', min: 0, ...T.any }, { key: 'labelBy', label: 'Label points by (optional):', min: 0, ...T.any }],
      options: [{ items: [{ key: 'fit', label: 'Linear fit line', type: 'check', value: true }, { key: 'fitGroups', label: 'Fit per group', type: 'check', value: false }, { key: 'title', label: 'Title', type: 'text', value: '', width: 220 }] }],
      run: v => app.run(d => A.chartProc(d, { kind: 'scatter', kindName: 'Scatter plot', ...v })) }),
    bar: app => pick(app, { id: 'g_bar', title: 'Bar chart', targets: [{ key: 'cat', label: 'Category axis:', ...T.any }, { key: 'cluster', label: 'Cluster by (optional):', min: 0, ...T.any }, { key: 'y', label: 'Variable to average (for means):', min: 0, ...T.num }],
      options: [{ items: [{ key: 'stat', label: 'Bars show', type: 'select', value: 'count', options: [['count', 'Count of cases'], ['pct', 'Percent of cases'], ['mean', 'Mean of variable']] }, { key: 'err', label: '95% CI error bars (means)', type: 'check', value: true }, { key: 'title', label: 'Title', type: 'text', value: '', width: 200 }] }],
      validate: v => v.stat === 'mean' && v.y == null ? 'Choose the variable to average.' : v.cluster != null && v.cluster === v.cat ? 'Cluster and category must differ.' : null,
      run: v => app.run(d => A.chartProc(d, { kind: 'bar', kindName: 'Bar chart', ...v })) }),
    qq: app => pick(app, { id: 'g_qq', title: 'Normal Q-Q plot', targets: [{ key: 'x', label: 'Variable:', ...T.num }],
      run: v => app.run(d => A.chartProc(d, { kind: 'qq', kindName: 'Q-Q plot', ...v })) }),
    line: app => pick(app, { id: 'g_line', title: 'Line chart of means', targets: [{ key: 'x', label: 'Category axis:', ...T.any }, { key: 'y', label: 'Variable:', ...T.num }],
      run: v => app.run(d => A.chartProc(d, { kind: 'line', kindName: 'Line chart', ...v })) }),
    control: app => pick(app, { id: 'g_ctl', title: 'Control chart', instruction: 'Shewhart charts with tests for special causes',
      targets: [{ key: 'x', label: 'Measurement (or defectives for P):', ...T.num }, { key: 'subgroup', label: 'Subgroup ID (Xbar-R, optional):', min: 0, ...T.any }, { key: 'n', label: 'Sample size (P chart):', min: 0, ...T.num }],
      options: [{ items: [{ key: 'type', label: 'Chart', type: 'select', value: 'imr', options: [['imr', 'I-MR (individuals)'], ['xbarr', 'Xbar-R (subgroups)'], ['p', 'P chart (proportion defective)']] }, { key: 'size', label: 'Subgroup size', type: 'number', value: 5, min: 2, max: 25 }] }],
      validate: v => v.type === 'p' && v.n == null ? 'A P chart needs the sample-size variable.' : null,
      run: v => app.run(d => A.control(d, { type: v.type, x: v.x, size: +v.size || 5, subgroup: v.subgroup, n: v.n })) }),
  };

  /* ---------- Compute variable ---------- */
  const FN_HINT = ['ABS(x)', 'SQRT(x)', 'LN(x)', 'LG10(x)', 'EXP(x)', 'ROUND(x, d)', 'TRUNC(x)', 'MOD(a, b)', 'MEAN(a, b, …)', 'SUM(a, b, …)', 'MIN(…)', 'MAX(…)', 'SD(…)', 'NVALID(…)', 'MISSING(x)', 'SYSMIS(x)', 'IF(cond, a, b)', 'ANY(x, v1, v2…)', 'RANGE(x, lo, hi)', 'LAG(x)',
    'YEAR(d)', 'MONTH(d)', 'DAY(d)', 'DATE(y, m, d)', 'DATEDIFF(a, b)', 'UPCASE(s)', 'LOWER(s)', 'CONCAT(a, b)', 'SUBSTR(s, i, n)', 'LENGTH(s)', 'NUMBER(s)', 'STRING(x, d)', 'CDF.NORMAL(x, m, s)', 'IDF.NORMAL(p, m, s)', 'RV.NORMAL(m, s)', 'RV.UNIFORM(a, b)', '$CASENUM'];
  function exprBox(app, { id, title, instruction, top = '', ifBox = false, value = '', run, preview = true, ok = 'OK' }) {
    const vars = app.doc.vars;
    const html = `${top}<div class="xbox"><div><div class="aero-list xl">${vars.map((m, j) => `<div class="aero-item" data-j="${j}" title="${esc(vlabel(m))}"><span class="grow">${esc(m.name)}</span><span class="dim" style="font-size:10.5px">${esc(m.type)}</span></div>`).join('')}</div><div class="dim" style="margin-top:3px">Double-click to insert</div></div>
      <div><label class="dim">Expression</label><textarea class="xe" spellcheck="false">${esc(value)}</textarea>
      ${ifBox ? `<div class="row" style="margin-top:6px"><label>If (optional):</label><input type="text" class="xif" placeholder="e.g. age >= 18 & sex = 2" value="${esc(memo[id]?.cond || '')}"></div>` : ''}
      <div class="prev"></div><div class="fns">${FN_HINT.map(f => `<button data-f="${esc(f)}">${esc(f.replace(/\(.*\)/, '()'))}</button>`).join('')}</div></div></div><div class="dlg-err"></div>
      <div class="dnote">Operators: + − * / ** · = ~= &lt; &lt;= &gt; &gt;= · AND (&amp;) OR (|) NOT (~). Text in quotes. Missing values propagate; dates are day numbers.</div>`;
    const dlg = Aero.dialog({ title, instruction, html, ok, width: 700, onOK: () => run(get()) });
    const box = dlg.el; box.classList.add('wide');
    const ta = box.querySelector('.xe'), xif = box.querySelector('.xif'), prev = box.querySelector('.prev');
    let focusEl = ta;
    [ta, xif].forEach(t => t && t.addEventListener('focus', () => focusEl = t));
    const insert = s => { const t = focusEl, a = t.selectionStart ?? t.value.length, b = t.selectionEnd ?? a; t.value = t.value.slice(0, a) + s + t.value.slice(b); t.focus(); const p = a + s.length; t.setSelectionRange(p, p); upd(); };
    box.querySelector('.xl').addEventListener('dblclick', e => { const it = e.target.closest('.aero-item'); if (it) insert(vars[+it.dataset.j].name + ' '); });
    box.querySelectorAll('.fns button').forEach(b => b.onclick = () => { const f = b.dataset.f, k = f.indexOf('('); insert(k > 0 ? f.slice(0, k + 1) + ')' : f); if (k > 0) { const p = focusEl.selectionStart - 1; focusEl.setSelectionRange(p, p); } });
    const get = () => ({ expr: ta.value.trim(), cond: xif ? xif.value.trim() : '', box });
    const upd = () => {
      if (!preview) return;
      const { expr, cond } = get(); if (!expr) { prev.textContent = ''; return; }
      try {
        const f = D.compile(expr, app.doc), g = cond ? D.compile(cond, app.doc) : null, out = [];
        for (let i = 0; i < Math.min(app.doc.n, 6); i++) { const ok = !g || D.truth(g(i)) === true; const v = ok ? f(i) : '·'; out.push(v == null ? '.' : typeof v === 'number' ? +v.toPrecision(6) : JSON.stringify(v)); }
        prev.textContent = 'Preview (first cases): ' + out.join(',  '); prev.style.color = '';
      } catch (e) { prev.textContent = e.message; prev.style.color = '#b00020'; }
    };
    ta.addEventListener('input', upd); xif && xif.addEventListener('input', upd); upd();
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
    guard(box, () => { const { expr, cond } = get(); if (!expr) return 'Enter an expression.'; try { D.compile(expr, app.doc); if (cond) D.compile(cond, app.doc); } catch (e) { return e.message; } return dlg.extraCheck ? dlg.extraCheck() : null; });
    return dlg;
  }
  function compute(app) {
    const m = memo.compute || { name: '', type: 'numeric', label: '', expr: '', cond: '' };
    const top = `<div class="xbox" style="grid-template-columns:200px 1fr"><label>Target variable:</label><div class="row"><input type="text" class="tname" value="${esc(m.name)}" placeholder="new or existing name"><select class="ttype"><option value="numeric">Numeric</option><option value="string"${m.type === 'string' ? ' selected' : ''}>String</option><option value="date"${m.type === 'date' ? ' selected' : ''}>Date</option></select></div>
      <label>Label:</label><div class="row"><input type="text" class="tlabel" value="${esc(m.label)}"></div></div>`;
    const dlg = exprBox(app, { id: 'compute', title: 'Compute variable', instruction: 'Create or overwrite a variable from an expression', top, ifBox: true, value: m.expr,
      run: ({ expr, cond, box }) => {
        const name = box.querySelector('.tname').value.trim(), type = box.querySelector('.ttype').value, label = box.querySelector('.tlabel').value;
        memo.compute = { name, type, label, expr, cond };
        app.computeVar(name, type, label, expr, cond);
      } });
    dlg.extraCheck = () => {
      const box = dlg.el, name = box.querySelector('.tname').value.trim(); if (!name) return 'Enter the target variable name.';
      const ex = app.doc.vars.find(v => v.name.toLowerCase() === name.toLowerCase());
      if (!ex) { const bad = D.validName(name, app.doc.vars); if (bad) return bad; }
      return null;
    };
    setTimeout(() => { const t = dlg.el.querySelector('.tname'); if (!t.value) t.focus(); }, 0);
  }
  function selectCases(app) {
    const f = app.doc.filter;
    const top = `<div class="opts" style="margin-top:0"><label><input type="radio" name="sc" value="filter" checked> Filter out unselected cases</label><label><input type="radio" name="sc" value="delete"> Delete unselected cases</label>${f && f.expr ? `<label><input type="checkbox" class="off"> Turn the filter off (use all cases)</label>` : ''}</div>`;
    const dlg = exprBox(app, { id: 'select', title: 'Select cases', instruction: 'Keep only the cases where the condition is true', top, value: f?.expr || memo.select || '',
      run: ({ expr, box }) => {
        if (box.querySelector('.off')?.checked) { app.setFilter(null); return; }
        memo.select = expr;
        if (box.querySelector('[name=sc]:checked').value === 'delete') app.deleteUnselected(expr); else app.setFilter(expr);
      } });
    dlg.el.querySelector('.off')?.addEventListener('change', e => { dlg.el.querySelector('.xe').disabled = e.target.checked; });
    const okb = dlg.el.querySelector('.aero-btns [data-a=o]');
    okb.addEventListener('click', e => { if (dlg.el.querySelector('.off')?.checked) { e.stopImmediatePropagation(); dlg.close(); app.setFilter(null); } }, true);
  }

  /* ---------- Recode ---------- */
  function recode(app, into = 'different') {
    const vars = app.doc.vars, m0 = memo['recode_' + into] || {};
    let rules = (m0.rules || []).slice(), sel = -1, src = (m0.src || []).map(n => vars.findIndex(v => v.name === n)).filter(j => j >= 0);
    const html = `<div class="xbox"><div><div class="aero-list rl" style="height:150px">${vars.map((m, j) => `<div class="aero-item" data-j="${j}"><span class="grow">${esc(m.name)}</span><span class="dim" style="font-size:10.5px">${esc(m.type)}</span></div>`).join('')}</div><div class="dim" style="margin-top:3px">${into === 'same' ? 'Click to choose variables (Ctrl for several)' : 'Click to choose the source variable'}</div></div>
      <div>${into === 'different' ? `<div class="row"><label>Output name:</label><input type="text" class="oname" value="${esc(m0.oname || '')}"><select class="otype"><option value="numeric">Numeric</option><option value="string"${m0.otype === 'string' ? ' selected' : ''}>String</option></select></div><div class="row"><label>Label:</label><input type="text" class="olabel" value="${esc(m0.olabel || '')}"></div>` : ''}
      <div class="row"><b class="srcsel" style="color:var(--navy)"></b></div></div></div>
      <div class="rules"><fieldset><legend>Old value</legend>
        <label><input type="radio" name="of" value="value" checked> Value <input type="text" class="ov"></label>
        <label><input type="radio" name="of" value="range"> Range <input type="text" class="olo"> thru <input type="text" class="ohi"></label>
        <label><input type="radio" name="of" value="lowest"> Lowest thru <input type="text" class="olw"></label>
        <label><input type="radio" name="of" value="highest"> <input type="text" class="ohg"> thru highest</label>
        <label><input type="radio" name="of" value="sysmis"> System-missing</label><label><input type="radio" name="of" value="missing"> System- or user-missing</label><label><input type="radio" name="of" value="else"> All other values</label></fieldset>
      <fieldset><legend>New value</legend><label><input type="radio" name="nf" value="value" checked> Value <input type="text" class="nv"></label><label><input type="radio" name="nf" value="sysmis"> System-missing</label><label><input type="radio" name="nf" value="copy"> Copy old value(s)</label>
        <div class="dim" style="margin-top:6px">Rules apply top to bottom; the first match wins.${into === 'different' ? ' Unmatched values become system-missing unless an “All other values → Copy” rule is added.' : ' Unmatched values are kept.'}</div></fieldset>
      <div class="rulelist"><div class="aero-list rlist"></div><div class="bb"><button class="aero-btn small radd">Add</button><button class="aero-btn small rchg">Change</button><button class="aero-btn small rdel">Remove</button></div></div></div>
      <div class="opts" style="margin-top:8px"><label>Value labels for new codes (optional): <input type="text" class="vlabs" style="width:330px" placeholder="1=Low; 2=Medium; 3=High" value="${esc(m0.vlabs || '')}"></label></div><div class="dlg-err"></div>`;
    const dlg = Aero.dialog({ title: into === 'same' ? 'Recode into same variables' : 'Recode into different variable', instruction: into === 'same' ? 'Replace values of existing variables' : 'Create a new variable from recoded values', html, width: 720,
      onOK: () => {
        const b = dlg.el, o = { src: src.map(j => vars[j].name), rules, vlabs: b.querySelector('.vlabs').value };
        if (into === 'different') Object.assign(o, { oname: b.querySelector('.oname').value.trim(), otype: b.querySelector('.otype').value, olabel: b.querySelector('.olabel').value });
        memo['recode_' + into] = o;
        app.recode(into, src, rules, o);
      } });
    const box = dlg.el; box.classList.add('wide');
    const q = s => box.querySelector(s);
    const parseV = s => { const t = String(s).trim(); const n = D.toNumber(t); return n != null ? n : t.replace(/^['"]|['"]$/g, ''); };
    const readRule = () => {
      const of = q('[name=of]:checked').value, nf = q('[name=nf]:checked').value, from = { k: of };
      if (of === 'value') { if (q('.ov').value.trim() === '' && q('.ov').value === '') return 'Enter the old value.'; from.v = parseV(q('.ov').value); }
      if (of === 'range') { from.lo = D.toNumber(q('.olo').value); from.hi = D.toNumber(q('.ohi').value); if (from.lo == null || from.hi == null) return 'Enter both ends of the range as numbers.'; if (from.lo > from.hi) [from.lo, from.hi] = [from.hi, from.lo]; }
      if (of === 'lowest') { from.hi = D.toNumber(q('.olw').value); if (from.hi == null) return 'Enter a number.'; }
      if (of === 'highest') { from.lo = D.toNumber(q('.ohg').value); if (from.lo == null) return 'Enter a number.'; }
      const to = { k: nf }; if (nf === 'value') { to.v = parseV(q('.nv').value); if (q('.nv').value.trim() === '') return 'Enter the new value.'; }
      return { from, to };
    };
    const renderRules = () => { q('.rlist').innerHTML = rules.map((r, i) => `<div class="aero-item${i === sel ? ' sel' : ''}" data-i="${i}"><span class="grow">${esc(D.describeRule(r))}</span></div>`).join('') || '<div class="dim" style="padding:6px">No rules yet — fill in Old and New value, then Add.</div>'; };
    const renderSrc = () => { box.querySelectorAll('.rl .aero-item').forEach(it => it.classList.toggle('sel', src.includes(+it.dataset.j))); q('.srcsel').textContent = src.length ? (into === 'same' ? 'Recoding: ' : 'Source: ') + src.map(j => vars[j].name).join(', ') : 'No variable chosen'; };
    q('.rl').addEventListener('mousedown', e => { const it = e.target.closest('.aero-item'); if (!it) return; const j = +it.dataset.j; if (into === 'same' && e.ctrlKey) src = src.includes(j) ? src.filter(x => x !== j) : [...src, j]; else src = [j]; if (into === 'different' && !q('.oname').value) q('.oname').value = D.uniqueName(vars, vars[j].name + '_r'); renderSrc(); });
    q('.rlist').addEventListener('mousedown', e => { const it = e.target.closest('.aero-item'); if (!it) return; sel = +it.dataset.i; renderRules(); });
    const err = m => q('.dlg-err').textContent = m || '';
    q('.radd').onclick = () => { const r = readRule(); if (typeof r === 'string') return err(r); rules.push(r); sel = rules.length - 1; err(''); renderRules(); };
    q('.rchg').onclick = () => { if (sel < 0) return err('Select a rule to change.'); const r = readRule(); if (typeof r === 'string') return err(r); rules[sel] = r; err(''); renderRules(); };
    q('.rdel').onclick = () => { if (sel < 0) return; rules.splice(sel, 1); sel = -1; renderRules(); };
    renderRules(); renderSrc();
    guard(box, () => {
      if (!src.length) return 'Choose a source variable.';
      if (!rules.length) return 'Add at least one rule.';
      if (into === 'different') { const n = q('.oname').value.trim(); if (!n) return 'Enter the output variable name.'; const bad = D.validName(n, vars); if (bad) return bad; }
      return null;
    });
  }

  /* ---------- Sort cases ---------- */
  function sortCases(app) {
    pick(app, { id: 'sort', title: 'Sort cases', instruction: 'Reorder the cases by one or more variables',
      targets: [{ key: 'by', label: 'Sort by (in order of priority):', multi: true, ...T.any }],
      options: [{ items: [{ key: 'order', label: 'Order', type: 'select', value: 'asc', options: [['asc', 'Ascending'], ['desc', 'Descending']] }] }],
      run: v => app.sortCases(v.by, v.order === 'desc') });
  }

  /* ---------- Value labels ---------- */
  function valueLabels(app, j) {
    const m = app.doc.vars[j];
    let rows = Object.entries(m.values || {}).sort((a, b) => (D.toNumber(a[0]) ?? 0) - (D.toNumber(b[0]) ?? 0) || a[0].localeCompare(b[0]));
    const row = (k, l) => `<tr><td><input type="text" class="vk" value="${esc(k)}"></td><td><input type="text" class="vlab" value="${esc(l)}"></td><td><button class="vx" title="Remove">✕</button></td></tr>`;
    const html = `<div class="vltwrap"><table class="vlt"><tbody>${rows.map(([k, l]) => row(k, l)).join('')}${row('', '')}</tbody></table></div>
      <div style="margin-top:6px;display:flex;gap:8px"><button class="aero-btn small vadd">Add row</button><button class="aero-btn small vfill">Add all data values</button></div><div class="dlg-err"></div>`;
    const dlg = Aero.dialog({ title: `Value labels — ${m.name}`, instruction: 'Give codes a readable meaning (e.g. 1 = Male)', html, width: 470,
      onOK: () => { const out = {}; dlg.el.querySelectorAll('.vlt tr').forEach(tr => { const k = tr.querySelector('.vk').value.trim(), l = tr.querySelector('.vlab').value; if (k !== '' && k !== '__proto__' && l.trim() !== '') out[m.type === 'string' ? k : String(D.toNumber(k))] = l; }); app.setVarProps(j, { values: out }, 'Value labels'); } });
    const tb = dlg.el.querySelector('.vlt tbody');
    tb.addEventListener('click', e => { if (e.target.classList.contains('vx')) e.target.closest('tr').remove(); });
    dlg.el.querySelector('.vadd').onclick = () => { tb.insertAdjacentHTML('beforeend', row('', '')); tb.lastElementChild.querySelector('.vk').focus(); };
    dlg.el.querySelector('.vfill').onclick = () => {
      const have = new Set([...tb.querySelectorAll('.vk')].map(i => i.value.trim()));
      const vals = [...new Set(app.doc.cols[j].filter(v => v != null && v !== ''))].sort((a, b) => a < b ? -1 : 1).slice(0, 200);
      vals.forEach(v => { const k = String(v); if (!have.has(k)) tb.insertAdjacentHTML('beforeend', row(k, '')); });
    };
    guard(dlg.el, () => { for (const tr of dlg.el.querySelectorAll('.vlt tr')) { const k = tr.querySelector('.vk').value.trim(), l = tr.querySelector('.vlab').value.trim(); if (k && l && m.type !== 'string' && D.toNumber(k) == null) return `“${k}” is not a number (this variable is ${m.type}).`; } return null; });
  }

  /* ---------- Missing values ---------- */
  function missingValues(app, j) {
    const m = app.doc.vars[j];
    const html = `<div class="opts" style="flex-direction:column;margin-top:0">
      <label>Discrete missing values (comma-separated): <input type="text" class="md" style="width:200px" value="${esc((m.missing || []).join(', '))}"></label>
      ${m.type !== 'string' ? `<label>Range: <input type="text" class="mlo" style="width:80px" value="${esc(m.missRange ? m.missRange[0] : '')}"> thru <input type="text" class="mhi" style="width:80px" value="${esc(m.missRange ? m.missRange[1] : '')}"></label>` : ''}</div>
      <div class="dnote">User-missing values stay in the data (shown in orange) but are excluded from every analysis. Empty cells are system-missing.</div><div class="dlg-err"></div>`;
    const read = () => {
      const b = dlg.el, parts = b.querySelector('.md').value.split(',').map(s => s.trim()).filter(Boolean);
      const missing = m.type === 'string' ? parts : parts.map(D.toNumber);
      let range = null; const lo = b.querySelector('.mlo')?.value.trim(), hi = b.querySelector('.mhi')?.value.trim();
      if (lo || hi) range = [D.toNumber(lo), D.toNumber(hi)];
      return { missing, range };
    };
    const dlg = Aero.dialog({ title: `Missing values — ${m.name}`, html, width: 470, onOK: () => { const r = read(); app.setVarProps(j, { missing: r.missing, missRange: r.range && r.range[0] > r.range[1] ? [r.range[1], r.range[0]] : r.range }, 'Missing values'); } });
    guard(dlg.el, () => { const r = read(); if (r.missing.some(v => v == null)) return 'Missing values must be numbers for this variable.'; if (r.range && r.range.some(v => v == null)) return 'Enter both ends of the range as numbers.'; return null; });
  }

  root.LDialogs = { pick, P, compute, selectCases, recode, sortCases, valueLabels, missingValues, guard, memo };
})(typeof self !== 'undefined' ? self : this);
