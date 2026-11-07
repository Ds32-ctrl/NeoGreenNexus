// public/js/app.js
import { initTheme } from './core/theme.js';
import { initRouter } from './core/router.js';
import { checkActiveSession } from './core/auth.js';
import { openLoginModal } from './ui/modal.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Inicializar motor de temas y rutas SPA
    initTheme();
    initRouter();

    // 2. Configurar botón de login y verificar sesión activa
    const btnLogin = document.getElementById('btnLogin');
    if (btnLogin) {
        btnLogin.onclick = openLoginModal;
    }
    await checkActiveSession();

    // 3. Buscador desplegable en la barra superior
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

    // 5. Efecto radial de seguimiento del cursor en tarjetas .app-card
    document.querySelectorAll('.app-card').forEach(card => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
            card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
        });
    });
});