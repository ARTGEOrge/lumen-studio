'use strict';
// Node tests for the .pptx writer/reader: package structure (zip, content types, relationships, well-formed XML)
// and round-tripping of text, shapes, images, tables, charts, backgrounds, notes, transitions and animations.
// Run: node C:/code/lumen-studio/slides/tests/pptx.test.js
const fs = require('fs'), path = require('path');
const fflate = require('../vendor/fflate.js');
const XML = require('../js/xml.js'), M = require('../js/model.js');
const W = require('../js/pptx-write.js'), R = require('../js/pptx-read.js');
const { build, PNG_BYTES } = require('./fixture.js');
const Schema = require('./schema-order.js');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('FAIL', msg); } };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);
const near = (a, b, msg, tol = 0.6) => ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

function checkPackage(u8, label) {
  const files = fflate.unzipSync(u8);
  const names = Object.keys(files);
  ok(names[0] === '[Content_Types].xml', label + ': [Content_Types].xml is the first zip entry');
  const ct = XML.parse(fflate.strFromU8(files['[Content_Types].xml']));
  const defaults = new Map(XML.kids(ct, 'Default').map(e => [e.a.Extension.toLowerCase(), e.a.ContentType]));
  const overrides = new Map(XML.kids(ct, 'Override').map(e => [e.a.PartName, e.a.ContentType]));
  // every part has a content type; every override exists
  for (const n of names) { if (n.endsWith('/')) continue; const ext = n.split('.').pop().toLowerCase(); ok(overrides.has('/' + n) || defaults.has(ext), `${label}: content type for ${n}`); }
  for (const p of overrides.keys()) ok(files[p.slice(1)], `${label}: override target exists ${p}`);
  // every xml / rels part is well-formed
  let xmlCount = 0;
  for (const n of names) if (/\.(xml|rels)$/.test(n)) {
    try { XML.parse(fflate.strFromU8(files[n])); xmlCount++; } catch (e) { ok(false, `${label}: ${n} well-formed (${e.message})`); continue; }
    if (/\.xml$/.test(n) && n !== '[Content_Types].xml') { const errs = Schema.check(fflate.strFromU8(files[n]), n); ok(!errs.length, `${label}: schema order ${n}: ${errs.slice(0, 3).join(' | ')}`); }
  }
  // every relationship target exists, ids unique
  const referenced = new Set(['[Content_Types].xml']);
  for (const n of names.filter(n => n.endsWith('.rels'))) {
    referenced.add(n);
    const dir = n.replace(/_rels\/[^/]+$/, ''), rel = XML.parse(fflate.strFromU8(files[n]));
    const ids = new Set();
    for (const r of XML.kids(rel, 'Relationship')) {
      ok(!ids.has(r.a.Id), `${label}: unique rel id ${r.a.Id} in ${n}`); ids.add(r.a.Id);
      if (r.a.TargetMode === 'External') continue;
      const parts = (dir + r.a.Target).split('/'), out = []; for (const s of parts) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
      const t = out.join('/'); referenced.add(t);
      ok(files[t], `${label}: rel target ${r.a.Target} from ${n}`);
    }
  }
  for (const n of names) ok(referenced.has(n), `${label}: part ${n} is referenced by a relationship`);
  // r:id / r:embed used in parts resolve in their rels
  for (const n of names.filter(n => /\.xml$/.test(n) && !n.includes('_rels'))) {
    const s = fflate.strFromU8(files[n]); const used = [...s.matchAll(/r:(?:id|embed)="([^"]+)"/g)].map(m => m[1]);
    if (!used.length) continue;
    const rp = n.replace(/([^/]+)$/, '_rels/$1.rels'); const rel = files[rp] ? XML.parse(fflate.strFromU8(files[rp])) : null;
    const ids = new Set(rel ? XML.kids(rel, 'Relationship').map(r => r.a.Id) : []);
    for (const u of used) ok(ids.has(u), `${label}: ${n} uses ${u} defined in rels`);
  }
  // shape ids unique per slide; animation targets exist
  for (const n of names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    const s = fflate.strFromU8(files[n]); const x = XML.parse(s);
    const ids = XML.all(x, 'p:cNvPr').map(e => e.a.id);
    ok(new Set(ids).size === ids.length, `${label}: unique shape ids in ${n}`);
    for (const t of XML.all(x, 'p:spTgt')) ok(ids.includes(t.a.spid), `${label}: animation target ${t.a.spid} exists in ${n}`);
    const ctn = XML.all(x, 'p:cTn').map(e => e.a.id); ok(new Set(ctn).size === ctn.length, `${label}: unique timing node ids in ${n}`);
  }
  return { files, xmlCount };
}

