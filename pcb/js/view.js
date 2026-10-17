// Pan/zoom canvas shared by the schematic and board editors.
(function () {
  class View {
    constructor(canvas, { scale = 10, min = 1, max = 400, onChange } = {}) {
      this.cv = canvas; this.g = canvas.getContext('2d'); this.scale = scale; this.min = min; this.max = max; this.ox = 0; this.oy = 0; this.onChange = onChange;
      this.dpr = 1; this.w = 1; this.h = 1;
      canvas.addEventListener('wheel', e => { e.preventDefault(); const [wx, wy] = this.toWorld(e.offsetX, e.offsetY); const f = e.deltaY < 0 ? 1.2 : 1 / 1.2; this.scale = Math.max(this.min, Math.min(this.max, this.scale * f)); this.ox = wx - e.offsetX / this.scale; this.oy = wy - e.offsetY / this.scale; this.onChange && this.onChange(); }, { passive: false });
      // pan: middle or right button drag, or Space + left drag
      let pan = null; this.space = false;
      addEventListener('keydown', e => { if (e.code === 'Space' && !e.target.closest?.('input,textarea,select')) { this.space = true; } });
      addEventListener('keyup', e => { if (e.code === 'Space') this.space = false; });
      canvas.addEventListener('pointerdown', e => { if (e.button === 1 || e.button === 2 || (e.button === 0 && this.space)) { e.preventDefault(); e.stopImmediatePropagation(); pan = { x: e.clientX, y: e.clientY, ox: this.ox, oy: this.oy, moved: false }; canvas.setPointerCapture(e.pointerId); } }, true);
      canvas.addEventListener('pointermove', e => { if (!pan) return; pan.moved = true; this.ox = pan.ox - (e.clientX - pan.x) / this.scale; this.oy = pan.oy - (e.clientY - pan.y) / this.scale; this.onChange && this.onChange(); e.stopImmediatePropagation(); }, true);
      canvas.addEventListener('pointerup', e => { if (pan) { this.lastPanMoved = pan.moved; pan = null; e.stopImmediatePropagation(); } }, true);
      canvas.addEventListener('contextmenu', e => e.preventDefault());
    }
    resize() {
      const r = this.cv.parentElement.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      this.w = Math.max(10, r.width); this.h = Math.max(10, r.height); this.dpr = dpr;
      if (this.cv.width !== Math.round(this.w * dpr) || this.cv.height !== Math.round(this.h * dpr)) { this.cv.width = Math.round(this.w * dpr); this.cv.height = Math.round(this.h * dpr); this.cv.style.width = this.w + 'px'; this.cv.style.height = this.h + 'px'; }
    }
    begin() { this.resize(); const g = this.g; g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); return g; }
    world() { this.g.setTransform(this.dpr * this.scale, 0, 0, this.dpr * this.scale, -this.ox * this.scale * this.dpr, -this.oy * this.scale * this.dpr); }
    toWorld(sx, sy) { return [this.ox + sx / this.scale, this.oy + sy / this.scale]; }
    toScreen(x, y) { return [(x - this.ox) * this.scale, (y - this.oy) * this.scale]; }
    fit(x0, y0, x1, y1, pad = 30) { this.resize(); const s = Math.min((this.w - 2 * pad) / Math.max(1e-6, x1 - x0), (this.h - 2 * pad) / Math.max(1e-6, y1 - y0)); this.scale = Math.max(this.min, Math.min(this.max, s)); this.ox = (x0 + x1) / 2 - this.w / 2 / this.scale; this.oy = (y0 + y1) / 2 - this.h / 2 / this.scale; }
    eventWorld(e) { const r = this.cv.getBoundingClientRect(); return this.toWorld(e.clientX - r.left, e.clientY - r.top); }
  }
  window.PcbView = View;
})();
