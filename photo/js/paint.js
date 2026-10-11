'use strict';
/* Paint engine. Strokes are drawn into a doc-sized buffer and committed to the target
   (layer pixels or layer mask). Special modes: clone, heal, effect (dodge/burn/sponge), smudge. */
const tipCache = new Map();
function tip(size, color) {
  size = Math.max(1, Math.round(size));
  const k = size + '|' + opts.hardness + '|' + color; let t = tipCache.get(k); if (t) return t;
  if (tipCache.size > 80) tipCache.clear();
  t = mk(size + 2, size + 2); const c = cx(t), r = size / 2, m = (size + 2) / 2, rgb = hexToRgb(color).join(',');
  c.beginPath(); c.arc(m, m, r, 0, Math.PI * 2);
  if (opts.hardness >= 0.99 || size <= 2) c.fillStyle = `rgb(${rgb})`;
  else { const g = c.createRadialGradient(m, m, r * opts.hardness, m, m, r); g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(0.5, `rgba(${rgb},.5)`); g.addColorStop(1, `rgba(${rgb},0)`); c.fillStyle = g; }
  c.fill(); tipCache.set(k, t); return t;
}
let dabC = null;
const isMaskEdit = () => doc.editMask && !!layer().mask;
const paintColor = hex => isMaskEdit() ? grayHex(hex) : hex;

function beginStroke(mode, alpha, label) {
  const t = editTarget(); if (!t) return false;
  const buf = mk(doc.w, doc.h);
  stroke = { t, buf, ctx: cx(buf), mode, alpha, label, last: null, carry: 0, bbox: null, color: t.isMask ? grayHex(fg) : fg };
  if (t.isMask && mode === 'erase') { stroke.mode = 'paint'; stroke.color = grayHex(bg); } // eraser on a mask paints background color
  live = { isMask: t.isMask, get: strokePreview };
  return true;
}
function strokePreview() {
  const s = stroke;
  if (s.preview) return s.preview();
  const tc = s.t.canvas, o = scratchSized('live', tc.width, tc.height), c = cx(o);
  c.drawImage(tc, 0, 0); c.setTransform(1, 0, 0, 1, -s.t.L.x, -s.t.L.y);
  c.globalAlpha = s.alpha; c.globalCompositeOperation = s.mode === 'erase' ? 'destination-out' : 'source-over';
  c.drawImage(masked(s.buf), 0, 0); reset(c); return o;
}
function commitStroke() {
  const s = stroke; if (!s) return;
  if (s.finish) s.finish();
  else {
    const c = tctx(s.t); c.globalAlpha = s.alpha; c.globalCompositeOperation = s.mode === 'erase' ? 'destination-out' : 'source-over';
    c.drawImage(masked(s.buf), 0, 0); reset(c);
  }
  stroke = null; live = null; pushHistory(s.label);
}
function cancelStroke() { stroke = null; live = null; requestRender(); }
function growBox(s, x, y, w, h) { const r = { x: Math.floor(x), y: Math.floor(y), w: Math.ceil(w) + 1, h: Math.ceil(h) + 1 }; s.bbox = s.bbox ? unionRect(s.bbox, r) : r; s.fxBox = s.fxBox ? unionRect(s.fxBox, r) : r; }
function dabAt(p, pr) {
  const s = stroke, size = opts.size * pr;
  if (s.mode === 'smudge') return smudgeDab(p);
  if (s.mode === 'clone' || (s.mode === 'heal' && s.src)) {
    const t = tip(size, '#ffffff');
    if (!dabC || dabC.width !== t.width) dabC = mk(t.width, t.height);
    const d = cx(dabC); reset(d); d.clearRect(0, 0, t.width, t.height);
    d.drawImage(s.src, -(p.x + cloneOffset.x - t.width / 2), -(p.y + cloneOffset.y - t.height / 2));
    d.globalCompositeOperation = 'destination-in'; d.drawImage(t, 0, 0); reset(d);
    s.ctx.drawImage(dabC, p.x - t.width / 2, p.y - t.height / 2);
    if (s.cov) s.cov.getContext('2d').drawImage(t, p.x - t.width / 2, p.y - t.height / 2);
    growBox(s, p.x - t.width / 2, p.y - t.height / 2, t.width, t.height);
    return;
  }
  const color = s.mode === 'erase' ? '#000000' : (s.mode === 'heal' || s.mode === 'effect') ? '#ffffff' : s.color;
  const t = tip(size, color);
  s.ctx.drawImage(t, p.x - t.width / 2, p.y - t.height / 2);
  growBox(s, p.x - t.width / 2, p.y - t.height / 2, t.width, t.height);
}
function strokeTo(p, pr = 1) {
  const s = stroke;
  if (!s.last) { dabAt(p, pr); s.last = p; requestRender(true); return; }
  const dx = p.x - s.last.x, dy = p.y - s.last.y, dist = Math.hypot(dx, dy); if (!dist) return;
  const sp = Math.max(s.mode === 'smudge' ? 1 : 0.5, opts.size * pr * (s.mode === 'smudge' ? 0.06 : 0.1));
  let d = sp - s.carry;
  while (d <= dist) { dabAt({ x: s.last.x + dx * d / dist, y: s.last.y + dy * d / dist }, pr); d += sp; }
  s.carry = dist - (d - sp); s.last = p;
  requestRender(true);
}
const pressure = e => e.pointerType === 'pen' ? Math.max(0.05, e.pressure || 0.5) : 1;

