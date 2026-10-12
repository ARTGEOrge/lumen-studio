// Compare two PDFs: word-level text diff (Myers O(ND)), side-by-side page view with highlighted
// insertions / deletions, a change list with navigation and a summary, plus an annotated report copy.
import { App, emit, on } from './state.js';
import { loadPdf } from './pdfjs.js';
import { esc, clamp, f2 } from './util.js';
import { progressDialog, Cancelled } from './progress.js';
import { isPdf } from './create.js';

/* ---------- text extraction with word boxes ---------- */
export async function extractWords(pdf, { onPage, cancelled } = {}) {
  const words = [], pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    if (cancelled?.()) throw new Cancelled();
    const page = await pdf.getPage(p); const v = page.view;
    pages.push({ w: v[2] - v[0], h: v[3] - v[1], view: v, rotate: page.rotate });
    const tc = await page.getTextContent();
    // characters with boxes; items that continue on the same line without a gap are joined so
    // ligatures and kerning splits ("fi" + "fteen") don't break words apart
    const chars = []; let prev = null;
    const flushWord = (buf) => { if (!buf.length) return; const t = buf.map(c => c.ch).join(''); const bx = [Math.min(...buf.map(c => c.b[0])), Math.min(...buf.map(c => c.b[1])), Math.max(...buf.map(c => c.b[2])), Math.max(...buf.map(c => c.b[3]))]; words.push({ t, k: norm(t), page: p - 1, box: bx }); };
    // reading order: cluster horizontal text into lines (top to bottom), then left to right
    let items = tc.items.filter(it => it.str !== undefined);
    if (items.every(it => Math.abs(it.transform[1]) < 1e-3 && it.transform[0] > 0)) {
      const sorted = items.slice().sort((a, b) => b.transform[5] - a.transform[5]); const lines = [];
      for (const it of sorted) { const h = it.height || 10; const l = lines[lines.length - 1]; if (l && Math.abs(l.y - it.transform[5]) < h * 0.5) l.items.push(it); else lines.push({ y: it.transform[5], items: [it] }); }
      items = lines.flatMap(l => l.items.sort((a, b) => a.transform[4] - b.transform[4]).map((it, k, arr) => k === arr.length - 1 ? { ...it, hasEOL: true } : { ...it, hasEOL: false }));
    }
    for (const it of items) {
      if (it.str === undefined) continue;
      const T = it.transform; const sx = Math.hypot(T[0], T[1]) || 1; const ux = T[0] / sx, uy = T[1] / sx; const h = it.height || Math.hypot(T[2], T[3]) || sx;
      const str = it.str; const n = str.length;
      if (!n) { if (it.hasEOL) chars.push({ ch: ' ' }); continue; }
      const cw = (it.width || sx * n * 0.5) / n;
      if (prev) { const gx = (T[4] - prev.ex) * ux + (T[5] - prev.ey) * uy, gy = Math.abs(-(T[4] - prev.ex) * uy + (T[5] - prev.ey) * ux); if (!(gy < h * 0.3 && gx > -h * 0.3 && gx < h * 0.12)) chars.push({ ch: ' ' }); }
      for (let k = 0; k < n; k++) {
        const a = k * cw, b = (k + 1) * cw;
        const pts = [[a, -0.22 * h], [b, -0.22 * h], [a, 0.88 * h], [b, 0.88 * h]].map(([x, y]) => [T[4] + ux * x - uy * y, T[5] + uy * x + ux * y]);
        chars.push({ ch: str[k], b: [Math.min(...pts.map(q => q[0])), Math.min(...pts.map(q => q[1])), Math.max(...pts.map(q => q[0])), Math.max(...pts.map(q => q[1]))] });
      }
      prev = { ex: T[4] + ux * n * cw, ey: T[5] + uy * n * cw };
      if (it.hasEOL) { chars.push({ ch: ' ' }); prev = null; }
    }
    let buf = [];
    for (const c of chars) { if (/\s/.test(c.ch) || !c.b) { flushWord(buf); buf = []; } else buf.push(c); }
    flushWord(buf);
    onPage?.(p, pdf.numPages);
  }
  return { words, pages };
}
const norm = s => s.normalize('NFKC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-');

