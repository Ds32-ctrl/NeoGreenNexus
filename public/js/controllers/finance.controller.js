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
let selectedTxMode = 'gasto'; // 'gasto' | 'ingreso' | 'reserva'
let selectedMonth = 'all';
let activeListFilter = 'all';
let searchQuery = '';
let monthlyBudgetLimit = 0;

// Categorías que contablemente representan Reserva Patrimonial o Traslado de Liquidez (No Gasto Operativo)
const RESERVE_CATEGORIES = ['Ahorro', 'Fondo de Emergencia', 'Reserva', 'Aporte Hogar'];

function isReserveTransaction(tx) {
    if (tx.type === 'ingreso') return false;
    const cat = (tx.category || '').trim();
    const title = (tx.title || '').toLowerCase();
    return RESERVE_CATEGORIES.includes(cat) || title.includes('fondo de emergencia') || title.includes('reserva');
}

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
    currentScope = 'personal';
    selectedTxMode = 'gasto';
    selectedMonth = 'all';
    activeListFilter = 'all';
    searchQuery = '';

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
            .order('transaction_date', { ascending: false })
            .order('created_at', { ascending: false });

        if (currentScope === 'household' && activeHousehold) {
            query = query.eq('household_id', activeHousehold.id);
        } else {
            query = query.eq('user_id', currentUser.id).is('household_id', null);
        }

        const { data, error } = await query;
        if (error) throw error;

        allTransactions = data || [];
        recalculateAndRender();
    } catch (err) {
        console.error('Error cargando finanzas:', err);
        showToast('Error al sincronizar libro mayor: ' + (err.message || ''), 'error');
    }
}

function getPeriodFilteredTransactions() {
    if (selectedMonth === 'all') return allTransactions;
    return allTransactions.filter(tx => {
        const d = tx.transaction_date || tx.created_at || '';
        return d.slice(5, 7) === selectedMonth;
    });
}

function recalculateAndRender() {
    const periodList = getPeriodFilteredTransactions();

    let totalIncome = 0;
    let operationalExpense = 0; // Gastos reales (Fijos + Variables)
    let fixedExpense = 0;
    let variableExpense = 0;
    let reservedSavings = 0;    // Salidas a Fondo de Emergencia / Ahorro (No son gasto consuntivo)
    let incomeCount = 0;
    const categoryTotals = {};

    periodList.forEach(tx => {
        const amt = Number(tx.amount || 0);
        if (tx.type === 'ingreso') {
            totalIncome += amt;
            incomeCount++;
        } else if (isReserveTransaction(tx)) {
            reservedSavings += amt;
            const cat = '🏦 ' + (tx.category || 'Ahorro / Reserva');
            categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
        } else {
            operationalExpense += amt;
            if (tx.is_recurring) fixedExpense += amt;
            else variableExpense += amt;
            const cat = tx.category || 'Otros';
            categoryTotals[cat] = (categoryTotals[cat] || 0) + amt;
        }
    });

    // 1. Liquidez Disponible (Base Cero): Ingresos - Gastos Operativos - Reservas Apartadas
    const availableCash = totalIncome - operationalExpense - reservedSavings;

    // 2. Utilidad Neta Contable (Excedente Operativo = Reserva Apartada + Liquidez aún sin asignar)
    const totalRetainedWealth = reservedSavings + Math.max(0, availableCash);
    const savingsRate = totalIncome > 0
        ? Math.max(0, Number(((totalRetainedWealth / totalIncome) * 100).toFixed(2)))
        : 0;

    const netEl = document.getElementById('finNetBalance');
    const statusEl = document.getElementById('finBalanceStatus');
    const incEl = document.getElementById('finTotalIncome');
    const incCountEl = document.getElementById('finIncomeCount');
    const expEl = document.getElementById('finTotalExpense');
    const recEl = document.getElementById('finRecurringSum');
    const savEl = document.getElementById('finSavingsRate');
    const savHintEl = document.getElementById('finSavingsHint');

    if (netEl) {
        netEl.textContent = formatCOP(availableCash);
        netEl.style.color = availableCash >= 0 ? 'var(--primary-neon)' : 'var(--danger-color, #ef4444)';
    }
    if (statusEl) {
        if (availableCash === 0 && reservedSavings > 0) {
            statusEl.textContent = `Base Cero ($0 libre) • Reserva activa: ${formatCOP(reservedSavings)}`;
        } else {
            statusEl.textContent = `Libre en caja: ${formatCOP(availableCash)} | En Reserva: ${formatCOP(reservedSavings)}`;
        }
    }
    if (incEl) incEl.textContent = formatCOP(totalIncome);
    if (incCountEl) incCountEl.textContent = `${incomeCount} entrada(s) registrada(s)`;
    if (expEl) expEl.textContent = formatCOP(operationalExpense);
    if (recEl) recEl.textContent = `Fijos: ${formatCOP(fixedExpense)} | Variables: ${formatCOP(variableExpense)}`;
    if (savEl) {
        savEl.textContent = `${savingsRate}%`;
        savEl.style.color = savingsRate >= 10 ? '#10b981' : 'var(--info-color, #0ea5e9)';
    }
    if (savHintEl) {
        savHintEl.textContent = `Fondo apartado: ${formatCOP(reservedSavings)} (Excedente total: ${formatCOP(totalRetainedWealth)})`;
    }

    updateBudgetThermometer(operationalExpense, reservedSavings, totalIncome);
    renderCategoryDistribution(categoryTotals, totalIncome > 0 ? totalIncome : (operationalExpense + reservedSavings));
    renderLedgerList(periodList);
}

