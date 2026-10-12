'use strict';
/* Color panel: HSV ring + SV square, HSB/RGB sliders, hex, recent colors, swatch sets, FG/BG. */
let FG = [0.16, 0.36, 0.62], BG = [1, 1, 1];
let fgHSV = rgb2hsv(...FG);
let recent = [];
let sliderMode = 'hsb';
const SWATCH_SETS = {
  'Essentials': ['#000000', '#3a3a3a', '#7a7a7a', '#bdbdbd', '#ffffff', '#e8d9b8', '#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#16a085', '#2980b9', '#1f3a93', '#8e44ad', '#d35400', '#7f5539'],
  'Watercolor pigments': ['#1b2a4a', '#2c5aa0', '#3d8fd1', '#68b0c9', '#2e7d6b', '#5b8c3a', '#9bb54a', '#e3c35a', '#e89a3c', '#c8553d', '#a3333d', '#7a3b69', '#8a6a4f', '#5c4033', '#2f2f35', '#f3ead9'],
  'Earth & skin': ['#3b2418', '#5c3a21', '#7f5539', '#a0714f', '#c49a6c', '#e0b98f', '#f2d3b3', '#ffe7d1', '#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#ffdbac', '#6b4423', '#4a5d23', '#8a9a5b'],
  'Landscape': ['#0f2340', '#25456e', '#4f7fb0', '#8fb8dc', '#f5c89a', '#f29e6b', '#d9644a', '#6d4b6b', '#2f4f3a', '#4c7a4a', '#8bab5c', '#cfd98a', '#6b5b3e', '#a8936b', '#e8e2d0', '#ffffff'],
  'Pastels': ['#ffd1dc', '#ffb3ba', '#ffdfba', '#ffffba', '#baffc9', '#bae1ff', '#c9c9ff', '#e0bbe4', '#957dad', '#d291bc', '#fec8d8', '#fdfd96', '#b5ead7', '#c7ceea', '#e2f0cb', '#ffdac1'],
  'Grays': ['#000000', '#111111', '#222222', '#333333', '#444444', '#555555', '#666666', '#777777', '#888888', '#999999', '#aaaaaa', '#bbbbbb', '#cccccc', '#dddddd', '#eeeeee', '#ffffff']
};
let swatchSet = 'Essentials', mySwatches = [];
const colorListeners = [];

function setFG(c, keepHue) {
  FG = c.map(v => clamp(v, 0, 1));
  const h = rgb2hsv(...FG); if (keepHue || h[1] < 0.001 || h[2] < 0.001) { if (h[2] < 0.001) h[1] = fgHSV[1]; h[0] = fgHSV[0]; } fgHSV = h;
  updateColorUI();
}
function setFGHSV(h, s, v) { fgHSV = [h, s, v]; FG = hsv2rgb(h, s, v); updateColorUI(); }
function swapColors() { const t = FG; FG = BG; BG = t; fgHSV = rgb2hsv(...FG); updateColorUI(); }
function pushRecent(c = FG) {
  const hx = rgbHex(c); recent = [hx, ...recent.filter(x => x !== hx)].slice(0, 12);
  try { localStorage.setItem('lumenpaint.recent', JSON.stringify(recent)); } catch (e) { }
  renderRecent();
}

