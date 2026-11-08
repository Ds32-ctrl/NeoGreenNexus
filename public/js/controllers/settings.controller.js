// public/js/controllers/settings.controller.js
import { supabase } from '../config/supabase.js';
import { applyThemeColor, injectSuperButton, removeSuperButton } from '../core/theme.js';
import { showToast } from '../ui/toast.js';

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
  // 1. NAVEGACIÓN DE PESTAÑAS (TABS)
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
  const toggleSuperTheme = document.getElementById('toggleSuperTheme');
  const btnResetPassword = document.getElementById('btnResetPassword');

  let currentSelectedAvatar = '';
  let userGoogleAvatarUrl = '';
  let currentUserEmail = '';

  // 3. RENDERIZADO DEL CATÁLOGO DE AVATARES
  const renderCatalog = (activeUrl) => {
    if (!avatarGrid) return;
    avatarGrid.innerHTML = '';
    const urls = [];

    if (userGoogleAvatarUrl) urls.push(userGoogleAvatarUrl);

    FIXED_AVATAR_CATALOG.forEach(item => {
      urls.push(`https://api.dicebear.com/7.x/${item.style}/svg?seed=${item.seed}&backgroundColor=e2e8f0,b6e3f4,c0aede,d1d4f9`);
    });

    if (activeUrl && !urls.includes(activeUrl)) {
      urls.unshift(activeUrl);
    }

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
      if (expandText) {
        expandText.textContent = isExpanded ? 'Contraer catálogo' : 'Expandir catálogo completo';
      }
      const svgIcon = btnExpandCatalog.querySelector('svg');
      if (svgIcon) {
        svgIcon.innerHTML = isExpanded
          ? '<polyline points="18 15 12 9 6 15"></polyline>'
          : '<polyline points="6 9 12 15 18 9"></polyline>';
      }
    });
  }

  // 4. CARGA DE DATOS DEL USUARIO DESDE SUPABASE
  try {
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error) throw error;

    if (user) {
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

      // Si el usuario tiene tema cromático guardado en la nube, lo sincronizamos
      if (metadata.theme_color) {
        localStorage.setItem('ngn_theme_color', metadata.theme_color);
        applyThemeColor(metadata.theme_color);
      }
      if (typeof metadata.super_theme === 'boolean') {
        localStorage.setItem('ngn_super_theme', String(metadata.super_theme));
      }
    }
  } catch (err) {
    console.error('Error cargando perfil en Ajustes:', err);
    showToast('No se pudo cargar la información del perfil.', 'error');
  }

  // 5. GUARDAR PERFIL EN SUPABASE
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
        const { data: { user: activeUser } } = await supabase.auth.getUser();
        if (activeUser) {
          await supabase.from('profiles').upsert({
            id: activeUser.id,
            email: activeUser.email,
            full_name: cleanName || 'Usuario NGN',
            nickname: cleanNick || null,
            avatar_url: currentSelectedAvatar,
            recovery_email: cleanRecovery || null,
            updated_at: new Date().toISOString()
          });
        }

        // Actualizar mini-perfil en la barra si está presente
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

  // 6. MOTOR CROMÁTICO Y SUPER BOTÓN (LOCAL + NUBE)
  const savedColor = localStorage.getItem('ngn_theme_color') || '#10b981';
  themeCards.forEach(card => {
    card.classList.toggle('active', card.getAttribute('data-color') === savedColor);

    card.addEventListener('click', async () => {
      themeCards.forEach(c => c.classList.remove('active'));
      card.classList.add('active');

      const newColor = card.getAttribute('data-color');
      applyThemeColor(newColor);
      localStorage.setItem('ngn_theme_color', newColor);
      showToast('Motor cromático actualizado.', 'success');

      // Respaldo silencioso en Supabase para sincronización multi-dispositivo
      try {
        await supabase.auth.updateUser({ data: { theme_color: newColor } });
      } catch (e) {
        console.warn('No se pudo sincronizar el color en la nube:', e);
      }
    });
  });

  if (toggleSuperTheme) {
    const isSuperMode = localStorage.getItem('ngn_super_theme') === 'true';
    toggleSuperTheme.checked = isSuperMode;

    toggleSuperTheme.addEventListener('change', async (e) => {
      const active = e.target.checked;
      localStorage.setItem('ngn_super_theme', String(active));
      if (active) {
        injectSuperButton();
        showToast('Super Botón de Temas activado.', 'success');
      } else {
        removeSuperButton();
        showToast('Super Botón desactivado.', 'info');
      }

      try {
        await supabase.auth.updateUser({ data: { super_theme: active } });
      } catch (err) {
        console.warn('No se pudo sincronizar preferencia de Super Botón:', err);
      }
    });
  }

  // 7. MALLA DE SEGURIDAD: CAMBIO DE CONTRASEÑA REAL
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
}   