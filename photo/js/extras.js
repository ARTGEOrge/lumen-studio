'use strict';
/* Beyond Photoshop: history tree panel + persistence, Compare (split / difference), Time-lapse export,
   Palette Recolor, Formula (code) layers, and glitch filters (pixel sort, RGB split, slices). */

/* ---------- history tree panel ---------- */
const BRANCH_COLORS = ['#7fb6f0', '#f0a35e', '#8bd17c', '#d98be0', '#f07f7f', '#e8d36a', '#6fd6cf'];
function renderHistoryPanel() {
  const hb = $('#history'); hb.innerHTML = '';
  const onPath = new Set(pathToRoot(hist.cur).map(n => n.id));
  const redoPath = new Set(); for (let n = hist.cur?.next; n; n = n.next) redoPath.add(n.id);
  let maxCol = -1, branches = 0;
  const walk = (n, col, branchStart) => {
    const d = document.createElement('div');
    d.className = 'hi' + (n === hist.cur ? ' on' : onPath.has(n.id) ? '' : redoPath.has(n.id) ? ' fut' : ' br');
    d.style.paddingLeft = (10 + col * 13) + 'px';
    d.innerHTML = `<span class="hdot" style="color:${BRANCH_COLORS[col % BRANCH_COLORS.length]}">${branchStart ? '⑂' : '●'}</span><span class="hl"></span><span class="hcmp" title="Compare the current image with this state">⇆</span>`;
    d.querySelector('.hl').textContent = n.label;
    d.title = new Date(n.time).toLocaleTimeString() + (branchStart ? ' · branch' : '');
    d.onclick = () => restoreNode(n);
    d.querySelector('.hcmp').onclick = e => { e.stopPropagation(); startCompare(n); };
    hb.appendChild(d);
    n.children.forEach((c, k) => { if (k === 0) walk(c, col, false); else { branches++; walk(c, ++maxCol, true); } });
  };
  hist.roots.forEach((r, k) => walk(r, ++maxCol, k > 0));
  $('#histinfo').textContent = hist.nodes.size + ' states' + (branches ? ` · ${branches} branch${branches > 1 ? 'es' : ''}` : '');
  hb.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}

/* ---------- history saved inside .lumen files ---------- */
let saveHistoryPref = true;
try { saveHistoryPref = localStorage.getItem('lumen.saveHistory') !== '0'; } catch (e) { }
function toggleSaveHistory() {
  saveHistoryPref = !saveHistoryPref;
  try { localStorage.setItem('lumen.saveHistory', saveHistoryPref ? '1' : '0'); } catch (e) { }
  toast(saveHistoryPref ? 'Projects will include full history (undo after reopening)' : 'Projects will be saved without history');
}
// Unique canvases are stored once; newest states win if the pixel budget is exceeded.
function serializeHistory(budgetPx = 160e6) {
  const refs = new Map(), blobs = {}, keep = new Set(); let area = 0;
  const order = [...hist.nodes.values()].sort((a, b) => (b === hist.cur) - (a === hist.cur) || b.id - a.id);
  for (const n of order) {
    const fresh = [];
    n.state.layers.forEach(l => [l.canvas, l.mask?.canvas].forEach(c => { if (c && !refs.has(c) && !fresh.includes(c)) fresh.push(c); }));
    const add = fresh.reduce((s, c) => s + c.width * c.height, 0);
    if (keep.size && area + add > budgetPx) continue;
    fresh.forEach(c => { const r = 'c' + refs.size; refs.set(c, r); blobs[r] = c.toDataURL('image/png'); });
    area += add; keep.add(n);
  }
  const nodes = [...keep].sort((a, b) => a.id - b.id).map(n => ({
    id: n.id, label: n.label, time: n.time,
    parent: n.parent && keep.has(n.parent) ? n.parent.id : null, next: n.next && keep.has(n.next) ? n.next.id : null,
    state: { ...n.state, layers: n.state.layers.map(l => ({ ...l, canvas: l.canvas ? refs.get(l.canvas) : null, mask: l.mask ? { enabled: l.mask.enabled, canvas: refs.get(l.mask.canvas) } : null })) }
  }));
  return { history: { nodes, cur: hist.cur.id, dropped: hist.nodes.size - keep.size }, blobs };
}
async function deserializeHistory(h, canv) {
  resetHistory();
  for (const o of h.nodes) {
    const st = { ...o.state, layers: o.state.layers.map(l => ({ ...l, canvas: l.canvas ? canv[l.canvas] : null, mask: l.mask ? { enabled: l.mask.enabled, canvas: canv[l.mask.canvas] } : null })) };
    addNode(o.label, st, o.parent != null ? hist.nodes.get(o.parent) : null, o.id, o.time);
  }
  for (const o of h.nodes) { const n = hist.nodes.get(o.id); n.next = o.next != null ? hist.nodes.get(o.next) || n.next : n.next; }
  return hist.nodes.get(h.cur) || [...hist.nodes.values()].pop();
}

