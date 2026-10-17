// Minimal Canvas2D-compatible recorder that writes SVG. Covers the subset the Gantt painter uses
// (rects, paths, arcs, linear gradients, dashes, clipping, text, translate/save/restore), so the same
// drawing code produces a vector Gantt for print shops, PDF conversion and documents. No DOM — runs in Node tests.
(function (root) {
  'use strict';
  const n = v => Math.round(v * 100) / 100;
  const xe = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // CSS colour → [rgb colour, opacity] (rgba() isn't valid SVG 1.1 paint everywhere)
  function color(c) {
    const m = /^rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)$/i.exec(String(c).trim());
    return m ? [`rgb(${+m[1]},${+m[2]},${+m[3]})`, +m[4]] : [String(c), 1];
  }
  function parseFont(f) {
    const m = /^\s*(?:(italic)\s+)?(?:(bold|normal|\d{3})\s+)?([\d.]+)px\s+(.+)$/.exec(f || '');
    return m ? { style: m[1] || '', weight: m[2] || '', size: +m[3], family: m[4] } : { style: '', weight: '', size: 10, family: 'sans-serif' };
  }
  class Gradient { constructor(x0, y0, x1, y1) { Object.assign(this, { x0, y0, x1, y1, stops: [] }); } addColorStop(o, c) { this.stops.push([o, c]); } }

  class SvgContext {
    constructor(width, height, measure) {
      this.width = width; this.height = height; this.measure = measure || null;
      this.out = []; this.defs = []; this.ids = 0; this.stack = []; this.d = '';
      this.s = { tx: 0, ty: 0, fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif', textBaseline: 'alphabetic', textAlign: 'left', dash: [], clip: null, globalAlpha: 1 };
    }
    get fillStyle() { return this.s.fillStyle; } set fillStyle(v) { this.s.fillStyle = v; }
    get strokeStyle() { return this.s.strokeStyle; } set strokeStyle(v) { this.s.strokeStyle = v; }
    get lineWidth() { return this.s.lineWidth; } set lineWidth(v) { this.s.lineWidth = +v || 1; }
    get font() { return this.s.font; } set font(v) { this.s.font = v; }
    get textBaseline() { return this.s.textBaseline; } set textBaseline(v) { this.s.textBaseline = v; }
    get textAlign() { return this.s.textAlign; } set textAlign(v) { this.s.textAlign = v; }
    get globalAlpha() { return this.s.globalAlpha; } set globalAlpha(v) { this.s.globalAlpha = +v; }
    save() { this.stack.push({ ...this.s, dash: this.s.dash.slice() }); }
    restore() { if (this.stack.length) this.s = this.stack.pop(); }
    translate(x, y) { this.s.tx += x; this.s.ty += y; }
    setTransform(a, b, c, d, e, f) { this.s.tx = e || 0; this.s.ty = f || 0; } // only translation/identity is used by the painter
    setLineDash(d) { this.s.dash = (d || []).slice(); }
    X(x) { return n(x + this.s.tx); } Y(y) { return n(y + this.s.ty); }
    beginPath() { this.d = ''; }
    moveTo(x, y) { this.d += `M${this.X(x)} ${this.Y(y)}`; }
    lineTo(x, y) { this.d += `L${this.X(x)} ${this.Y(y)}`; }
    closePath() { this.d += 'Z'; }
    rect(x, y, w, h) { this.d += `M${this.X(x)} ${this.Y(y)}h${n(w)}v${n(h)}h${n(-w)}Z`; }
    arc(x, y, r, a0, a1, ccw) {
      const cx = this.X(x), cy = this.Y(y);
      if (Math.abs(a1 - a0) >= Math.PI * 2 - 1e-6) { this.d += `M${n(cx - r)} ${cy}A${r} ${r} 0 1 0 ${n(cx + r)} ${cy}A${r} ${r} 0 1 0 ${n(cx - r)} ${cy}Z`; return; }
      const sx = cx + r * Math.cos(a0), sy = cy + r * Math.sin(a0), ex = cx + r * Math.cos(a1), ey = cy + r * Math.sin(a1);
      let sweep = ((a1 - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI); if (ccw) sweep = 2 * Math.PI - sweep;
      this.d += `${this.d ? 'L' : 'M'}${n(sx)} ${n(sy)}A${r} ${r} 0 ${sweep > Math.PI ? 1 : 0} ${ccw ? 0 : 1} ${n(ex)} ${n(ey)}`;
    }
    createLinearGradient(x0, y0, x1, y1) { return new Gradient(x0, y0, x1, y1); }
    paint(p) {
      if (p instanceof Gradient) {
        const id = 'g' + (++this.ids);
        this.defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${this.X(p.x0)}" y1="${this.Y(p.y0)}" x2="${this.X(p.x1)}" y2="${this.Y(p.y1)}">` +
          p.stops.map(([o, c]) => { const [cc, a] = color(c); return `<stop offset="${n(o)}" stop-color="${xe(cc)}"${a < 1 ? ` stop-opacity="${a}"` : ''}/>`; }).join('') + '</linearGradient>');
        return [`url(#${id})`, 1];
      }
      return color(p);
    }
    fillAttr() { const [c, a] = this.paint(this.s.fillStyle), o = a * this.s.globalAlpha; return `fill="${xe(c)}"${o < 1 ? ` fill-opacity="${n(o)}"` : ''}`; }
    strokeAttr() {
      const [c, a] = this.paint(this.s.strokeStyle), o = a * this.s.globalAlpha;
      return `fill="none" stroke="${xe(c)}"${o < 1 ? ` stroke-opacity="${n(o)}"` : ''}${this.s.lineWidth !== 1 ? ` stroke-width="${n(this.s.lineWidth)}"` : ''}${this.s.dash.length ? ` stroke-dasharray="${this.s.dash.join(' ')}"` : ''}`;
    }
    emit(tag) { this.out.push(this.s.clip ? tag.replace(/^<(\w+)/, `<$1 clip-path="url(#${this.s.clip})"`) : tag); }
    fill() { if (this.d) this.emit(`<path d="${this.d}" ${this.fillAttr()}/>`); }
    stroke() { if (this.d) this.emit(`<path d="${this.d}" ${this.strokeAttr()}/>`); }
    fillRect(x, y, w, h) { if (w < 0) { x += w; w = -w; } if (h < 0) { y += h; h = -h; } if (!w || !h) return; this.emit(`<rect x="${this.X(x)}" y="${this.Y(y)}" width="${n(w)}" height="${n(h)}" ${this.fillAttr()}/>`); }
    strokeRect(x, y, w, h) { this.emit(`<rect x="${this.X(x)}" y="${this.Y(y)}" width="${n(w)}" height="${n(h)}" ${this.strokeAttr()}/>`); }
    clearRect(x, y, w, h) { const f = this.s.fillStyle; this.s.fillStyle = '#fff'; this.fillRect(x, y, w, h); this.s.fillStyle = f; }
    clip() { // nested clips intersect: the new clipPath is itself clipped by the current one
      const id = 'c' + (++this.ids);
      this.defs.push(`<clipPath id="${id}"${this.s.clip ? ` clip-path="url(#${this.s.clip})"` : ''}><path d="${this.d}"/></clipPath>`);
      this.s.clip = id;
    }
    measureText(t) { if (this.measure) return this.measure(String(t), this.s.font); return { width: String(t).length * parseFont(this.s.font).size * 0.55 }; }
    fillText(t, x, y) {
      const f = parseFont(this.s.font);
      const base = { middle: 'central', top: 'text-before-edge', hanging: 'hanging', bottom: 'text-after-edge' }[this.s.textBaseline];
      const anchor = { right: 'end', end: 'end', center: 'middle' }[this.s.textAlign];
      this.emit(`<text x="${this.X(x)}" y="${this.Y(y)}" font-family="${xe(f.family)}" font-size="${f.size}"${f.weight ? ` font-weight="${f.weight}"` : ''}${f.style ? ` font-style="${f.style}"` : ''}${base ? ` dominant-baseline="${base}"` : ''}${anchor ? ` text-anchor="${anchor}"` : ''} ${this.fillAttr()}>${xe(t)}</text>`);
    }
    toString(title) {
      return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${n(this.width)}" height="${n(this.height)}" viewBox="0 0 ${n(this.width)} ${n(this.height)}">` +
        (title ? `<title>${xe(title)}</title>` : '') + `<defs>${this.defs.join('')}</defs>\n${this.out.join('\n')}\n</svg>\n`;
    }
  }
  const api = { SvgContext, parseFont, color };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PlanSVG = api;
})(typeof self !== 'undefined' ? self : this);
