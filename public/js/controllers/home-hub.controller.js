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
            const text = input.value.trim();
            if (!text) return;

            const { error } = await supabase.from('family_board_posts').insert({
                user_id: user.id,
                title: typeSelect.value.toUpperCase(),
                content: text,
                category: typeSelect.value,
                pinned: typeSelect.value === 'alerta'
            });

            if (error) {
                showToast('Error al guardar alerta: ' + error.message, 'error');
            } else {
                input.value = '';
                showToast('Registro añadido al núcleo', 'success');
                await loadHubTelemetry(user.id);
            }
        });
    }
}

// 1. TELEMETRÍA CONSOLIDADA DESDE SUPABASE
async function loadHubTelemetry(userId) {
    try {
        const [financeRes, tasksRes, inventoryRes, habitsRes, boardRes] = await Promise.all([
            supabase.from('finance_transactions').select('amount, type').eq('user_id', userId),
            supabase.from('zone_tasks').select('id, title, frequency, is_completed').eq('user_id', userId).eq('is_completed', false),
            supabase.from('inventory_items').select('id, name, quantity, min_stock, in_shopping_list').eq('user_id', userId),
            supabase.from('habits').select('id, title, current_streak').eq('user_id', userId),
            supabase.from('family_board_posts').select('id, title, content, category, created_at').eq('user_id', userId).order('created_at', { ascending: false }).limit(8)
        ]);

        // Cálculo de Balance Financiero
        const transactions = financeRes.data || [];
        let income = 0, expense = 0;
        transactions.forEach(t => {
            if (t.type === 'ingreso') income += Number(t.amount);
            else expense += Number(t.amount);
        });
        const balance = income - expense;
        const kpiBalance = document.getElementById('kpiBalance');
        const kpiFinanceSub = document.getElementById('kpiFinanceSub');
        if (kpiBalance) {
            kpiBalance.textContent = `$${balance.toLocaleString('es-CO', { minimumFractionDigits: 2 })}`;
            kpiBalance.style.color = balance >= 0 ? 'var(--primary-neon)' : 'var(--danger-color)';
        }
        if (kpiFinanceSub) {
            kpiFinanceSub.textContent = `Ingresos: $${income.toLocaleString('es-CO')} | Gastos: $${expense.toLocaleString('es-CO')}`;
        }

        // Tareas de Zonas Pendientes
        const pendingTasks = tasksRes.data || [];
        const kpiPendingTasks = document.getElementById('kpiPendingTasks');
        if (kpiPendingTasks) kpiPendingTasks.textContent = pendingTasks.length;

        // Alertas de Stock en Despensa
        const items = inventoryRes.data || [];
        const lowStockItems = items.filter(i => Number(i.quantity) <= Number(i.min_stock) || i.in_shopping_list);
        const kpiLowStock = document.getElementById('kpiLowStock');
        if (kpiLowStock) {
            kpiLowStock.textContent = lowStockItems.length;
            if (lowStockItems.length > 0) kpiLowStock.style.color = 'var(--warning-color)';
        }

        // Hábitos y Rachas
        const habits = habitsRes.data || [];
        const kpiHabitsCount = document.getElementById('kpiHabitsCount');
        const kpiHabitsSub = document.getElementById('kpiHabitsSub');
        if (kpiHabitsCount) kpiHabitsCount.textContent = habits.length;
        if (kpiHabitsSub && habits.length > 0) {
            const bestStreak = Math.max(...habits.map(h => h.current_streak || 0));
            kpiHabitsSub.textContent = `Mejor racha actual: ${bestStreak} días`;
        }

        // Renderizar Feed Consolidado (Alertas del Tablero + Tareas Pendientes)
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
        feedContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 1.5rem 0;">Tu entorno está en orden. No hay alertas ni tareas pendientes.</p>`;
        return;
    }

    // Mostrar notas/alertas del tablero
    posts.forEach(post => {
        const badgeColor = post.category === 'alerta' ? 'var(--danger-color)' : 'var(--primary-neon)';
        const row = document.createElement('div');
        row.className = 'setting-row';
        row.style.marginBottom = '0';
        row.style.padding = '0.9rem 1.2rem';
        row.innerHTML = `
            <div class="setting-info">
                <h4 style="font-size: 0.9rem; color: ${badgeColor}; text-transform: uppercase;">${post.category}</h4>
                <p style="color: var(--text-main); font-size: 0.92rem;">${post.content}</p>
            </div>
            <button type="button" class="btn-outline btn-delete-post" data-id="${post.id}" title="Descartar">✓</button>
        `;
        row.querySelector('.btn-delete-post').addEventListener('click', async () => {
            await supabase.from('family_board_posts').delete().eq('id', post.id);
            await loadHubTelemetry(userId);
        });
        feedContainer.appendChild(row);
    });

    // Mostrar tareas de zonas pendientes
    tasks.slice(0, 4).forEach(task => {
        const row = document.createElement('div');
        row.className = 'setting-row';
        row.style.marginBottom = '0';
        row.style.padding = '0.9rem 1.2rem';
        row.innerHTML = `
            <div class="setting-info">
                <h4 style="font-size: 0.85rem; color: var(--info-color);">MANTENIMIENTO (${task.frequency})</h4>
                <p style="color: var(--text-main); font-size: 0.92rem;">${task.title}</p>
            </div>
            <button type="button" class="btn-outline btn-complete-task" data-id="${task.id}">Completar</button>
        `;
        row.querySelector('.btn-complete-task').addEventListener('click', async () => {
            await supabase.from('zone_tasks').update({ is_completed: true }).eq('id', task.id);
            showToast('Tarea marcada como completada', 'success');
            await loadHubTelemetry(userId);
        });
        feedContainer.appendChild(row);
    });
}

