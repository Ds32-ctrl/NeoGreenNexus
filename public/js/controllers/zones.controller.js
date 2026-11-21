// public/js/controllers/zones.controller.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from '../core/router.js';
import { showToast } from '../ui/toast.js';
import { getActiveHousehold } from '../core/household.js';
import { escapeHTML } from '../services/finance.service.js';
import { createAgendaItem, getTodayISO } from '../services/agenda.service.js';

const ICON_MAP = {
    monitor: '💻',
    coffee: '☕',
    home: '🛋️',
    moon: '🛏️',
    droplet: '🚿',
    tool: '🔧',
    sun: '🌿'
};

let currentUser = null;
let activeHousehold = null;
let currentAuthorName = 'Miembro';
let allZones = [];
let allTasks = [];
let selectedZoneId = null;
let currentFilter = 'all';

function computeNextCycleDate(frequency, baseDateStr = null) {
    const base = new Date(`${(baseDateStr || getTodayISO()).slice(0, 10)}T12:00:00`);
    const freq = (frequency || 'Semanal').toLowerCase();

    if (freq === 'diario') base.setDate(base.getDate() + 1);
    else if (freq === 'quincenal') base.setDate(base.getDate() + 15);
    else if (freq === 'mensual') base.setMonth(base.getMonth() + 1);
    else if (freq === 'trimestral') base.setMonth(base.getMonth() + 3);
    else base.setDate(base.getDate() + 7); // Semanal por defecto

    return base.toISOString().slice(0, 10);
}

export async function initZones() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        navigateTo('/');
        return;
    }
    currentUser = user;
    currentFilter = 'all';
    const meta = user.user_metadata || {};
    currentAuthorName = meta.nickname || meta.full_name?.split(' ')[0] || user.email.split('@')[0];
    activeHousehold = await getActiveHousehold(user.id);

    const shareLabel = document.getElementById('zoneShareHouseholdLabel');
    if (shareLabel && activeHousehold) {
        shareLabel.style.display = 'flex';
    }

    bindZoneEvents();
    await loadZonesAndTasks();
}

async function loadZonesAndTasks() {
    try {
        const filterExpr = activeHousehold
            ? `user_id.eq.${currentUser.id},household_id.eq.${activeHousehold.id}`
            : `user_id.eq.${currentUser.id}`;

        const [zonesRes, tasksRes] = await Promise.all([
            supabase.from('home_zones').select('*').or(filterExpr).order('created_at', { ascending: true }),
            supabase.from('zone_tasks').select('*').or(filterExpr).order('created_at', { ascending: false })
        ]);

        if (zonesRes.error) throw zonesRes.error;
        if (tasksRes.error) throw tasksRes.error;

        allZones = zonesRes.data || [];
        allTasks = tasksRes.data || [];

        if (allZones.length > 0 && !allZones.some(z => z.id === selectedZoneId)) {
            selectedZoneId = allZones[0].id;
        } else if (allZones.length === 0) {
            selectedZoneId = null;
        }

        updateGlobalHealth();
        renderZonesSidebar();
        renderActiveZonePanel();
    } catch (error) {
        console.error('Error cargando Zonas del Hogar:', error);
        showToast('No se pudieron cargar las zonas', 'error');
    }
}

function updateGlobalHealth() {
    const healthEl = document.getElementById('zonesHealthPercent');
    const summaryEl = document.getElementById('zonesStatsSummary');
    const badgeEl = document.getElementById('zonesTotalBadge');

    if (badgeEl) badgeEl.textContent = allZones.length;

    const total = allTasks.length;
    const completed = allTasks.filter(t => t.is_completed).length;
    const percent = total === 0 ? 100 : Math.round((completed / total) * 100);

    if (healthEl) {
        healthEl.textContent = `${percent}%`;
        healthEl.style.color = percent >= 70 ? 'var(--primary-neon)' : percent >= 40 ? 'var(--warning-color, #f59e0b)' : 'var(--danger-color, #ef4444)';
    }
    if (summaryEl) {
        summaryEl.textContent = `${completed} de ${total} tareas al día`;
    }
}

