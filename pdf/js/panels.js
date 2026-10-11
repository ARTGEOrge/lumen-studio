// Side panels: page thumbnails, bookmarks (outline), comments (with replies), history.
import { App, emit, on } from './state.js';
import { V, goTo, makeVp, effRot } from './viewer.js';
import { svgFor, displayLabel, annotRect, MARKUP } from './annots.js';
import { esc, fmtDate, uid, f2 } from './util.js';
import { select, patchAnnot, deleteAnnot, replaceAnnot } from './tools.js';

const $ = id => document.getElementById(id);
const thumbsEl = $('thumbs'), outlineEl = $('outline'), cmtEl = $('comments');

/* ---------- thumbnail cache (shared with organizer) ---------- */
const thumbCache = new WeakMap(); // bytes -> Map(i -> Promise<{url,w,h}>)
export function thumb(doc, i, width = 240) {
  const bytes = doc.state.bytes;
  if (!thumbCache.has(bytes)) thumbCache.set(bytes, new Map());
  const m = thumbCache.get(bytes); const key = i;
  if (m.has(key)) return m.get(key);
  const p = (async () => {
    const page = await doc.pdf.getPage(i + 1);
    const v1 = page.getViewport({ scale: 1 });
    const vpt = page.getViewport({ scale: width / v1.width });
    const c = document.createElement('canvas'); c.width = Math.ceil(vpt.width); c.height = Math.ceil(vpt.height);
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, viewport: vpt }).promise;
    const url = c.toDataURL('image/jpeg', 0.86); c.width = 0;
    return { url, w: vpt.width, h: vpt.height, rot: page.rotate };
  })();
  m.set(key, p); p.catch(() => m.delete(key));
  return p;
}
// annotation overlay SVG for a thumbnail (unrotated page rotation = page /Rotate)
export function thumbSvg(doc, i, rotExtra = 0) {
  const inf = doc.info[i]; const v = makeVp(inf.view, inf.rotate + rotExtra, 1);
  const anns = doc.annotsOnPage(i); if (!anns.length) return '';
  return `<svg viewBox="0 0 ${f2(v.w)} ${f2(v.h)}" preserveAspectRatio="none"><g transform="matrix(${v.t.map(f2).join(' ')})">${anns.map(a => svgFor(a)).join('')}</g></svg>`;
}

let thumbIO = null;
export function renderThumbs() {
  const d = App.doc; thumbsEl.innerHTML = '';
  thumbIO?.disconnect();
  if (!d) return;
  thumbIO = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { fillThumb(e.target); thumbIO.unobserve(e.target); } }), { root: thumbsEl, rootMargin: '300px' });
  const frag = document.createDocumentFragment();
  for (let i = 0; i < d.numPages; i++) {
    const inf = d.info[i]; const v = makeVp(inf.view, inf.rotate, 1);
    const w = 118, h = Math.round(w * v.h / v.w);
    const el = document.createElement('div'); el.className = 'thumb' + (i === V.cur ? ' sel' : ''); el.dataset.i = i;
    el.innerHTML = `<div class="tw" style="width:${w}px;height:${Math.min(h, 240)}px"></div><div class="lbl">${i + 1}</div>`;
    frag.appendChild(el); thumbIO.observe(el);
  }
  thumbsEl.appendChild(frag);
}
async function fillThumb(el) {
  const d = App.doc; if (!d) return; const i = +el.dataset.i;
  try {
    const t = await thumb(d, i);
    const tw = el.querySelector('.tw');
    tw.innerHTML = `<img src="${t.url}" alt="">` + thumbSvg(d, i);
  } catch (e) { /* page failed to render */ }
}
export function refreshThumbAnnots(pages) {
  const d = App.doc; if (!d) return;
  for (const el of thumbsEl.children) {
    const i = +el.dataset.i; if (pages && !pages.has(i)) continue;
    const tw = el.querySelector('.tw'); if (!tw.querySelector('img')) continue;
    tw.querySelector('svg')?.remove(); tw.insertAdjacentHTML('beforeend', thumbSvg(d, i));
  }
}
thumbsEl.addEventListener('click', e => { const t = e.target.closest('.thumb'); if (t) goTo(+t.dataset.i); });
on('page', i => {
  thumbsEl.querySelectorAll('.thumb.sel').forEach(t => t.classList.remove('sel'));
  const t = thumbsEl.children[i]; if (t) { t.classList.add('sel'); t.scrollIntoView({ block: 'nearest' }); }
});

