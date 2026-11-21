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
 * Calcula una fecha YYYY-MM-DD sumando monthOffset meses y ajustando el día
 * al último día válido del mes (ej. día 31 en febrero -> 28 o 29).
 */
export function computeBillingDate(startDateStr, monthOffset, billingDay) {
    const base = (startDateStr || getTodayISO()).slice(0, 10);
    const [year, month] = base.split('-').map(Number);
    const targetMonthIndex = (month - 1) + monthOffset;
    const targetYear = year + Math.floor(targetMonthIndex / 12);
    const targetMonth = ((targetMonthIndex % 12) + 12) % 12; // 0-11
    const lastDayOfMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
    const clampedDay = Math.min(Math.max(1, Number(billingDay || 1)), lastDayOfMonth);

    return `${targetYear}-${String(targetMonth + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`;
}

/**
 * Escala visualmente la prioridad de ítems pendientes vencidos o por vencer en <= 3 días.
 */
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
        // Completados siempre al final
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
        // Por defecto: tiempo -> prioridad
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
 * Genera en lote las cuotas mensuales en agenda_items para una deuda o inversión,
 * evitando duplicados respecto a cuotas ya existentes.
 */
export async function generateCommitmentAgenda(commitment, { userId, householdId = null, authorName = 'Miembro', assignedTo = 'Todos', horizonMonths = 12 } = {}) {
    if (!commitment?.id) return [];

    const { data: existingRows, error: existingErr } = await supabase
        .from('agenda_items')
        .select('installment_number')
        .eq('commitment_id', commitment.id);

    if (existingErr) throw existingErr;
    const existingSet = new Set((existingRows || []).map(r => Number(r.installment_number)));

    const paid = Number(commitment.paid_installments || 0);
    const total = commitment.total_installments ? Number(commitment.total_installments) : null;
    const startNumber = paid + 1;
    const endNumber = total ? total : (paid + Math.max(1, horizonMonths));

    if (startNumber > endNumber) return [];

    const isDebt = commitment.kind === 'deuda';
    const itemType = isDebt ? 'cuota_deuda' : 'aporte_inversion';
    const defaultColor = commitment.color_tag || (isDebt ? '#a855f7' : '#14b8a6');
    const instLabel = commitment.institution ? ` • ${commitment.institution}` : '';

    const rowsToInsert = [];
    for (let num = startNumber; num <= endNumber; num++) {
        if (existingSet.has(num)) continue;

        const monthOffset = num - startNumber;
        const dueDate = computeBillingDate(commitment.start_date, monthOffset, commitment.billing_day);
        const quotaTag = total ? `Cuota ${num}/${total}` : `Aporte #${num}`;

        rowsToInsert.push({
            user_id: userId,
            household_id: householdId,
            author_name: authorName,
            assigned_to: householdId ? (assignedTo || 'Todos') : 'Personal',
            title: `${commitment.title} (${quotaTag})`,
            description: `${isDebt ? 'Pago de obligación' : 'Aporte programado de inversión'}${instLabel}`,
            item_type: itemType,
            priority: commitment.priority || (isDebt ? 'alta' : 'media'),
            due_date: dueDate,
            status: 'pendiente',
            color_tag: defaultColor,
            amount: Number(commitment.monthly_amount),
            commitment_id: commitment.id,
            installment_number: num
        });
    }

    if (rowsToInsert.length === 0) return [];

    const { data, error } = await supabase
        .from('agenda_items')
        .insert(rowsToInsert)
        .select();

    if (error) throw error;
    return data || [];
}

/**
 * Completa un ítem de agenda. Si corresponde a una cuota de deuda, aporte de inversión
 * o pago fijo con monto > 0, registra automáticamente el asiento en finance_transactions
 * y avanza el progreso en financial_commitments.
 */
export async function completeAgendaItem(item, { userId, authorName = 'Miembro', registerFinance = true } = {}) {
    if (!item?.id) throw new Error('Ítem de agenda inválido.');

    if (item.status === 'completado') {
        return updateAgendaItem(item.id, { status: 'pendiente', completed_at: null });
    }

    const isFinancialItem = ['cuota_deuda', 'aporte_inversion', 'pago_fijo'].includes(item.item_type);
    let linkedTxId = item.linked_tx_id || null;

    if (registerFinance && isFinancialItem && Number(item.amount || 0) > 0 && !linkedTxId) {
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
                household_id: item.household_id || null,
                author_name: authorName,
                title: item.title,
                amount: Number(item.amount),
                type: 'gasto',
                nature,
                category,
                is_recurring: true,
                transaction_date: getTodayISO(),
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
        completed_at: new Date().toISOString(),
        linked_tx_id: linkedTxId
    });
}