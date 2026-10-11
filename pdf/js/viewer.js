// Page views: lazy HiDPI rendering with pdf.js, text layer, annotation SVG overlay, links, form fields.
import { App, emit } from './state.js';
import { AnnotationMode, TextLayer } from './pdfjs.js';
import { svgFor, annotRect, isResizable } from './annots.js';
import { clamp, f2, esc } from './util.js';

const $ = id => document.getElementById(id);
const scroller = $('scroller'), pagesEl = $('pages');
export const PT = 96 / 72;
export const V = { views: [], scale: 1, cur: 0, gen: 0, visible: new Set(), rendered: new Set(), rendering: false, rt: 0 };

/* ---------- viewport math (mirrors pdf.js PageViewport) ---------- */
export function makeVp(view, rot, scale) {
  rot = ((rot % 360) + 360) % 360;
  const cx = (view[2] + view[0]) / 2, cy = (view[3] + view[1]) / 2;
  let A, B, C, D;
  switch (rot) { case 90: A = 0; B = 1; C = 1; D = 0; break; case 180: A = -1; B = 0; C = 0; D = 1; break; case 270: A = 0; B = -1; C = -1; D = 0; break; default: A = 1; B = 0; C = 0; D = -1; }
  let ox, oy, w, h;
  if (A === 0) { ox = Math.abs(cy - view[1]) * scale; oy = Math.abs(cx - view[0]) * scale; w = Math.abs(view[3] - view[1]) * scale; h = Math.abs(view[2] - view[0]) * scale; }
  else { ox = Math.abs(cx - view[0]) * scale; oy = Math.abs(cy - view[1]) * scale; w = Math.abs(view[2] - view[0]) * scale; h = Math.abs(view[3] - view[1]) * scale; }
  const t = [A * scale, B * scale, C * scale, D * scale, ox - A * scale * cx - C * scale * cy, oy - B * scale * cx - D * scale * cy];
  const det = t[0] * t[3] - t[1] * t[2];
  return {
    t, w, h, rot,
    toPx: (x, y) => [t[0] * x + t[2] * y + t[4], t[1] * x + t[3] * y + t[5]],
    toPdf: (px, py) => { const x = px - t[4], y = py - t[5]; return [(t[3] * x - t[2] * y) / det, (-t[1] * x + t[0] * y) / det]; }
  };
}
export const effRot = i => ((App.doc.info[i].rotate + App.doc.view.rot) % 360 + 360) % 360;
export function vp(i, scale = 1) { const inf = App.doc.info[i]; return makeVp(inf.view, effRot(i), scale); }
// PDF rect -> % box on the page element
export function rectPct(i, r) {
  const v = vp(i); const a = v.toPx(r[0], r[1]), b = v.toPx(r[2], r[3]);
  const x1 = Math.min(a[0], b[0]), x2 = Math.max(a[0], b[0]), y1 = Math.min(a[1], b[1]), y2 = Math.max(a[1], b[1]);
  return { left: x1 / v.w * 100, top: y1 / v.h * 100, width: (x2 - x1) / v.w * 100, height: (y2 - y1) / v.h * 100, pxH: (y2 - y1), pxW: x2 - x1 };
}
// client point -> PDF user space of page i
export function clientToPdf(i, cx, cy) {
  const el = V.views[i].el, r = el.getBoundingClientRect(), v = vp(i);
  return v.toPdf((cx - r.left) * v.w / r.width, (cy - r.top) * v.h / r.height);
}
export function pdfToClient(i, x, y) {
  const el = V.views[i].el, r = el.getBoundingClientRect(), v = vp(i); const p = v.toPx(x, y);
  return [r.left + p[0] * r.width / v.w, r.top + p[1] * r.height / v.h];
}
export function pageAt(cx, cy) {
  const els = document.elementsFromPoint(cx, cy);
  for (const e of els) { const pv = e.closest?.('.pv'); if (pv) return +pv.dataset.i; }
  return -1;
}

