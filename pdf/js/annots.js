// Annotation model: geometry, text layout and SVG preview rendering (in PDF user space).
import { normRect, bboxPts, unionRect, localFrame, quadBox, esc, f2 } from './util.js';

export const TYPE_LABEL = {
  highlight: 'Highlight', underline: 'Underline', strike: 'Strikethrough', squiggly: 'Squiggly', note: 'Sticky note', ink: 'Freehand',
  rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow', freetext: 'Text box', stamp: 'Stamp', image: 'Image', redact: 'Redaction mark'
};
export const MARKUP = new Set(['highlight', 'underline', 'strike', 'squiggly']);
export const STAMPS = [['APPROVED', '#1e8a3c'], ['DRAFT', '#2862c8'], ['CONFIDENTIAL', '#c62828'], ['FINAL', '#1e8a3c'], ['NOT APPROVED', '#c62828'], ['REVIEWED', '#6a3fb5'], ['FOR COMMENT', '#d97a00'], ['VOID', '#c62828'], ['SIGN HERE', '#d97a00']];
export const FONTS = { Helvetica: 'Helvetica, Arial, sans-serif', Times: '"Times New Roman", Times, serif', Courier: '"Courier New", Courier, monospace' };
export const ASCENT = 0.8, LEADING = 1.18;

export function displayLabel(a) {
  if (a.type === 'freetext' && a.content) return 'Page text';
  if (a.type === 'image') return a.sig ? 'Signature' : a.content ? 'Page image' : 'Image stamp';
  if (a.content && (a.type === 'rect' || a.type === 'ellipse' || a.type === 'line' || a.type === 'arrow')) return 'Page ' + TYPE_LABEL[a.type].toLowerCase();
  if (a.type === 'stamp') return 'Stamp: ' + (a.label || '');
  return TYPE_LABEL[a.type] || a.type;
}

// Bounding rect [x1,y1,x2,y2] in user space
export function annotRect(a) {
  switch (a.type) {
    case 'highlight': case 'underline': case 'strike': case 'squiggly': {
      let r = null; for (const q of a.quads) r = unionRect(r, quadBox(q)); return r || [0, 0, 0, 0];
    }
    case 'note': return [a.x, a.y - 20, a.x + 20, a.y];
    case 'ink': { const pts = a.strokes.flat(); const w = (a.width || 2) * 1.8; return pts.length ? bboxPts(pts, w / 2 + 1) : [0, 0, 0, 0]; }
    case 'line': case 'arrow': { const w = a.width || 2, pad = a.type === 'arrow' ? Math.max(7, w * 4) : w; return bboxPts([a.p1, a.p2], pad); }
    case 'redact': { let r = null; for (const q of a.rects) r = unionRect(r, normRect(q)); return r || [0, 0, 0, 0]; }
    default: return normRect(a.rect);
  }
}
export const isResizable = a => !MARKUP.has(a.type) && a.type !== 'note' && a.type !== 'redact';

export function translateAnnot(a, dx, dy) {
  const b = structuredClone(a);
  const mv = p => { p[0] += dx; p[1] += dy; };
  switch (b.type) {
    case 'highlight': case 'underline': case 'strike': case 'squiggly': b.quads = b.quads.map(q => q.map((v, i) => v + (i % 2 ? dy : dx))); break;
    case 'note': b.x += dx; b.y += dy; break;
    case 'ink': b.strokes.forEach(s => s.forEach(mv)); break;
    case 'line': case 'arrow': mv(b.p1); mv(b.p2); break;
    case 'redact': b.rects = b.rects.map(r => [r[0] + dx, r[1] + dy, r[2] + dx, r[3] + dy]); break;
    default: b.rect = [b.rect[0] + dx, b.rect[1] + dy, b.rect[2] + dx, b.rect[3] + dy];
  }
  return b;
}
// Map annotation from its current bbox `from` to `to` (both normalized rects)
export function resizeAnnot(a, from, to) {
  const b = structuredClone(a);
  const sx = (to[2] - to[0]) / Math.max(1e-6, from[2] - from[0]), sy = (to[3] - to[1]) / Math.max(1e-6, from[3] - from[1]);
  const map = p => { p[0] = to[0] + (p[0] - from[0]) * sx; p[1] = to[1] + (p[1] - from[1]) * sy; };
  if (b.type === 'ink') b.strokes.forEach(s => s.forEach(map));
  else if (b.type === 'line' || b.type === 'arrow') {
    // keep the endpoints inside the new box using the same padding as annotRect
    const pad = b.type === 'arrow' ? Math.max(7, (b.width || 2) * 4) : (b.width || 2);
    const fi = [from[0] + pad, from[1] + pad, from[2] - pad, from[3] - pad], ti = [to[0] + pad, to[1] + pad, to[2] - pad, to[3] - pad];
    const sx2 = (ti[2] - ti[0]) / Math.max(1e-6, fi[2] - fi[0]), sy2 = (ti[3] - ti[1]) / Math.max(1e-6, fi[3] - fi[1]);
    const m2 = p => { p[0] = ti[0] + (p[0] - fi[0]) * (isFinite(sx2) ? sx2 : 1); p[1] = ti[1] + (p[1] - fi[1]) * (isFinite(sy2) ? sy2 : 1); };
    m2(b.p1); m2(b.p2);
  } else if (b.rect) b.rect = to.slice();
  return b;
}

