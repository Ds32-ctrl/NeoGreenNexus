import { APP_VERSION } from './version.js';

export async function checkForAppUpdates() {
  // 1. Detección de entorno: Bloquear si es un navegador web estándar
    const isElectron = navigator.userAgent.toLowerCase().includes('electron');
    const isCapacitor = Boolean(window.Capacitor?.isNativePlatform?.() || window.Capacitor?.isNative);

  if (!isElectron && !isCapacitor) {
    console.debug('Ejecución en Web detectada. Omitiendo comprobación de actualizaciones.');
    return; // Aborta silenciosamente
  }

  // 2. Usar la versión inyectada automáticamente en la compilación
  const currentVersion = APP_VERSION;
  const GITHUB_REPO = 'Ds32-ctrl/NeoGreenNexus';
  
  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });

    if (!res.ok) return;

    const release = await res.json();
    const latestVersion = release.tag_name.replace(/^v/, ''); 

    // 3. Comprobar si realmente hay una actualización superior
    if (isNewerVersion(latestVersion, currentVersion)) {
      // Pasamos los indicadores de entorno para generar el enlace correcto
      showUpdateNotice(release, isCapacitor, isElectron);
    }
  } catch (err) {
    console.debug('No se pudo comprobar actualizaciones:', err.message);
  }
}

// Compara versiones semánticas (x.y.z)
function isNewerVersion(latest, current) {
  const v1 = latest.split('.').map(Number);
  const v2 = current.split('.').map(Number);
  for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
    const num1 = v1[i] || 0;
    const num2 = v2[i] || 0;
    if (num1 > num2) return true;
    if (num1 < num2) return false;
  }
  return false;
}

// Notificación visual en pantalla
function showUpdateNotice(release, isCapacitor, isElectron) {
  // 4. Asignación de enlace de descarga directo según plataforma
  let downloadLink = release.html_url; 
  
  if (isCapacitor) {
    // Descarga directa para la app móvil
    downloadLink = `https://github.com/Ds32-ctrl/NeoGreenNexus/releases/download/${release.tag_name}/ngn-360-home.apk`;
  } else if (isElectron) {
    // Descarga directa para la aplicación de escritorio
    downloadLink = `https://github.com/Ds32-ctrl/NeoGreenNexus/releases/download/${release.tag_name}/NexusCore-Setup.exe`;
  }

  const banner = document.createElement('div');
  banner.id = 'ngn-update-banner';
  banner.innerHTML = `
    <div style="
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: #1e1e24;
      color: #fff;
      padding: 14px 20px;
      border-radius: 12px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.4);
      z-index: 10000;
      display: flex;
      align-items: center;
      gap: 14px;
      font-size: 0.9rem;
      border: 1px solid rgba(255,255,255,0.1);
    ">
      <span>🚀 Hay una nueva versión disponible (<strong>${release.tag_name}</strong>)</span>
      <a href="${downloadLink}" target="_blank" style="
        background: #2563eb;
        color: white;
        padding: 6px 12px;
        border-radius: 6px;
        text-decoration: none;
        font-weight: 600;
      ">Actualizar</a>
      <button onclick="this.closest('#ngn-update-banner').remove()" style="
        background: transparent;
        border: none;
        color: #888;
        cursor: pointer;
        font-size: 1.1rem;
      ">&times;</button>
    </div>
  `;
  document.body.appendChild(banner);
}