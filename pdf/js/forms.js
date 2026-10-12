// Prepare Form: draw real AcroForm fields (text, multi-line, check box, radio, dropdown, date,
// signature placeholder), edit their properties, move/resize/delete them, and auto-detect fields
// on flat forms (underscore runs, ruled lines, check-box squares). Every change rewrites the PDF
// with pdf-lib and is a single undo step.
import { App, emit, on } from './state.js';
import { pageOp } from './organize.js';
import { V, rectPct, clientToPdf, pdfToClient } from './viewer.js';
import { registerTool, setTool } from './tools.js';
import { interpret, pageContentString, pageResources } from './content.js';
import { normRect, esc, f2, rectsIntersect, clamp } from './util.js';
const L = window.PDFLib;
const { PDFDocument, PDFName, PDFRef, PDFHexString, PDFString, PDFDict, PDFArray, PDFNumber, rgb } = L;

export const FIELD_TYPES = [['text', 'Text field'], ['multiline', 'Multi-line text'], ['check', 'Check box'], ['radio', 'Radio button'], ['dropdown', 'Dropdown'], ['date', 'Date field'], ['signature', 'Signature']];
const TYPE_LABEL = Object.fromEntries(FIELD_TYPES);
const DEF_SIZE = { text: [160, 20], multiline: [220, 60], check: [14, 14], radio: [14, 14], dropdown: [140, 20], date: [100, 20], signature: [180, 44] };
const DATE_FORMATS = ['mm/dd/yyyy', 'dd/mm/yyyy', 'yyyy-mm-dd', 'mmm d, yyyy'];
export const F = { type: 'text', sel: null }; // sel: {page, id, name}

/* ---------- reading fields (pdf.js widget annotations) ---------- */
function kindOf(a) {
  if (a.fieldType === 'Sig') return 'signature';
  if (a.fieldType === 'Btn') return a.checkBox ? 'check' : a.radioButton ? 'radio' : 'button';
  if (a.fieldType === 'Ch') return 'dropdown';
  if (a.fieldType === 'Tx') { const js = JSON.stringify(a.actions || {}); if (/AFDate/.test(js) || a.lumenDate) return 'date'; return a.multiLine ? 'multiline' : 'text'; }
  return 'other';
}
let libCache = { bytes: null, p: null };
function libFor(bytes) { if (libCache.bytes !== bytes) libCache = { bytes, p: PDFDocument.load(bytes, { updateMetadata: false }) }; return libCache.p; }
// text fields carrying Acrobat date-format actions are date fields
function isDateWidget(lib, id) {
  try {
    let o = lib.context.lookup(refOf(id));
    for (let k = 0; o instanceof PDFDict && k < 8; k++) {
      const aa = o.lookup(PDFName.of('AA'));
      if (aa instanceof PDFDict) { const f = aa.lookup(PDFName.of('F')) || aa.lookup(PDFName.of('K')); const js = f instanceof PDFDict ? f.lookup(PDFName.of('JS')) : null; const txt = js?.decodeText?.() || (js?.getContents ? new TextDecoder().decode(js.getContents()) : ''); return /AFDate/.test(txt); }
      o = o.lookup(PDFName.of('Parent'));
    }
  } catch (e) { /* ignore */ }
  return false;
}
export async function pageWidgets(d, i) {
  const anns = await d.getPageAnnots(i);
  const ws = anns.filter(a => a.subtype === 'Widget' && a.fieldName).map(a => ({ id: a.id, name: a.fieldName, kind: kindOf(a), rect: normRect(a.rect), a }));
  if (ws.some(w => w.kind === 'text')) { try { const lib = await libFor(d.state.bytes); for (const w of ws) if (w.kind === 'text' && isDateWidget(lib, w.id)) w.kind = 'date'; } catch (e) { /* ignore */ } }
  return ws;
}
async function allFieldNames(d) {
  const names = new Set();
  for (let i = 0; i < d.numPages; i++) for (const w of await pageWidgets(d, i)) names.add(w.name);
  return names;
}
async function uniqueName(d, base) {
  const names = await allFieldNames(d); base = String(base || 'Field').replace(/\./g, ' ').trim() || 'Field';
  if (!names.has(base)) return base;
  for (let k = 2; ; k++) if (!names.has(`${base} ${k}`)) return `${base} ${k}`;
}
const refOf = id => { const m = /^(\d+)R(\d*)$/.exec(id || ''); return m ? PDFRef.of(+m[1], +(m[2] || 0)) : null; };

