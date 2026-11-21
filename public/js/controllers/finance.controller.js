// public/js/controllers/finance.controller.js
import { supabase } from '../config/supabase.js';
import { navigateTo } from '../core/router.js';
import { showToast } from '../ui/toast.js';
import { getActiveHousehold } from '../core/household.js';
import {
    RESERVE_CATEGORIES,
    escapeHTML,
    formatCOP,
    getTransactionNature,
    summarizeTransactions,
    getMonthlyCommitmentImpact,
    loadCommitments,
    createCommitmentWithAgenda,
    updateCommitmentAndResyncAgenda,
    payNextCommitmentInstallment,
    deleteCommitment
} from '../services/finance.service.js';
import {
    getTodayISO,
    normalizeBillingDays,
    computeCommitmentScheduleDates,
    describeCommitmentSchedule
} from '../services/agenda.service.js';

let currentUser = null;
let currentAuthorName = 'Miembro';
let activeHousehold = null;
let currentScope = 'personal'; // 'personal' | 'household'

let allTransactions = [];
let allCommitments = [];
let selectedTxMode = 'gasto'; // 'gasto' | 'ingreso' | 'reserva' | 'compromiso'
let selectedCommitmentKind = 'deuda'; // 'deuda' | 'inversion'
let selectedMonth = 'all';
let activeListFilter = 'all';
let searchQuery = '';
let monthlyBudgetLimit = 0;

export async function initFinance() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
        navigateTo('/');
        return;
    }
    currentUser = user;
    currentScope = 'personal';
    selectedTxMode = 'gasto';
    selectedCommitmentKind = 'deuda';
    selectedMonth = 'all';
    activeListFilter = 'all';
    searchQuery = '';

    const meta = user.user_metadata || {};
    currentAuthorName = meta.nickname || meta.full_name?.split(' ')[0] || user.email.split('@')[0];
    monthlyBudgetLimit = Number(meta.monthly_budget_limit || localStorage.getItem('ngn_budget_limit') || 0);

    activeHousehold = await getActiveHousehold(user.id);

    const scopeBox = document.getElementById('finScopeToggleBox');
    const shareLabel = document.getElementById('txShareHouseholdLabel');
    const commShareLabel = document.getElementById('commShareHouseholdLabel');
    if (activeHousehold) {
        if (scopeBox) scopeBox.style.display = 'flex';
        if (shareLabel) shareLabel.style.display = 'flex';
        if (commShareLabel) commShareLabel.style.display = 'flex';
    }

    const today = getTodayISO();
    const dateInput = document.getElementById('txDateInput');
    if (dateInput) dateInput.value = today;

    const commStartInput = document.getElementById('commStartDate');
    if (commStartInput) commStartInput.value = today;

    const budgetInput = document.getElementById('finBudgetLimitInput');
    if (budgetInput && monthlyBudgetLimit > 0) budgetInput.value = monthlyBudgetLimit;

    bindFinanceEvents();
    updateSchedulePreview();
    await loadFinanceData();
}

