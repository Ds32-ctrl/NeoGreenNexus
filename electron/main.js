// electron/main.js
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const os = require('os');

let mainWindow = null;

// Canal IPC que entrega datos reales de hardware de la máquina al frontend
ipcMain.handle('ngn:get-system-telemetry', async () => {
    const cpus = os.cpus();
    const totalMemGB = (os.totalmem() / (1024 ** 3)).toFixed(1);
    const freeMemGB = (os.freemem() / (1024 ** 3)).toFixed(1);
    const usedMemGB = (totalMemGB - freeMemGB).toFixed(1);
    const memUsagePercent = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);

    return {
        hostname: os.hostname(),
        platform: `${os.type()} ${os.release()} (${os.arch()})`,
        cpuModel: cpus[0]?.model?.trim() || 'CPU x64',
        cpuCores: cpus.length,
        totalMemGB,
        usedMemGB,
        memUsagePercent,
        uptimeHours: (os.uptime() / 3600).toFixed(1)
    };
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1360,
        height: 860,
        minWidth: 1024,
        minHeight: 680,
        title: 'Nexus Core Desktop — NeoGreenNexus',
        backgroundColor: '#090d16',
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    // Carga directa de tu aplicación modular local
    mainWindow.loadFile(path.join(__dirname, '../public/index.html'));

    // Abrir enlaces externos (como GitHub) en el navegador predeterminado del sistema
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith('http')) {
            shell.openExternal(url);
            return { action: 'deny' };
        }
        return { action: 'allow' };
    });
}

app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});