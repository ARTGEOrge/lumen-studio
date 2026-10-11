'use strict';
/* Lumen Layout — vector PDF export with pdf-lib + fontkit.
   Shapes are real vector paths, text is real (selectable/searchable) text set in the embedded,
   subsetted TrueType fonts at exactly the positions computed by the layout engine. Only SVG/WebP/GIF
   images are rasterised (to 300 ppi at their placed size) because PDF cannot embed them natively. */
(function () {
  const K = 0.5522847498;
  function hexRgb(c) {
    if (!c) return null;
    let m = /^#([0-9a-f]{3})$/i.exec(c); if (m) c = '#' + m[1].split('').map(x => x + x).join('');
    m = /^#([0-9a-f]{6})/i.exec(c); if (m) { const n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
    m = /rgba?\(([^)]+)\)/.exec(c); if (m) { const p = m[1].split(',').map(parseFloat); return [p[0] / 255, p[1] / 255, p[2] / 255]; }
    return [0, 0, 0];
  }
  function b64bytes(dataUrl) { const s = atob(dataUrl.slice(dataUrl.indexOf(',') + 1)); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

  async function rasterize(im, pxW, pxH) {
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(pxW)); c.height = Math.max(1, Math.round(pxH));
    const ctx = c.getContext('2d'); ctx.drawImage(im.el, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function exportPDF({ doc, engine, images, name }, opt = {}) {
    const L = window.PDFLib;
    const { PDFDocument, pushGraphicsState: q, popGraphicsState: Q, concatTransformationMatrix: cm, setFillingRgbColor, setStrokingRgbColor, setLineWidth, moveTo, lineTo,
      appendBezierCurve, closePath, fill, stroke, clip, endPath, beginText, endText, setFontAndSize, setTextMatrix, showText, setCharacterSpacing, drawObject, setGraphicsState, setDashPattern, setTextRenderingMode } = L;
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(window.fontkit);
    pdf.setTitle(name || 'Untitled'); pdf.setProducer('Lumen Layout'); pdf.setCreator('Lumen Layout');
    const fontCache = new Map(), imgCache = new Map();
    async function font(fk) {
      const face = Fonts.faceKey(fk);
      let f = fontCache.get(face); if (f) return f;
      f = await pdf.embedFont(Fonts.bytesFor(fk), { subset: true }); fontCache.set(face, f); return f;
    }
    async function image(it) {
      const im = images[it.img]; if (!im) return null;
      const mime = (im.data.match(/^data:([^;]+)/) || [])[1] || '';
      const svgLike = !/jpe?g|png/.test(mime);
      const key = it.img + (svgLike ? '@' + Math.round(im.w * it.cs) : '');
      let r = imgCache.get(key); if (r) return r;
      if (/jpe?g/.test(mime)) r = await pdf.embedJpg(b64bytes(im.data));
      else if (/png/.test(mime)) r = await pdf.embedPng(b64bytes(im.data));
      else { const s = Math.min(4000 / Math.max(im.w * it.cs, im.h * it.cs), 300 / 72); r = await pdf.embedPng(await rasterize(im, im.w * it.cs * s, im.h * it.cs * s)); }
      imgCache.set(key, r); return r;
    }
    const pages = opt.pages || doc.pages.map((_, i) => i);
    const bl = opt.bleed ? doc.bleed : 0, mk = opt.marks ? Math.max(bl, 0) + 30 : bl;
    for (const pi of pages) {
      const page = doc.pages[pi];
      const W = doc.w + mk * 2, H = doc.h + mk * 2;
      const pg = pdf.addPage([W, H]);
      pg.setTrimBox(mk, mk, doc.w, doc.h);
      pg.setBleedBox(mk - bl, mk - bl, doc.w + bl * 2, doc.h + bl * 2);
      pg.setCropBox(0, 0, W, H);
      const ops = [];
      const fontKeys = new Map(), gsKeys = new Map();
      const fontKey = f => { let k = fontKeys.get(f); if (!k) { k = pg.node.newFontDictionary(f.name, f.ref); fontKeys.set(f, k); } return k; };
      const gs = a => { a = Math.round(a * 1000) / 1000; let k = gsKeys.get(a); if (!k) { const ref = pdf.context.register(pdf.context.obj({ Type: 'ExtGState', ca: a, CA: a })); k = pg.node.newExtGState('GS', ref); gsKeys.set(a, k); } return k; };
      const path = it => {
        const w = it.w, h = it.h;
        if (it.type === 'ellipse') {
          const rx = w / 2, ry = h / 2, cx = rx, cy = ry;
          ops.push(moveTo(cx + rx, cy), appendBezierCurve(cx + rx, cy + ry * K, cx + rx * K, cy + ry, cx, cy + ry), appendBezierCurve(cx - rx * K, cy + ry, cx - rx, cy + ry * K, cx - rx, cy),
            appendBezierCurve(cx - rx, cy - ry * K, cx - rx * K, cy - ry, cx, cy - ry), appendBezierCurve(cx + rx * K, cy - ry, cx + rx, cy - ry * K, cx + rx, cy), closePath());
          return;
        }
        if (it.type === 'line') { if ((it.dir || 1) > 0) ops.push(moveTo(0, 0), lineTo(w, h)); else ops.push(moveTo(0, h), lineTo(w, 0)); return; }
        const r = Math.max(0, Math.min(it.radius || 0, w / 2, h / 2));
        if (r > 0) {
          const k = r * (1 - K);
          ops.push(moveTo(r, 0), lineTo(w - r, 0), appendBezierCurve(w - k, 0, w, k, w, r), lineTo(w, h - r), appendBezierCurve(w, h - k, w - k, h, w - r, h),
            lineTo(r, h), appendBezierCurve(k, h, 0, h - k, 0, h - r), lineTo(0, r), appendBezierCurve(0, k, k, 0, r, 0), closePath());
        } else ops.push(moveTo(0, 0), lineTo(w, 0), lineTo(w, h), lineTo(0, h), closePath());
      };
      // axial shading (+ luminosity soft mask when the stops are translucent)
      let shadeN = 0;
      const shadingRes = () => { const R = pg.node.normalizedEntries().Resources; let d = R.lookupMaybe(L.PDFName.of('Shading'), L.PDFDict); if (!d) { d = pdf.context.obj({}); R.set(L.PDFName.of('Shading'), d); } return d; };
      const gradient = it => {
        const G = it.grad, [x0, y0, x1, y1] = Render.gradPts(it), ctx = pdf.context;
        const c0 = hexRgb(G.c0) || [0, 0, 0], c1 = hexRgb(G.c1) || [0, 0, 0];
        const sh = ctx.register(ctx.obj({ ShadingType: 2, ColorSpace: 'DeviceRGB', Coords: [x0, y0, x1, y1], Extend: [true, true], Function: { FunctionType: 2, Domain: [0, 1], C0: c0, C1: c1, N: 1 } }));
        const key = 'Sh' + (++shadeN); shadingRes().set(L.PDFName.of(key), sh);
        ops.push(q()); path(it); ops.push(clip(), endPath());
        const o0 = G.o0 ?? 1, o1 = G.o1 ?? 1;
        if (o0 < 1 || o1 < 1) {
          const msh = ctx.register(ctx.obj({ ShadingType: 2, ColorSpace: 'DeviceGray', Coords: [x0, y0, x1, y1], Extend: [true, true], Function: { FunctionType: 2, Domain: [0, 1], C0: [o0], C1: [o1], N: 1 } }));
          const form = ctx.register(ctx.stream('/M sh', { Type: 'XObject', Subtype: 'Form', BBox: [Math.min(0, it.w), Math.min(0, it.h), Math.max(0, it.w), Math.max(0, it.h)], Group: { S: 'Transparency', CS: 'DeviceGray' }, Resources: { Shading: { M: msh } } }));
          const gsRef = ctx.register(ctx.obj({ Type: 'ExtGState', SMask: { Type: 'Mask', S: 'Luminosity', G: form } }));
          ops.push(setGraphicsState(pg.node.newExtGState('GS', gsRef)));
        }
        ops.push(L.PDFOperator.of('sh', [L.PDFName.of(key)]), Q());
      };
      const text = async (fk, size, color, track, x, y, str) => {
        if (!str) return;
        const f = await font(fk), p = Fonts.parse(fk), c = hexRgb(color) || [0, 0, 0];
        ops.push(beginText(), setFillingRgbColor(...c), setFontAndSize(fontKey(f), size), setCharacterSpacing(track || 0),
          setTextMatrix(1, 0, p.synthItalic ? 0.21 : 0, -1, x, y), showText(f.encodeText(str)), endText());
      };
      const drawItem = async (it, env, alpha) => {
        if (it.hidden) return;
        if (it.type === 'group') { for (const c of it.children) await drawItem(c, env, alpha * (it.opacity ?? 1)); return; }
        if (!engine.layerVisible(it)) return;
        const a = alpha * (it.opacity ?? 1);
        ops.push(q());
        if (a < 1) ops.push(setGraphicsState(gs(a)));
        if (it.rot) { const r = it.rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); ops.push(cm(1, 0, 0, 1, it.x + it.w / 2, it.y + it.h / 2), cm(c, s, -s, c, 0, 0), cm(1, 0, 0, 1, -it.w / 2, -it.h / 2)); }
        else ops.push(cm(1, 0, 0, 1, it.x, it.y));
        if (it.type !== 'line' && it.grad) gradient(it);
        else if (it.type !== 'line' && it.fill) { const c = hexRgb(it.fill); path(it); ops.push(setFillingRgbColor(...c), fill()); }
        if (it.type === 'image' && it.img && images[it.img]) {
          const img = await image(it), im = images[it.img];
          if (img) {
            const xo = pg.node.newXObject('Im', img.ref);
            ops.push(q()); path(it); ops.push(clip(), endPath());
            ops.push(cm(im.w * it.cs, 0, 0, -im.h * it.cs, it.cx, it.cy + im.h * it.cs), drawObject(xo), Q());
          }
        }
        if (it.type === 'table') {
          let y = 0;
          for (let r = 0; r < it.rowH.length; r++) {
            let x = 0; const rh = it.rowH[r], head = r < (it.header || 0);
            for (let c = 0; c < it.colW.length; c++) {
              const cw = it.colW[c], cell = it.cells[r][c] || {};
              const f = cell.fill || (head ? it.hfill : (it.zebra && (r - (it.header || 0)) % 2 === 1 ? it.zebra : null));
              if (f) ops.push(setFillingRgbColor(...hexRgb(f)), L.rectangle(x, y, cw, rh), fill());
              for (const l of Render.tableCellLines(it, r, c)) await text(l.fk, it.tsize, cell.color || (head ? it.hcolor : it.tcolor), 0, x + l.x, y + l.y, l.text);
              x += cw;
            }
            y += rh;
          }
          if (it.bw > 0) {
            ops.push(setStrokingRgbColor(...hexRgb(it.bcolor)), setLineWidth(it.bw));
            let yy = 0; for (let r = 0; r <= it.rowH.length; r++) { ops.push(moveTo(0, yy), lineTo(it.w, yy)); yy += it.rowH[r] || 0; }
            let xx = 0; for (let c = 0; c <= it.colW.length; c++) { ops.push(moveTo(xx, 0), lineTo(xx, it.h)); xx += it.colW[c] || 0; }
            ops.push(stroke());
          }
        }
        if (it.type === 'text') {
          const Lay = engine.frameLayout(it, env.label);
          if (Lay) for (const ln of Lay.lines) {
            if (ln.drop) await text(ln.drop.st.fk, ln.drop.st.size, ln.drop.st.color, 0, ln.drop.x, ln.drop.y, ln.drop.text);
            for (const r of ln.runs) {
              const st = r.st, y = ln.y - st.shift;
              await text(st.fk, st.size, st.color, st.track * st.size / 1000, r.x, y, r.text);
              if (st.under || st.strike) ops.push(setFillingRgbColor(...hexRgb(st.color)), L.rectangle(r.x, st.under ? y + st.size * 0.12 : y - st.size * 0.28, r.end - r.x, Math.max(0.4, st.size * 0.06)), fill());
            }
          }
        }
        if (it.stroke && it.sw > 0) {
          path(it); ops.push(setStrokingRgbColor(...hexRgb(it.stroke)), setLineWidth(it.sw));
          if (it.dash) ops.push(setDashPattern([it.sw * 3, it.sw * 2], 0));
          ops.push(stroke());
        }
        ops.push(Q());
      };
      ops.push(q(), cm(1, 0, 0, -1, mk, H - mk));
      ops.push(L.rectangle(-bl, -bl, doc.w + bl * 2, doc.h + bl * 2), clip(), endPath());
      const env = { label: engine.label(pi) };
      const mp = engine.masterPage(page, pi), over = page.overrides || [];
      if (mp) for (const it of engine.sortedItems(mp.items)) if (!over.includes(it.id)) await drawItem(it, env, 1);
      for (const it of engine.sortedItems(page.items)) await drawItem(it, env, 1);
      ops.push(Q());
      if (opt.marks) {
        const off = bl + 6, len = 18;
        ops.push(q(), setStrokingRgbColor(0, 0, 0), setLineWidth(0.25));
        const x0 = mk, y0 = mk, x1 = mk + doc.w, y1 = mk + doc.h;
        for (const [x, sx] of [[x0, -1], [x1, 1]]) for (const [y, sy] of [[y0, -1], [y1, 1]]) {
          ops.push(moveTo(x + sx * off, y), lineTo(x + sx * (off + len), y), moveTo(x, y + sy * off), lineTo(x, y + sy * (off + len)));
        }
        ops.push(stroke(), Q());
        // page info slug
        const f = await font(Fonts.resolve('Montserrat', 400, false));
        ops.push(beginText(), setFillingRgbColor(0, 0, 0), setFontAndSize(fontKey(f), 6), setTextMatrix(1, 0, 0, 1, mk + 14, 8),
          showText(f.encodeText(`${name || 'Untitled'}  ·  Page ${pi + 1}  ·  ${new Date().toISOString().slice(0, 10)}`)), endText());
      }
      pg.pushOperators(...ops);
    }
    return await pdf.save();
  }

  window.PdfOut = { exportPDF, hexRgb };
})();
