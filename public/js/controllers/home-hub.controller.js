// public/js/controllers/home-hub.controller.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from '../core/router.js';
import { showToast } from '../ui/toast.js';
import { getActiveHousehold } from '../core/household.js';
import { escapeHTML, formatCOP, summarizeTransactions } from '../services/finance.service.js';
import {
    loadAgendaItems,
    sortAgendaItems,
    completeAgendaItem,
    getEffectivePriority,
    PRIORITY_META,
    AGENDA_TYPE_META,
    diffDaysFromToday
} from '../services/agenda.service.js';

let clockInterval = null;
let audioCtx = null;
let activeSource = null;
let gainNode = null;
let isPlayingAudio = false;
let currentAudioMode = 'brown';
let activeHousehold = null;
let currentAuthorName = 'Miembro';

export async function initHomeHub() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        navigateTo('/');
        return;
    }

    const meta = user.user_metadata || {};
    currentAuthorName = meta.nickname || meta.full_name?.split(' ')[0] || user.email.split('@')[0];
    activeHousehold = await getActiveHousehold(user.id);

    initClockAndWeather();
    initCalculator();
    initAmbientSynthesizer();
    await loadHubTelemetry(user.id);

    // Formulario de creación rápida (sincronizado con hogar si existe)
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
                    household_id: activeHousehold?.id || null,
                    author_name: currentAuthorName,
                    assigned_to: activeHousehold ? 'Todos' : 'Personal',
                    title: typeSelect.value === 'alerta' ? 'Alerta Rápida' : typeSelect.value === 'evento' ? 'Evento Rápido' : 'Nota Rápida',
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

    if (window.nexusDesktop?.isDesktopApp) {
        await mountDesktopNativePanel();
    }
}

