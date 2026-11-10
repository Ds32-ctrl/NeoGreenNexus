// public/js/controllers/finance.controller.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from '../core/router.js';
import { showToast } from '../ui/toast.js';
import { getActiveHousehold } from '../core/household.js';

let currentUser = null;
let currentAuthorName = 'Miembro';
let activeHousehold = null;
let currentScope = 'personal'; // 'personal' | 'household'

let allTransactions = [];
let selectedTxType = 'gasto';
let selectedMonth = 'all';
let activeListFilter = 'all';
let searchQuery = '';
let monthlyBudgetLimit = 0;

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

export async function initFinance() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        navigateTo('/');
        return;
    }
    currentUser = user;
    const meta = user.user_metadata || {};
    currentAuthorName = meta.nickname || meta.full_name?.split(' ')[0] || user.email.split('@')[0];
    monthlyBudgetLimit = Number(meta.monthly_budget_limit || localStorage.getItem('ngn_budget_limit') || 0);

    activeHousehold = await getActiveHousehold(user.id);

    const scopeBox = document.getElementById('finScopeToggleBox');
    const shareLabel = document.getElementById('txShareHouseholdLabel');
    if (activeHousehold) {
        if (scopeBox) scopeBox.style.display = 'flex';
        if (shareLabel) shareLabel.style.display = 'flex';
    }

    const dateInput = document.getElementById('txDateInput');
    if (dateInput) dateInput.value = new Date().toISOString().slice(0, 10);

    const budgetInput = document.getElementById('finBudgetLimitInput');
    if (budgetInput && monthlyBudgetLimit > 0) budgetInput.value = monthlyBudgetLimit;

    bindFinanceEvents();
    await loadTransactions();
}

async function loadTransactions() {
    try {
        let query = supabase
            .from('finance_transactions')
            .select('*')
            .order('tx_date', { ascending: false })
            .order('created_at', { ascending: false });

        if (currentScope === 'household' && activeHousehold) {
            query = query.eq('household_id', activeHousehold.id);
        } else {
            query = query.eq('user_id', currentUser.id);
        }

        const { data, error } = await query;
        if (error) throw error;

        allTransactions = data || [];
        recalculateAndRender();
    } catch (err) {
        console.error('Error cargando finanzas:', err);
        showToast('Error al sincronizar libro mayor', 'error');
    }
}

function getPeriodFilteredTransactions() {
    if (selectedMonth === 'all') return allTransactions;
    return allTransactions.filter(tx => {
        const d = tx.tx_date || tx.created_at || '';
        return d.slice(5, 7) === selectedMonth;
    });
}

function recalculateAndRender() {
    const periodList = getPeriodFilteredTransactions();

    let totalIncome = 0;
    let totalExpense = 0;
    let recurringExpense = 0;
    let incomeCount = 0;
    const categoryTotals = {};

    periodList.forEach(tx => {
        const amt = Number(tx.amount || 0);
        if (tx.type === 'ingreso') {
            totalIncome += amt;
            incomeCount++;
        } else {
            totalExpense += amt;
            if (tx.is_recurring) recurringExpense += amt;
            const cat = tx.category || 'Otros';
            categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
        }
    });

    const netBalance = totalIncome - totalExpense;
    const savingsRate = totalIncome > 0 ? Math.max(0, Math.round(((totalIncome - totalExpense) / totalIncome) * 100)) : 0;

    const netEl = document.getElementById('finNetBalance');
    const statusEl = document.getElementById('finBalanceStatus');
    const incEl = document.getElementById('finTotalIncome');
    const incCountEl = document.getElementById('finIncomeCount');
    const expEl = document.getElementById('finTotalExpense');
    const recEl = document.getElementById('finRecurringSum');
    const savEl = document.getElementById('finSavingsRate');

    if (netEl) {
        netEl.textContent = formatCOP(netBalance);
        netEl.style.color = netBalance >= 0 ? 'var(--primary-neon)' : 'var(--danger-color, #ef4444)';
    }
    if (statusEl) {
        statusEl.textContent = currentScope === 'household'
            ? `Fondo común: ${activeHousehold?.name || 'Hogar'}`
            : 'Liquidez neta personal';
    }
    if (incEl) incEl.textContent = formatCOP(totalIncome);
    if (incCountEl) incCountEl.textContent = `${incomeCount} entradas registradas`;
    if (expEl) expEl.textContent = formatCOP(totalExpense);
    if (recEl) recEl.textContent = `Costos fijos: ${formatCOP(recurringExpense)}`;
    if (savEl) savEl.textContent = `${savingsRate}%`;

    updateBudgetThermometer(totalExpense);
    renderCategoryDistribution(categoryTotals, totalExpense);
    renderLedgerList(periodList);
}

