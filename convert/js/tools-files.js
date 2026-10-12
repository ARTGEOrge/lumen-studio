'use strict';
/* Lumen Convert — archives (ZIP create / extract), QR codes (generate / read), file checksums. */
(() => {
  const { register, alias, util: U } = LC;
  const { esc, el, fmtSize, baseName, extOf } = U;

  /* ---------------- MD5 (incremental, RFC 1321) ---------------- */
  const K = new Int32Array(64).map((_, i) => (Math.abs(Math.sin(i + 1)) * 4294967296) | 0);
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  class MD5 {
    constructor() { this.h = new Int32Array([0x67452301, 0xefcdab89 | 0, 0x98badcfe | 0, 0x10325476]); this.buf = new Uint8Array(64); this.n = 0; this.len = 0; this.w = new Int32Array(16); }
    block(b, o) {
      const w = this.w; for (let i = 0; i < 16; i++) w[i] = b[o + i * 4] | b[o + i * 4 + 1] << 8 | b[o + i * 4 + 2] << 16 | b[o + i * 4 + 3] << 24;
      let [a, bb, c, d] = this.h;
      for (let i = 0; i < 64; i++) {
        let f, g; const r = i >> 4;
        if (r === 0) { f = (bb & c) | (~bb & d); g = i; } else if (r === 1) { f = (d & bb) | (~d & c); g = (5 * i + 1) & 15; } else if (r === 2) { f = bb ^ c ^ d; g = (3 * i + 5) & 15; } else { f = c ^ (bb | ~d); g = (7 * i) & 15; }
        const s = S[r * 4 + (i & 3)], t = (a + f + K[i] + w[g]) | 0; a = d; d = c; c = bb; bb = (bb + ((t << s) | (t >>> (32 - s)))) | 0;
      }
      this.h[0] += a; this.h[1] += bb; this.h[2] += c; this.h[3] += d;
    }
    update(d) {
      let i = 0; this.len += d.length;
      if (this.n) { while (this.n < 64 && i < d.length) this.buf[this.n++] = d[i++]; if (this.n === 64) { this.block(this.buf, 0); this.n = 0; } }
      for (; i + 64 <= d.length; i += 64) this.block(d, i);
      while (i < d.length) this.buf[this.n++] = d[i++];
    }
    hex() {
      const bits = this.len * 8, pad = new Uint8Array(((this.n < 56 ? 56 : 120) - this.n) + 8); pad[0] = 0x80;
      const dv = new DataView(pad.buffer); dv.setUint32(pad.length - 8, bits >>> 0, true); dv.setUint32(pad.length - 4, Math.floor(bits / 4294967296), true);
      this.len -= 0; this.update(pad);
      return [...new Uint8Array(this.h.buffer)].map(x => x.toString(16).padStart(2, '0')).join('');
    }
  }
  const hexOf = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
  const ALGOS = [['md5', 'MD5'], ['sha1', 'SHA-1'], ['sha256', 'SHA-256'], ['sha384', 'SHA-384'], ['sha512', 'SHA-512']];
  async function hashFile(f, algos, ctx) {
    const out = {}, subtle = algos.filter(a => a !== 'md5');
    if (subtle.length && f.size > 2047 * 1048576) throw new Error('SHA hashes are limited to 2 GB files in the browser');
    if (algos.includes('md5')) {
      const m = new MD5(), CH = 8 * 1048576;
      for (let o = 0; o < f.size; o += CH) { ctx.check(); m.update(new Uint8Array(await f.slice(o, o + CH).arrayBuffer())); ctx.progress(o / Math.max(1, f.size) * (subtle.length ? 0.5 : 1), 'MD5'); }
      out.md5 = m.hex();
    }
    if (subtle.length) {
      ctx.progress(0.5, 'Reading'); const data = await f.arrayBuffer();
      for (const a of subtle) { ctx.check(); out[a] = hexOf(await crypto.subtle.digest({ sha1: 'SHA-1', sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' }[a], data)); }
    }
    return out;
  }
  register({
    id: 'checksum', cat: 'files', glyph: 'hash', name: 'File hash / checksum', keywords: 'hash checksum md5 sha1 sha256 sha512 verify integrity download',
    desc: 'MD5, SHA-1, SHA-256 and SHA-512 of any file, and check it against an expected value.',
    acceptText: 'Any file (up to 2 GB for SHA)', multiple: true, button: 'Calculate', zipName: 'checksums',
    options: [
      { key: 'algos', label: 'Algorithms', type: 'checks', value: ['md5', 'sha1', 'sha256', 'sha512'], options: ALGOS },
      { key: 'expect', label: 'Compare with', type: 'text', value: '', placeholder: 'Paste the expected hash (optional)' }],
    async each(f, o, ctx) {
      if (!o.algos.length) throw new Error('Pick at least one algorithm');
      const h = await hashFile(f, o.algos, ctx);
      const exp = (o.expect || '').trim().toLowerCase().replace(/^[a-z0-9-]+:/, '').replace(/\s+/g, '');
      const match = exp ? Object.entries(h).find(([, v]) => v === exp) : null;
      const text = Object.entries(h).map(([k, v]) => `${ALGOS.find(a => a[0] === k)[1].padEnd(8)} ${v}`).join('\n') + '\n';
      const file = Object.entries(h).map(([k, v]) => `${v}  ${f.name}`).join('\n') + '\n';
      return { name: `${f.name}.checksums.txt`, blob: new Blob([`# ${f.name} (${f.size} bytes)\n` + text], { type: 'text/plain' }), text, infoHtml: exp ? (match ? `<span class="good">✓ Matches the expected ${ALGOS.find(a => a[0] === match[0])[1]}</span>` : '<span class="bad">✗ Does not match the expected hash</span>') : fmtSize(f.size), _sumfile: file };
    }
  });
  alias('md5', 'checksum'); alias('sha256', 'checksum');

  /* ---------------- ZIP create ---------------- */
  const STORED = /^(zip|7z|rar|gz|bz2|xz|jpe?g|png|gif|webp|avif|heic|mp3|m4a|aac|ogg|opus|flac|mp4|m4v|mov|webm|mkv|pdf|docx|xlsx|pptx|epub|woff2?)$/;
  register({
    id: 'zip-create', cat: 'files', glyph: 'zip', name: 'Create ZIP', keywords: 'zip compress archive files folder create pack',
    desc: 'Pack files into a .zip archive.',
    acceptText: 'Any files', multiple: true, button: 'Create ZIP',
    options: [
      { key: 'name', label: 'File name', type: 'text', value: 'archive.zip' },
      { key: 'level', label: 'Compression', type: 'select', value: '6', options: [['0', 'None (store only)'], ['1', 'Fast'], ['6', 'Normal'], ['9', 'Maximum']] }],
    note: 'Files that are already compressed (JPEG, MP4, PDF…) are stored as-is, which is faster and just as small.',
    async run(files, o, ctx) {
      const ff = await U.lib.fflate(), parts = []; let err = null;
      const zip = new ff.Zip((e, dat) => { if (e) err = e; else parts.push(dat); });
      const used = new Set(), total = files.reduce((a, f) => a + f.size, 0) || 1; let done = 0;
      for (const f of files) {
        let n = (f.webkitRelativePath || f.name).replace(/\\/g, '/').replace(/^\/+/, '').split('/').filter(p => p && p !== '..' && p !== '.').join('/') || 'file', i = 2;
        const b = n.replace(/(\.[^./]*)?$/, ''), x = n.slice(b.length); while (used.has(n.toLowerCase())) n = `${b} (${i++})${x}`; used.add(n.toLowerCase());
        const lvl = STORED.test(extOf(n)) ? 0 : +o.level;
        const ent = lvl === 0 ? new ff.ZipPassThrough(n) : new ff.ZipDeflate(n, { level: lvl }); ent.mtime = f.lastModified || Date.now(); zip.add(ent);
        const CH = 4 * 1048576;
        if (!f.size) ent.push(new Uint8Array(0), true);
        for (let off = 0; off < f.size; off += CH) {
          ctx.check(); const chunk = new Uint8Array(await f.slice(off, off + CH).arrayBuffer());
          ent.push(chunk, off + CH >= f.size); done += chunk.length; ctx.progress(done / total, `Adding ${n}`); if (err) throw err;
          await U.tick();
        }
      }
      zip.end(); if (err) throw err;
      let name = (o.name || 'archive.zip').trim(); if (!/\.zip$/i.test(name)) name += '.zip';
      const blob = new Blob(parts, { type: 'application/zip' });
      return { name, blob, info: `${files.length} file${files.length > 1 ? 's' : ''} · ${fmtSize(total)} → ${fmtSize(blob.size)}` };
    }
  });

  /* ---------------- ZIP extract ---------------- */
  register({
    id: 'zip-extract', cat: 'files', glyph: 'unzip', name: 'Extract ZIP', keywords: 'unzip extract zip archive open list files decompress',
    desc: 'List what’s inside a .zip and download individual files.',
    accept: '.zip,application/zip,application/x-zip-compressed', acceptText: '.zip archives (not password-protected)', acceptTest: f => /^(zip|jar|apk|cbz|docx|xlsx|pptx|odt|ods|epub)$/.test(extOf(f.name)) || /zip/.test(f.type), multiple: false, button: 'Extract', zipName: 'extracted',
    async each(f, o, ctx) {
      const ff = await U.lib.fflate(), bytes = new Uint8Array(await f.arrayBuffer());
      ctx.progress(0.1, 'Reading the archive');
      const LIMIT = 1024 * 1048576; let declared = 0, count = 0, enc = false;
      // pre-scan: refuse archives that would expand past 1 GB or hold more than 20 000 entries (zip bombs)
      let files;
      try {
        files = ff.unzipSync(bytes, { filter: fi => { count++; declared += fi.originalSize; if (count > 20000) throw new Error('more than 20 000 files'); if (declared > LIMIT) throw new Error('expands to more than 1 GB'); return !fi.name.endsWith('/'); } });
      } catch (e) {
        if (/compression type|unknown|invalid/i.test(e.message) && /encrypt/i.test(e.message + '')) enc = true;
        throw new Error(/expands|20 000/.test(e.message) ? `This archive ${e.message}; that’s too much to extract in the browser` : /compression type 99|99/.test(e.message) ? 'This ZIP is password-protected (AES), which isn’t supported' : `Can’t read this ZIP (${e.message})`);
      }
      const out = []; const names = Object.keys(files); let total = 0;
      for (const n of names) { total += files[n].length; if (total > LIMIT) throw new Error('The archive expands to more than 1 GB'); }
      const MIME = { txt: 'text/plain', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', pdf: 'application/pdf', json: 'application/json', html: 'text/html', svg: 'image/svg+xml', mp3: 'audio/mpeg', mp4: 'video/mp4' };
      for (const n of names) {
        const clean = n.replace(/\\/g, '/').split('/').filter(p => p && p !== '..').join('/');
        const x = extOf(clean);
        out.push({ name: clean, blob: new Blob([files[n]], { type: MIME[x] || 'application/octet-stream' }), thumb: /^(png|jpe?g|gif|webp)$/.test(x), info: clean.includes('/') ? 'in ' + clean.replace(/\/[^/]*$/, '/') : '' });
      }
      if (!out.length) throw new Error('The archive is empty');
      out.sort((a, b) => a.name.localeCompare(b.name));
      return out;
    }
  });
  alias('unzip', 'zip-extract');

  /* ---------------- QR code generator ---------------- */
  const wifiEsc = s => s.replace(/([\\;,:"])/g, '\\$1');
  register({
    id: 'qr-generate', cat: 'files', glyph: 'qr', name: 'QR code generator', keywords: 'qr code generator make create url wifi text vcard png svg barcode',
    desc: 'QR codes for links, text, Wi-Fi, email or contacts, as PNG or SVG.',
    needs: ['qrcode'],
    render(root, preset) {
      const cols = el('div', 'cols'), L = el('div'), R = el('div'); cols.append(L, R); root.append(cols);
      L.append(el('div', 'ph', '<span class="phi"></span>Content'));
      const lb = el('div', 'box'), form = el('div', 'form'); lb.append(form); L.append(lb);
      R.append(el('div', 'ph', '<span class="phi"></span>QR code'));
      const rb = el('div', 'box'); rb.style.textAlign = 'center';
      const cv = el('canvas'); cv.style.cssText = 'max-width:100%;image-rendering:pixelated;border:1px solid #d6e2ef;background:#fff';
      const stat = el('p', 'dim'); const acts = el('div', 'actions'); acts.style.justifyContent = 'center';
      const png = el('button', 'go', 'Download PNG'), svgB = el('button', null, 'Download SVG'), cp = el('button', null, 'Copy SVG'); [png, svgB, cp].forEach(b => b.type = 'button');
      acts.append(png, svgB, cp); rb.append(cv, stat, acts); R.append(rb);
      const st = { type: 'url', text: 'https://example.com', ssid: '', pass: '', sec: 'WPA', hidden: false, email: '', subject: '', body: '', phone: '', sms: '', fn: '', org: '', tel: '', mail: '', web: '', ecc: 'M', scale: 10, margin: 4, fg: '#000000', bg: '#ffffff', ...(preset || {}) };
      const fieldsFor = { url: [['text', 'Link or text', 'textarea']], wifi: [['ssid', 'Network name'], ['pass', 'Password'], ['sec', 'Security', 'select', [['WPA', 'WPA/WPA2/WPA3'], ['WEP', 'WEP'], ['nopass', 'None']]], ['hidden', 'Hidden network', 'checkbox']], email: [['email', 'To'], ['subject', 'Subject'], ['body', 'Message', 'textarea']], tel: [['phone', 'Phone number']], sms: [['phone', 'Phone number'], ['sms', 'Message', 'textarea']], vcard: [['fn', 'Full name'], ['org', 'Organisation'], ['tel', 'Phone'], ['mail', 'Email'], ['web', 'Website']] };
      function payload() {
        const s = st;
        if (s.type === 'url') return s.text;
        if (s.type === 'wifi') return `WIFI:T:${s.sec};S:${wifiEsc(s.ssid)};${s.sec === 'nopass' ? '' : `P:${wifiEsc(s.pass)};`}${s.hidden ? 'H:true;' : ''};`;
        if (s.type === 'email') { const q = [s.subject && 'subject=' + encodeURIComponent(s.subject), s.body && 'body=' + encodeURIComponent(s.body)].filter(Boolean).join('&'); return `mailto:${s.email}${q ? '?' + q : ''}`; }
        if (s.type === 'tel') return 'tel:' + s.phone.replace(/[^\d+*#]/g, '');
        if (s.type === 'sms') return `SMSTO:${s.phone.replace(/[^\d+]/g, '')}:${s.sms}`;
        const v = x => x.replace(/([\\;,])/g, '\\$1').replace(/\n/g, '\\n');
        return ['BEGIN:VCARD', 'VERSION:3.0', `FN:${v(s.fn)}`, s.org && `ORG:${v(s.org)}`, s.tel && `TEL:${v(s.tel)}`, s.mail && `EMAIL:${v(s.mail)}`, s.web && `URL:${v(s.web)}`, 'END:VCARD'].filter(Boolean).join('\n');
      }
      function renderForm() {
        form.innerHTML = '';
        const add = f => { for (const n of LC.optionField(f, st[f.key], v => { st[f.key] = v; if (f.key === 'type') renderForm(); draw(); })) form.append(n); };
        add({ key: 'type', label: 'Type', type: 'select', options: [['url', 'Link / text'], ['wifi', 'Wi-Fi network'], ['email', 'Email'], ['tel', 'Phone call'], ['sms', 'SMS'], ['vcard', 'Contact card']] });
        for (const [k, l, t, opts] of fieldsFor[st.type]) {
          if (t === 'textarea') { const lab = el('label', null, esc(l)), ta = el('textarea'); ta.value = st[k]; ta.rows = 3; ta.style.fontFamily = 'inherit'; ta.oninput = () => { st[k] = ta.value; draw(); }; lab.htmlFor = ta.id = 'q-' + k; form.append(lab, ta); }
          else add({ key: k, label: l, type: t || 'text', options: opts, text: t === 'checkbox' ? 'Yes' : undefined });
        }
        add({ key: 'ecc', label: 'Error correction', type: 'select', options: [['L', 'Low (7%)'], ['M', 'Medium (15%)'], ['Q', 'Quartile (25%)'], ['H', 'High (30%)']] });
        add({ key: 'scale', label: 'Module size', type: 'range', min: 2, max: 30, step: 1, fmt: v => v + ' px' });
        add({ key: 'margin', label: 'Quiet zone', type: 'range', min: 0, max: 10, step: 1, fmt: v => v + ' modules' });
        add({ key: 'fg', label: 'Colour', type: 'color' }); add({ key: 'bg', label: 'Background', type: 'color' });
      }
      let qr = null;
      function make() {
        const data = payload(); if (!data) throw new Error('Enter something to encode');
        const q = window.qrcode(0, st.ecc); window.qrcode.stringToBytes = window.qrcode.stringToBytesFuncs['UTF-8'];
        q.addData(data, 'Byte');
        try { q.make(); } catch (e) { throw new Error('Too much data for a QR code. Shorten it or lower the error correction.'); }
        return q;
      }
      function svgText() {
        const n = qr.getModuleCount(), m = st.margin, size = n + 2 * m; let d = '';
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size * st.scale}" height="${size * st.scale}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${st.bg}"/><path fill="${st.fg}" d="${d}"/></svg>\n`;
      }
      function draw() {
        try { qr = make(); } catch (e) { qr = null; stat.textContent = e.message; stat.style.color = '#a3361c'; cv.width = cv.height = 1; return null; }
        const n = qr.getModuleCount(), m = st.margin, s = st.scale, size = (n + 2 * m) * s;
        cv.width = cv.height = size; const g = cv.getContext('2d'); g.fillStyle = st.bg; g.fillRect(0, 0, size, size); g.fillStyle = st.fg;
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect((c + m) * s, (r + m) * s, s, s);
        cv.style.width = Math.min(size, 360) + 'px';
        stat.style.color = ''; stat.textContent = `Version ${(n - 17) / 4} · ${n}×${n} modules · ${size}×${size} px · ${new TextEncoder().encode(payload()).length} bytes`;
        return payload();
      }
      png.onclick = () => qr && cv.toBlob(b => U.download(b, 'qr-code.png'), 'image/png');
      svgB.onclick = () => qr && U.download(new Blob([svgText()], { type: 'image/svg+xml' }), 'qr-code.svg');
      cp.onclick = () => qr && U.copyText(svgText());
      renderForm(); draw();
      return { set(k, v) { st[k] = v; renderForm(); return draw(); }, png: () => new Promise(r => cv.toBlob(r, 'image/png')), svg: () => qr && svgText(), get payload() { return payload(); } };
    }
  });
  alias('qr-code', 'qr-generate'); alias('wifi-qr', 'qr-generate', { type: 'wifi' });

  /* ---------------- QR code reader ---------------- */
  register({
    id: 'qr-read', cat: 'files', glyph: 'scan', name: 'Read QR code from image', keywords: 'qr code reader scan decode image screenshot photo',
    desc: 'Find and decode QR codes in screenshots and photos.',
    needs: ['jsqr'],
    accept: 'image/*,.bmp,.avif', acceptText: 'PNG, JPEG, WebP, GIF, BMP screenshots or photos', acceptTest: f => /^image\//.test(f.type) || /^(png|jpe?g|webp|gif|bmp|avif)$/.test(extOf(f.name)), multiple: true, button: 'Read', zipName: 'qr-text',
    note: 'If a photo doesn’t read, crop it closer to the code and try again.',
    async each(f, o, ctx) {
      const jsQR = await U.lib.jsqr(); ctx.progress(0.1, 'Decoding ' + f.name);
      const bmp = await U.decodeImage(f);
      try {
        let hit = null;
        for (const max of [1200, 2000, 700, 400]) {
          ctx.check();
          const s = Math.min(1, max / Math.max(bmp.width, bmp.height)), w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
          const c = U.drawTo(bmp, w, h, '#fff'), id = c.getContext('2d').getImageData(0, 0, w, h);
          hit = jsQR(id.data, w, h, { inversionAttempts: 'attemptBoth' }); if (hit) break; await U.tick();
        }
        if (!hit) throw new Error('No QR code found in this image');
        const text = hit.data;
        const kind = /^https?:\/\//i.test(text) ? 'Link' : /^WIFI:/i.test(text) ? 'Wi-Fi network' : /^BEGIN:VCARD/i.test(text) ? 'Contact' : /^mailto:/i.test(text) ? 'Email' : 'Text';
        return { name: baseName(f.name) + '-qr.txt', blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), text, info: `${kind} · version ${hit.version} · ${text.length} characters` };
      } finally { bmp.close(); }
    }
  });

  LC.filesInternals = { MD5, hashFile };
})();
