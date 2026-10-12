'use strict';
/* Lumen Convert — page: header count, searchable grid of tools by category, hash routing (#tool-id, aliases like #jpg-to-png). */
(() => {
  const { tools, byId, aliases, CATS, iconHtml, util: U } = LC;
  const { esc, el } = U;
  const $ = s => document.querySelector(s);
  const grid = $('#grid'), toolBox = $('#tool'), hero = $('#hero'), q = $('#q'), none = $('#none');
  const n = tools.length;
  // the header always reflects the real number of registered tools
  $('#hero p').textContent = `${n} converters. Your files never leave your device.`;
  document.title = 'Lumen Convert: ' + n + ' free file converters';
  const md = document.querySelector('meta[name=description]'); if (md) md.content = `Lumen Convert: ${n} free file and data converters for images, PDFs, documents, audio, video, spreadsheets, text, colours and units. Everything runs in your browser, so your files never leave your device.`;

  /* ---------- grid ---------- */
  for (const c of CATS) {
    const list = tools.filter(t => t.cat === c.id); if (!list.length) continue;
    const sec = el('section', 'sec'); sec.dataset.cat = c.id;
    sec.innerHTML = `<div class="sec-h glass glow"><span class="ico ${c.cls}" style="width:26px;height:26px;border-radius:6px"></span><h2>${esc(c.name)}</h2><span class="n">${list.length}</span></div>`;
    const pane = el('div', 'pane'), tiles = el('div', 'tiles');
    for (const t of list) {
      const a = el('a', 'tile'); a.href = '#' + t.id; a.dataset.id = t.id;
      a.innerHTML = `${iconHtml(t)}<span><b>${esc(t.name)}</b><span class="d">${esc(t.desc)}</span></span>`;
      tiles.append(a);
    }
    pane.append(tiles); sec.append(pane); grid.append(sec);
  }
  const norm = s => s.toLowerCase().replace(/[→⇄/&,]/g, ' ');
  function filter() {
    const terms = norm(q.value).split(/\s+/).filter(Boolean); let shown = 0;
    for (const sec of grid.children) {
      let k = 0;
      for (const a of sec.querySelectorAll('.tile')) {
        const t = byId[a.dataset.id], hay = norm(`${t.name} ${t.desc} ${t.keywords} ${LC.catOf(t.cat).name}`);
        const ok = terms.every(w => hay.includes(w)); a.hidden = !ok; if (ok) k++;
      }
      sec.hidden = !k; sec.querySelector('.n').textContent = terms.length ? `${k} of ${sec.querySelectorAll('.tile').length}` : sec.querySelectorAll('.tile').length; shown += k;
    }
    none.hidden = shown > 0; $('#noneQ').textContent = q.value;
    return shown;
  }
  q.addEventListener('input', filter);
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { const first = grid.querySelector('.tile:not([hidden])'); if (first) first.click(); } if (e.key === 'Escape') { q.value = ''; filter(); } });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) { e.preventDefault(); if (!toolBox.hidden) location.hash = ''; q.focus(); }
    if (e.key === 'Escape' && !toolBox.hidden && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) closeTool();
  });

  /* ---------- tool pane ---------- */
  let ctl = null, current = null;
  async function openTool(id, preset) {
    const t = byId[id]; if (!t) return;
    if (ctl && ctl.destroy) ctl.destroy();
    current = t; ctl = null;
    toolBox.innerHTML = '';
    const title = el('div', 'tool-title glow');
    title.innerHTML = `${iconHtml(t)}<span class="grow">${esc(t.name)} · Lumen Convert</span>`;
    const x = el('button', 'cap', '✕'); x.type = 'button'; x.title = 'Back to all converters (Esc)'; x.setAttribute('aria-label', 'Close'); x.onclick = closeTool; title.append(x);
    const client = el('div', 'client');
    const intro = el('div', 'intro'); const back = el('a', 'back', '← All converters'); back.href = '#'; back.onclick = e => { e.preventDefault(); closeTool(); };
    intro.append(back, el('span', null, esc(t.desc)));
    const others = tools.filter(o => o.cat === t.cat && o.id !== t.id);
    if (others.length) { const sel = el('select'); sel.setAttribute('aria-label', 'Other converters'); sel.style.marginLeft = 'auto'; sel.innerHTML = `<option value="">More in ${esc(LC.catOf(t.cat).name)}…</option>` + others.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join(''); sel.onchange = () => { if (sel.value) location.hash = sel.value; }; intro.append(sel); }
    client.append(intro);
    toolBox.append(title, client);
    grid.hidden = true; none.hidden = true; hero.hidden = true; toolBox.hidden = false;
    document.title = `${t.name} · Lumen Convert`;
    window.scrollTo(0, 0);
    try { await Promise.all((t.needs || []).map(k => U.lib[k]())); }
    catch (e) { client.append(el('div', 'alert', esc('Could not load a component of this converter: ' + e.message))); return; }
    if (current !== t) return;
    const body = el('div'); client.append(body);
    ctl = t.render ? t.render(body, preset) : LC.mountFileTool(t, body, preset);
    return ctl;
  }
  function closeTool() { if (location.hash) history.pushState('', document.title, location.pathname + location.search); route(); }
  function route() {
    const h = decodeURIComponent(location.hash.slice(1)).toLowerCase();
    if (h && (byId[h] || aliases[h])) { const a = aliases[h]; return openTool(a ? a.id : h, a ? a.preset : null); }
    if (ctl && ctl.destroy) ctl.destroy(); ctl = null; current = null;
    toolBox.hidden = true; toolBox.innerHTML = ''; grid.hidden = false; hero.hidden = false; filter();
    document.title = 'Lumen Convert: ' + n + ' free file converters';
    if (h) U.toast(`No converter called “${h}”`);
  }
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', route);
  $('#homeLink').onclick = $('#navAll').onclick = e => { e.preventDefault(); closeTool(); };
  // a file dropped anywhere on an open file tool goes to that tool
  window.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => { if (e.target.closest && e.target.closest('.drop,textarea')) return; e.preventDefault(); if (ctl && ctl.addFiles && e.dataTransfer.files.length) ctl.addFiles(e.dataTransfer.files); });
  route();

  // hooks for the scripted headless tests
  LC.page = { openTool, get ctl() { return ctl; }, filter: s => { q.value = s; return filter(); }, route, count: n };
})();
