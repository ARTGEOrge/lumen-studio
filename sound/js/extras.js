'use strict';
/* Lumen Sound — extra tools: remove dead air, automatic noise profile, signal generator (tones / sweeps /
   noise / DTMF), and CD-style track export (CUE sheet + WAV, optionally split into one file per track). */
window.Extras = (() => {
  const { clamp, esc } = Aero;
  const TAU = Math.PI * 2;

  /* ---------- remove dead air ---------- */
  function deadAirDialog() {
    if (!App.ensureDoc()) return;
    Aero.dialog({ title: 'Remove Dead Air', instruction: `Shortens every pause longer than the minimum to the chosen length (${App.hasSel() ? 'in the selection' : 'whole file'}). Joins are crossfaded; markers move with the audio.`, fields: [
      { key: 'threshold', label: 'Silence is below', type: 'range', min: -80, max: -20, step: 1, value: -45, fmt: v => v + ' dBFS' },
      { key: 'minMs', label: 'Pauses longer than (ms)', type: 'number', value: 700, min: 100, max: 10000, step: 50 },
      { key: 'keepMs', label: 'Shorten them to (ms)', type: 'number', value: 250, min: 0, max: 3000, step: 10 }],
      onOK: v => removeDeadAir(v) });
  }
  function removeDeadAir(p) {
    const d = App.doc, [a, b] = App.procRange(), segs = d.chs.map(c => c.subarray(a, b));
    const r = Batch.deadAir(segs, d.sr, { threshold: p.threshold, minMs: clamp(+p.minMs || 700, 100, 10000), keepMs: clamp(+p.keepMs || 0, 0, 3000) });
    if (!r.cuts.length) { Aero.toast('No pauses longer than ' + p.minMs + ' ms found'); return 0; }
    const removed = r.cuts.reduce((s, [x, y]) => s + y - x, 0), nl = (b - a) - removed;
    const chs = d.chs.map((c, i) => { const o = new Float32Array(c.length - removed); o.set(c.subarray(0, a)); o.set(r.chs[i], a); o.set(c.subarray(b), a + nl); return o; });
    d.markers = d.markers.map(m => { const s = Math.round(m.time * d.sr); if (s < a) return m; if (s >= b) return { ...m, time: (s - removed) / d.sr }; return { ...m, time: (a + Batch.mapThroughCuts(s - a, r.cuts)) / d.sr }; });
    App.commit(`Remove Dead Air (${r.cuts.length} pause${r.cuts.length === 1 ? '' : 's'}, −${(removed / d.sr).toFixed(1)} s)`, chs, { sel: { a, b: a + (App.hasSel() ? nl : 0) } });
    Wave.zoomFit();
    return r.cuts.length;
  }

  /* ---------- automatic noise profile ---------- */
  function learnNoise() {
    if (!App.ensureDoc()) return;
    const d = App.doc, [a, b] = App.procRange();
    if (b - a < d.sr * 0.5) return Aero.toast('Use at least half a second of audio');
    App.noiseProfile = Batch.autoNoiseProfile(d.chs.map(c => c.subarray(a, b)), d.sr);
    Aero.toast(`Noise profile learned from the quietest ${App.noiseProfile.seconds.toFixed(2)} s — now run Noise Reduction`);
  }

  /* ---------- generator ---------- */
  const DTMF = { '1': [697, 1209], '2': [697, 1336], '3': [697, 1477], 'A': [697, 1633], '4': [770, 1209], '5': [770, 1336], '6': [770, 1477], 'B': [770, 1633], '7': [852, 1209], '8': [852, 1336], '9': [852, 1477], 'C': [852, 1633], '*': [941, 1209], '0': [941, 1336], '#': [941, 1477], 'D': [941, 1633] };
  const blep = (t, dt) => { if (t < dt) { t /= dt; return t + t - t * t - 1; } if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; } return 0; };
  function generate(sr, p) {
    const amp = DSP.dbToLin(p.amp ?? -6);
    if (p.kind === 'dtmf') {
      const digits = String(p.digits || '').toUpperCase().split('').filter(c => DTMF[c]); if (!digits.length) throw new Error('Enter DTMF digits (0–9, *, #, A–D)');
      const tn = Math.round(sr * clamp(p.toneMs, 20, 2000) / 1000), gn = Math.round(sr * clamp(p.gapMs, 0, 2000) / 1000), x = new Float32Array(digits.length * (tn + gn));
      digits.forEach((c, k) => { const [f1, f2] = DTMF[c], o = k * (tn + gn), r = Math.min(Math.round(sr * 0.004), tn >> 2); for (let i = 0; i < tn; i++) { const e = Math.min(1, i / r, (tn - 1 - i) / r); x[o + i] = amp * 0.5 * (Math.sin(TAU * f1 * i / sr) + Math.sin(TAU * f2 * i / sr)) * e; } });
      return x;
    }
    const n = Math.max(1, Math.round(sr * clamp(p.dur, 0.001, 3600))), x = new Float32Array(n);
    if (p.kind === 'noise') {
      const r = DSP.rng(0x5eed + n);
      if (p.color === 'pink') { const pk = Samples.pinkNoise(n, 1, 0x5eed); x.set(pk); }
      else if (p.color === 'brown') { let y = 0; for (let i = 0; i < n; i++) { y = 0.995 * y + r() * 0.06; x[i] = y; } }
      else for (let i = 0; i < n; i++) x[i] = r();
      let m = 0; for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(x[i])); const g = m > 0 ? amp / m : 0; for (let i = 0; i < n; i++) x[i] *= g;
    } else {
      const f0 = clamp(p.freq, 1, sr * 0.49), f1 = p.sweep > 0 ? clamp(p.sweep, 1, sr * 0.49) : f0, T = n / sr; let ph = 0, tri = 0;
      for (let i = 0; i < n; i++) {
        const f = f0 === f1 ? f0 : f0 * Math.pow(f1 / f0, i / sr / T), dt = f / sr; let v;
        if (p.wave === 'square') v = (ph < 0.5 ? 1 : -1) + blep(ph, dt) - blep((ph + 0.5) % 1, dt);
        else if (p.wave === 'saw') v = 2 * ph - 1 - blep(ph, dt);
        else if (p.wave === 'triangle') { const sq = (ph < 0.5 ? 1 : -1) + blep(ph, dt) - blep((ph + 0.5) % 1, dt); tri = dt * sq * 4 + (1 - dt * 0.01) * tri; v = tri; }
        else v = Math.sin(TAU * ph);
        x[i] = v * amp; ph += dt; if (ph >= 1) ph -= 1;
      }
    }
    const r = Math.min(Math.round(sr * 0.005), n >> 2); for (let i = 0; i < r; i++) { const g = i / r; x[i] *= g; x[n - 1 - i] *= g; }
    return x;
  }
  function generateDialog(kind = 'tone') {
    const has = !!App.doc;
    Aero.dialog({ title: 'Generate', width: 460, instruction: 'Synthesise test tones, sweeps, noise or DTMF dial tones.', fields: [
      { key: 'kind', label: 'Generate', type: 'select', value: kind, options: [['tone', 'Tone / sweep'], ['noise', 'Noise'], ['dtmf', 'DTMF tones']] },
      { key: 'wave', label: 'Waveform', type: 'select', value: 'sine', options: [['sine', 'Sine'], ['square', 'Square'], ['saw', 'Sawtooth'], ['triangle', 'Triangle']] },
      { key: 'freq', label: 'Frequency (Hz)', type: 'number', value: 1000, min: 1, max: 96000, step: 1 },
      { key: 'sweep', label: 'Sweep to (Hz, 0 = none)', type: 'number', value: 0, min: 0, max: 96000, step: 1 },
      { key: 'color', label: 'Noise colour', type: 'select', value: 'pink', options: [['white', 'White'], ['pink', 'Pink'], ['brown', 'Brown']] },
      { key: 'digits', label: 'DTMF digits', type: 'text', value: '555-0123' },
      { key: 'toneMs', label: 'DTMF tone length (ms)', type: 'number', value: 120, min: 20, max: 2000, step: 10 }, { key: 'gapMs', label: '', type: 'hidden', value: 80 },
      { key: 'amp', label: 'Amplitude', type: 'range', min: -60, max: 0, step: 0.5, value: -6, fmt: v => v + ' dBFS' },
      { key: 'dur', label: 'Duration (s)', type: 'number', value: 2, min: 0.01, max: 3600, step: 0.1 },
      { key: 'where', label: 'Place', type: 'select', value: has ? 'insert' : 'new', options: [...(has ? [['insert', 'Insert at cursor'], ['replace', App.hasSel() ? 'Replace selection' : 'Replace selection (none)'], ['mix', 'Mix at cursor']] : []), ['new', 'New file']] }],
      onOK: v => { try { place(v); } catch (e) { Aero.alert('Generate', e.message); } } });
  }
  function place(v) {
    const sr = App.doc ? App.doc.sr : 48000, x = generate(sr, { ...v, gapMs: 80 }), label = v.kind === 'dtmf' ? 'Generate DTMF' : v.kind === 'noise' ? 'Generate Noise' : (v.sweep > 0 ? 'Generate Sweep' : 'Generate Tone');
    if (v.where === 'new' || !App.doc) { App.projectName = label.replace('Generate ', ''); App.setDoc({ name: App.projectName, sr, chs: [x, x.slice()] }, label); Aero.setDoc(App.projectName, true); return; }
    const d = App.doc, segs = d.chs.map(() => x);
    if (v.where === 'mix') { const a = App.sel.a, n = Math.max(d.chs[0].length, a + x.length); const chs = d.chs.map(c => { const o = new Float32Array(n); o.set(c); for (let i = 0; i < x.length; i++) o[a + i] += x[i]; return o; }); App.commit(label, chs, { sel: { a, b: a + x.length } }); return; }
    const a = App.sel.a, b = v.where === 'replace' && App.hasSel() ? App.sel.b : a;
    App.replaceRange(label, a, b, segs);
  }

  /* ---------- CD tracks: CUE sheet + WAV (and optional per-track split) ---------- */
  const msf = (sec) => { const fr = Math.round(sec * 75), m = Math.floor(fr / 4500), s = Math.floor(fr / 75) % 60, f = fr % 75; return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`; };
  const cueStr = s => String(s).replace(/["\r\n]/g, "'").slice(0, 80);
  function trackList(d) {
    const len = d.chs[0].length / d.sr, ms = d.markers.filter(m => m.time >= 0 && m.time < len - 0.05).sort((a, b) => a.time - b.time);
    const starts = ms.length && ms[0].time < 0.01 ? ms : [{ time: 0, label: 'Track 1' }, ...ms];
    return starts.slice(0, 99).map((m, i) => ({ n: i + 1, title: m.label || 'Track ' + (i + 1), start: Math.round(m.time * 75) / 75, end: i + 1 < starts.length ? Math.round(starts[i + 1].time * 75) / 75 : len }));
  }
  function buildCue(d, wavName, tracks) {
    let s = `REM GENERATOR "Lumen Sound"\nTITLE "${cueStr(d.name || 'Untitled')}"\nFILE "${cueStr(wavName)}" WAVE\n`;
    for (const t of tracks) s += `  TRACK ${String(t.n).padStart(2, '0')} AUDIO\n    TITLE "${cueStr(t.title)}"\n    INDEX 01 ${msf(t.start)}\n`;
    return s;
  }
  async function exportCdDialog() {
    if (!App.ensureDoc()) return;
    const tracks = trackList(App.doc);
    Aero.dialog({ title: 'Export CD Tracks', width: 500, instruction: `${tracks.length} track${tracks.length === 1 ? '' : 's'} from the markers (track boundaries are rounded to CD frames, 1/75 s).`, fields: [
      { key: 'cd', label: 'Convert to CD audio (44.1 kHz, 16-bit stereo)', type: 'checkbox', value: true },
      { key: 'split', label: 'Also save each track as its own WAV', type: 'checkbox', value: false }],
      html: `<table class="stats"><tr><th>#</th><th>Title</th><th>Start</th><th>Length</th></tr>${tracks.map(t => `<tr><td>${t.n}</td><td>${esc(t.title)}</td><td class="mono">${msf(t.start)}</td><td>${App.fmtT(t.end - t.start)}</td></tr>`).join('')}</table>`,
      onOK: v => exportCd(v) });
  }
  async function exportCd(v) {
    const d = App.doc; Aero.busy('Preparing CD tracks…'); await App.tick();
    try {
      let chs = d.chs, sr = d.sr;
      if (v.cd) {
        if (chs.length === 1) chs = [chs[0], chs[0]]; else if (chs.length > 2) chs = Batch.STEPS.channels.run(chs, sr, { to: 'stereo' }).chs;
        if (sr !== 44100) { chs = chs.map(c => DSP.resample(c, 44100 / sr)); sr = 44100; }
      }
      const tracks = trackList(d), base = (d.name || 'album').replace(/[\\/:*?"<>|]/g, '_'), wavName = base + '.wav', files = {};
      files[wavName] = Codecs.encodeWav(chs, sr, v.cd ? 'pcm16' : 'pcm24', tracks.map(t => ({ time: t.start, label: t.title })));
      files[base + '.cue'] = buildCue(d, wavName, tracks);
      if (v.split) for (const t of tracks) { const a = Math.round(t.start * sr), b = Math.min(chs[0].length, Math.round(t.end * sr)); files[`${String(t.n).padStart(2, '0')} ${t.title.replace(/[\\/:*?"<>|]/g, '_')}.wav`] = Codecs.encodeWav(chs.map(c => c.subarray(a, b)), sr, v.cd ? 'pcm16' : 'pcm24'); }
      const zip = Codecs.zip(files); Aero.busy();
      const p = await Aero.saveFile({ name: base + ' (CD).zip', data: zip, filters: [{ name: 'ZIP archive', extensions: ['zip'] }] });
      if (p) Aero.toast(`Exported ${tracks.length} CD track${tracks.length === 1 ? '' : 's'} (CUE + WAV${v.split ? ' + split files' : ''})`);
      return { files, tracks };
    } catch (e) { Aero.busy(); Aero.alert('Export CD Tracks', e.message); }
  }

  return { deadAirDialog, removeDeadAir, learnNoise, generate, generateDialog, place, trackList, buildCue, exportCdDialog, exportCd, msf };
})();