// Simple greedy word wrap shared by preview and PDF writer
export function wrapText(text, maxW, measure) {
  const out = [];
  for (const para of String(text ?? '').split(/\r?\n/)) {
    if (!para) { out.push(''); continue; }
    const words = para.split(/(\s+)/);
    let line = '';
    for (const w of words) {
      const cand = line + w;
      if (measure(cand.trimEnd()) <= maxW || !line.trim()) {
        if (measure(cand.trimEnd()) > maxW && !line.trim()) {
          // break a long word by characters
          let chunk = line;
          for (const ch of w) { if (measure(chunk + ch) > maxW && chunk) { out.push(chunk); chunk = ch; } else chunk += ch; }
          line = chunk;
        } else line = cand;
      } else { out.push(line.trimEnd()); line = w.trimStart(); }
    }
    out.push(line.trimEnd());
  }
  return out;
}
const mctx = document.createElement('canvas').getContext('2d');
export function measureCss(font, size, bold) { mctx.font = `${bold ? 'bold ' : ''}${size}px ${FONTS[font] || FONTS.Helvetica}`; return t => mctx.measureText(t).width; }
export function freetextLayout(a, measure) {
  const lf = localFrame(a.rect, a.rot || 0); const bw = a.bw || 0, pad = 2 + bw;
  const size = a.size || 12;
  const lines = wrapText(a.text || '', Math.max(4, lf.w - pad * 2), measure);
  return { lf, pad, size, lines, lead: size * LEADING, need: pad * 2 + lines.length * size * LEADING };
}
export function stampLayout(a) {
  const lf = localFrame(a.rect, a.rot || 0);
  const hasSub = !!a.sub; const H = lf.h, Wd = lf.w;
  const m = measureCss('Helvetica', 100, true);
  let size = Math.min(H * (hasSub ? 0.48 : 0.6), (Wd - 14) * 100 / Math.max(1, m(a.label || '')));
  return { lf, size, subSize: Math.min(H * 0.17, (Wd - 14) * 100 / Math.max(1, measureCss('Helvetica', 100)(a.sub || '')) ), hasSub };
}

const pw = (w, p) => w * (0.3 + 1.4 * (p ?? 0.5));
const mat = m => `matrix(${m.map(f2).join(' ')})`;
const pathPts = pts => pts.map((p, i) => (i ? 'L' : 'M') + f2(p[0]) + ' ' + f2(p[1])).join('');

