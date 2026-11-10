// public/js/controllers/family-board.controller.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from '../core/router.js';
import { showToast } from '../ui/toast.js';
import { getActiveHousehold, createHousehold, joinHouseholdByCode } from '../core/household.js';

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

let activeCategory = 'all';
let searchQuery = '';
let selectedColor = '#10b981';
let selectedTxType = 'gasto';
let selectedMonth = 'all';
let familyRealtimeChannel = null;

function escapeHTML(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function formatCOP(val) {
    return '$' + Number(val || 0).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

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

    // Mes actual por defecto en el filtro
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
        const [postsRes, txRes, dataRes, invRes] = await Promise.all([
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
                .eq('household_id', activeHousehold.id)
        ]);

        if (txRes.error) console.error('Error cargando transacciones del hogar:', txRes.error);

        allPosts = postsRes.data || [];
        familyTransactions = txRes.data || [];
        importantDataList = dataRes.data || [];
        const sharedShoppingCount = (invRes.data || []).filter(i => i.in_shopping_list).length;

        updateEcosystemKPIs(sharedShoppingCount);
        updateUpcomingAgenda();
        renderBoardGrid();
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
    let totalIncome = 0;
    let totalExpense = 0;

    filteredTx.forEach(t => {
        if (t.type === 'ingreso') totalIncome += Number(t.amount || 0);
        else totalExpense += Number(t.amount || 0);
    });

    const net = totalIncome - totalExpense;
    const balanceEl = document.getElementById('famKpiBalance');
    const flowSubEl = document.getElementById('famKpiFlowSub');
    const expEl = document.getElementById('famKpiExpenses');
    const budgetSubEl = document.getElementById('famKpiBudgetSub');
    const postsEl = document.getElementById('famKpiPosts');
    const pinnedSubEl = document.getElementById('famKpiPinnedSub');
    const vaultEl = document.getElementById('famKpiVaultCount');
    const syncSubEl = document.getElementById('famKpiSharedSync');

    if (balanceEl) {
        balanceEl.textContent = formatCOP(net);
        balanceEl.style.color = net >= 0 ? 'var(--primary-neon)' : 'var(--danger-color, #ef4444)';
    }
    if (flowSubEl) flowSubEl.textContent = `Aportes: ${formatCOP(totalIncome)} | Gastos: ${formatCOP(totalExpense)}`;
    if (expEl) expEl.textContent = formatCOP(totalExpense);

    if (budgetSubEl) {
        const limit = Number(activeHousehold?.monthly_budget || 0);
        if (limit > 0) {
            const pct = Math.min(100, Math.round((totalExpense / limit) * 100));
            budgetSubEl.textContent = `${pct}% del tope (${formatCOP(limit)})`;
        } else {
            budgetSubEl.textContent = 'Presupuesto hogar: Sin tope fijo';
        }
    }

    if (postsEl) postsEl.textContent = allPosts.length;
    if (pinnedSubEl) pinnedSubEl.textContent = `${allPosts.filter(p => p.pinned).length} avisos fijados`;
    if (vaultEl) vaultEl.textContent = importantDataList.length;
    if (syncSubEl) syncSubEl.textContent = `${importantDataList.length} datos fijos • ${sharedShoppingCount} en compras`;
}

function updateUpcomingAgenda() {
    const upcomingList = document.getElementById('upcomingEventsList');
    if (!upcomingList) return;

    const events = allPosts
        .filter(p => p.event_date)
        .sort((a, b) => new Date(a.event_date) - new Date(b.event_date))
        .slice(0, 5);

    if (events.length === 0) {
        upcomingList.innerHTML = `<p style="color: var(--text-muted); font-size: 0.82rem; margin: 0;">Sin eventos programados.</p>`;
        return;
    }

    upcomingList.innerHTML = events.map(ev => {
        const dateStr = new Date(ev.event_date).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
        return `
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; background: var(--bg-color); border-radius: 10px; border-left: 3px solid ${escapeHTML(ev.color_tag || '#10b981')};">
                <div style="overflow: hidden;">
                    <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-main); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${escapeHTML(ev.title)}</div>
                    <div style="font-size: 0.72rem; color: var(--text-muted);">Por: ${escapeHTML(ev.author_name || 'Miembro')}</div>
                </div>
                <span style="font-size: 0.74rem; color: var(--primary-neon); font-weight: 700;">${escapeHTML(dateStr)}</span>
            </div>
        `;
    }).join('');
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
    const txListContainer = document.getElementById('famTransactionsList');
    if (!contribContainer || !txListContainer) return;

    const filtered = getFilteredTransactions();

    // 1. Calcular participación por miembro
    const memberTotals = {};
    let totalMovement = 0;

    filtered.forEach(tx => {
        const author = tx.author_name || 'Miembro';
        const amt = Number(tx.amount || 0);
        if (!memberTotals[author]) {
            memberTotals[author] = { aportes: 0, pagos: 0, total: 0 };
        }
        if (tx.type === 'ingreso') memberTotals[author].aportes += amt;
        else memberTotals[author].pagos += amt;
        memberTotals[author].total += amt;
        totalMovement += amt;
    });

    const authors = Object.keys(memberTotals);
    if (authors.length === 0) {
        contribContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; margin: 0;">Registra un pago de servicio o aporte para ver el balance por integrante.</p>`;
    } else {
        contribContainer.innerHTML = authors.map(name => {
            const info = memberTotals[name];
            const pct = totalMovement > 0 ? Math.round((info.total / totalMovement) * 100) : 0;
            return `
                <div>
                    <div style="display: flex; justify-content: space-between; font-size: 0.82rem; margin-bottom: 4px;">
                        <span style="font-weight: 700; color: var(--text-main);">👤 ${escapeHTML(name)}</span>
                        <span style="color: var(--text-muted);">Pagos directos: <strong style="color: var(--danger-color, #ef4444);">${formatCOP(info.pagos)}</strong> | Aportes al fondo: <strong style="color: #10b981;">${formatCOP(info.aportes)}</strong> (${pct}%)</span>
                    </div>
                    <div style="width: 100%; height: 8px; background: var(--panel-bg); border-radius: 8px; overflow: hidden;">
                        <div style="width: ${pct}%; height: 100%; background: var(--primary-neon);"></div>
                    </div>
                </div>
            `;
        }).join('');
    }

    // 2. Renderizar Libro Mayor Familiar
    txListContainer.innerHTML = '';
    if (filtered.length === 0) {
        txListContainer.innerHTML = `<p style="color: var(--text-muted); font-size: 0.88rem; text-align: center; padding: 1.5rem 0;">No hay movimientos familiares en este mes.</p>`;
        return;
    }

    filtered.forEach(tx => {
        const isIncome = tx.type === 'ingreso';
        const color = isIncome ? '#10b981' : 'var(--danger-color, #ef4444)';
        const sign = isIncome ? '+' : '-';
        const displayDate = tx.transaction_date || (tx.created_at ? tx.created_at.slice(0, 10) : '');
        const row = document.createElement('div');
        row.className = 'setting-row';
        row.style.cssText = 'margin-bottom: 0; padding: 0.85rem 1.2rem;';

        row.innerHTML = `
            <div class="setting-info">
                <h4 style="font-size: 0.94rem; color: var(--text-main); margin-bottom: 2px;">
                    ${escapeHTML(tx.title)}
                    ${tx.is_recurring ? '<span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 6px; background: var(--panel-bg); color: var(--primary-neon); margin-left: 6px;">🔄 Fijo</span>' : ''}
                </h4>
                <p style="font-size: 0.78rem; color: var(--text-muted); margin: 0;">
                    ${escapeHTML(tx.category)} • Registrado por: <strong>${escapeHTML(tx.author_name || 'Miembro')}</strong> • ${escapeHTML(displayDate)}
                </p>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 1rem; font-weight: 800; color: ${color};">${sign}${formatCOP(tx.amount)}</span>
                <button type="button" class="btn-outline btn-del-fam-tx" style="padding: 4px 8px; font-size: 0.75rem; border-color: transparent; color: var(--text-muted);">✕</button>
            </div>
        `;

        row.querySelector('.btn-del-fam-tx').addEventListener('click', async () => {
            await supabase.from('finance_transactions').delete().eq('id', tx.id);
            await loadAllFamilyData();
            showToast('Movimiento eliminado del flujo familiar', 'info');
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
    // 1. Cambio entre las 3 Pestañas del Ecosistema Familiar
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

    // 2. Filtro de Mes Global
    const monthFilter = document.getElementById('familyMonthFilter');
    if (monthFilter) {
        monthFilter.addEventListener('change', (e) => {
            selectedMonth = e.target.value;
            updateEcosystemKPIs();
            renderFamilyFinanceFlow();
        });
    }

    // 3. Eventos del Mural
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

    const searchInput = document.getElementById('boardSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            renderBoardGrid();
        });
    }

    // 4. Eventos de Flujo Mensual Conjunto
    const txTypeBtns = document.querySelectorAll('.fam-tx-type');
    txTypeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            txTypeBtns.forEach(b => {
                b.classList.remove('active');
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            btn.classList.add('active');
            selectedTxType = btn.dataset.type;
            const activeCol = selectedTxType === 'ingreso' ? '#10b981' : 'var(--danger-color, #ef4444)';
            btn.style.borderColor = activeCol;
            btn.style.color = activeCol;
        });
    });

    const famFinForm = document.getElementById('familyFinanceForm');
    if (famFinForm) {
        famFinForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!activeHousehold) return;

            const title = document.getElementById('famTxTitle')?.value.trim();
            const amount = Number(document.getElementById('famTxAmount')?.value);
            const category = document.getElementById('famTxCategory')?.value;
            const isRecurring = document.getElementById('famTxRecurring')?.checked;

            if (!title || !amount) return;

            const { error } = await supabase.from('finance_transactions').insert({
                user_id: currentUser.id,
                household_id: activeHousehold.id,
                author_name: currentAuthorName,
                title,
                amount,
                type: selectedTxType,
                category,
                is_recurring: isRecurring,
                transaction_date: new Date().toISOString().slice(0, 10)
            });

            if (error) {
                showToast('Error al registrar movimiento: ' + error.message, 'error');
            } else {
                famFinForm.reset();
                showToast('Movimiento sumado al flujo familiar', 'success');
                await loadAllFamilyData();
            }
        });
    }

    const btnSaveFamBudget = document.getElementById('btnSaveFamBudget');
    if (btnSaveFamBudget) {
        btnSaveFamBudget.addEventListener('click', async () => {
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
    }

    // 5. Eventos de Bóveda de Datos Importantes
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
        .subscribe();
}