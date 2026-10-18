// Lumen Draft — paper layout (frame, viewport, title block) and vector writers: SVG and PDF at true scale.
(function (root, factory) { if (typeof module === 'object' && module.exports) module.exports = factory(require('./geom.js'), require('./model.js')); else root.LDExport = factory(root.LDGeom, root.LDModel); })(typeof self !== 'undefined' ? self : this, function (G, M) {
  'use strict';
  const UNIT_MM = { mm: 1, cm: 10, m: 1000, in: 25.4, ft: 304.8 };

  /* ---------- layout geometry (shared by screen and print) ---------- */
  function layoutGeom(doc) {
    const L = doc.layout, [W, H] = M.PAPERS[L.paper] || M.PAPERS.A3, mg = W < 300 ? 7 : 10;
    const frame = [mg + (W < 300 ? 8 : 15), mg, W - mg, H - mg];   // wider binding margin on the left
    const k = (UNIT_MM[doc.units] || 1) * L.scale[0] / L.scale[1];
    const tbW = Math.min(180, frame[2] - frame[0]), tbH = 32;
    const tb = L.tb ? [frame[2] - tbW, frame[1], frame[2], frame[1] + tbH] : null;
    const vp = [frame[0] + 2, frame[1] + 2, frame[2] - 2, frame[3] - 2];
    let cx = L.cx, cy = L.cy;
    if (cx == null || cy == null) { const e = M.extents(doc); cx = e ? (e[0] + e[2]) / 2 : 0; cy = e ? (e[1] + e[3]) / 2 : 0; }
    // viewport centre on paper: centre of the area above the title block if the drawing fits there
    const vcx = (vp[0] + vp[2]) / 2, vcy = tb ? (tb[3] + vp[3]) / 2 : (vp[1] + vp[3]) / 2;
    return { W, H, frame, vp, tb, k, cx, cy, ox: vcx - cx * k, oy: vcy - cy * k };
  }
  // largest standard scale at which the drawing fits the viewport area above the title block
  function fitScale(doc) {
    const e = M.extents(doc); if (!e) return [1, 1];
    const save = doc.layout.scale; doc.layout.scale = [1, 1];
    const g = layoutGeom(doc); doc.layout.scale = save;
    const aw = g.vp[2] - g.vp[0] - 10, ah = (g.tb ? g.vp[3] - g.tb[3] : g.vp[3] - g.vp[1]) - 10, u = UNIT_MM[doc.units] || 1;
    const w = (e[2] - e[0]) * u, h = (e[3] - e[1]) * u;
    const cands = M.SCALES.slice().sort((a, b) => b[0] / b[1] - a[0] / a[1]);
    for (const s of cands) if (w * s[0] / s[1] <= aw && h * s[0] / s[1] <= ah) return s;
    return cands[cands.length - 1];
  }
  const scaleLabel = s => `${s[0]}:${s[1]}`;

  /* ---------- sinks ---------- */
  // wraps a paper sink so model-space coordinates are mapped x·k+ox, y·k+oy
  function worldToPaper(inner, k, ox, oy) {
    const P = (x, y) => [x * k + ox, y * k + oy];
    return {
      style: st => inner.style(st),
      line: (x1, y1, x2, y2) => { const a = P(x1, y1), b = P(x2, y2); inner.line(a[0], a[1], b[0], b[1]); },
      poly: (pts, closed, w) => inner.poly(pts.map(p => [...P(p[0], p[1]), p[2] || 0]), closed, (w || 0) * k),
      arc: (cx, cy, r, a1, sw) => { const c = P(cx, cy); inner.arc(c[0], c[1], r * k, a1, sw); },
      circle: (cx, cy, r) => { const c = P(cx, cy); inner.circle(c[0], c[1], r * k); },
      fill: loops => inner.fill(loops.map(l => ({ pts: l.pts.map(p => [...P(p[0], p[1]), p[2] || 0]) }))),
      text: (x, y, h, rot, s, al, va) => { const a = P(x, y); inner.text(a[0], a[1], h * k, rot, s, al, va); },
      point: (x, y) => { const a = P(x, y); inner.point(a[0], a[1]); },
      hatchLines: segs => inner.hatchLines(segs.map(s => [...P(s[0], s[1]), ...P(s[2], s[3])])),
    };
  }
  const plotColor = (st, mono) => { if (mono) return [0, 0, 0]; if (st.aci === 7 && !st.rgbTrue) return [0, 0, 0]; const c = st.rgb; return (c[0] > 235 && c[1] > 235 && c[2] > 235) ? [0, 0, 0] : c; };

  /* ---------- page description: draw everything into a paper sink (mm, y up) ---------- */
  function drawPage(doc, src, sink, opts = {}) {
    if (src === 'model') {
      const e = M.extents(doc) || [0, 0, 100, 100], u = UNIT_MM[doc.units] || 1, s = opts.scale || [1, 1], k = u * s[0] / s[1], mg = 10;
      const W = (e[2] - e[0]) * k + 2 * mg, H = (e[3] - e[1]) * k + 2 * mg;
      sink.begin(W, H);
      M.emit(doc, doc.ents, worldToPaper(sink.model(opts), k, mg - e[0] * k, mg - e[1] * k), { plot: true, hatchCache: opts.hatchCache });
      sink.end();
      return { W, H, k };
    }
    const g = layoutGeom(doc);
    sink.begin(g.W, g.H);
    sink.clip(g.vp);
    M.emit(doc, doc.ents, worldToPaper(sink.model(opts), g.k, g.ox, g.oy), { plot: true, hatchCache: opts.hatchCache });
    sink.unclip();
    paperItems(doc, g, sink.paper());
    sink.end();
    return g;
  }
  // frame + title block in paper mm
  function paperItems(doc, g, s) {
    const L = doc.layout, black = { rgb: [0, 0, 0], aci: 7, lw: 0.5, lt: 'CONTINUOUS' }, thin = { ...black, lw: 0.25 };
    const rect = (x0, y0, x1, y1) => s.poly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], true, 0);
    s.style(black); rect(...g.frame);
    if (!g.tb) return;
    const [x0, y0, x1, y1] = g.tb, w = x1 - x0;
    s.fillWhite([x0, y0, x1, y1]);
    s.style(black); rect(x0, y0, x1, y1);
    const cL = x0 + w / 3, rowA = y0 + 9, rowB = y0 + 18;
    s.style(thin);
    s.line(cL, y0, cL, y1); s.line(cL, rowA, x1, rowA); s.line(cL, rowB, x1, rowB);
    const cw = (x1 - cL) / 6;
    for (let i = 1; i < 6; i++) s.line(cL + cw * i, rowA, cL + cw * i, rowB);
    s.line(x1 - cw * 1.5, y0, x1 - cw * 1.5, rowA);
    const lab = (x, y, t) => { s.style({ ...thin, rgb: [90, 90, 90] }); s.text(x + 1.2, y - 2.6, 1.6, 0, t.toUpperCase(), 0, 0); };
    const val = (x, y, t, h = 2.5) => { s.style({ ...thin, rgb: [0, 0, 0] }); s.text(x + 1.2, y, h, 0, String(t || ''), 0, 0); };
    // left block: company
    s.style({ ...thin, rgb: [0, 0, 0] });
    s.text(x0 + (cL - x0) / 2, y0 + 19, 4.2, 0, String(L.company || ''), 1, 0);
    s.style({ ...thin, rgb: [90, 90, 90] });
    s.text(x0 + (cL - x0) / 2, y0 + 12, 1.8, 0, `Units: ${doc.units} · drawn with Lumen Draft`, 1, 0);
    // title row
    lab(cL, y1, 'Title'); val(cL, rowB + 4, L.title, 4.2);
    // middle row cells
    const cells = [['Drawn', L.by], ['Checked', L.checked], ['Date', L.date], ['Scale', scaleLabel(L.scale)], ['Size', L.paper], ['Rev', L.rev]];
    cells.forEach(([k, v], i) => { lab(cL + cw * i, rowB, k); val(cL + cw * i, rowA + 2, v, 2.5); });
    // bottom row
    lab(cL, rowA, 'Drawing number'); val(cL, y0 + 2, L.number, 3.5);
    lab(x1 - cw * 1.5, rowA, 'Sheet'); val(x1 - cw * 1.5, y0 + 2, L.sheet, 2.5);
  }

  /* ---------- SVG writer ---------- */
  const xmlEsc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const n4 = v => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(4));
  function pathD(pts, closed, Y) {
    let d = `M${n4(pts[0][0])} ${n4(Y(pts[0][1]))}`;
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const p = pts[i], q = pts[(i + 1) % n], b = p[2] || 0;
      if (!b) d += `L${n4(q[0])} ${n4(Y(q[1]))}`;
      else { const a = G.bulgeArc(p, q, b); if (!a) { d += `L${n4(q[0])} ${n4(Y(q[1]))}`; continue; } const large = Math.abs(a.th) > Math.PI ? 1 : 0, sweep = a.th > 0 ? 0 : 1; d += `A${n4(a.r)} ${n4(a.r)} 0 ${large} ${sweep} ${n4(q[0])} ${n4(Y(q[1]))}`; }
    }
    return d + (closed ? 'Z' : '');
  }
  function svgSink(doc) {
    const out = []; let H = 0, cur = null, clipN = 0;
    const Y = y => H - y;
    const strokeAttr = (st, mono) => {
      const c = plotColor(st, mono), dash = M.dashPattern(doc, st);
      return `stroke="rgb(${c.join(',')})" stroke-width="${n4(Math.max(st.lw, 0.05))}"${dash ? ` stroke-dasharray="${dash.map(v => n4(Math.max(v, 0.05))).join(' ')}"` : ''}`;
    };
    const mk = (mono, paper) => {
      let st = null;
      const S = () => strokeAttr(st, mono), F = () => `rgb(${plotColor(st, mono).join(',')})`;
      return {
        style: s => { st = s; }, fillWhite: r => out.push(`<rect x="${n4(r[0])}" y="${n4(Y(r[3]))}" width="${n4(r[2] - r[0])}" height="${n4(r[3] - r[1])}" fill="#fff"/>`),
        line: (x1, y1, x2, y2) => out.push(`<line x1="${n4(x1)}" y1="${n4(Y(y1))}" x2="${n4(x2)}" y2="${n4(Y(y2))}" ${S()}/>`),
        poly: (pts, closed, w) => { if (w > 0) out.push(`<path d="${pathD(pts, closed, Y)}" fill="none" ${S().replace(/stroke-width="[^"]*"/, `stroke-width="${n4(w)}"`)}/>`); else out.push(`<path d="${pathD(pts, closed, Y)}" fill="none" ${S()}/>`); },
        arc: (cx, cy, r, a1, sw) => { const p = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)], q = [cx + r * Math.cos(a1 + sw), cy + r * Math.sin(a1 + sw)]; if (sw >= G.TAU - 1e-9) return out.push(`<circle cx="${n4(cx)}" cy="${n4(Y(cy))}" r="${n4(r)}" fill="none" ${S()}/>`); out.push(`<path d="M${n4(p[0])} ${n4(Y(p[1]))}A${n4(r)} ${n4(r)} 0 ${sw > Math.PI ? 1 : 0} 0 ${n4(q[0])} ${n4(Y(q[1]))}" fill="none" ${S()}/>`); },
        circle: (cx, cy, r) => out.push(`<circle cx="${n4(cx)}" cy="${n4(Y(cy))}" r="${n4(r)}" fill="none" ${S()}/>`),
        fill: loops => out.push(`<path d="${loops.map(l => pathD(l.pts, true, Y)).join('')}" fill="${F()}" fill-rule="evenodd" stroke="none"/>`),
        hatchLines: segs => { if (!segs.length) return; let d = ''; for (const s of segs) d += `M${n4(s[0])} ${n4(Y(s[1]))}L${n4(s[2])} ${n4(Y(s[3]))}`; out.push(`<path d="${d}" fill="none" ${strokeAttr({ ...st, lt: 'CONTINUOUS', lw: Math.min(st.lw, 0.18) }, mono)}/>`); },
        text: (x, y, h, rot, s, al, va) => {
          if (!String(s).length) return;
          const anchor = ['start', 'middle', 'end', 'start', 'middle'][al || 0] || 'start', bo = G.baseOff(va, h);
          const deg = -(rot || 0) * 180 / Math.PI, bx = x - Math.sin(rot || 0) * bo, by = y + Math.cos(rot || 0) * bo;
          out.push(`<text x="0" y="0" transform="translate(${n4(bx)} ${n4(Y(by))}) rotate(${n4(deg)})" font-family="Arial, Helvetica, sans-serif" font-size="${n4(h * G.EM)}" text-anchor="${anchor}" fill="${F()}" stroke="none">${xmlEsc(s)}</text>`);
        },
        point: (x, y) => { out.push(`<circle cx="${n4(x)}" cy="${n4(Y(y))}" r="0.25" fill="${F()}" stroke="none"/>`); },
      };
    };
    return {
      begin(W, H0) { H = H0; out.push(`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${n4(W)}mm" height="${n4(H0)}mm" viewBox="0 0 ${n4(W)} ${n4(H0)}" stroke-linecap="round" stroke-linejoin="round">`, `<rect width="100%" height="100%" fill="#fff"/>`); },
      model: opts => mk(opts.mono, false), paper: () => mk(false, true),
      clip(r) { clipN++; out.push(`<clipPath id="vp${clipN}"><rect x="${n4(r[0])}" y="${n4(Y(r[3]))}" width="${n4(r[2] - r[0])}" height="${n4(r[3] - r[1])}"/></clipPath><g clip-path="url(#vp${clipN})">`); },
      unclip() { out.push('</g>'); },
      end() { out.push('</svg>'); },
      result: () => out.join('\n') + '\n',
    };
  }
  function toSVG(doc, src = 'layout', opts = {}) { const s = svgSink(doc); drawPage(doc, src, s, opts); return s.result(); }

  /* ---------- PDF writer (vector, Helvetica, mm user space) ---------- */
  const WIN = { '€': 128, '‚': 130, 'ƒ': 131, '„': 132, '…': 133, '†': 134, '‡': 135, 'ˆ': 136, '‰': 137, 'Š': 138, '‹': 139, 'Œ': 140, 'Ž': 142, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '˜': 152, '™': 153, 'š': 154, '›': 155, 'œ': 156, 'ž': 158, 'Ÿ': 159, '⌀': 216 };
  function pdfStr(s) {
    let o = '(';
    for (const ch of String(s)) {
      let c = ch.charCodeAt(0); if (WIN[ch]) c = WIN[ch]; else if (c > 255) c = 63;
      if (ch === '(' || ch === ')' || ch === '\\') o += '\\' + ch; else if (c < 32 || c > 126) o += '\\' + c.toString(8).padStart(3, '0'); else o += ch;
    }
    return o + ')';
  }
  const f3 = v => { const r = Math.abs(v) < 1e-6 ? 0 : +v.toFixed(3); return String(r); };
  function pdfSink(doc) {
    let ops = [], W = 0, H = 0;
    const arcOps = (cx, cy, r, a0, sw, move) => {
      const n = Math.max(1, Math.ceil(Math.abs(sw) / (Math.PI / 2))), d = sw / n, k = 4 / 3 * Math.tan(d / 4);
      let s = '';
      if (move) s += `${f3(cx + r * Math.cos(a0))} ${f3(cy + r * Math.sin(a0))} m `;
      for (let i = 0; i < n; i++) {
        const t0 = a0 + d * i, t1 = t0 + d, c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
        s += `${f3(cx + r * (c0 - k * s0))} ${f3(cy + r * (s0 + k * c0))} ${f3(cx + r * (c1 + k * s1))} ${f3(cy + r * (s1 - k * c1))} ${f3(cx + r * c1)} ${f3(cy + r * s1)} c `;
      }
      return s;
    };
    const polyOps = (pts, closed) => {
      let s = `${f3(pts[0][0])} ${f3(pts[0][1])} m `; const n = pts.length;
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const p = pts[i], q = pts[(i + 1) % n], b = p[2] || 0, a = b ? G.bulgeArc(p, q, b) : null;
        s += a ? arcOps(a.cx, a.cy, a.r, a.a0, a.th, false) : `${f3(q[0])} ${f3(q[1])} l `;
      }
      return s + (closed ? 'h ' : '');
    };
    const mk = (mono) => {
      let st = null, styled = '';
      const apply = (fill, override) => {
        const s0 = override || st, c = plotColor(s0, mono).map(v => f3(v / 255)).join(' '), dash = fill ? null : M.dashPattern(doc, s0);
        const key = `${fill}|${c}|${s0.lw}|${dash}`; if (key === styled) return; styled = key;
        ops.push(fill ? `${c} rg` : `${c} RG ${f3(Math.max(s0.lw, 0.05))} w [${dash ? dash.map(v => f3(Math.max(v, 0.05))).join(' ') : ''}] 0 d`);
      };
      return {
        style: s => { st = s; }, fillWhite: r => { styled = ''; ops.push(`1 1 1 rg ${f3(r[0])} ${f3(r[1])} ${f3(r[2] - r[0])} ${f3(r[3] - r[1])} re f`); },
        line: (x1, y1, x2, y2) => { apply(false); ops.push(`${f3(x1)} ${f3(y1)} m ${f3(x2)} ${f3(y2)} l S`); },
        poly: (pts, closed, w) => { if (w > 0) { apply(false, { ...st, lw: w }); } else apply(false); ops.push(polyOps(pts, closed) + 'S'); },
        arc: (cx, cy, r, a1, sw) => { apply(false); ops.push(arcOps(cx, cy, r, a1, sw, true) + 'S'); },
        circle: (cx, cy, r) => { apply(false); ops.push(arcOps(cx, cy, r, 0, G.TAU, true) + 'h S'); },
        fill: loops => { apply(true); ops.push(loops.map(l => polyOps(l.pts, true)).join('') + 'f*'); },
        hatchLines: segs => { if (!segs.length) return; apply(false, { ...st, lt: 'CONTINUOUS', lw: Math.min(st.lw, 0.18) }); let s = ''; for (const q of segs) s += `${f3(q[0])} ${f3(q[1])} m ${f3(q[2])} ${f3(q[3])} l `; ops.push(s + 'S'); },
        text: (x, y, h, rot, s, al, va) => {
          if (!String(s).length) return;
          apply(true); const fs = h * G.EM, w = G.textWidth(s, h), dx = al === 1 || al === 4 ? -w / 2 : al === 2 ? -w : 0, dy = G.baseOff(va, h);
          const c = Math.cos(rot || 0), sn = Math.sin(rot || 0), bx = x + dx * c - dy * sn, by = y + dx * sn + dy * c;
          ops.push(`BT /F1 ${f3(fs)} Tf ${f3(c)} ${f3(sn)} ${f3(-sn)} ${f3(c)} ${f3(bx)} ${f3(by)} Tm ${pdfStr(s)} Tj ET`);
        },
        point: (x, y) => { apply(true); ops.push(arcOps(x, y, 0.25, 0, G.TAU, true) + 'f'); },
      };
    };
    return {
      begin(w, h) { W = w; H = h; ops.push(`q ${f3(72 / 25.4)} 0 0 ${f3(72 / 25.4)} 0 0 cm 1 J 1 j`); },
      model: opts => mk(opts.mono), paper: () => mk(false),
      clip(r) { ops.push(`q ${f3(r[0])} ${f3(r[1])} ${f3(r[2] - r[0])} ${f3(r[3] - r[1])} re W n`); },
      unclip() { ops.push('Q'); },
      end() { ops.push('Q'); },
      result(title) {
        const content = ops.join('\n') + '\n', pw = f3(W * 72 / 25.4), ph = f3(H * 72 / 25.4);
        const objs = [
          '<< /Type /Catalog /Pages 2 0 R >>',
          '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw} ${ph}] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
          `<< /Length ${content.length} >>\nstream\n${content}endstream`,
          '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
          `<< /Producer (Lumen Draft) /Title ${pdfStr(title || 'Drawing')} >>`,
        ];
        let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'; const offs = [];
        objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
        const xref = pdf.length;
        pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
        pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
        const bytes = new Uint8Array(pdf.length); for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 255;
        return bytes;
      },
    };
  }
  function toPDF(doc, src = 'layout', opts = {}) { const s = pdfSink(doc); drawPage(doc, src, s, opts); return s.result(opts.title || doc.layout.title); }

  return { UNIT_MM, layoutGeom, fitScale, scaleLabel, worldToPaper, drawPage, paperItems, toSVG, toPDF, plotColor };
});
