// Необов'язкова обгортка Electron: перетворює SE Офіс на справжню програму з іконкою (інсталятор .exe / .dmg).
// Запуск для перевірки: npm install && npm run desktop. Збірка інсталятора: npm run dist
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
process.env.NO_OPEN = '1';
process.env.PORT = process.env.PORT || '3000';
process.env.DATA_DIR = path.join(app.getPath('userData'), 'data'); // ключі лежать у профілі користувача
require('../server.js');
function win() {
  const w = new BrowserWindow({ width: 1100, height: 800, title: 'SE Офіс', autoHideMenuBar: true });
  w.loadURL('http://localhost:' + process.env.PORT);
  w.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}
app.whenReady().then(() => { setTimeout(win, 400); });
app.on('window-all-closed', () => app.quit());
