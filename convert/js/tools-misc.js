'use strict';
/* Lumen Convert — RAW → JPEG/PNG (LibRaw, shared from ../photo), PSD → PNG/JPEG (ag-psd, shared from ../photo),
   3D model converter (three.js subset), font converter (TTF/OTF ⇄ WOFF/WOFF2), barcode generator (Code 128, EAN-13, EAN-8, UPC-A). */
(() => {
  const { register, alias, util: U } = LC;
  const { el, esc, baseName, extOf, fmtSize } = U;
  const EXT = { png: 'png', jpeg: 'jpg', webp: 'webp' };
  const qFmt = v => Math.round(v * 100) + '%';

  /* ---------------- RAW → JPEG / PNG ---------------- */
  const RAW_EXT = /^(dng|cr2|cr3|crw|nef|nrw|arw|srf|sr2|orf|rw2|raf|pef|srw|x3f|3fr|erf|kdc|mef|mos|mrw|raw|rwl|iiq)$/;
  async function embeddedPreview(buf) { // largest decodable JPEG embedded in the RAW (cameras store a full-size preview)
    const b = new Uint8Array(buf); const cands = [];
    for (let i = 0; i < b.length - 3; i++) if (b[i] === 0xFF && b[i + 1] === 0xD8 && b[i + 2] === 0xFF) { for (let j = i + 2; j < b.length - 1; j++) if (b[j] === 0xFF && b[j + 1] === 0xD9) { if (j - i > 20000) cands.push([i, j + 2]); break; } }
    cands.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]));
    for (const [s, e] of cands.slice(0, 4)) { try { return await createImageBitmap(new Blob([b.subarray(s, e)], { type: 'image/jpeg' })); } catch (er) { /* try next */ } }
    return null;
  }
  register({
    id: 'raw-convert', cat: 'img', glyph: 'raw', name: 'RAW → JPEG / PNG', keywords: 'raw camera dng cr2 cr3 nef arw orf rw2 raf pef convert develop jpg png canon nikon sony fuji',
    desc: 'Develop camera RAW files (DNG, CR2, CR3, NEF, ARW, RAF, ORF, RW2…) to JPEG or PNG.',
    accept: '.dng,.cr2,.cr3,.crw,.nef,.nrw,.arw,.srf,.sr2,.orf,.rw2,.raf,.pef,.srw,.x3f,.3fr,.erf,.kdc,.mef,.mos,.mrw,.raw,.rwl,.iiq', acceptText: 'Camera RAW files (most brands)', acceptTest: f => RAW_EXT.test(extOf(f.name)), multiple: true, zipName: 'developed',
    options: [
      { key: 'to', label: 'Save as', type: 'select', value: 'jpeg', options: [['jpeg', 'JPEG'], ['png', 'PNG'], ['webp', 'WebP']] },
      { key: 'q', label: 'Quality', type: 'range', min: 0.5, max: 1, step: 0.01, value: 0.92, fmt: qFmt, show: o => o.to !== 'png' },
      { key: 'wb', label: 'White balance', type: 'select', value: 'camera', options: [['camera', 'As shot'], ['auto', 'Auto']] },
      { key: 'bright', label: 'Brightness', type: 'checkbox', text: 'Auto brighten', value: true },
      { key: 'half', label: 'Size', type: 'checkbox', text: 'Half size (much faster)', value: false }],
    note: 'Developed with LibRaw (WebAssembly, shared with Lumen Photo). If a camera isn’t supported, the full-size JPEG preview stored in the RAW is used instead, and the result says so.',
    async each(f, o, ctx) {
      if (f.size > 400 * 1048576) throw new Error('File is too large');
      const buf = await f.arrayBuffer(); let bmp = null, note = '';
      ctx.progress(0.1, 'Developing ' + f.name + ' (this can take a few seconds)');
      try {
        if (!self.crossOriginIsolated) throw new Error('needs cross-origin isolation');
        const LibRaw = (await import(new URL('../photo/vendor/libraw/index.js', document.baseURI).href)).default, raw = new LibRaw();
        try {
          // LibRaw transfers (detaches) the buffer it gets, so hand it a copy
          await raw.open(new Uint8Array(buf.slice(0)), { useCameraWb: o.wb === 'camera', useAutoWb: o.wb === 'auto', outputBps: 8, outputColor: 1, userQual: 3, noAutoBright: !o.bright, halfSize: o.half });
          const im = await raw.imageData(); if (!im) throw new Error('no image');
          ctx.check(); const { width: w, height: h, colors = 3, bits = 8 } = im, src = im.data, id = new ImageData(w, h), d = id.data, sh = bits === 16 ? 8 : 0;
          for (let i = 0; i < w * h; i++) { const j = i * 4, k = i * colors; if (colors >= 3) { d[j] = src[k] >> sh; d[j + 1] = src[k + 1] >> sh; d[j + 2] = src[k + 2] >> sh; } else d[j] = d[j + 1] = d[j + 2] = src[k] >> sh; d[j + 3] = 255; }
          bmp = await createImageBitmap(id);
        } finally { raw.dispose(); }
      } catch (e) {
        if (ctx.cancelled) throw e;
        bmp = await embeddedPreview(buf); if (!bmp) throw new Error(`This RAW format couldn’t be decoded (${e.message}) and it has no embedded preview`);
        note = ' · embedded camera preview used (full decode unavailable for this file)';
      }
      try {
        ctx.progress(0.85, 'Encoding');
        const c = U.drawTo(bmp, bmp.width, bmp.height, o.to === 'jpeg' ? '#fff' : null);
        const blob = await U.encodeCanvas(c, U.MIME[o.to], o.to === 'png' ? undefined : o.q);
        return { name: `${baseName(f.name)}.${EXT[o.to]}`, blob, thumb: true, info: `${bmp.width}×${bmp.height}${note}` };
      } finally { bmp.close(); }
    }
  });
  alias('dng-to-jpg', 'raw-convert'); alias('cr2-to-jpg', 'raw-convert'); alias('nef-to-jpg', 'raw-convert'); alias('raw-to-jpg', 'raw-convert');

  /* ---------------- PSD → PNG / JPEG ---------------- */
  register({
    id: 'psd-convert', cat: 'img', glyph: 'layers', name: 'PSD → PNG / JPEG', keywords: 'psd photoshop to png jpg jpeg layers export flatten psb',
    desc: 'Flatten Photoshop files to PNG or JPEG, or export every layer as its own PNG.',
    accept: '.psd,.psb', acceptText: 'Photoshop PSD/PSB files saved with “Maximize compatibility”', acceptTest: f => /^(psd|psb)$/.test(extOf(f.name)), multiple: true, zipName: 'psd-export',
    options: [
      { key: 'to', label: 'Save as', type: 'select', value: 'png', options: [['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP']] },
      { key: 'q', label: 'Quality', type: 'range', min: 0.5, max: 1, step: 0.01, value: 0.92, fmt: qFmt, show: o => o.to !== 'png' },
      { key: 'layers', label: 'Layers', type: 'checkbox', text: 'Also export each layer as a PNG', value: false }],
    note: 'Uses ag-psd (MIT, shared with Lumen Photo). The flattened image is the composite Photoshop stores in the file; adjustment layers and effects are only included there.',
    async each(f, o, ctx) {
      if (f.size > 500 * 1048576) throw new Error('File is too large');
      const ag = await U.loadScript('../photo/vendor/ag-psd.js', 'agPsd').catch(() => { throw new Error('The PSD reader isn’t available on this copy of the site (../photo/vendor/ag-psd.js missing)'); });
      ctx.progress(0.2, 'Reading ' + f.name);
      let psd; try { psd = ag.readPsd(await f.arrayBuffer(), { skipThumbnail: true, skipLayerImageData: !o.layers }); } catch (e) { throw new Error('Not a readable PSD (' + e.message + ')'); }
      const out = [];
      let comp = psd.canvas;
      if (!comp) { // no stored composite: draw visible layers in order
        comp = U.canvas(psd.width, psd.height); const g = comp.getContext('2d');
        const walk = list => { for (const L of list || []) { if (L.hidden) continue; if (L.children) walk(L.children); else if (L.canvas) { g.globalAlpha = L.opacity ?? 1; g.drawImage(L.canvas, L.left || 0, L.top || 0); } } };
        walk(psd.children); g.globalAlpha = 1;
      }
      const c = o.to === 'jpeg' ? U.drawTo(comp, comp.width, comp.height, '#fff') : comp;
      out.push({ name: `${baseName(f.name)}.${EXT[o.to]}`, blob: await U.encodeCanvas(c, U.MIME[o.to], o.to === 'png' ? undefined : o.q), thumb: true, info: `${psd.width}×${psd.height} · ${(psd.children || []).length} top-level layer${(psd.children || []).length === 1 ? '' : 's'}` });
      if (o.layers) {
        const flat = []; const walk = (list, path) => { for (const L of list || []) { if (L.children) walk(L.children, path + (L.name || 'Group') + ' - '); else if (L.canvas && L.canvas.width && L.canvas.height) flat.push([path + (L.name || 'Layer'), L]); } };
        walk(psd.children, '');
        for (let i = 0; i < flat.length; i++) { ctx.check(); ctx.progress(0.5 + 0.5 * i / flat.length, 'Layer ' + (i + 1)); const [nm, L] = flat[i]; out.push({ name: `${baseName(f.name)} - ${String(i + 1).padStart(2, '0')} ${nm.replace(/[\\/:*?"<>|]/g, '_')}.png`, blob: await U.encodeCanvas(L.canvas, 'image/png'), thumb: true, info: `${L.canvas.width}×${L.canvas.height} at ${L.left || 0},${L.top || 0}${L.hidden ? ' · hidden' : ''}` }); }
      }
      return out;
    }
  });
  alias('psd-to-png', 'psd-convert'); alias('psd-to-jpg', 'psd-convert', { to: 'jpeg' });

  /* ---------------- 3D model converter ---------------- */
  let threeP = null;
  const three = () => threeP || (threeP = import(new URL('vendor/three-convert.min.js', document.baseURI).href).catch(e => { threeP = null; throw new Error('Could not load the 3D engine (' + e.message + ')'); }));
  async function load3d(file) {
    const T = await three(), x = extOf(file.name), buf = await file.arrayBuffer();
    if (file.size > 300 * 1048576) throw new Error('Model is too large (over 300 MB)');
    let obj;
    try {
      if (x === 'stl') { const g = new T.STLLoader().parse(buf); const nrm = g.attributes.normal; if (!nrm || nrm.array.every(v => v === 0)) g.computeVertexNormals(); obj = new T.Mesh(g, new T.MeshStandardMaterial({ color: 0x9fb8d8, metalness: 0.1, roughness: 0.6 })); }
      else if (x === 'ply') { const g = new T.PLYLoader().parse(buf); if (!g.index && g.attributes.position.count % 3 && !g.attributes.normal) obj = new T.Points(g, new T.PointsMaterial({ size: 0.01, vertexColors: !!g.attributes.color })); else { if (!g.attributes.normal) g.computeVertexNormals(); obj = new T.Mesh(g, new T.MeshStandardMaterial({ color: 0x9fb8d8, vertexColors: !!g.attributes.color })); } }
      else if (x === 'obj') obj = new T.OBJLoader().parse(new TextDecoder().decode(buf));
      else if (x === 'glb' || x === 'gltf') {
        if (x === 'gltf' && /"uri"\s*:\s*"(?!data:)/.test(new TextDecoder().decode(buf))) throw new Error('This .gltf refers to separate .bin/texture files; convert the .glb version, or a .gltf with embedded data');
        obj = (await new T.GLTFLoader().parseAsync(buf, '')).scene;
      } else throw new Error('Unsupported 3D format');
    } catch (e) { throw new Error(`Couldn’t read “${file.name}” (${e.message})`); }
    const root = new T.Group(); root.add(obj); root.updateMatrixWorld(true);
    let verts = 0, tris = 0, meshes = 0; root.traverse(o => { const g = o.geometry; if (!g || !g.attributes || !g.attributes.position) return; meshes++; const v = g.attributes.position.count; verts += v; if (o.isMesh) tris += g.index ? g.index.count / 3 : v / 3; });
    if (!verts) throw new Error('The model has no geometry');
    return { T, root, verts, tris: Math.round(tris), meshes, box: new T.Box3().setFromObject(root) };
  }
  async function export3d(m, o) {
    const { T } = m; let root = m.root;
    if (o.center || o.zup || +o.scale !== 1) {
      const wrap = new T.Group(); wrap.add(root.clone(true));
      const c = m.box.getCenter(new T.Vector3());
      if (o.center) wrap.children[0].position.sub(c);
      if (o.zup) wrap.rotation.x = Math.PI / 2; // Y-up (glTF/OBJ) → Z-up (CAD / 3D printing) and back
      wrap.scale.setScalar(+o.scale); wrap.updateMatrixWorld(true); root = wrap;
    }
    if (o.to === 'stl') { const r = new T.STLExporter().parse(root, { binary: o.stlAscii !== true }); return { data: r instanceof DataView ? new Uint8Array(r.buffer, r.byteOffset, r.byteLength) : r, ext: 'stl', mime: 'model/stl' }; }
    if (o.to === 'obj') return { data: new T.OBJExporter().parse(root), ext: 'obj', mime: 'model/obj' };
    const glb = await new T.GLTFExporter().parseAsync(root, { binary: true }); return { data: new Uint8Array(glb), ext: 'glb', mime: 'model/gltf-binary' };
  }
  register({
    id: '3d-convert', cat: 'files', glyph: 'cube', name: '3D model converter', keywords: '3d model stl obj ply glb gltf convert 3d printing mesh cad blender',
    desc: 'STL, OBJ, PLY, GLB and GLTF to STL, OBJ or GLB, with a 3D preview you can spin.',
    render(root) {
      const st = { file: null, m: null, url: null, renderer: null, raf: 0 };
      const o = { to: 'glb', center: false, zup: false, scale: 1, stlAscii: false };
      const cols = el('div', 'cols'), L = el('div'), R = el('div'); cols.append(L, R); root.append(cols);
      L.append(el('div', 'ph', '<span class="phi"></span>Model<span class="right" id="m3-stats"></span>'));
      const lb = el('div', 'box'); L.append(lb);
      const drop = el('div', 'drop', `<svg viewBox="0 0 24 24"><path d="M12 15V3m0 0-4 4m4-4 4 4"/><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5"/></svg><div><b>Drop a 3D model here</b> or click to choose</div><div class="acc">STL, OBJ, PLY, GLB, GLTF (embedded)</div>`); drop.tabIndex = 0;
      const pick = el('input'); pick.type = 'file'; pick.accept = '.stl,.obj,.ply,.glb,.gltf'; pick.className = 'vh';
      const view = el('div'); view.style.cssText = 'position:relative;height:340px;display:none;border:1px solid #c9d6e4;border-radius:4px;background:radial-gradient(#f4f8fc,#cfdbe8);overflow:hidden;touch-action:none';
      const vmsg = el('div', 'dim'); vmsg.style.cssText = 'position:absolute;left:8px;bottom:6px;font-size:12px'; view.append(vmsg);
      lb.append(drop, pick, view);
      R.append(el('div', 'ph', '<span class="phi"></span>Convert'));
      const rb = el('div', 'box'), form = el('div', 'form'); rb.append(form); R.append(rb);
      for (const f of [{ key: 'to', label: 'Convert to', type: 'select', options: [['glb', 'GLB (glTF binary)'], ['stl', 'STL (3D printing)'], ['obj', 'OBJ (Wavefront)']] },
        { key: 'stlAscii', label: 'STL type', type: 'checkbox', text: 'ASCII STL (bigger, readable)' }, { key: 'center', label: 'Position', type: 'checkbox', text: 'Move to the origin' },
        { key: 'zup', label: 'Axes', type: 'checkbox', text: 'Rotate Y-up → Z-up (for slicers / CAD)' }, { key: 'scale', label: 'Scale', type: 'number', min: 0.0001, max: 10000, step: 'any', hint: 'e.g. 1000 for metres → millimetres' }])
        for (const n of LC.optionField(f, o[f.key], v => o[f.key] = v)) form.append(n);
      const acts = el('div', 'actions'), go = el('button', 'go big', 'Convert'); go.type = 'button'; go.disabled = true; acts.append(go); rb.append(acts);
      rb.append(el('p', 'note', 'Geometry and basic materials convert between all formats. STL has no colours or textures; OBJ is saved without its .mtl; textures carry over into GLB only.'));
      const status = el('p', 'dim'); status.style.fontSize = '13px'; rb.append(status);
      const resHead = el('div', 'ph', '<span class="phi"></span>Result'); resHead.hidden = true; const res = el('ul', 'res'); res.hidden = true; root.append(resHead, res);
      async function preview() {
        const { T, root: obj, box } = st.m;
        try {
          if (!st.renderer) { st.renderer = new T.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); view.prepend(st.renderer.domElement); st.renderer.domElement.style.cssText = 'width:100%;height:100%;display:block'; }
          const r = st.renderer, w = view.clientWidth || 600, h = 340; r.setPixelRatio(Math.min(2, devicePixelRatio || 1)); r.setSize(w, h, false);
          const scene = new T.Scene(); scene.add(new T.HemisphereLight(0xffffff, 0x445566, 2.2)); const dl = new T.DirectionalLight(0xffffff, 2); dl.position.set(3, 5, 4); scene.add(dl);
          const holder = new T.Group(); holder.add(obj); scene.add(holder);
          const size = box.getSize(new T.Vector3()), c = box.getCenter(new T.Vector3()), rad = Math.max(size.x, size.y, size.z) || 1;
          const cam = new T.PerspectiveCamera(40, w / h, rad / 100, rad * 100); cam.position.set(c.x + rad * 1.2, c.y + rad * 0.9, c.z + rad * 1.6); cam.lookAt(c);
          const ctrl = new T.OrbitControls(cam, r.domElement); ctrl.target.copy(c); ctrl.update();
          cancelAnimationFrame(st.raf); const loop = () => { st.raf = requestAnimationFrame(loop); ctrl.update(); r.render(scene, cam); }; loop();
          vmsg.textContent = 'Drag to rotate · scroll to zoom';
        } catch (e) { vmsg.textContent = '3D preview isn’t available here (WebGL off); conversion still works.'; }
      }
      async function load(f) {
        status.textContent = 'Loading…'; status.style.color = '';
        try {
          st.file = f; st.m = await load3d(f); drop.style.display = 'none'; view.style.display = 'block'; await preview();
          const s = st.m.box.getSize(new st.m.T.Vector3());
          root.querySelector('#m3-stats').textContent = `${st.m.verts.toLocaleString()} vertices · ${st.m.tris.toLocaleString()} triangles`;
          status.textContent = `${f.name} · ${st.m.meshes} part${st.m.meshes > 1 ? 's' : ''} · size ${s.x.toPrecision(4)} × ${s.y.toPrecision(4)} × ${s.z.toPrecision(4)}`; go.disabled = false;
        } catch (e) { status.textContent = e.message; status.style.color = '#a3361c'; }
        return st.m;
      }
      async function convert() {
        const r = await export3d(st.m, o), blob = new Blob([r.data], { type: r.mime });
        if (st.url) URL.revokeObjectURL(st.url); st.url = URL.createObjectURL(blob);
        res.innerHTML = ''; const li = el('li'), info = el('div', 'info'), name = `${baseName(st.file.name)}.${r.ext}`;
        info.append(el('span', 'nm', esc(name)), el('small', null, `${fmtSize(blob.size)} · ${st.m.tris.toLocaleString()} triangles`));
        const a = el('a', 'btn go', 'Download'); a.href = st.url; a.download = name; li.append(info, a); res.append(li); res.hidden = resHead.hidden = false; return blob;
      }
      drop.onclick = () => pick.click(); drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick.click(); } };
      pick.onchange = () => { if (pick.files[0]) load(pick.files[0]); pick.value = ''; };
      drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); };
      go.onclick = () => convert().catch(e => { status.textContent = e.message; status.style.color = '#a3361c'; });
      return { load, addFiles: fl => load(fl[0]), set(k, v) { o[k] = v; }, convert, get model() { return st.m; }, destroy() { cancelAnimationFrame(st.raf); if (st.renderer) { st.renderer.dispose(); st.renderer.forceContextLoss?.(); } if (st.url) URL.revokeObjectURL(st.url); } };
    }
  });
  alias('stl-to-obj', '3d-convert'); alias('obj-to-stl', '3d-convert'); alias('glb-to-stl', '3d-convert');

  /* ---------------- Font converter ---------------- */
  const tag4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  function fontKind(b) { const t = tag4(b, 0); return t === 'wOFF' ? 'woff' : t === 'wOF2' ? 'woff2' : t === 'OTTO' ? 'otf' : (b[0] === 0 && b[1] === 1 && b[2] === 0 && b[3] === 0) || t === 'true' ? 'ttf' : t === 'ttcf' ? 'ttc' : null; }
  function sfntTables(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = dv.getUint16(4), t = [];
    for (let i = 0; i < n; i++) { const p = 12 + i * 16; t.push({ tag: tag4(b, p), checksum: dv.getUint32(p + 4), offset: dv.getUint32(p + 8), length: dv.getUint32(p + 12) }); }
    return { flavor: dv.getUint32(0), tables: t };
  }
  async function sfntToWoff(b) {
    const ff = await U.lib.fflate(), { flavor, tables } = sfntTables(b), n = tables.length;
    const parts = tables.map(t => { const raw = b.subarray(t.offset, t.offset + t.length), z = ff.zlibSync(raw, { level: 9 }); return { ...t, data: z.length < raw.length ? z : raw }; });
    let off = 44 + 20 * n; parts.forEach(p => { p.woffOffset = off; off += (p.data.length + 3) & ~3; });
    const sfntSize = 12 + 16 * n + tables.reduce((a, t) => a + ((t.length + 3) & ~3), 0);
    const out = new Uint8Array(off), dv = new DataView(out.buffer);
    dv.setUint32(0, 0x774F4646); dv.setUint32(4, flavor); dv.setUint32(8, off); dv.setUint16(12, n); dv.setUint32(16, sfntSize); dv.setUint16(20, 1); dv.setUint16(22, 0);
    parts.forEach((p, i) => { const q = 44 + i * 20; for (let k = 0; k < 4; k++) out[q + k] = p.tag.charCodeAt(k); dv.setUint32(q + 4, p.woffOffset); dv.setUint32(q + 8, p.data.length); dv.setUint32(q + 12, p.length); dv.setUint32(q + 16, p.checksum); out.set(p.data, p.woffOffset); });
    return out;
  }
  async function woffToSfnt(b) {
    const ff = await U.lib.fflate(), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), flavor = dv.getUint32(4), n = dv.getUint16(12);
    const tabs = []; for (let i = 0; i < n; i++) { const q = 44 + i * 20; tabs.push({ tag: tag4(b, q), off: dv.getUint32(q + 4), comp: dv.getUint32(q + 8), orig: dv.getUint32(q + 12), checksum: dv.getUint32(q + 16) }); }
    let es = 1, sel = 0; while (es * 2 <= n) { es *= 2; sel++; }
    let off = 12 + 16 * n; const datas = tabs.map(t => { const raw = b.subarray(t.off, t.off + t.comp), d = t.comp < t.orig ? ff.unzlibSync(raw) : raw; if (d.length !== t.orig) throw new Error('Damaged WOFF table ' + t.tag); return d; });
    const offs = datas.map(d => { const o = off; off += (d.length + 3) & ~3; return o; });
    const out = new Uint8Array(off), ov = new DataView(out.buffer);
    ov.setUint32(0, flavor); ov.setUint16(4, n); ov.setUint16(6, es * 16); ov.setUint16(8, sel); ov.setUint16(10, n * 16 - es * 16);
    const order = tabs.map((t, i) => i).sort((x, y) => tabs[x].tag < tabs[y].tag ? -1 : 1);
    order.forEach((i, k) => { const p = 12 + k * 16, t = tabs[i]; for (let j = 0; j < 4; j++) out[p + j] = t.tag.charCodeAt(j); ov.setUint32(p + 4, t.checksum); ov.setUint32(p + 8, offs[i]); ov.setUint32(p + 12, t.orig); out.set(datas[i], offs[i]); });
    return out;
  }
  // WOFF2 via Google's woff2 compiled to WebAssembly (wawoff2, MIT); each binding runs in its own worker
  function woff2Worker(kind, data) {
    const url = new URL(`vendor/wawoff2/${kind}_binding.js`, document.baseURI).href;
    const src = `var Module = { onRuntimeInitialized: function () { postMessage({ ready: 1 }); } };
      importScripts(${JSON.stringify(url)});
      onmessage = function (e) { try { var r = Module.${kind}(e.data); if (r === false || !r) throw new Error('${kind} failed'); var out = new Uint8Array(r); postMessage({ out: out }, [out.buffer]); } catch (err) { postMessage({ error: String(err && err.message || err) }); } };`;
    const bu = URL.createObjectURL(new Blob([src], { type: 'text/javascript' })), w = new Worker(bu);
    return new Promise((res, rej) => {
      const end = () => { w.terminate(); URL.revokeObjectURL(bu); };
      w.onmessage = e => { if (e.data.ready) w.postMessage(data); else { end(); e.data.error ? rej(new Error(e.data.error)) : res(e.data.out); } };
      w.onerror = e => { end(); rej(new Error(e.message || 'WOFF2 engine failed')); };
    });
  }
  async function toSfnt(b) { const k = fontKind(b); if (k === 'ttf' || k === 'otf') return b; if (k === 'woff') return woffToSfnt(b); if (k === 'woff2') return woff2Worker('decompress', b); if (k === 'ttc') throw new Error('Font collections (.ttc) aren’t supported; extract one font first'); throw new Error('Not a font file (TTF, OTF, WOFF or WOFF2)'); }
  register({
    id: 'font-convert', cat: 'files', glyph: 'font', name: 'Font converter', keywords: 'font converter ttf otf woff woff2 webfont convert web font',
    desc: 'TTF/OTF to WOFF or WOFF2 web fonts, and WOFF/WOFF2 back to TTF/OTF.',
    accept: '.ttf,.otf,.woff,.woff2', acceptText: 'TTF, OTF, WOFF, WOFF2', acceptTest: f => /^(ttf|otf|woff2?)$/.test(extOf(f.name)), multiple: true, zipName: 'fonts',
    options: [{ key: 'to', label: 'Convert to', type: 'select', value: 'woff2', options: [['woff2', 'WOFF2 (smallest, modern browsers)'], ['woff', 'WOFF'], ['sfnt', 'TTF / OTF (desktop install)']] }, { key: 'css', label: 'CSS', type: 'checkbox', text: 'Also make an @font-face CSS snippet', value: true }],
    note: 'Converting a font’s format doesn’t change its licence: check the font allows web embedding before putting it on a site.',
    async each(f, o, ctx) {
      if (f.size > 50 * 1048576) throw new Error('Font file is too large');
      const b = new Uint8Array(await f.arrayBuffer()); ctx.progress(0.2, 'Reading ' + f.name);
      const sfnt = await toSfnt(b), flavor = tag4(sfnt, 0) === 'OTTO' ? 'otf' : 'ttf';
      sfntTables(sfnt); // validates the table directory
      ctx.progress(0.5, 'Converting');
      let data, ext, mime;
      if (o.to === 'woff2') { data = await woff2Worker('compress', sfnt); ext = 'woff2'; mime = 'font/woff2'; }
      else if (o.to === 'woff') { data = await sfntToWoff(sfnt); ext = 'woff'; mime = 'font/woff'; }
      else { data = sfnt; ext = flavor; mime = 'font/' + flavor; }
      const out = [{ name: `${baseName(f.name)}.${ext}`, blob: new Blob([data], { type: mime }), info: `${fontKind(b).toUpperCase()} → ${ext.toUpperCase()} · ${fmtSize(b.length)} → ${fmtSize(data.length)}` }];
      if (o.css && ext !== 'ttf' && ext !== 'otf') { const fam = baseName(f.name).replace(/[-_](regular|bold|italic|light|medium|black|semibold)+$/i, '').replace(/["\\]/g, ''); const css = `@font-face {\n  font-family: "${fam}";\n  src: url("${baseName(f.name)}.${ext}") format("${ext}");\n  font-display: swap;\n}\n`; out.push({ name: `${baseName(f.name)}.css`, blob: new Blob([css], { type: 'text/css' }), text: css, info: '@font-face rule' }); }
      return out;
    }
  });
  alias('ttf-to-woff2', 'font-convert', { to: 'woff2' }); alias('woff2-to-ttf', 'font-convert', { to: 'sfnt' }); alias('otf-to-woff', 'font-convert', { to: 'woff' });

  /* ---------------- Barcode generator ---------------- */
  const C128 = '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'.split(' ');
  if (C128.length !== 107 || C128.slice(0, 106).some(p => [...p].reduce((a, c) => a + +c, 0) !== 11)) throw new Error('Code 128 table damaged');
  const widthsToBits = w => { let s = ''; [...w].forEach((c, i) => s += (i % 2 ? '0' : '1').repeat(+c)); return s; };
  function code128(text) {
    if (!text.length) throw new Error('Enter something to encode');
    for (const ch of text) { const c = ch.charCodeAt(0); if (c < 32 || c > 126) throw new Error(`“${ch}” can’t be encoded in Code 128 (use plain ASCII letters, digits and symbols)`); }
    if (text.length > 80) throw new Error('Keep Code 128 data under 80 characters');
    // set B for text, switching to set C for runs of 4+ digits (whole pairs)
    const vals = []; let i = 0, set = null;
    const digitsAt = k => { let n = 0; while (k + n < text.length && /\d/.test(text[k + n])) n++; return n; };
    while (i < text.length) {
      const d = digitsAt(i);
      if (d >= 4 || (d >= 2 && d === text.length - i && set === null && d % 2 === 0)) {
        const use = d - (d % 2);
        if (set !== 'C') { vals.push(set === null ? 105 : 99); set = 'C'; }
        for (let k = 0; k < use; k += 2) vals.push(+text.substr(i + k, 2));
        i += use;
      } else { if (set !== 'B') { vals.push(set === null ? 104 : 100); set = 'B'; } vals.push(text.charCodeAt(i) - 32); i++; }
    }
    let sum = vals[0]; for (let k = 1; k < vals.length; k++) sum += vals[k] * k; vals.push(sum % 103);
    return { bits: vals.map(v => widthsToBits(C128[v])).join('') + widthsToBits(C128[106]), vals, label: text, quiet: 10 };
  }
  const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const EAN_R = EAN_L.map(s => s.replace(/./g, c => c === '0' ? '1' : '0')), EAN_G = EAN_R.map(s => [...s].reverse().join(''));
  const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const eanCheck = d => { let s = 0; for (let i = 0; i < d.length; i++) s += +d[d.length - 1 - i] * (i % 2 === 0 ? 3 : 1); return (10 - s % 10) % 10; };
  function ean(text, len) {
    const d = text.replace(/\s/g, ''); if (!/^\d+$/.test(d)) throw new Error('Use digits only');
    let full;
    if (d.length === len - 1) full = d + eanCheck(d);
    else if (d.length === len) { if (eanCheck(d.slice(0, -1)) !== +d.at(-1)) throw new Error(`The check digit is wrong: it should be ${eanCheck(d.slice(0, -1))}`); full = d; }
    else throw new Error(`Enter ${len - 1} digits (the check digit is added for you) or all ${len}`);
    if (len === 13) { const p = PAR[+full[0]]; let bits = '101'; for (let i = 1; i <= 6; i++) bits += (p[i - 1] === 'L' ? EAN_L : EAN_G)[+full[i]]; bits += '01010'; for (let i = 7; i <= 12; i++) bits += EAN_R[+full[i]]; return { bits: bits + '101', label: full, quiet: 11, kind: 'ean13' }; }
    let bits = '101'; for (let i = 0; i < 4; i++) bits += EAN_L[+full[i]]; bits += '01010'; for (let i = 4; i < 8; i++) bits += EAN_R[+full[i]]; return { bits: bits + '101', label: full, quiet: 7, kind: 'ean8' };
  }
  function upca(text) { const d = text.replace(/\s/g, ''); if (!/^\d{11,12}$/.test(d)) throw new Error('Enter 11 digits (the check digit is added) or all 12'); const r = ean('0' + d, 13); return { ...r, label: r.label.slice(1), kind: 'upca' }; }
  function encode(type, text) { return type === 'code128' ? code128(text) : type === 'ean13' ? ean(text, 13) : type === 'ean8' ? ean(text, 8) : upca(text); }
  register({
    id: 'barcode', cat: 'files', glyph: 'barcode', name: 'Barcode generator', keywords: 'barcode generator code128 ean13 ean upc upca ean8 product label shipping sku png svg',
    desc: 'Code 128, EAN-13, EAN-8 and UPC-A barcodes as crisp PNG or SVG, with check digits added for you.',
    render(root, preset) {
      const st = { type: 'code128', text: 'LUMEN-2026', module: 3, height: 90, showText: true, fg: '#000000', bg: '#ffffff', ...(preset || {}) };
      const cols = el('div', 'cols'), L = el('div'), R = el('div'); cols.append(L, R); root.append(cols);
      L.append(el('div', 'ph', '<span class="phi"></span>Barcode'));
      const lb = el('div', 'box'), form = el('div', 'form'); lb.append(form); L.append(lb);
      R.append(el('div', 'ph', '<span class="phi"></span>Preview'));
      const rb = el('div', 'box'); rb.style.textAlign = 'center'; const cv = el('canvas'); cv.style.cssText = 'max-width:100%;border:1px solid #d6e2ef;background:#fff'; const stat = el('p', 'dim');
      const acts = el('div', 'actions'); acts.style.justifyContent = 'center'; const png = el('button', 'go', 'Download PNG'), svgB = el('button', null, 'Download SVG'); png.type = svgB.type = 'button'; acts.append(png, svgB); rb.append(cv, stat, acts); R.append(rb);
      const fields = [{ key: 'type', label: 'Type', type: 'select', options: [['code128', 'Code 128 (any text)'], ['ean13', 'EAN-13 (retail)'], ['upca', 'UPC-A (US retail)'], ['ean8', 'EAN-8']] },
        { key: 'text', label: 'Data', type: 'text' }, { key: 'module', label: 'Bar width', type: 'range', min: 1, max: 8, step: 1, fmt: v => v + ' px' }, { key: 'height', label: 'Height', type: 'range', min: 30, max: 300, step: 5, fmt: v => v + ' px' },
        { key: 'showText', label: 'Text', type: 'checkbox', text: 'Show the digits under the bars' }, { key: 'fg', label: 'Bars', type: 'color' }, { key: 'bg', label: 'Background', type: 'color' }];
      for (const f of fields) for (const n of LC.optionField(f, st[f.key], v => { st[f.key] = v; if (f.key === 'type') { st.text = { code128: 'LUMEN-2026', ean13: '590123412345', upca: '03600029145', ean8: '9638507' }[v]; const ti = form.querySelector('#o-text'); if (ti) ti.value = st.text; } draw(); })) form.append(n);
      let cur = null;
      function draw() {
        try { cur = encode(st.type, st.text); } catch (e) { cur = null; stat.textContent = e.message; stat.style.color = '#a3361c'; cv.width = cv.height = 1; return null; }
        const m = st.module, q = cur.quiet * m, W = cur.bits.length * m + 2 * q, fs = Math.max(10, m * 9), H = st.height + (st.showText ? fs + 8 : 0) + 2 * m * 4;
        cv.width = W; cv.height = H; const g = cv.getContext('2d'); g.fillStyle = st.bg; g.fillRect(0, 0, W, H); g.fillStyle = st.fg;
        for (let i = 0; i < cur.bits.length; i++) if (cur.bits[i] === '1') g.fillRect(q + i * m, m * 4, m, st.height);
        if (st.showText) { g.font = `${fs}px Consolas, monospace`; g.textAlign = 'center'; g.textBaseline = 'top'; g.fillText(cur.label, W / 2, m * 4 + st.height + 4); }
        cv.style.width = Math.min(W, 520) + 'px';
        stat.style.color = ''; stat.textContent = `${st.type === 'code128' ? 'Code 128' : st.type.toUpperCase()} · ${cur.label} · ${cur.bits.length} modules · ${W}×${H} px`;
        return cur;
      }
      const svg = () => { if (!cur) return ''; const m = st.module, q = cur.quiet * m, W = cur.bits.length * m + 2 * q, fs = Math.max(10, m * 9), H = st.height + (st.showText ? fs + 8 : 0) + 8 * m; let d = ''; for (let i = 0; i < cur.bits.length;) { if (cur.bits[i] === '1') { let j = i; while (cur.bits[j] === '1') j++; d += `M${q + i * m} ${4 * m}h${(j - i) * m}v${st.height}h-${(j - i) * m}z`; i = j; } else i++; } return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="${st.bg}"/><path fill="${st.fg}" d="${d}"/>${st.showText ? `<text x="${W / 2}" y="${4 * m + st.height + 4 + fs * 0.8}" font-family="Consolas, monospace" font-size="${fs}" text-anchor="middle" fill="${st.fg}">${esc(cur.label)}</text>` : ''}</svg>\n`; };
      png.onclick = () => cur && cv.toBlob(b => U.download(b, `barcode-${cur.label.replace(/[^\w-]/g, '_')}.png`), 'image/png');
      svgB.onclick = () => cur && U.download(new Blob([svg()], { type: 'image/svg+xml' }), `barcode-${cur.label.replace(/[^\w-]/g, '_')}.svg`);
      draw();
      return { set(k, v) { st[k] = v; return draw(); }, get current() { return cur; }, svg, png: () => new Promise(r => cv.toBlob(r, 'image/png')) };
    }
  });
  alias('ean13', 'barcode', { type: 'ean13', text: '590123412345' }); alias('code128', 'barcode');
  LC.miscInternals = { code128, ean, upca, sfntToWoff, woffToSfnt, woff2Worker, fontKind, load3d, export3d, embeddedPreview };
})();