function updateBudgetThermometer(totalExpense) {
    const bar = document.getElementById('finBudgetProgressBar');
    const alertText = document.getElementById('finBudgetAlertText');
    if (!bar || !alertText) return;

    const activeLimit = (currentScope === 'household' && activeHousehold?.monthly_budget > 0)
        ? Number(activeHousehold.monthly_budget)
        : monthlyBudgetLimit;

    if (!activeLimit || activeLimit <= 0) {
        bar.style.width = '0%';
        alertText.textContent = 'Define tu tope mensual para recibir alertas tempranas de sobregiro.';
        return;
    }

    const pct = Math.min(100, Math.round((totalExpense / activeLimit) * 100));
    bar.style.width = `${pct}%`;

    if (pct < 75) {
        bar.style.backgroundColor = 'var(--primary-neon)';
        alertText.textContent = `Saludable: Has ejecutado el ${pct}% de tu presupuesto (${formatCOP(totalExpense)} de ${formatCOP(activeLimit)}).`;
    } else if (pct <= 95) {
        bar.style.backgroundColor = 'var(--warning-color, #f59e0b)';
        alertText.textContent = `Precaución: Estás al ${pct}% del límite mensual (${formatCOP(activeLimit - totalExpense)} disponibles).`;
    } else {
        bar.style.backgroundColor = 'var(--danger-color, #ef4444)';
        alertText.textContent = `Alerta de Sobregiro: Has alcanzado el ${pct}% del tope presupuestal.`;
    }
}

function renderCategoryDistribution(categoryTotals, totalExpense) {
    const container = document.getElementById('finCategoryBars');
    if (!container) return;

    const entries = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0 || totalExpense === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; margin: 0;">Registra gastos para visualizar la estructura porcentual de tus egresos.</p>`;
        return;
    }

    container.innerHTML = entries.map(([cat, amount]) => {
        const pct = Math.round((amount / totalExpense) * 100);
        return `
            <div>
                <div style="display: flex; justify-content: space-between; font-size: 0.83rem; margin-bottom: 4px;">
                    <span style="font-weight: 700; color: var(--text-main);">${escapeHTML(cat)}</span>
                    <span style="color: var(--text-muted);">${formatCOP(amount)} (${pct}%)</span>
                </div>
                <div style="width: 100%; height: 8px; background: var(--panel-bg); border-radius: 8px; overflow: hidden;">
                    <div style="width: ${pct}%; height: 100%; background: var(--primary-neon);"></div>
                </div>
            </div>
        `;
    }).join('');
}

function renderLedgerList(periodList) {
    const listEl = document.getElementById('finTransactionsList');
    if (!listEl) return;

    let filtered = periodList;
    if (activeListFilter === 'ingreso') filtered = filtered.filter(t => t.type === 'ingreso');
    if (activeListFilter === 'gasto') filtered = filtered.filter(t => t.type === 'gasto');
    if (activeListFilter === 'recurring') filtered = filtered.filter(t => t.is_recurring);

    if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(t =>
            (t.title && t.title.toLowerCase().includes(q)) ||
            (t.category && t.category.toLowerCase().includes(q)) ||
            (t.author_name && t.author_name.toLowerCase().includes(q))
        );
    }

    listEl.innerHTML = '';

    if (filtered.length === 0) {
        listEl.innerHTML = `<p style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 2rem 0;">No hay movimientos que coincidan con el filtro.</p>`;
        return;
    }

    filtered.forEach(tx => {
        const isInc = tx.type === 'ingreso';
        const color = isInc ? '#10b981' : 'var(--danger-color, #ef4444)';
        const sign = isInc ? '+' : '-';
        const sharedBadge = tx.household_id
            ? `<span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 6px; background: rgba(16, 185, 129, 0.15); color: var(--primary-neon); margin-left: 6px;">🏠 Hogar (${escapeHTML(tx.author_name || 'Miembro')})</span>`
            : '';

        const row = document.createElement('div');
        row.className = 'setting-row';
        row.style.cssText = 'margin-bottom: 0; padding: 0.9rem 1.2rem;';

        row.innerHTML = `
            <div class="setting-info">
                <h4 style="font-size: 0.95rem; color: var(--text-main); margin-bottom: 2px;">
                    ${escapeHTML(tx.title)}
                    ${tx.is_recurring ? '<span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 6px; background: var(--bg-color); color: var(--info-color); margin-left: 6px;">🔄 Fijo</span>' : ''}
                    ${sharedBadge}
                </h4>
                <p style="font-size: 0.78rem; color: var(--text-muted); margin: 0;">
                    ${escapeHTML(tx.category || 'General')} • Fecha: ${escapeHTML(tx.tx_date || '')}
                </p>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 1.02rem; font-weight: 800; color: ${color};">${sign}${formatCOP(tx.amount)}</span>
                <button type="button" class="btn-outline btn-del-tx" style="padding: 4px 8px; border-color: transparent; color: var(--text-muted);" title="Eliminar">✕</button>
            </div>
        `;

        row.querySelector('.btn-del-tx').addEventListener('click', async () => {
            const { error } = await supabase.from('finance_transactions').delete().eq('id', tx.id);
            if (!error) {
                allTransactions = allTransactions.filter(item => item.id !== tx.id);
                recalculateAndRender();
                showToast('Movimiento eliminado', 'info');
            }
        });

        listEl.appendChild(row);
    });
}