/* ---------- zoom ---------- */
export function computeScale() {
  const d = App.doc; if (!d || !d.info.length) return PT;
  const z = d.view.zoom;
  if (typeof z === 'number') return z * PT;
  const cur = clamp(V.cur, 0, d.info.length - 1);
  const v = vp(cur); const spread = d.view.mode === 'spread';
  // reserve room for a vertical scrollbar that may appear once the pages are laid out
  const sb = scroller.offsetWidth - scroller.clientWidth > 0 ? 0 : 17;
  const availW = Math.max(100, scroller.clientWidth - 48 - sb), availH = Math.max(100, scroller.clientHeight - 44);
  let wMax = v.w; if (spread) { const o = vp(Math.min(d.info.length - 1, cur ^ 1)); wMax = v.w + o.w + 10; }
  const fitw = availW / wMax;
  if (z === 'fitw') return Math.max(0.05, Math.min(fitw, 8));
  return Math.max(0.05, Math.min(fitw, availH / v.h));
}
export const zoomPct = () => Math.round(V.scale / PT * 100);

/* ---------- build ---------- */
const io = new IntersectionObserver(entries => {
  for (const e of entries) { const i = +e.target.dataset.i; if (e.isIntersecting) V.visible.add(i); else V.visible.delete(i); }
  schedule(); updateCur();
}, { root: scroller, rootMargin: '700px 0px 700px 0px' });

export function rebuild() {
  V.gen++;
  for (const pv of V.views) { try { pv.task?.cancel(); } catch (e) { /* ignore */ } io.unobserve(pv.el); }
  pagesEl.innerHTML = ''; V.views = []; V.visible.clear(); V.rendered.clear();
  const d = App.doc; if (!d) return;
  V.cur = clamp(d.view.page || 0, 0, d.numPages - 1);
  const frag = document.createDocumentFragment();
  for (let i = 0; i < d.numPages; i++) {
    const el = document.createElement('div'); el.className = 'pv'; el.dataset.i = i;
    el.innerHTML = `<div class="pnum">${i + 1}</div><svg class="ann" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="none"><g></g></svg><div class="hl"></div><div class="links"></div><div class="forms"></div><div class="inter"></div><div class="handles"></div>`;
    const pv = { i, el, svg: el.querySelector('svg'), g: el.querySelector('svg g'), hl: el.querySelector('.hl'), links: el.querySelector('.links'), forms: el.querySelector('.forms'), handles: el.querySelector('.handles'), key: null, tl: null, overlays: false };
    V.views.push(pv); frag.appendChild(el);
  }
  pagesEl.appendChild(frag);
  setModeClass();
  layout(false);
  for (let i = 0; i < d.numPages; i++) drawAnnots(i);
  V.views.forEach(pv => io.observe(pv.el));
  requestAnimationFrame(() => { goTo(V.cur, null, true); if (d.view.scroll && d.view.mode !== 'single') scroller.scrollTop = d.view.scroll; });
}
function setModeClass() {
  const m = App.doc?.view.mode || 'cont';
  pagesEl.classList.toggle('spread', m === 'spread'); pagesEl.classList.toggle('cover', m === 'spread' && !!App.doc?.view.cover);
  pagesEl.classList.toggle('single', m === 'single');
  V.views.forEach(pv => pv.el.classList.toggle('cur', pv.i === V.cur));
}
export function layout(keepAnchor = true) {
  const d = App.doc; if (!d || !scroller.clientWidth) return;
  let anchor = null;
  if (keepAnchor && V.views[V.cur]) { const el = V.views[V.cur].el; anchor = { i: V.cur, f: (scroller.scrollTop - el.offsetTop) / Math.max(1, el.offsetHeight), x: scroller.scrollLeft / Math.max(1, scroller.scrollWidth - scroller.clientWidth) }; }
  const s = computeScale(); V.scale = s;
  pagesEl.style.setProperty('--sc', s);
  for (const pv of V.views) {
    const v = vp(pv.i);
    pv.el.style.width = Math.floor(v.w * s) + 'px'; pv.el.style.height = Math.floor(v.h * s) + 'px';
    pv.el.style.setProperty('--scale-factor', s); pv.el.style.setProperty('--total-scale-factor', s);
    pv.svg.setAttribute('viewBox', `0 0 ${f2(v.w)} ${f2(v.h)}`); pv.g.setAttribute('transform', `matrix(${v.t.map(f2).join(' ')})`);
  }
  if (anchor) { const el = V.views[anchor.i].el; scroller.scrollTop = el.offsetTop + anchor.f * el.offsetHeight; if (isFinite(anchor.x)) scroller.scrollLeft = anchor.x * (scroller.scrollWidth - scroller.clientWidth); }
  emit('zoom');
  schedule();
}
export function setZoom(z) {
  const d = App.doc; if (!d) return;
  if (typeof z === 'number') z = clamp(z, 0.1, 8);
  d.view.zoom = z; layout(true);
}
export function zoomBy(f) { setZoom(Math.round(V.scale / PT * f * 100) / 100); }
export function setMode(m) { const d = App.doc; if (!d) return; d.view.mode = m; setModeClass(); layout(false); goTo(V.cur, null, true); emit('zoom'); }
export function rotateView(delta) { const d = App.doc; if (!d) return; d.view.rot = ((d.view.rot + delta) % 360 + 360) % 360; d.view.page = V.cur; rebuild(); emit('zoom'); }

