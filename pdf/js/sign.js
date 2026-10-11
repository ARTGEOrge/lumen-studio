// Signature manager: draw (pen pressure), type (bundled script fonts), or image — saved for reuse.
import { App, emit } from './state.js';
import { prefs, imageFileToDataUrl, loadImage, esc } from './util.js';

export const SIG_FONTS = ['Great Vibes', 'Dancing Script', 'Sacramento', 'Allura', 'Caveat'];

function trim(canvas, pad = 6) {
  const g = canvas.getContext('2d'); const { width: w, height: h } = canvas;
  const d = g.getImageData(0, 0, w, h).data; let x1 = w, y1 = h, x2 = -1, y2 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > 8) { if (x < x1) x1 = x; if (x > x2) x2 = x; if (y < y1) y1 = y; if (y > y2) y2 = y; }
  if (x2 < 0) return null;
  x1 = Math.max(0, x1 - pad); y1 = Math.max(0, y1 - pad); x2 = Math.min(w - 1, x2 + pad); y2 = Math.min(h - 1, y2 + pad);
  const c = document.createElement('canvas'); c.width = x2 - x1 + 1; c.height = y2 - y1 + 1;
  c.getContext('2d').drawImage(canvas, x1, y1, c.width, c.height, 0, 0, c.width, c.height);
  return { dataUrl: c.toDataURL('image/png'), w: c.width, h: c.height };
}
export async function typedSignature(name, font, color = '#0b1f6b') {
  await document.fonts.load(`96px "${font}"`).catch(() => { });
  const c = document.createElement('canvas'); const g = c.getContext('2d');
  g.font = `96px "${font}"`; const w = Math.ceil(g.measureText(name).width) + 80;
  c.width = Math.max(200, w); c.height = 190;
  g.font = `96px "${font}"`; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(name, 40, 98);
  return trim(c);
}
async function imageSignature(data, removeBg) {
  const img = await loadImage(data.dataUrl);
  const sc = Math.min(1, 1200 / img.naturalWidth);
  const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, c.width, c.height);
  if (removeBg) {
    const id = g.getImageData(0, 0, c.width, c.height), p = id.data;
    for (let k = 0; k < p.length; k += 4) { const l = 0.3 * p[k] + 0.59 * p[k + 1] + 0.11 * p[k + 2]; if (l > 200) p[k + 3] = 0; else if (l > 150) p[k + 3] = Math.round(p[k + 3] * (200 - l) / 50); }
    g.putImageData(id, 0, 0);
  }
  return trim(c, 2);
}

