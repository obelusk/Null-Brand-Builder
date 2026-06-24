// Secure IPC bridge. Renderer never touches Node directly — only this whitelist.

const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Fonts
  getFonts: (opts) => ipcRenderer.invoke('fonts:get', opts || {}),
  onScanProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('fonts:progress', handler);
    return () => ipcRenderer.removeListener('fonts:progress', handler);
  },

  // Google Fonts (Phase 4)
  gfGetKey: () => ipcRenderer.invoke('gfonts:getKey'),
  gfSetKey: (key) => ipcRenderer.invoke('gfonts:setKey', key),
  gfCatalog: (opts) => ipcRenderer.invoke('gfonts:catalog', opts || {}),
  gfDownload: (family, files) => ipcRenderer.invoke('gfonts:download', { family, files }),

  openExternal: (url) => ipcRenderer.invoke('open-external', url),

  // Favorites
  getFavorites: () => ipcRenderer.invoke('favorites:get'),
  toggleFavorite: (family) => ipcRenderer.invoke('favorites:toggle', family),

  // Brand kits
  saveKit: (name, state) => ipcRenderer.invoke('kits:save', { name, state }),
  listKits: () => ipcRenderer.invoke('kits:list'),
  loadKit: (name) => ipcRenderer.invoke('kits:load', name),
  deleteKit: (name) => ipcRenderer.invoke('kits:delete', name),
  renameKit: (from, to) => ipcRenderer.invoke('kits:rename', { from, to }),

  // Session autosave
  saveSession: (state) => ipcRenderer.invoke('session:save', state),
  getSession: () => ipcRenderer.invoke('session:get'),

  // Logo
  pickLogo: () => ipcRenderer.invoke('logo:pick'),
  extractLogo: (filePath) => ipcRenderer.invoke('logo:extract', filePath),
  // Resolve a dropped/selected File to its absolute path (Electron-only API).
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // Export
  exportCss: (state) => ipcRenderer.invoke('export:css', state),
  exportJson: (state) => ipcRenderer.invoke('export:json', state),
  previewExport: (kind, state) => ipcRenderer.invoke('export:preview', { kind, state }),
  exportPdf: (html, name) => ipcRenderer.invoke('export:pdf', { html, name }),
});
