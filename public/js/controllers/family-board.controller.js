// public/js/controllers/family-board.controller.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from '../core/router.js';
import { showToast } from '../ui/toast.js';
import { getActiveHousehold, createHousehold, joinHouseholdByCode } from '../core/household.js';
import {
    escapeHTML,
    formatCOP,
    getTransactionNature,
    summarizeTransactions,
    getMonthlyCommitmentImpact,
    loadCommitments,
    payNextCommitmentInstallment,
    deleteTransactionWithSync
} from '../services/finance.service.js';
import {
    loadAgendaItems,
    sortAgendaItems,
    completeAgendaItem,
    describeCommitmentSchedule,
    diffDaysFromToday,
    getTodayISO
} from '../services/agenda.service.js';

const CATEGORY_LABELS = {
    nota:   { icon: '📌', label: 'Nota Visual' },
    alerta: { icon: '🚨', label: 'Alerta Urgente' },
    evento: { icon: '📅', label: 'Evento' },
    tarea:  { icon: '✅', label: 'Tarea' }
};

const DATA_CAT_ICONS = {
    servicios:  '💡 Referencia de Pago',
    wifi:       '📶 Red & Accesos',
    emergencia: '🚑 Contacto / Emergencia',
    general:    '📋 Dato del Hogar'
};

let currentUser = null;
let currentAuthorName = 'Miembro';
let activeHousehold = null;

let allPosts = [];
let familyTransactions = [];
let importantDataList = [];
let familyAgendaItems = [];
let familyCommitments = [];

let activeCategory = 'all';
let searchQuery = '';
let selectedColor = '#10b981';
let selectedTxType = 'gasto';
let selectedMonth = 'all';
let familyRealtimeChannel = null;

export async function initFamilyBoard() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        navigateTo('/');
        return;
    }
    currentUser = user;
    const meta = user.user_metadata || {};
    currentAuthorName = meta.nickname || meta.full_name?.split(' ')[0] || user.email.split('@')[0];
    selectedColor = '#10b981';
    selectedTxType = 'gasto';
    activeCategory = 'all';
    searchQuery = '';

    const currentMonthStr = String(new Date().getMonth() + 1).padStart(2, '0');
    const monthSelect = document.getElementById('familyMonthFilter');
    if (monthSelect) {
        monthSelect.value = currentMonthStr;
        selectedMonth = currentMonthStr;
    }

    bindSetupEvents();
    bindWorkspaceEvents();
    await refreshHouseholdState();
}

async function refreshHouseholdState() {
    activeHousehold = await getActiveHousehold(currentUser.id);

    const setupBox = document.getElementById('noHouseholdSetupBox');
    const workspace = document.getElementById('activeHouseholdWorkspace');
    const topActions = document.getElementById('householdTopActions');
    const codeBadge = document.getElementById('householdCodeBadge');
    const codeText = document.getElementById('householdCodeText');
    const titleEl = document.getElementById('familyHeaderTitle');

    if (!activeHousehold) {
        if (setupBox) setupBox.style.display = 'grid';
        if (workspace) workspace.style.display = 'none';
        if (topActions) topActions.style.display = 'none';
        if (codeBadge) codeBadge.style.display = 'none';
        return;
    }

    if (setupBox) setupBox.style.display = 'none';
    if (workspace) workspace.style.display = 'block';
    if (topActions) topActions.style.display = 'flex';
    if (codeBadge) codeBadge.style.display = 'inline-flex';
    if (codeText) codeText.textContent = activeHousehold.invite_code;
    if (titleEl) titleEl.textContent = activeHousehold.name;

    const budgetInput = document.getElementById('famBudgetInput');
    if (budgetInput && activeHousehold.monthly_budget > 0) {
        budgetInput.value = activeHousehold.monthly_budget;
    }

    renderMembersBarAndSelect();
    await loadAllFamilyData();
    subscribeToFamilyRealtime();
}

function renderMembersBarAndSelect() {
    const bar = document.getElementById('householdMembersBar');
    const select = document.getElementById('postAssignedSelect');
    const members = activeHousehold?.members || [];

    if (bar) {
        bar.innerHTML = members.map(m => `
            <div style="display: flex; align-items: center; gap: 5px;" title="${escapeHTML(m.name)} (${escapeHTML(m.role)})">
                <img src="${escapeHTML(m.avatar)}" alt="${escapeHTML(m.name)}" style="width: 26px; height: 26px; border-radius: 50%; border: 1.5px solid var(--primary-neon); object-fit: cover;">
                <span style="font-size: 0.76rem; font-weight: 600; color: var(--text-main);">${escapeHTML(m.name)}</span>
            </div>
        `).join('<span style="color: var(--border-card);">|</span>');
    }

    if (select) {
        select.innerHTML = `<option value="Todos">👨‍👩‍👧‍👦 Todos</option>` +
            members.map(m => `<option value="${escapeHTML(m.name)}">👤 ${escapeHTML(m.name)}</option>`).join('');
    }
}

