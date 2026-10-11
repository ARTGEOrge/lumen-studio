const { app, BrowserWindow, Menu, protocol, dialog, ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');

// The app is served from app://lumen/ so it is cross-origin isolated (needed by the threaded RAW decoder).
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const SRC = path.join(__dirname, 'src');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
let win = null, pendingFile = null, forceClose = false, glass = false;
// The renderer may only read/write files the user picked (dialogs, Open With, command line)
const allowRead = new Set(), allowWrite = new Set();
const allow = (p, w) => { if (!p) return p; const n = path.resolve(p).toLowerCase(); allowRead.add(n); if (w) allowWrite.add(n); return p; };
const allowed = (set, p) => typeof p === 'string' && set.has(path.resolve(p).toLowerCase());

const fileArg = argv => argv.slice(app.isPackaged ? 1 : 2).find(a => !a.startsWith('-') && a !== '.' && fs.existsSync(a) && fs.statSync(a).isFile());

// Dev runs (npm start) use their own profile so they never collide with an installed copy
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('temp'), 'lumen-photo-dev'));
if (!app.requestSingleInstanceLock()) app.quit();
else {
  pendingFile = allow(fileArg(process.argv) || null, true);
  app.on('second-instance', (_e, argv) => {
    const f = allow(fileArg(argv), true);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); if (f) win.webContents.send('open-path', f); }
  });
  app.whenReady().then(() => {
    protocol.handle('app', async req => {
      const file = path.normalize(path.join(SRC, decodeURIComponent(new URL(req.url).pathname)));
      if (!file.startsWith(SRC)) return new Response('Forbidden', { status: 403 });
      try {
        const body = await fs.promises.readFile(file);
        return new Response(body, { headers: { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-cache' } });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    createWindow();
  });
  app.on('window-all-closed', () => app.quit());
}

function createWindow() {
  // Aero look: frameless window drawn by the app. On Windows 11 22H2+ the glass shows the real blurred desktop (acrylic).
  glass = process.platform === 'win32' && +os.release().split('.')[2] >= 22621;
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 980, minHeight: 640, show: false, frame: false,
    backgroundColor: glass ? '#00000000' : '#2a5a7a', ...(glass ? { backgroundMaterial: 'acrylic' } : {}),
    title: 'Lumen Photo', icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true }
  });
  const sendState = () => win.webContents.send('win-state', { maximized: win.isMaximized(), focused: win.isFocused() });
  ['maximize', 'unmaximize', 'focus', 'blur', 'restore'].forEach(ev => win.on(ev, sendState));
  Menu.setApplicationMenu(null); // the app draws its own menu bar
  win.loadURL('app://lumen/index.html');
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.on('close', async e => {
    if (forceClose) return;
    e.preventDefault();
    let dirty = false;
    try { dirty = await win.webContents.executeJavaScript('window.__lumenDirty === true'); } catch { }
    if (!dirty) { forceClose = true; return win.close(); }
    const { response } = await dialog.showMessageBox(win, { type: 'question', buttons: ['Save', "Don't Save", 'Cancel'], defaultId: 0, cancelId: 2, title: 'Lumen Photo', message: 'Save changes to this document before closing?' });
    if (response === 2) return;
    if (response === 0) { const ok = await win.webContents.executeJavaScript('window.lumenSaveBeforeClose()'); if (!ok) return; }
    forceClose = true; win.close();
  });
}

const readAsPayload = async p => ({ name: path.basename(p), path: p, data: new Uint8Array(await fs.promises.readFile(p)) });
ipcMain.handle('open-file', async (_e, filters) => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters });
  return r.canceled || !r.filePaths[0] ? null : readAsPayload(allow(r.filePaths[0], true));
});
ipcMain.handle('read-file', (_e, p) => { if (!allowed(allowRead, p)) throw new Error('not permitted'); return readAsPayload(p); });
ipcMain.handle('save-dialog', async (_e, opts) => { const r = await dialog.showSaveDialog(win, opts); return r.canceled ? null : allow(r.filePath, true); });
ipcMain.handle('write-file', (_e, p, data) => { if (!allowed(allowWrite, p)) throw new Error('not permitted'); return fs.promises.writeFile(p, Buffer.from(data)); });
ipcMain.handle('win', (_e, cmd) => {
  if (cmd === 'min') win.minimize();
  else if (cmd === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (cmd === 'close') win.close();
  return { maximized: win.isMaximized(), focused: win.isFocused(), glass };
});
ipcMain.handle('launch-file', () => { const f = pendingFile; pendingFile = null; return f; });
