'use strict';
/* Lumen Convert — core: tool registry, shared helpers, lazy library loading and the generic
   "drop files → options → Convert → results" tool UI. Everything runs locally; no network. */
window.LC = (() => {
  const tools = [], byId = {}, aliases = {};
  const CATS = [
    { id: 'img', name: 'Images', cls: 'c-img' },
    { id: 'pdf', name: 'PDF', cls: 'c-pdf' },
    { id: 'av', name: 'Audio & video', cls: 'c-av' },
    { id: 'data', name: 'Data & text', cls: 'c-data' }];

  /* ---------- tiny helpers ---------- */
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB' : n < 1073741824 ? (n / 1048576).toFixed(n < 10485760 ? 2 : 1) + ' MB' : (n / 1073741824).toFixed(2) + ' GB';
  const baseName = n => String(n || 'file').replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') || 'file';
  const extOf = n => ((String(n).match(/\.([^.\\/]+)$/) || [, ''])[1]).toLowerCase();
  const safeName = n => String(n).replace(/[\u0000-\u001f<>:"/\\|?*]+/g, '_').replace(/^\.+/, '').slice(0, 180) || 'file';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const tick = () => new Promise(r => setTimeout(r, 0));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  let toastT;
  function toast(msg) {
    let t = document.querySelector('.toast'); if (!t) { t = el('div', 'toast'); t.setAttribute('role', 'status'); document.body.appendChild(t); }
    t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2200);
  }
  async function copyText(s) {
    try { await navigator.clipboard.writeText(s); toast('Copied to clipboard'); }
    catch (e) { const ta = el('textarea'); ta.value = s; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast('Copied to clipboard'); } catch (e2) { toast('Copy failed: select the text and press Ctrl+C'); } ta.remove(); }
  }
  function download(blob, name) {
    const a = el('a'); a.href = URL.createObjectURL(blob); a.download = safeName(name); document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  /* ---------- lazy library loading (local vendor files only) ---------- */
  const loaded = {};
  function loadScript(src, globalName) {
    if (globalName && window[globalName]) return Promise.resolve(window[globalName]);
    return loaded[src] || (loaded[src] = new Promise((res, rej) => {
      const s = el('script'); s.src = src; s.onload = () => res(globalName ? window[globalName] : true);
      s.onerror = () => { delete loaded[src]; rej(new Error('Could not load ' + src)); }; document.head.appendChild(s);
    }));
  }
  const vendorUrl = p => new URL('vendor/' + p, document.baseURI).href;
  const lib = {
    fflate: () => loadScript('vendor/fflate.js', 'fflate'),
    pdfLib: () => loadScript('vendor/pdf-lib.min.js', 'PDFLib'),
    lame: () => loadScript('vendor/lamejs.js', 'lamejs'),
    yaml: () => loadScript('vendor/js-yaml.min.js', 'jsyaml'),
    marked: () => loadScript('vendor/marked.umd.js', 'marked'),
    purify: () => loadScript('vendor/purify.min.js', 'DOMPurify'),
    mp4: () => loadScript('vendor/mp4-muxer.js', 'Mp4Muxer'),
    webm: () => loadScript('vendor/webm-muxer.js', 'WebMMuxer'),
    gifenc: () => loaded.gifenc || (loaded.gifenc = import(vendorUrl('gifenc.esm.js'))),
    pdfjs: () => loaded.pdfjs || (loaded.pdfjs = import(vendorUrl('pdfjs/pdf.min.js')).then(m => { m.GlobalWorkerOptions.workerSrc = vendorUrl('pdfjs/pdf.worker.min.js'); return m; }))
  };
  // Open a PDF with pdf.js — fonts, cMaps and wasm come from the local vendor folder.
  async function openPdf(bytes, password) {
    const pdfjs = await lib.pdfjs(), base = vendorUrl('pdfjs/');
    const task = pdfjs.getDocument({ data: bytes.slice(), password: password || undefined, cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/',
      wasmUrl: base + 'wasm/', iccUrl: base + 'iccs/', isEvalSupported: false, enableXfa: false, verbosity: 0 });
    try { return await task.promise; }
    catch (e) {
      if (e && e.name === 'PasswordException') throw new Error(password ? 'The password is wrong.' : 'This PDF is password-protected. Enter its password in the options and try again.');
      throw new Error('Not a readable PDF (' + (e && e.message || e) + ')');
    }
  }
  async function zipResults(results, name) {
    const ff = await lib.fflate(), files = {}, used = new Set();
    for (const r of results) {
      let n = safeName(r.name), i = 2; const b = baseName(n), x = extOf(n);
      while (used.has(n.toLowerCase())) n = `${b} (${i++})${x ? '.' + x : ''}`;
      used.add(n.toLowerCase());
      const data = new Uint8Array(await r.blob.arrayBuffer());
      files[n] = [data, { level: /^(png|jpe?g|webp|gif|avif|mp3|m4a|ogg|flac|mp4|webm|zip|pdf)$/.test(x) ? 0 : 6 }];
    }
    return new Blob([ff.zipSync(files)], { type: 'application/zip' });
  }

  /* ---------- image helpers ---------- */
  const MAX_PIXELS = 120e6;
  function checkDims(w, h) {
    if (!w || !h) throw new Error('The image has no size');
    if (w > 32767 || h > 32767 || w * h > MAX_PIXELS) throw new Error(`The image is too large to process in the browser (${w}×${h})`);
  }
  async function decodeImage(blob) {
    let bmp;
    try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
    catch (e) {
      // fall back to <img> (handles SVG and a few codecs createImageBitmap rejects)
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image(); img.decoding = 'async'; img.src = url;
        await img.decode().catch(() => { throw new Error('Not a supported image, or the file is damaged'); });
        checkDims(img.naturalWidth, img.naturalHeight);
        bmp = await createImageBitmap(img);
      } finally { URL.revokeObjectURL(url); }
    }
    try { checkDims(bmp.width, bmp.height); } catch (e) { bmp.close(); throw e; }
    return bmp;
  }
  function canvas(w, h) { checkDims(w, h); const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  const MIME = { png: 'image/png', jpeg: 'image/jpeg', jpg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif' };
  function encodeCanvas(c, type, quality) {
    return new Promise((res, rej) => c.toBlob(b => {
      if (!b) return rej(new Error('Encoding failed (out of memory?)'));
      if (b.type !== type) return rej(new Error(`This browser can’t encode ${type.split('/')[1].toUpperCase()}`));
      res(b);
    }, type, quality));
  }
  // draw a bitmap into a new canvas of size w×h, optionally with a solid background (for JPEG)
  function drawTo(src, w, h, bg, opts = {}) {
    const c = canvas(w, h), g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    if (opts.sx != null) g.drawImage(src, opts.sx, opts.sy, opts.sw, opts.sh, opts.dx || 0, opts.dy || 0, opts.dw || w, opts.dh || h);
    else g.drawImage(src, 0, 0, w, h);
    return c;
  }
  // high-quality downscale: halve repeatedly, then a final resize (avoids aliasing on big reductions)
  async function resizeBitmap(bmp, w, h) {
    let src = bmp, sw = bmp.width, sh = bmp.height;
    try {
      return await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    } catch (e) {
      while (sw / 2 >= w && sh / 2 >= h) { sw = Math.round(sw / 2); sh = Math.round(sh / 2); src = drawTo(src, sw, sh); }
      return drawTo(src, w, h);
    }
  }
  const sniff = b => { // magic-byte type detection for decoded base64 etc.
    const s = (o, n) => String.fromCharCode(...b.subarray(o, o + n));
    if (b[0] === 0x89 && s(1, 3) === 'PNG') return ['image/png', 'png'];
    if (b[0] === 0xFF && b[1] === 0xD8) return ['image/jpeg', 'jpg'];
    if (s(0, 4) === 'GIF8') return ['image/gif', 'gif'];
    if (s(0, 4) === 'RIFF' && s(8, 4) === 'WEBP') return ['image/webp', 'webp'];
    if (s(0, 4) === 'RIFF' && s(8, 4) === 'WAVE') return ['audio/wav', 'wav'];
    if (s(4, 4) === 'ftyp') return /avif|avis/.test(s(8, 4)) ? ['image/avif', 'avif'] : ['video/mp4', 'mp4'];
    if (s(0, 2) === 'BM') return ['image/bmp', 'bmp'];
    if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return ['image/x-icon', 'ico'];
    if (s(0, 5) === '%PDF-') return ['application/pdf', 'pdf'];
    if (s(0, 4) === 'PK\u0003\u0004') return ['application/zip', 'zip'];
    if (s(0, 4) === 'fLaC') return ['audio/flac', 'flac'];
    if (s(0, 4) === 'OggS') return ['audio/ogg', 'ogg'];
    if (s(0, 3) === 'ID3' || (b[0] === 0xFF && (b[1] & 0xE0) === 0xE0)) return ['audio/mpeg', 'mp3'];
    if (b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) return ['video/webm', 'webm'];
    const head = new TextDecoder().decode(b.subarray(0, 256)).trim().toLowerCase();
    if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return ['image/svg+xml', 'svg'];
    return ['application/octet-stream', 'bin'];
  };

  /* ---------- glyphs (24×24 stroke icons, white on a glossy category tile) ---------- */
  const G = {
    convert: '<rect x="3" y="4" width="11" height="9" rx="1"/><path d="m5 11 3-3 2 2 2-2"/><path d="M16 9h4l-2-2m2 2-2 2"/><rect x="10" y="14" width="11" height="7" rx="1"/><path d="M8 13v4h2"/>',
    resize: '<rect x="3" y="9" width="12" height="12" rx="1"/><path d="M13 3h8v8M21 3l-8 8"/>',
    compress: '<path d="M4 4l6 6M10 5v5H5M20 20l-6-6M14 19v-5h5M20 4l-6 6M19 10h-5V5M4 20l6-6M5 14h5v5"/>',
    svg: '<path d="M12 3 4 12l8 9 8-9z"/><circle cx="12" cy="12" r="2"/><path d="M12 3v7"/>',
    ico: '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="15" width="5" height="5" rx="1"/><rect x="14" y="15" width="5" height="5" rx="1"/>',
    b64: '<text x="2" y="16" style="font-size:11px">64</text><path d="M3 20h18M3 4h18"/>',
    imgpdf: '<rect x="3" y="3" width="9" height="8" rx="1"/><path d="m4 10 3-3 4 4"/><path d="M13 7h3l-1.5-1.5M16 7l-1.5 1.5"/><path d="M14 10h6l1 1v10H13V11z"/>',
    pdfimg: '<path d="M4 3h6l2 2v9H4z"/><path d="M13 13h2l-1-1m1 1-1 1"/><rect x="12" y="11" width="9" height="10" rx="1"/><path d="m13 19 3-3 4 4"/>',
    merge: '<path d="M4 3h6v8H4zM14 3h6v8h-6z"/><path d="M7 11v3l5 3 5-3v-3M12 17v4"/>',
    split: '<path d="M8 3h8v8H8z"/><path d="M12 11v3l-5 3v4M12 14l5 3v4"/>',
    text: '<path d="M5 3h10l4 4v14H5z"/><path d="M8 10h8M8 14h8M8 18h5"/>',
    audio: '<path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    extract: '<rect x="2" y="5" width="13" height="10" rx="1"/><path d="m15 9 5-3v8l-5-3"/><path d="M8 19v-2"/><path d="M5 21h6"/><path d="M14 19a3 3 0 1 0 6 0v-1"/>',
    gif: '<rect x="2" y="5" width="20" height="14" rx="2"/><text x="4.5" y="15.5" style="font-size:8.5px">GIF</text>',
    video: '<rect x="2" y="6" width="14" height="12" rx="1.5"/><path d="m16 10 6-3v10l-6-3"/><path d="m7 10 4 2-4 2z"/>',
    csv: '<path d="M4 4h16v16H4zM4 9h16M4 14h16M10 4v16"/>',
    yaml: '<path d="M8 4c-3 0-2 4-3 6l-2 2 2 2c1 2 0 6 3 6M16 4c3 0 2 4 3 6l2 2-2 2c-1 2 0 6-3 6"/><path d="M10 9h4M10 12h4M10 15h3"/>',
    md: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 15V9l3 3 3-3v6M16 9v6m-2-2 2 2 2-2"/>',
    color: '<circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.5"/><circle cx="12" cy="7.5" r="1.5"/><circle cx="16" cy="10" r="1.5"/><path d="M13 21c-2-2 0-5 3-4"/>',
    units: '<path d="M3 16 16 3l5 5L8 21z"/><path d="m7 12 2 2M10 9l2 2M13 6l2 2"/>'
  };
  const glyph = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${G[name] || G.convert}</svg>`;
  const catOf = id => CATS.find(c => c.id === id);
  const iconHtml = t => `<span class="ico ${catOf(t.cat).cls}">${glyph(t.glyph)}</span>`;

  function register(t) { t.keywords = t.keywords || ''; tools.push(t); byId[t.id] = t; }
  function alias(slug, id, preset) { aliases[slug] = { id, preset: preset || {} }; }

  /* ---------- generic file tool UI ---------- */
  const DROP_SVG = '<svg viewBox="0 0 24 24"><path d="M12 15V3m0 0-4 4m4-4 4 4"/><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg>';

  function optionField(f, val, onChange) {
    const id = 'o-' + f.key, row = [];
    const lab = el('label', null, esc(f.label)); lab.htmlFor = id; row.push(lab);
    const ctl = el('div', 'ctl'); let input;
    if (f.type === 'select') {
      input = el('select'); input.id = id;
      for (const [v, l] of f.options) { const o = el('option', null, esc(l)); o.value = v; input.appendChild(o); }
      input.value = val; input.onchange = () => onChange(input.value);
    } else if (f.type === 'range') {
      input = el('input'); input.type = 'range'; input.id = id; Object.assign(input, { min: f.min, max: f.max, step: f.step || 1 }); input.value = val;
      const out = el('output'); const show = v => out.textContent = f.fmt ? f.fmt(+v) : v; show(val);
      input.oninput = () => { show(input.value); onChange(+input.value); }; ctl.append(input, out); input = null;
    } else if (f.type === 'number') {
      input = el('input'); input.type = 'number'; input.id = id; Object.assign(input, { min: f.min ?? '', max: f.max ?? '', step: f.step || 'any' }); input.value = val;
      input.oninput = () => { if (input.value !== '') onChange(+input.value); };
      if (f.unit) { ctl.append(input, el('span', 'dim', esc(f.unit))); input = null; }
    } else if (f.type === 'checkbox') {
      input = el('input'); input.type = 'checkbox'; input.id = id; input.checked = !!val; input.onchange = () => onChange(input.checked);
      if (f.text) { const l2 = el('label'); l2.style.display = 'inline-flex'; l2.style.gap = '6px'; l2.style.alignItems = 'center'; l2.append(input, document.createTextNode(f.text)); ctl.append(l2); input = null; }
    } else if (f.type === 'checks') {
      const wrap = el('div', 'checks'); const cur = new Set(val);
      for (const [v, l] of f.options) {
        const l2 = el('label'), cb = el('input'); cb.type = 'checkbox'; cb.checked = cur.has(v);
        cb.onchange = () => { cb.checked ? cur.add(v) : cur.delete(v); onChange(f.options.map(o => o[0]).filter(x => cur.has(x))); };
        l2.append(cb, document.createTextNode(l)); wrap.append(l2);
      }
      ctl.append(wrap); input = null; lab.htmlFor = '';
    } else if (f.type === 'color') {
      input = el('input'); input.type = 'color'; input.id = id; input.value = val; input.oninput = () => onChange(input.value);
    } else { // text / password
      input = el('input'); input.type = f.type === 'password' ? 'password' : 'text'; input.id = id; input.value = val ?? ''; input.placeholder = f.placeholder || '';
      input.spellcheck = false; input.autocomplete = 'off'; input.style.width = '100%'; input.oninput = () => onChange(input.value);
    }
    if (input) ctl.append(input);
    row.push(ctl);
    if (f.hint) row.push(el('div', 'hint', esc(f.hint)));
    return row;
  }

  // Mount a file tool into `root`. Returns a controller (also used by the scripted tests).
  function mountFileTool(t, root, preset) {
    const opts = {}; for (const f of t.options || []) opts[f.key] = f.value; Object.assign(opts, preset || {});
    let files = [], results = [], busy = false, cancelled = false, urls = [];
    const cols = el('div', 'cols');
    const left = el('div'), right = el('div');
    left.append(el('div', 'ph', `<span class="phi"></span>${t.multiple ? 'Files' : 'File'}<span class="right" id="fcount"></span>`));
    const lbox = el('div', 'box'); left.append(lbox);
    const drop = el('div', 'drop', `${DROP_SVG}<div><b>Drop ${t.multiple ? 'files' : 'a file'} here</b> or click to choose</div><div class="acc">${esc(t.acceptText || '')}</div>`);
    drop.tabIndex = 0; drop.setAttribute('role', 'button'); drop.setAttribute('aria-label', 'Choose files');
    const picker = el('input'); picker.type = 'file'; picker.accept = t.accept || ''; picker.multiple = !!t.multiple; picker.className = 'vh'; picker.tabIndex = -1;
    const list = el('ul', 'files');
    lbox.append(drop, picker, list);
    right.append(el('div', 'ph', '<span class="phi"></span>Options'));
    const rbox = el('div', 'box'), form = el('div', 'form'); rbox.append(form);
    const actions = el('div', 'actions');
    const go = el('button', 'go big', esc(t.button || 'Convert')); go.type = 'button';
    const clear = el('button', null, 'Clear'); clear.type = 'button';
    actions.append(go, clear); rbox.append(actions);
    if (t.note) rbox.append(el('p', 'note', t.note));
    right.append(rbox); cols.append(left, right);
    const prog = el('div', 'prog'); prog.hidden = true;
    const bar = el('div', 'bar-o'), barI = el('div', 'bar-i'), lbl = el('span', 'lbl'); bar.append(barI);
    const cancel = el('button', 'mini', 'Cancel'); cancel.type = 'button'; prog.append(lbl, bar, cancel);
    const alertBox = el('div', 'alert'); alertBox.hidden = true;
    const resHead = el('div', 'ph', '<span class="phi"></span>Results<span class="right"></span>'); resHead.hidden = true;
    const resList = el('ul', 'res'); resList.hidden = true;
    root.append(cols, prog, alertBox, resHead, resList);

    function renderForm() {
      form.innerHTML = '';
      for (const f of t.options || []) {
        if (f.show && !f.show(opts)) continue;
        for (const n of optionField(f, opts[f.key], v => { const before = (t.options || []).map(g => !g.show || g.show(opts)).join(); opts[f.key] = v; const after = (t.options || []).map(g => !g.show || g.show(opts)).join(); if (before !== after) renderForm(); })) form.append(n);
      }
      if (!form.children.length) form.append(el('div', 'hint full', 'No options needed.'));
    }
    function renderFiles() {
      list.innerHTML = '';
      files.forEach((f, i) => {
        const li = el('li');
        li.append(el('span', 'nm', esc(f.name)), el('span', 'sz', fmtSize(f.size)));
        if (t.reorder && files.length > 1) {
          const up = el('button', 'mini', '▲'), dn = el('button', 'mini', '▼'); up.title = 'Move up'; dn.title = 'Move down'; up.disabled = i === 0; dn.disabled = i === files.length - 1;
          up.onclick = () => { [files[i - 1], files[i]] = [files[i], files[i - 1]]; renderFiles(); };
          dn.onclick = () => { [files[i + 1], files[i]] = [files[i], files[i + 1]]; renderFiles(); };
          li.append(up, dn);
        }
        const x = el('button', 'mini', '✕'); x.title = 'Remove'; x.setAttribute('aria-label', 'Remove ' + f.name); x.onclick = () => { files.splice(i, 1); renderFiles(); }; li.append(x);
        list.append(li);
      });
      left.querySelector('#fcount').textContent = files.length ? `${files.length} file${files.length > 1 ? 's' : ''} · ${fmtSize(files.reduce((a, f) => a + f.size, 0))}` : '';
      go.disabled = busy || files.length < (t.minFiles || 1);
      drop.querySelector('b').textContent = files.length && t.multiple ? 'Drop more files here' : files.length ? 'Drop another file here' : `Drop ${t.multiple ? 'files' : 'a file'} here`;
    }
    function addFiles(fl) {
      const arr = [...fl]; if (!arr.length) return;
      const okType = t.acceptTest || (() => true);
      const bad = arr.filter(f => !okType(f));
      const good = arr.filter(f => okType(f));
      if (t.multiple) files.push(...good); else if (good.length) files = [good[0]];
      renderFiles();
      if (bad.length) showAlert(`Skipped ${bad.map(f => '“' + f.name + '”').join(', ')}: not a supported file type for this converter.`);
      else alertBox.hidden = true;
    }
    function showAlert(msg) { alertBox.textContent = msg; alertBox.hidden = !msg; }
    drop.onclick = () => picker.click();
    drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picker.click(); } };
    picker.onchange = () => { addFiles(picker.files); picker.value = ''; };
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); addFiles(e.dataTransfer.files); };
    clear.onclick = () => { if (busy) return; files = []; clearResults(); renderFiles(); showAlert(''); };
    cancel.onclick = () => { cancelled = true; lbl.textContent = 'Cancelling…'; };

    function clearResults() { urls.forEach(u => URL.revokeObjectURL(u)); urls = []; results = []; resList.innerHTML = ''; resList.hidden = resHead.hidden = true; }
    function setProgress(f, label) { barI.style.width = (clamp(f, 0, 1) * 100).toFixed(1) + '%'; if (label != null) lbl.textContent = label; }

    function renderResults(items, totalIn) {
      resList.innerHTML = ''; const ok = items.filter(r => r.blob);
      for (const r of items) {
        const li = el('li' , r.error ? 'err' : '');
        if (r.error) { li.append(el('span', 'nm', `<b>${esc(r.name)}</b>: ${esc(r.error)}`)); resList.append(li); continue; }
        const url = URL.createObjectURL(r.blob); urls.push(url);
        if (r.thumb) { const im = el('img', 'th'); im.src = url; im.alt = ''; im.loading = 'lazy'; li.append(im); }
        const info = el('div', 'info'); info.append(el('span', 'nm', esc(r.name)));
        info.append(el('small', null, fmtSize(r.blob.size) + (r.info ? ' · ' + r.info : '')));
        li.append(info);
        if (r.text != null) { const b = el('button', null, 'Copy text'); b.type = 'button'; b.onclick = () => copyText(r.text); li.append(b); }
        const a = el('a', 'btn go', 'Download'); a.href = url; a.download = safeName(r.name); li.append(a);
        if (r.audio) { const pv = el('div', 'pv'), au = el('audio'); au.controls = true; au.preload = 'none'; au.src = url; pv.append(au); li.append(pv); }
        if (r.video) { const pv = el('div', 'pv'), v = el('video'); v.controls = true; v.preload = 'metadata'; v.src = url; v.style.height = 'auto'; v.style.maxHeight = '260px'; pv.append(v); li.append(pv); }
        if (r.preview && ok.length <= 3) { const pv = el('div', 'pv'), im = el('img'); im.src = url; im.alt = 'Preview of ' + r.name; pv.append(im); li.append(pv); }
        if (r.text != null && ok.length <= 3) { const pv = el('div', 'pv'), ta = el('textarea'); ta.readOnly = true; ta.value = r.text.length > 200000 ? r.text.slice(0, 200000) + '\n…' : r.text; pv.append(ta); li.append(pv); }
        resList.append(li);
      }
      if (ok.length > 1) {
        const li = el('li'); const za = el('button', 'go', 'Download all (.zip)'); za.type = 'button';
        za.onclick = async () => { za.disabled = true; za.textContent = 'Zipping…'; try { download(await zipResults(ok, t.zipName || 'converted'), (t.zipName || 'lumen-convert') + '.zip'); } catch (e) { showAlert('Could not build the zip: ' + e.message); } za.disabled = false; za.textContent = 'Download all (.zip)'; };
        li.append(el('span', 'nm', `<b>${ok.length} files</b> · ${fmtSize(ok.reduce((a, r) => a + r.blob.size, 0))}`), za); resList.append(li);
      }
      const head = resHead.querySelector('.right'), totalOut = ok.reduce((a, r) => a + r.blob.size, 0), errs = items.length - ok.length;
      head.textContent = `${ok.length} ready${errs ? ` · ${errs} failed` : ''}${t.showSaving && totalIn ? ` · ${fmtSize(totalIn)} → ${fmtSize(totalOut)}` : ''}`;
      resList.hidden = resHead.hidden = false;
    }

    async function run() {
      if (busy || files.length < (t.minFiles || 1)) return results;
      busy = true; cancelled = false; go.disabled = clear.disabled = true; clearResults(); showAlert('');
      prog.hidden = false; setProgress(0, 'Starting…');
      const ctx = {
        progress: setProgress, check() { if (cancelled) throw new Error('Cancelled'); }, get cancelled() { return cancelled; }, tick
      };
      const out = []; const totalIn = files.reduce((a, f) => a + f.size, 0);
      try {
        if (t.each) {
          for (let i = 0; i < files.length; i++) {
            const f = files[i], n = files.length;
            const sub = { ...ctx, progress: (p, l) => setProgress((i + clamp(p, 0, 1)) / n, `${n > 1 ? `File ${i + 1} of ${n}: ` : ''}${l || f.name}`) };
            sub.progress(0);
            try { ctx.check(); const r = await t.each(f, opts, sub); out.push(...[].concat(r)); }
            catch (e) { if (cancelled) { out.push({ name: f.name, error: 'Cancelled' }); break; } console.warn(e); out.push({ name: f.name, error: e.message || String(e) }); }
            await tick();
          }
        } else {
          try { out.push(...[].concat(await t.run(files.slice(), opts, ctx))); }
          catch (e) { if (!cancelled) console.warn(e); out.push({ name: t.multiple && files.length > 1 ? `${files.length} files` : files[0].name, error: cancelled ? 'Cancelled' : (e.message || String(e)) }); }
        }
        setProgress(1, 'Done');
      } finally {
        busy = false; clear.disabled = false; prog.hidden = true; renderFiles();
      }
      results = out; renderResults(out, totalIn);
      return out;
    }
    go.onclick = run;
    renderForm(); renderFiles();
    return {
      addFiles, run, get results() { return results; }, get opts() { return opts; },
      set(k, v) { opts[k] = v; renderForm(); }, destroy() { cancelled = true; clearResults(); }
    };
  }

  return { tools, byId, aliases, CATS, catOf, register, alias, iconHtml, glyph, mountFileTool, optionField,
    util: { esc, el, fmtSize, baseName, extOf, safeName, sleep, tick, clamp, toast, copyText, download, loadScript, lib, openPdf, zipResults,
      decodeImage, canvas, drawTo, resizeBitmap, encodeCanvas, MIME, checkDims, sniff } };
})();
