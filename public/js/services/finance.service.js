// public/js/services/finance.service.js
import { supabase } from '../config/supabase.js';
import { generateCommitmentAgenda, getTodayISO } from './agenda.service.js';

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

/**
 * Determina la naturaleza contable real de una transacción con retrocompatibilidad
 * total para registros previos a la columna `nature`.
 */
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

/**
 * Motor contable unificado para Finanzas, Tablero Familiar y Núcleo 360 Home.
 */
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
 * Crea una Deuda o Inversión y, si `traceInAgenda` está activo, proyecta automáticamente
 * todas sus cuotas o aportes mensuales en `agenda_items`.
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
    billingDay = 1,
    startDate = getTodayISO(),
    priority = 'alta',
    colorTag = null,
    notes = '',
    traceInAgenda = true,
    horizonMonths = 12
}) {
    const cleanKind = kind === 'inversion' ? 'inversion' : 'deuda';
    const defaultCategory = cleanKind === 'deuda' ? 'Deudas' : 'Inversión';
    const defaultColor = colorTag || (cleanKind === 'deuda' ? '#a855f7' : '#14b8a6');

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
            billing_day: Math.min(31, Math.max(1, Number(billingDay || 1))),
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

export async function deleteCommitment(commitmentId) {
    const { error } = await supabase
        .from('financial_commitments')
        .delete()
        .eq('id', commitmentId);
    if (error) throw error;
}