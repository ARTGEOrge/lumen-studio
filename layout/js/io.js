'use strict';
/* Lumen Layout — files: .llay open/save, place (images/text), PDF / PNG / JPEG export, ZIP, print, drag & drop. */
const IO = (() => {
  const FILTER = [{ name: 'Lumen Layout document', extensions: ['llay'] }];
  function defaultStyles(d) {
    const ink = d.cmyk ? '@black' : '#1a1a1a';
    Object.assign(d.paraStyles, {
      basic: { name: 'Basic Paragraph', font: 'Source Serif 4', size: 10.5, lead: 14, hyph: true, color: ink },
      body: { name: 'Body', basedOn: 'basic', font: 'Source Serif 4', size: 9.5, lead: 13.5, align: 'justify', indF: 12, hyph: true, keepStart: 2, keepEnd: 2 },
      head: { name: 'Headline', font: 'Playfair Display', weight: 900, size: 36, lead: 38, color: d.cmyk ? 'cmyk(80,60,30,70)' : '#14202e', hyph: false, next: 'body', spA: 8, keepNext: 1 },
      sub: { name: 'Subhead', font: 'Montserrat', weight: 700, size: 9, caps: 'all', track: 80, color: d.cmyk ? '@blue' : '#1f6fb5', spB: 10, spA: 3, hyph: false, next: 'body', keepNext: 1 },
      cap: { name: 'Caption', font: 'Montserrat', size: 7, lead: 9.5, color: d.cmyk ? '@black/70' : '#5b6b7c', hyph: false },
    });
    d.charStyles = Object.assign(d.charStyles || {}, { em: { name: 'Emphasis', italic: true }, strong: { name: 'Strong', weight: 700 } });
  }
  async function save(as) {
    UI.closeCellEditor?.(true); flushTyping(true);
    const json = M.serialize(S.doc, S.images);
    const name = (S.name || 'Untitled').replace(/\.llay$/i, '') + '.llay';
    const p = await Aero.saveFile({ name, data: json, filters: FILTER, path: as ? null : S.path });
    if (!p) return null;
    S.path = Aero.isDesktop ? p : null; S.name = Aero.baseName(p) || S.name;
    Aero.setDoc(S.name, false); Aero.toast('Saved ' + S.name + '.llay'); return p;
  }
  async function confirmDiscard() { if (!Aero.dirty) return true; return Aero.confirm('Unsaved Changes', 'The current document has unsaved changes. Discard them?', 'Discard'); }
  async function open() {
    if (!(await confirmDiscard())) return;
    const f = await Aero.openFile({ accept: '.llay,application/json', filters: FILTER });
    if (f[0]) openBytes(f[0]);
  }
  function openBytes(f) {
    try {
      const { doc, images } = M.deserialize(new TextDecoder().decode(f.data));
      setDocument(doc, images, Aero.baseName(f.name), f.path);
      Aero.toast('Opened ' + f.name);
    } catch (e) { console.warn(e); Aero.alert('Cannot Open', `“${f.name}” is not a valid Lumen Layout document (${e.message}).`); }
  }
  async function place() {
    const f = await Aero.openFile({ accept: 'image/png,image/jpeg,image/svg+xml,image/webp,image/gif,.txt,text/plain', filters: [{ name: 'Images & text', extensions: ['jpg', 'jpeg', 'png', 'svg', 'webp', 'gif', 'txt'] }] });
    if (f[0]) await placeFile(f[0]);
  }
  // place a file; at = world point (optional)
  async function placeFile(f, at) {
    const name = f.name || 'file';
    if (/\.txt$/i.test(name) || f.type === 'text/plain') {
      const txt = new TextDecoder().decode(f.data).replace(/\r\n?/g, '\n');
      const target = S.edit ? null : S.sel.map(id => S.eng.idx.get(id)?.item).find(i => i?.type === 'text');
      if (S.edit) { Tools.T.insert(txt); commit('Place Text'); return; }
      if (target) { const s = S.doc.stories[target.story]; M.insertText(s, s.text.length, (s.text ? '\n' : '') + txt); commit('Place Text'); return; }
      const pp = at ? pageAt(at[0], at[1], true) : curPlaced(); const m = S.eng.marginsFor(pp.kind, pp.kind === 'doc' ? pp.index : pp.side);
      const it = Tools.newTextFrame(pp, m.l, m.t, pp.w - m.l - m.r, pp.h - m.t - m.b, S.doc.paraStyles.body ? 'body' : 'basic');
      const s = S.doc.stories[it.story]; M.insertText(s, 0, txt); s.paras = s.paras.map(() => ({ ps: S.doc.paraStyles.body ? 'body' : 'basic' }));
      S.sel = [it.id]; commit('Place Text'); return;
    }
    let id;
    try { id = await addImage(name, f.type && f.type.startsWith('image/') ? f.type : '', f.data); } catch (e) { Aero.alert('Place', e.message); return; }
    const im = S.images[id];
    // target frame: hovered (drop) or selected empty/any image frame
    let target = null;
    if (at) { const h = Tools.hitAt(at[0], at[1], true); if (h && (h.item.type === 'image')) target = h.item; }
    if (!target && !at) target = S.sel.map(x => S.eng.idx.get(x)?.item).find(i => i?.type === 'image');
    if (target) { target.img = id; Tools.applyFit(target, 'fill'); target.fit = null; S.sel = [target.id]; commit('Place Image'); return; }
    const pp = at ? pageAt(at[0], at[1], true) : curPlaced();
    const m = S.eng.marginsFor(pp.kind, pp.kind === 'doc' ? pp.index : pp.side);
    const maxW = (pp.w - m.l - m.r), maxH = (pp.h - m.t - m.b) * 0.6;
    const s = Math.min(1, maxW / im.w, maxH / im.h);
    const w = im.w * s, h = im.h * s;
    let x = at ? at[0] - pp.x - w / 2 : m.l + (maxW - w) / 2, y = at ? at[1] - pp.y - h / 2 : m.t;
    const it = M.newItem('image', x, y, w, h, { img: id, cs: s, cx: 0, cy: 0 });
    Tools.addItem(pp, it); S.sel = [it.id]; UI.setTool('select'); commit('Place Image');
  }
  let lastDrop = null;
  function trackDrop() { $('#stage').addEventListener('dragover', e => { const r = $('#ov').getBoundingClientRect(); lastDrop = View.s2w(e.clientX - r.left, e.clientY - r.top); }); }
  async function dropFiles(files) {
    for (const f of files) {
      if (/\.llay$/i.test(f.name)) { if (await confirmDiscard()) openBytes(f); return; }
      await placeFile(f, lastDrop);
      if (lastDrop) lastDrop = [lastDrop[0] + 18, lastDrop[1] + 18];
    }
  }

  /* ---------- export ---------- */
  function pageListFrom(v) {
    const n = S.doc.pages.length;
    if (v.range === 'current') return [S.curPage];
    if (v.range === 'custom') {
      const out = new Set(); String(v.pages || '').split(',').forEach(part => { const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part); if (!m) return; let a = +m[1], b = m[2] ? +m[2] : a; if (a > b) [a, b] = [b, a]; for (let i = a; i <= b; i++) if (i >= 1 && i <= n) out.add(i - 1); });
      return [...out].sort((a, b) => a - b);
    }
    return S.doc.pages.map((_, i) => i);
  }
  function exportPdfDialog() {
    UI.closeCellEditor?.(true); flushTyping(true);
    Aero.dialog({ title: 'Export PDF', instruction: 'Print-quality PDF with vector shapes and real, selectable text', fields: [
      { key: 'range', label: 'Pages', type: 'select', value: 'all', options: [['all', 'All pages'], ['current', 'Current page'], ['custom', 'Range…']] }, { key: 'pages', label: 'Range (e.g. 1-3, 5)', type: 'text', value: `1-${S.doc.pages.length}` },
      { key: 'bleed', label: `Include bleed (${M.fmtU(S.doc.bleed, S.doc.units)} ${S.doc.units})`, type: 'checkbox', value: S.doc.bleed > 0 }, { key: 'marks', label: 'Crop marks & page info', type: 'checkbox', value: false },
      { key: 'nav', label: 'Bookmarks from headings & clickable contents', type: 'checkbox', value: true },
      { key: 'color', label: 'Color', type: 'select', value: S.doc.cmyk ? 'cmyk' : 'keep', options: [['keep', 'Keep colors (CMYK & spot as defined, RGB as RGB)'], ['cmyk', 'Convert colors and images to CMYK (spots kept)'], ['process', 'Convert everything to process CMYK (no spot plates)']] }],
      ok: 'Export', onOK: async v => {
        const pages = pageListFrom(v); if (!pages.length) { Aero.toast('No pages in range'); return; }
        Aero.busy('Exporting PDF…');
        try {
          const bytes = await PdfOut.exportPDF({ doc: S.doc, engine: S.eng, images: S.images, name: S.name }, { pages, bleed: !!v.bleed, marks: !!v.marks, bookmarks: !!v.nav, links: !!v.nav, cmyk: v.color !== 'keep', spotsToProcess: v.color === 'process' });
          Aero.busy();
          const p = await Aero.saveFile({ name: S.name + '.pdf', data: bytes, filters: [{ name: 'PDF', extensions: ['pdf'] }] });
          if (p) Aero.toast(`Exported ${pages.length} page${pages.length > 1 ? 's' : ''} to PDF (${(bytes.length / 1024).toFixed(0)} KB)`);
        } catch (e) { Aero.busy(); console.error(e); Aero.alert('Export PDF', 'Export failed: ' + e.message); }
      } });
  }
  async function renderPageCanvas(i, dpi, bleed) {
    const d = S.doc, b = bleed ? d.bleed : 0, s = dpi / 72;
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round((d.w + 2 * b) * s)); c.height = Math.max(1, Math.round((d.h + 2 * b) * s));
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.setTransform(s, 0, 0, s, b * s, b * s);
    ctx.beginPath(); ctx.rect(-b, -b, d.w + 2 * b, d.h + 2 * b); ctx.clip();
    for (const im of Object.values(S.images)) if (im.el && !im.el.complete) await im.el.decode().catch(() => { });
    Render.drawPage(ctx, { engine: S.eng, images: S.images, label: S.eng.label(i) }, d.pages[i], i);
    return c;
  }
  function exportImagesDialog(fmt) {
    UI.closeCellEditor?.(true); flushTyping(true);
    Aero.dialog({ title: `Export ${fmt.toUpperCase()}`, fields: [
      { key: 'range', label: 'Pages', type: 'select', value: 'current', options: [['current', 'Current page'], ['all', 'All pages (ZIP)'], ['custom', 'Range… (ZIP)']] }, { key: 'pages', label: 'Range (e.g. 1-3, 5)', type: 'text', value: `1-${S.doc.pages.length}` },
      { key: 'dpi', label: 'Resolution (ppi)', type: 'select', value: '150', options: [['72', '72 (screen)'], ['150', '150'], ['300', '300 (print)']] },
      { key: 'bleed', label: 'Include bleed', type: 'checkbox', value: false }, ...(fmt === 'jpeg' ? [{ key: 'q', label: 'Quality', type: 'range', min: 40, max: 100, value: 90 }] : [])],
      ok: 'Export', onOK: async v => {
        const pages = pageListFrom(v); if (!pages.length) return;
        Aero.busy('Rendering pages…');
        try {
          const mime = fmt === 'png' ? 'image/png' : 'image/jpeg', ext = fmt === 'png' ? 'png' : 'jpg';
          const files = [];
          for (const i of pages) { const c = await renderPageCanvas(i, +v.dpi, !!v.bleed); const blob = await new Promise(r => c.toBlob(r, mime, (v.q || 90) / 100)); files.push({ name: `${S.name}-p${String(i + 1).padStart(2, '0')}.${ext}`, data: new Uint8Array(await blob.arrayBuffer()) }); }
          Aero.busy();
          if (files.length === 1) { await Aero.saveFile({ name: files[0].name, data: files[0].data, filters: [{ name: fmt.toUpperCase(), extensions: [ext] }] }); }
          else await Aero.saveFile({ name: `${S.name}-pages.zip`, data: zip(files), filters: [{ name: 'ZIP archive', extensions: ['zip'] }] });
          Aero.toast(`Exported ${files.length} page image${files.length > 1 ? 's' : ''}`);
        } catch (e) { Aero.busy(); console.error(e); Aero.alert('Export', 'Export failed: ' + e.message); }
      } });
  }
  // minimal STORE zip writer
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = []; let off = 0;
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
      const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 0, true); h.setUint32(14, crc, true); h.setUint32(18, sz, true); h.setUint32(22, sz, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, f.data);
      const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, sz, true); c.setUint32(24, sz, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + sz;
    }
    const cs = central.reduce((a, b) => a + b.length, 0);
    const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)]; const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0)); let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }
  async function print(dry) {
    UI.closeCellEditor?.(true); flushTyping(true);
    Aero.busy('Preparing pages for printing…');
    const d = S.doc, host = document.getElementById('printroot') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'printroot' }));
    host.innerHTML = '';
    let st = document.getElementById('printpage'); if (!st) { st = document.createElement('style'); st.id = 'printpage'; document.head.appendChild(st); }
    st.textContent = `@page{size:${d.w}pt ${d.h}pt;margin:0}`;
    const urls = [];
    for (let i = 0; i < d.pages.length; i++) {
      const c = await renderPageCanvas(i, 220, false);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const u = URL.createObjectURL(blob); urls.push(u);
      const img = new Image(); img.src = u; img.style.width = d.w + 'pt'; img.style.height = d.h + 'pt'; host.appendChild(img);
      await img.decode().catch(() => { });
    }
    Aero.busy();
    if (dry) return { pages: host.children.length, css: st.textContent };
    const clean = () => { host.innerHTML = ''; urls.forEach(u => URL.revokeObjectURL(u)); removeEventListener('afterprint', clean); };
    addEventListener('afterprint', clean);
    window.print();
  }
  async function openSample() { if (!(await confirmDiscard())) return; Aero.busy('Building sample document…'); try { const { doc, images } = await Sample.build(); setDocument(doc, images, 'Horizon Magazine'); } finally { Aero.busy(); } }
  window.addEventListener('DOMContentLoaded', trackDrop);
  return { confirmDiscard, save, open, openBytes, place, placeFile, dropFiles, exportPdfDialog, exportImagesDialog, renderPageCanvas, zip, crc32, print, openSample, defaultStyles };
})();
