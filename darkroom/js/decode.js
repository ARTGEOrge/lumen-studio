'use strict';
/* Lumen Darkroom — decoding (browser codecs + LibRaw WASM for camera RAW), EXIF, preview helpers */
const Decode = (() => {
  const RAW_EXT = /\.(cr2|cr3|crw|nef|nrw|arw|srf|sr2|dng|raf|orf|rw2|rwl|pef|srw|3fr|erf|kdc|dcr|mrw|x3f|iiq|mos|raw)$/i;
  const IMG_EXT = /\.(jpe?g|jfif|png|webp|gif|bmp|avif|heic|heif|tiff?)$/i;
  const isRaw = name => RAW_EXT.test(name);
  const isImage = name => IMG_EXT.test(name) || RAW_EXT.test(name);
  const extOf = name => (String(name).match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
  const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff' };
  let LibRawMod = null;

  function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }

  async function decodeRaw(bytes, half) {
    if (!self.crossOriginIsolated) throw new Error('RAW decoding needs a cross-origin isolated page');
    LibRawMod = LibRawMod || (await import('../vendor/libraw/index.js')).default;
    const raw = new LibRawMod();
    try {
      await raw.open(new Uint8Array(bytes.slice(0)), { useCameraWb: true, outputBps: 8, outputColor: 1, userQual: half ? 0 : 3, highlight: 2, halfSize: !!half, noAutoBright: false });
      let meta = null; try { meta = await raw.metadata(false); } catch (e) { }
      const im = await raw.imageData();
      if (!im || !im.width) throw new Error('decoder returned no image');
      const { width: w, height: h, colors = 3, bits = 8 } = im, src = im.data, img = new ImageData(w, h), d = img.data, n = w * h, sh = bits === 16 ? 8 : 0;
      for (let i = 0; i < n; i++) {
        const j = i * 4, k = i * colors;
        if (colors >= 3) { d[j] = src[k] >> sh; d[j + 1] = src[k + 1] >> sh; d[j + 2] = src[k + 2] >> sh; } else d[j] = d[j + 1] = d[j + 2] = src[k] >> sh;
        d[j + 3] = 255;
      }
      const c = mkCanvas(w, h); c.getContext('2d').putImageData(img, 0, 0);
      return { img: c, w, h, meta };
    } finally { raw.dispose(); }
  }
  // Fallback for RAW files LibRaw cannot handle: the largest embedded JPEG preview
  async function embeddedPreview(bytes) {
    const u = new Uint8Array(bytes), starts = [];
    for (let i = 0; i < u.length - 3 && starts.length < 40; i++) if (u[i] === 0xFF && u[i + 1] === 0xD8 && u[i + 2] === 0xFF) starts.push(i);
    let best = null;
    for (const s of starts) { try { const b = await createImageBitmap(new Blob([u.subarray(s)], { type: 'image/jpeg' })); if (!best || b.width * b.height > best.width * best.height) best = b; } catch (e) { } }
    return best;
  }

  // → {img, w, h, meta?, note?}
  async function decode(bytes, name, { half = false } = {}) {
    if (isRaw(name)) {
      try { return await decodeRaw(bytes, half); }
      catch (err) {
        console.warn('LibRaw failed, trying embedded preview:', err);
        const b = await embeddedPreview(bytes);
        if (!b) throw new Error('unsupported RAW file (' + err.message + ')');
        return { img: b, w: b.width, h: b.height, note: 'embedded preview' };
      }
    }
    const type = MIME[extOf(name)] || '';
    let bmp;
    try { bmp = await createImageBitmap(new Blob([bytes], { type }), { imageOrientation: 'from-image' }); }
    catch (e) {
      if (/^hei[cf]$/.test(extOf(name))) throw new Error('HEIC/HEIF is not decodable by this browser — convert it to JPEG first');
      throw new Error('cannot decode image');
    }
    return { img: bmp, w: bmp.width, h: bmp.height };
  }

  // high quality downscale to fit maxEdge (returns canvas or the original if already small)
  async function fit(img, maxEdge) {
    const w = img.width, h = img.height, s = Math.min(1, maxEdge / Math.max(w, h));
    const tw = Math.max(1, Math.round(w * s)), th = Math.max(1, Math.round(h * s));
    let src = img;
    if (s < 1) {
      try { src = await createImageBitmap(img, { resizeWidth: tw, resizeHeight: th, resizeQuality: 'high' }); }
      catch (e) { const c = mkCanvas(tw, th), x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(img, 0, 0, tw, th); return c; }
    }
    const c = mkCanvas(tw, th); c.getContext('2d').drawImage(src, 0, 0); return c;
  }
  const toBlob = (canvas, type = 'image/jpeg', q = .9) => new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('encode failed')), type, q));
  async function blobToImage(blob) { return createImageBitmap(blob); }

  async function readExif(bytes, name, rawMeta) {
    const e = {};
    try {
      if (window.exifr) {
        const x = await exifr.parse(bytes, { tiff: true, exif: true, gps: false, ifd1: false, interop: false, xmp: false, icc: false, iptc: false, jfif: false, ihdr: false, translateValues: false, reviveValues: true, mergeOutput: true });
        if (x) {
          e.make = x.Make; e.model = x.Model; e.lens = x.LensModel || x.LensMake || ''; e.iso = x.ISO || x.ISOSpeedRatings || x.PhotographicSensitivity;
          if (Array.isArray(e.iso)) e.iso = e.iso[0];
          e.shutter = x.ExposureTime; e.aperture = x.FNumber; e.focal = x.FocalLength;
          const d = x.DateTimeOriginal || x.CreateDate || x.DateTime; if (d instanceof Date && !isNaN(d)) e.date = d.getTime();
        }
      }
    } catch (err) { /* no EXIF */ }
    if (rawMeta) {
      const m = rawMeta, g = (...k) => { for (const n of k) if (m[n] != null && m[n] !== '' && m[n] !== 0) return m[n]; };
      e.make = e.make || g('camera_make', 'make'); e.model = e.model || g('camera_model', 'model');
      e.iso = e.iso || g('iso_speed', 'iso'); e.shutter = e.shutter || g('shutter'); e.aperture = e.aperture || g('aperture'); e.focal = e.focal || g('focal_len', 'focal');
      e.lens = e.lens || g('lens', 'Lens'); if (!e.date && m.timestamp instanceof Date && m.timestamp.getTime() > 0) e.date = m.timestamp.getTime();
    }
    return Model.sanitizeExif(e);
  }

  const fmtShutter = s => !s ? '' : s >= 1 ? `${+s.toFixed(1)}s` : `1/${Math.round(1 / s)}s`;
  const fmtSize = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';

  return { isRaw, isImage, extOf, MIME, decode, fit, toBlob, blobToImage, readExif, mkCanvas, fmtShutter, fmtSize };
})();
