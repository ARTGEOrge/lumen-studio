'use strict';
/* Lumen Darkroom — IndexedDB catalog.
   stores: photos (records), files (original bytes, shared by virtual copies), blobs (key → Blob: thumb:/small:/proxy:),
           collections, presets, meta */
const DB = (() => {
  const NAME = 'lumen-darkroom', VER = 1, STORES = ['photos', 'files', 'blobs', 'collections', 'presets', 'meta'];
  let db = null;
  const pending = new Map();   // photo id → record (debounced writes)
  let timer = null, onState = null;

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VER);
      r.onupgradeneeded = () => {
        const d = r.result;
        STORES.forEach(s => { if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: s === 'blobs' || s === 'meta' ? 'key' : 'id' }); });
      };
      r.onsuccess = () => { db = r.result; res(db); };
      r.onerror = () => rej(r.error);
    });
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const tx = (stores, mode = 'readonly') => db.transaction(stores, mode);
  const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted')); });

  async function getAll(store) { await open(); return req(tx([store]).objectStore(store).getAll()); }
  async function get(store, key) { await open(); return req(tx([store]).objectStore(store).get(key)); }
  async function put(store, val) { await open(); const t = tx([store], 'readwrite'); t.objectStore(store).put(val); return done(t); }
  async function del(store, key) { await open(); const t = tx([store], 'readwrite'); t.objectStore(store).delete(key); return done(t); }
  async function putMany(store, vals) { await open(); const t = tx([store], 'readwrite'); const s = t.objectStore(store); vals.forEach(v => s.put(v)); return done(t); }
  async function clearAll() { await open(); pending.clear(); const t = tx(STORES, 'readwrite'); STORES.forEach(s => t.objectStore(s).clear()); return done(t); }
  const getBlob = async key => (await get('blobs', key))?.blob || null;
  const putBlob = (key, blob) => put('blobs', { key, blob });
  const delBlob = key => del('blobs', key);

  // debounced photo record saves
  function savePhoto(p) { pending.set(p.id, p); onState?.(true); clearTimeout(timer); timer = setTimeout(flush, 400); }
  async function flush() {
    clearTimeout(timer); if (!pending.size) { onState?.(false); return; }
    const vals = [...pending.values()]; pending.clear();
    try { await putMany('photos', vals); } catch (e) { console.error('Catalog save failed', e); Aero.toast('Could not save catalog: ' + e.message); }
    if (!pending.size) onState?.(false);
  }
  const isPending = () => pending.size > 0;
  function setStateListener(fn) { onState = fn; }

  return { open, getAll, get, put, del, putMany, clearAll, getBlob, putBlob, delBlob, savePhoto, flush, isPending, setStateListener };
})();
