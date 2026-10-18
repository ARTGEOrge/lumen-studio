// Headless in-app test for Lumen Write (run through tools/shot, see tests/README in the report):
//   cd C:/code/lumen-studio/tools/shot && SHOT_URL=http://localhost:5180/write/ SHOT_JS=C:/code/lumen-studio/write/tests/app.test.js \
//     C:/code/lumen-photo/node_modules/electron/dist/electron.exe .
// Body of an async function; returns a JSON summary.
for (let i = 0; i < 200 && !window.__writeReady; i++) await new Promise(r => setTimeout(r, 100));
const out = { pass: 0, fail: 0, failures: [], info: {} };
const ok = (c, m) => { if (c) out.pass++; else { out.fail++; out.failures.push(m); } };
const tick = () => new Promise(r => setTimeout(r, 30));
const captured = {};
Aero.saveFile = async ({ name, data }) => { captured[name.split('.').pop()] = data; return name; };
Aero.alert = async (t, m) => { out.failures.push('ALERT ' + t + ': ' + m); out.fail++; };
const g = () => Pager.G();

// ---- pagination invariant: every line box of text sits inside one page's content area ----
function checkPagination(label) {
  const G = g(); const er = S.ed.getBoundingClientRect(); const z = S.zoom;
  const sheets = [...document.querySelectorAll('#sheets .page')];
  const fnH = sheets.map(s => { const f = s.querySelector('.fnarea'); return f && f.classList.contains('on') ? f.getBoundingClientRect().height / z : 0; });
  let bad = 0, worst = null, lines = 0;
  const w = document.createTreeWalker(S.ed, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentNode.closest('.pg-gap') || !n.nodeValue.trim() ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const rg = document.createRange();
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    rg.selectNodeContents(n);
    for (const r of rg.getClientRects()) {
      if (r.height <= 0) continue; lines++;
      const top = (r.top - er.top) / z, bot = (r.bottom - er.top) / z;
      const k = Math.floor((top + G.mt + Pager.GAP / 2) / G.pitch);
      const ct = k * G.pitch, cb = ct + G.ch - (fnH[k] || 0);
      if (top < ct - 3 || bot > cb + 3) { bad++; if (!worst) worst = { text: n.nodeValue.slice(0, 40), page: k + 1, top: Math.round(top - ct), bot: Math.round(bot - cb) }; }
    }
  }
  ok(bad === 0, `${label}: ${bad} line fragments outside the page content area ${JSON.stringify(worst)}`);
  return { lines, bad };
}
const pageOfEl = el => Pager.pageOfClientY(el.getBoundingClientRect().top + 1);

// 1. sample
out.info.samplePages = S.pages;
ok(S.pages >= 3, 'sample has several pages: ' + S.pages);
out.info.samplePag = checkPagination('sample');
// headers/footers: first page has none (different first page), page 2 footer says "Page 2 of N"
const sh = [...document.querySelectorAll('#sheets .page')];
ok(sh[0].querySelector('.ftr').textContent.trim() === '', 'no footer on first page');
ok(sh[1].querySelector('.ftr').textContent.includes(`Page 2 of ${S.pages}`), 'footer page field: ' + sh[1].querySelector('.ftr').textContent);
ok(sh[1].querySelector('.hdr').textContent.includes('Riverside Library Renovation'), 'header text');
// footnotes on the page of their reference, numbered in order
const refs = [...S.ed.querySelectorAll('sup.fn')];
ok(refs.map(r => r.textContent).join(',') === refs.map((r, i) => i + 1).join(','), 'footnotes numbered 1..n');
for (const r of refs) { const p = pageOfEl(r); const note = sh[p].querySelector(`.fnote[data-fn="${r.dataset.fn}"]`); ok(!!note, `footnote ${r.textContent} text on page ${p + 1}`); }
// TOC numbers match where the headings really are
for (const e of Pager.last.toc) ok(e.page === pageOfEl(e.el) + 1, `TOC page for "${e.text}" ${e.page} vs ${pageOfEl(e.el) + 1}`);
// keep-with-next: no heading is the last line on a page
for (const h of S.ed.querySelectorAll('h1,h2,h3')) { const nx = h.nextElementSibling; if (!nx || nx.classList.contains('pg-gap')) { ok(!nx || false, 'heading followed directly by a page gap: ' + h.textContent); } }

