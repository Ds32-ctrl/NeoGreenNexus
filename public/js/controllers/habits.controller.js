// public/js/controllers/habits.controller.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from '../core/router.js';
import { showToast } from '../ui/toast.js';
import { escapeHTML } from '../services/finance.service.js';
import { createAgendaItem, getTodayISO } from '../services/agenda.service.js';

let currentUser = null;
let currentAuthorName = 'Miembro';
let allHabits = [];
let allLogs = [];

// Estado persistente del Temporizador de Enfoque Absoluto (sobrevive cambios de vista)
let pomoInterval = null;
let pomoRemainingSec = 25 * 60;
let pomoSelectedMin = 25;
let isPomoRunning = false;

export async function initHabits() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        navigateTo('/');
        return;
    }
    currentUser = user;
    const meta = user.user_metadata || {};
    currentAuthorName = meta.nickname || meta.full_name?.split(' ')[0] || user.email.split('@')[0];

    const todayLabel = document.getElementById('habitsTodayLabel');
    if (todayLabel) {
        todayLabel.textContent = new Date().toLocaleDateString('es-CO', {
            weekday: 'long',
            day: 'numeric',
            month: 'short'
        });
    }

    bindHabitEvents();
    initFocusTimerUI();
    await loadHabitsAndLogs();
}

function toLocalISODate(dateObj) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

function getLast7Days() {
    const days = [];
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        days.push({
            iso: toLocalISODate(d),
            dayName: i === 0 ? 'Hoy' : dayNames[d.getDay()],
            dayNum: d.getDate(),
            isToday: i === 0
        });
    }
    return days;
}

function calculateStreak(habitId) {
    const habitDates = new Set(
        allLogs.filter(l => l.habit_id === habitId).map(l => l.completed_date)
    );
    if (habitDates.size === 0) return 0;

    let streak = 0;
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);

    const todayISO = toLocalISODate(cursor);
    if (!habitDates.has(todayISO)) {
        cursor.setDate(cursor.getDate() - 1);
        if (!habitDates.has(toLocalISODate(cursor))) {
            return 0;
        }
    }

    while (habitDates.has(toLocalISODate(cursor))) {
        streak++;
        cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
}

async function loadHabitsAndLogs() {
    try {
        const [habitsRes, logsRes] = await Promise.all([
            supabase.from('habits').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: true }),
            supabase.from('habit_logs').select('*').eq('user_id', currentUser.id)
        ]);

        if (habitsRes.error) throw habitsRes.error;
        if (logsRes.error) throw logsRes.error;

        allHabits = habitsRes.data || [];
        allLogs = logsRes.data || [];

        populateFocusHabitSelector();
        updateKPIs();
        renderHabitsMatrix();
    } catch (error) {
        console.error('Error cargando Rastreador de Hábitos:', error);
        showToast('Error al sincronizar hábitos', 'error');
    }
}

function populateFocusHabitSelector() {
    const selectEl = document.getElementById('pomoHabitSelect');
    if (!selectEl) return;

    const prevValue = selectEl.value;
    selectEl.innerHTML = `<option value="">-- Solo temporizador libre --</option>` +
        allHabits.map(h => `<option value="${escapeHTML(h.id)}">🎯 ${escapeHTML(h.title)}</option>`).join('');

    if (prevValue && allHabits.some(h => h.id === prevValue)) {
        selectEl.value = prevValue;
    }
}

