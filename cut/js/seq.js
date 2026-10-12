'use strict';
/* Lumen Cut — multiple sequences and nesting: sequence tabs above the timeline, New/Rename/Delete Sequence,
   Nest (selected clips → new sequence + nested clip), opening a nested clip, and sequences in the Project panel. */
(function () {
  const $ = Aero.$, esc = Aero.esc, tl = LC.tl;

  /* make sequence `id` the active one (its data moves to the top level of LC.project) */
  LC.switchSeq = (id, opts = {}) => {
    const P = LC.project; if (id === P.seqId) return;
    const s = LC.seqEntry(id); if (!s) return;
    LC.stop(); LC.src?.pause();
    const cur = LC.activeSeq(); LC.syncSeq(); if (cur) cur.playhead = LC.playhead;
    LC.SEQ_FIELDS.forEach(k => P[k] = s[k]); P.seqId = id;
    tl.sel.clear(); tl.selTr = null; LC.playhead = s.playhead ?? 0;
    LC.mon.layout(); LC.refresh(); setTimeout(() => tl.zoomFit(), 0);
    if (!opts.quiet) LC.statusMsg('Sequence: ' + s.name);
  };
  LC.newSequence = async (name) => {
    if (name == null) { name = await Aero.prompt('New Sequence', 'Name', 'Sequence ' + (LC.project.sequences.length + 1)); if (name == null) return null; }
    LC.syncSeq();
    const s = LC.newSeqData(String(name || 'Sequence').slice(0, 120)); LC.project.sequences.push(s);
    LC.switchSeq(s.id, { quiet: true }); LC.commit('New sequence'); LC.refresh();
    return s;
  };
  LC.renameSeq = async (id = LC.project.seqId) => {
    const s = LC.seqEntry(id); if (!s) return;
    const n = await Aero.prompt('Rename Sequence', 'Name', s.name); if (!n) return;
    s.name = n.slice(0, 120); LC.commit('Rename sequence'); LC.refresh();
  };
  LC.deleteSeq = async (id = LC.project.seqId) => {
    const P = LC.project, s = LC.seqEntry(id); if (!s) return;
    if (P.sequences.length < 2) return Aero.toast('A project needs at least one sequence');
    LC.syncSeq();
    const uses = P.sequences.reduce((n, q) => n + LC.seqClips(q.id).filter(c => c.type === 'nest' && c.seq === id).length, 0);
    if (!(await Aero.confirm('Delete Sequence', `Delete “${s.name}”${uses ? ` and the ${uses} nested clip${uses > 1 ? 's' : ''} that use it` : ''}?`, 'Delete'))) return;
    if (id === P.seqId) LC.switchSeq(P.sequences.find(q => q.id !== id).id, { quiet: true });
    P.sequences = P.sequences.filter(q => q.id !== id);
    for (const q of P.sequences) LC.withSeq(q.id, () => { const ids = LC.project.clips.filter(c => c.type === 'nest' && c.seq === id).map(c => c.id); if (ids.length) { LC.removeClips(ids); LC.cleanTransitions(); } });
    tl.sel.clear(); LC.commit('Delete sequence'); LC.refresh();
  };
  LC.openNest = c => { if (c?.type === 'nest' && LC.seqEntry(c.seq)) { const t = LC.srcTime(c, Math.min(Math.max(LC.playhead, c.start), c.start + c.dur)); LC.switchSeq(c.seq); LC.setPlayhead(Math.max(0, LC.fr(t))); } };

  /* Nest: move the selected clips into a new sequence and replace them with nested clips */
  LC.nestSelection = async (name) => {
    const P = LC.project, sel = tl.selected().filter(c => !LC.track(c.track).lock);
    if (!sel.length) return Aero.toast('Select the clips to nest'), null;
    if (name == null) { name = await Aero.prompt('Nest', 'Nested sequence name', 'Nested Sequence ' + P.sequences.length); if (name == null) return null; }
    const { s, made } = LC.nestClips(sel, name);
    tl.select(made.map(c => c.id));
    LC.commit('Nest'); LC.refresh(); Aero.toast(`Nested ${sel.length} clip${sel.length > 1 ? 's' : ''} into “${s.name}” — double-click to open it`);
    return s;
  };
  /* data part of Nest (no UI): returns {s, made} */
  LC.nestClips = (sel, name) => {
    const P = LC.project;
    const ids = new Set(sel.map(c => c.id)), t0 = Math.min(...sel.map(c => c.start)), t1 = Math.max(...sel.map(c => c.start + c.dur));
    // inner sequence mirrors the track layout (new ids) so clips keep their stacking
    LC.syncSeq();
    const s = { id: 's' + Aero.uid(), name: String(name || 'Nested Sequence').slice(0, 120), clips: [], transitions: [], markers: [], inPoint: null, outPoint: null };
    const tmap = new Map(); s.tracks = P.tracks.map(t => { const n = { ...JSON.parse(JSON.stringify(t)), id: 't' + Aero.uid(), lock: false, mute: false, solo: false, vol: 0, pan: 0, kf: {} }; tmap.set(t.id, n.id); return n; });   // mixing happens on the outer tracks
    s.clips = sel.map(c => { const x = JSON.parse(JSON.stringify(c)); x.track = tmap.get(c.track); x.start = LC.fr(c.start - t0); return x; });
    s.transitions = P.transitions.filter(tr => (!tr.a || ids.has(tr.a)) && (!tr.b || ids.has(tr.b))).map(tr => ({ ...tr, track: tmap.get(tr.track) }));
    P.sequences.push(s);
    LC.removeClips([...ids]);
    const vSel = sel.filter(c => LC.track(c.track).kind === 'video'), aSel = sel.filter(c => LC.track(c.track).kind === 'audio');
    const link = vSel.length && aSel.length ? 'l' + Aero.uid() : null, made = [];
    const lowest = (list, kind) => { const order = kind === 'video' ? LC.videoTracks() : LC.audioTracks(); return order.find(t => list.some(c => c.track === t.id)); };
    for (const [list, kind] of [[vSel, 'video'], [aSel, 'audio']]) {
      if (!list.length) continue;
      const tr = lowest(list, kind); LC.overwriteRange(tr.id, t0, t1);
      const c = LC.makeClip({ track: tr.id, type: 'nest', seq: s.id, start: LC.fr(t0), in: 0, dur: LC.fr(t1 - t0), link, name: s.name });
      P.clips.push(c); made.push(c);
    }
    LC.cleanTransitions();
    return { s, made };
  };

  /* ---------- sequence tabs ---------- */
  LC.renderSeqTabs = () => {
    const box = $('#seqtabs'); if (!box || !LC.project) return;
    const P = LC.project; box.innerHTML = '';
    for (const s of P.sequences) {
      const tab = Aero.el('span', 'seqtab' + (s.id === P.seqId ? ' on' : ''), '<i></i><span></span>');
      tab.querySelector('span').textContent = s.name; tab.title = s.name + ' — double-click to rename, right-click for more';
      tab.onclick = () => LC.switchSeq(s.id);
      tab.ondblclick = () => LC.renameSeq(s.id);
      tab.oncontextmenu = e => { e.preventDefault(); LC.ctxMenu(e.clientX, e.clientY, [['Open', () => LC.switchSeq(s.id)], ['Rename…', () => LC.renameSeq(s.id)], ['Delete…', () => LC.deleteSeq(s.id)], '-', ['New Sequence…', () => LC.newSequence()]]); };
      tab.draggable = s.id !== P.seqId;
      tab.ondragstart = e => { LC.drag = { kind: 'seq', id: s.id }; e.dataTransfer.setData('text/x-lcut', 'seq'); e.dataTransfer.effectAllowed = 'copy'; };
      tab.ondragend = () => { LC.drag = null; tl.dropGhost = null; tl.draw(); };
      box.appendChild(tab);
    }
    const add = Aero.el('button', 'seqadd', '+'); add.title = 'New sequence'; add.onclick = () => LC.newSequence(); box.appendChild(add);
  };

  /* ---------- sequences in the Project panel ---------- */
  const seqIcon = '<svg viewBox="0 0 16 16"><rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="#3aa79c" stroke="#1f6f68"/><path d="M3.5 6h5M3.5 8.5h8M3.5 11h3.5" stroke="#fff" stroke-width="1.4"/></svg>';
  LC.binSequences = (box, filter) => {
    const P = LC.project;
    for (const s of P.sequences) {
      if (filter && !s.name.toLowerCase().includes(filter)) continue;
      const d = Aero.el('div', 'aero-item binitem binseq' + (s.id === P.seqId ? ' active' : ''));
      const dur = LC.seqDur(s.id);
      d.innerHTML = `<div class="bthumb seqthumb">${seqIcon}<span class="bdur">${LC.tc(dur)}</span></div><div class="bmeta"><div class="bname">${seqIcon}<span></span></div><div class="dim">${s.id === P.seqId ? 'Open in timeline' : 'Sequence · drag to nest'}</div></div>`;
      d.querySelector('.bname span').textContent = s.name; d.title = s.name;
      d.draggable = s.id !== P.seqId;
      d.ondragstart = e => { LC.drag = { kind: 'seq', id: s.id }; e.dataTransfer.setData('text/x-lcut', 'seq'); e.dataTransfer.effectAllowed = 'copy'; };
      d.ondragend = () => { LC.drag = null; tl.dropGhost = null; tl.draw(); };
      d.ondblclick = () => LC.switchSeq(s.id);
      d.oncontextmenu = e => { e.preventDefault(); LC.ctxMenu(e.clientX, e.clientY, [['Open in Timeline', () => LC.switchSeq(s.id)], ['Insert as Nested Clip at Playhead', () => LC.placeSeq(s.id, LC.playhead, null, 'insert')], ['Overwrite as Nested Clip at Playhead', () => LC.placeSeq(s.id, LC.playhead, null, 'overwrite')], '-', ['Rename…', () => LC.renameSeq(s.id)], ['Delete…', () => LC.deleteSeq(s.id)]]); };
      box.appendChild(d);
    }
  };
})();