/* ---------- Compare: before/after split & difference ---------- */
let compare = null;
function startCompare(node) {
  if (!doc) return;
  node = node || hist.roots[0];
  if (!node) return;
  compare = { node, mode: compare?.mode || 'split', pos: compare?.pos ?? 0.5, canvas: compositeState(node.state) };
  buildCompareBar(); requestRender();
}
function stopCompare() { compare = null; $('#cmpbar').hidden = true; requestRender(); }
function toggleCompare() { compare ? stopCompare() : startCompare(); }
function buildCompareBar() {
  const b = $('#cmpbar'); b.hidden = false;
  const isOrig = compare.node === hist.roots[0] && !compare.node.parent;
  b.innerHTML = `<span>Comparing with <b></b></span><button data-m="split">Split</button><button data-m="diff">Difference</button><button data-m="x" title="Close (Y or Esc)">✕</button>`;
  b.querySelector('b').textContent = isOrig ? 'the original' : `“${compare.node.label}”`;
  b.querySelectorAll('button').forEach(btn => {
    btn.classList.toggle('on', btn.dataset.m === compare.mode);
    btn.onclick = () => { if (btn.dataset.m === 'x') return stopCompare(); compare.mode = btn.dataset.m; buildCompareBar(); requestRender(); };
  });
}
// Called inside renderMain with the doc-space transform applied
function drawCompare(c) {
  if (!compare) return;
  const cc = compare.canvas;
  if (compare.mode === 'split') {
    c.save(); c.beginPath(); c.rect(0, 0, doc.w * compare.pos, doc.h); c.clip();
    c.fillStyle = '#fff'; c.fillRect(0, 0, doc.w, doc.h); c.drawImage(cc, 0, 0); c.restore();
  } else {
    const d = scratchSized('diff', doc.w, doc.h), dc = cx(d);
    dc.drawImage(comp, 0, 0); dc.globalCompositeOperation = 'difference'; dc.drawImage(cc, 0, 0); reset(dc);
    const heat = scratchSized('heat', doc.w, doc.h), hc = cx(heat);
    hc.fillStyle = '#000'; hc.fillRect(0, 0, doc.w, doc.h); hc.filter = 'grayscale(1) brightness(8)'; hc.drawImage(d, 0, 0); reset(hc);
    hc.globalCompositeOperation = 'multiply'; hc.fillStyle = '#ff3b30'; hc.fillRect(0, 0, doc.w, doc.h); reset(hc);
    c.fillStyle = '#000'; c.fillRect(0, 0, doc.w, doc.h); c.globalAlpha = 0.35; c.drawImage(comp, 0, 0); c.globalAlpha = 1;
    c.globalCompositeOperation = 'screen'; c.drawImage(heat, 0, 0); c.globalCompositeOperation = 'source-over';
  }
}
function drawCompareOverlay(c) {
  if (!compare || compare.mode !== 'split') return;
  const x = Math.round(panX + doc.w * zoom * compare.pos) + .5, y0 = panY, y1 = panY + doc.h * zoom, ym = (y0 + y1) / 2;
  c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y1); c.strokeStyle = '#000a'; c.lineWidth = 3; c.stroke(); c.strokeStyle = '#fff'; c.lineWidth = 1.5; c.stroke();
  c.beginPath(); c.arc(x, ym, 15, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill(); c.fillStyle = '#222'; c.font = '600 14px Segoe UI'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('⇆', x, ym + 1);
  const tag = (t, tx, al) => { c.font = '600 11px Segoe UI'; c.textAlign = al; const w = c.measureText(t).width + 14; const bx = al === 'right' ? tx - w : tx; c.fillStyle = '#000b'; c.fillRect(bx, y0 + 8, w, 20); c.fillStyle = '#fff'; c.fillText(t, al === 'right' ? tx - 7 : tx + 7, y0 + 18.5); };
  tag('BEFORE', x - 8, 'right'); tag('NOW', x + 8, 'left');
}

