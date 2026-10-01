// Ponte mínima entre a interface do Odessa e o programa (ver src/core/desktopBridge.ts).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('odessaDesktop', {
  isDesktop: true,
  shutdown: () => ipcRenderer.invoke('odessa:shutdown'),
  hideToTray: () => ipcRenderer.send('odessa:hide'),
});
