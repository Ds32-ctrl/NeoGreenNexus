// public/js/controllers/home-hub.controller.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from '../core/router.js';
import { showToast } from '../ui/toast.js';

let clockInterval = null;
let audioCtx = null;
let activeSource = null;
let gainNode = null;
let isPlayingAudio = false;
let currentAudioMode = 'brown';

// Utilidad para prevenir inyección XSS al renderizar texto del usuario
function escapeHTML(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export async function initHomeHub() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        navigateTo('/');
        return;
    }

    initClockAndWeather();
    initCalculator();
    initAmbientSynthesizer();
    await loadHubTelemetry(user.id);

    // Formulario de creación rápida de alertas en family_board_posts
    const quickForm = document.getElementById('quickAlertForm');
    if (quickForm) {
        quickForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = document.getElementById('quickAlertInput');
            const typeSelect = document.getElementById('quickAlertType');
            const text = input?.value.trim();
            if (!text) return;

            const submitBtn = quickForm.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;

            try {
                const { error } = await supabase.from('family_board_posts').insert({
                    user_id: user.id,
                    title: typeSelect.value.toUpperCase(),
                    content: text,
                    category: typeSelect.value,
                    pinned: typeSelect.value === 'alerta'
                });

                if (error) throw error;

                input.value = '';
                showToast('Registro añadido al núcleo 360 Home.', 'success');
                await loadHubTelemetry(user.id);
            } catch (error) {
                showToast('Error al guardar alerta: ' + error.message, 'error');
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }
}