function updateKPIs() {
    const todayISO = toLocalISODate(new Date());
    const last7ISO = new Set(getLast7Days().map(d => d.iso));

    const completedTodayCount = allHabits.filter(h =>
        allLogs.some(l => l.habit_id === h.id && l.completed_date === todayISO)
    ).length;

    let totalTargetWeekly = 0;
    let totalDoneWeekly = 0;
    let maxStreak = 0;

    allHabits.forEach(h => {
        totalTargetWeekly += Number(h.target_days_per_week || 7);
        const doneThisWeek = allLogs.filter(l => l.habit_id === h.id && last7ISO.has(l.completed_date)).length;
        totalDoneWeekly += Math.min(doneThisWeek, Number(h.target_days_per_week || 7));

        const streak = calculateStreak(h.id);
        if (streak > maxStreak) maxStreak = streak;
    });

    const efficiency = totalTargetWeekly > 0 ? Math.round((totalDoneWeekly / totalTargetWeekly) * 100) : 0;

    const todayEl = document.getElementById('habCompletedToday');
    const effEl = document.getElementById('habWeeklyEfficiency');
    const streakEl = document.getElementById('habBestStreak');
    const totalLogsEl = document.getElementById('habTotalLogs');

    if (todayEl) todayEl.textContent = `${completedTodayCount} / ${allHabits.length}`;
    if (effEl) {
        effEl.textContent = `${efficiency}%`;
        effEl.style.color = efficiency >= 75 ? 'var(--primary-neon)' : efficiency >= 45 ? 'var(--warning-color, #f59e0b)' : 'var(--danger-color, #ef4444)';
    }
    if (streakEl) streakEl.textContent = `${maxStreak} día(s)`;
    if (totalLogsEl) totalLogsEl.textContent = allLogs.length;
}

