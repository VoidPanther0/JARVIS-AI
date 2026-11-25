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

app.whenReady().then(() => {
  registerDomainHandlers({ getMediaDir: () => MEDIA_DIR });
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});