async function loadAllFamilyData() {
    if (!activeHousehold) return;

    try {
        const [postsRes, txRes, dataRes, invRes, agendaList, commList] = await Promise.all([
            supabase
                .from('family_board_posts')
                .select('*')
                .eq('household_id', activeHousehold.id)
                .order('pinned', { ascending: false })
                .order('created_at', { ascending: false }),
            supabase
                .from('finance_transactions')
                .select('*')
                .eq('household_id', activeHousehold.id)
                .order('transaction_date', { ascending: false })
                .order('created_at', { ascending: false }),
            supabase
                .from('household_important_data')
                .select('*')
                .eq('household_id', activeHousehold.id)
                .order('created_at', { ascending: false }),
            supabase
                .from('inventory_items')
                .select('id, in_shopping_list')
                .eq('household_id', activeHousehold.id),
            loadAgendaItems({
                userId: currentUser.id,
                householdId: activeHousehold.id,
                scope: 'household'
            }).catch(() => []),
            loadCommitments({
                userId: currentUser.id,
                householdId: activeHousehold.id,
                scope: 'household'
            }).catch(() => [])
        ]);

        if (txRes.error) console.error('Error cargando transacciones del hogar:', txRes.error);

        allPosts = postsRes.data || [];
        familyTransactions = txRes.data || [];
        importantDataList = dataRes.data || [];
        familyAgendaItems = agendaList || [];
        familyCommitments = commList || [];
        const sharedShoppingCount = (invRes.data || []).filter(i => i.in_shopping_list).length;

        updateEcosystemKPIs(sharedShoppingCount);
        updateUpcomingAgenda();
        renderBoardGrid();
        renderFamilyCommitments();
        renderFamilyFinanceFlow();
        renderImportantDataGrid();
    } catch (err) {
        console.error('Error sincronizando ecosistema familiar:', err);
    }
}

function getFilteredTransactions() {
    if (selectedMonth === 'all') return familyTransactions;
    return familyTransactions.filter(tx => {
        const dateStr = tx.transaction_date || tx.created_at || '';
        return dateStr.slice(5, 7) === selectedMonth;
    });
}

function updateEcosystemKPIs(sharedShoppingCount = 0) {
    const filteredTx = getFilteredTransactions();
    const s = summarizeTransactions(filteredTx);

    const balanceEl = document.getElementById('famKpiBalance');
    const flowSubEl = document.getElementById('famKpiFlowSub');
    const expEl = document.getElementById('famKpiExpenses');
    const budgetSubEl = document.getElementById('famKpiBudgetSub');
    const postsEl = document.getElementById('famKpiPosts');
    const pinnedSubEl = document.getElementById('famKpiPinnedSub');
    const vaultEl = document.getElementById('famKpiVaultCount');
    const syncSubEl = document.getElementById('famKpiSharedSync');

    const wealthTotal = s.reservedSavings + s.investmentContributions;

    if (balanceEl) {
        balanceEl.textContent = formatCOP(s.availableCash);
        balanceEl.style.color = s.availableCash >= 0 ? 'var(--primary-neon)' : 'var(--danger-color, #ef4444)';
    }
    if (flowSubEl) {
        flowSubEl.textContent = `Aportes: ${formatCOP(s.totalIncome)} | Reserva/Inv: ${formatCOP(wealthTotal)}`;
    }
    if (expEl) expEl.textContent = formatCOP(s.totalOutflows);

    if (budgetSubEl) {
        const limit = Number(activeHousehold?.monthly_budget || 0);
        if (limit > 0) {
            const pct = Math.min(100, Number(((s.totalOutflows / limit) * 100).toFixed(2)));
            const resPct = Number(((wealthTotal / limit) * 100).toFixed(2));
            budgetSubEl.textContent = `Egresos: ${pct}% | Reserva: ${resPct}% (Tope: ${formatCOP(limit)})`;
        } else {
            budgetSubEl.textContent = 'Presupuesto hogar: Sin tope fijo';
        }
    }

    const pendingAgendaCount = familyAgendaItems.filter(a => a.status !== 'completado').length;
    if (postsEl) postsEl.textContent = allPosts.length + pendingAgendaCount;
    if (pinnedSubEl) pinnedSubEl.textContent = `${allPosts.filter(p => p.pinned).length} fijados • ${pendingAgendaCount} en agenda`;
    if (vaultEl) vaultEl.textContent = importantDataList.length;
    if (syncSubEl) syncSubEl.textContent = `${importantDataList.length} datos fijos • ${sharedShoppingCount} en compras`;
}

