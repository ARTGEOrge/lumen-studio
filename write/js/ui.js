'use strict';
/* Lumen Write — user interface: menus, command bar, side panels, dialogs, status bar, zoom, pictures. */
const UI = (() => {
  const esc = Aero.esc;
  const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
  let units = 'cm';
  try { units = localStorage.getItem('lw-units') || (navigator.language === 'en-US' ? 'in' : 'cm'); S.author = localStorage.getItem('lw-author') || 'You'; } catch (e) { }
  const toU = pt => units === 'in' ? Math.round(pt / 72 * 100) / 100 : Math.round(pt / 72 * 2.54 * 100) / 100;
  const fromU = v => units === 'in' ? v * 72 : v / 2.54 * 72;

  /* ---------------- command bar ---------------- */
  const ic = {
    alignLeft: '<path d="M2 3h12M2 6.5h8M2 10h12M2 13.5h8"/>', alignCenter: '<path d="M2 3h12M4 6.5h8M2 10h12M4 13.5h8"/>', alignRight: '<path d="M2 3h12M6 6.5h8M2 10h12M6 13.5h8"/>', justify: '<path d="M2 3h12M2 6.5h12M2 10h12M2 13.5h12"/>',
    ul: '<circle cx="3" cy="4" r="1.1" fill="#fff"/><circle cx="3" cy="8" r="1.1" fill="#fff"/><circle cx="3" cy="12" r="1.1" fill="#fff"/><path d="M6.5 4H14M6.5 8H14M6.5 12H14"/>',
    ol: '<path d="M2.3 2.8h1v3M2 9.2c.3-.6 1.8-.6 1.8.3 0 .7-1.8 1.4-1.8 2.3h2M6.5 4H14M6.5 8H14M6.5 12H14"/>',
    outdent: '<path d="M7 4h7M7 8h7M7 12h7M5 5.5 2.5 8 5 10.5"/>', indent: '<path d="M7 4h7M7 8h7M7 12h7M2.5 5.5 5 8l-2.5 2.5"/>',
    table: '<rect x="2" y="3" width="12" height="10" rx="1"/><path d="M2 6.5h12M2 10h12M6 3v10M10 3v10"/>',
    image: '<rect x="2" y="3" width="12" height="10" rx="1"/><circle cx="6" cy="6.5" r="1.3"/><path d="m2.5 12 4-4 3 3 2-2 2.5 2.5"/>',
    link: '<path d="M7 9a2.5 2.5 0 0 0 3.5 0l2-2a2.5 2.5 0 0 0-3.5-3.5L8 4.5M9 7a2.5 2.5 0 0 0-3.5 0l-2 2A2.5 2.5 0 0 0 7 12.5L8 11.5"/>',
    fn: '<path d="M3 13V5.5a2.5 2.5 0 0 1 4.5-1.5M2 8h4"/><path d="M10 3.5h3l-2 3.5a1.6 1.6 0 1 1-1.4 2.4" stroke-width="1.3"/>',
    comment: '<path d="M2.5 3h11v7.5H7l-3.5 3v-3h-1z"/>',
    clear: '<path d="M4 13h5M6 3l-2 10M4 3h7M10 9l4 4M14 9l-4 4"/>',
    find: '<circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.6 3.6"/>',
  };
  const btn = (id, title, inner, cls = '') => `<button class="aero-btn small ${cls}" id="${id}" title="${esc(title)}">${inner.startsWith('<path') || inner.startsWith('<rect') || inner.startsWith('<circle') ? `<svg viewBox="0 0 16 16">${inner}</svg>` : inner}</button>`;
  function buildCmd() {
    const fonts = Fonts.names.map(f => `<option value="${esc(f)}" style="font-family:'${esc(f)}'">${esc(f)}</option>`).join('');
    $('#cmd').innerHTML = `
      <div class="cg"><select id="c-style" title="Paragraph style"></select></div>
      <div class="cg"><select id="c-font" title="Font">${fonts}</select><input id="c-size" type="text" list="sizes" title="Font size (pt)" aria-label="Font size"></div>
      <div class="cg">${btn('c-b', 'Bold (Ctrl+B)', '<span class="gl">B</span>')}${btn('c-i', 'Italic (Ctrl+I)', '<span class="gl" style="font-style:italic;font-family:Georgia,serif">I</span>')}${btn('c-u', 'Underline (Ctrl+U)', '<span class="gl" style="text-decoration:underline">U</span>')}${btn('c-s', 'Strikethrough', '<span class="gl" style="text-decoration:line-through">S</span>')}${btn('c-sup', 'Superscript', '<span class="gl" style="font-size:11px">x²</span>')}${btn('c-sub', 'Subscript', '<span class="gl" style="font-size:11px">x₂</span>')}</div>
      <div class="cg"><button class="aero-btn small colbtn" title="Font color"><span class="gl">A</span><span class="bar" id="c-colbar" style="background:#c00000"></span><input type="color" id="c-color" value="#c00000" aria-label="Font color"></button>
        <button class="aero-btn small colbtn" title="Highlight color"><svg viewBox="0 0 16 16"><path d="m4 10 5.5-6.5 2.5 2.5L5.5 12H4z"/><path d="M3 14h4"/></svg><span class="bar" id="c-hlbar" style="background:#fff176"></span><input type="color" id="c-hl" value="#fff176" aria-label="Highlight color"></button>
        ${btn('c-clear', 'Clear formatting (Ctrl+Space)', ic.clear)}</div>
      <div class="cg">${btn('c-al-left', 'Align left (Ctrl+L)', ic.alignLeft)}${btn('c-al-center', 'Center (Ctrl+E)', ic.alignCenter)}${btn('c-al-right', 'Align right (Ctrl+R)', ic.alignRight)}${btn('c-al-justify', 'Justify (Ctrl+J)', ic.justify)}</div>
      <div class="cg">${btn('c-ul', 'Bullets', ic.ul)}${btn('c-ol', 'Numbering', ic.ol)}${btn('c-out', 'Decrease indent', ic.outdent)}${btn('c-in', 'Increase indent', ic.indent)}</div>
      <div class="cg">${btn('c-table', 'Insert table…', ic.table)}${btn('c-img', 'Insert picture…', ic.image)}${btn('c-link', 'Insert link… (Ctrl+K)', ic.link)}${btn('c-fn', 'Insert footnote (Ctrl+Alt+F)', ic.fn)}${btn('c-cmt', 'New comment (Ctrl+Alt+M)', ic.comment)}${btn('c-find', 'Find and replace (Ctrl+H)', ic.find)}</div>
      <div class="cg"><button class="aero-btn small trk" id="c-track" title="Track changes (Ctrl+Shift+E)">Track Changes</button></div>`;
    const dl = document.createElement('datalist'); dl.id = 'sizes'; dl.innerHTML = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72].map(s => `<option>${s}</option>`).join(''); document.body.appendChild(dl);
    // keep the editor selection when clicking toolbar buttons
    $('#cmd').addEventListener('mousedown', e => { if (e.target.closest('button') && !e.target.closest('input')) e.preventDefault(); });
    const on = (id, fn) => { $(id).onclick = () => { fn(); }; };
    on('#c-b', () => Ed.toggle('b')); on('#c-i', () => Ed.toggle('i')); on('#c-u', () => Ed.toggle('u')); on('#c-s', () => Ed.toggle('s')); on('#c-sup', () => Ed.toggle('sup')); on('#c-sub', () => Ed.toggle('sub'));
    on('#c-clear', () => Ed.clearFormatting());
    ['left', 'center', 'right', 'justify'].forEach(a => on('#c-al-' + a, () => Ed.align(a)));
    on('#c-ul', () => Ed.toggleList('ul')); on('#c-ol', () => Ed.toggleList('ol'));
    on('#c-out', () => Ed.indent(-1)); on('#c-in', () => Ed.indent(1));
    on('#c-table', tableDialog); on('#c-img', pictureFromFile); on('#c-link', linkDialog); on('#c-fn', () => Ed.footnote()); on('#c-cmt', () => Review.addComment()); on('#c-find', () => Find.open(true));
    on('#c-track', toggleTrack);
    let saved = null;
    const keepSel = () => { saved = Sel.save(); };
    const backSel = () => { S.ed.focus(); if (saved) Sel.restore(saved); };
    for (const id of ['#c-style', '#c-font', '#c-size', '#c-color', '#c-hl']) { $(id).addEventListener('mousedown', keepSel); $(id).addEventListener('focus', () => { if (!saved) keepSel(); }); }
    $('#c-style').onchange = e => { backSel(); Ed.paraStyle(e.target.value); saved = null; };
    $('#c-font').onchange = e => { backSel(); Ed.setRunProp('font', e.target.value, 'Font'); saved = null; };
    const applySize = () => { const v = parseFloat($('#c-size').value); if (!(v >= 4 && v <= 400)) return; backSel(); Ed.setRunProp('size', v, 'Font Size'); saved = null; };
    $('#c-size').addEventListener('change', applySize);
    $('#c-size').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); applySize(); } });
    $('#c-color').addEventListener('input', e => { $('#c-colbar').style.background = e.target.value; });
    $('#c-color').addEventListener('change', e => { backSel(); Ed.setRunProp('color', e.target.value, 'Font Color'); saved = null; });
    $('#c-hl').addEventListener('input', e => { $('#c-hlbar').style.background = e.target.value; });
    $('#c-hl').addEventListener('change', e => { backSel(); Ed.setRunProp('bg', e.target.value, 'Highlight'); saved = null; });
  }
  function fillStyleSelect() {
    const sel = $('#c-style'); const cur = sel.value;
    const order = ['Normal', 'Title', 'Subtitle', 'Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5', 'Heading6', 'Quote', 'Caption', 'Code'];
    const ids = [...order.filter(k => S.doc.styles.para[k]), ...Object.keys(S.doc.styles.para).filter(k => !order.includes(k))];
    sel.innerHTML = ids.map(id => `<option value="${esc(id)}">${esc(S.doc.styles.para[id].name || id)}</option>`).join('');
    sel.value = cur;
  }
  function syncCmd() {
    const f = Ed.formatInfo(); if (!f) return;
    const sel = $('#c-style'); if (document.activeElement !== sel) sel.value = S.doc.styles.para[f.style] ? f.style : 'Normal';
    if (document.activeElement !== $('#c-font')) $('#c-font').value = Fonts.names.includes(f.font) ? f.font : '';
    if (document.activeElement !== $('#c-size')) $('#c-size').value = f.size;
    for (const k of ['b', 'i', 'u', 's', 'sup', 'sub']) $('#c-' + k).classList.toggle('on', !!f[k]);
    for (const a of ['left', 'center', 'right', 'justify']) $('#c-al-' + a).classList.toggle('on', f.align === a);
    $('#c-ul').classList.toggle('on', f.list === 'ul'); $('#c-ol').classList.toggle('on', f.list === 'ol');
  }

  /* ---------------- status, panels ---------------- */
  let wordsTimer = 0;
  function counts(selOnly) {
    const txt = selOnly ? getSelection().toString() : textForCount();
    const words = (txt.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu) || []).length;
    return { words, chars: txt.replace(/\n/g, '').length, charsNoSpace: txt.replace(/\s/g, '').length, paras: selOnly ? 0 : S.ed.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li').length };
  }
  function textForCount() {
    let s = ''; const w = document.createTreeWalker(S.ed, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentNode.closest('.toc,.pg-gap,sup.fn,del') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    for (let n = w.nextNode(); n; n = w.nextNode()) s += n.nodeValue + (n.nextSibling ? '' : ' ');
    return s;
  }
  function status() {
    const r = Sel.range();
    if (r) { const rect = (r.getClientRects()[0] || r.startContainer.parentElement?.getBoundingClientRect?.()); if (rect) S.curPage = Pager.pageOfClientY(rect.top + 2); }
    $('#st-page').textContent = `Page ${S.curPage + 1} of ${S.pages}`;
    clearTimeout(wordsTimer);
    wordsTimer = setTimeout(() => {
      const s = getSelection(); const sel = s.rangeCount && !s.isCollapsed && S.ed.contains(s.anchorNode);
      const c = counts(false);
      $('#st-words').textContent = sel ? `${counts(true).words.toLocaleString()} of ${c.words.toLocaleString()} words` : `${c.words.toLocaleString()} words`;
      docInfo(c);
    }, 150);
    const t = $('#st-track'); t.textContent = 'Track Changes: ' + (S.track ? 'On' : 'Off'); t.classList.toggle('on', S.track);
    $('#c-track').classList.toggle('on', S.track); $('#rv-track').checked = S.track;
    $('#z-val').textContent = Math.round(S.zoom * 100) + '%'; $('#z-range').value = Math.round(S.zoom * 100);
  }
  function docInfo(c) {
    const pg = S.doc.page;
    $('#docinfo').innerHTML = `<b>${esc(S.doc.meta.title || S.name)}</b><br>${S.pages} page${S.pages === 1 ? '' : 's'} · ${c.words.toLocaleString()} words<br>${esc(pg.size === 'Custom' ? `${toU(pg.w)} × ${toU(pg.h)} ${units}` : pg.size)}${pg.w > pg.h ? ', landscape' : ''} · margins ${toU(pg.mt)} ${units}<br>${Object.keys(S.doc.comments).length ? `${S.ed.querySelectorAll('span.cm').length ? Review.commentAnchors().size : 0} comments · ` : ''}${Review.all().length} tracked changes`;
  }
  let panelPend = 0;
  function refresh(rebuild) {
    if (!S.doc) return;
    syncCmd(); status();
    if (rebuild) fillStyleSelect();
    if (!panelPend) panelPend = requestAnimationFrame(() => { panelPend = 0; panels(rebuild); });
  }
  let lastNav = '', lastStyles = '', lastReview = '';
  function panels(force) {
    const tab = $('#tabs .on').dataset.p;
    if (tab === 'nav' || force) nav();
    if (tab === 'styles' || force) stylesPanel(force);
    if (tab === 'review' || force) reviewPanel();
  }
  function nav() {
    const toc = Pager.last.toc;
    const heads = [...S.ed.querySelectorAll('h1,h2,h3,[data-s="Heading1"],[data-s="Heading2"],[data-s="Heading3"],[data-s="Title"]')].filter(h => !h.closest('.toc'));
    const pageOf = h => Pager.pageOfClientY(h.getBoundingClientRect().top + 1) + (S.doc.page.start || 1);
    const items = heads.map((h, i) => ({ i, lv: Styles.idOf(h) === 'Title' ? 1 : +(/\d/.exec(Styles.idOf(h)) || [1])[0], t: Pager.textOf(h) || '(empty heading)', pg: pageOf(h) }));
    const key = JSON.stringify(items);
    if (key === lastNav) return; lastNav = key;
    $('#nav-n').textContent = items.length ? items.length + '' : '';
    $('#nav').innerHTML = items.length ? items.map(x => `<div class="aero-item lv${x.lv}" data-i="${x.i}"><span class="grow">${esc(x.t)}</span><span class="pg">${x.pg}</span></div>`).join('') : '<div class="empty">Headings you add (Heading 1–3) appear here. Click one to jump to it.</div>';
    $('#nav').onclick = e => { const it = e.target.closest('.aero-item'); if (!it) return; const h = heads[+it.dataset.i]; if (!h) return; jumpTo(h); };
    void toc;
  }
  function jumpTo(el) { S.ed.focus(); Ed.placeCaretIn(el, 'start'); const sc = $('#scroller'); const r = el.getBoundingClientRect(), sr = sc.getBoundingClientRect(); sc.scrollTop += r.top - sr.top - 60; refresh(); }
  function stylesPanel(force) {
    const key = JSON.stringify(S.doc.styles) + (Ed.formatInfo()?.style || '') + (Ed.formatInfo()?.cs || '');
    if (key === lastStyles && !force) return; lastStyles = key;
    const cur = Ed.formatInfo();
    const order = ['Normal', 'Title', 'Subtitle', 'Heading1', 'Heading2', 'Heading3', 'Heading4', 'Heading5', 'Heading6', 'Quote', 'Caption', 'Code'];
    const ids = [...order.filter(k => S.doc.styles.para[k]), ...Object.keys(S.doc.styles.para).filter(k => !order.includes(k))];
    $('#pstyles').innerHTML = ids.map(id => { const s = S.doc.styles.para[id]; return `<div class="aero-item${cur && cur.style === id ? ' sel' : ''}" data-id="${esc(id)}"><span class="prev" style="font-family:${esc(Fonts.css(s.font || S.doc.styles.para.Normal.font)).replace(/"/g, "'")};font-size:${Math.min(15, Math.max(10, (s.size || 11) * 0.85))}pt;font-weight:${s.b ? 700 : 400};font-style:${s.i ? 'italic' : 'normal'};color:${esc(s.color || '#1f2328')}">${esc(s.name || id)}</span><span class="k">${s.size || ''}pt</span></div>`; }).join('');
    $('#cstyles').innerHTML = `<div class="aero-item${cur && !cur.cs ? ' sel' : ''}" data-id=""><span class="grow dim">Default (none)</span></div>` + Object.entries(S.doc.styles.char).map(([id, s]) => `<div class="aero-item${cur && cur.cs === id ? ' sel' : ''}" data-id="${esc(id)}"><span class="grow" style="${s.font ? `font-family:${esc(Fonts.css(s.font)).replace(/"/g, "'")};` : ''}font-weight:${s.b ? 700 : 400};font-style:${s.i ? 'italic' : 'normal'};${s.color ? `color:${esc(s.color)};` : ''}${s.caps ? 'font-variant:small-caps;' : ''}${s.bg ? `background:${esc(s.bg)};` : ''}">${esc(s.name || id)}</span></div>`).join('');
  }
  function reviewPanel() {
    const ch = Review.changes();
    const anchors = Review.commentAnchors();
    const key = JSON.stringify([ch.map(c => [c.kind, c.author, c.text]), [...anchors.keys()].map(id => S.doc.comments[id])]);
    if (key === lastReview) return; lastReview = key;
    $('#rv-n').textContent = ch.length || '';
    $('#cm-n').textContent = anchors.size || '';
    $('#changes').innerHTML = ch.length ? ch.map((c, i) => `<div class="aero-item" data-i="${i}"><div><span class="k ${c.kind === 'Inserted' ? 'ins' : 'del'}">${c.kind}</span> <span class="m">· ${esc(c.author)} · ${esc(Review.fmtDate(c.date))}</span></div><div class="x">${esc(c.text.slice(0, 160))}</div></div>`).join('') : `<div class="empty">${S.track ? 'Changes you make now are recorded.' : 'No tracked changes. Turn on Track Changes to record edits for review.'}</div>`;
    $('#changes').onclick = e => { const it = e.target.closest('.aero-item'); if (!it) return; $('#changes .sel')?.classList.remove('sel'); it.classList.add('sel'); Review.select(ch[+it.dataset.i].el); };
    $('#changes').ondblclick = e => { const it = e.target.closest('.aero-item'); if (it) Review.act(true); };
    $('#comments').innerHTML = anchors.size ? [...anchors.keys()].map(id => { const c = S.doc.comments[id]; return `<div class="aero-item" data-id="${esc(id)}"><div class="m"><b>${esc(c.author)}</b> · ${esc(Review.fmtDate(c.date))}</div><div class="x">${esc(c.text)}</div></div>`; }).join('') : '<div class="empty">Select text and click New Comment to start a discussion.</div>';
    $('#comments').onclick = e => { const it = e.target.closest('.aero-item'); if (!it) return; $('#comments .sel')?.classList.remove('sel'); it.classList.add('sel'); Review.selectComment(it.dataset.id); };
    $('#comments').ondblclick = e => { const it = e.target.closest('.aero-item'); if (it) Review.editComment(it.dataset.id); };
  }
  function showTab(p) { document.querySelectorAll('#tabs .aero-tab').forEach(t => t.classList.toggle('on', t.dataset.p === p)); document.querySelectorAll('.tabpane').forEach(t => t.hidden = t.id !== 'tp-' + p); lastNav = lastStyles = lastReview = ''; panels(); }

  /* ---------------- zoom & canvas ---------------- */
  function layoutCanvas() {
    const g = Pager.G(); const pages = $('#pages');
    const withB = pages.classList.contains('with-balloons');
    const w = g.W + (withB ? 250 : 0), h = S.pages * g.pitch - Pager.GAP;
    pages.style.transform = `scale(${S.zoom})`;
    $('#balloons').style.left = (g.W + 16) + 'px';
    const cv = $('#canvas'); cv.style.width = Math.ceil(w * S.zoom) + 'px'; cv.style.height = Math.ceil(h * S.zoom) + 'px';
  }
  function setZoom(z, quiet) {
    const sc = $('#scroller'); const old = S.zoom;
    const midY = (sc.scrollTop + sc.clientHeight / 2) / old;
    S.zoom = Aero.clamp(Math.round(z * 100) / 100, 0.25, 3);
    layoutCanvas();
    if (!quiet) { sc.scrollTop = midY * S.zoom - sc.clientHeight / 2; status(); placeImgSel(); }
  }
  function zoomStep(d) { const i = ZOOMS.findIndex(z => z >= S.zoom - 0.001); let n = d > 0 ? ZOOMS.find(z => z > S.zoom + 0.001) : [...ZOOMS].reverse().find(z => z < S.zoom - 0.001); setZoom(n || S.zoom); void i; }
  function fitWidth() { const g = Pager.G(); const sc = $('#scroller'); const extra = $('#pages').classList.contains('with-balloons') ? 250 : 0; setZoom((sc.clientWidth - 48) / (g.W + extra)); }
  function fitPage() { const g = Pager.G(); const sc = $('#scroller'); setZoom(Math.min((sc.clientWidth - 48) / g.W, (sc.clientHeight - 44) / g.H)); const top = S.curPage * g.pitch * S.zoom; sc.scrollTop = top; }
  function afterLayout() { layoutCanvas(); Review.renderBalloons(); layoutCanvas(); placeImgSel(); }
  function applyView(noLayout) {
    S.ed.classList.toggle('final', S.markup === 'final');
    S.ed.classList.toggle('marks', !!S.marks);
    S.ed.spellcheck = !!S.spell;
    $('#rv-markup').value = S.markup;
    if (!noLayout) { Pager.run(); refresh(true); }
  }
  function scrollToCaret(top) { const sc = $('#scroller'); if (top) sc.scrollTop = 0; }

  /* ---------------- pictures: select & resize ---------------- */
  let selImg = null;
  function placeImgSel() {
    const box = $('#imgsel');
    if (!selImg || !selImg.isConnected) { box.hidden = true; selImg = null; return; }
    const pr = $('#pages').getBoundingClientRect(), r = selImg.getBoundingClientRect();
    box.hidden = false;
    Object.assign(box.style, { left: (r.left - pr.left) / S.zoom + 'px', top: (r.top - pr.top) / S.zoom + 'px', width: r.width / S.zoom + 'px', height: r.height / S.zoom + 'px' });
  }
  function selectImg(img) {
    selImg = img; placeImgSel();
    if (img) { const rg = document.createRange(); rg.selectNode(img); const s = getSelection(); s.removeAllRanges(); s.addRange(rg); }
  }
  function initImg() {
    S.ed.addEventListener('mousedown', e => { if (e.target.nodeName === 'IMG') { e.preventDefault(); S.ed.focus(); selectImg(e.target); } else if (selImg) { selImg = null; placeImgSel(); } });
    S.ed.addEventListener('dblclick', e => { if (e.target.nodeName === 'IMG') pictureDialog(e.target); });
    document.addEventListener('selectionchange', () => { if (selImg) { const r = Sel.range(); if (!r || r.collapsed || !r.intersectsNode(selImg)) { selImg = null; placeImgSel(); } } });
    $('#imgsel').addEventListener('pointerdown', e => {
      const h = e.target.dataset.h; if (!h || !selImg) return;
      e.preventDefault(); e.stopPropagation();
      const img = selImg, r0 = img.getBoundingClientRect(), x0 = e.clientX, w0 = r0.width / S.zoom, ratio = r0.height / r0.width;
      const cw = Pager.G().cw;
      const move = ev => { const dx = (ev.clientX - x0) / S.zoom * (h.includes('w') ? -1 : 1); const w = Aero.clamp(w0 + dx, 16, cw); img.style.width = (w * 0.75).toFixed(1) + 'pt'; img.style.height = (w * ratio * 0.75).toFixed(1) + 'pt'; img.setAttribute('data-f', '1'); placeImgSel(); };
      const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); Pager.run(); App.commit('Resize Picture'); selectImg(img); };
      addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
  }

  /* ---------------- dialogs ---------------- */
  function tableDialog() {
    Aero.dialog({ title: 'Insert Table', fields: [{ key: 'r', label: 'Rows', type: 'number', value: 4, min: 1, max: 200 }, { key: 'c', label: 'Columns', type: 'number', value: 3, min: 1, max: 20 }], onOK: v => { S.ed.focus(); Ed.table(Aero.clamp(v.r | 0, 1, 200), Aero.clamp(v.c | 0, 1, 20)); } });
  }
  async function pictureFromFile() {
    const saved = Sel.save();
    const f = await Aero.openFile({ accept: 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml,image/bmp', filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'] }] });
    if (!f[0]) return;
    S.ed.focus(); if (saved) Sel.restore(saved);
    await Ed.image(f[0]);
  }
  function pictureDialog(img) {
    img = img || selImg; if (!img) { Aero.toast('Click a picture first'); return; }
    const r = img.getBoundingClientRect(); const w = r.width / S.zoom * 0.75, h = r.height / S.zoom * 0.75; const ratio = h / w;
    Aero.dialog({
      title: 'Picture', fields: [
        { key: 'w', label: 'Width (pt)', type: 'number', value: Math.round(w), min: 8, max: 2000 },
        { key: 'h', label: 'Height (pt)', type: 'number', value: Math.round(h), min: 8, max: 3000 },
        { key: 'lock', label: 'Keep proportions', type: 'checkbox', value: true },
        { key: 'wrap', label: 'Text wrapping', type: 'select', value: img.dataset.wrap || 'inline', options: [['inline', 'In line with text'], ['left', 'Square, picture on the left'], ['right', 'Square, picture on the right'], ['center', 'Top and bottom, centred']] },
        { key: 'alt', label: 'Alt text', type: 'text', value: img.alt || '' },
      ],
      onInput: (k, v, set) => { if (!v.lock) return; if (k === 'w') set('h', Math.round(v.w * ratio)); if (k === 'h') set('w', Math.round(v.h / ratio)); },
      onOK: v => Ed.setImage(img, v),
    });
  }
  function linkDialog() {
    const f = Ed.formatInfo();
    Aero.dialog({ title: 'Link', instruction: 'Web address (https://…), e-mail (mailto:…) or #anchor. Leave empty to remove the link.', fields: [{ key: 'u', label: 'Address', type: 'text', value: (f && f.link) || 'https://' }], onOK: v => { S.ed.focus(); const u = (v.u || '').trim(); Ed.link(u && u !== 'https://' ? u : null); } });
  }
  function fontDialog() {
    const f = Ed.formatInfo() || {};
    const cs = Object.entries(S.doc.styles.char).map(([id, s]) => [id, s.name || id]);
    const saved = Sel.save();
    Aero.dialog({
      title: 'Font', fields: [
        { key: 'font', label: 'Font', type: 'select', value: Fonts.names.includes(f.font) ? f.font : Fonts.names[0], options: Fonts.names },
        { key: 'size', label: 'Size (pt)', type: 'number', value: f.size || 11, min: 4, max: 400, step: 0.5 },
        { key: 'color', label: 'Color', type: 'color', value: '#1f2328' },
        { key: 'useColor', label: 'Apply color', type: 'checkbox', value: false },
        { key: 'cs', label: 'Character style', type: 'select', value: f.cs || '', options: [['', '(none)'], ...cs] },
      ],
      onOK: v => {
        S.ed.focus(); Sel.restore(saved);
        Ed.transform({ label: 'Font', collapsedWord: true, fnRun: run => { if (run.t !== 'text') return; run.font = v.font; run.size = v.size; if (v.useColor) run.color = v.color; if (v.cs) run.cs = v.cs; else delete run.cs; } });
      },
    });
  }
  function paragraphDialog() {
    const r = Sel.range(); const b = r && Ed.blockOf(r.startContainer); if (!b) return;
    const cs = getComputedStyle(b); const saved = Sel.save();
    const al = cs.textAlign === 'start' ? 'left' : cs.textAlign;
    Aero.dialog({
      title: 'Paragraph', fields: [
        { key: 'align', label: 'Alignment', type: 'select', value: al, options: [['left', 'Left'], ['center', 'Centered'], ['right', 'Right'], ['justify', 'Justified']] },
        { key: 'ind', label: `Left indent (${units})`, type: 'number', value: toU((parseFloat(b.style.marginLeft) || 0) * 0.75), step: 0.1, min: 0 },
        { key: 'fi', label: `First line (${units})`, type: 'number', value: toU((parseFloat(cs.textIndent) || 0) * 0.75), step: 0.1 },
      ],
      onOK: v => { S.ed.focus(); Sel.restore(saved); Ed.paraProps({ align: v.align, ind: fromU(v.ind || 0), fi: fromU(v.fi || 0) }); },
    });
  }
  function styleDialog(id, isChar) {
    const s = (isChar ? S.doc.styles.char : S.doc.styles.para)[id]; if (!s) return;
    const N = S.doc.styles.para.Normal;
    const paraIds = Object.keys(S.doc.styles.para).map(k => [k, S.doc.styles.para[k].name || k]);
    const fields = [
      { key: 'name', label: 'Name', type: 'text', value: s.name || id },
      { key: 'font', label: 'Font', type: 'select', value: s.font || (isChar ? '' : N.font), options: isChar ? [['', '(inherit)'], ...Fonts.names.map(f => [f, f])] : Fonts.names },
      { key: 'size', label: 'Size (pt)', type: 'number', value: s.size || (isChar ? '' : 11), min: 0, max: 400, step: 0.5 },
      { key: 'b', label: 'Bold', type: 'checkbox', value: !!s.b },
      { key: 'i', label: 'Italic', type: 'checkbox', value: !!s.i },
      { key: 'u', label: 'Underline', type: 'checkbox', value: !!s.u },
      { key: 'caps', label: 'Small caps', type: 'checkbox', value: !!s.caps },
      { key: 'color', label: 'Color', type: 'color', value: s.color || '#1f2328' },
    ];
    if (!isChar) fields.push(
      { key: 'align', label: 'Alignment', type: 'select', value: s.align || 'left', options: [['left', 'Left'], ['center', 'Centered'], ['right', 'Right'], ['justify', 'Justified']] },
      { key: 'sb', label: 'Space before (pt)', type: 'number', value: s.sb || 0, min: 0, max: 200 },
      { key: 'sa', label: 'Space after (pt)', type: 'number', value: s.sa ?? 8, min: 0, max: 200 },
      { key: 'lh', label: 'Line spacing (×)', type: 'number', value: s.lh || 1.35, min: 0.7, max: 4, step: 0.05 },
      { key: 'ind', label: 'Left indent (pt)', type: 'number', value: s.ind || 0, min: 0, max: 300 },
      { key: 'fi', label: 'First line (pt)', type: 'number', value: s.fi || 0, min: -100, max: 100 },
      { key: 'keep', label: 'Keep with next', type: 'checkbox', value: !!s.keep },
      { key: 'next', label: 'Next paragraph', type: 'select', value: s.next || id, options: paraIds },
    );
    else fields.push({ key: 'useBg', label: 'Background', type: 'checkbox', value: !!s.bg }, { key: 'bg', label: 'Background color', type: 'color', value: s.bg || '#fff59d' });
    Aero.dialog({
      title: `Modify ${isChar ? 'Character' : 'Paragraph'} Style`, fields, width: 420,
      onOK: v => {
        const o = { ...s, name: (v.name || '').trim() || s.name };
        if (v.font) o.font = v.font; else delete o.font;
        if (v.size > 0) o.size = v.size; else delete o.size;
        for (const k of ['b', 'i', 'u', 'caps']) { if (v[k]) o[k] = true; else if (isChar) delete o[k]; else o[k] = false; }
        if (v.color && (v.color !== '#1f2328' || s.color)) o.color = v.color;
        if (!isChar) { o.align = v.align === 'left' ? undefined : v.align; if (!o.align) delete o.align; o.sb = v.sb; o.sa = v.sa; o.lh = v.lh; if (v.ind) o.ind = v.ind; else delete o.ind; if (v.fi) o.fi = v.fi; else delete o.fi; o.keep = !!v.keep; if (v.next && v.next !== id) o.next = v.next; else delete o.next; }
        else { if (v.useBg) o.bg = v.bg; else delete o.bg; }
        (isChar ? S.doc.styles.char : S.doc.styles.para)[id] = o;
        Styles.apply(); Pager.run(); App.commit('Modify Style'); refresh(true);
      },
    });
  }
  async function newStyle() {
    const f = Ed.formatInfo(); if (!f) { Aero.toast('Click in a paragraph first'); return; }
    const name = await Aero.prompt('New Paragraph Style', 'Style name', 'My Style'); if (!name) return;
    const r = Sel.range(); const b = r && Ed.blockOf(r.startContainer);
    const base = S.doc.styles.para[f.style] || S.doc.styles.para.Normal;
    const cs = b ? getComputedStyle(b) : null;
    const id = 'S_' + name.replace(/[^A-Za-z0-9]/g, '').slice(0, 24) + Aero.uid().slice(0, 4);
    S.doc.styles.para[id] = { ...base, name: name.slice(0, 60), font: Fonts.names.includes(f.font) ? f.font : base.font, size: f.size || base.size, b: f.b, i: f.i, ...(cs ? { color: Model.toHex(cs.color) || base.color } : {}) };
    delete S.doc.styles.para[id].next;
    Styles.apply(); Ed.paraStyle(id); refresh(true);
  }
  function deleteStyle(id) {
    if (Model.defaultStyles().para[id]) { Aero.toast('Built-in styles cannot be deleted'); return; }
    Pager.removeGaps();
    S.ed.querySelectorAll(`[data-s="${CSS.escape(id)}"]`).forEach(el => el.removeAttribute('data-s'));
    delete S.doc.styles.para[id];
    Styles.apply(); Pager.run(); App.commit('Delete Style'); refresh(true);
  }
  function pageSetup() {
    const pg = S.doc.page;
    const sizes = [...Object.keys(Model.PAGE_SIZES), 'Custom'];
    const land = pg.w > pg.h;
    Aero.dialog({
      title: 'Page Setup', width: 440, instruction: `Measurements in ${units === 'in' ? 'inches' : 'centimetres'} (change in View ▸ Units).`, fields: [
        { key: 'size', label: 'Paper size', type: 'select', value: pg.size || 'Custom', options: sizes },
        { key: 'orient', label: 'Orientation', type: 'select', value: land ? 'landscape' : 'portrait', options: [['portrait', 'Portrait'], ['landscape', 'Landscape']] },
        { key: 'w', label: 'Width', type: 'number', value: toU(pg.w), step: 0.01, min: 2 },
        { key: 'h', label: 'Height', type: 'number', value: toU(pg.h), step: 0.01, min: 2 },
        { key: 'mt', label: 'Top margin', type: 'number', value: toU(pg.mt), step: 0.05, min: 0 },
        { key: 'mb', label: 'Bottom margin', type: 'number', value: toU(pg.mb), step: 0.05, min: 0 },
        { key: 'ml', label: 'Left margin', type: 'number', value: toU(pg.ml), step: 0.05, min: 0 },
        { key: 'mr', label: 'Right margin', type: 'number', value: toU(pg.mr), step: 0.05, min: 0 },
        { key: 'hd', label: 'Header from edge', type: 'number', value: toU(pg.hd || 36), step: 0.05, min: 0 },
        { key: 'fd', label: 'Footer from edge', type: 'number', value: toU(pg.fd || 36), step: 0.05, min: 0 },
        { key: 'start', label: 'First page number', type: 'number', value: pg.start || 1, min: 0, max: 9999 },
      ],
      onInput: (k, v, set) => {
        if (k === 'size' && v.size !== 'Custom') { const [a, b] = Model.PAGE_SIZES[v.size]; const L = v.orient === 'landscape'; set('w', toU(L ? b : a)); set('h', toU(L ? a : b)); }
        if (k === 'orient') { const w = v.w, h = v.h; if ((v.orient === 'landscape') !== (w > h)) { set('w', h); set('h', w); } }
        if (k === 'w' || k === 'h') set('size', 'Custom');
      },
      onOK: v => {
        const n = { ...pg, size: v.size, w: fromU(v.w), h: fromU(v.h), mt: fromU(v.mt), mb: fromU(v.mb), ml: fromU(v.ml), mr: fromU(v.mr), hd: fromU(v.hd), fd: fromU(v.fd), start: Math.max(0, v.start | 0) };
        if (n.w < 144 || n.h < 144 || n.ml + n.mr > n.w - 72 || n.mt + n.mb > n.h - 72) { Aero.alert('Page Setup', 'The margins leave too little room for text.'); return; }
        S.doc.page = n; Styles.apply(); Pager.run(); App.commit('Page Setup'); refresh(true);
      },
    });
  }
  function headerFooter() {
    const h = S.doc.header, f = S.doc.footer;
    Aero.dialog({
      title: 'Header & Footer', width: 460, instruction: 'Fields: {page} {pages} {title} {date} {author}. Left, centre and right parts are aligned to the margins.', fields: [
        { key: 'hl', label: 'Header left', type: 'text', value: h.l }, { key: 'hc', label: 'Header centre', type: 'text', value: h.c }, { key: 'hr', label: 'Header right', type: 'text', value: h.r },
        { key: 'fl', label: 'Footer left', type: 'text', value: f.l }, { key: 'fc', label: 'Footer centre', type: 'text', value: f.c }, { key: 'fr', label: 'Footer right', type: 'text', value: f.r },
        { key: 'first', label: 'Different first page', type: 'checkbox', value: !!S.doc.hfFirst },
      ],
      onOK: v => { S.doc.header = { l: v.hl, c: v.hc, r: v.hr }; S.doc.footer = { l: v.fl, c: v.fc, r: v.fr }; S.doc.hfFirst = !!v.first; Pager.run(); App.commit('Header & Footer'); refresh(); },
    });
  }
  function editNote(id) {
    if (!(id in S.doc.notes)) return;
    Aero.dialog({ title: 'Footnote', fields: [{ key: 't', label: 'Text', type: 'textarea', value: S.doc.notes[id], rows: 4 }], ok: 'Save', onOK: v => { S.doc.notes[id] = v.t; Pager.clearCache(); Pager.run(); App.commit('Edit Footnote'); } });
  }
  function wordCount() {
    const c = counts(false), s = getSelection(), sel = s.rangeCount && !s.isCollapsed && S.ed.contains(s.anchorNode) ? counts(true) : null;
    const rows = [['Pages', S.pages], ['Words', c.words], ['Characters (no spaces)', c.charsNoSpace], ['Characters (with spaces)', c.chars], ['Paragraphs', c.paras], ['Footnotes', S.ed.querySelectorAll('sup.fn').length], ['Comments', Review.commentAnchors().size], ['Tracked changes', Review.all().length]];
    if (sel) rows.splice(1, 0, ['Words in selection', sel.words]);
    Aero.dialog({ title: 'Word Count', noCancel: true, html: `<table class="wc">${rows.map(r => `<tr><td>${r[0]}</td><td>${r[1].toLocaleString()}</td></tr>`).join('')}</table>` });
  }
  function goToPage() {
    Aero.prompt('Go To Page', `Page number (1–${S.pages})`, String(S.curPage + 1)).then(v => {
      const n = Aero.clamp((parseInt(v, 10) || 1) - 1, 0, S.pages - 1);
      const sc = $('#scroller'); sc.scrollTop = n * Pager.G().pitch * S.zoom;
      // caret to the first text on that page
      const g = Pager.G(); const er = S.ed.getBoundingClientRect();
      const y = er.top + n * g.pitch * S.zoom + 4;
      const pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(er.left + 4, y) : null;
      S.ed.focus(); if (pos && S.ed.contains(pos.offsetNode)) { const s = getSelection(); s.collapse(pos.offsetNode, pos.offset); }
      refresh();
    });
  }
  function symbolDialog() {
    const syms = '©®™§¶†‡•…–—‘’“”«»‹›°±×÷≈≠≤≥∞√∑∏∫µπΩαβγδλσ€£¥¢$¹²³¼½¾→←↑↓↔⇒✓✗★☆♥♦♣♠☎✉⌘é è ê à ç ñ ö ü ß ø å æ œ'.replace(/\s/g, '');
    const saved = Sel.save();
    const dlg = Aero.dialog({ title: 'Insert Symbol', noCancel: true, ok: 'Close', html: `<div class="symgrid">${[...syms].map(c => `<button data-c="${esc(c)}" title="U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}">${esc(c)}</button>`).join('')}</div>` });
    dlg.el.querySelector('.symgrid').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; S.ed.focus(); Sel.restore(saved); Ed.insertText(b.dataset.c); const s2 = Sel.save(); Object.assign(saved, s2); });
  }
  function props() {
    Aero.dialog({ title: 'Document Properties', fields: [{ key: 't', label: 'Title', type: 'text', value: S.doc.meta.title }, { key: 'a', label: 'Author', type: 'text', value: S.doc.meta.author }], onOK: v => { S.doc.meta = { title: v.t, author: v.a }; Pager.run(); App.commit('Properties'); refresh(); } });
  }
  function authorDialog() { Aero.prompt('Review Author', 'Your name for comments and tracked changes', S.author).then(v => { if (v && v.trim()) { S.author = v.trim().slice(0, 80); try { localStorage.setItem('lw-author', S.author); } catch (e) { } Aero.toast('Author: ' + S.author); } }); }
  function toggleTrack() { S.track = !S.track; status(); Aero.toast(S.track ? 'Track Changes is on — edits are recorded' : 'Track Changes is off'); lastReview = ''; panels(); }
  function shortcuts() {
    const rows = [['New document', 'Ctrl+N'], ['Open', 'Ctrl+O'], ['Save / Save As', 'Ctrl+S / Ctrl+Shift+S'], ['Export PDF', 'Ctrl+P'], ['Undo / Redo', 'Ctrl+Z / Ctrl+Y'], ['Find / Replace', 'Ctrl+F / Ctrl+H'], ['Next / previous match', 'F3 / Shift+F3'], ['Bold / Italic / Underline', 'Ctrl+B / Ctrl+I / Ctrl+U'], ['Clear formatting', 'Ctrl+Space'], ['Normal / Heading 1–3', 'Ctrl+0 / Ctrl+Alt+1–3'], ['Align left / centre / right / justify', 'Ctrl+L / E / R / J'], ['Bullets / Numbering', 'Ctrl+Shift+L / Ctrl+Shift+N'], ['Indent list item / outdent', 'Tab / Shift+Tab'], ['Next table cell', 'Tab'], ['Page break', 'Ctrl+Enter'], ['Line break', 'Shift+Enter'], ['Insert link', 'Ctrl+K'], ['Footnote', 'Ctrl+Alt+F'], ['New comment', 'Ctrl+Alt+M'], ['Track changes', 'Ctrl+Shift+E'], ['Zoom in / out / 100%', 'Ctrl+= / Ctrl+- / Ctrl+1'], ['Word count', 'Ctrl+Shift+G'], ['Keyboard shortcuts', 'F1']];
    Aero.dialog({ title: 'Keyboard Shortcuts', noCancel: true, width: 520, html: `<table class="kbd">${rows.map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td></tr>`).join('')}</table>` });
  }
  function about() { Aero.alert('About Lumen Write', 'Lumen Write 1.2 — a free word processor in the Lumen Studio suite. Paginated page view with headers, footers and footnotes; paragraph and character styles; lists, tables and pictures with text wrap; table of contents; find & replace; tracked changes and comments. Opens and saves Word .docx (own OOXML reader and writer), OpenDocument .odt, HTML, Markdown and text; exports PDF. Bundled typefaces: Source Serif 4, Lora, Montserrat (SIL OFL), Liberation Sans (SIL OFL) and DejaVu Sans Mono (Bitstream Vera licence).'); }

  /* ---------------- menus ---------------- */
  const sty = id => () => { S.ed.focus(); Ed.paraStyle(id); };
  async function newDoc() { if (!(await IO.confirmDiscard())) return; await App.setDocument(Model.newDoc(), 'Untitled', null); }
  function buildMenus() {
    Aero.init({
      name: 'Lumen Write', icon: '../kit/icons/write.png', doc: 'Untitled', dropTarget: $('#stage'), dropText: 'Drop a document to open it, or pictures to insert them',
      onDropFiles: files => IO.dropFiles(files), onSave: () => IO.save(false),
      menus: {
        File: [['New', 'Ctrl+N', newDoc], ['Open…', 'Ctrl+O', () => IO.open()], ['Open Sample', '', () => Sample.open()], '-', ['Save', 'Ctrl+S', () => IO.save(false)], ['Save As…', 'Ctrl+Shift+S', () => IO.save(true)], '-', '#Export', ['Word Document (.docx)…', '', () => IO.exportAs('docx')], ['PDF…', 'Ctrl+P', () => IO.exportAs('pdf')], ['OpenDocument Text (.odt)…', '', () => IO.exportAs('odt')], ['Web Page (.html)…', '', () => IO.exportAs('html')], ['Markdown (.md)…', '', () => IO.exportAs('md')], ['Plain Text (.txt)…', '', () => IO.exportAs('txt')], '-', ['Page Setup…', '', pageSetup], ['Properties…', '', props]],
        Edit: [{ label: 'Undo', key: 'Ctrl+Z', fn: () => App.undo(), disabled: () => S.hist.index <= 0 }, { label: 'Redo', key: 'Ctrl+Y', fn: () => App.redo(), disabled: () => S.hist.index >= S.hist.items.length - 1 }, '-',
          ['Cut', 'Ctrl+X', () => { S.ed.focus(); document.execCommand('cut') || Aero.toast('Use Ctrl+X to cut'); }], ['Copy', 'Ctrl+C', () => { S.ed.focus(); document.execCommand('copy') || Aero.toast('Use Ctrl+C to copy'); }], ['Paste', 'Ctrl+V', () => pasteFromMenu(false)], ['Paste as Plain Text', 'Ctrl+Shift+V', () => pasteFromMenu(true)], ['Select All', 'Ctrl+A', () => { S.ed.focus(); const r = document.createRange(); r.selectNodeContents(S.ed); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }], '-',
          ['Find…', 'Ctrl+F', () => Find.open(false)], ['Replace…', 'Ctrl+H', () => Find.open(true)], ['Find Next', 'F3', () => Find.go(1)], ['Find Previous', 'Shift+F3', () => Find.go(-1)], ['Go To Page…', 'Ctrl+G', goToPage]],
        View: [['Zoom In', 'Ctrl+=', () => zoomStep(1)], ['Zoom Out', 'Ctrl+-', () => zoomStep(-1)], ['100%', 'Ctrl+1', () => setZoom(1)], ['Page Width', 'Ctrl+2', fitWidth], ['Whole Page', 'Ctrl+3', fitPage], '-',
          { label: 'Formatting Marks', key: 'Ctrl+Shift+8', fn: () => { S.marks = !S.marks; applyView(); }, checked: () => S.marks },
          { label: 'Check Spelling as You Type', fn: () => { S.spell = !S.spell; applyView(true); Aero.toast(S.spell ? 'Spelling uses the browser/system spell checker' : 'Spell checking off'); }, checked: () => S.spell },
          '-', '#Markup', { label: 'All Markup', fn: () => { S.markup = 'all'; applyView(); }, checked: () => S.markup === 'all' }, { label: 'No Markup (final)', fn: () => { S.markup = 'final'; applyView(); }, checked: () => S.markup === 'final' },
          '-', '#Units', { label: 'Centimetres', fn: () => setUnits('cm'), checked: () => units === 'cm' }, { label: 'Inches', fn: () => setUnits('in'), checked: () => units === 'in' }],
        Insert: [['Page Break', 'Ctrl+Enter', () => { S.ed.focus(); Ed.pageBreak(); }], ['Table…', '', tableDialog], ['Picture…', '', pictureFromFile], ['Link…', 'Ctrl+K', linkDialog], ['Footnote', 'Ctrl+Alt+F', () => Ed.footnote()], ['Comment', 'Ctrl+Alt+M', () => Review.addComment()], '-', ['Table of Contents', '', () => { S.ed.focus(); Ed.toc(); }], ['Header & Footer…', '', headerFooter], ['Horizontal Line', '', () => { S.ed.focus(); Ed.hr(); }], ['Symbol…', '', symbolDialog], ['Date', '', () => { S.ed.focus(); Ed.insertText(new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })); App.commit('Insert Date'); }]],
        Format: [['Bold', 'Ctrl+B', () => Ed.toggle('b')], ['Italic', 'Ctrl+I', () => Ed.toggle('i')], ['Underline', 'Ctrl+U', () => Ed.toggle('u')], ['Strikethrough', '', () => Ed.toggle('s')], ['Superscript', '', () => Ed.toggle('sup')], ['Subscript', '', () => Ed.toggle('sub')], ['Clear Formatting', 'Ctrl+Space', () => Ed.clearFormatting()], '-',
          ['Font…', 'Ctrl+D', fontDialog], ['Paragraph…', '', paragraphDialog], ['Picture…', '', () => pictureDialog()], '-',
          ['Align Left', 'Ctrl+L', () => Ed.align('left')], ['Center', 'Ctrl+E', () => Ed.align('center')], ['Align Right', 'Ctrl+R', () => Ed.align('right')], ['Justify', 'Ctrl+J', () => Ed.align('justify')], '-',
          ['Bullets', 'Ctrl+Shift+L', () => Ed.toggleList('ul')], ['Numbering', 'Ctrl+Shift+N', () => Ed.toggleList('ol')], ['Numbering a, b, c', '', () => Ed.toggleList('ol', 'lower-alpha')], ['Numbering i, ii, iii', '', () => Ed.toggleList('ol', 'lower-roman')], ['Increase Indent', 'Ctrl+M', () => Ed.indent(1)], ['Decrease Indent', 'Ctrl+Shift+M', () => Ed.indent(-1)], '-',
          '#Styles', ['Normal', 'Ctrl+0', sty('Normal')], ['Title', '', sty('Title')], ['Heading 1', 'Ctrl+Alt+1', sty('Heading1')], ['Heading 2', 'Ctrl+Alt+2', sty('Heading2')], ['Heading 3', 'Ctrl+Alt+3', sty('Heading3')], ['Quote', '', sty('Quote')], ['Code', '', sty('Code')], ['Modify Current Style…', '', () => { const f = Ed.formatInfo(); styleDialog(f ? f.style : 'Normal'); }], ['New Style from Selection…', '', newStyle]],
        Table: [['Insert Table…', '', tableDialog], '-', ['Insert Row Above', '', () => Ed.tableOp('rowAbove')], ['Insert Row Below', '', () => Ed.tableOp('rowBelow')], ['Insert Column Left', '', () => Ed.tableOp('colLeft')], ['Insert Column Right', '', () => Ed.tableOp('colRight')], '-', ['Delete Row', '', () => Ed.tableOp('delRow')], ['Delete Column', '', () => Ed.tableOp('delCol')], ['Delete Table', '', () => Ed.tableOp('delTable')], '-', ['Merge Cell Right', '', () => Ed.tableOp('mergeRight')], ['Merge Cell Down', '', () => Ed.tableOp('mergeDown')], ['Split Cell', '', () => Ed.tableOp('split')], '-', ['Header Row', '', () => Ed.tableOp('header')], ['Cell Shading…', '', shadeDialog], ['Column Widths…', '', widthsDialog]],
        Review: [{ label: 'Track Changes', key: 'Ctrl+Shift+E', fn: toggleTrack, checked: () => S.track }, ['Accept Change', '', () => Review.act(true)], ['Reject Change', '', () => Review.act(false)], ['Next Change', '', () => Review.next(1)], ['Previous Change', '', () => Review.next(-1)], ['Accept All Changes', '', () => Review.act(true, 'all')], ['Reject All Changes', '', () => Review.act(false, 'all')], '-', ['New Comment', 'Ctrl+Alt+M', () => Review.addComment()], ['Show Review Panel', '', () => showTab('review')], '-', ['Word Count…', 'Ctrl+Shift+G', wordCount], ['Author Name…', '', authorDialog]],
        Help: [['Keyboard Shortcuts', 'F1', shortcuts], ['About Lumen Write', '', about]],
      },
    });
  }
  function setUnits(u) { units = u; try { localStorage.setItem('lw-units', u); } catch (e) { } refresh(true); }
  async function pasteFromMenu(plain) {
    S.ed.focus();
    try {
      if (!plain && navigator.clipboard.read) { const items = await navigator.clipboard.read(); const it = items[0]; const dt = { files: [], getData: () => '' }; const data = {}; for (const t of it.types) if (/text\/(html|plain)/.test(t)) data[t] = await (await it.getType(t)).text(); dt.getData = t => data[t] || ''; await Ed.paste(dt, false); return; }
      const t = await navigator.clipboard.readText(); await Ed.paste({ files: [], getData: k => k === 'text/plain' ? t : '' }, true);
    } catch (e) { Aero.toast('Use Ctrl+V to paste (clipboard access was refused)'); }
  }
  function shadeDialog() {
    if (!Ed.cellCtx()) { Aero.toast('Place the cursor in a table cell'); return; }
    Aero.dialog({ title: 'Cell Shading', fields: [{ key: 'c', label: 'Color', type: 'color', value: '#e2efda' }, { key: 'none', label: 'No shading', type: 'checkbox', value: false }], onOK: v => Ed.cellShade(v.none ? null : v.c) });
  }
  function widthsDialog() {
    const c = Ed.cellCtx(); if (!c) { Aero.toast('Place the cursor in a table cell'); return; }
    const cur = (c.table.getAttribute('data-w') || '').split(',').filter(Boolean).map(Number);
    const n = c.ncol; const vals = cur.length === n ? cur : Array(n).fill(Math.round(1000 / n) / 10);
    Aero.dialog({ title: 'Column Widths', instruction: 'Relative widths in percent of the table width.', fields: [{ key: 'w', label: 'Widths (%)', type: 'text', value: vals.join(', ') }, { key: 'eq', label: 'Distribute evenly', type: 'checkbox', value: false }], onOK: v => { if (v.eq) return Ed.tableWidths(null); const w = String(v.w).split(/[,;\s]+/).map(Number).filter(x => x > 0); if (w.length !== n) { Aero.alert('Column Widths', `Enter ${n} numbers.`); return; } const t = w.reduce((a, b) => a + b, 0); Ed.tableWidths(w.map(x => Math.round(x / t * 1000) / 10)); } });
  }

  /* ---------------- init ---------------- */
  async function init() {
    S.hist = new Aero.History({ max: 150, onChange: () => Aero.renderHistory($('#hist'), S.hist, i => { App.flushTyping(); const st = S.hist.go(i); if (st) App.restore(st); }) });
    Ed.init($('#ed'));
    buildCmd(); buildMenus(); Find.init(); Review.initBalloons(); initImg();
    Aero.shortcut('Ctrl+Shift+E', toggleTrack);
    document.querySelectorAll('#tabs .aero-tab').forEach(t => t.onclick = () => showTab(t.dataset.p));
    // styles panel
    $('#pstyles').addEventListener('mousedown', e => e.preventDefault());
    $('#pstyles').onclick = e => { const it = e.target.closest('.aero-item'); if (it) { S.ed.focus(); Ed.paraStyle(it.dataset.id); } };
    $('#pstyles').ondblclick = e => { const it = e.target.closest('.aero-item'); if (it) styleDialog(it.dataset.id); };
    $('#cstyles').addEventListener('mousedown', e => e.preventDefault());
    $('#cstyles').onclick = e => { const it = e.target.closest('.aero-item'); if (it) { S.ed.focus(); Ed.charStyle(it.dataset.id || null); } };
    $('#cstyles').ondblclick = e => { const it = e.target.closest('.aero-item'); if (it && it.dataset.id) styleDialog(it.dataset.id, true); };
    $('#ps-new').onclick = newStyle; $('#ps-edit').onclick = () => { const s = $('#pstyles .sel'); styleDialog(s ? s.dataset.id : 'Normal'); }; $('#ps-del').onclick = () => { const s = $('#pstyles .sel'); if (s) deleteStyle(s.dataset.id); };
    $('#cs-edit').onclick = () => { const s = $('#cstyles .sel'); if (s && s.dataset.id) styleDialog(s.dataset.id, true); else Aero.toast('Select a character style'); };
    // review panel
    for (const id of ['#changes', '#comments', '#tp-review .aero-iconbar']) document.querySelectorAll(id).forEach(el => el.addEventListener('mousedown', e => { if (!e.target.closest('select,input')) e.preventDefault(); }));
    $('#rv-track').onchange = () => { if ($('#rv-track').checked !== S.track) toggleTrack(); };
    $('#rv-markup').onchange = e => { S.markup = e.target.value; applyView(); };
    $('#rv-prev').onclick = () => Review.next(-1); $('#rv-next').onclick = () => Review.next(1);
    $('#rv-acc').onclick = () => Review.act(true); $('#rv-rej').onclick = () => Review.act(false);
    $('#rv-accall').onclick = () => Review.act(true, 'all'); $('#rv-rejall').onclick = () => Review.act(false, 'all');
    $('#cm-new').onclick = () => Review.addComment();
    $('#cm-edit').onclick = () => { const s = $('#comments .sel'); if (s) Review.editComment(s.dataset.id); else Aero.toast('Select a comment'); };
    $('#cm-del').onclick = () => { const s = $('#comments .sel'); if (s) Review.deleteComment(s.dataset.id); else Aero.toast('Select a comment'); };
    // status bar
    $('#st-track').onclick = toggleTrack;
    $('#z-in').onclick = () => zoomStep(1); $('#z-out').onclick = () => zoomStep(-1);
    $('#z-range').oninput = e => setZoom(+e.target.value / 100);
    $('#scroller').addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)); } }, { passive: false });
    document.addEventListener('selectionchange', () => { if (S.doc && document.activeElement === S.ed) { syncCmd(); status(); if ($('#tabs .on').dataset.p === 'styles') stylesPanel(); } });
    // header / footer / footnote zones and TOC links
    $('#stage').addEventListener('dblclick', e => {
      if (e.target.nodeName === 'IMG') return;
      const fnRef = e.target.closest && e.target.closest('sup.fn'); if (fnRef) { editNote(fnRef.dataset.fn); return; }
      const stack = document.elementsFromPoint(e.clientX, e.clientY);
      const fnote = stack.find(el => el.classList && el.classList.contains('fnote')); if (fnote) { editNote(fnote.dataset.fn); return; }
      const sheet = stack.find(el => el.classList && el.classList.contains('page')); if (!sheet) return;
      const r = sheet.getBoundingClientRect(); const y = (e.clientY - r.top) / S.zoom; const g = Pager.G();
      if (y < g.mt - 4 || y > g.H - g.mb + 4) { e.preventDefault(); headerFooter(); }
    });
    S.ed.addEventListener('click', e => {
      const tp = e.target.closest('.toc p[data-i]'); if (tp) { const ent = Pager.last.toc && Pager.last.toc[+tp.dataset.i]; if (ent && ent.el.isConnected) jumpTo(ent.el); return; }
      const a = e.target.closest('a[href]'); if (a && (e.ctrlKey || e.metaKey)) { const h = a.getAttribute('href'); if (h.startsWith('#')) { const t = S.ed.querySelector(`[id="${CSS.escape(h.slice(1))}"]`); if (t) jumpTo(t); } else Aero.toast(h); }
    });
    S.ed.addEventListener('mouseover', e => { const a = e.target.closest && e.target.closest('a[href]'); $('#st-msg').textContent = a ? a.getAttribute('href') + '  (Ctrl+click to follow)' : ''; });
    addEventListener('resize', () => { layoutCanvas(); });
    await Fonts.load();
    await document.fonts.ready;
    // start with the sample so the app can be tried at once (a new blank document is one click away)
    let started = false;
    try { if (new URLSearchParams(location.search).get('blank') !== null) { await App.setDocument(Model.newDoc(), 'Untitled', null); started = true; } } catch (e) { }
    if (!started) { const d = await Sample.build(); await App.setDocument(d, 'Riverside Library Proposal', null); }
    applyView(true);
    fitWidthIfSmall();
    window.__writeReady = true;
  }
  function fitWidthIfSmall() { const g = Pager.G(); const sc = $('#scroller'); if (sc.clientWidth - 48 < g.W + 250) fitWidth(); else setZoom(1); }
  init().catch(e => { console.error(e); Aero.alert('Lumen Write', 'Start-up failed: ' + e.message); });
  return { refresh, status, setZoom, applyView, afterLayout, showTab, scrollToCaret, pageSetup, headerFooter, wordCount, styleDialog, pictureDialog, editNote, get units() { return units; } };
})();
