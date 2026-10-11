'use strict';
/* Lumen Cut — project model, time helpers and edit primitives. Everything here is pure data manipulation
   (no DOM) so the same functions drive the UI, the export renderer and the tests. */
const LC = window.LC = window.LC || {};

LC.PRESETS = [
  { id: '1080p', name: 'HD 1080p  16:9', w: 1920, h: 1080 },
  { id: '4k', name: '4K UHD  16:9', w: 3840, h: 2160 },
  { id: '720p', name: 'HD 720p  16:9', w: 1280, h: 720 },
  { id: 'vertical', name: 'Vertical  9:16  (1080×1920)', w: 1080, h: 1920 },
  { id: 'square', name: 'Square  1:1  (1080×1080)', w: 1080, h: 1080 }
];
LC.FPS = [24, 25, 30, 60];
LC.TRANSITIONS = [
  { id: 'dissolve', name: 'Cross Dissolve' },
  { id: 'dipblack', name: 'Dip to Black' },
  { id: 'dipwhite', name: 'Dip to White' },
  { id: 'wipe', name: 'Wipe' },
  { id: 'slide', name: 'Slide' },
  { id: 'push', name: 'Push' }
];
LC.TITLE_ANIMS = [['none', 'None'], ['fade', 'Fade'], ['slide', 'Slide up'], ['typewriter', 'Typewriter'], ['zoom', 'Zoom']];
LC.FONTS = ['Segoe UI', 'Arial', 'Arial Black', 'Georgia', 'Impact', 'Times New Roman', 'Trebuchet MS', 'Verdana', 'Tahoma', 'Consolas', 'Courier New', 'Palatino Linotype', 'Franklin Gothic Medium', 'Segoe Script'];
LC.TITLE_PRESETS = {
  center: { x: .5, y: .5, align: 'center' }, lower: { x: .07, y: .8, align: 'left' }, top: { x: .5, y: .12, align: 'center' },
  bottom: { x: .5, y: .88, align: 'center' }, upperleft: { x: .06, y: .1, align: 'left' }, upperright: { x: .94, y: .1, align: 'right' }
};
LC.KF_KEYS = ['pos', 'scale', 'rot', 'opacity', 'volume'];

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
  exposure: 0, brightness: 0, contrast: 0, saturation: 100, temperature: 0, blur: 0 });
LC.defaultTitle = (o = {}) => Object.assign({ text: 'Your Title', font: 'Segoe UI', size: 110, bold: true, italic: false, color: '#ffffff', align: 'center',
  stroke: false, strokeColor: '#000000', strokeWidth: 6, shadow: true, shadowColor: '#000000', shadowBlur: 18, shadowDist: 5,
  box: false, boxColor: '#000000', boxOpacity: 55, boxPad: 28, preset: 'center', x: .5, y: .5, animIn: 'fade', animOut: 'fade', animDur: .6 }, o);

function makeTrack(kind, n) { return { id: 't' + Aero.uid(), kind, name: (kind === 'video' ? 'V' : 'A') + n, mute: false, solo: false, lock: false, h: kind === 'video' ? 46 : 38 }; }
LC.makeTrack = makeTrack;

LC.newProject = (presetId = '1080p', fps = 30) => {
  const pr = LC.PRESETS.find(p => p.id === presetId) || LC.PRESETS[0];
  return { app: 'lumen-cut', version: 1, name: 'Untitled', settings: { w: pr.w, h: pr.h, fps, preset: pr.id, bg: '#000000' },
    media: [], tracks: [makeTrack('video', 1), makeTrack('video', 2), makeTrack('video', 3), makeTrack('audio', 1), makeTrack('audio', 2), makeTrack('audio', 3)],
    clips: [], transitions: [], markers: [], inPoint: null, outPoint: null, master: 0 };
};

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
LC.isTimeBased = c => c.type === 'video' || c.type === 'audio';
LC.maxDur = c => {                                                               // longest the clip may become given its in-point
  const m = LC.mediaOf(c); if (!m || !LC.isTimeBased(c)) return Infinity;
  return Math.max(1 / LC.fps(), (m.duration - c.in) / c.props.speed);
};
LC.srcTime = (c, t) => c.in + (t - c.start) * c.props.speed;
LC.linked = c => c.link ? LC.project.clips.filter(x => x.link === c.link && x.id !== c.id) : [];
LC.clipName = c => c.type === 'title' ? (c.title.text.split('\n')[0] || 'Title') : (c.name || LC.mediaOf(c)?.name || 'Clip');