// 2. page break forces a new page
const bud = [...S.ed.querySelectorAll('h1')].find(h => /Budget/.test(h.textContent));
Ed.placeCaretIn(bud, 'start'); S.ed.focus();
Ed.pageBreak(); await tick();
const bud2 = [...S.ed.querySelectorAll('h1')].find(h => /Budget/.test(h.textContent));
const er = S.ed.getBoundingClientRect(); const y = (bud2.getBoundingClientRect().top - er.top) / S.zoom;
ok(Math.abs(y - Math.round(y / g().pitch) * g().pitch) < 2, 'block after a page break starts at the top of a page: ' + y.toFixed(1));
checkPagination('after page break');
App.undo(); await tick();
ok(!S.ed.querySelector('div.pbreak'), 'undo removes the page break');

// 3. typing keeps the caret and repaginates
const firstP = S.ed.querySelector('p:not([data-s])');
Ed.placeCaretIn(firstP, 'end'); S.ed.focus();
const lenBefore = firstP.textContent.length;
document.execCommand('insertText', false, ' Added words.'); await tick();
const sel = getSelection();
ok(firstP.textContent.length === lenBefore + 13, 'typed text inserted');
ok(sel.anchorNode && firstP.contains(sel.anchorNode) && sel.toString() === '', 'caret stays in the paragraph after repagination');
App.flushTyping(); App.undo(); await tick();
ok(S.ed.querySelector('p:not([data-s])').textContent.length === lenBefore, 'undo typing');
App.redo(); await tick(); App.undo(); await tick();

// 4. long document: performance + invariant
const big = Model.newDoc(); big.blocks = [];
const lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. ';
for (let i = 0; i < 400; i++) {
  if (i % 25 === 0) big.blocks.push({ t: 'p', style: 'Heading1', runs: [{ t: 'text', text: 'Chapter ' + (i / 25 + 1) }] });
  if (i % 40 === 7) big.blocks.push({ t: 'table', rows: Array.from({ length: 12 }, (_, r) => ({ ...(r ? {} : { h: true }), cells: [0, 1, 2].map(c => ({ blocks: [{ t: 'p', style: 'Normal', runs: [{ t: 'text', text: `R${r} C${c} ` + (c === 2 ? lorem.slice(0, 60 + (r * 13) % 90) : '') }] }] })) })) });
  big.blocks.push({ t: 'p', style: 'Normal', runs: [{ t: 'text', text: lorem.repeat(1 + (i % 4)) }, ...(i % 30 === 3 ? [{ t: 'fn', id: 'f' + i }] : [])] });
  if (i % 30 === 3) big.notes['f' + i] = 'A footnote for paragraph ' + i + '. ' + lorem.slice(0, (i % 3) * 80);
  if (i % 50 === 20) for (let k = 0; k < 6; k++) big.blocks.push({ t: 'p', style: 'Normal', list: { kind: k % 2 ? 'ul' : 'ol', level: k % 3 }, runs: [{ t: 'text', text: 'List item ' + k + ' ' + lorem.slice(0, 40 + k * 30) }] });
}
await App.setDocument(big, 'Big', null); await tick();
const t0 = performance.now(); Pager.run(); const dt = performance.now() - t0;
out.info.bigPages = S.pages; out.info.bigRepaginateMs = Math.round(dt);
ok(S.pages > 60, 'long document paginates to many pages: ' + S.pages);
ok(dt < 1500, 'repagination of a long document takes ' + Math.round(dt) + ' ms');
out.info.bigPag = checkPagination('long document');
// table rows split across pages: no row straddles
let straddle = 0; S.ed.querySelectorAll('tr:not(.pg-gap)').forEach(tr => { const a = Pager.pageOfClientY(tr.getBoundingClientRect().top + 1), b = Pager.pageOfClientY(tr.getBoundingClientRect().bottom - 1); if (a !== b) straddle++; });
ok(straddle === 0, 'table rows never straddle pages: ' + straddle);
// typing in the middle of a long doc
const mid = S.ed.children[Math.floor(S.ed.children.length / 2)];
Ed.placeCaretIn(mid, 'end'); S.ed.focus();
const t1 = performance.now(); document.execCommand('insertText', false, ' more'); const dt2 = performance.now() - t1;
out.info.bigTypingMs = Math.round(dt2); Pager.run();
checkPagination('long document after typing');
// zoom does not change pagination
const gaps1 = S.ed.querySelectorAll('.pg-gap').length; UI.setZoom(1.5); Pager.run(); const gaps2 = S.ed.querySelectorAll('.pg-gap').length; UI.setZoom(0.75); Pager.run();
ok(gaps1 === gaps2, `pagination independent of zoom ${gaps1} vs ${gaps2}`);
checkPagination('zoom 75%');
UI.setZoom(1);

