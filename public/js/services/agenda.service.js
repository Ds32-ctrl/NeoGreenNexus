// public/js/services/agenda.service.js
import { supabase } from '../config/supabase.js';

export const PRIORITY_META = {
    critica: { label: 'Crítica', weight: 4, color: '#ef4444', bg: 'rgba(239, 68, 68, 0.14)', icon: '🔴' },
    alta:    { label: 'Alta',    weight: 3, color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.14)', icon: '🟠' },
    media:   { label: 'Media',   weight: 2, color: '#0ea5e9', bg: 'rgba(14, 165, 233, 0.14)', icon: '🔵' },
    baja:    { label: 'Baja',    weight: 1, color: '#10b981', bg: 'rgba(16, 185, 129, 0.14)', icon: '🟢' }
};

export const AGENDA_TYPE_META = {
    evento:           { label: 'Evento',            icon: '📅', color: '#0ea5e9' },
    tarea:            { label: 'Tarea',             icon: '✅', color: '#10b981' },
    alerta:           { label: 'Alerta',            icon: '🚨', color: '#ef4444' },
    cuota_deuda:      { label: 'Cuota Deuda',       icon: '💳', color: '#a855f7' },
    aporte_inversion: { label: 'Aporte Inversión',  icon: '📈', color: '#14b8a6' },
    pago_fijo:        { label: 'Pago Fijo',         icon: '⚡', color: '#f59e0b' }
};

export const FREQUENCY_LABELS = {
    mensual:          'Mensual',
    quincenal:        'Quincenal',
    dias_especificos: 'Días específicos',
    cada_n_dias:      'Cada N días'
};

export function getTodayISO() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function diffDaysFromToday(dateStr) {
    if (!dateStr) return 999;
    const [ty, tm, td] = getTodayISO().split('-').map(Number);
    const [dy, dm, dd] = String(dateStr).slice(0, 10).split('-').map(Number);
    const todayUtc = Date.UTC(ty, tm - 1, td);
    const targetUtc = Date.UTC(dy, dm - 1, dd);
    return Math.round((targetUtc - todayUtc) / 86400000);
}

/**
 * Normaliza un arreglo o texto de días (ej. "2, 17" o [17, 2]) en enteros únicos ordenados 1..31.
 */
export function normalizeBillingDays(input, fallbackDay = 1) {
    let rawList = [];
    if (Array.isArray(input)) {
        rawList = input;
    } else if (typeof input === 'string') {
        rawList = input.split(/[\s,;/-]+/).filter(Boolean);
    } else if (input != null) {
        rawList = [input];
    }

    const parsed = [...new Set(
        rawList
            .map(v => Math.floor(Number(v)))
            .filter(n => Number.isFinite(n) && n >= 1 && n <= 31)
    )].sort((a, b) => a - b);

    if (parsed.length > 0) return parsed;
    const fb = Math.min(31, Math.max(1, Math.floor(Number(fallbackDay || 1))));
    return [fb];
}

/**
 * Genera el arreglo de fechas YYYY-MM-DD según la frecuencia configurada:
 * - 'mensual': 1 día fijo por mes (ej. día 28 para NU)
 * - 'quincenal': 2 días específicos por mes (ej. días 2 y 17 para QUAC)
 * - 'dias_especificos': N días específicos por mes (ej. 5, 15, 25)
 * - 'cada_n_dias': intervalo fijo de días desde start_date (ej. cada 7 o 15 días)
 */
