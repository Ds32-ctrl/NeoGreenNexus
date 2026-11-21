// public/js/core/theme.js
import { supabase } from '../config/supabase.js';

export const PALETTE_COLORS = ['#10b981', '#a855f7', '#0ea5e9', '#f59e0b', '#f43f5e', '#00ff66'];

export const THEME_PRESETS = [
    {
        id: 'bloom',
        name: 'Windows Bloom',
        subtitle: 'Ondas fluidas + Cristal Mica',
        color: '#0ea5e9',
        dark: false,
        pattern: 'bloom',
        glass: true,
        previewBg: 'radial-gradient(circle at 65% 45%, #38bdf8 0%, #0284c7 42%, #1e3a8a 100%)'
    },
    {
        id: 'eclipse',
        name: 'Eclipse Aurora',
        subtitle: 'Halo cósmico nocturno',
        color: '#a855f7',
        dark: true,
        pattern: 'eclipse',
        glass: true,
        previewBg: 'radial-gradient(circle at 50% 85%, #f472b6 0%, #9333ea 35%, #1e1b4b 72%, #090714 100%)'
    },
    {
        id: 'solstice',
        name: 'Solsticio Cálido',
        subtitle: 'Editorial ámbar y carmesí',
        color: '#f59e0b',
        dark: true,
        pattern: 'solstice',
        glass: true,
        previewBg: 'radial-gradient(circle at 30% 60%, #fb7185 0%, #f59e0b 38%, #4c1d95 72%, #0b0914 100%)'
    },
    {
        id: 'horizon',
        name: 'Lago Sereno',
        subtitle: 'Claridad turquesa diurna',
        color: '#06b6d4',
        dark: false,
        pattern: 'horizon',
        glass: true,
        previewBg: 'linear-gradient(180deg, #bae6fd 0%, #e0f2fe 45%, #0891b2 55%, #155e75 100%)'
    },
    {
        id: 'material',
        name: 'Material Mesh',
        subtitle: 'Malla cromática adaptativa',
        color: '#10b981',
        dark: false,
        pattern: 'mesh',
        glass: false,
        previewBg: 'radial-gradient(at 15% 20%, #34d399 0%, transparent 55%), radial-gradient(at 85% 80%, #38bdf8 0%, transparent 55%), #ecfdf5'
    },
    {
        id: 'cyber',
        name: 'Cyber Matrix NGN',
        subtitle: 'Rejilla industrial neón',
        color: '#00ff66',
        dark: true,
        pattern: 'grid',
        glass: false,
        previewBg: 'linear-gradient(rgba(0,255,102,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(0,255,102,0.18) 1px, transparent 1px), #050a08'
    }
];

export const BG_PATTERNS = [
    { id: 'aurora',   name: 'Aurora Clásica',   desc: 'Gradiente radial limpio' },
    { id: 'bloom',    name: 'Ondas Bloom',      desc: 'Capas fluidas estilo Win11' },
    { id: 'eclipse',  name: 'Halo Eclipse',     desc: 'Resplandor orbital profundo' },
    { id: 'mesh',     name: 'Malla Material',   desc: 'Atmósfera adaptable Google' },
    { id: 'dots',     name: 'Puntos Tech',      desc: 'Trama punteada minimalista' },
    { id: 'grid',     name: 'Rejilla Cyber',    desc: 'Plano arquitectónico NGN' },
    { id: 'horizon',  name: 'Horizonte Suave',  desc: 'Banda atmosférica luminosa' },
    { id: 'solstice', name: 'Prisma Solsticio', desc: 'Contraste cálido de foco' }
];

export const FAB_SHORTCUTS = [
    {
        id: 'palette',
        label: 'Paleta & Temas',
        desc: 'Menú rápido de color, patrón y modo',
        icon: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"></circle><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"></circle><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"></circle><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"></circle><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"></path></svg>'
    },
    {
        id: 'darkmode',
        label: 'Modo Día / Noche',
        desc: 'Alternar tema claro u oscuro en 1 toque',
        icon: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>'
    },
    {
        id: 'search',
        label: 'Buscador Rápido',
        desc: 'Abrir Command Palette (Ctrl+K)',
        icon: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>'
    },
    {
        id: 'agenda',
        label: 'Ir a Agendas',
        desc: 'Salto directo al Centro de Agendas',
        icon: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line></svg>'
    },
    {
        id: 'finance',
        label: 'Ir a Finanzas',
        desc: 'Salto directo a Flujo Financiero',
        icon: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>'
    },
    {
        id: 'dashboard',
        label: 'Ir al Panel',
        desc: 'Volver al Dashboard principal',
        icon: '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>'
    }
];