// 5. formatting through the AST transform
await App.setDocument({ ...Model.newDoc(), blocks: [{ t: 'p', style: 'Normal', runs: [{ t: 'text', text: 'Alpha beta gamma delta.' }] }, { t: 'p', style: 'Normal', runs: [{ t: 'text', text: 'Second paragraph here.' }] }] }, 'Fmt', null);
const p1 = S.ed.querySelector('p'); const tn = p1.firstChild;
const selRange = (n, a, b) => { const r = document.createRange(); r.setStart(n, a); r.setEnd(n, b); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
selRange(tn, 6, 10); S.ed.focus();
const before = App.cleanHtml();
Ed.toggle('b'); await tick();
ok(/<b>beta<\/b>/.test(S.ed.innerHTML), 'bold applied: ' + S.ed.querySelector('p').innerHTML);
ok(getSelection().toString() === 'beta', 'selection kept after formatting: ' + getSelection().toString());
Ed.setRunProp('color', '#c00000', 'Color'); await tick();
ok(/color: ?(#c00000|rgb\(192, 0, 0\))/.test(S.ed.innerHTML), 'color span');
Ed.toggle('b'); await tick();
ok(!/<b>/.test(S.ed.innerHTML), 'bold toggled off');
App.undo(); App.undo(); App.undo(); await tick();
ok(App.cleanHtml() === before, 'three undos restore the original HTML');
App.redo(); await tick(); ok(/<b>beta<\/b>/.test(S.ed.innerHTML), 'redo');
// paragraph style, alignment, lists, indent
Ed.placeCaretIn(S.ed.querySelector('p'), 'start'); Ed.paraStyle('Heading2'); await tick();
ok(S.ed.firstElementChild.nodeName === 'H2', 'paragraph style -> h2');
Ed.align('center'); ok(S.ed.firstElementChild.style.textAlign === 'center', 'align center');
const r2 = document.createRange(); r2.setStart(S.ed.firstElementChild, 0); r2.setEnd(S.ed.lastElementChild, 1); getSelection().removeAllRanges(); getSelection().addRange(r2);
Ed.toggleList('ol'); await tick();
ok(S.ed.querySelectorAll('ol > li').length === 2, 'numbered list from two paragraphs: ' + S.ed.innerHTML.slice(0, 200));
Ed.placeCaretIn(S.ed.querySelectorAll('li')[1], 'start'); Ed.indent(1); await tick();
ok(S.ed.querySelector('li ol li, li ul li'), 'indent nests the list item');
Ed.toggleList('ol'); await tick();
// 6. tables
await App.setDocument({ ...Model.newDoc(), blocks: [{ t: 'p', style: 'Normal', runs: [{ t: 'text', text: 'Before table' }] }] }, 'Tbl', null);
Ed.placeCaretIn(S.ed.querySelector('p'), 'end'); S.ed.focus();
Ed.table(3, 3); await tick();
const T = () => S.ed.querySelector('table');
ok(T() && T().rows.length === 3 && T().rows[0].cells.length === 3, 'insert 3x3 table');
Ed.placeCaretIn(T().rows[1].cells[1], 'start');
Ed.tableOp('rowBelow'); ok(T().rows.length === 4, 'row below');
Ed.placeCaretIn(T().rows[1].cells[1], 'start'); Ed.tableOp('colRight'); ok(T().rows[0].cells.length === 4, 'column right');
Ed.placeCaretIn(T().rows[1].cells[0], 'start'); Ed.tableOp('mergeRight'); ok(T().rows[1].cells[0].colSpan === 2, 'merge right');
Ed.placeCaretIn(T().rows[1].cells[0], 'start'); Ed.tableOp('split'); ok(T().rows[1].cells[0].colSpan === 1 && T().rows[1].cells.length === 4, 'split merged cell');
Ed.placeCaretIn(T().rows[1].cells[2], 'start'); Ed.tableOp('mergeDown'); ok(T().rows[1].cells[2].rowSpan === 2 && T().rows[2].cells.length === 3, 'merge down');
Ed.placeCaretIn(T().rows[1].cells[2], 'start'); Ed.tableOp('split'); ok(T().rows[1].cells[2].rowSpan === 1 && T().rows[2].cells.length === 4, 'split vertical merge');
Ed.placeCaretIn(T().rows[3].cells[0], 'start'); Ed.tableOp('delRow'); ok(T().rows.length === 3, 'delete row');
Ed.placeCaretIn(T().rows[0].cells[3], 'start'); Ed.tableOp('delCol'); ok(T().rows[0].cells.length === 3, 'delete column');
const astT = App.toAst(); ok(astT.blocks.some(b => b.t === 'table' && b.rows.length === 3), 'table in AST');

// 7. track changes via beforeinput events
await App.setDocument({ ...Model.newDoc(), blocks: [{ t: 'p', style: 'Normal', runs: [{ t: 'text', text: 'The quick brown fox.' }] }] }, 'Track', null);
S.track = true; S.author = 'Tester';
const tp = S.ed.querySelector('p');
selRange(tp.firstChild, 4, 9); S.ed.focus();   // "quick"
S.ed.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'slow', cancelable: true, bubbles: true }));
await tick();
ok(S.ed.querySelector('del') && S.ed.querySelector('del').textContent === 'quick', 'replacing text marks it deleted: ' + S.ed.innerHTML);
ok(S.ed.querySelector('ins') && S.ed.querySelector('ins').textContent === 'slow', 'typed text is an insertion');
S.ed.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: 'er', cancelable: true, bubbles: true }));
ok(S.ed.querySelectorAll('ins').length === 1 && S.ed.querySelector('ins').textContent === 'slower', 'consecutive typing extends the insertion');
S.ed.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', cancelable: true, bubbles: true }));
ok(S.ed.querySelector('ins').textContent === 'slowe', 'backspace inside own insertion really deletes');
// delete existing text with the caret at the end of "brown"
const brownNode = [...S.ed.querySelector('p').childNodes].find(n => n.nodeType === 3 && n.nodeValue.includes('brown'));
const bi = brownNode.nodeValue.indexOf('brown') + 5; const cr = document.createRange(); cr.setStart(brownNode, bi); cr.collapse(true); getSelection().removeAllRanges(); getSelection().addRange(cr);
for (let k = 0; k < 5; k++) S.ed.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', cancelable: true, bubbles: true }));
const dels = [...S.ed.querySelectorAll('del')].map(d => d.textContent);
ok(dels.includes('brown'), 'backspacing over text marks it deleted: ' + dels.join('|'));
ok(Review.changes().length === 3, 'three changes listed: ' + Review.changes().length);
ok(S.ed.querySelector('ins').dataset.au === 'Tester', 'change author');
// round trip through docx keeps tracked changes
const astTr = App.toAst(); const dx = Docx.writeDocx(astTr, { fflate }); const back = Docx.readDocx(dx, { fflate });
const runs = back.blocks[0].runs;
ok(runs.some(r => r.ins && r.text === 'slowe') && runs.some(r => r.del && r.text === 'quick') && runs.some(r => r.del && r.text === 'brown'), 'tracked changes survive .docx');
Review.act(true, 'all'); await tick();
ok(!S.ed.querySelector('ins,del') && S.ed.querySelector('p').textContent === 'The slowe  fox.', 'accept all: ' + S.ed.querySelector('p').textContent);
App.undo(); await tick(); ok(S.ed.querySelectorAll('ins,del').length === 3, 'undo accept all');
Review.act(false, 'all'); await tick();
ok(S.ed.querySelector('p').textContent === 'The quick brown fox.', 'reject all restores: ' + S.ed.querySelector('p').textContent);
S.track = false;