// 2. RELOJ EN VIVO Y CLIMA (OPEN-METEO)
function initClockAndWeather() {
    if (clockInterval) clearInterval(clockInterval);

    const updateClock = () => {
        const clockEl = document.getElementById('hubClock');
        const dateEl = document.getElementById('hubDate');
        if (!clockEl || !dateEl) return;

        const now = new Date();
        clockEl.textContent = now.toLocaleTimeString('es-CO', { hour12: false });
        dateEl.textContent = now.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
    };
    updateClock();
    clockInterval = setInterval(updateClock, 1000);

    // Clima automático (Por defecto Floridablanca/Bucaramanga si el navegador no da geolocalización)
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
            // Silencioso si no hay red externa
        }
    };

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            pos => fetchWeather(pos.coords.latitude, pos.coords.longitude),
            () => fetchWeather()
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
                if (!/^[0-9+\-*/().\s]+$/.test(expression)) throw new Error('Inválido');
                const result = Function(`"use strict"; return (${expression})`)();
                display.value = Number.isFinite(result) ? Number(result.toFixed(4)) : 'Error';
                expression = String(display.value);
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

// 4. SINTETIZADOR AMBIENTAL WEB AUDIO API
function initAmbientSynthesizer() {
    const btnToggle = document.getElementById('btnToggleAudio');
    const volumeSlider = document.getElementById('audioVolume');
    const presetBtns = document.querySelectorAll('.audio-preset');
    if (!btnToggle) return;

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
            // Generador de ruido (Marrón o Lluvia)
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

    btnToggle.addEventListener('click', () => {
        isPlayingAudio = !isPlayingAudio;
        if (isPlayingAudio) {
            startAudioMode(currentAudioMode);
            btnToggle.textContent = 'Detener Audio';
            btnToggle.style.background = 'var(--danger-color)';
            btnToggle.style.color = '#fff';
        } else {
            stopCurrentAudio();
            btnToggle.textContent = 'Activar Audio';
            btnToggle.style.background = 'var(--primary-neon)';
            btnToggle.style.color = '#000';
        }
    });

    presetBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            presetBtns.forEach(b => {
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            btn.style.borderColor = 'var(--primary-neon)';
            btn.style.color = 'var(--primary-neon)';
            currentAudioMode = btn.dataset.mode;
            if (isPlayingAudio) startAudioMode(currentAudioMode);
        });
    });

    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            if (gainNode) gainNode.gain.value = Number(e.target.value);
        });
    }
}