const COMMAND_ITEMS = [
    { label: 'Panel Principal (Dashboard)', desc: 'Vista general de módulos y pulso del día', icon: '🎛️', path: '/views/dashboard.html', keywords: 'inicio panel dashboard home' },
    { label: 'Centro de Agendas', desc: 'Compromisos por tiempo, prioridad y calendario', icon: '📅', path: '/views/agenda.html', keywords: 'agenda calendario cuotas vencimientos recordatorios' },
    { label: 'Flujo Financiero', desc: 'Ingresos, gastos, deudas e inversiones', icon: '💰', path: '/views/finance.html', keywords: 'finanzas dinero deudas inversiones presupuesto quac nu' },
    { label: 'Tablero Compartido (Hogar)', desc: 'Mural, flujo conjunto y bóveda familiar', icon: '🏠', path: '/views/family-board.html', keywords: 'familia hogar casa carrillo tablero mural' },
    { label: 'Núcleo 360 Home', desc: 'Telemetría, reloj, clima, audio y calculadora', icon: '🛰️', path: '/views/home-hub.html', keywords: '360 hub clima calculadora audio ruido marron' },
    { label: 'Despensa Inteligente', desc: 'Inventario, stock mínimo y lista de mercado', icon: '🛒', path: '/views/inventory.html', keywords: 'despensa inventario compras mercado comida' },
    { label: 'Zonas del Hogar', desc: 'Espacios y mantenimientos periódicos', icon: '🔧', path: '/views/zones.html', keywords: 'zonas habitaciones limpieza mantenimiento cocina estudio' },
    { label: 'Rastreador de Hábitos', desc: 'Rachas de 7 días y Modo Enfoque Absoluto', icon: '🎯', path: '/views/habits.html', keywords: 'habitos rutinas pomodoro enfoque racha' },
    { label: 'Ajustes & Motor Creativo', desc: 'Perfil, temas, patrones, Mica y respaldo', icon: '🎨', path: '/views/settings.html', keywords: 'ajustes configuracion temas colores patrones perfil seguridad' }
];

let globalListenersBound = false;
let cloudSyncTimer = null;

