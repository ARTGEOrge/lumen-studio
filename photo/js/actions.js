'use strict';
/* Actions: record filter / adjustment / image size / canvas / selection / export steps, replay them on the current
   image, and batch-apply them to many files (results are delivered as one ZIP). Actions persist per user and can be
   imported/exported as JSON; formula code inside an imported action must be approved before it runs. */
const ACTION_TYPES = ['filter', 'adjLayer', 'imageSize', 'canvasSize', 'rotate', 'flip', 'flatten', 'trim', 'selectAll', 'deselect', 'invertSel', 'colorRange', 'export'];
const DEFAULT_ACTIONS = () => [
  { name: 'Web export (1200 px JPEG)', steps: [{ type: 'imageSize', w: 1200, h: 0, p: 100, lock: true }, { type: 'filter', name: 'Unsharp Mask…', params: { a: 60, r: 1 } }, { type: 'export', fmt: 'jpeg', q: 85, s: 100 }] },
  { name: 'Warm vintage', steps: [{ type: 'filter', name: 'Vibrance…', params: { v: -25 } }, { type: 'adjLayer', kind: 'Photo Filter…', params: { c: '#ec8a00', d: 30 } }, { type: 'filter', name: 'Vignette…', params: { a: 55, r: 35 } }] },
  { name: 'Punchy black & white', steps: [{ type: 'filter', name: 'Black & White', params: {} }, { type: 'filter', name: 'Curves…', params: { ch: 'rgb', b0: 8, p1: 52, p2: 128, p3: 206, w0: 255 } }] }
];
let actionSets = DEFAULT_ACTIONS(), actSel = 0, recording = null, playing = false;
try { const s = JSON.parse(localStorage.getItem('lumen.actions') || 'null'); if (Array.isArray(s)) actionSets = sanitizeActions(s); } catch (e) { }
const saveActions = () => { try { localStorage.setItem('lumen.actions', JSON.stringify(actionSets)); } catch (e) { } };
function sanitizeParams(p) {
  const o = {}; if (!p || typeof p !== 'object') return o;
  Object.keys(p).slice(0, 60).forEach(k => { const v = p[k]; if (typeof v === 'number' && Number.isFinite(v) || typeof v === 'boolean' || typeof v === 'string' && v.length < 20000) o[k] = v; });
  return o;
}
function sanitizeStep(s) {
  if (!s || typeof s !== 'object' || !ACTION_TYPES.includes(s.type)) return null;
  const n = (v, d, a, b) => Number.isFinite(+v) ? clamp(+v, a, b) : d;
  switch (s.type) {
    case 'filter': return FILTERS[s.name] ? { type: 'filter', name: s.name, params: sanitizeParams(s.params) } : null;
    case 'adjLayer': return FILTERS[s.kind]?.adj ? { type: 'adjLayer', kind: s.kind, params: sanitizeParams(s.params) } : null;
    case 'imageSize': return { type: 'imageSize', w: n(s.w, 0, 0, 20000), h: n(s.h, 0, 0, 20000), p: n(s.p, 100, 1, 1000), lock: s.lock !== false };
    case 'canvasSize': return { type: 'canvasSize', w: n(s.w, 1, 1, 20000), h: n(s.h, 1, 1, 20000), a: /^[0-2],[0-2]$/.test(s.a) ? s.a : '1,1', fill: ['none', 'bg', 'white'].includes(s.fill) ? s.fill : 'none' };
    case 'rotate': return [90, -90, 180].includes(+s.deg) ? { type: 'rotate', deg: +s.deg } : null;
    case 'flip': return { type: 'flip', h: !!s.h };
    case 'colorRange': return { type: 'colorRange', params: sanitizeParams(s.params) };
    case 'export': return { type: 'export', fmt: ['png', 'jpeg', 'webp'].includes(s.fmt) ? s.fmt : 'png', q: n(s.q, 92, 10, 100), s: n(s.s, 100, 1, 400) };
    default: return { type: s.type };
  }
}
function sanitizeActions(list) {
  return (Array.isArray(list) ? list : []).slice(0, 200).filter(a => a && typeof a === 'object').map(a => ({ name: String(a.name || 'Action').slice(0, 80), steps: (Array.isArray(a.steps) ? a.steps : []).slice(0, 200).map(sanitizeStep).filter(Boolean) }));
}
function stepLabel(s) {
  switch (s.type) {
    case 'filter': return plainName(s.name);
    case 'adjLayer': return 'Adjustment layer: ' + plainName(s.kind);
    case 'imageSize': return 'Image Size ' + (s.p !== 100 ? s.p + '%' : s.lock ? (s.w ? s.w + ' px wide' : s.h + ' px high') : s.w + ' × ' + s.h);
    case 'canvasSize': return `Canvas Size ${s.w} × ${s.h}`;
    case 'rotate': return { 90: 'Rotate 90° CW', '-90': 'Rotate 90° CCW', 180: 'Rotate 180°' }[s.deg];
    case 'flip': return s.h ? 'Flip Canvas Horizontal' : 'Flip Canvas Vertical';
    case 'flatten': return 'Flatten Image';
    case 'trim': return 'Trim Transparent Pixels';
    case 'selectAll': return 'Select All'; case 'deselect': return 'Deselect'; case 'invertSel': return 'Inverse Selection';
    case 'colorRange': return 'Color Range';
    case 'export': return `Export ${s.fmt.toUpperCase()}${s.fmt !== 'png' ? ' ' + s.q + '%' : ''}${s.s !== 100 ? ' @' + s.s + '%' : ''}`;
  }
  return s.type;
}
// Called by commands when the user performs them
function recordStep(step) {
  if (!recording || playing) return;
  const s = sanitizeStep(JSON.parse(JSON.stringify(step))); if (!s) return;
  actionSets[recording.idx].steps.push(s); saveActions(); renderActions();
  setStatusMsg(`● Recording “${actionSets[recording.idx].name}” — ${actionSets[recording.idx].steps.length} step(s)`);
}
function startRecording(idx = actSel) {
  if (!actionSets[idx]) return;
  recording = { idx }; actSel = idx; renderActions();
  setStatusMsg(`● Recording “${actionSets[idx].name}” — use filters, adjustments, Image Size, Export… then press Stop`);
}
function stopRecording() { if (!recording) return; const a = actionSets[recording.idx]; recording = null; setStatusMsg(''); saveActions(); renderActions(); toast(`Recorded ${a.steps.length} step(s) in “${a.name}”`); }
async function newAction() {
  const name = await new Promise(res => showDialog({ title: 'New Action', ok: 'Record', fields: [{ key: 'n', label: 'Name', type: 'text', value: 'Action ' + (actionSets.length + 1) }], onOK: v => res(v.n), onCancel: () => res(null) }));
  if (!name) return;
  actionSets.push({ name: String(name).slice(0, 80), steps: [] }); saveActions(); startRecording(actionSets.length - 1);
}
function deleteAction() { if (recording) stopRecording(); if (!actionSets[actSel]) return; actionSets.splice(actSel, 1); actSel = clamp(actSel, 0, actionSets.length - 1); saveActions(); renderActions(); }

