// public/js/services/finance.service.js
import { supabase } from '../config/supabase.js';
import {
    generateCommitmentAgenda,
    resyncCommitmentAgenda,
    completeAgendaItem,
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

/**
 * Calcula el impacto mensual estimado de una deuda/inversión según su frecuencia.
 */
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
 * Crea una Deuda o Inversión con periodicidad flexible (mensual, quincenal, días específicos o cada N días)
 * y traza automáticamente sus cuotas en agenda_items si traceInAgenda es true.
 */
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

/**
 * Permite ajustar monto, frecuencia, días de pago, cuotas totales o fecha de inicio
 * de una deuda/inversión y re-sincronizar sus cuotas pendientes en la Agenda.
 */
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
 * Liquida la siguiente cuota pendiente de una deuda/inversión en 1 clic:
 * - Si existe en agenda_items, la liquida mediante completeAgendaItem (cero duplicados).
 * - Si no estaba trazada en agenda, asienta directo en finance_transactions y avanza paid_installments.
 */
export async function payNextCommitmentInstallment(commitment, { userId, authorName = 'Miembro' } = {}) {
    const { data: pendingRows, error: findErr } = await supabase
        .from('agenda_items')
        .select('*')
        .eq('commitment_id', commitment.id)
        .neq('status', 'completado')
        .order('due_date', { ascending: true })
        .limit(1);

    if (findErr) throw findErr;

    if (pendingRows && pendingRows.length > 0) {
        return completeAgendaItem(pendingRows[0], { userId, authorName, registerFinance: true });
    }

    const nextNum = Number(commitment.paid_installments || 0) + 1;
    const isDebt = commitment.kind === 'deuda';
    const quotaTag = commitment.total_installments ? `Cuota ${nextNum}/${commitment.total_installments}` : `Aporte #${nextNum}`;

    const { error: txErr } = await supabase.from('finance_transactions').insert({
        user_id: userId,
        household_id: commitment.household_id || null,
        author_name: authorName,
        title: `${commitment.title} (${quotaTag})`,
        amount: Number(commitment.monthly_amount),
        type: 'gasto',
        nature: isDebt ? 'deuda' : 'inversion',
        category: isDebt ? 'Deudas' : 'Inversión',
        is_recurring: true,
        transaction_date: getTodayISO(),
        commitment_id: commitment.id
    });
    if (txErr) throw txErr;

    const nextStatus = (commitment.total_installments && nextNum >= Number(commitment.total_installments))
        ? 'pagado'
        : 'activo';

    const { error: upErr } = await supabase
        .from('financial_commitments')
        .update({
            paid_installments: nextNum,
            status: nextStatus,
            updated_at: new Date().toISOString()
        })
        .eq('id', commitment.id);

    if (upErr) throw upErr;
}

export async function deleteCommitment(commitmentId) {
    const { error } = await supabase
        .from('financial_commitments')
        .delete()
        .eq('id', commitmentId);
    if (error) throw error;
}