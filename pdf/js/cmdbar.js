// Glossy command bar: options for the active tool, or properties of the selected annotation.
import { App, emit, on } from './state.js';
import { patchAnnot, deleteAnnot, editFreetext, fitFreetext, replaceAnnot } from './tools.js';
import { displayLabel, STAMPS, MARKUP } from './annots.js';
import { esc, prefs } from './util.js';

const bar = document.getElementById('cmd');
const STROKE = ['#000000', '#d42020', '#f08c00', '#1f9d3a', '#1f6fd0', '#1f4fbf', '#6a3fb5', '#ffffff'];
const HILITE = ['#ffd400', '#7ee36b', '#5ad1ff', '#ff8ad8', '#ff9b4a', '#c9a2ff'];
const NOTE = ['#ffd84d', '#ff9b4a', '#7ee36b', '#5ad1ff', '#ff8ad8'];
const FILL = [null, '#ffffff', '#fffbd6', '#ffe0e0', '#e0f0ff', '#e3f7dc', '#000000'];
const TOOL_NAME = { select: 'Select', hand: 'Hand', highlight: 'Highlight', underline: 'Underline', strike: 'Strikethrough', note: 'Sticky Note', freetext: 'Text Box', ink: 'Freehand', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', arrow: 'Arrow', stamp: 'Stamp', filltext: 'Add Text', sign: 'Signature', date: 'Date', check: 'Check Mark', edittext: 'Page Text', image: 'Add Image', redact: 'Redact', crop: 'Crop' };
const HINT = {
  select: 'Drag over text to select it · click an annotation to move/resize · double-click to edit',
  hand: 'Drag to scroll the document',
  highlight: 'Drag over text to highlight it', underline: 'Drag over text to underline it', strike: 'Drag over text to strike it through',
  note: 'Click on the page to add a sticky note', freetext: 'Drag a box or click to type', ink: 'Draw with mouse or pen — pen pressure varies the width',
  rect: 'Drag to draw · Shift for a square', ellipse: 'Drag to draw · Shift for a circle', line: 'Drag to draw · Shift snaps to 45°', arrow: 'Drag to draw · Shift snaps to 45°',
  stamp: 'Click on the page to place the stamp', filltext: 'Click where you want to type (form lines, boxes…)', sign: 'Click on the page to place your signature',
  date: "Click to insert today's date", check: 'Click to place a check mark', edittext: 'Click to add text into the page content', image: 'Click on the page to place the image',
  redact: 'Drag over areas to mark them (or select text → Redact) · then Apply', crop: 'Drag a rectangle on a page to crop'
};

function swatches(list, cur, key, allowNone) {
  return `<span class="swatches">${list.map(c => c === null ? (allowNone ? `<span class="sw none${cur == null ? ' on' : ''}" data-k="${key}" data-v="" title="None"></span>` : '') :
    `<span class="sw${String(cur).toLowerCase() === c ? ' on' : ''}" data-k="${key}" data-v="${c}" style="background:${c}" title="${c}"></span>`).join('')}<input type="color" data-k="${key}" value="${cur || '#000000'}" title="Custom color"></span>`;
}
const range = (key, label, val, min, max, step, fmt) => `<label>${label} <input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${val}"><span class="v" data-v-for="${key}">${fmt(val)}</span></label>`;
const pct = v => Math.round(v * 100) + '%';
const pts = v => (+v).toFixed(v < 2 ? 1 : 0) + ' pt';
function fontCtl(o) {
  return `<select data-k="font">${['Helvetica', 'Times', 'Courier'].map(f => `<option${o.font === f ? ' selected' : ''}>${f}</option>`).join('')}</select>` +
    `<select data-k="size" title="Font size">${[7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72].map(s => `<option value="${s}"${+o.size === s ? ' selected' : ''}>${s} pt</option>`).join('')}</select>`;
}

export function renderCmdbar() {
  if (App.organize) return;
  const d = App.doc; const a = App.sel && d && d.annot(App.sel);
  let h = '';
  if (a) {
    h += `<span class="tname">${esc(displayLabel(a))}</span>`;
    h += controlsFor(a.type === 'freetext' ? (a.content ? 'edittext' : (a.bw || a.fill ? 'freetext' : 'filltext')) : a.type, a);
    h += `<span class="sep"></span><button class="aero-btn" data-act="comment">Comment</button><button class="aero-btn" data-act="delete" title="Delete (Del)">Delete</button>`;
  } else {
    const t = App.tool; h += `<span class="tname">${TOOL_NAME[t] || t}</span>`;
    h += controlsFor(t, App.opts[t] || {});
    h += `<span class="hint">${HINT[t] || ''}</span>`;
  }
  bar.innerHTML = h;
}
function controlsFor(t, o) {
  let h = '';
  switch (t) {
    case 'highlight': h += swatches(HILITE, o.color, 'color') + range('opacity', 'Opacity', o.opacity, 0.1, 1, 0.05, pct); break;
    case 'underline': case 'strike': case 'squiggly': h += swatches(STROKE, o.color, 'color') + range('opacity', 'Opacity', o.opacity, 0.1, 1, 0.05, pct); break;
    case 'note': h += swatches(NOTE, o.color, 'color'); break;
    case 'ink': case 'check': h += swatches(STROKE, o.color, 'color') + range('width', 'Width', o.width, 0.5, 16, 0.5, pts) + range('opacity', 'Opacity', o.opacity, 0.1, 1, 0.05, pct); break;
    case 'rect': case 'ellipse':
      h += `<label>Stroke</label>` + swatches(STROKE, o.color, 'color') + `<label>Fill</label>` + swatches(FILL, o.fill, 'fill', true) + range('width', 'Width', o.width, 0, 16, 0.5, pts) + range('opacity', 'Opacity', o.opacity, 0.1, 1, 0.05, pct);
      if (!App.sel) h += `<label title="Draw into the page content instead of as an annotation"><input type="checkbox" data-k="contentMode"${App.contentMode ? ' checked' : ''}> As page content</label>`;
      break;
    case 'line': case 'arrow':
      h += swatches(STROKE, o.color, 'color') + range('width', 'Width', o.width, 0.5, 16, 0.5, pts) + range('opacity', 'Opacity', o.opacity, 0.1, 1, 0.05, pct);
      if (!App.sel) h += `<label title="Draw into the page content instead of as an annotation"><input type="checkbox" data-k="contentMode"${App.contentMode ? ' checked' : ''}> As page content</label>`;
      break;
    case 'freetext':
      h += fontCtl(o) + `<button class="aero-btn small${o.bold ? ' on' : ''}" data-k="bold" title="Bold"><b>B</b></button>` + swatches(STROKE.slice(0, 7), o.color, 'color') + `<label>Fill</label>` + swatches(FILL, o.fill, 'fill', true) +
        `<label>Border <select data-k="bw">${[0, 0.5, 1, 2, 3].map(w => `<option value="${w}"${+o.bw === w ? ' selected' : ''}>${w ? w + ' pt' : 'None'}</option>`).join('')}</select></label>` +
        `<select data-k="align">${['left', 'center', 'right'].map(x => `<option${o.align === x ? ' selected' : ''}>${x}</option>`).join('')}</select>`;
      break;
    case 'filltext': case 'date': h += fontCtl(App.sel ? o : App.opts.filltext) + swatches(['#000000', '#0b1f6b', '#1f4fbf', '#d42020'], (App.sel ? o : App.opts.filltext).color, 'color'); break;
    case 'edittext': h += fontCtl(o) + `<button class="aero-btn small${o.bold ? ' on' : ''}" data-k="bold" title="Bold"><b>B</b></button>` + swatches(STROKE.slice(0, 7), o.color, 'color'); break;
    case 'stamp':
      if (App.sel) h += `<button class="aero-btn" data-act="stamplabel">Edit text…</button>` + swatches(['#1e8a3c', '#2862c8', '#c62828', '#d97a00', '#6a3fb5'], o.color, 'color') + range('opacity', 'Opacity', o.opacity, 0.1, 1, 0.05, pct);
      else h += `<label>Stamp <select data-k="label">${STAMPS.map(([l]) => `<option${o.label === l ? ' selected' : ''}>${l}</option>`).join('')}${STAMPS.some(([l]) => l === o.label) ? '' : `<option selected>${esc(o.label)}</option>`}<option value="__custom">Custom…</option></select></label>` +
        swatches(['#1e8a3c', '#2862c8', '#c62828', '#d97a00', '#6a3fb5'], o.color, 'color') + `<label><input type="checkbox" data-k="withSub"${o.withSub ? ' checked' : ''}> Name &amp; date</label>`;
      break;
    case 'sign': h += `<button class="aero-btn" data-act="signatures">Signatures…</button>` + (App.signature ? `<img src="${App.signature.dataUrl}" style="height:26px;background:#fff;border-radius:3px;padding:1px 4px">` : ''); break;
    case 'image': if (App.sel) h += range('opacity', 'Opacity', o.opacity ?? 1, 0.1, 1, 0.05, pct); else h += `<button class="aero-btn" data-act="pickimage">Choose image…</button>`; break;
    case 'redact': h += `<button class="aero-btn" data-act="applyredact">Apply Redactions…</button>`; break;
    case 'crop': h += `<button class="aero-btn" data-act="cropdialog">Crop Margins…</button>`; break;
  }
  return h;
}

function setVal(k, v, final) {
  const d = App.doc;
  if (k === 'contentMode') { App.contentMode = !!v; return; }
  const a = App.sel && d && d.annot(App.sel);
  if (a) {
    const patch = { [k]: v };
    if (a.type === 'freetext' && (k === 'size' || k === 'font' || k === 'bold' || k === 'bw')) {
      const nu = fitFreetext({ ...structuredClone(a), ...patch }); replaceAnnot(nu, 'Change text style', final);
    } else patchAnnot(a.id, patch, 'Change ' + k, final);
    if (final) { emit('sel'); }
    return;
  }
  const o = App.opts[App.tool === 'date' ? 'filltext' : App.tool]; if (!o) return;
  o[k] = v; prefs.set('opts', App.opts);
}
bar.addEventListener('click', e => {
  const sw = e.target.closest('.sw');
  if (sw) { setVal(sw.dataset.k, sw.dataset.v || null, true); renderCmdbar(); return; }
  const b = e.target.closest('[data-k="bold"]');
  if (b) { const a = App.sel && App.doc.annot(App.sel); const cur = a ? !!a.bold : !!App.opts[App.tool]?.bold; setVal('bold', !cur, true); renderCmdbar(); return; }
  const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
  const a = App.sel && App.doc?.annot(App.sel);
  if (act === 'delete') deleteAnnot();
  else if (act === 'comment' && a) emit('editComment', a.id);
  else if (act === 'stamplabel' && a) Aero.prompt('Stamp text', 'Label', a.label).then(v => { if (v) patchAnnot(a.id, { label: v.toUpperCase() }, 'Edit stamp'); renderCmdbar(); });
  else emit('action', act);
});
bar.addEventListener('input', e => {
  const k = e.target.dataset.k; if (!k || e.target.type === 'checkbox' || e.target.tagName === 'SELECT') return;
  const v = e.target.type === 'range' ? +e.target.value : e.target.value;
  const out = bar.querySelector(`[data-v-for="${k}"]`); if (out) out.textContent = k === 'opacity' ? pct(v) : pts(v);
  setVal(k, v, false);
});
bar.addEventListener('change', e => {
  const k = e.target.dataset.k; if (!k) return;
  let v = e.target.type === 'checkbox' ? e.target.checked : e.target.type === 'range' ? +e.target.value : e.target.value;
  if (k === 'size' || k === 'bw') v = +v;
  if (k === 'label' && v === '__custom') {
    Aero.prompt('Custom stamp', 'Stamp text', 'REVISED').then(t => { if (t) { App.opts.stamp.label = t.toUpperCase().slice(0, 40); prefs.set('opts', App.opts); } renderCmdbar(); });
    return;
  }
  if (k === 'label') { const p = STAMPS.find(s => s[0] === v); if (p) App.opts.stamp.color = p[1]; }
  setVal(k, v, true); renderCmdbar();
});
on('tool', renderCmdbar); on('sel', renderCmdbar);
export { MARKUP };
