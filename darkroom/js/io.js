'use strict';
/* Lumen Darkroom — export (JPEG/PNG/WebP, ZIP) and the .ldarkroom catalog backup format.
   .ldarkroom = ZIP container: manifest.json (catalog records, JSON) + files/<fileId> (original bytes)
                + previews/{small,proxy,thumb}/<id>.jpg (cached previews so a restore is instant). */
const IO = (() => {
  let backupPath = null, backupName = 'Darkroom Catalog';
  const FMT = { jpeg: ['image/jpeg', 'jpg'], png: ['image/png', 'png'], webp: ['image/webp', 'webp'] };
  const SHARP = { none: 0, low: 15, standard: 30, high: 50 };
  let lastOpts = { fmt: 'jpeg', quality: 88, resize: true, long: 2048, sharpen: 'standard', template: '{name}', pack: 'zip' };

  function fileName(tpl, p, i) {
    const d = new Date(p.exif.date || p.added), pad = n => String(n).padStart(2, '0');
    const base = p.name.replace(/\.[^.]+$/, '');
    let s = String(tpl || '{name}')
      .replace(/\{name\}/g, base).replace(/\{seq\}/g, String(i + 1).padStart(3, '0'))
      .replace(/\{date\}/g, `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
      .replace(/\{rating\}/g, String(p.rating)).replace(/\{camera\}/g, (p.exif.model || 'camera'))
      .replace(/\{copy\}/g, p.copyName ? '-' + p.copyName.replace(/\s+/g, '') : '');
    s = s.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^\.+/, '').trim().slice(0, 120);
    return s || 'photo';
  }

  // render one photo at export resolution → Blob
  async function renderExport(p, o) {
    const img = await Cat.fullImage(p), key = 'x:' + p.fileId + ':' + Aero.uid();
    Engine.setSource(key, img);
    try {
      const sz = Engine.sourceSize(key), cs = Engine.cropSize(sz.w, sz.h, p.settings.crop);
      // the texture may have been downscaled to MAX_TEXTURE_SIZE; scale back to the true size
      const trueScale = img.width / sz.w;
      let w = cs.w * trueScale, h = cs.h * trueScale;
      const s = o.resize ? Math.min(1, o.long / Math.max(w, h)) : 1;
      w = Math.max(1, Math.round(w * s)); h = Math.max(1, Math.round(h * s));
      const lim = Engine.maxTex; if (Math.max(w, h) > lim) { const k = lim / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
      const c = Decode.mkCanvas(w, h), cx = c.getContext('2d');
      const extra = SHARP[o.sharpen] || 0;
      if (w * h <= 2048 * 2048) { Engine.render(key, p.settings, { outW: w, outH: h, slot: 'x', extraSharpen: extra }); cx.putImageData(Engine.readOut('x'), 0, 0); }
      else {
        // tiled rendering keeps GPU memory bounded; tiles overlap by more than the largest blur radius
        const T = 2048, pad = Math.ceil(.055 * Math.max(w, h));
        for (let y0 = 0; y0 < h; y0 += T) for (let x0 = 0; x0 < w; x0 += T) {
          const x1 = Math.min(w, x0 + T), y1 = Math.min(h, y0 + T);
          const px0 = Math.max(0, x0 - pad), py0 = Math.max(0, y0 - pad), px1 = Math.min(w, x1 + pad), py1 = Math.min(h, y1 + pad);
          Engine.render(key, p.settings, { outW: px1 - px0, outH: py1 - py0, view: { x: px0 / w, y: py0 / h, w: (px1 - px0) / w, h: (py1 - py0) / h }, slot: 'x', extraSharpen: extra });
          cx.putImageData(Engine.readOut('x'), px0, py0, x0 - px0, y0 - py0, x1 - x0, y1 - y0);
          Engine.freeBig();
          await new Promise(r => setTimeout(r, 0));
        }
      }
      const [mime] = FMT[o.fmt];
      return await Decode.toBlob(c, mime, mime === 'image/png' ? undefined : o.quality / 100);
    } finally { Engine.dropSource(key); Engine.freeBig(); }
  }

  async function runExport(ids, o) {
    const photos = ids.map(id => Cat.photos.get(id)).filter(Boolean); if (!photos.length) return;
    const ext = FMT[o.fmt][1], used = new Set(), out = [];
    try {
      for (let i = 0; i < photos.length; i++) {
        Aero.busy(`Exporting ${i + 1} / ${photos.length} — ${Cat.displayName(photos[i])}`);
        const blob = await renderExport(photos[i], o);
        let n = fileName(o.template, photos[i], i), name = `${n}.${ext}`, k = 2;
        while (used.has(name.toLowerCase())) name = `${n}-${k++}.${ext}`;
        used.add(name.toLowerCase()); out.push({ name, blob });
        await new Promise(r => setTimeout(r, 0));
      }
      if (out.length === 1) { Aero.busy(); const r = await Aero.saveFile({ name: out[0].name, data: out[0].blob, filters: [{ name: o.fmt.toUpperCase(), extensions: [ext] }] }); if (r) Aero.toast('Exported ' + out[0].name); return out; }
      if (o.pack === 'zip') {
        Aero.busy('Packing ZIP…');
        const entries = {}; for (const f of out) entries[f.name] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
        const zip = fflate.zipSync(entries);
        Aero.busy();
        const r = await Aero.saveFile({ name: `Darkroom export (${out.length} photos).zip`, data: zip, filters: [{ name: 'ZIP archive', extensions: ['zip'] }] });
        if (r) Aero.toast(`Exported ${out.length} photos as ZIP`);
      } else {
        Aero.busy(); let saved = 0;
        for (const f of out) { if (await Aero.saveFile({ name: f.name, data: f.blob, filters: [{ name: o.fmt.toUpperCase(), extensions: [ext] }] })) saved++; else if (Aero.isDesktop) break; }
        Aero.toast(`Exported ${saved} photo${saved === 1 ? '' : 's'}`);
      }
      return out;
    } catch (e) { console.error(e); Aero.alert('Export failed', e.message); }
    finally { Aero.busy(); }
  }

  function exportDialog() {
    const ids = selectedIds(); if (!ids.length) return Aero.toast('Select photos to export');
    const o = lastOpts;
    Aero.dialog({
      title: `Export ${ids.length} Photo${ids.length > 1 ? 's' : ''}`, ok: 'Export', width: 470,
      instruction: ids.length > 1 ? `Export ${ids.length} selected photos with their develop settings.` : `Export “${Cat.displayName(Cat.photos.get(ids[0]))}” with its develop settings.`,
      fields: [
        { key: 'fmt', label: 'Format', type: 'select', value: o.fmt, options: [['jpeg', 'JPEG'], ['png', 'PNG (lossless)'], ['webp', 'WebP']] },
        { key: 'quality', label: 'Quality', type: 'range', min: 10, max: 100, step: 1, value: o.quality, fmt: v => v + '%' },
        { key: 'resize', label: 'Resize to fit', type: 'checkbox', value: o.resize },
        { key: 'long', label: 'Long edge (px)', type: 'number', min: 64, max: 16384, step: 1, value: o.long },
        { key: 'sharpen', label: 'Sharpen for screen', type: 'select', value: o.sharpen, options: [['none', 'None'], ['low', 'Low'], ['standard', 'Standard'], ['high', 'High']] },
        { key: 'template', label: 'File name', type: 'text', value: o.template },
        ...(ids.length > 1 ? [{ key: 'pack', label: 'Save as', type: 'select', value: o.pack, options: [['zip', 'One ZIP archive'], ['files', Aero.isDesktop ? 'Individual files (a save dialog per photo)' : 'Individual downloads']] }] : [])
      ],
      html: '<p class="dnote">File name tokens: {name} {seq} {date} {rating} {camera} {copy}. Exports render from the original file at full resolution (camera RAW is re-developed at full size).</p>',
      onOK: v => { lastOpts = { ...o, ...v, long: Math.max(64, Math.min(16384, Math.round(+v.long || 2048))), pack: v.pack || o.pack }; runExport(ids, lastOpts); }
    });
  }
  function exportPrevious() { const ids = selectedIds(); if (!ids.length) return Aero.toast('Select photos to export'); runExport(ids, lastOpts); }

  /* ---------- catalog backup (.ldarkroom) ---------- */
  async function buildBackup() {
    await DB.flush();
    const photos = [...Cat.photos.values()];
    const manifest = { app: 'lumen-darkroom', version: 1, created: Date.now(), photos, collections: Cat.collections, presets: Cat.userPresets };
    const entries = { 'manifest.json': [new TextEncoder().encode(JSON.stringify(manifest)), { level: 6 }] };
    const fileIds = [...new Set(photos.map(p => p.fileId))];
    for (let i = 0; i < fileIds.length; i++) {
      Aero.busy(`Packing originals ${i + 1} / ${fileIds.length}…`);
      const fid = fileIds[i], f = await DB.get('files', fid);
      if (f) entries['files/' + fid] = [new Uint8Array(f.bytes), { level: 0 }];
      for (const kind of ['small', 'proxy']) { const b = await DB.getBlob(kind + ':' + fid); if (b) entries[`previews/${kind}/${fid}.jpg`] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }]; }
    }
    for (const p of photos) { const b = await DB.getBlob('thumb:' + p.id); if (b) entries[`previews/thumb/${p.id}.jpg`] = [new Uint8Array(await b.arrayBuffer()), { level: 0 }]; }
    Aero.busy('Writing backup…');
    return fflate.zipSync(entries);
  }
  async function saveBackup(as) {
    if (!Cat.photos.size) { Aero.toast('The catalog is empty — nothing to back up'); return false; }
    try {
      const data = await buildBackup(); Aero.busy();
      const r = await Aero.saveFile({ name: backupName + '.ldarkroom', data, filters: [{ name: 'Darkroom Catalog', extensions: ['ldarkroom'] }], path: as ? undefined : backupPath || undefined });
      if (!r) return false;
      if (Aero.isDesktop) backupPath = r;
      backupName = Aero.baseName(r); Aero.setDoc(backupName, DB.isPending());
      Aero.toast(`Catalog backup saved (${Cat.photos.size} photos, ${Decode.fmtSize(data.byteLength)})`); return true;
    } catch (e) { console.error(e); Aero.alert('Backup failed', e.message); return false; }
    finally { Aero.busy(); }
  }
  async function openBackup() {
    const f = await Aero.openFile({ accept: '.ldarkroom', filters: [{ name: 'Darkroom Catalog', extensions: ['ldarkroom'] }] });
    if (f[0]) { if (f[0].path) backupPath = f[0].path; return loadBackup(f[0].data, f[0].name); }
  }
  async function loadBackup(buf, name) {
    let files;
    try { files = fflate.unzipSync(new Uint8Array(buf)); } catch (e) { return Aero.alert('Cannot open backup', 'This is not a valid .ldarkroom file.'); }
    let man;
    try { man = JSON.parse(new TextDecoder().decode(files['manifest.json'] || new Uint8Array())); } catch (e) { man = null; }
    if (!man || man.app !== 'lumen-darkroom' || !Array.isArray(man.photos)) return Aero.alert('Cannot open backup', 'The file has no Lumen Darkroom catalog manifest.');
    if (man.version > 1) Aero.toast('This backup was made by a newer version; some settings may be ignored');
    const photos = man.photos.slice(0, 100000).map(Model.sanitizePhoto).filter(p => p && files['files/' + p.fileId]);
    const dropped = man.photos.length - photos.length;
    let mode = 'replace';
    if (Cat.photos.size) {
      mode = await new Promise(res => Aero.dialog({ title: 'Open Catalog Backup', instruction: `“${name}” contains ${photos.length} photo${photos.length === 1 ? '' : 's'}.`,
        fields: [{ key: 'm', label: 'Open as', type: 'select', value: 'merge', options: [['merge', 'Merge into the current catalog'], ['replace', 'Replace the current catalog']] }], ok: 'Open', onOK: v => res(v.m), onCancel: () => res(null) }));
      if (!mode) return;
      if (mode === 'replace' && !await Aero.confirm('Replace Catalog', `Replace the current catalog (${Cat.photos.size} photos) with the backup? This cannot be undone.`, 'Replace')) return;
    }
    Aero.busy('Restoring catalog…');
    try {
      if (mode === 'replace') await Cat.clear();
      const existing = new Set(Cat.photos.keys()), existingFiles = new Set([...Cat.photos.values()].map(p => p.fileId));
      let n = 0;
      for (const p of photos) {
        if (existing.has(p.id)) continue;
        if (!existingFiles.has(p.fileId)) {
          const b = files['files/' + p.fileId]; await DB.put('files', { id: p.fileId, bytes: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), name: p.name });
          for (const kind of ['small', 'proxy']) { const x = files[`previews/${kind}/${p.fileId}.jpg`]; if (x) await DB.putBlob(kind + ':' + p.fileId, new Blob([x], { type: 'image/jpeg' })); }
          existingFiles.add(p.fileId);
        }
        const t = files[`previews/thumb/${p.id}.jpg`]; if (t) await DB.putBlob('thumb:' + p.id, new Blob([t], { type: 'image/jpeg' }));
        await DB.put('photos', p); n++;
        if (n % 20 === 0) Aero.busy(`Restoring catalog… ${n} / ${photos.length}`);
      }
      const ids = new Set(photos.map(p => p.id));
      const colls = (Array.isArray(man.collections) ? man.collections : []).map(Model.sanitizeCollection).filter(Boolean).map(c => ({ ...c, ids: c.ids.filter(id => ids.has(id) || Cat.photos.has(id)) }));
      const existingColl = new Set(Cat.collections.map(c => c.id));
      await DB.putMany('collections', colls.filter(c => !existingColl.has(c.id)));
      const prs = (Array.isArray(man.presets) ? man.presets : []).map(Model.sanitizePreset).filter(Boolean);
      const existingPr = new Set(Cat.userPresets.map(p => p.id));
      await DB.putMany('presets', prs.filter(p => !existingPr.has(p.id)));
      await Cat.load();
      backupName = Aero.baseName(name); Aero.setDoc(backupName, false);
      S.source = { type: 'all' }; S.sel.clear(); S.active = null; refreshList(false); renderLeft();
      Aero.busy();
      Aero.toast(`Opened ${n} photo${n === 1 ? '' : 's'} from ${name}` + (dropped ? ` (${dropped} unreadable entr${dropped === 1 ? 'y' : 'ies'} skipped)` : ''));
    } catch (e) { console.error(e); Aero.busy(); Aero.alert('Restore failed', e.message); }
  }
  async function newCatalog() {
    if (Cat.photos.size && !await Aero.confirm('New Catalog', `Start a new, empty catalog? The current catalog (${Cat.photos.size} photos) will be deleted from this browser. Save a backup first (File ▸ Save Catalog Backup) if you want to keep it.`, 'Delete and start new')) return;
    await Cat.clear(); backupPath = null; backupName = 'Darkroom Catalog'; Aero.setDoc('Catalog', false);
    S.source = { type: 'all' }; S.sel.clear(); S.active = null; if (S.module !== 'library') setModule('library'); refreshList(false); renderLeft();
  }

  return { exportDialog, exportPrevious, runExport, renderExport, saveBackup, buildBackup, openBackup, loadBackup, newCatalog, fileName, get lastOpts() { return lastOpts; } };
})();