// ---------- 1. write the fixture ----------
const { doc, assets } = build();
const u8 = W.write(doc, assets, { title: 'Fixture' });
ok(u8[0] === 0x50 && u8[1] === 0x4b, 'zip signature');
const { files, xmlCount } = checkPackage(u8, 'fixture');
console.log(`package: ${Object.keys(files).length} parts, ${xmlCount} XML parts, ${u8.length} bytes`);
const pres = XML.parse(fflate.strFromU8(files['ppt/presentation.xml']));
eq(XML.kids(XML.kid(pres, 'p:sldIdLst'), 'p:sldId').length, 4, 'slide count in presentation.xml');
eq(XML.kid(pres, 'p:sldSz').a.cx, '12192000', 'slide width EMU');
ok(files['ppt/media/image1.png'] && Buffer.from(files['ppt/media/image1.png']).equals(PNG_BYTES), 'image bytes stored unchanged');
ok(files['ppt/charts/chart1.xml'] && files['ppt/charts/chart2.xml'], 'chart parts written');
ok(files['ppt/notesSlides/notesSlide1.xml'], 'notes slide written');
ok(/<p:transition spd="slow" p14:dur="1200">/.test(fflate.strFromU8(files['ppt/slides/slide1.xml'])), 'transition with duration');
ok(/show="0"/.test(fflate.strFromU8(files['ppt/slides/slide4.xml'])), 'hidden slide flag');
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'out', 'fixture.pptx'), u8);