function renderHabitsMatrix() {
    const container = document.getElementById('habitsMatrixContainer');
    if (!container) return;

    container.innerHTML = '';

    if (allHabits.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 3rem 1rem; border: 1px dashed var(--border-card); border-radius: 18px; color: var(--text-muted);">
                <p style="font-size: 0.98rem; margin-bottom: 0.3rem;">Aún no tienes hábitos configurados en tu nodo.</p>
                <span style="font-size: 0.82rem;">Crea una rutina a la izquierda o elige una plantilla sugerida en 1 clic.</span>
            </div>
        `;
        return;
    }

    const last7Days = getLast7Days();
    const last7ISO = new Set(last7Days.map(d => d.iso));
    const todayISO = getTodayISO();

    allHabits.forEach(habit => {
        const streak = calculateStreak(habit.id);
        const doneToday = allLogs.some(l => l.habit_id === habit.id && l.completed_date === todayISO);
        const streakAtRisk = streak > 0 && !doneToday;
        const doneLast7 = allLogs.filter(l => l.habit_id === habit.id && last7ISO.has(l.completed_date)).length;
        const target = Number(habit.target_days_per_week || 7);
        const pct = Math.min(100, Math.round((doneLast7 / target) * 100));

        const card = document.createElement('div');
        card.style.cssText = `
            background: var(--bg-color);
            border: 1px solid ${streakAtRisk ? 'var(--warning-color, #f59e0b)' : 'var(--border-card)'};
            border-radius: 18px;
            padding: 1.3rem 1.5rem;
            display: flex;
            flex-direction: column;
            gap: 1rem;
            box-shadow: var(--shadow-base);
        `;

        const daysHTML = last7Days.map(day => {
            const isDone = allLogs.some(l => l.habit_id === habit.id && l.completed_date === day.iso);
            return `
                <button type="button" class="day-toggle-btn" data-date="${day.iso}" style="
                    flex: 1;
                    min-width: 48px;
                    padding: 8px 4px;
                    border-radius: 12px;
                    border: 1px solid ${isDone ? 'var(--primary-neon)' : day.isToday ? 'var(--text-muted)' : 'var(--border-card)'};
                    background: ${isDone ? 'var(--primary-neon)' : 'var(--panel-bg)'};
                    color: ${isDone ? '#000' : 'var(--text-main)'};
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    gap: 3px;
                    transition: var(--transition-smooth);
                    font-weight: ${isDone || day.isToday ? '800' : '500'};
                " title="Alternar ${day.iso}">
                    <span style="font-size: 0.7rem; opacity: 0.85; text-transform: uppercase;">${day.dayName}</span>
                    <span style="font-size: 0.95rem;">${isDone ? '✓' : day.dayNum}</span>
                </button>
            `;
        }).join('');

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap;">
                <div>
                    <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--text-main); margin: 0;">${escapeHTML(habit.title)}</h4>
                        <span style="font-size: 0.74rem; padding: 2px 9px; border-radius: 10px; background: var(--icon-bg); color: var(--primary-neon); font-weight: 700;">
                            🔥 Racha: ${streak}d
                        </span>
                        ${streakAtRisk ? `<span style="font-size: 0.7rem; padding: 2px 8px; border-radius: 8px; background: rgba(245,158,11,0.16); color: #f59e0b; font-weight: 700;">⚠️ Pendiente hoy</span>` : ''}
                        <span style="font-size: 0.75rem; color: var(--text-muted);">
                            Meta: ${doneLast7}/${target}d (${pct}%)
                        </span>
                    </div>
                    ${habit.description ? `<p style="font-size: 0.82rem; color: var(--text-muted); margin: 4px 0 0 0;">${escapeHTML(habit.description)}</p>` : ''}
                </div>

                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <button type="button" class="btn-outline btn-quick-today" style="padding: 4px 9px; font-size: 0.75rem; font-weight: 700; border-color: ${doneToday ? '#10b981' : 'var(--primary-neon)'}; color: ${doneToday ? '#10b981' : 'var(--primary-neon)'};">
                        ${doneToday ? '✓ Hecho Hoy' : '+ Marcar Hoy'}
                    </button>
                    <button type="button" class="btn-outline btn-focus-this" title="Cargar en Enfoque Absoluto" style="padding: 4px 8px; font-size: 0.74rem;">
                        🎯 Enfoque
                    </button>
                    <button type="button" class="btn-outline btn-open-hab-agenda" title="Programar en Centro de Agendas" style="padding: 4px 8px; font-size: 0.74rem; border-color: #0ea5e9; color: #0ea5e9;">
                        📅 Agendar
                    </button>
                    <button type="button" class="btn-outline btn-open-hab-edit" title="Editar meta o detalle" style="padding: 4px 8px; font-size: 0.74rem;">
                        ✏️
                    </button>
                    <button type="button" class="btn-outline btn-delete-habit" title="Eliminar hábito" style="border-color: transparent; color: var(--danger-color, #ef4444); padding: 4px 8px;">
                        ✕
                    </button>
                </div>
            </div>

            <!-- Panel inline: Programar Rutina en Agenda -->
            <div class="hab-agenda-panel" style="display: none; padding: 0.8rem; border-radius: 12px; background: var(--panel-bg); border: 1px dashed #0ea5e9; flex-direction: column; gap: 0.6rem;">
                <div style="font-size: 0.74rem; font-weight: 800; color: #0ea5e9; text-transform: uppercase;">📅 Programar Rutina en Centro de Agendas</div>
                <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: flex-end;">
                    <div>
                        <label style="display: block; font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px;">Fecha inicio</label>
                        <input type="date" class="form-input hab-ag-date" value="${todayISO}" style="padding: 0.38rem 0.55rem; font-size: 0.8rem;">
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px;">Hora (opc.)</label>
                        <input type="time" class="form-input hab-ag-time" value="07:00" style="padding: 0.38rem 0.55rem; font-size: 0.8rem;">
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px;">Alcance</label>
                        <select class="form-input hab-ag-span" style="padding: 0.38rem 0.5rem; font-size: 0.8rem;">
                            <option value="1">Solo ese día</option>
                            <option value="${target}">Próximos ${target} días (meta semanal)</option>
                        </select>
                    </div>
                    <button type="button" class="btn-save btn-save-hab-agenda" style="margin: 0; padding: 0.42rem 0.85rem; font-size: 0.76rem;">Agendar ✓</button>
                </div>
            </div>

            <!-- Panel inline: Editar Hábito sin perder racha -->
            <div class="hab-edit-panel" style="display: none; padding: 0.8rem; border-radius: 12px; background: var(--panel-bg); border: 1px dashed var(--border-card); flex-direction: column; gap: 0.6rem;">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px;">
                    <input type="text" class="form-input hab-edit-title" value="${escapeHTML(habit.title)}" placeholder="Título" style="padding: 0.42rem 0.65rem; font-size: 0.82rem;">
                    <input type="text" class="form-input hab-edit-desc" value="${escapeHTML(habit.description || '')}" placeholder="Regla mínima" style="padding: 0.42rem 0.65rem; font-size: 0.82rem;">
                    <select class="form-input hab-edit-target" style="padding: 0.42rem; font-size: 0.82rem;">
                        ${[7, 6, 5, 4, 3, 2, 1].map(n => `<option value="${n}" ${target === n ? 'selected' : ''}>${n} día(s)/semana</option>`).join('')}
                    </select>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 6px;">
                    <button type="button" class="btn-outline btn-cancel-hab-edit" style="padding: 0.35rem 0.7rem; font-size: 0.74rem;">Cancelar</button>
                    <button type="button" class="btn-save btn-save-hab-edit" style="margin: 0; padding: 0.38rem 0.85rem; font-size: 0.74rem;">Guardar Cambios</button>
                </div>
            </div>

            <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                ${daysHTML}
            </div>

            <div style="width: 100%; height: 6px; background: var(--panel-bg); border-radius: 6px; overflow: hidden;">
                <div style="width: ${pct}%; height: 100%; background: var(--primary-neon); transition: width 0.3s ease;"></div>
            </div>
        `;

        const agPanel = card.querySelector('.hab-agenda-panel');
        const editPanel = card.querySelector('.hab-edit-panel');

        card.querySelector('.btn-quick-today').addEventListener('click', async (e) => {
            e.currentTarget.disabled = true;
            await toggleHabitDate(habit, todayISO);
        });

        card.querySelector('.btn-focus-this').addEventListener('click', () => {
            const selectEl = document.getElementById('pomoHabitSelect');
            if (selectEl) {
                selectEl.value = habit.id;
                selectEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
                showToast(`"${habit.title}" vinculado al temporizador de Enfoque.`, 'info');
            }
        });

        card.querySelector('.btn-open-hab-agenda').addEventListener('click', () => {
            editPanel.style.display = 'none';
            agPanel.style.display = agPanel.style.display === 'none' ? 'flex' : 'none';
        });

        card.querySelector('.btn-save-hab-agenda').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
                const startDate = card.querySelector('.hab-ag-date').value || todayISO;
                const dueTime = card.querySelector('.hab-ag-time').value || null;
                const spanDays = Math.min(7, Math.max(1, Number(card.querySelector('.hab-ag-span').value || 1)));

                const base = new Date(`${startDate}T12:00:00`);
                const rows = [];
                for (let i = 0; i < spanDays; i++) {
                    const dt = new Date(base);
                    dt.setDate(base.getDate() + i);
                    rows.push({
                        user_id: currentUser.id,
                        household_id: null,
                        author_name: currentAuthorName,
                        assigned_to: 'Personal',
                        title: `🎯 Hábito: ${habit.title}`,
                        description: habit.description || `Rutina diaria (Meta: ${target}d/sem)`,
                        item_type: 'tarea',
                        priority: 'media',
                        due_date: dt.toISOString().slice(0, 10),
                        due_time: dueTime,
                        status: 'pendiente',
                        color_tag: '#10b981'
                    });
                }

                const { error } = await supabase.from('agenda_items').insert(rows);
                if (error) throw error;

                agPanel.style.display = 'none';
                showToast(`${rows.length} recordatorio(s) de "${habit.title}" enviados a tu Agenda.`, 'success');
            } catch (err) {
                showToast('Error al agendar hábito: ' + err.message, 'error');
            } finally {
                btn.disabled = false;
            }
        });

        card.querySelector('.btn-open-hab-edit').addEventListener('click', () => {
            agPanel.style.display = 'none';
            editPanel.style.display = editPanel.style.display === 'none' ? 'flex' : 'none';
        });
        card.querySelector('.btn-cancel-hab-edit').addEventListener('click', () => {
            editPanel.style.display = 'none';
        });
        card.querySelector('.btn-save-hab-edit').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
                const newTitle = card.querySelector('.hab-edit-title').value.trim();
                const newDesc = card.querySelector('.hab-edit-desc').value.trim() || null;
                const newTarget = parseInt(card.querySelector('.hab-edit-target').value, 10) || 7;
                if (!newTitle) {
                    btn.disabled = false;
                    return;
                }

                const { error } = await supabase
                    .from('habits')
                    .update({ title: newTitle, description: newDesc, target_days_per_week: newTarget })
                    .eq('id', habit.id);
                if (error) throw error;

                habit.title = newTitle;
                habit.description = newDesc;
                habit.target_days_per_week = newTarget;
                populateFocusHabitSelector();
                updateKPIs();
                renderHabitsMatrix();
                showToast('Hábito actualizado conservando tu racha.', 'success');
            } catch (err) {
                showToast('Error al actualizar hábito: ' + err.message, 'error');
                btn.disabled = false;
            }
        });

        card.querySelectorAll('.day-toggle-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                btn.disabled = true;
                const targetDate = btn.dataset.date;
                await toggleHabitDate(habit, targetDate);
                btn.disabled = false;
            });
        });

        card.querySelector('.btn-delete-habit').addEventListener('click', async () => {
            const { error } = await supabase.from('habits').delete().eq('id', habit.id);
            if (!error) {
                allHabits = allHabits.filter(h => h.id !== habit.id);
                allLogs = allLogs.filter(l => l.habit_id !== habit.id);
                populateFocusHabitSelector();
                updateKPIs();
                renderHabitsMatrix();
                showToast('Hábito eliminado', 'info');
            }
        });

        container.appendChild(card);
    });
}

