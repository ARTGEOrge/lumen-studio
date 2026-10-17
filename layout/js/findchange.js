'use strict';
/* Lumen Layout — Find/Change: a floating, non-modal panel that searches story text (plain text with
   ^p ^t ^n metacharacters, or GREP = JavaScript regular expressions with $1 back-references), optionally
   case-sensitive / whole-word / limited to a paragraph style, in the document, the current story or the
   selected text. Change can replace the text and/or apply a paragraph or character style; Change All is a
   single undoable step. Anchored objects, footnote references and page-number markers are never matched. */
const FindChange = (() => {
  const el = Aero.el, esc = Aero.esc;
  let panel = null, lastMsg = '';
  const opt = { find: '', change: '', grep: false, cs: false, word: false, scope: 'doc', inPs: '', setPs: '', setCs: '' };
  const PROTECTED = /[￼]/;
  const META = { p: '\n', t: '\t', n: ' ', '^': '^' };
  const meta = s => String(s).replace(/\^([ptn^])/g, (x, c) => META[c]);
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function regex(o = opt) {
    if (!o.find) return null;
    let src = o.grep ? o.find : reEsc(meta(o.find));
    if (o.word) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
    try { return new RegExp(src, 'gmu' + (o.cs ? '' : 'i')); } catch (e) { throw new Error('Invalid GREP expression: ' + e.message); }
  }
  // stories in reading order: by page of their first frame, then top-to-bottom / left-to-right; master stories last
  function orderedStories() {
    const d = S.doc, rows = [];
    for (const s of Object.values(d.stories)) {
      const f = S.eng.storyFrames(s)[0]; if (!f) continue;
      rows.push({ s, key: f.kind === 'doc' ? [f.index, Math.round(f.item.y), f.item.x] : [1e6, Math.round(f.item.y), f.item.x] });
    }
    rows.sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2]);
    return rows.map(r => r.s);
  }
  // [{s, a, b}] ranges to search
  function scopeRanges(o = opt) {
    if (o.scope === 'sel') { if (!S.edit) return []; const s = S.doc.stories[S.edit.sid]; const [a, b] = Tools.T.range(); return s && a < b ? [{ s, a, b }] : []; }
    if (o.scope === 'story') {
      const sid = S.edit ? S.edit.sid : UI.selItems().find(i => i.type === 'text')?.story;
      const s = sid && S.doc.stories[sid]; return s ? [{ s, a: 0, b: s.text.length }] : [];
    }
    return orderedStories().map(s => ({ s, a: 0, b: s.text.length }));
  }
  function matchesIn(s, a, b, re, o = opt) {
    const out = []; re.lastIndex = 0;
    const t = s.text.slice(0, b);
    re.lastIndex = a;
    let m;
    while ((m = re.exec(t))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      const i = m.index, j = i + m[0].length;
      if (PROTECTED.test(m[0])) continue;
      if (o.inPs && s.paras[M.paraIndexAt(s, i)]?.ps !== o.inPs) continue;
      out.push({ s, a: i, b: j, m: [...m] });
    }
    return out;
  }
  function allMatches(o = opt) { const re = regex(o); if (!re) return []; return scopeRanges(o).flatMap(r => matchesIn(r.s, r.a, r.b, re, o)); }
  // replacement text for one match ($1, $& … in GREP mode; ^p ^t ^n metacharacters in both modes)
  function replacement(mt, o = opt) {
    const tpl = meta(o.change);
    if (!o.grep) return tpl;
    return tpl.replace(/\$(\$|&|\d{1,2})/g, (x, g) => g === '$' ? '$' : g === '&' ? mt.m[0] : (mt.m[+g] ?? ''));
  }
  const formatting = o => !!(o.setPs || o.setCs);
  // apply one change in place; returns the new end position
  function applyOne(mt, o = opt) {
    const { s, a, b } = mt;
    let end = b;
    if (o.change || !formatting(o)) {
      const rep = replacement(mt, o);
      const ai = M.plainAttr(s, s.ca[a] ?? 0);
      const p0 = M.paraIndexAt(s, a), keepPara = { ...s.paras[p0] };
      M.deleteRange(s, a, b);
      end = rep ? M.insertText(s, a, rep, ai) : a;
      s.paras[p0] = keepPara;
    }
    if (o.setPs && S.doc.paraStyles[o.setPs]) { const p0 = M.paraIndexAt(s, a), p1 = M.paraIndexAt(s, Math.max(a, end - 1)); for (let k = p0; k <= p1; k++) s.paras[k] = { ps: o.setPs }; }
    if (o.setCs && S.doc.charStyles[o.setCs]) {
      const st = S.doc.charStyles[o.setCs];
      for (let i = a; i < end; i++) { const at = { ...s.attrs[s.ca[i]] }; for (const k in st) if (k !== 'name') delete at[k]; at.cs = o.setCs; s.ca[i] = M.attrIdx(s, at); }
    }
    return end;
  }
  // show a match: enter the frame that holds it and select the text
  function reveal(mt) {
    const T = Tools.T;
    let r = T.lineOf(mt.s.id, mt.a);
    const fid = r?.it?.id || mt.s.frames[0], inf = S.eng.idx.get(fid); if (!inf) return;
    if (inf.kind === 'doc' && (S.mode.kind !== 'doc' || S.curPage !== inf.index)) View.goPage(inf.index);
    else if (inf.kind === 'master' && (S.mode.kind !== 'master' || S.mode.id !== inf.master.id)) UI.editMaster(inf.master.id);
    const it = S.eng.idx.get(fid).item;
    T.enter(it, mt.a); S.edit.a = mt.a; S.edit.f = mt.b; T.sync(); T.ensureVisible();
    r = T.lineOf(mt.s.id, mt.a);
    return r && r.over ? ' (in overset text)' : '';
  }
  function curPos() { if (!S.edit) return null; const [a, b] = Tools.T.range(); return { sid: S.edit.sid, a, b }; }
  function findNext(o = opt) {
    const all = allMatches(o);
    if (!all.length) { msg(!o.find ? 'Type something to find' : !scopeRanges(o).length ? (o.scope === 'sel' ? 'Select some text to search in' : 'Click into a story to search it') : 'No matches'); return null; }
    const c = curPos(); let k = 0;
    if (c) {
      const order = new Map(scopeRanges(o).map((r, i) => [r.s.id, i])), cs = order.get(c.sid) ?? -1;
      k = all.findIndex(x => { const xs = order.get(x.s.id); return xs > cs || (xs === cs && (x.a > c.a || (x.a === c.a && x.b !== c.b && c.a === c.b))); });
      if (k < 0) k = 0;
    }
    const where = reveal(all[k]);
    msg(`Match ${k + 1} of ${all.length}${where || ''}`);
    return all[k];
  }
  // the current text selection, if it is exactly a match
  function selectedMatch(o = opt) {
    const c = curPos(); if (!c || c.a === c.b) return null;
    const s = S.doc.stories[c.sid], re = regex(o); if (!s || !re) return null;
    return matchesIn(s, c.a, s.text.length, re, o).find(m => m.a === c.a && m.b === c.b) || null;
  }
  function change(andFind, o = opt) {
    const mt = selectedMatch(o);
    if (!mt) { findNext(o); return false; }
    const end = applyOne(mt, o);
    S.edit.a = mt.a; S.edit.f = end; commit('Change'); Tools.T.sync();
    if (andFind) { const n = findNext(o); if (!n) msg('Changed 1 · no more matches'); }
    else msg('Changed 1 match');
    return true;
  }
  function changeAll(o = opt) {
    let all;
    try { all = allMatches(o); } catch (e) { msg(e.message); return 0; }
    if (!all.length) { msg('No matches'); return 0; }
    // last to first so earlier positions stay valid
    const by = new Map(); for (const m of all) { const l = by.get(m.s) || []; l.push(m); by.set(m.s, l); }
    for (const [s, l] of by) l.sort((x, y) => y.a - x.a).forEach(m => applyOne(m, o));
    if (S.edit) { const s = S.doc.stories[S.edit.sid]; if (s) { S.edit.a = Math.min(S.edit.a, s.text.length); S.edit.f = Math.min(S.edit.f, s.text.length); } }
    commit('Change All'); if (S.edit) Tools.T.sync();
    msg(`Changed ${all.length} match${all.length === 1 ? '' : 'es'} in ${by.size} stor${by.size === 1 ? 'y' : 'ies'}`);
    Aero.toast(lastMsg);
    return all.length;
  }
  function msg(t) { lastMsg = t; const m = panel?.querySelector('.fc-msg'); if (m) m.textContent = t; }
  function styleOpts(map, none) { return `<option value="">${esc(none)}</option>` + Object.entries(map).map(([k, v]) => `<option value="${esc(k)}">${esc(v.name || k)}</option>`).join(''); }
  function open() {
    if (panel) { panel.querySelector('#fc-find').focus(); panel.querySelector('#fc-find').select(); return; }
    if (S.edit) { const t = Tools.T.selectedText(); if (t && t.length < 200 && !/\n/.test(t)) opt.find = opt.grep ? reEsc(t) : t.replace(/\^/g, '^^'); }
    panel = el('div', 'tabpanel fcpanel');
    panel.innerHTML = `<div class="fc-head"><b>Find/Change</b><span style="flex:1"></span><button class="aero-btn small" id="fc-close" title="Close (Esc)">✕</button></div>
      <div class="fc-grid">
        <label for="fc-find">Find what</label><input id="fc-find" type="text" spellcheck="false" placeholder="text, ^p ^t ^n — or a GREP pattern">
        <label for="fc-change">Change to</label><input id="fc-change" type="text" spellcheck="false" placeholder="(empty = delete, or only change formatting)">
        <label for="fc-scope">Search</label><select id="fc-scope"><option value="doc">Document</option><option value="story">Story</option><option value="sel">Selected text</option></select>
        <label for="fc-inps">In paragraph style</label><select id="fc-inps"></select>
        <label for="fc-setps">Change paragraph style</label><select id="fc-setps"></select>
        <label for="fc-setcs">Change character style</label><select id="fc-setcs"></select>
      </div>
      <div class="fc-row"><label><input type="checkbox" id="fc-cs">Case sensitive</label><label><input type="checkbox" id="fc-word">Whole word</label><label title="Regular expressions; use $1, $2 … in Change to"><input type="checkbox" id="fc-grep">GREP</label></div>
      <div class="fc-row fc-btns"><button class="aero-btn small pri" id="fc-next">Find Next</button><button class="aero-btn small" id="fc-chg">Change</button><button class="aero-btn small" id="fc-chgf">Change/Find</button><button class="aero-btn small" id="fc-all">Change All</button></div>
      <div class="fc-msg dim"></div>`;
    $('#stagewrap').appendChild(panel);
    const q = s => panel.querySelector(s);
    q('#fc-inps').innerHTML = styleOpts(S.doc.paraStyles, '— any —'); q('#fc-setps').innerHTML = styleOpts(S.doc.paraStyles, '— leave unchanged —'); q('#fc-setcs').innerHTML = styleOpts(S.doc.charStyles, '— leave unchanged —');
    if (S.edit && Tools.T.range()[0] < Tools.T.range()[1] && /\n/.test(Tools.T.selectedText())) opt.scope = 'sel';
    q('#fc-find').value = opt.find; q('#fc-change').value = opt.change; q('#fc-scope').value = opt.scope; q('#fc-inps').value = opt.inPs; q('#fc-setps').value = opt.setPs; q('#fc-setcs').value = opt.setCs;
    q('#fc-cs').checked = opt.cs; q('#fc-word').checked = opt.word; q('#fc-grep').checked = opt.grep;
    const read = () => { opt.find = q('#fc-find').value; opt.change = q('#fc-change').value; opt.scope = q('#fc-scope').value; opt.inPs = q('#fc-inps').value; opt.setPs = q('#fc-setps').value; opt.setCs = q('#fc-setcs').value; opt.cs = q('#fc-cs').checked; opt.word = q('#fc-word').checked; opt.grep = q('#fc-grep').checked; };
    panel.addEventListener('input', read); panel.addEventListener('change', read);
    const guard = fn => () => { read(); try { fn(); } catch (e) { msg(e.message); } q('#fc-find').focus({ preventScroll: true }); };
    q('#fc-next').onclick = guard(() => findNext()); q('#fc-chg').onclick = guard(() => change(false)); q('#fc-chgf').onclick = guard(() => change(true)); q('#fc-all').onclick = guard(() => changeAll());
    q('#fc-close').onclick = close;
    panel.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'Enter' && e.target.tagName === 'INPUT') { e.preventDefault(); q('#fc-next').click(); } });
    for (const b of panel.querySelectorAll('button')) b.addEventListener('mousedown', e => e.preventDefault());
    q('#fc-find').focus(); q('#fc-find').select();
    msg(S.edit ? 'Enter finds the next match after the text cursor' : 'Enter finds the first match');
  }
  function close() { panel?.remove(); panel = null; }
  return { open, close, findNext, change, changeAll, allMatches, regex, replacement, opt, get isOpen() { return !!panel; }, get message() { return lastMsg; } };
})();
