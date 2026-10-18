// Lumen Map — print layout: title, map frame, legend, scale bar, north arrow and credits on a paper page,
// exported as vector PDF (via SVG → svg2pdf/jsPDF), SVG or PNG at a chosen resolution.
(function () {
  'use strict';
  const A = MapApp, R = MapRender, P = MapProj, G = MapGeo, C = MapClass;
  const esc = s => Aero.esc(String(s ?? ''));
  const PAPER = { A4: [595.28, 841.89], A3: [841.89, 1190.55], A2: [1190.55, 1683.78], Letter: [612, 792], Legal: [612, 1008], Tabloid: [792, 1224] };
  const FONT = '"Segoe UI", Arial, sans-serif';
  const defaults = () => ({ paper: 'A4', orient: 'landscape', title: A.doc.title || 'Map', subtitle: '', legend: true, scalebar: true, north: true, grid: true, scaleMode: 'fit', scale: Math.round(A.getScale() / 1000) * 1000 || 50000, credits: '', dpi: 200, border: true });
  const L = window.MapLayout = {};
  L.settings = () => ({ ...defaults(), ...(A.doc.layout || {}) });
  L.pageSize = s => { const p = PAPER[s.paper] || PAPER.A4; return s.orient === 'landscape' ? [p[1], p[0]] : [p[0], p[1]]; };

  // draw the whole page in page points (1/72 in) onto any Canvas2D-like context
  L.draw = (ctx, s, opts = {}) => {
    const [W, H] = L.pageSize(s), m = 28;
    ctx.save(); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    let top = m;
    ctx.fillStyle = '#16263a'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    if (s.title) { ctx.font = `bold 20px ${FONT}`; ctx.fillText(s.title, m, top + 18); top += 26; }
    if (s.subtitle) { ctx.font = `11px ${FONT}`; ctx.fillStyle = '#44556a'; ctx.fillText(s.subtitle, m, top + 10); top += 16; }
    top += 6;
    const legW = s.legend ? Math.min(170, W * 0.26) : 0, foot = 18;
    const fx = m, fy = top, fw = W - 2 * m - (legW ? legW + 12 : 0), fh = H - top - m - foot;
    // map frame
    const mPerUnit = A.metersPerPixel() / A.view.res;
    let res = s.scaleMode === 'fixed' && s.scale > 0 ? (s.scale * 0.0254 / 72) / mPerUnit : Math.max(A.size().w * A.view.res / fw, A.size().h * A.view.res / fh);
    if (!isFinite(res) || res <= 0) res = A.view.res;
    ctx.save(); ctx.translate(fx, fy); ctx.beginPath(); ctx.rect(0, 0, fw, fh); ctx.clip();
    R.drawMap(ctx, { doc: A.doc, crs: A.crs(), view: { cx: A.view.cx, cy: A.view.cy, res, w: fw, h: fh }, selection: opts.selection ? A.sel : null, graticule: { on: s.grid, labels: s.grid, fontSize: 7.5, width: 0.5 }, symbolScale: 0.75 });
    // north arrow (follows grid convergence at the frame centre)
    if (s.north) {
      const c = A.toLonLat([A.view.cx, A.view.cy]), p0 = A.fromLonLat(c), p1 = A.fromLonLat([c[0], Math.min(89.9, c[1] + 0.05)]), ang = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
      ctx.save(); ctx.translate(fw - 26, 30); ctx.rotate(isFinite(ang) ? ang : 0);
      ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.beginPath(); ctx.arc(0, 0, 19, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(8, 10); ctx.lineTo(0, 5); ctx.closePath(); ctx.fillStyle = '#1e395b'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(-8, 10); ctx.lineTo(0, 5); ctx.closePath(); ctx.fillStyle = '#8fa8c6'; ctx.fill();
      ctx.font = `bold 8px ${FONT}`; ctx.fillStyle = '#1e395b'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('N', 0, -24);
      ctx.restore();
    }
    // scale bar
    if (s.scalebar) {
      const mpp = A.metersPerPixel() / A.view.res * res, target = mpp * fw * 0.28, pow = Math.pow(10, Math.floor(Math.log10(target))), nice = [1, 2, 2.5, 5, 10].map(x => x * pow).filter(x => x <= target).pop() || pow;
      const len = nice / mpp, x0 = 12, y0 = fh - (s.grid ? 34 : 22), parts = 4;
      ctx.fillStyle = 'rgba(255,255,255,.82)'; ctx.fillRect(x0 - 6, y0 - 14, len + 40, 30);
      for (let i = 0; i < parts; i++) { ctx.fillStyle = i % 2 ? '#ffffff' : '#1e395b'; ctx.fillRect(x0 + len * i / parts, y0, len / parts, 4); }
      ctx.strokeStyle = '#1e395b'; ctx.lineWidth = 0.6; ctx.strokeRect(x0, y0, len, 4);
      ctx.fillStyle = '#16263a'; ctx.font = `7.5px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      const unit = nice >= 1000 ? 'km' : 'm', k = nice >= 1000 ? 1000 : 1;
      [0, parts / 2, parts].forEach(i => ctx.fillText(String(+(nice * i / parts / k).toPrecision(4)) + (i === parts ? ' ' + unit : ''), x0 + len * i / parts, y0 - 3));
    }
    ctx.restore();
    if (s.border !== false) { ctx.strokeStyle = '#33465c'; ctx.lineWidth = 0.8; ctx.strokeRect(fx, fy, fw, fh); }
    // legend
    if (legW) drawLegend(ctx, W - m - legW, fy, legW, fh);
    // footer
    ctx.fillStyle = '#55657a'; ctx.font = `7.5px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const scaleN = Math.round(A.metersPerPixel() / A.view.res * res / (0.0254 / 72));
    ctx.fillText(`Scale 1:${scaleN.toLocaleString('en-US')} (at centre) · ${P.label(A.crs())}${s.credits ? ' · ' + s.credits : ''}`, m, H - m + 4);
    ctx.textAlign = 'right'; ctx.fillText(`Lumen Map · ${new Date().toISOString().slice(0, 10)}`, W - m, H - m + 4);
    ctx.restore();
    return { W, H, scale: scaleN };
  };
  function drawLegend(ctx, x, y, w, h) {
    ctx.save();
    ctx.fillStyle = '#16263a'; ctx.font = `bold 11px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillText('Legend', x, y + 11);
    let cy = y + 24; const rowH = 13, maxY = y + h - 8;
    const sym = (Lr, sx, sy, fill, stroke, size) => {
      const st = Lr.style;
      if (Lr.geomType === 'LineString') { ctx.beginPath(); ctx.moveTo(sx, sy + 5); ctx.lineTo(sx + 7, sy + 1); ctx.lineTo(sx + 14, sy + 6); ctx.lineTo(sx + 20, sy + 2); ctx.strokeStyle = fill; ctx.lineWidth = Math.max(0.8, Math.min(3, (st.width || 1.5) * 0.75)); ctx.lineCap = 'round'; ctx.stroke(); return; }
      if (Lr.geomType === 'Point') { R.marker(ctx, sx + 10, sy + 4, st.shape, Math.min(10, Math.max(4, (size || st.size || 7) * 0.75))); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = stroke; ctx.lineWidth = 0.6; ctx.stroke(); return; }
      const [r, g, b] = C.hex(fill); ctx.fillStyle = `rgba(${r},${g},${b},${st.fillOpacity ?? 0.6})`; ctx.fillRect(sx, sy, 20, 9); ctx.strokeStyle = stroke; ctx.lineWidth = Math.min(1.5, Math.max(0.4, (st.width ?? 1) * 0.6)); ctx.strokeRect(sx, sy, 20, 9);
    };
    for (const Lr of A.doc.layers) {
      if (!Lr.visible || cy > maxY) continue;
      const st = Lr.style || {};
      ctx.font = `9px ${FONT}`; ctx.fillStyle = '#16263a';
      if (st.mode === 'single' || !st.mode) { sym(Lr, x, cy - 7, st.fill, st.stroke); ctx.fillStyle = '#16263a'; ctx.font = `9px ${FONT}`; ctx.fillText(clip(ctx, Lr.name, w - 26), x + 26, cy); cy += rowH + 3; continue; }
      ctx.font = `bold 9px ${FONT}`; ctx.fillText(clip(ctx, Lr.name, w), x, cy); cy += rowH; ctx.font = `8.5px ${FONT}`;
      const items = st.mode === 'categorized' ? (st.categories || []).filter(c => c.visible !== false).map(c => ({ label: c.label || c.value, color: c.color })) : (st.classes || []).filter(c => c.visible !== false).map((c, i, a) => ({ label: c.label, color: st.gradBy === 'size' ? st.fill : c.color, size: st.gradBy === 'size' ? (st.sizeMin ?? 4) + (a.length > 1 ? i / (a.length - 1) : 1) * ((st.sizeMax ?? 22) - (st.sizeMin ?? 4)) : null }));
      for (const it of items) { if (cy > maxY) break; sym(Lr, x + 4, cy - 7, it.color, Lr.geomType === 'LineString' ? it.color : st.stroke, it.size); ctx.fillStyle = '#26364a'; ctx.fillText(clip(ctx, String(it.label), w - 30), x + 30, cy); cy += rowH; }
      cy += 4;
    }
    ctx.restore();
  }
  function clip(ctx, t, w) { t = String(t); if (ctx.measureText(t).width <= w) return t; while (t.length > 1 && ctx.measureText(t + '…').width > w) t = t.slice(0, -1); return t + '…'; }

  // ---------- exports ----------
  L.toSVG = s => { const [W, H] = L.pageSize(s), ctx = new R.SvgCtx(W, H); L.draw(ctx, s); return ctx.toString(); };
  L.toPNG = async s => {
    const [W, H] = L.pageSize(s), k = (s.dpi || 200) / 72, c = document.createElement('canvas');
    c.width = Math.round(W * k); c.height = Math.round(H * k); if (c.width * c.height > 1.4e8) throw new Error('That resolution is too large for this paper size');
    const ctx = c.getContext('2d'); ctx.scale(k, k); L.draw(ctx, s);
    return await new Promise(r => c.toBlob(r, 'image/png'));
  };
  L.toPDF = async s => {
    const [W, H] = L.pageSize(s), svg = L.toSVG(s).replace(/font-family="[^"]*"/g, 'font-family="helvetica"');
    const { jsPDF } = window.jspdf, pdf = new jsPDF({ unit: 'pt', format: [W, H], orientation: W > H ? 'l' : 'p', compress: true });
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:-99999px;top:0;width:10px;height:10px;overflow:hidden'; document.body.appendChild(host);
    try {
      const el = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement; host.appendChild(document.importNode(el, true));
      await pdf.svg(host.firstChild, { x: 0, y: 0, width: W, height: H });
      pdf.setProperties({ title: s.title || 'Map', creator: 'Lumen Map' });
      return pdf.output('arraybuffer');
    } finally { host.remove(); }
  };

  // ---------- UI ----------
  L.open = () => {
    if (!A.doc.layers.length) { Aero.toast('Add some data to the map first'); return; }
    let s = L.settings();
    const ov = document.createElement('div'); ov.className = 'pl-modal';
    const o = (v, t, cur) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${t}</option>`;
    ov.innerHTML = `<div class="pl-win"><div class="pl-head">🖶 Print layout <span style="opacity:.8;font-size:11px">— the map frame shows the current map view</span></div>
      <div class="pl-body"><div class="pl-prev" id="plPrev"><canvas id="plCv"></canvas></div>
      <div class="pl-side">
        <h4>Page</h4><div class="dlg-grid"><label>Paper</label><select id="plPaper">${Object.keys(PAPER).map(k => o(k, k, s.paper)).join('')}</select>
        <label>Orientation</label><select id="plOrient">${o('landscape', 'Landscape', s.orient)}${o('portrait', 'Portrait', s.orient)}</select></div>
        <h4>Text</h4><div class="dlg-grid"><label>Title</label><input type="text" id="plTitle" value="${esc(s.title)}"><label>Subtitle</label><input type="text" id="plSub" value="${esc(s.subtitle)}"><label>Credits</label><input type="text" id="plCred" value="${esc(s.credits)}" placeholder="Data sources, author…"></div>
        <h4>Map</h4><div class="dlg-grid"><label>Scale</label><select id="plMode">${o('fit', 'Fit the current view', s.scaleMode)}${o('fixed', 'Fixed scale', s.scaleMode)}</select><label>1 :</label><input type="number" id="plScale" min="1" value="${s.scale}" ${s.scaleMode === 'fixed' ? '' : 'disabled'}></div>
        <h4>Elements</h4><div class="dlg-grid"><label>Legend</label><input type="checkbox" id="plLeg" ${s.legend ? 'checked' : ''} style="justify-self:start"><label>Scale bar</label><input type="checkbox" id="plBar" ${s.scalebar ? 'checked' : ''} style="justify-self:start"><label>North arrow</label><input type="checkbox" id="plNorth" ${s.north ? 'checked' : ''} style="justify-self:start"><label>Graticule</label><input type="checkbox" id="plGrid" ${s.grid ? 'checked' : ''} style="justify-self:start"><label>Frame border</label><input type="checkbox" id="plBorder" ${s.border !== false ? 'checked' : ''} style="justify-self:start"></div>
        <h4>PNG export</h4><div class="dlg-grid"><label>Resolution</label><select id="plDpi">${[96, 150, 200, 300].map(d => o(d, d + ' dpi', s.dpi)).join('')}</select></div>
        <div class="dnote" id="plInfo"></div>
      </div></div>
      <div class="pl-foot"><button class="aero-btn" id="plSvg">Export SVG…</button><button class="aero-btn" id="plPng">Export PNG…</button><button class="aero-btn pri" id="plPdf">Export PDF…</button><button class="aero-btn" id="plClose">Close</button></div></div>`;
    document.body.appendChild(ov);
    const g = id => ov.querySelector('#' + id);
    const read = () => { s = { ...s, paper: g('plPaper').value, orient: g('plOrient').value, title: g('plTitle').value, subtitle: g('plSub').value, credits: g('plCred').value, scaleMode: g('plMode').value, scale: +g('plScale').value || s.scale, legend: g('plLeg').checked, scalebar: g('plBar').checked, north: g('plNorth').checked, grid: g('plGrid').checked, border: g('plBorder').checked, dpi: +g('plDpi').value }; g('plScale').disabled = s.scaleMode !== 'fixed'; };
    const draw = () => {
      const box = g('plPrev').getBoundingClientRect(), [W, H] = L.pageSize(s), k = Math.min((box.width - 40) / W, (box.height - 40) / H), cv = g('plCv'), dpr = devicePixelRatio || 1;
      cv.style.width = Math.round(W * k) + 'px'; cv.style.height = Math.round(H * k) + 'px'; cv.width = Math.round(W * k * dpr); cv.height = Math.round(H * k * dpr);
      const ctx = cv.getContext('2d'); ctx.scale(k * dpr, k * dpr); const r = L.draw(ctx, s);
      g('plInfo').textContent = `${s.paper} ${s.orient}, ${Math.round(W / 72 * 25.4)} × ${Math.round(H / 72 * 25.4)} mm · map scale 1:${r.scale.toLocaleString('en-US')}`;
    };
    let t; ov.addEventListener('input', () => { read(); clearTimeout(t); t = setTimeout(draw, 60); }); ov.addEventListener('change', () => { read(); draw(); });
    ov.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') close(); });
    const close = () => { read(); if (JSON.stringify(s) !== JSON.stringify(A.doc.layout)) { A.doc.layout = s; Aero.setDirty(true); } ov.remove(); };
    g('plClose').onclick = close;
    const base = () => (A.docName || 'map').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_');
    const exp = async (kind) => {
      read(); Aero.busy('Exporting ' + kind.toUpperCase() + '…');
      try {
        if (kind === 'pdf') await Aero.saveFile({ name: base() + '.pdf', data: await L.toPDF(s), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
        if (kind === 'png') await Aero.saveFile({ name: base() + '.png', data: await L.toPNG(s), filters: [{ name: 'PNG image', extensions: ['png'] }] });
        if (kind === 'svg') await Aero.saveFile({ name: base() + '.svg', data: L.toSVG(s), filters: [{ name: 'SVG', extensions: ['svg'] }] });
      } catch (e) { console.error(e); Aero.alert('Export failed', e.message); } finally { Aero.busy(); }
    };
    g('plPdf').onclick = () => exp('pdf'); g('plPng').onclick = () => exp('png'); g('plSvg').onclick = () => exp('svg');
    requestAnimationFrame(draw);
    L.current = { ov, draw, get settings() { return s; } };
  };
})();
