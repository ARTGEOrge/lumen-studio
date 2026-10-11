// Lumen Studio desktop suite: one Electron app hosting every Lumen app, with a launcher window.
const { app, BrowserWindow, Menu, protocol, dialog, ipcMain, session } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os');

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const ROOT = path.join(__dirname, 'apps');                       // copy of lumen-studio (kit + each app) — see scripts/sync.js
const ALL_APPS = JSON.parse(fs.readFileSync(path.join(__dirname, 'apps.json'), 'utf8'));
// Single-app builds (e.g. "Lumen Vector" on its own) ship single.json = { "id": "vector" }: no launcher, open that app directly.
const SINGLE = fs.existsSync(path.join(__dirname, 'single.json')) ? JSON.parse(fs.readFileSync(path.join(__dirname, 'single.json'), 'utf8')).id : null;
const APPS = SINGLE ? ALL_APPS.filter(a => a.id === SINGLE) : ALL_APPS;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.bcmap': 'application/octet-stream', '.pfb': 'application/octet-stream' };
const HIDDEN = process.env.LUMEN_TEST_HIDDEN === '1';   // automated tests: never show windows
const glass = process.platform === 'win32' && +os.release().split('.')[2] >= 22621;

// The renderer may only read/write files the user picked (dialogs, Open With, command line)
const allowRead = new Set(), allowWrite = new Set();
const allow = (p, w) => { if (!p) return p; const n = path.resolve(p).toLowerCase(); allowRead.add(n); if (w) allowWrite.add(n); return p; };
const allowed = (set, p) => typeof p === 'string' && set.has(path.resolve(p).toLowerCase());
const pending = new Map();      // webContents.id -> file path to open on launch
const wins = new Map();         // webContents.id -> { win, force }

if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('temp'), 'lumen-studio-dev'));
const fileArgs = argv => argv.slice(app.isPackaged ? 1 : 2).filter(a => !a.startsWith('-') && a !== '.' && fs.existsSync(a) && fs.statSync(a).isFile());
const appForFile = f => { const ext = path.extname(f).slice(1).toLowerCase(); return (APPS.find(a => a.ext.includes(ext)) || APPS[0]).id; };

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', (_e, argv) => {
    const files = fileArgs(argv);
    if (files.length) files.forEach(f => openApp(appForFile(f), allow(f, true)));
    else if (SINGLE) { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } else openApp(SINGLE); }
    else focusOrCreateLauncher();
  });
  app.whenReady().then(() => {
    protocol.handle('app', async req => {
      const file = path.normalize(path.join(ROOT, decodeURIComponent(new URL(req.url).pathname)));
      if (!file.startsWith(ROOT)) return new Response('Forbidden', { status: 403 });
      try {
        let f = file; if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
        const body = await fs.promises.readFile(f);
        return new Response(body, { headers: { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-cache' } });
      } catch { return new Response('Not found', { status: 404 }); }
    });
    // microphone for Lumen Sound recording and clipboard for paste — only for our own pages
    const ok = ['media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'];
    session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(String(details.requestingUrl || wc.getURL()).startsWith('app://lumen/') && ok.includes(perm)));
    session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => String(origin || '').startsWith('app://lumen') && ok.includes(perm));
    Menu.setApplicationMenu(null);
    const files = fileArgs(process.argv);
    if (files.length) files.forEach(f => openApp(appForFile(f), allow(f, true)));
    else if (SINGLE) openApp(SINGLE);
    else createLauncher();
  });
  app.on('window-all-closed', () => app.quit());
}

