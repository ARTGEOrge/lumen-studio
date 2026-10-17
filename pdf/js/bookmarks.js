// Bookmarks (document outline) editing: add, rename, delete, reorder (drag or buttons), nest, set destination,
// style (bold / italic / colour), and create bookmarks automatically from the document's headings.
// Bookmarks live in the PDF bytes (/Outlines), so every edit is a byte rewrite and is undoable.
import { App, emit } from './state.js';
import { pageOp } from './organize.js';
import { V, clientToPdf, effRot } from './viewer.js';
import { analyzePage } from './export.js';
import { clamp } from './util.js';
const L = window.PDFLib;
const { PDFName, PDFDict, PDFArray, PDFRef, PDFNumber, PDFHexString, PDFString } = L;
const N = k => PDFName.of(k);

export const B = { sel: null }; // selected bookmark path, e.g. [2, 0]
const samePath = (a, b) => !!a && !!b && a.length === b.length && a.every((v, k) => v === b[k]);

/* ---------- tree <-> PDF ---------- */
export function readTree(pdf) {
  const ctx = pdf.context; const root = pdf.catalog.lookup(N('Outlines'));
  const seen = new Set();
  const walk = parent => {
    const out = []; let r = parent.get(N('First'));
    while (r instanceof PDFRef && !seen.has(r.tag)) {
      seen.add(r.tag); const d = ctx.lookup(r); if (!(d instanceof PDFDict)) break;
      const t = d.lookup(N('Title'));
      const cnt = d.lookup(N('Count'));
      out.push({ ref: r, dict: d, title: (t instanceof PDFString || t instanceof PDFHexString) ? t.decodeText() : '', open: cnt instanceof PDFNumber ? cnt.asNumber() > 0 : false, kids: walk(d) });
      r = d.get(N('Next'));
    }
    return out;
  };
  return root instanceof PDFDict ? walk(root) : [];
}
export function writeTree(pdf, nodes) {
  const ctx = pdf.context;
  if (!nodes.length) { pdf.catalog.delete(N('Outlines')); if (pdf.catalog.lookup(N('PageMode'))?.toString() === '/UseOutlines') pdf.catalog.delete(N('PageMode')); return; }
  const assign = list => list.forEach(n => { if (!n.dict) n.dict = ctx.obj({}); if (!n.ref) n.ref = ctx.register(n.dict); assign(n.kids); });
  assign(nodes);
  const link = (list, parentRef) => {
    let visible = 0;
    list.forEach((n, k) => {
      const d = n.dict;
      d.set(N('Title'), PDFHexString.fromText(n.title || 'Untitled'));
      d.set(N('Parent'), parentRef);
      if (k > 0) d.set(N('Prev'), list[k - 1].ref); else d.delete(N('Prev'));
      if (k < list.length - 1) d.set(N('Next'), list[k + 1].ref); else d.delete(N('Next'));
      if (n.kids.length) {
        const c = link(n.kids, n.ref);
        d.set(N('First'), n.kids[0].ref); d.set(N('Last'), n.kids[n.kids.length - 1].ref); d.set(N('Count'), PDFNumber.of(n.open ? c : -c));
        visible += 1 + (n.open ? c : 0);
      } else { d.delete(N('First')); d.delete(N('Last')); d.delete(N('Count')); visible += 1; }
    });
    return visible;
  };
  const old = pdf.catalog.get(N('Outlines'));
  const rootRef = old instanceof PDFRef ? old : ctx.register(ctx.obj({}));
  const root = ctx.obj({ Type: 'Outlines' }); ctx.assign(rootRef, root);
  const total = link(nodes, rootRef);
  root.set(N('First'), nodes[0].ref); root.set(N('Last'), nodes[nodes.length - 1].ref); root.set(N('Count'), PDFNumber.of(total));
  pdf.catalog.set(N('Outlines'), rootRef);
}
function destFor(pdf, page, top) {
  const ref = pdf.getPages()[page]?.ref; if (!ref) return null;
  return pdf.context.obj([ref, 'XYZ', null, top == null ? null : Math.round(top * 100) / 100, null]);
}
const at = (nodes, path) => { let list = nodes, n = null; for (const k of path) { n = list[k]; if (!n) return null; list = n.kids; } return n; };
const parentList = (nodes, path) => { let list = nodes; for (const k of path.slice(0, -1)) { const n = list[k]; if (!n) return null; list = n.kids; } return list; };

