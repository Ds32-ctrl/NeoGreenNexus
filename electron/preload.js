// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('nexusDesktop', {
    isDesktopApp: true,
    getSystemTelemetry: () => ipcRenderer.invoke('ngn:get-system-telemetry')
});