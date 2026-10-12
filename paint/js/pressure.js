'use strict';
/* Pen pressure curve: a custom response curve (Edit › Pressure Curve…) with a live test pad, presets and
   auto-calibration from a few natural strokes. Without a custom curve the Preferences gamma is used. */
let pressureLUT = null;
function rebuildPressureLUT() { pressureLUT = Array.isArray(prefs.pressureCurve) && prefs.pressureCurve.length >= 2 ? curveLUT(prefs.pressureCurve, 1024) : null; }
function pressureMap(p) { return pressureLUT ? pressureLUT[Math.round(clamp(p, 0, 1) * 1023)] : Math.pow(clamp(p, 0, 1), prefs.pressureGamma); }
function validCurve(c) { if (!Array.isArray(c) || c.length < 2 || c.length > 16) return null; const pts = c.map(p => Array.isArray(p) ? [clamp(+p[0] || 0, 0, 1), clamp(+p[1] || 0, 0, 1)] : null); return pts.every(Boolean) ? pts.sort((a, b) => a[0] - b[0]) : null; }
const PRESSURE_PRESETS = { linear: [[0, 0], [1, 1]], soft: [[0, 0], [0.3, 0.55], [1, 1]], firm: [[0, 0], [0.55, 0.3], [1, 1]], light: [[0, 0], [0.15, 0.4], [0.5, 0.9], [1, 1]], scurve: [[0, 0], [0.3, 0.15], [0.7, 0.85], [1, 1]] };
function dlgPressure() {
  let pts = validCurve(prefs.pressureCurve) || (prefs.pressureGamma === 1 ? PRESSURE_PRESETS.linear : (() => { const a = []; for (let i = 0; i <= 4; i++) { const x = i / 4; a.push([x, Math.pow(x, prefs.pressureGamma)]); } return a; })());
  const samples = [];
  const dlg = Aero.dialog({ title: 'Pressure Curve', width: 600, ok: 'Use this curve',
    instruction: 'Draw on the test pad with your pen. Drag the curve to change how pen pressure maps to brush size / opacity.',
    fields: [{ key: 'pre', label: 'Preset', type: 'select', options: [['', 'Custom'], ['linear', 'Linear'], ['soft', 'Soft (light touch)'], ['firm', 'Firm (heavy hand)'], ['light', 'Very light touch'], ['scurve', 'S-curve (more control in the middle)']], value: '' }],
    onInput: (k, v) => { if (k === 'pre' && PRESSURE_PRESETS[v.pre]) { pts = PRESSURE_PRESETS[v.pre].map(p => p.slice()); ed.set(pts); } },
    onOK: () => { prefs.pressureCurve = pts.map(p => [+p[0].toFixed(4), +p[1].toFixed(4)]); rebuildPressureLUT(); savePrefs(); Aero.toast('Pressure curve saved'); } });
  const box = el('div', 'pc-wrap', `<div><canvas id="pc-curve"></canvas><div class="dim pc-io" id="pc-io">input — · output —</div></div>
    <div class="pc-padbox"><canvas id="pc-pad" width="300" height="230"></canvas><div class="pc-btns"><button class="aero-btn small" id="pc-clear">Clear pad</button><button class="aero-btn small" id="pc-auto" title="Fit the curve to the strokes drawn on the pad">Auto-calibrate</button></div></div>`);
  dlg.el.querySelector('.content').appendChild(box);
  const ed = new CurveEditor($('#pc-curve', box), pts, { size: 220, color: '#1c5fb4', onChange: p => { pts = p.map(q => q.slice()); dlg.set('pre', ''); } });
  const pad = $('#pc-pad', box), c = pad.getContext('2d');
  const clearPad = () => { c.fillStyle = '#fff'; c.fillRect(0, 0, pad.width, pad.height); c.fillStyle = '#9aa8b8'; c.font = '12px Segoe UI'; c.fillText('Test pad — draw here with your pen', 10, 18); samples.length = 0; };
  clearPad();
  let last = null;
  const lut = () => curveLUT(pts, 1024);
  pad.style.touchAction = 'none';
  pad.addEventListener('pointerdown', e => { try { pad.setPointerCapture(e.pointerId); } catch (_) { } last = null; draw(e); });
  pad.addEventListener('pointermove', e => { if (e.buttons) for (const ce of (e.getCoalescedEvents?.() || [e])) draw(ce); });
  pad.addEventListener('pointerup', () => { last = null; });
  function draw(e) {
    const r = pad.getBoundingClientRect(), x = (e.clientX - r.left) * pad.width / r.width, y = (e.clientY - r.top) * pad.height / r.height;
    const raw = e.pointerType === 'pen' || (e.pressure > 0 && e.pressure !== 0.5) ? e.pressure : 0.5, L = lut(), out = L[Math.round(clamp(raw, 0, 1) * 1023)];
    if (e.pointerType === 'pen' && raw > 0) samples.push(raw);
    const wdt = 1 + out * 16;
    if (last) { c.strokeStyle = 'rgba(29,36,51,.9)'; c.lineCap = 'round'; c.lineWidth = wdt; c.beginPath(); c.moveTo(last[0], last[1]); c.lineTo(x, y); c.stroke(); }
    last = [x, y]; ed.marker = [clamp(raw, 0, 1), out]; ed.draw();
    $('#pc-io', box).textContent = `input ${(raw * 100).toFixed(0)}% · output ${(out * 100).toFixed(0)}%` + (e.pointerType !== 'pen' ? ' (no pen detected)' : '');
  }
  $('#pc-clear', box).onclick = clearPad;
  $('#pc-auto', box).onclick = () => {
    if (samples.length < 40) { Aero.toast('Draw a few natural strokes with your pen on the test pad first'); return; }
    const s = samples.slice().sort((a, b) => a - b), q = f => s[Math.min(s.length - 1, Math.floor(s.length * f))];
    const lo = q(0.05), mid = q(0.5), hi = Math.max(q(0.95), mid + 0.05);
    // your light touch → thin, your typical pressure → half, your firm pressure → full
    pts = validCurve([[0, 0], [clamp(lo, 0.01, 0.9), 0.08], [clamp(mid, 0.02, 0.95), 0.5], [clamp(hi, 0.05, 0.99), 1], [1, 1]].filter((p, i, a) => !i || p[0] > a[i - 1][0] + 0.01));
    ed.set(pts); dlg.set('pre', ''); Aero.toast(`Calibrated: typical pressure ${(mid * 100).toFixed(0)}%, firm ${(hi * 100).toFixed(0)}%`);
  };
}
function savePrefs() { try { localStorage.setItem('lumenpaint.prefs', JSON.stringify(prefs)); } catch (e) { } }
