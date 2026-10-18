// Export checks in the browser: PPTX bytes (validated again in Node), PDF page count, PNG zip + pixel colours.
const R = []; const ok = (c, m, x) => R.push([!!c, m, x]);
const wait = ms => new Promise(r => setTimeout(r, ms));
let pptxB64 = null;
try {
  await wait(400);
  const { doc, assets } = await Sample.build(); setDocument(doc, assets, 'Sample Export', null); await Render.imagesReady(S.assets); await wait(100);
  // PPTX
  const bytes = PPTXWriter.write(S.doc, await IO.pptxAssets(), { fitScale: IO.fitScale, title: 'Sample' });
  ok(bytes.length > 50000, 'pptx written', bytes.length);
  let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); pptxB64 = btoa(s);
  const back = PPTXReader.read(bytes);
  ok(back.doc.slides.length === 8 && back.warnings.length === 0, 'pptx re-read in browser', back.warnings);
  // PDF
  const pdfBytes = await IO.buildPdf({ q: 'small', notes: false, hidden: false });
  const head = String.fromCharCode(...pdfBytes.slice(0, 5));
  const pdf = await PDFLib.PDFDocument.load(pdfBytes);
  ok(head === '%PDF-' && pdf.getPageCount() === 8, 'PDF has one page per slide', [head, pdf.getPageCount()]);
  const pg = pdf.getPage(0).getSize(); ok(Math.abs(pg.width - 960) < 0.1 && Math.abs(pg.height - 540) < 0.1, 'PDF page size 960×540 pt (13.33×7.5 in)', pg);
  const notesPdf = await PDFLib.PDFDocument.load(await IO.buildPdf({ q: 'small', notes: true, hidden: false }));
  ok(notesPdf.getPageCount() === 8 && Math.abs(notesPdf.getPage(0).getSize().height - 841.89) < 0.1, 'notes pages are A4 portrait');
  // PNG zip
  const { zip, count } = await IO.buildPngZip({ w: 1280, hidden: false });
  const files = fflate.unzipSync(zip); const names = Object.keys(files);
  ok(count === 8 && names.length === 8 && names.every(n => files[n][0] === 0x89 && files[n][1] === 0x50), 'PNG zip with 8 valid PNGs', names);
  // pixel checks on a rendered slide
  const pricing = S.doc.slides.find(x => x.objects.some(o => o.type === 'table'));
  const cv = Render.slideCanvas(S.doc, pricing, S.assets, 1280, { slideNum: 6 });
  const tbl = pricing.objects.find(o => o.type === 'table');
  const px = (x, y) => Array.from(cv.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data.slice(0, 3));
  const hdr = px(tbl.x + 6, tbl.y + 6), want = Model.hex2rgb(Model.color('accent5', S.doc.theme));
  ok(hdr.every((v, i) => Math.abs(v - want[i]) < 4), 'table header cell painted in the style colour', { hdr, want });
  const bg = px(4, 700); ok(bg[2] > bg[0] && bg[2] > 40, 'gradient theme background painted', bg);
  // text actually drawn: the title area has light pixels
  const t = pricing.objects.find(o => o.ph && o.ph.type === 'title'); let light = 0;
  const d = cv.getContext('2d').getImageData(t.x, t.y, t.w, t.h).data; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] > 200 && d[i + 2] > 200) light++;
  ok(light > 1500, 'title text rendered', light);
  // .lslides round trip
  const json = IO.serialize(); const j = JSON.parse(json); const d2 = Model.sanitize(j.doc);
  ok(JSON.stringify(d2.slides.map(x => x.objects.length)) === JSON.stringify(S.doc.slides.map(x => x.objects.length)) && Object.keys(j.assets).length === 2, '.lslides save/load keeps all objects and images');
  ok(JSON.stringify(Model.sanitize(JSON.parse(JSON.stringify(S.doc)))) === JSON.stringify(Model.sanitize(d2)), 'sanitize is stable on own documents');
} catch (e) { R.push([false, 'EXCEPTION ' + e.message, e.stack]); }
return JSON.stringify({ pass: R.filter(r => r[0]).length, fail: R.filter(r => !r[0]), pptx: pptxB64 });
