// Shared helpers for Lumen PDF
export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const uid = () => Math.random().toString(36).slice(2, 10);

export function hex2rgb(h) {
  h = String(h || '#000000').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16) || 0;
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
export function rgb2hex(c) {
  if (!c || !c.length) return null;
  if (c.length === 1) c = [c[0], c[0], c[0]];
  if (c.length === 4) { const [C, M, Y, K] = c; c = [(1 - C) * (1 - K), (1 - M) * (1 - K), (1 - Y) * (1 - K)]; }
  return '#' + c.slice(0, 3).map(v => Math.round(clamp(+v || 0, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
}
export const f2 = n => (Math.round(n * 1000) / 1000).toString();
export const rgbOp = h => hex2rgb(h).map(f2).join(' ');

export function normRect(r) { const [a, b, c, d] = r; return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]; }
export function bboxPts(pts, pad = 0) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) { if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0]; if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1]; }
  return [x1 - pad, y1 - pad, x2 + pad, y2 + pad];
}
export function unionRect(a, b) { return a ? [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])] : b.slice(); }
export function rectsIntersect(a, b) { return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1]; }
export function quadBox(q) { return bboxPts([[q[0], q[1]], [q[2], q[3]], [q[4], q[5]], [q[6], q[7]]]); }

// Local "upright" frame for a rect on a page with /Rotate rot, so text reads upright on the displayed page.
// Returns matrix [a b c d e f] mapping local (u,v) (origin at displayed bottom-left) to user space, plus local w/h.
export function localFrame(rect, rot) {
  const [x1, y1, x2, y2] = normRect(rect);
  switch (((rot % 360) + 360) % 360) {
    case 90: return { m: [0, 1, -1, 0, x2, y1], w: y2 - y1, h: x2 - x1 };
    case 180: return { m: [-1, 0, 0, -1, x2, y2], w: x2 - x1, h: y2 - y1 };
    case 270: return { m: [0, -1, 1, 0, x1, y2], w: y2 - y1, h: x2 - x1 };
    default: return { m: [1, 0, 0, 1, x1, y1], w: x2 - x1, h: y2 - y1 };
  }
}

export function dataUrlToBytes(url) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url || '');
  if (!m) return null;
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return { mime: m[1] || 'application/octet-stream', bytes: out };
}
export function bytesToDataUrl(bytes, mime) {
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return `data:${mime};base64,${btoa(s)}`;
}
export function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Could not decode image')); i.src = src; });
}
// Any image bytes -> {dataUrl (png or jpeg), w, h}
export async function imageFileToDataUrl(bytes, name = '') {
  const isJpg = bytes[0] === 0xFF && bytes[1] === 0xD8, isPng = bytes[0] === 0x89 && bytes[1] === 0x50;
  const mime = isJpg ? 'image/jpeg' : isPng ? 'image/png' : (/\.webp$/i.test(name) ? 'image/webp' : /\.gif$/i.test(name) ? 'image/gif' : /\.bmp$/i.test(name) ? 'image/bmp' : 'image/png');
  const blobUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
  try {
    const img = await loadImage(blobUrl);
    if (isJpg || isPng) return { dataUrl: bytesToDataUrl(bytes, mime), w: img.naturalWidth, h: img.naturalHeight };
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return { dataUrl: c.toDataURL('image/png'), w: c.width, h: c.height };
  } finally { URL.revokeObjectURL(blobUrl); }
}

export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso); if (isNaN(d)) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
export function fmtBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB'; }

// "1-3, 5, 8-" -> sorted unique 0-based indices within [0,n)
export function parseRanges(s, n) {
  s = String(s || '').trim().toLowerCase();
  if (!s || s === 'all') return [...Array(n).keys()];
  const out = new Set();
  for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
    if (part === 'odd') { for (let i = 0; i < n; i += 2) out.add(i); continue; }
    if (part === 'even') { for (let i = 1; i < n; i += 2) out.add(i); continue; }
    const m = /^(\d*)\s*-\s*(\d*)$/.exec(part);
    if (m) { const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : n; for (let i = Math.max(1, a); i <= Math.min(n, b); i++) out.add(i - 1); }
    else if (/^\d+$/.test(part)) { const i = +part; if (i >= 1 && i <= n) out.add(i - 1); }
    else throw new Error(`Can't read page range "${part}"`);
  }
  return [...out].sort((a, b) => a - b);
}
// Groups of ranges for split: "1-3, 4-6" -> [[0,1,2],[3,4,5]]
export function parseRangeGroups(s, n) { return String(s).split(/[,;]+/).map(p => p.trim()).filter(Boolean).map(p => parseRanges(p, n)).filter(g => g.length); }

export const prefs = {
  get(k, d) { try { const v = localStorage.getItem('lumenpdf.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('lumenpdf.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } }
};

export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const raf = () => new Promise(r => requestAnimationFrame(r));