// WIDGET AGENDA FAMILIAR CONECTADO A agenda_items + EVENTOS DEL MURAL
function updateUpcomingAgenda() {
    const upcomingList = document.getElementById('upcomingEventsList');
    if (!upcomingList) return;

    const pendingAgenda = sortAgendaItems(
        familyAgendaItems.filter(i => i.status !== 'completado'),
        'time'
    ).slice(0, 6);

    const postEvents = allPosts
        .filter(p => p.event_date)
        .sort((a, b) => new Date(a.event_date) - new Date(b.event_date))
        .slice(0, 3);

    upcomingList.innerHTML = '';

    if (pendingAgenda.length === 0 && postEvents.length === 0) {
        upcomingList.innerHTML = `<p style="color: var(--text-muted); font-size: 0.82rem; margin: 0;">Sin eventos ni cuotas programadas.</p>`;
        return;
    }

    pendingAgenda.forEach(item => {
        const days = diffDaysFromToday(item.due_date);
        const dateTag = days < 0 ? `Vencido` : days === 0 ? 'Hoy' : item.due_date;
        const isFinancial = ['cuota_deuda', 'aporte_inversion', 'pago_fijo'].includes(item.item_type);

        const row = document.createElement('div');
        row.style.cssText = `display: flex; justify-content: space-between; align-items: center; gap: 6px; padding: 8px 10px; background: var(--bg-color); border-radius: 10px; border-left: 3px solid ${escapeHTML(item.color_tag || '#a855f7')};`;
        row.innerHTML = `
            <div style="overflow: hidden; flex: 1;">
                <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(item.title)}</div>
                <div style="font-size: 0.72rem; color: ${days < 0 ? '#ef4444' : 'var(--text-muted)'};">
                    ${escapeHTML(dateTag)}${Number(item.amount || 0) > 0 ? ` • <strong>${formatCOP(item.amount)}</strong>` : ''}
                </div>
            </div>
            <button type="button" class="btn-outline btn-fam-ag-done" style="padding: 3px 7px; font-size: 0.72rem; border-color: var(--primary-neon); color: var(--primary-neon); white-space: nowrap;">
                ${isFinancial && Number(item.amount || 0) > 0 ? 'Pagar ✓' : '✓'}
            </button>
        `;
        row.querySelector('.btn-fam-ag-done').addEventListener('click', async (e) => {
            e.currentTarget.disabled = true;
            try {
                await completeAgendaItem(item, { userId: currentUser.id, authorName: currentAuthorName, registerFinance: true });
                showToast(isFinancial ? 'Cuota liquidada y asentada en el Flujo Familiar.' : 'Evento completado.', 'success');
                await loadAllFamilyData();
            } catch (err) {
                showToast('Error al completar: ' + err.message, 'error');
                e.currentTarget.disabled = false;
            }
        });
        upcomingList.appendChild(row);
    });

    postEvents.forEach(ev => {
        const dateStr = new Date(ev.event_date).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
        const row = document.createElement('div');
        row.style.cssText = `display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; background: var(--bg-color); border-radius: 10px; border-left: 3px solid ${escapeHTML(ev.color_tag || '#10b981')};`;
        row.innerHTML = `
            <div style="overflow: hidden;">
                <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">📌 ${escapeHTML(ev.title)}</div>
                <div style="font-size: 0.72rem; color: var(--text-muted);">Mural • Por: ${escapeHTML(ev.author_name || 'Miembro')}</div>
            </div>
            <span style="font-size: 0.74rem; color: var(--primary-neon); font-weight: 700;">${escapeHTML(dateStr)}</span>
        `;
        upcomingList.appendChild(row);
    });
}

function renderFamilyCommitments() {
    const container = document.getElementById('famCommitmentsList');
    if (!container) return;

    container.innerHTML = '';
    const active = familyCommitments.filter(c => c.status === 'activo');

    if (active.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.84rem; margin: 0;">Sin cuotas compartidas activas. Configúralas en <strong>Flujo Financiero → Hogar Familiar → Deuda / Inv.</strong></p>`;
        return;
    }

    active.forEach(c => {
        const isDebt = c.kind === 'deuda';
        const accent = c.color_tag || (isDebt ? '#a855f7' : '#14b8a6');
        const sched = describeCommitmentSchedule(c);
        const monthlyEq = getMonthlyCommitmentImpact(c);
        const progress = c.total_installments ? `${c.paid_installments}/${c.total_installments} cuotas` : `${c.paid_installments} aportes`;

        const row = document.createElement('div');
        row.className = 'setting-row';
        row.style.cssText = `margin-bottom: 0; padding: 0.8rem 1rem; border-left: 4px solid ${accent};`;
        row.innerHTML = `
            <div class="setting-info">
                <h4 style="font-size: 0.92rem; color: var(--text-main); margin-bottom: 2px;">
                    ${isDebt ? '💳' : '📈'} ${escapeHTML(c.title)}
                    <span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 6px; background: var(--panel-bg); color: ${accent}; margin-left: 6px;">${escapeHTML(sched)}</span>
                </h4>
                <p style="font-size: 0.76rem; color: var(--text-muted); margin: 0;">
                    Cuota: <strong>${formatCOP(c.monthly_amount)}</strong> (${formatCOP(monthlyEq)}/mes) • Avance: ${escapeHTML(progress)}
                </p>
            </div>
            <button type="button" class="btn-outline btn-fam-pay-comm" style="padding: 0.4rem 0.8rem; font-size: 0.76rem; font-weight: 700; border-color: var(--primary-neon); color: var(--primary-neon);">
                ${isDebt ? 'Pagar Cuota ✓' : 'Aportar ✓'}
            </button>
        `;

        row.querySelector('.btn-fam-pay-comm').addEventListener('click', async (e) => {
            e.currentTarget.disabled = true;
            try {
                await payNextCommitmentInstallment(c, { userId: currentUser.id, authorName: currentAuthorName });
                showToast('Cuota familiar registrada en el Libro Mayor y marcada en Agenda.', 'success');
                await loadAllFamilyData();
            } catch (err) {
                showToast('Error al registrar cuota: ' + err.message, 'error');
                e.currentTarget.disabled = false;
            }
        });

        container.appendChild(row);
    });
}

