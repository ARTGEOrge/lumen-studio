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
  const CHAR_KEYS = ['font', 'weight', 'italic', 'size', 'lead', 'track', 'color', 'shift', 'caps', 'under', 'strike'];
  const PARA_KEYS = ['align', 'indL', 'indR', 'indF', 'spB', 'spA', 'dropL', 'dropC', 'hyph', 'grid'];
  const DEF = { font: 'Source Serif 4', weight: 400, italic: false, size: 11, lead: 0, track: 0, color: '#1a1a1a', shift: 0, caps: 'none', under: false, strike: false,
    align: 'left', indL: 0, indR: 0, indF: 0, spB: 0, spA: 0, dropL: 0, dropC: 1, hyph: true, grid: false };

  function newDoc(o = {}) {
    const d = {
      format: 'lumen-layout', v: 1,
      units: o.units || 'mm', w: o.w || 595.28, h: o.h || 841.89, facing: !!o.facing,
      margins: o.margins || { t: 36, b: 36, i: 36, o: 36 }, cols: o.cols || 1, gutter: o.gutter ?? 12,
      bleed: o.bleed ?? 9, slug: o.slug ?? 0,
      grid: { start: 36, step: 14 },
      layers: [{ id: 'L' + uid(), name: 'Layer 1', color: '#4f7fd9', visible: true, locked: false }],
      masters: [], pages: [], stories: {},
      paraStyles: { basic: { name: 'Basic Paragraph' } },
      charStyles: {},
      swatches: ['#000000', '#ffffff', '#1a1a1a', '#5b6b7c', '#c8102e', '#e8862a', '#f2c12e', '#2a9d5c', '#1f6fb5', '#5a3fa0', '#0e3a5b', '#efe6d8'],
    };
    const m = { id: 'A', prefix: 'A', name: 'Master', pages: d.facing ? [newPage(), newPage()] : [newPage()] };
    d.masters.push(m);
    const n = Math.max(1, o.pages || 1);
    for (let i = 0; i < n; i++) d.pages.push(newPage('A'));
    return d;
  }
  function newPage(master = null) { return { id: 'P' + uid(), master, items: [], guides: [] }; }
  function newStory(d, ps = 'basic') { const s = { id: 'S' + uid(), text: '', ca: [], attrs: [{}], paras: [{ ps }], frames: [] }; d.stories[s.id] = s; return s; }

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
    if (ai == null) ai = story.ca[pos - 1] ?? story.ca[pos] ?? 0;
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
    return { text, attrs: used.map(i => story.attrs[i]), ca: ca.map(i => used.indexOf(i)), paras: story.paras.slice(p0, p0 + nl + 1).map(p => ({ ...p })) };
  }
  function insertRich(story, pos, frag) {
    const pi = paraIndexAt(story, pos);
    const map = frag.attrs.map(a => attrIdx(story, a));
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
    for (const s of Object.values(d.stories)) { s.runs = rle(s.ca); delete s.ca; }
    // only images referenced by items
    const used = new Set(); walkAll(d, it => { if (it.type === 'image' && it.img) used.add(it.img); });
    d.images = {}; for (const id of used) if (images[id]) d.images[id] = images[id];
    return JSON.stringify(d);
  }
  const SAFE_IMG = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,[A-Za-z0-9+/=\s]+$/;
  // Parse an untrusted .llay file into {doc, images}. Only plain data survives; nothing is executed.
  function deserialize(text) {
    const d = JSON.parse(text);
    if (!d || d.format !== 'lumen-layout' || !Array.isArray(d.pages)) throw new Error('Not a Lumen Layout document');
    const images = {};
    for (const [id, im] of Object.entries(d.images || {})) {
      if (im && typeof im.data === 'string' && SAFE_IMG.test(im.data.slice(0, 64) + 'A') && SAFE_IMG.test(im.data)) images[id] = { name: String(im.name || 'image'), mime: String(im.mime || ''), data: im.data, w: +im.w || 1, h: +im.h || 1 };
    }
    delete d.images;
    const num = (v, def) => Number.isFinite(+v) ? +v : def;
    d.w = num(d.w, 612); d.h = num(d.h, 792); d.units = UNITS[d.units] ? d.units : 'pt';
    d.margins = d.margins || { t: 36, b: 36, i: 36, o: 36 }; d.cols = Math.max(1, num(d.cols, 1) | 0); d.gutter = num(d.gutter, 12);
    d.bleed = num(d.bleed, 0); d.slug = num(d.slug, 0); d.grid = d.grid || { start: 36, step: 14 };
    d.layers = Array.isArray(d.layers) && d.layers.length ? d.layers : [{ id: 'L1', name: 'Layer 1', color: '#4f7fd9', visible: true, locked: false }];
    d.masters = Array.isArray(d.masters) ? d.masters : [];
    d.paraStyles = d.paraStyles || { basic: { name: 'Basic Paragraph' } }; if (!d.paraStyles.basic) d.paraStyles.basic = { name: 'Basic Paragraph' };
    d.charStyles = d.charStyles || {}; d.swatches = Array.isArray(d.swatches) ? d.swatches : [];
    d.stories = d.stories || {};
    for (const s of Object.values(d.stories)) {
      s.text = String(s.text || ''); s.ca = s.runs ? unrle(s.runs) : new Array(s.text.length).fill(0); delete s.runs;
      if (s.ca.length !== s.text.length) s.ca = new Array(s.text.length).fill(0);
      s.attrs = Array.isArray(s.attrs) && s.attrs.length ? s.attrs : [{}];
      const np = (s.text.match(/\n/g) || []).length + 1;
      s.paras = Array.isArray(s.paras) ? s.paras : []; while (s.paras.length < np) s.paras.push({ ps: 'basic' }); s.paras.length = np;
      s.frames = Array.isArray(s.frames) ? s.frames : [];
    }
    for (const p of [...d.pages, ...d.masters.flatMap(m => m.pages || [])]) { p.items = Array.isArray(p.items) ? p.items : []; p.guides = Array.isArray(p.guides) ? p.guides : []; if (!p.id) p.id = 'P' + uid(); }
    return { doc: d, images };
  }
  function walkItems(items, fn, parent = null) { for (const it of items) { fn(it, parent); if (it.type === 'group') walkItems(it.children, fn, it); } }
  function walkAll(d, fn) { for (const p of d.pages) walkItems(p.items, fn); for (const m of d.masters) for (const p of m.pages) walkItems(p.items, fn); }

  window.M = { uid, UNITS, UNIT_NAMES, toU, fromU, fmtU, PRESETS, DEF, CHAR_KEYS, PARA_KEYS, newDoc, newPage, newStory, attrIdx, paraIndexAt, paraStart, paraEnd,
    insertText, deleteRange, sliceRich, insertRich, paraStyleChain, paraEff, charEff, stripMeta, newItem, newTable, serialize, deserialize, walkItems, walkAll, rle, unrle };
})();
