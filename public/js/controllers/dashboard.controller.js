// public/js/controllers/dashboard.controller.js
import { supabase } from '../config/supabase.js';
import { logoutUser } from '../core/auth.js';
import { navigateTo } from '../core/router.js';
import { openCommandPalette } from '../core/theme.js';
import { getActiveHousehold } from '../core/household.js';
import { formatCOP, summarizeTransactions } from '../services/finance.service.js';
import { loadAgendaItems, diffDaysFromToday, getTodayISO } from '../services/agenda.service.js';

function getTimeGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Buenos días';
    if (h < 19) return 'Buenas tardes';
    return 'Buenas noches';
}

export async function initDashboard() {
    let activeUser = null;

    try {
        const { data: { user }, error } = await supabase.auth.getUser();
        const dashName = document.getElementById('dashName');
        const dashAvatar = document.getElementById('dashAvatar');

        if (error || !user) {
            if (dashName) dashName.textContent = 'Sesión inactiva';
            navigateTo('/');
            return;
        }
        activeUser = user;

        const metadata = user.user_metadata || {};
        const rawName = metadata.full_name?.trim() || metadata.nickname?.trim() || user.email?.split('@')[0] || 'Usuario';
        const displayName = rawName.split(' ')[0];

        if (dashName) dashName.textContent = displayName;

        let googleAvatar = '';
        if (Array.isArray(user.identities)) {
            const googleId = user.identities.find(id => id.provider === 'google');
            if (googleId?.identity_data?.avatar_url) {
                googleAvatar = googleId.identity_data.avatar_url;
            }
        }

        const finalAvatar = metadata.avatar_url || googleAvatar || 'https://api.dicebear.com/7.x/bottts-neutral/svg?seed=N1&backgroundColor=e2e8f0';
        if (dashAvatar) dashAvatar.src = finalAvatar;

        const greetingTitle = document.getElementById('dashGreetingTitle');
        if (greetingTitle) {
            greetingTitle.textContent = `${getTimeGreeting()}, ${displayName}`;
        }

        // Cargar pulso en vivo sin bloquear la interfaz
        loadDashboardPulse(user.id);
    } catch (error) {
        console.error('Error al cargar perfil en Dashboard:', error);
    }

    document.getElementById('btnDashCommand')?.addEventListener('click', openCommandPalette);

    const btnLogout = document.getElementById('btnLogout');
    if (btnLogout) {
        btnLogout.addEventListener('click', (e) => {
            e.preventDefault();
            logoutUser(btnLogout);
        });
    }

    return activeUser;
}

async function loadDashboardPulse(userId) {
    try {
        const household = await getActiveHousehold(userId).catch(() => null);
        const householdId = household?.id || null;

        const houseLabel = document.getElementById('dashHouseholdLabel');
        const greetSub = document.getElementById('dashGreetingSub');
        const familyBadge = document.getElementById('dashBadgeFamily');

        if (household) {
            if (houseLabel) houseLabel.textContent = household.name;
            if (greetSub) greetSub.textContent = `Nodo sincronizado con ${household.name} (${household.members?.length || 1} miembros activos).`;
            if (familyBadge) familyBadge.textContent = household.name;
        } else if (greetSub) {
            greetSub.textContent = 'Todos tus módulos están activos y sincronizados en tiempo real.';
        }

        const scopeExpr = householdId
            ? `and(user_id.eq.${userId},household_id.is.null),household_id.eq.${householdId}`
            : `user_id.eq.${userId}`;

        const todayISO = getTodayISO();

        const [agendaList, txRes, invRes, zonesRes, habitsRes, logsRes] = await Promise.all([
            loadAgendaItems({ userId, householdId, scope: 'all' }).catch(() => []),
            supabase.from('finance_transactions').select('amount, type, category, nature, title, is_recurring').or(scopeExpr),
            supabase.from('inventory_items').select('id, quantity, min_stock, in_shopping_list').or(scopeExpr),
            supabase.from('zone_tasks').select('id, is_completed').or(scopeExpr).eq('is_completed', false),
            supabase.from('habits').select('id').eq('user_id', userId),
            supabase.from('habit_logs').select('habit_id').eq('user_id', userId).eq('completed_date', todayISO)
        ]);

        // 1. Agenda próxima (vencidos o próximos 7 días)
        const pendingAgenda = (agendaList || []).filter(i => i.status !== 'completado');
        const urgentAgenda = pendingAgenda.filter(i => diffDaysFromToday(i.due_date) <= 7);
        const pulseAgenda = document.getElementById('pulseAgendaCount');
        const badgeAgenda = document.getElementById('dashBadgeAgenda');
        if (pulseAgenda) pulseAgenda.textContent = urgentAgenda.length;
        if (badgeAgenda) {
            badgeAgenda.textContent = urgentAgenda.length > 0 ? `${urgentAgenda.length} próximos` : `${pendingAgenda.length} en total`;
        }

        // 2. Caja disponible
        const summary = summarizeTransactions(txRes.data || []);
        const pulseCash = document.getElementById('pulseCashAmount');
        const badgeFin = document.getElementById('dashBadgeFinance');
        if (pulseCash) {
            pulseCash.textContent = formatCOP(summary.availableCash);
            pulseCash.style.color = summary.availableCash >= 0 ? 'var(--primary-neon)' : 'var(--danger-color, #ef4444)';
        }
        if (badgeFin) {
            badgeFin.textContent = formatCOP(summary.availableCash);
        }

        // 3. Despensa
        const lowStock = (invRes.data || []).filter(i => Number(i.quantity) <= Number(i.min_stock) || i.in_shopping_list).length;
        const badgeInv = document.getElementById('dashBadgeInventory');
        if (badgeInv) {
            badgeInv.textContent = lowStock > 0 ? `${lowStock} por comprar` : 'Stock OK';
        }

        // 4. Zonas
        const pendingZones = (zonesRes.data || []).length;
        const badgeZones = document.getElementById('dashBadgeZones');
        if (badgeZones) {
            badgeZones.textContent = pendingZones > 0 ? `${pendingZones} pendientes` : 'Al día';
        }

        // 5. Hábitos hoy
        const totalHabits = (habitsRes.data || []).length;
        const doneToday = new Set((logsRes.data || []).map(l => l.habit_id)).size;
        const pulseHabits = document.getElementById('pulseHabitsToday');
        const badgeHabits = document.getElementById('dashBadgeHabits');
        if (pulseHabits) pulseHabits.textContent = `${doneToday}/${totalHabits}`;
        if (badgeHabits) {
            badgeHabits.textContent = totalHabits > 0 ? `${doneToday}/${totalHabits} hoy` : 'Sin rutinas';
        }
    } catch (err) {
        console.warn('Pulso del dashboard en modo offline/parcial:', err);
    }
}