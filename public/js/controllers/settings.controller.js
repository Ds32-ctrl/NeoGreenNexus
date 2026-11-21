// public/js/controllers/settings.controller.js
import { supabase } from '../config/supabase.js';
import {
  THEME_PRESETS,
  BG_PATTERNS,
  FAB_SHORTCUTS,
  applyThemeColor,
  applyBackgroundPattern,
  applyGlassMode,
  setDarkMode,
  applyThemePreset,
  setFabShortcut,
  injectSuperButton,
  removeSuperButton,
  syncThemeFromUserMetadata
} from '../core/theme.js';
import { showToast } from '../ui/toast.js';
import { APP_VERSION } from '../core/version.js';

const FIXED_AVATAR_CATALOG = [
  { style: 'bottts-neutral', seed: 'Nexus' }, { style: 'bottts-neutral', seed: 'Alpha' },
  { style: 'shapes', seed: 'Prism' },         { style: 'bottts-neutral', seed: 'Forge' },
  { style: 'shapes', seed: 'Vertex' },        { style: 'bottts-neutral', seed: 'Nova' },
  { style: 'bottts-neutral', seed: 'Echo' },  { style: 'shapes', seed: 'Flux' },
  { style: 'bottts-neutral', seed: 'Pulse' }, { style: 'bottts-neutral', seed: 'Cipher' },
  { style: 'shapes', seed: 'Aero' },          { style: 'bottts-neutral', seed: 'Drift' },
  { style: 'shapes', seed: 'Zen' },           { style: 'bottts-neutral', seed: 'Dash' },
  { style: 'bottts-neutral', seed: 'Neon' },  { style: 'shapes', seed: 'Jolt' },
  { style: 'bottts-neutral', seed: 'Volt' },  { style: 'shapes', seed: 'Warp' },
  { style: 'bottts-neutral', seed: 'Kinet' }, { style: 'bottts-neutral', seed: 'Omni' },
  { style: 'shapes', seed: 'Sol' },           { style: 'bottts-neutral', seed: 'Luna' },
  { style: 'shapes', seed: 'Terra' },         { style: 'bottts-neutral', seed: 'Aura' },
  { style: 'bottts-neutral', seed: 'Spark' }
];

