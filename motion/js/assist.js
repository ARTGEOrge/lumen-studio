'use strict';
/* Lumen Motion — v1.2 commands: expression property links, Convert Expression to Keyframes, composition & layer markers,
   keyframe assistants (Sequence Layers, Convert Audio to Keyframes, Time-Reverse Keyframes). */
(function () {
  const LM = window.LM, F = LM.factory, st = LM.st;

  /* ---------- expression references ("pick whip" by copy / link) ---------- */
  const TR_REF = { 'tr.anchor': 'anchorPoint', 'tr.position': 'position', 'tr.scale': 'scale', 'tr.rotation': 'rotation', 'tr.opacity': 'opacity', 'tr.posZ': 'zPosition', 'tr.rotX': 'xRotation', 'tr.rotY': 'yRotation' };
  const q = s => JSON.stringify(String(s));
  // the expression text that reads property n of layer L, seen from a property of layer `from` (same comp)
  LM.exprRef = (L, n, from) => {
    if (!L || !n) return null;
    const layer = from === L ? 'thisLayer' : `thisComp.layer(${q(L.name)})`;
    if (TR_REF[n.id]) return from === L ? `transform.${TR_REF[n.id]}` : `${layer}.transform.${TR_REF[n.id]}`;
    const m = /^fx\.([^.]+)\.(.+)$/.exec(n.id); if (!m) return null;
    const fx = L.effects.find(f => f.id === m[1]); if (!fx) return null;
    const qd = LM.FX[fx.type].params.find(x => x.k === m[2]); if (!qd || qd.static || qd.type === 'color') return null;
    return `${from === L ? 'effect' : layer + '.effect'}(${q(fx.name || LM.FX[fx.type].name)})(${q(qd.label)})`;
  };
  LM.exprLinkClip = null;
  LM.copyExprRef = (L, n) => {
    const ref = LM.exprRef(L, n); if (!ref) return Aero.toast('This property cannot be referenced by expressions');
    LM.exprLinkClip = { layer: L.id, comp: LM.comp().id, node: n.id, label: `${L.name} › ${n.label}` };
    try { navigator.clipboard?.writeText(ref).catch(() => { }); } catch (e) { /* clipboard not available */ }
    Aero.toast('Copied ' + ref);
  };
  const DIM = { num: 1, pct: 1, angle: 1, vec2: 2, vec2pct: 2, vec3: 3 };
  LM.linkToCopied = (L, n) => {
    const c = LM.comp(), clip = LM.exprLinkClip; if (!clip) return;
    if (clip.comp !== c.id) return Aero.toast('Copy a property from this composition first');
    const SL = c.layers.find(l => l.id === clip.layer), SN = SL && LM.allLeaves(SL).find(x => x.id === clip.node);
    if (!SN) return Aero.toast('The copied property no longer exists');
    if (SL === L && SN.id === n.id) return Aero.toast('A property cannot be linked to itself');
    if (!DIM[n.type] || !DIM[SN.type]) return Aero.toast('Only numeric properties can be linked');
    let ref = LM.exprRef(SL, SN, L); const a = DIM[SN.type], b = DIM[n.type];
    if (a > 1 && b === 1) ref += '[0]';
    else if (a === 1 && b > 1) ref = `var v = ${ref};\n[${Array(b).fill('v').join(', ')}]`;
    n.p.x = ref; n.p.xe = true; LM.trusted.add(ref); L.expanded = true;
    LM.commit('Link Property'); Aero.toast(`${n.label} now follows ${clip.label}`);
  };

  /* ---------- Convert Expression to Keyframes ---------- */
  // bakes one keyframe per frame over the layer's visible span, then disables the expression (as After Effects does)
  LM.bakeExpressions = refs => {
    refs = refs.filter(({ n }) => LM.hasExpr(n.p) && !LM.exprBlocked(n.p) && n.type !== 'color');
    if (!refs.length) return Aero.toast('Select properties that have a running expression');
    if (!LM.exprState.enabled) return Aero.toast('Turn on Edit › Evaluate Expressions first');
    let total = 0;
    const plan = refs.map(({ L, n }) => {
      const c = L._c || LM.comp(), fps = c.fps, a = Math.max(0, L.in), b = Math.min(c.duration, L.out);
      const f0 = Math.ceil(a * fps - 1e-6), f1 = Math.max(f0, Math.ceil(b * fps - 1e-6) - 1), keys = [];
      for (let f = f0; f <= f1 && keys.length < 5000; f++) { const t = f / fps; keys.push({ t: Math.round((t - L.start) * fps) / fps, v: LM.clone(LM.val(n.p, t)), i: 'linear', o: 'linear' }); }
      return { n, keys };
    });
    plan.forEach(({ n, keys }) => { if (!keys.length) return; n.p.k = keys; n.p.xe = false; total += keys.length; });
    LM.commit('Convert Expression to Keyframes');
    Aero.toast(`Baked ${total} keyframe${total === 1 ? '' : 's'} — the expression is kept but switched off`);
  };
  LM.bakeSelected = () => {
    const c = LM.comp(), refs = [];
    const ids = [...st.selProps];
    if (ids.length) ids.forEach(s => { const [lid, nid] = s.split('|'), L = c.layers.find(l => l.id === lid), n = L && LM.findNode(L, nid); if (n) refs.push({ L, n }); });
    else LM.selLayers().forEach(L => LM.allLeaves(L).forEach(n => { if (LM.hasExpr(n.p)) refs.push({ L, n: LM.leaves(L).find(x => x.id === n.id) || n }); }));
    LM.bakeExpressions(refs);
  };

  /* ---------- markers ---------- */
  // comp.markers: [{id, t (comp seconds), name, dur, label}] · layer.markers: [{id, t (layer seconds), name, dur, label}]
  const mk = (t, name = '') => ({ id: LM.uid(), t, name, dur: 0, label: 1 });
  LM.addMarker = (name) => {
    const c = LM.comp(), t = st.time, ls = LM.selLayers();
    if (ls.length) { ls.forEach(L => { L.markers = L.markers || []; const lt = LM.snap(t - L.start); if (!L.markers.some(m => Math.abs(m.t - lt) < 1e-6)) L.markers.push(mk(lt, name)); L.markers.sort((a, b) => a.t - b.t); }); LM.commit('Add Layer Marker'); }
    else { c.markers = c.markers || []; if (!c.markers.some(m => Math.abs(m.t - t) < 1e-6)) c.markers.push(mk(t, name)); c.markers.sort((a, b) => a.t - b.t); LM.commit('Add Composition Marker'); }
  };
  // every marker visible from the active comp, in comp time
  LM.markerTimes = () => { const c = LM.comp(), out = (c.markers || []).map(m => m.t); LM.selLayers().forEach(L => (L.markers || []).forEach(m => out.push(m.t + L.start))); return out.sort((a, b) => a - b); };
  LM.jumpMarker = dir => {
    const ts = LM.markerTimes(), t = st.time; let best = null;
    ts.forEach(x => { const s = LM.snap(x); if (dir > 0 ? s > t + 1e-6 && (best === null || s < best) : s < t - 1e-6 && (best === null || s > best)) best = s; });
    if (best === null) return Aero.toast(ts.length ? `No ${dir > 0 ? 'later' : 'earlier'} marker` : 'There are no markers (add one with *)');
    LM.setTime(best);
  };
  LM.editMarker = (m, L) => {
    const c = LM.comp(), off = L ? L.start : 0;
    Aero.dialog({
      title: L ? `Layer Marker — ${L.name}` : 'Composition Marker', width: 440,
      fields: [{ key: 'name', label: 'Comment', type: 'text', value: m.name || '' }, { key: 'time', label: 'Time', type: 'text', value: LM.fmtTC(m.t + off, c.fps), mono: true }, { key: 'dur', label: 'Duration (seconds)', type: 'number', value: m.dur || 0, min: 0, max: c.duration, step: .01 },
        { key: 'label', label: 'Color', type: 'select', value: String(m.label ?? 1), options: ['Red', 'Yellow', 'Aqua', 'Pink', 'Lavender', 'Peach', 'Sea Foam', 'Gray', 'Green', 'Blue', 'Brown'].map((n, i) => [String(i), n]) }, { key: 'del', label: 'Delete this marker', type: 'checkbox', value: false }],
      onOK: v => {
        const list = L ? L.markers : c.markers;
        if (v.del) { const i = list.indexOf(m); if (i >= 0) list.splice(i, 1); LM.commit('Delete Marker'); return; }
        m.name = String(v.name).slice(0, 500); m.dur = Math.max(0, Math.min(c.duration, +v.dur || 0)); m.label = Math.max(0, Math.min(10, +v.label | 0));
        const tt = LM.parseTime(v.time, c.fps); if (isFinite(tt)) m.t = LM.snap(Math.max(L ? -1e6 : 0, Math.min(c.duration, tt)) ) - off;
        list.sort((a, b) => a.t - b.t); LM.commit('Edit Marker');
      }
    });
  };
  LM.deleteMarker = (m, L) => { const c = LM.comp(), list = L ? L.markers : c.markers, i = list.indexOf(m); if (i < 0) return; list.splice(i, 1); LM.commit('Delete Marker'); };
  LM.clearMarkers = () => {
    const c = LM.comp(), ls = LM.selLayers();
    if (ls.length) { if (!ls.some(L => L.markers?.length)) return Aero.toast('The selected layers have no markers'); ls.forEach(L => L.markers = []); LM.commit('Delete Layer Markers'); }
    else { if (!c.markers?.length) return Aero.toast('This composition has no markers'); c.markers = []; LM.commit('Delete Composition Markers'); }
  };

  /* ---------- Sequence Layers ---------- */
  LM.sequenceLayers = () => {
    const c = LM.comp(), ls = c.layers.filter(l => st.sel.includes(l.id) && !l.locked);
    if (ls.length < 2) return Aero.toast('Select two or more layers to sequence');
    Aero.dialog({
      title: 'Sequence Layers', instruction: `Place ${ls.length} layers one after another, top layer first.`, width: 440,
      fields: [{ key: 'overlap', label: 'Overlap', type: 'checkbox', value: false }, { key: 'dur', label: 'Overlap duration (seconds)', type: 'number', value: 1, min: 0, max: 600, step: .1 },
        { key: 'trans', label: 'Transition', type: 'select', value: 'off', options: [['off', 'Off'], ['front', 'Dissolve Front Layer'], ['cross', 'Cross Dissolve Front and Back Layers']] }],
      onOK: v => LM.applySequence(ls, v.overlap ? Math.max(0, +v.dur || 0) : 0, v.overlap ? v.trans : 'off')
    });
  };
  LM.applySequence = (ls, ov, trans) => {
    const c = LM.comp(); let skipped = 0;
    for (let i = 1; i < ls.length; i++) {
      const P = ls[i - 1], L = ls[i], d = LM.snap(Math.max(P.in, P.out - Math.min(ov, P.out - P.in))) - L.in;
      L.start += d; L.in += d; L.out += d;
    }
    if (ov > 0 && trans !== 'off') {
      for (let i = 0; i < ls.length; i++) {
        const L = ls[i], nx = ls[i + 1], pv = ls[i - 1], keys = [];
        const o = L.tr.opacity; if (LM.animated(o)) { skipped++; continue; }
        const v = o.v;
        if (trans === 'cross' && pv) { const a = L.in, b = Math.min(L.out, pv.out); if (b > a) keys.push([a, 0], [b, v]); }
        if (nx) { const a = Math.max(L.in, nx.in), b = L.out; if (b > a) { if (!keys.length || keys[keys.length - 1][0] < a) keys.push([a, v]); else keys[keys.length - 1][1] = v; keys.push([b, 0]); } }
        if (keys.length) o.k = keys.map(([t, val]) => ({ t: LM.snap(t) - L.start, v: val, i: 'linear', o: 'linear' }));
      }
    }
    LM.commit('Sequence Layers');
    if (skipped) Aero.toast(`${skipped} layer${skipped > 1 ? 's' : ''} already had opacity keyframes and kept them`);
  };

  /* ---------- Convert Audio to Keyframes ---------- */
  LM.audioToKeys = () => {
    const c = LM.comp();
    if (!LM.audio.compHasAudio(c)) return Aero.toast('This composition has no audible audio layers');
    const a = c.workIn, b = Math.min(c.duration, c.workOut), fps = c.fps, f0 = Math.round(a * fps), f1 = Math.max(f0, Math.round(b * fps) - 1);
    const [l, r] = LM.audio.mix(c, f0 / fps, (f1 + 1) / fps), spf = l.length / (f1 - f0 + 1);
    const N = F.nul(c); N.name = LM.uniqueName(c, 'Audio Amplitude'); N.label = 9;
    const sliders = ['Both Channels', 'Left Channel', 'Right Channel'].map(name => { const fx = F.effect('slider'); fx.name = name; fx.p.slider.k = []; N.effects.push(fx); return fx; });
    for (let f = f0; f <= f1; f++) {
      const i0 = Math.round((f - f0) * spf), i1 = Math.max(i0 + 1, Math.round((f - f0 + 1) * spf)); let sl = 0, sr = 0;
      for (let i = i0; i < i1 && i < l.length; i++) { sl += l[i] * l[i]; sr += r[i] * r[i]; }
      const n = i1 - i0, L = Math.sqrt(sl / n) * 100, R = Math.sqrt(sr / n) * 100, t = f / fps, r3 = x => Math.round(x * 1000) / 1000;
      [[0, (L + R) / 2], [1, L], [2, R]].forEach(([k, v]) => sliders[k].p.slider.k.push({ t, v: r3(v), i: 'linear', o: 'linear' }));
    }
    N.expanded = true; c.layers.unshift(N); st.sel = [N.id]; LM.ui.open.add(N.id + '|effects'); sliders.forEach(fx => LM.ui.open.add(N.id + '|fx.' + fx.id));
    LM.commit('Convert Audio to Keyframes'); LM.emit('select');
    Aero.toast(`“${N.name}” holds ${f1 - f0 + 1} frames of loudness — link to it with effect("Both Channels")("Slider")`);
    return N;
  };

  /* ---------- Time-Reverse Keyframes ---------- */
  LM.reverseKeys = () => {
    const refs = LM.selectedKeyRefs(); if (refs.length < 2) return Aero.toast('Select two or more keyframes');
    const by = new Map(); refs.forEach(r => { if (!by.has(r.n.p)) by.set(r.n.p, []); by.get(r.n.p).push(r.k); });
    by.forEach((ks, p) => {
      if (ks.length < 2) return;
      const a = Math.min(...ks.map(k => k.t)), b = Math.max(...ks.map(k => k.t));
      ks.forEach(k => { k.t = a + b - k.t; [k.i, k.o] = [k.o, k.i]; [k.ei, k.eo] = [k.eo, k.ei]; [k.si, k.so] = [k.so, k.si]; ['ei', 'eo', 'si', 'so'].forEach(s => { if (k[s] === undefined) delete k[s]; }); });
      p.k.sort((x, y) => x.t - y.t);
    });
    LM.commit('Time-Reverse Keyframes');
  };

  /* ---------- markers in the help ---------- */
  LM.markerHelpRows = [['Add marker (layer if selected, else composition)', '*'], ['Previous / next marker', 'Alt+J / Alt+K'], ['Edit marker', 'Double-click it in the ruler or layer bar']];
})();