function updateBudgetThermometer(operationalExpense, reservedSavings, totalIncome) {
    const bar = document.getElementById('finBudgetProgressBar');
    const alertText = document.getElementById('finBudgetAlertText');
    if (!bar || !alertText) return;

    const activeLimit = (currentScope === 'household' && activeHousehold?.monthly_budget > 0)
        ? Number(activeHousehold.monthly_budget)
        : (monthlyBudgetLimit > 0 ? monthlyBudgetLimit : totalIncome);

    if (!activeLimit || activeLimit <= 0) {
        bar.style.width = '0%';
        alertText.textContent = 'Define tu tope mensual para monitorear tus gastos operativos.';
        return;
    }

    const opPct = Math.min(100, Number(((operationalExpense / activeLimit) * 100).toFixed(2)));
    const resPct = Math.min(100 - opPct, Number(((reservedSavings / activeLimit) * 100).toFixed(2)));
    bar.style.width = `${opPct}%`;

    if (opPct <= 88) {
        bar.style.backgroundColor = 'var(--primary-neon)';
        alertText.textContent = `Gastos Operativos: ${formatCOP(operationalExpense)} (${opPct}%) | Reserva / Fondo: ${formatCOP(reservedSavings)} (${resPct}%) de ${formatCOP(activeLimit)}.`;
    } else if (opPct <= 98) {
        bar.style.backgroundColor = 'var(--warning-color, #f59e0b)';
        alertText.textContent = `Precaución: Gastos operativos al ${opPct}% (${formatCOP(operationalExpense)} de ${formatCOP(activeLimit)}).`;
    } else {
        bar.style.backgroundColor = 'var(--danger-color, #ef4444)';
        alertText.textContent = `Sobregiro Operativo: Tus gastos de consumo (${formatCOP(operationalExpense)}) alcanzaron el ${opPct}% del tope.`;
    }
}