/* ---------- outline ---------- */
export async function renderOutline() {
  const d = App.doc; outlineEl.innerHTML = '';
  if (!d) return;
  const items = await d.getOutline();
  if (d !== App.doc) return;
  if (!items || !items.length) { outlineEl.innerHTML = '<div class="empty-note">This document has no bookmarks.</div>'; return; }
  const build = (list, parent) => {
    for (const it of list) {
      const wrap = document.createElement('div'); wrap.className = 'ol';
      const row = document.createElement('div'); row.className = 'aero-item';
      const has = it.items && it.items.length;
      row.innerHTML = `<span class="tw">${has ? '▾' : ''}</span><span class="grow"></span>`;
      row.querySelector('.grow').textContent = it.title; row.title = it.title;
      if (it.bold) row.style.fontWeight = '600'; if (it.italic) row.style.fontStyle = 'italic';
      row.onclick = async ev => {
        if (ev.target.classList.contains('tw') && has) { kids.classList.toggle('closed'); ev.target.textContent = kids.classList.contains('closed') ? '▸' : '▾'; return; }
        outlineEl.querySelectorAll('.aero-item.sel').forEach(x => x.classList.remove('sel')); row.classList.add('sel');
        if (it.url) { emit('openUrl', it.url); return; }
        const r = await d.resolveDest(it.dest); if (r) goTo(r.page, r.top);
      };
      wrap.appendChild(row);
      const kids = document.createElement('div'); kids.className = 'kids';
      if (has) build(it.items, kids);
      wrap.appendChild(kids); parent.appendChild(wrap);
    }
  };
  build(items, outlineEl);
}
$('lefttabs').addEventListener('click', e => {
  const t = e.target.closest('.aero-tab'); if (!t) return;
  $('lefttabs').querySelectorAll('.aero-tab').forEach(x => x.classList.toggle('on', x === t));
  thumbsEl.hidden = t.dataset.t !== 'pages'; outlineEl.hidden = t.dataset.t !== 'outline';
});