/* ---------- writing fields ---------- */
const BORDER = rgb(0.38, 0.5, 0.68);
function fieldDict(field) { return field.acroField.dict; }
function setTU(field, tip) { if (tip) fieldDict(field).set(PDFName.of('TU'), PDFHexString.fromText(tip)); else fieldDict(field).delete(PDFName.of('TU')); }
function dateActions(pdf, fmt) {
  const ctx = pdf.context; const js = s => ctx.obj({ S: 'JavaScript', JS: PDFHexString.fromText(s) });
  return ctx.obj({ F: js(`AFDate_FormatEx("${fmt}");`), K: js(`AFDate_KeystrokeEx("${fmt}");`) });
}
function sigAppearance(pdf, w, h, font) {
  const ctx = pdf.context; const s = Math.min(10, h * 0.32);
  const ops = `q 0.996 0.98 0.86 rg 0 0 ${f2(w)} ${f2(h)} re f 0.85 0.65 0.15 RG 0.8 w 0.4 0.4 ${f2(w - 0.8)} ${f2(h - 0.8)} re S Q ` +
    `q 0.55 0.42 0.1 RG 0.6 w 6 ${f2(h * 0.3)} m ${f2(w - 6)} ${f2(h * 0.3)} l S Q BT 0.5 0.38 0.08 rg /F1 ${f2(s)} Tf 6 ${f2(h * 0.3 + 3)} Td (Sign here) Tj ET`;
  return ctx.register(ctx.flateStream(ops, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, w, h], Resources: { Font: { F1: font.ref } } }));
}
async function createField(pdf, page, p) {
  const form = pdf.getForm(); const [x1, y1, x2, y2] = normRect(p.rect);
  const box = { x: x1, y: y1, width: Math.max(4, x2 - x1), height: Math.max(4, y2 - y1), borderColor: BORDER, borderWidth: 0.75, backgroundColor: undefined, textColor: rgb(0, 0, 0) };
  let field;
  switch (p.kind) {
    case 'text': case 'multiline': case 'date': {
      field = form.createTextField(p.name);
      if (p.kind === 'multiline') field.enableMultiline();
      if (p.maxLen > 0) field.setMaxLength(p.maxLen);
      field.addToPage(page, box);
      if (p.fontSize) field.setFontSize(p.fontSize);
      if (p.def) field.setText(String(p.def));
      if (p.def) fieldDict(field).set(PDFName.of('DV'), PDFHexString.fromText(String(p.def)));
      if (p.kind === 'date') { fieldDict(field).set(PDFName.of('AA'), dateActions(pdf, p.dateFmt || DATE_FORMATS[0])); if (!p.tip) p.tip = `Date (${p.dateFmt || DATE_FORMATS[0]})`; }
      break;
    }
    case 'check': field = form.createCheckBox(p.name); field.addToPage(page, { ...box, textColor: rgb(0.05, 0.15, 0.4) }); if (p.def) field.check(); break;
    case 'radio': {
      let grp = null; try { grp = form.getRadioGroup(p.name); } catch (e) { grp = null; }
      if (!grp) grp = form.createRadioGroup(p.name);
      grp.addOptionToPage(p.value || 'Choice', page, { ...box, textColor: rgb(0.05, 0.15, 0.4) });
      if (p.def) grp.select(p.value || 'Choice');
      field = grp; break;
    }
    case 'dropdown': {
      field = form.createDropdown(p.name); const opts = (p.options || []).filter(Boolean);
      if (opts.length) field.addOptions(opts);
      if (p.editable) field.enableEditing();
      field.addToPage(page, box);
      if (p.def && opts.includes(p.def)) field.select(p.def);
      break;
    }
    case 'signature': {
      const ctx = pdf.context; const font = await pdf.embedFont(L.StandardFonts.Helvetica);
      const w = box.width, h = box.height;
      const dict = ctx.obj({ Type: 'Annot', Subtype: 'Widget', FT: 'Sig', T: PDFHexString.fromText(p.name), Rect: [x1, y1, x1 + w, y1 + h], F: 4, P: page.ref, MK: { BC: [0.85, 0.65, 0.15] }, AP: { N: sigAppearance(pdf, w, h, font) } });
      if (p.tip) dict.set(PDFName.of('TU'), PDFHexString.fromText(p.tip));
      const ref = ctx.register(dict); page.node.addAnnot(ref); form.acroForm.addField(ref);
      return null;
    }
  }
  if (field) { if (p.required) field.enableRequired(); if (p.readOnly) field.enableReadOnly(); if (p.kind !== 'radio') setTU(field, p.tip); }
  return field;
}
function findField(form, name) { try { return form.getField(name); } catch (e) { return null; } }

