'use strict';
/* Lumen Slides — animation timeline + slide-show player (transitions, click-sequenced entrance/exit/emphasis effects).
   Used by the full-screen show, the presenter view, the audience window (show.html) and the editor's preview. */
const Anim = (() => {
  const easeOut = p => 1 - Math.pow(1 - p, 3), easeIn = p => p * p * p, easeIO = p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  // Build click steps: [{auto, dur, items:[{a, t0, t1}]}]
  function build(slide) {
    // PowerPoint semantics: "with previous" starts with the current group, "after previous" starts a new group
    // when everything before it in this click step has finished; each effect then waits its own delay.
    const steps = []; let cur = null, gStart = 0, end = 0;
    for (const a of slide.anims || []) {
      if (!cur || a.trig === 'click') { cur = { auto: !steps.length && a.trig !== 'click', items: [], dur: 0 }; steps.push(cur); gStart = 0; end = 0; }
      else if (a.trig === 'after') gStart = end;
      const t0 = gStart + a.delay, t1 = t0 + (a.fx === 'appear' ? 0.001 : a.dur);
      cur.items.push({ a, t0, t1 }); end = Math.max(end, t1); cur.dur = end;
    }
    return steps;
  }
  function initialHidden(slide) {
    const first = new Map();
    for (const a of slide.anims || []) if (!first.has(a.target)) first.set(a.target, a.cls);
    const s = new Set(); for (const [id, cls] of first) if (cls === 'entr') s.add(id); return s;
  }
  // effect state for one animation at progress p (0..1)
  function fx(a, p, o, doc) {
    const entr = a.cls === 'entr', exit = a.cls === 'exit';
    if (a.cls === 'emph') {
      if (a.fx === 'spin') return { rot: 360 * easeIO(p) };
      if (a.fx === 'teeter') return { rot: 7 * Math.sin(p * Math.PI * 4) * (1 - p) };
      if (a.fx === 'grow') return { sx: 1 + 0.25 * easeOut(p) };
      return { sx: 1 + 0.12 * Math.sin(Math.PI * p) }; // pulse
    }
    const q = entr ? easeOut(p) : easeIn(p), v = entr ? q : 1 - q; // v = visibility amount
    switch (a.fx) {
      case 'appear': return p > 0 ? (entr ? {} : { hidden: true }) : (entr ? { hidden: true } : {});
      case 'fade': return { alpha: v };
      case 'fly': {
        const W = doc.w, H = doc.h, d = a.dir || 'b';
        const off = d === 'l' ? { dx: -(o.x + o.w) - 10 } : d === 'r' ? { dx: W - o.x + 10 } : d === 't' ? { dy: -(o.y + o.h) - 10 } : { dy: H - o.y + 10 };
        return { dx: (off.dx || 0) * (1 - v), dy: (off.dy || 0) * (1 - v) };
      }
      case 'float': return { alpha: v, dy: (a.dir === 't' ? -1 : 1) * 60 * (1 - v) };
      case 'zoom': return { alpha: Math.min(1, v * 1.4), sx: 0.05 + 0.95 * v };
      case 'grow': return { alpha: v, sx: 0.6 + 0.4 * v };
      case 'wipe': return { clip: { p: v, dir: { l: 'l', r: 'r', t: 't', b: 'b' }[entr ? a.dir : a.dir] || 'b' } };
      case 'split': return { clip: { p: v, dir: 'split' } };
      default: return { alpha: v };
    }
  }
  /* State map at click-step `step` (number of completed steps) and time t inside the step being played (null = not playing). */
  function state(doc, slide, steps, step, t) {
    const m = new Map(), hidden = initialHidden(slide);
    const objOf = id => Model.findObj(slide.objects, id);
    for (const id of hidden) m.set(id, { hidden: true });
    const apply = (it, p) => {
      const o = objOf(it.a.target); if (!o) return;
      if (p >= 1) { // final state
        if (it.a.cls === 'entr') m.delete(o.id); else if (it.a.cls === 'exit') m.set(o.id, { hidden: true });
        return;
      }
      if (p <= 0) return;
      m.set(o.id, fx(it.a, p, o, doc));
    };
    for (let s = 0; s < Math.min(step, steps.length); s++) for (const it of steps[s].items) apply(it, 1);
    if (t != null && steps[step]) for (const it of steps[step].items) { const p = it.t1 <= it.t0 ? (t >= it.t0 ? 1 : 0) : (t - it.t0) / (it.t1 - it.t0); if (p > 0) apply(it, Math.min(1, p)); else if (it.a.cls === 'entr' && hidden.has(it.a.target)) {/* stays hidden */} }
    return m;
  }
  return { build, state, fx, easeOut, easeIO };
})();

