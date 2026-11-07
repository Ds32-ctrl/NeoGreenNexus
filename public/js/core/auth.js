// public/js/core/auth.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from './router.js';
import { removeSuperButton } from './theme.js';
import { showToast } from '../ui/toast.js';
import { openLoginModal } from '../ui/modal.js';

export async function checkActiveSession() {
    const { data: { session } } = await supabase.auth.getSession();
    const btnLogin = document.getElementById('btnLogin');

    if (session) {
        if (btnLogin) {
            btnLogin.textContent = 'Mi Panel';
            btnLogin.onclick = () => navigateTo('/views/dashboard.html');
        }
        if (localStorage.getItem('ngn_super_theme') === 'true') {
            const { injectSuperButton } = await import('./theme.js');
            injectSuperButton();
        }
    } else {
        removeSuperButton();
        if (btnLogin) {
            btnLogin.textContent = 'Ingresar';
            btnLogin.onclick = openLoginModal;
        }
    }
    return session;
}

export async function logoutUser(btnElement = null) {
    if (btnElement) {
        btnElement.innerHTML = 'Saliendo...';
        btnElement.style.opacity = '0.5';
        btnElement.style.pointerEvents = 'none';
    }

    try {
        await Promise.race([
            supabase.auth.signOut(),
            new Promise(resolve => setTimeout(resolve, 1500))
        ]);
    } catch (error) {
        console.warn('Forzando salida por error en la red:', error);
    } finally {
        // Conservamos theme, ngn_theme_color y ngn_super_theme
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('sb-')) localStorage.removeItem(key);
        });
        sessionStorage.clear();
        removeSuperButton();

        const btnLogin = document.getElementById('btnLogin');
        if (btnLogin) {
            btnLogin.textContent = 'Ingresar';
            btnLogin.onclick = openLoginModal;
        }

        showToast('Sesión finalizada correctamente', 'info');
        navigateTo('/');
    }
}