// ---------- 2. read it back ----------
const back = R.read(u8);
const d2 = back.doc;
eq(back.warnings, [], 'no warnings on own file');
eq(d2.slides.length, 4, 'slides read');
eq([d2.w, d2.h], [1280, 720], 'slide size');
eq(d2.theme.colors.accent1, doc.theme.colors.accent1, 'theme accent1');
eq(d2.theme.fonts, doc.theme.fonts, 'theme fonts');
eq(d2.layouts.map(l => l.name), doc.layouts.map(l => l.name), 'layout names');
const txt = s => s.objects.map(o => o.text ? M.plainText(o.text) : o.type).join('|');
eq(txt(d2.slides[0]), 'Quarterly Review|Lumen Slides & <OOXML> "test"', 'title slide text (with XML special chars)');
eq(d2.slides[0].notes, 'Welcome everyone.\nSecond line of notes.', 'notes');
eq(d2.slides[0].transition.type, 'fade', 'transition type'); near(d2.slides[0].transition.dur, 1.2, 'transition duration', 0.01);
eq([d2.slides[1].transition.type, d2.slides[1].transition.dir], ['push', 'l'], 'push transition dir');
// bullets / rich text
const body = d2.slides[1].objects[1];
eq(body.ph && body.ph.type, 'body', 'body placeholder kept');
eq(body.text.paras.map(p => p.runs.map(r => r.t).join('')), ['First point', 'Bold and red italic', 'Numbered', 'Accent'], 'paragraph text');
eq(body.text.paras[1].lvl, 1, 'paragraph level');
ok(body.text.paras[1].runs[0].b === true, 'bold run');
ok(body.text.paras[1].runs[2].i === true && body.text.paras[1].runs[2].color === '#ff0000', 'italic red run');
eq(body.text.paras[2].bullet, { num: 'arabicPeriod', start: 1 }, 'numbered bullet');
eq([body.text.paras[3].runs[0].color, body.text.paras[3].runs[0].size], ['accent2:+40', 30], 'scheme colour with tint + size');
ok(body.text.paras[0].bullet === undefined, 'inherited bullet not duplicated');
// shapes
const s3 = d2.slides[2].objects;
const byGeom = g => s3.find(o => o.geom === g);
const rr = byGeom('roundRect'); ok(rr && rr.shadow, 'rounded rect + shadow');
near(rr.x, 100, 'rect x'); near(rr.y, 200, 'rect y'); near(rr.w, 300, 'rect w'); near(rr.h, 160, 'rect h');
eq(M.plainText(rr.text), 'Inside', 'text inside shape');
eq(rr.fill, { color: 'accent1' }, 'scheme fill');
const el = byGeom('ellipse'); eq(el.fill.grad.length, 2, 'gradient stops'); near(el.fill.ang, 45, 'gradient angle', 0.01); eq([el.line.w, el.line.dash, el.line.color], [3, 'dash', 'tx1'], 'line props');
near(byGeom('star5').rot, 15, 'rotation', 0.01);
const l = byGeom('line'); ok(l && l.line.tail === 'arrow' && l.line.w === 4, 'line with arrow head');
const tb = s3.find(o => o.tb); eq(M.plainText(tb.text), 'A text box', 'text box');
const img = s3.find(o => o.type === 'image'); ok(img && back.assets[img.asset], 'image asset'); near(img.crop.l, 0.1, 'crop', 0.001);
ok(back.assets[img.asset].data === assets.a1.data, 'image bytes identical');
const grp = s3.find(o => o.type === 'group'); ok(grp && grp.children.length === 2, 'group with children'); near(grp.children[1].x, 720, 'group child x');
// animations
const an = d2.slides[2].anims;
eq(an.map(a => [a.cls, a.fx, a.trig]), [['entr', 'fade', 'click'], ['entr', 'fly', 'with'], ['emph', 'spin', 'after'], ['exit', 'wipe', 'click'], ['entr', 'zoom', 'click']], 'animation sequence');
eq(an[1].dir, 'l', 'fly direction'); near(an[2].delay, 0.2, 'anim delay', 0.001); near(an[2].dur, 1, 'anim duration', 0.001);
eq(an.map(a => s3.find(o => o.id === a.target).type), ['shape', 'shape', 'shape', 'shape', 'image'], 'animation targets mapped');
eq(d2.slides[2].bg, { color: '#f4f0ea' }, 'slide background colour');
// table + chart
const s4 = d2.slides[3];
ok(s4.hidden, 'hidden slide');
const t = s4.objects.find(o => o.type === 'table');
eq(t.rows.map(r => r.cells.map(c => M.plainText(c.text))), [['Region', 'Q1', 'Q2'], ['North', '12', '15'], ['South', '9', '11'], ['West', '14', '18']], 'table text');
eq(t.cols.length, 3, 'table columns'); near(t.w, 560, 'table width');
eq(t.rows[2].cells[1].fill, { color: '#ffeeaa' }, 'cell fill');
const ch = s4.objects.filter(o => o.type === 'chart');
eq(ch.map(c => c.kind), ['col', 'pie'], 'chart kinds');
eq(ch[0].cats, ['Q1', 'Q2', 'Q3', 'Q4'], 'chart categories'); eq(ch[0].series.map(s => s.vals), doc.slides[3].objects[2].series.map(s => s.vals), 'chart values');
eq(ch[0].title, 'Chart title', 'chart title'); ok(ch[1].labels, 'pie labels');
eq(s4.bg.grad.length, 2, 'gradient background');
eq(d2.footer.num, true, 'footer slide number'); eq(d2.footer.text, 'Confidential', 'footer text');

// ---------- 3. second round trip is stable ----------
const u8b = W.write(d2, back.assets, {});
checkPackage(u8b, 'roundtrip');
const back2 = R.read(u8b);
const strip = d => JSON.stringify(d.slides.map(s => ({ o: s.objects.map(o => ({ t: o.type, g: o.geom, x: Math.round(o.x), y: Math.round(o.y), w: Math.round(o.w), txt: o.text ? M.plainText(o.text) : '', f: o.fill, l: o.line })), n: s.notes, a: s.anims.map(a => a.fx + a.trig), tr: s.transition.type, bg: s.bg })));
eq(strip(back2.doc), strip(d2), 'second round-trip identical');

