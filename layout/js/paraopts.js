'use strict';
/* Lumen Layout — paragraph Keep Options (keep with next, keep lines together / orphans & widows, start in
   next column or frame) and Paragraph Rules (rule above / below), as dialogs for the selected paragraphs and
   as extra fields for the Paragraph Style dialog. The composition itself lives in layout.js. */
const ParaOpts = (() => {
  const START = [['', 'Anywhere'], ['column', 'In next column'], ['frame', 'In next frame']];
  const MODES = [['', 'None'], ['column', 'Column width'], ['text', 'Text width']];
  const cur = () => UI.charState()?.pe || null;
  function keepFields(pe) {
    return [
      { key: 'keepNext', label: 'Keep with next (lines, 0 = off)', type: 'number', value: pe.keepNext | 0, min: 0, max: 9, step: 1 },
      { key: 'keepAll', label: 'Keep all lines of the paragraph together', type: 'checkbox', value: !!pe.keepAll },
      { key: 'keepStart', label: 'Keep first lines together (orphans, 0 = off)', type: 'number', value: pe.keepStart | 0, min: 0, max: 9, step: 1 },
      { key: 'keepEnd', label: 'Keep last lines together (widows, 0 = off)', type: 'number', value: pe.keepEnd | 0, min: 0, max: 9, step: 1 },
      { key: 'startOn', label: 'Start paragraph', type: 'select', value: pe.startOn || '', options: START },
    ];
  }
  function readKeep(v) {
    const n = x => Math.max(0, Math.min(9, Math.round(+x || 0)));
    return { keepNext: n(v.keepNext), keepAll: !!v.keepAll, keepStart: n(v.keepStart), keepEnd: n(v.keepEnd), startOn: START.some(s => s[0] === v.startOn) ? v.startOn : '' };
  }
  function ruleFields(pe, pre = '') {
    const f = (which, r, name) => [
      { key: pre + which + 'mode', label: name, type: 'select', value: r ? r.mode || 'column' : '', options: MODES },
      { key: pre + which + 'w', label: `${name}: weight (pt)`, type: 'number', value: r ? +r.w : 1, min: 0.1, max: 72, step: 0.25 },
      { key: pre + which + 'color', label: `${name}: color`, type: 'color', value: (r && Color.hex(r.color)) || '#1a1a1a' },
      { key: pre + which + 'off', label: `${name}: offset (pt)`, type: 'number', value: r ? +r.off || 0 : which === 'A' ? 10 : 4, step: 0.5 },
      ...(pre ? [] : [{ key: which + 'indL', label: `${name}: left indent (pt)`, type: 'number', value: r ? +r.indL || 0 : 0, step: 1 }, { key: which + 'indR', label: `${name}: right indent (pt)`, type: 'number', value: r ? +r.indR || 0 : 0, step: 1 }]),
    ];
    return [...f('A', pe.ruleA, 'Rule above'), ...f('B', pe.ruleB, 'Rule below')];
  }
  // keeps an existing swatch reference when the picker still shows its color
  function readRules(v, pe, pre = '') {
    const r = (which, old) => {
      const mode = v[pre + which + 'mode']; if (!mode) return false;
      const hex = v[pre + which + 'color'], color = old && Color.hex(old.color) === hex ? old.color : Color.fromPicker(hex);
      return M.sanitizeRule({ mode, w: v[pre + which + 'w'], color, off: v[pre + which + 'off'], indL: v[which + 'indL'] ?? old?.indL ?? 0, indR: v[which + 'indR'] ?? old?.indR ?? 0 });
    };
    return { ruleA: r('A', pe.ruleA), ruleB: r('B', pe.ruleB) };
  }
  function keepDialog() {
    const pe = cur(); if (!pe) { Aero.toast('Place the text cursor in a paragraph or select a text frame'); return; }
    Aero.dialog({ title: 'Keep Options', instruction: 'Control where the selected paragraphs may break across columns and frames', fields: keepFields(pe), width: 470,
      onOK: v => UI.applyPara(readKeep(v), 'Keep Options') });
  }
  function rulesDialog() {
    const pe = cur(); if (!pe) { Aero.toast('Place the text cursor in a paragraph or select a text frame'); return; }
    Aero.dialog({ title: 'Paragraph Rules', instruction: 'Rules above the first line and below the last line of the selected paragraphs (offsets are measured from the baseline)', fields: ruleFields(pe), width: 470,
      onOK: v => UI.applyPara(readRules(v, pe), 'Paragraph Rules') });
  }
  return { keepDialog, rulesDialog, keepFields, readKeep, ruleFields, readRules };
})();