/* ---------- comments ---------- */
const ICON = {
  note: '<path d="M2 2h8v6H5L3 10V8H2z"/>', highlight: '<path d="M2 10h8M3 7l4-4 2 2-4 4H3z"/>', underline: '<path d="M3 2v4a3 3 0 0 0 6 0V2M2 10.5h8"/>',
  strike: '<path d="M2 6h8M8.5 3.2C8 2.5 7.2 2 6 2 4.5 2 3.6 2.8 3.6 3.8M3.4 8.6C4 9.4 5 10 6 10c1.5 0 2.6-.9 2.6-2"/>', ink: '<path d="M1.5 9c1-3 2-5 3-5s.5 4 2 4 1.5-5 2.5-5 1 2 1.5 2.5"/>',
  rect: '<rect x="2" y="3" width="8" height="6"/>', ellipse: '<ellipse cx="6" cy="6" rx="4.2" ry="3.2"/>', line: '<path d="M2 10 10 2"/>', arrow: '<path d="M2 10 10 2M6 2h4v4"/>',
  freetext: '<path d="M3 3h6M6 3v7"/>', stamp: '<path d="M4 6V4.5a2 2 0 0 1 4 0V6M2 6h8v2H2zM3 10h6"/>', image: '<rect x="1.5" y="2.5" width="9" height="7"/><path d="M10.5 8 8 5.5 4 9.5"/>', redact: '<rect x="1.5" y="4" width="9" height="4" fill="#000"/>', squiggly: '<path d="M1.5 8l1.5-1.5L4.5 8 6 6.5 7.5 8 9 6.5 10.5 8"/>'
};
let editingCmt = null;
export function renderComments() {
  const d = App.doc; cmtEl.innerHTML = '';
  const count = $('cmtcount');
  if (!d) { count.textContent = ''; return; }
  const list = d.state.annots.filter(a => !a.content).map(a => ({ a, i: d.pageOf(a), r: annotRect(a) })).filter(x => x.i >= 0);
  list.sort((x, y) => x.i - y.i || y.r[3] - x.r[3] || x.r[0] - y.r[0]);
  count.textContent = list.length ? String(list.length) : '';
  if (!list.length) { cmtEl.innerHTML = '<div class="empty-note">No comments yet.<br>Use the highlight, sticky note or drawing tools — everything you add is saved as real PDF annotations.</div>'; return; }
  let lastPage = -1; const frag = document.createDocumentFragment();
  for (const { a, i } of list) {
    if (i !== lastPage) { const h = document.createElement('div'); h.className = 'pgh'; h.textContent = `Page ${i + 1}`; frag.appendChild(h); lastPage = i; }
    const c = document.createElement('div'); c.className = 'cmt' + (App.sel === a.id ? ' sel' : ''); c.dataset.id = a.id;
    const bg = a.type === 'highlight' || a.type === 'note' ? a.color : '#fff';
    const col = a.type === 'highlight' || a.type === 'note' ? '#1b2633' : (a.color || '#000');
    let body = '';
    const quote = a.quote ? `<div class="tx dim" style="font-style:italic">“${esc(a.quote.length > 140 ? a.quote.slice(0, 140) + '…' : a.quote)}”</div>` : '';
    if (App.sel === a.id) {
      body = quote + `<textarea data-f="contents" placeholder="Add a comment…">${esc(a.contents || '')}</textarea>` +
        (a.replies || []).map(r => `<div class="rp"><div class="hd"><span class="au">${esc(r.author || 'Unknown')}</span><span class="dt">${esc(fmtDate(r.date))}</span></div><div class="tx">${esc(r.text)}</div></div>`).join('') +
        `<div class="rp"><textarea data-f="reply" placeholder="Write a reply…" style="margin-left:0;width:100%"></textarea><div class="acts" style="margin-left:0"><button class="aero-btn small" data-a="post">Reply</button></div></div>` +
        `<div class="acts"><a data-a="del">Delete</a></div>`;
    } else {
      body = quote + (a.contents ? `<div class="tx">${esc(a.contents)}</div>` : (a.type === 'freetext' ? `<div class="tx">${esc(a.text || '')}</div>` : '')) +
        (a.replies?.length ? `<div class="rp"><div class="hd"><span class="au">${esc(a.replies[a.replies.length - 1].author)}</span><span class="dt">${a.replies.length > 1 ? a.replies.length + ' replies' : '1 reply'}</span></div><div class="tx">${esc(a.replies[a.replies.length - 1].text)}</div></div>` : '');
    }
    c.innerHTML = `<div class="hd"><span class="ic" style="background:${bg}"><svg viewBox="0 0 12 12" style="stroke:${col}">${ICON[a.type] || ICON.note}</svg></span><span class="au">${esc(a.author || 'Unknown')}</span><span class="dt">${esc(fmtDate(a.date))}</span></div>` +
      `<div class="kind">${esc(displayLabel(a))}</div>` + body;
    frag.appendChild(c);
  }
  cmtEl.appendChild(frag);
  if (editingCmt) { const ta = cmtEl.querySelector(`.cmt[data-id="${editingCmt}"] textarea[data-f="contents"]`); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } editingCmt = null; }
  cmtEl.querySelector('.cmt.sel')?.scrollIntoView({ block: 'nearest' });
}
cmtEl.addEventListener('click', e => {
  const c = e.target.closest('.cmt'); if (!c) return;
  const id = c.dataset.id; const a = App.doc.annot(id); if (!a) return;
  const act = e.target.closest('[data-a]')?.dataset.a;
  if (act === 'del') { deleteAnnot(id); return; }
  if (act === 'post') {
    const ta = c.querySelector('textarea[data-f="reply"]'); const text = ta.value.trim(); if (!text) return;
    const nu = structuredClone(a); nu.replies = [...(nu.replies || []), { id: uid(), author: App.author, date: new Date().toISOString(), text }];
    replaceAnnot(nu, 'Reply to comment', true, true); renderComments(); return;
  }
  if (App.sel !== id) { select(id, true); }
});
cmtEl.addEventListener('change', e => {
  if (e.target.dataset.f !== 'contents') return;
  const id = e.target.closest('.cmt').dataset.id; const a = App.doc.annot(id); if (!a) return;
  if ((a.contents || '') === e.target.value) return;
  patchAnnot(id, { contents: e.target.value }, 'Edit comment');
});
cmtEl.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (e.target.dataset.f === 'reply') e.target.closest('.cmt').querySelector('[data-a="post"]').click(); else e.target.blur(); } });
on('editComment', id => {
  if (document.getElementById('work').classList.contains('noright')) { document.getElementById('work').classList.remove('noright'); }
  editingCmt = id; if (App.sel !== id) select(id); else renderComments();
});

/* ---------- history ---------- */
export function renderHistory() {
  const d = App.doc; const el = $('history');
  if (!d) { el.innerHTML = ''; $('histinfo').textContent = ''; return; }
  Aero.renderHistory(el, d.hist, i => emit('histGo', i));
  $('histinfo').textContent = d.hist.items.length + ' states';
}
export { thumbsEl };
