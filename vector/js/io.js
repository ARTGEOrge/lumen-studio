'use strict';
/* Lumen Vector — files: .lvec save/open, SVG import/export, image placing, PNG and PDF export. */
(function () {
  const SVGNS = 'http://www.w3.org/2000/svg';
  LV.images = new Map(); // blob URL -> data URL (kept so documents and exports can embed images)

  /* ---------- helpers ---------- */
  const b64 = bytes => { let s = ''; const u = new Uint8Array(bytes); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const dataUrlToBlob = du => { const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(du); if (!m) return null; const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: m[1] || 'application/octet-stream' }); };
  LV.registerImage = (dataUrl) => { const blob = dataUrlToBlob(dataUrl); if (!blob || !/^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/.test(blob.type)) return null; const url = URL.createObjectURL(blob); LV.images.set(url, dataUrl); return url; };
  const ext = n => (String(n).match(/\.([^.\\/]+)$/) || [])[1]?.toLowerCase() || '';
  const docBase = () => Aero.baseName(LV.doc.name || 'Untitled');
  const loadRaster = r => new Promise(res => { if (r.loaded) return res(r); r.onLoad = () => res(r); r.onError = () => res(r); setTimeout(() => res(r), 4000); });

  /* ---------- native document (.lvec) ---------- */
  LV.serialize = () => {
    const layers = JSON.parse(P.project.exportJSON()), images = {};
    walkJSON(layers, (cls, props) => { if (cls === 'Raster' && props.source && LV.images.has(props.source)) images[props.source] = LV.images.get(props.source); });
    const symbols = LV.doc.symbols || [];
    symbols.forEach(s => walkJSON(s.art, (cls, props) => { if (cls === 'Raster' && props.source && LV.images.has(props.source)) images[props.source] = LV.images.get(props.source); }));
    return JSON.stringify({ format: 'lumen-vector', version: 3, app: 'Lumen Vector', name: LV.doc.name, artboards: LV.doc.artboards, active: LV.doc.active, guides: LV.doc.guides, swatches: LV.doc.swatches, symbols, layers, images });
  };
  const KINDS = ['areatext', 'pathtext', 'trace', 'symbol', 'blend', 'repeat', 'warp'];
  // item data from an opened file is untrusted: keep only known, validated fields for the newer features
  function sanitizeData(d) {
    if (!d || typeof d !== 'object') return;
    if ('fx' in d) { const v = LV.fx.sanitize(d.fx); if (v) d.fx = v; else delete d.fx; }
    if ('width' in d) { const v = LV.width.sanitize(d.width); if (v) d.width = v; else delete d.width; }
    if ('live' in d) { const v = LV.live.sanitize(d.live); if (v) d.live = v; else delete d.live; }
    if ('kind' in d && !KINDS.includes(d.kind)) delete d.kind;
    if (d.kind === 'trace') d.trace = LV.trace.sanitize(d.trace); else delete d.trace;
    if (d.kind === 'blend') d.blend = LV.blend.sanitize(d.blend); else delete d.blend;
    if (d.kind === 'repeat') d.repeat = LV.repeat.sanitize(d.repeat); else delete d.repeat;
    if (d.kind === 'warp') d.warp = LV.warp.sanitize(d.warp); else delete d.warp;
    delete d.symEdit; delete d.tfill;
    ['uid', 'sym', 'next', 'prev', 'role', 'text'].forEach(k => { if (k in d && typeof d[k] !== 'string') delete d[k]; });
  }
  const ALLOWED = new Set(['Layer', 'Group', 'Path', 'CompoundPath', 'PointText', 'Raster', 'Shape', 'Color', 'Gradient', 'GradientStop', 'Segment', 'Point', 'Size', 'Rectangle', 'Matrix', 'Style']);
  function walkJSON(node, fn) {
    if (Array.isArray(node)) {
      if (typeof node[0] === 'string' && node.length === 2 && node[1] && typeof node[1] === 'object' && !Array.isArray(node[1])) { fn(node[0], node[1], node); walkJSON(node[1], fn); return; }
      node.forEach(n => walkJSON(n, fn));
    } else if (node && typeof node === 'object') Object.values(node).forEach(v => walkJSON(v, fn));
  }
  LV.openLvec = (text, name, path) => {
    let d; try { d = JSON.parse(text); } catch (e) { throw new Error('This file is not valid JSON.'); }
    if (!d || d.format !== 'lumen-vector' || !Array.isArray(d.layers) || !Array.isArray(d.artboards) || !d.artboards.length) throw new Error('This is not a Lumen Vector document.');
    // untrusted input: only plain paper item classes, no remote resources, validated feature data
    const check = node => walkJSON(node, (cls, props, arr) => {
      if (/^[A-Z]/.test(cls) && !ALLOWED.has(cls)) throw new Error('Unsupported object type in document: ' + cls);
      if (cls === 'Raster') {
        const src = String(props.source || ''), du = d.images && typeof d.images[src] === 'string' ? d.images[src] : src.startsWith('data:') ? src : null;
        props.source = du ? (LV.registerImage(du) || '') : ''; delete props.crossOrigin;
      }
      if (props.data) sanitizeData(props.data);
    });
    check(d.layers);
    const symbols = LV.sym.sanitizeList(d.symbols, check);
    const ab = d.artboards.map(a => ({ id: String(a.id || Aero.uid()), name: String(a.name || 'Artboard'), x: +a.x || 0, y: +a.y || 0, w: Math.max(1, +a.w || 100), h: Math.max(1, +a.h || 100) }));
    LV.doc = { name: name || d.name || 'Untitled', path: path || null, artboards: ab, active: 0, guides: d.guides && Array.isArray(d.guides.x) ? { x: d.guides.x.map(Number).filter(isFinite), y: (d.guides.y || []).map(Number).filter(isFinite) } : { x: [], y: [] }, swatches: Array.isArray(d.swatches) ? d.swatches.map(LV.sanitizeSpec).filter(Boolean) : LV.DEFAULT_SWATCHES.slice(), symbols };
    LV.restore(JSON.stringify({ ab, active: Math.min(+d.active || 0, ab.length - 1), guides: LV.doc.guides, swatches: LV.doc.swatches, symbols, layers: d.layers, activeLayer: 0 }), { keepSel: false });
    P.project.layers.forEach(L => L.children.forEach(c => { (c.data.kind === 'pathtext') && LV.layoutPathText(c); }));
    // symbol instances always show their master (instances of a missing definition become plain groups)
    LV.sym.instances().forEach(i => { if (!LV.sym.find(i.data.sym) || !LV.sym.fill(i)) { i.applyMatrix = true; delete i.data.kind; delete i.data.sym; } });
    P.project.getItems({ match: it => it.data && it.data.kind === 'blend' }).forEach(g => LV.blend.regen(g, true));
    P.project.getItems({ match: it => it.data && it.data.kind === 'trace' }).forEach(g => LV.trace.applyView(g));
    LV.regenLive(); // sanitized options carry no signature -> repeats and warps are rebuilt from their sources
    LV.hist.reset('Open', LV.snapshot()); Aero.setDoc(LV.doc.name, false); LV.fitBoard();
  };
  LV.save = async (as) => {
    if (LV.textEditing) LV.endTextEdit();
    if (LV.isoRoot()) LV.sym.finishEdit();
    let name = LV.doc.name.replace(/\.[^.]+$/, '') + '.lvec';
    const p = await Aero.saveFile({ name, data: LV.serialize(), filters: [{ name: 'Lumen Vector', extensions: ['lvec'] }], path: as ? null : LV.doc.path });
    if (!p) return false;
    LV.doc.path = Aero.isDesktop ? p : null; LV.doc.name = String(p).replace(/^.*[\\/]/, ''); Aero.setDoc(LV.doc.name, false); LV.toast('Saved ' + LV.doc.name); return true;
  };

  /* ---------- SVG import ---------- */
  LV.sanitizeSVG = text => {
    const doc = new DOMParser().parseFromString(String(text), 'image/svg+xml');
    if (doc.querySelector('parsererror') || !doc.documentElement || doc.documentElement.nodeName.toLowerCase() !== 'svg') throw new Error('This file is not a valid SVG document.');
    doc.querySelectorAll('script,foreignObject,iframe,object,embed,audio,video,style,animate,set,animateTransform,animateMotion').forEach(n => n.remove());
    doc.querySelectorAll('*').forEach(n => {
      [...n.attributes].forEach(a => {
        const nm = a.name.toLowerCase(), v = a.value.trim();
        if (nm.startsWith('on')) n.removeAttribute(a.name);
        else if ((nm === 'href' || nm === 'xlink:href') && !(v.startsWith('#') || /^data:image\/(png|jpe?g|gif|webp)[;,]/i.test(v))) n.removeAttribute(a.name);
        else if (/url\(\s*['"]?(?!#)/i.test(v)) n.setAttribute(a.name, v.replace(/url\(\s*['"]?(?!#)[^)]*\)/gi, 'none'));
      });
    });
    return doc;
  };
  const normalizeImported = item => {
    const fix = it => {
      if (it instanceof P.Raster && it.source && String(it.source).startsWith('data:')) { const u = LV.registerImage(it.source); if (u) it.source = u; }
      if (it instanceof P.Shape) { const p = it.toPath(false); p.copyAttributes?.(it); it.replaceWith(p); it = p; }
      if ((it instanceof P.Group || it instanceof P.Path || it instanceof P.CompoundPath) && !it.applyMatrix) { try { it.applyMatrix = true; } catch (e) { } }
      (it.children || []).slice().forEach(fix); LV.uidOf(it);
    };
    fix(item);
    // drop empty clip-less wrapper groups that only hold one child
    return item;
  };
  LV.importSVGText = (text, { asNewDoc = false, name = 'Imported SVG' } = {}) => {
    const doc = LV.sanitizeSVG(text), root = doc.documentElement;
    const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number), w = parseFloat(root.getAttribute('width')) || vb[2] || 800, h = parseFloat(root.getAttribute('height')) || vb[3] || 600;
    const item = P.project.importSVG(doc, { expandShapes: true, insert: false, applyMatrix: true });
    if (!item) throw new Error('Nothing could be imported from this SVG.');
    normalizeImported(item); item.name = name;
    if (asNewDoc) {
      LV.newDoc({ w: Math.round(w), h: Math.round(h), name: name.replace(/\.svg$/i, '') + '.lvec', boardName: Aero.baseName(name) });
      const kids = item.children.filter(c => !(c instanceof P.Shape)); LV.activeLayer().addChildren(item instanceof P.Group ? item.removeChildren() : [item]);
      LV.hist.reset('Open SVG', LV.snapshot()); Aero.setDoc(LV.doc.name, false); LV.fitBoard(); return;
    }
    LV.insert(item); const c = LV.boardRect(LV.board()).center; item.position = c;
    LV.setSel([item]); LV.commit('Import SVG');
  };

  /* ---------- images ---------- */
  LV.placeImage = async (data, name, mime) => {
    const du = 'data:' + (mime || (/\.jpe?g$/i.test(name) ? 'image/jpeg' : /\.webp$/i.test(name) ? 'image/webp' : /\.gif$/i.test(name) ? 'image/gif' : 'image/png')) + ';base64,' + b64(data);
    const url = LV.registerImage(du); if (!url) throw new Error('Unsupported image type');
    const r = new P.Raster({ source: url, insert: false }); await loadRaster(r);
    if (!r.width) throw new Error('Could not decode this image.');
    r.name = name; const ab = LV.boardRect(LV.board());
    const s = Math.min(1, ab.width * .9 / r.width, ab.height * .9 / r.height); if (s < 1) r.scale(s);
    r.position = ab.center; LV.insert(r); LV.setSel([r]); LV.commit('Place Image'); return r;
  };

  /* ---------- export project (a cleaned copy for SVG / PDF) ---------- */
  const alphaGrad = c => c && c.type === 'gradient' && new Set(c.gradient.stops.map(st => Math.round(st.color.alpha * 100))).size > 1;
  function exportProject({ outline = false, flatten = false, clip = null } = {}) {
    const main = P.project, json = main.exportJSON();
    const ep = new P.Project(new P.Size(10, 10)); ep.importJSON(json);
    ep.getItems({ match: it => !(it instanceof P.Layer) && !it.visible }).forEach(it => it.remove());
    ep.layers.slice().forEach(L => { if (!L.visible) L.remove(); });
    if (clip) ep.layers.forEach(L => L.children.slice().forEach(o => { if (!o.strokeBounds.intersects(clip)) o.remove(); })); // only artwork on this artboard
    ep.getItems({ match: it => it.data && (it.data.role === 'frame' || it.data.role === 'guide') && !it.hasStroke?.() && !it.hasFill?.() }).forEach(it => it.remove());
    // stroke alignment -> clip groups (portable)
    ep.getItems({ match: it => it.data && (it.data.strokeAlign === 'inside' || it.data.strokeAlign === 'outside') && it.hasStroke() && (it instanceof P.CompoundPath || it.closed) }).forEach(it => {
      const w = it.strokeWidth, st = it.clone({ insert: false }); st.fillColor = null; st.strokeWidth = w * 2; st.data.strokeAlign = null;
      let clip;
      if (it.data.strokeAlign === 'inside') clip = it.clone({ insert: false });
      else { const big = it.strokeBounds.expand(w * 4 + 10); clip = new P.CompoundPath({ pathData: new P.Path.Rectangle({ rectangle: big, insert: false }).pathData + ' ' + it.pathData, insert: false, fillRule: 'evenodd' }); }
      clip.data = {}; const g = new P.Group({ children: [clip, st], insert: false }); g.clipped = true;
      it.strokeColor = null; it.data.strokeAlign = null; g.insertAbove(it);
    });
    if (outline) ep.layers.forEach(L => LV.outlineAll(L));
    // variable-width strokes have no SVG/PDF equivalent: replace them by their filled outline (+ a fill-only copy)
    ep.getItems({ match: it => LV.width.active(it) }).forEach(it => { const x = LV.width.expand(it); if (!x) return; if (it.data.fx) { x.data.fx = it.data.fx; } x.insertAbove(it); it.remove(); });
    // PDF: gradients that fade in opacity cannot be expressed by svg2pdf -> rasterize just those objects (2x)
    // PDF: live raster effects (shadows, glows, blur, feather) cannot be expressed by svg2pdf -> rasterise those objects (2x)
    if (flatten) ep.getItems({ match: it => LV.fx.hasRaster(it) }).filter((it, _, all) => !all.some(o => o !== it && it.isDescendant(o))).forEach(it => {
      const r = LV.fx.rasterize(it, 2); if (!r) return; r.insertAbove(it); it.remove();
    });
    if (flatten) ep.getItems({ match: it => LV.isPathItem(it) && !(it.parent instanceof P.CompoundPath) && !it.clipMask && (alphaGrad(it.fillColor) || alphaGrad(it.strokeColor)) }).forEach(it => {
      const r = it.rasterize({ resolution: 144, insert: false }); if (!r) return;
      r.blendMode = it.blendMode; r.insertAbove(it); it.remove();
    });
    main.activate();
    return ep;
  }
  const usedFonts = proj => { const s = new Set(); proj.getItems({ class: P.PointText }).forEach(t => { const f = LV.fontInfo(t.fontFamily); if (f) s.add(f.family + '|' + LV.nearestWeight(f.family, t.fontWeight)); }); return [...s]; };
  LV.exportSVGString = async (i = LV.doc.active, { outline = false, embedFonts = true, flatten = false } = {}) => {
    const ab = LV.doc.artboards[i], ep = exportProject({ outline, flatten, clip: LV.boardRect(ab) });
    const fonts = outline ? [] : usedFonts(ep);
    const onExport = (item, node) => {
      if (item instanceof P.PointText) {
        const lines = String(item.content).split(/\r?\n/), x = node.getAttribute('x') || '0';
        node.textContent = ''; node.setAttribute('xml:space', 'preserve');
        lines.forEach((l, k) => { const ts = document.createElementNS(SVGNS, 'tspan'); ts.setAttribute('x', x); if (k) ts.setAttribute('dy', LV.round(item.leading, 3)); ts.textContent = l; node.appendChild(ts); });
        if (item.data.tracking) node.setAttribute('letter-spacing', LV.round(item.data.tracking / 1000 * item.fontSize, 3));
      }
      if (item instanceof P.Raster) { const src = item.source, du = LV.images.get(src) || (String(src).startsWith('data:') ? src : null); if (du) node.setAttribute('href', du); }
      return LV.fx.svgWrap(item, node, fxCtx);
    };
    const fxCtx = { defs: [], n: 0 };
    let svg;
    try { svg = ep.exportSVG({ asString: false, bounds: new P.Rectangle(0, 0, ab.w, ab.h), matrix: new P.Matrix().translate(-ab.x, -ab.y), embedImages: false, onExport, precision: 3 }); }
    finally { ep.remove(); P.project.activate?.(); }
    if (fxCtx.defs.length) { const defs = svg.querySelector('defs') || svg.insertBefore(document.createElementNS(SVGNS, 'defs'), svg.firstChild); fxCtx.defs.forEach(n => defs.appendChild(n)); }
    svg.querySelectorAll('[data-paper-data]').forEach(n => n.removeAttribute('data-paper-data'));
    // paper writes "none" for mixed group styles; that is invalid for these attributes (and breaks svg2pdf)
    const NO_NONE = ['stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'stroke-dashoffset', 'font-family', 'font-weight', 'font-size', 'text-anchor', 'fill-rule'];
    svg.querySelectorAll('*').forEach(n => { NO_NONE.forEach(a => { if (n.getAttribute(a) === 'none') n.removeAttribute(a); }); if (n.getAttribute('stroke-dasharray') === '') n.removeAttribute('stroke-dasharray'); if (n.getAttribute('style') === 'mix-blend-mode: normal') n.removeAttribute('style'); });
    // fix generic font names: quote families
    svg.querySelectorAll('text').forEach(t => { const ff = t.getAttribute('font-family'); if (ff && !/["']/.test(ff)) t.setAttribute('font-family', `'${ff}', sans-serif`); });
    if (fonts.length && embedFonts) {
      let css = '';
      for (const f of fonts) { const [fam, w] = f.split('|'); const bytes = await LV.fontBytes(fam, +w); css += `@font-face{font-family:'${fam}';font-weight:${w};src:url(data:font/woff;base64,${b64(bytes)}) format('woff');}`; }
      const st = document.createElementNS(SVGNS, 'style'); st.textContent = css; const defs = svg.querySelector('defs') || svg.insertBefore(document.createElementNS(SVGNS, 'defs'), svg.firstChild); defs.appendChild(st);
    }
    svg.setAttribute('width', ab.w); svg.setAttribute('height', ab.h);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
  };
  LV.mainProject = null;

  /* ---------- PNG ---------- */
  LV.exportPNGBlob = async (i = LV.doc.active, scale = 1, transparent = false) => {
    const ab = LV.doc.artboards[i], W = Math.max(1, Math.round(ab.w * scale)), H = Math.max(1, Math.round(ab.h * scale));
    if (W * H > 16384 * 16384 / 2) throw new Error('Image too large');
    await Promise.all(P.project.getItems({ class: P.Raster }).map(loadRaster));
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
    if (!transparent) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); }
    const editing = LV.textEditing; if (editing) editing.item.visible = true;
    const off = []; const abr = LV.boardRect(ab); P.project.layers.forEach(L => L.children.forEach(o => { if (o.visible && !o.strokeBounds.intersects(abr)) { o.visible = false; off.push(o); } }));
    try { P.project.draw(ctx, new P.Matrix().scale(scale).translate(-ab.x, -ab.y), 1); } finally { if (editing) editing.item.visible = false; off.forEach(o => o.visible = true); }
    return await new Promise(res => cv.toBlob(res, 'image/png'));
  };

  /* ---------- PDF (vector, via svg2pdf) ---------- */
  LV.exportPDFBytes = async (indices = LV.doc.artboards.map((_, i) => i)) => {
    const { jsPDF } = window.jspdf; let pdf = null;
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-99999px;top:0;width:10px;height:10px;overflow:hidden'; document.body.appendChild(host);
    try {
      for (const i of indices) {
        const ab = LV.doc.artboards[i], fmt = [ab.w, ab.h], o = ab.w > ab.h ? 'l' : 'p';
        if (!pdf) pdf = new jsPDF({ unit: 'pt', format: fmt, orientation: o, compress: true, putOnlyUsedFonts: true }); else pdf.addPage(fmt, o);
        const text = await LV.exportSVGString(i, { outline: true, embedFonts: false, flatten: true });
        const el = new DOMParser().parseFromString(text, 'image/svg+xml').documentElement; host.innerHTML = ''; host.appendChild(document.importNode(el, true));
        await pdf.svg(host.firstChild, { x: 0, y: 0, width: ab.w, height: ab.h });
      }
      pdf.setProperties({ title: docBase(), creator: 'Lumen Vector' });
      return pdf.output('arraybuffer');
    } finally { host.remove(); }
  };

  /* ---------- UI flows ---------- */
  const boardOpts = (all) => [...(all ? [['all', 'All artboards']] : []), ...LV.doc.artboards.map((a, i) => [String(i), `${i + 1}. ${a.name} (${LV.fmt(a.w)} × ${LV.fmt(a.h)})`])];
  LV.exportSVGDialog = () => Aero.dialog({
    title: 'Export SVG', fields: [{ key: 'b', label: 'Artboard', type: 'select', value: String(LV.doc.active), options: boardOpts(true) }, { key: 't', label: 'Text', type: 'select', value: 'live', options: [['live', 'Keep editable text'], ['outline', 'Convert to outlines']] }, { key: 'f', label: 'Embed fonts', type: 'checkbox', value: true }],
    onOK: async v => {
      const list = v.b === 'all' ? LV.doc.artboards.map((_, i) => i) : [+v.b];
      Aero.busy('Exporting SVG…');
      try { for (const i of list) { const s = await LV.exportSVGString(i, { outline: v.t === 'outline', embedFonts: v.f }); await Aero.saveFile({ name: `${docBase()}${list.length > 1 || LV.doc.artboards.length > 1 ? '-' + LV.doc.artboards[i].name.replace(/[^\w-]+/g, '_') : ''}.svg`, data: s, filters: [{ name: 'SVG', extensions: ['svg'] }] }); } }
      catch (e) { Aero.alert('Export failed', e.message); } finally { Aero.busy(); }
    }
  });
  LV.exportPNGDialog = () => Aero.dialog({
    title: 'Export PNG', fields: [{ key: 'b', label: 'Artboard', type: 'select', value: String(LV.doc.active), options: boardOpts(true) }, { key: 's', label: 'Scale', type: 'select', value: '2', options: [['1', '1× (' + LV.fmt(LV.board().w) + ' px)'], ['2', '2×'], ['3', '3×'], ['4', '4×']] }, { key: 't', label: 'Transparent background', type: 'checkbox', value: false }],
    onOK: async v => {
      const list = v.b === 'all' ? LV.doc.artboards.map((_, i) => i) : [+v.b];
      Aero.busy('Rendering PNG…');
      try { for (const i of list) { const blob = await LV.exportPNGBlob(i, +v.s, v.t); await Aero.saveFile({ name: `${docBase()}${LV.doc.artboards.length > 1 ? '-' + LV.doc.artboards[i].name.replace(/[^\w-]+/g, '_') : ''}@${v.s}x.png`, data: blob, filters: [{ name: 'PNG', extensions: ['png'] }] }); } }
      catch (e) { Aero.alert('Export failed', e.message); } finally { Aero.busy(); }
    }
  });
  LV.exportPDFDialog = () => Aero.dialog({
    title: 'Export PDF', instruction: 'Vector PDF — one page per artboard; text is converted to outlines.', fields: [{ key: 'b', label: 'Artboards', type: 'select', value: 'all', options: boardOpts(true) }],
    onOK: async v => {
      Aero.busy('Writing PDF…');
      try { const bytes = await LV.exportPDFBytes(v.b === 'all' ? undefined : [+v.b]); await Aero.saveFile({ name: docBase() + '.pdf', data: bytes, filters: [{ name: 'PDF', extensions: ['pdf'] }] }); }
      catch (e) { console.error(e); Aero.alert('Export failed', e.message); } finally { Aero.busy(); }
    }
  });
  LV.newDialog = () => Aero.dialog({
    title: 'New Document', fields: [{ key: 'n', label: 'Name', type: 'text', value: 'Untitled-1' }, { key: 'p', label: 'Preset', type: 'select', value: '6', options: [['custom', 'Custom'], ...LV.PRESETS.map((p, i) => [String(i), p[0]])] }, { key: 'w', label: 'Width (px)', type: 'number', value: 1080, min: 1 }, { key: 'h', label: 'Height (px)', type: 'number', value: 1080, min: 1 }],
    onInput: (k, v, set) => { if (k === 'p' && v.p !== 'custom') { const p = LV.PRESETS[+v.p]; set('w', p[1]); set('h', p[2]); } },
    onOK: async v => { if (!(v.w > 0 && v.h > 0)) return; if (!(await LV.confirmDiscard())) return; LV.newDoc({ w: v.w, h: v.h, name: (v.n || 'Untitled') + '.lvec' }); }
  });
  LV.confirmDiscard = async () => !Aero.dirty || Aero.confirm('Unsaved changes', 'Discard the changes to the current document?', 'Discard');
  LV.openFiles = async (files, { place = false } = {}) => {
    for (const f of files) {
      const e = ext(f.name);
      try {
        if (e === 'lvec' || e === 'json') { if (!(await LV.confirmDiscard())) return; LV.openLvec(new TextDecoder().decode(f.data), f.name, f.path); }
        else if (e === 'svg') { const t = new TextDecoder().decode(f.data); if (place) LV.importSVGText(t, { name: f.name }); else { if (!(await LV.confirmDiscard())) return; LV.importSVGText(t, { asNewDoc: true, name: f.name }); } }
        else if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e)) {
          if (!place) { if (!(await LV.confirmDiscard())) return; const du = 'data:image/' + (e === 'jpg' ? 'jpeg' : e) + ';base64,' + b64(f.data); const img = new Image(); img.src = du; await img.decode().catch(() => { }); LV.newDoc({ w: img.naturalWidth || 800, h: img.naturalHeight || 600, name: Aero.baseName(f.name) + '.lvec', boardName: Aero.baseName(f.name) }); const r = await LV.placeImage(f.data, f.name); r.position = LV.boardRect(LV.board()).center; LV.hist.reset('Open Image', LV.snapshot()); Aero.setDoc(LV.doc.name, false); }
          else await LV.placeImage(f.data, f.name);
        } else Aero.alert('Unsupported file', `${f.name} is not a supported file type (.lvec, .svg, .png, .jpg, .gif, .webp).`);
      } catch (err) { console.warn(err); Aero.alert('Could not open ' + f.name, err.message || String(err)); }
    }
  };
  LV.openDialog = async () => { const fs = await Aero.openFile({ accept: '.lvec,.json,.svg,.png,.jpg,.jpeg,.gif,.webp', filters: [{ name: 'Lumen Vector & SVG', extensions: ['lvec', 'svg'] }, { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }] }); if (fs.length) LV.openFiles(fs); };
  LV.placeDialog = async () => { const fs = await Aero.openFile({ accept: '.svg,.png,.jpg,.jpeg,.gif,.webp', filters: [{ name: 'SVG & images', extensions: ['svg', 'png', 'jpg', 'jpeg', 'gif', 'webp'] }] }); if (fs.length) LV.openFiles(fs, { place: true }); };
})();
