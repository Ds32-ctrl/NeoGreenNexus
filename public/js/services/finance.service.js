// public/js/services/finance.service.js
import { supabase } from '../config/supabase.js';
import {
    generateCommitmentAgenda,
    resyncCommitmentAgenda,
    normalizeBillingDays,
    getTodayISO
} from './agenda.service.js';

export const RESERVE_CATEGORIES = ['Ahorro', 'Fondo de Emergencia', 'Reserva', 'Aporte Hogar'];
export const DEBT_CATEGORIES = ['Deudas', 'Créditos', 'Tarjeta de Crédito'];
export const INVESTMENT_CATEGORIES = ['Inversión', 'Inversiones', 'CDT', 'Acciones', 'Portafolio'];

export function escapeHTML(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function formatCOP(val, decimals = 0) {
    return '$' + Number(val || 0).toLocaleString('es-CO', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: Math.max(decimals, 2)
    });
}

export function getTransactionNature(tx) {
    if (!tx) return 'operativo';
    if (tx.type === 'ingreso') return 'ingreso';

    if (tx.nature && ['operativo', 'reserva', 'deuda', 'inversion'].includes(tx.nature)) {
        return tx.nature;
    }

    const cat = (tx.category || '').trim();
    const title = (tx.title || '').toLowerCase();

    if (RESERVE_CATEGORIES.includes(cat) || title.includes('fondo de emergencia') || title.includes('reserva')) {
        return 'reserva';
    }
    if (DEBT_CATEGORIES.includes(cat)) return 'deuda';
    if (INVESTMENT_CATEGORIES.includes(cat)) return 'inversion';
    return 'operativo';
}

export function summarizeTransactions(transactions = []) {
    let totalIncome = 0;
    let operationalExpense = 0;
    let fixedExpense = 0;
    let variableExpense = 0;
    let reservedSavings = 0;
    let debtPayments = 0;
    let investmentContributions = 0;
    let incomeCount = 0;
    const categoryTotals = {};

    transactions.forEach(tx => {
        const amt = Number(tx.amount || 0);
        const nature = getTransactionNature(tx);

        if (nature === 'ingreso') {
            totalIncome += amt;
            incomeCount++;
            return;
        }

        if (nature === 'reserva') {
            reservedSavings += amt;
            const key = '🏦 ' + (tx.category || 'Fondo Reserva');
            categoryTotals[key] = (categoryTotals[key] || 0) + amt;
        } else if (nature === 'deuda') {
            debtPayments += amt;
            const key = '💳 ' + (tx.category || 'Deudas');
            categoryTotals[key] = (categoryTotals[key] || 0) + amt;
        } else if (nature === 'inversion') {
            investmentContributions += amt;
            const key = '📈 ' + (tx.category || 'Inversiones');
            categoryTotals[key] = (categoryTotals[key] || 0) + amt;
        } else {
            operationalExpense += amt;
            if (tx.is_recurring) fixedExpense += amt;
            else variableExpense += amt;
            const key = tx.category || 'Otros';
            categoryTotals[key] = (categoryTotals[key] || 0) + amt;
        }
    });

    const totalOutflows = operationalExpense + debtPayments;
    const availableCash = totalIncome - operationalExpense - debtPayments - reservedSavings - investmentContributions;
    const totalRetainedWealth = reservedSavings + investmentContributions + Math.max(0, availableCash);
    const savingsRate = totalIncome > 0
        ? Math.max(0, Number(((totalRetainedWealth / totalIncome) * 100).toFixed(2)))
        : 0;

    return {
        totalIncome,
        operationalExpense,
        fixedExpense,
        variableExpense,
        reservedSavings,
        debtPayments,
        investmentContributions,
        totalOutflows,
        availableCash,
        totalRetainedWealth,
        savingsRate,
        incomeCount,
        categoryTotals
    };
}

export function getMonthlyCommitmentImpact(c) {
    const quota = Number(c.monthly_amount || 0);
    const freq = c.frequency || 'mensual';
    if (freq === 'cada_n_dias') {
        const interval = Math.max(1, Number(c.interval_days || 15));
        return Math.round(quota * (30 / interval));
    }
    const perMonth = Number(c.installments_per_month || normalizeBillingDays(c.billing_days, c.billing_day).length || 1);
    return quota * perMonth;
}