function hexToRgb(hexColor = '#10b981') {
    let hex = String(hexColor || '#10b981').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (!/^[A-Fa-f0-9]{6}$/.test(hex)) return { r: 16, g: 185, b: 129 };
    const num = parseInt(hex, 16);
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function ensureThemeEngineStyles() {
    if (document.getElementById('ngn-theme-engine-styles')) return;
    const style = document.createElement('style');
    style.id = 'ngn-theme-engine-styles';
    style.textContent = `
        /* ===== PATRONES Y ATMÓSFERAS DE FONDO (ESTILO WIN11 / MATERIAL YOU) ===== */
        body[data-bg-pattern="bloom"] .bg-pattern {
            background-image:
                radial-gradient(ellipse 68% 58% at 78% 22%, rgba(var(--primary-rgb, 16,185,129), 0.28) 0%, transparent 65%),
                radial-gradient(ellipse 55% 55% at 18% 78%, rgba(56, 189, 248, 0.24) 0%, transparent 65%),
                radial-gradient(ellipse 45% 45% at 52% 48%, rgba(99, 102, 241, 0.16) 0%, transparent 70%);
            background-size: 100% 100%;
        }
        body.dark-mode[data-bg-pattern="bloom"] .bg-pattern {
            background-image:
                radial-gradient(ellipse 65% 58% at 76% 24%, rgba(var(--primary-rgb, 14,165,233), 0.36) 0%, transparent 62%),
                radial-gradient(ellipse 60% 55% at 22% 80%, rgba(30, 64, 175, 0.42) 0%, transparent 68%),
                radial-gradient(circle at 50% 50%, rgba(15, 23, 42, 0.9), #060b16);
        }
        body[data-bg-pattern="eclipse"] .bg-pattern {
            background-image:
                radial-gradient(circle 420px at 50% 105%, rgba(var(--primary-rgb, 168,85,247), 0.42) 0%, rgba(236, 72, 153, 0.22) 38%, transparent 72%),
                radial-gradient(circle 320px at 15% 15%, rgba(99, 102, 241, 0.22) 0%, transparent 65%);
        }
        body[data-bg-pattern="solstice"] .bg-pattern {
            background-image:
                radial-gradient(ellipse 60% 50% at 85% 20%, rgba(244, 63, 94, 0.26) 0%, transparent 62%),
                radial-gradient(ellipse 65% 55% at 18% 82%, rgba(245, 158, 11, 0.28) 0%, transparent 62%),
                radial-gradient(ellipse 45% 45% at 55% 45%, rgba(168, 85, 247, 0.14) 0%, transparent 68%);
        }
        body[data-bg-pattern="horizon"] .bg-pattern {
            background-image:
                linear-gradient(180deg, rgba(14, 165, 233, 0.16) 0%, transparent 46%, rgba(var(--primary-rgb, 6,182,212), 0.18) 54%, transparent 100%),
                radial-gradient(circle 280px at 50% 38%, rgba(255, 255, 255, 0.55) 0%, transparent 70%);
        }
        body.dark-mode[data-bg-pattern="horizon"] .bg-pattern {
            background-image:
                linear-gradient(180deg, rgba(14, 165, 233, 0.22) 0%, transparent 48%, rgba(var(--primary-rgb, 6,182,212), 0.25) 56%, rgba(2, 6, 23, 0.9) 100%);
        }
        body[data-bg-pattern="mesh"] .bg-pattern {
            background-image:
                radial-gradient(at 12% 18%, rgba(var(--primary-rgb, 16,185,129), 0.22) 0px, transparent 48%),
                radial-gradient(at 88% 15%, rgba(168, 85, 247, 0.18) 0px, transparent 48%),
                radial-gradient(at 82% 85%, rgba(14, 165, 233, 0.20) 0px, transparent 50%),
                radial-gradient(at 18% 82%, rgba(245, 158, 11, 0.15) 0px, transparent 48%);
        }
        body[data-bg-pattern="dots"] .bg-pattern {
            background-image:
                radial-gradient(rgba(var(--primary-rgb, 16,185,129), 0.24) 1.3px, transparent 1.3px),
                radial-gradient(at 100% 0%, rgba(var(--primary-rgb, 16,185,129), 0.12) 0px, transparent 55%);
            background-size: 24px 24px, 100% 100%;
            animation: none;
        }
        body[data-bg-pattern="grid"] .bg-pattern {
            background-image:
                linear-gradient(rgba(var(--primary-rgb, 0,255,102), 0.09) 1px, transparent 1px),
                linear-gradient(90deg, rgba(var(--primary-rgb, 0,255,102), 0.09) 1px, transparent 1px),
                radial-gradient(at 50% 0%, rgba(var(--primary-rgb, 0,255,102), 0.16) 0px, transparent 60%);
            background-size: 36px 36px, 36px 36px, 100% 100%;
            animation: none;
        }

        /* ===== EFECTO CRISTAL / MICA (TRANSPARENCIA ESTILO WINDOWS 11) ===== */
        body.ui-glass-mica {
            --panel-bg: rgba(255, 255, 255, 0.72);
        }
        body.dark-mode.ui-glass-mica {
            --panel-bg: rgba(15, 23, 42, 0.68);
        }
        body.ui-glass-mica .module-card,
        body.ui-glass-mica .settings-container,
        body.ui-glass-mica .dash-navbar,
        body.ui-glass-mica .setting-row,
        body.ui-glass-mica .app-card {
            backdrop-filter: blur(18px) saturate(140%);
            -webkit-backdrop-filter: blur(18px) saturate(140%);
        }

        /* ===== SUPER BOTÓN MULTIFUNCIÓN CON FLECHA SUPERIOR (▲) ===== */
        #ngnFabDock {
            position: fixed;
            bottom: 24px;
            right: 24px;
            z-index: 1003;
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 6px;
        }
        #ngnFabArrowBtn {
            width: 32px;
            height: 22px;
            border-radius: 11px;
            border: 1px solid var(--border-card);
            background: var(--panel-bg);
            color: var(--text-main);
            box-shadow: var(--shadow-base);
            backdrop-filter: blur(12px);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: transform 0.25s ease, border-color 0.2s ease, color 0.2s ease;
        }
        #ngnFabArrowBtn:hover {
            border-color: var(--primary-neon);
            color: var(--primary-neon);
            transform: translateY(-2px);
        }
        #ngnFabArrowBtn.open svg {
            transform: rotate(180deg);
        }
        #ngnFabArrowBtn svg {
            transition: transform 0.25s ease;
        }
        #ngnFabDock #superThemeOverlayBtn {
            position: static !important;
            width: 54px;
            height: 54px;
            border-radius: 50%;
            border: 2px solid rgba(255,255,255,0.22);
            background: var(--primary-neon);
            color: #fff;
            box-shadow: 0 10px 25px rgba(var(--primary-rgb, 16,185,129), 0.38);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: transform 0.25s ease, box-shadow 0.25s ease;
        }
        #ngnFabDock #superThemeOverlayBtn:hover {
            transform: scale(1.08);
        }
        .ngn-fab-popover {
            position: fixed;
            bottom: 114px;
            right: 24px;
            z-index: 1004;
            min-width: 248px;
            max-width: calc(100vw - 32px);
            background: var(--panel-bg);
            border: 1px solid var(--border-card);
            border-radius: 18px;
            padding: 0.9rem;
            box-shadow: 0 18px 40px rgba(0, 0, 0, 0.22);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            opacity: 0;
            pointer-events: none;
            transform: translateY(10px) scale(0.96);
            transition: opacity 0.22s ease, transform 0.22s ease;
        }
        .ngn-fab-popover.open {
            opacity: 1;
            pointer-events: auto;
            transform: translateY(0) scale(1);
        }
        .ngn-fab-opt {
            width: 100%;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            padding: 0.55rem 0.7rem;
            border-radius: 11px;
            border: 1px solid transparent;
            background: transparent;
            color: var(--text-main);
            font-size: 0.82rem;
            font-weight: 600;
            cursor: pointer;
            text-align: left;
            transition: background 0.18s ease, border-color 0.18s ease;
        }
        .ngn-fab-opt:hover {
            background: var(--icon-bg);
        }
        .ngn-fab-opt.active {
            background: var(--icon-bg);
            border-color: var(--primary-neon);
            color: var(--primary-neon);
        }

        /* ===== COMMAND PALETTE GLOBAL (CTRL + K) ===== */
        #ngnCommandOverlay {
            position: fixed;
            inset: 0;
            z-index: 3000;
            background: rgba(2, 6, 23, 0.58);
            backdrop-filter: blur(8px);
            display: none;
            align-items: flex-start;
            justify-content: center;
            padding: 10vh 16px 16px;
        }
        #ngnCommandOverlay.open {
            display: flex;
        }
        .ngn-cmd-dialog {
            width: 100%;
            max-width: 560px;
            background: var(--panel-bg);
            border: 1px solid var(--border-card);
            border-radius: 20px;
            box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
            overflow: hidden;
        }
        .ngn-cmd-item {
            width: 100%;
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 0.75rem 1rem;
            border: none;
            background: transparent;
            color: var(--text-main);
            cursor: pointer;
            text-align: left;
            border-radius: 12px;
            transition: background 0.15s ease;
        }
        .ngn-cmd-item:hover, .ngn-cmd-item.selected {
            background: var(--icon-bg);
        }

        /* ===== TARJETAS DE MOTOR CREATIVO EN AJUSTES ===== */
        .win-preview-shell {
            position: relative;
            height: 185px;
            border-radius: 18px;
            overflow: hidden;
            border: 1px solid var(--border-card);
            box-shadow: var(--shadow-base);
            display: flex;
            align-items: center;
            justify-content: flex-end;
            padding: 1.2rem;
            transition: background 0.35s ease;
        }
        .win-preview-window {
            width: 62%;
            height: 100%;
            border-radius: 12px;
            padding: 0.9rem;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            border: 1px solid rgba(255,255,255,0.22);
            box-shadow: 0 10px 30px rgba(0,0,0,0.25);
        }
        .preset-thumb-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
            gap: 0.85rem;
        }
        .preset-thumb-card {
            border-radius: 14px;
            border: 2px solid var(--border-card);
            background: var(--bg-color);
            overflow: hidden;
            cursor: pointer;
            transition: transform 0.2s ease, border-color 0.2s ease;
            text-align: left;
            padding: 0;
        }
        .preset-thumb-card:hover {
            transform: translateY(-2px);
            border-color: var(--primary-neon);
        }
        .preset-thumb-card.active {
            border-color: var(--primary-neon);
            box-shadow: 0 0 0 3px var(--icon-bg);
        }
        .preset-thumb-art {
            height: 68px;
            position: relative;
            background-size: cover;
        }
        .preset-thumb-mini {
            position: absolute;
            right: 8px;
            bottom: 8px;
            width: 34px;
            height: 24px;
            border-radius: 6px;
            padding: 4px;
            display: flex;
            align-items: flex-end;
            justify-content: flex-end;
            box-shadow: 0 4px 10px rgba(0,0,0,0.25);
        }
        .pattern-chip-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
            gap: 0.65rem;
        }
        .pattern-chip-btn {
            padding: 0.65rem 0.8rem;
            border-radius: 12px;
            border: 1px solid var(--border-card);
            background: var(--bg-color);
            color: var(--text-main);
            cursor: pointer;
            text-align: left;
            transition: border-color 0.2s ease, background 0.2s ease;
        }
        .pattern-chip-btn.active {
            border-color: var(--primary-neon);
            background: var(--icon-bg);
        }
    `;
    document.head.appendChild(style);
}

function scheduleCloudThemeSync(partialData = {}) {
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(async () => {
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session) return;

            const user = session.user;
            const currentMeta = {
                theme_color: localStorage.getItem('ngn_theme_color') || '#10b981',
                dark_mode: document.body.classList.contains('dark-mode'),
                super_theme: localStorage.getItem('ngn_super_theme') === 'true',
                theme_preset: localStorage.getItem('ngn_theme_preset') || 'material',
                bg_pattern: localStorage.getItem('ngn_bg_pattern') || 'aurora',
                ui_glass: localStorage.getItem('ngn_ui_glass') === 'true',
                fab_mode: localStorage.getItem('ngn_fab_mode') || 'palette',
                ...partialData
            };

            await Promise.all([
                supabase.auth.updateUser({ data: currentMeta }),
                supabase.from('profiles').update({
                    theme_color: currentMeta.theme_color,
                    dark_mode: currentMeta.dark_mode,
                    super_theme_enabled: currentMeta.super_theme,
                    updated_at: new Date().toISOString()
                }).eq('id', user.id)
            ]);
        } catch {
            // Silencioso si está offline
        }
    }, 350);
}

