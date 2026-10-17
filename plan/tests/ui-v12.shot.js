// Headless UI check for the v1.2 features (run through tools/shot with SHOT_JS=this file).
// Loads the sample, then exercises trace, group-by, DCMA tab, steps, codes, validation and SVG export.
const A = PlanApp, out = {}, wait = ms => new Promise(r => setTimeout(r, ms));
const fail = m => { throw new Error(m); };
A.commit('Load sample', P => { Object.keys(P).forEach(k => delete P[k]); Object.assign(P, PlanSample.sampleProject()); });
A.view.groupBy = ''; A.clearTrace(); A.rebuild(); await wait(50);
const px = (x, y) => { const c = document.getElementById('gantt'), d = c.getContext('2d').getImageData(Math.round(x * devicePixelRatio), Math.round(y * devicePixelRatio), 1, 1).data; return [d[0], d[1], d[2]]; };
const wrap = document.getElementById('ganttWrap');

// 1. driving path trace
A.select('A4040'); A.traceTo(); await wait(50);
out.traceRows = A.rows.length; out.traceBands = A.rows.filter(r => r._grp).map(r => r.name);
out.traceIds = A.rows.filter(r => !r._grp).map(r => r.id).join(' ');
out.traceHeader = [...document.querySelectorAll('.phead > div')].map(d => d.textContent).filter(t => /path|Rel/.test(t));
if (!A.fp || A.fp.info.get('A3010').path !== 1 || A.fp.info.get('A2030').rf !== 9) fail('trace values');
{ const i = A.rows.findIndex(r => r.id === 'A3000'), x = A.S.results.get('A3000'); Gantt.scrollToDate(x.start); wrap.scrollTop = 0; Gantt.draw(); await wait(30);
  const bx = Gantt.xOf(x.start) - wrap.scrollLeft, by = Gantt.HH + i * Gantt.RH - wrap.scrollTop + 4;
  out.haloPixel = px(bx - 2, by + 5); out.barPixel = px(bx + 6, by + 6); }
out.drivingRowsMarked = document.querySelectorAll('.prow.drvrow').length;
await new Promise(r => requestAnimationFrame(r));
A.clearTrace(); out.afterClearRows = A.rows.length;

// 2. group by activity code
A.setGroupBy('RESP'); await wait(50);
out.groupBands = A.rows.filter(r => r._grp).map(r => r.name + ' [' + A.S.results.get(r.id).start + '→' + A.S.results.get(r.id).finish + ']');
out.groupRows = A.rows.length;
document.querySelector('.prow.band [data-tw]').click(); await wait(30); out.collapsedRows = A.rows.length;
A.collapsed.clear(); A.rebuild();
out.groupSelect = document.getElementById('groupSel').value;
A.setGroupBy(''); out.wbsRows = A.rows.length;

// 3. DCMA tab
Panels.setTab('check'); await wait(30);
out.dcmaRows = document.querySelectorAll('.mini.dcma tr').length - 1;
out.dcmaFails = [...document.querySelectorAll('.mini.dcma tr.fail td:nth-child(2)')].map(t => t.textContent);
document.querySelector('.chip[data-goto="A3030"]').click(); await wait(30); out.chipSelected = A.cur;

// 4. steps (A3000 Steel frame: weights 1,4,4,1)
A.select('A3000'); Panels.setTab('steps'); await wait(30);
out.stepRows = document.querySelectorAll('.mini.steps tr').length - 2;
const done = document.querySelectorAll('.mini.steps input[data-f="done"]');
done[1].checked = true; done[1].dispatchEvent(new Event('change')); await wait(30);
const st = () => A.P.activities.find(a => a.id === 'A3000');
out.afterStep = { pct: st().pct, actualStart: st().actualStart, type: st().pctType, tableCell: document.querySelector('.prow[data-id="A3000"] .c-pct').textContent };
document.querySelectorAll('.mini.steps input[data-f="pct"]')[2].value = 50; document.querySelectorAll('.mini.steps input[data-f="pct"]')[2].dispatchEvent(new Event('change')); await wait(30);
out.afterStep2 = st().pct;
document.querySelector('.mini.steps [data-smv="0"][data-d="1"]').click(); await wait(30);
out.afterMove = st().steps.map(s => s.name.split(' ')[0]).join(',');
document.getElementById('sadd').click(); await wait(30); out.stepCountAfterAdd = st().steps.length;
// steps on a Duration activity switch it to Physical
A.select('A2010'); Panels.setTab('steps'); await wait(20); document.getElementById('sadd').click(); await wait(30);
out.newStepsType = A.P.activities.find(a => a.id === 'A2010').pctType;
// remaining duration for a physical activity drives its finish
A.select('A3000'); Panels.setTab('general'); await wait(20);
const rem = document.querySelector('[data-k="remaining"]'); out.hasRemainingField = !!rem;
// undo all the step edits
for (let k = 0; k < 6; k++) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
await wait(30); out.afterUndo = { pct: st().pct, actualStart: st().actualStart || null, steps: st().steps.length, a2010: A.P.activities.find(a => a.id === 'A2010').pctType || 'duration' };