/* ---------- navigation ---------- */
export function goTo(i, top = null, instant = false) {
  const d = App.doc; if (!d || !V.views.length) return;
  i = clamp(i | 0, 0, d.numPages - 1);
  if (d.view.mode === 'single') {
    V.cur = i; setModeClass(); scroller.scrollTop = 0;
    if (top != null) { const v = vp(i); const p = v.toPx(d.info[i].view[0], top); scroller.scrollTop = p[1] * V.scale - 10; }
    emit('page', i); schedule(); return;
  }
  const el = V.views[i].el;
  let y = el.offsetTop - 14;
  if (top != null) { const v = vp(i); const p = v.toPx(d.info[i].view[0], top); y = el.offsetTop + p[1] * V.scale - 10; }
  scroller.scrollTo({ top: y, behavior: instant ? 'instant' : 'instant' });
  if (V.cur !== i) { V.cur = i; emit('page', i); }
  schedule();
}
export function updateCur() {
  const d = App.doc; if (!d || d.view.mode === 'single' || !V.views.length) return;
  const sr = scroller.getBoundingClientRect(); const mid = sr.top + sr.height * 0.4;
  let best = V.cur, bestD = Infinity;
  for (const i of V.visible) {
    const r = V.views[i].el.getBoundingClientRect();
    const dd = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
    if (dd < bestD || (dd === bestD && i < best)) { bestD = dd; best = i; }
  }
  d.view.scroll = scroller.scrollTop;
  if (best !== V.cur) { V.cur = best; d.view.page = best; emit('page', best); }
}
scroller.addEventListener('scroll', () => { updateCur(); });
scroller.addEventListener('wheel', e => {
  const d = App.doc; if (!d) return;
  if (e.ctrlKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1); return; }
  if (d.view.mode === 'single') {
    const atEnd = scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2, atTop = scroller.scrollTop <= 0;
    if (e.deltaY > 0 && atEnd && V.cur < d.numPages - 1) { e.preventDefault(); goTo(V.cur + 1); }
    else if (e.deltaY < 0 && atTop && V.cur > 0) { e.preventDefault(); goTo(V.cur - 1); requestAnimationFrame(() => scroller.scrollTop = scroller.scrollHeight); }
  }
}, { passive: false });
let roRaf = 0;
new ResizeObserver(() => { cancelAnimationFrame(roRaf); roRaf = requestAnimationFrame(() => { if (App.doc && typeof App.doc.view.zoom === 'string') layout(true); }); }).observe(scroller);