function renderBoardGrid() {
    const grid = document.getElementById('boardPostsGrid');
    if (!grid) return;

    let filtered = allPosts;
    if (activeCategory !== 'all') {
        filtered = filtered.filter(p => p.category === activeCategory);
    }
    if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(p =>
            (p.title && p.title.toLowerCase().includes(q)) ||
            (p.content && p.content.toLowerCase().includes(q)) ||
            (p.author_name && p.author_name.toLowerCase().includes(q)) ||
            (p.assigned_to && p.assigned_to.toLowerCase().includes(q))
        );
    }

    grid.innerHTML = '';

    if (filtered.length === 0) {
        grid.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 3rem 1rem; border: 1px dashed var(--border-card); border-radius: 18px; color: var(--text-muted);">
                <p style="font-size: 0.96rem; margin-bottom: 0.3rem;">El mural familiar no tiene publicaciones en este filtro.</p>
                <span style="font-size: 0.82rem;">Publica una nota, tarea asignada o evento en el panel izquierdo.</span>
            </div>
        `;
        return;
    }

    filtered.forEach(post => {
        const catInfo = CATEGORY_LABELS[post.category] || CATEGORY_LABELS.nota;
        const accent = post.color_tag || '#10b981';
        const createdDate = new Date(post.created_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });

        const assignedBadge = post.assigned_to
            ? `<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; background: var(--panel-bg); border: 1px solid var(--border-card); color: var(--text-main);">
                 🎯 Para: <strong>${escapeHTML(post.assigned_to)}</strong>
               </span>`
            : '';

        const eventBadge = post.event_date
            ? `<span style="font-size: 0.72rem; padding: 2px 8px; border-radius: 6px; background: var(--panel-bg); border: 1px solid var(--border-card); color: var(--primary-neon);">
                 📅 ${escapeHTML(new Date(post.event_date).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }))}
               </span>`
            : '';

        const card = document.createElement('div');
        card.style.cssText = `
            background: var(--bg-color);
            border: 1px solid var(--border-card);
            border-top: 4px solid ${accent};
            border-radius: 18px;
            padding: 1.3rem;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            box-shadow: var(--shadow-base);
        `;

        card.innerHTML = `
            <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem;">
                    <span style="font-size: 0.74rem; font-weight: 700; text-transform: uppercase; color: ${escapeHTML(accent)};">
                        ${catInfo.icon} ${catInfo.label}
                    </span>
                    <div style="display: flex; align-items: center; gap: 6px;">
                        <button type="button" class="btn-pin-post" title="Fijar/Desfijar" style="background: transparent; border: none; cursor: pointer; font-size: 0.95rem; opacity: ${post.pinned ? '1' : '0.35'};">📌</button>
                        <button type="button" class="btn-delete-post" title="Eliminar" style="background: transparent; border: none; cursor: pointer; color: var(--danger-color, #ef4444); font-size: 0.9rem;">✕</button>
                    </div>
                </div>
                <h4 style="font-size: 1.05rem; font-weight: 700; color: var(--text-main); margin-bottom: 0.4rem;">${escapeHTML(post.title)}</h4>
                <p style="font-size: 0.9rem; color: var(--text-muted); line-height: 1.5; white-space: pre-wrap; margin-bottom: 0.8rem;">${escapeHTML(post.content)}</p>
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    ${assignedBadge}
                    ${eventBadge}
                </div>
            </div>
            <div style="margin-top: 1rem; padding-top: 0.7rem; border-top: 1px solid var(--border-card); display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem; color: var(--text-muted);">
                <span>✍️ <strong>${escapeHTML(post.author_name || 'Miembro')}</strong> • ${escapeHTML(createdDate)}</span>
                ${post.pinned ? `<span style="color: ${escapeHTML(accent)}; font-weight: 700;">★ Fijado</span>` : ''}
            </div>
        `;

        card.querySelector('.btn-pin-post').addEventListener('click', async () => {
            await supabase.from('family_board_posts').update({ pinned: !post.pinned }).eq('id', post.id);
            await loadAllFamilyData();
        });

        card.querySelector('.btn-delete-post').addEventListener('click', async () => {
            await supabase.from('family_board_posts').delete().eq('id', post.id);
            await loadAllFamilyData();
            showToast('Publicación retirada del mural familiar', 'info');
        });

        grid.appendChild(card);
    });
}

function renderFamilyFinanceFlow() {
    const contribContainer = document.getElementById('famMemberContributions');
    const settlementBox = document.getElementById('famSettlementSummary');
    const closeMonthBtn = document.getElementById('btnCloseMonthToReserve');
    const txListContainer = document.getElementById('famTransactionsList');
    if (!contribContainer || !txListContainer) return;

    const filtered = getFilteredTransactions();
    const summary = summarizeTransactions(filtered);

    // 1. Botón de Cierre Mensual (Enviar excedente libre a Fondo de Emergencia)
    if (closeMonthBtn) {
        if (summary.availableCash > 0) {
            closeMonthBtn.style.display = 'inline-flex';
            closeMonthBtn.textContent = `🏦 Cerrar Mes: Mover ${formatCOP(summary.availableCash)} a Reserva`;
            closeMonthBtn.onclick = async () => {
                closeMonthBtn.disabled = true;
                try {
                    const monthLabel = selectedMonth === 'all' ? 'Acumulado' : `Mes ${selectedMonth}`;
                    const { error } = await supabase.from('finance_transactions').insert({
                        user_id: currentUser.id,
                        household_id: activeHousehold.id,
                        author_name: currentAuthorName,
                        title: `Cierre ${monthLabel} — Traslado a Fondo de Emergencia`,
                        amount: summary.availableCash,
                        type: 'gasto',
                        nature: 'reserva',
                        category: 'Ahorro',
                        is_recurring: false,
                        transaction_date: getTodayISO()
                    });
                    if (error) throw error;
                    showToast(`Excedente de ${formatCOP(summary.availableCash)} trasladado al Fondo de Emergencia (Base Cero).`, 'success');
                    await loadAllFamilyData();
                } catch (err) {
                    showToast('Error al cerrar mes: ' + err.message, 'error');
                    closeMonthBtn.disabled = false;
                }
            };
        } else {
            closeMonthBtn.style.display = 'none';
        }
    }

    // 2. Libro Auxiliar de Participación + Liquidación Equitativa
    const memberTotals = {};
    let totalContributed = 0;

    filtered.forEach(tx => {
        const author = tx.author_name || 'Miembro';
        const amt = Number(tx.amount || 0);
        const nat = getTransactionNature(tx);
        if (!memberTotals[author]) {
            memberTotals[author] = { aportes: 0, pagos: 0, reservas: 0 };
        }
        if (nat === 'ingreso') {
            memberTotals[author].aportes += amt;
            totalContributed += amt;
        } else if (nat === 'reserva' || nat === 'inversion') {
            memberTotals[author].reservas += amt;
        } else {
            memberTotals[author].pagos += amt;
        }
    });

    const authors = Object.keys(memberTotals);
    if (authors.length === 0) {
        contribContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; margin: 0;">Registra los aportes o gastos para ver el Libro Auxiliar y la liquidación equitativa.</p>`;
        if (settlementBox) settlementBox.style.display = 'none';
    } else {
        contribContainer.innerHTML = authors.map(name => {
            const info = memberTotals[name];
            const pct = totalContributed > 0
                ? Math.round((info.aportes / totalContributed) * 100)
                : Math.round(100 / authors.length);
            return `
                <div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.82rem; margin-bottom: 4px; flex-wrap: wrap; gap: 4px;">
                        <span style="font-weight: 700; color: var(--text-main);">👤 ${escapeHTML(name)} (${pct}% del Fondo)</span>
                        <span style="color: var(--text-muted);">
                            Aportado: <strong style="color: #10b981;">${formatCOP(info.aportes)}</strong> |
                            Egresos/Deudas: <strong style="color: var(--danger-color, #ef4444);">${formatCOP(info.pagos)}</strong> |
                            Reserva/Inv: <strong style="color: #0ea5e9;">${formatCOP(info.reservas)}</strong>
                        </span>
                    </div>
                    <div style="width: 100%; height: 8px; background: var(--panel-bg); border-radius: 8px; overflow: hidden;">
                        <div style="width: ${Math.min(100, pct)}%; height: 100%; background: var(--primary-neon);"></div>
                    </div>
                </div>
            `;
        }).join('');

        // Cálculo de balance equitativo entre participantes activos del periodo
        if (settlementBox && authors.length >= 2 && totalContributed > 0) {
            const equalShare = totalContributed / authors.length;
            const diffs = authors.map(name => ({
                name,
                diff: Math.round(memberTotals[name].aportes - equalShare)
            }));
            const maxDiff = Math.max(...diffs.map(d => Math.abs(d.diff)));

            settlementBox.style.display = 'block';
            if (maxDiff < 100) {
                settlementBox.innerHTML = `⚖️ <strong style="color: #10b981;">Aportes equilibrados al día</strong> — Cada participante activo aportó ${formatCOP(equalShare)} (Base equitativa ${Math.round(100 / authors.length)}%).`;
            } else {
                const lines = diffs.map(d => {
                    if (d.diff > 0) return `<strong>${escapeHTML(d.name)}</strong> lleva <span style="color:#10b981; font-weight:700;">+${formatCOP(d.diff)}</span> a favor`;
                    if (d.diff < 0) return `<strong>${escapeHTML(d.name)}</strong> tiene <span style="color:#f59e0b; font-weight:700;">${formatCOP(Math.abs(d.diff))}</span> por nivelar al fondo`;
                    return `<strong>${escapeHTML(d.name)}</strong> está al día`;
                });
                settlementBox.innerHTML = `⚖️ <strong>Balance Equitativo (${formatCOP(equalShare)} c/u):</strong> ${lines.join(' • ')}.`;
            }
        } else if (settlementBox) {
            settlementBox.style.display = 'none';
        }
    }

    // 3. Renderizar Libro Mayor Familiar
    txListContainer.innerHTML = '';
    if (filtered.length === 0) {
        txListContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.88rem; text-align: center; padding: 1.5rem 0;">No hay movimientos familiares en este mes.</p>`;
        return;
    }

    filtered.forEach(tx => {
        const nat = getTransactionNature(tx);
        const styleMap = {
            ingreso:   { color: '#10b981', sign: '+',   badge: 'Aporte',             bg: 'rgba(16,185,129,0.12)' },
            reserva:   { color: '#0ea5e9', sign: '⇄ -', badge: '🏦 Reserva / Fondo',  bg: 'rgba(14,165,233,0.15)' },
            deuda:     { color: '#a855f7', sign: '-',   badge: '💳 Cuota Deuda',      bg: 'rgba(168,85,247,0.15)' },
            inversion: { color: '#14b8a6', sign: '⇄ -', badge: '📈 Inversión',        bg: 'rgba(20,184,166,0.15)' },
            operativo: { color: 'var(--danger-color, #ef4444)', sign: '-', badge: tx.is_recurring ? '🔄 Gasto Fijo' : '📊 Gasto Variable', bg: 'var(--panel-bg)' }
        }[nat];

        const displayDate = tx.transaction_date || (tx.created_at ? tx.created_at.slice(0, 10) : '');
        const row = document.createElement('div');
        row.className = 'setting-row';
        row.style.cssText = `margin-bottom: 0; padding: 0.85rem 1.2rem; border-left: 4px solid ${styleMap.color};`;

        row.innerHTML = `
            <div class="setting-info">
                <h4 style="font-size: 0.94rem; color: var(--text-main); margin-bottom: 2px;">
                    ${escapeHTML(tx.title)}
                    <span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 6px; background: ${styleMap.bg}; color: ${styleMap.color}; margin-left: 6px;">${styleMap.badge}</span>
                </h4>
                <p style="font-size: 0.78rem; color: var(--text-muted); margin: 0;">
                    ${escapeHTML(tx.category)} • Por: <strong>${escapeHTML(tx.author_name || 'Miembro')}</strong> • ${escapeHTML(displayDate)}
                </p>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 1rem; font-weight: 800; color: ${styleMap.color};">${styleMap.sign}${formatCOP(tx.amount)}</span>
                <button type="button" class="btn-outline btn-del-fam-tx" style="padding: 4px 8px; font-size: 0.75rem; border-color: transparent; color: var(--text-muted);">✕</button>
            </div>
        `;

        row.querySelector('.btn-del-fam-tx').addEventListener('click', async () => {
            try {
                await deleteTransactionWithSync(tx);
                await loadAllFamilyData();
                showToast(tx.commitment_id ? 'Movimiento eliminado y cuota revertida.' : 'Movimiento eliminado del flujo familiar', 'info');
            } catch (err) {
                showToast('Error al eliminar: ' + err.message, 'error');
            }
        });

        txListContainer.appendChild(row);
    });
}