// Run a mutation on the outline tree as one undoable step. fn(tree, pdf) returns the new selection path or false.
async function mutate(label, fn) {
  const d = App.doc; if (!d || d.readOnly) return false;
  let sel = null;
  const ok = await pageOp(label, async (pdf, refs, ids) => {
    const tree = readTree(pdf);
    sel = fn(tree, pdf);
    if (sel === false) return false;
    writeTree(pdf, tree);
    return { ids };
  }, { toast: false });
  if (ok) { B.sel = sel || null; emit('outlineChanged'); }
  return !!ok;
}

/* ---------- the current view as a destination ---------- */
export function currentView() {
  const d = App.doc; const page = V.cur; let top = null;
  if (d && V.views[page] && effRot(page) === 0) {
    const sc = document.getElementById('scroller').getBoundingClientRect(); const el = V.views[page].el.getBoundingClientRect();
    const y = Math.max(sc.top + 4, el.top);
    const p = clientToPdf(page, el.left + 2, y);
    const v = d.info[page].view; top = clamp(p[1], v[1], v[3]);
    if (y === el.top) top = v[3];
  }
  return { page, top };
}

/* ---------- operations (paths index the tree as shown in the panel) ---------- */
export function addBookmark({ title, page, top, after = B.sel, child = false } = {}) {
  const v = currentView(); page = page ?? v.page; top = top === undefined ? v.top : top;
  return mutate('Add bookmark', (tree, pdf) => {
    const n = { title: title || `Page ${page + 1}`, kids: [], open: true };
    n.dict = pdf.context.obj({}); n.dict.set(N('Dest'), destFor(pdf, page, top));
    if (after && at(tree, after)) {
      if (child) { const p = at(tree, after); p.kids.push(n); p.open = true; return [...after, p.kids.length - 1]; }
      const list = parentList(tree, after); const k = after[after.length - 1] + 1; list.splice(k, 0, n); return [...after.slice(0, -1), k];
    }
    tree.push(n); return [tree.length - 1];
  });
}
export function renameBookmark(path, title) {
  return mutate('Rename bookmark', tree => { const n = at(tree, path); if (!n || !title) return false; n.title = title; return path; });
}
export function deleteBookmark(path) {
  return mutate('Delete bookmark', tree => {
    const list = parentList(tree, path); const k = path[path.length - 1]; if (!list?.[k]) return false;
    list.splice(k, 1);
    if (list.length) return [...path.slice(0, -1), Math.min(k, list.length - 1)];
    return path.length > 1 ? path.slice(0, -1) : null;
  });
}
export function moveBookmark(path, dir) {
  return mutate(dir < 0 ? 'Move bookmark up' : 'Move bookmark down', tree => {
    const list = parentList(tree, path); const k = path[path.length - 1], j = k + dir;
    if (!list || j < 0 || j >= list.length) return false;
    [list[k], list[j]] = [list[j], list[k]]; return [...path.slice(0, -1), j];
  });
}
export function indentBookmark(path) {
  return mutate('Indent bookmark', tree => {
    const list = parentList(tree, path); const k = path[path.length - 1]; if (!list || k === 0) return false;
    const [n] = list.splice(k, 1); const prev = list[k - 1]; prev.kids.push(n); prev.open = true; return [...path.slice(0, -1), k - 1, prev.kids.length - 1];
  });
}
export function outdentBookmark(path) {
  return mutate('Outdent bookmark', tree => {
    if (path.length < 2) return false;
    const list = parentList(tree, path); const k = path[path.length - 1];
    const ppath = path.slice(0, -1); const plist = parentList(tree, ppath); const pk = ppath[ppath.length - 1];
    const [n] = list.splice(k, 1);
    plist.splice(pk + 1, 0, n); return [...ppath.slice(0, -1), pk + 1];
  });
}
// drag & drop: where = 'before' | 'after' | 'inside'
export function dropBookmark(from, to, where) {
  if (samePath(from, to) || (to.length > from.length && samePath(from, to.slice(0, from.length)))) return Promise.resolve(false);
  return mutate('Move bookmark', tree => {
    const target = at(tree, to); const src = at(tree, from); if (!target || !src) return false;
    const fl = parentList(tree, from); fl.splice(from[from.length - 1], 1);
    // locate the target again (indices may have shifted)
    const find = (list, p) => { for (let k = 0; k < list.length; k++) { if (list[k] === target) return [...p, k]; const r = find(list[k].kids, [...p, k]); if (r) return r; } return null; };
    const tp = find(tree, []);
    if (where === 'inside') { target.kids.push(src); target.open = true; return [...tp, target.kids.length - 1]; }
    const tl = parentList(tree, tp); const k = tp[tp.length - 1] + (where === 'after' ? 1 : 0); tl.splice(k, 0, src); return [...tp.slice(0, -1), k];
  });
}
export function setBookmarkDest(path, page, top) {
  const v = currentView(); page = page ?? v.page; top = top === undefined ? v.top : top;
  return mutate('Set bookmark destination', (tree, pdf) => {
    const n = at(tree, path); if (!n) return false;
    n.dict.delete(N('A')); n.dict.delete(N('SE')); n.dict.set(N('Dest'), destFor(pdf, page, top)); return path;
  });
}
export function styleBookmark(path, { title, bold, italic, color }) {
  return mutate('Bookmark properties', (tree, pdf) => {
    const n = at(tree, path); if (!n) return false;
    if (title) n.title = title;
    const f = (italic ? 1 : 0) | (bold ? 2 : 0); if (f) n.dict.set(N('F'), PDFNumber.of(f)); else n.dict.delete(N('F'));
    if (color && color.toLowerCase() !== '#000000') { const c = parseInt(color.slice(1), 16); n.dict.set(N('C'), pdf.context.obj([((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255].map(x => Math.round(x * 1000) / 1000))); }
    else n.dict.delete(N('C'));
    return path;
  });
}

/* ---------- bookmarks from headings ---------- */
export async function headingsOutline(d, { maxLevel = 2, pages = null } = {}) {
  const idx = pages || [...Array(d.numPages).keys()];
  const cand = []; const bodies = new Map();
  for (const i of idx) {
    const page = await d.getPage(i);
    let l; try { l = await analyzePage(page, { images: false }); } catch (e) { continue; }
    const chars = l.blocks.reduce((n, b) => n + (b.kind === 'p' ? b.text.length : 0), 0); bodies.set(l.body, (bodies.get(l.body) || 0) + chars);
    const vp = page.getViewport({ scale: 1 });
    for (const b of l.blocks) {
      if (b.kind !== 'p' || !b.level) continue;
      const text = b.text.replace(/\s+/g, ' ').trim(); if (!text || text.length > 120) continue;
      const top = d.info[i].rotate === 0 ? vp.convertToPdfPoint(b.x0, Math.max(0, b.y - 2))[1] : null;
      cand.push({ page: i, top, size: b.size, bold: !!b.bold, title: text });
    }
  }
  // heading tiers relative to the document's body text size: much larger = 1, larger = 2, bold body-size = 3
  const body = [...bodies.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 11;
  const found = [];
  for (const c of cand) {
    const r = c.size / body;
    if (r < 0.97 || (!c.bold && r < 1.12)) continue;
    c.level = r >= 1.45 ? 1 : r >= 1.12 ? 2 : 3;
    found.push(c);
  }
  // running headers / footers repeat on several pages (same text, or same opening words at the same height): drop them
  const norm = t => t.toLowerCase().replace(/\d+/g, '#');
  const pagesBy = (keyFn) => { const m = new Map(); for (const f of found) { const k = keyFn(f); if (!m.has(k)) m.set(k, new Set()); m.get(k).add(f.page); } return m; };
  const byText = pagesBy(f => norm(f.title));
  const byHead = pagesBy(f => norm(f.title).split(' ').slice(0, 2).join(' ') + '@' + (f.top == null ? '?' : Math.round(f.top / 8)));
  const many = set => set.size >= 2 && set.size >= Math.min(3, idx.length);
  return found.filter(f => f.level <= maxLevel && !many(byText.get(norm(f.title))) && !(f.top != null && many(byHead.get(norm(f.title).split(' ').slice(0, 2).join(' ') + '@' + Math.round(f.top / 8)))) && !/[.,;:]$/.test(f.title));
}
export async function bookmarksFromHeadings({ maxLevel = 2, replace = true } = {}) {
  const d = App.doc; if (!d) return 0;
  Aero.busy('Finding headings…');
  let heads; try { heads = await headingsOutline(d, { maxLevel }); } finally { Aero.busy(); }
  if (!heads.length) { Aero.alert('Bookmarks from headings', 'No headings were found. Headings are detected from larger or bold text; scanned pages need OCR first.'); return 0; }
  const levels = [...new Set(heads.map(h => h.level))].sort((a, b) => a - b); // compress used levels to 1..n
  await mutate('Create bookmarks from headings', (tree, pdf) => {
    if (replace) tree.length = 0;
    const stack = [{ depth: 0, kids: tree }];
    for (const h of heads) {
      const depth = levels.indexOf(h.level) + 1;
      while (stack.length > 1 && stack[stack.length - 1].depth >= depth) stack.pop();
      const n = { title: h.title, kids: [], open: true, dict: pdf.context.obj({}) }; n.dict.set(N('Dest'), destFor(pdf, h.page, h.top));
      stack[stack.length - 1].kids.push(n); stack.push({ depth, kids: n.kids });
    }
    pdf.catalog.set(N('PageMode'), N('UseOutlines'));
    return [0];
  });
  Aero.toast(`${heads.length} bookmark${heads.length > 1 ? 's' : ''} created from headings`);
  return heads.length;
}
export function headingsDialog() {
  const d = App.doc; if (!d) return;
  Aero.dialog({
    title: 'Create bookmarks from headings', width: 460,
    instruction: 'Detect headings from the size and weight of the text and turn them into nested bookmarks',
    fields: [
      { key: 'lvl', label: 'Heading levels', type: 'select', value: '2', options: [['1', 'Level 1 only (largest)'], ['2', 'Levels 1–2'], ['3', 'Levels 1–3 (incl. bold lines)']] },
      { key: 'mode', label: 'Existing bookmarks', type: 'select', value: 'replace', options: [['replace', 'Replace them'], ['append', 'Keep them and add after']] }
    ],
    ok: 'Create', onOK: v => bookmarksFromHeadings({ maxLevel: +v.lvl, replace: v.mode === 'replace' })
  });
}

/* ---------- dialogs used by the panel / menus ---------- */
export async function renameDialog(path = B.sel) {
  const d = App.doc; if (!d || !path) return;
  const el = document.querySelector(`#outline .aero-item[data-path="${path.join('.')}"] .grow`);
  const t = await Aero.prompt('Rename bookmark', 'Title', el ? el.textContent : '');
  if (t && t.trim()) await renameBookmark(path, t.trim());
}
export async function propertiesDialog(path = B.sel) {
  const d = App.doc; if (!d || !path) return;
  const item = await itemAt(d, path); if (!item) return;
  const hex = item.color ? '#' + [...item.color].map(v => Math.round(v).toString(16).padStart(2, '0')).join('') : '#000000';
  const r = item.dest ? await d.resolveDest(item.dest) : null;
  Aero.dialog({
    title: 'Bookmark properties', width: 440,
    instruction: r ? `Goes to page ${r.page + 1}` : (item.url ? `Opens ${item.url}` : 'This bookmark runs an action that Lumen PDF keeps unchanged'),
    fields: [
      { key: 'title', label: 'Title', type: 'text', value: item.title },
      { key: 'bold', label: 'Bold', type: 'checkbox', value: !!item.bold }, { key: 'italic', label: 'Italic', type: 'checkbox', value: !!item.italic },
      { key: 'color', label: 'Colour', type: 'color', value: hex }
    ],
    ok: 'Apply', onOK: v => styleBookmark(path, { title: v.title.trim(), bold: v.bold, italic: v.italic, color: v.color })
  });
}
export async function itemAt(d, path) { let list = await d.getOutline(); let it = null; for (const k of path) { it = list?.[k]; if (!it) return null; list = it.items; } return it; }
export { samePath };