/* ---------- dodge / burn / sponge ---------- */
function beginEffect() {
  if (!beginStroke('effect', 1, { dodge: 'Dodge', burn: 'Burn', desat: 'Sponge', sat: 'Sponge' }[opts.dodgeMode])) return false;
  const s = stroke;
  if (s.t.isMask) { cancelStroke(); toast('Dodge/Burn works on pixels, not masks'); return false; }
  s.orig = clone(s.t.canvas); s.res = clone(s.t.canvas); s.fxMode = opts.dodgeMode; s.range = opts.range; s.exp = opts.exposure;
  s.preview = () => { applyEffect(s); return s.res; };
  s.finish = () => { applyEffect(s); const c = cx(s.t.canvas); reset(c); c.clearRect(0, 0, s.res.width, s.res.height); c.drawImage(s.res, 0, 0); };
  return true;
}
function applyEffect(s) {
  if (!s.fxBox) return;
  const L = s.t.L, r = interRect({ x: s.fxBox.x - L.x, y: s.fxBox.y - L.y, w: s.fxBox.w, h: s.fxBox.h }, { x: 0, y: 0, w: s.res.width, h: s.res.height });
  s.fxBox = null; if (!r) return;
  const o = cx(s.orig).getImageData(r.x, r.y, r.w, r.h), d = o.data;
  const cov = cx(masked(s.buf)).getImageData(r.x + L.x, r.y + L.y, r.w, r.h).data;
  const mode = s.fxMode, range = s.range, ex = s.exp;
  for (let i = 0; i < d.length; i += 4) {
    const k = cov[i + 3] / 255 * ex; if (!k) continue;
    if (mode === 'desat' || mode === 'sat') {
      const y = .299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2], f = mode === 'sat' ? 1 + k * 1.5 : 1 - k;
      for (let c = 0; c < 3; c++) d[i + c] = y + (d[i + c] - y) * f;
      continue;
    }
    for (let c = 0; c < 3; c++) {
      const v = d[i + c] / 255; let n;
      if (range === 'mid') n = mode === 'dodge' ? Math.pow(v, 1 / (1 + k)) : Math.pow(v, 1 + k);
      else {
        const w = range === 'shadows' ? (1 - v) * (1 - v) : v * v;
        n = mode === 'dodge' ? v + (1 - v) * k * w : v * (1 - k * w);
      }
      d[i + c] = n * 255;
    }
  }
  cx(s.res).putImageData(o, r.x, r.y);
}

