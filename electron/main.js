const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Source-based main entry (no compiled main.jsc required).
const { registerDomainHandlers, setMainWindow } = require('./main/ipc');

const DIST_INDEX = path.join(__dirname, '..', 'dist', 'index.html');
const MEDIA_DIR = path.join(__dirname, '..', 'resources', 'videos');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(DIST_INDEX);
  setMainWindow(mainWindow);
  mainWindow.on('closed', () => { mainWindow = null; });
}

const fs = require('fs');
const SUPABASE_CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'supabase.json'), 'utf8'));

app.whenReady().then(() => {
  registerDomainHandlers({ getMediaDir: () => MEDIA_DIR });

  // Supabase config for renderer (user's own project)
  ipcMain.handle('maya-cloud-supabase-config', async () => ({ success: true, url: SUPABASE_CONFIG.url, anonKey: SUPABASE_CONFIG.anonKey }));

  // Minimal stubs for channels previously handled by compiled main.jsc
  ipcMain.handle('auth-get-stored', async () => null);
  ipcMain.handle('found-us:config', async () => null);
  ipcMain.handle('onboarding:step', async () => ({ success: true }));
  ipcMain.handle('close-window', async () => { if (mainWindow) mainWindow.close(); return { success: true }; });

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});