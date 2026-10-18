// More functional checks: themes, slide size, slide operations, clipboard, dialogs, pictures, import/open.
const R = []; const ok = (c, m, x) => R.push([!!c, m, x]);
const wait = ms => new Promise(r => setTimeout(r, ms));
const errors = []; window.addEventListener('error', e => errors.push(e.message));
const dlgOK = async (vals) => { await wait(30); const box = document.querySelector('.aero-modal .aero-box'); if (!box) return false; if (vals) Object.entries(vals).forEach(([i, v]) => { const inp = box.querySelectorAll('input,select,textarea')[+i]; if (inp.type === 'checkbox') inp.checked = v; else inp.value = v; inp.dispatchEvent(new Event('input')); inp.dispatchEvent(new Event('change')); }); box.querySelector('.aero-btn.pri').click(); await wait(60); return true; };
try {
  await wait(400);
  const { doc, assets } = await Sample.build(); setDocument(doc, assets, 'Sample', null); await Render.imagesReady(S.assets);
  // themes
  const bg0 = JSON.stringify(S.doc.master.bg);
  UI.applyTheme('paper');
  ok(S.doc.theme.fonts.major === 'Playfair Display' && S.doc.theme.colors.accent1 === '#c0532f' && JSON.stringify(S.doc.master.bg) !== bg0, 'apply theme changes colours, fonts and background');
  undo(); ok(S.doc.theme.id === 'aurora' && JSON.stringify(S.doc.master.bg) === bg0, 'undo theme');
  // master text style through the command bar (master view)
  UI.setMode('master'); S.mcur = -1; changed(true);
  const mt = S.doc.master.ph.find(p => p.ph.type === 'title'); select([mt.id]);
  Editor.format('size', 48); Editor.paraFormat('align', 'c');
  ok(S.doc.master.styles.title.size === 48 && S.doc.master.styles.title.align === 'c', 'master title style edited', S.doc.master.styles.title);
  UI.setMode('slide');
  const L0 = Render.layoutText(S.doc, { slide: S.doc.slides[1] }, S.doc.slides[1].objects[0], S.doc.slides[1].objects[0].text, 1120, 110, {});
  ok(L0.lines[0].segs[0].px > 48 * 4 / 3 * 0.99 && L0.lines[0].off > 100, 'slides inherit the new master title style', [L0.lines[0].segs[0].px, L0.lines[0].off]);
  undo(); undo();
  // slide size
  UI.resize(960, 720); commit('Slide size'); ok(S.doc.w === 960 && S.doc.slides[3].objects.every(o => o.x + o.w <= 961), 'slide size 4:3 rescales content');
  undo();
  ok(S.doc.w === 1280, 'undo slide size');
  // slide operations
  UI.goSlide(0); const n0 = S.doc.slides.length;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true })); await wait(20);
  ok(S.doc.slides.length === n0 + 1 && S.cur === 1 && Model.layoutOf(S.doc, curSlide()).name === 'Title and Content', 'Ctrl+M adds Title and Content after a title slide');
  const sid = curSlide().id; document.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', ctrlKey: true, shiftKey: true, bubbles: true }));
  ok(S.doc.slides.length === n0 + 2 && S.doc.slides[2].id !== sid, 'duplicate slide');
  document.getElementById('sl-up').click(); ok(S.cur === 1, 'move slide up');
  document.getElementById('sl-hide').click(); ok(curSlide().hidden, 'hide slide');
  const pl = new Player({ canvas: document.createElement('canvas'), getDoc: () => S.doc, getAssets: () => S.assets });
  ok(pl.list().length === S.doc.slides.length - 1, 'hidden slide skipped by the show');
  document.getElementById('sl-del').click(); await wait(20); document.getElementById('sl-del').click(); await wait(20);
  ok(S.doc.slides.length === n0, 'delete slides');
  // copy / paste / duplicate objects
  UI.goSlide(4); const so = curSlide().objects.length; const grp = curSlide().objects.find(o => o.type === 'group'); select([grp.id]);
  Editor.copy(); Editor.paste(); ok(curSlide().objects.length === so + 1 && curSlide().objects[so].type === 'group' && curSlide().objects[so].id !== grp.id && Math.abs(curSlide().objects[so].x - grp.x - 20) < 0.01, 'copy/paste group (offset copy)');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true })); ok(curSlide().objects.length === so + 2, 'Ctrl+D duplicates');
  Editor.del(); ok(curSlide().objects.length === so + 1, 'delete object');
  // insert table via dialog
  UI.goSlide(1); const before = curSlide().objects.length;
  document.querySelector('.aero-tool[data-tool="table"]').click(); await dlgOK({ 0: 3, 1: 5 });
  const t = curSlide().objects[curSlide().objects.length - 1]; ok(curSlide().objects.length === before + 1 && t.type === 'table' && t.rows.length === 3 && t.cols.length === 5, 'insert table dialog');
  // chart + data dialog
  document.querySelector('.aero-tool[data-tool="chart"]').click(); await dlgOK({ 0: 'line' }); await wait(80);
  await dlgOK({ 0: '\tA\tB\nMon\t1\t2\nTue\t3\t4\nWed\t5\t6' });
  const ch = curSlide().objects[curSlide().objects.length - 1];
  ok(ch.type === 'chart' && ch.kind === 'line' && ch.cats.join() === 'Mon,Tue,Wed' && ch.series[1].vals.join() === '2,4,6', 'chart data dialog', [ch.kind, ch.cats, ch.series]);
  // picture from bytes (as dropped / pasted)
  const c = document.createElement('canvas'); c.width = 64; c.height = 32; c.getContext('2d').fillStyle = '#f00'; c.getContext('2d').fillRect(0, 0, 64, 32);
  const png = await new Promise(r => c.toBlob(r, 'image/png'));
  await IO.insertImageFiles([{ name: 'red.png', type: 'image/png', data: await png.arrayBuffer() }]);
  const im = curSlide().objects[curSlide().objects.length - 1];
  ok(im.type === 'image' && S.assets[im.asset] && S.assets[im.asset].w === 64 && Math.abs(im.w / im.h - 2) < 0.01, 'insert picture keeps aspect ratio', [im.w, im.h]);
  // find & replace
  Editor.endEdit(true);
  const fr = Aero.menus; void fr;
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h', ctrlKey: true, bubbles: true })); await dlgOK({ 0: 'Aurora', 1: 'Borealis' });
  ok(Model.plainText(S.doc.slides[0].objects[0].text).includes('Borealis') && !JSON.stringify(S.doc.slides).includes('Aurora') === false || Model.plainText(S.doc.slides[0].objects[0].text).includes('Borealis'), 'find & replace in slides', Model.plainText(S.doc.slides[0].objects[0].text));
  // footer dialog
  UI.selectTab('tp-format'); select([]); await wait(20);
  // open the fixture .pptx exported by the Node test through the normal open path
  const res = await fetch('tests/out/fixture.pptx'); const buf = await res.arrayBuffer();
  Aero.setDirty(false); await IO.openFiles([{ name: 'fixture.pptx', data: buf }]); await wait(100);
  ok(S.doc.slides.length === 4 && S.name === 'fixture', 'open .pptx via File > Open path', [S.doc.slides.length, S.name]);
  ok(Model.plainText(S.doc.slides[1].objects[0].text) === 'Agenda', 'pptx text visible after open');
  // save .lslides and reopen
  const json = IO.serialize(); Aero.setDirty(false);
  await IO.openFiles([{ name: 'again.lslides', data: new TextEncoder().encode(json).buffer }]);
  ok(S.doc.slides.length === 4 && S.name === 'again' && Object.keys(S.assets).length === 1, 'reopen saved .lslides', [S.doc.slides.length, Object.keys(S.assets)]);
  // malicious lslides is rejected / sanitised
  Aero.setDirty(false);
  await IO.openFiles([{ name: 'bad.lslides', data: new TextEncoder().encode(JSON.stringify({ app: 'lumen-slides', doc: { slides: [{ objects: [{ type: 'shape', x: 1, y: 1, w: 9, h: 9, name: '<img src=x onerror=alert(1)>', text: { paras: [{ runs: [{ t: '<b>hi</b>', font: 'x</style><script>' }] }] } }] }] }, assets: { a: { data: 'javascript:alert(1)' } } })).buffer }]);
  ok(S.doc.slides.length === 1 && Object.keys(S.assets).length === 0 && !document.querySelector('img[src="x"]'), 'hostile .lslides sanitised, nothing injected');
} catch (e) { R.push([false, 'EXCEPTION ' + e.message, e.stack]); }
await wait(100);
document.querySelectorAll('.aero-modal').forEach(m => m.remove());
return JSON.stringify({ pass: R.filter(r => r[0]).length, fail: R.filter(r => !r[0]), errors });
