'use strict';
// Node test: AST -> .docx -> AST round trip with structure checks, plus OOXML well-formedness.
// Run: node C:/code/lumen-studio/write/tests/docx-roundtrip.test.js
const path = require('path');
const DEPS = 'C:/code/lumen-studio/tools/deps/convert/node_modules/';
const { DOMParser } = require(DEPS + '@xmldom/xmldom');
const fflate = require('../vendor/fflate.js');
globalThis.fflate = fflate;
const Model = require('../js/model.js');
const Docx = require('../js/docx.js');
const Odt = (() => { try { return require('../js/odt.js'); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; return null; } })();
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.log('FAIL ' + msg); } };
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(q => [q, x[q]])) : x);
const eq = (a, b, msg) => ok(canon(a) === canon(b), `${msg}\n   got ${JSON.stringify(a)}\n  want ${JSON.stringify(b)}`);

// 1x1 PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
function sampleAst() {
  const d = Model.newDoc();
  d.page = { size: 'Letter', w: 612, h: 792, mt: 72, mb: 64.8, ml: 90, mr: 90, hd: 36, fd: 30, start: 3 };
  d.header = { l: 'Annual Report', c: '', r: '{title}' };
  d.footer = { l: '', c: 'Page {page} of {pages}', r: '' };
  d.hfFirst = true;
  d.meta = { title: 'Round Trip', author: 'Ada Lovelace' };
  d.styles.para.Heading1.color = '#123456';
  d.styles.para.Normal.size = 10.5;
  d.styles.para.S_Callout = { name: 'Callout', font: 'Lora', size: 12, color: '#7a2e0e', b: true, sb: 6, sa: 6, lh: 1.3 };
  d.assets.im1 = { mime: 'image/png', data: PNG };
  d.notes.n1 = 'First footnote text.';
  d.notes.n2 = 'Second note with “quotes” & ampersand.';
  d.comments.c1 = { author: 'Grace Hopper', date: '2026-01-02T03:04:05Z', text: 'Check this figure.\nSecond line.' };
  d.blocks = [
    { t: 'p', style: 'Title', runs: [{ t: 'text', text: 'Round Trip Report' }] },
    { t: 'toc' },
    { t: 'p', style: 'Heading1', runs: [{ t: 'text', text: 'Introduction' }] },
    { t: 'p', style: 'Normal', align: 'justify', runs: [
      { t: 'text', text: 'Plain, ' }, { t: 'text', text: 'bold', b: true }, { t: 'text', text: ' and ' }, { t: 'text', text: 'italic', i: true },
      { t: 'text', text: ' underlined', u: true }, { t: 'text', text: ' struck', s: true }, { t: 'text', text: 'H' }, { t: 'text', text: '2', sub: true }, { t: 'text', text: 'O x' }, { t: 'text', text: '2', sup: true },
      { t: 'text', text: ' red', color: '#c00000' }, { t: 'text', text: ' marked', bg: '#ffff00' }, { t: 'text', text: ' mono', font: 'DejaVu Sans Mono', size: 9 },
      { t: 'text', text: ' emph', cs: 'Emphasis' }, { t: 'text', text: ' link', link: 'https://example.com/a?b=1&c=2' }, { t: 'fn', id: 'n1' }, { t: 'text', text: ' after note.' }] },
    { t: 'p', style: 'Normal', ind: 36, fi: 18, runs: [{ t: 'text', text: 'Indented with ' }, { t: 'text', text: 'a comment', cm: ['c1'] }, { t: 'text', text: ' and' }, { t: 'br' }, { t: 'text', text: 'line break\tand tab' }] },
    { t: 'p', style: 'Normal', runs: [{ t: 'text', text: 'Tracked ' }, { t: 'text', text: 'inserted', ins: { au: 'Bob', dt: '2026-02-03T10:00:00Z' } }, { t: 'text', text: ' and ' }, { t: 'text', text: 'deleted', del: { au: 'Eve', dt: '2026-02-04T11:00:00Z' } }, { t: 'text', text: ' text.' }] },
    { t: 'p', style: 'S_Callout', runs: [{ t: 'text', text: 'A custom style paragraph.' }] },
    { t: 'p', style: 'Normal', list: { kind: 'ul', level: 0 }, runs: [{ t: 'text', text: 'Bullet one' }] },
    { t: 'p', style: 'Normal', list: { kind: 'ul', level: 1 }, runs: [{ t: 'text', text: 'Nested bullet' }] },
    { t: 'p', style: 'Normal', list: { kind: 'ul', level: 0 }, runs: [{ t: 'text', text: 'Bullet two' }] },
    { t: 'p', style: 'Normal', runs: [{ t: 'text', text: 'Between lists' }] },
    { t: 'p', style: 'Normal', list: { kind: 'ol', level: 0 }, runs: [{ t: 'text', text: 'First' }] },
    { t: 'p', style: 'Normal', list: { kind: 'ol', level: 1, fmt: 'upper-roman' }, runs: [{ t: 'text', text: 'Roman' }] },
    { t: 'p', style: 'Normal', list: { kind: 'ol', level: 0 }, runs: [{ t: 'text', text: 'Second' }, { t: 'fn', id: 'n2' }] },
    { t: 'pagebreak' },
    { t: 'p', style: 'Heading2', runs: [{ t: 'text', text: 'Data' }] },
    { t: 'table', widths: [50, 25, 25], rows: [
      { h: true, cells: [{ blocks: [{ t: 'p', style: 'Normal', runs: [{ t: 'text', text: 'Name' }] }] }, { blocks: [{ t: 'p', style: 'Normal', runs: [{ t: 'text', text: 'Q1' }] }] }, { blocks: [{ t: 'p', style: 'Normal', runs: [{ t: 'text', text: 'Q2' }] }] }] },
      { cells: [{ rs: 2, bg: '#e2efda', blocks: [{ t: 'p', style: 'Normal', runs: [{ t: 'text', text: 'Spans two rows' }] }] }, { cs: 2, blocks: [{ t: 'p', style: 'Normal', align: 'center', runs: [{ t: 'text', text: 'Spans two cols' }] }] }] },
      { cells: [{ blocks: [{ t: 'p', style: 'Normal', runs: [{ t: 'text', text: '1' }] }] }, { blocks: [{ t: 'p', style: 'Normal', runs: [{ t: 'text', text: '2' }] }, { t: 'p', style: 'Normal', runs: [{ t: 'text', text: 'second para' }] }] }] },
    ] },
    { t: 'p', style: 'Caption', runs: [{ t: 'img', asset: 'im1', w: 120, h: 80, wrap: 'inline', alt: 'Inline pic' }, { t: 'text', text: ' Figure 1' }] },
    { t: 'p', style: 'Normal', runs: [{ t: 'img', asset: 'im1', w: 90, h: 60, wrap: 'left', alt: 'Left pic' }, { t: 'text', text: 'Text wraps right of a left-floated picture.' }] },
    { t: 'p', style: 'Normal', runs: [{ t: 'img', asset: 'im1', w: 90, h: 60, wrap: 'right', alt: 'Right pic' }, { t: 'text', text: 'Right float.' }] },
    { t: 'p', style: 'Normal', runs: [{ t: 'img', asset: 'im1', w: 200, h: 100, wrap: 'center', alt: 'Centred' }] },
    { t: 'hr' },
    { t: 'p', style: 'Quote', runs: [{ t: 'text', text: 'Quoted <words> & more' }] },
    { t: 'p', style: 'Code', runs: [{ t: 'text', text: 'let x = 1;   // spaces' }] },
    { t: 'p', style: 'Heading3', runs: [{ t: 'text', text: 'Ünïcödé — 日本語 ✓' }] },
  ];
  return d;
}

