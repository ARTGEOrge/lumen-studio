'use strict';
/* Lumen Sound — application core: document model, editing operations, transport, panels, menus, files. */
(() => {
  const { $, el, esc, clamp, uid } = Aero;
  const App = window.App = {
    doc: null, sel: { a: 0, b: 0 }, view: { start: 0, spp: 1, vzoom: 1 }, chOn: [], selMarker: null,
    settings: { viewMode: 'wave', logFreq: true, cmap: 'aurora', fft: 2048, follow: true, snapZero: false, loop: false, xfadeMs: 5, specFloor: -110 },
    mode: 'wave', clipboard: null, noiseProfile: null, projectName: 'Untitled', projectPath: null, rack: Rack.empty(), specSel: null, liveChain: null
  };
  const st = (id, t) => { const e = document.getElementById(id); if (e) e.textContent = t; };
  const fmt = s => Aero.fmtTime(s).replace(/(\.\d\d)$/, '$1');
  function fmtT(sec) { const neg = sec < 0; sec = Math.abs(sec); const m = Math.floor(sec / 60), s = sec - m * 60; return (neg ? '-' : '') + `${m}:${s.toFixed(3).padStart(6, '0')}`; }
  function parseT(str) {
    str = String(str).trim(); if (!str) return NaN;
    const parts = str.split(':').map(Number); if (parts.some(isNaN)) return NaN;
    return parts.reduce((a, v) => a * 60 + v, 0);
  }
  App.fmtT = fmtT; App.parseT = parseT;
  const len = () => App.doc ? App.doc.chs[0].length : 0;
  const tick = () => new Promise(r => setTimeout(r, 20));
  App.tick = tick;

  /* ================= history ================= */
  const whist = new Aero.History({ max: 60, onChange: () => renderHist() });
  App.whist = whist;
  function snapshot(sel = App.sel) { const d = App.doc; return { chs: d.chs, sr: d.sr, markers: d.markers.map(m => ({ ...m })), sel: { ...sel }, rack: Rack.clone(App.rack) }; }
  function restore(s) {
    if (!s) return; const d = App.doc;
    d.chs = s.chs; d.sr = s.sr; d.markers = s.markers.map(m => ({ ...m })); App.sel = { ...s.sel };
    App.rack = Rack.clone(s.rack); App.specSel = null; Rack.refresh();
    if (App.chOn.length !== d.chs.length) App.chOn = d.chs.map(() => true);
    afterDocChange();
  }
  function commit(label, chs, opts = {}) {
    const d = App.doc;
    if (chs) d.chs = chs;
    if (opts.sr) d.sr = opts.sr;
    if (opts.sel) App.sel = opts.sel;
    if (App.chOn.length !== d.chs.length) App.chOn = d.chs.map(() => true);
    const bytes = d.chs.length * len() * 4; whist.max = clamp(Math.floor(900e6 / Math.max(1, bytes)), 6, 100);
    whist.push(label, snapshot());
    afterDocChange();
    Aero.toast(label);
  }
  App.commit = commit;
  function afterDocChange() {
    const d = App.doc; if (!d) return;
    const n = len(); App.sel.a = clamp(App.sel.a, 0, n); App.sel.b = clamp(App.sel.b, App.sel.a, n);
    Engine.stop(); paused = null; bufCache = null;
    Wave.clampView(); Wave.invalidate(true); refreshPanels(); scheduleAnalysis();
  }
  function renderHist() {
    const h = App.mode === 'multi' ? Multi.hist : whist;
    Aero.renderHistory($('#hist'), h, i => { if (App.mode === 'multi') Multi.go(i); else restore(whist.go(i)); });
    st('histinfo', h.items.length + (h.items.length === 1 ? ' state' : ' states'));
  }
  App.renderHist = renderHist;
  function undo() { if (App.mode === 'multi') return Multi.undo(); const s = whist.undo(); if (s) { restore(s); Aero.toast('Undo'); } }
  function redo() { if (App.mode === 'multi') return Multi.redo(); const s = whist.redo(); if (s) { restore(s); Aero.toast('Redo'); } }

  /* ================= document ================= */
  function setDoc({ name, sr, chs, markers = [], bits = '32-bit float', codec, rack }, label = 'Open') {
    Engine.stop(); paused = null;
    App.doc = { name, sr, chs, bits, codec, markers: markers.map(m => ({ id: uid(), time: m.time, label: m.label })) };
    App.rack = Rack.sanitize(rack); App.specSel = null;
    App.chOn = chs.map(() => true); App.sel = { a: 0, b: 0 }; App.selMarker = null;
    App.view = { start: 0, spp: chs[0].length / Math.max(100, Wave.waveW()), vzoom: 1 };
    whist.max = clamp(Math.floor(900e6 / Math.max(1, chs.length * chs[0].length * 4)), 6, 100);
    whist.reset(label, snapshot());
    bufCache = null;
    setMode('wave');
    Wave.resize(); Wave.zoomFit(); refreshPanels(); scheduleAnalysis(); renderHist(); Rack.refresh();
  }
  App.setDoc = setDoc;
  function ensureDoc() { if (!App.doc) { Aero.toast('Open or record an audio file first'); return false; } return true; }
  App.ensureDoc = ensureDoc;
  function hasSel() { return App.sel.b > App.sel.a; }
  App.hasSel = hasSel;
  // processing range: selection, or the whole file
  function procRange() { return hasSel() ? [App.sel.a, App.sel.b] : [0, len()]; }
  App.procRange = procRange;
  const onIdx = () => App.doc.chs.map((_, i) => i).filter(i => App.chOn[i] !== false);
  App.onIdx = onIdx;
  /* Process the selected range of the enabled channels with fn(segs, sr) → segs (same length). */
  async function applyProc(label, fn, opts = {}) {
    if (!ensureDoc()) return;
    const [a, b] = opts.range || procRange(); if (b - a < 1) return Aero.toast('Nothing to process');
    const ids = onIdx(); if (!ids.length) return Aero.toast('All channels are disabled');
    const big = (b - a) * ids.length > 2e6;
    if (big) { Aero.busy(label + '…'); await tick(); }
    try {
      const segs = ids.map(i => App.doc.chs[i].slice(a, b));
      const res = await fn(segs, App.doc.sr);
      if (!res) return;
      const chs = App.doc.chs.map((c, i) => { const k = ids.indexOf(i); if (k < 0) return c; const r = res[k]; if (a === 0 && b === c.length && r.length === c.length && r !== segs[k] || (a === 0 && b === c.length && r.length === c.length)) return r instanceof Float32Array ? r : Float32Array.from(r); const n = c.slice(); n.set(r.length > b - a ? r.subarray(0, b - a) : r, a); return n; });
      opts.beforeCommit?.();
      commit(label, chs);
    } catch (e) { console.warn(e); Aero.alert(label, 'The operation failed: ' + e.message); }
    finally { if (big) Aero.busy(); }
  }
  App.applyProc = applyProc;
  /* Replace [a,b) on all channels with new segments (length may change). Markers after b shift. */
  function replaceRange(label, a, b, segs, opts = {}) {
    const d = App.doc, nl = segs[0].length, delta = nl - (b - a);
    const chs = d.chs.map((c, i) => { const s = segs[i] || segs[0]; const o = new Float32Array(c.length + delta); o.set(c.subarray(0, a)); o.set(s, a); o.set(c.subarray(b), a + nl); return o; });
    d.markers = d.markers.map(m => { const s = m.time * d.sr; if (s >= b) return { ...m, time: (s + delta) / d.sr }; if (s > a) return { ...m, time: (a + Math.min(nl, s - a)) / d.sr }; return m; });
    commit(label, chs, { sel: opts.sel || { a, b: a + nl } });
  }
  App.replaceRange = replaceRange;

  /* ================= editing ================= */
  const xfN = () => Math.round(App.doc.sr * (App.settings.xfadeMs || 0) / 1000);
  const xf = t => 0.5 - 0.5 * Math.cos(Math.PI * t); // S-curve: sums to 1 for correlated material
  function copySel() { if (!ensureDoc()) return false; if (!hasSel()) { Aero.toast('Make a selection first'); return false; } const { a, b } = App.sel; App.clipboard = { sr: App.doc.sr, chs: App.doc.chs.map(c => c.slice(a, b)) }; return true; }
  function copy() { if (copySel()) Aero.toast(`Copied ${fmtT((App.sel.b - App.sel.a) / App.doc.sr)}`); }
  function cut() { if (copySel()) deleteSel('Cut'); }
  function deleteSel(label = 'Delete') {
    if (!ensureDoc()) return; if (!hasSel()) return Aero.toast('Make a selection first');
    const d = App.doc, { a, b } = App.sel, N = Math.min(xfN(), b - a, len() - b);
    const chs = d.chs.map(c => {
      const o = new Float32Array(c.length - (b - a)); o.set(c.subarray(0, a)); o.set(c.subarray(b), a);
      for (let i = 0; i < N; i++) { const t = xf((i + 0.5) / N); o[a + i] = c[b + i] * t + c[a + i] * (1 - t); } // crossfade the join
      return o;
    });
    d.markers = d.markers.filter(m => { const s = m.time * d.sr; return s < a || s >= b; }).map(m => m.time * d.sr >= b ? { ...m, time: m.time - (b - a) / d.sr } : m);
    commit(label, chs, { sel: { a, b: a } });
  }
  function clipFor(d) {
    let cb = App.clipboard; if (!cb) return null;
    let chs = cb.chs;
    if (cb.sr !== d.sr) chs = chs.map(c => DSP.resample(c, d.sr / cb.sr));
    const n = d.chs.length;
    if (chs.length !== n) {
      if (chs.length === 1) chs = Array.from({ length: n }, () => chs[0]);
      else if (n === 1) { const m = new Float32Array(chs[0].length); chs.forEach(c => { for (let i = 0; i < m.length; i++) m[i] += c[i] / chs.length; }); chs = [m]; }
      else chs = Array.from({ length: n }, (_, i) => chs[i % chs.length]);
    }
    return chs;
  }
  function paste() {
    if (!App.clipboard) return Aero.toast('Clipboard is empty');
    if (!App.doc) { setDoc({ name: 'Pasted', sr: App.clipboard.sr, chs: App.clipboard.chs.map(c => c.slice()) }, 'Paste'); return; }
    const d = App.doc, clip = clipFor(d), L = clip[0].length, { a, b } = App.sel, n = len();
    const N = Math.min(xfN(), Math.floor(L / 2));
    const chs = d.chs.map((c, ci) => {
      const k = clip[ci], o = new Float32Array(n - (b - a) + L);
      o.set(c.subarray(0, a)); o.set(k, a); o.set(c.subarray(b), a + L);
      // crossfade on paste joins: fade the old material out over the clip head, and back in over the clip tail
      for (let i = 0; i < N; i++) {
        const t = xf((i + 0.5) / N);
        if (a > 0 && a + i < n) o[a + i] = k[i] * t + c[a + i] * (1 - t);
        if (b < n && b - N + i >= 0) o[a + L - N + i] = k[L - N + i] * (1 - t) + c[b - N + i] * t;
      }
      return o;
    });
    d.markers = d.markers.filter(m => { const s = m.time * d.sr; return s < a || s >= b; }).map(m => m.time * d.sr >= b ? { ...m, time: m.time + (L - (b - a)) / d.sr } : m);
    commit('Paste', chs, { sel: { a, b: a + L } });
  }
  function mixPaste() {
    if (!App.clipboard) return Aero.toast('Clipboard is empty'); if (!ensureDoc()) return;
    const d = App.doc, clip = clipFor(d), L = clip[0].length, a = App.sel.a, n = Math.max(len(), a + L);
    const chs = d.chs.map((c, ci) => { const o = new Float32Array(n); o.set(c); const k = clip[ci]; for (let i = 0; i < L; i++) o[a + i] += k[i]; return o; });
    commit('Mix Paste', chs, { sel: { a, b: a + L } });
  }
  function crop() {
    if (!ensureDoc()) return; if (!hasSel()) return Aero.toast('Make a selection first');
    const d = App.doc, { a, b } = App.sel;
    d.markers = d.markers.filter(m => m.time * d.sr >= a && m.time * d.sr <= b).map(m => ({ ...m, time: m.time - a / d.sr }));
    commit('Crop', d.chs.map(c => c.slice(a, b)), { sel: { a: 0, b: 0 } });
    Wave.zoomFit();
  }
  function selectAll() { if (!ensureDoc()) return; setSel(0, len(), true); }
  function deselect() { if (!App.doc) return; setSel(App.sel.a, App.sel.a, true); }
  async function insertSilence() {
    if (!ensureDoc()) return;
    Aero.dialog({ title: 'Insert Silence', instruction: 'Insert silence at the cursor.', fields: [{ key: 'd', label: 'Duration (seconds)', type: 'number', value: 1, min: 0.001, max: 3600, step: 0.1 }], onOK: v => {
      const n = Math.round(clamp(v.d, 0.001, 3600) * App.doc.sr), a = App.sel.a;
      replaceRange('Insert Silence', a, a, App.doc.chs.map(() => new Float32Array(n)));
    } });
  }
  function silence() {
    if (!ensureDoc()) return; if (!hasSel()) return Aero.toast('Make a selection first');
    applyProc('Silence', segs => segs.map(s => new Float32Array(s.length)));
  }
  function trimSilence() {
    if (!ensureDoc()) return;
    Aero.dialog({ title: 'Trim Silence', instruction: 'Remove leading and trailing audio below a threshold.', fields: [
      { key: 'thr', label: 'Threshold (dBFS)', type: 'range', min: -90, max: -10, step: 1, value: -50, fmt: v => v + ' dB' },
      { key: 'pad', label: 'Keep padding (ms)', type: 'number', value: 50, min: 0, max: 2000, step: 10 }],
      onOK: v => {
        const d = App.doc, thr = DSP.dbToLin(v.thr), n = len(); let a = 0, b = n;
        const loud = i => d.chs.some(c => Math.abs(c[i]) > thr);
        while (a < n && !loud(a)) a++; while (b > a && !loud(b - 1)) b--;
        if (a >= b) return Aero.toast('The whole file is below the threshold');
        const pad = Math.round(v.pad / 1000 * d.sr); a = Math.max(0, a - pad); b = Math.min(n, b + pad);
        if (a === 0 && b === n) return Aero.toast('Nothing to trim');
        d.markers = d.markers.filter(m => m.time * d.sr >= a && m.time * d.sr <= b).map(m => ({ ...m, time: m.time - a / d.sr }));
        commit('Trim Silence', d.chs.map(c => c.slice(a, b)), { sel: { a: 0, b: 0 } }); Wave.zoomFit();
      } });
  }
  App.ops = { cut, copy, paste, mixPaste, deleteSel, crop, selectAll, deselect, insertSilence, silence, trimSilence };

  /* ================= selection / markers ================= */
  function setSel(a, b, final) {
    if (!App.doc) return;
    const n = len(); a = clamp(Math.round(a), 0, n); b = clamp(Math.round(b), 0, n); if (b < a) [a, b] = [b, a];
    App.sel = { a, b };
    if (final) { paused = null; if (Engine.playing() && Engine.current()?.kind === 'wave' && b === a) play(); }
    Wave.invalidate(false); refreshSelPane(); if (final) scheduleAnalysis();
  }
  App.setSel = setSel;
  App.seek = (s, scrub) => { setSel(s, s, !scrub); };
  App.toggleChannel = c => { App.chOn[c] = App.chOn[c] === false; if (!App.chOn.some(Boolean)) App.chOn[c] = true; Wave.invalidate(true); Aero.toast(`${Wave.chName(c, App.doc.chs.length)} channel ${App.chOn[c] ? 'enabled' : 'disabled'} for editing`); };
  App.viewChanged = () => { refreshStatus(); };
  App.hover = (s, lane, y) => {
    if (!App.doc) return;
    let t = `${fmtT(Math.max(0, s) / App.doc.sr)}`;
    if (lane && lane.kind === 'wave') { const amp = (lane.y + lane.h / 2 - y) / (lane.h / 2) / (App.view.vzoom || 1); t += `  ·  ${DSP.linToDb(amp).toFixed(1)} dB`; }
    if (lane && lane.kind === 'spec') { const f = yToFreqPublic(y - lane.y, lane.h); t += `  ·  ${f >= 1000 ? (f / 1000).toFixed(2) + ' kHz' : Math.round(f) + ' Hz'}`; }
    st('st-hover', t);
  };
  function yToFreqPublic(y, h) { const ny = App.doc.sr / 2; if (App.settings.logFreq) return 20 * Math.pow(ny / 20, 1 - y / h); return ny * (1 - y / h); }
  App.tool = () => tools.get();
  function addMarker() {
    if (!ensureDoc()) return;
    const d = App.doc, t = (playheadSample() ?? App.sel.a) / d.sr;
    const m = { id: uid(), time: t, label: `Marker ${d.markers.length + 1}` };
    d.markers.push(m); d.markers.sort((a, b) => a.time - b.time); App.selMarker = m.id;
    markersChanged('Add Marker');
  }
  function markersChanged(label) { App.doc.markers.sort((a, b) => a.time - b.time); whist.push(label, snapshot()); refreshMarkers(); Wave.invalidate(false); }
  App.markersChanged = markersChanged;
  App.selectMarker = id => { App.selMarker = id; const m = App.doc.markers.find(m => m.id === id); if (m) setSel(m.time * App.doc.sr, m.time * App.doc.sr, true); refreshMarkers(); };
  App.renameMarker = async id => {
    const m = App.doc?.markers.find(m => m.id === id); if (!m) return;
    const v = await Aero.prompt('Rename Marker', 'Label', m.label); if (v == null) return;
    m.label = v.trim().slice(0, 120) || m.label; markersChanged('Rename Marker');
  };
  function deleteMarker() {
    const d = App.doc; if (!d) return; const i = d.markers.findIndex(m => m.id === App.selMarker); if (i < 0) return Aero.toast('Select a marker first');
    d.markers.splice(i, 1); App.selMarker = null; markersChanged('Delete Marker');
  }
  function jumpMarker(dir) {
    const d = App.doc; if (!d || !d.markers.length) return;
    const cur = (playheadSample() ?? App.sel.a) / d.sr;
    const m = dir > 0 ? d.markers.find(m => m.time > cur + 1e-6) : d.markers.slice().reverse().find(m => m.time < cur - 1e-6);
    if (m) { App.selectMarker(m.id); Wave.ensureVisible(m.time * d.sr, false); }
  }
  function selectBetweenMarkers() {
    const d = App.doc; if (!d) return; const c = App.sel.a / d.sr;
    const prev = d.markers.filter(m => m.time <= c + 1e-9).pop(), next = d.markers.find(m => m.time > c + 1e-9);
    setSel(prev ? prev.time * d.sr : 0, next ? next.time * d.sr : len(), true);
  }

  /* ================= transport ================= */
  let bufCache = null, paused = null;
  function getBuffer() {
    const d = App.doc;
    if (!bufCache || bufCache.chs !== d.chs || bufCache.sr !== d.sr) bufCache = { chs: d.chs, sr: d.sr, ab: Engine.toBuffer(d.chs, d.sr) };
    return bufCache.ab;
  }
  function play() {
    if (App.mode === 'multi') return Multi.play();
    if (!ensureDoc()) return;
    const d = App.doc, sr = d.sr;
    let from = paused != null ? paused : App.sel.a; paused = null;
    const loop = App.settings.loop && hasSel() ? { a: App.sel.a / sr, b: App.sel.b / sr } : null;
    const to = !loop && hasSel() && from < App.sel.b ? App.sel.b / sr : null;
    if (from >= len()) from = 0;
    const ab = getBuffer();
    const insert = d.chs.length <= 2 ? Rack.createChain(Engine.ensure(), App.rack, d.chs.length) : null;
    App.liveChain = insert;
    Engine.playBuffer(ab, { from: from / sr, to, loop, kind: 'wave', insert });
    playStart = App.sel.a;
  }
  /* effects-rack target for the waveform editor */
  function rackTarget() {
    const d = App.doc; if (!d) return null;
    return {
      rack: App.rack, label: d.name || 'File', sr: d.sr,
      unsupported: d.chs.length > 2 ? 'The effects rack works on mono and stereo files. Convert this ' + d.chs.length + '-channel file with Restoration › Convert Channels first.' : null,
      changed(label) { App.liveChain?.update(App.rack); if (label) { whist.push(label, snapshot()); } const b = document.querySelector('#side-rack [data-apply]'); if (b) b.disabled = !Rack.active(App.rack); },
      apply: applyRack, applyLabel: 'Apply'
    };
  }
  async function applyRack() {
    if (!ensureDoc()) return;
    if (!Rack.active(App.rack)) return Aero.toast('The rack has no active effects');
    Engine.stop(); paused = null;
    const rack = Rack.clone(App.rack);
    await applyProc(hasSel() ? 'Apply Effects Rack (selection)' : 'Apply Effects Rack', (segs, sr) => Rack.render(rack, segs, sr), { beforeCommit: () => { App.rack = Rack.empty(); } });
    Rack.refresh();
  }
  App.applyRack = applyRack;
  let playStart = 0;
  function stop() {
    if (App.mode === 'multi') return Multi.stop();
    const was = Engine.playing() || paused != null; Engine.stop(); paused = null; if (was) Wave.invalidate(false);
  }
  function pause() {
    if (App.mode === 'multi') return Multi.pause();
    if (Engine.playing() && Engine.current().kind === 'wave') { paused = Math.round(Engine.current().position() * App.doc.sr); Engine.stop(); Wave.invalidate(false); }
    else if (paused != null) play();
  }
  function playStop() { if (App.mode === 'multi') return Multi.playStop(); if (Engine.playing()) stop(); else play(); }
  function playheadSample() {
    const c = Engine.current();
    if (c && c.kind === 'wave' && App.doc) return Math.min(len(), c.position() * App.doc.sr);
    if (paused != null) return paused;
    return null;
  }
  App.playheadSample = playheadSample;
  function goStart() { if (App.mode === 'multi') return Multi.seek(0); if (!App.doc) return; Engine.stop(); paused = null; setSel(0, 0, true); Wave.ensureVisible(0); }
  function goEnd() { if (App.mode === 'multi') return Multi.seek(Multi.duration()); if (!App.doc) return; Engine.stop(); paused = null; setSel(len(), len(), true); Wave.ensureVisible(len(), false); }
  function nudge(dir, extend) {
    if (App.mode === 'multi') return Multi.nudge(dir);
    if (!App.doc) return;
    const step = Math.max(1, Math.round(App.view.spp * 4)), S = App.sel;
    if (extend) { setSel(S.a, Math.max(S.a, S.b + dir * step), true); Wave.ensureVisible(App.sel.b, false); }
    else { const p = clamp((S.b > S.a ? (dir > 0 ? S.b : S.a) : S.a) + dir * step, 0, len()); setSel(p, p, true); Wave.ensureVisible(p, false); }
  }
  App.transport = { play, stop, pause, playStop, goStart, goEnd };

  /* ================= meters & animation loop ================= */
  const meterHold = [], meterVal = [];
  let meterCanvas, meterDirty = true, extMeter = null;
  App.setExternalMeter = f => { extMeter = f; };
  function drawMeter() {
    const c = meterCanvas; if (!c || !c.offsetParent) return;
    const lv = extMeter ? extMeter() : Engine.levels();
    const n = lv ? lv.length : (meterVal.length || 2);
    const now = performance.now();
    let active = false;
    for (let i = 0; i < n; i++) {
      const p = lv ? DSP.linToDb(lv[i].peak) : -100, r = lv ? DSP.linToDb(lv[i].rms) : -100;
      const prev = meterVal[i] || { p: -100, r: -100 };
      meterVal[i] = { p: Math.max(p, prev.p - 1.6), r: Math.max(r, prev.r - 1.6) };
      if (!meterHold[i] || p > meterHold[i].v || now - meterHold[i].t > 1500) meterHold[i] = { v: Math.max(p, meterHold[i] && now - meterHold[i].t <= 1500 ? meterHold[i].v : -100), t: now };
      if (p >= -0.01) meterHold[i].clip = now;
      if (meterVal[i].p > -99) active = true;
    }
    meterVal.length = n;
    if (!active && !meterDirty) return; meterDirty = active;
    const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#1b3550'); bg.addColorStop(1, '#0b1a2a');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const x0 = 34, x1 = w - 44, scale = db => x0 + (x1 - x0) * (clamp(db, -60, 3) + 60) / 63;
    const bh = Math.max(3, (h - 14 - (n - 1) * 2) / n);
    const grad = g.createLinearGradient(x0, 0, x1, 0);
    grad.addColorStop(0, '#1fae4a'); grad.addColorStop((scale(-18) - x0) / (x1 - x0), '#47d16a'); grad.addColorStop((scale(-6) - x0) / (x1 - x0), '#e8d33a'); grad.addColorStop((scale(-1) - x0) / (x1 - x0), '#f08a24'); grad.addColorStop(1, '#ff3b2a');
    g.font = '9px Segoe UI, sans-serif';
    for (let i = 0; i < n; i++) {
      const y = 2 + i * (bh + 2);
      g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(x0, y, x1 - x0, bh);
      g.fillStyle = grad; const pv = meterVal[i]?.p ?? -100, rv = meterVal[i]?.r ?? -100;
      g.globalAlpha = 0.55; g.fillRect(x0, y, Math.max(0, scale(pv) - x0), bh); g.globalAlpha = 1;
      g.fillRect(x0, y, Math.max(0, scale(rv) - x0), bh);
      const hd = meterHold[i]?.v ?? -100; if (hd > -60) { g.fillStyle = '#fff'; g.fillRect(scale(hd) - 1, y, 2, bh); }
      const clip = meterHold[i]?.clip && now - meterHold[i].clip < 2500;
      g.fillStyle = clip ? '#ff3b2a' : '#3a1210'; g.fillRect(x1 + 4, y, 10, bh);
      g.fillStyle = '#9fc3e6'; g.fillText(n === 2 ? 'LR'[i] : String(i + 1), 6, y + bh / 2 + 3.5);
    }
    g.fillStyle = '#7f9cbb'; g.strokeStyle = 'rgba(160,200,240,.45)'; g.beginPath();
    for (const db of [-60, -48, -36, -30, -24, -18, -12, -9, -6, -3, 0]) { const x = Math.round(scale(db)) + 0.5; g.moveTo(x, h - 12); g.lineTo(x, h - 9); g.fillText(String(db), x - (db <= -10 ? 7 : db < 0 ? 5 : 2), h - 1); }
    g.stroke();
    g.fillStyle = '#ff9a8a'; g.fillText('CLIP', x1 + 18, 2 + bh / 2 + 3);
  }
  let lastPos = null;
  function loop() {
    requestAnimationFrame(loop);
    drawMeter(); Rack.tick();
    const c = Engine.current();
    if (App.mode === 'wave' && App.doc) {
      const p = playheadSample();
      if (p !== lastPos) {
        lastPos = p;
        if (c && c.kind === 'wave' && App.settings.follow) Wave.ensureVisible(p, true);
        Wave.invalidate(false);
      }
      const shown = p ?? App.sel.a;
      st('lcd', fmtT(shown / App.doc.sr));
    } else if (App.mode === 'multi') Multi.frame();
  }

  /* ================= panels ================= */
  function refreshPanels() { refreshSelPane(); refreshMarkers(); refreshStatus(); }
  App.refreshPanels = refreshPanels;
  function refreshSelPane() {
    const d = App.doc, dis = !d;
    ['#sel-start', '#sel-end', '#sel-dur'].forEach(s => $(s).disabled = dis);
    if (!d) { ['#sel-start', '#sel-end', '#sel-dur'].forEach(s => $(s).value = ''); return; }
    const S = App.sel, f = s => fmtT(s / d.sr);
    if (document.activeElement !== $('#sel-start')) $('#sel-start').value = f(S.a);
    if (document.activeElement !== $('#sel-end')) $('#sel-end').value = f(S.b);
    if (document.activeElement !== $('#sel-dur')) $('#sel-dur').value = f(S.b - S.a);
    refreshStatus();
  }
  function refreshStatus() {
    const d = App.doc;
    if (App.mode === 'multi') return Multi.status();
    if (!d) { st('st-fmt', 'No file'); st('st-len', ''); st('st-sel', ''); st('st-hover', ''); st('st-size', ''); return; }
    const n = len();
    st('st-fmt', `${d.sr.toLocaleString()} Hz · ${d.chs.length === 1 ? 'Mono' : d.chs.length === 2 ? 'Stereo' : d.chs.length + ' ch'} · ${d.bits}`);
    st('st-len', `Duration ${fmtT(n / d.sr)}`);
    st('st-sel', hasSel() ? `Selection ${fmtT(App.sel.a / d.sr)} – ${fmtT(App.sel.b / d.sr)} (${fmtT((App.sel.b - App.sel.a) / d.sr)})` : `Cursor ${fmtT(App.sel.a / d.sr)}`);
    st('st-size', `${(n * d.chs.length * 4 / 1048576).toFixed(1)} MB · ${App.view.spp < 1 ? (1 / App.view.spp).toFixed(1) + ' px/sample' : Math.round(App.view.spp) + ' samples/px'}`);
  }
  function refreshMarkers() {
    const list = $('#markers'); list.innerHTML = '';
    const d = App.doc; st('mkcount', d ? String(d.markers.length) : '');
    if (!d) return;
    if (!d.markers.length) list.appendChild(el('div', 'dim mk-empty', 'No markers. Press M to add one at the cursor.'));
    d.markers.forEach(m => {
      const it = el('div', 'aero-item' + (m.id === App.selMarker ? ' sel' : ''), `<span class="mk-flag"></span><span class="grow"></span><span class="mono dim"></span>`);
      it.querySelector('.grow').textContent = m.label; it.querySelector('.mono').textContent = fmtT(m.time);
      it.onclick = () => { App.selectMarker(m.id); Wave.ensureVisible(m.time * d.sr, false); };
      it.ondblclick = () => App.renameMarker(m.id);
      list.appendChild(it);
    });
  }
  function bindSelPane() {
    const apply = () => {
      if (!App.doc) return; const sr = App.doc.sr;
      const a = parseT($('#sel-start').value), b = parseT($('#sel-end').value), du = parseT($('#sel-dur').value);
      return { a, b, du, sr };
    };
    $('#sel-start').onchange = () => { const v = apply(); if (v && !isNaN(v.a)) setSel(v.a * v.sr, Math.max(v.a * v.sr, App.sel.b), true); refreshSelPane(); };
    $('#sel-end').onchange = () => { const v = apply(); if (v && !isNaN(v.b)) setSel(Math.min(App.sel.a, v.b * v.sr), v.b * v.sr, true); refreshSelPane(); };
    $('#sel-dur').onchange = () => { const v = apply(); if (v && !isNaN(v.du)) setSel(App.sel.a, App.sel.a + v.du * v.sr, true); refreshSelPane(); };
    ['#sel-start', '#sel-end', '#sel-dur'].forEach(s => $(s).addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); }));
  }

  /* frequency analysis panel */
  let faTimer = null, faData = null, faHover = null;
  function scheduleAnalysis() { clearTimeout(faTimer); faTimer = setTimeout(runAnalysis, 160); }
  function runAnalysis() {
    const d = App.doc; if (!d || App.mode !== 'wave') { faData = null; drawFA(); return; }
    const N = +$('#fa-size').value || 4096;
    let a, b;
    if (hasSel()) { a = App.sel.a; b = App.sel.b; } else { a = Math.max(0, App.sel.a - N * 4); b = Math.min(len(), App.sel.a + N * 4); }
    if (b - a < 64) { faData = null; drawFA(); return; }
    const ids = onIdx(), m = new Float32Array(b - a);
    ids.forEach(i => { const c = d.chs[i]; for (let k = a; k < b; k++) m[k - a] += c[k] / ids.length; });
    const n = DSP.pow2(Math.min(N, Math.max(256, b - a)));
    faData = { spec: DSP.spectrum(m.length < n ? (() => { const z = new Float32Array(n); z.set(m); return z; })() : m, n), N: n, sr: d.sr, range: [a, b] };
    const k0 = Math.max(1, Math.ceil(20 / d.sr * n)); let pk = k0; for (let k = k0 + 1; k < faData.spec.length; k++) if (faData.spec[k] > faData.spec[pk]) pk = k;
    faData.peak = { f: pk * d.sr / n, db: faData.spec[pk] };
    drawFA();
  }
  function drawFA() {
    const c = $('#fa'), dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#102840'); bg.addColorStop(1, '#0a1a2b'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const fmin = 20, sr = faData?.sr || 48000, fmax = sr / 2, X = f => 4 + (w - 8) * Math.log(f / fmin) / Math.log(fmax / fmin), Y = db => 6 + (h - 20) * (-db / 120);
    g.font = '9px Segoe UI, sans-serif'; g.strokeStyle = 'rgba(140,190,240,.14)'; g.fillStyle = '#6f93b8'; g.beginPath();
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) { if (f > fmax) continue; const x = Math.round(X(f)) + 0.5; g.moveTo(x, 4); g.lineTo(x, h - 13); g.fillText(f >= 1000 ? f / 1000 + 'k' : f, x - 6, h - 3); }
    for (const db of [-20, -40, -60, -80, -100]) { const y = Math.round(Y(db)) + 0.5; g.moveTo(0, y); g.lineTo(w, y); g.fillText(db, 2, y - 2); }
    g.stroke();
    if (!faData) { g.fillStyle = '#86a6c8'; g.textAlign = 'center'; g.fillText(App.doc ? 'Select audio to analyse' : 'No audio', w / 2 + 10, h / 2 - 6); g.textAlign = 'left'; st('fa-info', '—'); return; }
    const sp = faData.spec, N = faData.N;
    const pts = [];
    for (let px = 0; px < w - 8; px++) {
      const f0 = fmin * Math.pow(fmax / fmin, px / (w - 8)), f1 = fmin * Math.pow(fmax / fmin, (px + 1) / (w - 8));
      const k0 = Math.max(1, Math.floor(f0 / sr * N)), k1 = Math.max(k0, Math.min(sp.length - 1, Math.floor(f1 / sr * N)));
      let m = -200; for (let k = k0; k <= k1; k++) if (sp[k] > m) m = sp[k];
      pts.push([4 + px, Y(clamp(m, -120, 0))]);
    }
    const fill = g.createLinearGradient(0, 0, 0, h); fill.addColorStop(0, 'rgba(90,220,170,.55)'); fill.addColorStop(1, 'rgba(40,140,200,.08)');
    g.beginPath(); g.moveTo(4, h - 13); pts.forEach(([x, y]) => g.lineTo(x, y)); g.lineTo(w - 4, h - 13); g.closePath(); g.fillStyle = fill; g.fill();
    g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x, y) : g.moveTo(x, y)); g.strokeStyle = '#7ff0c4'; g.lineWidth = 1.2; g.stroke();
    const pf = faData.peak; g.fillStyle = '#ffd34a'; g.beginPath(); g.arc(X(clamp(pf.f, fmin, fmax)), Y(clamp(pf.db, -120, 0)), 2.5, 0, 7); g.fill();
    if (faHover != null) { const f = fmin * Math.pow(fmax / fmin, (faHover - 4) / (w - 8)), k = Math.round(f / sr * N); g.strokeStyle = 'rgba(255,255,255,.5)'; g.beginPath(); g.moveTo(faHover + 0.5, 0); g.lineTo(faHover + 0.5, h - 13); g.stroke(); st('fa-info', `${f >= 1000 ? (f / 1000).toFixed(2) + ' kHz' : Math.round(f) + ' Hz'}: ${(sp[k] ?? -200).toFixed(1)} dB`); }
    else st('fa-info', `Peak ${pf.f >= 1000 ? (pf.f / 1000).toFixed(2) + ' kHz' : pf.f.toFixed(1) + ' Hz'} at ${pf.db.toFixed(1)} dBFS · ${hasSel() ? 'selection' : 'around cursor'}`);
  }
  App.analysis = () => faData;
  App.runAnalysis = runAnalysis;

  /* ================= files ================= */
  const AUDIO_EXT = ['wav', 'wave', 'mp3', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'aac', 'mp4', 'webm', 'aif', 'aiff'];
  const isProject = n => /\.lsnd$/i.test(n);
  async function confirmDiscard() {
    if (!Aero.dirty) return true;
    return Aero.confirm('Unsaved changes', `Discard unsaved changes to “${App.projectName}”?`, 'Discard');
  }
  async function openFiles(files, { forceImport } = {}) {
    for (const f of files) {
      if (isProject(f.name)) { if (await confirmDiscard()) await loadProject(f.data, f.name, f.path); return; }
    }
    const audio = files.filter(f => AUDIO_EXT.includes((f.name.split('.').pop() || '').toLowerCase()) || /^audio\//.test(f.type || ''));
    if (!audio.length) return Aero.alert('Open', 'Unsupported file type. Open WAV, MP3, OGG, FLAC, M4A, WebM audio or a Lumen Sound project (.lsnd).');
    if (App.mode === 'multi' || forceImport) return Multi.importFiles(audio);
    if (!(await confirmDiscard())) return;
    const f = audio[0];
    Aero.busy('Decoding ' + f.name + '…'); await tick();
    try {
      const r = await Codecs.decode(f.data, f.name);
      if (!r.chs.length || !r.chs[0].length) throw new Error('The file contains no audio.');
      App.projectName = Aero.baseName(f.name); App.projectPath = null;
      setDoc({ name: Aero.baseName(f.name), sr: r.sr, chs: r.chs, markers: r.markers, bits: r.bits, codec: r.codec });
      Aero.setDoc(App.projectName, false);
      Aero.toast(`Opened ${f.name} · ${r.sr} Hz · ${r.chs.length} ch`);
    } catch (e) { Aero.alert('Open', e.message); }
    finally { Aero.busy(); }
  }
  App.openFiles = openFiles;
  async function openDialog() {
    const files = await Aero.openFile({ accept: '.lsnd,audio/*,.wav,.mp3,.ogg,.opus,.flac,.m4a,.aac,.webm', filters: [{ name: 'Audio & projects', extensions: ['lsnd', ...AUDIO_EXT] }] });
    if (files.length) openFiles(files);
  }
  function newFile() {
    Aero.dialog({ title: 'New Audio File', fields: [
      { key: 'sr', label: 'Sample rate', type: 'select', value: '48000', options: ['8000', '16000', '22050', '32000', '44100', '48000', '88200', '96000', '192000'].map(v => [v, v + ' Hz']) },
      { key: 'ch', label: 'Channels', type: 'select', value: '2', options: [['1', 'Mono'], ['2', 'Stereo'], ['6', '5.1 (6 ch)']] },
      { key: 'dur', label: 'Length (seconds)', type: 'number', value: 10, min: 0.1, max: 3600, step: 1 }],
      onOK: async v => {
        if (!(await confirmDiscard())) return;
        const sr = +v.sr, n = Math.round(clamp(v.dur, 0.1, 3600) * sr);
        App.projectName = 'Untitled'; App.projectPath = null;
        setDoc({ name: 'Untitled', sr, chs: Array.from({ length: +v.ch }, () => new Float32Array(n)) }, 'New File');
        Aero.setDoc(App.projectName, false);
      } });
  }
  async function openSample() {
    if (!(await confirmDiscard())) return;
    Aero.busy('Synthesising sample…'); await tick();
    try {
      const s = Samples.demoFile();
      App.projectName = 'Lumen Sample'; App.projectPath = null;
      setDoc({ ...s, bits: '32-bit float', codec: 'synth' }, 'Open Sample');
      Aero.setDoc(App.projectName, false);
      setSel(Math.round(0.05 * s.sr), Math.round(0.95 * s.sr), true);
    } finally { Aero.busy(); }
  }
  App.openSample = openSample;

  /* ---- project save / load (.lsnd zip) ---- */
  async function buildProject() {
    const files = {}, proj = { format: 'lumen-sound', version: 2, app: 'Lumen Sound', mode: App.mode, editor: null, session: null };
    const d = App.doc;
    if (d) {
      const { bytes, scale } = Codecs.packAudio(d.chs, d.sr);
      files['audio/editor.flac'] = bytes;
      proj.editor = { name: d.name, sr: d.sr, channels: d.chs.length, length: len(), bits: d.bits, file: 'audio/editor.flac', scale, markers: d.markers.map(m => ({ time: m.time, label: m.label })), sel: App.sel, xfadeMs: App.settings.xfadeMs, rack: Rack.clone(App.rack) };
    }
    const ses = Multi.serialize();
    if (ses) {
      for (const s of ses.sources) { const src = Multi.source(s.id); const { bytes, scale } = Codecs.packAudio(src.chs, src.sr); s.file = `audio/src-${s.id}.flac`; s.scale = scale; files[s.file] = bytes; }
      proj.session = ses;
    }
    files['project.json'] = JSON.stringify(proj, null, 1);
    return Codecs.zip(files);
  }
  async function save(as) {
    if (!App.doc && !Multi.session) { Aero.toast('Nothing to save'); return false; }
    Aero.busy('Saving project…'); await tick();
    try {
      const bytes = await buildProject();
      Aero.busy();
      const p = await Aero.saveFile({ name: App.projectName + '.lsnd', data: bytes, filters: [{ name: 'Lumen Sound project', extensions: ['lsnd'] }], path: as ? undefined : App.projectPath || undefined });
      if (!p) return false;
      if (Aero.isDesktop) App.projectPath = p;
      App.projectName = Aero.baseName(p); Aero.setDoc(App.projectName, false);
      Aero.toast('Saved ' + App.projectName + '.lsnd (' + (bytes.length / 1048576).toFixed(2) + ' MB)');
      return true;
    } catch (e) { Aero.busy(); Aero.alert('Save', 'Could not save: ' + e.message); return false; }
  }
  App.buildProject = buildProject;
  async function loadProject(data, name, path) {
    Aero.busy('Opening project…'); await tick();
    try {
      const files = Codecs.unzip(new Uint8Array(data));
      const pj = files['project.json']; if (!pj) throw new Error('project.json missing');
      const proj = JSON.parse(fflate.strFromU8(pj));
      if (proj.format !== 'lumen-sound') throw new Error('Not a Lumen Sound project');
      const okSr = v => Number.isFinite(v) && v >= 3000 && v <= 768000;
      const getBytes = f => { if (typeof f !== 'string' || !files[f]) throw new Error('Missing audio ' + f); return files[f]; };
      Engine.stop();
      if (proj.editor) {
        const e = proj.editor; if (!okSr(e.sr)) throw new Error('Bad sample rate');
        const chs = await Codecs.unpackAudio(getBytes(e.file), e.sr, +e.scale || 1, e.channels);
        const markers = (Array.isArray(e.markers) ? e.markers : []).filter(m => Number.isFinite(m.time)).map(m => ({ time: m.time, label: String(m.label ?? '').slice(0, 200) }));
        setDoc({ name: String(e.name || 'Untitled').slice(0, 200), sr: e.sr, chs, markers, bits: String(e.bits || '32-bit float').slice(0, 40), rack: e.rack }, 'Open Project');
        if (e.sel && Number.isFinite(e.sel.a)) setSel(e.sel.a, e.sel.b, true);
        if (Number.isFinite(e.xfadeMs)) App.settings.xfadeMs = clamp(e.xfadeMs, 0, 200);
      } else { App.doc = null; whist.reset('Empty', null); }
      if (proj.session) await Multi.deserialize(proj.session, async s => { if (!okSr(s.sr)) throw new Error('Bad sample rate'); return Codecs.unpackAudio(getBytes(s.file), s.sr, +s.scale || 1, s.channels); });
      else Multi.clear();
      App.projectName = Aero.baseName(name); App.projectPath = path || null;
      setMode(proj.mode === 'multi' && proj.session ? 'multi' : App.doc ? 'wave' : 'multi');
      Aero.setDoc(App.projectName, false); refreshAll();
      Aero.toast('Opened project ' + App.projectName);
    } catch (e) { Aero.alert('Open Project', 'This project could not be opened: ' + e.message); }
    finally { Aero.busy(); }
  }
  App.loadProject = loadProject;

  /* ---- export ---- */
  function exportDialog() {
    if (App.mode === 'multi') return Multi.exportMixdown();
    if (!ensureDoc()) return;
    exportAudio({ chs: App.doc.chs, sr: App.doc.sr, name: App.doc.name, markers: App.doc.markers, selection: hasSel() ? [App.sel.a, App.sel.b] : null });
  }
  async function exportAudio({ chs, sr, name, markers = [], selection }) {
    const opus = await Codecs.hasWebCodecsOpus();
    Aero.dialog({ title: 'Export Audio', instruction: 'Choose a format for the exported file.', width: 480, fields: [
      { key: 'fmt', label: 'Format', type: 'select', value: 'wav24', options: [['wav16', 'WAV — 16-bit PCM'], ['wav24', 'WAV — 24-bit PCM'], ['wav32', 'WAV — 32-bit float'], ['flac16', 'FLAC — 16-bit (lossless)'], ['flac24', 'FLAC — 24-bit (lossless)'], ['mp3', 'MP3 (LAME)'], ['webm', 'WebM / Opus' + (opus ? '' : ' (real-time capture)')]] },
      { key: 'kbps', label: 'Bitrate (MP3 / Opus)', type: 'select', value: '192', options: ['64', '96', '128', '160', '192', '256', '320'].map(v => [v, v + ' kbps']) },
      { key: 'sel', label: 'Selection only', type: 'checkbox', value: !!selection },
      { key: 'mk', label: 'Include markers (WAV cue)', type: 'checkbox', value: true }],
      html: `<div class="dnote">MP3 export uses LAME (LGPL) — sample rates outside 8–48 kHz are resampled. Opus is encoded at 48 kHz${opus ? ' with WebCodecs' : ''}.</div>`,
      onOK: async v => {
        let data = chs, mk = markers;
        if (v.sel && selection) { const [a, b] = selection; data = chs.map(c => c.subarray(a, b)); mk = markers.filter(m => m.time * sr >= a && m.time * sr <= b).map(m => ({ ...m, time: m.time - a / sr })); }
        if (!v.sel && selection && false) void 0;
        Aero.busy('Encoding…'); await tick();
        try {
          let bytes, ext;
          if (v.fmt.startsWith('wav')) { bytes = Codecs.encodeWav(data, sr, { wav16: 'pcm16', wav24: 'pcm24', wav32: 'float32' }[v.fmt], v.mk ? mk : []); ext = 'wav'; }
          else if (v.fmt.startsWith('flac')) { bytes = Codecs.encodeFlac(data.map(c => c.map(x => clamp(x, -1, 1))), sr, v.fmt === 'flac16' ? 16 : 24); ext = 'flac'; }
          else if (v.fmt === 'mp3') { bytes = Codecs.encodeMp3(data, sr, +v.kbps); ext = 'mp3'; }
          else { const r = await Codecs.encodeOpusWebm(data, sr, Math.min(256, +v.kbps)); bytes = r.bytes; ext = 'webm'; }
          Aero.busy();
          const fname = (name || 'export') + (v.sel && selection ? ' (selection)' : '') + '.' + ext;
          const p = await Aero.saveFile({ name: fname, data: bytes, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
          if (p) Aero.toast(`Exported ${fname} (${(bytes.length / 1024).toFixed(0)} KB)`);
          App.lastExport = { bytes, ext };
        } catch (e) { Aero.busy(); Aero.alert('Export', 'Export failed: ' + e.message); }
      } });
  }
  App.exportAudio = exportAudio;

  /* ================= mode switching ================= */
  function setMode(m) {
    App.mode = m;
    document.body.classList.toggle('mode-multi', m === 'multi');
    $('#wave').hidden = m !== 'wave'; $('#multi').hidden = m !== 'multi';
    applySide();
    document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    document.querySelectorAll('.aero-tool').forEach(b => { const t = b.dataset.tool; b.hidden = m === 'wave' ? (t === 'move' || t === 'razor') : t === 'zoom'; });
    if (m === 'wave' && (tools.get() === 'move' || tools.get() === 'razor')) tools.set('select');
    if (m === 'multi' && (tools.get() === 'zoom' || tools.get() === 'select')) tools.set('move');
    if (m === 'multi' && !Multi.session) Multi.newSession(false);
    Engine.stop(); paused = null;
    updateWelcome();
    requestAnimationFrame(() => { if (m === 'wave') Wave.resize(); else Multi.resize(); refreshStatus(); renderHist(); });
    $('#viewMode').parentElement.hidden = m === 'multi'; $('#snapZero').parentElement.hidden = m === 'multi';
  }
  App.setMode = setMode;
  App.sideTab = 'props';
  function applySide() {
    const m = App.mode, t = App.sideTab;
    $('#side-wave').hidden = !(m === 'wave' && t === 'props'); $('#side-multi').hidden = !(m === 'multi' && t === 'props'); $('#side-rack').hidden = t !== 'rack';
    document.querySelectorAll('#side-tabs .aero-tab').forEach(x => x.classList.toggle('on', x.dataset.tab === t));
    if (t === 'rack') Rack.refresh(); else requestAnimationFrame(() => drawFA());
  }
  function setSideTab(t) { App.sideTab = t; applySide(); }
  App.setSideTab = setSideTab;
  function updateWelcome() { $('#welcome').hidden = !(App.mode === 'wave' && !App.doc); }
  function refreshAll() { refreshPanels(); renderHist(); updateWelcome(); Wave.invalidate(true); if (App.mode === 'multi') Multi.render(); }
  App.refreshAll = refreshAll;

  /* ================= analysis dialog ================= */
  async function loudnessStats() {
    if (!ensureDoc()) return;
    const [a, b] = procRange(), d = App.doc;
    Aero.busy('Measuring loudness…'); await tick();
    const segs = d.chs.map(c => c.subarray(a, b));
    const L = DSP.loudness(segs, d.sr);
    const rows = segs.map((c, i) => { let s = 0, m = 0, pk = 0; for (let k = 0; k < c.length; k++) { s += c[k]; m += c[k] * c[k]; pk = Math.max(pk, Math.abs(c[k])); } return { name: Wave.chName(i, segs.length), peak: DSP.linToDb(pk), rms: DSP.linToDb(Math.sqrt(m / c.length)), dc: s / c.length * 100 }; });
    Aero.busy();
    const f = v => Number.isFinite(v) ? v.toFixed(1) : '−∞';
    Aero.dialog({ title: 'Loudness & Statistics', noCancel: true, width: 470, instruction: hasSel() ? 'Measured over the selection' : 'Measured over the whole file',
      html: `<table class="stats"><tr><th>Integrated loudness</th><td><b>${f(L.integrated)} LUFS</b></td></tr><tr><th>Short-term max (3 s)</th><td>${f(L.shortTermMax)} LUFS</td></tr><tr><th>Momentary max (400 ms)</th><td>${f(L.momentaryMax)} LUFS</td></tr><tr><th>Loudness range</th><td>${f(L.lra)} LU</td></tr><tr><th>True peak (4× oversampled)</th><td>${f(L.truePeak)} dBTP</td></tr><tr><th>Sample peak</th><td>${f(L.samplePeak)} dBFS</td></tr></table>
      <table class="stats"><tr><th></th>${rows.map(r => `<th>${r.name}</th>`).join('')}</tr><tr><th>Peak</th>${rows.map(r => `<td>${f(r.peak)} dB</td>`).join('')}</tr><tr><th>RMS</th>${rows.map(r => `<td>${f(r.rms)} dB</td>`).join('')}</tr><tr><th>DC offset</th>${rows.map(r => `<td>${r.dc.toFixed(3)} %</td>`).join('')}</tr></table>
      <div class="dnote">ITU-R BS.1770-4 K-weighted, gated (−70 LUFS absolute, −10 LU relative). Duration ${fmtT((b - a) / d.sr)}.</div>` });
    return L;
  }
  App.loudnessStats = loudnessStats;

  /* ================= preferences ================= */
  function prefs() {
    Aero.dialog({ title: 'Preferences', fields: [
      { key: 'xf', label: 'Crossfade on paste / delete joins (ms)', type: 'range', min: 0, max: 50, step: 1, value: App.settings.xfadeMs, fmt: v => v ? v + ' ms' : 'Off' },
      { key: 'fft', label: 'Spectrogram FFT size', type: 'select', value: String(App.settings.fft), options: ['512', '1024', '2048', '4096', '8192'] },
      { key: 'floor', label: 'Spectrogram range (dB)', type: 'range', min: -150, max: -60, step: 5, value: App.settings.specFloor, fmt: v => v + ' dB' },
      { key: 'follow', label: 'Follow playhead', type: 'checkbox', value: App.settings.follow }],
      onOK: v => { App.settings.xfadeMs = v.xf; App.settings.fft = +v.fft; App.settings.specFloor = v.floor; App.settings.follow = v.follow; Wave.invalidate(true); savePrefs(); } });
  }
  function savePrefs() { try { localStorage.setItem('lumen-sound-prefs', JSON.stringify(App.settings)); } catch (e) { /* */ } }
  function loadPrefs() { try { const p = JSON.parse(localStorage.getItem('lumen-sound-prefs') || 'null'); if (p) for (const k of ['logFreq', 'cmap', 'fft', 'follow', 'snapZero', 'xfadeMs', 'specFloor', 'viewMode']) if (k in p) App.settings[k] = p[k]; } catch (e) { /* */ } }
  App.savePrefs = savePrefs;
  function setView(m) { App.settings.viewMode = m; $('#viewMode').value = m; Wave.invalidate(true); savePrefs(); }

  /* ================= help ================= */
  function shortcutsDialog() {
    const rows = [['Space', 'Play / stop'], ['Ctrl+Space', 'Pause / resume'], ['Home / End', 'Cursor to start / end'], ['← / →', 'Nudge cursor (Shift extends selection)'], ['L', 'Toggle loop playback'],
      ['Ctrl+R', 'Record…'], ['M', 'Add marker'], ['Ctrl+← / Ctrl+→', 'Previous / next marker'], ['Ctrl+A / Esc', 'Select all / deselect'], ['Ctrl+X / C / V', 'Cut / copy / paste'], ['Ctrl+Shift+V', 'Mix paste'], ['Delete', 'Delete selection (or clip)'], ['Ctrl+T', 'Crop to selection'],
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['= / −', 'Zoom in / out'], ['\\', 'Zoom full'], ['Ctrl+=', 'Zoom to selection'], ['Wheel', 'Zoom at pointer (Shift: scroll, Alt: amplitude)'], ['1 / 2 / 3', 'Waveform / spectral / split view'],
      ['T, H, Z', 'Time selection, hand, zoom tools'], ['V, R', 'Move / razor tools (multitrack)'], ['S or Ctrl+K', 'Split clip at playhead (multitrack)'], ['8 / 9', 'Waveform editor / multitrack'], ['Shift+P', 'Capture noise profile'], ['Ctrl+Shift+P', 'Noise reduction'], ['Ctrl+S', 'Save project'], ['Ctrl+E', 'Export audio / mixdown']];
    Aero.dialog({ title: 'Keyboard Shortcuts', noCancel: true, width: 560, html: `<table class="keys">${rows.map(r => `<tr><td><kbd>${esc(r[0])}</kbd></td><td>${esc(r[1])}</td></tr>`).join('')}</table>` });
  }
  function about() {
    Aero.dialog({ title: 'About Lumen Sound', noCancel: true, width: 470, html: `<div class="about"><img src="../kit/icons/sound.png" alt=""><div><h2>Lumen Sound</h2><p>Waveform, spectral and multitrack audio editor — part of Lumen Studio.</p>
      <p class="dim">DSP: FFT/STFT, RBJ biquads, WSOLA & phase vocoder, spectral noise reduction, ITU-R BS.1770-4 loudness, Kaiser-sinc resampling, FLAC encoder — all built in.</p>
      <p class="dim">Includes <b>LAME</b> MP3 encoder via lamejs (@breezystack/lamejs 1.2.7, LGPL-3.0, unmodified — lame.sourceforge.net) and <b>fflate</b> 0.8.3 (MIT).</p></div></div>` });
  }

  /* ================= UI wiring ================= */
  const I = {
    select: '<path d="M4 6h3M4 18h3M17 6h3M17 18h3M12 3v18"/><path d="M8 9.5h8v5H8z" fill="rgba(80,160,230,.35)"/>',
    move: '<path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/>',
    razor: '<path d="M5 19 19 5"/><path d="M14 4l6 6-4 1-3-3z"/><path d="M4 20l3-1-2-2z"/>',
    hand: '<path d="M8 12V6a1.5 1.5 0 0 1 3 0v5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V6a1.5 1.5 0 0 1 3 0v7c0 4-2.5 7-6 7-2.5 0-4-1.2-5.5-3.5L4 13.5a1.5 1.5 0 0 1 2.6-1.4L8 14"/>',
    zoom: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5 20 20M7.5 10h5M10 7.5v5"/>'
  };
  let tools;
  const T = {
    start: '<path d="M5 5v14M19 5 9 12l10 7z"/>', stop: '<rect x="6" y="6" width="12" height="12" rx="1"/>', play: '<path d="M7 4.5v15L19.5 12z"/>', pause: '<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>',
    rec: '<circle cx="12" cy="12" r="6.5"/>', loop: '<path d="M17 7H8a4 4 0 0 0 0 8h1M7 17h9a4 4 0 0 0 0-8h-1"/><path d="M14.5 4.5 17 7l-2.5 2.5M9.5 19.5 7 17l2.5-2.5"/>', end: '<path d="M19 5v14M5 5l10 7-10 7z"/>',
    zin: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5 20 20M7.5 10h5M10 7.5v5"/>', zout: '<circle cx="10" cy="10" r="6"/><path d="M14.5 14.5 20 20M7.5 10h5"/>', zsel: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M9 12h6"/>', zfull: '<path d="M3 12h18M3 12l4-4M3 12l4 4M21 12l-4-4M21 12l-4 4"/>'
  };
  function buildCmdbar() {
    const b = (id, title, icon, cls = '') => `<button class="tbtn ${cls}" id="${id}" title="${title}"><svg viewBox="0 0 24 24">${icon}</svg></button>`;
    $('#cmd').innerHTML = `
      <div class="modes"><button class="aero-btn" data-mode="wave" title="Waveform editor (8)">Waveform</button><button class="aero-btn" data-mode="multi" title="Multitrack session (9)">Multitrack</button></div>
      <span class="sep"></span>
      <div class="transport">${b('t-start', 'Go to start (Home)', T.start)}${b('t-stop', 'Stop', T.stop)}${b('t-play', 'Play / stop (Space)', T.play, 'play')}${b('t-pause', 'Pause (Ctrl+Space)', T.pause)}${b('t-rec', 'Record (Ctrl+R)', T.rec, 'rec')}${b('t-loop', 'Loop selection (L)', T.loop)}${b('t-end', 'Go to end (End)', T.end)}</div>
      <div class="lcd" id="lcd" title="Playhead / cursor position">0:00.000</div>
      <span class="sep"></span>
      <div class="transport">${b('z-in', 'Zoom in (=)', T.zin)}${b('z-out', 'Zoom out (−)', T.zout)}${b('z-sel', 'Zoom to selection (Ctrl+=)', T.zsel)}${b('z-full', 'Zoom full (\\)', T.zfull)}</div>
      <span class="sep"></span>
      <label>View <select id="viewMode"><option value="wave">Waveform</option><option value="spec">Spectral</option><option value="both">Split</option></select></label>
      <label title="Snap selection edges to zero crossings"><input type="checkbox" id="snapZero"> Zero-cross snap</label>`;
    document.querySelectorAll('[data-mode]').forEach(x => x.onclick = () => setMode(x.dataset.mode));
    $('#t-start').onclick = goStart; $('#t-end').onclick = goEnd; $('#t-stop').onclick = stop; $('#t-play').onclick = playStop; $('#t-pause').onclick = pause;
    $('#t-rec').onclick = () => Recorder.open(); $('#t-loop').onclick = toggleLoop;
    $('#z-in').onclick = () => zoom(0.5); $('#z-out').onclick = () => zoom(2); $('#z-sel').onclick = () => App.mode === 'multi' ? Multi.zoomSel() : Wave.zoomSel(); $('#z-full').onclick = () => App.mode === 'multi' ? Multi.zoomFit() : Wave.zoomFit();
    $('#viewMode').value = App.settings.viewMode; $('#viewMode').onchange = e => setView(e.target.value);
    $('#snapZero').checked = App.settings.snapZero; $('#snapZero').onchange = e => { App.settings.snapZero = e.target.checked; savePrefs(); };
    Engine.onChange(() => { $('#t-play').classList.toggle('on', Engine.playing()); });
  }
  function toggleLoop() { App.settings.loop = !App.settings.loop; $('#t-loop').classList.toggle('on', App.settings.loop); Aero.toast('Loop ' + (App.settings.loop ? 'on' : 'off')); if (Engine.playing() && App.mode === 'wave') { const p = playheadSample(); paused = p; play(); } }
  function zoom(f) { if (App.mode === 'multi') return Multi.zoom(f); if (App.doc) Wave.zoomIn(f); }
  App.zoom = zoom;

  function menus() {
    const W = () => App.mode === 'wave', M = () => App.mode === 'multi', noDoc = () => !App.doc;
    const fx = name => () => { if (App.mode !== 'wave') { setMode('wave'); } if (ensureDoc()) Effects.open(name); };
    const multiOnly = fn => () => { if (App.mode !== 'multi') setMode('multi'); fn(); };
    return {
      File: [['New Audio File…', 'Ctrl+N', newFile], ['New Multitrack Session', 'Ctrl+Shift+N', multiOnly(() => Multi.newSession(true))], ['Open…', 'Ctrl+O', openDialog], '-',
        ['Open Sample', '', openSample], ['Open Sample Session', '', multiOnly(() => Multi.openSample())], '-',
        ['Save', 'Ctrl+S', () => save(false)], ['Save As…', 'Ctrl+Shift+S', () => save(true)], '-',
        ['Import to Session…', 'Ctrl+I', multiOnly(() => Multi.importDialog())], { label: 'Export Audio… / Mixdown', key: 'Ctrl+E', fn: exportDialog }, '-', ['Record…', 'Ctrl+R', () => Recorder.open()]],
      Edit: [['Undo', 'Ctrl+Z', undo], ['Redo', 'Ctrl+Y/Ctrl+Shift+Z', redo], '-',
        { label: 'Cut', key: 'Ctrl+X', fn: () => M() ? Multi.cutClip() : cut() }, { label: 'Copy', key: 'Ctrl+C', fn: () => M() ? Multi.copyClip() : copy() }, { label: 'Paste', key: 'Ctrl+V', fn: () => M() ? Multi.pasteClip() : paste() },
        { label: 'Mix Paste', key: 'Ctrl+Shift+V', fn: mixPaste, disabled: M }, { label: 'Delete', key: 'Delete', fn: () => M() ? Multi.deleteClip() : deleteSel() }, { label: 'Crop to Selection', key: 'Ctrl+T', fn: crop, disabled: M }, '-',
        { label: 'Select All', key: 'Ctrl+A', fn: () => M() ? Multi.selectAll() : selectAll() }, { label: 'Deselect', key: 'Escape', fn: () => M() ? Multi.deselect() : deselect() }, { label: 'Select Between Markers', fn: selectBetweenMarkers, disabled: M }, '-',
        { label: 'Insert Silence…', fn: insertSilence, disabled: M }, { label: 'Silence Selection', fn: silence, disabled: M }, { label: 'Trim Silence…', fn: trimSilence, disabled: M }, '-',
        { label: 'Split Clip at Playhead', key: 'Ctrl+K', fn: () => M() ? Multi.splitAtPlayhead() : Aero.toast('Splitting clips works in Multitrack view'), disabled: W }, '-',
        { label: 'Add Marker', key: 'M', fn: () => M() ? Multi.addMarker() : addMarker() }, { label: 'Snap to Zero Crossings', fn: () => { App.settings.snapZero = !App.settings.snapZero; $('#snapZero').checked = App.settings.snapZero; savePrefs(); }, checked: () => App.settings.snapZero }, ['Preferences…', '', prefs]],
      Effects: ['#Real-time', { label: 'Effects Rack Panel', key: 'Alt+R', fn: () => setSideTab(App.sideTab === 'rack' ? 'props' : 'rack'), checked: () => App.sideTab === 'rack' },
        { label: 'Apply Effects Rack', fn: () => { if (App.mode !== 'wave') setMode('wave'); applyRack(); }, disabled: () => App.mode !== 'wave' || !Rack.active(App.rack) }, '#Amplitude',['Amplify…', '', fx('amplify')], ['Normalize…', '', fx('normalize')], ['Loudness Normalize (LUFS)…', '', fx('loudness')], ['Fade In…', '', fx('fadein')], ['Fade Out…', '', fx('fadeout')],
        ['Invert', '', fx('invert')], ['Reverse', '', fx('reverse')], ['DC Offset Removal', '', fx('dc')], '#Dynamics', ['Compressor…', '', fx('compressor')], ['Limiter…', '', fx('limiter')], ['Noise Gate…', '', fx('gate')],
        '#Filter & EQ', ['Parametric EQ…', '', fx('peq')], ['Graphic EQ (10-band)…', '', fx('geq')], '#Delay & Reverb', ['Reverb…', '', fx('reverb')], ['Delay / Echo…', '', fx('delay')],
        '#Modulation & Distortion', ['Chorus / Flanger…', '', fx('chorus')], ['Distortion…', '', fx('distortion')], '#Time & Pitch', ['Pitch Shift…', '', fx('pitch')], ['Time Stretch…', '', fx('stretch')]],
      Restoration: [['Capture Noise Profile', 'Shift+P', fx('capture')], ['Noise Reduction…', 'Ctrl+Shift+P', fx('denoise')], ['De-click…', '', fx('declick')], '-', ['Convert Channels…', '', fx('channels')], ['Change Sample Rate…', '', fx('samplerate')]],
      View: [{ label: 'Waveform Editor', key: '8', fn: () => setMode('wave'), checked: W }, { label: 'Multitrack', key: '9', fn: () => setMode('multi'), checked: M }, '-',
        { label: 'Waveform', key: '1', fn: () => setView('wave'), checked: () => App.settings.viewMode === 'wave' }, { label: 'Spectral', key: '2', fn: () => setView('spec'), checked: () => App.settings.viewMode === 'spec' }, { label: 'Split (waveform + spectral)', key: '3', fn: () => setView('both'), checked: () => App.settings.viewMode === 'both' },
        { label: 'Logarithmic Frequency', fn: () => { App.settings.logFreq = !App.settings.logFreq; Wave.invalidate(true); savePrefs(); }, checked: () => App.settings.logFreq },
        '#Spectrogram colours', ...['aurora', 'viridis', 'magma', 'ice', 'gray'].map(c => ({ label: c[0].toUpperCase() + c.slice(1), fn: () => { App.settings.cmap = c; Wave.invalidate(true); savePrefs(); }, checked: () => App.settings.cmap === c })), '-',
        ['Zoom In', '=', () => zoom(0.5)], ['Zoom Out', '-', () => zoom(2)], ['Zoom to Selection', 'Ctrl+=', () => M() ? Multi.zoomSel() : Wave.zoomSel()], ['Zoom Full', '\\', () => M() ? Multi.zoomFit() : Wave.zoomFit()], { label: 'Zoom to Samples', fn: () => App.doc && Wave.zoomSamples(), disabled: M },
        { label: 'Amplitude Zoom In', key: 'Alt+=', fn: () => { App.view.vzoom = Math.min(64, (App.view.vzoom || 1) * 1.5); Wave.invalidate(true); } }, { label: 'Amplitude Zoom Reset', key: 'Alt+0', fn: () => { App.view.vzoom = 1; Wave.invalidate(true); } }, '-',
        { label: 'Follow Playhead', fn: () => { App.settings.follow = !App.settings.follow; savePrefs(); }, checked: () => App.settings.follow }],
      Transport: [['Play / Stop', 'Space', playStop], ['Pause / Resume', 'Ctrl+Space', pause], ['Stop', '', stop], { label: 'Loop Playback', key: 'L', fn: toggleLoop, checked: () => App.settings.loop }, '-',
        ['Go to Start', 'Home', goStart], ['Go to End', 'End', goEnd], ['Previous Marker', 'Ctrl+ArrowLeft', () => jumpMarker(-1)], ['Next Marker', 'Ctrl+ArrowRight', () => jumpMarker(1)],
        ['Nudge Left', 'ArrowLeft', () => nudge(-1)], ['Nudge Right', 'ArrowRight', () => nudge(1)], ['Extend Selection Left', 'Shift+ArrowLeft', () => nudge(-1, true)], ['Extend Selection Right', 'Shift+ArrowRight', () => nudge(1, true)], '-', ['Record…', '', () => Recorder.open()]],
      Multitrack: [['Add Track', '', multiOnly(() => Multi.addTrack())], ['Delete Selected Track', '', multiOnly(() => Multi.deleteTrack())], '-', ['Insert Current File into Session', '', () => Multi.insertCurrentFile()], ['Import File to Track…', '', multiOnly(() => Multi.importDialog())], '-',
        { label: 'Split Clip at Playhead', key: 'S', fn: () => M() && Multi.splitAtPlayhead(), disabled: W }, { label: 'Duplicate Clip', key: 'Ctrl+D', fn: () => M() && Multi.duplicateClip(), disabled: W }, ['Open Clip in Waveform Editor', '', multiOnly(() => Multi.editClipSource())], '-',
        ['Mixdown Session to New File', '', multiOnly(() => Multi.mixdownToEditor())], ['Export Mixdown…', '', multiOnly(() => Multi.exportMixdown())]],
      Analyze: [['Loudness & Statistics…', '', () => { if (App.mode !== 'wave') setMode('wave'); loudnessStats(); }], ['Refresh Frequency Analysis', '', () => { if (App.mode !== 'wave') setMode('wave'); runAnalysis(); }]],
      Help: [['Keyboard Shortcuts', 'F1', shortcutsDialog], ['About Lumen Sound', '', about]]
    };
    void noDoc;
  }

  function init() {
    loadPrefs();
    Aero.init({ name: 'Lumen Sound', icon: '../kit/icons/sound.png', menus: menus(), onDropFiles: files => openFiles(files), dropTarget: $('#stage'), dropText: 'Drop audio files or a .lsnd project to open (in Multitrack: import to new tracks)', onSave: () => save(false) });
    tools = Aero.toolbox($('#tools'), [
      { id: 'move', title: 'Move clips', key: 'V', icon: I.move }, { id: 'select', title: 'Time selection', key: 'T', icon: I.select }, { id: 'razor', title: 'Razor (split clips)', key: 'R', icon: I.razor },
      null, { id: 'hand', title: 'Hand (scroll)', key: 'H', icon: I.hand }, { id: 'zoom', title: 'Zoom (Alt-click to zoom out)', key: 'Z', icon: I.zoom }], id => { st('st-tool', { move: 'Move', select: 'Time Selection', razor: 'Razor', hand: 'Hand', zoom: 'Zoom' }[id]); Multi.toolChanged?.(id); });
    tools.set('select');
    Aero.shortcut('Shift+Space', () => Recorder.open());
    buildCmdbar();
    Wave.init($('#wave'));
    Multi.init($('#multi'));
    Rack.init($('#side-rack'), () => App.mode === 'multi' ? Multi.rackTarget() : rackTarget());
    document.querySelectorAll('#side-tabs .aero-tab').forEach(t => t.onclick = () => setSideTab(t.dataset.tab));
    meterCanvas = $('#meter');
    bindSelPane();
    $('#mk-add').onclick = addMarker; $('#mk-ren').onclick = () => App.selMarker ? App.renameMarker(App.selMarker) : Aero.toast('Select a marker first'); $('#mk-del').onclick = deleteMarker;
    $('#mk-prev').onclick = () => jumpMarker(-1); $('#mk-next').onclick = () => jumpMarker(1); $('#mk-sel').onclick = selectBetweenMarkers;
    $('#fa-size').onchange = runAnalysis;
    $('#fa').addEventListener('pointermove', e => { faHover = e.offsetX; drawFA(); }); $('#fa').addEventListener('pointerleave', () => { faHover = null; drawFA(); });
    new ResizeObserver(() => drawFA()).observe($('#fa'));
    // welcome
    $('#welcome').innerHTML = `<div class="wl-card"><img src="../kit/icons/sound.png" alt=""><h1>Lumen Sound</h1><p>Edit, repair, analyse and mix audio.</p>
      <div class="wl-actions"><button class="aero-btn pri" data-w="sample">Open Sample</button><button class="aero-btn" data-w="open">Open File…</button><button class="aero-btn" data-w="new">New File…</button><button class="aero-btn" data-w="rec">Record…</button><button class="aero-btn" data-w="session">Sample Session</button></div>
      <p class="dim">or drop WAV, MP3, OGG, FLAC, M4A files here</p></div>`;
    $('#welcome').onclick = e => { const a = e.target.dataset.w; if (!a) return; ({ sample: openSample, open: openDialog, new: newFile, rec: () => Recorder.open(), session: () => { setMode('multi'); Multi.openSample(); } })[a](); };
    setMode('wave'); refreshAll();
    Aero.setDoc(App.projectName, false);
    whist.reset('Empty', null);
    requestAnimationFrame(loop);
    $('#t-loop').classList.toggle('on', App.settings.loop);
    addEventListener('resize', () => drawFA());
  }
  App.fmtShort = fmt;
  document.addEventListener('DOMContentLoaded', init);
})();
