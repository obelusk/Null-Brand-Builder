// Headless smoke test — boots the app's core on the current OS and asserts it functions.
// Run via: electron test/smoke.js   (on CI Linux: xvfb-run -a npm run test:smoke)
// Exits 0 on success, 1 on any failure.

const { app, BrowserWindow, ipcMain } = require('electron');

// CI hardening: Ubuntu 24.04 restricts unprivileged user namespaces, which breaks
// Chromium's sandbox under GitHub Actions. Disable it + GPU for headless runs.
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.disableHardwareAcceleration();

const path = require('path');
const fs = require('fs');
const os = require('os');
const { scanFonts } = require('../src/main/fonts');
const { extractLogoColors } = require('../src/main/logo');

const failures = [];
function check(cond, msg) {
  if (cond) { console.log('  ok  -', msg); } else { failures.push(msg); console.error('  FAIL-', msg); }
}

app.whenReady().then(async () => {
  try {
    // 1. Font engine — exercises fontkit's ESM dynamic import on this OS.
    const fonts = await scanFonts();
    check(fonts && typeof fonts.count === 'number', 'scanFonts() returns a categorized list');
    console.log('       scanned font families:', fonts && fonts.count);

    // 2. SVG color extraction — exercises svgson on this OS.
    const svgPath = path.join(os.tmpdir(), 'nbb-smoke.svg');
    fs.writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#0a7e8c"/><circle stroke="rgb(244,162,97)"/></svg>');
    const ex = await extractLogoColors(svgPath);
    check(ex.ok && ex.colors.includes('#0a7e8c') && ex.colors.includes('#f4a261'), 'svgson extracts SVG fill/stroke colors');

    // 3. Renderer boots and initializes (Chromium render + preload IPC).
    ipcMain.handle('fonts:get', () => fonts);
    ipcMain.handle('favorites:get', () => []);
    ipcMain.handle('session:get', () => null);
    ipcMain.handle('session:save', () => ({ ok: true }));
    ipcMain.handle('kits:list', () => []);
    ipcMain.handle('logo:extract', () => ({ ok: false }));
    ipcMain.handle('gfonts:getKey', () => '');

    const win = new BrowserWindow({
      show: false,
      webPreferences: { preload: path.join(__dirname, '..', 'src', 'preload', 'preload.js'), contextIsolation: true, sandbox: false },
    });
    let rendererError = null;
    win.webContents.on('console-message', (a, b, c) => {
      const lvl = (a && typeof a === 'object') ? a.level : b;
      const msg = (a && typeof a === 'object') ? a.message : c;
      if (String(lvl).toLowerCase().includes('error') || lvl >= 2) rendererError = msg;
    });
    await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'index.html'));
    await new Promise((r) => setTimeout(r, 2500));
    const initOk = await win.webContents.executeJavaScript(
      "(typeof buildBrandSheetHtml === 'function' && typeof state === 'object' && Object.keys(state.levels).length === 4)"
    ).catch((e) => { rendererError = e.message; return false; });
    check(initOk === true, 'renderer initialized (4 type levels + export builder present)');
    check(!rendererError, 'no renderer console errors' + (rendererError ? ` (${rendererError})` : ''));
    win.destroy();
  } catch (err) {
    failures.push('exception: ' + err.message);
    console.error('  EXCEPTION-', err.stack || err.message);
  }

  if (failures.length) { console.error(`\nSMOKE TEST FAILED (${failures.length})`); app.exit(1); }
  else { console.log('\nSMOKE TEST PASSED'); app.exit(0); }
});
