// public/js/controllers/finance.controller.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from '../core/router.js';
import { showToast } from '../ui/toast.js';

const CATEGORY_COLORS = {
    'Servicios':    '#0ea5e9',
    'Hogar':        '#8b5cf6',
    'Alimentación': '#10b981',
    'Transporte':   '#f59e0b',
    'Salud':        '#ec4899',
    'Deudas':       '#ef4444',
    'Ahorro':       '#14b8a6',
    'Salario':      '#22c55e',
    'Otros':        '#64748b'
};

let currentUser = null;
let allTransactions = [];
let selectedTxType = 'gasto';
let activeListFilter = 'all';
let selectedMonth = 'all';
let searchQuery = '';

function escapeHTML(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export async function initFinance() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        navigateTo('/');
        return;
    }
    currentUser = user;

    // Reiniciar estados de filtros al montar la vista
    selectedTxType = 'gasto';
    activeListFilter = 'all';
    selectedMonth = 'all';
    searchQuery = '';

    // Fecha de hoy por defecto en el formulario
    const dateInput = document.getElementById('txDateInput');
    if (dateInput) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }

    // Sincronizar tope presupuestal desde user_metadata (nube) o localStorage
    const cloudLimit = user.user_metadata?.budget_limit;
    if (cloudLimit !== undefined) {
        localStorage.setItem(`ngn_budget_limit_${user.id}`, String(cloudLimit));
    }
    const savedLimit = localStorage.getItem(`ngn_budget_limit_${user.id}`);
    const limitInput = document.getElementById('finBudgetLimitInput');
    if (limitInput && savedLimit && Number(savedLimit) > 0) {
        limitInput.value = savedLimit;
    }

    bindFinanceEvents();
    await loadFinanceTransactions();
}

async function loadFinanceTransactions() {
    try {
        const { data, error } = await supabase
            .from('finance_transactions')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('transaction_date', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) throw error;

        allTransactions = data || [];
        recalculateAndRender();
    } catch (error) {
        console.error('Error cargando Flujo Financiero:', error);
        showToast('No se pudieron cargar las transacciones.', 'error');
    }
}

function getPeriodFilteredTransactions() {
    if (selectedMonth === 'all') return allTransactions;
    return allTransactions.filter(tx => {
        if (!tx.transaction_date) return false;
        const month = tx.transaction_date.split('-')[1];
        return month === selectedMonth;
    });
}