/* ---------- Myers diff on token keys ---------- */
// returns list of [op, aIndex, bIndex] with op '=', '-', '+' ; null if too different (D > maxD)
export function myers(a, b, maxD = 4000) {
  const N = a.length, M = b.length; const max = N + M; const off = max + 1;
  let pre = 0; while (pre < N && pre < M && a[pre] === b[pre]) pre++;
  let suf = 0; while (suf < N - pre && suf < M - pre && a[N - 1 - suf] === b[M - 1 - suf]) suf++;
  const A = a.slice(pre, N - suf), B = b.slice(pre, M - suf); const n = A.length, m = B.length;
  const trace = []; let v = new Int32Array(2 * (n + m) + 3); const o = n + m + 1; let found = false, D = 0;
  outer: for (D = 0; D <= n + m; D++) {
    if (D > maxD) return null;
    trace.push(v.slice(o - D - 1, o + D + 2));
    for (let k = -D; k <= D; k += 2) {
      let x = (k === -D || (k !== D && v[o + k - 1] < v[o + k + 1])) ? v[o + k + 1] : v[o + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) { x++; y++; }
      v[o + k] = x;
      if (x >= n && y >= m) { found = true; break outer; }
    }
  }
  void off; void found;
  // backtrack
  const ops = []; let x = n, y = m;
  for (let d = D; d > 0; d--) {
    const vv = trace[d]; const base = d + 1; const get = k => vv[base + k];
    const k = x - y;
    const prevK = (k === -d || (k !== d && get(k - 1) < get(k + 1))) ? k + 1 : k - 1;
    const prevX = get(prevK), prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push(['=', pre + x - 1, pre + y - 1]); x--; y--; }
    if (x === prevX) ops.push(['+', null, pre + y - 1]); else ops.push(['-', pre + x - 1, null]);
    x = prevX; y = prevY;
  }
  while (x > 0 && y > 0) { ops.push(['=', pre + x - 1, pre + y - 1]); x--; y--; }
  ops.reverse();
  const out = []; for (let i = 0; i < pre; i++) out.push(['=', i, i]);
  out.push(...ops);
  for (let i = 0; i < suf; i++) out.push(['=', N - suf + i, M - suf + i]);
  return out;
}

// Diff two word lists -> changes [{type, del:[idx], ins:[idx], anchorOld, anchorNew}]
export function diffWords(oldW, newW) {
  let ops = myers(oldW.map(w => w.k), newW.map(w => w.k));
  if (!ops) { // very different documents: diff page by page
    ops = []; const pages = Math.max(...oldW.map(w => w.page), ...newW.map(w => w.page), 0) + 1;
    for (let p = 0; p < pages; p++) {
      const ai = [], bi = []; oldW.forEach((w, k) => w.page === p && ai.push(k)); newW.forEach((w, k) => w.page === p && bi.push(k));
      const sub = myers(ai.map(k => oldW[k].k), bi.map(k => newW[k].k), 20000) || [...ai.map((_, j) => ['-', j, null]), ...bi.map((_, j) => ['+', null, j])];
      for (const [op, x, y] of sub) ops.push([op, x == null ? null : ai[x], y == null ? null : bi[y]]);
    }
  }
  const changes = []; let cur = null, lastOld = -1, lastNew = -1;
  const flush = () => { if (cur) { cur.type = cur.del.length && cur.ins.length ? 'replace' : cur.del.length ? 'delete' : 'insert'; changes.push(cur); cur = null; } };
  for (const [op, x, y] of ops) {
    if (op === '=') { flush(); lastOld = x; lastNew = y; continue; }
    if (!cur) cur = { del: [], ins: [], anchorOld: lastOld, anchorNew: lastNew };
    if (op === '-') cur.del.push(x); else cur.ins.push(y);
  }
  flush();
  changes.forEach((c, k) => {
    c.n = k + 1;
    c.oldText = c.del.map(i => oldW[i].t).join(' '); c.newText = c.ins.map(i => newW[i].t).join(' ');
    c.oldPage = c.del.length ? oldW[c.del[0]].page : (c.anchorOld >= 0 ? oldW[c.anchorOld].page : 0);
    c.newPage = c.ins.length ? newW[c.ins[0]].page : (c.anchorNew >= 0 ? newW[c.anchorNew].page : 0);
  });
  return changes;
}
export function summarize(changes, a, b) {
  const s = { changes: changes.length, replace: 0, insert: 0, delete: 0, wordsAdded: 0, wordsRemoved: 0, pagesOld: a.pages.length, pagesNew: b.pages.length, pagesChanged: new Set() };
  for (const c of changes) { s[c.type]++; s.wordsAdded += c.ins.length; s.wordsRemoved += c.del.length; s.pagesChanged.add(c.newPage); }
  s.pagesChanged = [...s.pagesChanged].sort((x, y) => x - y);
  return s;
}
// merge word boxes on the same line into highlight rectangles
export function lineRects(boxes) {
  const out = [];
  for (const b of boxes.slice().sort((p, q) => (q[1] + q[3]) / 2 - (p[1] + p[3]) / 2 || p[0] - q[0])) {
    const h = b[3] - b[1]; const l = out[out.length - 1];
    if (l && Math.abs((l[1] + l[3]) / 2 - (b[1] + b[3]) / 2) < h * 0.4 && b[0] - l[2] < h * 1.5) { l[0] = Math.min(l[0], b[0]); l[1] = Math.min(l[1], b[1]); l[2] = Math.max(l[2], b[2]); l[3] = Math.max(l[3], b[3]); }
    else out.push(b.slice());
  }
  return out;
}