// 1. TELEMETRÍA CONSOLIDADA DESDE SUPABASE
async function loadHubTelemetry(userId) {
    try {
        const [financeRes, tasksRes, inventoryRes, habitsRes, boardRes] = await Promise.all([
            supabase.from('finance_transactions').select('amount, type, created_at').eq('user_id', userId),
            supabase.from('zone_tasks').select('id, title, frequency, is_completed').eq('user_id', userId).eq('is_completed', false),
            supabase.from('inventory_items').select('id, name, quantity, unit, min_stock, in_shopping_list').eq('user_id', userId),
            supabase.from('habits').select('id, title, current_streak').eq('user_id', userId),
            supabase.from('family_board_posts').select('id, title, content, category, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(8)
        ]);

        // A. Cálculo de Balance Financiero
        const transactions = financeRes.data || [];
        let income = 0, expense = 0;
        transactions.forEach(t => {
            if (t.type === 'ingreso') income += Number(t.amount || 0);
            else expense += Number(t.amount || 0);
        });
        const balance = income - expense;
        const kpiBalance = document.getElementById('kpiBalance');
        const kpiFinanceSub = document.getElementById('kpiFinanceSub');
        if (kpiBalance) {
            kpiBalance.textContent = `$${balance.toLocaleString('es-CO', { minimumFractionDigits: 2 })}`;
            kpiBalance.style.color = balance >= 0 ? 'var(--primary-neon)' : 'var(--danger-color, #ef4444)';
        }
        if (kpiFinanceSub) {
            kpiFinanceSub.textContent = transactions.length > 0
                ? `Ingresos: $${income.toLocaleString('es-CO')} | Gastos: $${expense.toLocaleString('es-CO')}`
                : 'Sin movimientos registrados';
        }

        // B. Tareas de Zonas Pendientes
        const pendingTasks = tasksRes.data || [];
        const kpiPendingTasks = document.getElementById('kpiPendingTasks');
        const kpiZonesSub = document.getElementById('kpiZonesSub');
        if (kpiPendingTasks) kpiPendingTasks.textContent = pendingTasks.length;
        if (kpiZonesSub) {
            kpiZonesSub.textContent = pendingTasks.length === 1
                ? '1 mantenimiento pendiente'
                : `${pendingTasks.length} mantenimientos pendientes`;
        }

        // C. Alertas de Stock en Despensa
        const items = inventoryRes.data || [];
        const lowStockItems = items.filter(i => Number(i.quantity) <= Number(i.min_stock) || i.in_shopping_list);
        const kpiLowStock = document.getElementById('kpiLowStock');
        if (kpiLowStock) {
            kpiLowStock.textContent = lowStockItems.length;
            kpiLowStock.style.color = lowStockItems.length > 0 ? 'var(--warning-color, #f59e0b)' : 'var(--text-main)';
        }

        // D. Hábitos y Rachas
        const habits = habitsRes.data || [];
        const kpiHabitsCount = document.getElementById('kpiHabitsCount');
        const kpiHabitsSub = document.getElementById('kpiHabitsSub');
        if (kpiHabitsCount) kpiHabitsCount.textContent = habits.length;
        if (kpiHabitsSub) {
            if (habits.length > 0) {
                const bestStreak = Math.max(...habits.map(h => Number(h.current_streak || 0)));
                kpiHabitsSub.textContent = `Mejor racha actual: ${bestStreak} días`;
            } else {
                kpiHabitsSub.textContent = 'Rutinas configuradas';
            }
        }

        // E. Renderizar Feed Consolidado (Tablero + Tareas + Alertas de Despensa)
        renderConsolidatedFeed(boardRes.data || [], pendingTasks, lowStockItems, userId);

    } catch (err) {
        console.error('Error cargando telemetría 360 Home:', err);
    }
}

function renderConsolidatedFeed(posts, tasks, lowStock, userId) {
    const feedContainer = document.getElementById('hubFeedList');
    if (!feedContainer) return;

    feedContainer.innerHTML = '';

    if (posts.length === 0 && tasks.length === 0 && lowStock.length === 0) {
        feedContainer.innerHTML = `<p class="hub-empty-msg">Tu entorno está en orden. No hay alertas, compras urgentes ni tareas pendientes.</p>`;
        return;
    }

    // 1. Mostrar notas/alertas del tablero compartido
    posts.forEach(post => {
        const isAlert = post.category === 'alerta';
        const badgeColor = isAlert ? 'var(--danger-color, #ef4444)' : 'var(--primary-neon)';
        const row = document.createElement('div');
        row.className = 'setting-row hub-feed-item';
        row.innerHTML = `
            <div class="setting-info">
                <h4 style="font-size: 0.82rem; color: ${badgeColor}; text-transform: uppercase;">${escapeHTML(post.category)}</h4>
                <p style="color: var(--text-main); font-size: 0.92rem;">${escapeHTML(post.content)}</p>
            </div>
            <button type="button" class="btn-outline btn-delete-post" title="Descartar aviso">✓</button>
        `;
        row.querySelector('.btn-delete-post').addEventListener('click', async () => {
            await supabase.from('family_board_posts').delete().eq('id', post.id);
            await loadHubTelemetry(userId);
        });
        feedContainer.appendChild(row);
    });

    // 2. Mostrar tareas de mantenimiento de zonas pendientes
    tasks.slice(0, 4).forEach(task => {
        const row = document.createElement('div');
        row.className = 'setting-row hub-feed-item';
        row.innerHTML = `
            <div class="setting-info">
                <h4 style="font-size: 0.82rem; color: var(--info-color, #0ea5e9);">MANTENIMIENTO (${escapeHTML(task.frequency || 'General')})</h4>
                <p style="color: var(--text-main); font-size: 0.92rem;">${escapeHTML(task.title)}</p>
            </div>
            <button type="button" class="btn-outline btn-complete-task">Completar</button>
        `;
        row.querySelector('.btn-complete-task').addEventListener('click', async () => {
            await supabase.from('zone_tasks').update({ is_completed: true }).eq('id', task.id);
            showToast('Tarea marcada como completada.', 'success');
            await loadHubTelemetry(userId);
        });
        feedContainer.appendChild(row);
    });

    // 3. Mostrar alertas de stock bajo en Despensa Inteligente
    lowStock.slice(0, 4).forEach(item => {
        const row = document.createElement('div');
        row.className = 'setting-row hub-feed-item';
        const unitLabel = item.unit ? ` ${escapeHTML(item.unit)}` : '';
        row.innerHTML = `
            <div class="setting-info">
                <h4 style="font-size: 0.82rem; color: var(--warning-color, #f59e0b);">DESPENSA (STOCK BAJO: ${Number(item.quantity)}${unitLabel})</h4>
                <p style="color: var(--text-main); font-size: 0.92rem;">Reabastecer: ${escapeHTML(item.name)}</p>
            </div>
            <button type="button" class="btn-outline encrypted-route" data-target="/views/inventory.html">Ver Stock</button>
        `;
        feedContainer.appendChild(row);
    });
}

// 2. RELOJ EN VIVO Y CLIMA (OPEN-METEO)
function initClockAndWeather() {
    if (clockInterval) clearInterval(clockInterval);

    const updateClock = () => {
        const clockEl = document.getElementById('hubClock');
        const dateEl = document.getElementById('hubDate');
        if (!clockEl || !dateEl) {
            clearInterval(clockInterval);
            return;
        }

        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString('es-CO', { hour12: false });
        dateEl.textContent = now.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
    };
    updateClock();
    clockInterval = setInterval(updateClock, 1000);

    // Clima automático (Por defecto Floridablanca/Bucaramanga si no hay permiso de geolocalización)
    const fetchWeather = async (lat = 7.0622, lon = -73.0864) => {
        try {
            const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`);
            const data = await res.json();
            if (data.current_weather) {
                const tempEl = document.getElementById('hubTemp');
                const descEl = document.getElementById('hubWeatherDesc');
                if (tempEl) tempEl.textContent = `${Math.round(data.current_weather.temperature)}°C`;
                if (descEl) descEl.textContent = `Viento ${data.current_weather.windspeed} km/h`;
            }
        } catch {
            // Silencioso si está sin conexión
        }
    };

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => fetchWeather(pos.coords.latitude, pos.coords.longitude),
            () => fetchWeather(),
            { timeout: 4000 }
        );
    } else {
        fetchWeather();
    }
}

// 3. CALCULADORA RÁPIDA INTEGRADA
function initCalculator() {
    const display = document.getElementById('calcDisplay');
    const keysContainer = document.getElementById('calcKeys');
    if (!display || !keysContainer) return;

    let expression = '';

    keysContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-key]');
        if (!btn) return;
        const key = btn.dataset.key;

        if (key === 'C') {
            expression = '';
            display.value = '0';
        } else if (key === '=') {
            try {
                if (!expression || !/^[0-9+\-*/().\s]+$/.test(expression)) throw new Error('Inválido');
                const result = Function(`"use strict"; return (${expression})`)();
                display.value = Number.isFinite(result) ? Number(result.toFixed(4)) : 'Error';
                expression = display.value === 'Error' ? '' : String(display.value);
            } catch {
                display.value = 'Error';
                expression = '';
            }
        } else {
            expression += key;
            display.value = expression;
        }
    });
}

// 4. SINTETIZADOR AMBIENTAL WEB AUDIO API (PERSISTENTE ENTRE VISTAS)
function initAmbientSynthesizer() {
    const btnToggle = document.getElementById('btnToggleAudio');
    const volumeSlider = document.getElementById('audioVolume');
    const presetBtns = document.querySelectorAll('.audio-preset');
    if (!btnToggle) return;

    const syncAudioUI = () => {
        if (isPlayingAudio) {
            btnToggle.textContent = 'Detener Audio';
            btnToggle.style.background = 'var(--danger-color, #ef4444)';
            btnToggle.style.color = '#fff';
        } else {
            btnToggle.textContent = 'Activar Audio';
            btnToggle.style.background = 'var(--primary-neon)';
            btnToggle.style.color = '#000';
        }

        presetBtns.forEach(b => {
            const isCurrent = b.dataset.mode === currentAudioMode;
            b.classList.toggle('active', isCurrent);
            b.style.borderColor = isCurrent ? 'var(--primary-neon)' : 'var(--border-card)';
            b.style.color = isCurrent ? 'var(--primary-neon)' : 'var(--text-muted)';
        });
    };

    const stopCurrentAudio = () => {
        if (activeSource) {
            try { activeSource.stop(); } catch {}
            activeSource.disconnect();
            activeSource = null;
        }
    };

    const startAudioMode = (mode) => {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            gainNode = audioCtx.createGain();
            gainNode.gain.value = Number(volumeSlider?.value || 0.15);
            gainNode.connect(audioCtx.destination);
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        stopCurrentAudio();

        if (mode === 'binaural') {
            const osc = audioCtx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(432, audioCtx.currentTime);
            osc.connect(gainNode);
            osc.start();
            activeSource = osc;
        } else {
            const bufferSize = audioCtx.sampleRate * 3;
            const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
            const data = buffer.getChannelData(0);
            let lastOut = 0.0;
            for (let i = 0; i < bufferSize; i++) {
                const white = Math.random() * 2 - 1;
                if (mode === 'brown') {
                    data[i] = (lastOut + (0.02 * white)) / 1.02;
                    lastOut = data[i];
                    data[i] *= 3.5;
                } else {
                    data[i] = white * 0.35;
                }
            }
            const noise = audioCtx.createBufferSource();
            noise.buffer = buffer;
            noise.loop = true;
            noise.connect(gainNode);
            noise.start();
            activeSource = noise;
        }
    };

    // Sincronizar UI por si el usuario dejó el audio encendido mientras navegaba
    syncAudioUI();

    btnToggle.addEventListener('click', () => {
        isPlayingAudio = !isPlayingAudio;
        if (isPlayingAudio) {
            startAudioMode(currentAudioMode);
        } else {
            stopCurrentAudio();
        }
        syncAudioUI();
    });

    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            currentAudioMode = btn.dataset.mode;
            if (isPlayingAudio) startAudioMode(currentAudioMode);
            syncAudioUI();
        });
    });

    if (volumeSlider) {
        if (gainNode) volumeSlider.value = gainNode.gain.value;
        volumeSlider.addEventListener('input', (e) => {
            if (gainNode) gainNode.gain.value = Number(e.target.value);
        });
    }
}