/* ---------- Time-lapse export ---------- */
function exportTimelapse() {
  const path = pathToRoot(hist.cur).reverse();
  if (path.length < 2) return toast('Make some edits first — the time-lapse replays your history');
  showDialog({
    title: 'Export Time-lapse', ok: 'Record', fields: [
      { key: 'dur', label: 'Length (seconds)', type: 'range', min: 3, max: 60, value: clamp(Math.round(path.length * 0.7), 5, 20) },
      { key: 'w', label: 'Video width', type: 'select', value: '1280', options: [['720', '720 px'], ['1280', '1280 px (HD)'], ['1920', '1920 px (Full HD)']] },
      { key: 'labels', label: 'Show step names', type: 'checkbox', value: true },
      { key: 'wipe', label: 'End with before/after wipe', type: 'checkbox', value: true }],
    html: `<p class="dnote">Replays the ${path.length} steps of the current branch as a video.</p>`,
    onOK: v => recordTimelapse(path, v).catch(e => { busy(); toast('Time-lapse failed: ' + e.message); })
  });
}
// Find a container/codec that actually produces data here (MP4 preferred for sharing, WebM as fallback)
let recorderMime;
async function pickRecorderMime() {
  if (recorderMime !== undefined) return recorderMime;
  recorderMime = null;
  for (const t of ['video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp9', 'video/webm']) {
    if (!window.MediaRecorder || !MediaRecorder.isTypeSupported(t)) continue;
    try {
      const cv = mk(320, 240), c = cx(cv), st = cv.captureStream(0), tr = st.getVideoTracks()[0], rec = new MediaRecorder(st, { mimeType: t }), ch = [];
      rec.ondataavailable = e => e.data.size && ch.push(e.data); const done = new Promise(r => rec.onstop = r);
      rec.start(50);
      for (let i = 0; i < 15; i++) { c.fillStyle = `hsl(${i * 24},80%,50%)`; c.fillRect(0, 0, 320, 240); tr.requestFrame(); await new Promise(r => setTimeout(r, 33)); }
      rec.stop(); await done;
      if (new Blob(ch).size > 0) return (recorderMime = t);
    } catch (e) { }
  }
  return recorderMime;
}
async function recordTimelapse(path, v) {
  const last = path[path.length - 1].state, W = +v.w, H = Math.round(W * last.h / last.w / 2) * 2;
  const out = mk(W, H), c = cx(out);
  busy('Preparing video encoder…');
  const mime = await pickRecorderMime();
  if (!mime) throw new Error('video recording is not available on this system');
  const fitted = img => { const f = mk(W, H), fc = cx(f), s = Math.min(W / img.width, H / img.height), w = img.width * s, h = img.height * s; fc.fillStyle = '#141414'; fc.fillRect(0, 0, W, H); fc.imageSmoothingQuality = 'high'; fc.drawImage(img, (W - w) / 2, (H - h) / 2, w, h); return f; };
  const cache = new Map(), frame = i => { if (!cache.has(i)) { cache.set(i, fitted(compositeState(path[i].state))); if (cache.size > 4) cache.delete(cache.keys().next().value); } return cache.get(i); };
  const label = (i) => {
    if (!v.labels) return;
    const t = `${i + 1}/${path.length}  ${path[i].label}`, fs = Math.round(H / 32);
    c.font = `600 ${fs}px Segoe UI`; const w = c.measureText(t).width + fs * 1.4;
    c.fillStyle = 'rgba(0,0,0,.6)'; c.beginPath(); c.roundRect(fs, H - fs * 2.6, w, fs * 1.7, fs * 0.85); c.fill();
    c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.fillText(t, fs * 1.7, H - fs * 1.75);
  };
  const first = frame(0), base = fitted(compositeState(path[0].state));
  const stream = out.captureStream(0), track = stream.getVideoTracks()[0];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: W >= 1920 ? 16e6 : 9e6 }), chunks = [];
  rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise(r => rec.onstop = r);
  c.drawImage(first, 0, 0); rec.start(250);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const total = v.dur * 1000, hold = 1200, wipe = v.wipe ? 2400 : 0, step = Math.max(120, (total - hold - wipe) / (path.length - 1)), fade = Math.min(450, step * 0.55);
  const t0 = performance.now(), allMs = step * (path.length - 1) + hold + wipe;
  const progress = () => { track.requestFrame(); busy(`Recording time-lapse… ${Math.min(100, Math.round((performance.now() - t0) / allMs * 100))}%`); };
  for (let i = 0; i < path.length; i++) {
    const a = frame(i), b = i < path.length - 1 ? frame(i + 1) : null, dur = b ? step : hold, s0 = performance.now();
    for (let el = 0; el < dur; el = performance.now() - s0) {
      c.globalAlpha = 1; c.drawImage(a, 0, 0);
      if (b && el > dur - fade) { c.globalAlpha = (el - (dur - fade)) / fade; c.drawImage(b, 0, 0); c.globalAlpha = 1; }
      label(b && el > dur - fade / 2 ? i + 1 : i); progress(); await sleep(33);
    }
  }
  if (wipe) {
    const fin = frame(path.length - 1), s0 = performance.now();
    for (let el = 0; el < wipe; el = performance.now() - s0) {
      const t = el / wipe, pos = t < 0.5 ? 1 - t * 2 * 0.9 : 0.1 + (t - 0.5) * 2 * 0.9, x = W * (0.5 - 0.5 * Math.cos(pos * Math.PI));
      c.drawImage(fin, 0, 0); c.save(); c.beginPath(); c.rect(0, 0, x, H); c.clip(); c.drawImage(base, 0, 0); c.restore();
      c.fillStyle = '#fff'; c.fillRect(x - 1.5, 0, 3, H); progress(); await sleep(33);
    }
    c.drawImage(fin, 0, 0); track.requestFrame(); await sleep(300);
  }
  rec.stop(); await done; busy();
  const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm', name = `${doc.name} time-lapse.${ext}`;
  const bytes = new Uint8Array(await new Blob(chunks, { type: mime }).arrayBuffer());
  if (bytes.length < 2048) throw new Error('the encoder produced no video');
  if (v.onBytes) return v.onBytes(bytes, mime);
  if (nativeApi) { const p = await nativeApi.saveDialog({ defaultPath: name, filters: [{ name: 'Video', extensions: [ext] }] }); if (!p) return; await nativeApi.writeFile(p, bytes); }
  else download(new Blob([bytes], { type: mime }), name);
  toast(`Saved ${name} (${(bytes.length / 1048576).toFixed(1)} MB)`);
}

