// Node tests for the Lumen Type font compiler: build TTF / OTF / WOFF / WOFF2, re-parse with fontkit and opentype.js,
// check outlines, metrics, names, cmap and kerning; round-trip the Montserrat sample.  Run: node type/tests/export.test.js
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..'), DEPS = path.join(ROOT, '../tools/deps');
const TM = require('../js/model.js'), FIO = require('../js/fontio.js'), SF = require('../js/sfnt.js'), OV = require('../js/overlap.js');
const opentype = require(DEPS + '/vector/node_modules/opentype.js');
const fontkit = require(path.join(ROOT, '../layout/vendor/fontkit.umd.min.js'));
const fflate = require('../vendor/fflate.min.js');
const wawoff2 = require(DEPS + '/convert/node_modules/wawoff2');
const paper = require(DEPS + '/vector/node_modules/paper/dist/paper-core.js');
const OUT = process.env.LT_OUT || path.join(os.tmpdir(), 'lumen-type-test'); fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const ab = b => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);

// ---------- synthetic test font ----------
function testFont(style = 'Regular') {
  const f = TM.newFont({ familyName: 'Lumen Test', styleName: style, designer: 'Lumen QA', copyright: '© 2026 Lumen', versionMajor: 2, versionMinor: 5, ascender: 780, descender: -220, xHeight: 510, capHeight: 700, lineGap: 100, vendorID: 'LUMN' });
  const add = (g) => { f.glyphs[g.name] = g; f.order.push(g.name); return g; };
  const A = add(TM.newGlyph('A', [65], 640));
  A.contours.push({ points: [{ x: 20, y: 0, t: 'l' }, { x: 120, y: 0, t: 'l' }, { x: 320, y: 560, t: 'l' }, { x: 520, y: 0, t: 'l' }, { x: 620, y: 0, t: 'l' }, { x: 370, y: 700, t: 'l' }, { x: 270, y: 700, t: 'l' }] });
  A.contours.push(TM.rectContour(170, 180, 470, 260));                  // overlapping crossbar (ccw)
  const V = add(TM.newGlyph('V', [86], 620));
  V.contours.push({ points: [{ x: 260, y: 0, t: 'l' }, { x: 360, y: 0, t: 'l' }, { x: 610, y: 700, t: 'q' }, { x: 470, y: 300, t: 'o' }, { x: 520, y: 700, t: 'l' }, { x: 310, y: 120, t: 'q' }, { x: 100, y: 700, t: 'l' }, { x: 10, y: 700, t: 'l' }, { x: 160, y: 300, t: 'o' }] });
  TM.canonical(V.contours[0]); TM.correctDirections(V);
  const O = add(TM.newGlyph('O', [79], 720)); O.contours.push(TM.ellipseContour(360, 350, 320, 360), TM.reverseContour(TM.ellipseContour(360, 350, 230, 270)));
  const o = add(TM.newGlyph('o', [111], 560)); o.contours.push(TM.contourToQuadratic(TM.ellipseContour(280, 255, 240, 265)), TM.contourToQuadratic(TM.reverseContour(TM.ellipseContour(280, 255, 150, 180)))); TM.roundGlyph(o);
  const T = add(TM.newGlyph('T', [84], 600)); T.contours.push(TM.rectContour(20, 620, 580, 700), TM.rectContour(255, 0, 345, 640));   // overlapping stems
  const acute = add(TM.newGlyph('acute', [0xB4], 300)); acute.contours.push({ points: [{ x: 90, y: 760, t: 'l' }, { x: 170, y: 760, t: 'l' }, { x: 260, y: 900, t: 'l' }, { x: 170, y: 900, t: 'l' }] });
  add(TM.buildComposite(f, 'Aacute', 0xC1));
  const Vm = add(TM.newGlyph('V.mirror', [], 620)); Vm.components.push({ base: 'V', m: [-1, 0, 0, 1, 620, 0] });
  const W = add(TM.newGlyph('W', [87], 900)); W.components.push({ base: 'V', m: [1, 0, 0, 1, 0, 0] }, { base: 'V', m: [1, 0, 0, 1, 280, 0] });
  const smile = add(TM.newGlyph('u1F600', [0x1F600], 800)); smile.contours.push(TM.ellipseContour(400, 300, 350, 350), TM.reverseContour(TM.ellipseContour(400, 300, 300, 300)));
  const mixed = add(TM.newGlyph('Oslash', [0xD8], 720)); mixed.components.push({ base: 'O', m: [1, 0, 0, 1, 0, 0] }); mixed.contours.push({ points: [{ x: 60, y: -40, t: 'l' }, { x: 130, y: -40, t: 'l' }, { x: 680, y: 740, t: 'l' }, { x: 610, y: 740, t: 'l' }] });
  f.groups = { 'public.kern1.A': ['A', 'Aacute'], 'public.kern2.V': ['V', 'W'], 'public.kern2.O': ['O', 'Oslash'] };
  f.kerning = { 'public.kern1.A': { 'public.kern2.V': -80, 'public.kern2.O': -15, o: -20 }, Aacute: { 'public.kern2.V': -40, W: 0 }, T: { o: -60, A: -50 }, V: { 'public.kern2.O': -25 } };
  return f;
}
const expectedKern = (f, l, r) => TM.kernValue(f, l, r);