function formatCOP(value) {
    return '$' + Number(value || 0).toLocaleString('es-CO', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function recalculateAndRender() {
    const periodTxs = getPeriodFilteredTransactions();

    let totalIncome = 0;
    let totalExpense = 0;
    let recurringExpense = 0;
    let incomeCount = 0;
    const expensesByCategory = {};

    periodTxs.forEach(tx => {
        const amt = Number(tx.amount) || 0;
        if (tx.type === 'ingreso') {
            totalIncome += amt;
            incomeCount++;
        } else {
            totalExpense += amt;
            if (tx.is_recurring) recurringExpense += amt;
            const cat = tx.category || 'Otros';
            expensesByCategory[cat] = (expensesByCategory[cat] || 0) + amt;
        }
    });

    const netBalance = totalIncome - totalExpense;
    const savingsRate = totalIncome > 0 ? Math.round(((totalIncome - totalExpense) / totalIncome) * 100) : 0;

    // 1. Actualizar KPIs superiores
    const netEl = document.getElementById('finNetBalance');
    const statusEl = document.getElementById('finBalanceStatus');
    const incEl = document.getElementById('finTotalIncome');
    const incCountEl = document.getElementById('finIncomeCount');
    const expEl = document.getElementById('finTotalExpense');
    const recSumEl = document.getElementById('finRecurringSum');
    const savRateEl = document.getElementById('finSavingsRate');
    const savHintEl = document.getElementById('finSavingsHint');

    if (netEl) {
        netEl.textContent = formatCOP(netBalance);
        netEl.style.color = netBalance >= 0 ? 'var(--primary-neon)' : 'var(--danger-color, #ef4444)';
    }
    if (statusEl) {
        statusEl.textContent = netBalance >= 0 ? 'Flujo positivo en el periodo' : 'Atención: Déficit en el periodo';
    }
    if (incEl) incEl.textContent = formatCOP(totalIncome);
    if (incCountEl) incCountEl.textContent = `${incomeCount} ingreso(s) registrado(s)`;
    if (expEl) expEl.textContent = formatCOP(totalExpense);
    if (recSumEl) recSumEl.textContent = `Pagos fijos: ${formatCOP(recurringExpense)}`;

    if (savRateEl) {
        savRateEl.textContent = `${savingsRate}%`;
        savRateEl.style.color = savingsRate >= 20 ? 'var(--primary-neon)' : savingsRate >= 0 ? 'var(--warning-color, #f59e0b)' : 'var(--danger-color, #ef4444)';
    }
    if (savHintEl) {
        savHintEl.textContent = savingsRate >= 20 ? 'Excelente salud financiera (≥ 20%)' : 'Meta recomendada: ahorrar al menos 20%';
    }

    // 2. Actualizar Barra de Presupuesto Mensual
    updateBudgetBar(totalExpense);

    // 3. Renderizar Barras de Categorías
    renderCategoryBreakdown(expensesByCategory, totalExpense);

    // 4. Renderizar Libro Mayor
    renderTransactionsList(periodTxs);
}

function updateBudgetBar(totalExpense) {
    const savedLimit = Number(localStorage.getItem(`ngn_budget_limit_${currentUser.id}`)) || 0;
    const barEl = document.getElementById('finBudgetProgressBar');
    const alertTextEl = document.getElementById('finBudgetAlertText');
    if (!barEl || !alertTextEl) return;

    if (savedLimit <= 0) {
        barEl.style.width = '0%';
        alertTextEl.textContent = 'Define tu tope mensual arriba a la derecha para activar el monitor de presupuesto.';
        return;
    }

    const pct = Math.min(100, Math.round((totalExpense / savedLimit) * 100));
    barEl.style.width = `${pct}%`;

    if (pct < 75) {
        barEl.style.backgroundColor = 'var(--primary-neon)';
        alertTextEl.textContent = `Has consumido el ${pct}% (${formatCOP(totalExpense)}) de tu presupuesto de ${formatCOP(savedLimit)}. Margen saludable.`;
    } else if (pct <= 95) {
        barEl.style.backgroundColor = 'var(--warning-color, #f59e0b)';
        alertTextEl.textContent = `Precaución: Has alcanzado el ${pct}% (${formatCOP(totalExpense)}) de tu tope mensual (${formatCOP(savedLimit)}).`;
    } else {
        barEl.style.backgroundColor = 'var(--danger-color, #ef4444)';
        alertTextEl.textContent = `¡Alerta Presupuestal! Gastos en ${formatCOP(totalExpense)} (${pct}% del límite de ${formatCOP(savedLimit)}).`;
    }
}

function renderCategoryBreakdown(expensesByCategory, totalExpense) {
    const container = document.getElementById('finCategoryBars');
    if (!container) return;

    const entries = Object.entries(expensesByCategory).sort((a, b) => b[1] - a[1]);

    if (entries.length === 0 || totalExpense <= 0) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; margin: 0;">No hay egresos registrados en este periodo.</p>`;
        return;
    }

    container.innerHTML = entries.map(([cat, amount]) => {
        const pct = Math.round((amount / totalExpense) * 100);
        const color = CATEGORY_COLORS[cat] || '#10b981';
        return `
            <div>
                <div style="display: flex; justify-content: space-between; font-size: 0.83rem; margin-bottom: 4px;">
                    <span style="font-weight: 600; color: var(--text-main);">${escapeHTML(cat)}</span>
                    <span style="color: var(--text-muted);"><strong>${formatCOP(amount)}</strong> (${pct}%)</span>
                </div>
                <div style="width: 100%; height: 8px; background: var(--panel-bg); border-radius: 6px; overflow: hidden;">
                    <div style="width: ${pct}%; height: 100%; background: ${color}; border-radius: 6px;"></div>
                </div>
            </div>
        `;
    }).join('');
}

function renderTransactionsList(periodTxs) {
    const listEl = document.getElementById('finTransactionsList');
    if (!listEl) return;

    let filtered = periodTxs;

    if (activeListFilter === 'ingreso') {
        filtered = filtered.filter(tx => tx.type === 'ingreso');
    } else if (activeListFilter === 'gasto') {
        filtered = filtered.filter(tx => tx.type === 'gasto');
    } else if (activeListFilter === 'recurring') {
        filtered = filtered.filter(tx => tx.is_recurring);
    }

    if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        filtered = filtered.filter(tx =>
            (tx.title && tx.title.toLowerCase().includes(q)) ||
            (tx.category && tx.category.toLowerCase().includes(q))
        );
    }

    listEl.innerHTML = '';

    if (filtered.length === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; padding: 2.5rem 1rem; border: 1px dashed var(--border-card); border-radius: 16px; color: var(--text-muted);">
                <p style="font-size: 0.95rem; margin-bottom: 0.3rem;">No se encontraron movimientos en esta vista.</p>
                <span style="font-size: 0.8rem;">Usa el formulario izquierdo o los botones de pago fijo para registrar tus cuentas.</span>
            </div>
        `;
        return;
    }

    filtered.forEach(tx => {
        const isIncome = tx.type === 'ingreso';
        const sign = isIncome ? '+' : '−';
        const amountColor = isIncome ? '#10b981' : 'var(--danger-color, #ef4444)';
        const catColor = CATEGORY_COLORS[tx.category] || '#10b981';
        const recurringBadge = tx.is_recurring
            ? `<span style="font-size: 0.7rem; padding: 2px 7px; border-radius: 6px; background: var(--icon-bg); color: var(--primary-neon); margin-left: 6px;">🔄 Fijo Mensual</span>`
            : '';

        const row = document.createElement('div');
        row.className = 'setting-row';
        row.style.marginBottom = '0';
        row.style.padding = '0.95rem 1.2rem';
        row.style.borderLeft = `4px solid ${catColor}`;

        row.innerHTML = `
            <div class="setting-info" style="flex: 1;">
                <h4 style="font-size: 0.96rem; color: var(--text-main); display: flex; align-items: center; flex-wrap: wrap;">
                    ${escapeHTML(tx.title)} ${recurringBadge}
                </h4>
                <p style="font-size: 0.8rem; color: var(--text-muted);">
                    <strong style="color: ${catColor};">${escapeHTML(tx.category || 'General')}</strong> • Fecha: ${escapeHTML(tx.transaction_date)}
                </p>
            </div>
            <div style="display: flex; align-items: center; gap: 14px;">
                <span style="font-size: 1.05rem; font-weight: 800; color: ${amountColor};">
                    ${sign}${formatCOP(tx.amount)}
                </span>
                <button type="button" class="btn-outline btn-del-tx" title="Eliminar registro" style="border-color: transparent; color: var(--danger-color, #ef4444); padding: 4px 8px;">
                    ✕
                </button>
            </div>
        `;

        row.querySelector('.btn-del-tx').addEventListener('click', async () => {
            const { error } = await supabase
                .from('finance_transactions')
                .delete()
                .eq('id', tx.id);

            if (!error) {
                allTransactions = allTransactions.filter(item => item.id !== tx.id);
                recalculateAndRender();
                showToast('Movimiento eliminado del libro mayor.', 'info');
            }
        });

        listEl.appendChild(row);
    });
}

function bindFinanceEvents() {
    // 1. Selector de Tipo de Movimiento (Gasto / Ingreso)
    const typeBtns = document.querySelectorAll('.tx-type-btn');
    const categorySelect = document.getElementById('txCategorySelect');

    typeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            selectedTxType = btn.dataset.type;
            typeBtns.forEach(b => {
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            if (selectedTxType === 'gasto') {
                btn.style.borderColor = 'var(--danger-color, #ef4444)';
                btn.style.color = 'var(--danger-color, #ef4444)';
                if (categorySelect) categorySelect.value = 'Servicios';
            } else {
                btn.style.borderColor = '#10b981';
                btn.style.color = '#10b981';
                if (categorySelect) categorySelect.value = 'Salario';
            }
        });
    });

    // 2. Botones de Autocompletado de Pagos Fijos (Energía, Agua, Internet, etc.)
    document.querySelectorAll('.quick-bill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const titleInput = document.getElementById('txTitleInput');
            const recCheck = document.getElementById('txRecurringCheck');
            const amountInput = document.getElementById('txAmountInput');

            const expBtn = document.querySelector('.tx-type-btn[data-type="gasto"]');
            if (expBtn) expBtn.click();

            if (titleInput) titleInput.value = btn.dataset.title;
            if (categorySelect) categorySelect.value = btn.dataset.cat;
            if (recCheck) recCheck.checked = true;
            if (amountInput) amountInput.focus();

            showToast(`Plantilla "${btn.dataset.title}" cargada. Ingresa el monto.`, 'info');
        });
    });

    // 3. Guardar Movimiento en Supabase
    const txForm = document.getElementById('financeTxForm');
    if (txForm) {
        txForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const titleInput = document.getElementById('txTitleInput');
            const amountInput = document.getElementById('txAmountInput');
            const dateInput = document.getElementById('txDateInput');
            const recCheck = document.getElementById('txRecurringCheck');
            const submitBtn = txForm.querySelector('button[type="submit"]');

            const title = titleInput.value.trim();
            const amount = parseFloat(amountInput.value);

            if (!title || isNaN(amount) || amount <= 0) {
                showToast('Ingresa un concepto válido y un monto mayor a cero.', 'error');
                return;
            }

            if (submitBtn) submitBtn.disabled = true;

            try {
                const { error } = await supabase.from('finance_transactions').insert({
                    user_id: currentUser.id,
                    title,
                    amount,
                    type: selectedTxType,
                    category: categorySelect.value,
                    is_recurring: recCheck.checked,
                    transaction_date: dateInput.value || new Date().toISOString().split('T')[0]
                });

                if (error) throw error;

                titleInput.value = '';
                amountInput.value = '';
                recCheck.checked = false;
                showToast('Movimiento registrado exitosamente.', 'success');
                await loadFinanceTransactions();
            } catch (error) {
                showToast('Error al registrar movimiento: ' + error.message, 'error');
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    // 4. Guardar Tope de Presupuesto Mensual (Local + Sincronización Nube en Supabase)
    const btnSaveBudget = document.getElementById('btnSaveBudgetLimit');
    if (btnSaveBudget) {
        btnSaveBudget.addEventListener('click', async () => {
            const limitInput = document.getElementById('finBudgetLimitInput');
            const val = Math.max(0, parseFloat(limitInput?.value || 0));
            localStorage.setItem(`ngn_budget_limit_${currentUser.id}`, String(val));
            recalculateAndRender();
            showToast('Límite de presupuesto actualizado y sincronizado.', 'success');

            try {
                await supabase.auth.updateUser({ data: { budget_limit: val } });
            } catch (e) {
                console.warn('No se pudo sincronizar el tope en la nube:', e);
            }
        });
    }

    // 5. Filtro por Mes
    const monthFilter = document.getElementById('finMonthFilter');
    if (monthFilter) {
        monthFilter.addEventListener('change', (e) => {
            selectedMonth = e.target.value;
            recalculateAndRender();
        });
    }

    // 6. Filtros de Lista (Todos / Ingresos / Gastos / Fijos)
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

    // 7. Buscador Instantáneo
    const searchInput = document.getElementById('finSearchInput');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            recalculateAndRender();
        });
    }

    // 8. Exportar a CSV (Excel)
    const btnExportCSV = document.getElementById('btnExportCSV');
    if (btnExportCSV) {
        btnExportCSV.addEventListener('click', () => {
            const periodTxs = getPeriodFilteredTransactions();
            if (periodTxs.length === 0) {
                showToast('No hay movimientos para exportar en este periodo.', 'error');
                return;
            }

            const headers = ['Fecha', 'Tipo', 'Categoria', 'Concepto', 'Monto', 'Fijo_Mensual'];
            const rows = periodTxs.map(t => [
                t.transaction_date,
                t.type.toUpperCase(),
                `"${(t.category || '').replace(/"/g, '""')}"`,
                `"${(t.title || '').replace(/"/g, '""')}"`,
                t.amount,
                t.is_recurring ? 'SI' : 'NO'
            ]);

            const csvContent = 'data:text/csv;charset=utf-8,\uFEFF'
                + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

            const link = document.createElement('a');
            link.setAttribute('href', encodeURI(csvContent));
            link.setAttribute('download', `NGN_Finanzas_${new Date().toISOString().slice(0, 10)}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            showToast('Reporte CSV descargado correctamente.', 'success');
        });
    }
}