'use strict';
/* Lumen Convert — interactive PDF tools: Sign PDF (draw / type / upload, place, flatten) and Organize pages
   (rotate, delete, reorder with thumbnails). Script fonts for typed signatures are Lumen PDF's OFL fonts (../pdf/vendor/fonts). */
(() => {
  const { register, alias, util: U } = LC;
  const { el, esc, baseName, extOf, fmtSize } = U;
  const isPdf = f => f && (f.type === 'application/pdf' || extOf(f.name) === 'pdf');
  const DROP = `<svg viewBox="0 0 24 24"><path d="M12 15V3m0 0-4 4m4-4 4 4"/><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg>`;
  function dropZone(label, accept, onFile) {
    const d = el('div', 'drop', `${DROP}<div><b>${esc(label)}</b> or click to choose</div>`); d.tabIndex = 0;
    const p = el('input'); p.type = 'file'; p.accept = accept; p.className = 'vh';
    d.onclick = () => p.click(); d.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.click(); } };
    p.onchange = () => { if (p.files[0]) onFile(p.files[0]); p.value = ''; };
    d.ondragover = e => { e.preventDefault(); d.classList.add('over'); }; d.ondragleave = () => d.classList.remove('over');
    d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); };
    return [d, p];
  }
  function resultRow(list, head, blob, name, info) {
    list.innerHTML = ''; const url = URL.createObjectURL(blob), li = el('li'), inf = el('div', 'info');
    inf.append(el('span', 'nm', esc(name)), el('small', null, esc(`${fmtSize(blob.size)}${info ? ' · ' + info : ''}`)));
    const a = el('a', 'btn go', 'Download'); a.href = url; a.download = name; li.append(inf, a); list.append(li); list.hidden = head.hidden = false; return url;
  }
  async function renderPage(pdf, n, width) {
    const page = await pdf.getPage(n), v0 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: width / v0.width });
    const c = U.canvas(Math.ceil(vp.width), Math.ceil(vp.height)), g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, canvas: c, viewport: vp }).promise; page.cleanup(); return c;
  }

  /* ---------------- Sign PDF ---------------- */
  const FONTS = [['Dancing Script', 'dancing-script'], ['Great Vibes', 'great-vibes'], ['Caveat', 'caveat'], ['Sacramento', 'sacramento'], ['Allura', 'allura']];
  let fontsP = null;
  const loadFonts = () => fontsP || (fontsP = Promise.all(FONTS.map(async ([fam, file]) => { try { const ff = new FontFace('LC ' + fam, `url(../pdf/vendor/fonts/${file}-latin-400-normal.woff2)`); await ff.load(); document.fonts.add(ff); } catch (e) { /* fallback to cursive */ } })));
  // crop a signature canvas to its ink and return a transparent PNG canvas
  function trimInk(c) {
    const g = c.getContext('2d', { willReadFrequently: true }), d = g.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null; const p = 6; x0 = Math.max(0, x0 - p); y0 = Math.max(0, y0 - p); x1 = Math.min(c.width - 1, x1 + p); y1 = Math.min(c.height - 1, y1 + p);
    const o = U.canvas(x1 - x0 + 1, y1 - y0 + 1); o.getContext('2d').drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height); return o;
  }
  register({
    id: 'sign-pdf', cat: 'pdf', glyph: 'sign', name: 'Sign PDF', keywords: 'sign pdf signature e-sign esign draw type upload initials docusign fill and sign',
    desc: 'Draw, type or upload your signature, place it on the page and save a flattened PDF.',
    render(root) {
      const st = { file: null, bytes: null, pdf: null, page: 1, sig: null, mode: 'draw', color: '#1a2a6c', places: [], width: 0.3, date: false, url: null };
      const cols = el('div', 'cols'), L = el('div'), R = el('div'); cols.append(L, R); root.append(cols);
      L.append(el('div', 'ph', '<span class="phi"></span>Document<span class="right" id="sg-pg"></span>'));
      const lb = el('div', 'box'); L.append(lb);
      const [drop, pick] = dropZone('Drop a PDF here', '.pdf,application/pdf', f => open(f)); lb.append(drop, pick);
      const nav = el('div', 'actions'); nav.style.marginTop = '0'; nav.hidden = true;
      const prev = el('button', 'mini', '◀ Previous'), next = el('button', 'mini', 'Next ▶'), pgl = el('span', 'dim'); [prev, next].forEach(b => b.type = 'button'); nav.append(prev, pgl, next);
      const stage = el('div'); stage.style.cssText = 'position:relative;margin-top:8px;display:none;border:1px solid #c9d6e4;box-shadow:0 2px 8px rgba(0,30,60,.15);touch-action:none;cursor:crosshair';
      const pc = el('canvas'); pc.style.cssText = 'display:block;width:100%'; stage.append(pc);
      const hint = el('p', 'dim', 'Click the page to place your signature. Drag to move it, double-click to remove it.'); hint.style.fontSize = '12.5px'; hint.hidden = true;
      lb.append(nav, stage, hint);
      R.append(el('div', 'ph', '<span class="phi"></span>Signature'));
      const rb = el('div', 'box'); R.append(rb);
      const seg = el('div', 'seg'); for (const [m, l] of [['draw', 'Draw'], ['type', 'Type'], ['upload', 'Upload']]) { const b = el('button', null, l); b.type = 'button'; b.dataset.m = m; b.onclick = () => setMode(m); seg.append(b); } rb.append(seg);
      const panel = el('div'); panel.style.marginTop = '10px'; rb.append(panel);
      // draw
      const pad = el('canvas'); pad.width = 520; pad.height = 180; pad.style.cssText = 'width:100%;max-width:520px;aspect-ratio:520/180;border:1px dashed #9fbad6;border-radius:4px;background:#fff;touch-action:none;cursor:crosshair;display:block';
      const padClear = el('button', 'mini', 'Clear'); padClear.type = 'button';
      let drawing = false, last = null; const pg = pad.getContext('2d'); pg.lineCap = pg.lineJoin = 'round';
      const pp = e => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * pad.width / r.width, (e.clientY - r.top) * pad.height / r.height, e.pressure || 0.5]; };
      pad.onpointerdown = e => { pad.setPointerCapture(e.pointerId); drawing = true; last = pp(e); };
      pad.onpointermove = e => { if (!drawing) return; const p = pp(e); pg.strokeStyle = st.color; pg.lineWidth = 2 + 3.5 * (e.pointerType === 'pen' ? p[2] : 0.6); pg.beginPath(); pg.moveTo(last[0], last[1]); pg.lineTo(p[0], p[1]); pg.stroke(); last = p; };
      pad.onpointerup = () => { drawing = false; updateSig(); };
      padClear.onclick = () => { pg.clearRect(0, 0, pad.width, pad.height); updateSig(); };
      // type
      const tIn = el('input'); tIn.type = 'text'; tIn.placeholder = 'Your name'; tIn.style.cssText = 'width:100%;font-size:16px;padding:6px 8px';
      const tFont = el('select'); tFont.innerHTML = FONTS.map(([f]) => `<option>${f}</option>`).join('');
      const tPrev = el('canvas'); tPrev.width = 520; tPrev.height = 160; tPrev.style.cssText = 'width:100%;max-width:520px;border:1px solid #d6e2ef;border-radius:4px;background:#fff;display:block;margin-top:8px';
      const drawTyped = () => { const g = tPrev.getContext('2d'); g.clearRect(0, 0, 520, 160); if (!tIn.value.trim()) { updateSig(); return; } let s = 80; g.font = `${s}px "LC ${tFont.value}", cursive`; while (g.measureText(tIn.value).width > 490 && s > 20) { s -= 4; g.font = `${s}px "LC ${tFont.value}", cursive`; } g.fillStyle = st.color; g.textBaseline = 'middle'; g.fillText(tIn.value, 15, 85); updateSig(); };
      tIn.oninput = drawTyped; tFont.onchange = drawTyped;
      // upload
      const [upDrop, upPick] = dropZone('Drop a signature image', 'image/*', async f => { const bmp = await U.decodeImage(f); const c = U.drawTo(bmp, bmp.width, bmp.height); bmp.close(); if (upWhite.checked) { const g = c.getContext('2d'), id = g.getImageData(0, 0, c.width, c.height); for (let i = 0; i < id.data.length; i += 4) { const l = (id.data[i] + id.data[i + 1] + id.data[i + 2]) / 3; if (l > 215) id.data[i + 3] = 0; else if (l > 160) id.data[i + 3] = Math.round(id.data[i + 3] * (215 - l) / 55); } g.putImageData(id, 0, 0); } upCanvas = c; updateSig(); });
      let upCanvas = null; const upWhite = el('input'); upWhite.type = 'checkbox'; upWhite.checked = true; const upL = el('label'); upL.style.cssText = 'display:inline-flex;gap:6px;align-items:center;margin-top:8px;font-size:13px'; upL.append(upWhite, document.createTextNode('Make white paper transparent'));
      const opts = el('div', 'form'); opts.style.marginTop = '12px';
      for (const f of [{ key: 'color', label: 'Ink', type: 'select', options: [['#1a2a6c', 'Blue'], ['#111111', 'Black'], ['#0b5d1e', 'Green']] }, { key: 'width', label: 'Size', type: 'range', min: 0.1, max: 0.6, step: 0.01, fmt: v => Math.round(v * 100) + '% of page width' }, { key: 'date', label: 'Date', type: 'checkbox', text: 'Add today’s date under the signature' }])
        for (const n of LC.optionField(f, st[f.key], v => { st[f.key] = v; if (f.key === 'color') { if (st.mode === 'type') drawTyped(); } drawPlaces(); })) opts.append(n);
      const acts = el('div', 'actions'), save = el('button', 'go big', 'Save signed PDF'); save.type = 'button'; save.disabled = true; acts.append(save);
      const note = el('p', 'note', 'This places a visual signature (like most e-sign apps) and flattens it into the page. For a cryptographic digital signature use Lumen PDF.');
      rb.append(opts, acts, note);
      const status = el('p', 'dim'); status.style.fontSize = '13px'; rb.append(status);
      const resHead = el('div', 'ph', '<span class="phi"></span>Result'); resHead.hidden = true; const res = el('ul', 'res'); res.hidden = true; root.append(resHead, res);
      function setMode(m) {
        st.mode = m; [...seg.children].forEach(b => b.classList.toggle('on', b.dataset.m === m)); panel.innerHTML = '';
        if (m === 'draw') panel.append(pad, padClear); else if (m === 'type') { panel.append(tIn, tFont, tPrev); loadFonts().then(drawTyped); } else panel.append(upDrop, upPick, upL);
        updateSig();
      }
      function updateSig() { st.sig = trimInk(st.mode === 'draw' ? pad : st.mode === 'type' ? tPrev : (upCanvas || U.canvas(1, 1))); drawPlaces(); }
      let pageImg = null;
      async function show() {
        const c = await renderPage(st.pdf, st.page, 900); pageImg = c; pc.width = c.width; pc.height = c.height;
        pgl.textContent = `Page ${st.page} of ${st.pdf.numPages}`; prev.disabled = st.page <= 1; next.disabled = st.page >= st.pdf.numPages; drawPlaces();
      }
      function drawPlaces() {
        if (!pageImg) return; const g = pc.getContext('2d'); g.drawImage(pageImg, 0, 0);
        for (const p of st.places.filter(p => p.page === st.page)) {
          if (!st.sig) continue; const w = st.width * pc.width, h = w * st.sig.height / st.sig.width;
          g.drawImage(st.sig, p.x * pc.width - w / 2, p.y * pc.height - h / 2, w, h);
          g.setLineDash([5, 4]); g.strokeStyle = '#2a7fd4'; g.strokeRect(p.x * pc.width - w / 2, p.y * pc.height - h / 2, w, h); g.setLineDash([]);
          if (st.date) { g.fillStyle = '#333'; g.font = `${Math.max(10, pc.width / 60)}px sans-serif`; g.fillText(new Date().toLocaleDateString(), p.x * pc.width - w / 2, p.y * pc.height + h / 2 + pc.width / 45); }
        }
        root.querySelector('#sg-pg').textContent = st.places.length ? `${st.places.length} signature${st.places.length > 1 ? 's' : ''} placed` : '';
        save.disabled = !st.sig || !st.places.length;
        status.textContent = !st.pdf ? 'Open a PDF to start.' : !st.sig ? 'Create your signature on the right.' : !st.places.length ? 'Now click the page where the signature goes.' : '';
      }
      async function open(f) {
        if (!isPdf(f)) { status.textContent = 'Choose a PDF file.'; return; }
        st.file = f; st.bytes = new Uint8Array(await f.arrayBuffer()); st.pdf && st.pdf.destroy(); st.pdf = await U.openPdf(st.bytes); st.page = 1; st.places = [];
        drop.style.display = 'none'; stage.style.display = 'block'; nav.hidden = hint.hidden = false; await show();
      }
      prev.onclick = () => { st.page--; show(); }; next.onclick = () => { st.page++; show(); };
      let drag = null;
      const at = e => { const r = pc.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
      const hit = ([x, y]) => st.places.findIndex(p => { if (p.page !== st.page || !st.sig) return false; const w = st.width, h = w * st.sig.height / st.sig.width * pc.width / pc.height; return Math.abs(x - p.x) < w / 2 && Math.abs(y - p.y) < h / 2; });
      pc.onpointerdown = e => { pc.setPointerCapture(e.pointerId); const q = at(e), i = hit(q); drag = i >= 0 ? { i, dx: st.places[i].x - q[0], dy: st.places[i].y - q[1], moved: false } : { new: q }; };
      pc.onpointermove = e => { if (!drag || drag.new) return; const q = at(e); Object.assign(st.places[drag.i], { x: q[0] + drag.dx, y: q[1] + drag.dy }); drag.moved = true; drawPlaces(); };
      pc.onpointerup = () => { if (drag && drag.new && st.sig) { st.places.push({ page: st.page, x: drag.new[0], y: drag.new[1] }); drawPlaces(); } drag = null; };
      pc.ondblclick = e => { const i = hit(at(e)); if (i >= 0) { st.places.splice(i, 1); drawPlaces(); } };
      async function exportPdf() {
        const L = await U.lib.pdfLib(), pdf = await LC.pdf2Internals.loadLib(st.bytes, st.file.name), pages = pdf.getPages();
        const png = await pdf.embedPng(new Uint8Array(await (await U.encodeCanvas(st.sig, 'image/png')).arrayBuffer()));
        const font = st.date ? await pdf.embedFont(L.StandardFonts.Helvetica) : null;
        for (const p of st.places) {
          const page = pages[p.page - 1], B = LC.pdf2Internals.displayBox(page), w = st.width * B.W, h = w * st.sig.height / st.sig.width;
          const dx = p.x * B.W - w / 2, dy = B.H - p.y * B.H - h / 2, [x, y, rot] = LC.pdf2Internals.toUser(B, dx, dy);
          page.drawImage(png, { x, y, width: w, height: h, rotate: L.degrees(rot) });
          if (font) { const size = Math.max(7, B.W / 70), [tx, ty] = LC.pdf2Internals.toUser(B, dx, dy - size * 1.4); page.drawText(new Date().toLocaleDateString(), { x: tx, y: ty, size, font, color: L.rgb(0.2, 0.2, 0.2), rotate: L.degrees(rot) }); }
        }
        const blob = new Blob([await pdf.save({ useObjectStreams: true })], { type: 'application/pdf' });
        if (st.url) URL.revokeObjectURL(st.url); st.url = resultRow(res, resHead, blob, baseName(st.file.name) + '-signed.pdf', `${st.places.length} signature${st.places.length > 1 ? 's' : ''}, flattened`);
        return blob;
      }
      save.onclick = () => exportPdf().catch(e => { status.textContent = e.message; });
      setMode('draw'); drawPlaces();
      return { open, addFiles: fl => open(fl[0]), setMode, typed(name, font) { setMode('type'); tIn.value = name; if (font) tFont.value = font; return loadFonts().then(drawTyped); }, drawStroke(pts) { pg.strokeStyle = st.color; pg.lineWidth = 4; pg.beginPath(); pts.forEach(([x, y], i) => i ? pg.lineTo(x, y) : pg.moveTo(x, y)); pg.stroke(); updateSig(); }, place(page, x, y) { st.places.push({ page, x, y }); drawPlaces(); }, set(k, v) { st[k] = v; drawPlaces(); }, exportPdf, get sig() { return st.sig; }, destroy() { st.pdf && st.pdf.destroy(); if (st.url) URL.revokeObjectURL(st.url); } };
    }
  });
  alias('esign', 'sign-pdf'); alias('fill-and-sign', 'sign-pdf');

  /* ---------------- Organize pages ---------------- */
  register({
    id: 'organize-pdf', cat: 'pdf', glyph: 'pages', name: 'Rotate, reorder & delete pages', keywords: 'organize pdf pages rotate reorder delete remove move sort rearrange page order',
    desc: 'See every page as a thumbnail; rotate, delete and drag pages into a new order.',
    render(root) {
      const st = { file: null, bytes: null, plan: [], thumbs: [], url: null };
      const box = el('div', 'box'); root.append(box);
      const [drop, pick] = dropZone('Drop a PDF here', '.pdf,application/pdf', f => open(f)); box.append(drop, pick);
      const bar = el('div', 'actions'); bar.hidden = true; bar.style.marginTop = '0';
      const rotAll = el('button', null, '⟳ Rotate all'), rev = el('button', null, 'Reverse order'), reset = el('button', null, 'Reset'), save = el('button', 'go big', 'Save PDF'); [rotAll, rev, reset, save].forEach(b => b.type = 'button');
      const info = el('span', 'dim'); bar.append(save, rotAll, rev, reset, info); box.append(bar);
      const grid = el('div'); grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:12px'; box.append(grid);
      const resHead = el('div', 'ph', '<span class="phi"></span>Result'); resHead.hidden = true; const res = el('ul', 'res'); res.hidden = true; root.append(resHead, res);
      let dragFrom = -1;
      function draw() {
        grid.innerHTML = '';
        st.plan.forEach((p, k) => {
          const card = el('div'); card.draggable = true; card.style.cssText = 'border:1px solid #d6e2ef;border-radius:5px;padding:8px;background:linear-gradient(#fff,#f7fafd);text-align:center';
          const th = st.thumbs[p.i], wrap = el('div'); wrap.style.cssText = 'height:150px;display:flex;align-items:center;justify-content:center';
          const img = el('img'); img.src = th; img.alt = `Page ${p.i + 1}`; img.style.cssText = `max-width:${p.rot % 180 ? 150 : 130}px;max-height:${p.rot % 180 ? 120 : 145}px;transform:rotate(${p.rot}deg);box-shadow:0 1px 4px rgba(0,0,0,.3);transition:transform .15s`; wrap.append(img);
          const lab = el('div', 'dim', `${k + 1} <span style="font-size:11px">(was ${p.i + 1})</span>`); lab.style.fontSize = '12.5px';
          const btns = el('div'); btns.style.cssText = 'display:flex;gap:3px;justify-content:center;margin-top:4px';
          const mk = (t, title, fn) => { const b = el('button', 'mini', t); b.type = 'button'; b.title = title; b.setAttribute('aria-label', title + ' page ' + (k + 1)); b.onclick = fn; btns.append(b); return b; };
          mk('◀', 'Move left', () => { if (k > 0) { [st.plan[k - 1], st.plan[k]] = [st.plan[k], st.plan[k - 1]]; draw(); } }).disabled = k === 0;
          mk('⟲', 'Rotate left', () => { p.rot = (p.rot + 270) % 360; draw(); });
          mk('⟳', 'Rotate right', () => { p.rot = (p.rot + 90) % 360; draw(); });
          mk('✕', 'Delete', () => { st.plan.splice(k, 1); draw(); });
          mk('▶', 'Move right', () => { if (k < st.plan.length - 1) { [st.plan[k + 1], st.plan[k]] = [st.plan[k], st.plan[k + 1]]; draw(); } }).disabled = k === st.plan.length - 1;
          card.ondragstart = () => { dragFrom = k; card.style.opacity = '.5'; }; card.ondragend = () => card.style.opacity = '';
          card.ondragover = e => e.preventDefault(); card.ondrop = e => { e.preventDefault(); if (dragFrom < 0 || dragFrom === k) return; const [m] = st.plan.splice(dragFrom, 1); st.plan.splice(k, 0, m); dragFrom = -1; draw(); };
          card.append(wrap, lab, btns); grid.append(card);
        });
        info.textContent = `${st.plan.length} page${st.plan.length === 1 ? '' : 's'}${st.thumbs.length !== st.plan.length ? ` (${st.thumbs.length - st.plan.length} deleted)` : ''}`;
        save.disabled = !st.plan.length;
      }
      async function open(f) {
        if (!isPdf(f)) return; st.file = f; st.bytes = new Uint8Array(await f.arrayBuffer());
        const pdf = await U.openPdf(st.bytes); st.thumbs = [];
        try { for (let n = 1; n <= pdf.numPages; n++) { info.textContent = `Loading page ${n} of ${pdf.numPages}…`; const c = await renderPage(pdf, n, 220); st.thumbs.push(c.toDataURL('image/jpeg', 0.8)); c.width = 0; if (n > 400) break; } } finally { pdf.destroy(); }
        st.plan = st.thumbs.map((_, i) => ({ i, rot: 0 })); drop.style.display = 'none'; bar.hidden = false; draw();
      }
      rotAll.onclick = () => { st.plan.forEach(p => p.rot = (p.rot + 90) % 360); draw(); };
      rev.onclick = () => { st.plan.reverse(); draw(); };
      reset.onclick = () => { st.plan = st.thumbs.map((_, i) => ({ i, rot: 0 })); draw(); };
      async function exportPdf() {
        const L = await U.lib.pdfLib(), src = await LC.pdf2Internals.loadLib(st.bytes, st.file.name), out = await L.PDFDocument.create();
        const pages = await out.copyPages(src, st.plan.map(p => p.i));
        pages.forEach((pg, k) => { pg.setRotation(L.degrees((pg.getRotation().angle + st.plan[k].rot) % 360)); out.addPage(pg); });
        out.setTitle(src.getTitle() || baseName(st.file.name)); if (src.getAuthor()) out.setAuthor(src.getAuthor());
        const blob = new Blob([await out.save({ useObjectStreams: true })], { type: 'application/pdf' });
        if (st.url) URL.revokeObjectURL(st.url); st.url = resultRow(res, resHead, blob, baseName(st.file.name) + '-organized.pdf', `${st.plan.length} pages`);
        return blob;
      }
      save.onclick = () => exportPdf();
      return { open, addFiles: fl => open(fl[0]), get plan() { return st.plan; }, set plan(p) { st.plan = p; draw(); }, exportPdf, destroy() { if (st.url) URL.revokeObjectURL(st.url); } };
    }
  });
  alias('rotate-pdf', 'organize-pdf'); alias('delete-pdf-pages', 'organize-pdf'); alias('reorder-pdf', 'organize-pdf');
})();
