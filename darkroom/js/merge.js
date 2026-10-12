'use strict';
/* Lumen Darkroom — Photo Merge (HDR, Panorama): loads the selected originals, runs the merge worker,
   and imports the result into the catalog as a new lossless PNG photo (the sources are untouched). */
const Merge = (() => {
  const CAP = { hdr: 3200, pano: 3000 };   // long-edge cap of the inputs (keeps memory bounded)
  function runWorker(type, images, opts) {
    return new Promise((res, rej) => {
      const w = new Worker('js/merge-worker.js');
      w.onmessage = e => { const m = e.data; if (m.type === 'progress') Aero.busy(m.msg); else { w.terminate(); m.type === 'done' ? res(m) : rej(new Error(m.message)); } };
      w.onerror = e => { w.terminate(); rej(new Error(e.message || 'merge worker failed')); };
      w.postMessage({ type, images, opts }, images.map(i => i.data));
    });
  }
  async function pixels(p, cap) {
    const img = p.raw ? await Cat.workImage(p) : await Cat.fullImage(p);
    const s = Math.min(1, cap / Math.max(img.width, img.height)), w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
    const c = Decode.mkCanvas(w, h), x = c.getContext('2d', { willReadFrequently: true }); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, w, h);
    return { w, h, data: x.getImageData(0, 0, w, h).data.buffer };
  }
  const sortByTime = list => list.slice().sort((a, b) => (a.exif.date || a.added) - (b.exif.date || b.added) || a.seq - b.seq);
  async function merge(type, ids, opts) {
    const photos = sortByTime(ids.map(id => Cat.photos.get(id)).filter(Boolean));
    if (photos.length < 2) { Aero.toast(`Select at least two photos to merge into ${type === 'hdr' ? 'an HDR' : 'a panorama'}`); return null; }
    if (photos.length > (type === 'hdr' ? 9 : 16)) { Aero.toast(`At most ${type === 'hdr' ? 9 : 16} photos can be merged at once`); return null; }
    const t0 = performance.now();
    try {
      Aero.busy('Loading photos…');
      const images = [];
      for (let i = 0; i < photos.length; i++) { Aero.busy(`Loading photo ${i + 1} / ${photos.length}…`); images.push(await pixels(photos[i], CAP[type])); }
      if (type === 'hdr') {   // all inputs must share a size
        const w = images[0].w, h = images[0].h;
        if (images.some(i => Math.abs(i.w / i.h - w / h) > .01)) throw new Error('the bracketed photos must have the same size and orientation');
        for (let i = 1; i < images.length; i++) if (images[i].w !== w || images[i].h !== h) {
          const c = Decode.mkCanvas(images[i].w, images[i].h); c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(images[i].data), images[i].w, images[i].h), 0, 0);
          const d = Decode.mkCanvas(w, h), x = d.getContext('2d', { willReadFrequently: true }); x.drawImage(c, 0, 0, w, h); images[i] = { w, h, data: x.getImageData(0, 0, w, h).data.buffer };
        }
      }
      const r = await runWorker(type, images, opts);
      Aero.busy('Saving the merged photo…');
      const c = Decode.mkCanvas(r.w, r.h); c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
      const bytes = await (await Decode.toBlob(c, 'image/png')).arrayBuffer();
      const base = photos[0].name.replace(/\.[^.]+$/, ''), name = `${base}-${type === 'hdr' ? 'HDR' : 'Pano'}.png`;
      const src = photos[type === 'hdr' ? (r.info.ref ?? 0) : (r.info.ref ?? 0)] || photos[0];
      const kw = [...new Set([...photos.flatMap(p => p.keywords), type === 'hdr' ? 'HDR' : 'panorama'])].slice(0, 100);
      Aero.busy();
      const [p] = await Cat.importFiles([{ name, data: bytes }], { quiet: true, allowDupes: true, meta: [{ exif: { ...src.exif }, keywords: kw }] });
      if (!p) return null;
      S.lastImport = p.importId; S.sel = new Set([p.id]); S.active = p.id;
      if (S.source.type !== 'all') S.source = { type: 'all' };
      refreshList(); renderLeft();
      if (type === 'hdr' && opts.autoTone !== false) { Dev.photoChanged(); await Dev.autoTone(); }
      const secs = ((performance.now() - t0) / 1000).toFixed(1);
      Aero.toast(type === 'hdr' ? `HDR merged from ${photos.length} exposures (${r.w} × ${r.h}, ${secs} s)` : `Panorama stitched from ${photos.length} photos (${r.w} × ${r.h}, ${r.info.projection}, ${secs} s)`);
      p.mergeInfo = r.info;
      return p;
    } catch (e) { console.warn(e); Aero.busy(); Aero.alert(type === 'hdr' ? 'HDR Merge failed' : 'Panorama Merge failed', 'The photos could not be merged: ' + e.message); return null; }
    finally { Aero.busy(); }
  }
  function hdrDialog() {
    const ids = selectedIds(); if (ids.length < 2) return Aero.toast('Select two or more bracketed exposures of the same scene (Ctrl-click), then choose HDR');
    Aero.dialog({ title: 'HDR Merge', instruction: `Merge ${ids.length} bracketed exposures into one photo with detail in both the shadows and the highlights (exposure fusion).`, ok: 'Merge', width: 460,
      fields: [{ key: 'align', label: 'Auto align', type: 'checkbox', value: true }, { key: 'deghost', label: 'Deghost amount', type: 'select', value: 'off', options: [['off', 'Off'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] }, { key: 'autoTone', label: 'Auto tone the result', type: 'checkbox', value: true }],
      html: `<p class="dnote">Hand-held brackets are aligned automatically (shifts up to ±64 px). Deghosting keeps moving subjects (people, branches, cars) from the middle exposure only. The result is added to the catalog as a new PNG (long edge up to ${CAP.hdr} px).</p>`,
      onOK: v => merge('hdr', ids, v) });
  }
  function panoDialog() {
    const ids = selectedIds(); if (ids.length < 2) return Aero.toast('Select two or more overlapping photos (Ctrl-click), then choose Panorama');
    Aero.dialog({ title: 'Panorama Merge', instruction: `Stitch ${ids.length} overlapping photos into a panorama.`, ok: 'Merge', width: 460,
      fields: [{ key: 'projection', label: 'Projection', type: 'select', value: 'spherical', options: [['spherical', 'Spherical'], ['cylindrical', 'Cylindrical'], ['perspective', 'Perspective']] },
        { key: 'autoCrop', label: 'Auto crop', type: 'checkbox', value: true }, { key: 'exposure', label: 'Match exposures', type: 'checkbox', value: true }],
      html: `<p class="dnote">Shoot with 25–50 % overlap, rotating the camera around its lens. Spherical suits wide and multi-row panoramas, Cylindrical keeps verticals straight, Perspective keeps straight lines straight (narrow panoramas only). Inputs are used at up to ${CAP.pano} px.</p>`,
      onOK: v => merge('pano', ids, v) });
  }
  return { merge, hdrDialog, panoDialog, CAP };
})();
