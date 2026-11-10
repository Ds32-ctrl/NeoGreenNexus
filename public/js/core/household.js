// public/js/core/household.js
import { supabase } from '../config/supabase.js';

const STORAGE_HOUSEHOLD_KEY = 'ngn_active_household_id';

/**
 * Obtiene el hogar activo del usuario actual junto con sus miembros.
 */
export async function getActiveHousehold(userId) {
    if (!userId) return null;

    const { data: memberships, error } = await supabase
        .from('household_members')
        .select(`
            role,
            household:households (
                id,
                name,
                invite_code,
                monthly_budget,
                created_by
            )
        `)
        .eq('user_id', userId);

    if (error || !memberships || memberships.length === 0) {
        localStorage.removeItem(STORAGE_HOUSEHOLD_KEY);
        return null;
    }

    const activeHousehold = memberships[0].household;
    if (!activeHousehold) return null;

    localStorage.setItem(STORAGE_HOUSEHOLD_KEY, activeHousehold.id);

    // Cargar la lista de todos los miembros del hogar con sus perfiles
    const { data: membersList } = await supabase
        .from('household_members')
        .select(`
            role,
            user_id,
            profile:profiles (
                id,
                full_name,
                nickname,
                email,
                avatar_url
            )
        `)
        .eq('household_id', activeHousehold.id);

    return {
        ...activeHousehold,
        myRole: memberships[0].role,
        members: (memberships && membersList) ? membersList.map(m => ({
            id: m.user_id,
            role: m.role,
            name: m.profile?.nickname || m.profile?.full_name || m.profile?.email?.split('@')[0] || 'Miembro',
            email: m.profile?.email || '',
            avatar: m.profile?.avatar_url || 'https://api.dicebear.com/7.x/bottts-neutral/svg?seed=N1'
        })) : []
    };
}

/**
 * Crea un nuevo Hogar Familiar y registra al creador como administrador.
 */
export async function createHousehold(userId, householdName, monthlyBudget = 0) {
    const randomCode = 'NGN-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    const { data: newHouse, error: houseErr } = await supabase
        .from('households')
        .insert({
            name: householdName.trim(),
            invite_code: randomCode,
            monthly_budget: Number(monthlyBudget) || 0,
            created_by: userId
        })
        .select()
        .single();

    if (houseErr) throw houseErr;

    const { error: memberErr } = await supabase
        .from('household_members')
        .insert({
            household_id: newHouse.id,
            user_id: userId,
            role: 'admin'
        });

    if (memberErr) throw memberErr;

    localStorage.setItem(STORAGE_HOUSEHOLD_KEY, newHouse.id);
    return newHouse;
}

/**
 * Une al usuario a un Hogar existente mediante el código de invitación (ej. NGN-4F9A).
 */
export async function joinHouseholdByCode(userId, inviteCode) {
    const cleanCode = inviteCode.trim().toUpperCase();

    const { data: targetHouse, error: findErr } = await supabase
        .from('households')
        .select('id, name')
        .eq('invite_code', cleanCode)
        .maybeSingle();

    if (findErr || !targetHouse) {
        throw new Error('Código de hogar no encontrado. Verifica con el administrador familiar.');
    }

    const { error: joinErr } = await supabase
        .from('household_members')
        .insert({
            household_id: targetHouse.id,
            user_id: userId,
            role: 'member'
        });

    if (joinErr && joinErr.code !== '23505') { // 23505 = ya era miembro
        throw joinErr;
    }

    localStorage.setItem(STORAGE_HOUSEHOLD_KEY, targetHouse.id);
    return targetHouse;
}