// public/js/controllers/dashboard.controller.js
import { supabase } from '../config/supabase.js';
import { logoutUser } from '../core/auth.js';
import { navigateTo } from '../core/router.js';

export async function initDashboard() {
    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        const dashName = document.getElementById('dashName');
        const dashAvatar = document.getElementById('dashAvatar');

        if (error || !user) {
            if (dashName) dashName.textContent = 'Sesión inactiva';
            navigateTo('/');
            return;
        }

        const metadata = user.user_metadata || {};
        
        // Prioridad: Primer nombre -> Nickname -> Parte local del correo
        const rawName = metadata.full_name?.trim() || metadata.nickname?.trim() || user.email?.split('@')[0] || 'Usuario';
        const displayName = rawName.split(' ')[0];

        if (dashName) dashName.textContent = displayName;

        // Prioridad de Avatar: metadata.avatar_url -> Google OAuth identity -> DiceBear por defecto
        let googleAvatar = '';
        if (Array.isArray(user.identities)) {
            const googleId = user.identities.find(id => id.provider === 'google');
            if (googleId?.identity_data?.avatar_url) {
                googleAvatar = googleId.identity_data.avatar_url;
            }
        }

        const finalAvatar = metadata.avatar_url || googleAvatar || 'https://api.dicebear.com/7.x/bottts-neutral/svg?seed=N1&backgroundColor=e2e8f0';
        if (dashAvatar) {
            dashAvatar.src = finalAvatar;
        }
    } catch (error) {
        console.error('Error al cargar perfil en Dashboard:', error);
    }

    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', (e) => {
            e.preventDefault();
            logoutUser(btnLogout);
        });
    }
}