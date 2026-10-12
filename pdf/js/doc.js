// Document model: state snapshots (bytes + annotations + form values + props), pdf.js loading, annotation import.
import { loadPdf } from './pdfjs.js';
import { uid, rgb2hex, normRect } from './util.js';
const L = window.PDFLib;
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFString, PDFHexString, PDFNumber, PDFStream } = L;

const IMPORT = { Highlight: 'highlight', Underline: 'underline', StrikeOut: 'strike', Squiggly: 'squiggly', Text: 'note', Ink: 'ink', Square: 'rect', Circle: 'ellipse', Line: 'line', FreeText: 'freetext', Redact: 'redact', Stamp: 'stamp' };
const DEF_COLOR = { highlight: '#ffd400', underline: '#1f6fd0', strike: '#d42020', squiggly: '#1f9d3a', note: '#ffd84d', ink: '#d42020', rect: '#d42020', ellipse: '#d42020', line: '#d42020', freetext: '#000000', redact: '#000000' };

const pdfCache = new Map(); // bytes -> Promise<{pdf, info}>
async function pdfFor(bytes, onPassword) {
  if (pdfCache.has(bytes)) { const p = pdfCache.get(bytes); pdfCache.delete(bytes); pdfCache.set(bytes, p); return p; }
  const p = (async () => {
    const pdf = await loadPdf(bytes, { onPassword });
    const pages = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)));
    const info = pages.map(pg => { const v = pg.view; return { view: v, rotate: pg.rotate, w: v[2] - v[0], h: v[3] - v[1], userUnit: pg.userUnit || 1 }; });
    return { pdf, info };
  })();
  pdfCache.set(bytes, p);
  p.catch(() => pdfCache.delete(bytes));
  return p;
}
// Keep a few recently used pdf.js documents (fast undo); destroy older ones that no open tab is showing.
export function releaseBytes(inUse) {
  const live = new Set(inUse);
  for (const b of [...pdfCache.keys()]) {
    if (pdfCache.size <= 5) break;
    if (live.has(b)) continue;
    const p = pdfCache.get(b); pdfCache.delete(b); p.then(x => (x.pdf.destroy ? x.pdf.destroy() : x.pdf.loadingTask.destroy())).catch(() => { });
  }
}

