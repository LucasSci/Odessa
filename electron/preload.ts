// Preload script — runs before renderer process
// You can expose safe APIs to the renderer here via contextBridge
// For now, this is a minimal placeholder.

import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  isElectron: true,
});