function renderZonesSidebar() {
    const container = document.getElementById('zonesListContainer');
    if (!container) return;

    container.innerHTML = '';

    if (allZones.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 1.5rem 0;">Aún no tienes espacios creados. Añade el primero abajo.</p>`;
        return;
    }

    allZones.forEach(zone => {
        const zoneTasks = allTasks.filter(t => t.zone_id === zone.id);
        const pendingCount = zoneTasks.filter(t => !t.is_completed).length;
        const isActive = zone.id === selectedZoneId;
        const emoji = ICON_MAP[zone.icon] || '🏠';
        const houseDot = zone.household_id ? `<span title="Compartida con el hogar" style="font-size: 0.72rem;">🏠</span>` : '';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `tab-btn ${isActive ? 'active' : ''}`;
        btn.style.justifyContent = 'space-between';
        btn.style.marginBottom = '0.2rem';

        btn.innerHTML = `
            <div style="display: flex; align-items: center; gap: 8px; overflow: hidden;">
                <span style="font-size: 1.15rem;">${emoji}</span>
                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(zone.name)}</span>
                ${houseDot}
            </div>
            <span style="font-size: 0.75rem; padding: 2px 8px; border-radius: 10px; background: ${pendingCount > 0 ? 'rgba(245, 158, 11, 0.15)' : 'var(--icon-bg)'}; color: ${pendingCount > 0 ? 'var(--warning-color, #f59e0b)' : 'var(--primary-neon)'};">
                ${pendingCount > 0 ? `${pendingCount} pend.` : 'Al día'}
            </span>
        `;

        btn.addEventListener('click', () => {
            selectedZoneId = zone.id;
            renderZonesSidebar();
            renderActiveZonePanel();
        });

        container.appendChild(btn);
    });
}

async function sendTaskToAgenda(zone, task, priority = 'media') {
    const dueDate = task.due_date || computeNextCycleDate(task.frequency);
    const targetHouseholdId = zone.household_id || null;

    await createAgendaItem({
        user_id: currentUser.id,
        household_id: targetHouseholdId,
        author_name: currentAuthorName,
        assigned_to: targetHouseholdId ? 'Todos' : 'Personal',
        title: `${ICON_MAP[zone.icon] || '🔧'} ${zone.name}: ${task.title}`,
        description: `Mantenimiento de zona (Frecuencia: ${task.frequency || 'Semanal'})`,
        item_type: 'tarea',
        priority,
        due_date: dueDate,
        status: 'pendiente',
        color_tag: '#0ea5e9'
    });
}

