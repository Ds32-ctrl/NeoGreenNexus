// public/js/services/notifications.service.js
import { diffDaysFromToday, getEffectivePriority } from './agenda.service.js';

const STORAGE_KEY = 'ngn_agenda_notifs_enabled';

function hashToPositiveInt(str = '') {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash % 2000000000) + 1;
}

export function isNotificationsEnabled() {
    return localStorage.getItem(STORAGE_KEY) === 'true';
}

export function setNotificationsEnabled(enabled) {
    localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
}

function getCapacitorLocalNotifs() {
    return window.Capacitor?.Plugins?.LocalNotifications || null;
}

export async function requestNotificationPermission() {
    const capNotifs = getCapacitorLocalNotifs();
    if (capNotifs) {
        const res = await capNotifs.requestPermissions();
        const granted = res?.display === 'granted';
        setNotificationsEnabled(granted);
        return granted;
    }

    if (typeof Notification === 'undefined') {
        return false;
    }

    if (Notification.permission === 'granted') {
        setNotificationsEnabled(true);
        return true;
    }

    const perm = await Notification.requestPermission();
    const granted = perm === 'granted';
    setNotificationsEnabled(granted);
    return granted;
}

/**
 * Programa recordatorios 24h antes (9:00 AM) y el mismo día (8:00 AM)
 * para vencimientos financieros o críticos en Android (Capacitor) y muestra
 * alertas del día en Web / Electron (una vez por sesión por ítem).
 */
export async function syncAgendaReminders(items = []) {
    if (!isNotificationsEnabled()) return { scheduled: 0, mode: 'disabled' };

    const pendingCritical = (items || []).filter(item => {
        if (item.status === 'completado' || !item.due_date) return false;
        const days = diffDaysFromToday(item.due_date);
        const isFinancial = ['cuota_deuda', 'aporte_inversion', 'pago_fijo'].includes(item.item_type);
        const prio = getEffectivePriority(item);
        return days >= 0 && days <= 30 && (isFinancial || prio === 'critica' || prio === 'alta');
    });

    const capNotifs = getCapacitorLocalNotifs();

    // 1. Entorno Nativo Android (Capacitor)
    if (capNotifs) {
        const now = Date.now();
        const notifications = [];

        pendingCritical.slice(0, 25).forEach(item => {
            const [y, m, d] = String(item.due_date).slice(0, 10).split('-').map(Number);
            const dayBefore = new Date(y, m - 1, d - 1, 9, 0, 0);
            const sameDay = new Date(y, m - 1, d, 8, 0, 0);
            const amtLabel = Number(item.amount || 0) > 0
                ? ` ($${Number(item.amount).toLocaleString('es-CO')})`
                : '';

            if (dayBefore.getTime() > now) {
                notifications.push({
                    id: hashToPositiveInt(`${item.id}_24h`),
                    title: `⏰ Vence mañana: ${item.title}`,
                    body: `Compromiso programado para mañana${amtLabel}.`,
                    schedule: { at: dayBefore }
                });
            }
            if (sameDay.getTime() > now) {
                notifications.push({
                    id: hashToPositiveInt(`${item.id}_0h`),
                    title: `🚨 Vence hoy: ${item.title}`,
                    body: `Recuerda completar o pagar hoy${amtLabel}.`,
                    schedule: { at: sameDay }
                });
            }
        });

        try {
            const pendingList = await capNotifs.getPending();
            if (pendingList?.notifications?.length > 0) {
                await capNotifs.cancel({ notifications: pendingList.notifications });
            }
            if (notifications.length > 0) {
                await capNotifs.schedule({ notifications });
            }
            return { scheduled: notifications.length, mode: 'capacitor' };
        } catch (err) {
            console.warn('No se pudieron programar notificaciones locales Capacitor:', err);
            return { scheduled: 0, mode: 'capacitor-error' };
        }
    }

    // 2. Entorno Web / Electron (Web Notifications API)
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const urgentTodayOrTomorrow = pendingCritical.filter(item => {
            const d = diffDaysFromToday(item.due_date);
            return d === 0 || d === 1;
        });

        let notified = 0;
        urgentTodayOrTomorrow.forEach(item => {
            const sessionFlag = `ngn_notified_${item.id}_${item.due_date}`;
            if (sessionStorage.getItem(sessionFlag)) return;

            const days = diffDaysFromToday(item.due_date);
            const amtLabel = Number(item.amount || 0) > 0
                ? ` • $${Number(item.amount).toLocaleString('es-CO')}`
                : '';

            new Notification(days === 0 ? `🚨 Hoy vence: ${item.title}` : `⏰ Mañana vence: ${item.title}`, {
                body: `Fecha: ${item.due_date}${amtLabel}`
            });
            sessionStorage.setItem(sessionFlag, '1');
            notified++;
        });

        return { scheduled: notified, mode: 'web' };
    }

    return { scheduled: 0, mode: 'unsupported' };
}