/* ---------- rendering ---------- */
export function schedule() { clearTimeout(V.rt); V.rt = setTimeout(pump, 40); }
function renderKey(i) { return `${V.scale.toFixed(4)}|${effRot(i)}|${V.gen}`; }
function nextToRender() {
  const d = App.doc; if (!d) return null;
  let cands = d.view.mode === 'single' ? [V.cur] : [...V.visible];
  cands = cands.filter(i => V.views[i] && V.views[i].key !== renderKey(i));
  cands.sort((a, b) => Math.abs(a - V.cur) - Math.abs(b - V.cur));
  return cands.length ? cands[0] : null;
}
async function pump() {
  if (V.rendering) return; V.rendering = true;
  try { for (let n = 0; n < 400; n++) { const i = nextToRender(); if (i == null) break; await renderPage(i); } }
  catch (e) { console.warn('render', e); }
  finally { V.rendering = false; }
  if (nextToRender() != null) schedule();
}
export const renderWaiters = [];
export async function renderPage(i) {
  const d = App.doc, pv = V.views[i], gen = V.gen, key = renderKey(i);
  const page = await d.getPage(i); if (gen !== V.gen || !pv) return;
  const rot = effRot(i);
  const viewport = page.getViewport({ scale: V.scale, rotation: rot });
  let dpr = window.devicePixelRatio || 1;
  const maxPx = 14e6; if (viewport.width * viewport.height * dpr * dpr > maxPx) dpr = Math.sqrt(maxPx / (viewport.width * viewport.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width * dpr)); canvas.height = Math.max(1, Math.floor(viewport.height * dpr));
  const task = page.render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null, annotationMode: AnnotationMode.ENABLE_FORMS });
  pv.task = task;
  try { await task.promise; } catch (e) { if (/cancel/i.test(e?.name + e?.message)) return; throw e; }
  if (gen !== V.gen) return;
  const old = pv.el.querySelector(':scope>canvas'); if (old) { old.replaceWith(canvas); old.width = 0; } else pv.el.prepend(canvas);
  pv.el.querySelector('.pnum')?.remove();
  pv.key = key;
  // text layer
  if (!pv.tl || pv.tlRot !== rot) {
    pv.textDiv?.remove();
    const div = document.createElement('div'); div.className = 'textLayer';
    canvas.after(div);
    const tl = new TextLayer({ textContentSource: page.streamTextContent(), container: div, viewport });
    try { await tl.render(); } catch (e) { /* cancelled */ }
    if (gen !== V.gen) return;
    const eoc = document.createElement('div'); eoc.className = 'endOfContent'; div.append(eoc);
    div.addEventListener('pointerdown', () => div.classList.add('selecting'));
    pv.tl = tl; pv.tlRot = rot; pv.textDiv = div;
  } else pv.tl.update({ viewport });
  if (!pv.overlays) { pv.overlays = true; await buildOverlays(i); }
  V.rendered.add(i); drawHighlights(i); trim();
  emit('rendered', i); document.dispatchEvent(new CustomEvent('lumen-rendered', { detail: i }));
}
document.addEventListener('pointerup', () => document.querySelectorAll('.textLayer.selecting').forEach(d => d.classList.remove('selecting')));
function trim() {
  if (V.rendered.size <= 14) return;
  const far = [...V.rendered].filter(i => !V.visible.has(i) && i !== V.cur).sort((a, b) => Math.abs(b - V.cur) - Math.abs(a - V.cur));
  for (const i of far.slice(0, V.rendered.size - 14)) {
    const pv = V.views[i]; const c = pv.el.querySelector(':scope>canvas'); if (c) { c.width = 0; c.remove(); }
    pv.textDiv?.remove(); pv.textDiv = null; pv.tl = null; pv.key = null; V.rendered.delete(i);
  }
}
// wait until page i has been rendered (used by tests / search)
export function whenRendered(i) {
  return new Promise(res => {
    if (V.views[i]?.key === renderKey(i)) return res();
    const done = () => { clearTimeout(t); document.removeEventListener('lumen-rendered', h); res(); };
    const h = e => { if (e.detail === i) done(); };
    const t = setTimeout(done, 6000);
    document.addEventListener('lumen-rendered', h); schedule();
  });
}