async function toggleHabitDate(habit, targetDate, forceCheck = false) {
    const existingLog = allLogs.find(l => l.habit_id === habit.id && l.completed_date === targetDate);

    if (existingLog) {
        if (forceCheck) return;
        const { error } = await supabase.from('habit_logs').delete().eq('id', existingLog.id);
        if (!error) {
            allLogs = allLogs.filter(l => l.id !== existingLog.id);
        }
    } else {
        const { data, error } = await supabase.from('habit_logs').insert({
            habit_id: habit.id,
            user_id: currentUser.id,
            completed_date: targetDate
        }).select().single();

        if (!error && data) {
            allLogs.push(data);
        }
    }

    const newStreak = calculateStreak(habit.id);
    habit.current_streak = newStreak;
    await supabase.from('habits').update({ current_streak: newStreak }).eq('id', habit.id);

    updateKPIs();
    renderHabitsMatrix();
}

// TEMPORIZADOR DE ENFOQUE ABSOLUTO (POMODORO + BLOQUEO DND + PUENTE A AGENDA)
function playCompletionChime() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(528, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.45);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.6);
    } catch {}
}

function initFocusTimerUI() {
    const btnStart = document.getElementById('btnPomoStart');
    const btnReset = document.getElementById('btnPomoReset');
    const btnSchedule = document.getElementById('btnPomoScheduleAgenda');
    const dndCheck = document.getElementById('pomoDndCheck');
    const modeBtns = document.querySelectorAll('.pomo-mode-btn');

    const formatTime = (sec) => {
        const m = String(Math.floor(sec / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        return `${m}:${s}`;
    };

    const syncUI = () => {
        const dEl = document.getElementById('pomoTimerDisplay');
        const bEl = document.getElementById('pomoStatusBadge');
        const sBtn = document.getElementById('btnPomoStart');
        if (dEl) dEl.textContent = formatTime(pomoRemainingSec);
        if (bEl) {
            bEl.textContent = isPomoRunning ? '🔒 Enfoque Activo' : 'En espera';
            bEl.style.color = isPomoRunning ? 'var(--primary-neon)' : 'var(--text-muted)';
        }
        if (sBtn) {
            sBtn.textContent = isPomoRunning ? 'Pausar' : 'Iniciar';
        }
    };

    syncUI();

    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            if (isPomoRunning) return;
            modeBtns.forEach(b => {
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            btn.style.borderColor = 'var(--primary-neon)';
            btn.style.color = 'var(--primary-neon)';
            pomoSelectedMin = parseInt(btn.dataset.minutes, 10) || 25;
            pomoRemainingSec = pomoSelectedMin * 60;
            syncUI();
        });
    });

    if (btnStart) {
        btnStart.addEventListener('click', () => {
            isPomoRunning = !isPomoRunning;
            window.NGN_FOCUS_LOCK = isPomoRunning && (dndCheck ? dndCheck.checked : true);

            if (isPomoRunning) {
                if (pomoInterval) clearInterval(pomoInterval);
                pomoInterval = setInterval(async () => {
                    pomoRemainingSec--;
                    syncUI();

                    if (pomoRemainingSec <= 0) {
                        clearInterval(pomoInterval);
                        isPomoRunning = false;
                        window.NGN_FOCUS_LOCK = false;
                        pomoRemainingSec = pomoSelectedMin * 60;
                        playCompletionChime();
                        syncUI();

                        const selectEl = document.getElementById('pomoHabitSelect');
                        const selectedHabitId = selectEl?.value;
                        if (selectedHabitId) {
                            const habit = allHabits.find(h => h.id === selectedHabitId);
                            if (habit) {
                                await toggleHabitDate(habit, toLocalISODate(new Date()), true);
                                showToast(`¡Sesión completada! "${habit.title}" marcado hoy.`, 'success');
                                return;
                            }
                        }
                        showToast('¡Sesión de Enfoque Absoluto completada!', 'success');
                    }
                }, 1000);
            } else {
                clearInterval(pomoInterval);
            }
            syncUI();
        });
    }

    if (btnReset) {
        btnReset.addEventListener('click', () => {
            if (pomoInterval) clearInterval(pomoInterval);
            isPomoRunning = false;
            window.NGN_FOCUS_LOCK = false;
            pomoRemainingSec = pomoSelectedMin * 60;
            syncUI();
        });
    }

    if (btnSchedule) {
        btnSchedule.addEventListener('click', async () => {
            btnSchedule.disabled = true;
            try {
                const selectEl = document.getElementById('pomoHabitSelect');
                const habit = allHabits.find(h => h.id === selectEl?.value);
                const now = new Date();
                const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

                await createAgendaItem({
                    user_id: currentUser.id,
                    household_id: null,
                    author_name: currentAuthorName,
                    assigned_to: 'Personal',
                    title: habit ? `🎯 Enfoque (${pomoSelectedMin}m): ${habit.title}` : `🎯 Bloque de Enfoque Absoluto (${pomoSelectedMin}m)`,
                    description: 'Sesión programada desde Rastreador de Hábitos',
                    item_type: 'evento',
                    priority: 'alta',
                    due_date: getTodayISO(),
                    due_time: timeStr,
                    status: 'pendiente',
                    color_tag: '#0ea5e9'
                });
                showToast('Bloque de enfoque añadido a tu Agenda de hoy.', 'success');
            } catch (err) {
                showToast('Error al agendar sesión: ' + err.message, 'error');
            } finally {
                btnSchedule.disabled = false;
            }
        });
    }
}

