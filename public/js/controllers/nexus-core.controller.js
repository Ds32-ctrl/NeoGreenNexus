// public/js/controllers/nexus-core.controller.js
import { showToast } from '../ui/toast.js';

const VAULT_STORAGE_KEY = 'ngn_aes_vault_v1';
let telemetryInterval = null;

function escapeHTML(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export async function initNexusCore() {
    detectOSAndConfigureInstaller();
    await startHardwareTelemetry();
    bindVaultEvents();
    renderVaultItems();
}

function detectOSAndConfigureInstaller() {
    const labelEl = document.getElementById('desktopDownloadLabel');
    const linkEl = document.getElementById('btnDownloadDesktop');
    const ua = navigator.userAgent.toLowerCase();

    if (labelEl && linkEl) {
        if (ua.includes('mac')) {
            labelEl.textContent = 'Descargar Nexus Core para macOS (.dmg)';
            linkEl.setAttribute('href', '/assets/NexusCore-Installer.dmg');
        } else if (ua.includes('linux')) {
            labelEl.textContent = 'Descargar Nexus Core para Linux (.AppImage)';
            linkEl.setAttribute('href', '/assets/NexusCore.AppImage');
        } else {
            labelEl.textContent = 'Descargar Nexus Core para Windows (.exe)';
            linkEl.setAttribute('href', '/assets/NexusCore-Setup.exe');
        }
    }

    const btnInstallPWA = document.getElementById('btnInstallPWA');
    if (btnInstallPWA) {
        btnInstallPWA.addEventListener('click', () => {
            showToast('En Chrome/Edge/Brave: haz clic en el icono "Instalar NeoGreenNexus" en la barra de direcciones para ejecutarlo como App nativa.', 'info');
        });
    }
}

async function startHardwareTelemetry() {
    if (telemetryInterval) clearInterval(telemetryInterval);

    const updateMetrics = async () => {
        const cpuEl = document.getElementById('coreCpuCores');
        const platEl = document.getElementById('corePlatformName');
        const ramEl = document.getElementById('coreRamUsage');
        const heapEl = document.getElementById('coreHeapDetail');
        const storageEl = document.getElementById('coreStorageQuota');
        const batEl = document.getElementById('coreBatteryStatus');
        const netEl = document.getElementById('coreNetworkPing');
        const speedEl = document.getElementById('coreNetworkSpeed');

        if (!cpuEl) {
            clearInterval(telemetryInterval);
            return;
        }

        // 1. CPU & Arquitectura
        const cores = navigator.hardwareConcurrency || 4;
        cpuEl.textContent = `${cores} Hilos`;
        if (platEl) platEl.textContent = navigator.platform || 'Arquitectura x64/ARM';

        // 2. RAM del Dispositivo y JS Heap en vivo
        const approxRam = navigator.deviceMemory ? `${navigator.deviceMemory} GB RAM` : 'RAM Activa';
        if (performance && performance.memory) {
            const usedMB = (performance.memory.usedJSHeapSize / (1024 * 1024)).toFixed(1);
            const totalMB = (performance.memory.jsHeapSizeLimit / (1024 * 1024)).toFixed(0);
            ramEl.textContent = `${usedMB} MB`;
            if (heapEl) heapEl.textContent = `${approxRam} • Límite Heap: ${totalMB} MB`;
        } else {
            ramEl.textContent = approxRam;
            if (heapEl) heapEl.textContent = 'Gestión automática de memoria del motor JS';
        }

        // 3. Cuota de Almacenamiento Local
        if (navigator.storage && navigator.storage.estimate) {
            try {
                const est = await navigator.storage.estimate();
                const usedMB = ((est.usage || 0) / (1024 * 1024)).toFixed(2);
                const quotaGB = ((est.quota || 0) / (1024 * 1024 * 1024)).toFixed(1);
                if (storageEl) storageEl.textContent = `${usedMB} MB`;
                if (batEl) batEl.textContent = `Disponible en disco: ~${quotaGB} GB`;
            } catch {}
        }

        // 4. Batería si está disponible
        if (navigator.getBattery) {
            try {
                const bat = await navigator.getBattery();
                const pct = Math.round(bat.level * 100);
                if (batEl) batEl.textContent = `Batería: ${pct}% ${bat.charging ? '⚡ Cargando' : ''}`;
            } catch {}
        }

        // 5. Red y Velocidad
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (netEl) {
            netEl.textContent = navigator.onLine ? (conn?.effectiveType?.toUpperCase() || 'ONLINE') : 'OFFLINE';
            netEl.style.color = navigator.onLine ? 'var(--primary-neon)' : 'var(--danger-color, #ef4444)';
        }
        if (speedEl) {
            speedEl.textContent = conn?.downlink ? `Ancho de banda: ~${conn.downlink} Mbps (RTT ${conn.rtt || 20}ms)` : 'Enlace TLS 1.3 Activo';
        }
    };

    await updateMetrics();
    telemetryInterval = setInterval(updateMetrics, 3000);
}

// MOTOR CRIPTOGRÁFICO WEB CRYPTO API (AES-GCM 256-BIT + PBKDF2)
function bufToBase64(buffer) {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function base64ToBuf(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

async function deriveAESKey(password, saltBuffer) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        enc.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );
    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: saltBuffer,
            iterations: 100000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function encryptPayload(plainText, password) {
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveAESKey(password, salt);

    const cipherBuffer = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        enc.encode(plainText)
    );

    return {
        cipher: bufToBase64(cipherBuffer),
        iv: bufToBase64(iv),
        salt: bufToBase64(salt)
    };
}

async function decryptPayload(encryptedObj, password) {
    const dec = new TextDecoder();
    const salt = base64ToBuf(encryptedObj.salt);
    const iv = base64ToBuf(encryptedObj.iv);
    const cipher = base64ToBuf(encryptedObj.cipher);
    const key = await deriveAESKey(password, salt);

    const plainBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        cipher
    );
    return dec.decode(plainBuffer);
}

