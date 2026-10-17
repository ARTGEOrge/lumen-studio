'use strict';
/* Lumen Cut — project model, time helpers and edit primitives. Everything here is pure data manipulation
   (no DOM) so the same functions drive the UI, the export renderer and the tests. */
const LC = window.LC = window.LC || {};

LC.FORMAT_VERSION = 3;
LC.SEQ_FIELDS = ['tracks', 'clips', 'transitions', 'markers', 'inPoint', 'outPoint'];
LC.MAX_NEST = 8;
LC.PRESETS = [
  { id: '1080p', name: 'HD 1080p  16:9', w: 1920, h: 1080 },
  { id: '4k', name: '4K UHD  16:9', w: 3840, h: 2160 },
  { id: '720p', name: 'HD 720p  16:9', w: 1280, h: 720 },
  { id: 'vertical', name: 'Vertical  9:16  (1080×1920)', w: 1080, h: 1920 },
  { id: 'square', name: 'Square  1:1  (1080×1080)', w: 1080, h: 1080 },
  { id: 'portrait', name: 'Portrait  4:5  (1080×1350)', w: 1080, h: 1350 }
];
LC.FPS = [24, 25, 30, 60];
LC.TRANSITIONS = [
  { id: 'dissolve', name: 'Cross Dissolve' },
  { id: 'dipblack', name: 'Dip to Black' },
  { id: 'dipwhite', name: 'Dip to White' },
  { id: 'wipe', name: 'Wipe' },
  { id: 'slide', name: 'Slide' },
  { id: 'push', name: 'Push' },
  { id: 'iris', name: 'Iris Round' },
  { id: 'clock', name: 'Clock Wipe' },
  { id: 'barndoor', name: 'Barn Door' },
  { id: 'wipedown', name: 'Wipe Down' },
  { id: 'zoom', name: 'Cross Zoom' }
];
LC.ATRANSITIONS = [
  { id: 'cpower', name: 'Constant Power' },
  { id: 'cgain', name: 'Constant Gain' }
];
LC.trName = type => (LC.TRANSITIONS.find(t => t.id === type) || LC.ATRANSITIONS.find(t => t.id === type) || { name: 'Transition' }).name;
LC.isAudioTrType = type => LC.ATRANSITIONS.some(t => t.id === type);
LC.BLEND_MODES = [['normal', 'Normal'], ['darken', 'Darken'], ['multiply', 'Multiply'], ['colorburn', 'Color Burn'], ['lighten', 'Lighten'], ['screen', 'Screen'],
  ['colordodge', 'Color Dodge'], ['add', 'Linear Dodge (Add)'], ['overlay', 'Overlay'], ['softlight', 'Soft Light'], ['hardlight', 'Hard Light'], ['difference', 'Difference'],
  ['exclusion', 'Exclusion'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']];
LC.TITLE_ANIMS = [['none', 'None'], ['fade', 'Fade'], ['slide', 'Slide up'], ['typewriter', 'Typewriter'], ['zoom', 'Zoom']];
LC.FONTS = ['Segoe UI', 'Arial', 'Arial Black', 'Georgia', 'Impact', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Tahoma', 'Consolas', 'Courier New', 'Palatino Linotype', 'Franklin Gothic Medium', 'Segoe Script'];
LC.TITLE_PRESETS = {
  center: { x: .5, y: .5, align: 'center' }, lower: { x: .07, y: .8, align: 'left' }, top: { x: .5, y: .12, align: 'center' },
  bottom: { x: .5, y: .88, align: 'center' }, upperleft: { x: .06, y: .1, align: 'left' }, upperright: { x: .94, y: .1, align: 'right' }
};
LC.COLOR_KEYS = ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'brightness', 'temperature', 'tint', 'saturation', 'vibrance', 'vignette'];
LC.KF_KEYS = ['pos', 'scale', 'rot', 'opacity', 'volume', 'crop', 'speed', 'blur', ...LC.COLOR_KEYS, 'wS', 'wM', 'wH', 'curveAmt'];
LC.EASES = [['linear', 'Linear'], ['hold', 'Hold'], ['easein', 'Ease In'], ['easeout', 'Ease Out'], ['ease', 'Ease In and Out'], ['bezier', 'Bezier…']];

/* ---------- time ---------- */
LC.fps = () => LC.project ? LC.project.settings.fps : 30;
LC.fr = (t, fps = LC.fps()) => Math.round(t * fps) / fps;                       // snap to frame boundary
LC.frames = (t, fps = LC.fps()) => Math.round(t * fps);
LC.tc = (t, fps = LC.fps()) => {                                                // non-drop-frame timecode HH:MM:SS:FF
  const neg = t < 0; let f = Math.round(Math.abs(t) * fps);
  const ff = f % fps; f = (f - ff) / fps; const s = f % 60; f = (f - s) / 60; const m = f % 60; const h = (f - m) / 60;
  const p = n => String(n).padStart(2, '0');
  return (neg ? '-' : '') + `${p(h)}:${p(m)}:${p(s)}:${p(ff)}`;
};
LC.parseTC = (str, fps = LC.fps()) => {                                         // accepts "HH:MM:SS:FF", "SS:FF", "12.5" (seconds)
  str = String(str).trim();
  if (/^-?\d+(\.\d+)?s?$/.test(str)) return parseFloat(str);
  const parts = str.split(/[:;.]/).map(Number); if (parts.some(Number.isNaN)) return null;
  while (parts.length < 4) parts.unshift(0);
  const [h, m, s, f] = parts; return h * 3600 + m * 60 + s + f / fps;
};
LC.fmtDur = s => { if (!isFinite(s)) return '–'; const m = Math.floor(s / 60), r = Math.floor(s % 60); return `${m}:${String(r).padStart(2, '0')}`; };
LC.dbToGain = db => db <= -60 ? 0 : Math.pow(10, db / 20);

/* ---------- defaults ---------- */
LC.defaultProps = () => ({ pos: [.5, .5], scale: 100, rot: 0, opacity: 100, crop: [0, 0, 0, 0], speed: 1, volume: 0, fadeIn: 0, fadeOut: 0,
  exposure: 0, brightness: 0, contrast: 0, saturation: 100, temperature: 0, blur: 0,
  tint: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, vibrance: 0, vignette: 0, blend: 'normal',
  wS: [0, 0, 0], wM: [0, 0, 0], wH: [0, 0, 0], curveAmt: 100 });
LC.defaultKey = () => ({ on: false, color: '#00b140', tol: 28, soft: 18, spill: 60, feather: 0, choke: 0 });
LC.defaultCurves = () => ({ rgb: [[0, 0], [1, 1]], r: [[0, 0], [1, 1]], g: [[0, 0], [1, 1]], b: [[0, 0], [1, 1]] });
LC.defaultAfx = () => ({ eq: { on: false, low: 0, mid: 0, midF: 1000, high: 0 }, comp: { on: false, thr: -24, ratio: 4, att: 10, rel: 250, gain: 0 },
  gate: { on: false, thr: -45, att: 2, rel: 120 }, verb: { on: false, mix: 25, size: 1.6 } });
LC.defaultTitle = (o = {}) => Object.assign({ text: 'Your Title', font: 'Segoe UI', size: 110, bold: true, italic: false, color: '#ffffff', align: 'center',
  stroke: false, strokeColor: '#000000', strokeWidth: 6, shadow: true, shadowColor: '#000000', shadowBlur: 18, shadowDist: 5,
  box: false, boxColor: '#000000', boxOpacity: 55, boxPad: 28, preset: 'center', x: .5, y: .5, animIn: 'fade', animOut: 'fade', animDur: .6 }, o);

function makeTrack(kind, n) { return { id: 't' + Aero.uid(), kind, name: (kind === 'video' ? 'V' : 'A') + n, mute: false, solo: false, lock: false, h: kind === 'video' ? 46 : 38, vol: 0, pan: 0, kf: {} }; }
LC.makeTrack = makeTrack;

LC.newSeqData = (name = 'Sequence 1') => ({ id: 's' + Aero.uid(), name, tracks: [makeTrack('video', 1), makeTrack('video', 2), makeTrack('video', 3), makeTrack('audio', 1), makeTrack('audio', 2), makeTrack('audio', 3)],
  clips: [], transitions: [], markers: [], inPoint: null, outPoint: null });
LC.newProject = (presetId = '1080p', fps = 30) => {
  const pr = LC.PRESETS.find(p => p.id === presetId) || LC.PRESETS[0], s = LC.newSeqData('Sequence 1');
  const p = { app: 'lumen-cut', version: LC.FORMAT_VERSION, name: 'Untitled', settings: { w: pr.w, h: pr.h, fps, preset: pr.id, bg: '#000000' },
    media: [], luts: [], master: 0, sequences: [s], seqId: s.id };
  LC.SEQ_FIELDS.forEach(k => p[k] = s[k]);
  return p;
};

/* ---------- sequences: the active one lives at the top level of LC.project (all edit code works on it);
   the others live in LC.project.sequences. withSeq() temporarily makes another sequence active (synchronously). ---------- */
LC.seqEntry = id => LC.project.sequences.find(s => s.id === id) || null;
LC.activeSeq = () => LC.seqEntry(LC.project.seqId);
LC.syncSeq = () => { const P = LC.project, s = LC.activeSeq(); if (s) LC.SEQ_FIELDS.forEach(k => s[k] = P[k]); };
LC.withSeq = (id, fn) => {
  const P = LC.project; if (id === P.seqId) return fn();
  const s = LC.seqEntry(id); if (!s || !s.tracks) return undefined;
  const saved = {}, sid = P.seqId; LC.SEQ_FIELDS.forEach(k => { saved[k] = P[k]; P[k] = s[k]; }); P.seqId = id;
  try { return fn(); } finally { LC.SEQ_FIELDS.forEach(k => { s[k] = P[k]; P[k] = saved[k]; }); P.seqId = sid; }
};
LC.seqClips = id => id === LC.project.seqId ? LC.project.clips : (LC.seqEntry(id)?.clips || []);
// does sequence a (transitively) contain sequence b?  (a contains itself)
LC.seqContains = (a, b, seen = new Set()) => { if (a === b) return true; if (seen.has(a)) return false; seen.add(a); return LC.seqClips(a).some(c => c.type === 'nest' && LC.seqContains(c.seq, b, seen)); };
LC.canNest = (childId, parentId = LC.project.seqId) => !!LC.seqEntry(childId) && !LC.seqContains(childId, parentId);
LC.seqDur = id => LC.withSeq(id, () => LC.seqDuration()) || 0;
LC.seqHasAudio = id => !!LC.withSeq(id, () => LC.project.clips.some(c => LC.track(c.track)?.kind === 'audio'));
LC.seqName = id => LC.seqEntry(id)?.name || 'Missing sequence';
LC.clipKind = c => c.type === 'nest' ? (LC.track(c.track)?.kind === 'audio' ? 'naudio' : 'nvideo') : c.type;

LC.makeClip = (o) => {
  const c = Object.assign({ id: 'c' + Aero.uid(), track: null, type: 'video', media: null, start: 0, in: 0, dur: 5, link: null, name: '', props: LC.defaultProps(), kf: {} }, o);
  if (c.type === 'title' && !c.title) c.title = LC.defaultTitle();
  return c;
};

/* ---------- queries ---------- */
LC.track = id => LC.project.tracks.find(t => t.id === id);
LC.clip = id => LC.project.clips.find(c => c.id === id);
LC.mediaOf = c => c && c.media ? LC.project.media.find(m => m.id === c.media) : null;
LC.clipEnd = c => c.start + c.dur;
LC.clipsOn = tid => LC.project.clips.filter(c => c.track === tid).sort((a, b) => a.start - b.start);
LC.videoTracks = () => LC.project.tracks.filter(t => t.kind === 'video');
LC.audioTracks = () => LC.project.tracks.filter(t => t.kind === 'audio');
LC.seqDuration = () => LC.project.clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0);
LC.isTimeBased = c => (c.type === 'video' || c.type === 'audio' || c.type === 'nest') && c.hold == null;
LC.isVisual = c => c.type === 'video' || c.type === 'image' || c.type === 'title' || c.type === 'adjust' || (c.type === 'nest' && LC.track(c.track)?.kind === 'video');
LC.clipName = c => c.type === 'title' ? (c.title.text.split('\n')[0] || 'Title') : c.type === 'adjust' ? (c.name || 'Adjustment Layer') : c.type === 'nest' ? LC.seqName(c.seq) : (c.name || LC.mediaOf(c)?.name || 'Clip');
/* length of the clip's source material (media file or nested sequence) */
LC.srcDur = c => c.type === 'nest' ? LC.seqDur(c.seq) : (LC.mediaOf(c)?.duration ?? null);
LC.linked = c => c.link ? LC.project.clips.filter(x => x.link === c.link && x.id !== c.id) : [];

/* ---------- keyframes: clip.kf[key] = [{t (seconds from clip start), v, e (ease type), bz?}] sorted ---------- */
const lerp = (a, b, f) => Array.isArray(a) ? a.map((x, i) => x + (b[i] - x) * f) : a + (b - a) * f;
// CSS-style cubic bezier timing function: y at x for control points (x1,y1) (x2,y2)
const bezier = (x1, y1, x2, y2, x) => {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = t => ((ax * t + bx) * t + cx) * t, dX = t => (3 * ax * t + 2 * bx) * t + cx;
  let t = x;
  for (let i = 0; i < 8; i++) { const e = X(t) - x, d = dX(t); if (Math.abs(e) < 1e-7 || Math.abs(d) < 1e-6) break; t -= e / d; }
  if (!(t >= 0 && t <= 1) || Math.abs(X(t) - x) > 1e-5) { let lo = 0, hi = 1; t = x; for (let i = 0; i < 40; i++) { if (X(t) < x) lo = t; else hi = t; t = (lo + hi) / 2; } }
  return ((ay * t + by) * t + cy) * t;
};
LC.bezier = bezier;
// easing of the segment a→b at linear fraction f. "Ease out" of a = leave a slowly; "ease in" of b = arrive at b slowly.
LC.segEase = (a, b, f) => {
  if (a.e === 'bezier' && Array.isArray(a.bz)) return bezier(a.bz[0], a.bz[1], a.bz[2], a.bz[3], f);
  const so = a.e === 'easeout' || a.e === 'ease', si = b.e === 'easein' || b.e === 'ease';
  if (!so && !si) return f;
  return bezier(so ? .42 : 0, 0, si ? .58 : 1, 1, f);
};
LC.valueAt = (c, key, tl) => {
  const k = c.kf && c.kf[key];
  if (!k || !k.length) return c.props[key];
  if (tl <= k[0].t) return k[0].v;
  const last = k[k.length - 1]; if (tl >= last.t) return last.v;
  let lo = 0, hi = k.length - 1;                     // binary search for the segment
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (k[mid].t <= tl) lo = mid; else hi = mid; }
  const a = k[lo], b = k[hi];
  if (a.e === 'hold') return a.v;
  return lerp(a.v, b.v, LC.segEase(a, b, (tl - a.t) / (b.t - a.t || 1)));
};
LC.isAnimated = (c, key) => !!(c.kf && c.kf[key] && c.kf[key].length);
LC.setKey = (c, key, tl, v) => {
  c.kf = c.kf || {}; const k = c.kf[key] = c.kf[key] || [];
  const eps = .5 / LC.fps(); const ex = k.find(x => Math.abs(x.t - tl) < eps);
  if (ex) ex.v = v; else { k.push({ t: tl, v, e: 'linear' }); k.sort((a, b) => a.t - b.t); }
};
LC.removeKey = (c, key, tl) => { const k = c.kf?.[key]; if (!k) return; const eps = .5 / LC.fps(); c.kf[key] = k.filter(x => Math.abs(x.t - tl) >= eps); if (!c.kf[key].length) delete c.kf[key]; };
LC.keyTimes = c => { const s = new Set(); Object.values(c.kf || {}).forEach(a => a.forEach(k => s.add(+k.t.toFixed(4)))); return [...s].sort((a, b) => a - b); };
LC.keysAt = (c, tl) => { const eps = .5 / LC.fps(), out = []; for (const [key, a] of Object.entries(c.kf || {})) for (const k of a) if (Math.abs(k.t - tl) < eps) out.push([key, k]); return out; };
LC.setEase = (keys, e, bz) => keys.forEach(k => { k.e = e; if (e === 'bezier') k.bz = (bz || [.42, 0, .58, 1]).slice(0, 4); else delete k.bz; });