// SVG markup for annotation `a` inside a <g> that already maps user space -> viewport.
export function svgFor(a, { sel = false } = {}) {
  const c = a.color || '#000', op = a.opacity ?? 1;
  const hit = `class="hit" data-id="${a.id}"`;
  switch (a.type) {
    case 'highlight': {
      const d = a.quads.map(q => `M${f2(q[0])} ${f2(q[1])}L${f2(q[2])} ${f2(q[3])}L${f2(q[6])} ${f2(q[7])}L${f2(q[4])} ${f2(q[5])}Z`).join('');
      return `<path class="hit mk" data-id="${a.id}" d="${d}" fill="${c}" fill-opacity="${op}"/>`;
    }
    case 'underline': case 'strike': case 'squiggly': {
      let d = '', hitd = '';
      for (const q of a.quads) {
        const ul = [q[0], q[1]], ur = [q[2], q[3]], ll = [q[4], q[5]], lr = [q[6], q[7]];
        const h = Math.hypot(ul[0] - ll[0], ul[1] - ll[1]); const nx = (ul[0] - ll[0]) / (h || 1), ny = (ul[1] - ll[1]) / (h || 1);
        hitd += `M${f2(q[0])} ${f2(q[1])}L${f2(q[2])} ${f2(q[3])}L${f2(q[6])} ${f2(q[7])}L${f2(q[4])} ${f2(q[5])}Z`;
        if (a.type === 'strike') { d += `M${f2((ul[0] + ll[0]) / 2)} ${f2((ul[1] + ll[1]) / 2)}L${f2((ur[0] + lr[0]) / 2)} ${f2((ur[1] + lr[1]) / 2)}`; }
        else if (a.type === 'underline') { const o = h * 0.08; d += `M${f2(ll[0] + nx * o)} ${f2(ll[1] + ny * o)}L${f2(lr[0] + nx * o)} ${f2(lr[1] + ny * o)}`; }
        else { d += squigglyPath(ll, lr, h).map((p, i) => (i ? 'L' : 'M') + f2(p[0]) + ' ' + f2(p[1])).join(''); }
      }
      const q0 = a.quads[0]; const h0 = q0 ? Math.hypot(q0[0] - q0[4], q0[1] - q0[5]) : 10;
      return `<path ${hit} d="${hitd}" fill="transparent"/><path d="${d}" fill="none" stroke="${c}" stroke-opacity="${op}" stroke-width="${f2(Math.max(0.6, h0 / 14))}" pointer-events="none"/>`;
    }
    case 'note': {
      const x = a.x, y = a.y;
      return `<g ${hit} opacity="${op}"><path d="M${x + 2} ${y - 2}H${x + 18}V${y - 14}H${x + 9}L${x + 5} ${y - 18.5}L${x + 6} ${y - 14}H${x + 2}Z" fill="${c}" stroke="#3a3a3a" stroke-width="1" stroke-linejoin="round"/>` +
        `<path d="M${x + 5} ${y - 5.5}H${x + 15}M${x + 5} ${y - 8.5}H${x + 15}M${x + 5} ${y - 11.5}H${x + 12}" stroke="#555" stroke-width="1"/></g>`;
    }
    case 'ink': {
      let s = `<g ${hit} opacity="${op}" fill="none" stroke="${c}" stroke-linecap="round" stroke-linejoin="round">`;
      for (const st of a.strokes) {
        if (st.length === 1) { s += `<circle cx="${f2(st[0][0])}" cy="${f2(st[0][1])}" r="${f2(pw(a.width, st[0][2]) / 2)}" fill="${c}" stroke="none"/>`; continue; }
        for (const seg of inkSegments(st, a.width)) s += `<path d="${pathPts(seg.pts)}" stroke-width="${f2(seg.w)}"/>`;
      }
      return s + `<path d="${a.strokes.map(pathPts).join('')}" stroke="transparent" stroke-width="${f2(Math.max(8, a.width * 2))}"/></g>`;
    }
    case 'rect': case 'ellipse': {
      const [x1, y1, x2, y2] = normRect(a.rect), w = a.width ?? 2, i = w / 2;
      const fill = a.fill ? `fill="${a.fill}"` : 'fill="transparent"';
      const sw = w > 0 ? `stroke="${c}" stroke-width="${w}"` : 'stroke="none"';
      if (a.type === 'rect') return `<rect ${hit} opacity="${op}" x="${f2(x1 + i)}" y="${f2(y1 + i)}" width="${f2(Math.max(0, x2 - x1 - w))}" height="${f2(Math.max(0, y2 - y1 - w))}" ${fill} ${sw}/>`;
      return `<ellipse ${hit} opacity="${op}" cx="${f2((x1 + x2) / 2)}" cy="${f2((y1 + y2) / 2)}" rx="${f2(Math.max(0, (x2 - x1 - w) / 2))}" ry="${f2(Math.max(0, (y2 - y1 - w) / 2))}" ${fill} ${sw}/>`;
    }
    case 'line': case 'arrow': {
      const w = a.width ?? 2; let s = `<g ${hit} opacity="${op}">`;
      const geo = lineGeo(a);
      s += `<path d="M${f2(a.p1[0])} ${f2(a.p1[1])}L${f2(geo.end[0])} ${f2(geo.end[1])}" stroke="${c}" stroke-width="${w}" stroke-linecap="${a.type === 'arrow' ? 'butt' : 'round'}"/>`;
      if (geo.head) s += `<path d="${pathPts(geo.head)}Z" fill="${c}" stroke="${c}" stroke-width="${f2(w * 0.5)}" stroke-linejoin="miter"/>`;
      return s + `<path d="M${f2(a.p1[0])} ${f2(a.p1[1])}L${f2(a.p2[0])} ${f2(a.p2[1])}" stroke="transparent" stroke-width="${Math.max(9, w * 3)}"/></g>`;
    }
    case 'freetext': {
      const L = freetextLayout(a, measureCss(a.font, a.size || 12, a.bold));
      const { lf, pad, size, lines, lead } = L, bw = a.bw || 0;
      let s = `<g ${hit} opacity="${op}" transform="${mat(lf.m)} translate(0 ${f2(lf.h)}) scale(1 -1)">`;
      s += `<rect x="${bw / 2}" y="${bw / 2}" width="${f2(Math.max(0, lf.w - bw))}" height="${f2(Math.max(0, lf.h - bw))}" fill="${a.fill || 'transparent'}" ${bw ? `stroke="${a.bcolor || c}" stroke-width="${bw}"` : ''}/>`;
      if (!a.text && !a.content) s += `<rect x="0" y="0" width="${f2(lf.w)}" height="${f2(lf.h)}" fill="none" stroke="#7aa6dd" stroke-dasharray="3 2" stroke-width=".8"/>`;
      s += `<text font-family='${FONTS[a.font] || FONTS.Helvetica}' font-size="${size}" ${a.bold ? 'font-weight="bold"' : ''} fill="${c}" style="white-space:pre">`;
      lines.forEach((ln, i) => { s += `<tspan x="${f2(pad + alignOff(a, ln, lf.w - pad * 2, measureCss(a.font, size, a.bold)))}" y="${f2(pad + ASCENT * size + i * lead)}">${esc(ln)}</tspan>`; });
      return s + '</text></g>';
    }
    case 'stamp': {
      const L = stampLayout(a); const { lf } = L; const bw = Math.max(1.5, lf.h * 0.06);
      let s = `<g ${hit} opacity="${op}" transform="${mat(lf.m)} translate(0 ${f2(lf.h)}) scale(1 -1)">`;
      s += `<rect x="${f2(bw / 2)}" y="${f2(bw / 2)}" width="${f2(lf.w - bw)}" height="${f2(lf.h - bw)}" rx="${f2(lf.h * 0.16)}" fill="${a.color}" fill-opacity="0.07" stroke="${a.color}" stroke-width="${f2(bw)}"/>`;
      const cy = L.hasSub ? lf.h * 0.52 : lf.h / 2 + L.size * 0.36;
      s += `<text x="${f2(lf.w / 2)}" y="${f2(cy)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-weight="bold" font-size="${f2(L.size)}" fill="${a.color}">${esc(a.label)}</text>`;
      if (L.hasSub) s += `<text x="${f2(lf.w / 2)}" y="${f2(lf.h * 0.8)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${f2(L.subSize)}" fill="${a.color}">${esc(a.sub)}</text>`;
      return s + '</g>';
    }
    case 'image': {
      const lf = localFrame(a.rect, a.rot || 0);
      return `<g ${hit} opacity="${op}" transform="${mat(lf.m)} translate(0 ${f2(lf.h)}) scale(1 -1)"><rect width="${f2(lf.w)}" height="${f2(lf.h)}" fill="transparent"/><image href="${a.dataUrl}" width="${f2(lf.w)}" height="${f2(lf.h)}" preserveAspectRatio="none"/></g>`;
    }
    case 'redact': {
      return `<g ${hit}>` + a.rects.map(r => { const [x1, y1, x2, y2] = normRect(r); return `<rect x="${f2(x1)}" y="${f2(y1)}" width="${f2(x2 - x1)}" height="${f2(y2 - y1)}" fill="#000" fill-opacity="0.18" stroke="#d01010" stroke-width="1.2" stroke-dasharray="4 2"/>`; }).join('') + '</g>';
    }
  }
  return '';
}
export function alignOff(a, ln, w, measure) { if (!a.align || a.align === 'left') return 0; const lw = measure(ln); return a.align === 'center' ? (w - lw) / 2 : w - lw; }