function getVaultItems() {
    try {
        return JSON.parse(localStorage.getItem(VAULT_STORAGE_KEY) || '[]');
    } catch {
        return [];
    }
}

function saveVaultItems(items) {
    localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(items));
}

function renderVaultItems() {
    const listEl = document.getElementById('vaultItemsList');
    if (!listEl) return;

    const items = getVaultItems();
    listEl.innerHTML = '';

    if (items.length === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; padding: 2.5rem 1rem; border: 1px dashed var(--border-card); border-radius: 16px; color: var(--text-muted);">
                <p style="font-size: 0.95rem; margin-bottom: 0.3rem;">La bóveda criptográfica local está vacía.</p>
                <span style="font-size: 0.8rem;">Encripta una nota o archivo sensible desde el formulario izquierdo.</span>
            </div>
        `;
        return;
    }

    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'setting-row';
        card.style.cssText = 'flex-direction: column; align-items: stretch; gap: 0.8rem; margin-bottom: 0; border-left: 4px solid var(--primary-neon);';

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 1rem; flex-wrap: wrap;">
                <div>
                    <h4 style="font-size: 0.98rem; color: var(--text-main); margin: 0;">🔒 ${escapeHTML(item.title)}</h4>
                    <span style="font-size: 0.75rem; color: var(--text-muted);">
                        AES-256-GCM • Sellado: ${new Date(item.created_at).toLocaleString('es-CO')}
                    </span>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button type="button" class="btn-outline btn-decrypt-item" style="padding: 5px 12px; font-size: 0.78rem; color: var(--primary-neon); border-color: var(--primary-neon);">
                        Desencriptar
                    </button>
                    <button type="button" class="btn-outline btn-delete-vault" style="padding: 5px 9px; font-size: 0.78rem; border-color: transparent; color: var(--danger-color, #ef4444);">
                        ✕
                    </button>
                </div>
            </div>
            <pre class="vault-output" style="margin: 0; padding: 0.75rem; background: var(--panel-bg); border-radius: 10px; font-size: 0.78rem; color: var(--text-muted); overflow-x: auto; white-space: pre-wrap;">[Cifrado AES-GCM]: ${escapeHTML(item.cipher.slice(0, 72))}...</pre>
        `;

        card.querySelector('.btn-decrypt-item').addEventListener('click', async () => {
            const passInput = document.getElementById('vaultUnlockPass');
            const pass = passInput?.value;
            if (!pass) {
                showToast('Ingresa tu Llave Maestra en la barra superior de la bóveda.', 'error');
                passInput?.focus();
                return;
            }

            try {
                const decryptedText = await decryptPayload(item, pass);
                const outEl = card.querySelector('.vault-output');
                if (outEl) {
                    outEl.textContent = decryptedText;
                    outEl.style.color = 'var(--primary-neon)';
                }
                showToast('Contenedor desencriptado con éxito.', 'success');
            } catch {
                showToast('Llave Maestra incorrecta: fallo de autenticación AES-GCM.', 'error');
            }
        });

        card.querySelector('.btn-delete-vault').addEventListener('click', () => {
            const next = getVaultItems().filter(i => i.id !== item.id);
            saveVaultItems(next);
            renderVaultItems();
            showToast('Contenedor eliminado de la bóveda local.', 'info');
        });

        listEl.appendChild(card);
    });
}

function bindVaultEvents() {
    const fileInput = document.getElementById('vaultFileInput');
    const secretInput = document.getElementById('vaultSecretInput');
    const titleInput = document.getElementById('vaultTitleInput');

    if (fileInput && secretInput) {
        fileInput.addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const text = await file.text();
            secretInput.value = text;
            if (titleInput && !titleInput.value.trim()) {
                titleInput.value = file.name;
            }
            showToast(`Archivo "${file.name}" cargado para cifrado.`, 'info');
        });
    }

    const form = document.getElementById('vaultEncryptForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = titleInput?.value.trim();
            const secret = secretInput?.value;
            const passInput = document.getElementById('vaultPassInput');
            const pass = passInput?.value;

            if (!title || !secret || !pass) return;

            try {
                const encrypted = await encryptPayload(secret, pass);
                const items = getVaultItems();
                items.unshift({
                    id: crypto.randomUUID(),
                    title,
                    ...encrypted,
                    created_at: new Date().toISOString()
                });
                saveVaultItems(items);
                form.reset();
                renderVaultItems();
                showToast(`"${title}" sellado con AES-256-GCM en la bóveda local.`, 'success');
            } catch (err) {
                showToast('Error al encriptar: ' + err.message, 'error');
            }
        });
    }

    const btnExport = document.getElementById('btnExportVault');
    if (btnExport) {
        btnExport.addEventListener('click', () => {
            const items = getVaultItems();
            if (items.length === 0) {
                showToast('No hay contenedores en la bóveda para exportar.', 'info');
                return;
            }
            const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `NGN_Vault_AES256_${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            showToast('Respaldo encriptado exportado (.json).', 'success');
        });
    }
}