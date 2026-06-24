// Main process — window lifecycle, font-folder bootstrap, and all IPC handlers.

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { scanFonts, appFontsDir, SCAN_VERSION } = require('./fonts');
const store = require('./store');
const { buildCss, buildJsonTokens } = require('./exporters');
const { extractLogoColors } = require('./logo');
const { fetchCatalog, downloadFamily, CACHE_MS } = require('./googlefonts');

let mainWindow = null;

// Phase 0 — ensure ~/NullBrandBuilder/fonts exists on first launch.
function ensureFontsFolder() {
  try {
    fs.mkdirSync(appFontsDir(), { recursive: true });
  } catch (err) {
    console.error('Could not create fonts folder:', err.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    backgroundColor: '#0f1115',
    title: 'Null Brand Builder',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });

  // Forward renderer console + crashes to the main stdout (helpful during dev).
  // Electron 36+ passes a single details object; older versions pass positional args.
  mainWindow.webContents.on('console-message', (a, b, c, d, e) => {
    let level, message, line, source;
    if (a && typeof a === 'object' && 'level' in a) {
      ({ level, message, lineNumber: line, sourceId: source } = a);
    } else {
      level = (['log', 'warning', 'error'][b] || 'log');
      message = c; line = d; source = e;
    }
    const sev = String(level).toLowerCase();
    if (sev === 'error' || sev === 'warning') {
      console.log(`[renderer:${sev}] ${message} (${source}:${line})`);
    }
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer gone]', details.reason);
  });
}

app.whenReady().then(() => {
  ensureFontsFolder();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---- IPC: Fonts ----------------------------------------------------------

ipcMain.handle('fonts:get', async (event, { force = false } = {}) => {
  const cached = store.get('fontCache');
  if (cached && !force && cached.version === SCAN_VERSION) return cached;

  const result = await scanFonts((done, total) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('fonts:progress', { done, total });
    }
  });
  store.set('fontCache', result);
  return result;
});

// ---- IPC: Logo -----------------------------------------------------------

ipcMain.handle('logo:pick', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a logo',
    properties: ['openFile'],
    filters: [{ name: 'Logo (PNG, SVG)', extensions: ['png', 'svg'] }],
  });
  if (canceled || !filePaths.length) return { ok: false, canceled: true };
  return extractLogoColors(filePaths[0]);
});

ipcMain.handle('logo:extract', (event, filePath) => extractLogoColors(filePath));

// ---- IPC: Google Fonts (Phase 4) -----------------------------------------

ipcMain.handle('gfonts:getKey', () => store.get('googleFontsApiKey') || '');
ipcMain.handle('gfonts:setKey', (event, key) => {
  store.set('googleFontsApiKey', (key || '').trim());
  return { ok: true };
});