function checkFont(label, bytes, f, opts = {}) {
  const fk = fontkit.create(Buffer.from(bytes));
  const prepared = SF.prepare(f, {});
  ok(fk.numGlyphs === prepared.order.length, `${label}: glyph count ${fk.numGlyphs}`);
  ok(fk.familyName === 'Lumen Test' && fk.postscriptName === SF.styleInfo(f.info).ps, `${label}: names ${fk.familyName} / ${fk.postscriptName}`);
  ok(fk.unitsPerEm === 1000 && fk.ascent === 780 && fk.descent === -220 && fk.lineGap === 100, `${label}: hhea metrics ${fk.ascent} ${fk.descent} ${fk.lineGap}`);
  ok(fk['OS/2'].xHeight === 510 && fk['OS/2'].capHeight === 700 && fk['OS/2'].typoAscender === 780 && fk['OS/2'].vendorID === 'LUMN', `${label}: OS/2 metrics`);
  ok(fk.version === 'Version 2.005', `${label}: version string ${fk.version}`);
  // cmap incl. non-BMP
  for (const [cp, name] of [[65, 'A'], [0xC1, 'Aacute'], [0x1F600, 'u1F600'], [32, 'space'], [0xD8, 'Oslash']]) {
    const g = fk.glyphForCodePoint(cp);
    ok(g && g.id === prepared.order.indexOf(name), `${label}: cmap U+${cp.toString(16)} → ${name} (got ${g && g.id})`);
  }
  // advance widths & outlines
  prepared.order.forEach((n, gid) => {
    const g = fk.getGlyph(gid), mg = prepared.glyphs[n];
    if (g.advanceWidth !== mg.advance) ok(false, `${label}: advance ${n} ${g.advanceWidth} vs ${mg.advance}`);
    const dec = TM.cloneGlyph(mg); TM.decompose(prepared, dec); if (opts.overlap) OV.removeOverlap(dec, paper);
    const want = TM.commandsBounds(TM.glyphCommands(prepared, dec)), cb = g.path.bbox;
    if (!want) { if (g.path.commands.length) ok(false, `${label}: ${n} should be empty`); return; }
    const near = (a, b) => Math.abs(a - b) <= 1.6;
    if (!(near(cb.minX, want.xMin) && near(cb.minY, want.yMin) && near(cb.maxX, want.xMax) && near(cb.maxY, want.yMax))) ok(false, `${label}: bbox ${n} ${JSON.stringify(cb)} vs ${JSON.stringify(want)}`);
    // filled area (nonzero) via scanline sampling of both outlines
    const a1 = fillArea(fkCommands(g.path), want), a0 = fillArea(TM.glyphCommands(prepared, dec), want);
    if (Math.abs(a1 - a0) > Math.max(0.006 * a0, 40)) ok(false, `${label}: filled area ${n} ${a1} vs ${a0}`); else pass++;
  });
  // kerning through fontkit's GPOS engine
  const pairs = [['A', 'V'], ['A', 'W'], ['Aacute', 'V'], ['Aacute', 'W'], ['A', 'o'], ['T', 'o'], ['T', 'A'], ['A', 'O'], ['A', 'Oslash'], ['V', 'O'], ['V', 'A'], ['o', 'T']];
  if (opts.kern !== false) pairs.forEach(([l, r]) => {
    const run = fk.glyphsForString ? null : null; void run;
    const gl = fk.getGlyph(prepared.order.indexOf(l)), gr = fk.getGlyph(prepared.order.indexOf(r));
    const lay = fk.layout([gl, gr]);
    const k = lay.positions[0].xAdvance - gl.advanceWidth;
    ok(k === expectedKern(f, l, r), `${label}: kern ${l} ${r} = ${k} (want ${expectedKern(f, l, r)})`);
  });
  return fk;
}
function fkCommands(p) { return p.commands.map(c => { const a = c.args; return c.command === 'moveTo' ? ['M', ...a] : c.command === 'lineTo' ? ['L', ...a] : c.command === 'quadraticCurveTo' ? ['Q', ...a] : c.command === 'bezierCurveTo' ? ['C', ...a] : ['Z']; }); }
// nonzero-filled area by sampling horizontal scanlines (robust to direction / overlaps)
function fillArea(cmds, box) {
  const polys = []; let cur = null, cx = 0, cy = 0;
  const step = 16;
  for (const k of cmds) {
    if (k[0] === 'M') { if (cur) polys.push(cur); cur = [[k[1], k[2]]]; cx = k[1]; cy = k[2]; }
    else if (k[0] === 'L') { cur.push([k[1], k[2]]); cx = k[1]; cy = k[2]; }
    else if (k[0] === 'Q') { for (let i = 1; i <= step; i++) { const t = i / step, u = 1 - t; cur.push([u * u * cx + 2 * u * t * k[1] + t * t * k[3], u * u * cy + 2 * u * t * k[2] + t * t * k[4]]); } cx = k[3]; cy = k[4]; }
    else if (k[0] === 'C') { for (let i = 1; i <= step; i++) { const t = i / step, u = 1 - t; cur.push([u * u * u * cx + 3 * u * u * t * k[1] + 3 * u * t * t * k[3] + t * t * t * k[5], u * u * u * cy + 3 * u * u * t * k[2] + 3 * u * t * t * k[4] + t * t * t * k[6]]); } cx = k[5]; cy = k[6]; }
  }
  if (cur) polys.push(cur);
  let area = 0; const dy = 2;
  for (let y = Math.floor(box.yMin) + dy / 2; y < box.yMax; y += dy) {
    const xs = [];
    polys.forEach(P => { for (let i = 0; i < P.length; i++) { const [x0, y0] = P[i], [x1, y1] = P[(i + 1) % P.length]; if ((y0 <= y) !== (y1 <= y)) xs.push([x0 + (y - y0) / (y1 - y0) * (x1 - x0), y1 > y0 ? 1 : -1]); } });
    xs.sort((a, b) => a[0] - b[0]); let w = 0;
    for (let i = 0; i < xs.length - 1; i++) { w += xs[i][1]; if (w !== 0) area += (xs[i + 1][0] - xs[i][0]) * dy; }
  }
  return area;
}

