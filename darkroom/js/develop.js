'use strict';
/* Lumen Darkroom — Develop module (and the shared photo viewer used by the Library loupe) */
const Dev = (() => {
  let live = null;            // settings being dragged (not yet committed)
  let preview = null;         // preset hover preview
  let loadedFor = null, loadTok = 0;
  const refDims = new Map();  // fileId → {w,h} of the work image (zoom reference)
  let zoom = 'fit', pan = { x: .5, y: .5 };
  let ba = 'off', splitPos = .5;
  let cropMode = false, cropDraft = null, wbPick = false;
  let clipboard = null, showInfo = false, lastExport = null;
  let rq = false, lastHist = 0, histTimer = null, lastView = null;
  const sliders = [];
  let curveCh = 'rgb', hslTab = 'hue';
  const ASPECTS = [['original', 'Original'], ['free', 'Free'], ['1:1', '1 : 1'], ['4:5', '4 : 5 (8 × 10)'], ['5:7', '5 : 7'], ['2:3', '2 : 3 (4 × 6)'], ['3:4', '3 : 4'], ['9:16', '9 : 16'], ['16:9', '16 : 9'], ['3:2', '3 : 2'], ['4:3', '4 : 3'], ['5:4', '5 : 4']];

  const capture = (el, e) => { try { el.setPointerCapture(e.pointerId); } catch (err) { } };
  const getP = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
  const setP = (o, path, v) => { const ks = path.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) a = a[ks[i]]; a[ks[ks.length - 1]] = v; };
  const photo = () => activePhoto();
  const viewerShown = () => !$('#viewer').hidden;
  const isDev = () => S.module === 'develop';
  const cur = () => { const p = photo(); return preview || live || p?.settings; };
  const beginLive = () => { const p = photo(); if (!live && p) live = Model.clone(p.settings); return live; };
  function commit(label) {
    const p = photo(); if (!p || !live) return;
    const s = live; live = null; Cat.setSettings(p, s, label);
  }
  function setSettings(fn, label) { const p = photo(); if (!p) return; const s = Model.clone(p.settings); fn(s); live = null; Cat.setSettings(p, s, label); }

  /* =================== viewer =================== */
  function requestRender() { if (rq) return; rq = true; requestAnimationFrame(() => { rq = false; render(); }); }
  function workKey(p) { return 'work:' + p.fileId; }
  function smallKey(p) { return 'small:' + p.fileId; }
  async function ensureSource(p) {
    if (Engine.hasSource(workKey(p))) return;
    const tok = ++loadTok;
    if (!Engine.hasSource(smallKey(p))) { try { const s = await Cat.smallImage(p); if (tok !== loadTok) return; Engine.setSource(smallKey(p), s); requestRender(); } catch (e) { } }
    try {
      const img = await Cat.workImage(p); if (tok !== loadTok && photo() !== p) return;
      Engine.setSource(workKey(p), img); refDims.set(p.fileId, { w: img.width, h: img.height });
      // keep only the active work texture on the GPU
      Engine.sourceKeys?.().forEach(k => { if (k.startsWith('work:') && k !== workKey(p)) Engine.dropSource(k); });
      requestRender();
    } catch (e) { console.error(e); Aero.toast('Could not load ' + p.name + ': ' + e.message); }
  }
  function photoChanged() {
    const p = photo();
    if (cropMode && loadedFor && loadedFor !== p?.id) closeCrop(true, loadedFor);
    if (wbPick) setWBPick(false);
    live = null; preview = null;
    if (loadedFor !== p?.id) { zoom = 'fit'; pan = { x: .5, y: .5 }; }
    loadedFor = p?.id || null;
    if (!viewerShown()) return;
    if (!p) { Engine.canvas.style.display = 'none'; drawOverlay(); return; }
    Engine.canvas.style.display = '';
    if (!$('#glwrap').contains(Engine.canvas)) $('#glwrap').appendChild(Engine.canvas);
    ensureSource(p); requestRender();
    if (isDev()) { syncPanels(); renderHistory(); drawNav(); updateExifLine(); }
  }
  function settingsChanged() { if (!live) { syncPanels(); requestRender(); } renderHistory(); }
  function thumbChanged() { drawNav(); }

  function sourceFor(p) {
    const wk = workKey(p), sk = smallKey(p);
    return Engine.hasSource(wk) ? wk : Engine.hasSource(sk) ? sk : null;
  }
  function geometry(p, st) {
    const key = sourceFor(p); if (!key) return null;
    const ss = Engine.sourceSize(key), ref = refDims.get(p.fileId) || (ss.w > 700 || ss.h > 700 ? ss : { w: p.w, h: p.h });
    // reference dims must have the source's aspect
    const refW = ref.w, refH = ref.w * ss.h / ss.w;
    const vr = $('#viewer').getBoundingClientRect(), dpr = devicePixelRatio || 1;
    const side = isDev() && ba === 'side' && !cropMode;
    const margin = isDev() || S.view === 'loupe' ? 18 : 0;
    const areaW = Math.max(40, (side ? (vr.width - margin * 3) / 2 : vr.width - margin * 2)), areaH = Math.max(40, vr.height - margin * 2 - (cropMode ? 44 : 0));
    const cs = Engine.cropSize(refW, refH, st.crop, cropMode);
    const fit = Math.min(areaW * dpr / cs.w, areaH * dpr / cs.h);
    const z = zoom === 'fit' || cropMode ? fit : zoom * dpr;
    const dispW = cs.w * z, dispH = cs.h * z;
    const view = { x: 0, y: 0, w: 1, h: 1 };
    if (dispW > areaW * dpr + 1) { view.w = areaW * dpr / dispW; view.x = Math.max(0, Math.min(1 - view.w, pan.x - view.w / 2)); }
    if (dispH > areaH * dpr + 1) { view.h = areaH * dpr / dispH; view.y = Math.max(0, Math.min(1 - view.h, pan.y - view.h / 2)); }
    const outW = Math.max(1, Math.round(dispW * view.w)), outH = Math.max(1, Math.round(dispH * view.h));
    return { key, ss, cs, fit, z, view, outW, outH, dpr, side, areaW, areaH, margin, vr, zoomPct: z / dpr };
  }
  function render() {
    const p = photo(); if (!p || !viewerShown()) return;
    let st = Model.clone(cur());
    if (cropMode && cropDraft) st.crop = { ...cropDraft };
    const g = geometry(p, st); if (!g) return;
    const cssW = g.outW / g.dpr, cssH = g.outH / g.dpr;
    const cv = Engine.canvas, bc = $('#beforec');
    if (g.side) {
      Engine.render(g.key, st, { outW: g.outW, outH: g.outH, view: g.view, before: true, target: 'screen' });
      if (bc.width !== g.outW || bc.height !== g.outH) { bc.width = g.outW; bc.height = g.outH; }
      bc.getContext('2d').clearRect(0, 0, g.outW, g.outH); bc.getContext('2d').drawImage(cv, 0, 0);
      Object.assign(bc.style, { width: cssW + 'px', height: cssH + 'px', left: g.margin + (g.areaW - cssW) / 2 + 'px', top: g.margin + (g.areaH - cssH) / 2 + 'px' });
      bc.hidden = false;
    } else bc.hidden = true;
    Engine.render(g.key, st, { outW: g.outW, outH: g.outH, view: g.view, fullCrop: cropMode, split: isDev() && ba === 'split' && !cropMode ? splitPos : null, target: 'screen' });
    const left = g.side ? g.margin * 2 + g.areaW + (g.areaW - cssW) / 2 : g.margin + (g.areaW - cssW) / 2;
    Object.assign(cv.style, { width: cssW + 'px', height: cssH + 'px', left: left + 'px', top: g.margin + (g.areaH - cssH) / 2 + 'px' });
    lastView = { ...g, st, left, top: g.margin + (g.areaH - cssH) / 2, cssW, cssH, pid: p.id };
    const lb = $('#lbl-before'), la = $('#lbl-after');
    const showLbl = isDev() && ba !== 'off' && !cropMode;
    lb.hidden = la.hidden = !showLbl;
    if (showLbl) {
      const top = g.margin + (g.areaH - cssH) / 2 + 8;
      if (g.side) { lb.style.left = (g.margin + (g.areaW - cssW) / 2 + 8) + 'px'; la.style.left = (left + 8) + 'px'; }
      else { lb.style.left = (left + 8) + 'px'; la.style.left = (left + cssW - 52) + 'px'; }
      lb.style.top = la.style.top = top + 'px';
    }
    $('#d-zoom').textContent = zoom === 'fit' || cropMode ? `Fit (${Math.round(g.zoomPct * 100)}%)` : Math.round(g.zoomPct * 100) + '%';
    $('#navzoom').textContent = zoom === 'fit' ? 'Fit' : Math.round(g.zoomPct * 100) + '%';
    drawOverlay(); drawNav();
    updateInfo(p, g);
    // histogram (throttled while dragging, exact when idle)
    if (isDev()) {
      const now = performance.now();
      if (now - lastHist > 90) { lastHist = now; showHist(Engine.histogram('v')); }
      clearTimeout(histTimer); histTimer = setTimeout(() => { lastHist = performance.now(); if (lastView) { Engine.render(lastView.key, lastView.st, { outW: lastView.outW, outH: lastView.outH, view: lastView.view, fullCrop: cropMode, slot: 'v' }); showHist(Engine.histogram('v')); } }, 160);
    }
  }
  function updateInfo(p, g) {
    const box = $('#loupeinfo');
    if (!showInfo) { box.innerHTML = ''; return; }
    const e = p.exif;
    box.innerHTML = `<b>${esc(Cat.displayName(p))}</b><br>${[e.model, e.focal ? Math.round(e.focal) + ' mm' : '', e.aperture ? 'ƒ/' + (+e.aperture.toFixed(1)) : '', Decode.fmtShutter(e.shutter), e.iso ? 'ISO ' + e.iso : ''].filter(Boolean).map(esc).join(' · ')}<br>${p.w} × ${p.h} · ${Math.round(g.zoomPct * 100)}%`;
  }
  function updateExifLine() {
    const p = photo(); if (!p) return; const e = p.exif;
    $('#exifline').innerHTML = [e.iso ? 'ISO ' + e.iso : '', e.focal ? Math.round(e.focal) + ' mm' : '', e.aperture ? 'ƒ/' + (+e.aperture.toFixed(1)) : '', Decode.fmtShutter(e.shutter)].map(x => `<span>${esc(x || '—')}</span>`).join('');
  }

  /* ---------- overlay: crop frame, split line ---------- */
  function drawOverlay() {
    const ov = $('#overlay'), vr = $('#viewer').getBoundingClientRect(), dpr = devicePixelRatio || 1;
    const W = Math.round(vr.width * dpr), H = Math.round(vr.height * dpr);
    if (ov.width !== W || ov.height !== H) { ov.width = W; ov.height = H; }
    const x = ov.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H); x.scale(dpr, dpr);
    if (!lastView || !viewerShown() || !photo()) return;
    const L = lastView;
    if (cropMode && cropDraft) {
      const c = cropDraft, rx = L.left + c.x * L.cssW, ry = L.top + c.y * L.cssH, rw = c.w * L.cssW, rh = c.h * L.cssH;
      x.fillStyle = 'rgba(10,20,35,.55)';
      x.beginPath(); x.rect(L.left, L.top, L.cssW, L.cssH); x.rect(rx, ry, rw, rh); x.fill('evenodd');
      x.strokeStyle = 'rgba(255,255,255,.5)'; x.lineWidth = 1;
      for (let i = 1; i < 3; i++) { x.beginPath(); x.moveTo(rx + rw * i / 3, ry); x.lineTo(rx + rw * i / 3, ry + rh); x.moveTo(rx, ry + rh * i / 3); x.lineTo(rx + rw, ry + rh * i / 3); x.stroke(); }
      x.strokeStyle = '#fff'; x.lineWidth = 1.5; x.strokeRect(rx, ry, rw, rh);
      x.fillStyle = '#fff'; x.strokeStyle = 'rgba(0,30,60,.8)'; x.lineWidth = 1;
      handles(c).forEach(([hx, hy]) => { const px = L.left + hx * L.cssW, py = L.top + hy * L.cssH; x.fillRect(px - 4, py - 4, 8, 8); x.strokeRect(px - 4, py - 4, 8, 8); });
      if (levelLine) { x.strokeStyle = '#ffd23f'; x.lineWidth = 2; x.setLineDash([6, 4]); x.beginPath(); x.moveTo(levelLine.x0, levelLine.y0); x.lineTo(levelLine.x1, levelLine.y1); x.stroke(); x.setLineDash([]); }
    }
    if (isDev() && ba === 'split' && !cropMode) {
      const sx = L.left + splitPos * L.cssW;
      x.strokeStyle = '#fff'; x.lineWidth = 2; x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 4;
      x.beginPath(); x.moveTo(sx, L.top); x.lineTo(sx, L.top + L.cssH); x.stroke();
      x.fillStyle = '#fff'; x.beginPath(); x.arc(sx, L.top + L.cssH / 2, 9, 0, Math.PI * 2); x.fill(); x.shadowBlur = 0;
      x.fillStyle = '#1e395b'; x.font = '11px Segoe UI'; x.textAlign = 'center'; x.fillText('⇔', sx, L.top + L.cssH / 2 + 4);
    }
  }
  const handles = c => [[c.x, c.y], [c.x + c.w / 2, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h / 2], [c.x + c.w, c.y + c.h], [c.x + c.w / 2, c.y + c.h], [c.x, c.y + c.h], [c.x, c.y + c.h / 2]];
  const HANDLE_NAMES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  /* ---------- navigator ---------- */
  const navImg = new Image();
  function drawNav() {
    if (!isDev()) return;
    const p = photo(), c = $('#navc'), box = $('#nav'); if (!p) return;
    const u = Cat.thumbURL.get(p.id); if (!u) return;
    const draw = () => {
      const bw = box.clientWidth - 8, bh = box.clientHeight - 8, s = Math.min(bw / navImg.naturalWidth, bh / navImg.naturalHeight);
      const w = Math.round(navImg.naturalWidth * s), h = Math.round(navImg.naturalHeight * s);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      const x = c.getContext('2d'); x.drawImage(navImg, 0, 0, w, h);
      if (lastView && !cropMode && (lastView.view.w < 1 || lastView.view.h < 1)) {
        const v = lastView.view; x.strokeStyle = '#fff'; x.lineWidth = 2; x.shadowColor = '#000'; x.shadowBlur = 3;
        x.strokeRect(v.x * w, v.y * h, v.w * w, v.h * h); x.shadowBlur = 0;
      }
    };
    if (navImg.src === u && navImg.complete) draw(); else { navImg.onload = draw; navImg.src = u; }
  }

  /* ---------- zoom / pan ---------- */
  function setZoom(z, at) {
    if (!viewerShown()) { if (S.module === 'library') setView('loupe'); }
    const p = photo(); if (!p || cropMode) return;
    if (z !== 'fit' && at && lastView) {
      // keep the point under the cursor: at = crop-uv
      pan = { x: at.x, y: at.y };
    }
    zoom = z === 'fit' ? 'fit' : Math.max(.05, Math.min(8, z)); requestRender();
  }
  function zoomStep(d, at) {
    const g = lastView; const curZ = zoom === 'fit' ? (g ? g.zoomPct : 1) : zoom;
    const steps = [.0625, .125, .25, .33, .5, .67, 1, 1.5, 2, 3, 4, 6, 8];
    let nz = d > 0 ? steps.find(s => s > curZ + 1e-3) : [...steps].reverse().find(s => s < curZ - 1e-3);
    if (nz == null) return;
    if (g && nz <= g.fit / g.dpr) return setZoom('fit');
    if (!at && g) at = { x: g.view.x + g.view.w / 2, y: g.view.y + g.view.h / 2 };
    setZoom(nz, at);
  }
  const uvAt = e => { const L = lastView; if (!L) return null; const r = Engine.canvas.getBoundingClientRect(); const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height; return { u, v, x: L.view.x + u * L.view.w, y: L.view.y + v * L.view.h, inside: u >= 0 && v >= 0 && u <= 1 && v <= 1 }; };

  /* ---------- pointer interaction on the viewer ---------- */
  let drag = null, levelLine = null;
  function wireViewer() {
    const vw = $('#viewer');
    vw.addEventListener('pointerdown', e => {
      if (e.button !== 0 || !lastView || e.target.closest('.aero-pill')) return;
      const p = photo(); if (!p) return;
      const at = uvAt(e);
      if (wbPick) { if (at?.inside) pickWB(e); return; }
      capture(vw, e);
      const vr = vw.getBoundingClientRect(), mx = e.clientX - vr.left, my = e.clientY - vr.top, L = lastView;
      if (cropMode) {
        if (e.ctrlKey || e.metaKey) { drag = { type: 'level' }; levelLine = { x0: mx, y0: my, x1: mx, y1: my }; return; }
        const c = cropDraft; let h = -1;
        handles(c).forEach(([hx, hy], i) => { if (Math.abs(L.left + hx * L.cssW - mx) < 9 && Math.abs(L.top + hy * L.cssH - my) < 9) h = i; });
        const u = (mx - L.left) / L.cssW, v = (my - L.top) / L.cssH;
        if (h >= 0) drag = { type: 'crop', h: HANDLE_NAMES[h], c0: { ...c }, u0: u, v0: v };
        else if (u > c.x && u < c.x + c.w && v > c.y && v < c.y + c.h) drag = { type: 'crop', h: 'move', c0: { ...c }, u0: u, v0: v };
        else drag = { type: 'crop', h: 'new', c0: { ...c }, u0: u, v0: v };
        return;
      }
      if (isDev() && ba === 'split') { const sx = L.left + splitPos * L.cssW; if (Math.abs(mx - sx) < 12) { drag = { type: 'split' }; return; } }
      drag = { type: 'pan', x0: e.clientX, y0: e.clientY, pan0: { ...pan }, moved: false, at, zoomed: L.view.w < 1 || L.view.h < 1 };
      if (drag.zoomed) vw.classList.add('panning');
    });
    vw.addEventListener('pointermove', e => {
      if (!drag) { hoverCursor(e); return; }
      const L = lastView; if (!L) return;
      const vr = vw.getBoundingClientRect(), mx = e.clientX - vr.left, my = e.clientY - vr.top;
      if (drag.type === 'pan') {
        const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0; if (Math.hypot(dx, dy) > 3) drag.moved = true;
        if (drag.zoomed && drag.moved) {
          const fullW = L.cssW / L.view.w, fullH = L.cssH / L.view.h;
          pan.x = Math.max(L.view.w / 2, Math.min(1 - L.view.w / 2, drag.pan0.x - dx / fullW)); pan.y = Math.max(L.view.h / 2, Math.min(1 - L.view.h / 2, drag.pan0.y - dy / fullH));
          if (L.view.w >= 1) pan.x = .5; if (L.view.h >= 1) pan.y = .5;
          requestRender();
        }
      } else if (drag.type === 'split') { splitPos = Math.max(0, Math.min(1, (mx - L.left) / L.cssW)); requestRender(); }
      else if (drag.type === 'level') { levelLine.x1 = mx; levelLine.y1 = my; drawOverlay(); }
      else if (drag.type === 'crop') cropDrag((mx - L.left) / L.cssW, (my - L.top) / L.cssH, e.shiftKey);
    });
    const end = e => {
      if (!drag) return; const d = drag; drag = null; vw.classList.remove('panning');
      if (d.type === 'pan' && !d.moved && !cropMode) {
        // click: toggle fit ↔ 100% at the clicked point
        if (zoom === 'fit' && d.at?.inside) { const fz = lastView ? lastView.fit / lastView.dpr : 1; setZoom(fz < .99 ? 1 : Math.min(8, fz * 2), { x: d.at.x, y: d.at.y }); }
        else setZoom('fit');
      }
      if (d.type === 'level' && levelLine) {
        const dx = levelLine.x1 - levelLine.x0, dy = levelLine.y1 - levelLine.y0; levelLine = null;
        if (Math.hypot(dx, dy) > 20) {
          let a = Math.atan2(dy, dx) * 180 / Math.PI; if (a > 90) a -= 180; if (a < -90) a += 180;
          if (Math.abs(a) > 45) a = a > 0 ? a - 90 : a + 90;
          setCropAngle(Math.max(-45, Math.min(45, cropDraft.angle - a)));
        }
        drawOverlay();
      }
    };
    vw.addEventListener('pointerup', end); vw.addEventListener('pointercancel', end);
    vw.addEventListener('wheel', e => {
      if (!lastView || cropMode) return; e.preventDefault();
      const at = uvAt(e); zoomStep(e.deltaY < 0 ? 1 : -1, at?.inside ? { x: at.x, y: at.y } : null);
    }, { passive: false });
    vw.addEventListener('dblclick', e => { if (cropMode) closeCrop(true); });
  }
  function hoverCursor(e) {
    const vw = $('#viewer'); vw.className = '';
    if (!lastView) return;
    if (wbPick) { vw.classList.add('pick'); return; }
    if (cropMode) {
      const L = lastView, vr = vw.getBoundingClientRect(), mx = e.clientX - vr.left, my = e.clientY - vr.top;
      let cur = 'crosshair'; const c = cropDraft;
      handles(c).forEach(([hx, hy], i) => { if (Math.abs(L.left + hx * L.cssW - mx) < 9 && Math.abs(L.top + hy * L.cssH - my) < 9) cur = ['nwse', 'ns', 'nesw', 'ew', 'nwse', 'ns', 'nesw', 'ew'][i] + '-resize'; });
      const u = (mx - L.left) / L.cssW, v = (my - L.top) / L.cssH;
      if (cur === 'crosshair' && u > c.x && u < c.x + c.w && v > c.y && v < c.y + c.h) cur = 'move';
      vw.style.cursor = cur; return;
    }
    vw.style.cursor = '';
    if (isDev() && ba === 'split') { const L = lastView, vr = vw.getBoundingClientRect(); if (Math.abs(e.clientX - vr.left - (L.left + splitPos * L.cssW)) < 12) { vw.style.cursor = 'ew-resize'; return; } }
    const zoomed = lastView.view.w < 1 || lastView.view.h < 1;
    vw.classList.add(zoomed ? 'pan' : 'zin');
  }

  /* ---------- white balance picker ---------- */
  function setWBPick(on) { wbPick = on; $('#wbhint').hidden = !on; $('#d-wb').classList.toggle('on', on); $('#viewer').classList.toggle('pick', on); $$('.wbpick').forEach(b => b.classList.toggle('on', on)); }
  function toggleWBPick() { if (!isDev()) setModule('develop'); if (cropMode) closeCrop(true); setWBPick(!wbPick); }
  function pickWB(e) {
    const p = photo(), L = lastView; if (!p || !L) return;
    if (L.pid !== p.id) { Aero.toast('The photo is still loading — try again in a moment'); return; }
    // make sure the geometry buffer matches the visible view, then sample it
    Engine.render(L.key, L.st, { outW: L.outW, outH: L.outH, view: L.view, slot: 'v' });
    const r = Engine.canvas.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width * L.outW, py = (e.clientY - r.top) / r.height * L.outH;
    const rgb = Engine.sampleLinear(px, py, 3);
    setWBPick(false);
    if (!rgb || Math.max(...rgb) < .002) { Aero.toast('That spot is too dark to measure — pick a brighter neutral area'); requestRender(); return; }
    if (Math.max(...rgb) > .995) Aero.toast('That spot is clipped — results may be inaccurate');
    const wb = Engine.solveWB(rgb);
    setSettings(s => { s.wb = { temp: Math.round(wb.temp * 10) / 10, tint: Math.round(wb.tint * 10) / 10 }; }, 'White balance (picker)');
  }

  /* ---------- crop ---------- */
  function aspectRatio(a, p, c) {
    if (a === 'free') return null;
    const key = sourceFor(p), ss = key ? Engine.sourceSize(key) : { w: p.w, h: p.h }, o = Engine.orientedSize(ss.w, ss.h, c);
    if (a === 'original') return o.w / o.h;
    const [x, y] = a.split(':').map(Number); return x / y;
  }
  function frameDims(p, c) { const key = sourceFor(p), ss = key ? Engine.sourceSize(key) : { w: p.w, h: p.h }; return { ...Engine.orientedSize(ss.w, ss.h, c), sw: ss.w, sh: ss.h }; }
  function fitAspect(c, R, p) {
    // largest rect with pixel ratio R centred on c's centre, inside the frame, then constrained to the rotated image
    const f = frameDims(p, c); const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    let w = c.w, h = w * f.w / (f.h * R); if (h > c.h) { h = c.h; w = h * f.h * R / f.w; }
    // grow to the max that fits around the centre
    const maxW = Math.min(1, 2 * Math.min(cx, 1 - cx) / 1), maxH = 2 * Math.min(cy, 1 - cy);
    let s = Math.min(maxW / w, maxH / h); w *= s; h *= s;
    const r = Engine.constrainCrop(f.sw, f.sh, { ...c, w, h, x: cx - w / 2, y: cy - h / 2 });
    return r;
  }
  function openCrop() {
    const p = photo(); if (!p) return; if (!isDev()) setModule('develop');
    if (wbPick) setWBPick(false);
    cropMode = true; cropDraft = { ...p.settings.crop }; zoom = 'fit';
    $('#croppill').hidden = false; $('#d-crop').classList.toggle('on', true);
    syncCropUI(); requestRender();
  }
  function closeCrop(apply, pid) {
    const p = pid ? Cat.photos.get(pid) : photo();
    cropMode = false; $('#croppill').hidden = true; $('#d-crop').classList.toggle('on', false);
    if (apply && p && cropDraft && JSON.stringify(cropDraft) !== JSON.stringify(p.settings.crop)) { const s = Model.clone(p.settings); s.crop = { ...cropDraft }; Cat.setSettings(p, s, 'Crop'); }
    cropDraft = null; $('#viewer').style.cursor = ''; requestRender();
  }
  function toggleCrop() { if (cropMode) closeCrop(true); else openCrop(); }
  function syncCropUI() {
    const c = cropMode ? cropDraft : photo()?.settings.crop; if (!c) return;
    $('#cp-aspect').value = c.aspect; $('#cp-angle').value = c.angle; $('#cp-anglev').textContent = c.angle.toFixed(1) + '°';
    const pa = $('#pc-aspect'); if (pa) { pa.value = c.aspect; $('#pc-angle').value = c.angle; $('#pc-anglev').textContent = c.angle.toFixed(1) + '°'; }
  }
  function cropDrag(u, v, shift) {
    const p = photo(), d = drag, c0 = d.c0, f = frameDims(p, c0);
    const du = u - d.u0, dv = v - d.v0, MIN = .03;
    let c = { ...c0 };
    let R = aspectRatio(c0.aspect, p, c0); if (shift && !R) R = (c0.w * f.w) / (c0.h * f.h);
    const hName = d.h;
    if (hName === 'move') { c.x = Math.max(0, Math.min(1 - c.w, c0.x + du)); c.y = Math.max(0, Math.min(1 - c.h, c0.y + dv)); }
    else if (hName === 'new') {
      const x0 = Math.max(0, Math.min(1, d.u0)), y0 = Math.max(0, Math.min(1, d.v0)), x1 = Math.max(0, Math.min(1, u)), y1 = Math.max(0, Math.min(1, v));
      c.x = Math.min(x0, x1); c.y = Math.min(y0, y1); c.w = Math.max(MIN, Math.abs(x1 - x0)); c.h = Math.max(MIN, Math.abs(y1 - y0));
      if (R) { const hh = c.w * f.w / (f.h * R); c.h = hh; if (y1 < y0) c.y = y0 - hh; }
    } else {
      let L = c0.x, T = c0.y, Rr = c0.x + c0.w, B = c0.y + c0.h;
      if (hName.includes('w')) L = Math.min(Rr - MIN, c0.x + du); if (hName.includes('e')) Rr = Math.max(L + MIN, c0.x + c0.w + du);
      if (hName.includes('n')) T = Math.min(B - MIN, c0.y + dv); if (hName.includes('s')) B = Math.max(T + MIN, c0.y + c0.h + dv);
      if (R) {
        if (hName === 'n' || hName === 's') { const h = B - T, w = h * f.h * R / f.w, cx = c0.x + c0.w / 2; L = cx - w / 2; Rr = cx + w / 2; }
        else if (hName === 'e' || hName === 'w') { const w = Rr - L, h = w * f.w / (f.h * R), cy = c0.y + c0.h / 2; T = cy - h / 2; B = cy + h / 2; }
        else { const w = Rr - L, h = w * f.w / (f.h * R); if (hName.includes('n')) T = B - h; else B = T + h; }
      }
      c.x = L; c.y = T; c.w = Rr - L; c.h = B - T;
    }
    // keep inside the (rotated) image: binary search between the last valid rect and the request
    const ok = r => r.x >= -1e-6 && r.y >= -1e-6 && r.x + r.w <= 1 + 1e-6 && r.y + r.h <= 1 + 1e-6 && Engine.cropInside(f.sw, f.sh, r);
    const prev = cropDraft;
    if (!ok(c)) {
      const lerp = t => ({ ...c, x: prev.x + (c.x - prev.x) * t, y: prev.y + (c.y - prev.y) * t, w: prev.w + (c.w - prev.w) * t, h: prev.h + (c.h - prev.h) * t });
      let lo = 0, hi = 1; for (let i = 0; i < 20; i++) { const m = (lo + hi) / 2; if (ok(lerp(m))) lo = m; else hi = m; }
      c = lerp(lo); if (!ok(c)) c = prev;
    }
    cropDraft = c; requestRender();
  }
  function setAspect(a) {
    const p = photo(); if (!p) return;
    const apply = c => { c = { ...c, aspect: a }; const R = aspectRatio(a, p, c); return R ? fitAspect(c, R, p) : c; };
    if (cropMode) { cropDraft = apply(cropDraft); syncCropUI(); requestRender(); }
    else setSettings(s => { s.crop = apply(s.crop); }, 'Crop aspect ' + a);
  }
  function swapAspect() {
    const p = photo(); if (!p) return; const c = cropMode ? cropDraft : p.settings.crop;
    if (c.aspect === 'free' || c.aspect === 'original') { const f = frameDims(p, c); const R = (c.h * f.h) / (c.w * f.w); const n = fitAspect({ ...c, aspect: 'free' }, R, p); if (cropMode) { cropDraft = { ...n, aspect: 'free' }; requestRender(); } return; }
    const [x, y] = c.aspect.split(':'); setAspect(`${y}:${x}`);
    $('#cp-aspect').value = cropMode ? cropDraft.aspect : c.aspect;
  }
  function setCropAngle(a) {
    const p = photo(); if (!p) return;
    const fix = c => { const f = frameDims(p, c); let n = { ...c, angle: a }; n = Engine.constrainCrop(f.sw, f.sh, n); const R = aspectRatio(c.aspect, p, c); return R ? fitAspect(n, R, p) : n; };
    if (cropMode) { // straighten keeps the crop as large as possible: start from the full frame each time
      const R = aspectRatio(cropDraft.aspect, p, cropDraft) || (cropDraft.w * frameDims(p, cropDraft).w) / (cropDraft.h * frameDims(p, cropDraft).h);
      const f = frameDims(p, cropDraft); const base = { ...cropDraft, angle: a };
      cropDraft = Math.abs(a) < 1e-9 && cropDraft.angle === 0 ? base : fitAspect(Engine.constrainCrop(f.sw, f.sh, base), R, p);
      syncCropUI(); requestRender();
    } else setSettings(s => { s.crop = fix(s.crop); }, 'Straighten');
  }
  function rotatedSettings(s, d) {
    s = Model.clone(s); const c = s.crop;
    if (d > 0) s.crop = { ...c, rot: (c.rot + 1) % 4, x: 1 - c.y - c.h, y: c.x, w: c.h, h: c.w };
    else s.crop = { ...c, rot: (c.rot + 3) % 4, x: c.y, y: 1 - c.x - c.w, w: c.h, h: c.w };
    if (/^\d+:\d+$/.test(c.aspect)) { const [a, b] = c.aspect.split(':'); s.crop.aspect = `${b}:${a}`; }
    return s;
  }
  function rotate(d) {
    const p = photo(); if (!p) return;
    if (cropMode) { cropDraft = rotatedSettings({ ...p.settings, crop: cropDraft }, d).crop; syncCropUI(); requestRender(); }
    else { live = null; Cat.setSettings(p, rotatedSettings(p.settings, d), d > 0 ? 'Rotate right' : 'Rotate left'); }
  }
  function flip(axis) {
    const p = photo(); if (!p) return;
    const f = c => axis === 'h' ? { ...c, flipH: !c.flipH, x: 1 - c.x - c.w, angle: -c.angle } : { ...c, flipV: !c.flipV, y: 1 - c.y - c.h, angle: -c.angle };
    if (cropMode) { cropDraft = f(cropDraft); syncCropUI(); requestRender(); }
    else setSettings(s => { s.crop = f(s.crop); }, axis === 'h' ? 'Flip horizontal' : 'Flip vertical');
  }
  function resetCrop() {
    const p = photo(); if (!p) return; const d = Model.defaults().crop;
    if (cropMode) { cropDraft = { ...d }; syncCropUI(); requestRender(); } else setSettings(s => { s.crop = d; }, 'Reset crop');
  }

  /* =================== panels =================== */
  const fmtInt = v => (v > 0 ? '+' : '') + Math.round(v);
  const fmtPlain = v => String(Math.round(v));
  function slider(parent, label, path, min, max, step = 1, fmt = fmtInt, grad = null, histName = label) {
    const row = el('div', 'srow' + (grad ? ' grad' : ''));
    row.innerHTML = `<span title="Double-click to reset">${esc(label)}</span><input type="range" min="${min}" max="${max}" step="${step}"><input class="sv" type="text" spellcheck="false">`;
    if (grad) row.style.setProperty('--trk', grad);
    const [lab, rng, sv] = row.children;
    const S_ = { path, rng, sv, fmt, label, min, max };
    rng.addEventListener('input', () => { if (!photo()) return; beginLive(); setP(live, path, +rng.value); sv.value = fmt(+rng.value); requestRender(); });
    rng.addEventListener('change', () => commit(`${histName} ${fmt(+rng.value)}`));
    rng.addEventListener('dblclick', () => resetOne());
    const resetOne = () => { if (!photo()) return; beginLive(); setP(live, path, getP(Model.defaults(), path)); commit(`Reset ${histName}`); };
    lab.addEventListener('dblclick', resetOne);
    sv.addEventListener('change', () => { let v = parseFloat(sv.value); if (!Number.isFinite(v) || !photo()) { syncPanels(); return; } v = Math.max(min, Math.min(max, v)); beginLive(); setP(live, path, v); commit(`${histName} ${fmt(v)}`); });
    sv.addEventListener('keydown', e => { if (e.key === 'Enter') sv.blur(); if (e.key === 'Escape') { syncPanels(); sv.blur(); } });
    parent.appendChild(row); sliders.push(S_); return row;
  }
  function sub(parent, text) { parent.appendChild(el('div', 'sub', esc(text))); }
  function panel(id, title, color, groups, build, closed = false) {
    const pn = el('div', 'dpanel' + (closed ? ' closed' : '')); pn.dataset.p = id;
    const h = el('div', 'aero-ph', `<span class="tw">▾</span><span class="phi" style="background:${color}"></span>${esc(title)}<button class="rst" title="Reset this panel">Reset</button>`);
    const body = el('div', 'pbody');
    h.onclick = e => { if (e.target.closest('.rst')) return; pn.classList.toggle('closed'); if (id === 'curve') drawCurve(); if (id === 'grade') drawWheels(); };
    h.querySelector('.rst').onclick = () => setSettings(s => { const d = Model.defaults(); groups.forEach(g => Model.GROUPS[g].keys.forEach(k => s[k] = Model.clone(d[k]))); }, `Reset ${title}`);
    pn.append(h, body); build(body); $('#panels').appendChild(pn); return pn;
  }
  function buildPanels() {
    const hueGrad = 'linear-gradient(90deg,#f0f,#f00,#ff0,#0f0,#0ff,#00f,#f0f)';
    panel('basic', 'Basic', 'linear-gradient(#ffe9a0,#e3a21a)', ['wb', 'tone', 'presence', 'treatment'], b => {
      const tr = el('div', 'btnrow', '<span class="dim" style="align-self:center;width:72px">Treatment</span><button class="aero-btn" data-t="0">Color</button><button class="aero-btn" data-t="1">Black &amp; White</button>');
      tr.onclick = e => { const t = e.target.closest('[data-t]'); if (t) setSettings(s => { s.bw = t.dataset.t === '1'; }, t.dataset.t === '1' ? 'Black & white' : 'Color'); };
      b.appendChild(tr);
      sub(b, 'White balance');
      const wbr = el('div', 'btnrow', '<button class="aero-btn wbpick" title="White balance selector (W) — click a neutral area">✚ Pick neutral</button><button class="aero-btn" data-wb="shot">As shot</button><button class="aero-btn" data-wb="auto">Auto</button>');
      wbr.onclick = e => { if (e.target.closest('.wbpick')) toggleWBPick(); const w = e.target.closest('[data-wb]'); if (w) w.dataset.wb === 'shot' ? setSettings(s => { s.wb = { temp: 0, tint: 0 }; }, 'White balance as shot') : autoWB(); };
      b.appendChild(wbr);
      slider(b, 'Temp', 'wb.temp', -100, 100, .5, fmtInt, 'linear-gradient(90deg,#3a76e0,#d9dde0 50%,#e8c23a)');
      slider(b, 'Tint', 'wb.tint', -100, 100, .5, fmtInt, 'linear-gradient(90deg,#3cb84a,#d9dde0 50%,#c84ad0)');
      const tn = el('div', 'sub', 'Tone <button class="aero-btn small" style="margin-left:auto;min-width:0" title="Auto tone (Ctrl+U)">Auto</button>');
      tn.querySelector('button').onclick = autoTone; b.appendChild(tn);
      slider(b, 'Exposure', 'exposure', -5, 5, .01, v => (v > 0 ? '+' : '') + v.toFixed(2), 'linear-gradient(90deg,#222,#ddd)');
      slider(b, 'Contrast', 'contrast', -100, 100);
      slider(b, 'Highlights', 'highlights', -100, 100); slider(b, 'Shadows', 'shadows', -100, 100);
      slider(b, 'Whites', 'whites', -100, 100); slider(b, 'Blacks', 'blacks', -100, 100);
      sub(b, 'Presence');
      slider(b, 'Texture', 'texture', -100, 100); slider(b, 'Clarity', 'clarity', -100, 100); slider(b, 'Dehaze', 'dehaze', -100, 100);
      slider(b, 'Vibrance', 'vibrance', -100, 100, 1, fmtInt, 'linear-gradient(90deg,#9aa,#e44 30%,#fd3 50%,#3c4 70%,#36f)');
      slider(b, 'Saturation', 'saturation', -100, 100, 1, fmtInt, 'linear-gradient(90deg,#888,#e44 30%,#fd3 50%,#3c4 70%,#36f)');
    });
    panel('curve', 'Tone Curve', 'linear-gradient(135deg,#fff,#555)', ['curve'], b => {
      const tabs = el('div', 'tabs-mini', ['rgb', 'r', 'g', 'b'].map(c => `<button data-c="${c}" class="${c === curveCh ? 'on' : ''}">${{ rgb: 'RGB', r: 'Red', g: 'Green', b: 'Blue' }[c]}</button>`).join(''));
      tabs.onclick = e => { const t = e.target.closest('[data-c]'); if (!t) return; curveCh = t.dataset.c; tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === t)); drawCurve(); };
      b.appendChild(tabs);
      const box = el('div', 'curvebox', '<canvas id="curvec" width="260" height="260" title="Click to add a point, drag to move, double-click or drag off to remove"></canvas>'); b.appendChild(box);
      const pr = el('div', 'btnrow', '<button class="aero-btn" data-cp="lin">Linear</button><button class="aero-btn" data-cp="med">Medium contrast</button><button class="aero-btn" data-cp="strong">Strong</button><button class="aero-btn" data-cp="fade">Faded</button>');
      pr.onclick = e => { const t = e.target.closest('[data-cp]'); if (!t) return; const P = { lin: [[0, 0], [1, 1]], med: [[0, 0], [.25, .21], [.75, .8], [1, 1]], strong: [[0, 0], [.25, .16], [.75, .86], [1, 1]], fade: [[0, .1], [.3, .32], [.75, .76], [1, .95]] }[t.dataset.cp]; setSettings(s => { s.curve[curveCh] = P; }, 'Tone curve ' + t.textContent); };
      b.appendChild(pr);
      wireCurve($('#curvec', box) || box.querySelector('canvas'));
    }, true);
    panel('hsl', 'Color Mixer (HSL)', 'linear-gradient(135deg,#f44,#fd3,#3c4,#36f)', ['hsl'], b => {
      const tabs = el('div', 'tabs-mini', ['hue', 'sat', 'lum'].map(t => `<button data-h="${t}" class="${t === hslTab ? 'on' : ''}">${{ hue: 'Hue', sat: 'Saturation', lum: 'Luminance' }[t]}</button>`).join(''));
      b.appendChild(tabs);
      const groups = {};
      ['hue', 'sat', 'lum'].forEach(t => {
        const g = el('div'); g.hidden = t !== hslTab; groups[t] = g; b.appendChild(g);
        Model.BANDS.forEach((n, i) => {
          const c = Model.BAND_COLORS[i];
          const prevC = Model.BAND_COLORS[(i + 7) % 8], nextC = Model.BAND_COLORS[(i + 1) % 8];
          const grad = t === 'hue' ? `linear-gradient(90deg,${prevC},${c},${nextC})` : t === 'sat' ? `linear-gradient(90deg,#9a9a9a,${c})` : `linear-gradient(90deg,#000,${c},#fff)`;
          slider(g, n, `hsl.${t}.${i}`, -100, 100, 1, fmtInt, grad, `${n} ${{ hue: 'hue', sat: 'saturation', lum: 'luminance' }[t]}`);
        });
      });
      tabs.onclick = e => { const t = e.target.closest('[data-h]'); if (!t) return; hslTab = t.dataset.h; tabs.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === t)); Object.entries(groups).forEach(([k, g]) => g.hidden = k !== hslTab); };
    }, true);
    panel('grade', 'Color Grading', 'conic-gradient(#f44,#fd3,#3c4,#3cf,#36f,#c4f,#f44)', ['grade'], b => {
      const w = el('div', 'wheels');
      [['sh', 'Shadows'], ['mid', 'Midtones'], ['hi', 'Highlights']].forEach(([k, n]) => {
        const d = el('div', '', `<div class="wl">${n}</div><canvas data-w="${k}" width="120" height="120" title="Drag to set hue & saturation, double-click to reset"></canvas><div class="wv" data-wv="${k}"></div>`);
        w.appendChild(d);
      });
      b.appendChild(w);
      w.querySelectorAll('canvas').forEach(wireWheel);
      sub(b, 'Luminance');
      slider(b, 'Shadows', 'grade.sh.l', -100, 100, 1, fmtInt, null, 'Grading shadows lum'); slider(b, 'Midtones', 'grade.mid.l', -100, 100, 1, fmtInt, null, 'Grading midtones lum'); slider(b, 'Highlights', 'grade.hi.l', -100, 100, 1, fmtInt, null, 'Grading highlights lum');
      sub(b, 'Mix');
      slider(b, 'Blending', 'grade.blend', 0, 100, 1, fmtPlain, null, 'Grading blending'); slider(b, 'Balance', 'grade.bal', -100, 100, 1, fmtInt, null, 'Grading balance');
    }, true);
    panel('detail', 'Detail', 'linear-gradient(#cfd8e2,#6a7a8c)', ['detail'], b => {
      sub(b, 'Sharpening');
      slider(b, 'Amount', 'sharpen.amount', 0, 150, 1, fmtPlain, null, 'Sharpening'); slider(b, 'Radius', 'sharpen.radius', .5, 3, .1, v => v.toFixed(1), null, 'Sharpen radius');
      slider(b, 'Detail', 'sharpen.detail', 0, 100, 1, fmtPlain, null, 'Sharpen detail'); slider(b, 'Masking', 'sharpen.mask', 0, 100, 1, fmtPlain, null, 'Sharpen masking');
      sub(b, 'Noise reduction');
      slider(b, 'Luminance', 'nr.lum', 0, 100, 1, fmtPlain, null, 'Luminance NR'); slider(b, 'Color', 'nr.color', 0, 100, 1, fmtPlain, null, 'Color NR');
      b.appendChild(el('div', 'dim', 'Tip: zoom to 1:1 (Ctrl+1) to judge sharpening and noise reduction.'));
    }, true);
    panel('effects', 'Effects', 'radial-gradient(#fff,#333)', ['effects'], b => {
      sub(b, 'Post-crop vignetting');
      slider(b, 'Amount', 'vignette.amount', -100, 100, 1, fmtInt, 'linear-gradient(90deg,#111,#ccc 50%,#fff)', 'Vignette'); slider(b, 'Midpoint', 'vignette.mid', 0, 100, 1, fmtPlain, null, 'Vignette midpoint');
      slider(b, 'Roundness', 'vignette.round', -100, 100, 1, fmtInt, null, 'Vignette roundness'); slider(b, 'Feather', 'vignette.feather', 0, 100, 1, fmtPlain, null, 'Vignette feather');
      sub(b, 'Grain');
      slider(b, 'Amount', 'grain.amount', 0, 100, 1, fmtPlain, null, 'Grain'); slider(b, 'Size', 'grain.size', 0, 100, 1, fmtPlain, null, 'Grain size'); slider(b, 'Roughness', 'grain.rough', 0, 100, 1, fmtPlain, null, 'Grain roughness');
    }, true);
    panel('crop', 'Crop & Geometry', 'linear-gradient(#b8f28a,#2a7f14)', ['crop'], b => {
      const r1 = el('div', 'btnrow', '<button class="aero-btn" data-c="edit" title="Crop overlay (R)">✂ Edit crop…</button><button class="aero-btn" data-c="rl" title="Rotate left">⟲ Left</button><button class="aero-btn" data-c="rr" title="Rotate right">⟳ Right</button><button class="aero-btn" data-c="fh">⇋ Flip H</button><button class="aero-btn" data-c="fv">⥮ Flip V</button>');
      r1.onclick = e => { const t = e.target.closest('[data-c]'); if (!t) return; ({ edit: toggleCrop, rl: () => rotate(-1), rr: () => rotate(1), fh: () => flip('h'), fv: () => flip('v') })[t.dataset.c](); };
      b.appendChild(r1);
      const r2 = el('div', 'srow', `<span>Aspect</span><select id="pc-aspect">${ASPECTS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('')}</select><span></span>`);
      r2.style.gridTemplateColumns = '78px 1fr 10px'; b.appendChild(r2);
      $('#pc-aspect', r2); r2.querySelector('select').onchange = e => setAspect(e.target.value);
      const r3 = el('div', 'srow', '<span>Angle</span><input type="range" id="pc-angle" min="-45" max="45" step="0.1"><span id="pc-anglev" class="dim"></span>'); b.appendChild(r3);
      const ang = r3.querySelector('input');
      ang.oninput = () => { if (!cropMode) openCrop(); setCropAngle(+ang.value); };
      r3.querySelector('span').ondblclick = () => { if (cropMode) setCropAngle(0); else setSettings(s => { s.crop.angle = 0; }, 'Straighten 0°'); };
      b.appendChild(el('div', 'dim', 'In crop mode: drag corners/edges, drag inside to move, Shift locks the ratio, Ctrl-drag along the horizon to level it. Enter or double-click to apply.'));
    }, true);
    // crop pill
    $('#cp-aspect').innerHTML = ASPECTS.map(([v, n]) => `<option value="${v}">${n}</option>`).join('');
    $('#cp-aspect').onchange = e => setAspect(e.target.value);
    $('#cp-swap').onclick = swapAspect;
    $('#cp-angle').oninput = e => setCropAngle(+e.target.value);
    $('#cp-angle').ondblclick = () => setCropAngle(0);
    $('#cp-rl').onclick = () => rotate(-1); $('#cp-rr').onclick = () => rotate(1);
    $('#cp-fh').onclick = () => flip('h'); $('#cp-fv').onclick = () => flip('v');
    $('#cp-reset').onclick = resetCrop; $('#cp-done').onclick = () => closeCrop(true);
  }
  function syncPanels() {
    const p = photo(); if (!p) return; const s = live || p.settings;
    sliders.forEach(x => { const v = getP(s, x.path); if (document.activeElement !== x.rng) x.rng.value = v; if (document.activeElement !== x.sv) x.sv.value = x.fmt(v); });
    $$('#panels [data-t]').forEach(b => b.classList.toggle('on', (b.dataset.t === '1') === !!s.bw));
    syncCropUI(); drawCurve(); drawWheels();
    // mark panels that differ from defaults
    const d = Model.defaults();
    $$('#panels .dpanel').forEach(pn => {
      const groups = { basic: ['wb', 'tone', 'presence', 'treatment'], curve: ['curve'], hsl: ['hsl'], grade: ['grade'], detail: ['detail'], effects: ['effects'], crop: ['crop'] }[pn.dataset.p];
      const changed = groups.some(g => Model.GROUPS[g].keys.some(k => JSON.stringify(s[k]) !== JSON.stringify(d[k]) && !(k === 'crop' && Model.isCropDefault(s.crop))));
      pn.querySelector('.rst').style.visibility = changed ? 'visible' : 'hidden';
    });
  }

  /* ---------- tone curve editor ---------- */
  let curveDrag = null;
  function curvePts() { const s = cur(); return s ? s.curve[curveCh] : [[0, 0], [1, 1]]; }
  function drawCurve() {
    const c = $('#curvec'); if (!c || c.closest('.dpanel').classList.contains('closed')) return;
    const r = c.getBoundingClientRect(), dpr = devicePixelRatio || 1, W = Math.max(50, Math.round(r.width * dpr));
    if (c.width !== W) { c.width = W; c.height = W; }
    const x = c.getContext('2d'), s = cur(); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, W);
    const P = 8 * dpr, Z = W - 2 * P; const tx = v => P + v * Z, ty = v => P + (1 - v) * Z;
    x.fillStyle = '#fbfcfe'; x.fillRect(0, 0, W, W);
    // histogram backdrop
    const H = Engine.histogram ? lastHistData : null;
    if (H) { let mx = 1; for (let i = 2; i < 254; i++) mx = Math.max(mx, H[3][i]); mx = Math.sqrt(mx); x.fillStyle = 'rgba(120,140,165,.22)'; x.beginPath(); x.moveTo(tx(0), ty(0)); for (let i = 0; i < 256; i++) x.lineTo(tx(i / 255), ty(Math.min(1, Math.sqrt(H[3][i]) / mx) * .9)); x.lineTo(tx(1), ty(0)); x.fill(); }
    x.strokeStyle = '#dde5ee'; x.lineWidth = 1;
    for (let i = 0; i <= 4; i++) { x.beginPath(); x.moveTo(tx(i / 4), ty(0)); x.lineTo(tx(i / 4), ty(1)); x.moveTo(tx(0), ty(i / 4)); x.lineTo(tx(1), ty(i / 4)); x.stroke(); }
    x.strokeStyle = '#c5cfdb'; x.setLineDash([3, 3]); x.beginPath(); x.moveTo(tx(0), ty(0)); x.lineTo(tx(1), ty(1)); x.stroke(); x.setLineDash([]);
    const colors = { rgb: '#222', r: '#d8302a', g: '#2a9a3a', b: '#2a5ad8' };
    if (!s) return;
    ['rgb', 'r', 'g', 'b'].forEach(ch => {
      if (ch === curveCh) return; const pts = s.curve[ch]; if (pts.length === 2 && pts[0][0] === 0 && pts[0][1] === 0 && pts[1][0] === 1 && pts[1][1] === 1) return;
      const L = Engine.splineLUT(pts); x.strokeStyle = colors[ch] + '55'; x.lineWidth = 1.2 * dpr; x.beginPath(); for (let i = 0; i < 256; i++) i ? x.lineTo(tx(i / 255), ty(L[i])) : x.moveTo(tx(0), ty(L[0])); x.stroke();
    });
    const pts = s.curve[curveCh], L = Engine.splineLUT(pts);
    x.strokeStyle = colors[curveCh]; x.lineWidth = 2 * dpr; x.beginPath(); for (let i = 0; i < 256; i++) i ? x.lineTo(tx(i / 255), ty(L[i])) : x.moveTo(tx(0), ty(L[0])); x.stroke();
    pts.forEach((q, i) => { x.fillStyle = curveDrag?.i === i ? colors[curveCh] : '#fff'; x.strokeStyle = colors[curveCh]; x.lineWidth = 1.5 * dpr; x.beginPath(); x.arc(tx(q[0]), ty(q[1]), 4.5 * dpr, 0, Math.PI * 2); x.fill(); x.stroke(); });
  }
  let lastHistData = null;
  function wireCurve(c) {
    const pos = e => { const r = c.getBoundingClientRect(), pad = 8, Z = r.width - 2 * pad; return [(e.clientX - r.left - pad) / Z, 1 - (e.clientY - r.top - pad) / Z]; };
    c.addEventListener('pointerdown', e => {
      if (!photo()) return; e.preventDefault(); capture(c, e);
      beginLive(); const pts = live.curve[curveCh].map(q => [...q]); const [u, v] = pos(e);
      let i = pts.findIndex(q => Math.hypot(q[0] - u, q[1] - v) < .045);
      if (i < 0) { pts.push([Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v))]); pts.sort((a, b) => a[0] - b[0]); i = pts.findIndex(q => q[0] === Math.max(0, Math.min(1, u)) && q[1] === Math.max(0, Math.min(1, v))); }
      if (pts.length > 16) { live = null; return Aero.toast('A curve can have at most 16 points'); }
      live.curve[curveCh] = pts; curveDrag = { i, remove: false }; requestRender(); drawCurve();
    });
    c.addEventListener('pointermove', e => {
      if (!curveDrag || !live) return; const pts = live.curve[curveCh], i = curveDrag.i; let [u, v] = pos(e);
      const lo = i > 0 ? pts[i - 1][0] + .01 : 0, hi = i < pts.length - 1 ? pts[i + 1][0] - .01 : 1;
      curveDrag.remove = pts.length > 2 && (v < -.12 || v > 1.12 || u < -.12 || u > 1.12) && i > 0 && i < pts.length - 1;
      pts[i] = [Math.max(lo, Math.min(hi, u)), Math.max(0, Math.min(1, v))];
      if (curveDrag.remove) { const tmp = pts.filter((_, k) => k !== i); live.curve[curveCh] = tmp; requestRender(); drawCurve(); live.curve[curveCh] = pts; return; }
      requestRender(); drawCurve();
    });
    const up = () => { if (!curveDrag) return; if (curveDrag.remove && live) live.curve[curveCh] = live.curve[curveCh].filter((_, k) => k !== curveDrag.i); curveDrag = null; commit('Tone curve'); drawCurve(); };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('dblclick', e => {
      const p = photo(); if (!p) return; const [u, v] = pos(e); const pts = p.settings.curve[curveCh];
      const i = pts.findIndex(q => Math.hypot(q[0] - u, q[1] - v) < .05);
      if (i > 0 && i < pts.length - 1) setSettings(s => { s.curve[curveCh] = pts.filter((_, k) => k !== i); }, 'Tone curve: remove point');
      else if (i < 0) setSettings(s => { s.curve[curveCh] = [[0, 0], [1, 1]]; }, 'Tone curve reset');
    });
  }

  /* ---------- colour wheels ---------- */
  function drawWheels() {
    const s = cur(); if (!s) return;
    $$('.wheels canvas').forEach(c => {
      if (c.closest('.dpanel').classList.contains('closed')) return;
      const k = c.dataset.w, g = s.grade[k], dpr = devicePixelRatio || 1, r = c.getBoundingClientRect(), W = Math.max(40, Math.round(r.width * dpr));
      if (c.width !== W) { c.width = W; c.height = W; }
      const x = c.getContext('2d'), R = W / 2 - 3 * dpr, cx = W / 2;
      x.clearRect(0, 0, W, W);
      const cg = x.createConicGradient(0, cx, cx); // 0 rad = 3 o'clock, clockwise in canvas → hue increases counter-clockwise below
      for (let i = 0; i <= 12; i++) cg.addColorStop(i / 12, `hsl(${360 - i * 30},90%,55%)`);
      x.fillStyle = cg; x.beginPath(); x.arc(cx, cx, R, 0, Math.PI * 2); x.fill();
      const rg = x.createRadialGradient(cx, cx, 0, cx, cx, R); rg.addColorStop(0, 'rgba(240,240,240,1)'); rg.addColorStop(1, 'rgba(240,240,240,0)');
      x.fillStyle = rg; x.fill();
      x.strokeStyle = 'rgba(0,30,60,.5)'; x.lineWidth = dpr; x.stroke();
      const a = g.h * Math.PI / 180, rr = g.s / 100 * R, px = cx + Math.cos(a) * rr, py = cx - Math.sin(a) * rr;
      x.strokeStyle = 'rgba(0,0,0,.25)'; x.beginPath(); x.moveTo(cx - 5 * dpr, cx); x.lineTo(cx + 5 * dpr, cx); x.moveTo(cx, cx - 5 * dpr); x.lineTo(cx, cx + 5 * dpr); x.stroke();
      x.fillStyle = '#fff'; x.strokeStyle = '#123'; x.lineWidth = 1.5 * dpr; x.beginPath(); x.arc(px, py, 5 * dpr, 0, Math.PI * 2); x.fill(); x.stroke();
      const wv = $(`.wheels [data-wv="${k}"]`); if (wv) wv.textContent = g.s ? `H ${Math.round(g.h)}° · S ${Math.round(g.s)}` : 'neutral';
    });
  }
  function wireWheel(c) {
    const k = c.dataset.w; let dragging = false;
    const set = e => {
      const r = c.getBoundingClientRect(), cx = r.width / 2, R = r.width / 2 - 3;
      const dx = e.clientX - r.left - cx, dy = -(e.clientY - r.top - cx);
      let h = Math.atan2(dy, dx) * 180 / Math.PI; if (h < 0) h += 360;
      const sat = Math.min(100, Math.hypot(dx, dy) / R * 100 * (e.shiftKey ? .35 : 1));
      beginLive(); live.grade[k].h = Math.round(h * 10) / 10; live.grade[k].s = Math.round(sat * 10) / 10; requestRender(); drawWheels();
    };
    c.addEventListener('pointerdown', e => { if (!photo()) return; dragging = true; capture(c, e); set(e); });
    c.addEventListener('pointermove', e => { if (dragging) set(e); });
    const up = () => { if (!dragging) return; dragging = false; commit('Color grading ' + { sh: 'shadows', mid: 'midtones', hi: 'highlights' }[k]); };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('dblclick', () => setSettings(s => { s.grade[k].s = 0; }, 'Reset grading ' + k));
  }

  /* ---------- presets ---------- */
  function renderPresets() {
    const box = $('#presetlist'); if (!box) return;
    const groups = {}; Model.BUILTIN.forEach(p => (groups[p.group] = groups[p.group] || []).push(p));
    groups['User presets'] = Cat.userPresets;
    box.innerHTML = Object.entries(groups).map(([g, list]) => `<div class="grp">▾ ${esc(g)}</div>` + (list.length ? list.map(p => `<div class="aero-item" data-pr="${esc(p.id)}"><svg class="ic" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="2" fill="${p.builtin ? 'url(#gBlue)' : 'url(#gGold)'}" stroke="#24476e" stroke-width=".8"/><path d="M4 11l3-3 2 2 3-4" stroke="#fff" fill="none" stroke-width="1.3"/></svg><span class="grow">${esc(p.name)}</span>${p.builtin ? '' : '<button class="x" title="Delete preset">✕</button>'}</div>`).join('') : '<div class="dim" style="padding:2px 10px 6px">Save your own with “+ New”.</div>')).join('');
  }
  const findPreset = id => Model.BUILTIN.find(p => p.id === id) || Cat.userPresets.find(p => p.id === id);
  function wirePresets() {
    const box = $('#presetlist');
    box.addEventListener('mouseover', e => {
      const it = e.target.closest('[data-pr]'); const p = photo(); if (!it || !p || live) return;
      const pr = findPreset(it.dataset.pr); if (!pr) return;
      preview = Model.presetApply(p.settings, pr); requestRender();
    });
    box.addEventListener('mouseleave', () => { if (preview) { preview = null; requestRender(); } });
    box.addEventListener('mouseout', e => { if (!e.relatedTarget?.closest?.('[data-pr]') && preview) { preview = null; requestRender(); } });
    box.addEventListener('click', async e => {
      const it = e.target.closest('[data-pr]'); if (!it) return; const pr = findPreset(it.dataset.pr); if (!pr) return;
      if (e.target.closest('.x')) { if (await Aero.confirm('Delete Preset', `Delete the preset “${pr.name}”?`, 'Delete')) Cat.deletePreset(pr.id); return; }
      applyPreset(pr);
    });
  }
  function applyPreset(pr, ids) {
    preview = null;
    ids = ids || [S.active];
    if (ids.length > 1) Cat.applyToMany(ids, p => Model.presetApply(p.settings, pr), 'Preset: ' + pr.name);
    else { const p = photo(); if (p) Cat.setSettings(p, Model.presetApply(p.settings, pr), 'Preset: ' + pr.name); }
  }
  function groupChecks(defaults) {
    return Object.entries(Model.GROUPS).map(([k, g]) => ({ key: k, label: g.label, type: 'checkbox', value: defaults.includes(k) }));
  }
  function newPreset() {
    const p = photo(); if (!p) return Aero.toast('Select a photo first');
    const def = ['tone', 'presence', 'treatment', 'curve', 'hsl', 'grade', 'effects'];
    Aero.dialog({ title: 'New Develop Preset', instruction: 'Save the current settings as a preset. Choose which settings it includes.',
      fields: [{ key: 'name', label: 'Preset name', type: 'text', value: 'My preset' }, ...groupChecks(def)],
      onOK: async v => { const groups = Object.keys(Model.GROUPS).filter(k => v[k]); if (!groups.length) return Aero.toast('Pick at least one setting group'); const pr = await Cat.savePreset((v.name || 'Preset').trim().slice(0, 80), groups, p.settings); Aero.toast(`Saved preset “${pr.name}”`); } });
  }

  /* ---------- history ---------- */
  function renderHistory() {
    const p = photo(), box = $('#histlist'); if (!box || !isDev()) return;
    if (!p) { box.innerHTML = ''; return; }
    $('#histinfo').textContent = `${p.history.length} state${p.history.length === 1 ? '' : 's'}`;
    box.innerHTML = '';
    p.history.forEach((h, i) => {
      const d = el('div', 'aero-item' + (i === p.hi ? ' sel' : ''), `<span class="grow"></span>`);
      d.querySelector('.grow').textContent = h.label; if (i > p.hi) d.style.color = '#9aa5b1';
      d.onclick = () => { live = null; Cat.historyGo(p, i); };
      box.appendChild(d);
    });
    box.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
  }
  function undo() { const p = photo(); if (cropMode) { closeCrop(false); return true; } if (!p || p.hi <= 0) return false; live = null; Cat.historyGo(p, p.hi - 1); Aero.toast('Undo ' + p.history[p.hi + 1].label); return true; }
  function redo() { const p = photo(); if (!p || p.hi >= p.history.length - 1) return false; live = null; Cat.historyGo(p, p.hi + 1); Aero.toast('Redo ' + p.history[p.hi].label); return true; }

  /* ---------- copy / paste / sync ---------- */
  function copySettings() {
    const p = photo(); if (!p) return;
    Aero.dialog({ title: 'Copy Settings', instruction: 'Choose the settings to copy:', fields: groupChecks(Object.keys(Model.GROUPS).filter(g => g !== 'crop')),
      onOK: v => { const groups = Object.keys(Model.GROUPS).filter(k => v[k]); clipboard = { groups, part: Model.pick(p.settings, groups) }; Aero.toast(`Copied ${groups.length} setting group${groups.length === 1 ? '' : 's'} from ${Cat.displayName(p)}`); } });
  }
  function pasteSettings() {
    if (!clipboard) return Aero.toast('Copy settings first (Ctrl+Shift+C)');
    const ids = selectedIds(); if (!ids.length) return;
    Cat.applyToMany(ids, p => Model.applyPartial(p.settings, clipboard.part), 'Paste settings');
    Aero.toast(`Pasted settings to ${ids.length} photo${ids.length > 1 ? 's' : ''}`);
  }
  function syncSettings() {
    const src = photo(); const ids = selectedIds().filter(id => id !== S.active);
    if (!src || !ids.length) return Aero.toast('Select several photos (Ctrl-click in the filmstrip or grid); the active photo is the source');
    Aero.dialog({ title: 'Synchronize Settings', instruction: `Copy settings from “${Cat.displayName(src)}” to ${ids.length} other selected photo${ids.length > 1 ? 's' : ''}:`, fields: groupChecks(Object.keys(Model.GROUPS).filter(g => g !== 'crop')),
      ok: 'Synchronize', onOK: v => { const groups = Object.keys(Model.GROUPS).filter(k => v[k]); const part = Model.pick(src.settings, groups); Cat.applyToMany(ids, p => Model.applyPartial(p.settings, part), 'Sync settings'); Aero.toast(`Synchronized ${ids.length} photo${ids.length > 1 ? 's' : ''}`); } });
  }
  function resetAll() {
    const ids = isDev() ? [S.active].filter(Boolean) : selectedIds(); if (!ids.length) return;
    if (ids.length === 1) { const p = Cat.photos.get(ids[0]); live = null; Cat.setSettings(p, Model.defaults(), 'Reset all'); }
    else Cat.applyToMany(ids, () => Model.defaults(), 'Reset all');
  }
  function toggleBW() { const ids = isDev() ? [S.active] : selectedIds(); const p = photo(); if (!p) return; const bw = !p.settings.bw; if (ids.length > 1) Cat.applyToMany(ids, q => ({ ...Model.clone(q.settings), bw }), bw ? 'Black & white' : 'Color'); else setSettings(s => { s.bw = bw; }, bw ? 'Black & white' : 'Color'); }

  /* ---------- auto tone / auto WB ---------- */
  async function autoWB() {
    const p = photo(); if (!p) return; const img = await Cat.smallImage(p);
    const c = Decode.mkCanvas(64, Math.max(1, Math.round(64 * img.height / img.width))); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const lin = v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); };
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { const R = lin(d[i]), G = lin(d[i + 1]), B = lin(d[i + 2]); const m = Math.max(R, G, B); if (m > .98 || m < .02) continue; r += R; g += G; b += B; n++; }
    if (!n) return; const wb = Engine.solveWB([r / n, g / n, b / n]);
    setSettings(s => { s.wb = { temp: Math.round(wb.temp * .8), tint: Math.round(wb.tint * .8) }; }, 'Auto white balance');
  }
  async function autoTone() {
    const p = photo(); if (!p) return Aero.toast('Select a photo first');
    const base = Model.clone(p.settings); ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks'].forEach(k => base[k] = 0);
    const c = await Cat.renderPreviewCanvas(p, base, 256);
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, hist = new Uint32Array(256); let n = 0;
    for (let i = 0; i < d.length; i += 4) { hist[Math.round(.2126 * d[i] + .7152 * d[i + 1] + .0722 * d[i + 2])]++; n++; }
    const pct = q => { let acc = 0; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= q * n) return i / 255; } return 1; };
    const lin = v => v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4);
    const med = Math.max(.02, pct(.5));
    let exposure = Math.max(-.5, Math.min(2, Math.log2(lin(.46) / lin(med)) * .6));
    if (exposure < 0 && pct(.995) < .97) exposure = 0;   // bright but not clipping: let whites/blacks do the work
    const k = Math.pow(2, exposure), enc = v => v <= .0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - .055, shift = v => Math.min(1.2, enc(lin(v) * k));
    const p005 = shift(pct(.005)), p995 = shift(pct(.995)), p05 = shift(pct(.05)), p95 = shift(pct(.95));
    setSettings(s => {
      s.exposure = Math.round(exposure * 100) / 100;
      s.whites = Math.round(Math.max(-60, Math.min(100, 100 * (1 - p995 / .97) / .18)));
      s.blacks = Math.round(Math.max(-100, Math.min(60, -100 * (p005 - .025) / (1 - .025) / .18)));
      s.highlights = Math.round(-Math.max(0, Math.min(60, (p95 - .85) * 300)));
      s.shadows = Math.round(Math.max(0, Math.min(50, (.15 - p05) * 250)));
      s.contrast = Math.round(Math.max(-10, Math.min(35, (.75 - (p95 - p05)) * 45)));
      s.vibrance = Math.max(s.vibrance, 10);
    }, 'Auto tone');
  }

  /* ---------- before/after ---------- */
  function setBA(m) { if (!isDev()) setModule('develop'); if (cropMode) closeCrop(true); ba = m; $('#d-ba').value = m; requestRender(); }

  /* ---------- module lifecycle ---------- */
  function enter() { renderPresets(); photoChanged(); setTimeout(() => { drawCurve(); drawWheels(); requestRender(); }, 0); }
  function leave() { if (cropMode) closeCrop(true); if (wbPick) setWBPick(false); preview = null; }

  function init() {
    buildPanels(); wireViewer(); wirePresets(); renderPresets();
    $('#d-crop').onclick = toggleCrop; $('#d-wb').onclick = toggleWBPick;
    $('#d-ba').onchange = e => setBA(e.target.value);
    $('#d-fit').onclick = () => setZoom('fit'); $('#d-100').onclick = () => setZoom(1);
    $('#d-copy').onclick = copySettings; $('#d-paste').onclick = pasteSettings; $('#d-sync').onclick = syncSettings; $('#d-reset').onclick = resetAll;
    $('#p-new').onclick = newPreset;
    document.addEventListener('keydown', e => {
      if (document.querySelector('.aero-modal')) return;
      if (e.key === 'Escape') { if (wbPick) setWBPick(false); else if (cropMode) closeCrop(false); }
      if (e.key === 'Enter' && cropMode && !e.target.matches?.('input,select,textarea')) { e.preventDefault(); closeCrop(true); }
      if (cropMode && (e.key === 'x' || e.key === 'X') && !e.target.matches?.('input,select,textarea')) { e.stopImmediatePropagation(); e.preventDefault(); swapAspect(); }
    }, true);
  }
  function showHist(H) { if (H) lastHistData = H; drawHistogram($('#dhist'), H); if (!curveDrag) drawCurveLater(); }
  let dct = null; function drawCurveLater() { clearTimeout(dct); dct = setTimeout(drawCurve, 60); }

  async function exportSettingsRemember(v) { lastExport = v; }
  return {
    init, enter, leave, photoChanged, settingsChanged, thumbChanged, requestRender, renderHistory, renderPresets, syncPanels,
    setZoom, zoomStep, toggleCrop, toggleWBPick, toggleBW, autoTone, autoWB, copySettings, pasteSettings, syncSettings, resetAll, newPreset, applyPreset,
    setBA, undo, redo, rotatedSettings, rotate, flip, setAspect, setCropAngle,
    get ba() { return ba; }, get showInfo() { return showInfo; }, set showInfo(v) { showInfo = v; },
    get cropMode() { return cropMode; }, get lastView() { return lastView; }, get clipboard() { return clipboard; },
    get lastExport() { return lastExport; }, set lastExport(v) { lastExport = v; }, exportSettingsRemember,
    _cropDraft: () => cropDraft, _setCropDraft: c => { cropDraft = c; requestRender(); }
  };
})();