function renderImportantDataGrid() {
    const grid = document.getElementById('importantDataGrid');
    if (!grid) return;

    grid.innerHTML = '';
    if (importantDataList.length === 0) {
        grid.innerHTML = `
            <p style="color: var(--text-muted); font-size: 0.9rem; grid-column: 1 / -1; text-align: center; padding: 2rem 0; border: 1px dashed var(--border-card); border-radius: 16px;">
                Agrega el NIC de la luz, el contrato del agua o la clave del Wi-Fi en el formulario izquierdo.
            </p>
        `;
        return;
    }

    importantDataList.forEach(item => {
        const badgeLabel = DATA_CAT_ICONS[item.category] || DATA_CAT_ICONS.general;
        const card = document.createElement('div');
        card.style.cssText = `
            background: var(--bg-color);
            border: 1px solid var(--border-card);
            border-left: 4px solid var(--primary-neon);
            border-radius: 16px;
            padding: 1.1rem;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            gap: 0.8rem;
        `;

        card.innerHTML = `
            <div>
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                    <span style="font-size: 0.72rem; font-weight: 700; color: var(--primary-neon); text-transform: uppercase;">${badgeLabel}</span>
                    <button type="button" class="btn-del-imp" style="background: transparent; border: none; color: var(--text-muted); cursor: pointer;">✕</button>
                </div>
                <h4 style="font-size: 0.95rem; font-weight: 700; color: var(--text-main); margin-bottom: 6px;">${escapeHTML(item.label)}</h4>
                <div style="background: var(--panel-bg); padding: 0.55rem 0.8rem; border-radius: 10px; border: 1px solid var(--border-card); font-family: monospace; font-size: 0.9rem; font-weight: 700; color: var(--text-main); word-break: break-all;">
                    ${escapeHTML(item.value_data)}
                </div>
            </div>
            <button type="button" class="btn-outline btn-copy-imp" style="width: 100%; justify-content: center; padding: 0.45rem; font-size: 0.78rem;">
                📋 Copiar Dato
            </button>
        `;

        card.querySelector('.btn-copy-imp').addEventListener('click', () => {
            navigator.clipboard.writeText(item.value_data);
            showToast(`"${item.label}" copiado al portapapeles`, 'success');
        });

        card.querySelector('.btn-del-imp').addEventListener('click', async () => {
            await supabase.from('household_important_data').delete().eq('id', item.id);
            await loadAllFamilyData();
            showToast('Dato eliminado de la bóveda familiar', 'info');
        });

        grid.appendChild(card);
    });
}