function renderActiveZonePanel() {
    const titleEl = document.getElementById('activeZoneTitle');
    const descEl = document.getElementById('activeZoneDesc');
    const iconEl = document.getElementById('activeZoneIcon');
    const scopeBadge = document.getElementById('activeZoneScopeBadge');
    const btnToggleShare = document.getElementById('btnToggleZoneShare');
    const btnDeleteZone = document.getElementById('btnDeleteZone');
    const createTaskForm = document.getElementById('createTaskForm');
    const filterBar = document.getElementById('taskFilterBar');
    const tasksList = document.getElementById('zoneTasksList');

    const activeZone = allZones.find(z => z.id === selectedZoneId);

    if (!activeZone) {
        if (titleEl) titleEl.textContent = 'Sin espacio seleccionado';
        if (descEl) descEl.textContent = 'Crea o selecciona una zona en la columna izquierda.';
        if (iconEl) iconEl.textContent = '🏠';
        if (scopeBadge) scopeBadge.style.display = 'none';
        if (btnToggleShare) btnToggleShare.style.display = 'none';
        if (btnDeleteZone) btnDeleteZone.style.display = 'none';
        if (createTaskForm) createTaskForm.style.display = 'none';
        if (filterBar) filterBar.style.display = 'none';
        if (tasksList) {
            tasksList.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 2rem 0;">No hay zona activa.</p>`;
        }
        return;
    }

    if (titleEl) titleEl.textContent = activeZone.name;
    if (descEl) descEl.textContent = activeZone.description || 'Sin descripción adicional registrada.';
    if (iconEl) iconEl.textContent = ICON_MAP[activeZone.icon] || '🏠';
    if (scopeBadge) {
        scopeBadge.style.display = 'inline-flex';
        scopeBadge.textContent = activeZone.household_id ? `🏠 ${activeHousehold?.name || 'Hogar'}` : '👤 Personal';
        scopeBadge.style.color = activeZone.household_id ? 'var(--primary-neon)' : 'var(--text-muted)';
        scopeBadge.style.background = activeZone.household_id ? 'rgba(16,185,129,0.14)' : 'var(--bg-color)';
    }
    if (btnToggleShare) {
        if (activeHousehold) {
            btnToggleShare.style.display = 'inline-flex';
            btnToggleShare.textContent = activeZone.household_id ? '👤 Pasar a Personal' : '🏠 Compartir con Hogar';
        } else {
            btnToggleShare.style.display = 'none';
        }
    }
    if (btnDeleteZone) btnDeleteZone.style.display = 'inline-flex';
    if (createTaskForm) createTaskForm.style.display = 'flex';
    if (filterBar) filterBar.style.display = 'flex';

    let zoneTasks = allTasks.filter(t => t.zone_id === activeZone.id);
    if (currentFilter === 'pending') zoneTasks = zoneTasks.filter(t => !t.is_completed);
    if (currentFilter === 'completed') zoneTasks = zoneTasks.filter(t => t.is_completed);

    if (!tasksList) return;
    tasksList.innerHTML = '';

    if (zoneTasks.length === 0) {
        tasksList.innerHTML = `
            <div style="text-align: center; padding: 2.5rem 1rem; border: 1px dashed var(--border-card); border-radius: 16px; color: var(--text-muted);">
                <p style="font-size: 0.95rem; margin-bottom: 0.3rem;">No hay tareas en esta vista para <strong>${escapeHTML(activeZone.name)}</strong>.</p>
                <span style="font-size: 0.8rem;">Usa el formulario superior para programar limpiezas, revisiones o mantenimientos y enviarlos a la Agenda.</span>
            </div>
        `;
        return;
    }

    zoneTasks.forEach(task => {
        const row = document.createElement('div');
        row.className = 'setting-row';
        row.style.cssText = `
            margin-bottom: 0;
            opacity: ${task.is_completed ? '0.72' : '1'};
            border-left: 4px solid ${task.is_completed ? 'var(--primary-neon)' : 'var(--warning-color, #f59e0b)'};
            flex-wrap: wrap;
            gap: 0.7rem;
        `;

        const dueBadge = task.due_date ? `<span style="font-size: 0.75rem; color: var(--text-muted); margin-left: 8px;">📅 Vence: ${escapeHTML(task.due_date)}</span>` : '';

        row.innerHTML = `
            <div style="display: flex; align-items: center; gap: 14px; flex: 1; min-width: 210px;">
                <input type="checkbox" class="task-check" ${task.is_completed ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: var(--primary-neon); cursor: pointer;">
                <div class="setting-info">
                    <h4 style="font-size: 0.98rem; text-decoration: ${task.is_completed ? 'line-through' : 'none'}; color: var(--text-main);">
                        ${escapeHTML(task.title)}
                    </h4>
                    <p style="font-size: 0.8rem; margin: 0;">
                        <span style="color: var(--primary-neon); font-weight: 600;">Frecuencia: ${escapeHTML(task.frequency)}</span>
                        ${dueBadge}
                    </p>
                </div>
            </div>
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                ${task.is_completed ? `
                    <button type="button" class="btn-outline btn-next-cycle" style="padding: 4px 9px; font-size: 0.74rem; border-color: var(--primary-neon); color: var(--primary-neon); font-weight: 700;" title="Reprogramar para el próximo ciclo y enviar a Agenda">
                        🔄 Siguiente ciclo
                    </button>
                ` : `
                    <button type="button" class="btn-outline btn-send-agenda" style="padding: 4px 9px; font-size: 0.74rem; border-color: #0ea5e9; color: #0ea5e9; font-weight: 600;" title="Agendar este mantenimiento en el Centro de Agendas">
                        📅 A Agenda
                    </button>
                `}
                <button type="button" class="btn-outline btn-share-board" style="padding: 4px 9px; font-size: 0.74rem;" title="Publicar tarea en el Tablero Compartido">
                    📌 Al Tablero
                </button>
                <button type="button" class="btn-outline btn-remove-task" style="border-color: transparent; color: var(--danger-color, #ef4444); padding: 4px 8px;" title="Eliminar tarea">
                    ✕
                </button>
            </div>
        `;

        const checkbox = row.querySelector('.task-check');
        checkbox.addEventListener('change', async () => {
            const newState = checkbox.checked;
            const { error } = await supabase.from('zone_tasks').update({ is_completed: newState }).eq('id', task.id);
            if (error) {
                showToast('Error al actualizar tarea', 'error');
            } else {
                task.is_completed = newState;
                updateGlobalHealth();
                renderZonesSidebar();
                renderActiveZonePanel();
            }
        });

        // Reprogramar siguiente ciclo automáticamente + proyectar en Agenda
        row.querySelector('.btn-next-cycle')?.addEventListener('click', async (e) => {
            e.currentTarget.disabled = true;
            try {
                const nextDate = computeNextCycleDate(task.frequency, task.due_date || getTodayISO());
                const { error } = await supabase
                    .from('zone_tasks')
                    .update({ is_completed: false, due_date: nextDate })
                    .eq('id', task.id);
                if (error) throw error;

                task.is_completed = false;
                task.due_date = nextDate;
                await sendTaskToAgenda(activeZone, task, 'media');
                showToast(`Mantenimiento reprogramado para el ${nextDate} y trazado en la Agenda.`, 'success');
                updateGlobalHealth();
                renderZonesSidebar();
                renderActiveZonePanel();
            } catch (err) {
                showToast('Error al reprogramar ciclo: ' + err.message, 'error');
                e.currentTarget.disabled = false;
            }
        });

        // Puente directo: Zona -> Centro de Agendas
        row.querySelector('.btn-send-agenda')?.addEventListener('click', async (e) => {
            e.currentTarget.disabled = true;
            try {
                await sendTaskToAgenda(activeZone, task, 'media');
                showToast(`"${task.title}" añadido al Centro de Agendas.`, 'success');
            } catch (err) {
                showToast('Error al enviar a Agenda: ' + err.message, 'error');
            } finally {
                e.currentTarget.disabled = false;
            }
        });

        // Puente corregido: Zona -> Tablero Compartido (incluye household_id y author_name)
        row.querySelector('.btn-share-board').addEventListener('click', async (e) => {
            e.currentTarget.disabled = true;
            try {
                const eventDate = task.due_date ? new Date(task.due_date + 'T12:00:00').toISOString() : null;
                const { error } = await supabase.from('family_board_posts').insert({
                    user_id: currentUser.id,
                    household_id: activeHousehold?.id || null,
                    author_name: currentAuthorName,
                    assigned_to: activeHousehold ? 'Todos' : 'Personal',
                    title: `Zona: ${activeZone.name}`,
                    content: `${task.title} (Frecuencia: ${task.frequency})`,
                    category: 'tarea',
                    color_tag: '#0ea5e9',
                    pinned: false,
                    event_date: eventDate
                });

                if (error) throw error;
                showToast(
                    activeHousehold ? `Tarea publicada en ${activeHousehold.name}.` : 'Tarea publicada en tu Tablero.',
                    'success'
                );
            } catch (err) {
                showToast('No se pudo publicar en el tablero: ' + err.message, 'error');
            } finally {
                e.currentTarget.disabled = false;
            }
        });

        row.querySelector('.btn-remove-task').addEventListener('click', async () => {
            const { error } = await supabase.from('zone_tasks').delete().eq('id', task.id);
            if (!error) {
                allTasks = allTasks.filter(t => t.id !== task.id);
                updateGlobalHealth();
                renderZonesSidebar();
                renderActiveZonePanel();
                showToast('Tarea eliminada', 'info');
            }
        });

        tasksList.appendChild(row);
    });
}