/* ---------- Palette Recolor ---------- */
function extractPalette(src, k = 6) {
  const s = Math.min(1, 140 / Math.max(src.width, src.height)), t = mk(src.width * s, src.height * s); cx(t).drawImage(src, 0, 0, t.width, t.height);
  const d = cx(t).getImageData(0, 0, t.width, t.height).data, pts = [];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) pts.push([d[i], d[i + 1], d[i + 2]]);
  if (pts.length < k) return ['#000000', '#ffffff'];
  const lum = p => .299 * p[0] + .587 * p[1] + .114 * p[2];
  pts.sort((a, b) => lum(a) - lum(b));
  let C = Array.from({ length: k }, (_, i) => [...pts[Math.floor((i + 0.5) / k * pts.length)]]);
  for (let it = 0; it < 12; it++) {
    const sum = C.map(() => [0, 0, 0, 0]);
    for (const p of pts) { let bi = 0, bd = Infinity; C.forEach((c, j) => { const e = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (e < bd) { bd = e; bi = j; } }); const s2 = sum[bi]; s2[0] += p[0]; s2[1] += p[1]; s2[2] += p[2]; s2[3]++; }
    C = C.map((c, j) => sum[j][3] ? [sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] : c);
  }
  return C.sort((a, b) => lum(a) - lum(b)).map(c => rgbToHex(...c));
}
let recolorLUT = { key: null, lut: null };
function recolorFn(s, v) {
  const src = [], dst = [];
  for (let i = 0; v['s' + i]; i++) { src.push(hexToRgb(v['s' + i])); dst.push(hexToRgb(v['d' + i])); }
  const key = JSON.stringify(v);
  if (recolorLUT.key !== key) { recolorLUT = { key, lut: new Float32Array(32768 * 3).fill(NaN) }; }
  const lut = recolorLUT.lut, sig2 = 2 * v.soft * v.soft, amt = v.amt / 100;
  return pixels(s, d => {
    for (let i = 0; i < d.length; i += 4) {
      const q = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3), o = q * 3;
      if (Number.isNaN(lut[o])) {
        const r = (d[i] >> 3) * 8 + 4, g = (d[i + 1] >> 3) * 8 + 4, b = (d[i + 2] >> 3) * 8 + 4;
        let ws = 0, sr = 0, sg = 0, sb = 0;
        for (let k = 0; k < src.length; k++) { const p = src[k], w = Math.exp(-((r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2) / sig2) + 1e-9; ws += w; sr += w * (dst[k][0] - p[0]); sg += w * (dst[k][1] - p[1]); sb += w * (dst[k][2] - p[2]); }
        lut[o] = sr / ws; lut[o + 1] = sg / ws; lut[o + 2] = sb / ws;
      }
      d[i] += lut[o] * amt; d[i + 1] += lut[o + 1] * amt; d[i + 2] += lut[o + 2] * amt;
    }
  });
}
FILTERS['Recolor (Palette)…'] = {
  adj: 1, fn: recolorFn,
  fieldsFor(p, src) {
    if (!p) { p = { soft: 45, amt: 100 }; extractPalette(src).forEach((c, i) => { p['s' + i] = c; p['d' + i] = c; }); }
    const f = [];
    for (let i = 0; p['s' + i]; i++) { f.push({ key: 's' + i, type: 'hidden', value: p['s' + i] }); f.push({ key: 'd' + i, label: `Color ${i + 1} →`, type: 'color', value: p['d' + i], swatch: p['s' + i] }); }
    f.push({ key: 'soft', label: 'Smoothness', type: 'range', min: 10, max: 120, value: p.soft });
    f.push({ key: 'amt', label: 'Amount', type: 'range', min: 0, max: 100, value: p.amt, fmt: pct });
    return f;
  },
  note: 'The image\'s main colors were extracted on the left. Pick a new color for any of them — shading and texture are kept.'
};

