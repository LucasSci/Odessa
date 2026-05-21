import { contextBridge, ipcRenderer } from 'electron';

const desktopRuntime = {
  isElectron: true,
  canUseDirectWebCapture: true,
  canUseDesktopSources: true,
  apiOrigin: `http://127.0.0.1:${process.env.ODESSA_API_PORT || '8000'}`,
  platform: process.platform,
  version: process.versions.electron,
  renderer: 'electron',
  webviewTagEnabled: true,
};

const odessaDesktop = {
  ...desktopRuntime,
  getRuntimeStatus: () => ipcRenderer.invoke('odessa:runtime-status'),
  listCaptureSources: () => ipcRenderer.invoke('odessa:list-capture-sources'),
  openLogs: () => ipcRenderer.invoke('odessa:open-logs'),
  onBackendStatus: (callback: (status: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, status: unknown) => callback(status);
    ipcRenderer.on('odessa:backend-status', listener);
    return () => ipcRenderer.removeListener('odessa:backend-status', listener);
  },
};

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
});

contextBridge.exposeInMainWorld('odessaDesktop', odessaDesktop);