/* keyframes: clip.kf[key] = [{t (seconds from clip start), v}] sorted */
const lerp = (a, b, f) => Array.isArray(a) ? a.map((x, i) => x + (b[i] - x) * f) : a + (b - a) * f;
LC.valueAt = (c, key, tl) => {
  const k = c.kf && c.kf[key];
  if (!k || !k.length) return c.props[key];
  if (tl <= k[0].t) return k[0].v;
  const last = k[k.length - 1]; if (tl >= last.t) return last.v;
  for (let i = 0; i < k.length - 1; i++) {
    const a = k[i], b = k[i + 1];
    if (tl >= a.t && tl <= b.t) { let f = (tl - a.t) / (b.t - a.t || 1); if (a.ease) f = f * f * (3 - 2 * f); return lerp(a.v, b.v, f); }
  }
  return last.v;
};
LC.isAnimated = (c, key) => !!(c.kf && c.kf[key] && c.kf[key].length);
LC.setKey = (c, key, tl, v) => {
  c.kf = c.kf || {}; const k = c.kf[key] = c.kf[key] || [];
  const eps = .5 / LC.fps(); const ex = k.find(x => Math.abs(x.t - tl) < eps);
  if (ex) ex.v = v; else { k.push({ t: tl, v }); k.sort((a, b) => a.t - b.t); }
};
LC.removeKey = (c, key, tl) => { const k = c.kf?.[key]; if (!k) return; const eps = .5 / LC.fps(); c.kf[key] = k.filter(x => Math.abs(x.t - tl) >= eps); if (!c.kf[key].length) delete c.kf[key]; };
LC.keyTimes = c => { const s = new Set(); Object.values(c.kf || {}).forEach(a => a.forEach(k => s.add(+k.t.toFixed(4)))); return [...s].sort((a, b) => a - b); };