function renderCategoryDistribution(categoryTotals, baseTotal) {
    const container = document.getElementById('finCategoryBars');
    if (!container) return;

    const entries = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]);
    if (entries.length === 0 || baseTotal <= 0) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; margin: 0;">Registra movimientos para visualizar la estructura porcentual.</p>`;
        return;
    }

    container.innerHTML = entries.map(([cat, amount]) => {
        const pct = Number(((amount / baseTotal) * 100).toFixed(2));
        const isRes = cat.startsWith('🏦');
        const barColor = isRes ? '#0ea5e9' : 'var(--primary-neon)';
        return `
            <div>
                <div style="display: flex; justify-content: space-between; font-size: 0.83rem; margin-bottom: 4px;">
                    <span style="font-weight: 700; color: var(--text-main);">${escapeHTML(cat)}</span>
                    <span style="color: var(--text-muted);"><strong>${formatCOP(amount)}</strong> (${pct}%)</span>
                </div>
                <div style="width: 100%; height: 8px; background: var(--panel-bg); border-radius: 8px; overflow: hidden;">
                    <div style="width: ${Math.min(100, pct)}%; height: 100%; background: ${barColor};"></div>
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
    if (activeListFilter === 'gasto') filtered = filtered.filter(t => t.type === 'gasto' && !isReserveTransaction(t));
    if (activeListFilter === 'reserva') filtered = filtered.filter(t => isReserveTransaction(t));
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
        const isRes = isReserveTransaction(tx);
        const color = isInc ? '#10b981' : isRes ? '#0ea5e9' : 'var(--danger-color, #ef4444)';
        const sign = isInc ? '+' : isRes ? '⇄ -' : '-';
        const displayDate = tx.transaction_date || (tx.created_at ? tx.created_at.slice(0, 10) : '');

        const natureBadge = isInc
            ? `<span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 6px; background: rgba(16,185,129,0.12); color: #10b981; margin-left: 6px;">Ingreso</span>`
            : isRes
                ? `<span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 6px; background: rgba(14,165,233,0.15); color: #0ea5e9; margin-left: 6px;">🏦 Reserva / Activo</span>`
                : `<span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 6px; background: var(--bg-color); color: var(--text-muted); margin-left: 6px;">${tx.is_recurring ? '🔄 Gasto Fijo' : '📊 Gasto Variable'}</span>`;

        const sharedBadge = tx.household_id
            ? `<span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 6px; background: rgba(16, 185, 129, 0.15); color: var(--primary-neon); margin-left: 6px;">🏠 ${escapeHTML(tx.author_name || 'Hogar')}</span>`
            : '';

        const row = document.createElement('div');
        row.className = 'setting-row';
        row.style.cssText = `margin-bottom: 0; padding: 0.9rem 1.2rem; border-left: 4px solid ${color};`;

        row.innerHTML = `
            <div class="setting-info">
                <h4 style="font-size: 0.95rem; color: var(--text-main); margin-bottom: 2px;">
                    ${escapeHTML(tx.title)}
                    ${natureBadge}
                    ${sharedBadge}
                </h4>
                <p style="font-size: 0.78rem; color: var(--text-muted); margin: 0;">
                    ${escapeHTML(tx.category || 'General')} • Fecha: ${escapeHTML(displayDate)}
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
                showToast('Asiento contable eliminado', 'info');
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

    // 2. Selector de Naturaleza Contable (Gasto / Ingreso / Reserva)
    const typeBtns = document.querySelectorAll('.tx-type-btn');
    const catSelect = document.getElementById('txCategorySelect');
    typeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            typeBtns.forEach(b => {
                b.classList.remove('active');
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            btn.classList.add('active');
            selectedTxMode = btn.dataset.type;

            if (selectedTxMode === 'ingreso') {
                btn.style.borderColor = '#10b981';
                btn.style.color = '#10b981';
                if (catSelect) catSelect.value = 'Salario';
            } else if (selectedTxMode === 'reserva') {
                btn.style.borderColor = '#0ea5e9';
                btn.style.color = '#0ea5e9';
                if (catSelect) catSelect.value = 'Ahorro';
            } else {
                btn.style.borderColor = 'var(--danger-color, #ef4444)';
                btn.style.color = 'var(--danger-color, #ef4444)';
                if (catSelect && RESERVE_CATEGORIES.includes(catSelect.value)) {
                    catSelect.value = 'Hogar';
                }
            }
        });
    });

    // 3. Guardar Asiento Contable
    const txForm = document.getElementById('financeTxForm');
    if (txForm) {
        txForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = document.getElementById('txTitleInput')?.value.trim();
            const amount = Number(document.getElementById('txAmountInput')?.value);
            const transactionDate = document.getElementById('txDateInput')?.value;
            let category = document.getElementById('txCategorySelect')?.value;
            const isRecurring = document.getElementById('txRecurringCheck')?.checked;
            const shareWithHouse = document.getElementById('txShareHouseholdCheck')?.checked || currentScope === 'household';

            if (!title || !amount || amount <= 0) {
                showToast('Ingresa un concepto y un monto válido mayor a 0', 'info');
                return;
            }

            // Si eligió modo "Reserva", garantizamos que se clasifique en categoría de Reserva y como salida ('gasto' en DB)
            const dbType = selectedTxMode === 'ingreso' ? 'ingreso' : 'gasto';
            if (selectedTxMode === 'reserva' && !RESERVE_CATEGORIES.includes(category)) {
                category = 'Ahorro';
            }

            const targetHouseholdId = (shareWithHouse && activeHousehold) ? activeHousehold.id : null;

            const { error } = await supabase.from('finance_transactions').insert({
                user_id: currentUser.id,
                household_id: targetHouseholdId,
                author_name: currentAuthorName,
                title,
                amount,
                type: dbType,
                category,
                is_recurring: isRecurring,
                transaction_date: transactionDate || new Date().toISOString().slice(0, 10)
            });

            if (error) {
                showToast('Error al registrar: ' + error.message, 'error');
            } else {
                document.getElementById('txTitleInput').value = '';
                document.getElementById('txAmountInput').value = '';
                showToast(
                    selectedTxMode === 'reserva'
                        ? 'Reserva patrimonial registrada (descontada de caja, sumada a tu Fondo)'
                        : 'Asiento contable registrado',
                    'success'
                );
                await loadTransactions();
            }
        });
    }

    // 4. Plantillas Rápidas de Economía del Hogar
    document.querySelectorAll('.quick-bill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetMode = btn.dataset.mode || 'gasto';
            const modeBtn = document.querySelector(`.tx-type-btn[data-type="${targetMode}"]`);
            if (modeBtn) modeBtn.click();

            document.getElementById('txTitleInput').value = btn.dataset.title;
            document.getElementById('txCategorySelect').value = btn.dataset.cat;
            document.getElementById('txRecurringCheck').checked = (btn.dataset.rec === 'true');
            if (activeHousehold && document.getElementById('txShareHouseholdCheck')) {
                document.getElementById('txShareHouseholdCheck').checked = true;
            }
            const amountInput = document.getElementById('txAmountInput');
            if (amountInput) {
                amountInput.focus();
                showToast(`Plantilla "${btn.dataset.title}" lista. Ingresa el valor ($).`, 'info');
            }
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

    // 7. Exportar CSV con Naturaleza Contable
    document.getElementById('btnExportCSV')?.addEventListener('click', () => {
        const rows = getPeriodFilteredTransactions();
        if (rows.length === 0) {
            showToast('No hay datos para exportar', 'info');
            return;
        }
        const headers = ['Fecha', 'Concepto', 'Naturaleza_Contable', 'Categoria', 'Monto', 'Es_Fijo', 'Responsable'];
        const csvContent = [
            headers.join(','),
            ...rows.map(r => {
                const nat = r.type === 'ingreso'
                    ? 'INGRESO_OPERATIVO'
                    : isReserveTransaction(r)
                        ? 'RESERVA_PATRIMONIAL'
                        : (r.is_recurring ? 'GASTO_FIJO' : 'GASTO_VARIABLE');
                return [
                    r.transaction_date || (r.created_at ? r.created_at.slice(0, 10) : ''),
                    `"${(r.title || '').replace(/"/g, '""')}"`,
                    nat,
                    r.category,
                    r.amount,
                    r.is_recurring ? 'Si' : 'No',
                    `"${(r.author_name || 'Personal').replace(/"/g, '""')}"`
                ].join(',');
            })
        ].join('\n');

        const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ngn_contabilidad_${currentScope}_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    });
}