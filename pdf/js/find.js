// Find in document: match case / whole word, next/previous, highlights on the text layer.
import { App, emit } from './state.js';
import { V, goTo, drawAllHighlights, whenRendered, vp } from './viewer.js';

const $ = id => document.getElementById(id);
const bar = $('findbar'), q = $('fd-q'), cnt = $('fd-count');
let runId = 0, tmr = 0;

export function openFind() {
  if (!App.doc) return;
  bar.hidden = false; q.focus(); q.select();
  if (q.value && !App.find.matches.length) search();
}
export function closeFind() {
  bar.hidden = true; App.find.matches = []; App.find.cur = -1; App.find.q = ''; cnt.textContent = ''; drawAllHighlights();
  document.getElementById('scroller').focus();
}
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export async function search(query = q.value, opts = {}) {
  const d = App.doc; if (!d) return [];
  const F = App.find; F.q = query; F.matchCase = opts.matchCase ?? $('fd-case').checked; F.word = opts.word ?? $('fd-word').checked;
  F.matches = []; F.cur = -1; const my = ++runId;
  if (!query) { cnt.textContent = ''; drawAllHighlights(); return []; }
  // treat runs of whitespace in the query as flexible whitespace
  let src = query.trim().split(/\s+/).map(escRe).join('\\s*');
  if (F.word) src = `(?<![\\p{L}\\p{N}_])${src}(?![\\p{L}\\p{N}_])`;
  const re = new RegExp(src, 'gu' + (F.matchCase ? '' : 'i'));
  cnt.textContent = 'Searching…';
  for (let i = 0; i < d.numPages; i++) {
    if (i % 12 === 0) for (let k = i; k < Math.min(d.numPages, i + 24); k++) d.getText(k); // prefetch in parallel
    const t = await d.getText(i); if (my !== runId) return F.matches;
    re.lastIndex = 0; let m;
    while ((m = re.exec(t.str))) { if (!m[0].length) { re.lastIndex++; continue; } F.matches.push({ page: i, start: m.index, end: m.index + m[0].length }); }
    if (F.matches.length && F.cur < 0) { F.cur = firstFrom(V.cur); show(); }
    if (i % 20 === 19) cnt.textContent = `${F.matches.length} found…`;
  }
  if (F.cur < 0 && F.matches.length) F.cur = firstFrom(V.cur);
  updateCount(); drawAllHighlights();
  if (F.matches.length) show(); else cnt.textContent = 'No matches';
  emit('find');
  return F.matches;
}
function firstFrom(page) { const k = App.find.matches.findIndex(m => m.page >= page); return k < 0 ? 0 : k; }
function updateCount() { const F = App.find; cnt.textContent = F.matches.length ? `${F.cur + 1} of ${F.matches.length}` : (F.q ? 'No matches' : ''); }
export async function step(dir) {
  const F = App.find;
  if (!F.matches.length) { if (q.value) await search(); return; }
  F.cur = (F.cur + dir + F.matches.length) % F.matches.length; show();
}
async function show() {
  const F = App.find, m = F.matches[F.cur]; if (!m) return;
  updateCount();
  const d = App.doc;
  // scroll so the match is visible: approximate its y using the text item transform
  const t = await d.getText(m.page);
  let k = t.starts.findIndex((s, j) => s <= m.start && m.start < s + Math.max(1, t.items[j].str.length));
  const it = t.items[Math.max(0, k)];
  const top = it ? it.transform[5] + (it.height || 12) * 2.5 : null;
  goTo(m.page, top != null && App.doc.view.rot === 0 && d.info[m.page].rotate === 0 ? top : null, true);
  await whenRendered(m.page);
  drawAllHighlights();
}
q.addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => search(), 250); });
q.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
  else if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
$('fd-next').onclick = () => step(1); $('fd-prev').onclick = () => step(-1); $('fd-close').onclick = closeFind;
$('fd-case').onchange = () => search(); $('fd-word').onchange = () => search();
export { vp };
