// Headless smoke test: clicks every menu item (with something selected) and fails on any uncaught error.
const errors = [], done = [];
addEventListener('error', e => errors.push(String(e.message)));
addEventListener('unhandledrejection', e => errors.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
const origErr = console.error; console.error = (...a) => { errors.push('console: ' + a.join(' ')); origErr(...a); };
const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
const A = DiaApp;
// file pickers would block: skip them (they are exercised by ui.shot.js through DiaUI.openFiles)
const SKIP = /^(Open…|draw\.io file as new pages…|Image…)$/;
const closeModals = async () => { for (let k = 0; k < 5; k++) { const m = document.querySelector('.aero-modal:not(.aero-busy)'); if (!m) break; const b = m.querySelector('[data-a=c]') || m.querySelector('[data-a=o]'); b.click(); await frame(); } };
const menus = [...document.querySelectorAll('.aero-menu')];
for (const m of menus) {
  m.click(); await frame();
  const labels = [...m.querySelectorAll('.aero-mi')].map(mi => mi.querySelector('span').textContent);
  document.body.click(); await frame();
  for (const label of labels) {
    if (SKIP.test(label)) continue;
    // keep a non-trivial selection around so that arrange/style items have something to act on
    if (A.page().cells.length < 3) { A.load(DiaSample.sampleDoc(), 'Sample'); await frame(); }
    const shapes = A.page().cells.filter(c => c.kind === 'shape' && !DiaShapes.get(c.shape).container).slice(0, 3);
    A.select(shapes.map(c => c.id).concat(A.page().cells.filter(c => c.kind === 'edge').slice(0, 1).map(c => c.id)));
    m.click(); await frame();
    const mi = [...m.querySelectorAll('.aero-mi')].find(x => x.querySelector('span').textContent === label);
    if (!mi || mi.classList.contains('disabled')) { document.body.click(); continue; }
    try { mi.click(); } catch (e) { errors.push(label + ': ' + e.message); }
    await frame(); await new Promise(r => setTimeout(r, 30));
    await closeModals(); if (A.isEditing()) A.commitText();
    done.push(m.firstChild.textContent + '›' + label);
  }
}
// keyboard shortcuts through the real key handler
const keys = [['z', { ctrlKey: true }], ['y', { ctrlKey: true }], ['a', { ctrlKey: true }], ['c', { ctrlKey: true }], ['v', { ctrlKey: true }], ['g', { ctrlKey: true }], ['G', { ctrlKey: true, shiftKey: true }], ['ArrowRight', {}], ['ArrowDown', { shiftKey: true }], ['Delete', {}], ['=', { ctrlKey: true }], ['0', { ctrlKey: true }], ['Escape', {}]];
for (const [k, o] of keys) { document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o })); await frame(); await closeModals(); }
return JSON.stringify({ clicked: done.length, errors, sample: done.slice(0, 6), undoSteps: A.hist.items.length });
