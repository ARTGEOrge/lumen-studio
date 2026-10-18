'use strict';
/* Lumen Slides — files: .lslides projects, PowerPoint import/export, PDF / PNG export, pictures, themes. */
const IO = (() => {
  const M = Model;
  const ext = n => String(n).split('.').pop().toLowerCase();
  const LS_FILTER = [{ name: 'Lumen Slides', extensions: ['lslides'] }];
  async function confirmDiscard() { if (!Aero.dirty) return true; return Aero.confirm('Unsaved changes', 'The current presentation has unsaved changes. Discard them?', 'Discard'); }
  async function newDoc() { if (!(await confirmDiscard())) return; setDocument(M.newDoc({ theme: S.doc ? S.doc.theme.id : 'lumen' }), {}, 'Untitled', null); }
  async function open() {
    const files = await Aero.openFile({ accept: '.lslides,.pptx,.potx,.thmx,.json', filters: [{ name: 'Presentations', extensions: ['lslides', 'pptx', 'potx'] }, { name: 'PowerPoint', extensions: ['pptx', 'potx'] }, { name: 'All files', extensions: ['*'] }] });
    if (files[0]) openFiles(files);
  }
  async function openFiles(files) {
    const f = files[0]; if (!f) return;
    const e = ext(f.name);
    try {
      if (/^(png|jpe?g|gif|webp|svg|bmp)$/.test(e)) { await insertImageFiles(files.map(x => ({ name: x.name, data: x.data, type: x.type }))); return; }
      if (e === 'thmx') { await applyThemeFile(f.data); return; }
      if (!(await confirmDiscard())) return;
      Aero.busy('Opening ' + f.name + '…');
      await new Promise(r => setTimeout(r, 30));
      if (e === 'pptx' || e === 'potx' || e === 'ppsx' || isZip(f.data)) {
        const r = PPTXReader.read(new Uint8Array(f.data));
        await measureAssets(r.assets);
        setDocument(r.doc, r.assets, Aero.baseName(f.name), e === 'pptx' ? null : null);
        S.pptxPath = f.path || null;
        Aero.busy();
        Aero.toast(r.warnings.length ? `Opened with notes: ${r.warnings.slice(0, 2).join('; ')}${r.warnings.length > 2 ? '…' : ''}` : `Opened ${f.name} (${r.doc.slides.length} slides)`, r.warnings.length ? 5000 : 2200);
        return;
      }
      const txt = new TextDecoder().decode(f.data);
      const j = JSON.parse(txt);
      if (!j || j.app !== 'lumen-slides') throw new Error('This is not a Lumen Slides file');
      const doc = M.sanitize(j.doc), assets = M.sanitizeAssets(j.assets);
      await measureAssets(assets);
      setDocument(doc, assets, Aero.baseName(f.name), f.path || null);
      Aero.busy();
    } catch (err) { Aero.busy(); console.warn(err); Aero.alert('Could not open file', `${f.name}: ${err.message || err}`); }
  }
  const isZip = d => { const u = new Uint8Array(d, 0, Math.min(4, d.byteLength)); return u[0] === 0x50 && u[1] === 0x4b; };
  async function measureAssets(assets) {
    await Promise.all(Object.values(assets).map(a => new Promise(res => { if (a.w && a.h) return res(); const im = new Image(); im.onload = () => { a.w = im.naturalWidth || 400; a.h = im.naturalHeight || 300; res(); }; im.onerror = () => res(); im.src = a.data; })));
  }
  function serialize() {
    const used = M.usedAssets(S.doc), assets = {};
    for (const id of used) if (S.assets[id]) { const a = S.assets[id]; assets[id] = { mime: a.mime, data: a.data, w: a.w, h: a.h, name: a.name }; }
    return JSON.stringify({ app: 'lumen-slides', version: 1, doc: S.doc, assets });
  }
  async function save(as) {
    Editor.endEdit(true);
    const name = (S.name || 'Untitled') + '.lslides';
    const p = await Aero.saveFile({ name, data: serialize(), filters: LS_FILTER, path: as ? null : S.path });
    if (!p) return false;
    if (Aero.isDesktop) { S.path = p; S.name = Aero.baseName(p); }
    Aero.setDoc(S.name, false); Aero.toast('Saved ' + Aero.baseName(p) + '.lslides');
    return true;
  }
  // assets PowerPoint cannot show natively (SVG, WebP) are converted to PNG
  async function pptxAssets() {
    const out = {};
    for (const id of M.usedAssets(S.doc)) {
      const a = S.assets[id]; if (!a) continue;
      if (a.mime === 'image/svg+xml' || a.mime === 'image/webp') {
        const im = new Image(); im.src = a.data; await im.decode().catch(() => { });
        const w = Math.min(4096, a.w || im.naturalWidth || 800), h = Math.min(4096, a.h || im.naturalHeight || 600), k = Math.min(1, 4096 / Math.max(w, h)) * (a.mime === 'image/svg+xml' ? 2 : 1);
        const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * Math.min(k, 4096 / w))); c.height = Math.max(1, Math.round(h * Math.min(k, 4096 / h)));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        out[id] = { mime: 'image/png', data: c.toDataURL('image/png'), w: c.width, h: c.height };
      } else out[id] = a;
    }
    return out;
  }
  function fitScale(o, slide) {
    if (!o.text || !(o.text.autofit === 'shrink' || (o.ph && M.phCat(o.ph) === 'body' && !o.text.autofit))) return null;
    const L = Render.layoutText(S.doc, { slide }, o, o.text, o.w, o.h, {}); return L.scale;
  }
  async function exportPptx() {
    Editor.endEdit(true);
    Aero.busy('Writing PowerPoint file…'); await new Promise(r => setTimeout(r, 30));
    try {
      const assets = await pptxAssets();
      const bytes = PPTXWriter.write(S.doc, assets, { fitScale, title: S.name });
      Aero.busy();
      const p = await Aero.saveFile({ name: (S.name || 'Presentation') + '.pptx', data: bytes, filters: [{ name: 'PowerPoint Presentation', extensions: ['pptx'] }] });
      if (p) Aero.toast('Exported ' + Aero.baseName(p) + '.pptx');
    } catch (e) { Aero.busy(); console.warn(e); Aero.alert('Export failed', e.message || String(e)); }
  }
  async function renderSlideBlob(slide, width, type, q) {
    await Render.imagesReady(S.assets);
    const cv = Render.slideCanvas(S.doc, slide, S.assets, width, { slideNum: S.doc.slides.indexOf(slide) + 1 });
    return new Promise(res => cv.toBlob(b => res(b), type, q));
  }
  async function buildPdf(v, progress = () => { }) {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    const pdf = await PDFDocument.create(); pdf.setTitle(S.name || 'Presentation'); pdf.setCreator('Lumen Slides'); pdf.setProducer('Lumen Slides (pdf-lib)');
    const font = v.notes ? await pdf.embedFont(StandardFonts.Helvetica) : null;
    const W = S.doc.w * 0.75, H = S.doc.h * 0.75;
    const width = v.q === 'high' ? 2560 : v.q === 'small' ? 1280 : 1920, png = v.q === 'high';
    const slides = S.doc.slides.filter(s => v.hidden || !s.hidden);
    for (let i = 0; i < slides.length; i++) {
      progress(i, slides.length);
      const blob = await renderSlideBlob(slides[i], width, png ? 'image/png' : 'image/jpeg', 0.92);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const img = png ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      if (!v.notes) { const pg = pdf.addPage([W, H]); pg.drawImage(img, { x: 0, y: 0, width: W, height: H }); }
      else {
        const PW = 595.28, PH = 841.89, m = 48, iw = PW - m * 2, ih = iw * S.doc.h / S.doc.w;
        const pg = pdf.addPage([PW, PH]); pg.drawImage(img, { x: m, y: PH - m - ih, width: iw, height: ih });
        pg.drawRectangle({ x: m, y: PH - m - ih, width: iw, height: ih, borderColor: rgb(0.6, 0.65, 0.7), borderWidth: 0.6 });
        pg.drawText(`Slide ${S.doc.slides.indexOf(slides[i]) + 1}`, { x: m, y: PH - m - ih - 22, size: 10, font, color: rgb(0.35, 0.4, 0.48) });
        const lines = wrapPdf(winAnsi(font, slides[i].notes || ''), font, 11.5, iw); let y = PH - m - ih - 44;
        for (const ln of lines) { if (y < m) break; pg.drawText(ln, { x: m, y, size: 11.5, font, color: rgb(0.1, 0.12, 0.16) }); y -= 16; }
      }
      await new Promise(r => setTimeout(r, 0));
    }
    return pdf.save();
  }
  async function exportPdf() {
    Editor.endEdit(true);
    Aero.dialog({ title: 'Export PDF', fields: [{ key: 'q', label: 'Quality', type: 'select', value: 'std', options: [['std', 'Standard (1920 px, JPEG)'], ['high', 'High (2560 px, PNG)'], ['small', 'Small file (1280 px, JPEG)']] }, { key: 'notes', label: 'Notes pages', type: 'checkbox', value: false }, { key: 'hidden', label: 'Include hidden slides', type: 'checkbox', value: false }],
      ok: 'Export', onOK: async v => {
        Aero.busy('Creating PDF…');
        try {
          const out = await buildPdf(v, (i, n) => Aero.busy(`Creating PDF… slide ${i + 1} of ${n}`));
          Aero.busy();
          const p = await Aero.saveFile({ name: (S.name || 'Presentation') + '.pdf', data: out, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
          if (p) Aero.toast('Exported ' + Aero.baseName(p) + '.pdf');
        } catch (e) { Aero.busy(); console.warn(e); Aero.alert('PDF export failed', e.message || String(e)); }
      } });
  }
  const encCache = new Map();
  function winAnsi(font, s) { return [...String(s)].map(ch => { if (ch === '\n') return ch; if (encCache.has(ch)) return encCache.get(ch); let ok = true; try { font.widthOfTextAtSize(ch, 10); } catch (_) { ok = false; } const r = ok ? ch : ch === '→' ? '->' : '?'; encCache.set(ch, r); return r; }).join(''); }
  function wrapPdf(text, font, size, maxW) {
    const out = [];
    for (const para of text.split('\n')) {
      let line = '';
      for (const w of para.split(/(\s+)/)) { const t = line + w; if (font.widthOfTextAtSize(t, size) > maxW && line.trim()) { out.push(line.trimEnd()); line = w.trimStart(); } else line = t; }
      out.push(line);
    }
    return out;
  }
  async function buildPngZip(v, progress = () => { }) {
    const files = {}; const slides = S.doc.slides.filter(s => v.hidden || !s.hidden);
    for (let i = 0; i < slides.length; i++) { progress(i, slides.length); const b = await renderSlideBlob(slides[i], +v.w, 'image/png'); files[`${(S.name || 'Slide').replace(/[\/:*?"<>|]/g, '_')}-${String(S.doc.slides.indexOf(slides[i]) + 1).padStart(2, '0')}.png`] = new Uint8Array(await b.arrayBuffer()); }
    return { zip: fflate.zipSync(files, { level: 0 }), count: slides.length };
  }
  async function exportPngs() {
    Editor.endEdit(true);
    Aero.dialog({ title: 'Export Slides as PNG', fields: [{ key: 'w', label: 'Width (px)', type: 'select', value: '1920', options: [['1280', '1280'], ['1920', '1920 (Full HD)'], ['2560', '2560'], ['3840', '3840 (4K)']] }, { key: 'hidden', label: 'Include hidden slides', type: 'checkbox', value: false }], ok: 'Export',
      onOK: async v => {
        Aero.busy('Rendering slides…');
        try {
          const { zip, count } = await buildPngZip(v, (i, n) => Aero.busy(`Rendering slide ${i + 1} of ${n}…`));
          Aero.busy();
          const p = await Aero.saveFile({ name: (S.name || 'Slides') + '-png.zip', data: zip, filters: [{ name: 'ZIP archive', extensions: ['zip'] }] });
          if (p) Aero.toast(`Exported ${count} PNG files`);
        } catch (e) { Aero.busy(); Aero.alert('Export failed', e.message || String(e)); }
      } });
  }
  async function exportPng() {
    const s = curSlide(); if (!s) return;
    Editor.endEdit(true);
    const b = await renderSlideBlob(s, 1920, 'image/png');
    const p = await Aero.saveFile({ name: `${S.name || 'Slide'}-${S.cur + 1}.png`, data: b, filters: [{ name: 'PNG image', extensions: ['png'] }] });
    if (p) Aero.toast('Exported slide ' + (S.cur + 1));
  }
  /* ---------- pictures ---------- */
  async function addAsset(name, mime, data) {
    const u8 = new Uint8Array(data);
    if (!mime) mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' }[ext(name)] || '';
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml|bmp)$/.test(mime)) throw new Error('Unsupported image type: ' + name);
    let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    const url = `data:${mime};base64,` + btoa(s);
    const im = new Image(); im.src = url; await im.decode().catch(() => { throw new Error('Could not decode ' + name); });
    const id = 'img' + M.uid();
    S.assets[id] = { mime, data: url, w: im.naturalWidth || 400, h: im.naturalHeight || 300, name };
    return id;
  }
  async function insertImageFiles(files, at) {
    if (S.mode === 'slide' && !curSlide()) return;
    const ids = [];
    let n = 0;
    for (const f of files) {
      try {
        const id = await addAsset(f.name, f.type && /^image\//.test(f.type) ? f.type : '', f.data);
        const a = S.assets[id], k = Math.min(1, S.doc.w * 0.6 / a.w, S.doc.h * 0.6 / a.h), w = a.w * k, h = a.h * k;
        const cx = at ? at[0] : S.doc.w / 2 + n * 24, cy = at ? at[1] : S.doc.h / 2 + n * 24;
        const o = M.image(id, cx - w / 2, cy - h / 2, w, h); target().main.push(o); ids.push(o.id); n++;
      } catch (e) { Aero.toast(e.message); }
    }
    if (ids.length) { S.sel = ids; commit(ids.length > 1 ? 'Insert pictures' : 'Insert picture'); }
  }
  async function insertPicture(into) {
    const files = await Aero.openFile({ accept: 'image/*', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }] });
    if (!files[0]) return;
    if (!into) { await insertImageFiles(files); return; }
    try {
      const id = await addAsset(files[0].name, files[0].type, files[0].data);
      const a = S.assets[id];
      if (into.type === 'image') { into.asset = id; into.crop = null; const ia = a.w / a.h, fa = into.w / into.h; into.crop = ia > fa ? { l: (1 - fa / ia) / 2, r: (1 - fa / ia) / 2, t: 0, b: 0 } : { t: (1 - ia / fa) / 2, b: (1 - ia / fa) / 2, l: 0, r: 0 }; commit('Change picture'); return; }
      // picture placeholder → image object in the same frame, cropped to fill
      const l = listOf(into.id), o = M.image(id, into.x, into.y, into.w, into.h); o.ph = { ...into.ph }; if (into.ownGeo) o.ownGeo = true;
      const ia = a.w / a.h, fa = o.w / o.h; o.crop = ia > fa ? { l: (1 - fa / ia) / 2, r: (1 - fa / ia) / 2, t: 0, b: 0 } : { t: (1 - ia / fa) / 2, b: (1 - ia / fa) / 2, l: 0, r: 0 };
      l.splice(l.indexOf(into), 1, o); S.sel = [o.id]; commit('Insert picture');
    } catch (e) { Aero.toast(e.message); }
  }
  async function pickBackgroundImage(owner) {
    const files = await Aero.openFile({ accept: 'image/*', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }] });
    if (!files[0]) { UI.refresh(true); return; }
    try { const id = await addAsset(files[0].name, files[0].type, files[0].data); owner.bg = { img: id }; commit('Background picture'); } catch (e) { Aero.toast(e.message); }
  }
  /* ---------- themes & importing slides ---------- */
  async function applyThemeFile(data) {
    try {
      const t = PPTXReader.readTheme(data);
      S.doc.theme.colors = { ...S.doc.theme.colors, ...t.colors }; S.doc.theme.fonts = { ...t.fonts }; S.doc.theme.name = t.name; S.doc.theme.id = 'imported';
      UI.fillFontSelect(); commit('Import theme'); Aero.toast(`Applied theme “${t.name}” (colours and fonts)`);
    } catch (e) { Aero.alert('Could not import theme', e.message); }
  }
  async function importTheme() {
    const files = await Aero.openFile({ accept: '.thmx,.pptx,.potx', filters: [{ name: 'Themes and presentations', extensions: ['thmx', 'pptx', 'potx'] }] });
    if (files[0]) applyThemeFile(files[0].data);
  }
  async function importSlides() {
    if (S.mode !== 'slide') UI.setMode('slide');
    const files = await Aero.openFile({ accept: '.pptx,.potx,.lslides', filters: [{ name: 'Presentations', extensions: ['pptx', 'potx', 'lslides'] }] });
    const f = files[0]; if (!f) return;
    try {
      let doc, assets;
      if (isZip(f.data)) { const r = PPTXReader.read(new Uint8Array(f.data)); doc = r.doc; assets = r.assets; }
      else { const j = JSON.parse(new TextDecoder().decode(f.data)); doc = M.sanitize(j.doc); assets = M.sanitizeAssets(j.assets); }
      await measureAssets(assets);
      // keep this deck's theme: map layouts by name (or by kind), fall back to Title and Content
      const byName = new Map(S.doc.layouts.map(l => [l.name.toLowerCase(), l.id])), byKind = new Map(S.doc.layouts.map(l => [l.kind, l.id]));
      const fallback = (S.doc.layouts.find(l => l.kind === 'obj') || S.doc.layouts[0]).id;
      const rename = {}; for (const id of Object.keys(assets)) { const n = 'img' + M.uid(); rename[id] = n; S.assets[n] = assets[id]; }
      const add = doc.slides.map(s => {
        const lay = doc.layouts.find(l => l.id === s.layout);
        s.layout = lay && (byName.get(lay.name.toLowerCase()) || byKind.get(lay.kind)) || fallback;
        M.walk(s.objects, o => { if (o.type === 'image' && rename[o.asset]) o.asset = rename[o.asset]; });
        if (s.bg && s.bg.img) s.bg.img = rename[s.bg.img] || s.bg.img;
        s.id = M.uid(); return s;
      });
      S.doc.slides.splice(S.cur + 1, 0, ...add); S.cur += 1;
      commit(`Import ${add.length} slides`); Aero.toast(`Imported ${add.length} slide${add.length === 1 ? '' : 's'} from ${f.name}`);
    } catch (e) { Aero.alert('Import failed', e.message || String(e)); }
  }
  async function openSample() { if (!(await confirmDiscard())) return; const { doc, assets } = await Sample.build(); setDocument(doc, assets, 'Lumen Product Launch', null); }
  return { newDoc, open, openFiles, save, serialize, buildPdf, buildPngZip, exportPptx, exportPdf, exportPngs, exportPng, insertPicture, insertImageFiles, pickBackgroundImage, importTheme, importSlides, openSample, confirmDiscard, addAsset, pptxAssets, fitScale, renderSlideBlob, measureAssets };
})();