/* ---------- Formula (code) layers ---------- */
const FORMULA_PRESETS = {
  thermal: '// Thermal camera\nconst t = lum / 255;\nr = 255 * clamp(1.5 - abs(4*t - 3), 0, 1);\ng = 255 * clamp(1.5 - abs(4*t - 2), 0, 1);\nb = 255 * clamp(1.5 - abs(4*t - 1), 0, 1);',
  duotone: '// Duotone: shadows → highlights\nconst t = lum / 255;\nr = mix(28, 255, t);\ng = mix(18, 196, t);\nb = mix(84, 120, t);',
  waves: '// Sine-wave interference\nconst s = 0.5 + 0.5 * sin(x / 14 + 3 * sin(y / 37));\nr = r * s + 40 * (1 - s);\ng = g * s;\nb = b * s + 160 * (1 - s);',
  swap: '// Rotate color channels\nconst t0 = r; r = b; b = g; g = t0;',
  fade: '// Vintage fade\nr = r * 0.92 + 22;\ng = g * 0.88 + 18;\nb = b * 0.72 + 38;',
  spotlight: '// Spotlight from the center\nconst k = clamp(1.25 - hypot(u - 0.5, v - 0.5) * 2.2, 0, 1);\nr *= k; g *= k; b *= k;',
  scan: '// CRT scanlines + chroma shift\nr = src(x - 3, y, 0);\nb = src(x + 3, y, 2);\nif (y % 3 === 0) { r *= 0.55; g *= 0.55; b *= 0.55; }',
  noir: '// High-contrast noir with grain\nconst t = smooth(60, 190, lum) * 255 + (rnd(x, y) - 0.5) * 28;\nr = g = b = t;',
  custom: '// Your formula. Read & write r, g, b, a (0–255).\n// Also: x, y, u, v (0–1), w, h, lum, src(x, y, channel)\n// Helpers: clamp, mix, smooth, rnd(x, y), and Math (sin, cos, abs, pow…)\nr = 255 - r;'
};
const FORMULA_NAMES = [['thermal', 'Thermal camera'], ['duotone', 'Duotone'], ['waves', 'Sine waves'], ['swap', 'Channel swap'], ['fade', 'Vintage fade'], ['spotlight', 'Spotlight'], ['scan', 'CRT scanlines'], ['noir', 'Grainy noir'], ['custom', 'Custom…']];
// Code typed by the user (or our presets) is trusted; code that arrives inside a file must be approved first.
const trustedCode = new Set(Object.values(FORMULA_PRESETS));
const formulaCache = new Map();
let lastFormulaErr = '';
function compileFormula(code) {
  let f = formulaCache.get(code); if (f) return f;
  f = { fn: null, err: null };
  try {
    f.fn = new Function('d', 's', 'w', 'h', `'use strict';const {sin,cos,tan,abs,min,max,pow,sqrt,floor,ceil,round,PI,atan2,hypot,exp,log}=Math;
const clamp=(v,a=0,b=255)=>v<a?a:v>b?b:v, mix=(a,b,t)=>a+(b-a)*t, smooth=(e0,e1,x)=>{const t=clamp((x-e0)/(e1-e0),0,1);return t*t*(3-2*t)};
const rnd=(x,y)=>{const n=Math.sin(x*12.9898+y*78.233)*43758.5453;return n-Math.floor(n)};
const src=(xx,yy,c=0)=>{xx=xx<0?0:xx>=w?w-1:xx|0;yy=yy<0?0:yy>=h?h-1:yy|0;return s[(yy*w+xx)*4+c]};
for(let y=0,i=0;y<h;y++)for(let x=0;x<w;x++,i+=4){let r=d[i],g=d[i+1],b=d[i+2],a=d[i+3];const lum=.299*r+.587*g+.114*b,u=x/w,v=y/h;
${code}
;d[i]=r;d[i+1]=g;d[i+2]=b;d[i+3]=a;}`);
  } catch (e) { f.err = e.message; }
  formulaCache.set(code, f); return f;
}
function formulaFn(s, v) {
  const code = v.preset && v.preset !== 'custom' ? FORMULA_PRESETS[v.preset] : v.code;
  if (!trustedCode.has(code)) return clone(s);
  const f = compileFormula(code);
  const report = msg => { if (msg !== lastFormulaErr) { lastFormulaErr = msg; toast('Formula error: ' + msg); } };
  if (f.err) { report(f.err); return clone(s); }
  const o = clone(s), c = cx(o), img = c.getImageData(0, 0, o.width, o.height), d = img.data, orig = d.slice();
  try { f.fn(d, orig, o.width, o.height); lastFormulaErr = ''; } catch (e) { report(e.message); return clone(s); }
  const amt = (v.amt ?? 100) / 100;
  if (amt < 1) for (let i = 0; i < d.length; i++) d[i] = orig[i] + (d[i] - orig[i]) * amt;
  c.putImageData(img, 0, 0); return o;
}
FILTERS['Formula…'] = {
  adj: 1, fn: formulaFn,
  fieldsFor: p => [
    { key: 'preset', label: 'Preset', type: 'select', value: p?.preset ?? 'thermal', options: FORMULA_NAMES },
    { key: 'code', label: 'Code', type: 'textarea', mono: true, value: p?.code ?? FORMULA_PRESETS[p?.preset ?? 'thermal'] },
    { key: 'amt', label: 'Amount', type: 'range', min: 0, max: 100, value: p?.amt ?? 100, fmt: pct }],
  onInput(key, v, set) {
    if (key === 'preset' && v.preset !== 'custom') set('code', FORMULA_PRESETS[v.preset]);
    if (key === 'code' && v.preset !== 'custom' && v.code !== FORMULA_PRESETS[v.preset]) set('preset', 'custom');
  },
  onDialog(v, ok, init) { if (ok || v.code !== init.code) trustedCode.add(v.code); },
  note: 'Runs live on every pixel. Edit the code to invent your own effect — it updates as you type.'
};
// After opening a file: ask before running formula code that came from it
function checkFormulaTrust() {
  const codes = new Set();
  const scan = layers => layers.forEach(l => { if (l.adjust?.kind === 'Formula…') { const c = l.adjust.params.preset && l.adjust.params.preset !== 'custom' ? FORMULA_PRESETS[l.adjust.params.preset] : l.adjust.params.code; if (c && !trustedCode.has(c)) codes.add(c); } });
  scan(doc.layers); hist.nodes.forEach(n => scan(n.state.layers));
  if (!codes.size) return;
  const esc = s => s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
  showDialog({
    title: 'This file contains formula code', ok: 'Allow code', html: `<p class="dnote">Formula layers run code. Only allow it if you trust where this file came from. Until then those layers show the image unchanged.</p><pre class="codeprev">${esc([...codes].join('\n\n---\n\n'))}</pre>`,
    onOK: () => { codes.forEach(c => trustedCode.add(c)); requestRender(); toast('Formula layers enabled'); },
    onCancel: () => toast('Formula layers left disabled')
  });
}