/* ---------- operations (all undoable) ---------- */
export async function addField(i, p) {
  const d = App.doc;
  const ok = await pageOp(`Add ${TYPE_LABEL[p.kind].toLowerCase()}`, async (pdf, refs, ids) => {
    const page = pdf.getPages()[i];
    if (p.kind !== 'radio' && findField(pdf.getForm(), p.name)) throw new Error(`A field named “${p.name}” already exists.`);
    await createField(pdf, page, p);
    return { ids };
  }, { toast: false });
  return ok;
}
export async function addFields(list, label) {
  return pageOp(label || `Add ${list.length} form fields`, async (pdf, refs, ids) => {
    const pages = pdf.getPages();
    for (const p of list) await createField(pdf, pages[p.page], p);
    return { ids };
  }, { toast: false });
}
export async function updateField(oldName, p, widgetId) {
  const d = App.doc;
  const ok = await pageOp('Field properties', async (pdf, refs, ids) => {
    const form = pdf.getForm(); const f = findField(form, oldName); if (!f) throw new Error(`Field “${oldName}” not found`);
    const dict = fieldDict(f);
    if (p.name && p.name !== oldName) {
      if (findField(form, p.name)) throw new Error(`A field named “${p.name}” already exists.`);
      dict.set(PDFName.of('T'), PDFHexString.fromText(p.name));
    }
    p.required ? f.enableRequired() : f.disableRequired(); p.readOnly ? f.enableReadOnly() : f.disableReadOnly();
    if (!(f instanceof L.PDFRadioGroup)) setTU(f, p.tip);
    if (f instanceof L.PDFTextField) {
      p.kind === 'multiline' ? f.enableMultiline() : f.disableMultiline();
      if (p.fontSize >= 0) f.setFontSize(p.fontSize || 0);
      if (p.maxLen > 0) f.setMaxLength(p.maxLen); else f.setMaxLength(undefined);
      f.setText(p.def ? String(p.def) : ''); if (p.def) dict.set(PDFName.of('DV'), PDFHexString.fromText(String(p.def))); else dict.delete(PDFName.of('DV'));
      if (p.kind === 'date') dict.set(PDFName.of('AA'), dateActions(pdf, p.dateFmt || DATE_FORMATS[0])); else if (/AFDate/.test(String(dict.lookup(PDFName.of('AA'))?.toString?.() || ''))) dict.delete(PDFName.of('AA'));
    } else if (f instanceof L.PDFCheckBox) { p.def ? f.check() : f.uncheck(); }
    else if (f instanceof L.PDFDropdown) {
      const opts = (p.options || []).filter(Boolean); f.setOptions(opts); if (p.editable) f.enableEditing(); else f.disableEditing();
      if (p.def && opts.includes(p.def)) f.select(p.def); else f.clear();
    } else if (f instanceof L.PDFRadioGroup) {
      if (p.value && widgetId) { // rename this button's export value
        const ref = refOf(widgetId); const w = ref && pdf.context.lookup(ref);
        const ap = w?.lookup?.(PDFName.of('AP')); const n = ap?.lookup?.(PDFName.of('N'));
        if (n instanceof PDFDict) { const on = n.keys().map(k => k.decodeText()).find(k => k !== 'Off'); if (on && on !== p.value) { for (const key of ['N', 'D']) { const sd = ap.lookup(PDFName.of(key)); if (sd instanceof PDFDict && sd.get(PDFName.of(on))) { sd.set(PDFName.of(p.value), sd.get(PDFName.of(on))); sd.delete(PDFName.of(on)); } } if (w.get(PDFName.of('AS'))?.decodeText?.() === on) w.set(PDFName.of('AS'), PDFName.of(p.value)); } }
      }
      if (p.def && p.value) { try { f.select(p.value); } catch (e) { /* ignore */ } }
    }
    try { const helv = await pdf.embedFont(L.StandardFonts.Helvetica); if (!(f instanceof L.PDFSignature) && f.defaultUpdateAppearances) f.defaultUpdateAppearances(helv); } catch (e) { /* appearance regenerated by viewers */ }
    return { ids };
  }, { toast: false });
  if (ok && p.name && p.name !== oldName && Object.prototype.hasOwnProperty.call(d.state.form, oldName)) { d.state.form[p.name] = d.state.form[oldName]; delete d.state.form[oldName]; }
  if (ok && Object.prototype.hasOwnProperty.call(d.state.form, p.name || oldName)) delete d.state.form[p.name || oldName]; // new default wins
  return ok;
}
export async function moveWidget(widgetId, rect, name) {
  return pageOp('Move field', async (pdf, refs, ids) => {
    const ref = refOf(widgetId); const w = ref && pdf.context.lookup(ref); if (!(w instanceof PDFDict)) throw new Error('Field widget not found');
    const [x1, y1, x2, y2] = normRect(rect); const old = w.lookup(PDFName.of('Rect')).asArray().map(x => x.asNumber());
    const resized = Math.abs((x2 - x1) - Math.abs(old[2] - old[0])) > 0.5 || Math.abs((y2 - y1) - Math.abs(old[3] - old[1])) > 0.5;
    w.set(PDFName.of('Rect'), pdf.context.obj([x1, y1, x2, y2].map(v => +f2(v))));
    if (resized) {
      const f = findField(pdf.getForm(), name);
      if (f instanceof L.PDFSignature || !f) { const ap = w.lookup(PDFName.of('AP')); if (ap instanceof PDFDict && f instanceof L.PDFSignature) { const font = await pdf.embedFont(L.StandardFonts.Helvetica); ap.set(PDFName.of('N'), sigAppearance(pdf, x2 - x1, y2 - y1, font)); } }
      else { try { const helv = await pdf.embedFont(L.StandardFonts.Helvetica); f.defaultUpdateAppearances(helv); } catch (e) { /* ignore */ } }
    }
    return { ids };
  }, { toast: false });
}
export async function deleteField(name, widgetId) {
  const d = App.doc;
  const ok = await pageOp('Delete field', async (pdf, refs, ids) => {
    const form = pdf.getForm(); const f = findField(form, name); if (!f) throw new Error(`Field “${name}” not found`);
    const widgets = f.acroField.getWidgets();
    if (f instanceof L.PDFRadioGroup && widgets.length > 1 && widgetId) {
      // remove only this radio button
      const ref = refOf(widgetId); const kids = f.acroField.Kids();
      if (kids) {
        const idx = kids.asArray().findIndex(k => k instanceof PDFRef && k.tag === ref.tag);
        if (idx >= 0) { kids.remove(idx); const opt = f.acroField.dict.lookup(PDFName.of('Opt')); if (opt instanceof PDFArray && opt.size() > idx) opt.remove(idx); }
      }
      for (const pg of pdf.getPages()) { const an = pg.node.Annots(); if (!an) continue; const k = an.asArray().findIndex(x => x instanceof PDFRef && x.tag === ref.tag); if (k >= 0) an.remove(k); }
      pdf.context.delete(ref);
    } else form.removeField(f);
    return { ids };
  }, { toast: false });
  if (ok && Object.prototype.hasOwnProperty.call(d.state.form, name)) delete d.state.form[name];
  return ok;
}

