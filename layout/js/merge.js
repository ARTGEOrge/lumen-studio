'use strict';
/* Lumen Layout — Data Merge: a CSV data source (pasted or loaded, stored in the document), «Field»
   placeholders inserted into text and table cells, and merging every record into a new document
   (one copy of all pages per record) or straight to a merged PDF. Data is only ever treated as text. */
const Merge = (() => {
  const esc = Aero.esc;
  function parseCSV(text) {
    text = String(text).replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const delim = [',', ';', '\t'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
      if (c === '"' && f === '') q = true;
      else if (c === delim) { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some(x => x !== '')) rows.push(row); row = []; }
      else f += c;
    }
    row.push(f); if (row.some(x => x !== '')) rows.push(row);
    if (!rows.length) return null;
    const fields = rows[0].map((h, k) => (h.trim() || 'Field' + (k + 1)).slice(0, 80));
    return { fields, rows: rows.slice(1, 10001).map(r => fields.map((_, k) => String(r[k] ?? '').slice(0, 5000))) };
  }
  function sourceDialog() {
    const m = S.doc.merge;
    const toCsv = m ? [m.fields, ...m.rows.slice(0, 200)].map(r => r.map(v => /[",;\n\t]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v).join(',')).join('\n') : 'Name,City,Code\nAda Lovelace,London,A-101\nGrace Hopper,New York,B-202';
    const dlg = Aero.dialog({ title: 'Data Merge — Data Source', instruction: 'Paste CSV data (first row = field names) or load a .csv file. Then put «Field» placeholders in your text with Type ▸ Insert Merge Field. Image fields: name a column “@Photo”, load the images below, and assign the field to an image frame (Object ▸ Merge Image Field).',
      fields: [{ key: 'csv', label: 'CSV data', type: 'textarea', value: toCsv, mono: true }], width: 560,
      html: `<div class="pbtns" style="padding:6px 0 0"><button class="aero-btn small" id="mg-load">Load CSV File…</button><button class="aero-btn small" id="mg-img">Load Merge Images…</button><span class="dim" id="mg-imgn">${mergeImages().length} merge image(s) loaded</span>${m ? `<span class="dim">Current source: ${esc(m.name || 'pasted data')} · ${m.rows.length} records · ${m.fields.length} fields</span>` : ''}</div>`,
      ok: 'Use Data', onOK: v => {
        const r = parseCSV(v.csv); if (!r || !r.fields.length) { Aero.alert('Data Merge', 'No data found.'); return; }
        S.doc.merge = { name: dlg.name || (m && m.name) || 'pasted data', ...r }; commit('Data Merge Source');
        Aero.toast(`Data source: ${r.rows.length} records, fields ${r.fields.join(', ')}`);
      } });
    dlg.el.querySelector('#mg-load').onclick = async () => {
      const f = await Aero.openFile({ accept: '.csv,.txt,text/csv,text/plain', filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }] });
      if (!f[0]) return; dlg.name = f[0].name; dlg.set('csv', new TextDecoder().decode(f[0].data));
    };
    dlg.el.querySelector('#mg-img').onclick = async () => {
      const fs = await Aero.openFile({ accept: 'image/png,image/jpeg,image/svg+xml,image/webp,image/gif', multiple: true, filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'svg', 'webp', 'gif'] }] });
      const n = await loadImages(fs); const x = dlg.el.querySelector('#mg-imgn'); if (x) x.textContent = `${mergeImages().length} merge image(s) loaded` + (n ? ` (+${n})` : '');
    };
  }
  function insertField() {
    const m = S.doc.merge; if (!m) { Aero.toast('Choose a data source first (File ▸ Data Merge…)'); sourceDialog(); return; }
    if (!S.edit && !S.cell) { Aero.toast('Place the text cursor (or open a table cell) where the field goes'); return; }
    Aero.dialog({ title: 'Insert Merge Field', fields: [{ key: 'f', label: 'Field', type: 'select', value: m.fields[0], options: m.fields }],
      onOK: v => { const ph = '«' + v.f + '»'; if (S.edit) { Tools.T.insert(ph); commit('Insert Merge Field'); } else { const ta = document.querySelector('.celled'); if (ta) { ta.setRangeText(ph, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); } } } });
  }
  // images available to image fields: everything in the document, marked “keep” so unplaced ones are saved too
  const mergeImages = () => Object.entries(S.images).filter(([, im]) => im.keep);
  async function loadImages(files) {
    let n = 0;
    for (const f of files || []) { try { const id = await addImage(f.name, f.type && f.type.startsWith('image/') ? f.type : '', f.data); S.images[id].keep = true; n++; } catch (e) { console.warn(e); } }
    if (n) { Aero.setDirty(true); UI.refresh(); }
    return n;
  }
  // resolve a field value (file name or path, with or without extension) to an image id
  function findImage(value) {
    const base = String(value || '').trim().split(/[\\/]/).pop().toLowerCase(); if (!base) return null;
    const noext = base.replace(/\.[a-z0-9]+$/, '');
    let hit = null;
    for (const [id, im] of Object.entries(S.images)) { const nm = String(im.name).toLowerCase(); if (nm === base) return id; if (!hit && nm.replace(/\.[a-z0-9]+$/, '') === noext) hit = id; }
    return hit;
  }
  function imageFieldDialog() {
    const m = S.doc.merge; if (!m) { Aero.toast('Choose a data source first (File ▸ Data Merge Source…)'); return; }
    const frames = UI.selItems().filter(i => i.type === 'image'); if (!frames.length) { Aero.toast('Select an image frame'); return; }
    const fields = [...m.fields.filter(f => f[0] === '@'), ...m.fields.filter(f => f[0] !== '@')];
    Aero.dialog({ title: 'Merge Image Field', instruction: 'Each record places the image named in this field (file name or path; matched against the loaded merge images)', fields: [{ key: 'f', label: 'Field', type: 'select', value: frames[0].mergeField || fields[0], options: [['', '[None]'], ...fields.map(f => [f, f])] }],
      onOK: v => { for (const it of frames) { const t = S.eng.idx.get(it.id).item; if (v.f) t.mergeField = v.f; else delete t.mergeField; } commit('Merge Image Field'); } });
  }
  const PH = /«([^«»\n]{1,80})»/g;
  const subst = (t, rec) => String(t).replace(PH, (all, f) => rec.has(f) ? rec.get(f) : all);
  function placeholders(d) { let n = 0; M.walkAll(d, it => { if (it.type === 'image' && it.mergeField) n++; }); for (const s of Object.values(d.stories)) n += (s.text.match(PH) || []).length; M.walkAll(d, it => { if (it.type === 'table') it.cells.flat().forEach(c => { n += (String(c.t).match(PH) || []).length; }); }); return n; }
  // replace placeholders in a story, keeping the formatting of each placeholder
  function substStory(s, rec) {
    const hits = [...s.text.matchAll(PH)].reverse();
    for (const m of hits) {
      if (!rec.has(m[1])) continue;
      const a = m.index, b = a + m[0].length, ai = M.plainAttr(s, s.ca[a]);
      M.deleteRange(s, a, b); M.insertText(s, a, rec.get(m[1]).replace(/\r?\n/g, '\u2028'), ai);
    }
    for (const o of Object.values(s.objs || {})) if (o.kind === 'table') o.cells.forEach(r => r.forEach(c => { c.t = subst(c.t, rec); }));
  }
  let missing = new Set();
  function build(from, to) {
    const t = S.doc, m = t.merge; if (!m || !m.rows.length) return null;
    missing = new Set();
    const out = structuredClone(t); out.pages = []; out.stories = {}; out.sections = {}; out.toc = null;
    for (const s of Object.values(t.stories)) if (S.eng.storyFrames(s)[0]?.kind === 'master') out.stories[s.id] = structuredClone(s);
    for (let k = from; k < to; k++) {
      const rec = new Map(m.fields.map((f, i) => [f, m.rows[k][i] ?? ''])), sfx = '_r' + k;
      const pages = structuredClone(t.pages), smap = new Map();
      for (const p of pages) {
        const oldId = p.id; p.id += sfx;
        if (t.sections[oldId]) out.sections[p.id] = k === from ? { ...t.sections[oldId] } : { ...t.sections[oldId], start: null };
        M.walkItems(p.items, it => {
          it.id += sfx;
          if (it.type === 'text') { if (!smap.has(it.story)) { const ns = structuredClone(t.stories[it.story]); ns.id += sfx; ns.frames = ns.frames.map(f => f + sfx); substStory(ns, rec); smap.set(it.story, ns); out.stories[ns.id] = ns; } it.story = smap.get(it.story).id; }
          if (it.type === 'table') it.cells.forEach(r => r.forEach(c => { c.t = subst(c.t, rec); }));
          if (it.type === 'image' && it.mergeField) {
            const v = rec.get(it.mergeField) ?? rec.get('@' + it.mergeField.replace(/^@/, '')) ?? rec.get(it.mergeField.replace(/^@/, ''));
            const id = findImage(v);
            if (id) { it.img = id; Tools.applyFit(it, it.fit || 'fit'); } else { it.img = null; if (v) missing.add(String(v)); }
            delete it.mergeField;
          }
        });
      }
      out.pages.push(...pages);
    }
    return out;
  }
  function mergeDialog(toPdf) {
    const m = S.doc.merge; if (!m) { sourceDialog(); return; }
    UI.closeCellEditor?.(true); flushTyping(true);
    const n = placeholders(S.doc);
    Aero.dialog({ title: toPdf ? 'Export Merged PDF' : 'Create Merged Document', instruction: `${m.rows.length} records · ${n} placeholder${n === 1 ? '' : 's'} in the document${n ? '' : ' — insert «Field» placeholders first'}. Every record gets its own copy of all ${S.doc.pages.length} page${S.doc.pages.length > 1 ? 's' : ''}.`,
      fields: [{ key: 'from', label: 'From record', type: 'number', value: 1, min: 1, max: m.rows.length }, { key: 'to', label: 'To record', type: 'number', value: Math.min(m.rows.length, 500), min: 1, max: m.rows.length }],
      ok: toPdf ? 'Export' : 'Create', onOK: async v => {
        const a = Aero.clamp((v.from | 0) - 1, 0, m.rows.length - 1), b = Aero.clamp(v.to | 0, a + 1, m.rows.length);
        if ((b - a) * S.doc.pages.length > 2000) { Aero.alert('Data Merge', 'That would create more than 2000 pages; choose a smaller range of records.'); return; }
        const md = build(a, b); if (!md) return;
        if (toPdf) {
          Aero.busy('Merging and exporting PDF…');
          try { const eng = new Engine(md); const bytes = await PdfOut.exportPDF({ doc: md, engine: eng, images: S.images, name: S.name + '-merged' }, {}); Aero.busy(); docChanged(); const p = await Aero.saveFile({ name: S.name + '-merged.pdf', data: bytes, filters: [{ name: 'PDF', extensions: ['pdf'] }] }); if (p) Aero.toast(`Merged ${b - a} records into ${md.pages.length} pages` + (missing.size ? ` · ${missing.size} image(s) not found` : '')); }
          catch (e) { Aero.busy(); docChanged(); console.error(e); Aero.alert('Export Merged PDF', 'Export failed: ' + e.message); }
          return;
        }
        if (!(await IO.confirmDiscard())) return;
        const imgs = {}; for (const [id, im] of Object.entries(S.images)) imgs[id] = im;
        setDocument(md, imgs, (S.name || 'Untitled') + '-merged'); Aero.setDirty(true);
        Aero.toast(`Merged ${b - a} records into ${md.pages.length} pages` + (missing.size ? ` · ${missing.size} image(s) not found: ${[...missing].slice(0, 3).join(', ')}` : ''));
      } });
  }
  return { parseCSV, sourceDialog, insertField, build, mergeDialog, placeholders, imageFieldDialog, loadImages, findImage, get missing() { return [...missing]; } };
})();
