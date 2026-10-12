'use strict';
/* Lumen Convert — PDF power tools: PDF → Word / Excel / PowerPoint, compress, protect / unlock (AES-256),
   sign, page numbers, watermark, organize pages, metadata, compare, EPUB → PDF and DOCX → EPUB.
   Lumen PDF's layout analysis + DOCX writer (pdf/js/export.js), security handler (pdf/js/security.js) and text diff
   (pdf/js/compare.js) are imported directly from ../pdf/js so the site ships that code once. */
(() => {
  const { register, alias, util: U } = LC;
  const { el, esc, baseName, extOf, fmtSize } = U;
  const isPdf = f => f.type === 'application/pdf' || extOf(f.name) === 'pdf';
  const pdfBlob = b => new Blob([b], { type: 'application/pdf' });
  const PDFJS_MOD = new URL('../pdf/js/', document.baseURI).href;
  const lumenPdf = async name => { await U.lib.pdfLib(); try { return await import(PDFJS_MOD + name); } catch (e) { throw new Error('Lumen PDF’s engine isn’t available on this copy of the site (' + e.message + ')'); } };
  const progAdapter = ctx => ({ set: (f, l) => ctx.progress(f == null ? 0.5 : f, l), get cancelled() { return ctx.cancelled; } });
  async function loadLib(bytes, name) {
    const { PDFDocument } = await U.lib.pdfLib();
    try { return await PDFDocument.load(bytes, { updateMetadata: false }); }
    catch (e) { throw new Error(/encrypt/i.test(e.message) ? `“${name}” is password-protected. Use Unlock PDF first.` : `“${name}” isn’t a readable PDF (${e.message})`); }
  }
  const bytesOf = async f => new Uint8Array(await f.arrayBuffer());
  // map a point in the page as displayed (origin bottom-left, after /Rotate) to user space; returns [x, y, textAngle]
  function displayBox(page) { const b = page.getCropBox ? page.getCropBox() : page.getMediaBox(), r = ((page.getRotation().angle % 360) + 360) % 360; return { ...b, r, W: r % 180 ? b.height : b.width, H: r % 180 ? b.width : b.height }; }
  function toUser(B, dx, dy) {
    const { x, y, width: w, height: h, r } = B;
    if (r === 90) return [x + w - dy, y + dx, 90];
    if (r === 180) return [x + w - dx, y + h - dy, 180];
    if (r === 270) return [x + dy, y + h - dx, 270];
    return [x + dx, y + dy, 0];
  }

  /* ---------------- PDF → Word ---------------- */
  register({
    id: 'pdf-to-word', cat: 'docs', glyph: 'word', name: 'PDF → Word (DOCX)', keywords: 'pdf to word docx doc editable convert tables acrobat export',
    desc: 'Editable Word documents with headings, lists, bold/italic, real tables and images.',
    accept: '.pdf,application/pdf', acceptText: 'PDF files with a text layer (use OCR first for scans)', acceptTest: isPdf, multiple: true, zipName: 'pdf-word',
    options: [{ key: 'pages', label: 'Pages', type: 'text', value: '', placeholder: 'All pages, or e.g. 1-3' }, { key: 'images', label: 'Images', type: 'checkbox', text: 'Include images', value: true }],
    note: 'Uses Lumen PDF’s layout analysis: text is reflowed into paragraphs; ruled and aligned tables become real Word tables. Complex magazine layouts may need tidying.',
    async each(f, o, ctx) {
      const ex = await lumenPdf('export.js');
      const lay = await ex.layoutDoc(await bytesOf(f), { pages: o.pages.trim() || 'all', images: o.images, prog: progAdapter(ctx) });
      if (!lay.some(p => p.blocks.some(b => b.kind !== 'img'))) throw new Error('No text found: this PDF is probably scanned. Run Scanned PDF → searchable (OCR) first.');
      ctx.progress(0.95, 'Writing the Word document');
      const docx = await ex.buildDocx(lay, { title: baseName(f.name) });
      const tables = lay.reduce((a, p) => a + p.blocks.filter(b => b.kind === 'table').length, 0);
      return { name: baseName(f.name) + '.docx', blob: new Blob([docx], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), info: `${lay.length} page${lay.length > 1 ? 's' : ''} · ${tables} table${tables === 1 ? '' : 's'}` };
    }
  });
  alias('pdf-to-docx', 'pdf-to-word');

  /* ---------------- PDF → Excel ---------------- */
  // table cell text → number when it is clearly numeric ("1,234.50", "(12)", "$5", "12%"); codes like "007" stay text
  const toCell = s => {
    const t = String(s).trim(); if (!t || /^0\d/.test(t)) return t;
    const m = t.match(/^(\()?(-)?[$€£]?\s?(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(\))?$/);
    if (m && !!m[1] === !!m[5]) { const n = parseFloat(m[3].replace(/,/g, '') + (m[4] || '')); return m[1] || m[2] ? -n : n; }
    if (/^-?\d+(\.\d+)?%$/.test(t)) return parseFloat(t) / 100;
    return t;
  };
  register({
    id: 'pdf-to-excel', cat: 'docs', glyph: 'sheet', name: 'PDF → Excel (XLSX)', keywords: 'pdf to excel xlsx tables extract spreadsheet csv bank statement invoice',
    desc: 'Pull the tables out of a PDF into a spreadsheet, one sheet per table, with real numbers.',
    accept: '.pdf,application/pdf', acceptText: 'PDFs with tables (text-based, not scanned)', acceptTest: isPdf, multiple: true, zipName: 'pdf-excel',
    options: [
      { key: 'pages', label: 'Pages', type: 'text', value: '', placeholder: 'All pages, or e.g. 2-4' },
      { key: 'mode', label: 'Sheets', type: 'select', value: 'tables', options: [['tables', 'One sheet per table'], ['one', 'All tables on one sheet'], ['text', 'Every text line as a row (no table detection)']] }],
    async each(f, o, ctx) {
      const ex = await lumenPdf('export.js'), XLSX = await U.loadScript('vendor/xlsx.full.min.js', 'XLSX');
      const lay = await ex.layoutDoc(await bytesOf(f), { pages: o.pages.trim() || 'all', images: false, prog: progAdapter(ctx) });
      const wb = XLSX.utils.book_new(); let nT = 0; const one = [];
      if (o.mode === 'text') {
        const rows = []; lay.forEach((p, pi) => { for (const b of p.blocks) { if (b.kind === 'table') b.rows.forEach(r => rows.push(r.map(c => toCell(c.text)))); else if (b.text) b.text.split(/\n/).forEach(l => rows.push([l.replace(/\s+/g, ' ').trim()])); } });
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Text');
      } else {
        lay.forEach((p, pi) => p.blocks.filter(b => b.kind === 'table').forEach((b, ti) => {
          nT++; const aoa = b.rows.map(r => r.map(c => toCell(c.text)));
          if (o.mode === 'one') { if (one.length) one.push([]); one.push([`Page ${pi + 1}, table ${ti + 1}`]); one.push(...aoa); }
          else { const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = b.widths.map(w => ({ wch: Math.max(6, Math.min(60, Math.round(w / 5.5))) })); XLSX.utils.book_append_sheet(wb, ws, `Page ${pi + 1} table ${ti + 1}`.slice(0, 31)); }
        }));
        if (!nT) throw new Error('No tables were detected. Try “Every text line as a row”, or OCR the file first if it is scanned.');
        if (o.mode === 'one') XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(one), 'Tables');
      }
      const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
      return { name: baseName(f.name) + '.xlsx', blob: new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), info: o.mode === 'text' ? 'text lines as rows' : `${nT} table${nT === 1 ? '' : 's'} found` };
    }
  });

  /* ---------------- PDF → PowerPoint ---------------- */
  const X = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  function pptx(slides, cx, cy, title) {
    const ct = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}</Types>`;
    const R = (rels) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map(([id, type, target]) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`).join('')}</Relationships>`;
    const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
    const spTree = inner => `<p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${inner}</p:spTree></p:cSld>`;
    const pres = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:presentation ${NS}><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${10 + i}"/>`).join('')}</p:sldIdLst><p:sldSz cx="${cx}" cy="${cy}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
    const presRels = R([['rId1', 'slideMaster', 'slideMasters/slideMaster1.xml'], ['rId2', 'theme', 'theme/theme1.xml'], ...slides.map((_, i) => [`rId${10 + i}`, 'slide', `slides/slide${i + 1}.xml`])]);
    const master = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldMaster ${NS}>${spTree('')}<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
    const layout = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sldLayout ${NS} type="blank" preserve="1">${spTree('')}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
    const sch = (n, c) => `<a:${n}><a:srgbClr val="${c}"/></a:${n}>`;
    const theme = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Lumen"><a:themeElements><a:clrScheme name="Lumen"><a:dk1><a:srgbClr val="000000"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>${sch('dk2', '1E395B')}${sch('lt2', 'E8F0FA')}${sch('accent1', '3C7FB1')}${sch('accent2', 'E07B12')}${sch('accent3', '1F9A55')}${sch('accent4', 'CF2F2A')}${sch('accent5', '6A3FD0')}${sch('accent6', '13879A')}${sch('hlink', '0066CC')}${sch('folHlink', '6A3FD0')}</a:clrScheme><a:fontScheme name="Lumen"><a:majorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Lumen"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
    const files = {
      '[Content_Types].xml': ct, '_rels/.rels': R([['rId1', 'officeDocument', 'ppt/presentation.xml'], ['rId2', 'metadata/core-properties', 'docProps/core.xml'], ['rId3', 'extended-properties', 'docProps/app.xml']]).replace('officeDocument/2006/relationships/metadata/core-properties', 'package/2006/relationships/metadata/core-properties'),
      'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${X(title)}</dc:title><dc:creator>Lumen Convert</dc:creator></cp:coreProperties>`,
      'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Lumen Convert</Application><Slides>${slides.length}</Slides></Properties>`,
      'ppt/presentation.xml': pres, 'ppt/_rels/presentation.xml.rels': presRels,
      'ppt/slideMasters/slideMaster1.xml': master, 'ppt/slideMasters/_rels/slideMaster1.xml.rels': R([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'theme', '../theme/theme1.xml']]),
      'ppt/slideLayouts/slideLayout1.xml': layout, 'ppt/slideLayouts/_rels/slideLayout1.xml.rels': R([['rId1', 'slideMaster', '../slideMasters/slideMaster1.xml']]),
      'ppt/theme/theme1.xml': theme
    };
    slides.forEach((s, i) => {
      const pic = `<p:pic><p:nvPicPr><p:cNvPr id="2" name="Page ${i + 1}" descr="${X(s.text.slice(0, 2000))}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${s.x}" y="${s.y}"/><a:ext cx="${s.cx}" cy="${s.cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
      files[`ppt/slides/slide${i + 1}.xml`] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><p:sld ${NS}>${spTree(pic)}<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
      files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = R([['rId1', 'slideLayout', '../slideLayouts/slideLayout1.xml'], ['rId2', 'image', `../media/page${i + 1}.jpeg`]]);
      files[`ppt/media/page${i + 1}.jpeg`] = s.jpg;
    });
    return files;
  }
  register({
    id: 'pdf-to-ppt', cat: 'docs', glyph: 'ppt', name: 'PDF → PowerPoint (PPTX)', keywords: 'pdf to powerpoint pptx slides presentation keynote google slides',
    desc: 'One slide per page, sized to the PDF, ready to present or add to.',
    accept: '.pdf,application/pdf', acceptText: 'PDF files (great for slide decks exported as PDF)', acceptTest: isPdf, multiple: true, zipName: 'pdf-pptx',
    options: [{ key: 'pages', label: 'Pages', type: 'text', value: '', placeholder: 'All pages, or e.g. 1-10' }, { key: 'dpi', label: 'Image quality', type: 'select', value: '150', options: [['110', 'Standard (smaller file)'], ['150', 'High'], ['220', 'Very high']] }],
    note: 'Each page becomes a full-slide picture, so it looks exactly like the PDF; the page text is kept as the picture’s alt text. Text on the slides isn’t editable.',
    async each(f, o, ctx) {
      const ff = await U.lib.fflate(), pdf = await U.openPdf(await bytesOf(f));
      try {
        const idx = LC.pdfInternals.parseRanges(o.pages, pdf.numPages), slides = [];
        const p1 = (await pdf.getPage(idx[0] + 1)).getViewport({ scale: 1 }), cx = 12192000, cy = Math.round(cx * p1.height / p1.width);
        for (let k = 0; k < idx.length; k++) {
          ctx.check(); ctx.progress(k / idx.length, `Page ${idx[k] + 1} of ${pdf.numPages}`);
          const page = await pdf.getPage(idx[k] + 1), vp = page.getViewport({ scale: +o.dpi / 72 });
          const c = U.canvas(Math.ceil(vp.width), Math.ceil(vp.height)), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: g, canvas: c, viewport: vp }).promise;
          const jpg = new Uint8Array(await (await U.encodeCanvas(c, 'image/jpeg', 0.88)).arrayBuffer()); c.width = 0;
          const text = (await page.getTextContent()).items.map(t => t.str + (t.hasEOL ? '\n' : '')).join('').trim();
          // fit each page into the slide (pages of a different shape are letterboxed)
          const s = Math.min(cx / vp.width, cy / vp.height), w = Math.round(vp.width * s), h = Math.round(vp.height * s);
          slides.push({ jpg, text, cx: w, cy: h, x: Math.round((cx - w) / 2), y: Math.round((cy - h) / 2) }); page.cleanup();
        }
        const files = pptx(slides, cx, cy, baseName(f.name)), z = {};
        for (const [k, v] of Object.entries(files)) z[k] = [typeof v === 'string' ? ff.strToU8(v) : v, { level: typeof v === 'string' ? 6 : 0 }];
        return { name: baseName(f.name) + '.pptx', blob: new Blob([ff.zipSync(z)], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), info: `${slides.length} slide${slides.length > 1 ? 's' : ''}` };
      } finally { pdf.destroy(); }
    }
  });
  alias('pdf-to-pptx', 'pdf-to-ppt'); alias('pdf-to-powerpoint', 'pdf-to-ppt');

  /* ---------------- Compress PDF (image downsampling adapted from Lumen PDF ops.js optimize) ---------------- */
  register({
    id: 'compress-pdf', cat: 'pdf', glyph: 'compress', name: 'Compress PDF', keywords: 'compress pdf reduce size smaller shrink optimize email upload images downsample',
    desc: 'Shrink PDFs by recompressing large images and packing the file structure.',
    accept: '.pdf,application/pdf', acceptText: 'PDF files (scans and photo-heavy PDFs shrink the most)', acceptTest: isPdf, multiple: true, zipName: 'compressed-pdf', showSaving: true,
    options: [{ key: 'level', label: 'Compression', type: 'select', value: 'medium', options: [['light', 'Light (max 2400 px, high quality)'], ['medium', 'Medium (max 1600 px)'], ['strong', 'Strong (max 1100 px, smaller)']] }, { key: 'gray', label: 'Colour', type: 'checkbox', text: 'Convert images to greyscale', value: false }],
    note: 'Text and vector graphics stay sharp; only images are recompressed. Metadata, forms and links are kept.',
    async each(f, o, ctx) {
      const L = await U.lib.pdfLib(), { PDFName, PDFNumber, PDFRawStream, PDFArray, PDFDict } = L;
      const [maxPx, quality] = { light: [2400, 0.85], medium: [1600, 0.72], strong: [1100, 0.6] }[o.level];
      const src = await bytesOf(f), pdf = await loadLib(src, f.name), cx = pdf.context;
      const objs = [...cx.enumerateIndirectObjects()].filter(([, ob]) => ob instanceof PDFRawStream && ob.dict.lookup(PDFName.of('Subtype'))?.toString() === '/Image');
      let n = 0;
      for (let k = 0; k < objs.length; k++) {
        ctx.check(); ctx.progress(k / Math.max(1, objs.length) * 0.9, `Image ${k + 1} of ${objs.length}`);
        const [ref, obj] = objs[k], d = obj.dict;
        const w = d.lookup(PDFName.of('Width'))?.asNumber?.(), h = d.lookup(PDFName.of('Height'))?.asNumber?.();
        if (!w || !h || d.lookup(PDFName.of('ImageMask'))?.toString() === 'true' || d.get(PDFName.of('Decode')) || d.get(PDFName.of('SMask')) && false) continue;
        const filter = d.lookup(PDFName.of('Filter')), fname = filter instanceof PDFArray ? (filter.size() === 1 ? filter.get(0).toString() : 'multi') : filter?.toString();
        const cs = d.lookup(PDFName.of('ColorSpace')), csn = cs?.toString?.(); let comps = 0;
        if (csn === '/DeviceRGB') comps = 3; else if (csn === '/DeviceGray') comps = 1;
        else if (cs instanceof PDFArray && cs.get(0)?.toString() === '/ICCBased') { const N = cx.lookup(cs.get(1))?.dict?.lookup(PDFName.of('N'))?.asNumber?.(); if (N === 3 || N === 1) comps = N; }
        if (!comps) continue;
        const bpc = d.lookup(PDFName.of('BitsPerComponent'))?.asNumber?.() ?? 8; let bmp = null;
        try {
          if (fname === '/DCTDecode') { if (Math.max(w, h) <= maxPx && obj.contents.length < w * h * 0.2 && !o.gray) continue; bmp = await createImageBitmap(new Blob([obj.contents], { type: 'image/jpeg' })); }
          else if (fname === '/FlateDecode' && bpc === 8) {
            const parms = d.lookup(PDFName.of('DecodeParms')); if (parms instanceof PDFDict && (parms.lookup(PDFName.of('Predictor'))?.asNumber?.() || 1) > 1) continue;
            if (w * h < 40000) continue;
            const raw = L.decodePDFRawStream(obj).decode(); if (raw.length < w * h * comps) continue;
            const id = new ImageData(w, h), px = id.data;
            for (let i = 0, j = 0; i < w * h; i++) { if (comps === 3) { px[j++] = raw[i * 3]; px[j++] = raw[i * 3 + 1]; px[j++] = raw[i * 3 + 2]; } else { const v = raw[i]; px[j++] = v; px[j++] = v; px[j++] = v; } px[j++] = 255; }
            bmp = await createImageBitmap(id);
          } else continue;
        } catch (e) { continue; }
        const s = Math.min(1, maxPx / Math.max(w, h)), nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(h * s));
        const c = U.canvas(nw, nh), g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; if (o.gray) g.filter = 'grayscale(1)'; g.drawImage(bmp, 0, 0, nw, nh); bmp.close?.();
        const jpg = new Uint8Array(await (await U.encodeCanvas(c, 'image/jpeg', quality)).arrayBuffer()); c.width = 0;
        if (jpg.length >= obj.contents.length * 0.92 && !o.gray) continue;
        const nd = d.clone(cx);
        nd.set(PDFName.of('Width'), PDFNumber.of(nw)); nd.set(PDFName.of('Height'), PDFNumber.of(nh)); nd.set(PDFName.of('Filter'), PDFName.of('DCTDecode')); nd.delete(PDFName.of('DecodeParms'));
        nd.set(PDFName.of('ColorSpace'), PDFName.of('DeviceRGB')); nd.set(PDFName.of('BitsPerComponent'), PDFNumber.of(8)); nd.set(PDFName.of('Length'), PDFNumber.of(jpg.length));
        cx.assign(ref, PDFRawStream.of(nd, jpg)); n++;
      }
      ctx.progress(0.95, 'Packing the file');
      const out = await pdf.save({ useObjectStreams: true, updateFieldAppearances: false });
      const better = out.length < src.length;
      return { name: `${baseName(f.name)}-compressed.pdf`, blob: pdfBlob(better ? out : src), info: `${fmtSize(src.length)} → ${fmtSize(better ? out.length : src.length)} · ${n} of ${objs.length} image${objs.length === 1 ? '' : 's'} recompressed${better ? '' : ' · already as small as it gets, original kept'}` };
    }
  });
  alias('reduce-pdf-size', 'compress-pdf');

  /* ---------------- Protect / Unlock (Lumen PDF security handler: AES-256, R6) ---------------- */
  register({
    id: 'protect-pdf', cat: 'pdf', glyph: 'lock', name: 'Protect PDF with a password', keywords: 'protect pdf password encrypt lock secure aes 256 permissions restrict printing copying',
    desc: 'Encrypt with AES-256 so a password is needed to open it, and optionally restrict printing or copying.',
    accept: '.pdf,application/pdf', acceptText: 'One or more PDF files (all get the same password)', acceptTest: isPdf, multiple: true, zipName: 'protected-pdf', button: 'Protect',
    options: [
      { key: 'pw', label: 'Password', type: 'password', value: '', placeholder: 'Needed to open the file' },
      { key: 'pw2', label: 'Confirm', type: 'password', value: '', placeholder: 'Type it again' },
      { key: 'owner', label: 'Owner password', type: 'password', value: '', placeholder: 'Optional: needed to change permissions' },
      { key: 'perms', label: 'Allow', type: 'checks', value: ['print', 'printHigh', 'copy', 'annotate', 'fill', 'accessibility'], options: [['print', 'Printing'], ['printHigh', 'High-res printing'], ['copy', 'Copying text'], ['modify', 'Editing'], ['annotate', 'Comments'], ['fill', 'Form filling'], ['assemble', 'Page assembly'], ['accessibility', 'Screen readers']] }],
    note: 'Uses the standard PDF AES-256 encryption that Acrobat, Chrome, macOS Preview and qpdf all open. Keep the password safe: there is no way to recover it.',
    async each(f, o, ctx) {
      if (!o.pw) throw new Error('Enter a password');
      if (o.pw !== o.pw2) throw new Error('The two passwords don’t match');
      const sec = await lumenPdf('security.js'), src = await bytesOf(f);
      if (await sec.inspect(src)) { await loadLib(src, f.name).catch(() => { throw new Error(`“${f.name}” is already encrypted. Unlock it first.`); }); }
      const all = ['print', 'printHigh', 'copy', 'modify', 'annotate', 'fill', 'assemble', 'accessibility'];
      const perms = Object.fromEntries(all.map(k => [k, o.perms.includes(k)]));
      ctx.progress(0.3, 'Encrypting');
      // re-save through pdf-lib first so the file has a clean cross-reference table
      const clean = await (await loadLib(src, f.name)).save({ useObjectStreams: false });
      const s = await sec.newSecurity({ userPassword: o.pw, ownerPassword: o.owner || '', method: 'AES-256', perms });
      const out = await sec.encryptPdf(clean, s);
      const restricted = all.filter(k => !perms[k]);
      return { name: `${baseName(f.name)}-protected.pdf`, blob: pdfBlob(out), info: `AES-256 · password to open${restricted.length ? ' · restricted: ' + restricted.join(', ') : ''}` };
    }
  });
  register({
    id: 'unlock-pdf', cat: 'pdf', glyph: 'unlock', name: 'Unlock PDF', keywords: 'unlock pdf remove password decrypt unprotect remove restrictions',
    desc: 'Remove the password from a PDF you have the password for.',
    accept: '.pdf,application/pdf', acceptText: 'A password-protected PDF', acceptTest: isPdf, multiple: false, button: 'Unlock',
    options: [{ key: 'pw', label: 'Password', type: 'password', value: '', placeholder: 'The PDF’s password' }],
    note: 'You need the password. This tool never guesses or bypasses passwords. Removing restrictions (printing, copying…) needs the owner password.',
    async each(f, o, ctx) {
      const sec = await lumenPdf('security.js'), src = await bytesOf(f);
      if (!(await sec.inspect(src))) throw new Error('This PDF isn’t password-protected.');
      ctx.progress(0.3, 'Checking the password');
      let r;
      try { r = await sec.decryptPdf(src, o.pw || ''); }
      catch (e) { if (e.name === 'PasswordError') throw new Error(o.pw ? 'That password is not correct.' : 'Enter the PDF’s password.'); if (e.name === 'UnsupportedSecurity') throw new Error('This PDF uses a security method this tool doesn’t support (e.g. certificate encryption).'); throw e; }
      if (!r.security) throw new Error('This PDF isn’t password-protected.');
      const restricted = !Object.values(r.security.perms).every(Boolean);
      if (!r.security.owner && restricted) throw new Error(o.pw ? 'That password opens the file, but its permissions can only be removed with the owner password.' : 'This PDF has permission restrictions. Enter its owner password to remove them.');
      return { name: `${baseName(f.name)}-unlocked.pdf`, blob: pdfBlob(r.bytes), info: `${r.security.method} removed` };
    }
  });
  alias('remove-pdf-password', 'unlock-pdf'); alias('encrypt-pdf', 'protect-pdf');

  /* ---------------- Page numbers ---------------- */
  register({
    id: 'page-numbers', cat: 'pdf', glyph: 'pagenum', name: 'Add page numbers', keywords: 'page numbers pdf number pages footer header bates',
    desc: 'Number every page: position, format (“Page 3 of 10”), start number and size.',
    accept: '.pdf,application/pdf', acceptText: 'PDF files', acceptTest: isPdf, multiple: true, zipName: 'numbered-pdf',
    options: [
      { key: 'pos', label: 'Position', type: 'select', value: 'bc', options: [['bc', 'Bottom centre'], ['br', 'Bottom right'], ['bl', 'Bottom left'], ['tc', 'Top centre'], ['tr', 'Top right'], ['tl', 'Top left']] },
      { key: 'fmt', label: 'Format', type: 'select', value: 'n', options: [['n', '1'], ['page', 'Page 1'], ['of', 'Page 1 of 10'], ['slash', '1 / 10'], ['dash', '– 1 –']] },
      { key: 'start', label: 'Start at', type: 'number', min: 0, max: 99999, step: 1, value: 1 },
      { key: 'skip', label: 'First page', type: 'checkbox', text: 'Don’t number the first page (cover)', value: false },
      { key: 'size', label: 'Size', type: 'number', min: 6, max: 36, step: 1, value: 10, unit: 'pt' },
      { key: 'margin', label: 'Margin', type: 'number', min: 4, max: 100, step: 1, value: 24, unit: 'pt' },
      { key: 'color', label: 'Colour', type: 'color', value: '#333333' }],
    async each(f, o, ctx) {
      const L = await U.lib.pdfLib(), pdf = await loadLib(await bytesOf(f), f.name), font = await pdf.embedFont(L.StandardFonts.Helvetica);
      const pages = pdf.getPages(), N = pages.length - (o.skip ? 1 : 0) + (+o.start - 1), [r, g, b] = LC.pdfColor(o.color);
      pages.forEach((page, i) => {
        if (o.skip && i === 0) return;
        const n = +o.start + i - (o.skip ? 1 : 0);
        const t = { n: `${n}`, page: `Page ${n}`, of: `Page ${n} of ${N}`, slash: `${n} / ${N}`, dash: `– ${n} –` }[o.fmt];
        const B = displayBox(page), w = font.widthOfTextAtSize(t, o.size), m = +o.margin;
        const dx = o.pos[1] === 'c' ? (B.W - w) / 2 : o.pos[1] === 'r' ? B.W - m - w : m, dy = o.pos[0] === 'b' ? m : B.H - m - o.size * 0.75;
        const [x, y, rot] = toUser(B, dx, dy);
        page.drawText(t, { x, y, size: o.size, font, color: L.rgb(r, g, b), rotate: L.degrees(rot) });
      });
      return { name: `${baseName(f.name)}-numbered.pdf`, blob: pdfBlob(await pdf.save({ useObjectStreams: true })), info: `${pages.length - (o.skip ? 1 : 0)} pages numbered` };
    }
  });
  LC.pdfColor = h => { const n = parseInt(String(h).replace('#', ''), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

  /* ---------------- Watermark ---------------- */
  async function unicodeFont(pdf) {
    const fk = await U.loadScript('vendor/fontkit.umd.min.js', 'fontkit'); pdf.registerFontkit(fk);
    return pdf.embedFont(new Uint8Array(await (await fetch('vendor/fonts/DejaVuSans.ttf')).arrayBuffer()), { subset: true });
  }
  register({
    id: 'watermark-pdf', cat: 'pdf', glyph: 'stamp', name: 'Watermark PDF', keywords: 'watermark pdf stamp confidential draft text logo image overlay',
    desc: 'Stamp text (“CONFIDENTIAL”, “DRAFT”…) or a logo across every page.',
    accept: '.pdf,application/pdf,image/png,image/jpeg', acceptText: 'PDF files (add a PNG/JPEG too to use it as an image watermark)', acceptTest: f => isPdf(f) || /^image\/(png|jpeg)$/.test(f.type), multiple: true, zipName: 'watermarked-pdf',
    options: [
      { key: 'text', label: 'Text', type: 'text', value: 'CONFIDENTIAL', placeholder: 'Ignored if you add an image' },
      { key: 'layout', label: 'Layout', type: 'select', value: 'center', options: [['center', 'Once, centred'], ['tile', 'Tiled across the page'], ['footer', 'Small, bottom right']] },
      { key: 'angle', label: 'Angle', type: 'range', min: -90, max: 90, step: 1, value: 45, fmt: v => v + '°' },
      { key: 'size', label: 'Size', type: 'range', min: 10, max: 120, step: 1, value: 60, fmt: v => v + ' pt' },
      { key: 'opacity', label: 'Opacity', type: 'range', min: 0.05, max: 1, step: 0.01, value: 0.25, fmt: v => Math.round(v * 100) + '%' },
      { key: 'color', label: 'Colour', type: 'color', value: '#c62828' }],
    async run(files, o, ctx) {
      const L = await U.lib.pdfLib(), imgFile = files.find(f => !isPdf(f)), pdfs = files.filter(isPdf), out = [];
      if (!pdfs.length) throw new Error('Add at least one PDF');
      if (!imgFile && !o.text.trim()) throw new Error('Enter watermark text or add an image');
      for (let k = 0; k < pdfs.length; k++) {
        const f = pdfs[k]; ctx.check(); ctx.progress(k / pdfs.length, 'Stamping ' + f.name);
        try {
          const pdf = await loadLib(await bytesOf(f), f.name);
          const [r, g, b] = LC.pdfColor(o.color), color = L.rgb(r, g, b);
          let img = null, font = null;
          if (imgFile) { const ib = await bytesOf(imgFile); img = imgFile.type === 'image/png' ? await pdf.embedPng(ib) : await pdf.embedJpg(ib); }
          else font = await unicodeFont(pdf);
          for (const page of pdf.getPages()) {
            const B = displayBox(page);
            const stamp = (cx, cy, scale = 1) => {
              const a = (o.angle * Math.PI) / 180;
              if (img) {
                const w = Math.min(B.W, B.H) * 0.5 * (o.size / 60) * scale, h = w * img.height / img.width;
                const dx = cx - (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a), dy = cy - (w / 2) * Math.sin(a) - (h / 2) * Math.cos(a);
                const [x, y, rot] = toUser(B, dx, dy);
                page.drawImage(img, { x, y, width: w, height: h, rotate: L.degrees(rot + o.angle), opacity: o.opacity });
              } else {
                const size = o.size * scale, w = font.widthOfTextAtSize(o.text, size), h = size * 0.7;
                const dx = cx - (w / 2) * Math.cos(a) + (h / 2) * Math.sin(a), dy = cy - (w / 2) * Math.sin(a) - (h / 2) * Math.cos(a);
                const [x, y, rot] = toUser(B, dx, dy);
                page.drawText(o.text, { x, y, size, font, color, opacity: o.opacity, rotate: L.degrees(rot + o.angle) });
              }
            };
            if (o.layout === 'center') stamp(B.W / 2, B.H / 2);
            else if (o.layout === 'footer') { const s = 0.3; const w = img ? Math.min(B.W, B.H) * 0.15 : font.widthOfTextAtSize(o.text, o.size * s); stamp(B.W - 24 - w / 2, 24 + o.size * s / 2, s); }
            else { const step = Math.max(120, o.size * 4); for (let y = step / 2; y < B.H; y += step) for (let x = step / 2 + ((y / step) % 2) * step / 2; x < B.W + step; x += step) stamp(x, y, 0.6); }
          }
          out.push({ name: `${baseName(f.name)}-watermarked.pdf`, blob: pdfBlob(await pdf.save({ useObjectStreams: true })), info: `${pdf.getPageCount()} pages · ${img ? 'image' : '“' + o.text + '”'}` });
        } catch (e) { out.push({ name: f.name, error: e.message }); }
      }
      return out;
    }
  });

  /* ---------------- Metadata ---------------- */
  register({
    id: 'pdf-metadata', cat: 'pdf', glyph: 'info', name: 'Edit PDF metadata', keywords: 'pdf metadata properties title author subject keywords remove privacy docinfo xmp',
    desc: 'Change the title, author, subject and keywords, or strip all metadata for privacy.',
    accept: '.pdf,application/pdf', acceptText: 'One PDF', acceptTest: isPdf, multiple: false, button: 'Save',
    options: [
      { key: 'mode', label: 'Action', type: 'select', value: 'edit', options: [['edit', 'Edit the fields below'], ['strip', 'Remove all metadata']] },
      { key: 'title', label: 'Title', type: 'text', value: '', placeholder: 'Leave empty to keep', show: o => o.mode === 'edit' },
      { key: 'author', label: 'Author', type: 'text', value: '', placeholder: 'Leave empty to keep', show: o => o.mode === 'edit' },
      { key: 'subject', label: 'Subject', type: 'text', value: '', placeholder: 'Leave empty to keep', show: o => o.mode === 'edit' },
      { key: 'keywords', label: 'Keywords', type: 'text', value: '', placeholder: 'Comma-separated', show: o => o.mode === 'edit' }],
    async each(f, o) {
      const L = await U.lib.pdfLib(), pdf = await loadLib(await bytesOf(f), f.name);
      const before = { title: pdf.getTitle(), author: pdf.getAuthor(), subject: pdf.getSubject(), keywords: pdf.getKeywords(), creator: pdf.getCreator(), producer: pdf.getProducer() };
      if (o.mode === 'strip') {
        const cat = pdf.catalog; cat.delete(L.PDFName.of('Metadata'));
        const info = pdf.context.trailerInfo.Info; if (info) pdf.context.delete(info);
        pdf.context.trailerInfo.Info = pdf.context.register(pdf.context.obj({}));
      } else {
        if (o.title.trim()) pdf.setTitle(o.title.trim()); if (o.author.trim()) pdf.setAuthor(o.author.trim()); if (o.subject.trim()) pdf.setSubject(o.subject.trim());
        if (o.keywords.trim()) pdf.setKeywords(o.keywords.split(',').map(s => s.trim()).filter(Boolean));
        pdf.setModificationDate(new Date());
        pdf.catalog.delete(L.PDFName.of('Metadata')); // stale XMP would contradict the new values
      }
      const out = await pdf.save({ useObjectStreams: true });
      const was = Object.entries(before).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'no metadata';
      return { name: `${baseName(f.name)}${o.mode === 'strip' ? '-clean' : ''}.pdf`, blob: pdfBlob(out), info: (o.mode === 'strip' ? 'All metadata removed · was ' : 'Updated · was ') + was };
    }
  });

  /* ---------------- Compare two PDFs (Lumen PDF word diff + pixel diff) ---------------- */
  register({
    id: 'compare-pdf', cat: 'pdf', glyph: 'compare', name: 'Compare two PDFs', keywords: 'compare pdf diff difference changes versions redline track changes visual',
    desc: 'See what changed between two versions: a word-by-word change list, highlighted PDFs and a visual diff.',
    accept: '.pdf,application/pdf', acceptText: 'Exactly two PDFs: the original first, then the revised one (▲▼ to swap)', acceptTest: isPdf, multiple: true, reorder: true, minFiles: 2, button: 'Compare', zipName: 'comparison',
    options: [{ key: 'visual', label: 'Visual diff', type: 'checkbox', text: 'Also make pixel-difference images of changed pages', value: true }],
    async run(files, o, ctx) {
      if (files.length !== 2) throw new Error('Add exactly two PDFs: the original and the revised version');
      const cmp = await lumenPdf('compare.js'), L = await U.lib.pdfLib();
      const [a, b] = [await bytesOf(files[0]), await bytesOf(files[1])];
      const res = await cmp.compareBytes(a, b, { names: [files[0].name, files[1].name], prog: progAdapter(ctx) });
      const s = res.summary, out = [];
      // change list
      const lines = [`Comparison: “${files[0].name}” → “${files[1].name}”`, `${s.changes} change${s.changes === 1 ? '' : 's'}: ${s.replace} replaced, ${s.insert} inserted, ${s.delete} deleted · ${s.wordsAdded} words added, ${s.wordsRemoved} removed`, ''];
      for (const c of res.changes) lines.push(`#${c.n} ${c.type.toUpperCase()} (page ${c.newPage + 1})${c.oldText ? `\n   − ${c.oldText}` : ''}${c.newText ? `\n   + ${c.newText}` : ''}`);
      const report = lines.join('\n') + '\n';
      out.push({ name: 'changes.txt', blob: new Blob([report], { type: 'text/plain;charset=utf-8' }), text: report, info: `${s.changes} change${s.changes === 1 ? '' : 's'}` });
      // highlighted copies: additions in the revised file, removals in the original
      const mark = async (bytes, words, idxList, color, name) => {
        const pdf = await loadLib(bytes, name), pages = pdf.getPages(); let n = 0;
        for (const i of idxList) { const w = words[i]; const page = pages[w.page]; if (!page) continue; const [x1, y1, x2, y2] = w.box; page.drawRectangle({ x: x1 - 1, y: y1 - 1, width: x2 - x1 + 2, height: y2 - y1 + 2, color, opacity: 0.35, borderWidth: 0 }); n++; }
        return { bytes: await pdf.save(), n };
      };
      ctx.progress(0.9, 'Marking changes');
      const ins = res.changes.flatMap(c => c.ins), del = res.changes.flatMap(c => c.del);
      const B = await mark(b, res.B.words, ins, L.rgb(0.2, 0.85, 0.3), files[1].name), A = await mark(a, res.A.words, del, L.rgb(0.95, 0.25, 0.25), files[0].name);
      out.push({ name: `${baseName(files[1].name)}-additions.pdf`, blob: pdfBlob(B.bytes), info: `${B.n} added/changed words highlighted in green` });
      out.push({ name: `${baseName(files[0].name)}-removals.pdf`, blob: pdfBlob(A.bytes), info: `${A.n} removed/changed words highlighted in red` });
      res.pa.destroy?.(); res.pb.destroy?.();
      if (o.visual) {
        const pa = await U.openPdf(a), pb = await U.openPdf(b);
        try {
          const n = Math.max(pa.numPages, pb.numPages);
          for (let p = 1; p <= n; p++) {
            ctx.check(); ctx.progress(0.92 + 0.07 * p / n, `Visual diff, page ${p}`);
            const render = async (pdf) => { if (p > pdf.numPages) return null; const pg = await pdf.getPage(p), vp = pg.getViewport({ scale: 1.5 }); const c = U.canvas(Math.ceil(vp.width), Math.ceil(vp.height)), g = c.getContext('2d', { willReadFrequently: true }); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); await pg.render({ canvasContext: g, canvas: c, viewport: vp }).promise; return c; };
            const ca = await render(pa), cb = await render(pb);
            if (!ca || !cb) { out.push({ name: `page-${p}-only-in-${ca ? 'original' : 'revised'}.txt`, blob: new Blob([`Page ${p} exists only in the ${ca ? 'original' : 'revised'} file.\n`], { type: 'text/plain' }), info: 'page count differs' }); continue; }
            const W = Math.max(ca.width, cb.width), H = Math.max(ca.height, cb.height), da = U.drawTo(ca, W, H, '#fff').getContext('2d').getImageData(0, 0, W, H).data, db = U.drawTo(cb, W, H, '#fff').getContext('2d').getImageData(0, 0, W, H).data;
            const outC = U.drawTo(cb, W, H, '#fff'), og = outC.getContext('2d'), od = og.getImageData(0, 0, W, H); let diff = 0;
            for (let i = 0; i < W * H; i++) {
              const k = i * 4, d = Math.abs(da[k] - db[k]) + Math.abs(da[k + 1] - db[k + 1]) + Math.abs(da[k + 2] - db[k + 2]);
              if (d > 60) { diff++; od.data[k] = 255; od.data[k + 1] = 0; od.data[k + 2] = 200; } else { od.data[k] = 255 - (255 - od.data[k]) * 0.35; od.data[k + 1] = 255 - (255 - od.data[k + 1]) * 0.35; od.data[k + 2] = 255 - (255 - od.data[k + 2]) * 0.35; }
            }
            if (!diff) continue;
            og.putImageData(od, 0, 0);
            out.push({ name: `visual-diff-page-${p}.png`, blob: await U.encodeCanvas(outC, 'image/png'), thumb: true, info: `${(diff / (W * H) * 100).toFixed(2)}% of the page changed (magenta)` });
          }
        } finally { pa.destroy(); pb.destroy(); }
      }
      return out;
    }
  });
  alias('diff-pdf', 'compare-pdf');

  /* ---------------- EPUB → PDF and DOCX → EPUB ---------------- */
  register({
    id: 'epub-to-pdf', cat: 'docs', glyph: 'epub', name: 'EPUB → PDF', keywords: 'epub ebook to pdf print book convert',
    desc: 'Typeset e-books as PDFs, with chapters on new pages and the book’s images.',
    accept: '.epub,application/epub+zip', acceptText: 'EPUB e-books (DRM-free)', acceptTest: f => extOf(f.name) === 'epub' || f.type === 'application/epub+zip', multiple: true, zipName: 'epub-pdf',
    options: [
      { key: 'page', label: 'Page size', type: 'select', value: 'a5', options: [['a5', 'A5 (book)'], ['a4', 'A4'], ['letter', 'US Letter']] },
      { key: 'font', label: 'Font', type: 'select', value: 'times', options: [['times', 'Serif (Source Serif 4)'], ['helvetica', 'Sans-serif (Montserrat)']] },
      { key: 'size', label: 'Text size', type: 'number', min: 7, max: 18, step: 0.5, value: 10.5, unit: 'pt' }],
    async each(f, o, ctx) {
      const ff = await U.lib.fflate(); let total = 0, files;
      try { files = ff.unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: fi => { total += fi.originalSize; if (total > 400 * 1048576) throw new Error('big'); return true; } }); } catch (e) { throw new Error(e.message === 'big' ? 'The e-book unpacks to more than 400 MB' : 'Not a valid EPUB (zip) file'); }
      const dec = k => new TextDecoder().decode(files[k]), xml = s => new DOMParser().parseFromString(s, 'application/xml');
      if (!files['META-INF/container.xml']) throw new Error('Not an EPUB (META-INF/container.xml missing)');
      const opfPath = xml(dec('META-INF/container.xml')).querySelector('rootfile')?.getAttribute('full-path'); if (!opfPath || !files[opfPath]) throw new Error('The EPUB package file is missing');
      const opf = xml(dec(opfPath)), dir = opfPath.includes('/') ? opfPath.replace(/[^/]*$/, '') : '';
      const title = opf.getElementsByTagName('dc:title')[0]?.textContent?.trim() || baseName(f.name), author = opf.getElementsByTagName('dc:creator')[0]?.textContent?.trim();
      const man = {}; for (const it of opf.getElementsByTagName('item')) man[it.getAttribute('id')] = { href: it.getAttribute('href'), type: it.getAttribute('media-type') };
      const spine = [...opf.getElementsByTagName('itemref')].map(r => man[r.getAttribute('idref')]?.href).filter(Boolean);
      const resolve = (from, h) => { const parts = (from.replace(/[^/]*$/, '') + decodeURIComponent(h.split('#')[0])).split('/'), out = []; for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.' && p) out.push(p); } return out.join('/'); };
      const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
      const blocks = [{ type: 'h', level: 1, runs: [{ t: title }] }]; if (author) blocks.push({ type: 'p', runs: [{ t: 'by ' + author, i: true }] });
      const DOMPurify = await U.lib.purify();
      for (let i = 0; i < spine.length; i++) {
        ctx.check(); ctx.progress(0.05 + 0.3 * i / spine.length, `Reading chapter ${i + 1} of ${spine.length}`);
        const p = resolve(dir, spine[i]); if (!files[p]) continue;
        let d = new DOMParser().parseFromString(dec(p), 'application/xhtml+xml'); if (d.querySelector('parsererror')) d = new DOMParser().parseFromString(dec(p), 'text/html');
        // inline the book's own images as data: URLs (only files inside the EPUB; nothing is fetched)
        for (const im of d.querySelectorAll('img, image')) {
          const src = im.getAttribute('src') || im.getAttribute('href') || im.getAttributeNS('http://www.w3.org/1999/xlink', 'href'); if (!src || /^[a-z]+:/i.test(src)) { im.remove(); continue; }
          const ip = resolve(p, src), x = extOf(ip); if (!files[ip] || !MIME[x] || x === 'svg') { im.remove(); continue; }
          let bin = ''; const b = files[ip]; for (let k = 0; k < b.length; k += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(k, k + 0x8000));
          const img = d.createElement('img'); img.setAttribute('src', `data:${MIME[x]};base64,${btoa(bin)}`); im.replaceWith(img);
        }
        const body = d.body || d.getElementsByTagName('body')[0]; if (!body) continue;
        const clean = new DOMParser().parseFromString(DOMPurify.sanitize(new XMLSerializer().serializeToString(body).replace(/^<body[^>]*>|<\/body>$/g, '')), 'text/html');
        const bl = await LC.pdfInternals.htmlToBlocks(clean.body);
        if (bl.length) { blocks.push({ type: 'pagebreak' }, ...bl); }
      }
      if (blocks.length < 3) throw new Error('No readable chapters in this e-book');
      const r = await LC.pdfInternals.layoutPdf(blocks, { page: o.page, font: o.font, size: o.size, margin: 16, title }, ctx);
      return { name: baseName(f.name) + '.pdf', blob: pdfBlob(r.bytes), info: `${r.pages} pages · ${spine.length} sections` };
    }
  });
  register({
    id: 'docx-to-epub', cat: 'docs', glyph: 'epub', name: 'DOCX → EPUB', keywords: 'docx word to epub ebook kindle kobo apple books publish',
    desc: 'Turn a Word manuscript into an e-book, split into chapters at each Heading 1.',
    accept: '.docx', acceptText: 'Word .docx files', acceptTest: f => extOf(f.name) === 'docx', multiple: true, zipName: 'docx-epub',
    options: [{ key: 'title', label: 'Title', type: 'text', value: '', placeholder: 'Defaults to the file name' }, { key: 'author', label: 'Author', type: 'text', value: '', placeholder: 'Optional' }, { key: 'lang', label: 'Language', type: 'text', value: 'en', width: 60 }],
    async each(f, o, ctx) {
      const mammoth = await U.loadScript('vendor/mammoth.browser.min.js', 'mammoth'), ff = await U.lib.fflate(), DOMPurify = await U.lib.purify();
      ctx.progress(0.2, 'Reading ' + f.name);
      let html; try { html = (await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() })).value; } catch (e) { throw new Error(`“${f.name}” isn’t a readable .docx file`); }
      const doc = new DOMParser().parseFromString(DOMPurify.sanitize(html), 'text/html');
      const title = o.title.trim() || baseName(f.name), lang = (o.lang || 'en').replace(/[^A-Za-z-]/g, '') || 'en', uid = 'urn:uuid:' + crypto.randomUUID();
      // images → files
      const media = []; let mi = 0;
      for (const im of doc.querySelectorAll('img')) {
        const src = im.getAttribute('src') || '';
        try { const { bytes, mime } = LC.imageInternals.parseDataInput(src); const x = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif' }[mime]; if (!x) { im.remove(); continue; } const name = `images/img${++mi}.${x}`; media.push({ name, bytes, mime }); im.setAttribute('src', '../' + name); if (!im.getAttribute('alt')) im.setAttribute('alt', ''); } catch (e) { im.remove(); }
      }
      // chapters split at <h1>
      const chapters = []; let cur = { title: title, nodes: [] };
      for (const n of [...doc.body.childNodes]) { if (n.nodeType === 1 && n.tagName === 'H1') { if (cur.nodes.length) chapters.push(cur); cur = { title: n.textContent.trim() || 'Chapter', nodes: [n] }; } else cur.nodes.push(n); }
      if (cur.nodes.length) chapters.push(cur);
      const ser = new XMLSerializer();
      const xhtml = (t, body) => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">\n<head><meta charset="UTF-8"/><title>${X(t)}</title><link rel="stylesheet" type="text/css" href="../style.css"/></head>\n<body>\n${body}\n</body>\n</html>\n`;
      const files = { mimetype: [ff.strToU8('application/epub+zip'), { level: 0 }] };
      const S = s => ff.strToU8(s);
      files['META-INF/container.xml'] = S('<?xml version="1.0" encoding="UTF-8"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>\n');
      files['OEBPS/style.css'] = S('body{font-family:serif;line-height:1.5;margin:0 5%}h1,h2,h3{font-family:sans-serif;line-height:1.2}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #999;padding:.2em .4em}\n');
      chapters.forEach((c, i) => { const body = c.nodes.map(n => n.nodeType === 1 ? ser.serializeToString(n).replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '') : X(n.textContent)).join('\n'); files[`OEBPS/text/ch${i + 1}.xhtml`] = S(xhtml(c.title, body)); });
      files['OEBPS/nav.xhtml'] = S(`<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}"><head><meta charset="UTF-8"/><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${chapters.map((c, i) => `<li><a href="text/ch${i + 1}.xhtml">${X(c.title)}</a></li>`).join('')}</ol></nav></body></html>\n`);
      for (const m of media) files['OEBPS/' + m.name] = [m.bytes, { level: 0 }];
      const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
      files['OEBPS/content.opf'] = S(`<?xml version="1.0" encoding="UTF-8"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${uid}</dc:identifier><dc:title>${X(title)}</dc:title>${o.author.trim() ? `<dc:creator>${X(o.author.trim())}</dc:creator>` : ''}<dc:language>${lang}</dc:language><meta property="dcterms:modified">${now}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="css" href="style.css" media-type="text/css"/>${chapters.map((_, i) => `<item id="ch${i + 1}" href="text/ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')}${media.map((m, i) => `<item id="img${i + 1}" href="${m.name}" media-type="${m.mime}"/>`).join('')}</manifest><spine>${chapters.map((_, i) => `<itemref idref="ch${i + 1}"/>`).join('')}</spine></package>\n`);
      // fflate keeps insertion order, so "mimetype" is the first, uncompressed entry as the EPUB spec requires
      const zip = ff.zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Array.isArray(v) ? v : [v, { level: 6 }]])));
      return { name: baseName(f.name) + '.epub', blob: new Blob([zip], { type: 'application/epub+zip' }), info: `${chapters.length} chapter${chapters.length > 1 ? 's' : ''} · ${media.length} image${media.length === 1 ? '' : 's'}` };
    }
  });

  LC.pdf2Internals = { displayBox, toUser, toCell, pptx, unicodeFont, loadLib, lumenPdf };
})();