let docCounter = 0;
export class Doc {
  constructor(name) {
    this.id = 'd' + (++docCounter); this.name = name || 'Untitled.pdf'; this.path = null;
    this.state = null; this.pdf = null; this.info = []; this.outline = null; this.readOnly = false; this.dirty = false;
    this.view = { zoom: 'fitw', mode: 'cont', rot: 0, scroll: 0, page: 0, cover: false };
    this.text = new Map(); this.pageAnnots = new Map();
    this.hist = null; this.onPassword = null;
  }
  get numPages() { return this.state ? this.state.pageIds.length : 0; }
  async loadBytes(bytes) {
    const { pdf, info } = await pdfFor(bytes, this.onPassword);
    if (!this.state.pageIds.length) this.state.pageIds = Array.from({ length: pdf.numPages }, uid);
    if (pdf.numPages !== this.state.pageIds.length) throw new Error('Page count mismatch');
    this.pdf = pdf; this.info = info; this.text = new Map(); this.pageAnnots = new Map(); this.outline = null;
  }
  snapshot() { const s = this.state; return { bytes: s.bytes, pageIds: s.pageIds.slice(), annots: structuredClone(s.annots), form: { ...s.form }, props: { ...s.props }, security: s.security || null }; }
  async restore(snap) {
    const bytesChanged = snap.bytes !== this.state.bytes;
    this.state = { bytes: snap.bytes, pageIds: snap.pageIds.slice(), annots: structuredClone(snap.annots), form: { ...snap.form }, props: { ...snap.props }, security: snap.security || null };
    if (bytesChanged) await this.loadBytes(snap.bytes);
    return bytesChanged;
  }
  commit(label) { this.dirty = true; this.hist.push(label, this.snapshot()); }
  annot(id) { return this.state.annots.find(a => a.id === id); }
  annotsOnPage(i) { const pid = this.state.pageIds[i]; return this.state.annots.filter(a => a.page === pid); }
  pageOf(a) { return this.state.pageIds.indexOf(a.page); }
  async getPage(i) { return this.pdf.getPage(i + 1); }
  async getText(i) {
    if (this.text.has(i)) return this.text.get(i);
    const p = (async () => {
      const page = await this.getPage(i);
      const tc = await page.getTextContent();
      let str = ''; const starts = [], items = [];
      for (const it of tc.items) {
        if (it.str === undefined) continue;
        starts.push(str.length); items.push(it); str += it.str; if (it.hasEOL) str += ' ';
      }
      return { str, starts, items };
    })();
    this.text.set(i, p); return p;
  }
  async getPageAnnots(i) {
    if (this.pageAnnots.has(i)) return this.pageAnnots.get(i);
    const p = this.getPage(i).then(pg => pg.getAnnotations({ intent: 'display' })).catch(() => []);
    this.pageAnnots.set(i, p); return p;
  }
  async getOutline() {
    if (!this.outline) this.outline = this.pdf.getOutline().catch(() => null);
    return this.outline;
  }
  // resolve a destination (string or array) -> {page, top}
  async resolveDest(dest) {
    try {
      if (typeof dest === 'string') dest = await this.pdf.getDestination(dest);
      if (!Array.isArray(dest)) return null;
      const ref = dest[0]; let page;
      if (typeof ref === 'object' && ref) page = await this.pdf.getPageIndex(ref); else if (Number.isInteger(ref)) page = ref;
      if (page == null) return null;
      const kind = dest[1]?.name; let top = null;
      if (kind === 'XYZ') top = dest[3]; else if (kind === 'FitH' || kind === 'FitBH') top = dest[2]; else if (kind === 'FitR') top = dest[5];
      return { page, top };
    } catch (e) { return null; }
  }
}