/* ---------- running a comparison ---------- */
export async function compareBytes(oldBytes, newBytes, { names = ['Original', 'Revised'], prog } = {}) {
  const pa = await loadPdf(oldBytes), pb = await loadPdf(newBytes);
  const cancelled = () => prog?.cancelled;
  const A = await extractWords(pa, { cancelled, onPage: (p, n) => prog?.set(p / n * 0.4, `Reading “${names[0]}” — page ${p} of ${n}`) });
  const B = await extractWords(pb, { cancelled, onPage: (p, n) => prog?.set(0.4 + p / n * 0.4, `Reading “${names[1]}” — page ${p} of ${n}`) });
  prog?.set(0.85, 'Comparing text…'); await new Promise(r => setTimeout(r, 20));
  const changes = diffWords(A.words, B.words);
  return { pa, pb, A, B, changes, summary: summarize(changes, A, B), names };
}

export function compareDialog() {
  const docs = App.docs.filter(d => !d.readOnly || d.pdf);
  const opt = docs.map(d => [d.id, d.name]).concat([['__file', 'Choose a file…']]);
  const cur = App.doc; const other = docs.find(d => d !== cur);
  let files = {};
  const dlg = Aero.dialog({
    title: 'Compare files', width: 520, instruction: 'Show what changed between two versions of a document',
    fields: [{ key: 'a', label: 'Original (older)', type: 'select', value: cur ? cur.id : '__file', options: opt }, { key: 'b', label: 'Revised (newer)', type: 'select', value: other ? other.id : '__file', options: opt }],
    html: '<div class="dnote">The text of both documents is compared word by word. Deleted text is highlighted in red on the original, inserted text in green on the revised version.</div>',
    ok: 'Compare',
    onOK: async v => {
      const get = async (key, label) => {
        if (v[key] !== '__file') { const d = App.docs.find(x => x.id === v[key]); return d ? { bytes: d.state.bytes, name: d.name } : null; }
        if (files[key]) return files[key];
        const f = await Aero.openFile({ accept: '.pdf,application/pdf', filters: [{ name: 'PDF documents', extensions: ['pdf'] }] });
        if (!f[0]) return null; const b = new Uint8Array(f[0].data); if (!isPdf(b)) { Aero.alert('Compare files', `“${f[0].name}” is not a PDF.`); return null; }
        return { bytes: b, name: f[0].name };
      };
      const a = await get('a', 'original'); if (!a) return; const b = await get('b', 'revised'); if (!b) return;
      runCompare(a, b);
    }
  });
  void dlg;
}
export async function runCompare(a, b) {
  const prog = progressDialog('Compare files', `Comparing “${a.name}” with “${b.name}”`);
  try {
    const res = await compareBytes(a.bytes, b.bytes, { names: [a.name, b.name], prog });
    prog.close(); res.bytesNew = b.bytes; res.bytesOld = a.bytes; openView(res); return res;
  } catch (e) { prog.close(); if (!(e instanceof Cancelled)) Aero.alert('Compare files', 'Could not compare: ' + (e.message || e)); return null; }
}

