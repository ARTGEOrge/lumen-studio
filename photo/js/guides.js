'use strict';
/* Rulers, guides and snapping. Drag from a ruler to create a guide; drag a guide with the Move tool (or Ctrl held)
   to reposition it, drop it back on a ruler to delete it. Guides are saved in .lumen projects. */
const view2 = { rulers: true, guides: true, snap: true, lockGuides: false };
try { Object.assign(view2, JSON.parse(localStorage.getItem('lumen.view') || '{}')); } catch (e) { }
const saveView = () => { try { localStorage.setItem('lumen.view', JSON.stringify(view2)); } catch (e) { } };
const RULER = 18;
const rulerH = document.createElement('canvas'), rulerV = document.createElement('canvas'), rulerC = document.createElement('div');
rulerH.id = 'rulerH'; rulerV.id = 'rulerV'; rulerC.id = 'rulerC'; rulerC.title = 'Rulers (Ctrl+R) · drag from a ruler to add a guide';
vp.append(rulerH, rulerV, rulerC);
let guideDrag = null;   // { o:'h'|'v', p, idx|null }
function applyRulerVisibility(boot) { [rulerH, rulerV, rulerC].forEach(e => e.style.display = view2.rulers ? '' : 'none'); if (!boot) requestView(); }
function toggleRulers() { view2.rulers = !view2.rulers; saveView(); applyRulerVisibility(); }
function toggleGuides() { view2.guides = !view2.guides; saveView(); requestOverlay(); toast(view2.guides ? 'Guides shown' : 'Guides hidden'); }
function toggleSnap() { view2.snap = !view2.snap; saveView(); toast(view2.snap ? 'Snap on (guides, canvas edges & center)' : 'Snap off'); }
function toggleLockGuides() { view2.lockGuides = !view2.lockGuides; saveView(); toast(view2.lockGuides ? 'Guides locked' : 'Guides unlocked'); }
function clearGuides() { if (!doc.guides?.length) return toast('No guides'); doc.guides = []; window.__lumenDirty = true; updateTitle(); requestOverlay(); toast('Guides cleared'); }
function newGuideDialog() {
  showDialog({
    title: 'New Guide', fields: [{ key: 'o', label: 'Orientation', type: 'select', value: 'v', options: [['v', 'Vertical'], ['h', 'Horizontal']] }, { key: 'p', label: 'Position (px)', type: 'number', value: Math.round(doc.w / 2) }],
    onOK: v => { addGuide(v.o, v.p); }
  });
}
function addGuide(o, p) { if (!Number.isFinite(+p)) return; doc.guides = doc.guides || []; doc.guides.push({ o: o === 'h' ? 'h' : 'v', p: Math.round(+p * 100) / 100 }); window.__lumenDirty = true; updateTitle(); requestOverlay(); }
function sanitizeGuides(g) { return Array.isArray(g) ? g.slice(0, 500).filter(o => o && (o.o === 'h' || o.o === 'v') && Number.isFinite(+o.p)).map(o => ({ o: o.o, p: +o.p })) : []; }

/* ---------- snapping ---------- */
function snapTargets(axis) {
  const t = axis === 'x' ? [0, doc.w / 2, doc.w] : [0, doc.h / 2, doc.h];
  if (view2.guides) (doc.guides || []).forEach(g => { if ((g.o === 'v') === (axis === 'x')) t.push(g.p); });
  return t;
}
function snapVal(v, axis) {
  if (!view2.snap || !doc) return v;
  const th = 8 / zoom; let best = v, bd = th;
  snapTargets(axis).forEach(t => { const d = Math.abs(t - v); if (d < bd) { bd = d; best = t; } });
  return best;
}
function snapPt(p) { return view2.snap && doc ? { x: snapVal(p.x, 'x'), y: snapVal(p.y, 'y') } : p; }
// Adjustment {x, y} that snaps the edges or center of rectangle r to a target
function snapRectDelta(r) {
  const out = { x: 0, y: 0 }; if (!view2.snap || !doc || !r) return out;
  const th = 8 / zoom;
  [['x', [r.x, r.x + r.w / 2, r.x + r.w]], ['y', [r.y, r.y + r.h / 2, r.y + r.h]]].forEach(([ax, vals]) => {
    let bd = th; snapTargets(ax).forEach(t => vals.forEach(v => { const d = t - v; if (Math.abs(d) < bd) { bd = Math.abs(d); out[ax] = d; } }));
  });
  return out;
}

