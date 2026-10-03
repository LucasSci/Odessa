// Ponte mínima entre a interface do Odessa e o programa (ver src/core/desktopBridge.ts).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('odessaDesktop', {
  isDesktop: true,
  shutdown: () => ipcRenderer.invoke('odessa:shutdown'),
  hideToTray: () => ipcRenderer.send('odessa:hide'),
  // Janela minimizada/na bandeja: a página não percebe sozinha (ver
  // src/core/windowVisibility.ts), então o programa avisa.
  onWindowVisibility: (callback) => {
    ipcRenderer.on('odessa:window-visibility', (_event, visible) => callback(Boolean(visible)));
  },
});
