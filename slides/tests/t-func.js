// Functional checks of the editor in a real (hidden) browser window. Returns a JSON report.
const R = []; const ok = (c, m, extra) => R.push([!!c, m, extra === undefined ? undefined : extra]);
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = []; window.addEventListener('error', e => errors.push(e.message));
try {
await wait(400);
const { doc, assets } = await Sample.build(); setDocument(doc, assets, 'Sample', null); await Render.imagesReady(S.assets); await wait(200);
ok(S.doc.slides.length === 8, 'sample has 8 slides');
const cv = document.getElementById('cv');
const scr = (x, y) => { const r = cv.getBoundingClientRect(); const [sx, sy] = View.w2s(x, y); return [r.left + sx, r.top + sy]; };
const pe = (type, x, y, o = {}) => { const [cx, cy] = scr(x, y); cv.dispatchEvent(new PointerEvent(type, { clientX: cx, clientY: cy, button: 0, buttons: type === 'pointerup' ? 0 : 1, pointerId: 1, bubbles: true, ...o })); };
const drag = async (x0, y0, x1, y1, o) => { pe('pointerdown', x0, y0, o); for (let k = 1; k <= 6; k++) pe('pointermove', x0 + (x1 - x0) * k / 6, y0 + (y1 - y0) * k / 6, o); pe('pointerup', x1, y1, o); await wait(30); };
// --- text editing round trip on a new slide
UI.goSlide(1); UI.newSlide(S.doc.layouts.find(l => l.name === 'Title and Content').id); await wait(50);
const s = curSlide(); const title = s.objects.find(o => o.ph.type === 'title');
Editor.beginEdit(title, { selectAll: true }); document.execCommand('insertText', false, 'Hello World'); await wait(20);
const ed = document.querySelector('.te-ed'); ok(!!ed, 'contenteditable editor opened');
{ const walker = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let t, node = null; while ((t = walker.nextNode())) if (t.nodeValue.includes('World')) node = t; const r = document.createRange(); const i = node.nodeValue.indexOf('World'); r.setStart(node, i); r.setEnd(node, i + 5); getSelection().removeAllRanges(); getSelection().addRange(r); }
Editor.format('i'); Editor.format('color', 'accent2');
window.__edHTML = ed.innerHTML;
Editor.endEdit(true); await wait(20);
const tr = byId(title.id).text.paras[0].runs;
ok(tr.map(r => r.t).join('') === 'Hello World', 'typed text stored', tr);
ok(tr.some(r => r.t === 'World' && r.i === true && r.color === 'accent2') && tr.some(r => r.t === 'Hello ' && !r.i), 'partial italic + theme colour on selected word', { tr, html: window.__edHTML });
// body bullets + levels typed with Enter / Tab
const body = s.objects.find(o => o.ph.type === 'body');
Editor.beginEdit(body, {}); document.execCommand('insertText', false, 'One'); document.execCommand('insertParagraph'); document.execCommand('insertText', false, 'Two');
document.querySelector('.te-ed').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
const bodyHTML = document.querySelector('.te-ed').innerHTML;
Editor.endEdit(true);
const bp = byId(body.id).text.paras;
ok(bp.length === 2 && bp[0].runs[0].t === 'One' && bp[1].runs[0].t === 'Two' && bp[1].lvl === 1, 'Enter makes a paragraph, Tab demotes it', { bp, bodyHTML });
const L = Render.layoutText(S.doc, { slide: s }, byId(body.id), byId(body.id).text, body.w, body.h, {});
ok(L.lines.length === 2 && L.lines[0].bullet && L.lines[0].bullet.t === '•' && L.lines[1].bullet && L.lines[1].bullet.t === '–', 'master bullets per level', L.lines.map(l => l.bullet && l.bullet.t));
ok(L.lines[1].start > L.lines[0].start + 40, 'level 2 is indented', [L.lines[0].start, L.lines[1].start]);
select([body.id]); Editor.paraFormat('bullet', { num: 'arabicPeriod', start: 1 });
ok(JSON.stringify(byId(body.id).text.paras[0].bullet) === JSON.stringify({ num: 'arabicPeriod', start: 1 }), 'numbering applied to whole placeholder', byId(body.id).text.paras);
// --- draw a rectangle with the tool
UI.setTool('rect'); const n0 = curSlide().objects.length;
await drag(200, 300, 400, 420);
let rect = curSlide().objects[curSlide().objects.length - 1];
ok(curSlide().objects.length === n0 + 1 && rect.geom === 'rect' && Math.abs(rect.w - 200) < 2 && Math.abs(rect.h - 120) < 2, 'rectangle drawn by dragging', [rect.x, rect.y, rect.w, rect.h]);
ok(S.tool === 'select', 'tool returns to select');
// --- move with snapping to slide centre
rect = byId(rect.id); const cx0 = rect.x + rect.w / 2;
await drag(rect.x + 100, rect.y + 60, rect.x + 100 + (640 - cx0) + 3, rect.y + 60 + 50);
rect = byId(rect.id);
ok(Math.abs(rect.x + rect.w / 2 - 640) < 0.01, 'snaps to slide centre (smart guide)', rect.x + rect.w / 2);
// --- resize by the east handle (Alt = no snapping)
const w0 = rect.w; await drag(rect.x + rect.w, rect.y + rect.h / 2, rect.x + rect.w + 77, rect.y + rect.h / 2, { altKey: true });
rect = byId(rect.id);
ok(Math.abs(rect.w - (w0 + 77)) < 1, 'resize with handle', [w0, rect.w]);
// --- rotate via handle with shift (15° steps)
const rh = Editor.handles().find(h => h.k === 'rot');
const c0 = [rect.x + rect.w / 2, rect.y + rect.h / 2];
await drag(rh.x, rh.y, c0[0] + 200, c0[1] - 120, { shiftKey: true });
rect = byId(rect.id);
ok(rect.rot % 15 === 0 && rect.rot > 0, 'rotation snaps to 15°', rect.rot);
// --- undo / redo
const rot = rect.rot; undo(); ok((byId(rect.id).rot || 0) !== rot, 'undo rotation'); redo(); ok(byId(rect.id).rot === rot, 'redo rotation');
// --- group / ungroup, z-order
const r2 = Model.shape('ellipse', 900, 300, 100, 100); curSlide().objects.push(r2); commit('test');
select([rect.id, r2.id]);
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g', ctrlKey: true, bubbles: true }));
const g = curSlide().objects.find(o => o.type === 'group');
ok(g && g.children.length === 2, 'Ctrl+G groups');
const gx = g.x; Editor.nudge(10, 0); ok(Math.abs(byId(g.id).children[1].x - 910) < 0.01 && Math.abs(byId(g.id).x - gx - 10) < 0.01, 'moving a group moves its children');
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'G', ctrlKey: true, shiftKey: true, bubbles: true }));
ok(!curSlide().objects.some(o => o.type === 'group') && S.sel.length === 2, 'Ctrl+Shift+G ungroups');
const first = curSlide().objects[0].id; select([first]); await wait(20);
UI.selectTab('tp-format'); await wait(20); document.querySelectorAll('#props .aero-btn').forEach(b => { if (b.textContent === 'Front') b.click(); });
ok(curSlide().objects[curSlide().objects.length - 1].id === first, 'bring to front (Format panel button)');
// --- table operations
const tb = Model.table(100, 100, 600, 3, 3); curSlide().objects.push(tb); commit('t');
UI.tableOp(byId(tb.id), 'rowBelow', { r: 2, c: 0 }); UI.tableOp(byId(tb.id), 'colRight', { r: 0, c: 0 });
ok(byId(tb.id).rows.length === 4 && byId(tb.id).cols.length === 4 && byId(tb.id).rows.every(r => r.cells.length === 4), 'table insert row/column');
Editor.beginEdit(byId(tb.id), { cell: { r: 1, c: 1 } }); document.execCommand('insertText', false, '42'); Editor.endEdit(true);
ok(Model.plainText(byId(tb.id).rows[1].cells[1].text) === '42', 'table cell edited in place');
// --- animations & player state
const sa = S.doc.slides.find(x => x.objects.some(o => o.type === 'chart')); const steps = Anim.build(sa);
ok(steps.length === 2 && steps[0].items.length === 1 && steps[1].items.length === 3, 'animation steps (with / click / after chain)', steps.map(s => s.items.map(i => [i.t0, i.t1])));
const st0 = Anim.state(S.doc, sa, steps, 0, null);
ok(st0.get(sa.anims[1].target) && st0.get(sa.anims[1].target).hidden === true, 'entrance objects hidden before their click');
const stEnd = Anim.state(S.doc, sa, steps, steps.length, null); ok(stEnd.size === 0, 'all visible after last step');
const mid = Anim.state(S.doc, sa, steps, 1, 0.25); const m = mid.get(sa.anims[1].target); ok(m && m.dx > 0, 'fly-in from right is mid-flight', m);
// --- slide show
Present.start(S.doc.slides.indexOf(sa)); await wait(500);
ok(!document.getElementById('show').hidden, 'slide show opens');
Present.cmd('next'); await wait(900); Present.cmd('next'); await wait(100);
const showCv = document.getElementById('showcv'); ok(showCv.width > 0, 'show canvas sized', [showCv.width, showCv.height]);
window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await wait(50); ok(document.getElementById('show').hidden, 'Esc ends the show');
Present.start(0, true); await wait(500);
ok(!document.getElementById('pres').hidden && document.getElementById('pnotes').textContent.startsWith('Welcome'), 'presenter view shows notes', document.getElementById('pnotes').textContent.slice(0, 30));
Present.cmd('next'); await wait(1300);
ok(/Slide [12] of 9/.test(document.getElementById('pnum').textContent), 'presenter counter', document.getElementById('pnum').textContent);
} catch (e) { R.push([false, 'EXCEPTION ' + e.message, e.stack]); }
return JSON.stringify({ pass: R.filter(r => r[0]).length, fail: R.filter(r => !r[0]), errors });