/* ---------- source time: constant speed, speed keyframes (ramps) and frame holds ---------- */
const rampCache = new WeakMap();
// source seconds advanced between local time 0 and local time tl
LC.srcOffset = (c, tl) => {
  if (!LC.isAnimated(c, 'speed')) return tl * c.props.speed;
  const sig = JSON.stringify(c.kf.speed) + '|' + c.dur;
  let e = rampCache.get(c);
  if (!e || e.sig !== sig) {                           // cumulative integral of speed(t), trapezoid rule
    const step = Math.max(1 / 240, c.dur / 20000), n = Math.max(2, Math.ceil(c.dur / step) + 1), tab = new Float64Array(n);
    let prev = LC.valueAt(c, 'speed', 0), tp = 0;
    for (let i = 1; i < n; i++) { const t = Math.min(c.dur, i * step), v = LC.valueAt(c, 'speed', t); tab[i] = tab[i - 1] + (prev + v) / 2 * (t - tp); prev = v; tp = t; }
    e = { sig, tab, step, n }; rampCache.set(c, e);
  }
  if (tl <= 0) return tl * LC.valueAt(c, 'speed', 0);
  if (tl >= c.dur) return e.tab[e.n - 1] + (tl - c.dur) * LC.valueAt(c, 'speed', c.dur);
  const x = tl / e.step, i = Math.min(e.n - 2, Math.floor(x)), t0 = i * e.step, t1 = Math.min(c.dur, (i + 1) * e.step);
  return e.tab[i] + (e.tab[i + 1] - e.tab[i]) * ((tl - t0) / (t1 - t0 || 1));
};
LC.srcTime = (c, t) => c.hold != null ? c.hold : c.in + LC.srcOffset(c, t - c.start);
LC.speedAt = (c, tl) => c.hold != null ? 0 : LC.valueAt(c, 'speed', tl);
LC.avgSpeed = c => c.dur > 0 ? LC.srcOffset(c, c.dur) / c.dur : c.props.speed;
LC.maxDur = c => {                                                               // longest the clip may become given its in-point
  if (c.type === 'nest') return Math.max(1 / LC.fps(), LC.seqDur(c.seq) - c.in);
  const m = LC.mediaOf(c); if (!m || !LC.isTimeBased(c)) return Infinity;
  if (LC.isAnimated(c, 'speed')) return Math.max(1 / LC.fps(), c.dur + (m.duration - LC.srcTime(c, c.start + c.dur)) / Math.max(.05, LC.valueAt(c, 'speed', c.dur)));
  return Math.max(1 / LC.fps(), (m.duration - c.in) / c.props.speed);
};
LC.ramped = c => LC.isAnimated(c, 'speed');