/* ---------- overlays: annotations, handles, links, forms ---------- */
export function drawAnnots(i) {
  const pv = V.views[i]; if (!pv || !App.doc) return;
  pv.g.innerHTML = App.doc.annotsOnPage(i).map(a => svgFor(a)).join('');
  drawHandles(i);
}
export function drawAllAnnots() { if (App.doc) V.views.forEach(pv => drawAnnots(pv.i)); }
export function drawHandles(i) {
  const pv = V.views[i]; if (!pv) return;
  pv.handles.innerHTML = '';
  const a = App.sel && App.doc.annot(App.sel);
  if (!a || App.doc.pageOf(a) !== i) return;
  const p = rectPct(i, annotRect(a));
  const box = document.createElement('div'); box.className = 'selbox';
  Object.assign(box.style, { left: p.left + '%', top: p.top + '%', width: p.width + '%', height: p.height + '%' });
  let html = '<div class="mv" data-h="mv"></div>';
  if (isResizable(a)) for (const [h, x, y] of [['nw', 0, 0], ['n', 50, 0], ['ne', 100, 0], ['e', 100, 50], ['se', 100, 100], ['s', 50, 100], ['sw', 0, 100], ['w', 0, 50]])
    html += `<div class="h" data-h="${h}" style="left:${x}%;top:${y}%;cursor:${h}-resize"></div>`;
  box.innerHTML = html; pv.handles.appendChild(box);
}
async function buildOverlays(i) {
  const d = App.doc, pv = V.views[i];
  const anns = await d.getPageAnnots(i);
  pv.links.innerHTML = ''; pv.forms.innerHTML = '';
  for (const a of anns) {
    if (a.subtype === 'Link' && (a.url || a.dest || a.action || a.unsafeUrl)) {
      const p = rectPct(i, a.rect); const el = document.createElement('a');
      Object.assign(el.style, { left: p.left + '%', top: p.top + '%', width: p.width + '%', height: p.height + '%' });
      el.dataset.url = a.url || a.unsafeUrl || ''; if (a.dest) el.dataset.dest = JSON.stringify(a.dest); if (a.action) el.dataset.action = a.action;
      el.title = a.url || a.unsafeUrl || (a.action ? a.action : 'Go to destination');
      pv.links.appendChild(el);
    } else if (a.subtype === 'Widget' && !a.hidden && a.fieldName) {
      const el = formEl(a); if (!el) continue;
      const p = rectPct(i, a.rect);
      Object.assign(el.style, { left: p.left + '%', top: p.top + '%', width: p.width + '%', height: p.height + '%' });
      el.dataset.name = a.fieldName; el.title = a.alternativeText || a.fieldName;
      pv.forms.appendChild(el);
    }
  }
  syncForms(pv.forms);
}
function formEl(a) {
  const ro = a.readOnly;
  const h = Math.abs(a.rect[3] - a.rect[1]);
  if (a.fieldType === 'Tx') {
    const el = document.createElement(a.multiLine ? 'textarea' : 'input');
    if (!a.multiLine) el.type = 'text';
    if (a.maxLen) el.maxLength = a.maxLen;
    const fs = a.defaultAppearanceData?.fontSize || Math.min(12, h * (a.multiLine ? 0.5 : 0.62));
    el.style.fontSize = `calc(var(--sc) * ${f2(fs || 10)}px)`;
    if (a.textAlignment === 1) el.style.textAlign = 'center'; else if (a.textAlignment === 2) el.style.textAlign = 'right';
    el.dataset.kind = 'text'; el.dataset.def = a.fieldValue ?? '';
    el.disabled = !!ro; el.spellcheck = false;
    return el;
  }
  if (a.fieldType === 'Btn' && (a.checkBox || a.radioButton)) {
    const el = document.createElement('input'); el.type = a.checkBox ? 'checkbox' : 'radio';
    el.style.setProperty('--fh', `calc(var(--sc) * ${f2(h)}px)`);
    el.dataset.kind = a.checkBox ? 'check' : 'radio';
    if (a.radioButton) { el.name = App.doc.id + '::' + a.fieldName; el.value = a.buttonValue; el.dataset.def = a.fieldValue ?? 'Off'; }
    else { el.value = a.exportValue || 'Yes'; el.dataset.def = a.fieldValue && a.fieldValue !== 'Off' ? '1' : ''; }
    el.disabled = !!ro; return el;
  }
  if (a.fieldType === 'Ch') {
    const el = document.createElement('select');
    if (!a.combo) { el.size = Math.max(2, Math.min(6, a.options?.length || 2)); }
    if (a.combo) el.add(new Option('', ''));
    for (const o of a.options || []) el.add(new Option(o.displayValue ?? o.exportValue, o.exportValue ?? o.displayValue));
    const fs = a.defaultAppearanceData?.fontSize || Math.min(12, h * 0.62);
    el.style.fontSize = `calc(var(--sc) * ${f2(fs || 10)}px)`;
    el.dataset.kind = 'choice'; const fv = Array.isArray(a.fieldValue) ? a.fieldValue[0] : a.fieldValue; el.dataset.def = fv ?? '';
    el.disabled = !!ro; return el;
  }
  return null;
}
// push model values into form elements (all pages or one container)
export function syncForms(root) {
  const d = App.doc; if (!d) return;
  const els = root ? root.querySelectorAll('[data-name]') : pagesEl.querySelectorAll('.forms [data-name]');
  for (const el of els) {
    const name = el.dataset.name, has = Object.prototype.hasOwnProperty.call(d.state.form, name), v = d.state.form[name];
    switch (el.dataset.kind) {
      case 'text': { const val = has ? (v ?? '') : el.dataset.def; if (document.activeElement !== el) el.value = val; break; }
      case 'check': el.checked = has ? !!v : !!el.dataset.def; break;
      case 'radio': el.checked = (has ? v : el.dataset.def) === el.value; break;
      case 'choice': el.value = has ? (v ?? '') : el.dataset.def; break;
    }
  }
}
// current value of a field as shown
export function fieldValues() {
  const out = {};
  for (const el of pagesEl.querySelectorAll('.forms [data-name]')) {
    const n = el.dataset.name;
    if (el.dataset.kind === 'radio') { if (el.checked) out[n] = el.value; else if (!(n in out)) out[n] = null; }
    else if (el.dataset.kind === 'check') out[n] = el.checked;
    else out[n] = el.value;
  }
  return out;
}

