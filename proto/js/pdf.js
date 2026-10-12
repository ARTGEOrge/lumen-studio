'use strict';
/* Lumen Proto — true vector PDF export. Shapes, booleans, paths and icons become PDF paths; gradients become
   PDF shadings; text stays live text in the bundled Inter (embedded as a subset TrueType/CID font, any Unicode the
   font covers) or a standard PDF font for system fonts; vector masks become clip paths, alpha / luminance masks
   become PDF soft masks. Only effects PDF cannot express (blurred shadows, layer / background blur) and image fills
   are embedded as images. */
(function () {
  const LP = window.LP, M = LP.M, IO = window.IO;
  const f3 = v => { v = +(+v).toFixed(3); return Object.is(v, -0) ? 0 : v; };
  const WIN = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
  const winAnsi = s => { let o = ''; for (const ch of s) { const c = ch.codePointAt(0); let b = c < 0x80 || (c >= 0xA0 && c <= 0xFF) ? c : WIN[c]; if (b == null) b = 0x3F; if (b === 0x28 || b === 0x29 || b === 0x5C) o += '\\'; o += String.fromCharCode(b); } return o; };
  const mctx = document.createElement('canvas').getContext('2d');
  // design font → standard PDF font family + a metric-compatible system font to measure it
  function stdFont(st) {
    const f = String(st.font || '').toLowerCase();
    const fam = /georgia|times|cambria|serif/.test(f) && !/sans/.test(f) ? 'T' : /consolas|courier|mono/.test(f) ? 'C' : 'H';
    const b = (st.weight || 400) >= 600, i = !!st.italic;
    const name = fam === 'H' ? 'Helvetica' + (b || i ? '-' + (b ? 'Bold' : '') + (i ? 'Oblique' : '') : '')
      : fam === 'T' ? (b ? (i ? 'Times-BoldItalic' : 'Times-Bold') : (i ? 'Times-Italic' : 'Times-Roman'))
        : 'Courier' + (b || i ? '-' + (b ? 'Bold' : '') + (i ? 'Oblique' : '') : '');
    const meas = `${i ? 'italic ' : ''}${b ? 700 : 400} 100px ${fam === 'H' ? 'Arial, Helvetica' : fam === 'T' ? '"Times New Roman", Times' : '"Courier New", Courier'}, sans-serif`;
    return { name, meas };
  }

  // bundled fonts that can be embedded (Inter static TTFs converted from the OFL release)
  const INTER = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
  const interFile = st => { const w = Math.max(100, Math.min(900, Math.round((st.weight || 400) / 100) * 100)); const n = INTER[w]; return 'Inter-' + (st.italic ? (n === 'Regular' ? 'Italic' : n + 'Italic') : n); };
  const ttfCache = {};
  IO.loadPdfFont = async file => { if (!ttfCache[file]) ttfCache[file] = fetch('vendor/inter-ttf/' + file + '.ttf').then(r => { if (!r.ok) throw new Error('missing font ' + file); return r.arrayBuffer(); }).then(b => LP.TTF(b)); return ttfCache[file]; };
  const isWin = t => { for (const ch of t) { const c = ch.codePointAt(0); if (!(c < 0x80 || (c >= 0xA0 && c <= 0xFF) || WIN[c] != null)) return false; } return true; };
  const embedFor = st => /inter/i.test(String(st.font || 'Inter')) || !st.font;
  // which embedded font files a set of nodes needs
  function neededFonts(scene, nodes) {
    const need = new Set();
    const walk = n => {
      if (!scene.isVis(n)) return;
      const v = scene.view(n);
      if ((v.mainType || n.type) === 'text') {
        const L = LP.textLines(mctx, scene, n), base = LP.textProps(v, scene.doc);
        const add = (st, t) => { if (embedFor(st) || !isWin(t)) need.add(interFile(st)); };
        if (L.rich) L.lines.forEach(l => l.pieces.forEach(p => add(p.st, p.t))); else L.lines.forEach(l => add(base, l.t));
      }
      scene.kids(n).forEach(walk);
    };
    nodes.forEach(walk);
    return need;
  }
  IO.pdfVector = async (nodes) => {
    const need = neededFonts(ED.scene, nodes), loaded = {};
    for (const f of need) { try { loaded[f] = await IO.loadPdfFont(f); } catch (e) { console.warn(e); } }
    return IO.pdfVectorSync(nodes, loaded);
  };
  IO.pdfVectorSync = (nodes, loaded = {}) => {
    const scene = ED.scene, doc = ED.doc;
    const enc = new TextEncoder();
    const objs = []; // index = obj number - 1 ; each = Uint8Array[] parts
    const alloc = () => { objs.push(null); return objs.length; };
    const setObj = (id, parts) => { objs[id - 1] = parts.map(p => typeof p === 'string' ? latin1(p) : p); };
    const latin1 = s => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; };
    const streamObj = (dict, data) => { const id = alloc(); const z = window.fflate.zlibSync(data, { level: 6 }); setObj(id, [`<< ${dict} /Filter /FlateDecode /Length ${z.length} >>\nstream\n`, z, '\nendstream']); return id; };
    const catalog = alloc(), pagesId = alloc();
    const fonts = {}; let fontN = 0;
    const fontRes = name => { if (!fonts[name]) { const id = alloc(); setObj(id, [`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`]); fonts[name] = { id, key: 'F' + (++fontN) }; } return fonts[name].key; };
    const pageIds = [];
    // embedded fonts: one Type0/CIDFontType2 per file, objects written once every page is done (subset of used glyphs)
    const emb = {}; let embN = 0;
    const embRes = file => { if (!emb[file]) emb[file] = { id: alloc(), key: 'E' + (++embN), ttf: loaded[file], used: new Map() }; return emb[file]; };
    nodes.forEach(node => {
      const b = LP.aabb(node), W = Math.max(1, b.w), H = Math.max(1, b.h), pw = f3(W * .75), ph = f3(H * .75);
      const res = { gs: {}, sh: {}, xo: {}, fonts: new Set() }; let gsN = 0, shN = 0, xoN = 0;
      const resId = alloc();
      let out = [];
      const op = s => out.push(s);
      const W2 = []; // world matrices (page root space) of nodes being emitted
      doc._mode = LP.modeOf(scene, node);
      const gs = (ca, CA, bm) => { const k = `${f3(ca)}|${f3(CA)}|${bm || ''}`; if (!res.gs[k]) { const id = alloc(); setObj(id, [`<< /Type /ExtGState /ca ${f3(ca)} /CA ${f3(CA)}${bm ? ` /BM /${bm}` : ''} >>`]); res.gs[k] = { id, key: 'G' + (++gsN) }; } return res.gs[k].key; };
      const rgb = c => { const p = LP.parseColor(c); return [p[0] / 255, p[1] / 255, p[2] / 255].map(f3).join(' '); };
      const pathOps = d => { let s = ''; LP.parsePath(d).forEach(g => { if (g.c === 'M') s += `${f3(g.p[0])} ${f3(g.p[1])} m\n`; else if (g.c === 'L') s += `${f3(g.p[0])} ${f3(g.p[1])} l\n`; else if (g.c === 'C') s += g.p.map(f3).join(' ') + ' c\n'; else if (g.c === 'Z') s += 'h\n'; }); return s; };
      const cm = m => `${m.map(f3).join(' ')} cm\n`;
      // image XObject from a canvas (with soft mask when it has transparency)
      const imageX = (c) => {
        const w = c.width, h = c.height, px = c.getContext('2d').getImageData(0, 0, w, h).data;
        const rgbB = new Uint8Array(w * h * 3), a = new Uint8Array(w * h); let alpha = false;
        for (let i = 0, j = 0, k = 0; i < px.length; i += 4) { rgbB[j++] = px[i]; rgbB[j++] = px[i + 1]; rgbB[j++] = px[i + 2]; a[k++] = px[i + 3]; if (px[i + 3] < 255) alpha = true; }
        const sm = alpha ? streamObj(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8`, a) : null;
        const id = streamObj(`/Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8${sm ? ` /SMask ${sm} 0 R` : ''}`, rgbB);
        const key = 'X' + (++xoN); res.xo[key] = id; return key;
      };
      // draw image key into the box (x,y,w,h) of the current (y-down) space
      const placeImage = (key, x, y, w, h) => op(`q ${f3(w)} 0 0 ${f3(-h)} ${f3(x)} ${f3(y + h)} cm /${key} Do Q\n`);
      // gradient shading (axial / radial) with stitched colour stops
      const shading = (f, w, h) => {
        const stops = (f.stops || []).slice().sort((a, c) => a.p - c.p); if (!stops.length) return null;
        if (stops.length === 1) stops.push(Object.assign({}, stops[0], { p: 1 }));
        const fns = [];
        for (let i = 1; i < stops.length; i++) fns.push(`<< /FunctionType 2 /Domain [0 1] /C0 [${rgb(stops[i - 1].color)}] /C1 [${rgb(stops[i].color)}] /N 1 >>`);
        const bounds = stops.slice(1, -1).map(s => f3(Math.max(0, Math.min(1, s.p))));
        const fn = `<< /FunctionType 3 /Domain [0 1] /Functions [${fns.join(' ')}] /Bounds [${bounds.join(' ')}] /Encode [${fns.map(() => '0 1').join(' ')}] >>`;
        const d0 = f3(Math.max(0, Math.min(1, stops[0].p))), d1 = f3(Math.max(0, Math.min(1, stops[stops.length - 1].p)));
        let dict;
        if (f.type === 'linear') { const g = LP.gradPoints(f.angle, w, h); const x0 = g[0] + (g[2] - g[0]) * d0, y0 = g[1] + (g[3] - g[1]) * d0, x1 = g[0] + (g[2] - g[0]) * d1, y1 = g[1] + (g[3] - g[1]) * d1; dict = `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${[x0, y0, x1, y1].map(f3).join(' ')}] /Function ${fn} /Domain [${d0} ${d1}] /Extend [true true] >>`; }
        else dict = `<< /ShadingType 3 /ColorSpace /DeviceRGB /Coords [0 0 ${d0} 0 0 ${d1 || 1}] /Function ${fn} /Domain [${d0} ${d1 || 1}] /Extend [true true] >>`;
        const id = alloc(); setObj(id, [dict]); const key = 'S' + (++shN); res.sh[key] = id; return key;
      };
      // raster effect (drop / inner shadow, layer blur) for a shape path
      const OFF = 5000;
      const shadowImage = (s, path, w, h, inner) => {
        const k = 2, m = Math.ceil(Math.abs(s.x || 0) + Math.abs(s.y || 0) + (s.blur || 0) * 1.5 + Math.abs(s.spread || 0) + 2);
        const cw = Math.min(4000, Math.ceil((w + 2 * m) * k)), ch = Math.min(4000, Math.ceil((h + 2 * m) * k));
        const c = document.createElement('canvas'); c.width = Math.max(1, cw); c.height = Math.max(1, ch);
        const x = c.getContext('2d'); x.scale(k, k); x.translate(m, m);
        x.shadowColor = LP.rgba(s.color || '#000', s.a ?? .25); x.shadowBlur = (s.blur || 0) * k; x.shadowOffsetX = ((s.x || 0) + OFF) * k; x.shadowOffsetY = (s.y || 0) * k;
        if (inner) { x.save(); x.clip(path); const ring = new Path2D(); ring.rect(-w - 1000 - OFF, -h - 1000, w * 3 + 2000, h * 3 + 2000); const t = new Path2D(); t.addPath(path, new DOMMatrix([1, 0, 0, 1, -OFF, 0])); ring.addPath(t); x.fillStyle = '#000'; x.fill(ring, 'evenodd'); x.restore(); }
        else { x.translate(-OFF, 0); x.fillStyle = '#000'; x.fill(path, path._rule || 'nonzero'); }
        return { key: imageX(c), x: -m, y: -m, w: c.width / k, h: c.height / k };
      };
      const fillOps = (f, d, w, h, alpha, rule, path) => {
        if (f.on === false) return;
        const fr = rule === 'evenodd' ? 'f*' : 'f';
        if (f.type === 'solid') { const c = LP.fillColor(f, doc); const a = c.a * LP.parseColor(c.color)[3] * alpha; if (a <= 0) return; op(`q /${gs(a, a)} gs ${rgb(c.color)} rg\n${pathOps(d)}${fr} Q\n`); return; }
        if (f.type === 'linear' || f.type === 'radial') {
          const key = shading(f, w, h); if (!key) return; const a = (f.a ?? 1) * alpha;
          op(`q /${gs(a, a)} gs\n${pathOps(d)}W${rule === 'evenodd' ? '*' : ''} n\n`);
          if (f.type === 'radial') op(cm([w / 2 || 1, 0, 0, h / 2 || 1, w * (f.cx ?? .5), h * (f.cy ?? .5)]));
          op(`/${key} sh Q\n`); return;
        }
        if (f.type === 'image') {
          const k = 2, c = document.createElement('canvas'); c.width = Math.max(1, Math.min(4000, Math.round(w * k))); c.height = Math.max(1, Math.min(4000, Math.round(h * k)));
          const x = c.getContext('2d'); x.scale(c.width / w, c.height / h); const r = new Path2D(); r.rect(0, 0, w, h); LP.fillWith(x, Object.assign({}, f, { a: 1 }), w, h, doc, r);
          const key = imageX(c), a = (f.a ?? 1) * alpha;
          op(`q /${gs(a, a)} gs\n${pathOps(d)}W${rule === 'evenodd' ? '*' : ''} n\n`); placeImage(key, 0, 0, w, h); op('Q\n');
        }
      };
      const strokeOps = (v, d, w, h, alpha, open, shapeGrow) => {
        (v.strokes || []).forEach(s => {
          if (s.on === false || !(s.w > 0)) return;
          const c = LP.fillColor(s, doc), a = c.a * alpha;
          const al = open ? 'center' : s.align || 'inside';
          const style = `/${gs(a, a)} gs ${rgb(c.color)} RG ${({ butt: 0, round: 1, square: 2 })[s.cap || 'butt'] ?? 0} J ${({ miter: 0, round: 1, bevel: 2 })[s.join || 'miter'] ?? 0} j${s.dash && s.dash[0] ? ` [${s.dash.map(f3).join(' ')}] 0 d` : ''}`;
          if (al === 'center') op(`q ${style} ${f3(s.w)} w\n${pathOps(d)}S Q\n`);
          else if (al === 'inside') op(`q ${style} ${f3(s.w * 2)} w\n${pathOps(d)}W n\n${pathOps(d)}S Q\n`);
          else op(`q ${style} ${f3(s.w * 2)} w\n${f3(-1e4)} ${f3(-1e4)} ${f3(2e4 + w)} ${f3(2e4 + h)} re\n${pathOps(d)}W* n\n${pathOps(d)}S Q\n`);
        });
      };
      const textOps = (n, v, alpha) => {
        const L = LP.textLines(mctx, scene, n);
        const base = LP.textProps(v, doc);
        const f = (v.fills || []).find(x => x.on !== false);
        const fc = !f ? { color: '#000', a: 1 } : f.type === 'solid' ? LP.fillColor(f, doc) : { color: (f.stops && f.stops[0] && f.stops[0].color) || '#000', a: f.a ?? 1 };
        const pieces = [];
        if (L.rich) L.lines.forEach(l => { let x = l.x; l.pieces.forEach(p => { pieces.push({ t: p.t, x, y: l.y, w: p.w, st: p.st, color: p.st.color ? { color: p.st.color, a: p.st.a ?? 1 } : fc }); x += p.w; }); });
        else L.lines.forEach(l => { const t = LP.caseText(l.t, v.tcase); mctx.font = LP.fontString(base); try { mctx.letterSpacing = (base.ls || 0) + 'px'; } catch (e) { } pieces.push({ t, x: l.x, y: l.y, w: mctx.measureText(t).width, st: Object.assign({}, base, { deco: v.deco }), color: fc }); });
        pieces.forEach(p => {
          if (!p.t) return;
          const ls = p.st.ls || 0, size = p.st.size || 16, a = p.color.a * alpha, chars = [...p.t];
          const file = (embedFor(p.st) || !isWin(p.t)) ? interFile(p.st) : null;
          let key, str, natural;
          if (file && loaded[file]) {
            const E = embRes(file), T = E.ttf; key = E.key; str = '<';
            let advs = 0; chars.forEach(ch => { const cp = ch.codePointAt(0), g = T.gid(cp); E.used.set(g, cp); advs += T.adv(g); str += g.toString(16).padStart(4, '0'); });
            str += '>'; natural = advs / T.unitsPerEm * size + ls * chars.length;
          } else {
            const sf = stdFont(p.st); key = fontRes(sf.name); str = `(${winAnsi(p.t)})`;
            mctx.font = sf.meas; try { mctx.letterSpacing = '0px'; } catch (e) { }
            natural = mctx.measureText(p.t).width / 100 * size + ls * chars.length;
          }
          const tz = natural > 0 ? Math.max(20, Math.min(400, p.w / natural * 100)) : 100;
          op(`q /${gs(a, a)} gs ${rgb(p.color.color)} rg BT /${key} ${f3(size)} Tf ${f3(tz)} Tz ${f3(ls)} Tc 1 0 0 -1 ${f3(p.x)} ${f3(p.y)} Tm ${str} Tj ET\n`);
          if (p.st.deco === 'underline' || p.st.deco === 'strike') { const th = Math.max(1, size / 14), yy = p.st.deco === 'underline' ? p.y + size * .12 : p.y - size * .3; op(`${f3(p.x)} ${f3(yy)} ${f3(p.w)} ${f3(th)} re f\n`); }
          op('Q\n');
        });
      };
      const BM = { multiply: 'Multiply', screen: 'Screen', overlay: 'Overlay', darken: 'Darken', lighten: 'Lighten', 'color-dodge': 'ColorDodge', 'color-burn': 'ColorBurn', 'hard-light': 'HardLight', 'soft-light': 'SoftLight', difference: 'Difference', exclusion: 'Exclusion', hue: 'Hue', saturation: 'Saturation', color: 'Color', luminosity: 'Luminosity' };
      const localD = (n, v) => { const t = v.mainType || n.type; if (t === 'group' || t === 'text' || t === 'icon') return null; const d = LP.outlineD(scene, n); return d ? LP.transformD(d, M.inv(LP.localMatrix(n))) : ''; };
      const emitKids = (kids, alpha) => {
        let open = 0;
        kids.forEach(k => {
          if (k.mask) {
            if (!scene.isVis(k)) return; op('q\n'); open++;
            const kind = LP.maskKind(scene, k);
            if (kind === 'vector') { const d = LP.outlineD(scene, k); if (d) op(pathOps(d) + 'W n\n'); return; }
            // soft mask: the mask layer is painted into a transparency-group form; its alpha / luminosity masks what follows
            const saved = out; out = []; emit(k, 1); const form = out.join(''); out = saved;
            const fid = streamObj(`/Type /XObject /Subtype /Form /BBox [-100000 -100000 100000 100000] /Group << /S /Transparency /CS /DeviceRGB >> /Resources ${resId} 0 R`, latin1(form));
            const gid = alloc(); setObj(gid, [`<< /Type /ExtGState /SMask << /Type /Mask /S /${kind === 'luminance' ? 'Luminosity /BC [0 0 0]' : 'Alpha'} /G ${fid} 0 R >> >>`]);
            const key = 'G' + (++gsN); res.gs['smask' + gid] = { id: gid, key }; op(`/${key} gs\n`);
            return;
          }
          emit(k, alpha);
        });
        op('Q\n'.repeat(open));
      };
      const emit = (n, alpha) => {
        if (!scene.isVis(n)) return;
        const v = scene.view(n), t = v.mainType || n.type, w = n.w, h = n.h;
        const a = alpha * (v.opacity ?? 1); if (a <= .001) return;
        op('q\n'); op(cm(n === node ? M.mul(M.tr(-b.x, -b.y), LP.localMatrix(n)) : LP.localMatrix(n)));
        const wm = M.mul(W2.length ? W2[W2.length - 1] : M.id(), LP.localMatrix(n)); W2.push(wm);
        const done = () => { W2.pop(); };
        if (v.blend && BM[v.blend]) op(`/${gs(1, 1, BM[v.blend])} gs\n`);
        const lblur = v.blur && v.blur.on !== false && v.blur.type === 'layer' && v.blur.r > 0;
        if (lblur) { // not expressible in PDF: embed this layer as an image
          const m = v.blur.r * 3, c = LP.renderNodeCanvas(scene, Object.assign(Object.create(Object.getPrototypeOf(n)), n, { x: 0, y: 0, r: 0 }), 2, { pad: m });
          const key = imageX(c); op(`/${gs(a, a)} gs\n`); placeImage(key, -m, -m, w + 2 * m, h + 2 * m); op('Q\n'); done(); return;
        }
        if (t === 'text') { textOps(n, v, a); op('Q\n'); done(); return; }
        if (t === 'icon') {
          const d = (window.LP_ICONS || {})[v.icon] || ''; const c = LP.parseColor(v.color || '#000');
          op(`q /${gs(a * c[3], a * c[3])} gs ${rgb(v.color || '#000')} RG ${f3(v.sw || 2)} w 1 J 1 j\n${cm([w / 24, 0, 0, h / 24, 0, 0])}${pathOps(d)}S Q\nQ\n`); done(); return;
        }
        const d = localD(n, v);
        const rule = v.rule === 'evenodd' ? 'evenodd' : 'nonzero';
        const p2d = d ? new Path2D(d) : null; if (p2d) p2d._rule = rule;
        if (d) {
          (v.shadows || []).forEach(s => { if (s.on === false || s.inner) return; const im = shadowImage(s, p2d, w, h, false); op(`q /${gs(a, a)} gs\n`); placeImage(im.key, im.x, im.y, im.w, im.h); op('Q\n'); });
          const bgb = v.blur && v.blur.on !== false && v.blur.type === 'bg' && v.blur.r > 0;
          if (bgb) { // background blur: what is painted behind the layer, blurred and clipped to its shape (raster)
            const k2 = 2, bd = LP.renderNodeCanvas(scene, node, k2, { stopAt: { node: n } });
            const c = document.createElement('canvas'); c.width = Math.max(1, Math.min(4000, Math.ceil(w * k2))); c.height = Math.max(1, Math.min(4000, Math.ceil(h * k2)));
            const x = c.getContext('2d'); const bb = LP.aabb(node);
            const T = M.mul([k2, 0, 0, k2, 0, 0], M.mul(M.inv(wm), M.mul(M.tr(bb.x, bb.y), [1 / k2, 0, 0, 1 / k2, 0, 0])));
            x.filter = `blur(${v.blur.r * k2}px)`; x.setTransform(T[0], T[1], T[2], T[3], T[4], T[5]); x.drawImage(bd, 0, 0);
            const key = imageX(c); op(`q /${gs(a, a)} gs\n${pathOps(d)}W${rule === 'evenodd' ? '*' : ''} n\n`); placeImage(key, 0, 0, w, h); op('Q\n');
          }
          (v.fills || []).forEach(f => fillOps(f, d, w, h, a, rule));
        }
        const kids = t === 'bool' ? [] : scene.kids(n);
        if (kids.length) {
          op('q\n');
          if (v.clip && t !== 'group' && d) op(`${pathOps(d)}W n\n`);
          emitKids(kids, a);
          op('Q\n');
        }
        if (d) {
          (v.shadows || []).forEach(s => { if (s.on === false || !s.inner) return; const im = shadowImage(s, p2d, w, h, true); op(`q /${gs(a, a)} gs\n`); placeImage(im.key, im.x, im.y, im.w, im.h); op('Q\n'); });
          const open = t === 'path' && (v.d ? !v.closed : !LP.contoursOf(v).every(c => c.closed));
          strokeOps(v, d, w, h, a, open || t === 'path' || t === 'bool');
        }
        op('Q\n'); done();
      };
      // page: y-down user space in CSS px
      op(`0.75 0 0 -0.75 0 ${ph} cm\n`);
      // white page background
      op(`1 1 1 rg 0 0 ${f3(W)} ${f3(H)} re f\n`);
      emit(node, 1);
      const contents = streamObj('', latin1(out.join('')));
      const pid = alloc();
      const dict = (o, pre) => Object.entries(o).map(([k, v]) => `/${(v.key || k)} ${(v.id || v)} 0 R`).join(' ');
      const gsD = Object.values(res.gs).map(g => `/${g.key} ${g.id} 0 R`).join(' ');
      const fontD = Object.values(fonts).map(f => `/${f.key} ${f.id} 0 R`).join(' ');
      void dict;
      const embD = Object.values(emb).map(f => `/${f.key} ${f.id} 0 R`).join(' ');
      setObj(resId, [`<< /ProcSet [/PDF /Text /ImageB /ImageC] /ExtGState << ${gsD} >> /Font << ${fontD} ${embD} >> /Shading << ${Object.entries(res.sh).map(([k, id]) => `/${k} ${id} 0 R`).join(' ')} >> /XObject << ${Object.entries(res.xo).map(([k, id]) => `/${k} ${id} 0 R`).join(' ')} >> >>`]);
      setObj(pid, [`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pw} ${ph}] /Contents ${contents} 0 R /Resources ${resId} 0 R >>`]);
      pageIds.push(pid);
    });
    // embedded font subsets
    Object.entries(emb).forEach(([file, E], i) => {
      const T = E.ttf, sc = 1000 / T.unitsPerEm, tag = 'LPRT' + String.fromCharCode(65 + i % 26) + String.fromCharCode(65 + Math.floor(i / 26) % 26), name = tag + '+' + T.name;
      const sub = T.subset([...E.used.keys()]), ff = streamObj(`/Length1 ${sub.length}`, sub);
      const fd = alloc(); setObj(fd, [`<< /Type /FontDescriptor /FontName /${name} /Flags ${32 + (T.italicAngle ? 64 : 0)} /FontBBox [${T.bbox.map(v => Math.round(v * sc)).join(' ')}] /ItalicAngle ${f3(T.italicAngle)} /Ascent ${Math.round(T.ascent * sc)} /Descent ${Math.round(T.descent * sc)} /CapHeight ${Math.round(T.capHeight * sc)} /StemV 80 /FontFile2 ${ff} 0 R >>`]);
      const gids = [...E.used.keys()].sort((a, b2) => a - b2);
      const wArr = gids.map(g => `${g} [${Math.round(T.adv(g) * sc)}]`).join(' ');
      const cid = alloc(); setObj(cid, [`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${fd} 0 R /DW ${Math.round(T.adv(0) * sc)} /W [${wArr}] /CIDToGIDMap /Identity >>`]);
      const hex4 = n => n.toString(16).padStart(4, '0').toUpperCase(), u16hex = cp => cp > 0xFFFF ? hex4(0xD800 + ((cp - 0x10000) >> 10)) + hex4(0xDC00 + ((cp - 0x10000) & 0x3FF)) : hex4(cp);
      let cmap = '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n';
      for (let k = 0; k < gids.length; k += 100) { const ch = gids.slice(k, k + 100); cmap += `${ch.length} beginbfchar\n` + ch.map(g => `<${hex4(g)}> <${u16hex(E.used.get(g))}>`).join('\n') + '\nendbfchar\n'; }
      cmap += 'endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend';
      const tu = streamObj('', latin1(cmap));
      setObj(E.id, [`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tu} 0 R >>`]);
    });
    setObj(catalog, [`<< /Type /Catalog /Pages ${pagesId} 0 R >>`]);
    setObj(pagesId, [`<< /Type /Pages /Kids [${pageIds.map(i => i + ' 0 R').join(' ')}] /Count ${pageIds.length} >>`]);
    // assemble
    const parts = [latin1('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')]; let len = parts[0].length; const offs = [];
    objs.forEach((o, i) => { offs[i] = len; const head = latin1(`${i + 1} 0 obj\n`), tail = latin1('\nendobj\n'); [head, ...(o || [latin1('null')]), tail].forEach(p => { parts.push(p); len += p.length; }); });
    let x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`; offs.forEach(o => { x += String(o).padStart(10, '0') + ' 00000 n \n'; });
    const xref = len; parts.push(latin1(x + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Producer (Lumen Proto) >>\nstartxref\n${xref}\n%%EOF\n`));
    const total = parts.reduce((s, p) => s + p.length, 0), outB = new Uint8Array(total); let o = 0; parts.forEach(p => { outB.set(p, o); o += p.length; });
    return outB;
  };
  // vector PDF is the default PDF export (raster kept as IO.pdfRaster)
  IO.pdfRaster = IO.pdfBytes;
  IO.pdfBytes = (nodes) => IO.pdfVector(nodes); // async (fonts are loaded first)
})();