/* ---------- glitch filters ---------- */
function rng(seed) { let a = seed >>> 0 || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hueOf(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let h = mx === r ? (g - b) / d : mx === g ? 2 + (b - r) / d : 4 + (r - g) / d; return (h * 60 + 360) % 360; }
FILTERS['Pixel Sort…'] = {
  fields: [
    { key: 'dir', label: 'Direction', type: 'select', value: 'v', options: [['v', 'Vertical (drips)'], ['h', 'Horizontal (streaks)']] },
    { key: 'lo', label: 'Sort pixels brighter than', type: 'range', min: 0, max: 255, value: 70 },
    { key: 'hi', label: '…and darker than', type: 'range', min: 0, max: 255, value: 235 },
    { key: 'by', label: 'Sort by', type: 'select', value: 'lum', options: [['lum', 'Brightness'], ['hue', 'Hue'], ['sat', 'Saturation']] },
    { key: 'rev', label: 'Reverse order', type: 'checkbox', value: false }],
  fn: (s, v) => pixels(s, (d, w, h) => {
    const vert = v.dir === 'v', lines = vert ? w : h, N = vert ? h : w, lo = Math.min(v.lo, v.hi), hi = Math.max(v.lo, v.hi);
    const at = (line, k) => (vert ? k * w + line : line * w + k) * 4, tmp = new Uint8ClampedArray(N * 4);
    const key = i => { const r = d[i], g = d[i + 1], b = d[i + 2]; if (v.by === 'hue') return hueOf(r, g, b); if (v.by === 'sat') { const mx = Math.max(r, g, b); return mx ? (mx - Math.min(r, g, b)) / mx : 0; } return .299 * r + .587 * g + .114 * b; };
    for (let line = 0; line < lines; line++) {
      let start = -1;
      for (let k = 0; k <= N; k++) {
        const i = k < N ? at(line, k) : 0, l = k < N ? .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2] : -1, inside = k < N && l >= lo && l <= hi;
        if (inside && start < 0) start = k;
        if (!inside && start >= 0) {
          const span = []; for (let q = start; q < k; q++) span.push([key(at(line, q)), q]);
          span.sort((a, b) => v.rev ? b[0] - a[0] : a[0] - b[0]);
          span.forEach(([, q], n) => { const i2 = at(line, q); tmp.set(d.subarray(i2, i2 + 4), n * 4); });
          for (let n = 0; n < span.length; n++) { const i2 = at(line, start + n); d[i2] = tmp[n * 4]; d[i2 + 1] = tmp[n * 4 + 1]; d[i2 + 2] = tmp[n * 4 + 2]; d[i2 + 3] = tmp[n * 4 + 3]; }
          start = -1;
        }
      }
    }
  })
};
FILTERS['RGB Split…'] = {
  adj: 1, fields: [{ key: 'd', label: 'Distance (px)', type: 'range', min: 0, max: 60, value: 8 }, { key: 'a', label: 'Angle °', type: 'range', min: 0, max: 360, value: 0 }],
  fn: (s, v) => {
    const w = s.width, h = s.height, src = cx(s).getImageData(0, 0, w, h).data, dx = Math.round(Math.cos(v.a * Math.PI / 180) * v.d), dy = Math.round(Math.sin(v.a * Math.PI / 180) * v.d);
    return pixels(s, d => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4, rx = clamp(x - dx, 0, w - 1), ry = clamp(y - dy, 0, h - 1), bx = clamp(x + dx, 0, w - 1), by = clamp(y + dy, 0, h - 1);
        d[i] = src[(ry * w + rx) * 4]; d[i + 2] = src[(by * w + bx) * 4 + 2];
      }
    });
  }
};
FILTERS['Glitch Slices…'] = {
  fields: [{ key: 'n', label: 'Slices', type: 'range', min: 1, max: 80, value: 18 }, { key: 'm', label: 'Max shift (px)', type: 'range', min: 1, max: 400, value: 60 }, { key: 'c', label: 'Color glitch', type: 'checkbox', value: true }, { key: 'seed', label: 'Seed', type: 'range', min: 1, max: 999, value: 42 }],
  fn: (s, v) => {
    const w = s.width, h = s.height, o = clone(s), c = cx(o), R = rng(v.seed);
    for (let k = 0; k < v.n; k++) {
      const y = Math.floor(R() * h), sh = Math.max(1, Math.floor(R() * h / 14)), off = Math.round((R() * 2 - 1) * v.m);
      c.drawImage(s, 0, y, w, sh, off, y, w, sh); c.drawImage(s, 0, y, w, sh, off - Math.sign(off) * w, y, w, sh);
      if (v.c && R() < 0.4) { c.globalCompositeOperation = 'screen'; c.fillStyle = ['#ff004c55', '#00e5ff55', '#7cff0055'][Math.floor(R() * 3)]; c.fillRect(0, y, w, sh); c.globalCompositeOperation = 'source-over'; }
    }
    return o;
  }
};
['Recolor (Palette)…', 'Formula…', 'RGB Split…'].forEach(k => ADJ_KINDS.push(k));
