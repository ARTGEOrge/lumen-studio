'use strict';
/* Lumen Sound — effect dialogs with live preview, and the recorder. */
window.Effects = (() => {
  const { clamp, el, esc } = Aero;
  const PREVIEW_MAX = 10; // seconds
  const dbf = v => (v > 0 ? '+' : '') + (+v).toFixed(1) + ' dB';
  const msf = v => (+v >= 100 ? Math.round(v) : (+v).toFixed(1)) + ' ms';
  const pct = v => Math.round(v) + ' %';
  const hz = v => v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 1 : 2) + ' kHz' : Math.round(v) + ' Hz';

  /* ---------- preview helper ---------- */
  function previewSource() {
    const d = App.doc, sr = d.sr, n = d.chs[0].length;
    let [a, b] = App.hasSel() ? [App.sel.a, App.sel.b] : [App.sel.a, n];
    if (b - a < sr * 0.2) { a = Math.max(0, Math.min(a, n - sr * 2)); b = Math.min(n, a + sr * PREVIEW_MAX); }
    b = Math.min(b, a + sr * PREVIEW_MAX);
    return { a, b, sr };
  }
  /* fxDialog: generic effect dialog with live preview.
     process(segs, sr, v) → segs (sync or async); segs are the enabled channels of the range. */
  function fxDialog({ title, instruction, fields = [], process, html = '', onOpen, onChange, width, label, apply, noPreview, requireSel }) {
    if (requireSel && !App.hasSel()) return Aero.toast('Make a selection first');
    let previewing = false, token = 0, timer = null, bypass = false, vals = null, renderedFor = null, dlg = null;
    const prevHtml = noPreview ? '' : `<div class="fx-prev"><button class="aero-btn small" data-prev>▶ Preview</button><label><input type="checkbox" data-bypass> Bypass</label><span class="dim" data-pinfo></span></div>`;
    const stopPrev = () => { if (previewing) { previewing = false; Engine.stop(); } const b = dlg?.el.querySelector('[data-prev]'); if (b) b.textContent = '▶ Preview'; };
    const render = async (restart) => {
      const my = ++token, src = previewSource(), d = App.doc, ids = App.onIdx();
      const relPos = Engine.current()?.kind === 'preview' ? Engine.current().position() : 0;
      let out;
      if (bypass) out = d.chs.map(c => c.slice(src.a, src.b));
      else {
        const segs = ids.map(i => d.chs[i].slice(src.a, src.b));
        let res = await process(segs, src.sr, vals);
        if (my !== token || !previewing) return;
        out = d.chs.map((c, i) => { const k = ids.indexOf(i); return k < 0 ? c.slice(src.a, src.b) : res[k]; });
      }
      if (my !== token || !previewing) return;
      const L = Math.min(...out.map(c => c.length)), ab = Engine.toBuffer(out.map(c => c.subarray(0, L)), src.sr), dur = L / src.sr;
      Engine.playBuffer(ab, { from: restart ? 0 : relPos % Math.max(0.01, dur), loop: { a: 0, b: dur }, kind: 'preview', onEnd: () => {} });
      renderedFor = vals;
      const pi = dlg.el.querySelector('[data-pinfo]'); if (pi) pi.textContent = `${App.fmtT(src.a / src.sr)} – ${App.fmtT(src.b / src.sr)}, looped`;
    };
    const schedule = (restart) => { clearTimeout(timer); timer = setTimeout(() => render(restart).catch(e => { console.warn(e); Aero.toast('Preview failed: ' + e.message); }), restart ? 0 : 220); };
    dlg = Aero.dialog({ title, instruction, fields, width, html: html + prevHtml,
      onChange: v => { vals = v; onChange?.(v, dlg); if (previewing && renderedFor !== v) schedule(false); },
      onOK: async v => {
        stopPrev(); token++;
        if (apply) return apply(v);
        await App.applyProc(label || title.replace(/…$/, ''), (segs, sr) => process(segs, sr, v));
      },
      onCancel: () => { stopPrev(); token++; } });
    vals = { ...dlg.values };
    const pb = dlg.el.querySelector('[data-prev]');
    if (pb) pb.onclick = () => { if (previewing) stopPrev(); else { previewing = true; pb.textContent = '■ Stop preview'; schedule(true); } };
    const bp = dlg.el.querySelector('[data-bypass]'); if (bp) bp.onchange = () => { bypass = bp.checked; if (previewing) schedule(false); };
    onOpen?.(dlg, vals, () => { vals = { ...dlg.values, ...(dlg.extra || {}) }; onChange?.(vals, dlg); if (previewing) schedule(false); });
    // stop preview if dialog goes away by other means
    const obs = new MutationObserver(() => { if (!document.body.contains(dlg.el)) { stopPrev(); token++; obs.disconnect(); } });
    obs.observe(document.body, { childList: true });
    return dlg;
  }
  const map = (segs, f) => segs.map(s => { const o = new Float32Array(s.length); for (let i = 0; i < s.length; i++) o[i] = f(s[i], i, s.length); return o; });

  /* ---------- small canvases ---------- */
  function canvasIn(dlg, sel) { const c = dlg.el.querySelector(sel), dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight; c.width = w * dpr; c.height = h * dpr; const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return { g, w, h, c }; }
  function graphBg(g, w, h) { const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#12304d'); bg.addColorStop(1, '#0a1b2c'); g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  function freqGrid(g, w, h, X, Y, dbs) {
    g.font = '9.5px Segoe UI, sans-serif'; g.strokeStyle = 'rgba(140,190,240,.15)'; g.fillStyle = '#7f9fc0'; g.beginPath();
    for (const f of [30, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) { const x = Math.round(X(f)) + 0.5; g.moveTo(x, 0); g.lineTo(x, h); g.fillText(f >= 1000 ? f / 1000 + 'k' : f, x + 2, h - 3); }
    for (const db of dbs) { const y = Math.round(Y(db)) + 0.5; g.moveTo(0, y); g.lineTo(w, y); g.fillText((db > 0 ? '+' : '') + db, 3, y - 2); }
    g.stroke(); g.strokeStyle = 'rgba(200,230,255,.35)'; g.beginPath(); g.moveTo(0, Math.round(Y(0)) + 0.5); g.lineTo(w, Math.round(Y(0)) + 0.5); g.stroke();
  }

  /* ---------- effect definitions ---------- */
  const defs = {};
  defs.amplify = () => fxDialog({ title: 'Amplify', fields: [{ key: 'g', label: 'Gain', type: 'range', min: -40, max: 40, step: 0.1, value: 3, fmt: dbf }],
    html: '<div class="dnote" data-info></div>',
    onChange: (v, dlg) => { if (!dlg) return; const [a, b] = App.procRange(), pk = DSP.peak(App.onIdx().map(i => App.doc.chs[i]), a, b); dlg.el.querySelector('[data-info]').textContent = `Peak ${DSP.linToDb(pk).toFixed(1)} dBFS → ${(DSP.linToDb(pk) + v.g).toFixed(1)} dBFS${DSP.linToDb(pk) + v.g > 0 ? ' (will clip on export to integer formats)' : ''}`; },
    onOpen: (dlg, v, ch) => ch(),
    process: (segs, sr, v) => { const g = DSP.dbToLin(v.g); return map(segs, x => x * g); }, label: 'Amplify' });
  defs.normalize = () => fxDialog({ title: 'Normalize', fields: [{ key: 't', label: 'Peak level', type: 'range', min: -40, max: 0, step: 0.1, value: -1, fmt: v => v.toFixed(1) + ' dBFS' }, { key: 'ind', label: 'Normalize channels independently', type: 'checkbox', value: false }, { key: 'dc', label: 'Remove DC offset first', type: 'checkbox', value: true }],
    process: (segs, sr, v) => {
      let s = segs; if (v.dc) s = s.map(x => { let m = 0; for (let i = 0; i < x.length; i++) m += x[i]; m /= x.length || 1; return x.map(y => y - m); });
      const tgt = DSP.dbToLin(v.t);
      if (v.ind) return s.map(x => { const p = DSP.peak([x]); const g = p > 0 ? tgt / p : 1; return x.map(y => y * g); });
      const p = DSP.peak(s), g = p > 0 ? tgt / p : 1; return s.map(x => x.map(y => y * g));
    } });
  defs.loudness = () => {
    const [a, b] = App.procRange(), d = App.doc, segs = App.onIdx().map(i => d.chs[i].subarray(a, b));
    const L = DSP.loudness(segs, d.sr, { truePeak: segs[0].length * segs.length < 8e6 });
    return fxDialog({ title: 'Loudness Normalize (LUFS)', instruction: `Current integrated loudness: ${Number.isFinite(L.integrated) ? L.integrated.toFixed(1) + ' LUFS' : 'silent'} · true peak ${L.truePeak.toFixed(1)} dBTP`,
      fields: [{ key: 'preset', label: 'Preset', type: 'select', value: '-16', options: [['-23', 'EBU R128 broadcast (−23 LUFS)'], ['-24', 'ATSC A/85 (−24 LKFS)'], ['-16', 'Podcast / spoken word (−16)'], ['-14', 'Streaming music (−14)'], ['custom', 'Custom']] },
        { key: 't', label: 'Target loudness', type: 'range', min: -40, max: -5, step: 0.5, value: -16, fmt: v => v.toFixed(1) + ' LUFS' },
        { key: 'lim', label: 'Limit true peaks', type: 'checkbox', value: true }, { key: 'ceil', label: 'Peak ceiling', type: 'range', min: -6, max: 0, step: 0.1, value: -1, fmt: v => v.toFixed(1) + ' dBTP' }],
      html: '<div class="dnote">Measured with ITU-R BS.1770-4 (K-weighting, 400 ms blocks, −70 LUFS absolute and −10 LU relative gates).</div>',
      onOpen: dlg => { const s = dlg.el.querySelector('select'); s.addEventListener('change', () => { if (s.value !== 'custom') dlg.set('t', +s.value); }); },
      process: (segs, sr, v) => {
        const m = DSP.loudness(segs, sr, { truePeak: false }).integrated; if (!Number.isFinite(m)) return segs;
        // gain from the full-range measurement (preview segments measure themselves only if no full measurement)
        // preview segments use the full-range measurement so they sound like the final result
        let gDb = v.t - (segs[0].length === b - a ? m : L.integrated), ceil = v.ceil - 0.2, out = null;
        if (!v.lim) return segs.map(x => x.map(y => y * DSP.dbToLin(gDb)));
        // limit, then re-measure: compensate loudness lost to limiting and tighten the ceiling for inter-sample peaks
        for (let it = 0; it < 10; it++) {
          const g = DSP.dbToLin(gDb);
          out = DSP.limit(segs.map(x => x.map(y => y * g)), sr, { ceiling: ceil, release: 60, lookahead: 3 });
          if (segs[0].length !== b - a) break;
          const M2 = DSP.loudness(out, sr);
          const dL = v.t - M2.integrated, over = M2.truePeak - v.ceil;
          if (Math.abs(dL) < 0.05 && over <= 0) break;
          if (over > 0) ceil -= over + 0.03;
          if (Number.isFinite(dL)) gDb += dL;
        }
        return out;
      }, label: 'Loudness Normalize' });
  };
  function fadeDlg(dir) {
    return fxDialog({ title: dir > 0 ? 'Fade In' : 'Fade Out', requireSel: true, instruction: 'The fade spans the whole selection.',
      fields: [{ key: 'shape', label: 'Curve', type: 'select', value: 'log', options: Object.entries(DSP.FADE_SHAPES) }],
      html: '<canvas class="fx-curve" data-c></canvas>',
      onChange: (v, dlg) => { if (!dlg) return; const { g, w, h } = canvasIn(dlg, '[data-c]'); graphBg(g, w, h); g.strokeStyle = 'rgba(140,190,240,.2)'; g.strokeRect(10.5, 8.5, w - 21, h - 17); g.beginPath(); for (let x = 0; x <= w - 20; x++) { const t = x / (w - 20), y = DSP.fadeCurve(v.shape, dir > 0 ? t : 1 - t); g.lineTo(10 + x, h - 8 - y * (h - 16)); } g.strokeStyle = '#7ff0c4'; g.lineWidth = 2; g.stroke(); },
      onOpen: (dlg, v, ch) => ch(),
      process: (segs, sr, v) => map(segs, (x, i, n) => x * DSP.fadeCurve(v.shape, dir > 0 ? i / Math.max(1, n - 1) : 1 - i / Math.max(1, n - 1))) });
  }
  defs.fadein = () => fadeDlg(1); defs.fadeout = () => fadeDlg(-1);
  defs.invert = () => App.applyProc('Invert', segs => map(segs, x => -x));
  defs.reverse = () => App.applyProc('Reverse', segs => segs.map(s => s.slice().reverse()));
  defs.dc = () => App.applyProc('DC Offset Removal', segs => segs.map(x => { let m = 0; for (let i = 0; i < x.length; i++) m += x[i]; m /= x.length || 1; return x.map(y => y - m); }));

  // dynamics
  defs.compressor = () => {
    const presets = { custom: null, vocal: { threshold: -20, ratio: 3, knee: 6, attack: 5, release: 120, makeup: 4 }, gentle: { threshold: -14, ratio: 2, knee: 10, attack: 20, release: 250, makeup: 2 }, heavy: { threshold: -30, ratio: 8, knee: 3, attack: 1, release: 80, makeup: 10 }, drums: { threshold: -18, ratio: 4, knee: 2, attack: 15, release: 60, makeup: 5 } };
    return fxDialog({ title: 'Compressor', width: 560, fields: [
      { key: 'preset', label: 'Preset', type: 'select', value: 'vocal', options: [['custom', '(custom)'], ['vocal', 'Vocal leveller'], ['gentle', 'Gentle glue'], ['heavy', 'Heavy squash'], ['drums', 'Punchy drums']] },
      { key: 'threshold', label: 'Threshold', type: 'range', min: -60, max: 0, step: 0.5, value: -20, fmt: dbf }, { key: 'ratio', label: 'Ratio', type: 'range', min: 1, max: 20, step: 0.1, value: 3, fmt: v => v.toFixed(1) + ':1' },
      { key: 'knee', label: 'Knee', type: 'range', min: 0, max: 24, step: 0.5, value: 6, fmt: dbf }, { key: 'attack', label: 'Attack', type: 'range', min: 0.1, max: 200, step: 0.1, value: 5, fmt: msf },
      { key: 'release', label: 'Release', type: 'range', min: 5, max: 2000, step: 1, value: 120, fmt: msf }, { key: 'makeup', label: 'Make-up gain', type: 'range', min: 0, max: 24, step: 0.5, value: 4, fmt: dbf },
      { key: 'detector', label: 'Detector', type: 'select', value: 'peak', options: [['peak', 'Peak (linked)'], ['rms', 'RMS 10 ms (linked)']] }],
      html: '<canvas class="fx-curve tall" data-c></canvas>',
      onOpen: (dlg) => { const s = dlg.el.querySelector('select'); s.addEventListener('change', () => { const p = presets[s.value]; if (p) Object.entries(p).forEach(([k, v]) => dlg.set(k, v)); }); },
      onChange: (v, dlg) => {
        if (!dlg) return; const { g, w, h } = canvasIn(dlg, '[data-c]'); graphBg(g, w, h);
        const X = db => (db + 60) / 60 * (w - 20) + 10, Y = db => h - 8 - (db + 60) / 60 * (h - 16);
        g.strokeStyle = 'rgba(140,190,240,.15)'; g.beginPath(); for (let db = -60; db <= 0; db += 12) { g.moveTo(X(db), 0); g.lineTo(X(db), h); g.moveTo(0, Y(db)); g.lineTo(w, Y(db)); } g.stroke();
        g.strokeStyle = 'rgba(255,255,255,.25)'; g.beginPath(); g.moveTo(X(-60), Y(-60)); g.lineTo(X(0), Y(0)); g.stroke();
        const T = v.threshold, R = v.ratio, Wk = v.knee, gc = x => { const d = x - T; if (2 * d < -Wk) return x; if (Wk > 0 && 2 * Math.abs(d) <= Wk) return x + (1 / R - 1) * (d + Wk / 2) ** 2 / (2 * Wk); return T + d / R; };
        g.beginPath(); for (let db = -60; db <= 0; db += 0.5) { const y = gc(db) + v.makeup; db === -60 ? g.moveTo(X(db), Y(y)) : g.lineTo(X(db), Y(Math.min(6, y))); } g.strokeStyle = '#ffd34a'; g.lineWidth = 2; g.stroke();
        g.fillStyle = '#8fb0d0'; g.font = '9.5px Segoe UI'; g.fillText('input dB →', w - 70, h - 12); g.fillText('output', 14, 14);
      },
      process: (segs, sr, v) => DSP.compress(segs, sr, v) });
  };
  defs.limiter = () => fxDialog({ title: 'Hard Limiter', instruction: 'Look-ahead brick-wall limiter: output never exceeds the ceiling.', fields: [
    { key: 'gain', label: 'Input boost', type: 'range', min: 0, max: 24, step: 0.5, value: 6, fmt: dbf }, { key: 'ceiling', label: 'Ceiling', type: 'range', min: -12, max: 0, step: 0.1, value: -1, fmt: v => v.toFixed(1) + ' dBFS' },
    { key: 'release', label: 'Release', type: 'range', min: 10, max: 1000, step: 1, value: 80, fmt: msf }, { key: 'lookahead', label: 'Look-ahead', type: 'range', min: 1, max: 10, step: 0.5, value: 5, fmt: msf }],
    process: (segs, sr, v) => DSP.limit(segs, sr, v) });
  defs.gate = () => fxDialog({ title: 'Noise Gate', fields: [
    { key: 'threshold', label: 'Open threshold', type: 'range', min: -80, max: 0, step: 0.5, value: -40, fmt: dbf }, { key: 'hysteresis', label: 'Hysteresis', type: 'range', min: 0, max: 20, step: 0.5, value: 4, fmt: dbf },
    { key: 'attack', label: 'Attack', type: 'range', min: 0.1, max: 50, step: 0.1, value: 1, fmt: msf }, { key: 'hold', label: 'Hold', type: 'range', min: 0, max: 500, step: 1, value: 40, fmt: msf },
    { key: 'release', label: 'Release', type: 'range', min: 5, max: 2000, step: 1, value: 150, fmt: msf }, { key: 'range', label: 'Range (attenuation)', type: 'range', min: 3, max: 90, step: 1, value: 60, fmt: v => '−' + v + ' dB' }],
    process: (segs, sr, v) => DSP.gate(segs, sr, v) });

  // EQ
  const BAND_COLORS = ['#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#4dabf7', '#9775fa', '#f783ac'];
  const EQ_PRESETS = {
    flat: () => [{ type: 'highpass', f: 30, q: 0.707, gain: 0, slope: 12, on: false }, { type: 'lowshelf', f: 100, q: 0.7, gain: 0 }, { type: 'peaking', f: 300, q: 1, gain: 0 }, { type: 'peaking', f: 1000, q: 1, gain: 0 }, { type: 'peaking', f: 3500, q: 1, gain: 0 }, { type: 'highshelf', f: 9000, q: 0.7, gain: 0 }, { type: 'lowpass', f: 19000, q: 0.707, gain: 0, slope: 12, on: false }],
    voice: () => [{ type: 'highpass', f: 85, q: 0.707, gain: 0, slope: 24, on: true }, { type: 'lowshelf', f: 140, q: 0.7, gain: -2 }, { type: 'peaking', f: 320, q: 1.2, gain: -3 }, { type: 'peaking', f: 1100, q: 1, gain: 0 }, { type: 'peaking', f: 3200, q: 1.1, gain: 3.5 }, { type: 'highshelf', f: 9500, q: 0.7, gain: 2.5 }, { type: 'lowpass', f: 18000, q: 0.707, gain: 0, slope: 12, on: false }],
    bass: () => [{ type: 'highpass', f: 25, q: 0.707, gain: 0, slope: 12, on: true }, { type: 'lowshelf', f: 110, q: 0.7, gain: 6 }, { type: 'peaking', f: 300, q: 1.4, gain: -2 }, { type: 'peaking', f: 1000, q: 1, gain: 0 }, { type: 'peaking', f: 3500, q: 1, gain: 0 }, { type: 'highshelf', f: 9000, q: 0.7, gain: 1 }, { type: 'lowpass', f: 19000, q: 0.707, gain: 0, slope: 12, on: false }],
    phone: () => [{ type: 'highpass', f: 400, q: 0.707, gain: 0, slope: 48, on: true }, { type: 'lowshelf', f: 100, q: 0.7, gain: 0, on: false }, { type: 'peaking', f: 800, q: 1, gain: 2 }, { type: 'peaking', f: 1800, q: 1.4, gain: 5 }, { type: 'peaking', f: 3500, q: 1, gain: 0, on: false }, { type: 'highshelf', f: 9000, q: 0.7, gain: 0, on: false }, { type: 'lowpass', f: 3200, q: 0.707, gain: 0, slope: 48, on: true }],
    demud: () => [{ type: 'highpass', f: 50, q: 0.707, gain: 0, slope: 12, on: true }, { type: 'lowshelf', f: 100, q: 0.7, gain: 0 }, { type: 'peaking', f: 250, q: 1.5, gain: -4.5 }, { type: 'peaking', f: 500, q: 1.2, gain: -2 }, { type: 'peaking', f: 4000, q: 0.9, gain: 2 }, { type: 'highshelf', f: 10000, q: 0.7, gain: 1.5 }, { type: 'lowpass', f: 19000, q: 0.707, gain: 0, slope: 12, on: false }]
  };
  let lastPeq = null;
  defs.peq = () => {
    let bands = (lastPeq || EQ_PRESETS.voice()).map(b => ({ on: true, slope: 12, ...b })), selB = 4, out = 0;
    const sr = App.doc.sr, FMIN = 20, FMAX = Math.min(22000, sr / 2), RANGE = 24;
    const types = [['peaking', 'Bell'], ['lowshelf', 'Low shelf'], ['highshelf', 'High shelf'], ['highpass', 'High-pass'], ['lowpass', 'Low-pass'], ['notch', 'Notch'], ['bandpass', 'Band-pass']];
    const html = `<div class="peq"><div class="peq-top"><label>Preset <select data-preset><option value="">(choose)</option><option value="flat">Flat</option><option value="voice">Voice clarity</option><option value="bass">Bass boost</option><option value="demud">De-mud</option><option value="phone">Telephone</option></select></label><label>Output <input type="number" data-out value="0" step="0.5" min="-24" max="24" style="width:60px"> dB</label><span class="dim">Drag points · wheel = Q · double-click toggles band</span></div>
      <canvas class="peq-graph" data-g></canvas>
      <div class="peq-band"><span class="peq-sw" data-sw></span><b data-bn>Band</b><label><input type="checkbox" data-on> On</label><select data-type>${types.map(t => `<option value="${t[0]}">${t[1]}</option>`).join('')}</select>
      <label>Freq <input type="number" data-f min="20" max="22000" step="1" style="width:70px"> Hz</label><label>Gain <input type="number" data-gain min="-24" max="24" step="0.1" style="width:56px"> dB</label><label>Q <input type="number" data-q min="0.1" max="20" step="0.05" style="width:52px"></label><select data-slope><option value="12">12 dB/oct</option><option value="24">24 dB/oct</option><option value="48">48 dB/oct</option></select></div></div>`;
    let dlg, notify;
    const X = (f, w) => 8 + (w - 16) * Math.log(f / FMIN) / Math.log(FMAX / FMIN), F = (x, w) => FMIN * Math.pow(FMAX / FMIN, (x - 8) / (w - 16));
    const Y = (db, h) => 8 + (h - 24) * (RANGE - db) / (2 * RANGE), G = (y, h) => RANGE - (y - 8) / (h - 24) * 2 * RANGE;
    const handleXY = (b, w, h) => [X(b.f, w), (b.type === 'highpass' || b.type === 'lowpass' || b.type === 'notch' || b.type === 'bandpass') ? Y(0, h) : Y(b.gain, h)];
    function draw() {
      const { g, w, h } = canvasIn(dlg, '[data-g]'); graphBg(g, w, h);
      freqGrid(g, w, h, f => X(f, w), db => Y(db, h), [-18, -12, -6, 6, 12, 18]);
      bands.forEach((b, i) => { if (b.on === false) return; const c = DSP.eqCoefs([b], sr); g.beginPath(); for (let x = 8; x < w - 8; x += 2) { const y = Y(clamp(DSP.eqResponseDb(c, F(x, w), sr), -RANGE - 6, RANGE + 6), h); x === 8 ? g.moveTo(x, y) : g.lineTo(x, y); } g.strokeStyle = BAND_COLORS[i] + (i === selB ? 'cc' : '55'); g.lineWidth = 1; g.stroke(); });
      const all = DSP.eqCoefs(bands, sr); g.beginPath();
      for (let x = 8; x < w - 8; x++) { const y = Y(clamp(DSP.eqResponseDb(all, F(x, w), sr) + out, -RANGE - 6, RANGE + 6), h); x === 8 ? g.moveTo(x, y) : g.lineTo(x, y); }
      const path = new Path2D(); g.lineWidth = 2.2; g.strokeStyle = '#fff'; g.stroke(); void path;
      g.lineTo(w - 8, Y(0, h)); g.lineTo(8, Y(0, h)); g.closePath(); g.fillStyle = 'rgba(120,220,255,.12)'; g.fill();
      bands.forEach((b, i) => { const [x, y] = handleXY(b, w, h); g.beginPath(); g.arc(x, y, i === selB ? 7.5 : 6, 0, 7); g.fillStyle = b.on === false ? '#556' : BAND_COLORS[i]; g.fill(); g.lineWidth = i === selB ? 2 : 1; g.strokeStyle = '#fff'; g.stroke(); g.fillStyle = '#0b1a2b'; g.font = 'bold 9px Segoe UI'; g.fillText(i + 1, x - 2.6, y + 3.2); });
    }
    function syncEditor() {
      const b = bands[selB], q = s => dlg.el.querySelector(s);
      q('[data-sw]').style.background = BAND_COLORS[selB]; q('[data-bn]').textContent = 'Band ' + (selB + 1);
      q('[data-on]').checked = b.on !== false; q('[data-type]').value = b.type; q('[data-f]').value = Math.round(b.f); q('[data-gain]').value = (+b.gain).toFixed(1); q('[data-q]').value = (+b.q).toFixed(2); q('[data-slope]').value = String(b.slope || 12);
      const pass = b.type === 'highpass' || b.type === 'lowpass';
      q('[data-gain]').disabled = pass || b.type === 'notch' || b.type === 'bandpass'; q('[data-slope]').hidden = !pass;
    }
    const changed = () => { lastPeq = bands.map(b => ({ ...b })); dlg.extra = { bands: lastPeq, out }; draw(); syncEditor(); notify(); };
    dlg = fxDialog({ title: 'Parametric Equalizer', width: 640, html,
      onOpen: (d, v, n) => {
        dlg = d; notify = n; const q = s => d.el.querySelector(s), cv = q('[data-g]');
        let drag = null;
        const pick = e => { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let best = -1, bd = 14; bands.forEach((b, i) => { const [hx, hy] = handleXY(b, r.width, r.height); const dd = Math.hypot(hx - x, hy - y); if (dd < bd) { bd = dd; best = i; } }); return { best, x, y, r }; };
        cv.addEventListener('pointerdown', e => { const p = pick(e); if (p.best >= 0) { selB = p.best; drag = true; try { cv.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }; bands[selB].on = bands[selB].on === false ? true : bands[selB].on; changed(); } });
        cv.addEventListener('pointermove', e => { if (!drag) return; const r = cv.getBoundingClientRect(), b = bands[selB]; b.f = clamp(F(e.clientX - r.left, r.width), FMIN, FMAX * 0.98); if (!['highpass', 'lowpass', 'notch', 'bandpass'].includes(b.type)) b.gain = Math.round(clamp(G(e.clientY - r.top, r.height), -RANGE, RANGE) * 10) / 10; changed(); });
        cv.addEventListener('pointerup', () => drag = null);
        cv.addEventListener('wheel', e => { e.preventDefault(); const p = pick(e); if (p.best >= 0) selB = p.best; const b = bands[selB]; b.q = clamp(b.q * (e.deltaY < 0 ? 1.12 : 1 / 1.12), 0.1, 20); changed(); }, { passive: false });
        cv.addEventListener('dblclick', e => { const p = pick(e); if (p.best >= 0) { bands[p.best].on = bands[p.best].on === false; changed(); } });
        q('[data-on]').onchange = e => { bands[selB].on = e.target.checked; changed(); };
        q('[data-type]').onchange = e => { bands[selB].type = e.target.value; changed(); };
        q('[data-f]').onchange = e => { bands[selB].f = clamp(+e.target.value || 1000, FMIN, FMAX); changed(); };
        q('[data-gain]').onchange = e => { bands[selB].gain = clamp(+e.target.value || 0, -RANGE, RANGE); changed(); };
        q('[data-q]').onchange = e => { bands[selB].q = clamp(+e.target.value || 1, 0.1, 20); changed(); };
        q('[data-slope]').onchange = e => { bands[selB].slope = +e.target.value; changed(); };
        q('[data-out]').onchange = e => { out = clamp(+e.target.value || 0, -24, 24); changed(); };
        q('[data-preset]').onchange = e => { if (EQ_PRESETS[e.target.value]) { bands = EQ_PRESETS[e.target.value]().map(b => ({ on: true, slope: 12, ...b })); changed(); } };
        requestAnimationFrame(changed);
      },
      process: (segs, sr2, v) => { const c = DSP.eqCoefs(v?.bands || bands, sr2), g = DSP.dbToLin(v?.out ?? out); return segs.map(s => { const y = DSP.biquadRun(s, c); if (g !== 1) for (let i = 0; i < y.length; i++) y[i] *= g; return y; }); },
      apply: () => App.applyProc('Parametric EQ', (segs, sr2) => { const c = DSP.eqCoefs(bands, sr2), g = DSP.dbToLin(out); return segs.map(s => { const y = DSP.biquadRun(s, c); if (g !== 1) for (let i = 0; i < y.length; i++) y[i] *= g; return y; }); }) });
    return dlg;
  };
  defs.geq = () => {
    const fields = DSP.GEQ_FREQS.map((f, i) => ({ key: 'b' + i, label: hz(f), type: 'range', min: -12, max: 12, step: 0.5, value: 0, fmt: dbf }));
    return fxDialog({ title: 'Graphic Equalizer (10 bands)', width: 520, fields: [{ key: 'preset', label: 'Preset', type: 'select', value: '', options: [['', '(choose)'], ['flat', 'Flat'], ['smile', 'Loudness smile'], ['vocal', 'Vocal presence'], ['bass', 'Bass boost'], ['air', 'Air']] }, ...fields],
      html: '<canvas class="fx-curve" data-c></canvas>',
      onOpen: dlg => { const P = { flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], smile: [5, 4, 2, 0, -1.5, -1.5, 0, 2, 4, 5], vocal: [-4, -3, -1, 0, 1, 2, 4, 3, 1, 0], bass: [6, 6, 4, 1, 0, 0, 0, 0, 0, 0], air: [0, 0, 0, 0, 0, 0, 1, 2, 4, 6] }; const s = dlg.el.querySelector('select'); s.addEventListener('change', () => (P[s.value] || []).forEach((g, i) => dlg.set('b' + i, g))); },
      onChange: (v, dlg) => { if (!dlg) return; const sr = App.doc.sr, { g, w, h } = canvasIn(dlg, '[data-c]'); graphBg(g, w, h); const X = f => 6 + (w - 12) * Math.log(f / 20) / Math.log(20000 / 20), Y = db => h / 2 - db / 15 * (h / 2 - 8); freqGrid(g, w, h, X, Y, [-12, -6, 6, 12]); const c = DSP.geqCoefs(DSP.GEQ_FREQS.map((_, i) => v['b' + i]), sr); g.beginPath(); for (let x = 6; x < w - 6; x++) { const f = 20 * Math.pow(1000, (x - 6) / (w - 12)), y = Y(DSP.eqResponseDb(c, Math.min(f, sr / 2 * 0.99), sr)); x === 6 ? g.moveTo(x, y) : g.lineTo(x, y); } g.strokeStyle = '#7ff0c4'; g.lineWidth = 2; g.stroke(); },
      process: (segs, sr, v) => { const c = DSP.geqCoefs(DSP.GEQ_FREQS.map((_, i) => v['b' + i]), sr); return segs.map(s => DSP.biquadRun(s, c)); } });
  };

  // reverb (OfflineAudioContext convolution)
  async function convolve(segs, sr, v) {
    const ir = DSP.impulseResponse(v.type, sr, { decay: v.decay, predelay: v.predelay, damping: v.damping });
    const n = segs[0].length, ctx = new OfflineAudioContext(segs.length, n, sr);
    const src = ctx.createBuffer(segs.length, n, sr); segs.forEach((s, i) => src.copyToChannel(s, i));
    const node = ctx.createBufferSource(); node.buffer = src;
    const split = ctx.createChannelSplitter(segs.length), merge = ctx.createChannelMerger(segs.length);
    node.connect(split);
    for (let c = 0; c < segs.length; c++) {
      const conv = ctx.createConvolver(); conv.normalize = false;
      const irb = ctx.createBuffer(1, ir[0].length, sr); irb.copyToChannel(ir[c % 2], 0); conv.buffer = irb;
      const wet = ctx.createGain(); wet.gain.value = v.wet / 100 * 1.6; const dry = ctx.createGain(); dry.gain.value = v.dry / 100;
      split.connect(conv, c); conv.connect(wet); wet.connect(merge, 0, c);
      split.connect(dry, c); dry.connect(merge, 0, c);
    }
    merge.connect(ctx.destination); node.start();
    const r = await ctx.startRendering();
    return segs.map((_, i) => r.getChannelData(i).slice());
  }
  defs.reverb = () => fxDialog({ title: 'Convolution Reverb', instruction: 'Impulse responses are generated (no samples needed).', fields: [
    { key: 'type', label: 'Space', type: 'select', value: 'hall', options: [['room', 'Room'], ['hall', 'Concert hall'], ['plate', 'Plate']] },
    { key: 'decay', label: 'Decay (RT60)', type: 'range', min: 0.2, max: 8, step: 0.05, value: 2.6, fmt: v => v.toFixed(2) + ' s' }, { key: 'predelay', label: 'Pre-delay', type: 'range', min: 0, max: 200, step: 1, value: 22, fmt: msf },
    { key: 'damping', label: 'High-frequency damping', type: 'range', min: 1000, max: 16000, step: 100, value: 4500, fmt: hz }, { key: 'wet', label: 'Wet', type: 'range', min: 0, max: 100, step: 1, value: 30, fmt: pct }, { key: 'dry', label: 'Dry', type: 'range', min: 0, max: 100, step: 1, value: 100, fmt: pct }],
    onOpen: dlg => { const s = dlg.el.querySelector('select'); s.addEventListener('change', () => { const p = DSP.REVERB_PRESETS[s.value]; dlg.set('decay', p.decay); dlg.set('predelay', p.predelay); dlg.set('damping', p.damping); }); },
    process: convolve, label: 'Reverb' });
  defs.delay = () => fxDialog({ title: 'Delay / Echo', fields: [
    { key: 'time', label: 'Delay time', type: 'range', min: 1, max: 2000, step: 1, value: 320, fmt: msf }, { key: 'feedback', label: 'Feedback', type: 'range', min: 0, max: 95, step: 1, value: 40, fmt: pct },
    { key: 'mix', label: 'Echo level', type: 'range', min: 0, max: 100, step: 1, value: 40, fmt: pct }, { key: 'damp', label: 'Echo tone (low-pass)', type: 'range', min: 500, max: 20000, step: 100, value: 6000, fmt: hz },
    { key: 'pingpong', label: 'Ping-pong (stereo)', type: 'checkbox', value: false }],
    process: (segs, sr, v) => DSP.delay(segs, sr, v) });
  defs.chorus = () => {
    const P = { chorus: { delay: 18, depth: 6, rate: 0.8, feedback: 0, voices: 3, mix: 50 }, flanger: { delay: 2.5, depth: 2, rate: 0.25, feedback: 60, voices: 1, mix: 50 }, vibrato: { delay: 4, depth: 3, rate: 5, feedback: 0, voices: 1, mix: 100 } };
    return fxDialog({ title: 'Chorus / Flanger', fields: [
      { key: 'mode', label: 'Mode', type: 'select', value: 'chorus', options: [['chorus', 'Chorus'], ['flanger', 'Flanger'], ['vibrato', 'Vibrato']] },
      { key: 'delay', label: 'Delay', type: 'range', min: 0.5, max: 40, step: 0.1, value: 18, fmt: msf }, { key: 'depth', label: 'Depth', type: 'range', min: 0, max: 20, step: 0.1, value: 6, fmt: msf },
      { key: 'rate', label: 'Rate', type: 'range', min: 0.05, max: 10, step: 0.05, value: 0.8, fmt: v => v.toFixed(2) + ' Hz' }, { key: 'feedback', label: 'Feedback', type: 'range', min: -90, max: 90, step: 1, value: 0, fmt: pct },
      { key: 'voices', label: 'Voices', type: 'range', min: 1, max: 6, step: 1, value: 3 }, { key: 'spread', label: 'Stereo spread', type: 'range', min: 0, max: 180, step: 1, value: 90, fmt: v => v + '°' },
      { key: 'mix', label: 'Mix', type: 'range', min: 0, max: 100, step: 1, value: 50, fmt: pct }],
      onOpen: dlg => { const s = dlg.el.querySelector('select'); s.addEventListener('change', () => Object.entries(P[s.value]).forEach(([k, v]) => dlg.set(k, v))); },
      process: (segs, sr, v) => DSP.modulate(segs, sr, v), label: 'Chorus / Flanger' });
  };
  defs.distortion = () => fxDialog({ title: 'Distortion', fields: [
    { key: 'type', label: 'Type', type: 'select', value: 'tube', options: [['soft', 'Soft clip (tanh)'], ['tube', 'Tube (asymmetric)'], ['hard', 'Hard clip'], ['fold', 'Wave folder'], ['crush', 'Bit crusher']] },
    { key: 'drive', label: 'Drive', type: 'range', min: 0, max: 40, step: 0.5, value: 14, fmt: dbf }, { key: 'tone', label: 'Tone (low-pass)', type: 'range', min: 500, max: 20000, step: 100, value: 7000, fmt: hz },
    { key: 'bits', label: 'Bits (crusher)', type: 'range', min: 2, max: 16, step: 1, value: 6 }, { key: 'downsample', label: 'Sample hold (crusher)', type: 'range', min: 1, max: 32, step: 1, value: 4, fmt: v => '÷' + v },
    { key: 'mix', label: 'Mix', type: 'range', min: 0, max: 100, step: 1, value: 100, fmt: pct }, { key: 'output', label: 'Output', type: 'range', min: -24, max: 6, step: 0.5, value: -6, fmt: dbf }],
    process: (segs, sr, v) => DSP.distort(segs, sr, v) });

  // time & pitch
  defs.pitch = () => fxDialog({ title: 'Pitch Shift', instruction: 'Changes pitch without changing duration.', fields: [
    { key: 'semis', label: 'Semitones', type: 'range', min: -24, max: 24, step: 1, value: 3, fmt: v => (v > 0 ? '+' : '') + v + ' st' }, { key: 'cents', label: 'Fine tune', type: 'range', min: -100, max: 100, step: 1, value: 0, fmt: v => (v > 0 ? '+' : '') + v + ' cents' },
    { key: 'algo', label: 'Algorithm', type: 'select', value: 'wsola', options: [['wsola', 'WSOLA (speech, drums)'], ['pvoc', 'Phase vocoder (music, tonal)']] }],
    process: (segs, sr, v) => DSP.stretchPitch(segs, sr, 1, v.semis + v.cents / 100, v.algo) });
  defs.stretch = () => {
    const [a, b] = App.procRange(), dur = (b - a) / App.doc.sr;
    return fxDialog({ title: 'Time Stretch', instruction: `Changes duration without changing pitch (${App.hasSel() ? 'selection' : 'whole file'}: ${App.fmtT(dur)}).`, fields: [
      { key: 'pct', label: 'Stretch (new length)', type: 'range', min: 25, max: 400, step: 1, value: 125, fmt: v => v + ' %' },
      { key: 'algo', label: 'Algorithm', type: 'select', value: 'wsola', options: [['wsola', 'WSOLA (speech, drums)'], ['pvoc', 'Phase vocoder (music, tonal)']] },
      { key: 'semis', label: 'Also shift pitch', type: 'range', min: -12, max: 12, step: 1, value: 0, fmt: v => (v > 0 ? '+' : '') + v + ' st' }],
      html: '<div class="dnote" data-info></div>',
      onChange: (v, dlg) => { if (dlg) dlg.el.querySelector('[data-info]').textContent = `New duration ${App.fmtT(dur * v.pct / 100)} · tempo ${(10000 / v.pct).toFixed(1)} %`; }, onOpen: (d, v, ch) => ch(),
      process: (segs, sr, v) => DSP.stretchPitch(segs, sr, v.pct / 100, v.semis, v.algo),
      apply: async v => {
        Aero.busy('Stretching…'); await App.tick();
        try { const d = App.doc, segs = d.chs.map(c => c.slice(a, b)); const out = DSP.stretchPitch(segs, d.sr, v.pct / 100, v.semis, v.algo); App.replaceRange('Time Stretch', a, b, out); }
        finally { Aero.busy(); }
      } });
  };

  // restoration
  defs.capture = () => {
    if (!App.hasSel()) return Aero.alert('Capture Noise Profile', 'Select a region that contains only background noise (e.g. the first second of the sample, marked “Noise only”), then capture.');
    const d = App.doc, { a, b } = App.sel; if (b - a < 2048) return Aero.toast('Select at least 50 ms of noise');
    App.noiseProfile = DSP.noiseProfile(d.chs.map(c => c.subarray(a, b)), d.sr);
    Aero.toast(`Noise profile captured (${(App.noiseProfile.seconds).toFixed(2)} s, ${d.chs.length} ch)`);
  };
  defs.denoise = () => {
    const P = App.noiseProfile;
    if (!P) return Aero.alert('Noise Reduction', 'First select a stretch of pure background noise and choose Restoration › Capture Noise Profile (Shift+P). Then select the audio to clean (or nothing for the whole file) and run Noise Reduction.');
    if (P.sr !== App.doc.sr) return Aero.alert('Noise Reduction', 'The noise profile was captured at a different sample rate. Capture it again from this file.');
    return fxDialog({ title: 'Noise Reduction', width: 560, instruction: `Spectral subtraction using the captured profile (${P.seconds.toFixed(2)} s).`, fields: [
      { key: 'reduction', label: 'Reduction', type: 'range', min: 0, max: 40, step: 0.5, value: 18, fmt: v => v + ' dB' }, { key: 'sensitivity', label: 'Noise threshold offset', type: 'range', min: -6, max: 18, step: 0.5, value: 6, fmt: dbf },
      { key: 'smoothing', label: 'Frequency smoothing', type: 'range', min: 0, max: 8, step: 1, value: 3, fmt: v => v + ' bins' }, { key: 'attack', label: 'Attack', type: 'range', min: 1, max: 100, step: 1, value: 10, fmt: msf },
      { key: 'release', label: 'Release', type: 'range', min: 10, max: 500, step: 5, value: 100, fmt: msf }, { key: 'residual', label: 'Output noise only (listen to what is removed)', type: 'checkbox', value: false }],
      html: '<canvas class="fx-curve" data-c></canvas>',
      onChange: (v, dlg) => {
        if (!dlg) return; const { g, w, h } = canvasIn(dlg, '[data-c]'); graphBg(g, w, h); const sr = P.sr, N = P.N, X = f => 6 + (w - 12) * Math.log(f / 20) / Math.log(sr / 2 / 20), Y = db => 8 + (h - 22) * (-db / 120);
        freqGrid(g, w, h, X, Y, [-20, -40, -60, -80, -100]);
        let ws = 0; const wn = DSP.hann(N); for (let i = 0; i < N; i++) ws += wn[i];
        const line = (fn, col) => { g.beginPath(); for (let x = 6; x < w - 6; x++) { const f = 20 * Math.pow(sr / 2 / 20, (x - 6) / (w - 12)), k = Math.min(N / 2, Math.round(f / sr * N)); const y = Y(clamp(fn(k), -120, 0)); x === 6 ? g.moveTo(x, y) : g.lineTo(x, y); } g.strokeStyle = col; g.lineWidth = 1.5; g.stroke(); };
        const m = k => P.mags.reduce((s, a) => s + a[k], 0) / P.mags.length;
        line(k => DSP.linToDb(m(k) * 2 / ws), '#ffd34a'); line(k => DSP.linToDb(m(k) * 2 / ws) + v.sensitivity, 'rgba(255,120,90,.8)');
        g.fillStyle = '#ffd34a'; g.font = '10px Segoe UI'; g.fillText('noise profile', w - 140, 16); g.fillStyle = '#ff7a5a'; g.fillText('threshold', w - 64, 16);
      }, onOpen: (d, v, ch) => ch(),
      process: (segs, sr, v) => DSP.noiseReduce(segs, sr, P, v), label: 'Noise Reduction' });
  };
  defs.declick = () => fxDialog({ title: 'De-click', instruction: 'Detects impulsive clicks with an LPC residual and repairs them by AR interpolation.', fields: [
    { key: 'threshold', label: 'Detection threshold', type: 'range', min: 4, max: 40, step: 0.5, value: 10, fmt: v => v + '× (lower = more)' }, { key: 'maxWidth', label: 'Max click width', type: 'range', min: 0.2, max: 6, step: 0.1, value: 2, fmt: msf }],
    process: (segs, sr, v) => DSP.declick(segs, sr, v),
    apply: v => App.applyProc('De-click', (segs, sr) => { const r = DSP.declick(segs, sr, v); setTimeout(() => Aero.toast(`De-click repaired ${r.count} click${r.count === 1 ? '' : 's'}`), 2300); return r; }) });

  // conversions (whole file)
  defs.channels = () => {
    const d = App.doc, n = d.chs.length;
    const opts = n === 1 ? [['stereo', 'Mono → Stereo (duplicate)']] : [['mono', 'Mix down to mono'], ['left', 'Keep left only (mono)'], ['right', 'Keep right only (mono)'], ...(n > 2 ? [['stereo', `${n} ch → Stereo (downmix)`]] : [['swap', 'Swap left / right']])];
    Aero.dialog({ title: 'Convert Channels', instruction: `Current: ${n === 1 ? 'mono' : n === 2 ? 'stereo' : n + ' channels'}. Applies to the whole file.`, fields: [{ key: 'to', label: 'Conversion', type: 'select', value: opts[0][0], options: opts }], onOK: v => {
      let chs;
      if (v.to === 'mono') { const m = new Float32Array(d.chs[0].length); d.chs.forEach(c => { for (let i = 0; i < m.length; i++) m[i] += c[i] / n; }); chs = [m]; }
      else if (v.to === 'left') chs = [d.chs[0].slice()]; else if (v.to === 'right') chs = [d.chs[1].slice()];
      else if (v.to === 'swap') chs = [d.chs[1], d.chs[0]];
      else if (n === 1) chs = [d.chs[0].slice(), d.chs[0].slice()];
      else { // ITU downmix for 5.1, else alternate
        const L = new Float32Array(d.chs[0].length), R = new Float32Array(L.length), g = Math.SQRT1_2;
        if (n === 6) for (let i = 0; i < L.length; i++) { L[i] = d.chs[0][i] + g * d.chs[2][i] + g * d.chs[4][i]; R[i] = d.chs[1][i] + g * d.chs[2][i] + g * d.chs[5][i]; }
        else d.chs.forEach((c, k) => { const t = k % 2 ? R : L; for (let i = 0; i < L.length; i++) t[i] += c[i] * 2 / n; });
        chs = [L, R];
      }
      App.chOn = chs.map(() => true); App.commit('Convert Channels', chs);
    } });
  };
  defs.samplerate = () => {
    const d = App.doc;
    Aero.dialog({ title: 'Change Sample Rate', instruction: `Current: ${d.sr} Hz. Applies to the whole file.`, fields: [
      { key: 'sr', label: 'New sample rate', type: 'select', value: d.sr === 48000 ? '44100' : '48000', options: ['8000', '11025', '16000', '22050', '24000', '32000', '44100', '48000', '88200', '96000', '176400', '192000'].map(v => [v, v + ' Hz']) },
      { key: 'how', label: 'Method', type: 'select', value: 'resample', options: [['resample', 'Resample (keep pitch and duration)'], ['label', 'Reinterpret (change speed and pitch)']] }],
      onOK: async v => {
        const to = +v.sr; if (to === d.sr) return;
        if (v.how === 'label') { const f = d.sr / to; d.markers.forEach(m => m.time *= f); App.commit('Reinterpret Sample Rate', d.chs, { sr: to, sel: { a: App.sel.a, b: App.sel.b } }); return; }
        Aero.busy('Resampling…'); await App.tick();
        try {
          const r = to / d.sr, chs = d.chs.map(c => DSP.resample(c, r));
          App.commit('Change Sample Rate', chs, { sr: to, sel: { a: Math.round(App.sel.a * r), b: Math.round(App.sel.b * r) } });
          App.view.spp *= r; App.view.start *= r; Wave.clampView();
        } finally { Aero.busy(); }
      } });
  };

  function open(name) { const f = defs[name]; if (!f) return; if (!App.ensureDoc()) return; Engine.stop(); return f(); }
  return { open, defs, fxDialog, convolve, EQ_PRESETS };
})();