export function computeCommitmentScheduleDates({
    startDate = getTodayISO(),
    frequency = 'mensual',
    billingDay = 1,
    billingDays = null,
    intervalDays = 15,
    count = 1
}) {
    const safeCount = Math.min(60, Math.max(0, Math.floor(Number(count || 0))));
    if (safeCount === 0) return [];

    const startStr = String(startDate || getTodayISO()).slice(0, 10);
    const [startY, startM, startD] = startStr.split('-').map(Number);
    const dates = [];

    if (frequency === 'cada_n_dias') {
        const step = Math.max(1, Math.floor(Number(intervalDays || 15)));
        const baseUtc = Date.UTC(startY, startM - 1, startD);
        for (let i = 0; i < safeCount; i++) {
            const dt = new Date(baseUtc + i * step * 86400000);
            const y = dt.getUTCFullYear();
            const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
            const d = String(dt.getUTCDate()).padStart(2, '0');
            dates.push(`${y}-${m}-${d}`);
        }
        return dates;
    }

    const days = normalizeBillingDays(billingDays, billingDay);
    let monthOffset = 0;
    const maxMonthsGuard = 120;

    while (dates.length < safeCount && monthOffset < maxMonthsGuard) {
        const totalMonthIndex = (startM - 1) + monthOffset;
        const year = startY + Math.floor(totalMonthIndex / 12);
        const month = ((totalMonthIndex % 12) + 12) % 12; // 0..11
        const lastDay = new Date(year, month + 1, 0).getDate();

        const usedInMonth = new Set();
        for (const rawDay of days) {
            const clampedDay = Math.min(rawDay, lastDay);
            if (usedInMonth.has(clampedDay)) continue;
            usedInMonth.add(clampedDay);

            const candidate = `${year}-${String(month + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
            if (candidate >= startStr) {
                dates.push(candidate);
                if (dates.length >= safeCount) break;
            }
        }
        monthOffset++;
    }

    return dates;
}

export function describeCommitmentSchedule(c) {
    const freq = c.frequency || 'mensual';
    const days = normalizeBillingDays(c.billing_days, c.billing_day);
    if (freq === 'cada_n_dias') {
        const n = Number(c.interval_days || 15);
        return `Cada ${n} días`;
    }
    if (freq === 'quincenal') {
        return `Quincenal • Días ${days.join(' y ')}`;
    }
    if (freq === 'dias_especificos') {
        return `${days.length}x/mes • Días ${days.join(', ')}`;
    }
    return `Mensual • Día ${days[0]}`;
}

export function getEffectivePriority(item) {
    if (item.status === 'completado') return item.priority || 'baja';
    const days = diffDaysFromToday(item.due_date);
    if (days < 0) return 'critica';
    if (days <= 3 && (item.item_type === 'cuota_deuda' || item.item_type === 'pago_fijo' || item.priority === 'alta')) {
        return 'critica';
    }
    return item.priority || 'media';
}

export function sortAgendaItems(items, sortMode = 'time') {
    return [...items].sort((a, b) => {
        if (a.status === 'completado' && b.status !== 'completado') return 1;
        if (a.status !== 'completado' && b.status === 'completado') return -1;

        const wA = PRIORITY_META[getEffectivePriority(a)]?.weight || 2;
        const wB = PRIORITY_META[getEffectivePriority(b)]?.weight || 2;
        const dateCmp = String(a.due_date || '').localeCompare(String(b.due_date || ''));
        const timeCmp = String(a.due_time || '23:59').localeCompare(String(b.due_time || '23:59'));

        if (sortMode === 'priority') {
            if (wB !== wA) return wB - wA;
            if (dateCmp !== 0) return dateCmp;
            return timeCmp;
        }
        if (dateCmp !== 0) return dateCmp;
        if (timeCmp !== 0) return timeCmp;
        return wB - wA;
    });
}

export async function loadAgendaItems({ userId, householdId = null, scope = 'all' }) {
    let query = supabase
        .from('agenda_items')
        .select('*')
        .order('due_date', { ascending: true })
        .order('due_time', { ascending: true, nullsFirst: false });

    if (scope === 'personal') {
        query = query.eq('user_id', userId).is('household_id', null);
    } else if (scope === 'household' && householdId) {
        query = query.eq('household_id', householdId);
    } else if (householdId) {
        query = query.or(`and(user_id.eq.${userId},household_id.is.null),household_id.eq.${householdId}`);
    } else {
        query = query.eq('user_id', userId);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
}

export async function createAgendaItem(payload) {
    const { data, error } = await supabase
        .from('agenda_items')
        .insert(payload)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function updateAgendaItem(id, updates) {
    const { data, error } = await supabase
        .from('agenda_items')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return data;
}

export async function deleteAgendaItem(id) {
    const { error } = await supabase.from('agenda_items').delete().eq('id', id);
    if (error) throw error;
}

/**
 * Genera en lote las cuotas/aportes en agenda_items según la frecuencia y días del compromiso,
 * evitando cualquier duplicado por (commitment_id, installment_number).
 */
export async function generateCommitmentAgenda(commitment, {
    userId,
    householdId = null,
    authorName = 'Miembro',
    assignedTo = 'Todos',
    horizonMonths = 6
} = {}) {
    if (!commitment?.id) return [];

    const { data: existingRows, error: existingErr } = await supabase
        .from('agenda_items')
        .select('installment_number')
        .eq('commitment_id', commitment.id);

    if (existingErr) throw existingErr;
    const existingSet = new Set((existingRows || []).map(r => Number(r.installment_number)));

    const paid = Number(commitment.paid_installments || 0);
    const total = commitment.total_installments ? Number(commitment.total_installments) : null;
    const freq = commitment.frequency || 'mensual';
    const perMonth = Number(commitment.installments_per_month || normalizeBillingDays(commitment.billing_days, commitment.billing_day).length || 1);

    // Determinar cuántas cuotas futuras generar
    let pendingCount = 0;
    if (total) {
        pendingCount = Math.max(0, total - paid);
    } else if (freq === 'cada_n_dias') {
        const interval = Math.max(1, Number(commitment.interval_days || 15));
        pendingCount = Math.min(36, Math.max(1, Math.ceil((horizonMonths * 30) / interval)));
    } else {
        pendingCount = Math.min(36, Math.max(1, horizonMonths * perMonth));
    }

    if (pendingCount === 0) return [];

    const scheduleDates = computeCommitmentScheduleDates({
        startDate: commitment.start_date || getTodayISO(),
        frequency: freq,
        billingDay: commitment.billing_day,
        billingDays: commitment.billing_days,
        intervalDays: commitment.interval_days,
        count: pendingCount
    });

    const isDebt = commitment.kind === 'deuda';
    const itemType = isDebt ? 'cuota_deuda' : 'aporte_inversion';
    const defaultColor = commitment.color_tag || (isDebt ? '#a855f7' : '#14b8a6');
    const instLabel = commitment.institution ? ` • ${commitment.institution}` : '';
    const schedLabel = describeCommitmentSchedule(commitment);

    const rowsToInsert = [];
    scheduleDates.forEach((dueDate, idx) => {
        const num = paid + 1 + idx;
        if (existingSet.has(num)) return;

        const quotaTag = total ? `Cuota ${num}/${total}` : `Aporte #${num}`;
        rowsToInsert.push({
            user_id: userId,
            household_id: householdId,
            author_name: authorName,
            assigned_to: householdId ? (assignedTo || 'Todos') : 'Personal',
            title: `${commitment.title} (${quotaTag})`,
            description: `${isDebt ? 'Pago de deuda' : 'Aporte de inversión'}${instLabel} • ${schedLabel}`,
            item_type: itemType,
            priority: commitment.priority || (isDebt ? 'alta' : 'media'),
            due_date: dueDate,
            status: 'pendiente',
            color_tag: defaultColor,
            amount: Number(commitment.monthly_amount),
            commitment_id: commitment.id,
            installment_number: num
        });
    });

    if (rowsToInsert.length === 0) return [];

    const { data, error } = await supabase
        .from('agenda_items')
        .insert(rowsToInsert)
        .select();

    if (error) throw error;
    return data || [];
}