export async function initSettings() {
  // 1. NAVEGACIÓN DE PESTAÑAS
  const tabs = document.querySelectorAll('.tab-btn');
  const panes = document.querySelectorAll('.tab-pane');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      panes.forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      const targetId = tab.getAttribute('data-tab');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // 2. REFERENCIAS DEL DOM
  const avatarGrid = document.getElementById('avatarSelectorGrid');
  const previewAvatar = document.getElementById('previewAvatar');
  const btnExpandCatalog = document.getElementById('btnExpandCatalog');
  const expandText = document.getElementById('expandText');
  const inputName = document.getElementById('inputName');
  const inputNickname = document.getElementById('inputNickname');
  const inputEmail = document.getElementById('inputEmail');
  const inputRecoveryEmail = document.getElementById('inputRecoveryEmail');
  const btnSaveProfile = document.getElementById('btnSaveProfile');

  const themeCards = document.querySelectorAll('.theme-card');
  const customColorPicker = document.getElementById('customAccentColorPicker');
  const toggleDarkModeSettings = document.getElementById('toggleDarkModeSettings');
  const toggleGlassMica = document.getElementById('toggleGlassMica');
  const toggleSuperTheme = document.getElementById('toggleSuperTheme');
  const selectFabDefaultMode = document.getElementById('selectFabDefaultMode');

  const btnResetPassword = document.getElementById('btnResetPassword');
  const btnExportFullBackup = document.getElementById('btnExportFullBackup');

  let currentUser = null;
  let currentSelectedAvatar = '';
  let userGoogleAvatarUrl = '';
  let currentUserEmail = '';

  // 3. VISTA PREVIA EN VIVO DEL MOTOR CREATIVO
  const updateLivePreview = () => {
    const previewBox = document.getElementById('liveThemePreviewBox');
    const previewWin = document.getElementById('livePreviewWindow');
    const previewCaption = document.getElementById('livePreviewCaption');
    const previewPill = document.getElementById('livePreviewPill');

    const activePresetId = localStorage.getItem('ngn_theme_preset') || 'material';
    const activeColor = localStorage.getItem('ngn_theme_color') || '#10b981';
    const activePattern = localStorage.getItem('ngn_bg_pattern') || 'aurora';
    const isDark = document.body.classList.contains('dark-mode');
    const isGlass = localStorage.getItem('ngn_ui_glass') === 'true';

    const presetObj = THEME_PRESETS.find(p => p.id === activePresetId);
    const patternObj = BG_PATTERNS.find(p => p.id === activePattern);

    if (previewBox) {
      previewBox.style.background = presetObj
        ? presetObj.previewBg
        : `radial-gradient(circle at 20% 20%, ${activeColor}, ${isDark ? '#0f172a' : '#e2e8f0'})`;
    }
    if (previewWin) {
      previewWin.style.background = isDark
        ? (isGlass ? 'rgba(15, 23, 42, 0.72)' : '#1e293b')
        : (isGlass ? 'rgba(255, 255, 255, 0.78)' : '#ffffff');
      previewWin.style.color = isDark ? '#f8fafc' : '#0f172a';
      previewWin.style.backdropFilter = isGlass ? 'blur(12px)' : 'none';
    }
    if (previewCaption) {
      previewCaption.textContent = `${patternObj?.name || 'Personalizado'} • ${isDark ? 'Noche' : 'Día'}${isGlass ? ' • Mica' : ''}`;
    }
    if (previewPill) {
      previewPill.style.background = activeColor;
    }

    if (toggleDarkModeSettings) toggleDarkModeSettings.checked = isDark;
    if (toggleGlassMica) toggleGlassMica.checked = isGlass;
    if (customColorPicker && /^#[0-9a-fA-F]{6}$/.test(activeColor)) {
      customColorPicker.value = activeColor;
    }
    themeCards.forEach(c => c.classList.toggle('active', c.getAttribute('data-color') === activeColor));
    document.querySelectorAll('.preset-thumb-card').forEach(c => {
      c.classList.toggle('active', c.getAttribute('data-preset') === activePresetId);
    });
    document.querySelectorAll('.pattern-chip-btn').forEach(c => {
      c.classList.toggle('active', c.getAttribute('data-pattern') === activePattern);
    });
  };

  // 4. RENDERIZAR PRESETS, PATRONES Y SELECTOR DEL SUPER BOTÓN
  const renderCreativeGrids = () => {
    const presetsGrid = document.getElementById('themePresetsGrid');
    const patternsGrid = document.getElementById('bgPatternsGrid');

    if (presetsGrid) {
      presetsGrid.innerHTML = THEME_PRESETS.map(p => `
        <button type="button" class="preset-thumb-card" data-preset="${p.id}">
          <div class="preset-thumb-art" style="background: ${p.previewBg};">
            <div class="preset-thumb-mini" style="background: ${p.dark ? '#1e293b' : '#ffffff'};">
              <span style="width: 14px; height: 5px; border-radius: 3px; background: ${p.color};"></span>
            </div>
          </div>
          <div style="padding: 0.55rem 0.65rem;">
            <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-main);">${p.name}</div>
            <div style="font-size: 0.7rem; color: var(--text-muted);">${p.subtitle}</div>
          </div>
        </button>
      `).join('');

      presetsGrid.querySelectorAll('.preset-thumb-card').forEach(card => {
        card.addEventListener('click', () => {
          const preset = applyThemePreset(card.getAttribute('data-preset'), true);
          if (preset) {
            updateLivePreview();
            showToast(`Tema "${preset.name}" aplicado y sincronizado.`, 'success');
          }
        });
      });
    }

    if (patternsGrid) {
      patternsGrid.innerHTML = BG_PATTERNS.map(p => `
        <button type="button" class="pattern-chip-btn" data-pattern="${p.id}">
          <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-main);">${p.name}</div>
          <div style="font-size: 0.7rem; color: var(--text-muted);">${p.desc}</div>
        </button>
      `).join('');

      patternsGrid.querySelectorAll('.pattern-chip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          applyBackgroundPattern(btn.getAttribute('data-pattern'), true);
          updateLivePreview();
          showToast('Patrón de fondo actualizado.', 'success');
        });
      });
    }

    if (selectFabDefaultMode) {
      const currentFab = localStorage.getItem('ngn_fab_mode') || 'palette';
      selectFabDefaultMode.innerHTML = FAB_SHORTCUTS.map(s =>
        `<option value="${s.id}" ${s.id === currentFab ? 'selected' : ''}>${s.label} — ${s.desc}</option>`
      ).join('');

      selectFabDefaultMode.addEventListener('change', (e) => {
        const chosen = setFabShortcut(e.target.value, true);
        showToast(`Botón flotante cambiado a: ${chosen.label}`, 'success');
      });
    }
  };

  // 5. CATÁLOGO DE AVATARES
  const renderCatalog = (activeUrl) => {
    if (!avatarGrid) return;
    avatarGrid.innerHTML = '';
    const urls = [];
    if (userGoogleAvatarUrl) urls.push(userGoogleAvatarUrl);

    FIXED_AVATAR_CATALOG.forEach(item => {
      urls.push(`https://api.dicebear.com/7.x/${item.style}/svg?seed=${item.seed}&backgroundColor=e2e8f0,b6e3f4,c0aede,d1d4f9`);
    });
    if (activeUrl && !urls.includes(activeUrl)) urls.unshift(activeUrl);

    urls.forEach(url => {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Opción de avatar';
      img.className = `avatar-choice ${activeUrl === url ? 'selected' : ''}`;
      img.addEventListener('click', () => {
        document.querySelectorAll('.avatar-choice').forEach(a => a.classList.remove('selected'));
        img.classList.add('selected');
        if (previewAvatar) previewAvatar.src = url;
        currentSelectedAvatar = url;
      });
      avatarGrid.appendChild(img);
    });
  };

  if (btnExpandCatalog && avatarGrid) {
    btnExpandCatalog.addEventListener('click', () => {
      avatarGrid.classList.toggle('expanded');
      const isExpanded = avatarGrid.classList.contains('expanded');
      if (expandText) expandText.textContent = isExpanded ? 'Contraer catálogo' : 'Expandir catálogo completo';
      const svgIcon = btnExpandCatalog.querySelector('svg');
      if (svgIcon) {
        svgIcon.innerHTML = isExpanded
          ? '<polyline points="18 15 12 9 6 15"></polyline>'
          : '<polyline points="6 9 12 15 18 9"></polyline>';
      }
    });
  }

  // 6. TELEMETRÍA MULTIPLATAFORMA (WEB / ANDROID APK / ELECTRON)
  const renderDeviceTelemetry = () => {
    const grid = document.getElementById('deviceTelemetryGrid');
    if (!grid) return;

    const isCapacitor = Boolean(window.Capacitor?.isNativePlatform?.());
    const isElectron = Boolean(window.nexusDesktop?.isDesktopApp);
    const runtime = isCapacitor ? '📱 Android APK (Capacitor)' : isElectron ? '💻 Nexus Core (Electron)' : '🌐 Web SPA (Firebase)';
    const netStatus = navigator.onLine ? '🟢 En línea (Supabase)' : '🟡 Sin conexión';

    grid.innerHTML = `
      <div style="background: var(--panel-bg); padding: 0.7rem 0.85rem; border-radius: 12px; border: 1px solid var(--border-card);">
        <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Plataforma</div>
        <strong style="color: var(--text-main);">${runtime}</strong>
      </div>
      <div style="background: var(--panel-bg); padding: 0.7rem 0.85rem; border-radius: 12px; border: 1px solid var(--border-card);">
        <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Versión del Núcleo</div>
        <strong style="color: var(--primary-neon);">v${APP_VERSION || '2.0'}</strong>
      </div>
      <div style="background: var(--panel-bg); padding: 0.7rem 0.85rem; border-radius: 12px; border: 1px solid var(--border-card);">
        <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Resolución Activa</div>
        <strong style="color: var(--text-main);">${window.innerWidth} × ${window.innerHeight}px</strong>
      </div>
      <div style="background: var(--panel-bg); padding: 0.7rem 0.85rem; border-radius: 12px; border: 1px solid var(--border-card);">
        <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Estado de Red</div>
        <strong style="color: var(--text-main);">${netStatus}</strong>
      </div>
    `;
  };

  renderCreativeGrids();
  renderDeviceTelemetry();

  // 7. CARGA DE DATOS DEL USUARIO DESDE SUPABASE
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;

    if (user) {
      currentUser = user;
      currentUserEmail = user.email || '';
      if (inputEmail) inputEmail.value = currentUserEmail;

      const metadata = user.user_metadata || {};
      if (inputName && metadata.full_name) inputName.value = metadata.full_name;
      if (inputNickname && metadata.nickname) inputNickname.value = metadata.nickname;
      if (inputRecoveryEmail && metadata.recovery_email) inputRecoveryEmail.value = metadata.recovery_email;

      if (Array.isArray(user.identities)) {
        const googleIdentity = user.identities.find(id => id.provider === 'google');
        if (googleIdentity?.identity_data?.avatar_url) {
          userGoogleAvatarUrl = googleIdentity.identity_data.avatar_url;
        }
      }

      const defaultAvatar = 'https://api.dicebear.com/7.x/bottts-neutral/svg?seed=N1&backgroundColor=e2e8f0';
      const userAvatar = metadata.avatar_url || userGoogleAvatarUrl || defaultAvatar;
      if (previewAvatar) previewAvatar.src = userAvatar;
      currentSelectedAvatar = userAvatar;
      renderCatalog(userAvatar);

      syncThemeFromUserMetadata(user);
    }
  } catch (err) {
    console.error('Error cargando perfil en Ajustes:', err);
    showToast('No se pudo cargar la información del perfil.', 'error');
  }

  updateLivePreview();

  // 8. GUARDAR PERFIL EN SUPABASE
  if (btnSaveProfile) {
    btnSaveProfile.addEventListener('click', async () => {
      const originalHTML = btnSaveProfile.innerHTML;
      btnSaveProfile.textContent = 'Guardando...';
      btnSaveProfile.disabled = true;

      try {
        const cleanName = inputName ? inputName.value.trim() : '';
        const cleanNick = inputNickname ? inputNickname.value.trim() : '';
        const cleanRecovery = inputRecoveryEmail ? inputRecoveryEmail.value.trim() : '';

        const { error } = await supabase.auth.updateUser({
          data: {
            full_name: cleanName,
            nickname: cleanNick,
            avatar_url: currentSelectedAvatar,
            recovery_email: cleanRecovery
          }
        });
        if (error) throw error;

        if (currentUser) {
          await supabase.from('profiles').upsert({
            id: currentUser.id,
            email: currentUser.email,
            full_name: cleanName || 'Usuario NGN',
            nickname: cleanNick || null,
            avatar_url: currentSelectedAvatar,
            recovery_email: cleanRecovery || null,
            updated_at: new Date().toISOString()
          });
        }

        const miniDashName = document.getElementById('dashName');
        const miniDashAvatar = document.getElementById('dashAvatar');
        if (miniDashName && cleanName) miniDashName.textContent = cleanName.split(' ')[0];
        if (miniDashAvatar && currentSelectedAvatar) miniDashAvatar.src = currentSelectedAvatar;

        showToast('Identidad y Apodo actualizados correctamente.', 'success');
      } catch (err) {
        showToast(err.message || 'Error al actualizar el perfil.', 'error');
      } finally {
        btnSaveProfile.innerHTML = originalHTML;
        btnSaveProfile.disabled = false;
      }
    });
  }

  // 9. EVENTOS DEL MOTOR CREATIVO
  themeCards.forEach(card => {
    card.addEventListener('click', () => {
      const newColor = card.getAttribute('data-color');
      applyThemeColor(newColor, true);
      updateLivePreview();
      showToast('Color de énfasis actualizado.', 'success');
    });
  });

  customColorPicker?.addEventListener('input', (e) => {
    applyThemeColor(e.target.value, true);
    updateLivePreview();
  });

  toggleDarkModeSettings?.addEventListener('change', (e) => {
    setDarkMode(e.target.checked, true);
    updateLivePreview();
  });

  toggleGlassMica?.addEventListener('change', (e) => {
    applyGlassMode(e.target.checked, true);
    updateLivePreview();
    showToast(e.target.checked ? 'Efecto Cristal / Mica activado.' : 'Superficies sólidas activadas.', 'info');
  });

  if (toggleSuperTheme) {
    const isSuperMode = localStorage.getItem('ngn_super_theme') === 'true';
    toggleSuperTheme.checked = isSuperMode;

    toggleSuperTheme.addEventListener('change', async (e) => {
      const active = e.target.checked;
      localStorage.setItem('ngn_super_theme', String(active));
      if (active) {
        injectSuperButton();
        showToast('Super Botón Multifunción (con flecha ▲) activado.', 'success');
      } else {
        removeSuperButton();
        showToast('Super Botón desactivado.', 'info');
      }

      try {
        await supabase.auth.updateUser({ data: { super_theme: active } });
        if (currentUser) {
          await supabase.from('profiles').update({ super_theme_enabled: active }).eq('id', currentUser.id);
        }
      } catch {}
    });
  }

  // 10. CAMBIO DE CONTRASEÑA Y RESPALDO INTEGRAL JSON
  if (btnResetPassword) {
    btnResetPassword.addEventListener('click', async () => {
      if (!currentUserEmail) {
        showToast('No se encontró un correo autenticado.', 'error');
        return;
      }

      btnResetPassword.disabled = true;
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(currentUserEmail, {
          redirectTo: window.location.origin
        });
        if (error) throw error;
        showToast(`Enlace de recuperación enviado a ${currentUserEmail}`, 'info');
      } catch (err) {
        showToast(err.message || 'No se pudo enviar el correo de recuperación.', 'error');
      } finally {
        btnResetPassword.disabled = false;
      }
    });
  }

  if (btnExportFullBackup) {
    btnExportFullBackup.addEventListener('click', async () => {
      if (!currentUser) return;
      btnExportFullBackup.disabled = true;
      btnExportFullBackup.textContent = 'Generando respaldo...';
      try {
        const uid = currentUser.id;
        const [profile, tx, commitments, agenda, inv, zones, tasks, habits, logs] = await Promise.all([
          supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
          supabase.from('finance_transactions').select('*').eq('user_id', uid),
          supabase.from('financial_commitments').select('*').eq('user_id', uid),
          supabase.from('agenda_items').select('*').eq('user_id', uid),
          supabase.from('inventory_items').select('*').eq('user_id', uid),
          supabase.from('home_zones').select('*').eq('user_id', uid),
          supabase.from('zone_tasks').select('*').eq('user_id', uid),
          supabase.from('habits').select('*').eq('user_id', uid),
          supabase.from('habit_logs').select('*').eq('user_id', uid)
        ]);

        const snapshot = {
          exported_at: new Date().toISOString(),
          app: 'NeoGreenNexus',
          version: APP_VERSION || '2.0',
          profile: profile.data || null,
          data: {
            finance_transactions: tx.data || [],
            financial_commitments: commitments.data || [],
            agenda_items: agenda.data || [],
            inventory_items: inv.data || [],
            home_zones: zones.data || [],
            zone_tasks: tasks.data || [],
            habits: habits.data || [],
            habit_logs: logs.data || []
          }
        };

        const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `neogreennexus_backup_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('Respaldo completo JSON descargado.', 'success');
      } catch (err) {
        showToast('Error generando respaldo: ' + err.message, 'error');
      } finally {
        btnExportFullBackup.disabled = false;
        btnExportFullBackup.textContent = '📦 Descargar Respaldo JSON';
      }
    });
  }
}