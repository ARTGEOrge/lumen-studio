'use strict';
/* Lumen Diagram — vector PDF export with pdf-lib: the same display list as the SVG, drawn as PDF paths
   and standard-font text (Helvetica / Times / Courier, metric-compatible with the on-screen fonts). */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const PL = isNode ? require('../vendor/pdf-lib.min.js') : root.PDFLib;
  const Rn = isNode ? require('./render.js') : root.DiaRender;
  const Rt = isNode ? require('./route.js') : root.DiaRoute;

  const NAMED = { white: '#ffffff', black: '#000000', red: '#ff0000', green: '#008000', blue: '#0000ff', gray: '#808080', grey: '#808080', yellow: '#ffff00', orange: '#ffa500', transparent: null, none: null };
  function color(c) {
    if (!c) return null; c = String(c).trim().toLowerCase(); if (c in NAMED) c = NAMED[c]; if (!c) return null;
    let m = /^#([0-9a-f]{3,8})$/.exec(c);
    if (m) { let h = m[1]; if (h.length === 3 || h.length === 4) h = h.split('').map(x => x + x).join(''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255, a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 }; }
    m = /^rgba?\(([^)]+)\)$/.exec(c);
    if (m) { const p = m[1].split(',').map(s => parseFloat(s)); return { r: (p[0] || 0) / 255, g: (p[1] || 0) / 255, b: (p[2] || 0) / 255, a: p[3] ?? 1 }; }
    return null;
  }
  const mix = (a, b) => { const x = color(a), y = color(b); if (!x || !y) return x || y; return { r: (x.r + y.r) / 2, g: (x.g + y.g) / 2, b: (x.b + y.b) / 2, a: 1 }; };
  const WIN = new Set([0x2022, 0x2013, 0x2014, 0x2026, 0x2018, 0x2019, 0x201c, 0x201d, 0x20ac, 0x2122, 0x201a, 0x201e, 0x2020, 0x2021, 0x2030, 0x2039, 0x203a, 0x0152, 0x0153, 0x0160, 0x0161, 0x0178, 0x017d, 0x017e, 0x0192, 0x02c6, 0x02dc]);
  const winAnsi = s => Array.from(s).map(ch => { const c = ch.codePointAt(0); return (c >= 32 && c <= 126) || (c >= 160 && c <= 255) || WIN.has(c) ? ch : c === 9 ? ' ' : '?'; }).join('');
  const SIZES = { a4: [595.28, 841.89], letter: [612, 792], a3: [841.89, 1190.55] };

  async function exportPDF(pages, o = {}) {
    const { PDFDocument, StandardFonts, rgb, degrees } = PL;
    const pdf = await PDFDocument.create();
    pdf.setTitle(o.title || 'Diagram'); pdf.setCreator('Lumen Diagram'); pdf.setProducer('Lumen Diagram (pdf-lib)');
    const fontCache = {};
    const font = async (fam, b, i) => {
      const key = fam + (b ? 'B' : '') + (i ? 'I' : '');
      if (!fontCache[key]) {
        const F = StandardFonts;
        const name = fam === 'serif' ? (b && i ? F.TimesRomanBoldItalic : b ? F.TimesRomanBold : i ? F.TimesRomanItalic : F.TimesRoman)
          : fam === 'mono' ? (b && i ? F.CourierBoldOblique : b ? F.CourierBold : i ? F.CourierOblique : F.Courier)
            : (b && i ? F.HelveticaBoldOblique : b ? F.HelveticaBold : i ? F.HelveticaOblique : F.Helvetica);
        fontCache[key] = await pdf.embedFont(name);
      }
      return fontCache[key];
    };
    const toRGB = c => rgb(c.r, c.g, c.b);
    let drawn = 0;
    for (const page of pages) {
      const routes = o.routesFor ? o.routesFor(page) : Rt.routePage(page);
      const R = Rn.pageSVG(page, { routes, padding: o.padding ?? 20, transparent: o.transparent, filter: o.filterFor ? o.filterFor(page) : null });
      const vb = R.box;
      let W, H, k, ox, oy;
      const size = SIZES[o.size];
      if (size) {
        const land = vb.w > vb.h; [W, H] = land ? [size[1], size[0]] : size;
        const m = 28; k = Math.min((W - 2 * m) / vb.w, (H - 2 * m) / vb.h, o.maxScale || 0.75);
        ox = (W - vb.w * k) / 2; oy = (H - vb.h * k) / 2;
      } else { k = 0.75; W = vb.w * k; H = vb.h * k; ox = 0; oy = 0; }
      const pg = pdf.addPage([W, H]);
      const X = x => ox + (x - vb.x) * k, Y = y => H - (oy + (y - vb.y) * k);
      if (!o.transparent) { const bg = color(page.bg || '#ffffff'); if (bg) pg.drawRectangle({ x: X(vb.x), y: Y(vb.y + vb.h), width: vb.w * k, height: vb.h * k, color: toRGB(bg) }); }
      for (const list of R.lists) for (const p of list) {
        if (p.k === 'path') {
          const fill = p.fill2 && p.fill !== 'none' ? mix(p.fill, p.fill2) : color(p.fill), stroke = p.stroke && p.stroke !== 'none' ? color(p.stroke) : null;
          if (!fill && !stroke) continue;
          const opt = { x: X(0), y: Y(0), scale: k };
          if (fill) { opt.color = toRGB(fill); opt.opacity = (p.op ?? 1) * (fill.a ?? 1); }
          if (stroke) { opt.borderColor = toRGB(stroke); opt.borderWidth = (p.sw || 1) * k; opt.borderOpacity = (p.op ?? 1) * (stroke.a ?? 1); const da = Rn.dashArr(p.dash, p.sw || 1); if (da) opt.borderDashArray = da.map(v => v * k); opt.borderLineCap = p.line ? PL.LineCapStyle.Butt : PL.LineCapStyle.Round; }
          else opt.borderWidth = 0;
          pg.drawSvgPath(p.d, opt); drawn++;
        } else if (p.k === 'text') {
          const c = color(p.color) || { r: 0, g: 0, b: 0, a: 1 };
          for (const l of p.lines) {
            if (!l.t) continue;
            const f = await font(p.fam, l.b, p.italic || l.i), t = winAnsi(l.t);
            const w = f.widthOfTextAtSize(t, p.size);
            const off = p.anchor === 'middle' ? w / 2 : p.anchor === 'end' ? w : 0;
            const a = (p.angle || 0) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
            const sx = l.x - off * ca, sy = l.y - off * sa;
            pg.drawText(t, { x: X(sx), y: Y(sy), size: p.size * k, font: f, color: toRGB(c), opacity: (p.op ?? 1) * (c.a ?? 1), rotate: degrees(-(p.angle || 0)) });
            if (p.underline) { const uy = p.size * 0.12; pg.drawLine({ start: { x: X(sx - uy * sa), y: Y(sy + uy * ca) }, end: { x: X(sx + w * ca - uy * sa), y: Y(sy + w * sa + uy * ca) }, thickness: Math.max(0.5, p.size * 0.06) * k, color: toRGB(c) }); }
            drawn++;
          }
        } else if (p.k === 'image') {
          try {
            let bytes = null, kind = null; const m = /^data:image\/(png|jpeg);base64,(.*)$/.exec(p.href);
            if (m) { kind = m[1]; bytes = b64(m[2]); } else if (o.rasterize) { bytes = await o.rasterize(p.href); kind = 'png'; }
            if (!bytes) continue;
            const img = kind === 'png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
            pg.drawImage(img, { x: X(p.x), y: Y(p.y + p.h), width: p.w * k, height: p.h * k, opacity: p.op ?? 1 }); drawn++;
          } catch (e) { /* skip unreadable image */ }
        }
      }
    }
    const bytes = await pdf.save();
    return o.stats ? { bytes, drawn } : bytes;
  }
  function b64(s) { if (typeof atob === 'function') { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; } return new Uint8Array(Buffer.from(s, 'base64')); }

  const api = { exportPDF, color, winAnsi };
  if (isNode) module.exports = api; else root.DiaPDF = api;
})(typeof self !== 'undefined' ? self : this);
