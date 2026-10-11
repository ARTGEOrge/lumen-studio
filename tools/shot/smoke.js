// Opens the app's sample through its own File menu, waits, and reports state.
const t0 = performance.now();
const errs = []; addEventListener('error', e => errs.push(String(e.message))); addEventListener('unhandledrejection', e => errs.push('rejection: ' + (e.reason?.message || e.reason)));
const file = [...document.querySelectorAll('.aero-menu')].find(m => m.firstChild.textContent.trim() === 'File');
if (!file) return JSON.stringify({ error: 'no File menu' });
file.click();
const item = [...document.querySelectorAll('.aero-mi')].find(i => /open sample/i.test(i.textContent));
if (!item) return JSON.stringify({ error: 'no Open Sample item', items: [...document.querySelectorAll('.aero-mi')].map(i => i.textContent).slice(0, 12) });
item.click();
// some apps confirm discarding the current doc
await new Promise(r => setTimeout(r, 400));
const pri = document.querySelector('.aero-modal:not(.aero-busy) .aero-btn.pri'); if (pri && /discard|don|ok|yes|open/i.test(pri.textContent)) pri.click();
for (let i = 0; i < 90 && document.querySelector('.aero-busy'); i++) await new Promise(r => setTimeout(r, 500));
await new Promise(r => setTimeout(r, +(window.__waitAfter || 2500)));
return JSON.stringify({ ms: Math.round(performance.now() - t0), title: document.title, menus: document.querySelectorAll('.aero-menu').length, tools: document.querySelectorAll('.aero-tool').length, busy: !!document.querySelector('.aero-busy'), modal: document.querySelector('.aero-modal h3')?.textContent || null, errs });
