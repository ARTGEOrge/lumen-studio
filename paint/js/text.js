'use strict';
/* Text layers: a pixel layer whose tiles hold the rendered text, plus editable props in L.text
   (font, size, colour, alignment, style, position). Edits re-render the tiles; Rasterize drops the
   props so the layer becomes ordinary paint. Props are replaced (never mutated) so undo snapshots stay valid. */
const TEXT_FONTS = ['Segoe UI', 'Arial', 'Calibri', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Cambria', 'Palatino Linotype', 'Garamond', 'Courier New', 'Consolas', 'Comic Sans MS', 'Impact', 'Segoe Script', 'Segoe Print', 'Ink Free', 'Gabriola', 'serif', 'sans-serif', 'monospace', 'cursive'];
const TEXT_DEF = { text: '', font: 'Georgia', size: 96, color: [0.1, 0.12, 0.18], align: 'left', bold: false, italic: false, x: 0, y: 0, lineHeight: 1.2 };
topts.text = { font: 'Georgia', size: 96, align: 'left', bold: false, italic: false, lineHeight: 1.2 };

// untrusted props (from a file) → safe props
function sanitizeTextProps(o) {
  const num = (v, a, b, d) => Number.isFinite(+v) ? clamp(+v, a, b) : d;
  const font = String(o.font || TEXT_DEF.font).replace(/[^\w \-]/g, '').trim().slice(0, 60) || TEXT_DEF.font;
  return {
    text: String(o.text ?? '').slice(0, 20000), font, size: num(o.size, 2, 4000, 96),
    color: Array.isArray(o.color) ? [0, 1, 2].map(i => num(o.color[i], 0, 1, 0)) : TEXT_DEF.color.slice(),
    align: ['left', 'center', 'right'].includes(o.align) ? o.align : 'left', bold: !!o.bold, italic: !!o.italic,
    x: num(o.x, -1e5, 1e5, 0), y: num(o.y, -1e5, 1e5, 0), lineHeight: num(o.lineHeight, 0.5, 4, 1.2)
  };
}
const textFontCSS = t => `${t.italic ? 'italic ' : ''}${t.bold ? 'bold ' : ''}${Math.round(t.size * 100) / 100}px "${t.font}", sans-serif`;
let textMeasureCtx = null;
// layout: lines, box {x,y,w,h} in doc px (box.y = top of first line)
function textLayout(t) {
  if (!textMeasureCtx) textMeasureCtx = new OffscreenCanvas(4, 4).getContext('2d');
  const c = textMeasureCtx; c.font = textFontCSS(t);
  const lines = t.text.split('\n'), lh = t.size * t.lineHeight;
  const widths = lines.map(l => c.measureText(l).width), w = Math.max(t.size * 0.3, ...widths);
  const x0 = t.align === 'center' ? t.x - w / 2 : t.align === 'right' ? t.x - w : t.x;
  return { lines, widths, lh, box: { x: x0, y: t.y, w, h: Math.max(lh, lines.length * lh) } };
}
// render props into the layer's tiles (replaces all pixels)
function renderTextLayer(L) {
  const t = L.text; if (!t) return;
  const lay = textLayout(t), pad = Math.ceil(t.size * 0.6) + 2, b = lay.box;
  const x0 = Math.floor(b.x) - pad, y0 = Math.floor(b.y) - pad, w = Math.ceil(b.w) + pad * 2, h = Math.ceil(b.h) + pad * 2;
  for (let i = 0; i < L.tiles.length; i++) if (L.tiles[i]) { L.tiles[i] = null; L.owned.delete(i); L.dirty.add(i); }
  const cx0 = Math.max(0, x0), cy0 = Math.max(0, y0), cx1 = Math.min(doc.w, x0 + w), cy1 = Math.min(doc.h, y0 + h);
  if (cx1 > cx0 && cy1 > cy0 && t.text.trim()) {
    const cw = cx1 - cx0, ch = cy1 - cy0, cv = new OffscreenCanvas(cw, ch), c = cv.getContext('2d', { willReadFrequently: true });
    c.font = textFontCSS(t); c.textBaseline = 'alphabetic'; c.fillStyle = rgbHex(t.color);
    const m = c.measureText('Hg'), asc = m.fontBoundingBoxAscent ?? t.size * 0.8, desc = m.fontBoundingBoxDescent ?? t.size * 0.2;
    const lead = (lay.lh - (asc + desc)) / 2;
    lay.lines.forEach((ln, i) => {
      const lx = t.align === 'center' ? t.x - lay.widths[i] / 2 : t.align === 'right' ? t.x - lay.widths[i] : t.x;
      c.fillText(ln, lx - cx0, t.y + i * lay.lh + lead + asc - cy0);
    });
    writeRegion(L, cx0, cy0, cw, ch, c.getImageData(0, 0, cw, ch).data, true);
  }
  markDirty(L); layerThumbDirty(L);
}
function textHit(pt) { // top-most visible text layer whose box contains the doc point
  const all = allLayers().filter(L => L.text && isEffectivelyVisible(L)).reverse();
  for (const L of all) { const b = textLayout(L.text).box, m = 6 / view.zoom; if (pt.x >= b.x - m && pt.x <= b.x + b.w + m && pt.y >= b.y - m && pt.y <= b.y + b.h + m) return L; }
  return null;
}
function askRasterizeText(L) {
  Aero.confirm('Rasterize text layer?', `“${L.name}” is a text layer. To paint, transform or adjust it, it must become ordinary pixels and the text will no longer be editable.`, 'Rasterize').then(ok => { if (ok) cmdRasterizeText(L); });
}
function cmdRasterizeText(L = doc.active) { if (!L || !L.text) { Aero.toast('The current layer is not a text layer'); return; } textEndEdit(); L.text = null; doc.ver++; histPush('Rasterize Text'); renderLayers(); }

/* ---------- editing session ---------- */
let textEdit = null; // {L, isNew, before}
function textBeginEdit(L, isNew) {
  textEndEdit();
  doc.active = L; doc.editMask = false;
  textEdit = { L, isNew, before: L.text };
  const p = $('#textpanel'); p.hidden = false;
  const ta = $('#text-ta'); ta.value = L.text.text; ta.style.fontFamily = `"${L.text.font}", sans-serif`;
  Object.assign(topts.text, { font: L.text.font, size: L.text.size, align: L.text.align, bold: L.text.bold, italic: L.text.italic, lineHeight: L.text.lineHeight });
  setFG(L.text.color.slice());
  if (activeToolId !== 'text') setTool('text'); else renderCmd();
  renderLayers(); requestOverlay();
  setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }, 0);
}
function textUpdate(patch) {
  if (!textEdit) return; const L = textEdit.L;
  L.text = { ...L.text, ...patch }; renderTextLayer(L); requestOverlay();
}
function textEndEdit(cancel) {
  const e = textEdit; if (!e) return; textEdit = null;
  $('#textpanel').hidden = true; $('#text-ta').blur();
  const L = e.L;
  if (cancel) { if (e.isNew) { removeLayer(L); doc.active = allLayers().pop() || null; doc.ver++; restoreSnapshot(hist.items[hist.index].state); } else { L.text = e.before; renderTextLayer(L); } renderLayers(); requestOverlay(); return; }
  if (!L.text.text.trim()) { // empty text: drop the layer
    if (e.isNew) { restoreSnapshot(hist.items[hist.index].state); renderLayers(); }
    else { removeLayer(L); doc.active = allLayers().pop() || null; doc.ver++; histPush('Delete Text Layer'); }
    requestOverlay(); return;
  }
  if (e.isNew || JSON.stringify(e.before) !== JSON.stringify(L.text)) { if (e.isNew) L.name = textLayerName(L.text.text); histPush(e.isNew ? 'New Text' : 'Edit Text'); }
  renderLayers(); requestOverlay();
}
const textLayerName = s => 'T: ' + (s.trim().split('\n')[0].slice(0, 28) || 'Text');
function newTextLayer(x, y, text = '') {
  if (floating) commitTransform(); dryAllWet();
  const t = sanitizeTextProps({ ...TEXT_DEF, ...topts.text, color: FG.slice(), x, y, text });
  const L = new Layer('pixel', textLayerName(text), doc.w, doc.h); L.text = t;
  const A = doc.active; insertLayer(L, A && !A.isMask ? A : null);
  renderTextLayer(L); doc.ver++;
  return L;
}
function editTextLayer(L) { if (!L || !L.text) return; textBeginEdit(L, false); }
function initTextPanel() {
  const p = el('div', 'aero-pill textpanel', '<div class="tp-head"><span>Text</span><span class="dim">Ctrl+Enter or Done to finish · Esc cancels</span></div><textarea id="text-ta" rows="3" spellcheck="false" placeholder="Type your text…"></textarea><div class="tp-btns"><button class="aero-btn small" id="tp-cancel">Cancel</button><button class="aero-btn small pri" id="tp-done">Done</button></div>');
  p.id = 'textpanel'; p.hidden = true; $('#stage').appendChild(p);
  const ta = $('#text-ta', p);
  ta.addEventListener('input', () => textUpdate({ text: ta.value }));
  ta.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); textEndEdit(true); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); textEndEdit(); }
  });
  $('#tp-done', p).onclick = () => textEndEdit(); $('#tp-cancel', p).onclick = () => textEndEdit(true);
  colorListeners.push(() => { if (textEdit && rgbHex(textEdit.L.text.color) !== rgbHex(FG)) textUpdate({ color: FG.slice() }); });
}

