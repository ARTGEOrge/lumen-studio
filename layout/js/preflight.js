'use strict';
/* Lumen Layout — live preflight: overset text, missing / low-resolution images, RGB content in CMYK
   (print) documents, excessive total ink, unknown fonts, empty frames and objects off the page.
   The status bar shows the error count; clicking it (or File ▸ Preflight) opens the report. */
const Preflight = (() => {
  const esc = Aero.esc;
  function run(d = S.doc, eng = S.eng) {
    const out = []; const add = (level, msg, ref = {}) => out.push({ level, msg, ...ref });
    eng.ensure(); Color.use(d);
    const pageOf = new Map(); d.pages.forEach((p, i) => M.walkItems(p.items, it => pageOf.set(it.id, i)));
    // overset text
    for (const s of Object.values(d.stories)) {
      const r = eng.storyRes.get(s.id); if (!r || !r.overset) continue;
      const last = s.frames[s.frames.length - 1];
      if (r.end >= r.n) { add('error', 'Overset footnote: the end of a footnote does not fit in the last frame of the story', { id: last, page: pageOf.get(last) }); continue; }
      add('error', `Overset text: ${r.n - r.end} character${r.n - r.end === 1 ? '' : 's'} do not fit (“${s.text.slice(r.end, r.end + 28).replace(/\s+/g, ' ').trim()}…”)`, { id: last, page: pageOf.get(last) });
    }
    // images
    const img = (id, where, cs) => {
      const im = S.images[id];
      if (!im) { add('error', 'Missing image: the image data for this frame is not in the document', where); return; }
      const raster = !/svg/.test(im.mime || im.data.slice(5, 30));
      const ppi = 72 / cs;
      if (raster && ppi < 150) add('warn', `Low resolution: ${esc(im.name)} is ${Math.round(ppi)} ppi effective (150+ recommended, 300 for print)`, where);
      if (raster && d.cmyk) add('info', `RGB image in a CMYK document: ${esc(im.name)} (converted when exporting PDF with “Convert colors to CMYK”)`, where);
    };
    const visit = (items, pi) => M.walkItems(items, it => {
      const where = { id: it.id, page: pi };
      if (it.type === 'image') { if (it.img) img(it.img, where, it.cs); else if (pi != null) add('info', 'Empty image frame', where); }
      if (pi != null && it.type !== 'group') { const b = Geo.bbox(it), bl = d.bleed + d.slug; if (b.x + b.w < -bl || b.y + b.h < -bl || b.x > d.w + bl || b.y > d.h + bl) add('info', 'Object is entirely on the pasteboard and will not print', where); }
    });
    d.pages.forEach((p, i) => visit(p.items, i));
    d.masters.forEach(m => m.pages.forEach(p => visit(p.items, null)));
    for (const s of Object.values(d.stories)) for (const o of Object.values(s.objs || {})) if (o.kind === 'graphic' && o.item.type === 'image' && o.item.img) img(o.item.img, { id: s.frames[0], page: pageOf.get(s.frames[0]) }, o.item.cs);
    // colors
    const seen = new Set();
    for (const { ref, where } of Color.refsIn(d)) {
      const c = Color.parse(ref), key = ref + JSON.stringify(where);
      if (seen.has(key)) continue; seen.add(key);
      const at = where.id ? { id: where.id, page: where.page } : where.story ? { id: d.stories[where.story]?.frames[0], page: pageOf.get(d.stories[where.story]?.frames[0]) } : {};
      if (c.missing) add('error', `Missing swatch “${esc(c.missing)}” (shown as black)`, at);
      else if (d.cmyk && c.kind === 'rgb') add('warn', `RGB color ${esc(Color.hex(ref))} in a CMYK document${where.style ? ' (in a style)' : ''}`, at);
      if ((c.kind === 'cmyk') && Color.totalInk(c) > 300) add('warn', `Total ink ${Math.round(Color.totalInk(c))}% exceeds 300%`, at);
    }
    // fonts
    const fams = new Set();
    for (const st of [...Object.values(d.paraStyles), ...Object.values(d.charStyles)]) if (st.font) fams.add(st.font);
    for (const s of Object.values(d.stories)) s.attrs.forEach(a => { if (a.font) fams.add(a.font); });
    for (const f of fams) if (!Fonts.FAMILIES[f]) add('warn', `Font not available: “${esc(f)}” (substituted with Source Serif 4)`);
    return out;
  }
  let last = { errors: 0, warns: 0, list: [] }, timer = null;
  function soon() { clearTimeout(timer); timer = setTimeout(() => { try { const l = run(); last = { list: l, errors: l.filter(x => x.level === 'error').length, warns: l.filter(x => x.level === 'warn').length }; } catch (e) { console.error(e); } UI.status(); }, 250); }
  function dialog() {
    const l = run(); last = { list: l, errors: l.filter(x => x.level === 'error').length, warns: l.filter(x => x.level === 'warn').length }; UI.status();
    const icon = { error: '<b class="pf-e">●</b>', warn: '<b class="pf-w">▲</b>', info: '<b class="pf-i">i</b>' };
    const rows = l.length ? l.map((x, k) => `<div class="pf-row" data-k="${k}">${icon[x.level]}<span>${x.msg}</span><span class="dim">${x.page != null ? 'p. ' + esc(S.eng.label(x.page)) : x.id ? 'master' : ''}</span></div>`).join('') : '<div class="pf-ok">✔ No problems found — the document is ready for output.</div>';
    const dlg = Aero.dialog({ title: 'Preflight', instruction: `${last.errors} error${last.errors === 1 ? '' : 's'} · ${last.warns} warning${last.warns === 1 ? '' : 's'} · ${l.length - last.errors - last.warns} note${l.length - last.errors - last.warns === 1 ? '' : 's'} — click a row to show the object`, noCancel: true, ok: 'Close', width: 600,
      html: `<div class="pf-list">${rows}</div>` });
    dlg.el.querySelectorAll('.pf-row').forEach(r => r.onclick = () => { const x = l[+r.dataset.k]; dlg.close(); reveal(x); });
  }
  function reveal(x) {
    if (x.page != null) View.goPage(x.page);
    if (x.id && S.eng.idx.has(x.id)) { S.sel = [x.id]; S.edit = null; UI.refresh(true); requestRender(); }
  }
  return { run, dialog, soon, get state() { return last; } };
})();