export function signatureManager() {
  const saved = prefs.get('sigs', []);
  let tab = saved.length ? 'saved' : 'draw', font = SIG_FONTS[0], color = '#0b1f6b', imgData = null, savedSel = saved.length ? 0 : -1;
  const html = `<div class="sigtabs aero-tabs" style="background:none;padding:0">${[['saved', 'Saved'], ['draw', 'Draw'], ['type', 'Type'], ['image', 'Image']].map(([k, l]) => `<div class="aero-tab" data-t="${k}">${l}</div>`).join('')}</div>
    <div class="sigpane" data-p="saved"><div class="sigsaved"></div></div>
    <div class="sigpane" data-p="draw"><div class="sigpad"><canvas></canvas></div><div class="sigrow"><button class="aero-btn small" data-a="clear">Clear</button><span class="dim">Draw with mouse, touch or pen (pressure sensitive)</span></div></div>
    <div class="sigpane" data-p="type"><input type="text" class="signame" style="width:100%;font-size:14px" value="${esc(App.author)}"><div class="sigfonts"></div></div>
    <div class="sigpane" data-p="image"><div class="sigimg">No image chosen</div><div class="sigrow"><button class="aero-btn small" data-a="pick">Choose image…</button><label><input type="checkbox" class="sigbg" checked> Remove white background</label></div></div>
    <div class="sigrow"><label>Ink <select class="sigcolor"><option value="#0b1f6b">Blue-black</option><option value="#000000">Black</option><option value="#1f4fbf">Blue</option></select></label><label><input type="checkbox" class="sigsave" checked> Save for reuse</label></div>`;
  const dlg = Aero.dialog({ title: 'Signatures', width: 600, html, ok: 'Use Signature', onOK: () => finish() });
  const box = dlg.el;
  const show = t => { tab = t; box.querySelectorAll('.sigtabs .aero-tab').forEach(x => x.classList.toggle('on', x.dataset.t === t)); box.querySelectorAll('.sigpane').forEach(p => p.hidden = p.dataset.p !== t); box.querySelector('.sigsave').parentElement.style.visibility = t === 'saved' ? 'hidden' : ''; };
  box.querySelector('.sigtabs').onclick = e => { const t = e.target.closest('.aero-tab'); if (t) show(t.dataset.t); };
  // saved
  const renderSaved = () => {
    const el = box.querySelector('.sigsaved'); const list = prefs.get('sigs', []);
    el.innerHTML = list.length ? list.map((s, k) => `<div class="s${k === savedSel ? ' sel' : ''}" data-k="${k}" style="background-image:url('${s.dataUrl}')"><span class="del" data-del="${k}" title="Delete">×</span></div>`).join('') : '<div class="dim">No saved signatures yet — create one with Draw, Type or Image.</div>';
  };
  box.querySelector('.sigsaved').onclick = e => {
    const del = e.target.dataset.del; if (del != null) { const l = prefs.get('sigs', []); l.splice(+del, 1); prefs.set('sigs', l); savedSel = l.length ? 0 : -1; renderSaved(); return; }
    const s = e.target.closest('.s'); if (s) { savedSel = +s.dataset.k; renderSaved(); }
  };
  box.querySelector('.sigsaved').ondblclick = e => { if (e.target.closest('.s')) { dlg.close(); finish(); } };
  renderSaved();
  // draw pad
  const pad = box.querySelector('.sigpad'), cv = pad.querySelector('canvas'); const dpr = 2;
  cv.width = 520 * dpr; cv.height = 170 * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr); g.lineCap = 'round'; g.lineJoin = 'round';
  let drawn = false, last = null;
  pad.onpointerdown = e => {
    try { pad.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ } const r = pad.getBoundingClientRect(); last = { x: e.clientX - r.left, y: e.clientY - r.top, w: 2.4 }; drawn = true;
    const mv = ev => {
      const ces = ev.getCoalescedEvents?.() || []; for (const ce of (ces.length ? ces : [ev])) {
        const x = ce.clientX - r.left, y = ce.clientY - r.top; const sp = Math.hypot(x - last.x, y - last.y); if (sp < 0.6) continue;
        const pr = ce.pointerType === 'pen' ? (ce.pressure || 0.5) : Math.max(0.25, 0.75 - sp / 40);
        const w = last.w * 0.6 + (0.9 + pr * 3.4) * 0.4;
        g.strokeStyle = color; g.lineWidth = w; g.beginPath(); g.moveTo(last.x, last.y); g.lineTo(x, y); g.stroke();
        last = { x, y, w };
      }
    };
    const up = () => { pad.removeEventListener('pointermove', mv); pad.removeEventListener('pointerup', up); };
    pad.addEventListener('pointermove', mv); pad.addEventListener('pointerup', up);
  };
  box.querySelector('[data-a="clear"]').onclick = () => { g.clearRect(0, 0, 520, 170); drawn = false; };
  // type
  const fontsEl = box.querySelector('.sigfonts'), nameEl = box.querySelector('.signame');
  const renderFonts = () => { fontsEl.innerHTML = SIG_FONTS.map(f => `<div class="sigfont${f === font ? ' sel' : ''}" data-f="${f}" style="font-family:'${f}';color:${color}">${esc(nameEl.value || 'Your Name')}</div>`).join(''); };
  fontsEl.onclick = e => { const f = e.target.closest('.sigfont'); if (f) { font = f.dataset.f; renderFonts(); } };
  nameEl.oninput = renderFonts; renderFonts();
  // image
  box.querySelector('[data-a="pick"]').onclick = async () => {
    const f = await Aero.openFile({ accept: 'image/*', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }] }); if (!f[0]) return;
    try { imgData = await imageFileToDataUrl(new Uint8Array(f[0].data), f[0].name); const el = box.querySelector('.sigimg'); el.textContent = ''; el.style.backgroundImage = `url('${imgData.dataUrl}')`; } catch (e) { Aero.alert('Signature', e.message); }
  };
  box.querySelector('.sigcolor').onchange = e => { color = e.target.value; renderFonts(); };
  show(tab);
  async function finish() {
    let sig = null;
    if (tab === 'saved') { const l = prefs.get('sigs', []); sig = l[savedSel] || null; if (!sig) { Aero.toast('No saved signature selected'); return; } }
    else if (tab === 'draw') { if (!drawn) { Aero.toast('Draw your signature first'); return; } sig = trim(cv, 8); }
    else if (tab === 'type') { const n = nameEl.value.trim(); if (!n) { Aero.toast('Type your name first'); return; } sig = await typedSignature(n, font, color); }
    else if (tab === 'image') { if (!imgData) { Aero.toast('Choose an image first'); return; } sig = await imageSignature(imgData, box.querySelector('.sigbg').checked); }
    if (!sig) { Aero.toast('The signature is empty'); return; }
    if (tab !== 'saved' && box.querySelector('.sigsave').checked) { const l = prefs.get('sigs', []); l.unshift(sig); prefs.set('sigs', l.slice(0, 8)); }
    App.signature = sig; emit('signatureReady', sig);
  }
  return dlg;
}
