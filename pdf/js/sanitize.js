// Remove Hidden Information: finds and strips data that travels with a PDF but isn't visible on the page —
// metadata (document info, XMP, PieceInfo), JavaScript and automatic actions, attachments, comments, links,
// bookmarks and embedded page thumbnails. Unreferenced objects (old revisions, deleted content) are always dropped.
import { App } from './state.js';
import { pageOp } from './organize.js';
import { drawAllAnnots } from './viewer.js';
const L = window.PDFLib;
const { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFStream, PDFString, PDFHexString } = L;
const N = k => PDFName.of(k);
const deref = (ctx, o) => (o instanceof PDFRef ? ctx.lookup(o) : o);
const RISKY = new Set(['JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'ResetForm', 'Rendition', 'Movie', 'Sound', 'GoToR', 'GoToE', 'RichMediaExecute', 'Hide', 'SetOCGState', 'Trans', 'GoTo3DView']);

export const CATEGORIES = [
  ['metadata', 'Metadata (title, author, XMP, application data)', true],
  ['scripts', 'JavaScript and automatic actions', true],
  ['attachments', 'Attached files', true],
  ['thumbnails', 'Embedded page thumbnails', true],
  ['comments', 'Comments and markups', false],
  ['links', 'Links', false],
  ['bookmarks', 'Bookmarks', false]
];

function nameTreeCount(ctx, node, seen = new Set()) {
  node = deref(ctx, node); if (!(node instanceof PDFDict)) return 0;
  let n = 0; const names = deref(ctx, node.get(N('Names'))); if (names instanceof PDFArray) n += Math.floor(names.size() / 2);
  const kids = deref(ctx, node.get(N('Kids')));
  if (kids instanceof PDFArray) for (const k of kids.asArray()) { if (k instanceof PDFRef) { if (seen.has(k.tag)) continue; seen.add(k.tag); } n += nameTreeCount(ctx, k, seen); }
  return n;
}
const actionType = (ctx, a) => { a = deref(ctx, a); const s = a instanceof PDFDict ? a.lookup(N('S')) : null; return s instanceof PDFName ? s.decodeText() : null; };
function annotsOf(ctx, page) {
  const arr = page.node.Annots(); if (!arr) return [];
  return arr.asArray().map(ref => ({ ref, d: deref(ctx, ref) })).filter(e => e.d instanceof PDFDict).map(e => ({ ...e, sub: e.d.lookup(N('Subtype'))?.decodeText?.() || '' }));
}
function outlineCount(ctx, cat) {
  const root = deref(ctx, cat.get(N('Outlines'))); if (!(root instanceof PDFDict)) return 0;
  let n = 0; const seen = new Set();
  const walk = d => { let r = d.get(N('First')); while (r instanceof PDFRef && !seen.has(r.tag)) { seen.add(r.tag); const x = ctx.lookup(r); if (!(x instanceof PDFDict)) break; n++; walk(x); r = x.get(N('Next')); } };
  walk(root); return n;
}

// Scan a pdf-lib document (+ the editable annotations held in the app state) -> {key: {n, detail}}
export function scan(pdf, state) {
  const ctx = pdf.context, cat = pdf.catalog; const R = Object.fromEntries(CATEGORIES.map(([k]) => [k, { n: 0, detail: [] }]));
  // metadata
  const info = deref(ctx, ctx.trailerInfo.Info);
  if (info instanceof PDFDict) { const keys = info.keys().map(k => k.decodeText()).filter(k => k !== 'Producer' && k !== 'ModDate').filter(k => { const v = info.lookup(N(k)); return !((v instanceof PDFString || v instanceof PDFHexString) && !v.decodeText()); }); if (keys.length) { R.metadata.n += keys.length; R.metadata.detail.push(keys.join(', ')); } }
  const props = state?.props || {}; const pk = ['title', 'author', 'subject', 'keywords'].filter(k => props[k] && !(info instanceof PDFDict && info.get(N(k[0].toUpperCase() + k.slice(1)))));
  if (pk.length) { R.metadata.n += pk.length; }
  let xmp = 0, piece = 0;
  for (const [, obj] of ctx.enumerateIndirectObjects()) {
    const d = obj instanceof PDFStream ? obj.dict : obj; if (!(d instanceof PDFDict)) continue;
    if (d.get(N('Metadata'))) xmp++;
    if (d.get(N('PieceInfo'))) piece++;
    if (d.get(N('AA'))) { R.scripts.n++; }
    const a = d.get(N('A')); const t = a ? actionType(ctx, a) : null; if (t && RISKY.has(t)) { R.scripts.n++; R.scripts.detail.push(t); }
    if (d.get(N('Thumb'))) R.thumbnails.n++;
  }
  if (xmp) { R.metadata.n += xmp; R.metadata.detail.push(`${xmp} XMP packet${xmp > 1 ? 's' : ''}`); }
  if (piece) { R.metadata.n += piece; R.metadata.detail.push('application data (PieceInfo)'); }
  // scripts
  const names = deref(ctx, cat.get(N('Names')));
  if (names instanceof PDFDict) {
    const js = nameTreeCount(ctx, names.get(N('JavaScript'))); if (js) { R.scripts.n += js; R.scripts.detail.push(`${js} document script${js > 1 ? 's' : ''}`); }
    const ef = nameTreeCount(ctx, names.get(N('EmbeddedFiles'))); if (ef) { R.attachments.n += ef; }
  }
  const oa = cat.get(N('OpenAction')); const oat = oa ? actionType(ctx, oa) : null; if (oat && oat !== 'GoTo') { R.scripts.n++; R.scripts.detail.push('open action: ' + oat); }
  if (cat.get(N('AF')) && !R.attachments.n) R.attachments.n += Math.max(1, (deref(ctx, cat.get(N('AF'))) instanceof PDFArray ? deref(ctx, cat.get(N('AF'))).size() : 1));
  // per page
  for (const page of pdf.getPages()) {
    for (const a of annotsOf(ctx, page)) {
      if (a.sub === 'FileAttachment') R.attachments.n++;
      else if (a.sub === 'Link') R.links.n++;
      else if (a.sub !== 'Widget' && a.sub !== 'Popup') R.comments.n++;
    }
  }
  R.comments.n += (state?.annots || []).filter(a => !a.content && a.type !== 'redact').length;
  R.bookmarks.n = outlineCount(ctx, cat);
  return R;
}

export function strip(pdf, keys) {
  const ctx = pdf.context, cat = pdf.catalog; const want = new Set(keys);
  if (want.has('metadata')) {
    const ref = ctx.trailerInfo.Info; if (ref instanceof PDFRef) ctx.assign(ref, ctx.obj({})); else ctx.trailerInfo.Info = ctx.register(ctx.obj({}));
    for (const [, obj] of ctx.enumerateIndirectObjects()) { const d = obj instanceof PDFStream ? obj.dict : obj; if (d instanceof PDFDict) { d.delete(N('Metadata')); d.delete(N('PieceInfo')); d.delete(N('LastModified')); } }
    cat.delete(N('Metadata')); cat.delete(N('PieceInfo'));
  }
  if (want.has('scripts')) {
    const names = deref(ctx, cat.get(N('Names'))); if (names instanceof PDFDict) names.delete(N('JavaScript'));
    const oa = cat.get(N('OpenAction')); const t = oa ? actionType(ctx, oa) : null; if (t && t !== 'GoTo') cat.delete(N('OpenAction'));
    for (const [, obj] of ctx.enumerateIndirectObjects()) {
      const d = obj instanceof PDFStream ? obj.dict : obj; if (!(d instanceof PDFDict)) continue;
      d.delete(N('AA'));
      const a = d.get(N('A')); const at = a ? actionType(ctx, a) : null; if (at && RISKY.has(at)) d.delete(N('A'));
      const nx = d.get(N('Next')); if (d.lookup(N('S')) && nx) { /* action chains: drop risky followers */ const n = deref(ctx, nx); if (n instanceof PDFDict && RISKY.has(actionType(ctx, n))) d.delete(N('Next')); }
    }
    const acro = deref(ctx, cat.get(N('AcroForm'))); if (acro instanceof PDFDict) acro.delete(N('XFA'));
  }
  if (want.has('attachments')) {
    const names = deref(ctx, cat.get(N('Names'))); if (names instanceof PDFDict) names.delete(N('EmbeddedFiles'));
    cat.delete(N('AF')); cat.delete(N('Collection'));
    for (const page of pdf.getPages()) page.node.delete(N('AF'));
  }
  const dropSub = new Set();
  if (want.has('attachments')) dropSub.add('FileAttachment');
  if (want.has('links')) dropSub.add('Link');
  for (const page of pdf.getPages()) {
    if (want.has('thumbnails')) page.node.delete(N('Thumb'));
    const list = annotsOf(ctx, page); if (!list.length) continue;
    const keep = list.filter(a => !(dropSub.has(a.sub) || (want.has('comments') && a.sub !== 'Widget' && a.sub !== 'Link' && a.sub !== 'FileAttachment')));
    if (keep.length !== list.length) page.node.set(N('Annots'), ctx.obj(keep.map(a => a.ref)));
  }
  if (want.has('bookmarks')) { cat.delete(N('Outlines')); if (cat.lookup(N('PageMode'))?.toString() === '/UseOutlines') cat.delete(N('PageMode')); }
  const names = deref(ctx, cat.get(N('Names'))); if (names instanceof PDFDict && !names.keys().length) cat.delete(N('Names'));
}

export async function removeHidden(keys) {
  const d = App.doc; if (!d || d.readOnly) return false;
  const ok = await pageOp('Remove hidden information', async (pdf, refs, ids) => {
    strip(pdf, keys);
    const out = { ids };
    if (keys.includes('comments')) out.annots = d.state.annots.filter(a => a.content || a.type === 'redact');
    if (keys.includes('metadata')) d.state.props = {};
    return out;
  }, { toast: false });
  if (ok) drawAllAnnots();
  return ok;
}

export async function removeHiddenDialog() {
  const d = App.doc; if (!d) return;
  Aero.busy('Scanning document…');
  let R; try { R = scan(await PDFDocument.load(d.state.bytes, { updateMetadata: false }), d.state); } catch (e) { Aero.busy(); Aero.alert('Remove hidden information', e.message); return; } finally { Aero.busy(); }
  const html = `<div class="dnote">Lumen PDF looked for information that is stored in the file but not visible on the pages. Tick what to remove. Unreferenced data (old revisions, deleted pages and replaced content) is always removed. Remove the items before you share a redacted document.</div>`;
  Aero.dialog({
    title: 'Remove hidden information', width: 520, html,
    fields: CATEGORIES.map(([k, label, def]) => ({ key: k, label: `${label} — ${R[k].n ? R[k].n + ' found' : 'none found'}`, type: 'checkbox', value: def && R[k].n > 0 })),
    ok: 'Remove',
    onOK: async v => {
      const keys = CATEGORIES.map(c => c[0]).filter(k => v[k]);
      if (!keys.length) return;
      if (await removeHidden(keys)) Aero.toast('Removed: ' + keys.map(k => CATEGORIES.find(c => c[0] === k)[1].replace(/ \(.*\)$/, '').toLowerCase()).join(', '), 4500);
    }
  });
}