// 8. comments
selRange(S.ed.querySelector('p').firstChild, 10, 15); S.ed.focus();
const cid = 'cTest'; S.doc.comments[cid] = { author: 'Tester', date: new Date().toISOString(), text: 'Is it brown?' };
Ed.transform({ label: 'New Comment', fnRun: run => { run.cm = [cid]; } }); await tick();
ok(S.ed.querySelector('span.cm[data-c="cTest"]').textContent === 'brown', 'comment anchor');
ok(document.querySelectorAll('#balloons .balloon').length === 1, 'comment balloon in the margin');
const cd = Docx.readDocx(Docx.writeDocx(App.toAst(), { fflate }), { fflate });
ok(Object.values(cd.comments).some(c => c.text === 'Is it brown?'), 'comment survives .docx');
Review.deleteComment(cid); ok(!S.ed.querySelector('span.cm'), 'delete comment');

// 9. find & replace
await App.setDocument({ ...Model.newDoc(), blocks: [{ t: 'p', style: 'Normal', runs: [{ t: 'text', text: 'cat Cat cat' }, { t: 'text', text: ' cat', b: true }] }, { t: 'p', style: 'Normal', runs: [{ t: 'text', text: 'concatenate cat.' }] }] }, 'Find', null);
Find.open(true); document.querySelector('#f-q').value = 'cat'; document.querySelector('#f-word').checked = true; Find.search();
ok(Find.count === 5, 'whole-word matches (case-insensitive): ' + Find.count);
document.querySelector('#f-case').checked = true; Find.search(); ok(Find.count === 4, 'match case: ' + Find.count);
document.querySelector('#f-r').value = 'dog'; Find.replaceAll(); await tick();
ok(S.ed.textContent.replace(/\s+/g, ' ').includes('dog Cat dog dog') && S.ed.textContent.includes('concatenate dog.'), 'replace all: ' + S.ed.textContent);
ok(S.ed.querySelector('b') && S.ed.querySelector('b').textContent.trim() === 'dog', 'replacement keeps formatting');
Find.close();

