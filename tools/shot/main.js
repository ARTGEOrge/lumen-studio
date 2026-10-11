// Headless screenshot + test runner for Lumen apps. Uses a hidden offscreen Electron window.
// env: SHOT_URL, SHOT_OUT (.png/.jpg, optional), SHOT_W, SHOT_H, SHOT_JS (file: async function body; return value printed), SHOT_WAIT (ms)
const { app, BrowserWindow } = require('electron');
const fs = require('fs'), path = require('path'), os = require('os');
app.setPath('userData', path.join(os.tmpdir(), 'lumen-shot-' + process.pid));
app.disableHardwareAcceleration && false;
const E = process.env, W = +(E.SHOT_W || 1400), H = +(E.SHOT_H || 860);
const out = s => process.stdout.write(s + '\n');
process.on('uncaughtException', e => { out('RUNNER ERROR ' + e.stack); app.exit(2); });
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, enableLargerThanScreen: true, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.webContents.setFrameRate(30);
  win.setContentSize(W, H);   // offscreen windows may be clamped to the display size otherwise
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
  win.webContents.on('console-message', e => {
    const lvl = e.level, msg = String(e.message);
    if ((lvl === 'warning' || lvl === 'error') && !/Electron Security Warning/.test(msg)) out(`[page ${lvl}] ${msg} (${String(e.sourceId || '').split('/').pop()}:${e.lineNumber})`);
  });
  win.webContents.on('render-process-gone', (e, d) => out('RENDERER GONE ' + JSON.stringify(d)));
  const timer = setTimeout(() => { out('TIMEOUT'); app.exit(3); }, +(E.SHOT_TIMEOUT || 90000));
  await win.loadURL(E.SHOT_URL);
  await new Promise(r => setTimeout(r, +(E.SHOT_WAIT || 1200)));
  if (E.SHOT_JS) {
    const body = fs.readFileSync(E.SHOT_JS, 'utf8');
    try { const r = await win.webContents.executeJavaScript(`(async()=>{${body}\n})()`); if (r !== undefined) out('RESULT ' + (typeof r === 'string' ? r : JSON.stringify(r))); }
    catch (e) { out('JS ERROR ' + e.message); }
    await new Promise(r => setTimeout(r, 600));
  }
  if (E.SHOT_OUT) {
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: W, height: H });
    fs.writeFileSync(E.SHOT_OUT, /\.jpe?g$/i.test(E.SHOT_OUT) ? img.toJPEG(88) : img.toPNG());
    out('SHOT ' + E.SHOT_OUT + ' ' + JSON.stringify(img.getSize()));
  }
  clearTimeout(timer); app.exit(0);
});