/* ---------- properties dialog ---------- */
function propsDialog({ title, kind, name, tip = '', required = false, readOnly = false, def = '', options = [], value = 'Choice', fontSize = 0, dateFmt = DATE_FORMATS[0], maxLen = 0, editable = false, isNew }) {
  return new Promise(res => {
    const fields = [{ key: 'name', label: kind === 'radio' ? 'Group name' : 'Name', type: 'text', value: name }, { key: 'tip', label: 'Tooltip', type: 'text', value: tip }];
    if (kind === 'radio') fields.push({ key: 'value', label: 'Button value', type: 'text', value });
    if (kind === 'date') fields.push({ key: 'dateFmt', label: 'Date format', type: 'select', value: dateFmt, options: DATE_FORMATS });
    if (kind === 'dropdown') fields.push({ key: 'options', label: 'Choices (one per line)', type: 'textarea', value: options.join('\n') }, { key: 'editable', label: 'Allow custom text', type: 'checkbox', value: editable });
    if (kind === 'check' || kind === 'radio') fields.push({ key: 'def', label: kind === 'radio' ? 'Selected by default' : 'Checked by default', type: 'checkbox', value: !!def });
    else if (kind !== 'signature') fields.push({ key: 'def', label: 'Default value', type: 'text', value: def });
    if (kind === 'text' || kind === 'multiline' || kind === 'date' || kind === 'dropdown') fields.push({ key: 'fontSize', label: 'Font size (0 = auto)', type: 'number', value: fontSize, min: 0, max: 72 });
    if (kind === 'text' || kind === 'multiline') fields.push({ key: 'maxLen', label: 'Max characters (0 = no limit)', type: 'number', value: maxLen, min: 0, max: 10000 });
    if (kind === 'text') fields.push({ key: 'multiline', label: 'Multi-line', type: 'checkbox', value: false });
    if (kind !== 'signature') fields.push({ key: 'readOnly', label: 'Read-only', type: 'checkbox', value: readOnly });
    fields.push({ key: 'required', label: 'Required', type: 'checkbox', value: required });
    Aero.dialog({
      title, width: 460, instruction: `${TYPE_LABEL[kind] || 'Field'} properties`, fields, ok: isNew ? 'Add Field' : 'OK',
      html: kind === 'signature' ? `<div class="dnote">A signature placeholder shows people where to sign. Sign it with <b>Fill &amp; Sign › Sign with Digital ID…</b> (or any PDF signing app).</div>` : '',
      onOK: v => {
        const nm = String(v.name || '').trim();
        if (!nm) { Aero.alert(title, 'The field needs a name.'); return res(null); }
        if (nm.includes('.')) { Aero.alert(title, 'Field names cannot contain a period (.)'); return res(null); }
        const out = { ...v, name: nm, kind: kind === 'text' && v.multiline ? 'multiline' : kind, options: kind === 'dropdown' ? String(v.options || '').split('\n').map(s => s.trim()).filter(Boolean) : [] };
        if (kind === 'dropdown' && !out.options.length) out.options = ['Option 1', 'Option 2'];
        res(out);
      },
      onCancel: () => res(null)
    });
  });
}
export async function newFieldAt(i, rect) {
  const d = App.doc; const kind = F.type;
  const base = { text: 'Text', multiline: 'Text', check: 'Check Box', radio: 'Radio Group', dropdown: 'Dropdown', date: 'Date', signature: 'Signature' }[kind];
  const p = await propsDialog({ title: 'New form field', kind, name: kind === 'radio' && F.lastRadio ? F.lastRadio : await uniqueName(d, base + ' 1'), value: kind === 'radio' ? 'Choice ' + ((F.radioN = (F.radioN || 0) + 1)) : 'Choice', isNew: true });
  if (!p) return false;
  if (kind === 'radio') F.lastRadio = p.name;
  const ok = await addField(i, { ...p, rect });
  if (ok) Aero.toast(`Added ${TYPE_LABEL[p.kind].toLowerCase()} “${p.name}”`);
  return ok;
}
export async function editFieldProps(w) {
  const a = w.a; const fv = Array.isArray(a.fieldValue) ? a.fieldValue[0] : a.fieldValue;
  const p = await propsDialog({
    title: 'Field properties', kind: w.kind, name: w.name, tip: a.alternativeText || '', required: !!a.required || !!(a.fieldFlags & 2), readOnly: !!a.readOnly,
    def: w.kind === 'check' ? (fv && fv !== 'Off') : w.kind === 'radio' ? fv === a.buttonValue : (fv || ''), options: (a.options || []).map(o => o.exportValue ?? o.displayValue), value: a.buttonValue || 'Choice',
    fontSize: a.defaultAppearanceData?.fontSize || 0, maxLen: a.maxLen || 0, editable: !!a.combo && !!a.editable
  });
  if (!p) return false;
  return updateField(w.name, p, w.id);
}

