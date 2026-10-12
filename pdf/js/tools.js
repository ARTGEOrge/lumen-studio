// Tools and pointer interaction: create / select / move / resize / delete annotations, text markup from selection.
import { App, emit } from './state.js';
import { V, clientToPdf, pdfToClient, pageAt, drawAnnots, drawHandles, vp, effRot, rectPct } from './viewer.js';
import { annotRect, translateAnnot, resizeAnnot, isResizable, freetextLayout, measureCss, MARKUP, LEADING, ASCENT, svgFor, stampLayout, TYPE_LABEL } from './annots.js';
import { uid, normRect, clamp, localFrame, f2, fmtDate } from './util.js';

const $ = id => document.getElementById(id);
const pagesEl = $('pages'), scroller = $('scroller');

export const TOOLS = [
  { id: 'select', title: 'Select / edit', key: 'V', icon: '<path d="M6 3l12 8.5-5.6 1.1 3.2 6.2-2.4 1.2-3.2-6.3L6 17.5z"/>' },
  { id: 'hand', title: 'Hand (pan)', key: 'H', icon: '<path d="M8 13V6a1.5 1.5 0 0 1 3 0v5m0-6.5V4a1.5 1.5 0 0 1 3 0v7m0-5a1.5 1.5 0 0 1 3 0v6m0-3.5a1.5 1.5 0 0 1 3 0V15c0 3.6-2.6 6.5-6.5 6.5-2.6 0-4.3-1.2-5.6-3.4L5 14.6a1.5 1.5 0 0 1 2.6-1.5L8 13.7"/>' },
  null,
  { id: 'highlight', title: 'Highlight text', key: 'U', icon: '<path d="M4 20.5h7"/><path d="M14.5 3.5l6 6-8.5 8.5H7.5v-4.5z"/><path d="M11.5 6.5l6 6"/>' },
  { id: 'underline', title: 'Underline text', key: 'I', icon: '<path d="M7 4v7a5 5 0 0 0 10 0V4"/><path d="M5 20h14"/>' },
  { id: 'strike', title: 'Strikethrough text', key: 'K', icon: '<path d="M16.8 6.5C15.9 5 14.2 4 12 4 9 4 7.3 5.6 7.3 7.6c0 4.4 9.6 3 9.6 8.2 0 2.3-2.2 4.2-5.1 4.2-2.5 0-4.4-1.1-5.3-2.8"/><path d="M4 12h16"/>' },
  null,
  { id: 'note', title: 'Sticky note', key: 'N', icon: '<path d="M4 4h16v12H10l-4 4v-4H4z"/><path d="M8 8h8M8 11.5h5"/>' },
  { id: 'freetext', title: 'Text box', key: 'T', icon: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M8 8.5h8M12 8.5V17"/>' },
  { id: 'ink', title: 'Freehand pen (pressure)', key: 'P', icon: '<path d="M3 17c2-5 4-8.5 6-8.5s.8 7 3.8 7S16 6.5 18 6.5s2 3 3 4"/>' },
  { id: 'rect', title: 'Rectangle', key: 'R', icon: '<rect x="4" y="6" width="16" height="12" rx="1"/>' },
  { id: 'ellipse', title: 'Ellipse', key: 'E', icon: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>' },
  { id: 'line', title: 'Line', key: 'L', icon: '<path d="M5 19 19 5"/>' },
  { id: 'arrow', title: 'Arrow', key: 'A', icon: '<path d="M5 19 19 5M10 5h9v9"/>' },
  { id: 'stamp', title: 'Stamp', key: 'S', icon: '<path d="M9 12.5V9.5a3 3 0 1 1 6 0v3"/><path d="M4 12.5h16v4H4zM6 20h12"/>' },
  null,
  { id: 'filltext', title: 'Fill & Sign: add text', key: 'X', icon: '<rect x="2.5" y="7" width="19" height="10" rx="1.5"/><path d="M8 9.3v5.4M6.6 9.3h2.8M6.6 14.7h2.8"/>' },
  { id: 'sign', title: 'Fill & Sign: signature', key: 'G', icon: '<path d="M3 16.5c3 0 4-9 6.5-9S9.5 17.5 12 17.5s2-5.5 4-5.5 1 4 2.5 4H21"/><path d="M3 21h18"/>' },
  { id: 'date', title: 'Fill & Sign: date', key: 'Y', icon: '<rect x="3.5" y="5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4M7.5 14h3"/>' },
  { id: 'check', title: 'Fill & Sign: check mark', key: 'C', icon: '<path d="M4 12.5l5 5L20 6.5"/>' },
  null,
  { id: 'edittext', title: 'Edit: add text to page', key: '', icon: '<path d="M5 7.5V5h14v2.5M12 5v14M9 19h6"/>' },
  { id: 'image', title: 'Edit: add image', key: '', icon: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><circle cx="8.5" cy="10" r="1.7"/><path d="M21 16l-5-5-8 8"/>' },
  { id: 'redact', title: 'Redact: mark area', key: 'D', icon: '<rect x="3" y="6.5" width="18" height="11" rx="1"/><path d="M6.5 12h11" stroke-width="4"/>' },
  { id: 'crop', title: 'Crop pages', key: 'O', icon: '<path d="M6 2v16h16M2 6h16v16"/>' },
];
// Tools contributed by other modules (edit text, form fields…): {id, title, key, icon, hint, controls(), down(e, i, pvEl, p0)}
export const EXT_TOOLS = {};
export function registerTool(id, def, before = 'redact') {
  EXT_TOOLS[id] = def; DRAW_TOOLS.add(id);
  const k = TOOLS.findIndex(t => t && t.id === before);
  TOOLS.splice(k < 0 ? TOOLS.length : k, 0, { id, title: def.title, key: def.key || '', icon: def.icon });
}
const DRAW_TOOLS = new Set(['note', 'freetext', 'ink', 'rect', 'ellipse', 'line', 'arrow', 'stamp', 'filltext', 'sign', 'date', 'check', 'edittext', 'image', 'redact', 'crop']);
export const isMarkupTool = t => MARKUP.has(t);

let toolbox;
export function initTools(container) {
  toolbox = Aero.toolbox(container, TOOLS, id => setTool(id, true));
  toolbox.set('select');
}
export function setTool(id, fromBox) {
  if (!fromBox) { toolbox.set(id); return; }
  App.tool = id;
  document.body.className = document.body.className.replace(/\btool-\S+/g, '').trim() + ' tool-' + id;
  document.body.classList.toggle('drawing', DRAW_TOOLS.has(id));
  if (id !== 'select' && id !== 'hand' && !isMarkupTool(id)) select(null);
  hideSelPill();
  if (id === 'sign' && !App.signature) emit('needSignature');
  if (id === 'image' && !App.pendingImage) emit('needImage');
  emit('tool', id);
}

/* ---------- model mutations ---------- */
function pageIndexOf(a) { return App.doc.pageOf(a); }
export function addAnnot(a, label, { selectIt = true } = {}) {
  const d = App.doc; if (!d || d.readOnly) { Aero.toast('This document is read-only'); return null; }
  a.id = a.id || uid(); a.author = a.author ?? App.author; a.date = a.date || new Date().toISOString(); a.replies = a.replies || []; a.contents = a.contents || '';
  d.state.annots.push(a); d.commit(label || ('Add ' + (TYPE_LABEL[a.type] || a.type).toLowerCase()));
  if (selectIt) App.sel = a.id;
  drawAnnots(pageIndexOf(a)); emit('annots'); emit('sel');
  return a;
}
export function replaceAnnot(nu, label, commit = true, keepDate = false) {
  const d = App.doc; const k = d.state.annots.findIndex(x => x.id === nu.id); if (k < 0) return;
  const oldPage = d.pageOf(d.state.annots[k]);
  if (commit && !keepDate) nu.date = new Date().toISOString();
  d.state.annots[k] = nu;
  if (commit) d.commit(label || 'Edit annotation');
  drawAnnots(d.pageOf(nu)); if (oldPage !== d.pageOf(nu)) drawAnnots(oldPage);
  if (commit) emit('annots');
}
export function patchAnnot(id, patch, label, commit = true) {
  const a = App.doc.annot(id); if (!a) return;
  replaceAnnot({ ...structuredClone(a), ...patch }, label, commit);
}
export function deleteAnnot(id = App.sel) {
  const d = App.doc; if (!d || !id) return;
  const a = d.annot(id); if (!a) return;
  const i = d.pageOf(a);
  d.state.annots = d.state.annots.filter(x => x.id !== id);
  if (App.sel === id) App.sel = null;
  d.commit('Delete ' + (TYPE_LABEL[a.type] || 'annotation').toLowerCase());
  drawAnnots(i); emit('annots'); emit('sel');
}
export function select(id, scrollTo = false) {
  const prev = App.sel; App.sel = id || null;
  const d = App.doc; if (!d) return;
  if (prev) { const a = d.annot(prev); if (a) drawHandles(d.pageOf(a)); }
  if (id) { const a = d.annot(id); if (a) { drawHandles(d.pageOf(a)); if (scrollTo) scrollToAnnot(a); } }
  emit('sel');
}
export function scrollToAnnot(a) {
  const i = App.doc.pageOf(a); if (i < 0) return;
  const r = annotRect(a); const pv = V.views[i]; if (!pv) return;
  if (App.doc.view.mode === 'single') { emit('goto', i); }
  const p = rectPct(i, r);
  const el = pv.el; const y = el.offsetTop + p.top / 100 * el.offsetHeight - scroller.clientHeight * 0.3;
  if (App.doc.view.mode !== 'single') scroller.scrollTop = y; else scroller.scrollTop = Math.max(0, p.top / 100 * el.offsetHeight - scroller.clientHeight * 0.3);
}

/* ---------- pointer interaction ---------- */
let drag = null;
const pressureOf = e => e.pointerType === 'pen' ? (e.pressure || 0.5) : e.pointerType === 'touch' ? 0.5 : 0.5;
const ptOf = (i, e) => clientToPdf(i, e.clientX, e.clientY);

pagesEl.addEventListener('pointerdown', e => {
  const d = App.doc; if (!d || e.button > 0 && e.pointerType === 'mouse') return;
  if (editing && e.target !== editing.ta) finishEdit();
  const pvEl = e.target.closest('.pv'); if (!pvEl) return;
  const i = +pvEl.dataset.i;
  // selection handles
  const h = e.target.closest('.selbox [data-h]');
  if (h && App.sel) { e.preventDefault(); startEdit(e, i, h.dataset.h); return; }
  // click on an annotation
  const hit = e.target.closest('.hit');
  if (hit && (App.tool === 'select' || App.tool === 'hand' || isMarkupTool(App.tool))) {
    e.preventDefault(); select(hit.dataset.id); startEdit(e, i, 'mv'); return;
  }
  if (e.target.classList.contains('inter')) { e.preventDefault(); startDraw(e, i, pvEl); return; }
  if (App.tool === 'hand' && !e.target.closest('.forms,.links')) { startPan(e); return; }
  if (App.tool === 'select' && App.sel && !e.target.closest('.forms')) select(null);
});
pagesEl.addEventListener('dblclick', e => {
  const hit = e.target.closest('.hit, .selbox'); if (!hit || !App.sel) return;
  const a = App.doc.annot(App.sel); if (!a) return;
  if (a.type === 'freetext') editFreetext(a);
  else if (a.type === 'stamp') Aero.prompt('Stamp text', 'Label', a.label).then(v => { if (v) patchAnnot(a.id, { label: v.toUpperCase() }, 'Edit stamp'); });
  else emit('editComment', a.id);
});

function startPan(e) {
  const sx = e.clientX, sy = e.clientY, l = scroller.scrollLeft, t = scroller.scrollTop;
  scroller.classList.add('panning');
  const mv = ev => { scroller.scrollLeft = l - (ev.clientX - sx); scroller.scrollTop = t - (ev.clientY - sy); };
  const up = () => { scroller.classList.remove('panning'); removeEventListener('pointermove', mv); removeEventListener('pointerup', up); };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
  e.preventDefault();
}

// move / resize selected annotation
function startEdit(e, i, mode) {
  const d = App.doc; const orig = d.annot(App.sel); if (!orig || d.readOnly) return;
  const box = annotRect(orig); const p0 = ptOf(i, e); let moved = false, cur = orig;
  const sp = [e.clientX, e.clientY];
  const mv = ev => {
    if (!moved && Math.hypot(ev.clientX - sp[0], ev.clientY - sp[1]) < 3) return;
    moved = true;
    const p = ptOf(i, ev);
    if (mode === 'mv') {
      // allow dropping onto another page
      const j = pageAt(ev.clientX, ev.clientY);
      if (j >= 0 && j !== i && !MARKUP.has(orig.type)) {
        const pj = clientToPdf(j, ev.clientX, ev.clientY); const c0 = ptOf(i, { clientX: sp[0], clientY: sp[1] });
        cur = translateAnnot({ ...orig, page: d.state.pageIds[j] }, pj[0] - c0[0], pj[1] - c0[1]);
      } else cur = translateAnnot(orig, p[0] - p0[0], p[1] - p0[1]);
    } else {
      // resize in screen space so handle directions match the displayed page
      const c1 = pdfToClient(i, box[0], box[1]), c2 = pdfToClient(i, box[2], box[3]);
      let L = Math.min(c1[0], c2[0]), R = Math.max(c1[0], c2[0]), T = Math.min(c1[1], c2[1]), B = Math.max(c1[1], c2[1]);
      if (mode.includes('w')) L = Math.min(ev.clientX, R - 4); if (mode.includes('e')) R = Math.max(ev.clientX, L + 4);
      if (mode.includes('n')) T = Math.min(ev.clientY, B - 4); if (mode.includes('s')) B = Math.max(ev.clientY, T + 4);
      if (ev.shiftKey || orig.type === 'image' || orig.type === 'stamp') {
        // keep aspect ratio
        const ar = (Math.max(c1[0], c2[0]) - Math.min(c1[0], c2[0])) / Math.max(1, Math.max(c1[1], c2[1]) - Math.min(c1[1], c2[1]));
        if (mode === 'n' || mode === 's') { const w = (B - T) * ar, cx = (L + R) / 2; L = cx - w / 2; R = cx + w / 2; }
        else { const hh = (R - L) / ar; if (mode.includes('n')) T = B - hh; else B = T + hh; }
      }
      const q1 = clientToPdf(i, L, T), q2 = clientToPdf(i, R, B);
      cur = resizeAnnot(orig, box, normRect([q1[0], q1[1], q2[0], q2[1]]));
    }
    const prevPage = d.pageOf(d.annot(orig.id));
    replaceAnnot(structuredClone(cur), null, false);
    if (prevPage !== d.pageOf(cur)) { drawAnnots(prevPage); App.sel = cur.id; }
    drawHandles(d.pageOf(cur));
  };
  const up = () => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
    if (moved) { d.commit(mode === 'mv' ? 'Move annotation' : 'Resize annotation'); emit('annots'); emit('sel'); }
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}

let lastInk = null;
function startDraw(e, i, pvEl) {
  const d = App.doc; if (d.readOnly) { Aero.toast('This document is read-only'); return; }
  const t = App.tool, o = App.opts[t] || {};
  const p0 = ptOf(i, e); const sp = [e.clientX, e.clientY];
  if (EXT_TOOLS[t]) { try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ } EXT_TOOLS[t].down(e, i, pvEl, p0); return; }
  const inter = e.target; try { inter.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
  const rot = d.info[i].rotate;
  if (t === 'ink') {
    const pts = [[p0[0], p0[1], pressureOf(e)]];
    const ghost = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    ghost.setAttribute('fill', 'none'); ghost.setAttribute('stroke', o.color); ghost.setAttribute('stroke-width', o.width); ghost.setAttribute('stroke-linecap', 'round'); ghost.setAttribute('stroke-linejoin', 'round'); ghost.setAttribute('opacity', o.opacity);
    V.views[i].g.appendChild(ghost);
    const mv = ev => {
      const evs = ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
      for (const ce of (evs.length ? evs : [ev])) { const p = ptOf(i, ce); const last = pts[pts.length - 1]; if (Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.35) pts.push([p[0], p[1], pressureOf(ce)]); }
      ghost.setAttribute('d', pts.map((p, k) => (k ? 'L' : 'M') + f2(p[0]) + ' ' + f2(p[1])).join(''));
    };
    const up = () => {
      inter.removeEventListener('pointermove', mv); inter.removeEventListener('pointerup', up); ghost.remove();
      const stroke = smooth(pts);
      const prev = lastInk && Date.now() - lastInk.t < 1500 && d.annot(lastInk.id);
      if (prev && d.pageOf(prev) === i && App.sel === prev.id) {
        const nu = structuredClone(prev); nu.strokes.push(stroke); replaceAnnot(nu, 'Freehand stroke'); lastInk = { id: nu.id, t: Date.now() };
      } else {
        const a = addAnnot({ type: 'ink', page: d.state.pageIds[i], strokes: [stroke], color: o.color, width: o.width, opacity: o.opacity, content: App.contentMode }, 'Freehand');
        if (a) lastInk = { id: a.id, t: Date.now() };
      }
      drawHandles(i);
    };
    inter.addEventListener('pointermove', mv); inter.addEventListener('pointerup', up);
    return;
  }
  // click-to-place tools
  const placeAt = () => {
    const pid = d.state.pageIds[i];
    if (t === 'note') { const a = addAnnot({ type: 'note', page: pid, x: p0[0] - 10, y: p0[1] + 10, color: o.color, opacity: o.opacity }, 'Add sticky note'); if (a) setTimeout(() => emit('editComment', a.id), 30); }
    else if (t === 'stamp') {
      const w = o.label.length > 9 ? 190 : 150, h = 46;
      const a = { type: 'stamp', page: pid, rect: centerRect(p0, w, h, rot), rot, label: o.label, color: o.color, opacity: o.opacity, sub: o.withSub ? `${App.author} · ${new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : '' };
      addAnnot(a, 'Add stamp');
    }
    else if (t === 'sign' || t === 'image') {
      const src = t === 'sign' ? App.signature : App.pendingImage;
      if (!src) { emit(t === 'sign' ? 'needSignature' : 'needImage'); return; }
      const maxW = t === 'sign' ? 170 : Math.min(260, d.info[i].w * 0.6), ar = src.w / Math.max(1, src.h);
      let w = maxW, h = w / ar; if (t === 'image' && h > d.info[i].h * 0.6) { h = d.info[i].h * 0.6; w = h * ar; }
      if (t === 'sign') { h = Math.min(h, 60); w = h * ar; }
      addAnnot({ type: 'image', page: pid, rect: centerRect(p0, w, h, rot), rot, dataUrl: src.dataUrl, sig: t === 'sign', opacity: 1, content: t === 'image' }, t === 'sign' ? 'Place signature' : 'Add image');
      if (t === 'image') { App.pendingImage = null; setTool('select'); }
    }
    else if (t === 'date') {
      const txt = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
      const fo = App.opts.filltext; const a = makeText(i, p0, txt, { ...fo, plain: true });
      addAnnot(a, 'Add date');
    }
    else if (t === 'check') {
      const s = 7; const [x, y] = p0;
      const local = [[-1, 0.1], [-0.3, -0.75], [1.1, 1]];
      const strokes = [local.map(([u, v]) => [x + u * s, y + v * s, 0.5])];
      addAnnot({ type: 'ink', page: pid, strokes, color: o.color, width: o.width, opacity: 1 }, 'Add check mark');
    }
    else if (t === 'filltext' || t === 'edittext' || t === 'freetext') {
      const fo = App.opts[t];
      const a = makeText(i, p0, '', { ...fo, plain: t !== 'freetext', box: t === 'freetext' });
      if (t === 'edittext') a.content = true;
      const added = addAnnot(a, t === 'edittext' ? 'Add page text' : 'Add text');
      if (added) setTimeout(() => editFreetext(added, true), 20);
    }
  };
  if (['note', 'stamp', 'sign', 'image', 'date', 'check', 'filltext', 'edittext'].includes(t)) {
    const up = ev => { inter.removeEventListener('pointerup', up); if (Math.hypot(ev.clientX - sp[0], ev.clientY - sp[1]) < 6) placeAt(); };
    inter.addEventListener('pointerup', up); return;
  }
  // rubber band tools: rect, ellipse, line, arrow, freetext, redact, crop
  const ghost = document.createElement('div'); ghost.className = 'ghost' + (t === 'crop' ? ' crop' : '');
  let line = null;
  if (t === 'line' || t === 'arrow') { line = document.createElementNS('http://www.w3.org/2000/svg', 'path'); line.setAttribute('stroke', o.color); line.setAttribute('stroke-width', o.width); V.views[i].g.appendChild(line); }
  else pvEl.appendChild(ghost);
  let p1 = p0;
  const pr = pvEl.getBoundingClientRect();
  const mv = ev => {
    p1 = ptOf(i, ev);
    if (ev.shiftKey && (t === 'line' || t === 'arrow')) { const dx = p1[0] - p0[0], dy = p1[1] - p0[1], ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI / 4, len = Math.hypot(dx, dy); p1 = [p0[0] + Math.cos(ang) * len, p0[1] + Math.sin(ang) * len]; }
    if (line) { line.setAttribute('d', `M${f2(p0[0])} ${f2(p0[1])}L${f2(p1[0])} ${f2(p1[1])}`); return; }
    const L = Math.min(sp[0], ev.clientX), T = Math.min(sp[1], ev.clientY);
    let W = Math.abs(ev.clientX - sp[0]), H = Math.abs(ev.clientY - sp[1]);
    if (ev.shiftKey && (t === 'rect' || t === 'ellipse')) { W = H = Math.max(W, H); }
    Object.assign(ghost.style, { left: (L - pr.left) / pr.width * 100 + '%', top: (T - pr.top) / pr.height * 100 + '%', width: W / pr.width * 100 + '%', height: H / pr.height * 100 + '%' });
    if (ev.shiftKey && (t === 'rect' || t === 'ellipse')) p1 = clientToPdf(i, ev.clientX < sp[0] ? sp[0] - W : sp[0] + W, ev.clientY < sp[1] ? sp[1] - H : sp[1] + H);
  };
  const up = ev => {
    inter.removeEventListener('pointermove', mv); inter.removeEventListener('pointerup', up);
    ghost.remove(); line?.remove();
    const pid = d.state.pageIds[i];
    const small = Math.hypot(ev.clientX - sp[0], ev.clientY - sp[1]) < 5;
    const rect = normRect([p0[0], p0[1], p1[0], p1[1]]);
    if (t === 'freetext') {
      const fo = App.opts.freetext;
      const a = small ? makeText(i, p0, '', { ...fo, box: true, w: 180 }) : { type: 'freetext', page: pid, rect, rot, text: '', ...pick(fo, 'color size font fill bw bcolor opacity align bold') };
      const added = addAnnot(a, 'Add text box'); if (added) setTimeout(() => editFreetext(added, true), 20); return;
    }
    if (small) return;
    if (t === 'line' || t === 'arrow') { addAnnot({ type: t, page: pid, p1: p0, p2: p1, color: o.color, width: o.width, opacity: o.opacity, content: App.contentMode }); return; }
    if (t === 'rect' || t === 'ellipse') { addAnnot({ type: t, page: pid, rect, color: o.color, width: o.width, fill: o.fill, opacity: o.opacity, content: App.contentMode }); return; }
    if (t === 'redact') { addAnnot({ type: 'redact', page: pid, rects: [rect], color: '#000000', opacity: 1 }, 'Mark for redaction'); return; }
    if (t === 'crop') { emit('cropRect', { page: i, rect }); return; }
  };
  inter.addEventListener('pointermove', mv); inter.addEventListener('pointerup', up);
}
const pick = (o, keys) => Object.fromEntries(keys.split(' ').map(k => [k, o[k]]));
// rect of display-size w×h centred on p (swap for rotated pages)
function centerRect(p, w, h, rot) { if (rot % 180) [w, h] = [h, w]; return [p[0] - w / 2, p[1] - h / 2, p[0] + w / 2, p[1] + h / 2]; }
function makeText(i, p, text, o) {
  const d = App.doc, rot = d.info[i].rotate; const size = o.size || 12;
  const m = measureCss(o.font, size, o.bold); const pad = 2 + (o.box ? (o.bw || 0) : 0);
  const w = o.w || Math.max(40, m(text || 'Type here') + pad * 2 + 6), h = size * LEADING + pad * 2;
  // click point = left edge, vertical middle of the first line (display orientation)
  const rect = rot % 360 === 0 ? [p[0] - pad, p[1] - h / 2, p[0] - pad + w, p[1] + h / 2] : centerRect(p, w, h, rot);
  const a = { type: 'freetext', page: d.state.pageIds[i], rect, rot, text, color: o.color, size, font: o.font || 'Helvetica', bold: !!o.bold, opacity: o.opacity ?? 1, align: o.align || 'left', autoW: !o.box };
  if (o.box) Object.assign(a, { fill: o.fill, bw: o.bw, bcolor: o.bcolor }); else Object.assign(a, { fill: null, bw: 0 });
  return a;
}
// Chaikin-ish smoothing keeping pressure
function smooth(pts) {
  if (pts.length < 3) return pts.map(p => [+f2(p[0]), +f2(p[1]), +(p[2] ?? 0.5).toFixed(2)]);
  const out = [pts[0]];
  for (let k = 1; k < pts.length - 1; k++) { const a = pts[k - 1], b = pts[k], c = pts[k + 1]; out.push([(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4, (a[2] + 2 * b[2] + c[2]) / 4]); }
  out.push(pts[pts.length - 1]);
  // drop near-duplicate points
  const res = [out[0]];
  for (const p of out.slice(1)) { const l = res[res.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 0.6) res.push(p); }
  if (res[res.length - 1] !== out[out.length - 1]) res.push(out[out.length - 1]);
  return res.map(p => [+f2(p[0]), +f2(p[1]), +(p[2] ?? 0.5).toFixed(2)]);
}

/* ---------- inline text editing ---------- */
let editing = null;
export function editFreetext(a, isNew = false) {
  const d = App.doc; const i = d.pageOf(a); const pv = V.views[i]; if (!pv) return;
  finishEdit();
  const p = rectPct(i, annotRect(a));
  const ta = document.createElement('textarea'); ta.className = 'edit-text';
  Object.assign(ta.style, { left: p.left + '%', top: p.top + '%', width: `max(${p.width}%, 60px)`, minHeight: p.height + '%', fontSize: `calc(var(--sc) * ${a.size || 12}px)`, color: a.color, fontFamily: a.font === 'Times' ? '"Times New Roman",serif' : a.font === 'Courier' ? '"Courier New",monospace' : 'Helvetica,Arial,sans-serif', fontWeight: a.bold ? 'bold' : 'normal', textAlign: a.align || 'left' });
  ta.value = a.text || ''; ta.spellcheck = true;
  pv.el.appendChild(ta);
  const fit = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; if (a.autoW) { ta.style.width = 'auto'; } };
  ta.addEventListener('input', fit); fit();
  editing = { a, ta, isNew };
  ta.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); finishEdit(); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); finishEdit(); } e.stopPropagation(); });
  ta.addEventListener('blur', () => finishEdit());
  setTimeout(() => { ta.focus(); ta.select(); }, 0);
}
export function finishEdit() {
  if (!editing) return; const { a, ta, isNew } = editing; editing = null;
  const text = ta.value; ta.remove();
  const d = App.doc; const cur = d.annot(a.id); if (!cur) return;
  if (!text.trim() && isNew) {
    // nothing typed: drop the empty box and its history step
    const s = d.hist.undo(); d.state.annots = s ? structuredClone(s.annots) : d.state.annots.filter(x => x.id !== a.id);
    App.sel = null; redrawAll(); emit('annots'); emit('sel'); return;
  }
  if (text === cur.text && !isNew) return;
  const nu = fitFreetext({ ...structuredClone(cur), text });
  replaceAnnot(nu, isNew ? 'Type text' : 'Edit text');
  drawHandles(d.pageOf(nu)); emit('sel');
}
function redrawAll() { V.views.forEach(pv => drawAnnots(pv.i)); }
// grow the box to fit its text; auto-width boxes shrink/grow horizontally too
export function fitFreetext(a) {
  const m = measureCss(a.font, a.size || 12, a.bold);
  const lf = localFrame(a.rect, a.rot || 0); const pad = 2 + (a.bw || 0);
  let W = lf.w;
  if (a.autoW) W = Math.max(30, ...String(a.text || ' ').split('\n').map(l => m(l))) + pad * 2 + 4;
  const L = freetextLayout({ ...a, rect: a.rect }, m);
  const lines = (a.autoW ? String(a.text || '').split('\n').length : L.lines.length) || 1;
  const H = Math.max(lf.h, pad * 2 + lines * (a.size || 12) * LEADING);
  const Hn = a.autoW ? pad * 2 + lines * (a.size || 12) * LEADING : H;
  // keep the local top-left corner fixed
  const [A, B, C, D, E, F] = lf.m; const map = (u, v) => [A * u + C * v + E, B * u + D * v + F];
  const v0 = lf.h - Hn; const c1 = map(0, v0), c2 = map(W, lf.h);
  return { ...a, rect: normRect([c1[0], c1[1], c2[0], c2[1]]) };
}

/* ---------- text selection -> markup ---------- */
export function selectionQuads() {
  const sel = getSelection(); if (!sel || !sel.rangeCount || sel.isCollapsed) return null;
  const byPage = new Map(); let text = '';
  for (let r = 0; r < sel.rangeCount; r++) {
    const range = sel.getRangeAt(r); text += range.toString();
    const root = range.commonAncestorContainer;
    const nodes = [];
    if (root.nodeType === 3) nodes.push(root);
    else { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (range.intersectsNode(n)) nodes.push(n); }
    for (const n of nodes) {
      if (!n.parentElement?.closest('.textLayer')) continue;
      const pvEl = n.parentElement.closest('.pv'); const i = +pvEl.dataset.i;
      const sub = document.createRange(); sub.selectNodeContents(n);
      if (n === range.startContainer) sub.setStart(n, range.startOffset);
      if (n === range.endContainer) sub.setEnd(n, range.endOffset);
      if (sub.collapsed) continue;
      for (const cr of sub.getClientRects()) {
        if (cr.width < 0.5 || cr.height < 0.5) continue;
        const a = clientToPdf(i, cr.left, cr.top), b = clientToPdf(i, cr.right, cr.bottom);
        if (!byPage.has(i)) byPage.set(i, []);
        byPage.get(i).push(normRect([a[0], a[1], b[0], b[1]]));
      }
    }
  }
  if (!byPage.size) return null;
  const out = [];
  for (const [i, rects] of byPage) out.push({ page: i, rects: mergeLines(rects, effRot(i)) });
  return { pages: out, text: text.trim() };
}
function mergeLines(rects, rot) {
  const vertical = rot % 180 !== 0 && false; // text runs horizontally in user space for typical PDFs
  rects.sort((a, b) => (b[3] + b[1]) / 2 - (a[3] + a[1]) / 2 || a[0] - b[0]);
  const lines = [];
  for (const r of rects) {
    const h = r[3] - r[1];
    const ln = lines.find(l => { const ov = Math.min(l[3], r[3]) - Math.max(l[1], r[1]); return ov > 0.5 * Math.min(h, l[3] - l[1]) && r[0] <= l[2] + h * 1.2 && r[2] >= l[0] - h * 1.2; });
    if (ln) { ln[0] = Math.min(ln[0], r[0]); ln[1] = Math.min(ln[1], r[1]); ln[2] = Math.max(ln[2], r[2]); ln[3] = Math.max(ln[3], r[3]); }
    else lines.push(r.slice());
  }
  void vertical;
  return lines;
}
export function markupFromSelection(type, { comment = false } = {}) {
  const q = selectionQuads(); if (!q) { Aero.toast('Select some text first'); return null; }
  const d = App.doc; let first = null;
  for (const pg of q.pages) {
    if (type === 'redact') { const a = addAnnot({ type: 'redact', page: d.state.pageIds[pg.page], rects: pg.rects.map(r => [r[0] - 0.5, r[1] - 0.5, r[2] + 0.5, r[3] + 0.5]), color: '#000000', opacity: 1, quote: q.text }, 'Mark text for redaction'); first = first || a; continue; }
    const o = App.opts[type];
    const quads = pg.rects.map(([x1, y1, x2, y2]) => [x1, y2, x2, y2, x1, y1, x2, y1].map(v => +f2(v)));
    const a = addAnnot({ type, page: d.state.pageIds[pg.page], quads, color: o.color, opacity: o.opacity, quote: q.text }, TYPE_LABEL[type]);
    first = first || a;
  }
  getSelection().removeAllRanges(); hideSelPill();
  if (first && comment) setTimeout(() => emit('editComment', first.id), 30);
  return first;
}

/* ---------- selection pill ---------- */
const pill = $('selpill');
export function hideSelPill() { pill.hidden = true; }
function showSelPill() {
  const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) return hideSelPill();
  const node = sel.focusNode?.parentElement; if (!node?.closest('#pages .textLayer')) return hideSelPill();
  const rects = sel.getRangeAt(sel.rangeCount - 1).getClientRects(); const last = rects[rects.length - 1]; if (!last) return;
  const st = $('stage').getBoundingClientRect();
  pill.innerHTML = [['highlight', 'Highlight', App.opts.highlight.color], ['underline', 'Underline', App.opts.underline.color], ['strike', 'Strike', App.opts.strike.color], ['comment', 'Comment', '#ffd84d'], ['redact', 'Redact', '#000'], ['copy', 'Copy', null]]
    .map(([k, l, c]) => `<button data-k="${k}">${c ? `<span class="dot" style="background:${c}"></span>` : ''}${l}</button>`).join('');
  pill.hidden = false;
  const x = clamp(last.right - st.left - 120, 8, st.width - pill.offsetWidth - 8), y = last.bottom - st.top + 8;
  pill.style.left = x + 'px'; pill.style.top = (y + pill.offsetHeight > st.height ? last.top - st.top - pill.offsetHeight - 8 : y) + 'px';
}
pill.addEventListener('pointerdown', e => e.preventDefault());
pill.addEventListener('click', e => {
  const k = e.target.closest('button')?.dataset.k; if (!k) return;
  if (k === 'copy') { const t = getSelection().toString(); navigator.clipboard?.writeText(t).then(() => Aero.toast('Copied')).catch(() => { document.execCommand('copy'); }); hideSelPill(); return; }
  if (k === 'comment') { markupFromSelection('highlight', { comment: true }); return; }
  markupFromSelection(k);
});
document.addEventListener('pointerup', e => {
  if (!App.doc || e.target.closest('#selpill')) return;
  setTimeout(() => {
    const sel = getSelection(); const inText = sel.rangeCount && !sel.isCollapsed && sel.focusNode?.parentElement?.closest('#pages .textLayer');
    if (!inText) { if (!e.target.closest('#selpill')) hideSelPill(); return; }
    if (isMarkupTool(App.tool)) markupFromSelection(App.tool);
    else if (App.tool === 'select') showSelPill();
  }, 0);
});
scroller.addEventListener('scroll', () => { if (!pill.hidden) hideSelPill(); });

/* ---------- keyboard: nudge selected annotation ---------- */
document.addEventListener('keydown', e => {
  if (!App.sel || !App.doc || e.target.matches?.('input,textarea,select') || document.querySelector('.aero-modal')) return;
  const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]; if (!k) return;
  e.preventDefault();
  const a = App.doc.annot(App.sel); if (!a || MARKUP.has(a.type)) return;
  const i = App.doc.pageOf(a); const step = e.shiftKey ? 10 : 1;
  // screen direction -> pdf delta
  const c = pdfToClient(i, 0, 0), u = clientToPdf(i, c[0] + k[0] * 10, c[1] + k[1] * 10), o = clientToPdf(i, c[0], c[1]);
  const len = Math.hypot(u[0] - o[0], u[1] - o[1]) || 1;
  replaceAnnot(translateAnnot(a, (u[0] - o[0]) / len * step, (u[1] - o[1]) / len * step), 'Nudge annotation');
  drawHandles(i);
});
export { svgFor, stampLayout };