const d0 = sampleAst();
const bytes = Docx.writeDocx(d0, { fflate, toc: [{ level: 1, text: 'Introduction', page: '3' }, { level: 2, text: 'Data', page: '4' }], date: '2026-10-17T00:00:00Z' });
ok(bytes[0] === 0x50 && bytes[1] === 0x4b, 'docx is a zip');
const files = fflate.unzipSync(bytes);
const names = Object.keys(files);
ok(names[0] === '[Content_Types].xml', 'content types first');
for (const n of ['word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/footnotes.xml', 'word/comments.xml', 'word/header1.xml', 'word/footer1.xml', 'word/header2.xml', 'word/settings.xml', 'docProps/core.xml', '_rels/.rels', 'word/_rels/document.xml.rels', 'word/media/image1.png'])
  ok(names.includes(n), 'part present: ' + n);
// every XML part must be well-formed
for (const n of names.filter(n => /\.xml$|\.rels$/.test(n))) {
  let err = null;
  const p = new DOMParser({ onError: (lvl, msg) => { if (lvl !== 'warning') err = msg; }, errorHandler: { error: m => { err = m; }, fatalError: m => { err = m; } } });
  try { p.parseFromString(fflate.strFromU8(files[n]), 'application/xml'); } catch (e) { err = e.message; }
  ok(!err, `well-formed XML ${n}: ${err}`);
}
const docXml = fflate.strFromU8(files['word/document.xml']);
ok(/<w:ins w:id="\d+" w:author="Bob"/.test(docXml), 'w:ins written');
ok(/<w:del [^>]*w:author="Eve"[^>]*><w:r>.*?<w:delText/.test(docXml), 'w:del with delText');
ok(/<w:commentRangeStart w:id="0"\/>/.test(docXml) && /<w:commentReference w:id="0"\/>/.test(docXml), 'comment range');
ok(/<w:footnoteReference w:id="1"\/>/.test(docXml) && /<w:footnoteReference w:id="2"\/>/.test(docXml), 'footnote refs');
ok(/w:docPartGallery w:val="Table of Contents"/.test(docXml) && /TOC \\o "1-3"/.test(docXml), 'TOC field');
ok(/<w:br w:type="page"\/>/.test(docXml), 'page break');
ok(/<wp:anchor[^>]*>.*?<wp:align>left<\/wp:align>.*?<wp:wrapSquare/.test(docXml), 'left anchored image');
ok(/<wp:wrapTopAndBottom\/>/.test(docXml), 'centred image wraps top and bottom');
ok(/<w:vMerge w:val="restart"\/>/.test(docXml) && /<w:vMerge\/>/.test(docXml) && /<w:gridSpan w:val="2"\/>/.test(docXml), 'merged cells');
ok(/<w:pgSz w:w="12240" w:h="15840"\/>/.test(docXml) && /w:left="1800"/.test(docXml) && /<w:titlePg\/>/.test(docXml) && /<w:pgNumType w:start="3"\/>/.test(docXml), 'section properties');
ok(/<w:hyperlink r:id="rId\d+"/.test(docXml), 'hyperlink');
const relsXml = fflate.strFromU8(files['word/_rels/document.xml.rels']);
ok(/Target="https:\/\/example.com\/a\?b=1&amp;c=2" TargetMode="External"/.test(relsXml), 'external hyperlink rel escaped');
ok(/<w:fldSimple w:instr=" PAGE ">/.test(fflate.strFromU8(files['word/footer1.xml'])), 'PAGE field in footer');