function bindHabitEvents() {
    const form = document.getElementById('habitCreateForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const titleInput = document.getElementById('habTitleInput');
            const descInput = document.getElementById('habDescInput');
            const targetSelect = document.getElementById('habTargetSelect');

            const title = titleInput.value.trim();
            if (!title) return;

            const { error } = await supabase.from('habits').insert({
                user_id: currentUser.id,
                title,
                description: descInput.value.trim() || null,
                target_days_per_week: parseInt(targetSelect.value, 10) || 7,
                current_streak: 0
            });

            if (error) {
                showToast('Error al crear hábito: ' + error.message, 'error');
            } else {
                titleInput.value = '';
                descInput.value = '';
                showToast(`Hábito "${title}" integrado a tu nodo`, 'success');
                await loadHabitsAndLogs();
            }
        });
    }

    document.querySelectorAll('.quick-habit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const titleInput = document.getElementById('habTitleInput');
            const descInput = document.getElementById('habDescInput');
            const targetSelect = document.getElementById('habTargetSelect');

            if (titleInput) titleInput.value = btn.dataset.title;
            if (descInput) descInput.value = btn.dataset.desc;
            if (targetSelect) targetSelect.value = btn.dataset.days;
            showToast(`Plantilla "${btn.dataset.title}" lista. Pulsa Integrar Rutina.`, 'info');
        });
    });
}