function bindFinanceEvents() {
    // 1. Selector de Alcance (Personal vs Hogar)
    const scopeBtns = document.querySelectorAll('.fin-scope-btn');
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

            const shareCheck = document.getElementById('txShareHouseholdCheck');
            if (shareCheck) shareCheck.checked = (currentScope === 'household');

            await loadTransactions();
        });
    });

    // 2. Selector Tipo (Gasto / Ingreso)
    const typeBtns = document.querySelectorAll('.tx-type-btn');
    typeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            typeBtns.forEach(b => {
                b.classList.remove('active');
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            btn.classList.add('active');
            selectedTxType = btn.dataset.type;
            const col = selectedTxType === 'ingreso' ? '#10b981' : 'var(--danger-color, #ef4444)';
            btn.style.borderColor = col;
            btn.style.color = col;
        });
    });

    // 3. Guardar Movimiento
    const txForm = document.getElementById('financeTxForm');
    if (txForm) {
        txForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = document.getElementById('txTitleInput')?.value.trim();
            const amount = Number(document.getElementById('txAmountInput')?.value);
            const txDate = document.getElementById('txDateInput')?.value;
            const category = document.getElementById('txCategorySelect')?.value;
            const isRecurring = document.getElementById('txRecurringCheck')?.checked;
            const shareWithHouse = document.getElementById('txShareHouseholdCheck')?.checked || currentScope === 'household';

            if (!title || !amount) return;

            const targetHouseholdId = (shareWithHouse && activeHousehold) ? activeHousehold.id : null;

            const { error } = await supabase.from('finance_transactions').insert({
                user_id: currentUser.id,
                household_id: targetHouseholdId,
                author_name: currentAuthorName,
                title,
                amount,
                type: selectedTxType,
                category,
                is_recurring: isRecurring,
                tx_date: txDate || new Date().toISOString().slice(0, 10)
            });

            if (error) {
                showToast('Error al registrar: ' + error.message, 'error');
            } else {
                document.getElementById('txTitleInput').value = '';
                document.getElementById('txAmountInput').value = '';
                showToast(targetHouseholdId ? 'Movimiento guardado en el Hogar' : 'Movimiento personal registrado', 'success');
                await loadTransactions();
            }
        });
    }

    // 4. Plantillas Rápidas de Servicios Fijos
    document.querySelectorAll('.quick-bill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('txTitleInput').value = btn.dataset.title;
            document.getElementById('txCategorySelect').value = btn.dataset.cat;
            document.getElementById('txRecurringCheck').checked = true;
            if (activeHousehold && document.getElementById('txShareHouseholdCheck')) {
                document.getElementById('txShareHouseholdCheck').checked = true;
            }
            document.getElementById('txAmountInput').focus();
        });
    });

    // 5. Fijar Tope Presupuestal
    const btnSaveBudget = document.getElementById('btnSaveBudgetLimit');
    if (btnSaveBudget) {
        btnSaveBudget.addEventListener('click', async () => {
            const val = Number(document.getElementById('finBudgetLimitInput')?.value || 0);
            monthlyBudgetLimit = val;
            localStorage.setItem('ngn_budget_limit', String(val));
            await supabase.auth.updateUser({ data: { monthly_budget_limit: val } });
            recalculateAndRender();
            showToast('Límite presupuestal actualizado', 'success');
        });
    }

    // 6. Filtros de Mes, Tipo y Búsqueda
    document.getElementById('finMonthFilter')?.addEventListener('change', (e) => {
        selectedMonth = e.target.value;
        recalculateAndRender();
    });

    document.querySelectorAll('.fin-list-filter').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.fin-list-filter').forEach(b => {
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            btn.style.borderColor = 'var(--primary-neon)';
            btn.style.color = 'var(--primary-neon)';
            activeListFilter = btn.dataset.filter;
            recalculateAndRender();
        });
    });

    document.getElementById('finSearchInput')?.addEventListener('input', (e) => {
        searchQuery = e.target.value;
        recalculateAndRender();
    });

    // 7. Exportar CSV
    document.getElementById('btnExportCSV')?.addEventListener('click', () => {
        const rows = getPeriodFilteredTransactions();
        if (rows.length === 0) {
            showToast('No hay datos para exportar', 'info');
            return;
        }
        const headers = ['Fecha', 'Concepto', 'Tipo', 'Categoria', 'Monto', 'Fijo', 'Autor'];
        const csvContent = [
            headers.join(','),
            ...rows.map(r => [
                r.tx_date,
                `"${(r.title || '').replace(/"/g, '""')}"`,
                r.type,
                r.category,
                r.amount,
                r.is_recurring ? 'Si' : 'No',
                `"${(r.author_name || 'Personal').replace(/"/g, '""')}"`
            ].join(','))
        ].join('\n');

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ngn_finanzas_${currentScope}_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    });
}