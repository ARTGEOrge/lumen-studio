'use strict';
/* Lumen Layout — vector PDF export with pdf-lib + fontkit.
   Shapes are real vector paths, text is real (selectable/searchable) text set in the embedded,
   subsetted TrueType fonts at exactly the positions computed by the layout engine (kerning and
   ligatures are preserved: runs never span a kerning adjustment, and fonts are embedded with the
   same OpenType feature set the layout used).
   Color: RGB colors are written with rg/RG, process CMYK swatches with k/K (DeviceCMYK), spot swatches
   as /Separation color spaces (alternate DeviceCMYK, type-2 tint transform) with cs/scn. With
   opt.cmyk every RGB color — and every image — is converted to DeviceCMYK so the file has no RGB.
   Only SVG/WebP/GIF images are rasterised (to 300 ppi at their placed size). */
(function () {
  const K = 0.5522847498;
  function hexRgb(c) { const r = Color.parse(c); return r.kind === 'none' ? null : r.rgb; }
  function b64bytes(dataUrl) { const s = atob(dataUrl.slice(dataUrl.indexOf(',') + 1)); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

  async function rasterize(im, pxW, pxH) {
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(pxW)); c.height = Math.max(1, Math.round(pxH));
    const ctx = c.getContext('2d'); ctx.drawImage(im.el, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  }
  // RGB(A) image → DeviceCMYK image XObject (+ alpha soft mask), Flate-compressed
  function cmykImage(pdf, im, maxPx) {
    const el = im.el, s = Math.min(1, maxPx / Math.max(el.naturalWidth || 1, el.naturalHeight || 1));
    const w = Math.max(1, Math.round((el.naturalWidth || im.w) * s)), h = Math.max(1, Math.round((el.naturalHeight || im.h) * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(el, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h * 4), alpha = new Uint8Array(w * h); let hasA = false;
    for (let i = 0, j = 0; i < d.length; i += 4, j++) {
      const [cc, m, y, k] = Color.rgbToCmyk(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
      out[j * 4] = cc * 255; out[j * 4 + 1] = m * 255; out[j * 4 + 2] = y * 255; out[j * 4 + 3] = k * 255;
      alpha[j] = d[i + 3]; if (d[i + 3] < 255) hasA = true;
    }
    const ctxp = pdf.context, dict = { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceCMYK', BitsPerComponent: 8 };
    if (hasA) dict.SMask = ctxp.register(ctxp.flateStream(alpha, { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
    return { ref: ctxp.register(ctxp.flateStream(out, dict)) };
  }

  async function exportPDF({ doc, engine, images, name }, opt = {}) {
    const L = window.PDFLib;
    const { PDFDocument, pushGraphicsState: q, popGraphicsState: Q, concatTransformationMatrix: cm, setFillingRgbColor, setStrokingRgbColor, setFillingCmykColor, setStrokingCmykColor, setLineWidth, moveTo, lineTo,
      appendBezierCurve, closePath, fill, stroke, clip, endPath, beginText, endText, setFontAndSize, setTextMatrix, showText, setCharacterSpacing, drawObject, setGraphicsState, setDashPattern } = L;
    Color.use(doc);
    const pdf = await PDFDocument.create();
    pdf.registerFontkit(window.fontkit);
    pdf.setTitle(name || 'Untitled'); pdf.setProducer('Lumen Layout'); pdf.setCreator('Lumen Layout');
    const fontCache = new Map(), imgCache = new Map(), sepCache = new Map();
    const toCmyk = !!opt.cmyk, spotsToProcess = !!opt.spotsToProcess;
    async function font(fk, fx = '', liga = true, otf = '') {
      const key = Fonts.faceKey(fk) + '|' + fx;
      let f = fontCache.get(key); if (f) return f;
      const features = { kern: false, liga }; String(otf || '').split(' ').filter(Boolean).forEach(t => { features[t] = true; });
      f = await pdf.embedFont(Fonts.bytesFor(fk), { subset: true, features }); fontCache.set(key, f); return f;
    }
    const styleFont = st => font(st.fk, st.fx, st.feat ? st.feat.liga : true, st.otf);
    async function image(img, cs) {
      const im = images[img]; if (!im) return null;
      const mime = (im.data.match(/^data:([^;]+)/) || [])[1] || '';
      if (toCmyk) {
        let r = imgCache.get(img + '@cmyk'); if (r) return r;
        if (!im.el || !im.el.complete) return null;
        r = cmykImage(pdf, im, 2400); imgCache.set(img + '@cmyk', r); return r;
      }
      const svgLike = !/jpe?g|png/.test(mime);
      const key = img + (svgLike ? '@' + Math.round(im.w * cs) : '');
      let r = imgCache.get(key); if (r) return r;
      if (/jpe?g/.test(mime)) r = await pdf.embedJpg(b64bytes(im.data));
      else if (/png/.test(mime)) r = await pdf.embedPng(b64bytes(im.data));
      else { const s = Math.min(4000 / Math.max(im.w * cs, im.h * cs), 300 / 72); r = await pdf.embedPng(await rasterize(im, im.w * cs * s, im.h * cs * s)); }
      imgCache.set(key, r); return r;
    }
    // Separation color space array for a spot ink (shared by all pages)
    function sepSpace(spot) {
      let ref = sepCache.get(spot.name); if (ref) return ref;
      const ctx = pdf.context, fn = ctx.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: spot.cmyk.map(v => +v.toFixed(4)), N: 1 });
      ref = ctx.register(ctx.obj([L.PDFName.of('Separation'), L.PDFName.of(spot.name.replace(/[^\x21-\x7e]/g, '_') || 'Spot'), L.PDFName.of('DeviceCMYK'), fn]));
      sepCache.set(spot.name, ref); return ref;
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
      const fontKeys = new Map(), gsKeys = new Map(), csKeys = new Map();
      const fontKey = f => { let k = fontKeys.get(f); if (!k) { k = pg.node.newFontDictionary(f.name, f.ref); fontKeys.set(f, k); } return k; };
      const gs = a => { a = Math.round(a * 1000) / 1000; let k = gsKeys.get(a); if (!k) { const ref = pdf.context.register(pdf.context.obj({ Type: 'ExtGState', ca: a, CA: a })); k = pg.node.newExtGState('GS', ref); gsKeys.set(a, k); } return k; };
      // overprint: /op (fill) or /OP (stroke) with the nonzero overprint mode
      const opKeys = {};
      const opGs = stroking => { const k = stroking ? 'S' : 'F'; if (!opKeys[k]) { const ref = pdf.context.register(pdf.context.obj({ Type: 'ExtGState', OP: !!stroking, op: !stroking, OPM: 1 })); opKeys[k] = pg.node.newExtGState('GS', ref); } return opKeys[k]; };
      const resDict = name => { const R = pg.node.normalizedEntries().Resources; let d = R.lookupMaybe(L.PDFName.of(name), L.PDFDict); if (!d) { d = pdf.context.obj({}); R.set(L.PDFName.of(name), d); } return d; };
      const csKey = spot => { let k = csKeys.get(spot.name); if (!k) { k = 'CS' + (csKeys.size + 1); resDict('ColorSpace').set(L.PDFName.of(k), sepSpace(spot)); csKeys.set(spot.name, k); } return k; };
      // color operators for fill / stroke
      const colorOps = (ref, stroking) => {
        const c = Color.parse(ref); if (c.kind === 'none') return [];
        if (c.kind === 'spot' && !spotsToProcess) { const k = csKey(c.spot); return [L.PDFOperator.of(stroking ? 'CS' : 'cs', [L.PDFName.of(k)]), L.PDFOperator.of(stroking ? 'SCN' : 'scn', [L.PDFNumber.of(+c.tint.toFixed(4))])]; }
        if (c.kind === 'cmyk' || c.kind === 'spot' || toCmyk) { const v = c.cmyk.map(x => +x.toFixed(4)); return [stroking ? setStrokingCmykColor(...v) : setFillingCmykColor(...v)]; }
        return [stroking ? setStrokingRgbColor(...c.rgb) : setFillingRgbColor(...c.rgb)];
      };
      const fillC = ref => colorOps(ref, false), strokeC = ref => colorOps(ref, true);
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
      // axial shading in RGB, CMYK or a spot Separation (+ luminosity soft mask when the stops are translucent)
      let shadeN = 0;
      const gradient = it => {
        const G = it.grad, [x0, y0, x1, y1] = Render.gradPts(it), ctx = pdf.context;
        const a = Color.parse(G.c0), b = Color.parse(G.c1);
        let space, C0, C1;
        if (a.kind === 'spot' && b.kind === 'spot' && a.spot.name === b.spot.name && !spotsToProcess) { space = sepSpace(a.spot); C0 = [a.tint]; C1 = [b.tint]; }
        else if (toCmyk || ((a.kind === 'cmyk' || a.kind === 'spot') && (b.kind === 'cmyk' || b.kind === 'spot'))) { space = 'DeviceCMYK'; C0 = a.cmyk || [0, 0, 0, 1]; C1 = b.cmyk || [0, 0, 0, 1]; }
        else { space = 'DeviceRGB'; C0 = a.rgb || [0, 0, 0]; C1 = b.rgb || [0, 0, 0]; }
        const sh = ctx.register(ctx.obj({ ShadingType: 2, ColorSpace: space, Coords: [x0, y0, x1, y1], Extend: [true, true], Function: { FunctionType: 2, Domain: [0, 1], C0, C1, N: 1 } }));
        const key = 'Sh' + (++shadeN); resDict('Shading').set(L.PDFName.of(key), sh);
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
      const textF = (f, p, size, color, track, x, y, str) => {
        if (!str) return;
        ops.push(beginText(), ...fillC(color), setFontAndSize(fontKey(f), size), setCharacterSpacing(track || 0),
          setTextMatrix(1, 0, p.synthItalic ? 0.21 : 0, -1, x, y), showText(f.encodeText(str)), endText());
      };
      const text = async (fk, size, color, track, x, y, str) => { if (str) textF(await font(fk), Fonts.parse(fk), size, color, track, x, y, str); };
      const tableRows = async (t, rows, rhs) => {
        const d = Tables.display(t, rows, rhs);
        for (const f of d.fills) ops.push(...fillC(f.color), L.rectangle(f.x, f.y, f.w, f.h), fill());
        for (const x of d.texts) await text(x.fk, x.size, x.color, 0, x.x, x.y, x.text);
        if (t.bw > 0 && d.borders.length) { ops.push(...strokeC(t.bcolor), setLineWidth(t.bw)); for (const [x0, y0, x1, y1] of d.borders) ops.push(moveTo(x0, y0), lineTo(x1, y1)); ops.push(stroke()); }
      };
      const graphic = async (o, x, y, env) => { await drawItem({ ...o.item, x, y, rot: 0, opacity: 1, id: 'inline', layer: null }, env, 1, true); };
      const lines = async (lns, env) => {
        for (const ln of lns) {
          if (ln.block) {
            const b = ln.block;
            if (b.kind === 'graphic') await graphic(b.obj, b.x, b.y, env);
            else { ops.push(q(), cm(1, 0, 0, 1, b.x, b.y)); await tableRows(b.obj, b.rows, b.rh); ops.push(Q()); }
            continue;
          }
          if (ln.drop) await text(ln.drop.st.fk, ln.drop.st.size, ln.drop.st.color, 0, ln.drop.x, ln.drop.y, ln.drop.text);
          for (const r of ln.runs) {
            const st = r.st, y = ln.y - st.shift;
            const plain = r.marker || r.leader || r.hy;
            const f = plain ? await font(st.fk) : await styleFont(st), p = Fonts.parse(st.fk);
            if (st.track && r.parts && r.parts.length > 1 && !plain) for (let k = 0; k < r.parts.length; k++) textF(f, p, st.size, st.color, 0, r.px[k], y, r.parts[k]);
            else textF(f, p, st.size, st.color, 0, r.x, y, r.text);
            if ((st.under || st.strike) && !plain) ops.push(...fillC(st.color), L.rectangle(r.x, st.under ? y + st.size * 0.12 : y - st.size * 0.28, r.end - r.x, Math.max(0.4, st.size * 0.06)), fill());
          }
          if (ln.objs) for (const o of ln.objs) await graphic(o.o, o.x, ln.y - o.o.item.h - (o.o.shift || 0), env);
        }
      };
      const notes = async blocks => {
        for (const nb of blocks || []) {
          const st = nb.st; if (!st) continue;
          ops.push(...fillC(st.color), L.rectangle(nb.x, nb.y + 2, Math.min(72, nb.w / 3), 0.5), fill());
          let y = nb.y + Layout.FN_SEP; const asc = st.m.asc * st.size;
          for (const n of nb.notes) {
            if (!n.cont) await text(st.fk, st.size, st.color, 0, nb.x, y + asc, String(n.num));
            for (let k = 0; k < n.lines.length; k++) await text(st.fk, st.size, st.color, 0, nb.x + n.ind, y + asc + k * st.lead, n.lines[k].text);
            y += n.h;
          }
        }
      };
      const drawItem = async (it, env, alpha, inline) => {
        if (it.hidden) return;
        if (it.type === 'group') { for (const c of it.children) await drawItem(c, env, alpha * (it.opacity ?? 1)); return; }
        if (!inline && !engine.layerVisible(it)) return;
        const a = alpha * (it.opacity ?? 1);
        ops.push(q());
        if (a < 1) ops.push(setGraphicsState(gs(a)));
        if (it.rot) { const r = it.rot * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); ops.push(cm(1, 0, 0, 1, it.x + it.w / 2, it.y + it.h / 2), cm(c, s, -s, c, 0, 0), cm(1, 0, 0, 1, -it.w / 2, -it.h / 2)); }
        else ops.push(cm(1, 0, 0, 1, it.x, it.y));
        if (it.type !== 'line' && (it.grad || it.fill)) {
          if (it.opFill) ops.push(q(), setGraphicsState(opGs(false)));
          if (it.grad) gradient(it); else { path(it); ops.push(...fillC(it.fill), fill()); }
          if (it.opFill) ops.push(Q());
        }
        if (it.type === 'image' && it.img && images[it.img]) {
          const img = await image(it.img, it.cs), im = images[it.img];
          if (img) {
            const xo = pg.node.newXObject('Im', img.ref);
            ops.push(q()); path(it); ops.push(clip(), endPath());
            ops.push(cm(im.w * it.cs, 0, 0, -im.h * it.cs, it.cx, it.cy + im.h * it.cs), drawObject(xo), Q());
          }
        }
        if (it.type === 'table') await tableRows(it, it.rowH.map((_, r) => r), it.rowH);
        if (it.type === 'text') {
          const Lay = engine.frameLayout(it, env.label);
          if (Lay) { await lines(Lay.lines, env); await notes(Lay.notes); }
        }
        if (it.stroke && it.sw > 0) {
          if (it.opStroke) ops.push(setGraphicsState(opGs(true)));
          path(it); ops.push(...strokeC(it.stroke), setLineWidth(it.sw));
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
        // registration color: all process plates (and every spot plate)
        ops.push(q(), toCmyk || doc.cmyk ? setStrokingCmykColor(1, 1, 1, 1) : setStrokingRgbColor(0, 0, 0), setLineWidth(0.25));
        const x0 = mk, y0 = mk, x1 = mk + doc.w, y1 = mk + doc.h;
        for (const [x, sx] of [[x0, -1], [x1, 1]]) for (const [y, sy] of [[y0, -1], [y1, 1]]) {
          ops.push(moveTo(x + sx * off, y), lineTo(x + sx * (off + len), y), moveTo(x, y + sy * off), lineTo(x, y + sy * (off + len)));
        }
        ops.push(stroke(), Q());
        // page info slug
        const f = await font(Fonts.resolve('Montserrat', 400, false));
        ops.push(beginText(), toCmyk || doc.cmyk ? setFillingCmykColor(0, 0, 0, 1) : setFillingRgbColor(0, 0, 0), setFontAndSize(fontKey(f), 6), setTextMatrix(1, 0, 0, 1, mk + 14, 8),
          showText(f.encodeText(`${name || 'Untitled'}  ·  Page ${engine.label(pi)}  ·  ${new Date().toISOString().slice(0, 10)}`)), endText());
      }
      pg.pushOperators(...ops);
    }
    return await pdf.save();
  }

  window.PdfOut = { exportPDF, hexRgb };
})();