function bindZoneEvents() {
    const createZoneForm = document.getElementById('createZoneForm');
    if (createZoneForm) {
        createZoneForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nameInput = document.getElementById('zoneNameInput');
            const descInput = document.getElementById('zoneDescInput');
            const iconSelect = document.getElementById('zoneIconSelect');
            const shareCheck = document.getElementById('zoneShareHouseholdCheck');

            const name = nameInput.value.trim();
            if (!name) return;

            const targetHouseholdId = (activeHousehold && shareCheck?.checked) ? activeHousehold.id : null;

            const { data, error } = await supabase.from('home_zones').insert({
                user_id: currentUser.id,
                household_id: targetHouseholdId,
                name,
                description: descInput.value.trim() || null,
                icon: iconSelect.value
            }).select().single();

            if (error) {
                showToast('Error creando zona: ' + error.message, 'error');
            } else {
                nameInput.value = '';
                descInput.value = '';
                selectedZoneId = data.id;
                showToast(`Espacio "${name}" creado${targetHouseholdId ? ' y compartido con el hogar' : ''}.`, 'success');
                await loadZonesAndTasks();
            }
        });
    }

    // Alternar alcance de una zona existente (Personal <-> Hogar) junto con sus tareas
    const btnToggleShare = document.getElementById('btnToggleZoneShare');
    if (btnToggleShare) {
        btnToggleShare.addEventListener('click', async () => {
            if (!selectedZoneId || !activeHousehold) return;
            const zone = allZones.find(z => z.id === selectedZoneId);
            if (!zone) return;

            const nextHouseholdId = zone.household_id ? null : activeHousehold.id;
            const [zRes, tRes] = await Promise.all([
                supabase.from('home_zones').update({ household_id: nextHouseholdId }).eq('id', zone.id),
                supabase.from('zone_tasks').update({ household_id: nextHouseholdId }).eq('zone_id', zone.id)
            ]);

            if (zRes.error || tRes.error) {
                showToast('No se pudo cambiar el alcance de la zona.', 'error');
            } else {
                showToast(
                    nextHouseholdId ? `"${zone.name}" ahora es visible para todo ${activeHousehold.name}.` : `"${zone.name}" pasó a ser personal.`,
                    'success'
                );
                await loadZonesAndTasks();
            }
        });
    }

    const btnDeleteZone = document.getElementById('btnDeleteZone');
    if (btnDeleteZone) {
        btnDeleteZone.addEventListener('click', async () => {
            if (!selectedZoneId) return;
            const zone = allZones.find(z => z.id === selectedZoneId);
            if (!zone) return;

            const { error } = await supabase.from('home_zones').delete().eq('id', selectedZoneId);
            if (error) {
                showToast('No se pudo eliminar la zona', 'error');
            } else {
                showToast(`Zona "${zone.name}" eliminada`, 'info');
                selectedZoneId = null;
                await loadZonesAndTasks();
            }
        });
    }

    const createTaskForm = document.getElementById('createTaskForm');
    if (createTaskForm) {
        createTaskForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!selectedZoneId) return;
            const activeZone = allZones.find(z => z.id === selectedZoneId);
            if (!activeZone) return;

            const titleInput = document.getElementById('taskTitleInput');
            const freqSelect = document.getElementById('taskFreqSelect');
            const prioSelect = document.getElementById('taskPrioritySelect');
            const dueInput = document.getElementById('taskDueDateInput');
            const syncAgenda = Boolean(document.getElementById('taskSyncAgendaCheck')?.checked);

            const title = titleInput.value.trim();
            if (!title) return;

            const dueDateVal = dueInput.value || (syncAgenda ? computeNextCycleDate(freqSelect.value) : null);

            const { data: createdTask, error } = await supabase.from('zone_tasks').insert({
                zone_id: selectedZoneId,
                user_id: currentUser.id,
                household_id: activeZone.household_id || null,
                title,
                frequency: freqSelect.value,
                due_date: dueDateVal,
                is_completed: false
            }).select().single();

            if (error) {
                showToast('Error al asignar tarea: ' + error.message, 'error');
            } else {
                if (syncAgenda && createdTask) {
                    try {
                        await sendTaskToAgenda(activeZone, createdTask, prioSelect?.value || 'media');
                    } catch (agErr) {
                        console.warn('No se pudo sincronizar tarea con agenda:', agErr);
                    }
                }
                titleInput.value = '';
                dueInput.value = '';
                showToast(
                    syncAgenda ? 'Mantenimiento asignado y trazado en tu Agenda.' : 'Tarea de mantenimiento asignada.',
                    'success'
                );
                await loadZonesAndTasks();
            }
        });
    }

    document.querySelectorAll('.task-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.task-filter-btn').forEach(b => {
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            btn.style.borderColor = 'var(--primary-neon)';
            btn.style.color = 'var(--primary-neon)';
            currentFilter = btn.dataset.filter;
            renderActiveZonePanel();
        });
    });
}