/* ---------- running steps ---------- */
function applyFilterDirect(name, params) {
  const F = FILTERS[name], t = editTarget(true); if (!F || !t) return false;
  const orig = clone(t.canvas); putResult(t, orig, F.fn(orig, { ...defaultsOf({ fields: F.fields || [] }), ...(params || {}) })); pushHistory(plainName(name)); return true;
}
function imageSizeFromStep(s) {
  let w, h; const ar = doc.w / doc.h;
  if (s.p !== 100) { w = doc.w * s.p / 100; h = doc.h * s.p / 100; }
  else if (s.lock) { if (s.w) { w = s.w; h = s.w / ar; } else if (s.h) { h = s.h; w = s.h * ar; } else return; }
  else { w = s.w || doc.w; h = s.h || doc.h; }
  resizeImage(Math.round(clamp(w, 1, 20000)), Math.round(clamp(h, 1, 20000)));
}
async function runStep(s, ctx) {
  switch (s.type) {
    case 'filter': applyFilterDirect(s.name, s.params); break;
    case 'adjLayer': { const F = FILTERS[s.kind]; if (!F) break; const L = newLayer(plainName(s.kind), null, 0, 0, 'adjust'); L.adjust = { kind: s.kind, params: { ...defaultsOf({ fields: F.fields || [] }), ...s.params } }; L.mask = { canvas: newMaskCanvas(L, '#fff'), enabled: true }; insertLayer(L); pushHistory('New ' + plainName(s.kind)); break; }
    case 'imageSize': imageSizeFromStep(s); break;
    case 'canvasSize': applyCanvasSize(s); break;
    case 'rotate': rotateCanvas(s.deg); break;
    case 'flip': flipCanvas(s.h); break;
    case 'flatten': flatten(); break;
    case 'trim': trimTransparent(); break;
    case 'selectAll': selectAll(); break;
    case 'deselect': deselect(); break;
    case 'invertSel': invertSel(); break;
    case 'colorRange': { const v = { mode: 'sample', color: '#000000', fuzz: 40, invert: false, add: false, ...s.params }; const m = alphaToMask(colorRangeAlpha(v)); setSel(maskEmpty(m) ? null : m); break; }
    case 'export': { const bytes = await exportBytes(s.fmt, s.q, s.s); const ext = s.fmt === 'jpeg' ? 'jpg' : s.fmt; if (ctx.onExport) ctx.onExport(bytes, ext); else await saveBytes((doc.name || 'image') + '.' + ext, ext, bytes); break; }
  }
}
async function playAction(idx = actSel) {
  const a = actionSets[idx]; if (!a) return;
  if (!doc) return toast('Open an image first');
  if (recording) stopRecording();
  if (!a.steps.length) return toast('This action has no steps yet — press Record');
  ftCommit();
  playing = true; busy(`Playing “${a.name}”…`);
  try { for (const s of a.steps) { await runStep(s, {}); await new Promise(r => setTimeout(r, 0)); } toast(`Played “${a.name}” (${a.steps.length} steps)`); }
  catch (e) { console.error(e); toast('Action stopped: ' + e.message); }
  finally { playing = false; busy(); }
}

