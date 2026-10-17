'use strict';
/* Lumen Vector — File ▸ Export for Screens: every artboard (or every selected object as an asset) in several
   formats and scales at once (PNG 0.5×–4×, JPEG, SVG, PDF), packed into one ZIP (or saved directly when it is a
   single file). The ZIP writer is a small "stored" (uncompressed) implementation — PNG/JPEG/PDF are already compressed. */
(function () {
  const AS = LV.assets = {};

  /* ---------- tiny ZIP writer (store method, UTF-8 names) ---------- */
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  AS.crc32 = u => { let c = 0xffffffff; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  AS.zip = files => {
    const enc = new TextEncoder(), now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const parts = [], central = []; let off = 0;
    files.forEach(f => {
      const name = enc.encode(f.name), data = f.data, crc = AS.crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, dosTime, true); c.setUint16(14, dosDate, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      parts.push(new Uint8Array(h.buffer), name, data); central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    });
    const cdSize = central.reduce((s, u) => s + u.length, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((s, u) => s + u.length, 0));
    let p = 0; all.forEach(u => { out.set(u, p); p += u.length; }); return out;
  };

  /* ---------- rendering one region ---------- */
  const safe = s => String(s || 'asset').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'asset';
  const blobBytes = async b => new Uint8Array(await b.arrayBuffer());
  // Run fn with every top-level object except `keep` hidden (so an asset export contains only that object)
  async function isolate(keep, fn) {
    const off = [];
    if (keep) P.project.layers.forEach(L => L.children.forEach(o => { if (o !== keep && o.visible) { o.visible = false; off.push(o); } }));
    try { return await fn(); } finally { off.forEach(o => { o.visible = true; }); }
  }
  // temporary artboard for a selected object so the regular PNG / SVG / PDF exporters can be reused
  async function withBoard(rect, fn) {
    const ab = { id: '__asset', name: 'asset', x: rect.x, y: rect.y, w: Math.max(1, rect.width), h: Math.max(1, rect.height) };
    LV.doc.artboards.push(ab); const i = LV.doc.artboards.length - 1;
    try { return await fn(i); } finally { const k = LV.doc.artboards.indexOf(ab); if (k >= 0) LV.doc.artboards.splice(k, 1); }
  }
  const jpegFromPng = async (pngBlob, q) => { const bmp = await createImageBitmap(pngBlob); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(bmp, 0, 0); return await new Promise(r => c.toBlob(r, 'image/jpeg', q)); };
  async function render(i, name, o, out) {
    for (const s of o.scales) {
      const png = await LV.exportPNGBlob(i, s, o.transparent);
      out.push({ name: `${name}${s === 1 ? '' : '@' + s + 'x'}.png`, data: await blobBytes(png) });
    }
    if (o.jpg) out.push({ name: `${name}.jpg`, data: await blobBytes(await jpegFromPng(await LV.exportPNGBlob(i, 1, false), 0.9)) });
    if (o.svg) out.push({ name: `${name}.svg`, data: new TextEncoder().encode(await LV.exportSVGString(i, { outline: o.outline, embedFonts: true })) });
    if (o.pdf) out.push({ name: `${name}.pdf`, data: new Uint8Array(await LV.exportPDFBytes([i])) });
  }
  const uniq = () => { const used = new Map(); return n => { const k = n.toLowerCase(); const c = used.get(k) || 0; used.set(k, c + 1); return c ? `${n}-${c + 1}` : n; }; };
  // o: { what:'boards'|'active'|'selection', scales:[…], jpg, svg, pdf, transparent, outline, prefix }
  AS.build = async o => {
    const out = [], name = uniq(), pre = o.prefix ? safe(o.prefix) + '-' : '';
    if (o.what === 'selection') {
      const items = LV.sortZ(LV.sel).filter(it => it.visible); if (!items.length) throw new Error('Select the objects to export as assets.');
      let n = 0;
      for (const it of items) {
        n++; const r = it.strokeBounds.expand(2 * (LV.fx.margin(LV.fx.get(it)) || 0)), rect = new P.Rectangle(Math.floor(r.x), Math.floor(r.y), Math.ceil(r.right) - Math.floor(r.x), Math.ceil(r.bottom) - Math.floor(r.y));
        await isolate(it, () => withBoard(rect, i => render(i, pre + name(safe(it.name || `Asset ${n}`)), o, out)));
      }
    } else {
      const list = o.what === 'active' ? [LV.doc.active] : LV.doc.artboards.map((_, i) => i);
      for (const i of list) await render(i, pre + name(safe(LV.doc.artboards[i].name)), o, out);
    }
    return out;
  };

  AS.dialog = () => {
    const S = AS.last || { what: 'boards', s05: false, s1: true, s2: true, s3: false, s4: false, jpg: false, svg: true, pdf: false, transparent: true, outline: false, prefix: '' };
    Aero.dialog({
      title: 'Export for Screens', width: 440, instruction: 'Exports several formats and sizes at once into one ZIP archive.',
      fields: [{ key: 'what', label: 'Export', type: 'select', value: LV.sel.length && S.what === 'selection' ? 'selection' : S.what === 'selection' ? 'boards' : S.what, options: [['boards', `All artboards (${LV.doc.artboards.length})`], ['active', 'Active artboard only'], ...(LV.sel.length ? [['selection', `Selected objects as assets (${LV.sel.length})`]] : [])] },
        { key: 's05', label: 'PNG 0.5×', type: 'checkbox', value: S.s05 }, { key: 's1', label: 'PNG 1×', type: 'checkbox', value: S.s1 }, { key: 's2', label: 'PNG 2×', type: 'checkbox', value: S.s2 }, { key: 's3', label: 'PNG 3×', type: 'checkbox', value: S.s3 }, { key: 's4', label: 'PNG 4×', type: 'checkbox', value: S.s4 },
        { key: 'transparent', label: 'Transparent PNG background', type: 'checkbox', value: S.transparent },
        { key: 'jpg', label: 'JPEG (1×, quality 90)', type: 'checkbox', value: S.jpg }, { key: 'svg', label: 'SVG', type: 'checkbox', value: S.svg }, { key: 'outline', label: 'SVG text as outlines', type: 'checkbox', value: S.outline }, { key: 'pdf', label: 'PDF', type: 'checkbox', value: S.pdf },
        { key: 'prefix', label: 'File name prefix', type: 'text', value: S.prefix }],
      onOK: async v => {
        AS.last = v;
        const o = { what: v.what, scales: [['s05', 0.5], ['s1', 1], ['s2', 2], ['s3', 3], ['s4', 4]].filter(([k]) => v[k]).map(x => x[1]), jpg: v.jpg, svg: v.svg, pdf: v.pdf, transparent: v.transparent, outline: v.outline, prefix: v.prefix };
        if (!o.scales.length && !o.jpg && !o.svg && !o.pdf) return Aero.alert('Export for Screens', 'Choose at least one format.');
        Aero.busy('Exporting assets…');
        try {
          const files = await AS.build(o), base = Aero.baseName(LV.doc.name || 'Untitled');
          if (files.length === 1) await Aero.saveFile({ name: files[0].name, data: files[0].data, filters: [{ name: 'Export', extensions: [files[0].name.split('.').pop()] }] });
          else { await Aero.saveFile({ name: `${safe(base)}-assets.zip`, data: AS.zip(files), filters: [{ name: 'ZIP archive', extensions: ['zip'] }] }); LV.toast(`Exported ${files.length} files`); }
        } catch (e) { console.error(e); Aero.alert('Export failed', e.message || String(e)); } finally { Aero.busy(); }
      }
    });
  };
})();
