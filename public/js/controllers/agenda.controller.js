// public/js/controllers/agenda.controller.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from '../core/router.js';
import { showToast } from '../ui/toast.js';
import { getActiveHousehold } from '../core/household.js';
import { escapeHTML, formatCOP } from '../services/finance.service.js';
import {
    PRIORITY_META,
    AGENDA_TYPE_META,
    getTodayISO,
    diffDaysFromToday,
    getEffectivePriority,
    sortAgendaItems,
    loadAgendaItems,
    createAgendaItem,
    updateAgendaItem,
    deleteAgendaItem,
    completeAgendaItem
} from '../services/agenda.service.js';
import {
    isNotificationsEnabled,
    setNotificationsEnabled,
    requestNotificationPermission,
    syncAgendaReminders
} from '../services/notifications.service.js';

let currentUser = null;
let currentAuthorName = 'Miembro';
let activeHousehold = null;
let agendaRealtimeChannel = null;

let allItems = [];
let currentScope = 'all';        // 'all' | 'personal' | 'household'
let currentView = 'timeline';    // 'timeline' | 'priority' | 'calendar'
let activeTypeFilter = 'all';
let activeStatusFilter = 'pendiente';
let searchQuery = '';
let selectedColor = '#10b981';

// Estado del Calendario Mensual
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-11
let selectedCalendarDay = null;

const MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

export async function initAgenda() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        navigateTo('/');
        return;
    }

    currentUser = user;
    const meta = user.user_metadata || {};
    currentAuthorName = meta.nickname || meta.full_name?.split(' ')[0] || user.email.split('@')[0];

    // Reiniciar estado limpio al montar la vista
    currentScope = 'all';
    currentView = 'timeline';
    activeTypeFilter = 'all';
    activeStatusFilter = 'pendiente';
    searchQuery = '';
    selectedColor = '#10b981';
    const now = new Date();
    calYear = now.getFullYear();
    calMonth = now.getMonth();
    selectedCalendarDay = null;

    const dateInput = document.getElementById('agDateInput');
    if (dateInput) dateInput.value = getTodayISO();

    activeHousehold = await getActiveHousehold(user.id);
    setupHouseholdControls();
    bindAgendaEvents();

    await refreshAgendaData();
    subscribeAgendaRealtime();
}

function setupHouseholdControls() {
    const scopeBox = document.getElementById('agendaScopeBox');
    const houseControls = document.getElementById('agHouseholdControls');
    const assignedSelect = document.getElementById('agAssignedSelect');

    if (!activeHousehold) {
        if (scopeBox) scopeBox.style.display = 'none';
        if (houseControls) houseControls.style.display = 'none';
        return;
    }

    if (scopeBox) scopeBox.style.display = 'flex';
    if (houseControls) houseControls.style.display = 'block';

    if (assignedSelect) {
        const members = activeHousehold.members || [];
        assignedSelect.innerHTML = `<option value="Todos">👨‍👩‍👧‍👦 Todos</option>` +
            members.map(m => `<option value="${escapeHTML(m.name)}">👤 ${escapeHTML(m.name)}</option>`).join('');
    }
}

async function refreshAgendaData() {
    try {
        allItems = await loadAgendaItems({
            userId: currentUser.id,
            householdId: activeHousehold?.id || null,
            scope: currentScope
        });
        updateAgendaKPIs();
        renderCurrentView();
        syncAgendaReminders(allItems).catch(() => {});
    } catch (err) {
        console.error('Error cargando agenda:', err);
        showToast('Error al sincronizar agenda: ' + (err.message || ''), 'error');
    }
}