export async function loadCommitments({ userId, householdId = null, scope = 'personal' }) {
    let query = supabase
        .from('financial_commitments')
        .select('*')
        .order('status', { ascending: true })
        .order('billing_day', { ascending: true });

    if (scope === 'household' && householdId) {
        query = query.eq('household_id', householdId);
    } else if (scope === 'all' && householdId) {
        query = query.or(`and(user_id.eq.${userId},household_id.is.null),household_id.eq.${householdId}`);
    } else {
        query = query.eq('user_id', userId).is('household_id', null);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

/**
 * Carga TODOS los pagos reales asociados a una lista de compromisos
 * (tanto si salieron del flujo Personal como del Hogar Familiar).
 */
export async function loadCommitmentTransactions(commitmentIds = []) {
    if (!commitmentIds || commitmentIds.length === 0) return {};

    const { data, error } = await supabase
        .from('finance_transactions')
        .select('*')
        .in('commitment_id', commitmentIds)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });

    if (error) throw error;

    const grouped = {};
    (data || []).forEach(tx => {
        if (!grouped[tx.commitment_id]) grouped[tx.commitment_id] = [];
        grouped[tx.commitment_id].push(tx);
    });
    return grouped;
}

export async function createCommitmentWithAgenda({
    userId,
    householdId = null,
    authorName = 'Miembro',
    assignedTo = 'Todos',
    kind = 'deuda',
    title,
    institution = '',
    principalAmount = 0,
    monthlyAmount,
    totalInstallments = null,
    paidInstallments = 0,
    interestRate = 0,
    frequency = 'mensual',
    billingDays = [1],
    intervalDays = null,
    startDate = getTodayISO(),
    priority = 'alta',
    colorTag = null,
    notes = '',
    traceInAgenda = true,
    horizonMonths = 6
}) {
    const cleanKind = kind === 'inversion' ? 'inversion' : 'deuda';
    const defaultCategory = cleanKind === 'deuda' ? 'Deudas' : 'Inversión';
    const defaultColor = colorTag || (cleanKind === 'deuda' ? '#a855f7' : '#14b8a6');

    const cleanDays = normalizeBillingDays(billingDays, 1);
    const cleanInterval = frequency === 'cada_n_dias' ? Math.max(1, Number(intervalDays || 15)) : null;
    const perMonth = frequency === 'cada_n_dias'
        ? Math.max(1, Math.round(30 / cleanInterval))
        : cleanDays.length;

    const { data: commitment, error } = await supabase
        .from('financial_commitments')
        .insert({
            user_id: userId,
            household_id: householdId,
            author_name: authorName,
            kind: cleanKind,
            title: title.trim(),
            institution: institution.trim() || null,
            category: defaultCategory,
            principal_amount: Number(principalAmount || 0),
            monthly_amount: Number(monthlyAmount),
            total_installments: totalInstallments ? Number(totalInstallments) : null,
            paid_installments: Number(paidInstallments || 0),
            interest_rate: Number(interestRate || 0),
            frequency,
            billing_day: cleanDays[0],
            billing_days: cleanDays,
            interval_days: cleanInterval,
            installments_per_month: perMonth,
            start_date: startDate || getTodayISO(),
            priority,
            color_tag: defaultColor,
            status: 'activo',
            notes: notes.trim() || null
        })
        .select()
        .single();

    if (error) throw error;

    let agendaRows = [];
    if (traceInAgenda) {
        agendaRows = await generateCommitmentAgenda(commitment, {
            userId,
            householdId,
            authorName,
            assignedTo,
            horizonMonths
        });
    }

    return { commitment, agendaRows };
}

export async function updateCommitmentAndResyncAgenda(commitmentId, updates, {
    userId,
    authorName = 'Miembro',
    assignedTo = 'Todos',
    resyncAgenda = true,
    horizonMonths = 6
} = {}) {
    const frequency = updates.frequency || 'mensual';
    const cleanDays = normalizeBillingDays(updates.billingDays ?? updates.billing_days, updates.billingDay ?? 1);
    const cleanInterval = frequency === 'cada_n_dias' ? Math.max(1, Number(updates.intervalDays ?? updates.interval_days ?? 15)) : null;
    const perMonth = frequency === 'cada_n_dias'
        ? Math.max(1, Math.round(30 / cleanInterval))
        : cleanDays.length;

    const payload = {
        monthly_amount: Number(updates.monthlyAmount ?? updates.monthly_amount),
        total_installments: updates.totalInstallments ? Number(updates.totalInstallments) : null,
        frequency,
        billing_day: cleanDays[0],
        billing_days: cleanDays,
        interval_days: cleanInterval,
        installments_per_month: perMonth,
        start_date: updates.startDate || updates.start_date || getTodayISO(),
        priority: updates.priority || 'alta',
        updated_at: new Date().toISOString()
    };

    if (updates.principalAmount !== undefined) {
        payload.principal_amount = Math.max(0, Number(updates.principalAmount || 0));
    }

    const { data: updated, error } = await supabase
        .from('financial_commitments')
        .update(payload)
        .eq('id', commitmentId)
        .select()
        .single();

    if (error) throw error;

    let agendaRows = [];
    if (resyncAgenda && updated.status === 'activo') {
        agendaRows = await resyncCommitmentAgenda(updated, {
            userId,
            householdId: updated.household_id || null,
            authorName,
            assignedTo,
            horizonMonths
        });
    }

    return { commitment: updated, agendaRows };
}

