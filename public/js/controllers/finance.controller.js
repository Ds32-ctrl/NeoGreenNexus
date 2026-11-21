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
    loadCommitmentTransactions,
    createCommitmentWithAgenda,
    updateCommitmentAndResyncAgenda,
    payCommitmentInstallment,
    updateCommitmentPayment,
    deleteTransactionWithSync,
    reconcileCommitmentWithHistory,
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
let commitmentHistoryMap = {}; // { commitmentId: [tx, ...] }

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
        commitmentHistoryMap = await loadCommitmentTransactions(allCommitments.map(c => c.id)).catch(() => ({}));

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

// RENDERIZADO DE CARTERA DE DEUDAS E INVERSIONES CON ABONO FLEXIBLE + HISTORIAL REAL EDITABLE
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
        const principal = Number(c.principal_amount || 0);

        const historyRows = commitmentHistoryMap[c.id] || [];
        const realPaidTotal = historyRows.reduce((acc, r) => acc + Number(r.amount || 0), 0);
        const remainingCapital = principal > 0 ? Math.max(0, principal - realPaidTotal) : null;

        // Barra de progreso: prioriza capital real si existe y hay abonos; si no, conteo de cuotas
        let pct = 0;
        if (principal > 0 && realPaidTotal > 0) {
            pct = Math.min(100, Math.round((realPaidTotal / principal) * 100));
        } else if (total) {
            pct = Math.min(100, Math.round((paid / total) * 100));
        }

        const monthlyEq = getMonthlyCommitmentImpact(c);
        const schedText = describeCommitmentSchedule(c);
        const daysStr = normalizeBillingDays(c.billing_days, c.billing_day).join(', ');
        const defaultSource = c.household_id ? 'household' : 'personal';

        const progressLabel = total
            ? `${paid} de ${total} cuotas (${pct}%)`
            : `${paid} aporte(s) ejecutado(s) • Plazo abierto`;

        const balanceLine = principal > 0
            ? `Abonado real: <strong style="color: #10b981;">${formatCOP(realPaidTotal)}</strong> • ${isDebt ? 'Saldo restante' : 'Faltante meta'}: <strong style="color: ${accent};">${formatCOP(remainingCapital)}</strong>`
            : `Total abonado en historial: <strong style="color: #10b981;">${formatCOP(realPaidTotal)}</strong>`;

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
            opacity: ${isPaidOff ? '0.76' : '1'};
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
                        ${principal > 0 ? ` • ${isDebt ? 'Capital' : 'Meta'}: ${formatCOP(principal)}` : ''}
                    </div>
                    <div style="font-size: 0.76rem; color: var(--text-muted); margin-top: 3px;">
                        ${balanceLine}
                    </div>
                </div>

                <div style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
                    <button type="button" class="btn-outline btn-open-pay-comm" style="padding: 0.38rem 0.75rem; font-size: 0.76rem; font-weight: 700; border-color: var(--primary-neon); color: var(--primary-neon);">
                        ${isDebt ? '💳 Abonar' : '📈 Aportar'}
                    </button>
                    <button type="button" class="btn-outline btn-open-history-comm" style="padding: 0.38rem 0.72rem; font-size: 0.76rem; font-weight: 600;">
                        📜 Historial (${historyRows.length})
                    </button>
                    <button type="button" class="btn-outline btn-edit-comm" title="Ajustar frecuencia, días o capital" style="padding: 0.38rem 0.68rem; font-size: 0.76rem;">⚙️ Ajustar</button>
                    <button type="button" class="btn-outline btn-del-comm" title="Eliminar compromiso y cuotas pendientes" style="padding: 0.38rem 0.6rem; font-size: 0.76rem; border-color: transparent; color: var(--text-muted);">✕</button>
                </div>
            </div>

            <div>
                <div style="display: flex; justify-content: space-between; font-size: 0.74rem; color: var(--text-muted); margin-bottom: 4px;">
                    <span>${escapeHTML(progressLabel)}</span>
                    <span>Inicio: ${escapeHTML(c.start_date || '')}</span>
                </div>
                ${(total || principal > 0) ? `
                    <div style="width: 100%; height: 7px; background: var(--bg-color); border-radius: 6px; overflow: hidden;">
                        <div style="width: ${pct}%; height: 100%; background: ${accent}; transition: width 0.3s ease;"></div>
                    </div>
                ` : ''}
            </div>

            <!-- PANEL 1: REGISTRAR ABONO CON MONTO EDITABLE Y SELECTOR PERSONAL / HOGAR -->
            <div class="comm-pay-panel" style="display: none; padding: 0.85rem; border-radius: 12px; background: var(--bg-color); border: 1px solid var(--primary-neon); flex-direction: column; gap: 0.65rem;">
                <div style="font-size: 0.76rem; font-weight: 800; color: var(--primary-neon); text-transform: uppercase;">
                    ${isDebt ? '💳 Registrar Pago o Abono Real' : '📈 Registrar Aporte a Inversión'}
                </div>
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(135px, 1fr)); gap: 8px;">
                    <div>
                        <label style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 2px;">Monto del abono ($)</label>
                        <input type="number" class="form-input pay-comm-amount" value="${Number(c.monthly_amount)}" min="1" step="0.01" style="padding: 0.45rem 0.65rem; font-size: 0.84rem; font-weight: 700;">
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 2px;">Fecha real del pago</label>
                        <input type="date" class="form-input pay-comm-date" value="${getTodayISO()}" style="padding: 0.45rem 0.55rem; font-size: 0.8rem;">
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 2px;">¿De dónde sale el dinero?</label>
                        <select class="form-input pay-comm-source" style="padding: 0.45rem; font-size: 0.8rem; cursor: pointer;">
                            <option value="personal" ${defaultSource === 'personal' ? 'selected' : ''}>👤 Mi Flujo Personal</option>
                            ${activeHousehold ? `<option value="household" ${defaultSource === 'household' ? 'selected' : ''}>🏠 Hogar (${escapeHTML(activeHousehold.name)})</option>` : ''}
                        </select>
                    </div>
                </div>
                <label style="display: flex; align-items: center; gap: 7px; font-size: 0.78rem; color: var(--text-muted); cursor: pointer;">
                    <input type="checkbox" class="pay-comm-extra" style="width: 15px; height: 15px; accent-color: var(--primary-neon);">
                    Es un abono extra a capital (reduce saldo sin consumir la próxima cuota de la Agenda)
                </label>
                <div style="display: flex; justify-content: flex-end; gap: 8px;">
                    <button type="button" class="btn-outline btn-cancel-pay-comm" style="padding: 0.38rem 0.75rem; font-size: 0.76rem;">Cancelar</button>
                    <button type="button" class="btn-save btn-confirm-pay-comm" style="margin: 0; padding: 0.42rem 0.9rem; font-size: 0.76rem;">Confirmar Abono ✓</button>
                </div>
            </div>

            <!-- PANEL 2: HISTORIAL REAL DE PAGOS (EDITAR / ELIMINAR / CUADRAR) -->
            <div class="comm-history-panel" style="display: none; padding: 0.85rem; border-radius: 12px; background: var(--bg-color); border: 1px solid var(--border-card); flex-direction: column; gap: 0.65rem;">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
                    <span style="font-size: 0.76rem; font-weight: 800; color: var(--text-main); text-transform: uppercase;">
                        📜 Historial Real de Abonos (${historyRows.length})
                    </span>
                    <button type="button" class="btn-outline btn-reconcile-comm" title="Iguala el contador de cuotas pagadas al número real de abonos registrados" style="padding: 0.28rem 0.65rem; font-size: 0.72rem; border-color: #0ea5e9; color: #0ea5e9;">
                        🔄 Cuadrar progreso con historial
                    </button>
                </div>
                <div class="comm-history-rows" style="display: flex; flex-direction: column; gap: 0.5rem;"></div>
            </div>

            <!-- PANEL 3: AJUSTAR CONFIGURACIÓN DE CUOTAS -->
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
                        <label style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 2px;">Intervalo (Cada N días)</label>
                        <input type="number" class="form-input edit-comm-interval" value="${Number(c.interval_days || 15)}" min="1" max="365" style="padding: 0.42rem 0.6rem; font-size: 0.8rem;">
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 2px;">Valor cuota ($)</label>
                        <input type="number" class="form-input edit-comm-amount" value="${Number(c.monthly_amount)}" min="1" step="0.01" style="padding: 0.42rem 0.6rem; font-size: 0.8rem; font-weight: 700;">
                    </div>
                    <div>
                        <label style="display: block; font-size: 0.72rem; color: var(--text-muted); margin-bottom: 2px;">Capital / Meta ($)</label>
                        <input type="number" class="form-input edit-comm-principal" value="${principal}" min="0" step="100" style="padding: 0.42rem 0.6rem; font-size: 0.8rem;">
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

        // Helper para cerrar paneles hermanos y abrir uno
        const payPanel = card.querySelector('.comm-pay-panel');
        const histPanel = card.querySelector('.comm-history-panel');
        const editPanel = card.querySelector('.comm-edit-panel');
        const toggleSubPanel = (target) => {
            const wasOpen = target.style.display === 'flex';
            payPanel.style.display = 'none';
            histPanel.style.display = 'none';
            editPanel.style.display = 'none';
            if (!wasOpen) target.style.display = 'flex';
        };

        // Renderizar filas del historial real con edición y eliminación por abono
        const histContainer = card.querySelector('.comm-history-rows');
        if (historyRows.length === 0) {
            histContainer.innerHTML = `<p style="font-size: 0.78rem; color: var(--text-muted); margin: 0;">Aún no hay abonos registrados en el libro mayor para este compromiso. Usa <strong>Abonar</strong> para registrar pagos actuales o pasados.</p>`;
        } else {
            historyRows.forEach(tx => {
                const isHouseTx = Boolean(tx.household_id);
                const txDate = tx.transaction_date || (tx.created_at ? tx.created_at.slice(0, 10) : '');
                const itemEl = document.createElement('div');
                itemEl.style.cssText = 'background: var(--panel-bg); border: 1px solid var(--border-card); border-radius: 10px; padding: 0.65rem 0.8rem; display: flex; flex-direction: column; gap: 0.5rem;';
                itemEl.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                        <div>
                            <div style="font-size: 0.82rem; font-weight: 700; color: var(--text-main);">
                                ${escapeHTML(tx.title)}
                                <span style="font-size: 0.68rem; padding: 2px 6px; border-radius: 6px; background: var(--bg-color); color: ${isHouseTx ? 'var(--primary-neon)' : 'var(--text-muted)'}; margin-left: 4px;">
                                    ${isHouseTx ? '🏠 Hogar' : '👤 Personal'}
                                </span>
                            </div>
                            <div style="font-size: 0.72rem; color: var(--text-muted);">
                                Fecha: ${escapeHTML(txDate)} • Por: ${escapeHTML(tx.author_name || 'Miembro')}
                            </div>
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <strong style="font-size: 0.88rem; color: ${accent};">${formatCOP(tx.amount)}</strong>
                            <button type="button" class="btn-outline btn-edit-hist-tx" title="Editar monto, fecha u origen" style="padding: 3px 7px; font-size: 0.72rem;">✏️</button>
                            <button type="button" class="btn-outline btn-del-hist-tx" title="Eliminar pago y revertir cuota" style="padding: 3px 7px; font-size: 0.72rem; color: var(--danger-color, #ef4444);">🗑️</button>
                        </div>
                    </div>
                    <div class="hist-edit-row" style="display: none; padding-top: 0.5rem; border-top: 1px dashed var(--border-card); gap: 6px; flex-wrap: wrap; align-items: center;">
                        <input type="number" class="form-input hist-edit-amt" value="${Number(tx.amount)}" min="1" step="0.01" style="width: 110px; padding: 0.35rem 0.5rem; font-size: 0.78rem; font-weight: 700;">
                        <input type="date" class="form-input hist-edit-date" value="${escapeHTML(txDate)}" style="width: auto; padding: 0.35rem 0.45rem; font-size: 0.76rem;">
                        <select class="form-input hist-edit-src" style="width: auto; padding: 0.35rem; font-size: 0.76rem;">
                            <option value="personal" ${!isHouseTx ? 'selected' : ''}>👤 Personal</option>
                            ${activeHousehold ? `<option value="household" ${isHouseTx ? 'selected' : ''}>🏠 Hogar</option>` : ''}
                        </select>
                        <button type="button" class="btn-save btn-save-hist-tx" style="margin: 0; padding: 0.36rem 0.7rem; font-size: 0.74rem;">Guardar</button>
                    </div>
                `;

                const editRow = itemEl.querySelector('.hist-edit-row');
                itemEl.querySelector('.btn-edit-hist-tx').addEventListener('click', () => {
                    editRow.style.display = editRow.style.display === 'none' ? 'flex' : 'none';
                });

                itemEl.querySelector('.btn-save-hist-tx').addEventListener('click', async (e) => {
                    e.currentTarget.disabled = true;
                    try {
                        const newAmt = Number(itemEl.querySelector('.hist-edit-amt').value);
                        const newDate = itemEl.querySelector('.hist-edit-date').value;
                        const srcVal = itemEl.querySelector('.hist-edit-src').value;
                        const newHouseId = (srcVal === 'household' && activeHousehold) ? activeHousehold.id : null;

                        await updateCommitmentPayment(tx, {
                            amount: newAmt,
                            transactionDate: newDate,
                            sourceHouseholdId: newHouseId
                        });
                        showToast('Abono actualizado y balance recalculado.', 'success');
                        await loadFinanceData();
                    } catch (err) {
                        showToast('Error al editar abono: ' + err.message, 'error');
                        e.currentTarget.disabled = false;
                    }
                });

                itemEl.querySelector('.btn-del-hist-tx').addEventListener('click', async (e) => {
                    e.currentTarget.disabled = true;
                    try {
                        await deleteTransactionWithSync(tx);
                        showToast('Pago eliminado, saldo restaurado y cuota reabierta en Agenda.', 'info');
                        await loadFinanceData();
                    } catch (err) {
                        showToast('Error al eliminar pago: ' + err.message, 'error');
                        e.currentTarget.disabled = false;
                    }
                });

                histContainer.appendChild(itemEl);
            });
        }

        // Eventos de botones principales de la tarjeta
        card.querySelector('.btn-open-pay-comm').addEventListener('click', () => toggleSubPanel(payPanel));
        card.querySelector('.btn-cancel-pay-comm').addEventListener('click', () => { payPanel.style.display = 'none'; });
        card.querySelector('.btn-open-history-comm').addEventListener('click', () => toggleSubPanel(histPanel));
        card.querySelector('.btn-edit-comm').addEventListener('click', () => toggleSubPanel(editPanel));
        card.querySelector('.btn-cancel-edit-comm').addEventListener('click', () => { editPanel.style.display = 'none'; });

        // Confirmar Abono Flexible
        card.querySelector('.btn-confirm-pay-comm').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
                const amt = Number(card.querySelector('.pay-comm-amount').value);
                const payDate = card.querySelector('.pay-comm-date').value;
                const srcVal = card.querySelector('.pay-comm-source').value;
                const isExtra = Boolean(card.querySelector('.pay-comm-extra').checked);
                const sourceHouseholdId = (srcVal === 'household' && activeHousehold) ? activeHousehold.id : null;

                await payCommitmentInstallment(c, {
                    userId: currentUser.id,
                    authorName: currentAuthorName,
                    amount: amt,
                    transactionDate: payDate,
                    sourceHouseholdId,
                    isExtraCapital: isExtra
                });

                const srcLabel = sourceHouseholdId ? 'Hogar Familiar' : 'Flujo Personal';
                showToast(`Abono de ${formatCOP(amt)} descontado de ${srcLabel} y sincronizado.`, 'success');
                await loadFinanceData();
            } catch (err) {
                showToast('Error al registrar abono: ' + err.message, 'error');
                btn.disabled = false;
            }
        });

        // Reconciliar progreso con historial real
        card.querySelector('.btn-reconcile-comm').addEventListener('click', async (e) => {
            e.currentTarget.disabled = true;
            try {
                const res = await reconcileCommitmentWithHistory(c.id);
                showToast(`Progreso cuadrado: ${res.count} abono(s) reales (${formatCOP(res.realPaidSum)}).`, 'success');
                await loadFinanceData();
            } catch (err) {
                showToast('Error al cuadrar historial: ' + err.message, 'error');
                e.currentTarget.disabled = false;
            }
        });

        // Guardar ajuste de configuración
        card.querySelector('.btn-save-edit-comm').addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
                const newFreq = card.querySelector('.edit-comm-freq').value;
                const newDays = normalizeBillingDays(card.querySelector('.edit-comm-days').value, c.billing_day);
                const newInterval = Number(card.querySelector('.edit-comm-interval').value || 15);
                const newAmt = Number(card.querySelector('.edit-comm-amount').value);
                const newPrincipal = Number(card.querySelector('.edit-comm-principal').value || 0);
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
                    principalAmount: newPrincipal,
                    totalInstallments: newTotalRaw ? Number(newTotalRaw) : null,
                    startDate: newStart,
                    priority: c.priority
                }, {
                    userId: currentUser.id,
                    authorName: currentAuthorName,
                    resyncAgenda: true
                });

                showToast(`Compromiso ajustado. ${agendaRows.length} fecha(s) actualizadas en Agenda.`, 'success');
                await loadFinanceData();
            } catch (err) {
                showToast('Error al ajustar cuotas: ' + err.message, 'error');
                btn.disabled = false;
            }
        });

        // Eliminar compromiso completo
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
                <button type="button" class="btn-outline btn-del-tx" style="padding: 4px 8px; border-color: transparent; color: var(--text-muted);" title="Eliminar y sincronizar">✕</button>
            </div>
        `;

        row.querySelector('.btn-del-tx').addEventListener('click', async () => {
            try {
                await deleteTransactionWithSync(tx);
                showToast(tx.commitment_id ? 'Pago eliminado y cuota revertida en deuda/agenda.' : 'Asiento contable eliminado.', 'info');
                await loadFinanceData();
            } catch (err) {
                showToast('Error al eliminar movimiento: ' + err.message, 'error');
            }
        });

        listEl.appendChild(row);
    });
}

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

    document.getElementById('btnQuickNewCommitment')?.addEventListener('click', () => {
        document.querySelector('.tx-type-btn[data-type="compromiso"]')?.click();
        document.getElementById('commTitleInput')?.focus();
    });

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

    [
        'commQuotaAmount', 'commSingleDayInput', 'commBiDay1', 'commBiDay2',
        'commCustomDaysInput', 'commIntervalDaysInput', 'commTotalInstallments',
        'commPaidInstallments', 'commStartDate'
    ].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updateSchedulePreview);
    });

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

    document.getElementById('btnSaveBudgetLimit')?.addEventListener('click', async () => {
        const val = Number(document.getElementById('finBudgetLimitInput')?.value || 0);
        monthlyBudgetLimit = val;
        localStorage.setItem('ngn_budget_limit', String(val));
        await supabase.auth.updateUser({ data: { monthly_budget_limit: val } });
        recalculateAndRender();
        showToast('Límite presupuestal actualizado', 'success');
    });

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