ipcMain.handle('gfonts:catalog', async (event, { force = false } = {}) => {
  const cache = store.get('gfontsCache');
  if (cache && !force && Date.now() - cache.at < CACHE_MS) {
    return { ok: true, items: cache.items, cached: true };
  }
  const key = store.get('googleFontsApiKey');
  if (!key) return { ok: false, error: 'no-key' };
  try {
    const items = await fetchCatalog(key);
    store.set('gfontsCache', { at: Date.now(), items });
    return { ok: true, items };
  } catch (err) {
    // fall back to any stale cache so the panel still works offline-ish
    if (cache) return { ok: true, items: cache.items, stale: true };
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('gfonts:download', async (event, { family, files }) => {
  try {
    const written = await downloadFamily(family, files);
    if (!written.length) return { ok: false, error: 'No font files could be downloaded.' };
    const fonts = await scanFonts();
    store.set('fontCache', fonts);
    return { ok: true, written: written.length, fonts };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// Open an external https link in the user's default browser.
ipcMain.handle('open-external', (event, url) => {
  if (typeof url === 'string' && /^https:\/\//i.test(url)) shell.openExternal(url);
  return { ok: true };
});

// ---- IPC: Favorites ------------------------------------------------------

ipcMain.handle('favorites:get', () => store.get('favorites') || []);

ipcMain.handle('favorites:toggle', (event, family) => {
  const set = new Set(store.get('favorites') || []);
  if (set.has(family)) set.delete(family); else if (family) set.add(family);
  const arr = [...set];
  store.set('favorites', arr);
  return arr;
});

// ---- IPC: Brand kits -----------------------------------------------------

ipcMain.handle('kits:save', (event, { name, state }) => {
  if (!name || !name.trim()) return { ok: false, error: 'Kit needs a name.' };
  const kits = store.get('kits') || {};
  kits[name.trim()] = { ...state, name: name.trim(), savedAt: Date.now() };
  store.set('kits', kits);
  return { ok: true, names: Object.keys(kits) };
});

ipcMain.handle('kits:list', () => {
  const kits = store.get('kits') || {};
  return Object.values(kits)
    .map((k) => ({ name: k.name, savedAt: k.savedAt }))
    .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
});

ipcMain.handle('kits:load', (event, name) => {
  const kits = store.get('kits') || {};
  return kits[name] || null;
});

ipcMain.handle('kits:delete', (event, name) => {
  const kits = store.get('kits') || {};
  delete kits[name];
  store.set('kits', kits);
  return { ok: true, names: Object.keys(kits) };
});

ipcMain.handle('kits:rename', (event, { from, to }) => {
  const kits = store.get('kits') || {};
  if (!kits[from]) return { ok: false, error: 'Original kit not found.' };
  if (!to || !to.trim()) return { ok: false, error: 'New name is empty.' };
  kits[to.trim()] = { ...kits[from], name: to.trim() };
  if (to.trim() !== from) delete kits[from];
  store.set('kits', kits);
  return { ok: true, names: Object.keys(kits) };
});

// ---- IPC: Session autosave ----------------------------------------------

ipcMain.handle('session:save', (event, state) => {
  store.set('lastSession', state);
  return { ok: true };
});

ipcMain.handle('session:get', () => store.get('lastSession'));

// ---- IPC: Export ---------------------------------------------------------

async function saveTextDialog(defaultName, filters, text) {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters,
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  fs.writeFileSync(filePath, text, 'utf8');
  return { ok: true, filePath };
}

ipcMain.handle('export:css', async (event, state) => {
  const text = buildCss(state);
  const base = (state.name || 'brand-kit').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const res = await saveTextDialog(`${base}.css`, [{ name: 'CSS', extensions: ['css'] }], text);
  return { ...res, text };
});

ipcMain.handle('export:json', async (event, state) => {
  const text = buildJsonTokens(state);
  const base = (state.name || 'brand-kit').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const res = await saveTextDialog(`${base}.tokens.json`, [{ name: 'JSON', extensions: ['json'] }], text);
  return { ...res, text };
});

// Return generated text without a dialog (for clipboard / preview).
ipcMain.handle('export:preview', (event, { kind, state }) => {
  return kind === 'json' ? buildJsonTokens(state) : buildCss(state);
});

// PDF brand sheet — render the renderer-built HTML in a hidden window and printToPDF.
// Uses Electron's bundled Chromium (no Puppeteer dependency).
ipcMain.handle('export:pdf', async (event, { html, name }) => {
  const tmp = path.join(os.tmpdir(), `nbb-sheet-${Date.now()}.html`);
  let win = null;
  try {
    fs.writeFileSync(tmp, html, 'utf8');
    win = new BrowserWindow({
      show: false,
      webPreferences: { webSecurity: false, sandbox: false },
    });
    await win.loadFile(tmp);
    // Force every embedded @font-face to actually load before printing — document.fonts.ready
    // alone can resolve before file:// faces finish — then settle one frame.
    await win.webContents.executeJavaScript(
      '(async()=>{try{await Promise.all(Array.from(document.fonts).map(f=>f.load().catch(()=>{})));}catch(e){}await document.fonts.ready;await new Promise(r=>setTimeout(r,200));return true;})()'
    );
    const data = await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'Letter',
      margins: { marginType: 'none' },
    });
    const base = (name || 'brand-kit').toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${base}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, data);
    return { ok: true, filePath };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    if (win) win.destroy();
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
});