// 10. sanitising imported HTML
const evil = '<p onclick="alert(1)">Hi <a href="javascript:alert(2)">x</a><img src="x" onerror="alert(3)"><script>alert(4)</script><style>body{}</style><iframe src="https://example.com"></iframe></p><p style="color:red;background:url(https://example.com/t.png)">styled</p>';
const eb = await IO.htmlToBlocks(evil); const eh = Model.blocksHtml(eb, { src: App.src });
ok(!/onclick|onerror|javascript:|<script|<iframe|<style|url\(/i.test(eh), 'imported HTML is sanitised: ' + eh);
// untrusted .lwrite style values are validated
const bad = { format: 'lumen-write', version: 1, ...Model.newDoc(), styles: { para: { Normal: { name: 'N', font: 'x;}body{background:url(http://e/)', color: 'red;}*{', size: 'big' } }, char: {} } };
const cleaned = IO.cleanDoc(bad);
ok(!/[;{}]/.test(JSON.stringify(cleaned.styles.para.Normal.font)) && !cleaned.styles.para.Normal.color?.includes(';'), 'style values validated');

// 11. exports and round trips
const sample = await Sample.build();
await App.setDocument(sample, 'Riverside Library Proposal', null); await tick();
const pages0 = S.pages, html0 = App.cleanHtml();
for (const k of ['docx', 'odt', 'html', 'md', 'txt', 'pdf']) await IO.exportAs(k);
ok(captured.docx && captured.docx[0] === 0x50, 'docx exported');
ok(captured.odt && captured.odt[0] === 0x50, 'odt exported');
ok(typeof captured.html === 'string' && captured.html.includes('<h1>Executive summary</h1>') && captured.html.includes('data:image/png;base64'), 'html exported');
ok(typeof captured.md === 'string' && captured.md.includes('# Executive summary') && /\| Item \| Phase \| Start \| Cost \|/.test(captured.md) && /\[\^1\]: Visitor counts/.test(captured.md), 'markdown exported');
ok(typeof captured.txt === 'string' && captured.txt.includes('Riverside Library Renovation') && captured.txt.includes('1. Board approval'), 'text exported');
const pdfBytes = captured.pdf; const pdfStr = pdfBytes ? new TextDecoder('latin1').decode(pdfBytes) : '';
ok(pdfStr.startsWith('%PDF-'), 'pdf exported');
const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
ok(pdfDoc.getPageCount() === pages0, `pdf has the same page count ${pdfDoc.getPageCount()} vs ${pages0}`);
const fnames = []; for (const [, o] of pdfDoc.context.enumerateIndirectObjects()) { if (o instanceof PDFLib.PDFDict && o.get(PDFLib.PDFName.of('Type')) === PDFLib.PDFName.of('FontDescriptor')) fnames.push(String(o.get(PDFLib.PDFName.of('FontName')))); }
out.info.pdfFonts = fnames;
ok(fnames.some(f => /SourceSerif4/.test(f)) && fnames.some(f => /Montserrat/.test(f)), 'pdf embeds the document fonts');
ok(Math.abs(pdfDoc.getPage(0).getWidth() - 595.28) < 0.1, 'pdf page size A4');
out.info.pdfKB = Math.round(pdfBytes.length / 1024);
ok(App.cleanHtml() === html0, 'export leaves the document unchanged');
// open the exported files again
await IO.openFile({ name: 'x.docx', data: captured.docx.buffer.slice(captured.docx.byteOffset, captured.docx.byteOffset + captured.docx.byteLength) }); await tick();
out.info.docxReopenPages = S.pages;
ok(Math.abs(S.pages - pages0) <= 1, `re-opened docx paginates like the original ${S.pages} vs ${pages0}`);
ok(S.ed.querySelectorAll('table').length === 1 && S.ed.querySelectorAll('img').length === 2 && S.ed.querySelectorAll('sup.fn').length === 3 && S.ed.querySelector('div.toc') && S.ed.querySelectorAll('ins,del').length === 2 && Review.commentAnchors().size === 2, 'docx re-open keeps table, pictures, notes, TOC, changes, comments');
ok(S.ed.querySelector('img[data-wrap="right"]'), 'picture wrap survives docx');
checkPagination('re-opened docx');
await IO.openFile({ name: 'x.odt', data: captured.odt.buffer.slice(captured.odt.byteOffset, captured.odt.byteOffset + captured.odt.byteLength) }); await tick();
ok(S.ed.querySelectorAll('h1').length >= 5 && S.ed.querySelectorAll('table').length === 1 && S.ed.querySelectorAll('img').length === 2, 'odt re-opens');
await IO.openFile({ name: 'x.html', data: new TextEncoder().encode(captured.html).buffer }); await tick();
ok(S.ed.querySelectorAll('h1').length >= 5 && S.ed.querySelectorAll('img').length === 2 && S.ed.querySelectorAll('table').length === 1, 'html re-opens with pictures');
await IO.openFile({ name: 'x.md', data: new TextEncoder().encode(captured.md).buffer }); await tick();
ok(S.ed.querySelectorAll('h1').length >= 5 && S.ed.querySelectorAll('table').length === 1 && S.ed.querySelectorAll('ol li').length >= 4, 'markdown re-opens');
// own format round trip is lossless
await App.setDocument(await Sample.build(), 'S', null); await tick();
const js = IO.serialize(); const h1 = App.cleanHtml();
await IO.openFile({ name: 'x.lwrite', data: new TextEncoder().encode(js).buffer }); await tick();
const norm = h => h.replace(/src="blob:[^"]+"/g, '').replace(/data-a="[^"]+"/g, '');
ok(norm(App.cleanHtml()) === norm(h1), '.lwrite round trip is lossless');
ok(S.pages === pages0, '.lwrite re-open page count');
// mammoth fallback for a docx our reader rejects
const fake = fflate.zipSync({ '[Content_Types].xml': fflate.strToU8('<Types/>'), 'word/document.xml': fflate.strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hello mammoth</w:t></w:r></w:p></w:body></w:document>') });
out.info.mammoth = 'skipped';
await App.setDocument(await Sample.build(), 'Riverside Library Proposal', null);
out.info.consoleErrors = window.__errs || 0;
return JSON.stringify(out);