// read back
const d1 = Docx.readDocx(bytes, { fflate, DOMParser });
const strip = blocks => JSON.parse(JSON.stringify(blocks, (k, v) => k === 'asset' ? 'IMG' : v));
eq(d1.page, { ...d0.page }, 'page setup round trip');
eq(d1.header, d0.header, 'header round trip');
eq(d1.footer, d0.footer, 'footer round trip');
eq(d1.hfFirst, true, 'different first page');
eq(d1.meta, d0.meta, 'core properties');
eq(Object.values(d1.notes), Object.values(d0.notes), 'footnote texts');
eq(Object.values(d1.comments).map(c => [c.author, c.date, c.text]), [['Grace Hopper', '2026-01-02T03:04:05Z', 'Check this figure.\nSecond line.']], 'comments');
eq(d1.styles.para.Heading1.color, '#123456', 'style color');
eq(d1.styles.para.Normal.size, 10.5, 'Normal size');
eq(d1.styles.para.S_Callout && [d1.styles.para.S_Callout.name, d1.styles.para.S_Callout.font, d1.styles.para.S_Callout.size, d1.styles.para.S_Callout.b, d1.styles.para.S_Callout.color], ['Callout', 'Lora', 12, true, '#7a2e0e'], 'custom style');
eq(d1.styles.para.Normal.lh, 1.35, 'line height survives');
// compare blocks (normalise note/comment ids, which are renumbered)
const idMapN = {}, idMapC = {};
Object.keys(d1.notes).forEach((k, i) => idMapN[k] = Object.keys(d0.notes)[i]);
Object.keys(d1.comments).forEach((k, i) => idMapC[k] = Object.keys(d0.comments)[i]);
const norm = blocks => JSON.parse(JSON.stringify(blocks, (k, v) => k === 'asset' ? 'IMG' : k === 'id' && typeof v === 'string' && idMapN[v] ? idMapN[v] : k === 'cm' ? v.map(c => idMapC[c] || c) : v));
const b0 = norm(d0.blocks), b1 = norm(d1.blocks);
eq(b1.length, b0.length, 'block count');
for (let i = 0; i < Math.max(b0.length, b1.length); i++) eq(b1[i], b0[i], `block ${i}`);
eq(Object.keys(d1.assets).length, 1, 'one image asset (deduplicated)');
ok(d1.assets[Object.keys(d1.assets)[0]].data.length === PNG.length, 'image bytes intact');