function bindSetupEvents() {
    const createForm = document.getElementById('createHouseholdForm');
    if (createForm) {
        createForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('newHouseholdName')?.value.trim();
            const budget = document.getElementById('newHouseholdBudget')?.value;
            if (!name) return;

            try {
                const house = await createHousehold(currentUser.id, name, budget);
                showToast(`Hogar "${house.name}" creado. Código: ${house.invite_code}`, 'success');
                await refreshHouseholdState();
            } catch (err) {
                showToast('Error al crear hogar: ' + err.message, 'error');
            }
        });
    }

    const joinForm = document.getElementById('joinHouseholdForm');
    if (joinForm) {
        joinForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const code = document.getElementById('joinHouseholdCode')?.value.trim();
            if (!code) return;

            try {
                const house = await joinHouseholdByCode(currentUser.id, code);
                showToast(`Te has unido a "${house.name}"`, 'success');
                await refreshHouseholdState();
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    }

    const codeBadge = document.getElementById('householdCodeBadge');
    if (codeBadge) {
        codeBadge.addEventListener('click', () => {
            if (!activeHousehold?.invite_code) return;
            navigator.clipboard.writeText(activeHousehold.invite_code);
            showToast(`Código ${activeHousehold.invite_code} copiado. Compártelo con tu familia.`, 'success');
        });
    }
}

