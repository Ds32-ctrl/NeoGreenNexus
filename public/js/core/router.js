// public/js/core/router.js
import { supabase } from '../config/supabase.js';
import { initDashboard } from '../controllers/dashboard.controller.js';
import { initSettings } from '../controllers/settings.controller.js';
import { initHomeHub } from '../controllers/home-hub.controller.js';
import { init360Home } from '../controllers/360-home.controller.js';
import { initZones } from '../controllers/zones.controller.js';
import { initFamilyBoard } from '../controllers/family-board.controller.js';
import { initFinance } from '../controllers/finance.controller.js';
import { initInventory } from '../controllers/inventory.controller.js';
import { initHabits } from '../controllers/habits.controller.js';
import { initAgenda } from '../controllers/agenda.controller.js';
import { showToast } from '../ui/toast.js';

function initPublicContact() {
    const form = document.getElementById('publicContactForm');
    if (!form) return;
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('contactName')?.value.trim() || 'Usuario';
        form.reset();
        showToast(`Gracias ${name}, tu mensaje ha sido recibido por el equipo NGN.`, 'success');
    });
}

// Mapeo exacto de rutas a sus controladores correspondientes
const viewControllers = {
    '/views/dashboard.html': initDashboard,
    '/views/settings.html': initSettings,
    '/views/home-hub.html': initHomeHub,
    '/views/360-home.html': init360Home,
    '/views/zones.html': initZones,
    '/views/family-board.html': initFamilyBoard,
    '/views/finance.html': initFinance,
    '/views/inventory.html': initInventory,
    '/views/habits.html': initHabits,
    '/views/agenda.html': initAgenda,
    '/views/contacto.html': initPublicContact,
};

// Vistas privadas que requieren sesión activa y ocultan el header público
const PRIVATE_VIEWS = [
    '/views/dashboard.html',
    '/views/settings.html',
    '/views/home-hub.html',
    '/views/zones.html',
    '/views/family-board.html',
    '/views/finance.html',
    '/views/inventory.html',
    '/views/habits.html',
    '/views/agenda.html'
];

export async function navigateTo(targetPath, pushHistory = true) {
    const mainContent = document.getElementById('main-content');
    const dynamicView = document.getElementById('dynamic-view');
    const mainHeader = document.getElementById('mainHeader');

    if (!targetPath || targetPath === '/') {
        if (dynamicView) {
            dynamicView.style.display = 'none';
            dynamicView.innerHTML = '';
        }
        if (mainContent) mainContent.style.display = 'block';
        if (mainHeader) mainHeader.style.display = 'flex';
        if (pushHistory) history.pushState(null, '', '/');
        window.scrollTo(0, 0);
        return;
    }

    try {
        const cleanPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
        const isPrivate = PRIVATE_VIEWS.includes(cleanPath);

        if (isPrivate) {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) {
                showToast('Inicia sesión para acceder a este nodo privado.', 'error');
                document.getElementById('btnLogin')?.click();
                return;
            }
        }

        const fetchUrl = window.location.protocol === 'file:' ? `.${cleanPath}` : cleanPath;
        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error(`Vista no encontrada: ${cleanPath}`);

        dynamicView.innerHTML = await response.text();
        if (mainContent) mainContent.style.display = 'none';
        dynamicView.style.display = 'block';

        if (mainHeader) {
            mainHeader.style.display = isPrivate ? 'none' : 'flex';
            dynamicView.style.paddingTop = isPrivate ? '0' : '80px';
        }

        document.querySelectorAll('header nav a.encrypted-route').forEach(link => {
            link.classList.toggle('active', link.getAttribute('data-target') === cleanPath);
        });

        if (pushHistory && window.location.protocol !== 'file:') {
            const encoded = btoa(cleanPath);
            history.pushState({ path: cleanPath }, '', `?node=${encoded}`);
        }

        window.scrollTo(0, 0);

        if (viewControllers[cleanPath]) {
            await viewControllers[cleanPath]();
        }
    } catch (error) {
        console.error('Error en router:', error);
        showToast('El módulo solicitado aún no está disponible.', 'error');
        navigateTo('/', true);
    }
}

export function initRouter() {
    document.body.addEventListener('click', (e) => {
        const routeEl = e.target.closest('.encrypted-route');
        if (routeEl) {
            e.preventDefault();
            const target = routeEl.getAttribute('data-target');
            if (target) navigateTo(target);
        }
    });

    const brandLogo = document.getElementById('brandLogo');
    if (brandLogo) {
        brandLogo.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo('/');
        });
    }

    window.addEventListener('popstate', async (e) => {
        if (e.state && e.state.path) {
            await navigateTo(e.state.path, false);
            return;
        }

        const params = new URLSearchParams(window.location.search);
        const node = params.get('node');
        if (node) {
            try {
                await navigateTo(atob(node), false);
            } catch {
                await navigateTo('/', false);
            }
        } else {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                await navigateTo('/views/dashboard.html', false);
            } else {
                await navigateTo('/', false);
            }
        }
    });

    const params = new URLSearchParams(window.location.search);
    const initialNode = params.get('node');
    if (initialNode) {
        try {
            navigateTo(atob(initialNode), false);
        } catch {
            navigateTo('/', false);
        }
    }

    if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
        window.Capacitor.Plugins.App.addListener('backButton', async ({ canGoBack }) => {
            const dynamicView = document.getElementById('dynamic-view');
            const isInsideModule = dynamicView && dynamicView.style.display !== 'none';

            if (canGoBack && isInsideModule) {
                window.history.back();
            } else if (isInsideModule) {
                const { data: { session } } = await supabase.auth.getSession();
                await navigateTo(session ? '/views/dashboard.html' : '/', false);
            } else {
                window.Capacitor.Plugins.App.exitApp();
            }
        });
    }
}