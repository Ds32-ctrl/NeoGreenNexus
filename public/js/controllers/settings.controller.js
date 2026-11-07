// public/js/controllers/settings.controller.js
import { supabase } from '../config/supabase.js';
import { applyThemeColor, injectSuperButton, removeSuperButton } from '../core/theme.js';
import { navigateTo } from '../core/router.js';
import { showToast } from '../ui/toast.js';

const FIXED_CATALOG = [
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        navigateTo('/');
        return;
    }

    // 1. Navegación de Pestañas (Tabs)
    const tabs = document.querySelectorAll('.tab-btn');
    const panes = document.querySelectorAll('.tab-pane');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            panes.forEach(p => p.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById(tab.getAttribute('data-tab'))?.classList.add('active');
        });
    });

    // 2. Catálogo Expandible de Avatares
    const avatarGrid = document.getElementById('avatarSelectorGrid');
    const previewAvatar = document.getElementById('previewAvatar');
    const btnExpandCatalog = document.getElementById('btnExpandCatalog');
    const expandText = document.getElementById('expandText');

    let currentSelectedAvatar = '';
    let userGoogleAvatarUrl = '';

    const renderCatalog = (activeUrl) => {
        if (!avatarGrid) return;
        avatarGrid.innerHTML = '';
        const urls = [];

        if (userGoogleAvatarUrl) urls.push(userGoogleAvatarUrl);

        FIXED_CATALOG.forEach(item => {
            urls.push(`https://api.dicebear.com/7.x/${item.style}/svg?seed=${item.seed}&backgroundColor=e2e8f0,b6e3f4,c0aede,d1d4f9`);
        });

        if (activeUrl && !urls.includes(activeUrl)) urls[0] = activeUrl;

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

    if (btnExpandCatalog && avatarGrid && expandText) {
        btnExpandCatalog.addEventListener('click', () => {
            avatarGrid.classList.toggle('expanded');
            const isExpanded = avatarGrid.classList.contains('expanded');
            expandText.textContent = isExpanded ? 'Contraer catálogo' : 'Expandir catálogo completo';
            btnExpandCatalog.querySelector('svg').innerHTML = isExpanded
                ? '<polyline points="18 15 12 9 6 15"></polyline>'
                : '<polyline points="6 9 12 15 18 9"></polyline>';
        });
    }

    // 3. Cargar y Guardar Datos de Perfil en Supabase
    const inputName = document.getElementById('inputName');
    const inputNickname = document.getElementById('inputNickname');
    const inputEmail = document.getElementById('inputEmail');
    const inputRecoveryEmail = document.getElementById('inputRecoveryEmail');
    const btnSaveProfile = document.getElementById('btnSaveProfile');

    if (inputEmail) inputEmail.value = user.email;
    const metadata = user.user_metadata || {};

    if (inputName && metadata.full_name) inputName.value = metadata.full_name;
    if (inputNickname && metadata.nickname) inputNickname.value = metadata.nickname;
    if (inputRecoveryEmail && metadata.recovery_email) inputRecoveryEmail.value = metadata.recovery_email;

    if (user.identities?.length > 0) {
        const googleIdentity = user.identities.find(id => id.provider === 'google');
        if (googleIdentity?.identity_data?.avatar_url) {
            userGoogleAvatarUrl = googleIdentity.identity_data.avatar_url;
        }
    }

    const userAvatar = metadata.avatar_url || userGoogleAvatarUrl || 'https://api.dicebear.com/7.x/bottts-neutral/svg?seed=N1&backgroundColor=e2e8f0';
    if (previewAvatar) previewAvatar.src = userAvatar;
    currentSelectedAvatar = userAvatar;
    renderCatalog(userAvatar);

    if (btnSaveProfile) {
        btnSaveProfile.addEventListener('click', async () => {
            btnSaveProfile.textContent = 'Guardando...';
            btnSaveProfile.style.opacity = '0.7';

            try {
                // Dentro del evento click de btnSaveProfile en public/js/controllers/settings.controller.js:
                const { error } = await supabase.auth.updateUser({
                    data: {
                        full_name: inputName.value.trim(),
                        nickname: inputNickname.value.trim(),
                        avatar_url: currentSelectedAvatar,
                        recovery_email: inputRecoveryEmail.value.trim()
                    }
                });
                if (error) throw error;

                // Sincronizar también en la tabla relacional public.profiles
                await supabase.from('profiles').upsert({
                    id: user.id,
                    email: user.email,
                    full_name: inputName.value.trim(),
                    nickname: inputNickname.value.trim() || null,
                    avatar_url: currentSelectedAvatar,
                    recovery_email: inputRecoveryEmail.value.trim() || null,
                    updated_at: new Date().toISOString()
                });
                showToast('Identidad y Apodo actualizados.');
            } catch (error) {
                showToast(error.message, 'error');
            } finally {
                btnSaveProfile.innerHTML = '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg> Guardar Cambios';
                btnSaveProfile.style.opacity = '1';
            }
        });
    }

    // 4. Motor Cromático y Super Botón
    const themeCards = document.querySelectorAll('.theme-card');
    const toggleSuperTheme = document.getElementById('toggleSuperTheme');
    const savedColor = localStorage.getItem('ngn_theme_color') || '#10b981';

    themeCards.forEach(card => {
        card.classList.toggle('active', card.getAttribute('data-color') === savedColor);
        card.addEventListener('click', () => {
            themeCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            applyThemeColor(card.getAttribute('data-color'));
            showToast('Motor cromático actualizado.');
        });
    });

    if (toggleSuperTheme) {
        toggleSuperTheme.checked = localStorage.getItem('ngn_super_theme') === 'true';
        toggleSuperTheme.addEventListener('change', (e) => {
            localStorage.setItem('ngn_super_theme', e.target.checked);
            if (e.target.checked) injectSuperButton();
            else removeSuperButton();
        });
    }

    // 5. Solicitud de Cambio de Contraseña
    const btnResetPwd = document.getElementById('btnRequestPasswordReset');
    if (btnResetPwd) {
        btnResetPwd.addEventListener('click', async () => {
            const { error } = await supabase.auth.resetPasswordForEmail(user.email);
            if (error) showToast(error.message, 'error');
            else showToast('Se ha enviado un enlace de recuperación a tu correo.', 'info');
        });
    }
}