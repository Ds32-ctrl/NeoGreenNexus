// public/js/core/theme.js
import { supabase } from '../config/supabase.js';

const PALETTE_COLORS = ['#10b981', '#a855f7', '#0ea5e9', '#f59e0b', '#f43f5e'];

export function applyThemeColor(hexColor) {
    if (!hexColor || !hexColor.startsWith('#')) hexColor = '#10b981';

    document.documentElement.style.setProperty('--primary-neon', hexColor);

    if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hexColor)) {
        let c = hexColor.substring(1).split('');
        if (c.length === 3) c = [c[0], c[0], c[1], c[1], c[2], c[2]];
        c = '0x' + c.join('');
        const r = (c >> 16) & 255;
        const g = (c >> 8) & 255;
        const b = c & 255;
        document.documentElement.style.setProperty('--icon-bg', `rgba(${r}, ${g}, ${b}, 0.1)`);
        document.documentElement.style.setProperty('--bg-gradient-1', `rgba(${r}, ${g}, ${b}, 0.08)`);
    }
    localStorage.setItem('ngn_theme_color', hexColor);
}

export function toggleDarkLight() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');

    const darkBtnLabel = document.querySelector('#superThemeDarkModeBtn span');
    if (darkBtnLabel) {
        darkBtnLabel.textContent = isDark ? 'Modo Día' : 'Modo Noche';
    }
}

export function injectSuperButton() {
    if (document.getElementById('superThemeOverlayBtn')) return;
    const originalBtn = document.getElementById('themeToggle');
    if (!originalBtn) return;

    const superBtn = document.createElement('button');
    superBtn.type = 'button';
    superBtn.id = 'superThemeOverlayBtn';
    superBtn.className = 'theme-toggle';
    superBtn.setAttribute('aria-label', 'Abrir menú rápido de temas');
    superBtn.style.zIndex = '1002';
    superBtn.style.backgroundColor = 'var(--primary-neon)';
    superBtn.style.color = '#fff';
    superBtn.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path></svg>';

    const superMenu = document.createElement('div');
    superMenu.id = 'superThemeMenuPopup';
    superMenu.className = 'super-theme-popup';

    const currentColor = localStorage.getItem('ngn_theme_color') || '#10b981';
    const isDark = document.body.classList.contains('dark-mode');

    superMenu.innerHTML = `
        <div style="display: flex; gap: 8px; margin-bottom: 5px;">
            ${PALETTE_COLORS.map(col => `
                <div class="super-color-dot" data-col="${col}" style="width: 25px; height: 25px; border-radius: 50%; background: ${col}; cursor: pointer; border: 2px solid ${currentColor === col ? 'var(--text-main)' : 'transparent'}; transition: 0.2s;"></div>
            `).join('')}
        </div>
        <hr style="border-color: var(--border-card); margin: 5px 0;">
        <button type="button" id="superThemeDarkModeBtn" style="background:transparent; border:none; color:var(--text-main); font-weight:600; cursor:pointer; display:flex; align-items:center; gap:8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            <span>${isDark ? 'Modo Día' : 'Modo Noche'}</span>
        </button>
    `;

    document.body.appendChild(superBtn);
    document.body.appendChild(superMenu);

    superBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        superMenu.classList.toggle('open');
    });

    // Cerrar el popup automáticamente al hacer clic fuera
    document.addEventListener('click', (e) => {
        if (!superMenu.contains(e.target) && e.target !== superBtn) {
            superMenu.classList.remove('open');
        }
    });

    superMenu.querySelectorAll('.super-color-dot').forEach(dot => {
        dot.addEventListener('click', async (e) => {
            const newColor = e.target.getAttribute('data-col');
            applyThemeColor(newColor);

            superMenu.querySelectorAll('.super-color-dot').forEach(d => d.style.borderColor = 'transparent');
            e.target.style.borderColor = 'var(--text-main)';

            document.querySelectorAll('.theme-card').forEach(c => {
                c.classList.toggle('active', c.getAttribute('data-color') === newColor);
            });

            // Sincronizar color con Supabase si hay sesión activa
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session) {
                    await supabase.auth.updateUser({ data: { theme_color: newColor } });
                }
            } catch {
                // Ignorar silenciosamente si está offline
            }
        });
    });

    superMenu.querySelector('#superThemeDarkModeBtn').addEventListener('click', toggleDarkLight);
}

export function removeSuperButton() {
    document.getElementById('superThemeOverlayBtn')?.remove();
    document.getElementById('superThemeMenuPopup')?.remove();
}

export function initTheme() {
    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
    }

    const savedColor = localStorage.getItem('ngn_theme_color') || '#10b981';
    applyThemeColor(savedColor);

    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleDarkLight);
    }

    if (localStorage.getItem('ngn_super_theme') === 'true') {
        injectSuperButton();
    }
}