const textTool = {
  down(pt) {
    if (!doc) return false;
    const hit = textHit(pt);
    if (textEdit && hit === textEdit.L) { this.drag = { L: hit, p0: [pt.x, pt.y], t0: hit.text, moved: false }; return; }
    textEndEdit();
    if (hit) { this.drag = { L: hit, p0: [pt.x, pt.y], t0: hit.text, moved: false, edit: true }; return; }
    const L = newTextLayer(pt.x, pt.y - topts.text.size * 0.6); textBeginEdit(L, true); return false;
  },
  move(pt) {
    const d = this.drag; if (!d) return;
    const dx = pt.x - d.p0[0], dy = pt.y - d.p0[1];
    if (!d.moved && Math.hypot(dx, dy) * view.zoom < 4) return;
    d.moved = true; d.L.text = { ...d.t0, x: d.t0.x + dx, y: d.t0.y + dy }; renderTextLayer(d.L); requestOverlay();
  },
  up() {
    const d = this.drag; this.drag = null; if (!d) return;
    if (d.moved) { if (!textEdit) histPush('Move Text'); renderLayers(); }
    else if (d.edit) textBeginEdit(d.L, false);
  },
  cancel() { this.drag = null; },
  deactivate() { textEndEdit(); },
  hover(dp) { $('#stage').style.cursor = textHit({ x: dp[0], y: dp[1] }) ? 'move' : 'text'; },
  overlay(c, px) {
    const show = textEdit ? [textEdit.L] : allLayers().filter(L => L.text && isEffectivelyVisible(L));
    for (const L of show) {
      const b = textLayout(L.text).box, m = 4 * px;
      c.lineWidth = px; c.setLineDash(textEdit ? [] : [4 * px, 3 * px]); c.strokeStyle = textEdit ? '#1f6fd0' : 'rgba(31,111,208,.6)';
      c.strokeRect(b.x - m, b.y - m, b.w + 2 * m, b.h + 2 * m); c.setLineDash([]);
    }
  },
  cursor() { },
  options(bar) {
    const o = topts.text, apply = patch => { Object.assign(o, patch); textUpdate(patch); };
    const fs = cmdSelect(bar, 'Font', TEXT_FONTS.map(f => [f, f]), () => o.font, v => { apply({ font: v }); $('#text-ta').style.fontFamily = `"${v}", sans-serif`; });
    [...fs.options].forEach(op => op.style.fontFamily = `"${op.value}"`);
    cmdSync.push(cmdSlider(bar, 'Size', 4, 1500, 1, () => o.size, v => apply({ size: v }), v => Math.round(v) + ' px', true));
    cmdSelect(bar, 'Align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], () => o.align, v => apply({ align: v }));
    cmdCheck(bar, 'Bold', () => o.bold, v => apply({ bold: v }));
    cmdCheck(bar, 'Italic', () => o.italic, v => apply({ italic: v }));
    cmdSlider(bar, 'Line', 0.6, 3, 0.05, () => o.lineHeight, v => apply({ lineHeight: v }), v => v.toFixed(2) + '×');
    cmdHint(bar, textEdit ? 'Color = foreground color · drag the box to move' : 'Click to add text · click a text box to edit · drag to move');
  }
};
TOOLS.text = textTool;
TOOL_DEFS.splice(TOOL_DEFS.findIndex(t => t && t.id === 'shape') + 1, 0, { id: 'text', title: 'Text', key: 'T', icon: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>' });
TOOL_NAMES.text = 'Text';