/* ---------- auto-detect ---------- */
export async function detectFields(d) {
  const out = [];
  const lib = await PDFDocument.load(d.state.bytes, { updateMetadata: false });
  for (let i = 0; i < d.numPages; i++) {
    const existing = (await pageWidgets(d, i)).map(w => w.rect);
    const t = await d.getText(i);
    const pg = lib.getPages()[i];
    let res; try { res = interpret(lib.context, pageContentString(pg), pageResources(pg), { paths: true }); } catch (e) { res = { paths: [], shows: [] }; }
    const W = d.info[i].w;
    // text items with geometry (horizontal text only)
    const items = t.items.filter(it => it.str && Math.abs(it.transform[1]) < 0.01 && it.transform[0] > 0).map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height || Math.abs(it.transform[3]) }));
    const labelLeft = (x, y, h) => {
      const c = items.filter(it => Math.abs(it.y - y) < Math.max(3, h * 0.6) && it.x + it.w <= x + 2 && x - (it.x + it.w) < 160 && it.str.replace(/[_\s:]/g, '')).sort((a, b) => b.x - a.x);
      return c[0] ? c[0].str.replace(/_+/g, '').replace(/[:\s]+$/, '').trim() : '';
    };
    const labelNear = (x1, x2, y) => {
      const c = items.filter(it => it.str.replace(/[_\s]/g, '') && it.x < x2 && it.x + it.w > x1 - 20 && ((it.y < y && y - it.y < 22) || (it.y > y && it.y - y < 44))).sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y));
      return c[0] ? c[0].str.replace(/[:\s]+$/, '').trim() : '';
    };
    const cands = [];
    // (a) underscore runs typed as text
    for (const it of items) {
      const re = /_{3,}/g; let m;
      while ((m = re.exec(it.str))) {
        const n = it.str.length || 1; const cw = it.w / n;
        const x1 = it.x + m.index * cw, x2 = it.x + (m.index + m[0].length) * cw;
        if (x2 - x1 < 24) continue;
        const pre = it.str.slice(0, m.index).replace(/[:\s]+$/, '').trim();
        const label = pre || labelLeft(x1, it.y, it.h);
        cands.push({ page: i, rect: [x1, it.y - 1, x2, it.y + Math.min(18, it.h * 1.25)], label, src: 'underscore' });
      }
    }
    // (b) ruled lines & (c) boxes from vector paths
    const H = [], Vt = [], rects = [];
    for (const p of res.paths) {
      const stroked = /^[SsBb]/.test(p.paint);
      for (const s of p.segs) {
        if (s.t === 're') {
          const [x1, y1, x2, y2] = s.rect, w = x2 - x1, h = y2 - y1;
          if (h <= 1.6 && w >= 6) H.push([x1, x2, (y1 + y2) / 2]); else if (w <= 1.6 && h >= 6) Vt.push([y1, y2, (x1 + x2) / 2]);
          else if (stroked && w >= 6 && w <= 22 && Math.abs(w - h) < 1.5) rects.push([x1, y1, x2, y2]);
          else if (stroked && h >= 6) { H.push([x1, x2, y1]); H.push([x1, x2, y2]); Vt.push([y1, y2, x1]); Vt.push([y1, y2, x2]); }
        } else if (s.t === 'l' && stroked && s.a) {
          const [ax, ay] = s.a, [bx, by] = s.p;
          if (Math.abs(ay - by) < 0.5 && Math.abs(bx - ax) >= 6) H.push([Math.min(ax, bx), Math.max(ax, bx), ay]);
          else if (Math.abs(ax - bx) < 0.5 && Math.abs(by - ay) >= 6) Vt.push([Math.min(ay, by), Math.max(ay, by), ax]);
        }
      }
    }
    // squares made of 4 thin pieces (common in HTML-to-PDF output)
    for (const a of H) for (const b of H) {
      const len = a[1] - a[0]; if (b === a || len < 6 || len > 22 || b[2] <= a[2]) continue;
      if (Math.abs(a[0] - b[0]) < 1.2 && Math.abs(a[1] - b[1]) < 1.2 && Math.abs((b[2] - a[2]) - len) < 2.5) rects.push([a[0], a[2], a[1], b[2]]);
    }
    for (const r of rects) {
      if (rects.some(o => o !== r && o[0] <= r[0] + 0.5 && o[2] >= r[2] - 0.5 && o[1] <= r[1] + 0.5 && o[3] >= r[3] - 0.5 && (o[2] - o[0]) > (r[2] - r[0]) + 0.5)) continue;
      const cy = (r[1] + r[3]) / 2; const right = items.filter(it => Math.abs(it.y + it.h * 0.35 - cy) < 8 && it.x >= r[2] - 1 && it.x - r[2] < 40).sort((a, b) => a.x - b.x)[0];
      cands.push({ page: i, rect: r, label: right ? right.str.trim() : labelLeft(r[0], r[1], r[3] - r[1]), kind: 'check', src: 'box' });
    }
    for (const l of H) {
      const [x1, x2, y] = l; const len = x2 - x1;
      if (len < 50 || len > W * 0.8) continue;
      // part of a table grid?
      if (Vt.some(v => (Math.abs(v[2] - x1) < 2 || Math.abs(v[2] - x2) < 2) && v[0] <= y + 2 && v[1] >= y - 2)) continue;
      // underline under text?
      if (items.some(it => it.x < x2 - 4 && it.x + it.w > x1 + 4 && it.y > y - 1 && it.y - y < 9 && it.str.replace(/[_\s]/g, ''))) continue;
      // stacked rules too close together (decoration)
      const above = items.filter(it => it.x < x2 && it.x + it.w > x1 && it.y > y && it.y - y < 40).map(it => it.y - y);
      const room = Math.min(18, above.length ? Math.max(8, Math.min(...above) - 4) : 18);
      cands.push({ page: i, rect: [x1, y + 0.8, x2, y + 0.8 + room], label: labelLeft(x1, y + 2, 10) || labelNear(x1, x2, y), src: 'line' });
    }
    // glyph check boxes
    for (const it of items) { const k = it.str.search(/[☐□❏]/); if (k >= 0) { const cw = it.w / it.str.length; const x = it.x + k * cw; cands.push({ page: i, rect: [x, it.y - it.h * 0.1, x + it.h * 0.85, it.y + it.h * 0.75], label: it.str.slice(k + 1).trim().split(/\s{2,}|[☐□❏]/)[0] || '', kind: 'check', src: 'glyph' }); } }
    // classify + dedupe
    const taken = existing.slice();
    for (const c of cands.sort((a, b) => (a.src === 'underscore' ? 0 : 1) - (b.src === 'underscore' ? 0 : 1))) {
      const r = normRect(c.rect); if (taken.some(t => rectsIntersect(t, [r[0] + 1, r[1] + 1, r[2] - 1, r[3] - 1]))) continue;
      taken.push(r);
      const lab = c.label || '';
      let kind = c.kind || 'text';
      if (kind === 'text') { if (/sign/i.test(lab)) { kind = 'signature'; r[3] = r[1] + Math.max(r[3] - r[1], 30); } else if (/\bdate\b|\bdob\b|birth/i.test(lab)) kind = 'date'; }
      out.push({ page: i, rect: r, label: lab, kind });
    }
  }
  // names
  const names = await allFieldNames(d); const used = new Set(names); let n = 1;
  for (const c of out) {
    let base = (c.label || '').replace(/[.:_]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || ({ check: 'Check Box', signature: 'Signature', date: 'Date' }[c.kind] || 'Text') + ' ' + (n++);
    let nm = base, k = 2; while (used.has(nm)) nm = `${base} ${k++}`; used.add(nm); c.name = nm;
    if (c.kind === 'date') c.dateFmt = DATE_FORMATS[0];
  }
  return out;
}
export async function autoDetectDialog() {
  const d = App.doc; if (!d || d.readOnly) return;
  Aero.busy('Looking for form fields…');
  let found; try { found = await detectFields(d); } catch (e) { console.warn(e); found = []; } finally { Aero.busy(); }
  if (!found.length) { Aero.alert('Detect form fields', 'No fill-in areas were found (blank lines, underscores or check-box squares). Draw fields with the Prepare Form tool instead.'); return; }
  const counts = {}; found.forEach(f => counts[f.kind] = (counts[f.kind] || 0) + 1);
  const html = `<div class="aero-list ff-detect" style="max-height:220px;border:1px solid #c5d5e8;margin-top:4px">${found.map((f, k) => `<label class="aero-item"><input type="checkbox" data-k="${k}" checked> <span class="grow">${esc(f.name)}</span><span class="dim">${TYPE_LABEL[f.kind]} · p.${f.page + 1}</span></label>`).join('')}</div>`;
  const dlg = Aero.dialog({
    title: 'Detect form fields', width: 520, instruction: `Found ${found.length} possible field${found.length > 1 ? 's' : ''}: ` + Object.entries(counts).map(([k, n]) => `${n} ${TYPE_LABEL[k].toLowerCase()}${n > 1 ? 's' : ''}`).join(', '),
    html, ok: 'Create Fields',
    onOK: async () => {
      const pick = found.filter((f, k) => dlg.el.querySelector(`[data-k="${k}"]`)?.checked);
      if (!pick.length) return;
      const ok = await addFields(pick, `Detect ${pick.length} form field${pick.length > 1 ? 's' : ''}`);
      if (ok) { Aero.toast(`Created ${pick.length} form field${pick.length > 1 ? 's' : ''} — review them with the Prepare Form tool`, 4500); if (App.tool !== 'formfield') setTool('formfield'); }
    }
  });
}

