// Headless check that every menu command (except ones that open native file dialogs) runs without errors.
const A = MapApp, wait = ms => new Promise(r => setTimeout(r, ms)), errors = [], done = [];
window.addEventListener('error', e => errors.push(e.message));
const origErr = console.error; console.error = (...a) => { errors.push(a.map(String).join(' ')); origErr(...a); };
const skip = /^(Open project|Save|Save as|Add data|GeoJSON|Shapefile|CSV|KML|Map as SVG|Map as PNG)/;
const menus = [...document.querySelectorAll('.aero-menubar .aero-menu')];
const closeAll = async (ok) => { for (let k = 0; k < 4; k++) { const pl = document.getElementById('plClose'); if (pl) { pl.click(); await wait(30); } const m = document.querySelector('.aero-modal:not(.aero-busy)'); if (!m) break; const b = m.querySelector(ok ? '.aero-btn.pri' : '.aero-btn[data-a="c"]') || m.querySelector('.aero-btn.pri'); b.click(); await wait(60); } for (let i = 0; i < 100 && document.querySelector('.aero-busy'); i++) await wait(50); };
A.active = A.doc.layers.find(l => l.name === 'Towns').id; A.selectAll();
for (const m of menus) {
  m.click(); await wait(20);
  const labels = [...m.querySelectorAll('.aero-mi')].map(x => x.querySelector('span').textContent);
  document.body.click(); await wait(10);
  for (const lab of labels) {
    if (skip.test(lab)) continue;
    m.click(); await wait(15);
    const it = [...m.querySelectorAll('.aero-mi')].find(x => x.querySelector('span').textContent === lab);
    if (!it || it.classList.contains('disabled')) { document.body.click(); continue; }
    const before = errors.length; it.click(); await wait(120);
    await closeAll(/Rename|Map title|New layer|Buffer|Dissolve|Centroids|Duplicate/.test(lab)); await wait(30);
    done.push(m.firstChild.textContent + ' › ' + lab + (errors.length > before ? ' ✕ ' + errors.slice(before).join(' | ') : ''));
    if (/New map|Open sample/.test(lab)) { Aero.setDirty(false); await wait(200); A.active = A.doc.layers[0] && A.doc.layers[0].id; }
  }
}
return JSON.stringify({ commands: done.length, errors, failed: done.filter(d => d.includes('✕')), list: done.join('\n') }, null, 1);