export function applyThemeColor(hexColor, syncCloud = false) {
    if (!hexColor || !hexColor.startsWith('#')) hexColor = '#10b981';
    ensureThemeEngineStyles();

    const { r, g, b } = hexToRgb(hexColor);
    document.documentElement.style.setProperty('--primary-neon', hexColor);
    document.documentElement.style.setProperty('--primary-rgb', `${r}, ${g}, ${b}`);
    document.documentElement.style.setProperty('--icon-bg', `rgba(${r}, ${g}, ${b}, 0.12)`);
    document.documentElement.style.setProperty('--bg-gradient-1', `rgba(${r}, ${g}, ${b}, 0.11)`);

    localStorage.setItem('ngn_theme_color', hexColor);
    updateQuickPopupsUI();
    if (syncCloud) scheduleCloudThemeSync({ theme_color: hexColor });
}

export function applyBackgroundPattern(patternId = 'aurora', syncCloud = false) {
    ensureThemeEngineStyles();
    const valid = BG_PATTERNS.some(p => p.id === patternId) ? patternId : 'aurora';
    document.body.setAttribute('data-bg-pattern', valid);
    localStorage.setItem('ngn_bg_pattern', valid);
    updateQuickPopupsUI();
    if (syncCloud) scheduleCloudThemeSync({ bg_pattern: valid });
}

