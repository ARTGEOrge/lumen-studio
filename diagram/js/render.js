'use strict';
/* Lumen Diagram — renderer. Every cell becomes a display list of primitives in world coordinates:
     {k:'path', d, fill, fill2, stroke, sw, dash, op}
     {k:'text', lines:[{t,x,y,w,b}], size, fam, bold, italic, underline, color, anchor, angle, op}
     {k:'image', x, y, w, h, href, op}
   The same list is turned into SVG (screen, SVG/PNG export) and into PDF drawing calls, so all outputs match. */
(function (root) {
  const isNode = typeof module !== 'undefined' && module.exports;
  const G = isNode ? require('./geom.js') : root.DiaGeom;
  const S = isNode ? require('./shapes.js') : root.DiaShapes;
  const M = isNode ? require('./model.js') : root.DiaModel;
  const R = isNode ? require('./route.js') : root.DiaRoute;
  const MT = isNode ? require('./metrics.js') : root.DiaMetrics;

  const FAMILY = { sans: 'Helvetica, Arial, sans-serif', serif: '"Times New Roman", Times, serif', mono: '"Courier New", Courier, monospace' };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  // strip characters that are not allowed in XML
  const xmlSafe = s => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');
  const measure = (t, size, fam, bold, italic) => MT.measure(t, size, fam, bold, italic);

  /* ---------- text layout ---------- */
  function wrap(text, maxW, size, fam, bold, italic, firstBold) {
    const out = []; const paras = String(text).split('\n');
    paras.forEach((para, pi) => {
      const b = bold || (firstBold && pi === 0);
      if (!para) { out.push({ t: '', w: 0, b }); return; }
      const words = para.split(/(\s+)/); let line = '';
      const push = l => { const t = l.replace(/\s+$/, ''); out.push({ t, w: measure(t, size, fam, b, italic), b }); };
      for (const w of words) {
        if (!w) continue;
        const test = line + w;
        if (maxW > 0 && line && measure(test.replace(/\s+$/, ''), size, fam, b, italic) > maxW) {
          push(line); line = /^\s+$/.test(w) ? '' : w;
        } else line = test;
        // break very long words
        while (maxW > 0 && measure(line, size, fam, b, italic) > maxW && line.length > 1) {
          let k = line.length - 1; while (k > 1 && measure(line.slice(0, k), size, fam, b, italic) > maxW) k--;
          push(line.slice(0, k)); line = line.slice(k);
        }
      }
      push(line);
    });
    return out;
  }
  // lay out text inside a local box of shape c (box in local coords), returning a text prim in world coords
  function textPrim(text, box, st, o = {}) {
    const size = st.fontSize || 12, lh = size * 1.22, fam = FAMILY[st.font] ? st.font : 'sans';
    const rot90 = box.rot === -90 || box.rot === 90;
    const bw = rot90 ? box.h : box.w, bh = rot90 ? box.w : box.h;
    const lines = wrap(text, st.wrap === false ? 0 : Math.max(8, bw - 4), size, fam, st.bold, st.italic, o.firstBold);
    const align = box.align || st.align || 'center', valign = box.valign || st.valign || 'middle';
    const H = lines.length * lh;
    let top = valign === 'top' ? 2 : valign === 'bottom' ? bh - H - 2 : (bh - H) / 2;
    const ax = align === 'left' ? 2 : align === 'right' ? bw - 2 : bw / 2;
    const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
    // local (box-relative, unrotated) → world
    const bcx = box.x + box.w / 2, bcy = box.y + box.h / 2;
    const toWorld = o.toWorld || ((x, y) => [x, y]);
    const out = lines.map((l, i) => {
      let lx = ax - bw / 2, ly = top + i * lh + lh / 2 + size * 0.34 - bh / 2;   // relative to box centre
      if (box.rot) { const r = G.rotPt(lx, ly, 0, 0, box.rot); lx = r[0]; ly = r[1]; }
      const w = toWorld(bcx + lx, bcy + ly);
      return { t: l.t, x: w[0], y: w[1], w: l.w, b: l.b };
    });
    return { k: 'text', lines: out, size, fam, bold: !!st.bold, italic: !!st.italic, underline: !!st.underline, color: st.fontColor || '#000', anchor, angle: (o.angle || 0) + (box.rot || 0), op: st.op ?? 1, lh, bg: o.bg };
  }

  /* ---------- shapes ---------- */
  const colorKey = (k, st) => k === 'S' ? st.stroke : k === 'F' ? st.fill : k === 'W' ? '#ffffff' : k === 'T' ? st.fontColor : k;
  function classSections(cell, st) {
    const parts = String(cell.text || '').split(/\n--\n|\n--$|^--\n/);
    const size = st.fontSize || 12, lh = size * 1.22;
    const hs = parts.map((p, i) => { const n = p.split('\n').length; return i === 0 ? Math.max(26, n * lh + 10) : (p ? n * lh + 8 : 10); });
    return { parts, hs, lh, total: hs.reduce((a, b) => a + b, 0) };
  }
  function shapePrims(c, ctx = {}) {
    const d = S.get(c.shape), st = S.styleOf(c), T = M.xf(c), prims = [];
    const W = (x, y) => T(x, y);
    const tp = path => G.transform(path, W);
    const op = st.op ?? 1;
    const main = tp(d.path(c.w, c.h, c));
    const fillMain = d.container && st.bodyFill ? st.bodyFill : st.fill;
    if (st.shadow && !d.invisible) prims.push({ k: 'path', d: G.transform(main, (x, y) => [x + 3, y + 4]), fill: fillMain === 'none' ? 'none' : '#000000', stroke: fillMain === 'none' ? '#000000' : 'none', sw: st.sw, op: 0.16 * op, shadow: true });
    if (c.shape === 'image') {
      if (c.image) prims.push({ k: 'image', x: c.x, y: c.y, w: c.w, h: c.h, href: c.image, op, rot: c.rot || 0 });
      else prims.push({ k: 'path', d: main, fill: '#eef2f7', stroke: '#9aa8b8', sw: 1, dash: 'dash', op });
      if (st.stroke !== 'none') prims.push({ k: 'path', d: main, fill: 'none', stroke: st.stroke, sw: st.sw, dash: st.dash, op });
    } else if (!d.invisible) {
      prims.push({ k: 'path', d: main, fill: fillMain, fill2: d.container ? '' : st.fill2, stroke: d.strokePath ? 'none' : st.stroke, sw: st.sw, dash: st.dash, op, gid: c.id });
      if (d.strokePath) prims.push({ k: 'path', d: tp(d.strokePath(c.w, c.h, c)), fill: 'none', stroke: st.stroke, sw: st.sw, dash: st.dash, op });
    }
    // container header band
    if (d.container && st.header) {
      const hd = d.container.side === 'left' ? G.rect(0, 0, st.header, c.h) : G.rect(0, 0, c.w, st.header);
      prims.push({ k: 'path', d: tp(hd), fill: st.fill, fill2: st.fill2, stroke: st.stroke, sw: st.sw, dash: st.dash, op });
    }
    if (d.deco) for (const x of d.deco(c.w, c.h, c)) {
      const fill = x.f ? colorKey(x.f, st) : 'none', stroke = x.s === null ? 'none' : colorKey(x.s || 'S', st);
      prims.push({ k: 'path', d: tp(x.d), fill: fill || 'none', stroke: stroke || 'none', sw: x.sw || st.sw, dash: x.dash || '', op: (x.op ?? 1) * op });
    }
    // text
    const angle = c.rot || 0;
    const toWorld = (x, y) => T(c.flipH ? x : x, c.flipV ? y : y);
    const noFlipWorld = (x, y) => { const r = G.rotPt(x, y, c.w / 2, c.h / 2, angle); return [r[0] + c.x, r[1] + c.y]; };
    if (d.sections) {
      const L = classSections(c, st); let y = 0;
      L.parts.forEach((part, i) => {
        const h = i === L.parts.length - 1 ? Math.max(L.hs[i], c.h - y) : L.hs[i];
        if (i > 0) prims.push({ k: 'path', d: tp(`M0 ${y} L${c.w} ${y}`), fill: 'none', stroke: st.stroke, sw: st.sw, op });
        if (part) {
          const hdr = i === 0, lines = part.split('\n');
          if (hdr) {
            // stereotype lines («…») plain, class name bold (italic for abstract written as /Name/)
            const box = { x: 4, y: y + 2, w: c.w - 8, h: h - 4 };
            const nm = lines.map(t => t);
            const tprim = textPrim(nm.map(t => t.replace(/^\/(.*)\/$/, '$1')).join('\n'), { ...box, align: 'center', valign: 'middle' }, { ...st, bold: false, wrap: false }, { toWorld: noFlipWorld, angle });
            tprim.lines.forEach((l, k) => { l.b = !/^«.*»$|^<<.*>>$/.test(nm[k] || ''); l.i = /^\/.*\/$/.test(nm[k] || ''); l.w = measure(l.t, tprim.size, tprim.fam, l.b, l.i); });
            prims.push(tprim);
          } else prims.push(textPrim(part, { x: 6, y: y + 2, w: c.w - 12, h: h - 4, valign: 'top', align: st.align === 'center' ? 'center' : 'left' }, { ...st, wrap: false }, { toWorld: noFlipWorld, angle }));
        }
        y += h;
      });
      return prims;
    }
    if (c.text) {
      let box = S.textBox(c);
      if (c.flipH && !box.rot && d.label !== 'below') box = { ...box, x: c.w - box.x - box.w };
      if (c.flipV && !box.rot && d.label !== 'below') box = { ...box, y: c.h - box.y - box.h };
      const tst = st;
      const prim = textPrim(c.text, box, tst, { toWorld: noFlipWorld, angle, firstBold: d.firstBold, bg: st.textBg || (d.label === 'below' ? '' : '') });
      if (d.firstBold) prim.lines.forEach(l => { if (l.b) l.w = measure(l.t, prim.size, prim.fam, true, st.italic); });
      prims.push(prim);
    }
    return prims;
  }

  /* ---------- edges ---------- */
  function arrow(type, tip, ux, uy, size, st, bg) {
    if (!type || type === 'none') return { prims: [], inset: 0 };
    const L = size, Wd = size * 0.42, px = -uy, py = ux, P = G.P;
    const at = (a, b) => [tip.x - ux * a + px * b, tip.y - uy * a + py * b];
    const pt = ([x, y]) => P(x, y);
    const sw = st.sw, col = st.stroke, op = st.op ?? 1;
    const fillP = (d, fill) => ({ k: 'path', d, fill, stroke: col, sw: Math.min(sw, 1.5), op, join: 'miter' });
    switch (type) {
      case 'classic': return { prims: [fillP(`M${pt(at(0, 0))} L${pt(at(L, Wd))} L${pt(at(L * 0.72, 0))} L${pt(at(L, -Wd))} Z`, col)], inset: L * 0.7 };
      case 'block': return { prims: [fillP(`M${pt(at(0, 0))} L${pt(at(L, Wd))} L${pt(at(L, -Wd))} Z`, col)], inset: L };
      case 'blockOpen': return { prims: [fillP(`M${pt(at(0, 0))} L${pt(at(L, Wd * 1.1))} L${pt(at(L, -Wd * 1.1))} Z`, bg)], inset: L };
      case 'open': return { prims: [{ k: 'path', d: `M${pt(at(L, Wd))} L${pt(at(0, 0))} L${pt(at(L, -Wd))}`, fill: 'none', stroke: col, sw, op }], inset: 0 };
      case 'diamond': case 'diamondOpen': return { prims: [fillP(`M${pt(at(0, 0))} L${pt(at(L * 0.8, Wd))} L${pt(at(L * 1.6, 0))} L${pt(at(L * 0.8, -Wd))} Z`, type === 'diamond' ? col : bg)], inset: L * 1.6 };
      case 'oval': case 'ovalOpen': { const r = L * 0.33, c = at(r, 0); return { prims: [fillP(G.ellipse(c[0], c[1], r, r), type === 'oval' ? col : bg)], inset: 2 * r }; }
      case 'erMandOne': return { prims: [{ k: 'path', d: `M${pt(at(L * 0.55, Wd))} L${pt(at(L * 0.55, -Wd))} M${pt(at(L * 0.95, Wd))} L${pt(at(L * 0.95, -Wd))}`, fill: 'none', stroke: col, sw, op }], inset: 0 };
      case 'erMany': case 'erOneMany': case 'erZeroMany': {
        let d = `M${pt(at(0, Wd * 1.1))} L${pt(at(L, 0))} L${pt(at(0, -Wd * 1.1))}`; const pr = [];
        if (type === 'erOneMany') d += ` M${pt(at(L * 1.25, Wd))} L${pt(at(L * 1.25, -Wd))}`;
        pr.push({ k: 'path', d, fill: 'none', stroke: col, sw, op });
        if (type === 'erZeroMany') { const c = at(L * 1.45, 0); pr.push(fillP(G.ellipse(c[0], c[1], L * 0.3, L * 0.3), bg)); }
        return { prims: pr, inset: 0 };
      }
      default: return { prims: [], inset: 0 };
    }
  }
  function edgeGeom(e, route, ctx = {}) {
    const st = S.styleOf(e), bg = ctx.bg || '#ffffff';
    let pts = route.pts.map(p => ({ x: p.x, y: p.y }));
    if (pts.length < 2) pts = [pts[0] || { x: 0, y: 0 }, pts[0] || { x: 0, y: 0 }];
    const size = Math.max(4, (st.arrowSize || 10) * (0.75 + Math.min(st.sw, 4) * 0.17));
    const prims = [];
    const endA = (i, j, type) => {
      const tip = pts[i]; let k = j; while (k >= 0 && k < pts.length && G.dist(pts[k], tip) < 0.5) k += j > i ? 1 : -1;
      const ref = pts[Math.max(0, Math.min(pts.length - 1, k))];
      const L = G.dist(ref, tip) || 1, ux = (tip.x - ref.x) / L, uy = (tip.y - ref.y) / L;
      const a = arrow(type, tip, ux, uy, size, st, bg);
      if (a.inset) pts[i] = { x: tip.x - ux * Math.min(a.inset, L - 0.5), y: tip.y - uy * Math.min(a.inset, L - 0.5) };
      return a.prims;
    };
    const flatOrig = route.curved ? G.flatten(R.curveD(route.pts), 12)[0].pts : route.pts;
    const arrows = [...endA(pts.length - 1, pts.length - 2, st.endArrow), ...endA(0, 1, st.startArrow)];
    const d = route.curved ? R.curveD(pts) : R.polyD(pts, st.rounded && st.route !== 'straight' ? 8 : 0);
    prims.push({ k: 'path', d, fill: 'none', stroke: st.stroke, sw: st.sw, dash: st.dash, op: st.op ?? 1, line: true });
    prims.push(...arrows);
    let label = null;
    if (e.text) {
      const p = G.pointAt(flatOrig, e.labelT ?? 0.5), lx = p.x + (e.labelDx || 0), ly = p.y + (e.labelDy || 0);
      const tst = { ...st, align: 'center', valign: 'middle' };
      const lines = wrap(e.text, 0, st.fontSize, st.font, st.bold, st.italic);
      const tw = Math.max(...lines.map(l => l.w)) + 6, th = lines.length * st.fontSize * 1.22 + 2;
      const box = { x: lx - tw / 2, y: ly - th / 2, w: tw, h: th };
      if (st.labelBg && st.labelBg !== 'none') prims.push({ k: 'path', d: G.rect(box.x, box.y, box.w, box.h), fill: st.labelBg, stroke: 'none', op: st.op ?? 1, labelBg: true });
      prims.push(textPrim(e.text, { ...box, w: tw + 20, x: box.x - 10 }, { ...tst, wrap: false }));
      label = box;
    }
    return { prims, flat: flatOrig, label, st };
  }

  /* ---------- cell → prims ---------- */
  function cellPrims(c, ctx) {
    if (c.kind === 'shape') return shapePrims(c, ctx);
    if (c.kind === 'edge') { const r = ctx.routes && ctx.routes.get(c.id); return r ? edgeGeom(c, r, ctx).prims : []; }
    return [];
  }

  /* ---------- SVG serialisation ---------- */
  function dashArr(dash, sw) {
    const k = Math.max(1, sw * 0.8);
    if (dash === 'dash') return [6 * k, 4 * k]; if (dash === 'dot') return [1.2 * k, 3 * k]; if (dash === 'dashdot') return [8 * k, 3 * k, 1.5 * k, 3 * k];
    if (dash === 'longdash') return [12 * k, 5 * k];
    return null;
  }
  const n2 = v => G.f(v);
  function primSVG(p, idp = '') {
    if (p.k === 'path') {
      let a = `d="${p.d}"`, defs = '';
      if (p.fill2 && p.fill && p.fill !== 'none') {
        const id = 'gr-' + idp + (p.gid || '') + Math.abs(hash(p.fill + p.fill2)).toString(36);
        defs = `<defs><linearGradient id="${esc(id)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${esc(p.fill)}"/><stop offset="1" stop-color="${esc(p.fill2)}"/></linearGradient></defs>`;
        a += ` fill="url(#${esc(id)})"`;
      } else a += ` fill="${esc(p.fill || 'none')}"`;
      if (p.stroke && p.stroke !== 'none') {
        a += ` stroke="${esc(p.stroke)}" stroke-width="${n2(p.sw || 1)}" stroke-linejoin="${p.join || 'round'}" stroke-linecap="${p.line ? 'butt' : 'round'}"`;
        const da = dashArr(p.dash, p.sw || 1); if (da) a += ` stroke-dasharray="${da.map(n2).join(' ')}"`;
      }
      if (p.op != null && p.op < 1) a += ` opacity="${n2(p.op)}"`;
      return defs + `<path ${a}/>`;
    }
    if (p.k === 'text') {
      let s = '';
      const fw = l => (l.b ? ' font-weight="bold"' : ''), fs = l => (p.italic || l.i ? ' font-style="italic"' : '');
      for (const l of p.lines) {
        if (!l.t) continue;
        const tr = p.angle ? ` transform="rotate(${n2(p.angle)} ${n2(l.x)} ${n2(l.y)})"` : '';
        s += `<text x="${n2(l.x)}" y="${n2(l.y)}" font-family="${esc(FAMILY[p.fam])}" font-size="${n2(p.size)}" fill="${esc(p.color)}" text-anchor="${p.anchor}"${fw(l)}${fs(l)}${p.underline ? ' text-decoration="underline"' : ''}${p.op < 1 ? ` opacity="${n2(p.op)}"` : ''}${tr} xml:space="preserve">${esc(xmlSafe(l.t))}</text>`;
      }
      return s;
    }
    if (p.k === 'image') {
      const tr = p.rot ? ` transform="rotate(${n2(p.rot)} ${n2(p.x + p.w / 2)} ${n2(p.y + p.h / 2)})"` : '';
      return `<image href="${esc(p.href)}" x="${n2(p.x)}" y="${n2(p.y)}" width="${n2(p.w)}" height="${n2(p.h)}" preserveAspectRatio="none"${p.op < 1 ? ` opacity="${n2(p.op)}"` : ''}${tr}/>`;
    }
    return '';
  }
  function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }
  const primsSVG = (prims, idp) => prims.map(p => primSVG(p, idp)).join('');

  // ordered, visible, drawable cells of a page (layer order, then document order)
  function drawOrder(page, filter) {
    const out = [];
    for (const L of page.layers) {
      if (L.visible === false) continue;
      for (const c of page.cells) if ((c.layer || page.layers[0].id) === L.id && c.kind !== 'group' && (!filter || filter(c))) out.push(c);
    }
    // cells with an unknown layer go on top of the first layer
    const ids = new Set(page.layers.map(l => l.id));
    if (page.layers[0].visible !== false) for (const c of page.cells) if (c.layer && !ids.has(c.layer) && c.kind !== 'group') out.push(c);
    return out;
  }
  // full standalone SVG for a page (or a subset of cells)
  function pageSVG(page, o = {}) {
    const routes = o.routes || R.routePage(page);
    const cells = drawOrder(page, o.filter);
    const ctx = { routes, bg: o.transparent ? '#ffffff' : page.bg || '#ffffff' };
    let b = null; const byId = M.index(page);
    const lists = cells.map(c => { const pr = cellPrims(c, ctx); b = G.unionBox(b, primsBox(pr)); return pr; });
    if (!b) b = { x: 0, y: 0, w: 100, h: 100 };
    const pad = o.padding ?? 20, vb = { x: Math.floor(b.x - pad), y: Math.floor(b.y - pad), w: Math.ceil(b.w + 2 * pad), h: Math.ceil(b.h + 2 * pad) };
    const sc = o.scale || 1;
    let s = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" width="${n2(vb.w * sc)}" height="${n2(vb.h * sc)}" viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}">`;
    if (o.title) s += `<title>${esc(xmlSafe(o.title))}</title>`;
    if (o.metadata) s += `<metadata id="lumen-diagram">${esc(o.metadata)}</metadata>`;
    if (!o.transparent) s += `<rect x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="${esc(page.bg || '#ffffff')}"/>`;
    lists.forEach((pr, i) => { s += `<g data-cell="${esc(cells[i].id)}">${primsSVG(pr, 'x' + i)}</g>`; });
    s += '</svg>';
    return { svg: s, box: vb, lists, cells, routes };
  }
  function primsBox(prims) {
    let b = null;
    for (const p of prims) {
      if (p.k === 'path') { for (const r of G.flatten(p.d, 4)) { const bb = G.bboxPts(r.pts); const m = (p.sw || 0) / 2; b = G.unionBox(b, { x: bb.x - m, y: bb.y - m, w: bb.w + 2 * m, h: bb.h + 2 * m }); } }
      else if (p.k === 'text') for (const l of p.lines) { if (!l.t) continue; const x0 = p.anchor === 'middle' ? l.x - l.w / 2 : p.anchor === 'end' ? l.x - l.w : l.x; if (!p.angle) b = G.unionBox(b, { x: x0, y: l.y - p.size, w: l.w, h: p.size * 1.3 }); else b = G.unionBox(b, { x: l.x - l.w, y: l.y - l.w, w: 2 * l.w, h: 2 * l.w }); }
      else if (p.k === 'image') b = G.unionBox(b, { x: p.x, y: p.y, w: p.w, h: p.h });
    }
    return b;
  }

  const api = { FAMILY, wrap, textPrim, shapePrims, edgeGeom, cellPrims, primSVG, primsSVG, drawOrder, pageSVG, primsBox, classSections, dashArr, esc, xmlSafe, arrow };
  if (isNode) module.exports = api; else root.DiaRender = api;
})(typeof self !== 'undefined' ? self : this);
