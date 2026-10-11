const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  openFile: filters => ipcRenderer.invoke('open-file', filters),
  readFile: p => ipcRenderer.invoke('read-file', p),
  saveDialog: opts => ipcRenderer.invoke('save-dialog', opts),
  writeFile: (p, data) => ipcRenderer.invoke('write-file', p, data),
  launchFile: () => ipcRenderer.invoke('launch-file'),
  onOpenFile: cb => ipcRenderer.on('open-path', (_e, p) => cb(p)),
  win: cmd => ipcRenderer.invoke('win', cmd),
  onWinState: cb => ipcRenderer.on('win-state', (_e, st) => cb(st)),
  pathForFile: f => { try { return webUtils.getPathForFile(f) || null; } catch { return null; } },
  apps: () => ipcRenderer.invoke('apps'),
  openApp: (id, pick) => ipcRenderer.invoke('open-app', id, pick)
});