/* ---------- smudge ---------- */
function beginSmudge() {
  if (!beginStroke('smudge', 1, 'Smudge')) return false;
  const s = stroke; s.orig = clone(s.t.canvas); s.res = clone(s.t.canvas); s.pick = null;
  s.preview = () => s.res;
  s.finish = () => putResult(s.t, s.orig, s.res);
  return true;
}
const tipAlphaCache = new Map();
function tipAlpha(size) {
  const k = size + '|' + opts.hardness; let a = tipAlphaCache.get(k); if (a) return a;
  if (tipAlphaCache.size > 40) tipAlphaCache.clear();
  a = new Float32Array(size * size); const r = size / 2, h = opts.hardness;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
    a[y * size + x] = d >= 1 ? 0 : d <= h ? 1 : 1 - (d - h) / (1 - h);
  }
  tipAlphaCache.set(k, a); return a;
}
function smudgeDab(p) {
  const s = stroke, L = s.t.L, size = Math.max(2, Math.round(opts.size)), st = opts.strength;
  const x0 = Math.round(p.x - L.x - size / 2), y0 = Math.round(p.y - L.y - size / 2), c = cx(s.res);
  const img = c.getImageData(x0, y0, size, size), d = img.data, ta = tipAlpha(size);
  if (!s.pick || s.pick.length !== d.length) { // pick up the paint under the finger (premultiplied)
    s.pick = new Float32Array(d.length);
    for (let i = 0; i < d.length; i += 4) { const a = d[i + 3] / 255; s.pick[i] = d[i] * a; s.pick[i + 1] = d[i + 1] * a; s.pick[i + 2] = d[i + 2] * a; s.pick[i + 3] = d[i + 3]; }
    growBox(s, p.x - size / 2, p.y - size / 2, size, size); return;
  }
  const P = s.pick;
  for (let i = 0, j = 0; j < ta.length; i += 4, j++) {
    const w = ta[j] * st; if (!w) continue;
    const a = d[i + 3] / 255;
    const n0 = d[i] * a + (P[i] - d[i] * a) * w, n1 = d[i + 1] * a + (P[i + 1] - d[i + 1] * a) * w, n2 = d[i + 2] * a + (P[i + 2] - d[i + 2] * a) * w, n3 = d[i + 3] + (P[i + 3] - d[i + 3]) * w;
    const keep = st, take = 1 - keep;
    P[i] = P[i] * keep + n0 * take; P[i + 1] = P[i + 1] * keep + n1 * take; P[i + 2] = P[i + 2] * keep + n2 * take; P[i + 3] = P[i + 3] * keep + n3 * take;
    if (n3 > 0.5) { d[i] = n0 * 255 / n3; d[i + 1] = n1 * 255 / n3; d[i + 2] = n2 * 255 / n3; } d[i + 3] = n3;
  }
  c.putImageData(img, x0, y0);
  growBox(s, p.x - size / 2, p.y - size / 2, size, size);
}

/* ---------- healing ---------- */
// Spot healing / healing brush stroke: coverage collected in buffer, healed on release
function beginHeal(spot) {
  if (!beginStroke('heal', 1, spot ? 'Spot Healing' : 'Healing Brush')) return false;
  const s = stroke;
  if (s.t.isMask) { cancelStroke(); toast('Healing works on pixels, not masks'); return false; }
  if (!spot) { s.src = clone(sourceDoc()); s.cov = mk(doc.w, doc.h); s.off = { ...cloneOffset }; }
  s.preview = () => {
    const tc = s.t.canvas, o = scratchSized('live', tc.width, tc.height), c = cx(o);
    c.drawImage(tc, 0, 0); c.setTransform(1, 0, 0, 1, -s.t.L.x, -s.t.L.y);
    if (spot) { c.globalAlpha = 0.45; c.drawImage(cssFilter(masked(s.buf), 'brightness(0.35)'), 0, 0); }
    else c.drawImage(masked(s.buf), 0, 0);
    reset(c); return o;
  };
  s.finish = () => {
    if (!s.bbox) return;
    const cov = clone(masked(spot ? s.buf : s.cov));
    healRegion(s.t, cov, s.bbox, spot ? null : s.src, spot ? null : s.off);
  };
  return true;
}
function sourceDoc() { const sm = sampleSource(); if (sm.x === 0 && sm.y === 0 && sm.canvas.width === doc.w && sm.canvas.height === doc.h) return sm.canvas; const s = mk(doc.w, doc.h); cx(s).drawImage(sm.canvas, sm.x, sm.y); return s; }

/* Heal `cov` (doc-sized coverage canvas) on target t.
   result = S + fill(D) - fill(S): texture from the source S, low-frequency color from the surroundings of the hole in D.
   fill() is a normalized blur that ignores the hole (canvas un-premultiplies for us), approximating a Poisson membrane. */
