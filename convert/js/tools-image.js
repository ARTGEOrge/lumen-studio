'use strict';
/* Lumen Convert — image tools: format converter, resize, compress, SVG → PNG, ICO favicon, Base64. */
(() => {
  const { register, alias, util: U } = LC;
  const { esc, el, fmtSize, baseName, extOf } = U;
  const IMG_EXT = /^(png|jpe?g|jfif|webp|avif|bmp|gif|ico|svg)$/;
  const isImage = f => /^image\//.test(f.type) || IMG_EXT.test(extOf(f.name));
  const isRaster = f => isImage(f) && f.type !== 'image/svg+xml' && extOf(f.name) !== 'svg';
  const fmtName = f => (f.type ? f.type.split('/')[1].replace('svg+xml', 'svg').replace('x-icon', 'ico').replace('vnd.microsoft.icon', 'ico') : extOf(f.name) || '?').toUpperCase().replace('JPEG', 'JPEG');
  const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp', avif: 'avif' };
  const qFmt = v => Math.round(v * 100) + '%';
  const saving = (a, b) => { const p = Math.round((1 - b / a) * 100); return p >= 0 ? `<span class="good">−${p}%</span>` : `<span class="bad">+${-p}%</span>`; };

  // probe for AVIF encoding support (Chromium can decode AVIF but usually cannot encode it)
  const outFormats = [['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP']];
  try { const c = document.createElement('canvas'); c.width = c.height = 2; c.toBlob(b => { if (b && b.type === 'image/avif') outFormats.push(['avif', 'AVIF']); }, 'image/avif', 0.5); } catch (e) { /* no AVIF */ }

  async function encodeBitmap(bmp, fmt, q, bg, w = bmp.width, h = bmp.height) {
    const needsBg = fmt === 'jpeg';
    const c = U.drawTo(bmp, w, h, needsBg ? (bg || '#ffffff') : null);
    return U.encodeCanvas(c, U.MIME[fmt], fmt === 'png' ? undefined : q);
  }

  /* 1 ─ Image format converter */
  register({
    id: 'image-converter', cat: 'img', glyph: 'convert', name: 'Image format converter', keywords: 'jpg jpeg png webp avif bmp gif heic convert format',
    desc: 'PNG, JPEG, WebP, AVIF, BMP or GIF to PNG, JPEG or WebP.',
    accept: 'image/*,.avif,.bmp,.ico', acceptText: 'PNG, JPEG, WebP, AVIF, BMP, GIF (first frame), ICO', acceptTest: isRaster, multiple: true, zipName: 'converted-images',
    options: [
      { key: 'to', label: 'Convert to', type: 'select', options: outFormats, value: 'png' },
      { key: 'q', label: 'Quality', type: 'range', min: 0.1, max: 1, step: 0.01, value: 0.9, fmt: qFmt, show: o => o.to !== 'png' },
      { key: 'bg', label: 'Background', type: 'color', value: '#ffffff', show: o => o.to === 'jpeg', hint: 'JPEG has no transparency; transparent areas get this colour.' }],
    note: 'Metadata (EXIF, GPS, colour profiles) is not copied to the output. Animated GIF/WebP: only the first frame is kept.',
    async each(f, o, ctx) {
      ctx.progress(0.1, 'Decoding ' + f.name);
      const bmp = await U.decodeImage(f);
      try {
        ctx.progress(0.5, 'Encoding ' + f.name);
        const blob = await encodeBitmap(bmp, o.to, o.q, o.bg);
        return { name: baseName(f.name) + '.' + EXT[o.to], blob, thumb: true, info: `${bmp.width}×${bmp.height} · ${fmtName(f)} → ${o.to.toUpperCase()}` };
      } finally { bmp.close(); }
    }
  });
  for (const [a, b] of [['jpg', 'png'], ['png', 'jpg'], ['webp', 'png'], ['webp', 'jpg'], ['png', 'webp'], ['jpg', 'webp'], ['avif', 'png'], ['avif', 'jpg'], ['bmp', 'png'], ['gif', 'png']])
    alias(`${a}-to-${b}`, 'image-converter', { to: b === 'jpg' ? 'jpeg' : b });

  /* 2 ─ Resize images */
  function targetSize(w, h, o) {
    let W, H;
    if (o.mode === 'percent') { W = w * o.pct / 100; H = h * o.pct / 100; }
    else if (o.mode === 'width') { W = o.w; H = h * o.w / w; }
    else if (o.mode === 'height') { H = o.h; W = w * o.h / h; }
    else if (o.mode === 'fit') { const s = Math.min(o.w / w, o.h / h, o.up ? Infinity : 1); W = w * s; H = h * s; }
    else { W = o.w; H = o.h; }
    W = Math.max(1, Math.round(W)); H = Math.max(1, Math.round(H));
    if (!isFinite(W) || !isFinite(H)) throw new Error('Enter a valid size');
    return [W, H];
  }
  const sameFmt = f => { const t = (f.type || '').split('/')[1] || extOf(f.name); return t === 'jpeg' || t === 'jpg' ? 'jpeg' : t === 'webp' ? 'webp' : 'png'; };
  register({
    id: 'resize', cat: 'img', glyph: 'resize', name: 'Resize images', keywords: 'resize scale shrink enlarge dimensions width height batch thumbnail',
    desc: 'By pixels, percentage or fit-in-a-box. Batch-resize many at once.',
    accept: 'image/*,.avif,.bmp', acceptText: 'PNG, JPEG, WebP, AVIF, BMP, GIF', acceptTest: isRaster, multiple: true, zipName: 'resized-images',
    options: [
      { key: 'mode', label: 'Resize by', type: 'select', value: 'fit', options: [['percent', 'Percentage'], ['width', 'Width (keep ratio)'], ['height', 'Height (keep ratio)'], ['fit', 'Fit inside a box'], ['exact', 'Exact size (stretch)']] },
      { key: 'pct', label: 'Scale', type: 'range', min: 5, max: 400, step: 1, value: 50, fmt: v => v + '%', show: o => o.mode === 'percent' },
      { key: 'w', label: 'Width', type: 'number', min: 1, max: 30000, step: 1, value: 1280, unit: 'px', show: o => ['width', 'fit', 'exact'].includes(o.mode) },
      { key: 'h', label: 'Height', type: 'number', min: 1, max: 30000, step: 1, value: 1280, unit: 'px', show: o => ['height', 'fit', 'exact'].includes(o.mode) },
      { key: 'up', label: 'Enlarge', type: 'checkbox', text: 'Allow enlarging smaller images', value: false, show: o => o.mode === 'fit' },
      { key: 'to', label: 'Save as', type: 'select', value: 'same', options: [['same', 'Same as original'], ['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP']] },
      { key: 'q', label: 'Quality', type: 'range', min: 0.1, max: 1, step: 0.01, value: 0.9, fmt: qFmt, show: o => o.to !== 'png' }],
    async each(f, o, ctx) {
      ctx.progress(0.1, 'Decoding ' + f.name);
      const bmp = await U.decodeImage(f);
      try {
        const [W, H] = targetSize(bmp.width, bmp.height, o); U.checkDims(W, H);
        ctx.progress(0.4, `Resizing ${f.name} to ${W}×${H}`);
        const r = await U.resizeBitmap(bmp, W, H);
        const fmt = o.to === 'same' ? sameFmt(f) : o.to;
        const blob = await encodeBitmap(r, fmt, o.q, '#ffffff', W, H); r.close && r.close();
        return { name: `${baseName(f.name)}-${W}x${H}.${EXT[fmt]}`, blob, thumb: true, info: `${bmp.width}×${bmp.height} → ${W}×${H}` };
      } finally { bmp.close(); }
    }
  });

  /* 3 ─ Compress images */
  register({
    id: 'compress', cat: 'img', glyph: 'compress', name: 'Compress images', keywords: 'compress optimize reduce file size smaller kb jpeg webp quality',
    desc: 'Smaller JPEG or WebP files by quality or a target size, with before/after sizes.',
    accept: 'image/*,.avif,.bmp', acceptText: 'PNG, JPEG, WebP, AVIF, BMP, GIF', acceptTest: isRaster, multiple: true, zipName: 'compressed-images', showSaving: true,
    options: [
      { key: 'to', label: 'Output', type: 'select', value: 'auto', options: [['auto', 'Auto (JPEG stays JPEG, others → WebP)'], ['jpeg', 'JPEG'], ['webp', 'WebP']] },
      { key: 'mode', label: 'Compress by', type: 'select', value: 'quality', options: [['quality', 'Quality'], ['target', 'Target file size']] },
      { key: 'q', label: 'Quality', type: 'range', min: 0.05, max: 0.95, step: 0.01, value: 0.72, fmt: qFmt, show: o => o.mode === 'quality' },
      { key: 'kb', label: 'Target size', type: 'number', min: 5, max: 100000, step: 1, value: 200, unit: 'KB', show: o => o.mode === 'target', hint: 'Finds the best quality under this size; shrinks the dimensions only if it has to.' },
      { key: 'max', label: 'Max side', type: 'number', min: 0, max: 30000, step: 1, value: 0, unit: 'px (0 = keep)' }],
    async each(f, o, ctx) {
      ctx.progress(0.05, 'Decoding ' + f.name);
      const bmp = await U.decodeImage(f);
      try {
        const fmt = o.to === 'auto' ? (sameFmt(f) === 'jpeg' ? 'jpeg' : 'webp') : o.to;
        let W = bmp.width, H = bmp.height;
        if (o.max > 0 && Math.max(W, H) > o.max) { const s = o.max / Math.max(W, H); W = Math.max(1, Math.round(W * s)); H = Math.max(1, Math.round(H * s)); }
        let src = W === bmp.width && H === bmp.height ? bmp : await U.resizeBitmap(bmp, W, H);
        let blob, q = o.q;
        if (o.mode === 'quality') blob = await encodeBitmap(src, fmt, o.q, '#ffffff', W, H);
        else {
          const limit = o.kb * 1024;
          for (let round = 0; round < 8; round++) {
            let lo = 0.05, hi = 0.95, best = null;
            for (let i = 0; i < 7; i++) {
              ctx.check(); const mid = (lo + hi) / 2; ctx.progress(0.1 + (round * 7 + i) / 60, `Trying quality ${Math.round(mid * 100)}% at ${W}×${H}`);
              const b = await encodeBitmap(src, fmt, mid, '#ffffff', W, H);
              if (b.size <= limit) { best = [b, mid]; lo = mid; } else hi = mid;
            }
            if (best) { [blob, q] = best; break; }
            W = Math.max(1, Math.round(W * 0.8)); H = Math.max(1, Math.round(H * 0.8));
            if (src !== bmp && src.close) src.close(); src = await U.resizeBitmap(bmp, W, H);
            if (W < 16 || H < 16) break;
          }
          if (!blob) throw new Error(`Couldn’t get under ${o.kb} KB. Try a larger target.`);
        }
        if (src !== bmp && src.close) src.close();
        const dims = W !== bmp.width ? ` · ${bmp.width}×${bmp.height} → ${W}×${H}` : '';
        const bigger = blob.size >= f.size ? ' · the original is already smaller, keep it' : '';
        return { name: `${baseName(f.name)}-compressed.${EXT[fmt]}`, blob, thumb: true, infoHtml: `${fmtSize(f.size)} → ${fmtSize(blob.size)} ${saving(f.size, blob.size)} · ${fmt.toUpperCase()} ${Math.round(q * 100)}%${esc(dims + bigger)}` };
      } finally { bmp.close(); }
    }
  });

  /* 4 ─ SVG → PNG */
  function parseLen(v) { if (!v) return null; const m = String(v).trim().match(/^([\d.]+)\s*(px|pt|pc|mm|cm|in)?$/i); if (!m) return null; const k = { px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 }[(m[2] || 'px').toLowerCase()]; return parseFloat(m[1]) * k; }
  async function svgToCanvas(text, o) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.documentElement;
    if (!svg || svg.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) throw new Error('Not a valid SVG file');
    const vb = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    let w = parseLen(svg.getAttribute('width')), h = parseLen(svg.getAttribute('height'));
    const hasVB = vb.length === 4 && vb.every(isFinite) && vb[2] > 0 && vb[3] > 0;
    if (!w && !h) { if (hasVB) { w = vb[2]; h = vb[3]; } else { w = 300; h = 150; } }
    else if (!w) w = hasVB ? h * vb[2] / vb[3] : h; else if (!h) h = hasVB ? w * vb[3] / vb[2] : w;
    if (!hasVB) svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    let W, H;
    if (o.size === 'width') { W = o.w; H = o.w * h / w; } else { W = w * +o.size; H = h * +o.size; }
    W = Math.max(1, Math.round(W)); H = Math.max(1, Math.round(H)); U.checkDims(W, H);
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    if (!hasVB || !svg.hasAttribute('preserveAspectRatio')) svg.setAttribute('preserveAspectRatio', svg.getAttribute('preserveAspectRatio') || 'xMidYMid meet');
    const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image(); img.src = url;
      await img.decode().catch(() => { throw new Error('The SVG could not be rendered'); });
      const c = U.canvas(W, H), g = c.getContext('2d');
      if (o.bg === 'white') { g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); } else if (o.bg === 'custom') { g.fillStyle = o.color; g.fillRect(0, 0, W, H); }
      g.drawImage(img, 0, 0, W, H);
      return { c, w: Math.round(w), h: Math.round(h) };
    } finally { URL.revokeObjectURL(url); }
  }
  register({
    id: 'svg-to-png', cat: 'img', glyph: 'svg', name: 'SVG → PNG', keywords: 'svg png rasterize vector render export scale',
    desc: 'Render SVG vector files to crisp PNG at any scale.',
    accept: '.svg,image/svg+xml', acceptText: 'SVG files', acceptTest: f => f.type === 'image/svg+xml' || extOf(f.name) === 'svg', multiple: true, zipName: 'svg-png',
    options: [
      { key: 'size', label: 'Size', type: 'select', value: '2', options: [['1', '1× (original size)'], ['2', '2×'], ['3', '3×'], ['4', '4×'], ['8', '8×'], ['width', 'Custom width']] },
      { key: 'w', label: 'Width', type: 'number', min: 1, max: 16000, step: 1, value: 1024, unit: 'px', show: o => o.size === 'width' },
      { key: 'bg', label: 'Background', type: 'select', value: 'none', options: [['none', 'Transparent'], ['white', 'White'], ['custom', 'Custom colour']] },
      { key: 'color', label: 'Colour', type: 'color', value: '#1e395b', show: o => o.bg === 'custom' }],
    note: 'SVGs are rendered as images: scripts never run and external files (web fonts, linked images) are not fetched.',
    async each(f, o, ctx) {
      if (f.size > 50 * 1048576) throw new Error('SVG is too large (over 50 MB)');
      ctx.progress(0.2, 'Rendering ' + f.name);
      const { c, w, h } = await svgToCanvas(await f.text(), o);
      const blob = await U.encodeCanvas(c, 'image/png');
      return { name: baseName(f.name) + '.png', blob, thumb: true, info: `${w}×${h} → ${c.width}×${c.height}` };
    }
  });

  /* 5 ─ Image → ICO */
  function bmpEntry(data, s) { // 32-bit BGRA DIB with an empty AND mask (alpha channel is used)
    const rowMask = Math.ceil(s / 32) * 4, size = 40 + s * s * 4 + rowMask * s;
    const out = new Uint8Array(size), dv = new DataView(out.buffer);
    dv.setUint32(0, 40, true); dv.setInt32(4, s, true); dv.setInt32(8, s * 2, true); dv.setUint16(12, 1, true); dv.setUint16(14, 32, true); dv.setUint32(20, s * s * 4 + rowMask * s, true);
    let o = 40;
    for (let y = s - 1; y >= 0; y--) for (let x = 0; x < s; x++) { const i = (y * s + x) * 4; out[o++] = data[i + 2]; out[o++] = data[i + 1]; out[o++] = data[i]; out[o++] = data[i + 3]; }
    return out;
  }
  async function buildIco(bmp, sizes, fit) {
    const entries = [];
    for (const s of sizes) {
      const c = U.canvas(s, s), g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
      const w = bmp.width, h = bmp.height;
      let src = bmp;
      if (fit === 'stretch') src = await U.resizeBitmap(bmp, s, s), g.drawImage(src, 0, 0);
      else {
        const k = fit === 'cover' ? Math.max(s / w, s / h) : Math.min(s / w, s / h);
        const dw = Math.max(1, Math.round(w * k)), dh = Math.max(1, Math.round(h * k));
        src = await U.resizeBitmap(bmp, dw, dh); g.drawImage(src, Math.round((s - dw) / 2), Math.round((s - dh) / 2));
      }
      if (src !== bmp && src.close) src.close();
      const data = s >= 64 ? new Uint8Array(await (await U.encodeCanvas(c, 'image/png')).arrayBuffer()) : bmpEntry(g.getImageData(0, 0, s, s).data, s);
      entries.push({ s, data });
    }
    const head = 6 + 16 * entries.length, total = head + entries.reduce((a, e) => a + e.data.length, 0);
    const out = new Uint8Array(total), dv = new DataView(out.buffer);
    dv.setUint16(2, 1, true); dv.setUint16(4, entries.length, true);
    let off = head;
    entries.forEach((e, i) => {
      const p = 6 + i * 16; out[p] = e.s >= 256 ? 0 : e.s; out[p + 1] = e.s >= 256 ? 0 : e.s; dv.setUint16(p + 4, 1, true); dv.setUint16(p + 6, 32, true);
      dv.setUint32(p + 8, e.data.length, true); dv.setUint32(p + 12, off, true); out.set(e.data, off); off += e.data.length;
    });
    return out;
  }
  register({
    id: 'favicon', cat: 'img', glyph: 'ico', name: 'Image → ICO favicon', keywords: 'ico favicon icon windows website 16 32 48 256',
    desc: 'A multi-size .ico (16 to 256 px) for websites and Windows.',
    accept: 'image/*,.avif,.bmp,.svg', acceptText: 'PNG, JPEG, WebP, SVG… (square images look best)', acceptTest: isImage, multiple: true, zipName: 'icons',
    options: [
      { key: 'sizes', label: 'Sizes', type: 'checks', value: [16, 32, 48, 256], options: [[16, '16'], [24, '24'], [32, '32'], [48, '48'], [64, '64'], [128, '128'], [256, '256']] },
      { key: 'fit', label: 'Non-square', type: 'select', value: 'contain', options: [['contain', 'Fit (transparent padding)'], ['cover', 'Fill (crop the centre)'], ['stretch', 'Stretch']] }],
    note: 'Sizes up to 48 px are stored as 32-bit bitmaps for maximum compatibility, larger sizes as PNG.',
    async each(f, o, ctx) {
      const sizes = [...o.sizes].map(Number).sort((a, b) => a - b);
      if (!sizes.length) throw new Error('Pick at least one size');
      ctx.progress(0.1, 'Decoding ' + f.name);
      let bmp;
      if (f.type === 'image/svg+xml' || extOf(f.name) === 'svg') { const { c } = await svgToCanvas(await f.text(), { size: 'width', w: 512, bg: 'none' }); bmp = await createImageBitmap(c); }
      else bmp = await U.decodeImage(f);
      try {
        ctx.progress(0.4, 'Building icon');
        const ico = await buildIco(bmp, sizes, o.fit);
        return { name: baseName(f.name) + '.ico', blob: new Blob([ico], { type: 'image/x-icon' }), thumb: true, info: `${sizes.length} size${sizes.length > 1 ? 's' : ''}: ${sizes.join(', ')} px` };
      } finally { bmp.close(); }
    }
  });
  alias('png-to-ico', 'favicon'); alias('favicon-generator', 'favicon');

  /* 6 ─ Image ⇄ Base64 (custom UI) */
  const MAX_B64 = 40 * 1048576;
  function parseDataInput(s) {
    s = s.trim(); if (!s) throw new Error('Paste a data URL or Base64 text first');
    let mime = null, isB64 = true, body = s;
    const m = s.match(/^data:([^,]*?),/i);
    if (m) { const parts = m[1].split(';'); mime = parts[0] || 'text/plain'; isB64 = parts.slice(1).some(p => p.toLowerCase() === 'base64'); body = s.slice(m[0].length); }
    else { const m2 = s.match(/url\(\s*["']?(data:[^"')]+)["']?\s*\)|src\s*=\s*["'](data:[^"']+)["']|\]\((data:[^)]+)\)/i); if (m2) return parseDataInput(m2[1] || m2[2] || m2[3]); }
    let bytes;
    if (isB64) {
      const clean = body.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) throw new Error('This isn’t valid Base64 (it contains characters outside A–Z, a–z, 0–9, +, /, =)');
      const pad = clean.length % 4 === 0 ? clean : clean + '='.repeat((4 - clean.length % 4) % 4);
      if (pad.length % 4 === 1) throw new Error('The Base64 text looks truncated');
      const bin = atob(pad); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else { try { bytes = new TextEncoder().encode(decodeURIComponent(body)); } catch (e) { throw new Error('The data URL is not correctly percent-encoded'); } }
    const [sm, sx] = U.sniff(bytes);
    if (!mime || mime === 'application/octet-stream') mime = sm;
    const ext = sm !== 'application/octet-stream' ? sx : ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/svg+xml': 'svg', 'text/plain': 'txt', 'text/html': 'html', 'application/json': 'json' }[mime] || 'bin');
    return { bytes, mime, ext };
  }
  register({
    id: 'base64', cat: 'img', glyph: 'b64', name: 'Image → Base64 data URL', keywords: 'base64 data url uri encode decode embed css html inline',
    desc: 'Turn images into data URLs for HTML/CSS, or decode Base64 back to a file.',
    render(root) {
      let mode = 'enc', file = null, dataUrl = '', decoded = null, decUrl = null;
      const top = el('div', 'intro'); const seg = el('div', 'seg');
      const bEnc = el('button', 'on', 'Image → Base64'), bDec = el('button', null, 'Base64 → Image'); bEnc.type = bDec.type = 'button'; seg.append(bEnc, bDec); top.append(seg);
      const io = el('div', 'io'); const L = el('div'), R = el('div'); io.append(L, R);
      const status = el('div', 'status'); root.append(top, io, status);
      const setStatus = (msg, err) => { status.textContent = msg; status.className = 'status' + (err ? ' err' : ''); };
      // encode side
      const encL = el('div'); const drop = el('div', 'drop', `<svg viewBox="0 0 24 24"><path d="M12 15V3m0 0-4 4m4-4 4 4"/><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg><div><b>Drop an image here</b> or click to choose</div><div class="acc">Any image (or any file) up to 40 MB</div>`);
      drop.tabIndex = 0; const pick = el('input'); pick.type = 'file'; pick.className = 'vh'; pick.accept = 'image/*';
      const encBox = el('div', 'box'); const thumb = el('img'); thumb.style.cssText = 'max-width:100%;max-height:200px;margin-top:10px;display:none;background:repeating-conic-gradient(#e8e8e8 0 25%,#fff 0 50%) 0 0/12px 12px;border:1px solid #c9d6e4';
      encBox.append(drop, pick, thumb); encL.append(el('div', 'ph', '<span class="phi"></span>Image'), encBox);
      const encR = el('div'); const tb = el('div', 'tb');
      const fmtSel = el('select'); for (const [v, l] of [['url', 'Data URL'], ['raw', 'Base64 only'], ['css', 'CSS background'], ['html', 'HTML <img>'], ['md', 'Markdown']]) { const op = el('option', null, esc(l)); op.value = v; fmtSel.append(op); }
      const copyB = el('button', 'go', 'Copy'), saveB = el('button', null, 'Save .txt'); copyB.type = saveB.type = 'button';
      tb.append(el('span', null, 'Output'), fmtSel, el('span', 'sp'), copyB, saveB);
      const out = el('textarea'); out.readOnly = true; out.placeholder = 'The Base64 data URL appears here.'; out.spellcheck = false;
      encR.append(tb, out);
      // decode side
      const decL = el('div'); const tb2 = el('div', 'tb'); const decB = el('button', 'go', 'Decode'); decB.type = 'button';
      tb2.append(el('span', null, 'Paste a data URL or Base64'), el('span', 'sp'), decB);
      const inp = el('textarea'); inp.placeholder = 'data:image/png;base64,iVBORw0KGgo…'; inp.spellcheck = false; decL.append(tb2, inp);
      const decR = el('div'); const tb3 = el('div', 'tb'); const dlB = el('a', 'btn go', 'Download'); dlB.hidden = true; tb3.append(el('span', null, 'Result'), el('span', 'sp'), dlB);
      const decBox = el('div', 'box'); decR.append(tb3, decBox);
      const ctl = {};
      function show() {
        bEnc.classList.toggle('on', mode === 'enc'); bDec.classList.toggle('on', mode === 'dec');
        L.innerHTML = ''; R.innerHTML = ''; if (mode === 'enc') { L.append(encL); R.append(encR); } else { L.append(decL); R.append(decR); }
        setStatus(mode === 'enc' ? (file ? status.textContent : 'Drop an image to encode it.') : 'Paste Base64 text, then press Decode.');
      }
      function formatted() {
        if (!dataUrl) return '';
        const v = fmtSel.value, raw = dataUrl.slice(dataUrl.indexOf(',') + 1);
        const nm = file ? file.name.replace(/[<>"&\]\[]/g, '') : 'image';
        return v === 'raw' ? raw : v === 'css' ? `background-image: url("${dataUrl}");` : v === 'html' ? `<img src="${dataUrl}" alt="${nm}">` : v === 'md' ? `![${nm}](${dataUrl})` : dataUrl;
      }
      async function encode(f) {
        if (f.size > MAX_B64) { setStatus(`“${f.name}” is ${fmtSize(f.size)}; the limit for Base64 is 40 MB.`, true); return; }
        file = f; setStatus('Encoding…');
        dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
        if (dataUrl.startsWith('data:;')) dataUrl = 'data:' + U.sniff(new Uint8Array(await f.slice(0, 512).arrayBuffer()))[0] + dataUrl.slice(5);
        out.value = formatted();
        if (/^image\//.test(f.type)) { thumb.src = dataUrl; thumb.style.display = 'block'; } else thumb.style.display = 'none';
        setStatus(`${f.name}: ${fmtSize(f.size)} → ${fmtSize(out.value.length)} of text (Base64 adds about 33%).`);
        return out.value;
      }
      function decode() {
        try {
          const r = parseDataInput(inp.value); decoded = r;
          if (decUrl) URL.revokeObjectURL(decUrl);
          const blob = new Blob([r.bytes], { type: r.mime }); decUrl = URL.createObjectURL(blob);
          decBox.innerHTML = '';
          if (/^image\/(png|jpeg|gif|webp|avif|bmp|x-icon)$/.test(r.mime) || r.mime === 'image/svg+xml') {
            const im = el('img'); im.src = decUrl; im.alt = 'Decoded image'; im.style.cssText = 'max-width:100%;max-height:340px;background:repeating-conic-gradient(#e8e8e8 0 25%,#fff 0 50%) 0 0/12px 12px;border:1px solid #c9d6e4';
            im.onload = () => setStatus(`Decoded ${r.mime} · ${im.naturalWidth}×${im.naturalHeight} · ${fmtSize(r.bytes.length)}`);
            im.onerror = () => setStatus(`Decoded ${fmtSize(r.bytes.length)} of ${r.mime}, but it doesn’t display as an image (damaged?)`, true);
            decBox.append(im);
          } else decBox.append(el('p', 'dim', `Decoded ${esc(fmtSize(r.bytes.length))} of <b>${esc(r.mime)}</b>. No preview for this type.`));
          dlB.href = decUrl; dlB.download = 'decoded.' + r.ext; dlB.hidden = false;
          setStatus(`Decoded ${r.mime} · ${fmtSize(r.bytes.length)}`);
          return r;
        } catch (e) { decoded = null; dlB.hidden = true; decBox.innerHTML = ''; setStatus(e.message, true); return null; }
      }
      drop.onclick = () => pick.click(); drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick.click(); } };
      pick.onchange = () => { if (pick.files[0]) encode(pick.files[0]); pick.value = ''; };
      drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) encode(e.dataTransfer.files[0]); };
      fmtSel.onchange = () => out.value = formatted();
      copyB.onclick = () => out.value && U.copyText(out.value);
      saveB.onclick = () => out.value && U.download(new Blob([out.value], { type: 'text/plain' }), (file ? baseName(file.name) : 'image') + '-base64.txt');
      decB.onclick = decode; inp.oninput = () => { if (inp.value.length > 40 && inp.value.length < 2e6) decode(); };
      bEnc.onclick = () => { mode = 'enc'; show(); }; bDec.onclick = () => { mode = 'dec'; show(); };
      show();
      Object.assign(ctl, { encode, setMode(m) { mode = m; show(); }, decodeText(s) { inp.value = s; return decode(); }, get output() { return out.value; }, setFormat(v) { fmtSel.value = v; out.value = formatted(); }, destroy() { if (decUrl) URL.revokeObjectURL(decUrl); } });
      return ctl;
    }
  });
  alias('base64-to-image', 'base64', { mode: 'dec' });

  /* HEIC / HEIF → JPEG / PNG (libheif, LGPL, unmodified separate file) */
  let heifMod = null;
  async function heif() {
    if (!heifMod) heifMod = (async () => { const f = await U.loadScript('vendor/libheif-bundle.js', 'libheif'); const m = typeof f === 'function' ? await f() : f; return m.HeifDecoder ? m : await m; })();
    return heifMod;
  }
  register({
    id: 'heic', cat: 'img', glyph: 'heic', name: 'HEIC → JPEG / PNG', keywords: 'heic heif iphone apple photo to jpg jpeg png convert',
    desc: 'iPhone HEIC/HEIF photos to JPEG or PNG.',
    accept: '.heic,.heif,image/heic,image/heif', acceptText: 'HEIC and HEIF photos', acceptTest: f => /^(heic|heif|hif)$/.test(extOf(f.name)) || /image\/hei[cf]/.test(f.type), multiple: true, zipName: 'heic-converted',
    options: [
      { key: 'to', label: 'Convert to', type: 'select', value: 'jpeg', options: [['jpeg', 'JPEG'], ['png', 'PNG'], ['webp', 'WebP']] },
      { key: 'q', label: 'Quality', type: 'range', min: 0.3, max: 1, step: 0.01, value: 0.9, fmt: qFmt, show: o => o.to !== 'png' },
      { key: 'all', label: 'Bursts', type: 'checkbox', text: 'Export every image in the file (not just the main one)', value: false }],
    note: 'Decoded with libheif (LGPL-3.0). Metadata is not copied.',
    async each(f, o, ctx) {
      if (f.size > 200 * 1048576) throw new Error('File is too large (over 200 MB)');
      ctx.progress(0.05, 'Loading the HEIC decoder');
      const lh = await heif();
      ctx.progress(0.2, 'Decoding ' + f.name);
      const dec = new lh.HeifDecoder();
      let imgs; try { imgs = dec.decode(new Uint8Array(await f.arrayBuffer())); } catch (e) { imgs = null; }
      if (!imgs || !imgs.length) throw new Error('Not a readable HEIC/HEIF image');
      const list = o.all ? imgs : [imgs[0]], out = [];
      for (let i = 0; i < list.length; i++) {
        ctx.check(); const im = list[i], w = im.get_width(), h = im.get_height(); U.checkDims(w, h);
        ctx.progress(0.3 + 0.6 * i / list.length, `Converting image ${i + 1} of ${list.length}`);
        const id = new ImageData(w, h);
        await new Promise((res, rej) => im.display({ data: id.data, width: w, height: h }, d => d ? res() : rej(new Error('HEIC decoding failed'))));
        const c = U.canvas(w, h), g = c.getContext('2d');
        if (o.to === 'jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); const t = U.canvas(w, h); t.getContext('2d').putImageData(id, 0, 0); g.drawImage(t, 0, 0); } else g.putImageData(id, 0, 0);
        const blob = await U.encodeCanvas(c, U.MIME[o.to], o.q);
        out.push({ name: baseName(f.name) + (list.length > 1 ? '-' + (i + 1) : '') + '.' + EXT[o.to], blob, thumb: true, info: `${w}×${h} · HEIC → ${o.to.toUpperCase()}` });
      }
      imgs.forEach(im => im.free && im.free());
      return out;
    }
  });
  alias('heic-to-jpg', 'heic', { to: 'jpeg' }); alias('heic-to-png', 'heic', { to: 'png' });

  /* PNG / JPG → SVG (ImageTracer, public domain) — runs in a worker so the page stays responsive */
  function traceInWorker(imgd, options) {
    const src = `importScripts(${JSON.stringify(new URL('vendor/imagetracer.js', document.baseURI).href)});
      onmessage = e => { try { postMessage({ svg: ImageTracer.imagedataToSVG(e.data.imgd, e.data.options) }); } catch (err) { postMessage({ error: String(err && err.message || err) }); } };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), w = new Worker(url);
    return { promise: new Promise((res, rej) => { w.onmessage = e => { w.terminate(); URL.revokeObjectURL(url); e.data.error ? rej(new Error(e.data.error)) : res(e.data.svg); }; w.onerror = e => { w.terminate(); URL.revokeObjectURL(url); rej(new Error(e.message || 'Tracing failed')); }; w.postMessage({ imgd: { width: imgd.width, height: imgd.height, data: imgd.data }, options }); }), stop: () => { w.terminate(); URL.revokeObjectURL(url); } };
  }
  const TRACE = {
    logo: { numberofcolors: 8, pathomit: 8, ltres: 1, qtres: 1, colorquantcycles: 3, blurradius: 0, roundcoords: 1 },
    detailed: { numberofcolors: 32, pathomit: 2, ltres: 0.5, qtres: 0.5, roundcoords: 2, colorquantcycles: 3 },
    poster: { numberofcolors: 6, blurradius: 4, blurdelta: 30, pathomit: 12, colorsampling: 2 },
    bw: { numberofcolors: 2, colorsampling: 0, pathomit: 8, blurradius: 1 }
  };
  register({
    id: 'image-to-svg', cat: 'img', glyph: 'trace', name: 'PNG / JPG → SVG', keywords: 'vectorize trace bitmap png jpg to svg vector logo',
    desc: 'Trace a bitmap into an editable SVG vector (best for logos and flat art).',
    accept: 'image/*,.bmp', acceptText: 'PNG, JPEG, WebP, BMP, GIF (logos and flat graphics trace best)', acceptTest: isRaster, multiple: true, zipName: 'traced-svg',
    options: [
      { key: 'preset', label: 'Style', type: 'select', value: 'logo', options: [['logo', 'Logo / flat art'], ['detailed', 'Detailed (more colours)'], ['poster', 'Posterised (smooth)'], ['bw', 'Black & white']] },
      { key: 'colors', label: 'Colours', type: 'range', min: 2, max: 64, step: 1, value: 8, show: o => o.preset !== 'bw' },
      { key: 'max', label: 'Trace size', type: 'select', value: '800', options: [['400', 'Fast (400 px)'], ['800', 'Normal (800 px)'], ['1400', 'Fine (1400 px, slow)']] }],
    note: 'Photos produce very large SVGs; tracing works best on images with flat colours.',
    async each(f, o, ctx) {
      ctx.progress(0.05, 'Decoding ' + f.name);
      const bmp = await U.decodeImage(f);
      let W = bmp.width, H = bmp.height; const s = Math.min(1, +o.max / Math.max(W, H)); W = Math.max(1, Math.round(W * s)); H = Math.max(1, Math.round(H * s));
      const c = U.drawTo(s < 1 ? await U.resizeBitmap(bmp, W, H) : bmp, W, H); const ow = bmp.width, oh = bmp.height; bmp.close();
      const imgd = c.getContext('2d').getImageData(0, 0, W, H);
      const opts = { ...TRACE[o.preset], scale: 1 / s, viewbox: true };
      if (o.preset !== 'bw') opts.numberofcolors = o.colors;
      ctx.progress(0.2, `Tracing ${W}×${H} pixels`);
      const job = traceInWorker(imgd, opts);
      const timer = setInterval(() => { if (ctx.cancelled) job.stop(); }, 200);
      let svg; try { svg = await Promise.race([job.promise, new Promise((_, rej) => { const iv = setInterval(() => { if (ctx.cancelled) { clearInterval(iv); rej(new Error('Cancelled')); } }, 250); job.promise.finally(() => clearInterval(iv)); })]); } finally { clearInterval(timer); }
      // ImageTracer writes width/height of the traced bitmap; set the original size so the SVG drops in at 1:1
      svg = svg.replace(/^<svg ([^>]*)>/, (m, a) => `<svg ${a.replace(/\swidth="[^"]*"|\sheight="[^"]*"|^width="[^"]*"\s?|^height="[^"]*"\s?/g, ' ').trim()} width="${ow}" height="${oh}">`);
      const paths = (svg.match(/<path/g) || []).length;
      return { name: baseName(f.name) + '.svg', blob: new Blob([svg], { type: 'image/svg+xml' }), thumb: true, preview: true, info: `${ow}×${oh} · ${paths.toLocaleString()} paths` };
    }
  });
  alias('png-to-svg', 'image-to-svg'); alias('jpg-to-svg', 'image-to-svg');

  /* Rotate, flip & crop */
  register({
    id: 'rotate-crop', cat: 'img', glyph: 'rotate', name: 'Rotate, flip & crop', keywords: 'rotate flip mirror crop aspect ratio square trim margins batch',
    desc: 'Rotate, mirror and crop many images at once (to a ratio or by margins).',
    accept: 'image/*,.avif,.bmp', acceptText: 'PNG, JPEG, WebP, AVIF, BMP, GIF', acceptTest: isRaster, multiple: true, zipName: 'edited-images',
    options: [
      { key: 'rot', label: 'Rotate', type: 'select', value: '90', options: [['0', 'No rotation'], ['90', '90° clockwise'], ['180', '180°'], ['270', '90° anticlockwise']] },
      { key: 'flip', label: 'Flip', type: 'select', value: 'none', options: [['none', 'No flip'], ['h', 'Mirror horizontally'], ['v', 'Flip vertically']] },
      { key: 'crop', label: 'Crop', type: 'select', value: 'none', options: [['none', 'No crop'], ['1:1', 'Square 1:1 (centre)'], ['4:3', '4:3 (centre)'], ['3:2', '3:2 (centre)'], ['16:9', '16:9 (centre)'], ['9:16', '9:16 portrait (centre)'], ['4:5', '4:5 portrait (centre)'], ['margins', 'Trim margins (px)']] },
      { key: 'mt', label: 'Top', type: 'number', min: 0, step: 1, value: 0, unit: 'px', show: o => o.crop === 'margins' },
      { key: 'mr', label: 'Right', type: 'number', min: 0, step: 1, value: 0, unit: 'px', show: o => o.crop === 'margins' },
      { key: 'mb', label: 'Bottom', type: 'number', min: 0, step: 1, value: 0, unit: 'px', show: o => o.crop === 'margins' },
      { key: 'ml', label: 'Left', type: 'number', min: 0, step: 1, value: 0, unit: 'px', show: o => o.crop === 'margins' },
      { key: 'to', label: 'Save as', type: 'select', value: 'same', options: [['same', 'Same as original'], ['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP']] },
      { key: 'q', label: 'Quality', type: 'range', min: 0.1, max: 1, step: 0.01, value: 0.92, fmt: qFmt, show: o => o.to !== 'png' }],
    note: 'Cropping is applied after rotating. Margins are measured on the rotated image.',
    async each(f, o, ctx) {
      ctx.progress(0.1, 'Decoding ' + f.name);
      const bmp = await U.decodeImage(f);
      try {
        const rot = +o.rot, sw = rot % 180 ? bmp.height : bmp.width, sh = rot % 180 ? bmp.width : bmp.height;
        const r = U.canvas(sw, sh), g = r.getContext('2d');
        g.translate(sw / 2, sh / 2); if (o.flip === 'h') g.scale(-1, 1); if (o.flip === 'v') g.scale(1, -1); g.rotate(rot * Math.PI / 180);
        g.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
        let x = 0, y = 0, w = sw, h = sh;
        if (o.crop === 'margins') { x = Math.max(0, o.ml | 0); y = Math.max(0, o.mt | 0); w = sw - x - Math.max(0, o.mr | 0); h = sh - y - Math.max(0, o.mb | 0); if (w < 1 || h < 1) throw new Error(`The margins are larger than the image (${sw}×${sh})`); }
        else if (o.crop !== 'none') { const [a, b] = o.crop.split(':').map(Number), t = a / b; if (sw / sh > t) { w = Math.round(sh * t); x = Math.round((sw - w) / 2); } else { h = Math.round(sw / t); y = Math.round((sh - h) / 2); } }
        const fmt = o.to === 'same' ? sameFmt(f) : o.to;
        const out = U.drawTo(r, w, h, fmt === 'jpeg' ? '#fff' : null, { sx: x, sy: y, sw: w, sh: h });
        const blob = await U.encodeCanvas(out, U.MIME[fmt], fmt === 'png' ? undefined : o.q);
        return { name: `${baseName(f.name)}-edited.${EXT[fmt]}`, blob, thumb: true, info: `${bmp.width}×${bmp.height} → ${w}×${h}` };
      } finally { bmp.close(); }
    }
  });
  alias('rotate-image', 'rotate-crop'); alias('crop-image', 'rotate-crop', { rot: '0', crop: '1:1' });

  LC.imageInternals = { parseDataInput, buildIco, svgToCanvas };
})();