/* ---------------- import ---------------- */
const nm = (d, k) => { const v = d.lookup(PDFName.of(k)); return v instanceof PDFName ? v.decodeText() : null; };
const num = (d, k) => { const v = d.lookup(PDFName.of(k)); return v instanceof PDFNumber ? v.asNumber() : null; };
const nums = (d, k) => { const v = d.lookup(PDFName.of(k)); return v instanceof PDFArray ? v.asArray().map(x => { const y = x instanceof PDFRef ? d.context.lookup(x) : x; return y instanceof PDFNumber ? y.asNumber() : 0; }) : null; };
const str = (d, k) => { const v = d.lookup(PDFName.of(k)); return (v instanceof PDFString || v instanceof PDFHexString) ? v.decodeText() : null; };
const date = (d, k) => { const v = d.lookup(PDFName.of(k)); try { return (v instanceof PDFString || v instanceof PDFHexString) ? v.decodeDate().toISOString() : null; } catch (e) { return null; } };
function bsWidth(d) {
  const bs = d.lookup(PDFName.of('BS'));
  if (bs instanceof PDFDict) { const w = num(bs, 'W'); if (w != null) return w; }
  const b = nums(d, 'Border'); if (b && b.length >= 3) return b[2];
  return null;
}
function parseDA(da) {
  const out = {}; if (!da) return out;
  const m = /([\d.]+)\s+Tf/.exec(da); if (m) out.size = +m[1] || null;
  const c = /([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/.exec(da); if (c) out.color = rgb2hex([+c[1], +c[2], +c[3]]);
  else { const g = /([\d.]+)\s+g(\s|$)/.exec(da); if (g) out.color = rgb2hex([+g[1]]); }
  return out;
}
const chunk = (a, n) => { const out = []; for (let i = 0; i + n <= a.length; i += n) out.push(a.slice(i, i + n)); return out; };

function convert(d, pageId, usedIds) {
  const st = nm(d, 'Subtype'); const type = IMPORT[st]; if (!type) return null;
  if (d.lookup(PDFName.of('IRT'))) return null; // replies handled separately
  let extra = {}; const ld = d.lookup(PDFName.of('LumenData'));
  if (ld) { try { extra = JSON.parse(ld.decodeText()); } catch (e) { extra = {}; } }
  if (st === 'Stamp' && !ld) return null; // keep foreign stamps (custom appearances) untouched
  const rectRaw = nums(d, 'Rect'); if (!rectRaw || rectRaw.length < 4) return null;
  const rect = normRect(rectRaw);
  let id = str(d, 'NM'); if (!id || usedIds.has(id)) id = uid(); usedIds.add(id);
  const a = {
    id, type, page: pageId, color: rgb2hex(nums(d, 'C')) || DEF_COLOR[type] || '#000000', opacity: num(d, 'CA') ?? 1,
    author: str(d, 'T') || '', date: date(d, 'M') || date(d, 'CreationDate'), contents: str(d, 'Contents') || '', replies: [], rot: extra.rot || 0
  };
  switch (type) {
    case 'highlight': case 'underline': case 'strike': case 'squiggly': {
      const q = nums(d, 'QuadPoints');
      a.quads = q && q.length >= 8 ? chunk(q, 8) : [[rect[0], rect[3], rect[2], rect[3], rect[0], rect[1], rect[2], rect[1]]];
      break;
    }
    case 'note': a.x = rect[0]; a.y = rect[3]; break;
    case 'ink': {
      const il = d.lookup(PDFName.of('InkList')); if (!(il instanceof PDFArray)) return null;
      a.width = extra.w ?? bsWidth(d) ?? 1;
      a.strokes = il.asArray().map((s, si) => { const arr = (s instanceof PDFRef ? d.context.lookup(s) : s).asArray().map(x => x.asNumber()); return chunk(arr, 2).map((p, pi) => [p[0], p[1], extra.p?.[si]?.[pi] ?? 0.5]); }).filter(s => s.length);
      if (!a.strokes.length) return null;
      break;
    }
    case 'rect': case 'ellipse': a.rect = rect; a.width = bsWidth(d) ?? 1; a.fill = rgb2hex(nums(d, 'IC')); break;
    case 'line': {
      const l = nums(d, 'L'); if (!l || l.length < 4) return null;
      a.p1 = [l[0], l[1]]; a.p2 = [l[2], l[3]]; a.width = bsWidth(d) ?? 1;
      const le = d.lookup(PDFName.of('LE'));
      if (le instanceof PDFArray) {
        const ends = le.asArray().map(x => x instanceof PDFName ? x.decodeText() : 'None');
        if (/Arrow/.test(ends[1] || '')) a.type = 'arrow';
        else if (/Arrow/.test(ends[0] || '')) { a.type = 'arrow'; [a.p1, a.p2] = [a.p2, a.p1]; }
      }
      break;
    }
    case 'freetext': {
      const da = parseDA(str(d, 'DA'));
      a.rect = rect; a.text = a.contents; a.contents = '';
      a.size = extra.size || da.size || 12; a.font = extra.font || 'Helvetica'; a.bold = !!extra.bold;
      a.color = extra.color || da.color || '#000000'; a.fill = extra.fill !== undefined ? extra.fill : rgb2hex(nums(d, 'IC'));
      a.bw = extra.bw ?? (bsWidth(d) || 0); a.bcolor = extra.bcolor || rgb2hex(nums(d, 'C')) || null; a.align = extra.align || (num(d, 'Q') === 1 ? 'center' : num(d, 'Q') === 2 ? 'right' : 'left');
      break;
    }
    case 'stamp':
      a.rect = rect;
      if (extra.image) { a.type = 'image'; a.dataUrl = extra.image; a.sig = !!extra.sig; }
      else { a.label = extra.label || nm(d, 'Name') || 'STAMP'; a.sub = extra.sub || ''; a.color = extra.color || a.color; }
      break;
    case 'redact': {
      const q = nums(d, 'QuadPoints');
      a.rects = q && q.length >= 8 ? chunk(q, 8).map(x => normRect([Math.min(x[0], x[4]), Math.min(x[1], x[5]), Math.max(x[2], x[6]), Math.max(x[3], x[7])])) : [rect];
      break;
    }
  }
  return a;
}

// Load a PDF, pull out the annotation types Lumen can edit (they become model objects and are
// re-written on save), and return the base bytes without them.
export async function importDocument(bytes, { keepBytes = false } = {}) {
  let pdf;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (e) { return { bytes, annots: [], props: {}, pageIds: null, readOnly: /encrypt/i.test(e.message) ? 'encrypted' : 'unparsable', error: e.message }; }
  const props = { title: pdf.getTitle() || '', author: pdf.getAuthor() || '', subject: pdf.getSubject() || '', keywords: pdf.getKeywords() || '' };
  const pages = pdf.getPages(); const pageIds = pages.map(() => uid());
  if (keepBytes) return { bytes, annots: [], props, pageIds, readOnly: false }; // signed files: keep every byte
  const annots = []; const usedIds = new Set(); let changed = false;
  const ctx = pdf.context;
  pages.forEach((page, pi) => {
    const arr = page.node.Annots(); if (!arr || !arr.size()) return;
    const entries = arr.asArray().map(ref => ({ ref, d: ref instanceof PDFRef ? ctx.lookup(ref) : ref })).filter(e => e.d instanceof PDFDict);
    const byTag = new Map(); const removed = new Set();
    for (const e of entries) {
      let a = null; try { a = convert(e.d, pageIds[pi], usedIds); } catch (err) { a = null; }
      if (a) { annots.push(a); removed.add(e); if (e.ref instanceof PDFRef) byTag.set(e.ref.tag, a); }
    }
    // replies
    for (const e of entries) {
      const irt = e.d.get(PDFName.of('IRT'));
      if (irt instanceof PDFRef && byTag.has(irt.tag) && nm(e.d, 'Subtype') === 'Text') {
        const parent = byTag.get(irt.tag);
        parent.replies.push({ id: str(e.d, 'NM') || uid(), author: str(e.d, 'T') || '', date: date(e.d, 'M') || date(e.d, 'CreationDate'), text: str(e.d, 'Contents') || '' });
        removed.add(e);
      }
    }
    // popups belonging to removed annotations
    const removedTags = new Set([...removed].filter(e => e.ref instanceof PDFRef).map(e => e.ref.tag));
    for (const e of entries) {
      if (nm(e.d, 'Subtype') !== 'Popup') continue;
      const par = e.d.get(PDFName.of('Parent'));
      if (par instanceof PDFRef && removedTags.has(par.tag)) removed.add(e);
    }
    if (removed.size) {
      changed = true;
      const keep = arr.asArray().filter(ref => ![...removed].some(e => e.ref === ref));
      page.node.set(PDFName.of('Annots'), ctx.obj(keep));
    }
  });
  annots.forEach(a => a.replies.sort((x, y) => String(x.date).localeCompare(String(y.date))));
  let out = bytes;
  if (changed) { out = await pdf.save({ useObjectStreams: true, updateFieldAppearances: false }); }
  return { bytes: out, annots, props, pageIds, readOnly: false };
}

// Pull every inheritable page attribute down onto the leaf so pages can be re-parented safely.
export function pushDownInherited(pdf) {
  const keys = ['Resources', 'MediaBox', 'CropBox', 'Rotate'].map(k => PDFName.of(k));
  for (const page of pdf.getPages()) {
    for (const k of keys) {
      if (page.node.get(k) !== undefined) continue;
      const v = page.node.getInheritableAttribute(k);
      if (v !== undefined) page.node.set(k, v);
    }
  }
}
// Replace the page tree with a flat one containing `refs` in order.
export function setPageOrder(pdf, refs) {
  const ctx = pdf.context;
  const root = L.PDFPageTree.withContext(ctx);
  root.set(PDFName.of('Kids'), ctx.obj(refs)); root.set(PDFName.of('Count'), PDFNumber.of(refs.length));
  const rootRef = ctx.register(root);
  for (const r of refs) ctx.lookup(r).set(PDFName.of('Parent'), rootRef);
  pdf.catalog.set(PDFName.of('Pages'), rootRef);
  if (pdf.pageCache) pdf.pageCache.invalidate();
  if (pdf.pageMap) pdf.pageMap = new Map();
}