// 5. codes: general-tab select, code dictionary, bulk assign
A.select('A4040'); Panels.setTab('general'); await wait(20);
const csel = document.querySelector('[data-code="RESP"]'); csel.value = 'MEP'; csel.dispatchEvent(new Event('change')); await wait(20);
out.codeSet = A.P.activities.find(a => a.id === 'A4040').codes.RESP;
Panels.setTab('codes'); await wait(20);
document.getElementById('cadd').click(); await wait(20); out.codesAfterAdd = A.P.codes.map(c => c.id).join(',');
document.getElementById('vadd').click(); await wait(20); out.valuesOfNew = A.P.codes[2].values.map(v => v.v).join(',');
A.sel.clear(); ['A1010', 'A1020'].forEach(id => A.sel.add(id)); Panels.render(); await wait(20);
const as = document.querySelector('[data-assign="CODE1"]'); as.value = 'V1'; as.dispatchEvent(new Event('change')); await wait(20);
out.bulkAssigned = A.P.activities.filter(a => a.codes && a.codes.CODE1 === 'V1').map(a => a.id).join(',');

// 6. untrusted file data is validated by normalize
A.commit('Bad data', P => { P.codes.push({ id: '<img onerror=x>', values: [{ v: 1 }, { v: null }, 'bad'] }, 'junk', { id: '' }); P.activities[2].codes = { '<img onerror=x>': '1', ZZ: 'nope' }; P.activities[3].steps = [null, { name: 5, weight: 'x', pct: 900 }]; P.activities[3].pctType = 'physical'; P.activities[4].pctType = 'weird'; P.activities[4].remaining = 3; });
out.validated = { codes: A.P.codes.map(c => c.id + ':' + c.values.map(v => v.v).join('|')), a2: A.P.activities[2].codes, a3: [A.P.activities[3].steps, A.P.activities[3].pct], a4: [A.P.activities[4].pctType, A.P.activities[4].remaining] };
out.noScriptInDom = !document.querySelector('#tabbody img, #table img');

// 7. SVG export
A.commit('Load sample', P => { Object.keys(P).forEach(k => delete P[k]); Object.assign(P, PlanSample.sampleProject()); });
const svg = Gantt.exportSVG();
const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
out.svg = { bytes: svg.length, parseError: !!doc.querySelector('parsererror'), texts: doc.querySelectorAll('text').length, rects: doc.querySelectorAll('rect').length, hasSteel: svg.includes('Steel frame'), w: doc.documentElement.getAttribute('width'), h: doc.documentElement.getAttribute('height') };
const img = new Image(); img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); await img.decode();
const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
const png = Gantt.exportCanvas(), pg = png.getContext('2d');
// compare the SVG rendering with the PNG export: same size, nearly the same pixels outside anti-aliasing
const a1 = g.getImageData(0, 0, cv.width, cv.height).data, a2 = pg.getImageData(0, 0, png.width, png.height).data; let diff = 0, red = 0;
for (let k = 0; k < a1.length; k += 4) { if (Math.abs(a1[k] - a2[k]) + Math.abs(a1[k + 1] - a2[k + 1]) + Math.abs(a1[k + 2] - a2[k + 2]) > 60) diff++; if (a1[k] > 180 && a1[k + 1] < 60 && a1[k + 2] < 70) red++; }
out.svgVsPng = { svgSize: [cv.width, cv.height], pngSize: [png.width, png.height], diffPct: +(100 * diff / (a1.length / 4)).toFixed(2), criticalRedPixels: red };
out.saveVersion = JSON.parse(JSON.stringify({ format: 'lumen-plan', version: 2, project: A.P })).project.codes.length;
// leave a nice state for the screenshot
A.select('A4040'); A.traceTo(); Panels.setTab('check'); document.getElementById('zoom').value = '4'; document.getElementById('zoom').onchange(); Gantt.scrollToDate('2026-10-26'); await wait(50); document.querySelectorAll('.aero-toast').forEach(e => e.style.display = 'none');
return JSON.stringify(out, null, 1);