/* audio gain envelope (linear gain) for an audio clip at local time tl */
LC.clipGain = (c, tl) => {
  let g = LC.dbToGain(LC.valueAt(c, 'volume', tl));
  const fi = c.props.fadeIn, fo = c.props.fadeOut;
  if (fi > 0 && tl < fi) g *= Math.max(0, tl / fi);
  if (fo > 0 && tl > c.dur - fo) g *= Math.max(0, (c.dur - tl) / fo);
  return g;
};

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
  const cut = t - c.start;
  right.start = t; right.dur = c.dur - cut; right.in = c.in + cut * c.props.speed;
  c.dur = cut;
  // keyframes: shift the right clip's keys; keep a key at the split point so values stay continuous
  for (const key of Object.keys(c.kf || {})) {
    const v = LC.valueAt(c, key, cut);
    right.kf[key] = c.kf[key].filter(k => k.t > cut).map(k => ({ ...k, t: k.t - cut })); right.kf[key].unshift({ t: 0, v });
    c.kf[key] = c.kf[key].filter(k => k.t < cut); c.kf[key].push({ t: cut, v });
  }
  if (c.props.fadeOut) { right.props.fadeOut = Math.min(c.props.fadeOut, right.dur); c.props.fadeOut = 0; }
  right.props.fadeIn = 0;
  LC.project.clips.push(right);
  // outgoing transitions move with the right half
  LC.project.transitions.forEach(tr => { if (tr.a === c.id) tr.a = right.id; });
  return right;
};
LC.trimStart = (c, newStart) => {                 // move left edge, keeping the content in place
  const d = newStart - c.start; c.start = newStart; c.dur -= d; c.in += d * c.props.speed;
  for (const key of Object.keys(c.kf || {})) c.kf[key] = c.kf[key].map(k => ({ ...k, t: k.t - d }));
};
// Clear [a,b) on a track (overwrite edit). Clips listed in `except` are ignored.
LC.overwriteRange = (tid, a, b, except = new Set()) => {
  const eps = 1e-6;
  for (const c of LC.clipsOn(tid)) {
    if (except.has(c.id)) continue;
    const s = c.start, e = c.start + c.dur;
    if (e <= a + eps || s >= b - eps) continue;
    if (s >= a - eps && e <= b + eps) { LC.removeClips([c.id]); continue; }
    if (s < a && e > b) { const r = LC.splitClip(c, b); c.dur = a - c.start; if (r) { /* r keeps b..e */ } continue; }
    if (s < a) { c.dur = a - s; continue; }
    LC.trimStart(c, b);
  }
};
LC.rippleShift = (tid, from, delta, except = new Set()) => {
  for (const c of LC.project.clips) if (c.track === tid && !except.has(c.id) && c.start >= from - 1e-6) c.start = Math.max(0, LC.fr(c.start + delta));
};
// Remove transitions that are no longer valid; clamp durations
LC.cleanTransitions = () => {
  const p = LC.project, eps = 1e-4;
  p.transitions = p.transitions.filter(tr => {
    const a = tr.a && LC.clip(tr.a), b = tr.b && LC.clip(tr.b);
    if (tr.a && !a || tr.b && !b || (!a && !b)) return false;
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

/* ---------- project (de)serialisation; opened files are untrusted data ---------- */
LC.serialize = () => JSON.stringify(LC.project);
LC.sanitizeProject = raw => {
  const num = (v, d, lo = -1e9, hi = 1e9) => (typeof v === 'number' && isFinite(v)) ? Math.min(hi, Math.max(lo, v)) : d;
  const str = (v, d = '', n = 500) => typeof v === 'string' ? v.slice(0, n) : d;
  const bool = v => v === true;
  const id = v => typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : null;
  const color = (v, d) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : d;
  if (!raw || typeof raw !== 'object' || raw.app !== 'lumen-cut') throw new Error('Not a Lumen Cut project');
  const s = raw.settings || {};
  const p = LC.newProject('1080p', 30);
  p.name = str(raw.name, 'Untitled', 120);
  p.settings = { w: Math.round(num(s.w, 1920, 16, 8192) / 2) * 2, h: Math.round(num(s.h, 1080, 16, 8192) / 2) * 2, fps: LC.FPS.includes(s.fps) ? s.fps : 30, preset: str(s.preset, 'custom', 20), bg: color(s.bg, '#000000') };
  p.master = num(raw.master, 0, -60, 12);
  p.media = (Array.isArray(raw.media) ? raw.media : []).filter(m => m && id(m.id)).map(m => ({ id: m.id, name: str(m.name, 'media', 260), kind: ['video', 'audio', 'image'].includes(m.kind) ? m.kind : 'video',
    duration: num(m.duration, 0, 0, 1e6), w: num(m.w, 0, 0, 1e5), h: num(m.h, 0, 0, 1e5), hasAudio: bool(m.hasAudio), size: num(m.size, 0, 0, 1e13), path: str(m.path, null, 2000) || null, type: str(m.type, '', 80), sample: str(m.sample, null, 40) }));
  const tracks = (Array.isArray(raw.tracks) ? raw.tracks : []).filter(t => t && id(t.id) && ['video', 'audio'].includes(t.kind)).map(t => ({ id: t.id, kind: t.kind, name: str(t.name, '', 20), mute: bool(t.mute), solo: bool(t.solo), lock: bool(t.lock), h: num(t.h, 56, 30, 200) }));
  if (tracks.some(t => t.kind === 'video') && tracks.some(t => t.kind === 'audio')) p.tracks = tracks;
  const tids = new Set(p.tracks.map(t => t.id)), mids = new Set(p.media.map(m => m.id));
  const def = LC.defaultProps();
  p.clips = (Array.isArray(raw.clips) ? raw.clips : []).filter(c => c && id(c.id) && tids.has(c.track)).map(c => {
    const pr = c.props || {}, props = {};
    for (const k of Object.keys(def)) {
      if (k === 'pos') props.pos = Array.isArray(pr.pos) ? [num(pr.pos[0], .5, -10, 10), num(pr.pos[1], .5, -10, 10)] : [.5, .5];
      else if (k === 'crop') props.crop = Array.isArray(pr.crop) ? [0, 1, 2, 3].map(i => num(pr.crop[i], 0, 0, 100)) : [0, 0, 0, 0];
      else props[k] = num(pr[k], def[k], -1e4, 1e4);
    }
    props.speed = num(pr.speed, 1, .25, 4);
    const kf = {};
    for (const k of LC.KF_KEYS) if (Array.isArray(c.kf?.[k])) kf[k] = c.kf[k].slice(0, 2000).map(x => ({ t: num(x?.t, 0, -1e5, 1e6), v: k === 'pos' ? (Array.isArray(x?.v) ? [num(x.v[0], .5, -10, 10), num(x.v[1], .5, -10, 10)] : [.5, .5]) : num(x?.v, def[k], -1e4, 1e4), ease: bool(x?.ease) })).sort((a, b) => a.t - b.t);
    const type = ['video', 'audio', 'image', 'title'].includes(c.type) ? c.type : 'video';
    const out = { id: c.id, track: c.track, type, media: type === 'title' ? null : (mids.has(c.media) ? c.media : null), start: num(c.start, 0, 0, 1e6), in: num(c.in, 0, 0, 1e6), dur: num(c.dur, 1, 1e-3, 1e6),
      link: id(c.link), name: str(c.name, '', 260), props, kf, disabled: bool(c.disabled) };
    if (type === 'title') {
      const t = c.title || {}, d = LC.defaultTitle();
      out.title = {}; for (const k of Object.keys(d)) out.title[k] = typeof d[k] === 'number' ? num(t[k], d[k], -1e4, 1e4) : typeof d[k] === 'boolean' ? (t[k] === undefined ? d[k] : bool(t[k])) : (/color/i.test(k) ? color(t[k], d[k]) : str(t[k], d[k], k === 'text' ? 4000 : 60));
    }
    return out;
  }).filter(c => c.type === 'title' || c.media);
  const cids = new Set(p.clips.map(c => c.id));
  p.transitions = (Array.isArray(raw.transitions) ? raw.transitions : []).filter(t => t && id(t.id)).map(t => ({ id: t.id, track: id(t.track), a: cids.has(t.a) ? t.a : null, b: cids.has(t.b) ? t.b : null,
    type: LC.TRANSITIONS.some(x => x.id === t.type) ? t.type : 'dissolve', dur: num(t.dur, 1, .01, 60) }));
  p.markers = (Array.isArray(raw.markers) ? raw.markers : []).filter(m => m && id(m.id)).map(m => ({ id: m.id, t: num(m.t, 0, 0, 1e6), name: str(m.name, '', 200), color: color(m.color, '#3fae4a') }));
  p.inPoint = raw.inPoint == null ? null : num(raw.inPoint, null, 0, 1e6);
  p.outPoint = raw.outPoint == null ? null : num(raw.outPoint, null, 0, 1e6);
  return p;
};