/**
 * Re-sincroniza únicamente las cuotas PENDIENTES (sin asiento financiero) tras editar
 * días de pago, frecuencia o monto de una deuda/inversión.
 */
export async function resyncCommitmentAgenda(commitment, opts = {}) {
    if (!commitment?.id) return [];

    const { error: delErr } = await supabase
        .from('agenda_items')
        .delete()
        .eq('commitment_id', commitment.id)
        .neq('status', 'completado')
        .is('linked_tx_id', null);

    if (delErr) throw delErr;

    return generateCommitmentAgenda(commitment, opts);
}

/**
 * Completa un ítem de agenda. Si corresponde a cuota_deuda, aporte_inversion o pago_fijo
 * con monto > 0, crea automáticamente el asiento en finance_transactions y actualiza el progreso.
 */
/**
 * Completa un ítem de agenda. Para ítems financieros permite especificar:
 * - amount: monto real pagado (editable al confirmar)
 * - transactionDate: fecha real del movimiento
 * - sourceHouseholdId: null (Flujo Personal) o household.id (Hogar Familiar)
 */
export async function completeAgendaItem(item, {
    userId,
    authorName = 'Miembro',
    registerFinance = true,
    amount = null,
    transactionDate = null,
    sourceHouseholdId = undefined
} = {}) {
    if (!item?.id) throw new Error('Ítem de agenda inválido.');

    if (item.status === 'completado') {
        return updateAgendaItem(item.id, { status: 'pendiente', completed_at: null });
    }

    const isFinancialItem = ['cuota_deuda', 'aporte_inversion', 'pago_fijo'].includes(item.item_type);
    const finalAmount = amount !== null ? Number(amount) : Number(item.amount || 0);
    const finalDate = transactionDate || getTodayISO();
    const targetHouseholdId = sourceHouseholdId !== undefined ? sourceHouseholdId : (item.household_id || null);
    let linkedTxId = item.linked_tx_id || null;

    if (registerFinance && isFinancialItem && finalAmount > 0 && !linkedTxId) {
        const nature = item.item_type === 'cuota_deuda'
            ? 'deuda'
            : item.item_type === 'aporte_inversion'
                ? 'inversion'
                : 'operativo';

        const category = item.item_type === 'cuota_deuda'
            ? 'Deudas'
            : item.item_type === 'aporte_inversion'
                ? 'Inversión'
                : 'Servicios';

        const { data: tx, error: txErr } = await supabase
            .from('finance_transactions')
            .insert({
                user_id: userId,
                household_id: targetHouseholdId,
                author_name: authorName,
                title: item.title,
                amount: finalAmount,
                type: 'gasto',
                nature,
                category,
                is_recurring: true,
                transaction_date: finalDate,
                commitment_id: item.commitment_id || null
            })
            .select()
            .single();

        if (txErr) throw txErr;
        linkedTxId = tx.id;

        if (item.commitment_id) {
            const { data: comm } = await supabase
                .from('financial_commitments')
                .select('paid_installments, total_installments')
                .eq('id', item.commitment_id)
                .single();

            if (comm) {
                const nextPaid = Number(comm.paid_installments || 0) + 1;
                const nextStatus = (comm.total_installments && nextPaid >= Number(comm.total_installments))
                    ? 'pagado'
                    : 'activo';

                await supabase
                    .from('financial_commitments')
                    .update({
                        paid_installments: nextPaid,
                        status: nextStatus,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', item.commitment_id);
            }
        }
    }

    return updateAgendaItem(item.id, {
        status: 'completado',
        amount: finalAmount > 0 ? finalAmount : item.amount,
        completed_at: new Date().toISOString(),
        linked_tx_id: linkedTxId
    });
}