function updateAgendaKPIs() {
    const pending = allItems.filter(i => i.status !== 'completado');
    const completed = allItems.filter(i => i.status === 'completado');

    const criticalCount = pending.filter(i => getEffectivePriority(i) === 'critica' || diffDaysFromToday(i.due_date) < 0).length;
    const overdueCount = pending.filter(i => diffDaysFromToday(i.due_date) < 0).length;

    const weekItems = pending.filter(i => {
        const d = diffDaysFromToday(i.due_date);
        return d >= 0 && d <= 7;
    });

    const todayMonthPrefix = getTodayISO().slice(0, 7);
    const monthFinancial = pending.filter(i =>
        ['cuota_deuda', 'aporte_inversion', 'pago_fijo'].includes(i.item_type) &&
        String(i.due_date || '').startsWith(todayMonthPrefix)
    );
    const monthFinancialTotal = monthFinancial.reduce((acc, i) => acc + Number(i.amount || 0), 0);

    const donePct = allItems.length > 0 ? Math.round((completed.length / allItems.length) * 100) : 0;

    const critEl = document.getElementById('agKpiCritical');
    const critSubEl = document.getElementById('agKpiCriticalSub');
    const weekEl = document.getElementById('agKpiWeek');
    const weekSubEl = document.getElementById('agKpiWeekSub');
    const moneyEl = document.getElementById('agKpiMonthMoney');
    const moneySubEl = document.getElementById('agKpiMonthMoneySub');
    const doneEl = document.getElementById('agKpiDone');
    const doneSubEl = document.getElementById('agKpiDoneSub');

    if (critEl) critEl.textContent = criticalCount;
    if (critSubEl) critSubEl.textContent = overdueCount > 0 ? `${overdueCount} vencido(s) por resolver` : 'Sin atrasos vencidos';
    if (weekEl) weekEl.textContent = weekItems.length;
    if (weekSubEl) {
        const weekMoney = weekItems.reduce((acc, i) => acc + Number(i.amount || 0), 0);
        weekSubEl.textContent = weekMoney > 0 ? `Compromisos 7d: ${formatCOP(weekMoney)}` : 'Actividades próximos 7 días';
    }
    if (moneyEl) moneyEl.textContent = formatCOP(monthFinancialTotal);
    if (moneySubEl) moneySubEl.textContent = `${monthFinancial.length} pago(s)/aporte(s) este mes`;
    if (doneEl) doneEl.textContent = `${donePct}%`;
    if (doneSubEl) doneSubEl.textContent = `${completed.length} de ${allItems.length} completados`;
}

function getFilteredItems() {
    let list = [...allItems];

    if (activeStatusFilter === 'pendiente') {
        list = list.filter(i => i.status !== 'completado');
    } else if (activeStatusFilter === 'completado') {
        list = list.filter(i => i.status === 'completado');
    }

    if (activeTypeFilter !== 'all') {
        list = list.filter(i => i.item_type === activeTypeFilter);
    }

    if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        list = list.filter(i =>
            (i.title && i.title.toLowerCase().includes(q)) ||
            (i.description && i.description.toLowerCase().includes(q)) ||
            (i.assigned_to && i.assigned_to.toLowerCase().includes(q))
        );
    }

    return list;
}

function renderCurrentView() {
    const container = document.getElementById('agendaMainContainer');
    if (!container) return;

    const filtered = getFilteredItems();

    if (currentView === 'calendar') {
        renderCalendarView(container, filtered);
    } else if (currentView === 'priority') {
        renderPriorityView(container, filtered);
    } else {
        renderTimelineView(container, filtered);
    }
}

// VISTA 1: ORGANIZACIÓN POR TIEMPO (VENCIDOS, HOY, PRÓXIMOS 7 DÍAS, PRÓXIMOS MESES)
function renderTimelineView(container, items) {
    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = renderEmptyState();
        return;
    }

    const sorted = sortAgendaItems(items, 'time');
    const groups = [
        { key: 'overdue',  title: '🔥 Vencidos',          accent: '#ef4444', items: [] },
        { key: 'today',    title: '⚡ Para Hoy',           accent: 'var(--primary-neon)', items: [] },
        { key: 'week',     title: '📅 Próximos 7 Días',   accent: '#f59e0b', items: [] },
        { key: 'month',    title: '🗓️ Este Mes (8–30 días)', accent: '#0ea5e9', items: [] },
        { key: 'later',    title: '🔭 Próximos Meses',    accent: '#a855f7', items: [] },
        { key: 'done',     title: '✅ Completados',        accent: '#10b981', items: [] }
    ];

    sorted.forEach(item => {
        if (item.status === 'completado') {
            groups[5].items.push(item);
            return;
        }
        const days = diffDaysFromToday(item.due_date);
        if (days < 0) groups[0].items.push(item);
        else if (days === 0) groups[1].items.push(item);
        else if (days <= 7) groups[2].items.push(item);
        else if (days <= 30) groups[3].items.push(item);
        else groups[4].items.push(item);
    });

    groups.forEach(group => {
        if (group.items.length === 0) return;
        container.appendChild(buildGroupSection(group.title, group.accent, group.items));
    });
}

