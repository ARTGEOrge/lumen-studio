'use strict';
/* Lumen Layout — document model: units, page presets, documents, pages, masters, stories, styles, (de)serialisation. */
(function () {
  const uid = () => Math.random().toString(36).slice(2, 10);
  const UNITS = { pt: 1, mm: 72 / 25.4, in: 72, px: 0.75, pc: 12 };
  const UNIT_NAMES = { pt: 'Points', mm: 'Millimeters', in: 'Inches', px: 'Pixels', pc: 'Picas' };
  const toU = (pt, u) => pt / UNITS[u];
  const fromU = (v, u) => v * UNITS[u];
  const fmtU = (pt, u, d) => { const v = toU(pt, u); const dd = d ?? (u === 'in' ? 3 : u === 'mm' ? 2 : 1); return +v.toFixed(dd) + ''; };

  const PRESETS = [
    ['Letter', 612, 792], ['Legal', 612, 1008], ['Tabloid', 792, 1224],
    ['A3', 841.89, 1190.55], ['A4', 595.28, 841.89], ['A5', 419.53, 595.28],
    ['Business Card', 252, 144], ['Poster 18×24 in', 1296, 1728], ['Poster A2', 1190.55, 1683.78],
  ];

  // Text attribute defaults (char + paragraph)
  const CHAR_KEYS = ['font', 'weight', 'italic', 'size', 'lead', 'track', 'color', 'shift', 'caps', 'under', 'strike', 'kern', 'liga', 'otf'];
  const PARA_KEYS = ['align', 'indL', 'indR', 'indF', 'spB', 'spA', 'dropL', 'dropC', 'hyph', 'grid', 'composer', 'tabs', 'list', 'lchar', 'lfmt', 'lstart'];
  const DEF = { font: 'Source Serif 4', weight: 400, italic: false, size: 11, lead: 0, track: 0, color: '#1a1a1a', shift: 0, caps: 'none', under: false, strike: false, kern: true, liga: true, otf: '',
    align: 'left', indL: 0, indR: 0, indF: 0, spB: 0, spA: 0, dropL: 0, dropC: 1, hyph: true, grid: false, composer: 'single', tabs: [], list: '', lchar: '•', lfmt: '1.', lstart: 0 };
  const FORMAT_VERSION = 2;

  function newDoc(o = {}) {
    const d = {
      format: 'lumen-layout', v: FORMAT_VERSION, cmyk: o.cmyk !== false,
      units: o.units || 'mm', w: o.w || 595.28, h: o.h || 841.89, facing: !!o.facing,
      margins: o.margins || { t: 36, b: 36, i: 36, o: 36 }, cols: o.cols || 1, gutter: o.gutter ?? 12,
      bleed: o.bleed ?? 9, slug: o.slug ?? 0,
      grid: { start: 36, step: 14 },
      layers: [{ id: 'L' + uid(), name: 'Layer 1', color: '#4f7fd9', visible: true, locked: false }],
      masters: [], pages: [], stories: {},
      paraStyles: { basic: { name: 'Basic Paragraph' } },
      charStyles: {},
      swatches: Color.DEFAULT_SWATCHES(), sections: {},
    };
    const m = { id: 'A', prefix: 'A', name: 'Master', pages: d.facing ? [newPage(), newPage()] : [newPage()] };
    d.masters.push(m);
    const n = Math.max(1, o.pages || 1);
    for (let i = 0; i < n; i++) d.pages.push(newPage('A'));
    return d;
  }
  function newPage(master = null) { return { id: 'P' + uid(), master, items: [], guides: [] }; }
  function newStory(d, ps = 'basic') { const s = { id: 'S' + uid(), text: '', ca: [], attrs: [{}], paras: [{ ps }], frames: [], objs: {}, notes: {} }; d.stories[s.id] = s; return s; }
  // attribute index without inline-object / footnote bindings (for text typed next to them)
  function plainAttr(story, ai) { const a = story.attrs[ai]; if (!a || (a.obj === undefined && a.fn === undefined)) return ai; const o = { ...a }; delete o.obj; delete o.fn; return attrIdx(story, o); }
  // page labels honouring sections (style: arabic | roman | ROMAN | alpha | ALPHA, start, prefix)
  function pageLabels(d) {
    const out = []; let n = 0, style = 'arabic', prefix = '';
    d.pages.forEach((p, i) => {
      const sec = d.sections && d.sections[p.id];
      if (sec) { style = sec.style || 'arabic'; prefix = sec.prefix || ''; if (sec.start > 0) n = sec.start - 1; }
      n++;
      out.push(prefix + Layout.fmtNumber(n, style));
    });
    return out;
  }

  /* ---------- story editing ---------- */
  const amaps = new WeakMap();
  function attrIdx(story, attr) {
    const clean = {}; Object.keys(attr).sort().forEach(k => { if (attr[k] !== undefined && attr[k] !== null) clean[k] = attr[k]; });
    const key = JSON.stringify(clean);
    let c = amaps.get(story);
    if (!c || c.n !== story.attrs.length || c.attrs !== story.attrs) {
      c = { m: new Map(), n: story.attrs.length, attrs: story.attrs };
      story.attrs.forEach((a, i) => { const k = JSON.stringify(Object.fromEntries(Object.keys(a).sort().map(x => [x, a[x]]))); if (!c.m.has(k)) c.m.set(k, i); });
      amaps.set(story, c);
    }
    let i = c.m.get(key); if (i !== undefined) return i;
    story.attrs.push(clean); i = story.attrs.length - 1; c.m.set(key, i); c.n = story.attrs.length;
    return i;
  }
  function paraIndexAt(story, pos) { let n = 0; const t = story.text; for (let i = 0; i < pos && i < t.length; i++) if (t.charCodeAt(i) === 10) n++; return n; }
  function paraStart(story, pi) { if (pi === 0) return 0; let n = 0; const t = story.text; for (let i = 0; i < t.length; i++) if (t.charCodeAt(i) === 10 && ++n === pi) return i + 1; return t.length; }
  function paraEnd(story, pi) { const s = paraStart(story, pi); const e = story.text.indexOf('\n', s); return e < 0 ? story.text.length : e; }
  function insertText(story, pos, str, ai) {
    str = String(str).replace(/\r\n?/g, '\n');
    if (!str) return pos;
    if (ai == null) ai = plainAttr(story, story.ca[pos - 1] ?? story.ca[pos] ?? 0);
    const pi = paraIndexAt(story, pos);
    story.text = story.text.slice(0, pos) + str + story.text.slice(pos);
    story.ca = story.ca.slice(0, pos).concat(new Array(str.length).fill(ai), story.ca.slice(pos));
    const nl = (str.match(/\n/g) || []).length;
    if (nl) { const tpl = story.paras[pi]; const add = []; for (let k = 0; k < nl; k++) add.push({ ...tpl }); story.paras = story.paras.slice(0, pi + 1).concat(add, story.paras.slice(pi + 1)); }
    return pos + str.length;
  }
  function deleteRange(story, a, b) {
    if (b < a) [a, b] = [b, a]; if (a === b) return a;
    const removed = story.text.slice(a, b), nl = (removed.match(/\n/g) || []).length;
    const pi = paraIndexAt(story, a);
    story.text = story.text.slice(0, a) + story.text.slice(b);
    story.ca.splice(a, b - a);
    if (nl) story.paras.splice(pi + 1, nl);
    return a;
  }
  // Rich fragment (for copy/paste): {text, attrs:[...], ca:[...], paras:[...]}
  function sliceRich(story, a, b) {
    const text = story.text.slice(a, b), ca = story.ca.slice(a, b), used = [...new Set(ca)];
    const p0 = paraIndexAt(story, a), nl = (text.match(/\n/g) || []).length;
    const attrs = used.map(i => story.attrs[i]), objs = {}, notes = {};
    for (const at of attrs) { if (at.obj && story.objs?.[at.obj]) objs[at.obj] = structuredClone(story.objs[at.obj]); if (at.fn && story.notes?.[at.fn]) notes[at.fn] = structuredClone(story.notes[at.fn]); }
    return { text, attrs, ca: ca.map(i => used.indexOf(i)), paras: story.paras.slice(p0, p0 + nl + 1).map(p => ({ ...p })), objs, notes };
  }
  function insertRich(story, pos, frag) {
    const pi = paraIndexAt(story, pos);
    story.objs = story.objs || {}; story.notes = story.notes || {};
    // inline objects and footnotes are copied under fresh ids so each pasted copy is independent
    const map = frag.attrs.map(a => {
      const o = { ...a };
      if (o.obj) { const src = frag.objs?.[o.obj]; if (src && typeof src === 'object') { const id = 'O' + uid(); story.objs[id] = structuredClone(src); story.objs[id].id = id; o.obj = id; } else delete o.obj; }
      if (o.fn) { const src = frag.notes?.[o.fn]; if (src && typeof src === 'object') { const id = 'N' + uid(); story.notes[id] = { text: String(src.text || '') }; o.fn = id; } else delete o.fn; }
      return attrIdx(story, o);
    });
    const t = frag.text.replace(/\r\n?/g, '\n');
    story.text = story.text.slice(0, pos) + t + story.text.slice(pos);
    story.ca = story.ca.slice(0, pos).concat(frag.ca.map(i => map[i] ?? 0), story.ca.slice(pos));
    const nl = (t.match(/\n/g) || []).length;
    if (nl) {
      // the paragraph containing pos takes frag.paras[0]'s style only if inserting at para start
      const add = []; for (let k = 1; k <= nl; k++) add.push({ ...(frag.paras[k] || story.paras[pi]) });
      story.paras = story.paras.slice(0, pi + 1).concat(add, story.paras.slice(pi + 1));
    }
    return pos + t.length;
  }

  /* ---------- style resolution ---------- */
  function paraStyleChain(doc, id, depth = 0) {
    const s = doc.paraStyles[id] || doc.paraStyles.basic || {};
    if (s.basedOn && s.basedOn !== id && depth < 8 && doc.paraStyles[s.basedOn]) return { ...paraStyleChain(doc, s.basedOn, depth + 1), ...stripMeta(s) };
    return stripMeta(s);
  }
  function stripMeta(s) { const o = {}; for (const k in s) if (k !== 'name' && k !== 'basedOn' && k !== 'next') o[k] = s[k]; return o; }
  // effective paragraph attributes (paragraph + char base) for paragraph object
  function paraEff(doc, para) { return { ...DEF, ...paraStyleChain(doc, para.ps), ...stripMeta(para) }; }
  function charEff(doc, pe, attr) {
    const cs = attr.cs && doc.charStyles[attr.cs] ? stripMeta(doc.charStyles[attr.cs]) : null;
    const o = { ...pe }; if (cs) Object.assign(o, cs);
    for (const k in attr) if (k !== 'cs') o[k] = attr[k];
    return o;
  }

  /* ---------- items ---------- */
  function newItem(type, x, y, w, h, extra = {}) {
    const base = { id: 'I' + uid(), type, x, y, w, h, rot: 0, opacity: 1, fill: null, stroke: null, sw: 1, radius: 0, wrap: 'none', wrapOff: 6 };
    if (type === 'text') Object.assign(base, { story: null, cols: 1, gutter: 12, inset: 0, valign: 'top' });
    if (type === 'image') Object.assign(base, { img: null, cx: 0, cy: 0, cs: 1, fit: null });
    if (type === 'line') Object.assign(base, { stroke: '#1a1a1a', sw: 1, dir: 1 });
    if ((type === 'rect' || type === 'ellipse') && !('fill' in extra)) { base.fill = '#cfd8e3'; }
    return Object.assign(base, extra);
  }
  function newTable(x, y, cols, rows, w, rowH = 20, header = 1) {
    const cw = w / cols;
    const cells = []; for (let r = 0; r < rows; r++) { const row = []; for (let c = 0; c < cols; c++) row.push({ t: '' }); cells.push(row); }
    return { id: 'I' + uid(), type: 'table', x, y, w, h: rows * rowH, rot: 0, opacity: 1, fill: null, stroke: null, sw: 1, radius: 0, wrap: 'none', wrapOff: 6,
      colW: new Array(cols).fill(cw), rowH: new Array(rows).fill(rowH), cells, header,
      tfont: 'Montserrat', tsize: 8, tcolor: '#1a1a1a', hfill: '#1f3b57', hcolor: '#ffffff', bcolor: '#9fb0c2', bw: 0.5, zebra: '#eef3f8', pad: 4 };
  }

  /* ---------- serialisation ---------- */
  function rle(ca) { const out = []; for (let i = 0; i < ca.length;) { let j = i; while (j < ca.length && ca[j] === ca[i]) j++; out.push([ca[i], j - i]); i = j; } return out; }
  function unrle(r) { const out = []; for (const [v, n] of r || []) for (let k = 0; k < n; k++) out.push(v); return out; }
  function serialize(doc, images) {
    const d = JSON.parse(JSON.stringify(doc));
    for (const s of Object.values(d.stories)) {
      const live = new Set(); s.ca.forEach((ai, k) => { const at = s.attrs[ai]; if (at && (s.text[k] === '\uFFFC' || s.text[k] === '\uE001')) { if (at.obj) live.add(at.obj); if (at.fn) live.add(at.fn); } });
      for (const k of Object.keys(s.objs || {})) if (!live.has(k)) delete s.objs[k];
      for (const k of Object.keys(s.notes || {})) if (!live.has(k)) delete s.notes[k];
      s.runs = rle(s.ca); delete s.ca;
    }
    // only images referenced by items
    const used = new Set(); walkAll(d, it => { if (it.type === 'image' && it.img) used.add(it.img); });
    for (const s of Object.values(d.stories)) for (const o of Object.values(s.objs || {})) if (o.kind === 'graphic' && o.item?.img) used.add(o.item.img);
    for (const [id, im] of Object.entries(images)) if (im && im.keep) used.add(id);   // images loaded for data merge
    d.images = {}; for (const id of used) if (images[id]) { const im = images[id]; d.images[id] = { name: im.name, mime: im.mime, data: im.data, w: im.w, h: im.h, ...(im.keep ? { keep: true } : {}) }; }
    return JSON.stringify(d);
  }
  const SAFE_IMG = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/;
  // Parse an untrusted .llay file into {doc, images}. Only plain data survives; nothing is executed.
  function deserialize(text) {
    const d = JSON.parse(text);
    if (!d || d.format !== 'lumen-layout' || !Array.isArray(d.pages)) throw new Error('Not a Lumen Layout document');
    const images = {};
    for (const [id, im] of Object.entries(d.images || {})) {
      if (im && typeof im.data === 'string' && SAFE_IMG.test(im.data.slice(0, 64) + 'A') && SAFE_IMG.test(im.data)) images[id] = { name: String(im.name || 'image').slice(0, 260), mime: String(im.mime || ''), data: im.data, w: +im.w || 1, h: +im.h || 1, ...(im.keep === true ? { keep: true } : {}) };
    }
    delete d.images;
    const num = (v, def) => Number.isFinite(+v) ? +v : def;
    d.w = num(d.w, 612); d.h = num(d.h, 792); d.units = UNITS[d.units] ? d.units : 'pt';
    d.margins = d.margins || { t: 36, b: 36, i: 36, o: 36 }; d.cols = Math.max(1, num(d.cols, 1) | 0); d.gutter = num(d.gutter, 12);
    d.bleed = num(d.bleed, 0); d.slug = num(d.slug, 0); d.grid = d.grid || { start: 36, step: 14 };
    d.layers = Array.isArray(d.layers) && d.layers.length ? d.layers : [{ id: 'L1', name: 'Layer 1', color: '#4f7fd9', visible: true, locked: false }];
    d.masters = Array.isArray(d.masters) ? d.masters : [];
    d.paraStyles = d.paraStyles || { basic: { name: 'Basic Paragraph' } }; if (!d.paraStyles.basic) d.paraStyles.basic = { name: 'Basic Paragraph' };
    d.charStyles = d.charStyles || {};
    d.swatches = Color.migrateSwatches(d.swatches);
    d.cmyk = d.cmyk === true; d.v = FORMAT_VERSION;
    d.sections = sanitizeSections(d.sections);
    d.toc = sanitizeToc(d.toc);
    d.merge = sanitizeMerge(d.merge);
    d.footnotes = d.footnotes && typeof d.footnotes === 'object' ? { continuous: d.footnotes.continuous === true, start: fin(d.footnotes.start, 1, 1, 100000) | 0 } : { continuous: false, start: 1 };
    for (const st of [...Object.values(d.paraStyles), ...Object.values(d.charStyles)]) sanitizeAttrs(st);
    d.stories = d.stories || {};
    for (const s of Object.values(d.stories)) {
      s.text = String(s.text || ''); s.ca = s.runs ? unrle(s.runs) : new Array(s.text.length).fill(0); delete s.runs;
      if (s.ca.length !== s.text.length) s.ca = new Array(s.text.length).fill(0);
      s.attrs = Array.isArray(s.attrs) && s.attrs.length ? s.attrs : [{}];
      const np = (s.text.match(/\n/g) || []).length + 1;
      s.paras = Array.isArray(s.paras) ? s.paras : []; while (s.paras.length < np) s.paras.push({ ps: 'basic' }); s.paras.length = np;
      s.frames = Array.isArray(s.frames) ? s.frames : [];
      s.attrs = s.attrs.map(a => sanitizeAttrs(a && typeof a === 'object' ? a : {}));
      s.paras = s.paras.map(p => sanitizeAttrs(p && typeof p === 'object' ? p : { ps: 'basic' }));
      s.objs = sanitizeObjs(s.objs, images); s.notes = sanitizeNotes(s.notes);
    }
    walkAll(d, it => sanitizeItem(it));
    for (const p of [...d.pages, ...d.masters.flatMap(m => m.pages || [])]) { p.items = Array.isArray(p.items) ? p.items : []; p.guides = Array.isArray(p.guides) ? p.guides : []; if (!p.id) p.id = 'P' + uid(); }
    return { doc: d, images };
  }

  /* ---------- validation of untrusted document data (format v2 additions) ---------- */
  const fin = (v, def, lo = -1e6, hi = 1e6) => Number.isFinite(+v) ? Math.max(lo, Math.min(hi, +v)) : def;
  const str = (v, max = 200) => typeof v === 'string' ? v.slice(0, max) : '';
  const col = (v, def = null) => Color.validRef(v) ? v : def;
  const ID = /^[\w-]{1,40}$/;
  function sanitizeTabs(t) { return Array.isArray(t) ? t.slice(0, 40).filter(x => x && Number.isFinite(+x.x)).map(x => ({ x: fin(x.x, 0, 0, 5000), t: ['l', 'c', 'r', 'd'].includes(x.t) ? x.t : 'l', ...(x.ld ? { ld: str(x.ld, 2) } : {}), ...(x.ac ? { ac: str(x.ac, 1) } : {}) })).sort((a, b) => a.x - b.x) : []; }
  function sanitizeAttrs(a) {
    if ('color' in a) { const c = col(a.color); if (c) a.color = c; else delete a.color; }
    if ('tabs' in a) a.tabs = sanitizeTabs(a.tabs);
    if ('list' in a && !['', 'bullet', 'number'].includes(a.list)) delete a.list;
    if ('lchar' in a) a.lchar = str(a.lchar, 2) || '•';
    if ('lfmt' in a && !/^(1|a|A|i|I)[.)]?$/.test(a.lfmt)) delete a.lfmt;
    if ('lstart' in a) a.lstart = fin(a.lstart, 0, 0, 100000) | 0;
    if ('composer' in a && a.composer !== 'paragraph' && a.composer !== 'single') delete a.composer;
    if ('otf' in a) a.otf = String(a.otf || '').split(/[\s,]+/).filter(t => /^[a-z0-9]{4}$/.test(t)).join(' ');
    if ('kadj' in a) a.kadj = fin(a.kadj, 0, -1000, 1000);
    for (const k of ['kern', 'liga']) if (k in a) a[k] = a[k] !== false;
    if ('obj' in a && (typeof a.obj !== 'string' || !ID.test(a.obj))) delete a.obj;
    if ('fn' in a && (typeof a.fn !== 'string' || !ID.test(a.fn))) delete a.fn;
    return a;
  }
  function sanitizeTable(t, inline) {
    const nc = Math.max(1, Math.min(60, Array.isArray(t.colW) ? t.colW.length : 1)), nr = Math.max(1, Math.min(500, Array.isArray(t.rowH) ? t.rowH.length : 1));
    const o = inline ? { kind: 'table' } : t;
    const cw = Array.from({ length: nc }, (_, k) => fin(t.colW?.[k], 50, 2, 5000)), rh = Array.from({ length: nr }, (_, k) => fin(t.rowH?.[k], 18, 2, 5000));
    const cells = Array.from({ length: nr }, (_, r) => Array.from({ length: nc }, (_, c) => { const x = t.cells?.[r]?.[c] || {}; const y = { t: str(x.t, 5000) };
      if (x.fill) y.fill = col(x.fill); if (x.color) y.color = col(x.color); if (['left', 'center', 'right'].includes(x.align)) y.align = x.align; if (x.bold) y.bold = true;
      if (x.cs > 1) y.cs = fin(x.cs, 1, 1, nc) | 0; if (x.rs > 1) y.rs = fin(x.rs, 1, 1, nr) | 0; for (const k in y) if (y[k] == null) delete y[k]; return y; }));
    o.colW = cw; o.rowH = rh; o.cells = cells;
    o.header = fin(t.header, 0, 0, nr) | 0; o.tfont = Fonts.FAMILIES[t.tfont] ? t.tfont : 'Montserrat'; o.tsize = fin(t.tsize, 8, 2, 200);
    for (const k of ['tcolor', 'hfill', 'hcolor', 'bcolor', 'zebra']) o[k] = col(t[k], k === 'tcolor' ? '#1a1a1a' : null);
    o.bw = fin(t.bw, 0.5, 0, 20); o.pad = fin(t.pad, 4, 0, 100);
    return Tables.normalize(o);
  }
  function sanitizeItem(it) {
    for (const k of ['fill', 'stroke']) if (k in it) it[k] = col(it[k]);
    if (it.grad) { if (typeof it.grad !== 'object') delete it.grad; else { it.grad = { angle: fin(it.grad.angle, 0), c0: col(it.grad.c0, '#ffffff'), o0: fin(it.grad.o0, 1, 0, 1), c1: col(it.grad.c1, '#000000'), o1: fin(it.grad.o1, 1, 0, 1) }; } }
    if (it.wrap && !['none', 'box', 'shape', 'contour', 'jump'].includes(it.wrap)) it.wrap = 'none';
    for (const k of ['opFill', 'opStroke']) if (k in it) it[k] = it[k] === true;
    if ('mergeField' in it) { if (typeof it.mergeField === 'string' && it.mergeField.length < 80) it.mergeField = it.mergeField; else delete it.mergeField; }
    if (it.type === 'table') sanitizeTable(it, false);
  }
  function sanitizeObjs(objs, images) {
    const out = {};
    if (!objs || typeof objs !== 'object') return out;
    for (const [id, o] of Object.entries(objs)) {
      if (!ID.test(id) || !o || typeof o !== 'object') continue;
      if (o.kind === 'table') { const t = sanitizeTable(o, true); t.id = id; out[id] = t; continue; }
      if (o.kind === 'graphic' && o.item && typeof o.item === 'object') {
        const s = o.item, type = ['image', 'rect', 'ellipse'].includes(s.type) ? s.type : 'rect';
        const item = { type, w: fin(s.w, 36, 1, 5000), h: fin(s.h, 36, 1, 5000), fill: col(s.fill), stroke: col(s.stroke), sw: fin(s.sw, 1, 0, 100), radius: fin(s.radius, 0, 0, 1000) };
        if (type === 'image') { item.img = typeof s.img === 'string' && images[s.img] ? s.img : null; item.cs = fin(s.cs, 1, 1e-4, 1e4); item.cx = fin(s.cx, 0); item.cy = fin(s.cy, 0); }
        out[id] = { kind: 'graphic', id, item, pos: o.pos === 'above' ? 'above' : 'inline', align: ['left', 'center', 'right'].includes(o.align) ? o.align : 'left', shift: fin(o.shift, 0, -1000, 1000) };
      }
    }
    return out;
  }
  function sanitizeNotes(n) { const out = {}; if (n && typeof n === 'object') for (const [id, x] of Object.entries(n)) if (ID.test(id) && x && typeof x === 'object') out[id] = { text: str(x.text, 20000) }; return out; }
  function sanitizeSections(sec) {
    const out = {}; if (!sec || typeof sec !== 'object') return out;
    for (const [id, x] of Object.entries(sec)) if (typeof id === 'string' && id.length < 60 && x && typeof x === 'object') out[id] = { style: ['arabic', 'roman', 'ROMAN', 'alpha', 'ALPHA'].includes(x.style) ? x.style : 'arabic', start: x.start > 0 ? fin(x.start, 1, 1, 1e6) | 0 : null, prefix: str(x.prefix, 12) };
    return out;
  }
  function sanitizeToc(t) {
    if (!t || typeof t !== 'object') return null;
    return { sid: str(t.sid, 40), title: str(t.title, 200), styles: Array.isArray(t.styles) ? t.styles.slice(0, 20).filter(x => x && typeof x.ps === 'string').map(x => ({ ps: str(x.ps, 60), level: fin(x.level, 1, 1, 4) | 0 })) : [] };
  }
  function sanitizeMerge(m) {
    if (!m || typeof m !== 'object' || !Array.isArray(m.fields)) return null;
    const fields = m.fields.slice(0, 100).map(f => str(f, 80));
    return { name: str(m.name, 200), fields, rows: Array.isArray(m.rows) ? m.rows.slice(0, 10000).map(r => fields.map((_, k) => str(Array.isArray(r) ? r[k] : '', 5000))) : [] };
  }
  function walkItems(items, fn, parent = null) { for (const it of items) { fn(it, parent); if (it.type === 'group') walkItems(it.children, fn, it); } }
  function walkAll(d, fn) { for (const p of d.pages) walkItems(p.items, fn); for (const m of d.masters) for (const p of m.pages) walkItems(p.items, fn); }

  window.M = { uid, UNITS, UNIT_NAMES, toU, fromU, fmtU, PRESETS, DEF, CHAR_KEYS, PARA_KEYS, newDoc, newPage, newStory, attrIdx, paraIndexAt, paraStart, paraEnd,
    insertText, deleteRange, sliceRich, insertRich, paraStyleChain, paraEff, charEff, stripMeta, newItem, newTable, serialize, deserialize, walkItems, walkAll, rle, unrle,
    plainAttr, pageLabels, sanitizeTable, sanitizeAttrs, FORMAT_VERSION };
})();