export function applyGlassMode(enabled, syncCloud = false) {
    ensureThemeEngineStyles();
    const isOn = Boolean(enabled);
    document.body.classList.toggle('ui-glass-mica', isOn);
    localStorage.setItem('ngn_ui_glass', String(isOn));
    if (syncCloud) scheduleCloudThemeSync({ ui_glass: isOn });
}

export function setDarkMode(isDark, syncCloud = false) {
    ensureThemeEngineStyles();
    document.body.classList.toggle('dark-mode', Boolean(isDark));
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateQuickPopupsUI();
    if (syncCloud) scheduleCloudThemeSync({ dark_mode: Boolean(isDark) });
}

export function toggleDarkLight(syncCloud = true) {
    const nextDark = !document.body.classList.contains('dark-mode');
    setDarkMode(nextDark, syncCloud);
}

export function applyThemePreset(presetId, syncCloud = true) {
    const preset = THEME_PRESETS.find(p => p.id === presetId);
    if (!preset) return null;

    localStorage.setItem('ngn_theme_preset', preset.id);
    applyThemeColor(preset.color, false);
    setDarkMode(preset.dark, false);
    applyBackgroundPattern(preset.pattern, false);
    applyGlassMode(preset.glass, false);

    if (syncCloud) {
        scheduleCloudThemeSync({
            theme_preset: preset.id,
            theme_color: preset.color,
            dark_mode: preset.dark,
            bg_pattern: preset.pattern,
            ui_glass: preset.glass
        });
    }
    return preset;
}

export function getFabShortcut() {
    const saved = localStorage.getItem('ngn_fab_mode') || 'palette';
    return FAB_SHORTCUTS.find(s => s.id === saved) || FAB_SHORTCUTS[0];
}

export function setFabShortcut(modeId, syncCloud = true) {
    const valid = FAB_SHORTCUTS.find(s => s.id === modeId) || FAB_SHORTCUTS[0];
    localStorage.setItem('ngn_fab_mode', valid.id);

    const mainBtn = document.getElementById('superThemeOverlayBtn');
    if (mainBtn) {
        mainBtn.innerHTML = valid.icon;
        mainBtn.setAttribute('title', `Atajo activo: ${valid.label} (usa ▲ para cambiar)`);
        mainBtn.setAttribute('aria-label', valid.label);
    }

    updateQuickPopupsUI();
    if (syncCloud) scheduleCloudThemeSync({ fab_mode: valid.id });
    return valid;
}

export function syncThemeFromUserMetadata(user) {
    if (!user?.user_metadata) return;
    const m = user.user_metadata;

    if (m.theme_preset) localStorage.setItem('ngn_theme_preset', m.theme_preset);
    if (m.theme_color) applyThemeColor(m.theme_color, false);
    if (typeof m.dark_mode === 'boolean') setDarkMode(m.dark_mode, false);
    if (m.bg_pattern) applyBackgroundPattern(m.bg_pattern, false);
    if (typeof m.ui_glass === 'boolean') applyGlassMode(m.ui_glass, false);
    if (m.fab_mode) localStorage.setItem('ngn_fab_mode', m.fab_mode);

    if (typeof m.super_theme === 'boolean') {
        localStorage.setItem('ngn_super_theme', String(m.super_theme));
    }

    if (localStorage.getItem('ngn_super_theme') === 'true') {
        injectSuperButton();
        setFabShortcut(localStorage.getItem('ngn_fab_mode') || 'palette', false);
    } else {
        removeSuperButton();
    }
}

function closeAllFabPopovers() {
    document.getElementById('superThemeMenuPopup')?.classList.remove('open');
    document.getElementById('ngnFabSwitcherMenu')?.classList.remove('open');
    document.getElementById('ngnFabArrowBtn')?.classList.remove('open');
}

