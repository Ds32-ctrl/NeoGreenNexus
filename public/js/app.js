// public/js/app.js
import { initTheme } from './core/theme.js';
import { initRouter, navigateTo } from './core/router.js';
import { checkActiveSession, initAuthListener } from './core/auth.js';
import { openLoginModal } from './ui/modal.js';
import { showToast } from './ui/toast.js';
import { checkForAppUpdates } from './core/updater.js';

document.addEventListener('DOMContentLoaded', () => {
  checkForAppUpdates(); 
});

// Catálogo de rutas para el buscador global (#searchInput)
const SEARCHABLE_MODULES = [
    { keywords: ['panel', 'dashboard', 'inicio', 'central'], path: '/views/dashboard.html', label: 'Panel Principal' },
    { keywords: ['360', 'home', 'casa', 'clima', 'nucleo', 'hub'], path: '/views/home-hub.html', label: '360 Home (Núcleo)' },
    { keywords: ['finanzas', 'flujo', 'gastos', 'dinero', 'cuentas', 'pagos'], path: '/views/finance.html', label: 'Flujo Financiero' },
    { keywords: ['despensa', 'inventario', 'compras', 'comida', 'stock'], path: '/views/inventory.html', label: 'Despensa Inteligente' },
    { keywords: ['habitos', 'rutinas', 'salud', 'racha', 'metas'], path: '/views/habits.html', label: 'Rastreador de Hábitos' },
    { keywords: ['zonas', 'habitaciones', 'espacios', 'mantenimiento'], path: '/views/zones.html', label: 'Zonas del Hogar' },
    { keywords: ['tablero', 'familia', 'notas', 'compartido', 'calendario'], path: '/views/family-board.html', label: 'Tablero Compartido' },
    { keywords: ['ajustes', 'configuracion', 'perfil', 'temas', 'seguridad', 'color'], path: '/views/settings.html', label: 'Ajustes del Nodo' },
    { keywords: ['apk', 'android', 'movil', 'descargar'], path: '/views/360-home.html', label: 'Descargar 360 Home APK' },
    { keywords: ['desktop', 'pc', 'windows', 'mac', 'escritorio', 'nexus core'], path: '/views/nexus-core.html', label: 'Nexus Core Desktop' },
    { keywords: ['nosotros', 'equipo', 'mision', 'historia'], path: '/views/nosotros.html', label: 'Nosotros' },
    { keywords: ['contacto', 'soporte', 'ayuda', 'mensaje'], path: '/views/contacto.html', label: 'Contacto' }
];

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Inicializar motor de temas, listener de sesión y enrutador SPA
    initTheme();
    initAuthListener();
    initRouter();

    // 2. Configurar botón de login y verificar sesión activa
    const btnLogin = document.getElementById('btnLogin');
    if (btnLogin) {
        btnLogin.onclick = openLoginModal;
    }
    const session = await checkActiveSession();

    // Si corre dentro del APK nativo (Capacitor) y no hay nodo en la URL, ir directo al Dashboard o Login
    const isNativeApp = Boolean(window.Capacitor?.isNativePlatform?.());
    const hasNodeParam = new URLSearchParams(window.location.search).has('node');
    if (isNativeApp && !hasNodeParam) {
        if (session) {
            await navigateTo('/views/dashboard.html', false);
        } else {
            openLoginModal();
        }
    }

    // 3. Buscador interactivo en la barra superior + Atajo Ctrl+K
    const searchWrapper = document.getElementById('searchWrapper');
    const searchToggle = document.getElementById('searchToggle');
    const searchInput = document.getElementById('searchInput');

    if (searchToggle && searchWrapper && searchInput) {
        searchToggle.addEventListener('click', () => {
            searchWrapper.classList.toggle('active');
            if (searchWrapper.classList.contains('active')) {
                searchInput.focus();
            }
        });

        // Atajo de teclado Ctrl+K o Cmd+K para abrir el buscador rápidamente
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                searchWrapper.classList.add('active');
                searchInput.focus();
            } else if (e.key === 'Escape' && searchWrapper.classList.contains('active')) {
                searchWrapper.classList.remove('active');
                searchInput.blur();
            }
        });

        // Ejecutar búsqueda al presionar Enter
        searchInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();

            const query = searchInput.value.trim().toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            if (!query) return;

            const match = SEARCHABLE_MODULES.find(mod =>
                mod.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(query) ||
                mod.keywords.some(k => k.includes(query) || query.includes(k))
            );

            if (match) {
                searchInput.value = '';
                searchWrapper.classList.remove('active');
                navigateTo(match.path);
            } else {
                showToast(`No se encontró ningún módulo para "${searchInput.value.trim()}"`, 'info');
            }
        });
    }

    // 4. Carrusel automático del Banner informativo
    const sliderTrack = document.getElementById('sliderTrack');
    const dots = document.querySelectorAll('.dot');
    let currentSlide = 0;

    function goToSlide(index) {
        if (!sliderTrack || dots.length === 0) return;
        currentSlide = index;
        sliderTrack.style.transform = `translateX(-${currentSlide * 33.333}%)`;
        dots.forEach((dot, idx) => dot.classList.toggle('active', idx === currentSlide));
    }

    if (dots.length > 0) {
        dots.forEach(dot => {
            dot.addEventListener('click', () => goToSlide(Number(dot.dataset.index)));
        });
        setInterval(() => {
            goToSlide((currentSlide + 1) % dots.length);
        }, 6000);
    }

    // 5. Delegación global para efecto radial del cursor en tarjetas .app-card y .module-card
    document.body.addEventListener('mousemove', (e) => {
        const card = e.target.closest('.app-card, .module-card');
        if (!card) return;
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
        card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
    });
});