/**
 * Registra un pago o abono real a una deuda/inversión eligiendo:
 * - amount: monto real abonado (puede diferir de la cuota base)
 * - transactionDate: fecha real del pago (permite cargar historial pasado)
 * - sourceHouseholdId: null (Flujo Personal) o household.id (Hogar Familiar)
 * - isExtraCapital: si es true, suma al capital amortizado sin consumir la próxima cuota de Agenda
 */
export async function payCommitmentInstallment(commitment, {
    userId,
    authorName = 'Miembro',
    amount = null,
    transactionDate = getTodayISO(),
    sourceHouseholdId = null,
    isExtraCapital = false
} = {}) {
    const payAmt = Number(amount ?? commitment.monthly_amount);
    if (!payAmt || payAmt <= 0) throw new Error('Ingresa un monto de abono válido mayor a 0.');

    const isDebt = commitment.kind === 'deuda';
    let targetAgendaItem = null;

    if (!isExtraCapital) {
        const { data: pendingRows, error: findErr } = await supabase
            .from('agenda_items')
            .select('*')
            .eq('commitment_id', commitment.id)
            .neq('status', 'completado')
            .order('due_date', { ascending: true })
            .limit(1);

        if (findErr) throw findErr;
        if (pendingRows && pendingRows.length > 0) {
            targetAgendaItem = pendingRows[0];
        }
    }

    const nextNum = Number(commitment.paid_installments || 0) + 1;
    const quotaTag = isExtraCapital
        ? 'Abono Extra a Capital'
        : (commitment.total_installments ? `Cuota ${nextNum}/${commitment.total_installments}` : `Aporte #${nextNum}`);

    const txTitle = targetAgendaItem ? targetAgendaItem.title : `${commitment.title} (${quotaTag})`;

    const { data: tx, error: txErr } = await supabase
        .from('finance_transactions')
        .insert({
            user_id: userId,
            household_id: sourceHouseholdId,
            author_name: authorName,
            title: txTitle,
            amount: payAmt,
            type: 'gasto',
            nature: isDebt ? 'deuda' : 'inversion',
            category: isDebt ? 'Deudas' : 'Inversión',
            is_recurring: !isExtraCapital,
            transaction_date: transactionDate || getTodayISO(),
            commitment_id: commitment.id
        })
        .select()
        .single();

    if (txErr) throw txErr;

    if (targetAgendaItem) {
        await supabase
            .from('agenda_items')
            .update({
                status: 'completado',
                amount: payAmt,
                completed_at: new Date().toISOString(),
                linked_tx_id: tx.id,
                updated_at: new Date().toISOString()
            })
            .eq('id', targetAgendaItem.id);
    }

    // Evaluar nuevo progreso y verificar si se saldó el capital completo
    const nextPaid = isExtraCapital ? Number(commitment.paid_installments || 0) : nextNum;
    const historyMap = await loadCommitmentTransactions([commitment.id]);
    const realPaidSum = (historyMap[commitment.id] || []).reduce((acc, r) => acc + Number(r.amount || 0), 0);

    const paidByCount = Boolean(commitment.total_installments && nextPaid >= Number(commitment.total_installments));
    const paidByCapital = Boolean(isDebt && Number(commitment.principal_amount || 0) > 0 && realPaidSum >= Number(commitment.principal_amount));
    const nextStatus = (paidByCount || paidByCapital) ? 'pagado' : 'activo';

    await supabase
        .from('financial_commitments')
        .update({
            paid_installments: nextPaid,
            status: nextStatus,
            updated_at: new Date().toISOString()
        })
        .eq('id', commitment.id);

    return tx;
}

// Alias retrocompatible para llamadas simples
export async function payNextCommitmentInstallment(commitment, opts = {}) {
    return payCommitmentInstallment(commitment, {
        ...opts,
        sourceHouseholdId: opts.sourceHouseholdId !== undefined ? opts.sourceHouseholdId : (commitment.household_id || null)
    });
}

/**
 * Edita el monto, fecha u origen (Personal / Hogar) de un abono ya registrado
 * y actualiza la agenda y estado del compromiso asociado.
 */