class Player {
  /* opts: {canvas, getDoc:()=>doc, getAssets, onChange(state), onEnd(), loop, includeHidden} */
  constructor(opts) {
    this.o = opts; this.cv = opts.canvas; this.si = 0; this.step = 0; this.playing = null; this.trans = null; this.blank = null; this.raf = 0; this.timer = 0; this.ended = false;
  }
  get doc() { return this.o.getDoc(); }
  get assets() { return this.o.getAssets(); }
  list() { const d = this.doc; return d.slides.map((s, i) => i).filter(i => this.o.includeHidden || !d.slides[i].hidden || i === this.forceIdx); }
  slide() { return this.doc.slides[this.list()[this.si]]; }
  index() { return this.list()[this.si]; }
  steps() { const s = this.slide(); return s ? Anim.build(s) : []; }
  start(slideIndex = 0, step = 0) {
    const L = this.doc.slides.map((s, i) => i);
    this.forceIdx = slideIndex; const lst = this.list(); let k = lst.indexOf(slideIndex); if (k < 0) k = 0;
    this.si = k; this.step = step; this.ended = false; this.trans = null; this.playing = null;
    this.afterEnter(true);
  }
  emit() { this.o.onChange && this.o.onChange({ slide: this.index(), si: this.si, step: this.step, steps: this.steps().length, count: this.list().length, ended: this.ended, blank: this.blank }); }
  afterEnter(noTrans) {
    clearTimeout(this.timer);
    const st = this.steps();
    if (this.step === 0 && st[0] && st[0].auto) this.playStep();
    else this.scheduleAdvance();
    this.draw(); this.emit();
  }
  scheduleAdvance() {
    clearTimeout(this.timer);
    const s = this.slide(); if (!s) return;
    const after = s.transition && s.transition.after;
    if (after != null && after >= 0 && this.step >= this.steps().length && this.o.autoAdvance !== false) this.timer = setTimeout(() => this.next(), after * 1000);
  }
  next() {
    if (this.blank) { this.blank = null; this.draw(); this.emit(); return; }
    if (this.ended) { this.o.onEnd && this.o.onEnd(); return; }
    if (this.trans) { this.trans = null; this.afterEnter(); return; }
    if (this.playing) { this.finishStep(); return; }
    const st = this.steps();
    if (this.step < st.length) { this.playStep(); return; }
    if (this.si + 1 < this.list().length) this.gotoSlide(this.si + 1, true);
    else if (this.o.loop) this.gotoSlide(0, true);
    else { this.ended = true; this.draw(); this.emit(); }
  }
  prev() {
    if (this.blank) { this.blank = null; this.draw(); this.emit(); return; }
    if (this.ended) { this.ended = false; this.draw(); this.emit(); return; }
    this.trans = null;
    if (this.playing) { this.playing = null; cancelAnimationFrame(this.raf); this.draw(); this.emit(); return; }
    if (this.step > 0) { this.step--; this.draw(); this.emit(); return; }
    if (this.si > 0) { this.si--; this.step = this.steps().length; this.draw(); this.emit(); }
  }
  gotoSlide(si, animate, step = 0) {
    const n = this.list().length; if (!n) return;
    si = Math.max(0, Math.min(n - 1, si));
    clearTimeout(this.timer); cancelAnimationFrame(this.raf); this.playing = null; this.ended = false;
    const from = animate ? { slide: this.slide(), step: this.steps().length } : null;
    this.si = si; this.step = step;
    const tr = this.slide().transition || {};
    if (animate && from && tr.type && tr.type !== 'none' && !this.o.noTransitions) {
      this.trans = { from, t0: performance.now(), dur: Math.max(0.05, tr.dur || 0.7) * 1000, type: tr.type, dir: tr.dir };
      this.cacheA = null; this.cacheB = null;
      const loop = () => { if (!this.trans) return; const p = (performance.now() - this.trans.t0) / this.trans.dur; if (p >= 1) { this.trans = null; this.afterEnter(); return; } this.draw(); this.raf = requestAnimationFrame(loop); };
      this.raf = requestAnimationFrame(loop); this.emit();
    } else { this.trans = null; this.afterEnter(); }
  }
  playStep() {
    const st = this.steps()[this.step]; if (!st) return;
    clearTimeout(this.timer);
    this.playing = { t0: performance.now(), dur: st.dur * 1000 };
    const loop = () => { if (!this.playing) return; const t = (performance.now() - this.playing.t0) / 1000; if (t * 1000 >= this.playing.dur) { this.finishStep(); return; } this.draw(t); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop); this.emit();
  }
  finishStep() { cancelAnimationFrame(this.raf); this.playing = null; this.step++; this.draw(); this.emit(); this.scheduleAdvance(); }
  setBlank(color) { this.blank = this.blank === color ? null : color; this.draw(); this.emit(); }
  // geometry: slide fitted into the canvas
  fit() {
    const cv = this.cv, dpr = window.devicePixelRatio || 1, cw = cv.clientWidth || cv.width, ch = cv.clientHeight || cv.height;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); this.cacheA = this.cacheB = null; }
    const d = this.doc, k = Math.min(cv.width / d.w, cv.height / d.h);
    return { k, ox: (cv.width - d.w * k) / 2, oy: (cv.height - d.h * k) / 2, w: d.w * k, h: d.h * k };
  }
  renderSlideTo(c, slide, step, t, f) {
    const d = this.doc, steps = Anim.build(slide);
    c.save(); c.setTransform(f.k, 0, 0, f.k, f.ox, f.oy);
    Render.drawSlide(c, d, slide, this.assets, { scale: f.k, anim: Anim.state(d, slide, steps, step, t), slideNum: d.slides.indexOf(slide) + 1, useStoredScale: false });
    c.restore();
  }
  offscreen(slide, step, f) { const cv = document.createElement('canvas'); cv.width = this.cv.width; cv.height = this.cv.height; const c = cv.getContext('2d'); this.renderSlideTo(c, slide, step, null, f); return cv; }
  draw(t) {
    const cv = this.cv, c = cv.getContext('2d'), f = this.fit();
    c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#000'; c.fillRect(0, 0, cv.width, cv.height);
    if (this.blank) { c.fillStyle = this.blank; c.fillRect(0, 0, cv.width, cv.height); return; }
    if (this.ended) { c.fillStyle = '#fff'; c.font = `${Math.round(18 * (window.devicePixelRatio || 1))}px "Segoe UI", sans-serif`; c.textAlign = 'center'; c.fillText('End of slide show, click to exit.', cv.width / 2, Math.round(40 * (window.devicePixelRatio || 1))); c.textAlign = 'left'; return; }
    const slide = this.slide(); if (!slide) return;
    if (this.trans) {
      const p = Math.min(1, (performance.now() - this.trans.t0) / this.trans.dur);
      if (!this.cacheA) this.cacheA = this.offscreen(this.trans.from.slide, this.trans.from.step, f);
      if (!this.cacheB) this.cacheB = this.offscreen(slide, this.step, f);
      Player.composite(c, this.cacheA, this.cacheB, this.trans.type, this.trans.dir, p, f);
      return;
    }
    c.save(); c.beginPath(); c.rect(f.ox, f.oy, f.w, f.h); c.clip();
    this.renderSlideTo(c, slide, this.step, this.playing ? t || 0 : null, f);
    c.restore();
  }
  static composite(c, A, B, type, dir, p, f) {
    const e = Anim.easeIO(p), W = f.w, H = f.h;
    const clipSlide = () => { c.beginPath(); c.rect(f.ox, f.oy, f.w, f.h); c.clip(); };
    const sign = { l: -1, r: 1, u: -1, d: 1 }[dir] || -1, vert = dir === 'u' || dir === 'd';
    c.save(); clipSlide();
    switch (type) {
      case 'fade': c.drawImage(A, 0, 0); c.globalAlpha = e; c.drawImage(B, 0, 0); break;
      case 'flash': { c.drawImage(p < 0.5 ? A : B, 0, 0); c.globalAlpha = 1 - Math.abs(p - 0.5) * 2; c.fillStyle = '#fff'; c.fillRect(f.ox, f.oy, W, H); break; }
      case 'push': { const dx = vert ? 0 : -sign * W * e, dy = vert ? -sign * H * e : 0; c.drawImage(A, dx, dy); c.drawImage(B, dx + (vert ? 0 : sign * W), dy + (vert ? sign * H : 0)); break; }
      case 'cover': { c.drawImage(A, 0, 0); const dx = vert ? 0 : sign * W * (1 - e), dy = vert ? sign * H * (1 - e) : 0; c.drawImage(B, dx, dy); break; }
      case 'uncover': { c.drawImage(B, 0, 0); const dx = vert ? 0 : -sign * W * e, dy = vert ? -sign * H * e : 0; c.drawImage(A, dx, dy); break; }
      case 'wipe': { c.drawImage(A, 0, 0); c.beginPath(); const s = { l: [f.ox + W * (1 - e), f.oy, W * e, H], r: [f.ox, f.oy, W * e, H], u: [f.ox, f.oy + H * (1 - e), W, H * e], d: [f.ox, f.oy, W, H * e] }[dir || 'r']; c.rect(...s); c.clip(); c.drawImage(B, 0, 0); break; }
      case 'split': { c.drawImage(A, 0, 0); c.beginPath(); if (dir === 'h') c.rect(f.ox, f.oy + H / 2 * (1 - e), W, H * e); else c.rect(f.ox + W / 2 * (1 - e), f.oy, W * e, H); c.clip(); c.drawImage(B, 0, 0); break; }
      case 'zoom': { c.drawImage(A, 0, 0); c.globalAlpha = Math.min(1, e * 1.3); const s = 0.5 + 0.5 * e, cx = f.ox + W / 2, cy = f.oy + H / 2; c.translate(cx, cy); c.scale(s, s); c.translate(-cx, -cy); c.drawImage(B, 0, 0); break; }
      default: c.drawImage(B, 0, 0);
    }
    c.restore();
  }
  stop() { cancelAnimationFrame(this.raf); clearTimeout(this.timer); this.trans = null; this.playing = null; }
}
// static render of a slide at a given step (presenter "next" preview)
Player.renderStatic = (canvas, doc, assets, slide, step) => {
  const dpr = window.devicePixelRatio || 1, cw = canvas.clientWidth || canvas.width, ch = canvas.clientHeight || canvas.height;
  canvas.width = Math.round(cw * dpr); canvas.height = Math.round(ch * dpr);
  const c = canvas.getContext('2d'); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#1b1f26'; c.fillRect(0, 0, canvas.width, canvas.height);
  if (!slide) return;
  const k = Math.min(canvas.width / doc.w, canvas.height / doc.h), ox = (canvas.width - doc.w * k) / 2, oy = (canvas.height - doc.h * k) / 2;
  c.setTransform(k, 0, 0, k, ox, oy);
  Render.drawSlide(c, doc, slide, assets, { scale: k, anim: Anim.state(doc, slide, Anim.build(slide), step, null), slideNum: doc.slides.indexOf(slide) + 1 });
};
