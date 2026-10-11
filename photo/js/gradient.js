'use strict';
/* Multi-stop gradients: data model, presets and the embeddable Gradient Editor widget
   (used by the Gradient tool and the Gradient Overlay layer style). A gradient is { stops:[{p,c,a}] } with
   p = location 0..1, c = '#rrggbb', a = opacity 0..1. */
const HEX6 = /^#[0-9a-f]{6}$/i;
const GRADIENT_PRESETS = [
  ['Foreground → Background', () => [{ p: 0, c: fg, a: 1 }, { p: 1, c: bg, a: 1 }]],
  ['Foreground → Transparent', () => [{ p: 0, c: fg, a: 1 }, { p: 1, c: fg, a: 0 }]],
  ['Black → White', () => [{ p: 0, c: '#000000', a: 1 }, { p: 1, c: '#ffffff', a: 1 }]],
  ['Spectrum', () => ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'].map((c, i) => ({ p: i / 6, c, a: 1 }))],
  ['Sunset', () => [{ p: 0, c: '#2b1055', a: 1 }, { p: 0.45, c: '#d53369', a: 1 }, { p: 0.8, c: '#ff8c42', a: 1 }, { p: 1, c: '#ffe29a', a: 1 }]],
  ['Ocean', () => [{ p: 0, c: '#002b5c', a: 1 }, { p: 0.55, c: '#0a84ff', a: 1 }, { p: 1, c: '#7ff0e6', a: 1 }]],
  ['Gold', () => [{ p: 0, c: '#7a4a00', a: 1 }, { p: 0.3, c: '#ffd36b', a: 1 }, { p: 0.5, c: '#fff4c4', a: 1 }, { p: 0.72, c: '#e0a21a', a: 1 }, { p: 1, c: '#6b3f00', a: 1 }]],
  ['Chrome', () => [{ p: 0, c: '#f2f6fa', a: 1 }, { p: 0.48, c: '#8a9bb0', a: 1 }, { p: 0.5, c: '#3a4656', a: 1 }, { p: 0.75, c: '#c9d6e4', a: 1 }, { p: 1, c: '#ffffff', a: 1 }]],
  ['Neon', () => [{ p: 0, c: '#ff00cc', a: 1 }, { p: 0.5, c: '#7a5cff', a: 1 }, { p: 1, c: '#00e5ff', a: 1 }]],
  ['Fade to clear', () => [{ p: 0, c: '#000000', a: 0.85 }, { p: 1, c: '#000000', a: 0 }]]
];
function sanitizeStops(s, fallback) {
  if (!Array.isArray(s)) return fallback;
  const out = s.slice(0, 16).filter(o => o && typeof o === 'object').map(o => ({
    p: clamp(Number.isFinite(+o.p) ? +o.p : 0, 0, 1), c: HEX6.test(o.c) ? o.c.toLowerCase() : '#000000', a: clamp(Number.isFinite(+o.a) ? +o.a : 1, 0, 1)
  }));
  return out.length >= 2 ? out.sort((a, b) => a.p - b.p) : fallback;
}
const cloneStops = s => s.map(o => ({ ...o }));
function stopsCss(stops, reverse) {
  const s = [...stops].sort((a, b) => a.p - b.p);
  return s.map(o => { const [r, g, b] = hexToRgb(o.c); return { p: reverse ? 1 - o.p : o.p, css: `rgba(${r},${g},${b},${o.a})` }; }).sort((a, b) => a.p - b.p);
}
function addStops(g, stops, reverse) { stopsCss(stops, reverse).forEach(o => g.addColorStop(o.p, o.css)); return g; }
function sampleStops(stops, t) {   // interpolated {c, a} at t
  const s = [...stops].sort((a, b) => a.p - b.p);
  if (t <= s[0].p) return { c: s[0].c, a: s[0].a };
  for (let i = 1; i < s.length; i++) if (t <= s[i].p) {
    const A = s[i - 1], B = s[i], k = (t - A.p) / Math.max(1e-6, B.p - A.p), ca = hexToRgb(A.c), cb = hexToRgb(B.c);
    return { c: rgbToHex(...ca.map((v, j) => v + (cb[j] - v) * k)), a: A.a + (B.a - A.a) * k };
  }
  const l = s[s.length - 1]; return { c: l.c, a: l.a };
}
// Canvas gradient for the Gradient tool / overlays. type: linear | radial | reflected | angle
function makeGradient(c, type, a, b, stops, reverse) {
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  let g;
  if (type === 'radial') g = c.createRadialGradient(a.x, a.y, 0, a.x, a.y, len);
  else if (type === 'angle') g = c.createConicGradient(Math.atan2(b.y - a.y, b.x - a.x), a.x, a.y);
  else if (type === 'reflected') {
    g = c.createLinearGradient(2 * a.x - b.x, 2 * a.y - b.y, b.x, b.y);
    const half = stopsCss(stops, reverse);
    half.forEach(o => g.addColorStop(0.5 - o.p / 2, o.css)); half.forEach(o => g.addColorStop(0.5 + o.p / 2, o.css));
    return g;
  } else g = c.createLinearGradient(a.x, a.y, b.x, b.y);
  return addStops(g, stops, reverse);
}
function drawStopsPreview(cv, stops) {
  const c = cx(cv), w = cv.width, h = cv.height; reset(c);
  c.fillStyle = c.createPattern(checker, 'repeat'); c.fillRect(0, 0, w, h);
  const g = c.createLinearGradient(0, 0, w, 0); addStops(g, stops); c.fillStyle = g; c.fillRect(0, 0, w, h);
}

/* Gradient Editor widget: presets, a bar to click (add stop), draggable stops (drag down to remove), stop details. */
function gradientWidget(host, grad, onChange) {
  host.classList.add('gedit'); host.innerHTML = '';
  let sel = 0;
  const presets = document.createElement('div'); presets.className = 'gpresets';
  GRADIENT_PRESETS.forEach(([name, fn]) => {
    const cv = mk(34, 18); drawStopsPreview(cv, fn()); cv.title = name;
    cv.onclick = () => { grad.stops = fn(); sel = 0; draw(); changed(); };
    presets.appendChild(cv);
  });
  const barWrap = document.createElement('div'); barWrap.className = 'gbarwrap';
  const bar = mk(320, 26); bar.className = 'gbar'; bar.title = 'Click to add a color stop';
  const marks = document.createElement('div'); marks.className = 'gmarks';
  barWrap.append(bar, marks);
  const det = document.createElement('div'); det.className = 'gdet';
  det.innerHTML = '<label>Color <input type="color" data-k="c"></label><label>Opacity <input type="range" min="0" max="100" data-k="a"><span class="gv" data-v="a"></span></label><label>Location <input type="number" min="0" max="100" data-k="p" style="width:52px">%</label><button class="b small" data-k="del" title="Delete stop">Delete</button>';
  host.append(presets, barWrap, det);
  const changed = () => onChange && onChange(grad);
  const draw = () => {
    grad.stops.sort((a, b) => a.p - b.p);
    sel = clamp(sel, 0, grad.stops.length - 1);
    drawStopsPreview(bar, grad.stops);
    marks.innerHTML = '';
    grad.stops.forEach((s, i) => {
      const m = document.createElement('div'); m.className = 'gmark' + (i === sel ? ' on' : ''); m.style.left = (s.p * 100) + '%';
      m.innerHTML = `<i style="background:${s.c};opacity:${0.35 + s.a * 0.65}"></i>`; m.title = `${s.c} · ${Math.round(s.a * 100)}% · drag down to remove`;
      m.onpointerdown = e => {
        e.preventDefault(); e.stopPropagation(); sel = i; m.setPointerCapture(e.pointerId);
        const r = marks.getBoundingClientRect(), stop = s; let removed = false;
        m.onpointermove = ev => {
          stop.p = clamp((ev.clientX - r.left) / r.width, 0, 1);
          removed = ev.clientY - r.bottom > 28 && grad.stops.length > 2;
          m.style.opacity = removed ? 0.3 : 1; m.style.left = (stop.p * 100) + '%'; drawStopsPreview(bar, grad.stops); changed();
        };
        m.onpointerup = () => { m.onpointermove = m.onpointerup = null; if (removed) grad.stops.splice(grad.stops.indexOf(stop), 1); sel = grad.stops.indexOf(stop); if (sel < 0) sel = 0; draw(); changed(); };
        showDet();
        marks.querySelectorAll('.gmark').forEach((x, j) => x.classList.toggle('on', j === i));
      };
      marks.appendChild(m);
    });
    showDet();
  };
  const showDet = () => {
    const s = grad.stops[sel]; if (!s) return;
    det.querySelector('[data-k=c]').value = s.c; det.querySelector('[data-k=a]').value = Math.round(s.a * 100);
    det.querySelector('[data-v=a]').textContent = Math.round(s.a * 100) + '%'; det.querySelector('[data-k=p]').value = Math.round(s.p * 100);
  };
  det.querySelector('[data-k=c]').oninput = e => { grad.stops[sel].c = e.target.value; draw(); changed(); };
  det.querySelector('[data-k=a]').oninput = e => { grad.stops[sel].a = e.target.value / 100; draw(); changed(); };
  det.querySelector('[data-k=p]').onchange = e => { const s = grad.stops[sel]; s.p = clamp((+e.target.value || 0) / 100, 0, 1); draw(); sel = grad.stops.indexOf(s); draw(); changed(); };
  det.querySelector('[data-k=del]').onclick = () => { if (grad.stops.length > 2) { grad.stops.splice(sel, 1); sel = Math.max(0, sel - 1); draw(); changed(); } else toast('A gradient needs at least two stops'); };
  bar.onclick = e => {
    const r = bar.getBoundingClientRect(), t = clamp((e.clientX - r.left) / r.width, 0, 1), v = sampleStops(grad.stops, t);
    if (grad.stops.length >= 16) return toast('Up to 16 stops');
    grad.stops.push({ p: t, c: v.c, a: v.a }); grad.stops.sort((a, b) => a.p - b.p);
    sel = grad.stops.findIndex(s => s.p === t); draw(); changed();
  };
  draw();
  return { refresh: draw };
}
// Dialog around the widget (Gradient tool)
function gradientEditorDialog() {
  const work = { stops: cloneStops(opts.gradStops) };
  showDialog({
    title: 'Gradient Editor', html: '<div id="gedhost"></div><p class="dnote">Click the bar to add a stop · drag stops to move them, or down to remove · pick a preset to start from.</p>',
    onMount: box => gradientWidget(box.querySelector('#gedhost'), work, null),
    onOK: () => { opts.gradStops = cloneStops(work.stops); opts.gradMode = 'custom'; saveGradPref(); buildOptions(); }
  });
}
function saveGradPref() { try { localStorage.setItem('lumen.gradStops', JSON.stringify(opts.gradStops)); } catch (e) { } }
opts.gradStops = GRADIENT_PRESETS[4][1]();
opts.gradReverse = false;
try { const s = JSON.parse(localStorage.getItem('lumen.gradStops') || 'null'); opts.gradStops = sanitizeStops(s, opts.gradStops); } catch (e) { }
// Stops the gradient tool paints with, according to its Colors option
function toolStops() {
  if (opts.gradMode === 'custom') return opts.gradStops;
  const c1 = paintColor(fg), c2 = paintColor(bg);
  return opts.gradMode === 'fgbg' ? [{ p: 0, c: c1, a: 1 }, { p: 1, c: c2, a: 1 }] : [{ p: 0, c: c1, a: 1 }, { p: 1, c: c1, a: 0 }];
}
function maskedStops(stops) { return isMaskEdit() ? stops.map(s => ({ ...s, c: grayHex(s.c) })) : stops; }