export async function updateCommitmentPayment(tx, { amount, transactionDate, sourceHouseholdId }) {
    const cleanAmt = Number(amount);
    if (!cleanAmt || cleanAmt <= 0) throw new Error('El monto debe ser mayor a 0.');

    const { data: updatedTx, error } = await supabase
        .from('finance_transactions')
        .update({
            amount: cleanAmt,
            transaction_date: transactionDate || tx.transaction_date || getTodayISO(),
            household_id: sourceHouseholdId
        })
        .eq('id', tx.id)
        .select()
        .single();

    if (error) throw error;

    // Sincronizar monto en agenda_items si estaba enlazado
    await supabase
        .from('agenda_items')
        .update({ amount: cleanAmt, updated_at: new Date().toISOString() })
        .eq('linked_tx_id', tx.id);

    if (tx.commitment_id) {
        await refreshCommitmentStatusByBalance(tx.commitment_id);
    }

    return updatedTx;
}

/**
 * Elimina una transacción del Libro Mayor o del historial de una deuda.
 * Si pertenecía a una deuda/inversión, revierte la cuota en agenda_items a 'pendiente'
 * y descuenta el avance en financial_commitments.
 */
export async function deleteTransactionWithSync(tx) {
    if (!tx?.id) return;

    // 1. Revertir ítem de agenda enlazado (si existe)
    await supabase
        .from('agenda_items')
        .update({
            status: 'pendiente',
            completed_at: null,
            linked_tx_id: null,
            updated_at: new Date().toISOString()
        })
        .eq('linked_tx_id', tx.id);

    // 2. Eliminar transacción
    const { error } = await supabase.from('finance_transactions').delete().eq('id', tx.id);
    if (error) throw error;

    // 3. Ajustar progreso del compromiso si aplicaba
    if (tx.commitment_id) {
        const { data: comm } = await supabase
            .from('financial_commitments')
            .select('id, paid_installments, total_installments, principal_amount, kind')
            .eq('id', tx.commitment_id)
            .single();

        if (comm) {
            const isExtra = String(tx.title || '').toLowerCase().includes('abono extra');
            const nextPaid = isExtra
                ? Number(comm.paid_installments || 0)
                : Math.max(0, Number(comm.paid_installments || 0) - 1);

            await supabase
                .from('financial_commitments')
                .update({
                    paid_installments: nextPaid,
                    status: 'activo',
                    updated_at: new Date().toISOString()
                })
                .eq('id', comm.id);

            await refreshCommitmentStatusByBalance(comm.id);
        }
    }
}

/**
 * Cuadra exactamente `paid_installments` y `status` contra el historial real
 * de transacciones existentes para esa deuda/inversión.
 */
export async function reconcileCommitmentWithHistory(commitmentId) {
    const [{ data: comm, error: cErr }, historyMap] = await Promise.all([
        supabase.from('financial_commitments').select('*').eq('id', commitmentId).single(),
        loadCommitmentTransactions([commitmentId])
    ]);
    if (cErr) throw cErr;

    const txList = historyMap[commitmentId] || [];
    const regularPayments = txList.filter(t => !String(t.title || '').toLowerCase().includes('abono extra')).length;
    const realPaidSum = txList.reduce((acc, r) => acc + Number(r.amount || 0), 0);

    const paidByCount = Boolean(comm.total_installments && regularPayments >= Number(comm.total_installments));
    const paidByCapital = Boolean(comm.kind === 'deuda' && Number(comm.principal_amount || 0) > 0 && realPaidSum >= Number(comm.principal_amount));
    const nextStatus = (paidByCount || paidByCapital) ? 'pagado' : 'activo';

    const { data: updated, error: upErr } = await supabase
        .from('financial_commitments')
        .update({
            paid_installments: regularPayments,
            status: nextStatus,
            updated_at: new Date().toISOString()
        })
        .eq('id', commitmentId)
        .select()
        .single();

    if (upErr) throw upErr;
    return { commitment: updated, realPaidSum, count: txList.length };
}

async function refreshCommitmentStatusByBalance(commitmentId) {
    const [{ data: comm }, historyMap] = await Promise.all([
        supabase.from('financial_commitments').select('id, kind, principal_amount, total_installments, paid_installments').eq('id', commitmentId).single(),
        loadCommitmentTransactions([commitmentId])
    ]);
    if (!comm) return;

    const realPaidSum = (historyMap[commitmentId] || []).reduce((acc, r) => acc + Number(r.amount || 0), 0);
    const paidByCount = Boolean(comm.total_installments && Number(comm.paid_installments || 0) >= Number(comm.total_installments));
    const paidByCapital = Boolean(comm.kind === 'deuda' && Number(comm.principal_amount || 0) > 0 && realPaidSum >= Number(comm.principal_amount));

    await supabase
        .from('financial_commitments')
        .update({
            status: (paidByCount || paidByCapital) ? 'pagado' : 'activo',
            updated_at: new Date().toISOString()
        })
        .eq('id', commitmentId);
}

export async function deleteCommitment(commitmentId) {
    const { error } = await supabase
        .from('financial_commitments')
        .delete()
        .eq('id', commitmentId);
    if (error) throw error;
}