function updateQuickPopupsUI() {
    const currentColor = localStorage.getItem('ngn_theme_color') || '#10b981';
    const currentPattern = localStorage.getItem('ngn_bg_pattern') || 'aurora';
    const currentFab = localStorage.getItem('ngn_fab_mode') || 'palette';
    const isDark = document.body.classList.contains('dark-mode');

    const darkBtnLabel = document.querySelector('#superThemeDarkModeBtn span');
    if (darkBtnLabel) darkBtnLabel.textContent = isDark ? 'Cambiar a Modo Día' : 'Cambiar a Modo Noche';

    document.querySelectorAll('.super-color-dot').forEach(dot => {
        dot.style.borderColor = dot.getAttribute('data-col') === currentColor ? 'var(--text-main)' : 'transparent';
    });

    document.querySelectorAll('.super-pattern-pill').forEach(pill => {
        const active = pill.getAttribute('data-pattern') === currentPattern;
        pill.style.borderColor = active ? 'var(--primary-neon)' : 'var(--border-card)';
        pill.style.color = active ? 'var(--primary-neon)' : 'var(--text-muted)';
    });

    document.querySelectorAll('#ngnFabSwitcherMenu .ngn-fab-opt').forEach(opt => {
        opt.classList.toggle('active', opt.getAttribute('data-fab-mode') === currentFab);
    });
}

async function runFabAction(modeId) {
    if (modeId === 'palette') {
        const switcher = document.getElementById('ngnFabSwitcherMenu');
        const arrow = document.getElementById('ngnFabArrowBtn');
        switcher?.classList.remove('open');
        arrow?.classList.remove('open');
        document.getElementById('superThemeMenuPopup')?.classList.toggle('open');
        return;
    }

    closeAllFabPopovers();

    if (modeId === 'darkmode') {
        toggleDarkLight(true);
        return;
    }
    if (modeId === 'search') {
        openCommandPalette();
        return;
    }

    const routeMap = {
        agenda: '/views/agenda.html',
        finance: '/views/finance.html',
        dashboard: '/views/dashboard.html'
    };
    if (routeMap[modeId]) {
        const { navigateTo } = await import('./router.js');
        await navigateTo(routeMap[modeId]);
    }
}