/* ---------- drawing ---------- */
function drawGuides(c) {
  if (!view2.guides || !doc) return;
  const W = vp.clientWidth, H = vp.clientHeight;
  c.save(); c.lineWidth = 1;
  (doc.guides || []).forEach((g, i) => {
    if (guideDrag && guideDrag.idx === i) return;
    c.strokeStyle = 'rgba(0,200,255,.95)'; c.beginPath();
    if (g.o === 'v') { const x = Math.round(panX + g.p * zoom) + .5; c.moveTo(x, 0); c.lineTo(x, H); } else { const y = Math.round(panY + g.p * zoom) + .5; c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke();
  });
  if (guideDrag) {
    c.strokeStyle = '#ff2fd0'; c.setLineDash([5, 3]); c.beginPath();
    if (guideDrag.o === 'v') { const x = Math.round(panX + guideDrag.p * zoom) + .5; c.moveTo(x, 0); c.lineTo(x, H); } else { const y = Math.round(panY + guideDrag.p * zoom) + .5; c.moveTo(0, y); c.lineTo(W, y); }
    c.stroke(); c.setLineDash([]);
    const t = Math.round(guideDrag.p) + ' px', sx = guideDrag.o === 'v' ? panX + guideDrag.p * zoom + 6 : mouse.sx + 10, sy = guideDrag.o === 'h' ? panY + guideDrag.p * zoom - 6 : mouse.sy - 8;
    c.font = '11px Segoe UI'; const w = c.measureText(t).width + 8; c.fillStyle = '#000b'; c.fillRect(sx, sy - 13, w, 16); c.fillStyle = '#fff'; c.fillText(t, sx + 4, sy - 1);
  }
  c.restore();
}
function niceStep(z) { const target = 70 / z; const p = Math.pow(10, Math.floor(Math.log10(target))); for (const m of [1, 2, 5, 10]) if (p * m >= target) return p * m; return p * 10; }
function renderRulers() {
  if (!view2.rulers) return;
  const W = vp.clientWidth, H = vp.clientHeight;
  for (const [cv, horiz] of [[rulerH, true], [rulerV, false]]) {
    const cw = Math.round((horiz ? W : RULER) * dpr), chh = Math.round((horiz ? RULER : H) * dpr);
    if (cv.width !== cw || cv.height !== chh) { cv.width = cw; cv.height = chh; }
    const c = cx(cv); c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = c.createLinearGradient(0, 0, horiz ? 0 : RULER, horiz ? RULER : 0); g.addColorStop(0, '#fbfdff'); g.addColorStop(1, '#dde8f4');
    c.fillStyle = g; c.fillRect(0, 0, horiz ? W : RULER, horiz ? RULER : H);
    c.fillStyle = '#9fb3c9'; horiz ? c.fillRect(0, RULER - 1, W, 1) : c.fillRect(RULER - 1, 0, 1, H);
    if (!doc) continue;
    const step = niceStep(zoom), minor = step / (String(step)[0] === '2' ? 4 : 5), len = horiz ? W : H, off = horiz ? panX : panY;
    const from = Math.floor((-off) / zoom / minor) * minor, to = (len - off) / zoom;
    c.strokeStyle = '#5b7491'; c.fillStyle = '#2b4058'; c.font = '9.5px Segoe UI'; c.lineWidth = 1; c.beginPath();
    for (let v = from; v <= to; v += minor) {
      const s = Math.round(off + v * zoom) + .5, major = Math.abs(v / step - Math.round(v / step)) < 1e-6, half = !major && Math.abs((v * 2) / step - Math.round((v * 2) / step)) < 1e-6;
      const tl = major ? RULER - 1 : half ? 6 : 4;
      if (horiz) { c.moveTo(s, RULER - 1); c.lineTo(s, RULER - 1 - tl); } else { c.moveTo(RULER - 1, s); c.lineTo(RULER - 1 - tl, s); }
      if (major) {
        const t = String(Math.round(v));
        if (horiz) c.fillText(t, s + 2, 9);
        else { c.save(); c.translate(9, s + 2); c.rotate(-Math.PI / 2); c.textAlign = 'right'; c.fillText(t, 0, 0); c.restore(); }
      }
    }
    c.stroke();
    if (mouse.inside) { c.fillStyle = '#e8352a'; horiz ? c.fillRect(Math.round(mouse.sx), 0, 1, RULER) : c.fillRect(0, Math.round(mouse.sy), RULER, 1); }
  }
}

/* ---------- interaction ---------- */
function startGuideDrag(o, e, idx) {
  if (!doc) return;
  guideDrag = { o, p: 0, idx: idx ?? null };
  const move = ev => {
    const p = toDoc(ev), r = overlay.getBoundingClientRect(); mouse.sx = ev.clientX - r.left; mouse.sy = ev.clientY - r.top; mouse.inside = true;
    let v = o === 'v' ? p.x : p.y;
    v = ev.shiftKey ? Math.round(v / niceStep(zoom) * 5) * niceStep(zoom) / 5 : snapVal(v, o === 'v' ? 'x' : 'y');
    guideDrag.p = Math.round(v * 10) / 10; requestOverlay(); renderRulers();
  };
  const up = ev => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    const r = overlay.getBoundingClientRect(), sx = ev.clientX - r.left, sy = ev.clientY - r.top;
    const onRuler = !view2.rulers ? (sx < 0 || sy < 0 || sx > r.width || sy > r.height) : (sx < RULER || sy < RULER || sx > r.width || sy > r.height);
    const g = guideDrag; guideDrag = null;
    doc.guides = doc.guides || [];
    if (g.idx != null) { if (onRuler) doc.guides.splice(g.idx, 1); else doc.guides[g.idx].p = g.p; }
    else if (!onRuler) doc.guides.push({ o: g.o, p: g.p });
    window.__lumenDirty = true; updateTitle(); requestOverlay();
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  move(e);
}
rulerH.addEventListener('pointerdown', e => { if (e.button === 0) { e.preventDefault(); if (!view2.guides) { view2.guides = true; saveView(); } startGuideDrag('h', e); } });
rulerV.addEventListener('pointerdown', e => { if (e.button === 0) { e.preventDefault(); if (!view2.guides) { view2.guides = true; saveView(); } startGuideDrag('v', e); } });
function hitGuide(e) {
  if (!doc || !view2.guides || view2.lockGuides || !doc.guides?.length) return -1;
  const r = overlay.getBoundingClientRect(), sx = e.clientX - r.left, sy = e.clientY - r.top;
  return doc.guides.findIndex(g => g.o === 'v' ? Math.abs(panX + g.p * zoom - sx) <= 4 : Math.abs(panY + g.p * zoom - sy) <= 4);
}
applyRulerVisibility(true);