(async () => {
  const f = testFont();
  const ttf = SF.buildTTF(f, { timestamp: Date.UTC(2026, 0, 1) }), otf = SF.buildOTF(f, opentype, { timestamp: Date.UTC(2026, 0, 1) });
  fs.writeFileSync(path.join(OUT, 'LumenTest-Regular.ttf'), ttf); fs.writeFileSync(path.join(OUT, 'LumenTest-Regular.otf'), otf);
  checkFont('TTF', ttf, f); checkFont('OTF', otf, f);
  // TrueType: quadratic glyph points are preserved exactly; composites stay composites
  {
    const fk = fontkit.create(Buffer.from(ttf)), P = SF.prepare(f, {});
    const gv = fk.getGlyph(P.order.indexOf('V'));
    const pts = gv._getContours().flat().map(p => `${p.x},${p.y},${p.onCurve ? 1 : 0}`).sort().join(' ');
    const mine = f.glyphs.V.contours[0].points.map(p => `${p.x},${p.y},${p.t === 'o' ? 0 : 1}`).sort().join(' ');
    ok(pts === mine, 'TTF: quadratic V points identical');
    const ga = fk.getGlyph(P.order.indexOf('Aacute'));
    ok(ga._decode && ga._decode().numberOfContours === -1, 'TTF: Aacute stored as composite');
    const gm = fk.getGlyph(P.order.indexOf('Oslash')); ok(gm._decode().numberOfContours > 0, 'TTF: mixed contour+component glyph decomposed');
    const gmir = fk.getGlyph(P.order.indexOf('V.mirror')); ok(gmir._decode().numberOfContours === -1, 'TTF: mirrored component kept as composite (scale -1)');
    ok(fk.directory.tables.kern && fk.directory.tables.GPOS, 'TTF: GPOS + legacy kern tables present');
    ok(fk.post.version === 2 && fk.getGlyph(P.order.indexOf('u1F600')).name === 'u1F600', 'TTF: post v2 glyph names');
    ok(fk['OS/2'].fsSelection.regular && fk['OS/2'].fsSelection.useTypoMetrics, 'TTF: fsSelection regular + typo');
  }
  // opentype.js also parses both and reads the same advance/kerning
  for (const [label, b] of [['TTF', ttf], ['OTF', otf]]) {
    const o = opentype.parse(ab(b));
    ok(o.glyphs.length === SF.prepare(f, {}).order.length && o.names.fontFamily.en === 'Lumen Test', `opentype.js parses ${label}`);
    const A = o.charToGlyph('A'), V = o.charToGlyph('V');
    ok(o.getKerningValue(A, V) === -80, `opentype.js ${label} kerning A V = ${o.getKerningValue(A, V)}`);
    ok(o.charToGlyph('\u{1F600}').name === 'u1F600', `opentype.js ${label} non-BMP cmap`);
  }
  // overlap removal + direction options
  {
    const b = SF.buildTTF(f, { overlap: g => OV.removeOverlap(g, paper) });
    const fk = checkFont('TTF+overlap', b, f, { overlap: true });
    const P = SF.prepare(f, {}); ok(fk.getGlyph(P.order.indexOf('T'))._getContours().length === 1 && fk.getGlyph(P.order.indexOf('A'))._getContours().length === 2, 'overlap removed: T 1 contour, A outer + counter');
  }
  // style naming: non-RIBBI style gets typographic names
  {
    const s = testFont('SemiBold Italic'); const b = SF.buildOTF(s, opentype, {});
    const fk = fontkit.create(Buffer.from(b));
    ok(fk.getName('fontFamily') === 'Lumen Test SemiBold' && fk.getName('fontSubfamily') === 'Italic' && fk.getName('preferredFamily') === 'Lumen Test' && fk.getName('preferredSubfamily') === 'SemiBold Italic', 'SemiBold Italic naming');
    ok(fk['OS/2'].fsSelection.italic && !fk['OS/2'].fsSelection.bold && fk.head.macStyle.italic, 'italic flags');
    const bb = SF.buildTTF(testFont('Bold'), {}); const fb = fontkit.create(Buffer.from(bb)); ok(fb['OS/2'].fsSelection.bold && fb.head.macStyle.bold && fb.getName('fontSubfamily') === 'Bold', 'Bold flags');
  }
  // 2048 UPM + italic angle: CFF FontMatrix / real numbers
  {
    const s = testFont('Italic'); s.info.unitsPerEm = 2048; s.info.italicAngle = -11.5;
    const b = SF.buildOTF(s, {}); fs.writeFileSync(path.join(OUT, 'LumenTest-Italic2048.otf'), b);
    const fk = fontkit.create(Buffer.from(b)), cff = fk['CFF '];
    const fm = cff.topDict.FontMatrix;
    ok(fk.unitsPerEm === 2048 && Math.abs(fm[0] - 1 / 2048) < 1e-9 && Math.abs(fm[3] - 1 / 2048) < 1e-9, 'CFF FontMatrix for 2048 UPM ' + JSON.stringify(fm));
    ok(Math.abs(cff.topDict.ItalicAngle + 11.5) < 1e-9 && fk.italicAngle === -11.5 && fk.hhea.caretSlopeRun > 0, 'italic angle in CFF / post / hhea caret');
    ok(fk.getGlyph(SF.prepare(s, {}).order.indexOf('O')).path.bbox.maxX === 680, 'outline coordinates unchanged at 2048 UPM');
  }
  // WOFF 1 + WOFF2 (both flavours)
  for (const [label, sf] of [['ttf', ttf], ['otf', otf]]) {
    const w1 = SF.buildWOFF(sf, d => fflate.zlibSync(d, { level: 9 }));
    ok(w1.length < sf.length && String.fromCharCode(...w1.slice(0, 4)) === 'wOFF', `WOFF(${label}) smaller: ${w1.length} < ${sf.length}`);
    fs.writeFileSync(path.join(OUT, `LumenTest-Regular.${label}.woff`), w1);
    // fontkit cannot draw CFF glyphs from a compressed WOFF (it reads CharStrings from the file stream), so
    // unpack the WOFF with our reader and check that every table is byte-identical to the sfnt
    const tw = FIO.readTables(ab(w1), fflate.unzlibSync), ts = SF.tableDir(sf);
    ok(Object.keys(ts).length === Object.keys(tw).length && Object.keys(ts).every(k => Buffer.compare(Buffer.from(ts[k]), Buffer.from(tw[k])) === 0), `WOFF(${label}) tables identical to the ${label}`);
    if (label === 'ttf') checkFont(`WOFF(${label})`, w1, f);
    else { const o = opentype.parse(ab(w1)); ok(o.outlinesFormat === 'cff' && o.glyphs.length === SF.prepare(f, {}).order.length && o.charToGlyph('O').getBoundingBox().x2 === 680, 'opentype.js reads WOFF(otf) outlines'); }
    // our importer reads WOFF back
    const back = FIO.importOpenType(ab(w1), opentype, fflate.unzlibSync);
    ok(back.order.length === SF.prepare(f, {}).order.length && TM.kernValue(back, 'A', 'V') === -80 && TM.kernValue(back, 'Aacute', 'W') === 0 && TM.kernValue(back, 'T', 'o') === -60, `re-import WOFF(${label}) keeps glyphs and kerning`);
    const w2 = await wawoff2.compress(sf);
    fs.writeFileSync(path.join(OUT, `LumenTest-Regular.${label}.woff2`), w2);
    ok(w2.length < w1.length, `WOFF2(${label}) smaller than WOFF: ${w2.length}`);
    checkFont(`WOFF2(${label})`, w2, f);
  }
  // ---------- Montserrat sample round trip ----------
  {
    const src = fs.readFileSync(path.join(ROOT, 'sample/montserrat-400.woff'));
    const font = TM.sanitizeFont(FIO.importOpenType(ab(src), opentype, fflate.unzlibSync));
    const orig = fontkit.create(src);
    for (const [label, b] of [['TTF', SF.buildTTF(font, {})], ['OTF', SF.buildOTF(font, opentype, {})]]) {
      fs.writeFileSync(path.join(OUT, 'Montserrat-roundtrip.' + label.toLowerCase()), b);
      const ex = fontkit.create(Buffer.from(b));
      ok(ex.numGlyphs === orig.numGlyphs, `Montserrat ${label}: glyph count`);
      let advOK = 0, cmapOK = 0, outlineOK = 0, n = 0;
      orig.characterSet.forEach(cp => { const a = orig.glyphForCodePoint(cp), c = ex.glyphForCodePoint(cp); n++; if (a.name === c.name) cmapOK++; if (a.advanceWidth === c.advanceWidth) advOK++; const ba = a.path.bbox, bc = c.path.bbox; if (!isFinite(ba.minX) && !isFinite(bc.minX) || Math.abs(ba.minX - bc.minX) <= 1 && Math.abs(ba.maxX - bc.maxX) <= 1 && Math.abs(ba.minY - bc.minY) <= 1 && Math.abs(ba.maxY - bc.maxY) <= 1) outlineOK++; else console.log('  box', label, a.name, JSON.stringify(ba), JSON.stringify(bc)); });
      ok(cmapOK === n && advOK === n && outlineOK === n, `Montserrat ${label}: cmap ${cmapOK}/${n}, advances ${advOK}/${n}, outline boxes ${outlineOK}/${n}`);
      // kerning: same glyph positions as the original for every pair of 70 common characters
      const chars = 'AVTWYPFLOCGQDHKXZbdfghjkmnpqrstuvwxyzoeac.,:;-’\'"!?()0147LTVWYaeo' ;
      let same = 0, tot = 0, nonzero = 0;
      for (const a of chars) for (const c of chars) { const s = a + c; const pa = orig.layout(s).positions, pb = ex.layout(s).positions; tot++; if (pa[0].xAdvance === pb[0].xAdvance) same++; if (pa[0].xAdvance !== orig.glyphForCodePoint(a.codePointAt(0)).advanceWidth) nonzero++; }
      ok(same === tot && nonzero > 200, `Montserrat ${label}: kerning identical for ${same}/${tot} pairs (${nonzero} kerned)`);
    }
    // TrueType outlines are bit-identical point sets
    const ex = fontkit.create(Buffer.from(SF.buildTTF(font, {})));
    let same = 0, tot = 0;
    for (let i = 0; i < orig.numGlyphs; i++) {
      const a = orig.getGlyph(i), b = ex.getGlyph(i); if (a.name !== b.name) continue; tot++;
      const k = g => g._getContours().map(c => c.map(p => `${p.x},${p.y},${p.onCurve ? 1 : 0}`).sort().join(' ')).sort().join('|');
      if (k(a) === k(b)) same++;
    }
    ok(same === tot && tot === orig.numGlyphs, `Montserrat TTF: identical point sets for ${same}/${tot} glyphs`);
  }
  console.log(`export tests: ${pass} passed, ${fail} failed  (fonts in ${OUT})`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