// ODT round trip
if (Odt) {
  const ob = Odt.writeOdt(d0, { fflate });
  const of = fflate.unzipSync(ob);
  ok(Object.keys(of)[0] === 'mimetype' && fflate.strFromU8(of.mimetype) === 'application/vnd.oasis.opendocument.text', 'odt mimetype first');
  for (const n of Object.keys(of).filter(n => /\.xml$/.test(n))) {
    let err = null;
    const p = new DOMParser({ onError: (lvl, msg) => { if (lvl !== 'warning') err = msg; }, errorHandler: { error: m => { err = m; }, fatalError: m => { err = m; } } });
    try { p.parseFromString(fflate.strFromU8(of[n]), 'application/xml'); } catch (e) { err = e.message; }
    ok(!err, `well-formed ODT XML ${n}: ${err}`);
  }
  const o1 = Odt.readOdt(ob, { fflate, DOMParser });
  const flat = bs => { const out = []; Model.eachPara(bs, p => out.push([p.style, p.list ? p.list.kind + p.list.level : '', Model.runsText(p.runs)])); return out; };
  // ODT export drops tracked deletions (accepted view) – compare against that
  const accepted = JSON.parse(JSON.stringify(d0.blocks)); Model.eachPara(accepted, p => { p.runs = p.runs.filter(r => !r.del); });
  eq(flat(o1.blocks), flat(accepted), 'ODT paragraphs, styles, lists and text');
  eq(o1.blocks.filter(b => b.t === 'table').map(t => t.rows.map(r => r.cells.map(c => [c.cs || 1, c.rs || 1]))), [[[[1, 1], [1, 1], [1, 1]], [[1, 2], [2, 1]], [[1, 1], [1, 1]]]], 'ODT table spans');
  eq(o1.blocks.filter(b => b.t === 'pagebreak').length, 1, 'ODT page break');
  eq(Object.values(o1.notes), Object.values(d0.notes), 'ODT footnotes');
  eq([o1.page.w, o1.page.h, o1.page.ml], [612, 792, 90], 'ODT page size');
  const fmtRuns = []; Model.eachPara(o1.blocks, p => p.runs.forEach(r => { if (r.t === 'text' && (r.b || r.i || r.u || r.s || r.sup || r.sub || r.color)) fmtRuns.push(r.text.trim()); }));
  ok(['bold', 'italic', 'underlined', 'struck', '2', 'red'].every(t => fmtRuns.includes(t)), 'ODT character formatting: ' + fmtRuns.join('|'));
  eq(Object.keys(o1.assets).length >= 1, true, 'ODT images');
  eq(o1.header, d0.header, 'ODT header');
}

console.log(`${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
