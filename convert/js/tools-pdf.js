'use strict';
/* Lumen Convert — PDF & document tools: images → PDF, PDF → images, merge, split, PDF → text,
   DOCX → HTML/text, DOCX → PDF, TXT → PDF, HTML → Markdown, EPUB → text, spreadsheets ⇄ CSV/JSON, CSV → XLSX. */
(() => {
  const { register, alias, util: U } = LC;
  const { esc, el, fmtSize, baseName, extOf } = U;
  const isPdf = f => f.type === 'application/pdf' || extOf(f.name) === 'pdf';
  const PAGE = { a4: [595.28, 841.89], letter: [612, 792], a5: [419.53, 595.28], legal: [612, 1008] };
  const pageOpts = [['a4', 'A4'], ['letter', 'US Letter'], ['a5', 'A5'], ['legal', 'US Legal']];

  // "1-3, 5, 8-" → sorted unique 0-based indices (or groups when asGroups)
  function parseRanges(s, n, asGroups) {
    s = String(s || '').trim();
    if (!s) return asGroups ? [Array.from({ length: n }, (_, i) => i)] : Array.from({ length: n }, (_, i) => i);
    const groups = [];
    for (const part of s.split(/[,;]+/).map(x => x.trim()).filter(Boolean)) {
      const m = part.match(/^(\d+|end|last)?\s*(?:(-|–|to)\s*(\d+|end|last)?)?$/i);
      if (!m || (!m[1] && !m[3])) throw new Error(`“${part}” isn’t a page range. Use something like 1-3, 5, 8-end`);
      const num = v => /^(end|last)$/i.test(v) ? n : parseInt(v, 10);
      const a = m[1] ? num(m[1]) : 1, b = m[2] ? (m[3] ? num(m[3]) : n) : a;
      if (a < 1 || b < 1 || a > n || b > n) throw new Error(`Page range “${part}” is outside 1–${n}`);
      const g = []; if (a <= b) for (let i = a; i <= b; i++) g.push(i - 1); else for (let i = a; i >= b; i--) g.push(i - 1);
      groups.push(g);
    }
    return asGroups ? groups : [...new Set(groups.flat())];
  }
  async function loadPdfLib(bytes, name) {
    const { PDFDocument } = await U.lib.pdfLib();
    try { return await PDFDocument.load(bytes, { updateMetadata: false }); }
    catch (e) {
      if (/encrypt/i.test(e.message)) throw new Error(`“${name}” is encrypted. Remove its password first (for example in Lumen PDF).`);
      throw new Error(`“${name}” isn’t a readable PDF (${e.message})`);
    }
  }
  const pdfBlob = bytes => new Blob([bytes], { type: 'application/pdf' });

  // EXIF orientation of a JPEG (1 = normal); raw JPEG embedding ignores it, so rotated photos are re-encoded.
  function jpegOrientation(b) {
    if (b[0] !== 0xFF || b[1] !== 0xD8) return 1;
    let o = 2;
    while (o + 4 < b.length) {
      if (b[o] !== 0xFF) return 1;
      const mk = b[o + 1], len = (b[o + 2] << 8) | b[o + 3];
      if (mk === 0xE1 && String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]) === 'Exif') {
        const t = o + 10, le = b[t] === 0x49, r16 = p => le ? b[p] | b[p + 1] << 8 : b[p] << 8 | b[p + 1], r32 = p => le ? (b[p] | b[p + 1] << 8 | b[p + 2] << 16 | b[p + 3] << 24) >>> 0 : ((b[p] << 24) | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0;
        const ifd = t + r32(t + 4), cnt = r16(ifd);
        for (let i = 0; i < cnt; i++) { const e = ifd + 2 + i * 12; if (e + 12 > b.length) break; if (r16(e) === 0x0112) return r16(e + 8); }
        return 1;
      }
      if (mk === 0xDA) return 1;
      o += 2 + len;
    }
    return 1;
  }

  /* 7 ─ Images → PDF */
  register({
    id: 'images-to-pdf', cat: 'pdf', glyph: 'imgpdf', name: 'Images → PDF', keywords: 'jpg png images photos to pdf combine scan',
    desc: 'Combine photos and images into one PDF, one image per page.',
    accept: 'image/*,.avif,.bmp', acceptText: 'JPEG, PNG, WebP, AVIF, BMP, GIF. Drag to reorder with ▲▼.', acceptTest: f => /^image\//.test(f.type) || /^(png|jpe?g|webp|avif|bmp|gif)$/.test(extOf(f.name)), multiple: true, reorder: true,
    options: [
      { key: 'size', label: 'Page size', type: 'select', value: 'fit', options: [['fit', 'Same as each image'], ...pageOpts] },
      { key: 'orient', label: 'Orientation', type: 'select', value: 'auto', options: [['auto', 'Automatic (match image)'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], show: o => o.size !== 'fit' },
      { key: 'margin', label: 'Margin', type: 'number', min: 0, max: 100, step: 1, value: 10, unit: 'mm', show: o => o.size !== 'fit' },
      { key: 'name', label: 'File name', type: 'text', value: 'images.pdf' }],
    async run(files, o, ctx) {
      const { PDFDocument } = await U.lib.pdfLib();
      const doc = await PDFDocument.create(); doc.setProducer('Lumen Convert'); doc.setCreator('Lumen Convert');
      const skipped = [];
      for (let i = 0; i < files.length; i++) {
        ctx.check(); const f = files[i]; ctx.progress(i / files.length, `Adding ${f.name} (${i + 1} of ${files.length})`);
        try {
          const bytes = new Uint8Array(await f.arrayBuffer()); let img;
          const isJ = bytes[0] === 0xFF && bytes[1] === 0xD8, isP = bytes[0] === 0x89 && bytes[1] === 0x50;
          if (isJ && jpegOrientation(bytes) === 1) img = await doc.embedJpg(bytes).catch(() => null);
          else if (isP) img = await doc.embedPng(bytes).catch(() => null);
          if (!img) { // re-encode anything else (WebP, AVIF, BMP, GIF, rotated JPEG, odd PNG)
            const bmp = await U.decodeImage(f);
            const c = U.drawTo(bmp, bmp.width, bmp.height, isJ ? '#fff' : null); bmp.close();
            const enc = await U.encodeCanvas(c, isJ ? 'image/jpeg' : 'image/png', 0.92);
            const eb = new Uint8Array(await enc.arrayBuffer());
            img = isJ ? await doc.embedJpg(eb) : await doc.embedPng(eb);
          }
          const iw = img.width * 0.75, ih = img.height * 0.75; // 96 dpi → points
          let pw, ph, m = o.size === 'fit' ? 0 : o.margin * 72 / 25.4;
          if (o.size === 'fit') { pw = iw; ph = ih; }
          else { [pw, ph] = PAGE[o.size]; const land = o.orient === 'landscape' || (o.orient === 'auto' && iw > ih); if (land) [pw, ph] = [ph, pw]; }
          const page = doc.addPage([pw, ph]);
          const s = Math.min((pw - 2 * m) / iw, (ph - 2 * m) / ih, o.size === 'fit' ? 1 : Infinity), w = iw * s, h = ih * s;
          page.drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
        } catch (e) { skipped.push({ name: f.name, error: e.message }); }
        await ctx.tick();
      }
      if (!doc.getPageCount()) return skipped.length ? skipped : [{ name: 'PDF', error: 'No images could be added' }];
      ctx.progress(0.97, 'Saving PDF');
      const out = await doc.save();
      let name = (o.name || 'images.pdf').trim(); if (!/\.pdf$/i.test(name)) name += '.pdf';
      return [{ name, blob: pdfBlob(out), info: `${doc.getPageCount()} page${doc.getPageCount() > 1 ? 's' : ''}` }, ...skipped];
    }
  });
  alias('jpg-to-pdf', 'images-to-pdf'); alias('png-to-pdf', 'images-to-pdf');

  /* 8 ─ PDF → images */
  register({
    id: 'pdf-to-images', cat: 'pdf', glyph: 'pdfimg', name: 'PDF → images', keywords: 'pdf to png jpg jpeg image pages render dpi',
    desc: 'Every page (or the pages you pick) as PNG or JPEG at the DPI you choose.',
    accept: '.pdf,application/pdf', acceptText: 'PDF files', acceptTest: isPdf, multiple: true, zipName: 'pdf-pages',
    options: [
      { key: 'to', label: 'Format', type: 'select', value: 'png', options: [['png', 'PNG'], ['jpeg', 'JPEG']] },
      { key: 'dpi', label: 'Resolution', type: 'range', min: 36, max: 300, step: 6, value: 150, fmt: v => v + ' DPI' },
      { key: 'q', label: 'Quality', type: 'range', min: 0.3, max: 1, step: 0.01, value: 0.9, fmt: v => Math.round(v * 100) + '%', show: o => o.to === 'jpeg' },
      { key: 'pages', label: 'Pages', type: 'text', value: '', placeholder: 'All pages, or e.g. 1-3, 7' },
      { key: 'pw', label: 'Password', type: 'password', value: '', placeholder: 'Only for protected PDFs' }],
    async each(f, o, ctx) {
      const pdf = await U.openPdf(new Uint8Array(await f.arrayBuffer()), o.pw);
      try {
        const idx = parseRanges(o.pages, pdf.numPages), out = [];
        for (let k = 0; k < idx.length; k++) {
          ctx.check(); const n = idx[k] + 1; ctx.progress(k / idx.length, `Rendering page ${n} of ${pdf.numPages}`);
          const page = await pdf.getPage(n);
          let vp = page.getViewport({ scale: o.dpi / 72 });
          const lim = Math.sqrt(60e6 / (vp.width * vp.height)); if (lim < 1) vp = page.getViewport({ scale: o.dpi / 72 * lim });
          const c = U.canvas(Math.ceil(vp.width), Math.ceil(vp.height)), g = c.getContext('2d');
          g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
          await page.render({ canvasContext: g, canvas: c, viewport: vp, background: 'rgb(255,255,255)' }).promise;
          page.cleanup();
          const blob = await U.encodeCanvas(c, U.MIME[o.to], o.q);
          out.push({ name: `${baseName(f.name)}-page-${String(n).padStart(String(pdf.numPages).length, '0')}.${o.to === 'jpeg' ? 'jpg' : 'png'}`, blob, thumb: true, info: `${c.width}×${c.height}` });
        }
        return out;
      } finally { pdf.destroy(); }
    }
  });
  alias('pdf-to-jpg', 'pdf-to-images', { to: 'jpeg' }); alias('pdf-to-png', 'pdf-to-images', { to: 'png' });

  /* 9 ─ Merge PDFs */
  register({
    id: 'merge-pdf', cat: 'pdf', glyph: 'merge', name: 'Merge PDFs', keywords: 'merge combine join pdf append',
    desc: 'Join several PDFs into one, in the order you choose.',
    accept: '.pdf,application/pdf', acceptText: 'Two or more PDF files. Reorder with ▲▼.', acceptTest: isPdf, multiple: true, reorder: true, minFiles: 2, button: 'Merge',
    options: [{ key: 'name', label: 'File name', type: 'text', value: 'merged.pdf' }],
    async run(files, o, ctx) {
      const { PDFDocument } = await U.lib.pdfLib();
      const out = await PDFDocument.create(); out.setProducer('Lumen Convert');
      for (let i = 0; i < files.length; i++) {
        ctx.check(); ctx.progress(i / files.length, `Adding ${files[i].name}`);
        const src = await loadPdfLib(new Uint8Array(await files[i].arrayBuffer()), files[i].name);
        (await out.copyPages(src, src.getPageIndices())).forEach(p => out.addPage(p));
        await ctx.tick();
      }
      ctx.progress(0.96, 'Saving');
      let name = (o.name || 'merged.pdf').trim(); if (!/\.pdf$/i.test(name)) name += '.pdf';
      return { name, blob: pdfBlob(await out.save()), info: `${out.getPageCount()} pages from ${files.length} files` };
    }
  });

  /* 10 ─ Split PDF */
  register({
    id: 'split-pdf', cat: 'pdf', glyph: 'split', name: 'Split PDF', keywords: 'split pdf extract pages ranges separate',
    desc: 'Split by page ranges, every N pages, or pull out selected pages.',
    accept: '.pdf,application/pdf', acceptText: 'One PDF file', acceptTest: isPdf, multiple: false, button: 'Split', zipName: 'split-pdf',
    options: [
      { key: 'mode', label: 'Split', type: 'select', value: 'ranges', options: [['ranges', 'By page ranges (one file each)'], ['every', 'Every N pages'], ['each', 'Every page into its own file'], ['extract', 'Extract pages into one file']] },
      { key: 'ranges', label: 'Ranges', type: 'text', value: '1-2, 3-end', placeholder: 'e.g. 1-3, 4-6, 7-end', show: o => o.mode === 'ranges' },
      { key: 'n', label: 'N', type: 'number', min: 1, max: 10000, step: 1, value: 2, unit: 'pages per file', show: o => o.mode === 'every' },
      { key: 'pages', label: 'Pages', type: 'text', value: '1, 3', placeholder: 'e.g. 1, 3, 5-7', show: o => o.mode === 'extract' }],
    async run([f], o, ctx) {
      const { PDFDocument } = await U.lib.pdfLib();
      const src = await loadPdfLib(new Uint8Array(await f.arrayBuffer()), f.name), n = src.getPageCount();
      let groups;
      if (o.mode === 'ranges') groups = parseRanges(o.ranges, n, true);
      else if (o.mode === 'every') { const k = Math.max(1, Math.floor(o.n)); groups = []; for (let i = 0; i < n; i += k) groups.push(Array.from({ length: Math.min(k, n - i) }, (_, j) => i + j)); }
      else if (o.mode === 'each') groups = Array.from({ length: n }, (_, i) => [i]);
      else { groups = [parseRanges(o.pages, n)]; if (!o.pages.trim()) throw new Error('Enter the pages to extract'); }
      const out = [], base = baseName(f.name), lbl = g => g.length === 1 ? `p${g[0] + 1}` : `p${g[0] + 1}-${g[g.length - 1] + 1}`;
      for (let i = 0; i < groups.length; i++) {
        ctx.check(); ctx.progress(i / groups.length, `Writing part ${i + 1} of ${groups.length}`);
        const d = await PDFDocument.create(); (await d.copyPages(src, groups[i])).forEach(p => d.addPage(p));
        const g = groups[i];
        const isRun = g.every((v, j) => j === 0 || v === g[j - 1] + 1);
        out.push({ name: `${base}-${o.mode === 'extract' ? 'extract' : isRun ? lbl(g) : 'part' + (i + 1)}.pdf`, blob: pdfBlob(await d.save()), info: `${g.length} page${g.length > 1 ? 's' : ''}` });
        await ctx.tick();
      }
      return out;
    }
  });

  /* 11 ─ PDF → text */
  async function pdfText(pdf, idx, marks, ctx) {
    const parts = [];
    for (let k = 0; k < idx.length; k++) {
      ctx.check(); ctx.progress(k / idx.length, `Reading page ${idx[k] + 1}`);
      const page = await pdf.getPage(idx[k] + 1), tc = await page.getTextContent();
      let s = '', lastY = null;
      for (const it of tc.items) {
        if (typeof it.str !== 'string') continue;
        const y = it.transform ? it.transform[5] : null;
        if (lastY != null && y != null && Math.abs(y - lastY) > 2 && !s.endsWith('\n')) s += '\n';
        s += it.str; if (it.hasEOL) s += '\n';
        lastY = y;
      }
      s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      parts.push(marks ? `--- Page ${idx[k] + 1} ---\n${s}` : s);
      page.cleanup();
    }
    return parts.join(marks ? '\n\n' : '\n\n');
  }
  register({
    id: 'pdf-to-text', cat: 'pdf', glyph: 'text', name: 'PDF → text', keywords: 'pdf text extract txt copy words',
    desc: 'Extract the text layer of a PDF to a .txt file.',
    accept: '.pdf,application/pdf', acceptText: 'PDF files (scanned PDFs without a text layer have no text to extract)', acceptTest: isPdf, multiple: true, zipName: 'pdf-text',
    options: [
      { key: 'pages', label: 'Pages', type: 'text', value: '', placeholder: 'All pages, or e.g. 2-5' },
      { key: 'marks', label: 'Page markers', type: 'checkbox', text: 'Add “--- Page N ---” lines', value: true },
      { key: 'pw', label: 'Password', type: 'password', value: '', placeholder: 'Only for protected PDFs' }],
    async each(f, o, ctx) {
      const pdf = await U.openPdf(new Uint8Array(await f.arrayBuffer()), o.pw);
      try {
        const idx = parseRanges(o.pages, pdf.numPages);
        const text = await pdfText(pdf, idx, o.marks, ctx);
        const words = (text.match(/\S+/g) || []).length;
        const plain = text.replace(/--- Page \d+ ---/g, '').trim();
        return { name: baseName(f.name) + '.txt', blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), text, info: plain ? `${idx.length} pages · ${words.toLocaleString()} words` : 'No text found: this PDF is probably scanned images' };
      } finally { pdf.destroy(); }
    }
  });

  /* ================= rich-text → PDF layout engine (pdf-lib + embedded Unicode TrueType fonts) ================= */
  // blocks: {type:'p'|'h'|'li'|'pre'|'hr'|'img'|'table'|'gap', level, runs:[{t,b,i,mono,link}], indent, bullet, rows, img:{bytes,png,w,h}}
  // Fonts (subset-embedded with fontkit): serif = Source Serif 4, sans = Montserrat (both OFL, shared with Lumen Layout),
  // mono = DejaVu Sans Mono, and DejaVu Sans as a per-character fallback for scripts the main face lacks (Greek, Cyrillic, …).
  const LAYOUT_FONTS = '../layout/vendor/fonts/';
  const FAMILY = {
    times: [LAYOUT_FONTS + 'SourceSerif4_400Regular.ttf', LAYOUT_FONTS + 'SourceSerif4_700Bold.ttf', LAYOUT_FONTS + 'SourceSerif4_400Regular_Italic.ttf', LAYOUT_FONTS + 'SourceSerif4_700Bold_Italic.ttf'],
    helvetica: [LAYOUT_FONTS + 'Montserrat_400Regular.ttf', LAYOUT_FONTS + 'Montserrat_700Bold.ttf', LAYOUT_FONTS + 'Montserrat_400Regular_Italic.ttf', LAYOUT_FONTS + 'Montserrat_700Bold_Italic.ttf'],
    courier: ['vendor/fonts/DejaVuSansMono.ttf', 'vendor/fonts/DejaVuSansMono-Bold.ttf', 'vendor/fonts/DejaVuSansMono.ttf', 'vendor/fonts/DejaVuSansMono-Bold.ttf']
  };
  const FALLBACK = 'vendor/fonts/DejaVuSans.ttf';
  const fontBytes = {};
  function getFontBytes(url) {
    return fontBytes[url] || (fontBytes[url] = fetch(url).then(r => { if (!r.ok) throw new Error('Missing font ' + url); return r.arrayBuffer(); }).then(b => new Uint8Array(b)).catch(e => { delete fontBytes[url]; throw e; }));
  }
  const SUBST = { '​': '', '­': '', '﻿': '', ' ': '\n', ' ': '\n' };
  async function makeFonts(doc, family, blocks) {
    const fk = await U.loadScript('vendor/fontkit.umd.min.js', 'fontkit'); doc.registerFontkit(fk);
    // which styles are used? (0 regular, 1 bold, 2 italic, 3 bold italic; +4 = monospace)
    const used = new Set([0]);
    const scan = (runs, forceB) => { for (const r of runs || []) used.add((r.mono ? 4 : 0) + ((r.b || forceB) ? 1 : 0) + (r.i ? 2 : 0)); };
    for (const b of blocks) { if (b.type === 'table') b.rows.forEach(row => row.forEach(c => scan(c))); else scan(b.runs, b.type === 'h'); if (b.type === 'pre') used.add(4); }
    const cache = new Map();
    const embed = async url => { if (!cache.has(url)) cache.set(url, doc.embedFont(await getFontBytes(url), { subset: true })); return cache.get(url); };
    const fonts = [];
    let fallback;
    try { fallback = await embed(FALLBACK); } catch (e) { throw new Error('The PDF fonts could not be loaded (' + e.message + ')'); }
    for (const k of used) {
      const list = k >= 4 ? FAMILY.courier : FAMILY[family] || FAMILY.times, url = list[k & 3];
      try { fonts[k] = await embed(url); } catch (e) { fonts[k] = fallback; } // e.g. a stripped-down install without Lumen Layout
    }
    const glyphs = new Map(); // pdf font -> fontkit face
    const has = (f, cp) => { let face = glyphs.get(f); if (face === undefined) { face = f.embedder && f.embedder.font || null; glyphs.set(f, face); } return face ? face.hasGlyphForCodePoint(cp) : false; };
    return { fonts, fallback, has, get: k => fonts[k] || fonts[k & 4 ? 4 : 0] || fonts[0] };
  }
  async function layoutPdf(blocks, opt, ctx) {
    const { PDFDocument, rgb } = await U.lib.pdfLib();
    const doc = await PDFDocument.create(); doc.setProducer('Lumen Convert'); if (opt.title) doc.setTitle(opt.title);
    if (ctx) ctx.progress(0.25, 'Loading fonts');
    const F = await makeFonts(doc, opt.font, blocks);
    let replaced = 0;
    // split a string into [text, font] pieces: main face where it has the glyph, DejaVu Sans otherwise, '?' as last resort
    const covers = (f, str) => { for (const ch of str) { const cp = ch.codePointAt(0); if (cp >= 32 && !F.has(f, cp)) return false; } return true; };
    const pieces = (str, main) => {
      str = [...str].map(ch => SUBST[ch] !== undefined ? SUBST[ch] : ch).join('');
      // keep a whole word in one font when possible (mixing faces inside a word looks wrong and breaks text extraction)
      if (covers(main, str)) return str ? [[str, main]] : [];
      if (covers(F.fallback, str)) return [[str, F.fallback]];
      const out = []; let cur = '', cf = null;
      for (let ch of str) {
        if (SUBST[ch] !== undefined) ch = SUBST[ch]; if (!ch) continue;
        const cp = ch.codePointAt(0); let f = main;
        if (cp >= 32 && !F.has(main, cp)) { if (F.has(F.fallback, cp)) f = F.fallback; else { const n = ch.normalize('NFKD').replace(/[̀-ͯ]/g, ''); if (n && n !== ch && [...n].every(x => F.has(main, x.codePointAt(0)))) ch = n; else { ch = '?'; replaced++; } } }
        if (f !== cf && cur) { out.push([cur, cf]); cur = ''; }
        cf = f; cur += ch;
      }
      if (cur) out.push([cur, cf]);
      return out;
    };
    const clean = s => s;
    const [PW, PH] = (() => { let [w, h] = PAGE[opt.page] || PAGE.a4; if (opt.landscape) [w, h] = [h, w]; return [w, h]; })();
    const M = (opt.margin ?? 20) * 72 / 25.4, base = opt.size || 11, CW = PW - 2 * M;
    let page = null, y = 0;
    const newPage = () => { page = doc.addPage([PW, PH]); y = PH - M; };
    newPage();
    const fontFor = r => F.get((r.mono ? 4 : 0) + (r.b ? 1 : 0) + (r.i ? 2 : 0));
    // split runs into word tokens (keeping their style), wrap to width; a word may consist of several font pieces
    function wrap(runs, size, width) {
      const lines = [[]]; let lw = 0;
      const pushTok = (text, r, isSpace) => {
        const parts = pieces(text, fontFor(r)).map(([t, f]) => ({ text: t, r, f, w: f.widthOfTextAtSize(t, size) }));
        const w = parts.reduce((a, p) => a + p.w, 0);
        let line = lines[lines.length - 1];
        if (isSpace) { if (line.length) { line.push(...parts); lw += w; } return; }
        if (lw + w > width && line.length) { while (line.length && line[line.length - 1].text.trim() === '') { lw -= line.pop().w; } lines.push(line = []); lw = 0; }
        if (w > width) { // break very long words character by character
          for (const p of parts) {
            let chunk = '';
            for (const ch of p.text) { const cw = p.f.widthOfTextAtSize(chunk + ch, size); if (lw + cw > width && chunk) { line.push({ text: chunk, r, w: p.f.widthOfTextAtSize(chunk, size), f: p.f }); lines.push(line = []); lw = 0; chunk = ch; } else chunk += ch; }
            if (chunk) { const cw = p.f.widthOfTextAtSize(chunk, size); line.push({ text: chunk, r, w: cw, f: p.f }); lw += cw; }
          }
          return;
        }
        line.push(...parts); lw += w;
      };
      for (const r of runs) {
        const t = r.t.replace(/\r\n?/g, '\n');
        for (const seg of t.split(/(\n)/)) {
          if (seg === '\n') { lines.push([]); lw = 0; continue; }
          for (const tok of seg.split(/(\s+)/)) if (tok) pushTok(r.pre ? tok.replace(/\t/g, '    ') : tok.replace(/\s+/g, ' '), r, /^\s+$/.test(tok) && !r.pre);
        }
      }
      return lines;
    }
    function drawLines(lines, x, size, lh, color) {
      for (const line of lines) {
        if (y - lh < M) newPage();
        y -= lh; let cx = x;
        // consecutive tokens in the same font and colour are drawn as one string with real spaces (clean copy/paste + search)
        for (let i = 0, gx = x; i < line.length;) {
          let j = i, str = '', gw = 0; const t0 = line[i];
          while (j < line.length && line[j].f === t0.f && !!line[j].r.link === !!t0.r.link) { str += line[j].text; gw += line[j].w; j++; }
          const lead = str.length - str.trimStart().length, lw = lead ? t0.f.widthOfTextAtSize(str.slice(0, lead), size) : 0;
          if (str.trim()) page.drawText(str.trim(), { x: gx + lw, y: y + (lh - size) * 0.35, size, font: t0.f, color: t0.r.link ? rgb(0.05, 0.3, 0.75) : (color || rgb(0.08, 0.1, 0.13)) });
          gx += gw; i = j;
        }
        for (const tk of line) {
          if (tk.r.u || tk.r.link) page.drawLine({ start: { x: cx, y: y + (lh - size) * 0.35 - 1.2 }, end: { x: cx + tk.w, y: y + (lh - size) * 0.35 - 1.2 }, thickness: 0.5, color: tk.r.link ? rgb(0.05, 0.3, 0.75) : rgb(0.1, 0.1, 0.1) });
          cx += tk.w;
        }
      }
    }
    const HS = [0, 2, 1.6, 1.35, 1.18, 1.05, 1];
    for (let bi = 0; bi < blocks.length; bi++) {
      const b = blocks[bi];
      if (ctx && bi % 40 === 0) { ctx.check(); ctx.progress(0.3 + 0.65 * bi / blocks.length, 'Laying out pages'); await ctx.tick(); }
      if (b.type === 'pagebreak') { newPage(); continue; }
      if (b.type === 'gap') { y -= base * 0.6; continue; }
      if (b.type === 'hr') { if (y - 12 < M) newPage(); y -= 8; page.drawLine({ start: { x: M, y }, end: { x: PW - M, y }, thickness: 0.7, color: rgb(0.7, 0.72, 0.75) }); y -= 6; continue; }
      if (b.type === 'img') {
        try {
          const img = b.img.png ? await doc.embedPng(b.img.bytes) : await doc.embedJpg(b.img.bytes);
          let w = b.img.w * 0.75 || img.width * 0.75, h = b.img.h * 0.75 || img.height * 0.75; const maxH = PH - 2 * M;
          const s = Math.min(1, CW / w, maxH / h); w *= s; h *= s;
          if (y - h < M) newPage();
          y -= h; page.drawImage(img, { x: M, y, width: w, height: h }); y -= 6;
        } catch (e) { /* unreadable embedded image: skip */ }
        continue;
      }
      if (b.type === 'table') {
        const ncol = Math.max(...b.rows.map(r => r.length)), cw = CW / ncol, fs = Math.max(7, base - 1.5), lh = fs * 1.3, pad = 3;
        y -= 4;
        for (const row of b.rows) {
          const cells = Array.from({ length: ncol }, (_, i) => wrap(row[i] || [], fs, cw - 2 * pad));
          const rh = Math.max(...cells.map(c => c.length)) * lh + 2 * pad;
          if (y - rh < M) newPage();
          const top = y;
          cells.forEach((lines, i) => {
            page.drawRectangle({ x: M + i * cw, y: top - rh, width: cw, height: rh, borderColor: rgb(0.6, 0.65, 0.72), borderWidth: 0.6 });
            y = top - pad; drawLines(lines, M + i * cw + pad, fs, lh);
          });
          y = top - rh;
        }
        y -= 6; continue;
      }
      const isH = b.type === 'h', size = isH ? base * HS[b.level || 2] : b.type === 'pre' ? base * 0.9 : base;
      const lh = size * (isH ? 1.25 : 1.4), indent = (b.indent || 0) * 18;
      const runs = isH ? b.runs.map(r => ({ ...r, b: true })) : b.type === 'pre' ? b.runs.map(r => ({ ...r, mono: true, pre: true })) : b.runs;
      if (isH) { y -= size * 0.6; if (y - lh * 2 < M) newPage(); }
      const x = M + indent + (b.bullet ? 14 : 0);
      const lines = wrap(runs, size, CW - indent - (b.bullet ? 14 : 0));
      if (b.bullet) { if (y - lh < M) newPage(); let bx = M + indent; for (const [t, f] of pieces(b.bullet, F.get(0))) { page.drawText(t, { x: bx, y: y - lh + (lh - size) * 0.35, size, font: f, color: rgb(0.08, 0.1, 0.13) }); bx += f.widthOfTextAtSize(t, size); } }
      drawLines(lines, x, size, lh, isH ? rgb(0.12, 0.22, 0.36) : null);
      y -= b.type === 'li' ? size * 0.15 : size * 0.55;
    }
    return { bytes: await doc.save(), pages: doc.getPageCount(), replaced };
  }

  // HTML (already-parsed, inert DOM) → layout blocks. Images: data: URLs only (mammoth inlines them).
  async function htmlToBlocks(root) {
    const blocks = []; let cur = null;
    const flush = () => { if (cur && cur.runs.some(r => r.t.trim())) blocks.push(cur); cur = null; };
    const start = (type, extra) => { flush(); cur = { type, runs: [], ...extra }; };
    async function addImg(node) {
      const src = node.getAttribute('src') || '';
      if (!/^data:image\//i.test(src)) return;
      try {
        const { bytes, mime } = LC.imageInternals.parseDataInput(src);
        let png = mime === 'image/png', data = bytes;
        if (mime !== 'image/png' && mime !== 'image/jpeg') {
          const bmp = await U.decodeImage(new Blob([bytes], { type: mime })); const c = U.drawTo(bmp, bmp.width, bmp.height); bmp.close();
          data = new Uint8Array(await (await U.encodeCanvas(c, 'image/png')).arrayBuffer()); png = true;
        }
        const keep = cur; flush(); blocks.push({ type: 'img', img: { bytes: data, png, w: +node.getAttribute('width') || 0, h: +node.getAttribute('height') || 0 } });
        if (keep) cur = { ...keep, runs: [] };
      } catch (e) { /* skip */ }
    }
    async function inline(node, st, target) {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) { (target || cur || (start('p'), cur)).runs.push({ t: n.nodeValue, ...st }); continue; }
        if (n.nodeType !== 1) continue;
        const tag = n.tagName.toLowerCase();
        if (tag === 'br') { (target || cur || (start('p'), cur)).runs.push({ t: '\n', ...st }); continue; }
        if (tag === 'img') { if (!target) await addImg(n); continue; }
        if (/^(script|style|template|head|title|noscript)$/.test(tag)) continue;
        if (!target && /^(p|div|h[1-6]|ul|ol|table|pre|blockquote|hr|section|article|header|footer|figure|li|dl)$/.test(tag)) { await block(n, 0); continue; }
        const s2 = { ...st };
        if (/^(b|strong|th)$/.test(tag)) s2.b = true; if (/^(i|em|cite|var)$/.test(tag)) s2.i = true; if (tag === 'u' || tag === 'ins') s2.u = true;
        if (/^(code|kbd|samp|tt)$/.test(tag)) s2.mono = true; if (tag === 'a' && n.getAttribute('href')) s2.link = true;
        await inline(n, s2, target);
      }
    }
    async function list(n, depth) {
      let i = parseInt(n.getAttribute('start') || '1', 10) || 1; const ordered = n.tagName.toLowerCase() === 'ol';
      for (const li of n.children) {
        if (li.tagName.toLowerCase() !== 'li') continue;
        start('li', { indent: depth, bullet: ordered ? `${i++}.` : (depth % 2 ? '◦' : '•') });
        for (const c of li.childNodes) {
          if (c.nodeType === 1 && /^(ul|ol)$/i.test(c.tagName)) { flush(); await list(c, depth + 1); }
          else if (c.nodeType === 1 && /^p$/i.test(c.tagName)) { if (!cur) start('li', { indent: depth + 0.8 }); await inline(c, {}); }
          else { if (!cur) start('li', { indent: depth + 0.8 }); const tmp = document.createElement('span'); tmp.append(c.cloneNode(true)); await inline(tmp, {}); }
        }
        flush();
      }
    }
    async function block(n, depth) {
      const tag = n.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) { start('h', { level: +tag[1] }); await inline(n, {}); flush(); return; }
      if (tag === 'p') { start('p', { indent: depth }); await inline(n, {}); flush(); return; }
      if (tag === 'pre') { flush(); blocks.push({ type: 'pre', runs: [{ t: n.textContent.replace(/\n$/, '') }] }); return; }
      if (tag === 'hr') { flush(); blocks.push({ type: 'hr' }); return; }
      if (tag === 'ul' || tag === 'ol') { flush(); await list(n, depth); return; }
      if (tag === 'blockquote') { for (const c of n.children.length ? n.childNodes : [n]) { if (c.nodeType === 1) await block(c, depth + 1); else if (c.nodeValue.trim()) { start('p', { indent: depth + 1 }); cur.runs.push({ t: c.nodeValue, i: true }); flush(); } } return; }
      if (tag === 'table') {
        flush(); const rows = [];
        for (const tr of n.querySelectorAll('tr')) { const row = []; for (const td of tr.children) { const holder = { runs: [] }; await inline(td, td.tagName.toLowerCase() === 'th' ? { b: true } : {}, holder); row.push(holder.runs); } if (row.length) rows.push(row); }
        if (rows.length) blocks.push({ type: 'table', rows }); return;
      }
      // generic container: walk children; loose text becomes paragraphs
      for (const c of n.childNodes) {
        if (c.nodeType === 1 && /^(p|div|h[1-6]|ul|ol|table|pre|blockquote|hr|section|article|header|footer|figure|main|body|dl|li)$/i.test(c.tagName)) { flush(); await block(c, depth); }
        else { if (!cur) start('p', { indent: depth }); const tmp = document.createElement('span'); tmp.append(c.cloneNode(true)); await inline(tmp, {}); }
      }
      flush();
    }
    await block(root, 0); flush();
    return blocks;
  }

  /* DOCX (mammoth) */
  const isDocx = f => /^(docx)$/.test(extOf(f.name)) || f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  async function docxHtml(f) {
    const mammoth = await U.loadScript('vendor/mammoth.browser.min.js', 'mammoth');
    try { return await mammoth.convertToHtml({ arrayBuffer: await f.arrayBuffer() }); }
    catch (e) { throw new Error(`“${f.name}” isn’t a readable .docx file (${e.message}). Old .doc files aren’t supported.`); }
  }
  const htmlDoc = (title, body) => `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>${esc(title)}</title>\n<style>body{max-width:46em;margin:2em auto;padding:0 1em;font:16px/1.6 Georgia,serif;color:#222}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px;vertical-align:top}</style>\n</head>\n<body>\n${body}\n</body>\n</html>\n`;
  register({
    id: 'docx-convert', cat: 'pdf', glyph: 'doc', name: 'DOCX → HTML / text', keywords: 'docx word document html text txt markdown convert',
    desc: 'Word documents to clean HTML (with images) or plain text.',
    accept: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', acceptText: 'Word .docx files', acceptTest: isDocx, multiple: true, zipName: 'docx-converted',
    options: [{ key: 'to', label: 'Convert to', type: 'select', value: 'html', options: [['html', 'HTML web page'], ['txt', 'Plain text'], ['md', 'Markdown']] }],
    note: 'Text, headings, lists, tables, links and images are kept; page layout, fonts and colours are not.',
    async each(f, o, ctx) {
      ctx.progress(0.2, 'Reading ' + f.name);
      const { value, messages } = await docxHtml(f);
      const DOMPurify = await U.lib.purify();
      const clean = DOMPurify.sanitize(value, { ALLOW_DATA_ATTR: false });
      const warn = messages.filter(m => m.type === 'warning').length;
      if (o.to === 'html') { const html = htmlDoc(baseName(f.name), clean); return { name: baseName(f.name) + '.html', blob: new Blob([html], { type: 'text/html;charset=utf-8' }), info: `HTML${warn ? ` · ${warn} unsupported style${warn > 1 ? 's' : ''} ignored` : ''}`, text: html.length < 300000 ? html : undefined }; }
      const dom = new DOMParser().parseFromString(clean, 'text/html');
      let text;
      if (o.to === 'md') { const TD = await U.loadScript('vendor/turndown.browser.umd.js', 'TurndownService'); text = new TD({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' }).turndown(dom.body); }
      else text = domText(dom.body);
      return { name: baseName(f.name) + (o.to === 'md' ? '.md' : '.txt'), blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), text, info: `${(text.match(/\S+/g) || []).length.toLocaleString()} words` };
    }
  });
  alias('docx-to-html', 'docx-convert', { to: 'html' }); alias('docx-to-text', 'docx-convert', { to: 'txt' }); alias('word-to-html', 'docx-convert');
  // readable plain text from a DOM (block elements → line breaks, list bullets, table cells tab-separated)
  function domText(root) {
    let out = '';
    // inside a table cell, paragraphs are joined with spaces so each row stays on one tab-separated line
    const walk = (n, pre, cell) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) { out += pre ? c.nodeValue : c.nodeValue.replace(/\s+/g, ' '); continue; }
        if (c.nodeType !== 1) continue;
        const t = c.tagName.toLowerCase();
        if (/^(script|style|template|head|noscript)$/.test(t)) continue;
        if (t === 'br') { out += cell ? ' ' : '\n'; continue; }
        if (cell && t !== 'table' && t !== 'tr' && t !== 'td' && t !== 'th') {
          if (/^(p|div|li|h[1-6])$/.test(t) && out && !/[\t\n ]$/.test(out)) out += ' ';
          walk(c, pre, true); continue;
        }
        const blk = /^(p|div|h[1-6]|li|tr|table|ul|ol|pre|blockquote|section|article|header|footer|hr|dt|dd|figure|figcaption|title)$/.test(t);
        if (blk && !/\n$/.test(out)) out += '\n';
        if (t === 'li') out += (c.parentElement && c.parentElement.tagName === 'OL' ? ([...c.parentElement.children].indexOf(c) + 1) + '. ' : '• ');
        walk(c, pre || t === 'pre', t === 'td' || t === 'th');
        if (t === 'td' || t === 'th') out = out.replace(/ +$/, '') + '\t';
        if (blk) out += /^(p|h[1-6]|table|blockquote|pre)$/.test(t) ? '\n\n' : '\n';
      }
    };
    walk(root, false, false);
    return out.replace(/\t+\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  register({
    id: 'docx-to-pdf', cat: 'pdf', glyph: 'doc', name: 'DOCX → PDF', keywords: 'docx word to pdf document print',
    desc: 'Word documents to PDF with headings, lists, tables and images.',
    accept: '.docx', acceptText: 'Word .docx files', acceptTest: isDocx, multiple: true, zipName: 'docx-pdf',
    options: [
      { key: 'page', label: 'Page size', type: 'select', value: 'a4', options: pageOpts },
      { key: 'font', label: 'Font', type: 'select', value: 'times', options: [['times', 'Serif (Source Serif 4)'], ['helvetica', 'Sans-serif (Montserrat)']] },
      { key: 'size', label: 'Text size', type: 'number', min: 7, max: 20, step: 0.5, value: 11, unit: 'pt' },
      { key: 'margin', label: 'Margins', type: 'number', min: 5, max: 50, step: 1, value: 22, unit: 'mm' }],
    note: 'The PDF is re-typeset from the document’s content, so it won’t match Word’s layout exactly. Fonts are embedded (subset), with DejaVu Sans filling in Greek, Cyrillic and other scripts the main font lacks. Chinese, Japanese and Korean aren’t covered.',
    async each(f, o, ctx) {
      ctx.progress(0.1, 'Reading ' + f.name);
      const { value } = await docxHtml(f);
      const dom = new DOMParser().parseFromString((await U.lib.purify()).sanitize(value), 'text/html');
      const blocks = await htmlToBlocks(dom.body);
      if (!blocks.length) throw new Error('The document is empty');
      const r = await layoutPdf(blocks, { ...o, title: baseName(f.name) }, ctx);
      return { name: baseName(f.name) + '.pdf', blob: pdfBlob(r.bytes), info: `${r.pages} page${r.pages > 1 ? 's' : ''}${r.replaced ? ` · ${r.replaced} characters no font covers shown as “?”` : ''}` };
    }
  });
  alias('word-to-pdf', 'docx-to-pdf');

  /* TXT → PDF */
  async function readText(f) {
    const b = new Uint8Array(await f.arrayBuffer());
    if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
    if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(b).replace(/^﻿/, ''); }
    catch (e) { return new TextDecoder('windows-1252').decode(b); }
  }
  register({
    id: 'txt-to-pdf', cat: 'pdf', glyph: 'text', name: 'TXT → PDF', keywords: 'text txt plain to pdf print code',
    desc: 'Plain text files to tidy, paginated PDFs.',
    accept: '.txt,.text,.log,.md,.csv,.json,.xml,.yml,.yaml,.ini,.js,.py,text/*', acceptText: 'Text files (.txt, .log, .md, code…)', acceptTest: f => /^text\//.test(f.type) || /^(txt|text|log|md|csv|json|xml|ya?ml|ini|cfg|js|ts|py|c|h|cpp|java|cs|go|rs|sh|bat|ps1|sql|html?|css)$/.test(extOf(f.name)), multiple: true, zipName: 'text-pdf',
    options: [
      { key: 'font', label: 'Font', type: 'select', value: 'courier', options: [['courier', 'Monospace (DejaVu Sans Mono)'], ['helvetica', 'Sans-serif (Montserrat)'], ['times', 'Serif (Source Serif 4)']] },
      { key: 'size', label: 'Text size', type: 'number', min: 6, max: 24, step: 0.5, value: 10, unit: 'pt' },
      { key: 'page', label: 'Page size', type: 'select', value: 'a4', options: pageOpts },
      { key: 'landscape', label: 'Landscape', type: 'checkbox', text: 'Landscape pages', value: false },
      { key: 'margin', label: 'Margins', type: 'number', min: 5, max: 50, step: 1, value: 18, unit: 'mm' }],
    async each(f, o, ctx) {
      if (f.size > 30 * 1048576) throw new Error('Text file is too large (over 30 MB)');
      ctx.progress(0.1, 'Reading ' + f.name);
      const text = (await readText(f)).replace(/\r\n?/g, '\n');
      const mono = o.font === 'courier';
      const blocks = text.split('\n').map(line => line.trim() === '' ? { type: 'gap' } : line === '\f' ? { type: 'pagebreak' } : { type: 'p', runs: [{ t: line.replace(/\t/g, '    '), mono, pre: true }] });
      // collapse paragraph spacing: a "p" per line with tight spacing
      const tight = blocks.map(b => b.type === 'p' ? { ...b, type: 'li' } : b);
      const r = await layoutPdf(tight, { ...o, title: baseName(f.name) }, ctx);
      return { name: baseName(f.name) + '.pdf', blob: pdfBlob(r.bytes), info: `${r.pages} page${r.pages > 1 ? 's' : ''}${r.replaced ? ` · ${r.replaced} characters no font covers shown as “?”` : ''}` };
    }
  });

  /* EPUB → text */
  register({
    id: 'epub-to-text', cat: 'pdf', glyph: 'book', name: 'EPUB → text', keywords: 'epub ebook book to txt text plain',
    desc: 'E-books to plain text, chapter by chapter in reading order.',
    accept: '.epub,application/epub+zip', acceptText: 'EPUB e-books (DRM-free)', acceptTest: f => extOf(f.name) === 'epub' || f.type === 'application/epub+zip', multiple: true, zipName: 'epub-text',
    async each(f, o, ctx) {
      const ff = await U.lib.fflate();
      ctx.progress(0.1, 'Unpacking ' + f.name);
      let total = 0, files;
      try { files = ff.unzipSync(new Uint8Array(await f.arrayBuffer()), { filter: fi => { total += fi.originalSize; if (total > 400 * 1048576) throw new Error('too big'); return !/\.(jpe?g|png|gif|webp|svg|ttf|otf|woff2?|mp3|mp4)$/i.test(fi.name); } }); }
      catch (e) { throw new Error(e.message === 'too big' ? 'The e-book unpacks to more than 400 MB' : 'Not a valid EPUB (zip) file'); }
      if (Object.keys(files).some(k => /META-INF\/encryption\.xml$/.test(k)) && new TextDecoder().decode(files['META-INF/encryption.xml']).includes('EncryptedData')) throw new Error('This e-book is DRM-protected');
      const dec = k => new TextDecoder().decode(files[k]);
      const xml = s => new DOMParser().parseFromString(s, 'application/xml');
      const cont = files['META-INF/container.xml']; if (!cont) throw new Error('Not an EPUB (META-INF/container.xml missing)');
      const opfPath = xml(dec('META-INF/container.xml')).querySelector('rootfile')?.getAttribute('full-path');
      if (!opfPath || !files[opfPath]) throw new Error('The EPUB package file is missing');
      const opf = xml(dec(opfPath)), dir = opfPath.includes('/') ? opfPath.replace(/[^/]*$/, '') : '';
      const title = opf.getElementsByTagName('dc:title')[0]?.textContent?.trim() || baseName(f.name);
      const author = opf.getElementsByTagName('dc:creator')[0]?.textContent?.trim();
      const man = {}; for (const it of opf.getElementsByTagName('item')) man[it.getAttribute('id')] = it.getAttribute('href');
      const spine = [...opf.getElementsByTagName('itemref')].map(r => man[r.getAttribute('idref')]).filter(Boolean);
      const resolve = h => { const parts = (dir + decodeURIComponent(h.split('#')[0])).split('/'), out = []; for (const p of parts) { if (p === '..') out.pop(); else if (p !== '.') out.push(p); } return out.join('/'); };
      let text = title + (author ? '\nby ' + author : '') + '\n\n';
      for (let i = 0; i < spine.length; i++) {
        ctx.check(); ctx.progress(0.2 + 0.8 * i / spine.length, `Chapter ${i + 1} of ${spine.length}`);
        const p = resolve(spine[i]); if (!files[p]) continue;
        let d = new DOMParser().parseFromString(dec(p), 'application/xhtml+xml');
        if (d.querySelector('parsererror')) d = new DOMParser().parseFromString(dec(p), 'text/html');
        const body = d.body || d.getElementsByTagName('body')[0] || d.documentElement;
        const t = domText(body).trim(); if (t) text += t + '\n\n';
      }
      text = text.trim() + '\n';
      return { name: baseName(f.name) + '.txt', blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), text, info: `${spine.length} sections · ${(text.match(/\S+/g) || []).length.toLocaleString()} words` };
    }
  });

  /* Spreadsheets (SheetJS) */
  const SHEET_EXT = /^(xlsx|xlsm|xlsb|xls|ods|fods|numbers)$/;
  const loadXLSX = () => U.loadScript('vendor/xlsx.full.min.js', 'XLSX');
  register({
    id: 'spreadsheet-convert', cat: 'data', glyph: 'sheet', name: 'Excel / ODS → CSV or JSON', keywords: 'xlsx xls ods excel spreadsheet sheet to csv json libreoffice numbers',
    desc: 'Every sheet of an XLSX, XLS or ODS workbook to CSV or JSON.',
    accept: '.xlsx,.xlsm,.xlsb,.xls,.ods,.fods', acceptText: 'XLSX, XLSM, XLSB, XLS, ODS', acceptTest: f => SHEET_EXT.test(extOf(f.name)), multiple: true, zipName: 'sheets',
    options: [
      { key: 'to', label: 'Convert to', type: 'select', value: 'csv', options: [['csv', 'CSV'], ['json', 'JSON (array of objects)'], ['jsonarr', 'JSON (array of rows)']] },
      { key: 'which', label: 'Sheets', type: 'select', value: 'all', options: [['all', 'All sheets (one file each)'], ['first', 'First sheet only']] },
      { key: 'delim', label: 'Delimiter', type: 'select', value: ',', options: [[',', 'Comma ,'], [';', 'Semicolon ;'], ['\t', 'Tab']], show: o => o.to === 'csv' },
      { key: 'fmt', label: 'Values', type: 'select', value: 'formatted', options: [['formatted', 'As displayed (formatted)'], ['raw', 'Raw values']] }],
    async each(f, o, ctx) {
      const XLSX = await loadXLSX(); ctx.progress(0.2, 'Reading ' + f.name);
      let wb; try { wb = XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array', cellDates: true, dense: true }); } catch (e) { throw new Error(`Can’t read “${f.name}” (${/password|encrypt/i.test(e.message) ? 'it is password-protected' : e.message})`); }
      const names = o.which === 'first' ? wb.SheetNames.slice(0, 1) : wb.SheetNames, out = [];
      for (const sn of names) {
        const ws = wb.Sheets[sn], multi = names.length > 1, nm = baseName(f.name) + (multi ? '-' + sn : '');
        if (o.to === 'csv') { const csv = XLSX.utils.sheet_to_csv(ws, { FS: o.delim, rawNumbers: o.fmt === 'raw', blankrows: false }); out.push({ name: nm + '.csv', blob: new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), text: csv, info: `Sheet “${sn}” · ${csv ? csv.split('\n').length : 0} rows` }); }
        else { const rows = XLSX.utils.sheet_to_json(ws, { header: o.to === 'jsonarr' ? 1 : undefined, raw: o.fmt === 'raw', defval: o.to === 'json' ? null : undefined, blankrows: false }); const s = JSON.stringify(rows, null, 2); out.push({ name: nm + '.json', blob: new Blob([s], { type: 'application/json' }), text: s, info: `Sheet “${sn}” · ${rows.length} rows` }); }
      }
      return out;
    }
  });
  alias('xlsx-to-csv', 'spreadsheet-convert', { to: 'csv' }); alias('excel-to-csv', 'spreadsheet-convert', { to: 'csv' }); alias('xlsx-to-json', 'spreadsheet-convert', { to: 'json' });
  register({
    id: 'csv-to-xlsx', cat: 'data', glyph: 'sheet', name: 'CSV / JSON → Excel', keywords: 'csv json to xlsx excel ods spreadsheet workbook',
    desc: 'CSV, TSV or JSON tables to an XLSX (or ODS) workbook with real numbers.',
    accept: '.csv,.tsv,.txt,.json,text/csv', acceptText: 'CSV, TSV or JSON (array of objects / rows)', acceptTest: f => /^(csv|tsv|txt|json)$/.test(extOf(f.name)) || f.type === 'text/csv', multiple: true,
    options: [
      { key: 'to', label: 'Format', type: 'select', value: 'xlsx', options: [['xlsx', 'Excel (.xlsx)'], ['ods', 'OpenDocument (.ods)']] },
      { key: 'combine', label: 'Several files', type: 'select', value: 'sheets', options: [['sheets', 'One workbook, one sheet per file'], ['separate', 'One workbook per file']] },
      { key: 'types', label: 'Numbers', type: 'checkbox', text: 'Store numbers, dates and TRUE/FALSE as real values', value: true }],
    async run(files, o, ctx) {
      const XLSX = await loadXLSX(), D = LC.dataInternals, out = [];
      const toAoa = async f => {
        const text = await readText(f);
        if (extOf(f.name) === 'json' || /^\s*[[{]/.test(text)) {
          let data; try { data = JSON.parse(text); } catch (e) { throw new Error(`${f.name}: invalid JSON (${e.message})`); }
          if (!Array.isArray(data)) data = Array.isArray(data?.data) ? data.data : [data];
          if (data.every(Array.isArray)) return data;
          const flat = data.map(r => D.flatten(r)); const keys = [...new Set(flat.flatMap(Object.keys))];
          return [keys, ...flat.map(r => keys.map(k => r[k] ?? null))];
        }
        const rows = D.parseCsv(text, { delim: extOf(f.name) === 'tsv' ? '\t' : 'auto' }).rows;
        return o.types ? rows.map(r => r.map(D.typed)) : rows;
      };
      const book = () => XLSX.utils.book_new(), save = (wb, name) => {
        const data = XLSX.write(wb, { bookType: o.to, type: 'array', compression: true });
        return { name: name + '.' + o.to, blob: new Blob([data], { type: o.to === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/vnd.oasis.opendocument.spreadsheet' }), info: `${wb.SheetNames.length} sheet${wb.SheetNames.length > 1 ? 's' : ''}` };
      };
      const sheetName = (wb, n) => { let s = n.replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Sheet', i = 2; while (wb.SheetNames.includes(s)) s = s.slice(0, 27) + ' (' + i++ + ')'; return s; };
      let wb = book();
      for (let i = 0; i < files.length; i++) {
        ctx.check(); ctx.progress(i / files.length, 'Reading ' + files[i].name);
        try {
          const aoa = await toAoa(files[i]);
          const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true });
          if (o.combine === 'separate') { const w = book(); XLSX.utils.book_append_sheet(w, ws, sheetName(w, baseName(files[i].name))); out.push(save(w, baseName(files[i].name))); }
          else XLSX.utils.book_append_sheet(wb, ws, sheetName(wb, baseName(files[i].name)));
        } catch (e) { out.push({ name: files[i].name, error: e.message }); }
      }
      if (o.combine !== 'separate' && wb.SheetNames.length) out.unshift(save(wb, files.length === 1 ? baseName(files[0].name) : 'workbook'));
      return out;
    }
  });
  alias('csv-to-excel', 'csv-to-xlsx');

  LC.pdfInternals = { parseRanges, layoutPdf, htmlToBlocks, domText, readText, jpegOrientation };
})();