let wheelCv, wheelImg = null;
const WHEEL = 164;
function buildColorPanel() {
  try { recent = JSON.parse(localStorage.getItem('lumenpaint.recent') || '[]').filter(x => hexRgb(x)).slice(0, 12); } catch (e) { }
  try { mySwatches = JSON.parse(localStorage.getItem('lumenpaint.swatches') || '[]').filter(x => hexRgb(x)).slice(0, 64); } catch (e) { }
  const p = $('#colorpane');
  p.innerHTML = `
    <div class="cp-top">
      <canvas id="wheel" width="${WHEEL}" height="${WHEEL}"></canvas>
      <div class="cp-right">
        <div class="cp-cur"><div id="cp-fg" title="Foreground"></div><div id="cp-bg" title="Background — click to swap"></div></div>
        <label class="cp-hex">#<input id="cp-hex" type="text" maxlength="7" spellcheck="false"></label>
        <div class="cp-lbl">Recent</div>
        <div class="cp-recent" id="cp-recent"></div>
      </div>
    </div>
    <div class="cp-mode"><span class="cp-m on" data-m="hsb">HSB</span><span class="cp-m" data-m="rgb">RGB</span></div>
    <div id="cp-sliders"></div>
    <div class="cp-sw-head"><select id="cp-set"></select><button class="aero-iconbtn" id="cp-add" title="Add current color to My swatches"><svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="2" fill="url(#gPaper)" stroke="#5a7a9a"/><path d="M8 4.5v7M4.5 8h7" stroke="#2a7f14" stroke-width="2"/></svg></button></div>
    <div class="cp-swatches" id="cp-swatches"></div>`;
  wheelCv = $('#wheel');
  // sliders
  const sl = $('#cp-sliders');
  for (let i = 0; i < 3; i++) sl.insertAdjacentHTML('beforeend', `<div class="cs-row"><span class="cs-l"></span><div class="cs-track" data-i="${i}"><div class="cs-thumb"></div></div><input class="cs-v" type="number" data-i="${i}"></div>`);
  $$('.cs-track', sl).forEach(t => {
    const i = +t.dataset.i;
    const go = e => { const r = t.getBoundingClientRect(), f = clamp((e.clientX - r.left) / r.width, 0, 1); sliderSet(i, f); };
    t.addEventListener('pointerdown', e => { try { t.setPointerCapture(e.pointerId); } catch (_) { } go(e); t.onpointermove = go; });
    t.addEventListener('pointerup', () => { t.onpointermove = null; });
  });
  $$('.cs-v', sl).forEach(inp => inp.addEventListener('change', () => { const i = +inp.dataset.i, mx = sliderMode === 'hsb' ? [360, 100, 100][i] : 255; sliderSet(i, clamp(+inp.value / mx, 0, 1)); }));
  $$('.cp-m', p).forEach(m => m.onclick = () => { sliderMode = m.dataset.m; $$('.cp-m', p).forEach(x => x.classList.toggle('on', x === m)); updateColorUI(); });
  // wheel
  const wheelPick = (e, mode) => {
    const r = wheelCv.getBoundingClientRect(), x = (e.clientX - r.left) * WHEEL / r.width - WHEEL / 2, y = (e.clientY - r.top) * WHEEL / r.height - WHEEL / 2;
    if (mode === 'ring') { let h = Math.atan2(y, x) * 180 / Math.PI + 90; if (h < 0) h += 360; setFGHSV(h, fgHSV[1], fgHSV[2]); }
    else { const q = SQ / 2; setFGHSV(fgHSV[0], clamp((x + q) / SQ, 0, 1), clamp(1 - (y + q) / SQ, 0, 1)); }
  };
  wheelCv.addEventListener('pointerdown', e => {
    const r = wheelCv.getBoundingClientRect(), x = (e.clientX - r.left) * WHEEL / r.width - WHEEL / 2, y = (e.clientY - r.top) * WHEEL / r.height - WHEEL / 2, d = Math.hypot(x, y);
    const mode = d > RIN - 3 ? 'ring' : 'sq'; try { wheelCv.setPointerCapture(e.pointerId); } catch (_) { } wheelPick(e, mode);
    wheelCv.onpointermove = ev => wheelPick(ev, mode);
  });
  wheelCv.addEventListener('pointerup', () => { wheelCv.onpointermove = null; pushRecent(); });
  $('#cp-hex').addEventListener('change', e => { const c = hexRgb(e.target.value); if (c) { setFG(c); pushRecent(); } else updateColorUI(); });
  $('#cp-bg').onclick = swapColors; $('#bgsw').onclick = swapColors;
  $('#cp-fg').onclick = () => { const i = el('input'); i.type = 'color'; i.value = rgbHex(FG); i.style.cssText = 'position:fixed;opacity:0;left:50%;top:50%'; document.body.appendChild(i); i.oninput = () => setFG(hexRgb(i.value)); i.onchange = () => { pushRecent(); i.remove(); }; i.click(); };
  const set = $('#cp-set'); [...Object.keys(SWATCH_SETS), 'My swatches'].forEach(n => set.add(new Option(n, n))); set.value = swatchSet;
  set.onchange = () => { swatchSet = set.value; renderSwatches(); };
  $('#cp-add').onclick = () => { const hx = rgbHex(FG); if (!mySwatches.includes(hx)) mySwatches.push(hx); saveSwatches(); swatchSet = 'My swatches'; set.value = swatchSet; renderSwatches(); Aero.toast('Added ' + hx + ' to My swatches'); };
  renderSwatches(); renderRecent(); updateColorUI();
}
function saveSwatches() { try { localStorage.setItem('lumenpaint.swatches', JSON.stringify(mySwatches)); } catch (e) { } }
function swatchEl(hx, onRight) {
  const d = el('div', 'cp-sw'); d.style.background = hx; d.title = hx + (onRight ? ' — right-click to remove' : '');
  d.onclick = () => { setFG(hexRgb(hx)); pushRecent(); };
  if (onRight) d.oncontextmenu = e => { e.preventDefault(); onRight(); };
  return d;
}
function renderSwatches() {
  const g = $('#cp-swatches'); g.innerHTML = '';
  if (swatchSet === 'My swatches') {
    if (!mySwatches.length) g.innerHTML = '<span class="dim" style="grid-column:1/-1;padding:4px">Click + to add the current color</span>';
    mySwatches.forEach((hx, i) => g.appendChild(swatchEl(hx, () => { mySwatches.splice(i, 1); saveSwatches(); renderSwatches(); })));
  } else SWATCH_SETS[swatchSet].forEach(hx => g.appendChild(swatchEl(hx)));
}
function renderRecent() { const g = $('#cp-recent'); if (!g) return; g.innerHTML = ''; recent.slice(0, 10).forEach(hx => g.appendChild(swatchEl(hx))); }
const ROUT = WHEEL / 2 - 2, RIN = ROUT - 15, SQ = Math.floor((RIN - 5) * Math.SQRT2);
function drawWheel() {
  const c = wheelCv.getContext('2d'), N = WHEEL;
  if (!wheelImg) {
    wheelImg = c.createImageData(N, N); const d = wheelImg.data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const dx = x + 0.5 - N / 2, dy = y + 0.5 - N / 2, r = Math.hypot(dx, dy); const i = (y * N + x) * 4;
      const a = clamp(Math.min(ROUT - r, r - RIN) + 0.5, 0, 1); if (a <= 0) continue;
      let h = Math.atan2(dy, dx) * 180 / Math.PI + 90; const [R1, G1, B1] = hsv2rgb(h, 1, 1);
      d[i] = R1 * 255; d[i + 1] = G1 * 255; d[i + 2] = B1 * 255; d[i + 3] = a * 255;
    }
  }
  c.clearRect(0, 0, N, N); c.putImageData(wheelImg, 0, 0);
  const q = SQ / 2, cx = N / 2, cy = N / 2;
  const [hr, hg, hb] = hsv2rgb(fgHSV[0], 1, 1);
  const g1 = c.createLinearGradient(cx - q, 0, cx + q, 0); g1.addColorStop(0, '#fff'); g1.addColorStop(1, `rgb(${hr * 255 | 0},${hg * 255 | 0},${hb * 255 | 0})`);
  c.fillStyle = g1; c.fillRect(cx - q, cy - q, SQ, SQ);
  const g2 = c.createLinearGradient(0, cy - q, 0, cy + q); g2.addColorStop(0, 'rgba(0,0,0,0)'); g2.addColorStop(1, '#000');
  c.fillStyle = g2; c.fillRect(cx - q, cy - q, SQ, SQ);
  c.strokeStyle = 'rgba(0,0,0,.35)'; c.strokeRect(cx - q - 0.5, cy - q - 0.5, SQ + 1, SQ + 1);
  // markers
  const ang = (fgHSV[0] - 90) * Math.PI / 180, rm = (ROUT + RIN) / 2;
  const mark = (x, y, r) => { c.lineWidth = 2.5; c.strokeStyle = '#fff'; c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke(); c.lineWidth = 1; c.strokeStyle = '#000'; c.beginPath(); c.arc(x, y, r + 1.5, 0, 7); c.stroke(); };
  mark(cx + Math.cos(ang) * rm, cy + Math.sin(ang) * rm, 5);
  mark(cx - q + fgHSV[1] * SQ, cy - q + (1 - fgHSV[2]) * SQ, 4.5);
  if (typeof drawHarmonyMarks === 'function') drawHarmonyMarks(c, cx, cy, rm);
}
function sliderSet(i, f) {
  if (sliderMode === 'hsb') { const h = fgHSV.slice(); h[i] = i === 0 ? f * 360 : f; setFGHSV(h[0], h[1], h[2]); }
  else { const c = FG.slice(); c[i] = f; setFG(c, true); }
}
function updateColorUI() {
  if (!wheelCv) return;
  drawWheel();
  const hx = rgbHex(FG);
  $('#cp-fg').style.background = hx; $('#cp-bg').style.background = rgbHex(BG);
  $('#fgsw').style.background = hx; $('#bgsw').style.background = rgbHex(BG);
  if (document.activeElement !== $('#cp-hex')) $('#cp-hex').value = hx.slice(1).toUpperCase();
  const rows = $$('#cp-sliders .cs-row'), [h, s, v] = fgHSV;
  const css = c => `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`;
  rows.forEach((row, i) => {
    let lbl, val, mx, grad;
    if (sliderMode === 'hsb') {
      lbl = 'HSB'[i]; mx = [360, 100, 100][i]; val = [h / 360, s, v][i];
      if (i === 0) grad = `linear-gradient(90deg,${[0, 60, 120, 180, 240, 300, 360].map(a => css(hsv2rgb(a, Math.max(s, 0.25), Math.max(v, 0.5)))).join(',')})`;
      else if (i === 1) grad = `linear-gradient(90deg,${css(hsv2rgb(h, 0, v))},${css(hsv2rgb(h, 1, v))})`;
      else grad = `linear-gradient(90deg,#000,${css(hsv2rgb(h, s, 1))})`;
    } else {
      lbl = 'RGB'[i]; mx = 255; val = FG[i];
      const a = FG.slice(), b = FG.slice(); a[i] = 0; b[i] = 1; grad = `linear-gradient(90deg,${css(a)},${css(b)})`;
    }
    row.querySelector('.cs-l').textContent = lbl;
    row.querySelector('.cs-track').style.background = grad;
    row.querySelector('.cs-thumb').style.left = (val * 100) + '%';
    const inp = row.querySelector('.cs-v'); if (document.activeElement !== inp) inp.value = Math.round(val * mx);
  });
  colorListeners.forEach(f => f());
}