function healRegion(t, cov, bbox, srcDoc, off) {
  const L = t.L, b = interRect(roundRect(bbox), docRect()); if (!b) return false;
  const R = Math.max(4, Math.ceil(Math.max(b.w, b.h) / 2)), pad = R * 2 + 4;
  const r = interRect({ x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 }, docRect());
  const full = docRender(t), fullCopy = clone(full);
  if (!srcDoc) srcDoc = fullCopy;
  if (!off) { off = findPatchOffset(fullCopy, cov, b); if (!off) { toast('No good source area found'); return false; } }
  const D = mk(r.w, r.h); cx(D).drawImage(fullCopy, -r.x, -r.y);
  const S = mk(r.w, r.h); cx(S).drawImage(srcDoc, -(r.x + off.x), -(r.y + off.y));
  const M = mk(r.w, r.h); cx(M).drawImage(cov, -r.x, -r.y);
  const hole = thresholdBlur(M, 1, 0);           // hard, slightly dilated hole
  const fillOf = img => { const c = clone(img), x = cx(c); x.globalCompositeOperation = 'destination-out'; x.drawImage(hole, 0, 0); reset(x); return cx(cssFilter(c, `blur(${R}px)`)).getImageData(0, 0, r.w, r.h).data; };
  const Df = fillOf(D), Sf = fillOf(S);
  const di = cx(D).getImageData(0, 0, r.w, r.h), dd = di.data, sd = cx(S).getImageData(0, 0, r.w, r.h).data, md = cx(M).getImageData(0, 0, r.w, r.h).data;
  for (let i = 0; i < dd.length; i += 4) {
    const k = md[i + 3] / 255; if (!k || !sd[i + 3]) continue;
    const ok = Df[i + 3] > 2 && Sf[i + 3] > 2;
    for (let c = 0; c < 3; c++) { const h = ok ? sd[i + c] + Df[i + c] - Sf[i + c] : sd[i + c]; dd[i + c] = dd[i + c] * (1 - k) + h * k; }
    dd[i + 3] = dd[i + 3] * (1 - k) + sd[i + 3] * k;
  }
  cx(D).putImageData(di, 0, 0);
  const c = tctx(t); c.clearRect(r.x, r.y, r.w, r.h); c.drawImage(D, r.x, r.y); reset(c);
  return true;
}
// Find a nearby source offset whose surroundings best match the hole's border (ring SSD)
function findPatchOffset(full, cov, b) {
  const W = doc.w, H = doc.h, fd = cx(full).getImageData(0, 0, W, H).data;
  const ringW = Math.max(3, Math.round(Math.max(b.w, b.h) * 0.15));
  const hole = thresholdBlur(cov, 1, 0), dil = thresholdBlur(hole, ringW, 0);
  const pr = interRect({ x: b.x - ringW * 3, y: b.y - ringW * 3, w: b.w + ringW * 6, h: b.h + ringW * 6 }, docRect());
  const hd = cx(hole).getImageData(pr.x, pr.y, pr.w, pr.h).data, dd = cx(dil).getImageData(pr.x, pr.y, pr.w, pr.h).data;
  let ring = [];
  for (let y = 0; y < pr.h; y++) for (let x = 0; x < pr.w; x++) { const i = (y * pr.w + x) * 4 + 3; if (dd[i] && !hd[i]) ring.push(pr.x + x, pr.y + y); }
  const step = Math.max(1, Math.floor(ring.length / 2 / 2500)) * 2;
  const size = Math.max(b.w, b.h, 6);
  let best = null, bestScore = Infinity;
  for (const f of [1.1, 1.5, 2.1, 2.9, 4]) for (let a = 0; a < 16; a++) {
    const ang = a * Math.PI / 8, ox = Math.round(Math.cos(ang) * size * f), oy = Math.round(Math.sin(ang) * size * f);
    if (b.x + ox - ringW < 0 || b.y + oy - ringW < 0 || b.x + b.w + ox + ringW > W || b.y + b.h + oy + ringW > H) continue;
    let sc = 0, n = 0;
    for (let k = 0; k < ring.length; k += step) {
      const x = ring[k], y = ring[k + 1], i = (y * W + x) * 4, j = ((y + oy) * W + x + ox) * 4;
      const e0 = fd[i] - fd[j], e1 = fd[i + 1] - fd[j + 1], e2 = fd[i + 2] - fd[j + 2];
      sc += e0 * e0 + e1 * e1 + e2 * e2; n++;
    }
    sc = sc / Math.max(1, n) * (1 + f * 0.04); // slight preference for closer patches
    if (sc < bestScore) { bestScore = sc; best = { x: ox, y: oy }; }
  }
  return best;
}
function contentAwareFill() {
  if (!selection) return toast('Select the area to fill first');
  const t = editTarget(); if (!t) return;
  if (t.isMask) return toast('Content-Aware Fill works on pixels, not masks');
  const cov = thresholdBlur(selection.mask, 2, 0), b = maskBounds(cov); if (!b) return;
  const soft = cssFilter(cov, 'blur(1.5px)');
  if (healRegion(t, soft, b, null, null)) { setSel(null); pushHistory('Content-Aware Fill'); }
}
