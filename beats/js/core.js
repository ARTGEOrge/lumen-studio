'use strict';
/* Lumen Beats — core document model (pure JS, no DOM / Web Audio: also loaded by the Node tests).
   Time is measured in ticks, PPQ = 96 per quarter note. A step (1/16 note) is 24 ticks.
   Velocities are MIDI integers 1..127. Volumes are in dB (-60 = silence). Pan is -1..1. */
(function (root) {
  const PPQ = 96, STEP = 24;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const dbToGain = db => db <= -60 ? 0 : Math.pow(10, db / 20);
  const gainToDb = g => g <= 0.001 ? -60 : clamp(20 * Math.log10(g), -60, 24);
  const fmtDb = db => db <= -60 ? '−∞ dB' : (db > 0 ? '+' : '') + db.toFixed(1) + ' dB';
  const fmtPan = p => Math.abs(p) < 0.005 ? 'C' : (p < 0 ? 'L' : 'R') + Math.round(Math.abs(p) * 100);
  const fmtHz = f => f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 1 : 2) + ' kHz' : Math.round(f) + ' Hz';
  const fmtMs = s => s < 1 ? Math.round(s * 1000) + ' ms' : s.toFixed(2) + ' s';
  const fmtPct = v => Math.round(v * 100) + '%';

  /* deterministic PRNG (noise buffers, reverb impulses → reproducible renders) */
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  /* ---------------- music theory ---------------- */
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = p => NOTE_NAMES[((p % 12) + 12) % 12] + (Math.floor(p / 12) - 1);
  const SCALES = {
    chromatic: { name: 'Chromatic', iv: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
    major: { name: 'Major', iv: [0, 2, 4, 5, 7, 9, 11] },
    minor: { name: 'Natural minor', iv: [0, 2, 3, 5, 7, 8, 10] },
    harmonic: { name: 'Harmonic minor', iv: [0, 2, 3, 5, 7, 8, 11] },
    dorian: { name: 'Dorian', iv: [0, 2, 3, 5, 7, 9, 10] },
    phrygian: { name: 'Phrygian', iv: [0, 1, 3, 5, 7, 8, 10] },
    lydian: { name: 'Lydian', iv: [0, 2, 4, 6, 7, 9, 11] },
    mixolydian: { name: 'Mixolydian', iv: [0, 2, 4, 5, 7, 9, 10] },
    pentMajor: { name: 'Pentatonic major', iv: [0, 2, 4, 7, 9] },
    pentMinor: { name: 'Pentatonic minor', iv: [0, 3, 5, 7, 10] },
    blues: { name: 'Blues', iv: [0, 3, 5, 6, 7, 10] }
  };
  const inScale = (p, key, scale) => { const s = SCALES[scale] || SCALES.chromatic; return s.iv.includes((((p - key) % 12) + 12) % 12); };
  const snapToScale = (p, key, scale) => { if (inScale(p, key, scale)) return p; for (let d = 1; d < 12; d++) { if (inScale(p - d, key, scale)) return p - d; if (inScale(p + d, key, scale)) return p + d; } return p; };

  /* ---------------- parameter specs ----------------
     {k, label, min, max, def, curve:'lin'|'log', unit fmt, opts:[[val,label]] (select), bool, step, auto:false} */
  const WAVES = [['sine', 'Sine'], ['triangle', 'Triangle'], ['sawtooth', 'Saw'], ['square', 'Square']];
  const fmtSemi = v => (v > 0 ? '+' : '') + Math.round(v) + ' st';
  const fmtCent = v => (v > 0 ? '+' : '') + Math.round(v) + ' ct';
  const fmtRatio = v => v.toFixed(2) + '×';
  const ENV = (pre, A, D, S, R, grp) => [
    { k: pre + 'A', label: 'Attack', min: 0.001, max: 4, def: A, curve: 'log', fmt: fmtMs, grp },
    { k: pre + 'D', label: 'Decay', min: 0.005, max: 6, def: D, curve: 'log', fmt: fmtMs, grp },
    { k: pre + 'S', label: 'Sustain', min: 0, max: 1, def: S, fmt: fmtPct, grp },
    { k: pre + 'R', label: 'Release', min: 0.005, max: 8, def: R, curve: 'log', fmt: fmtMs, grp }];
  const INST = {
    sub: { name: 'Lumen Sub (subtractive synth)', short: 'Sub synth', params: [
      { k: 'o1w', label: 'Osc 1 wave', opts: WAVES, def: 'sawtooth', grp: 'Oscillator 1' },
      { k: 'o1o', label: 'Octave', min: -3, max: 3, step: 1, def: 0, fmt: v => (v > 0 ? '+' : '') + v, grp: 'Oscillator 1' },
      { k: 'o1s', label: 'Semitones', min: -12, max: 12, step: 1, def: 0, fmt: fmtSemi, grp: 'Oscillator 1' },
      { k: 'o1d', label: 'Fine', min: -50, max: 50, def: 0, fmt: fmtCent, grp: 'Oscillator 1' },
      { k: 'o1l', label: 'Level', min: 0, max: 1, def: 0.8, fmt: fmtPct, grp: 'Oscillator 1' },
      { k: 'o2w', label: 'Osc 2 wave', opts: WAVES, def: 'square', grp: 'Oscillator 2' },
      { k: 'o2o', label: 'Octave', min: -3, max: 3, step: 1, def: 0, fmt: v => (v > 0 ? '+' : '') + v, grp: 'Oscillator 2' },
      { k: 'o2s', label: 'Semitones', min: -12, max: 12, step: 1, def: 0, fmt: fmtSemi, grp: 'Oscillator 2' },
      { k: 'o2d', label: 'Fine', min: -50, max: 50, def: 7, fmt: fmtCent, grp: 'Oscillator 2' },
      { k: 'o2l', label: 'Level', min: 0, max: 1, def: 0.5, fmt: fmtPct, grp: 'Oscillator 2' },
      { k: 'noise', label: 'Noise', min: 0, max: 1, def: 0, fmt: fmtPct, grp: 'Oscillator 2' },
      { k: 'ft', label: 'Filter type', opts: [['lowpass', 'Low-pass'], ['highpass', 'High-pass'], ['bandpass', 'Band-pass']], def: 'lowpass', grp: 'Filter' },
      { k: 'cut', label: 'Cutoff', min: 30, max: 18000, def: 2200, curve: 'log', fmt: fmtHz, grp: 'Filter' },
      { k: 'res', label: 'Resonance', min: 0.3, max: 20, def: 2, curve: 'log', fmt: v => 'Q ' + v.toFixed(1), grp: 'Filter' },
      { k: 'fenv', label: 'Env amount', min: -1, max: 1, def: 0.4, fmt: v => (v * 6).toFixed(1) + ' oct', grp: 'Filter' },
      { k: 'fkey', label: 'Key tracking', min: 0, max: 1, def: 0.3, fmt: fmtPct, grp: 'Filter' },
      ...ENV('f', 0.005, 0.35, 0.2, 0.3, 'Filter envelope'),
      ...ENV('a', 0.004, 0.3, 0.7, 0.25, 'Amp envelope'),
      { k: 'lw', label: 'LFO wave', opts: WAVES, def: 'sine', grp: 'LFO' },
      { k: 'lr', label: 'Rate', min: 0.05, max: 20, def: 4, curve: 'log', fmt: v => v.toFixed(2) + ' Hz', grp: 'LFO' },
      { k: 'la', label: 'Amount', min: 0, max: 1, def: 0, fmt: fmtPct, grp: 'LFO' },
      { k: 'ld', label: 'Destination', opts: [['pitch', 'Pitch (vibrato)'], ['cutoff', 'Filter cutoff'], ['amp', 'Volume (tremolo)'], ['pan', 'Pan']], def: 'cutoff', grp: 'LFO' },
      { k: 'glide', label: 'Glide', min: 0, max: 0.5, def: 0, fmt: fmtMs, grp: 'Output' },
      { k: 'vs', label: 'Velocity', min: 0, max: 1, def: 0.6, fmt: fmtPct, grp: 'Output' },
      { k: 'gain', label: 'Level', min: 0, max: 1, def: 0.6, fmt: fmtPct, grp: 'Output' }] },
    fm: { name: 'Lumen FM (2-operator FM synth)', short: 'FM synth', params: [
      { k: 'alg', label: 'Algorithm', opts: [['stack', 'Stack: M2 → M1 → C'], ['par', 'Parallel: M1 + M2 → C']], def: 'stack', grp: 'Operators' },
      { k: 'cr', label: 'Carrier ratio', min: 0.5, max: 8, def: 1, step: 0.5, fmt: fmtRatio, grp: 'Operators' },
      { k: 'm1r', label: 'Mod 1 ratio', min: 0.25, max: 16, def: 2, step: 0.25, fmt: fmtRatio, grp: 'Modulator 1' },
      { k: 'm1i', label: 'Mod 1 index', min: 0, max: 12, def: 3, fmt: v => v.toFixed(2), grp: 'Modulator 1' },
      { k: 'm1d', label: 'Mod 1 decay', min: 0.01, max: 6, def: 0.5, curve: 'log', fmt: fmtMs, grp: 'Modulator 1' },
      { k: 'm1s', label: 'Mod 1 sustain', min: 0, max: 1, def: 0.25, fmt: fmtPct, grp: 'Modulator 1' },
      { k: 'm2r', label: 'Mod 2 ratio', min: 0.25, max: 16, def: 7, step: 0.25, fmt: fmtRatio, grp: 'Modulator 2' },
      { k: 'm2i', label: 'Mod 2 index', min: 0, max: 12, def: 0, fmt: v => v.toFixed(2), grp: 'Modulator 2' },
      { k: 'm2d', label: 'Mod 2 decay', min: 0.01, max: 6, def: 0.2, curve: 'log', fmt: fmtMs, grp: 'Modulator 2' },
      { k: 'vi', label: 'Velocity → index', min: 0, max: 1, def: 0.5, fmt: fmtPct, grp: 'Modulator 2' },
      ...ENV('a', 0.002, 0.8, 0.4, 0.4, 'Amp envelope'),
      { k: 'vs', label: 'Velocity', min: 0, max: 1, def: 0.6, fmt: fmtPct, grp: 'Output' },
      { k: 'gain', label: 'Level', min: 0, max: 1, def: 0.55, fmt: fmtPct, grp: 'Output' }] },
    drum: { name: 'Lumen Drum (synthesized drum voice)', short: 'Drum', params: [
      { k: 'kind', label: 'Voice', opts: [['kick', 'Kick'], ['snare', 'Snare'], ['clap', 'Clap'], ['hat', 'Closed hat'], ['ohat', 'Open hat'], ['tom', 'Tom'], ['rim', 'Rimshot'], ['cow', 'Cowbell'], ['crash', 'Crash']], def: 'kick', grp: 'Voice', auto: false },
      { k: 'tune', label: 'Tune', min: -12, max: 12, def: 0, fmt: fmtSemi, grp: 'Voice' },
      { k: 'decay', label: 'Decay', min: 0.2, max: 3, def: 1, curve: 'log', fmt: fmtRatio, grp: 'Voice' },
      { k: 'tone', label: 'Tone', min: 0, max: 1, def: 0.5, fmt: fmtPct, grp: 'Voice' },
      { k: 'snap', label: 'Snap / click', min: 0, max: 1, def: 0.5, fmt: fmtPct, grp: 'Voice' },
      { k: 'drive', label: 'Drive', min: 0, max: 1, def: 0, fmt: fmtPct, grp: 'Voice' },
      { k: 'choke', label: 'Choke group', opts: [[0, 'None'], [1, '1'], [2, '2'], [3, '3'], [4, '4']], def: 0, grp: 'Output', auto: false },
      { k: 'vs', label: 'Velocity', min: 0, max: 1, def: 0.7, fmt: fmtPct, grp: 'Output' },
      { k: 'gain', label: 'Level', min: 0, max: 1, def: 0.8, fmt: fmtPct, grp: 'Output' }] },
    sampler: { name: 'Lumen Sampler', short: 'Sampler', params: [
      { k: 'root', label: 'Root note', min: 0, max: 127, step: 1, def: 60, fmt: noteName, grp: 'Sample' },
      { k: 'tune', label: 'Fine tune', min: -100, max: 100, def: 0, fmt: fmtCent, grp: 'Sample' },
      { k: 'start', label: 'Start', min: 0, max: 0.99, def: 0, fmt: fmtPct, grp: 'Sample' },
      { k: 'track', label: 'Key tracking', bool: true, def: true, grp: 'Sample', auto: false },
      { k: 'oneshot', label: 'One-shot (ignore note length)', bool: true, def: false, grp: 'Sample', auto: false },
      { k: 'loop', label: 'Loop', bool: true, def: false, grp: 'Sample', auto: false },
      { k: 'rev', label: 'Reverse', bool: true, def: false, grp: 'Sample', auto: false },
      { k: 'cut', label: 'Low-pass', min: 60, max: 20000, def: 20000, curve: 'log', fmt: fmtHz, grp: 'Sample' },
      ...ENV('a', 0.001, 0.2, 1, 0.08, 'Amp envelope'),
      { k: 'vs', label: 'Velocity', min: 0, max: 1, def: 0.6, fmt: fmtPct, grp: 'Output' },
      { k: 'gain', label: 'Level', min: 0, max: 1, def: 0.8, fmt: fmtPct, grp: 'Output' }] }
  };
  const DELAY_TIMES = [[0.25, '1/16'], [0.5, '1/8'], [0.75, '3/16 (dotted 1/8)'], [1, '1/4'], [1.5, '3/8 (dotted 1/4)'], [2, '1/2'], [1 / 3, '1/8 triplet'], [2 / 3, '1/4 triplet']];
  const FX = {
    eq: { name: 'Parametric EQ', color: '#3a8fe0', params: [
      { k: 'lg', label: 'Low gain', min: -18, max: 18, def: 0, fmt: fmtDb },
      { k: 'lf', label: 'Low freq', min: 30, max: 600, def: 120, curve: 'log', fmt: fmtHz },
      { k: 'mg', label: 'Mid gain', min: -18, max: 18, def: 0, fmt: fmtDb },
      { k: 'mf', label: 'Mid freq', min: 150, max: 9000, def: 1200, curve: 'log', fmt: fmtHz },
      { k: 'mq', label: 'Mid Q', min: 0.2, max: 10, def: 1, curve: 'log', fmt: v => v.toFixed(2) },
      { k: 'hg', label: 'High gain', min: -18, max: 18, def: 0, fmt: fmtDb },
      { k: 'hf', label: 'High freq', min: 1500, max: 18000, def: 7000, curve: 'log', fmt: fmtHz }] },
    comp: { name: 'Compressor', color: '#e3a21a', params: [
      { k: 'th', label: 'Threshold', min: -60, max: 0, def: -18, fmt: fmtDb },
      { k: 'ra', label: 'Ratio', min: 1, max: 20, def: 4, curve: 'log', fmt: v => v.toFixed(1) + ':1' },
      { k: 'kn', label: 'Knee', min: 0, max: 30, def: 6, fmt: fmtDb },
      { k: 'at', label: 'Attack', min: 0.0005, max: 0.5, def: 0.008, curve: 'log', fmt: fmtMs },
      { k: 're', label: 'Release', min: 0.02, max: 1.5, def: 0.15, curve: 'log', fmt: fmtMs },
      { k: 'mk', label: 'Make-up gain', min: 0, max: 24, def: 3, fmt: fmtDb }] },
    filter: { name: 'Filter', color: '#2a9f8f', params: [
      { k: 'type', label: 'Type', opts: [['lowpass', 'Low-pass'], ['highpass', 'High-pass'], ['bandpass', 'Band-pass']], def: 'lowpass', auto: false },
      { k: 'f', label: 'Cutoff', min: 30, max: 20000, def: 20000, curve: 'log', fmt: fmtHz },
      { k: 'q', label: 'Resonance', min: 0.3, max: 18, def: 0.9, curve: 'log', fmt: v => 'Q ' + v.toFixed(1) }] },
    delay: { name: 'Tempo Delay', color: '#4cb82c', params: [
      { k: 'time', label: 'Time (beats)', opts: DELAY_TIMES, def: 0.75, auto: false },
      { k: 'fb', label: 'Feedback', min: 0, max: 0.92, def: 0.4, fmt: fmtPct },
      { k: 'tone', label: 'Tone', min: 400, max: 18000, def: 5000, curve: 'log', fmt: fmtHz },
      { k: 'pp', label: 'Ping-pong', bool: true, def: true, auto: false },
      { k: 'mix', label: 'Wet', min: 0, max: 1, def: 0.3, fmt: fmtPct }] },
    reverb: { name: 'Reverb', color: '#8a5ad0', params: [
      { k: 'size', label: 'Decay', min: 0.3, max: 8, def: 2.2, curve: 'log', fmt: v => v.toFixed(2) + ' s', auto: false },
      { k: 'damp', label: 'Damping', min: 1000, max: 18000, def: 6000, curve: 'log', fmt: fmtHz, auto: false },
      { k: 'pre', label: 'Pre-delay', min: 0, max: 0.2, def: 0.015, fmt: fmtMs },
      { k: 'mix', label: 'Wet', min: 0, max: 1, def: 0.3, fmt: fmtPct }] },
    dist: { name: 'Distortion', color: '#e0402c', params: [
      { k: 'mode', label: 'Mode', opts: [['soft', 'Soft clip (tanh)'], ['hard', 'Hard clip'], ['fold', 'Wavefolder'], ['bit', 'Bit crush']], def: 'soft', auto: false },
      { k: 'drive', label: 'Drive', min: 0, max: 36, def: 12, fmt: fmtDb },
      { k: 'tone', label: 'Tone', min: 500, max: 20000, def: 9000, curve: 'log', fmt: fmtHz },
      { k: 'out', label: 'Output', min: -24, max: 6, def: -6, fmt: fmtDb },
      { k: 'mix', label: 'Wet', min: 0, max: 1, def: 1, fmt: fmtPct }] },
    chorus: { name: 'Chorus', color: '#d05aa8', params: [
      { k: 'rate', label: 'Rate', min: 0.05, max: 6, def: 0.8, curve: 'log', fmt: v => v.toFixed(2) + ' Hz' },
      { k: 'depth', label: 'Depth', min: 0, max: 1, def: 0.5, fmt: fmtPct },
      { k: 'dly', label: 'Delay', min: 0.004, max: 0.03, def: 0.012, fmt: fmtMs },
      { k: 'mix', label: 'Wet', min: 0, max: 1, def: 0.5, fmt: fmtPct }] }
  };
  const VOL = { k: 'vol', label: 'Volume', min: -60, max: 6, def: 0, fmt: fmtDb };
  const PAN = { k: 'pan', label: 'Pan', min: -1, max: 1, def: 0, fmt: fmtPan };
  const SEND = { k: 'send', label: 'Send', min: -60, max: 6, def: -60, fmt: fmtDb };

  const specDefaults = specs => Object.fromEntries(specs.map(s => [s.k, s.def]));
  function cleanValue(s, v) {
    if (s.opts) { const ok = s.opts.find(o => String(o[0]) === String(v)); return ok ? ok[0] : s.def; }
    if (s.bool) return typeof v === 'boolean' ? v : s.def;
    v = Number(v); if (!Number.isFinite(v)) return s.def;
    v = clamp(v, s.min, s.max); if (s.step === 1) v = Math.round(v); return v;
  }
  const cleanParams = (specs, p) => Object.fromEntries(specs.map(s => [s.k, cleanValue(s, p ? p[s.k] : undefined)]));
  const norm = (s, v) => s.curve === 'log' ? Math.log(v / s.min) / Math.log(s.max / s.min) : (v - s.min) / (s.max - s.min);
  const denorm = (s, n) => { n = clamp(n, 0, 1); const v = s.curve === 'log' ? s.min * Math.pow(s.max / s.min, n) : s.min + n * (s.max - s.min); return s.step ? Math.round(v / s.step) * s.step : v; };

  /* ---------------- document ---------------- */
  const COLORS = ['#e8693a', '#e3a21a', '#5cb82c', '#2aa38f', '#3a8fe0', '#6a5ad0', '#c04ab0', '#d0405a', '#8a9aa8'];
  function newChannel(type, o = {}) {
    const spec = INST[type] || INST.sub;
    return { id: o.id || uid(), name: o.name || spec.short, type: INST[type] ? type : 'sub', color: o.color || COLORS[0], vol: o.vol ?? 0, pan: o.pan ?? 0, mute: false, solo: false,
      out: o.out || null, sample: o.sample || null, params: cleanParams(spec.params, o.params || {}) };
  }
  function newFx(type, p) { return { id: uid(), type, on: true, p: cleanParams(FX[type].params, p || {}) }; }
  function newInsert(name, o = {}) { return { id: o.id || uid(), name, color: o.color || '#8a9aa8', vol: o.vol ?? 0, pan: o.pan ?? 0, mute: false, solo: false, sends: o.sends || [], fx: o.fx || [] }; }
  function newPattern(name, o = {}) { return { id: o.id || uid(), name: name || 'Pattern 1', color: o.color || COLORS[4], bars: o.bars || 1, notes: o.notes || {} }; }
  function newProject() {
    const ins = [newInsert('Insert 1'), newInsert('Insert 2'), newInsert('Insert 3'), newInsert('Insert 4')];
    const pat = newPattern('Pattern 1');
    const kick = newChannel('drum', { name: 'Kick', color: COLORS[0], out: ins[0].id, params: { kind: 'kick' } });
    const snare = newChannel('drum', { name: 'Snare', color: COLORS[1], out: ins[1].id, params: { kind: 'snare' } });
    const hat = newChannel('drum', { name: 'Hi-hat', color: COLORS[2], out: ins[2].id, params: { kind: 'hat', choke: 1 } });
    const synth = newChannel('sub', { name: 'Sub synth', color: COLORS[4], out: ins[3].id });
    return { app: 'lumen-beats', version: 1, name: 'Untitled', bpm: 120, sigNum: 4, sigDen: 4, swing: 0, key: 0, scale: 'minor',
      channels: [kick, snare, hat, synth], patterns: [pat],
      playlist: { tracks: [1, 2, 3, 4, 5, 6].map(i => ({ id: uid(), name: 'Track ' + i, mute: false })), clips: [], loop: null },
      automation: [], mixer: { inserts: ins, master: { vol: 0, fx: [] } }, samples: {} };
  }
  const barTicks = prj => Math.round(prj.sigNum * PPQ * 4 / prj.sigDen);
  const beatTicks = prj => Math.round(PPQ * 4 / prj.sigDen);
  const patLen = (prj, pat) => Math.max(1, pat.bars) * barTicks(prj);
  function songEnd(prj) {
    let end = 0; for (const c of prj.playlist.clips) end = Math.max(end, c.start + c.len);
    for (const a of prj.automation) for (const p of a.points) end = Math.max(end, p.t);
    const b = barTicks(prj); return Math.max(b, Math.ceil(end / b) * b);
  }
  const ticksPerSec = prj => prj.bpm * PPQ / 60;
  const findCh = (prj, id) => prj.channels.find(c => c.id === id);
  const findPat = (prj, id) => prj.patterns.find(p => p.id === id);
  const findIns = (prj, id) => prj.mixer.inserts.find(i => i.id === id);

  /* Sanitize an untrusted document (from a file). Everything is coerced to known shapes; unknown keys dropped. */
  function sanitize(o) {
    if (!o || typeof o !== 'object' || o.app !== 'lumen-beats') throw new Error('Not a Lumen Beats project');
    const str = (s, d, n = 80) => typeof s === 'string' ? s.slice(0, n) : d;
    const num = (v, a, b, d) => { v = Number(v); return Number.isFinite(v) ? clamp(v, a, b) : d; };
    const id = s => typeof s === 'string' && /^[\w-]{1,40}$/.test(s) ? s : uid();
    const col = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : COLORS[8];
    const prj = { app: 'lumen-beats', version: 1, name: str(o.name, 'Untitled'), bpm: num(o.bpm, 20, 400, 120), sigNum: Math.round(num(o.sigNum, 1, 16, 4)),
      sigDen: [2, 4, 8, 16].includes(+o.sigDen) ? +o.sigDen : 4, swing: num(o.swing, 0, 1, 0), key: Math.round(num(o.key, 0, 11, 0)), scale: SCALES[o.scale] ? o.scale : 'chromatic',
      channels: [], patterns: [], playlist: { tracks: [], clips: [], loop: null }, automation: [], mixer: { inserts: [], master: { vol: 0, fx: [] } }, samples: {} };
    const fxList = a => (Array.isArray(a) ? a : []).slice(0, 16).filter(f => f && FX[f.type]).map(f => ({ id: id(f.id), type: f.type, on: f.on !== false, p: cleanParams(FX[f.type].params, f.p) }));
    const m = o.mixer || {};
    prj.mixer.master = { vol: num(m.master?.vol, -60, 6, 0), fx: fxList(m.master?.fx) };
    (Array.isArray(m.inserts) ? m.inserts : []).slice(0, 64).forEach(i => prj.mixer.inserts.push({ id: id(i?.id), name: str(i?.name, 'Insert'), color: col(i?.color), vol: num(i?.vol, -60, 6, 0), pan: num(i?.pan, -1, 1, 0),
      mute: !!i?.mute, solo: !!i?.solo, sends: (Array.isArray(i?.sends) ? i.sends : []).slice(0, 16).map(s => ({ to: id(s?.to), amt: num(s?.amt, -60, 6, -60) })), fx: fxList(i?.fx) }));
    const insIds = new Set(prj.mixer.inserts.map(i => i.id));
    prj.mixer.inserts.forEach(i => { i.sends = i.sends.filter(s => insIds.has(s.to) && s.to !== i.id); });
    const samples = o.samples && typeof o.samples === 'object' ? o.samples : {};
    for (const [k, s] of Object.entries(samples).slice(0, 128)) if (/^[\w-]{1,40}$/.test(k) && s && typeof s.b64 === 'string') prj.samples[k] = { name: str(s.name, 'sample', 120), b64: s.b64 };
    (Array.isArray(o.channels) ? o.channels : []).slice(0, 128).forEach(c => {
      if (!c || !INST[c.type]) return;
      prj.channels.push({ id: id(c.id), name: str(c.name, INST[c.type].short), type: c.type, color: col(c.color), vol: num(c.vol, -60, 6, 0), pan: num(c.pan, -1, 1, 0), mute: !!c.mute, solo: !!c.solo,
        out: insIds.has(c.out) ? c.out : null, sample: typeof c.sample === 'string' && prj.samples[c.sample] ? c.sample : null, params: cleanParams(INST[c.type].params, c.params) });
    });
    const chIds = new Set(prj.channels.map(c => c.id));
    (Array.isArray(o.patterns) ? o.patterns : []).slice(0, 999).forEach(p => {
      if (!p) return; const notes = {};
      for (const [k, arr] of Object.entries(p.notes && typeof p.notes === 'object' ? p.notes : {})) {
        if (!chIds.has(k) || !Array.isArray(arr)) continue;
        notes[k] = arr.slice(0, 20000).filter(n => n && Number.isFinite(+n.t)).map(n => ({ t: Math.round(num(n.t, 0, 1e7, 0)), d: Math.round(num(n.d, 1, 1e6, STEP)), p: Math.round(num(n.p, 0, 127, 60)), v: Math.round(num(n.v, 1, 127, 100)) }));
      }
      prj.patterns.push({ id: id(p.id), name: str(p.name, 'Pattern'), color: col(p.color), bars: Math.round(num(p.bars, 1, 256, 1)), notes });
    });
    if (!prj.patterns.length) prj.patterns.push(newPattern('Pattern 1'));
    const patIds = new Set(prj.patterns.map(p => p.id));
    const pl = o.playlist || {};
    (Array.isArray(pl.tracks) ? pl.tracks : []).slice(0, 199).forEach(t => prj.playlist.tracks.push({ id: id(t?.id), name: str(t?.name, 'Track'), mute: !!t?.mute }));
    while (prj.playlist.tracks.length < 4) prj.playlist.tracks.push({ id: uid(), name: 'Track ' + (prj.playlist.tracks.length + 1), mute: false });
    const trIds = new Set(prj.playlist.tracks.map(t => t.id));
    (Array.isArray(pl.clips) ? pl.clips : []).slice(0, 20000).forEach(c => { if (c && patIds.has(c.pat) && trIds.has(c.track)) prj.playlist.clips.push({ id: id(c.id), pat: c.pat, track: c.track, start: Math.round(num(c.start, 0, 1e7, 0)), len: Math.round(num(c.len, 1, 1e7, PPQ * 4)), off: Math.round(num(c.off, 0, 1e7, 0)) }); });
    if (pl.loop && Number.isFinite(+pl.loop.a) && Number.isFinite(+pl.loop.b) && +pl.loop.b > +pl.loop.a) prj.playlist.loop = { a: Math.round(num(pl.loop.a, 0, 1e7, 0)), b: Math.round(num(pl.loop.b, 1, 1e7, 1)) };
    (Array.isArray(o.automation) ? o.automation : []).slice(0, 256).forEach(a => {
      if (!a || typeof a.target !== 'string' || !targetSpec(prj, a.target)) return;
      const pts = (Array.isArray(a.points) ? a.points : []).slice(0, 10000).filter(p => p && Number.isFinite(+p.t)).map(p => ({ t: Math.round(num(p.t, 0, 1e7, 0)), v: num(p.v, 0, 1, 0.5) })).sort((x, y) => x.t - y.t);
      prj.automation.push({ id: id(a.id), target: a.target, on: a.on !== false, points: pts });
    });
    return prj;
  }

  /* ---------------- events ---------------- */
  // Notes that sound in tick range [from, to). Pattern mode: one pattern, loop handled by the transport.
  // Song mode: every clip of the playlist (pattern repeats inside the clip, notes cut at clip end).
  // Returns [{ch, t, d, p, v}] with t = song tick (swing applied, may be fractional).
  function collectEvents(prj, mode, from, to, patId) {
    const out = [], soloOn = prj.channels.some(c => c.solo);
    const live = new Map(prj.channels.filter(c => !c.mute && (!soloOn || c.solo)).map(c => [c.id, c]));
    const swing = prj.swing * STEP * 2 / 3;
    const sw = nt => (swing && (nt % (STEP * 2)) === STEP) ? swing : 0;
    const emitPat = (pat, base, lo, hi, cut, L) => {
      for (const chId in pat.notes) {
        if (!live.has(chId)) continue;
        for (const n of pat.notes[chId]) {
          if (n.t >= L) continue;
          const t = base + n.t; if (t < lo || t >= hi) continue;
          out.push({ ch: chId, t: t + sw(n.t), d: Math.max(1, Math.min(n.d, cut - t)), p: n.p, v: n.v });
        }
      }
    };
    if (mode === 'pattern') {
      const pat = findPat(prj, patId); if (!pat) return out;
      emitPat(pat, 0, from, to, Infinity, patLen(prj, pat));
    } else {
      const muted = new Set(prj.playlist.tracks.filter(t => t.mute).map(t => t.id));
      for (const c of prj.playlist.clips) {
        if (muted.has(c.track)) continue;
        const end = c.start + c.len; if (end <= from || c.start >= to) continue;
        const pat = findPat(prj, c.pat); if (!pat) continue;
        const L = patLen(prj, pat), off = c.off || 0, org = c.start - off;   // clip may start inside the pattern (sliced clips)
        const lo = Math.max(from, c.start), hi = Math.min(to, end);
        for (let k = Math.floor((lo - org) / L); org + k * L < hi; k++) emitPat(pat, org + k * L, lo, hi, end, L);
      }
    }
    out.sort((a, b) => a.t - b.t);
    return out;
  }

  /* ---------------- automation ---------------- */
  // targets: "ins:<id>:vol|pan", "ins:<id>:send:<to>", "master:vol", "fx:<ins|master>:<fxId>:<k>", "ch:<id>:vol|pan", "ch:<id>:p:<k>"
  function targetSpec(prj, tgt) {
    const a = String(tgt).split(':');
    if (a[0] === 'master' && a[1] === 'vol') return { spec: VOL, label: 'Master · Volume', live: true };
    if (a[0] === 'ins') { const i = findIns(prj, a[1]); if (!i) return null;
      if (a[2] === 'vol') return { spec: VOL, label: i.name + ' · Volume', live: true };
      if (a[2] === 'pan') return { spec: PAN, label: i.name + ' · Pan', live: true };
      if (a[2] === 'send') { const to = findIns(prj, a[3]); return to ? { spec: SEND, label: i.name + ' · Send → ' + to.name, live: true } : null; }
      return null; }
    if (a[0] === 'fx') { const strip = a[1] === 'master' ? prj.mixer.master : findIns(prj, a[1]); const fx = strip?.fx.find(f => f.id === a[2]); if (!fx) return null;
      const s = FX[fx.type].params.find(p => p.k === a[3]); return s && s.auto !== false && !s.opts && !s.bool ? { spec: s, label: (a[1] === 'master' ? 'Master' : strip.name) + ' · ' + FX[fx.type].name + ' · ' + s.label, live: true } : null; }
    if (a[0] === 'ch') { const c = findCh(prj, a[1]); if (!c) return null;
      if (a[2] === 'vol') return { spec: VOL, label: c.name + ' · Volume', live: true };
      if (a[2] === 'pan') return { spec: PAN, label: c.name + ' · Pan', live: true };
      if (a[2] === 'p') { const s = INST[c.type].params.find(p => p.k === a[3]); return s && s.auto !== false && !s.opts && !s.bool ? { spec: s, label: c.name + ' · ' + s.label + ' (per note)', live: false } : null; }
    }
    return null;
  }
  function automationTargets(prj) {
    const t = ['master:vol'];
    prj.mixer.inserts.forEach(i => { t.push(`ins:${i.id}:vol`, `ins:${i.id}:pan`); i.sends.forEach(s => t.push(`ins:${i.id}:send:${s.to}`)); });
    [['master', prj.mixer.master], ...prj.mixer.inserts.map(i => [i.id, i])].forEach(([k, s]) => s.fx.forEach(f => FX[f.type].params.forEach(p => t.push(`fx:${k}:${f.id}:${p.k}`))));
    prj.channels.forEach(c => { t.push(`ch:${c.id}:vol`, `ch:${c.id}:pan`); INST[c.type].params.forEach(p => t.push(`ch:${c.id}:p:${p.k}`)); });
    return t.map(id => ({ id, ...targetSpec(prj, id) })).filter(x => x.spec);
  }
  // normalized value (0..1) of a lane at tick (linear between points, held before first / after last)
  function laneAt(lane, t) {
    const p = lane.points; if (!p.length) return null;
    if (t <= p[0].t) return p[0].v; if (t >= p[p.length - 1].t) return p[p.length - 1].v;
    let lo = 0, hi = p.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m].t <= t) lo = m; else hi = m; }
    const a = p[lo], b = p[hi]; return b.t === a.t ? b.v : a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
  }
  // read / write a target's current static value in the document
  function getTarget(prj, tgt) {
    const a = tgt.split(':');
    if (a[0] === 'master') return prj.mixer.master.vol;
    if (a[0] === 'ins') { const i = findIns(prj, a[1]); if (a[2] === 'send') return i.sends.find(s => s.to === a[3])?.amt ?? -60; return i[a[2]]; }
    if (a[0] === 'fx') { const s = a[1] === 'master' ? prj.mixer.master : findIns(prj, a[1]); return s.fx.find(f => f.id === a[2]).p[a[3]]; }
    if (a[0] === 'ch') { const c = findCh(prj, a[1]); return a[2] === 'p' ? c.params[a[3]] : c[a[2]]; }
  }

  /* ---------------- editing helpers ---------------- */
  function quantize(notes, grid, strength = 1, ends = false) {
    return notes.map(n => {
      const q = Math.round(n.t / grid) * grid, t = Math.max(0, Math.round(n.t + (q - n.t) * strength));
      let d = n.d; if (ends) { const e = n.t + n.d, qe = Math.round(e / grid) * grid, ne = Math.round(e + (qe - e) * strength); d = Math.max(Math.round(grid / 2), ne - t); }
      return { ...n, t, d: Math.max(1, d) };
    });
  }
  const sortNotes = arr => arr.sort((a, b) => a.t - b.t || a.p - b.p);

  /* ---------------- transport (pure look-ahead scheduler core) ----------------
     The engine pumps it from a timer; it emits windows [a, b) of song ticks with the audio-clock time of tick a,
     so every event lands at an exact sample regardless of timer jitter. Loops wrap seamlessly. */
  class Transport {
    constructor() { this.playing = false; this.anchors = []; }
    start(time, tick, tps, loopA, loopB) { this.playing = true; this.tps = tps; this.loopA = loopA; this.loopB = loopB; this.cTick = tick; this.cTime = time; this.anchors = [{ time, tick, tps }]; }
    stop() { this.playing = false; }
    setLoop(a, b) { this.loopA = a; this.loopB = b; if (this.cTick >= b) this.cTick = b; }
    setTempo(now, tps) {   // keep already-scheduled time, change spacing from the cursor on
      if (!this.playing) { this.tps = tps; return; }
      this.anchors.push({ time: this.cTime, tick: this.cTick, tps }); this.tps = tps;
    }
    // emit(a, b, timeOfA, tps) for all ticks up to now + lookahead
    pump(now, lookahead, emit) {
      if (!this.playing) return;
      const horizon = now + lookahead; let guard = 0;
      while (this.cTime < horizon && guard++ < 64) {
        let b = this.cTick + (horizon - this.cTime) * this.tps;
        const wrap = b >= this.loopB;
        if (wrap) b = this.loopB;
        if (b > this.cTick) emit(this.cTick, b, this.cTime, this.tps);
        this.cTime += (b - this.cTick) / this.tps; this.cTick = b;
        if (wrap) { this.cTick = this.loopA; this.anchors.push({ time: this.cTime, tick: this.loopA, tps: this.tps, wrap: true }); }
      }
      while (this.anchors.length > 2 && this.anchors[1].time <= now - 1) this.anchors.shift();
    }
    tickAt(now) {   // song position at audio time `now` (for the playhead)
      let a = this.anchors[0]; for (const x of this.anchors) if (x.time <= now) a = x;
      if (!a) return 0; return a.tick + (now - a.time) * (a.tps || this.tps);
    }
  }

  /* ---------------- misc ---------------- */
  function b64encode(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64'); }
  function b64decode(b) { const s = typeof atob === 'function' ? atob(b) : Buffer.from(b, 'base64').toString('binary'); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
  const fmtPos = (prj, t) => { const bt = barTicks(prj), qt = beatTicks(prj); t = Math.max(0, Math.floor(t)); return `${Math.floor(t / bt) + 1}:${Math.floor((t % bt) / qt) + 1}:${String(t % qt).padStart(2, '0')}`; };

  const Core = { PPQ, STEP, uid, clamp, rng, dbToGain, gainToDb, fmtDb, fmtPan, fmtHz, fmtMs, fmtPct, NOTE_NAMES, noteName, SCALES, inScale, snapToScale,
    INST, FX, VOL, PAN, SEND, DELAY_TIMES, COLORS, specDefaults, cleanParams, cleanValue, norm, denorm,
    newChannel, newFx, newInsert, newPattern, newProject, barTicks, beatTicks, patLen, songEnd, ticksPerSec, findCh, findPat, findIns, sanitize,
    collectEvents, targetSpec, automationTargets, laneAt, getTarget, quantize, sortNotes, Transport, b64encode, b64decode, fmtPos };
  root.Core = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof window !== 'undefined' ? window : globalThis);