/* ================= Recorder ================= */
window.Recorder = (() => {
  let ctl = null, raf = 0, dlg = null, peakHold = 0, finishing = false;
  async function open() {
    if (dlg) return;
    Engine.stop();
    const target = App.mode === 'multi' ? 'track' : App.doc ? 'insert' : 'new';
    dlg = Aero.dialog({ title: 'Record', ok: 'Close', noCancel: true, width: 520,
      fields: [{ key: 'target', label: 'Record into', type: 'select', value: target, options: [['insert', 'Current file, at the cursor'], ['new', 'A new file'], ['track', 'New multitrack track at the playhead']] },
        { key: 'ch', label: 'Channels', type: 'select', value: '1', options: [['1', 'Mono'], ['2', 'Stereo']] }],
      html: `<div class="rec"><div class="rec-dev dim" data-dev>Opening microphone…</div><canvas class="rec-meter" data-m></canvas><div class="rec-row"><button class="aero-btn" data-rec>● Record</button><button class="aero-btn" data-stop disabled>■ Stop</button><span class="rec-time mono" data-t>0:00.0</span></div><div class="dnote" data-msg></div></div>`,
      onOK: close });
    const q = s => dlg.el.querySelector(s);
    const me = dlg;
    const start = async () => {
      ctl?.close(); ctl = null;
      try {
        const c = await Engine.openInput({ channels: +me.values.ch });
        if (dlg !== me) { c.close(); return; } // dialog closed while the device was opening
        ctl = c; q('[data-dev]').textContent = `Input: ${ctl.label} · ${ctl.sr} Hz · ${ctl.channels} ch`; q('[data-rec]').disabled = false; }
      catch (e) {
        if (dlg !== me) return;
        q('[data-dev]').textContent = 'Microphone unavailable'; q('[data-msg]').textContent = e.message; q('[data-rec]').disabled = true;
        Aero.toast(e.code === 'denied' ? 'Microphone permission denied' : 'No microphone available');
      }
    };
    q('[data-rec]').onclick = () => { if (!ctl) return; ctl.start(); q('[data-rec]').disabled = true; q('[data-stop]').disabled = false; q('[data-msg]').textContent = 'Recording…'; };
    q('[data-stop]').onclick = () => finish();
    dlg.el.querySelector('select:nth-of-type(1)');
    dlg.el.querySelectorAll('select')[1].addEventListener('change', start);
    loop(); await start();
  }
  async function finish() {
    if (!ctl || !ctl.recording || finishing) return;
    finishing = true; ctl.markStop();
    const c = ctl, d = dlg, target = dlg.values.target;
    await new Promise(r => setTimeout(r, 200)); // let in-flight audio blocks arrive
    finishing = false;
    const { chs, sr } = c.take();
    if (!d || !document.body.contains(d.el)) { if (chs[0].length) deliver(chs, sr, target); return; }
    const q = s => d.el.querySelector(s);
    q('[data-rec]').disabled = false; q('[data-stop]').disabled = true;
    if (!chs[0].length) { q('[data-msg]').textContent = 'Nothing was recorded.'; return; }
    deliver(chs, sr, target);
    q('[data-msg]').textContent = `Recorded ${App.fmtT(chs[0].length / sr)}. Record again or close.`;
  }
  function deliver(chs, sr, target) {
    if (target === 'track') { if (App.mode !== 'multi') App.setMode('multi'); Multi.addRecording(chs, sr); return; }
    if (target === 'new' || !App.doc) { App.projectName = 'Recording'; App.setDoc({ name: 'Recording', sr, chs, bits: '32-bit float' }, 'Record'); Aero.setDoc('Recording', true); return; }
    const d = App.doc; let data = chs;
    if (sr !== d.sr) data = data.map(c => DSP.resample(c, d.sr / sr));
    const n = d.chs.length; if (data.length !== n) data = Array.from({ length: n }, (_, i) => data[Math.min(i, data.length - 1)]);
    if (App.mode !== 'wave') App.setMode('wave');
    const a = App.sel.a, b = App.hasSel() ? App.sel.b : a;
    App.replaceRange('Record', a, b, data);
  }
  function loop() {
    cancelAnimationFrame(raf);
    const tick = () => {
      if (!dlg) return; raf = requestAnimationFrame(tick);
      const c = dlg.el.querySelector('[data-m]'); if (!c) return;
      const dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight; if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
      const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = '#0b1a2a'; g.fillRect(0, 0, w, h);
      const lv = ctl ? ctl.level() : 0, db = DSP.linToDb(lv), x = Math.max(0, (db + 60) / 60) * w; peakHold = Math.max(db, peakHold - 0.4);
      const grad = g.createLinearGradient(0, 0, w, 0); grad.addColorStop(0, '#1fae4a'); grad.addColorStop(0.7, '#47d16a'); grad.addColorStop(0.9, '#e8d33a'); grad.addColorStop(1, '#ff3b2a');
      g.fillStyle = grad; g.fillRect(0, 4, x, h - 8); g.fillStyle = '#fff'; g.fillRect(Math.max(0, (peakHold + 60) / 60 * w) - 1, 2, 2, h - 4);
      g.fillStyle = '#9fc3e6'; g.font = '10px Segoe UI'; g.fillText(lv > 0 ? db.toFixed(1) + ' dB' : '−∞', 6, h / 2 + 4);
      const t = dlg.el.querySelector('[data-t]'); if (t && ctl) t.textContent = App.fmtT(ctl.seconds).slice(0, -2);
      if (ctl?.recording) dlg.el.querySelector('[data-t]').classList.add('on'); else dlg.el.querySelector('[data-t]')?.classList.remove('on');
    };
    tick();
  }
  async function close() { const c = ctl, p = c?.recording ? finish() : null; dlg = null; cancelAnimationFrame(raf); if (p) await p; c?.close(); if (ctl === c) ctl = null; }
  return { open, deliver, get active() { return !!dlg; } };
})();