async function loadFinanceData() {
    try {
        let txQuery = supabase
            .from('finance_transactions')
            .select('*')
            .order('transaction_date', { ascending: false })
            .order('created_at', { ascending: false });

        if (currentScope === 'household' && activeHousehold) {
            txQuery = txQuery.eq('household_id', activeHousehold.id);
        } else {
            txQuery = txQuery.eq('user_id', currentUser.id).is('household_id', null);
        }

        const [txRes, commList] = await Promise.all([
            txQuery,
            loadCommitments({
                userId: currentUser.id,
                householdId: activeHousehold?.id || null,
                scope: currentScope
            }).catch(() => [])
        ]);

        if (txRes.error) throw txRes.error;

        allTransactions = txRes.data || [];
        allCommitments = commList || [];

        renderCommitmentsList();
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
    const s = summarizeTransactions(periodList);

    const netEl = document.getElementById('finNetBalance');
    const statusEl = document.getElementById('finBalanceStatus');
    const incEl = document.getElementById('finTotalIncome');
    const incCountEl = document.getElementById('finIncomeCount');
    const expEl = document.getElementById('finTotalExpense');
    const recEl = document.getElementById('finRecurringSum');
    const savEl = document.getElementById('finSavingsRate');
    const savHintEl = document.getElementById('finSavingsHint');

    if (netEl) {
        netEl.textContent = formatCOP(s.availableCash);
        netEl.style.color = s.availableCash >= 0 ? 'var(--primary-neon)' : 'var(--danger-color, #ef4444)';
    }
    if (statusEl) {
        if (s.availableCash === 0 && (s.reservedSavings + s.investmentContributions) > 0) {
            statusEl.textContent = `Base Cero ($0 libre) • Patrimonio: ${formatCOP(s.reservedSavings + s.investmentContributions)}`;
        } else {
            statusEl.textContent = `Libre en caja: ${formatCOP(s.availableCash)} | Reserva: ${formatCOP(s.reservedSavings)}`;
        }
    }
    if (incEl) incEl.textContent = formatCOP(s.totalIncome);
    if (incCountEl) incCountEl.textContent = `${s.incomeCount} entrada(s) registrada(s)`;
    if (expEl) expEl.textContent = formatCOP(s.totalOutflows);
    if (recEl) recEl.textContent = `Operativo: ${formatCOP(s.operationalExpense)} | Deudas: ${formatCOP(s.debtPayments)}`;
    if (savEl) {
        savEl.textContent = `${s.savingsRate}%`;
        savEl.style.color = s.savingsRate >= 10 ? '#10b981' : 'var(--info-color, #0ea5e9)';
    }
    if (savHintEl) {
        savHintEl.textContent = `Reserva: ${formatCOP(s.reservedSavings)} | Inversión: ${formatCOP(s.investmentContributions)}`;
    }

    updateBudgetThermometer(s);
    renderCategoryDistribution(
        s.categoryTotals,
        s.totalIncome > 0 ? s.totalIncome : (s.totalOutflows + s.reservedSavings + s.investmentContributions)
    );
    renderLedgerList(periodList);
}

function updateBudgetThermometer(s) {
    const bar = document.getElementById('finBudgetProgressBar');
    const alertText = document.getElementById('finBudgetAlertText');
    if (!bar || !alertText) return;

    const activeLimit = (currentScope === 'household' && activeHousehold?.monthly_budget > 0)
        ? Number(activeHousehold.monthly_budget)
        : (monthlyBudgetLimit > 0 ? monthlyBudgetLimit : s.totalIncome);

    if (!activeLimit || activeLimit <= 0) {
        bar.style.width = '0%';
        alertText.textContent = 'Define tu tope mensual para monitorear gastos operativos y servicio de deuda.';
        return;
    }

    const opPct = Math.min(100, Number(((s.totalOutflows / activeLimit) * 100).toFixed(2)));
    const wealthPct = Number((((s.reservedSavings + s.investmentContributions) / activeLimit) * 100).toFixed(2));
    bar.style.width = `${opPct}%`;

    if (opPct <= 88) {
        bar.style.backgroundColor = 'var(--primary-neon)';
        alertText.textContent = `Egresos + Deudas: ${formatCOP(s.totalOutflows)} (${opPct}%) | Reserva/Inversión: ${formatCOP(s.reservedSavings + s.investmentContributions)} (${wealthPct}%) de ${formatCOP(activeLimit)}.`;
    } else if (opPct <= 98) {
        bar.style.backgroundColor = 'var(--warning-color, #f59e0b)';
        alertText.textContent = `Precaución: Egresos al ${opPct}% (${formatCOP(s.totalOutflows)} de ${formatCOP(activeLimit)}).`;
    } else {
        bar.style.backgroundColor = 'var(--danger-color, #ef4444)';
        alertText.textContent = `Sobregiro: Egresos (${formatCOP(s.totalOutflows)}) alcanzaron el ${opPct}% del tope.`;
    }
}

// RENDERIZADO DE CARTERA DE DEUDAS E INVERSIONES CON AJUSTE DE CUOTAS INLINE
function renderCommitmentsList() {
    const container = document.getElementById('finCommitmentsList');
    const summaryEl = document.getElementById('finCommitmentsSummary');
    if (!container) return;

    const activeDebts = allCommitments.filter(c => c.kind === 'deuda' && c.status === 'activo');
    const activeInvs = allCommitments.filter(c => c.kind === 'inversion' && c.status === 'activo');
    const monthlyDebtLoad = activeDebts.reduce((acc, c) => acc + getMonthlyCommitmentImpact(c), 0);
    const monthlyInvLoad = activeInvs.reduce((acc, c) => acc + getMonthlyCommitmentImpact(c), 0);

    if (summaryEl) {
        if (allCommitments.length === 0) {
            summaryEl.textContent = 'Sin deudas ni inversiones programadas en este alcance.';
        } else {
            summaryEl.textContent = `Carga mensual estimada — Deudas: ${formatCOP(monthlyDebtLoad)}/mes (${activeDebts.length}) • Inversiones: ${formatCOP(monthlyInvLoad)}/mes (${activeInvs.length})`;
        }
    }

    container.innerHTML = '';
    if (allCommitments.length === 0) {
        container.innerHTML = `<p style="color: var(--text-muted); font-size: 0.84rem; margin: 0;">Usa el modo <strong>💳 Deuda / Inv.</strong> a la izquierda para registrar cuotas mensuales (NU día 28), quincenales (QUAC días 2 y 17) o en días específicos.</p>`;
        return;
    }

    allCommitments.forEach(c => {
        const isDebt = c.kind === 'deuda';
        const isPaidOff = c.status === 'pagado';
        const accent = isPaidOff ? '#10b981' : (c.color_tag || (isDebt ? '#a855f7' : '#14b8a6'));
        const paid = Number(c.paid_installments || 0);
        const total = c.total_installments ? Number(c.total_installments) : null;
        const pct = total ? Math.min(100, Math.round((paid / total) * 100)) : 0;
        const monthlyEq = getMonthlyCommitmentImpact(c);
        const schedText = describeCommitmentSchedule(c);
        const daysStr = normalizeBillingDays(c.billing_days, c.billing_day).join(', ');

        const progressLabel = total
            ? `${paid} de ${total} cuotas (${pct}%)`
            : `${paid} aporte(s) ejecutado(s) • Plazo abierto`;

        const card = document.createElement('div');
        card.style.cssText = `
            background: var(--panel-bg);
            border: 1px solid var(--border-card);
            border-left: 4px solid ${accent};
            border-radius: 14px;
            padding: 1rem 1.15rem;
            display: flex;
            flex-direction: column;
            gap: 0.65rem;
            opacity: ${isPaidOff ? '0.72' : '1'};
        `;

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 0.8rem; flex-wrap: wrap;">
                <div>
                    <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 3px;">
                        <span style="font-size: 0.7rem; font-weight: 800; text-transform: uppercase; padding: 2px 7px; border-radius: 6px; background: ${isDebt ? 'rgba(168,85,247,0.14)' : 'rgba(20,184,166,0.14)'}; color: ${accent};">
                            ${isDebt ? '💳 Deuda' : '📈 Inversión'}
                        </span>
                        <span style="font-size: 0.72rem; color: var(--text-muted); font-weight: 600;">🗓️ ${escapeHTML(schedText)}</span>
                        ${c.institution ? `<span style="font-size: 0.72rem; color: var(--text-muted);">• ${escapeHTML(c.institution)}</span>` : ''}
                        ${isPaidOff ? `<span style="font-size: 0.7rem; color: #10b981; font-weight: 800;">✔ FINALIZADA</span>` : ''}
                    </div>
                    <h4 style="font-size: 0.98rem; font-weight: 700; color: var(--text-main); margin: 0;">${escapeHTML(c.title)}</h4>
                    <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;">
                        Cuota: <strong style="color: var(--text-main);">${formatCOP(c.monthly_amount)}</strong>
                        ${monthlyEq !== Number(c.monthly_amount) ? ` • Equiv. mensual: <strong style="color: ${accent};">${formatCOP(monthlyEq)}/mes</strong>` : ''}
                        ${Number(c.principal_amount) > 0 ? ` • ${isDebt ? 'Capital' : 'Meta'}: ${formatCOP(c.principal_amount)}` : ''}
                    </div>
                </div>

                <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                    ${!isPaidOff ? `<button type="button" class="btn-outline btn-pay-next-comm" style="padding: 0.38rem 0.75rem; font-size: 0.76rem; font-weight: 700; border-color: var(--primary-neon); color: var(--primary-neon);">${isDebt ? '💳 Pagar Cuota' : '📈 Aportar'}</button>` : ''}
                    ${!isPaidOff ? `<button type="button" class="btn-outline btn-edit-comm" title="Ajustar frecuencia, días o monto" style="padding: 0.38rem 0.68rem; font-size: 0.76rem;">⚙️ Ajustar</button>` : ''}
                    <button type="button" class="btn-outline btn-del-comm" title="Eliminar compromiso y sus cuotas pendientes" style="padding: 0.38rem 0.6rem; font-size: 0.76rem; border-color: transparent; color: var(--text-muted);">✕</button>
                </div>
            </div>

            <div>
                <div style="display: flex; justify-content: space-between; font-size: 0.74rem; color: var(--text-muted); margin-bottom: 4px;">
                    <span>${escapeHTML(progressLabel)}</span>
                    <span>Inicio: ${escapeHTML(c.start_date || '')}</span>
                </div>
                ${total ? `
                    <div style="width: 100%; height: 7px; background: var(--bg-color); border-radius: 6px; overflow: hidden;">
                        <div style="width: ${pct}%; height: 100%; background: ${accent}; transition: width 0.3s ease;"></div>
                    </div>
                ` : ''}
            </div>

            <!-- Panel inline para ajustar cuotas sin borrar historial -->
            <div class="comm-edit-panel" style="display: none; padding-top: 0.75rem; border-top: 1px dashed var(--border-card); flex-direction: column; gap: 0.6rem;">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 8px;">
                    <div>
                        <label style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 2px;">Frecuencia</label>
                        <select class="form-input edit-comm-freq" style="padding: 0.42rem; font-size: 0.8rem;">
                            <option value="mensual" ${c.frequency === 'mensual' ? 'selected' : ''}>Mensual</option>
                            <option value="quincenal" ${c.frequency === 'quincenal' ? 'selected' : ''}>Quincenal</option>
                            <option value="dias_especificos" ${c.frequency === 'dias_especificos' ? 'selected' : ''}>Días específicos</option>
                            <option value="cada_n_dias" ${c.frequency === 'cada_n_dias' ? 'selected' : ''}>Cada N días</option>
                        </select>
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 2px;">Días mes (ej. 2, 17)</label>
                        <input type="text" class="form-input edit-comm-days" value="${escapeHTML(daysStr)}" style="padding: 0.42rem 0.6rem; font-size: 0.8rem;">
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 2px;">Intervalo (si Cada N días)</label>
                        <input type="number" class="form-input edit-comm-interval" value="${Number(c.interval_days || 15)}" min="1" max="365" style="padding: 0.42rem 0.6rem; font-size: 0.8rem;">
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 2px;">Valor cuota ($)</label>
                        <input type="number" class="form-input edit-comm-amount" value="${Number(c.monthly_amount)}" min="1" step="0.01" style="padding: 0.42rem 0.6rem; font-size: 0.8rem; font-weight: 700;">
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 2px;">Total cuotas (vacío=∞)</label>
                        <input type="number" class="form-input edit-comm-total" value="${total || ''}" min="1" style="padding: 0.42rem 0.6rem; font-size: 0.8rem;">
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 2px;">Desde fecha</label>
                        <input type="date" class="form-input edit-comm-start" value="${escapeHTML(c.start_date || getTodayISO())}" style="padding: 0.42rem 0.5rem; font-size: 0.78rem;">
                    </div>
                </div>
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                    <button type="button" class="btn-outline btn-cancel-edit-comm" style="padding: 0.4rem 0.8rem; font-size: 0.76rem;">Cancelar</button>
                    <button type="button" class="btn-save btn-save-edit-comm" style="margin: 0; padding: 0.42rem 0.9rem; font-size: 0.76rem;">Guardar y Actualizar Agenda</button>
                </div>
            </div>
        `;

        // Pagar siguiente cuota en 1 clic
        card.querySelector('.btn-pay-next-comm')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
                await payNextCommitmentInstallment(c, { userId: currentUser.id, authorName: currentAuthorName });
                showToast(isDebt ? 'Cuota pagada, descontada de caja y marcada en Agenda.' : 'Aporte de inversión registrado y marcado en Agenda.', 'success');
                await loadFinanceData();
            } catch (err) {
                showToast('Error al liquidar cuota: ' + err.message, 'error');
                btn.disabled = false;
            }
        });

        // Abrir/Guardar ajuste de cuotas
        const editPanel = card.querySelector('.comm-edit-panel');
        card.querySelector('.btn-edit-comm')?.addEventListener('click', () => {
            editPanel.style.display = editPanel.style.display === 'none' ? 'flex' : 'none';
        });
        card.querySelector('.btn-cancel-edit-comm')?.addEventListener('click', () => {
            editPanel.style.display = 'none';
        });
        card.querySelector('.btn-save-edit-comm')?.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
                const newFreq = card.querySelector('.edit-comm-freq').value;
                const newDays = normalizeBillingDays(card.querySelector('.edit-comm-days').value, c.billing_day);
                const newInterval = Number(card.querySelector('.edit-comm-interval').value || 15);
                const newAmt = Number(card.querySelector('.edit-comm-amount').value);
                const newTotalRaw = card.querySelector('.edit-comm-total').value;
                const newStart = card.querySelector('.edit-comm-start').value;

                if (!newAmt || newAmt <= 0) {
                    showToast('Ingresa un valor de cuota mayor a 0', 'info');
                    btn.disabled = false;
                    return;
                }

                const { agendaRows } = await updateCommitmentAndResyncAgenda(c.id, {
                    frequency: newFreq,
                    billingDays: newDays,
                    intervalDays: newInterval,
                    monthlyAmount: newAmt,
                    totalInstallments: newTotalRaw ? Number(newTotalRaw) : null,
                    startDate: newStart,
                    priority: c.priority
                }, {
                    userId: currentUser.id,
                    authorName: currentAuthorName,
                    resyncAgenda: true
                });

                showToast(`Cuotas ajustadas. ${agendaRows.length} fecha(s) actualizadas en tu Agenda.`, 'success');
                await loadFinanceData();
            } catch (err) {
                showToast('Error al ajustar cuotas: ' + err.message, 'error');
                btn.disabled = false;
            }
        });

        // Eliminar compromiso
        card.querySelector('.btn-del-comm').addEventListener('click', async () => {
            try {
                await deleteCommitment(c.id);
                showToast('Compromiso y sus cuotas pendientes eliminados.', 'info');
                await loadFinanceData();
            } catch (err) {
                showToast('Error al eliminar: ' + err.message, 'error');
            }
        });

        container.appendChild(card);
    });
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
        let barColor = 'var(--primary-neon)';
        if (cat.startsWith('🏦')) barColor = '#0ea5e9';
        else if (cat.startsWith('💳')) barColor = '#a855f7';
        else if (cat.startsWith('📈')) barColor = '#14b8a6';

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
    if (activeListFilter === 'ingreso') filtered = filtered.filter(t => getTransactionNature(t) === 'ingreso');
    if (activeListFilter === 'gasto') filtered = filtered.filter(t => getTransactionNature(t) === 'operativo');
    if (activeListFilter === 'reserva') filtered = filtered.filter(t => getTransactionNature(t) === 'reserva');
    if (activeListFilter === 'deuda') filtered = filtered.filter(t => getTransactionNature(t) === 'deuda');
    if (activeListFilter === 'inversion') filtered = filtered.filter(t => getTransactionNature(t) === 'inversion');
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
        const nature = getTransactionNature(tx);
        const palette = {
            ingreso:   { color: '#10b981', sign: '+',   badge: '↑ Ingreso',            bg: 'rgba(16,185,129,0.12)' },
            reserva:   { color: '#0ea5e9', sign: '⇄ -', badge: '🏦 Reserva / Activo',   bg: 'rgba(14,165,233,0.15)' },
            deuda:     { color: '#a855f7', sign: '-',   badge: '💳 Cuota Deuda',        bg: 'rgba(168,85,247,0.15)' },
            inversion: { color: '#14b8a6', sign: '⇄ -', badge: '📈 Inversión',          bg: 'rgba(20,184,166,0.15)' },
            operativo: { color: 'var(--danger-color, #ef4444)', sign: '-', badge: tx.is_recurring ? '🔄 Gasto Fijo' : '📊 Gasto Variable', bg: 'var(--bg-color)' }
        }[nature];

        const displayDate = tx.transaction_date || (tx.created_at ? tx.created_at.slice(0, 10) : '');
        const sharedBadge = tx.household_id
            ? `<span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 6px; background: rgba(16, 185, 129, 0.15); color: var(--primary-neon); margin-left: 6px;">🏠 ${escapeHTML(tx.author_name || 'Hogar')}</span>`
            : '';

        const row = document.createElement('div');
        row.className = 'setting-row';
        row.style.cssText = `margin-bottom: 0; padding: 0.9rem 1.2rem; border-left: 4px solid ${palette.color};`;

        row.innerHTML = `
            <div class="setting-info">
                <h4 style="font-size: 0.95rem; color: var(--text-main); margin-bottom: 2px;">
                    ${escapeHTML(tx.title)}
                    <span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 6px; background: ${palette.bg}; color: ${palette.color}; margin-left: 6px;">${palette.badge}</span>
                    ${sharedBadge}
                </h4>
                <p style="font-size: 0.78rem; color: var(--text-muted); margin: 0;">
                    ${escapeHTML(tx.category || 'General')} • Fecha: ${escapeHTML(displayDate)}
                </p>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 1.02rem; font-weight: 800; color: ${palette.color};">${palette.sign}${formatCOP(tx.amount)}</span>
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

// HELPER: Leer configuración de frecuencia y días desde el formulario de Deudas/Inversiones
function readCommitmentScheduleInputs() {
    const frequency = document.getElementById('commFrequencySelect')?.value || 'mensual';
    let billingDays = [1];
    let intervalDays = null;

    if (frequency === 'mensual') {
        const d = Number(document.getElementById('commSingleDayInput')?.value || 1);
        billingDays = normalizeBillingDays([d], 1);
    } else if (frequency === 'quincenal') {
        const d1 = Number(document.getElementById('commBiDay1')?.value || 2);
        const d2 = Number(document.getElementById('commBiDay2')?.value || 17);
        billingDays = normalizeBillingDays([d1, d2], 2);
    } else if (frequency === 'dias_especificos') {
        const raw = document.getElementById('commCustomDaysInput')?.value || '5, 15, 25';
        billingDays = normalizeBillingDays(raw, 1);
    } else if (frequency === 'cada_n_dias') {
        intervalDays = Math.max(1, Number(document.getElementById('commIntervalDaysInput')?.value || 15));
        billingDays = [1];
    }

    return { frequency, billingDays, intervalDays };
}

function updateSchedulePreview() {
    const previewEl = document.getElementById('commSchedulePreview');
    if (!previewEl) return;

    const { frequency, billingDays, intervalDays } = readCommitmentScheduleInputs();
    const amount = Number(document.getElementById('commQuotaAmount')?.value || 0);
    const total = Number(document.getElementById('commTotalInstallments')?.value || 0);
    const paid = Number(document.getElementById('commPaidInstallments')?.value || 0);
    const startDate = document.getElementById('commStartDate')?.value || getTodayISO();

    const perMonth = frequency === 'cada_n_dias'
        ? Math.max(1, Math.round(30 / (intervalDays || 15)))
        : billingDays.length;
    const pendingToShow = total > 0 ? Math.max(0, total - paid) : Math.min(36, 6 * perMonth);
    const sampleDates = computeCommitmentScheduleDates({
        startDate,
        frequency,
        billingDays,
        intervalDays,
        count: Math.min(4, Math.max(1, pendingToShow))
    });

    const monthlyEst = frequency === 'cada_n_dias'
        ? Math.round(amount * (30 / (intervalDays || 15)))
        : amount * perMonth;

    const amountLine = amount > 0
        ? `<strong>${formatCOP(amount)}</strong> por cuota (${perMonth}x/mes ≈ <strong>${formatCOP(monthlyEst)}/mes</strong>)`
        : `${perMonth} cuota(s) por mes`;

    previewEl.style.borderLeftColor = selectedCommitmentKind === 'inversion' ? '#14b8a6' : '#a855f7';
    previewEl.innerHTML = `
        <div>📊 ${amountLine}</div>
        <div style="margin-top: 2px;">📅 Próximas fechas: <strong>${sampleDates.length > 0 ? sampleDates.join(' • ') : 'Sin fechas pendientes'}</strong>${pendingToShow > 4 ? ` (+${pendingToShow - 4} más)` : ''}</div>
    `;
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

            const isHouse = currentScope === 'household';
            const shareCheck = document.getElementById('txShareHouseholdCheck');
            const commShareCheck = document.getElementById('commShareHouseholdCheck');
            if (shareCheck) shareCheck.checked = isHouse;
            if (commShareCheck) commShareCheck.checked = isHouse;

            await loadFinanceData();
        });
    });

    // 2. Selector de 4 Modos (Gasto / Ingreso / Reserva / Deuda-Inversión)
    const typeBtns = document.querySelectorAll('.tx-type-btn');
    const catSelect = document.getElementById('txCategorySelect');
    const txForm = document.getElementById('financeTxForm');
    const commForm = document.getElementById('commitmentForm');

    typeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            typeBtns.forEach(b => {
                b.classList.remove('active');
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            btn.classList.add('active');
            selectedTxMode = btn.dataset.type;

            if (selectedTxMode === 'compromiso') {
                btn.style.borderColor = '#a855f7';
                btn.style.color = '#a855f7';
                if (txForm) txForm.style.display = 'none';
                if (commForm) commForm.style.display = 'block';
                updateSchedulePreview();
                return;
            }

            if (txForm) txForm.style.display = 'block';
            if (commForm) commForm.style.display = 'none';

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

    // Atajo desde el panel de cartera hacia el modo Deuda/Inversión
    document.getElementById('btnQuickNewCommitment')?.addEventListener('click', () => {
        document.querySelector('.tx-type-btn[data-type="compromiso"]')?.click();
        document.getElementById('commTitleInput')?.focus();
    });

    // 3. Sub-selector Deuda vs Inversión
    const kindBtns = document.querySelectorAll('.comm-kind-btn');
    kindBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            kindBtns.forEach(b => {
                b.classList.remove('active');
                b.style.borderColor = 'var(--border-card)';
                b.style.color = 'var(--text-muted)';
            });
            btn.classList.add('active');
            selectedCommitmentKind = btn.dataset.kind;
            const col = selectedCommitmentKind === 'inversion' ? '#14b8a6' : '#a855f7';
            btn.style.borderColor = col;
            btn.style.color = col;

            const principalLabel = document.getElementById('commPrincipalLabel');
            if (principalLabel) {
                principalLabel.textContent = selectedCommitmentKind === 'inversion' ? 'Meta Capital ($ Opc.)' : 'Deuda Total ($ Opc.)';
            }
            updateSchedulePreview();
        });
    });

    // 4. Visibilidad dinámica de campos de Frecuencia
    const freqSelect = document.getElementById('commFrequencySelect');
    const syncFreqBoxes = () => {
        const val = freqSelect?.value || 'mensual';
        document.getElementById('commFreqMonthlyBox').style.display = val === 'mensual' ? 'flex' : 'none';
        document.getElementById('commFreqBiweeklyBox').style.display = val === 'quincenal' ? 'flex' : 'none';
        document.getElementById('commFreqCustomBox').style.display = val === 'dias_especificos' ? 'flex' : 'none';
        document.getElementById('commFreqIntervalBox').style.display = val === 'cada_n_dias' ? 'flex' : 'none';
        updateSchedulePreview();
    };
    freqSelect?.addEventListener('change', syncFreqBoxes);

    // Auto-sugerir días equiespaciados al cambiar "Cuotas / mes" en modo Días específicos
    document.getElementById('commPerMonthCount')?.addEventListener('input', (e) => {
        const n = Math.min(10, Math.max(1, Number(e.target.value || 1)));
        const step = Math.max(1, Math.floor(28 / n));
        const suggested = [];
        for (let i = 0; i < n; i++) {
            suggested.push(Math.min(28, 1 + i * step));
        }
        const customInput = document.getElementById('commCustomDaysInput');
        if (customInput) customInput.value = suggested.join(', ');
        updateSchedulePreview();
    });

    // Actualizar vista previa en vivo al editar cualquier campo de cuota
    [
        'commQuotaAmount', 'commSingleDayInput', 'commBiDay1', 'commBiDay2',
        'commCustomDaysInput', 'commIntervalDaysInput', 'commTotalInstallments',
        'commPaidInstallments', 'commStartDate'
    ].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateSchedulePreview);
    });

    // 5. Envío del Formulario de Deuda / Inversión
    if (commForm) {
        commForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const title = document.getElementById('commTitleInput')?.value.trim();
            const institution = document.getElementById('commInstitutionInput')?.value.trim() || '';
            const priority = document.getElementById('commPrioritySelect')?.value || 'alta';
            const monthlyAmount = Number(document.getElementById('commQuotaAmount')?.value);
            const principalAmount = Number(document.getElementById('commPrincipalAmount')?.value || 0);
            const totalRaw = document.getElementById('commTotalInstallments')?.value;
            const paidInstallments = Number(document.getElementById('commPaidInstallments')?.value || 0);
            const startDate = document.getElementById('commStartDate')?.value || getTodayISO();
            const traceInAgenda = Boolean(document.getElementById('commTraceAgendaCheck')?.checked);
            const shareWithHouse = Boolean(document.getElementById('commShareHouseholdCheck')?.checked || currentScope === 'household');
            const { frequency, billingDays, intervalDays } = readCommitmentScheduleInputs();

            if (!title || !monthlyAmount || monthlyAmount <= 0) {
                showToast('Ingresa un nombre y un valor de cuota válido.', 'info');
                return;
            }

            const submitBtn = commForm.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;

            try {
                const { agendaRows } = await createCommitmentWithAgenda({
                    userId: currentUser.id,
                    householdId: (shareWithHouse && activeHousehold) ? activeHousehold.id : null,
                    authorName: currentAuthorName,
                    assignedTo: (shareWithHouse && activeHousehold) ? 'Todos' : 'Personal',
                    kind: selectedCommitmentKind,
                    title,
                    institution,
                    principalAmount,
                    monthlyAmount,
                    totalInstallments: totalRaw ? Number(totalRaw) : null,
                    paidInstallments,
                    frequency,
                    billingDays,
                    intervalDays,
                    startDate,
                    priority,
                    traceInAgenda
                });

                commForm.reset();
                document.getElementById('commStartDate').value = getTodayISO();
                document.getElementById('commTraceAgendaCheck').checked = true;
                syncFreqBoxes();

                showToast(
                    traceInAgenda
                        ? `Registrado y ${agendaRows.length} cuota(s) trazadas en tu Agenda.`
                        : 'Compromiso financiero guardado.',
                    'success'
                );
                await loadFinanceData();
            } catch (err) {
                showToast('Error al guardar compromiso: ' + err.message, 'error');
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    // 6. Guardar Asiento Contable Normal
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

            const dbType = selectedTxMode === 'ingreso' ? 'ingreso' : 'gasto';
            let nature = selectedTxMode === 'ingreso' ? 'ingreso' : 'operativo';
            if (selectedTxMode === 'reserva') {
                nature = 'reserva';
                if (!RESERVE_CATEGORIES.includes(category)) category = 'Ahorro';
            } else if (category === 'Deudas') {
                nature = 'deuda';
            } else if (category === 'Inversión') {
                nature = 'inversion';
            }

            const targetHouseholdId = (shareWithHouse && activeHousehold) ? activeHousehold.id : null;

            const { error } = await supabase.from('finance_transactions').insert({
                user_id: currentUser.id,
                household_id: targetHouseholdId,
                author_name: currentAuthorName,
                title,
                amount,
                type: dbType,
                nature,
                category,
                is_recurring: isRecurring,
                transaction_date: transactionDate || getTodayISO()
            });

            if (error) {
                showToast('Error al registrar: ' + error.message, 'error');
            } else {
                document.getElementById('txTitleInput').value = '';
                document.getElementById('txAmountInput').value = '';
                showToast(
                    selectedTxMode === 'reserva'
                        ? 'Reserva patrimonial registrada'
                        : 'Asiento contable registrado',
                    'success'
                );
                await loadFinanceData();
            }
        });
    }

    // 7. Plantillas Rápidas
    document.querySelectorAll('.quick-bill-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetMode = btn.dataset.mode || 'gasto';
            document.querySelector(`.tx-type-btn[data-type="${targetMode}"]`)?.click();

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

    // 8. Tope Presupuestal
    document.getElementById('btnSaveBudgetLimit')?.addEventListener('click', async () => {
        const val = Number(document.getElementById('finBudgetLimitInput')?.value || 0);
        monthlyBudgetLimit = val;
        localStorage.setItem('ngn_budget_limit', String(val));
        await supabase.auth.updateUser({ data: { monthly_budget_limit: val } });
        recalculateAndRender();
        showToast('Límite presupuestal actualizado', 'success');
    });

    // 9. Filtros y Búsqueda
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

    // 10. Exportar CSV con Naturaleza Contable Completa
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
                const nat = getTransactionNature(r).toUpperCase();
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
        a.download = `ngn_contabilidad_${currentScope}_${getTodayISO()}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    });
}