/* ---------- batch ---------- */
function withSandbox(fn) {
  const saved = { doc, hist, selection, comp, zoom, panX, panY, cropRect, dirty: window.__lumenDirty, title: document.title, layerCount, compVer, path: doc?.path };
  suppressHistory = true;
  const restore = () => {
    suppressHistory = false;
    doc = saved.doc; hist = saved.hist; selection = saved.selection; comp = saved.comp; zoom = saved.zoom; panX = saved.panX; panY = saved.panY; cropRect = saved.cropRect;
    window.__lumenDirty = saved.dirty; layerCount = saved.layerCount; prefixCache = null; edgeCache = null; pixCache = { key: null };
    document.title = saved.title; requestRender(); updatePanels();
  };
  return Promise.resolve().then(fn).finally(restore);
}
async function batchFiles(files, steps, opt, progress) {
  const out = [], skipped = [];
  await withSandbox(async () => {
    for (let k = 0; k < files.length; k++) {
      const f = files[k]; progress?.(k, files.length, f.name);
      try {
        const nm = baseName(f.name);
        if (/\.(psd|psb)$/i.test(f.name)) { const psd = agPsd.readPsd(f.data, { skipThumbnail: true }); const c = psd.canvas || mk(psd.width, psd.height); startDoc(c.width, c.height, [{ name: 'Background', canvas: clone(c) }], 'Batch', nm); }
        else if (/\.(png|jpe?g|webp|gif|bmp|avif|svg|ico)$/i.test(f.name)) { const img = await loadImg(URL.createObjectURL(new Blob([f.data]))); const c = mk(img.naturalWidth || img.width, img.naturalHeight || img.height); cx(c).drawImage(img, 0, 0); startDoc(c.width, c.height, [{ name: 'Background', canvas: c }], 'Batch', nm); }
        else { skipped.push(f.name); continue; }
        let exported = 0;
        const ctx = { onExport: (bytes, ext) => { out.push({ name: `${nm}${opt.suffix || ''}${exported ? '-' + exported : ''}.${ext}`, bytes }); exported++; } };
        playing = true;
        for (const s of steps) await runStep(s, ctx);
        playing = false;
        if (!exported) { const ext = opt.fmt === 'jpeg' ? 'jpg' : opt.fmt; ctx.onExport(await exportBytes(opt.fmt, opt.q, 100), ext); }
      } catch (e) { playing = false; console.warn('batch', f.name, e); skipped.push(f.name); }
      await new Promise(r => setTimeout(r, 0));
    }
  });
  return { out, skipped };
}
function pickFiles(accept) {
  return new Promise(res => {
    const i = document.createElement('input'); i.type = 'file'; i.multiple = true; i.accept = accept; i.style.display = 'none';
    i.onchange = async () => { const list = []; for (const f of i.files) list.push({ name: f.name, data: await f.arrayBuffer() }); i.remove(); res(list); };
    document.body.appendChild(i); i.click();
  });
}
function batchDialog() {
  if (!actionSets.length) return toast('Create an action first');
  if (recording) stopRecording();
  let files = [];
  showDialog({
    title: 'Batch', ok: 'Run Batch', fields: [
      { key: 'a', label: 'Action', type: 'select', value: String(actSel), options: actionSets.map((a, i) => [String(i), a.name]) },
      { key: 'fmt', label: 'Save as (if the action has no Export step)', type: 'select', value: 'png', options: [['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP']] },
      { key: 'q', label: 'Quality', type: 'range', min: 10, max: 100, value: 90, fmt: pct },
      { key: 'suffix', label: 'File name suffix', type: 'text', value: '-edited' }],
    html: '<div class="row"><label>Source files</label><button class="b" id="bpick">Choose files…</button><span class="val" id="bcount">0</span></div><p class="dnote">Each image (PNG, JPEG, WebP, GIF, BMP, PSD) is opened, the action is applied, and the results are saved together as one ZIP. Your open document is not changed.</p>',
    onMount: box => { box.querySelector('#bpick').onclick = async () => { files = await pickFiles('image/*,.psd,.psb'); box.querySelector('#bcount').textContent = files.length; }; },
    onOK: async v => {
      if (!files.length) return toast('No files chosen');
      const steps = actionSets[+v.a]?.steps || [];
      busy('Batch…');
      const r = await batchFiles(files, steps, { fmt: v.fmt, q: v.q, suffix: v.suffix.replace(/[\\/:*?"<>|]/g, '') }, (k, n, name) => busy(`Batch ${k + 1} / ${n}: ${name.replace(/[<>&]/g, '')}`));
      busy();
      if (!r.out.length) return toast('Nothing was processed' + (r.skipped.length ? ` (${r.skipped.length} unsupported)` : ''));
      await saveBytes('Batch results.zip', 'zip', makeZip(r.out));
      toast(`Batch done: ${r.out.length} file(s)${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`);
    }
  });
}

/* ---------- ZIP (stored) ---------- */
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC_T[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const used = new Set();
  files.forEach(f => {
    let name = f.name; for (let k = 2; used.has(name); k++) name = f.name.replace(/(\.[^.]+)$/, ` (${k})$1`); used.add(name);
    const nb = enc.encode(name), data = f.bytes, crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    central.push(new Uint8Array(c.buffer), nb);
    off += 30 + nb.length + data.length;
  });
  const cs = central.reduce((s, p) => s + p.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cs, true); e.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((s, p) => s + p.length, 0)); let p = 0;
  all.forEach(a => { out.set(a, p); p += a.length; });
  return out;
}

/* ---------- import / export ---------- */
async function exportActions() { await saveBytes('Lumen actions.json', 'json', new TextEncoder().encode(JSON.stringify({ app: 'lumen-actions', version: 1, actions: actionSets }, null, 1))); }
async function importActions() {
  const f = (await pickFiles('.json,application/json'))[0]; if (!f) return;
  let list; try { const j = JSON.parse(new TextDecoder().decode(f.data)); list = sanitizeActions(j.actions || j); } catch (e) { return toast('Not an actions file'); }
  if (!list.length) return toast('No actions found in the file');
  const codes = new Set();
  list.forEach(a => a.steps.forEach(s => { const p = s.params; if ((s.name === 'Formula…' || s.kind === 'Formula…') && p) { const c = p.preset && p.preset !== 'custom' ? FORMULA_PRESETS[p.preset] : p.code; if (c && !trustedCode.has(c)) codes.add(c); } }));
  actionSets.push(...list); saveActions(); actSel = actionSets.length - list.length; renderActions();
  toast(`Imported ${list.length} action(s)`);
  if (codes.size) {
    const esc = s => s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
    showDialog({ title: 'These actions contain formula code', ok: 'Allow code', html: `<p class="dnote">Formula steps run code. Only allow it if you trust where this file came from — until then those steps leave the image unchanged.</p><pre class="codeprev">${esc([...codes].join('\n\n---\n\n'))}</pre>`, onOK: () => codes.forEach(c => trustedCode.add(c)) });
  }
}

/* ---------- panel ---------- */
function renderActions() {
  const box = $('#actions'); if (!box) return;
  box.innerHTML = '';
  actionSets.forEach((a, i) => {
    const row = document.createElement('div'); row.className = 'hi act' + (i === actSel ? ' on' : '') + (recording?.idx === i ? ' rec' : '');
    row.innerHTML = `<span class="hdot">${recording?.idx === i ? '●' : '▸'}</span><span class="hl"></span><span class="dim">${a.steps.length}</span>`;
    row.querySelector('.hl').textContent = a.name;
    row.onclick = () => { actSel = i; renderActions(); };
    row.ondblclick = async () => { const n = await new Promise(res => showDialog({ title: 'Rename Action', fields: [{ key: 'n', label: 'Name', type: 'text', value: a.name }], onOK: v => res(v.n), onCancel: () => res(null) })); if (n) { a.name = String(n).slice(0, 80); saveActions(); renderActions(); } };
    box.appendChild(row);
    if (i === actSel) a.steps.forEach((s, k) => {
      const st = document.createElement('div'); st.className = 'hi step';
      st.innerHTML = '<span class="hl"></span><span class="hcmp" title="Delete step">✕</span>'; st.querySelector('.hl').textContent = stepLabel(s);
      st.querySelector('.hcmp').onclick = e => { e.stopPropagation(); a.steps.splice(k, 1); saveActions(); renderActions(); };
      box.appendChild(st);
    });
  });
  if (!actionSets.length) box.innerHTML = '<div class="dim" style="padding:8px">No actions. Press ＋ to record one.</div>';
  const rb = $('#ab-rec'); if (rb) rb.classList.toggle('on', !!recording);
}
function buildActionsPanel() {
  const tabs = $('#histtabs');
  tabs.querySelectorAll('[data-tab]').forEach(t => t.onclick = () => {
    tabs.querySelectorAll('[data-tab]').forEach(x => x.classList.toggle('on', x === t));
    const act = t.dataset.tab === 'actions'; $('#history').hidden = act; $('#actpane').hidden = !act; $('#histinfo').hidden = act;
    if (act) renderActions();
  });
  $('#ab-rec').onclick = () => recording ? stopRecording() : (actionSets.length ? startRecording() : newAction());
  $('#ab-stop').onclick = () => stopRecording();
  $('#ab-play').onclick = () => playAction();
  $('#ab-new').onclick = () => newAction();
  $('#ab-del').onclick = () => deleteAction();
  $('#ab-batch').onclick = () => batchDialog();
  $('#ab-more').onclick = e => {
    e.stopPropagation();
    showDialog({ title: 'Actions', ok: 'Close', noCancel: true, html: '<div class="btnrow"><button class="b" id="aimp">Import…</button><button class="b" id="aexp">Export…</button><button class="b" id="arst">Restore defaults</button></div>', onMount: box => {
      box.querySelector('#aimp').onclick = () => { box.closest('.modal').querySelector('[data-a=o]').click(); importActions(); };
      box.querySelector('#aexp').onclick = () => exportActions();
      box.querySelector('#arst').onclick = () => { actionSets.push(...DEFAULT_ACTIONS()); saveActions(); renderActions(); toast('Default actions added'); };
    } });
  };
  renderActions();
}
function showActionsTab() { $('#histtabs [data-tab=actions]')?.click(); }
