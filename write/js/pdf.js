'use strict';
/* Lumen Write — PDF export. The paginated page view is laid out by the browser with the bundled fonts;
   this walks that layout (text runs, backgrounds, borders, images, list markers, links) and draws the same
   thing with pdf-lib, embedding subsets of the same font files. Text stays selectable/searchable. */
const PDFX = (() => {
  const { PDFDocument, rgb, PDFName, PDFString } = window.PDFLib || {};
  const parseColor = c => { const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(c || ''); if (!m) return null; const a = m[4] == null ? 1 : +m[4]; if (a === 0) return null; return { c: rgb(+m[1] / 255, +m[2] / 255, +m[3] / 255), a }; };
  async function exportPdf(opts = {}) {
    const prev = { zoom: S.zoom, markup: S.markup, marks: S.marks };
    const pagesEl = document.getElementById('pages');
    UI.setZoom(1, true);
    S.markup = 'final'; S.marks = false; UI.applyView(true);
    pagesEl.classList.add('printing');
    getSelection().removeAllRanges();
    try {
      await Fonts.load(); await document.fonts.ready;
      Pager.run();
      return await render(opts);
    } finally {
      pagesEl.classList.remove('printing');
      S.markup = prev.markup; S.marks = prev.marks; UI.applyView(true);
      UI.setZoom(prev.zoom, true);
      Pager.run();
    }
  }
  async function render() {
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(window.fontkit);
    pdf.setTitle(S.doc.meta.title || S.name || 'Document'); if (S.doc.meta.author) pdf.setAuthor(S.doc.meta.author);
    pdf.setCreator('Lumen Write'); pdf.setProducer('Lumen Write (pdf-lib)');
    const fontCache = {};
    const font = async file => { if (!fontCache[file]) fontCache[file] = pdf.embedFont(await Fonts.fileBytes(file), { subset: true }); return fontCache[file]; };
    const fallback = await font(Fonts.FALLBACK);
    const sheets = [...document.querySelectorAll('#sheets .page')];
    const SR = sheets.map(s => s.getBoundingClientRect());
    const pw = S.doc.page.w, ph = S.doc.page.h, K = 0.75;
    const pages = sheets.map(() => pdf.addPage([pw, ph]));
    const ops = sheets.map(() => ({ bg: [], border: [], img: [], text: [], link: [] }));
    const sheetOf = (top, bottom) => { const cy = (top + bottom) / 2; for (let i = 0; i < SR.length; i++) if (cy >= SR[i].top - 1 && cy <= SR[i].bottom + 1) return i; return -1; };
    const P = (i, x, y) => [(x - SR[i].left) * K, ph - (y - SR[i].top) * K];
    const visible = el => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden'; };

    // ---- walk elements: backgrounds, borders, images, list markers, links ----
    const roots = [S.ed, ...sheets];
    const listCounters = new Map();
    function walkEl(el) {
      if (el.nodeType !== 1) return;
      if (el.classList.contains('pg-gap') || el.classList.contains('fnmeasure')) return;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const bg = parseColor(cs.backgroundColor);
      if (bg && el !== S.ed && !el.classList.contains('page')) for (const r of el.getClientRects()) { const i = sheetOf(r.top, r.bottom); if (i >= 0) ops[i].bg.push({ r, c: bg }); }
      const bw = ['Top', 'Right', 'Bottom', 'Left'].map(s => parseFloat(cs['border' + s + 'Width']) || 0);
      if (bw.some(Boolean) && !el.classList.contains('page')) {
        const r = el.getBoundingClientRect(); const i = sheetOf(r.top, r.bottom);
        if (i >= 0) ['Top', 'Right', 'Bottom', 'Left'].forEach((s, k) => { if (!bw[k] || cs['border' + s + 'Style'] === 'none' || cs['border' + s + 'Style'] === 'hidden') return; const c = parseColor(cs['border' + s + 'Color']); if (c) ops[i].border.push({ r, side: k, w: bw[k], c, dash: /dotted|dashed/.test(cs['border' + s + 'Style']) ? cs['border' + s + 'Style'] : null }); });
      }
      if (el.nodeName === 'IMG') { const r = el.getBoundingClientRect(); const i = sheetOf(r.top, r.bottom); if (i >= 0 && r.width > 0) ops[i].img.push({ r, id: el.dataset.a, el }); return; }
      if (el.nodeName === 'LI') marker(el, cs);
      if (el.nodeName === 'A') { const href = el.getAttribute('href') || ''; if (/^(https?:|mailto:)/i.test(href)) for (const r of el.getClientRects()) { const i = sheetOf(r.top, r.bottom); if (i >= 0) ops[i].link.push({ r, href }); } }
      for (const c of el.children) walkEl(c);
    }
    function marker(li, cs) {
      const list = li.parentNode; if (!list || !/^(UL|OL)$/.test(list.nodeName) || li.classList.contains('nest')) return;
      const type = cs.listStyleType;
      let text;
      if (list.nodeName === 'UL') text = type === 'circle' ? '◦' : type === 'square' ? '▪' : type === 'none' ? '' : '•';
      else { const items = [...list.children].filter(c => c.nodeName === 'LI'); const n = items.indexOf(li) + (+list.getAttribute('start') || 1); text = Model.fmtNumber(n, type === 'decimal' ? 'decimal' : type) + '.'; }
      if (!text) return;
      // baseline of the first line of the item's own text
      const tw = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
      let first = null; for (let t = tw.nextNode(); t; t = tw.nextNode()) { if (t.nodeValue.trim() && !t.parentNode.closest('ul ul, ol ol, ul ol, ol ul')?.contains(li) && t.parentNode.closest('li') === li) { first = t; break; } }
      const lr = li.getBoundingClientRect();
      let top, h;
      if (first) { const rg = document.createRange(); rg.selectNodeContents(first); const r0 = rg.getClientRects()[0]; if (r0) { top = r0.top; h = r0.height; } }
      if (top == null) { top = lr.top; h = parseFloat(cs.fontSize) * 1.2; }
      const i = sheetOf(top, top + h); if (i < 0) return;
      ops[i].text.push({ marker: true, text, right: lr.left - parseFloat(cs.fontSize) * 0.45, top, h, cs });
    }
    roots.forEach(walkEl);
    // ---- text ----
    const rg = document.createRange();
    const decoCache = new Map();
    function decoOf(el) {
      if (decoCache.has(el)) return decoCache.get(el);
      let u = false, s = false; let e = el;
      while (e && e !== S.ed && !(e.classList && e.classList.contains('page'))) { const d = getComputedStyle(e).textDecorationLine || ''; if (/underline/.test(d)) u = true; if (/line-through/.test(d)) s = true; if (/^(P|H[1-6]|LI|TD|DIV)$/.test(e.nodeName)) break; e = e.parentNode; }
      const v = { u, s }; decoCache.set(el, v); return v;
    }
    for (const rootEl of roots) {
      const w = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentNode.closest('.pg-gap,.fnmeasure') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const el = n.parentNode; if (!visible(el)) continue;
        const t = n.nodeValue; if (!t.trim()) continue;
        const cs = getComputedStyle(el);
        const deco = decoOf(el);
        const re = /\S+/g; let m;
        while ((m = re.exec(t))) {
          rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
          const rs = [...rg.getClientRects()].filter(r => r.width > 0);
          if (!rs.length) continue;
          if (rs.length === 1) { const r = rs[0]; const i = sheetOf(r.top, r.bottom); if (i >= 0) ops[i].text.push({ text: m[0], r, cs }); }
          else for (let k = 0; k < m[0].length; k++) { rg.setStart(n, m.index + k); rg.setEnd(n, m.index + k + 1); const r = rg.getClientRects()[0]; if (!r) continue; const i = sheetOf(r.top, r.bottom); if (i >= 0) ops[i].text.push({ text: m[0][k], r, cs }); }
        }
        if (deco.u || deco.s) { rg.selectNodeContents(n); for (const r of rg.getClientRects()) { if (r.width <= 0) continue; const i = sheetOf(r.top, r.bottom); if (i >= 0) ops[i].text.push({ line: true, r, cs, u: deco.u, s: deco.s }); } }
      }
    }
    // ---- draw ----
    const imgCache = {};
    async function embedImg(id, el) {
      if (imgCache[id]) return imgCache[id];
      const a = S.assets[id]; let job;
      if (a && a.mime === 'image/png') job = pdf.embedPng(a.data);
      else if (a && a.mime === 'image/jpeg') job = pdf.embedJpg(a.data);
      else job = (async () => { const bm = await createImageBitmap(a ? new Blob([a.data], { type: a.mime }) : el); const c = new OffscreenCanvas(bm.width || 1, bm.height || 1); c.getContext('2d').drawImage(bm, 0, 0); const b = await c.convertToBlob({ type: 'image/png' }); return pdf.embedPng(new Uint8Array(await b.arrayBuffer())); })();
      imgCache[id] = job.catch(() => null); return imgCache[id];
    }
    for (let i = 0; i < pages.length; i++) {
      const pg = pages[i], o = ops[i];
      for (const b of o.bg) { const [x, y] = P(i, b.r.left, b.r.bottom); pg.drawRectangle({ x, y, width: b.r.width * K, height: b.r.height * K, color: b.c.c, opacity: b.c.a }); }
      for (const b of o.border) {
        const r = b.r, wpt = b.w * K; let x0, y0, x1, y1;
        if (b.side === 0) { [x0, y0] = P(i, r.left, r.top + b.w / 2); [x1, y1] = P(i, r.right, r.top + b.w / 2); }
        else if (b.side === 2) { [x0, y0] = P(i, r.left, r.bottom - b.w / 2); [x1, y1] = P(i, r.right, r.bottom - b.w / 2); }
        else if (b.side === 3) { [x0, y0] = P(i, r.left + b.w / 2, r.top); [x1, y1] = P(i, r.left + b.w / 2, r.bottom); }
        else { [x0, y0] = P(i, r.right - b.w / 2, r.top); [x1, y1] = P(i, r.right - b.w / 2, r.bottom); }
        pg.drawLine({ start: { x: x0, y: y0 }, end: { x: x1, y: y1 }, thickness: wpt, color: b.c.c, opacity: b.c.a, dashArray: b.dash === 'dotted' ? [wpt, wpt * 2] : b.dash === 'dashed' ? [wpt * 3, wpt * 2] : undefined });
      }
      for (const im of o.img) { const e = await embedImg(im.id, im.el); if (!e) continue; const [x, y] = P(i, im.r.left, im.r.bottom); pg.drawImage(e, { x, y, width: im.r.width * K, height: im.r.height * K }); }
      for (const t of o.text) {
        const cs = t.cs;
        const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
        const bold = +cs.fontWeight >= 600, italic = cs.fontStyle === 'italic' || cs.fontStyle === 'oblique';
        const f = await font(Fonts.faceFile(fam, bold, italic));
        const size = parseFloat(cs.fontSize) * K;
        const col = parseColor(cs.color) || { c: rgb(0, 0, 0), a: 1 };
        const fk = f.embedder && f.embedder.font;
        const asc = fk ? fk.ascent / fk.unitsPerEm : 0.9, desc = fk ? -fk.descent / fk.unitsPerEm : 0.22;
        if (t.line) {
          const r = t.r; const base = r.top + (r.height - (asc + desc) * parseFloat(cs.fontSize)) / 2 + asc * parseFloat(cs.fontSize);
          const fs = parseFloat(cs.fontSize);
          if (t.u) { const [x0, y0] = P(i, r.left, base + fs * 0.11); pg.drawLine({ start: { x: x0, y: y0 }, end: { x: x0 + r.width * K, y: y0 }, thickness: Math.max(0.5, fs * 0.06 * K), color: col.c }); }
          if (t.s) { const [x0, y0] = P(i, r.left, base - fs * 0.3); pg.drawLine({ start: { x: x0, y: y0 }, end: { x: x0 + r.width * K, y: y0 }, thickness: Math.max(0.5, fs * 0.06 * K), color: col.c }); }
          continue;
        }
        const fsPx = parseFloat(cs.fontSize);
        const top = t.marker ? t.top : t.r.top, h = t.marker ? t.h : t.r.height;
        const basePx = top + (h - (asc + desc) * fsPx) / 2 + asc * fsPx;
        let text = t.text;
        let sc = 1;
        if (cs.fontVariantCaps === 'small-caps' || cs.fontVariant === 'small-caps') { if (text !== text.toUpperCase()) { sc = 0.8; } text = text.toUpperCase(); }
        if (cs.textTransform === 'uppercase') text = text.toUpperCase();
        let xPx = t.marker ? t.right - f.widthOfTextAtSize(text, size) / K : t.r.left;
        // split into glyph-supported segments; unsupported characters use the wide-coverage fallback font
        const segs = []; let cur = '', curF = null;
        for (const ch of text) { const cp = ch.codePointAt(0); const ff = !fk || fk.hasGlyphForCodePoint(cp) ? f : fallback; if (ff !== curF && cur) { segs.push([cur, curF]); cur = ''; } curF = ff; cur += ch; }
        if (cur) segs.push([cur, curF]);
        const [, yb] = P(i, 0, basePx);
        for (const [s, ff] of segs) {
          const [xx] = P(i, xPx, 0);
          try { pg.drawText(s, { x: xx, y: yb, size: size * sc, font: ff, color: col.c, opacity: col.a }); } catch (e) { /* glyph the fallback lacks too */ }
          xPx += ff.widthOfTextAtSize(s, size * sc) / K;
        }
      }
      for (const l of o.link) {
        try {
          const [x0, y0] = P(i, l.r.left, l.r.bottom), [x1, y1] = P(i, l.r.right, l.r.top);
          const annot = pdf.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: [x0, y0, x1, y1], Border: [0, 0, 0], A: { Type: 'Action', S: 'URI', URI: PDFString.of(l.href) } });
          pg.node.addAnnot(pdf.context.register(annot));
        } catch (e) { }
      }
    }
    return await pdf.save();
  }
  return { export: exportPdf };
})();