/* ---------- side-by-side view ---------- */
let VIEW = null;
export function closeCompare() {
  if (!VIEW) return; VIEW.io.disconnect(); VIEW.el.remove();
  try { VIEW.res.pa.destroy?.(); VIEW.res.pb.destroy?.(); } catch (e) { /* ignore */ }
  VIEW = null; emit('compare', false);
}
export const compareOpen = () => !!VIEW;
function openView(res) {
  closeCompare();
  const el = document.createElement('div'); el.id = 'compare';
  const s = res.summary;
  const typeLbl = { replace: 'Replaced', insert: 'Inserted', delete: 'Deleted' };
  el.innerHTML = `<div class="cmp-bar"><span class="tname">Compare</span><span class="cmp-sum"><b>${s.changes}</b> change${s.changes === 1 ? '' : 's'} · <span class="c-ins">+${s.wordsAdded} words</span> · <span class="c-del">−${s.wordsRemoved} words</span> · ${s.pagesOld} → ${s.pagesNew} pages</span>
    <span class="sep"></span><button class="aero-btn" data-c="prev" title="Previous change">◀ Prev</button><span class="cmp-pos">–</span><button class="aero-btn" data-c="next" title="Next change">Next ▶</button>
    <span class="sep"></span><button class="aero-btn" data-c="report" title="Open the revised document with the changes marked as comments">Annotated Report</button><button class="aero-btn" data-c="close">Close</button></div>
    <div class="cmp-body"><div class="cmp-list aero-list"></div>
    <div class="cmp-col" data-side="a"><div class="cmp-head">Original — ${esc(res.names[0])}</div><div class="cmp-pages"></div></div>
    <div class="cmp-col" data-side="b"><div class="cmp-head">Revised — ${esc(res.names[1])}</div><div class="cmp-pages"></div></div></div>`;
  document.getElementById('work').appendChild(el);
  const list = el.querySelector('.cmp-list');
  const summaryHtml = `<div class="cmp-summary"><div class="big">${s.changes ? s.changes + ' difference' + (s.changes === 1 ? '' : 's') : 'No text differences'}</div>
    <div>${s.replace} replaced · ${s.insert} inserted · ${s.delete} deleted</div><div>${s.wordsAdded} words added, ${s.wordsRemoved} removed</div>
    <div>${s.pagesChanged.length ? 'Pages with changes (revised): ' + s.pagesChanged.map(p => p + 1).join(', ') : ''}</div>${s.pagesOld !== s.pagesNew ? `<div>Page count changed: ${s.pagesOld} → ${s.pagesNew}</div>` : ''}</div>`;
  list.innerHTML = summaryHtml + res.changes.map((c, k) => `<div class="aero-item cmp-item t-${c.type}" data-k="${k}"><div class="cmp-n">${c.n}</div><div class="grow"><div class="cmp-t">${typeLbl[c.type]} <span class="dim">· p.${(c.type === 'delete' ? c.oldPage : c.newPage) + 1}</span></div>${c.del.length ? `<div class="c-del">${esc(trunc(c.oldText))}</div>` : ''}${c.ins.length ? `<div class="c-ins">${esc(trunc(c.newText))}</div>` : ''}</div></div>`).join('');
  VIEW = { el, res, cur: -1, rendered: new Set(), io: null };
  // page shells
  const cols = { a: el.querySelector('[data-side="a"] .cmp-pages'), b: el.querySelector('[data-side="b"] .cmp-pages') };
  const io = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) renderShell(e.target); }, { root: el.querySelector('.cmp-body'), rootMargin: '400px' });
  VIEW.io = io;
  for (const side of ['a', 'b']) {
    const info = side === 'a' ? res.A.pages : res.B.pages;
    info.forEach((pg, i) => {
      const sh = document.createElement('div'); sh.className = 'cmp-page'; sh.dataset.side = side; sh.dataset.i = i;
      sh.style.aspectRatio = `${pg.rotate % 180 ? pg.h : pg.w} / ${pg.rotate % 180 ? pg.w : pg.h}`;
      sh.innerHTML = `<div class="cmp-pn">${i + 1}</div><div class="cmp-hl"></div>`;
      cols[side].appendChild(sh); io.observe(sh);
    });
  }
  drawHighlights();
  el.addEventListener('click', e => {
    const c = e.target.closest('[data-c]')?.dataset.c;
    if (c === 'close') closeCompare(); else if (c === 'next') go(VIEW.cur + 1); else if (c === 'prev') go(VIEW.cur - 1); else if (c === 'report') annotatedReport(res);
    const it = e.target.closest('.cmp-item'); if (it) go(+it.dataset.k);
    const hl = e.target.closest('.cmp-hl > div[data-k]'); if (hl) go(+hl.dataset.k, true);
  });
  el.tabIndex = 0; el.focus();
  el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeCompare(); } else if (e.key === 'ArrowDown' || e.key === 'F8') { e.preventDefault(); go(VIEW.cur + 1); } else if (e.key === 'ArrowUp' || e.key === 'F7') { e.preventDefault(); go(VIEW.cur - 1); } });
  updatePos(); emit('compare', true);
  if (res.changes.length) setTimeout(() => go(0), 50);
}
const trunc = s => s.length > 140 ? s.slice(0, 137) + '…' : s;
async function renderShell(sh) {
  if (!VIEW || sh.dataset.done) return; sh.dataset.done = '1';
  const pdf = sh.dataset.side === 'a' ? VIEW.res.pa : VIEW.res.pb;
  try {
    const page = await pdf.getPage(+sh.dataset.i + 1);
    const w = sh.clientWidth || 400; const v1 = page.getViewport({ scale: 1 }); const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale: w / v1.width * dpr });
    const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvas: c, viewport: vp }).promise;
    if (!VIEW) return; sh.prepend(c); sh.querySelector('.cmp-pn')?.remove();
  } catch (e) { /* closed while rendering */ }
}
function pct(side, i, r) {
  const info = (side === 'a' ? VIEW.res.A : VIEW.res.B).pages[i]; const [vx1, vy1, vx2, vy2] = info.view; const w = vx2 - vx1, h = vy2 - vy1;
  // rotation-aware mapping (matches pdf.js viewport)
  const rot = info.rotate % 360; const pts = [[r[0], r[1]], [r[2], r[3]]].map(([x, y]) => { const u = (x - vx1) / w, v = (vy2 - y) / h; return rot === 90 ? [1 - v, u] : rot === 180 ? [1 - u, 1 - v] : rot === 270 ? [v, 1 - u] : [u, v]; });
  const x1 = Math.min(pts[0][0], pts[1][0]), x2 = Math.max(pts[0][0], pts[1][0]), y1 = Math.min(pts[0][1], pts[1][1]), y2 = Math.max(pts[0][1], pts[1][1]);
  return `left:${f2(x1 * 100)}%;top:${f2(y1 * 100)}%;width:${f2((x2 - x1) * 100)}%;height:${f2((y2 - y1) * 100)}%`;
}
function drawHighlights() {
  const { res, el } = VIEW;
  el.querySelectorAll('.cmp-hl').forEach(h => h.innerHTML = '');
  const put = (side, page, html) => { const sh = el.querySelector(`.cmp-page[data-side="${side}"][data-i="${page}"] .cmp-hl`); if (sh) sh.insertAdjacentHTML('beforeend', html); };
  res.changes.forEach((c, k) => {
    const on = k === VIEW.cur ? ' on' : '';
    const group = (side, idxs, words, cls) => {
      const byPage = new Map(); for (const i of idxs) { const w = words[i]; if (!byPage.has(w.page)) byPage.set(w.page, []); byPage.get(w.page).push(w.box); }
      for (const [p, boxes] of byPage) for (const r of lineRects(boxes)) put(side, p, `<div class="${cls}${on}" data-k="${k}" style="${pct(side, p, [r[0] - 1, r[1] - 1, r[2] + 1, r[3] + 1])}" title="${c.n}. ${esc(c.type)}"></div>`);
    };
    group('a', c.del, res.A.words, 'h-del'); group('b', c.ins, res.B.words, 'h-ins');
    // caret where text was inserted / deleted
    if (!c.del.length && c.anchorOld >= 0) { const w = res.A.words[c.anchorOld]; put('a', w.page, `<div class="h-caret${on}" data-k="${k}" style="${pct('a', w.page, [w.box[2], w.box[1], w.box[2] + 2, w.box[3]])}"></div>`); }
    if (!c.ins.length && c.anchorNew >= 0) { const w = res.B.words[c.anchorNew]; put('b', w.page, `<div class="h-caret del${on}" data-k="${k}" style="${pct('b', w.page, [w.box[2], w.box[1], w.box[2] + 2, w.box[3]])}"></div>`); }
  });
}
function updatePos() { const n = VIEW.res.changes.length; VIEW.el.querySelector('.cmp-pos').textContent = n ? `${VIEW.cur + 1 || '–'} of ${n}` : 'no changes'; }
function go(k, fromPage) {
  if (!VIEW) return; const n = VIEW.res.changes.length; if (!n) return;
  k = clamp(k, 0, n - 1); VIEW.cur = k; const c = VIEW.res.changes[k];
  VIEW.el.querySelectorAll('.cmp-hl .on').forEach(x => x.classList.remove('on'));
  VIEW.el.querySelectorAll(`.cmp-hl [data-k="${k}"]`).forEach(x => x.classList.add('on'));
  VIEW.el.querySelectorAll('.cmp-item.sel').forEach(x => x.classList.remove('sel'));
  const it = VIEW.el.querySelector(`.cmp-item[data-k="${k}"]`); if (it) { it.classList.add('sel'); it.scrollIntoView({ block: 'nearest' }); }
  updatePos();
  if (fromPage) return;
  for (const side of ['a', 'b']) {
    const col = VIEW.el.querySelector(`.cmp-col[data-side="${side}"]`);
    const target = VIEW.el.querySelector(`.cmp-hl [data-k="${k}"]`) && [...VIEW.el.querySelectorAll(`.cmp-page[data-side="${side}"] .cmp-hl [data-k="${k}"]`)][0];
    const page = VIEW.el.querySelector(`.cmp-page[data-side="${side}"][data-i="${side === 'a' ? c.oldPage : c.newPage}"]`);
    const ref = target || page; if (!ref) continue;
    const cr = col.getBoundingClientRect(), rr = ref.getBoundingClientRect();
    col.scrollTop += rr.top - cr.top - col.clientHeight * 0.35;
  }
}