/* audio gain envelope (linear gain) for an audio clip at local time tl */
LC.clipGain = (c, tl) => {
  let g = LC.dbToGain(LC.valueAt(c, 'volume', tl));
  const fi = c.props.fadeIn, fo = c.props.fadeOut;
  if (fi > 0 && tl < fi) g *= Math.max(0, tl / fi);
  if (fo > 0 && tl > c.dur - fo) g *= Math.max(0, (c.dur - tl) / fo);
  return g;
};
/* track volume (dB) at timeline time t, honouring track keyframes */
LC.trackVol = (tr, t) => { const k = tr.kf?.vol; if (!k || !k.length) return tr.vol || 0; return LC.valueAt({ kf: tr.kf, props: { vol: tr.vol } }, 'vol', t); };

/* ---------- edit primitives (mutate LC.project) ---------- */
LC.removeClips = ids => {
  const s = new Set(ids); const p = LC.project;
  p.clips = p.clips.filter(c => !s.has(c.id));
  p.transitions = p.transitions.filter(t => !s.has(t.a) && !s.has(t.b));
};
// Split clip at timeline time t. Returns the new right-hand clip (or null if t is not strictly inside).
LC.splitClip = (c, t) => {
  t = LC.fr(t); const eps = .5 / LC.fps();
  if (t <= c.start + eps || t >= c.start + c.dur - eps) return null;
  const right = JSON.parse(JSON.stringify(c)); right.id = 'c' + Aero.uid();
  const cut = t - c.start, rin = c.hold != null ? c.in : LC.srcTime(c, t);
  right.start = t; right.dur = c.dur - cut; right.in = rin;
  // keyframes: shift the right clip's keys; keep a key at the split point so values stay continuous
  for (const key of Object.keys(c.kf || {})) {
    const v = LC.valueAt(c, key, cut);
    right.kf[key] = c.kf[key].filter(k => k.t > cut).map(k => ({ ...k, t: k.t - cut })); right.kf[key].unshift({ t: 0, v, e: 'linear' });
    c.kf[key] = c.kf[key].filter(k => k.t < cut); c.kf[key].push({ t: cut, v, e: 'linear' });
  }
  c.dur = cut;
  if (c.props.fadeOut) { right.props.fadeOut = Math.min(c.props.fadeOut, right.dur); c.props.fadeOut = 0; }
  right.props.fadeIn = 0;
  LC.project.clips.push(right);
  // outgoing transitions move with the right half
  LC.project.transitions.forEach(tr => { if (tr.a === c.id) tr.a = right.id; });
  return right;
};
LC.trimStart = (c, newStart) => {                 // move left edge, keeping the content in place
  const d = newStart - c.start, nin = c.hold != null ? c.in : LC.srcTime(c, newStart);
  for (const key of Object.keys(c.kf || {})) c.kf[key] = c.kf[key].map(k => ({ ...k, t: k.t - d }));
  c.start = newStart; c.dur -= d; c.in = nin;
};
// Clear [a,b) on a track (overwrite edit). Clips listed in `except` are ignored.
LC.overwriteRange = (tid, a, b, except = new Set()) => {
  const eps = 1e-6;
  for (const c of LC.clipsOn(tid)) {
    if (except.has(c.id)) continue;
    const s = c.start, e = c.start + c.dur;
    if (e <= a + eps || s >= b - eps) continue;
    if (s >= a - eps && e <= b + eps) { LC.removeClips([c.id]); continue; }
    if (s < a && e > b) { LC.splitClip(c, b); c.dur = a - c.start; continue; }
    if (s < a) { c.dur = a - s; continue; }
    LC.trimStart(c, b);
  }
};
LC.rippleShift = (tid, from, delta, except = new Set()) => {
  for (const c of LC.project.clips) if (c.track === tid && !except.has(c.id) && c.start >= from - 1e-6) c.start = Math.max(0, LC.fr(c.start + delta));
  const tr = LC.track(tid);                        // track automation moves with the material
  if (tr?.kf?.vol) for (const k of tr.kf.vol) if (k.t >= from - 1e-6) k.t = Math.max(0, k.t + delta);
};
// Remove transitions that are no longer valid; clamp durations
LC.cleanTransitions = () => {
  const p = LC.project, eps = 1e-4;
  p.transitions = p.transitions.filter(tr => {
    const a = tr.a && LC.clip(tr.a), b = tr.b && LC.clip(tr.b);
    if (tr.a && !a || tr.b && !b || (!a && !b)) return false;
    const audioTr = LC.isAudioTrType(tr.type), c0 = a || b;
    if (audioTr !== (LC.track(c0.track)?.kind === 'audio')) return false;          // audio transitions only on audio clips and vice versa
    if (a && b) {
      if (a.track !== b.track || Math.abs(a.start + a.dur - b.start) > eps) return false;
      tr.track = a.track; tr.dur = Math.max(1 / p.settings.fps, Math.min(tr.dur, a.dur * 2, b.dur * 2));
    } else { const c = a || b; tr.track = c.track; tr.dur = Math.max(1 / p.settings.fps, Math.min(tr.dur, c.dur)); }
    return true;
  });
  // only one transition per edge
  const seen = new Set();
  p.transitions = p.transitions.filter(tr => { const k = (tr.a || '-') + '|' + (tr.b || '-'); const ka = tr.a ? 'out:' + tr.a : null, kb = tr.b ? 'in:' + tr.b : null;
    if (seen.has(k) || (ka && seen.has(ka)) || (kb && seen.has(kb))) return false; seen.add(k); ka && seen.add(ka); kb && seen.add(kb); return true; });
};
// Region of a transition on the timeline: {s, e, cut}
LC.trRegion = tr => {
  const a = tr.a && LC.clip(tr.a), b = tr.b && LC.clip(tr.b);
  if (a && b) { const cut = b.start; return { s: cut - tr.dur / 2, e: cut + tr.dur / 2, cut }; }
  if (b) return { s: b.start, e: b.start + tr.dur, cut: b.start };
  const end = a.start + a.dur; return { s: end - tr.dur, e: end, cut: end };
};
// Apply a transition at the edge of a clip. side: 'in' | 'out' | 'auto'
LC.addTransition = (clip, side, type = 'dissolve', dur = 1) => {
  const p = LC.project; const others = LC.clipsOn(clip.track); const eps = 1e-4;
  let a = null, b = null;
  if (side === 'out') { a = clip; b = others.find(o => Math.abs(o.start - (clip.start + clip.dur)) < eps) || null; }
  else { b = clip; a = others.find(o => Math.abs(o.start + o.dur - clip.start) < eps) || null; }
  p.transitions = p.transitions.filter(t => !((a && t.a === a.id) || (b && t.b === b.id)));
  const tr = { id: 'x' + Aero.uid(), track: clip.track, a: a ? a.id : null, b: b ? b.id : null, type, dur: LC.fr(dur) };
  p.transitions.push(tr); LC.cleanTransitions();
  return p.transitions.find(t => t.id === tr.id) || null;
};
/* audio crossfade gain for clip c at timeline time t (1 outside any audio transition) */
LC.xfadeGain = (c, t) => {
  let g = 1;
  for (const tr of LC.project.transitions) {
    if (tr.a !== c.id && tr.b !== c.id || !LC.isAudioTrType(tr.type)) continue;
    const r = LC.trRegion(tr), p = Math.min(1, Math.max(0, (t - r.s) / (r.e - r.s || 1)));
    const incoming = tr.b === c.id;
    if (incoming ? t >= r.e : t <= r.s) continue;
    if (incoming && t < r.s || !incoming && t > r.e) { g = 0; continue; }
    const x = incoming ? p : 1 - p;
    g *= tr.type === 'cpower' ? Math.sin(x * Math.PI / 2) : x;
  }
  return g;
};
/* timeline span a clip is heard/seen including transition handles */
LC.playSpan = c => {
  let s = c.start, e = c.start + c.dur;
  for (const tr of LC.project.transitions) { if (tr.a !== c.id && tr.b !== c.id) continue; const r = LC.trRegion(tr); s = Math.min(s, r.s); e = Math.max(e, r.e); }
  return [s, e];
};

