// Export: PDF -> Word (.docx built here: paragraphs, headings, lists, bold/italic runs, images),
// PDF -> images (all pages, ZIP), PDF -> plain text / Markdown (reflowed paragraphs, headings, lists).
import { App } from './state.js';
import { pdfjsLib, loadPdf } from './pdfjs.js';
import { buildOutput } from './writer.js';
import { makeZip } from './zip.js';
import { progressDialog, Cancelled } from './progress.js';
import { parseRanges, esc } from './util.js';
import { interpret, pageContentString, pageResources } from './content.js';
const OPS = pdfjsLib.OPS;

/* ---------- layout analysis ---------- */
const BULLET = /^([••●▪‣⁃◦\-–*·▪■]|\(?\d{1,3}[.)]|[a-z][.)])\s+/;
async function fontInfo(page, id) {
  try { const f = page.commonObjs.has(id) ? page.commonObjs.get(id) : null; if (!f) return { b: false, i: false }; const n = String(f.name || f.loadedName || ''); return { b: !!(f.bold || f.black || /Bold|Black|Heavy|Semibold/i.test(n)), i: !!(f.italic || /Italic|Oblique/i.test(n)), name: n }; }
  catch (e) { return { b: false, i: false }; }
}
export async function analyzePage(page, { images = true, cancelled, rules = null } = {}) {
  const vp = page.getViewport({ scale: 1 });
  const opList = await page.getOperatorList();
  const tc = await page.getTextContent();
  const fonts = new Map();
  const items = [];
  for (const it of tc.items) {
    if (!it.str) continue;
    if (!fonts.has(it.fontName)) fonts.set(it.fontName, await fontInfo(page, it.fontName));
    const T = it.transform; const [x, y] = vp.convertToViewportPoint(T[4], T[5]);
    const size = it.height || Math.hypot(T[2], T[3]) || 10; const horiz = Math.abs(T[1]) < 0.01 * Math.abs(T[0]) && T[0] > 0;
    items.push({ str: it.str, x, y, w: it.width, size, f: fonts.get(it.fontName), eol: it.hasEOL, horiz });
  }
  // tables drawn with ruled lines: grid from the vector rules, text assigned to cells
  const tables = rules ? ruledTables(rules, items) : [];
  const free = items.filter(it => !it.used);
  // lines
  const lines = [];
  for (const it of free) {
    if (!it.str.trim() && !lines.length) continue;
    const ln = it.horiz && lines.find(l => l.horiz && Math.abs(l.y - it.y) < Math.max(1.5, 0.4 * Math.min(l.size, it.size)) && it.x > l.x0 - 2 && it.x - l.x1 < 4 * it.size);
    if (ln) { ln.items.push(it); ln.x1 = Math.max(ln.x1, it.x + it.w); ln.size = Math.max(ln.size, it.size); }
    else if (it.str.trim()) lines.push({ y: it.y, x0: it.x, x1: it.x + it.w, size: it.size, horiz: it.horiz, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x); const runs = []; let prevEnd = null;
    for (const it of l.items) {
      let s = it.str; if (prevEnd != null && it.x - prevEnd > it.size * 0.18 && !/\s$/.test(runs.at(-1)?.t || '') && !/^\s/.test(s)) s = ' ' + s;
      const last = runs.at(-1); if (last && last.b === it.f.b && last.i === it.f.i) last.t += s; else runs.push({ t: s, b: it.f.b, i: it.f.i });
      prevEnd = it.x + it.w;
    }
    l.runs = runs; l.text = runs.map(r => r.t).join('').replace(/\s+/g, ' ').trim(); l.bold = runs.every(r => r.b || !r.t.trim());
  }
  lines.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  // vector bullets (small filled dots/squares drawn just left of a line)
  try {
    let m = [1, 0, 0, 1, 0, 0]; const st = []; const marks = [];
    const mul2 = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
    opList.fnArray.forEach((op, k) => {
      const a = opList.argsArray[k];
      if (op === OPS.save) st.push(m); else if (op === OPS.restore) m = st.pop() || m; else if (op === OPS.transform) m = mul2(a, m);
      else if (op === OPS.constructPath) {
        const mm = a?.[a.length - 1]; if (!mm || mm.length !== 4) return;
        const pts = [[mm[0], mm[1]], [mm[2], mm[3]]].map(([x, y]) => vp.convertToViewportPoint(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]));
        const w = Math.abs(pts[1][0] - pts[0][0]), h = Math.abs(pts[1][1] - pts[0][1]);
        if (w >= 1.5 && w <= 8 && h >= 1.5 && h <= 8 && Math.abs(w - h) < 1.5) marks.push([(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2]);
      }
    });
    for (const l of lines) if (marks.some(([cx, cy]) => cx < l.x0 && l.x0 - cx < 28 && Math.abs(cy - (l.y - l.size * 0.33)) < l.size * 0.6)) l.bullet = true;
  } catch (e) { /* operator format not understood */ }
  // tables made of aligned text columns (no rules)
  tables.push(...alignedTables(lines));
  for (let k = lines.length - 1; k >= 0; k--) if (lines[k].used) lines.splice(k, 1);
  // body font size (by characters)
  const hist = new Map(); for (const l of lines) { const k = Math.round(l.size * 2) / 2; hist.set(k, (hist.get(k) || 0) + l.text.length); }
  const body = [...hist.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 11;
  const left = Math.min(...lines.map(l => l.x0), vp.width), right = Math.max(...lines.map(l => l.x1), 0); const colW = Math.max(1, right - left);
  // paragraphs
  const paras = []; let cur = null;
  for (const l of lines) {
    const startsList = BULLET.test(l.text) || l.bullet;
    const sameStyle = cur && Math.abs(cur.size - l.size) < cur.size * 0.15 && cur.bold === l.bold;
    const gap = cur ? l.y - cur.lastY : Infinity;
    const prevShort = cur && cur.lastW < colW * 0.72 && !cur.list;
    if (cur && sameStyle && gap > 0 && gap < l.size * 1.75 && !startsList && !prevShort && Math.abs(l.x0 - cur.x0) < l.size * 6) {
      cur.runs.push({ t: ' ', b: false, i: false }, ...l.runs); cur.lastY = l.y; cur.lastW = l.x1 - l.x0; cur.text += ' ' + l.text;
    } else {
      cur = { kind: 'p', y: l.y - l.size, x0: l.x0, size: l.size, bold: l.bold, runs: l.runs.map(r => ({ ...r })), lastY: l.y, lastW: l.x1 - l.x0, text: l.text, list: startsList ? (!l.bullet && /^\(?\d/.test(l.text) ? 'num' : 'bullet') : null, vb: !!l.bullet };
      paras.push(cur);
    }
  }
  for (const p of paras) {
    const r = p.size / body;
    p.level = r >= 1.5 ? 1 : r >= 1.2 ? 2 : (r >= 1.08 || (p.bold && p.text.length < 90 && !p.list && !/[.:;,]$/.test(p.text))) && p.text.length < 140 ? 3 : 0;
    if (p.level) p.list = null;
    if (p.list && !p.vb) {
      p.text = p.text.replace(BULLET, '');
      for (const run of p.runs) { const t = run.t.replace(/^\s+/, ''); if (!t) { run.t = ''; continue; } run.t = t.replace(BULLET, ''); if (run.t === t && BULLET.test(t + ' ')) run.t = ''; break; }
      while (p.runs.length && !p.runs[0].t.trim()) p.runs.shift();
      if (p.runs[0]) p.runs[0].t = p.runs[0].t.replace(/^\s+/, '');
    }
    p.runs = p.runs.map(r => ({ ...r, t: r.t.replace(/\s+/g, ' ') })).filter(r => r.t);
  }
  // images (bounding boxes from the operator list)
  const imgs = [];
  if (images) {
    let m = [1, 0, 0, 1, 0, 0]; const stack = [];
    const mul = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3], a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
    const { fnArray: fn, argsArray: args } = opList;
    for (let k = 0; k < fn.length; k++) {
      const op = fn[k];
      if (op === OPS.save) stack.push(m); else if (op === OPS.restore) m = stack.pop() || m;
      else if (op === OPS.transform) m = mul(args[k], m);
      else if (op === OPS.paintFormXObjectBegin) { stack.push(m); if (args[k]?.[0]) m = mul(args[k][0], m); } else if (op === OPS.paintFormXObjectEnd) m = stack.pop() || m;
      else if (op === OPS.paintImageXObject || op === OPS.paintInlineImageXObject || op === OPS.paintImageXObjectRepeat) {
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => vp.convertToViewportPoint(m[0] * u + m[2] * v + m[4], m[1] * u + m[3] * v + m[5]));
        const x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
        if (x1 - x0 < 24 || y1 - y0 < 24) continue;
        if ((x1 - x0) * (y1 - y0) > vp.width * vp.height * 0.8 && paras.length) continue; // scanned background under OCR text
        imgs.push({ kind: 'img', x0: Math.max(0, x0), y0: Math.max(0, y0), x1: Math.min(vp.width, x1), y1: Math.min(vp.height, y1), y: y0 });
      }
    }
  }
  if (cancelled?.()) throw new Cancelled();
  return { w: vp.width, h: vp.height, body, blocks: [...paras, ...imgs, ...tables].sort((a, b) => a.y - b.y) };
}
async function cropImages(page, layout, dpi = 150) {
  const imgs = layout.blocks.filter(b => b.kind === 'img'); if (!imgs.length) return;
  const vp = page.getViewport({ scale: dpi / 72 }); const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  await page.render({ canvas: c, viewport: vp, annotationMode: 0 }).promise;
  const s = dpi / 72;
  for (const im of imgs) {
    const w = Math.max(1, Math.round((im.x1 - im.x0) * s)), h = Math.max(1, Math.round((im.y1 - im.y0) * s));
    const o = document.createElement('canvas'); o.width = w; o.height = h; o.getContext('2d').drawImage(c, Math.round(im.x0 * s), Math.round(im.y0 * s), w, h, 0, 0, w, h);
    im.png = new Uint8Array(await (await new Promise(r => o.toBlob(r, 'image/png'))).arrayBuffer()); im.pw = w; im.ph = h; o.width = 0;
  }
  c.width = 0;
}
async function layoutDoc(bytes, { pages = 'all', images = true, prog } = {}) {
  const pdf = await loadPdf(bytes, { fontExtraProperties: true }); const idx = parseRanges(pages, pdf.numPages); const out = []; let lib = null;
  try {
    for (let k = 0; k < idx.length; k++) {
      if (prog?.cancelled) throw new Cancelled();
      prog?.set(k / idx.length, `Analyzing page ${idx[k] + 1} of ${pdf.numPages}…`);
      const page = await pdf.getPage(idx[k] + 1);
      let rules = null; try { lib ||= await window.PDFLib.PDFDocument.load(bytes, { updateMetadata: false }); rules = pageRules(lib, idx[k], page.getViewport({ scale: 1 })); } catch (e) { rules = null; }
      const l = await analyzePage(page, { images, rules, cancelled: () => prog?.cancelled });
      if (images) await cropImages(page, l); out.push(l);
    }
  } finally { pdf.destroy ? pdf.destroy() : pdf.loadingTask.destroy(); }
  return out;
}

/* ---------- tables ---------- */
// horizontal / vertical rules of a page in viewport coordinates (top-down), from the content stream
export function pageRules(lib, i, vp) {
  const pg = lib.getPages()[i]; const res = interpret(lib.context, pageContentString(pg), pageResources(pg), { paths: true });
  const H = [], V = [];
  const P = (x, y) => vp.convertToViewportPoint(x, y);
  for (const p of res.paths) {
    const stroked = /^[SsBb]/.test(p.paint);
    for (const sg of p.segs) {
      if (sg.t === 're') {
        const q = sg.pts.map(pt => P(pt[0], pt[1])); const x0 = Math.min(...q.map(v => v[0])), x1 = Math.max(...q.map(v => v[0])), y0 = Math.min(...q.map(v => v[1])), y1 = Math.max(...q.map(v => v[1]));
        if (y1 - y0 <= 2.2 && x1 - x0 >= 4) H.push({ y: (y0 + y1) / 2, x0, x1 }); else if (x1 - x0 <= 2.2 && y1 - y0 >= 4) V.push({ x: (x0 + x1) / 2, y0, y1 });
        else if (stroked) { H.push({ y: y0, x0, x1 }, { y: y1, x0, x1 }); V.push({ x: x0, y0, y1 }, { x: x1, y0, y1 }); }
      } else if (sg.t === 'l' && stroked && sg.a) {
        const [x0, y0] = P(sg.a[0], sg.a[1]), [x1, y1] = P(sg.p[0], sg.p[1]);
        if (Math.abs(y0 - y1) < 0.8 && Math.abs(x1 - x0) >= 4) H.push({ y: (y0 + y1) / 2, x0: Math.min(x0, x1), x1: Math.max(x0, x1) });
        else if (Math.abs(x0 - x1) < 0.8 && Math.abs(y1 - y0) >= 4) V.push({ x: (x0 + x1) / 2, y0: Math.min(y0, y1), y1: Math.max(y0, y1) });
      }
    }
  }
  return { H, V };
}
const uniq = (vals, tol) => { const out = []; for (const v of vals.slice().sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > tol) out.push(v); return out; };
function cellRuns(items) {
  items.sort((a, b) => a.y - b.y || a.x - b.x); const runs = []; let prev = null;
  for (const it of items) {
    let t = it.str; if (prev && (Math.abs(prev.y - it.y) > it.size * 0.4 || it.x - (prev.x + prev.w) > it.size * 0.18) && !/^\s/.test(t)) t = ' ' + t;
    const last = runs.at(-1); if (last && last.b === it.f.b && last.i === it.f.i) last.t += t; else runs.push({ t, b: it.f.b, i: it.f.i }); prev = it;
  }
  const out = runs.map(r => ({ ...r, t: r.t.replace(/\s+/g, ' ') })); if (out[0]) out[0].t = out[0].t.replace(/^\s+/, ''); if (out.at(-1)) out.at(-1).t = out.at(-1).t.replace(/\s+$/, '');
  return out.filter(r => r.t);
}
function makeTable(colXs, rowYs, cellItems, ruled, size) {
  const rows = [];
  for (let r = 0; r < rowYs.length - 1; r++) { const row = []; for (let c = 0; c < colXs.length - 1; c++) { const its = cellItems[r][c]; const runs = cellRuns(its); row.push({ runs, text: runs.map(x => x.t).join('').trim() }); } rows.push(row); }
  // drop empty rows / columns created by decorative rules
  const keepR = rows.map(r => r.some(c => c.text)); const keepC = colXs.slice(0, -1).map((_, c) => rows.some(r => r[c].text));
  const widths = colXs.slice(0, -1).map((x, c) => colXs[c + 1] - x).filter((_, c) => keepC[c]);
  const out = rows.filter((_, r) => keepR[r]).map(r => r.filter((_, c) => keepC[c]));
  if (out.length < 1 || widths.length < 2 || out.length * widths.length < 4) return null;
  return { kind: 'table', y: rowYs[0], x0: colXs[0], widths, rows: out, ruled, size };
}
function ruledTables({ H, V }, items) {
  if (!H.length || !V.length) return [];
  // connected components of touching rules
  const n = H.length + V.length; const parent = Array.from({ length: n }, (_, k) => k);
  const find = k => parent[k] === k ? k : (parent[k] = find(parent[k]));
  const touch = (h, v) => v.x >= h.x0 - 2.5 && v.x <= h.x1 + 2.5 && h.y >= v.y0 - 2.5 && h.y <= v.y1 + 2.5;
  for (let a = 0; a < H.length; a++) for (let b = 0; b < V.length; b++) if (touch(H[a], V[b])) parent[find(a)] = find(H.length + b);
  const groups = new Map(); for (let k = 0; k < n; k++) { const r = find(k); if (!groups.has(r)) groups.set(r, { hs: [], vs: [] }); if (k < H.length) groups.get(r).hs.push(H[k]); else groups.get(r).vs.push(V[k - H.length]); }
  const out = [];
  for (const { hs, vs } of groups.values()) {
    if (hs.length < 2 || vs.length < 2) continue;
    const rowYs = uniq(hs.map(h => h.y), 2.5), colXs = uniq(vs.map(v => v.x), 2.5);
    if (rowYs.length < 2 || colXs.length < 3) continue; // at least two columns
    const bx = [colXs[0], rowYs[0], colXs[colXs.length - 1], rowYs[rowYs.length - 1]];
    if (bx[2] - bx[0] < 30 || bx[3] - bx[1] < 10) continue;
    const cellItems = rowYs.slice(0, -1).map(() => colXs.slice(0, -1).map(() => []));
    const inside = [];
    for (const it of items) {
      if (it.used || !it.horiz || !it.str.trim()) continue; const cx = it.x + it.w / 2, cy = it.y - it.size * 0.35;
      if (cx < bx[0] || cx > bx[2] || cy < bx[1] || cy > bx[3]) continue;
      const c = colXs.findIndex((x, k) => k < colXs.length - 1 && cx >= x && cx <= colXs[k + 1]), r = rowYs.findIndex((y, k) => k < rowYs.length - 1 && cy >= y && cy <= rowYs[k + 1]);
      if (c < 0 || r < 0) continue; cellItems[r][c].push(it); inside.push(it);
    }
    if (!inside.length) continue;
    const t = makeTable(colXs, rowYs, cellItems, true, Math.max(...inside.map(i => i.size)));
    if (t) { for (const it of items) { const cx = it.x + it.w / 2, cy = it.y - it.size * 0.35; if (cx >= bx[0] && cx <= bx[2] && cy >= bx[1] && cy <= bx[3]) it.used = true; } out.push(t); }
  }
  return out;
}
// rows of text split into columns by wide gaps, consistently across >= 3 consecutive rows
function alignedTables(lines) {
  const rows = [];
  for (const l of lines.slice().sort((a, b) => a.y - b.y)) { if (!l.horiz) continue; const r = rows.at(-1); if (r && Math.abs(r.y - l.y) < 0.5 * Math.min(r.size, l.size)) { r.lines.push(l); r.size = Math.max(r.size, l.size); } else rows.push({ y: l.y, size: l.size, lines: [l] }); }
  for (const r of rows) {
    const its = r.lines.flatMap(l => l.items).filter(i => i.str.trim()).sort((a, b) => a.x - b.x); const segs = []; let cur = null;
    for (const it of its) { if (cur && it.x - cur.x1 <= Math.max(0.8 * it.size, 6)) { cur.items.push(it); cur.x1 = Math.max(cur.x1, it.x + it.w); } else { cur = { x0: it.x, x1: it.x + it.w, items: [it] }; segs.push(cur); } }
    r.segs = segs;
  }
  const out = []; let k = 0;
  while (k < rows.length) {
    if (rows[k].segs.length < 2) { k++; continue; }
    let e = k; while (e + 1 < rows.length && rows[e + 1].segs.length >= 2 && rows[e + 1].y - rows[e].y < rows[e].size * 3) e++;
    const run = rows.slice(k, e + 1);
    if (run.length >= 3) {
      // column bands from the rows with the most cells; other rows (totals, spanning labels) map by overlap
      const maxN = Math.max(...run.map(r => r.segs.length)); const full = run.filter(r => r.segs.length === maxN);
      const bands = []; for (const s of full.flatMap(r => r.segs).sort((a, b) => a.x0 - b.x0)) { const b = bands.at(-1); if (b && s.x0 <= b.x1 + 2) b.x1 = Math.max(b.x1, s.x1); else bands.push({ x0: s.x0, x1: s.x1 }); }
      const ov = (s, b) => Math.min(s.x1, b.x1) - Math.max(s.x0, b.x0);
      const bandOf = s => { const st = bands.findIndex(b => s.x0 >= b.x0 - 2 && s.x0 <= b.x1); if (st >= 0) return st; let best = -1, bv = -Infinity; bands.forEach((b, i) => { const o = ov(s, b) - (s.x0 > b.x1 ? (s.x0 - b.x1) : 0); if (o > bv) { bv = o; best = i; } }); return best; };
      const ok = bands.length >= 2 && bands.length === maxN && full.length >= Math.max(2, run.length * 0.5) && full.every(r => new Set(r.segs.map(bandOf)).size === r.segs.length);
      if (ok) {
        const colXs = [...bands.map(b => b.x0), bands.at(-1).x1 + 4];
        const rowYs = [...run.map(r => r.y - r.size), run.at(-1).y + run.at(-1).size * 0.4];
        const cellItems = run.map(r => bands.map((b, bi) => r.segs.filter(s => bandOf(s) === bi).flatMap(s => s.items)));
        const t = makeTable(colXs, rowYs, cellItems, false, Math.max(...run.map(r => r.size)));
        if (t) { run.forEach(r => r.lines.forEach(l => { l.used = true; })); out.push(t); }
      }
    }
    k = e + 1;
  }
  return out;
}
function docxTable(b, pg) {
  const total = b.widths.reduce((x, y) => x + y, 0); const maxW = (pg.w - 108) * 20; const sc = Math.min(1, maxW / Math.max(1, total * 20));
  const tw = b.widths.map(w => Math.round(w * 20 * sc)); const bd = b.ruled ? 'single' : 'none';
  const borders = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(k => `<w:${k} w:val="${bd}" w:sz="4" w:space="0" w:color="808080"/>`).join('')}</w:tblBorders>`;
  let x = `<w:tbl><w:tblPr><w:tblW w:w="${tw.reduce((p, q) => p + q, 0)}" w:type="dxa"/>${borders}<w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${tw.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  for (const row of b.rows) x += `<w:tr>${row.map((c, ci) => `<w:tc><w:tcPr><w:tcW w:w="${tw[ci]}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:after="0"/></w:pPr>${c.runs.map(r => `<w:r>${r.b || r.i ? `<w:rPr>${r.b ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}</w:rPr>` : ''}<w:t xml:space="preserve">${X(r.t)}</w:t></w:r>`).join('')}</w:p></w:tc>`).join('')}</w:tr>`;
  return x + '</w:tbl><w:p><w:pPr><w:spacing w:after="0"/></w:pPr></w:p>';
}
function mdTable(b) {
  const cell = c => c.text.replace(/\|/g, '\\|').replace(/\s+/g, ' ') || ' ';
  const out = []; b.rows.forEach((r, ri) => { out.push('| ' + r.map(cell).join(' | ') + ' |'); if (ri === 0) out.push('|' + r.map(() => ' --- ').join('|') + '|'); });
  return out;
}

/* ---------- DOCX ---------- */
const X = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
export async function buildDocx(pagesLayout, { title = 'Document' } = {}) {
  const media = []; let body = ''; let rid = 10; let pid = 1;
  pagesLayout.forEach((pg, pi) => {
    for (const b of pg.blocks) {
      if (b.kind === 'img') {
        if (!b.png) continue; const id = 'rId' + (rid++); const n = media.length + 1; media.push({ name: `image${n}.png`, data: b.png, id });
        let cx = (b.x1 - b.x0) * 12700, cy = (b.y1 - b.y0) * 12700; const maxW = (pg.w - 72 * 1.5) * 12700; if (cx > maxW) { cy = cy * maxW / cx; cx = maxW; }
        cx = Math.round(cx); cy = Math.round(cy); const did = pid++;
        body += `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${did}" name="Picture ${did}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${did}" name="image${n}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
        continue;
      }
      if (b.kind === 'table') { body += docxTable(b, pg); continue; }
      const ppr = b.level ? `<w:pPr><w:pStyle w:val="Heading${b.level}"/></w:pPr>` : b.list ? `<w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${b.list === 'num' ? 2 : 1}"/></w:numPr></w:pPr>` : '';
      const sz = !b.level && Math.abs(b.size - pg.body) > 0.6 ? `<w:sz w:val="${Math.round(b.size * 2)}"/>` : '';
      const runs = b.runs.map(r => `<w:r>${(r.b && !b.level) || r.i || sz ? `<w:rPr>${r.b && !b.level ? '<w:b/>' : ''}${r.i ? '<w:i/>' : ''}${sz}</w:rPr>` : ''}<w:t xml:space="preserve">${X(r.t)}</w:t></w:r>`).join('');
      body += `<w:p>${ppr}${runs}</w:p>`;
    }
    if (pi < pagesLayout.length - 1) body += '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  });
  const first = pagesLayout[0] || { w: 612, h: 792 };
  const sect = `<w:sectPr><w:pgSz w:w="${Math.round(first.w * 20)}" w:h="${Math.round(first.h * 20)}"${first.w > first.h ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>`;
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}${sect}</w:body></w:document>`;
  const H = (id, sz, color) => `<w:style w:type="paragraph" w:styleId="Heading${id}"><w:name w:val="heading ${id}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:uiPriority w:val="9"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="${id === 1 ? 360 : 240}" w:after="120"/><w:outlineLvl w:val="${id - 1}"/></w:pPr><w:rPr><w:b/><w:color w:val="${color}"/><w:sz w:val="${sz}"/></w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="${Math.round((first.body || 11) * 2)}"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${H(1, 36, '1F3864')}${H(2, 28, '2E74B5')}${H(3, 24, '1F4D78')}<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr></w:style></w:styles>`;
  const lvl = (fmt, text) => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>${fmt === 'bullet' ? '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>' : ''}</w:lvl>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0">${lvl('bullet', '')}</w:abstractNum><w:abstractNum w:abstractNumId="1">${lvl('decimal', '%1.')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${media.map(m => `<Relationship Id="${m.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join('')}</Relationships>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${X(title)}</dc:title><dc:creator>Lumen PDF</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Lumen PDF</Application></Properties>` },
    { name: 'word/document.xml', data: doc }, { name: 'word/styles.xml', data: styles }, { name: 'word/numbering.xml', data: numbering },
    { name: 'word/_rels/document.xml.rels', data: rels },
    ...media.map(m => ({ name: 'word/media/' + m.name, data: m.data, store: true }))
  ];
  return makeZip(files);
}

/* ---------- text / markdown ---------- */
export function toMarkdown(pagesLayout) {
  const out = [];
  pagesLayout.forEach((pg, pi) => {
    let num = 0;
    for (const b of pg.blocks) {
      if (b.kind === 'img') continue;
      if (b.kind === 'table') { if (out.at(-1) !== '') out.push(''); out.push(...mdTable(b), ''); num = 0; continue; }
      if (b.level) { if (/^(- |\d+\. )/.test(out.at(-1) || '')) out.push(''); out.push('#'.repeat(b.level) + ' ' + b.text.replace(/\s+/g, ' ').trim(), ''); num = 0; continue; }
      const md = b.runs.map(r => { const t = r.t.replace(/([\\`*_[\]#])/g, '\\$1'); const core = t.trim(); if (!core || (!r.b && !r.i)) return t; const lead = t.match(/^\s*/)[0], trail = t.match(/\s*$/)[0]; const w = r.b && r.i ? '***' : r.b ? '**' : '*'; return lead + w + core + w + trail; }).join('').replace(/\s+/g, ' ').trim();
      if (b.list) out.push(b.list === 'num' ? `${++num}. ${md}` : `- ${md}`); else { if (num || out.at(-1)?.startsWith('- ')) out.push(''); num = 0; out.push(md, ''); }
    }
    if (out.at(-1) !== '') out.push('');
    if (pi < pagesLayout.length - 1) out.push('---', '');
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
export function toText(pagesLayout) {
  return pagesLayout.map(pg => { let n = 0; return pg.blocks.filter(b => b.kind !== 'img').map(b => { if (b.kind === 'table') { n = 0; return b.rows.map(r => r.map(c => c.text).join('\t')).join('\n'); } const pre = b.list === 'num' ? `${++n}. ` : b.list ? '• ' : ((n = 0), ''); return pre + b.text.replace(/\s+/g, ' ').trim(); }).join('\n\n'); }).join('\n\n\f\n\n').trim() + '\n';
}

/* ---------- dialogs ---------- */
async function sourceBytes(d) { return (await buildOutput(d.state, {})).bytes; }
export function exportWordDialog() {
  const d = App.doc; if (!d) return;
  Aero.dialog({
    title: 'Export to Word', width: 480, instruction: 'Convert the document to an editable Word file (.docx)',
    fields: [{ key: 'pages', label: 'Pages', type: 'text', value: 'all' }, { key: 'images', label: 'Include images', type: 'checkbox', value: true }],
    html: '<div class="dnote">Text is reflowed into paragraphs with headings, lists, bold and italic. Scanned pages need <b>Tools › Recognize Text (OCR)</b> first.</div>', ok: 'Export',
    onOK: v => exportWord({ pages: v.pages, images: v.images })
  });
}
export async function exportWord({ pages = 'all', images = true, save = true } = {}) {
  const d = App.doc; const prog = progressDialog('Export to Word', `Converting “${d.name}”`);
  try {
    const lay = await layoutDoc(await sourceBytes(d), { pages, images, prog });
    prog.set(0.95, 'Writing the Word document…');
    const bytes = await buildDocx(lay, { title: d.state.props.title || Aero.baseName(d.name) }); prog.close();
    if (save) await Aero.saveFile({ name: Aero.baseName(d.name) + '.docx', data: new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), filters: [{ name: 'Word document', extensions: ['docx'] }] });
    return bytes;
  } catch (e) { prog.close(); if (!(e instanceof Cancelled)) Aero.alert('Export to Word', e.message || String(e)); return null; }
}
export function exportTextDialog(kind = 'md') {
  const d = App.doc; if (!d) return;
  Aero.dialog({
    title: kind === 'md' ? 'Export to Markdown' : 'Export to text', width: 440,
    fields: [{ key: 'pages', label: 'Pages', type: 'text', value: 'all' }], ok: 'Export',
    onOK: v => exportText({ kind, pages: v.pages })
  });
}
export async function exportText({ kind = 'md', pages = 'all', save = true } = {}) {
  const d = App.doc; const prog = progressDialog(kind === 'md' ? 'Export to Markdown' : 'Export to text', `Converting “${d.name}”`);
  try {
    const lay = await layoutDoc(await sourceBytes(d), { pages, images: false, prog }); prog.close();
    const txt = kind === 'md' ? toMarkdown(lay) : toText(lay);
    if (save) await Aero.saveFile({ name: Aero.baseName(d.name) + (kind === 'md' ? '.md' : '.txt'), data: txt, filters: [{ name: kind === 'md' ? 'Markdown' : 'Text', extensions: [kind === 'md' ? 'md' : 'txt'] }] });
    return txt;
  } catch (e) { prog.close(); if (!(e instanceof Cancelled)) Aero.alert('Export', e.message || String(e)); return null; }
}
export function exportImagesDialog() {
  const d = App.doc; if (!d) return;
  Aero.dialog({
    title: 'Export pages as images', width: 460, instruction: 'Save every page as an image, packed in a ZIP file',
    fields: [{ key: 'pages', label: 'Pages', type: 'text', value: 'all' }, { key: 'fmt', label: 'Format', type: 'select', value: 'png', options: [['png', 'PNG (lossless)'], ['jpeg', 'JPEG (smaller)']] }, { key: 'dpi', label: 'Resolution', type: 'select', value: '150', options: [['72', '72 dpi'], ['150', '150 dpi'], ['300', '300 dpi']] }, { key: 'ann', label: 'Include annotations', type: 'checkbox', value: true }],
    ok: 'Export', onOK: v => exportImages({ pages: v.pages, fmt: v.fmt, dpi: +v.dpi, annots: v.ann })
  });
}
export async function exportImages({ pages = 'all', fmt = 'png', dpi = 150, annots = true, save = true } = {}) {
  const d = App.doc; const prog = progressDialog('Export pages as images', `Rendering “${d.name}”`);
  let pdf;
  try {
    const { bytes } = await buildOutput(d.state, annots ? {} : { annots: false }); pdf = await loadPdf(bytes);
    const idx = parseRanges(pages, pdf.numPages); const files = []; const base = Aero.baseName(d.name).replace(/[\\/:*?"<>|]/g, '_');
    for (let k = 0; k < idx.length; k++) {
      if (prog.cancelled) throw new Cancelled();
      prog.set(k / idx.length, `Page ${idx[k] + 1} of ${pdf.numPages}…`);
      const page = await pdf.getPage(idx[k] + 1); const vp = page.getViewport({ scale: dpi / 72 });
      const c = document.createElement('canvas'); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
      await page.render({ canvas: c, viewport: vp, annotationMode: 1 }).promise;
      const blob = await new Promise(r => c.toBlob(r, fmt === 'png' ? 'image/png' : 'image/jpeg', 0.9)); c.width = 0;
      files.push({ name: `${base} - page ${String(idx[k] + 1).padStart(3, '0')}.${fmt === 'png' ? 'png' : 'jpg'}`, data: new Uint8Array(await blob.arrayBuffer()), store: true });
    }
    prog.set(1, 'Packing ZIP…'); const zip = await makeZip(files); prog.close();
    if (save) await Aero.saveFile({ name: base + ' - pages.zip', data: new Blob([zip], { type: 'application/zip' }), filters: [{ name: 'ZIP archive', extensions: ['zip'] }] });
    return zip;
  } catch (e) { prog.close(); if (!(e instanceof Cancelled)) Aero.alert('Export pages as images', e.message || String(e)); return null; }
  finally { if (pdf) pdf.destroy ? pdf.destroy() : pdf.loadingTask.destroy(); }
}
export { layoutDoc, esc };
