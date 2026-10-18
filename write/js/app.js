'use strict';
/* Lumen Write — application core: state, document load/serialise, selection positions, undo history. */
const S = window.S = {
  doc: null,            // doc-level data: page, header, footer, hfFirst, styles, notes, comments, meta
  assets: {},           // id -> {mime, data:Uint8Array, url, w, h}
  ed: null, name: 'Untitled', path: null, hist: null,
  zoom: 1, track: false, author: 'You', markup: 'all', marks: false, spell: false,
  pages: 1, curPage: 0,
};
const $ = s => document.querySelector(s);
const PX = 4 / 3;  // CSS px per pt

/* ---------------- selection positions ----------------
   A position is a number of "units" before a point: text characters, plus 1 for entering each paragraph-like
   element and 1 for each atomic element (image, footnote, page break...). Pagination gaps count 0. */
const Sel = (() => {
  const PARA = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'PRE']);
  const isGap = n => n.nodeType === 1 && n.classList.contains('pg-gap');
  const isAtom = n => n.nodeType === 1 && (n.nodeName === 'IMG' || n.nodeName === 'BR' || n.nodeName === 'HR' || (n.nodeName === 'SUP' && n.classList.contains('fn')) || (n.nodeName === 'DIV' && (n.classList.contains('pbreak') || n.classList.contains('toc'))) || (n.nodeName === 'SPAN' && n.classList.contains('tab')));
  function units(n) {
    if (n.nodeType === 3) return n.nodeValue.length;
    if (n.nodeType !== 1 || isGap(n)) return 0;
    if (isAtom(n)) return 1;
    let u = PARA.has(n.nodeName) ? 1 : 0;
    for (let c = n.firstChild; c; c = c.nextSibling) u += units(c);
    return u;
  }
  function posOf(node, offset, root = S.ed) {
    if (!root.contains(node) && node !== root) return 0;
    let pos = 0;
    if (node.nodeType === 3) pos = Math.min(offset, node.nodeValue.length);
    else { if (PARA.has(node.nodeName) && node !== root) pos += 1; for (let i = 0; i < Math.min(offset, node.childNodes.length); i++) pos += units(node.childNodes[i]); if (isAtom(node)) pos = 0; }
    let n = node;
    while (n !== root) {
      const p = n.parentNode; if (!p) break;
      if (p !== root && PARA.has(p.nodeName)) pos += 1;
      for (let c = p.firstChild; c && c !== n; c = c.nextSibling) pos += units(c);
      if (isAtom(p)) pos = 0;
      n = p;
    }
    return pos;
  }
  function nodeAt(pos, root = S.ed) {
    // returns [container, offset]
    function find(el, p) {
      const kids = el.childNodes;
      for (let i = 0; i < kids.length; i++) {
        const c = kids[i];
        if (c.nodeType === 3) { const L = c.nodeValue.length; if (p <= L) return [c, p]; p -= L; continue; }
        if (c.nodeType !== 1 || isGap(c)) continue;
        if (isAtom(c)) { if (p === 0) return [el, i]; p -= 1; continue; }
        const u = units(c);
        if (PARA.has(c.nodeName)) { if (p <= u) { if (p === 0) return [el, i]; return find(c, p - 1); } }
        else if (p < u || (p === u && u > 0)) return find(c, p);
        p -= u;
      }
      return [el, kids.length];
    }
    return find(root, Math.max(0, pos));
  }
  function save() {
    const s = getSelection(); if (!s.rangeCount || !S.ed.contains(s.anchorNode)) return null;
    return { a: posOf(s.anchorNode, s.anchorOffset), f: posOf(s.focusNode, s.focusOffset) };
  }
  function restore(st) {
    if (!st) return;
    const [an, ao] = nodeAt(st.a), [fn, fo] = nodeAt(st.f);
    const s = getSelection();
    try { s.setBaseAndExtent(an, ao, fn, fo); } catch (e) { }
  }
  function range() { const s = getSelection(); if (!s.rangeCount) return null; const r = s.getRangeAt(0); return S.ed.contains(r.commonAncestorContainer) || r.commonAncestorContainer === S.ed ? r : null; }
  return { posOf, nodeAt, save, restore, range, units, PARA, isAtom, isGap };
})();