// VISTA 2: ORGANIZACIÓN POR PRIORIDAD (CRÍTICA -> ALTA -> MEDIA -> BAJA)
function renderPriorityView(container, items) {
    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = renderEmptyState();
        return;
    }

    const sorted = sortAgendaItems(items, 'priority');
    const buckets = { critica: [], alta: [], media: [], baja: [], completado: [] };

    sorted.forEach(item => {
        if (item.status === 'completado') {
            buckets.completado.push(item);
        } else {
            const eff = getEffectivePriority(item);
            (buckets[eff] || buckets.media).push(item);
        }
    });

    ['critica', 'alta', 'media', 'baja'].forEach(prioKey => {
        if (buckets[prioKey].length === 0) return;
        const meta = PRIORITY_META[prioKey];
        container.appendChild(buildGroupSection(`${meta.icon} Prioridad ${meta.label}`, meta.color, buckets[prioKey]));
    });

    if (buckets.completado.length > 0) {
        container.appendChild(buildGroupSection('✅ Completados', '#10b981', buckets.completado));
    }
}

// VISTA 3: CALENDARIO MENSUAL INTERACTIVO
function renderCalendarView(container, items) {
    container.innerHTML = '';

    const navBar = document.createElement('div');
    navBar.style.cssText = 'display: flex; justify-content: space-between; align-items: center; gap: 0.8rem; background: var(--bg-color); padding: 0.85rem 1.2rem; border-radius: 14px; border: 1px solid var(--border-card);';
    navBar.innerHTML = `
        <button type="button" id="btnCalPrev" class="btn-outline" style="padding: 0.4rem 0.8rem;">← Anterior</button>
        <div style="text-align: center;">
            <strong style="font-size: 1.02rem; color: var(--text-main);">${MONTH_NAMES[calMonth]} ${calYear}</strong>
            ${selectedCalendarDay ? `<div style="font-size: 0.74rem; color: var(--primary-neon); cursor: pointer;" id="btnCalClearDay">Filtrando día ${escapeHTML(selectedCalendarDay)} (Ver todo el mes ✕)</div>` : ''}
        </div>
        <button type="button" id="btnCalNext" class="btn-outline" style="padding: 0.4rem 0.8rem;">Siguiente →</button>
    `;
    container.appendChild(navBar);

    navBar.querySelector('#btnCalPrev').addEventListener('click', () => {
        calMonth--;
        if (calMonth < 0) { calMonth = 11; calYear--; }
        selectedCalendarDay = null;
        renderCurrentView();
    });
    navBar.querySelector('#btnCalNext').addEventListener('click', () => {
        calMonth++;
        if (calMonth > 11) { calMonth = 0; calYear++; }
        selectedCalendarDay = null;
        renderCurrentView();
    });
    navBar.querySelector('#btnCalClearDay')?.addEventListener('click', () => {
        selectedCalendarDay = null;
        renderCurrentView();
    });

    const firstDay = new Date(calYear, calMonth, 1).getDay(); // 0=Dom
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const todayStr = getTodayISO();
    const monthPrefix = `${calYear}-${String(calMonth + 1).padStart(2, '0')}`;

    // Mapear ítems por fecha del mes visible
    const itemsByDate = {};
    items.forEach(item => {
        const d = String(item.due_date || '').slice(0, 10);
        if (d.startsWith(monthPrefix)) {
            if (!itemsByDate[d]) itemsByDate[d] = [];
            itemsByDate[d].push(item);
        }
    });

    const gridWrap = document.createElement('div');
    gridWrap.style.cssText = 'display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 6px;';

    ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].forEach(dayName => {
        const hdr = document.createElement('div');
        hdr.style.cssText = 'text-align: center; font-size: 0.74rem; font-weight: 700; color: var(--text-muted); padding: 4px 0;';
        hdr.textContent = dayName;
        gridWrap.appendChild(hdr);
    });

    for (let blank = 0; blank < firstDay; blank++) {
        const emptyCell = document.createElement('div');
        emptyCell.style.cssText = 'min-height: 70px; border-radius: 12px; background: transparent;';
        gridWrap.appendChild(emptyCell);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${monthPrefix}-${String(day).padStart(2, '0')}`;
        const dayItems = itemsByDate[dateStr] || [];
        const isToday = dateStr === todayStr;
        const isSelected = dateStr === selectedCalendarDay;

        const cell = document.createElement('button');
        cell.type = 'button';
        cell.style.cssText = `
            min-height: 74px;
            padding: 6px;
            border-radius: 12px;
            border: 1px solid ${isSelected ? 'var(--primary-neon)' : isToday ? 'var(--primary-neon)' : 'var(--border-card)'};
            background: ${isSelected ? 'rgba(16, 185, 129, 0.14)' : 'var(--bg-color)'};
            display: flex;
            flex-direction: column;
            align-items: flex-start;
            gap: 4px;
            cursor: pointer;
            text-align: left;
            overflow: hidden;
        `;

        const dotsHtml = dayItems.slice(0, 3).map(it => {
            const pColor = it.status === 'completado' ? '#10b981' : (it.color_tag || PRIORITY_META[getEffectivePriority(it)]?.color || '#0ea5e9');
            return `<div style="width: 100%; font-size: 0.66rem; font-weight: 700; color: ${escapeHTML(pColor)}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">• ${escapeHTML(it.title)}</div>`;
        }).join('');

        const extraHtml = dayItems.length > 3
            ? `<div style="font-size: 0.64rem; color: var(--text-muted);">+${dayItems.length - 3} más</div>`
            : '';

        cell.innerHTML = `
            <span style="font-size: 0.78rem; font-weight: 800; color: ${isToday ? 'var(--primary-neon)' : 'var(--text-main)'};">${day}</span>
            ${dotsHtml}
            ${extraHtml}
        `;

        cell.addEventListener('click', () => {
            selectedCalendarDay = (selectedCalendarDay === dateStr) ? null : dateStr;
            renderCurrentView();
        });

        gridWrap.appendChild(cell);
    }

    container.appendChild(gridWrap);

    // Lista inferior de ítems del día seleccionado o de todo el mes visible
    const detailItems = selectedCalendarDay
        ? (itemsByDate[selectedCalendarDay] || [])
        : sortAgendaItems(items.filter(i => String(i.due_date || '').startsWith(monthPrefix)), 'time');

    const detailTitle = selectedCalendarDay
        ? `📌 Agenda del ${selectedCalendarDay}`
        : `📋 Todos los registros de ${MONTH_NAMES[calMonth]} ${calYear}`;

    if (detailItems.length === 0) {
        const emptyBox = document.createElement('p');
        emptyBox.style.cssText = 'color: var(--text-muted); font-size: 0.86rem; text-align: center; padding: 1.2rem 0; border: 1px dashed var(--border-card); border-radius: 14px;';
        emptyBox.textContent = selectedCalendarDay
            ? `No hay eventos ni cuotas programadas para el ${selectedCalendarDay}.`
            : `No hay registros en ${MONTH_NAMES[calMonth]} ${calYear}.`;
        container.appendChild(emptyBox);
    } else {
        container.appendChild(buildGroupSection(detailTitle, 'var(--primary-neon)', detailItems));
    }
}

function buildGroupSection(title, accentColor, items) {
    const section = document.createElement('div');
    section.style.cssText = 'display: flex; flex-direction: column; gap: 0.65rem;';

    const totalAmt = items
        .filter(i => i.status !== 'completado' && Number(i.amount || 0) > 0)
        .reduce((acc, i) => acc + Number(i.amount || 0), 0);

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding-bottom: 4px; border-bottom: 1px solid var(--border-card);';
    header.innerHTML = `
        <h4 style="font-size: 0.88rem; font-weight: 800; color: ${accentColor}; margin: 0; text-transform: uppercase; letter-spacing: 0.4px;">
            ${escapeHTML(title)} (${items.length})
        </h4>
        ${totalAmt > 0 ? `<span style="font-size: 0.78rem; font-weight: 700; color: var(--text-muted);">Total grupo: <strong style="color: var(--text-main);">${formatCOP(totalAmt)}</strong></span>` : ''}
    `;
    section.appendChild(header);

    items.forEach(item => {
        section.appendChild(buildAgendaRow(item));
    });

    return section;
}

function buildAgendaRow(item) {
    const isDone = item.status === 'completado';
    const effPrio = getEffectivePriority(item);
    const prioInfo = PRIORITY_META[effPrio] || PRIORITY_META.media;
    const typeInfo = AGENDA_TYPE_META[item.item_type] || AGENDA_TYPE_META.tarea;
    const isFinancial = ['cuota_deuda', 'aporte_inversion', 'pago_fijo'].includes(item.item_type);
    const needsPayConfirm = !isDone && isFinancial && Number(item.amount || 0) > 0 && !item.linked_tx_id;
    const days = diffDaysFromToday(item.due_date);
    const defaultSource = item.household_id ? 'household' : 'personal';

    const dateLabel = days < 0 && !isDone
        ? `Vencido hace ${Math.abs(days)}d (${item.due_date})`
        : days === 0
            ? 'Hoy'
            : days === 1
                ? 'Mañana'
                : item.due_date;

    const timeLabel = item.due_time ? ` • ${String(item.due_time).slice(0, 5)}` : '';
    const borderCol = isDone ? '#10b981' : (item.color_tag || prioInfo.color);

    const row = document.createElement('div');
    row.className = 'setting-row';
    row.style.cssText = `
        margin-bottom: 0;
        padding: 0.95rem 1.15rem;
        border-left: 4px solid ${borderCol};
        opacity: ${isDone ? '0.68' : '1'};
        flex-wrap: wrap;
        gap: 0.8rem;
    `;

    const amountBadge = Number(item.amount || 0) > 0
        ? `<span style="font-size: 0.82rem; font-weight: 800; padding: 2px 8px; border-radius: 8px; background: rgba(168, 85, 247, 0.14); color: #a855f7;">${formatCOP(item.amount)}</span>`
        : '';

    const scopeBadge = item.household_id
        ? `<span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 6px; background: rgba(16,185,129,0.12); color: var(--primary-neon);">🏠 ${escapeHTML(item.assigned_to || 'Hogar')}</span>`
        : `<span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 6px; background: var(--bg-color); color: var(--text-muted);">👤 Personal</span>`;

    const completeBtnText = isDone
        ? '↺ Reabrir'
        : needsPayConfirm
            ? (item.item_type === 'aporte_inversion' ? '📈 Invertir ✓' : '💳 Pagar ✓')
            : '✓ Listo';

    row.innerHTML = `
        <div class="setting-info" style="flex: 1; min-width: 220px;">
            <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px;">
                <span style="font-size: 0.7rem; font-weight: 700; padding: 2px 7px; border-radius: 6px; background: ${prioInfo.bg}; color: ${prioInfo.color}; text-transform: uppercase;">
                    ${prioInfo.icon} ${prioInfo.label}
                </span>
                <span style="font-size: 0.72rem; font-weight: 700; color: ${typeInfo.color};">
                    ${typeInfo.icon} ${typeInfo.label}
                </span>
                ${scopeBadge}
                ${amountBadge}
            </div>
            <h4 style="font-size: 0.96rem; color: var(--text-main); margin: 0 0 2px 0; text-decoration: ${isDone ? 'line-through' : 'none'};">
                ${escapeHTML(item.title)}
            </h4>
            ${item.description ? `<p style="font-size: 0.8rem; color: var(--text-muted); margin: 0 0 4px 0;">${escapeHTML(item.description)}</p>` : ''}
            <div style="font-size: 0.75rem; color: ${days < 0 && !isDone ? '#ef4444' : 'var(--text-muted)'}; font-weight: ${days <= 1 && !isDone ? '700' : '500'};">
                📆 ${escapeHTML(dateLabel)}${escapeHTML(timeLabel)}
                ${item.linked_tx_id ? ' • <span style="color: #10b981;">✔ Asentado en Finanzas</span>' : ''}
            </div>
        </div>

        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            <button type="button" class="btn-outline btn-ag-complete" style="padding: 0.42rem 0.8rem; font-size: 0.78rem; font-weight: 700; border-color: ${isDone ? 'var(--border-card)' : 'var(--primary-neon)'}; color: ${isDone ? 'var(--text-muted)' : 'var(--primary-neon)'};">
                ${completeBtnText}
            </button>
            ${!isDone ? `<button type="button" class="btn-outline btn-ag-reschedule" title="Reprogramar fecha" style="padding: 0.42rem 0.65rem; font-size: 0.78rem;">🗓️</button>` : ''}
            <button type="button" class="btn-outline btn-ag-delete" title="Eliminar" style="padding: 0.42rem 0.65rem; font-size: 0.78rem; border-color: transparent; color: var(--text-muted);">✕</button>
        </div>

        ${needsPayConfirm ? `
        <div class="ag-pay-panel" style="display: none; width: 100%; padding-top: 0.7rem; border-top: 1px dashed var(--primary-neon); align-items: flex-end; gap: 8px; flex-wrap: wrap;">
            <div>
                <label style="display: block; font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px;">Monto real ($)</label>
                <input type="number" class="form-input ag-pay-amount" value="${Number(item.amount)}" min="1" step="0.01" style="width: 120px; padding: 0.38rem 0.55rem; font-size: 0.82rem; font-weight: 700;">
            </div>
            <div>
                <label style="display: block; font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px;">Fecha de pago</label>
                <input type="date" class="form-input ag-pay-date" value="${getTodayISO()}" style="width: auto; padding: 0.38rem 0.5rem; font-size: 0.78rem;">
            </div>
            <div>
                <label style="display: block; font-size: 0.7rem; color: var(--text-muted); margin-bottom: 2px;">¿De dónde sale?</label>
                <select class="form-input ag-pay-source" style="width: auto; padding: 0.38rem 0.55rem; font-size: 0.78rem; cursor: pointer;">
                    <option value="personal" ${defaultSource === 'personal' ? 'selected' : ''}>👤 Flujo Personal</option>
                    ${activeHousehold ? `<option value="household" ${defaultSource === 'household' ? 'selected' : ''}>🏠 Hogar (${escapeHTML(activeHousehold.name)})</option>` : ''}
                </select>
            </div>
            <button type="button" class="btn-save btn-ag-confirm-pay" style="margin: 0; padding: 0.42rem 0.85rem; font-size: 0.76rem;">Confirmar ✓</button>
            <button type="button" class="btn-outline btn-ag-cancel-pay" style="padding: 0.4rem 0.7rem; font-size: 0.76rem;">Cancelar</button>
        </div>` : ''}

        <div class="ag-reschedule-panel" style="display: none; width: 100%; padding-top: 0.65rem; border-top: 1px dashed var(--border-card); align-items: center; gap: 8px; flex-wrap: wrap;">
            <span style="font-size: 0.76rem; color: var(--text-muted); font-weight: 600;">Nueva fecha:</span>
            <input type="date" class="form-input ag-new-date-input" value="${escapeHTML(String(item.due_date || '').slice(0, 10))}" style="width: auto; padding: 0.35rem 0.6rem; font-size: 0.8rem;">
            <button type="button" class="btn-save btn-ag-save-date" style="margin: 0; padding: 0.38rem 0.8rem; font-size: 0.76rem;">Guardar</button>
            <button type="button" class="btn-outline btn-ag-plus1" style="padding: 0.35rem 0.65rem; font-size: 0.74rem;">+1 día</button>
            <button type="button" class="btn-outline btn-ag-plus7" style="padding: 0.35rem 0.65rem; font-size: 0.74rem;">+7 días</button>
        </div>
    `;

    const payPanel = row.querySelector('.ag-pay-panel');
    const resPanel = row.querySelector('.ag-reschedule-panel');

    // Acción 1: Completar o abrir panel de origen/monto
    row.querySelector('.btn-ag-complete').addEventListener('click', async (e) => {
        if (needsPayConfirm && payPanel) {
            if (resPanel) resPanel.style.display = 'none';
            payPanel.style.display = payPanel.style.display === 'none' ? 'flex' : 'none';
            return;
        }

        const btn = e.currentTarget;
        btn.disabled = true;
        try {
            await completeAgendaItem(item, {
                userId: currentUser.id,
                authorName: currentAuthorName,
                registerFinance: true
            });
            showToast(isDone ? 'Registro reabierto como pendiente.' : 'Actividad marcada como completada.', isDone ? 'info' : 'success');
            await refreshAgendaData();
        } catch (err) {
            showToast('Error al actualizar: ' + err.message, 'error');
            btn.disabled = false;
        }
    });

    // Confirmar Pago con Origen y Monto Real
    if (payPanel) {
        row.querySelector('.btn-ag-cancel-pay').addEventListener('click', () => {
            payPanel.style.display = 'none';
        });
        row.querySelector('.btn-ag-confirm-pay').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
                const realAmt = Number(row.querySelector('.ag-pay-amount').value);
                const realDate = row.querySelector('.ag-pay-date').value;
                const srcVal = row.querySelector('.ag-pay-source').value;
                const sourceHouseholdId = (srcVal === 'household' && activeHousehold) ? activeHousehold.id : null;

                if (!realAmt || realAmt <= 0) {
                    showToast('Ingresa un monto válido mayor a 0.', 'info');
                    btn.disabled = false;
                    return;
                }

                await completeAgendaItem(item, {
                    userId: currentUser.id,
                    authorName: currentAuthorName,
                    registerFinance: true,
                    amount: realAmt,
                    transactionDate: realDate,
                    sourceHouseholdId
                });

                const srcLabel = sourceHouseholdId ? 'Hogar Familiar' : 'Flujo Personal';
                showToast(`Pagado (${formatCOP(realAmt)}) desde ${srcLabel} y asentado en Finanzas.`, 'success');
                await refreshAgendaData();
            } catch (err) {
                showToast('Error al registrar pago: ' + err.message, 'error');
                btn.disabled = false;
            }
        });
    }

    // Acción 2: Panel inline de Reprogramación
    const resBtn = row.querySelector('.btn-ag-reschedule');
    if (resBtn && resPanel) {
        resBtn.addEventListener('click', () => {
            if (payPanel) payPanel.style.display = 'none';
            resPanel.style.display = resPanel.style.display === 'none' ? 'flex' : 'none';
        });

        const applyNewDate = async (newDateStr) => {
            if (!newDateStr) return;
            try {
                await updateAgendaItem(item.id, { due_date: newDateStr, status: 'pendiente' });
                showToast(`Reprogramado para el ${newDateStr}`, 'success');
                await refreshAgendaData();
            } catch (err) {
                showToast('Error al reprogramar: ' + err.message, 'error');
            }
        };

        const shiftDays = (daysToAdd) => {
            const base = new Date(`${String(item.due_date || getTodayISO()).slice(0, 10)}T12:00:00`);
            base.setDate(base.getDate() + daysToAdd);
            return base.toISOString().slice(0, 10);
        };

        row.querySelector('.btn-ag-save-date').addEventListener('click', () => {
            applyNewDate(row.querySelector('.ag-new-date-input')?.value);
        });
        row.querySelector('.btn-ag-plus1').addEventListener('click', () => applyNewDate(shiftDays(1)));
        row.querySelector('.btn-ag-plus7').addEventListener('click', () => applyNewDate(shiftDays(7)));
    }

    // Acción 3: Eliminar
    row.querySelector('.btn-ag-delete').addEventListener('click', async () => {
        try {
            await deleteAgendaItem(item.id);
            showToast('Registro eliminado de la agenda.', 'info');
            await refreshAgendaData();
        } catch (err) {
            showToast('Error al eliminar: ' + err.message, 'error');
        }
    });

    return row;
}