/* ---------- project (de)serialisation; opened files are untrusted data ---------- */
LC.serialize = () => {           // the active sequence's data is stored once, at the top level
  const P = LC.project; return JSON.stringify({ ...P, version: LC.FORMAT_VERSION, sequences: P.sequences.map(s => s.id === P.seqId ? { id: s.id, name: s.name } : s) });
};
LC.sanitizeProject = raw => {
  const num = (v, d, lo = -1e9, hi = 1e9) => (typeof v === 'number' && isFinite(v)) ? Math.min(hi, Math.max(lo, v)) : d;
  const str = (v, d = '', n = 500) => typeof v === 'string' ? v.slice(0, n) : d;
  const bool = v => v === true;
  const id = v => typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : null;
  const color = (v, d) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d;
  const nums = (v, d, lo, hi) => Array.isArray(v) && v.length === d.length ? d.map((x, i) => num(v[i], x, lo, hi)) : d.slice();
  const pick = (v, list, d) => list.includes(v) ? v : d;
  if (!raw || typeof raw !== 'object' || raw.app !== 'lumen-cut') throw new Error('Not a Lumen Cut project');
  if (typeof raw.version === 'number' && raw.version > LC.FORMAT_VERSION) console.warn('Lumen Cut: project was saved by a newer version; unknown data is ignored');
  const s = raw.settings || {};
  const p = LC.newProject('1080p', 30);
  p.name = str(raw.name, 'Untitled', 120);
  p.settings = { w: Math.round(num(s.w, 1920, 16, 8192) / 2) * 2, h: Math.round(num(s.h, 1080, 16, 8192) / 2) * 2, fps: LC.FPS.includes(s.fps) ? s.fps : 30, preset: str(s.preset, 'custom', 20), bg: color(s.bg, '#000000') };
  p.master = num(raw.master, 0, -60, 12);
  p.luts = (Array.isArray(raw.luts) ? raw.luts : []).slice(0, 64).map(l => LC.sanitizeLut ? LC.sanitizeLut(l) : null).filter(Boolean);
  const lutIds = new Set(p.luts.map(l => l.id));
  p.media = (Array.isArray(raw.media) ? raw.media : []).filter(m => m && id(m.id)).map(m => {
    const o = { id: m.id, name: str(m.name, 'media', 260), kind: ['video', 'audio', 'image'].includes(m.kind) ? m.kind : 'video',
      duration: num(m.duration, 0, 0, 1e6), w: num(m.w, 0, 0, 1e5), h: num(m.h, 0, 0, 1e5), hasAudio: bool(m.hasAudio), size: num(m.size, 0, 0, 1e13), path: str(m.path, null, 2000) || null, type: str(m.type, '', 80), sample: str(m.sample, null, 40) };
    o.srcIn = m.srcIn == null ? null : num(m.srcIn, null, 0, 1e6); o.srcOut = m.srcOut == null ? null : num(m.srcOut, null, 0, 1e6);
    if (o.srcIn != null && o.srcOut != null && o.srcOut <= o.srcIn) o.srcOut = null;
    if (Array.isArray(m.scenes)) o.scenes = m.scenes.slice(0, 5000).map(x => num(x, null, 0, 1e6)).filter(x => x != null).sort((a, b) => a - b);
    return o;
  });
  const keyList = (arr, def, lo, hi) => (Array.isArray(arr) ? arr : []).slice(0, 2000).map(x => {
    const k = { t: num(x?.t, 0, -1e5, 1e6), v: Array.isArray(def) ? nums(x?.v, def, lo, hi) : num(x?.v, def, lo, hi), e: pick(x?.e, LC.EASES.map(e => e[0]), 'linear') };
    if (x?.ease === true && !x.e) { k.e = 'bezier'; k.bz = [.42, 0, .58, 1]; }      // v1 files: boolean smooth ease
    if (k.e === 'bezier') k.bz = nums(x?.bz || k.bz, [.42, 0, .58, 1], -2, 3).map((q, i) => i % 2 === 0 ? Math.min(1, Math.max(0, q)) : q);
    return k;
  }).sort((a, b) => a.t - b.t);
  const mids = new Set(p.media.map(m => m.id));
  const def = LC.defaultProps(), blends = LC.BLEND_MODES.map(b => b[0]);
  const curve = v => (Array.isArray(v) && v.length >= 2 ? v.slice(0, 16) : [[0, 0], [1, 1]]).map(q => [num(q?.[0], 0, 0, 1), num(q?.[1], 0, 0, 1)]).sort((a, b) => a[0] - b[0]).filter((q, i, a) => i === 0 || q[0] - a[i - 1][0] > 1e-3);
  // raw sequence list: v3 files have `sequences` (the active one's data may live at the top level); v1/v2 have one implicit sequence
  let rawSeqs = Array.isArray(raw.sequences) && raw.sequences.length ? raw.sequences.slice(0, 200).filter(s => s && id(s.id)).map(s => s.tracks ? s : (s.id === raw.seqId ? { ...raw, id: s.id, name: s.name } : null)).filter(Boolean) : [];
  if (!rawSeqs.length) rawSeqs = [{ ...raw, id: 's1', name: str(raw.name, 'Sequence 1', 120) || 'Sequence 1' }];
  const seqIds = new Set(rawSeqs.map(s => s.id));
  const sanSeq = rs => {
    const s = { id: rs.id, name: str(rs.name, 'Sequence', 120) || 'Sequence', tracks: LC.newProject().tracks };
    const tracks = (Array.isArray(rs.tracks) ? rs.tracks : []).filter(t => t && id(t.id) && ['video', 'audio'].includes(t.kind)).map(t => ({ id: t.id, kind: t.kind, name: str(t.name, '', 20), mute: bool(t.mute), solo: bool(t.solo), lock: bool(t.lock), h: num(t.h, 56, 30, 200),
      vol: num(t.vol, 0, -60, 12), pan: num(t.pan, 0, -100, 100), kf: t.kind === 'audio' && Array.isArray(t.kf?.vol) && t.kf.vol.length ? { vol: keyList(t.kf.vol, 0, -60, 12) } : {} }));
    if (tracks.some(t => t.kind === 'video') && tracks.some(t => t.kind === 'audio')) s.tracks = tracks;
    const tids = new Set(s.tracks.map(t => t.id)), tkind = new Map(s.tracks.map(t => [t.id, t.kind]));
    s.clips = (Array.isArray(rs.clips) ? rs.clips : []).filter(c => c && id(c.id) && tids.has(c.track)).map(c => {
      const pr = c.props || {}, props = {};
      for (const k of Object.keys(def)) {
        if (k === 'pos') props.pos = nums(pr.pos, [.5, .5], -10, 10);
        else if (k === 'crop') props.crop = nums(pr.crop, [0, 0, 0, 0], 0, 100);
        else if (k === 'blend') props.blend = pick(pr.blend, blends, 'normal');
        else if (Array.isArray(def[k])) props[k] = nums(pr[k], def[k], -1, 1);
        else props[k] = num(pr[k], def[k], -1e4, 1e4);
      }
      props.speed = num(pr.speed, 1, .1, 10); props.curveAmt = num(pr.curveAmt, 100, 0, 100);
      const kf = {};
      const range = k => k === 'pos' ? [[.5, .5], -10, 10] : k === 'crop' ? [[0, 0, 0, 0], 0, 100] : k === 'speed' ? [1, .1, 10] : Array.isArray(def[k]) ? [def[k], -1, 1] : k === 'curveAmt' ? [100, 0, 100] : [def[k], -1e4, 1e4];
      for (const k of LC.KF_KEYS) if (Array.isArray(c.kf?.[k]) && c.kf[k].length) kf[k] = keyList(c.kf[k], ...range(k));
      const type = ['video', 'audio', 'image', 'title', 'adjust', 'nest'].includes(c.type) ? c.type : 'video';
      const out = { id: c.id, track: c.track, type, media: ['title', 'adjust', 'nest'].includes(type) ? null : (mids.has(c.media) ? c.media : null), start: num(c.start, 0, 0, 1e6), in: num(c.in, 0, 0, 1e6), dur: num(c.dur, 1, 1e-3, 1e6),
        link: id(c.link), name: str(c.name, '', 260), props, kf, disabled: bool(c.disabled) };
      const audioTrack = tkind.get(c.track) === 'audio';
      if (type === 'nest') { out.seq = seqIds.has(c.seq) && c.seq !== rs.id ? c.seq : null; props.speed = 1; delete kf.speed; }
      if (type === 'video' && c.hold != null) out.hold = num(c.hold, 0, 0, 1e6);
      if (type === 'title') {
        const t = c.title || {}, d = LC.defaultTitle();
        out.title = {}; for (const k of Object.keys(d)) out.title[k] = typeof d[k] === 'number' ? num(t[k], d[k], -1e4, 1e4) : typeof d[k] === 'boolean' ? (t[k] === undefined ? d[k] : bool(t[k])) : (/color/i.test(k) ? color(t[k], d[k]) : str(t[k], d[k], k === 'text' ? 4000 : 60));
      }
      const visual = type !== 'audio' && !(type === 'nest' && audioTrack);
      if (c.key && typeof c.key === 'object' && visual) { const d = LC.defaultKey(), k = c.key; out.key = { on: bool(k.on), color: color(k.color, d.color), tol: num(k.tol, d.tol, 0, 100), soft: num(k.soft, d.soft, 0, 100), spill: num(k.spill, d.spill, 0, 100), feather: num(k.feather, d.feather, 0, 50), choke: num(k.choke, d.choke, 0, 100) }; }
      if (c.curves && typeof c.curves === 'object' && visual) out.curves = { rgb: curve(c.curves.rgb), r: curve(c.curves.r), g: curve(c.curves.g), b: curve(c.curves.b) };
      if (c.lut && typeof c.lut === 'object' && lutIds.has(c.lut.id) && visual) out.lut = { id: c.lut.id, amt: num(c.lut.amt, 100, 0, 100) };
      if (c.afx && typeof c.afx === 'object' && !visual) {
        const d = LC.defaultAfx(), a = c.afx, sec = (o, dd, spec) => { const r = { on: bool(o?.on) }; for (const [k, lo, hi] of spec) r[k] = num(o?.[k], dd[k], lo, hi); return r; };
        out.afx = { eq: sec(a.eq, d.eq, [['low', -24, 24], ['mid', -24, 24], ['midF', 80, 12000], ['high', -24, 24]]), comp: sec(a.comp, d.comp, [['thr', -60, 0], ['ratio', 1, 20], ['att', 0, 1000], ['rel', 10, 1000], ['gain', 0, 24]]),
          gate: sec(a.gate, d.gate, [['thr', -90, 0], ['att', .1, 200], ['rel', 5, 2000]]), verb: sec(a.verb, d.verb, [['mix', 0, 100], ['size', .2, 6]]) };
      }
      return out;
    }).filter(c => c.type === 'title' || c.type === 'adjust' || (c.type === 'nest' ? c.seq : c.media));
    const cids = new Set(s.clips.map(c => c.id)), trTypes = [...LC.TRANSITIONS, ...LC.ATRANSITIONS].map(x => x.id);
    s.transitions = (Array.isArray(rs.transitions) ? rs.transitions : []).filter(t => t && id(t.id)).map(t => ({ id: t.id, track: id(t.track), a: cids.has(t.a) ? t.a : null, b: cids.has(t.b) ? t.b : null,
      type: trTypes.includes(t.type) ? t.type : 'dissolve', dur: num(t.dur, 1, .01, 60) }));
    s.markers = (Array.isArray(rs.markers) ? rs.markers : []).filter(m => m && id(m.id)).map(m => ({ id: m.id, t: num(m.t, 0, 0, 1e6), name: str(m.name, '', 200), color: color(m.color, '#3fae4a') }));
    s.inPoint = rs.inPoint == null ? null : num(rs.inPoint, null, 0, 1e6);
    s.outPoint = rs.outPoint == null ? null : num(rs.outPoint, null, 0, 1e6);
    return s;
  };
  const seqs = rawSeqs.map(sanSeq);
  // cycle guard: drop nest clips whose sequence (transitively) contains their own sequence
  const byId = new Map(seqs.map(s => [s.id, s]));
  // accept nest edges one by one (active sequence first) and drop only an edge that would close a cycle
  const edges = new Map(seqs.map(s => [s.id, []]));
  const reaches = (a, b, seen = new Set()) => { if (a === b) return true; if (seen.has(a)) return false; seen.add(a); return edges.get(a).some(x => reaches(x, b, seen)); };
  // depth-first from the active sequence, so its hierarchy is kept and only back-edges are dropped
  const visited = new Set();
  const visit = s => { if (!s || visited.has(s.id)) return; visited.add(s.id); s.clips = s.clips.filter(c => { if (c.type !== 'nest') return true; if (reaches(c.seq, s.id)) return false; edges.get(s.id).push(c.seq); visit(byId.get(c.seq)); return true; }); };
  visit(byId.get(raw.seqId) || seqs[0]); seqs.forEach(visit);
  p.sequences = seqs;
  const active = byId.get(raw.seqId) || seqs[0];
  p.seqId = active.id;
  const saved = LC.project; LC.project = p;           // transitions need the clip list for validation
  try { for (const s of seqs) { LC.SEQ_FIELDS.forEach(k => p[k] = s[k]); p.seqId = s.id; LC.cleanTransitions(); s.transitions = p.transitions; } }
  finally { LC.project = saved; }
  LC.SEQ_FIELDS.forEach(k => p[k] = active[k]); p.seqId = active.id;
  return p;
};