function baseWindow(opts) {
  const win = new BrowserWindow({
    show: false, frame: false, minWidth: 760, minHeight: 520,
    backgroundColor: glass ? '#00000000' : '#2a5a7a', ...(glass ? { backgroundMaterial: 'acrylic' } : {}),
    icon: path.join(__dirname, 'build', SINGLE ? path.join('icons', SINGLE + '.png') : 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
    ...opts
  });
  const id = win.webContents.id; wins.set(id, { win, force: false });
  const sendState = () => { if (!win.isDestroyed()) win.webContents.send('win-state', { maximized: win.isMaximized(), focused: win.isFocused() }); };
  ['maximize', 'unmaximize', 'focus', 'blur', 'restore'].forEach(ev => win.on(ev, sendState));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://lumen/')) e.preventDefault(); });
  win.on('close', async e => {
    const st = wins.get(id); if (!st || st.force) return;
    e.preventDefault();
    let dirty = false;
    try { dirty = await win.webContents.executeJavaScript('window.__lumenDirty === true'); } catch { }
    if (!dirty) { st.force = true; return win.close(); }
    const { response } = await dialog.showMessageBox(win, { type: 'question', buttons: ['Save', 'Don’t Save', 'Cancel'], defaultId: 0, cancelId: 2, title: win.getTitle(), message: 'Save changes before closing?' });
    if (response === 2) return;
    if (response === 0) { const saved = await win.webContents.executeJavaScript('window.lumenSaveBeforeClose ? window.lumenSaveBeforeClose() : true'); if (!saved) return; }
    st.force = true; win.close();
  });
  win.on('closed', () => { wins.delete(id); pending.delete(id); });
  return win;
}
let launcher = null;
function createLauncher() {
  launcher = baseWindow({ width: 1000, height: 680, minWidth: 640, minHeight: 460, title: 'Lumen Studio' });
  launcher.loadURL('app://lumen/launcher/index.html');
  launcher.once('ready-to-show', () => { if (!HIDDEN) launcher.show(); });
  launcher.on('closed', () => { launcher = null; });
}
function focusOrCreateLauncher() { if (launcher) { if (launcher.isMinimized()) launcher.restore(); launcher.focus(); } else createLauncher(); }
function openApp(id, file) {
  const meta = APPS.find(a => a.id === id); if (!meta) return;
  const win = baseWindow({ width: 1480, height: 940, title: meta.name });
  if (file) pending.set(win.webContents.id, file);
  win.loadURL(`app://lumen/${id}/index.html`);
  win.once('ready-to-show', () => { if (!HIDDEN) { win.maximize(); win.show(); } });
}

const fromEvent = e => BrowserWindow.fromWebContents(e.sender);
const readAsPayload = async p => ({ name: path.basename(p), path: p, data: new Uint8Array(await fs.promises.readFile(p)) });
ipcMain.handle('open-file', async (e, filters) => {
  const r = await dialog.showOpenDialog(fromEvent(e), { properties: ['openFile'], filters });
  return r.canceled || !r.filePaths[0] ? null : readAsPayload(allow(r.filePaths[0], true));
});
ipcMain.handle('read-file', (_e, p) => { if (!allowed(allowRead, p)) throw new Error('not permitted'); return readAsPayload(p); });
ipcMain.handle('save-dialog', async (e, opts) => { const r = await dialog.showSaveDialog(fromEvent(e), opts); return r.canceled ? null : allow(r.filePath, true); });
ipcMain.handle('write-file', (_e, p, data) => { if (!allowed(allowWrite, p)) throw new Error('not permitted'); return fs.promises.writeFile(p, Buffer.from(data)); });
ipcMain.handle('launch-file', e => { const f = pending.get(e.sender.id) || null; pending.delete(e.sender.id); return f; });
ipcMain.handle('win', (e, cmd) => {
  const win = fromEvent(e);
  if (cmd === 'min') win.minimize();
  else if (cmd === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (cmd === 'close') win.close();
  return { maximized: win.isMaximized(), focused: win.isFocused(), glass };
});
ipcMain.handle('apps', () => APPS.map(a => ({ ...a, available: fs.existsSync(path.join(ROOT, a.id, 'index.html')) })));
ipcMain.handle('open-app', async (e, id, pick) => {
  const meta = APPS.find(a => a.id === id); if (!meta) return;
  if (pick) {
    const r = await dialog.showOpenDialog(fromEvent(e), { properties: ['openFile'], filters: [{ name: meta.name, extensions: meta.ext }, { name: 'All files', extensions: ['*'] }] });
    if (r.canceled || !r.filePaths[0]) return;
    return openApp(id, allow(r.filePaths[0], true));
  }
  openApp(id);
});
