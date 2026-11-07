// public/js/controllers/dashboard.controller.js
import { supabase } from '../config/supabase.js';
import { logoutUser } from '../core/auth.js';
import { navigateTo } from '../core/router.js';

export async function initDashboard() {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        const dashName = document.getElementById('dashName');
        const dashAvatar = document.getElementById('dashAvatar');

        if (!user) {
            if (dashName) dashName.textContent = 'Sesión inactiva';
            navigateTo('/');
            return;
        }

        const metadata = user.user_metadata || {};
        const firstName = metadata.full_name ? metadata.full_name.split(' ')[0] : 'Usuario';
        
        if (dashName) dashName.textContent = firstName;
        if (dashAvatar && metadata.avatar_url) {
            dashAvatar.src = metadata.avatar_url;
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