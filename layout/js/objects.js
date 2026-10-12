'use strict';
/* Lumen Layout — objects anchored in text: inline tables (flow across frames with repeating header
   rows), inline / above-line graphics, and footnotes. Each is a single character in the story
   (U+FFFC object replacement / U+E001 footnote reference) whose attribute points at story.objs / story.notes. */
const Objects = (() => {
  const T = () => Tools.T;
  const info = id => S.eng.idx.get(id);
  function editFrame() { return S.edit ? info(S.edit.fid)?.item : null; }
  function columnWidth(it, pe) {
    const cols = Math.max(1, it.cols | 0 || 1), inset = it.inset || 0, g = it.gutter ?? 12;
    return Math.max(24, (it.w - inset * 2 - g * (cols - 1)) / cols - (pe?.indL || 0) - (pe?.indR || 0));
  }
  // insert an object character at the caret; block objects get a paragraph of their own
  function insertObj(o, block, label) {
    const s = T().story(); if (!s) return null;
    let [a, b] = T().range(); if (a !== b) M.deleteRange(s, a, b);
    s.objs = s.objs || {};
    let pos = a;
    const plain = M.plainAttr(s, s.ca[pos - 1] ?? s.ca[pos] ?? 0);
    if (block && pos > M.paraStart(s, M.paraIndexAt(s, pos))) { M.insertText(s, pos, '\n', plain); pos++; }
    const id = 'O' + M.uid(); o.id = id; s.objs[id] = o;
    M.insertText(s, pos, '￼', M.attrIdx(s, { ...s.attrs[plain], obj: id })); pos++;
    if (block && pos < s.text.length && s.text[pos] !== '\n') M.insertText(s, pos, '\n', plain);
    S.edit.a = S.edit.f = pos; S.edit.typing = null;
    commit(label); T().sync();
    return id;
  }
  function insertInlineTable(cols, rows, header) {
    const it = editFrame(); if (!it) return;
    const s = T().story(), pe = M.paraEff(S.doc, s.paras[M.paraIndexAt(s, S.edit.f)]);
    const t = Tables.newInline(cols, rows, columnWidth(it, pe), header);
    if (S.doc.cmyk) { t.hfill = '@black/85'; t.zebra = '@black/6'; t.bcolor = '@black/35'; t.tcolor = '@black'; t.hcolor = '@paper'; if (!Color.swatch('black') || !Color.swatch('paper')) { t.hfill = '#1f3b57'; t.zebra = '#eef3f8'; t.bcolor = '#9fb0c2'; t.tcolor = '#1a1a1a'; t.hcolor = '#ffffff'; } }
    insertObj(t, true, 'Insert Inline Table');
  }
  // graphic from an image file or a copied shape
  function graphicFrom(src) {
    const it = editFrame(); const maxW = it ? columnWidth(it) : 200;
    if (src.img) { const im = S.images[src.img]; const k = Math.min(1, maxW / im.w, 220 / im.h); return { type: 'image', w: im.w * k, h: im.h * k, img: src.img, cs: k, cx: 0, cy: 0, fill: null, stroke: null, sw: 1, radius: 0 }; }
    const k = Math.min(1, maxW / Math.max(1, src.w));
    const g = { type: src.type, w: src.w * k, h: src.h * k, fill: src.fill ?? null, stroke: src.stroke ?? null, sw: src.sw ?? 1, radius: src.radius || 0 };
    if (src.type === 'image') Object.assign(g, { img: src.img || null, cs: (src.cs || 1) * k, cx: (src.cx || 0) * k, cy: (src.cy || 0) * k });
    return g;
  }
  async function insertGraphic() {
    if (!S.edit) { Aero.toast('Place the text cursor where the graphic should go'); return; }
    const f = await Aero.openFile({ accept: 'image/png,image/jpeg,image/svg+xml,image/webp,image/gif', filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'svg', 'webp', 'gif'] }] });
    if (!f[0] || !S.edit) return;
    let id; try { id = await addImage(f[0].name, f[0].type || '', f[0].data); } catch (e) { Aero.alert('Insert Graphic', e.message); return; }
    graphicDialog(graphicFrom({ img: id }), null);
  }
  // paste a copied image/shape object into text as an anchored graphic
  function pasteInline() {
    const src = S.clip && S.clip.items.length === 1 ? S.clip.items[0] : null;
    if (!S.edit || !src || !['image', 'rect', 'ellipse'].includes(src.type)) return false;
    insertObj({ kind: 'graphic', item: graphicFrom(src), pos: 'inline', align: 'left', shift: 0 }, false, 'Paste Inline Graphic');
    return true;
  }
  // options for a new graphic (o = item) or an existing anchored object (sid, id)
  function graphicDialog(item, ref) {
    const cur = ref ? S.doc.stories[ref.sid]?.objs?.[ref.id] : null; if (ref && !cur) return;
    const g = cur ? cur.item : item, u = S.doc.units;
    Aero.dialog({ title: cur ? 'Anchored Object Options' : 'Insert Graphic', fields: [
      { key: 'pos', label: 'Position', type: 'select', value: cur?.pos || 'inline', options: [['inline', 'Inline (moves with the text on the baseline)'], ['above', 'Above line (own line, aligned)']] },
      { key: 'align', label: 'Alignment (above line)', type: 'select', value: cur?.align || 'left', options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] },
      { key: 'w', label: `Width (${u})`, type: 'number', value: +M.fmtU(g.w, u), step: 0.1 }, { key: 'h', label: `Height (${u})`, type: 'number', value: +M.fmtU(g.h, u), step: 0.1 },
      { key: 'shift', label: `Baseline shift (${u})`, type: 'number', value: +M.fmtU(-(cur?.shift || 0), u), step: 0.1 }],
      ok: cur ? 'OK' : 'Insert',
      onOK: v => {
        const w = Math.max(1, M.fromU(v.w, u)), h = Math.max(1, M.fromU(v.h, u));
        const apply = (gi) => { if (gi.type === 'image' && gi.img) { const k = w / gi.w; gi.cs *= k; gi.cx *= k; gi.cy *= h / gi.h; } gi.w = w; gi.h = h; };
        if (cur) { const o = S.doc.stories[ref.sid].objs[ref.id]; apply(o.item); o.pos = v.pos; o.align = v.align; o.shift = -M.fromU(v.shift || 0, u); commit('Anchored Object Options'); return; }
        if (!S.edit) return;
        apply(item); insertObj({ kind: 'graphic', item, pos: v.pos, align: v.align, shift: -M.fromU(v.shift || 0, u) }, v.pos === 'above', 'Insert Graphic');
      } });
  }

  /* ---------- footnotes ---------- */
  function ensureFootnoteStyle() {
    if (!S.doc.paraStyles.footnote) S.doc.paraStyles.footnote = { name: 'Footnote', size: 7.5, lead: 9.5, hyph: true };
  }
  function insertFootnote() {
    if (!S.edit) { Aero.toast('Place the text cursor where the footnote reference goes'); return; }
    Aero.dialog({ title: 'Insert Footnote', instruction: 'The reference is numbered automatically and the note is set at the foot of the column', fields: [{ key: 't', label: 'Footnote text', type: 'textarea', value: '', rows: 4 }], ok: 'Insert',
      onOK: v => {
        if (!S.edit) return; const s = T().story(); if (!s) return;
        let [a, b] = T().range(); if (a !== b) M.deleteRange(s, a, b);
        ensureFootnoteStyle(); s.notes = s.notes || {};
        const id = 'N' + M.uid(); s.notes[id] = { text: String(v.t || '').trim() };
        const plain = M.plainAttr(s, s.ca[a - 1] ?? s.ca[a] ?? 0);
        M.insertText(s, a, '', M.attrIdx(s, { ...s.attrs[plain], fn: id }));
        S.edit.a = S.edit.f = a + 1; S.edit.typing = null; commit('Insert Footnote'); T().sync();
      } });
  }
  function noteAtCaret() {
    if (!S.edit) return null; const s = T().story(); const p = S.edit.f;
    for (const k of [p - 1, p]) if (s.text[k] === '') { const id = s.attrs[s.ca[k]]?.fn; if (id && s.notes?.[id]) return { sid: s.id, id }; }
    return null;
  }
  function editFootnote(ref) {
    ref = ref || noteAtCaret(); if (!ref) { Aero.toast('Put the text cursor next to a footnote reference'); return; }
    const n = S.doc.stories[ref.sid]?.notes?.[ref.id]; if (!n) return;
    Aero.dialog({ title: 'Edit Footnote', fields: [{ key: 't', label: 'Footnote text', type: 'textarea', value: n.text, rows: 4 }],
      onOK: v => { const x = S.doc.stories[ref.sid]?.notes?.[ref.id]; if (x) { x.text = String(v.t || ''); commit('Edit Footnote'); } } });
  }

  function footnoteOptions() {
    const o = S.doc.footnotes || { continuous: false, start: 1 };
    Aero.dialog({ title: 'Document Footnote Options', instruction: 'Notes that do not fit continue at the foot of the next column or frame', fields: [
      { key: 'mode', label: 'Numbering', type: 'select', value: o.continuous ? 'doc' : 'story', options: [['story', 'Restart in every story'], ['doc', 'Continuous through the document']] },
      { key: 'start', label: 'Start at', type: 'number', value: o.start || 1, min: 1, max: 100000 }],
      onOK: v => { S.doc.footnotes = { continuous: v.mode === 'doc', start: Math.max(1, v.start | 0) }; commit('Footnote Options'); } });
  }
  /* ---------- hit testing inside a text frame (frame-local coords) ---------- */
  function hitFrame(it, lx, ly) {
    const pp = placedOf(info(it.id).page); if (!pp) return null;
    const L = S.eng.frameLayout(it, labelFor(pp)); if (!L) return null;
    for (const ln of L.lines) {
      const b = ln.block;
      if (b && lx >= b.x && lx <= b.x + b.w && ly >= b.y && ly <= b.y + (b.kind === 'table' ? b.rh.reduce((x, y) => x + y, 0) : b.h)) {
        if (b.kind === 'table') { const rc = Tables.hit(b.obj, b.rows, b.rh, lx - b.x, ly - b.y); if (rc) return { kind: 'table', id: b.id, t: b.obj, r: rc[0], c: rc[1] }; }
        return { kind: 'graphic', id: b.id, sid: it.story };
      }
      if (ln.objs) for (const o of ln.objs) { const g = o.o.item, y0 = ln.y - g.h - (o.o.shift || 0); if (lx >= o.x && lx <= o.x + g.w && ly >= y0 && ly <= y0 + g.h) return { kind: 'graphic', id: o.id, sid: it.story }; }
    }
    for (const nb of L.notes || []) if (lx >= nb.x && lx <= nb.x + nb.w && ly >= nb.y) {
      let y = nb.y + Layout.FN_SEP; for (const n of nb.notes) { if (ly < y + n.h) return { kind: 'note', sid: it.story, id: n.id }; y += n.h; }
    }
    return null;
  }

  return { footnoteOptions, insertInlineTable, insertGraphic, pasteInline, graphicDialog, insertFootnote, editFootnote, noteAtCaret, hitFrame, columnWidth, ensureFootnoteStyle };
})();
