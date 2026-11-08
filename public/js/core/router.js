// public/js/core/router.js
import { initDashboard } from '../controllers/dashboard.controller.js';
import { initSettings } from '../controllers/settings.controller.js';
import { initHomeHub } from '../controllers/home-hub.controller.js';
import { init360Home } from '../controllers/360-home.controller.js';
import { initZones } from '../controllers/zones.controller.js';
import { initFamilyBoard } from '../controllers/family-board.controller.js';
import { initFinance } from '../controllers/finance.controller.js';
import { initInventory } from '../controllers/inventory.controller.js';
import { initHabits } from '../controllers/habits.controller.js';
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

// Mapeo de rutas a sus controladores correspondientes
const viewControllers = {
    '/views/dashboard.html': initDashboard,
    '/views/settings.html': initSettings,
    '/views/home-hub.html': initHomeHub,
    '/views/360Home.html': init360Home,
    '/views/zones.html': initZones,
    '/views/family-board.html': initFamilyBoard,
    '/views/finance.html': initFinance,
    '/views/inventory.html': initInventory,
    '/views/habits.html': initHabits,
    '/views/contacto.html': initPublicContact,
};

// Vistas que deben ocultar el header público principal
const PRIVATE_VIEWS = [
    '/views/dashboard.html', 
    '/views/settings.html',
    '/views/home-hub.html',
    '/views/360Home.html',
    '/views/zones.html',
    '/views/family-board.html',
    '/views/finance.html',
    '/views/inventory.html',
    '/views/habits.html'
];

export async function navigateTo(targetPath, pushHistory = true) {
    const mainContent = document.getElementById('main-content');
    const dynamicView = document.getElementById('dynamic-view');
    const mainHeader = document.getElementById('mainHeader');

    // Si la ruta es la raíz "/", mostramos el contenido principal (Landing Page)
    if (!targetPath || targetPath === '/') {
        dynamicView.style.display = 'none';
        dynamicView.innerHTML = '';
        mainContent.style.display = 'block';
        if (mainHeader) mainHeader.style.display = 'flex';
        if (pushHistory) history.pushState(null, '', '/');
        window.scrollTo(0, 0);
        return;
    }

    try {
        // Asegurar que la ruta comience con '/'
        const cleanPath = targetPath.startsWith('/') ? targetPath : `/${targetPath}`;
        
        // Cargar el HTML de la vista
        const response = await fetch(cleanPath);
        if (!response.ok) throw new Error(`Vista no encontrada: ${cleanPath}`);

        dynamicView.innerHTML = await response.text();
        mainContent.style.display = 'none';
        dynamicView.style.display = 'block';

        // Ocultar header público en paneles privados y ajustar el padding superior
        if (mainHeader) {
            const isPrivate = PRIVATE_VIEWS.includes(cleanPath);
            mainHeader.style.display = isPrivate ? 'none' : 'flex';
            dynamicView.style.paddingTop = isPrivate ? '0' : '80px';
        }

        // Actualizar la URL con Base64 si es necesario
        if (pushHistory) {
            const encoded = btoa(cleanPath);
            history.pushState({ path: cleanPath }, '', `?node=${encoded}`);
        }

        window.scrollTo(0, 0);

        // Si la vista tiene un controlador asociado (ej: Dashboard o Settings), ejecutarlo
        if (viewControllers[cleanPath]) {
            await viewControllers[cleanPath]();
        }
    } catch (error) {
        console.error('Error en router:', error);
        showToast('El módulo solicitado aún no está disponible', 'error');
        navigateTo('/', true);
    }
}

export function initRouter() {
    // Delegación global de eventos para cualquier enlace con la clase .encrypted-route
    document.body.addEventListener('click', (e) => {
        const routeEl = e.target.closest('.encrypted-route');
        if (routeEl) {
            e.preventDefault();
            const target = routeEl.getAttribute('data-target');
            if (target) navigateTo(target);
        }
    });

    // Logo principal vuelve al inicio sin recargar la página
    const brandLogo = document.getElementById('brandLogo');
    if (brandLogo) {
        brandLogo.addEventListener('click', (e) => {
            e.preventDefault();
            navigateTo('/');
        });
    }

    // Soporte para los botones Atrás / Adelante del navegador
    window.addEventListener('popstate', (e) => {
        if (e.state && e.state.path) {
            navigateTo(e.state.path, false);
        } else {
            const params = new URLSearchParams(window.location.search);
            const node = params.get('node');
            if (node) {
                try {
                    navigateTo(atob(node), false);
                } catch {
                    navigateTo('/', false);
                }
            } else {
                navigateTo('/', false);
            }
        }
    });

    // Carga inicial si la URL ya trae un parámetro ?node=...
    const params = new URLSearchParams(window.location.search);
    const initialNode = params.get('node');
    if (initialNode) {
        try {
            navigateTo(atob(initialNode), false);
        } catch {
            navigateTo('/', false);
        }
    }
}