export function injectSuperButton() {
    ensureThemeEngineStyles();
    if (document.getElementById('ngnFabDock')) return;

    const originalBtn = document.getElementById('themeToggle');
    if (originalBtn) originalBtn.style.display = 'none';

    const activeShortcut = getFabShortcut();
    const currentColor = localStorage.getItem('ngn_theme_color') || '#10b981';
    const currentPattern = localStorage.getItem('ngn_bg_pattern') || 'aurora';
    const isDark = document.body.classList.contains('dark-mode');

    // Contenedor Dock (Flecha ▲ arriba + Botón Principal abajo)
    const dock = document.createElement('div');
    dock.id = 'ngnFabDock';

    const arrowBtn = document.createElement('button');
    arrowBtn.type = 'button';
    arrowBtn.id = 'ngnFabArrowBtn';
    arrowBtn.setAttribute('aria-label', 'Cambiar atajo del botón flotante');
    arrowBtn.setAttribute('title', 'Cambiar función del botón rápido');
    arrowBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><polyline points="18 15 12 9 6 15"></polyline></svg>';

    const superBtn = document.createElement('button');
    superBtn.type = 'button';
    superBtn.id = 'superThemeOverlayBtn';
    superBtn.setAttribute('aria-label', activeShortcut.label);
    superBtn.setAttribute('title', `Atajo activo: ${activeShortcut.label} (usa ▲ para cambiar)`);
    superBtn.innerHTML = activeShortcut.icon;

    dock.appendChild(arrowBtn);
    dock.appendChild(superBtn);

    // Popover 1: Selector de Atajos (se abre con la flecha ▲)
    const switcherMenu = document.createElement('div');
    switcherMenu.id = 'ngnFabSwitcherMenu';
    switcherMenu.className = 'ngn-fab-popover';
    switcherMenu.innerHTML = `
        <div style="font-size: 0.72rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 0.55rem; padding: 0 4px;">
            ⚡ Intercambiar función del botón
        </div>
        <div style="display: flex; flex-direction: column; gap: 4px;">
            ${FAB_SHORTCUTS.map(s => `
                <button type="button" class="ngn-fab-opt ${s.id === activeShortcut.id ? 'active' : ''}" data-fab-mode="${s.id}">
                    <span style="display: flex; align-items: center; gap: 9px;">
                        <span style="display: inline-flex; transform: scale(0.82);">${s.icon}</span>
                        <span>${s.label}</span>
                    </span>
                    <span style="font-size: 0.7rem; opacity: 0.75;">${s.id === activeShortcut.id ? '●' : ''}</span>
                </button>
            `).join('')}
        </div>
    `;

    // Popover 2: Menú Rápido de Paleta, Patrones y Día/Noche
    const superMenu = document.createElement('div');
    superMenu.id = 'superThemeMenuPopup';
    superMenu.className = 'ngn-fab-popover';
    superMenu.innerHTML = `
        <div style="font-size: 0.72rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.5rem;">🎨 Color de énfasis</div>
        <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 0.75rem;">
            ${PALETTE_COLORS.map(col => `
                <button type="button" class="super-color-dot" data-col="${col}" aria-label="Color ${col}" style="width: 26px; height: 26px; border-radius: 50%; background: ${col}; cursor: pointer; border: 2px solid ${currentColor === col ? 'var(--text-main)' : 'transparent'}; transition: 0.2s;"></button>
            `).join('')}
        </div>
        <div style="font-size: 0.72rem; font-weight: 800; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.45rem;">✨ Patrón de fondo</div>
        <div style="display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 0.75rem;">
            ${BG_PATTERNS.slice(0, 6).map(p => `
                <button type="button" class="super-pattern-pill" data-pattern="${p.id}" style="padding: 3px 8px; border-radius: 8px; font-size: 0.72rem; font-weight: 600; background: var(--bg-color); border: 1px solid ${currentPattern === p.id ? 'var(--primary-neon)' : 'var(--border-card)'}; color: ${currentPattern === p.id ? 'var(--primary-neon)' : 'var(--text-muted)'}; cursor: pointer;">
                    ${p.name.split(' ')[0]}
                </button>
            `).join('')}
        </div>
        <hr style="border: none; border-top: 1px solid var(--border-card); margin: 0.55rem 0;">
        <button type="button" id="superThemeDarkModeBtn" class="ngn-fab-opt" style="padding: 0.48rem 0.5rem;">
            <span style="display: flex; align-items: center; gap: 8px;">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
                <span>${isDark ? 'Cambiar a Modo Día' : 'Cambiar a Modo Noche'}</span>
            </span>
        </button>
        <button type="button" id="superOpenSettingsBtn" class="ngn-fab-opt" style="padding: 0.48rem 0.5rem;">
            <span>⚙️ Más temas en Motor Creativo →</span>
        </button>
    `;

    document.body.appendChild(dock);
    document.body.appendChild(switcherMenu);
    document.body.appendChild(superMenu);

    // Flecha ▲: abre/cierra selector de atajos
    arrowBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        superMenu.classList.remove('open');
        const opening = !switcherMenu.classList.contains('open');
        switcherMenu.classList.toggle('open', opening);
        arrowBtn.classList.toggle('open', opening);
    });

    // Botón principal: ejecuta el atajo seleccionado
    superBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const currentMode = localStorage.getItem('ngn_fab_mode') || 'palette';
        runFabAction(currentMode);
    });

    // Intercambiar atajo activo desde la lista de la flecha ▲
    switcherMenu.querySelectorAll('.ngn-fab-opt').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const chosenMode = btn.getAttribute('data-fab-mode');
            setFabShortcut(chosenMode, true);
            switcherMenu.querySelectorAll('.ngn-fab-opt').forEach(o => {
                const isSel = o.getAttribute('data-fab-mode') === chosenMode;
                o.classList.toggle('active', isSel);
                const dotSpan = o.lastElementChild;
                if (dotSpan) dotSpan.textContent = isSel ? '●' : '';
            });
            closeAllFabPopovers();
        });
    });

    // Eventos del menú de paleta rápida
    superMenu.querySelectorAll('.super-color-dot').forEach(dot => {
        dot.addEventListener('click', (e) => {
            e.stopPropagation();
            const newColor = dot.getAttribute('data-col');
            applyThemeColor(newColor, true);
            document.querySelectorAll('.theme-card').forEach(c => {
                c.classList.toggle('active', c.getAttribute('data-color') === newColor);
            });
        });
    });

    superMenu.querySelectorAll('.super-pattern-pill').forEach(pill => {
        pill.addEventListener('click', (e) => {
            e.stopPropagation();
            applyBackgroundPattern(pill.getAttribute('data-pattern'), true);
        });
    });

    superMenu.querySelector('#superThemeDarkModeBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDarkLight(true);
    });

    superMenu.querySelector('#superOpenSettingsBtn').addEventListener('click', async (e) => {
        e.stopPropagation();
        closeAllFabPopovers();
        const { navigateTo } = await import('./router.js');
        await navigateTo('/views/settings.html');
    });
}

export function removeSuperButton() {
    document.getElementById('ngnFabDock')?.remove();
    document.getElementById('superThemeOverlayBtn')?.remove();
    document.getElementById('superThemeMenuPopup')?.remove();
    document.getElementById('ngnFabSwitcherMenu')?.remove();

    const originalBtn = document.getElementById('themeToggle');
    if (originalBtn) originalBtn.style.display = 'flex';
}