/* ---------- annotated report ---------- */
export async function annotatedReport(res) {
  const annots = [];
  const when = new Date().toISOString();
  for (const c of res.changes) {
    if (c.ins.length) {
      const byPage = new Map(); for (const i of c.ins) { const w = res.B.words[i]; if (!byPage.has(w.page)) byPage.set(w.page, []); byPage.get(w.page).push(w.box); }
      let first = true;
      for (const [p, boxes] of byPage) {
        const quads = lineRects(boxes).map(([x1, y1, x2, y2]) => [x1, y2, x2, y2, x1, y1, x2, y1].map(v => +f2(v)));
        annots.push({ pageIndex: p, type: 'highlight', quads, color: c.type === 'replace' ? '#ffb347' : '#7ee36b', opacity: 0.55, author: 'Compare', date: when, quote: c.newText,
          contents: first ? (c.type === 'replace' ? `Replaced: “${trunc(c.oldText)}”` : 'Inserted text') : '' });
        first = false;
      }
    } else if (c.anchorNew >= 0) {
      const w = res.B.words[c.anchorNew];
      annots.push({ pageIndex: w.page, type: 'note', x: w.box[2] + 1, y: w.box[3] + 2, color: '#ff8a8a', opacity: 1, author: 'Compare', date: when, contents: `Deleted: “${trunc(c.oldText)}”` });
    }
  }
  const name = Aero.baseName(res.names[1]) + ' (compared).pdf';
  emit('openReport', { bytes: res.bytesNew, name, annots });
}