// 1. TELEMETRÍA CONSOLIDADA DESDE SUPABASE
async function loadHubTelemetry(userId) {
    try {
        const householdId = activeHousehold?.id || null;

        let finQuery = supabase.from('finance_transactions').select('amount, type, category, nature, title, is_recurring, transaction_date, household_id');
        let boardQuery = supabase.from('family_board_posts').select('id, title, content, category, event_date, created_at').order('created_at', { ascending: false }).limit(8);

        if (householdId) {
            finQuery = finQuery.or(`and(user_id.eq.${userId},household_id.is.null),household_id.eq.${householdId}`);
            boardQuery = boardQuery.or(`and(user_id.eq.${userId},household_id.is.null),household_id.eq.${householdId}`);
        } else {
            finQuery = finQuery.eq('user_id', userId);
            boardQuery = boardQuery.eq('user_id', userId);
        }

        const [financeRes, tasksRes, inventoryRes, habitsRes, boardRes, agendaItems] = await Promise.all([
            finQuery,
            supabase.from('zone_tasks').select('id, title, frequency, is_completed').eq('user_id', userId).eq('is_completed', false),
            supabase.from('inventory_items').select('id, name, quantity, unit, min_stock, in_shopping_list').eq('user_id', userId),
            supabase.from('habits').select('id, title, current_streak').eq('user_id', userId),
            boardQuery,
            loadAgendaItems({ userId, householdId, scope: 'all' }).catch(() => [])
        ]);

        // A. Cálculo de Balance Financiero Unificado
        const transactions = financeRes.data || [];
        const summary = summarizeTransactions(transactions);
        const kpiBalance = document.getElementById('kpiBalance');
        const kpiFinanceSub = document.getElementById('kpiFinanceSub');

        if (kpiBalance) {
            kpiBalance.textContent = formatCOP(summary.availableCash, 2);
            kpiBalance.style.color = summary.availableCash >= 0 ? 'var(--primary-neon)' : 'var(--danger-color, #ef4444)';
        }
        if (kpiFinanceSub) {
            if (transactions.length > 0) {
                const extra = summary.reservedSavings + summary.investmentContributions > 0
                    ? ` | Reserva/Inv: ${formatCOP(summary.reservedSavings + summary.investmentContributions)}`
                    : '';
                kpiFinanceSub.textContent = `Ingresos: ${formatCOP(summary.totalIncome)} | Egresos: ${formatCOP(summary.totalOutflows)}${extra}`;
            } else {
                kpiFinanceSub.textContent = 'Sin movimientos registrados';
            }
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

        // E. Renderizar Feed Consolidado (Agenda próxima + Tablero + Tareas + Despensa)
        const pendingAgenda = sortAgendaItems(
            (agendaItems || []).filter(item => item.status !== 'completado'),
            'time'
        ).slice(0, 6);

        renderConsolidatedFeed(pendingAgenda, boardRes.data || [], pendingTasks, lowStockItems, userId);

    } catch (err) {
        console.error('Error cargando telemetría 360 Home:', err);
    }
}

function renderConsolidatedFeed(agendaItems, posts, tasks, lowStock, userId) {
    const feedContainer = document.getElementById('hubFeedList');
    if (!feedContainer) return;

    feedContainer.innerHTML = '';

    if (agendaItems.length === 0 && posts.length === 0 && tasks.length === 0 && lowStock.length === 0) {
        feedContainer.innerHTML = `<p class="hub-empty-msg">Tu entorno está en orden. No hay cuotas próximas, alertas, compras urgentes ni tareas pendientes.</p>`;
        return;
    }

    // 1. Mostrar próximos ítems de Agenda (Cuotas, Inversiones, Eventos y Tareas con prioridad)
    agendaItems.forEach(item => {
        const effPrio = getEffectivePriority(item);
        const prioInfo = PRIORITY_META[effPrio] || PRIORITY_META.media;
        const typeInfo = AGENDA_TYPE_META[item.item_type] || AGENDA_TYPE_META.tarea;
        const days = diffDaysFromToday(item.due_date);
        const dayText = days < 0 ? `Vencido (${Math.abs(days)}d)` : days === 0 ? 'Hoy' : days === 1 ? 'Mañana' : item.due_date;
        const amountText = item.amount ? ` • ${formatCOP(item.amount)}` : '';
        const isFinancial = ['cuota_deuda', 'aporte_inversion', 'pago_fijo'].includes(item.item_type);

        const row = document.createElement('div');
        row.className = 'setting-row hub-feed-item';
        row.style.borderLeft = `4px solid ${prioInfo.color}`;
        row.innerHTML = `
            <div class="setting-info">
                <h4 style="font-size: 0.78rem; color: ${prioInfo.color}; text-transform: uppercase;">
                    ${typeInfo.icon} ${escapeHTML(typeInfo.label)} • ${escapeHTML(dayText)} • ${escapeHTML(prioInfo.label)}
                </h4>
                <p style="color: var(--text-main); font-size: 0.92rem; font-weight: 600;">
                    ${escapeHTML(item.title)}${escapeHTML(amountText)}
                </p>
            </div>
            <button type="button" class="btn-outline btn-complete-agenda" title="${isFinancial ? 'Registrar pago y completar' : 'Completar'}">
                ${isFinancial ? 'Pagar ✓' : '✓'}
            </button>
        `;
        row.querySelector('.btn-complete-agenda').addEventListener('click', async () => {
            try {
                await completeAgendaItem(item, { userId, authorName: currentAuthorName, registerFinance: true });
                showToast(isFinancial ? 'Cuota liquidada y registrada en Finanzas.' : 'Ítem completado en Agenda.', 'success');
                await loadHubTelemetry(userId);
            } catch (err) {
                showToast('Error al completar: ' + err.message, 'error');
            }
        });
        feedContainer.appendChild(row);
    });

    // 2. Mostrar notas/alertas del tablero compartido (con título + contenido)
    posts.forEach(post => {
        const isAlert = post.category === 'alerta';
        const badgeColor = isAlert ? 'var(--danger-color, #ef4444)' : 'var(--primary-neon)';
        const hasDistinctTitle = post.title && post.title.toLowerCase() !== String(post.category || '').toLowerCase();
        const displayBody = hasDistinctTitle
            ? `<strong>${escapeHTML(post.title)}</strong> — ${escapeHTML(post.content)}`
            : escapeHTML(post.content);

        const row = document.createElement('div');
        row.className = 'setting-row hub-feed-item';
        row.innerHTML = `
            <div class="setting-info">
                <h4 style="font-size: 0.82rem; color: ${badgeColor}; text-transform: uppercase;">${escapeHTML(post.category || 'aviso')}</h4>
                <p style="color: var(--text-main); font-size: 0.92rem;">${displayBody}</p>
            </div>
            <button type="button" class="btn-outline btn-delete-post" title="Descartar aviso">✓</button>
        `;
        row.querySelector('.btn-delete-post').addEventListener('click', async () => {
            await supabase.from('family_board_posts').delete().eq('id', post.id);
            await loadHubTelemetry(userId);
        });
        feedContainer.appendChild(row);
    });

    // 3. Mostrar tareas de mantenimiento de zonas pendientes
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

    // 4. Mostrar alertas de stock bajo en Despensa Inteligente
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

// 5. PANEL NATIVO DE ESCRITORIO (ELECTRON) - CORREGIDO EN ALCANCE DE MÓDULO
async function mountDesktopNativePanel() {
    const wrapper = document.querySelector('.settings-wrapper');
    if (!wrapper || document.getElementById('nexusDesktopNativeBox')) return;

    const info = await window.nexusDesktop.getSystemTelemetry();
    const box = document.createElement('div');
    box.id = 'nexusDesktopNativeBox';
    box.style.cssText = 'margin-top: 2rem; background: var(--panel-bg); border: 1px solid var(--primary-neon); border-radius: 24px; padding: 1.8rem; box-shadow: var(--shadow-base);';

    box.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; margin-bottom: 1.2rem;">
            <div>
                <span class="version-badge" style="margin: 0 0 6px 0;"><span class="pulse-dot"></span> EJECUTABLE NATIVO NEXUS CORE ACTIVO</span>
                <h3 style="font-size: 1.2rem; font-weight: 800; margin: 0;">Estación Local: ${escapeHTML(info.hostname)} (${escapeHTML(info.platform)})</h3>
            </div>
            <div style="font-size: 0.85rem; color: var(--primary-neon); font-weight: 700;">
                CPU: ${escapeHTML(info.cpuModel)} (${info.cpuCores} Hilos) • RAM OS: ${info.usedMemGB} / ${info.totalMemGB} GB (${info.memUsagePercent}%)
            </div>
        </div>
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
            <input type="text" id="desktopVaultNote" class="form-input" placeholder="Texto o clave a sellar con AES-256-GCM en este equipo..." style="flex: 2; min-width: 220px;">
            <input type="password" id="desktopVaultKey" class="form-input" placeholder="Llave maestra..." style="flex: 1; min-width: 150px;">
            <button type="button" id="btnSealLocalVault" class="btn-save" style="margin: 0;">🔐 Sellar en Disco Local</button>
        </div>
    `;

    wrapper.appendChild(box);

    box.querySelector('#btnSealLocalVault').addEventListener('click', async () => {
        const text = box.querySelector('#desktopVaultNote').value.trim();
        const pass = box.querySelector('#desktopVaultKey').value;
        if (!text || !pass) {
            showToast('Ingresa el texto y la llave maestra para cifrar.', 'error');
            return;
        }
        const enc = new TextEncoder();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const keyMat = await crypto.subtle.importKey('raw', enc.encode(pass.padEnd(32, '0').slice(0, 32)), 'AES-GCM', false, ['encrypt']);
        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keyMat, enc.encode(text));
        const b64 = btoa(String.fromCharCode(...new Uint8Array(cipher)));
        localStorage.setItem('ngn_desktop_vault_last', b64);
        box.querySelector('#desktopVaultNote').value = '';
        showToast('Bloque encriptado con AES-256-GCM guardado en la estación.', 'success');
    });
}