function bindWorkspaceEvents() {
    const tabBtns = document.querySelectorAll('.fam-tab-btn');
    const tabPanes = document.querySelectorAll('.fam-tab-pane');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => {
                b.classList.remove('active');
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            tabPanes.forEach(p => p.style.display = 'none');

            btn.classList.add('active');
            btn.style.borderColor = 'var(--primary-neon)';
            btn.style.color = 'var(--primary-neon)';
            const target = document.getElementById(btn.dataset.tab);
            if (target) target.style.display = 'block';
        });
    });

    const monthFilter = document.getElementById('familyMonthFilter');
    if (monthFilter) {
        monthFilter.addEventListener('change', (e) => {
            selectedMonth = e.target.value;
            updateEcosystemKPIs();
            renderFamilyFinanceFlow();
        });
    }

    const colorBtns = document.querySelectorAll('.color-tag-btn');
    colorBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            colorBtns.forEach(b => b.style.borderColor = 'transparent');
            btn.style.borderColor = 'var(--text-main)';
            selectedColor = btn.dataset.color;
        });
    });

    const postForm = document.getElementById('boardPostForm');
    if (postForm) {
        postForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!activeHousehold) return;

            const title = document.getElementById('postTitleInput')?.value.trim();
            const content = document.getElementById('postContentInput')?.value.trim();
            const category = document.getElementById('postCategorySelect')?.value;
            const assignedTo = document.getElementById('postAssignedSelect')?.value;
            const eventDateVal = document.getElementById('postEventDate')?.value;
            const pinned = document.getElementById('postPinnedCheck')?.checked;

            if (!title || !content) return;

            const { error } = await supabase.from('family_board_posts').insert({
                user_id: currentUser.id,
                household_id: activeHousehold.id,
                author_name: currentAuthorName,
                assigned_to: assignedTo,
                title,
                content,
                category,
                color_tag: selectedColor,
                pinned,
                event_date: eventDateVal ? new Date(eventDateVal + 'T12:00:00').toISOString() : null
            });

            if (error) {
                showToast('Error al publicar: ' + error.message, 'error');
            } else {
                postForm.reset();
                showToast('Publicado en el mural familiar', 'success');
                await loadAllFamilyData();
            }
        });
    }

    document.querySelectorAll('.board-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.board-filter-btn').forEach(b => {
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            btn.style.borderColor = 'var(--primary-neon)';
            btn.style.color = 'var(--primary-neon)';
            activeCategory = btn.dataset.category;
            renderBoardGrid();
        });
    });

    document.getElementById('boardSearchInput')?.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        renderBoardGrid();
    });

    const txTypeBtns = document.querySelectorAll('.fam-tx-type');
    const famCatSelect = document.getElementById('famTxCategory');
    txTypeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            txTypeBtns.forEach(b => {
                b.classList.remove('active');
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            btn.classList.add('active');
            selectedTxType = btn.dataset.type;
            const activeCol = selectedTxType === 'ingreso'
                ? '#10b981'
                : selectedTxType === 'reserva'
                    ? '#0ea5e9'
                    : 'var(--danger-color, #ef4444)';
            btn.style.borderColor = activeCol;
            btn.style.color = activeCol;

            if (famCatSelect) {
                if (selectedTxType === 'ingreso') famCatSelect.value = 'Aporte';
                else if (selectedTxType === 'reserva') famCatSelect.value = 'Ahorro';
                else if (['Ahorro', 'Aporte'].includes(famCatSelect.value)) famCatSelect.value = 'Hogar';
            }
        });
    });

    const famFinForm = document.getElementById('familyFinanceForm');
    if (famFinForm) {
        famFinForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!activeHousehold) return;

            const title = document.getElementById('famTxTitle')?.value.trim();
            const amount = Number(document.getElementById('famTxAmount')?.value);
            let category = document.getElementById('famTxCategory')?.value;
            const isRecurring = document.getElementById('famTxRecurring')?.checked;

            if (!title || !amount) return;

            const dbType = selectedTxType === 'ingreso' ? 'ingreso' : 'gasto';
            let nature = selectedTxType === 'ingreso' ? 'ingreso' : 'operativo';
            if (selectedTxType === 'reserva') {
                category = 'Ahorro';
                nature = 'reserva';
            } else if (category === 'Deudas') {
                nature = 'deuda';
            } else if (category === 'Inversión') {
                nature = 'inversion';
            }

            const { error } = await supabase.from('finance_transactions').insert({
                user_id: currentUser.id,
                household_id: activeHousehold.id,
                author_name: currentAuthorName,
                title,
                amount,
                type: dbType,
                nature,
                category,
                is_recurring: isRecurring,
                transaction_date: getTodayISO()
            });

            if (error) {
                showToast('Error al registrar movimiento: ' + error.message, 'error');
            } else {
                famFinForm.reset();
                showToast(
                    selectedTxType === 'reserva'
                        ? 'Reserva sumada al Fondo de Emergencia del Hogar'
                        : 'Movimiento sumado al flujo familiar',
                    'success'
                );
                await loadAllFamilyData();
            }
        });
    }

    document.getElementById('btnSaveFamBudget')?.addEventListener('click', async () => {
        if (!activeHousehold) return;
        const newLimit = Number(document.getElementById('famBudgetInput')?.value || 0);
        const { error } = await supabase
            .from('households')
            .update({ monthly_budget: newLimit })
            .eq('id', activeHousehold.id);

        if (!error) {
            activeHousehold.monthly_budget = newLimit;
            updateEcosystemKPIs();
            showToast('Presupuesto familiar actualizado', 'success');
        }
    });

    const impForm = document.getElementById('importantDataForm');
    if (impForm) {
        impForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!activeHousehold) return;

            const label = document.getElementById('impLabelInput')?.value.trim();
            const valueData = document.getElementById('impValueInput')?.value.trim();
            const category = document.getElementById('impCategorySelect')?.value;

            if (!label || !valueData) return;

            const { error } = await supabase.from('household_important_data').insert({
                household_id: activeHousehold.id,
                created_by: currentUser.id,
                label,
                value_data: valueData,
                category
            });

            if (error) {
                showToast('Error al guardar dato: ' + error.message, 'error');
            } else {
                impForm.reset();
                showToast('Dato fijo guardado para toda la familia', 'success');
                await loadAllFamilyData();
            }
        });
    }
}

function subscribeToFamilyRealtime() {
    if (familyRealtimeChannel) {
        supabase.removeChannel(familyRealtimeChannel);
    }
    if (!activeHousehold) return;

    familyRealtimeChannel = supabase
        .channel(`household-ecosystem-${activeHousehold.id}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'family_board_posts' }, () => {
            if (document.getElementById('activeHouseholdWorkspace')) loadAllFamilyData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'finance_transactions' }, () => {
            if (document.getElementById('activeHouseholdWorkspace')) loadAllFamilyData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'household_important_data' }, () => {
            if (document.getElementById('activeHouseholdWorkspace')) loadAllFamilyData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'agenda_items' }, () => {
            if (document.getElementById('activeHouseholdWorkspace')) loadAllFamilyData();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'financial_commitments' }, () => {
            if (document.getElementById('activeHouseholdWorkspace')) loadAllFamilyData();
        })
        .subscribe();
}