function renderEmptyState() {
    return `
        <div style="text-align: center; padding: 3rem 1.2rem; border: 1px dashed var(--border-card); border-radius: 18px; color: var(--text-muted);">
            <p style="font-size: 0.96rem; margin-bottom: 0.35rem; font-weight: 600;">No hay elementos en la agenda con este filtro.</p>
            <span style="font-size: 0.82rem;">Programa una tarea, evento o cuota en el panel izquierdo o proyecta tus deudas desde Flujo Financiero.</span>
        </div>
    `;
}

function bindAgendaEvents() {
    // 1. Alcance (Todo / Personal / Hogar)
    const scopeBtns = document.querySelectorAll('.agenda-scope-btn');
    scopeBtns.forEach(btn => {
        btn.addEventListener('click', async () => {
            scopeBtns.forEach(b => {
                b.classList.remove('active');
                b.style.background = 'transparent';
                b.style.color = 'var(--text-muted)';
            });
            btn.classList.add('active');
            btn.style.background = 'var(--panel-bg)';
            btn.style.color = 'var(--primary-neon)';
            currentScope = btn.dataset.scope;

            const shareCheck = document.getElementById('agShareHouseholdCheck');
            if (shareCheck) shareCheck.checked = (currentScope === 'household');

            await refreshAgendaData();
        });
    });

    // 2. Cambio de Vista (Tiempo / Prioridad / Calendario)
    const viewBtns = document.querySelectorAll('.ag-view-btn');
    viewBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            viewBtns.forEach(b => {
                b.classList.remove('active');
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            btn.classList.add('active');
            btn.style.borderColor = 'var(--primary-neon)';
            btn.style.color = 'var(--primary-neon)';
            currentView = btn.dataset.view;
            selectedCalendarDay = null;
            renderCurrentView();
        });
    });

    // 3. Filtros por tipo, estado y búsqueda
    const typeFilterBtns = document.querySelectorAll('.ag-type-filter');
    typeFilterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            typeFilterBtns.forEach(b => {
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            btn.style.borderColor = 'var(--primary-neon)';
            btn.style.color = 'var(--primary-neon)';
            activeTypeFilter = btn.dataset.type;
            renderCurrentView();
        });
    });

    document.getElementById('agStatusFilter')?.addEventListener('change', (e) => {
        activeStatusFilter = e.target.value;
        renderCurrentView();
    });

    document.getElementById('agSearchInput')?.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderCurrentView();
    });

    // 4. Selector de color
    const colorBtns = document.querySelectorAll('.ag-color-btn');
    colorBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            colorBtns.forEach(b => b.style.borderColor = 'transparent');
            btn.style.borderColor = 'var(--text-main)';
            selectedColor = btn.dataset.color;
        });
    });

    // 5. Ajuste inteligente de color y prioridad al cambiar el Tipo en el formulario
    document.getElementById('agTypeSelect')?.addEventListener('change', (e) => {
        const val = e.target.value;
        const prioSel = document.getElementById('agPrioritySelect');
        if (val === 'alerta' || val === 'cuota_deuda') {
            if (prioSel) prioSel.value = 'alta';
        }
        const metaColor = AGENDA_TYPE_META[val]?.color;
        if (metaColor) {
            selectedColor = metaColor;
            colorBtns.forEach(b => {
                b.style.borderColor = b.dataset.color === metaColor ? 'var(--text-main)' : 'transparent';
            });
        }
    });

    // 6. Envío del Formulario de Nuevo Registro
    const form = document.getElementById('agendaItemForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = document.getElementById('agTitleInput')?.value.trim();
            const description = document.getElementById('agDescInput')?.value.trim() || null;
            const itemType = document.getElementById('agTypeSelect')?.value || 'tarea';
            const priority = document.getElementById('agPrioritySelect')?.value || 'media';
            const dueDate = document.getElementById('agDateInput')?.value || getTodayISO();
            const dueTime = document.getElementById('agTimeInput')?.value || null;
            const amountVal = document.getElementById('agAmountInput')?.value;
            const shareWithHouse = Boolean(document.getElementById('agShareHouseholdCheck')?.checked && activeHousehold);
            const assignedTo = shareWithHouse
                ? (document.getElementById('agAssignedSelect')?.value || 'Todos')
                : 'Personal';

            if (!title) return;

            const submitBtn = form.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;

            try {
                await createAgendaItem({
                    user_id: currentUser.id,
                    household_id: shareWithHouse ? activeHousehold.id : null,
                    author_name: currentAuthorName,
                    assigned_to: assignedTo,
                    title,
                    description,
                    item_type: itemType,
                    priority,
                    due_date: dueDate,
                    due_time: dueTime,
                    status: 'pendiente',
                    color_tag: selectedColor,
                    amount: amountVal ? Number(amountVal) : null
                });

                form.reset();
                const dateInput = document.getElementById('agDateInput');
                if (dateInput) dateInput.value = getTodayISO();
                showToast('Elemento programado en tu Agenda.', 'success');
                await refreshAgendaData();
            } catch (err) {
                showToast('Error al guardar en agenda: ' + err.message, 'error');
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }
}

function subscribeAgendaRealtime() {
    if (agendaRealtimeChannel) {
        supabase.removeChannel(agendaRealtimeChannel);
    }
    agendaRealtimeChannel = supabase
        .channel(`agenda-live-${currentUser.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_items' }, () => {
            if (document.getElementById('agendaMainContainer')) {
                refreshAgendaData();
            }
        })
        .subscribe();
}