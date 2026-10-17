'use strict';
/* Lumen Darkroom — catalog: photo records, import, previews, metadata ops, library undo stack */
const Cat = (() => {
  const photos = new Map();          // id → record
  let collections = [], userPresets = [];
  const thumbURL = new Map();        // photo id → object URL of rendered thumbnail
  const listeners = new Set();
  const emit = (what, data) => listeners.forEach(fn => { try { fn(what, data); } catch (e) { console.error(e); } });
  let seq = 0;

  /* ---------- load ---------- */
  async function load() {
    await DB.open();
    const [ps, cs, prs] = await Promise.all([DB.getAll('photos'), DB.getAll('collections'), DB.getAll('presets')]);
    photos.clear(); thumbURL.forEach(u => URL.revokeObjectURL(u)); thumbURL.clear();
    ps.map(Model.sanitizePhoto).filter(Boolean).forEach(p => { photos.set(p.id, p); seq = Math.max(seq, p.seq); });
    collections = cs.map(Model.sanitizeCollection).filter(Boolean).sort((a, b) => a.created - b.created);
    userPresets = prs.map(Model.sanitizePreset).filter(Boolean);
    thumbPending.clear(); thumbMissing.clear();   // thumbnails are loaded lazily, when a cell becomes visible (see thumb())
    emit('load');
  }

  /* ---------- in-memory image caches ---------- */
  const lru = (max) => { const m = new Map(); return { get(k) { const v = m.get(k); if (v) { m.delete(k); m.set(k, v); } return v; }, set(k, v) { m.delete(k); m.set(k, v); while (m.size > max) { const [k0, v0] = m.entries().next().value; m.delete(k0); } }, delete(k) { m.delete(k); }, clear() { m.clear(); } }; };
  const workCache = lru(3), smallCache = lru(40);
  const inflight = new Map();
  function once(key, fn) { if (inflight.has(key)) return inflight.get(key); const p = fn().finally(() => inflight.delete(key)); inflight.set(key, p); return p; }

  async function fileBytes(fileId) { const f = await DB.get('files', fileId); if (!f) throw new Error('original file missing from catalog'); return f.bytes; }
  // develop-resolution image (original for browser formats, cached proxy for RAW)
  function workImage(p) {
    const k = p.fileId, hit = workCache.get(k); if (hit) return Promise.resolve(hit);
    return once('w:' + k, async () => {
      let img;
      if (p.raw) { const b = await DB.getBlob('proxy:' + k); if (b) img = await createImageBitmap(b); }
      if (!img) { const d = await Decode.decode(await fileBytes(k), p.name, { half: p.raw }); img = d.img; }
      workCache.set(k, img); return img;
    });
  }
  function smallImage(p) {
    const k = p.fileId, hit = smallCache.get(k); if (hit) return Promise.resolve(hit);
    return once('s:' + k, async () => {
      let b = await DB.getBlob('small:' + k), img;
      if (b) img = await createImageBitmap(b);
      else { img = await Decode.fit(await workImage(p), 640); await DB.putBlob('small:' + k, await Decode.toBlob(img, 'image/jpeg', .9)); }
      smallCache.set(k, img); return img;
    });
  }
  // full resolution for export
  async function fullImage(p) {
    if (!p.raw) return workImage(p);
    const d = await Decode.decode(await fileBytes(p.fileId), p.name, { half: false });
    return d.img;
  }

  /* ---------- lazy thumbnail loading: visible cells ask for their thumbnail; requests are batched ---------- */
  const thumbPending = new Set(), thumbMissing = new Set(); let thumbBatch = null;
  function thumb(id) {
    const u = thumbURL.get(id); if (u) return u;
    if (!thumbPending.has(id) && !thumbMissing.has(id) && photos.has(id)) {
      thumbPending.add(id);
      if (!thumbBatch) { thumbBatch = new Set(); queueMicrotask(flushThumbBatch); }
      thumbBatch.add(id);
    }
    return null;
  }
  async function flushThumbBatch() {
    const ids = [...thumbBatch]; thumbBatch = null;
    try {
      const m = await DB.getBlobs(ids.map(id => 'thumb:' + id));
      ids.forEach(id => { thumbPending.delete(id); const b = m.get('thumb:' + id); if (!photos.has(id)) return; if (b) { if (!thumbURL.has(id)) thumbURL.set(id, URL.createObjectURL(b)); emit('thumb', id); } else { thumbMissing.add(id); queueThumb(id); } });
    } catch (e) { ids.forEach(id => thumbPending.delete(id)); console.warn('thumbnail load failed', e); }
  }

  /* ---------- thumbnails (rendered through the develop engine) ---------- */
  const thumbQ = new Set(); let thumbBusy = false, thumbTimer = null;
  function queueThumb(id, delay = 60) { thumbQ.add(id); clearTimeout(thumbTimer); thumbTimer = setTimeout(pumpThumbs, delay); }
  async function pumpThumbs() {
    if (thumbBusy) return; thumbBusy = true;
    try {
      while (thumbQ.size) {
        // visible cells first (the library sets thumbPriority), then oldest request
        let id = null; if (api.thumbPriority) { for (const q of thumbQ) if (api.thumbPriority(q)) { id = q; break; } }
        if (id == null) id = thumbQ.values().next().value; thumbQ.delete(id);
        const p = photos.get(id); if (!p) continue;
        try { await renderThumb(p); } catch (e) { console.warn('thumb failed', p.name, e); }
        await new Promise(r => setTimeout(r, 0));
      }
    } finally { thumbBusy = false; }
  }
  async function renderPreviewCanvas(p, settings, maxEdge) {
    const img = await smallImage(p), key = 'small:' + p.fileId;
    const st = settings || p.settings;
    if (Masks.needsRef(st)) await Masks.ensureRef(p);
    if (!Engine.hasSource(key)) Engine.setSource(key, img);
    const cs = Engine.cropSize(img.width, img.height, st.crop);
    const s = maxEdge / Math.max(cs.w, cs.h);
    Engine.render(key, st, { outW: cs.w * s, outH: cs.h * s, slot: 't' });
    const data = Engine.readOut('t'), c = Decode.mkCanvas(data.width, data.height); c.getContext('2d').putImageData(data, 0, 0);
    return c;
  }
  async function renderThumb(p) {
    const c = await renderPreviewCanvas(p, null, 420);
    const blob = await Decode.toBlob(c, 'image/jpeg', .86);
    await DB.putBlob('thumb:' + p.id, blob);
    const old = thumbURL.get(p.id); thumbURL.set(p.id, URL.createObjectURL(blob)); thumbMissing.delete(p.id); if (old) setTimeout(() => URL.revokeObjectURL(old), 3000);
    emit('thumb', p.id);
  }

  /* ---------- import ---------- */
  async function importFiles(files, opts = {}) {
    let imgs = files.filter(f => Decode.isImage(f.name));
    const skipped = files.length - imgs.length;
    // skip suspected duplicates (same file name and size already in the catalog)
    const have = new Set([...photos.values()].filter(p => !p.copyName).map(p => p.name.toLowerCase() + '|' + p.size));
    const metaFor = new Map(imgs.map((f, i) => [f, opts.meta?.[files.indexOf(f)] ?? opts.meta?.[i]]));
    const dupes = imgs.filter(f => have.has(f.name.toLowerCase() + '|' + f.data.byteLength));
    if (dupes.length && !opts.allowDupes) imgs = imgs.filter(f => !dupes.includes(f));
    if (!imgs.length && dupes.length) { Aero.toast(`${dupes.length} photo${dupes.length > 1 ? 's are' : ' is'} already in the catalog`); return []; }
    if (!imgs.length) { if (skipped) Aero.toast('No supported photos in the selection'); return []; }
    const importId = Aero.uid(), added = [], errors = [];
    for (let i = 0; i < imgs.length; i++) {
      Aero.busy(`Importing ${i + 1} / ${imgs.length} — ${imgs[i].name}`);
      try { added.push(await importOne(imgs[i], importId, metaFor.get(imgs[i]))); }
      catch (e) { console.info('import failed:', imgs[i].name, e.message); errors.push(imgs[i].name + ': ' + e.message); }
    }
    Aero.busy();
    if (added.length) {
      pushUndo({ label: `Import ${added.length} photo${added.length > 1 ? 's' : ''}`, undo: () => removeRaw(added.map(p => p.id)), redo: () => restoreRaw(added.map(p => p.id)), keep: { ids: added.map(p => p.id) } });
      emit('import', { ids: added.map(p => p.id), importId });
    }
    if (errors.length) Aero.alert('Some files could not be imported', errors.slice(0, 8).join('\n') + (errors.length > 8 ? `\n…and ${errors.length - 8} more` : ''));
    else if (!opts.quiet) Aero.toast(`Imported ${added.length} photo${added.length === 1 ? '' : 's'}` + (skipped ? ` · ${skipped} unsupported file${skipped > 1 ? 's' : ''} skipped` : '') + (dupes.length && !opts.allowDupes ? ` · ${dupes.length} duplicate${dupes.length > 1 ? 's' : ''} skipped` : ''));
    return added;
  }
  async function importOne(f, importId, meta) {
    const bytes = f.data, raw = Decode.isRaw(f.name);
    const d = await Decode.decode(bytes, f.name, { half: raw });
    const exif = await Decode.readExif(bytes, f.name, d.meta);
    const id = Aero.uid() + Aero.uid().slice(0, 4), fileId = id;
    if (raw) await DB.putBlob('proxy:' + fileId, await Decode.toBlob(await Decode.fit(d.img, 4096), 'image/jpeg', .95));
    const small = await Decode.fit(d.img, 640);
    await DB.putBlob('small:' + fileId, await Decode.toBlob(small, 'image/jpeg', .9));
    await DB.put('files', { id: fileId, bytes, name: f.name });
    const now = Date.now();
    const p = Model.sanitizePhoto({
      id, fileId, name: f.name, ext: Decode.extOf(f.name), mime: raw ? 'image/x-raw' : (Decode.MIME[Decode.extOf(f.name)] || ''), size: bytes.byteLength,
      w: raw && d.meta?.width ? d.meta.width : d.w * (raw && !d.note ? 2 : 1), h: raw && d.meta?.height ? d.meta.height : d.h * (raw && !d.note ? 2 : 1),
      raw, added: now, seq: ++seq, importId, exif, ...(meta || {}), id, fileId
    });
    if (meta?.settings) { p.history = [{ label: 'Import', s: Model.defaults(), t: now }, { label: meta.historyLabel || 'Preset', s: Model.clone(p.settings), t: now }]; p.hi = 1; p.edited = now; }
    photos.set(id, p); smallCache.set(fileId, await createImageBitmap(small));
    if (!raw) workCache.set(fileId, d.img);
    await DB.put('photos', p);
    await renderThumb(p);
    return p;
  }

  /* ---------- library undo stack ---------- */
  const undoStack = [], redoStack = [];
  function pushUndo(a) { undoStack.push(a); if (undoStack.length > 100) undoStack.shift(); redoStack.length = 0; emit('undo'); }
  async function undo() { const a = undoStack.pop(); if (!a) return false; await a.undo(); redoStack.push(a); emit('undo'); Aero.toast('Undo ' + a.label); return true; }
  async function redo() { const a = redoStack.pop(); if (!a) return false; await a.redo(); undoStack.push(a); emit('undo'); Aero.toast('Redo ' + a.label); return true; }
  const canUndo = () => undoStack.length > 0, canRedo = () => redoStack.length > 0;
  const undoLabel = () => undoStack[undoStack.length - 1]?.label, redoLabel = () => redoStack[redoStack.length - 1]?.label;

  /* ---------- metadata ---------- */
  const META = ['rating', 'flag', 'label', 'keywords'];
  function changeMeta(ids, label, fn) {
    ids = ids.filter(id => photos.has(id)); if (!ids.length) return;
    const before = ids.map(id => { const p = photos.get(id); return [id, Object.fromEntries(META.map(k => [k, Model.clone(p[k])]))]; });
    ids.forEach(id => fn(photos.get(id)));
    const after = ids.map(id => { const p = photos.get(id); return [id, Object.fromEntries(META.map(k => [k, Model.clone(p[k])]))]; });
    const apply = snap => { snap.forEach(([id, m]) => { const p = photos.get(id); if (p) { Object.assign(p, Model.clone(m)); DB.savePhoto(p); } }); emit('meta', snap.map(s => s[0])); };
    ids.forEach(id => DB.savePhoto(photos.get(id)));
    pushUndo({ label, undo: () => apply(before), redo: () => apply(after) });
    emit('meta', ids);
  }

  /* ---------- develop settings (per-photo edit history) ---------- */
  function setSettings(p, s, label, { record = true } = {}) {
    s = Model.sanitizeSettings(s);
    const prev = p.settings; p.settings = s;
    if (record) {
      label = label || Model.diffLabel(prev, s); if (!label) { emit('settings', p.id); return; }
      p.history = p.history.slice(0, p.hi + 1); p.history.push({ label, s: Model.clone(s), t: Date.now() });
      if (p.history.length > 100) p.history.shift();
      p.hi = p.history.length - 1;
    }
    p.edited = Model.isDefault(s) ? 0 : Date.now();
    DB.savePhoto(p); queueThumb(p.id, 350); emit('settings', p.id);
  }
  function historyGo(p, i) {
    if (i < 0 || i >= p.history.length) return false;
    p.hi = i; p.settings = Model.clone(p.history[i].s); p.edited = Model.isDefault(p.settings) ? 0 : Date.now();
    DB.savePhoto(p); queueThumb(p.id, 200); emit('settings', p.id); emit('history', p.id); return true;
  }
  // apply settings to several photos as one library undo step
  function applyToMany(ids, fn, label) {
    const before = [];
    ids.forEach(id => { const p = photos.get(id); if (!p) return; before.push([id, p.hi, p.history.length]); setSettings(p, fn(p), label); });
    pushUndo({ label: `${label} (${before.length})`,
      undo: () => before.forEach(([id, hi]) => { const p = photos.get(id); if (p) historyGo(p, Math.min(hi, p.history.length - 1)); }),
      redo: () => before.forEach(([id]) => { const p = photos.get(id); if (p) historyGo(p, p.history.length - 1); }) });
  }

  /* ---------- snapshots (named develop states, per photo; undoable as catalog steps) ---------- */
  const topUndo = () => undoStack[undoStack.length - 1], topRedo = () => redoStack[redoStack.length - 1];
  function snapOp(p, label, fn) {
    const before = Model.clone(p.snapshots || []); fn(); const after = Model.clone(p.snapshots);
    const set = v => { const q = photos.get(p.id); if (!q) return; q.snapshots = Model.clone(v); DB.savePhoto(q); emit('snapshots', q.id); };
    DB.savePhoto(p); emit('snapshots', p.id);
    pushUndo({ label, snap: p.id, t: Date.now(), undo: () => set(before), redo: () => set(after) });
  }
  function addSnapshot(p, name, settings) {
    if ((p.snapshots || []).length >= Model.MAX_SNAPS) { Aero.toast(`A photo can have at most ${Model.MAX_SNAPS} snapshots`); return null; }
    const sn = Model.sanitizeSnapshot({ id: Aero.uid(), name, s: settings || p.settings, t: Date.now() });
    snapOp(p, 'New snapshot', () => { p.snapshots = [...(p.snapshots || []), sn]; }); return sn;
  }
  function renameSnapshot(p, id, name) { snapOp(p, 'Rename snapshot', () => { const n = p.snapshots.find(x => x.id === id); if (n) n.name = (String(name).trim().slice(0, 80)) || n.name; }); }
  function updateSnapshot(p, id) { snapOp(p, 'Update snapshot', () => { const n = p.snapshots.find(x => x.id === id); if (n) { n.s = Model.clone(p.settings); n.t = Date.now(); } }); }
  function deleteSnapshot(p, id) { snapOp(p, 'Delete snapshot', () => { p.snapshots = p.snapshots.filter(x => x.id !== id); }); }

  /* ---------- virtual copies ---------- */
  async function virtualCopy(ids) {
    const made = [];
    for (const id of ids) {
      const src = photos.get(id); if (!src) continue;
      const n = [...photos.values()].filter(p => p.fileId === src.fileId).length;
      const p = Model.clone(src); p.id = Aero.uid() + Aero.uid().slice(0, 4); p.copyName = 'Copy ' + n; p.seq = ++seq; p.added = Date.now();
      p.history = [{ label: 'Virtual copy', s: Model.clone(src.settings), t: Date.now() }]; p.hi = 0; p.snapshots = [];
      photos.set(p.id, p); await DB.put('photos', p); made.push(p.id);
      const tb = await DB.getBlob('thumb:' + src.id); if (tb) { await DB.putBlob('thumb:' + p.id, tb); thumbURL.set(p.id, URL.createObjectURL(tb)); } else queueThumb(p.id);
    }
    if (made.length) { pushUndo({ label: 'Create virtual copy', undo: () => removeRaw(made), redo: () => restoreRaw(made) }); emit('import', { ids: made }); }
    return made;
  }

  /* ---------- delete from catalog (undoable within the session) ---------- */
  const graveyard = new Map();   // id → {rec, thumb, file?, small?, proxy?}
  async function removeRaw(ids) {
    for (const id of ids) {
      const p = photos.get(id); if (!p) continue;
      const g = { rec: p, thumb: await DB.getBlob('thumb:' + id) };
      photos.delete(id);
      const stillUsed = [...photos.values()].some(q => q.fileId === p.fileId);
      if (!stillUsed) {
        g.file = await DB.get('files', p.fileId); g.small = await DB.getBlob('small:' + p.fileId); g.proxy = await DB.getBlob('proxy:' + p.fileId);
        await DB.del('files', p.fileId); await DB.delBlob('small:' + p.fileId); await DB.delBlob('proxy:' + p.fileId);
        workCache.delete(p.fileId); smallCache.delete(p.fileId);
      }
      await DB.del('photos', id); await DB.delBlob('thumb:' + id);
      const u = thumbURL.get(id); if (u) URL.revokeObjectURL(u); thumbURL.delete(id);
      graveyard.set(id, g);
    }
    // collections keep the ids (so undo restores membership); visible lists skip missing photos
    emit('remove', ids);
  }
  async function restoreRaw(ids) {
    for (const id of ids) {
      const g = graveyard.get(id); if (!g) continue;
      photos.set(id, g.rec); await DB.put('photos', g.rec);
      if (g.thumb) { await DB.putBlob('thumb:' + id, g.thumb); thumbURL.set(id, URL.createObjectURL(g.thumb)); }
      if (g.file) await DB.put('files', g.file); if (g.small) await DB.putBlob('small:' + g.rec.fileId, g.small); if (g.proxy) await DB.putBlob('proxy:' + g.rec.fileId, g.proxy);
      graveyard.delete(id);
    }
    emit('import', { ids, restore: true });
  }
  async function remove(ids) {
    ids = ids.filter(id => photos.has(id)); if (!ids.length) return;
    Aero.busy('Removing…'); try { await removeRaw(ids); } finally { Aero.busy(); }
    // purge stale collection references that are not undoable any more is unnecessary; they are filtered on display
    pushUndo({ label: `Remove ${ids.length} photo${ids.length > 1 ? 's' : ''}`, undo: () => restoreRaw(ids), redo: () => removeRaw(ids) });
  }

  /* ---------- collections ---------- */
  const saveCollections = () => DB.open().then(async () => { const all = await DB.getAll('collections'); await Promise.all(all.filter(c => !collections.some(x => x.id === c.id)).map(c => DB.del('collections', c.id))); await DB.putMany('collections', collections); }).then(() => emit('collections'));
  function snapshotCollections() { return Model.clone(collections); }
  function collectionsOp(label, fn) {
    const before = snapshotCollections(); fn(); const after = snapshotCollections();
    saveCollections();
    pushUndo({ label, undo: () => { collections = Model.clone(before); return saveCollections(); }, redo: () => { collections = Model.clone(after); return saveCollections(); } });
  }
  function newSmartCollection(name, smart) { const c = Model.sanitizeCollection({ id: Aero.uid(), name, ids: [], smart, created: Date.now() }); collectionsOp('New smart collection', () => collections.push(c)); return c; }
  function updateSmartCollection(id, name, smart) { collectionsOp('Edit smart collection', () => { const c = collections.find(x => x.id === id); if (c) { const n = Model.sanitizeCollection({ ...c, name, smart }); c.name = n.name; c.smart = n.smart; } }); }
  function newCollection(name, ids = []) { const c = { id: Aero.uid(), name, ids: [...new Set(ids)], created: Date.now() }; collectionsOp('New collection', () => collections.push(c)); return c; }
  function renameCollection(id, name) { collectionsOp('Rename collection', () => { const c = collections.find(x => x.id === id); if (c) c.name = name; }); }
  function deleteCollection(id) { collectionsOp('Delete collection', () => { collections = collections.filter(x => x.id !== id); }); }
  function addToCollection(id, ids) { collectionsOp('Add to collection', () => { const c = collections.find(x => x.id === id); if (c) c.ids = [...new Set([...c.ids, ...ids])]; }); }
  function removeFromCollection(id, ids) { collectionsOp('Remove from collection', () => { const c = collections.find(x => x.id === id); if (c) c.ids = c.ids.filter(x => !ids.includes(x)); }); }

  /* ---------- user presets ---------- */
  async function savePreset(name, groups, settings) {
    const pr = Model.sanitizePreset({ id: Aero.uid(), name, groups, part: Model.pick(settings, groups) });
    userPresets.push(pr); await DB.put('presets', pr); emit('presets'); return pr;
  }
  async function deletePreset(id) { userPresets = userPresets.filter(p => p.id !== id); await DB.del('presets', id); emit('presets'); }

  /* ---------- whole catalog ---------- */
  async function clear() {
    await DB.clearAll(); photos.clear(); collections = []; userPresets = []; thumbURL.forEach(u => URL.revokeObjectURL(u)); thumbURL.clear();
    workCache.clear(); smallCache.clear(); undoStack.length = redoStack.length = 0; graveyard.clear(); seq = 0; emit('load');
  }
  function keywords() { const m = new Map(); photos.forEach(p => p.keywords.forEach(k => m.set(k, (m.get(k) || 0) + 1))); return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])); }
  const displayName = p => p.copyName ? `${p.name} (${p.copyName})` : p.name;

  const api = {
    photos, thumbURL, thumb, newSmartCollection, updateSmartCollection, thumbPriority: null, get collections() { return collections; }, get userPresets() { return userPresets; }, on: fn => listeners.add(fn), emit,
    load, importFiles, workImage, smallImage, fullImage, fileBytes, renderPreviewCanvas, queueThumb, renderThumb,
    pushUndo, undo, redo, canUndo, canRedo, topUndo, topRedo, addSnapshot, renameSnapshot, updateSnapshot, deleteSnapshot, undoLabel, redoLabel, changeMeta, setSettings, historyGo, applyToMany, virtualCopy, remove,
    newCollection, renameCollection, deleteCollection, addToCollection, removeFromCollection, savePreset, deletePreset, clear, keywords, displayName,
    nextSeq: () => ++seq, setCollections(c) { collections = c; }, setPresets(p) { userPresets = p; }
  };
  return api;
})();