// ===== COMMAND PALETTE GLOBAL (CTRL + K) FUNCIONAL EN WEB, DESKTOP Y APK =====
function ensureCommandPaletteDOM() {
    if (document.getElementById('ngnCommandOverlay')) return;
    ensureThemeEngineStyles();

    const overlay = document.createElement('div');
    overlay.id = 'ngnCommandOverlay';
    overlay.innerHTML = `
        <div class="ngn-cmd-dialog" role="dialog" aria-label="Buscador rápido de módulos">
            <div style="display: flex; align-items: center; gap: 10px; padding: 0.9rem 1.1rem; border-bottom: 1px solid var(--border-card);">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--primary-neon)" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <input type="search" id="ngnCmdInput" placeholder="Ir a Finanzas, Agendas, Deudas, Ajustes..." style="flex: 1; border: none; outline: none; background: transparent; color: var(--text-main); font-size: 0.96rem;">
                <button type="button" id="ngnCmdClose" class="btn-outline" style="padding: 3px 8px; font-size: 0.72rem;">ESC</button>
            </div>
            <div id="ngnCmdResults" style="padding: 0.6rem; max-height: 360px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px;"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    const input = overlay.querySelector('#ngnCmdInput');
    const resultsEl = overlay.querySelector('#ngnCmdResults');
    const closeBtn = overlay.querySelector('#ngnCmdClose');

    const renderList = (term = '') => {
        const norm = term.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const matches = COMMAND_ITEMS.filter(item =>
            !norm ||
            item.label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(norm) ||
            item.keywords.includes(norm)
        );

        resultsEl.innerHTML = '';
        if (matches.length === 0) {
            resultsEl.innerHTML = `<p style="text-align: center; color: var(--text-muted); font-size: 0.85rem; padding: 1.2rem 0;">Sin coincidencias para "${term}"</p>`;
            return;
        }

        matches.forEach((item, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `ngn-cmd-item ${idx === 0 ? 'selected' : ''}`;
            btn.innerHTML = `
                <span style="font-size: 1.2rem;">${item.icon}</span>
                <div style="flex: 1;">
                    <div style="font-size: 0.9rem; font-weight: 700; color: var(--text-main);">${item.label}</div>
                    <div style="font-size: 0.76rem; color: var(--text-muted);">${item.desc}</div>
                </div>
                <span style="font-size: 0.72rem; color: var(--primary-neon); font-weight: 700;">↵</span>
            `;
            btn.addEventListener('click', async () => {
                closeCommandPalette();
                const { navigateTo } = await import('./router.js');
                await navigateTo(item.path);
            });
            resultsEl.appendChild(btn);
        });
    };

    input.addEventListener('input', () => renderList(input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            resultsEl.querySelector('.ngn-cmd-item')?.click();
        } else if (e.key === 'Escape') {
            closeCommandPalette();
        }
    });

    closeBtn.addEventListener('click', closeCommandPalette);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeCommandPalette();
    });

    renderList('');
}

export function openCommandPalette() {
    ensureCommandPaletteDOM();
    const overlay = document.getElementById('ngnCommandOverlay');
    const input = document.getElementById('ngnCmdInput');
    if (overlay) overlay.classList.add('open');
    if (input) {
        input.value = '';
        input.dispatchEvent(new Event('input'));
        setTimeout(() => input.focus(), 40);
    }
}

export function closeCommandPalette() {
    document.getElementById('ngnCommandOverlay')?.classList.remove('open');
}

function bindGlobalThemeListeners() {
    if (globalListenersBound) return;
    globalListenersBound = true;

    document.addEventListener('click', (e) => {
        const dock = document.getElementById('ngnFabDock');
        const menu = document.getElementById('superThemeMenuPopup');
        const switcher = document.getElementById('ngnFabSwitcherMenu');
        if (!dock?.contains(e.target) && !menu?.contains(e.target) && !switcher?.contains(e.target)) {
            closeAllFabPopovers();
        }
    });

    // Atajo global Ctrl+K / Cmd+K funcional también dentro de vistas privadas
    document.addEventListener('keydown', async (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
            const dynamicView = document.getElementById('dynamic-view');
            const isPrivateVisible = dynamicView && dynamicView.style.display !== 'none';
            if (isPrivateVisible) {
                e.preventDefault();
                openCommandPalette();
            }
        } else if (e.key === 'Escape') {
            closeCommandPalette();
            closeAllFabPopovers();
        }
    });
}

export function initTheme() {
    ensureThemeEngineStyles();
    bindGlobalThemeListeners();

    if (localStorage.getItem('theme') === 'dark') {
        document.body.classList.add('dark-mode');
    }

    const savedColor = localStorage.getItem('ngn_theme_color') || '#10b981';
    const savedPattern = localStorage.getItem('ngn_bg_pattern') || 'aurora';
    const savedGlass = localStorage.getItem('ngn_ui_glass') === 'true';

    applyThemeColor(savedColor, false);
    applyBackgroundPattern(savedPattern, false);
    applyGlassMode(savedGlass, false);

    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => toggleDarkLight(true));
    }

    if (localStorage.getItem('ngn_super_theme') === 'true') {
        injectSuperButton();
    }
}