/* ---------- search highlights ---------- */
export function drawHighlights(i) {
  const pv = V.views[i]; if (!pv) return;
  pv.hl.innerHTML = '';
  const F = App.find; if (!F.matches.length || !pv.tl || !pv.textDiv) return;
  const tc = App.doc.text.get(i); if (!tc) return;
  tc.then(t => {
    if (!pv.tl) return;
    const divs = pv.tl.textDivs; const pr = pv.el.getBoundingClientRect();
    const frag = document.createDocumentFragment();
    F.matches.forEach((m, mi) => {
      if (m.page !== i) return;
      const a = locate(t, m.start), b = locate(t, m.end - 1);
      if (!a || !b) return;
      const sa = divs[a.item]?.firstChild, sb = divs[b.item]?.firstChild; if (!sa || !sb) return;
      const r = document.createRange();
      try { r.setStart(sa, Math.min(a.off, sa.length)); r.setEnd(sb, Math.min(b.off + 1, sb.length)); } catch (e) { return; }
      for (const cr of r.getClientRects()) {
        if (cr.width < 0.5 || cr.height < 0.5) continue;
        const el = document.createElement('div'); if (mi === F.cur) el.className = 'cur';
        Object.assign(el.style, { left: (cr.left - pr.left) / pr.width * 100 + '%', top: (cr.top - pr.top) / pr.height * 100 + '%', width: cr.width / pr.width * 100 + '%', height: cr.height / pr.height * 100 + '%' });
        frag.appendChild(el);
      }
    });
    pv.hl.appendChild(frag);
  });
}
function locate(t, pos) {
  // binary search item containing pos
  let lo = 0, hi = t.starts.length - 1, k = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (t.starts[m] <= pos) { k = m; lo = m + 1; } else hi = m - 1; }
  if (k < 0) return null;
  const len = t.items[k].str.length; if (!len) return null;
  return { item: k, off: Math.min(pos - t.starts[k], len - 1) };
}
export function drawAllHighlights() { for (const i of V.rendered) drawHighlights(i); }
export { esc };