// ---------- 3b. the sample deck exported by the browser (tests/t-export.js) ----------
const samplePath = path.join(__dirname, 'out', 'sample.pptx');
if (fs.existsSync(samplePath)) {
  const su8 = fs.readFileSync(samplePath); const r = checkPackage(new Uint8Array(su8), 'sample.pptx');
  const sb = R.read(new Uint8Array(su8)); eq(sb.doc.slides.length, 8, 'sample.pptx slides'); ok(Object.keys(sb.assets).length === 2, 'sample.pptx images');
  ok(sb.doc.slides.every(s => s.notes), 'sample.pptx notes on every slide'); ok(sb.doc.slides.some(s => s.objects.some(o => o.type === 'chart')) && sb.doc.slides.some(s => s.objects.some(o => o.type === 'table')), 'sample.pptx chart + table');
  console.log(`sample.pptx: ${Object.keys(r.files).length} parts`);
}
// ---------- 4. real PowerPoint-authored files (Office theme packages) ----------
const themeDir = 'C:/Program Files/Microsoft Office/root/Document Themes 16';
if (fs.existsSync(themeDir)) {
  let n = 0;
  for (const f of fs.readdirSync(themeDir).filter(f => /\.thmx$/i.test(f))) {
    try {
      const r = R.read(fs.readFileSync(path.join(themeDir, f)));
      ok(r.doc.layouts.length >= 5, `${f}: layouts read (${r.doc.layouts.length})`);
      ok(r.doc.master.ph.some(p => p.ph.type === 'title'), `${f}: master title placeholder`);
      const th = R.readTheme(fs.readFileSync(path.join(themeDir, f))); ok(/^#[0-9a-f]{6}$/.test(th.colors.accent1), `${f}: theme colours`);
      // re-export with a slide on every layout and validate the package
      r.doc.slides = r.doc.layouts.map(lay => { const s = M.newSlide(r.doc, lay.id); s.objects.forEach(o => { if (o.text) o.text = M.textBody([M.para('Text on ' + lay.name)]); }); return s; });
      const out = W.write(r.doc, r.assets, {}); checkPackage(out, f);
      const rr = R.read(out); eq(rr.doc.slides.length, r.doc.layouts.length, `${f}: slides on every layout re-read`);
      n++;
    } catch (e) { ok(false, `${f}: ${e.stack}`); }
  }
  console.log(`checked ${n} PowerPoint theme packages`);
}
// ---------- 5. hostile input ----------
let threw = false; try { R.read(new Uint8Array([1, 2, 3])); } catch (e) { threw = /zip|PowerPoint/.test(e.message); } ok(threw, 'garbage rejected with a clear error');
const evil = fflate.zipSync({ '[Content_Types].xml': fflate.strToU8('<Types/>'), '_rels/.rels': fflate.strToU8('<Relationships xmlns="x"><Relationship Id="r" Type="x/officeDocument" Target="ppt/presentation.xml"/></Relationships>'), 'ppt/presentation.xml': fflate.strToU8('<p:presentation xmlns:p="x"><p:sldMasterIdLst/><p:sldIdLst/></p:presentation>') });
threw = false; try { R.read(evil); } catch (e) { threw = /master/.test(e.message); } ok(threw, 'missing master rejected');
// sanitize drops script-y data
const s = M.sanitize({ slides: [{ objects: [{ type: 'shape', x: 'NaN', fill: { color: 'red;background:url(x)' }, text: { paras: [{ runs: [{ t: 'x', font: 'Arial"><script>' }] }] } }] }] });
ok(s.slides[0].objects[0].fill === null && !/[<>"]/.test(s.slides[0].objects[0].text.paras[0].runs[0].font), 'sanitize rejects bad colours / font names');
ok(Object.keys(M.sanitizeAssets({ a: { data: 'javascript:alert(1)' }, b: { data: 'data:text/html;base64,AAAA' }, c: { data: 'data:image/png;base64,AAAA' } })).join() === 'c', 'only image data URLs accepted');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