/* ---------- prepare-form tool UI ---------- */
async function drawFieldBoxes(i) {
  const d = App.doc, pv = V.views[i]; if (!d || !pv || App.tool !== 'formfield') return;
  const ws = await pageWidgets(d, i); if (App.tool !== 'formfield' || V.views[i] !== pv) return;
  pv.el.querySelector('.ff-layer')?.remove();
  const layer = document.createElement('div'); layer.className = 'ff-layer';
  for (const w of ws) {
    const p = rectPct(i, w.rect); const el = document.createElement('div');
    el.className = 'ff-box k-' + w.kind + (F.sel && F.sel.id === w.id ? ' sel' : ''); el.dataset.id = w.id; el.dataset.page = i;
    Object.assign(el.style, { left: p.left + '%', top: p.top + '%', width: p.width + '%', height: p.height + '%' });
    el.innerHTML = `<span class="ff-name">${esc(w.name)}${w.a.required ? ' *' : ''}</span>` + (F.sel && F.sel.id === w.id ? '<span class="ff-rs" data-rs="1"></span>' : '');
    el.title = `${TYPE_LABEL[w.kind] || w.kind}: ${w.name} — drag to move, double-click for properties, Delete to remove`;
    layer.appendChild(el);
  }
  pv.el.appendChild(layer);
}
function refreshBoxes() { document.querySelectorAll('.ff-layer').forEach(e => e.remove()); if (App.tool === 'formfield' && App.doc) for (const i of V.rendered) drawFieldBoxes(i); }
on('tool', t => { if (t !== 'formfield') { F.sel = null; } refreshBoxes(); });
on('rendered', i => { if (App.tool === 'formfield') drawFieldBoxes(i); });
on('docChanged', () => { if (App.tool === 'formfield') setTimeout(refreshBoxes, 60); });

