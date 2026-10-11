// Cancellable progress dialog (Vista-style green progress bar) used by OCR, compare and exports.
import { esc } from './util.js';

export function progressDialog(title, instruction = '') {
  let cancelled = false, closed = false; const listeners = [];
  const dlg = Aero.dialog({
    title, instruction, width: 460, noCancel: true, ok: 'Cancel',
    html: `<div class="prog"><div class="prog-bar"><div class="prog-fill"></div></div><div class="prog-text dim">Starting…</div></div>`,
    onOK: () => { if (closed) return; cancelled = true; closed = true; listeners.forEach(f => { try { f(); } catch (e) { /* ignore */ } }); }
  });
  const fill = dlg.el.querySelector('.prog-fill'), text = dlg.el.querySelector('.prog-text');
  return {
    get cancelled() { return cancelled; },
    onCancel(f) { listeners.push(f); },
    set(frac, msg) {
      if (closed) return;
      if (frac == null) fill.classList.add('indet'); else { fill.classList.remove('indet'); fill.style.width = Math.max(0, Math.min(100, frac * 100)).toFixed(1) + '%'; }
      if (msg != null) text.innerHTML = esc(msg);
    },
    close() { if (closed) return; closed = true; dlg.close(); }
  };
}
export class Cancelled extends Error { constructor() { super('Cancelled'); this.name = 'Cancelled'; } }
