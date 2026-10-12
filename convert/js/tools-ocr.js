'use strict';
/* Lumen Convert — OCR: Image → text and Scanned PDF → searchable PDF / text.
   The engine (tesseract.js 7 + WASM core + English "best_int" LSTM data) is shared with Lumen PDF and loaded on demand from
   ../pdf/vendor/tesseract/ — same origin, no network, nothing cached in IndexedDB. Searchable PDFs get an invisible
   (render mode 3) text layer, one positioned word at a time, in DejaVu Sans so any recognised character can be embedded. */
(() => {
  const { register, alias, util: U } = LC;
  const { baseName, extOf } = U;
  const BASE = new URL('../pdf/vendor/tesseract/', document.baseURI).href;
  const isImg = f => /^image\//.test(f.type) || /^(png|jpe?g|webp|bmp|gif|avif|tiff?)$/.test(extOf(f.name));
  const isPdf = f => f.type === 'application/pdf' || extOf(f.name) === 'pdf';

  // One worker per run; cancelling terminates it immediately.
  async function startOcr(ctx, onProgress) {
    ctx.progress(0.01, 'Loading the OCR engine (about 11 MB, first time only)');
    const T = await U.loadScript(BASE + 'tesseract.min.js', 'Tesseract').catch(() => { throw new Error('The OCR engine isn’t available on this copy of the site (../pdf/vendor/tesseract is missing)'); });
    const worker = await T.createWorker('eng', 1, {
      workerPath: BASE + 'worker.min.js', corePath: BASE + 'core', langPath: BASE + 'lang', gzip: true,
      cacheMethod: 'none', workerBlobURL: false, logger: m => onProgress && onProgress(m), errorHandler: () => { }
    });
    let dead = false;
    const watch = setInterval(() => { if (ctx.cancelled && !dead) { dead = true; worker.terminate().catch(() => { }); } }, 150);
    return {
      async recognize(canvas) {
        if (dead) throw new Error('Cancelled');
        const r = worker.recognize(canvas, {}, { text: true, blocks: true });
        const cancel = new Promise((_, rej) => { const iv = setInterval(() => { if (dead) { clearInterval(iv); rej(new Error('Cancelled')); } }, 150); r.finally(() => clearInterval(iv)).catch(() => { }); });
        return (await Promise.race([r, cancel])).data;
      },
      async end() { clearInterval(watch); if (!dead) { dead = true; await worker.terminate().catch(() => { }); } }
    };
  }
  // words from tesseract blocks → [{text, p0:[x,y], p1:[x,y], size}] in PDF points via toPdf(px, py)
  function wordsOf(data, toPdf, pxToPt) {
    const words = [];
    for (const b of data.blocks || []) for (const p of b.paragraphs || []) for (const ln of p.lines || []) {
      const bl = ln.baseline || { x0: ln.bbox.x0, y0: ln.bbox.y1, x1: ln.bbox.x1, y1: ln.bbox.y1 };
      const slope = (bl.y1 - bl.y0) / Math.max(1, bl.x1 - bl.x0), lineH = Math.max(4, ln.bbox.y1 - ln.bbox.y0);
      for (const w of ln.words || []) {
        const t = (w.text || '').trim(); if (!t || w.confidence < 20) continue;
        const yb = x => bl.y0 + slope * (x - bl.x0);
        words.push({ text: t, p0: toPdf(w.bbox.x0, yb(w.bbox.x0)), p1: toPdf(w.bbox.x1, yb(w.bbox.x1)), size: lineH / 0.93 * pxToPt });
      }
    }
    return words;
  }
  const cleanText = t => (t || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  async function textFont(doc) {
    const fk = await U.loadScript('vendor/fontkit.umd.min.js', 'fontkit'); doc.registerFontkit(fk);
    const bytes = new Uint8Array(await (await fetch('vendor/fonts/DejaVuSans.ttf')).arrayBuffer());
    const font = await doc.embedFont(bytes, { subset: true });
    const face = font.embedder.font;
    return { font, clean: s => [...s].map(c => face.hasGlyphForCodePoint(c.codePointAt(0)) ? c : '?').join('') };
  }
  // invisible, selectable words (text render mode 3), each scaled horizontally to its recognised width
  function addTextLayer(PL, page, tf, words) {
    if (!words.length) return;
    page.node.normalize(); // wraps the existing content in q/Q so its graphics state can't leak into ours
    const key = page.node.newFontDictionary(tf.font.name, tf.font.ref);
    const ops = [PL.beginText(), PL.setTextRenderingMode(PL.TextRenderingMode.Invisible)];
    for (const w of words) {
      const txt = tf.clean(w.text); const dx = w.p1[0] - w.p0[0], dy = w.p1[1] - w.p0[1], len = Math.hypot(dx, dy); if (len < 0.5) continue;
      const ux = dx / len, uy = dy / len, size = Math.max(1, w.size), natural = tf.font.widthOfTextAtSize(txt, size);
      ops.push(PL.setFontAndSize(key, size), PL.setCharacterSqueeze(Math.max(1, Math.min(1000, len / Math.max(0.01, natural) * 100))),
        PL.setTextMatrix(ux, uy, -uy, ux, w.p0[0], w.p0[1]), PL.showText(tf.font.encodeText(txt + ' ')));
    }
    ops.push(PL.endText());
    page.pushOperators(...ops);
  }
  const statusOf = (m, base, span, label) => m.status === 'recognizing text' ? [base + span * (m.progress || 0), `${label}: recognizing ${Math.round((m.progress || 0) * 100)}%`] : null;

  /* Image → text (or a searchable PDF made from the images) */
  register({
    id: 'ocr-image', cat: 'img', glyph: 'scan', name: 'Image → text (OCR)', keywords: 'ocr image to text recognize scan photo screenshot extract words tesseract searchable pdf',
    desc: 'Recognise English text in photos, scans and screenshots. Save it as .txt or a searchable PDF.',
    accept: 'image/*,.bmp,.avif', acceptText: 'PNG, JPEG, WebP, BMP, GIF (clear, straight-on text works best)', acceptTest: isImg, multiple: true, reorder: true, button: 'Recognize', zipName: 'ocr-text',
    options: [{ key: 'out', label: 'Save as', type: 'select', value: 'txt', options: [['txt', 'A text file per image'], ['one', 'One combined text file'], ['pdf', 'Searchable PDF (one page per image)']] }],
    note: 'Recognition runs on this device with Tesseract (English). The engine downloads from this site once, about 11 MB, the first time.',
    async run(files, o, ctx) {
      let cur = 0;
      const ocr = await startOcr(ctx, m => { const s = statusOf(m, (cur + 0.1) / files.length, 0.85 / files.length, files[cur] ? files[cur].name : ''); if (s) ctx.progress(...s); });
      const out = [], texts = [];
      let PL, doc, tf;
      if (o.out === 'pdf') { PL = await U.lib.pdfLib(); doc = await PL.PDFDocument.create(); doc.setProducer('Lumen Convert (OCR)'); tf = await textFont(doc); }
      try {
        for (cur = 0; cur < files.length; cur++) {
          const f = files[cur]; ctx.check(); ctx.progress(cur / files.length, `Preparing ${f.name}`);
          try {
            const bmp = await U.decodeImage(f);
            // small images are upscaled: Tesseract wants text at least ~20 px tall
            const k = Math.max(1, Math.min(3, 1500 / Math.max(bmp.width, bmp.height)));
            const W = Math.round(bmp.width * k), H = Math.round(bmp.height * k);
            const c = U.drawTo(bmp, W, H, '#ffffff'); bmp.close();
            const data = await ocr.recognize(c);
            const text = cleanText(data.text);
            if (o.out === 'pdf') {
              const jpg = new Uint8Array(await (await U.encodeCanvas(c, 'image/jpeg', 0.9)).arrayBuffer());
              const img = await doc.embedJpg(jpg), pw = W / k * 0.75, ph = H / k * 0.75, page = doc.addPage([pw, ph]);
              page.drawImage(img, { x: 0, y: 0, width: pw, height: ph });
              const s = pw / W; addTextLayer(PL, page, tf, wordsOf(data, (x, y) => [x * s, ph - y * s], s));
              texts.push(text);
            } else if (o.out === 'one') texts.push(`--- ${f.name} ---\n${text}`);
            else out.push({ name: baseName(f.name) + '.txt', blob: new Blob([text + '\n'], { type: 'text/plain;charset=utf-8' }), text, info: text ? `${(text.match(/\S+/g) || []).length} words · confidence ${Math.round(data.confidence)}%` : 'No text found' });
            c.width = 0;
          } catch (e) { if (ctx.cancelled) throw e; out.push({ name: f.name, error: e.message }); }
        }
      } finally { await ocr.end(); }
      if (o.out === 'one' && texts.length) { const t = texts.join('\n\n') + '\n'; out.unshift({ name: 'recognized-text.txt', blob: new Blob([t], { type: 'text/plain;charset=utf-8' }), text: t, info: `${texts.length} image${texts.length > 1 ? 's' : ''}` }); }
      if (o.out === 'pdf' && doc.getPageCount()) { ctx.progress(0.98, 'Saving PDF'); out.unshift({ name: (files.length === 1 ? baseName(files[0].name) : 'scans') + '-searchable.pdf', blob: new Blob([await doc.save()], { type: 'application/pdf' }), text: texts.join('\n\n'), info: `${doc.getPageCount()} page${doc.getPageCount() > 1 ? 's' : ''} with a searchable text layer` }); }
      return out;
    }
  });
  alias('ocr', 'ocr-image'); alias('image-to-text', 'ocr-image');

  /* Scanned PDF → searchable PDF / text */
  register({
    id: 'ocr-pdf', cat: 'pdf', glyph: 'scan', name: 'Scanned PDF → searchable (OCR)', keywords: 'ocr scanned pdf searchable text layer recognize extract scan to text tesseract',
    desc: 'Add an invisible text layer to scanned PDFs so they can be searched and copied, or pull the text out.',
    accept: '.pdf,application/pdf', acceptText: 'One PDF (scans or photos of pages)', acceptTest: isPdf, multiple: false, button: 'Recognize',
    options: [
      { key: 'out', label: 'Save as', type: 'select', value: 'both', options: [['both', 'Searchable PDF + text file'], ['pdf', 'Searchable PDF'], ['txt', 'Text file only']] },
      { key: 'pages', label: 'Pages', type: 'text', value: '', placeholder: 'All pages, or e.g. 1-3, 7' },
      { key: 'dpi', label: 'Resolution', type: 'select', value: '300', options: [['200', '200 DPI (faster)'], ['300', '300 DPI (recommended)'], ['400', '400 DPI (small print)']] },
      { key: 'skip', label: 'Existing text', type: 'checkbox', text: 'Skip pages that already have text', value: true }],
    note: 'The page images are left untouched; recognised words are placed invisibly on top. English only. Roughly 5–20 seconds per page.',
    async run([f], o, ctx) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const pdf = await U.openPdf(bytes);
      let PL, doc, tf;
      try {
        const idx = LC.pdfInternals.parseRanges(o.pages, pdf.numPages);
        if (o.out !== 'txt') {
          PL = await U.lib.pdfLib();
          try { doc = await PL.PDFDocument.load(bytes, { updateMetadata: false }); } catch (e) { throw new Error(/encrypt/i.test(e.message) ? 'This PDF is encrypted; remove its password first' : 'pdf-lib could not open this PDF: ' + e.message); }
          tf = await textFont(doc);
        }
        let k = 0, label = '';
        const ocr = await startOcr(ctx, m => { const s = statusOf(m, (k + 0.3) / idx.length, 0.7 / idx.length, label); if (s) ctx.progress(...s); });
        const texts = [], skipped = []; let words = 0;
        try {
          for (k = 0; k < idx.length; k++) {
            ctx.check(); const i = idx[k]; label = `Page ${i + 1} of ${pdf.numPages}`;
            const page = await pdf.getPage(i + 1);
            if (o.skip) {
              const tc = await page.getTextContent(); const existing = tc.items.map(t => t.str || '').join(' ');
              if (existing.replace(/\s+/g, '').length > 20) { skipped.push(i + 1); texts.push(`--- Page ${i + 1} ---\n${existing.trim()}`); continue; }
            }
            ctx.progress(k / idx.length, `${label}: rendering`);
            const v0 = page.getViewport({ scale: 1 }), scale = Math.min(+o.dpi / 72, 5200 / Math.max(v0.width, v0.height)), vp = page.getViewport({ scale });
            const c = U.canvas(Math.ceil(vp.width), Math.ceil(vp.height)), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
            await page.render({ canvasContext: g, canvas: c, viewport: vp }).promise;
            const data = await ocr.recognize(c); c.width = 0;
            const ws = wordsOf(data, (x, y) => vp.convertToPdfPoint(x, y), 1 / scale); words += ws.length;
            if (doc) addTextLayer(PL, doc.getPage(i), tf, ws);
            texts.push(`--- Page ${i + 1} ---\n${cleanText(data.text)}`);
            page.cleanup();
          }
        } finally { await ocr.end(); }
        const text = texts.join('\n\n') + '\n', out = [], note = skipped.length ? ` · ${skipped.length} page${skipped.length > 1 ? 's' : ''} already had text` : '';
        if (doc) { ctx.progress(0.98, 'Saving PDF'); out.push({ name: baseName(f.name) + '-searchable.pdf', blob: new Blob([await doc.save()], { type: 'application/pdf' }), info: `${words.toLocaleString()} words recognized on ${idx.length - skipped.length} page${idx.length - skipped.length === 1 ? '' : 's'}${note}` }); }
        if (o.out !== 'pdf') out.push({ name: baseName(f.name) + '.txt', blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), text, info: `${(text.match(/\S+/g) || []).length.toLocaleString()} words${note}` });
        return out;
      } finally { pdf.destroy(); }
    }
  });
  alias('searchable-pdf', 'ocr-pdf'); alias('scanned-pdf-to-text', 'ocr-pdf', { out: 'txt' });
})();