async function widgetById(i, id) { return (await pageWidgets(App.doc, i)).find(w => w.id === id); }
document.getElementById('pages').addEventListener('pointerdown', async e => {
  const box = e.target.closest('.ff-box'); if (!box || App.tool !== 'formfield') return;
  e.preventDefault(); e.stopPropagation();
  const i = +box.dataset.page, id = box.dataset.id; const w = await widgetById(i, id); if (!w) return;
  const was = F.sel?.id === id; F.sel = { page: i, id, name: w.name };
  if (!was) { document.querySelectorAll('.ff-box.sel').forEach(b => { b.classList.remove('sel'); b.querySelector('.ff-rs')?.remove(); }); box.classList.add('sel'); box.insertAdjacentHTML('beforeend', '<span class="ff-rs" data-rs="1"></span>'); emit('ffsel'); }
  const resize = !!e.target.closest('[data-rs]');
  const sx = e.clientX, sy = e.clientY; const pv = V.views[i]; const pr = pv.el.getBoundingClientRect();
  const c1 = pdfToClient(i, w.rect[0], w.rect[1]), c2 = pdfToClient(i, w.rect[2], w.rect[3]);
  let Lc = Math.min(c1[0], c2[0]), R = Math.max(c1[0], c2[0]), T = Math.min(c1[1], c2[1]), B = Math.max(c1[1], c2[1]); const L0 = [Lc, R, T, B];
  let moved = false;
  const mv = ev => {
    const dx = ev.clientX - sx, dy = ev.clientY - sy; if (!moved && Math.hypot(dx, dy) < 3) return; moved = true;
    if (resize) { R = Math.max(L0[0] + 6, L0[1] + dx); B = Math.max(L0[2] + 6, L0[3] + dy); } else { Lc = L0[0] + dx; R = L0[1] + dx; T = L0[2] + dy; B = L0[3] + dy; }
    Object.assign(box.style, { left: (Lc - pr.left) / pr.width * 100 + '%', top: (T - pr.top) / pr.height * 100 + '%', width: (R - Lc) / pr.width * 100 + '%', height: (B - T) / pr.height * 100 + '%' });
  };
  const up = async () => {
    removeEventListener('pointermove', mv); removeEventListener('pointerup', up);
    if (!moved) return;
    const a = clientToPdf(i, Lc, T), b = clientToPdf(i, R, B);
    await moveWidget(id, normRect([a[0], a[1], b[0], b[1]]), w.name);
  };
  addEventListener('pointermove', mv); addEventListener('pointerup', up);
}, true);
document.getElementById('pages').addEventListener('dblclick', async e => {
  const box = e.target.closest('.ff-box'); if (!box || App.tool !== 'formfield') return;
  const w = await widgetById(+box.dataset.page, box.dataset.id); if (w) editFieldProps(w);
});
document.addEventListener('keydown', async e => {
  if (App.tool !== 'formfield' || !F.sel || !App.doc || e.target.matches?.('input,textarea,select') || document.querySelector('.aero-modal')) return;
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); const s = F.sel; F.sel = null; await deleteField(s.name, s.id); }
  else if (e.key === 'Enter') { e.preventDefault(); const w = await widgetById(F.sel.page, F.sel.id); if (w) editFieldProps(w); }
});