/* ---------------- document <-> editor ---------------- */
const App = {
  docLevelKeys: ['page', 'header', 'footer', 'hfFirst', 'styles', 'notes', 'comments', 'meta'],
  src: id => S.assets[id]?.url || '',
  // load an AST document into the editor
  async setDocument(ast, name, path, opts = {}) {
    for (const u of Object.values(S.assets)) if (u.url && !opts.keepAssets) URL.revokeObjectURL(u.url);
    if (!opts.keepAssets) S.assets = {};
    for (const [id, a] of Object.entries(ast.assets || {})) await App.addAssetBytes(a.data, a.mime, id);
    const doc = {};
    for (const k of App.docLevelKeys) doc[k] = structuredClone(ast[k] ?? Model.newDoc()[k]);
    // make sure all built-in styles exist
    const def = Model.defaultStyles();
    for (const [k, v] of Object.entries(def.para)) if (!doc.styles.para[k]) doc.styles.para[k] = v;
    for (const [k, v] of Object.entries(def.char)) if (!doc.styles.char[k]) doc.styles.char[k] = v;
    S.doc = doc;
    App.fillImageSizes(ast.blocks);
    S.ed.innerHTML = Model.astToHtml({ blocks: ast.blocks }, { src: App.src });
    S.name = name || 'Untitled'; S.path = path || null;
    Styles.apply();
    Ed.normalize();
    Pager.run();
    S.hist.reset('Open', App.snapshot());
    Aero.setDoc(S.name, false);
    UI.refresh(true);
    S.ed.focus(); Sel.restore({ a: 1, f: 1 });
    requestAnimationFrame(() => { UI.scrollToCaret(true); });
    if (ast.warnings && ast.warnings.length) Aero.toast(ast.warnings.join(' · '), 4200);
  },
  // default sizes for images that arrive without one: natural size, clamped to the text column
  fillImageSizes(blocks) {
    const cw = S.doc.page.w - S.doc.page.ml - S.doc.page.mr;
    Model.eachPara(blocks, p => { for (const r of p.runs) if (r.t === 'img') { const a = S.assets[r.asset]; if (!a) continue; const nw = (a.w || 300) * 0.75, nh = (a.h || 200) * 0.75; if (!r.w && !r.h) { const s = Math.min(1, cw / nw); r.w = Math.round(nw * s); r.h = Math.round(nh * s); } else if (!r.h) r.h = Math.round(r.w * nh / nw); else if (!r.w) r.w = Math.round(r.h * nw / nh); } });
  },
  async addAssetBytes(data, mime, id) {
    id = id || 'im' + Aero.uid();
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    if (/^image\/(bmp|tiff)$/.test(mime) || /svg/.test(mime) && false) { }
    const blob = new Blob([u8], { type: mime });
    let w = 0, h = 0;
    try { if (/svg/.test(mime)) { const im = new Image(); im.src = URL.createObjectURL(blob); await im.decode(); w = im.naturalWidth || 300; h = im.naturalHeight || 150; URL.revokeObjectURL(im.src); } else { const bm = await createImageBitmap(blob); w = bm.width; h = bm.height; bm.close(); } } catch (e) { w = 300; h = 200; }
    S.assets[id] = { mime, data: u8, url: URL.createObjectURL(blob), w, h };
    return id;
  },
  // add an image from a data: URL (HTML / Markdown import); returns asset id or null
  assetFromDataUrl(src) {
    const m = /^data:(image\/(?:png|jpeg|gif|webp|svg\+xml|bmp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(src || '');
    if (!m) return null;
    const bin = atob(m[2].replace(/\s/g, '')); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const id = 'im' + Aero.uid();
    App._pendingAssets = App._pendingAssets || [];
    App._pendingAssets.push(App.addAssetBytes(u8, m[1].toLowerCase(), id));
    return id;
  },
  // editor -> AST
  toAst(opts = {}) {
    const blocks = Model.htmlToAst(S.ed, { styles: S.doc.styles, hasAsset: id => !!S.assets[id] });
    const ast = { ...structuredClone(App.docOnly()), blocks, assets: {} };
    const used = new Set(); Model.eachPara(blocks, p => p.runs.forEach(r => { if (r.t === 'img') used.add(r.asset); }));
    for (const id of used) if (S.assets[id]) ast.assets[id] = { mime: S.assets[id].mime, data: S.assets[id].data, w: S.assets[id].w, h: S.assets[id].h };
    // drop notes / comments nobody references any more
    const usedN = new Set(), usedC = new Set();
    Model.eachPara(blocks, p => p.runs.forEach(r => { if (r.t === 'fn') usedN.add(r.id); (r.cm || []).forEach(c => usedC.add(c)); }));
    for (const k of Object.keys(ast.notes)) if (!usedN.has(k)) delete ast.notes[k];
    for (const k of Object.keys(ast.comments)) if (!usedC.has(k)) delete ast.comments[k];
    return ast;
  },
  docOnly() { const o = {}; for (const k of App.docLevelKeys) o[k] = S.doc[k]; return o; },
  cleanHtml() { return S.ed.innerHTML.replace(/<(span|div) class="pg-gap"[^>]*><\/\1>/g, '').replace(/<tr class="pg-gap"[^>]*>.*?<\/tr>/g, ''); },
  snapshot() { return { html: App.cleanHtml(), doc: JSON.stringify(App.docOnly()), sel: Sel.save() }; },
  restore(st) {
    if (!st) return;
    S.doc = JSON.parse(st.doc);
    S.ed.innerHTML = st.html;
    Styles.apply();
    Pager.run();
    if (st.sel) Sel.restore(st.sel);
    UI.refresh(true);
  },
  /* ---- history ---- */
  typingTimer: 0, typingPending: false, burst: false,
  commit(label) {
    App.flushTyping();
    S.hist.push(label, App.snapshot());
    App.burst = false;
  },
  // typing is coalesced into one history entry per burst
  typing() {
    App.typingPending = true;
    Aero.setDirty(true);
    clearTimeout(App.typingTimer);
    App.typingTimer = setTimeout(App.flushTyping, 600);
  },
  flushTyping() {
    clearTimeout(App.typingTimer);
    if (!App.typingPending) return;
    App.typingPending = false;
    const top = S.hist.items[S.hist.index];
    if (App.burst && top && top.label === 'Typing' && Date.now() - (top.time || 0) < 4000) { top.state = App.snapshot(); }
    else { S.hist.push('Typing', App.snapshot()); App.burst = true; }
  },
  undo() { App.flushTyping(); App.burst = false; const st = S.hist.undo(); if (st) App.restore(st); },
  redo() { App.flushTyping(); App.burst = false; const st = S.hist.redo(); if (st) App.restore(st); },
};

/* ---------------- style sheet for the document styles ---------------- */
const Styles = {
  el: null,
  apply() {
    if (!this.el) { this.el = document.createElement('style'); this.el.id = 'docstyles'; document.head.appendChild(this.el); }
    const pg = S.doc.page;
    const N = S.doc.styles.para.Normal || {};
    this.el.textContent = Model.stylesCss(S.doc.styles, '#ed') +
      `\n#ed{width:${(pg.w - pg.ml - pg.mr) * PX}px;left:${pg.ml * PX}px;top:${pg.mt * PX}px}` +
      `\n.page .fnarea,.page .hdr,.page .ftr,.fnmeasure{font-family:${Fonts.css(N.font || 'Liberation Sans')}}`;
    Pager.clearCache();
  },
  // resolved paragraph style of a block element
  idOf(el) { if (!el) return 'Normal'; const ds = el.getAttribute && el.getAttribute('data-s'); if (ds) return ds; const m = /^H([1-6])$/.exec(el.nodeName); return m ? 'Heading' + m[1] : 'Normal'; },
};