export function squigglyPath(ll, lr, h) {
  const len = Math.hypot(lr[0] - ll[0], lr[1] - ll[1]) || 1; const ux = (lr[0] - ll[0]) / len, uy = (lr[1] - ll[1]) / len;
  const nx = -uy, ny = ux; const step = Math.max(1.5, h / 6), amp = Math.max(0.8, h / 14);
  const pts = []; let t = 0, k = 0;
  while (t <= len) { const o = (k % 2 ? amp : -amp) + amp * 0.6; pts.push([ll[0] + ux * t + nx * o, ll[1] + uy * t + ny * o]); t += step; k++; }
  return pts;
}
// Split a stroke into runs of near-constant width (pressure)
export function inkSegments(st, width) {
  const segs = []; let cur = null;
  for (let i = 1; i < st.length; i++) {
    const w = Math.round(pw(width, (st[i - 1][2] + st[i][2]) / 2) * 4) / 4;
    if (!cur || Math.abs(cur.w - w) > 0.01) { cur = { w, pts: [st[i - 1]] }; segs.push(cur); }
    cur.pts.push(st[i]);
  }
  return segs;
}
export function lineGeo(a) {
  const w = a.width ?? 2; const [x1, y1] = a.p1, [x2, y2] = a.p2;
  if (a.type !== 'arrow') return { end: a.p2 };
  const len = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const L = Math.min(len * 0.6, Math.max(8, w * 4.2)), W = L * 0.42;
  const bx = x2 - ux * L, by = y2 - uy * L;
  return { end: [bx + ux * 0.5, by + uy * 0.5], head: [[x2, y2], [bx - uy * W, by + ux * W], [bx + uy * W, by - ux * W]] };
}
export { pw as pressureWidth };