registerTool('formfield', {
  title: 'Prepare form: add fields', name: 'Prepare Form', key: 'F',
  icon: '<rect x="3" y="5" width="18" height="6" rx="1"/><rect x="3" y="14" width="5" height="5" rx="1"/><path d="M4.5 16.5l1.2 1.2 2-2.4M11 16.5h9"/>',
  hint: 'Drag on the page to add a field · drag a field to move it, its corner to resize · double-click for properties · Delete removes',
  controls: () => `<label>Field <select data-ff="type">${FIELD_TYPES.map(([k, l]) => `<option value="${k}"${F.type === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>` +
    `<button class="aero-btn" data-ff="detect">Auto-Detect Fields…</button>` + (F.sel ? `<span class="sep"></span><span class="tname" style="min-width:0">${esc(F.sel.name)}</span><button class="aero-btn" data-ff="props">Properties…</button><button class="aero-btn" data-ff="del">Delete</button>` : ''),
  down(e, i, pvEl, p0) {
    const inter = e.target; const sp = [e.clientX, e.clientY]; const pr = pvEl.getBoundingClientRect();
    const ghost = document.createElement('div'); ghost.className = 'ghost ff-ghost'; pvEl.appendChild(ghost);
    if (F.sel) { F.sel = null; document.querySelectorAll('.ff-box.sel').forEach(b => { b.classList.remove('sel'); b.querySelector('.ff-rs')?.remove(); }); emit('ffsel'); }
    const mv = ev => { const L0 = Math.min(sp[0], ev.clientX), T = Math.min(sp[1], ev.clientY); Object.assign(ghost.style, { left: (L0 - pr.left) / pr.width * 100 + '%', top: (T - pr.top) / pr.height * 100 + '%', width: Math.abs(ev.clientX - sp[0]) / pr.width * 100 + '%', height: Math.abs(ev.clientY - sp[1]) / pr.height * 100 + '%' }); };
    const up = ev => {
      inter.removeEventListener('pointermove', mv); inter.removeEventListener('pointerup', up); ghost.remove();
      const p1 = clientToPdf(i, ev.clientX, ev.clientY); let rect = normRect([p0[0], p0[1], p1[0], p1[1]]);
      if (Math.hypot(ev.clientX - sp[0], ev.clientY - sp[1]) < 6) { const [w, h] = DEF_SIZE[F.type]; rect = [p0[0], p0[1] - h / 2, p0[0] + w, p0[1] + h / 2]; }
      if (F.type === 'check' || F.type === 'radio') { const s = Math.max(10, Math.min(rect[2] - rect[0], rect[3] - rect[1])); rect = [rect[0], rect[1], rect[0] + s, rect[1] + s]; }
      newFieldAt(i, rect);
    };
    inter.addEventListener('pointermove', mv); inter.addEventListener('pointerup', up);
  }
});
const cmd = document.getElementById('cmd');
cmd.addEventListener('change', e => { if (e.target.dataset.ff === 'type') F.type = e.target.value; });
cmd.addEventListener('click', async e => {
  const a = e.target.closest('[data-ff]')?.dataset.ff; if (!a || e.target.tagName === 'SELECT') return;
  if (a === 'detect') autoDetectDialog();
  else if (a === 'props' && F.sel) { const w = await widgetById(F.sel.page, F.sel.id); if (w) editFieldProps(w); }
  else if (a === 'del' && F.sel) { const s = F.sel; F.sel = null; await deleteField(s.name, s.id); }
});
export { TYPE_LABEL as FIELD_LABEL, uniqueName };
