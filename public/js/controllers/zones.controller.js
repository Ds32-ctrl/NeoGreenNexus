// public/js/controllers/zones.controller.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from '../core/router.js';
import { showToast } from '../ui/toast.js';

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
let allZones = [];
let allTasks = [];
let selectedZoneId = null;
let currentFilter = 'all';

export async function initZones() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        navigateTo('/');
        return;
    }
    currentUser = user;

    bindZoneEvents();
    await loadZonesAndTasks();
}

async function loadZonesAndTasks() {
    try {
        const [zonesRes, tasksRes] = await Promise.all([
            supabase.from('home_zones').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: true }),
            supabase.from('zone_tasks').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false })
        ]);

        if (zonesRes.error) throw zonesRes.error;
        if (tasksRes.error) throw tasksRes.error;

        allZones = zonesRes.data || [];
        allTasks = tasksRes.data || [];

        // Si no hay zona seleccionada o fue eliminada, seleccionar la primera disponible
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
        healthEl.style.color = percent >= 70 ? 'var(--primary-neon)' : percent >= 40 ? 'var(--warning-color)' : 'var(--danger-color)';
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

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `tab-btn ${isActive ? 'active' : ''}`;
        btn.style.justifyContent = 'space-between';
        btn.style.marginBottom = '0.2rem';

        btn.innerHTML = `
            <div style="display: flex; align-items: center; gap: 10px; overflow: hidden;">
                <span style="font-size: 1.15rem;">${emoji}</span>
                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${zone.name}</span>
            </div>
            <span style="font-size: 0.75rem; padding: 2px 8px; border-radius: 10px; background: ${pendingCount > 0 ? 'rgba(245, 158, 11, 0.15)' : 'var(--icon-bg)'}; color: ${pendingCount > 0 ? 'var(--warning-color)' : 'var(--primary-neon)'};">
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

function renderActiveZonePanel() {
    const titleEl = document.getElementById('activeZoneTitle');
    const descEl = document.getElementById('activeZoneDesc');
    const iconEl = document.getElementById('activeZoneIcon');
    const btnDeleteZone = document.getElementById('btnDeleteZone');
    const createTaskForm = document.getElementById('createTaskForm');
    const filterBar = document.getElementById('taskFilterBar');
    const tasksList = document.getElementById('zoneTasksList');

    const activeZone = allZones.find(z => z.id === selectedZoneId);

    if (!activeZone) {
        if (titleEl) titleEl.textContent = 'Sin espacio seleccionado';
        if (descEl) descEl.textContent = 'Crea o selecciona una zona en la columna izquierda.';
        if (iconEl) iconEl.textContent = '🏠';
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
    if (btnDeleteZone) btnDeleteZone.style.display = 'inline-flex';
    if (createTaskForm) createTaskForm.style.display = 'flex';
    if (filterBar) filterBar.style.display = 'flex';

    // Filtrar tareas de esta zona
    let zoneTasks = allTasks.filter(t => t.zone_id === activeZone.id);
    if (currentFilter === 'pending') zoneTasks = zoneTasks.filter(t => !t.is_completed);
    if (currentFilter === 'completed') zoneTasks = zoneTasks.filter(t => t.is_completed);

    if (!tasksList) return;
    tasksList.innerHTML = '';

    if (zoneTasks.length === 0) {
        tasksList.innerHTML = `
            <div style="text-align: center; padding: 2.5rem 1rem; border: 1px dashed var(--border-card); border-radius: 16px; color: var(--text-muted);">
                <p style="font-size: 0.95rem; margin-bottom: 0.3rem;">No hay tareas en esta vista para <strong>${activeZone.name}</strong>.</p>
                <span style="font-size: 0.8rem;">Usa el formulario superior para programar limpiezas, revisiones o inventario de herramientas.</span>
            </div>
        `;
        return;
    }

    zoneTasks.forEach(task => {
        const row = document.createElement('div');
        row.className = 'setting-row';
        row.style.marginBottom = '0';
        row.style.opacity = task.is_completed ? '0.65' : '1';
        row.style.borderLeft = `4px solid ${task.is_completed ? 'var(--primary-neon)' : 'var(--warning-color)'}`;

        const dueBadge = task.due_date ? `<span style="font-size: 0.75rem; color: var(--text-muted); margin-left: 8px;">📅 Vence: ${task.due_date}</span>` : '';

        row.innerHTML = `
            <div style="display: flex; align-items: center; gap: 14px; flex: 1;">
                <input type="checkbox" class="task-check" ${task.is_completed ? 'checked' : ''} style="width: 20px; height: 20px; accent-color: var(--primary-neon); cursor: pointer;">
                <div class="setting-info">
                    <h4 style="font-size: 0.98rem; text-decoration: ${task.is_completed ? 'line-through' : 'none'}; color: var(--text-main);">
                        ${task.title}
                    </h4>
                    <p style="font-size: 0.8rem;">
                        <span style="color: var(--primary-neon); font-weight: 600;">Frecuencia: ${task.frequency}</span>
                        ${dueBadge}
                    </p>
                </div>
            </div>
            <button type="button" class="btn-outline btn-remove-task" style="border-color: transparent; color: var(--danger-color);" title="Eliminar tarea">
                ✕
            </button>
        `;

        // Evento Check / Uncheck
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

        // Evento Eliminar Tarea
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
    // 1. Crear Nueva Zona
    const createZoneForm = document.getElementById('createZoneForm');
    if (createZoneForm) {
        createZoneForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const nameInput = document.getElementById('zoneNameInput');
            const descInput = document.getElementById('zoneDescInput');
            const iconSelect = document.getElementById('zoneIconSelect');

            const name = nameInput.value.trim();
            if (!name) return;

            const { data, error } = await supabase.from('home_zones').insert({
                user_id: currentUser.id,
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
                showToast(`Espacio "${name}" creado`, 'success');
                await loadZonesAndTasks();
            }
        });
    }

    // 2. Eliminar Zona Activa
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

    // 3. Crear Nueva Tarea en la Zona Activa
    const createTaskForm = document.getElementById('createTaskForm');
    if (createTaskForm) {
        createTaskForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!selectedZoneId) return;

            const titleInput = document.getElementById('taskTitleInput');
            const freqSelect = document.getElementById('taskFreqSelect');
            const dueInput = document.getElementById('taskDueDateInput');

            const title = titleInput.value.trim();
            if (!title) return;

            const { error } = await supabase.from('zone_tasks').insert({
                zone_id: selectedZoneId,
                user_id: currentUser.id,
                title,
                frequency: freqSelect.value,
                due_date: dueInput.value || null,
                is_completed: false
            });

            if (error) {
                showToast('Error al asignar tarea: ' + error.message, 'error');
            } else {
                titleInput.value = '';
                dueInput.value = '';
                showToast('Tarea de mantenimiento asignada', 'success');
                await loadZonesAndTasks();
            }
        });
    }

    // 4. Botones de Filtro (Todas / Pendientes / Completadas)
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